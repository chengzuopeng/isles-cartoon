import { getBoss } from '../data/bosses'
import { assetUrl, type MapIcon } from '../render/asset-urls'
import { normalBelts } from '../render/belt-cargo'
import { sweepDirection, warningSpan } from '../render/blade-motion'
import { PALETTES } from '../render/themes'
import { alongOf } from '../sim/blades'
import { fogged } from '../sim/fog'
import { Tile, tileAt } from '../sim/grid'
import { isTarget } from '../sim/landmark-state'
import { insideRegion, type BladeLane, type BuiltLevel } from '../sim/level'
import type { Vec2 } from '../sim/math'
import type { BladeState, EnemyKind } from '../sim/types'
import type { World } from '../sim/world'
import { icon } from './assets'
import { element } from './dom'

export interface MapRect {
  x: number
  y: number
  width: number
  height: number
}

export interface BladeMark {
  lane: MapRect
  lit: MapRect | null
  blade: MapRect
  front: { x1: number; y1: number; x2: number; y2: number }
}

export interface MapOverlay {
  toggle(): void
  isOpen(): boolean
  update(world: World, dt: number): void
  dispose(): void
}

export interface MapMark {
  key: string
  icon: MapIcon
  x: number
  y: number
  done: boolean
}

const MARK_CELLS = 3.4
const SHARD_OFFSET = 2.6
const LEGEND: readonly (readonly [MapIcon, string])[] = [
  ['chest-normal', '宝箱'],
  ['supply', '补给点'],
  ['exit', '出口'],
  ['boss', 'Boss'],
  ['shard', '星核碎片'],
  ['branch', '没去过的地方'],
]
const SCALE = 6
const REFRESH = 0.15
const TARGET_COLOR = '#ff5f2e'
const WRECK_COLOR = '#c99d66'
const ALARM_COLORS = { quiet: '#ffd34d', running: '#ff9a1f', rung: '#ff3b30' } as const
const RUNNER_COLOR = '#ff3b30'
const FOG_SHADE = 'rgba(28, 40, 46, 0.42)'
const LAMP_LIT = '#ffc35a'
const LAMP_GLOW = 'rgba(255, 195, 90, 0.35)'
const LAMP_DARK = '#4a4038'
const LANE_TINT = 'rgba(255, 59, 48, 0.16)'
const LANE_LIT = 'rgba(255, 46, 30, 0.62)'
const BLADE_COLOR = '#d8352a'
const BLADE_FRONT = '#ffe08a'
const BELT_COLOR = '#45484e'
const BELT_ARROW = '#ffb238'
const ENEMY_DOTS: Record<EnemyKind, string> = {
  grunt: '#ff4d3d',
  gunner: '#a98bff',
  bomber: '#ffb238',
  turret: '#e6ecf2',
  shield: '#7fb2e6',
  thrower: '#c8d67a',
  boss: '#ff2a6a',
}

export function createMapOverlay(container: HTMLElement, level: BuiltLevel, showEnemies: boolean): MapOverlay {
  const root = element('div', 'map-overlay', container)
  const panel = element('div', 'map-panel', root)
  element('div', 'map-title', panel, `${level.def.title} · 地图（M 关闭）`)
  const legend = element('div', 'map-legend', panel)
  for (const [kind, label] of LEGEND) {
    const item = element('span', 'map-legend-item', legend)
    icon(item, 'map-legend-icon', assetUrl.mapIcon(kind))
    element('span', '', item, label)
  }
  const board = element('div', 'map-board', panel)
  const canvas = element('canvas', 'map-canvas', board)
  const layer = element('div', 'map-marks', board)
  const markViews = new Map<string, HTMLImageElement>()
  canvas.width = level.grid.columns * SCALE
  canvas.height = level.grid.rows * SCALE
  const context = canvas.getContext('2d')

  const syncMarks = (world: World) => {
    const { columns, rows } = level.grid
    const live = new Set<string>()
    for (const mark of mapMarks(world)) {
      live.add(mark.key)
      let view = markViews.get(mark.key)
      if (!view) {
        view = icon(layer, 'map-mark', '')
        view.style.width = `${(MARK_CELLS / columns) * 100}%`
        markViews.set(mark.key, view)
      }
      const url = assetUrl.mapIcon(mark.icon)
      if (view.dataset.icon !== mark.icon) {
        view.dataset.icon = mark.icon
        view.src = url
      }
      view.style.left = `${(mark.x / columns) * 100}%`
      view.style.top = `${(mark.y / rows) * 100}%`
      view.classList.toggle('done', mark.done)
    }
    for (const [key, view] of markViews) {
      if (live.has(key)) continue
      view.remove()
      markViews.delete(key)
    }
  }
  const crates: number[] = []
  level.grid.tiles.forEach((tile, index) => {
    if (tile === Tile.Crate) crates.push(index)
  })
  const base = document.createElement('canvas')
  base.width = canvas.width
  base.height = canvas.height
  const baseContext = base.getContext('2d')
  if (baseContext) paintTerrain(baseContext, level)
  let open = false
  let timer = 0
  let clock = 0

  const draw = (world: World) => {
    if (!context) return
    context.drawImage(base, 0, 0)
    for (const area of world.level.areas) {
      for (const index of area.gates) {
        const closed = world.grid.tiles[index] === Tile.GateClosed
        fillTile(context, index % level.grid.columns, Math.floor(index / level.grid.columns), closed ? '#ff4a1f' : '#5c626b')
      }
    }
    for (const index of crates) {
      if (world.grid.tiles[index] === Tile.Crate) continue
      const column = index % level.grid.columns
      const row = Math.floor(index / level.grid.columns)
      const palette = PALETTES[level.areas[level.areaOfRow[row]].theme]
      fillTile(context, column, row, colorOf(Tile.Floor, palette, (column + row) % 2 === 0))
    }
    world.level.landmarks.forEach((placement, index) => {
      if (!isTarget(placement)) return
      const broken = world.landmarks[index]?.broken ?? false
      for (const cell of placement.cells) fillTile(context, cell % level.grid.columns, Math.floor(cell / level.grid.columns), broken ? WRECK_COLOR : TARGET_COLOR)
      if (broken) return
      context.strokeStyle = '#1d1d1d'
      context.lineWidth = 2
      context.strokeRect(placement.column * SCALE - 1, placement.row * SCALE - 1, placement.width * SCALE + 2, placement.depth * SCALE + 2)
    })
    world.level.alarms.forEach((alarm, index) => {
      const placement = world.level.landmarks[alarm.landmark]
      const state = world.alarms[index]
      if (!placement || !state) return
      const blink = state.status === 'running' && Math.floor(clock * 4) % 2 === 0
      const color = blink ? '#fff3d6' : ALARM_COLORS[state.status]
      for (const cell of placement.cells) fillTile(context, cell % level.grid.columns, Math.floor(cell / level.grid.columns), color)
      context.strokeStyle = '#1d1d1d'
      context.lineWidth = 2
      context.strokeRect(placement.column * SCALE - 1, placement.row * SCALE - 1, placement.width * SCALE + 2, placement.depth * SCALE + 2)
      bell(context, placement.column + placement.width / 2, placement.row + placement.depth / 2)
      const runner = state.runner === null ? null : world.enemies.find((enemy) => enemy.id === state.runner && enemy.hp > 0)
      if (!runner) return
      context.strokeStyle = RUNNER_COLOR
      context.lineWidth = 2
      context.beginPath()
      context.arc(runner.pos.x * SCALE, runner.pos.y * SCALE, SCALE * (1.3 + 0.4 * Math.sin(clock * 10)), 0, Math.PI * 2)
      context.stroke()
      dot(context, runner.pos.x, runner.pos.y, SCALE * 0.85, '#1d1d1d')
      dot(context, runner.pos.x, runner.pos.y, SCALE * 0.6, RUNNER_COLOR)
    })
    drawBlades(context, world)
    shadeFog(context, world)
    world.level.lamps.forEach((lamp, index) => {
      const lit = world.lamps[index] ?? false
      if (lit) dot(context, lamp.x, lamp.y, SCALE * 2.2, LAMP_GLOW)
      dot(context, lamp.x, lamp.y, SCALE * 0.95, '#1d1d1d')
      dot(context, lamp.x, lamp.y, SCALE * 0.7, lit ? LAMP_LIT : LAMP_DARK)
    })
    syncMarks(world)
    if (showEnemies) {
      for (const enemy of world.enemies) {
        if (enemy.hp <= 0) continue
        dot(context, enemy.pos.x, enemy.pos.y, enemy.kind === 'boss' ? SCALE * 1.2 : SCALE * 0.45, ENEMY_DOTS[enemy.kind])
      }
    }
    const { player } = world
    dot(context, player.pos.x, player.pos.y, SCALE * 0.9, '#1d1d1d')
    dot(context, player.pos.x, player.pos.y, SCALE * 0.65, '#ffffff')
    labelAreas(context, level)
  }

  return {
    toggle() {
      open = !open
      root.classList.toggle('visible', open)
      timer = 0
    },
    isOpen: () => open,
    dispose() {
      root.remove()
    },
    update(world, dt) {
      if (!open) return
      clock += dt
      timer -= dt
      if (timer > 0) return
      timer = REFRESH
      draw(world)
    },
  }
}

export function mapMarks(world: World): MapMark[] {
  const { level } = world
  const marks: MapMark[] = []
  const here = level.areaOfRow[Math.min(level.grid.rows - 1, Math.max(0, Math.floor(world.player.pos.y)))]
  world.chests.forEach((chest, index) => {
    const secret = level.secrets.findIndex((region) => insideRegion(region, chest.pos.x, chest.pos.y))
    if (secret >= 0 && !world.secrets[secret]) return
    const seen = chest.area === here || (world.areas[chest.area]?.visited ?? false)
    marks.push({ key: `chest-${index}`, icon: seen ? `chest-${chest.tier}` : 'branch', x: chest.pos.x, y: chest.pos.y, done: chest.opened })
  })
  world.supplies.forEach((supply, index) => {
    marks.push({ key: `supply-${index}`, icon: 'supply', x: supply.pos.x, y: supply.pos.y, done: supply.used })
  })
  const exit = exitCenter(level)
  if (exit) marks.push({ key: 'exit', icon: 'exit', x: exit.x, y: exit.y, done: false })
  if (level.boss) {
    const boss = world.enemies.find((enemy) => enemy.kind === 'boss')
    const done = !boss || boss.hp <= 0
    marks.push({ key: 'boss', icon: 'boss', x: level.boss.x, y: level.boss.y, done })
    if (getBoss(level.boss.id).tier === 'chapter') {
      marks.push({ key: 'shard', icon: 'shard', x: level.boss.x + SHARD_OFFSET, y: level.boss.y - SHARD_OFFSET, done })
    }
  }
  return marks
}

function exitCenter(level: BuiltLevel): Vec2 | null {
  if (level.exits.length === 0) return null
  const { columns } = level.grid
  let x = 0
  let y = 0
  for (const index of level.exits) {
    x += (index % columns) + 0.5
    y += Math.floor(index / columns) + 0.5
  }
  return { x: x / level.exits.length, y: y / level.exits.length }
}

export function bladeMark(lane: BladeLane, blade: Pick<BladeState, 'pos' | 'phase' | 'warning' | 'forward'>): BladeMark {
  const along = alongOf(lane, blade.pos)
  const span = warningSpan(lane, blade, along)
  const direction = sweepDirection(lane, blade.forward)
  const flat = lane.axis === 'x'
  const lit = span ? (flat ? { x: span.from, y: lane.row, width: span.to - span.from, height: lane.depth } : { x: lane.column, y: span.from, width: lane.width, height: span.to - span.from }) : null
  const long = lane.reach * 2
  const wide = lane.half * 2
  const body = flat
    ? { x: blade.pos.x - lane.reach, y: blade.pos.y - lane.half, width: long, height: wide }
    : { x: blade.pos.x - lane.half, y: blade.pos.y - lane.reach, width: wide, height: long }
  const tip = along + direction * lane.reach
  const front = flat
    ? { x1: tip, y1: blade.pos.y - lane.half, x2: tip, y2: blade.pos.y + lane.half }
    : { x1: blade.pos.x - lane.half, y1: tip, x2: blade.pos.x + lane.half, y2: tip }
  return { lane: { x: lane.column, y: lane.row, width: lane.width, height: lane.depth }, lit, blade: body, front }
}

export function beltArrows(level: BuiltLevel): { column: number; row: number; dx: number; dy: number }[] {
  const { columns } = level.grid
  return normalBelts(level).map((item) => ({ column: item.index % columns, row: Math.floor(item.index / columns), dx: item.dx, dy: item.dy }))
}

function fillRect(context: CanvasRenderingContext2D, rect: MapRect, color: string): void {
  context.fillStyle = color
  context.fillRect(rect.x * SCALE, rect.y * SCALE, rect.width * SCALE, rect.height * SCALE)
}

function drawBlades(context: CanvasRenderingContext2D, world: World): void {
  world.level.blades.forEach((lane, index) => {
    const blade = world.blades[index]
    if (!blade) return
    const mark = bladeMark(lane, blade)
    fillRect(context, mark.lane, LANE_TINT)
    if (mark.lit) fillRect(context, mark.lit, LANE_LIT)
    context.fillStyle = '#1d1d1d'
    context.fillRect(mark.blade.x * SCALE - 1, mark.blade.y * SCALE - 1, mark.blade.width * SCALE + 2, mark.blade.height * SCALE + 2)
    fillRect(context, mark.blade, BLADE_COLOR)
    context.strokeStyle = BLADE_FRONT
    context.lineWidth = 2
    context.beginPath()
    context.moveTo(mark.front.x1 * SCALE, mark.front.y1 * SCALE)
    context.lineTo(mark.front.x2 * SCALE, mark.front.y2 * SCALE)
    context.stroke()
  })
}

function paintBelts(context: CanvasRenderingContext2D, level: BuiltLevel): void {
  for (const belt of beltArrows(level)) {
    fillTile(context, belt.column, belt.row, BELT_COLOR)
    const cx = (belt.column + 0.5) * SCALE
    const cy = (belt.row + 0.5) * SCALE
    const size = SCALE * 0.32
    context.fillStyle = BELT_ARROW
    context.beginPath()
    context.moveTo(cx + belt.dx * size, cy + belt.dy * size)
    context.lineTo(cx - belt.dx * size - belt.dy * size, cy - belt.dy * size + belt.dx * size)
    context.lineTo(cx - belt.dx * size + belt.dy * size, cy - belt.dy * size - belt.dx * size)
    context.closePath()
    context.fill()
  }
}

function shadeFog(context: CanvasRenderingContext2D, world: World): void {
  const { level } = world
  if (!level.areas.some((area) => area.fog)) return
  context.fillStyle = FOG_SHADE
  for (const area of level.areas) {
    if (!area.fog) continue
    for (let row = area.top; row < area.bottom; row++) {
      for (let column = 0; column < level.grid.columns; column++) {
        if (fogged(world, column + 0.5, row + 0.5)) context.fillRect(column * SCALE, row * SCALE, SCALE, SCALE)
      }
    }
  }
}

function paintTerrain(context: CanvasRenderingContext2D, level: BuiltLevel): void {
  const { grid } = level
  for (let row = 0; row < grid.rows; row++) {
    const palette = PALETTES[level.areas[level.areaOfRow[row]].theme]
    for (let column = 0; column < grid.columns; column++) {
      const tile = tileAt(grid, column, row)
      fillTile(context, column, row, colorOf(tile, palette, (column + row) % 2 === 0))
    }
  }
  paintBelts(context, level)
}

function colorOf(tile: Tile, palette: (typeof PALETTES)[keyof typeof PALETTES], even: boolean): string {
  switch (tile) {
    case Tile.Wall:
      return palette.wall
    case Tile.Water:
      return palette.water
    case Tile.Bush:
      return palette.bush
    case Tile.Tree:
      return palette.canopy
    case Tile.Rock:
      return '#8d8a84'
    case Tile.Crate:
      return '#a8743f'
    case Tile.Cart:
      return '#8a5a32'
    case Tile.Landmark:
      return '#6f5a48'
    case Tile.Fence:
    case Tile.LandmarkLow:
      return '#c99d66'
    case Tile.Path:
      return palette.path
    case Tile.Gate:
    case Tile.GateClosed:
      return '#5c626b'
    case Tile.Exit:
      return '#5ff0ff'
    default:
      return even ? palette.floorA : palette.floorB
  }
}

function fillTile(context: CanvasRenderingContext2D, column: number, row: number, color: string): void {
  context.fillStyle = color
  context.fillRect(column * SCALE, row * SCALE, SCALE, SCALE)
}

function dot(context: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string): void {
  context.fillStyle = color
  context.beginPath()
  context.arc(x * SCALE, y * SCALE, radius, 0, Math.PI * 2)
  context.fill()
}

function bell(context: CanvasRenderingContext2D, x: number, y: number): void {
  const cx = x * SCALE
  const cy = y * SCALE
  const size = SCALE * 1.1
  context.fillStyle = '#1d1d1d'
  context.beginPath()
  context.moveTo(cx - size, cy + size * 0.7)
  context.lineTo(cx + size, cy + size * 0.7)
  context.quadraticCurveTo(cx + size * 0.62, cy + size * 0.35, cx + size * 0.6, cy - size * 0.15)
  context.quadraticCurveTo(cx + size * 0.55, cy - size * 0.9, cx, cy - size * 0.95)
  context.quadraticCurveTo(cx - size * 0.55, cy - size * 0.9, cx - size * 0.6, cy - size * 0.15)
  context.quadraticCurveTo(cx - size * 0.62, cy + size * 0.35, cx - size, cy + size * 0.7)
  context.fill()
  context.beginPath()
  context.arc(cx, cy + size * 0.95, size * 0.22, 0, Math.PI * 2)
  context.fill()
}

function labelAreas(context: CanvasRenderingContext2D, level: BuiltLevel): void {
  context.font = 'bold 13px system-ui, sans-serif'
  context.lineWidth = 3
  context.strokeStyle = 'rgba(0, 0, 0, 0.75)'
  context.fillStyle = '#ffffff'
  for (const area of level.areas) {
    const y = (area.bottom - 1) * SCALE - 4
    context.strokeText(area.name, SCALE * 1.5, y)
    context.fillText(area.name, SCALE * 1.5, y)
  }
}
