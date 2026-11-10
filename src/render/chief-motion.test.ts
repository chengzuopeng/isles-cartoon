import { describe, expect, it } from 'vitest'
import { getBoss } from '../data/bosses'
import { LEVEL_1_2 } from '../data/levels/level-1-2'
import { TRAINING } from '../data/levels/training'
import { createDefaultTuning } from '../data/tuning'
import { buildLevel } from '../sim/level'
import type { BossState } from '../sim/types'
import { createBoss, createWorld } from '../sim/world'
import {
  cannonBrace,
  cannonGlow,
  chiefDefeatSeconds,
  chiefFall,
  firstShown,
  handShown,
  heelShift,
  laneLength,
  laySpot,
  layStart,
  rackShown,
  stripStart,
  throwPose,
} from './chief-motion'
import { CHIEF_DEFEAT, CHIEF_RIG } from './themes'

const def = getBoss('demo-chief')
const tuning = createDefaultTuning()
const MAX_RAISE = (120 * Math.PI) / 180

function state(patch: Partial<BossState> = {}): BossState {
  const world = createWorld(buildLevel(TRAINING), tuning)
  const boss = createBoss(world, 'demo-chief', { x: 0, y: 0 }, 0).boss
  if (!boss) throw new Error('no boss state')
  return Object.assign(boss, patch)
}

describe('demolition chief motion', () => {
  it('empties the rack from the right end and fills it back from the left', () => {
    const shown = (bombs: number) => [1, 2, 3, 4, 5, 6, 7, 8].map((slot) => rackShown(slot, bombs, 8))
    expect(shown(8)).toEqual([true, true, true, true, true, true, true, true])
    expect(shown(5)).toEqual([false, false, false, true, true, true, true, true])
    expect(shown(0).some(Boolean)).toBe(false)
    expect(shown(11).every(Boolean)).toBe(true)
    expect(firstShown(8, 8)).toBe(0)
    expect(firstShown(5, 8)).toBe(3)
    expect(firstShown(0, 8)).toBe(8)
    expect(firstShown(12, 8)).toBe(0)
    expect(stripStart([0, 10, 20, 30], 40, 2)).toBe(20)
    expect(stripStart([0, 10, 20, 30], 40, 4)).toBe(40)
  })

  it('hides the bomb in the hand right after a throw and brings it back later', () => {
    expect(handShown(-Infinity)).toBe(true)
    expect(handShown(Infinity)).toBe(true)
    expect(handShown(0)).toBe(false)
    expect(handShown(CHIEF_RIG.rehide - 0.01)).toBe(false)
    expect(handShown(CHIEF_RIG.rehide)).toBe(true)
  })

  it('winds the right arm up during the toss telegraph without going past 120 degrees', () => {
    const windup = def.bales?.windup ?? 0
    const start = throwPose(def, state({ move: 'bales', phase: 'telegraph', timer: windup }), Infinity)
    const half = throwPose(def, state({ move: 'bales', phase: 'telegraph', timer: windup / 2 }), Infinity)
    const ready = throwPose(def, state({ move: 'bales', phase: 'telegraph', timer: 0 }), Infinity)
    expect(start.raise).toBeCloseTo(0, 5)
    expect(half.raise).toBeGreaterThan(0.3)
    expect(ready.raise).toBeCloseTo(CHIEF_RIG.raise, 5)
    expect(CHIEF_RIG.raise).toBeLessThanOrEqual(MAX_RAISE)
    expect(throwPose(def, state({ move: 'cannon', phase: 'telegraph', timer: 0 }), Infinity).raise).toBe(0)
  })

  it('snaps the arm forward on each release and winds up again while bombs are left', () => {
    const interval = def.bales?.interval ?? 0
    const active = (balesLeft: number) => state({ move: 'bales', phase: 'active', balesLeft })
    expect(throwPose(def, active(3), Infinity).raise).toBeCloseTo(CHIEF_RIG.raise, 5)
    expect(throwPose(def, active(2), 0).raise).toBeCloseTo(CHIEF_RIG.raise, 5)
    const released = throwPose(def, active(2), CHIEF_RIG.snap)
    expect(released.raise).toBeCloseTo(CHIEF_RIG.follow, 5)
    expect(throwPose(def, active(2), CHIEF_RIG.snap / 2).lean).toBeGreaterThan(0)
    expect(throwPose(def, active(2), interval).raise).toBeCloseTo(CHIEF_RIG.raise, 5)
    expect(throwPose(def, active(0), interval).raise).toBeCloseTo(CHIEF_RIG.follow, 5)
    const recover = def.bales?.recover ?? 1
    expect(throwPose(def, state({ move: 'bales', phase: 'recover', timer: recover / 2 }), interval).raise).toBeCloseTo(CHIEF_RIG.follow / 2, 5)
    for (let t = -0.1; t < 1; t += 0.01) {
      const pose = throwPose(def, active(1), t)
      expect(pose.raise).toBeLessThanOrEqual(MAX_RAISE)
      expect(pose.raise).toBeGreaterThanOrEqual(0)
    }
  })

  it('heats the cannon bore through the red-line telegraph and braces while firing', () => {
    const telegraph = def.cannon?.telegraph ?? 0
    const early = state({ move: 'cannon', phase: 'telegraph', timer: telegraph })
    const late = state({ move: 'cannon', phase: 'telegraph', timer: 0 })
    const firing = state({ move: 'cannon', phase: 'active' })
    expect(cannonGlow(def, early, tuning.weapons)).toBeCloseTo(1, 5)
    expect(cannonGlow(def, late, tuning.weapons)).toBeCloseTo(CHIEF_RIG.boreGlow, 5)
    expect(cannonGlow(def, firing, tuning.weapons)).toBe(CHIEF_RIG.boreGlow)
    expect(cannonGlow(def, state({ move: 'bales', phase: 'active' }), tuning.weapons)).toBe(1)
    expect(cannonGlow(def, state({ move: 'bales', phase: 'recover' }), tuning.weapons)).toBe(CHIEF_RIG.boreGlow)
    expect(cannonGlow(def, state({ move: 'cannon', phase: 'recover', timer: 0 }), tuning.weapons)).toBe(CHIEF_RIG.boreGlow)
    expect(cannonGlow(def, state({ move: null, phase: 'stunned' }), tuning.weapons)).toBe(CHIEF_RIG.boreGlow)
    expect(cannonGlow(def, state({ move: null, phase: 'walk' }), tuning.weapons)).toBe(1)
    expect(cannonBrace(def, firing, tuning.weapons)).toBe(1)
    expect(cannonBrace(def, state({ phase: 'walk', move: null }), tuning.weapons)).toBe(0)
  })

  it('lays every bomb within the lay time in a row in front and then falls over backwards', () => {
    const show = def.show
    if (!show) throw new Error('demo-chief has no defeat show')
    const count = 8
    const spots = Array.from({ length: count }, (_, index) => laySpot(index, count))
    expect(spots.every((spot) => spot.forward === CHIEF_DEFEAT.bombForward)).toBe(true)
    expect(spots[0].side).toBeCloseTo(-spots[count - 1].side, 6)
    const starts = Array.from({ length: count }, (_, index) => layStart(index, count, show))
    for (let i = 1; i < count; i++) expect(starts[i]).toBeGreaterThan(starts[i - 1])
    expect(starts[count - 1] + CHIEF_DEFEAT.bombFlight).toBeLessThanOrEqual(show.lay + CHIEF_DEFEAT.bombFlight)
    expect(chiefFall(show.lay * 0.5, show, count).angle).toBe(0)
    expect(chiefFall(show.lay + show.fall, show, count).angle).toBeCloseTo(CHIEF_DEFEAT.fallAngle, 5)
    expect(chiefFall(show.lay * 0.5, show, count).light).toBe(1)
    expect(chiefFall(show.lay + CHIEF_DEFEAT.eyeFade, show, count).light).toBe(0)
    const total = chiefDefeatSeconds(show)
    expect(total).toBeCloseTo(show.lay + show.fall + CHIEF_DEFEAT.lie + CHIEF_DEFEAT.fade, 6)
    expect(chiefFall(total - CHIEF_DEFEAT.fade - 0.01, show, count).fade).toBe(1)
    expect(chiefFall(total, show, count).fade).toBeCloseTo(0, 6)
  })

  it('tips over the heel so the feet never sink into the floor', () => {
    const rest = heelShift(0, CHIEF_DEFEAT.heel)
    expect(rest.x).toBeCloseTo(0, 9)
    expect(rest.y).toBeCloseTo(0, 9)
    const tipped = heelShift(CHIEF_DEFEAT.fallAngle, CHIEF_DEFEAT.heel)
    expect(tipped.x).toBeLessThan(0)
    expect(tipped.y).toBeGreaterThan(0)
  })

  it('stops the cannon red line at the first wall or pillar', () => {
    const level = buildLevel(LEVEL_1_2)
    const arena = level.areas.find((area) => area.kind === 'boss')
    if (!arena) throw new Error('no boss arena')
    const y = arena.top + 9.5
    expect(laneLength(level.grid, 20.5, y, Math.PI, 30)).toBeCloseTo(20.5 - 4, 0)
    expect(laneLength(level.grid, 20.5, y, 0, 6)).toBe(6)
    const pillar = level.landmarks.find((item) => item.id === 'ch1-hay-pillar')
    if (!pillar) throw new Error('no pillar')
    const toward = laneLength(level.grid, pillar.column + 1, pillar.row - 3, Math.PI / 2, 10)
    expect(toward).toBeCloseTo(3, 0)
  })
})
