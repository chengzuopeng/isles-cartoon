import { describe, expect, it } from 'vitest'
import { LANDMARKS } from '../data/landmarks'
import type { AreaDef, LandmarkPlacementDef } from '../data/levels/types'
import { Tile, blocksBullets, blocksMovement, tileAt } from './grid'
import { facingOut, footprintOf, landmarkTile, occupiedOffsets, poolOffsets, rotateCell, rotateFootprint, wetOffsets } from './landmarks'
import { validateLevel } from './level'
import { levelFromAreas } from './testing'

const ROOM = ['##########', '#.......X#', '#........#', '#........#', '#........#', '#...P....#', '##########']

function room(landmarks: LandmarkPlacementDef[], rows: string[] = ROOM): AreaDef {
  return { name: 'room', theme: 'village', rows, landmarks }
}

describe('landmark footprints', () => {
  it('turns clockwise as seen on the map, so the west edge goes north', () => {
    expect(rotateFootprint(['AB'], 90)).toEqual(['A', 'B'])
    expect(rotateFootprint(['AB', 'CD', 'EF'], 90)).toEqual(['ECA', 'FDB'])
    expect(rotateFootprint(['AB', 'CD', 'EF'], 180)).toEqual(['FE', 'DC', 'BA'])
    expect(rotateFootprint(['AB', 'CD', 'EF'], 270)).toEqual(['BDF', 'ACE'])
  })

  it('comes back to the start after four quarter turns', () => {
    const mask = footprintOf(LANDMARKS['ch1-barn'])
    expect(rotateFootprint(rotateFootprint(mask, 180), 180)).toEqual(mask)
    expect(rotateFootprint(rotateFootprint(mask, 90), 270)).toEqual(mask)
  })

  it('moves the open front of the cabin from south to east at 270 degrees', () => {
    const mask = footprintOf(LANDMARKS['ch1-cabin'])
    expect(mask).toEqual(['###', '#.#', '#.#'])
    expect(rotateFootprint(mask, 90)).toEqual(['###', '..#', '###'])
    expect(rotateFootprint(mask, 270)).toEqual(['###', '#..', '###'])
  })

  it('turns a gate cell together with the footprint and points it out of the front', () => {
    const pen = LANDMARKS['ch1-sheep-pen']
    expect(pen.gate).toEqual([1, 2])
    expect(rotateCell([1, 2], pen.size, 0)).toEqual([1, 2])
    expect(rotateCell([1, 2], pen.size, 90)).toEqual([0, 1])
    expect(rotateCell([1, 2], pen.size, 180)).toEqual([1, 0])
    expect(rotateCell([1, 2], pen.size, 270)).toEqual([2, 1])
    expect(rotateCell([0, 0], [3, 2], 90)).toEqual([1, 0])
    expect(facingOut(0)).toEqual([0, 1])
    expect(facingOut(90)).toEqual([-1, 0])
    expect(facingOut(180)).toEqual([0, -1])
    expect(facingOut(270)).toEqual([1, 0])
  })

  it('counts wet cells as occupied and keeps the watermill wheel on the south side when turned to 90', () => {
    const mask = rotateFootprint(footprintOf(LANDMARKS['ch1-watermill']), 90)
    expect(mask).toHaveLength(7)
    expect(mask[6]).toBe('.~~~~')
    expect(wetOffsets(mask)).toEqual([
      [1, 6],
      [2, 6],
      [3, 6],
      [4, 6],
    ])
    expect(occupiedOffsets(['#~.'])).toEqual([
      [0, 0],
      [1, 0],
    ])
  })

  it('fills the whole size when a landmark has no mask', () => {
    expect(footprintOf(LANDMARKS['ch1-hay-cart'])).toEqual(['##', '##', '##'])
    expect(occupiedOffsets(['#.', '.#'])).toEqual([
      [0, 0],
      [1, 1],
    ])
  })

  it('stamps solid, low, hiding and decorative landmarks differently', () => {
    expect(landmarkTile(LANDMARKS['ch1-windmill'])).toBe(Tile.Landmark)
    expect(landmarkTile(LANDMARKS['ch1-sheep-pen'])).toBe(Tile.LandmarkLow)
    expect(landmarkTile(LANDMARKS['ch1-wheat-stack'])).toBe(Tile.Bush)
    expect(landmarkTile(LANDMARKS['ch1-wheat-ears'])).toBeNull()
    expect(() => landmarkTile({ name: 'x', level: '1-1', size: [1, 1], blocksMovement: false, blocksShots: true, height: 1 })).toThrow()
    expect(() =>
      landmarkTile({ name: 'x', level: '1-1', size: [1, 1], blocksMovement: true, blocksShots: false, hides: true, height: 1 }),
    ).toThrow()
  })
})

describe('building landmarks into the grid', () => {
  it('turns the footprint into tiles from the top-left corner after rotating it', () => {
    const level = levelFromAreas([room([{ id: 'ch1-hay-cart', at: [1, 1], facing: 90 }])])
    const [cart] = level.landmarks
    expect(cart).toMatchObject({ column: 1, row: 1, width: 3, depth: 2, facing: 90, variant: 1 })
    for (let row = 1; row <= 2; row++) {
      for (let column = 1; column <= 3; column++) expect(tileAt(level.grid, column, row)).toBe(Tile.Landmark)
    }
    expect(tileAt(level.grid, 4, 1)).toBe(Tile.Floor)
    expect(tileAt(level.grid, 1, 3)).toBe(Tile.Floor)
    expect(validateLevel(level)).toEqual([])
  })

  it('leaves the open cells of a mask walkable and only blocks what the definition says', () => {
    const level = levelFromAreas([
      room([
        { id: 'ch1-sheep-pen', at: [1, 1] },
        { id: 'ch1-wheat-stack', at: [6, 1] },
        { id: 'ch1-wheat-ears', at: [6, 4] },
      ]),
    ])
    const pen = tileAt(level.grid, 1, 1)
    expect(blocksMovement(pen)).toBe(true)
    expect(blocksBullets(pen)).toBe(false)
    expect(tileAt(level.grid, 2, 2)).toBe(Tile.Floor)
    expect(tileAt(level.grid, 6, 1)).toBe(Tile.Bush)
    expect(tileAt(level.grid, 7, 1)).toBe(Tile.Floor)
    expect(tileAt(level.grid, 6, 4)).toBe(Tile.Floor)
    expect(level.landmarks[2].cells).toEqual([4 * 10 + 6])
  })

  it('records the gate cell of a pen, the water under a dock and the wet cells of the watermill', () => {
    const pens = levelFromAreas([room([{ id: 'ch1-sheep-pen', at: [2, 1], facing: 90 }])])
    expect(pens.landmarks[0].gate).toEqual({ index: 2 * 10 + 2, column: 2, row: 2, outX: -1, outY: 0 })
    const dock = levelFromAreas([room([{ id: 'ch1-dock', at: [1, 1], facing: 270 }])])
    expect(dock.landmarks[0].water).toEqual(dock.landmarks[0].cells)
    expect(dock.landmarks[0].water).toHaveLength(12)
    expect(tileAt(dock.grid, 1, 1)).toBe(Tile.Floor)
    const wet = [
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
    const mill = levelFromAreas([room([{ id: 'ch1-watermill', at: [1, 1], facing: 90 }], wet)])
    expect(mill.landmarks[0].water).toEqual([7 * 10 + 2, 7 * 10 + 3, 7 * 10 + 4, 7 * 10 + 5])
    expect(tileAt(mill.grid, 2, 7)).toBe(Tile.Landmark)
    expect(tileAt(mill.grid, 1, 7)).toBe(Tile.Floor)
    expect(validateLevel(mill)).toEqual([])
  })

  it('places landmarks in area coordinates, the same as patrol points', () => {
    const level = levelFromAreas([
      { name: 'start', theme: 'meadow', rows: ['#....#', '#.P..#', '######'] },
      { name: 'yard', theme: 'farm', rows: ['######', '#....#', '#....#'], landmarks: [{ id: 'ch1-well', at: [1, 1] }] },
    ])
    expect(level.landmarks[0]).toMatchObject({ area: 1, column: 1, row: 1 })
    expect(tileAt(level.grid, 2, 2)).toBe(Tile.Landmark)
  })
})

describe('validating landmarks', () => {
  const problemsFor = (landmarks: LandmarkPlacementDef[], rows: string[] = ROOM) => validateLevel(levelFromAreas([room(landmarks, rows)]))

  it('rejects landmarks on walls, water, other landmarks or outside their area', () => {
    expect(problemsFor([{ id: 'ch1-well', at: [0, 2] }])).toContain('landmark ch1-well at 0,2 overlaps wall at 0,2')
    expect(problemsFor([{ id: 'ch1-well', at: [1, 1] }, { id: 'ch1-stump', at: [2, 2] }])).toContain(
      'landmark ch1-stump at 2,2 overlaps landmark ch1-well at 2,2',
    )
    const twoAreas = levelFromAreas([
      { name: 'start', theme: 'meadow', rows: ['#....#', '#.P..#', '######'] },
      { name: 'yard', theme: 'farm', rows: ['######', '#....#', '#....#'], landmarks: [{ id: 'ch1-well', at: [1, 2] }] },
    ])
    expect(validateLevel(twoAreas)).toContain('landmark ch1-well at 1,2 reaches outside area "yard"')
    const wet = ['#######', '#.~~..#', '#.P...#', '#######']
    expect(problemsFor([{ id: 'ch1-well', at: [2, 1] }], wet)).toContain('landmark ch1-well at 2,1 overlaps water at 2,1')
  })

  it('rejects landmarks on enemies, chests, supply points, gates, exits and the start', () => {
    const rows = ['##########', '#.m.$.+..#', '#........#', '#.X.D..R.#', '#...P....#', '##########']
    const problems = problemsFor(
      [
        { id: 'ch1-well', at: [1, 1] },
        { id: 'ch1-well', at: [4, 1] },
        { id: 'ch1-stump', at: [2, 3] },
        { id: 'ch1-stump', at: [4, 3] },
        { id: 'ch1-anchor-crate', at: [7, 3] },
        { id: 'ch1-stump', at: [4, 4] },
      ],
      rows,
    )
    expect(problems).toEqual(
      expect.arrayContaining([
        'landmark ch1-well at 1,1 overlaps grunt at 2,1',
        'landmark ch1-well at 4,1 overlaps normal chest at 4,1',
        'landmark ch1-stump at 2,3 overlaps exit at 2,3',
        'landmark ch1-stump at 4,3 overlaps gate at 4,3',
        'landmark ch1-anchor-crate at 7,3 overlaps rare chest at 7,3',
        'landmark ch1-stump at 4,4 overlaps player start at 4,4',
      ]),
    )
    expect(problemsFor([{ id: 'ch1-stump', at: [6, 1] }], rows)).toContain('landmark ch1-stump at 6,1 overlaps supply point at 6,1')
  })

  it('only lets wet cells sit on water, and only decks carry markers', () => {
    const dry = ['##########', '#.......X#', '#........#', '#........#', '#........#', '#........#', '#........#', '#........#', '#...P....#', '##########']
    expect(problemsFor([{ id: 'ch1-watermill', at: [1, 1], facing: 90 }], dry)).toContain('landmark ch1-watermill at 1,1 needs water at 2,7')
    const flooded = ['#######', '#..~~X#', '#..~~.#', '#..P..#', '#######']
    expect(problemsFor([{ id: 'ch1-well', at: [3, 1] }], flooded)).toContain('landmark ch1-well at 3,1 overlaps water at 3,1')
    const pier = ['##########', '#......X.#', '#.W......#', '#........#', '#........#', '#...P....#', '##########']
    expect(problemsFor([{ id: 'ch1-dock', at: [1, 1], facing: 270 }], pier)).toEqual([])
    expect(problemsFor([{ id: 'ch1-well', at: [1, 1] }], pier)).toContain('landmark ch1-well at 1,1 overlaps weapon chest at 2,2')
  })

  it('rejects a variant the landmark does not have', () => {
    expect(problemsFor([{ id: 'ch1-wheat-ears', at: [1, 1], variant: 3 }])).toEqual([])
    expect(problemsFor([{ id: 'ch1-wheat-ears', at: [1, 1], variant: 4 }])).toContain(
      'landmark ch1-wheat-ears at 1,1 asks for variant 4, it has 3',
    )
    expect(problemsFor([{ id: 'ch1-well', at: [1, 1], variant: 2 }])).toContain('landmark ch1-well at 1,1 asks for variant 2, it has 1')
  })

  it('checks that the exit and every enemy can still be reached', () => {
    const corridor = ['#####', '#.X.#', '#...#', '#.P.#', '#####']
    expect(problemsFor([{ id: 'ch1-log', at: [1, 2], facing: 90 }], corridor)).toContain('exit is unreachable')
    expect(problemsFor([{ id: 'ch1-log', at: [1, 2] }], corridor)).toContain('landmark ch1-log at 1,2 overlaps wall at 1,4')
    expect(problemsFor([{ id: 'ch1-wheat-ears', at: [1, 2] }], corridor)).toEqual([])
    const penned = ['########', '#......#', '#..m...#', '#......#', '#......#', '#..P..X#', '########']
    expect(problemsFor([{ id: 'ch1-sheep-pen', at: [2, 1] }], penned)).toContain('grunt at 3,2 is unreachable')
  })
})

describe('a pool in front of a landmark', () => {
  const POND = ['##########', '#.......X#', '#........#', '#........#', '#........#', '#...P....#', '##########']

  it('lays the shallow row in front of the opening, turning with the landmark', () => {
    expect(poolOffsets(4, 2, 0, 1)).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
      [3, 2],
    ])
    expect(poolOffsets(2, 4, 90, 1)).toEqual([
      [-1, 0],
      [-1, 1],
      [-1, 2],
      [-1, 3],
    ])
    expect(poolOffsets(4, 2, 180, 1).map(([, row]) => row)).toEqual([-1, -1, -1, -1])
    expect(poolOffsets(2, 4, 270, 1).map(([column]) => column)).toEqual([2, 2, 2, 2])
    expect(poolOffsets(4, 2, 0, 0)).toEqual([])
  })

  it('keeps the pool walkable while the renderer draws water there', () => {
    const level = levelFromAreas([room([{ id: 'ch1-waterfall-cave', at: [2, 1] }], POND)])
    const [cave] = level.landmarks
    expect(cave.pool).toEqual([3 * 10 + 2, 3 * 10 + 3, 3 * 10 + 4, 3 * 10 + 5])
    expect(cave.water).toEqual(cave.pool)
    for (const index of cave.pool) expect(level.grid.tiles[index]).toBe(Tile.Floor)
    expect(tileAt(level.grid, 3, 2)).toBe(Tile.Floor)
    expect(tileAt(level.grid, 2, 2)).toBe(Tile.Landmark)
    expect(validateLevel(level)).toEqual([])
  })

  it('reports a pool over a wall, outside the area or under another landmark', () => {
    const walled = levelFromAreas([room([{ id: 'ch1-waterfall-cave', at: [2, 4] }], POND)])
    expect(validateLevel(walled)).toContain('landmark ch1-waterfall-cave at 2,4 has its pool on wall at 2,6')
    const edge = levelFromAreas([room([{ id: 'ch1-waterfall-cave', at: [2, 5] }], POND)])
    expect(validateLevel(edge)).toContain('landmark ch1-waterfall-cave at 2,5 has its pool outside area "room" at 2,7')
    const rocky = levelFromAreas([room([{ id: 'ch1-waterfall-cave', at: [2, 1] }], ['##########', '#.......X#', '#........#', '#..o.....#', '#........#', '#...P....#', '##########'])])
    expect(validateLevel(rocky)).toContain('landmark ch1-waterfall-cave at 2,1 has its pool on rock at 3,3')
    const crowded = levelFromAreas([room([{ id: 'ch1-waterfall-cave', at: [2, 1] }, { id: 'ch1-stump', at: [4, 3] }], POND)])
    expect(validateLevel(crowded)).toContain('landmark ch1-waterfall-cave at 2,1 has its pool under landmark ch1-stump at 4,3')
  })
})
