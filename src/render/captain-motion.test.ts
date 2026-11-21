import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { BOSSES } from '../data/bosses'
import { createDefaultTuning } from '../data/tuning'
import type { BossState } from '../sim/types'
import {
  bashPush,
  blenderTurn,
  captainDefeatSeconds,
  captainLegs,
  captainPose,
  captainShow,
  lyingSpot,
  lyingTurn,
  pickProgress,
  standSpot,
  standTurn,
} from './captain-motion'
import { CAPTAIN_DEFEAT, CAPTAIN_RIG } from './themes'

const DEF = BOSSES['shield-captain']
const WEAPONS = createDefaultTuning().weapons
const DEG = Math.PI / 180
const BOARD_NORMAL = new THREE.Vector3(0.966, 0, -0.259)
const BOARD_WIDTH = new THREE.Vector3(-0.259, 0, -0.966)

function state(patch: Partial<BossState> = {}): BossState {
  return {
    id: 'shield-captain',
    phase: 'walk',
    move: null,
    order: [],
    moveIndex: 0,
    timer: 1,
    volleysLeft: 0,
    chargeX: 1,
    chargeY: 0,
    chargeTraveled: 0,
    chargeHit: false,
    summoned: false,
    phaseIndex: 0,
    hazards: [],
    bladeTimer: 0,
    frenzyLeft: 0,
    balesLeft: 0,
    shotsLeft: 0,
    bombs: 0,
    rackTimer: 0,
    shield: { held: true, chargeImpact: null, x: 0, y: 0, facing: 0, lift: 0 },
    ...patch,
  }
}

describe('shield captain poses', () => {
  it('walks with the shield pushed a little forward so the left foot clears it', () => {
    const pose = captainPose(DEF, state(), WEAPONS)
    expect(pose.reach).toBeCloseTo(CAPTAIN_RIG.walkReach)
    expect(pose.reach).toBeGreaterThanOrEqual(10 * DEG)
    expect(pose.reach).toBeLessThanOrEqual(20 * DEG)
    expect(pose.run).toBe(0)
  })

  it('raises the shield to the front and leans in while the charge lane fills, then runs', () => {
    const total = DEF.charge.telegraph
    const early = captainPose(DEF, state({ phase: 'telegraph', move: 'charge', timer: total * 0.9 }), WEAPONS)
    const late = captainPose(DEF, state({ phase: 'telegraph', move: 'charge', timer: total * 0.05 }), WEAPONS)
    expect(late.reach).toBeGreaterThan(early.reach)
    expect(late.lean).toBeGreaterThan(early.lean)
    const run = captainPose(DEF, state({ phase: 'active', move: 'charge' }), WEAPONS)
    expect(run.reach).toBeCloseTo(CAPTAIN_RIG.chargeReach)
    expect(run.lean).toBeGreaterThan(0)
    expect(run.run).toBe(1)
  })

  it('pulls the shield in during the bash wind-up and shoves it out when the bash lands', () => {
    const windup = WEAPONS.captainBash.windup
    const wind = captainPose(DEF, state({ phase: 'telegraph', move: 'bash', timer: 0 }), WEAPONS)
    expect(wind.reach).toBeLessThan(CAPTAIN_RIG.walkReach)
    expect(wind.twist).toBeGreaterThan(0)
    expect(captainPose(DEF, state({ phase: 'telegraph', move: 'bash', timer: windup }), WEAPONS).twist).toBeCloseTo(0)
    const recover = DEF.bash?.recover ?? 0
    const shove = captainPose(DEF, state({ phase: 'recover', move: 'bash', timer: recover - CAPTAIN_RIG.bashSnap }), WEAPONS)
    expect(shove.reach).toBeCloseTo(CAPTAIN_RIG.bashPush)
    expect(shove.lunge).toBeCloseTo(CAPTAIN_RIG.bashLunge)
    expect(captainPose(DEF, state({ phase: 'recover', move: 'bash', timer: 0 }), WEAPONS).reach).toBeCloseTo(CAPTAIN_RIG.walkReach)
  })

  it('keeps the left arm inside the reach the model was checked for, never folding it inwards', () => {
    const phases: Partial<BossState>[] = [
      { phase: 'intro', timer: DEF.introTime / 2 },
      { phase: 'walk' },
      { phase: 'telegraph', move: 'charge', timer: 0 },
      { phase: 'active', move: 'charge' },
      { phase: 'recover', move: 'charge', timer: DEF.charge.recover },
      { phase: 'telegraph', move: 'bash', timer: 0 },
      { phase: 'recover', move: 'bash', timer: (DEF.bash?.recover ?? 0) - CAPTAIN_RIG.bashSnap },
      { phase: 'stunned' },
    ]
    for (const patch of phases) {
      const pose = captainPose(DEF, state(patch), WEAPONS)
      expect(pose.reach, patch.phase).toBeGreaterThanOrEqual(0)
      expect(pose.reach, patch.phase).toBeLessThanOrEqual(60 * DEG)
    }
  })

  it('slumps without the shield while stunned and bends down to pick it up afterwards', () => {
    const dropped = { held: false, chargeImpact: null, x: 1, y: 1, facing: 0, lift: 0 }
    const stunned = captainPose(DEF, state({ phase: 'stunned', shield: dropped }), WEAPONS)
    expect(stunned.bend).toBeGreaterThan(0)
    expect(stunned.reach).toBe(0)
    const pickup = DEF.guard?.pickup ?? 0
    const lifting = state({ phase: 'recover', move: 'charge', shield: { ...dropped, lift: pickup / 2 } })
    expect(pickProgress(DEF, lifting)).toBeCloseTo(0.5)
    expect(captainPose(DEF, lifting, WEAPONS).bend).toBeCloseTo(CAPTAIN_RIG.pickLean)
    expect(pickProgress(DEF, state({ phase: 'recover', move: 'charge' }))).toBe(0)
  })

  it('shoves fast, holds the shove, then eases back over the recovery', () => {
    expect(bashPush(-0.1, 0.8)).toBe(0)
    expect(bashPush(CAPTAIN_RIG.bashSnap, 0.8)).toBe(1)
    expect(bashPush(CAPTAIN_RIG.bashHold, 0.8)).toBe(1)
    expect(bashPush(0.5, 0.8)).toBeGreaterThan(0)
    expect(bashPush(0.5, 0.8)).toBeLessThan(1)
    expect(bashPush(0.8, 0.8)).toBeCloseTo(0)
  })
})

describe('shield captain legs', () => {
  const sweep = (run: number) =>
    Array.from({ length: 240 }, (_, i) => captainLegs({ phase: (i / 240) * Math.PI * 2, stride: 1 }, run))

  it('bends the left knee at least 25 degrees whenever the left leg swings more than 3 degrees forward', () => {
    for (const legs of sweep(0)) {
      if (legs.leftHip > 3 * DEG) expect(-legs.leftKnee).toBeGreaterThanOrEqual(Math.min(25 * DEG, legs.leftHip + 8 * DEG))
      if (legs.leftHip > 15 * DEG) expect(-legs.leftKnee).toBeGreaterThanOrEqual(25 * DEG)
    }
  })

  it('keeps the walk inside the swings the model allows: right leg 15 degrees forward, both legs 20 back', () => {
    for (const legs of sweep(0)) {
      expect(legs.rightHip).toBeLessThanOrEqual(15 * DEG)
      expect(legs.leftHip).toBeLessThanOrEqual(20 * DEG)
      expect(legs.rightHip).toBeGreaterThanOrEqual(-20 * DEG)
      expect(legs.leftHip).toBeGreaterThanOrEqual(-20 * DEG)
    }
  })

  it('bends both knees at least 15 degrees when either leg swings 20 degrees forward in the charge', () => {
    const legs = sweep(1)
    expect(Math.max(...legs.map((item) => item.leftHip))).toBeCloseTo(CAPTAIN_RIG.runHip, 2)
    for (const item of legs) {
      if (item.leftHip >= 19 * DEG) expect(-item.leftKnee).toBeGreaterThanOrEqual(15 * DEG)
      if (item.rightHip >= 19 * DEG) expect(-item.rightKnee).toBeGreaterThanOrEqual(15 * DEG)
    }
  })

  it('stands still when the stride has died down', () => {
    const legs = captainLegs({ phase: 1, stride: 0 }, 0)
    for (const angle of Object.values(legs)) expect(angle).toBeCloseTo(0, 9)
  })
})

describe('shield on the ground and the salute', () => {
  it('lays a dropped shield flat on its back, as wide as the board, top towards where the captain faced', () => {
    for (const facing of [0, 1.1, -2.4]) {
      const turn = lyingTurn(facing)
      expect(BOARD_NORMAL.clone().applyQuaternion(turn).y).toBeLessThan(-0.99)
      expect(Math.abs(BOARD_WIDTH.clone().applyQuaternion(turn).y)).toBeLessThan(0.01)
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(turn)
      expect(up.x).toBeCloseTo(Math.cos(facing))
      expect(up.z).toBeCloseTo(Math.sin(facing))
    }
  })

  it('centres the lying shield on its drop spot, nudged away from the captain', () => {
    const length = 1.8
    const spot = lyingSpot({ x: 5, y: 5, facing: 0 }, { x: 5, y: 6 }, length)
    expect(spot.y).toBeCloseTo(CAPTAIN_RIG.lieHeight)
    const middle = new THREE.Vector3(0, length / 2, 0).applyQuaternion(lyingTurn(0)).add(spot)
    expect(middle.x).toBeCloseTo(5)
    expect(middle.z).toBeLessThan(5)
    expect(5 - middle.z).toBeCloseTo(CAPTAIN_RIG.lieOut)
  })

  it('plants the shield upright in front of the captain, face out, square to where it faced', () => {
    for (const facing of [0, Math.PI / 2, 2]) {
      const spot = standSpot(facing)
      expect(spot.x * Math.cos(facing) + spot.z * Math.sin(facing)).toBeCloseTo(CAPTAIN_DEFEAT.standForward)
      const normal = BOARD_NORMAL.clone().applyQuaternion(standTurn(facing))
      expect(normal.x).toBeCloseTo(Math.cos(facing), 2)
      expect(normal.z).toBeCloseTo(Math.sin(facing), 2)
      expect(new THREE.Vector3(0, 1, 0).applyQuaternion(standTurn(facing)).y).toBeCloseTo(1)
    }
  })

  it('turns the Blender salute angles into the same rotation in glTF axes', () => {
    const blender = new THREE.Euler(-60 * DEG, -120 * DEG, 15 * DEG, 'ZYX')
    const fromBlender = new THREE.Quaternion().setFromEuler(blender)
    const swap = (v: THREE.Vector3) => new THREE.Vector3(v.x, v.z, -v.y)
    const unswap = (v: THREE.Vector3) => new THREE.Vector3(v.x, -v.z, v.y)
    const probe = new THREE.Vector3(0.3, -0.5, 0.8)
    const expected = swap(unswap(probe).applyQuaternion(fromBlender))
    expect(probe.clone().applyQuaternion(blenderTurn([-60 * DEG, -120 * DEG, 15 * DEG])).distanceTo(expected)).toBeLessThan(1e-6)
  })

  it('plants the shield and salutes during the lay time, falls during the fall time, then fades out', () => {
    const show = DEF.show
    expect(show).not.toBeNull()
    const lay = show?.lay ?? 0
    const fall = show?.fall ?? 0
    const early = captainShow(0.1, show)
    expect(early.plant).toBeGreaterThan(0)
    expect(early.angle).toBe(0)
    const saluting = captainShow(lay - 0.1, show)
    expect(saluting.plant).toBe(1)
    expect(saluting.salute).toBe(1)
    expect(saluting.angle).toBe(0)
    expect(saluting.light).toBe(1)
    const down = captainShow(lay + fall, show)
    expect(down.angle).toBeCloseTo(CAPTAIN_DEFEAT.fallAngle)
    expect(down.salute).toBeCloseTo(CAPTAIN_DEFEAT.saluteKept)
    const total = captainDefeatSeconds(show)
    expect(total).toBeCloseTo(lay + fall + CAPTAIN_DEFEAT.lie + CAPTAIN_DEFEAT.fade)
    expect(captainShow(total - CAPTAIN_DEFEAT.fade - 0.01, show).fade).toBe(1)
    expect(captainShow(total, show).fade).toBe(0)
  })
})
