import { beforeAll, describe, expect, it } from 'vitest'
import { LEVEL_1_3 } from '../data/levels/level-1-3'
import { afterPasture, play, SEEDS, type RunReport } from './balance-runs'

describe('level 1-3 balance with the autopilot', () => {
  let reports: RunReport[] = []

  beforeAll(() => {
    reports = SEEDS.map((seed) => play(LEVEL_1_3, seed, 'barrier', afterPasture, { siege: true }))
    console.table(reports)
  }, 120_000)

  it('starts from level 3 and reaches level 4 on a first clear', () => {
    const start = afterPasture()
    expect([start.level, start.points]).toEqual([3, 0])
    expect(reports.filter((report) => report.status === 'complete').length).toBeGreaterThanOrEqual(8)
    for (const report of reports.filter((item) => item.status === 'complete')) expect(report.level).toBe(4)
  })

  it('opens the weapon chest at the bell tower and the smithy chest on the way', () => {
    for (const report of reports.filter((item) => item.status === 'complete')) expect(report.chests).toBeGreaterThanOrEqual(2)
  })
})
