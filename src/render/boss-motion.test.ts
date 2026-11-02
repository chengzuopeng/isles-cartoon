import { describe, expect, it } from 'vitest'
import { getBoss } from '../data/bosses'
import { TRAINING } from '../data/levels/training'
import { createDefaultTuning } from '../data/tuning'
import { buildLevel } from '../sim/level'
import type { BossState } from '../sim/types'
import { createBoss, createWorld } from '../sim/world'
import {
  approach,
  forwardTravel,
  headerLift,
  reelSpeed,
  riseThenSettle,
  scarecrowPose,
  telegraphTotal,
  unloaderLift,
  unloaderYaw,
  wheelTurn,
  wrapAngle,
} from './boss-motion'
import {
  arc,
  coastAngle,
  defeatTime,
  dragged,
  flicker,
  harvesterEjection,
  landingTime,
  passed,
  scarecrowCollapse,
  seatClearTime,
  span,
  ticks,
} from './boss-motion'
import { HARVESTER_DEFEAT, HARVESTER_RIG, SCARECROW_DEFEAT } from './themes'

const tuning = createDefaultTuning()
const weapons = tuning.weapons

function bossState(id: string, patch: Partial<BossState> = {}): BossState {
  const world = createWorld(buildLevel(TRAINING), tuning)
  const boss = createBoss(world, id, { x: 0, y: 0 }, 0).boss
  if (!boss) throw new Error('no boss state')
  return Object.assign(boss, patch)
}

describe('boss motion', () => {
  it('eases toward a target the same way whatever the frame rate', () => {
    const once = approach(0, 1, 6, 0.1)
    const twice = approach(approach(0, 1, 6, 0.05), 1, 6, 0.05)
    expect(twice).toBeCloseTo(once, 10)
    expect(approach(0.3, 1, 6, 0)).toBeCloseTo(0.3, 10)
  })

  it('rises at once but settles back gradually', () => {
    expect(riseThenSettle(0.2, 0.9, 5, 1 / 60)).toBe(0.9)
    const settled = riseThenSettle(1, 0, 5, 1 / 60)
    expect(settled).toBeGreaterThan(0.9)
    expect(settled).toBeLessThan(1)
  })

  it('wraps angles into one turn around zero', () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(-Math.PI, 10)
    expect(wrapAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2, 10)
    expect(wrapAngle(0.4)).toBeCloseTo(0.4, 10)
  })

  it('rolls each wheel by the distance driven over its own radius', () => {
    const front = 0.301
    const rear = 0.556
    expect(wheelTurn(1.2, front)).toBeCloseTo(-1.2 / front, 10)
    expect(wheelTurn(1.2, rear)).toBeCloseTo(-1.2 / rear, 10)
    expect(Math.abs(wheelTurn(1, front))).toBeGreaterThan(Math.abs(wheelTurn(1, rear)))
    expect(wheelTurn(-0.5, rear)).toBeGreaterThan(0)
  })

  it('counts only the part of a step that goes along the facing', () => {
    expect(forwardTravel(1, 0, 0)).toBeCloseTo(1, 10)
    expect(forwardTravel(0, 1, 0)).toBeCloseTo(0, 10)
    expect(forwardTravel(0, 2, Math.PI / 2)).toBeCloseTo(2, 10)
    expect(forwardTravel(-1, 0, 0)).toBeCloseTo(-1, 10)
  })

  it('keeps the reel between 2 and 12 rad/s and spins it up for the big moves', () => {
    const def = getBoss('harvester')
    const speeds = HARVESTER_RIG.reel
    const phases: BossState['phase'][] = ['dormant', 'intro', 'walk', 'telegraph', 'active', 'recover', 'stunned', 'shift']
    for (const phase of phases) {
      for (const move of [null, 'charge', 'sweep', 'bales', 'spin', 'frenzy'] as const) {
        for (const phaseIndex of [0, 1, 2]) {
          const speed = reelSpeed(def, bossState('harvester', { phase, move, phaseIndex, timer: 0.3 }), weapons)
          expect(speed).toBeGreaterThanOrEqual(2)
          expect(speed).toBeLessThanOrEqual(12)
        }
      }
    }
    expect(reelSpeed(def, bossState('harvester', { phase: 'stunned' }), weapons)).toBe(speeds.stunned)
    expect(reelSpeed(def, bossState('harvester', { phase: 'active', move: 'charge' }), weapons)).toBe(12)
    const sweep = weapons.reaperSweep.windup
    const early = reelSpeed(def, bossState('harvester', { phase: 'telegraph', move: 'sweep', timer: sweep }), weapons)
    const late = reelSpeed(def, bossState('harvester', { phase: 'telegraph', move: 'sweep', timer: 0.05 }), weapons)
    expect(late).toBeGreaterThan(early)
    const calm = reelSpeed(def, bossState('harvester', { phase: 'walk', phaseIndex: 0 }), weapons)
    const angry = reelSpeed(def, bossState('harvester', { phase: 'walk', phaseIndex: 2 }), weapons)
    expect(angry).toBeGreaterThan(calm)
  })

  it('times the first frenzy telegraph and the later ones separately', () => {
    const def = getBoss('harvester')
    const frenzy = def.frenzy
    if (!frenzy) throw new Error('harvester has no frenzy')
    expect(telegraphTotal(def, bossState('harvester', { move: 'frenzy', frenzyLeft: frenzy.charges }), weapons)).toBe(frenzy.firstTelegraph)
    expect(telegraphTotal(def, bossState('harvester', { move: 'frenzy', frenzyLeft: frenzy.charges - 1 }), weapons)).toBe(frenzy.telegraph)
    expect(telegraphTotal(getBoss('scarecrow'), bossState('scarecrow', { move: 'slam' }), weapons)).toBe(weapons.strawSlam.windup)
  })

  it('lifts the unloader through the bale windup, holds it while tossing and lowers it on recover', () => {
    const def = getBoss('harvester')
    const bales = def.bales
    if (!bales) throw new Error('harvester has no bales')
    expect(unloaderLift(def, bossState('harvester', { phase: 'telegraph', move: 'bales', timer: bales.windup }))).toBe(0)
    const half = unloaderLift(def, bossState('harvester', { phase: 'telegraph', move: 'bales', timer: bales.windup / 2 }))
    expect(half).toBeGreaterThan(0.5)
    expect(half).toBeLessThan(1)
    expect(unloaderLift(def, bossState('harvester', { phase: 'active', move: 'bales' }))).toBe(1)
    expect(unloaderLift(def, bossState('harvester', { phase: 'recover', move: 'bales', timer: bales.recover }))).toBe(1)
    expect(unloaderLift(def, bossState('harvester', { phase: 'recover', move: 'bales', timer: 0 }))).toBe(0)
    expect(unloaderLift(def, bossState('harvester', { phase: 'active', move: 'charge' }))).toBe(0)
  })

  it('turns the unloader to the bale angle relative to the facing', () => {
    expect(unloaderYaw(0.5, 0.5)).toBeCloseTo(0, 10)
    expect(unloaderYaw(0, 0.5)).toBeCloseTo(0.5, 10)
    expect(unloaderYaw(-3, 3)).toBeCloseTo(wrapAngle(6), 10)
    expect(Math.abs(unloaderYaw(-3, 3))).toBeLessThanOrEqual(Math.PI)
  })

  it('raises the header only for the reel attacks and a little while charging', () => {
    const def = getBoss('harvester')
    expect(headerLift(def, bossState('harvester', { phase: 'telegraph', move: 'sweep', timer: 0 }), weapons)).toBeCloseTo(1, 10)
    expect(headerLift(def, bossState('harvester', { phase: 'walk' }), weapons)).toBe(0)
    const charge = headerLift(def, bossState('harvester', { phase: 'active', move: 'charge' }), weapons)
    expect(charge).toBeGreaterThan(0)
    expect(charge).toBeLessThan(1)
  })

  it('leans the scarecrow into a charge and holds the lean while it runs', () => {
    const def = getBoss('scarecrow')
    const start = scarecrowPose(def, bossState('scarecrow', { phase: 'telegraph', move: 'charge', timer: def.charge.telegraph }), weapons)
    expect(start.lean).toBe(0)
    const mid = scarecrowPose(def, bossState('scarecrow', { phase: 'telegraph', move: 'charge', timer: def.charge.telegraph / 2 }), weapons)
    expect(mid.lean).toBeGreaterThan(0)
    expect(mid.back).toBeGreaterThan(0)
    const running = scarecrowPose(def, bossState('scarecrow', { phase: 'active', move: 'charge' }), weapons)
    expect(running.lean).toBe(1)
    expect(running.back).toBe(1)
    const done = scarecrowPose(def, bossState('scarecrow', { phase: 'recover', move: 'charge', timer: 0 }), weapons)
    expect(done.lean).toBe(0)
  })

  it('raises the scarecrow arms over the slam windup', () => {
    const def = getBoss('scarecrow')
    const windup = weapons.strawSlam.windup
    const raised = [windup, windup * 0.6, windup * 0.2, 0].map(
      (timer) => scarecrowPose(def, bossState('scarecrow', { phase: 'telegraph', move: 'slam', timer }), weapons).raise,
    )
    expect(raised[0]).toBe(0)
    for (let i = 1; i < raised.length; i++) expect(raised[i]).toBeGreaterThan(raised[i - 1])
    expect(raised[raised.length - 1]).toBeCloseTo(1, 10)
    expect(scarecrowPose(def, bossState('scarecrow', { phase: 'recover', move: 'slam', timer: 0.5 }), weapons).raise).toBe(0)
  })

  it('stands the scarecrow arms out while dormant and slumps it when stunned', () => {
    const def = getBoss('scarecrow')
    expect(scarecrowPose(def, bossState('scarecrow', { phase: 'dormant' }), weapons).spread).toBe(1)
    expect(scarecrowPose(def, bossState('scarecrow', { phase: 'intro', timer: 0 }), weapons).spread).toBeCloseTo(0, 10)
    expect(scarecrowPose(def, bossState('scarecrow', { phase: 'stunned', timer: 1 }), weapons).slump).toBe(1)
  })
})

describe('boss defeat timelines', () => {
  const D = HARVESTER_DEFEAT
  const F = SCARECROW_DEFEAT

  it('keeps a fallen boss on screen for its show and then lets it go', () => {
    expect(defeatTime(10, 10, 4)).toBe(0)
    expect(defeatTime(10, 13.5, 4)).toBeCloseTo(3.5, 10)
    expect(defeatTime(10, 14, 4)).toBeNull()
    expect(defeatTime(10, 2, 4)).toBeNull()
  })

  it('fires each cue once however the time is sliced, and never while time stands still', () => {
    const slices = [0, 0.013, 0.05, 0.05, 0.31, 0.32, 0.7, 1.01]
    let count = 0
    let fired = 0
    for (let i = 1; i < slices.length; i++) {
      count += ticks(slices[i - 1], slices[i], 0.1, 0.9, 0.2)
      if (passed(slices[i - 1], slices[i], 0.3)) fired++
    }
    expect(count).toBe(ticks(0, 1.01, 0.1, 0.9, 0.2))
    expect(count).toBe(4)
    expect(fired).toBe(1)
    expect(ticks(0.5, 0.5, 0, 1, 0.1)).toBe(0)
    expect(passed(0.3, 0.3, 0.3)).toBe(false)
    expect(passed(0, 0.01, 0)).toBe(true)
  })

  it('winds the reel down to a stop at its own speed', () => {
    const speed = 9
    expect(coastAngle(speed, 0, D.reelStop)).toBe(0)
    expect(coastAngle(speed, 0.001, D.reelStop)).toBeCloseTo(speed * 0.001, 4)
    const stopped = coastAngle(speed, D.reelStop, D.reelStop)
    expect(stopped).toBeCloseTo((speed * D.reelStop) / 2, 10)
    expect(coastAngle(speed, D.reelStop + 3, D.reelStop)).toBe(stopped)
    let last = -1
    for (let t = 0; t <= D.reelStop; t += 0.05) {
      const angle = coastAngle(speed, t, D.reelStop)
      expect(angle).toBeGreaterThan(last)
      last = angle
    }
  })

  it('ejects in the order the model notes require: unloader up, roof forward at 30 to 45 degrees, then the seat straight up', () => {
    expect(D.roofAngle).toBeGreaterThanOrEqual((30 * Math.PI) / 180)
    expect(D.roofAngle).toBeLessThanOrEqual((45 * Math.PI) / 180)
    expect(D.roofClear).toBeGreaterThanOrEqual(2)
    expect(D.seatClear).toBeGreaterThanOrEqual(2)
    for (const from of [
      { pitch: 0, yaw: 0 },
      { pitch: HARVESTER_RIG.balePitch + HARVESTER_RIG.baleKick, yaw: -1.2 },
      { pitch: 0.4, yaw: 2.5 },
    ]) {
      let roofSeen = false
      let seatSeen = false
      for (let t = 0; t <= D.seconds; t += 1 / 240) {
        const e = harvesterEjection(t, from)
        expect(e.pitch).toBeGreaterThanOrEqual(0)
        expect(e.pitch).toBeLessThanOrEqual(1.75)
        if (e.roof > 0) {
          roofSeen = true
          expect(e.pitch).toBeGreaterThanOrEqual(1.4)
          expect(Math.abs(e.yaw)).toBeLessThan(1e-9)
        }
        if (e.seat > 0) {
          seatSeen = true
          expect(e.roof).toBeGreaterThanOrEqual(D.roofClear)
          expect(e.pitch).toBeGreaterThanOrEqual(1.4)
        }
        if (e.seat <= D.seatClear) {
          expect(e.drift).toBe(0)
          expect(e.tumble).toBe(0)
        }
      }
      expect(roofSeen && seatSeen).toBe(true)
    }
  })

  it('launches the seat smoothly past the clearance height and out of sight', () => {
    const from = { pitch: 0, yaw: 0 }
    const clear = D.seatFire + seatClearTime(D)
    const before = harvesterEjection(clear - 1e-4, from).seat
    const after = harvesterEjection(clear + 1e-4, from).seat
    expect(before).toBeCloseTo(D.seatClear, 2)
    expect(after).toBeCloseTo(D.seatClear, 2)
    let peak = 0
    for (let t = D.seatFire; t <= D.seconds; t += 0.05) peak = Math.max(peak, harvesterEjection(t, from).seat)
    expect(peak).toBeGreaterThan(D.seatHide)
  })

  it('lands a thrown part exactly on the ground and slows it down in the air', () => {
    const rise = 4.3
    const drop = 3.1
    const land = landingTime(rise, 18, drop)
    expect(rise * land - 9 * land * land).toBeCloseTo(-drop, 9)
    expect(dragged(5, 1.4, 0)).toBe(0)
    expect(dragged(5, 1.4, 10)).toBeLessThan(5 / 1.4 + 1e-9)
    expect(dragged(5, 0, 2)).toBe(10)
    expect(arc(1, 3, 2, 0)).toBe(1)
    expect(arc(1, 3, 2, 1)).toBe(3)
    expect(arc(1, 3, 2, 0.5)).toBeCloseTo(4, 10)
  })

  it('topples the scarecrow backwards without jumps, lays it down and fades it out', () => {
    let last = scarecrowCollapse(0, -0.2)
    expect(last.lean).toBeCloseTo(-0.2, 10)
    expect(last.fade).toBe(1)
    for (let t = 1 / 240; t <= F.seconds; t += 1 / 240) {
      const pose = scarecrowCollapse(t, -0.2)
      expect(Math.abs(pose.lean - last.lean)).toBeLessThan(0.05)
      expect(Math.abs(pose.armUp - last.armUp)).toBeLessThan(0.05)
      expect(Math.abs(pose.head - last.head)).toBeLessThan(0.05)
      expect(pose.fade).toBeLessThanOrEqual(last.fade)
      last = { ...pose }
    }
    const landed = scarecrowCollapse(F.fall + F.fallSeconds + F.settle, 0)
    expect(landed.lean).toBeCloseTo(F.fallAngle, 6)
    expect(scarecrowCollapse(F.sinkStart, 0).fade).toBe(1)
    expect(scarecrowCollapse(F.seconds, 0).fade).toBeCloseTo(0, 10)
    expect(scarecrowCollapse(F.seconds, 0).sink).toBeCloseTo(F.sinkDepth, 10)
    expect(scarecrowCollapse(F.eyeFade, 0).eye).toBe(0)
    expect(flicker(0, F.eyeFade, F.flicker)).toBeGreaterThan(0.9)
    expect(span(2, 1, 3)).toBeCloseTo(0.5, 10)
  })
})
