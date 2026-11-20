import { describe, expect, it } from 'vitest'
import { EYE_HEIGHTS, MUZZLE_HEIGHTS } from '../data/heights'
import { LEVEL_1_2 } from '../data/levels/level-1-2'
import { createDefaultTuning } from '../data/tuning'
import { placePlayer } from './cheats'
import { lineClear } from './collision'
import { Tile, blocksMovement, cellFloor, floorAt, setTile, tileAt } from './grid'
import { buildLevel } from './level'
import { spawnLob, updateLobs } from './lobs'
import { updatePlayer } from './player'
import { idleCommand } from './step'
import { createWorld, type World } from './world'

const DT = 1 / 60
const level = buildLevel(LEVEL_1_2)
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

describe('pasture routes', () => {
  it.each<{ name: string; area: number; start: [number, number]; stops: Stop[] }>([
    { name: 'the inspection bench', area: 0, start: [18.5, 31.5], stops: [[21.2, 31.8, 1, true]] },
    { name: 'the feed deck', area: 1, start: [23.7, 31.3], stops: [[23.9, 33.9, 2, true], [25.9, 34.2, 3, true], [27.5, 32.5, 2.5], [27.5, 31.5, 2], [27.5, 30.5, 1.5]] },
    { name: 'the south loading decks', area: 2, start: [41.1, 43], stops: [[38.3, 43, 2, true], [35.35, 43.2, 3, true], [33.4, 43.5, 2.5], [31.5, 42.5, 2.5]] },
    { name: 'the mill sleepers', area: 3, start: [28.5, 20.5], stops: [[30.5, 20.5, 2, true]] },
    { name: 'the west barn platform and its steps', area: 4, start: [19.1, 20.8], stops: [[16.65, 20.85, 3, true], [16.6, 18.6, 4, true], [16.6, 16.5, 3.5], [16.6, 15.5, 3], [16.6, 14.5, 2.5], [16.6, 13.5, 2]] },
    { name: 'the east barn platform and its step', area: 4, start: [39.5, 17.1], stops: [[42.1, 17.3, 3, true], [42.1, 19.5, 2.5], [42.1, 20.6, 2]] },
  ])('lets the player take $name with basic jumps', ({ area, start, stops }) => {
    const world = setup(area, ...start)
    for (const stop of stops) visit(world, area, stop)
  })

  it.each<{ name: string; area: number; start: [number, number]; stops: Stop[] }>([
    { name: 'the repair workshop', area: 0, start: [31, 28.5], stops: [[31, 26.15, 0], [33.5, 26.15, 0], [35.55, 26.15, 0]] },
    { name: 'the weighhouse', area: 2, start: [38, 52.55], stops: [[38, 49.1, 1], [40.5, 49.1, 1], [42.55, 49.1, 1]] },
  ])('lets the player walk through either door of $name', ({ area, start, stops }) => {
    const world = setup(area, ...start)
    for (const stop of stops) visit(world, area, stop)
    for (const stop of [...stops.slice(0, -1).reverse(), [...start, stops[0][2]] as const]) visit(world, area, stop)
  })

  it('blocks a shot to the chest at the water trough and leaves an eye-height view', () => {
    const y = level.areas[0].top
    expect(lineClear(level.grid, { x: 36.5, y: y + 30.5, z: MUZZLE_HEIGHTS.gunner }, { x: 36.5, y: y + 34.5, z: 1 })).toBe(false)
    expect(lineClear(level.grid, { x: 36.5, y: y + 30.5, z: EYE_HEIGHTS.player }, { x: 36.5, y: y + 34.5, z: EYE_HEIGHTS.player })).toBe(true)
  })

  it('keeps the trough and sleepers solid while the sacks and short bales use the fire rules', () => {
    const hayAt = (area: number, x: number, row: number) => level.hay.includes((level.areas[area].top + row) * level.grid.columns + x)
    expect(hayAt(0, 35, 32)).toBe(false)
    expect(hayAt(0, 26, 10)).toBe(true)
    expect(hayAt(1, 33, 21)).toBe(false)
    expect(hayAt(2, 40, 26)).toBe(false)
    expect(hayAt(2, 30, 34)).toBe(true)
    expect(hayAt(2, 15, 13)).toBe(true)
    expect(hayAt(2, 30, 10)).toBe(false)
  })

  it('shows only the south cart from each cell of the raised scale deck', () => {
    const areaTop = level.areas[2].top
    const grid = level.grid
    const carts = level.landmarks.filter(({ id }) => id === 'ch1-hay-cart')
    const testGrids = carts.map((cart) => {
      const sightGrid = { ...grid, tiles: grid.tiles.slice(), top: grid.top.slice() }
      for (const index of cart.cells) setTile(sightGrid, index, Tile.Floor)
      return sightGrid
    })
    for (let x = 34; x <= 36; x++) {
      for (let row = areaTop + 42; row <= areaTop + 43; row++) {
        const eye = { x: x + 0.5, y: row + 0.5, z: cellFloor(grid, x, row) + EYE_HEIGHTS.player }
        const visible = carts.map((cart, at) => cart.cells.some((index) => {
          const target = { x: index % grid.columns + 0.5, y: Math.floor(index / grid.columns) + 0.5 }
          return [0.7, 1.4, 1.85].some((height) => lineClear(testGrids[at], eye, { ...target, z: grid.floor[index] + height }))
        }))
        expect(visible).toEqual([true, false, false])
      }
    }
  })
})

describe('the barn with side platforms', () => {
  it('keeps the central 12 by 10 metres and all four summon points on clear, level ground', () => {
    for (let row = 14; row <= 23; row++) {
      for (let column = 23; column <= 34; column++) {
        expect(blocksMovement(tileAt(level.grid, column, row))).toBe(false)
        expect(cellFloor(level.grid, column, row)).toBe(2)
      }
    }
    expect(level.summonPoints).toHaveLength(4)
    for (const { x, y } of level.summonPoints) {
      expect(blocksMovement(tileAt(level.grid, Math.floor(x), Math.floor(y)))).toBe(false)
      expect(floorAt(level.grid, x, y)).toBe(2)
    }
  })

  it('warns and explodes at the height of the west platform when the chief aims at it', () => {
    const world = setup(4, 16.6, 18.6)
    const lob = spawnLob(world, 'enemy', world.boss!.pos, world.player.pos, 'chiefBomb')
    expect(lob.to).toEqual(world.player.pos)
    expect(lob.toZ).toBe(4)
    for (let step = 0; step < 180 && world.lobs.length; step++) updateLobs(world, DT)
    expect(world.blasts).toHaveLength(1)
    expect(world.blasts[0]).toMatchObject({ x: 16.6, y: 18.6, z: 4 })
  })

  it('uses the height of an intervening platform if a lob lands before its target', () => {
    const world = setup(4, 14.7, 18.5)
    const lob = spawnLob(world, 'player', world.player.pos, { x: 19.25, y: 18.5 }, 'chiefBomb', 1, null, undefined, 2.75)
    expect(lob.toZ).toBe(2)
    for (let step = 0; step < 180 && world.lobs.length; step++) updateLobs(world, DT)
    expect(world.blasts).toHaveLength(1)
    expect(world.blasts[0].x).toBeGreaterThanOrEqual(15)
    expect(world.blasts[0].x).toBeLessThan(18)
    expect(world.blasts[0].z).toBe(4)
  })
})
