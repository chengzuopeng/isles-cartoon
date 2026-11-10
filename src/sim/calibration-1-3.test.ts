import { beforeAll, describe, expect, it } from 'vitest'
import { AUTOPILOT_SKILL_ORDER } from '../data/autopilot'
import { LEVEL_1_3 } from '../data/levels/level-1-3'
import { createDefaultTuning } from '../data/tuning'
import { createAutopilot } from './autopilot'
import { afterPasture, clearsOf, DT, farmSummary, LIMIT_SECONDS, playFarm, SEEDS, table, type FarmRun } from './calibration-runs'
import { buildLevel } from './level'
import { stepWorld } from './step'
import { createWorld } from './world'

describe('level 1-3 from start to finish', () => {
  it('rings the bell, fights the second wave in the farmhouse yard, beats the shield captain and walks out', () => {
    const level = buildLevel(LEVEL_1_3)
    const world = createWorld(level, createDefaultTuning(), { debug: { invincible: true }, loadout: afterPasture() })
    const pilot = createAutopilot({ siege: true })
    const entered: string[] = []
    const seen = new Set<string>()
    let reinforced = 0
    let clearedWith = -1
    for (let step = 0; step < LIMIT_SECONDS / DT && world.status === 'playing'; step++) {
      stepWorld(world, pilot.next(world), DT)
      for (const event of world.events) {
        seen.add(event.type)
        if (event.type === 'areaEntered') entered.push(event.name)
        if (event.type === 'reinforcements') reinforced += event.count
        if (event.type === 'areaCleared' && event.index === 2) clearedWith = world.enemies.filter((enemy) => enemy.area === 2 && enemy.hp > 0).length
      }
      world.events.length = 0
    }
    expect(entered).toEqual(LEVEL_1_3.areas.map((area) => area.name))
    for (const type of ['alarmRunner', 'alarmPull', 'alarmRaised', 'areaLocked', 'bossStunned', 'landmarkCrashed', 'bossShield', 'bossDefeated']) {
      expect(seen.has(type), type).toBe(true)
    }
    expect(reinforced).toBe(4)
    expect(clearedWith).toBe(0)
    expect(world.reinforced).toEqual([true])
    expect(world.boss?.hp).toBe(0)
    expect(world.status).toBe('complete')
  })
})

describe('calibrating level 1-3 with human-like autopilots', () => {
  let rung: FarmRun[] = []

  beforeAll(() => {
    rung = AUTOPILOT_SKILL_ORDER.flatMap((skill) => SEEDS.map((seed) => playFarm(skill, seed, 'rung')))
    console.table(table(rung))
    console.table(farmSummary(rung))
  }, 300_000)

  it('keeps the clear rates measured in first person with the bell rung', () => {
    expect(clearsOf(rung, 'perfect')).toBeGreaterThanOrEqual(SEEDS.length - 1)
    expect(clearsOf(rung, 'human')).toBeGreaterThanOrEqual(8)
    expect(clearsOf(rung, 'novice')).toBeGreaterThanOrEqual(2)
  })

  it('names the attack behind every death', () => {
    for (const run of rung.filter((item) => item.status === 'dead')) expect(run.killedBy).not.toBe('')
  })
})
