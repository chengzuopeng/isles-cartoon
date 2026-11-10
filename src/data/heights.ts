export type TileKind =
  | 'floor'
  | 'wall'
  | 'water'
  | 'bush'
  | 'tree'
  | 'rock'
  | 'crate'
  | 'fence'
  | 'path'
  | 'gate'
  | 'gateClosed'
  | 'exit'
  | 'cart'
  | 'landmark'
  | 'landmarkLow'
  | 'boulder'

export const TILE_HEIGHTS: Readonly<Record<TileKind, number>> = {
  floor: 0,
  wall: 3,
  water: 0,
  bush: 1,
  tree: 5,
  rock: 1.2,
  crate: 1,
  fence: 0.9,
  path: 0,
  gate: 0,
  gateClosed: 3,
  exit: 0,
  cart: 1.4,
  landmark: 3,
  landmarkLow: 0.8,
  boulder: 2.5,
}

export const FLOOR_STEP = 0.5

export const CRATE_STACK_HEIGHT = 2.5

export const STEP_HEIGHT = 0.5

export const JUMP_HEIGHT = 1.3

export const CHEST_HEIGHT = 1

export const THROW_HEIGHT = 1.2

export const BLAST_REACH = { up: 0.75, down: 0.5 } as const

export const STRIKE_REACH = 0.5

export const MAX_PITCH = (85 * Math.PI) / 180

export const BODY_HEIGHTS: Readonly<Record<string, number>> = {
  player: 1.6,
  grunt: 1.7,
  gunner: 1.9,
  bomber: 1.25,
  turret: 1.5,
  shield: 1.85,
  thrower: 1.75,
  scarecrow: 4.5,
  harvester: 5,
  'demo-chief': 3.2,
  'shield-captain': 3.4,
  'forest-tank': 3,
}

export const EYE_HEIGHTS: Readonly<Record<string, number>> = {
  player: 1.5,
  grunt: 1.3,
  gunner: 1.7,
  bomber: 0.85,
  turret: 1.15,
  shield: 1.6,
  thrower: 1.5,
  scarecrow: 4,
  harvester: 4.2,
  'demo-chief': 2.7,
  'shield-captain': 2.9,
  'forest-tank': 2.4,
}

export const MUZZLE_HEIGHTS: Readonly<Record<string, number>> = {
  grunt: 1.05,
  gunner: 1.45,
  bomber: 0.7,
  turret: 1.05,
  shield: 1.15,
  thrower: 1.6,
  scarecrow: 1,
  harvester: 1.4,
  'demo-chief': 1.15,
  'shield-captain': 1.4,
  'forest-tank': 1.6,
}

export type WeakPoint = {
  height: number
  forward: number
  radius: number
}

export const WEAK_POINTS: Readonly<Record<string, WeakPoint>> = {
  scarecrow: { height: 3, forward: 1.4, radius: 0.6 },
  'demo-chief': { height: 1.15, forward: 1.4, radius: 0.6 },
}

export const EYE_CRIT = { band: 0.18, facing: 0.2, scale: 2 } as const

export const WEAK_POINT_SCALE = 2

export function bodyHeightOf(key: string): number {
  return BODY_HEIGHTS[key] ?? 1.6
}

export function eyeHeightOf(key: string): number {
  return EYE_HEIGHTS[key] ?? bodyHeightOf(key) * 0.85
}

export function muzzleHeightOf(key: string): number {
  return MUZZLE_HEIGHTS[key] ?? Math.min(eyeHeightOf(key), 1.2)
}
