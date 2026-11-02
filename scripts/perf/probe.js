;(() => {
  const raw = window.requestAnimationFrame.bind(window)
  const state = { recording: false, frames: [], last: 0 }
  window.requestAnimationFrame = (callback) =>
    raw((now) => {
      if (callback.name !== 'frame') {
        callback(now)
        return
      }
      const start = performance.now()
      callback(now)
      const main = performance.now() - start
      if (state.recording) {
        const info = window.__game?.renderInfo?.()
        state.frames.push({ interval: state.last ? now - state.last : null, main, calls: info?.calls ?? 0, triangles: info?.triangles ?? 0 })
      }
      state.last = now
    })
  const percentile = (values, share) => {
    const list = values.filter((value) => typeof value === 'number').sort((a, b) => a - b)
    if (list.length === 0) return null
    return list[Math.min(list.length - 1, Math.floor(share * (list.length - 1)))]
  }
  const stats = (values) => ({
    mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: values.length ? Math.max(...values) : null,
  })
  window.__perf = {
    start() {
      state.frames = []
      state.recording = true
    },
    stop() {
      state.recording = false
      const frames = state.frames
      return {
        frames: frames.length,
        interval: stats(frames.map((frame) => frame.interval).filter((value) => value !== null)),
        main: stats(frames.map((frame) => frame.main)),
        calls: stats(frames.map((frame) => frame.calls)),
        triangles: stats(frames.map((frame) => frame.triangles)),
      }
    },
    frames(count) {
      return new Promise((resolve) => {
        let seen = 0
        const tick = () => (++seen >= count ? resolve() : raw(tick))
        raw(tick)
      })
    },
  }
})()
