import { MILESTONE } from '../data/progression'
import { hasMilestone } from './stats'
import {
  AMMO_REFILL,
  BUFF_ORDER,
  CHAPTER_WEAPONS,
  CHEST_REACH,
  CHEST_ITEMS_MAX,
  CHEST_ITEMS_MIN,
  CHEST_WEIGHTS,
  DROP_PITY,
  DROP_RATES,
  DROP_WEIGHTS,
  HEAL_LARGE,
  HEAL_LARGE_CHANCE,
  HEAL_SMALL,
  INTERACT_AIM_DEG,
  INTERACT_HEIGHTS,
  INTERACT_NEAR,
  INTERACT_RANGE,
  INTERACT_TILT_DEG,
  PICKUP_BODY,
  PICKUP_DELAY,
  PICKUP_LIFETIME,
  PICKUP_MAGNET,
  PICKUP_RADIUS,
  PICKUP_REACH_UP,
  PICKUP_SCATTER_MAX,
  PICKUP_SCATTER_MIN,
  SUPPLY_HEAL,
  SUPPLY_RADIUS,
  type DropType,
} from '../data/loot'
import { FOG } from '../data/fog'
import { RARE_CHEST_XP } from '../data/progression'
import { SPECIAL_WEAPONS, type PlayerWeaponId } from '../data/weapons'
import { equipSpecial, specialMagazine } from './arsenal'
import { giveBuff, healPlayer } from './buffs'
import { resolveCircleGrid, segmentClear } from './collision'
import { lightLamp } from './fog'
import { eyeHeightOf } from '../data/heights'
import { blocksMovement, floorAt } from './grid'
import type { Vec2 } from './math'
import type { Rng } from './rng'
import { openPen } from './sheep'
import type { Chest, Enemy, Pickup, PickupItem, PlayerCommand } from './types'
import type { World } from './world'

export interface SpawnOptions {
  persistent?: boolean
  from?: Vec2
  scatter?: boolean
}

export type InteractTarget =
  | { kind: 'weapon'; pickup: Pickup }
  | { kind: 'chest'; chest: Chest }
  | { kind: 'pen'; landmark: number; pos: Vec2 }
  | { kind: 'lamp'; lamp: number; pos: Vec2 }

export function spawnPickup(world: World, item: PickupItem, x: number, y: number, options: SpawnOptions = {}): Pickup {
  const source = { x, y }
  const pos = { x, y }
  if (options.scatter !== false) {
    const angle = world.lootRng.range(0, Math.PI * 2)
    const distance = world.lootRng.range(PICKUP_SCATTER_MIN, PICKUP_SCATTER_MAX)
    pos.x += Math.cos(angle) * distance
    pos.y += Math.sin(angle) * distance
    if (!segmentClear(world.grid, source, pos, blocksMovement)) {
      pos.x = source.x
      pos.y = source.y
    }
  }
  resolveCircleGrid(pos, PICKUP_BODY, world.grid)
  const from = options.from ?? source
  const pickup: Pickup = {
    id: world.nextId++,
    item,
    pos,
    from: { x: from.x, y: from.y },
    age: 0,
    life: options.persistent ? Infinity : PICKUP_LIFETIME,
  }
  world.pickups.push(pickup)
  world.events.push({ type: 'pickupDropped', id: pickup.id, x: pos.x, y: pos.y, item })
  return pickup
}

export function rollEnemyDrop(world: World, enemy: Enemy): void {
  if (enemy.kind === 'boss') return
  if (world.dropPity < DROP_PITY && world.lootRng.next() >= DROP_RATES[enemy.kind]) {
    world.dropPity += 1
    return
  }
  world.dropPity = 0
  spawnPickup(world, rollItem(world, DROP_WEIGHTS), enemy.pos.x, enemy.pos.y, { from: enemy.pos })
}

export function rollItem(world: World, weights: Readonly<Record<DropType, number>>): PickupItem {
  const allowed: Record<DropType, number> = { ...weights, ammo: world.player.special ? weights.ammo : 0 }
  return makeItem(world, pickWeighted(world.lootRng, allowed))
}

export function makeItem(world: World, type: DropType): PickupItem {
  const rng = world.lootRng
  switch (type) {
    case 'heal':
      return { type: 'heal', amount: rng.next() < HEAL_LARGE_CHANCE ? HEAL_LARGE : HEAL_SMALL }
    case 'buff':
      return { type: 'buff', buff: BUFF_ORDER[rng.int(BUFF_ORDER.length)] }
    case 'ammo':
      return { type: 'ammo' }
    case 'weapon':
      return weaponItem(world)
  }
}

export function weaponItem(world: World, id?: PlayerWeaponId): PickupItem {
  const pool = CHAPTER_WEAPONS[world.chapter] ?? SPECIAL_WEAPONS
  const weapon = id ?? pool[world.lootRng.int(pool.length)]
  return { type: 'weapon', weapon, ammo: specialMagazine(world, weapon) }
}

export function updatePickups(world: World, command: PlayerCommand, dt: number): void {
  const { player } = world
  const active = player.alive && world.status === 'playing'
  let kept = 0
  for (const pickup of world.pickups) {
    pickup.age += dt
    pickup.life -= dt
    if (pickup.life <= 0) continue
    if (active && pickup.age >= PICKUP_DELAY) {
      attract(world, pickup, dt)
      if (touching(world, pickup) && collect(world, pickup)) continue
    }
    world.pickups[kept++] = pickup
  }
  world.pickups.length = kept
  if (!active) return
  useSupplies(world)
  if (command.interact) interact(world)
}

interface InteractCandidate {
  target: InteractTarget
  x: number
  y: number
  z: number
  range: number
}

function interactCandidates(world: World): InteractCandidate[] {
  const { grid } = world
  const found: InteractCandidate[] = []
  for (const pickup of world.pickups) {
    if (pickup.item.type !== 'weapon' || pickup.age < PICKUP_DELAY) continue
    found.push({ target: { kind: 'weapon', pickup }, x: pickup.pos.x, y: pickup.pos.y, z: floorAt(grid, pickup.pos.x, pickup.pos.y) + INTERACT_HEIGHTS.weapon, range: INTERACT_RANGE })
  }
  for (const chest of world.chests) {
    if (chest.opened) continue
    const z = chest.perch ? floorAt(grid, chest.perch.x, chest.perch.y) + chest.perch.height : floorAt(grid, chest.pos.x, chest.pos.y)
    found.push({ target: { kind: 'chest', chest }, x: chest.pos.x, y: chest.pos.y, z: z + INTERACT_HEIGHTS.chest, range: INTERACT_RANGE + CHEST_REACH })
  }
  world.level.landmarks.forEach((placement, index) => {
    const gate = placement.gate
    if (!gate || world.landmarks[index].open) return
    const pos = penDoorway(gate)
    found.push({ target: { kind: 'pen', landmark: index, pos }, x: pos.x, y: pos.y, z: floorAt(grid, pos.x, pos.y) + INTERACT_HEIGHTS.pen, range: INTERACT_RANGE })
  })
  world.level.lamps.forEach((lamp, index) => {
    if (world.lamps[index]) return
    found.push({ target: { kind: 'lamp', lamp: index, pos: { x: lamp.x, y: lamp.y } }, x: lamp.x, y: lamp.y, z: floorAt(grid, lamp.x, lamp.y) + INTERACT_HEIGHTS.lamp, range: FOG.lampReach })
  })
  return found
}

export function interactTarget(world: World): InteractTarget | null {
  const { player } = world
  const eyeZ = player.z + eyeHeightOf('player')
  const turn = (INTERACT_AIM_DEG * Math.PI) / 180
  const tilt = (INTERACT_TILT_DEG * Math.PI) / 180
  let aimed: InteractTarget | null = null
  let bestTurn = turn
  let near: InteractTarget | null = null
  let nearest = INTERACT_NEAR
  for (const candidate of interactCandidates(world)) {
    const dx = candidate.x - player.pos.x
    const dy = candidate.y - player.pos.y
    const distance = Math.hypot(dx, dy)
    if (distance > candidate.range) continue
    if (distance <= nearest) {
      nearest = distance
      near = candidate.target
    }
    if (distance < 1e-6) continue
    const off = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - player.facing), Math.cos(Math.atan2(dy, dx) - player.facing)))
    const lean = Math.abs(Math.atan2(candidate.z - eyeZ, distance) - player.pitch)
    if (off <= bestTurn && lean <= tilt) {
      bestTurn = off
      aimed = candidate.target
    }
  }
  return aimed ?? near
}

export function penDoorway(gate: { column: number; row: number; outX: number; outY: number }): Vec2 {
  return { x: gate.column + 0.5 + gate.outX * 0.5, y: gate.row + 0.5 + gate.outY * 0.5 }
}

export function openChest(world: World, chest: Chest): void {
  if (chest.opened) return
  chest.opened = true
  world.events.push({ type: 'chestOpened', x: chest.pos.x, y: chest.pos.y, tier: chest.tier })
  const items: PickupItem[] = []
  switch (chest.tier) {
    case 'normal': {
      const count = CHEST_ITEMS_MIN + world.lootRng.int(CHEST_ITEMS_MAX - CHEST_ITEMS_MIN + 1)
      for (let i = 0; i < count; i++) items.push(rollItem(world, CHEST_WEIGHTS))
      break
    }
    case 'weapon':
      refillSpecial(world)
      items.push(weaponItem(world, chest.weapon ?? undefined))
      break
    case 'rare': {
      refillSpecial(world)
      items.push(weaponItem(world, chest.weapon ?? undefined), makeItem(world, 'buff'))
      const amount = RARE_CHEST_XP * world.chapter
      world.rewards.chests += amount
      world.events.push({ type: 'bonusXp', x: chest.pos.x, y: chest.pos.y, amount: amount * world.xpScale })
      break
    }
  }
  const from = chest.perch ? { x: chest.perch.x, y: chest.perch.y } : chest.pos
  for (const item of items) spawnPickup(world, item, chest.pos.x, chest.pos.y, { persistent: true, from })
}

function refillSpecial(world: World): void {
  const { player } = world
  if (!player.special) return
  const magazine = specialMagazine(world, player.special)
  const amount = magazine - player.specialAmmo
  if (amount <= 0) return
  player.specialAmmo = magazine
  world.events.push({ type: 'pickedUp', item: { type: 'ammo' }, x: player.pos.x, y: player.pos.y, amount })
}

export function wanted(world: World, pickup: Pickup): boolean {
  const { player } = world
  const { item } = pickup
  if (item.type === 'heal') return player.hp < player.maxHp
  if (item.type === 'buff') return true
  if (item.type === 'ammo') return player.special !== null && player.specialAmmo < specialMagazine(world, player.special)
  return false
}

function attract(world: World, pickup: Pickup, dt: number): void {
  const { player } = world
  const dx = player.pos.x - pickup.pos.x
  const dy = player.pos.y - pickup.pos.y
  const distance = Math.hypot(dx, dy)
  const reach = pickup.item.type === 'heal' && pickup.item.food && hasMilestone(world, 'brawl2') ? MILESTONE.foodMagnet : PICKUP_MAGNET.radius
  if (distance > reach || distance < 1e-4 || !wanted(world, pickup)) return
  if (Math.abs(player.z - floorAt(world.grid, pickup.pos.x, pickup.pos.y)) > PICKUP_REACH_UP + 1) return
  const step = Math.min(distance, PICKUP_MAGNET.speed * dt)
  pickup.pos.x += (dx / distance) * step
  pickup.pos.y += (dy / distance) * step
}

function touching(world: World, pickup: Pickup): boolean {
  const { player } = world
  const reach = player.radius + PICKUP_RADIUS
  const dx = pickup.pos.x - player.pos.x
  const dy = pickup.pos.y - player.pos.y
  if (dx * dx + dy * dy > reach * reach) return false
  return Math.abs(player.z - floorAt(world.grid, pickup.pos.x, pickup.pos.y)) <= PICKUP_REACH_UP
}

function collect(world: World, pickup: Pickup): boolean {
  const { player } = world
  const { item } = pickup
  let amount = 0
  switch (item.type) {
    case 'heal':
      if (player.hp >= player.maxHp && !hasMilestone(world, 'brawl10')) return false
      if (player.hp >= player.maxHp && player.armor >= MILESTONE.overhealCap) return false
      amount = healPlayer(world, player.maxHp * item.amount)
      if (item.food) world.stats.foodHealed += amount
      else world.stats.packHealed += amount
      break
    case 'buff':
      giveBuff(world, item.buff)
      break
    case 'ammo': {
      if (!player.special) return false
      const magazine = specialMagazine(world, player.special)
      if (player.specialAmmo >= magazine) return false
      amount = Math.min(magazine - player.specialAmmo, Math.ceil(magazine * AMMO_REFILL))
      player.specialAmmo += amount
      break
    }
    case 'weapon':
      return false
  }
  world.events.push({ type: 'pickedUp', item, x: pickup.pos.x, y: pickup.pos.y, amount })
  return true
}

function interact(world: World): void {
  const target = interactTarget(world)
  if (!target) return
  if (target.kind === 'chest') openChest(world, target.chest)
  else if (target.kind === 'pen') openPen(world, target.landmark)
  else if (target.kind === 'lamp') lightLamp(world, target.lamp)
  else takeWeapon(world, target.pickup)
}

function takeWeapon(world: World, pickup: Pickup): void {
  const { item } = pickup
  if (item.type !== 'weapon') return
  const { player } = world
  world.pickups.splice(world.pickups.indexOf(pickup), 1)
  if (player.special) {
    const dropped = spawnPickup(
      world,
      { type: 'weapon', weapon: player.special, ammo: player.specialAmmo },
      pickup.pos.x,
      pickup.pos.y,
      { persistent: true, scatter: false },
    )
    dropped.age = PICKUP_DELAY
  }
  equipSpecial(world, item.weapon, item.ammo)
  world.events.push({ type: 'pickedUp', item, x: pickup.pos.x, y: pickup.pos.y, amount: item.ammo })
}

function useSupplies(world: World): void {
  const { player } = world
  if (player.hp >= player.maxHp) return
  for (const supply of world.supplies) {
    if (supply.used) continue
    if (Math.hypot(supply.pos.x - player.pos.x, supply.pos.y - player.pos.y) > SUPPLY_RADIUS + player.radius) continue
    supply.used = true
    const amount = healPlayer(world, player.maxHp * SUPPLY_HEAL)
    world.events.push({ type: 'supplyUsed', x: supply.pos.x, y: supply.pos.y, amount })
  }
}

function pickWeighted(rng: Rng, weights: Record<DropType, number>): DropType {
  const keys = Object.keys(weights) as DropType[]
  let total = 0
  for (const key of keys) total += Math.max(0, weights[key])
  let roll = rng.next() * total
  let fallback: DropType = 'heal'
  for (const key of keys) {
    const weight = Math.max(0, weights[key])
    if (weight <= 0) continue
    fallback = key
    if (roll < weight) return key
    roll -= weight
  }
  return fallback
}
