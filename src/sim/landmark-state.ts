import { LANDMARKS } from '../data/landmarks'
import { dropClues } from './clues'
import { Tile, setTile } from './grid'
import type { BuiltLevel } from './level'
import type { LandmarkPlacement } from './landmarks'
import { clamp, type Vec2 } from './math'
import { invalidateNavigation } from './navigation'
import type { Blast, LandmarkState } from './types'
import type { World } from './world'

export interface Tally {
  done: number
  total: number
}

export function createLandmarkStates(level: BuiltLevel): LandmarkState[] {
  return level.landmarks.map((placement) => {
    const hp = LANDMARKS[placement.id].breaks?.hp ?? 0
    return { hp, maxHp: hp, broken: false, open: false, crashes: 0, shaking: false }
  })
}

export function landmarkCenter(placement: LandmarkPlacement): Vec2 {
  return { x: placement.column + placement.width / 2, y: placement.row + placement.depth / 2 }
}

export function isTarget(placement: LandmarkPlacement): boolean {
  return LANDMARKS[placement.id].breaks?.target === true
}

export function targetTally(world: World, area?: number): Tally {
  let done = 0
  let total = 0
  world.level.landmarks.forEach((placement, index) => {
    if (!isTarget(placement) || (area !== undefined && placement.area !== area)) return
    total += 1
    if (world.landmarks[index].broken) done += 1
  })
  return { done, total }
}

export function hitLandmarkCell(world: World, cell: number, amount: number): void {
  const index = world.level.landmarkAt[cell]
  if (index >= 0) damageLandmark(world, index, amount)
}

export function damageLandmark(world: World, index: number, amount: number): void {
  const placement = world.level.landmarks[index]
  const rule = LANDMARKS[placement.id].breaks
  const state = world.landmarks[index]
  if (!rule || rule.rule !== 'hits' || state.broken || amount <= 0) return
  state.hp = Math.max(0, state.hp - amount)
  const center = landmarkCenter(placement)
  world.events.push({ type: 'landmarkHit', index, x: center.x, y: center.y, damage: amount })
  if (state.hp <= 0) breakLandmark(world, index)
}

export function blastLandmarks(world: World, blast: Blast): void {
  const amount = Math.max(blast.playerDamage, blast.enemyDamage)
  const { columns } = world.grid
  world.level.landmarks.forEach((placement, index) => {
    const rule = LANDMARKS[placement.id].breaks
    if (!rule || world.landmarks[index].broken) return
    if (!placement.cells.some((cell) => blastReaches(blast, cell, columns))) return
    if (rule.rule === 'blasts') breakLandmark(world, index)
    else damageLandmark(world, index, amount)
  })
}

function blastReaches(blast: Blast, cell: number, columns: number): boolean {
  return circleReaches(blast.x, blast.y, blast.radius, cell, columns)
}

function circleReaches(x: number, y: number, radius: number, cell: number, columns: number): boolean {
  const column = cell % columns
  const row = (cell - column) / columns
  const dx = x - clamp(x, column, column + 1)
  const dy = y - clamp(y, row, row + 1)
  return dx * dx + dy * dy <= radius * radius
}

export function landmarkThreatened(world: World, index: number): boolean {
  const placement = world.level.landmarks[index]
  const { columns } = world.grid
  const reached = (x: number, y: number, radius: number) => placement.cells.some((cell) => circleReaches(x, y, radius, cell, columns))
  if (world.blasts.some((blast) => blast.delay > 0 && reached(blast.x, blast.y, blast.radius))) return true
  return world.lobs.some((lob) => lob.lands === 'blast' && lob.radius > 0 && reached(lob.to.x, lob.to.y, lob.radius))
}

export function updateShaking(world: World): void {
  world.level.landmarks.forEach((placement, index) => {
    const state = world.landmarks[index]
    if (LANDMARKS[placement.id].breaks?.rule !== 'blasts' || state.broken) {
      state.shaking = false
      return
    }
    const threatened = landmarkThreatened(world, index)
    if (threatened && !state.shaking) {
      const center = landmarkCenter(placement)
      world.events.push({ type: 'landmarkShaking', index, x: center.x, y: center.y })
    }
    state.shaking = threatened
  })
}

export function breakLandmark(world: World, index: number): void {
  const placement = world.level.landmarks[index]
  const rule = LANDMARKS[placement.id].breaks
  const state = world.landmarks[index]
  if (!rule || state.broken) return
  state.broken = true
  state.hp = 0
  for (const cell of placement.cells) setTile(world.grid, cell, Tile.LandmarkLow)
  const center = landmarkCenter(placement)
  world.events.push({ type: 'landmarkBroken', index, id: placement.id, state: rule.into, x: center.x, y: center.y })
  if (rule.xp > 0) {
    const amount = rule.xp * world.chapter
    world.rewards.targets += amount
    world.events.push({ type: 'bonusXp', x: center.x, y: center.y, amount: amount * world.xpScale })
  }
  if (rule.target && targetTally(world, placement.area).done === 1) dropClues(world, placement.area, placement.cells)
}

export function openLandmark(world: World, index: number): boolean {
  const placement = world.level.landmarks[index]
  const state = world.landmarks[index]
  if (!placement || !state) return false
  const node = LANDMARKS[placement.id].opens?.[0]
  if (!node || state.open) return false
  state.open = true
  if (placement.gate) {
    setTile(world.grid, placement.gate.index, Tile.Floor)
    invalidateNavigation(world)
  }
  const center = landmarkCenter(placement)
  world.events.push({ type: 'landmarkOpened', index, id: placement.id, node, x: center.x, y: center.y })
  return true
}
