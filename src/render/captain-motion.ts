import * as THREE from 'three'
import type { BossDef, DefeatShow } from '../data/bosses'
import type { BossState } from '../sim/types'
import { clamp01, elapsed, mix, remaining, smooth, span, type Gait, type Windups } from './boss-motion'
import { CAPTAIN_DEFEAT, CAPTAIN_RIG } from './themes'

export type CaptainRig = typeof CAPTAIN_RIG

export type CaptainDefeat = typeof CAPTAIN_DEFEAT

export interface CaptainPose {
  reach: number
  lean: number
  bend: number
  twist: number
  lunge: number
  crouch: number
  run: number
}

export interface CaptainLegs {
  leftHip: number
  leftKnee: number
  rightHip: number
  rightKnee: number
}

export interface CaptainShow {
  plant: number
  salute: number
  angle: number
  light: number
  fade: number
}

export const POSE_KEYS = ['reach', 'lean', 'bend', 'twist', 'lunge', 'crouch', 'run'] as const

const X_AXIS = new THREE.Vector3(1, 0, 0)
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const Z_AXIS = new THREE.Vector3(0, 0, 1)
const part = new THREE.Quaternion()

export function blankCaptainPose(): CaptainPose {
  return { reach: 0, lean: 0, bend: 0, twist: 0, lunge: 0, crouch: 0, run: 0 }
}

export function bashPush(since: number, recover: number, rig: CaptainRig = CAPTAIN_RIG): number {
  if (since < 0) return 0
  if (since < rig.bashSnap) return smooth(since / rig.bashSnap)
  if (since < rig.bashHold || recover <= rig.bashHold) return 1
  return 1 - smooth((since - rig.bashHold) / (recover - rig.bashHold))
}

export function pickProgress(def: BossDef, state: BossState): number {
  const shield = state.shield
  const pickup = def.guard?.pickup ?? 0
  if (!shield || shield.held || state.phase !== 'recover' || pickup <= 0) return 0
  return clamp01(1 - shield.lift / pickup)
}

export function captainPose(def: BossDef, state: BossState, weapons: Windups, rig: CaptainRig = CAPTAIN_RIG, out: CaptainPose = blankCaptainPose()): CaptainPose {
  for (const key of POSE_KEYS) out[key] = 0
  const held = state.shield?.held ?? true
  switch (state.phase) {
    case 'dormant':
      return out
    case 'intro': {
      const k = elapsed(state.timer, def.introTime)
      out.reach = rig.walkReach * k + rig.introReach * Math.sin(Math.PI * k)
      return out
    }
    case 'walk':
      out.reach = rig.walkReach
      return out
    case 'telegraph': {
      if (state.move === 'charge') {
        const p = smooth(elapsed(state.timer, def.charge.telegraph))
        out.reach = mix(rig.walkReach, rig.chargeReach, p)
        out.lean = rig.braceLean * p
        out.crouch = rig.crouch * p
        return out
      }
      if (state.move === 'bash' && def.bash) {
        const p = smooth(elapsed(state.timer, weapons[def.bash.weapon].windup))
        out.reach = mix(rig.walkReach, rig.bashWind, p)
        out.twist = rig.bashTwist * p
        out.crouch = rig.crouch * 0.6 * p
        return out
      }
      out.reach = rig.walkReach
      return out
    }
    case 'active':
      if (state.move === 'charge') {
        out.reach = rig.chargeReach
        out.lean = rig.chargeLean
        out.run = 1
        return out
      }
      out.reach = rig.walkReach
      return out
    case 'recover': {
      if (!held) {
        const p = pickProgress(def, state)
        const bump = Math.sin(Math.PI * p)
        out.bend = rig.pickLean * bump
        out.reach = rig.pickReach * bump
        out.crouch = rig.crouch * bump
        return out
      }
      if (state.move === 'bash' && def.bash) {
        const push = bashPush(def.bash.recover - state.timer, def.bash.recover, rig)
        out.reach = mix(rig.walkReach, rig.bashPush, push)
        out.twist = -rig.bashTwist * push
        out.lunge = rig.bashLunge * push
        out.lean = rig.bashLean * push
        return out
      }
      if (state.move === 'charge') {
        const k = remaining(state.timer, def.charge.recover)
        out.reach = mix(rig.walkReach, rig.recoverReach, k)
        out.lean = rig.chargeLean * 0.5 * k
        return out
      }
      out.reach = rig.walkReach
      return out
    }
    case 'stunned':
      out.bend = held ? 0 : rig.stunSlump
      out.reach = held ? rig.walkReach : 0
      return out
    case 'shift':
      out.reach = rig.walkReach
      return out
  }
}

export function captainLegs(gait: Gait, run: number, rig: CaptainRig = CAPTAIN_RIG, out: CaptainLegs = { leftHip: 0, leftKnee: 0, rightHip: 0, rightKnee: 0 }): CaptainLegs {
  const step = Math.sin(gait.phase) * gait.stride
  const r = clamp01(run)
  out.leftHip = step >= 0 ? step * mix(rig.leftForward, rig.runHip, r) : step * mix(rig.hipBack, rig.runHip, r)
  out.rightHip = step <= 0 ? -step * mix(rig.hipForward, rig.runHip, r) : -step * mix(rig.hipBack, rig.runHip, r)
  const leftLift = rig.leftLift * smooth(out.leftHip / rig.leftRamp) + rig.leftKnee * out.leftHip
  out.leftKnee = out.leftHip > 0 ? -Math.max(mix(leftLift, rig.runKnee * out.leftHip, r), leftLift) : rig.kneeBack * out.leftHip
  out.rightKnee = out.rightHip > 0 ? -rig.runKnee * out.rightHip * r : rig.kneeBack * out.rightHip
  return out
}

export function blenderTurn(euler: readonly [number, number, number] | readonly number[], out: THREE.Quaternion = new THREE.Quaternion()): THREE.Quaternion {
  const [x, y, z] = euler
  out.setFromAxisAngle(Y_AXIS, z)
  out.multiply(part.setFromAxisAngle(Z_AXIS, -y))
  out.multiply(part.setFromAxisAngle(X_AXIS, x))
  return out
}

export function lyingTurn(facing: number, rig: CaptainRig = CAPTAIN_RIG, out: THREE.Quaternion = new THREE.Quaternion()): THREE.Quaternion {
  out.setFromAxisAngle(Y_AXIS, -facing)
  out.multiply(part.setFromAxisAngle(Z_AXIS, -Math.PI / 2))
  out.multiply(part.setFromAxisAngle(Y_AXIS, rig.lieTurn))
  return out
}

export function lyingSpot(
  drop: { x: number; y: number; facing: number },
  from: { x: number; y: number },
  length: number,
  rig: CaptainRig = CAPTAIN_RIG,
  out: THREE.Vector3 = new THREE.Vector3(),
): THREE.Vector3 {
  const { x, y, facing } = drop
  const sideX = Math.sin(facing)
  const sideY = -Math.cos(facing)
  const away = Math.sign((x - from.x) * sideX + (y - from.y) * sideY) || 1
  return out.set(
    x - Math.cos(facing) * length * 0.5 + sideX * away * rig.lieOut,
    rig.lieHeight,
    y - Math.sin(facing) * length * 0.5 + sideY * away * rig.lieOut,
  )
}

export function standSpot(facing: number, defeat: CaptainDefeat = CAPTAIN_DEFEAT, out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
  const forwardX = Math.cos(facing)
  const forwardZ = Math.sin(facing)
  return out.set(forwardX * defeat.standForward + forwardZ * defeat.standSide, 0, forwardZ * defeat.standForward - forwardX * defeat.standSide)
}

export function standTurn(facing: number, defeat: CaptainDefeat = CAPTAIN_DEFEAT, out: THREE.Quaternion = new THREE.Quaternion()): THREE.Quaternion {
  return out.setFromAxisAngle(Y_AXIS, -facing + defeat.standTurn)
}

export function captainDefeatSeconds(show: DefeatShow | null, defeat: CaptainDefeat = CAPTAIN_DEFEAT): number {
  return (show?.lay ?? 0) + (show?.fall ?? 1) + defeat.lie + defeat.fade
}

export function captainShow(time: number, show: DefeatShow | null, defeat: CaptainDefeat = CAPTAIN_DEFEAT, out?: CaptainShow): CaptainShow {
  const result = out ?? { plant: 0, salute: 0, angle: 0, light: 1, fade: 1 }
  const lay = show?.lay ?? 0
  const fall = show?.fall ?? 1
  result.plant = smooth(span(time, 0, Math.min(defeat.plant, Math.max(lay, 0.01))))
  const lower = smooth(span(time, lay, lay + fall * 0.7)) * (1 - defeat.saluteKept)
  result.salute = smooth(span(time, defeat.raiseStart, defeat.raiseStart + defeat.raise)) * (1 - lower)
  const drop = span(time, lay, lay + fall)
  const after = Math.max(0, time - lay - fall)
  const settle = drop >= 1 ? defeat.bounce * Math.abs(Math.sin(after * 9)) * Math.exp(-after * 5) : 0
  result.angle = defeat.fallAngle * drop * drop - settle
  result.light = time < lay ? 1 : Math.max(0, 1 - span(time, lay, lay + defeat.eyeFade))
  const total = captainDefeatSeconds(show, defeat)
  result.fade = 1 - smooth(span(time, total - defeat.fade, total))
  return result
}
