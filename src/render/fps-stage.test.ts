import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { lookDirection, verticalFov } from './fps-stage'

describe('fps stage helpers', () => {
  it('turns a horizontal field of view into the camera vertical one', () => {
    expect(verticalFov(90, 16 / 9)).toBeCloseTo(58.72, 1)
    expect(verticalFov(90, 1)).toBeCloseTo(90, 5)
  })

  it('looks along the sim facing angle on the ground plane', () => {
    const out = new THREE.Vector3()
    lookDirection(0, 0, out)
    expect(out.x).toBeCloseTo(1)
    expect(out.z).toBeCloseTo(0)
    lookDirection(Math.PI / 2, 0, out)
    expect(out.z).toBeCloseTo(1)
    expect(out.x).toBeCloseTo(0)
  })

  it('tilts up with positive pitch and stays unit length', () => {
    const out = new THREE.Vector3()
    lookDirection(0.7, 0.4, out)
    expect(out.y).toBeCloseTo(Math.sin(0.4))
    expect(out.length()).toBeCloseTo(1)
  })
})
