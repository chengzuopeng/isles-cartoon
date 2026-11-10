import { describe, expect, it } from 'vitest'
import { CHAPTER_1_LOOK } from './chapter-look'
import { blobScale, clearOfEye, EYE_GAP } from './effects'

describe('smoke and fire blobs', () => {
  it('shrink away from the eye so a blast at your feet never fills the whole screen', () => {
    expect(clearOfEye(3, 10)).toBe(3)
    expect(clearOfEye(3, 1)).toBeCloseTo((1 - EYE_GAP) * 2, 6)
    expect(clearOfEye(3, 0.2)).toBeLessThan(0.001)
    for (const distance of [0.6, 1, 1.5, 2]) expect(clearOfEye(5, distance) / 2).toBeLessThanOrEqual(distance - EYE_GAP + 1e-9)
  })

  it('pop out fast, hold their size and shrink away instead of fading', () => {
    expect(blobScale(-0.1, 1, 0.2, 0.4)).toBe(0)
    expect(blobScale(0.1, 1, 0.2, 0.4)).toBeGreaterThan(0.8)
    expect(blobScale(0.2, 1, 0.2, 0.4)).toBeCloseTo(1, 6)
    expect(blobScale(0.5, 1, 0.2, 0.4)).toBe(1)
    expect(blobScale(0.8, 1, 0.2, 0.4)).toBeCloseTo(0.5, 6)
    expect(blobScale(1, 1, 0.2, 0.4)).toBe(0)
  })
})

describe('chapter 1 look', () => {
  it('keeps the sun low so shadows run long, between 20 and 35 degrees up', () => {
    const { sunDirection } = CHAPTER_1_LOOK
    expect(sunDirection.length()).toBeCloseTo(1, 6)
    const elevation = (Math.asin(sunDirection.y) * 180) / Math.PI
    expect(elevation).toBeGreaterThan(20)
    expect(elevation).toBeLessThan(35)
  })
})
