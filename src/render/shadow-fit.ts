import * as THREE from 'three'

export interface ShadowBox {
  left: number
  right: number
  bottom: number
  top: number
}

export interface ShadowRegion {
  box: ShadowBox
  outline: THREE.Vector2[]
}

export interface ShadowFit {
  low: number
  high: number
  margin: number
  step: number
  reach: number
}

export const SHADOW_FIT: ShadowFit = { low: -0.3, high: 2.2, margin: 0.75, step: 0.5, reach: 60 }

const CORNERS = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
] as const
const ORIGIN = new THREE.Vector3()
const eye = new THREE.Vector3()
const ray = new THREE.Vector3()
const point = new THREE.Vector3()
const normal = new THREE.Vector3()
const axisU = new THREE.Vector3()
const axisV = new THREE.Vector3()
const hits = Array.from({ length: 8 }, () => new THREE.Vector2())

export function shadowBasis(offset: THREE.Vector3, up: THREE.Vector3): THREE.Matrix4 {
  return new THREE.Matrix4().lookAt(offset, ORIGIN, up)
}

export function createShadowRegion(): ShadowRegion {
  return { box: { left: 0, right: 0, bottom: 0, top: 0 }, outline: [] }
}

export function fitShadow(camera: THREE.Camera, focus: THREE.Vector3, basis: THREE.Matrix4, fit: ShadowFit, out: ShadowRegion): ShadowRegion {
  axisU.setFromMatrixColumn(basis, 0)
  axisV.setFromMatrixColumn(basis, 1)
  eye.setFromMatrixPosition(camera.matrixWorld)
  let index = 0
  for (const [x, y] of CORNERS) {
    ray.set(x, y, 0.5).unproject(camera).sub(eye).normalize()
    for (const height of [fit.low, fit.high]) {
      const drop = eye.y - height
      const distance = ray.y < -1e-3 && drop > 0 ? Math.min(drop / -ray.y, fit.reach) : fit.reach
      point.copy(eye).addScaledVector(ray, distance).sub(focus)
      hits[index++].set(point.dot(axisU), point.dot(axisV))
    }
  }
  let minU = Infinity
  let maxU = -Infinity
  let minV = Infinity
  let maxV = -Infinity
  for (const hit of hits) {
    minU = Math.min(minU, hit.x)
    maxU = Math.max(maxU, hit.x)
    minV = Math.min(minV, hit.y)
    maxV = Math.max(maxV, hit.y)
  }
  out.box.left = Math.floor((minU - fit.margin) / fit.step) * fit.step
  out.box.right = Math.ceil((maxU + fit.margin) / fit.step) * fit.step
  out.box.bottom = Math.floor((minV - fit.margin) / fit.step) * fit.step
  out.box.top = Math.ceil((maxV + fit.margin) / fit.step) * fit.step
  out.outline = convexHull(hits)
  return out
}

export function convexHull(points: readonly THREE.Vector2[]): THREE.Vector2[] {
  const sorted = points.map((p) => p.clone()).sort((a, b) => a.x - b.x || a.y - b.y)
  if (sorted.length < 3) return sorted
  const turn = (o: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: THREE.Vector2[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-9) lower.pop()
    lower.push(p)
  }
  const upper: THREE.Vector2[] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]
    while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-9) upper.pop()
    upper.push(p)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

export function cullFrustum(outline: readonly THREE.Vector2[], basis: THREE.Matrix4, margin: number, frustum: THREE.Frustum): THREE.Frustum {
  axisU.setFromMatrixColumn(basis, 0)
  axisV.setFromMatrixColumn(basis, 1)
  const edges = outline
    .map((from, i) => ({ from, to: outline[(i + 1) % outline.length] }))
    .filter((edge) => edge.to.distanceToSquared(edge.from) > 1e-8)
    .sort((a, b) => b.to.distanceToSquared(b.from) - a.to.distanceToSquared(a.from))
    .slice(0, frustum.planes.length)
  if (edges.length < 3) {
    for (const plane of frustum.planes) plane.set(normal.set(0, 1, 0), Infinity)
    return frustum
  }
  frustum.planes.forEach((plane, i) => {
    const { from, to } = edges[i % edges.length]
    const length = to.distanceTo(from)
    normal
      .copy(axisU)
      .multiplyScalar(-(to.y - from.y) / length)
      .addScaledVector(axisV, (to.x - from.x) / length)
    point.copy(axisU).multiplyScalar(from.x).addScaledVector(axisV, from.y)
    plane.setFromNormalAndCoplanarPoint(normal, point)
    plane.constant += margin
  })
  return frustum
}

export function snapToTexel(focus: THREE.Vector3, basis: THREE.Matrix4, texelU: number, texelV: number, out: THREE.Vector3): THREE.Vector3 {
  axisU.setFromMatrixColumn(basis, 0)
  axisV.setFromMatrixColumn(basis, 1)
  const u = focus.dot(axisU)
  const v = focus.dot(axisV)
  return out
    .copy(focus)
    .addScaledVector(axisU, Math.round(u / texelU) * texelU - u)
    .addScaledVector(axisV, Math.round(v / texelV) * texelV - v)
}
