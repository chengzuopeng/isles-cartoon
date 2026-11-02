import * as THREE from 'three'
import { finish, type Steps } from './slices'
import { TERRAIN } from './themes'

export type GroundKind = 'floor' | 'water' | 'open'

export interface GroundCell {
  kind: GroundKind
  color: THREE.Color
}

export interface TerrainShape {
  geometry: THREE.BufferGeometry
  starts: Int32Array
}

const SLOTS = 2
const ROWS_PER_STEP = 24
const GROUND_SLOT = 0
const WATER_SLOT = 1

type Face = 'top' | 'east' | 'west' | 'south' | 'north'

const NORMALS: Readonly<Record<Face, readonly [number, number, number]>> = {
  top: [0, 1, 0],
  east: [1, 0, 0],
  west: [-1, 0, 0],
  south: [0, 0, 1],
  north: [0, 0, -1],
}

const SIDES: readonly { face: Face; dc: number; dr: number }[] = [
  { face: 'north', dc: 0, dr: -1 },
  { face: 'east', dc: 1, dr: 0 },
  { face: 'south', dc: 0, dr: 1 },
  { face: 'west', dc: -1, dr: 0 },
]

const CORNERS: Readonly<Record<Face, readonly (readonly [number, number, number])[]>> = {
  top: [
    [0, 1, 0],
    [0, 1, 1],
    [1, 1, 1],
    [1, 1, 0],
  ],
  east: [
    [1, 0, 1],
    [1, 0, 0],
    [1, 1, 0],
    [1, 1, 1],
  ],
  west: [
    [0, 0, 0],
    [0, 0, 1],
    [0, 1, 1],
    [0, 1, 0],
  ],
  south: [
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ],
  north: [
    [1, 0, 0],
    [0, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
  ],
}

const SPLITS: Readonly<Record<Face, readonly number[]>> = {
  top: [0, 1, 3, 1, 2, 3],
  east: [0, 1, 2, 0, 2, 3],
  west: [0, 1, 2, 0, 2, 3],
  south: [0, 1, 2, 0, 2, 3],
  north: [0, 1, 2, 0, 2, 3],
}

function sideShown(own: GroundKind, other: GroundKind | null): boolean {
  if (own === 'floor') return other !== 'floor'
  if (own === 'water') return other === null || other === 'open'
  return false
}

export function terrainGeometry(cells: readonly GroundCell[], columns: number, rows: number, island: THREE.Color): TerrainShape {
  return finish(terrainSteps(cells, columns, rows, island))
}

export function* terrainSteps(cells: readonly GroundCell[], columns: number, rows: number, island: THREE.Color): Steps<TerrainShape> {
  const kindAt = (column: number, row: number): GroundKind | null =>
    column < 0 || row < 0 || column >= columns || row >= rows ? null : cells[row * columns + column].kind
  let quads = rows * 2 + 1
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const own = cells[row * columns + column].kind
      quads += 1
      for (const side of SIDES) if (sideShown(own, kindAt(column + side.dc, row + side.dr))) quads += 1
    }
  }
  const positions = new Float32Array(quads * 12)
  const normals = new Float32Array(quads * 12)
  const colors = new Float32Array(quads * 12)
  const lookups = new Float32Array(quads * 8)
  const indices = quads * 4 > 65535 ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6)
  const starts = new Int32Array(rows + 1)
  let quad = 0
  const emit = (face: Face, box: readonly [number, number, number, number, number, number], color: THREE.Color, slot: number) => {
    const [x0, x1, y0, y1, z0, z1] = box
    const normal = NORMALS[face]
    const u = (slot + 0.5) / SLOTS
    const base = quad * 4
    CORNERS[face].forEach(([cx, cy, cz], k) => {
      const at = (base + k) * 3
      positions[at] = cx === 0 ? x0 : x1
      positions[at + 1] = cy === 0 ? y0 : y1
      positions[at + 2] = cz === 0 ? z0 : z1
      normals[at] = normal[0]
      normals[at + 1] = normal[1]
      normals[at + 2] = normal[2]
      colors[at] = color.r
      colors[at + 1] = color.g
      colors[at + 2] = color.b
      lookups[(base + k) * 2] = u
      lookups[(base + k) * 2 + 1] = 0.5
    })
    indices.set(
      SPLITS[face].map((corner) => base + corner),
      quad * 6,
    )
    quad += 1
  }
  const { floor, water } = TERRAIN
  const shelf = TERRAIN.island
  for (let row = 0; row < rows; row++) {
    starts[row] = quad * 6
    for (let column = 0; column < columns; column++) {
      const cell = cells[row * columns + column]
      const x0 = column
      const x1 = column + 1
      const z0 = row
      const z1 = row + 1
      if (cell.kind === 'open') {
        emit('top', [x0, x1, shelf.top, shelf.top, z0, z1], island, GROUND_SLOT)
        continue
      }
      const level = cell.kind === 'floor' ? floor : water
      const slot = cell.kind === 'floor' ? GROUND_SLOT : WATER_SLOT
      emit('top', [x0, x1, level.top, level.top, z0, z1], cell.color, slot)
      for (const side of SIDES) {
        if (!sideShown(cell.kind, kindAt(column + side.dc, row + side.dr))) continue
        emit(side.face, [x0, x1, level.bottom, level.top, z0, z1], cell.color, slot)
      }
    }
    emit('west', [0, columns, shelf.bottom, shelf.top, row, row + 1], island, GROUND_SLOT)
    emit('east', [0, columns, shelf.bottom, shelf.top, row, row + 1], island, GROUND_SLOT)
    if (row === rows - 1) emit('south', [0, columns, shelf.bottom, shelf.top, 0, rows], island, GROUND_SLOT)
    if (row % ROWS_PER_STEP === ROWS_PER_STEP - 1) yield
  }
  starts[rows] = quad * 6
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('uv1', new THREE.BufferAttribute(lookups, 2))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeBoundingSphere()
  return { geometry, starts }
}

export function terrainLookup(): THREE.DataTexture {
  const data = new Float32Array(SLOTS * 4)
  data.set([1, TERRAIN.roughness.ground, 0, 1], GROUND_SLOT * 4)
  data.set([1, TERRAIN.roughness.water, 0, 1], WATER_SLOT * 4)
  const lookup = new THREE.DataTexture(data, SLOTS, 1, THREE.RGBAFormat, THREE.FloatType)
  lookup.magFilter = THREE.NearestFilter
  lookup.minFilter = THREE.NearestFilter
  lookup.generateMipmaps = false
  lookup.channel = 1
  lookup.needsUpdate = true
  return lookup
}

export function terrainMaterial(lookup: THREE.Texture): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, roughnessMap: lookup, metalnessMap: lookup })
}
