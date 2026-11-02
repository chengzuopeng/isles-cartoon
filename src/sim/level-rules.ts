import { CHEST_HEIGHT, JUMP_HEIGHT, eyeHeightOf } from '../data/heights'
import { FP_RULES } from '../data/levels/rules'
import { createDefaultTuning, type Tuning } from '../data/tuning'
import { lineClear } from './collision'
import { Tile, blocksSight, cellFloor, cellTop, climbable, tileAt, type Grid } from './grid'
import type { BuiltLevel, EnemyPlacement } from './level'
import type { Vec3 } from './math'

function enemyEye(grid: Grid, enemy: EnemyPlacement): Vec3 {
  return { x: enemy.x, y: enemy.y, z: cellFloor(grid, Math.floor(enemy.x), Math.floor(enemy.y)) + eyeHeightOf(enemy.kind) }
}

export function canHearAlert(grid: Grid, tuning: Tuning, from: Vec3, to: Vec3): boolean {
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  if (distance > tuning.perception.alertRadius) return false
  return distance <= tuning.perception.alertThroughWalls || lineClear(grid, from, to, blocksSight)
}

export function spawnWatchers(level: BuiltLevel, tuning: Tuning = createDefaultTuning()): EnemyPlacement[] {
  const { grid, playerStart } = level
  const chest: Vec3 = { x: playerStart.x, y: playerStart.y, z: cellFloor(grid, Math.floor(playerStart.x), Math.floor(playerStart.y)) + CHEST_HEIGHT }
  return level.enemies.filter((enemy) => {
    if (enemy.kind === 'turret') return false
    const distance = Math.hypot(enemy.x - chest.x, enemy.y - chest.y)
    if (enemy.idle === 'ambush') return distance <= tuning.perception.ambushRadius
    if (distance > tuning[enemy.kind].sight) return false
    return lineClear(grid, enemyEye(grid, enemy), chest, blocksSight)
  })
}

export function wakeChain(level: BuiltLevel, seed: number, tuning: Tuning = createDefaultTuning()): number[] {
  const { grid, enemies } = level
  const woken = new Set<number>([seed])
  let frontier = [seed]
  for (let hop = 0; hop < tuning.ai.alertHops && frontier.length > 0; hop++) {
    const next: number[] = []
    for (const index of frontier) {
      const from = enemyEye(grid, enemies[index])
      enemies.forEach((other, otherIndex) => {
        if (woken.has(otherIndex) || other.idle === 'ambush') return
        if (!canHearAlert(grid, tuning, from, enemyEye(grid, other))) return
        woken.add(otherIndex)
        next.push(otherIndex)
      })
    }
    frontier = next
  }
  return [...woken]
}

function lowSteps(grid: Grid, column: number, row: number): boolean {
  const tile = tileAt(grid, column, row)
  return climbable(tile) && cellTop(grid, column, row) - cellFloor(grid, column, row) <= JUMP_HEIGHT + 1e-4
}

function bossArenaSpan(level: BuiltLevel): { width: number; depth: number } | null {
  const area = level.areas.find((item) => item.kind === 'boss')
  if (!area) return null
  const { grid } = level
  let minColumn = Infinity
  let maxColumn = -Infinity
  let minRow = Infinity
  let maxRow = -Infinity
  for (let row = area.top; row < area.bottom; row++) {
    for (let column = 0; column < grid.columns; column++) {
      const tile = tileAt(grid, column, row)
      if (tile === Tile.Wall || tile === Tile.Gate || tile === Tile.GateClosed || tile === Tile.Exit) continue
      minColumn = Math.min(minColumn, column)
      maxColumn = Math.max(maxColumn, column)
      minRow = Math.min(minRow, row)
      maxRow = Math.max(maxRow, row)
    }
  }
  if (!Number.isFinite(minColumn)) return null
  return { width: maxColumn - minColumn + 1, depth: maxRow - minRow + 1 }
}

export function firstPersonProblems(level: BuiltLevel, tuning: Tuning = createDefaultTuning()): string[] {
  const problems: string[] = []
  const { grid } = level
  for (const enemy of spawnWatchers(level, tuning)) {
    problems.push(`${enemy.kind} at ${Math.floor(enemy.x)},${Math.floor(enemy.y)} notices the player at the start`)
  }
  const reported = new Set<string>()
  level.enemies.forEach((enemy, index) => {
    if (enemy.idle === 'ambush') return
    const chain = wakeChain(level, index, tuning)
    if (chain.length <= FP_RULES.wakeLimit) return
    const key = [...chain].sort((a, b) => a - b).join(',')
    if (reported.has(key)) return
    reported.add(key)
    problems.push(`${enemy.kind} at ${Math.floor(enemy.x)},${Math.floor(enemy.y)} wakes ${chain.length} enemies at once (limit ${FP_RULES.wakeLimit})`)
  })
  for (const secret of level.secrets) {
    for (let row = secret.row - 1; row <= secret.row + secret.depth; row++) {
      for (let column = secret.column - 1; column <= secret.column + secret.width; column++) {
        const inside = column >= secret.column && column < secret.column + secret.width && row >= secret.row && row < secret.row + secret.depth
        if (inside || column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) continue
        if (lowSteps(grid, column, row)) problems.push(`secret at ${secret.column},${secret.row} can be reached over a low obstacle at ${column},${row}`)
      }
    }
  }
  const arena = bossArenaSpan(level)
  if (arena && (arena.width < FP_RULES.bossArenaMin || arena.depth < FP_RULES.bossArenaMin)) {
    problems.push(`boss arena is ${arena.width} x ${arena.depth}, needs at least ${FP_RULES.bossArenaMin} x ${FP_RULES.bossArenaMin}`)
  }
  return problems
}
