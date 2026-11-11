import { describe, expect, it } from 'vitest'
import { CHAIN } from '../data/chains'
import { createDefaultTuning } from '../data/tuning'
import { spawnBlast } from './combat'
import { spawnLob } from './lobs'
import { applyStatusHit, freezeEnemy } from './status'
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

function setup(rows = FIELD, heights?: string[]): World {
  const tuning = createDefaultTuning()
  tuning.grunt.speed = 0
  tuning.gunner.speed = 0
  tuning.bomber.speed = 0
  return createWorld(levelFromAreas([{ name: 'yard', theme: 'meadow', rows, heights }]), tuning)
}

function add(world: World, kind: MinionKind, x: number, y: number): Enemy {
  const enemy = createEnemy(world, kind, { x, y }, 0)
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
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    stepWorld(world, command(world, patch), DT)
    events.push(...world.events)
    world.events.length = 0
  }
  return events
}

function combos(events: GameEvent[]): string[] {
  return events.flatMap((event) => (event.type === 'combo' ? [event.kind] : []))
}

describe('frozen robots shatter', () => {
  it('smashes a frozen charger at full health with one swing and drops food', () => {
    const world = setup()
    const grunt = add(world, 'grunt', world.player.pos.x + 1.2, world.player.pos.y)
    freezeEnemy(world, grunt, 1.5)
    const events = run(world, DT, { melee: true })
    expect(grunt.hp).toBe(0)
    expect(events.some((event) => event.type === 'smashed' && event.id === grunt.id)).toBe(true)
    expect(combos(events)).toContain('shatter')
    expect(world.pickups.some((pickup) => pickup.item.type === 'heal' && pickup.item.food !== undefined)).toBe(true)
  })
})

describe('burning bombers light their fuse', () => {
  it('starts the fuse the moment a bomber catches fire, even before it noticed anyone', () => {
    const world = setup()
    const bomber = add(world, 'bomber', 16, 3.5)
    applyStatusHit(world, bomber, { status: 'burn', statusPower: 40, statusDuration: 3 })
    expect(bomber.state).toBe('arming')
    expect(world.blasts.some((blast) => blast.ownerId === bomber.id)).toBe(true)
    expect(combos(world.events)).toEqual(['fuse'])
  })

  it('lights it again after a shove put the fuse out, as long as it still burns', () => {
    const world = setup()
    const bomber = add(world, 'bomber', 16, 3.5)
    applyStatusHit(world, bomber, { status: 'burn', statusPower: 1, statusDuration: 3 })
    world.blasts = world.blasts.filter((blast) => blast.ownerId !== bomber.id)
    bomber.state = 'chase'
    run(world, 0.1)
    expect(world.blasts.some((blast) => blast.ownerId === bomber.id)).toBe(true)
  })
})

describe('chargers ram their own side', () => {
  function charge(grunt: Enemy): void {
    grunt.aggro = true
    grunt.alert = 'combat'
    grunt.state = 'dash'
    grunt.stateTime = 0
    grunt.aimAngle = 0
    grunt.dashFrom = { x: grunt.pos.x, y: grunt.pos.y }
    grunt.dashHit = false
  }

  it('knocks an ally in its path aside, leaves it reeling and gets dizzy itself', () => {
    const world = setup()
    world.player.pos = { x: 3, y: 6 }
    const grunt = add(world, 'grunt', 8, 3.5)
    const ally = add(world, 'gunner', 10, 3.5)
    charge(grunt)
    const events = run(world, 0.2)
    expect(combos(events)).toContain('pileup')
    expect(ally.pos.x).toBeGreaterThan(10.8)
    expect(ally.status.dazed).toBeGreaterThan(0)
    expect(grunt.state).toBe('recover')
    expect(grunt.status.stunned).toBeGreaterThan(0)
  })

  it('sets off a bomber it runs into', () => {
    const world = setup()
    world.player.pos = { x: 3, y: 6 }
    const grunt = add(world, 'grunt', 8, 3.5)
    const bomber = add(world, 'bomber', 10, 3.5)
    charge(grunt)
    run(world, 0.2)
    expect(bomber.state).toBe('arming')
    expect(world.blasts.some((blast) => blast.ownerId === bomber.id)).toBe(true)
  })

  it('ignores allies standing beside its path', () => {
    const world = setup()
    world.player.pos = { x: 3, y: 6 }
    const grunt = add(world, 'grunt', 8, 3.5)
    const ally = add(world, 'gunner', 8, 4.3)
    charge(grunt)
    const events = run(world, 0.1)
    expect(combos(events)).not.toContain('pileup')
    expect(ally.status.dazed).toBe(0)
  })
})

describe('enemy bombs hurt robots too', () => {
  it('takes half again the player damage off a charger caught under a thrower bomb', () => {
    const world = setup()
    const thrower = add(world, 'thrower', 16, 5.5)
    const grunt = add(world, 'grunt', 12, 3.5)
    spawnLob(world, 'enemy', thrower.pos, grunt.pos, 'bomb')
    const events = run(world, 1.5)
    expect(grunt.maxHp - grunt.hp).toBe(world.tuning.weapons.bomb.enemyDamage)
    expect(world.tuning.weapons.bomb.enemyDamage).toBe(world.tuning.weapons.bomb.splash * 1.5)
    expect(combos(events)).toContain('friendly')
  })

  it('credits the player with robots killed by their own side', () => {
    const world = setup()
    const thrower = add(world, 'thrower', 16, 5.5)
    const bomber = add(world, 'bomber', 12, 3.5)
    spawnLob(world, 'enemy', thrower.pos, bomber.pos, 'bomb')
    run(world, 1.5)
    expect(bomber.hp).toBe(0)
    expect(world.stats.kills).toBe(1)
  })
})

describe('blasts set off what they reach', () => {
  it('lights a bomber the concussion grenade only stunned, and it goes off where it stands', () => {
    const world = setup()
    const bomber = add(world, 'bomber', 12, 3.5)
    const grunt = add(world, 'grunt', 13, 3.5)
    spawnBlast(world, { x: 12, y: 3.5, radius: 3, delay: 0, playerDamage: 0, enemyDamage: 60, source: 'player', ownerId: 0, stun: 1.2 })
    const events = run(world, DT)
    expect(bomber.hp).toBeGreaterThan(0)
    expect(bomber.state).toBe('arming')
    expect(combos(events)).toContain('chain')
    run(world, world.tuning.weapons.fuse.windup + 0.1)
    expect(bomber.hp).toBe(0)
    expect(grunt.hp).toBe(0)
  })

  it('hurries a pending fuse or volatile blast but never lights the same one twice', () => {
    const world = setup()
    const pending = spawnBlast(world, { x: 12, y: 3.5, radius: 1.8, delay: 2, playerDamage: 0, enemyDamage: 0, source: 'bomber', ownerId: 0, chainable: true })
    const boss = spawnBlast(world, { x: 12.5, y: 3.5, radius: 2, delay: 2, playerDamage: 0, enemyDamage: 0, source: 'boss', ownerId: 0 })
    spawnBlast(world, { x: 11, y: 3.5, radius: 2, delay: 0, playerDamage: 0, enemyDamage: 100, source: 'player', ownerId: 0 })
    run(world, DT)
    expect(pending.delay).toBeCloseTo(CHAIN.chainDelay, 5)
    expect(boss.delay).toBeCloseTo(2 - DT, 5)
  })

  it('lets boss shockwaves pass a bomber without lighting it', () => {
    const world = setup()
    const bomber = add(world, 'bomber', 12, 3.5)
    spawnBlast(world, { x: 12, y: 3.5, radius: 3, delay: 0, playerDamage: 100, enemyDamage: 0, source: 'boss', ownerId: 0 })
    run(world, DT)
    expect(bomber.state).not.toBe('arming')
  })
})

describe('knocked off a ledge', () => {
  const LEDGE = [
    '############',
    '#..........#',
    '#..........#',
    '#..P.......#',
    '#..........#',
    '############',
  ]
  const HIGH = ['000000000000', '000000000000', '066666000000', '066666000000', '066666000000', '000000000000']

  it('falls off the edge, takes damage for the drop and reels where it lands', () => {
    const world = setup(LEDGE, HIGH)
    world.player.pos = { x: 3.5, y: 3.5 }
    world.player.z = 3
    const gunner = add(world, 'gunner', 5.3, 3.5)
    expect(gunner.z).toBe(3)
    const events = run(world, 1.2, { melee: true })
    expect(gunner.z).toBe(0)
    expect(gunner.pos.x).toBeGreaterThan(6)
    expect(combos(events)).toContain('fall')
    expect(gunner.maxHp - gunner.hp).toBeGreaterThanOrEqual(CHAIN.fallDamage * 3)
    expect(gunner.status.dazed > 0 || gunner.hp <= 0).toBe(true)
  })

  it('stays on a platform when nothing shoves it', () => {
    const world = setup(LEDGE, HIGH)
    world.player.pos = { x: 9.5, y: 1.5 }
    const gunner = add(world, 'gunner', 5.3, 3.5)
    run(world, 1)
    expect(gunner.z).toBe(3)
  })

  it('drops less than a metre without getting hurt', () => {
    const low = ['000000000000', '000000000000', '011111000000', '011111000000', '011111000000', '000000000000']
    const world = setup(LEDGE, low)
    world.player.pos = { x: 3.5, y: 3.5 }
    world.player.z = 0.5
    const gunner = add(world, 'gunner', 5.3, 3.5)
    const before = gunner.hp
    const events = run(world, 1, { melee: true })
    expect(combos(events)).not.toContain('fall')
    expect(gunner.hp).toBe(before - world.tuning.player.meleeDamage)
  })
})
