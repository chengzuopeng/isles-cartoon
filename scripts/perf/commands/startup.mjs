import { measureMemory, sleep, waitQuiet } from '../lib/session.mjs'
import { fixed, mb, median, section, table } from '../lib/report.mjs'

async function waitStarted(page) {
  await page.waitForFunction(() => window.__perf?.marks.firstFrame !== undefined && window.__perf?.marks.prepVisible !== undefined, null, {
    timeout: 120_000,
    polling: 20,
  })
}

async function readLoad(page, quietMs) {
  await waitStarted(page)
  const lastGl = await waitQuiet(page, { quiet: quietMs, timeout: 120_000 })
  return page.evaluate((last) => {
    const perf = window.__perf
    const marks = { ...perf.marks }
    const interactive = marks.game ?? marks.firstFrame
    const ready = Math.max(interactive ?? 0, last)
    const tasks = perf.longTasks.filter((task) => task.start <= ready + 50)
    const navigation = performance.getEntriesByType('navigation')[0]
    const downloads = perf.downloads(0, ready)
    const pipeline = perf.pipeline(0, ready)
    const raw = perf.stopRecording({ raw: true, worst: 0 })?.raw ?? null
    const frameStats = (from) => {
      if (!raw || from === undefined) return null
      const list = []
      for (let i = 0; i < raw.start.length; i++) if (raw.start[i] >= from && raw.start[i] < ready) list.push({ at: raw.start[i], interval: raw.interval[i] })
      const sorted = list.map((frame) => frame.interval).sort((a, b) => a - b)
      const rank = (p) => (sorted.length > 0 ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] : null)
      return {
        from,
        count: list.length,
        median: rank(0.5),
        p95: rank(0.95),
        max: sorted.at(-1) ?? null,
        over16: sorted.filter((value) => value > 16.7).length,
        over20: sorted.filter((value) => value > 20).length,
        over33: sorted.filter((value) => value > 33.3).length,
        worst: list.sort((a, b) => b.interval - a.interval).slice(0, 6),
      }
    }
    const loaded = Math.max(downloads.lastEnd ?? 0, pipeline.decode.last ?? 0, pipeline.transcode.last ?? 0)
    return {
      marks,
      interactive,
      ready,
      prepFrames: frameStats(marks.prepVisible),
      preparingFrames: marks.prepVisible === undefined ? null : frameStats(Math.max(marks.prepVisible, loaded)),
      longTasks: {
        count: tasks.length,
        total: tasks.reduce((sum, task) => sum + task.duration, 0),
        max: tasks.reduce((most, task) => Math.max(most, task.duration), 0),
        list: tasks.slice().sort((a, b) => b.duration - a.duration).slice(0, 8),
      },
      counters: perf.counters(),
      downloads,
      pipeline,
      timeline: perf.glTimeline(0, ready),
      domContentLoaded: navigation?.domContentLoadedEventEnd ?? null,
      load: navigation?.loadEventEnd ?? null,
      screen: window.__game?.screen ?? null,
      models: window.__game?.models?.length ?? null,
      sockets: perf.sockets,
    }
  }, lastGl)
}

async function rush(ctx) {
  const session = await ctx.open()
  try {
    await session.page.goto(ctx.url, { waitUntil: 'commit' })
    const result = await session.page.evaluate(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      const begin = performance.now()
      let button = null
      while (!button) {
        if (performance.now() - begin > 120_000) throw new Error('整备界面没出来')
        button = document.querySelector('.prep-screen.visible .prep-mission.selected button.primary')
        if (!button) await wait(2)
      }
      const clicked = performance.now()
      button.click()
      while (document.querySelector('.prep-screen.visible')) {
        if (performance.now() - clicked > 120_000) throw new Error('点了出发以后没进关')
        await wait(2)
      }
      return { clicked, play: performance.now(), level: window.__game?.level ?? null }
    })
    await sleep(300)
    return { ...result, wait: result.play - result.clicked, errors: session.errors.slice() }
  } finally {
    await session.context.close()
  }
}

export async function startup(ctx) {
  const runs = ctx.options.runs ?? 3
  const quietMs = ctx.options.quiet ?? 2000
  const loads = []
  const rushes = []
  for (let run = 1; run <= runs; run++) {
    const session = await ctx.open({ recordFrames: true })
    try {
      await session.page.goto(ctx.url, { waitUntil: 'commit' })
      const cold = await readLoad(session.page, quietMs)
      cold.memory = await measureMemory(ctx.browser, session.cdp, session.page)
      loads.push({ kind: 'cold', run, ...cold })
      await session.page.reload({ waitUntil: 'commit' })
      const warm = await readLoad(session.page, quietMs)
      warm.memory = await measureMemory(ctx.browser, session.cdp, session.page)
      loads.push({ kind: 'warm', run, ...warm })
      if (session.errors.length > 0) loads.at(-1).errors = session.errors.slice()
    } finally {
      await session.context.close()
    }
    rushes.push({ run, ...(await rush(ctx)) })
    process.stderr.write(`  第 ${run} 次：冷启动 ${fixed(loads.at(-2).ready, 0)} ms，热启动 ${fixed(loads.at(-1).ready, 0)} ms 准备好\n`)
  }
  const pick = (kind, read) => median(loads.filter((load) => load.kind === kind).map(read))
  const summary = {}
  for (const kind of ['cold', 'warm']) {
    summary[kind] = {
      prepVisible: pick(kind, (load) => load.marks.prepVisible),
      prepPainted: pick(kind, (load) => load.marks.prepPainted),
      interactive: pick(kind, (load) => load.interactive),
      firstFrame: pick(kind, (load) => load.marks.firstFrame),
      ready: pick(kind, (load) => load.ready),
      downloaded: pick(kind, (load) => load.downloads.lastEnd),
      downloads: pick(kind, (load) => load.downloads.count),
      downloadBytes: pick(kind, (load) => load.downloads.encoded),
      firstUpload: pick(kind, (load) => load.timeline.firstUpload),
      decodes: pick(kind, (load) => load.pipeline.decode.count),
      decodeMs: pick(kind, (load) => load.pipeline.decode.total),
      decodeEnd: pick(kind, (load) => load.pipeline.decode.last),
      transcodes: pick(kind, (load) => load.pipeline.transcode.count),
      transcodeMs: pick(kind, (load) => load.pipeline.transcode.total),
      transcodeEnd: pick(kind, (load) => load.pipeline.transcode.last),
      firstLink: pick(kind, (load) => load.timeline.firstLink),
      compressedUploads: pick(kind, (load) => load.counters.compressedUploads),
      compressedUploadMs: pick(kind, (load) => load.counters.compressedUploadMs),
      gpuCompressed: pick(kind, (load) => load.memory?.gpu.compressedBytes),
      longTaskCount: pick(kind, (load) => load.longTasks.count),
      longTaskTotal: pick(kind, (load) => load.longTasks.total),
      longTaskMax: pick(kind, (load) => load.longTasks.max),
      links: pick(kind, (load) => load.counters.links),
      shaderMs: pick(kind, (load) => load.counters.shaderMs),
      uploads: pick(kind, (load) => load.counters.uploads),
      uploadMs: pick(kind, (load) => load.counters.uploadMs),
      heap: pick(kind, (load) => load.memory?.heap.used),
      backing: pick(kind, (load) => load.memory?.heap.backing),
      bitmaps: pick(kind, (load) => load.memory?.bitmaps.bytes),
      arrays: pick(kind, (load) => load.memory?.arrays.bytes),
      gpuTextures: pick(kind, (load) => load.memory?.gpu.textureBytes),
      gpuBuffers: pick(kind, (load) => load.memory?.gpu.bufferBytes),
      renderer: pick(kind, (load) => load.memory?.processes?.renderer),
      gpuProcess: pick(kind, (load) => load.memory?.processes?.gpu),
      geometries: pick(kind, (load) => load.memory?.renderInfo?.geometries),
      textures: pick(kind, (load) => load.memory?.renderInfo?.textures),
      programs: pick(kind, (load) => load.memory?.renderInfo?.programs),
      models: pick(kind, (load) => load.models),
    }
    for (const [key, field] of [
      ['prep', 'prepFrames'],
      ['preparing', 'preparingFrames'],
    ]) {
      summary[kind][key] = {
        from: pick(kind, (load) => load[field]?.from),
        count: pick(kind, (load) => load[field]?.count),
        median: pick(kind, (load) => load[field]?.median),
        over16: pick(kind, (load) => load[field]?.over16),
        over20: pick(kind, (load) => load[field]?.over20),
        over33: pick(kind, (load) => load[field]?.over33),
        longest: pick(kind, (load) => load[field]?.max),
        worst: Math.max(0, ...loads.filter((load) => load.kind === kind).map((load) => load[field]?.max ?? 0)),
      }
    }
  }
  summary.rush = {
    clicked: median(rushes.map((item) => item.clicked)),
    play: median(rushes.map((item) => item.play)),
    wait: median(rushes.map((item) => item.wait)),
  }
  const label = (kind) => (kind === 'cold' ? '冷启动' : '刷新（热）')
  const timingRows = ['cold', 'warm'].map((kind) => {
    const item = summary[kind]
    return [
      label(kind),
      fixed(item.prepVisible, 0),
      fixed(item.interactive, 0),
      fixed(item.downloaded, 0),
      fixed(Math.max(item.decodeEnd ?? 0, item.transcodeEnd ?? 0) || null, 0),
      fixed(item.firstLink, 0),
      fixed(item.firstUpload, 0),
      fixed(item.ready, 0),
    ]
  })
  const workRows = ['cold', 'warm'].map((kind) => {
    const item = summary[kind]
    return [
      label(kind),
      `${fixed(item.longTaskCount, 0)} / ${fixed(item.longTaskTotal, 0)} / ${fixed(item.longTaskMax, 0)}`,
      `${fixed(item.downloads, 0)} / ${mb(item.downloadBytes, 1)}`,
      `${fixed(item.decodes, 0)} / ${fixed(item.decodeMs, 0)}`,
      `${fixed(item.transcodes, 0)} / ${fixed(item.transcodeMs, 0)}`,
      `${fixed(item.links, 0)} / ${fixed(item.shaderMs, 0)}`,
      `${fixed(item.uploads, 0)} / ${fixed(item.uploadMs, 0)}`,
      `${fixed(item.compressedUploads, 0)} / ${fixed(item.compressedUploadMs, 0)}`,
    ]
  })
  const prepRows = ['cold', 'warm'].flatMap((kind) =>
    [
      ['prep', '整备界面出现起'],
      ['preparing', '其中模型解码 / 转码完以后'],
    ].map(([key, name]) => {
      const item = summary[kind][key]
      return [
        `${label(kind)}：${name}`,
        fixed(item.from, 0),
        fixed(item.count, 0),
        fixed(item.median, 1),
        `${fixed(item.over16, 0)} / ${fixed(item.over20, 0)} / ${fixed(item.over33, 0)}`,
        `${fixed(item.longest, 1)} / ${fixed(item.worst, 1)}`,
      ]
    }),
  )
  const memoryRows = ['cold', 'warm'].map((kind) => {
    const item = summary[kind]
    return [
      label(kind),
      mb(item.heap, 1),
      mb(item.bitmaps),
      mb(item.arrays),
      `${mb(item.gpuTextures)}（${mb(item.gpuCompressed)}）`,
      mb(item.gpuBuffers),
      `${fixed(item.geometries, 0)} / ${fixed(item.textures, 0)} / ${fixed(item.programs, 0)}`,
      fixed(item.models, 0),
      fixed(item.renderer, 0),
      fixed(item.gpuProcess, 0),
    ]
  })
  const markdown = section(
    '启动',
    `${runs} 次取中位数；时间从导航开始算（ms）。「可以操作」是 \`window.__game\` 就绪；「模型下载完」是最后一个模型或转码器文件下完的时刻，到第一次着色器链接 / 贴图上传之间主要是解析和转码；「当前关准备好」是最后一次着色器链接或贴图上传的时刻（随后 ${quietMs} ms 没有任何 GL 资源操作、网络请求、解码和转码）。整备界面在后台准备的是 1-1。`,
    table(['', '整备界面出现', '可以操作', '模型下载完', '解码 / 转码完', '第一次链接', '第一次上传', '当前关准备好'], timingRows),
    '启动期间的工作（解码是 createImageBitmap，转码是 KTX2 转码 worker，合计 ms 是每张从提交到拿到结果的时间加起来，多个 worker 并行时会超过墙钟时间）：',
    table(['', '长任务 个 / 合计 / 最长 ms', '下载 个 / MB', '解码 张 / 合计 ms', '转码 张 / 合计 ms', '程序链接 次 / ms', '贴图上传 次 / ms', '其中压缩贴图 次 / ms'], workRows),
    '整备界面期间的帧（到当前关准备好为止，每帧是相邻两次 requestAnimationFrame 的间隔；「其中模型解码 / 转码完以后」主要是建关卡画面和编译着色器；各列是各次的中位数，最长一列另给所有次里最长的）：',
    table(['', '从 ms', '帧数', '间隔中位 ms', '超过 16.7 / 20 / 33 ms 的帧', '最长 ms（中位 / 最长）'], prepRows),
    '启动后的内存（强制 GC 后；进程内存是 macOS `footprint`）：',
    table(['', 'JS 堆 MB', '解码贴图 MB', '留着的贴图数组 MB', '显存贴图 MB（其中压缩）', '显存缓冲 MB', 'geometries / textures / programs', '已加载模型', '渲染进程 MB', 'GPU 进程 MB'], memoryRows),
    `一出整备界面就点「出发」：点在 ${fixed(summary.rush.clicked, 0)} ms，${fixed(summary.rush.play, 0)} ms 进关（等了 ${fixed(summary.rush.wait, 0)} ms）。`,
  )
  return { data: { runs, quietMs, summary, loads, rushes }, markdown }
}
