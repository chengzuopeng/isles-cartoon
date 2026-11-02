import { muzzleHeightOf } from '../../data/heights'
import { runnerAlarm } from '../alarms'
import { corridorClear, lineClear } from '../collision'
import { blocksBullets, blocksMovement, cellFloor, tileAt, type Grid } from '../grid'
import type { Vec2, Vec3 } from '../math'
import { pursue } from '../steering'
import { bodyHeight, heightKey, playerChest, playerEye } from '../terrain'
import type { Enemy } from '../types'
import type { World } from '../world'
import { keepDistance } from './kit'

const SPEED_CAP = 1.6
const FLANK_NEAR = 2.4
const FLANK_RING = 2.2
const WEAVE_NEAR = 3.2
const WEAVE_RATE = 3.4
const ORBIT_PACE = 0.75
const SLOT_STICKY = 1.2
const ARRIVED = 0.3
const TRACK_CAP = 0.9
const NEIGHBORS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

export function playerVelocity(world: World, dt: number): Vec2 {
  const { player, tuning } = world
  if (dt <= 0) return { x: 0, y: 0 }
  const x = (player.pos.x - player.prev.x) / dt
  const y = (player.pos.y - player.prev.y) / dt
  const speed = Math.hypot(x, y)
  const cap = tuning.player.speed * SPEED_CAP
  if (speed <= cap) return { x, y }
  return { x: (x / speed) * cap, y: (y / speed) * cap }
}

export function predict(world: World, seconds: number, dt: number): Vec2 {
  const { player } = world
  const velocity = playerVelocity(world, dt)
  return { x: player.pos.x + velocity.x * seconds, y: player.pos.y + velocity.y * seconds }
}

export function approach(world: World, enemy: Enemy, speed: number, lead: number, dt: number): Vec2 {
  const { player, grid } = world
  const distance = Math.hypot(player.pos.x - enemy.pos.x, player.pos.y - enemy.pos.y)
  const ahead = predict(world, Math.min(distance / Math.max(speed, 0.1), 1) * lead, dt)
  let target = ahead
  if (enemy.flank !== 0 && distance > FLANK_NEAR) {
    const around = Math.atan2(enemy.pos.y - ahead.y, enemy.pos.x - ahead.x) + enemy.flank
    const ring = Math.min(distance - 0.8, FLANK_RING)
    target = { x: ahead.x + Math.cos(around) * ring, y: ahead.y + Math.sin(around) * ring }
  }
  const dx = target.x - enemy.pos.x
  const dy = target.y - enemy.pos.y
  const length = Math.hypot(dx, dy)
  if (length < 1e-6 || !corridorClear(grid, enemy.pos, target, enemy.radius)) return pursue(world, enemy, speed)
  enemy.facing = Math.atan2(dy, dx)
  return weave(world, enemy, dx / length, dy / length, speed, distance)
}

function weave(world: World, enemy: Enemy, dirX: number, dirY: number, speed: number, distance: number): Vec2 {
  const amount = distance > WEAVE_NEAR ? world.tuning.grunt.weave * Math.sin(world.time * WEAVE_RATE + enemy.id * 1.7) : 0
  const forward = Math.sqrt(Math.max(0, 1 - amount * amount))
  const x = dirX * forward - dirY * amount
  const y = dirY * forward + dirX * amount
  if (!corridorClear(world.grid, enemy.pos, { x: enemy.pos.x + x, y: enemy.pos.y + y }, enemy.radius)) return { x: dirX * speed, y: dirY * speed }
  return { x: x * speed, y: y * speed }
}

export function orbit(world: World, enemy: Enemy, speed: number): Vec2 {
  const { player, tuning } = world
  const dx = player.pos.x - enemy.pos.x
  const dy = player.pos.y - enemy.pos.y
  const distance = Math.hypot(dx, dy)
  if (distance < 1e-6) return { x: 0, y: 0 }
  enemy.facing = Math.atan2(dy, dx)
  const ring = tuning.ai.orbitRadius
  return keepDistance(world, enemy, dx, dy, distance, ring - 0.6, ring + 0.8, speed * ORBIT_PACE)
}

export function assignSlots(world: World): void {
  const { player, tuning } = world
  const candidates: { enemy: Enemy; score: number }[] = []
  for (const enemy of world.enemies) {
    if (enemy.kind !== 'grunt') continue
    if (enemy.hp <= 0 || !enemy.aggro || runnerAlarm(world, enemy) >= 0) {
      enemy.engaged = false
      continue
    }
    const busy = enemy.state === 'windup' || enemy.state === 'charge' || enemy.state === 'dash'
    const distance = Math.hypot(player.pos.x - enemy.pos.x, player.pos.y - enemy.pos.y)
    candidates.push({ enemy, score: busy ? -Infinity : distance - (enemy.engaged ? SLOT_STICKY : 0) })
  }
  candidates.sort((a, b) => a.score - b.score)
  const slots = Math.max(1, tuning.ai.meleeSlots + world.difficulty.slots)
  candidates.forEach((item, index) => {
    item.enemy.engaged = index < slots
  })
}

export function trackShare(world: World): number {
  return Math.min(TRACK_CAP, world.tuning.gunner.track * world.difficulty.track)
}

export function findCover(world: World, enemy: Enemy, radius: number, keepMin: number): Vec2 | null {
  const { grid, player } = world
  const eye = playerEye(player)
  const chest = playerChest(player)
  const middle = bodyHeight(enemy) / 2
  const muzzle = muzzleHeightOf(heightKey(enemy))
  const reach = Math.ceil(radius)
  const baseColumn = Math.floor(enemy.pos.x)
  const baseRow = Math.floor(enemy.pos.y)
  let best: Vec2 | null = null
  let bestScore = Infinity
  for (let row = baseRow - reach; row <= baseRow + reach; row++) {
    for (let column = baseColumn - reach; column <= baseColumn + reach; column++) {
      if (blocksMovement(tileAt(grid, column, row))) continue
      const spot = { x: column + 0.5, y: row + 0.5 }
      const travel = Math.hypot(spot.x - enemy.pos.x, spot.y - enemy.pos.y)
      if (travel > radius) continue
      const gap = Math.hypot(player.pos.x - spot.x, player.pos.y - spot.y)
      if (gap < keepMin) continue
      if (lineClear(grid, eye, { ...spot, z: cellFloor(grid, column, row) + middle }, blocksBullets)) continue
      if (!peekable(grid, chest, column, row, muzzle)) continue
      if (!corridorClear(grid, enemy.pos, spot, enemy.radius)) continue
      const score = travel + gap * 0.15
      if (score < bestScore) {
        best = spot
        bestScore = score
      }
    }
  }
  return best
}

export function holdCover(world: World, enemy: Enemy, speed: number): Vec2 | null {
  const cover = enemy.cover
  if (!cover) return null
  const { player, grid } = world
  const middle = bodyHeight(enemy) / 2
  if (lineClear(grid, playerEye(player), { ...cover, z: cellFloor(grid, Math.floor(cover.x), Math.floor(cover.y)) + middle }, blocksBullets)) {
    enemy.cover = null
    return null
  }
  enemy.facing = Math.atan2(player.pos.y - enemy.pos.y, player.pos.x - enemy.pos.x)
  const dx = cover.x - enemy.pos.x
  const dy = cover.y - enemy.pos.y
  const distance = Math.hypot(dx, dy)
  if (distance <= ARRIVED) return { x: 0, y: 0 }
  return { x: (dx / distance) * speed, y: (dy / distance) * speed }
}

function peekable(grid: Grid, target: Vec3, column: number, row: number, muzzle: number): boolean {
  for (const [dc, dr] of NEIGHBORS) {
    if (blocksMovement(tileAt(grid, column + dc, row + dr))) continue
    const from = { x: column + dc + 0.5, y: row + dr + 0.5, z: cellFloor(grid, column + dc, row + dr) + muzzle }
    if (lineClear(grid, from, target, blocksBullets)) return true
  }
  return false
}
