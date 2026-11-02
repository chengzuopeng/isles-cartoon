import { beforeAll, describe, expect, it } from 'vitest'
import { LEVEL_1_4 } from '../data/levels/level-1-4'
import { afterFarm, play, SEEDS, type RunReport } from './balance-runs'

describe('level 1-4 balance with the autopilot', () => {
  let reports: RunReport[] = []

  beforeAll(() => {
    reports = SEEDS.map((seed) => play(LEVEL_1_4, seed, 'barrier', afterFarm))
    console.table(reports)
  }, 120_000)

  it('starts from level 4 and reaches level 5 on a first clear', () => {
    const start = afterFarm()
    expect([start.level, start.points]).toEqual([4, 0])
    expect(reports.filter((report) => report.status === 'complete').length).toBeGreaterThanOrEqual(8)
    for (const report of reports.filter((item) => item.status === 'complete')) expect(report.level).toBe(5)
  })

  it('opens the chests near its way: the cabin, the cave behind the waterfall and the lumber pile', () => {
    for (const report of reports.filter((item) => item.status === 'complete')) expect(report.chests).toBeGreaterThanOrEqual(2)
  })
})
