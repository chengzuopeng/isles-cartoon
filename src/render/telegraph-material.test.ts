import { describe, expect, it } from 'vitest'
import { advanceHatch, HATCH_TIME, hatchedMaterial, TELEGRAPH_HATCH } from './telegraph-material'

describe('hatched telegraph material', () => {
  it('is see-through and stays out of the depth buffer', () => {
    const material = hatchedMaterial({ color: '#ff3b30', ...TELEGRAPH_HATCH.area, edge: 'disc' })
    expect(material.transparent).toBe(true)
    expect(material.depthWrite).toBe(false)
    expect(material.opacity).toBe(TELEGRAPH_HATCH.area.opacity)
  })

  it('outlines discs and lanes with different programs', () => {
    const disc = hatchedMaterial({ color: '#ff3b30', ...TELEGRAPH_HATCH.fill, edge: 'disc' })
    const lane = hatchedMaterial({ color: '#ff3b30', ...TELEGRAPH_HATCH.fill, edge: 'lane' })
    expect(disc.defines).toHaveProperty('HATCH_DISC')
    expect(lane.defines).toHaveProperty('HATCH_LANE')
    expect(disc.customProgramCacheKey()).not.toBe(lane.customProgramCacheKey())
  })

  it('keeps the stripes thinner than their gaps leave room for', () => {
    expect(TELEGRAPH_HATCH.width).toBeLessThan(1)
    expect(TELEGRAPH_HATCH.area.gap).toBeLessThan(1)
    expect(TELEGRAPH_HATCH.fill.opacity).toBeGreaterThan(TELEGRAPH_HATCH.area.opacity)
  })

  it('moves the stripes forward over time', () => {
    const before = HATCH_TIME.value
    advanceHatch(0.5)
    expect(HATCH_TIME.value).toBeCloseTo(before + 0.5 * TELEGRAPH_HATCH.speed, 6)
  })
})
