import { beforeAll, describe, expect, it } from 'vitest'
import { AUTOPILOT_SKILL_ORDER } from '../data/autopilot'
import { LEVEL_1_2 } from '../data/levels/level-1-2'
import { createDefaultTuning } from '../data/tuning'
import { createAutopilot } from './autopilot'
import { averageOf, clearsOf, DT, LIMIT_SECONDS, play, SEEDS, summarize, table, type Run } from './calibration-runs'
import { buildLevel } from './level'
import { stepWorld } from './step'
import { createLoadout } from './stats'
import { createWorld } from './world'

describe('level 1-2 from start to finish', () => {
  it('breaks the three carts, beats the demolition chief and walks out', () => {
    const level = buildLevel(LEVEL_1_2)
    const world = createWorld(level, createDefaultTuning(), { debug: { invincible: true }, loadout: createLoadout({ health: 1 }) })
    const pilot = createAutopilot()
    const entered: string[] = []
    const broken: string[] = []
    let opened = -1
    for (let step = 0; step < LIMIT_SECONDS / DT && world.status === 'playing'; step++) {
      stepWorld(world, pilot.next(world), DT)
      for (const event of world.events) {
        if (event.type === 'areaEntered') entered.push(event.name)
        if (event.type === 'landmarkBroken' && event.id === 'ch1-hay-cart') broken.push(event.id)
        if (event.type === 'areaCleared' && event.index === 2) opened = broken.length
      }
      world.events.length = 0
    }
    expect(entered).toEqual(LEVEL_1_2.areas.map((area) => area.name))
    expect(broken).toHaveLength(3)
    expect(opened).toBe(3)
    expect(world.clues.map((drop) => drop.clue)).toEqual(['iou'])
    expect(world.boss?.hp).toBe(0)
    expect(world.status).toBe('complete')
  })
})

describe('calibrating level 1-2 with human-like autopilots', () => {
  let runs: Run[] = []

  beforeAll(() => {
    runs = AUTOPILOT_SKILL_ORDER.flatMap((skill) => SEEDS.map((seed) => play(LEVEL_1_2, skill, seed, createLoadout({ health: 1 }))))
    console.table(table(runs))
    console.table(summarize(runs))
  }, 240_000)

  it('keeps the clear rates measured in first person', () => {
    expect(clearsOf(runs, 'perfect')).toBe(SEEDS.length)
    expect(clearsOf(runs, 'human')).toBeGreaterThanOrEqual(7)
    expect(averageOf(runs, 'novice', (run) => run.hits)).toBeGreaterThan(averageOf(runs, 'human', (run) => run.hits))
  })

  it('takes longer and costs more hits than the tutorial', () => {
    expect(averageOf(runs, 'human', (run) => run.time)).toBeGreaterThan(80)
    expect(averageOf(runs, 'novice', (run) => run.hits)).toBeGreaterThan(averageOf(runs, 'perfect', (run) => run.hits))
  })

  it('names the attack behind every death', () => {
    for (const run of runs.filter((item) => item.status === 'dead')) expect(run.killedBy).not.toBe('')
  })
})
