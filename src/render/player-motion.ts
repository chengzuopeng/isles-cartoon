import * as THREE from 'three'
import type { PlayerWeaponId } from '../data/weapons'
import { activeWeaponId } from '../sim/arsenal'
import type { Player } from '../sim/types'

export interface Gait {
  direction: 1 | -1
  twist: number
  relative: number
}

const HALF_TURN = Math.PI

function wrap(angle: number): number {
  let value = angle
  while (value > HALF_TURN) value -= HALF_TURN * 2
  while (value <= -HALF_TURN) value += HALF_TURN * 2
  return value
}

export function shownWeapon(player: Pick<Player, 'ultShots' | 'primary' | 'slot' | 'special'>): PlayerWeaponId {
  return player.ultShots > 0 ? player.primary : activeWeaponId(player as Player)
}

export function warheadLoaded(player: Pick<Player, 'burstWeapon' | 'cooldown'>, weapon: PlayerWeaponId, lead: number): boolean {
  return player.burstWeapon !== weapon || player.cooldown <= lead
}

export function ease(current: number, target: number, dt: number, rate: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * Math.max(0, dt)))
}

export function stepToward(current: number, target: number, dt: number, seconds: number): number {
  const step = seconds > 0 ? Math.max(0, dt) / seconds : Infinity
  return current < target ? Math.min(target, current + step) : Math.max(target, current - step)
}

export function addRecoil(recoil: number, kick: number, limit: number): number {
  return Math.min(limit, recoil + Math.max(0, kick))
}

export function settleRecoil(recoil: number, dt: number, rate: number): number {
  const next = recoil * Math.exp(-rate * Math.max(0, dt))
  return next < 1e-4 ? 0 : next
}

export interface Drum {
  angle: number
  target: number
}

export function advanceDrum(drum: Drum, step: number): void {
  drum.target += step
}

export function turnDrum(drum: Drum, dt: number, rate: number): void {
  drum.angle = ease(drum.angle, drum.target, dt, rate)
  const lap = HALF_TURN * 2
  if (drum.angle >= lap) {
    drum.angle -= lap
    drum.target -= lap
  }
}

export function gait(facing: number, dx: number, dy: number, maxTwist: number): Gait {
  if (dx * dx + dy * dy < 1e-10) return { direction: 1, twist: 0, relative: 0 }
  const relative = wrap(Math.atan2(dy, dx) - facing)
  const backward = Math.abs(relative) > HALF_TURN / 2
  const heading = backward ? wrap(relative - HALF_TURN) : relative
  return {
    direction: backward ? -1 : 1,
    twist: Math.max(-maxTwist, Math.min(maxTwist, heading)),
    relative,
  }
}

export function trailScarf(segments: number[], target: number, dt: number, rates: readonly number[]): void {
  for (let i = 0; i < segments.length; i++) {
    const lead = i === 0 ? target : segments[i - 1]
    segments[i] = ease(segments[i], lead, dt, rates[Math.min(i, rates.length - 1)])
  }
}

export interface DeathTiming {
  stagger: number
  buckleStart: number
  buckleEnd: number
  fallStart: number
  fallEnd: number
  settle: number
  pitch: number
  bounce: number
  roll: number
  slide: number
  sink: number
  flinch: number
  torso: number
  head: number
  thigh: number
  knee: number
  arm: number
  elbow: number
}

export interface DeathPose {
  pitch: number
  roll: number
  slide: number
  sink: number
  torso: number
  head: number
  thigh: number
  knee: number
  arm: number
  spread: number
  elbow: number
  landing: number
  landed: boolean
}

export interface DropTiming {
  gunHop: number
  gunBounce: number
  gravity: number
}

export interface GunDrop {
  height: number
  travel: number
  turn: number
  landed: boolean
}

function unit(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function smooth(value: number): number {
  const u = unit(value)
  return u * u * (3 - 2 * u)
}

function span(time: number, start: number, end: number): number {
  return end > start ? unit((time - start) / (end - start)) : time >= end ? 1 : 0
}

export function deathPose(elapsed: number, death: DeathTiming): DeathPose {
  const time = Math.max(0, elapsed)
  const flinch = time < death.stagger ? smooth(time / Math.max(1e-6, death.stagger)) : 1 - smooth(span(time, death.stagger, death.fallEnd))
  const buckle = smooth(span(time, death.buckleStart, death.buckleEnd))
  const fall = span(time, death.fallStart, death.fallEnd)
  const landing = smooth(fall)
  const rebound = time > death.fallEnd ? death.bounce * Math.sin(Math.PI * span(time, death.fallEnd, death.fallEnd + death.settle)) : 0
  const spread = smooth(span(time, 0.04, death.fallEnd))
  return {
    pitch: death.pitch * fall * fall - rebound,
    roll: death.roll * landing,
    slide: death.slide * smooth(span(time, 0, death.fallEnd)),
    sink: death.sink * buckle,
    torso: death.flinch * flinch * (1 - landing) + death.torso * landing,
    head: death.head * Math.max(flinch, landing),
    thigh: death.thigh * buckle * (1 - 0.35 * landing),
    knee: death.knee * buckle * (1 - 0.25 * landing),
    arm: death.arm * spread,
    spread,
    elbow: death.elbow * smooth(span(time, 0, death.fallStart)),
    landing,
    landed: time >= death.fallEnd,
  }
}

export function gunDrop(elapsed: number, start: number, rest: number, drop: DropTiming): GunDrop {
  const time = Math.max(0, elapsed)
  const { gunHop: hop, gravity } = drop
  const fall = Math.max(0, start - rest)
  const land = gravity > 0 ? (hop + Math.sqrt(hop * hop + 2 * gravity * fall)) / gravity : 0
  const rise = gravity > 0 ? Math.max(0, gravity * land - hop) * drop.gunBounce : 0
  const hopBack = gravity > 0 ? (2 * rise) / gravity : 0
  const settle = land + hopBack
  let height = rest
  if (time < land) height = start + hop * time - 0.5 * gravity * time * time
  else if (time < settle) height = rest + rise * (time - land) - 0.5 * gravity * (time - land) ** 2
  const reach = settle > 0 ? unit(time / settle) : 1
  return {
    height: Math.max(rest, height),
    travel: 1 - (1 - reach) * (1 - reach),
    turn: land > 0 ? smooth(time / land) : 1,
    landed: time >= land,
  }
}

const corner = new THREE.Vector3()

export function restHeight(bounds: THREE.Box3, turn: THREE.Quaternion, scale: THREE.Vector3): number {
  if (bounds.isEmpty()) return 0
  let lowest = Infinity
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? bounds.max.x : bounds.min.x, i & 2 ? bounds.max.y : bounds.min.y, i & 4 ? bounds.max.z : bounds.min.z)
    lowest = Math.min(lowest, corner.multiply(scale).applyQuaternion(turn).y)
  }
  return -lowest
}
