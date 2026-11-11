import { describe, expect, it } from 'vitest'
import { CLEAR_WEAPONS, DROP_WEIGHTS } from '../data/loot'
import { createDefaultTuning } from '../data/tuning'
import { openChest, spawnPickup } from './pickups'
import { createProfile, loadoutOf, sanitizeProfile, setCarry, settleRun, unlockWeapon } from './profile'
import { rateRun } from './rating'
import { stepWorld } from './step'
import { createLoadout } from './stats'
import { singleArea } from './testing'
import type { PlayerCommand } from './types'
import { createWorld, type World } from './world'

const DT = 1 / 60
const OPEN = ['##############', '#............#', '#.P...W......#', '#............#', '##############']

function idle(patch: Partial<PlayerCommand> = {}): PlayerCommand {
  return { moveX: 0, moveY: 0, aimX: 100, aimY: 2.5, fire: false, slot: null, interact: false, skill: null, ultimate: false, pitch: 0, jump: false, dash: false, melee: false, ...patch }
}

function carrying(id: 'shotgun' | 'smg' | null): World {
  return createWorld(singleArea(OPEN), createDefaultTuning(), { loadout: createLoadout({}, [], id) })
}

function run(world: World, seconds: number, patch: Partial<PlayerCommand> = {}): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) stepWorld(world, idle(patch), DT)
}

describe('the weapon rack in the save', () => {
  it('unlocks a weapon once, keeps the list in weapon order and carries the first one found', () => {
    const profile = createProfile()
    expect(profile.weapons).toEqual([])
    expect(unlockWeapon(profile, 'sniper')).toBe(true)
    expect(unlockWeapon(profile, 'shotgun')).toBe(true)
    expect(unlockWeapon(profile, 'shotgun')).toBe(false)
    expect(profile.weapons).toEqual(['shotgun', 'sniper'])
    expect(profile.carry).toBe('sniper')
    expect(loadoutOf(profile).special).toBe('sniper')
  })

  it('lets the player pick any unlocked weapon or none', () => {
    const profile = createProfile()
    unlockWeapon(profile, 'smg')
    expect(setCarry(profile, 'rocket')).toBe(false)
    expect(setCarry(profile, null)).toBe(true)
    expect(loadoutOf(profile).special).toBeNull()
    expect(setCarry(profile, 'smg')).toBe(true)
    expect(loadoutOf(profile).special).toBe('smg')
  })

  it('hands out the fixed weapon of each level on its first clear only', () => {
    const profile = createProfile()
    const world = createWorld(singleArea(OPEN, 'normal', { id: '1-1' }), createDefaultTuning())
    world.status = 'complete'
    const first = settleRun(profile, world, rateRun(world))
    expect(first.newWeapons).toEqual([CLEAR_WEAPONS['1-1']])
    expect(settleRun(profile, world, rateRun(world)).newWeapons).toEqual([])
  })

  it('reads back weapons and drops a carried weapon that was never unlocked', () => {
    const profile = sanitizeProfile({ level: 3, weapons: ['smg', 'laser', 'shotgun'], carry: 'rocket' })
    expect(profile.weapons).toEqual(['shotgun', 'smg'])
    expect(profile.carry).toBeNull()
    expect(sanitizeProfile({ level: 3, weapons: ['smg'], carry: 'smg' }).carry).toBe('smg')
  })
})

describe('the carried weapon in a level', () => {
  it('starts full in slot two', () => {
    const world = carrying('shotgun')
    expect(world.player.special).toBe('shotgun')
    expect(world.player.specialAmmo).toBe(world.tuning.weapons.shotgun.magazine)
    expect(world.player.slot).toBe('primary')
  })

  it('stays in slot two when it runs dry, switches back to the blaster and refuses to be picked again until it has ammo', () => {
    const world = carrying('shotgun')
    world.player.specialAmmo = 1
    run(world, DT, { slot: 'special' })
    run(world, 1.2, { fire: true })
    expect(world.player.special).toBe('shotgun')
    expect(world.player.specialAmmo).toBe(0)
    expect(world.player.slot).toBe('primary')
    run(world, DT, { slot: 'special' })
    expect(world.player.slot).toBe('primary')
    spawnPickup(world, { type: 'ammo' }, world.player.pos.x + 0.3, world.player.pos.y, { scatter: false })
    run(world, 0.6)
    expect(world.player.specialAmmo).toBeGreaterThan(0)
  })

  it('leaves the carried weapon on the floor, even an empty one, when the player takes another', () => {
    const world = carrying('shotgun')
    world.player.specialAmmo = 0
    spawnPickup(world, { type: 'weapon', weapon: 'smg', ammo: 60 }, world.player.pos.x + 0.6, world.player.pos.y, { persistent: true, scatter: false })
    run(world, 0.4)
    run(world, DT, { interact: true, aimX: world.player.pos.x + 0.6, aimY: world.player.pos.y })
    expect(world.player.special).toBe('smg')
    expect(world.pickups.map((pickup) => pickup.item)).toEqual([{ type: 'weapon', weapon: 'shotgun', ammo: 0 }])
  })

  it('gets a full refill and a random weapon from a weapon chest', () => {
    const world = carrying('shotgun')
    world.player.specialAmmo = 2
    openChest(world, world.chests[0])
    expect(world.player.specialAmmo).toBe(world.tuning.weapons.shotgun.magazine)
    expect(world.pickups.filter((pickup) => pickup.item.type === 'weapon')).toHaveLength(1)
  })

  it('makes ammo six times as likely as a weapon in ordinary drops', () => {
    expect(DROP_WEIGHTS.ammo).toBe(DROP_WEIGHTS.weapon * 6)
  })
})
