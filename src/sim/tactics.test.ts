import { describe, expect, it } from 'vitest'
import { createDefaultTuning } from '../data/tuning'
import { lineClear } from './collision'
import { assignSlots } from './enemies/tactics'
import { blocksBullets } from './grid'
import { aggro } from './perception'
import { stepWorld } from './step'
import { playerEye } from './terrain'
import { singleArea } from './testing'
import type { Enemy, GameEvent, PlayerCommand } from './types'
import { createWorld, type World } from './world'

const DT = 1 / 60
const OPEN = [
  '##########################',
  '#........................#',
  '#........................#',
  '#........................#',
  '#........................#',
  '#........................#',
  '#........................#',
  '#........................#',
  '#P.......................#',
  '##########################',
]

function command(moveX = 0, moveY = 0): PlayerCommand {
  return { moveX, moveY, aimX: 100, aimY: 4.5, fire: false, slot: null, interact: false, skill: null, ultimate: false, pitch: 0, jump: false, dash: false, melee: false }
}

function scene(rows: string[]): World {
  const world = createWorld(singleArea(rows), createDefaultTuning())
  world.debug.invincible = false
  return world
}

function place(world: World, x: number, y: number): void {
  world.player.pos = { x, y }
  world.player.prev = { x, y }
}

function put(enemy: Enemy, x: number, y: number): void {
  enemy.pos = { x, y }
  enemy.prev = { x, y }
  enemy.home = { x, y }
}

function kind(world: World, which: Enemy['kind']): Enemy[] {
  return world.enemies.filter((enemy) => enemy.kind === which)
}

function stepUntil(world: World, input: () => PlayerCommand, done: () => boolean, seconds = 6): GameEvent[] {
  const seen: GameEvent[] = []
  for (let i = 0; i < seconds / DT && !done(); i++) {
    stepWorld(world, input(), DT)
    seen.push(...world.events)
    world.events.length = 0
  }
  return seen
}

function withRow(rows: string[], index: number, row: string): string[] {
  return rows.map((line, at) => (at === index ? row : line))
}

describe('shooters', () => {
  it('aims ahead of a player running across its sights and locks the line before firing', () => {
    const world = scene(withRow(OPEN, 4, '#.........r..............#'))
    const gunner = kind(world, 'gunner')[0]
    place(world, 4.5, 8.5)
    put(gunner, 10.5, 1.5)
    aggro(world, gunner, 0)
    stepUntil(world, () => command(1, 0), () => gunner.state === 'aim')
    expect(gunner.state).toBe('aim')
    const rifle = world.tuning.weapons.rifle
    stepUntil(world, () => command(1, 0), () => gunner.stateTime >= rifle.windup * world.tuning.gunner.track + 0.02)
    const direct = Math.atan2(world.player.pos.y - gunner.pos.y, world.player.pos.x - gunner.pos.x)
    expect(gunner.aimAngle).toBeLessThan(direct)
    const locked = gunner.aimAngle
    stepUntil(world, () => command(1, 0), () => gunner.stateTime >= rifle.windup - 0.03)
    expect(gunner.aimAngle).toBe(locked)
  })

  it('ducks behind a rock after firing, out of the player line of fire', () => {
    const tall = [...OPEN.slice(0, -2), ...OPEN.slice(1, 5), ...OPEN.slice(-2)]
    const rows = withRow(withRow(tall, 2, '#.........o..............#'), 1, '#..........r.............#')
    const world = scene(rows)
    const gunner = kind(world, 'gunner')[0]
    place(world, 11.5, 11.5)
    aggro(world, gunner, 0)
    const events = stepUntil(world, () => command(), () => gunner.cover !== null, 8)
    expect(events.some((event) => event.type === 'enemyShot')).toBe(true)
    expect(gunner.cover).not.toBeNull()
    const cover = gunner.cover!
    expect(lineClear(world.grid, playerEye(world.player), { ...cover, z: 0.9 }, blocksBullets)).toBe(false)
    stepUntil(world, () => command(), () => Math.hypot(gunner.pos.x - cover.x, gunner.pos.y - cover.y) < 0.35, 3)
    expect(Math.hypot(gunner.pos.x - cover.x, gunner.pos.y - cover.y)).toBeLessThan(0.35)
  })

  it('takes turns so two shooters never start aiming at the same moment', () => {
    const world = scene(withRow(OPEN, 2, '#.......r.......r........#'))
    const gunners = kind(world, 'gunner')
    place(world, 12.5, 8.5)
    for (const gunner of gunners) aggro(world, gunner, 0)
    const starts = new Map<number, number>()
    for (let i = 0; i < 4 / DT && starts.size < gunners.length; i++) {
      stepWorld(world, command(), DT)
      world.events.length = 0
      for (const gunner of gunners) {
        if (gunner.state === 'aim' && !starts.has(gunner.id)) starts.set(gunner.id, world.time)
      }
    }
    expect(starts.size).toBe(2)
    const [first, second] = [...starts.values()].sort((a, b) => a - b)
    expect(second - first).toBeGreaterThanOrEqual(world.tuning.ai.volleyGap - DT)
  })
})

describe('chargers', () => {
  it('telegraphs a charge and slams into a player who stands still', () => {
    const world = scene(withRow(OPEN, 4, '#.........m..............#'))
    const grunt = kind(world, 'grunt')[0]
    place(world, 15.5, 4.5)
    put(grunt, 10.5, 4.5)
    grunt.rushCooldown = 0
    aggro(world, grunt, 0)
    const events = stepUntil(world, () => command(), () => grunt.state === 'charge', 2)
    expect(events.some((event) => event.type === 'enemyCharge')).toBe(true)
    const before = world.player.hp
    stepUntil(world, () => command(), () => world.player.hp < before, 2)
    expect(before - world.player.hp).toBe(world.tuning.weapons.rush.damage)
    expect(grunt.status.stunned).toBe(0)
  })

  it('stumbles after a charge that misses', () => {
    const world = scene(withRow(OPEN, 4, '#.........m..............#'))
    const grunt = kind(world, 'grunt')[0]
    place(world, 15.5, 4.5)
    put(grunt, 10.5, 4.5)
    grunt.rushCooldown = 0
    aggro(world, grunt, 0)
    stepUntil(world, () => command(), () => grunt.state === 'charge', 2)
    const before = world.player.hp
    const events = stepUntil(world, () => command(0, 1), () => grunt.status.stunned > 0, 2)
    expect(world.player.hp).toBe(before)
    expect(events.some((event) => event.type === 'stunned' && event.id === grunt.id)).toBe(true)
  })

  it('lets only two chargers close in at once while the rest circle', () => {
    const world = scene(withRow(withRow(OPEN, 2, '#....m.....m.....m.....m.#'), 6, '#........................#'))
    const grunts = kind(world, 'grunt')
    place(world, 12.5, 7.5)
    for (const grunt of grunts) aggro(world, grunt, 0)
    stepUntil(world, () => command(), () => false, 0.5)
    expect(grunts.filter((grunt) => grunt.engaged)).toHaveLength(world.tuning.ai.meleeSlots)
  })
})

describe('squads', () => {
  it('passes the alarm along one more hop', () => {
    const world = scene(withRow(OPEN, 4, '#..m......m.......m......#'))
    const [near, middle, far] = kind(world, 'grunt').sort((a, b) => a.pos.x - b.pos.x)
    aggro(world, near)
    expect(middle.aggro).toBe(true)
    expect(far.aggro).toBe(true)
  })

  it('stops after the configured hops', () => {
    const world = scene(withRow(OPEN, 4, '#..m......m.......m......#'))
    world.tuning.ai.alertHops = 1
    const [near, middle, far] = kind(world, 'grunt').sort((a, b) => a.pos.x - b.pos.x)
    aggro(world, near)
    expect(middle.aggro).toBe(true)
    expect(far.aggro).toBe(false)
  })
})

describe('difficulty', () => {
  it('lets one charger close in on easy and three on hard', () => {
    const rows = withRow(OPEN, 2, '#....m.....m.....m.....m.#')
    for (const [id, slots] of [
      ['easy', 1],
      ['normal', 2],
      ['hard', 3],
    ] as const) {
      const world = createWorld(singleArea(rows), createDefaultTuning(), { difficulty: id })
      place(world, 12.5, 7.5)
      for (const grunt of kind(world, 'grunt')) aggro(world, grunt, 0)
      stepUntil(world, () => command(), () => false, 0.5)
      expect(kind(world, 'grunt').filter((grunt) => grunt.engaged)).toHaveLength(slots)
    }
  })

  it('leads the shot further on hard than on easy', () => {
    const angles = (['easy', 'hard'] as const).map((id) => {
      const world = createWorld(singleArea(withRow(OPEN, 4, '#.........r..............#')), createDefaultTuning(), { difficulty: id })
      const gunner = kind(world, 'gunner')[0]
      place(world, 4.5, 8.5)
      put(gunner, 10.5, 1.5)
      aggro(world, gunner, 0)
      stepUntil(world, () => command(1, 0), () => gunner.state === 'aim')
      stepUntil(world, () => command(1, 0), () => gunner.stateTime >= 0.1)
      return gunner.aimAngle
    })
    expect(angles[1]).toBeLessThan(angles[0])
  })
})

describe('melee slots in first person', () => {
  it('lets at most one engaged charger come from outside the hero view', () => {
    const world = createWorld(singleArea(['#############', '#...........#', '#.m...P...m.#', '#.....m.....#', '#...........#', '#############']), createDefaultTuning())
    world.player.facing = Math.PI / 2
    for (const enemy of world.enemies) enemy.aggro = true
    const [west, east, south] = [...world.enemies].sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x)
    assignSlots(world)
    expect(south.engaged).toBe(true)
    expect([west.engaged, east.engaged].filter(Boolean)).toHaveLength(1)
  })
})
