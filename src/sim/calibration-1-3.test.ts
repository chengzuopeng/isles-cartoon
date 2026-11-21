import { beforeAll, describe, expect, it } from 'vitest'
import { AUTOPILOT_SKILL_ORDER } from '../data/autopilot'
import type { GridPoint } from '../data/levels/types'
import { LEVEL_1_3 } from '../data/levels/level-1-3'
import { createDefaultTuning } from '../data/tuning'
import { createAutopilot } from './autopilot'
import { afterPasture, clearsOf, DT, farmSummary, LIMIT_SECONDS, playFarm, SEEDS, table, type FarmRun } from './calibration-runs'
import { buildLevel } from './level'
import { challengesOf } from './rating'
import type { Enemy, GameEvent, PlayerCommand } from './types'
import { idleCommand, stepWorld } from './step'
import { createWorld } from './world'

// Waypoints are local to each area. Walk the field with normal inputs before handing combat to the pilot.
const VILLAGE: GridPoint[] = [[14.5, 34], [18, 31.5], [25, 31.5], [29, 25], [39.5, 23.5], [39.5, 16.5], [37, 11], [36, 7], [36, 1], [36, -4]]
const WEST: GridPoint[] = [[35.5, 40.5], [28, 41.5], [19.5, 41], [12, 40], [11, 35], [10.5, 29], [11.5, 24], [11, 18], [13.5, 14], [15.5, 9.5], [19.5, 7.5]]
const EAST: GridPoint[] = [[35.5, 40.5], [37.8, 39.5], [38.5, 37], [39.5, 34], [42.5, 33], [45.5, 32], [48.5, 31]]
const EXIT: GridPoint[] = [[40.5, 6.5], [44.5, 4], [44.5, -4]]

describe('level 1-3 from start to finish', () => {
  it.each(['silent', 'intercepted', 'rung'] as const)('clears the farm with the bell %s', (outcome) => {
    const level = buildLevel(LEVEL_1_3)
    const world = createWorld(level, createDefaultTuning(), { seed: 1, loadout: afterPasture() })
    const events = new Set<GameEvent['type']>()
    const entered: string[] = []
    const alarm = world.alarms[0]
    let reinforced = 0
    let clearedWith = -1
    let runnerAt = 0
    let rungAt = 0

    function tick(command: PlayerCommand) {
      stepWorld(world, command, DT)
      for (const event of world.events) {
        events.add(event.type)
        if (event.type === 'areaEntered') entered.push(event.name)
        if (event.type === 'reinforcements') reinforced += event.count
        if (event.type === 'alarmRunner') runnerAt = world.time
        if (event.type === 'alarmRaised') rungAt = world.time
        if (event.type === 'areaCleared' && event.index === 2) clearedWith = world.enemies.filter((enemy) => enemy.area === 2 && enemy.hp > 0).length
      }
      world.events.length = 0
    }

    function walk(area: number, stops: GridPoint[]) {
      for (const [x, row] of stops) {
        const y = level.areas[area].top + row
        for (let i = 0; i < 360; i++) {
          const dx = x - world.player.pos.x
          const dy = y - world.player.pos.y
          const distance = Math.hypot(dx, dy)
          if (distance < 0.14) break
          tick({ ...idleCommand(world), moveX: dx / distance, moveY: dy / distance, aimX: x, aimY: y })
        }
        expect(Math.hypot(x - world.player.pos.x, y - world.player.pos.y), `waypoint ${x},${row}`).toBeLessThan(0.14)
      }
    }

    function drawAttention(guard: Enemy) {
      for (let i = 0; i < 120 && alarm.runners === 0; i++) {
        tick({ ...idleCommand(world), aimX: guard.pos.x, aimY: guard.pos.y, pitch: 0, fire: true })
      }
      expect(alarm.status).toBe('running')
    }

    walk(0, VILLAGE)
    if (outcome === 'rung') {
      walk(1, EAST)
      drawAttention(world.enemies.find((enemy) => enemy.area === 1 && enemy.kind === 'grunt' && enemy.pos.x > 44)!)
      walk(1, [[48.5, 27], [47.5, 24], [45.5, 23], [43, 21], [41.5, 19.5], [41.5, 13], [41.5, 7], [44.5, 4], [44.5, -4]])
    } else {
      walk(1, WEST)
      if (outcome === 'intercepted') {
        walk(1, [[26.5, 8], [26.5, 12.5], [29.5, 14.5]])
        drawAttention(world.enemies.find((enemy) => enemy.area === 1 && enemy.kind === 'gunner' && enemy.idleMode === 'guard')!)
        for (let i = 0; i < 210 && alarm.status === 'running'; i++) {
          const runner = world.enemies.find((enemy) => enemy.id === alarm.runner)!
          const distance = Math.hypot(runner.pos.x - world.player.pos.x, runner.pos.y - world.player.pos.y)
          const aimX = runner.pos.x + (runner.pos.x - runner.prev.x) * distance * 1.3
          const aimY = runner.pos.y + (runner.pos.y - runner.prev.y) * distance * 1.3
          tick({ ...idleCommand(world), aimX, aimY, pitch: Math.atan2(runner.z + 1.05 - world.player.z - 1.35, distance), slot: 'primary', fire: true, melee: distance < 1.9 })
        }
        expect(events.has('alarmStopped')).toBe(true)
        walk(1, [[32.5, 15.5], [32.5, 13], [33.5, 7], ...EXIT])
      } else {
        walk(1, [[26.5, 7], [32.5, 6.5], ...EXIT])
      }
    }
    const pilot = createAutopilot({ siege: true, stealthy: true, onward: true, skill: 'perfect', seed: 1 })
    for (let i = 0; i < LIMIT_SECONDS / DT && world.status === 'playing'; i++) tick(pilot.next(world))

    expect(world.status, `ended in ${level.areas[world.areaIndex].name}`).toBe('complete')
    expect(entered).toEqual(LEVEL_1_3.areas.map((area) => area.name))
    for (const type of ['areaLocked', 'bossStunned', 'landmarkCrashed', 'bossShield', 'bossDefeated'] as const) expect(events.has(type), type).toBe(true)
    expect(events.has('alarmRunner')).toBe(outcome !== 'silent')
    expect(events.has('alarmPull')).toBe(outcome === 'rung')
    expect(events.has('alarmRaised')).toBe(outcome === 'rung')
    expect(reinforced).toBe(outcome === 'rung' ? 4 : 0)
    expect(world.reinforced).toEqual([outcome === 'rung'])
    expect(challengesOf(world).find(({ id }) => id === 'stealth')?.done).toBe(outcome !== 'rung')
    if (outcome === 'rung') {
      expect(rungAt - runnerAt).toBeGreaterThan(3.8)
      expect(rungAt - runnerAt).toBeLessThan(7)
    }
    expect(clearedWith).toBe(0)
    expect(world.boss?.hp).toBe(0)
  }, 20_000)
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
    expect(clearsOf(rung, 'human')).toBeGreaterThanOrEqual(9)
    expect(clearsOf(rung, 'novice')).toBeGreaterThanOrEqual(8)
  })

  it('names the attack behind every death', () => {
    for (const run of rung.filter((item) => item.status === 'dead')) expect(run.killedBy).not.toBe('')
  })
})
