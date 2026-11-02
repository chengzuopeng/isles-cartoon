import { beforeAll, describe, expect, it } from 'vitest'
import { LEVEL_1_5 } from '../data/levels/level-1-5'
import { afterTrail, play, SEEDS, type RunReport } from './balance-runs'
import { totalXpAt } from './profile'

describe('level 1-5 balance with the autopilot', () => {
  let reports: RunReport[] = []

  beforeAll(() => {
    reports = SEEDS.map((seed) => play(LEVEL_1_5, seed, 'barrier', afterTrail, { siege: true, onward: true, kite: true }))
    console.table(reports)
  }, 180_000)

  it('starts from level 5 and reaches level 6 on a first clear', () => {
    const start = afterTrail()
    expect([start.level, start.points]).toEqual([5, 0])
    expect(totalXpAt(start.level, start.xp)).toBe(1770)
    const cleared = reports.filter((report) => report.status === 'complete')
    expect(cleared.length).toBeGreaterThanOrEqual(8)
    for (const report of cleared) expect(report.level).toBe(6)
  })

  it('detours for the yard chest beside the middle blade lane in most runs, but not for the guarded alley or the airship', () => {
    const cleared = reports.filter((item) => item.status === 'complete')
    expect(cleared.filter((report) => report.chests >= 1).length).toBeGreaterThanOrEqual(cleared.length / 2)
    for (const report of cleared) expect(report.chests).toBeLessThanOrEqual(2)
  })
})
