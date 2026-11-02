import { describe, expect, it } from 'vitest'
import { createDefaultTuning } from '../data/tuning'
import { giveSpecialWeapon } from './arsenal'
import { stepWorld } from './step'
import { pitchAt, pitchToward, singleArea } from './testing'
import type { Enemy, PlayerCommand } from './types'
import { createEnemy, createWorld, type World } from './world'

const DT = 1 / 60
const OPEN = ['##############', '#P...........#', '#............#', '##############']

function idle(aimX = 100, aimY = 1.5): PlayerCommand {
  return { moveX: 0, moveY: 0, aimX, aimY, fire: false, slot: null, interact: false, skill: null, ultimate: false, pitch: 0, jump: false, dash: false, melee: false }
}

function setup(rows = OPEN, seed = 1) {
  const tuning = createDefaultTuning()
  const world = createWorld(singleArea(rows), tuning, { seed })
  return { world, tuning }
}

function run(world: World, command: PlayerCommand, seconds: number): void {
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) stepWorld(world, command, DT)
}

function aimAt(world: World, target: Enemy): PlayerCommand {
  return { ...idle(target.pos.x, target.pos.y), pitch: pitchAt(world, target) }
}

function playerBullets(world: World) {
  return world.bullets.filter((bullet) => bullet.team === 'player')
}

describe('weapons', () => {
  it('fires a whole spread of shotgun pellets for one ammo', () => {
    const { world, tuning } = setup()
    const shotgun = tuning.weapons.shotgun
    giveSpecialWeapon(world, 'shotgun')
    stepWorld(world, { ...idle(), fire: true }, DT)
    expect(world.player.specialAmmo).toBe(shotgun.magazine - 1)
    const pellets = playerBullets(world)
    expect(pellets).toHaveLength(shotgun.pellets)
    const yaws = pellets.map((bullet) => (Math.atan2(bullet.dirY, bullet.dirX) * 180) / Math.PI)
    const pitches = pellets.map((bullet) => (Math.atan2(bullet.vz, bullet.speed) * 180) / Math.PI)
    const offsets = yaws.map((yaw, index) => Math.hypot(yaw, pitches[index]))
    expect(Math.max(...offsets)).toBeLessThan(shotgun.spreadDeg / 2 + shotgun.jitterDeg)
    expect(Math.max(...offsets)).toBeGreaterThan(shotgun.spreadDeg / 4)
    expect(Math.max(...yaws) - Math.min(...yaws)).toBeGreaterThan(shotgun.spreadDeg / 3)
    expect(Math.max(...pitches) - Math.min(...pitches)).toBeGreaterThan(shotgun.spreadDeg / 3)
  })

  it('drops an empty special weapon and goes back to the primary one', () => {
    const { world } = setup()
    giveSpecialWeapon(world, 'sniper')
    world.player.specialAmmo = 1
    stepWorld(world, { ...idle(), fire: true }, DT)
    run(world, idle(), 0.1)
    expect(world.player.special).toBeNull()
    expect(world.player.slot).toBe('primary')
    const types = world.events.map((event) => event.type)
    expect(types).toContain('weaponEmpty')
    expect(types.filter((type) => type === 'weaponChanged')).toHaveLength(2)
  })

  it('switches between the primary and special slots on command', () => {
    const { world, tuning } = setup()
    giveSpecialWeapon(world, 'smg')
    stepWorld(world, { ...idle(), slot: 'primary' }, DT)
    expect(world.player.slot).toBe('primary')
    stepWorld(world, { ...idle(), fire: true }, DT)
    expect(world.player.ammo).toBe(tuning.weapons.blaster.magazine - 1)
    expect(world.player.specialAmmo).toBe(tuning.weapons.smg.magazine)
    stepWorld(world, { ...idle(), slot: 'special' }, DT)
    expect(world.player.slot).toBe('special')
  })

  it('lets sniper rounds pierce through a line of enemies', () => {
    const { world, tuning } = setup(['##############', '#P....m.m....#', '##############'])
    tuning.grunt.speed = 0
    giveSpecialWeapon(world, 'sniper')
    const aim = { ...idle(10.5, 1.5), pitch: pitchToward(world, 8.5, 1.5, 0.4) }
    stepWorld(world, { ...aim, fire: true }, DT)
    run(world, aim, 0.4)
    for (const enemy of world.enemies) {
      expect(enemy.hp).toBe(tuning.grunt.maxHp - tuning.weapons.sniper.damage)
    }
  })

  it('scatters submachine gun bullets the same way for the same seed', () => {
    const directions = [1, 1, 2].map((seed) => {
      const { world } = setup(OPEN, seed)
      giveSpecialWeapon(world, 'smg')
      stepWorld(world, { ...idle(), fire: true }, DT)
      return playerBullets(world)[0]?.dirY
    })
    expect(directions[0]).toBe(directions[1])
    expect(directions[0]).not.toBe(directions[2])
  })
})

const WIDE = [
  '####################',
  '#..................#',
  '#..................#',
  '#.P................#',
  '#..................#',
  '#..................#',
  '####################',
]

function grunt(world: World, x: number, y: number) {
  const enemy = createEnemy(world, 'grunt', { x, y }, 0)
  enemy.hp = enemy.maxHp = 5000
  world.enemies.push(enemy)
  return enemy
}

describe('new weapons', () => {
  it('lobs grenades over walls and blows up where aimed', () => {
    const { world, tuning } = setup(['##############', '#P...#.......#', '#....#.......#', '##############'])
    tuning.grunt.speed = 0
    const target = grunt(world, 8.5, 1.5)
    giveSpecialWeapon(world, 'grenade')
    const aim = { ...idle(8.5, 1.5), pitch: pitchToward(world, 8.5, 1.5, 0) }
    stepWorld(world, { ...aim, fire: true }, DT)
    expect(world.lobs).toHaveLength(1)
    run(world, aim, 1)
    expect(world.lobs).toHaveLength(0)
    expect(target.hp).toBe(target.maxHp - tuning.weapons.grenade.splash)
  })

  it('bounces ricochet rounds off walls', () => {
    const { world } = setup(['########', '#P.....#', '########'])
    giveSpecialWeapon(world, 'ricochet')
    stepWorld(world, { ...idle(100, 1.5), fire: true }, DT)
    run(world, idle(100, 1.5), 0.6)
    expect(world.events.some((event) => event.type === 'bulletBounced')).toBe(true)
  })

  it('sets enemies on fire with the flamethrower', () => {
    const { world, tuning } = setup(WIDE)
    tuning.grunt.speed = 0
    const target = grunt(world, 5.5, 3.5)
    giveSpecialWeapon(world, 'flamer')
    const aim = aimAt(world, target)
    for (let i = 0; i < 6; i++) stepWorld(world, { ...aim, fire: true }, DT)
    run(world, aim, 0.5)
    expect(target.status.burn).toBeGreaterThan(0)
    const burning = target.hp
    run(world, aim, 1.5)
    expect(target.hp).toBeLessThan(burning)
  })

  it('freezes an enemy after three frost hits', () => {
    const { world, tuning } = setup(WIDE)
    const target = grunt(world, 8.5, 3.5)
    target.aggro = true
    tuning.grunt.speed = 0
    giveSpecialWeapon(world, 'frost')
    const aim = aimAt(world, target)
    for (let shot = 0; shot < 3; shot++) {
      stepWorld(world, { ...aim, fire: true }, DT)
      run(world, aim, tuning.weapons.frost.cooldown + 0.05)
    }
    expect(target.status.frozen).toBeGreaterThan(0)
    expect(world.events.some((event) => event.type === 'frozen')).toBe(true)
  })

  it('slows chilled enemies', () => {
    const { world, tuning } = setup(WIDE)
    tuning.grunt.weave = 0
    const target = grunt(world, 8.5, 3.5)
    target.aggro = true
    target.state = 'chase'
    target.flank = 0
    giveSpecialWeapon(world, 'frost')
    const aim = aimAt(world, target)
    stepWorld(world, { ...aim, fire: true }, DT)
    run(world, aim, 0.4)
    expect(target.status.chill).toBe(1)
    const before = target.pos.x
    run(world, aim, 0.5)
    const moved = before - target.pos.x
    expect(moved).toBeLessThan(tuning.grunt.speed * 0.5 * 0.9)
  })

  it('explodes rockets on impact and hurts enemies around the target', () => {
    const { world, tuning } = setup(WIDE)
    tuning.grunt.speed = 0
    const first = grunt(world, 7.5, 3.5)
    const second = grunt(world, 8.6, 3.5)
    giveSpecialWeapon(world, 'rocket')
    const aim = aimAt(world, first)
    stepWorld(world, { ...aim, fire: true }, DT)
    run(world, aim, 1)
    const rocket = tuning.weapons.rocket
    expect(first.hp).toBe(first.maxHp - rocket.damage - rocket.splash)
    expect(second.hp).toBe(second.maxHp - rocket.splash)
  })

  it('chains lightning to nearby enemies with falloff', () => {
    const { world, tuning } = setup(WIDE)
    tuning.grunt.speed = 0
    const first = grunt(world, 6.5, 3.5)
    const second = grunt(world, 8.5, 3.5)
    const third = grunt(world, 10.5, 3.5)
    giveSpecialWeapon(world, 'arc')
    const aim = aimAt(world, first)
    stepWorld(world, { ...aim, fire: true }, DT)
    run(world, aim, 0.3)
    const arc = tuning.weapons.arc
    expect(first.maxHp - first.hp).toBeCloseTo(arc.damage, 5)
    expect(second.maxHp - second.hp).toBeCloseTo(arc.damage * (1 - arc.chainFalloff), 5)
    expect(third.maxHp - third.hp).toBeCloseTo(arc.damage * (1 - arc.chainFalloff) ** 2, 5)
    expect(world.events.filter((event) => event.type === 'chain')).toHaveLength(2)
  })
})
