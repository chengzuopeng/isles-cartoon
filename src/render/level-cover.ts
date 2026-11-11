import { JUMP_HEIGHT } from '../data/heights'
import { Tile, cellFloor, tileAt, type Grid } from '../sim/grid'
import type { BuiltLevel } from '../sim/level'
import { cellHash } from './scene-models'

export const TREE_THIN = {
  shadow: 1,
  full: 2,
  half: 4,
  halfScale: 1.15,
  sparseShare: 0.16,
  sparseScale: 1.45,
} as const

export const HIDDEN_TOP = {
  gap: 3,
  reach: 10,
  eye: 1.45,
} as const

export interface TreeLook {
  scale: number
  shadow: boolean
  ink: boolean
}

const NEIGHBORS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

const ORTHOGONAL = NEIGHBORS.slice(0, 4)
const SOLID = new Set<Tile>([Tile.Wall, Tile.Water, Tile.Tree, Tile.Landmark])
const CLIMB = new Set<Tile>([Tile.Rock, Tile.Cart, Tile.Fence, Tile.Boulder, Tile.LandmarkLow])
const DETAIL = new Set<Tile>([Tile.Floor, Tile.Bush, Tile.Path])

export function treeDepths(grid: Grid): Uint8Array {
  const depth = new Uint8Array(grid.columns * grid.rows)
  const queue: number[] = []
  for (let index = 0; index < depth.length; index++) {
    const tile = grid.tiles[index]
    if (tile === Tile.Tree) depth[index] = 255
    else if (tile !== Tile.Wall) queue.push(index)
  }
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head]
    const column = index % grid.columns
    const row = (index - column) / grid.columns
    for (const [dc, dr] of NEIGHBORS) {
      const nc = column + dc
      const nr = row + dr
      if (nc < 0 || nr < 0 || nc >= grid.columns || nr >= grid.rows) continue
      const next = nr * grid.columns + nc
      if (depth[next] !== 255) continue
      depth[next] = Math.min(254, depth[index] + 1)
      queue.push(next)
    }
  }
  return depth
}

export function treeLook(depth: number, column: number, row: number): TreeLook | null {
  if (depth <= TREE_THIN.full) return { scale: 1, shadow: depth <= TREE_THIN.shadow, ink: true }
  if (depth <= TREE_THIN.half) return (column + row) % 2 === 0 ? { scale: TREE_THIN.halfScale, shadow: false, ink: true } : null
  return cellHash(column, row, 31) < TREE_THIN.sparseShare ? { scale: TREE_THIN.sparseScale, shadow: false, ink: false } : null
}

function standHeight(grid: Grid, index: number): number {
  const tile = grid.tiles[index] as Tile
  if (SOLID.has(tile)) return Infinity
  if (CLIMB.has(tile)) return grid.top[index]
  return grid.floor[index]
}

export function walkableCells(grid: Grid, start: { x: number; y: number }): Uint8Array {
  const seen = new Uint8Array(grid.columns * grid.rows)
  const first = Math.floor(start.y) * grid.columns + Math.floor(start.x)
  if (first < 0 || first >= seen.length) return seen
  seen[first] = 1
  const queue = [first]
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head]
    const column = index % grid.columns
    const row = (index - column) / grid.columns
    const from = standHeight(grid, index)
    for (const [dc, dr] of ORTHOGONAL) {
      const nc = column + dc
      const nr = row + dr
      if (nc < 0 || nr < 0 || nc >= grid.columns || nr >= grid.rows) continue
      const next = nr * grid.columns + nc
      if (seen[next] === 1 || standHeight(grid, next) > from + JUMP_HEIGHT + 1e-4) continue
      seen[next] = 1
      queue.push(next)
    }
  }
  return seen
}

export function hiddenTops(level: BuiltLevel): Uint8Array {
  const { grid } = level
  const walk = walkableCells(grid, level.playerStart)
  const hidden = new Uint8Array(grid.columns * grid.rows)
  for (let row = 0; row < grid.rows; row++) {
    for (let column = 0; column < grid.columns; column++) {
      const index = row * grid.columns + column
      if (walk[index] === 1 || !DETAIL.has(tileAt(grid, column, row))) continue
      let near = false
      let highest = -Infinity
      for (let dr = -HIDDEN_TOP.reach; dr <= HIDDEN_TOP.reach && !near; dr++) {
        for (let dc = -HIDDEN_TOP.reach; dc <= HIDDEN_TOP.reach; dc++) {
          const nc = column + dc
          const nr = row + dr
          if (nc < 0 || nr < 0 || nc >= grid.columns || nr >= grid.rows || walk[nr * grid.columns + nc] !== 1) continue
          if (Math.max(Math.abs(dc), Math.abs(dr)) < HIDDEN_TOP.gap) {
            near = true
            break
          }
          highest = Math.max(highest, cellFloor(grid, nc, nr))
        }
      }
      if (!near && cellFloor(grid, column, row) > highest + HIDDEN_TOP.eye) hidden[index] = 1
    }
  }
  return hidden
}
