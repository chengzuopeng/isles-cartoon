import * as THREE from 'three'
import type { BuildingKind } from '../data/landmarks'
import type { LandmarkPlacement } from '../sim/landmarks'
import { lineTexture, type LineTextureKind } from './line-textures'
import { toonMaterial } from './toon'

export interface BuildingStyle {
  wall: string
  inside: string
  trim: string
  roof: string
  door: string
  hay: string
  wallTexture: LineTextureKind
  roofTexture: LineTextureKind
  wallHeight: number
  wallThickness: number
  doorHeight: number
  pitch: number
  overhang: number
  roofThickness: number
}

export const BUILDING_STYLES: Readonly<Record<BuildingKind, BuildingStyle>> = {
  barn: {
    wall: '#b5452f',
    inside: '#9c6a45',
    trim: '#f3ead8',
    roof: '#6f7f86',
    door: '#a63d2b',
    hay: '#e2c35c',
    wallTexture: 'wood',
    roofTexture: 'metal',
    wallHeight: 4.2,
    wallThickness: 0.5,
    doorHeight: 3,
    pitch: 0.75,
    overhang: 0.55,
    roofThickness: 0.16,
  },
}

type Axis = 'x' | 'y' | 'z'

type Bucket = (centroid: THREE.Vector3, normal: THREE.Vector3) => number

class Mesher {
  private readonly buckets: { positions: number[]; normals: number[]; uvs: number[] }[] = [{ positions: [], normals: [], uvs: [] }, { positions: [], normals: [], uvs: [] }]
  private readonly centroid = new THREE.Vector3()

  constructor(
    private readonly scale: number,
    private readonly bucket: Bucket | null = null,
  ) {}

  get empty(): boolean {
    return this.buckets.every((item) => item.positions.length === 0)
  }

  face(corners: readonly THREE.Vector3[], normal: THREE.Vector3, u: (point: THREE.Vector3) => number, v: (point: THREE.Vector3) => number): void {
    this.centroid.set(0, 0, 0)
    for (const corner of corners) this.centroid.add(corner)
    this.centroid.multiplyScalar(1 / corners.length)
    const target = this.buckets[this.bucket ? this.bucket(this.centroid, normal) : 0]
    const order = corners.length === 4 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2]
    for (const index of order) {
      const point = corners[index]
      target.positions.push(point.x, point.y, point.z)
      target.normals.push(normal.x, normal.y, normal.z)
      target.uvs.push(u(point) * this.scale, v(point) * this.scale)
    }
  }

  box(min: THREE.Vector3, max: THREE.Vector3, vertical = false): void {
    const p = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
    const along = (axis: Axis) => (point: THREE.Vector3) => point[axis]
    const pick = (horizontal: Axis) => (vertical ? [along('y'), along(horizontal)] : [along(horizontal), along('y')]) as [(point: THREE.Vector3) => number, (point: THREE.Vector3) => number]
    const [xu, xv] = pick('z')
    const [zu, zv] = pick('x')
    this.face([p(max.x, min.y, min.z), p(max.x, max.y, min.z), p(max.x, max.y, max.z), p(max.x, min.y, max.z)], new THREE.Vector3(1, 0, 0), xu, xv)
    this.face([p(min.x, min.y, max.z), p(min.x, max.y, max.z), p(min.x, max.y, min.z), p(min.x, min.y, min.z)], new THREE.Vector3(-1, 0, 0), xu, xv)
    this.face([p(min.x, min.y, max.z), p(max.x, min.y, max.z), p(max.x, max.y, max.z), p(min.x, max.y, max.z)], new THREE.Vector3(0, 0, 1), zu, zv)
    this.face([p(max.x, min.y, min.z), p(min.x, min.y, min.z), p(min.x, max.y, min.z), p(max.x, max.y, min.z)], new THREE.Vector3(0, 0, -1), zu, zv)
    this.face([p(min.x, max.y, min.z), p(min.x, max.y, max.z), p(max.x, max.y, max.z), p(max.x, max.y, min.z)], new THREE.Vector3(0, 1, 0), along('x'), along('z'))
    this.face([p(min.x, min.y, max.z), p(min.x, min.y, min.z), p(max.x, min.y, min.z), p(max.x, min.y, max.z)], new THREE.Vector3(0, -1, 0), along('x'), along('z'))
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()
    const positions = this.buckets.flatMap((item) => item.positions)
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.buckets.flatMap((item) => item.normals), 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.buckets.flatMap((item) => item.uvs), 2))
    let start = 0
    this.buckets.forEach((item, index) => {
      const count = item.positions.length / 3
      if (count > 0) geometry.addGroup(start, count, index)
      start += count
    })
    geometry.computeBoundingSphere()
    return geometry
  }
}

export interface Opening {
  side: 'north' | 'south' | 'east' | 'west'
  from: number
  to: number
}

export function openingsOf(mask: readonly string[]): Opening[] {
  const depth = mask.length
  const width = mask[0]?.length ?? 0
  const openings: Opening[] = []
  const scan = (side: Opening['side'], count: number, open: (index: number) => boolean) => {
    let start = -1
    for (let index = 0; index <= count; index++) {
      const gap = index < count && open(index)
      if (gap && start < 0) start = index
      if (!gap && start >= 0) {
        openings.push({ side, from: start, to: index })
        start = -1
      }
    }
  }
  scan('north', width, (column) => mask[0].charAt(column) === '.')
  scan('south', width, (column) => mask[depth - 1].charAt(column) === '.')
  scan('west', depth, (row) => mask[row].charAt(0) === '.')
  scan('east', depth, (row) => mask[row].charAt(width - 1) === '.')
  return openings
}

export interface Building {
  readonly group: THREE.Group
  dispose(): void
}

export function buildBuilding(kind: BuildingKind, placement: LandmarkPlacement, floor: number): Building {
  const style = BUILDING_STYLES[kind]
  const group = new THREE.Group()
  group.name = `building-${kind}`
  const { column, row, width, depth, mask } = placement
  const t = style.wallThickness
  const half = t / 2
  const x0 = column + 0.5
  const x1 = column + width - 0.5
  const z0 = row + 0.5
  const z1 = row + depth - 0.5
  const eave = floor + style.wallHeight
  const openings = openingsOf(mask)
  const centerX = (x0 + x1) / 2
  const centerZ = (z0 + z1) / 2
  const facesIn: Bucket = (centroid, normal) => {
    const inside = centroid.x > x0 - half - 0.01 && centroid.x < x1 + half + 0.01 && centroid.z > z0 - half - 0.01 && centroid.z < z1 + half + 0.01
    return inside && (centerX - centroid.x) * normal.x + (centerZ - centroid.z) * normal.z > 0.01 ? 1 : 0
  }
  const walls = new Mesher(0.5, facesIn)
  const trim = new Mesher(0.5)
  const sideSpan = (side: Opening['side']) => (side === 'north' || side === 'south' ? { start: column, length: width } : { start: row, length: depth })
  const sideBox = (side: Opening['side'], from: number, to: number, bottom: number, top: number, inset = 0) => {
    const span = sideSpan(side)
    const a = Math.max(span.start + from, side === 'north' || side === 'south' ? x0 - half : z0 - half)
    const b = Math.min(span.start + to, side === 'north' || side === 'south' ? x1 + half : z1 + half)
    if (b - a <= 0.01 || top - bottom <= 0.01) return null
    if (side === 'north') return [new THREE.Vector3(a, bottom, z0 - half - inset), new THREE.Vector3(b, top, z0 + half + inset)] as const
    if (side === 'south') return [new THREE.Vector3(a, bottom, z1 - half - inset), new THREE.Vector3(b, top, z1 + half + inset)] as const
    if (side === 'west') return [new THREE.Vector3(x0 - half - inset, bottom, a), new THREE.Vector3(x0 + half + inset, top, b)] as const
    return [new THREE.Vector3(x1 - half - inset, bottom, a), new THREE.Vector3(x1 + half + inset, top, b)] as const
  }
  const ground = floor - 0.4
  for (const side of ['north', 'south', 'west', 'east'] as const) {
    const span = sideSpan(side)
    const gaps = openings.filter((opening) => opening.side === side)
    let cursor = 0
    for (const gap of gaps) {
      const solid = sideBox(side, cursor, gap.from, ground, eave)
      if (solid) walls.box(solid[0], solid[1], true)
      const lintel = sideBox(side, gap.from, gap.to, floor + style.doorHeight, eave)
      if (lintel) walls.box(lintel[0], lintel[1], true)
      const header = sideBox(side, gap.from - 0.15, gap.to + 0.15, floor + style.doorHeight - 0.18, floor + style.doorHeight + 0.05, 0.06)
      if (header) trim.box(header[0], header[1])
      for (const edge of [gap.from, gap.to]) {
        const post = sideBox(side, edge - 0.12, edge + 0.12, ground, floor + style.doorHeight, 0.06)
        if (post) trim.box(post[0], post[1])
      }
      cursor = gap.to
    }
    const rest = sideBox(side, cursor, span.length, ground, eave)
    if (rest) walls.box(rest[0], rest[1], true)
  }
  for (const [cx, cz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
    trim.box(new THREE.Vector3(cx - half - 0.06, ground, cz - half - 0.06), new THREE.Vector3(cx + half + 0.06, eave, cz + half + 0.06))
  }

  const ridgeAlongZ = depth >= width
  const spanHalf = (ridgeAlongZ ? x1 - x0 + t : z1 - z0 + t) / 2
  const rise = spanHalf * style.pitch
  const ridge = eave + rise
  const roof = new Mesher(0.5)
  const underside = new Mesher(0.5)
  const o = style.overhang
  const thickness = style.roofThickness
  const cx = (x0 + x1) / 2
  const cz = (z0 + z1) / 2
  const slope = Math.hypot(spanHalf + o, rise + o * style.pitch)
  const along = ridgeAlongZ ? (point: THREE.Vector3) => point.z : (point: THREE.Vector3) => point.x
  for (const sign of [-1, 1]) {
    const outer = spanHalf + o
    const drop = o * style.pitch
    const corner = (s: number, a: number, lift: number) =>
      ridgeAlongZ ? new THREE.Vector3(cx + sign * s, lift, a) : new THREE.Vector3(a, lift, cz + sign * s)
    const startA = (ridgeAlongZ ? z0 - half : x0 - half) - o
    const endA = (ridgeAlongZ ? z1 + half : x1 + half) + o
    const top = [corner(0, startA, ridge + thickness), corner(outer, startA, eave - drop + thickness), corner(outer, endA, eave - drop + thickness), corner(0, endA, ridge + thickness)]
    const bottom = [corner(0, startA, ridge), corner(outer, startA, eave - drop), corner(outer, endA, eave - drop), corner(0, endA, ridge)]
    const normal = (ridgeAlongZ ? new THREE.Vector3(sign * style.pitch, 1, 0) : new THREE.Vector3(0, 1, sign * style.pitch)).normalize()
    const slopeU = (point: THREE.Vector3) => (Math.abs(ridgeAlongZ ? point.x - cx : point.z - cz) / outer) * slope
    const facing = (corners: THREE.Vector3[]) => {
      const ab = corners[1].clone().sub(corners[0])
      const ac = corners[2].clone().sub(corners[0])
      return ab.cross(ac).dot(normal) > 0 ? corners : [corners[0], corners[3], corners[2], corners[1]]
    }
    roof.face(facing(top), normal, along, slopeU)
    underside.face(facing(bottom).reverse(), normal.clone().negate(), along, slopeU)
    const edgeNormal = ridgeAlongZ ? new THREE.Vector3(sign, 0, 0) : new THREE.Vector3(0, 0, sign)
    const eaveEdge = [bottom[1], bottom[2], top[2], top[1]]
    roof.face(edgeNormal.x * (eaveEdge[1].z - eaveEdge[0].z) - edgeNormal.z * (eaveEdge[1].x - eaveEdge[0].x) > 0 ? eaveEdge : [eaveEdge[0], eaveEdge[3], eaveEdge[2], eaveEdge[1]], edgeNormal, along, (point) => point.y)
    for (const [a, b] of [[0, 1], [3, 2]] as const) {
      const end = [bottom[a], bottom[b], top[b], top[a]]
      const endNormal = ridgeAlongZ ? new THREE.Vector3(0, 0, a === 0 ? -1 : 1) : new THREE.Vector3(a === 0 ? -1 : 1, 0, 0)
      const ab = end[1].clone().sub(end[0])
      const ac = end[2].clone().sub(end[0])
      roof.face(ab.cross(ac).dot(endNormal) > 0 ? end : [end[0], end[3], end[2], end[1]], endNormal, ridgeAlongZ ? (point) => point.x : (point) => point.z, (point) => point.y)
    }
  }
  for (const end of [-1, 1]) {
    const a = ridgeAlongZ ? (end < 0 ? z0 : z1) : end < 0 ? x0 : x1
    for (const offset of [-half, half]) {
      const at = a + offset
      const left = ridgeAlongZ ? new THREE.Vector3(cx - spanHalf, eave, at) : new THREE.Vector3(at, eave, cz - spanHalf)
      const right = ridgeAlongZ ? new THREE.Vector3(cx + spanHalf, eave, at) : new THREE.Vector3(at, eave, cz + spanHalf)
      const peak = ridgeAlongZ ? new THREE.Vector3(cx, ridge, at) : new THREE.Vector3(at, ridge, cz)
      const normal = ridgeAlongZ ? new THREE.Vector3(0, 0, Math.sign(offset) * end) : new THREE.Vector3(Math.sign(offset) * end, 0, 0)
      const tri = [left, right, peak]
      const ab = tri[1].clone().sub(tri[0])
      const ac = tri[2].clone().sub(tri[0])
      const ordered = ab.cross(ac).dot(normal) > 0 ? tri : [tri[0], tri[2], tri[1]]
      walls.face(ordered, normal, (point) => point.y, ridgeAlongZ ? (point) => point.x : (point) => point.z)
    }
  }

  const inner = new Mesher(0.5)
  const beams = Math.max(1, Math.round((ridgeAlongZ ? z1 - z0 : x1 - x0) / 3))
  for (let i = 1; i < beams; i++) {
    const at = (ridgeAlongZ ? z0 : x0) + ((ridgeAlongZ ? z1 - z0 : x1 - x0) * i) / beams
    if (ridgeAlongZ) inner.box(new THREE.Vector3(x0, eave - 0.32, at - 0.12), new THREE.Vector3(x1, eave - 0.06, at + 0.12))
    else inner.box(new THREE.Vector3(at - 0.12, eave - 0.32, z0), new THREE.Vector3(at + 0.12, eave - 0.06, z1))
    if (ridgeAlongZ) inner.box(new THREE.Vector3(cx - 0.12, eave - 0.06, at - 0.12), new THREE.Vector3(cx + 0.12, ridge - 0.1, at + 0.12))
    else inner.box(new THREE.Vector3(at - 0.12, eave - 0.06, cz - 0.12), new THREE.Vector3(at + 0.12, ridge - 0.1, cz + 0.12))
  }
  if (ridgeAlongZ) inner.box(new THREE.Vector3(cx - 0.14, ridge - 0.3, z0 - half), new THREE.Vector3(cx + 0.14, ridge - 0.02, z1 + half))
  else inner.box(new THREE.Vector3(x0 - half, ridge - 0.3, cz - 0.14), new THREE.Vector3(x1 + half, ridge - 0.02, cz + 0.14))

  const hay = new Mesher(0.6)
  const bale = (x: number, z: number, level: number, turn: boolean) => {
    const w = turn ? 0.55 : 0.95
    const d = turn ? 0.95 : 0.55
    hay.box(new THREE.Vector3(x - w / 2, floor + level * 0.5, z - d / 2), new THREE.Vector3(x + w / 2, floor + level * 0.5 + 0.48, z + d / 2))
  }
  bale(x0 + half + 0.6, z0 + half + 0.45, 0, false)
  bale(x0 + half + 1.6, z0 + half + 0.45, 0, false)
  bale(x0 + half + 1.1, z0 + half + 0.45, 1, false)
  bale(x1 - half - 0.45, z0 + half + 0.9, 0, true)
  bale(x1 - half - 0.45, z0 + half + 1.9, 0, true)

  const doors = new Mesher(0.5)
  for (const gap of openings) {
    const span = sideSpan(gap.side)
    const length = gap.to - gap.from
    const leaf = length / 2
    for (const end of [0, 1]) {
      const hinge = span.start + (end === 0 ? gap.from : gap.to)
      const swing = end === 0 ? -1 : 1
      const outward = gap.side === 'south' || gap.side === 'east' ? 1 : -1
      const wallLine = gap.side === 'north' ? z0 : gap.side === 'south' ? z1 : gap.side === 'west' ? x0 : x1
      const angle = (100 * Math.PI) / 180
      const dirAlong = Math.cos(angle) * -swing
      const dirOut = Math.sin(angle) * outward
      const corners: THREE.Vector3[] = []
      for (const [s, y] of [[0, floor], [leaf, floor], [leaf, floor + style.doorHeight - 0.1], [0, floor + style.doorHeight - 0.1]] as const) {
        const a = hinge + dirAlong * s
        const b = wallLine + (half + 0.02) * outward + dirOut * s
        corners.push(gap.side === 'north' || gap.side === 'south' ? new THREE.Vector3(a, y, b) : new THREE.Vector3(b, y, a))
      }
      const minX = Math.min(...corners.map((point) => point.x))
      const maxX = Math.max(...corners.map((point) => point.x))
      const minZ = Math.min(...corners.map((point) => point.z))
      const maxZ = Math.max(...corners.map((point) => point.z))
      const pad = 0.05
      doors.box(new THREE.Vector3(minX - pad, floor + 0.05, minZ - pad), new THREE.Vector3(maxX + pad, floor + style.doorHeight - 0.1, maxZ + pad), true)
    }
  }

  const materials = {
    wall: toonMaterial({ color: style.wall, map: lineTexture(style.wallTexture) }),
    trim: toonMaterial({ color: style.trim }),
    roof: toonMaterial({ color: style.roof, map: lineTexture(style.roofTexture) }),
    underside: toonMaterial({ color: style.inside, map: lineTexture(style.wallTexture) }),
    inner: toonMaterial({ color: style.inside }),
    hay: toonMaterial({ color: style.hay, map: lineTexture('stubble') }),
    door: toonMaterial({ color: style.door, map: lineTexture(style.wallTexture) }),
  }
  const parts: [Mesher, THREE.Material | THREE.Material[], string, boolean][] = [
    [walls, [materials.wall, materials.underside], 'walls', true],
    [trim, materials.trim, 'trim', true],
    [roof, materials.roof, 'roof', true],
    [underside, materials.underside, 'ceiling', false],
    [inner, materials.inner, 'beams', true],
    [hay, materials.hay, 'hay', true],
    [doors, materials.door, 'doors', true],
  ]
  const geometries: THREE.BufferGeometry[] = []
  for (const [mesher, material, name, shadow] of parts) {
    if (mesher.empty) continue
    const geometry = mesher.build()
    geometries.push(geometry)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name
    mesh.castShadow = shadow
    mesh.receiveShadow = true
    group.add(mesh)
  }
  return {
    group,
    dispose() {
      group.removeFromParent()
      for (const geometry of geometries) geometry.dispose()
      for (const material of Object.values(materials)) material.dispose()
    },
  }
}
