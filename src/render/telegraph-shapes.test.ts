import { describe, expect, it } from 'vitest'
import { Tile, type Grid } from '../sim/grid'
import { circleOutline, crashTarget, curtainPath, sectorOutline } from './entity-views'

function grid(rows: string[]): Grid {
  const tiles: Record<string, Tile> = { '.': Tile.Floor, '#': Tile.Wall, o: Tile.Rock, O: Tile.Boulder }
  const columns = rows[0].length
  const result: Grid = { columns, rows: rows.length, tiles: new Uint8Array(columns * rows.length), floor: new Float32Array(columns * rows.length), top: new Float32Array(columns * rows.length) }
  rows.forEach((line, row) => {
    for (let column = 0; column < columns; column++) result.tiles[row * columns + column] = tiles[line.charAt(column)]
  })
  return result
}

describe('upright telegraph shapes', () => {
  it('stands a curtain one unit tall on every edge of a closed outline', () => {
    const geometry = curtainPath(circleOutline(2, 12), true)
    const position = geometry.getAttribute('position')
    expect(position.count).toBe(12 * 6)
    const ys = new Set<number>()
    for (let i = 0; i < position.count; i++) {
      ys.add(position.getY(i))
      expect(Math.hypot(position.getX(i), position.getZ(i))).toBeCloseTo(2)
    }
    expect([...ys].sort()).toEqual([0, 1])
  })

  it('outlines a sector from its tip out to the arc and back', () => {
    const outline = sectorOutline(5, 60, 6)
    expect(outline[0]).toEqual([0, 0])
    expect(outline).toHaveLength(8)
    for (const [x, z] of outline.slice(1)) {
      expect(Math.hypot(x, z)).toBeCloseTo(5)
      expect(Math.abs(Math.atan2(-z, x))).toBeLessThanOrEqual(Math.PI / 6 + 1e-6)
    }
  })

  it('finds the rock a charge would crash into, and nothing past the charge reach', () => {
    const field = grid(['..........', '..........', '.......o..', '..........'])
    expect(crashTarget(field, 1.5, 2.5, 1, 0, 8, 0.9)).toEqual({ column: 7, row: 2, tile: Tile.Rock })
    expect(crashTarget(field, 1.5, 2.5, 1, 0, 3, 0.9)).toBeNull()
    expect(crashTarget(field, 1.5, 0.5, 1, 0, 8, 0.9)).toBeNull()
    expect(crashTarget(field, 1.5, 1.5, 1, 0, 8, 0.9)?.tile).toBe(Tile.Rock)
  })
})
