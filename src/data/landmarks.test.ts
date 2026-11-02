import { describe, expect, it } from 'vitest'
import { LANDMARKS, LANDMARK_IDS, type LandmarkId } from './landmarks'
import { LEVEL_1_1 } from './levels/level-1-1'
import { LEVEL_1_2 } from './levels/level-1-2'
import { LEVEL_1_3 } from './levels/level-1-3'
import { LEVEL_1_4 } from './levels/level-1-4'
import { LEVEL_1_5 } from './levels/level-1-5'

const REUSED_MODELS: readonly LandmarkId[] = ['grunt-wreck', 'grunt-wreck-drawing']

describe('landmark table', () => {
  it('lists every landmark once, chapter scenery with a chapter prefix', () => {
    expect(Object.keys(LANDMARKS).sort()).toEqual([...LANDMARK_IDS].sort())
    for (const id of LANDMARK_IDS) {
      if (REUSED_MODELS.includes(id)) expect(id).toMatch(/^[a-z]+(-[a-z0-9]+)+$/)
      else expect(id).toMatch(/^ch1-[a-z0-9-]+$/)
    }
  })

  it('keeps masks the same size as the footprint, with at least one occupied cell', () => {
    for (const id of LANDMARK_IDS) {
      const def = LANDMARKS[id]
      const [width, depth] = def.size
      expect(width, id).toBeGreaterThan(0)
      expect(depth, id).toBeGreaterThan(0)
      if (!def.footprint) continue
      expect(def.footprint, id).toHaveLength(depth)
      for (const line of def.footprint) expect(line, id).toMatch(new RegExp(`^[#.~]{${width}}$`))
      expect(def.footprint.join(''), id).toContain('#')
    }
  })

  it('only combines blocking flags the grid can express', () => {
    for (const id of LANDMARK_IDS) {
      const def = LANDMARKS[id]
      if (def.blocksShots) expect(def.blocksMovement, id).toBe(true)
      if (def.hides) expect(def.blocksMovement, id).toBe(false)
      expect(def.height, id).toBeGreaterThan(0)
      expect(Number.isInteger(def.variants ?? 1), id).toBe(true)
      expect(def.variants ?? 1, id).toBeGreaterThanOrEqual(1)
      for (const motion of def.motion ?? []) {
        expect(motion.node, id).not.toBe('')
        expect((motion.spin ?? 0) !== 0 || (motion.swing ?? 0) !== 0, id).toBe(true)
      }
    }
  })

  it('registers the landmarks of every chapter 1 level', () => {
    const byLevel = new Map<string, LandmarkId[]>()
    for (const id of LANDMARK_IDS) byLevel.set(LANDMARKS[id].level, [...(byLevel.get(LANDMARKS[id].level) ?? []), id])
    expect([...byLevel.keys()].sort()).toEqual(['1-1', '1-2', '1-3', '1-4', '1-5'])
    expect(byLevel.get('1-1')).toEqual(['ch1-town-gate', 'ch1-windmill', 'ch1-barn', 'ch1-star-altar', 'ch1-wheat-ears'])
    expect(LANDMARKS['ch1-windmill'].motion?.[0].node).toBe('sails')
    expect(LANDMARKS['ch1-barn'].building).toBe('barn')
  })

  it('places every 1-1 landmark in level 1-1 and nothing from later levels', () => {
    const placed = new Set(LEVEL_1_1.areas.flatMap((area) => (area.landmarks ?? []).map((landmark) => landmark.id)))
    const planned = LANDMARK_IDS.filter((id) => LANDMARKS[id].level === '1-1')
    expect([...placed].sort()).toEqual([...planned].sort())
  })

  it('places every 1-2 landmark in level 1-2, plus the wheat ears from 1-1', () => {
    const placed = new Set(LEVEL_1_2.areas.flatMap((area) => (area.landmarks ?? []).map((landmark) => landmark.id)))
    const planned = LANDMARK_IDS.filter((id) => LANDMARKS[id].level === '1-2')
    expect([...placed].sort()).toEqual([...planned, 'ch1-wheat-ears'].sort())
  })

  it('places every 1-3 landmark in level 1-3 and nothing from later levels', () => {
    const placed = new Set(LEVEL_1_3.areas.flatMap((area) => (area.landmarks ?? []).map((landmark) => landmark.id)))
    const planned = LANDMARK_IDS.filter((id) => LANDMARKS[id].level === '1-3')
    expect([...placed].sort()).toEqual([...planned].sort())
  })

  it('places every 1-4 landmark in level 1-4 and nothing from later levels', () => {
    const placed = new Set(LEVEL_1_4.areas.flatMap((area) => (area.landmarks ?? []).map((landmark) => landmark.id)))
    const planned = LANDMARK_IDS.filter((id) => LANDMARKS[id].level === '1-4')
    expect([...placed].sort()).toEqual([...planned].sort())
  })

  it('places every 1-5 landmark in level 1-5 except the blade trap, which rides the blade lanes', () => {
    const placed = new Set(LEVEL_1_5.areas.flatMap((area) => (area.landmarks ?? []).map((landmark) => landmark.id)))
    const planned = LANDMARK_IDS.filter((id) => LANDMARKS[id].level === '1-5' && id !== 'ch1-blade-trap')
    expect([...placed].sort()).toEqual([...planned].sort())
    expect(LEVEL_1_5.areas[0].blades).toHaveLength(3)
  })

  it('lets the player walk into the airship hold, and hides the balloon while they are inside it', () => {
    const ship = LANDMARKS['ch1-airship']
    expect(ship.footprint).toEqual(['######', ...Array.from({ length: 8 }, () => '#....#'), '##..##', '......', '......'])
    expect(ship).toMatchObject({ size: [6, 12], blocksMovement: true, blocksShots: true, hideInside: ['balloon'] })
    expect(ship.nodes).toContain('balloon')
    expect(LANDMARK_IDS.filter((id) => LANDMARKS[id].hideInside)).toEqual(['ch1-airship'])
  })

  it('spins the sawmill blade about X and rests a chest on the lumber pile, 2.5 m up', () => {
    expect(LANDMARKS['ch1-sawmill'].motion).toEqual([{ node: 'saw', axis: 'x', spin: 6 }])
    expect(LANDMARKS['ch1-sawmill'].perch).toEqual({ x: 1.47, y: -0.2, height: 2.5 })
    const perched = LANDMARK_IDS.filter((id) => LANDMARKS[id].perch)
    expect(perched).toEqual(['ch1-sawmill'])
  })

  it('makes the fog lamp the only lamp, the waterfall cave the only landmark with a pool, and stumps break only by crashes', () => {
    expect(LANDMARK_IDS.filter((id) => LANDMARKS[id].lamp)).toEqual(['ch1-fog-lamp'])
    expect(LANDMARKS['ch1-fog-lamp']).toMatchObject({ blocksMovement: true, blocksShots: false })
    expect(LANDMARK_IDS.filter((id) => LANDMARKS[id].pool)).toEqual(['ch1-waterfall-cave'])
    expect(LANDMARKS['ch1-waterfall-cave'].pool).toBe(1)
    expect(LANDMARKS['ch1-stump'].breaks).toEqual({ rule: 'crashes', hp: 0, into: 'b', xp: 0, target: false })
    expect(LANDMARKS['grunt-wreck-drawing']).toMatchObject({ size: [2, 1], blocksMovement: false, blocksShots: false, level: '1-4' })
  })

  it('breaks into a state model the landmark declares', () => {
    for (const id of LANDMARK_IDS) {
      const rule = LANDMARKS[id].breaks
      if (!rule) continue
      expect(LANDMARKS[id].states, id).toContain(rule.into)
      expect(LANDMARKS[id].blocksShots, id).toBe(true)
      if (rule.rule === 'hits') expect(rule.hp, id).toBeGreaterThan(0)
    }
    expect(LANDMARKS['ch1-hay-cart'].breaks).toMatchObject({ rule: 'hits', into: 'wreck', target: true })
    expect(LANDMARKS['ch1-hay-pillar'].breaks).toMatchObject({ rule: 'blasts', into: 'collapsed', target: false })
  })

  it('keeps gates on an occupied cell and opens a node the model has', () => {
    for (const id of LANDMARK_IDS) {
      const def = LANDMARKS[id]
      if (def.gate) {
        const [column, row] = def.gate
        const mask = def.footprint ?? Array.from({ length: def.size[1] }, () => '#'.repeat(def.size[0]))
        expect(mask[row]?.charAt(column), id).toBe('#')
        expect(def.opens, id).toEqual(['gate'])
      }
      for (const node of def.opens ?? []) expect(def.nodes, id).toContain(node)
    }
    expect(LANDMARKS['ch1-watermill'].opens).toEqual(['secret_door'])
    expect(LANDMARKS['ch1-cellar'].opens).toEqual(['door_l', 'door_r'])
  })

  it('only lets the dock and the watermill sit over water', () => {
    const decks = LANDMARK_IDS.filter((id) => LANDMARKS[id].deck)
    const wet = LANDMARK_IDS.filter((id) => (LANDMARKS[id].footprint ?? []).some((line) => line.includes('~')))
    expect(decks).toEqual(['ch1-dock'])
    expect(wet).toEqual(['ch1-watermill'])
    expect(LANDMARKS['ch1-dock'].blocksMovement).toBe(false)
  })
})
