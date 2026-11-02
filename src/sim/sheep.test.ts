import { describe, expect, it } from 'vitest'
import { SHEEP } from '../data/sheep'
import { createDefaultTuning } from '../data/tuning'
import { spawnBlast } from './combat'
import { Tile } from './grid'
import { insideRegion } from './level'
import { interactTarget } from './pickups'
import { spawnBullet } from './projectiles'
import { stepWorld } from './step'
import { runTallies } from './tallies'
import { levelFromAreas } from './testing'
import type { PlayerCommand } from './types'
import { createWorld, type World } from './world'

const DT = 1 / 60

const FARM = levelFromAreas([
  {
    name: 'farm',
    theme: 'village',
    rows: ['##############', '#............#', '#.ffff.......#', '#.f..f.......#', '#.f..........#', '#.ffff.......#', '#........P..X#', '##############'],
    landmarks: [{ id: 'ch1-sheep-pen', at: [8, 2] }],
    pasture: { from: [3, 3], to: [4, 4] },
  },
])

function idle(interact = false): PlayerCommand {
  return { moveX: 0, moveY: 0, aimX: 9.5, aimY: 0, fire: false, slot: null, interact, skill: null, ultimate: false, pitch: 0, jump: false, dash: false, melee: false }
}

function run(world: World, seconds: number): void {
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) stepWorld(world, idle(), DT)
}

function place(world: World, x: number, y: number): void {
  world.player.pos = { x, y }
  world.player.prev = { x, y }
}

function count(world: World, type: string): number {
  return world.events.filter((event) => event.type === type).length
}

describe('sheep pens', () => {
  it('keeps one sheep in the middle of each pen until the gate is opened', () => {
    const world = createWorld(FARM, createDefaultTuning())
    expect(world.sheep).toEqual([
      { id: 0, pen: 0, pos: { x: 9.5, y: 3.5 }, prev: { x: 9.5, y: 3.5 }, facing: Math.PI / 2, state: 'penned', wait: 0, target: null, moving: false },
    ])
    run(world, 3)
    expect(world.sheep[0].pos).toEqual({ x: 9.5, y: 3.5 })
    expect(runTallies(world).sheep).toEqual({ done: 0, total: 1 })
  })

  it('opens with F from the doorway, the same way as a chest', () => {
    const world = createWorld(FARM, createDefaultTuning())
    world.player.facing = Math.PI / 2
    expect(interactTarget(world)).toBeNull()
    place(world, 9.5, 5.6)
    expect(interactTarget(world)).toEqual({ kind: 'pen', landmark: 0, pos: { x: 9.5, y: 5 } })
    stepWorld(world, idle(true), DT)
    expect(world.landmarks[0].open).toBe(true)
    expect(world.grid.tiles[FARM.landmarks[0].gate!.index]).toBe(Tile.Floor)
    expect(world.events.filter((event) => event.type === 'landmarkOpened')).toEqual([
      { type: 'landmarkOpened', index: 0, id: 'ch1-sheep-pen', node: 'gate', x: 9.5, y: 3.5 },
    ])
    expect(count(world, 'sheepFreed')).toBe(1)
    expect(world.sheep[0].state).toBe('leaving')
    expect(interactTarget(world)).toBeNull()
    expect(runTallies(world).sheep).toEqual({ done: 1, total: 1 })
  })

  it('lets the sheep walk out on its own, find the pasture and graze inside it', () => {
    const world = createWorld(FARM, createDefaultTuning())
    place(world, 9.5, 5.6)
    stepWorld(world, idle(true), DT)
    run(world, SHEEP.leaveDelay - 0.1)
    expect(world.sheep[0].pos).toEqual({ x: 9.5, y: 3.5 })
    world.events.length = 0
    let home = 0
    for (let step = 0; step < 30 / DT; step++) {
      stepWorld(world, idle(), DT)
      home += count(world, 'sheepHome')
      world.events.length = 0
      if (world.sheep[0].state === 'grazing') break
    }
    expect(home).toBe(1)
    const pasture = world.level.pastures[0]
    let moved = 0
    for (let step = 0; step < 40 / DT; step++) {
      const before = { ...world.sheep[0].pos }
      stepWorld(world, idle(), DT)
      moved += Math.hypot(world.sheep[0].pos.x - before.x, world.sheep[0].pos.y - before.y)
      expect(insideRegion(pasture, world.sheep[0].pos.x, world.sheep[0].pos.y)).toBe(true)
    }
    expect(moved).toBeGreaterThan(0.5)
    expect(count(world, 'sheepHome')).toBe(0)
  })

  it('never gets in the way: the player walks through, bullets and blasts pass by', () => {
    const world = createWorld(FARM, createDefaultTuning())
    const sheep = world.sheep[0]
    place(world, sheep.pos.x, sheep.pos.y + 1.5)
    stepWorld(world, idle(true), DT)
    place(world, 12.5, sheep.pos.y)
    spawnBullet(world, 'enemy', 6.6, sheep.pos.y, 0, 0, 'rifle')
    spawnBlast(world, { x: sheep.pos.x, y: sheep.pos.y, radius: 2, delay: 0, playerDamage: 0, enemyDamage: 400, source: 'player', ownerId: 0 })
    run(world, 0.8)
    expect(world.player.hp).toBe(world.player.maxHp - world.tuning.weapons.rifle.damage)
    expect(world.sheep).toHaveLength(1)
    run(world, 3)
    place(world, sheep.pos.x, sheep.pos.y)
    stepWorld(world, idle(), DT)
    expect(Math.hypot(world.player.pos.x - sheep.pos.x, world.player.pos.y - sheep.pos.y)).toBeLessThan(0.1)
  })

  it('starts over with every pen shut when the level restarts', () => {
    const world = createWorld(FARM, createDefaultTuning())
    place(world, 9.5, 5.6)
    stepWorld(world, idle(true), DT)
    const again = createWorld(FARM, createDefaultTuning())
    expect(again.landmarks[0].open).toBe(false)
    expect(again.sheep[0].state).toBe('penned')
    expect(again.grid.tiles[FARM.landmarks[0].gate!.index]).toBe(Tile.LandmarkLow)
  })
})
