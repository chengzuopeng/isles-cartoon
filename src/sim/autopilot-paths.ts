import { AUTOPILOT } from '../data/autopilot'
import { STEP_HEIGHT } from '../data/heights'
import { Tile, cellFloor, insideGrid, solidHeight, standHeight, supportsStanding, tileAt, type Grid } from './grid'
import { clamp, type Vec2, type Vec3 } from './math'
import type { World } from './world'

const SLACK = 1e-4

const SIDES: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

export interface Stride {
  x: number
  y: number
  column: number
  row: number
  jump: boolean
}

export function footing(grid: Grid, column: number, row: number, openGates = false): number {
  if (openGates && insideGrid(grid, column, row) && tileAt(grid, column, row) === Tile.GateClosed) return cellFloor(grid, column, row)
  return standHeight(grid, column, row)
}

export function jumpRise(world: World): number {
  return world.tuning.player.jumpHeight - AUTOPILOT.jumpMargin
}

export function stepCost(from: number, to: number, rise: number): number {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0
  if (to <= from + STEP_HEIGHT + SLACK) return 1
  if (to <= from + rise + SLACK) return 1 + AUTOPILOT.jumpCost
  return 0
}

export function pilotField(grid: Grid, sources: readonly number[], rise: number, allowed: Uint8Array | null = null, openGates = false): Float32Array {
  const size = grid.columns * grid.rows
  const field = new Float32Array(size).fill(Infinity)
  const span = 2 + AUTOPILOT.jumpCost
  const buckets: number[][] = Array.from({ length: span }, () => [])
  let pending = 0
  for (const source of sources) {
    if (source < 0 || source >= size || field[source] === 0) continue
    field[source] = 0
    buckets[0].push(source)
    pending += 1
  }
  for (let distance = 0; pending > 0; distance++) {
    const bucket = buckets[distance % span]
    while (bucket.length > 0) {
      const cell = bucket.pop() as number
      pending -= 1
      if (field[cell] !== distance) continue
      const column = cell % grid.columns
      const row = (cell - column) / grid.columns
      const height = footing(grid, column, row, openGates)
      const perch = !supportsStanding(tileAt(grid, column, row))
      for (const [dc, dr] of SIDES) {
        const nc = column + dc
        const nr = row + dr
        if (!insideGrid(grid, nc, nr)) continue
        const next = nr * grid.columns + nc
        if (allowed && allowed[next] !== 1) continue
        if (perch && !supportsStanding(tileAt(grid, nc, nr))) continue
        const from = footing(grid, nc, nr, openGates)
        const cost = Number.isFinite(height) ? stepCost(from, height, rise) : Number.isFinite(from) ? 1 : 0
        if (cost === 0) continue
        const reached = distance + cost
        if (reached >= field[next]) continue
        field[next] = reached
        buckets[reached % span].push(next)
        pending += 1
      }
    }
  }
  return field
}

export function safeCells(world: World): Uint8Array | null {
  const { grid, level } = world
  if (level.exits.length === 0) return null
  const field = pilotField(grid, level.exits, jumpRise(world), null, true)
  const safe = new Uint8Array(field.length)
  for (let index = 0; index < field.length; index++) safe[index] = Number.isFinite(field[index]) ? 1 : 0
  return safe
}

export function standingHeight(world: World): number {
  const { player, grid } = world
  const here = footing(grid, Math.floor(player.pos.x), Math.floor(player.pos.y))
  return Number.isFinite(here) ? Math.max(here, player.z) : player.z
}

export function pilotStep(
  grid: Grid,
  field: Float32Array,
  column: number,
  row: number,
  from: number,
  rise: number,
): { column: number; row: number; jump: boolean } | null {
  let best = field[row * grid.columns + column] ?? Infinity
  let found: { column: number; row: number; jump: boolean } | null = null
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dc === 0 && dr === 0) continue
      const nc = column + dc
      const nr = row + dr
      if (!insideGrid(grid, nc, nr)) continue
      const value = field[nr * grid.columns + nc]
      if (!(value < best)) continue
      const cost = stepCost(from, footing(grid, nc, nr), rise)
      if (cost === 0) continue
      if (dc !== 0 && dr !== 0) {
        if (cost !== 1) continue
        if (stepCost(from, footing(grid, column + dc, row), rise) !== 1) continue
        if (stepCost(from, footing(grid, column, row + dr), rise) !== 1) continue
      }
      best = value
      found = { column: nc, row: nr, jump: cost > 1 }
    }
  }
  return found
}

export function stride(world: World, field: Float32Array): Stride | null {
  const { player, grid } = world
  const column = Math.floor(player.pos.x)
  const row = Math.floor(player.pos.y)
  const from = standingHeight(world)
  const next = pilotStep(grid, field, column, row, from, jumpRise(world))
  if (!next) return null
  const aim = landingBeyond(grid, column, row, next) ?? next
  const dx = aim.column + 0.5 - player.pos.x
  const dy = aim.row + 0.5 - player.pos.y
  const length = Math.hypot(dx, dy)
  if (length < 1e-6) return null
  const up = footing(grid, next.column, next.row) - player.z
  return { x: dx / length, y: dy / length, column: next.column, row: next.row, jump: next.jump && up > STEP_HEIGHT + SLACK }
}

export function landingBeyond(grid: Grid, column: number, row: number, next: { column: number; row: number }): { column: number; row: number } | null {
  if (!insideGrid(grid, next.column, next.row) || supportsStanding(tileAt(grid, next.column, next.row))) return null
  const landing = { column: next.column * 2 - column, row: next.row * 2 - row }
  if (!insideGrid(grid, landing.column, landing.row) || !supportsStanding(tileAt(grid, landing.column, landing.row))) return null
  return Number.isFinite(footing(grid, landing.column, landing.row)) ? landing : null
}

export function gapToCell(pos: Vec2, column: number, row: number): number {
  const dx = pos.x - clamp(pos.x, column, column + 1)
  const dy = pos.y - clamp(pos.y, row, row + 1)
  return Math.hypot(dx, dy)
}

export function wantsJump(world: World, step: Stride | null): boolean {
  const { player } = world
  if (!step || !step.jump || !player.grounded) return false
  return gapToCell(player.pos, step.column, step.row) <= player.radius + AUTOPILOT.jumpLead
}

export function guardLedge(world: World, move: Vec2, safe: Uint8Array | null): Vec2 {
  if (!safe) return move
  const length = Math.hypot(move.x, move.y)
  if (length < 1e-6) return move
  const { player, grid } = world
  const here = Math.floor(player.pos.y) * grid.columns + Math.floor(player.pos.x)
  if (safe[here] !== 1) return move
  const heading = Math.atan2(move.y, move.x)
  if (ledgeFree(world, heading, safe)) return move
  for (const turn of AUTOPILOT.ledgeTurns) {
    if (ledgeFree(world, heading + turn, safe)) return { x: Math.cos(heading + turn) * length, y: Math.sin(heading + turn) * length }
  }
  return { x: 0, y: 0 }
}

function ledgeFree(world: World, angle: number, safe: Uint8Array): boolean {
  const { player, grid } = world
  const reach = player.radius + AUTOPILOT.ledgeProbe
  const dirX = Math.cos(angle)
  const dirY = Math.sin(angle)
  for (const side of [0, 0.7, -0.7]) {
    const x = player.pos.x + dirX * reach - dirY * player.radius * side
    const y = player.pos.y + dirY * reach + dirX * player.radius * side
    if (!cellSafe(grid, safe, Math.floor(x), Math.floor(y))) return false
  }
  return true
}

function cellSafe(grid: Grid, safe: Uint8Array, column: number, row: number): boolean {
  if (!insideGrid(grid, column, row)) return true
  if (!Number.isFinite(standHeight(grid, column, row))) return true
  return safe[row * grid.columns + column] === 1
}

export function pathSafe(world: World, dir: Vec2, distance: number, safe: Uint8Array | null): boolean {
  if (!safe) return true
  const { player, grid } = world
  const here = Math.floor(player.pos.y) * grid.columns + Math.floor(player.pos.x)
  if (safe[here] !== 1) return true
  for (let reach = 0.25; reach <= distance + player.radius; reach += 0.25) {
    const x = player.pos.x + dir.x * reach
    const y = player.pos.y + dir.y * reach
    if (!cellSafe(grid, safe, Math.floor(x), Math.floor(y))) return false
  }
  return true
}

export function firstSolid(grid: Grid, from: Vec3, to: Vec3, blocks: (tile: Tile) => boolean): number {
  let column = Math.floor(from.x)
  let row = Math.floor(from.y)
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dz = to.z - from.z
  const stepColumn = dx > 0 ? 1 : dx < 0 ? -1 : 0
  const stepRow = dy > 0 ? 1 : dy < 0 ? -1 : 0
  const deltaX = stepColumn === 0 ? Infinity : Math.abs(1 / dx)
  const deltaY = stepRow === 0 ? Infinity : Math.abs(1 / dy)
  let nextX = stepColumn > 0 ? (column + 1 - from.x) * deltaX : stepColumn < 0 ? (from.x - column) * deltaX : Infinity
  let nextY = stepRow > 0 ? (row + 1 - from.y) * deltaY : stepRow < 0 ? (from.y - row) * deltaY : Infinity
  let remaining = Math.abs(Math.floor(to.x) - column) + Math.abs(Math.floor(to.y) - row)
  let enter = 0
  for (;;) {
    const exit = remaining > 0 ? Math.min(nextX, nextY, 1) : 1
    const low = from.z + dz * (dz >= 0 ? enter : exit)
    if (low < solidHeight(grid, column, row, blocks) - SLACK) {
      return insideGrid(grid, column, row) ? row * grid.columns + column : grid.columns * grid.rows
    }
    if (remaining === 0) return -1
    if (nextX < nextY) {
      enter = nextX
      nextX += deltaX
      column += stepColumn
    } else {
      enter = nextY
      nextY += deltaY
      row += stepRow
    }
    remaining -= 1
  }
}
