import { describe, expect, it } from 'vitest'
import { LANDMARKS } from '../data/landmarks'
import { LEVEL_1_1 } from '../data/levels/level-1-1'
import { LEVEL_1_2 } from '../data/levels/level-1-2'
import { LEVEL_1_3 } from '../data/levels/level-1-3'
import { LEVEL_1_4 } from '../data/levels/level-1-4'
import { LEVEL_1_5 } from '../data/levels/level-1-5'
import { TRIAL_HARVESTER } from '../data/levels/trial-harvester'
import { TRIAL_SYSTEMS } from '../data/levels/trial-systems'
import { TRAINING } from '../data/levels/training'
import { cellVariant, type AreaDef } from '../data/levels/types'
import { JUMP_HEIGHT, bodyHeightOf, eyeHeightOf } from '../data/heights'
import { Tile, blocksBullets, blocksMovement, cellFloor, cellTop, standHeight, tileAt } from './grid'
import { getBoss } from '../data/bosses'
import { createDefaultTuning } from '../data/tuning'
import { lineClear } from './collision'
import { buildLevel, climbableFrom, insideRegion, reachableFrom, validateLevel } from './level'
import { wakeChain } from './level-rules'
import { idleCommand, stepWorld } from './step'
import { levelFromAreas } from './testing'
import { createWorld } from './world'

describe('buildLevel', () => {
  it('stacks areas so the first one sits at the bottom of the map', () => {
    const level = levelFromAreas([
      { name: 'a', theme: 'meadow', rows: ['#.#', '#P#', '###'] },
      { name: 'b', theme: 'forest', rows: ['###', '#X#'] },
    ])
    expect(level.areas[0]).toMatchObject({ top: 2, bottom: 5 })
    expect(level.areas[1]).toMatchObject({ top: 0, bottom: 2 })
    expect(Array.from(level.areaOfRow)).toEqual([1, 1, 0, 0, 0])
    expect(level.playerStart).toEqual({ x: 1.5, y: 3.5 })
  })

  it('rejects areas of different widths', () => {
    expect(() =>
      levelFromAreas([
        { name: 'a', theme: 'meadow', rows: ['#P#'] },
        { name: 'b', theme: 'meadow', rows: ['####'] },
      ]),
    ).toThrow(/area "b" row 1/)
  })

  it('reports an exit the player cannot reach', () => {
    const level = levelFromAreas([{ name: 'a', theme: 'meadow', rows: ['#####', '#X#P#', '#####'] }])
    expect(validateLevel(level)).toContain('exit is unreachable')
  })

  it('reports a lock area the player could leave without passing a gate', () => {
    const level = levelFromAreas([
      { name: 'start', theme: 'meadow', rows: ['#...#', '#.P.#', '#####'] },
      { name: 'yard', theme: 'village', kind: 'lock', rows: ['##D##', '#.m.#', '#...#', '#.D.#'] },
    ])
    expect(validateLevel(level).some((problem) => problem.includes('boundary'))).toBe(true)
  })

  it('lets a destroy area stay open to the south but asks for a closed north edge and a target', () => {
    const yard = (rows: string[], landmarks = [{ id: 'ch1-hay-cart' as const, at: [1, 1] as const }]) =>
      levelFromAreas([
        { name: 'start', theme: 'meadow', rows: ['#.......#', '#...P...#', '#.......#'] },
        { name: 'yard', theme: 'farm', kind: 'destroy', rows, landmarks },
        { name: 'end', theme: 'meadow', rows: ['#########', '#...X...#', '#.......#'] },
      ])
    const rows = ['###DD####', '#.......#', '#.......#', '#.......#', '#.......#']
    expect(validateLevel(yard(rows))).toEqual([])
    expect(validateLevel(yard(['#..DD...#', ...rows.slice(1)]))).toContain('area "yard" boundary row 3 is open at column 1')
    expect(validateLevel(yard(rows, []))).toContain('destroy area "yard" has no targets')
    expect(validateLevel(yard([...rows.slice(0, 4), '#...D...#']))).toContain('destroy area "yard" has a gate below its north edge')
  })

  it('treats crates as breakable when checking what the player can reach', () => {
    const level = levelFromAreas([{ name: 'a', theme: 'village', rows: ['#######', '#.ccR##', '#.c##X#', '#.P...#', '#######'] }])
    expect(validateLevel(level)).toEqual([])
    expect(reachableFrom(level.grid, level.playerStart)[1 * 7 + 4]).toBe(0)
    expect(reachableFrom(level.grid, level.playerStart, true)[1 * 7 + 4]).toBe(1)
  })

  it('wants a pasture and an open doorway for every sheep pen', () => {
    const pen = { id: 'ch1-sheep-pen' as const, at: [1, 1] as const }
    const rows = ['##########', '#.......X#', '#........#', '#........#', '#........#', '#...P....#', '##########']
    const fenced = levelFromAreas([{ name: 'farm', theme: 'village', rows, landmarks: [pen] }])
    expect(validateLevel(fenced)).toContain('landmark ch1-sheep-pen at 1,1 has no pasture in its area')
    const grazing = levelFromAreas([{ name: 'farm', theme: 'village', rows, landmarks: [pen], pasture: { from: [5, 2], to: [7, 4] } }])
    expect(validateLevel(grazing)).toEqual([])
    expect(grazing.pastures).toEqual([{ area: 0, column: 5, row: 2, width: 3, depth: 3 }])
    const blocked = ['##########', '#.......X#', '#........#', '#........#', '#.f......#', '#...P....#', '##########']
    const closed = levelFromAreas([{ name: 'farm', theme: 'village', rows: blocked, landmarks: [pen], pasture: { from: [5, 2], to: [7, 4] } }])
    expect(validateLevel(closed)).toContain('landmark ch1-sheep-pen at 1,1 has an unreachable doorway')
  })

  it('puts the named weapon in a weapon chest, clues on the ground and secrets in their area', () => {
    const rows = ['##########', '#.W...R.X#', '#........#', '#...P....#', '##########']
    const level = levelFromAreas([
      {
        name: 'a',
        theme: 'meadow',
        rows,
        loot: [{ at: [2, 1], weapon: 'rocket' }],
        clues: [{ id: 'star-altar', at: [5, 2] }],
        secrets: [{ from: [6, 1], to: [6, 2] }],
      },
    ])
    expect(validateLevel(level)).toEqual([])
    expect(level.chests.map((chest) => [chest.tier, chest.weapon])).toEqual([
      ['weapon', 'rocket'],
      ['rare', null],
    ])
    expect(level.clues).toEqual([{ id: 'star-altar', area: 0, at: { x: 5.5, y: 2.5 } }])
    expect(level.secrets).toEqual([{ area: 0, column: 6, row: 1, width: 1, depth: 2, landmark: null }])
    expect(() => levelFromAreas([{ name: 'a', theme: 'meadow', rows, loot: [{ at: [3, 1], weapon: 'rocket' }] }])).toThrow(/no weapon chest/)
    expect(() => levelFromAreas([{ name: 'a', theme: 'meadow', rows, secrets: [{ from: [1, 1], to: [1, 1], door: 'ch1-watermill' }] }])).toThrow(
      /not in the area/,
    )
    const waiting = levelFromAreas([{ name: 'a', theme: 'meadow', rows, clues: [{ id: 'iou', dropBy: 'firstTarget' }] }])
    expect(validateLevel(waiting)).toContain('a clue waits for a target in an area without targets')
  })
})

describe('heights', () => {
  it('reads a height map of half-metre digits under the rows and stacks obstacles on the ground', () => {
    const level = levelFromAreas([{ name: 'a', theme: 'meadow', rows: ['#####', '#Po.#', '#####'], heights: ['00000', '01244', '00000'] }])
    const { grid } = level
    expect(cellFloor(grid, 1, 1)).toBe(0.5)
    expect(cellFloor(grid, 2, 1)).toBe(1)
    expect(cellTop(grid, 2, 1)).toBeCloseTo(2.2)
    expect(standHeight(grid, 2, 1)).toBeCloseTo(2.2)
    expect(cellTop(grid, 3, 1)).toBe(2)
    expect(cellTop(grid, 4, 1)).toBe(5)
    expect(standHeight(grid, 4, 1)).toBe(Infinity)
  })

  it('leaves areas without a height map flat and rejects maps that do not match the rows', () => {
    const flat = levelFromAreas([{ name: 'a', theme: 'meadow', rows: ['#####', '#P..#', '#####'] }])
    expect(Array.from(flat.grid.floor).every((height) => height === 0)).toBe(true)
    const rows = ['#####', '#P..#', '#####']
    expect(() => levelFromAreas([{ name: 'a', theme: 'meadow', rows, heights: ['00000', '00000'] }])).toThrow(/2 height rows, expected 3/)
    expect(() => levelFromAreas([{ name: 'a', theme: 'meadow', rows, heights: ['00000', '0000', '00000'] }])).toThrow(/height row 2 has 4 columns/)
    expect(() => levelFromAreas([{ name: 'a', theme: 'meadow', rows, heights: ['00000', '00a00', '00000'] }])).toThrow(/0-9/)
  })

  it('wants the exit and every enemy reachable on foot within the half-metre step limit', () => {
    const rows = ['#######', '#P.m.X#', '#######']
    const cliff = levelFromAreas([{ name: 'a', theme: 'meadow', rows, heights: ['0000000', '0000220', '0000000'] }])
    expect(validateLevel(cliff)).toContain('exit is unreachable')
    const stairs = levelFromAreas([{ name: 'a', theme: 'meadow', rows, heights: ['0000000', '0001220', '0000000'] }])
    expect(validateLevel(stairs)).toEqual([])
    const perch = levelFromAreas([{ name: 'a', theme: 'meadow', rows: ['#######', '#P.m.X#', '#.....#', '#######'], heights: ['0000000', '0002000', '0000000', '0000000'] }])
    expect(validateLevel(perch)).toEqual(['grunt at 3,1 is unreachable'])
  })

  it('lets a chest inside a secret ask for a jump, but not one out in the open', () => {
    const area: AreaDef = { name: 'a', theme: 'meadow', rows: ['########', '#P..$.X#', '#......#', '########'], heights: ['00000000', '00002000', '00000000', '00000000'] }
    const secrets: AreaDef['secrets'] = [{ from: [4, 1], to: [4, 1] }]
    expect(validateLevel(levelFromAreas([area]))).toEqual(['normal chest at 4,1 is unreachable'])
    expect(validateLevel(levelFromAreas([{ ...area, secrets }]))).toEqual([])
    const ledge: AreaDef = { ...area, heights: ['00000000', '00006000', '00000000', '00000000'], secrets }
    expect(validateLevel(levelFromAreas([ledge]))).toEqual(expect.arrayContaining(['normal chest at 4,1 is unreachable', 'secret at 4,1 is unreachable']))
  })
})

describe('level 1-1', () => {
  const level = buildLevel(LEVEL_1_1)
  const { grid } = level
  const kindsIn = (area: number) => new Set(level.enemies.filter((enemy) => enemy.area === area).map((e) => e.kind))
  const count = (area: number, kind: string) => level.enemies.filter((enemy) => enemy.area === area && enemy.kind === kind).length
  const floor = (column: number, area: number, row: number) => cellFloor(grid, column, level.areas[area].top + row)
  const tile = (column: number, area: number, row: number) => tileAt(grid, column, level.areas[area].top + row)
  const indexOf = (column: number, area: number, row: number) => level.enemies.findIndex((enemy) => Math.floor(enemy.x) === column && Math.floor(enemy.y) === level.areas[area].top + row)

  it('passes validation, first-person rules included', () => {
    expect(LEVEL_1_1.firstPerson).toBe(true)
    expect(validateLevel(level)).toEqual([])
  })

  it('runs the five areas of the design: town field, windmill slope, threshing yard, field road and the boss field', () => {
    expect(level.grid.columns).toBe(60)
    expect(level.areas.map((area) => area.name)).toEqual(['镇口麦田', '风车坡', '晒谷场', '田埂小路', '收割场'])
    expect(level.areas.map((area) => area.bottom - area.top)).toEqual([46, 54, 50, 26, 34])
    expect(level.areas.map((area) => area.kind)).toEqual(['normal', 'normal', 'normal', 'normal', 'boss'])
    expect(new Set(level.areas.map((area) => area.theme)).size).toBe(5)
    expect(level.areas.map((area) => area.walls)).toEqual(['hedge', null, null, null, null])
  })

  it('keeps the enemies of the design: chargers first, gunners next, both mixed in the yard, nobody on the road', () => {
    expect(kindsIn(0)).toEqual(new Set(['grunt']))
    expect(count(0, 'grunt')).toBe(8)
    expect(count(1, 'gunner')).toBe(4)
    expect(count(1, 'grunt')).toBe(7)
    expect(count(2, 'grunt')).toBe(7)
    expect(count(2, 'gunner')).toBe(3)
    expect(kindsIn(3).size).toBe(0)
    expect(level.enemies.every((enemy) => enemy.affixes.length === 0)).toBe(true)
    expect(level.boss?.id).toBe('scarecrow')
    expect(level.summonPoints.length).toBeGreaterThanOrEqual(2)
  })

  it('starts in a lane between three-metre wheat banks, with no enemy in sight and little ground showing', () => {
    const start = level.playerStart
    expect(Math.floor(start.y) - level.areas[0].top).toBe(41)
    expect([7, 8, 13, 14].map((column) => [tile(column, 0, 40), floor(column, 0, 40)])).toEqual([
      [Tile.Bush, 3],
      [Tile.Floor, 0],
      [Tile.Floor, 0],
      [Tile.Bush, 3],
    ])
    const eye = { x: start.x, y: start.y, z: cellFloor(grid, Math.floor(start.x), Math.floor(start.y)) + eyeHeightOf('player') }
    const seen = level.enemies.filter((enemy) => {
      const ground = cellFloor(grid, Math.floor(enemy.x), Math.floor(enemy.y))
      return lineClear(grid, eye, { x: enemy.x, y: enemy.y, z: ground + bodyHeightOf(enemy.kind) - 0.15 }, blocksBullets)
    })
    expect(seen).toEqual([])
    const walk = reachableFrom(grid, start, true)
    let open = 0
    let shown = 0
    for (let row = 0; row < grid.rows; row++) {
      for (let column = 0; column < grid.columns; column++) {
        if (walk[row * grid.columns + column] !== 1) continue
        open++
        if (lineClear(grid, eye, { x: column + 0.5, y: row + 0.5, z: cellFloor(grid, column, row) + 1 }, blocksBullets)) shown++
      }
    }
    expect(open).toBeGreaterThan(5000)
    expect(shown / open).toBeLessThan(0.08)
  })

  it('sends the patrolling charger across the field past the mouth of the lane, too far to spot the hero at the start', () => {
    const patrol = level.enemies.find((enemy) => enemy.area === 0 && enemy.idle === 'patrol')!
    expect([Math.floor(patrol.x), Math.floor(patrol.y) - level.areas[0].top]).toEqual([5, 23])
    expect(patrol.route.map((point) => Math.floor(point.y) - level.areas[0].top)).toEqual([23, 23])
    expect(Math.min(...patrol.route.map((point) => point.x))).toBeLessThan(8)
    expect(Math.max(...patrol.route.map((point) => point.x))).toBeGreaterThan(13)
    expect(Math.hypot(patrol.x - level.playerStart.x, patrol.y - level.playerStart.y)).toBeGreaterThan(createDefaultTuning().grunt.sight)
  })

  it('lets the patrolling charger find the hero alone, springs the wheat ambush at the chest and wakes the north squad together', () => {
    const world = createWorld(level, createDefaultTuning(), { debug: { invincible: true } })
    const top = level.areas[0].top
    const awake = () => world.enemies.filter((enemy) => enemy.area === 0 && enemy.aggro).map((enemy) => enemy.idleMode)
    const wait = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds * 60); i++) stepWorld(world, idleCommand(world), 1 / 60)
    }
    const place = (x: number, y: number) => {
      world.player.pos = { x, y: top + y }
      world.player.prev = { ...world.player.pos }
    }
    const clear = () => {
      for (const enemy of world.enemies) if (enemy.aggro) enemy.hp = 0
      world.enemies = world.enemies.filter((enemy) => enemy.hp > 0)
    }
    wait(2)
    expect(awake()).toEqual([])
    const patrol = world.enemies.find((enemy) => enemy.area === 0 && enemy.idleMode === 'patrol')!
    place(patrol.pos.x, patrol.pos.y - top + 3)
    wait(1)
    expect(awake()).toEqual(['patrol'])
    expect(world.barks.has('sorry')).toBe(true)
    clear()
    place(31.5, 18.5)
    wait(1)
    expect(awake()).toEqual([])
    place(50.5, 20.5)
    wait(0.5)
    expect(awake()).toEqual(['ambush', 'ambush', 'ambush'])
    clear()
    place(29.5, 14.5)
    wait(1)
    expect(awake()).toEqual([])
    place(33.5, 6.5)
    wait(1)
    expect(awake()).toEqual(['guard', 'guard', 'guard', 'guard'])
  })

  it('crosses the river on two bridges, split by a ridge, and climbs the north bank in half-metre steps', () => {
    expect(tile(10, 1, 38)).toBe(Tile.Water)
    expect(floor(10, 1, 38)).toBe(0)
    expect([12, 46].map((column) => [tile(column, 1, 38), floor(column, 1, 38)])).toEqual([
      [Tile.Path, 0.5],
      [Tile.Path, 0.5],
    ])
    expect([35, 34, 33, 32].map((row) => floor(10, 1, row))).toEqual([0.5, 1, 1.5, 2])
    for (let row = 26; row <= 46; row++) expect(tile(31, 1, row) === Tile.Boulder || floor(31, 1, row) === 4.5).toBe(true)
    const windmill = level.landmarks.find((landmark) => landmark.id === 'ch1-windmill')!
    for (const cell of windmill.cells) expect(grid.floor[cell]).toBe(3)
    expect([21, 19, 18].map((row) => floor(45, 1, row))).toEqual([2, 2.5, 3])
    for (const gunner of level.enemies.filter((enemy) => enemy.area === 1 && enemy.kind === 'gunner')) {
      expect(cellFloor(grid, Math.floor(gunner.x), Math.floor(gunner.y))).toBeGreaterThanOrEqual(2)
    }
  })

  it('keeps the wheat banks and the hill tops out of reach, so they really cut the view', () => {
    const climb = climbableFrom(grid, level.playerStart)
    const blocked = (area: number, height: number) => {
      const cells: number[] = []
      for (let row = level.areas[area].top; row < level.areas[area].bottom; row++) {
        for (let column = 1; column < grid.columns - 1; column++) if (!blocksMovement(tileAt(grid, column, row)) && cellFloor(grid, column, row) >= height) cells.push(row * grid.columns + column)
      }
      return cells
    }
    const banks = blocked(0, 3)
    const hills = blocked(1, 4.5)
    expect(banks.length).toBeGreaterThan(500)
    expect(hills.length).toBeGreaterThan(500)
    for (const cell of [...banks, ...hills]) expect(climb[cell]).toBe(0)
    const weapon = level.chests.find((chest) => chest.tier === 'weapon')!
    const reachable = reachableFrom(grid, level.playerStart, true)
    expect(reachable[Math.floor(weapon.y) * grid.columns + Math.floor(weapon.x)]).toBe(1)
  })

  it('walls the rare chest at the altar in with boulders too tall to jump, so the only way in is through the grass', () => {
    const rare = level.chests.find((chest) => chest.tier === 'rare')!
    const column = Math.floor(rare.x)
    const row = Math.floor(rare.y)
    expect(tileAt(grid, column, row - 1)).toBe(Tile.Boulder)
    expect(tileAt(grid, column, row + 1)).toBe(Tile.Boulder)
    expect(tileAt(grid, column + 1, row)).toBe(Tile.Bush)
    expect(cellTop(grid, column, row - 1) - cellFloor(grid, column, row - 1)).toBeGreaterThan(JUMP_HEIGHT)
  })

  it('hides the windmill-slope chargers in the grass as an ambush instead of a squad that wakes the town field', () => {
    const bushes = (column: number, row: number) => [-1, 0, 1].flatMap((dr) => [-1, 0, 1].map((dc) => tileAt(grid, column + dc, row + dr))).filter((cell) => cell === Tile.Bush).length
    const grass = level.enemies.filter((enemy) => enemy.area === 1 && bushes(Math.floor(enemy.x), Math.floor(enemy.y)) >= 4)
    expect(grass).toHaveLength(3)
    expect(grass.every((enemy) => enemy.idle === 'ambush')).toBe(true)
  })

  it('puts a walk-in barn by the yard entrance with its doors toward the road in and the chest inside', () => {
    const barn = level.landmarks.find((landmark) => landmark.id === 'ch1-barn')!
    expect(barn.area).toBe(2)
    expect([barn.width, barn.depth]).toEqual([8, 9])
    const chest = level.chests.find((item) => item.area === 2)!
    expect(chest.x).toBeGreaterThan(barn.column + 1)
    expect(chest.x).toBeLessThan(barn.column + barn.width - 1)
    expect(chest.y).toBeGreaterThan(barn.row + 1)
    expect(chest.y).toBeLessThan(barn.row + barn.depth - 1)
    const doorRow = barn.row + barn.depth - 1
    const door = [...Array(barn.width).keys()].map((offset) => barn.column + offset).filter((column) => !blocksMovement(tileAt(grid, column, doorRow)))
    expect(door).toHaveLength(2)
    const reachable = reachableFrom(grid, level.playerStart, true)
    expect(reachable[Math.floor(chest.y) * grid.columns + Math.floor(chest.x)]).toBe(1)
  })

  it('raises the threshing floor a metre over the yard with ramps on the west and east sides and a jump-up north edge', () => {
    expect(floor(35, 2, 30)).toBe(3)
    expect(floor(15, 2, 30)).toBe(2)
    expect([28, 29, 30].map((column) => floor(column, 2, 30))).toEqual([2, 2.5, 3])
    expect([50, 49, 47].map((column) => floor(column, 2, 32))).toEqual([2, 2.5, 3])
    expect(floor(35, 2, 24) - floor(35, 2, 23)).toBe(1)
    for (const enemy of level.enemies.filter((item) => item.area === 2 && item.idle !== 'ambush' && item.x > 20)) {
      expect(cellFloor(grid, Math.floor(enemy.x), Math.floor(enemy.y))).toBe(3)
    }
  })

  it('hides the threshing floor from the yard entrance behind a row of big haystacks', () => {
    const top = level.areas[2].top
    const eye = { x: 15.5, y: top + 47.5, z: floor(15, 2, 47) + eyeHeightOf('player') }
    const platform = level.enemies.filter((enemy) => enemy.area === 2 && enemy.idle !== 'ambush' && enemy.x > 20)
    expect(platform).toHaveLength(5)
    for (const enemy of platform) {
      const ground = cellFloor(grid, Math.floor(enemy.x), Math.floor(enemy.y))
      expect(lineClear(grid, eye, { x: enemy.x, y: enemy.y, z: ground + bodyHeightOf(enemy.kind) - 0.15 }, blocksBullets)).toBe(false)
    }
    expect([26, 35, 43].map((row) => tile(20, 2, row))).toEqual([Tile.Boulder, Tile.Boulder, Tile.Boulder])
  })

  it('keeps the barn squad and the threshing floor squad from waking each other', () => {
    const tuning = createDefaultTuning()
    const yard = level.enemies.map((enemy, index) => ({ enemy, index })).filter(({ enemy }) => enemy.area === 2 && enemy.idle !== 'ambush')
    const west = yard.filter(({ enemy }) => enemy.x < 14).map(({ index }) => index)
    const east = yard.filter(({ enemy }) => enemy.x > 20).map(({ index }) => index)
    expect([west.length, east.length]).toEqual([3, 5])
    for (const seed of west) expect(wakeChain(level, seed, tuning).some((index) => east.includes(index))).toBe(false)
    for (const seed of east) expect(wakeChain(level, seed, tuning).some((index) => west.includes(index))).toBe(false)
  })

  it('springs the two yard ambushers from behind a haystack and a wall in the north half, ahead of the road', () => {
    const ambushers = level.enemies.filter((enemy) => enemy.area === 2 && enemy.idle === 'ambush')
    expect(ambushers).toHaveLength(2)
    for (const enemy of ambushers) {
      const column = Math.floor(enemy.x)
      const row = Math.floor(enemy.y)
      const near = [-2, -1, 0, 1, 2]
      const cover = near.flatMap((dr) => near.map((dc) => tileAt(grid, column + dc, row + dr))).filter((cell) => cell === Tile.Boulder || cell === Tile.Wall)
      expect(cover.length).toBeGreaterThan(0)
      expect(row - level.areas[2].top).toBeLessThan(20)
    }
    expect(indexOf(22, 2, 15)).toBeGreaterThanOrEqual(0)
    expect(indexOf(33, 2, 5)).toBeGreaterThanOrEqual(0)
  })

  it('hides a chest in the field, a weapon chest behind the windmill, a rare one at the altar and one in the barn, and rests at a campfire before the boss', () => {
    expect(level.chests.map((chest) => [chest.area, chest.tier])).toEqual(
      expect.arrayContaining([
        [0, 'normal'],
        [1, 'weapon'],
        [1, 'rare'],
        [2, 'normal'],
      ]),
    )
    expect(level.chests).toHaveLength(4)
    expect(level.supplies.map((supply) => supply.area)).toEqual([3])
  })

  it('puts the chapter landmarks where the design places them', () => {
    const placed = level.landmarks.map((landmark) => [landmark.id, landmark.area])
    expect(placed).toEqual([['ch1-town-gate', 0], ['ch1-windmill', 1], ['ch1-star-altar', 1], ['ch1-barn', 2], ...Array(5).fill(['ch1-wheat-ears', 3])])
    const at = (id: string) => level.landmarks.find((landmark) => landmark.id === id)!
    const altar = at('ch1-star-altar')
    const rare = level.chests.find((chest) => chest.tier === 'rare')!
    expect(Math.floor(rare.x)).toBe(altar.column + altar.width)
    expect(rare.y).toBeGreaterThanOrEqual(altar.row)
    expect(rare.y).toBeLessThan(altar.row + altar.depth)
    expect(altar.facing).toBe(270)
    const windmill = at('ch1-windmill')
    const weapon = level.chests.find((chest) => chest.tier === 'weapon')!
    expect(weapon.x).toBeGreaterThan(windmill.column + windmill.width)
    expect(weapon.y).toBeGreaterThanOrEqual(windmill.row)
    expect(weapon.y).toBeLessThan(windmill.row + windmill.depth)
  })

  it('opens the road straight onto the south gate of a round boss field about 30 metres across, with five pieces of cover', () => {
    const arena = level.areas[4]
    const widths: number[] = []
    for (let row = arena.top; row < arena.bottom; row++) {
      let open = 0
      for (let column = 0; column < grid.columns; column++) if (!blocksMovement(tileAt(grid, column, row)) || tileAt(grid, column, row) === Tile.Boulder || tileAt(grid, column, row) === Tile.Rock) open++
      widths.push(open)
    }
    expect(Math.max(...widths)).toBe(30)
    expect(widths.filter((width) => width >= 20).length).toBeGreaterThanOrEqual(18)
    const cover = Array.from(grid.tiles.subarray(arena.top * grid.columns, arena.bottom * grid.columns))
    expect(cover.filter((cell) => cell === Tile.Boulder)).toHaveLength(8)
    expect(cover.filter((cell) => cell === Tile.Rock)).toHaveLength(4)
    const gate = arena.gates.filter((cell) => Math.floor(cell / grid.columns) === arena.bottom - 1).map((cell) => cell % grid.columns)
    const road = level.areas[3]
    for (const column of gate) expect(blocksMovement(tileAt(grid, column, road.top))).toBe(false)
  })
})

describe('level 1-2', () => {
  const level = buildLevel(LEVEL_1_2)
  const { grid } = level
  const tuning = createDefaultTuning()
  const kinds = (area: number) => level.enemies.filter((enemy) => enemy.area === area).map((enemy) => enemy.kind)
  const count = (area: number, kind: string) => kinds(area).filter((item) => item === kind).length
  const placed = (id: string) => level.landmarks.filter((landmark) => landmark.id === id)
  const inside = (x: number, y: number, landmark: { column: number; row: number; width: number; depth: number }) =>
    x >= landmark.column && x < landmark.column + landmark.width && y >= landmark.row && y < landmark.row + landmark.depth
  const local = (area: number, row: number) => row - level.areas[area].top
  const floor = (column: number, area: number, row: number) => cellFloor(grid, column, level.areas[area].top + row)
  const squad = (area: number, keep: (row: number) => boolean) =>
    level.enemies.flatMap((enemy, index) => (enemy.area === area && enemy.idle !== 'ambush' && keep(local(area, Math.floor(enemy.y))) ? [index] : []))
  const apart = (a: number[], b: number[]) => {
    for (const seed of a) expect(wakeChain(level, seed, tuning).some((index) => b.includes(index))).toBe(false)
    for (const seed of b) expect(wakeChain(level, seed, tuning).some((index) => a.includes(index))).toBe(false)
  }
  const stacks = (area: number) =>
    Array.from(grid.tiles).flatMap((tile, index) =>
      tile === Tile.Crate && level.areaOfRow[Math.floor(index / grid.columns)] === area && grid.top[index] - grid.floor[index] > 2 ? [index] : [],
    )

  it('is a first-person level and passes validation, its rules included', () => {
    expect(LEVEL_1_2.firstPerson).toBe(true)
    expect(validateLevel(level)).toEqual([])
  })

  it('stacks five areas of its own themes, 40 wide and 167 long, with a destroy area and a boss barn', () => {
    expect([grid.columns, grid.rows]).toEqual([40, 167])
    expect(level.areas.map((area) => area.name)).toEqual(['牧场入口', '羊圈', '装车场', '磨坊', '大谷仓'])
    expect(level.areas.map((area) => area.bottom - area.top)).toEqual([38, 32, 40, 22, 35])
    expect(level.areas.map((area) => area.theme)).toEqual(['meadow', 'village', 'farm', 'forest', 'arena'])
    expect(level.areas.map((area) => area.kind)).toEqual(['normal', 'normal', 'destroy', 'normal', 'boss'])
    expect(LEVEL_1_2.unlockAfter).toBe('1-1')
  })

  it('brings in one new enemy, the bomber, alone first and then mixed in', () => {
    expect(kinds(0)).toEqual(['bomber', 'bomber', 'bomber', 'bomber'])
    expect([count(1, 'grunt'), count(1, 'bomber'), kinds(1).length]).toEqual([4, 3, 7])
    expect([count(2, 'gunner'), count(2, 'grunt'), count(2, 'bomber'), kinds(2).length]).toEqual([5, 4, 2, 11])
    expect(kinds(3)).toEqual([])
    expect(level.enemies.filter((enemy) => enemy.area === 1).every((enemy) => enemy.idle !== 'guard')).toBe(true)
    expect(level.enemies.filter((enemy) => enemy.route.length > 1)).toHaveLength(1)
    expect(level.boss?.id).toBe('demo-chief')
    expect(level.summonPoints).toHaveLength(4)
  })

  it('stands the lone bomber on the road 15 metres ahead, out of sight, and hides three more in the grass atop the slope', () => {
    const lone = level.enemies.filter((enemy) => enemy.area === 0 && enemy.idle !== 'ambush')
    expect(lone).toHaveLength(1)
    const start = level.playerStart
    const distance = Math.hypot(lone[0].x - start.x, lone[0].y - start.y)
    expect(distance).toBeGreaterThan(14.5)
    expect(distance).toBeLessThan(15.5)
    expect(distance).toBeGreaterThan(tuning.bomber.sight)
    expect(tileAt(grid, Math.floor(lone[0].x), Math.floor(lone[0].y))).toBe(Tile.Path)
    const grass = level.enemies.filter((enemy) => enemy.area === 0 && enemy.idle === 'ambush')
    expect(grass).toHaveLength(3)
    const bushes = (column: number, row: number) => [-1, 0, 1].flatMap((dr) => [-1, 0, 1].map((dc) => tileAt(grid, column + dc, row + dr))).filter((cell) => cell === Tile.Bush).length
    for (const enemy of grass) {
      expect(bushes(Math.floor(enemy.x), Math.floor(enemy.y))).toBe(8)
      expect(enemy.y).toBeLessThan(lone[0].y)
      expect(cellFloor(grid, Math.floor(enemy.x), Math.floor(enemy.y)) - cellFloor(grid, Math.floor(start.x), Math.floor(start.y))).toBe(1)
      expect(Math.hypot(enemy.x - lone[0].x, enemy.y - lone[0].y)).toBeGreaterThan(14)
    }
    expect(grass.filter((enemy) => enemy.x < start.x)).toHaveLength(1)
  })

  it('blocks the road in the sheep yard with a hay pile, so the way on runs through the yard', () => {
    for (let column = 17; column <= 22; column++) {
      for (let row = 16; row <= 18; row++) expect(tileAt(grid, column, level.areas[1].top + row)).toBe(Tile.Wall)
    }
    for (let column = 1; column <= 16; column++) expect(tileAt(grid, column, level.areas[1].top + 17)).toBe(Tile.Wall)
    const reachable = reachableFrom(grid, level.playerStart)
    expect(reachable[(level.areas[1].top + 10) * grid.columns + 19]).toBe(1)
    expect(reachable[(level.areas[1].top + 4) * grid.columns + 23]).toBe(1)
  })

  it('raises a hay platform two metres over the yard in its south-west court, reached by one ramp, with a view over the hay walls', () => {
    expect(floor(19, 1, 20)).toBe(1)
    for (let column = 23; column <= 28; column++) expect(floor(column, 1, 25)).toBe(3)
    expect([20, 21, 22, 23].map((row) => floor(25, 1, row))).toEqual([1.5, 2, 2.5, 3])
    const reachable = reachableFrom(grid, level.playerStart)
    expect(reachable[(level.areas[1].top + 25) * grid.columns + 25]).toBe(1)
    const wall = cellTop(grid, 29, level.areas[1].top + 25)
    expect(floor(25, 1, 25) + eyeHeightOf('player')).toBeGreaterThan(wall)
  })

  it('shuts three corridors of the sheep yard with crate stacks too tall to jump and scatters nine loose crates', () => {
    const tall = stacks(1)
    expect(tall).toHaveLength(8)
    for (const index of tall) expect(grid.top[index] - grid.floor[index]).toBeGreaterThan(JUMP_HEIGHT)
    const loose = Array.from(grid.tiles).filter(
      (tile, index) => tile === Tile.Crate && level.areaOfRow[Math.floor(index / grid.columns)] === 1 && grid.top[index] - grid.floor[index] === 1,
    )
    expect(loose).toHaveLength(9)
    expect(reachableFrom(grid, level.playerStart)[(level.areas[1].top + 10) * grid.columns + 23]).toBe(1)
  })

  it('keeps the north and south squads of the sheep yard from waking each other', () => {
    const north = squad(1, (row) => row < 10)
    const south = squad(1, (row) => row > 12)
    expect(north.map((index) => level.enemies[index].kind).sort()).toEqual(['bomber', 'bomber', 'grunt'])
    expect(south).toHaveLength(4)
    apart(north, south)
  })

  it('keeps the three stations of the loading yard apart and wakes the north one with the dock at most five at once', () => {
    const north = squad(2, (row) => row < 12)
    const middle = squad(2, (row) => row > 12 && row < 24)
    const south = squad(2, (row) => row > 24)
    expect([north.length, middle.length, south.length]).toEqual([5, 3, 3])
    apart(north, middle)
    apart(middle, south)
    apart(north, south)
    for (const seed of north) expect(wakeChain(level, seed, tuning).length).toBeLessThanOrEqual(5)
  })

  it('stands the gunners of the loading yard on loading docks, a haystack and the river bank', () => {
    const gunners = level.enemies.filter((enemy) => enemy.area === 2 && enemy.kind === 'gunner')
    const heights = gunners.map((enemy) => cellFloor(grid, Math.floor(enemy.x), Math.floor(enemy.y)) - 1).sort()
    expect(heights).toEqual([1, 1, 1.5, 1.5, 2])
  })

  it('puts the chests in the feed shed, on the dock and in the hidden nook by the wheel', () => {
    const [shed] = placed('ch1-feed-shed')
    const [dock] = placed('ch1-dock')
    const [mill] = placed('ch1-watermill')
    const normal = level.chests.find((chest) => chest.tier === 'normal')!
    const weapon = level.chests.find((chest) => chest.tier === 'weapon')!
    const rare = level.chests.find((chest) => chest.tier === 'rare')!
    expect(level.chests).toHaveLength(3)
    expect([shed.width, shed.depth]).toEqual([4, 5])
    expect([Math.floor(normal.x), Math.floor(normal.y)]).toEqual([shed.column + 1, shed.row + 1])
    expect(shed.facing).toBe(0)
    expect(inside(weapon.x, weapon.y, dock)).toBe(true)
    expect(weapon.weapon).toBe('shotgun')
    expect(inside(rare.x, rare.y, mill)).toBe(true)
    expect(level.supplies.map((supply) => supply.area)).toEqual([3])
    expect(reachableFrom(grid, level.playerStart)[Math.floor(rare.y) * grid.columns + Math.floor(rare.x)]).toBe(0)
    expect(level.secrets).toHaveLength(1)
    expect(level.secrets[0].landmark).toBe(level.landmarks.indexOf(mill))
    expect(stacks(3)).toHaveLength(2)
  })

  it('lays out the landmarks the design asks for', () => {
    expect(placed('ch1-sheep-pen')).toHaveLength(4)
    expect(new Set(placed('ch1-sheep-pen').map((pen) => pen.facing)).size).toBe(4)
    expect(placed('ch1-hay-cart').map((cart) => [cart.area, cart.facing])).toEqual([
      [2, 0],
      [2, 90],
      [2, 180],
    ])
    expect(placed('ch1-hay-pillar').map((pillar) => pillar.area)).toEqual([4, 4, 4, 4, 4, 4])
    expect(placed('ch1-watermill').map((mill) => [mill.area, mill.facing])).toEqual([[3, 90]])
    expect(placed('ch1-dock').map((dock) => [dock.area, dock.facing])).toEqual([[2, 270]])
    expect(placed('grunt-wreck').map((wreck) => wreck.area)).toEqual([3])
    expect(placed('ch1-wheat-ears').every((ears) => ears.area === 0)).toBe(true)
    expect(level.pastures.map((pasture) => pasture.area)).toEqual([1])
    expect(level.clues).toEqual([{ id: 'iou', area: 2, at: null }])
  })

  it('sinks the pasture a metre below the yard, fenced, with a sloped gate toward the road', () => {
    const [pasture] = level.pastures
    expect(cellFloor(grid, pasture.column + 2, pasture.row + 2)).toBe(0)
    expect(floor(16, 1, 24)).toBe(1)
    expect(floor(14, 1, 24)).toBe(0.5)
    expect(tileAt(grid, 14, level.areas[1].top + 22)).toBe(Tile.Fence)
  })

  it('sets the wheel over the mill race and the dock over the river', () => {
    const [mill] = placed('ch1-watermill')
    expect(mill.water).toHaveLength(4)
    for (const cell of mill.water) expect(Math.floor(cell / grid.columns)).toBe(mill.row + mill.depth - 1)
    const [dock] = placed('ch1-dock')
    const { columns } = grid
    const touchesWater = dock.cells.some((cell) =>
      [1, -1, columns, -columns].some((step) => !dock.cells.includes(cell + step) && grid.tiles[cell + step] === Tile.Water),
    )
    expect(touchesWater).toBe(true)
    for (const cell of dock.cells) expect(blocksMovement(grid.tiles[cell] as Tile)).toBe(false)
  })

  it('gives the loading yard a north gate only', () => {
    const yard = level.areas[2]
    expect(yard.gates.every((gate) => Math.floor(gate / grid.columns) === yard.top)).toBe(true)
    expect(yard.gates).toHaveLength(4)
  })

  it('makes the boss barn a 32 by 30 hall with six hay pillars to hide behind', () => {
    const barn = level.areas[4]
    const { columns } = grid
    const open: number[][] = []
    for (let row = barn.top; row < barn.bottom; row++) {
      for (let column = 0; column < columns; column++) {
        if (!blocksMovement(tileAt(grid, column, row)) || level.landmarkAt[row * columns + column] >= 0) open.push([column, row])
      }
    }
    const hall = open.filter(([, row]) => row > barn.top + 3 && row < barn.bottom - 1)
    const columnsUsed = new Set(hall.map(([column]) => column))
    const rowsUsed = new Set(hall.map(([, row]) => row))
    expect([columnsUsed.size, rowsUsed.size]).toEqual([32, 30])
    expect(hall).toHaveLength(columnsUsed.size * rowsUsed.size)
    for (const pillar of placed('ch1-hay-pillar')) {
      expect(LANDMARKS[pillar.id].blocksShots).toBe(true)
      for (const cell of pillar.cells) expect(blocksBullets(grid.tiles[cell] as Tile)).toBe(true)
    }
  })
})

describe('level 1-3', () => {
  const level = buildLevel(LEVEL_1_3)
  const { columns } = level.grid
  const kinds = (area: number) => level.enemies.filter((enemy) => enemy.area === area).map((enemy) => enemy.kind)
  const count = (area: number, kind: string) => kinds(area).filter((item) => item === kind).length
  const placed = (id: string, area?: number) => level.landmarks.filter((landmark) => landmark.id === id && (area === undefined || landmark.area === area))
  const inside = (x: number, y: number, landmark: { column: number; row: number; width: number; depth: number }) =>
    x >= landmark.column && x < landmark.column + landmark.width && y >= landmark.row && y < landmark.row + landmark.depth

  it('passes validation', () => {
    expect(validateLevel(level)).toEqual([])
  })

  it('stacks the five areas of the design, 40 wide, with a lock fight and a boss yard, after 1-2', () => {
    expect(columns).toBe(40)
    expect(level.areas.map((area) => area.name)).toEqual(['村口废墟', '麦垛潜行段', '农舍院子', '粮仓办公室', '粮仓大院'])
    expect(level.areas.map((area) => area.theme)).toEqual(['village', 'farm', 'farm', 'village', 'arena'])
    expect(level.areas.map((area) => area.kind)).toEqual(['normal', 'normal', 'lock', 'normal', 'boss'])
    expect(LEVEL_1_3.unlockAfter).toBe('1-2')
    expect(level.boss?.id).toBe('shield-captain')
    expect(level.summonPoints).toHaveLength(4)
  })

  it('brings in the shield bearer alone at the alley, then mixes the first two areas in the lock fight', () => {
    expect([count(0, 'shield'), count(0, 'grunt'), kinds(0).length]).toEqual([1, 2, 3])
    expect(level.enemies.filter((enemy) => enemy.area === 0 && enemy.kind === 'grunt').every((enemy) => enemy.idle === 'wander')).toBe(true)
    expect(level.enemies.find((enemy) => enemy.area === 0 && enemy.kind === 'shield')?.idle).toBe('guard')
    expect([count(1, 'gunner'), count(1, 'grunt'), kinds(1).length]).toEqual([2, 3, 5])
    const routes = level.enemies.filter((enemy) => enemy.area === 1 && enemy.route.length > 1)
    expect(routes).toHaveLength(4)
    expect(new Set(routes.map((enemy) => enemy.route.map((point) => `${point.x},${point.y}`).sort().join(' '))).size).toBe(3)
    expect([count(2, 'shield'), count(2, 'gunner'), count(2, 'grunt')]).toEqual([2, 2, 3])
    expect(kinds(3)).toEqual([])
  })

  it('narrows the village to a 2-wide alley guarded by the shield bearer, with a 1-wide lane on each side', () => {
    const village = level.areas[0]
    const barricade = village.top + 10
    const open: number[] = []
    for (let column = 1; column < columns - 1; column++) if (!blocksMovement(tileAt(level.grid, column, barricade))) open.push(column)
    expect(open).toEqual([12, 19, 20, 27])
    const guard = level.enemies.find((enemy) => enemy.area === 0 && enemy.kind === 'shield')!
    expect(Math.floor(guard.y)).toBe(village.top + 7)
    expect(Math.floor(guard.x)).toBeGreaterThanOrEqual(19)
    expect(Math.floor(guard.x)).toBeLessThanOrEqual(20)
    expect(placed('ch1-ruined-wall').length).toBeGreaterThanOrEqual(20)
    expect(placed('ch1-ruined-wall').length).toBeLessThanOrEqual(30)
    expect(placed('ch1-ruined-wall').every((wall) => wall.area === 0)).toBe(true)
  })

  it('hides a chest in the east column of the half-fallen smithy', () => {
    const [smithy] = placed('ch1-smithy')
    expect([smithy.area, smithy.facing]).toEqual([0, 0])
    const chest = level.chests.find((item) => item.tier === 'normal')!
    expect(inside(chest.x, chest.y, smithy)).toBe(true)
    expect(Math.floor(chest.x)).toBe(smithy.column + 2)
  })

  it('lines the stealth field with wheat stacks and puts the bell tower north, with its door as the end of the run', () => {
    const wheat = placed('ch1-wheat-stack', 1)
    expect(wheat.length).toBeGreaterThanOrEqual(25)
    expect(wheat.length).toBeLessThanOrEqual(35)
    for (const stack of wheat) expect(level.grid.tiles[stack.row * columns + stack.column]).toBe(Tile.Bush)
    const [tower] = placed('ch1-bell-tower')
    expect(tower.area).toBe(1)
    expect(tower.row).toBeLessThan(level.areas[1].top + 5)
    expect(Math.abs(tower.column + tower.width / 2 - columns / 2)).toBeLessThanOrEqual(1)
    expect(level.alarms).toEqual([{ area: 1, landmark: level.landmarks.indexOf(tower), post: { x: tower.column + 1.5, y: tower.row + tower.depth + 0.5 } }])
    const weapon = level.chests.find((item) => item.tier === 'weapon')!
    expect(weapon.weapon).toBe('smg')
    expect(Math.hypot(weapon.x - level.alarms[0].post.x, weapon.y - level.alarms[0].post.y)).toBeLessThanOrEqual(2.5)
  })

  it('sends the alarm reinforcements through the north gate of the farmhouse yard', () => {
    const yard = level.areas[2]
    expect(level.reinforcements).toHaveLength(1)
    const squad = level.reinforcements[0]
    expect(squad.area).toBe(2)
    expect(squad.enemies).toEqual([
      { kind: 'shield', count: 2 },
      { kind: 'grunt', count: 2 },
    ])
    const north = yard.gates.filter((gate) => Math.floor(gate / columns) === yard.top).map((gate) => gate % columns)
    for (const point of squad.points) {
      expect(point.y - yard.top).toBeLessThan(4)
      expect(Math.min(...north.map((column) => Math.abs(column + 0.5 - point.x)))).toBeLessThanOrEqual(2)
    }
    expect(placed('ch1-farmhouse', 2)).toHaveLength(1)
    expect(placed('ch1-well', 2)).toHaveLength(1)
    const crates = Array.from(level.grid.tiles).filter((tile, index) => tile === Tile.Crate && level.areaOfRow[Math.floor(index / columns)] === 2).length
    expect(crates).toBeGreaterThanOrEqual(6)
    expect(crates).toBeLessThanOrEqual(8)
  })

  it('keeps the cellar behind wheat stacks in the office yard, with the rare chest one cell beside it', () => {
    const [cellar] = placed('ch1-cellar')
    expect(cellar.area).toBe(3)
    expect(LANDMARKS['ch1-cellar'].blocksShots).toBe(false)
    const rare = level.chests.find((item) => item.tier === 'rare')!
    const gapX = Math.max(cellar.column - Math.floor(rare.x), Math.floor(rare.x) - (cellar.column + cellar.width - 1), 0)
    const gapY = Math.max(cellar.row - Math.floor(rare.y), Math.floor(rare.y) - (cellar.row + cellar.depth - 1), 0)
    expect(gapX + gapY).toBe(1)
    expect(level.secrets).toHaveLength(1)
    const secret = level.secrets[0]
    expect(secret.landmark).toBe(level.landmarks.indexOf(cellar))
    expect(insideRegion(secret, rare.x, rare.y)).toBe(true)
    const walled = { ...level.grid, tiles: level.grid.tiles.map((tile) => (tile === Tile.Bush ? Tile.Wall : tile)) }
    expect(reachableFrom(walled, level.playerStart)[Math.floor(rare.y) * columns + Math.floor(rare.x)]).toBe(0)
    expect(reachableFrom(level.grid, level.playerStart)[Math.floor(rare.y) * columns + Math.floor(rare.x)]).toBe(1)
    expect(placed('ch1-wheat-stack', 3).length).toBeGreaterThanOrEqual(5)
    expect(placed('ch1-wheat-stack', 3).length).toBeLessThanOrEqual(8)
    expect(level.clues).toEqual([{ id: 'manifest', area: 3, at: expect.any(Object) }])
    expect(level.supplies.map((supply) => supply.area)).toEqual([3])
    expect(level.chests).toHaveLength(3)
  })

  it('staggers four silos in the boss yard instead of mirroring them', () => {
    const silos = placed('ch1-silo')
    expect(silos).toHaveLength(4)
    expect(silos.every((silo) => silo.area === 4)).toBe(true)
    const centers = silos.map((silo) => [silo.column + 1.5, silo.row + 1.5])
    const middle = columns / 2
    const mirrored = centers.every(([x, y]) => centers.some(([ox, oy]) => Math.abs(ox - (2 * middle - x)) < 0.01 && Math.abs(oy - y) < 0.01))
    expect(mirrored).toBe(false)
    for (const silo of silos) for (const cell of silo.cells) expect(blocksBullets(level.grid.tiles[cell] as Tile)).toBe(true)
  })
})

describe('level 1-4', () => {
  const level = buildLevel(LEVEL_1_4)
  const { columns } = level.grid
  const placed = (id: string, area?: number) => level.landmarks.filter((item) => item.id === id && (area === undefined || item.area === area))
  const kinds = (area: number) => level.enemies.filter((enemy) => enemy.area === area).map((enemy) => enemy.kind).sort()
  const reachable = reachableFrom(level.grid, level.playerStart, true)
  const cell = (x: number, y: number) => Math.floor(y) * columns + Math.floor(x)

  it('passes validation', () => {
    expect(validateLevel(level)).toEqual([])
  })

  it('stacks the five areas of the design, 40 wide, foggy in the middle three, with a boss clearing, after 1-3', () => {
    expect(level.areas.map((area) => area.name)).toEqual(['林边小溪', '雾林', '溪谷炮阵', '伐木营地', '林中空地'])
    expect(level.areas.map((area) => area.theme)).toEqual(['forest', 'forest', 'forest', 'forest', 'arena'])
    expect(level.areas.map((area) => area.kind)).toEqual(['normal', 'normal', 'normal', 'normal', 'boss'])
    expect(level.areas.map((area) => area.fog)).toEqual([false, true, true, true, false])
    expect(columns).toBe(40)
    expect(LEVEL_1_4).toMatchObject({ chapter: 1, bossId: 'forest-tank', radar: true, unlockAfter: '1-3' })
    expect(level.boss?.area).toBe(4)
  })

  it('brings in the turret alone across the creek, then puts turrets and gunners in the fog', () => {
    expect(kinds(0)).toEqual(['grunt', 'grunt', 'grunt', 'turret'])
    expect(kinds(1)).toEqual(['bomber', 'bomber', 'bomber', 'grunt', 'grunt', 'grunt', 'grunt'])
    expect(level.enemies.filter((enemy) => enemy.kind === 'bomber').every((enemy) => enemy.idle === 'ambush')).toBe(true)
    for (const bomber of level.enemies.filter((enemy) => enemy.kind === 'bomber')) {
      const column = Math.floor(bomber.x)
      const row = Math.floor(bomber.y)
      const bushes = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].filter(([dc, dr]) => tileAt(level.grid, column + dc, row + dr) === Tile.Bush).length
      expect(bushes).toBeGreaterThanOrEqual(3)
    }
    expect(kinds(2)).toEqual(['gunner', 'gunner', 'gunner', 'turret', 'turret'])
    expect(kinds(3)).toEqual(['grunt', 'grunt'])
    expect(level.enemies.filter((enemy) => enemy.area === 3).every((enemy) => enemy.idle === 'wander')).toBe(true)
    expect(kinds(4)).toEqual([])
    expect(level.enemies.filter((enemy) => enemy.kind === 'turret' && enemy.area !== 2).length).toBe(1)
  })

  it('crosses the creek of the first area by a single bridge, with the turret on the far bank', () => {
    const creek = level.areas[0]
    const wet: number[] = []
    for (let row = creek.top; row < creek.bottom; row++) {
      const water = Array.from({ length: columns - 2 }, (_, index) => tileAt(level.grid, index + 1, row)).filter((tile) => tile === Tile.Water).length
      if (water > columns / 2) wet.push(row)
    }
    expect(wet.length).toBe(2)
    const crossings = [wet[0], wet[1]].map((row) => {
      const open: number[] = []
      for (let column = 1; column < columns - 1; column++) if (!blocksMovement(tileAt(level.grid, column, row))) open.push(column)
      return open
    })
    expect(crossings[0]).toEqual(crossings[1])
    expect(crossings[0].length).toBe(2)
    expect(crossings[0][1] - crossings[0][0]).toBe(1)
    const turret = level.enemies.find((enemy) => enemy.area === 0 && enemy.kind === 'turret')!
    expect(turret.y).toBeLessThan(wet[0])
    expect(level.playerStart.y).toBeGreaterThan(wet[1])
    expect(placed('ch1-log', 0).length + placed('ch1-log-short', 0).length).toBeGreaterThanOrEqual(4)
  })

  it('keeps the two valley turrets on the far bank of the stream, out of reach on foot', () => {
    const turrets = level.enemies.filter((enemy) => enemy.area === 2 && enemy.kind === 'turret')
    for (const turret of turrets) expect(reachable[cell(turret.x, turret.y)]).toBe(0)
    for (const gunner of level.enemies.filter((enemy) => enemy.area === 2 && enemy.kind === 'gunner')) expect(reachable[cell(gunner.x, gunner.y)]).toBe(1)
    expect(placed('ch1-log', 2).length + placed('ch1-log-short', 2).length).toBeGreaterThanOrEqual(4)
  })

  it('lights the way with four fog lamps: two in the woods, one in mid-valley that clears it all, one in the camp', () => {
    expect(level.lamps.map((lamp) => [lamp.area, lamp.clears])).toEqual([
      [1, false],
      [1, false],
      [2, true],
      [3, false],
    ])
    expect(placed('ch1-fog-lamp')).toHaveLength(4)
    const valley = level.areas[2]
    const lamp = level.lamps[2]
    expect(lamp.y - valley.top).toBeGreaterThan(valley.bottom - valley.top - 20)
    expect(lamp.y - valley.top).toBeLessThan(20)
  })

  it('hides a chest in the cabin, a sniper behind the waterfall and a weapon chest up on the lumber pile', () => {
    expect(level.chests.map((chest) => [chest.tier, chest.area]).sort()).toEqual([
      ['normal', 1],
      ['rare', 2],
      ['weapon', 3],
    ])
    const [cabin] = placed('ch1-cabin')
    const normal = level.chests.find((chest) => chest.tier === 'normal')!
    expect([cabin.area, cabin.facing]).toEqual([1, 0])
    expect([Math.floor(normal.x), Math.floor(normal.y)]).toEqual([cabin.column + 1, cabin.row + 1])
    const [cave] = placed('ch1-waterfall-cave')
    const rare = level.chests.find((chest) => chest.tier === 'rare')!
    expect(rare.weapon).toBe('sniper')
    expect(Math.floor(rare.y)).toBe(cave.row + 1)
    expect(level.secrets).toEqual([{ area: 2, column: cave.column + 1, row: cave.row + 1, width: 2, depth: 2, landmark: null }])
    for (const spot of [cave.pool[1], cave.pool[2]]) expect(insideRegion(level.secrets[0], (spot % columns) + 0.5, Math.floor(spot / columns) + 0.5)).toBe(true)
    expect(insideRegion(level.secrets[0], rare.x, rare.y)).toBe(true)
    expect(cave.pool).toEqual([0, 1, 2, 3].map((offset) => (cave.row + 2) * columns + cave.column + offset))
    for (const pool of cave.pool) {
      expect(cave.water).toContain(pool)
      expect(blocksMovement(level.grid.tiles[pool] as Tile)).toBe(false)
    }
    const weapon = level.chests.find((chest) => chest.tier === 'weapon')!
    const [mill] = placed('ch1-sawmill')
    expect(weapon.weapon).toBe('grenade')
    expect(weapon.perch).toMatchObject({ landmark: level.landmarks.indexOf(mill), height: 2.5 })
    expect(weapon.perch!.x).toBeGreaterThan(mill.column + 3)
    expect(Math.floor(weapon.x)).toBe(mill.column + mill.width)
    expect(level.supplies.map((supply) => supply.area)).toEqual([3])
    expect(level.clues).toEqual([{ id: 'drawing', area: 2, at: expect.any(Object) }])
    const [wreck] = placed('grunt-wreck-drawing')
    expect(Math.floor(level.clues[0].at!.y)).toBe(wreck.row)
  })

  it('rings the boss clearing with a dirt road the tank can drive round, stumps and rocks beside it', () => {
    const ring = level.ring!
    const clearing = level.areas[4]
    expect(ring.area).toBe(4)
    expect(ring.radius).toBeGreaterThan(6.5)
    expect(ring.radius).toBeLessThan(8.5)
    const boss = level.boss!
    expect(Math.abs(Math.hypot(boss.x - ring.x, boss.y - ring.y) - ring.radius)).toBeLessThan(1)
    const stumps = placed('ch1-stump')
    expect(stumps.length).toBeGreaterThanOrEqual(4)
    expect(stumps.length).toBeLessThanOrEqual(6)
    const clearance = getBoss('forest-tank').radius + 0.5
    for (const stump of stumps) {
      expect(stump.area).toBe(4)
      expect(stump.variant).not.toBe(2)
      const offset = Math.abs(Math.hypot(stump.column + 0.5 - ring.x, stump.row + 0.5 - ring.y) - ring.radius)
      expect(offset).toBeGreaterThan(clearance)
      expect(offset).toBeLessThan(3.5)
    }
    const rocks = Array.from(level.grid.tiles).filter((tile, index) => tile === Tile.Rock && level.areaOfRow[Math.floor(index / columns)] === 4).length
    expect(rocks).toBeGreaterThanOrEqual(1)
    expect(level.summonPoints).toHaveLength(4)
    expect(clearance).toBeGreaterThan(1)
    expect(clearing.gates.length).toBe(8)
  })
})

describe('level 1-5', () => {
  const level = buildLevel(LEVEL_1_5)
  const { columns } = level.grid
  const placed = (id: string, area?: number) => level.landmarks.filter((item) => item.id === id && (area === undefined || item.area === area))
  const kinds = (area: number) => level.enemies.filter((enemy) => enemy.area === area).map((enemy) => enemy.kind).sort()
  const local = (area: number, x: number, y: number) => [Math.floor(x), Math.floor(y) - level.areas[area].top]
  const tile = (area: number, column: number, row: number) => tileAt(level.grid, column, level.areas[area].top + row)

  it('passes validation', () => {
    expect(validateLevel(level)).toEqual([])
  })

  it('stacks the five areas of the design, 40 wide, after 1-4, with the harvester in the factory', () => {
    expect(level.areas.map((area) => area.name)).toEqual(['收割道', '麦捆仓', '分拣车间', '工厂大门', '收割机工厂'])
    expect(level.areas.map((area) => area.theme)).toEqual(['farm', 'village', 'factory', 'factory', 'factory'])
    expect(level.areas.map((area) => area.kind)).toEqual(['normal', 'normal', 'normal', 'normal', 'boss'])
    expect(level.areas.map((area) => area.bottom - area.top)).toEqual([24, 26, 28, 14, 20])
    expect(columns).toBe(40)
    expect(LEVEL_1_5).toMatchObject({ chapter: 1, bossId: 'harvester', unlockAfter: '1-4' })
    expect(level.boss?.area).toBe(4)
  })

  it('brings in one new thing per area: blades, then the elites, then a mixed squad on the belts, a quiet gate and the boss', () => {
    expect(kinds(0)).toEqual(['grunt', 'grunt', 'grunt', 'grunt', 'gunner', 'gunner'])
    expect(kinds(1)).toEqual(['bomber', 'bomber', 'bomber', 'grunt', 'grunt', 'grunt', 'grunt', 'gunner'])
    expect(kinds(2)).toEqual(['gunner', 'gunner', 'shield', 'shield', 'thrower', 'thrower'])
    expect(kinds(3)).toEqual([])
    expect(kinds(4)).toEqual([])
    expect(level.enemies.filter((enemy) => enemy.area === 1 && enemy.kind === 'bomber').every((enemy) => enemy.idle === 'ambush')).toBe(true)
    const elites = level.enemies.filter((enemy) => enemy.affixes.length > 0).map((enemy) => [enemy.area, enemy.kind, enemy.affixes])
    expect(elites).toEqual(
      expect.arrayContaining([
        [1, 'grunt', ['swift']],
        [1, 'gunner', ['tough']],
        [2, 'shield', ['shielded']],
      ]),
    )
    expect(elites).toHaveLength(3)
    expect(level.blades.every((lane) => lane.area === 0)).toBe(true)
    expect(level.conveyors.every((belt) => [2, 4].includes(level.areaOfRow[Math.floor(belt.index / columns)]))).toBe(true)
  })

  it('crosses the fields with three blade lanes, each with wheat on both sides and the dirt road running through', () => {
    expect(level.blades.map((lane) => [lane.column, lane.row - level.areas[0].top, lane.width, lane.depth, lane.from.x < lane.to.x])).toEqual([
      [1, 18, 38, 2, true],
      [1, 11, 38, 2, false],
      [1, 4, 38, 2, true],
    ])
    for (const lane of level.blades) {
      const row = lane.row - level.areas[0].top
      for (const side of [row - 1, row + 2]) {
        const bushes = Array.from({ length: 38 }, (_, index) => tile(0, index + 1, side)).filter((item) => item === Tile.Bush).length
        expect(bushes, `row ${side}`).toBeGreaterThanOrEqual(24)
      }
      for (let column = 18; column <= 21; column++) expect(tile(0, column, row)).toBe(Tile.Path)
    }
    const [start] = [local(0, level.playerStart.x, level.playerStart.y)]
    expect(start).toEqual([19, 21])
  })

  it('fences a small yard at the west end of the middle lane that only opens onto the lane', () => {
    const chest = level.chests.find((item) => item.tier === 'normal')!
    expect(local(0, chest.x, chest.y)).toEqual([2, 9])
    for (let column = 1; column <= 4; column++) expect(tile(0, column, 7)).toBe(Tile.Fence)
    for (let row = 7; row <= 10; row++) expect(tile(0, 4, row)).toBe(Tile.Fence)
    const lane = level.blades[1]
    expect(lane.row - level.areas[0].top).toBe(11)
    const fenced = { ...level.grid, tiles: level.grid.tiles.slice() }
    for (let column = 1; column <= 38; column++) fenced.tiles[lane.row * columns + column] = Tile.Wall
    expect(reachableFrom(fenced, level.playerStart)[Math.floor(chest.y) * columns + Math.floor(chest.x)]).toBe(0)
  })

  it('stacks 158 bale blocks into the warehouse maze, rotating their looks, with the back alley meeting the yard', () => {
    const bales = placed('ch1-bale-block')
    expect(bales).toHaveLength(158)
    expect(bales.every((bale) => bale.area === 1 && bale.cells.length === 1)).toBe(true)
    expect(new Set(bales.map((bale) => bale.variant))).toEqual(new Set([1, 2, 3]))
    for (const bale of bales) expect(bale.variant).toBe(cellVariant(bale.column, bale.row - level.areas[1].top, 3))
    const weapon = level.chests.find((item) => item.tier === 'weapon')!
    expect([local(1, weapon.x, weapon.y), weapon.weapon]).toEqual([[2, 1], 'smg'])
    for (let column = 1; column <= 24; column++) expect(tile(1, column, 3), `alley wall ${column}`).toBe(Tile.Landmark)
    expect(tile(1, 25, 3)).toBe(Tile.Floor)
    for (const [column, row] of [
      [15, 11],
      [23, 11],
      [15, 16],
      [23, 16],
    ]) {
      for (const [dc, dr] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]) expect(tile(1, column + dc, row + dr)).toBe(Tile.Landmark)
    }
  })

  it('runs the belts of the sorting hall into the airship, whose hold is walkable', () => {
    const belts = new Map(level.conveyors.map((belt) => [belt.index, belt]))
    const push = (column: number, row: number) => {
      const belt = belts.get((level.areas[2].top + row) * columns + column)
      return belt ? [belt.dx, belt.dy] : null
    }
    for (let column = 3; column <= 32; column++) expect([push(column, 16), push(column, 17)]).toEqual([[1, 0], [1, 0]])
    for (let row = 13; row <= 17; row++) expect([push(33, row), push(34, row)]).toEqual([[0, -1], [0, -1]])
    for (let column = 5; column <= 28; column++) expect([push(column, 6), push(column, 7)]).toEqual([[-1, 0], [-1, 0]])
    const [ship] = placed('ch1-airship', 2)
    expect([ship.column, ship.row - level.areas[2].top, ship.width, ship.depth]).toEqual([31, 1, 6, 12])
    expect(tile(2, 33, 10)).toBe(Tile.Floor)
    expect(tile(2, 34, 10)).toBe(Tile.Floor)
    expect(tile(2, 32, 10)).toBe(Tile.Landmark)
    expect(placed('ch1-anchor-crate', 2)).toHaveLength(12)
    expect(new Set(placed('ch1-anchor-crate').map((crate) => crate.variant))).toEqual(new Set([1, 2, 3]))
    expect(level.clues).toEqual([{ id: 'anchor-crate', area: 2, at: { x: 10.5, y: level.areas[2].top + 14.5 } }])
    expect(placed('ch1-anchor-crate', 2).some((crate) => crate.column === 9 && crate.row - level.areas[2].top === 14)).toBe(true)
  })

  it('opens the factory gate onto the south door of the boss arena, with the supply point in front', () => {
    const [gate] = placed('ch1-factory-gate', 3)
    expect([gate.column, gate.row - level.areas[3].top]).toEqual([16, 0])
    expect([18, 19, 20, 21].map((column) => tile(3, column, 0))).toEqual([Tile.Floor, Tile.Floor, Tile.Floor, Tile.Floor])
    expect([16, 17, 22, 23].map((column) => tile(3, column, 0))).toEqual([Tile.Landmark, Tile.Landmark, Tile.Landmark, Tile.Landmark])
    expect([18, 19, 20, 21].map((column) => tile(4, column, 19))).toEqual([Tile.Gate, Tile.Gate, Tile.Gate, Tile.Gate])
    expect(level.supplies.map((supply) => [supply.area, ...local(3, supply.x, supply.y)])).toEqual([[3, 19, 5]])
    expect(placed('ch1-anchor-crate', 3)).toHaveLength(8)
  })

  it('reuses the boss trial arena inside two extra columns of wall on each side', () => {
    const trial = TRIAL_HARVESTER.areas.find((area) => area.kind === 'boss')!
    const arena = LEVEL_1_5.areas[4]
    expect(arena.rows.map((row) => `#${row.slice(3, -3)}#`)).toEqual(trial.rows)
    expect(arena.rows.every((row) => row.startsWith('###') && row.endsWith('###'))).toBe(true)
    expect(level.summonPoints).toHaveLength(4)
  })
})

describe('systems trial', () => {
  const level = buildLevel(TRIAL_SYSTEMS)

  it('passes validation', () => {
    expect(validateLevel(level)).toEqual([])
  })

  it('mixes in shield bearers, throwers, elites and patrols', () => {
    expect(level.enemies.filter((enemy) => enemy.kind === 'shield' && enemy.area === 2)).toHaveLength(2)
    expect(level.enemies.filter((enemy) => enemy.kind === 'thrower' && enemy.area === 4)).toHaveLength(2)
    expect(level.enemies.filter((enemy) => enemy.affixes.length > 0)).toHaveLength(3)
    expect(level.enemies.filter((enemy) => enemy.route.length > 1)).toHaveLength(2)
    expect(level.enemies.filter((enemy) => enemy.area === 2).every((enemy) => enemy.idle === 'wander')).toBe(true)
  })
})

describe('chapter boss trial', () => {
  const level = buildLevel(TRIAL_HARVESTER)

  it('is a valid arena with rocks, conveyors and summon points', () => {
    expect(validateLevel(level)).toEqual([])
    expect(level.boss?.id).toBe('harvester')
    expect(level.conveyors.length).toBeGreaterThan(20)
    expect(level.summonPoints).toHaveLength(4)
  })
})

describe('training ground', () => {
  it('is valid', () => {
    expect(validateLevel(buildLevel(TRAINING))).toEqual([])
  })
})
