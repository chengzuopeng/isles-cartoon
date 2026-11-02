import { corridorClear } from './collision'
import type { Vec2 } from './math'
import { flowDirection } from './pathing'
import type { Enemy } from './types'
import type { World } from './world'

export function chaseDirection(world: World, enemy: Enemy): Vec2 | null {
  const { player, grid } = world
  if (corridorClear(grid, enemy.pos, player.pos, enemy.radius)) {
    const dx = player.pos.x - enemy.pos.x
    const dy = player.pos.y - enemy.pos.y
    const length = Math.hypot(dx, dy)
    return length < 1e-6 ? null : { x: dx / length, y: dy / length }
  }
  return flowDirection(world.flow, grid, enemy.pos)
}

export function pursue(world: World, enemy: Enemy, speed: number): Vec2 {
  const direction = chaseDirection(world, enemy)
  if (!direction) return { x: 0, y: 0 }
  enemy.facing = Math.atan2(direction.y, direction.x)
  return { x: direction.x * speed, y: direction.y * speed }
}
