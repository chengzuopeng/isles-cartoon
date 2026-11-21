import * as THREE from 'three'
import type { BuildingKind } from '../data/landmarks'
import type { LandmarkPlacement } from '../sim/landmarks'
import { radialTexture } from './glow-textures'
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
  bales: boolean
  fixedDoors?: false | Opening['side']
  ridgeAlongZ?: boolean
  postsEvery?: number
  lanterns?: boolean
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
    wallThickness: 1,
    doorHeight: 3,
    pitch: 0.75,
    overhang: 0.55,
    roofThickness: 0.16,
    bales: true,
    fixedDoors: 'south',
  },
  shed: {
    wall: '#8c6a47',
    inside: '#6f5236',
    trim: '#e3d5b8',
    roof: '#7c5a3c',
    door: '#7a5232',
    hay: '#e2c35c',
    wallTexture: 'wood',
    roofTexture: 'wood',
    wallHeight: 2.6,
    wallThickness: 0.35,
    doorHeight: 2.2,
    pitch: 0.6,
    overhang: 0.4,
    roofThickness: 0.14,
    bales: false,
  },
  'loading-shed': {
    wall: '#8a5e3f',
    inside: '#966a49',
    trim: '#65452f',
    roof: '#61776d',
    door: '#805137',
    hay: '#e2c35c',
    wallTexture: 'wood',
    roofTexture: 'metal',
    wallHeight: 3.75,
    wallThickness: 0.88,
    doorHeight: 3.05,
    pitch: 0.36,
    overhang: 0.62,
    roofThickness: 0.15,
    bales: false,
    fixedDoors: false,
    postsEvery: 4,
  },
  'big-barn': {
    wall: '#a85137',
    inside: '#a47450',
    trim: '#6c503b',
    roof: '#74554b',
    door: '#8b4935',
    hay: '#e2c35c',
    wallTexture: 'wood',
    roofTexture: 'metal',
    wallHeight: 8,
    wallThickness: 1,
    doorHeight: 3,
    pitch: 0.24,
    overhang: 0.65,
    roofThickness: 0.24,
    bales: false,
    fixedDoors: false,
    ridgeAlongZ: true,
    lanterns: true,
  },
  workshop: {
    wall: '#ba8c60',
    inside: '#946c49',
    trim: '#865431',
    roof: '#b9563c',
    door: '#a3784f',
    hay: '#e2c35c',
    wallTexture: 'wood',
    roofTexture: 'metal',
    wallHeight: 2.85,
    wallThickness: 1,
    doorHeight: 2.4,
    pitch: 0.72,
    overhang: 0.37,
    roofThickness: 0.13,
    bales: false,
    fixedDoors: false,
  },
  weighhouse: {
    wall: '#b18a55',
    inside: '#866347',
    trim: '#635946',
    roof: '#9e5139',
    door: '#a3784f',
    hay: '#e2c35c',
    wallTexture: 'wood',
    roofTexture: 'metal',
    wallHeight: 2.9,
    wallThickness: 1,
    doorHeight: 2.4,
    pitch: 0.63,
    overhang: 0.42,
    roofThickness: 0.13,
    bales: false,
    fixedDoors: false,
  },
  'tool-shed': {
    wall: '#b28556',
    inside: '#916644',
    trim: '#88603c',
    roof: '#b86849',
    door: '#a3784f',
    hay: '#e2c35c',
    wallTexture: 'wood',
    roofTexture: 'metal',
    wallHeight: 2.8,
    wallThickness: 1,
    doorHeight: 2.4,
    pitch: 0.68,
    overhang: 0.4,
    roofThickness: 0.13,
    bales: false,
    fixedDoors: false,
  },
}

type Axis = 'x' | 'y' | 'z'

type Bucket = (centroid: THREE.Vector3, normal: THREE.Vector3) => number

const WHITE = new THREE.Color('#ffffff')

export class Mesher {
  private readonly buckets: { positions: number[]; normals: number[]; uvs: number[]; colors: number[] }[] = [
    { positions: [], normals: [], uvs: [], colors: [] },
    { positions: [], normals: [], uvs: [], colors: [] },
  ]
  private readonly centroid = new THREE.Vector3()
  private colored = false

  constructor(
    private readonly scale: number,
    private readonly bucket: Bucket | null = null,
  ) {}

  get empty(): boolean {
    return this.buckets.every((item) => item.positions.length === 0)
  }

  face(
    corners: readonly THREE.Vector3[],
    normal: THREE.Vector3,
    u: (point: THREE.Vector3) => number,
    v: (point: THREE.Vector3) => number,
    color?: THREE.Color,
  ): void {
    this.centroid.set(0, 0, 0)
    for (const corner of corners) this.centroid.add(corner)
    this.centroid.multiplyScalar(1 / corners.length)
    const target = this.buckets[this.bucket ? this.bucket(this.centroid, normal) : 0]
    if (color) this.colored = true
    const tint = color ?? WHITE
    const order = corners.length === 4 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2]
    for (const index of order) {
      const point = corners[index]
      target.positions.push(point.x, point.y, point.z)
      target.normals.push(normal.x, normal.y, normal.z)
      target.uvs.push(u(point) * this.scale, v(point) * this.scale)
      target.colors.push(tint.r, tint.g, tint.b)
    }
  }

  box(min: THREE.Vector3, max: THREE.Vector3, vertical = false, color?: THREE.Color): void {
    const p = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
    const along = (axis: Axis) => (point: THREE.Vector3) => point[axis]
    const pick = (horizontal: Axis) => (vertical ? [along('y'), along(horizontal)] : [along(horizontal), along('y')]) as [(point: THREE.Vector3) => number, (point: THREE.Vector3) => number]
    const [xu, xv] = pick('z')
    const [zu, zv] = pick('x')
    this.face([p(max.x, min.y, min.z), p(max.x, max.y, min.z), p(max.x, max.y, max.z), p(max.x, min.y, max.z)], new THREE.Vector3(1, 0, 0), xu, xv, color)
    this.face([p(min.x, min.y, max.z), p(min.x, max.y, max.z), p(min.x, max.y, min.z), p(min.x, min.y, min.z)], new THREE.Vector3(-1, 0, 0), xu, xv, color)
    this.face([p(min.x, min.y, max.z), p(max.x, min.y, max.z), p(max.x, max.y, max.z), p(min.x, max.y, max.z)], new THREE.Vector3(0, 0, 1), zu, zv, color)
    this.face([p(max.x, min.y, min.z), p(min.x, min.y, min.z), p(min.x, max.y, min.z), p(max.x, max.y, min.z)], new THREE.Vector3(0, 0, -1), zu, zv, color)
    this.face([p(min.x, max.y, min.z), p(min.x, max.y, max.z), p(max.x, max.y, max.z), p(max.x, max.y, min.z)], new THREE.Vector3(0, 1, 0), along('x'), along('z'), color)
    this.face([p(min.x, min.y, max.z), p(min.x, min.y, min.z), p(max.x, min.y, min.z), p(max.x, min.y, max.z)], new THREE.Vector3(0, -1, 0), along('x'), along('z'), color)
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()
    const positions = this.buckets.flatMap((item) => item.positions)
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.buckets.flatMap((item) => item.normals), 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.buckets.flatMap((item) => item.uvs), 2))
    if (this.colored) geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.buckets.flatMap((item) => item.colors), 3))
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

export function buildBuilding(kind: BuildingKind, placement: Pick<LandmarkPlacement, 'column' | 'row' | 'width' | 'depth' | 'mask'>, floor: number): Building {
  const style = BUILDING_STYLES[kind]
  const house = kind === 'workshop' || kind === 'weighhouse' || kind === 'tool-shed'
  const fullCellWall = house || kind === 'barn'
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
  const foundation = new Mesher(0.8)
  const sideSpan = (side: Opening['side']) => (side === 'north' || side === 'south' ? { start: column, length: width } : { start: row, length: depth })
  const sideBox = (side: Opening['side'], from: number, to: number, bottom: number, top: number, inset = 0) => {
    const span = sideSpan(side)
    const across = side === 'north' || side === 'south'
    const corner = fullCellWall && !across && inset === 0 ? 1 : 0
    const a = Math.max(span.start + from, across ? x0 - half : z0 - half + corner)
    const b = Math.min(span.start + to, across ? x1 + half : z1 + half - corner)
    if (b - a <= 0.01 || top - bottom <= 0.01) return null
    if (side === 'north') return [new THREE.Vector3(a, bottom, z0 - half - inset), new THREE.Vector3(b, top, z0 + half + inset)] as const
    if (side === 'south') return [new THREE.Vector3(a, bottom, z1 - half - inset), new THREE.Vector3(b, top, z1 + half + inset)] as const
    if (side === 'west') return [new THREE.Vector3(x0 - half - inset, bottom, a), new THREE.Vector3(x0 + half + inset, top, b)] as const
    return [new THREE.Vector3(x1 - half - inset, bottom, a), new THREE.Vector3(x1 + half + inset, top, b)] as const
  }
  const ground = floor - 0.4
  const addWall = (side: Opening['side'], from: number, to: number) => {
    const sill = house ? floor + 0.42 : ground
    const wall = sideBox(side, from, to, sill, eave)
    if (wall) walls.box(wall[0], wall[1], true)
    if (!house) return
    const base = sideBox(side, from, to, ground, sill)
    if (base) foundation.box(base[0], base[1])
  }
  for (const side of ['north', 'south', 'west', 'east'] as const) {
    const span = sideSpan(side)
    const gaps = openings.filter((opening) => opening.side === side)
    let cursor = 0
    for (const gap of gaps) {
      addWall(side, cursor, gap.from)
      const lintel = sideBox(side, gap.from, gap.to, floor + style.doorHeight, eave)
      if (lintel && kind !== 'loading-shed') walls.box(lintel[0], lintel[1], true)
      const header = sideBox(side, gap.from - 0.15, gap.to + 0.15, floor + style.doorHeight - 0.18, floor + style.doorHeight + 0.05, 0.06)
      if (header) trim.box(header[0], header[1])
      for (const [from, to] of fullCellWall ? [[gap.from - 0.17, gap.from], [gap.to, gap.to + 0.17]] : [[gap.from - 0.12, gap.from + 0.12], [gap.to - 0.12, gap.to + 0.12]]) {
        const post = sideBox(side, from, to, ground, floor + style.doorHeight, 0.06)
        if (post) trim.box(post[0], post[1])
      }
      if (style.postsEvery) {
        for (let at = gap.from + style.postsEvery; at < gap.to - 0.5; at += style.postsEvery) {
          const post = sideBox(side, at - 0.095, at + 0.095, ground, eave, 0.075)
          if (post) trim.box(post[0], post[1])
        }
      }
      cursor = gap.to
    }
    addWall(side, cursor, span.length)
  }
  for (const [cx, cz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
    if (fullCellWall) {
      const x = cx + (cx === x0 ? -half + 0.065 : half - 0.065)
      const z = cz + (cz === z0 ? -half + 0.065 : half - 0.065)
      trim.box(new THREE.Vector3(x - 0.11, ground, z - 0.11), new THREE.Vector3(x + 0.11, eave, z + 0.11))
    } else {
      trim.box(new THREE.Vector3(cx - half - 0.06, ground, cz - half - 0.06), new THREE.Vector3(cx + half + 0.06, eave, cz + half + 0.06))
    }
  }

  const ridgeAlongZ = style.ridgeAlongZ ?? (depth >= width)
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
  const lanterns = new Mesher(0.5)
  const lightPools = new Mesher(1)
  const floorboards = new Mesher(0.5)
  const fittings = new Mesher(0.5)
  const details: THREE.Mesh<THREE.BufferGeometry, THREE.Material>[] = []
  const box = (mesh: Mesher, x: number, y: number, z: number, dx: number, dy: number, dz: number) =>
    mesh.box(new THREE.Vector3(x, floor + y, z), new THREE.Vector3(x + dx, floor + y + dy, z + dz))
  const lightPool = (x: number, z: number, radius: number, y: number) => {
    lightPools.face([
      new THREE.Vector3(x - radius, y, z - radius),
      new THREE.Vector3(x - radius, y, z + radius),
      new THREE.Vector3(x + radius, y, z + radius),
      new THREE.Vector3(x + radius, y, z - radius),
    ], new THREE.Vector3(0, 1, 0), (point) => (point.x - x + radius) / (2 * radius), (point) => (point.z - z + radius) / (2 * radius))
  }
  if (house) {
    // A single floor runs between the two thresholds. The workbench stays against the north wall.
    box(floorboards, column + 1, -0.09, row + 1, width - 2, 0.11, depth - 2)
    for (const { side, from, to } of openings) {
      if (side === 'north' || side === 'south') {
        box(floorboards, column + from, -0.09, side === 'south' ? row + depth - 1 : row, to - from, 0.11, 1)
      } else {
        box(floorboards, side === 'east' ? column + width - 1 : column, -0.09, row + from, 1, 0.11, to - from)
      }
    }
    box(floorboards, column + 1.35, 0.82, row + 0.8, 2.2, 0.15, 0.42)
    for (const x of [column + 1.5, column + 3.25]) {
      box(inner, x, 0, row + 0.94, 0.15, 0.82, 0.18)
    }
    box(inner, column + 1.55, 1.38, row + 0.95, 1.85, 0.12, 0.24)
    box(fittings, column + 1.72, 0.97, row + 0.97, 0.46, 0.24, 0.22)
    box(fittings, column + 2.85, 1.5, row + 1, 0.34, 0.34, 0.16)
    box(foundation, column + 1.2, style.wallHeight + 0.07, row + 0.85, 0.52, 0.96, 0.5)
    box(foundation, column + 1.12, style.wallHeight + 1.01, row + 0.77, 0.68, 0.13, 0.66)

    const southDoor = openings.find((opening) => opening.side === 'south')
    if (southDoor) {
      const lampX = column + (southDoor.from + southDoor.to) / 2
      box(inner, lampX - 0.055, 2.42, row + depth - 1.14, 0.11, 0.29, 0.11)
      box(lanterns, lampX - 0.14, 2.22, row + depth - 1.22, 0.28, 0.2, 0.24)
      lightPool(lampX, row + depth - 1.35, 1.7, floor + 0.027)
    }
    if (kind === 'workshop') {
      const wheelX = column + width - 1.6
      const wheelY = 1.66
      const wheelZ = row + depth + 0.1
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.57, 0.085, 5, 16), toonMaterial({ color: '#ae7c3f' }))
      wheel.name = 'hanging-wheel'
      wheel.position.set(wheelX, floor + wheelY, wheelZ)
      details.push(wheel)
      box(fittings, wheelX - 0.55, wheelY - 0.04, wheelZ - 0.045, 1.1, 0.08, 0.09)
      box(fittings, wheelX - 0.04, wheelY - 0.55, wheelZ - 0.045, 0.08, 1.1, 0.09)
      box(inner, wheelX - 0.15, wheelY - 0.15, wheelZ - 0.16, 0.3, 0.3, 0.25)
    } else if (kind === 'weighhouse') {
      const armX = column + width
      box(inner, armX - 0.05, 2.68, row + 2.24, 0.26, 0.51, 0.25)
      box(fittings, armX + 0.09, 3.02, row + 1.52, 0.23, 0.17, 2.06)
      box(inner, armX + 0.18, 2.67, row + 3.42, 0.055, 0.42, 0.055)
      box(fittings, armX + 0.08, 2.44, row + 3.32, 0.26, 0.28, 0.25)
      box(fittings, column + 3.1, 0.97, row + 0.98, 0.33, 0.51, 0.16)
    } else {
      const x = column + width - 1.55
      const z = row + depth
      const grainHook = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.06, 4, 13, Math.PI * 1.22), toonMaterial({ color: '#7e8988' }))
      grainHook.name = 'grain-hook'
      grainHook.position.set(x, floor + 1.78, z + 0.075)
      grainHook.rotation.z = 0.28
      details.push(grainHook)
      box(inner, x + 0.25, 1.21, z + 0.025, 0.14, 0.72, 0.11)
      box(fittings, x - 0.62, 1.45, z + 0.03, 0.06, 0.75, 0.095)
      box(fittings, x - 0.81, 1.43, z + 0.035, 0.42, 0.07, 0.1)
    }
  }
  if (kind === 'barn') {
    const eastDoor = openings.find((opening) => opening.side === 'east')
    if (eastDoor) {
      const x = column + width - 1.47
      const z = row + (eastDoor.from + eastDoor.to) / 2
      box(inner, x - 0.06, 3.24, z - 0.06, 0.12, 0.82, 0.12)
      box(lanterns, x - 0.17, 3, z - 0.16, 0.34, 0.24, 0.32)
      lightPool(x, z, 1.85, floor + 0.025)
    }
  }
  const beamStep = style.lanterns ? 5 : 3
  const beams = Math.max(1, Math.round((ridgeAlongZ ? z1 - z0 : x1 - x0) / beamStep))
  for (let i = 1; i < beams; i++) {
    const at = (ridgeAlongZ ? z0 : x0) + ((ridgeAlongZ ? z1 - z0 : x1 - x0) * i) / beams
    if (ridgeAlongZ) inner.box(new THREE.Vector3(x0, eave - 0.32, at - 0.12), new THREE.Vector3(x1, eave - 0.06, at + 0.12))
    else inner.box(new THREE.Vector3(at - 0.12, eave - 0.32, z0), new THREE.Vector3(at + 0.12, eave - 0.06, z1))
    if (ridgeAlongZ) inner.box(new THREE.Vector3(cx - 0.12, eave - 0.06, at - 0.12), new THREE.Vector3(cx + 0.12, ridge - 0.1, at + 0.12))
    else inner.box(new THREE.Vector3(at - 0.12, eave - 0.06, cz - 0.12), new THREE.Vector3(at + 0.12, ridge - 0.1, cz + 0.12))
    if (style.lanterns) {
      for (const x of [x0 + half - 0.07, x1 - half + 0.07]) {
        inner.box(new THREE.Vector3(x - 0.14, floor, at - 0.18), new THREE.Vector3(x + 0.14, eave - 0.06, at + 0.18))
      }
    }
    if (style.lanterns && i % 2 === 1) {
      for (const x of [cx - width * 0.24, cx + width * 0.24]) {
        const bottom = eave - 1.5
        inner.box(new THREE.Vector3(x - 0.035, bottom + 0.38, at - 0.035), new THREE.Vector3(x + 0.035, eave - 0.22, at + 0.035))
        for (const y of [bottom - 0.08, bottom + 0.34]) {
          inner.box(new THREE.Vector3(x - 0.23, y, at - 0.2), new THREE.Vector3(x + 0.23, y + 0.1, at + 0.2))
        }
        lanterns.box(new THREE.Vector3(x - 0.17, bottom, at - 0.14), new THREE.Vector3(x + 0.17, bottom + 0.34, at + 0.14))
        lightPool(x, at, 5, floor + 0.02)
      }
    }
  }
  if (ridgeAlongZ) inner.box(new THREE.Vector3(cx - 0.14, ridge - 0.3, z0 - half), new THREE.Vector3(cx + 0.14, ridge - 0.02, z1 + half))
  else inner.box(new THREE.Vector3(x0 - half, ridge - 0.3, cz - 0.14), new THREE.Vector3(x1 + half, ridge - 0.02, cz + 0.14))

  const hay = new Mesher(0.6)
  const bale = (x: number, z: number, level: number, turn: boolean) => {
    const w = turn ? 0.55 : 0.95
    const d = turn ? 0.95 : 0.55
    hay.box(new THREE.Vector3(x - w / 2, floor + level * 0.5, z - d / 2), new THREE.Vector3(x + w / 2, floor + level * 0.5 + 0.48, z + d / 2))
  }
  if (style.bales) {
    bale(x0 + half + 0.6, z0 + half + 0.45, 0, false)
    bale(x0 + half + 1.6, z0 + half + 0.45, 0, false)
    bale(x0 + half + 1.1, z0 + half + 0.45, 1, false)
    bale(x1 - half - 0.45, z0 + half + 0.9, 0, true)
    bale(x1 - half - 0.45, z0 + half + 1.9, 0, true)
  }

  const doors = new Mesher(0.5)
  for (const gap of openings) {
    if (style.fixedDoors === false || (style.fixedDoors !== undefined && style.fixedDoors !== gap.side)) continue
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
    lantern: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffca75').multiplyScalar(1.8) }),
  }
  const glow = lightPools.empty ? null : radialTexture(64, 1.8)
  const lightMaterial = glow && new THREE.MeshBasicMaterial({
    color: '#dcb889',
    map: glow,
    transparent: true,
    opacity: 0.24,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const parts: [Mesher, THREE.Material | THREE.Material[], string, boolean][] = [
    [walls, [materials.wall, materials.underside], 'walls', true],
    [trim, materials.trim, 'trim', true],
    [roof, materials.roof, 'roof', true],
    [underside, materials.underside, 'ceiling', false],
    [inner, materials.inner, 'beams', true],
    [lanterns, materials.lantern, 'lanterns', false],
    [hay, materials.hay, 'hay', false],
    [doors, materials.door, 'doors', true],
  ]
  const houseMaterials = house ? [
    toonMaterial({ color: '#b69a7d', map: lineTexture('stone') }),
    toonMaterial({ color: '#a27a53', map: lineTexture('wood') }),
    toonMaterial({ color: '#9a7443', map: lineTexture('metal') }),
  ] : []
  if (house) parts.push(
    [foundation, houseMaterials[0], 'stonework', true],
    [floorboards, houseMaterials[1], 'floorboards', false],
    [fittings, houseMaterials[2], 'fittings', false],
  )
  if (lightMaterial) parts.push([lightPools, lightMaterial, 'lantern-light', false])
  const geometries: THREE.BufferGeometry[] = []
  for (const [mesher, material, name, shadow] of parts) {
    if (mesher.empty) continue
    const geometry = mesher.build()
    geometries.push(geometry)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name
    mesh.castShadow = shadow
    mesh.receiveShadow = true
    if (name === 'lantern-light') mesh.userData.noInk = true
    group.add(mesh)
  }
  for (const detail of details) {
    detail.castShadow = false
    detail.receiveShadow = true
    group.add(detail)
  }
  return {
    group,
    dispose() {
      group.removeFromParent()
      for (const geometry of geometries) geometry.dispose()
      for (const material of Object.values(materials)) material.dispose()
      for (const material of houseMaterials) material.dispose()
      for (const detail of details) {
        detail.geometry.dispose()
        detail.material.dispose()
      }
      lightMaterial?.dispose()
      glow?.dispose()
    },
  }
}
