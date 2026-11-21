import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fixed, section, table } from '../lib/report.mjs'
import { placeAtSpot, sleep, startLevel, waitForGame } from '../lib/session.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

export async function drawcalls(ctx) {
  const config = JSON.parse(fs.readFileSync(path.resolve(here, '../spots.json'), 'utf8'))
  let chosen = config.spots
  if (ctx.options.spots) chosen = chosen.filter((spot) => ctx.options.spots.includes(spot.id))
  if (ctx.options.levels) chosen = chosen.filter((spot) => ctx.options.levels.includes(spot.level))
  if (chosen.length === 0) throw new Error('没有选中任何位置，检查 --spots / --levels')
  const session = await ctx.open()
  const results = []
  try {
    await session.page.goto(ctx.url, { waitUntil: 'commit' })
    await waitForGame(session.page)
    let current = null
    for (const spot of chosen) {
      if (spot.level !== current) {
        await startLevel(session.page, spot.level)
        current = spot.level
      }
      const placed = await placeAtSpot(session.page, spot)
      await session.page.evaluate(() => window.__perf.frames(20))
      await sleep((ctx.options.warmup ?? 1) * 1000)
      const snapshot = await session.page.evaluate(() => window.__perf.snapshotDrawCalls())
      results.push({ spot, placed, snapshot })
      process.stderr.write(`  ${spot.id} ${spot.name} 完成\n`)
    }
  } finally {
    await session.context.close()
  }

  const summaryRows = results.map(({ spot, snapshot }) => [
    spot.name,
    snapshot.total.calls,
    snapshot.passes.shadowMain.calls,
    snapshot.passes.main.calls,
    snapshot.passes.shadowNormal.calls,
    snapshot.passes.normal.calls,
    snapshot.passes.overlay.calls,
    snapshot.passes.post.calls,
    fixed(snapshot.total.triangles / 1e4, 1),
  ])

  const blocks = [
    table(
      ['位置', '总 draw call', 'shadowMain', 'main', 'shadowNormal', 'normal', 'overlay', 'post', '三角形（万）'],
      summaryRows,
    ),
  ]

  const worstByLevel = new Map()
  for (const item of results) {
    const prev = worstByLevel.get(item.spot.level)
    if (!prev || item.snapshot.total.calls > prev.snapshot.total.calls) worstByLevel.set(item.spot.level, item)
  }
  for (const [levelId, { spot, snapshot }] of worstByLevel) {
    const topRows = snapshot.bySource.slice(0, 20).map((entry) => [
      entry.name,
      entry.calls,
      entry.main,
      entry.normal,
      entry.shadow,
      entry.meshes,
      fixed(entry.triangles / 1e4, 1),
    ])
    blocks.push(
      `### ${levelId} 最重机位拆分：${spot.name}（总 ${snapshot.total.calls}）`,
      table(['来源', '总 draw call', '主遍', '法线', '阴影', '网格数', '三角形（万）'], topRows),
    )
  }

  const markdown = section(
    'Draw Call 拆分',
    '每个位置站定热身后采集完整一帧各遍的 draw call 与来源拆分。',
    ...blocks,
  )
  return { data: { results, errors: [] }, markdown }
}
