import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { bitScale, createDebris, stepBit, type Bit } from './boss-debris'
import { BOSS_DEFEAT } from './themes'

function bit(patch: Partial<Bit> = {}): Bit {
  return { x: 0, y: 2, z: 0, vx: 2, vy: 3, vz: -1, roll: 0, yaw: 0, tilt: 0.7, spin: 8, age: 0, life: 3, length: 0.4, width: 0.05, ...patch }
}

describe('boss debris', () => {
  it('falls, bounces lower each time and comes to rest lying flat on the ground', () => {
    const piece = bit()
    let bounces = 0
    let falling = false
    for (let i = 0; i < 600; i++) {
      const before = piece.vy
      stepBit(piece, 1 / 60)
      if (before < 0) falling = true
      if (falling && piece.vy > 0) {
        bounces++
        falling = false
      }
      expect(piece.y).toBeGreaterThanOrEqual(piece.width / 2 - 1e-9)
    }
    expect(bounces).toBeGreaterThanOrEqual(1)
    expect(piece.y).toBeCloseTo(piece.width / 2, 6)
    expect(piece.vy).toBe(0)
    expect(Math.hypot(piece.vx, piece.vz)).toBeLessThan(1e-3)
    expect(Math.abs(Math.sin(piece.tilt))).toBeLessThan(1e-3)
  })

  it('stands still while time is frozen and shrinks away at the end of its life', () => {
    const piece = bit()
    const copy = { ...piece }
    stepBit(piece, 0)
    expect(piece).toEqual(copy)
    expect(bitScale(bit({ age: 0 }))).toBe(1)
    expect(bitScale(bit({ age: 3 - BOSS_DEFEAT.shrink / 2 }))).toBeCloseTo(0.5, 6)
    expect(bitScale(bit({ age: 3 }))).toBe(0)
  })

  it('reuses its slots, fades and frees its own geometry and material', () => {
    const debris = createDebris(4)
    const parent = new THREE.Group()
    parent.add(debris.mesh)
    for (let i = 0; i < 6; i++) debris.emit({ x: 0, y: 1, z: 0, vx: 1, vy: 1, vz: 0, color: '#ffffff', length: 0.3, width: 0.05, life: 1 })
    expect(debris.mesh.count).toBe(4)
    expect(debris.live).toBe(4)
    debris.update(2)
    expect(debris.live).toBe(0)
    debris.fade(0.4)
    const material = debris.mesh.material as THREE.MeshStandardMaterial
    expect(material.transparent).toBe(true)
    expect(material.opacity).toBeCloseTo(0.4, 10)
    let freed = 0
    debris.mesh.geometry.addEventListener('dispose', () => freed++)
    material.addEventListener('dispose', () => freed++)
    debris.dispose()
    expect(freed).toBe(2)
    expect(parent.children).toHaveLength(0)
  })
})
