import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { terrainGeometry, terrainLookup, terrainMaterial, type GroundCell, type GroundKind } from './terrain'
import { TERRAIN } from './themes'

const f = Math.fround
const same = (a: THREE.Color, b: THREE.Color) => a.r === f(b.r) && a.g === f(b.g) && a.b === f(b.b)

function cellsOf(rows: string[]): { cells: GroundCell[]; columns: number } {
  const kinds: Record<string, GroundKind> = { '.': 'floor', '~': 'water', '#': 'open' }
  const cells = rows.flatMap((line, row) =>
    [...line].map((mark, column) => ({ kind: kinds[mark], color: new THREE.Color((column + 1) / 10, (row + 1) / 10, mark === '~' ? 1 : 0) })),
  )
  return { cells, columns: rows[0].length }
}

interface Quad {
  normal: THREE.Vector3
  min: THREE.Vector3
  max: THREE.Vector3
  color: THREE.Color
  slot: number
  first: number
}

function quadsOf(geometry: THREE.BufferGeometry): Quad[] {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const color = geometry.getAttribute('color')
  const lookup = geometry.getAttribute('uv1')
  const index = geometry.getIndex()
  const quads: Quad[] = []
  for (let corner = 0; corner < (index?.count ?? 0); corner += 6) {
    const vertex = index?.getX(corner) ?? 0
    const points = [0, 1, 2, 3].map((k) => new THREE.Vector3().fromBufferAttribute(position, vertex + k))
    quads.push({
      normal: new THREE.Vector3().fromBufferAttribute(normal, vertex),
      min: points.reduce((low, point) => low.min(point), points[0].clone()),
      max: points.reduce((high, point) => high.max(point), points[0].clone()),
      color: new THREE.Color().fromBufferAttribute(color, vertex),
      slot: Math.floor(lookup.getX(vertex) * 2),
      first: corner,
    })
  }
  return quads
}

describe('terrain', () => {
  it('winds every face so it shows the side its normal points to', () => {
    const { cells, columns } = cellsOf(['#....', '.~~..', '..~..'])
    const { geometry } = terrainGeometry(cells, columns, 3, new THREE.Color('#7a5a3c'))
    const position = geometry.getAttribute('position')
    const normal = geometry.getAttribute('normal')
    const index = geometry.getIndex() as THREE.BufferAttribute
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    for (let corner = 0; corner < index.count; corner += 3) {
      a.fromBufferAttribute(position, index.getX(corner))
      b.fromBufferAttribute(position, index.getX(corner + 1))
      c.fromBufferAttribute(position, index.getX(corner + 2))
      const facing = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize()
      expect(facing.dot(new THREE.Vector3().fromBufferAttribute(normal, index.getX(corner)))).toBeCloseTo(1, 6)
    }
  })

  it('keeps the tops, the sides next to lower ground and the island rim, and drops the faces nothing can see', () => {
    const { cells, columns } = cellsOf(['..', '.~'])
    const quads = quadsOf(terrainGeometry(cells, columns, 2, new THREE.Color('#7a5a3c')).geometry)
    const tops = quads.filter((quad) => quad.normal.y === 1)
    expect(tops).toHaveLength(4)
    expect(tops.filter((quad) => quad.max.y === f(TERRAIN.floor.top))).toHaveLength(3)
    const water = tops.find((quad) => quad.max.y === f(TERRAIN.water.top))
    expect(water?.slot).toBe(1)
    expect(water?.min.x).toBe(1)
    expect(water?.min.z).toBe(1)
    const banks = quads.filter((quad) => quad.normal.y === 0 && quad.max.y === f(TERRAIN.floor.top) && quad.min.y === f(TERRAIN.floor.bottom))
    const inner = banks.filter((quad) => (quad.normal.x === 1 && quad.min.x === 1) || (quad.normal.z === 1 && quad.min.z === 1))
    expect(inner).toHaveLength(2)
    expect(banks.length - inner.length).toBe(6)
    const waterSides = quads.filter((quad) => quad.normal.y === 0 && quad.max.y === f(TERRAIN.water.top))
    expect(waterSides).toHaveLength(2)
    const rim = quads.filter((quad) => quad.min.y === f(TERRAIN.island.bottom))
    expect(rim).toHaveLength(2 * 2 + 1)
    expect(quads.some((quad) => quad.normal.y === -1)).toBe(false)
    expect(rim.every((quad) => quad.slot === 0 && same(quad.color, new THREE.Color('#7a5a3c')))).toBe(true)
  })

  it('carries each cell colour and lays the island shelf under open cells', () => {
    const { cells, columns } = cellsOf(['#.', '.#'])
    const island = new THREE.Color('#7a5a3c')
    const quads = quadsOf(terrainGeometry(cells, columns, 2, island).geometry)
    const tops = quads.filter((quad) => quad.normal.y === 1)
    for (const quad of tops) {
      const cell = cells[quad.min.z * columns + quad.min.x]
      if (cell.kind === 'open') {
        expect(quad.max.y).toBe(f(TERRAIN.island.top))
        expect(same(quad.color, island)).toBe(true)
      } else expect(same(quad.color, cell.color)).toBe(true)
    }
  })

  it('stores the faces row by row so a row window is one draw range', () => {
    const rows = ['....', '.~~.', '#..#', '....', '~~~~']
    const { cells, columns } = cellsOf(rows)
    const { geometry, starts } = terrainGeometry(cells, columns, rows.length, new THREE.Color('#7a5a3c'))
    expect(starts).toHaveLength(rows.length + 1)
    expect(starts[0]).toBe(0)
    expect(starts[rows.length]).toBe(geometry.getIndex()?.count)
    for (const quad of quadsOf(geometry)) {
      const row = starts.findIndex((start, at) => quad.first >= start && quad.first < starts[at + 1])
      expect(quad.min.z).toBeGreaterThanOrEqual(row - 1e-6)
      expect(quad.max.z).toBeLessThanOrEqual(row + 1 + 1e-6)
    }
  })

  it('looks the floor and water roughness up exactly from a two-texel float table', () => {
    const lookup = terrainLookup()
    const data = lookup.image.data as Float32Array
    expect(lookup.type).toBe(THREE.FloatType)
    expect(lookup.channel).toBe(1)
    expect([data[1], data[2], data[5], data[6]]).toEqual([TERRAIN.roughness.ground, 0, TERRAIN.roughness.water, 0])
    const material = terrainMaterial(lookup)
    expect(material.vertexColors).toBe(true)
    expect(material.roughness).toBe(1)
    expect(material.metalness).toBe(1)
    expect(material.roughnessMap).toBe(lookup)
    expect(material.metalnessMap).toBe(lookup)
  })
})
