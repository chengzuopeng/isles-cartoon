import { describe, expect, it } from 'vitest'
import { AUTOPILOT_SKILL_ORDER } from '../data/autopilot'
import { TRIAL_HARVESTER } from '../data/levels/trial-harvester'
import { clearsOf, play, SEEDS, summarize, table } from './calibration-runs'
import { createLoadout } from './stats'

describe('calibrating the chapter boss trial with human-like autopilots', () => {
  it('reports how often each skill level beats the harvester', () => {
    const loadout = () => createLoadout({ health: 3, damage: 2 }, [{ slot: 'q', id: 'roll', rank: 1 }])
    const runs = AUTOPILOT_SKILL_ORDER.flatMap((skill) => SEEDS.map((seed) => play(TRIAL_HARVESTER, skill, seed, loadout())))
    console.table(table(runs))
    console.table(summarize(runs))
    expect(clearsOf(runs, 'perfect')).toBeGreaterThanOrEqual(clearsOf(runs, 'novice'))
  }, 120_000)
})
