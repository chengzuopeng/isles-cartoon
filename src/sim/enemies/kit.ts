import { STRIKE_REACH } from '../../data/heights'
import type { WeaponId } from '../../data/weapons'
import { weaponOf } from '../arsenal'
import { attackOf } from '../attacks'
import { damagePlayer } from '../combat'
import type { Vec2 } from '../math'
import { pursue } from '../steering'
import { heightsOverlap } from '../terrain'
import type { Enemy, EnemyState } from '../types'
import type { World } from '../world'

export interface EnemyBehavior {
  act(world: World, enemy: Enemy, dt: number): Vec2
  interrupt?(world: World, enemy: Enemy): void
  blocks?(world: World, enemy: Enemy, dirX: number, dirY: number): boolean
  holdsOn?(enemy: Enemy): boolean
  stationary?: boolean
}

export function still(): Vec2 {
  return { x: 0, y: 0 }
}

export function setState(enemy: Enemy, state: EnemyState): void {
  enemy.state = state
  enemy.stateTime = 0
}

export function meleeReach(world: World, enemy: Enemy, weapon: WeaponId = 'claw'): number {
  return enemy.radius + world.player.radius + weaponOf(world, weapon).radius
}

export function strike(world: World, enemy: Enemy, reach: number, id: WeaponId): void {
  const { player } = world
  const weapon = weaponOf(world, id)
  const facingX = Math.cos(enemy.facing)
  const facingY = Math.sin(enemy.facing)
  enemy.knock.x += facingX * weapon.lunge
  enemy.knock.y += facingY * weapon.lunge
  setState(enemy, 'recover')
  if (!player.alive || !heightsOverlap(world, enemy, STRIKE_REACH)) return
  const dx = player.pos.x - enemy.pos.x
  const dy = player.pos.y - enemy.pos.y
  const distance = Math.hypot(dx, dy)
  if (distance > reach) return
  const halfArc = (weapon.arcDeg * Math.PI) / 360
  if (distance > 1e-6 && (dx * facingX + dy * facingY) / distance < Math.cos(halfArc)) return
  damagePlayer(world, weapon.damage, facingX, facingY, weapon.knockback, attackOf(enemy, id), enemy.pos)
}

export function keepDistance(
  world: World,
  enemy: Enemy,
  dx: number,
  dy: number,
  distance: number,
  keepMin: number,
  keepMax: number,
  speed: number,
): Vec2 {
  if (distance < keepMin) return { x: (-dx / distance) * speed, y: (-dy / distance) * speed }
  if (distance <= keepMax) {
    const { ai } = world.tuning
    const side = Math.sin(world.time * ai.strafeRate + enemy.id) >= 0 ? 1 : -1
    const strafe = speed * ai.strafeShare * side
    return { x: (-dy / distance) * strafe, y: (dx / distance) * strafe }
  }
  return pursue(world, enemy, speed)
}

export function interruptMelee(enemy: Enemy): void {
  if (enemy.state === 'windup') setState(enemy, 'recover')
}

export function interruptAim(world: World, enemy: Enemy, weapon: WeaponId): void {
  if (enemy.state !== 'aim') return
  enemy.aimPitch = null
  setState(enemy, 'recover')
  enemy.cooldown = Math.max(enemy.cooldown, weaponOf(world, weapon).cooldown * world.tuning.ai.interruptCooldown)
}
