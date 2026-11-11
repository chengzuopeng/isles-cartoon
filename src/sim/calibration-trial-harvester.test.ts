import { describe, expect, it } from 'vitest'
import { AUTOPILOT_SKILL_ORDER } from '../data/autopilot'
import { TRIAL_HARVESTER } from '../data/levels/trial-harvester'
import { averageOf, clearsOf, play, SEEDS, summarize, table } from './calibration-runs'
import { createLoadout } from './stats'

describe('calibrating the chapter boss trial with human-like autopilots', () => {
  it('reports how often each skill level beats the harvester', () => {
    const loadout = () => createLoadout({ brawl: 3, gun: 2 }, [{ slot: 'q', id: 'barrier', rank: 1 }])
    const runs = AUTOPILOT_SKILL_ORDER.flatMap((skill) => SEEDS.map((seed) => play(TRIAL_HARVESTER, skill, seed, loadout())))
    console.table(table(runs))
    console.table(summarize(runs))
    expect(averageOf(runs, 'perfect', (run) => run.hits)).toBeLessThan(averageOf(runs, 'novice', (run) => run.hits))
    expect(clearsOf(runs, 'perfect')).toBeGreaterThanOrEqual(6)
  }, 120_000)
})
