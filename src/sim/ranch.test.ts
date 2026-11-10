import { describe, expect, it } from 'vitest'
import { SHEEP } from '../data/sheep'
import { createDefaultTuning } from '../data/tuning'
import { landingBeyond } from './autopilot-paths'
import { spawnBlast } from './combat'
import { Tile, tileAt } from './grid'
import { openPen } from './sheep'
import { aggro } from './perception'
import { stepWorld } from './step'
import { levelFromAreas, singleArea } from './testing'
import type { PlayerCommand } from './types'
import { createEnemy, createWorld, type World } from './world'

const DT = 1 / 60

function idle(extra: Partial<PlayerCommand> = {}): PlayerCommand {
  return { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false, slot: null, interact: false, skill: null, ultimate: false, pitch: 0, jump: false, dash: false, melee: false, ...extra }
}

function run(world: World, seconds: number, command: PlayerCommand = idle()): void {
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) stepWorld(world, command, DT)
}

function seen(world: World, type: string): number {
  return world.events.filter((event) => event.type === type).length
}

const FIELD = singleArea(['##################', '#................#', '#................#', '#................#', '#................#', '#.......P......X.#', '##################'])

describe('bombers light their fuse before they charge', () => {
  it('stands still for the fuse time, then runs at the player', () => {
    const world = createWorld(FIELD, createDefaultTuning())
    world.debug.invincible = true
    const bomber = createEnemy(world, 'bomber', { x: 3.5, y: 3.5 }, 0)
    world.enemies.push(bomber)
    aggro(world, bomber, 0)
    expect(bomber.state).toBe('ignite')
    expect(world.events.some((event) => event.type === 'bomberIgnite' && event.id === bomber.id)).toBe(true)
    const start = { ...bomber.pos }
    run(world, world.tuning.bomber.ignite * 0.8)
    expect(Math.hypot(bomber.pos.x - start.x, bomber.pos.y - start.y)).toBeLessThan(0.05)
    run(world, world.tuning.bomber.ignite * 0.6)
    expect(bomber.state).toBe('chase')
    run(world, 0.3)
    expect(Math.hypot(bomber.pos.x - world.player.pos.x, bomber.pos.y - world.player.pos.y)).toBeLessThan(Math.hypot(start.x - world.player.pos.x, start.y - world.player.pos.y) - 0.5)
  })

  it('leaves other enemies charging at once', () => {
    const world = createWorld(FIELD, createDefaultTuning())
    const grunt = createEnemy(world, 'grunt', { x: 3.5, y: 3.5 }, 0)
    world.enemies.push(grunt)
    aggro(world, grunt, 0)
    expect(grunt.state).toBe('chase')
    expect(seen(world, 'bomberIgnite')).toBe(0)
  })
})

const FARM = levelFromAreas([
  {
    name: 'farm',
    theme: 'village',
    rows: ['##############', '#............#', '#.ffff.......#', '#.f..f.......#', '#.f..........#', '#.ffff.......#', '#........P..X#', '##############'],
    landmarks: [{ id: 'ch1-sheep-pen', at: [8, 2] }],
    pasture: { from: [3, 3], to: [4, 4] },
  },
])

describe('sheep wait for the area to be cleared', () => {
  it('bleats at the gate while enemies are left, and walks out once they are gone', () => {
    const world = createWorld(FARM, createDefaultTuning())
    world.debug.invincible = true
    const grunt = createEnemy(world, 'grunt', { x: 11.5, y: 1.5 }, 0)
    world.enemies.push(grunt)
    openPen(world, 0)
    const sheep = world.sheep[0]
    const pen = { ...sheep.pos }
    run(world, SHEEP.leaveDelay + 0.2)
    expect(sheep.state).toBe('waiting')
    run(world, SHEEP.bleatEvery * 2)
    expect(sheep.pos).toEqual(pen)
    const bleats = world.events.filter((event) => event.type === 'bark' && event.text === SHEEP.bleat)
    expect(bleats.length).toBeGreaterThan(0)
    grunt.hp = 0
    world.enemies = world.enemies.filter((enemy) => enemy.hp > 0)
    run(world, SHEEP.leaveDelay + 1)
    expect(['leaving', 'grazing']).toContain(sheep.state)
    expect(Math.hypot(sheep.pos.x - pen.x, sheep.pos.y - pen.y)).toBeGreaterThan(0.3)
  })

  it('walks straight out when the area is already clear', () => {
    const world = createWorld(FARM, createDefaultTuning())
    openPen(world, 0)
    run(world, SHEEP.leaveDelay + 0.5)
    expect(world.sheep[0].state).toBe('leaving')
  })
})

const BARN = levelFromAreas([
  {
    name: 'barn',
    theme: 'arena',
    rows: ['##############', '#............#', '#............#', '#............#', '#............#', '#............#', '#........P..X#', '##############'],
    landmarks: [{ id: 'ch1-hay-pillar', at: [3, 2] }],
  },
])

describe('hay pillars shake before they fall', () => {
  it('shakes as soon as a warning circle reaches it and falls when the blast goes off', () => {
    const world = createWorld(BARN, createDefaultTuning())
    world.debug.invincible = true
    spawnBlast(world, { x: 6.2, y: 3, z: 0, radius: 1.9, delay: 0.65, playerDamage: 0, enemyDamage: 0, source: 'bomber', ownerId: 0, attack: null })
    run(world, DT)
    expect(world.landmarks[0].shaking).toBe(true)
    expect(seen(world, 'landmarkShaking')).toBe(1)
    expect(world.landmarks[0].broken).toBe(false)
    run(world, 0.8)
    expect(world.landmarks[0].broken).toBe(true)
    expect(world.landmarks[0].shaking).toBe(false)
  })

  it('stays still when the warning circle misses it', () => {
    const world = createWorld(BARN, createDefaultTuning())
    world.debug.invincible = true
    spawnBlast(world, { x: 10.5, y: 3, z: 0, radius: 1.5, delay: 0.65, playerDamage: 0, enemyDamage: 0, source: 'bomber', ownerId: 0, attack: null })
    run(world, 0.3)
    expect(world.landmarks[0].shaking).toBe(false)
    expect(seen(world, 'landmarkShaking')).toBe(0)
  })
})

const PADDOCK = singleArea(['###########', '#.........#', '#.........#', '#ffffffff.#', '#.........#', '#....P..X.#', '###########'])

describe('fence tops', () => {
  it('cannot be stood on: a player who lands on one slides off to the ground', () => {
    const world = createWorld(PADDOCK, createDefaultTuning())
    const player = world.player
    expect(tileAt(world.grid, 4, 3)).toBe(Tile.Fence)
    player.pos = { x: 4.5, y: 3.45 }
    player.prev = { ...player.pos }
    player.z = 1.2
    player.prevZ = 1.2
    player.grounded = false
    run(world, 1.2)
    expect(player.grounded).toBe(true)
    expect(player.z).toBeLessThan(0.05)
    expect(tileAt(world.grid, Math.floor(player.pos.x), Math.floor(player.pos.y))).not.toBe(Tile.Fence)
  })

  it('can still be jumped over', () => {
    const world = createWorld(PADDOCK, createDefaultTuning())
    const player = world.player
    player.pos = { x: 4.5, y: 4.6 }
    player.prev = { ...player.pos }
    run(world, 0.05, idle({ moveY: -1, jump: true }))
    run(world, 1, idle({ moveY: -1 }))
    expect(player.pos.y).toBeLessThan(3)
  })

  it('lets the autopilot aim for the ground on the far side when its next step is a fence', () => {
    const { grid } = PADDOCK
    expect(landingBeyond(grid, 4, 4, { column: 4, row: 3 })).toEqual({ column: 4, row: 2 })
    expect(landingBeyond(grid, 4, 5, { column: 4, row: 4 })).toBeNull()
    expect(landingBeyond(grid, 1, 2, { column: 1, row: 3 })).toEqual({ column: 1, row: 4 })
  })
})
