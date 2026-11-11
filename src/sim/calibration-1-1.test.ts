import { beforeAll, describe, expect, it } from 'vitest'
import { AUTOPILOT_SKILL_ORDER } from '../data/autopilot'
import { LEVEL_1_1 } from '../data/levels/level-1-1'
import { averageOf, clearsOf, play, SEEDS, summarize, table, type Run } from './calibration-runs'
import { createLoadout } from './stats'

describe('calibrating level 1-1 with human-like autopilots', () => {
  let runs: Run[] = []

  beforeAll(() => {
    runs = AUTOPILOT_SKILL_ORDER.flatMap((skill) => SEEDS.map((seed) => play(LEVEL_1_1, skill, seed, createLoadout())))
    console.table(table(runs))
    console.table(summarize(runs))
  }, 120_000)

  it('is cleared by the perfect autopilot every time and by the human one almost every time, the novice taking the most hits', () => {
    expect(clearsOf(runs, 'perfect')).toBe(SEEDS.length)
    expect(clearsOf(runs, 'human')).toBeGreaterThanOrEqual(8)
    expect(clearsOf(runs, 'novice')).toBeLessThanOrEqual(clearsOf(runs, 'human'))
    expect(averageOf(runs, 'novice', (run) => run.hits)).toBeGreaterThan(averageOf(runs, 'human', (run) => run.hits) * 2)
  })

  it('misses more shots and takes more damage as the skill drops', () => {
    expect(averageOf(runs, 'human', (run) => run.accuracy)).toBeLessThan(averageOf(runs, 'perfect', (run) => run.accuracy))
    expect(averageOf(runs, 'novice', (run) => run.accuracy)).toBeLessThan(averageOf(runs, 'human', (run) => run.accuracy))
    const perSecond = (run: Run) => run.taken / Math.max(1, run.time)
    expect(averageOf(runs, 'human', perSecond)).toBeGreaterThan(averageOf(runs, 'perfect', perSecond))
  })

  it('jumps, dashes and smashes chargers on every skill level', () => {
    for (const skill of AUTOPILOT_SKILL_ORDER) {
      expect(averageOf(runs, skill, (run) => run.jumps), skill).toBeGreaterThan(1)
      expect(averageOf(runs, skill, (run) => run.dashes), skill).toBeGreaterThan(skill === 'perfect' ? 0.5 : 1)
      expect(averageOf(runs, skill, (run) => run.smashes), skill).toBeGreaterThan(0.5)
    }
  })

  it('names the attack behind every death', () => {
    for (const run of runs.filter((item) => item.status === 'dead')) expect(run.killedBy).not.toBe('')
  })
})
