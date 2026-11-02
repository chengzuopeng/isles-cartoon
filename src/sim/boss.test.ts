import { describe, expect, it } from 'vitest'
import { getBoss, type BossMoveId } from '../data/bosses'
import { createDefaultTuning } from '../data/tuning'
import { killEnemy } from './combat'
import { Tile } from './grid'
import { stepWorld } from './step'
import { levelFromAreas } from './testing'
import type { Enemy, PlayerCommand } from './types'
import { createWorld, type World } from './world'

const DT = 1 / 60
const DEF = getBoss('scarecrow')
const WEAPONS = createDefaultTuning().weapons

const BOSS_LEVEL = levelFromAreas(
  [
    { name: 'gate', theme: 'meadow', rows: ['#...........#', '#.....P.....#', '#############'] },
    {
      name: 'arena',
      theme: 'arena',
      kind: 'boss',
      rows: [
        '#####DDD#####',
        '#...........#',
        '#S....B....S#',
        '#...........#',
        '#...........#',
        '#...........#',
        '#...........#',
        '#...........#',
        '#####DDD#####',
      ],
    },
    { name: 'exit', theme: 'meadow', rows: ['#############', '#....XXX....#', '#...........#'] },
  ],
  { bossId: 'scarecrow' },
)

function idle(aimX = 6.5, aimY = 5.5): PlayerCommand {
  return { moveX: 0, moveY: 0, aimX, aimY, fire: false, slot: null, interact: false, skill: null, ultimate: false, pitch: 0, jump: false, dash: false, melee: false }
}

function setup() {
  return createWorld(BOSS_LEVEL, createDefaultTuning())
}

function place(world: World, x: number, y: number): void {
  world.player.pos = { x, y }
  world.player.prev = { x, y }
}

function run(world: World, command: PlayerCommand, seconds: number): void {
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) stepWorld(world, command, DT)
}

function bossOf(world: World): Enemy {
  if (!world.boss?.boss) throw new Error('level has no boss')
  return world.boss
}

function force(world: World, move: BossMoveId): void {
  const boss = bossOf(world)
  if (!boss.boss) return
  boss.boss.order = [move]
  boss.boss.moveIndex = 0
  boss.boss.phase = 'walk'
  boss.boss.timer = 0
}

function count(world: World, type: string): number {
  return world.events.filter((event) => event.type === type).length
}

describe('boss', () => {
  it('stays dormant and ignores bullets before the fight starts', () => {
    const world = setup()
    place(world, 6.5, 12.5)
    stepWorld(world, { ...idle(), fire: true }, DT)
    run(world, idle(), 1)
    const boss = bossOf(world)
    expect(boss.boss?.phase).toBe('dormant')
    expect(boss.hp).toBe(DEF.maxHp)
  })

  it('wakes up and seals the arena when the player walks in', () => {
    const world = setup()
    place(world, 6.5, 8.5)
    stepWorld(world, idle(), DT)
    expect(bossOf(world).boss?.phase).toBe('intro')
    expect(count(world, 'bossIntro')).toBe(1)
    expect(BOSS_LEVEL.areas[1].gates.every((index) => world.grid.tiles[index] === Tile.GateClosed)).toBe(true)
  })

  it('slams the ground and sends a shockwave ring out that hits a player standing still', () => {
    const world = setup()
    place(world, 6.5, 7.5)
    stepWorld(world, idle(), DT)
    force(world, 'slam')
    run(world, idle(), WEAPONS.strawSlam.windup - 0.05)
    expect(world.rings).toHaveLength(0)
    expect(world.player.hp).toBe(world.player.maxHp)
    run(world, idle(), 0.1)
    expect(count(world, 'ringStarted')).toBe(1)
    expect(world.blasts).toHaveLength(0)
    run(world, idle(), 0.4)
    expect(world.player.hp).toBe(world.player.maxHp - WEAPONS.strawSlam.damage)
    expect(world.rings.every((ring) => ring.hitPlayer)).toBe(true)
  })

  it('charges along the line it telegraphed', () => {
    const world = setup()
    place(world, 6.5, 8.5)
    stepWorld(world, idle(), DT)
    force(world, 'charge')
    run(world, idle(), DEF.charge.telegraph + 0.6)
    expect(world.player.hp).toBe(world.player.maxHp - DEF.charge.damage)
  })

  it('fires its volleys as a fan of bullets', () => {
    const world = setup()
    place(world, 6.5, 9.5)
    stepWorld(world, idle(), DT)
    force(world, 'fan')
    run(world, idle(), WEAPONS.strawFan.windup + WEAPONS.strawFan.burstInterval * (WEAPONS.strawFan.burstCount - 1) + 0.6)
    expect(count(world, 'enemyShot')).toBe(WEAPONS.strawFan.burstCount)
  })

  it('calls in adds once at half health', () => {
    const world = setup()
    place(world, 6.5, 8.5)
    stepWorld(world, idle(), DT)
    const boss = bossOf(world)
    boss.hp = boss.maxHp * DEF.summonAt - 1
    stepWorld(world, idle(), DT)
    stepWorld(world, idle(), DT)
    expect(world.spawns).toHaveLength(DEF.summon.reduce((sum, wave) => sum + wave.count, 0))
    expect(count(world, 'bossSummon')).toBe(1)
  })

  it('flies into a rage at half health and adds a double charge', () => {
    const world = setup()
    place(world, 6.5, 8.5)
    stepWorld(world, idle(), DT)
    const boss = bossOf(world)
    boss.hp = boss.maxHp * 0.5 - 1
    stepWorld(world, idle(), DT)
    const rage = DEF.phases[1]
    expect(boss.boss?.phaseIndex).toBe(1)
    expect(rage.name).toBe('狂怒')
    expect(boss.boss?.order).toContain('frenzy')
    expect(DEF.frenzy?.charges).toBe(2)
    expect(world.events.some((event) => event.type === 'bossPhase' && event.name === rage.name)).toBe(true)
  })

  it('leaves a health pack in the arena when calling in adds', () => {
    const world = setup()
    place(world, 6.5, 8.5)
    stepWorld(world, idle(), DT)
    const boss = bossOf(world)
    boss.hp = boss.maxHp * DEF.summonAt - 1
    stepWorld(world, idle(), DT)
    const packs = world.pickups.filter((pickup) => pickup.item.type === 'heal')
    expect(packs).toHaveLength(1)
    expect(packs[0].life).toBe(Infinity)
  })

  it('pays boss experience by tier when defeated', () => {
    const world = setup()
    place(world, 6.5, 8.5)
    stepWorld(world, idle(), DT)
    killEnemy(world, bossOf(world), true)
    expect(world.rewards.boss).toBe(80)
  })

  it('removes enemy bullets still in the air when the killing shot lands', () => {
    const world = setup()
    place(world, 6.5, 9.5)
    stepWorld(world, idle(), DT)
    force(world, 'fan')
    run(world, idle(), WEAPONS.strawFan.windup + 0.05)
    expect(world.bullets.some((bullet) => bullet.team === 'enemy')).toBe(true)
    const boss = bossOf(world)
    boss.boss!.phaseIndex = getBoss('scarecrow').phases.length - 1
    boss.hp = 1
    world.player.facing = -Math.PI / 2
    stepWorld(world, { ...idle(6.5, 5.5), fire: true }, DT)
    run(world, idle(6.5, 5.5), 0.3)
    expect(boss.hp).toBe(0)
    expect(world.bullets.some((bullet) => bullet.team === 'enemy')).toBe(false)
  })

  it('opens the arena and clears its adds when defeated', () => {
    const world = setup()
    place(world, 6.5, 8.5)
    stepWorld(world, idle(), DT)
    const boss = bossOf(world)
    boss.hp = boss.maxHp * DEF.summonAt - 1
    stepWorld(world, idle(), DT)
    killEnemy(world, boss, true)
    stepWorld(world, idle(), DT)
    expect(world.spawns).toHaveLength(0)
    expect(count(world, 'bossDefeated')).toBe(1)
    expect(world.areas[1].status).toBe('cleared')
    expect(BOSS_LEVEL.areas[1].gates.every((index) => world.grid.tiles[index] === Tile.Gate)).toBe(true)
  })
})
