import { describe, expect, it } from 'vitest'
import { createDefaultTuning } from '../data/tuning'
import { damagePlayer } from './combat'
import { stepWorld } from './step'
import { levelFromAreas } from './testing'
import type { GameEvent, PlayerCommand } from './types'
import { createWorld, type World } from './world'

const DT = 1 / 60
const WIDE = ['##############################', '#............................#', '#....P.......................#', '#............................#', '##############################']

function scene(rows: string[], heights?: string[]): World {
  return createWorld(levelFromAreas([{ name: 'yard', theme: 'meadow', rows, heights }]), createDefaultTuning())
}

function command(world: World, patch: Partial<PlayerCommand> = {}): PlayerCommand {
  const { player } = world
  return {
    moveX: 0,
    moveY: 0,
    aimX: player.pos.x + 20,
    aimY: player.pos.y,
    pitch: 0,
    fire: false,
    slot: null,
    interact: false,
    skill: null,
    ultimate: false,
    jump: false,
    dash: false,
    melee: false,
    ...patch,
  }
}

function run(world: World, seconds: number, patch: Partial<PlayerCommand> = {}): GameEvent[] {
  const seen: GameEvent[] = []
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    stepWorld(world, command(world, patch), DT)
    seen.push(...world.events)
    world.events.length = 0
  }
  return seen
}

function place(world: World, x: number, y: number): void {
  const { player } = world
  player.pos = { x, y }
  player.prev = { x, y }
}

describe('jumping', () => {
  it('rises to the jump height, lands back on the ground and reports the fall', () => {
    const world = scene(WIDE)
    const { player } = world
    const first = run(world, DT, { jump: true })
    expect(first.some((event) => event.type === 'jumped')).toBe(true)
    expect(player.grounded).toBe(false)
    let peak = 0
    const events: GameEvent[] = []
    for (let i = 0; i < 60; i++) {
      events.push(...run(world, DT))
      peak = Math.max(peak, player.z)
    }
    expect(peak).toBeCloseTo(world.tuning.player.jumpHeight, 1)
    expect(player.grounded).toBe(true)
    expect(player.z).toBe(0)
    const landed = events.find((event) => event.type === 'landed')
    expect(landed?.type === 'landed' && landed.fall).toBeCloseTo(world.tuning.player.jumpHeight, 0)
    expect(world.stats.jumps).toBe(1)
  })

  it('cannot jump again before landing', () => {
    const world = scene(WIDE)
    run(world, DT, { jump: true })
    run(world, 0.1)
    const rising = world.player.vz
    const again = run(world, DT, { jump: true })
    expect(again.some((event) => event.type === 'jumped')).toBe(false)
    expect(world.player.vz).toBeLessThan(rising)
  })
})

describe('steps and ledges', () => {
  const corridor = ['##########', '#P.......#', '##########']

  it('walks up a staircase of half-metre steps', () => {
    const world = scene(corridor, ['0000000000', '0001233333', '0000000000'])
    run(world, 1.2, { moveX: 1 })
    expect(world.player.pos.x).toBeGreaterThan(6)
    expect(world.player.z).toBe(1.5)
    expect(world.player.grounded).toBe(true)
  })

  it('stops at a one-metre step it would have to climb', () => {
    const world = scene(corridor, ['0000000000', '0002222222', '0000000000'])
    run(world, 1, { moveX: 1 })
    expect(world.player.pos.x).toBeLessThanOrEqual(3 - world.player.radius + 1e-6)
    expect(world.player.z).toBe(0)
  })

  it('walks off a ledge and falls to the ground below', () => {
    const world = scene(corridor, ['0000000000', '0444000000', '0000000000'])
    expect(world.player.z).toBe(2)
    const events = run(world, 1, { moveX: 1 })
    expect(world.player.pos.x).toBeGreaterThan(5)
    expect(world.player.z).toBe(0)
    const landed = events.find((event) => event.type === 'landed')
    expect(landed?.type === 'landed' && landed.fall).toBeCloseTo(2, 0)
  })

  it('jumps onto a rock, stands on it and drops off the far side', () => {
    const world = scene(['##########', '#P..o....#', '##########'])
    const { player } = world
    place(world, 3.5, 1.5)
    run(world, 0.5, { moveX: 1 })
    expect(player.pos.x).toBeLessThan(4)
    expect(player.z).toBe(0)
    run(world, DT, { moveX: 1, jump: true })
    for (let i = 0; i < 60 && player.pos.x < 4.5; i++) run(world, DT, { moveX: 1 })
    run(world, 0.6)
    expect(player.grounded).toBe(true)
    expect(player.z).toBeCloseTo(1.2)
    expect(Math.floor(player.pos.x)).toBe(4)
    const events = run(world, 0.6, { moveX: 1 })
    expect(player.pos.x).toBeGreaterThan(5)
    expect(player.z).toBe(0)
    expect(events.some((event) => event.type === 'landed')).toBe(true)
  })

  it('cannot walk through a wall even from higher ground', () => {
    const world = scene(['##########', '#P..#....#', '##########'], ['0000000000', '0999000000', '0000000000'])
    run(world, 1, { moveX: 1 })
    expect(world.player.pos.x).toBeLessThanOrEqual(4 - world.player.radius + 1e-6)
  })
})

describe('dash', () => {
  it('covers five metres in a quarter second without taking damage, then waits three seconds', () => {
    const world = scene(WIDE)
    const { player, tuning } = world
    const start = player.pos.x
    const first = run(world, DT, { moveX: 1, dash: true })
    expect(first.some((event) => event.type === 'dashed')).toBe(true)
    expect(player.invulnerable).toBeGreaterThan(0)
    damagePlayer(world, 300, 1, 0, 0)
    expect(player.hp).toBe(player.maxHp)
    expect(world.events.some((event) => event.type === 'dodged')).toBe(true)
    run(world, tuning.player.dashTime)
    expect(player.pos.x - start).toBeCloseTo(tuning.player.dashDistance, 1)
    expect(player.invulnerable).toBeLessThan(1e-9)
    expect(player.dashCooldown).toBeGreaterThan(tuning.player.dashCooldown - 0.4)
    const early = run(world, DT, { moveX: -1, dash: true })
    expect(early.some((event) => event.type === 'dashed')).toBe(false)
    run(world, tuning.player.dashCooldown)
    const again = run(world, DT, { moveX: -1, dash: true })
    expect(again.some((event) => event.type === 'dashed')).toBe(true)
    expect(world.stats.dashes).toBe(2)
  })

  it('dashes where the player looks when no direction is held', () => {
    const world = scene(['########', '#......#', '#......#', '#......#', '#......#', '#......#', '#......#', '#..P...#', '########'])
    const { player } = world
    const start = player.pos.y
    run(world, 0.4, { aimX: player.pos.x, aimY: player.pos.y - 20, dash: true })
    expect(start - player.pos.y).toBeCloseTo(world.tuning.player.dashDistance, 1)
  })
})
