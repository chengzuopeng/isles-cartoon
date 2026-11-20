import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { LEVEL_1_1 } from '../data/levels/level-1-1'
import { LEVEL_1_2 } from '../data/levels/level-1-2'
import { Tile, type Grid } from '../sim/grid'
import { buildLevel, type BuiltLevel } from '../sim/level'
import { TERRAIN, buildTerrain, platformSurfaceOf, rawHeight, rimEdge, surfaceHeight } from './fps-terrain'
import { buildLevelPlatforms, framedPlatformCells } from './level-platforms'

vi.mock('./line-textures', () => ({ lineTexture: () => new THREE.Texture() }))

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

it('places the loading platform materials on the authored height-map footprints', () => {
  const level = buildLevel(LEVEL_1_2)
  const field = level.areas[2]
  expect(platformSurfaceOf(level, 20, field.top + 42)).toBe('wood')
  expect(platformSurfaceOf(level, 19, field.top + 42)).toBeUndefined()
  expect(platformSurfaceOf(level, 46, field.top + 24)).toBe('straw')
  expect(platformSurfaceOf(level, 13, field.top + 6)).toBe('wood')
})

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

  it('renders framed decks at standing height and joins the feed deck to its north ramp', () => {
    const level = buildLevel(LEVEL_1_2)
    const framed = framedPlatformCells(level)
    const terrain = buildTerrain(level, framed)
    const structures = buildLevelPlatforms(level, framed)
    const deck = structures.find(({ near }) => near === level.areas[2].top)!.group
    const feed = structures.find(({ near }) => near === level.areas[1].top)!.group
    const material = new THREE.MeshBasicMaterial()
    const base = new THREE.Mesh(terrain.geometry, material)
    const surface = (mesh: THREE.Object3D, x: number, z: number) =>
      new THREE.Raycaster(new THREE.Vector3(x, 8, z), new THREE.Vector3(0, -1, 0)).intersectObject(mesh)[0]?.point.y
    const south = level.areas[2].top + 42.5
    expect(surface(deck, 38.4, south)).toBeCloseTo(2)
    expect(surface(deck, 35.4, south)).toBeCloseTo(3)
    expect(surface(base, 35.4, south)).toBeCloseTo(1)
    expect(terrain.heightAt(35.4, south)).toBeCloseTo(3)
    const join = level.areas[1].top + 33
    expect(surface(feed, 27.4, join - 0.01)).toBeCloseTo(3, 1)
    expect(surface(feed, 27.4, join + 0.01)).toBeCloseTo(3)
    expect(terrain.heightAt(27.4, join - 0.2)).toBeCloseTo(surface(feed, 27.4, join - 0.2)!)
    structures.forEach((structure) => structure.dispose())
    terrain.geometry.dispose()
    terrain.water.dispose()
    terrain.underside.dispose()
    material.dispose()
  })

  it('joins the 1-1 threshing deck to its two walk-up ramps and draws the upper stone terrace level', () => {
    const level = buildLevel(LEVEL_1_1)
    const framed = framedPlatformCells(level)
    const terrain = buildTerrain(level, framed)
    const structures = buildLevelPlatforms(level, framed)
    const yard = structures.find(({ near }) => near === level.areas[2].top)!.group
    const bank = structures.find(({ near }) => near === level.areas[1].top)!.group
    const surface = (mesh: THREE.Object3D, x: number, z: number) =>
      new THREE.Raycaster(new THREE.Vector3(x, 8, z), new THREE.Vector3(0, -1, 0)).intersectObject(mesh)[0]?.point.y
    const row = level.areas[2].top + 32.5
    for (const [x, height] of [[29.05, 2.05], [29.95, 2.95], [30.05, 3], [47.95, 3], [48.05, 2.975], [49.95, 2.025]]) {
      expect(surface(yard, x, row)).toBeCloseTo(height)
      expect(terrain.heightAt(x, row)).toBeCloseTo(height)
    }
    const terraceRow = level.areas[1].top + 33.2
    expect(platformSurfaceOf(level, 53, Math.floor(terraceRow))).toBe('stone')
    expect(surface(bank, 53.4, terraceRow)).toBeCloseTo(2.5)
    structures.forEach((structure) => structure.dispose())
    terrain.geometry.dispose()
    terrain.water.dispose()
    terrain.underside.dispose()
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
