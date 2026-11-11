import { MILESTONE } from '../data/progression'
import { hasMilestone } from './stats'
import { BUFFS, type BuffId } from '../data/loot'
import type { Player } from './types'
import type { World } from './world'

export function hasBuff(player: Player, id: BuffId): boolean {
  for (const buff of player.buffs) if (buff.id === id) return true
  return false
}

export function giveBuff(world: World, id: BuffId): void {
  const { player } = world
  const def = BUFFS[id]
  const current = player.buffs.find((buff) => buff.id === id)
  if (current) current.remaining = def.duration
  else player.buffs.push({ id, remaining: def.duration, duration: def.duration })
  if (id === 'shield') player.shield = def.value
}

export function updateBuffs(world: World, dt: number): void {
  const { player } = world
  if (player.buffs.length === 0) return
  let kept = 0
  for (const buff of player.buffs) {
    buff.remaining -= dt
    if (buff.id === 'shield' && player.shield <= 0) buff.remaining = 0
    if (buff.remaining > 0) {
      player.buffs[kept++] = buff
      continue
    }
    if (buff.id === 'shield') player.shield = 0
    world.events.push({ type: 'buffEnded', buff: buff.id })
  }
  player.buffs.length = kept
}

export function absorbDamage(world: World, amount: number): number {
  const { player } = world
  if (player.shield <= 0 || amount <= 0) return 0
  const absorbed = Math.min(player.shield, amount)
  player.shield -= absorbed
  if (player.shield <= 0) {
    player.shield = 0
    world.events.push({ type: 'shieldBroken', x: player.pos.x, y: player.pos.y })
  }
  return absorbed
}

export function onDamageDealt(world: World, amount: number): void {
  const { player } = world
  if (!player.alive || amount <= 0 || !hasBuff(player, 'leech')) return
  healPlayer(world, amount * BUFFS.leech.value)
}

export function healPlayer(world: World, amount: number): number {
  const { player } = world
  if (!player.alive || amount <= 0) return 0
  const healed = Math.min(player.maxHp - player.hp, amount)
  player.hp += healed
  const spill = amount - healed
  if (spill > 0 && hasMilestone(world, 'brawl10')) player.armor = Math.min(MILESTONE.overhealCap, player.armor + spill)
  return healed
}

export function consumesAmmo(player: Player): boolean {
  return !hasBuff(player, 'infinite')
}
