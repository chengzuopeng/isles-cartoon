import { describe, expect, it } from 'vitest'
import { LANDMARKS } from '../data/landmarks'
import { createDefaultTuning } from '../data/tuning'
import { spawnBlast } from './combat'
import { Tile, blocksBullets, blocksMovement } from './grid'
import { breakLandmark, targetTally } from './landmark-state'
import { spawnBullet } from './projectiles'
import { stepWorld } from './step'
import { levelFromAreas } from './testing'
import type { PlayerCommand } from './types'
import { createWorld, type World } from './world'

const DT = 1 / 60
const CART = LANDMARKS['ch1-hay-cart'].breaks!

const YARD = levelFromAreas([
  { name: 'start', theme: 'meadow', rows: ['#..........#', '#....P.....#', '#..........#'] },
  {
    name: 'yard',
    theme: 'farm',
    kind: 'destroy',
    rows: ['#####DD#####', '#..........#', '#..........#', '#..........#', '#..........#'],
    landmarks: [
      { id: 'ch1-hay-cart', at: [2, 1] },
      { id: 'ch1-hay-cart', at: [8, 1] },
    ],
    clues: [{ id: 'iou', dropBy: 'firstTarget' }],
  },
  { name: 'end', theme: 'meadow', rows: ['############', '#....XX....#', '#..........#'] },
])

const BARN = levelFromAreas([
  {
    name: 'barn',
    theme: 'arena',
    rows: ['##########', '#.......X#', '#........#', '#........#', '#........#', '#...P....#', '##########'],
    landmarks: [{ id: 'ch1-hay-pillar', at: [2, 2] }],
  },
])

function idle(aimX = 3, aimY = 0): PlayerCommand {
  return { moveX: 0, moveY: 0, aimX, aimY, fire: false, slot: null, interact: false, skill: null, ultimate: false, pitch: 0, jump: false, dash: false, melee: false }
}

function run(world: World, command: PlayerCommand, seconds: number): void {
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) stepWorld(world, command, DT)
}

function place(world: World, x: number, y: number): void {
  world.player.pos = { x, y }
  world.player.prev = { x, y }
}

function events(world: World, type: string) {
  return world.events.filter((event) => event.type === type)
}

function gateTiles(world: World): number[] {
  return world.level.areas[1].gates.map((index) => world.grid.tiles[index])
}

describe('breakable targets', () => {
  it('soaks up the player bullets but not enemy fire', () => {
    const world = createWorld(YARD, createDefaultTuning())
    spawnBullet(world, 'enemy', 3, 9.5, 0, -Math.PI / 2, 'rifle')
    run(world, idle(), 0.6)
    expect(world.landmarks[0].hp).toBe(CART.hp)
    spawnBullet(world, 'player', 3, 9.5, 0, -Math.PI / 2, 'blaster')
    run(world, idle(), 0.6)
    expect(world.landmarks[0].hp).toBe(CART.hp - world.tuning.weapons.blaster.damage)
    expect(events(world, 'landmarkHit')).toHaveLength(1)
  })

  it('takes damage from every round blast that reaches it, whoever set it off', () => {
    const world = createWorld(YARD, createDefaultTuning())
    const base = { radius: 1, delay: 0, ownerId: 0 }
    spawnBlast(world, { ...base, x: 3, y: 7.5, playerDamage: 300, enemyDamage: 400, source: 'bomber' })
    spawnBlast(world, { ...base, x: 3, y: 7.5, playerDamage: 0, enemyDamage: 230, source: 'player' })
    spawnBlast(world, { ...base, x: 3, y: 9.5, playerDamage: 0, enemyDamage: 230, source: 'player' })
    spawnBlast(world, { ...base, x: 3, y: 7.5, playerDamage: 200, enemyDamage: 0, source: 'boss', arcCenter: 0, arcWidth: 1 })
    stepWorld(world, idle(), DT)
    expect(world.landmarks[0].hp).toBe(CART.hp - 400 - 230)
    expect(world.landmarks[1].hp).toBe(CART.hp)
  })

  it('turns into a low wreck that bullets fly over and pays a little experience', () => {
    const world = createWorld(YARD, createDefaultTuning())
    const cart = world.level.landmarks[0]
    breakLandmark(world, 0)
    expect(world.landmarks[0]).toMatchObject({ broken: true, hp: 0 })
    for (const cell of cart.cells) {
      expect(world.grid.tiles[cell]).toBe(Tile.LandmarkLow)
      expect(blocksMovement(world.grid.tiles[cell] as Tile)).toBe(true)
      expect(blocksBullets(world.grid.tiles[cell] as Tile)).toBe(false)
    }
    expect(events(world, 'landmarkBroken')).toEqual([{ type: 'landmarkBroken', index: 0, id: 'ch1-hay-cart', state: 'wreck', x: 3, y: 5.5 }])
    expect(world.rewards.targets).toBe(CART.xp)
    expect(events(world, 'bonusXp')).toHaveLength(1)
    breakLandmark(world, 0)
    expect(world.rewards.targets).toBe(CART.xp)
  })

  it('keeps the north gate of a destroy area shut until every target is broken, enemies or not', () => {
    const world = createWorld(YARD, createDefaultTuning())
    expect(world.areas[1].status).toBe('sealed')
    expect(gateTiles(world)).toEqual([Tile.GateClosed, Tile.GateClosed])
    expect(targetTally(world, 1)).toEqual({ done: 0, total: 2 })
    place(world, 5.5, 7.5)
    stepWorld(world, idle(), DT)
    expect(world.areaIndex).toBe(1)
    breakLandmark(world, 0)
    stepWorld(world, idle(), DT)
    expect(world.areas[1].status).toBe('sealed')
    breakLandmark(world, 1)
    stepWorld(world, idle(), DT)
    expect(world.areas[1].status).toBe('cleared')
    expect(gateTiles(world)).toEqual([Tile.Gate, Tile.Gate])
    expect(events(world, 'areaCleared')).toEqual([{ type: 'areaCleared', index: 1 }])
    expect(events(world, 'areaLocked')).toHaveLength(0)
  })

  it('drops the waiting clue next to the first target that breaks, on the side of the player', () => {
    const world = createWorld(YARD, createDefaultTuning())
    expect(world.clues).toHaveLength(0)
    place(world, 3, 9.5)
    breakLandmark(world, 0)
    expect(world.clues).toEqual([{ id: 0, clue: 'iou', pos: { x: 2.5, y: 7.5 }, area: 1, taken: false }])
    expect(events(world, 'clueDropped')).toHaveLength(1)
    breakLandmark(world, 1)
    expect(world.clues).toHaveLength(1)
  })
})

describe('hay pillars', () => {
  it('collapse when any blast reaches their footprint and ignore bullets', () => {
    const world = createWorld(BARN, createDefaultTuning())
    const pillar = world.level.landmarks[0]
    for (let i = 0; i < 20; i++) spawnBullet(world, 'player', 3, 5.5, 0, -Math.PI / 2, 'blaster')
    run(world, idle(), 0.5)
    expect(world.landmarks[0].broken).toBe(false)
    spawnBlast(world, { x: 6.6, y: 3, radius: 1.5, delay: 0, playerDamage: 170, enemyDamage: 0, source: 'bomber', ownerId: 0 })
    stepWorld(world, idle(), DT)
    expect(world.landmarks[0].broken).toBe(false)
    spawnBlast(world, { x: 5.4, y: 3, radius: 1.5, delay: 0, playerDamage: 170, enemyDamage: 0, source: 'bomber', ownerId: 0 })
    stepWorld(world, idle(), DT)
    expect(world.landmarks[0].broken).toBe(true)
    expect(events(world, 'landmarkBroken')).toEqual([{ type: 'landmarkBroken', index: 0, id: 'ch1-hay-pillar', state: 'collapsed', x: 3, y: 3 }])
    for (const cell of pillar.cells) expect(world.grid.tiles[cell]).toBe(Tile.LandmarkLow)
    expect(world.rewards.targets).toBe(0)
  })
})
