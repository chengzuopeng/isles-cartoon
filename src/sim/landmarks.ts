import { LANDMARKS, type Facing, type LandmarkDef, type LandmarkId } from '../data/landmarks'
import type { LandmarkPlacementDef } from '../data/levels/types'
import { Tile, setTile, type Grid, type Marker } from './grid'

export interface LandmarkGate {
  index: number
  column: number
  row: number
  outX: number
  outY: number
}

export interface LandmarkPlacement {
  id: LandmarkId
  area: number
  column: number
  row: number
  width: number
  depth: number
  facing: Facing
  variant: number
  mask: string[]
  cells: number[]
  water: number[]
  pool: number[]
  gate: LandmarkGate | null
}

export interface AreaRows {
  name: string
  top: number
  bottom: number
}

const OCCUPIED = '#'
const WET = '~'

const FACING_OUT: Readonly<Record<Facing, readonly [number, number]>> = {
  0: [0, 1],
  90: [-1, 0],
  180: [0, -1],
  270: [1, 0],
}

const TILE_NAMES: Readonly<Partial<Record<Tile, string>>> = {
  [Tile.Wall]: 'wall',
  [Tile.Water]: 'water',
  [Tile.Bush]: 'bush',
  [Tile.Tree]: 'tree',
  [Tile.Rock]: 'rock',
  [Tile.Boulder]: 'boulder',
  [Tile.Crate]: 'crate',
  [Tile.Cart]: 'cart',
  [Tile.Fence]: 'fence',
  [Tile.Gate]: 'gate',
  [Tile.GateClosed]: 'gate',
  [Tile.Exit]: 'exit',
}

const MARKER_NAMES: Readonly<Record<string, string>> = {
  P: 'player start',
  E: 'wave spawn',
  m: 'grunt',
  r: 'gunner',
  b: 'bomber',
  t: 'turret',
  h: 'shield',
  g: 'thrower',
  B: 'boss',
  S: 'summon point',
  $: 'normal chest',
  W: 'weapon chest',
  R: 'rare chest',
  '+': 'supply point',
  '<': 'conveyor',
  '>': 'conveyor',
  '^': 'conveyor',
  v: 'conveyor',
}

export function footprintOf(def: LandmarkDef): string[] {
  if (def.footprint) return [...def.footprint]
  const [width, depth] = def.size
  return Array.from({ length: depth }, () => OCCUPIED.repeat(width))
}

export function rotateFootprint(mask: readonly string[], facing: Facing): string[] {
  let rows = [...mask]
  for (let turn = 0; turn < facing / 90; turn++) rows = rotateClockwise(rows)
  return rows
}

function rotateClockwise(rows: readonly string[]): string[] {
  const depth = rows.length
  const width = rows[0]?.length ?? 0
  return Array.from({ length: width }, (_, row) =>
    Array.from({ length: depth }, (_, column) => rows[depth - 1 - column].charAt(row)).join(''),
  )
}

export function occupiedOffsets(mask: readonly string[]): [number, number][] {
  const offsets: [number, number][] = []
  mask.forEach((line, row) => {
    for (let column = 0; column < line.length; column++) {
      const symbol = line.charAt(column)
      if (symbol === OCCUPIED || symbol === WET) offsets.push([column, row])
    }
  })
  return offsets
}

export function wetOffsets(mask: readonly string[]): [number, number][] {
  const offsets: [number, number][] = []
  mask.forEach((line, row) => {
    for (let column = 0; column < line.length; column++) if (line.charAt(column) === WET) offsets.push([column, row])
  })
  return offsets
}

export function rotateCell(cell: readonly [number, number], size: readonly [number, number], facing: Facing): [number, number] {
  let [column, row] = cell
  let depth = size[1]
  let width = size[0]
  for (let turn = 0; turn < facing / 90; turn++) {
    const nextColumn = depth - 1 - row
    row = column
    column = nextColumn
    const swap = depth
    depth = width
    width = swap
  }
  return [column, row]
}

export function facingOut(facing: Facing): readonly [number, number] {
  return FACING_OUT[facing]
}

export function poolOffsets(width: number, depth: number, facing: Facing, rows: number): [number, number][] {
  const offsets: [number, number][] = []
  const [outX, outY] = facingOut(facing)
  for (let step = 1; step <= rows; step++) {
    if (outY !== 0) {
      const row = outY > 0 ? depth - 1 + step : -step
      for (let column = 0; column < width; column++) offsets.push([column, row])
    } else {
      const column = outX > 0 ? width - 1 + step : -step
      for (let row = 0; row < depth; row++) offsets.push([column, row])
    }
  }
  return offsets
}

export function landmarkTile(def: LandmarkDef): Tile | null {
  if (def.blocksShots && !def.blocksMovement) throw new Error(`landmark "${def.name}" blocks shots but not movement`)
  if (def.hides && def.blocksMovement) throw new Error(`landmark "${def.name}" hides the player but blocks movement`)
  if (def.hides) return Tile.Bush
  if (def.blocksShots) return Tile.Landmark
  if (def.blocksMovement) return Tile.LandmarkLow
  return null
}

export function placeLandmark(
  placement: LandmarkPlacementDef,
  area: number,
  top: number,
  size: { columns: number; rows: number },
): LandmarkPlacement {
  const def = LANDMARKS[placement.id]
  const facing = placement.facing ?? 0
  const mask = rotateFootprint(footprintOf(def), facing)
  const column = placement.at[0]
  const row = top + placement.at[1]
  const inside = (c: number, r: number) => c >= 0 && r >= 0 && c < size.columns && r < size.rows
  const cells: number[] = []
  for (const [dc, dr] of occupiedOffsets(mask)) {
    const c = column + dc
    const r = row + dr
    if (inside(c, r)) cells.push(r * size.columns + c)
  }
  const width = mask[0]?.length ?? 0
  const depth = mask.length
  const pool = poolOffsets(width, depth, facing, def.pool ?? 0).flatMap(([dc, dr]) =>
    inside(column + dc, row + dr) ? [(row + dr) * size.columns + column + dc] : [],
  )
  const water = def.deck
    ? [...cells]
    : [
        ...wetOffsets(mask).flatMap(([dc, dr]) => (inside(column + dc, row + dr) ? [(row + dr) * size.columns + column + dc] : [])),
        ...pool,
      ]
  let gate: LandmarkGate | null = null
  if (def.gate) {
    const [dc, dr] = rotateCell(def.gate, def.size, facing)
    const [outX, outY] = facingOut(facing)
    if (inside(column + dc, row + dr)) {
      gate = { index: (row + dr) * size.columns + column + dc, column: column + dc, row: row + dr, outX, outY }
    }
  }
  return {
    id: placement.id,
    area,
    column,
    row,
    width,
    depth,
    facing,
    variant: placement.variant ?? 1,
    mask,
    cells,
    water,
    pool,
    gate,
  }
}

export function stampLandmarks(grid: Grid, placements: readonly LandmarkPlacement[]): void {
  for (const placement of placements) {
    const def = LANDMARKS[placement.id]
    const tile = landmarkTile(def)
    if (tile === null) continue
    for (const index of placement.cells) setTile(grid, index, tile, def.height)
  }
}

export function landmarkProblems(
  base: Grid,
  markers: readonly Marker[],
  placements: readonly LandmarkPlacement[],
  areas: readonly AreaRows[],
): string[] {
  const problems: string[] = []
  const markerAt = new Map<number, string>()
  for (const marker of markers) {
    markerAt.set(Math.floor(marker.y) * base.columns + Math.floor(marker.x), MARKER_NAMES[marker.symbol] ?? marker.symbol)
  }
  const owner = new Map<number, LandmarkId>()
  for (const placement of placements) {
    const def = LANDMARKS[placement.id]
    const wet = new Set(wetOffsets(placement.mask).map(([dc, dr]) => (placement.row + dr) * base.columns + placement.column + dc))
    const label = `landmark ${placement.id} at ${placement.column},${placement.row}`
    const variants = def.variants ?? 1
    if (!Number.isInteger(placement.variant) || placement.variant < 1 || placement.variant > variants) {
      problems.push(`${label} asks for variant ${placement.variant}, it has ${variants}`)
    }
    const area = areas[placement.area]
    let outside = false
    for (const [dc, dr] of occupiedOffsets(placement.mask)) {
      const column = placement.column + dc
      const row = placement.row + dr
      if (column < 0 || column >= base.columns || row < area.top || row >= area.bottom) {
        outside = true
        continue
      }
      const index = row * base.columns + column
      const tile = base.tiles[index] as Tile
      if (wet.has(index)) {
        if (tile !== Tile.Water) problems.push(`${label} needs water at ${column},${row}`)
      } else if (tile !== Tile.Floor && tile !== Tile.Path) {
        problems.push(`${label} overlaps ${TILE_NAMES[tile] ?? `tile ${tile}`} at ${column},${row}`)
      }
      const marker = markerAt.get(index)
      if (marker && !def.deck) problems.push(`${label} overlaps ${marker} at ${column},${row}`)
      const other = owner.get(index)
      if (other) problems.push(`${label} overlaps landmark ${other} at ${column},${row}`)
      else owner.set(index, placement.id)
    }
    if (outside) problems.push(`${label} reaches outside area "${area.name}"`)
    const shallow = poolOffsets(placement.width, placement.depth, placement.facing, def.pool ?? 0)
    for (const [dc, dr] of shallow) {
      const column = placement.column + dc
      const row = placement.row + dr
      if (column < 0 || column >= base.columns || row < area.top || row >= area.bottom) {
        problems.push(`${label} has its pool outside area "${area.name}" at ${column},${row}`)
        continue
      }
      const tile = base.tiles[row * base.columns + column] as Tile
      if (tile !== Tile.Floor && tile !== Tile.Path) problems.push(`${label} has its pool on ${TILE_NAMES[tile] ?? `tile ${tile}`} at ${column},${row}`)
    }
  }
  for (const placement of placements) {
    const def = LANDMARKS[placement.id]
    const label = `landmark ${placement.id} at ${placement.column},${placement.row}`
    for (const [dc, dr] of poolOffsets(placement.width, placement.depth, placement.facing, def.pool ?? 0)) {
      const other = owner.get((placement.row + dr) * base.columns + placement.column + dc)
      if (other) problems.push(`${label} has its pool under landmark ${other} at ${placement.column + dc},${placement.row + dr}`)
    }
  }
  return problems
}
