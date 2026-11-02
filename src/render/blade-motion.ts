import { alongOf } from '../sim/blades'
import type { BladeLane } from '../sim/level'
import { clamp } from '../sim/math'
import type { BladePhase, BladeState } from '../sim/types'
import { wrapAngle } from './boss-motion'
import { BLADE_RIG } from './themes'

export interface LaneEdges {
  low: number
  high: number
  length: number
}

export interface WarningSpan {
  from: number
  to: number
  head: number
}

export interface BladeTurn {
  from: number
  delta: number
  start: number
}

export interface TurnPose {
  angle: number
  shift: number
  done: boolean
}

const REVERSAL = 1e-3

export function laneEdges(lane: BladeLane): LaneEdges {
  const low = lane.axis === 'x' ? lane.column : lane.row
  const length = lane.axis === 'x' ? lane.width : lane.depth
  return { low, high: low + length, length }
}

export function sweepDirection(lane: BladeLane, forward: boolean): number {
  const from = alongOf(lane, lane.from)
  const to = alongOf(lane, lane.to)
  return Math.sign(forward ? to - from : from - to)
}

export function warningSpan(lane: BladeLane, blade: Pick<BladeState, 'phase' | 'warning' | 'forward'>, along: number): WarningSpan | null {
  const { low, high, length } = laneEdges(lane)
  if (blade.phase === 'warning') {
    const fill = lane.warning > 0 ? clamp(1 - blade.warning / lane.warning, 0, 1) : 1
    if (fill <= 0) return null
    const reach = fill * length
    return along <= (low + high) / 2 ? { from: low, to: low + reach, head: low + reach } : { from: high - reach, to: high, head: high - reach }
  }
  if (blade.phase !== 'sweep') return null
  const direction = sweepDirection(lane, blade.forward)
  const front = clamp(along + direction * lane.reach, low, high)
  const span = direction > 0 ? { from: front, to: high, head: front } : { from: low, to: front, head: front }
  return span.to - span.from > 1e-6 ? span : null
}

export function normalizedSpan(lane: BladeLane, span: WarningSpan): WarningSpan {
  const { low, length } = laneEdges(lane)
  return { from: (span.from - low) / length, to: (span.to - low) / length, head: (span.head - low) / length }
}

export function turnDelta(from: number, to: number): number {
  const shortest = wrapAngle(to - from)
  if (Math.abs(Math.abs(shortest) - Math.PI) > REVERSAL) return shortest
  const plus = from + Math.PI / 2
  const minus = from - Math.PI / 2
  const southward = Math.sin(plus) - Math.sin(minus)
  if (Math.abs(southward) > REVERSAL) return southward > 0 ? Math.PI : -Math.PI
  return Math.cos(plus) >= Math.cos(minus) ? Math.PI : -Math.PI
}

export function turnShift(turned: number, reach: number, half: number): number {
  return Math.max(0, reach * Math.abs(Math.cos(turned)) + half * Math.abs(Math.sin(turned)) - reach)
}

export function turnPose(turn: BladeTurn, now: number, reach: number, half: number, seconds: number = BLADE_RIG.turnSeconds): TurnPose {
  const t = seconds > 0 ? clamp((now - turn.start) / seconds, 0, 1) : 1
  const eased = t * t * (3 - 2 * t)
  const turned = turn.delta * eased
  return { angle: turn.from + turned, shift: turnShift(turned, reach, half), done: t >= 1 }
}

export function reelSpeed(phase: BladePhase): number {
  return BLADE_RIG.reel[phase]
}

export function easeSpin(current: number, target: number, dt: number, rate: number = BLADE_RIG.reelEase): number {
  return target + (current - target) * Math.exp(-rate * Math.max(0, dt))
}

export function bladeShake(phase: BladePhase, time: number, seed: number): number {
  const amount = BLADE_RIG.shake[phase]
  if (amount <= 0) return 0
  const rate = BLADE_RIG.shakeRate
  return amount * Math.sin(time * rate + seed) * Math.sin(time * rate * 0.37 + seed * 1.7 + 1.3)
}

export function bladeYaw(angle: number): number {
  return -angle
}
