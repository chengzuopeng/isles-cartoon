import type { Vec2 } from './math'
import type { World } from './world'

export function radarTarget(world: World): Vec2 | null {
  const { level } = world
  if (!level.def.radar) return null
  const area = level.areas[world.areaIndex]
  if (!area || area.kind === 'boss') return null
  return level.waypoints[world.areaIndex] ?? null
}
