import { SHEEP } from '../data/sheep'
import { corridorClear, resolveCircleGrid } from './collision'
import { blocksMovement, tileAt } from './grid'
import { openLandmark } from './landmark-state'
import { insideRegion, regionCells, type BuiltLevel, type RegionPlacement } from './level'
import type { LandmarkPlacement } from './landmarks'
import type { Vec2 } from './math'
import { descend, distanceField } from './navigation'
import type { Sheep } from './types'
import type { World } from './world'

export function createSheep(level: BuiltLevel): Sheep[] {
  const flock: Sheep[] = []
  level.landmarks.forEach((placement, index) => {
    const gate = placement.gate
    if (!gate) return
    const spot = penSpot(placement)
    flock.push({
      id: flock.length,
      pen: index,
      pos: { x: spot.x, y: spot.y },
      prev: { x: spot.x, y: spot.y },
      facing: Math.atan2(gate.outY, gate.outX),
      state: 'penned',
      wait: 0,
      target: null,
      moving: false,
    })
  })
  return flock
}

function penSpot(placement: LandmarkPlacement): Vec2 {
  for (let row = 0; row < placement.mask.length; row++) {
    const column = placement.mask[row].indexOf('.')
    if (column >= 0) return { x: placement.column + column + 0.5, y: placement.row + row + 0.5 }
  }
  return { x: placement.column + placement.width / 2, y: placement.row + placement.depth / 2 }
}

export function openPen(world: World, index: number): void {
  if (!world.level.landmarks[index]?.gate || !openLandmark(world, index)) return
  for (const sheep of world.sheep) {
    if (sheep.pen !== index || sheep.state !== 'penned') continue
    sheep.state = 'leaving'
    sheep.wait = SHEEP.leaveDelay
    world.events.push({ type: 'sheepFreed', id: sheep.id, pen: index, x: sheep.pos.x, y: sheep.pos.y })
  }
}

export function updateSheep(world: World, dt: number): void {
  for (const sheep of world.sheep) {
    sheep.moving = false
    if (sheep.state === 'leaving') leave(world, sheep, dt)
    else if (sheep.state === 'grazing') graze(world, sheep, dt)
  }
}

function pastureOf(world: World, sheep: Sheep): { index: number; region: RegionPlacement } | null {
  const area = world.level.landmarks[sheep.pen]?.area
  const index = world.level.pastures.findIndex((pasture) => pasture.area === area)
  return index >= 0 ? { index, region: world.level.pastures[index] } : null
}

function leave(world: World, sheep: Sheep, dt: number): void {
  if (sheep.wait > 0) {
    sheep.wait = Math.max(0, sheep.wait - dt)
    return
  }
  const pasture = pastureOf(world, sheep)
  if (!pasture) return
  if (insideRegion(pasture.region, sheep.pos.x, sheep.pos.y)) {
    sheep.state = 'grazing'
    sheep.target = null
    sheep.wait = rest(world)
    world.events.push({ type: 'sheepHome', id: sheep.id, x: sheep.pos.x, y: sheep.pos.y })
    return
  }
  const direction = descend(world.grid, pastureField(world, pasture.index), sheep.pos)
  if (direction) walk(world, sheep, direction, SHEEP.walkSpeed, dt)
}

function graze(world: World, sheep: Sheep, dt: number): void {
  sheep.wait -= dt
  const target = sheep.target
  if (target) {
    const dx = target.x - sheep.pos.x
    const dy = target.y - sheep.pos.y
    const distance = Math.hypot(dx, dy)
    if (distance <= SHEEP.arrive || sheep.wait <= 0) {
      sheep.target = null
      sheep.wait = rest(world)
      return
    }
    walk(world, sheep, { x: dx / distance, y: dy / distance }, SHEEP.grazeSpeed, dt)
    return
  }
  if (sheep.wait > 0) return
  const pasture = pastureOf(world, sheep)
  sheep.target = pasture ? grazeSpot(world, sheep, pasture.region) : null
  sheep.wait = sheep.target ? SHEEP.grazeGiveUp : rest(world)
}

function grazeSpot(world: World, sheep: Sheep, region: RegionPlacement): Vec2 | null {
  const { grid, sheepRng: rng } = world
  for (let attempt = 0; attempt < SHEEP.grazeTries; attempt++) {
    const column = region.column + rng.int(region.width)
    const row = region.row + rng.int(region.depth)
    if (blocksMovement(tileAt(grid, column, row))) continue
    const spot = {
      x: column + 0.5 + rng.range(-SHEEP.jitter, SHEEP.jitter),
      y: row + 0.5 + rng.range(-SHEEP.jitter, SHEEP.jitter),
    }
    if (corridorClear(grid, sheep.pos, spot, SHEEP.radius)) return spot
  }
  return null
}

function rest(world: World): number {
  return world.sheepRng.range(SHEEP.grazeWaitMin, SHEEP.grazeWaitMax)
}

function walk(world: World, sheep: Sheep, direction: Vec2, speed: number, dt: number): void {
  sheep.pos.x += direction.x * speed * dt
  sheep.pos.y += direction.y * speed * dt
  resolveCircleGrid(sheep.pos, SHEEP.radius, world.grid)
  sheep.facing = Math.atan2(direction.y, direction.x)
  sheep.moving = true
}

function pastureField(world: World, index: number): Float32Array {
  const key = -(index + 1)
  const cached = world.navFields.get(key)
  if (cached) return cached
  const { grid } = world
  const cells = regionCells(world.level.pastures[index], grid.columns).filter((cell) => {
    const column = cell % grid.columns
    return !blocksMovement(tileAt(grid, column, (cell - column) / grid.columns))
  })
  const field = distanceField(grid, cells)
  world.navFields.set(key, field)
  return field
}
