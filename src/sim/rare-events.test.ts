import { describe, expect, it, vi } from 'vitest'
import { LEVEL_1_1 } from '../data/levels/level-1-1'
import { LEVEL_1_2 } from '../data/levels/level-1-2'
import { BOLT_CAMEO, COURIER } from '../data/rare-events'
import { createDefaultTuning } from '../data/tuning'
import { SPECIAL_WEAPONS, type PlayerWeaponId } from '../data/weapons'
import { areaDefeated } from './areas'
import { placePlayer, teleportToArea } from './cheats'
import { damageEnemy, killEnemy } from './combat'
import { buildLevel } from './level'
import { crumbling, swingMelee } from './melee'
import { aggro } from './perception'
import { spawnPickup, weaponItem } from './pickups'
import { spawnBullet } from './projectiles'
import { callBoltCameo, createRareEventState, spawnCourier } from './rare-events'
import { areaQuiet } from './sheep'
import { freezeEnemy } from './status'
import { idleCommand, stepWorld } from './step'
import { levelFromAreas, singleArea } from './testing'
import { createEnemy, createWorld, type World } from './world'

const DT = 1 / 60
const HALL = [
  '##########XXX#########',
  '#....................#',
  '#....................#',
  '#....................#',
  '#....................#',
  '#....................#',
  '#....................#',
  '#....................#',
  '#....................#',
  '#.........P..........#',
  '######################',
]

function advance(world: World, seconds: number): void {
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) stepWorld(world, idleCommand(world), DT)
}

describe('rare event scheduling', () => {
  it('never rolls rare events on a first run of 1-1, and gates Bolt behind clearing 1-5 on replay', () => {
    const level1 = buildLevel(LEVEL_1_1)
    const level2 = buildLevel(LEVEL_1_2)
    for (let seed = 1; seed <= 80; seed++) {
      const first1 = createRareEventState(level1, seed, { rareEvents: true, replay: false, chapter1Cleared: false })
      expect(first1.courier).toBeNull()
      expect(first1.bolt).toBeNull()

      const noFinale = createRareEventState(level2, seed, { rareEvents: true, replay: true, chapter1Cleared: false })
      expect(noFinale.bolt).toBeNull()

      const firstClearWithFinale = createRareEventState(level2, seed, { rareEvents: true, replay: false, chapter1Cleared: true })
      expect(firstClearWithFinale.bolt).toBeNull()
    }
  })

  it('picks non-start, non-boss areas for the courier and samples roughly the target rates', () => {
    const level2 = buildLevel(LEVEL_1_2)
    let firstCouriers = 0
    let replayCouriers = 0
    let boltCameos = 0
    const N = 200
    for (let seed = 1; seed <= N; seed++) {
      const first = createRareEventState(level2, seed, { rareEvents: true, replay: false })
      if (first.courier) {
        firstCouriers += 1
        expect(first.courier.area).toBeGreaterThan(0)
        expect(level2.areas[first.courier.area].kind).not.toBe('boss')
      }
      const replay = createRareEventState(level2, seed, { rareEvents: true, replay: true, chapter1Cleared: true })
      if (replay.courier) replayCouriers += 1
      if (replay.bolt) {
        boltCameos += 1
        expect(replay.bolt.rushIndex).toBeGreaterThanOrEqual(0)
        expect(replay.bolt.rushIndex).toBeLessThan(level2.rushes.length)
      }
    }
    expect(firstCouriers).toBeGreaterThan(40)
    expect(firstCouriers).toBeLessThan(100)
    expect(replayCouriers).toBeGreaterThan(firstCouriers)
    expect(boltCameos).toBeGreaterThan(18)
    expect(boltCameos).toBeLessThan(70)
  })
})

describe('grain courier', () => {
  it('spawns in the farthest corner when entering its area, rings a bell and adds the courier bounty', () => {
    const level = buildLevel(LEVEL_1_2)
    let chosenSeed = 1
    for (let seed = 1; seed <= 50; seed++) {
      if (createRareEventState(level, seed, { rareEvents: true, replay: true }).courier) {
        chosenSeed = seed
        break
      }
    }
    const world = createWorld(level, createDefaultTuning(), { seed: chosenSeed, rareEvents: true, replay: true })
    const targetArea = world.rare.courier?.area ?? 1
    expect(world.bounties.some((b) => b.id === 'courier')).toBe(false)

    teleportToArea(world, targetArea)
    stepWorld(world, idleCommand(world), DT)

    const courier = world.enemies.find((enemy) => enemy.role === 'courier')
    expect(courier).toBeDefined()
    expect(spawnCourier(world, targetArea)).toBeNull()
    expect(courier?.hp).toBe(COURIER.hp)
    expect(Math.hypot((courier?.pos.x ?? 0) - world.player.pos.x, (courier?.pos.y ?? 0) - world.player.pos.y)).toBeGreaterThan(10)
    expect(world.events.some((event) => event.type === 'courierSpawned')).toBe(true)
    expect(world.bounties.some((b) => b.id === 'courier')).toBe(true)
  })

  it('apologizes when alerted, flees toward the exit without attacking, leaks food every 25% HP and fails the bounty on escape', () => {
    const world = createWorld(singleArea(HALL), createDefaultTuning())
    const courier = spawnCourier(world, 0, { x: 10.5, y: 7.5 })
    expect(courier).not.toBeNull()
    if (!courier) return

    aggro(world, courier)
    world.events.length = 0
    stepWorld(world, idleCommand(world), DT)
    expect(world.events.some((event) => event.type === 'bark' && event.display === 'bubble' && event.enemy === courier.id)).toBe(true)

    damageEnemy(world, courier, 260, 0, -1, 0)
    const leakedFoods = world.pickups.filter((p) => p.item.type === 'heal' && p.item.food !== undefined)
    expect(leakedFoods).toHaveLength(2)
    expect(world.events.filter((e) => e.type === 'courierLeaked')).toHaveLength(2)

    advance(world, 4)
    expect(world.stats.hits).toBe(0)
    expect(world.enemies.some((e) => e.id === courier.id)).toBe(false)
    expect(world.bounties.find((b) => b.id === 'courier')?.failed).toBe(true)
  })

  it('survives a sneak melee with half HP and reel, then drops 3 foods, ammo, unowned weapon and completes the bounty on death', () => {
    const owned: PlayerWeaponId[] = SPECIAL_WEAPONS.filter((id) => id !== 'arc')
    const world = createWorld(singleArea(HALL), createDefaultTuning(), { unlockedWeapons: owned })
    vi.spyOn(world.lootRng, 'next').mockReturnValue(0)
    const courier = spawnCourier(world, 0, { x: 10.5, y: 7.8 })!
    courier.facing = -Math.PI / 2
    courier.baseFacing = -Math.PI / 2
    world.player.facing = -Math.PI / 2

    swingMelee(world)
    expect(courier.hp).toBe(COURIER.hp * 0.5)
    expect(courier.status.dazed).toBeGreaterThan(0)

    const { x, y } = world.player.pos
    spawnBullet(world, 'player', x, y, 0, -Math.PI / 2, 'blaster', { damageScale: 10 })
    advance(world, 0.2)

    expect(world.bounties.find((b) => b.id === 'courier')?.done).toBe(true)
    expect(world.rewards.kills).toBe(COURIER.xp)
    expect(world.pickups.some((p) => p.item.type === 'ammo')).toBe(true)
    expect(world.pickups.filter((p) => p.item.type === 'heal' && p.item.food !== undefined)).toHaveLength(5)
    expect(world.pickups.find((p) => p.item.type === 'weapon')?.item).toMatchObject({ weapon: 'arc' })
  })

  it('does not drop a previously unowned gun if the player picks it up earlier in the run', () => {
    const owned = SPECIAL_WEAPONS.filter((id) => id !== 'arc')
    const world = createWorld(singleArea(HALL), createDefaultTuning(), { unlockedWeapons: owned })
    const { x, y } = world.player.pos
    spawnPickup(world, weaponItem(world, 'arc'), x, y, { scatter: false })
    advance(world, 1)
    stepWorld(world, { ...idleCommand(world), interact: true }, DT)
    expect(world.player.special).toBe('arc')

    const courier = spawnCourier(world, 0, { x, y: y - 2 })!
    vi.spyOn(world.lootRng, 'next').mockReturnValue(0)
    damageEnemy(world, courier, courier.hp, 0, -1, 0)

    expect(world.pickups.some((p) => p.item.type === 'ammo')).toBe(true)
    expect(world.pickups.some((p) => p.item.type === 'weapon')).toBe(false)
  })

  it('is optional for clearing the area and does not grant a reward if cleaned up by the level', () => {
    const world = createWorld(singleArea(HALL, 'lock'), createDefaultTuning())
    const courier = spawnCourier(world, 0, { x: 10.5, y: 7.5 })!

    expect(areaDefeated(world, 0)).toBe(true)
    expect(areaQuiet(world, 0)).toBe(true)
    killEnemy(world, courier, false, false)

    expect(world.rewards.kills).toBe(0)
    expect(world.pickups).toHaveLength(0)
    expect(world.bounties.find((b) => b.id === 'courier')?.failed).toBe(true)
  })
})

describe('Captain Bolt cameo', () => {
  it('crashes down halfway through the chosen rush wave, fires as a turret, ignores crumble smash and ejects at 30% HP leaving a weapon chest', () => {
    const areaDef = {
      name: '广场',
      theme: 'village' as const,
      rows: HALL.map((row, index) => index === 4 ? '#.m..................#' : row),
      rushes: [{ at: [[4, 2] as const, [16, 2] as const], enemies: [{ kind: 'grunt' as const, count: 4 }], left: 0 }],
    }
    const level = levelFromAreas([areaDef])
    const tuning = createDefaultTuning()
    tuning.grunt.speed = 0
    tuning.feel.hitstopKill = 0
    const world = createWorld(level, tuning, { seed: 7, debug: { invincible: true }, rareEvents: true, replay: true, chapter1Cleared: true })
    world.enemies[0].hp = 0
    world.rare.bolt = {
      rushIndex: 0,
      triggered: false,
      waveMarkers: [],
      waveEnemies: [],
      waveTotal: 0,
      landing: null,
      enemyId: null,
      ejected: false,
    }

    advance(world, 2.2)
    const rushGrunts = world.enemies.filter((e) => e.kind === 'grunt')
    expect(rushGrunts).toHaveLength(4)
    expect(world.rare.bolt.triggered).toBe(false)

    damageEnemy(world, rushGrunts[0], 999, 1, 0, 0)
    stepWorld(world, idleCommand(world), DT)
    expect(world.rare.bolt.triggered).toBe(false)
    damageEnemy(world, rushGrunts[1], 999, 1, 0, 0)
    stepWorld(world, idleCommand(world), DT)

    expect(world.rare.bolt.triggered).toBe(true)
    expect(world.rare.bolt.landing).not.toBeNull()
    const { x, y } = world.rare.bolt.landing!.blast
    const victim = createEnemy(world, 'turret', { x: x + 0.5, y }, 0)
    victim.hp = 100
    world.enemies.push(victim)

    advance(world, BOLT_CAMEO.warning + 0.25)
    expect(world.events.some((event) => event.type === 'blast' && event.source === 'pod')).toBe(true)
    expect(victim.hp).toBeLessThanOrEqual(0)

    const boltPod = world.enemies.find((e) => e.role === 'bolt')
    expect(boltPod).toBeDefined()
    expect(boltPod?.hp).toBe(BOLT_CAMEO.hp)
    expect(world.events.some((e) => e.type === 'bark' && e.speaker === 'bolt' && e.radio === true)).toBe(true)
    if (!boltPod) return

    world.events.length = 0
    advance(world, 1)
    expect(world.events.some((event) => event.type === 'enemyShot' && event.weapon === 'cannon')).toBe(true)
    freezeEnemy(world, boltPod, 2)
    expect(crumbling(world, boltPod)).toBe(false)

    world.events.length = 0
    const chestsBefore = world.chests.length
    damageEnemy(world, boltPod, BOLT_CAMEO.hp * (1 - BOLT_CAMEO.retreatShare) - 1, 1, 0, 0)
    expect(boltPod.hp).toBe(BOLT_CAMEO.hp * BOLT_CAMEO.retreatShare + 1)
    expect(world.chests).toHaveLength(chestsBefore)
    placePlayer(world, { x: boltPod.pos.x, y: boltPod.pos.y + 1 })
    world.player.facing = -Math.PI / 2
    tuning.player.meleeDamage = BOLT_CAMEO.hp
    swingMelee(world)

    expect(boltPod.hp).toBe(0)
    expect(world.events.some((e) => e.type === 'boltEjected')).toBe(true)
    expect(world.events.some((e) => e.type === 'enemyKilled' && e.id === boltPod.id)).toBe(false)
    expect(world.events.some((e) => e.type === 'bark' && e.speaker === 'bolt')).toBe(true)
    expect(world.chests).toHaveLength(chestsBefore + 1)
    expect(world.chests[world.chests.length - 1].tier).toBe('weapon')
  })

  it('supports manual callBoltCameo helper and damages nearby player or enemies on impact', () => {
    const world = createWorld(singleArea(HALL), createDefaultTuning())
    const spot = { x: world.player.pos.x + 1, y: world.player.pos.y }
    const landing = callBoltCameo(world, spot)
    expect(landing).not.toBeNull()
    expect(callBoltCameo(world, spot)).toBeNull()
    const hpBefore = world.player.hp
    advance(world, BOLT_CAMEO.warning + 0.05)
    expect(world.player.hp).toBeLessThan(hpBefore)
    expect(world.enemies.some((e) => e.role === 'bolt')).toBe(true)
  })
})
