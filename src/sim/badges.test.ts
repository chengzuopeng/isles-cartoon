import { describe, expect, it } from 'vitest'
import { BADGE, type BadgeId } from '../data/badges'
import { EYE_CRIT } from '../data/heights'
import { createDefaultTuning } from '../data/tuning'
import { firePattern } from './arsenal'
import { damagePlayer, spawnBlast } from './combat'
import { badgeSlots, createProfile, loadoutOf, ownedBadges, sanitizeProfile, settleRun, toggleBadge } from './profile'
import { rateRun } from './rating'
import { stepWorld } from './step'
import { createLoadout } from './stats'
import { singleArea } from './testing'
import type { GameEvent, PlayerCommand } from './types'
import { createWorld, type World } from './world'

const DT = 1 / 60
const OPEN = ['######################', '#....................#', '#....................#', '#..P.................#', '#....................#', '#....................#', '######################']
const GRASS = OPEN.map((row, index) => (index === 3 ? '#..P"""""............#' : row))

function wearing(badges: BadgeId[], rows = OPEN): World {
  return createWorld(singleArea(rows), createDefaultTuning(), { loadout: createLoadout({}, [], null, badges) })
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

describe('earning and wearing badges', () => {
  it('earns the boss badge of a level with its first clear and tells the results screen', () => {
    const profile = createProfile()
    const world = createWorld(singleArea(OPEN, 'normal', { id: '1-2' }), createDefaultTuning())
    world.status = 'complete'
    expect(settleRun(profile, world, rateRun(world)).newBadges).toContain('fuse')
    expect(ownedBadges(profile)).toContain('fuse')
  })

  it('opens badge slots at levels 1, 5 and 12 and only wears owned badges', () => {
    const profile = createProfile()
    profile.records['1-1'] = { cleared: true, bestStars: 1, bestTime: 100, clears: 1 }
    profile.records['1-2'] = { cleared: true, bestStars: 1, bestTime: 100, clears: 1 }
    expect(badgeSlots(profile)).toBe(1)
    expect(toggleBadge(profile, 'door')).toBe(false)
    expect(toggleBadge(profile, 'straw')).toBe(true)
    expect(toggleBadge(profile, 'fuse')).toBe(false)
    profile.level = 5
    expect(toggleBadge(profile, 'fuse')).toBe(true)
    expect(loadoutOf(profile).badges).toEqual(['straw', 'fuse'])
    expect(toggleBadge(profile, 'straw')).toBe(true)
    expect(profile.badges).toEqual(['fuse'])
    profile.level = 12
    expect(badgeSlots(profile)).toBe(3)
  })

  it('counts clues, three stars, flawless runs and bounties', () => {
    const profile = createProfile()
    profile.clues = ['star-altar', 'iou', 'crayon', 'radio', 'blueprint'].filter(() => true) as typeof profile.clues
    profile.records['1-3'] = { cleared: true, bestStars: 3, bestTime: 100, clears: 1, challenges: ['flawless'] }
    profile.bounties = BADGE.apprenticeBounties
    const owned = ownedBadges(profile)
    expect(owned).toContain('flawless')
    expect(owned).toContain('apprentice')
    expect(owned).not.toContain('veteran')
    expect(owned).not.toContain('stars')
  })

  it('reads back worn badges the save still owns', () => {
    const profile = sanitizeProfile({ level: 6, records: { '1-1': { cleared: true, bestStars: 1, bestTime: 90, clears: 1 } }, badges: ['straw', 'door', 'fake'] })
    expect(profile.badges).toEqual(['straw'])
  })
})

describe('badge effects', () => {
  it('straw hat speeds the hero up in tall grass', () => {
    const plain = wearing([], GRASS)
    const hat = wearing(['straw'], GRASS)
    for (const world of [plain, hat]) world.player.pos = { x: 5.5, y: 3.5 }
    run(plain, DT)
    run(hat, DT)
    expect(hat.playerStats.speed).toBeCloseTo(plain.playerStats.speed * (1 + BADGE.strawSpeed), 5)
  })

  it('fuse widens the hero explosions and halves blast damage taken', () => {
    const world = wearing(['fuse'])
    const blast = spawnBlast(world, { x: 10, y: 3, radius: 2, delay: 0, playerDamage: 0, enemyDamage: 100, source: 'player', ownerId: 0 })
    expect(blast.radius).toBeCloseTo(2 * BADGE.fuseRadius, 5)
    const { player } = world
    spawnBlast(world, { x: player.pos.x, y: player.pos.y, radius: 2, delay: 0, playerDamage: 200, enemyDamage: 0, source: 'bomber', ownerId: 0 })
    run(world, DT)
    expect(player.maxHp - player.hp).toBe(100)
  })

  it('door parries bullets from the front right after a swing', () => {
    const world = wearing(['door'])
    const { player } = world
    run(world, DT, { melee: true })
    firePattern(world, 'enemy', player.pos.x + 1.5, player.pos.y, 0.3, Math.PI, 'rifle', { z: player.z + 1, pitch: 0 })
    const events = run(world, 0.1)
    expect(events.some((event) => event.type === 'parried')).toBe(true)
    expect(player.hp).toBe(player.maxHp)
  })

  it('tread halves the knockback the hero takes', () => {
    const plain = wearing([])
    const tread = wearing(['tread'])
    damagePlayer(plain, 10, 1, 0, 10)
    damagePlayer(tread, 10, 1, 0, 10)
    expect(tread.player.knock.x).toBeCloseTo(plain.player.knock.x * BADGE.treadScale, 5)
  })

  it('morning star adds damage while the volley waits and heals when it fires', () => {
    const world = wearing(['star'])
    world.player.ultimate = 1
    world.player.hp = world.player.maxHp / 2
    run(world, DT)
    expect(world.playerStats.damage).toBeCloseTo(1 + BADGE.starDamage, 5)
    run(world, DT, { ultimate: true })
    expect(world.player.hp).toBeCloseTo(world.player.maxHp * (0.5 + BADGE.starHeal), 0)
  })

  it('three stars raises critical hits to 2.3 times', async () => {
    const { critScale } = await import('./badges')
    expect(critScale(wearing(['stars']), EYE_CRIT.scale)).toBeCloseTo(BADGE.starsCrit, 5)
    expect(critScale(wearing([]), EYE_CRIT.scale)).toBe(EYE_CRIT.scale)
  })

  it('flawless adds speed only at full health', () => {
    const world = wearing(['flawless'])
    run(world, DT)
    const fast = world.playerStats.speed
    world.player.hp -= 1
    run(world, DT)
    expect(fast).toBeCloseTo(world.playerStats.speed * (1 + BADGE.flawlessSpeed), 5)
  })
})
