import { describe, expect, it } from 'vitest'
import { HIT_STAR, starRadius, starScale, starTexels } from './hit-star'

function texel(data: Uint8Array, size: number, x: number, y: number): number[] {
  const index = (y * size + x) * 4
  return [data[index], data[index + 1], data[index + 2], data[index + 3]]
}

describe('hit star', () => {
  it('has as many tips as points', () => {
    let tips = 0
    const steps = 720
    for (let i = 0; i < steps; i++) {
      const before = starRadius(((i - 1) / steps) * Math.PI * 2)
      const here = starRadius((i / steps) * Math.PI * 2)
      const after = starRadius(((i + 1) / steps) * Math.PI * 2)
      if (here > before && here >= after) tips++
    }
    expect(tips).toBe(HIT_STAR.points)
  })

  it('is bright in the middle, inked at the rim and clear outside', () => {
    const size = 64
    const data = starTexels(size)
    const center = texel(data, size, size / 2, size / 2)
    expect(center[3]).toBe(255)
    expect(Math.min(center[0], center[1], center[2])).toBeGreaterThan(220)
    expect(texel(data, size, 0, 0)[3]).toBe(0)
    let inked = false
    for (let x = size / 2; x < size; x++) {
      const [r, g, b, a] = texel(data, size, x, size / 2)
      if (a > 200 && Math.max(r, g, b) < 80) inked = true
    }
    expect(inked).toBe(true)
  })

  it('pops in and is gone after its life', () => {
    expect(starScale(0)).toBeGreaterThan(0)
    expect(starScale(HIT_STAR.life * HIT_STAR.grow)).toBeCloseTo(1, 5)
    expect(starScale(HIT_STAR.life)).toBe(0)
    expect(starScale(-0.01)).toBe(0)
  })
})
