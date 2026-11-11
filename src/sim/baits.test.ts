import { describe, expect, it } from 'vitest'
import { BAIT, SKILLS, type SkillBranch } from '../data/skills'
import { createDefaultTuning } from '../data/tuning'
import { damageEnemy } from './combat'
import { createProfile, learnSkill } from './profile'
import { stepWorld } from './step'
import { createLoadout } from './stats'
import { singleArea } from './testing'
import type { Enemy, GameEvent, MinionKind, PlayerCommand } from './types'
import { createEnemy, createWorld, type World } from './world'

const DT = 1 / 60
const FIELD = ['##########################', '#........................#', '#........................#', '#..P.....................#', '#........................#', '#........................#', '#........................#', '##########################']

function setup(rank = 1, branch: SkillBranch = 'a'): World {
  const tuning = createDefaultTuning()
  return createWorld(singleArea(FIELD), tuning, { loadout: createLoadout({}, [{ slot: 'q', id: 'bait', rank, branch }]) })
}

function add(world: World, kind: MinionKind, x: number, y: number, fighting = true): Enemy {
  const enemy = createEnemy(world, kind, { x, y }, 0)
  enemy.aggro = fighting
  if (fighting) enemy.alert = 'combat'
  world.enemies.push(enemy)
  return enemy
}

function command(world: World, patch: Partial<PlayerCommand> = {}): PlayerCommand {
  const { player } = world
  return { moveX: 0, moveY: 0, aimX: player.pos.x + 20, aimY: player.pos.y, pitch: 0, fire: false, slot: null, interact: false, skill: null, ultimate: false, jump: false, dash: false, melee: false, ...patch }
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

function throwAt(world: World, x: number, y: number): GameEvent[] {
  const { player } = world
  const flat = Math.hypot(x - player.pos.x, y - player.pos.y)
  return run(world, DT, { skill: 'q', aimX: x, aimY: y, pitch: -Math.atan2(1.5, flat) })
}

describe('the bread bait skill', () => {
  it('can be learned as the fourth skill of chapter one', () => {
    const profile = createProfile()
    profile.level = 2
    expect(learnSkill(profile, 'bait')).toBe(true)
  })

  it('pulls fighting minions within eight metres to the bread and lets them go after a few seconds', () => {
    const world = setup()
    const grunt = add(world, 'grunt', 16, 5)
    const far = add(world, 'grunt', 23, 1.5)
    throwAt(world, 12, 3.5)
    run(world, SKILLS.bait.ranks[0].flight + 0.05)
    expect(grunt.lureLeft).toBeGreaterThan(0)
    expect(far.lureLeft).toBe(0)
    run(world, 2)
    expect(Math.hypot(grunt.pos.x - 12, grunt.pos.y - 3.5)).toBeLessThan(BAIT.reach + grunt.radius + 0.2)
    run(world, SKILLS.bait.ranks[0].lure)
    expect(grunt.lureLeft).toBe(0)
    expect(world.baits).toHaveLength(0)
  })

  it('wakes a lured minion the moment it is hit', () => {
    const world = setup()
    const grunt = add(world, 'grunt', 15, 3.5)
    throwAt(world, 12, 3.5)
    run(world, SKILLS.bait.ranks[0].flight + 0.05)
    expect(grunt.lureLeft).toBeGreaterThan(0)
    damageEnemy(world, grunt, 10, 1, 0, 0)
    expect(grunt.lureLeft).toBe(0)
  })

  it('draws an unaware minion over with its back to the player', () => {
    const world = setup()
    const guard = add(world, 'gunner', 9, 3.5, false)
    guard.facing = guard.baseFacing = 0
    world.tuning.perception.sweepDeg = 0
    throwAt(world, 13, 3.5)
    run(world, 1.5)
    expect(guard.aggro).toBe(false)
    expect(guard.pos.x).toBeGreaterThan(10.5)
    expect(Math.cos(guard.facing)).toBeGreaterThan(0.5)
  })

  it('holds elites for half as long and never fools a boss', () => {
    const world = setup()
    const elite = createEnemy(world, 'grunt', { x: 15, y: 3.5 }, 0, { affixes: ['tough'] })
    elite.aggro = true
    world.enemies.push(elite)
    throwAt(world, 12, 3.5)
    run(world, SKILLS.bait.ranks[0].flight + DT)
    expect(elite.lureLeft).toBeLessThanOrEqual(SKILLS.bait.ranks[0].lure * BAIT.eliteShare)
    expect(elite.lureLeft).toBeGreaterThan(0)
  })

  it('A bursts when a minion reaches the bread', () => {
    const world = setup(3, 'a')
    const grunt = add(world, 'grunt', 14, 3.5)
    throwAt(world, 12, 3.5)
    const events = run(world, 2.5)
    expect(events.some((event) => event.type === 'baitEaten' && event.burst)).toBe(true)
    expect(grunt.maxHp - grunt.hp).toBeGreaterThanOrEqual(SKILLS.bait.ranks[2].burstDamage)
  })

  it('B throws three loaves three metres apart', () => {
    const world = setup(3, 'b')
    throwAt(world, 12, 3.5)
    expect(world.baits).toHaveLength(3)
    const [a, b, c] = world.baits
    expect(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y)).toBeCloseTo(3, 5)
    expect(Math.hypot(b.pos.x - c.pos.x, b.pos.y - c.pos.y)).toBeCloseTo(3, 5)
  })
})
