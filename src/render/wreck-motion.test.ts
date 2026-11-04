import { describe, expect, it } from 'vitest'
import { WRECK } from './themes'
import { launchWreck, stepWreck, wreckFade, wreckFlash, type Ground, type WreckSeed } from './wreck-motion'

const flat: Ground = () => 0

function settle(seeds: WreckSeed[], dirX: number, dirZ: number, ground: Ground = flat) {
  const pieces = launchWreck(seeds, { x: 0, z: 0 }, dirX, dirZ, 7)
  for (let i = 0; i < 240; i++) for (const piece of pieces) stepWreck(piece, 1 / 60, ground)
  return pieces
}

describe('enemy wreck', () => {
  const body: WreckSeed = { x: 0, y: 0.9, z: 0, rest: 0.3, heavy: true }
  const arm: WreckSeed = { x: 0.4, y: 1.1, z: 0.1, rest: 0.08, heavy: false }
  const leg: WreckSeed = { x: -0.2, y: 0.4, z: -0.1, rest: 0.1, heavy: false }

  it('throws the parts along the killing hit and the light parts farther than the body', () => {
    const [heavy, light, other] = settle([body, arm, leg], 1, 0)
    expect(heavy.x).toBeGreaterThan(0.3)
    expect(light.x).toBeGreaterThan(heavy.x)
    expect(other.x).toBeGreaterThan(0)
    expect(light.x).toBeLessThan(6.5)
  })

  it('comes to rest on the ground', () => {
    for (const piece of settle([body, arm, leg], 0, 1)) {
      expect(piece.y).toBeCloseTo(piece.rest, 6)
      expect(piece.vy).toBe(0)
      expect(Math.hypot(piece.vx, piece.vz)).toBeLessThan(0.05)
    }
  })

  it('scatters outward when the hit has no direction', () => {
    const [heavy, light, other] = settle([body, arm, leg], 0, 0)
    expect(Math.hypot(heavy.x, heavy.z)).toBeLessThan(Math.hypot(light.x, light.z))
    expect(light.x).toBeGreaterThan(0.4)
    expect(other.x).toBeLessThan(-0.2)
  })

  it('bounces off a wall instead of climbing it', () => {
    const wall: Ground = (x) => (x > 1.5 ? 3 : 0)
    for (const piece of settle([body, arm, leg], 1, 0, wall)) {
      expect(piece.x).toBeLessThanOrEqual(1.5)
      expect(piece.y).toBeLessThan(1)
    }
  })

  it('lands on the floor of a raised terrace', () => {
    const terrace: Ground = () => 1.5
    const [piece] = launchWreck([{ ...body, y: 2.4 }], { x: 0, z: 0 }, 1, 0, 3)
    for (let i = 0; i < 240; i++) stepWreck(piece, 1 / 60, terrace)
    expect(piece.y).toBeCloseTo(1.5 + piece.rest, 6)
  })

  it('stands still while frozen, flashes at first and sinks away at the end', () => {
    const [piece] = launchWreck([arm], { x: 0, z: 0 }, 1, 0, 1)
    const copy = { ...piece }
    stepWreck(piece, 0, flat)
    expect(piece).toEqual(copy)
    expect(wreckFlash(0)).toBe(1)
    expect(wreckFlash(WRECK.flash)).toBe(0)
    expect(wreckFade({ ...piece, age: 0 })).toBe(0)
    expect(wreckFade({ ...piece, age: WRECK.life - WRECK.sink / 2 })).toBeCloseTo(0.5, 6)
    expect(wreckFade({ ...piece, age: WRECK.life })).toBe(1)
  })
})
