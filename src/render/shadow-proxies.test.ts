import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { describe, expect, it } from 'vitest'
import {
  boxGeometry,
  boxProfile,
  isShadowOnly,
  latheGeometry,
  latheProfile,
  mergeProxies,
  pointsOf,
  proxyGeometry,
  shadowOnly,
} from './shadow-proxies'
import { castProxies } from './stage'
import { SHADOW_LAYER, SHADOW_PROXY } from './themes'

function cylinder(radius: number, bottom: number, top: number, slices = 24, stacks = 8): Float32Array {
  const points: number[] = []
  for (let j = 0; j <= stacks; j++) {
    for (let i = 0; i < slices; i++) {
      const angle = (i / slices) * Math.PI * 2
      points.push(Math.cos(angle) * radius, bottom + ((top - bottom) * j) / stacks, Math.sin(angle) * radius)
    }
  }
  return Float32Array.from(points)
}

function cone(radius: number, height: number, slices = 24, stacks = 12): Float32Array {
  const points: number[] = []
  for (let j = 0; j <= stacks; j++) {
    const y = (height * j) / stacks
    for (let i = 0; i < slices; i++) {
      const angle = (i / slices) * Math.PI * 2
      const r = radius * (1 - j / stacks)
      points.push(Math.cos(angle) * r, y, Math.sin(angle) * r)
    }
  }
  return Float32Array.from(points)
}

function signedVolume(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  let volume = 0
  const count = index ? index.count : position.count
  for (let i = 0; i < count; i += 3) {
    const at = (k: number) => (index ? index.getX(i + k) : i + k)
    a.fromBufferAttribute(position, at(0))
    b.fromBufferAttribute(position, at(1))
    c.fromBufferAttribute(position, at(2))
    volume += a.dot(b.clone().cross(c)) / 6
  }
  return volume
}

function openEdges(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex()
  if (!index) return -1
  const edges = new Map<string, number>()
  for (let i = 0; i < index.count; i += 3) {
    const tri = [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
    for (let k = 0; k < 3; k++) {
      const [from, to] = [tri[k], tri[(k + 1) % 3]]
      const key = from < to ? `${from}-${to}` : `${to}-${from}`
      edges.set(key, (edges.get(key) ?? 0) + 1)
    }
  }
  return [...edges.values()].filter((uses) => uses !== 2).length
}

describe('shadow proxy shapes', () => {
  it('reads the radius of a round part ring by ring', () => {
    const profile = latheProfile(cylinder(0.5, 0.2, 2.2))
    expect(profile).not.toBeNull()
    expect(profile?.bottom).toBeCloseTo(0.2)
    expect(profile?.top).toBeCloseTo(2.2)
    expect(profile?.rings).toHaveLength(SHADOW_PROXY.rings)
    for (const ring of profile?.rings ?? []) expect(ring.radius).toBeCloseTo(0.5, 2)
  })

  it('narrows the rings of a cone towards its tip', () => {
    const radii = latheProfile(cone(0.6, 2))?.rings.map((ring) => ring.radius) ?? []
    expect(radii).toHaveLength(SHADOW_PROXY.rings)
    for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeLessThan(radii[i - 1])
    expect(radii[0]).toBeLessThanOrEqual(0.6 + 1e-6)
  })

  it('turns a profile into a closed low-poly solid whose faces point outwards', () => {
    const profile = latheProfile(cylinder(0.5, 0, 2))
    if (!profile) throw new Error('no profile')
    const geometry = latheGeometry(profile)
    const triangles = (geometry.getIndex()?.count ?? 0) / 3
    expect(triangles).toBe(2 * SHADOW_PROXY.segments * (profile.rings.length + 1))
    expect(openEdges(geometry)).toBe(0)
    expect(signedVolume(geometry)).toBeGreaterThan(0)
    expect(geometry.getAttribute('normal')).toBeDefined()
    geometry.computeBoundingBox()
    expect(geometry.boundingBox?.min.y).toBeCloseTo(0)
    expect(geometry.boundingBox?.max.y).toBeCloseTo(2)
  })

  it('caps a block at the height most of its top sits at, not at its highest spike', () => {
    const points = [...cylinder(0.01, 0, 1, 4, 1)]
    for (let x = -0.5; x <= 0.5; x += 0.1) for (let z = -0.5; z <= 0.5; z += 0.1) points.push(x, 1, z, x, 0, z)
    points.push(0, 1.4, 0)
    const profile = boxProfile(Float32Array.from(points))
    expect(profile?.min[0]).toBeCloseTo(-0.5)
    expect(profile?.max[2]).toBeCloseTo(0.5)
    expect(profile?.max[1]).toBeGreaterThan(1)
    expect(profile?.max[1]).toBeLessThan(1.1)
    if (!profile) throw new Error('no profile')
    const box = boxGeometry(profile)
    expect(box.getIndex()?.count).toBe(36)
    expect(Object.keys(box.attributes).sort()).toEqual(['normal', 'position'])
    expect(signedVolume(box)).toBeGreaterThan(0)
  })

  it('builds one lathe around all parts of a model, or one box around them', () => {
    const trunk = new THREE.CylinderGeometry(0.15, 0.2, 1, 8, 8).translate(0, 0.5, 0)
    const crown = new THREE.SphereGeometry(0.6, 12, 8).translate(0, 1.6, 0)
    const lathe = proxyGeometry([trunk, crown], 'lathe')
    expect(lathe?.getIndex()?.count).toBe(3 * 2 * SHADOW_PROXY.segments * (SHADOW_PROXY.rings + 1))
    lathe?.computeBoundingBox()
    expect(lathe?.boundingBox?.min.y).toBeCloseTo(0, 2)
    expect(lathe?.boundingBox?.max.y).toBeCloseTo(2.2, 2)
    expect(lathe?.boundingBox?.max.x).toBeLessThanOrEqual(0.6 + 1e-6)
    const box = proxyGeometry([trunk, crown], 'box')
    box?.computeBoundingBox()
    expect(box?.boundingBox?.min.x).toBeCloseTo(-0.6, 2)
    expect(box?.boundingBox?.max.x).toBeCloseTo(0.6, 2)
    expect(proxyGeometry([], 'box')).toBeNull()
  })

  it('bakes placed proxies into one block in world space', () => {
    const shape = boxGeometry({ min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] })
    const merged = mergeProxies([
      { geometry: shape, matrix: new THREE.Matrix4().makeTranslation(3.5, 0, 2.5) },
      { geometry: shape, matrix: new THREE.Matrix4().makeTranslation(5.5, 0, 2.5) },
    ])
    expect(merged?.getAttribute('position').count).toBe(shape.getAttribute('position').count * 2)
    merged?.computeBoundingBox()
    expect(merged?.boundingBox?.min.x).toBeCloseTo(3)
    expect(merged?.boundingBox?.max.x).toBeCloseTo(6)
    expect(merged?.boundingSphere?.center.x).toBeCloseTo(4.5)
    expect(Array.from(pointsOf(shape)).slice(0, 3)).toEqual(Array.from(shape.getAttribute('position').array).slice(0, 3))
    expect(mergeProxies([])).toBeNull()
  })

  it('bakes exactly what cloning, moving and merging the proxies one by one gave', () => {
    const lathe = proxyGeometry([new THREE.CylinderGeometry(0.4, 0.6, 2, 9).translate(0, 1, 0)], 'lathe') as THREE.BufferGeometry
    const box = boxGeometry({ min: [-0.5, 0, -0.4], max: [0.5, 1.1, 0.4] })
    const place = (x: number, z: number, yaw: number, size: number) =>
      new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(size, size, size))
    const items = [
      { geometry: lathe, matrix: place(3.5, 2.5, 0.7, 0.93) },
      { geometry: box, matrix: place(5.5, 2.5, Math.PI / 2, 1) },
      { geometry: lathe, matrix: place(7.5, 9.5, 2.1, 1.07) },
    ]
    const placed = items.map(({ geometry, matrix }) => geometry.clone().applyMatrix4(matrix))
    const expected = mergeGeometries(placed, false) as THREE.BufferGeometry
    const merged = mergeProxies(items) as THREE.BufferGeometry
    for (const name of ['position', 'normal']) expect(Array.from(merged.getAttribute(name).array)).toEqual(Array.from(expected.getAttribute(name).array))
    expect(Array.from(merged.getIndex()?.array ?? [])).toEqual(Array.from(expected.getIndex()?.array ?? []))
    expect(Object.keys(merged.attributes).sort()).toEqual(Object.keys(expected.attributes).sort())
    const one = mergeProxies([items[0]]) as THREE.BufferGeometry
    expect(Array.from(one.getAttribute('position').array)).toEqual(Array.from(placed[0].getAttribute('position').array))
  })
})

describe('shadow-only meshes', () => {
  it('live on the shadow layer alone and cast without receiving', () => {
    const mesh = shadowOnly(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()))
    expect(isShadowOnly(mesh)).toBe(true)
    expect(mesh.layers.isEnabled(SHADOW_LAYER)).toBe(true)
    expect(mesh.castShadow).toBe(true)
    expect(mesh.receiveShadow).toBe(false)
    expect(isShadowOnly(new THREE.Mesh())).toBe(false)
  })

  it('are seen by the camera only while the shadow map is drawn', () => {
    const camera = new THREE.PerspectiveCamera()
    const seen: boolean[] = []
    const shadowMap = {
      render(_lights: THREE.Light[], _scene: THREE.Object3D, viewer: THREE.Camera) {
        seen.push(viewer.layers.isEnabled(SHADOW_LAYER), viewer.layers.isEnabled(0))
      },
    } as unknown as THREE.WebGLShadowMap
    castProxies(shadowMap)
    shadowMap.render([], new THREE.Scene(), camera)
    expect(seen).toEqual([true, true])
    expect(camera.layers.isEnabled(SHADOW_LAYER)).toBe(false)
    expect(camera.layers.isEnabled(0)).toBe(true)
  })
})
