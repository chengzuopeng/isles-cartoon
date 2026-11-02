import { describe, expect, it } from 'vitest'
import { Tile, type Grid } from '../sim/grid'
import type { BuiltLevel } from '../sim/level'
import { VISUAL_HEIGHTS, buildGround, buildWalls, isBorder, surfaceHeight } from './fps-level-view'

function grid(rows: string[], floors?: number[][]): Grid {
  const tiles: Record<string, Tile> = { '.': Tile.Floor, '#': Tile.Wall, '~': Tile.Water }
  const columns = rows[0].length
  const result: Grid = {
    columns,
    rows: rows.length,
    tiles: new Uint8Array(columns * rows.length),
    floor: new Float32Array(columns * rows.length),
    top: new Float32Array(columns * rows.length),
  }
  rows.forEach((line, row) => {
    for (let column = 0; column < columns; column++) {
      const index = row * columns + column
      result.tiles[index] = tiles[line.charAt(column)]
      result.floor[index] = floors?.[row]?.[column] ?? 0
    }
  })
  return result
}

function level(target: Grid): BuiltLevel {
  return {
    grid: target,
    areas: [{ index: 0, name: 'test', theme: 'farm', kind: 'normal', fog: false, top: 0, bottom: target.rows - 1, gates: [] }],
    areaOfRow: new Int16Array(target.rows),
  } as unknown as BuiltLevel
}

function quads(vertices: number): number {
  return vertices / 6
}

describe('fps level view', () => {
  it('marks the outer ring as border', () => {
    const target = grid(['...', '...', '...'])
    expect(isBorder(target, 0, 1)).toBe(true)
    expect(isBorder(target, 1, 1)).toBe(false)
    expect(isBorder(target, 2, 2)).toBe(true)
  })

  it('drops water below the floor and the outside below the cliff', () => {
    const target = grid(['.~.'], [[1, 1, 1]])
    expect(surfaceHeight(target, 0, 0)).toBe(1)
    expect(surfaceHeight(target, 1, 0)).toBeCloseTo(1 - VISUAL_HEIGHTS.waterDrop)
    expect(surfaceHeight(target, -1, 0)).toBe(-VISUAL_HEIGHTS.cliff)
  })

  it('builds one top per cell and cliff sides only along the island edge on flat ground', () => {
    const { ground, water } = buildGround(level(grid(['...', '...', '...'])))
    expect(quads(ground.getAttribute('position').count)).toBe(9 + 12)
    expect(water.getAttribute('position').count).toBe(0)
  })

  it('adds a single step face between cells of different height', () => {
    const { ground } = buildGround(level(grid(['..'], [[0, 0.5]])))
    const position = ground.getAttribute('position')
    const normal = ground.getAttribute('normal')
    expect(quads(position.count)).toBe(2 + 6 + 1)
    let stepVertices = 0
    for (let i = 0; i < position.count; i++) {
      if (position.getX(i) === 1 && normal.getX(i) === -1) {
        stepVertices += 1
        expect(position.getY(i)).toBeGreaterThanOrEqual(0)
        expect(position.getY(i)).toBeLessThanOrEqual(0.5)
      }
    }
    expect(stepVertices).toBe(6)
  })

  it('puts river cells into the water mesh and lines the banks', () => {
    const { ground, water } = buildGround(level(grid(['.~.'])))
    expect(quads(water.getAttribute('position').count)).toBe(1)
    const position = ground.getAttribute('position')
    let bankTop = 0
    for (let i = 0; i < position.count; i++) if (Math.abs(position.getY(i) + VISUAL_HEIGHTS.waterDrop) < 1e-6) bankTop += 1
    expect(bankTop).toBeGreaterThan(0)
  })

  it('raises inner walls to full height and leaves border walls to the fence', () => {
    const walls = buildWalls(level(grid(['#####', '#.#.#', '#####'])))
    const geometry = walls.get('farm')
    expect(geometry).toBeDefined()
    const position = geometry!.getAttribute('position')
    expect(quads(position.count)).toBe(5)
    let highest = -Infinity
    for (let i = 0; i < position.count; i++) highest = Math.max(highest, position.getY(i))
    expect(highest).toBe(VISUAL_HEIGHTS.wall)
  })

  it('skips the shared face between two neighbouring inner walls', () => {
    const walls = buildWalls(level(grid(['####', '#..#', '#..#', '####'])))
    expect(walls.size).toBe(0)
    const pair = buildWalls(level(grid(['.....', '.##..', '.....'])))
    expect(quads(pair.get('farm')!.getAttribute('position').count)).toBe(2 + 6)
  })
})
