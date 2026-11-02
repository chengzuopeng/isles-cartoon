import { FOG } from '../data/fog'
import type { Tally } from './landmark-state'
import type { Vec2 } from './math'
import type { World } from './world'

export function fogged(world: World, x: number, y: number): boolean {
  const { level } = world
  const row = Math.floor(y)
  if (row < 0 || row >= level.grid.rows) return false
  const area = level.areaOfRow[row]
  if (!level.areas[area]?.fog) return false
  const reach = FOG.lampRadius * FOG.lampRadius
  for (let index = 0; index < level.lamps.length; index++) {
    if (!world.lamps[index]) continue
    const lamp = level.lamps[index]
    if (lamp.clears && lamp.area === area) return false
    const dx = x - lamp.x
    const dy = y - lamp.y
    if (dx * dx + dy * dy <= reach) return false
  }
  return true
}

export function fogBetween(world: World, from: Vec2, to: Vec2): boolean {
  return fogged(world, from.x, from.y) || fogged(world, to.x, to.y)
}

export function fogBlocks(world: World, from: Vec2, to: Vec2): boolean {
  if (Math.hypot(to.x - from.x, to.y - from.y) <= FOG.sight) return false
  return fogBetween(world, from, to)
}

export function fogHides(world: World, x: number, y: number): boolean {
  return fogBlocks(world, world.player.pos, { x, y })
}

export function areaClear(world: World, area: number): boolean {
  if (!world.level.areas[area]?.fog) return true
  return world.level.lamps.some((lamp, index) => lamp.clears && lamp.area === area && world.lamps[index])
}

export function lightLamp(world: World, index: number): boolean {
  const lamp = world.level.lamps[index]
  if (!lamp || world.lamps[index]) return false
  world.lamps[index] = true
  world.events.push({
    type: 'lampLit',
    index,
    landmark: lamp.landmark,
    x: lamp.x,
    y: lamp.y,
    radius: FOG.lampRadius,
    area: lamp.clears ? lamp.area : null,
  })
  return true
}

export function lampTally(world: World): Tally {
  return { done: world.lamps.filter(Boolean).length, total: world.lamps.length }
}
