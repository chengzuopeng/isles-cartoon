import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  addRecoil,
  advanceDrum,
  deathPose,
  ease,
  gait,
  gunDrop,
  restHeight,
  settleRecoil,
  shownWeapon,
  stepToward,
  trailScarf,
  turnDrum,
  warheadLoaded,
  type Drum,
} from './player-motion'
import { KAI_DEATH } from './themes'

const TWIST = Math.PI / 3

describe('player motion', () => {
  it('shows the primary weapon while the ultimate is firing, otherwise the active slot', () => {
    expect(shownWeapon({ ultShots: 0, primary: 'blaster', slot: 'special', special: 'sniper' })).toBe('sniper')
    expect(shownWeapon({ ultShots: 3, primary: 'blaster', slot: 'special', special: 'sniper' })).toBe('blaster')
    expect(shownWeapon({ ultShots: 0, primary: 'blaster', slot: 'primary', special: 'sniper' })).toBe('blaster')
    expect(shownWeapon({ ultShots: 0, primary: 'blaster', slot: 'special', special: null })).toBe('blaster')
  })

  it('hides the rocket warhead only while that rocket is reloading', () => {
    expect(warheadLoaded({ burstWeapon: 'rocket', cooldown: 1.2 }, 'rocket', 0.3)).toBe(false)
    expect(warheadLoaded({ burstWeapon: 'rocket', cooldown: 0.3 }, 'rocket', 0.3)).toBe(true)
    expect(warheadLoaded({ burstWeapon: 'rocket', cooldown: 0 }, 'rocket', 0.3)).toBe(true)
    expect(warheadLoaded({ burstWeapon: 'blaster', cooldown: 1.2 }, 'rocket', 0.3)).toBe(true)
  })

  it('eases toward a target without overshooting and ignores negative time', () => {
    const half = ease(0, 1, Math.log(2) / 10, 10)
    expect(half).toBeCloseTo(0.5, 6)
    expect(ease(0.2, 1, 100, 10)).toBeCloseTo(1, 6)
    expect(ease(0.2, 1, -1, 10)).toBe(0.2)
    expect(ease(0.2, 1, Infinity, 10)).toBe(1)
  })

  it('steps linearly so the petals open in the given time', () => {
    let open = 0
    for (let i = 0; i < 6; i++) open = stepToward(open, 1, 0.02, 0.12)
    expect(open).toBeCloseTo(1, 6)
    expect(stepToward(0.5, 1, 0.03, 0.12)).toBeCloseTo(0.75, 6)
    expect(stepToward(1, 0, 0.06, 0.12)).toBeCloseTo(0.5, 6)
    expect(stepToward(0.9, 1, 1, 0.12)).toBe(1)
    expect(stepToward(0.1, 0, 1, 0.12)).toBe(0)
  })

  it('accumulates recoil up to a limit and settles back to rest', () => {
    let recoil = 0
    for (let i = 0; i < 5; i++) recoil = addRecoil(recoil, 0.02, 0.06)
    expect(recoil).toBeCloseTo(0.06, 6)
    expect(addRecoil(0.01, 0.02, 0.06)).toBeCloseTo(0.03, 6)
    expect(addRecoil(0.01, -1, 0.06)).toBeCloseTo(0.01, 6)
    const settled = settleRecoil(0.06, 0.05, 16)
    expect(settled).toBeLessThan(0.06)
    expect(settled).toBeGreaterThan(0)
    expect(settleRecoil(0.06, 2, 16)).toBe(0)
  })

  it('turns the drum one rib per shot and keeps the angle bounded', () => {
    const drum: Drum = { angle: 0, target: 0 }
    const rib = Math.PI / 4
    advanceDrum(drum, rib)
    expect(drum.target).toBeCloseTo(rib, 6)
    turnDrum(drum, 0.01, 28)
    expect(drum.angle).toBeGreaterThan(0)
    expect(drum.angle).toBeLessThan(rib)
    turnDrum(drum, 1, 28)
    expect(drum.angle).toBeCloseTo(rib, 6)
    for (let i = 0; i < 20; i++) {
      advanceDrum(drum, rib)
      turnDrum(drum, 1, 28)
    }
    expect(drum.target).toBeLessThan(Math.PI * 2 + rib)
    expect(drum.angle).toBeCloseTo(drum.target, 6)
    expect(((drum.target / rib) % 1 + 1) % 1).toBeCloseTo(0, 6)
  })

  it('walks forward, backward and sideways relative to the aim', () => {
    const still = gait(0, 0, 0, TWIST)
    expect(still).toEqual({ direction: 1, twist: 0, relative: 0 })
    const ahead = gait(0, 1, 0, TWIST)
    expect(ahead.direction).toBe(1)
    expect(ahead.twist).toBeCloseTo(0, 6)
    const back = gait(0, -1, 0, TWIST)
    expect(back.direction).toBe(-1)
    expect(back.twist).toBeCloseTo(0, 6)
    const diagonalBack = gait(Math.PI / 2, 0.2, -1, TWIST)
    expect(diagonalBack.direction).toBe(-1)
    expect(Math.abs(diagonalBack.twist)).toBeLessThan(0.3)
    const side = gait(0, 0, 1, TWIST)
    expect(side.direction).toBe(1)
    expect(side.twist).toBeCloseTo(TWIST, 6)
    expect(side.relative).toBeCloseTo(Math.PI / 2, 6)
    const wrapped = gait(Math.PI - 0.1, -1, 0.05, TWIST)
    expect(wrapped.direction).toBe(1)
    expect(Math.abs(wrapped.twist)).toBeLessThan(0.2)
  })

  it('lets each scarf segment trail the one above it', () => {
    const segments = [0, 0, 0]
    trailScarf(segments, 1, 0.05, [10, 6, 4])
    expect(segments[0]).toBeGreaterThan(segments[1])
    trailScarf(segments, 1, 0.05, [10, 6, 4])
    expect(segments[0]).toBeGreaterThan(segments[1])
    expect(segments[1]).toBeGreaterThan(segments[2])
    expect(segments[2]).toBeGreaterThan(0)
    for (let i = 0; i < 200; i++) trailScarf(segments, 1, 0.05, [10, 6, 4])
    for (const value of segments) expect(value).toBeCloseTo(1, 4)
  })
})

describe('kai death', () => {
  it('stands still on the first frame and lies on the back once the fall ends', () => {
    const start = deathPose(0, KAI_DEATH)
    expect(start.pitch).toBe(0)
    expect(start.roll).toBe(0)
    expect(start.slide).toBe(0)
    expect(start.thigh).toBe(0)
    expect(start.landed).toBe(false)
    const down = deathPose(KAI_DEATH.fallEnd, KAI_DEATH)
    expect(down.pitch).toBeCloseTo(KAI_DEATH.pitch)
    expect(down.landed).toBe(true)
    const settled = deathPose(KAI_DEATH.fallEnd + KAI_DEATH.settle + 1, KAI_DEATH)
    expect(settled.pitch).toBeCloseTo(KAI_DEATH.pitch)
    expect(settled.roll).toBeCloseTo(KAI_DEATH.roll)
    expect(settled.torso).toBeCloseTo(KAI_DEATH.torso)
    expect(settled.knee).toBeGreaterThan(0.5)
    expect(deathPose(-1, KAI_DEATH)).toEqual(start)
  })

  it('flinches back before the knees give and tips over faster as it falls', () => {
    const flinch = deathPose(KAI_DEATH.stagger, KAI_DEATH)
    expect(flinch.torso).toBeGreaterThan(KAI_DEATH.flinch * 0.8)
    expect(flinch.pitch).toBe(0)
    const early = deathPose(KAI_DEATH.fallStart + 0.1, KAI_DEATH).pitch
    const late = deathPose(KAI_DEATH.fallStart + 0.2, KAI_DEATH).pitch
    const later = deathPose(KAI_DEATH.fallStart + 0.3, KAI_DEATH).pitch
    expect(early).toBeGreaterThan(0)
    expect(later - late).toBeGreaterThan(late - early)
    expect(deathPose(KAI_DEATH.buckleEnd, KAI_DEATH).knee).toBeCloseTo(KAI_DEATH.knee * (1 - 0.25 * deathPose(KAI_DEATH.buckleEnd, KAI_DEATH).landing))
  })

  it('bounces once after landing and settles', () => {
    const bounce = deathPose(KAI_DEATH.fallEnd + KAI_DEATH.settle / 2, KAI_DEATH)
    expect(bounce.pitch).toBeCloseTo(KAI_DEATH.pitch - KAI_DEATH.bounce)
    let pitch = deathPose(0, KAI_DEATH).pitch
    for (let time = 0.02; time <= KAI_DEATH.fallEnd; time += 0.02) {
      const next = deathPose(time, KAI_DEATH).pitch
      expect(next).toBeGreaterThanOrEqual(pitch)
      pitch = next
    }
  })

  it('drops the gun to rest on the ground with one small hop', () => {
    const drop = { gunHop: 1.2, gunBounce: 0.3, gravity: 9.8 }
    expect(gunDrop(0, 0.8, 0.05, drop)).toMatchObject({ height: 0.8, travel: 0, turn: 0, landed: false })
    const apex = gunDrop(1.2 / 9.8, 0.8, 0.05, drop)
    expect(apex.height).toBeCloseTo(0.8 + (1.2 * 1.2) / (2 * 9.8))
    let land = 0
    while (!gunDrop(land, 0.8, 0.05, drop).landed) land += 0.005
    expect(gunDrop(land, 0.8, 0.05, drop).turn).toBeCloseTo(1, 1)
    let peak = 0
    for (let time = land; time < land + 0.5; time += 0.005) {
      const state = gunDrop(time, 0.8, 0.05, drop)
      expect(state.height).toBeGreaterThanOrEqual(0.05)
      peak = Math.max(peak, state.height)
    }
    expect(peak).toBeGreaterThan(0.05)
    expect(peak).toBeLessThan(0.2)
    expect(gunDrop(3, 0.8, 0.05, drop)).toMatchObject({ height: 0.05, travel: 1, turn: 1, landed: true })
    expect(gunDrop(1, 0.02, 0.05, drop).height).toBe(0.05)
  })

  it('lifts a turned box so its lowest corner touches the ground', () => {
    const box = new THREE.Box3(new THREE.Vector3(-0.1, -0.05, -0.04), new THREE.Vector3(0.6, 0.12, 0.04))
    const flat = new THREE.Quaternion()
    expect(restHeight(box, flat, new THREE.Vector3(1, 1, 1))).toBeCloseTo(0.05)
    const side = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
    expect(restHeight(box, side, new THREE.Vector3(1, 1, 1))).toBeCloseTo(0.04)
    expect(restHeight(box, side, new THREE.Vector3(2, 2, 2))).toBeCloseTo(0.08)
    expect(restHeight(new THREE.Box3(), side, new THREE.Vector3(1, 1, 1))).toBe(0)
  })
})
