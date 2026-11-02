import * as THREE from 'three'

export interface RowSpan {
  first: number
  last: number
}

export interface Slab {
  minY: number
  maxY: number
}

export interface Point3 {
  x: number
  y: number
  z: number
}

export interface RowView {
  readonly span: RowSpan
  readonly frustum: THREE.Frustum
  readonly slab: Slab
  cover(minY: number, maxY: number): void
  update(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void
}

export interface RowItem {
  column: number
  row: number
  matrix: THREE.Matrix4
  color: THREE.Color | null
}

const NDC_CORNERS: readonly (readonly [number, number, number])[] = [
  [-1, -1, -1],
  [1, -1, -1],
  [-1, 1, -1],
  [1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [-1, 1, 1],
  [1, 1, 1],
]

const FRUSTUM_EDGES: readonly (readonly [number, number])[] = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
]

export function frustumRows(corners: readonly Point3[], slab: Slab, rows: number, out: RowSpan): RowSpan {
  let low = Infinity
  let high = -Infinity
  const take = (z: number) => {
    if (z < low) low = z
    if (z > high) high = z
  }
  for (const corner of corners) if (corner.y >= slab.minY && corner.y <= slab.maxY) take(corner.z)
  for (const [a, b] of FRUSTUM_EDGES) {
    const from = corners[a]
    const to = corners[b]
    for (const height of [slab.minY, slab.maxY]) {
      if ((from.y - height) * (to.y - height) >= 0) continue
      take(from.z + ((to.z - from.z) * (height - from.y)) / (to.y - from.y))
    }
  }
  if (low > high || high < 0 || low > rows) {
    out.first = 0
    out.last = -1
    return out
  }
  out.first = Math.max(0, Math.floor(low))
  out.last = Math.min(rows - 1, Math.floor(high))
  return out
}

export function createRowView(rows: number): RowView {
  const frustum = new THREE.Frustum()
  const projection = new THREE.Matrix4()
  const corners = NDC_CORNERS.map(() => new THREE.Vector3())
  const span: RowSpan = { first: 0, last: -1 }
  const slab: Slab = { minY: Infinity, maxY: -Infinity }
  let frame = -1
  let seen: THREE.Camera | null = null
  return {
    span,
    frustum,
    slab,
    cover(minY, maxY) {
      slab.minY = Math.min(slab.minY, minY)
      slab.maxY = Math.max(slab.maxY, maxY)
      frame = -1
    },
    update(renderer, camera) {
      const now = renderer.info.render.frame
      if (now === frame && camera === seen) return
      frame = now
      seen = camera
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      frustum.setFromProjectionMatrix(projection, camera.coordinateSystem, camera.reversedDepth)
      NDC_CORNERS.forEach(([x, y, z], i) => corners[i].set(x, y, z).unproject(camera))
      frustumRows(corners, slab, rows, span)
    },
  }
}

export function rowStarts(sortedRows: ArrayLike<number>, rows: number): Int32Array {
  const starts = new Int32Array(rows + 1)
  let cursor = 0
  for (let row = 0; row <= rows; row++) {
    while (cursor < sortedRows.length && sortedRows[cursor] < row) cursor++
    starts[row] = cursor
  }
  return starts
}

export function rowRange(starts: Int32Array, span: RowSpan, margin: number, out: RowSpan): RowSpan {
  const rows = starts.length - 1
  if (span.first > span.last) {
    out.first = 0
    out.last = 0
    return out
  }
  out.first = starts[Math.max(0, Math.min(rows, span.first - margin))]
  out.last = starts[Math.max(0, Math.min(rows, span.last + margin + 1))]
  return out
}

export function sortRowItems<T extends { column: number; row: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.row - b.row || a.column - b.column)
}

function offsetViews(data: THREE.InstancedInterleavedBuffer, itemSize: number): (start: number) => THREE.InstancedBufferAttribute {
  const views = new Map<number, THREE.InstancedBufferAttribute>()
  return (start) => {
    let view = views.get(start)
    if (!view) {
      view = new THREE.InterleavedBufferAttribute(data, itemSize, start * itemSize) as unknown as THREE.InstancedBufferAttribute
      views.set(start, view)
    }
    return view
  }
}

export function rowInstancedMesh(geometry: THREE.BufferGeometry, material: THREE.Material, sorted: readonly RowItem[], view: RowView, rows: number): THREE.InstancedMesh {
  const count = sorted.length
  const mesh = new THREE.InstancedMesh(geometry, material, count)
  const matrices = new Float32Array(count * 16)
  const colors = sorted.every((item) => item.color !== null) && count > 0 ? new Float32Array(count * 3) : null
  sorted.forEach((item, index) => {
    item.matrix.toArray(matrices, index * 16)
    if (colors && item.color) item.color.toArray(colors, index * 3)
  })
  const matrixAt = offsetViews(new THREE.InstancedInterleavedBuffer(matrices, 16, 1), 16)
  const colorAt = colors ? offsetViews(new THREE.InstancedInterleavedBuffer(colors, 3, 1), 3) : null
  mesh.instanceMatrix = matrixAt(0)
  if (colorAt) mesh.instanceColor = colorAt(0)
  mesh.computeBoundingSphere()
  if (!geometry.boundingSphere) geometry.computeBoundingSphere()
  const local = geometry.boundingSphere ?? new THREE.Sphere()
  const spheres = new Float32Array(count * 4)
  const sphere = new THREE.Sphere()
  let reach = 0
  let minY = Infinity
  let maxY = -Infinity
  sorted.forEach((item, index) => {
    sphere.copy(local).applyMatrix4(item.matrix)
    spheres[index * 4] = sphere.center.x
    spheres[index * 4 + 1] = sphere.center.y
    spheres[index * 4 + 2] = sphere.center.z
    spheres[index * 4 + 3] = sphere.radius
    reach = Math.max(reach, sphere.radius + Math.abs(sphere.center.z - (item.row + 0.5)))
    minY = Math.min(minY, sphere.center.y - sphere.radius)
    maxY = Math.max(maxY, sphere.center.y + sphere.radius)
  })
  if (count > 0) view.cover(minY, maxY)
  const starts = rowStarts(
    sorted.map((item) => item.row),
    rows,
  )
  const margin = Math.ceil(reach)
  const range: RowSpan = { first: 0, last: 0 }
  const planes = view.frustum.planes
  const visible = (index: number) => {
    const at = index * 4
    const x = spheres[at]
    const y = spheres[at + 1]
    const z = spheres[at + 2]
    const reachOut = -spheres[at + 3]
    for (const plane of planes) {
      if (plane.normal.x * x + plane.normal.y * y + plane.normal.z * z + plane.constant < reachOut) return false
    }
    return true
  }
  mesh.frustumCulled = false
  mesh.onBeforeRender = (renderer, _scene, camera) => {
    view.update(renderer, camera)
    rowRange(starts, view.span, margin, range)
    let low = range.first
    let high = range.last
    while (low < high && !visible(low)) low++
    while (high > low && !visible(high - 1)) high--
    mesh.instanceMatrix = matrixAt(low)
    if (colorAt) mesh.instanceColor = colorAt(low)
    mesh.count = high - low
  }
  return mesh
}
