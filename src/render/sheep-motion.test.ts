import { describe, expect, it } from 'vitest'
import { SHEEP_LEGS, bodyBob, headPitch, legSwing, turnToward } from './sheep-motion'
import { SHEEP_RIG } from './themes'

const LIMIT = (25 * Math.PI) / 180 + 1e-9
const HEAD_DOWN = (-26 * Math.PI) / 180 - 1e-9

describe('sheep motion', () => {
  it('swings diagonal legs together, the other pair against them, within 25 degrees', () => {
    for (let phase = 0; phase < Math.PI * 2; phase += 0.1) {
      expect(legSwing('leg_fl', phase, 1)).toBeCloseTo(legSwing('leg_rr', phase, 1), 9)
      expect(legSwing('leg_fr', phase, 1)).toBeCloseTo(-legSwing('leg_fl', phase, 1), 9)
      for (const leg of SHEEP_LEGS) expect(Math.abs(legSwing(leg, phase, 1))).toBeLessThanOrEqual(LIMIT)
    }
    expect(legSwing('leg_fl', Math.PI / 2, 1)).toBeCloseTo(SHEEP_RIG.legSwing, 9)
    expect(legSwing('leg_fl', Math.PI / 2, 0)).toBe(0)
  })

  it('drops the head to eat while grazing and keeps it up in the pen or on the way', () => {
    for (let time = 0; time < 5; time += 0.25) {
      const grazing = headPitch('grazing', 0, 0, time, 3)
      expect(grazing).toBeLessThan(-0.3)
      expect(grazing).toBeGreaterThanOrEqual(HEAD_DOWN)
      expect(Math.abs(headPitch('penned', 0, 0, time, 3))).toBeLessThanOrEqual(SHEEP_RIG.idleNod + 1e-9)
      expect(Math.abs(headPitch('leaving', 1, time * 4, time, 3))).toBeLessThanOrEqual(SHEEP_RIG.walkNod + 1e-9)
    }
  })

  it('bobs only while walking', () => {
    expect(bodyBob(1.2, 0)).toBe(0)
    expect(bodyBob(Math.PI / 2, 1)).toBeCloseTo(SHEEP_RIG.bob, 9)
  })

  it('turns the short way round toward the walking direction', () => {
    const turned = turnToward(Math.PI - 0.1, -Math.PI + 0.1, 100, 1)
    expect(Math.abs(turned - (Math.PI + 0.1))).toBeLessThan(1e-6)
    expect(turnToward(0, 1, 0, 1)).toBe(0)
    expect(turnToward(0.5, 0.5, 5, 0.1)).toBeCloseTo(0.5, 9)
  })
})
