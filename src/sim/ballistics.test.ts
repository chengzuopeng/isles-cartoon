import { describe, expect, it } from 'vitest'
import { EYE_CRIT, bodyHeightOf, eyeHeightOf } from '../data/heights'
import { createDefaultTuning } from '../data/tuning'
import { fireEnemyWeapon } from './arsenal'
import { lineClear } from './collision'
import { blastReaches } from './combat'
import { blocksSight } from './grid'
import { createFlowField, distanceAt, updateFlowField } from './pathing'
import { canSeePlayer } from './perception'
import { spawnBullet, updateBullets } from './projectiles'
import { eyeOf, playerChest, playerEye } from './terrain'
import { levelFromAreas } from './testing'
import type { Enemy, GameEvent, MinionKind } from './types'
import { createEnemy, createWorld, type World } from './world'

const DT = 1 / 60
const LANE = ['################', '#P.............#', '################']
const EYE = eyeHeightOf('player')

function scene(rows: string[], heights?: string[]): World {
  return createWorld(levelFromAreas([{ name: 'yard', theme: 'meadow', rows, heights }]), createDefaultTuning())
}

function add(world: World, kind: MinionKind, x: number, y: number, facing = Math.PI): Enemy {
  const enemy = createEnemy(world, kind, { x, y }, 0)
  enemy.facing = facing
  world.enemies.push(enemy)
  return enemy
}

function fly(world: World, seconds: number): GameEvent[] {
  const seen: GameEvent[] = []
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    updateBullets(world, DT)
    seen.push(...world.events)
    world.events.length = 0
  }
  return seen
}

describe('bullets in 2.5D', () => {
  it('fly along their pitch at the weapon speed and count range along the slanted path', () => {
    const world = scene(LANE)
    const pitch = 0.3
    const bullet = spawnBullet(world, 'player', 1.5, 1.5, 0, 0, 'blaster', { z: EYE, pitch })
    const speed = world.tuning.weapons.blaster.speed
    updateBullets(world, 0.1)
    expect(bullet.z).toBeCloseTo(EYE + Math.sin(pitch) * speed * 0.1, 5)
    expect(bullet.pos.x).toBeCloseTo(1.5 + Math.cos(pitch) * speed * 0.1, 5)
    expect(bullet.traveled).toBeCloseTo(speed * 0.1, 5)
    expect(Math.hypot(bullet.speed, bullet.vz)).toBeCloseTo(speed, 5)
  })

  it('hit a wall below its top and fly over it above', () => {
    const world = scene(['################', '#P.....#.......#', '################'])
    const low = spawnBullet(world, 'player', 1.5, 1.5, 0, 0, 'sniper', { z: 2.5 })
    const high = spawnBullet(world, 'player', 1.5, 1.5, 0, 0, 'sniper', { z: 3.5 })
    const events = fly(world, 0.25)
    expect(events.filter((event) => event.type === 'bulletHitWall')).toEqual([expect.objectContaining({ z: 2.5 })])
    expect(world.bullets).not.toContain(low)
    expect(high.pos.x).toBeGreaterThan(8)
  })

  it('stop in the ground when aimed down, where they land', () => {
    const world = scene(LANE)
    const pitch = -0.5
    spawnBullet(world, 'player', 1.5, 1.5, 0, 0, 'blaster', { z: EYE, pitch })
    const hit = fly(world, 0.3).find((event) => event.type === 'bulletHitWall')
    expect(hit).toMatchObject({ z: 0 })
    expect(hit?.type === 'bulletHitWall' && hit.x).toBeCloseTo(1.5 + EYE / Math.tan(0.5), 0)
  })

  it('only hit an enemy inside the height of its body', () => {
    const world = scene(LANE)
    const grunt = add(world, 'grunt', 6.5, 1.5)
    spawnBullet(world, 'player', 1.5, 1.5, 0, 0, 'blaster', { z: bodyHeightOf('grunt') + 0.3 })
    fly(world, 0.5)
    expect(grunt.hp).toBe(grunt.maxHp)
    spawnBullet(world, 'player', 1.5, 1.5, 0, 0, 'blaster', { z: 0.4 })
    fly(world, 0.5)
    expect(grunt.hp).toBe(grunt.maxHp - world.tuning.weapons.blaster.damage)
  })

  it('double the damage on the eye lamp when they come from the front, but not from behind', () => {
    const world = scene(LANE)
    const damage = world.tuning.weapons.blaster.damage
    const facing = add(world, 'grunt', 6.5, 1.5, Math.PI)
    const eye = facing.z + eyeHeightOf('grunt')
    spawnBullet(world, 'player', 1.5, 1.5, 0, 0, 'blaster', { z: eye })
    const front = fly(world, 0.5).find((event) => event.type === 'enemyHit')
    expect(front).toMatchObject({ id: facing.id, crit: true, damage: damage * EYE_CRIT.scale })
    expect(facing.hp).toBe(facing.maxHp - damage * EYE_CRIT.scale)
    world.enemies = []
    const turned = add(world, 'grunt', 6.5, 1.5, 0)
    spawnBullet(world, 'player', 1.5, 1.5, 0, 0, 'blaster', { z: eye })
    const back = fly(world, 0.5).find((event) => event.type === 'enemyHit')
    expect(back).toMatchObject({ id: turned.id, crit: false, damage })
    spawnBullet(world, 'player', 1.5, 1.5, 0, 0, 'blaster', { z: eye - EYE_CRIT.band - 0.1 })
    world.enemies[0].facing = Math.PI
    expect(fly(world, 0.5).find((event) => event.type === 'enemyHit')).toMatchObject({ crit: false })
    expect(world.stats.crits).toBe(1)
  })
})

describe('half cover', () => {
  const ROWS = ['##########', '#P.o....r#', '##########']

  it('takes the shots aimed at the chest but lets the hero shoot over it from eye height', () => {
    const world = scene(ROWS)
    const { player } = world
    const gunner = world.enemies[0]
    fireEnemyWeapon(world, gunner, 'rifle', Math.PI)
    const events = fly(world, 1)
    expect(events.some((event) => event.type === 'bulletHitWall')).toBe(true)
    expect(player.hp).toBe(player.maxHp)
    spawnBullet(world, 'player', player.pos.x, player.pos.y, 0.45, 0, 'blaster', { z: player.z + EYE })
    fly(world, 0.5)
    expect(gunner.hp).toBeLessThan(gunner.maxHp)
  })

  it('stops protecting a hero who is shot at from higher ground', () => {
    const world = scene(ROWS, ['0000000000', '0000000444', '0000000000'])
    const { player } = world
    const gunner = world.enemies[0]
    expect(gunner.z).toBe(2)
    fireEnemyWeapon(world, gunner, 'rifle', Math.PI)
    fly(world, 1)
    expect(player.hp).toBe(player.maxHp - world.tuning.weapons.rifle.damage)
  })
})

describe('sight with heights', () => {
  it('is blocked by a rock between a low robot and the hero, but not for a gunner up on a ledge', () => {
    const flat = scene(['############', '#.P.o.....m#', '############'])
    const grunt = flat.enemies[0]
    grunt.aggro = true
    expect(canSeePlayer(flat, grunt, 20)).toBe(false)
    const high = scene(['############', '#.P.o.....r#', '############'], ['000000000000', '000000000550', '000000000000'])
    const gunner = high.enemies[0]
    gunner.aggro = true
    expect(gunner.z).toBe(2.5)
    expect(canSeePlayer(high, gunner, 20)).toBe(true)
  })

  it('is blocked by a hill even without anything standing on it', () => {
    const world = scene(['############', '#.P.......m#', '############'], ['000000000000', '000004400000', '000000000000'])
    const grunt = world.enemies[0]
    grunt.aggro = true
    expect(lineClear(world.grid, eyeOf(grunt), playerChest(world.player), blocksSight)).toBe(false)
    expect(canSeePlayer(world, grunt, 20)).toBe(false)
    expect(lineClear(world.grid, { ...playerEye(world.player), z: 5 }, { ...eyeOf(grunt), z: 5 }, blocksSight)).toBe(true)
  })
})

describe('paths with heights', () => {
  it('connect cells half a metre apart but not a full metre', () => {
    const steps = scene(['#########', '#P......#', '#########'], ['000000000', '001234550', '000000000'])
    const field = createFlowField(steps.grid)
    updateFlowField(field, steps.grid, steps.player.pos)
    expect(distanceAt(field, steps.grid, 7, 1)).toBe(6)
    const cliff = scene(['#########', '#P......#', '#########'], ['000000000', '000222200', '000000000'])
    const blocked = createFlowField(cliff.grid)
    updateFlowField(blocked, cliff.grid, cliff.player.pos)
    expect(distanceAt(blocked, cliff.grid, 4, 1)).toBe(Infinity)
    expect(distanceAt(blocked, cliff.grid, 2, 1)).toBe(1)
  })

  it('still lead enemies to a hero standing on a rock they cannot climb', () => {
    const world = scene(['#########', '#P..o...#', '#########'])
    world.player.pos = { x: 4.5, y: 1.5 }
    const field = createFlowField(world.grid)
    updateFlowField(field, world.grid, world.player.pos)
    expect(distanceAt(field, world.grid, 5, 1)).toBe(1)
    expect(distanceAt(field, world.grid, 7, 1)).toBe(3)
  })
})

describe('blasts in two and a half dimensions', () => {
  it('reaches a little above and below its centre but not a hero standing on a ledge far above it', () => {
    const blast = { z: 0, radius: 2 } as Parameters<typeof blastReaches>[0]
    expect(blastReaches(blast, 0, 1.6)).toBe(true)
    expect(blastReaches(blast, 1.4, 1.6)).toBe(true)
    expect(blastReaches(blast, 1.6, 1.6)).toBe(false)
    expect(blastReaches(blast, -2.5, 1.6)).toBe(true)
    expect(blastReaches(blast, -2.7, 1.6)).toBe(false)
  })
})
