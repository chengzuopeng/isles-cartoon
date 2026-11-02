import { beforeAll, describe, expect, it } from 'vitest'
import { AUTOPILOT_SKILL_ORDER } from '../data/autopilot'
import { getBoss } from '../data/bosses'
import { LEVEL_1_4 } from '../data/levels/level-1-4'
import { createDefaultTuning } from '../data/tuning'
import { createAutopilot } from './autopilot'
import { afterFarm, averageOf, clearsOf, DT, LIMIT_SECONDS, playTrail, SEEDS, table, trailSummary, type TrailRun } from './calibration-runs'
import { buildLevel } from './level'
import { stepWorld } from './step'
import { createWorld } from './world'

describe('level 1-4 from start to finish', () => {
  it('follows the signal through the fog, lights the lamps on its way, beats the forest tank in the clearing and walks out', () => {
    const level = buildLevel(LEVEL_1_4)
    const world = createWorld(level, createDefaultTuning(), { debug: { invincible: true }, loadout: afterFarm() })
    const pilot = createAutopilot()
    const entered: string[] = []
    const seen = new Set<string>()
    let defeatedAt = -1
    let openedAt = -1
    for (let step = 0; step < LIMIT_SECONDS / DT && world.status === 'playing'; step++) {
      stepWorld(world, pilot.next(world), DT)
      for (const event of world.events) {
        seen.add(event.type)
        if (event.type === 'areaEntered') entered.push(event.name)
        if (event.type === 'bossDefeated') defeatedAt = world.time
        if (event.type === 'areaCleared' && event.index === 4) openedAt = world.time
      }
      world.events.length = 0
    }
    expect(entered).toEqual(LEVEL_1_4.areas.map((area) => area.name))
    for (const type of ['lampLit', 'tankShot', 'mineLaid', 'bossStunned', 'landmarkCrashed', 'bossSummon', 'bossDefeated', 'secretFound']) {
      expect(seen.has(type), type).toBe(true)
    }
    expect(world.lamps.filter(Boolean).length).toBeGreaterThanOrEqual(2)
    expect(world.chests.filter((chest) => chest.opened).length).toBeGreaterThanOrEqual(2)
    expect(openedAt - defeatedAt).toBeGreaterThanOrEqual(getBoss('forest-tank').retreat - 0.05)
    expect(world.boss?.hp).toBe(0)
    expect(world.status).toBe('complete')
  })
})

describe('calibrating level 1-4 with human-like autopilots', () => {
  let runs: TrailRun[] = []

  beforeAll(() => {
    runs = AUTOPILOT_SKILL_ORDER.flatMap((skill) => SEEDS.map((seed) => playTrail(skill, seed)))
    console.table(table(runs))
    console.table(trailSummary(runs))
  }, 300_000)

  it('keeps the clear rates measured in first person', () => {
    expect(clearsOf(runs, 'perfect')).toBe(SEEDS.length)
    expect(clearsOf(runs, 'human')).toBeGreaterThanOrEqual(8)
    expect(clearsOf(runs, 'novice')).toBeGreaterThanOrEqual(1)
  })

  it('takes more hits as the skill drops and keeps the tank fight in the mini boss range', () => {
    expect(averageOf(runs, 'human', (run) => run.hits)).toBeGreaterThan(averageOf(runs, 'perfect', (run) => run.hits))
    expect(averageOf(runs, 'novice', (run) => run.hits)).toBeGreaterThan(averageOf(runs, 'human', (run) => run.hits))
    const fights = runs.filter((run) => run.status === 'complete').map((run) => run.boss)
    expect(fights.reduce((sum, time) => sum + time, 0) / fights.length).toBeGreaterThanOrEqual(20)
  })

  it('names the attack behind every death', () => {
    for (const run of runs.filter((item) => item.status === 'dead')) expect(run.killedBy).not.toBe('')
  })
})
