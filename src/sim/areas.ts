import { LOCK_DEPTH } from '../data/levels/rules'
import { callReinforcements } from './alarms'
import { activateBoss } from './boss'
import { Tile, setTile, tileAt } from './grid'
import { targetTally } from './landmark-state'
import { invalidateNavigation } from './navigation'
import { aggro } from './perception'
import type { World } from './world'

export function updateAreas(world: World): void {
  if (world.status !== 'playing') return
  const { player, level } = world
  const row = Math.min(level.grid.rows - 1, Math.max(0, Math.floor(player.pos.y)))
  const index = level.areaOfRow[row]
  world.areaIndex = index
  const area = level.areas[index]
  const runtime = world.areas[index]
  if (!runtime.visited) {
    runtime.visited = true
    world.events.push({ type: 'areaEntered', index, name: area.name })
  }
  if ((area.kind === 'lock' || area.kind === 'boss') && runtime.status === 'open' && row <= area.bottom - 1 - LOCK_DEPTH) {
    lockArea(world, index)
  }
  world.areas.forEach((state, areaIndex) => {
    if ((state.status === 'locked' || state.status === 'sealed') && areaDefeated(world, areaIndex)) unlockArea(world, areaIndex)
  })
  if (tileAt(world.grid, Math.floor(player.pos.x), row) === Tile.Exit) {
    world.status = 'complete'
    world.events.push({ type: 'levelComplete' })
  }
}

export function areaDefeated(world: World, index: number): boolean {
  const kind = world.level.areas[index].kind
  if (kind === 'boss') return !world.boss || (world.boss.hp <= 0 && (world.boss.boss?.tank?.retreat ?? 0) <= 0)
  if (kind === 'destroy') {
    const targets = targetTally(world, index)
    return targets.done >= targets.total
  }
  const enemiesLeft = world.enemies.some((enemy) => enemy.area === index && enemy.hp > 0)
  const spawnsLeft = world.spawns.some((marker) => marker.area === index)
  return !enemiesLeft && !spawnsLeft
}

function lockArea(world: World, index: number): void {
  const area = world.level.areas[index]
  if (area.kind === 'lock') callReinforcements(world, index)
  if (area.kind === 'lock' && areaDefeated(world, index)) {
    world.areas[index].status = 'cleared'
    return
  }
  setGates(world, index, true)
  world.areas[index].status = 'locked'
  world.events.push({ type: 'areaLocked', index })
  for (const enemy of world.enemies) {
    if (enemy.area === index && enemy.hp > 0) aggro(world, enemy, 0)
  }
  if (area.kind === 'boss') activateBoss(world)
}

function unlockArea(world: World, index: number): void {
  setGates(world, index, false)
  world.areas[index].status = 'cleared'
  world.events.push({ type: 'areaCleared', index })
}

export function setGates(world: World, index: number, closed: boolean): void {
  for (const tile of world.level.areas[index].gates) {
    setTile(world.grid, tile, closed ? Tile.GateClosed : Tile.Gate)
  }
  invalidateNavigation(world)
}
