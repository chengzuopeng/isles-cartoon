import { Tile, blocksMovement, tileAt, type Grid } from '../sim/grid'
import type { BuiltLevel, Conveyor } from '../sim/level'
import type { Vec2 } from '../sim/math'
import { wrapAngle } from './boss-motion'
import { cellHash } from './scene-models'
import { BELT_CARGO } from './themes'

export interface BeltStrip {
  dx: number
  dy: number
  x0: number
  x1: number
  y0: number
  y1: number
  cells: number[]
}

export type CargoEnd = 'machine' | 'open' | 'door'

export type CargoKind = 'bale' | 'crate'

export interface CargoClimb {
  from: number
  to: number
  height: number
}

export type TrackSegment =
  | { kind: 'line'; start: number; length: number; x: number; y: number; dx: number; dy: number }
  | { kind: 'arc'; start: number; length: number; cx: number; cy: number; radius: number; from: number; sweep: number }

export interface CargoTrack {
  segments: TrackSegment[]
  length: number
  start: CargoEnd
  end: CargoEnd
  enter: number
  leave: number
  climb: CargoClimb | null
}

export interface TrackPoint {
  x: number
  y: number
  angle: number
}

export interface CargoItem {
  kind: CargoKind
  x: number
  y: number
  height: number
  angle: number
  scale: number
}

export type CargoRule = typeof BELT_CARGO

export type DeckAt = (column: number, row: number) => number | null

const STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

export function normalBelts(level: BuiltLevel): Conveyor[] {
  const { columns } = level.grid
  return level.conveyors.filter((item) => level.areas[level.areaOfRow[Math.floor(item.index / columns)]]?.kind !== 'boss')
}

export function beltStrips(grid: Grid, belts: readonly Conveyor[]): BeltStrip[] {
  const { columns, rows } = grid
  const byCell = new Map(belts.map((item) => [item.index, item]))
  const seen = new Set<number>()
  const strips: BeltStrip[] = []
  for (const start of belts) {
    if (seen.has(start.index)) continue
    seen.add(start.index)
    const cells: number[] = []
    const queue = [start.index]
    while (queue.length > 0) {
      const index = queue.pop() as number
      cells.push(index)
      const column = index % columns
      const row = (index - column) / columns
      for (const [dc, dr] of STEPS) {
        const c = column + dc
        const r = row + dr
        if (c < 0 || c >= columns || r < 0 || r >= rows) continue
        const next = r * columns + c
        const item = byCell.get(next)
        if (!item || seen.has(next) || item.dx !== start.dx || item.dy !== start.dy) continue
        seen.add(next)
        queue.push(next)
      }
    }
    cells.sort((a, b) => a - b)
    const columnsOf = cells.map((cell) => cell % columns)
    const rowsOf = cells.map((cell) => Math.floor(cell / columns))
    strips.push({
      dx: start.dx,
      dy: start.dy,
      x0: Math.min(...columnsOf),
      x1: Math.max(...columnsOf),
      y0: Math.min(...rowsOf),
      y1: Math.max(...rowsOf),
      cells,
    })
  }
  return strips
}

function centerline(strip: BeltStrip): number {
  return strip.dx !== 0 ? (strip.y0 + strip.y1 + 1) / 2 : (strip.x0 + strip.x1 + 1) / 2
}

function entryPoint(strip: BeltStrip): Vec2 {
  const c = centerline(strip)
  if (strip.dx > 0) return { x: strip.x0, y: c }
  if (strip.dx < 0) return { x: strip.x1 + 1, y: c }
  if (strip.dy > 0) return { x: c, y: strip.y0 }
  return { x: c, y: strip.y1 + 1 }
}

function exitPoint(strip: BeltStrip): Vec2 {
  const c = centerline(strip)
  if (strip.dx > 0) return { x: strip.x1 + 1, y: c }
  if (strip.dx < 0) return { x: strip.x0, y: c }
  if (strip.dy > 0) return { x: c, y: strip.y1 + 1 }
  return { x: c, y: strip.y0 }
}

function across(strip: BeltStrip): [number, number] {
  return strip.dx !== 0 ? [strip.y0, strip.y1] : [strip.x0, strip.x1]
}

function rowBeyond(strip: BeltStrip, offset: number): number {
  if (strip.dx > 0) return strip.x1 + 1 + offset
  if (strip.dx < 0) return strip.x0 - 1 - offset
  if (strip.dy > 0) return strip.y1 + 1 + offset
  return strip.y0 - 1 - offset
}

function rowBehind(strip: BeltStrip): number {
  if (strip.dx > 0) return strip.x0 - 1
  if (strip.dx < 0) return strip.x1 + 1
  if (strip.dy > 0) return strip.y0 - 1
  return strip.y1 + 1
}

function cellsAt(strip: BeltStrip, along: number, from: number, to: number): [number, number][] {
  const cells: [number, number][] = []
  for (let a = from; a <= to; a++) cells.push(strip.dx !== 0 ? [along, a] : [a, along])
  return cells
}

function linkOf(strip: BeltStrip, strips: readonly BeltStrip[], owner: ReadonlyMap<number, number>, columns: number): number {
  const [a0, a1] = across(strip)
  const cells = cellsAt(strip, rowBeyond(strip, 0), a0, a1)
  const owners = new Set(cells.map(([column, row]) => owner.get(row * columns + column) ?? -1))
  if (owners.size !== 1) return -1
  const [target] = owners
  if (target < 0) return -1
  const next = strips[target]
  const turns = (strip.dx !== 0) !== (next.dx !== 0)
  return turns ? target : -1
}

function cornerOf(strip: BeltStrip, next: BeltStrip): Vec2 {
  return strip.dx !== 0 ? { x: centerline(next), y: centerline(strip) } : { x: centerline(strip), y: centerline(next) }
}

function unit(from: Vec2, to: Vec2): Vec2 {
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  return length > 0 ? { x: (to.x - from.x) / length, y: (to.y - from.y) / length } : { x: 0, y: 0 }
}

export function roundedTrack(points: readonly Vec2[], radius: number): { segments: TrackSegment[]; length: number } {
  const segments: TrackSegment[] = []
  let length = 0
  const line = (from: Vec2, to: Vec2) => {
    const size = Math.hypot(to.x - from.x, to.y - from.y)
    if (size <= 1e-9) return
    const direction = unit(from, to)
    segments.push({ kind: 'line', start: length, length: size, x: from.x, y: from.y, dx: direction.x, dy: direction.y })
    length += size
  }
  let cursor = points[0]
  for (let i = 1; i < points.length; i++) {
    const corner = points[i]
    const next = points[i + 1]
    if (!next) {
      line(cursor, corner)
      break
    }
    const incoming = unit(points[i - 1], corner)
    const outgoing = unit(corner, next)
    const cross = incoming.x * outgoing.y - incoming.y * outgoing.x
    const r = Math.min(radius, Math.hypot(corner.x - points[i - 1].x, corner.y - points[i - 1].y) / 2, Math.hypot(next.x - corner.x, next.y - corner.y) / 2)
    if (Math.abs(cross) < 1e-6 || r <= 1e-6) {
      line(cursor, corner)
      cursor = corner
      continue
    }
    const a = { x: corner.x - incoming.x * r, y: corner.y - incoming.y * r }
    const b = { x: corner.x + outgoing.x * r, y: corner.y + outgoing.y * r }
    const normal = cross > 0 ? { x: -incoming.y, y: incoming.x } : { x: incoming.y, y: -incoming.x }
    const center = { x: a.x + normal.x * r, y: a.y + normal.y * r }
    const from = Math.atan2(a.y - center.y, a.x - center.x)
    const sweep = wrapAngle(Math.atan2(b.y - center.y, b.x - center.x) - from)
    line(cursor, a)
    const size = Math.abs(sweep) * r
    segments.push({ kind: 'arc', start: length, length: size, cx: center.x, cy: center.y, radius: r, from, sweep })
    length += size
    cursor = b
  }
  return { segments, length }
}

export function trackPoint(track: Pick<CargoTrack, 'segments' | 'length'>, distance: number, out: TrackPoint = { x: 0, y: 0, angle: 0 }): TrackPoint {
  const s = Math.min(track.length, Math.max(0, distance))
  let segment = track.segments[track.segments.length - 1]
  for (const item of track.segments) {
    if (s <= item.start + item.length) {
      segment = item
      break
    }
  }
  if (!segment) {
    out.x = 0
    out.y = 0
    out.angle = 0
    return out
  }
  const local = Math.min(segment.length, Math.max(0, s - segment.start))
  if (segment.kind === 'line') {
    out.x = segment.x + segment.dx * local
    out.y = segment.y + segment.dy * local
    out.angle = Math.atan2(segment.dy, segment.dx)
    return out
  }
  const theta = segment.from + segment.sweep * (segment.length > 0 ? local / segment.length : 0)
  out.x = segment.cx + Math.cos(theta) * segment.radius
  out.y = segment.cy + Math.sin(theta) * segment.radius
  out.angle = theta + Math.sign(segment.sweep) * (Math.PI / 2)
  return out
}

function blocked(grid: Grid, column: number, row: number): boolean {
  return blocksMovement(tileAt(grid, column, row))
}

function allWalls(grid: Grid, cells: readonly [number, number][]): boolean {
  return cells.length > 0 && cells.every(([column, row]) => tileAt(grid, column, row) === Tile.Wall)
}

export function cargoTracks(level: BuiltLevel, deckAt: DeckAt = () => null, rule: CargoRule = BELT_CARGO): CargoTrack[] {
  const { grid } = level
  const strips = beltStrips(grid, normalBelts(level))
  const owner = new Map<number, number>()
  strips.forEach((strip, index) => {
    for (const cell of strip.cells) owner.set(cell, index)
  })
  const links = strips.map((strip) => linkOf(strip, strips, owner, grid.columns))
  const incoming = new Set(links.filter((target) => target >= 0))
  const tracks: CargoTrack[] = []
  strips.forEach((head, index) => {
    if (incoming.has(index)) return
    const chain = [index]
    for (let next = links[index]; next >= 0 && !chain.includes(next); next = links[next]) chain.push(next)
    const last = strips[chain[chain.length - 1]]
    const [h0, h1] = across(head)
    const machineStart = allWalls(grid, cellsAt(head, rowBehind(head), h0, h1))
    const entry = entryPoint(head)
    const points: Vec2[] = [machineStart ? { x: entry.x - head.dx * 0.5, y: entry.y - head.dy * 0.5 } : entry]
    for (let k = 1; k < chain.length; k++) points.push(cornerOf(strips[chain[k - 1]], strips[chain[k]]))
    const exit = exitPoint(last)
    points.push(exit)
    const [a0, a1] = across(last)
    let end: CargoEnd = 'open'
    let tail = 0
    let deck: { offset: number; height: number } | null = null
    if (allWalls(grid, cellsAt(last, rowBeyond(last, 0), a0, a1))) {
      end = 'machine'
      tail = 0.5
    } else {
      for (let offset = 0; offset < rule.tail; offset++) {
        const along = rowBeyond(last, offset)
        const cells = cellsAt(last, along, a0, a1)
        if (cells.some(([column, row]) => blocked(grid, column, row))) break
        if (!deck) {
          const heights = cells.map(([column, row]) => deckAt(column, row))
          if (heights.every((height): height is number => height !== null)) deck = { offset, height: Math.min(...heights) }
        }
        const sides = last.dx !== 0 ? [[along, a0 - 1], [along, a1 + 1]] : [[a0 - 1, along], [a1 + 1, along]]
        if (sides.every(([column, row]) => blocked(grid, column, row))) {
          end = 'door'
          tail = offset + 0.5
          break
        }
      }
    }
    if (end !== 'door') deck = null
    if (tail > 0) points.push({ x: exit.x + last.dx * tail, y: exit.y + last.dy * tail })
    const { segments, length } = roundedTrack(points, rule.corner)
    if (length <= 0) return
    const exitAt = length - tail
    const climb = deck && end === 'door' ? { from: exitAt + deck.offset, to: Math.max(exitAt + deck.offset, length - 0.5), height: deck.height } : null
    tracks.push({
      segments,
      length,
      start: machineStart ? 'machine' : 'open',
      end,
      enter: machineStart ? 0 : Math.min(rule.grow, length / 2),
      leave: end === 'machine' ? length : Math.max(length / 2, length - rule.grow),
      climb,
    })
  })
  return tracks
}

export function trackCapacity(track: CargoTrack, rule: CargoRule = BELT_CARGO): number {
  return Math.ceil((track.length + rule.jitter * 2) / rule.gap) + 1
}

function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

export function climbAt(track: CargoTrack, distance: number): number {
  const { climb } = track
  if (!climb) return 0
  if (distance <= climb.from) return 0
  if (distance >= climb.to || climb.to <= climb.from) return climb.height
  return (climb.height * (distance - climb.from)) / (climb.to - climb.from)
}

export function presence(track: CargoTrack, distance: number): number {
  const grow = track.enter > 0 ? smooth(distance / track.enter) : 1
  const shrink = track.leave < track.length ? smooth((track.length - distance) / (track.length - track.leave)) : 1
  return Math.min(grow, shrink)
}

export function cargoItems(track: CargoTrack, seed: number, time: number, speed: number, visit: (item: CargoItem) => void, rule: CargoRule = BELT_CARGO): void {
  const travel = Math.max(0, time) * speed
  const first = Math.ceil((travel - track.length - rule.jitter) / rule.gap)
  const last = Math.floor((travel + rule.jitter) / rule.gap)
  const point: TrackPoint = { x: 0, y: 0, angle: 0 }
  for (let k = first; k <= last; k++) {
    if (cellHash(seed, k, 11) < rule.empty) continue
    const distance = travel - k * rule.gap + (cellHash(seed, k, 12) * 2 - 1) * rule.jitter
    if (distance < 0 || distance > track.length) continue
    const shown = presence(track, distance)
    if (shown <= 0) continue
    trackPoint(track, distance, point)
    const lift = track.start === 'open' && distance < track.enter ? (1 - shown) * rule.drop : 0
    visit({
      kind: cellHash(seed, k, 13) < rule.bale ? 'bale' : 'crate',
      x: point.x,
      y: point.y,
      height: rule.surface + climbAt(track, distance) + lift,
      angle: point.angle + (cellHash(seed, k, 14) * 2 - 1) * rule.turn,
      scale: rule.scale * shown,
    })
  }
}
