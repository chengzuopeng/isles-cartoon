import type { BossSummon } from '../bosses'
import type { ClueId } from '../clues'
import type { AffixId } from '../elites'
import type { IdleMode } from '../enemies'
import type { Facing, LandmarkId } from '../landmarks'
import type { PlayerWeaponId } from '../weapons'

export type Theme = 'farm' | 'meadow' | 'village' | 'forest' | 'outpost' | 'arena' | 'factory'

export type GridPoint = readonly [number, number]

export interface PatrolDef {
  from: GridPoint
  points: readonly GridPoint[]
}

export interface EliteDef {
  at: GridPoint
  affixes: readonly AffixId[]
}

export interface LandmarkPlacementDef {
  id: LandmarkId
  at: GridPoint
  facing?: Facing
  variant?: number
}

export interface RegionDef {
  from: GridPoint
  to: GridPoint
}

export type ClueSpotDef = { id: ClueId; at: GridPoint } | { id: ClueId; dropBy: 'firstTarget' }

export interface SecretDef extends RegionDef {
  door?: LandmarkId
}

export interface ChestLootDef {
  at: GridPoint
  weapon: PlayerWeaponId
}

export interface FogDef {
  clearedBy?: GridPoint
}

export interface PerchDef {
  at: GridPoint
  on: LandmarkId
}

export interface AlarmDef {
  landmark: LandmarkId
  post: GridPoint
}

export interface ReinforceDef {
  at: readonly GridPoint[]
  enemies: readonly BossSummon[]
  left: number
}

export interface RushDef {
  at: readonly GridPoint[]
  enemies: readonly BossSummon[]
  variants?: readonly (readonly BossSummon[])[]
  left: number
}

export interface BladeDef {
  from: GridPoint
  to: GridPoint
  speed?: number
  rest?: number
  delay?: number
}

export type AreaKind = 'normal' | 'lock' | 'boss' | 'destroy'

export type WallStyle = 'hedge'

export interface BossTuningDef {
  maxHp?: number
  damage?: number
}

export interface AreaDef {
  name: string
  theme: Theme
  kind?: AreaKind
  walls?: WallStyle
  idle?: IdleMode
  patrols?: readonly PatrolDef[]
  elites?: readonly EliteDef[]
  ambush?: readonly GridPoint[]
  wander?: readonly GridPoint[]
  landmarks?: readonly LandmarkPlacementDef[]
  pasture?: RegionDef
  clues?: readonly ClueSpotDef[]
  secrets?: readonly SecretDef[]
  loot?: readonly ChestLootDef[]
  alarm?: AlarmDef
  reinforce?: ReinforceDef
  rushes?: readonly RushDef[]
  fog?: FogDef
  perches?: readonly PerchDef[]
  blades?: readonly BladeDef[]
  heights?: readonly string[]
  rows: readonly string[]
}

export interface LevelDef {
  id: string
  title: string
  subtitle: string
  objective: string
  chapter: number
  bossId?: string
  bossTuning?: BossTuningDef
  parSeconds: number
  maxHits: number
  waves?: boolean
  radar?: boolean
  unlockAfter?: string
  wip?: string
  firstPerson?: boolean
  areas: readonly AreaDef[]
}

export function landmarkGrid(id: LandmarkId, variants: number, ...lines: string[]): LandmarkPlacementDef[] {
  const placements: LandmarkPlacementDef[] = []
  lines.forEach((line, row) => {
    for (let index = 0; index < line.length; index++) {
      if (line.charAt(index) === '.') continue
      const column = index + 1
      placements.push({ id, at: [column, row], variant: cellVariant(column, row, variants) })
    }
  })
  return placements
}

export function cellVariant(column: number, row: number, variants: number): number {
  let value = Math.imul(column | 0, 0x27d4eb2d) ^ Math.imul(row | 0, 0x165667b1)
  value = Math.imul(value ^ (value >>> 15), 0x85ebca6b)
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35)
  value ^= value >>> 16
  return ((value >>> 0) % variants) + 1
}

export function flatHeights(rows: readonly string[], digit: number): string[] {
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) throw new Error(`height ${digit} is not a digit`)
  return rows.map((row) => String(digit).repeat(row.length))
}

export function walled(width: number, ...lines: string[]): string[] {
  const inner = width - 2
  return lines.map((line, index) => {
    if (line.length > inner) throw new Error(`row ${index + 1} has ${line.length} inner columns, max ${inner}`)
    return `#${line.padEnd(inner, '.')}#`
  })
}
