import { describe, expect, it } from 'vitest'
import { createDefaultTuning } from '../data/tuning'
import { killEnemy } from './combat'
import { Tile } from './grid'
import { stepWorld } from './step'
import { levelFromAreas } from './testing'
import type { PlayerCommand } from './types'
import { createWorld, type World } from './world'

const DT = 1 / 60
const IDLE: PlayerCommand = { moveX: 0, moveY: 0, aimX: 3.5, aimY: 0, fire: false, slot: null, interact: false, skill: null, ultimate: false, pitch: 0, jump: false, dash: false, melee: false }

const LOCK_LEVEL = levelFromAreas([
  { name: 'start', theme: 'meadow', rows: ['#.....#', '#..P..#', '#######'] },
  {
    name: 'yard',
    theme: 'village',
    kind: 'lock',
    rows: ['###D###', '#.....#', '#..m..#', '#.....#', '#.....#', '#.....#', '###D###'],
  },
  { name: 'end', theme: 'meadow', rows: ['#######', '#..X..#', '#.....#'] },
])

function setup() {
  const tuning = createDefaultTuning()
  tuning.grunt.speed = 0
  return createWorld(LOCK_LEVEL, tuning)
}

function place(world: World, x: number, y: number): void {
  world.player.pos = { x, y }
  world.player.prev = { x, y }
}

function gatesAre(world: World, tile: Tile): boolean {
  return LOCK_LEVEL.areas[1].gates.every((index) => world.grid.tiles[index] === tile)
}

describe('areas', () => {
  it('announces each area the first time the player enters it', () => {
    const world = setup()
    stepWorld(world, IDLE, DT)
    place(world, 3.5, 8.5)
    stepWorld(world, IDLE, DT)
    stepWorld(world, IDLE, DT)
    const entered = world.events.filter((event) => event.type === 'areaEntered')
    expect(entered.map((event) => (event.type === 'areaEntered' ? event.name : ''))).toEqual(['start', 'yard'])
  })

  it('locks the gates once the player is inside and opens them when the area is clear', () => {
    const world = setup()
    place(world, 3.5, 6.5)
    stepWorld(world, IDLE, DT)
    expect(gatesAre(world, Tile.GateClosed)).toBe(true)
    expect(world.areas[1].status).toBe('locked')
    expect(world.enemies[0].aggro).toBe(true)
    killEnemy(world, world.enemies[0], true)
    stepWorld(world, IDLE, DT)
    expect(gatesAre(world, Tile.Gate)).toBe(true)
    expect(world.areas[1].status).toBe('cleared')
  })

  it('does not lock an area that was already cleared from outside', () => {
    const world = setup()
    killEnemy(world, world.enemies[0], true)
    place(world, 3.5, 6.5)
    stepWorld(world, IDLE, DT)
    expect(gatesAre(world, Tile.Gate)).toBe(true)
    expect(world.areas[1].status).toBe('cleared')
  })

  it('completes the level when the player reaches the exit', () => {
    const world = setup()
    place(world, 3.5, 1.5)
    stepWorld(world, IDLE, DT)
    expect(world.status).toBe('complete')
    const time = world.stats.time
    stepWorld(world, IDLE, DT)
    expect(world.stats.time).toBe(time)
  })
})
