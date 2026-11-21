import { describe, expect, it } from 'vitest'
import { LEVEL_1_1 } from '../data/levels/level-1-1'
import { LEVEL_1_2 } from '../data/levels/level-1-2'
import { LEVEL_1_3 } from '../data/levels/level-1-3'
import { RUSH_VARIETY } from '../data/levels/rules'
import type { DifficultyId } from '../data/difficulty'
import { createDefaultTuning } from '../data/tuning'
import { callReinforcements, raiseAlarm } from './alarms'
import { buildLevel } from './level'
import { createProfile, nextSeed, sanitizeProfile, seedOf, variedRun } from './profile'
import { idleCommand, stepWorld } from './step'
import { levelFromAreas } from './testing'
import type { SpawnMarker } from './types'
import { createWorld, type World } from './world'

const DT = 1 / 60
const FIELD = ['##########', '#........#', '#.m....m.#', '#........#', '#...m....#', '#........#', '#....P...#', '##########']
const BASE = [{ kind: 'grunt' as const, count: 5 }]
const MIXED = [{ kind: 'grunt' as const, count: 3 }, { kind: 'gunner' as const, count: 1 }]
const BOMBS = [{ kind: 'bomber' as const, count: 4 }]

function field(seed: number, varied: boolean, difficulty: DifficultyId = 'normal'): World {
  const tuning = createDefaultTuning()
  tuning.grunt.speed = 0
  tuning.grunt.sight = 0
  const level = levelFromAreas([
    { name: 'yard', theme: 'meadow', rows: FIELD, rushes: [{ at: [[2, 1], [7, 1]], enemies: BASE, variants: [MIXED, BOMBS], left: 2 }] },
  ])
  return createWorld(level, tuning, { seed, varied, difficulty, debug: { invincible: true } })
}

function rushOf(world: World): SpawnMarker[] {
  world.enemies[0].hp = 0
  for (let i = 0; i < 10 && world.spawns.length === 0; i++) {
    stepWorld(world, idleCommand(world), DT)
    world.events.length = 0
  }
  return [...world.spawns]
}

function recipe(markers: SpawnMarker[]): string {
  const counts = new Map<string, number>()
  for (const marker of markers) counts.set(marker.kind, (counts.get(marker.kind) ?? 0) + 1)
  return [...counts].map(([kind, count]) => `${kind}${count}`).sort().join('+')
}

describe('rush recipes', () => {
  it('always send the written squad on a first run at normal difficulty', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const markers = rushOf(field(seed, false))
      expect(recipe(markers)).toBe('grunt5')
      expect(markers.every((marker) => !marker.affixes)).toBe(true)
    }
  })

  it('draw one of the written recipes on a replay, and more than one over a few runs', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 24; seed++) seen.add(recipe(rushOf(field(seed, true))))
    expect([...seen].every((item) => ['grunt5', 'grunt3+gunner1', 'bomber4'].includes(item))).toBe(true)
    expect(seen.size).toBeGreaterThanOrEqual(2)
  })

  it('turn a charger or gunner of some waves into an elite with one affix, more often on hard', () => {
    let replay = 0
    let hard = 0
    for (let seed = 1; seed <= 200; seed++) {
      for (const [difficulty, bump] of [
        ['normal', () => (replay += 1)],
        ['hard', () => (hard += 1)],
      ] as const) {
        const elites = rushOf(field(seed, true, difficulty)).filter((marker) => marker.affixes)
        expect(elites.length).toBeLessThanOrEqual(1)
        for (const marker of elites) {
          expect(['grunt', 'gunner']).toContain(marker.kind)
          expect(marker.affixes).toHaveLength(1)
          bump()
        }
      }
    }
    expect(replay / 200).toBeGreaterThan(0.1)
    expect(replay / 200).toBeLessThan(0.3)
    expect(hard).toBeGreaterThan(replay)
  })

  it('spawn the promoted robot as an elite', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const world = field(seed, true, 'hard')
      const markers = rushOf(world)
      if (!markers.some((marker) => marker.affixes)) continue
      for (let i = 0; i < Math.round(3 / DT); i++) {
        stepWorld(world, idleCommand(world), DT)
        world.events.length = 0
      }
      expect(world.enemies.filter((enemy) => enemy.elite && enemy.hp > 0)).toHaveLength(1)
      return
    }
    throw new Error('no elite in sixty hard runs')
  })

  it('add at most two elites to a whole level', () => {
    for (const def of [LEVEL_1_1, LEVEL_1_2]) {
      const world = createWorld(buildLevel(def), createDefaultTuning(), { varied: true, difficulty: 'hard', debug: { invincible: true } })
      world.eliteChance = 1
      for (let step = 0; step < 40 && !world.rushed.every(Boolean); step++) {
        const index = world.rushed.findIndex((done) => !done)
        const area = world.level.rushes[index].area
        world.areaIndex = area
        for (const enemy of world.enemies) if (enemy.area === area) enemy.hp = 0
        world.spawns = world.spawns.filter((marker) => marker.area !== area)
        stepWorld(world, idleCommand(world), DT)
        world.events.length = 0
      }
      expect(world.rushed.every(Boolean)).toBe(true)
      expect(world.elitesAdded).toBe(RUSH_VARIETY.maxElites)
    }
  })

  it('give every wave of 1-1 and 1-2 two other recipes without new enemy kinds in 1-1', () => {
    for (const def of [LEVEL_1_1, LEVEL_1_2]) {
      for (const area of def.areas) {
        for (const rush of area.rushes ?? []) {
          expect(rush.variants).toHaveLength(2)
          for (const variant of rush.variants ?? []) {
            if (def === LEVEL_1_1) expect(variant.every((squad) => squad.kind === 'grunt' || squad.kind === 'gunner')).toBe(true)
          }
        }
      }
    }
  })
})

describe('the farm alarm reinforcements', () => {
  it('varies one four-enemy wave on replays and keeps a quiet courtyard free of reinforcements', () => {
    const level = buildLevel(LEVEL_1_3)
    const recipes = new Set<string>()
    for (let seed = 1; seed <= 24; seed++) {
      const world = createWorld(level, createDefaultTuning(), { seed, varied: true })
      world.eliteChance = 1
      world.areas[2].status = 'locked'
      for (const enemy of world.enemies) if (enemy.area === 2) enemy.hp = 0
      expect(callReinforcements(world, 2)).toBe(0)
      raiseAlarm(world)
      expect(world.spawns).toHaveLength(4)
      expect(world.spawns.filter((marker) => marker.affixes?.length)).toHaveLength(1)
      recipes.add(world.spawns.map((marker) => marker.kind).sort().join(','))
      expect(callReinforcements(world, 2)).toBe(0)
    }
    expect(recipes).toEqual(new Set(['grunt,grunt,shield,shield', 'grunt,grunt,grunt,shield', 'grunt,grunt,gunner,shield']))
  })
})

describe('run seeds', () => {
  it('counts the runs of each level in the save and seeds each run differently', () => {
    const profile = createProfile()
    const first = nextSeed(profile, '1-1')
    const second = nextSeed(profile, '1-1')
    const other = nextSeed(profile, '1-2')
    expect(profile.plays).toEqual({ '1-1': 2, '1-2': 1 })
    expect(new Set([first, second, other]).size).toBe(3)
    expect(seedOf('1-1', 1)).toBe(first)
    expect(sanitizeProfile(JSON.parse(JSON.stringify(profile))).plays).toEqual({ '1-1': 2, '1-2': 1 })
  })

  it('varies replays and every hard run, first clears included', () => {
    const profile = createProfile()
    expect(variedRun(profile, '1-1', 'normal')).toBe(false)
    expect(variedRun(profile, '1-1', 'hard')).toBe(true)
    profile.records['1-1'] = { cleared: true, bestStars: 1, bestTime: 100, clears: 1 }
    expect(variedRun(profile, '1-1', 'easy')).toBe(true)
  })
})
