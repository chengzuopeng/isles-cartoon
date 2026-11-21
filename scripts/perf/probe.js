;(() => {
  if (window.__perf) return
  const config = window.__perfConfig ?? {}
  const now = () => performance.now()
  const P = {
    config,
    marks: {},
    longTasks: [],
    sockets: 0,
    renderer: null,
  }
  Object.defineProperty(window, '__perf', { value: P })

  const NativeSocket = window.WebSocket
  class BlockedSocket extends EventTarget {
    constructor(url, protocol) {
      super()
      this.url = String(url)
      this.protocol = String(protocol ?? '')
      this.readyState = 0
      this.bufferedAmount = 0
      this.extensions = ''
      this.binaryType = 'blob'
      this.onopen = null
      this.onclose = null
      this.onerror = null
      this.onmessage = null
    }
    send() {}
    close() {
      this.readyState = 3
    }
  }
  window.WebSocket = new Proxy(NativeSocket, {
    construct(target, args) {
      const protocols = [].concat(args[1] ?? [])
      if (protocols.some((item) => typeof item === 'string' && item.startsWith('vite'))) {
        P.sockets += 1
        return new BlockedSocket(args[0], protocols[0])
      }
      return Reflect.construct(target, args)
    },
  })

  try {
    performance.setResourceTimingBufferSize(100000)
  } catch {}
  const activity = { network: 0, worker: 0, bitmap: 0 }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) activity.network = Math.max(activity.network, entry.responseEnd || entry.startTime)
    }).observe({ type: 'resource', buffered: true })
  } catch {}
  const pipelineLog = []
  const notePipeline = (kind, start, end) => {
    pipelineLog.push({ kind, start, end })
    if (pipelineLog.length > 40000) pipelineLog.splice(0, 20000)
  }
  const NativeWorker = window.Worker
  if (NativeWorker) {
    window.Worker = new Proxy(NativeWorker, {
      construct(target, args) {
        const worker = Reflect.construct(target, args)
        const post = worker.postMessage
        let sent = null
        worker.postMessage = function (message, ...rest) {
          if (message && typeof message === 'object' && message.type === 'transcode') sent = performance.now()
          return post.call(this, message, ...rest)
        }
        worker.addEventListener('message', () => {
          const at = performance.now()
          activity.worker = at
          if (sent === null) return
          notePipeline('transcode', sent, at)
          sent = null
        })
        return worker
      },
    })
  }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) P.longTasks.push({ start: entry.startTime, duration: entry.duration })
    }).observe({ type: 'longtask', buffered: true })
  } catch {}

  const nativeRaf = window.requestAnimationFrame.bind(window)
  const markOnce = (name, at = now()) => {
    if (P.marks[name] === undefined) P.marks[name] = at
  }
  const watcher = new MutationObserver(() => {
    if (!document.querySelector('.prep-screen.visible')) return
    markOnce('prepVisible')
    nativeRaf(() => markOnce('prepPainted'))
    watcher.disconnect()
  })
  watcher.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] })

  let gameHandle
  Object.defineProperty(window, '__game', {
    configurable: true,
    enumerable: true,
    get() {
      return gameHandle
    },
    set(value) {
      gameHandle = value
      if (value) {
        markOnce('game')
        nativeRaf(() => markOnce('gameFrame'))
      }
    },
  })

  const G = {
    links: 0,
    compiles: 0,
    shaderMs: 0,
    uploads: 0,
    uploadMs: 0,
    uploadBytes: 0,
    compressedUploads: 0,
    compressedUploadMs: 0,
    compressedUploadBytes: 0,
    last: 0,
    textures: new Map(),
    buffers: new Map(),
    renderbuffers: new Map(),
  }
  P.gl = G
  const LOG_SIZE = 16384
  const EVENT = { link: 1, upload: 2, compressed: 3, storage: 4 }
  const log = { time: new Float64Array(LOG_SIZE), kind: new Uint8Array(LOG_SIZE), cost: new Float32Array(LOG_SIZE), count: 0 }
  const note = (kind, time, cost = 0) => {
    const at = log.count % LOG_SIZE
    log.time[at] = time
    log.kind[at] = kind
    log.cost[at] = cost
    log.count += 1
  }

  const BLOCKS = new Map()
  const block = (codes, width, height, bytes) => codes.forEach((code) => BLOCKS.set(code, [width, height, bytes]))
  block([0x83f0, 0x83f1, 0x8c4c, 0x8c4d, 0x8d64, 0x9274, 0x9275, 0x9276, 0x9277, 0x9270, 0x9271, 0x8dbb, 0x8dbc], 4, 4, 8)
  block([0x83f2, 0x83f3, 0x8c4e, 0x8c4f, 0x8e8c, 0x8e8d, 0x8e8e, 0x8e8f, 0x9278, 0x9279, 0x9272, 0x9273, 0x8dbd, 0x8dbe], 4, 4, 16)
  const ASTC = [
    [4, 4], [5, 4], [5, 5], [6, 5], [6, 6], [8, 5], [8, 6], [8, 8], [10, 5], [10, 6], [10, 8], [10, 10], [12, 10], [12, 12],
  ]
  ASTC.forEach(([width, height], index) => block([0x93b0 + index, 0x93d0 + index], width, height, 16))
  const PIXEL = new Map([
    [0x8229, 1], [0x822b, 2], [0x8051, 4], [0x8058, 4], [0x8c41, 4], [0x8c43, 4], [0x8d62, 2], [0x8057, 2], [0x8056, 2],
    [0x8059, 4], [0x822d, 2], [0x822f, 4], [0x881b, 8], [0x881a, 8], [0x822e, 4], [0x8230, 8], [0x8815, 16], [0x8814, 16],
    [0x8c3a, 4], [0x8c3d, 4], [0x81a5, 2], [0x81a6, 4], [0x8cac, 4], [0x88f0, 4], [0x8cad, 8], [0x8d48, 1],
    [0x8232, 1], [0x8231, 1], [0x8238, 2], [0x8237, 2], [0x8d7c, 4], [0x8d8e, 4], [0x8d76, 8], [0x8d88, 8], [0x8d70, 16], [0x8d82, 16],
  ])
  const CHANNELS = new Map([[0x1908, 4], [0x1907, 4], [0x190a, 2], [0x1909, 1], [0x1906, 1], [0x1902, 1], [0x84f9, 1], [0x1903, 1], [0x8227, 2]])
  const TYPE_BYTES = new Map([[0x1401, 1], [0x1400, 1], [0x1403, 2], [0x1402, 2], [0x1405, 4], [0x1404, 4], [0x1406, 4], [0x140b, 2], [0x8d61, 2], [0x84fa, 4]])
  const PACKED = new Set([0x8363, 0x8033, 0x8034, 0x8368, 0x8c3b, 0x8c3e, 0x8dad])
  const imageBytes = (format, type, width, height, depth = 1) => {
    const area = Math.max(1, width) * Math.max(1, height) * Math.max(1, depth)
    const blockInfo = BLOCKS.get(format)
    if (blockInfo) {
      const [bw, bh, bytes] = blockInfo
      return Math.ceil(Math.max(1, width) / bw) * Math.ceil(Math.max(1, height) / bh) * bytes * Math.max(1, depth)
    }
    const sized = PIXEL.get(format)
    if (sized) return area * sized
    if (type !== undefined && PACKED.has(type)) return area * (type === 0x8dad ? 8 : type === 0x8363 || type === 0x8033 || type === 0x8034 ? 2 : 4)
    const channels = CHANNELS.get(format) ?? 4
    return area * channels * (TYPE_BYTES.get(type) ?? 1)
  }
  const sourceSize = (source) => {
    if (!source || typeof source !== 'object') return [0, 0]
    const width = source.naturalWidth || source.videoWidth || source.displayWidth || source.codedWidth || source.width || 0
    const height = source.naturalHeight || source.videoHeight || source.displayHeight || source.codedHeight || source.height || 0
    return [width, height]
  }
  const viewBytes = (view) => (view && typeof view === 'object' && 'byteLength' in view ? view.byteLength : 0)

  const BINDINGS = new Map([
    [0x0de1, 0x8069],
    [0x8513, 0x8514],
    [0x806f, 0x806a],
    [0x8c1a, 0x8c1d],
  ])
  const boundTexture = (gl, target) => {
    const cube = target >= 0x8515 && target <= 0x851a
    const binding = BINDINGS.get(cube ? 0x8513 : target)
    return binding ? { texture: gl.getParameter(binding), face: cube ? target - 0x8515 : 0 } : { texture: null, face: 0 }
  }
  const textureRecord = (texture) => {
    let record = G.textures.get(texture)
    if (!record) {
      record = { storage: 0, levels: new Map(), bytes: 0, compressed: false }
      G.textures.set(texture, record)
    }
    return record
  }
  const settle = (record) => {
    let sum = record.storage
    if (sum === 0) for (const value of record.levels.values()) sum += value
    record.bytes = sum
  }
  const allocateLevel = (gl, target, level, bytes, compressed = false) => {
    const { texture, face } = boundTexture(gl, target)
    if (!texture) return
    const record = textureRecord(texture)
    if (record.storage > 0) return
    record.levels.set(`${face}:${level}`, bytes)
    record.compressed = compressed
    settle(record)
  }
  const allocateStorage = (gl, target, levels, format, width, height, depth, layered) => {
    const { texture } = boundTexture(gl, target)
    if (!texture) return
    const record = textureRecord(texture)
    let bytes = 0
    for (let level = 0; level < levels; level++) {
      const w = Math.max(1, width >> level)
      const h = Math.max(1, height >> level)
      const d = layered ? depth : Math.max(1, depth >> level)
      bytes += imageBytes(format, 0x1401, w, h, d)
    }
    record.storage = bytes * (target === 0x8513 ? 6 : 1)
    record.compressed = BLOCKS.has(format)
    record.levels.clear()
    settle(record)
  }
  const retained = []
  const tracked = new WeakSet()
  const keepView = (view) => {
    if (!view || typeof view !== 'object' || !view.buffer || view.buffer.byteLength < 65536 || tracked.has(view.buffer)) return
    tracked.add(view.buffer)
    retained.push({ ref: new WeakRef(view.buffer), bytes: view.buffer.byteLength })
  }

  const proto = window.WebGL2RenderingContext?.prototype
  const wrap = (name, body) => {
    if (!proto || typeof proto[name] !== 'function') return
    const original = proto[name]
    proto[name] = function (...args) {
      return body.call(this, original, args)
    }
  }
  const timedUpload = (original, gl, args, bytes, compressed = false) => {
    const start = now()
    try {
      return original.apply(gl, args)
    } finally {
      const end = now()
      G.uploads += 1
      G.uploadMs += end - start
      G.uploadBytes += bytes
      if (compressed) {
        G.compressedUploads += 1
        G.compressedUploadMs += end - start
        G.compressedUploadBytes += bytes
      }
      G.last = end
      note(compressed ? EVENT.compressed : EVENT.upload, start, end - start)
    }
  }
  const timedShader = (original, gl, args, link = false) => {
    const start = now()
    try {
      return original.apply(gl, args)
    } finally {
      const end = now()
      G.shaderMs += end - start
      G.last = end
      if (link) note(EVENT.link, start, end - start)
    }
  }

  wrap('texImage2D', function (original, args) {
    let width
    let height
    let bytes
    if (args.length >= 8) {
      width = args[3]
      height = args[4]
      bytes = imageBytes(args[2], args[7], width, height)
      const data = args[8]
      allocateLevel(this, args[0], args[1], bytes)
      if (data === null || data === undefined) return original.apply(this, args)
      keepView(data)
    } else {
      ;[width, height] = sourceSize(args[5])
      bytes = imageBytes(args[2], args[4], width, height)
      allocateLevel(this, args[0], args[1], bytes)
    }
    return timedUpload(original, this, args, bytes)
  })
  wrap('texSubImage2D', function (original, args) {
    let bytes
    if (args.length >= 9) {
      bytes = imageBytes(args[6], args[7], args[4], args[5])
      keepView(args[8])
    } else {
      const [width, height] = sourceSize(args[6])
      bytes = imageBytes(args[4], args[5], width, height)
    }
    return timedUpload(original, this, args, bytes)
  })
  wrap('texImage3D', function (original, args) {
    const bytes = imageBytes(args[2], args[8], args[3], args[4], args[5])
    allocateLevel(this, args[0], args[1], bytes)
    if (args[9] === null || args[9] === undefined) return original.apply(this, args)
    keepView(args[9])
    return timedUpload(original, this, args, bytes)
  })
  wrap('texSubImage3D', function (original, args) {
    const bytes = imageBytes(args[8], args[9], args[5], args[6], args[7])
    keepView(args[10])
    return timedUpload(original, this, args, bytes)
  })
  wrap('compressedTexImage2D', function (original, args) {
    const data = args[6]
    const bytes = typeof data === 'number' ? data : viewBytes(data) || imageBytes(args[2], 0x1401, args[3], args[4])
    allocateLevel(this, args[0], args[1], imageBytes(args[2], 0x1401, args[3], args[4]), true)
    keepView(data)
    return timedUpload(original, this, args, bytes, true)
  })
  wrap('compressedTexSubImage2D', function (original, args) {
    const data = args[7]
    const bytes = typeof data === 'number' ? data : viewBytes(data) || imageBytes(args[6], 0x1401, args[4], args[5])
    keepView(data)
    return timedUpload(original, this, args, bytes, true)
  })
  wrap('compressedTexImage3D', function (original, args) {
    const data = args[7]
    const bytes = typeof data === 'number' ? data : viewBytes(data)
    allocateLevel(this, args[0], args[1], imageBytes(args[2], 0x1401, args[3], args[4], args[5]), true)
    keepView(data)
    return timedUpload(original, this, args, bytes, true)
  })
  wrap('compressedTexSubImage3D', function (original, args) {
    const data = args[9]
    const bytes = typeof data === 'number' ? data : viewBytes(data)
    keepView(data)
    return timedUpload(original, this, args, bytes, true)
  })
  wrap('copyTexImage2D', function (original, args) {
    allocateLevel(this, args[0], args[1], imageBytes(args[2], 0x1401, args[5], args[6]))
    return original.apply(this, args)
  })
  wrap('texStorage2D', function (original, args) {
    allocateStorage(this, args[0], args[1], args[2], args[3], args[4], 1, false)
    G.last = now()
    note(EVENT.storage, G.last)
    return original.apply(this, args)
  })
  wrap('texStorage3D', function (original, args) {
    allocateStorage(this, args[0], args[1], args[2], args[3], args[4], args[5], args[0] === 0x8c1a)
    G.last = now()
    note(EVENT.storage, G.last)
    return original.apply(this, args)
  })
  wrap('generateMipmap', function (original, args) {
    const start = now()
    try {
      return original.apply(this, args)
    } finally {
      const end = now()
      G.uploadMs += end - start
      G.last = end
    }
  })
  wrap('deleteTexture', function (original, args) {
    G.textures.delete(args[0])
    return original.apply(this, args)
  })

  const BUFFER_BINDINGS = new Map([
    [0x8892, 0x8894],
    [0x8893, 0x8895],
    [0x8a11, 0x8a28],
    [0x8f36, 0x8f36],
    [0x8f37, 0x8f37],
    [0x88eb, 0x88ed],
    [0x88ec, 0x88ef],
    [0x8c8e, 0x8c8f],
  ])
  wrap('bufferData', function (original, args) {
    const binding = BUFFER_BINDINGS.get(args[0])
    const buffer = binding ? this.getParameter(binding) : null
    if (buffer) {
      const data = args[1]
      let bytes = 0
      if (typeof data === 'number') bytes = data
      else if (data && typeof data === 'object') {
        const element = data.BYTES_PER_ELEMENT ?? 1
        bytes = args[4] ? args[4] * element : data.byteLength - (args[3] ?? 0) * element
      }
      G.buffers.set(buffer, bytes)
    }
    return original.apply(this, args)
  })
  wrap('deleteBuffer', function (original, args) {
    G.buffers.delete(args[0])
    return original.apply(this, args)
  })
  wrap('renderbufferStorage', function (original, args) {
    const buffer = this.getParameter(0x8ca7)
    if (buffer) G.renderbuffers.set(buffer, imageBytes(args[1], 0x1401, args[2], args[3]))
    return original.apply(this, args)
  })
  wrap('renderbufferStorageMultisample', function (original, args) {
    const buffer = this.getParameter(0x8ca7)
    if (buffer) G.renderbuffers.set(buffer, imageBytes(args[2], 0x1401, args[3], args[4]) * Math.max(1, args[1]))
    return original.apply(this, args)
  })
  wrap('deleteRenderbuffer', function (original, args) {
    G.renderbuffers.delete(args[0])
    return original.apply(this, args)
  })

  wrap('linkProgram', function (original, args) {
    G.links += 1
    return timedShader(original, this, args, true)
  })
  wrap('compileShader', function (original, args) {
    G.compiles += 1
    return timedShader(original, this, args)
  })
  wrap('getProgramParameter', function (original, args) {
    if (args[1] !== 0x8b82 && args[1] !== 0x91b1) return original.apply(this, args)
    return timedShader(original, this, args)
  })
  wrap('getProgramInfoLog', function (original, args) {
    return timedShader(original, this, args)
  })
  wrap('getShaderInfoLog', function (original, args) {
    return timedShader(original, this, args)
  })
  wrap('getShaderParameter', function (original, args) {
    return timedShader(original, this, args)
  })

  const bitmaps = []
  const nativeBitmap = window.createImageBitmap
  if (nativeBitmap) {
    window.createImageBitmap = function (...args) {
      const start = now()
      return nativeBitmap.apply(this, args).then((bitmap) => {
        notePipeline('decode', start, now())
        bitmaps.push({ ref: new WeakRef(bitmap), bytes: bitmap.width * bitmap.height * 4 })
        activity.bitmap = now()
        return bitmap
      })
    }
  }

  P.memory = () => {
    let bitmapCount = 0
    let bitmapBytes = 0
    for (let i = bitmaps.length - 1; i >= 0; i--) {
      const bitmap = bitmaps[i].ref.deref()
      if (!bitmap || bitmap.width === 0) {
        bitmaps.splice(i, 1)
        continue
      }
      bitmapCount += 1
      bitmapBytes += bitmap.width * bitmap.height * 4
    }
    const seen = new Set()
    let arrayCount = 0
    let arrayBytes = 0
    for (let i = retained.length - 1; i >= 0; i--) {
      const buffer = retained[i].ref.deref()
      if (!buffer || buffer.byteLength === 0) {
        retained.splice(i, 1)
        continue
      }
      if (seen.has(buffer)) continue
      seen.add(buffer)
      arrayCount += 1
      arrayBytes += buffer.byteLength
    }
    let textureBytes = 0
    let compressedTextures = 0
    let compressedBytes = 0
    for (const record of G.textures.values()) {
      textureBytes += record.bytes
      if (!record.compressed) continue
      compressedTextures += 1
      compressedBytes += record.bytes
    }
    let bufferBytes = 0
    for (const bytes of G.buffers.values()) bufferBytes += bytes
    let renderbufferBytes = 0
    for (const bytes of G.renderbuffers.values()) renderbufferBytes += bytes
    return {
      bitmaps: { count: bitmapCount, bytes: bitmapBytes },
      arrays: { count: arrayCount, bytes: arrayBytes },
      gpu: {
        textures: G.textures.size,
        textureBytes,
        compressedTextures,
        compressedBytes,
        buffers: G.buffers.size,
        bufferBytes,
        renderbuffers: G.renderbuffers.size,
        renderbufferBytes,
      },
    }
  }
  P.renderInfo = () => {
    const renderer = P.renderer
    if (!renderer) return window.__game?.renderInfo?.() ?? null
    const { render, memory, programs } = renderer.info
    return {
      calls: render.calls,
      triangles: render.triangles,
      geometries: memory.geometries,
      textures: memory.textures,
      programs: programs?.length ?? 0,
    }
  }
  P.pipeline = (since = 0, until = Infinity) => {
    const result = {}
    for (const kind of ['decode', 'transcode']) result[kind] = { count: 0, total: 0, first: null, last: null }
    for (const entry of pipelineLog) {
      if (entry.start < since || entry.start > until) continue
      const row = result[entry.kind]
      row.count += 1
      row.total += entry.end - entry.start
      row.first = row.first === null ? entry.start : Math.min(row.first, entry.start)
      row.last = row.last === null ? entry.end : Math.max(row.last, entry.end)
    }
    return result
  }
  P.activity = () => ({ gl: G.last, network: activity.network, worker: activity.worker, bitmap: activity.bitmap, last: Math.max(G.last, activity.network, activity.worker, activity.bitmap) })
  P.counters = () => ({
    links: G.links,
    compiles: G.compiles,
    shaderMs: G.shaderMs,
    uploads: G.uploads,
    uploadMs: G.uploadMs,
    uploadBytes: G.uploadBytes,
    compressedUploads: G.compressedUploads,
    compressedUploadMs: G.compressedUploadMs,
    compressedUploadBytes: G.compressedUploadBytes,
    lastGl: G.last,
  })
  P.glTimeline = (since = 0, until = Infinity) => {
    const result = { first: null, last: null, firstLink: null, lastLink: null, firstUpload: null, lastUpload: null, links: 0, uploads: 0, compressed: 0, uploadMs: 0, dropped: Math.max(0, log.count - LOG_SIZE) }
    const start = Math.max(0, log.count - LOG_SIZE)
    for (let i = start; i < log.count; i++) {
      const at = i % LOG_SIZE
      const time = log.time[at]
      if (time < since || time > until) continue
      const kind = log.kind[at]
      result.first ??= time
      result.last = time
      if (kind === EVENT.link) {
        result.firstLink ??= time
        result.lastLink = time
        result.links += 1
      } else if (kind === EVENT.upload || kind === EVENT.compressed) {
        result.firstUpload ??= time
        result.lastUpload = time
        result.uploads += 1
        result.uploadMs += log.cost[at]
        if (kind === EVENT.compressed) result.compressed += 1
      }
    }
    return result
  }
  const ASSET = /\.(glb|gltf|ktx2|basis|wasm)(\?|$)|basis_transcoder/
  P.downloads = (since = 0, until = Infinity) => {
    const result = { count: 0, encoded: 0, decoded: 0, transfer: 0, firstStart: null, lastEnd: null, models: 0, transcoder: 0 }
    for (const entry of performance.getEntriesByType('resource')) {
      if (entry.startTime < since || entry.startTime > until || !ASSET.test(entry.name)) continue
      result.count += 1
      result.encoded += entry.encodedBodySize || 0
      result.decoded += entry.decodedBodySize || 0
      result.transfer += entry.transferSize || 0
      result.firstStart = result.firstStart === null ? entry.startTime : Math.min(result.firstStart, entry.startTime)
      result.lastEnd = result.lastEnd === null ? entry.responseEnd : Math.max(result.lastEnd, entry.responseEnd)
      if (/basis_transcoder/.test(entry.name)) result.transcoder += 1
      else if (/\.(glb|gltf)(\?|$)/.test(entry.name)) result.models += 1
    }
    return result
  }

  const frame = { rendered: false, calls: 0, triangles: 0 }
  const instrumentRenderer = (renderer) => {
    const render = renderer.render
    renderer.render = function (scene, camera) {
      try {
        return render.call(this, scene, camera)
      } finally {
        frame.rendered = true
        frame.calls = this.info.render.calls
        frame.triangles = this.info.render.triangles
      }
    }
  }
  const hooks = new EventTarget()
  hooks.addEventListener('observe', (event) => {
    const target = event.detail
    if (!target?.isWebGLRenderer || P.renderer) return
    P.renderer = target
    instrumentRenderer(target)
  })
  Object.defineProperty(window, '__THREE_DEVTOOLS__', { value: hooks, configurable: true })

  let recorder = null
  P.startRecording = (options = {}) => {
    const capacity = options.capacity ?? 400000
    recorder = {
      capacity,
      count: 0,
      untilDone: Boolean(options.untilDone),
      finished: null,
      start: new Float64Array(capacity),
      interval: new Float32Array(capacity),
      main: new Float32Array(capacity),
      links: new Uint16Array(capacity),
      shaderMs: new Float32Array(capacity),
      uploads: new Uint16Array(capacity),
      uploadMs: new Float32Array(capacity),
      calls: new Uint32Array(capacity),
      triangles: new Uint32Array(capacity),
      flags: new Uint8Array(capacity),
      overflow: 0,
    }
  }
  const percentile = (sorted, p) => (sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))])
  const describe = (values) => {
    const sorted = Float64Array.from(values).sort()
    let sum = 0
    for (const value of sorted) sum += value
    return {
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
      max: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
      mean: sorted.length > 0 ? sum / sorted.length : 0,
    }
  }
  P.stopRecording = (options = {}) => {
    const rec = recorder
    recorder = null
    if (!rec) return null
    const n = Math.min(rec.count, rec.capacity)
    const interval = rec.interval.subarray(0, n)
    const main = rec.main.subarray(0, n)
    const calls = []
    const triangles = []
    let links = 0
    let shaderMs = 0
    let uploads = 0
    let uploadMs = 0
    let over16 = 0
    let over33 = 0
    for (let i = 0; i < n; i++) {
      links += rec.links[i]
      shaderMs += rec.shaderMs[i]
      uploads += rec.uploads[i]
      uploadMs += rec.uploadMs[i]
      if (interval[i] > 16.7) over16 += 1
      if (interval[i] > 33.3) over33 += 1
      if (rec.flags[i] & 1) {
        calls.push(rec.calls[i])
        triangles.push(rec.triangles[i])
      }
    }
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => interval[b] - interval[a])
    const worst = order.slice(0, options.worst ?? 10).map((i) => ({
      at: rec.start[i],
      interval: interval[i],
      main: main[i],
      links: rec.links[i],
      shaderMs: rec.shaderMs[i],
      uploads: rec.uploads[i],
      uploadMs: rec.uploadMs[i],
      calls: rec.calls[i],
      play: Boolean(rec.flags[i] & 2),
    }))
    const result = {
      frames: n,
      overflow: rec.overflow,
      duration: n > 0 ? rec.start[n - 1] + interval[n - 1] - rec.start[0] : 0,
      interval: describe(interval),
      main: describe(main),
      over16,
      over33,
      links,
      shaderMs,
      uploads,
      uploadMs,
      renderedFrames: calls.length,
      calls: describe(calls),
      triangles: describe(triangles),
      finished: rec.finished,
      worst,
    }
    if (options.raw) {
      result.raw = {
        start: Array.from(rec.start.subarray(0, n)),
        interval: Array.from(interval),
        main: Array.from(main),
        links: Array.from(rec.links.subarray(0, n)),
        shaderMs: Array.from(rec.shaderMs.subarray(0, n)),
        uploads: Array.from(rec.uploads.subarray(0, n)),
        uploadMs: Array.from(rec.uploadMs.subarray(0, n)),
        calls: Array.from(rec.calls.subarray(0, n)),
        play: Array.from(rec.flags.subarray(0, n), (flag) => (flag & 2 ? 1 : 0)),
      }
    }
    return result
  }

  let lastStart = 0
  let lastStamp = -1
  let mainSum = 0
  let base = { links: 0, shaderMs: 0, uploads: 0, uploadMs: 0 }
  const closeFrame = (begin) => {
    if (lastStart > 0 && recorder && !recorder.finished) {
      const index = recorder.count
      const done = recorder.untilDone && window.__game?.world?.status !== 'playing'
      if (done) {
        recorder.finished = {
          at: lastStart,
          interval: begin - lastStart,
          main: mainSum,
          links: G.links - base.links,
          shaderMs: G.shaderMs - base.shaderMs,
          uploads: G.uploads - base.uploads,
          uploadMs: G.uploadMs - base.uploadMs,
        }
      } else if (index < recorder.capacity) {
        recorder.start[index] = lastStart
        recorder.interval[index] = begin - lastStart
        recorder.main[index] = mainSum
        recorder.links[index] = G.links - base.links
        recorder.shaderMs[index] = G.shaderMs - base.shaderMs
        recorder.uploads[index] = G.uploads - base.uploads
        recorder.uploadMs[index] = G.uploadMs - base.uploadMs
        recorder.calls[index] = frame.rendered ? frame.calls : 0
        recorder.triangles[index] = frame.rendered ? frame.triangles : 0
        recorder.flags[index] = (frame.rendered ? 1 : 0) | (window.__game?.screen === 'play' ? 2 : 0)
        recorder.count = index + 1
      } else recorder.overflow += 1
    }
    frame.rendered = false
    lastStart = begin
    mainSum = 0
    base = { links: G.links, shaderMs: G.shaderMs, uploads: G.uploads, uploadMs: G.uploadMs }
  }
  window.requestAnimationFrame = (callback) =>
    nativeRaf((stamp) => {
      const begin = now()
      if (stamp !== lastStamp) {
        lastStamp = stamp
        closeFrame(begin)
        markOnce('firstFrame', begin)
      }
      try {
        callback(stamp)
      } finally {
        mainSum += now() - begin
      }
    })

  P.frames = (count) =>
    new Promise((resolve) => {
      let left = count
      const tick = () => {
        left -= 1
        if (left <= 0) resolve()
        else nativeRaf(tick)
      }
      nativeRaf(tick)
    })

  const isTopTag = (name) =>
    name === 'chest' ||
    name === 'campfire' ||
    name === 'clue' ||
    name === 'pickup' ||
    name.startsWith('enemy:') ||
    name.startsWith('sheep:') ||
    name.startsWith('landmark:') ||
    name.startsWith('building-') ||
    name.startsWith('prop:') ||
    name.startsWith('story-actor-') ||
    name === 'framed-platforms' ||
    name === 'keg' ||
    name === 'crate' ||
    name === 'crates' ||
    name === 'gate' ||
    name.startsWith('walls-') ||
    name === 'ground' ||
    name === 'water' ||
    name === 'underside' ||
    name === 'stalks' ||
    name === 'tufts' ||
    name === 'flower-stems' ||
    name === 'flower-heads' ||
    name === 'pebbles' ||
    name === 'palisade-tips' ||
    name === 'hedge-tops'

  const drawSourceOf = (object, pass, material, geometry) => {
    if (pass === 'overlay') return 'viewmodel'
    if (pass === 'post') return 'post'
    const chain = []
    let cur = object
    while (cur && !cur.isScene) {
      if (cur.name) chain.push(cur.name)
      cur = cur.parent
    }
    for (const name of chain) {
      if (isTopTag(name)) return name
    }
    if (chain.includes('far')) return 'sky:far'
    if (chain.includes('sky')) return chain[0] && chain[0] !== 'sky' ? `sky:${chain[0]}` : 'sky'
    const local = chain.filter((name) => name !== 'level' && name !== 'Scene' && name !== 'root')
    if (local.length > 0) return local[local.length - 1]
    if (object?.isSprite) return 'sprite'
    if (geometry?.attributes?.rigidJoint) return 'enemy:rigid'
    const sourceMaterial = Array.isArray(object?.material) ? object.material[0] : (object?.material ?? material)
    const matName = sourceMaterial?.name
    if (matName) return `mat:${matName}`
    const geoType = geometry?.type ?? 'Geometry'
    const matType = sourceMaterial?.type ?? 'Material'
    return `other:${geoType}:${matType}`
  }

  P.snapshotDrawCalls = () =>
    new Promise((resolve, reject) => {
      const renderer = P.renderer
      if (!renderer) {
        reject(new Error('renderer is not attached to __perf'))
        return
      }
      const worldScene = window.__game?.scene ?? null
      const passes = {
        shadowMain: { calls: 0, triangles: 0 },
        main: { calls: 0, triangles: 0 },
        shadowNormal: { calls: 0, triangles: 0 },
        normal: { calls: 0, triangles: 0 },
        overlay: { calls: 0, triangles: 0 },
        post: { calls: 0, triangles: 0 },
      }
      const sources = new Map()
      let worldRenderCount = 0
      let shadowDepth = 0
      let activePass = 'post'
      let capturing = false
      let done = false
      let attempts = 0

      const origRender = renderer.render
      const origShadowRender = renderer.shadowMap.render
      const origDirect = renderer.renderBufferDirect

      const cleanup = () => {
        renderer.render = origRender
        renderer.shadowMap.render = origShadowRender
        renderer.renderBufferDirect = origDirect
      }

      const passBucketName = () => {
        if (shadowDepth > 0) return worldRenderCount === 1 ? 'shadowMain' : worldRenderCount === 2 ? 'shadowNormal' : 'shadowMain'
        return activePass
      }

      renderer.shadowMap.render = function (...args) {
        if (!capturing) return origShadowRender.apply(this, args)
        shadowDepth += 1
        try {
          return origShadowRender.apply(this, args)
        } finally {
          shadowDepth -= 1
        }
      }

      renderer.render = function (scene, camera, ...rest) {
        if (!capturing) return origRender.call(this, scene, camera, ...rest)
        const prevPass = activePass
        if (scene === worldScene) {
          worldRenderCount += 1
          activePass = worldRenderCount === 1 ? 'main' : worldRenderCount === 2 ? 'normal' : 'post'
        } else if (scene?.isScene) {
          activePass = 'overlay'
        } else {
          activePass = 'post'
        }
        try {
          return origRender.call(this, scene, camera, ...rest)
        } finally {
          activePass = prevPass
        }
      }

      renderer.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
        if (!capturing) return origDirect.call(this, camera, scene, geometry, material, object, group)
        const callsBefore = this.info.render.calls
        const trisBefore = this.info.render.triangles
        try {
          return origDirect.call(this, camera, scene, geometry, material, object, group)
        } finally {
          const callsDelta = this.info.render.calls - callsBefore
          const trisDelta = this.info.render.triangles - trisBefore
          if (callsDelta > 0) {
            const bucketPass = passBucketName()
            const passStat = passes[bucketPass]
            passStat.calls += callsDelta
            passStat.triangles += trisDelta
            const key = drawSourceOf(object, bucketPass, material, geometry)
            let entry = sources.get(key)
            if (!entry) {
              entry = { name: key, calls: 0, main: 0, normal: 0, shadow: 0, overlay: 0, post: 0, triangles: 0, uuids: new Set() }
              sources.set(key, entry)
            }
            entry.calls += callsDelta
            entry.triangles += trisDelta
            if (object?.uuid) entry.uuids.add(object.uuid)
            if (bucketPass === 'shadowMain' || bucketPass === 'shadowNormal') entry.shadow += callsDelta
            else entry[bucketPass] += callsDelta
          }
        }
      }

      const tryFrame = () => {
        if (done) return
        attempts += 1
        worldRenderCount = 0
        shadowDepth = 0
        capturing = true
        nativeRaf(() => {
          setTimeout(() => {
            if (done) return
            capturing = false
            if (worldRenderCount === 0 && attempts < 10) {
              tryFrame()
              return
            }
            done = true
            cleanup()
            if (worldRenderCount === 0) {
              reject(new Error('no world render captured during snapshotDrawCalls'))
              return
            }
            const bySource = [...sources.values()]
              .map(({ uuids, ...rest }) => ({ ...rest, meshes: uuids.size }))
              .sort((a, b) => b.calls - a.calls || b.triangles - a.triangles)
            const totalCalls = Object.values(passes).reduce((sum, p) => sum + p.calls, 0)
            const totalTriangles = Object.values(passes).reduce((sum, p) => sum + p.triangles, 0)
            resolve({
              total: { calls: totalCalls, triangles: totalTriangles },
              passes,
              bySource,
            })
          }, 0)
        })
      }
      tryFrame()
    })
  if (config.recordFrames) P.startRecording({ capacity: 50000 })
})()
