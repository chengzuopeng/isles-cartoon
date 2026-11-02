import { corridorClear } from './collision'
import { canStep, type Grid } from './grid'
import type { Vec2 } from './math'
import { stepOpen } from './pathing'
import type { World } from './world'

const CACHE_LIMIT = 48

export function invalidateNavigation(world: World): void {
  world.navFields.clear()
  world.flow.targetColumn = -1
}

export function tileIndex(grid: Grid, pos: Vec2): number {
  return Math.floor(pos.y) * grid.columns + Math.floor(pos.x)
}

export function fieldTo(world: World, index: number): Float32Array {
  const cached = world.navFields.get(index)
  if (cached) return cached
  const field = distanceField(world.grid, [index])
  world.navFields.set(index, field)
  if (world.navFields.size > CACHE_LIMIT) {
    const oldest = world.navFields.keys().next().value
    if (oldest !== undefined) world.navFields.delete(oldest)
  }
  return field
}

export function directionTo(world: World, from: Vec2, radius: number, target: Vec2): Vec2 | null {
  const dx = target.x - from.x
  const dy = target.y - from.y
  const length = Math.hypot(dx, dy)
  if (length < 1e-6) return null
  if (corridorClear(world.grid, from, target, radius)) return { x: dx / length, y: dy / length }
  const field = fieldTo(world, tileIndex(world.grid, target))
  return descend(world.grid, field, from)
}

export function distanceField(grid: Grid, sources: number[]): Float32Array {
  const field = new Float32Array(grid.columns * grid.rows).fill(Infinity)
  const queue = new Int32Array(grid.columns * grid.rows)
  let tail = 0
  for (const source of sources) {
    field[source] = 0
    queue[tail++] = source
  }
  let head = 0
  while (head < tail) {
    const index = queue[head++]
    const column = index % grid.columns
    const row = (index - column) / grid.columns
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nc = column + dc
      const nr = row + dr
      if (!canStep(grid, column, row, nc, nr)) continue
      const next = nr * grid.columns + nc
      if (field[next] <= field[index] + 1) continue
      field[next] = field[index] + 1
      queue[tail++] = next
    }
  }
  return field
}

export function downhill(grid: Grid, field: Float32Array, column: number, row: number): { column: number; row: number } | null {
  let best = field[row * grid.columns + column] ?? Infinity
  let found: { column: number; row: number } | null = null
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dc === 0 && dr === 0) continue
      const nc = column + dc
      const nr = row + dr
      if (!stepOpen(grid, column, row, dc, dr)) continue
      const value = field[nr * grid.columns + nc]
      if (value < best) {
        best = value
        found = { column: nc, row: nr }
      }
    }
  }
  return found
}

export function descend(grid: Grid, field: Float32Array, pos: Vec2): Vec2 | null {
  const next = downhill(grid, field, Math.floor(pos.x), Math.floor(pos.y))
  if (!next) return null
  const dx = next.column + 0.5 - pos.x
  const dy = next.row + 0.5 - pos.y
  const length = Math.hypot(dx, dy)
  return length < 1e-6 ? null : { x: dx / length, y: dy / length }
}
