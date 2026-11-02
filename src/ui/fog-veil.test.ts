import { describe, expect, it } from 'vitest'
import { FOG } from '../data/fog'
import { LEVEL_1_3 } from '../data/levels/level-1-3'
import { LEVEL_1_4 } from '../data/levels/level-1-4'
import { createDefaultTuning } from '../data/tuning'
import { FOG_VEIL } from '../render/themes'
import { fogged } from '../sim/fog'
import { buildLevel } from '../sim/level'
import { createWorld, type World } from '../sim/world'
import { followsFog } from './damage-numbers'
import { fogVeil, hiddenInFog } from './fog-veil'

function foggedSpot(world: World): { x: number; y: number } {
  const area = world.level.areas.find((item) => item.fog)
  if (!area) throw new Error('no fog area')
  for (let row = area.top; row < area.bottom; row++) {
    for (let column = 0; column < world.level.grid.columns; column++) {
      if (fogged(world, column + 0.5, row + 0.5)) return { x: column + 0.5, y: row + 0.5 }
    }
  }
  throw new Error('no fogged cell')
}

describe('fog veil for head marks', () => {
  it('hides marks over enemies the fog hides, and nothing in levels without fog', () => {
    const forest = createWorld(buildLevel(LEVEL_1_4), createDefaultTuning())
    const spot = foggedSpot(forest)
    forest.player.pos = { x: spot.x, y: spot.y + FOG.sight + 2 }
    expect(hiddenInFog(forest, spot.x, spot.y)).toBe(true)
    forest.player.pos = { x: spot.x, y: spot.y + FOG.sight - 1 }
    expect(hiddenInFog(forest, spot.x, spot.y)).toBe(false)
    const farm = createWorld(buildLevel(LEVEL_1_3), createDefaultTuning())
    farm.player.pos = { x: 2.5, y: 2.5 }
    expect(hiddenInFog(farm, 30.5, 40.5)).toBe(false)
  })

  it('starts a new mark at its target and fades a shown one with the body', () => {
    expect(fogVeil(-1, true, 0.016)).toBe(1)
    expect(fogVeil(-1, false, 0.016)).toBe(0)
    expect(fogVeil(0, true, FOG_VEIL.seconds / 2)).toBeCloseTo(0.5, 6)
    expect(fogVeil(0.5, true, FOG_VEIL.seconds)).toBe(1)
    expect(fogVeil(1, false, FOG_VEIL.seconds)).toBe(0)
  })

  it('fades the alert marks but keeps the damage numbers from your own shots', () => {
    expect(followsFog('alert')).toBe(true)
    for (const kind of ['enemy', 'player', 'heal', 'loot', 'shield', 'xp'] as const) expect(followsFog(kind)).toBe(false)
  })
})
