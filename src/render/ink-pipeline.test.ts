import { describe, expect, it } from 'vitest'
import { DEFAULT_LOOK, detailGain } from './ink-pipeline'

describe('ink pipeline detail fade', () => {
  it('keeps inner lines on characters that fill the screen', () => {
    expect(detailGain(2, 1, DEFAULT_LOOK.detailNear, DEFAULT_LOOK.detailFar)).toBe(1)
    expect(detailGain(DEFAULT_LOOK.detailNear, 1, DEFAULT_LOOK.detailNear, DEFAULT_LOOK.detailFar)).toBe(1)
  })

  it('drops inner lines once a character is small on screen', () => {
    expect(detailGain(DEFAULT_LOOK.detailFar, 1, DEFAULT_LOOK.detailNear, DEFAULT_LOOK.detailFar)).toBe(0)
    expect(detailGain(40, 1, DEFAULT_LOOK.detailNear, DEFAULT_LOOK.detailFar)).toBe(0)
  })

  it('fades smoothly in between', () => {
    const near = DEFAULT_LOOK.detailNear
    const far = DEFAULT_LOOK.detailFar
    let previous = 1
    for (let distance = near; distance <= far; distance += 0.5) {
      const gain = detailGain(distance, 1, near, far)
      expect(gain).toBeLessThanOrEqual(previous)
      previous = gain
    }
    expect(detailGain((near + far) / 2, 1, near, far)).toBeCloseTo(0.5, 5)
  })

  it('scales with the size of the character', () => {
    const small = detailGain(10, 0.8, DEFAULT_LOOK.detailNear, DEFAULT_LOOK.detailFar)
    const large = detailGain(10, 3, DEFAULT_LOOK.detailNear, DEFAULT_LOOK.detailFar)
    expect(large).toBe(1)
    expect(small).toBeLessThan(large)
  })

  it('thins outlines with distance only past the near range', () => {
    expect(DEFAULT_LOOK.lineNear).toBeGreaterThan(DEFAULT_LOOK.detailNear)
    expect(DEFAULT_LOOK.lineMin).toBeLessThan(DEFAULT_LOOK.lineWidth)
    expect(DEFAULT_LOOK.creaseStart).toBeLessThan(DEFAULT_LOOK.creaseEnd)
  })
})
