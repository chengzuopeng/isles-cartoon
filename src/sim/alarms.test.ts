import { describe, expect, it } from 'vitest'
import { ALARM } from '../data/alarms'
import { BARK_SECONDS } from '../data/dialogue'
import { LEVEL_1_1 } from '../data/levels/level-1-1'
import { LEVEL_1_3 } from '../data/levels/level-1-3'
import { createDefaultTuning } from '../data/tuning'
import { alarmRaised, raiseAlarm } from './alarms'
import { raiseAlarms } from './cheats'
import { killEnemy } from './combat'
import { buildLevel, validateLevel } from './level'
import { aggro, canSeePlayer, playerHidden, sightOf } from './perception'
import { challengeTotal, challengesOf } from './rating'
import { stepWorld } from './step'
import { runTallies } from './tallies'
import { levelFromAreas } from './testing'
import type { Enemy, GameEvent, PlayerCommand } from './types'
import { createWorld, type World } from './world'

const DT = 1 / 60

const FARM = levelFromAreas([
  { name: 'start', theme: 'meadow', rows: ['#............#', '#.....P......#', '#............#'] },
  {
    name: 'field',
    theme: 'farm',
    rows: [
      '#............#',
      '#............#',
      '#............#',
      '#............#',
      '#............#',
      '#.m........m.#',
      '#............#',
      '#............#',
    ],
    landmarks: [{ id: 'ch1-bell-tower', at: [5, 1] }],
    alarm: { landmark: 'ch1-bell-tower', post: [6, 4] },
  },
  {
    name: 'house',
    theme: 'farm',
    kind: 'lock',
    rows: ['######DD######', '#............#', '#.....m......#', '#............#', '#............#', '#............#', '######DD######'],
    reinforce: {
      at: [
        [5, 1],
        [8, 1],
      ],
      enemies: [
        { kind: 'shield', count: 1 },
        { kind: 'grunt', count: 2 },
      ],
      left: 0,
    },
  },
  { name: 'exit', theme: 'meadow', rows: ['##############', '#.....XX.....#', '#............#'] },
])

function idle(): PlayerCommand {
  return { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false, slot: null, interact: false, skill: null, ultimate: false, pitch: 0, jump: false, dash: false, melee: false }
}

function place(world: World, x: number, y: number): void {
  world.player.pos = { x, y }
  world.player.prev = { x, y }
}

function run(world: World, seconds: number): GameEvent[] {
  const seen: GameEvent[] = []
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    world.events.length = 0
    stepWorld(world, idle(), DT)
    seen.push(...world.events)
  }
  return seen
}

function setup(): { world: World; west: Enemy; east: Enemy; guard: Enemy } {
  const world = createWorld(FARM, createDefaultTuning(), { debug: { invincible: true } })
  const field = world.enemies.filter((enemy) => enemy.area === 1).sort((a, b) => a.pos.x - b.pos.x)
  const guard = world.enemies.find((enemy) => enemy.area === 2)!
  return { world, west: field[0], east: field[1], guard }
}

describe('the alarm bell', () => {
  it('is built from the area config: the bell tower, its door and the reinforcements of the lock fight', () => {
    expect(validateLevel(FARM)).toEqual([])
    const tower = FARM.landmarks.findIndex((landmark) => landmark.id === 'ch1-bell-tower')
    expect(FARM.alarms).toEqual([{ area: 1, landmark: tower, post: { x: 6.5, y: FARM.areas[1].top + 4.5 } }])
    expect(FARM.reinforcements).toHaveLength(1)
    expect(FARM.reinforcements[0]).toMatchObject({ area: 2, left: 0 })
    const world = createWorld(FARM, createDefaultTuning())
    expect(world.alarms).toEqual([{ status: 'quiet', runner: null, pos: FARM.alarms[0].post, pulling: 0, runners: 0 }])
  })

  it('sends the first enemy that spots the player running to the bell instead of fighting, and rings after a one-second pull', () => {
    const { world, west, east } = setup()
    place(world, west.pos.x + 1.2, west.pos.y + 0.5)
    aggro(world, west, 0)
    expect(world.events.filter((event) => event.type === 'alarmRunner')).toEqual([
      { type: 'alarmRunner', alarm: 0, id: west.id, x: west.pos.x, y: west.pos.y },
    ])
    expect(world.alarms[0]).toMatchObject({ status: 'running', runner: west.id, runners: 1 })
    const post = FARM.alarms[0].post
    let pulledAt = -1
    let rangAt = -1
    let fought = false
    for (let step = 0; step < 8 / DT && rangAt < 0; step++) {
      const events = run(world, DT)
      for (const event of events) {
        if (event.type === 'alarmPull') {
          pulledAt = world.time
          expect(Math.hypot(event.x - post.x, event.y - post.y)).toBeLessThanOrEqual(ALARM.arrive + 0.1)
        }
        if (event.type === 'alarmRaised') {
          rangAt = world.time
          expect(event).toMatchObject({ alarm: 0, landmark: FARM.alarms[0].landmark })
        }
        if (event.type === 'playerHit' || event.type === 'enemyWindup' || event.type === 'enemyCharge') fought = true
      }
    }
    expect(fought).toBe(false)
    expect(pulledAt).toBeGreaterThan(0)
    expect(rangAt - pulledAt).toBeCloseTo(ALARM.pull, 1)
    expect(world.alarms[0]).toMatchObject({ status: 'rung', runner: null })
    expect(alarmRaised(world)).toBe(true)
    expect(east.aggro).toBe(true)
  })

  it('keeps quiet when the runner is knocked down, and lets the next enemy that spots the player pick up the errand', () => {
    const { world, west, east } = setup()
    aggro(world, west, 0)
    aggro(world, east, 0)
    expect(world.alarms[0].runner).toBe(west.id)
    expect(world.events.filter((event) => event.type === 'alarmRunner')).toHaveLength(1)
    run(world, 0.5)
    killEnemy(world, west, true)
    const events = run(world, DT)
    expect(events.filter((event) => event.type === 'alarmStopped')).toHaveLength(1)
    expect(world.alarms[0]).toMatchObject({ status: 'quiet', runner: null, pulling: 0 })
    expect(east.aggro).toBe(true)
    expect(world.alarms[0].runner).toBeNull()
    east.aggro = false
    aggro(world, east, 0)
    expect(world.alarms[0]).toMatchObject({ status: 'running', runner: east.id, runners: 2 })
  })

  it('stays silent for enemies outside the alarm area, for summoned ones and when the debug switch is on', () => {
    const { world, guard } = setup()
    aggro(world, guard, 0)
    expect(world.alarms[0].status).toBe('quiet')
    const quiet = createWorld(FARM, createDefaultTuning(), { debug: { invincible: true, quietAlarms: true } })
    aggro(quiet, quiet.enemies.find((enemy) => enemy.area === 1)!, 0)
    expect(quiet.alarms[0].status).toBe('quiet')
    expect(quiet.events.some((event) => event.type === 'alarmRunner')).toBe(false)
  })

  it('sends a second wave into the lock fight once the first one is down, warned like a boss summon', () => {
    const { world, guard } = setup()
    expect(raiseAlarm(world)).toBe(true)
    expect(raiseAlarm(world)).toBe(false)
    const house = world.level.areas[2]
    place(world, 10.5, house.top + 2.5)
    run(world, DT * 2)
    expect(world.areas[2].status).toBe('locked')
    expect(world.spawns).toHaveLength(0)
    killEnemy(world, guard, true)
    const events = run(world, DT)
    expect(events.filter((event) => event.type === 'reinforcements')).toEqual([{ type: 'reinforcements', area: 2, count: 3 }])
    expect(world.spawns.map((marker) => [marker.kind, marker.area, marker.total, marker.summoned])).toEqual([
      ['shield', 2, ALARM.reinforceWarning, false],
      ['grunt', 2, ALARM.reinforceWarning, false],
      ['grunt', 2, ALARM.reinforceWarning, false],
    ])
    expect(world.areas[2].status).toBe('locked')
    run(world, ALARM.reinforceWarning + 0.1)
    const wave = world.enemies.filter((enemy) => enemy.area === 2 && enemy.hp > 0)
    expect(wave.map((enemy) => enemy.kind)).toEqual(['shield', 'grunt', 'grunt'])
    for (const enemy of wave) killEnemy(world, enemy, true)
    run(world, DT * 2)
    expect(world.areas[2].status).toBe('cleared')
    expect(world.reinforced).toEqual([true])
  })

  it('opens the lock fight without a second wave when the bell never rang', () => {
    const { world, guard } = setup()
    const house = world.level.areas[2]
    place(world, 10.5, house.top + 2.5)
    run(world, DT * 2)
    killEnemy(world, guard, true)
    const events = run(world, DT * 2)
    expect(events.some((event) => event.type === 'reinforcements')).toBe(false)
    expect(world.areas[2].status).toBe('cleared')
  })

  it('still calls the second wave when the bell rings after the lock fight has started', () => {
    const { world, guard } = setup()
    const house = world.level.areas[2]
    place(world, 10.5, house.top + 2.5)
    run(world, DT * 2)
    expect(world.areas[2].status).toBe('locked')
    raiseAlarms(world)
    expect(run(world, DT).some((event) => event.type === 'reinforcements')).toBe(false)
    killEnemy(world, guard, true)
    expect(run(world, DT).filter((event) => event.type === 'reinforcements')).toHaveLength(1)
    expect(world.areas[2].status).toBe('locked')
  })
})

describe('the alarm outside 1-3', () => {
  it('changes nothing in a level without an alarm: no runner, three challenges, no alarm tally', () => {
    const level = buildLevel(LEVEL_1_1)
    const world = createWorld(level, createDefaultTuning())
    expect(world.alarms).toEqual([])
    aggro(world, world.enemies[0], 0)
    expect(world.events.some((event) => event.type === 'alarmRunner')).toBe(false)
    expect(challengeTotal(level)).toBe(3)
    expect(runTallies(world).alarms).toEqual({ done: 0, total: 0 })
    expect(raiseAlarms(world)).toBe(0)
  })
})

describe('stealth in 1-3', () => {
  const level = buildLevel(LEVEL_1_3)

  it('adds the stealth challenge, done only when the run clears with the bell silent', () => {
    expect(challengeTotal(level)).toBe(4)
    const world = createWorld(level, createDefaultTuning())
    world.status = 'complete'
    expect(challengesOf(world).map((item) => item.id)).toEqual(['flawless', 'sweep', 'secret', 'stealth'])
    expect(challengesOf(world).find((item) => item.id === 'stealth')?.done).toBe(true)
    expect(runTallies(world).alarms).toEqual({ done: 1, total: 1 })
    raiseAlarms(world)
    expect(challengesOf(world).find((item) => item.id === 'stealth')?.done).toBe(false)
    expect(runTallies(world).alarms).toEqual({ done: 0, total: 1 })
    const unfinished = createWorld(level, createDefaultTuning())
    expect(challengesOf(unfinished).find((item) => item.id === 'stealth')?.done).toBe(false)
  })

  it('hides the player inside a wheat stack from a patrol more than 1.8 cells away', () => {
    const world = createWorld(level, createDefaultTuning())
    const stack = level.landmarks.find((landmark) => landmark.id === 'ch1-wheat-stack' && landmark.area === 1 && landmark.column === 16 && landmark.row === level.areas[1].top + 22)!
    const patrol = world.enemies.find((enemy) => enemy.area === 1 && enemy.kind === 'grunt')!
    const x = stack.column + 0.5
    const y = stack.row + 0.5
    place(world, x, y)
    expect(playerHidden(world)).toBe(true)
    patrol.facing = Math.PI
    patrol.pos = { x: x + 3, y }
    expect(canSeePlayer(world, patrol, sightOf(world, patrol))).toBe(false)
    patrol.pos = { x: x + 1.5, y }
    expect(canSeePlayer(world, patrol, sightOf(world, patrol))).toBe(true)
    place(world, x + 1, y)
    patrol.pos = { x: x + 4, y }
    expect(playerHidden(world)).toBe(false)
    expect(canSeePlayer(world, patrol, sightOf(world, patrol))).toBe(true)
  })

  it('shouts a bubble over every new runner and has Alo speak up once when the bell rings', () => {
    const world = createWorld(level, createDefaultTuning(), { debug: { invincible: true } })
    const field = world.enemies.filter((enemy) => enemy.area === 1)
    aggro(world, field[0], 0)
    const first = run(world, DT).filter((event) => event.type === 'bark')
    expect(first).toEqual([
      expect.objectContaining({ id: 'thief', speaker: null, display: 'bubble', enemy: field[0].id, text: '警报！有人偷麦子！', seconds: BARK_SECONDS }),
    ])
    expect(run(world, DT).some((event) => event.type === 'bark')).toBe(false)
    killEnemy(world, field[0], true)
    run(world, DT)
    aggro(world, field[1], 0)
    const second = run(world, DT).filter((event) => event.type === 'bark')
    expect(second).toEqual([expect.objectContaining({ id: 'thief', enemy: field[1].id })])
    raiseAlarms(world)
    const bell = run(world, DT).filter((event) => event.type === 'bark')
    expect(bell).toEqual([expect.objectContaining({ id: 'bell', speaker: 'alo', display: 'bar', text: '钟响了！前面的院子会来更多机器人。' })])
    expect(run(world, DT).some((event) => event.type === 'bark')).toBe(false)
  })
})
