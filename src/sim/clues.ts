import { CLUE_REACH } from '../data/clues'
import { blocksMovement, tileAt } from './grid'
import type { BuiltLevel } from './level'
import type { Vec2 } from './math'
import type { ClueDrop } from './types'
import type { World } from './world'

const NEIGHBORS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

export function createClueDrops(level: BuiltLevel): ClueDrop[] {
  const drops: ClueDrop[] = []
  for (const clue of level.clues) {
    if (!clue.at) continue
    drops.push({ id: drops.length, clue: clue.id, pos: { x: clue.at.x, y: clue.at.y }, area: clue.area, taken: false })
  }
  return drops
}

export function dropClues(world: World, area: number, cells: readonly number[]): void {
  for (const clue of world.level.clues) {
    if (clue.at || clue.area !== area) continue
    if (world.clues.some((drop) => drop.clue === clue.id)) continue
    const pos = dropSpot(world, cells)
    const drop: ClueDrop = { id: world.clues.length, clue: clue.id, pos, area, taken: false }
    world.clues.push(drop)
    world.events.push({ type: 'clueDropped', id: drop.id, clue: drop.clue, x: pos.x, y: pos.y })
  }
}

function dropSpot(world: World, cells: readonly number[]): Vec2 {
  const { grid, player } = world
  const own = new Set(cells)
  let best: Vec2 | null = null
  let bestDistance = Infinity
  for (const cell of cells) {
    const column = cell % grid.columns
    const row = (cell - column) / grid.columns
    for (const [dc, dr] of NEIGHBORS) {
      const nc = column + dc
      const nr = row + dr
      if (own.has(nr * grid.columns + nc) || blocksMovement(tileAt(grid, nc, nr))) continue
      const spot = { x: nc + 0.5, y: nr + 0.5 }
      const distance = Math.hypot(spot.x - player.pos.x, spot.y - player.pos.y)
      if (distance < bestDistance) {
        best = spot
        bestDistance = distance
      }
    }
  }
  return best ?? { x: player.pos.x, y: player.pos.y }
}

export function updateClues(world: World): void {
  const { player } = world
  if (!player.alive || world.status !== 'playing') return
  const reach = player.radius + CLUE_REACH
  for (const drop of world.clues) {
    if (drop.taken) continue
    if (Math.hypot(drop.pos.x - player.pos.x, drop.pos.y - player.pos.y) > reach) continue
    drop.taken = true
    if (!world.cluesFound.includes(drop.clue)) world.cluesFound.push(drop.clue)
    world.events.push({ type: 'clueFound', id: drop.id, clue: drop.clue, x: drop.pos.x, y: drop.pos.y })
  }
}
