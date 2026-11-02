import { weaponOf } from '../arsenal'
import { attackOf } from '../attacks'
import { lobPitch, spawnLob } from '../lobs'
import type { Vec2 } from '../math'
import { muzzleOf } from '../terrain'
import type { Enemy } from '../types'
import type { World } from '../world'
import { interruptAim, keepDistance, setState, still, type EnemyBehavior } from './kit'

export const thrower: EnemyBehavior = {
  act,
  interrupt: (world, enemy) => interruptAim(world, enemy, 'bomb'),
}

function act(world: World, enemy: Enemy): Vec2 {
  const { player } = world
  const config = world.tuning.thrower
  const bomb = weaponOf(world, 'bomb')
  const target = enemy.sinceSeen === 0 ? player.pos : enemy.lastSeen
  if (enemy.state === 'aim') {
    if (enemy.stateTime >= bomb.windup) {
      const hand = muzzleOf(enemy)
      const lob = spawnLob(world, 'enemy', enemy.pos, target, 'bomb', 1, attackOf(enemy, 'bomb'), undefined, hand.z)
      world.events.push({
        type: 'enemyShot',
        x: enemy.pos.x,
        y: enemy.pos.y,
        z: hand.z,
        angle: Math.atan2(target.y - enemy.pos.y, target.x - enemy.pos.x),
        pitch: lobPitch(lob),
        weapon: 'bomb',
      })
      setState(enemy, 'recover')
      enemy.cooldown = bomb.cooldown * enemy.cooldownScale
    }
    return still()
  }
  if (enemy.state === 'recover') {
    if (enemy.stateTime >= world.tuning.ai.rangedRecover) setState(enemy, 'chase')
    return still()
  }
  if (!player.alive) return still()
  const dx = target.x - enemy.pos.x
  const dy = target.y - enemy.pos.y
  const distance = Math.hypot(dx, dy)
  if (distance < 1e-6) return still()
  enemy.facing = Math.atan2(dy, dx)
  if (enemy.cooldown === 0 && distance <= bomb.range) {
    setState(enemy, 'aim')
    enemy.aimAngle = enemy.facing
    return still()
  }
  return keepDistance(world, enemy, dx, dy, distance, config.keepMin, config.keepMax, config.speed)
}
