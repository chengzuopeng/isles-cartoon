import { eyeHeightOf } from '../data/heights'
import { SPECIAL_WEAPONS, type WeaponId } from '../data/weapons'
import { firePattern, weaponOf } from './arsenal'
import { playerDisabled } from './status'
import { BADGE } from '../data/badges'
import { hasBadge } from './badges'
import { healPlayer } from './buffs'
import { hasMilestone } from './stats'
import { MILESTONE } from '../data/progression'
import type { Enemy, PlayerCommand } from './types'
import type { World } from './world'

export const ULTIMATE_WEAPON = 'starVolley'

export function ultShareOf(world: World, weapon: WeaponId | null): number {
  if (weapon === null) return 0
  if (weapon === world.player.primary) return 1
  return SPECIAL_WEAPONS.some((id) => id === weapon) ? world.tuning.player.specialUltShare : 0
}

export function streakBoost(world: World): number {
  const { player, time } = world
  const rule = world.tuning.player.streak
  if (player.streak < 2 || time - player.streakAt > world.playerStats.streakWindow) return 1
  return 1 + rule.ultBonus * Math.min(player.streak - 1, rule.maxSteps)
}

export function chargeUltimate(world: World, damage: number, target: Enemy | null = null): void {
  const { player, tuning } = world
  if (player.ultimate >= 1 || player.ultShots > 0 || damage <= 0) return
  const boost = target && target.kind !== 'boss' ? streakBoost(world) : 1
  player.ultimate = Math.min(1, player.ultimate + (damage * boost * world.playerStats.ultCharge) / Math.max(1, tuning.player.ultimateCharge))
  if (player.ultimate >= 1) world.events.push({ type: 'ultimateReady' })
}

export function updateUltimate(world: World, command: PlayerCommand, dt: number): void {
  const { player } = world
  if (!player.alive || world.status !== 'playing') return
  const weapon = weaponOf(world, ULTIMATE_WEAPON)
  if (command.ultimate && player.ultimate >= 1 && player.ultShots === 0 && !playerDisabled(player)) {
    player.ultimate = 0
    player.ultShots = Math.max(1, Math.round(weapon.burstCount)) + (hasMilestone(world, 'energy10') ? MILESTONE.overloadShots : 0)
    player.ultTimer = 0
    player.burstLeft = 0
    world.stats.ultimates += 1
    if (hasBadge(world, 'star')) healPlayer(world, player.maxHp * BADGE.starHeal)
    world.events.push({ type: 'ultimateFired', x: player.pos.x, y: player.pos.y })
  }
  if (player.ultShots <= 0) return
  player.ultTimer -= dt
  while (player.ultShots > 0 && player.ultTimer <= 0) {
    const offset = player.radius + 0.1
    const eye = player.z + eyeHeightOf('player')
    firePattern(world, 'player', player.pos.x, player.pos.y, offset, player.facing, ULTIMATE_WEAPON, {
      damageScale: world.playerStats.damage,
      z: eye,
      pitch: player.pitch,
    })
    const flat = Math.cos(player.pitch) * offset
    world.events.push({
      type: 'shot',
      x: player.pos.x + Math.cos(player.facing) * flat,
      y: player.pos.y + Math.sin(player.facing) * flat,
      z: eye + Math.sin(player.pitch) * offset,
      angle: player.facing,
      pitch: player.pitch,
      weapon: ULTIMATE_WEAPON,
    })
    player.ultShots -= 1
    player.ultTimer += weapon.burstInterval
    if (player.ultShots === 0 && hasMilestone(world, 'energy10')) for (const skill of player.skills) skill.cooldown = 0
  }
}
