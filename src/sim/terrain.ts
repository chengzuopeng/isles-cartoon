import { CHEST_HEIGHT, STEP_HEIGHT, bodyHeightOf, eyeHeightOf, muzzleHeightOf } from '../data/heights'
import { climberTest, resolveCircle, walkerTest } from './collision'
import { blocksMovement, cellFloor, tileAt } from './grid'
import type { Vec3 } from './math'
import type { Enemy, Player } from './types'
import type { World } from './world'

export const SUPPORT_SHARE = 0.5

export const PLAYER_HEIGHT = bodyHeightOf('player')

export function heightKey(enemy: Enemy): string {
  return enemy.boss?.id ?? enemy.kind
}

export function bodyHeight(enemy: Enemy): number {
  return bodyHeightOf(heightKey(enemy))
}

export function eyeOf(enemy: Enemy): Vec3 {
  return { x: enemy.pos.x, y: enemy.pos.y, z: enemy.z + eyeHeightOf(heightKey(enemy)) }
}

export function muzzleOf(enemy: Enemy): Vec3 {
  return { x: enemy.pos.x, y: enemy.pos.y, z: enemy.z + muzzleHeightOf(heightKey(enemy)) }
}

export function centerOf(enemy: Enemy): Vec3 {
  return { x: enemy.pos.x, y: enemy.pos.y, z: enemy.z + bodyHeight(enemy) / 2 }
}

export function playerEye(player: Player): Vec3 {
  return { x: player.pos.x, y: player.pos.y, z: player.z + eyeHeightOf('player') }
}

export function playerChest(player: Player): Vec3 {
  return { x: player.pos.x, y: player.pos.y, z: player.z + CHEST_HEIGHT }
}

export function playerReach(player: Player): number {
  return player.grounded ? player.z + STEP_HEIGHT : player.z
}

export function resolvePlayer(world: World): void {
  const { player } = world
  resolveCircle(player.pos, player.radius, climberTest(world.grid, playerReach(player)))
}

export function settleWalker(world: World, enemy: Enemy): void {
  const { grid } = world
  resolveCircle(enemy.pos, enemy.radius, walkerTest(grid, enemy.z))
  const column = Math.floor(enemy.pos.x)
  const row = Math.floor(enemy.pos.y)
  if (blocksMovement(tileAt(grid, column, row))) return
  const floor = cellFloor(grid, column, row)
  if (Math.abs(floor - enemy.z) <= STEP_HEIGHT + 1e-4) enemy.z = floor
}

export function heightsOverlap(world: World, enemy: Enemy, margin = 0): boolean {
  const { player } = world
  return player.z < enemy.z + bodyHeight(enemy) + margin && player.z + PLAYER_HEIGHT > enemy.z - margin
}
