import * as THREE from 'three'
import { clamp } from '../sim/math'
import { GROUND_WEAPON } from './themes'

export const LID_OPEN_ANGLE = 1.92
export const LID_RATE = 10
export const CHEST_SPENT_GLOW = 0.2

export const CRATE_CENTER = 0.43
export const CRATE_WOBBLE = 0.08

export const DEBRIS_GRAVITY = 12
export const DEBRIS_SPEED = 3.2
export const DEBRIS_SETTLE = 0.45
export const DEBRIS_SINK_TIME = 0.6
export const DEBRIS_SINK_DEPTH = 0.7
export const DEBRIS_UPPER_LIFT = 0.6
export const DEBRIS_LOWER_LIFT = 0.4
export const DEBRIS_YAW_JITTER = 0.25
export const DEBRIS_MIN_REST = 0.05

export interface DebrisPiece {
  center: THREE.Vector3
  rest: number
}

export interface DebrisLaunch {
  start: THREE.Vector3
  velocity: THREE.Vector3
  axis: THREE.Vector3
  spin: number
  rest: number
}

export function propHash(a: number, b: number): number {
  const value = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return value - Math.floor(value)
}

export function groundWeaponScale(length: number): number {
  if (!(length > 0)) return GROUND_WEAPON.maxScale
  return clamp(GROUND_WEAPON.length / length, GROUND_WEAPON.minScale, GROUND_WEAPON.maxScale)
}

export function groundWeaponYaw(time: number, id: number): number {
  return Math.sin(time * GROUND_WEAPON.swingRate + id * 1.7) * GROUND_WEAPON.swing
}

export function lidOpen(elapsed: number): number {
  return elapsed > 0 ? 1 - Math.exp(-LID_RATE * elapsed) : 0
}

export function lidAngle(open: number): number {
  return LID_OPEN_ANGLE * clamp(open, 0, 1)
}

export function spentGlow(open: number): number {
  return 1 + (CHEST_SPENT_GLOW - 1) * clamp(open, 0, 1)
}

export function crateTurn(column: number, row: number): number {
  const quarter = Math.floor(propHash(column, row + 3) * 4) % 4
  return (quarter * Math.PI) / 2 + (propHash(column + 11, row) - 0.5) * 2 * CRATE_WOBBLE
}

export function debrisLaunches(pieces: readonly DebrisPiece[], seed: number): DebrisLaunch[] {
  return pieces.map((piece, i) => {
    const roll = (k: number) => propHash(seed + i * 13.7, k * 7.3)
    const flat = Math.hypot(piece.center.x, piece.center.z)
    const heading =
      (flat > 1e-6 ? Math.atan2(piece.center.z, piece.center.x) : roll(1) * Math.PI * 2) + (roll(2) - 0.5) * 2 * DEBRIS_YAW_JITTER
    const lift = piece.center.y > CRATE_CENTER ? DEBRIS_UPPER_LIFT : DEBRIS_LOWER_LIFT
    const direction = new THREE.Vector3(Math.cos(heading), lift, Math.sin(heading)).normalize()
    const speed = DEBRIS_SPEED * (0.85 + roll(3) * 0.3)
    const axis = new THREE.Vector3(roll(4) - 0.5, roll(5) - 0.5, roll(6) - 0.5)
    if (axis.lengthSq() < 1e-6) axis.set(0, 0, 1)
    return {
      start: piece.center.clone(),
      velocity: direction.multiplyScalar(speed),
      axis: axis.normalize(),
      spin: 5 + roll(7) * 6,
      rest: clamp(piece.rest, DEBRIS_MIN_REST, Math.max(DEBRIS_MIN_REST, piece.center.y)),
    }
  })
}

export function debrisLanding(launch: DebrisLaunch): number {
  const vy = launch.velocity.y
  const drop = Math.max(0, launch.start.y - launch.rest)
  return (vy + Math.sqrt(vy * vy + 2 * DEBRIS_GRAVITY * drop)) / DEBRIS_GRAVITY
}

export function debrisLife(launch: DebrisLaunch): number {
  return debrisLanding(launch) + DEBRIS_SETTLE + DEBRIS_SINK_TIME
}

export function debrisPose(launch: DebrisLaunch, t: number, position: THREE.Vector3, quaternion: THREE.Quaternion): boolean {
  const landing = debrisLanding(launch)
  const flight = clamp(t, 0, landing)
  position.copy(launch.start).addScaledVector(launch.velocity, flight)
  position.y = t >= landing ? launch.rest : position.y - 0.5 * DEBRIS_GRAVITY * flight * flight
  const sink = clamp((t - landing - DEBRIS_SETTLE) / DEBRIS_SINK_TIME, 0, 1)
  position.y -= sink * sink * DEBRIS_SINK_DEPTH
  quaternion.setFromAxisAngle(launch.axis, launch.spin * flight)
  return t < landing + DEBRIS_SETTLE + DEBRIS_SINK_TIME
}
