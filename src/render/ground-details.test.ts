import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { Theme } from '../data/levels/types'
import { Tile, parseRows, tileAt } from '../sim/grid'
import { GROUND_DETAIL, flowerBatches, hedgeTopBatches, pebbleBatches, spikeBatches, type DetailBatch, type WallEdge } from './ground-details'

const ROWS = Array.from({ length: 40 }, (_, row) => (row % 2 === 0 ? '.'.repeat(30) : ','.repeat(30)))
const FLAT = () => 0

function all(batches: Map<number, DetailBatch>): THREE.Matrix4[] {
  return [...batches.values()].flatMap((batch) => batch.matrices)
}

function cellOf(matrix: THREE.Matrix4): [number, number] {
  const position = new THREE.Vector3().setFromMatrixPosition(matrix)
  return [Math.floor(position.x), Math.floor(position.z)]
}

describe('ground details', () => {
  const { grid } = parseRows(ROWS)

  it('grows flowers only on plain floor in the grassy themes, the same way every time', () => {
    const themeOf = (row: number): Theme => (row < 20 ? 'meadow' : 'village')
    const first = all(flowerBatches(grid, themeOf, FLAT, (row) => Math.floor(row / 20), () => false))
    const second = all(flowerBatches(grid, themeOf, FLAT, (row) => Math.floor(row / 20), () => false))
    expect(first.length).toBeGreaterThan(10)
    expect(first.map((m) => m.elements.join())).toEqual(second.map((m) => m.elements.join()))
    for (const matrix of first) {
      const [column, row] = cellOf(matrix)
      expect(tileAt(grid, column, row)).toBe(Tile.Floor)
      expect(row).toBeLessThan(20)
    }
  })

  it('keeps a colour for every flower and skips the cells it is told to', () => {
    const batches = flowerBatches(grid, () => 'farm', FLAT, () => 0, (column) => column < 15)
    for (const batch of batches.values()) expect(batch.colors).toHaveLength(batch.matrices.length)
    for (const matrix of all(batches)) expect(cellOf(matrix)[0]).toBeGreaterThanOrEqual(15)
  })

  it('scatters pebbles only on paths, sorted into culling bands', () => {
    const batches = pebbleBatches(grid, FLAT, (row) => Math.floor(row / 10))
    expect(all(batches).length).toBeGreaterThan(10)
    for (const [band, batch] of batches) {
      for (const matrix of batch.matrices) {
        const [column, row] = cellOf(matrix)
        expect(tileAt(grid, column, row)).toBe(Tile.Path)
        expect(Math.floor(row / 10)).toBe(band)
      }
    }
  })

  it('lines the top of wooden walls with tips and leaves the other walls plain', () => {
    const edge = (theme: Theme): WallEdge => ({ x1: 0, z1: 0, x2: 2, z2: 0, inX: 0, inZ: 1, top: 3, theme, style: null, color: '#b48a5e', row: 0, seed: 1 })
    const wooden = all(spikeBatches([edge('farm')], () => 0))
    expect(wooden).toHaveLength(2 * GROUND_DETAIL.spike.perMeter)
    const tip = new THREE.Vector3().setFromMatrixPosition(wooden[0])
    expect(tip.y).toBeCloseTo(3 - 0.02)
    expect(tip.z).toBeCloseTo(GROUND_DETAIL.spike.inset)
    expect(all(spikeBatches([edge('meadow')], () => 0))).toHaveLength(0)
  })

  it('crowns hedges with leafy clumps instead of wooden tips', () => {
    const hedge: WallEdge = { x1: 0, z1: 0, x2: 3, z2: 0, inX: 0, inZ: 1, top: 3, theme: 'farm', style: 'hedge', color: '#b48a5e', row: 0, seed: 7 }
    expect(all(spikeBatches([hedge], () => 0))).toHaveLength(0)
    const clumps = all(hedgeTopBatches([hedge], () => 0))
    expect(clumps).toHaveLength(Math.round(3 * GROUND_DETAIL.hedge.perMeter))
    for (const clump of clumps) {
      const at = new THREE.Vector3().setFromMatrixPosition(clump)
      expect(at.y).toBeCloseTo(3 - GROUND_DETAIL.hedge.sink)
      expect(at.z).toBeCloseTo(GROUND_DETAIL.hedge.inset)
      expect(at.x).toBeGreaterThan(0)
      expect(at.x).toBeLessThan(3)
    }
    expect(all(hedgeTopBatches([{ ...hedge, style: null }], () => 0))).toHaveLength(0)
  })

  it('leaves out pebbles on paths nobody can see', () => {
    const everywhere = all(pebbleBatches(grid, FLAT, () => 0))
    const half = all(pebbleBatches(grid, FLAT, () => 0, (column) => column < 15))
    expect(half.length).toBeGreaterThan(0)
    expect(half.length).toBeLessThan(everywhere.length)
    for (const matrix of half) expect(cellOf(matrix)[0]).toBeGreaterThanOrEqual(15)
  })
})
