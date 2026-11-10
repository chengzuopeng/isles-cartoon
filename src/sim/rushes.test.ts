import { describe, expect, it } from 'vitest'
import { LEVEL_1_1 } from '../data/levels/level-1-1'
import { LEVEL_1_2 } from '../data/levels/level-1-2'
import { RUSH } from '../data/levels/rules'
import { createDefaultTuning } from '../data/tuning'
import { buildLevel } from './level'
import { falloffOf, spawnBullet } from './projectiles'
import { feelPain } from './status'
import { idleCommand, stepWorld } from './step'
import { levelFromAreas } from './testing'
import { createWorld, type World } from './world'

const DT = 1 / 60
const FIELD = ['##########', '#........#', '#.m....m.#', '#........#', '#...m....#', '#........#', '#....P...#', '##########']

function field(left: number): World {
  const tuning = createDefaultTuning()
  tuning.grunt.speed = 0
  tuning.grunt.sight = 0
  const level = levelFromAreas([{ name: 'yard', theme: 'meadow', rows: FIELD, rushes: [{ at: [[2, 1], [7, 1]], enemies: [{ kind: 'grunt', count: 3 }], left }] }])
  return createWorld(level, tuning, { debug: { invincible: true } })
}

function run(world: World, seconds: number): string[] {
  const seen: string[] = []
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    stepWorld(world, idleCommand(world), DT)
    for (const event of world.events) seen.push(event.type)
    world.events.length = 0
  }
  return seen
}

describe('rush waves', () => {
  it('stay away while the squad of an area is asleep and whole', () => {
    const world = field(2)
    expect(run(world, 3)).not.toContain('rush')
    expect(world.spawns).toHaveLength(0)
  })

  it('charge in from the edge once the fight has thinned the squad out, with a warning first', () => {
    const world = field(2)
    world.enemies[0].hp = 0
    expect(run(world, 0.2)).toContain('rush')
    expect(world.spawns).toHaveLength(3)
    expect(world.spawns.every((marker) => marker.remaining > 0 && marker.total >= RUSH.warning)).toBe(true)
    const before = world.enemies.filter((enemy) => enemy.hp > 0).length
    run(world, RUSH.warning + 3 * RUSH.gap + 0.2)
    const now = world.enemies.filter((enemy) => enemy.hp > 0)
    expect(now.length).toBe(before + 3)
    expect(now.filter((enemy) => enemy.aggro).length).toBeGreaterThanOrEqual(3)
    expect(run(world, 2)).not.toContain('rush')
  })

  it('wait until few enough are left standing', () => {
    const world = field(1)
    world.enemies[0].hp = 0
    expect(run(world, 0.5)).not.toContain('rush')
    world.enemies.find((enemy) => enemy.hp > 0)!.hp = 0
    expect(run(world, 0.5)).toContain('rush')
  })

  it('bring 19 more chargers into 1-1 and 25 more robots into 1-2', () => {
    const count = (def: typeof LEVEL_1_1) => buildLevel(def).rushes.reduce((sum, rush) => sum + rush.enemies.reduce((total, squad) => total + squad.count, 0), 0)
    expect(count(LEVEL_1_1)).toBe(19)
    expect(count(LEVEL_1_2)).toBe(25)
  })
})

describe('reeling', () => {
  it('spins a robot that takes half its health within a second, and leaves bosses alone', () => {
    const world = field(0)
    const grunt = world.enemies[0]
    feelPain(world, grunt, grunt.maxHp * 0.3)
    expect(grunt.status.dazed).toBe(0)
    feelPain(world, grunt, grunt.maxHp * 0.25)
    expect(grunt.status.dazed).toBeCloseTo(world.tuning.feel.reelSeconds, 6)
    expect(grunt.status.stunned).toBeCloseTo(world.tuning.feel.reelSeconds, 6)
  })

  it('forgets old hits and does not reel twice in a row', () => {
    const world = field(0)
    const grunt = world.enemies[0]
    feelPain(world, grunt, grunt.maxHp * 0.3)
    run(world, world.tuning.feel.reelWindow)
    feelPain(world, grunt, grunt.maxHp * 0.3)
    expect(grunt.status.dazed).toBe(0)
    feelPain(world, grunt, grunt.maxHp * 0.6)
    expect(grunt.status.dazed).toBeGreaterThan(0)
    run(world, world.tuning.feel.reelSeconds + 0.1)
    feelPain(world, grunt, grunt.maxHp * 0.6)
    expect(grunt.status.dazed).toBe(0)
  })
})

describe('the blaster at range', () => {
  it('reaches forty metres and loses half its damage over the last twenty', () => {
    const world = field(0)
    const spec = world.tuning.weapons.blaster
    expect([spec.magazine, spec.range, spec.falloffStart, spec.falloffMin]).toEqual([6, 40, 20, 0.5])
    const bullet = spawnBullet(world, 'player', 5.5, 6.5, 0, -1, 'blaster')
    bullet.traveled = 10
    expect(falloffOf(world, bullet)).toBe(1)
    bullet.traveled = 30
    expect(falloffOf(world, bullet)).toBeCloseTo(0.75, 6)
    bullet.traveled = 40
    expect(falloffOf(world, bullet)).toBeCloseTo(0.5, 6)
    const rifle = spawnBullet(world, 'enemy', 5.5, 6.5, 0, -1, 'rifle')
    rifle.traveled = rifle.range
    expect(falloffOf(world, rifle)).toBe(1)
  })
})

describe('pickups', () => {
  it('fly to a hurt hero from four metres away and stay put for a healthy one', () => {
    const world = field(0)
    world.enemies.length = 0
    const { player } = world
    world.pickups.push({ id: 99, item: { type: 'heal', amount: 0.2 }, pos: { x: player.pos.x, y: player.pos.y - 3.5 }, from: { x: player.pos.x, y: player.pos.y - 3.5 }, age: 1, life: 30 })
    run(world, 0.5)
    expect(world.pickups).toHaveLength(1)
    expect(world.pickups[0].pos.y).toBeCloseTo(player.pos.y - 3.5, 6)
    player.hp = 400
    run(world, 0.5)
    expect(world.pickups).toHaveLength(0)
    expect(player.hp).toBe(600)
  })
})
