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
  INTERACT_RANGE,
  PICKUP_BODY,
  PICKUP_DELAY,
  PICKUP_LIFETIME,
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
import { giveBuff } from './buffs'
import { resolveCircleGrid, segmentClear } from './collision'
import { lightLamp } from './fog'
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
    if (active && pickup.age >= PICKUP_DELAY && touching(world, pickup) && collect(world, pickup)) continue
    world.pickups[kept++] = pickup
  }
  world.pickups.length = kept
  if (!active) return
  useSupplies(world)
  if (command.interact) interact(world)
}

export function interactTarget(world: World): InteractTarget | null {
  const { player } = world
  let best: InteractTarget | null = null
  let bestDistance = Infinity
  for (const pickup of world.pickups) {
    if (pickup.item.type !== 'weapon' || pickup.age < PICKUP_DELAY) continue
    const distance = Math.hypot(pickup.pos.x - player.pos.x, pickup.pos.y - player.pos.y)
    if (distance <= INTERACT_RANGE && distance < bestDistance) {
      best = { kind: 'weapon', pickup }
      bestDistance = distance
    }
  }
  for (const chest of world.chests) {
    if (chest.opened) continue
    const distance = Math.hypot(chest.pos.x - player.pos.x, chest.pos.y - player.pos.y)
    if (distance <= INTERACT_RANGE + CHEST_REACH && distance < bestDistance) {
      best = { kind: 'chest', chest }
      bestDistance = distance
    }
  }
  world.level.landmarks.forEach((placement, index) => {
    const gate = placement.gate
    if (!gate || world.landmarks[index].open) return
    const pos = penDoorway(gate)
    const distance = Math.hypot(pos.x - player.pos.x, pos.y - player.pos.y)
    if (distance <= INTERACT_RANGE && distance < bestDistance) {
      best = { kind: 'pen', landmark: index, pos }
      bestDistance = distance
    }
  })
  world.level.lamps.forEach((lamp, index) => {
    if (world.lamps[index]) return
    const distance = Math.hypot(lamp.x - player.pos.x, lamp.y - player.pos.y)
    if (distance <= FOG.lampReach && distance < bestDistance) {
      best = { kind: 'lamp', lamp: index, pos: { x: lamp.x, y: lamp.y } }
      bestDistance = distance
    }
  })
  return best
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
      items.push(weaponItem(world, chest.weapon ?? undefined))
      break
    case 'rare': {
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
      if (player.hp >= player.maxHp) return false
      amount = Math.min(player.maxHp - player.hp, player.maxHp * item.amount)
      player.hp += amount
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
  if (player.special && player.specialAmmo > 0) {
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
    const amount = Math.min(player.maxHp - player.hp, player.maxHp * SUPPLY_HEAL)
    player.hp += amount
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
