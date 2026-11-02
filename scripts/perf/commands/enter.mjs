import { sleep, startLevel, waitForGame, waitQuiet } from '../lib/session.mjs'
import { fixed, mb, median, section, table } from '../lib/report.mjs'

export async function enter(ctx) {
  const rounds = ctx.options.rounds ?? 2
  const settleMs = ctx.options.settle ?? 1500
  const session = await ctx.open()
  const results = []
  let first = null
  try {
    await session.page.goto(ctx.url, { waitUntil: 'commit' })
    await waitForGame(session.page)
    await waitQuiet(session.page, { quiet: 2000 })
    first = await session.page.evaluate(() => window.__game.level)
    for (let round = 1; round <= rounds; round++) {
      for (const level of ctx.levels) {
        await session.page.evaluate(() => {
          if (window.__game.screen !== 'prep') window.__game.openPrep()
        })
        await sleep(settleMs)
        await waitQuiet(session.page, { quiet: 500, timeout: 30_000 })
        const before = await session.page.evaluate(() => {
          window.__perf.startRecording({ capacity: 200_000 })
          return window.__perf.counters()
        })
        const timing = await startLevel(session.page, level)
        const after = await session.page.evaluate(
          ({ begin, end }) => ({
            ...window.__perf.counters(),
            downloads: window.__perf.downloads(begin, end),
            pipeline: window.__perf.pipeline(begin, end),
            timeline: window.__perf.glTimeline(begin, end),
          }),
          timing,
        )
        await session.page.evaluate(() => window.__perf.frames(30))
        await sleep(300)
        const record = await session.page.evaluate(() => window.__perf.stopRecording({ raw: true, worst: 3 }))
        const raw = record.raw
        let index = -1
        for (let i = 0; i < raw.start.length; i++) {
          if (raw.play[i] && raw.start[i] >= timing.end - 0.5) {
            index = i
            break
          }
        }
        const firstFrame =
          index >= 0
            ? {
                interval: raw.interval[index],
                main: raw.main[index],
                links: raw.links[index],
                shaderMs: raw.shaderMs[index],
                uploads: raw.uploads[index],
                uploadMs: raw.uploadMs[index],
              }
            : null
        let worst = 0
        for (let i = Math.max(0, index); i >= 0 && i < Math.min(raw.start.length, index + 30); i++) worst = Math.max(worst, raw.interval[i])
        results.push({
          round,
          level,
          prepared: round === 1 && level === first,
          ms: timing.ms,
          links: after.links - before.links,
          shaderMs: after.shaderMs - before.shaderMs,
          uploads: after.uploads - before.uploads,
          uploadMs: after.uploadMs - before.uploadMs,
          compressedUploads: after.compressedUploads - before.compressedUploads,
          compressedUploadMs: after.compressedUploadMs - before.compressedUploadMs,
          downloads: after.downloads,
          pipeline: after.pipeline,
          firstGl: after.timeline.first !== null ? after.timeline.first - timing.begin : null,
          downloaded: after.downloads.lastEnd !== null ? after.downloads.lastEnd - timing.begin : null,
          firstFrame,
          worstOf30: index >= 0 ? worst : null,
        })
        process.stderr.write(`  第 ${round} 轮 ${level}：${fixed(timing.ms, 0)} ms\n`)
      }
    }
  } finally {
    await session.context.close()
  }
  const label = (item) => (item.round === 1 ? (item.prepared ? '第一次（整备界面已在后台准备）' : '第一次进') : '回到去过的关')
  const rows = results.map((item) => [
    item.level,
    label(item),
    fixed(item.ms, 0),
    `${item.downloads.count} / ${mb(item.downloads.encoded, 1)} / ${fixed(item.downloaded, 0)}`,
    `${item.pipeline.decode.count + item.pipeline.transcode.count} / ${fixed(item.pipeline.decode.total + item.pipeline.transcode.total, 0)}`,
    fixed(item.firstGl, 0),
    `${item.links} / ${fixed(item.shaderMs, 0)}`,
    `${item.uploads} / ${fixed(item.uploadMs, 0)}（${item.compressedUploads} / ${fixed(item.compressedUploadMs, 0)}）`,
    item.firstFrame ? `${fixed(item.firstFrame.interval, 1)} / ${fixed(item.firstFrame.main, 1)}` : '—',
    fixed(item.worstOf30, 1),
  ])
  const firstEntries = results.filter((item) => item.round === 1 && !item.prepared)
  const returns = results.filter((item) => item.round > 1)
  const range = (list, read) => (list.length === 0 ? '—' : `${fixed(Math.min(...list.map(read)), 0)}~${fixed(Math.max(...list.map(read)), 0)}`)
  const markdown = section(
    '进关',
    `从整备界面调 \`startLevel\` 到 \`screen === 'play'\` 的时间（ms）；期间下载的模型和转码器文件（个数 / MB / 从调用起多久下完）；从调用到第一次 GL 资源操作（链接或上传）的时间，主要是下载、解析、转码和建关卡画面；期间的着色器链接和贴图上传（括号里是其中的压缩贴图）；进关后第一帧（rAF 间隔 / 主线程）和前 30 帧里最长的一帧。每次进关前先回整备界面等 ${settleMs} ms。整备界面一开始在后台准备的是 ${first}，所以第一轮的 ${first} 不算「第一次进」；要量没准备过的关，\`--levels\` 里加上别的关。`,
    table(['关卡', '情况', '进关 ms', '下载 个 / MB / 下完 ms', '解码或转码 张 / 合计 ms', '到第一次 GL 操作 ms', '链接 次 / ms', '上传 次 / ms（压缩）', '第一帧 间隔 / 主线程 ms', '前 30 帧最长 ms'], rows),
    `第一次进（不含后台已准备的那关）${range(firstEntries, (item) => item.ms)} ms，中位 ${fixed(median(firstEntries.map((item) => item.ms)), 0)} ms；回到去过的关 ${range(returns, (item) => item.ms)} ms，中位 ${fixed(median(returns.map((item) => item.ms)), 0)} ms；第一帧间隔 ${range(results.filter((item) => item.firstFrame), (item) => item.firstFrame.interval)} ms。`,
  )
  return { data: { rounds, settleMs, results, errors: session.errors }, markdown }
}
