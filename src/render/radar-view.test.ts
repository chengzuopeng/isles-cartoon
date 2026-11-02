import { describe, expect, it } from 'vitest'
import { LEVEL_1_4 } from '../data/levels/level-1-4'
import { createDefaultTuning } from '../data/tuning'
import { teleportToArea } from '../sim/cheats'
import { buildLevel } from '../sim/level'
import { radarTarget } from '../sim/radar'
import { stepWorld } from '../sim/step'
import type { PlayerCommand } from '../sim/types'
import { createWorld } from '../sim/world'
import { arrowShape, radarHeading } from './radar-view'

describe('radar arrow', () => {
  it('points from the player at the exit of the area they are in', () => {
    const world = createWorld(buildLevel(LEVEL_1_4), createDefaultTuning())
    const target = radarTarget(world)
    if (!target) throw new Error('no radar target')
    const heading = radarHeading(world.player.pos, target)
    expect(Math.sin(heading)).toBeLessThan(0)
    expect(radarHeading({ x: 0, y: 0 }, { x: 0, y: -3 })).toBeCloseTo(-Math.PI / 2, 6)
  })

  it('has nothing to point at inside the boss arena', () => {
    const world = createWorld(buildLevel(LEVEL_1_4), createDefaultTuning())
    teleportToArea(world, world.level.areas.length - 1)
    const { x, y } = world.player.pos
    const still: PlayerCommand = { moveX: 0, moveY: 0, aimX: x, aimY: y - 1, pitch: 0, fire: false, slot: null, interact: false, skill: null, ultimate: false, jump: false, dash: false, melee: false }
    stepWorld(world, still, 1 / 60)
    expect(world.areaIndex).toBe(world.level.areas.length - 1)
    expect(radarTarget(world)).toBeNull()
  })

  it('draws an arrow that points along +X', () => {
    const points = arrowShape(1).getPoints()
    const tip = points.reduce((best, point) => (point.x > best.x ? point : best))
    expect(tip.x).toBeCloseTo(1, 6)
    expect(tip.y).toBeCloseTo(0, 6)
  })
})
