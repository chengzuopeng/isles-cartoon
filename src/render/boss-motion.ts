import type { BossDef } from '../data/bosses'
import type { WeaponId } from '../data/weapons'
import type { BossState } from '../sim/types'
import { HARVESTER_DEFEAT, HARVESTER_RIG, SCARECROW_DEFEAT } from './themes'

export type Windups = Readonly<Record<WeaponId, { readonly windup: number }>>

export type ReelSpeeds = typeof HARVESTER_RIG.reel

export interface ScarecrowPose {
  lean: number
  back: number
  raise: number
  spread: number
  slump: number
}

const TAU = Math.PI * 2

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

export function smooth(t: number): number {
  const x = clamp01(t)
  return x * x * (3 - 2 * x)
}

export function easeOut(t: number): number {
  const x = clamp01(t)
  return 1 - (1 - x) * (1 - x)
}

export function elapsed(timer: number, total: number): number {
  return total > 0 ? clamp01(1 - timer / total) : 1
}

export function remaining(timer: number, total: number): number {
  return total > 0 ? clamp01(timer / total) : 0
}

export function approach(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * Math.max(0, dt))
}

export function riseThenSettle(current: number, target: number, rate: number, dt: number): number {
  return target >= current ? target : approach(current, target, rate, dt)
}

export function wrapAngle(angle: number): number {
  const wrapped = (((angle + Math.PI) % TAU) + TAU) % TAU
  return wrapped - Math.PI
}

function charging(state: BossState): boolean {
  return state.move === 'charge' || state.move === 'frenzy'
}

export function telegraphTotal(def: BossDef, state: BossState, weapons: Windups): number {
  switch (state.move) {
    case 'charge':
      return def.charge.telegraph
    case 'frenzy': {
      const frenzy = def.frenzy
      if (!frenzy) return def.charge.telegraph
      return state.frenzyLeft >= frenzy.charges ? frenzy.firstTelegraph : frenzy.telegraph
    }
    case 'slam':
      return weapons[def.slam?.weapon ?? 'strawSlam'].windup
    case 'fan':
      return weapons[def.fan?.weapon ?? 'strawFan'].windup
    case 'sweep':
      return weapons[def.sweep?.weapon ?? 'reaperSweep'].windup
    case 'spin':
      return weapons[def.spin?.weapon ?? 'bladeSpin'].windup
    case 'bales':
      return def.bales?.windup ?? 0
    case 'cannon':
      return def.cannon?.telegraph ?? 0
    case 'bash':
      return weapons[def.bash?.weapon ?? 'captainBash'].windup
    case 'triple':
      return def.triple?.telegraph ?? 0
    case 'mines':
      return def.mines?.windup ?? 0
    default:
      return 0
  }
}

export function recoverTotal(def: BossDef, state: BossState): number {
  switch (state.move) {
    case 'charge':
      return def.charge.recover
    case 'frenzy':
      return state.frenzyLeft > 0 ? (def.frenzy?.gap ?? def.charge.recover) : def.charge.recover
    case 'slam':
      return def.slam?.recover ?? 0
    case 'fan':
      return def.fan?.recover ?? 0
    case 'sweep':
      return def.sweep?.recover ?? 0
    case 'spin':
      return def.spin?.recover ?? 0
    case 'bales':
      return def.bales?.recover ?? 0
    case 'cannon':
      return def.cannon?.recover ?? 0
    case 'bash':
      return def.bash?.recover ?? 0
    case 'triple':
      return def.triple?.recover ?? 0
    case 'mines':
      return def.mines?.recover ?? 0
    default:
      return 0
  }
}

export function telegraphProgress(def: BossDef, state: BossState, weapons: Windups): number {
  return state.phase === 'telegraph' ? elapsed(state.timer, telegraphTotal(def, state, weapons)) : 0
}

export function scarecrowPose(def: BossDef, state: BossState, weapons: Windups, out: ScarecrowPose = blankPose()): ScarecrowPose {
  out.lean = 0
  out.back = 0
  out.raise = 0
  out.spread = 0
  out.slump = 0
  switch (state.phase) {
    case 'dormant':
      out.spread = 1
      break
    case 'intro':
      out.spread = 1 - smooth(elapsed(state.timer, def.introTime))
      break
    case 'telegraph': {
      const t = smooth(telegraphProgress(def, state, weapons))
      if (charging(state)) {
        out.lean = t
        out.back = t
      } else if (state.move === 'slam') {
        out.raise = t
        out.lean = -t
      } else if (state.move === 'fan') {
        out.spread = 0.7 * t
        out.lean = -0.6 * t
      }
      break
    }
    case 'active':
      if (charging(state)) {
        out.lean = 1
        out.back = 1
      } else if (state.move === 'fan') {
        out.spread = 0.7
        out.lean = -0.6
      }
      break
    case 'recover': {
      const k = smooth(remaining(state.timer, recoverTotal(def, state)))
      if (charging(state)) {
        out.lean = k
        out.back = k
      } else if (state.move === 'fan') {
        out.spread = 0.7 * k
        out.lean = -0.6 * k
      }
      break
    }
    case 'stunned':
      out.slump = 1
      break
    case 'shift':
      out.spread = 0.5
      break
    case 'walk':
      break
  }
  return out
}

export function blankPose(): ScarecrowPose {
  return { lean: 0, back: 0, raise: 0, spread: 0, slump: 0 }
}

export interface Gait {
  phase: number
  stride: number
}

export function stepGait(gait: Gait, dt: number, moving: boolean, rate: number, ease: number): Gait {
  gait.stride = approach(gait.stride, moving ? 1 : 0, ease, dt)
  gait.phase = (gait.phase + Math.max(0, dt) * rate) % TAU
  return gait
}

export function legBend(gait: Gait, side: number, swing: number, knee: number): readonly [number, number] {
  const step = Math.sin(gait.phase) * gait.stride
  return [step * swing * side, -Math.max(0, -step * side) * knee]
}

export function strideRate(speed: number, perMeter: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, speed * perMeter))
}

export function reelSpeed(def: BossDef, state: BossState, weapons: Windups, speeds: ReelSpeeds = HARVESTER_RIG.reel): number {
  const cruise = Math.min(speeds.max, speeds.walk + state.phaseIndex * speeds.phaseStep)
  let speed: number
  switch (state.phase) {
    case 'dormant':
      speed = speeds.idle
      break
    case 'intro':
      speed = speeds.idle + (speeds.intro - speeds.idle) * elapsed(state.timer, def.introTime)
      break
    case 'walk':
      speed = cruise
      break
    case 'telegraph': {
      const t = telegraphProgress(def, state, weapons)
      if (charging(state)) speed = cruise + (speeds.max - cruise) * t
      else if (state.move === 'bales') speed = speeds.bales
      else speed = speeds.windup + (speeds.max - speeds.windup) * t
      break
    }
    case 'active':
      speed = state.move === 'bales' ? speeds.bales : speeds.max
      break
    case 'recover':
      speed = Math.min(speeds.max, speeds.recover + state.phaseIndex * speeds.phaseStep)
      break
    case 'stunned':
      speed = speeds.stunned
      break
    case 'shift':
      speed = speeds.max
      break
  }
  return Math.min(speeds.max, Math.max(speeds.idle, speed))
}

export function forwardTravel(dx: number, dz: number, facing: number): number {
  return dx * Math.cos(facing) + dz * Math.sin(facing)
}

export function wheelTurn(distance: number, radius: number): number {
  return radius > 0 ? -distance / radius : 0
}

export function unloaderLift(def: BossDef, state: BossState): number {
  if (state.move !== 'bales') return 0
  switch (state.phase) {
    case 'telegraph':
      return easeOut(elapsed(state.timer, def.bales?.windup ?? 0))
    case 'active':
      return 1
    case 'recover':
      return smooth(remaining(state.timer, def.bales?.recover ?? 0))
    default:
      return 0
  }
}

export function unloaderYaw(angle: number, facing: number): number {
  return wrapAngle(facing - angle)
}

export function headerLift(def: BossDef, state: BossState, weapons: Windups): number {
  if (state.move !== 'sweep' && state.move !== 'spin') return state.phase === 'active' && charging(state) ? 0.4 : 0
  if (state.phase === 'telegraph') return smooth(telegraphProgress(def, state, weapons))
  if (state.phase === 'recover') return smooth(remaining(state.timer, recoverTotal(def, state)))
  return 0
}

export type HarvesterDefeat = typeof HARVESTER_DEFEAT

export type ScarecrowDefeat = typeof SCARECROW_DEFEAT

export interface Ejection {
  pitch: number
  yaw: number
  roof: number
  seat: number
  drift: number
  tumble: number
}

export interface Collapse {
  lean: number
  drop: number
  hip: number
  knee: number
  armOut: number
  armUp: number
  head: number
  roll: number
  eye: number
  sink: number
  fade: number
}

export function mix(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

export function span(t: number, start: number, end: number): number {
  if (end <= start) return t >= end ? 1 : 0
  return clamp01((t - start) / (end - start))
}

export function defeatTime(fallen: number, now: number, seconds: number): number | null {
  const since = now - fallen
  return since >= 0 && since < seconds ? since : null
}

export function passed(previous: number, now: number, at: number): boolean {
  return previous <= at && at < now
}

export function ticks(previous: number, now: number, start: number, end: number, gap: number): number {
  const from = Math.max(previous, start)
  const to = Math.min(now, end)
  if (gap <= 0 || to <= from) return 0
  return Math.ceil((to - start) / gap - 1e-9) - Math.ceil((from - start) / gap - 1e-9)
}

export function coastAngle(speed: number, t: number, stop: number): number {
  if (stop <= 0) return 0
  const x = Math.min(Math.max(0, t), stop)
  return speed * (x - (x * x) / (2 * stop))
}

export function arc(from: number, to: number, rise: number, s: number): number {
  const x = clamp01(s)
  return from + (to - from) * x + 4 * rise * x * (1 - x)
}

export function dragged(speed: number, drag: number, t: number): number {
  const x = Math.max(0, t)
  return drag > 0 ? (speed * (1 - Math.exp(-drag * x))) / drag : speed * x
}

export function landingTime(rise: number, gravity: number, drop: number): number {
  if (gravity <= 0) return Infinity
  return (rise + Math.sqrt(Math.max(0, rise * rise + 2 * gravity * Math.max(0, drop)))) / gravity
}

export function flicker(t: number, fade: number, rate: number): number {
  if (t >= fade) return 0
  const level = 1 - clamp01(t / fade)
  return Math.sin(t * rate) * Math.sin(t * rate * 0.37) > -0.2 ? level : level * 0.15
}

export function seatClearTime(D: HarvesterDefeat = HARVESTER_DEFEAT): number {
  return D.seatAccel > 0 ? Math.sqrt((2 * D.seatClear) / D.seatAccel) : 0
}

export function harvesterEjection(
  t: number,
  from: { readonly pitch: number; readonly yaw: number },
  D: HarvesterDefeat = HARVESTER_DEFEAT,
  out: Ejection = { pitch: 0, yaw: 0, roof: 0, seat: 0, drift: 0, tumble: 0 },
): Ejection {
  const raise = span(t, D.unloaderStart, D.unloaderEnd)
  out.pitch = mix(from.pitch, D.unloaderPitch, easeOut(raise))
  out.yaw = from.yaw * (1 - smooth(raise))
  out.roof = Math.max(0, t - D.roofPop) * D.roofSpeed
  const fired = t - D.seatFire
  const clear = seatClearTime(D)
  if (fired <= 0) {
    out.seat = 0
    out.drift = 0
    out.tumble = 0
  } else if (fired <= clear) {
    out.seat = 0.5 * D.seatAccel * fired * fired
    out.drift = 0
    out.tumble = 0
  } else {
    const u = fired - clear
    out.seat = D.seatClear + D.seatAccel * clear * u - 0.5 * D.seatBrake * u * u
    out.drift = D.seatDrift * u * u
    out.tumble = D.seatTumble * u * u
  }
  return out
}

export function blankCollapse(): Collapse {
  return { lean: 0, drop: 0, hip: 0, knee: 0, armOut: 0, armUp: 0, head: 0, roll: 0, eye: 1, sink: 0, fade: 1 }
}

export function scarecrowCollapse(t: number, from: number, F: ScarecrowDefeat = SCARECROW_DEFEAT, out: Collapse = blankCollapse()): Collapse {
  const recoil = easeOut(span(t, 0, F.recoil))
  const stagger = span(t, F.recoil, F.fall)
  const kneel = smooth(stagger)
  const falling = span(t, F.fall, F.fall + F.fallSeconds)
  const impact = F.fall + F.fallSeconds
  const settle = span(t, impact, impact + F.settle)
  const standing = mix(from, F.recoilLean, recoil) * (1 - 0.4 * kneel)
  const wobble = t > F.recoil ? F.wobble * Math.sin(F.wobbleRate * (t - F.recoil)) * (1 - stagger) : 0
  const tipped = F.recoilLean * 0.6
  if (t < F.fall) out.lean = standing + wobble
  else if (falling < 1) out.lean = mix(tipped, F.fallAngle, falling * falling)
  else out.lean = F.fallAngle - F.bounce * Math.sin(Math.PI * settle) * (1 - settle)
  const legs = kneel * (1 - 0.7 * smooth(falling))
  out.drop = -F.kneel * legs
  out.hip = F.hip * legs
  out.knee = -F.knee * legs
  out.armOut = mix(F.armOut * recoil, F.armOut * 1.2, smooth(falling))
  if (t < F.fall) out.armUp = F.armFling * recoil * (1 - 0.5 * kneel)
  else if (falling < 1) out.armUp = mix(F.armFling * 0.5, F.armFlail, smooth(falling))
  else out.armUp = mix(F.armFlail, F.armRest, smooth(settle))
  if (t < F.recoil) out.head = F.headSnap * recoil
  else if (t < F.fall) out.head = mix(F.headSnap, F.headDroop, smooth(stagger))
  else out.head = mix(F.headDroop, F.headSnap * 0.5, smooth(falling)) * (1 - 0.6 * settle)
  out.roll = F.headLoll * smooth(settle)
  out.eye = flicker(t, F.eyeFade, F.flicker)
  out.sink = F.sinkDepth * smooth(span(t, F.sinkStart, F.seconds))
  out.fade = 1 - smooth(span(t, F.sinkStart + 0.2, F.seconds))
  return out
}
