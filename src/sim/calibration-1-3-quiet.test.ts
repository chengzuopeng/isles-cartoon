import { beforeAll, describe, expect, it } from 'vitest'
import { AUTOPILOT_SKILL_ORDER } from '../data/autopilot'
import { clearsOf, farmSummary, playFarm, SEEDS, table, type FarmRun } from './calibration-runs'

describe('calibrating level 1-3 with the alarms kept quiet', () => {
  let quiet: FarmRun[] = []
  let rung: FarmRun[] = []

  beforeAll(() => {
    quiet = AUTOPILOT_SKILL_ORDER.flatMap((skill) => SEEDS.map((seed) => playFarm(skill, seed, 'quiet')))
    rung = SEEDS.map((seed) => playFarm('perfect', seed, 'rung'))
    console.table(table(quiet))
    console.table(farmSummary(quiet))
  }, 300_000)

  it('makes the lock fight longer when the bell has rung', () => {
    const lock = (runs: FarmRun[]) => {
      const clears = runs.filter((run) => run.skill === 'perfect' && run.status === 'complete')
      return clears.reduce((sum, run) => sum + run.lock, 0) / clears.length
    }
    expect(lock(rung)).toBeGreaterThan(lock(quiet))
  })

  it('names the attack behind every death', () => {
    for (const run of quiet.filter((item) => item.status === 'dead')) expect(run.killedBy).not.toBe('')
  })

  it('keeps the quiet courtyard accessible to each skill profile', () => {
    expect(clearsOf(quiet, 'perfect')).toBeGreaterThanOrEqual(9)
    expect(clearsOf(quiet, 'human')).toBeGreaterThanOrEqual(9)
    expect(clearsOf(quiet, 'novice')).toBeGreaterThanOrEqual(8)
  })
})
