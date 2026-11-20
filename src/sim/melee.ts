import { FOOD_HEAL, type FoodKind } from '../data/loot'
import { MILESTONE } from '../data/progression'
import { BADGE } from '../data/badges'
import { hasBadge } from './badges'
import { hasMilestone } from './stats'
import { onDamageDealt } from './buffs'
import { lineClear } from './collision'
import { angleBetween, damageEnemy, killEnemy } from './combat'
import { interruptEnemy } from './enemies'
import { reelEnemy } from './status'
import { spawnPickup } from './pickups'
import { meleeKegs } from './props'
import { bodyHeight, centerOf, playerChest } from './terrain'
import type { Enemy } from './types'
import { chargeUltimate } from './ultimate'
import type { World } from './world'

export function crumbling(world: World, enemy: Enemy): boolean {
  if (enemy.kind === 'boss' || enemy.role === 'bolt' || enemy.hp <= 0) return false
  return enemy.hp < enemy.maxHp * world.tuning.player.crumbleAt || enemy.status.dazed > 0 || enemy.status.frozen > 0
}

export function foodOf(enemy: Enemy): FoodKind {
  return enemy.id % 2 === 0 ? 'bread' : 'apple'
}

export function meleeReachOf(world: World): number {
  return leveraged(world) ? MILESTONE.leverageReach : world.tuning.player.meleeRange
}

function leveraged(world: World): boolean {
  return world.time <= world.player.leverageUntil && hasMilestone(world, 'move2')
}

export function meleeTargets(world: World, range = meleeReachOf(world)): Enemy[] {
  const { player, tuning, grid } = world
  const half = (tuning.player.meleeArcDeg * Math.PI) / 360
  const chest = playerChest(player)
  return world.enemies.filter((enemy) => {
    if (enemy.hp <= 0 || enemy.boss?.phase === 'dormant') return false
    const dx = enemy.pos.x - player.pos.x
    const dy = enemy.pos.y - player.pos.y
    const distance = Math.hypot(dx, dy)
    if (distance - enemy.radius > range) return false
    if (distance > 1e-6 && Math.abs(angleBetween(Math.atan2(dy, dx), player.facing)) > half) return false
    return lineClear(grid, chest, centerOf(enemy))
  })
}

export function swingMelee(world: World): void {
  const { player, tuning } = world
  const desperate = hasMilestone(world, 'brawl10') && player.hp < player.maxHp * MILESTONE.desperateBelow
  player.meleeCooldown = tuning.player.meleeCooldown * (desperate ? MILESTONE.desperateCooldown : 1)
  if (hasBadge(world, 'door')) player.guardUntil = world.time + BADGE.doorWindow
  const targets = meleeTargets(world)
  const damage = tuning.player.meleeDamage * world.playerStats.meleeDamage * (leveraged(world) ? MILESTONE.leverageDamage : 1)
  const push = tuning.player.meleeKnockback * tuning.feel.knockbackDecay
  for (const enemy of targets) {
    if (enemy.hp <= 0) continue
    if (unaware(enemy)) {
      sneak(world, enemy)
      continue
    }
    if (enemy.kind !== 'boss' && enemy.role !== 'bolt' && (crumbling(world, enemy) || enemy.hp <= damage)) {
      smash(world, enemy)
      continue
    }
    const dx = enemy.pos.x - player.pos.x
    const dy = enemy.pos.y - player.pos.y
    const length = Math.hypot(dx, dy) || 1
    if (enemy.kind !== 'boss') interruptEnemy(world, enemy)
    const before = enemy.hp
    damageEnemy(world, enemy, damage, dx / length, dy / length, enemy.kind === 'boss' ? 0 : push, {
      z: enemy.z + bodyHeight(enemy) / 2,
      crit: false,
    })
    const dealt = Math.max(0, before - Math.max(0, enemy.hp))
    onDamageDealt(world, dealt)
    chargeUltimate(world, dealt, enemy)
  }
  meleeKegs(world)
  world.stats.melees += 1
  world.stats.meleeHits += targets.length
  world.events.push({ type: 'melee', x: player.pos.x, y: player.pos.y, angle: player.facing, hits: targets.length })
}

export function unaware(enemy: Enemy): boolean {
  return enemy.kind !== 'boss' && enemy.role !== 'bolt' && enemy.hp > 0 && !enemy.aggro
}

export function sneakReady(world: World): boolean {
  return world.player.alive && world.player.meleeCooldown === 0 && meleeTargets(world).some(unaware)
}

function sneak(world: World, enemy: Enemy): void {
  const { player, tuning } = world
  world.stats.sneaks += 1
  world.events.push({ type: 'combo', kind: 'sneak', x: enemy.pos.x, y: enemy.pos.y, z: enemy.z })
  if (!enemy.elite && enemy.role !== 'courier') {
    world.killCause = 'sneak'
    smash(world, enemy)
    world.killCause = null
    return
  }
  const dx = enemy.pos.x - player.pos.x
  const dy = enemy.pos.y - player.pos.y
  const length = Math.hypot(dx, dy) || 1
  const before = enemy.hp
  damageEnemy(world, enemy, enemy.maxHp * tuning.player.sneakEliteShare, dx / length, dy / length, 0, { z: enemy.z + bodyHeight(enemy) / 2, crit: false })
  if (enemy.hp > 0) reelEnemy(world, enemy, tuning.feel.reelSeconds)
  const dealt = Math.max(0, before - Math.max(0, enemy.hp))
  onDamageDealt(world, dealt)
  chargeUltimate(world, dealt, enemy)
}

function aftershock(world: World, center: Enemy): void {
  const push = MILESTONE.aftershockPush * world.tuning.feel.knockbackDecay
  for (const enemy of world.enemies) {
    if (enemy === center || enemy.hp <= 0 || enemy.kind === 'boss' || enemy.kind === 'turret') continue
    const dx = enemy.pos.x - center.pos.x
    const dy = enemy.pos.y - center.pos.y
    const distance = Math.hypot(dx, dy)
    if (distance > MILESTONE.aftershockRadius + enemy.radius) continue
    const length = distance > 1e-6 ? distance : 1
    enemy.knock.x += (dx / length) * push
    enemy.knock.y += (dy / length) * push
    reelEnemy(world, enemy, MILESTONE.aftershockReel)
  }
}

export function smash(world: World, enemy: Enemy): void {
  const { x, y } = enemy.pos
  if (enemy.status.frozen > 0) world.events.push({ type: 'combo', kind: 'shatter', x, y, z: enemy.z })
  const left = Math.max(0, enemy.hp)
  const dx = x - world.player.pos.x
  const dy = y - world.player.pos.y
  const length = Math.hypot(dx, dy) || 1
  world.events.push({ type: 'smashed', id: enemy.id, kind: enemy.kind, x, y, z: enemy.z })
  const cause = world.killCause
  world.killCause = cause ?? 'smash'
  killEnemy(world, enemy, true, true, false, dx / length, dy / length)
  world.killCause = cause
  spawnPickup(world, { type: 'heal', amount: hasMilestone(world, 'brawl2') ? MILESTONE.foodHeal : FOOD_HEAL, food: foodOf(enemy) }, x, y, { from: { x, y } })
  if (hasMilestone(world, 'brawl5')) aftershock(world, enemy)
  if (hasBadge(world, 'iou') && world.lootRng.next() < BADGE.iouChance) spawnPickup(world, { type: 'heal', amount: hasMilestone(world, 'brawl2') ? MILESTONE.foodHeal : FOOD_HEAL, food: foodOf(enemy) }, x, y, { from: { x, y } })
  world.stats.smashes += 1
  onDamageDealt(world, left)
  chargeUltimate(world, left, enemy)
}
