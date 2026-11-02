import { blocksMovement, canStep, tileAt, type Grid } from './grid'
import type { Vec2 } from './math'

export interface FlowField {
  distances: Float32Array
  queue: Int32Array
  targetColumn: number
  targetRow: number
}

const ORTHOGONAL = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const

export function createFlowField(grid: Grid): FlowField {
  const size = grid.columns * grid.rows
  return {
    distances: new Float32Array(size).fill(Infinity),
    queue: new Int32Array(size),
    targetColumn: -1,
    targetRow: -1,
  }
}

export function updateFlowField(field: FlowField, grid: Grid, target: Vec2): void {
  const column = Math.floor(target.x)
  const row = Math.floor(target.y)
  if (column === field.targetColumn && row === field.targetRow) return
  field.targetColumn = column
  field.targetRow = row
  const { distances, queue } = field
  distances.fill(Infinity)
  let tail = 0
  if (!blocksMovement(tileAt(grid, column, row))) {
    const start = row * grid.columns + column
    distances[start] = 0
    queue[tail++] = start
  } else {
    for (const [dc, dr] of ORTHOGONAL) {
      const nc = column + dc
      const nr = row + dr
      if (blocksMovement(tileAt(grid, nc, nr))) continue
      const start = nr * grid.columns + nc
      distances[start] = 1
      queue[tail++] = start
    }
  }
  let head = 0
  while (head < tail) {
    const index = queue[head++]
    const c = index % grid.columns
    const r = (index - c) / grid.columns
    const next = distances[index] + 1
    for (const [dc, dr] of ORTHOGONAL) {
      const nc = c + dc
      const nr = r + dr
      if (!canStep(grid, c, r, nc, nr)) continue
      const neighbor = nr * grid.columns + nc
      if (distances[neighbor] <= next) continue
      distances[neighbor] = next
      queue[tail++] = neighbor
    }
  }
}

export function distanceAt(field: FlowField, grid: Grid, column: number, row: number): number {
  if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) return Infinity
  return field.distances[row * grid.columns + column]
}

export function stepOpen(grid: Grid, column: number, row: number, dc: number, dr: number): boolean {
  if (!canStep(grid, column, row, column + dc, row + dr)) return false
  if (dc === 0 || dr === 0) return true
  return canStep(grid, column, row, column + dc, row) && canStep(grid, column, row, column, row + dr)
}

export function flowDirection(field: FlowField, grid: Grid, pos: Vec2): Vec2 | null {
  const column = Math.floor(pos.x)
  const row = Math.floor(pos.y)
  let best = distanceAt(field, grid, column, row)
  let bestColumn = column
  let bestRow = row
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dc === 0 && dr === 0) continue
      if (!stepOpen(grid, column, row, dc, dr)) continue
      const distance = distanceAt(field, grid, column + dc, row + dr)
      if (distance < best) {
        best = distance
        bestColumn = column + dc
        bestRow = row + dr
      }
    }
  }
  if (bestColumn === column && bestRow === row) return null
  const dx = bestColumn + 0.5 - pos.x
  const dy = bestRow + 0.5 - pos.y
  const length = Math.hypot(dx, dy)
  return length < 1e-6 ? null : { x: dx / length, y: dy / length }
}
