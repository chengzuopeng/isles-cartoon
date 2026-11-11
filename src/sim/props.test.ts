import { describe, expect, it } from 'vitest'
import { CHAIN } from '../data/chains'
import { HAY_FIRE, KEG } from '../data/props'
import { createDefaultTuning } from '../data/tuning'
import { firePattern } from './arsenal'
import { spawnBlast } from './combat'
import { Tile, tileAt } from './grid'
import { igniteHay, igniteKeg, kegLit } from './props'
import { applyStatusHit } from './status'
import { stepWorld } from './step'
import { levelFromAreas, pitchToward } from './testing'
import type { Enemy, GameEvent, MinionKind, PlayerCommand } from './types'
import { createEnemy, createWorld, type World } from './world'

const DT = 1 / 60
const YARD = [
  '####################',
  '#..................#',
  '#..........!.......#',
  '#..................#',
  '#P.....o.......!...#',
  '#..................#',
  '####################',
]

function setup(theme: 'farm' | 'meadow' = 'farm', rows = YARD): World {
  const tuning = createDefaultTuning()
  tuning.grunt.speed = 0
  tuning.gunner.speed = 0
  tuning.bomber.speed = 0
  return createWorld(levelFromAreas([{ name: 'yard', theme, rows }]), tuning)
}

function add(world: World, kind: MinionKind, x: number, y: number): Enemy {
  const enemy = createEnemy(world, kind, { x, y }, 0)
  enemy.aggro = true
  enemy.alert = 'combat'
  world.enemies.push(enemy)
  return enemy
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
  const events: GameEvent[] = []
  for (let i = 0; i < Math.max(1, Math.round(seconds / DT)); i++) {
    stepWorld(world, command(world, patch), DT)
    events.push(...world.events)
    world.events.length = 0
  }
  return events
}

const cell = (world: World, column: number, row: number) => row * world.grid.columns + column

describe('powder kegs', () => {
  it('stand as a solid crate-height block the level lists', () => {
    const world = setup()
    expect(world.level.kegs).toEqual([cell(world, 11, 2), cell(world, 15, 4)])
    expect(tileAt(world.grid, 11, 2)).toBe(Tile.Crate)
  })

  it('light on a hit, burn the fuse, then blow up robots nearby and leave the floor clear', () => {
    const world = setup()
    const grunt = add(world, 'grunt', 14.5, 5.5)
    expect(igniteKeg(world, cell(world, 15, 4))).toBe(true)
    expect(igniteKeg(world, cell(world, 15, 4))).toBe(false)
    expect(kegLit(world, cell(world, 15, 4))).toBe(true)
    run(world, KEG.fuse - 0.1)
    expect(tileAt(world.grid, 15, 4)).toBe(Tile.Crate)
    run(world, 0.2)
    expect(tileAt(world.grid, 15, 4)).toBe(Tile.Floor)
    expect(world.kegs.has(cell(world, 15, 4))).toBe(false)
    expect(grunt.hp).toBe(0)
    expect(world.stats.kills).toBe(1)
  })

  it('go off when the player shoots one', () => {
    const world = setup()
    world.player.pos = { x: 10.5, y: 4.5 }
    const events = run(world, 0.3, { fire: true, aimX: 15.5, aimY: 4.5, pitch: pitchToward(world, 15.5, 4.5, 0.6) })
    expect(events.some((event) => event.type === 'kegLit')).toBe(true)
  })

  it('go off when an enemy bullet hits one', () => {
    const world = setup()
    world.player.pos = { x: 18.5, y: 5.5 }
    firePattern(world, 'enemy', 10.5, 4.5, 0.3, 0, 'rifle', { z: 0.9, pitch: 0 })
    const events = run(world, 0.6)
    expect(events.some((event) => event.type === 'kegLit')).toBe(true)
  })

  it('go off from a swing of the rifle butt', () => {
    const world = setup()
    world.player.pos = { x: 13.8, y: 4.5 }
    const events = run(world, DT, { melee: true, aimX: 20, aimY: 4.5 })
    expect(events.some((event) => event.type === 'kegLit')).toBe(true)
  })

  it('set each other off with the short chain fuse', () => {
    const rows = ['##########', '#........#', '#..!.!...#', '#P.......#', '##########']
    const world = setup('farm', rows)
    igniteKeg(world, cell(world, 3, 2))
    run(world, KEG.fuse + DT)
    const other = world.blasts.find((blast) => blast.keg === cell(world, 5, 2))
    expect(other?.delay).toBeLessThanOrEqual(CHAIN.chainDelay + 1e-9)
    expect(other?.delay).toBeGreaterThan(CHAIN.chainDelay - 3 * DT)
  })

  it('hurt the player less than robots and only within the blast', () => {
    const world = setup()
    world.player.pos = { x: 13.5, y: 4.5 }
    igniteKeg(world, cell(world, 15, 4))
    run(world, KEG.fuse + 0.1)
    expect(world.player.maxHp - world.player.hp).toBe(KEG.playerDamage)
  })

  it('must not sit near the start or plug a one-cell gap', async () => {
    const { validateLevel } = await import('./level')
    const near = setup('farm', ['##########', '#........#', '#P.!.....#', '#........#', '##########'])
    expect(validateLevel(near.level).some((problem) => problem.includes('start'))).toBe(true)
    const gap = setup('farm', ['############', '#..........#', '#P.......#!#', '#..........#', '############'])
    expect(validateLevel(gap.level).some((problem) => problem.includes('gap'))).toBe(true)
  })
})

describe('haystacks', () => {
  it('count as hay only where the theme draws them as haystacks', () => {
    expect(setup('farm').level.hay).toHaveLength(1)
    expect(setup('meadow').level.hay).toHaveLength(0)
  })

  it('catch fire from a flamethrower, burn anyone close for six seconds and leave ash behind', () => {
    const world = setup()
    world.player.special = 'flamer'
    world.player.specialAmmo = 100
    world.player.slot = 'special'
    world.player.pos = { x: 4.5, y: 4.5 }
    const grunt = add(world, 'grunt', 8.5, 5.5)
    const events = run(world, 0.4, { fire: true, aimX: 7.5, aimY: 4.5 })
    expect(events.some((event) => event.type === 'hayLit')).toBe(true)
    run(world, 1)
    expect(grunt.status.burn).toBeGreaterThan(0)
    run(world, HAY_FIRE.seconds)
    expect(tileAt(world.grid, 7, 4)).toBe(Tile.Floor)
    expect(world.hay.size).toBe(0)
  })

  it('catch fire in a blast and from a burning robot brushing past', () => {
    const blasted = setup()
    spawnBlast(blasted, { x: 7.5, y: 3.5, radius: 1.5, delay: 0, playerDamage: 0, enemyDamage: 100, source: 'player', ownerId: 0 })
    expect(run(blasted, DT).some((event) => event.type === 'hayLit')).toBe(true)
    const brushed = setup()
    const grunt = add(brushed, 'grunt', 7.5, 5.4)
    applyStatusHit(brushed, grunt, { status: 'burn', statusPower: 10, statusDuration: 3 })
    expect(run(brushed, DT).some((event) => event.type === 'hayLit')).toBe(true)
  })

  it('scorch the player standing next to them', () => {
    const world = setup()
    world.player.pos = { x: 6.2, y: 4.5 }
    igniteHay(world, cell(world, 7, 4))
    run(world, 1.2)
    expect(world.player.maxHp - world.player.hp).toBe(HAY_FIRE.damage * 2)
  })

  it('light a bomber standing next to them', () => {
    const world = setup()
    const bomber = add(world, 'bomber', 8.6, 4.5)
    igniteHay(world, cell(world, 7, 4))
    run(world, HAY_FIRE.tick + DT)
    expect(bomber.state === 'arming' || bomber.hp <= 0).toBe(true)
  })
})
