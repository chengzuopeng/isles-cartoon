import { describe, expect, it } from 'vitest'
import { AUTOPILOT_SKILL_ORDER } from '../data/autopilot'
import { TRIAL_SYSTEMS } from '../data/levels/trial-systems'
import { clearsOf, play, SEEDS, summarize, table } from './calibration-runs'
import { createLoadout } from './stats'

describe('calibrating the systems trial with human-like autopilots', () => {
  it('reports how the mixed squads hold up against each skill level', () => {
    const runs = AUTOPILOT_SKILL_ORDER.flatMap((skill) => SEEDS.map((seed) => play(TRIAL_SYSTEMS, skill, seed, createLoadout())))
    console.table(table(runs))
    console.table(summarize(runs))
    expect(clearsOf(runs, 'perfect')).toBeGreaterThanOrEqual(clearsOf(runs, 'novice'))
  }, 120_000)
})
