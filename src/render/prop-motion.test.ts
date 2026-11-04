import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  CHEST_SPENT_GLOW,
  CRATE_STACK,
  CRATE_WOBBLE,
  DEBRIS_MIN_REST,
  DEBRIS_SETTLE,
  DEBRIS_SINK_TIME,
  DEBRIS_YAW_JITTER,
  LID_OPEN_ANGLE,
  crateLayers,
  crateTurn,
  debrisLanding,
  debrisLaunches,
  debrisLife,
  debrisPose,
  groundWeaponScale,
  groundWeaponYaw,
  lidAngle,
  lidOpen,
  spentGlow,
  type DebrisPiece,
} from './prop-motion'
import { GROUND_WEAPON } from './themes'

const PIECES: DebrisPiece[] = [
  { center: new THREE.Vector3(0.261, 0.681, -0.062), rest: 0.14 },
  { center: new THREE.Vector3(-0.287, 0.669, 0.068), rest: 0.13 },
  { center: new THREE.Vector3(-0.08, 0.164, -0.269), rest: 0.14 },
  { center: new THREE.Vector3(0.245, 0.172, 0.25), rest: 0.15 },
  { center: new THREE.Vector3(-0.328, 0.147, 0.328), rest: 0.12 },
]

describe('ground weapon', () => {
  it('scales every weapon toward 0.9 m but keeps the clamp', () => {
    expect(groundWeaponScale(0.55) * 0.55).toBeCloseTo(GROUND_WEAPON.length)
    expect(groundWeaponScale(0.85)).toBe(GROUND_WEAPON.minScale)
    expect(groundWeaponScale(0.42)).toBe(GROUND_WEAPON.maxScale)
    expect(groundWeaponScale(0.85) * 0.85).toBeLessThan(1)
  })

  it('falls back to the largest scale for a degenerate length', () => {
    expect(groundWeaponScale(0)).toBe(GROUND_WEAPON.maxScale)
    expect(groundWeaponScale(Number.NaN)).toBe(GROUND_WEAPON.maxScale)
  })

  it('sways within ±30° so the barrel never points at the camera', () => {
    let low = 0
    let high = 0
    for (let t = 0; t < 20; t += 0.05) {
      const yaw = groundWeaponYaw(t, 7)
      low = Math.min(low, yaw)
      high = Math.max(high, yaw)
    }
    expect(high).toBeLessThanOrEqual(Math.PI / 6 + 1e-9)
    expect(low).toBeGreaterThanOrEqual(-Math.PI / 6 - 1e-9)
    expect(high - low).toBeGreaterThan(Math.PI / 4)
  })

  it('gives neighbouring pickups different phases', () => {
    expect(groundWeaponYaw(1, 3)).not.toBeCloseTo(groundWeaponYaw(1, 4))
  })
})

describe('chest lid', () => {
  it('stays shut until opened and then eases toward fully open', () => {
    expect(lidOpen(-1)).toBe(0)
    expect(lidOpen(0)).toBe(0)
    expect(lidOpen(0.1)).toBeGreaterThan(0.5)
    expect(lidOpen(0.2)).toBeGreaterThan(lidOpen(0.1))
    expect(lidOpen(Infinity)).toBe(1)
  })

  it('opens to about 110 degrees and never beyond', () => {
    expect(lidAngle(0)).toBe(0)
    expect(lidAngle(1)).toBeCloseTo(LID_OPEN_ANGLE)
    expect(THREE.MathUtils.radToDeg(lidAngle(1))).toBeCloseTo(110, 0)
    expect(lidAngle(2)).toBeCloseTo(LID_OPEN_ANGLE)
  })

  it('dims the glow as the lid opens', () => {
    expect(spentGlow(0)).toBe(1)
    expect(spentGlow(1)).toBeCloseTo(CHEST_SPENT_GLOW)
    expect(spentGlow(0.5)).toBeLessThan(1)
    expect(spentGlow(0.5)).toBeGreaterThan(CHEST_SPENT_GLOW)
  })

  it('opens the GLB lid front edge upward and backward with a positive Z turn', () => {
    const lid = new THREE.Object3D()
    lid.position.set(-0.285, 0.3715, 0)
    lid.rotation.z = lidAngle(1)
    lid.updateMatrixWorld()
    const front = new THREE.Vector3(0.57, 0, 0).applyMatrix4(lid.matrixWorld)
    expect(front.y).toBeGreaterThan(0.8)
    expect(front.x).toBeLessThan(-0.285)
  })
})

describe('crate layout', () => {
  it('turns each crate by a quarter turn plus a small wobble', () => {
    for (let column = 0; column < 12; column++) {
      for (let row = 0; row < 12; row++) {
        const turn = crateTurn(column, row)
        const quarter = Math.round(turn / (Math.PI / 2))
        expect(quarter).toBeGreaterThanOrEqual(0)
        expect(quarter).toBeLessThanOrEqual(3)
        expect(Math.abs(turn - (quarter * Math.PI) / 2)).toBeLessThanOrEqual(CRATE_WOBBLE + 1e-9)
      }
    }
  })

  it('uses every quarter turn across a field of crates', () => {
    const quarters = new Set<number>()
    for (let column = 0; column < 12; column++) quarters.add(Math.round(crateTurn(column, 5) / (Math.PI / 2)))
    expect(quarters.size).toBe(4)
  })

  it('is stable for the same cell', () => {
    expect(crateTurn(3, 9)).toBe(crateTurn(3, 9))
  })

  it('draws a one-metre crate as one box and a crate stack as two boxes reaching its full height', () => {
    expect(crateLayers(1)).toEqual([{ base: 0, size: CRATE_STACK.scale }])
    const stack = crateLayers(2.5)
    expect(stack.map((layer) => layer.base)).toEqual([0, 1.25])
    expect(stack.every((layer) => layer.size === 1.25)).toBe(true)
    const top = stack[stack.length - 1]
    expect(top.base + top.size).toBeCloseTo(2.5, 9)
  })
})

describe('crate debris', () => {
  const launches = debrisLaunches(PIECES, 42)

  it('throws every piece outward and upward from its own side of the crate', () => {
    launches.forEach((launch, i) => {
      const center = PIECES[i].center
      expect(launch.velocity.y).toBeGreaterThan(0)
      const outward = new THREE.Vector2(center.x, center.z).normalize()
      const flight = new THREE.Vector2(launch.velocity.x, launch.velocity.z).normalize()
      expect(outward.dot(flight)).toBeGreaterThanOrEqual(Math.cos(DEBRIS_YAW_JITTER) - 1e-9)
    })
  })

  it('lifts the upper pieces more steeply than the lower ones', () => {
    const steepness = launches.map((launch) => launch.velocity.y / Math.hypot(launch.velocity.x, launch.velocity.z))
    expect(Math.min(steepness[0], steepness[1])).toBeGreaterThan(Math.max(steepness[2], steepness[3], steepness[4]))
  })

  it('is deterministic per crate and different between crates', () => {
    expect(debrisLaunches(PIECES, 42)[0].velocity.toArray()).toEqual(launches[0].velocity.toArray())
    expect(debrisLaunches(PIECES, 43)[0].velocity.toArray()).not.toEqual(launches[0].velocity.toArray())
  })

  it('never rests below the minimum or above where the piece started', () => {
    const [launch] = debrisLaunches([{ center: new THREE.Vector3(0.3, 0.1, 0), rest: 0.4 }], 1)
    expect(launch.rest).toBeCloseTo(0.1)
    const [tiny] = debrisLaunches([{ center: new THREE.Vector3(0.3, 0.5, 0), rest: 0 }], 1)
    expect(tiny.rest).toBe(DEBRIS_MIN_REST)
  })

  it('starts in place, flies, lands on the ground, then sinks out of sight', () => {
    const launch = launches[0]
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    expect(debrisPose(launch, 0, position, quaternion)).toBe(true)
    expect(position.distanceTo(launch.start)).toBeCloseTo(0)
    expect(quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0)

    const landing = debrisLanding(launch)
    debrisPose(launch, landing / 2, position, quaternion)
    expect(position.y).toBeGreaterThan(launch.rest)
    expect(Math.hypot(position.x, position.z)).toBeGreaterThan(Math.hypot(launch.start.x, launch.start.z))

    debrisPose(launch, landing - 1e-4, position, quaternion)
    expect(position.y).toBeCloseTo(launch.rest, 2)
    const landed = position.clone()
    const spun = quaternion.clone()
    debrisPose(launch, landing + DEBRIS_SETTLE * 0.5, position, quaternion)
    expect(position.distanceTo(landed)).toBeCloseTo(0, 2)
    expect(quaternion.angleTo(spun)).toBeCloseTo(0, 2)

    expect(debrisPose(launch, landing + DEBRIS_SETTLE + DEBRIS_SINK_TIME * 0.99, position, quaternion)).toBe(true)
    expect(position.y).toBeLessThan(0)
    expect(debrisPose(launch, debrisLife(launch), position, quaternion)).toBe(false)
  })

  it('lands every piece within a couple of metres of the crate', () => {
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    for (const launch of launches) {
      debrisPose(launch, debrisLanding(launch), position, quaternion)
      const distance = Math.hypot(position.x, position.z)
      expect(distance).toBeGreaterThan(0.5)
      expect(distance).toBeLessThan(2.5)
      expect(debrisLife(launch)).toBeLessThan(2)
    }
  })
})
