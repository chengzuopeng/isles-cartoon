import { LANDMARKS, LANDMARK_IDS, type Facing, type LandmarkId, type LandmarkMotion, type MotionAxis } from '../data/landmarks'
import type { Theme } from '../data/levels/types'
import { HAY_THEMES } from '../data/props'
import { Tile, tileAt, type Grid } from '../sim/grid'
import { ALARM_RIGS, LANDMARK_FX, LANDMARK_GLOW, LANDMARK_LAMPS, LANDMARK_OPEN, LANDMARK_SCATTER, PROP_ONE_PART, type HingeRule } from './themes'

export type PropKind = 'wall' | 'rock' | 'bush' | 'tree' | 'cart' | 'fence' | 'bridge' | 'gate'

export type TurnRule = 'quarter' | 'any' | 'neighbors'

export type ShadowCaster = 'model' | 'none' | 'box' | 'lathe'

export const BACKDROP_THEMES: ReadonlySet<Theme> = new Set<Theme>(['farm', 'meadow', 'village'])

export interface PropRule {
  model: Readonly<Record<Theme, string>>
  variants: number
  turn: TurnRule
  scale: readonly [number, number]
  tint: boolean
  shadow: ShadowCaster
}

export interface GlowRule {
  node: string
  gain: number
  swing: number
  speed: number
}

export interface Links {
  north: boolean
  east: boolean
  south: boolean
  west: boolean
}

export interface BridgeCell {
  facing: Facing
  rails: Facing[]
}

function everywhere(id: string): Record<Theme, string> {
  return { farm: id, meadow: id, village: id, forest: id, outpost: id, arena: id, factory: id }
}

export const PROP_MODELS: Readonly<Record<PropKind, PropRule>> = {
  wall: {
    model: {
      farm: 'ch1-wall-wood',
      village: 'ch1-wall-wood',
      arena: 'ch1-wall-wood',
      meadow: 'ch1-wall-stone',
      forest: 'ch1-wall-rock',
      outpost: 'ch1-wall-metal',
      factory: 'ch1-wall-metal',
    },
    variants: 3,
    turn: 'quarter',
    scale: [1, 1],
    tint: true,
    shadow: 'box',
  },
  rock: {
    model: { ...everywhere('ch1-rock'), ...Object.fromEntries(HAY_THEMES.map((theme) => [theme, 'ch1-haystack'])) },
    variants: 3,
    turn: 'quarter',
    scale: [1, 1],
    tint: true,
    shadow: 'model',
  },
  bush: {
    model: { ...everywhere('ch1-bush-grass'), farm: 'ch1-bush-wheat' },
    variants: 3,
    turn: 'any',
    scale: [0.92, 1.08],
    tint: true,
    shadow: 'lathe',
  },
  tree: { model: everywhere('ch1-tree'), variants: 3, turn: 'any', scale: [0.92, 1.08], tint: true, shadow: 'lathe' },
  cart: { model: everywhere('ch1-cart'), variants: 1, turn: 'quarter', scale: [1, 1], tint: true, shadow: 'model' },
  fence: { model: everywhere('ch1-fence'), variants: 1, turn: 'neighbors', scale: [1, 1], tint: false, shadow: 'none' },
  bridge: { model: everywhere('ch1-bridge'), variants: 1, turn: 'neighbors', scale: [1, 1], tint: false, shadow: 'none' },
  gate: { model: everywhere('ch1-gate'), variants: 1, turn: 'neighbors', scale: [1, 1], tint: false, shadow: 'model' },
}

export const SCENE_NODES = {
  fencePost: 'post',
  fenceRail: 'rail',
  bridgeDeck: 'deck',
  bridgeRail: 'rail',
  bridgeRailEnd: 'rail_end',
  gateGlow: 'socket_fx_glow',
  roof: 'roof',
} as const

const PROP_NODES: Readonly<Record<string, readonly string[]>> = {
  'ch1-fence': [SCENE_NODES.fencePost, SCENE_NODES.fenceRail],
  'ch1-bridge': [SCENE_NODES.bridgeDeck, SCENE_NODES.bridgeRail, SCENE_NODES.bridgeRailEnd],
  'ch1-gate': [SCENE_NODES.gateGlow],
}

const GLOW_RULES: Readonly<Partial<Record<string, GlowRule>>> = LANDMARK_GLOW

const FACING_STEPS: Readonly<Record<Facing, readonly [number, number]>> = {
  0: [0, 1],
  90: [-1, 0],
  180: [0, -1],
  270: [1, 0],
}

export const BRIDGE_MAX_SPAN = 6

const VARIANT_LETTERS = 'abcdefgh'

const MOTION_AXES: Readonly<Record<MotionAxis, readonly [number, number, number]>> = {
  x: [1, 0, 0],
  y: [0, 0, -1],
  z: [0, 1, 0],
}

export function propModel(kind: PropKind, theme: Theme): string {
  return PROP_MODELS[kind].model[theme]
}

export function modelShadow(kind: PropKind): boolean {
  return PROP_MODELS[kind].shadow === 'model'
}

export function fallbackShadow(kind: PropKind): boolean {
  return PROP_MODELS[kind].shadow !== 'none'
}

export function proxyShape(kind: PropKind): 'box' | 'lathe' | null {
  const { shadow } = PROP_MODELS[kind]
  return shadow === 'box' || shadow === 'lathe' ? shadow : null
}

export function variantId(base: string, variant: number): string {
  return `${base}-${VARIANT_LETTERS.charAt(Math.max(1, variant) - 1)}`
}

export function variantIds(base: string, count: number): string[] {
  return Array.from({ length: Math.max(1, count) }, (_, index) => variantId(base, index + 1))
}

export function onePartProp(id: string): boolean {
  return PROP_ONE_PART.some((base) => id === base || variantIds(base, VARIANT_LETTERS.length).includes(id))
}

export function cellHash(column: number, row: number, salt = 0): number {
  let value = Math.imul(column | 0, 0x27d4eb2d) ^ Math.imul(row | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1)
  value = Math.imul(value ^ (value >>> 15), 0x85ebca6b)
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35)
  value ^= value >>> 16
  return (value >>> 0) / 0x100000000
}

export function pickVariant(column: number, row: number, count: number): number {
  return 1 + Math.floor(cellHash(column, row, 1) * Math.max(1, count))
}

export function quarterTurn(column: number, row: number): Facing {
  return (Math.floor(cellHash(column, row, 2) * 4) * 90) as Facing
}

export function propYaw(kind: PropKind, column: number, row: number): number {
  const { turn } = PROP_MODELS[kind]
  if (turn === 'any') return cellHash(column, row, 4) * Math.PI * 2
  if (turn === 'quarter') return facingYaw(quarterTurn(column, row))
  return facingYaw(0)
}

export function propScale(kind: PropKind, column: number, row: number): number {
  const [low, high] = PROP_MODELS[kind].scale
  return low + (high - low) * cellHash(column, row, 5)
}

export function chunkOf(column: number, row: number, columns: number, width: number, depth: number): number {
  return Math.floor(row / depth) * Math.ceil(columns / width) + Math.floor(column / width)
}

export function firstLoaded(has: (id: string) => boolean, candidates: readonly string[]): string | null {
  return candidates.find((id) => has(id)) ?? null
}

export function variantModel(has: (id: string) => boolean, base: string, count: number, column: number, row: number): string | null {
  return firstLoaded(has, [variantId(base, pickVariant(column, row, count)), variantId(base, 1), base])
}

export function landmarkModel(has: (id: string) => boolean, id: LandmarkId, variant: number): string | null {
  return firstLoaded(has, [variantId(id, variant), variantId(id, 1), id])
}

export function railFacings(links: Links): Facing[] {
  const facings: Facing[] = []
  if (links.east) facings.push(0)
  if (links.south) facings.push(90)
  if (links.west) facings.push(180)
  if (links.north) facings.push(270)
  return facings
}

export function linksOf(grid: Grid, column: number, row: number, joins: (tile: Tile) => boolean): Links {
  return {
    north: joins(tileAt(grid, column, row - 1)),
    east: joins(tileAt(grid, column + 1, row)),
    south: joins(tileAt(grid, column, row + 1)),
    west: joins(tileAt(grid, column - 1, row)),
  }
}

export function gateFacing(grid: Grid, column: number, row: number): Facing {
  const isGate = (tile: Tile) => tile === Tile.Gate || tile === Tile.GateClosed
  const links = linksOf(grid, column, row, isGate)
  if (!(links.north || links.south) || links.east || links.west) return 0
  return column + 0.5 < grid.columns / 2 ? 270 : 90
}

export function facingStep(facing: Facing): readonly [number, number] {
  return FACING_STEPS[facing]
}

export function railEnds(bridge: BridgeCell, column: number, row: number, isDeck: (column: number, row: number) => boolean): Facing[] {
  return bridge.rails.filter((facing) => {
    const [dc, dr] = facingStep(facing)
    return !isDeck(column + dc, row + dr)
  })
}

function deck(tile: Tile): boolean {
  return tile === Tile.Floor || tile === Tile.Path
}

function spanBetweenWater(grid: Grid, column: number, row: number, dc: number, dr: number, maxSpan: number): boolean {
  let back = 1
  while (back <= maxSpan && deck(tileAt(grid, column - dc * back, row - dr * back))) back++
  let ahead = 1
  while (ahead <= maxSpan && deck(tileAt(grid, column + dc * ahead, row + dr * ahead))) ahead++
  if (back + ahead - 1 > maxSpan) return false
  return (
    tileAt(grid, column - dc * back, row - dr * back) === Tile.Water && tileAt(grid, column + dc * ahead, row + dr * ahead) === Tile.Water
  )
}

export function bridgeAt(grid: Grid, column: number, row: number, maxSpan = BRIDGE_MAX_SPAN): BridgeCell | null {
  if (!deck(tileAt(grid, column, row))) return null
  const water = (dc: number, dr: number) => tileAt(grid, column + dc, row + dr) === Tile.Water
  if (spanBetweenWater(grid, column, row, 1, 0, maxSpan)) {
    const rails: Facing[] = []
    if (water(1, 0)) rails.push(0)
    if (water(-1, 0)) rails.push(180)
    return { facing: 0, rails }
  }
  if (spanBetweenWater(grid, column, row, 0, 1, maxSpan)) {
    const rails: Facing[] = []
    if (water(0, 1)) rails.push(90)
    if (water(0, -1)) rails.push(270)
    return { facing: 90, rails }
  }
  return null
}

export function facingYaw(facing: number): number {
  return -Math.PI / 2 - (facing * Math.PI) / 180
}

export function footprintCenter(column: number, row: number, width: number, depth: number): { x: number; z: number } {
  return { x: column + width / 2, z: row + depth / 2 }
}

export function motionAxis(axis: MotionAxis): readonly [number, number, number] {
  return MOTION_AXES[axis]
}

export function motionAngle(motion: LandmarkMotion, time: number): number {
  if (motion.swing !== undefined) return motion.swing * Math.sin(time * (motion.speed ?? 1))
  return (motion.spin ?? 0) * time
}

export function insideFootprint(x: number, y: number, column: number, row: number, width: number, depth: number): boolean {
  return x >= column && x < column + width && y >= row && y < row + depth
}

export function hiddenInside(id: LandmarkId): readonly string[] {
  return LANDMARKS[id].hideInside ?? []
}

export function hideMargin(id: LandmarkId): number {
  return LANDMARKS[id].hideMargin ?? 0
}

export function glowRule(id: LandmarkId): GlowRule | undefined {
  return GLOW_RULES[id]
}

export function glowLevel(rule: GlowRule, time: number): number {
  return rule.gain + rule.swing * Math.sin(time * rule.speed)
}

export function landmarkOf(id: string): LandmarkId | null {
  for (const base of LANDMARK_IDS) {
    if (id === base) return base
    if (id.length === base.length + 2 && id.startsWith(`${base}-`) && VARIANT_LETTERS.includes(id.charAt(id.length - 1))) return base
    if (stateOf(base, id) !== null) return base
  }
  return null
}

export function stateOf(base: LandmarkId, id: string): string | null {
  if (!id.startsWith(`${base}-`)) return null
  const state = id.slice(base.length + 1)
  return LANDMARKS[base].states?.includes(state) ? state : null
}

export function stateModel(has: (id: string) => boolean, id: LandmarkId, state: string): string | null {
  return firstLoaded(has, [`${id}-${state}`])
}

export interface Hinge {
  axis: readonly [number, number, number]
  angle: number
}

export function hingeOf(
  id: LandmarkId,
  node: string,
  hinges: Readonly<Partial<Record<LandmarkId, Readonly<Record<string, HingeRule>>>>> = LANDMARK_OPEN.hinges,
): Hinge {
  const rule = hinges[id]?.[node]
  return { axis: motionAxis(rule?.axis ?? 'z'), angle: rule?.angle ?? 0 }
}

export function landmarkYaw(id: LandmarkId, facing: number, column: number, row: number): number {
  const rule = LANDMARK_SCATTER[id]
  if (rule === 'any') return facingYaw(facing) + cellHash(column, row, 6) * Math.PI * 2
  if (rule === 'quarter') return facingYaw(facing) + Math.floor(cellHash(column, row, 6) * 4) * (Math.PI / 2)
  return facingYaw(facing)
}

export function fxSockets(id: LandmarkId): string[] {
  const fx = LANDMARK_FX[id]
  return fx ? [fx.forge, fx.smoke, fx.waterfall].filter((name): name is string => name !== undefined) : []
}

export function lampRule(id: LandmarkId): { node: string; glass: string; light: string } | undefined {
  return LANDMARK_LAMPS[id]
}

export function alarmNodes(id: LandmarkId): string[] {
  const rig = ALARM_RIGS[id]
  return rig ? [rig.bell, rig.lamp] : []
}

export function openProgress(current: number, open: boolean, dt: number, seconds: number): number {
  const target = open ? 1 : 0
  if (seconds <= 0) return target
  const step = Math.max(0, dt) / seconds
  return current < target ? Math.min(target, current + step) : Math.max(target, current - step)
}

export function swingEase(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return 1 - (1 - x) ** 3
}

export function drivenNodes(id: string): string[] {
  const prop = PROP_NODES[id]
  if (prop) return [...prop]
  const landmark = landmarkOf(id)
  if (!landmark || stateOf(landmark, id) !== null) return []
  const def = LANDMARKS[landmark]
  const nodes = (def.motion ?? []).map((motion) => motion.node)
  if (def.nodes?.includes(SCENE_NODES.roof)) nodes.push(SCENE_NODES.roof)
  nodes.push(...hiddenInside(landmark))
  if (def.opens) nodes.push(...def.opens)
  const glow = glowRule(landmark)
  if (glow) nodes.push(glow.node)
  nodes.push(...alarmNodes(landmark), ...fxSockets(landmark))
  const lamp = lampRule(landmark)
  if (lamp) nodes.push(lamp.node, lamp.light)
  return [...new Set(nodes)]
}
