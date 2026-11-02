import { fireEnemyWeapon, weaponOf } from '../arsenal'
import type { Vec2 } from '../math'
import { canSeePlayer } from '../perception'
import type { Enemy } from '../types'
import type { World } from '../world'
import { interruptAim, setState, still, type EnemyBehavior } from './kit'

export const turret: EnemyBehavior = {
  act,
  interrupt: (world, enemy) => interruptAim(world, enemy, 'cannon'),
  stationary: true,
}

function act(world: World, enemy: Enemy): Vec2 {
  const { player } = world
  const cannon = weaponOf(world, 'cannon')
  if (enemy.state === 'aim') {
    if (enemy.stateTime >= cannon.windup) {
      fireEnemyWeapon(world, enemy, 'cannon', enemy.aimAngle)
      setState(enemy, 'recover')
      enemy.cooldown = cannon.cooldown * enemy.cooldownScale
    }
    return still()
  }
  if (enemy.state === 'recover') {
    if (enemy.stateTime >= world.tuning.ai.rangedRecover) setState(enemy, 'chase')
    return still()
  }
  if (!canSeePlayer(world, enemy, world.tuning.turret.sight)) return still()
  enemy.facing = Math.atan2(player.pos.y - enemy.pos.y, player.pos.x - enemy.pos.x)
  if (enemy.cooldown === 0) {
    setState(enemy, 'aim')
    enemy.aimAngle = enemy.facing
  }
  return still()
}
