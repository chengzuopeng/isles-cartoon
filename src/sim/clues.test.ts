import { describe, expect, it } from 'vitest'
import { BARKS, BARK_SECONDS, type Bark } from '../data/dialogue'
import { LEVEL_1_1 } from '../data/levels/level-1-1'
import { LEVEL_1_2 } from '../data/levels/level-1-2'
import { LEVEL_1_3 } from '../data/levels/level-1-3'
import { createDefaultTuning } from '../data/tuning'
import { updateBarks } from './barks'
import { Tile, floorAt, tileAt } from './grid'
import { breakLandmark } from './landmark-state'
import { buildLevel } from './level'
import { aggro } from './perception'
import { stepWorld } from './step'
import { runTallies } from './tallies'
import { levelFromAreas } from './testing'
import type { GameEvent, PlayerCommand } from './types'
import { createWorld, type World } from './world'

const DT = 1 / 60

function idle(): PlayerCommand {
  return { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false, slot: null, interact: false, skill: null, ultimate: false, pitch: 0, jump: false, dash: false, melee: false }
}

function place(world: World, x: number, y: number): void {
  world.player.pos = { x, y }
  world.player.prev = { x, y }
}

function step(world: World): GameEvent[] {
  world.events.length = 0
  stepWorld(world, idle(), DT)
  return [...world.events]
}

describe('clues on the ground', () => {
  const level = levelFromAreas([
    { name: 'room', theme: 'meadow', rows: ['########', '#.....X#', '#......#', '#..P...#', '########'], clues: [{ id: 'star-altar', at: [5, 1] }] },
  ])

  it('are picked up just by walking close, once', () => {
    const world = createWorld(level, createDefaultTuning())
    expect(world.clues).toEqual([{ id: 0, clue: 'star-altar', pos: { x: 5.5, y: 1.5 }, area: 0, taken: false }])
    expect(step(world).some((event) => event.type === 'clueFound')).toBe(false)
    place(world, 5.5, 2.55)
    expect(step(world).filter((event) => event.type === 'clueFound')).toEqual([{ type: 'clueFound', id: 0, clue: 'star-altar', x: 5.5, y: 1.5 }])
    expect(world.cluesFound).toEqual(['star-altar'])
    expect(world.clues[0].taken).toBe(true)
    expect(step(world).some((event) => event.type === 'clueFound')).toBe(false)
    expect(runTallies(world).clues).toEqual({ done: 1, total: 1 })
  })

  it('stay on the ground once the player is down', () => {
    const world = createWorld(level, createDefaultTuning())
    world.player.alive = false
    world.status = 'dead'
    place(world, 5.5, 1.5)
    step(world)
    expect(world.cluesFound).toEqual([])
  })

  it('lie in front of the star altar in the 1-1 hidden area', () => {
    const built = buildLevel(LEVEL_1_1)
    const altar = built.landmarks.find((landmark) => landmark.id === 'ch1-star-altar')!
    const rare = built.chests.find((chest) => chest.tier === 'rare')!
    expect(built.clues).toEqual([{ id: 'star-altar', area: 1, at: { x: rare.x, y: rare.y } }])
    expect(Math.floor(rare.x)).toBe(altar.column + altar.width)
    expect(built.secrets).toHaveLength(1)
  })
})

describe('hidden areas', () => {
  const rows = [
    '##########',
    '#.......X#',
    '#........#',
    '#........#',
    '#........#',
    '#........#',
    '#........#',
    '#.~~~~...#',
    '#...P....#',
    '##########',
  ]
  const level = levelFromAreas([
    {
      name: 'mill',
      theme: 'forest',
      rows,
      landmarks: [{ id: 'ch1-watermill', at: [1, 1], facing: 90 }],
      secrets: [{ from: [1, 7], to: [1, 7], door: 'ch1-watermill' }],
    },
  ])

  it('count as found when the player steps in, and swing the secret door open once', () => {
    const world = createWorld(level, createDefaultTuning())
    expect(runTallies(world).secrets).toEqual({ done: 0, total: 1 })
    place(world, 1.5, 7.5)
    const events = step(world)
    expect(events.filter((event) => event.type === 'secretFound')).toEqual([{ type: 'secretFound', index: 0, landmark: 0, x: 1.5, y: 7.5 }])
    expect(events.filter((event) => event.type === 'landmarkOpened')).toEqual([
      { type: 'landmarkOpened', index: 0, id: 'ch1-watermill', node: 'secret_door', x: 3.5, y: 4.5 },
    ])
    expect(world.landmarks[0].open).toBe(true)
    expect(step(world).some((event) => event.type === 'secretFound')).toBe(false)
    expect(runTallies(world).secrets).toEqual({ done: 1, total: 1 })
  })
})

describe('barks', () => {
  it('can wait for the player to walk into an area, and speak only once', () => {
    const level = levelFromAreas([
      { name: 'south', theme: 'meadow', rows: ['#.....#', '#..P..#', '#######'] },
      { name: 'north', theme: 'forest', rows: ['#######', '#..X..#', '#.....#'] },
    ])
    const world = createWorld(level, createDefaultTuning())
    const hello: Bark = { id: 'hello', speaker: 'alo', text: '前面是树林。', display: 'bar', trigger: { on: 'enter', area: 1 } }
    stepWorld(world, idle(), DT)
    world.events.length = 0
    updateBarks(world, [hello])
    expect(world.events).toHaveLength(0)
    place(world, 3.5, 2.5)
    stepWorld(world, idle(), DT)
    world.events.length = 0
    updateBarks(world, [hello])
    updateBarks(world, [hello])
    expect(world.events).toEqual([
      { type: 'bark', id: 'hello', speaker: 'alo', text: '前面是树林。', display: 'bar', enemy: null, x: 3.5, y: 2.5, seconds: BARK_SECONDS },
    ])
  })
})

describe('barks in 1-2', () => {
  const level = buildLevel(LEVEL_1_2)

  it('let Lao Tang speak up when the first hay cart breaks and the IOU drops', () => {
    const world = createWorld(level, createDefaultTuning())
    const cart = level.landmarks.findIndex((landmark) => landmark.id === 'ch1-hay-cart')
    expect(step(world).some((event) => event.type === 'bark')).toBe(false)
    breakLandmark(world, cart)
    const events = step(world)
    expect(world.clues.map((drop) => drop.clue)).toEqual(['iou'])
    const barks = events.filter((event) => event.type === 'bark')
    expect(barks).toEqual([
      {
        type: 'bark',
        id: 'cashbox',
        speaker: 'laoTang',
        text: '钱箱就在那儿，碰都没碰。',
        display: 'bar',
        enemy: null,
        x: world.player.pos.x,
        y: world.player.pos.y,
        seconds: BARK_SECONDS,
      },
    ])
    breakLandmark(world, level.landmarks.findIndex((landmark, index) => index > cart && landmark.id === 'ch1-hay-cart'))
    expect(step(world).some((event) => event.type === 'bark')).toBe(false)
  })

  it('let Lao Tang recognise the old plough when the player walks up the road past the wreck', () => {
    const world = createWorld(level, createDefaultTuning())
    const wreck = level.landmarks.find((landmark) => landmark.id === 'grunt-wreck')!
    const plough = BARKS['1-2'].find((bark) => bark.id === 'plough')!
    const radius = plough.trigger.on === 'near' ? plough.trigger.radius : 0
    expect(wreck.column + wreck.width).toBe(25)
    expect(tileAt(level.grid, 26, wreck.row)).toBe(Tile.Path)
    expect(radius).toBeGreaterThanOrEqual(4)
    place(world, 27.5, wreck.row - radius - 0.5)
    expect(step(world).some((event) => event.type === 'bark')).toBe(false)
    place(world, 27.5, wreck.row + 0.5)
    const barks = step(world).filter((event) => event.type === 'bark')
    const actor = level.actors.find((item) => item.speaker === 'laoTang' && item.area === 3)!
    expect(barks).toHaveLength(1)
    expect(barks[0]).toMatchObject({ id: 'plough', x: actor.x, y: actor.y, z: floorAt(world.grid, actor.x, actor.y) + 2 })
    expect(step(world).some((event) => event.type === 'bark')).toBe(false)
  })

  it('pops an apology over one grunt in the loading yard when it spots the player', () => {
    const world = createWorld(level, createDefaultTuning())
    const id = world.barkEnemies.get('sorry')
    const grunt = world.enemies.find((enemy) => enemy.id === id)!
    expect(grunt.kind).toBe('grunt')
    expect(grunt.area).toBe(2)
    aggro(world, grunt, 0)
    const bubbles = step(world).filter((event) => event.type === 'bark')
    expect(bubbles).toHaveLength(1)
    expect(bubbles[0]).toMatchObject({ id: 'sorry', speaker: null, display: 'bubble', enemy: grunt.id, text: '抱歉！干草也借用一下！' })
  })
})

describe('barks in 1-1', () => {
  const level = buildLevel(LEVEL_1_1)

  it('has the patrolling charger apologise when it spots the player, and Kai answer back a moment later', () => {
    const world = createWorld(level, createDefaultTuning(), { debug: { invincible: true } })
    const id = world.barkEnemies.get('sorry')
    const grunt = world.enemies.find((enemy) => enemy.id === id)!
    expect(grunt.kind).toBe('grunt')
    expect(grunt.area).toBe(0)
    aggro(world, grunt, 0)
    const bubbles = step(world).filter((event) => event.type === 'bark')
    expect(bubbles).toEqual([expect.objectContaining({ id: 'sorry', speaker: null, display: 'bubble', enemy: grunt.id, text: '抱歉！麦子借用一下！' })])
    const start = world.time
    let reply: GameEvent | undefined
    while (!reply && world.time - start < 3) reply = step(world).find((event) => event.type === 'bark')
    expect(reply).toMatchObject({ id: 'robbery', speaker: 'kai', display: 'bar', text: '借？你们这叫抢！' })
    expect(world.time - start).toBeCloseTo(1.2, 1)
  })

  it('has Alo explain the red lines on the windmill slope and Kai wonder at the star on the altar', () => {
    const world = createWorld(level, createDefaultTuning(), { debug: { invincible: true } })
    const slope = level.areas[1]
    place(world, 20.5, slope.top + 14.5)
    expect(step(world).filter((event) => event.type === 'bark')).toEqual([expect.objectContaining({ id: 'aim', speaker: 'alo', text: '看到红线就是射手在瞄你，躲到石头后面。' })])
    world.cluesFound.push('star-altar')
    expect(step(world).filter((event) => event.type === 'bark')).toEqual([expect.objectContaining({ id: 'altar', speaker: 'kai', text: '石台上刻着一颗星……跟碎片一个形状？' })])
    expect(step(world).some((event) => event.type === 'bark')).toBe(false)
  })
})

describe('1-3 office and cellar', () => {
  const level = buildLevel(LEVEL_1_3)

  it('let Alo warn about the first shield bearer the player can see, and only once', () => {
    const world = createWorld(level, createDefaultTuning())
    const guard = world.enemies.find((enemy) => enemy.kind === 'shield' && enemy.area === 0)!
    const warning = (events: GameEvent[]) => events.filter((event) => event.type === 'bark' && event.id === 'shieldBearer')
    place(world, guard.pos.x - 6, guard.pos.y + 4.5)
    expect(warning(step(world))).toEqual([])
    place(world, guard.pos.x, guard.pos.y + 6)
    expect(warning(step(world))).toEqual([expect.objectContaining({ id: 'shieldBearer', speaker: 'alo', text: '那个举着门板的，正面打不动。绕到它背后去！' })])
    place(world, guard.pos.x, guard.pos.y - 3)
    expect(warning(step(world))).toEqual([])
  })

  it('reads the shipping manifest out loud when it is picked up', () => {
    const world = createWorld(level, createDefaultTuning())
    const clue = world.clues.find((drop) => drop.clue === 'manifest')!
    place(world, clue.pos.x, clue.pos.y + 0.8)
    const events = step(world)
    expect(events.filter((event) => event.type === 'clueFound').map((event) => event.type === 'clueFound' && event.clue)).toEqual(['manifest'])
    expect(events.filter((event) => event.type === 'bark')).toEqual([
      expect.objectContaining({ id: 'rustAnchor', speaker: 'alo', display: 'bar', text: '锈锚……地图上没有这个地方。' }),
    ])
    expect(runTallies(world).clues).toEqual({ done: 1, total: 1 })
  })

  it('swings both cellar doors open when the player slips past the wheat into the nook', () => {
    const world = createWorld(level, createDefaultTuning())
    const secret = level.secrets[0]
    const cellar = secret.landmark!
    place(world, secret.column + secret.width - 0.5, secret.row + 0.5)
    const events = step(world)
    expect(events.filter((event) => event.type === 'secretFound')).toHaveLength(1)
    expect(events.filter((event) => event.type === 'landmarkOpened')).toEqual([expect.objectContaining({ index: cellar, id: 'ch1-cellar', node: 'door_l' })])
    expect(world.landmarks[cellar].open).toBe(true)
    expect(runTallies(world).secrets).toEqual({ done: 1, total: 1 })
  })
})
