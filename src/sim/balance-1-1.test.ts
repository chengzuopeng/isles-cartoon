import { beforeAll, describe, expect, it } from 'vitest'
import { LEVEL_1_1 } from '../data/levels/level-1-1'
import { play, SEEDS, type RunReport } from './balance-runs'

describe('level 1-1 balance with the autopilot', () => {
  let reports: RunReport[] = []

  beforeAll(() => {
    reports = SEEDS.map((seed) => play(LEVEL_1_1, seed))
    console.table(reports)
  }, 120_000)

  it('clears most runs without cheats', () => {
    const clears = reports.filter((report) => report.status === 'complete').length
    expect(clears).toBeGreaterThanOrEqual(Math.ceil(SEEDS.length * 0.7))
  })

  it('reaches level 2 to 3 on a first clear of the tutorial', () => {
    for (const report of reports.filter((item) => item.status === 'complete')) {
      expect(report.level).toBeGreaterThanOrEqual(2)
      expect(report.level).toBeLessThanOrEqual(3)
    }
  })

  it('fires the ultimate a few times in every clear', () => {
    for (const report of reports.filter((item) => item.status === 'complete')) {
      expect(report.ultimates).toBeGreaterThanOrEqual(2)
    }
  })

  it('finds health or buffs several times and a special weapon in every clear', () => {
    for (const report of reports.filter((item) => item.status === 'complete')) {
      expect(report.offered).toBeGreaterThanOrEqual(4)
      expect(report.weapons).toBeGreaterThanOrEqual(1)
    }
  })
})
