import { describe, expect, it } from 'vitest'
import { getBoss } from '../data/bosses'
import { LEVEL_1_1 } from '../data/levels/level-1-1'
import { createDefaultTuning } from '../data/tuning'
import { placePlayer } from './cheats'
import { corridorClear } from './collision'
import { blocksMovement, cellFloor, tileAt } from './grid'
import { buildLevel } from './level'
import { updatePlayer } from './player'
import { idleCommand, stepWorld } from './step'
import { createWorld, type World } from './world'

const DT = 1 / 60
const level = buildLevel(LEVEL_1_1)
type Stop = readonly [x: number, localRow: number, z: number, jump?: boolean]

function setup(area: number, x: number, row: number): World {
  const world = createWorld(level, createDefaultTuning(), { debug: { invincible: true } })
  placePlayer(world, { x, y: level.areas[area].top + row })
  return world
}

function visit(world: World, area: number, [x, row, z, jump = false]: Stop): void {
  const y = level.areas[area].top + row
  const { player } = world
  for (let step = 0; step < 180; step++) {
    const dx = x - player.pos.x
    const dy = y - player.pos.y
    const distance = Math.hypot(dx, dy)
    if (step > 0 && distance < 0.06 && player.grounded) break
    const scale = Math.max(distance, world.tuning.player.speed * DT)
    world.time += DT
    updatePlayer(world, { ...idleCommand(world), moveX: dx / scale, moveY: dy / scale, jump: jump && step === 0 }, DT)
  }
  expect(Math.hypot(x - player.pos.x, y - player.pos.y)).toBeLessThan(0.06)
  expect(player.grounded).toBe(true)
  expect(player.z).toBeCloseTo(z)
}

describe('the Morningwind traversal routes', () => {
  it.each<{ route: string; area: number; start: [number, number]; stops: Stop[] }>([
    { route: 'the first jump onto bound wheat', area: 0, start: [17.65, 23.1], stops: [[17.65, 25.05, 1, true]] },
    {
      route: 'the east bridge and its two stone terraces', area: 1, start: [46.5, 42.5],
      stops: [[46.5, 35.45, 0.5], [51, 35.45, 0.5], [53.45, 35.45, 1.5, true], [53.45, 33.15, 2.5, true], [51.5, 32.6, 2]],
    },
    {
      route: 'the threshing floor and upper corner deck', area: 2, start: [28.5, 28.45],
      stops: [[29.5, 28.45, 2.5], [34.25, 28.45, 3], [34.25, 26.1, 4, true], [34.25, 23.45, 2]],
    },
    {
      route: 'the east threshing ramp on foot', area: 2, start: [50.5, 32.5],
      stops: [[49.5, 32.5, 2.5], [48.5, 32.5, 2.5], [47.5, 32.5, 3]],
    },
    {
      route: 'the harvest field west platforms and exit steps', area: 4, start: [21.1, 20.9],
      stops: [[18.2, 20.9, 3, true], [17.6, 18.6, 4, true], [17.6, 15.5, 3.5], [17.6, 14.5, 3], [17.6, 13.5, 2.5], [19.45, 13.5, 2]],
    },
    {
      route: 'the harvest field east step', area: 4, start: [38.85, 17.5],
      stops: [[41.05, 17.5, 3, true], [41.05, 19.5, 2.5], [41.05, 20.5, 2]],
    },
  ])('can use $route at default movement speed', ({ area, start, stops }) => {
    const world = setup(area, ...start)
    for (const stop of stops) visit(world, area, stop)
  })

  it.each<{ building: string; area: number; points: Stop[] }>([
    { building: 'equipment shed', area: 0, points: [[10, 22.65, 0], [10, 19.85, 0], [12.5, 19.85, 0], [14.8, 19.85, 0]] },
    { building: 'red barn', area: 2, points: [[7, 39.55, 2], [7, 35.15, 2], [9.75, 35.05, 2], [13.55, 35.05, 2]] },
  ])('can pass through the $building in either direction at ground level', ({ area, points }) => {
    const [[x, row], ...outbound] = points
    const world = setup(area, x, row)
    for (const stop of [...outbound, ...points.slice(0, -1).reverse()]) visit(world, area, stop)
  })

  it('leaves the first charger patrol a clear ground-level corridor past the jump', () => {
    const patrol = level.enemies.find(({ area, idle }) => area === 0 && idle === 'patrol')!
    const tuning = createDefaultTuning()
    expect(corridorClear(level.grid, patrol.route[0], patrol.route[1], tuning.grunt.radius)).toBe(true)
  })
})

describe('the harvest field with side platforms', () => {
  const charge = getBoss('scarecrow').charge

  function beginCharge(world: World) {
    stepWorld(world, idleCommand(world), DT)
    const boss = world.boss!
    const state = boss.boss!
    state.order = ['charge']
    state.phase = 'walk'
    state.timer = 0
    stepWorld(world, idleCommand(world), DT)
    expect(state.phase).toBe('telegraph')
    return { boss, state }
  }

  it('keeps the middle flat for the charge and the four summon points usable', () => {
    for (let row = 14; row <= 23; row++) {
      for (let column = 23; column <= 35; column++) {
        expect(cellFloor(level.grid, column, row)).toBe(2)
        expect(blocksMovement(tileAt(level.grid, column, row))).toBe(false)
      }
    }
    expect(level.summonPoints).toHaveLength(4)
    for (const { x, y } of level.summonPoints) {
      expect(cellFloor(level.grid, Math.floor(x), Math.floor(y))).toBe(2)
      expect(blocksMovement(tileAt(level.grid, Math.floor(x), Math.floor(y)))).toBe(false)
    }
    const world = setup(4, 30.5, 25.5)
    const { boss, state } = beginCharge(world)
    const before = boss.pos.y
    placePlayer(world, { x: 34.5, y: 25.5 })
    for (let i = 0; i < Math.round((charge.telegraph + 0.38) / DT); i++) stepWorld(world, idleCommand(world), DT)
    expect(state.phase).toBe('active')
    expect(boss.pos.y - before).toBeGreaterThan(5)
    expect(boss.pos.x).toBeCloseTo(30.5)
    expect(boss.z).toBe(2)
  })

  it('stops a charge against the high west platform without putting the boss on the deck', () => {
    const world = setup(4, 17.6, 18.6)
    const { boss, state } = beginCharge(world)
    for (let i = 0; i < 180 && state.phase !== 'stunned'; i++) stepWorld(world, idleCommand(world), DT)
    expect(state.phase).toBe('stunned')
    expect(boss.pos.x).toBeGreaterThanOrEqual(19 + boss.radius - 0.01)
    expect(boss.pos.x).toBeLessThan(22)
    expect(boss.z).toBe(2)
    expect(world.player.z).toBe(4)
  })
})
