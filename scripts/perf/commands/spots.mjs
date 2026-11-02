import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fixed, pair, section, table } from '../lib/report.mjs'
import { placeAtSpot, sleep, startLevel, waitForGame } from '../lib/session.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

export async function spots(ctx) {
  const config = JSON.parse(fs.readFileSync(path.resolve(here, '../spots.json'), 'utf8'))
  let chosen = config.spots
  if (ctx.options.spots) chosen = chosen.filter((spot) => ctx.options.spots.includes(spot.id))
  if (ctx.options.levels) chosen = chosen.filter((spot) => ctx.options.levels.includes(spot.level))
  if (chosen.length === 0) throw new Error('没有选中任何位置，检查 --spots / --levels')
  const seconds = ctx.options.seconds ?? 4
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
      await session.page.evaluate(() => window.__perf.startRecording({ capacity: 50_000 }))
      await sleep(seconds * 1000)
      const stats = await session.page.evaluate(() => window.__perf.stopRecording({ worst: 0 }))
      results.push({ spot, placed, stats })
      process.stderr.write(`  ${spot.id} ${spot.name} 完成\n`)
    }
  } finally {
    await session.context.close()
  }
  const rows = results.map(({ spot, placed, stats }) => [
    spot.name,
    placed.enemies,
    `${fixed(stats.calls.mean, 0)}（最多 ${fixed(stats.calls.max, 0)}）`,
    fixed(stats.triangles.mean / 1e4, 1),
    pair(stats.interval.p50, stats.interval.p95, 2),
    pair(stats.main.p50, stats.main.p95, 2),
    stats.frames,
  ])
  const markdown = section(
    '重点位置',
    `每个位置量 ${seconds} 秒；主角无敌、站着不动。帧时间是 rAF 间隔，主线程是游戏每帧回调的耗时，单位 ms。draw call 和三角形是一帧里主遍、法线遍、阴影遍的合计。`,
    table(['位置', '敌人', 'draw call', '三角形（万）', '帧时间 p50 / p95', '主线程 p50 / p95', '帧数'], rows),
  )
  return { data: { seconds, results, errors: [] }, markdown }
}
