import { STEP_HEIGHT } from '../data/heights'
import { blocksBullets, blocksMovement, cellFloor, solidHeight, standHeight, supportsStanding, tileAt, type Grid, type Tile } from './grid'
import { clamp, type Vec2, type Vec3 } from './math'

export type TileTest = (tile: Tile) => boolean

export type CellTest = (column: number, row: number) => boolean

const HEIGHT_SLACK = 1e-4

interface Contact {
  column: number
  row: number
  distanceSq: number
}

export function resolveCircleGrid(
  pos: Vec2,
  radius: number,
  grid: Grid,
  blocks: TileTest = blocksMovement,
): boolean {
  return resolveCircle(pos, radius, (column, row) => blocks(tileAt(grid, column, row)))
}

export function resolveCircle(pos: Vec2, radius: number, blocked: CellTest): boolean {
  let collided = false
  for (let pass = 0; pass < 3; pass++) {
    const contacts = findContacts(pos, radius, blocked)
    if (contacts.length === 0) break
    contacts.sort((a, b) => a.distanceSq - b.distanceSq)
    for (const contact of contacts) pushOut(pos, radius, contact.column, contact.row)
    collided = true
  }
  return collided
}

export function walkerTest(grid: Grid, z: number): CellTest {
  return (column, row) => blocksMovement(tileAt(grid, column, row)) || Math.abs(cellFloor(grid, column, row) - z) > STEP_HEIGHT + HEIGHT_SLACK
}

export function dropTest(grid: Grid, z: number): CellTest {
  return (column, row) => blocksMovement(tileAt(grid, column, row)) || cellFloor(grid, column, row) > z + STEP_HEIGHT + HEIGHT_SLACK
}

export function climberTest(grid: Grid, reach: number): CellTest {
  return (column, row) => standHeight(grid, column, row) > reach + HEIGHT_SLACK
}

export function supportHeight(grid: Grid, pos: Vec2, radius: number, reach: number): number {
  let best = -Infinity
  const radiusSq = radius * radius
  for (let row = Math.floor(pos.y - radius); row <= Math.floor(pos.y + radius); row++) {
    for (let column = Math.floor(pos.x - radius); column <= Math.floor(pos.x + radius); column++) {
      const dx = pos.x - clamp(pos.x, column, column + 1)
      const dy = pos.y - clamp(pos.y, row, row + 1)
      if (dx * dx + dy * dy > radiusSq) continue
      if (!supportsStanding(tileAt(grid, column, row))) continue
      const height = standHeight(grid, column, row)
      if (height <= reach + HEIGHT_SLACK && height > best) best = height
    }
  }
  return best
}

function findContacts(pos: Vec2, radius: number, blocked: CellTest): Contact[] {
  const contacts: Contact[] = []
  const radiusSq = radius * radius
  const maxRow = Math.floor(pos.y + radius)
  const maxColumn = Math.floor(pos.x + radius)
  for (let row = Math.floor(pos.y - radius); row <= maxRow; row++) {
    for (let column = Math.floor(pos.x - radius); column <= maxColumn; column++) {
      if (!blocked(column, row)) continue
      const dx = pos.x - clamp(pos.x, column, column + 1)
      const dy = pos.y - clamp(pos.y, row, row + 1)
      const distanceSq = dx * dx + dy * dy
      if (distanceSq < radiusSq) contacts.push({ column, row, distanceSq })
    }
  }
  return contacts
}

function pushOut(pos: Vec2, radius: number, column: number, row: number): void {
  const dx = pos.x - clamp(pos.x, column, column + 1)
  const dy = pos.y - clamp(pos.y, row, row + 1)
  const distanceSq = dx * dx + dy * dy
  if (distanceSq >= radius * radius) return
  if (distanceSq > 1e-12) {
    const distance = Math.sqrt(distanceSq)
    const push = radius - distance
    pos.x += (dx / distance) * push
    pos.y += (dy / distance) * push
    return
  }
  const left = pos.x - column
  const right = column + 1 - pos.x
  const top = pos.y - row
  const bottom = row + 1 - pos.y
  const nearest = Math.min(left, right, top, bottom)
  if (nearest === left) pos.x = column - radius
  else if (nearest === right) pos.x = column + 1 + radius
  else if (nearest === top) pos.y = row - radius
  else pos.y = row + 1 + radius
}

export function segmentClear(
  grid: Grid,
  from: Vec2,
  to: Vec2,
  blocks: TileTest = blocksMovement,
  step: number = blocks === blocksMovement ? STEP_HEIGHT : Infinity,
): boolean {
  return firstBlocked(grid, from, to, blocks, step) < 0
}

export function firstBlocked(grid: Grid, from: Vec2, to: Vec2, blocks: TileTest = blocksMovement, step = Infinity): number {
  let column = Math.floor(from.x)
  let row = Math.floor(from.y)
  if (blocks(tileAt(grid, column, row))) return cellIndex(grid, column, row)
  const dx = to.x - from.x
  const dy = to.y - from.y
  const stepColumn = dx > 0 ? 1 : dx < 0 ? -1 : 0
  const stepRow = dy > 0 ? 1 : dy < 0 ? -1 : 0
  const deltaX = stepColumn === 0 ? Infinity : Math.abs(1 / dx)
  const deltaY = stepRow === 0 ? Infinity : Math.abs(1 / dy)
  let nextX = stepColumn > 0 ? (column + 1 - from.x) * deltaX : stepColumn < 0 ? (from.x - column) * deltaX : Infinity
  let nextY = stepRow > 0 ? (row + 1 - from.y) * deltaY : stepRow < 0 ? (from.y - row) * deltaY : Infinity
  let remaining = Math.abs(Math.floor(to.x) - column) + Math.abs(Math.floor(to.y) - row)
  let floor = cellFloor(grid, column, row)
  while (remaining > 0) {
    if (nextX < nextY) {
      nextX += deltaX
      column += stepColumn
    } else {
      nextY += deltaY
      row += stepRow
    }
    remaining -= 1
    if (blocks(tileAt(grid, column, row))) return cellIndex(grid, column, row)
    const next = cellFloor(grid, column, row)
    if (Math.abs(next - floor) > step + HEIGHT_SLACK) return cellIndex(grid, column, row)
    floor = next
  }
  return -1
}

function cellIndex(grid: Grid, column: number, row: number): number {
  if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) return grid.columns * grid.rows
  return row * grid.columns + column
}

export function corridorClear(
  grid: Grid,
  from: Vec2,
  to: Vec2,
  radius: number,
  blocks: TileTest = blocksMovement,
): boolean {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length < 1e-6) return true
  const offsetX = (-dy / length) * radius
  const offsetY = (dx / length) * radius
  return (
    segmentClear(grid, from, to, blocks) &&
    segmentClear(grid, { x: from.x + offsetX, y: from.y + offsetY }, { x: to.x + offsetX, y: to.y + offsetY }, blocks) &&
    segmentClear(grid, { x: from.x - offsetX, y: from.y - offsetY }, { x: to.x - offsetX, y: to.y - offsetY }, blocks)
  )
}

export function lineClear(grid: Grid, from: Vec3, to: Vec3, blocks: TileTest = blocksBullets): boolean {
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
    if (low < solidHeight(grid, column, row, blocks) - HEIGHT_SLACK) return false
    if (remaining === 0) return true
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
