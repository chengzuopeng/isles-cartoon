import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { clipGeometry, isClipBox, type ClipBox } from './clip-geometry'

const AXES: ClipBox['axes'] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]

function triangles(geometry: THREE.BufferGeometry): number {
  return (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3
}

describe('clip geometry', () => {
  it('drops the triangles whose centre lies inside the box and keeps the rest', () => {
    const inner = new THREE.BoxGeometry(0.2, 0.2, 0.2)
    const outer = new THREE.BoxGeometry(0.2, 0.2, 0.2).translate(1, 0, 0)
    const merged = new THREE.BufferGeometry()
    const positions = [...inner.toNonIndexed().getAttribute('position').array, ...outer.toNonIndexed().getAttribute('position').array]
    merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    const clipped = clipGeometry(merged, { center: [0, 0, 0], axes: AXES, half: [0.15, 0.15, 0.15] })
    expect(triangles(merged)).toBe(24)
    expect(triangles(clipped)).toBe(12)
  })

  it('measures the half sizes along the box axes in order', () => {
    const bar = new THREE.BoxGeometry(1, 0.1, 0.1)
    const sideways: ClipBox['axes'] = [
      [0, 1, 0],
      [1, 0, 0],
      [0, 0, 1],
    ]
    expect(triangles(clipGeometry(bar, { center: [0, 0, 0], axes: sideways, half: [0.06, 0.6, 0.06] }))).toBe(0)
    expect(triangles(clipGeometry(bar, { center: [0, 0, 0], axes: sideways, half: [0.6, 0.06, 0.06] }))).toBeGreaterThan(0)
  })

  it('leaves the source geometry untouched', () => {
    const box = new THREE.BoxGeometry(0.2, 0.2, 0.2)
    clipGeometry(box, { center: [0, 0, 0], axes: AXES, half: [1, 1, 1] })
    expect(triangles(box)).toBe(12)
  })

  it('recognises clip boxes stored in node extras', () => {
    expect(isClipBox({ center: [0, 0, 0], axes: AXES, half: [1, 1, 1] })).toBe(true)
    expect(isClipBox(undefined)).toBe(false)
    expect(isClipBox({ center: [0, 0, 0] })).toBe(false)
  })
})
