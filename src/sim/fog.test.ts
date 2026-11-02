import { describe, expect, it } from 'vitest'
import { FOG } from '../data/fog'
import { LEVEL_1_4 } from '../data/levels/level-1-4'
import type { AreaDef } from '../data/levels/types'
import { createDefaultTuning } from '../data/tuning'
import { lightLamps } from './cheats'
import { areaClear, fogBlocks, fogged, fogHides, lampTally, lightLamp } from './fog'
import { buildLevel, validateLevel } from './level'
import { aggro, canSeePlayer, witnessDeath } from './perception'
import { interactTarget } from './pickups'
import { stepWorld } from './step'
import { levelFromAreas } from './testing'
import type { Enemy, GameEvent, PlayerCommand } from './types'
import { createEnemy, createWorld, type World } from './world'

const DT = 1 / 60
const OPEN = '#' + '.'.repeat(30) + '#'
const WALL = '#'.repeat(32)

function field(fog: AreaDef['fog'], extra: Partial<AreaDef> = {}, lampRow = 2): World {
  const rows = [WALL, ...Array.from({ length: 22 }, () => OPEN), WALL]
  rows[20] = '#..............P...............#'
  const area: AreaDef = { name: 'woods', theme: 'forest', rows, fog, landmarks: [{ id: 'ch1-fog-lamp', at: [3, lampRow] }], ...extra }
  return createWorld(levelFromAreas([area]), createDefaultTuning())
}

function idle(world: World, patch: Partial<PlayerCommand> = {}): PlayerCommand {
  return { moveX: 0, moveY: 0, aimX: world.player.pos.x, aimY: world.player.pos.y - 1, fire: false, slot: null, interact: false, skill: null, ultimate: false, pitch: 0, jump: false, dash: false, melee: false, ...patch }
}

function place(world: World, x: number, y: number): void {
  world.player.pos = { x, y }
  world.player.prev = { x, y }
}

function grunt(world: World, x: number, y: number, facing = Math.PI / 2): Enemy {
  const enemy = createEnemy(world, 'grunt', { x, y }, 0)
  enemy.facing = facing
  enemy.baseFacing = facing
  world.enemies.push(enemy)
  return enemy
}

describe('fog', () => {
  it('only covers areas marked foggy', () => {
    const clear = field(undefined)
    expect(clear.level.areas[0].fog).toBe(false)
    expect(fogged(clear, 15.5, 10.5)).toBe(false)
    const foggy = field({})
    expect(foggy.level.areas[0].fog).toBe(true)
    expect(fogged(foggy, 15.5, 10.5)).toBe(true)
    expect(fogged(foggy, 15.5, -3)).toBe(false)
  })

  it('lets a lit lamp clear a circle of eight cells, and only the lit ones', () => {
    const world = field({})
    expect(world.level.lamps).toEqual([{ landmark: 0, area: 0, x: 3.5, y: 2.5, clears: false }])
    expect(fogged(world, 3.5 + 7.5, 2.5)).toBe(true)
    expect(lightLamp(world, 0)).toBe(true)
    expect(lightLamp(world, 0)).toBe(false)
    expect(world.events).toEqual([{ type: 'lampLit', index: 0, landmark: 0, x: 3.5, y: 2.5, radius: FOG.lampRadius, area: null }])
    expect(fogged(world, 3.5 + 7.5, 2.5)).toBe(false)
    expect(fogged(world, 3.5 + 8.5, 2.5)).toBe(true)
    expect(areaClear(world, 0)).toBe(false)
    expect(lampTally(world)).toEqual({ done: 1, total: 1 })
  })

  it('clears the whole area when the lamp named by the area is lit', () => {
    const world = field({ clearedBy: [3, 2] })
    expect(world.level.lamps[0].clears).toBe(true)
    expect(areaClear(world, 0)).toBe(false)
    lightLamp(world, 0)
    expect(world.events[0]).toMatchObject({ type: 'lampLit', area: 0 })
    expect(areaClear(world, 0)).toBe(true)
    expect(fogged(world, 28.5, 22.5)).toBe(false)
    expect(() => field({ clearedBy: [5, 5] })).toThrow(/no fog lamp/)
  })

  it('hides things more than five cells away when either end stands in fog', () => {
    const world = field({})
    place(world, 15.5, 20.5)
    expect(fogBlocks(world, world.player.pos, { x: 15.5, y: 20.5 - FOG.sight })).toBe(false)
    expect(fogBlocks(world, world.player.pos, { x: 15.5, y: 14.5 })).toBe(true)
    expect(fogHides(world, 15.5, 14.5)).toBe(true)
    lightLamp(world, 0)
    place(world, 5.5, 6.5)
    expect(fogHides(world, 5.5, 1.5)).toBe(false)
    expect(fogHides(world, 5.5, 16.5)).toBe(true)
  })

  it('lets enemies in fog find the player only within five cells, and bushes still hide closer', () => {
    const world = field({})
    place(world, 15.5, 20.5)
    const watcher = grunt(world, 15.5, 14.5, Math.PI / 2)
    expect(canSeePlayer(world, watcher, world.tuning.grunt.sight)).toBe(false)
    watcher.pos = { x: 15.5, y: 16.5 }
    expect(canSeePlayer(world, watcher, world.tuning.grunt.sight)).toBe(true)
    world.grid.tiles[20 * world.grid.columns + 15] = 3
    expect(canSeePlayer(world, watcher, world.tuning.grunt.sight)).toBe(false)
  })

  it('keeps an enemy that already fights the player tracking it through the fog', () => {
    const world = field({})
    place(world, 15.5, 20.5)
    const hunter = grunt(world, 15.5, 14.5)
    aggro(world, hunter, 0)
    expect(canSeePlayer(world, hunter, world.tuning.grunt.sight)).toBe(true)
  })

  it('sees as far as usual where a lamp has cleared the fog', () => {
    const world = field({}, {}, 17)
    lightLamp(world, 0)
    place(world, 5.5, 20.5)
    const watcher = grunt(world, 5.5, 14.5)
    expect(canSeePlayer(world, watcher, world.tuning.grunt.sight)).toBe(true)
  })

  it('does not let a far comrade see a death through the fog', () => {
    const world = field({})
    place(world, 28.5, 2.5)
    const dead = grunt(world, 15.5, 20.5)
    const far = grunt(world, 15.5, 13.5, -Math.PI / 2)
    const near = grunt(world, 15.5, 16.5, -Math.PI / 2)
    witnessDeath(world, dead)
    expect(far.alert).toBe('idle')
    expect(near.alert).toBe('suspicious')
  })

  it('changes nothing for enemies outside foggy areas', () => {
    const world = field(undefined)
    place(world, 15.5, 20.5)
    const watcher = grunt(world, 15.5, 14.5)
    expect(canSeePlayer(world, watcher, world.tuning.grunt.sight)).toBe(true)
  })
})

describe('fog lamps', () => {
  it('lights with F from the cell beside it, like opening a chest', () => {
    const world = field({}, {}, 10)
    place(world, 4.9, 10.5)
    world.player.facing = Math.PI
    expect(interactTarget(world)).toEqual({ kind: 'lamp', lamp: 0, pos: { x: 3.5, y: 10.5 } })
    const seen: GameEvent[] = []
    world.events.length = 0
    stepWorld(world, idle(world, { interact: true, aimX: world.player.pos.x - 1, aimY: world.player.pos.y }), DT)
    seen.push(...world.events)
    expect(world.lamps).toEqual([true])
    expect(seen.filter((event) => event.type === 'lampLit')).toHaveLength(1)
    expect(interactTarget(world)).toBeNull()
  })

  it('is out of reach two cells away', () => {
    const world = field({}, {}, 10)
    place(world, 3.5 + FOG.lampReach + 0.2, 10.5)
    expect(interactTarget(world)).toBeNull()
  })

  it('starts unlit again in a new world, as after dying', () => {
    const level = buildLevel(LEVEL_1_4)
    const first = createWorld(level, createDefaultTuning())
    expect(lightLamps(first)).toBe(4)
    expect(first.lamps.every(Boolean)).toBe(true)
    expect(createWorld(level, createDefaultTuning()).lamps).toEqual([false, false, false, false])
  })

  it('asks for a reachable cell beside every lamp and fog in its area', () => {
    const blocked = levelFromAreas([
      {
        name: 'woods',
        theme: 'forest',
        fog: {},
        rows: ['#####', '#...#', '#.###', '#.#.#', '#P###', '#####'],
        landmarks: [{ id: 'ch1-fog-lamp', at: [3, 3] }],
      },
    ])
    expect(validateLevel(blocked)).toContain('fog lamp at 3,3 cannot be reached to light it')
    const sunny = levelFromAreas([{ name: 'meadow', theme: 'meadow', rows: ['#####', '#...#', '#P..#', '#####'], landmarks: [{ id: 'ch1-fog-lamp', at: [3, 1] }] }])
    expect(validateLevel(sunny)).toContain('fog lamp at 3,1 stands in an area without fog')
  })
})
