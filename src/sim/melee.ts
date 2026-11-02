import { FOOD_HEAL, type FoodKind } from '../data/loot'
import { onDamageDealt } from './buffs'
import { lineClear } from './collision'
import { angleBetween, damageEnemy, killEnemy } from './combat'
import { interruptEnemy } from './enemies'
import { spawnPickup } from './pickups'
import { bodyHeight, centerOf, playerChest } from './terrain'
import type { Enemy } from './types'
import { chargeUltimate } from './ultimate'
import type { World } from './world'

export function crumbling(world: World, enemy: Enemy): boolean {
  if (enemy.kind === 'boss' || enemy.hp <= 0) return false
  return enemy.hp < enemy.maxHp * world.tuning.player.crumbleAt || enemy.status.dazed > 0
}

export function foodOf(enemy: Enemy): FoodKind {
  return enemy.id % 2 === 0 ? 'bread' : 'apple'
}

export function meleeTargets(world: World): Enemy[] {
  const { player, tuning, grid } = world
  const half = (tuning.player.meleeArcDeg * Math.PI) / 360
  const chest = playerChest(player)
  return world.enemies.filter((enemy) => {
    if (enemy.hp <= 0 || enemy.boss?.phase === 'dormant') return false
    const dx = enemy.pos.x - player.pos.x
    const dy = enemy.pos.y - player.pos.y
    const distance = Math.hypot(dx, dy)
    if (distance - enemy.radius > tuning.player.meleeRange) return false
    if (distance > 1e-6 && Math.abs(angleBetween(Math.atan2(dy, dx), player.facing)) > half) return false
    return lineClear(grid, chest, centerOf(enemy))
  })
}

export function swingMelee(world: World): void {
  const { player, tuning } = world
  player.meleeCooldown = tuning.player.meleeCooldown
  const targets = meleeTargets(world)
  const damage = tuning.player.meleeDamage * world.playerStats.damage
  const push = tuning.player.meleeKnockback * tuning.feel.knockbackDecay
  for (const enemy of targets) {
    if (enemy.hp <= 0) continue
    if (enemy.kind !== 'boss' && (crumbling(world, enemy) || enemy.hp <= damage)) {
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
    chargeUltimate(world, dealt)
  }
  world.stats.melees += 1
  world.stats.meleeHits += targets.length
  world.events.push({ type: 'melee', x: player.pos.x, y: player.pos.y, angle: player.facing, hits: targets.length })
}

export function smash(world: World, enemy: Enemy): void {
  const { x, y } = enemy.pos
  const left = Math.max(0, enemy.hp)
  world.events.push({ type: 'smashed', id: enemy.id, kind: enemy.kind, x, y, z: enemy.z })
  killEnemy(world, enemy, true, true, false)
  spawnPickup(world, { type: 'heal', amount: FOOD_HEAL, food: foodOf(enemy) }, x, y, { from: { x, y } })
  world.stats.smashes += 1
  onDamageDealt(world, left)
  chargeUltimate(world, left)
}
