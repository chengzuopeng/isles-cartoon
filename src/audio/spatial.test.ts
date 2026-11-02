import { describe, expect, it } from 'vitest'
import { SPATIAL, beepGap, placeSound } from './spatial'

describe('spatial sound', () => {
  const facingNorth = { x: 0, y: 0, yaw: -Math.PI / 2 }

  it('pans a sound on the right of the view to the right and one on the left to the left', () => {
    expect(placeSound(facingNorth, 5, 0).pan).toBeCloseTo(SPATIAL.panWidth)
    expect(placeSound(facingNorth, -5, 0).pan).toBeCloseTo(-SPATIAL.panWidth)
    expect(placeSound(facingNorth, 0, -5).pan).toBeCloseTo(0)
  })

  it('muffles what is behind and fades with distance, silent past the far limit', () => {
    expect(placeSound(facingNorth, 0, 8).behind).toBe(true)
    expect(placeSound(facingNorth, 0, -8).behind).toBe(false)
    expect(placeSound(facingNorth, 0, -2).level).toBeGreaterThan(placeSound(facingNorth, 0, -20).level)
    expect(placeSound(facingNorth, 0, -(SPATIAL.far + 1)).level).toBe(0)
    expect(placeSound(facingNorth, 0, -(SPATIAL.far + 1), false).level).toBe(1)
  })

  it('beeps faster as the source gets closer', () => {
    expect(beepGap(2)).toBeLessThan(beepGap(10))
    expect(beepGap(30)).toBeCloseTo(0.9)
  })
})
