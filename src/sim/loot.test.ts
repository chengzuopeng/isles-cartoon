import { describe, expect, it } from 'vitest'
import { CRATE_HP, DROP_PITY, DROP_RATES, DROP_WEIGHTS, HEAL_SMALL, PICKUP_LIFETIME } from '../data/loot'
import { RARE_CHEST_XP } from '../data/progression'
import { createDefaultTuning } from '../data/tuning'
import { giveSpecialWeapon } from './arsenal'
import { killEnemy } from './combat'
import { Tile } from './grid'
import { rollItem, spawnPickup } from './pickups'
import { stepWorld } from './step'
import { pitchToward, singleArea } from './testing'
import type { PlayerCommand } from './types'
import { createEnemy, createWorld, type World } from './world'

const DT = 1 / 60
const OPEN = ['##############', '#............#', '#.P..........#', '#............#', '##############']

function idle(aimX = 100, aimY = 2.5): PlayerCommand {
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

function killMany(world: World, count: number): boolean[] {
  const dropped: boolean[] = []
  for (let i = 0; i < count; i++) {
    const before = world.pickups.length
    const enemy = createEnemy(world, 'grunt', { x: 8.5, y: 2.5 }, 0)
    world.enemies.push(enemy)
    killEnemy(world, enemy, true)
    dropped.push(world.pickups.length > before)
    world.pickups.length = 0
  }
  world.enemies.length = 0
  return dropped
}

describe('enemy drops', () => {
  it('drops at the advertised rate once the pity rule is accounted for', () => {
    const { world } = setup()
    const drops = killMany(world, 3000).filter(Boolean).length
    const rate = DROP_RATES.grunt
    const expected = rate / (1 - (1 - rate) ** (DROP_PITY + 1))
    expect(drops / 3000).toBeGreaterThan(expected * 0.85)
    expect(drops / 3000).toBeLessThan(expected * 1.15)
  })

  it('never lets more than eight kills in a row go empty', () => {
    const { world } = setup()
    let streak = 0
    let longest = 0
    for (const dropped of killMany(world, 1500)) {
      streak = dropped ? 0 : streak + 1
      longest = Math.max(longest, streak)
    }
    expect(longest).toBeLessThanOrEqual(DROP_PITY)
  })

  it('only rolls ammo while the hero carries a special weapon', () => {
    const { world } = setup()
    const without = Array.from({ length: 400 }, () => rollItem(world, DROP_WEIGHTS).type)
    expect(without).not.toContain('ammo')
    giveSpecialWeapon(world, 'smg')
    const withWeapon = Array.from({ length: 400 }, () => rollItem(world, DROP_WEIGHTS).type)
    expect(withWeapon).toContain('ammo')
    expect(withWeapon).toContain('weapon')
  })

  it('gives the same loot for the same seed', () => {
    const items = [5, 5].map((seed) => {
      const { world } = setup(OPEN, seed)
      return Array.from({ length: 20 }, () => rollItem(world, DROP_WEIGHTS))
    })
    expect(items[0]).toEqual(items[1])
  })
})

describe('pickups', () => {
  it('picks up health only when hurt', () => {
    const { world } = setup()
    const { player } = world
    spawnPickup(world, { type: 'heal', amount: HEAL_SMALL }, player.pos.x, player.pos.y, { scatter: false })
    run(world, idle(), 0.5)
    expect(world.pickups).toHaveLength(1)
    player.hp = 500
    run(world, idle(), 0.1)
    expect(world.pickups).toHaveLength(0)
    expect(player.hp).toBeCloseTo(500 + player.maxHp * HEAL_SMALL, 0)
  })

  it('vanishes after twenty seconds unless persistent', () => {
    const { world } = setup()
    spawnPickup(world, { type: 'ammo' }, 10.5, 2.5, { scatter: false })
    spawnPickup(world, { type: 'ammo' }, 11.5, 2.5, { scatter: false, persistent: true })
    run(world, idle(), PICKUP_LIFETIME + 0.1)
    expect(world.pickups).toHaveLength(1)
    expect(world.pickups[0].life).toBe(Infinity)
  })

  it('refills half a magazine of special ammo', () => {
    const { world, tuning } = setup()
    const { player } = world
    giveSpecialWeapon(world, 'smg')
    player.specialAmmo = 5
    spawnPickup(world, { type: 'ammo' }, player.pos.x, player.pos.y, { scatter: false })
    run(world, idle(), 0.4)
    expect(player.specialAmmo).toBe(5 + Math.ceil(tuning.weapons.smg.magazine / 2))
  })

  it('needs the interact key for weapons and leaves the old weapon behind', () => {
    const { world } = setup()
    const { player } = world
    giveSpecialWeapon(world, 'smg')
    player.specialAmmo = 10
    spawnPickup(world, { type: 'weapon', weapon: 'shotgun', ammo: 12 }, player.pos.x + 0.6, player.pos.y, {
      scatter: false,
      persistent: true,
    })
    run(world, idle(), 0.5)
    expect(player.special).toBe('smg')
    stepWorld(world, { ...idle(), interact: true }, DT)
    expect(player.special).toBe('shotgun')
    expect(player.specialAmmo).toBe(12)
    expect(world.pickups.map((pickup) => pickup.item)).toEqual([{ type: 'weapon', weapon: 'smg', ammo: 10 }])
  })
})

describe('chests', () => {
  it('open with the interact key and spill supplies', () => {
    const { world } = setup(['########', '#P$....#', '########'])
    run(world, idle(), 0.1)
    expect(world.chests[0].opened).toBe(false)
    stepWorld(world, { ...idle(), interact: true }, DT)
    expect(world.chests[0].opened).toBe(true)
    expect(world.pickups.length).toBeGreaterThanOrEqual(2)
    expect(world.pickups.length).toBeLessThanOrEqual(3)
    expect(world.pickups.every((pickup) => pickup.item.type !== 'weapon')).toBe(true)
  })

  it('hold a special weapon in the weapon chest and bonus experience in the rare chest', () => {
    const { world } = setup(['########', '#PW.R..#', '########'])
    stepWorld(world, { ...idle(), interact: true }, DT)
    expect(world.pickups.map((pickup) => pickup.item.type)).toEqual(['weapon'])
    world.player.pos.x = 3.5
    stepWorld(world, { ...idle(), interact: true }, DT)
    expect(world.chests.every((chest) => chest.opened)).toBe(true)
    expect(world.rewards.chests).toBe(RARE_CHEST_XP)
    expect(world.pickups.filter((pickup) => pickup.item.type === 'weapon')).toHaveLength(2)
  })
})

describe('crates', () => {
  it('break under fire and open the way', () => {
    const { world, tuning } = setup(['##########', '#P..c....#', '##########'])
    const crate = 1 * world.grid.columns + 4
    const burst = tuning.weapons.blaster.burstCount * tuning.weapons.blaster.damage
    const bursts = Math.ceil(CRATE_HP / burst)
    const aim = { ...idle(4.5, 1.5), pitch: pitchToward(world, 4.5, 1.5, 0.5) }
    for (let i = 0; i < bursts; i++) {
      stepWorld(world, { ...aim, fire: true }, DT)
      run(world, aim, 0.6)
    }
    expect(world.grid.tiles[crate]).toBe(Tile.Floor)
    expect(world.events.some((event) => event.type === 'crateBroken')).toBe(true)
  })
})

describe('supply points', () => {
  it('heal half of max health once', () => {
    const { world } = setup(['########', '#P+....#', '########'])
    const { player } = world
    player.hp = 300
    run(world, { ...idle(), moveX: 1 }, 0.4)
    expect(player.hp).toBeCloseTo(300 + player.maxHp / 2, 0)
    expect(world.supplies[0].used).toBe(true)
    player.hp = 300
    run(world, { ...idle(), moveX: -1 }, 0.4)
    expect(player.hp).toBeLessThan(400)
  })
})
