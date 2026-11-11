import { describe, expect, it } from 'vitest'
import { BOMBLET, SKILLS, type SkillBranch, type SkillId } from '../data/skills'
import { createDefaultTuning } from '../data/tuning'
import { firePattern } from './arsenal'
import { crumbling } from './melee'
import { createProfile, learnSkill, loadoutOf, setBranch } from './profile'
import { stepWorld } from './step'
import { createLoadout } from './stats'
import { singleArea } from './testing'
import type { Enemy, GameEvent, MinionKind, PlayerCommand } from './types'
import { createEnemy, createWorld, type World } from './world'

const DT = 1 / 60
const OPEN = ['######################', '#....................#', '#....................#', '#..P.................#', '#....................#', '#....................#', '######################']

function setup(id: SkillId, branch: SkillBranch, rank = 3): World {
  const tuning = createDefaultTuning()
  tuning.grunt.speed = 0
  tuning.gunner.speed = 0
  return createWorld(singleArea(OPEN), tuning, { loadout: createLoadout({}, [{ slot: 'q', id, rank, branch }]) })
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

describe('choosing a branch', () => {
  it('only opens at rank three and follows the skill into the loadout', () => {
    const profile = createProfile()
    profile.level = 10
    expect(setBranch(profile, 'concussion', 'b')).toBe(false)
    learnSkill(profile, 'concussion')
    learnSkill(profile, 'concussion')
    expect(setBranch(profile, 'concussion', 'b')).toBe(true)
    expect(setBranch(profile, 'concussion', 'b')).toBe(false)
    expect(loadoutOf(profile).skills[0]).toEqual({ slot: 'q', id: 'concussion', rank: 3, branch: 'b' })
  })
})

describe('concussion grenade branches', () => {
  it('A leaves stunned minions open to a smash', () => {
    const world = setup('concussion', 'a')
    const grunt = add(world, 'gunner', 10.5, 3.5)
    run(world, DT, { skill: 'q', aimX: 10.5, aimY: 3.5, pitch: -0.15 })
    run(world, SKILLS.concussion.ranks[2].flight + 0.05)
    expect(grunt.status.dazed).toBeGreaterThan(0)
    expect(crumbling(world, grunt)).toBe(true)
  })

  it('B throws three bomblets out around the landing spot', () => {
    const world = setup('concussion', 'b')
    run(world, DT, { skill: 'q', aimX: 10.5, aimY: 3.5, pitch: -0.15 })
    const blasts = world.blasts.filter((blast) => blast.skill === 'concussion')
    expect(blasts).toHaveLength(4)
    const small = blasts.filter((blast) => blast.radius === BOMBLET.radius)
    expect(small).toHaveLength(3)
    const center = blasts.find((blast) => blast.radius !== BOMBLET.radius)!
    for (const blast of small) expect(Math.hypot(blast.x - center.x, blast.y - center.y)).toBeCloseTo(BOMBLET.spread, 5)
  })
})

describe('barrier branches', () => {
  it('A bursts when the barrier runs out as well as when it breaks', () => {
    const world = setup('barrier', 'a')
    const grunt = add(world, 'grunt', 5, 3.5)
    run(world, DT, { skill: 'q' })
    const events = run(world, SKILLS.barrier.ranks[2].duration + 0.1)
    expect(events.some((event) => event.type === 'barrierBroken')).toBe(true)
    expect(grunt.pos.x).toBeGreaterThan(5.5)
  })

  it('B sends bullets from the front back where they came from', () => {
    const world = setup('barrier', 'b')
    run(world, DT, { skill: 'q' })
    const { player } = world
    firePattern(world, 'enemy', player.pos.x + 6, player.pos.y, 0.3, Math.PI, 'rifle', { z: player.z + 1, pitch: 0 })
    const events = run(world, 0.5)
    expect(events.some((event) => event.type === 'reflected')).toBe(true)
    expect(player.barrier).toBe(SKILLS.barrier.branchB.absorb)
    expect(world.bullets.every((bullet) => bullet.team === 'player')).toBe(true)
  })

  it('B still lets a bullet from behind hit the barrier', () => {
    const world = setup('barrier', 'b')
    run(world, DT, { skill: 'q' })
    const { player } = world
    firePattern(world, 'enemy', player.pos.x - 2.2, player.pos.y, 0.3, 0, 'rifle', { z: player.z + 1, pitch: 0 })
    const events = run(world, 0.5)
    expect(events.some((event) => event.type === 'reflected')).toBe(false)
    expect(player.barrier).toBeLessThan(SKILLS.barrier.branchB.absorb)
  })
})

describe('shockwave branches', () => {
  it('B pulls minions in to about two metres and stuns them', () => {
    const world = setup('shockwave', 'b')
    const far = add(world, 'gunner', 8.5, 3.5)
    run(world, DT, { skill: 'q' })
    run(world, 0.5)
    expect(Math.hypot(far.pos.x - world.player.pos.x, far.pos.y - world.player.pos.y)).toBeLessThan(2.6)
    expect(far.status.stunned).toBeGreaterThan(0)
  })

  it('A pushes out to four metres', () => {
    const world = setup('shockwave', 'a')
    const near = add(world, 'gunner', 7.2, 3.5)
    run(world, DT, { skill: 'q' })
    run(world, 0.3)
    expect(near.pos.x).toBeGreaterThan(7.5)
  })
})
