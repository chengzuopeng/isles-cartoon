import * as THREE from 'three'
import { clamp, lerp, type Vec2 } from '../sim/math'

export const ROCKET_ROLL_PER_METER = 1.4
export const ROCKET_TRAIL_SPACING = 0.45
export const GRENADE_SPIN = 12
export const BOMB_TURNS = 1
export const BOMB_SWAY = 0.35
export const BOMB_SWAY_RATE = 9
export const BALE_SPIN = 7
export const SPARK_RATE = 18

export const BLADE_FALL_SHARE = 0.35
export const BLADE_DROP_HEIGHT = 4.5
export const BLADE_FALL_SPIN = Math.PI * 2.5
export const BLADE_LAND_AMOUNT = 0.95
export const BLADE_STUCK_TIME = 0.8
export const BLADE_SINK_TIME = 0.4
export const BLADE_TILT = -Math.PI / 3
export const BLADE_LEAN = THREE.MathUtils.degToRad(-25)
export const BLADE_YAW_SPREAD = THREE.MathUtils.degToRad(35)
export const BLADE_BURY = 0.08

export const LAUNCH_SECONDS = 0.08
export const LAUNCH_LATE = 0.05
export const LAUNCH_KEEP = 0.7
export const LAUNCH_SURGE = 1
export const LOB_LAUNCH_SECONDS = 0.15

export interface LobPath {
  from: Vec2
  to: Vec2
  prev: Vec2
  pos: Vec2
  time: number
  total: number
  peak: number
}

export interface LobPose {
  height: number
  heading: number
  pitch: number
}

export interface Tumble {
  yaw: number
  roll: number
}

export interface LaunchBullet {
  pos: Vec2
  prev: Vec2
  dirX: number
  dirY: number
  speed: number
  traveled: number
}

export interface LaunchTrack {
  side: THREE.Vector3
  ahead: number
  dirX: number
  dirY: number
  since: number
  window: number
  reach: number
}

export interface BladeTrack {
  amount: number
  delay: number
  seenAt: number
}

export function hashUnit(a: number, b = 0): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x9e3779b9, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

export function lobProgress(lob: LobPath, alpha: number): number {
  const dx = lob.to.x - lob.from.x
  const dy = lob.to.y - lob.from.y
  const length = dx * dx + dy * dy
  if (length < 1e-8) return lob.total > 0 ? clamp(lob.time / lob.total, 0, 1) : 1
  const x = lerp(lob.prev.x, lob.pos.x, alpha) - lob.from.x
  const y = lerp(lob.prev.y, lob.pos.y, alpha) - lob.from.y
  return clamp((x * dx + y * dy) / length, 0, 1)
}

export function lobPose(lob: Pick<LobPath, 'from' | 'to' | 'peak'>, t: number, launch: number, rest: number): LobPose {
  const dx = lob.to.x - lob.from.x
  const dy = lob.to.y - lob.from.y
  const climb = 4 * lob.peak * (1 - 2 * t) - launch
  return {
    height: 4 * lob.peak * t * (1 - t) + launch * (1 - t) + rest,
    heading: Math.atan2(dy, dx),
    pitch: Math.atan2(climb, Math.hypot(dx, dy)),
  }
}

export function grenadeRoll(time: number): number {
  return GRENADE_SPIN * time
}

export function bombTumble(t: number, dx: number, time: number, id: number): Tumble {
  const side = Math.abs(dx) > 1e-6 ? Math.sign(dx) : hashUnit(id, 7) < 0.5 ? -1 : 1
  return {
    yaw: BOMB_SWAY * Math.sin(time * BOMB_SWAY_RATE + hashUnit(id, 3) * Math.PI * 2),
    roll: -side * BOMB_TURNS * Math.PI * 2 * t,
  }
}

export function baleTumble(dx: number, dy: number, time: number): Tumble {
  return { yaw: Math.atan2(dx, dy), roll: BALE_SPIN * time }
}

export function sparkFlicker(time: number, id: number): number {
  return 0.55 + 0.75 * hashUnit(Math.floor(time * SPARK_RATE), id)
}

export function bulletTraveled(traveled: number, prev: Vec2, pos: Vec2, alpha: number): number {
  return Math.max(0, traveled - (1 - alpha) * Math.hypot(pos.x - prev.x, pos.y - prev.y))
}

export function launchWindow(speed: number, ahead: number): number {
  if (speed <= 0 || ahead === 0) return LAUNCH_SECONDS
  const share = ahead > 0 ? 1 - LAUNCH_KEEP : LAUNCH_SURGE
  return Math.max(LAUNCH_SECONDS, (1.5 * Math.abs(ahead)) / (share * speed))
}

export function launchFade(age: number, window: number): number {
  if (window <= 0) return 0
  const u = clamp(age / window, 0, 1)
  return 1 - u * u * (3 - 2 * u)
}

export function trackLaunch(muzzle: THREE.Vector3, bullet: LaunchBullet, height: number, alpha: number, lead = 0): LaunchTrack | null {
  if (bullet.speed <= 0) return null
  const traveled = bulletTraveled(bullet.traveled, bullet.prev, bullet.pos, alpha)
  const since = traveled / bullet.speed
  if (since >= LAUNCH_LATE) return null
  const back = bullet.traveled - traveled + lead
  const offsetX = muzzle.x - (bullet.pos.x - bullet.dirX * back)
  const offsetY = muzzle.z - (bullet.pos.y - bullet.dirY * back)
  const ahead = offsetX * bullet.dirX + offsetY * bullet.dirY
  const side = new THREE.Vector3(offsetX - bullet.dirX * ahead, muzzle.y - height, offsetY - bullet.dirY * ahead)
  return { side, ahead, dirX: bullet.dirX, dirY: bullet.dirY, since, window: LAUNCH_SECONDS, reach: launchWindow(bullet.speed, ahead) }
}

export function launchShift(track: LaunchTrack, age: number, out: THREE.Vector3): THREE.Vector3 {
  const since = Math.max(0, age - track.since)
  const side = launchFade(since, track.window)
  const ahead = track.ahead * launchFade(since, track.reach)
  return out.set(track.side.x * side + track.dirX * ahead, track.side.y * side, track.side.z * side + track.dirY * ahead)
}

export function launchAt(track: LaunchTrack, bullet: LaunchBullet, alpha: number, height: number, out: THREE.Vector3): boolean {
  if (bullet.dirX !== track.dirX || bullet.dirY !== track.dirY || bullet.speed <= 0) return false
  const traveled = bulletTraveled(bullet.traveled, bullet.prev, bullet.pos, alpha)
  const age = traveled / bullet.speed
  if (age - track.since >= Math.max(track.window, track.reach)) return false
  const back = bullet.traveled - traveled
  launchShift(track, age, out)
  out.x += bullet.pos.x - bullet.dirX * back
  out.y += height
  out.z += bullet.pos.y - bullet.dirY * back
  return true
}

export function freshLob(t: number, total: number): boolean {
  return t * total < LOB_LAUNCH_SECONDS
}

export function bladeFall(amount: number): number | null {
  const start = 1 - BLADE_FALL_SHARE
  if (amount < start) return null
  return clamp((amount - start) / BLADE_FALL_SHARE, 0, 1)
}

export function bladeLift(fall: number): number {
  return BLADE_DROP_HEIGHT * (1 - fall * fall)
}

export function bladeSpin(fall: number): number {
  return BLADE_FALL_SPIN * (1 - fall)
}

export function bladeLanding(track: BladeTrack, now: number): number | null {
  const due = track.seenAt + Math.max(0, track.delay)
  if (track.amount >= BLADE_LAND_AMOUNT || now >= due - 1e-6) return due
  return null
}

export function bladeSink(now: number, landedAt: number): number | null {
  const age = now - landedAt
  if (age >= BLADE_STUCK_TIME + BLADE_SINK_TIME) return null
  return clamp((age - BLADE_STUCK_TIME) / BLADE_SINK_TIME, 0, 1)
}

export function bladeYaw(id: number): number {
  const side = hashUnit(id, 1) < 0.5 ? 0 : Math.PI
  return side + (hashUnit(id, 2) * 2 - 1) * BLADE_YAW_SPREAD
}

const LEAN_AXIS = new THREE.Vector3(1, 0, 0)
const YAW_AXIS = new THREE.Vector3(0, 1, 0)
const TILT_AXIS = new THREE.Vector3(0, 0, 1)
const yawTurn = new THREE.Quaternion()
const tiltTurn = new THREE.Quaternion()

export function bladeQuaternion(yaw: number, spin: number, out = new THREE.Quaternion()): THREE.Quaternion {
  out.setFromAxisAngle(LEAN_AXIS, BLADE_LEAN)
  out.multiply(yawTurn.setFromAxisAngle(YAW_AXIS, yaw))
  return out.multiply(tiltTurn.setFromAxisAngle(TILT_AXIS, BLADE_TILT + spin))
}

export function bladeAnchor(tip: THREE.Vector3, scale: number, rotation: THREE.Quaternion, x: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
  const offset = out.copy(tip).multiplyScalar(scale).applyQuaternion(rotation)
  return out.set(x - offset.x, -offset.y - BLADE_BURY, y - offset.z)
}
