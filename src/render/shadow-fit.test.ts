import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { SHADOW_FIT, convexHull, createShadowRegion, cullFrustum, fitShadow, shadowBasis, snapToTexel } from './shadow-fit'

const SUN = new THREE.Vector3(-7, 22, 8)
const UP = new THREE.Vector3(0, 0, -1)
const basis = shadowBasis(SUN, UP)
const toSun = SUN.clone().normalize()
const axisU = new THREE.Vector3().setFromMatrixColumn(basis, 0)
const axisV = new THREE.Vector3().setFromMatrixColumn(basis, 1)

function view(aspect: number, distance: number, focus = new THREE.Vector3(20, 0, 40), pitch = 58, fov = 42) {
  const camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 200)
  const angle = THREE.MathUtils.degToRad(pitch)
  camera.position.set(focus.x, Math.sin(angle) * distance, focus.z + Math.cos(angle) * distance)
  camera.lookAt(focus)
  camera.updateMatrixWorld()
  return camera
}

function hit(camera: THREE.Camera, x: number, y: number, height: number): THREE.Vector3 {
  const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld)
  const ray = new THREE.Vector3(x, y, 0.5).unproject(camera).sub(eye).normalize()
  return eye.addScaledVector(ray, (height - eye.y) / ray.y)
}

function lightSpace(point: THREE.Vector3, focus: THREE.Vector3): THREE.Vector2 {
  const offset = point.clone().sub(focus)
  return new THREE.Vector2(offset.dot(axisU), offset.dot(axisV))
}

function cullFor(focus: THREE.Vector3, camera: THREE.Camera): THREE.Frustum {
  const region = fitShadow(camera, focus, basis, SHADOW_FIT, createShadowRegion())
  const frustum = cullFrustum(region.outline, basis, SHADOW_FIT.margin, new THREE.Frustum())
  for (const plane of frustum.planes) plane.translate(focus)
  return frustum
}

const SAMPLES = Array.from({ length: 11 }, (_, i) => -1 + i * 0.2)

describe('shadow fit', () => {
  it('covers every visible receiver with a box much smaller than the old 36 m square', () => {
    const focus = new THREE.Vector3(20, 0, 40)
    for (const aspect of [16 / 9, 4 / 3, 21 / 9]) {
      for (const distance of [17, 22]) {
        const camera = view(aspect, distance, focus)
        const { box } = fitShadow(camera, focus, basis, SHADOW_FIT, createShadowRegion())
        for (const x of SAMPLES) {
          for (const y of SAMPLES) {
            for (const height of [SHADOW_FIT.low, 0, 1.1, SHADOW_FIT.high]) {
              const p = lightSpace(hit(camera, x, y, height), focus)
              expect(p.x).toBeGreaterThan(box.left)
              expect(p.x).toBeLessThan(box.right)
              expect(p.y).toBeGreaterThan(box.bottom)
              expect(p.y).toBeLessThan(box.top)
            }
          }
        }
      }
    }
    const { box } = fitShadow(view(16 / 9, 17, focus), focus, basis, SHADOW_FIT, createShadowRegion())
    expect(box.right - box.left).toBeLessThan(33)
    expect(box.top - box.bottom).toBeLessThan(22)
  })

  it('keeps the box fixed while the camera follows the player', () => {
    const a = new THREE.Vector3(10, 0, 80)
    const b = new THREE.Vector3(13.37, 0, 61.2)
    const first = fitShadow(view(16 / 9, 17, a), a, basis, SHADOW_FIT, createShadowRegion())
    const second = fitShadow(view(16 / 9, 17, b), b, basis, SHADOW_FIT, createShadowRegion())
    expect(second.box).toEqual(first.box)
  })

  it('keeps casters whose shadows land on screen, including tall ones off screen', () => {
    const focus = new THREE.Vector3(20, 0, 40)
    for (const distance of [17, 22]) {
      const camera = view(16 / 9, distance, focus)
      const cull = cullFor(focus, camera)
      for (const x of SAMPLES) {
        for (const y of SAMPLES) {
          const ground = hit(camera, x, y, 0)
          for (const lift of [0, 1, 3, 6]) {
            const caster = ground.clone().addScaledVector(toSun, lift)
            expect(cull.intersectsSphere(new THREE.Sphere(caster, 0.01))).toBe(true)
          }
        }
      }
    }
  })

  it('culls casters whose shadows fall outside the view, even inside the shadow box', () => {
    const focus = new THREE.Vector3(20, 0, 40)
    const camera = view(16 / 9, 17, focus)
    const { box } = fitShadow(camera, focus, basis, SHADOW_FIT, createShadowRegion())
    const cull = cullFor(focus, camera)
    const corner = hit(camera, -1, -1, 0).add(new THREE.Vector3(-2.5, 0, 0.5))
    const p = lightSpace(corner, focus)
    expect(p.x).toBeGreaterThan(box.left)
    expect(p.y).toBeGreaterThan(box.bottom)
    for (const lift of [0, 1, 2]) {
      expect(cull.intersectsSphere(new THREE.Sphere(corner.clone().addScaledVector(toSun, lift), 0.3))).toBe(false)
    }
    const north = hit(camera, 0.6, 1, 0).add(new THREE.Vector3(0, 0, -3))
    expect(cull.intersectsSphere(new THREE.Sphere(north.clone().addScaledVector(toSun, 1), 0.3))).toBe(false)
  })

  it('snaps the light to whole shadow texels without tilting its rays', () => {
    const texelU = 32 / 2048
    const texelV = 20.5 / 1280
    const anchor = new THREE.Vector3()
    for (let i = 0; i < 20; i++) {
      const focus = new THREE.Vector3(20 + i * 0.0037, 0, 40 - i * 0.0051)
      snapToTexel(focus, basis, texelU, texelV, anchor)
      const u = anchor.dot(axisU) / texelU
      const v = anchor.dot(axisV) / texelV
      expect(Math.abs(u - Math.round(u))).toBeLessThan(1e-6)
      expect(Math.abs(v - Math.round(v))).toBeLessThan(1e-6)
      const shift = anchor.clone().sub(focus)
      expect(Math.abs(shift.dot(toSun))).toBeLessThan(1e-9)
      expect(Math.abs(shift.dot(axisU))).toBeLessThanOrEqual(texelU / 2 + 1e-9)
      expect(Math.abs(shift.dot(axisV))).toBeLessThanOrEqual(texelV / 2 + 1e-9)
    }
  })

  it('wraps points in a counter-clockwise hull', () => {
    const points = [
      [0, 0],
      [2, 0],
      [1, 1],
      [2, 2],
      [0, 2],
      [1, 0],
    ].map(([x, y]) => new THREE.Vector2(x, y))
    expect(convexHull(points).map((p) => p.toArray())).toEqual([
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ])
  })

  it('stops culling when the outline is degenerate', () => {
    const frustum = cullFrustum([new THREE.Vector2(1, 1)], basis, 0.5, new THREE.Frustum())
    expect(frustum.intersectsSphere(new THREE.Sphere(new THREE.Vector3(500, -40, 900), 0.1))).toBe(true)
  })
})
