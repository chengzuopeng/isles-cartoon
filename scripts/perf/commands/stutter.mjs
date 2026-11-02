import { restartLevel, sleep, startLevel, waitForGame, waitQuiet } from '../lib/session.mjs'
import { fixed, pair, section, table } from '../lib/report.mjs'

async function playThrough(page, limitMs, capacity) {
  await page.evaluate((size) => {
    const game = window.__game
    game.debug.invincible = true
    game.setAutopilot(true, 'perfect')
    window.__perf.startRecording({ capacity: size, untilDone: true })
  }, capacity)
  const started = Date.now()
  let state = null
  for (;;) {
    await sleep(1000)
    state = await page.evaluate(() => {
      const game = window.__game
      game.skipDialogue()
      return { status: game.world.status, paused: game.paused, time: game.world.stats.time }
    })
    if (state.status !== 'playing' || Date.now() - started > limitMs) break
  }
  const stats = await page.evaluate(() => window.__perf.stopRecording({ worst: 10 }))
  await page.evaluate(() => window.__game.setAutopilot(false))
  return { status: state.status, paused: state.paused, levelTime: state.time, wall: (Date.now() - started) / 1000, stats }
}

export async function stutter(ctx) {
  const limitMs = (ctx.options.maxMinutes ?? 10) * 60_000
  const capacity = ctx.options.capacity ?? 600_000
  const runs = ctx.options.runs ?? 2
  const results = []
  for (const level of ctx.levels) {
    const session = await ctx.open()
    try {
      await session.page.goto(ctx.url, { waitUntil: 'commit' })
      await waitForGame(session.page)
      await waitQuiet(session.page, { quiet: 1500 })
      const entered = await startLevel(session.page, level)
      for (let run = 1; run <= runs; run++) {
        if (run > 1) {
          await restartLevel(session.page)
          await session.page.evaluate(() => window.__perf.frames(2))
        }
        const result = await playThrough(session.page, limitMs, capacity)
        results.push({ level, run, enterMs: run === 1 ? entered.ms : null, ...result })
        process.stderr.write(`  ${level} 第 ${run} 遍：${result.status}，${fixed(result.levelTime, 0)} 秒，${result.stats.frames} 帧\n`)
      }
      if (session.errors.length > 0) results.at(-1).errors = session.errors.slice()
    } finally {
      await session.context.close()
    }
  }
  const rows = results.map((item) => [
    item.level,
    item.run === 1 ? '冷跑' : `同页第 ${item.run} 遍`,
    item.status === 'complete' ? '通关' : item.status,
    fixed(item.levelTime, 0),
    item.stats.frames,
    item.stats.over16,
    item.stats.over33,
    fixed(item.stats.interval.max, 1),
    pair(item.stats.interval.p50, item.stats.interval.p99, 2),
    `${item.stats.links} / ${fixed(item.stats.shaderMs, 1)}`,
    `${item.stats.uploads} / ${fixed(item.stats.uploadMs, 1)}`,
    item.stats.finished ? `${fixed(item.stats.finished.interval, 0)} / ${fixed(item.stats.finished.main, 0)}` : '—',
  ])
  const worst = results.flatMap((item) =>
    item.stats.worst
      .filter((frame) => frame.interval > 16.7)
      .map((frame) => [
        item.level,
        item.run,
        fixed(frame.at / 1000, 1),
        fixed(frame.interval, 1),
        fixed(frame.main, 1),
        `${frame.links} / ${fixed(frame.shaderMs, 1)}`,
        `${frame.uploads} / ${fixed(frame.uploadMs, 1)}`,
        frame.calls,
      ]),
  )
  const totalFrames = results.reduce((sum, item) => sum + item.stats.frames, 0)
  const markdown = section(
    '卡顿',
    `每关新开一页，自动驾驶（完美、无敌）从进关打到通关${runs > 1 ? `，再在同一页重开打 ${runs - 1} 遍` : ''}；逐帧记 rAF 间隔、着色器程序链接（linkProgram 和等编译结果的调用）和贴图上传（texImage / texSubImage / 压缩贴图 / generateMipmap）的次数和耗时。统计到通关前一帧为止，通关那一帧（结算、尾声对话）单独列。共 ${totalFrames} 帧。`,
    table(['关卡', '哪一遍', '结果', '用时 s', '帧数', '>16.7 ms', '>33 ms', '最长帧 ms', '帧时间 p50 / p99', '程序链接 次 / ms', '贴图上传 次 / ms', '通关那一帧 间隔 / 主线程 ms'], rows),
    worst.length > 0
      ? `超过 16.7 ms 的帧（每遍最多列 10 个；时刻是页面加载后的秒数）：\n\n${table(['关卡', '遍', '时刻 s', '间隔 ms', '主线程 ms', '链接 次 / ms', '上传 次 / ms', 'draw call'], worst)}`
      : '没有超过 16.7 ms 的帧。',
  )
  return { data: { runs, results }, markdown }
}
