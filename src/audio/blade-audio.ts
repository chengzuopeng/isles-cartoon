import type { BladeLane } from '../sim/level'
import type { Vec2 } from '../sim/math'
import type { World } from '../sim/world'

export const BLADE_AUDIO = {
  full: 2,
  silent: 8,
  near: 5,
} as const

export type BladeAudio = typeof BLADE_AUDIO

export function laneDistance(lane: BladeLane, pos: Vec2): number {
  const dx = Math.max(lane.column - pos.x, 0, pos.x - (lane.column + lane.width))
  const dy = Math.max(lane.row - pos.y, 0, pos.y - (lane.row + lane.depth))
  return Math.hypot(dx, dy)
}

export function falloff(distance: number, rule: BladeAudio = BLADE_AUDIO): number {
  if (distance <= rule.full) return 1
  if (distance >= rule.silent) return 0
  const t = (distance - rule.full) / (rule.silent - rule.full)
  return 1 - t * t * (3 - 2 * t)
}

export function bladeLoudness(world: World, index: number, at: Vec2 | null = null, rule: BladeAudio = BLADE_AUDIO): number {
  const lane = world.level.blades[index]
  if (!lane) return 0
  const { pos } = world.player
  const distance = at ? Math.hypot(at.x - pos.x, at.y - pos.y) : laneDistance(lane, pos)
  if (lane.area !== world.areaIndex && distance > rule.near) return 0
  return falloff(distance, rule)
}
