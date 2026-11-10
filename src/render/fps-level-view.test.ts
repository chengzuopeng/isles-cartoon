import { describe, expect, it } from 'vitest'
import { Tile, type Grid } from '../sim/grid'
import type { BuiltLevel } from '../sim/level'
import { VISUAL_HEIGHTS, buildWalls, isBorder, tuftGeometry } from './fps-level-view'

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

  it('raises inner walls to full height and leaves border walls to the fence', () => {
    const walls = buildWalls(level(grid(['#####', '#.#.#', '#####'])))
    const geometry = walls.get('farm')
    expect(geometry).toBeDefined()
    const position = geometry!.getAttribute('position')
    expect(quads(position.count)).toBe(5)
    let highest = -Infinity
    let lowest = Infinity
    for (let i = 0; i < position.count; i++) {
      highest = Math.max(highest, position.getY(i))
      lowest = Math.min(lowest, position.getY(i))
    }
    expect(highest).toBe(VISUAL_HEIGHTS.wall)
    expect(lowest).toBeCloseTo(-VISUAL_HEIGHTS.wallSink)
  })

  it('skips the shared face between two neighbouring inner walls', () => {
    const walls = buildWalls(level(grid(['####', '#..#', '#..#', '####'])))
    expect(walls.size).toBe(0)
    const pair = buildWalls(level(grid(['.....', '.##..', '.....'])))
    expect(quads(pair.get('farm')!.getAttribute('position').count)).toBe(2 + 6)
  })
})

describe('grass tufts', () => {
  it('light every blade like the ground so none turn into dark spikes', () => {
    const normals = tuftGeometry().getAttribute('normal')
    for (let i = 0; i < normals.count; i++) {
      expect(normals.getX(i)).toBe(0)
      expect(normals.getY(i)).toBe(1)
      expect(normals.getZ(i)).toBe(0)
    }
  })

  it('draws each blade from both sides without a double-sided material', () => {
    const geometry = tuftGeometry()
    const positions = geometry.getAttribute('position')
    expect(positions.count % 6).toBe(0)
    for (let blade = 0; blade < positions.count; blade += 6) {
      expect(positions.getX(blade)).toBeCloseTo(positions.getX(blade + 4), 6)
      expect(positions.getZ(blade)).toBeCloseTo(positions.getZ(blade + 4), 6)
      expect(positions.getY(blade + 2)).toBeCloseTo(positions.getY(blade + 5), 6)
    }
  })
})
