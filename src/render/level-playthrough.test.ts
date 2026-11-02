import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { AUTOPILOT_KITE_LEVELS, AUTOPILOT_ONWARD_LEVELS, AUTOPILOT_SIEGE_LEVELS } from '../data/autopilot'
import { LEVEL_1_1 } from '../data/levels/level-1-1'
import { LEVEL_1_2 } from '../data/levels/level-1-2'
import { LEVEL_1_3 } from '../data/levels/level-1-3'
import { LEVEL_1_4 } from '../data/levels/level-1-4'
import { LEVEL_1_5 } from '../data/levels/level-1-5'
import { TRIAL_HARVESTER } from '../data/levels/trial-harvester'
import { TRIAL_SYSTEMS } from '../data/levels/trial-systems'
import type { LevelDef } from '../data/levels/types'
import { createDefaultTuning } from '../data/tuning'
import { createAutopilot } from '../sim/autopilot'
import { buildLevel } from '../sim/level'
import { stepWorld } from '../sim/step'
import { createLoadout } from '../sim/stats'
import { createWorld, type World } from '../sim/world'
import { MODEL_IDS, RESIDENT_MODEL_IDS, type ModelId } from './asset-urls'
import { createEffects } from './effects'
import { createEntityViews } from './entity-views'
import { createFpsLevelView } from './fps-level-view'
import { modelsFor } from './level-models'
import type { ModelLibrary } from './model-library'
import { createPickupViews } from './pickup-views'
import { createProjectileViews } from './projectile-views'
import { createRingViews } from './ring-views'
import type { Stage } from './stage'
import { glbLibrary, recordingLibrary, stubImages } from './testing'

const LEVELS: readonly LevelDef[] = [LEVEL_1_1, LEVEL_1_2, LEVEL_1_3, LEVEL_1_4, LEVEL_1_5, TRIAL_SYSTEMS, TRIAL_HARVESTER]
const RUN_TIMEOUT = 60_000
const STEP = 1 / 60
const SYNC_EVERY = 3
const LIMIT_SECONDS = 15 * 60
const SEED = 1
const everything = await glbLibrary(MODEL_IDS)

function inert(): unknown {
  const target = () => inert()
  return new Proxy(target, { get: (_, key) => (key === Symbol.toPrimitive ? () => 0 : inert()), set: () => true, apply: () => inert() })
}

function stubCanvas(): () => void {
  const scope = globalThis as unknown as { document?: Record<string, unknown> }
  const restoreImages = stubImages()
  const document = scope.document
  if (!document || document.createElement) return restoreImages
  document.createElement = () => ({ width: 0, height: 0, style: {}, getContext: () => inert(), addEventListener: () => {}, removeEventListener: () => {} })
  return () => {
    delete document.createElement
    restoreImages()
  }
}

function playLevel(def: LevelDef, models: ModelLibrary): World {
  const restore = stubCanvas()
  try {
    const tuning = createDefaultTuning()
    const level = buildLevel(def)
    const scene = new THREE.Scene()
    const stage = { scene, addTrauma: () => {} } as unknown as Stage
    const effects = createEffects(scene)
    const levelView = createFpsLevelView(level, models)
    scene.add(levelView.group)
    const views = createEntityViews(stage, tuning, effects, { showSight: false }, models)
    const pickups = createPickupViews(scene, models)
    const projectiles = createProjectileViews(scene, models, effects)
    const rings = createRingViews(scene)
    const loadout = createLoadout({ health: 2, damage: 1 }, [
      { slot: 'q', id: 'barrier', rank: 1 },
      { slot: 'e', id: 'shockwave', rank: 1 },
    ])
    const world = createWorld(level, tuning, { seed: SEED, loadout, debug: { invincible: true } })
    const pilot = createAutopilot({
      skill: 'perfect',
      seed: SEED,
      siege: AUTOPILOT_SIEGE_LEVELS.includes(def.id),
      onward: AUTOPILOT_ONWARD_LEVELS.includes(def.id),
      kite: AUTOPILOT_KITE_LEVELS.includes(def.id),
    })
    const dt = STEP * SYNC_EVERY
    const sync = () => {
      for (const event of world.events.splice(0)) {
        levelView.handle(event)
        views.handle(event)
        projectiles.handle(event)
      }
      levelView.update(world, dt)
      views.sync(world, 1, dt)
      pickups.sync(world, dt)
      projectiles.sync(world, 1, dt)
      rings.sync(world, 1)
      effects.update(dt)
    }
    sync()
    for (let step = 1; step <= LIMIT_SECONDS / STEP && world.status === 'playing'; step++) {
      stepWorld(world, pilot.next(world), STEP)
      if (step % SYNC_EVERY === 0) sync()
    }
    sync()
    return world
  } finally {
    restore()
  }
}

describe('a full autopilot run of each level in first person', () => {
  for (const def of LEVELS) {
    const used = new Set<ModelId>()
    it(`${def.id} reaches the exit with every view attached`, () => {
      const world = playLevel(def, recordingLibrary(everything, used))
      expect(world.status).toBe('complete')
    }, RUN_TIMEOUT)
    it(`${def.id} draws only models its level loads`, () => {
      const wanted = new Set<ModelId>([...RESIDENT_MODEL_IDS, ...modelsFor(buildLevel(def)), 'blaster' as ModelId])
      expect(used.size).toBeGreaterThan(0)
      expect([...used].filter((id) => !wanted.has(id))).toEqual([])
    })
  }
})
