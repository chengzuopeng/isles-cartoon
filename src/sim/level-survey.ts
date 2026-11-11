import { bodyHeightOf, eyeHeightOf, type TileKind } from '../data/heights'
import { LANDMARKS } from '../data/landmarks'
import type { GridPoint, LevelDef } from '../data/levels/types'
import { createDefaultTuning, type Tuning } from '../data/tuning'
import { lineClear } from './collision'
import { Tile, blocksMovement, blocksSight, canStep, cellFloor, cellTop, insideGrid, tileAt, tileKind, type Grid } from './grid'
import { buildLevel, climbableFrom, validateLevel, type BuiltLevel } from './level'
import { wakeChain } from './level-rules'
import type { Vec3 } from './math'

export const SURVEY = { rays: 72, reach: 120, routeStride: 2, cellHigh: 1, cellLow: 0.2 } as const

export interface SurveyOptions {
  via?: readonly GridPoint[]
  tuning?: Tuning
}

export interface SurveyArea {
  name: string
  top: number
  bottom: number
  kind: string
  theme: string
}

export interface SurveyEnemy {
  kind: string
  x: number
  y: number
  area: number
  idle: string
  route: { x: number; y: number }[]
}

export interface SurveyLandmark {
  id: string
  name: string
  column: number
  row: number
  width: number
  depth: number
  solid: boolean
  target: boolean
}

export interface SurveyRegion {
  column: number
  row: number
  width: number
  depth: number
}

export interface SurveyView {
  open: number
  visible: number
  seen: string[]
  enemies: { index: number; distance: number }[]
}

export interface SurveyStep {
  x: number
  y: number
  area: number
  enemies: number
  far: number
  reach: number
}

export interface LevelSurvey {
  id: string
  title: string
  columns: number
  rows: number
  tiles: TileKind[]
  floor: number[]
  top: number[]
  reach: number[]
  areas: SurveyArea[]
  start: { x: number; y: number }
  enemies: SurveyEnemy[]
  boss: { id: string; x: number; y: number } | null
  chests: { tier: string; x: number; y: number }[]
  supplies: { x: number; y: number }[]
  exits: [number, number][]
  landmarks: SurveyLandmark[]
  secrets: SurveyRegion[]
  pastures: SurveyRegion[]
  rushes: { points: { x: number; y: number }[]; left: number }[]
  summonPoints: { x: number; y: number }[]
  problems: string[]
  wakeMax: number
  spawnView: SurveyView
  route: [number, number][]
  profile: SurveyStep[]
}

export interface SurveyStats {
  columns: number
  rows: number
  open: number
  visible: number
  share: number
  enemies: number
  seen: number
  far: number
  route: number
  peak: number
  average: number
  reach: number
  wakeMax: number
  problems: string[]
}

function eyeAt(grid: Grid, x: number, y: number): Vec3 {
  return { x, y, z: cellFloor(grid, Math.floor(x), Math.floor(y)) + eyeHeightOf('player') }
}

function seesCell(grid: Grid, eye: Vec3, column: number, row: number): boolean {
  const floor = cellFloor(grid, column, row)
  const x = column + 0.5
  const y = row + 0.5
  return lineClear(grid, eye, { x, y, z: floor + SURVEY.cellHigh }, blocksSight) || lineClear(grid, eye, { x, y, z: floor + SURVEY.cellLow }, blocksSight)
}

function seesEnemy(grid: Grid, eye: Vec3, enemy: { kind: string; x: number; y: number }): boolean {
  const floor = cellFloor(grid, Math.floor(enemy.x), Math.floor(enemy.y))
  const tall = bodyHeightOf(enemy.kind)
  return lineClear(grid, eye, { x: enemy.x, y: enemy.y, z: floor + tall - 0.15 }, blocksSight) || lineClear(grid, eye, { x: enemy.x, y: enemy.y, z: floor + tall * 0.5 }, blocksSight)
}

function walkable(grid: Grid, column: number, row: number): boolean {
  return insideGrid(grid, column, row) && !blocksMovement(tileAt(grid, column, row))
}

function passable(grid: Grid, column: number, row: number): boolean {
  if (!insideGrid(grid, column, row)) return false
  const tile = tileAt(grid, column, row)
  return tile === Tile.GateClosed || !blocksMovement(tile)
}

function leg(grid: Grid, from: readonly [number, number], to: readonly [number, number]): [number, number][] {
  const { columns, rows } = grid
  const parent = new Int32Array(columns * rows).fill(-1)
  const first = from[1] * columns + from[0]
  const last = to[1] * columns + to[0]
  const queue = [first]
  parent[first] = first
  for (let head = 0; head < queue.length && parent[last] < 0; head++) {
    const cell = queue[head]
    const column = cell % columns
    const row = (cell - column) / columns
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nc = column + dc
      const nr = row + dr
      if (!passable(grid, nc, nr)) continue
      const next = nr * columns + nc
      if (parent[next] >= 0) continue
      if (walkable(grid, nc, nr) && walkable(grid, column, row) && !canStep(grid, column, row, nc, nr)) continue
      parent[next] = cell
      queue.push(next)
    }
  }
  const path: [number, number][] = []
  if (parent[last] < 0) return path
  for (let at = last; parent[at] !== at; at = parent[at]) path.push([(at % columns) + 0.5, Math.floor(at / columns) + 0.5])
  return path.reverse()
}

function openReach(grid: Grid, eye: Vec3): number {
  let total = 0
  for (let step = 0; step < SURVEY.rays; step++) {
    const angle = (step / SURVEY.rays) * Math.PI * 2
    let length = 0
    for (let distance = 1; distance <= SURVEY.reach; distance++) {
      const column = Math.floor(eye.x + Math.cos(angle) * distance)
      const row = Math.floor(eye.y + Math.sin(angle) * distance)
      if (!insideGrid(grid, column, row) || cellTop(grid, column, row) > eye.z) break
      length = distance
    }
    total += length
  }
  return total / SURVEY.rays
}

function viewFrom(level: BuiltLevel, reach: Uint8Array, x: number, y: number): SurveyView {
  const { grid } = level
  const eye = eyeAt(grid, x, y)
  const seen: string[] = []
  let open = 0
  let visible = 0
  for (let row = 0; row < grid.rows; row++) {
    let line = ''
    for (let column = 0; column < grid.columns; column++) {
      if (!walkable(grid, column, row) || reach[row * grid.columns + column] !== 1) {
        line += ' '
        continue
      }
      open++
      const ok = seesCell(grid, eye, column, row)
      if (ok) visible++
      line += ok ? '1' : '0'
    }
    seen.push(line)
  }
  const enemies = level.enemies.flatMap((enemy, index) => (seesEnemy(grid, eye, enemy) ? [{ index, distance: Math.hypot(enemy.x - x, enemy.y - y) }] : []))
  return { open, visible, seen, enemies }
}

export function surveyLevel(def: LevelDef, options: SurveyOptions = {}): LevelSurvey {
  const level = buildLevel(def)
  const { grid } = level
  const tuning = options.tuning ?? createDefaultTuning()
  const reach = climbableFrom(grid, level.playerStart)
  const start = level.playerStart
  const exits = level.exits.map((index): [number, number] => [index % grid.columns, Math.floor(index / grid.columns)])
  const goal: [number, number] = exits[0] ?? [Math.floor(level.boss?.x ?? start.x), Math.floor(level.boss?.y ?? start.y)]
  const stops: (readonly [number, number])[] = [[Math.floor(start.x), Math.floor(start.y)], ...(options.via ?? []), goal]
  const route: [number, number][] = [[start.x, start.y]]
  for (let index = 1; index < stops.length; index++) route.push(...leg(grid, stops[index - 1], stops[index]))
  const profile = route
    .filter((_, index) => index % SURVEY.routeStride === 0)
    .map(([x, y]): SurveyStep => {
      const eye = eyeAt(grid, x, y)
      const seen = level.enemies.filter((enemy) => seesEnemy(grid, eye, enemy))
      const far = seen.reduce((most, enemy) => Math.max(most, Math.hypot(enemy.x - x, enemy.y - y)), 0)
      return { x, y, area: level.areaOfRow[Math.floor(y)], enemies: seen.length, far, reach: openReach(grid, eye) }
    })
  const chains = level.enemies.map((enemy, index) => (enemy.idle === 'ambush' ? 1 : wakeChain(level, index, tuning).length))
  const region = (item: SurveyRegion): SurveyRegion => ({ column: item.column, row: item.row, width: item.width, depth: item.depth })
  return {
    id: def.id,
    title: def.title,
    columns: grid.columns,
    rows: grid.rows,
    tiles: Array.from(grid.tiles, (tile) => tileKind(tile as Tile)),
    floor: Array.from(grid.floor),
    top: Array.from(grid.top),
    reach: Array.from(reach),
    areas: level.areas.map((area) => ({ name: area.name, top: area.top, bottom: area.bottom, kind: area.kind, theme: area.theme })),
    start: { x: start.x, y: start.y },
    enemies: level.enemies.map((enemy) => ({
      kind: enemy.kind,
      x: enemy.x,
      y: enemy.y,
      area: enemy.area,
      idle: enemy.idle,
      route: enemy.route.map((point) => ({ x: point.x, y: point.y })),
    })),
    boss: level.boss ? { id: level.boss.id, x: level.boss.x, y: level.boss.y } : null,
    chests: level.chests.map((chest) => ({ tier: chest.tier, x: chest.x, y: chest.y })),
    supplies: level.supplies.map((supply) => ({ x: supply.x, y: supply.y })),
    exits,
    landmarks: level.landmarks.map((item) => {
      const data = LANDMARKS[item.id]
      return {
        id: item.id,
        name: data.name,
        column: item.column,
        row: item.row,
        width: item.width,
        depth: item.depth,
        solid: data.blocksMovement,
        target: data.breaks?.target ?? false,
      }
    }),
    secrets: level.secrets.map(region),
    pastures: level.pastures.map(region),
    rushes: level.rushes.map((rush) => ({ points: rush.points.map((point) => ({ x: point.x, y: point.y })), left: rush.left })),
    summonPoints: level.summonPoints.map((point) => ({ x: point.x, y: point.y })),
    problems: validateLevel(level),
    wakeMax: Math.max(0, ...chains),
    spawnView: viewFrom(level, reach, start.x, start.y),
    route,
    profile,
  }
}

export function surveyStats(survey: LevelSurvey): SurveyStats {
  const view = survey.spawnView
  const steps = Math.max(1, survey.profile.length)
  return {
    columns: survey.columns,
    rows: survey.rows,
    open: view.open,
    visible: view.visible,
    share: view.open > 0 ? view.visible / view.open : 0,
    enemies: survey.enemies.length,
    seen: view.enemies.length,
    far: view.enemies.reduce((most, item) => Math.max(most, item.distance), 0),
    route: Math.max(0, survey.route.length - 1),
    peak: survey.profile.reduce((most, step) => Math.max(most, step.enemies), 0),
    average: survey.profile.reduce((sum, step) => sum + step.enemies, 0) / steps,
    reach: survey.profile.reduce((sum, step) => sum + step.reach, 0) / steps,
    wakeMax: survey.wakeMax,
    problems: survey.problems,
  }
}
