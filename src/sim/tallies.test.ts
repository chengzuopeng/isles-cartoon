import { describe, expect, it } from 'vitest'
import { LEVEL_1_1 } from '../data/levels/level-1-1'
import { LEVEL_1_2 } from '../data/levels/level-1-2'
import { LEVEL_1_3 } from '../data/levels/level-1-3'
import { createDefaultTuning } from '../data/tuning'
import { breakTargets, openPens } from './cheats'
import { breakLandmark, targetTally } from './landmark-state'
import { buildLevel } from './level'
import { openPen } from './sheep'
import { stepWorld } from './step'
import { runTallies } from './tallies'
import { createWorld } from './world'

describe('optional goals and run tallies', () => {
  it('counts what 1-2 has to offer: three chests, four sheep, one clue, one hidden area, three carts', () => {
    const world = createWorld(buildLevel(LEVEL_1_2), createDefaultTuning())
    expect(runTallies(world)).toEqual({
      chests: { done: 0, total: 3 },
      sheep: { done: 0, total: 4 },
      clues: { done: 0, total: 1 },
      secrets: { done: 0, total: 1 },
      targets: { done: 0, total: 3 },
      alarms: { done: 0, total: 0 },
      lamps: { done: 0, total: 0 },
      elites: { done: 0, total: 0 },
    })
  })

  it('moves with what the player does', () => {
    const level = buildLevel(LEVEL_1_2)
    const world = createWorld(level, createDefaultTuning())
    const pens = level.landmarks.flatMap((landmark, index) => (landmark.id === 'ch1-sheep-pen' ? [index] : []))
    const carts = level.landmarks.flatMap((landmark, index) => (landmark.id === 'ch1-hay-cart' ? [index] : []))
    openPen(world, pens[0])
    openPen(world, pens[1])
    openPen(world, pens[1])
    breakLandmark(world, carts[2])
    world.chests[0].opened = true
    world.cluesFound.push('iou')
    const tallies = runTallies(world)
    expect(tallies.sheep).toEqual({ done: 2, total: 4 })
    expect(tallies.targets).toEqual({ done: 1, total: 3 })
    expect(targetTally(world, 2)).toEqual({ done: 1, total: 3 })
    expect(targetTally(world, 1)).toEqual({ done: 0, total: 0 })
    expect(tallies.chests).toEqual({ done: 1, total: 3 })
    expect(tallies.clues).toEqual({ done: 1, total: 1 })
  })

  it('gives 1-1 its altar clue and hidden area too, and nothing to herd or break', () => {
    const world = createWorld(buildLevel(LEVEL_1_1), createDefaultTuning())
    expect(runTallies(world)).toEqual({
      chests: { done: 0, total: 4 },
      sheep: { done: 0, total: 0 },
      clues: { done: 0, total: 1 },
      secrets: { done: 0, total: 1 },
      targets: { done: 0, total: 0 },
      alarms: { done: 0, total: 0 },
      lamps: { done: 0, total: 0 },
      elites: { done: 0, total: 0 },
    })
  })
})

describe('1-3 tallies', () => {
  it('counts three chests, the shipping manifest, the cellar and whether the bell stayed quiet', () => {
    const world = createWorld(buildLevel(LEVEL_1_3), createDefaultTuning())
    expect(runTallies(world)).toEqual({
      chests: { done: 0, total: 3 },
      sheep: { done: 0, total: 0 },
      clues: { done: 0, total: 1 },
      secrets: { done: 0, total: 1 },
      targets: { done: 0, total: 0 },
      alarms: { done: 1, total: 1 },
      lamps: { done: 0, total: 0 },
      elites: { done: 0, total: 0 },
    })
  })
})

describe('development shortcuts for 1-2', () => {
  it('break the carts of an area and open its pens', () => {
    const world = createWorld(buildLevel(LEVEL_1_2), createDefaultTuning())
    expect(breakTargets(world, 1)).toBe(0)
    expect(openPens(world, 1)).toBe(4)
    expect(openPens(world, 1)).toBe(0)
    expect(breakTargets(world, 2)).toBe(3)
    stepWorld(world, { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false, slot: null, interact: false, skill: null, ultimate: false, pitch: 0, jump: false, dash: false, melee: false }, 1 / 60)
    expect(world.areas[2].status).toBe('cleared')
    expect(runTallies(world).sheep).toEqual({ done: 4, total: 4 })
  })
})
