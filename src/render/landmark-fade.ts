import * as THREE from 'three'
import type { LandmarkDef } from '../data/landmarks'
import type { CameraTuning } from '../data/tuning'
import type { Vec2 } from '../sim/math'
import { finish, type Steps } from './slices'
import { LANDMARK_FADE } from './themes'

export type FadeRule = typeof LANDMARK_FADE

export interface Point3 {
  x: number
  y: number
  z: number
}

export interface Sight {
  readonly min: Point3
  readonly max: Point3
  blocks(from: Point3, to: Point3, roof: boolean): boolean
}

export interface SpinPart {
  node: THREE.Object3D
  axis: THREE.Vector3
}

export interface FadeState {
  hidden: boolean
  timer: number
  opacity: number
}

export interface Fader {
  readonly faded: boolean
  set(opacity: number): void
  dispose(): void
}

interface MaterialState {
  material: THREE.Material
  opacity: number
  transparent: boolean
  depthWrite: boolean
  shadowSide: THREE.Side | null
}

interface Cylinder {
  x: number
  y: number
  z: number
  ax: number
  ay: number
  az: number
  radius: number
  from: number
  to: number
  layer: number
}

const SOLID = 1
const ROOF = 2
const FRONT = 4
const BACK = 8
const SIGHT_STEP = 4096
const span = { enter: 0, leave: 1 }
const cornerA = new THREE.Vector3()
const cornerB = new THREE.Vector3()
const cornerC = new THREE.Vector3()
const pivot = new THREE.Vector3()
const spin = new THREE.Quaternion()
const probe: Point3 = { x: 0, y: 0, z: 0 }

export function fadesBehind(def: Pick<LandmarkDef, 'height' | 'hideInside'>, rule: FadeRule = LANDMARK_FADE): boolean {
  return def.height > rule.minHeight && !def.hideInside?.length
}

export function cameraEye(player: { pos: Vec2; aim: Vec2 }, leading: boolean, camera: CameraTuning, out: Point3): Point3 {
  let leadX = 0
  let leadY = 0
  if (leading) {
    leadX = (player.aim.x - player.pos.x) * camera.lead
    leadY = (player.aim.y - player.pos.y) * camera.lead
    const length = Math.hypot(leadX, leadY)
    if (length > camera.maxLead) {
      leadX *= camera.maxLead / length
      leadY *= camera.maxLead / length
    }
  }
  const pitch = THREE.MathUtils.degToRad(camera.pitch)
  out.x = player.pos.x + leadX
  out.y = Math.sin(pitch) * camera.distance
  out.z = player.pos.y + leadY + Math.cos(pitch) * camera.distance
  return out
}

function clipAxis(start: number, end: number, min: number, max: number): boolean {
  const delta = end - start
  if (Math.abs(delta) < 1e-9) return start >= min && start <= max
  const a = (min - start) / delta
  const b = (max - start) / delta
  span.enter = Math.max(span.enter, Math.min(a, b))
  span.leave = Math.min(span.leave, Math.max(a, b))
  return span.enter <= span.leave
}

export function segmentHitsBounds(from: Point3, to: Point3, min: Point3, max: Point3): boolean {
  span.enter = 0
  span.leave = 1
  return clipAxis(from.x, to.x, min.x, max.x) && clipAxis(from.y, to.y, min.y, max.y) && clipAxis(from.z, to.z, min.z, max.z)
}

export function boxSight(cells: readonly number[], columns: number, height: number): Sight {
  const pairs = cells.map((index): [number, number] => [index % columns, Math.floor(index / columns)])
  const min = { x: Infinity, y: 0, z: Infinity }
  const max = { x: -Infinity, y: height, z: -Infinity }
  for (const [column, row] of pairs) {
    min.x = Math.min(min.x, column)
    min.z = Math.min(min.z, row)
    max.x = Math.max(max.x, column + 1)
    max.z = Math.max(max.z, row + 1)
  }
  const low = { x: 0, y: 0, z: 0 }
  const high = { x: 0, y: height, z: 0 }
  return {
    min,
    max,
    blocks(from, to) {
      if (!segmentHitsBounds(from, to, min, max)) return false
      for (const [column, row] of pairs) {
        low.x = column
        low.z = row
        high.x = column + 1
        high.z = row + 1
        if (segmentHitsBounds(from, to, low, high)) return true
      }
      return false
    },
  }
}

function descends(object: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (node === ancestor) return true
  return false
}

function shown(object: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (!node.visible) return false
    if (node === root) return true
  }
  return true
}

function eachTriangle(mesh: THREE.Mesh, visit: (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => void): void {
  const position = mesh.geometry.getAttribute('position')
  const index = mesh.geometry.getIndex()
  const count = index ? index.count : position.count
  const at = (i: number) => (index ? index.getX(i) : i)
  for (let i = 0; i + 2 < count; i += 3) {
    cornerA.fromBufferAttribute(position, at(i)).applyMatrix4(mesh.matrixWorld)
    cornerB.fromBufferAttribute(position, at(i + 1)).applyMatrix4(mesh.matrixWorld)
    cornerC.fromBufferAttribute(position, at(i + 2)).applyMatrix4(mesh.matrixWorld)
    visit(cornerA, cornerB, cornerC)
  }
}

function facing(mesh: THREE.Mesh): number {
  if (Array.isArray(mesh.material)) return 0
  if (mesh.material.side === THREE.FrontSide) return FRONT
  return mesh.material.side === THREE.BackSide ? BACK : 0
}

function sweep(part: SpinPart, meshes: readonly THREE.Mesh[], layer: number, slices: number): Cylinder[] {
  part.node.getWorldPosition(pivot)
  const axis = part.axis.clone().applyQuaternion(part.node.getWorldQuaternion(spin)).normalize()
  const spans: number[] = []
  let from = Infinity
  let to = -Infinity
  const along = (point: THREE.Vector3) => (point.x - pivot.x) * axis.x + (point.y - pivot.y) * axis.y + (point.z - pivot.z) * axis.z
  const radius = (point: THREE.Vector3, offset: number) =>
    Math.sqrt(Math.max(0, point.distanceToSquared(pivot) - offset * offset))
  for (const mesh of meshes) {
    eachTriangle(mesh, (a, b, c) => {
      const da = along(a)
      const db = along(b)
      const dc = along(c)
      const low = Math.min(da, db, dc)
      const high = Math.max(da, db, dc)
      spans.push(low, high, Math.max(radius(a, da), radius(b, db), radius(c, dc)))
      from = Math.min(from, low)
      to = Math.max(to, high)
    })
  }
  if (spans.length === 0) return []
  const width = Math.max(1e-6, (to - from) / slices)
  const radii = new Float64Array(slices)
  const slice = (value: number) => Math.min(slices - 1, Math.max(0, Math.floor((value - from) / width)))
  for (let i = 0; i < spans.length; i += 3) {
    for (let s = slice(spans[i]); s <= slice(spans[i + 1]); s++) radii[s] = Math.max(radii[s], spans[i + 2])
  }
  const cylinders: Cylinder[] = []
  for (let start = 0; start < slices; ) {
    let end = start
    while (end + 1 < slices && radii[end + 1] === radii[start]) end++
    if (radii[start] > 0) {
      cylinders.push({
        x: pivot.x,
        y: pivot.y,
        z: pivot.z,
        ax: axis.x,
        ay: axis.y,
        az: axis.z,
        radius: radii[start],
        from: from + start * width,
        to: end === slices - 1 ? to : from + (end + 1) * width,
        layer,
      })
    }
    start = end + 1
  }
  return cylinders
}

function hitsCylinder(c: Cylinder, from: Point3, dx: number, dy: number, dz: number, near: number): boolean {
  const wx = from.x - c.x
  const wy = from.y - c.y
  const wz = from.z - c.z
  const wa = wx * c.ax + wy * c.ay + wz * c.az
  const da = dx * c.ax + dy * c.ay + dz * c.az
  let enter = near
  let leave = 1
  if (Math.abs(da) < 1e-12) {
    if (wa < c.from || wa > c.to) return false
  } else {
    const a = (c.from - wa) / da
    const b = (c.to - wa) / da
    enter = Math.max(enter, Math.min(a, b))
    leave = Math.min(leave, Math.max(a, b))
    if (enter > leave) return false
  }
  const ux = wx - wa * c.ax
  const uy = wy - wa * c.ay
  const uz = wz - wa * c.az
  const vx = dx - da * c.ax
  const vy = dy - da * c.ay
  const vz = dz - da * c.az
  const a = vx * vx + vy * vy + vz * vz
  const b = ux * vx + uy * vy + uz * vz
  const k = ux * ux + uy * uy + uz * uz - c.radius * c.radius
  if (a < 1e-12) return k <= 0
  const disc = b * b - a * k
  if (disc < 0) return false
  const root = Math.sqrt(disc)
  return Math.max(enter, (-b - root) / a) <= Math.min(leave, (-b + root) / a)
}

function hitsTriangle(t: Float32Array, tri: number, sides: number, from: Point3, dx: number, dy: number, dz: number, near: number): boolean {
  const o = tri * 9
  const ax = t[o]
  const ay = t[o + 1]
  const az = t[o + 2]
  const e1x = t[o + 3] - ax
  const e1y = t[o + 4] - ay
  const e1z = t[o + 5] - az
  const e2x = t[o + 6] - ax
  const e2y = t[o + 7] - ay
  const e2z = t[o + 8] - az
  const px = dy * e2z - dz * e2y
  const py = dz * e2x - dx * e2z
  const pz = dx * e2y - dy * e2x
  const det = e1x * px + e1y * py + e1z * pz
  if (sides === FRONT ? det > -1e-12 : sides === BACK ? det < 1e-12 : Math.abs(det) < 1e-12) return false
  const inverse = 1 / det
  const sx = from.x - ax
  const sy = from.y - ay
  const sz = from.z - az
  const u = (sx * px + sy * py + sz * pz) * inverse
  if (u < 0 || u > 1) return false
  const qx = sy * e1z - sz * e1y
  const qy = sz * e1x - sx * e1z
  const qz = sx * e1y - sy * e1x
  const v = (dx * qx + dy * qy + dz * qz) * inverse
  if (v < 0 || u + v > 1) return false
  const hit = (e2x * qx + e2y * qy + e2z * qz) * inverse
  return hit >= near && hit <= 1
}

function cellOf(value: number, origin: number, size: number, cells: number): number {
  return Math.min(cells - 1, Math.max(0, Math.floor((value - origin) / size)))
}

export function meshSight(root: THREE.Object3D, spinning: readonly SpinPart[] = [], roof: THREE.Object3D | null = null, rule: FadeRule = LANDMARK_FADE): Sight {
  return finish(bakeSight(root, spinning, roof, rule))
}

function triangleCount(mesh: THREE.Mesh): number {
  const index = mesh.geometry.getIndex()
  return Math.floor((index ? index.count : mesh.geometry.getAttribute('position').count) / 3)
}

function bakeTriangles(mesh: THREE.Mesh, flags: number, out: Float32Array, layers: Uint8Array, start: number): number {
  const position = mesh.geometry.getAttribute('position')
  const index = mesh.geometry.getIndex()
  const e = mesh.matrixWorld.elements
  const world = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15])
    world[i * 3] = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w
    world[i * 3 + 1] = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w
    world[i * 3 + 2] = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w
  }
  const mirrored = mesh.matrixWorld.determinant() < 0
  const count = index ? index.count : position.count
  const at = (i: number) => (index ? index.getX(i) : i)
  let tri = start
  for (let i = 0; i + 2 < count; i += 3) {
    const a = at(i)
    const b = at(mirrored ? i + 2 : i + 1)
    const c = at(mirrored ? i + 1 : i + 2)
    const o = tri * 9
    out[o] = world[a * 3]
    out[o + 1] = world[a * 3 + 1]
    out[o + 2] = world[a * 3 + 2]
    out[o + 3] = world[b * 3]
    out[o + 4] = world[b * 3 + 1]
    out[o + 5] = world[b * 3 + 2]
    out[o + 6] = world[c * 3]
    out[o + 7] = world[c * 3 + 1]
    out[o + 8] = world[c * 3 + 2]
    layers[tri] = flags
    tri += 1
  }
  return tri
}

export function* bakeSight(root: THREE.Object3D, spinning: readonly SpinPart[] = [], roof: THREE.Object3D | null = null, rule: FadeRule = LANDMARK_FADE): Steps<Sight> {
  root.updateWorldMatrix(true, true)
  const moving = spinning.map((part) => ({ part, meshes: [] as THREE.Mesh[], layer: roof && descends(part.node, roof) ? ROOF : SOLID }))
  const still: { mesh: THREE.Mesh; flags: number }[] = []
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || !shown(mesh, root)) return
    const mover = moving.find((entry) => descends(mesh, entry.part.node))
    if (mover) {
      mover.meshes.push(mesh)
      return
    }
    still.push({ mesh, flags: (roof && descends(mesh, roof) ? ROOF : SOLID) | facing(mesh) })
  })
  const total = still.reduce((sum, { mesh }) => sum + triangleCount(mesh), 0)
  const triangles = new Float32Array(total * 9)
  const layers = new Uint8Array(total)
  let written = 0
  for (const { mesh, flags } of still) {
    written = bakeTriangles(mesh, flags, triangles, layers, written)
    yield
  }
  const cylinders = moving.flatMap((entry) => sweep(entry.part, entry.meshes, entry.layer, rule.slices))
  yield
  return yield* gridSight(triangles, layers, cylinders, rule)
}

function* gridSight(triangles: Float32Array, layers: Uint8Array, cylinders: readonly Cylinder[], rule: FadeRule): Steps<Sight> {
  const count = layers.length
  const size = rule.cell
  const low = { x: Infinity, y: Infinity, z: Infinity }
  const high = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (let i = 0; i < triangles.length; i += 3) {
    low.x = Math.min(low.x, triangles[i])
    low.y = Math.min(low.y, triangles[i + 1])
    low.z = Math.min(low.z, triangles[i + 2])
    high.x = Math.max(high.x, triangles[i])
    high.y = Math.max(high.y, triangles[i + 1])
    high.z = Math.max(high.z, triangles[i + 2])
  }
  const nx = count > 0 ? Math.max(1, Math.ceil((high.x - low.x) / size)) : 0
  const ny = count > 0 ? Math.max(1, Math.ceil((high.y - low.y) / size)) : 0
  const nz = count > 0 ? Math.max(1, Math.ceil((high.z - low.z) / size)) : 0
  const starts = new Uint32Array(nx * ny * nz + 1)
  const eachCell = (tri: number, visit: (index: number) => void) => {
    const o = tri * 9
    const x0 = Math.min(triangles[o], triangles[o + 3], triangles[o + 6])
    const x1 = Math.max(triangles[o], triangles[o + 3], triangles[o + 6])
    const y0 = Math.min(triangles[o + 1], triangles[o + 4], triangles[o + 7])
    const y1 = Math.max(triangles[o + 1], triangles[o + 4], triangles[o + 7])
    const z0 = Math.min(triangles[o + 2], triangles[o + 5], triangles[o + 8])
    const z1 = Math.max(triangles[o + 2], triangles[o + 5], triangles[o + 8])
    const i1 = cellOf(x1, low.x, size, nx)
    const j1 = cellOf(y1, low.y, size, ny)
    const k1 = cellOf(z1, low.z, size, nz)
    for (let k = cellOf(z0, low.z, size, nz); k <= k1; k++) {
      for (let j = cellOf(y0, low.y, size, ny); j <= j1; j++) {
        for (let i = cellOf(x0, low.x, size, nx); i <= i1; i++) visit((k * ny + j) * nx + i)
      }
    }
  }
  yield
  for (let tri = 0; tri < count; tri++) {
    eachCell(tri, (index) => starts[index + 1]++)
    if (tri % SIGHT_STEP === SIGHT_STEP - 1) yield
  }
  for (let index = 1; index < starts.length; index++) starts[index] += starts[index - 1]
  const items = new Uint32Array(starts[starts.length - 1])
  const cursor = starts.slice(0, starts.length - 1)
  yield
  for (let tri = 0; tri < count; tri++) {
    eachCell(tri, (index) => (items[cursor[index]++] = tri))
    if (tri % SIGHT_STEP === SIGHT_STEP - 1) yield
  }

  const min = { ...low }
  const max = { ...high }
  for (const c of cylinders) {
    for (const [axis, along] of [['x', c.ax], ['y', c.ay], ['z', c.az]] as const) {
      const reach = c.radius * Math.sqrt(Math.max(0, 1 - along * along))
      const a = c[axis] + c.from * along
      const b = c[axis] + c.to * along
      min[axis] = Math.min(min[axis], a - reach, b - reach)
      max[axis] = Math.max(max[axis], a + reach, b + reach)
    }
  }
  const stamps = new Uint32Array(count)
  const empty = count === 0 && cylinders.length === 0
  let query = 0

  return {
    min,
    max,
    blocks(from, to, roof) {
      if (empty || !segmentHitsBounds(from, to, min, max)) return false
      const mask = roof ? SOLID | ROOF : SOLID
      const dx = to.x - from.x
      const dy = to.y - from.y
      const dz = to.z - from.z
      const length = Math.hypot(dx, dy, dz)
      if (length === 0) return false
      const near = rule.clearance / length
      for (const c of cylinders) if ((c.layer & mask) !== 0 && hitsCylinder(c, from, dx, dy, dz, near)) return true
      if (count === 0 || !segmentHitsBounds(from, to, low, high)) return false
      const start = Math.max(span.enter, near)
      const exit = span.leave
      if (start > exit) return false
      if (query === 0xffffffff) {
        stamps.fill(0)
        query = 0
      }
      query++
      let i = cellOf(from.x + dx * start, low.x, size, nx)
      let j = cellOf(from.y + dy * start, low.y, size, ny)
      let k = cellOf(from.z + dz * start, low.z, size, nz)
      const stepX = Math.sign(dx)
      const stepY = Math.sign(dy)
      const stepZ = Math.sign(dz)
      const deltaX = dx !== 0 ? size / Math.abs(dx) : Infinity
      const deltaY = dy !== 0 ? size / Math.abs(dy) : Infinity
      const deltaZ = dz !== 0 ? size / Math.abs(dz) : Infinity
      let nextX = dx > 0 ? (low.x + (i + 1) * size - from.x) / dx : dx < 0 ? (low.x + i * size - from.x) / dx : Infinity
      let nextY = dy > 0 ? (low.y + (j + 1) * size - from.y) / dy : dy < 0 ? (low.y + j * size - from.y) / dy : Infinity
      let nextZ = dz > 0 ? (low.z + (k + 1) * size - from.z) / dz : dz < 0 ? (low.z + k * size - from.z) / dz : Infinity
      for (;;) {
        const index = (k * ny + j) * nx + i
        for (let n = starts[index]; n < starts[index + 1]; n++) {
          const tri = items[n]
          if (stamps[tri] === query) continue
          stamps[tri] = query
          const flags = layers[tri]
          if ((flags & mask) !== 0 && hitsTriangle(triangles, tri, flags & (FRONT | BACK), from, dx, dy, dz, near)) return true
        }
        if (nextX <= nextY && nextX <= nextZ) {
          if (nextX > exit) return false
          i += stepX
          if (i < 0 || i >= nx) return false
          nextX += deltaX
        } else if (nextY <= nextZ) {
          if (nextY > exit) return false
          j += stepY
          if (j < 0 || j >= ny) return false
          nextY += deltaY
        } else {
          if (nextZ > exit) return false
          k += stepZ
          if (k < 0 || k >= nz) return false
          nextZ += deltaZ
        }
      }
    },
  }
}

export function hidesPlayer(sight: Sight, pos: Vec2, eye: Point3, roof: boolean, rule: FadeRule = LANDMARK_FADE): boolean {
  for (const [offset, height] of rule.probes) {
    probe.x = pos.x + offset
    probe.y = height
    probe.z = pos.y
    if (sight.blocks(probe, eye, roof)) return true
  }
  return false
}

export function fadeStep(current: number, hidden: boolean, dt: number, rule: FadeRule = LANDMARK_FADE): number {
  const target = hidden ? rule.opacity : 1
  const step = (Math.max(0, dt) * (1 - rule.opacity)) / rule.seconds
  return current < target ? Math.min(target, current + step) : Math.max(target, current - step)
}

export function freshFade(): FadeState {
  return { hidden: false, timer: 0, opacity: 1 }
}

export function settleFade(state: FadeState, blocked: boolean, dt: number, rule: FadeRule = LANDMARK_FADE): FadeState {
  if (blocked === state.hidden) state.timer = 0
  else {
    state.timer += Math.max(0, dt)
    if (state.timer >= (blocked ? rule.enterDelay : rule.leaveDelay) - 1e-9) {
      state.hidden = blocked
      state.timer = 0
    }
  }
  state.opacity = fadeStep(state.opacity, state.hidden, dt, rule)
  return state
}

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material]
}

function twinOf(mesh: THREE.Mesh, material: THREE.Material): THREE.Mesh {
  if (!(mesh instanceof THREE.InstancedMesh)) return new THREE.Mesh(mesh.geometry, material)
  const twin = new THREE.InstancedMesh(mesh.geometry, material, mesh.count)
  twin.instanceMatrix = mesh.instanceMatrix
  return twin
}

export function createFader(root: THREE.Object3D, materials: readonly THREE.Material[], rule: FadeRule = LANDMARK_FADE): Fader {
  const states: MaterialState[] = materials.map((material) => ({
    material,
    opacity: material.opacity,
    transparent: material.transparent,
    depthWrite: material.depthWrite,
    shadowSide: material.shadowSide,
  }))
  const parts: { object: THREE.Object3D; renderOrder: number }[] = []
  const meshes: THREE.Mesh[] = []
  root.traverse((object) => {
    parts.push({ object, renderOrder: object.renderOrder })
    if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh)
  })
  const depthMaterials = new Map<THREE.Side, THREE.MeshBasicMaterial>()
  const twins: THREE.Mesh[] = []
  let built = false
  let current = 1

  const depthMaterial = (side: THREE.Side) => {
    let material = depthMaterials.get(side)
    if (!material) {
      material = new THREE.MeshBasicMaterial({
        colorWrite: false,
        transparent: true,
        depthWrite: true,
        side,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      })
      depthMaterials.set(side, material)
    }
    return material
  }

  const build = () => {
    built = true
    for (const mesh of meshes) {
      const list = materialsOf(mesh)
      if (list.some((material) => material.transparent || material.alphaTest > 0)) continue
      const twin = twinOf(mesh, depthMaterial(list[0].side))
      twin.renderOrder = rule.depthOrder
      twin.visible = false
      mesh.add(twin)
      twins.push(twin)
    }
  }

  const enter = () => {
    if (!built) build()
    for (const { material } of states) {
      if (!material.transparent) {
        material.transparent = true
        material.needsUpdate = true
      }
      material.depthWrite = false
      material.shadowSide = material.side
    }
    for (const { object } of parts) object.renderOrder = rule.colorOrder
    for (const twin of twins) twin.visible = true
  }

  const restore = () => {
    for (const state of states) {
      const { material } = state
      material.opacity = state.opacity
      material.depthWrite = state.depthWrite
      material.shadowSide = state.shadowSide
      if (material.transparent !== state.transparent) {
        material.transparent = state.transparent
        material.needsUpdate = true
      }
    }
    for (const { object, renderOrder } of parts) object.renderOrder = renderOrder
    for (const twin of twins) twin.visible = false
  }

  return {
    get faded() {
      return current < 1
    },
    set(value) {
      const opacity = THREE.MathUtils.clamp(value, 0, 1)
      if (opacity === current) return
      const wasFaded = current < 1
      current = opacity
      if (opacity === 1) {
        restore()
        return
      }
      if (!wasFaded) enter()
      for (const state of states) state.material.opacity = state.opacity * opacity
    },
    dispose() {
      if (current < 1) restore()
      current = 1
      for (const twin of twins) twin.removeFromParent()
      twins.length = 0
      for (const material of depthMaterials.values()) material.dispose()
      depthMaterials.clear()
      built = false
    },
  }
}
