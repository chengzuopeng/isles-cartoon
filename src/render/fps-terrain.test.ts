import { describe, expect, it } from 'vitest'
import { Tile, type Grid } from '../sim/grid'
import type { BuiltLevel } from '../sim/level'
import { TERRAIN, buildTerrain, rawHeight, rimEdge, surfaceHeight } from './fps-terrain'

function grid(rows: string[], floors?: number[][]): Grid {
  const tiles: Record<string, Tile> = { '.': Tile.Floor, '#': Tile.Wall, '~': Tile.Water, ',': Tile.Path }
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

describe('fps terrain', () => {
  it('sinks water beds and drops the outside to the cliff depth', () => {
    const target = grid(['.~.'], [[1, 1, 1]])
    expect(surfaceHeight(target, 0, 0)).toBe(1)
    expect(surfaceHeight(target, 1, 0)).toBeCloseTo(1 - TERRAIN.waterBed)
    expect(surfaceHeight(target, -1, 0)).toBe(-TERRAIN.cliffDepth)
  })

  it('keeps a noisy grass rim around the island before the cliff falls away', () => {
    const target = grid(['...', '...', '...'], [[2, 2, 2], [2, 2, 2], [2, 2, 2]])
    expect(rawHeight(target, -0.5, 1.5)).toBe(2)
    expect(rawHeight(target, -TERRAIN.rimNear + 0.01, 1.5)).toBe(2)
    expect(rawHeight(target, -TERRAIN.rimFar - 3, 1.5)).toBeLessThan(2 - 20)
    for (let x = -10; x < 50; x += 3.7) {
      const rim = rimEdge(x, -4)
      expect(rim).toBeGreaterThanOrEqual(TERRAIN.rimNear)
      expect(rim).toBeLessThanOrEqual(TERRAIN.rimFar)
    }
  })

  it('stays flat on flat ground', () => {
    const terrain = buildTerrain(level(grid(['....', '....', '....'], [[1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1]])))
    for (const [x, z] of [[0.5, 0.5], [2, 1.5], [3.5, 2.5]]) expect(terrain.heightAt(x, z)).toBeCloseTo(1)
  })

  it('turns a step into a short ramp without moving cells more than the settle limit', () => {
    const target = grid(['....'], [[0, 0, 0.5, 0.5]])
    const terrain = buildTerrain(level(target))
    let previous = -Infinity
    for (let x = 0.2; x <= 3.8; x += 0.2) {
      const height = terrain.heightAt(x, 0.5)
      expect(height).toBeGreaterThanOrEqual(previous - 1e-6)
      previous = height
      const raw = target.floor[Math.floor(x)]
      expect(Math.abs(height - raw)).toBeLessThanOrEqual(TERRAIN.settle + 1e-6)
    }
    expect(terrain.heightAt(0.2, 0.5)).toBeCloseTo(0)
    expect(terrain.heightAt(3.8, 0.5)).toBeCloseTo(0.5)
  })

  it('lays water quads a little past the banks and keeps an underside below the island', () => {
    const terrain = buildTerrain(level(grid(['.~.'])))
    const water = terrain.water.getAttribute('position')
    expect(water.count).toBe(6)
    let minX = Infinity
    let maxX = -Infinity
    for (let i = 0; i < water.count; i++) {
      minX = Math.min(minX, water.getX(i))
      maxX = Math.max(maxX, water.getX(i))
      expect(water.getY(i)).toBeCloseTo(-TERRAIN.waterLevel)
    }
    expect(minX).toBeCloseTo(1 - TERRAIN.waterReach)
    expect(maxX).toBeCloseTo(2 + TERRAIN.waterReach)
    const underside = terrain.underside.getAttribute('position')
    let lowest = Infinity
    for (let i = 0; i < underside.count; i++) lowest = Math.min(lowest, underside.getY(i))
    expect(lowest).toBeLessThan(-60)
  })
})
