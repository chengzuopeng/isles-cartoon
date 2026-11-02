import { CONVEYOR } from '../data/conveyors'
import type { Vec2 } from './math'
import { resolvePlayer } from './terrain'
import type { World } from './world'

export function beltAt(world: World, pos: Vec2): Vec2 | null {
  const { grid, level } = world
  const column = Math.floor(pos.x)
  const row = Math.floor(pos.y)
  if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) return null
  const push = world.conveyors.get(row * grid.columns + column)
  if (!push) return null
  return level.areas[level.areaOfRow[row]]?.kind === 'boss' ? null : push
}

export function updateConveyors(world: World, dt: number): void {
  const { player } = world
  if (world.conveyors.size === 0 || !player.alive || world.status !== 'playing' || player.rollTime > 0) return
  const push = beltAt(world, player.pos)
  if (!push) return
  player.pos.x += push.x * CONVEYOR.speed * dt
  player.pos.y += push.y * CONVEYOR.speed * dt
  resolvePlayer(world)
}
