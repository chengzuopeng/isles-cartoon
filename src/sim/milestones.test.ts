import { describe, expect, it } from 'vitest'
import { FOOD_HEAL } from '../data/loot'
import { MILESTONE } from '../data/progression'
import { SKILLS } from '../data/skills'
import { createDefaultTuning } from '../data/tuning'
import { damagePlayer } from './combat'
import { healPlayer } from './buffs'
import { stepWorld } from './step'
import { createLoadout, type EquippedSkill, type SpecRanks } from './stats'
import { singleArea } from './testing'
import type { Enemy, GameEvent, MinionKind, PlayerCommand } from './types'
import { createEnemy, createWorld, type World } from './world'

const DT = 1 / 60
const OPEN = ['######################', '#....................#', '#....................#', '#..P.................#', '#....................#', '#....................#', '######################']

function setup(specs: Partial<SpecRanks>, skills: EquippedSkill[] = []): World {
  const tuning = createDefaultTuning()
  tuning.grunt.speed = 0
  tuning.gunner.speed = 0
  return createWorld(singleArea(OPEN), tuning, { loadout: createLoadout(specs, skills) })
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

describe('gunplay milestones', () => {
  it('rank 2 makes the first burst from a full blaster a sure critical hit', () => {
    const world = setup({ gun: 2 })
    run(world, DT, { fire: true })
    expect(world.bullets.every((bullet) => bullet.sureCrit)).toBe(true)
    run(world, world.tuning.weapons.blaster.cooldown + 0.05, { fire: true })
    expect(world.bullets.filter((bullet) => !bullet.sureCrit).length).toBeGreaterThan(0)
    const plain = setup({ gun: 1 })
    run(plain, DT, { fire: true })
    expect(plain.bullets.some((bullet) => bullet.sureCrit)).toBe(false)
  })

  it('rank 5 gives one blaster charge back for a critical hit, once a second', () => {
    const world = setup({ gun: 5 })
    add(world, 'grunt', 7.5, 3.5)
    run(world, DT, { fire: true })
    expect(world.player.ammo).toBe(world.player.magazine - 1)
    run(world, 0.3)
    expect(world.stats.crits).toBeGreaterThan(0)
    expect(world.player.recycledAt).toBeGreaterThan(0)
    expect(world.player.ammo).toBe(world.player.magazine)
  })

  it('rank 10 fires four shots per blaster burst', () => {
    const world = setup({ gun: 10 })
    run(world, 0.3, { fire: true })
    expect(world.stats.bulletsFired).toBe(4)
    expect(world.player.ammo).toBe(world.player.magazine - 1)
  })
})

describe('brawling milestones', () => {
  it('rank 2 makes smashed food heal more and fly in from further away', () => {
    const world = setup({ brawl: 2 })
    const grunt = add(world, 'grunt', 4.6, 3.5)
    grunt.status.dazed = 1
    grunt.status.stunned = 1
    run(world, DT, { melee: true })
    const food = world.pickups.find((pickup) => pickup.item.type === 'heal')
    expect(food?.item.type === 'heal' && food.item.amount).toBe(MILESTONE.foodHeal)
    expect(MILESTONE.foodHeal).toBeGreaterThan(FOOD_HEAL)
  })

  it('rank 5 sends a shockwave from every smash that leaves nearby minions reeling', () => {
    const world = setup({ brawl: 5 })
    const grunt = add(world, 'grunt', 4.6, 3.5)
    const near = add(world, 'gunner', 6.4, 3.5)
    grunt.status.dazed = 1
    grunt.status.stunned = 1
    run(world, DT, { melee: true })
    expect(grunt.hp).toBe(0)
    expect(near.status.dazed).toBeGreaterThan(0)
  })

  it('rank 10 turns overhealing into a shield of up to 200 and halves the melee cooldown at low health', () => {
    const world = setup({ brawl: 10 })
    const { player } = world
    player.hp = player.maxHp - 50
    healPlayer(world, 300)
    expect(player.hp).toBe(player.maxHp)
    expect(player.armor).toBe(MILESTONE.overhealCap)
    damagePlayer(world, 150, 1, 0, 0)
    expect(player.hp).toBe(player.maxHp)
    expect(player.armor).toBe(MILESTONE.overhealCap - 150)
    player.hp = player.maxHp * 0.2
    run(world, DT, { melee: true })
    expect(player.meleeCooldown).toBeCloseTo(world.tuning.player.meleeCooldown * MILESTONE.desperateCooldown, 5)
  })

  it('keeps overhealing as plain overhealing below rank 10', () => {
    const world = setup({ brawl: 9 })
    healPlayer(world, 300)
    expect(world.player.armor).toBe(0)
  })
})

describe('movement milestones', () => {
  it('rank 2 lengthens and strengthens the swing right after a dash', () => {
    const world = setup({ move: 2 })
    const grunt = add(world, 'gunner', 14.5, 3.5)
    run(world, world.tuning.player.dashTime + DT, { moveY: 1, dash: true })
    world.player.pos = { x: grunt.pos.x - 2.8, y: grunt.pos.y }
    run(world, DT, { melee: true })
    expect(grunt.maxHp - grunt.hp).toBeCloseTo(world.tuning.player.meleeDamage * MILESTONE.leverageDamage * world.playerStats.meleeDamage, 3)
  })

  it('only dashes on the ground until rank 5, then once per jump in the air', () => {
    const ground = setup({ move: 4 })
    run(ground, DT, { jump: true })
    run(ground, 0.1)
    expect(run(ground, DT, { moveX: 1, dash: true }).some((event) => event.type === 'dashed')).toBe(false)
    const air = setup({ move: 5 })
    run(air, DT, { jump: true })
    run(air, 0.1)
    expect(run(air, DT, { moveX: 1, dash: true }).some((event) => event.type === 'dashed')).toBe(true)
    run(air, air.tuning.player.dashTime + DT)
    expect(air.player.grounded).toBe(false)
    expect(run(air, DT, { moveX: 1, dash: true }).some((event) => event.type === 'dashed')).toBe(false)
  })

  it('rank 10 hands the dash charge back and adds some ultimate when a dash dodges a hit', () => {
    const world = setup({ move: 10 })
    run(world, DT, { moveX: 1, dash: true })
    const charges = world.player.dashCharges
    damagePlayer(world, 100, 1, 0, 0)
    damagePlayer(world, 100, 1, 0, 0)
    expect(world.player.dashCharges).toBe(charges + 1)
    expect(world.player.ultimate).toBeCloseTo(MILESTONE.grazeUlt, 5)
    expect(world.events.filter((event) => event.type === 'grazed')).toHaveLength(1)
  })
})

describe('energy milestones', () => {
  it('rank 2 stretches the streak window', () => {
    const stretched = setup({ energy: 2 })
    const plain = setup({ energy: 1 })
    run(stretched, DT)
    run(plain, DT)
    expect(stretched.playerStats.streakWindow).toBe(MILESTONE.streakWindow)
    expect(plain.playerStats.streakWindow).toBe(3)
  })

  it('rank 5 gives part of the cooldown back when a skill catches three robots', () => {
    const world = setup({ energy: 5 }, [{ slot: 'q', id: 'shockwave', rank: 1 }])
    for (const x of [4.4, 5, 3.5]) add(world, 'gunner', x, 4.5)
    const events = run(world, DT, { skill: 'q' })
    expect(events.some((event) => event.type === 'circuit')).toBe(true)
    const full = SKILLS.shockwave.ranks[0].cooldown * world.playerStats.skillCooldown
    expect(world.player.skills[0].cooldown).toBeCloseTo(full * (1 - MILESTONE.circuitRefund), 5)
  })

  it('rank 10 adds four stars to the volley and readies both skills when it ends', () => {
    const world = setup({ energy: 10 }, [{ slot: 'q', id: 'concussion', rank: 1 }])
    world.player.skills[0].cooldown = 5
    world.player.ultimate = 1
    run(world, DT, { ultimate: true })
    expect(world.player.ultShots).toBe(world.tuning.weapons.starVolley.burstCount + MILESTONE.overloadShots - 1)
    run(world, 3)
    expect(world.player.ultShots).toBe(0)
    expect(world.player.skills[0].cooldown).toBe(0)
  })
})
