import { describe, expect, it } from 'vitest'
import { createDefaultTuning } from '../data/tuning'
import { stepWorld } from './step'
import { pitchAt, singleArea } from './testing'
import type { PlayerCommand } from './types'
import { createWorld, type World } from './world'

const DT = 1 / 60

function idle(aimX = 100, aimY = 1.5): PlayerCommand {
  return { moveX: 0, moveY: 0, aimX, aimY, fire: false, slot: null, interact: false, skill: null, ultimate: false, pitch: 0, jump: false, dash: false, melee: false }
}

function setup(rows: string[]) {
  const tuning = createDefaultTuning()
  const world = createWorld(singleArea(rows), tuning)
  return { world, tuning }
}

function faceWest(world: World): void {
  for (const enemy of world.enemies) {
    enemy.facing = Math.PI
    enemy.baseFacing = Math.PI
  }
}

function run(world: World, command: PlayerCommand, seconds: number): void {
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) stepWorld(world, command, DT)
}

function count(world: World, type: string): number {
  return world.events.filter((event) => event.type === type).length
}

describe('perception', () => {
  it('notices a player in sight and in line of sight after a moment of looking', () => {
    const { world } = setup(['##########', '#P.....m.#', '##########'])
    faceWest(world)
    stepWorld(world, idle(), DT)
    expect(world.enemies[0].aggro).toBe(false)
    expect(world.enemies[0].notice).toBeGreaterThan(0)
    run(world, idle(), 0.6)
    expect(world.enemies[0].aggro).toBe(true)
    expect(world.enemies[0].notice).toBe(1)
    expect(count(world, 'enemyAlerted')).toBe(1)
  })

  it('lets the notice meter drain again when the player ducks out of sight', () => {
    const { world } = setup(['##########', '#P.....m.#', '##########'])
    faceWest(world)
    run(world, idle(), 0.2)
    const half = world.enemies[0].notice
    expect(half).toBeGreaterThan(0.2)
    world.player.pos = { x: 1.5, y: 1.5 }
    world.grid.tiles[1 * world.grid.columns + 3] = world.grid.tiles[0]
    world.grid.top[1 * world.grid.columns + 3] = 3
    run(world, idle(), 0.5)
    expect(world.enemies[0].notice).toBeLessThan(half)
    expect(world.enemies[0].aggro).toBe(false)
  })

  it('notices a player right next to it at once', () => {
    const { world } = setup(['##########', '#P.m.....#', '##########'])
    faceWest(world)
    stepWorld(world, idle(), DT)
    expect(world.enemies[0].aggro).toBe(true)
  })

  it('does not see through walls', () => {
    const { world } = setup(['##########', '#P..#..m.#', '##########'])
    run(world, idle(), 0.5)
    expect(world.enemies[0].aggro).toBe(false)
  })

  it('does not notice a player beyond its sight', () => {
    const { world } = setup(['####################', '#P................m#', '####################'])
    run(world, idle(), 0.5)
    expect(world.enemies[0].aggro).toBe(false)
  })

  it('only notices a player hiding in a bush from up close', () => {
    const { world } = setup(['##########', '#P"""m...#', '##########'])
    world.player.pos = { x: 2.5, y: 1.5 }
    run(world, idle(), 0.3)
    expect(world.enemies[0].aggro).toBe(false)
    world.player.pos = { x: 4.5, y: 1.5 }
    stepWorld(world, idle(), DT)
    expect(world.enemies[0].aggro).toBe(true)
  })

  it('calls nearby allies who cannot see the player', () => {
    const { world } = setup(['############', '#P....m....#', '#######.####', '#......m...#', '############'])
    faceWest(world)
    run(world, idle(), 0.6)
    expect(world.enemies.every((enemy) => enemy.aggro)).toBe(true)
  })
})

describe('gunner', () => {
  it('aims, fires a bullet and hurts the player', () => {
    const { world, tuning } = setup(['############', '#P.....r...#', '############'])
    run(world, idle(), 2.5)
    expect(count(world, 'enemyShot')).toBe(1)
    expect(world.player.hp).toBe(tuning.player.maxHp - tuning.weapons.rifle.damage)
  })

  it('backs away when the player gets too close', () => {
    const { world } = setup(['##############', '#....P.r.....#', '##############'])
    world.enemies[0].cooldown = 10
    run(world, idle(), 1)
    expect(world.enemies[0].pos.x - world.player.pos.x).toBeGreaterThan(2.5)
  })
})

describe('bomber', () => {
  it('arms next to the player and blows up', () => {
    const { world, tuning } = setup(['##########', '#P.b.....#', '##########'])
    run(world, idle(), 1.5)
    expect(count(world, 'blast')).toBe(1)
    expect(world.enemies).toHaveLength(0)
    expect(world.player.hp).toBe(tuning.player.maxHp - tuning.weapons.fuse.damage)
  })

  it('explodes when shot and hurts enemies around it', () => {
    const { world, tuning } = setup(['##############', '#P......bm...#', '##############'])
    tuning.bomber.speed = 0
    tuning.grunt.speed = 0
    tuning.weapons.blaster.burstCount = 1
    const [bomber, grunt] = world.enemies
    bomber.hp = 10
    const pitch = pitchAt(world, bomber)
    stepWorld(world, { ...idle(8.5, 1.5), pitch, fire: true }, DT)
    run(world, { ...idle(8.5, 1.5), pitch }, 0.8)
    expect(count(world, 'blast')).toBe(1)
    expect(grunt.hp).toBe(tuning.grunt.maxHp - tuning.weapons.fuse.enemyDamage)
  })
})

describe('turret', () => {
  it('fires a spread of bullets at a player it can see', () => {
    const { world, tuning } = setup(['############', '#P.....t...#', '############'])
    run(world, idle(), tuning.weapons.cannon.windup + 0.65)
    expect(count(world, 'enemyShot')).toBe(1)
    expect(world.bullets.filter((bullet) => bullet.team === 'enemy')).toHaveLength(tuning.weapons.cannon.pellets)
  })
})
