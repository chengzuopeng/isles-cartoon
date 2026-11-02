import { describe, expect, it } from 'vitest'
import { SKILLS, type SkillId } from '../data/skills'
import { createDefaultTuning } from '../data/tuning'
import { giveSpecialWeapon } from './arsenal'
import { damagePlayer, spawnBlast } from './combat'
import { stepWorld } from './step'
import { createLoadout, type EquippedSkill } from './stats'
import { pitchAt, pitchToward, singleArea } from './testing'
import type { PlayerCommand } from './types'
import { createEnemy, createWorld, type World } from './world'

const DT = 1 / 60
const OPEN = [
  '######################',
  '#....................#',
  '#....................#',
  '#....P...............#',
  '#....................#',
  '#....................#',
  '######################',
]

function idle(aimX = 100, aimY = 3.5): PlayerCommand {
  return { moveX: 0, moveY: 0, aimX, aimY, fire: false, slot: null, interact: false, skill: null, ultimate: false, pitch: 0, jump: false, dash: false, melee: false }
}

function setup(id: SkillId, rank = 1, attributes = {}) {
  const tuning = createDefaultTuning()
  const skills: EquippedSkill[] = [{ slot: 'q', id, rank }]
  const world = createWorld(singleArea(OPEN), tuning, { loadout: createLoadout(attributes, skills) })
  return { world, tuning }
}

function run(world: World, command: PlayerCommand, seconds: number): void {
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) stepWorld(world, command, DT)
}

function spawn(world: World, kind: 'grunt' | 'gunner' | 'bomber', x: number, y: number) {
  const enemy = createEnemy(world, kind, { x, y }, 0)
  enemy.aggro = true
  enemy.state = 'chase'
  world.enemies.push(enemy)
  return enemy
}

describe('concussion grenade', () => {
  it('lands where the crosshair points on the ground and stuns the chargers around it', () => {
    const { world } = setup('concussion')
    const near = spawn(world, 'grunt', 10.5, 3.5)
    const far = spawn(world, 'grunt', 17.5, 3.5)
    const rank = SKILLS.concussion.ranks[0]
    const pitch = -Math.atan2(1.5, 5)
    stepWorld(world, { ...idle(), pitch, skill: 'q' }, DT)
    expect(world.blasts).toHaveLength(1)
    expect(world.blasts[0].x).toBeCloseTo(world.player.pos.x + 5, 0)
    run(world, idle(), rank.flight + 0.05)
    expect(near.status.stunned).toBeGreaterThan(0)
    expect(far.status.stunned).toBe(0)
  })

  it('flies to its full range when the hero looks up and stops short of a wall', () => {
    const { world } = setup('concussion')
    stepWorld(world, { ...idle(), pitch: 0.2, skill: 'q' }, DT)
    expect(world.blasts[0].x).toBeCloseTo(world.player.pos.x + SKILLS.concussion.ranks[0].range, 0)
    const walled = setup('concussion').world
    stepWorld(walled, { ...idle(-100, 3.5), pitch: 0.2, skill: 'q' }, DT)
    expect(walled.blasts[0].x).toBeGreaterThan(1)
  })

  it('goes on cooldown, and rank two shortens it while rank three widens and lengthens the stun', () => {
    const first = setup('concussion').world
    stepWorld(first, { ...idle(), skill: 'q' }, DT)
    expect(first.player.skills[0].cooldown).toBeCloseTo(SKILLS.concussion.ranks[0].cooldown, 1)
    const second = setup('concussion', 2).world
    stepWorld(second, { ...idle(), skill: 'q' }, DT)
    expect(second.player.skills[0].cooldown).toBeCloseTo(SKILLS.concussion.ranks[1].cooldown, 1)
    const third = setup('concussion', 3).world
    stepWorld(third, { ...idle(), skill: 'q' }, DT)
    expect(third.blasts[0].radius).toBe(SKILLS.concussion.ranks[2].radius)
    expect(third.blasts[0].stun).toBe(SKILLS.concussion.ranks[2].stun)
  })

  it('cools down faster with the cooldown attribute', () => {
    const { world } = setup('concussion', 1, { cooldown: 4 })
    stepWorld(world, { ...idle(), skill: 'q' }, DT)
    expect(world.player.skills[0].cooldown).toBeCloseTo(SKILLS.concussion.ranks[0].cooldown * 0.8, 1)
  })
})

describe('barrier', () => {
  it('absorbs damage for a few seconds', () => {
    const { world } = setup('barrier')
    stepWorld(world, { ...idle(), skill: 'q' }, DT)
    damagePlayer(world, 300, 1, 0, 0)
    expect(world.player.hp).toBe(world.player.maxHp)
    expect(world.player.barrier).toBe(SKILLS.barrier.ranks[0].absorb - 300)
    run(world, idle(), SKILLS.barrier.ranks[0].duration + 0.1)
    expect(world.player.barrier).toBe(0)
  })

  it('knocks enemies back when it breaks at rank three', () => {
    const { world, tuning } = setup('barrier', 3)
    tuning.grunt.speed = 0
    const grunt = spawn(world, 'grunt', 7.5, 3.5)
    stepWorld(world, { ...idle(), skill: 'q' }, DT)
    damagePlayer(world, 700, 1, 0, 0)
    expect(world.events.some((event) => event.type === 'barrierBroken')).toBe(true)
    expect(grunt.knock.x).toBeGreaterThan(1)
    expect(world.player.hp).toBe(world.player.maxHp - 100)
  })
})

describe('shockwave', () => {
  it('knocks back close enemies and interrupts their windups', () => {
    const { world, tuning } = setup('shockwave')
    tuning.grunt.speed = 0
    const near = spawn(world, 'grunt', 6.6, 3.5)
    const far = spawn(world, 'grunt', 14.5, 3.5)
    stepWorld(world, idle(), DT)
    expect(near.state).toBe('windup')
    stepWorld(world, { ...idle(), skill: 'q' }, DT)
    expect(near.state).toBe('recover')
    expect(near.hp).toBeLessThan(near.maxHp)
    run(world, idle(), 0.3)
    expect(near.pos.x).toBeGreaterThan(7.5)
    expect(far.hp).toBe(far.maxHp)
  })

  it('stuns at rank two and reaches four tiles at rank three', () => {
    const { world, tuning } = setup('shockwave', 3)
    tuning.grunt.speed = 0
    const grunt = spawn(world, 'grunt', 9.2, 3.5)
    stepWorld(world, { ...idle(), skill: 'q' }, DT)
    expect(grunt.status.stunned).toBeGreaterThan(0.9)
    expect(world.events.some((event) => event.type === 'stunned')).toBe(true)
  })

  it('defuses a bomber that was about to explode', () => {
    const { world, tuning } = setup('shockwave')
    tuning.bomber.speed = 0
    const bomber = spawn(world, 'bomber', 6.6, 3.5)
    stepWorld(world, idle(), DT)
    expect(bomber.state).toBe('arming')
    expect(world.blasts).toHaveLength(1)
    stepWorld(world, { ...idle(), skill: 'q' }, DT)
    expect(world.blasts.filter((blast) => blast.ownerId === bomber.id)).toHaveLength(0)
  })
})

describe('ultimate', () => {
  it('charges fully from the primary weapon and at half rate from special weapons', () => {
    const { world, tuning } = setup('concussion')
    tuning.grunt.speed = 0
    const grunt = spawn(world, 'grunt', 9.5, 3.5)
    grunt.hp = grunt.maxHp = 99_999
    const aim = { ...idle(9.5, 3.5), pitch: pitchAt(world, grunt) }
    stepWorld(world, { ...aim, fire: true }, DT)
    run(world, aim, 0.5)
    const dealt = tuning.weapons.blaster.damage * tuning.weapons.blaster.burstCount
    expect(world.player.ultimate).toBeCloseTo(dealt / tuning.player.ultimateCharge, 5)
    const charged = world.player.ultimate
    const landed = world.stats.bulletsHit
    giveSpecialWeapon(world, 'smg')
    for (let i = 0; i < 40; i++) stepWorld(world, { ...aim, fire: true }, DT)
    run(world, aim, 0.5)
    const special = (world.stats.bulletsHit - landed) * tuning.weapons.smg.damage * tuning.player.specialUltShare
    expect(special).toBeGreaterThan(0)
    expect(world.player.ultimate).toBeCloseTo(charged + special / tuning.player.ultimateCharge, 5)
  })

  it('charges at half rate from special weapon explosions', () => {
    const { world, tuning } = setup('concussion')
    tuning.grunt.speed = 0
    const grunt = spawn(world, 'grunt', 6.5, 3.5)
    grunt.hp = grunt.maxHp = 99_999
    giveSpecialWeapon(world, 'grenade')
    const aim = { ...idle(6.5, 3.5), pitch: pitchToward(world, 6.5, 3.5, 0) }
    stepWorld(world, { ...aim, fire: true }, DT)
    run(world, aim, 1.5)
    const splash = tuning.weapons.grenade.splash * tuning.player.specialUltShare
    expect(world.player.ultimate).toBeCloseTo(splash / tuning.player.ultimateCharge, 5)
  })

  it('unleashes a volley of piercing bolts when full', () => {
    const { world, tuning } = setup('concussion')
    world.player.ultimate = 1
    stepWorld(world, { ...idle(), ultimate: true }, DT)
    expect(world.player.ultimate).toBe(0)
    run(world, idle(), tuning.weapons.starVolley.burstInterval * tuning.weapons.starVolley.burstCount + 0.1)
    const volley = world.events.filter((event) => event.type === 'shot' && event.weapon === 'starVolley')
    expect(volley).toHaveLength(tuning.weapons.starVolley.burstCount)
  })

  it('does nothing until it is charged', () => {
    const { world } = setup('concussion')
    world.player.ultimate = 0.5
    stepWorld(world, { ...idle(), ultimate: true }, DT)
    expect(world.player.ultShots).toBe(0)
    expect(world.player.ultimate).toBe(0.5)
  })
})

describe('blasts against shields', () => {
  it('cannot reach a dashing hero', () => {
    const { world } = setup('concussion')
    stepWorld(world, { ...idle(), moveX: 1, dash: true }, DT)
    spawnBlast(world, { x: world.player.pos.x, y: world.player.pos.y, radius: 2, delay: 0, playerDamage: 400, enemyDamage: 0, source: 'boss', ownerId: 0 })
    stepWorld(world, idle(), DT)
    expect(world.player.hp).toBe(world.player.maxHp)
  })
})
