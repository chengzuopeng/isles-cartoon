import { describe, expect, it } from 'vitest'
import { createDefaultTuning } from '../data/tuning'
import { buildLevel } from './level'
import { emitNoise } from './perception'
import { stepWorld } from './step'
import { levelFromAreas, singleArea } from './testing'
import type { Enemy, PlayerCommand } from './types'
import { createWorld, type World } from './world'

const DT = 1 / 60
const FIELD = [
  '##########################',
  '#........................#',
  '#........................#',
  '#........................#',
  '#........................#',
  '#P.......................#',
  '##########################',
]

function idle(aimX = 100, aimY = 3.5): PlayerCommand {
  return { moveX: 0, moveY: 0, aimX, aimY, fire: false, slot: null, interact: false, skill: null, ultimate: false, pitch: 0, jump: false, dash: false, melee: false }
}

function setup(rows = FIELD) {
  const tuning = createDefaultTuning()
  const world = createWorld(singleArea(rows), tuning)
  return { world, tuning }
}

function run(world: World, command: PlayerCommand, seconds: number): void {
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) stepWorld(world, command, DT)
}

function place(world: World, x: number, y: number): void {
  world.player.pos = { x, y }
  world.player.prev = { x, y }
}

function only(world: World): Enemy {
  const enemy = world.enemies[0]
  if (!enemy) throw new Error('no enemy')
  return enemy
}

describe('vision', () => {
  it('misses a player standing behind it at a distance', () => {
    const { world } = setup(['##########', '#P.....m.#', '##########'])
    const guard = only(world)
    guard.facing = guard.baseFacing = 0
    world.tuning.perception.sweepDeg = 0
    run(world, idle(), 0.5)
    expect(guard.aggro).toBe(false)
  })

  it('always feels a player who walks right up to it, unless the player comes from behind', () => {
    const { world } = setup(['##########', '#P.....m.#', '##########'])
    const guard = only(world)
    guard.facing = guard.baseFacing = Math.PI / 2
    world.tuning.perception.sweepDeg = 0
    place(world, 6, 1.5)
    stepWorld(world, idle(), DT)
    expect(guard.aggro).toBe(true)
    const { world: other } = setup(['##########', '#P.....m.#', '##########'])
    const turned = only(other)
    turned.facing = turned.baseFacing = 0
    other.tuning.perception.sweepDeg = 0
    place(other, 6, 1.5)
    stepWorld(other, idle(), DT)
    expect(turned.aggro).toBe(false)
  })
})

describe('alertness', () => {
  it('gets suspicious at gunfire, walks over to look, then goes home', () => {
    const tuning = createDefaultTuning()
    tuning.perception.sweepDeg = 0
    tuning.grunt.sight = 7
    const rows = FIELD.map((row, index) => (index === 3 ? '#..........m.............#' : row))
    const scene = createWorld(singleArea(rows), tuning)
    const guard = only(scene)
    guard.facing = guard.baseFacing = Math.PI / 2
    place(scene, 24.5, 5.5)
    emitNoise(scene, { x: 16.5, y: 3.5 }, tuning.perception.noiseRadius)
    expect(guard.alert).toBe('suspicious')
    expect(scene.events.some((event) => event.type === 'enemySuspicious')).toBe(true)
    run(scene, idle(), 2)
    expect(guard.pos.x).toBeGreaterThan(12.5)
    run(scene, idle(), 12)
    expect(guard.alert).toBe('idle')
    expect(Math.hypot(guard.pos.x - guard.home.x, guard.pos.y - guard.home.y)).toBeLessThan(0.6)
  })

  it('searches the last known spot after losing sight, then returns home', () => {
    const { world, tuning } = setup(['##########################', '#....m.............#.....#', '#P.................#.....#', '##########################'])
    const grunt = only(world)
    grunt.facing = grunt.baseFacing = 0
    place(world, 8.5, 1.5)
    stepWorld(world, idle(), DT)
    expect(grunt.aggro).toBe(true)
    place(world, 22.5, 2.5)
    run(world, idle(), tuning.perception.loseTime + 0.2)
    expect(grunt.aggro).toBe(false)
    expect(grunt.alert === 'search' || grunt.alert === 'return').toBe(true)
    run(world, idle(), 14)
    expect(grunt.alert).toBe('idle')
  })

  it('never gives up inside a locked area', () => {
    const level = levelFromAreas([
      { name: 'start', theme: 'meadow', rows: ['#............#', '#.....P......#', '##############'] },
      {
        name: 'pen',
        theme: 'village',
        kind: 'lock',
        rows: ['##############', '#............#', '#............#', '#..........m.#', '#............#', '#............#', '#####DDD######'],
      },
    ])
    const tuning = createDefaultTuning()
    tuning.grunt.speed = 0
    const world = createWorld(level, tuning)
    place(world, 6.5, 2.5)
    run(world, idle(), 0.2)
    const grunt = only(world)
    expect(world.areas[1].status).toBe('locked')
    tuning.grunt.sight = 0.5
    run(world, idle(), tuning.perception.loseTime + 1)
    expect(grunt.aggro).toBe(true)
  })
})

describe('idle behaviour', () => {
  it('walks a patrol route from the level file', () => {
    const level = buildLevel({
      id: 'patrol',
      title: 'patrol',
      subtitle: '',
      objective: '',
      chapter: 1,
      parSeconds: 600,
      maxHits: 99,
      areas: [
        {
          name: 'field',
          theme: 'meadow',
          patrols: [{ from: [2, 1], points: [[12, 1]] }],
          rows: ['##############', '#.m..........#', '#............#', '#............#', '#...........P#', '##############'],
        },
      ],
    })
    const world = createWorld(level, createDefaultTuning())
    const walker = only(world)
    expect(walker.idleMode).toBe('patrol')
    run(world, idle(13, 4.5), 5)
    expect(walker.pos.x).toBeGreaterThan(8)
  })

  it('wanders around its post', () => {
    const tuning = createDefaultTuning()
    const level = buildLevel({
      id: 'wander',
      title: 'wander',
      subtitle: '',
      objective: '',
      chapter: 1,
      parSeconds: 600,
      maxHits: 99,
      areas: [{ name: 'yard', theme: 'village', idle: 'wander', rows: FIELD.map((row, index) => (index === 3 ? '#..........m.............#' : index === 5 ? '#P.......................#' : row)) }],
    })
    const world = createWorld(level, tuning)
    world.player.pos = { x: 1.5, y: 5.5 }
    const walker = only(world)
    walker.facing = walker.baseFacing = 0
    run(world, idle(1.5, 1.5), 6)
    expect(Math.hypot(walker.pos.x - walker.home.x, walker.pos.y - walker.home.y)).toBeGreaterThan(0.3)
    expect(Math.hypot(walker.pos.x - walker.home.x, walker.pos.y - walker.home.y)).toBeLessThan(tuning.perception.wanderRadius + 0.6)
  })
})
