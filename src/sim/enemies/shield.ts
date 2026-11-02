import { weaponOf } from '../arsenal'
import type { Vec2 } from '../math'
import { chaseDirection } from '../steering'
import type { Enemy } from '../types'
import type { World } from '../world'
import { interruptMelee, meleeReach, setState, still, strike, type EnemyBehavior } from './kit'

export const shield: EnemyBehavior = {
  act,
  interrupt: (_world, enemy) => interruptMelee(enemy),
  blocks,
}

function act(world: World, enemy: Enemy, dt: number): Vec2 {
  const { player } = world
  const config = world.tuning.shield
  const bash = weaponOf(world, 'bash')
  const reach = meleeReach(world, enemy, 'bash')
  if (enemy.state === 'windup') {
    if (enemy.stateTime >= bash.windup) strike(world, enemy, reach, 'bash')
    return still()
  }
  if (enemy.state === 'recover') {
    if (enemy.stateTime >= bash.cooldown * enemy.cooldownScale) setState(enemy, 'chase')
    return still()
  }
  if (!player.alive) return still()
  const dx = player.pos.x - enemy.pos.x
  const dy = player.pos.y - enemy.pos.y
  let diff = Math.atan2(dy, dx) - enemy.facing
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  const turn = config.turnRate * dt
  enemy.facing += Math.max(-turn, Math.min(turn, diff))
  if (Math.hypot(dx, dy) <= reach && Math.abs(diff) <= (world.tuning.ai.shieldStrikeDeg * Math.PI) / 180) {
    setState(enemy, 'windup')
    world.events.push({ type: 'enemyWindup', id: enemy.id })
    return still()
  }
  const direction = chaseDirection(world, enemy)
  if (!direction) return still()
  return { x: direction.x * config.speed, y: direction.y * config.speed }
}

function blocks(world: World, enemy: Enemy, dirX: number, dirY: number): boolean {
  const half = (world.tuning.shield.guardArcDeg * Math.PI) / 360
  return -(dirX * Math.cos(enemy.facing) + dirY * Math.sin(enemy.facing)) >= Math.cos(half)
}
