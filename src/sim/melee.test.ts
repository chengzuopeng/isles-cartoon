import { describe, expect, it } from 'vitest'
import { FOOD_HEAL, PICKUP_DELAY } from '../data/loot'
import { createDefaultTuning } from '../data/tuning'
import { crumbling, foodOf } from './melee'
import { stepWorld } from './step'
import { levelFromAreas } from './testing'
import type { Enemy, GameEvent, MinionKind, PlayerCommand } from './types'
import { createEnemy, createWorld, type World } from './world'

const DT = 1 / 60
const FIELD = [
  '####################',
  '#..................#',
  '#..................#',
  '#....P.............#',
  '#..................#',
  '#..................#',
  '#..................#',
  '####################',
]

function setup(): World {
  const tuning = createDefaultTuning()
  tuning.grunt.speed = 0
  tuning.gunner.speed = 0
  return createWorld(levelFromAreas([{ name: 'yard', theme: 'meadow', rows: FIELD }]), tuning)
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

function swing(world: World): GameEvent[] {
  stepWorld(world, command(world, { melee: true }), DT)
  const events = [...world.events]
  world.events.length = 0
  return events
}

function run(world: World, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) stepWorld(world, command(world), DT)
  world.events.length = 0
}

function add(world: World, kind: MinionKind, x: number, y: number): Enemy {
  const enemy = createEnemy(world, kind, { x, y }, 0)
  enemy.aggro = true
  enemy.alert = 'combat'
  world.enemies.push(enemy)
  return enemy
}

describe('melee', () => {
  it('hits every robot within two metres and forty degrees either side of the aim', () => {
    const world = setup()
    const damage = world.tuning.player.meleeDamage
    const ahead = add(world, 'grunt', 7.2, 3.5)
    const aside = add(world, 'grunt', 6.9, 4.4)
    const beside = add(world, 'grunt', 5.5, 5.2)
    const far = add(world, 'grunt', 8.9, 3.5)
    const events = swing(world)
    expect(events.filter((event) => event.type === 'melee')).toEqual([expect.objectContaining({ hits: 2 })])
    expect(ahead.hp).toBe(ahead.maxHp - damage)
    expect(aside.hp).toBe(aside.maxHp - damage)
    expect(beside.hp).toBe(beside.maxHp)
    expect(far.hp).toBe(far.maxHp)
    expect(world.stats.melees).toBe(1)
    expect(world.stats.meleeHits).toBe(2)
  })

  it('swings at the air too, so the hands still move', () => {
    const world = setup()
    expect(swing(world).filter((event) => event.type === 'melee')).toEqual([expect.objectContaining({ hits: 0 })])
  })

  it('sends a robot flying about three and a half metres', () => {
    const world = setup()
    const grunt = add(world, 'grunt', 7.2, 3.5)
    swing(world)
    run(world, 1)
    expect(grunt.pos.x - 7.2).toBeGreaterThan(3)
    expect(grunt.pos.x - 7.2).toBeLessThan(4.2)
  })

  it('knocks over a second robot the flying one runs into, leaving it open to a smash', () => {
    const world = setup()
    add(world, 'grunt', 7.2, 3.5)
    const behind = add(world, 'grunt', 8.6, 3.5)
    const events = swing(world)
    for (let i = 0; i < 30; i++) {
      stepWorld(world, command(world), DT)
      events.push(...world.events)
      world.events.length = 0
    }
    expect(events.some((event) => event.type === 'enemyBumped' && event.id === behind.id)).toBe(true)
    expect(behind.pos.x).toBeGreaterThan(8.7)
    expect(crumbling(world, behind)).toBe(true)
  })

  it('interrupts a charger winding up a claw and a gunner taking aim', () => {
    const world = setup()
    const grunt = add(world, 'grunt', 7.0, 3.5)
    const gunner = add(world, 'gunner', 6.8, 2.9)
    grunt.aggro = gunner.aggro = true
    grunt.state = 'windup'
    gunner.state = 'aim'
    swing(world)
    expect(grunt.state).toBe('recover')
    expect(gunner.state).toBe('recover')
  })

  it('waits between swings', () => {
    const world = setup()
    expect(swing(world).some((event) => event.type === 'melee')).toBe(true)
    run(world, world.tuning.player.meleeCooldown / 2)
    expect(swing(world).some((event) => event.type === 'melee')).toBe(false)
    run(world, world.tuning.player.meleeCooldown / 2)
    expect(swing(world).some((event) => event.type === 'melee')).toBe(true)
  })
})

describe('smashing', () => {
  it('breaks a robot that is about to fall apart into food that flies to the hero and heals fifteen percent', () => {
    const world = setup()
    const { player } = world
    const grunt = add(world, 'grunt', 7.0, 3.5)
    grunt.hp = grunt.maxHp * 0.25
    expect(crumbling(world, grunt)).toBe(true)
    const events = swing(world)
    expect(events.find((event) => event.type === 'smashed')).toMatchObject({ id: grunt.id, kind: 'grunt' })
    expect(events.find((event) => event.type === 'enemyKilled' && event.id === grunt.id)).toMatchObject({ dirX: 1, dirY: 0 })
    expect(world.stats.kills).toBe(1)
    expect(world.stats.smashes).toBe(1)
    expect(world.pickups.map((pickup) => pickup.item)).toEqual([{ type: 'heal', amount: FOOD_HEAL, food: foodOf(grunt) }])
    expect(FOOD_HEAL).toBe(0.15)
    player.hp = 500
    run(world, PICKUP_DELAY + 0.5)
    expect(world.pickups).toHaveLength(0)
    expect(player.hp).toBeCloseTo(500 + player.maxHp * FOOD_HEAL)
    expect(world.stats.foodHealed).toBeCloseTo(player.maxHp * FOOD_HEAL)
  })

  it('hands out bread and apples by turns', () => {
    const world = setup()
    const first = add(world, 'grunt', 7, 3.5)
    const second = add(world, 'grunt', 7, 5.5)
    expect(new Set([foodOf(first), foodOf(second)])).toEqual(new Set(['bread', 'apple']))
  })

  it('also breaks a charger dizzy after missing its rush', () => {
    const world = setup()
    const grunt = add(world, 'grunt', 7.0, 3.5)
    grunt.aggro = true
    grunt.state = 'dash'
    grunt.aimAngle = Math.PI / 2
    grunt.stateTime = 10
    grunt.dashHit = false
    run(world, DT)
    expect(grunt.status.dazed).toBeGreaterThan(0)
    expect(crumbling(world, grunt)).toBe(true)
    expect(swing(world).some((event) => event.type === 'smashed')).toBe(true)
  })

  it('only hurts the boss: no smash and no knockback', () => {
    const world = createWorld(
      levelFromAreas(
        [
          { name: 'gate', theme: 'meadow', rows: ['#.........#', '#....P....#', '###########'] },
          {
            name: 'arena',
            theme: 'arena',
            kind: 'boss',
            rows: ['###########', '#.........#', '#.........#', '#....B....#', '#.........#', '#.........#', '#.........#', '####DDD####'],
          },
        ],
        { bossId: 'scarecrow' },
      ),
      createDefaultTuning(),
    )
    const boss = world.boss!
    boss.boss!.phase = 'recover'
    boss.boss!.timer = 10
    boss.hp = boss.maxHp * 0.1
    const { player } = world
    player.pos = { x: boss.pos.x, y: boss.pos.y + boss.radius + 1 }
    const before = { ...boss.pos }
    const hp = boss.hp
    stepWorld(world, command(world, { aimX: boss.pos.x, aimY: boss.pos.y, melee: true }), DT)
    expect(world.events.some((event) => event.type === 'smashed')).toBe(false)
    expect(boss.hp).toBe(hp - world.tuning.player.meleeDamage)
    expect(boss.pos).toEqual(before)
  })
})
