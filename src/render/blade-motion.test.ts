import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { LEVEL_1_5 } from '../data/levels/level-1-5'
import { alongOf } from '../sim/blades'
import { buildLevel } from '../sim/level'
import {
  bladeShake,
  bladeYaw,
  easeSpin,
  laneEdges,
  normalizedSpan,
  reelSpeed,
  sweepDirection,
  turnDelta,
  turnPose,
  warningSpan,
  type WarningSpan,
} from './blade-motion'
import { BLADE_RIG } from './themes'

const level = buildLevel(LEVEL_1_5)
const [south, middle] = level.blades

function expectSpan(actual: WarningSpan | null, expected: WarningSpan): void {
  expect(actual).not.toBeNull()
  expect(actual?.from).toBeCloseTo(expected.from, 6)
  expect(actual?.to).toBeCloseTo(expected.to, 6)
  expect(actual?.head).toBeCloseTo(expected.head, 6)
}

describe('blade lanes on the ground', () => {
  it('measures each 1-5 lane along its sweep and knows which way the next trip goes', () => {
    expect(laneEdges(south)).toEqual({ low: 1, high: 39, length: 38 })
    expect(laneEdges(middle)).toEqual({ low: 1, high: 39, length: 38 })
    expect(sweepDirection(south, true)).toBe(1)
    expect(sweepDirection(south, false)).toBe(-1)
    expect(sweepDirection(middle, true)).toBe(-1)
  })

  it('fills the lane from the parked blade towards the far end while it warns', () => {
    const west = alongOf(south, south.from)
    expect(warningSpan(south, { phase: 'rest', warning: 0, forward: true }, west)).toBeNull()
    expectSpan(warningSpan(south, { phase: 'warning', warning: south.warning / 2, forward: true }, west), { from: 1, to: 20, head: 20 })
    expectSpan(warningSpan(south, { phase: 'warning', warning: 0, forward: true }, west), { from: 1, to: 39, head: 39 })
    const east = alongOf(middle, middle.from)
    expectSpan(warningSpan(middle, { phase: 'warning', warning: middle.warning * 0.75, forward: true }, east), { from: 29.5, to: 39, head: 29.5 })
  })

  it('keeps only the part ahead of a sweeping blade lit, so the red line follows it out', () => {
    expectSpan(warningSpan(south, { phase: 'sweep', warning: 0, forward: true }, 10), { from: 10.5, to: 39, head: 10.5 })
    expectSpan(warningSpan(middle, { phase: 'sweep', warning: 0, forward: true }, 10), { from: 1, to: 9.5, head: 9.5 })
    expect(warningSpan(south, { phase: 'sweep', warning: 0, forward: true }, 38.5)).toBeNull()
    expect(normalizedSpan(south, { from: 1, to: 20, head: 20 })).toEqual({ from: 0, to: 0.5, head: 0.5 })
  })
})

describe('blade turning at the end of a lane', () => {
  it('turns a parked blade round through the side that faces the camera', () => {
    expect(turnDelta(0, Math.PI)).toBeCloseTo(Math.PI)
    expect(turnDelta(Math.PI, 0)).toBeCloseTo(-Math.PI)
    expect(Math.sin(turnDelta(0, Math.PI) / 2)).toBeCloseTo(1)
    expect(Math.sin(Math.PI + turnDelta(Math.PI, 0) / 2)).toBeCloseTo(1)
    expect(Math.cos(Math.PI / 2 + turnDelta(Math.PI / 2, -Math.PI / 2) / 2)).toBeCloseTo(1)
    expect(turnDelta(0, 0.3)).toBeCloseTo(0.3)
  })

  it('steps the blade away from the end wall while it turns, so its long side never reaches into the wall', () => {
    const turn = { from: 0, delta: Math.PI, start: 2 }
    expect(turnPose(turn, 2, 0.5, 1, 0.5)).toEqual({ angle: 0, shift: 0, done: false })
    const halfway = turnPose(turn, 2.25, 0.5, 1, 0.5)
    expect(halfway.angle).toBeCloseTo(Math.PI / 2)
    expect(halfway.shift).toBeCloseTo(0.5)
    const end = turnPose(turn, 2.5, 0.5, 1, 0.5)
    expect(end.angle).toBeCloseTo(Math.PI)
    expect(end.shift).toBeCloseTo(0)
    expect(end.done).toBe(true)
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const pose = turnPose(turn, 2 + t * 0.5, 0.5, 1, 0.5)
      const along = 0.5 * Math.abs(Math.cos(pose.angle)) + Math.abs(Math.sin(pose.angle))
      expect(along - pose.shift).toBeCloseTo(0.5)
    }
  })

  it('points the model front (+X) along the direction the blade travels', () => {
    const front = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), bladeYaw(Math.PI / 2))
    expect(front.x).toBeCloseTo(0)
    expect(front.z).toBeCloseTo(1)
    const west = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), bladeYaw(Math.PI))
    expect(west.x).toBeCloseTo(-1)
  })
})

describe('blade reel and engine', () => {
  it('spins the reel slowly while parked, faster while warning and fastest while sweeping, easing between them', () => {
    expect(reelSpeed('rest')).toBeLessThan(reelSpeed('warning'))
    expect(reelSpeed('warning')).toBeLessThan(reelSpeed('sweep'))
    let spin = reelSpeed('rest')
    spin = easeSpin(spin, reelSpeed('sweep'), 1 / 60)
    expect(spin).toBeGreaterThan(reelSpeed('rest'))
    expect(spin).toBeLessThan(reelSpeed('warning'))
    for (let i = 0; i < 120; i++) spin = easeSpin(spin, reelSpeed('sweep'), 1 / 60)
    expect(spin).toBeCloseTo(reelSpeed('sweep'), 1)
  })

  it('only rumbles while warning or sweeping, by a few centimetres', () => {
    expect(bladeShake('rest', 1.3, 0)).toBe(0)
    let biggest = 0
    for (let t = 0; t < 2; t += 0.01) biggest = Math.max(biggest, Math.abs(bladeShake('sweep', t, 1)))
    expect(biggest).toBeGreaterThan(0)
    expect(biggest).toBeLessThanOrEqual(BLADE_RIG.shake.sweep)
  })
})
