import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createDefaultTuning } from '../data/tuning'
import { createRowView, frustumRows, rowInstancedMesh, rowRange, rowStarts, sortRowItems, type RowItem } from './row-cull'

const COLUMNS = 40
const ROWS = 120

function gameCamera(x: number, z: number, extra = 0): THREE.PerspectiveCamera {
  const { pitch, distance, fov } = createDefaultTuning().camera
  const camera = new THREE.PerspectiveCamera(fov, 16 / 9, 0.1, 200)
  const angle = THREE.MathUtils.degToRad(pitch)
  camera.position.set(x, Math.sin(angle) * (distance + extra), z + Math.cos(angle) * (distance + extra))
  camera.lookAt(x, 0, z)
  camera.updateMatrixWorld()
  return camera
}

function frameOf(number: number): THREE.WebGLRenderer {
  return { info: { render: { frame: number } } } as unknown as THREE.WebGLRenderer
}

function frustumOf(camera: THREE.Camera): THREE.Frustum {
  return new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
}

function wallItems(): RowItem[] {
  const items: RowItem[] = []
  for (let row = 0; row < ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      if (column !== 0 && column !== COLUMNS - 1 && row % 30 !== 0) continue
      items.push({
        column,
        row,
        matrix: new THREE.Matrix4().makeTranslation(column + 0.5, 0, row + 0.5),
        color: new THREE.Color(column / COLUMNS, row / ROWS, 0.5),
      })
    }
  }
  return items.reverse()
}

function drawnRange(mesh: THREE.InstancedMesh): { from: number; to: number } {
  const from = (mesh.instanceMatrix as unknown as THREE.InterleavedBufferAttribute).offset / 16
  return { from, to: from + mesh.count }
}

describe('row windows', () => {
  it('covers every point of the slab the camera can see, and not much more', () => {
    for (const [x, z, extra] of [
      [20, 60, 0],
      [4, 10, 0],
      [36, 110, 5],
      [20, 2, 5],
    ] as const) {
      const camera = gameCamera(x, z, extra)
      const view = createRowView(ROWS)
      view.cover(-1.6, 2.5)
      view.update(frameOf(1), camera)
      const { first, last } = view.span
      const frustum = frustumOf(camera)
      const seen: number[] = []
      for (let row = 0; row < ROWS; row++) {
        for (let column = 0; column <= COLUMNS; column++) {
          for (const y of [-1.6, 0, 2.5]) {
            for (const dz of [0.01, 0.5, 0.99]) {
              if (frustum.containsPoint(new THREE.Vector3(column, y, row + dz))) seen.push(row)
            }
          }
        }
      }
      expect(seen.length).toBeGreaterThan(0)
      expect(first).toBeLessThanOrEqual(Math.min(...seen))
      expect(last).toBeGreaterThanOrEqual(Math.max(...seen))
      expect(last - first).toBeLessThan(Math.max(...seen) - Math.min(...seen) + 4)
    }
  })

  it('is empty when the slab is out of sight', () => {
    const corners = [
      [-1, 5, 3],
      [1, 5, 3],
      [-1, 6, 3],
      [1, 6, 3],
      [-1, 5, 9],
      [1, 5, 9],
      [-1, 6, 9],
      [1, 6, 9],
    ].map(([x, y, z]) => ({ x, y, z }))
    expect(frustumRows(corners, { minY: -1, maxY: 2 }, ROWS, { first: 0, last: 0 })).toEqual({ first: 0, last: -1 })
  })

  it('works out the camera once per frame however many meshes ask', () => {
    const view = createRowView(ROWS)
    view.cover(0, 1)
    const camera = gameCamera(20, 60)
    view.update(frameOf(7), camera)
    const before = { ...view.span }
    camera.position.z += 30
    camera.updateMatrixWorld()
    view.update(frameOf(7), camera)
    expect(view.span).toEqual(before)
    view.update(frameOf(8), camera)
    expect(view.span.first).toBeGreaterThan(before.first)
  })

  it('maps a row window onto the instances sorted by row', () => {
    const sorted = sortRowItems([
      { column: 3, row: 4 },
      { column: 1, row: 0 },
      { column: 0, row: 4 },
      { column: 2, row: 2 },
    ])
    expect(sorted.map((item) => [item.column, item.row])).toEqual([
      [1, 0],
      [2, 2],
      [0, 4],
      [3, 4],
    ])
    const starts = rowStarts(
      sorted.map((item) => item.row),
      6,
    )
    expect(Array.from(starts)).toEqual([0, 1, 1, 2, 2, 4, 4])
    expect(rowRange(starts, { first: 2, last: 3 }, 0, { first: 0, last: 0 })).toEqual({ first: 1, last: 2 })
    expect(rowRange(starts, { first: 2, last: 3 }, 1, { first: 0, last: 0 })).toEqual({ first: 1, last: 4 })
    expect(rowRange(starts, { first: 0, last: -1 }, 1, { first: 0, last: 0 })).toEqual({ first: 0, last: 0 })
  })
})

describe('row-culled instances', () => {
  it('draws one contiguous run that holds every instance the camera sees, with matching colours', () => {
    const items = sortRowItems(wallItems())
    const geometry = new THREE.BoxGeometry(1, 1.1, 1).translate(0, 0.55, 0)
    const view = createRowView(ROWS)
    const mesh = rowInstancedMesh(geometry, new THREE.MeshStandardMaterial(), items, view, ROWS)
    expect(mesh.count).toBe(items.length)
    expect(mesh.frustumCulled).toBe(false)
    expect(view.slab.maxY).toBeGreaterThan(1.1)
    if (!geometry.boundingSphere) geometry.computeBoundingSphere()
    let frame = 0
    for (const [x, z, extra] of [
      [20, 60, 0],
      [3, 30, 0],
      [37, 100, 5],
      [20, 1, 0],
    ] as const) {
      const camera = gameCamera(x, z, extra)
      frame += 1
      mesh.onBeforeRender(frameOf(frame), new THREE.Scene(), camera, geometry, mesh.material as THREE.Material, new THREE.Group())
      const { from, to } = drawnRange(mesh)
      const frustum = frustumOf(camera)
      const sphere = new THREE.Sphere()
      const visible = items.map((item) => frustum.intersectsSphere(sphere.copy(geometry.boundingSphere as THREE.Sphere).applyMatrix4(item.matrix)))
      expect(visible.some(Boolean)).toBe(true)
      visible.forEach((shown, index) => {
        if (shown) expect(index >= from && index < to).toBe(true)
      })
      expect(visible[from]).toBe(true)
      expect(visible[to - 1]).toBe(true)
      expect(to - from).toBeLessThan(items.length / 2)
      const colors = mesh.instanceColor as unknown as THREE.InterleavedBufferAttribute
      expect(colors.offset / 3).toBe(from)
      const matrix = new THREE.Matrix4().fromArray(mesh.instanceMatrix.array, from * 16)
      expect(matrix.elements[12]).toBeCloseTo(items[from].column + 0.5)
      expect(colors.data.array[from * 3]).toBeCloseTo(items[from].column / COLUMNS)
    }
  })

  it('draws nothing when no instance is in sight', () => {
    const items = sortRowItems(wallItems()).filter((item) => item.row < 10)
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const view = createRowView(ROWS)
    const mesh = rowInstancedMesh(geometry, new THREE.MeshStandardMaterial(), items, view, ROWS)
    mesh.onBeforeRender(frameOf(1), new THREE.Scene(), gameCamera(20, 100), geometry, mesh.material as THREE.Material, new THREE.Group())
    expect(mesh.count).toBe(0)
  })
})
