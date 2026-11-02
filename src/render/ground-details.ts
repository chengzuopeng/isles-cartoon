import * as THREE from 'three'
import type { Theme } from '../data/levels/types'
import { Tile, tileAt, type Grid } from '../sim/grid'
import { cellHash } from './scene-models'

export const GROUND_DETAIL = {
  flower: { chance: 0.2, extra: 0.4, height: [0.3, 0.46] as const, spread: 0.95, head: 0.2, colors: ['#fff4dc', '#ffd84a', '#ff9ec7', '#a9d4ff', '#ffb36b'] as const },
  pebble: { chance: 0.32, extra: 0.45, size: [0.05, 0.12] as const, colors: ['#b9ad95', '#a39783', '#cfc4ab', '#8f8576'] as const },
  spike: { perMeter: 3, radius: 0.15, height: 0.42, inset: 0.16, jitter: 0.25 },
} as const

export const FLOWER_THEMES: ReadonlySet<Theme> = new Set(['farm', 'meadow', 'forest'])
export const SPIKE_THEMES: ReadonlySet<Theme> = new Set(['farm', 'village', 'arena'])

export interface DetailBatch {
  matrices: THREE.Matrix4[]
  colors: THREE.Color[]
}

type Ground = (x: number, z: number) => number

function batchOf(batches: Map<number, DetailBatch>, band: number): DetailBatch {
  let batch = batches.get(band)
  if (!batch) {
    batch = { matrices: [], colors: [] }
    batches.set(band, batch)
  }
  return batch
}

function pick<T>(list: readonly T[], roll: number): T {
  return list[Math.min(list.length - 1, Math.floor(roll * list.length))]
}

export function flowerStemGeometry(): THREE.BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  const base = new THREE.Color('#3f7a35')
  const top = new THREE.Color('#7fb850')
  const width = 0.06
  for (const angle of [0, Math.PI / 2]) {
    const dx = (Math.cos(angle) * width) / 2
    const dz = (Math.sin(angle) * width) / 2
    positions.push(-dx, 0, -dz, dx, 0, dz, dx * 0.4, 1, dz * 0.4, -dx, 0, -dz, dx * 0.4, 1, dz * 0.4, -dx * 0.4, 1, -dz * 0.4)
    colors.push(base.r, base.g, base.b, base.r, base.g, base.b, top.r, top.g, top.b, base.r, base.g, base.b, top.r, top.g, top.b, top.r, top.g, top.b)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
}

export function flowerHeadGeometry(): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(GROUND_DETAIL.flower.head, 0).translate(0, 1, 0)
}

export function pebbleGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 0)
  geometry.scale(1, 0.55, 0.85)
  geometry.translate(0, 0.25, 0)
  return geometry
}

export function spikeGeometry(): THREE.BufferGeometry {
  return new THREE.ConeGeometry(1, 1, 5).translate(0, 0.5, 0)
}

export function flowerBatches(grid: Grid, themeOf: (row: number) => Theme, ground: Ground, bandOf: (row: number) => number, skip: (column: number, row: number) => boolean): Map<number, DetailBatch> {
  const batches = new Map<number, DetailBatch>()
  const { flower } = GROUND_DETAIL
  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  for (let row = 0; row < grid.rows; row++) {
    if (!FLOWER_THEMES.has(themeOf(row))) continue
    for (let column = 0; column < grid.columns; column++) {
      if (tileAt(grid, column, row) !== Tile.Floor || skip(column, row)) continue
      if (cellHash(column, row, 501) >= flower.chance) continue
      const count = cellHash(column, row, 502) < flower.extra ? 2 : 1
      const color = new THREE.Color(pick(flower.colors, cellHash(column, row, 503)))
      for (let k = 0; k < count; k++) {
        const x = column + 0.15 + cellHash(column, row, 510 + k) * 0.7
        const z = row + 0.15 + cellHash(column, row, 520 + k) * 0.7
        const height = flower.height[0] + cellHash(column, row, 530 + k) * (flower.height[1] - flower.height[0])
        position.set(x, ground(x, z) - 0.01, z)
        rotation.setFromAxisAngle(up, cellHash(column, row, 540 + k) * Math.PI * 2)
        scale.set(height * flower.spread, height, height * flower.spread)
        const batch = batchOf(batches, bandOf(row))
        batch.matrices.push(matrix.compose(position, rotation, scale).clone())
        batch.colors.push(color)
      }
    }
  }
  return batches
}

export function pebbleBatches(grid: Grid, ground: Ground, bandOf: (row: number) => number): Map<number, DetailBatch> {
  const batches = new Map<number, DetailBatch>()
  const { pebble } = GROUND_DETAIL
  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  const euler = new THREE.Euler()
  for (let row = 0; row < grid.rows; row++) {
    for (let column = 0; column < grid.columns; column++) {
      if (tileAt(grid, column, row) !== Tile.Path) continue
      if (cellHash(column, row, 601) >= pebble.chance) continue
      const count = 1 + (cellHash(column, row, 602) < pebble.extra ? 2 : 0)
      for (let k = 0; k < count; k++) {
        const x = column + 0.1 + cellHash(column, row, 610 + k) * 0.8
        const z = row + 0.1 + cellHash(column, row, 620 + k) * 0.8
        const size = pebble.size[0] + cellHash(column, row, 630 + k) * (pebble.size[1] - pebble.size[0])
        position.set(x, ground(x, z) - size * 0.2, z)
        euler.set(0, cellHash(column, row, 640 + k) * Math.PI * 2, (cellHash(column, row, 650 + k) - 0.5) * 0.4)
        rotation.setFromEuler(euler)
        scale.setScalar(size)
        const batch = batchOf(batches, bandOf(row))
        batch.matrices.push(matrix.compose(position, rotation, scale).clone())
        batch.colors.push(new THREE.Color(pick(pebble.colors, cellHash(column, row, 660 + k))))
      }
    }
  }
  return batches
}

export interface WallEdge {
  x1: number
  z1: number
  x2: number
  z2: number
  inX: number
  inZ: number
  top: number
  theme: Theme
  color: string
  row: number
  seed: number
}

export function spikeBatches(edges: readonly WallEdge[], bandOf: (row: number) => number): Map<number, DetailBatch> {
  const batches = new Map<number, DetailBatch>()
  const { spike } = GROUND_DETAIL
  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  for (const edge of edges) {
    if (!SPIKE_THEMES.has(edge.theme)) continue
    const length = Math.hypot(edge.x2 - edge.x1, edge.z2 - edge.z1)
    const count = Math.max(1, Math.round(length * spike.perMeter))
    for (let k = 0; k < count; k++) {
      const t = (k + 0.5) / count
      const x = edge.x1 + (edge.x2 - edge.x1) * t + edge.inX * spike.inset
      const z = edge.z1 + (edge.z2 - edge.z1) * t + edge.inZ * spike.inset
      const height = spike.height * (1 + (cellHash(edge.seed, k, 701) - 0.5) * spike.jitter * 2)
      position.set(x, edge.top - 0.02, z)
      rotation.identity()
      scale.set(spike.radius, height, spike.radius)
      const batch = batchOf(batches, bandOf(edge.row))
      batch.matrices.push(matrix.compose(position, rotation, scale).clone())
      batch.colors.push(new THREE.Color(edge.color))
    }
  }
  return batches
}
