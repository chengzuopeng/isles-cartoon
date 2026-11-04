import { CRATE_STACK_HEIGHT, FLOOR_STEP, STEP_HEIGHT, TILE_HEIGHTS, type TileKind } from '../data/heights'
import type { Vec2 } from './math'

export const Tile = {
  Floor: 0,
  Wall: 1,
  Water: 2,
  Bush: 3,
  Tree: 4,
  Rock: 5,
  Crate: 6,
  Fence: 7,
  Path: 8,
  Gate: 9,
  GateClosed: 10,
  Exit: 11,
  Cart: 12,
  Landmark: 13,
  LandmarkLow: 14,
  Boulder: 15,
} as const

export type Tile = (typeof Tile)[keyof typeof Tile]

export interface Grid {
  columns: number
  rows: number
  tiles: Uint8Array
  floor: Float32Array
  top: Float32Array
}

export interface Marker {
  symbol: string
  x: number
  y: number
}

export interface ParsedMap {
  grid: Grid
  playerSpawn: Vec2
  enemySpawns: Vec2[]
}

const TILE_KINDS: readonly TileKind[] = [
  'floor',
  'wall',
  'water',
  'bush',
  'tree',
  'rock',
  'crate',
  'fence',
  'path',
  'gate',
  'gateClosed',
  'exit',
  'cart',
  'landmark',
  'landmarkLow',
  'boulder',
]

const TERRAIN: Readonly<Record<string, Tile | undefined>> = {
  '.': Tile.Floor,
  '#': Tile.Wall,
  '~': Tile.Water,
  '"': Tile.Bush,
  T: Tile.Tree,
  o: Tile.Rock,
  O: Tile.Boulder,
  c: Tile.Crate,
  K: Tile.Crate,
  C: Tile.Cart,
  f: Tile.Fence,
  ',': Tile.Path,
  D: Tile.Gate,
  X: Tile.Exit,
  P: Tile.Floor,
  E: Tile.Floor,
  m: Tile.Floor,
  r: Tile.Floor,
  b: Tile.Floor,
  t: Tile.Floor,
  B: Tile.Floor,
  S: Tile.Floor,
  $: Tile.Floor,
  W: Tile.Floor,
  R: Tile.Floor,
  '+': Tile.Floor,
  h: Tile.Floor,
  g: Tile.Floor,
  '<': Tile.Floor,
  '>': Tile.Floor,
  '^': Tile.Floor,
  v: Tile.Floor,
}

const RAISED: Readonly<Record<string, number | undefined>> = {
  K: CRATE_STACK_HEIGHT,
}

const MARKERS = new Set(['P', 'E', 'm', 'r', 'b', 't', 'h', 'g', 'B', 'S', '$', 'W', 'R', '+', '<', '>', '^', 'v'])
const MOVE_BLOCKERS = new Set<Tile>([
  Tile.Wall,
  Tile.Water,
  Tile.Tree,
  Tile.Rock,
  Tile.Crate,
  Tile.Cart,
  Tile.Fence,
  Tile.GateClosed,
  Tile.Landmark,
  Tile.LandmarkLow,
  Tile.Boulder,
])
const BULLET_BLOCKERS = new Set<Tile>([
  Tile.Wall,
  Tile.Tree,
  Tile.Rock,
  Tile.Crate,
  Tile.Cart,
  Tile.GateClosed,
  Tile.Landmark,
  Tile.Boulder,
])
const CLIMBABLE = new Set<Tile>([Tile.Rock, Tile.Crate, Tile.Cart, Tile.Fence, Tile.Boulder])

const NEIGHBORS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

function markerGround(tiles: Uint8Array, columns: number, rows: number, index: number, markerCells: ReadonlySet<number>): Tile {
  const column = index % columns
  const row = (index - column) / columns
  let path = 0
  let floor = 0
  for (const [dx, dy] of NEIGHBORS) {
    const x = column + dx
    const y = row + dy
    if (x < 0 || y < 0 || x >= columns || y >= rows) continue
    const neighbor = y * columns + x
    if (markerCells.has(neighbor)) continue
    if (tiles[neighbor] === Tile.Path) path++
    else if (tiles[neighbor] === Tile.Floor) floor++
  }
  return path > floor ? Tile.Path : Tile.Floor
}

export function parseRows(lines: readonly string[], heights?: readonly string[]): { grid: Grid; markers: Marker[] } {
  const rows = lines.length
  const columns = lines[0]?.length ?? 0
  const tiles = new Uint8Array(columns * rows)
  const floor = new Float32Array(columns * rows)
  const markers: Marker[] = []
  const markerCells = new Set<number>()
  const raised = new Map<number, number>()
  if (heights && heights.length !== rows) throw new Error(`map has ${heights.length} height rows, expected ${rows}`)
  lines.forEach((line, row) => {
    if (line.length !== columns) {
      throw new Error(`map row ${row} has ${line.length} columns, expected ${columns}`)
    }
    const levels = heights?.[row]
    if (levels !== undefined && levels.length !== columns) {
      throw new Error(`height row ${row} has ${levels.length} columns, expected ${columns}`)
    }
    for (let column = 0; column < columns; column++) {
      const symbol = line.charAt(column)
      const tile = TERRAIN[symbol]
      if (tile === undefined) throw new Error(`unknown map symbol "${symbol}" at ${column},${row}`)
      tiles[row * columns + column] = tile
      const lift = RAISED[symbol]
      if (lift !== undefined) raised.set(row * columns + column, lift)
      if (levels !== undefined) floor[row * columns + column] = heightDigit(levels.charAt(column), column, row) * FLOOR_STEP
      if (MARKERS.has(symbol)) {
        markers.push({ symbol, x: column + 0.5, y: row + 0.5 })
        markerCells.add(row * columns + column)
      }
    }
  })
  for (const index of markerCells) tiles[index] = markerGround(tiles, columns, rows, index, markerCells)
  const top = new Float32Array(columns * rows)
  for (let index = 0; index < top.length; index++) top[index] = floor[index] + (raised.get(index) ?? tileHeight(tiles[index] as Tile))
  return { grid: { columns, rows, tiles, floor, top }, markers }
}

function heightDigit(symbol: string, column: number, row: number): number {
  const value = symbol.charCodeAt(0) - 48
  if (symbol.length !== 1 || value < 0 || value > 9) throw new Error(`unknown height "${symbol}" at ${column},${row}`)
  return value
}

export function parseMap(source: string): ParsedMap {
  const { grid, markers } = parseRows(source.trim().split('\n'))
  const player = markers.find((marker) => marker.symbol === 'P')
  if (!player) throw new Error('map has no player spawn')
  const enemySpawns = markers.filter((marker) => marker.symbol === 'E').map(({ x, y }) => ({ x, y }))
  return { grid, playerSpawn: { x: player.x, y: player.y }, enemySpawns }
}

export function tileAt(grid: Grid, column: number, row: number): Tile {
  if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) return Tile.Wall
  return grid.tiles[row * grid.columns + column] as Tile
}

export function insideGrid(grid: Grid, column: number, row: number): boolean {
  return column >= 0 && row >= 0 && column < grid.columns && row < grid.rows
}

export function tileKind(tile: Tile): TileKind {
  return TILE_KINDS[tile] ?? 'wall'
}

export function tileHeight(tile: Tile): number {
  return TILE_HEIGHTS[tileKind(tile)]
}

export function setTile(grid: Grid, index: number, tile: Tile, height = tileHeight(tile)): void {
  grid.tiles[index] = tile
  grid.top[index] = grid.floor[index] + height
}

export function cellFloor(grid: Grid, column: number, row: number): number {
  if (!insideGrid(grid, column, row)) return 0
  return grid.floor[row * grid.columns + column]
}

export function cellTop(grid: Grid, column: number, row: number): number {
  if (!insideGrid(grid, column, row)) return Infinity
  return grid.top[row * grid.columns + column]
}

export function floorAt(grid: Grid, x: number, y: number): number {
  return cellFloor(grid, Math.floor(x), Math.floor(y))
}

export function topAt(grid: Grid, x: number, y: number): number {
  return cellTop(grid, Math.floor(x), Math.floor(y))
}

export function blocksMovement(tile: Tile): boolean {
  return MOVE_BLOCKERS.has(tile)
}

export function blocksBullets(tile: Tile): boolean {
  return BULLET_BLOCKERS.has(tile)
}

export const blocksSight = blocksBullets

export function canStep(grid: Grid, column: number, row: number, toColumn: number, toRow: number): boolean {
  if (blocksMovement(tileAt(grid, toColumn, toRow))) return false
  return Math.abs(cellFloor(grid, toColumn, toRow) - cellFloor(grid, column, row)) <= STEP_HEIGHT + 1e-4
}

export function climbable(tile: Tile): boolean {
  return CLIMBABLE.has(tile)
}

export function standHeight(grid: Grid, column: number, row: number): number {
  if (!insideGrid(grid, column, row)) return Infinity
  const tile = tileAt(grid, column, row)
  if (climbable(tile)) return cellTop(grid, column, row)
  if (blocksMovement(tile)) return Infinity
  return cellFloor(grid, column, row)
}

export function solidHeight(grid: Grid, column: number, row: number, blocks: (tile: Tile) => boolean): number {
  if (!insideGrid(grid, column, row)) return Infinity
  return blocks(tileAt(grid, column, row)) ? cellTop(grid, column, row) : cellFloor(grid, column, row)
}
