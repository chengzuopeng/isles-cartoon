import { describe, expect, it } from 'vitest'
import { WEAK_POINTS, WEAK_POINT_SCALE, eyeHeightOf } from '../data/heights'
import { getBoss, type BossMoveId } from '../data/bosses'
import { createDefaultTuning } from '../data/tuning'
import { bossExposed } from './boss'
import { spawnBullet, updateBullets } from './projectiles'
import { stepWorld } from './step'
import { levelFromAreas } from './testing'
import type { Enemy, GameEvent, PlayerCommand } from './types'
import { createWorld, type World } from './world'

const DT = 1 / 60
const DEF = getBoss('scarecrow')
const RING = DEF.ring!
const WEAPONS = createDefaultTuning().weapons

const ARENA = levelFromAreas(
  [
    { name: 'gate', theme: 'meadow', rows: ['#...................#', '#.........P.........#', '#####################'] },
    {
      name: 'arena',
      theme: 'arena',
      kind: 'boss',
      rows: [
        '#########DDD#########',
        '#...................#',
        '#...................#',
        '#.........B.........#',
        '#...................#',
        '#...................#',
        '#...................#',
        '#...................#',
        '#...................#',
        '#.............o.....#',
        '#...................#',
        '#########DDD#########',
      ],
    },
    { name: 'exit', theme: 'meadow', rows: ['#####################', '#.........X.........#', '#...................#'] },
  ],
  { bossId: 'scarecrow' },
)

function command(world: World, patch: Partial<PlayerCommand> = {}): PlayerCommand {
  const boss = world.boss!
  return {
    moveX: 0,
    moveY: 0,
    aimX: boss.pos.x,
    aimY: boss.pos.y,
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

function fight(): World {
  const world = createWorld(ARENA, createDefaultTuning())
  world.player.pos = { x: 10.5, y: 10.5 }
  world.player.prev = { x: 10.5, y: 10.5 }
  run(world, DT)
  return world
}

function force(world: World, move: BossMoveId): void {
  const state = world.boss!.boss!
  state.order = [move]
  state.moveIndex = 0
  state.phase = 'walk'
  state.timer = 0
}

function untilRing(world: World): GameEvent[] {
  const seen: GameEvent[] = []
  for (let i = 0; i < 300 && world.rings.length === 0; i++) seen.push(...run(world, DT))
  return seen
}

function gap(world: World): number {
  const ring = world.rings[0]
  return Math.hypot(world.player.pos.x - ring.x, world.player.pos.y - ring.y)
}

describe('shockwave ring', () => {
  it('waits for the pitchfork to come down, then rolls out from the boss feet', () => {
    const world = fight()
    force(world, 'slam')
    const before = untilRing(world)
    expect(before.some((event) => event.type === 'bossMove' && event.move === 'slam')).toBe(true)
    const ring = world.rings[0]
    expect(ring).toMatchObject({ maxRadius: RING.radius, height: RING.height, speed: RING.speed, damage: WEAPONS.strawSlam.damage, hitPlayer: false })
    expect(ring.x).toBeCloseTo(world.boss!.pos.x, 1)
    expect(ring.z).toBe(world.boss!.z)
    expect(ring.radius).toBeCloseTo(RING.speed * DT, 5)
    run(world, RING.radius / RING.speed + 0.1)
    expect(world.rings).toHaveLength(0)
  })

  it('hits a player standing on the ground once as it passes', () => {
    const world = fight()
    force(world, 'slam')
    untilRing(world)
    const events = run(world, 1)
    expect(events.filter((event) => event.type === 'playerHit')).toHaveLength(1)
    expect(world.player.hp).toBe(world.player.maxHp - WEAPONS.strawSlam.damage)
  })

  it('misses a player who jumps over it', () => {
    const world = fight()
    force(world, 'slam')
    untilRing(world)
    const reach = (gap(world) - world.player.radius) / RING.speed
    run(world, reach - 0.2)
    run(world, DT, { jump: true })
    const events = run(world, 1)
    expect(events.some((event) => event.type === 'playerHit')).toBe(false)
    expect(world.player.hp).toBe(world.player.maxHp)
  })

  it('lets a dash carry the player through it untouched', () => {
    const world = fight()
    force(world, 'slam')
    untilRing(world)
    const { player } = world
    const boss = world.boss!
    const reach = (gap(world) - player.radius) / RING.speed
    run(world, reach - 0.08)
    const length = Math.hypot(boss.pos.x - player.pos.x, boss.pos.y - player.pos.y)
    const inward = { moveX: (boss.pos.x - player.pos.x) / length, moveY: (boss.pos.y - player.pos.y) / length }
    const events = run(world, DT, { ...inward, dash: true })
    events.push(...run(world, 1))
    expect(events.some((event) => event.type === 'dodged')).toBe(true)
    expect(events.some((event) => event.type === 'playerHit')).toBe(false)
    expect(player.hp).toBe(player.maxHp)
  })

  it('passes under a player standing on a rock', () => {
    const world = fight()
    const { player } = world
    player.pos = { x: 14.5, y: 12.5 }
    player.prev = { x: 14.5, y: 12.5 }
    player.z = 1.2
    run(world, 0.1)
    expect(player.z).toBeCloseTo(1.2)
    expect(player.grounded).toBe(true)
    force(world, 'slam')
    untilRing(world)
    const events = run(world, RING.radius / RING.speed + 0.1)
    expect(world.rings).toHaveLength(0)
    expect(events.some((event) => event.type === 'playerHit')).toBe(false)
    expect(player.hp).toBe(player.maxHp)
  })
})

describe('weak point', () => {
  function shoot(world: World, height: number): GameEvent | undefined {
    const { player } = world
    const boss = world.boss!
    const weak = WEAK_POINTS.scarecrow
    const x = boss.pos.x + Math.cos(boss.facing) * weak.forward
    const y = boss.pos.y + Math.sin(boss.facing) * weak.forward
    const eye = player.z + eyeHeightOf('player')
    const angle = Math.atan2(y - player.pos.y, x - player.pos.x)
    const pitch = Math.atan2(boss.z + height - eye, Math.hypot(x - player.pos.x, y - player.pos.y))
    spawnBullet(world, 'player', player.pos.x, player.pos.y, 0, angle, 'blaster', { z: eye, pitch })
    for (let i = 0; i < 60; i++) {
      updateBullets(world, DT)
      const hit = world.events.find((event) => event.type === 'enemyHit')
      world.events.length = 0
      if (hit) return hit
    }
    return undefined
  }

  function hold(boss: Enemy, phase: 'walk' | 'recover'): void {
    boss.boss!.phase = phase
    boss.boss!.timer = 10
  }

  it('glows only in the stagger after a move and takes double damage there', () => {
    const world = fight()
    const boss = world.boss!
    boss.facing = Math.atan2(world.player.pos.y - boss.pos.y, world.player.pos.x - boss.pos.x)
    const damage = WEAPONS.blaster.damage
    hold(boss, 'walk')
    expect(bossExposed(boss)).toBe(false)
    expect(shoot(world, WEAK_POINTS.scarecrow.height)).toMatchObject({ crit: false, damage })
    hold(boss, 'recover')
    expect(bossExposed(boss)).toBe(true)
    expect(shoot(world, WEAK_POINTS.scarecrow.height)).toMatchObject({ crit: true, damage: damage * WEAK_POINT_SCALE })
    expect(shoot(world, 1)).toMatchObject({ crit: false, damage })
    boss.boss!.phase = 'stunned'
    expect(bossExposed(boss)).toBe(true)
  })
})
