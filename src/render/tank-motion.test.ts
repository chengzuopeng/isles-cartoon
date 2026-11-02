import { describe, expect, it } from 'vitest'
import { getBoss } from '../data/bosses'
import {
  barrelNode,
  easeAngle,
  lidAngle,
  lidStep,
  lidSweeping,
  mineGlow,
  mineSettle,
  mineSpark,
  mineWarning,
  muzzleNode,
  reachTime,
  recoilAmount,
  retreatAt,
  retreatDistance,
  trackOffset,
  trackTravel,
  turretAngle,
} from './tank-motion'
import { MINE_LIGHT, TANK_DEFEAT, TANK_RIG } from './themes'

const DEG = Math.PI / 180

describe('forest tank rig', () => {
  it('maps tank shots left, middle, right onto the barrels on the car left, middle and right', () => {
    expect([0, 1, 2].map((barrel) => barrelNode(barrel))).toEqual(['barrel_3', 'barrel_2', 'barrel_1'])
    expect([0, 1, 2].map((barrel) => muzzleNode(barrel))).toEqual(['socket_muzzle_3', 'socket_muzzle_2', 'socket_muzzle_1'])
    expect(getBoss('forest-tank').triple?.barrels).toBe(3)
  })

  it('kicks a barrel back fast and lets it creep forward', () => {
    expect(recoilAmount(-0.1)).toBe(0)
    expect(recoilAmount(TANK_RIG.kickIn)).toBeCloseTo(1, 6)
    expect(recoilAmount(TANK_RIG.kickIn + TANK_RIG.kickOut / 2)).toBeCloseTo(0.25, 6)
    expect(recoilAmount(TANK_RIG.kickIn + TANK_RIG.kickOut)).toBe(0)
    expect(TANK_RIG.recoil).toBeLessThanOrEqual(0.1)
  })

  it('flips the mine hatch open and shut quickly and keeps the turret off the half-open lids', () => {
    let lid = 0
    for (let i = 0; i < 20; i++) lid = lidStep(lid, true, 1 / 60)
    expect(lid).toBe(1)
    expect(lidAngle(lid)).toBeCloseTo(TANK_RIG.lidAngle, 6)
    expect(lidAngle(1)).toBeLessThanOrEqual(100 * DEG + 1e-9)
    expect(lidSweeping(0)).toBe(false)
    expect(lidSweeping(45 * DEG)).toBe(true)
    expect(lidSweeping(TANK_RIG.lidAngle)).toBe(false)
    expect(turretAngle(170 * DEG, 45 * DEG)).toBeCloseTo(120 * DEG, 6)
    expect(turretAngle(-170 * DEG, 45 * DEG)).toBeCloseTo(-120 * DEG, 6)
    expect(turretAngle(170 * DEG, 0)).toBeCloseTo(170 * DEG, 6)
    expect(turretAngle(170 * DEG, TANK_RIG.lidAngle)).toBeCloseTo(170 * DEG, 6)
    expect(turretAngle(60 * DEG, 45 * DEG)).toBeCloseTo(60 * DEG, 6)
  })

  it('rolls the tracks by distance and turns them against each other on the spot', () => {
    expect(trackTravel(1, 0)).toEqual({ left: 1, right: 1 })
    const spin = trackTravel(0, 0.5)
    expect(spin.left).toBeCloseTo(0.5 * TANK_RIG.gauge, 6)
    expect(spin.right).toBeCloseTo(-0.5 * TANK_RIG.gauge, 6)
    expect(trackOffset(0, TANK_RIG.trackPeriod / 4)).toBeCloseTo(0.75, 6)
    expect(trackOffset(0.75, -TANK_RIG.trackPeriod / 4)).toBeCloseTo(0, 6)
  })

  it('eases an angle the short way round', () => {
    const next = easeAngle(170 * DEG, -170 * DEG, 1000, 1)
    expect(Math.abs(Math.abs(next) - 170 * DEG)).toBeLessThan(1e-6)
    expect(easeAngle(0, 1, 0, 1)).toBe(0)
  })

  it('backs the defeated tank slowly to the north gate, faster once it is open, then fades out', () => {
    const from = { x: 20, y: 22 }
    const gate = { x: 20, y: 3.5 }
    const early = retreatAt(1, from, gate)
    expect(early.y).toBeCloseTo(from.y - TANK_DEFEAT.slow, 6)
    expect(early.heading).toBeCloseTo(Math.PI / 2, 6)
    expect(early.fade).toBe(1)
    expect(retreatDistance(TANK_DEFEAT.open + 1)).toBeCloseTo(TANK_DEFEAT.slow * TANK_DEFEAT.open + TANK_DEFEAT.fast, 6)
    const gone = retreatAt(TANK_DEFEAT.seconds, from, gate)
    expect(gone.fade).toBeCloseTo(0, 9)
    expect(gone.y).toBeLessThan(gate.y)
    const near = retreatAt(TANK_DEFEAT.open, { x: 20, y: 6 }, gate)
    expect(near.y).toBeLessThan(6)
    const passed = retreatAt(reachTime(2.5 + TANK_DEFEAT.beyond), { x: 20, y: 6 }, gate)
    expect(passed.y).toBeCloseTo(gate.y - TANK_DEFEAT.beyond, 6)
    expect(passed.fade).toBeLessThan(1)
    expect(TANK_DEFEAT.seconds).toBeGreaterThan(TANK_DEFEAT.open)
  })
})

describe('mines', () => {
  it('blinks slowly while quiet and fast once triggered', () => {
    const quiet = Array.from({ length: 40 }, (_, i) => mineGlow(1, -1, i / 40, MINE_LIGHT))
    const armed = Array.from({ length: 40 }, (_, i) => mineGlow(1, 0.2, i / 40, MINE_LIGHT))
    const peaks = (values: number[]) => values.filter((value, i) => i > 0 && i < values.length - 1 && value > values[i - 1] && value >= values[i + 1]).length
    expect(Math.max(...armed)).toBeGreaterThan(Math.max(...quiet))
    expect(peaks(armed)).toBeGreaterThan(peaks(quiet))
    expect(Math.min(...quiet)).toBeGreaterThanOrEqual(MINE_LIGHT.idle[0] - 1e-9)
    expect(mineGlow(0, -1, 0.25, MINE_LIGHT)).toBe(0)
  })

  it('breathes the warning ring with the slow blink and makes it solid once triggered', () => {
    const times = Array.from({ length: 80 }, (_, i) => i / 80)
    const glow = times.map((time) => mineGlow(2, -1, time, MINE_LIGHT))
    const ring = times.map((_, i) => mineWarning(2, -1, glow[i], MINE_LIGHT))
    const top = (values: number[]) => values.indexOf(Math.max(...values))
    const bottom = (values: number[]) => values.indexOf(Math.min(...values))
    expect(top(ring)).toBe(top(glow))
    expect(bottom(ring)).toBe(bottom(glow))
    expect(Math.min(...ring)).toBeCloseTo(MINE_LIGHT.ringIdle[0], 2)
    expect(Math.max(...ring)).toBeCloseTo(MINE_LIGHT.ringIdle[1], 2)
    expect(mineWarning(2, 0.2, mineGlow(2, 0.2, 0.3, MINE_LIGHT), MINE_LIGHT)).toBe(MINE_LIGHT.ringLit)
    expect(MINE_LIGHT.ringLit).toBeGreaterThan(MINE_LIGHT.ringIdle[1] * 1.5)
    expect(mineWarning(0, -1, 0, MINE_LIGHT)).toBe(0)
    expect(mineWarning(MINE_LIGHT.settle / 2, -1, MINE_LIGHT.idle[1], MINE_LIGHT)).toBeCloseTo(MINE_LIGHT.ringIdle[1] / 2, 6)
  })

  it('keeps the lamp spark readable at the bottom of the blink', () => {
    const quiet = Array.from({ length: 40 }, (_, i) => mineSpark(-1, mineGlow(2, -1, i / 40, MINE_LIGHT), MINE_LIGHT))
    expect(Math.min(...quiet)).toBeGreaterThanOrEqual(MINE_LIGHT.sparkLow)
    expect(Math.max(...quiet)).toBeCloseTo(1, 2)
    expect(mineSpark(-1, 0, MINE_LIGHT)).toBe(0)
    expect(mineSpark(0.2, MINE_LIGHT.armed[1], MINE_LIGHT)).toBe(1)
  })

  it('hops once when it lands', () => {
    expect(mineSettle(0)).toBe(0)
    expect(mineSettle(MINE_LIGHT.settle / 3)).toBeGreaterThan(0)
    expect(mineSettle(MINE_LIGHT.settle)).toBe(0)
  })
})
