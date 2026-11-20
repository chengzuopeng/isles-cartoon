import { BLADE } from '../data/blades'
import { getBoss, type BossSummon } from '../data/bosses'
import { JUMP_HEIGHT, STEP_HEIGHT } from '../data/heights'
import type { ClueId } from '../data/clues'
import type { AffixId } from '../data/elites'
import type { IdleMode } from '../data/enemies'
import { LANDMARKS, type LandmarkId } from '../data/landmarks'
import { regionContainsCell } from '../data/levels/types'
import type { AreaKind, AreaSceneryDef, BladeDef, GridPoint, LevelDef, RegionDef, StoryActorDef, Theme, WallStyle } from '../data/levels/types'
import type { ChestTier } from '../data/loot'
import type { PlayerWeaponId } from '../data/weapons'
import { HAY_THEMES, KEG } from '../data/props'
import { Tile, blocksMovement, cellFloor, parseRows, standHeight, tileAt, type Grid } from './grid'
import { landmarkProblems, placeLandmark, stampLandmarks, type LandmarkPlacement } from './landmarks'
import type { Vec2 } from './math'
import { distanceField } from './navigation'
import type { ChestPerch } from './types'
import type { MinionKind } from '../data/enemies'
import { firstPersonProblems } from './level-rules'

export interface AreaInfo {
  index: number
  name: string
  theme: Theme
  kind: AreaKind
  walls: WallStyle | null
  scenery?: AreaSceneryDef
  fog: boolean
  top: number
  bottom: number
  gates: number[]
}

export interface EnemyPlacement {
  kind: MinionKind
  x: number
  y: number
  area: number
  idle: IdleMode
  route: Vec2[]
  affixes: AffixId[]
}

export interface Conveyor {
  index: number
  dx: number
  dy: number
}

export interface ChestPlacement {
  tier: ChestTier
  x: number
  y: number
  area: number
  weapon: PlayerWeaponId | null
  perch: ChestPerch | null
}

export interface LampPlacement {
  landmark: number
  area: number
  x: number
  y: number
  clears: boolean
}

export interface RingPlacement {
  area: number
  x: number
  y: number
  radius: number
}

export interface RegionPlacement {
  area: number
  column: number
  row: number
  width: number
  depth: number
}

export interface SecretPlacement extends RegionPlacement {
  landmark: number | null
}

export interface CluePlacement {
  id: ClueId
  area: number
  at: Vec2 | null
}

export interface AlarmPlacement {
  area: number
  landmark: number
  post: Vec2
}

export interface RushPlacement {
  area: number
  points: Vec2[]
  enemies: BossSummon[]
  variants: BossSummon[][]
  left: number
  standing: number
}

export interface ReinforcePlacement {
  area: number
  points: Vec2[]
  enemies: BossSummon[]
  left: number
}

export type BladeAxis = 'x' | 'y'

export interface BladeLane extends RegionPlacement {
  axis: BladeAxis
  from: Vec2
  to: Vec2
  half: number
  reach: number
  speed: number
  rest: number
  warning: number
  delay: number
}

export interface SupplyPlacement {
  x: number
  y: number
  area: number
}

export interface BossPlacement {
  id: string
  x: number
  y: number
  area: number
}

export interface StoryActorPlacement extends Vec2 {
  area: number
  speaker: StoryActorDef['speaker']
  facing: StoryActorDef['facing']
}

export interface BuiltLevel {
  def: LevelDef
  grid: Grid
  areas: AreaInfo[]
  areaOfRow: Int16Array
  playerStart: Vec2
  enemies: EnemyPlacement[]
  boss: BossPlacement | null
  summonPoints: Vec2[]
  waveSpawns: Vec2[]
  chests: ChestPlacement[]
  supplies: SupplyPlacement[]
  conveyors: Conveyor[]
  exits: number[]
  landmarks: LandmarkPlacement[]
  actors: StoryActorPlacement[]
  landmarkAt: Int16Array
  pastures: RegionPlacement[]
  clues: CluePlacement[]
  secrets: SecretPlacement[]
  alarms: AlarmPlacement[]
  reinforcements: ReinforcePlacement[]
  rushes: RushPlacement[]
  kegs: number[]
  hay: number[]
  lamps: LampPlacement[]
  waypoints: (Vec2 | null)[]
  ring: RingPlacement | null
  blades: BladeLane[]
}

const ENEMY_SYMBOLS: Readonly<Record<string, MinionKind | undefined>> = {
  m: 'grunt',
  r: 'gunner',
  b: 'bomber',
  t: 'turret',
  h: 'shield',
  g: 'thrower',
}

const CONVEYOR_SYMBOLS: Readonly<Record<string, Vec2 | undefined>> = {
  '<': { x: -1, y: 0 },
  '>': { x: 1, y: 0 },
  '^': { x: 0, y: -1 },
  v: { x: 0, y: 1 },
}

const PERCH_REACH = 2.5
const RING_SAMPLES = 72

const CHEST_SYMBOLS: Readonly<Record<string, ChestTier | undefined>> = {
  $: 'normal',
  W: 'weapon',
  R: 'rare',
}

interface StackedAreas {
  lines: string[]
  heights: string[]
  spans: { area: number; top: number; bottom: number }[]
}

function stackAreas(def: LevelDef): StackedAreas {
  const width = def.areas[0]?.rows[0]?.length ?? 0
  for (const area of def.areas) {
    area.rows.forEach((row, index) => {
      if (row.length !== width) {
        throw new Error(`area "${area.name}" row ${index + 1} has ${row.length} columns, expected ${width}`)
      }
    })
    if (!area.heights) continue
    if (area.heights.length !== area.rows.length) {
      throw new Error(`area "${area.name}" has ${area.heights.length} height rows, expected ${area.rows.length}`)
    }
    area.heights.forEach((row, index) => {
      if (row.length !== width) {
        throw new Error(`area "${area.name}" height row ${index + 1} has ${row.length} columns, expected ${width}`)
      }
      if (!/^[0-9]*$/.test(row)) throw new Error(`area "${area.name}" height row ${index + 1} has a symbol other than 0-9`)
    })
  }

  const lines: string[] = []
  const heights: string[] = []
  const spans: { area: number; top: number; bottom: number }[] = []
  for (let index = def.areas.length - 1; index >= 0; index--) {
    const area = def.areas[index]
    const top = lines.length
    lines.push(...area.rows)
    heights.push(...(area.heights ?? area.rows.map(() => '0'.repeat(width))))
    spans.push({ area: index, top, bottom: lines.length })
  }
  return { lines, heights, spans }
}

export function buildLevel(def: LevelDef): BuiltLevel {
  const { lines, heights, spans } = stackAreas(def)
  const { grid, markers } = parseRows(lines, heights)
  const areaOfRow = new Int16Array(grid.rows)
  const areas: AreaInfo[] = def.areas.map((area, index) => ({
    index,
    name: area.name,
    theme: area.theme,
    kind: area.kind ?? 'normal',
    walls: area.walls ?? null,
    scenery: area.scenery,
    fog: area.fog !== undefined,
    top: 0,
    bottom: 0,
    gates: [],
  }))
  for (const span of spans) {
    const area = areas[span.area]
    area.top = span.top
    area.bottom = span.bottom
    areaOfRow.fill(span.area, span.top, span.bottom)
    for (let index = span.top * grid.columns; index < span.bottom * grid.columns; index++) {
      if (grid.tiles[index] === Tile.Gate) area.gates.push(index)
    }
  }

  const landmarks = def.areas.flatMap((area, index) =>
    (area.landmarks ?? []).map((placement) => placeLandmark(placement, index, areas[index].top, grid)),
  )
  const actors = def.areas.flatMap((area, index) =>
    (area.actors ?? []).map(({ at, speaker, facing }) => ({
      area: index,
      speaker,
      facing,
      x: at[0] + 0.5,
      y: areas[index].top + at[1] + 0.5,
    })),
  )
  stampLandmarks(grid, landmarks)
  const landmarkAt = new Int16Array(grid.columns * grid.rows).fill(-1)
  landmarks.forEach((placement, index) => {
    for (const cell of placement.cells) landmarkAt[cell] = index
  })

  let playerStart: Vec2 | null = null
  let boss: BossPlacement | null = null
  const enemies: EnemyPlacement[] = []
  const summonPoints: Vec2[] = []
  const waveSpawns: Vec2[] = []
  const chests: ChestPlacement[] = []
  const supplies: SupplyPlacement[] = []
  const conveyors: Conveyor[] = []
  for (const marker of markers) {
    const area = areaOfRow[Math.floor(marker.y)]
    const kind = ENEMY_SYMBOLS[marker.symbol]
    const tier = CHEST_SYMBOLS[marker.symbol]
    const push = CONVEYOR_SYMBOLS[marker.symbol]
    const point = { x: marker.x, y: marker.y }
    if (kind) enemies.push({ kind, ...point, area, idle: def.areas[area].idle ?? 'guard', route: [], affixes: [] })
    else if (push) conveyors.push({ index: Math.floor(marker.y) * grid.columns + Math.floor(marker.x), dx: push.x, dy: push.y })
    else if (tier) chests.push({ tier, ...point, area, weapon: null, perch: null })
    else if (marker.symbol === '+') supplies.push({ ...point, area })
    else if (marker.symbol === 'P') playerStart = point
    else if (marker.symbol === 'S') summonPoints.push(point)
    else if (marker.symbol === 'E') waveSpawns.push(point)
    else if (marker.symbol === 'B') {
      if (!def.bossId) throw new Error(`level ${def.id} has a boss marker but no bossId`)
      boss = { id: def.bossId, ...point, area }
    }
  }
  if (!playerStart) throw new Error(`level ${def.id} has no player start`)

  const exits: number[] = []
  grid.tiles.forEach((tile, index) => {
    if (tile === Tile.Exit) exits.push(index)
  })

  const pastures: RegionPlacement[] = []
  const clues: CluePlacement[] = []
  const secrets: SecretPlacement[] = []
  const alarms: AlarmPlacement[] = []
  const reinforcements: ReinforcePlacement[] = []
  const rushes: RushPlacement[] = []
  const lamps: LampPlacement[] = []
  const blades: BladeLane[] = []
  landmarks.forEach((placement, index) => {
    if (!LANDMARKS[placement.id].lamp) return
    lamps.push({ landmark: index, area: placement.area, x: placement.column + placement.width / 2, y: placement.row + placement.depth / 2, clears: false })
  })
  def.areas.forEach((area, index) => {
    const top = areas[index].top
    const local = (point: GridPoint): Vec2 => ({ x: point[0] + 0.5, y: top + point[1] + 0.5 })
    for (const patrol of area.patrols ?? []) {
      const enemy = nearestPlacement(enemies, index, local(patrol.from))
      if (!enemy) throw new Error(`area "${area.name}" patrol starts where there is no enemy`)
      enemy.route = [{ x: enemy.x, y: enemy.y }, ...patrol.points.map(local)]
      enemy.idle = 'patrol'
    }
    for (const elite of area.elites ?? []) {
      const enemy = nearestPlacement(enemies, index, local(elite.at))
      if (!enemy) throw new Error(`area "${area.name}" elite marks a spot with no enemy`)
      enemy.affixes = [...elite.affixes]
    }
    for (const spot of area.ambush ?? []) {
      const enemy = nearestPlacement(enemies, index, local(spot))
      if (!enemy) throw new Error(`area "${area.name}" ambush marks a spot with no enemy`)
      enemy.idle = 'ambush'
    }
    for (const spot of area.wander ?? []) {
      const enemy = nearestPlacement(enemies, index, local(spot))
      if (!enemy) throw new Error(`area "${area.name}" wander marks a spot with no enemy`)
      enemy.idle = 'wander'
    }
    for (const loot of area.loot ?? []) {
      const spot = local(loot.at)
      const chest = chests.find((item) => item.tier !== 'normal' && item.x === spot.x && item.y === spot.y)
      if (!chest) throw new Error(`area "${area.name}" loot points at ${loot.at.join(',')} where there is no weapon chest or rare chest`)
      chest.weapon = loot.weapon
    }
    for (const perch of area.perches ?? []) {
      const spot = local(perch.at)
      const chest = chests.find((item) => item.x === spot.x && item.y === spot.y)
      if (!chest) throw new Error(`area "${area.name}" perch points at ${perch.at.join(',')} where there is no chest`)
      const landmark = landmarkIn(landmarks, index, perch.on)
      const rest = LANDMARKS[perch.on].perch
      if (landmark === null || !rest) throw new Error(`area "${area.name}" perches a chest on ${perch.on}, which is not in the area or has no top`)
      chest.perch = { landmark, ...perchSpot(landmarks[landmark], rest), height: rest.height }
    }
    if (area.pasture) pastures.push(regionOf(area.pasture, index, top))
    for (const clue of area.clues ?? []) clues.push({ id: clue.id, area: index, at: 'at' in clue ? local(clue.at) : null })
    for (const secret of area.secrets ?? []) {
      const door = secret.door ? landmarkIn(landmarks, index, secret.door) : null
      if (secret.door && door === null) throw new Error(`area "${area.name}" secret opens ${secret.door}, which is not in the area`)
      secrets.push({ ...regionOf(secret, index, top), landmark: door })
    }
    if (area.alarm) {
      const source = landmarkIn(landmarks, index, area.alarm.landmark)
      if (source === null) throw new Error(`area "${area.name}" rings ${area.alarm.landmark}, which is not in the area`)
      alarms.push({ area: index, landmark: source, post: local(area.alarm.post) })
    }
    if (area.reinforce) {
      reinforcements.push({
        area: index,
        points: area.reinforce.at.map(local),
        enemies: area.reinforce.enemies.map((squad) => ({ ...squad })),
        left: area.reinforce.left,
      })
    }
    for (const rush of area.rushes ?? []) {
      rushes.push({
        area: index,
        points: rush.at.map(local),
        enemies: rush.enemies.map((squad) => ({ ...squad })),
        variants: [rush.enemies, ...(rush.variants ?? [])].map((recipe) => recipe.map((squad) => ({ ...squad }))),
        left: rush.left,
        standing: enemies.filter((enemy) => enemy.area === index).length,
      })
    }
    for (const blade of area.blades ?? []) blades.push(laneOf(blade, index, top, area.name))
    const sweep = area.fog?.clearedBy
    if (sweep) {
      const spot = local(sweep)
      const lamp = lamps.find((item) => item.area === index && Math.floor(item.x) === Math.floor(spot.x) && Math.floor(item.y) === Math.floor(spot.y))
      if (!lamp) throw new Error(`area "${area.name}" clears its fog from ${sweep.join(',')} where there is no fog lamp`)
      lamp.clears = true
    }
  })

  return {
    def,
    grid,
    areas,
    areaOfRow,
    playerStart,
    enemies,
    boss,
    summonPoints,
    waveSpawns,
    chests,
    supplies,
    conveyors,
    exits,
    landmarks,
    actors,
    landmarkAt,
    pastures,
    clues,
    secrets,
    alarms,
    reinforcements,
    rushes,
    kegs: kegCells(lines, grid.columns),
    hay: hayCells(grid, areaOfRow, areas),
    lamps,
    waypoints: waypointsOf(grid, areas, exits),
    ring: ringOf(def, grid, areas, boss),
    blades,
  }
}

function laneOf(blade: BladeDef, area: number, top: number, name: string): BladeLane {
  const region = regionOf(blade, area, top)
  if (region.width === region.depth) throw new Error(`area "${name}" has a blade lane that is as wide as it is long`)
  const axis: BladeAxis = region.width > region.depth ? 'x' : 'y'
  const reach = BLADE.length / 2
  const rest = blade.rest ?? BLADE.rest
  const startsLow = axis === 'x' ? blade.from[0] <= blade.to[0] : blade.from[1] <= blade.to[1]
  const low = axis === 'x' ? region.column + reach : region.row + reach
  const high = axis === 'x' ? region.column + region.width - reach : region.row + region.depth - reach
  const middle = axis === 'x' ? region.row + region.depth / 2 : region.column + region.width / 2
  const point = (along: number): Vec2 => (axis === 'x' ? { x: along, y: middle } : { x: middle, y: along })
  return {
    ...region,
    axis,
    from: point(startsLow ? low : high),
    to: point(startsLow ? high : low),
    half: (axis === 'x' ? region.depth : region.width) / 2,
    reach,
    speed: blade.speed ?? BLADE.speed,
    rest,
    warning: Math.min(BLADE.warning, rest),
    delay: blade.delay ?? BLADE.delay,
  }
}

function perchSpot(placement: LandmarkPlacement, rest: { x: number; y: number }): Vec2 {
  let x = rest.x
  let y = rest.y
  for (let turn = 0; turn < placement.facing / 90; turn++) {
    const swap = x
    x = -y
    y = swap
  }
  return { x: placement.column + placement.width / 2 + x, y: placement.row + placement.depth / 2 + y }
}

function waypointsOf(grid: Grid, areas: readonly AreaInfo[], exits: readonly number[]): (Vec2 | null)[] {
  if (exits.length === 0) return areas.map(() => null)
  const field = distanceField(grid, [...exits])
  return areas.map((area) => {
    if (area.top === 0) {
      const own = exits.filter((index) => Math.floor(index / grid.columns) >= area.top && Math.floor(index / grid.columns) < area.bottom)
      if (own.length === 0) return null
      const x = own.reduce((sum, index) => sum + (index % grid.columns) + 0.5, 0) / own.length
      const y = own.reduce((sum, index) => sum + Math.floor(index / grid.columns) + 0.5, 0) / own.length
      return { x, y }
    }
    const row = area.top
    let best: { from: number; to: number; score: number } | null = null
    let start = -1
    for (let column = 0; column <= grid.columns; column++) {
      const tile = tileAt(grid, column, row)
      const open = column < grid.columns && !blocksMovement(tile)
      if (open && start < 0) start = column
      if (open || start < 0) continue
      let score = Infinity
      for (let cell = start; cell < column; cell++) score = Math.min(score, field[row * grid.columns + cell])
      if (Number.isFinite(score) && (!best || score < best.score)) best = { from: start, to: column - 1, score }
      start = -1
    }
    return best ? { x: (best.from + best.to + 1) / 2, y: row + 0.5 } : null
  })
}

function ringOf(def: LevelDef, grid: Grid, areas: readonly AreaInfo[], boss: BossPlacement | null): RingPlacement | null {
  if (!def.bossId || !boss || !getBoss(def.bossId).tread) return null
  const area = areas[boss.area]
  const cells: Vec2[] = []
  for (let row = area.top; row < area.bottom; row++) {
    for (let column = 0; column < grid.columns; column++) {
      if (tileAt(grid, column, row) === Tile.Path) cells.push({ x: column + 0.5, y: row + 0.5 })
    }
  }
  if (cells.length === 0) return null
  const x = cells.reduce((sum, cell) => sum + cell.x, 0) / cells.length
  const y = cells.reduce((sum, cell) => sum + cell.y, 0) / cells.length
  const radius = cells.reduce((sum, cell) => sum + Math.hypot(cell.x - x, cell.y - y), 0) / cells.length
  return { area: boss.area, x, y, radius }
}

function regionOf(region: RegionDef, area: number, top: number): RegionPlacement {
  const column = Math.min(region.from[0], region.to[0])
  const row = top + Math.min(region.from[1], region.to[1])
  return {
    area,
    column,
    row,
    width: Math.abs(region.to[0] - region.from[0]) + 1,
    depth: Math.abs(region.to[1] - region.from[1]) + 1,
  }
}

function landmarkIn(landmarks: readonly LandmarkPlacement[], area: number, id: LandmarkId): number | null {
  const index = landmarks.findIndex((placement) => placement.area === area && placement.id === id)
  return index >= 0 ? index : null
}

export function regionCells(region: RegionPlacement, columns: number): number[] {
  const cells: number[] = []
  for (let row = region.row; row < region.row + region.depth; row++) {
    for (let column = region.column; column < region.column + region.width; column++) cells.push(row * columns + column)
  }
  return cells
}

export function insideRegion(region: RegionPlacement, x: number, y: number): boolean {
  return x >= region.column && x < region.column + region.width && y >= region.row && y < region.row + region.depth
}

function nearestPlacement(enemies: EnemyPlacement[], area: number, point: Vec2): EnemyPlacement | null {
  let best: EnemyPlacement | null = null
  let bestDistance = 1.5
  for (const enemy of enemies) {
    if (enemy.area !== area) continue
    const distance = Math.hypot(enemy.x - point.x, enemy.y - point.y)
    if (distance < bestDistance) {
      best = enemy
      bestDistance = distance
    }
  }
  return best
}

function kegCells(lines: readonly string[], columns: number): number[] {
  const cells: number[] = []
  lines.forEach((line, row) => {
    for (let column = 0; column < line.length; column++) if (line.charAt(column) === KEG.symbol) cells.push(row * columns + column)
  })
  return cells
}

function hayCells(grid: Grid, areaOfRow: Int16Array, areas: readonly AreaInfo[]): number[] {
  const cells: number[] = []
  grid.tiles.forEach((tile, index) => {
    if (tile !== Tile.Rock) return
    const row = Math.floor(index / grid.columns)
    const area = areas[areaOfRow[row]]
    const cover = area.scenery?.covers?.find((region) => regionContainsCell(region, index % grid.columns, row - area.top))
    if (cover ? cover.style === 'bales' || cover.style === 'sacks' : HAY_THEMES.includes(area.theme)) cells.push(index)
  })
  return cells
}

function kegProblems(level: BuiltLevel): string[] {
  const { grid } = level
  const problems: string[] = []
  const solid = (column: number, row: number) => blocksMovement(tileAt(grid, column, row))
  for (const index of level.kegs) {
    const column = index % grid.columns
    const row = (index - column) / grid.columns
    if (Math.hypot(column + 0.5 - level.playerStart.x, row + 0.5 - level.playerStart.y) < KEG.startClear) problems.push(`keg at ${column},${row} is within ${KEG.startClear} m of the start`)
    if ((solid(column - 1, row) && solid(column + 1, row)) || (solid(column, row - 1) && solid(column, row + 1))) problems.push(`keg at ${column},${row} plugs a one-cell gap`)
  }
  return problems
}

export function validateLevel(level: BuiltLevel): string[] {
  const problems: string[] = []
  const { def, grid } = level
  problems.push(...kegProblems(level))
  if (def.firstPerson) problems.push(...firstPersonProblems(level))
  if (level.landmarks.length > 0) {
    const base = parseRows(stackAreas(def).lines)
    problems.push(...landmarkProblems(base.grid, base.markers, level.landmarks, level.areas))
  }
  if (!def.waves && level.exits.length === 0) problems.push('level has no exit')
  if (def.bossId && !level.boss) problems.push('level names a boss but has no boss marker')
  for (const actor of level.actors) {
    const area = level.areas[actor.area]
    const column = Math.floor(actor.x)
    const row = Math.floor(actor.y)
    if (column < 0 || column >= grid.columns || row < area.top || row >= area.bottom || blocksMovement(tileAt(grid, column, row))) {
      problems.push(`actor "${actor.speaker}" at ${column},${row} must stand on open ground in "${area.name}"`)
    }
  }

  for (const area of level.areas) {
    if (area.kind === 'normal') continue
    if (area.gates.length === 0) problems.push(`area "${area.name}" needs gates`)
    for (const row of area.kind === 'destroy' ? [area.top] : [area.top, area.bottom - 1]) {
      for (let column = 0; column < grid.columns; column++) {
        const tile = tileAt(grid, column, row)
        if (!blocksMovement(tile) && tile !== Tile.Gate) {
          problems.push(`area "${area.name}" boundary row ${row} is open at column ${column}`)
        }
      }
    }
    if (area.kind === 'lock' && !level.enemies.some((enemy) => enemy.area === area.index)) {
      problems.push(`lock area "${area.name}" has no enemies`)
    }
    if (area.kind === 'boss' && level.boss?.area !== area.index) {
      problems.push(`boss area "${area.name}" has no boss`)
    }
    if (area.kind === 'destroy' && !level.landmarks.some((item) => item.area === area.index && LANDMARKS[item.id].breaks?.target)) {
      problems.push(`destroy area "${area.name}" has no targets`)
    }
    if (area.kind === 'destroy' && area.gates.some((gate) => Math.floor(gate / grid.columns) !== area.top)) {
      problems.push(`destroy area "${area.name}" has a gate below its north edge`)
    }
  }

  const reachable = reachableFrom(grid, level.playerStart, true)
  const climbable = climbableFrom(grid, level.playerStart)
  const secretCell = (cell: number) =>
    level.secrets.some((secret) => insideRegion(secret, (cell % grid.columns) + 0.5, Math.floor(cell / grid.columns) + 0.5))
  const findable = (cell: number) => reachable[cell] === 1 || (climbable[cell] === 1 && secretCell(cell))
  if (!def.waves && !level.exits.some((index) => reachable[index] === 1)) problems.push('exit is unreachable')
  for (const enemy of level.enemies) {
    if (enemy.kind === 'turret') continue
    const column = Math.floor(enemy.x)
    const row = Math.floor(enemy.y)
    if (reachable[row * grid.columns + column] !== 1) problems.push(`${enemy.kind} at ${column},${row} is unreachable`)
  }
  for (const enemy of level.enemies) {
    for (const point of enemy.route) {
      if (reachable[Math.floor(point.y) * grid.columns + Math.floor(point.x)] !== 1) {
        problems.push(`patrol point ${Math.floor(point.x)},${Math.floor(point.y)} is unreachable`)
      }
    }
  }
  for (const item of [...level.chests, ...level.supplies]) {
    const column = Math.floor(item.x)
    const row = Math.floor(item.y)
    const label = 'tier' in item ? `${item.tier} chest` : 'supply point'
    if (!findable(row * grid.columns + column)) problems.push(`${label} at ${column},${row} is unreachable`)
  }
  problems.push(...penProblems(level, reachable))
  for (const clue of level.clues) {
    if (!clue.at) continue
    const column = Math.floor(clue.at.x)
    const row = Math.floor(clue.at.y)
    if (!findable(row * grid.columns + column)) problems.push(`clue ${clue.id} at ${column},${row} is unreachable`)
  }
  if (level.clues.some((clue) => !clue.at && !level.landmarks.some((item) => item.area === clue.area && LANDMARKS[item.id].breaks?.target))) {
    problems.push('a clue waits for a target in an area without targets')
  }
  for (const alarm of level.alarms) {
    const column = Math.floor(alarm.post.x)
    const row = Math.floor(alarm.post.y)
    if (level.areaOfRow[row] !== alarm.area) problems.push(`alarm post at ${column},${row} is outside its area`)
    if (reachable[row * grid.columns + column] !== 1) problems.push(`alarm post at ${column},${row} is unreachable`)
  }
  for (const squad of level.reinforcements) {
    const area = level.areas[squad.area]
    if (area.kind !== 'lock') problems.push(`area "${area.name}" calls reinforcements but is not a lock fight`)
    if (level.alarms.length === 0) problems.push(`area "${area.name}" calls reinforcements but the level has no alarm`)
    if (squad.points.length === 0) problems.push(`area "${area.name}" calls reinforcements without spawn points`)
    for (const point of squad.points) {
      const column = Math.floor(point.x)
      const row = Math.floor(point.y)
      if (level.areaOfRow[row] !== squad.area) problems.push(`reinforcement point at ${column},${row} is outside area "${area.name}"`)
      if (reachable[row * grid.columns + column] !== 1) problems.push(`reinforcement point at ${column},${row} is unreachable`)
    }
  }
  for (const rush of level.rushes) {
    const area = level.areas[rush.area]
    if (rush.points.length === 0) problems.push(`area "${area.name}" has a rush without spawn points`)
    if (rush.enemies.every((squad) => squad.count <= 0)) problems.push(`area "${area.name}" has a rush without enemies`)
    for (const point of rush.points) {
      const column = Math.floor(point.x)
      const row = Math.floor(point.y)
      if (level.areaOfRow[row] !== rush.area) problems.push(`rush point at ${column},${row} is outside area "${area.name}"`)
      if (reachable[row * grid.columns + column] !== 1) problems.push(`rush point at ${column},${row} is unreachable`)
    }
  }
  for (const secret of level.secrets) {
    const area = level.areas[secret.area]
    if (secret.row < area.top || secret.row + secret.depth > area.bottom) problems.push(`secret at ${secret.column},${secret.row} reaches outside area "${area.name}"`)
    if (!regionCells(secret, grid.columns).some((cell) => reachable[cell] === 1 || climbable[cell] === 1)) {
      problems.push(`secret at ${secret.column},${secret.row} is unreachable`)
    }
  }
  problems.push(...lampProblems(level, reachable), ...perchProblems(level), ...ringProblems(level), ...bladeProblems(level))
  return problems
}

function bladeProblems(level: BuiltLevel): string[] {
  const problems: string[] = []
  const { grid } = level
  const placed = [
    { label: 'player start', x: level.playerStart.x, y: level.playerStart.y },
    ...level.enemies.map((enemy) => ({ label: enemy.kind, x: enemy.x, y: enemy.y })),
    ...level.chests.map((chest) => ({ label: `${chest.tier} chest`, x: chest.x, y: chest.y })),
    ...level.supplies.map((supply) => ({ label: 'supply point', x: supply.x, y: supply.y })),
  ]
  for (const lane of level.blades) {
    const area = level.areas[lane.area]
    const label = `blade lane at ${lane.column},${lane.row}`
    if (lane.row < area.top || lane.row + lane.depth > area.bottom) problems.push(`${label} reaches outside area "${area.name}"`)
    for (const cell of regionCells(lane, grid.columns)) {
      const column = cell % grid.columns
      const row = (cell - column) / grid.columns
      if (blocksMovement(tileAt(grid, column, row)) || level.landmarkAt[cell] >= 0) problems.push(`${label} is blocked at ${column},${row}`)
    }
    for (const item of placed) {
      if (insideRegion(lane, item.x, item.y)) problems.push(`${label} runs over the ${item.label} at ${Math.floor(item.x)},${Math.floor(item.y)}`)
    }
    for (const other of level.blades) {
      if (other === lane) continue
      const overlap = lane.column < other.column + other.width && other.column < lane.column + lane.width && lane.row < other.row + other.depth && other.row < lane.row + lane.depth
      if (overlap) problems.push(`${label} crosses another blade lane`)
    }
  }
  return [...new Set(problems)]
}

function besideCells(grid: Grid, cells: readonly number[]): number[] {
  const own = new Set(cells)
  const found = new Set<number>()
  for (const cell of cells) {
    const column = cell % grid.columns
    const row = (cell - column) / grid.columns
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const next = (row + dr) * grid.columns + column + dc
      if (column + dc < 0 || column + dc >= grid.columns || row + dr < 0 || row + dr >= grid.rows || own.has(next)) continue
      found.add(next)
    }
  }
  return [...found]
}

function lampProblems(level: BuiltLevel, reachable: Uint8Array): string[] {
  const problems: string[] = []
  for (const lamp of level.lamps) {
    const placement = level.landmarks[lamp.landmark]
    if (!level.areas[lamp.area].fog) problems.push(`fog lamp at ${placement.column},${placement.row} stands in an area without fog`)
    if (!besideCells(level.grid, placement.cells).some((cell) => reachable[cell] === 1)) {
      problems.push(`fog lamp at ${placement.column},${placement.row} cannot be reached to light it`)
    }
  }
  return problems
}

function perchProblems(level: BuiltLevel): string[] {
  const problems: string[] = []
  for (const chest of level.chests) {
    const perch = chest.perch
    if (!perch) continue
    const placement = level.landmarks[perch.landmark]
    const cell = Math.floor(chest.y) * level.grid.columns + Math.floor(chest.x)
    if (!besideCells(level.grid, placement.cells).includes(cell)) {
      problems.push(`${chest.tier} chest at ${Math.floor(chest.x)},${Math.floor(chest.y)} is not beside ${placement.id}, so its ladder does not reach the top`)
    }
    if (Math.hypot(perch.x - chest.x, perch.y - chest.y) > PERCH_REACH) {
      problems.push(`${chest.tier} chest at ${Math.floor(chest.x)},${Math.floor(chest.y)} is too far from the top of ${placement.id}`)
    }
  }
  return problems
}

function ringProblems(level: BuiltLevel): string[] {
  if (!level.boss || !level.def.bossId) return []
  const tread = getBoss(level.def.bossId).tread
  if (!tread) return []
  const ring = level.ring
  if (!ring) return ['the boss drives along a ring road, but its area has no road']
  const problems: string[] = []
  const clearance = getBoss(level.def.bossId).radius
  for (let step = 0; step < RING_SAMPLES; step++) {
    const angle = (step / RING_SAMPLES) * Math.PI * 2
    const x = ring.x + Math.cos(angle) * ring.radius
    const y = ring.y + Math.sin(angle) * ring.radius
    for (let row = Math.floor(y - clearance); row <= Math.floor(y + clearance); row++) {
      for (let column = Math.floor(x - clearance); column <= Math.floor(x + clearance); column++) {
        if (!blocksMovement(tileAt(level.grid, column, row))) continue
        const dx = x - Math.max(column, Math.min(x, column + 1))
        const dy = y - Math.max(row, Math.min(y, row + 1))
        if (Math.hypot(dx, dy) < clearance) problems.push(`the ring road is blocked at ${column},${row}`)
      }
    }
  }
  return [...new Set(problems)]
}

function penProblems(level: BuiltLevel, reachable: Uint8Array): string[] {
  const problems: string[] = []
  const { grid } = level
  for (const placement of level.landmarks) {
    const gate = placement.gate
    if (!gate) continue
    const label = `landmark ${placement.id} at ${placement.column},${placement.row}`
    const front = (gate.row + gate.outY) * grid.columns + gate.column + gate.outX
    if (reachable[front] !== 1) problems.push(`${label} has an unreachable doorway`)
    const pasture = level.pastures.find((item) => item.area === placement.area)
    if (!pasture) problems.push(`${label} has no pasture in its area`)
  }
  for (const pasture of level.pastures) {
    const area = level.areas[pasture.area]
    if (pasture.row < area.top || pasture.row + pasture.depth > area.bottom) problems.push(`pasture in area "${area.name}" reaches outside the area`)
    if (!regionCells(pasture, grid.columns).some((cell) => reachable[cell] === 1)) problems.push(`pasture in area "${area.name}" is unreachable`)
  }
  return problems
}

const ORTHOGONAL = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const

export function reachableFrom(grid: Grid, start: Vec2, breakable = false): Uint8Array {
  return floodFrom(grid, start, (column, row, nc, nr) => {
    const tile = tileAt(grid, nc, nr)
    if (blocksMovement(tile) && !(breakable && tile === Tile.Crate)) return false
    return Math.abs(cellFloor(grid, nc, nr) - cellFloor(grid, column, row)) <= STEP_HEIGHT + 1e-4
  })
}

export function climbableFrom(grid: Grid, start: Vec2): Uint8Array {
  return floodFrom(grid, start, (column, row, nc, nr) => standHeight(grid, nc, nr) <= standHeight(grid, column, row) + JUMP_HEIGHT + 1e-4)
}

function floodFrom(grid: Grid, start: Vec2, passable: (column: number, row: number, nc: number, nr: number) => boolean): Uint8Array {
  const seen = new Uint8Array(grid.columns * grid.rows)
  const queue = new Int32Array(grid.columns * grid.rows)
  const first = Math.floor(start.y) * grid.columns + Math.floor(start.x)
  seen[first] = 1
  queue[0] = first
  let head = 0
  let tail = 1
  while (head < tail) {
    const index = queue[head++]
    const column = index % grid.columns
    const row = (index - column) / grid.columns
    for (const [dc, dr] of ORTHOGONAL) {
      const nc = column + dc
      const nr = row + dr
      if (nc < 0 || nr < 0 || nc >= grid.columns || nr >= grid.rows) continue
      const next = nr * grid.columns + nc
      if (seen[next] === 1 || !passable(column, row, nc, nr)) continue
      seen[next] = 1
      queue[tail++] = next
    }
  }
  return seen
}
