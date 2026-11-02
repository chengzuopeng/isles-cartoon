import { eyeHeightOf } from '../data/heights'
import type { AreaDef, AreaKind, LevelDef } from '../data/levels/types'
import { floorAt } from './grid'
import { buildLevel, type BuiltLevel } from './level'
import { bodyHeight } from './terrain'
import type { Enemy } from './types'
import type { World } from './world'

export function levelFromAreas(areas: AreaDef[], overrides: Partial<LevelDef> = {}): BuiltLevel {
  return buildLevel({
    id: 'test',
    title: 'test',
    subtitle: '',
    objective: '',
    chapter: 1,
    parSeconds: 600,
    maxHits: 99,
    areas,
    ...overrides,
  })
}

export function singleArea(rows: string[], kind: AreaKind = 'normal', overrides: Partial<LevelDef> = {}): BuiltLevel {
  return levelFromAreas([{ name: 'test', theme: 'meadow', kind, rows }], overrides)
}

export function pitchToward(world: World, x: number, y: number, height: number): number {
  const { player } = world
  const eye = player.z + eyeHeightOf('player')
  const target = floorAt(world.grid, x, y) + height
  return Math.atan2(target - eye, Math.max(1e-6, Math.hypot(x - player.pos.x, y - player.pos.y)))
}

export function pitchAt(world: World, enemy: Enemy): number {
  return pitchToward(world, enemy.pos.x, enemy.pos.y, bodyHeight(enemy) / 2)
}
