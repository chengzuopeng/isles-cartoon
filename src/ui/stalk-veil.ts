const INK = '#1d1714'
const STEM = '#d9a93f'
const HEAD = '#f2cf63'

function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function stalkVeilSvg(width = 1600, height = 900, count = 44, seed = 7): string {
  const rand = random(seed)
  const shapes: string[] = []
  for (let i = 0; i < count; i++) {
    const side = rand()
    let x: number
    let base: number
    let reach: number
    if (side < 0.6) {
      x = rand() * width
      base = height + 10
      const edge = Math.min(x, width - x) / (width / 2)
      reach = height * (0.1 + 0.2 * (1 - edge) + rand() * 0.1)
    } else {
      const left = side < 0.8
      x = left ? rand() * width * 0.16 : width - rand() * width * 0.16
      base = height + 10
      reach = height * (0.3 + rand() * 0.35)
    }
    const lean = (rand() - 0.5) * 120 + (x < width / 2 ? 40 : -40)
    const tipX = x + lean
    const tipY = base - reach
    const midX = x + lean * 0.35 + (rand() - 0.5) * 30
    const midY = base - reach * 0.55
    const thick = 7 + rand() * 7
    const path = `M${x.toFixed(1)} ${base.toFixed(1)} Q${midX.toFixed(1)} ${midY.toFixed(1)} ${tipX.toFixed(1)} ${tipY.toFixed(1)}`
    shapes.push(`<path d="${path}" stroke="${INK}" stroke-width="${(thick + 6).toFixed(1)}" fill="none" stroke-linecap="round"/>`)
    shapes.push(`<path d="${path}" stroke="${STEM}" stroke-width="${thick.toFixed(1)}" fill="none" stroke-linecap="round"/>`)
    const angle = (Math.atan2(tipY - midY, tipX - midX) * 180) / Math.PI + 90
    const headLength = 34 + rand() * 30
    shapes.push(
      `<ellipse cx="${tipX.toFixed(1)}" cy="${(tipY - headLength * 0.4).toFixed(1)}" rx="${(thick * 1.3).toFixed(1)}" ry="${headLength.toFixed(1)}" transform="rotate(${angle.toFixed(1)} ${tipX.toFixed(1)} ${tipY.toFixed(1)})" fill="${HEAD}" stroke="${INK}" stroke-width="5"/>`,
    )
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${shapes.join('')}</svg>`
}

export function stalkVeilUrl(): string {
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(stalkVeilSvg())}")`
}
