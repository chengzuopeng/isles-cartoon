import { CHEST_HEIGHT } from '../../data/heights'
import { fireEnemyWeapon, weaponOf } from '../arsenal'
import { lineClear } from '../collision'
import { blocksBullets } from '../grid'
import type { Vec2 } from '../math'
import { pursue } from '../steering'
import { muzzleOf, playerChest } from '../terrain'
import type { Enemy } from '../types'
import type { World } from '../world'
import { interruptAim, keepDistance, setState, still, type EnemyBehavior } from './kit'
import { findCover, holdCover, predict, trackShare } from './tactics'

export const gunner: EnemyBehavior = {
  act,
  interrupt: (world, enemy) => interruptAim(world, enemy, 'rifle'),
}

function act(world: World, enemy: Enemy, dt: number): Vec2 {
  const { player, grid } = world
  const config = world.tuning.gunner
  const rifle = weaponOf(world, 'rifle')
  if (enemy.state === 'aim') {
    if (enemy.stateTime <= rifle.windup * trackShare(world)) aim(world, enemy, dt)
    if (enemy.stateTime >= rifle.windup) {
      fireEnemyWeapon(world, enemy, 'rifle', enemy.aimAngle, 0, enemy.aimPitch)
      enemy.aimPitch = null
      setState(enemy, 'recover')
      enemy.cooldown = rifle.cooldown * enemy.cooldownScale
      enemy.cover = findCover(world, enemy, config.coverRadius, config.keepMin)
    }
    return still()
  }
  if (enemy.state === 'recover') {
    if (enemy.stateTime >= world.tuning.ai.rangedRecover) setState(enemy, 'chase')
    return still()
  }
  if (!player.alive) return still()
  const dx = player.pos.x - enemy.pos.x
  const dy = player.pos.y - enemy.pos.y
  const distance = Math.hypot(dx, dy)
  if (enemy.cooldown > 0 && distance >= config.keepMin) {
    const hide = holdCover(world, enemy, config.speed)
    if (hide) return hide
  }
  const clear = distance <= config.fireRange && lineClear(grid, muzzleOf(enemy), playerChest(player), blocksBullets)
  if (!clear) return pursue(world, enemy, config.speed)
  enemy.facing = Math.atan2(dy, dx)
  if (enemy.cooldown === 0 && world.time >= world.volleyAt) {
    setState(enemy, 'aim')
    enemy.cover = null
    world.volleyAt = world.time + world.tuning.ai.volleyGap * world.difficulty.volleyGap
    aim(world, enemy, dt)
    return still()
  }
  return keepDistance(world, enemy, dx, dy, distance, config.keepMin, config.keepMax, config.speed)
}

function aim(world: World, enemy: Enemy, dt: number): void {
  const { player } = world
  const config = world.tuning.gunner
  const rifle = weaponOf(world, 'rifle')
  const distance = Math.hypot(player.pos.x - enemy.pos.x, player.pos.y - enemy.pos.y)
  const remaining = Math.max(0, rifle.windup - enemy.stateTime)
  const target = predict(world, (remaining + distance / rifle.speed) * config.lead * world.difficulty.lead, dt)
  enemy.aimAngle = Math.atan2(target.y - enemy.pos.y, target.x - enemy.pos.x)
  enemy.facing = enemy.aimAngle
  const muzzle = muzzleOf(enemy)
  enemy.aimPitch = Math.atan2(player.z + CHEST_HEIGHT - muzzle.z, Math.max(0.1, Math.hypot(target.x - muzzle.x, target.y - muzzle.y)))
}
