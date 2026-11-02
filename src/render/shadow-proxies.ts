import * as THREE from 'three'
import { SHADOW_LAYER, SHADOW_PROXY } from './themes'

export type ProxyShape = 'box' | 'lathe'

export interface Ring {
  height: number
  radius: number
}

export interface LatheProfile {
  x: number
  z: number
  bottom: number
  top: number
  rings: Ring[]
}

export interface BoxProfile {
  min: readonly [number, number, number]
  max: readonly [number, number, number]
}

export interface PlacedProxy {
  geometry: THREE.BufferGeometry
  matrix: THREE.Matrix4
}

const TAU = Math.PI * 2

export function pointsOf(geometry: THREE.BufferGeometry): Float32Array {
  const position = geometry.getAttribute('position')
  const points = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) {
    points[i * 3] = position.getX(i)
    points[i * 3 + 1] = position.getY(i)
    points[i * 3 + 2] = position.getZ(i)
  }
  return points
}

function extent(points: ArrayLike<number>): { min: [number, number, number]; max: [number, number, number] } | null {
  const count = Math.floor(points.length / 3)
  if (count === 0) return null
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < count; i++) {
    for (let axis = 0; axis < 3; axis++) {
      const value = points[i * 3 + axis]
      if (value < min[axis]) min[axis] = value
      if (value > max[axis]) max[axis] = value
    }
  }
  return { min, max }
}

export function latheProfile(points: ArrayLike<number>, rings: number = SHADOW_PROXY.rings, sectors: number = SHADOW_PROXY.sectors): LatheProfile | null {
  const box = extent(points)
  if (!box) return null
  const x = (box.min[0] + box.max[0]) / 2
  const z = (box.min[2] + box.max[2]) / 2
  const bottom = box.min[1]
  const top = box.max[1]
  const span = top - bottom
  if (span <= 1e-6) return null
  const reach = new Float32Array(rings * sectors).fill(-1)
  for (let i = 0; i < points.length / 3; i++) {
    const dx = points[i * 3] - x
    const dz = points[i * 3 + 2] - z
    const ring = Math.min(rings - 1, Math.floor(((points[i * 3 + 1] - bottom) / span) * rings))
    const sector = Math.min(sectors - 1, Math.floor(((Math.atan2(dz, dx) + Math.PI) / TAU) * sectors))
    const slot = ring * sectors + sector
    reach[slot] = Math.max(reach[slot], Math.hypot(dx, dz))
  }
  const profile: Ring[] = []
  for (let ring = 0; ring < rings; ring++) {
    let sum = 0
    let seen = 0
    for (let sector = 0; sector < sectors; sector++) {
      const value = reach[ring * sectors + sector]
      if (value < 0) continue
      sum += value * value
      seen += 1
    }
    profile.push({ height: bottom + (span * (ring + 0.5)) / rings, radius: seen > 0 ? Math.sqrt(sum / seen) : 0 })
  }
  const filled = profile.filter((ring) => ring.radius > 0)
  return filled.length > 0 ? { x, z, bottom, top, rings: filled } : null
}

export function boxProfile(points: ArrayLike<number>, bins: number = SHADOW_PROXY.bins): BoxProfile | null {
  const box = extent(points)
  if (!box) return null
  const width = Math.max(1e-6, box.max[0] - box.min[0])
  const depth = Math.max(1e-6, box.max[2] - box.min[2])
  const peaks = new Float32Array(bins * bins).fill(-Infinity)
  for (let i = 0; i < points.length / 3; i++) {
    const column = Math.min(bins - 1, Math.floor(((points[i * 3] - box.min[0]) / width) * bins))
    const row = Math.min(bins - 1, Math.floor(((points[i * 3 + 2] - box.min[2]) / depth) * bins))
    const slot = row * bins + column
    peaks[slot] = Math.max(peaks[slot], points[i * 3 + 1])
  }
  let sum = 0
  let seen = 0
  for (const peak of peaks) {
    if (peak === -Infinity) continue
    sum += peak
    seen += 1
  }
  const top = seen > 0 ? Math.min(box.max[1], sum / seen) : box.max[1]
  return { min: box.min, max: [box.max[0], Math.max(box.min[1] + 1e-3, top), box.max[2]] }
}

export function latheGeometry(profile: LatheProfile, segments: number = SHADOW_PROXY.segments): THREE.BufferGeometry {
  const { x, z, bottom, top, rings } = profile
  const positions: number[] = [x, bottom, z]
  const indices: number[] = []
  const circle = (height: number, radius: number) => {
    for (let k = 0; k < segments; k++) {
      const angle = (k / segments) * TAU
      positions.push(x + Math.cos(angle) * radius, height, z + Math.sin(angle) * radius)
    }
  }
  circle(bottom, rings[0].radius)
  for (const ring of rings) circle(ring.height, ring.radius)
  const apex = positions.length / 3
  positions.push(x, top, z)
  const start = (level: number) => 1 + level * segments
  for (let k = 0; k < segments; k++) indices.push(0, start(0) + k, start(0) + ((k + 1) % segments))
  for (let level = 0; level < rings.length; level++) {
    for (let k = 0; k < segments; k++) {
      const next = (k + 1) % segments
      const a = start(level) + k
      const b = start(level + 1) + k
      const c = start(level) + next
      const d = start(level + 1) + next
      indices.push(a, b, c, c, b, d)
    }
  }
  const last = start(rings.length)
  for (let k = 0; k < segments; k++) indices.push(apex, last + ((k + 1) % segments), last + k)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

export function boxGeometry(profile: BoxProfile): THREE.BufferGeometry {
  const [x0, y0, z0] = profile.min
  const [x1, y1, z1] = profile.max
  const box = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0)
  box.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', box.getAttribute('position'))
  geometry.setAttribute('normal', box.getAttribute('normal'))
  geometry.setIndex(box.getIndex())
  return geometry
}

export function proxyGeometry(sources: readonly THREE.BufferGeometry[], shape: ProxyShape): THREE.BufferGeometry | null {
  if (sources.length === 0) return null
  const lists = sources.map(pointsOf)
  const points = new Float32Array(lists.reduce((sum, list) => sum + list.length, 0))
  let offset = 0
  for (const list of lists) {
    points.set(list, offset)
    offset += list.length
  }
  if (shape === 'box') {
    const profile = boxProfile(points)
    return profile ? boxGeometry(profile) : null
  }
  const profile = latheProfile(points)
  return profile ? latheGeometry(profile) : null
}

export function mergeProxies(items: readonly PlacedProxy[]): THREE.BufferGeometry | null {
  if (items.length === 0) return null
  let vertices = 0
  let corners = 0
  for (const { geometry } of items) {
    const count = geometry.getAttribute('position').count
    vertices += count
    corners += geometry.getIndex()?.count ?? count
  }
  const positions = new Float32Array(vertices * 3)
  const normals = new Float32Array(vertices * 3)
  const indices = vertices > 65535 ? new Uint32Array(corners) : new Uint16Array(corners)
  const turn = new THREE.Matrix3()
  let vertex = 0
  let corner = 0
  for (const { geometry, matrix } of items) {
    const source = geometry.getAttribute('position')
    const facing = geometry.getAttribute('normal')
    const e = matrix.elements
    const n = turn.getNormalMatrix(matrix).elements
    const flat = source instanceof THREE.BufferAttribute && !source.normalized ? source.array : null
    for (let k = 0; k < source.count; k++) {
      const at = (vertex + k) * 3
      const x = flat ? flat[k * 3] : source.getX(k)
      const y = flat ? flat[k * 3 + 1] : source.getY(k)
      const z = flat ? flat[k * 3 + 2] : source.getZ(k)
      const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15])
      positions[at] = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w
      positions[at + 1] = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w
      positions[at + 2] = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w
      if (!facing) continue
      const nx = facing.getX(k)
      const ny = facing.getY(k)
      const nz = facing.getZ(k)
      const tx = n[0] * nx + n[3] * ny + n[6] * nz
      const ty = n[1] * nx + n[4] * ny + n[7] * nz
      const tz = n[2] * nx + n[5] * ny + n[8] * nz
      const scale = 1 / (Math.sqrt(tx * tx + ty * ty + tz * tz) || 1)
      normals[at] = tx * scale
      normals[at + 1] = ty * scale
      normals[at + 2] = tz * scale
    }
    const index = geometry.getIndex()
    const count = index?.count ?? source.count
    for (let k = 0; k < count; k++) indices[corner + k] = (index ? index.getX(k) : k) + vertex
    vertex += source.count
    corner += count
  }
  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  if (items.every(({ geometry }) => geometry.getAttribute('normal'))) merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  merged.setIndex(new THREE.BufferAttribute(indices, 1))
  merged.computeBoundingSphere()
  return merged
}

export function addShadowProxy(parent: THREE.Object3D, items: readonly PlacedProxy[], material: THREE.Material): THREE.BufferGeometry | null {
  const geometry = mergeProxies(items)
  if (!geometry) return null
  const mesh = shadowOnly(new THREE.Mesh(geometry, material))
  mesh.matrixAutoUpdate = false
  parent.add(mesh)
  return geometry
}

export function addShadowProxies(parent: THREE.Object3D, blocks: Iterable<readonly PlacedProxy[]>, material: THREE.Material): THREE.BufferGeometry[] {
  const made: THREE.BufferGeometry[] = []
  for (const items of blocks) {
    const geometry = addShadowProxy(parent, items, material)
    if (geometry) made.push(geometry)
  }
  return made
}

export function shadowOnly<T extends THREE.Object3D>(object: T): T {
  object.layers.set(SHADOW_LAYER)
  object.castShadow = true
  object.receiveShadow = false
  return object
}

export function isShadowOnly(object: THREE.Object3D): boolean {
  return !object.layers.isEnabled(0)
}
