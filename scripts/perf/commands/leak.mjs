import { measureMemory, restartLevel, sleep, startLevel, waitForGame, waitQuiet } from '../lib/session.mjs'
import { fixed, mb, section, table } from '../lib/report.mjs'

async function exercise(page, seconds) {
  await page.evaluate(() => {
    window.__game.debug.invincible = true
    window.__game.setAutopilot(true, 'perfect')
  })
  await sleep(seconds * 1000)
  await page.evaluate(() => window.__game.setAutopilot(false))
  await page.evaluate(() => window.__perf.frames(5))
}

export async function leak(ctx) {
  const rounds = ctx.options.rounds ?? 3
  const restarts = ctx.options.restarts ?? 10
  const playSeconds = ctx.options.play ?? 3
  const restartLevelId = ctx.options.level ?? '1-1'
  const session = await ctx.open()
  const rows = []
  const sample = async (label, extra = {}) => {
    const memory = await measureMemory(ctx.browser, session.cdp, session.page)
    const where = await session.page.evaluate(() => ({ level: window.__game.level, area: window.__game.world.areaIndex, status: window.__game.world.status }))
    rows.push({ label, ...extra, where, ...memory })
    process.stderr.write(`  ${label}\n`)
  }
  try {
    await session.page.goto(ctx.url, { waitUntil: 'commit' })
    await waitForGame(session.page)
    await waitQuiet(session.page, { quiet: 2000 })
    await sample('启动后', { phase: 'start' })
    for (let round = 1; round <= rounds; round++) {
      for (const level of ctx.levels) {
        await startLevel(session.page, level)
        await exercise(session.page, playSeconds)
        await sample(`第 ${round} 轮 ${level}`, { phase: 'switch', round, level })
      }
    }
    await startLevel(session.page, restartLevelId)
    await exercise(session.page, playSeconds)
    await sample(`${restartLevelId} 开局`, { phase: 'restart', restart: 0 })
    for (let restart = 1; restart <= restarts; restart++) {
      await restartLevel(session.page)
      await exercise(session.page, playSeconds)
      await sample(`${restartLevelId} 重开第 ${restart} 次`, { phase: 'restart', restart })
    }
  } finally {
    await session.context.close()
  }
  const tableRows = rows.map((row) => [
    row.label,
    row.renderInfo?.geometries,
    row.renderInfo?.textures,
    row.renderInfo?.programs,
    mb(row.heap.used, 1),
    mb(row.bitmaps.bytes),
    `${mb(row.gpu.textureBytes)}（${mb(row.gpu.compressedBytes)}）`,
    mb(row.gpu.bufferBytes),
    fixed(row.processes?.renderer, 0),
    fixed(row.processes?.gpu, 0),
  ])
  const trend = (list) => {
    if (list.length < 2) return '—'
    const first = list[0]
    const last = list.at(-1)
    const delta = (read, digits = 0) => {
      const a = read(first)
      const b = read(last)
      return a === null || a === undefined || b === null || b === undefined ? '—' : `${b - a >= 0 ? '+' : ''}${fixed(b - a, digits)}`
    }
    return [
      `geometries ${delta((row) => row.renderInfo?.geometries)}`,
      `textures ${delta((row) => row.renderInfo?.textures)}`,
      `programs ${delta((row) => row.renderInfo?.programs)}`,
      `JS 堆 ${delta((row) => row.heap.used / 1048576, 1)} MB`,
      `渲染进程 ${delta((row) => row.processes?.renderer)} MB`,
    ].join('，')
  }
  const sameLevel = (round) => rows.filter((row) => row.phase === 'switch' && row.round === round)
  const switchTrend = rounds > 1 ? `切关：第 1 轮和第 ${rounds} 轮同一关比较（${ctx.levels.at(-1)}）：${trend([sameLevel(1).at(-1), sameLevel(rounds).at(-1)].filter(Boolean))}` : ''
  const restartTrend = `同关重开 ${restarts} 次：${trend(rows.filter((row) => row.phase === 'restart'))}`
  const markdown = section(
    '泄漏',
    `从整备界面按 ${ctx.levels.join('、')} 的顺序进关，循环 ${rounds} 轮，再在 ${restartLevelId} 重开 ${restarts} 次；每次进关后用自动驾驶（完美、无敌）打 ${playSeconds} 秒，强制 GC 后记录。`,
    table(['时刻', 'geometries', 'textures', 'programs', 'JS 堆 MB', '解码贴图 MB', '显存贴图 MB（其中压缩）', '显存缓冲 MB', '渲染进程 MB', 'GPU 进程 MB'], tableRows),
    switchTrend,
    restartTrend,
  )
  return { data: { rounds, restarts, playSeconds, levels: ctx.levels, restartLevel: restartLevelId, rows, errors: session.errors }, markdown }
}
