import { describe, expect, it } from 'vitest'
import { BOSSES } from '../data/bosses'
import { MINION_KINDS } from '../data/enemies'
import { LEVEL_1_1 } from '../data/levels/level-1-1'
import { LEVEL_1_2 } from '../data/levels/level-1-2'
import { LEVEL_1_3 } from '../data/levels/level-1-3'
import { LEVEL_1_4 } from '../data/levels/level-1-4'
import { LEVEL_1_5 } from '../data/levels/level-1-5'
import { TRAINING } from '../data/levels/training'
import { TRIAL_HARVESTER } from '../data/levels/trial-harvester'
import { TRIAL_SYSTEMS } from '../data/levels/trial-systems'
import { buildLevel } from '../sim/level'
import { singleArea } from '../sim/testing'
import { MODEL_IDS, RESIDENT_MODEL_IDS } from './asset-urls'
import { isModelId, levelEnemyKinds, levelModelIds, levelsToKeep, modelsFor, nextLevel } from './level-models'

const ALL = [LEVEL_1_1, LEVEL_1_2, LEVEL_1_3, LEVEL_1_4, LEVEL_1_5, TRIAL_SYSTEMS, TRIAL_HARVESTER, TRAINING]

describe('level models', () => {
  it('lists only registered model ids, sorted and without repeats', () => {
    for (const def of ALL) {
      const ids = levelModelIds(buildLevel(def))
      expect(ids.every(isModelId)).toBe(true)
      expect(ids).toEqual([...new Set(ids)].sort())
    }
  })

  it('always keeps the resident models on top of the level models', () => {
    for (const def of ALL) {
      const ids = modelsFor(buildLevel(def))
      for (const id of RESIDENT_MODEL_IDS) expect(ids).toContain(id)
      for (const id of levelModelIds(buildLevel(def))) expect(ids).toContain(id)
    }
  })

  it('brings every variant and broken state of the landmarks a level places', () => {
    const ids = levelModelIds(buildLevel(LEVEL_1_2))
    expect(ids).toEqual(expect.arrayContaining(['ch1-hay-cart', 'ch1-hay-cart-wreck', 'ch1-hay-pillar', 'ch1-hay-pillar-collapsed', 'ch1-watermill']))
    expect(levelModelIds(buildLevel(LEVEL_1_4))).toEqual(expect.arrayContaining(['ch1-stump', 'ch1-stump-b', 'ch1-stump-c', 'ch1-ladder']))
  })

  it('picks the prop models of each area theme with all their variants', () => {
    const meadow = levelModelIds(singleArea(['#####', '#P.T#', '#####']))
    expect(meadow).toEqual(expect.arrayContaining(['ch1-wall-stone', 'ch1-wall-stone-b', 'ch1-wall-stone-c', 'ch1-tree', 'ch1-tree-b', 'ch1-tree-c']))
    expect(meadow).not.toContain('ch1-wall-wood')
  })

  it('leaves out the models of other levels', () => {
    const ids = levelModelIds(buildLevel(LEVEL_1_1))
    for (const id of ['forest-tank', 'ch1-sawmill', 'demo-chief', 'ch1-bell-tower', 'harvester']) expect(ids).not.toContain(id)
  })

  it('adds the boss, its extra parts and the minions it summons or the alarm calls in', () => {
    const harvester = levelModelIds(buildLevel(TRIAL_HARVESTER))
    expect(harvester).toEqual(expect.arrayContaining(['harvester', 'shard-morning']))
    const summoned = BOSSES.harvester.phases.flatMap((phase) => (phase.summon ? [phase.summon.kind] : []))
    for (const kind of summoned) expect(harvester).toContain(kind)
    const farm = buildLevel(LEVEL_1_3)
    const called = farm.reinforcements.flatMap((reinforcement) => reinforcement.enemies.map((summon) => summon.kind))
    expect(called.length).toBeGreaterThan(0)
    for (const kind of called) expect(levelEnemyKinds(farm)).toContain(kind)
  })

  it('brings every minion for the wave arena and the elite crown only where elites stand', () => {
    expect(levelEnemyKinds(buildLevel(TRAINING))).toEqual(MINION_KINDS)
    expect(levelModelIds(buildLevel(TRIAL_SYSTEMS))).toContain('elite-crown')
    expect(levelModelIds(buildLevel(LEVEL_1_1))).not.toContain('elite-crown')
  })

  it('gives every registered model a level or the resident set', () => {
    const used = new Set([...RESIDENT_MODEL_IDS, ...ALL.flatMap((def) => levelModelIds(buildLevel(def)))])
    const unused = MODEL_IDS.filter((id) => !used.has(id))
    expect(unused).toEqual([])
  })
})

describe('which levels stay loaded', () => {
  it('keeps the current level and the most recently played one', () => {
    expect(levelsToKeep('1-2', null, ['1-2', '1-1'], 1)).toEqual(['1-2', '1-1'])
    expect(levelsToKeep('1-3', null, ['1-2', '1-1'], 1)).toEqual(['1-3', '1-2'])
    expect(levelsToKeep('1-1', null, [], 1)).toEqual(['1-1'])
  })

  it('gives the slot to the level being prepared ahead', () => {
    expect(levelsToKeep('1-2', '1-3', ['1-2', '1-1'], 1)).toEqual(['1-2', '1-3'])
    expect(levelsToKeep('1-2', '1-2', ['1-2', '1-1'], 1)).toEqual(['1-2', '1-1'])
    expect(levelsToKeep('1-2', '1-3', ['1-2', '1-1'], 2)).toEqual(['1-2', '1-3', '1-1'])
  })

  it('drops every other level when nothing extra is allowed', () => {
    expect(levelsToKeep('1-2', '1-3', ['1-1'], 0)).toEqual(['1-2'])
  })

  it('looks ahead to the level that clearing this one unlocks', () => {
    const levels = [LEVEL_1_1, LEVEL_1_2, LEVEL_1_3, LEVEL_1_4, TRIAL_SYSTEMS, TRIAL_HARVESTER]
    expect(nextLevel(levels, '1-1')?.id).toBe('1-2')
    expect(nextLevel(levels, '1-2')?.id).toBe('1-3')
    expect(nextLevel(levels, '1-3')?.id).toBe('1-4')
    expect(nextLevel(levels, '1-4')).toBeNull()
    expect(nextLevel(levels, 'trial-harvester')).toBeNull()
  })
})
