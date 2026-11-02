import { beforeAll, describe, expect, it } from 'vitest'
import { LEVEL_1_2 } from '../data/levels/level-1-2'
import { afterTutorial, play, SEEDS, type RunReport } from './balance-runs'

describe('level 1-2 balance with the autopilot', () => {
  let reports: RunReport[] = []

  beforeAll(() => {
    reports = SEEDS.map((seed) => play(LEVEL_1_2, seed, null, afterTutorial))
    console.table(reports)
  }, 120_000)

  it('starts from level 2 and reaches level 3 on a first clear', () => {
    expect(afterTutorial().level).toBe(2)
    for (const report of reports.filter((item) => item.status === 'complete')) expect(report.level).toBe(3)
    expect(reports.filter((report) => report.status === 'complete').length).toBeGreaterThanOrEqual(8)
  })

  it('opens the feed shed or the dock on the way and keeps the hidden chest for the curious', () => {
    for (const report of reports.filter((item) => item.status === 'complete')) {
      expect(report.chests).toBeGreaterThanOrEqual(1)
      expect(report.chests).toBeLessThanOrEqual(2)
    }
  })
})
