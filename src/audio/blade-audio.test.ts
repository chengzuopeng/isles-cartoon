import { describe, expect, it } from 'vitest'
import { LEVEL_1_5 } from '../data/levels/level-1-5'
import { createDefaultTuning } from '../data/tuning'
import { buildLevel } from '../sim/level'
import { createWorld } from '../sim/world'
import { BLADE_AUDIO, bladeLoudness, falloff, laneDistance } from './blade-audio'

const level = buildLevel(LEVEL_1_5)
const [south, middle, north] = level.blades

function standing(x: number, y: number) {
  const world = createWorld(level, createDefaultTuning())
  world.player.pos = { x, y }
  return world
}

describe('blade sounds', () => {
  it('measures how far the player stands from a lane, zero inside it', () => {
    expect(laneDistance(south, { x: 10, y: south.row + 1 })).toBe(0)
    expect(laneDistance(south, { x: 10, y: south.row - 3 })).toBeCloseTo(3)
    expect(laneDistance(south, { x: 0, y: south.row + 2 + 4 })).toBeCloseTo(Math.hypot(1, 4))
  })

  it('is full next to the blade and fades out to nothing a few lanes away', () => {
    expect(falloff(0)).toBe(1)
    expect(falloff(BLADE_AUDIO.full)).toBe(1)
    expect(falloff((BLADE_AUDIO.full + BLADE_AUDIO.silent) / 2)).toBeCloseTo(0.5)
    expect(falloff(BLADE_AUDIO.silent)).toBe(0)
  })

  it('plays the lane the player stands in, the next lane softer, and keeps the far lane quiet', () => {
    const inLane = standing(19.5, south.row + 1)
    expect(inLane.areaIndex).toBe(south.area)
    expect(bladeLoudness(inLane, 0)).toBe(1)
    expect(bladeLoudness(inLane, 1)).toBeGreaterThan(0)
    expect(bladeLoudness(inLane, 1)).toBeLessThan(0.5)
    expect(bladeLoudness(inLane, 2)).toBe(0)
    expect(bladeLoudness(inLane, 0, { x: 38, y: south.row + 1 })).toBe(0)
    expect(bladeLoudness(inLane, 0, { x: 20.5, y: south.row + 1 })).toBe(1)
    expect(bladeLoudness(inLane, 7)).toBe(0)
  })

  it('stays quiet for a player in another area unless they stand right by the lane', () => {
    const away = standing(19.5, north.row - 8)
    away.areaIndex = north.area + 1
    expect(bladeLoudness(away, 2)).toBe(0)
    const door = standing(19.5, north.row - 2)
    door.areaIndex = north.area + 1
    expect(bladeLoudness(door, 2)).toBe(1)
    expect(bladeLoudness(door, 1)).toBe(0)
    expect(middle.area).toBe(north.area)
  })
})
