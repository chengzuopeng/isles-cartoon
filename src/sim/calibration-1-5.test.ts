import { beforeAll, describe, expect, it } from 'vitest'
import { AUTOPILOT_SKILL_ORDER } from '../data/autopilot'
import { LEVEL_1_5 } from '../data/levels/level-1-5'
import { createDefaultTuning } from '../data/tuning'
import { createAutopilot } from './autopilot'
import { afterTrail, averageOf, clearsOf, DT, harvestSummary, LIMIT_SECONDS, playHarvest, SEEDS, table, type HarvestRun } from './calibration-runs'
import { buildLevel } from './level'
import { stepWorld } from './step'
import { createWorld } from './world'

describe('level 1-5 from start to finish', () => {
  it('waits out the blades, threads the bale maze, rides the belts, beats the harvester and walks out', () => {
    const level = buildLevel(LEVEL_1_5)
    const world = createWorld(level, createDefaultTuning(), { debug: { invincible: true }, loadout: afterTrail() })
    const pilot = createAutopilot({ siege: true, onward: true, kite: true })
    const entered: string[] = []
    const seen = new Set<string>()
    const barks = new Set<string>()
    let story = false
    let rode = 0
    for (let step = 0; step < LIMIT_SECONDS / DT && world.status === 'playing'; step++) {
      stepWorld(world, pilot.next(world), DT)
      if (world.areaIndex === 2 && world.conveyors.has(Math.floor(world.player.pos.y) * level.grid.columns + Math.floor(world.player.pos.x))) rode += DT
      for (const event of world.events) {
        seen.add(event.type)
        if (event.type === 'areaEntered') entered.push(event.name)
        if (event.type === 'bark') barks.add(event.id)
        if (event.type === 'bossIntro') story = event.story === true
        expect(event.type === 'bladeHit' && event.id === world.player.id).toBe(false)
      }
      world.events.length = 0
    }
    expect(entered).toEqual(LEVEL_1_5.areas.map((area) => area.name))
    for (const type of ['bladeWarning', 'bladeSweep', 'bladeParked', 'bossIntro', 'bossPhase', 'bossSummon', 'bossDefeated']) expect(seen.has(type), type).toBe(true)
    for (const id of ['redLine', 'crown', 'belts', 'gate']) expect(barks.has(id), id).toBe(true)
    expect(story).toBe(true)
    expect(rode).toBeGreaterThan(0)
    expect(world.stats.elites).toBeGreaterThanOrEqual(2)
    expect(world.boss?.hp).toBe(0)
    expect(world.status).toBe('complete')
  })
})

describe('calibrating level 1-5 with human-like autopilots', () => {
  let runs: HarvestRun[] = []

  beforeAll(() => {
    runs = AUTOPILOT_SKILL_ORDER.flatMap((skill) => SEEDS.map((seed) => playHarvest(skill, seed)))
    console.table(table(runs).map(({ areaTimes, areaHits, enterHp, ...run }) => ({ ...run, areas: areaTimes.join('/'), areaHits: areaHits.join('/'), bossHp: enterHp[4] })))
    console.table(harvestSummary(runs))
  }, 300_000)

  it('keeps the clear rates measured in first person', () => {
    expect(clearsOf(runs, 'perfect')).toBe(SEEDS.length)
    expect(clearsOf(runs, 'human')).toBeGreaterThanOrEqual(8)
    expect(clearsOf(runs, 'novice')).toBeGreaterThanOrEqual(1)
  })

  it('takes more hits as the skill drops and keeps the harvester a long fight', () => {
    expect(averageOf(runs, 'human', (run) => run.hits)).toBeGreaterThan(averageOf(runs, 'perfect', (run) => run.hits))
    expect(averageOf(runs, 'novice', (run) => run.hits)).toBeGreaterThan(averageOf(runs, 'human', (run) => run.hits))
    const fights = runs.filter((run) => run.status === 'complete').map((run) => run.boss)
    expect(fights.reduce((sum, time) => sum + time, 0) / fights.length).toBeGreaterThanOrEqual(45)
  })

  it('never lets the perfect autopilot walk into a blade, and the novice only misreads one now and then', () => {
    expect(averageOf(runs, 'perfect', (run) => run.bladeHits)).toBeLessThanOrEqual(0.2)
    expect(averageOf(runs, 'novice', (run) => run.bladeHits)).toBeGreaterThan(0)
    expect(averageOf(runs, 'novice', (run) => run.bladeHits)).toBeLessThan(2)
  })

  it('names the attack behind every death', () => {
    for (const run of runs.filter((item) => item.status === 'dead')) expect(run.killedBy).not.toBe('')
    expect(runs.filter((run) => run.status === 'playing')).toEqual([])
  })
})
