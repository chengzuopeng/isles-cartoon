import { FOG } from '../data/fog'
import { claimRunner } from './alarms'
import { lineClear } from './collision'
import { fogBetween } from './fog'
import { Tile, blocksSight, cellFloor, tileAt, tileHeight } from './grid'
import type { Vec2 } from './math'
import { centerOf, eyeOf, playerChest } from './terrain'
import type { Enemy } from './types'
import type { World } from './world'

export function sightOf(world: World, enemy: Enemy): number {
  if (enemy.kind === 'boss') return 0
  return world.tuning[enemy.kind].sight
}

export function playerHidden(world: World): boolean {
  const { player, grid } = world
  const column = Math.floor(player.pos.x)
  const row = Math.floor(player.pos.y)
  return tileAt(grid, column, row) === Tile.Bush && player.z < cellFloor(grid, column, row) + tileHeight(Tile.Bush)
}

export function canSeePlayer(world: World, enemy: Enemy, sight: number): boolean {
  const { player, grid } = world
  if (!player.alive) return false
  const dx = player.pos.x - enemy.pos.x
  const dy = player.pos.y - enemy.pos.y
  const distance = Math.hypot(dx, dy)
  let range = playerHidden(world) ? Math.min(sight, world.tuning.perception.bushSight) : sight
  if (!enemy.aggro && distance > FOG.sight && fogBetween(world, enemy.pos, player.pos)) range = Math.min(range, FOG.sight)
  if (distance > range) return false
  if (!enemy.aggro && distance > world.tuning.perception.proximity && !inView(world, enemy, Math.atan2(dy, dx))) return false
  return lineClear(grid, eyeOf(enemy), playerChest(player), blocksSight)
}

export function inView(world: World, enemy: Enemy, angle: number): boolean {
  const half = (world.tuning.perception.fovDeg * Math.PI) / 360
  let diff = angle - enemy.facing
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  return Math.abs(diff) <= half
}

export function aggro(world: World, enemy: Enemy, hops = world.tuning.ai.alertHops): void {
  if (enemy.aggro || enemy.kind === 'boss' || enemy.hp <= 0) return
  enemy.aggro = true
  enemy.alert = 'combat'
  enemy.leashed = false
  enemy.sinceSeen = 0
  enemy.lastSeen.x = world.player.pos.x
  enemy.lastSeen.y = world.player.pos.y
  if (enemy.state === 'idle') {
    enemy.state = 'chase'
    enemy.stateTime = 0
  }
  world.events.push({ type: 'enemyAlerted', id: enemy.id, x: enemy.pos.x, y: enemy.pos.y })
  claimRunner(world, enemy)
  if (hops <= 0) return
  const radius = world.tuning.perception.alertRadius
  for (const other of world.enemies) {
    if (other === enemy || other.aggro || other.idleMode === 'ambush') continue
    if (Math.hypot(other.pos.x - enemy.pos.x, other.pos.y - enemy.pos.y) <= radius) aggro(world, other, hops - 1)
  }
}

export function alarm(world: World, enemy: Enemy, at: Vec2): void {
  if (enemy.aggro || enemy.kind === 'boss' || enemy.hp <= 0 || enemy.idleMode === 'ambush') return
  enemy.lastSeen.x = at.x
  enemy.lastSeen.y = at.y
  if (enemy.alert === 'suspicious') return
  enemy.alert = 'suspicious'
  enemy.alertTime = 0
  enemy.lookTime = 0
  enemy.leashed = false
  world.events.push({ type: 'enemySuspicious', id: enemy.id, x: enemy.pos.x, y: enemy.pos.y })
}

export function emitNoise(world: World, at: Vec2, radius: number): void {
  if (radius <= 0) return
  const radiusSq = radius * radius
  for (const enemy of world.enemies) {
    if (enemy.aggro || enemy.hp <= 0 || enemy.kind === 'boss') continue
    const dx = enemy.pos.x - at.x
    const dy = enemy.pos.y - at.y
    if (dx * dx + dy * dy <= radiusSq) alarm(world, enemy, at)
  }
}

export function witnessDeath(world: World, dead: Enemy): void {
  for (const enemy of world.enemies) {
    if (enemy === dead || enemy.aggro || enemy.hp <= 0 || enemy.kind === 'boss') continue
    const distance = Math.hypot(enemy.pos.x - dead.pos.x, enemy.pos.y - dead.pos.y)
    if (distance > sightOf(world, enemy)) continue
    if (distance > FOG.sight && fogBetween(world, enemy.pos, dead.pos)) continue
    if (!lineClear(world.grid, eyeOf(enemy), centerOf(dead), blocksSight)) continue
    alarm(world, enemy, dead.pos)
  }
}
