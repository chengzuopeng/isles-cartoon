import { AFFIX_ORDER, type AffixId } from '../data/elites'
import type { MinionKind } from '../data/enemies'
import { raiseAlarm } from './alarms'
import { damageEnemy, killEnemy } from './combat'
import { lightLamp } from './fog'
import { Tile, blocksMovement, floorAt, tileAt } from './grid'
import { breakLandmark, isTarget } from './landmark-state'
import type { Vec2 } from './math'
import { aggro } from './perception'
import { spawnPickup } from './pickups'
import { openPen } from './sheep'
import type { Enemy, PickupItem } from './types'
import { createEnemy, type World } from './world'

const SPAWN_RING = 5

export function findSpot(world: World, fromRow: number, toRow: number): Vec2 | null {
  const { grid } = world
  const step = toRow >= fromRow ? 1 : -1
  const center = Math.floor(grid.columns / 2)
  for (let row = fromRow; step > 0 ? row <= toRow : row >= toRow; row += step) {
    for (let offset = 0; offset < grid.columns; offset++) {
      const column = center + (offset % 2 === 0 ? offset / 2 : -(offset + 1) / 2)
      const tile = tileAt(grid, column, row)
      if (!blocksMovement(tile) && tile !== Tile.Gate) return { x: column + 0.5, y: row + 0.5 }
    }
  }
  return null
}

export function placePlayer(world: World, spot: Vec2 | null): Vec2 | null {
  if (!spot) return null
  const { player } = world
  player.pos.x = spot.x
  player.pos.y = spot.y
  player.prev.x = spot.x
  player.prev.y = spot.y
  player.z = floorAt(world.grid, spot.x, spot.y)
  player.prevZ = player.z
  player.vz = 0
  player.grounded = true
  player.knock.x = 0
  player.knock.y = 0
  return spot
}

export function teleportToArea(world: World, index: number): Vec2 | null {
  const area = world.level.areas[index]
  return area ? placePlayer(world, findSpot(world, area.bottom - 2, area.top)) : null
}

export function teleportToBoss(world: World): Vec2 | null {
  const index = world.level.areas.findIndex((area) => area.kind === 'boss')
  const below = world.level.areas[index - 1]
  return index > 0 && below ? placePlayer(world, findSpot(world, below.top + 1, below.bottom - 1)) : null
}

export function clearCurrentArea(world: World): void {
  for (const enemy of world.enemies) {
    if (enemy.area !== world.areaIndex || enemy.kind === 'boss' || enemy.hp <= 0) continue
    if (enemy.role === 'bolt') damageEnemy(world, enemy, enemy.hp, 0, 0, 0)
    else killEnemy(world, enemy, false, false)
  }
}

export function breakTargets(world: World, area = world.areaIndex): number {
  let broken = 0
  world.level.landmarks.forEach((placement, index) => {
    if (placement.area !== area || !isTarget(placement) || world.landmarks[index].broken) return
    breakLandmark(world, index)
    broken += 1
  })
  return broken
}

export function openPens(world: World, area = world.areaIndex): number {
  let opened = 0
  world.level.landmarks.forEach((placement, index) => {
    if (placement.area !== area || !placement.gate || world.landmarks[index].open) return
    openPen(world, index)
    opened += 1
  })
  return opened
}

export function raiseAlarms(world: World): number {
  let raised = 0
  world.alarms.forEach((_, index) => {
    if (raiseAlarm(world, index)) raised += 1
  })
  return raised
}

export function lightLamps(world: World, area?: number): number {
  let lit = 0
  world.level.lamps.forEach((lamp, index) => {
    if (area !== undefined && lamp.area !== area) return
    if (lightLamp(world, index)) lit += 1
  })
  return lit
}

export function dropNearPlayer(world: World, item: PickupItem): void {
  const { player } = world
  const x = player.pos.x + Math.cos(player.facing) * 1.4
  const y = player.pos.y + Math.sin(player.facing) * 1.4
  spawnPickup(world, item, x, y, { from: player.pos, scatter: false })
}

export function randomAffixes(world: World): AffixId[] {
  const pool = [...AFFIX_ORDER]
  const count = 1 + world.rng.int(2)
  const picked: AffixId[] = []
  for (let i = 0; i < count; i++) picked.push(pool.splice(world.rng.int(pool.length), 1)[0])
  return picked
}

export function spawnEnemyNear(world: World, kind: MinionKind, affixes: AffixId[] = []): Enemy | null {
  const { player } = world
  for (let attempt = 0; attempt < 16; attempt++) {
    const angle = world.rng.range(0, Math.PI * 2)
    const x = player.pos.x + Math.cos(angle) * SPAWN_RING
    const y = player.pos.y + Math.sin(angle) * SPAWN_RING
    if (blocksMovement(tileAt(world.grid, Math.floor(x), Math.floor(y)))) continue
    const enemy = createEnemy(world, kind, { x, y }, world.areaIndex, { affixes })
    world.enemies.push(enemy)
    world.events.push({ type: 'enemySpawned', id: enemy.id, x, y })
    aggro(world, enemy, 0)
    return enemy
  }
  return null
}
