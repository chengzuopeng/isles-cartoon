import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  BALE_SPIN,
  BLADE_BURY,
  BLADE_DROP_HEIGHT,
  BLADE_FALL_SHARE,
  BLADE_SINK_TIME,
  BLADE_STUCK_TIME,
  BOMB_SWAY,
  baleTumble,
  bladeAnchor,
  bladeFall,
  bladeLanding,
  bladeLift,
  bladeQuaternion,
  bladeSink,
  bladeSpin,
  bladeYaw,
  bombTumble,
  bulletTraveled,
  freshLob,
  hashUnit,
  LAUNCH_KEEP,
  LAUNCH_LATE,
  LAUNCH_SECONDS,
  LAUNCH_SURGE,
  LOB_LAUNCH_SECONDS,
  launchAt,
  launchFade,
  launchShift,
  launchWindow,
  lobPose,
  lobProgress,
  sparkFlicker,
  trackLaunch,
  type LaunchBullet,
  type LobPath,
} from './projectile-motion'

function lob(t: number, step = 0.1): LobPath {
  const from = { x: 2, y: 3 }
  const to = { x: 8, y: 11 }
  const at = (u: number) => ({ x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u })
  return { from, to, prev: at(Math.max(0, t - step)), pos: at(t), time: t * 1.2, total: 1.2, peak: 2.5 }
}

describe('lob progress', () => {
  it('reads the interpolated position back as arc progress', () => {
    const path = lob(0.5)
    expect(lobProgress(path, 1)).toBeCloseTo(0.5)
    expect(lobProgress(path, 0)).toBeCloseTo(0.4)
    expect(lobProgress(path, 0.5)).toBeCloseTo(0.45)
  })

  it('falls back to the flight clock when the lob lands where it started', () => {
    const still: LobPath = { from: { x: 4, y: 4 }, to: { x: 4, y: 4 }, prev: { x: 4, y: 4 }, pos: { x: 4, y: 4 }, time: 0.3, total: 0.6, peak: 1 }
    expect(lobProgress(still, 0.2)).toBeCloseTo(0.5)
    expect(lobProgress({ ...still, time: 2 }, 0.2)).toBe(1)
  })
})

describe('lob pose', () => {
  it('starts at the launch height and lands resting on the ground', () => {
    const path = lob(0)
    expect(lobPose(path, 0, 1.5, 0.2).height).toBeCloseTo(1.7)
    expect(lobPose(path, 1, 1.5, 0.2).height).toBeCloseTo(0.2)
    expect(lobPose(path, 0.5, 0, 0).height).toBeCloseTo(path.peak)
  })

  it('heads along the throw and pitches along the tangent of the arc', () => {
    const path = lob(0)
    const distance = Math.hypot(6, 8)
    const pose = lobPose(path, 0.3, 1, 0)
    expect(pose.heading).toBeCloseTo(Math.atan2(8, 6))
    const h = 1e-4
    const slope = (lobPose(path, 0.3 + h, 1, 0).height - lobPose(path, 0.3 - h, 1, 0).height) / (2 * h * distance)
    expect(Math.tan(pose.pitch)).toBeCloseTo(slope, 5)
    expect(lobPose(path, 0.05, 0, 0).pitch).toBeGreaterThan(0)
    expect(lobPose(path, 0.95, 0, 0).pitch).toBeLessThan(0)
  })

  it('makes a high launch dip earlier than a ground launch', () => {
    const path = lob(0)
    expect(lobPose(path, 0.4, 3.45, 0).pitch).toBeLessThan(lobPose(path, 0.4, 0, 0).pitch)
  })

  it('points straight down when dropped on the spot', () => {
    const still = { from: { x: 4, y: 4 }, to: { x: 4, y: 4 }, peak: 1 }
    expect(lobPose(still, 0.9, 1, 0).pitch).toBeCloseTo(-Math.PI / 2)
  })
})

describe('tumbling', () => {
  it('rolls the bomb one turn toward its screen direction and keeps the emblem near the camera', () => {
    expect(bombTumble(0, 3, 0, 5).roll).toBeCloseTo(0)
    expect(bombTumble(1, 3, 0, 5).roll).toBeCloseTo(-Math.PI * 2)
    expect(bombTumble(1, -3, 0, 5).roll).toBeCloseTo(Math.PI * 2)
    for (let time = 0; time < 3; time += 0.07) {
      expect(Math.abs(bombTumble(0.5, 1, time, 9).yaw)).toBeLessThanOrEqual(BOMB_SWAY + 1e-9)
    }
    const facing = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(0, BOMB_SWAY, 1.3, 'YZX'))
    expect(facing.z).toBeGreaterThan(0.9)
  })

  it('turns the bale side-on to its flight and rolls it forward over time', () => {
    const { yaw, roll } = baleTumble(3, -4, 0.5)
    expect(roll).toBeCloseTo(BALE_SPIN * 0.5)
    const axis = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(roll, yaw, 0, 'YXZ'))
    expect(axis.y).toBeCloseTo(0)
    expect(axis.x * 3 + axis.z * -4).toBeCloseTo(0)
    const heading = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(0, yaw, 0, 'YXZ'))
    expect(heading.x).toBeCloseTo(0.6)
    expect(heading.z).toBeCloseTo(-0.8)
    const early = baleTumble(3, -4, 0.05)
    const top = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(early.roll, early.yaw, 0, 'YXZ'))
    expect(top.dot(heading)).toBeGreaterThan(0)
  })

  it('flickers the spark deterministically within a small range', () => {
    for (let time = 0; time < 2; time += 0.013) {
      const value = sparkFlicker(time, 42)
      expect(value).toBeGreaterThanOrEqual(0.55)
      expect(value).toBeLessThanOrEqual(1.3)
      expect(sparkFlicker(time, 42)).toBe(value)
    }
    expect(hashUnit(1, 2)).not.toBe(hashUnit(2, 1))
  })

  it('rolls the rocket by the interpolated distance', () => {
    expect(bulletTraveled(3, { x: 0, y: 0 }, { x: 0.3, y: 0.4 }, 1)).toBeCloseTo(3)
    expect(bulletTraveled(3, { x: 0, y: 0 }, { x: 0.3, y: 0.4 }, 0)).toBeCloseTo(2.5)
    expect(bulletTraveled(0.2, { x: 0, y: 0 }, { x: 0.3, y: 0.4 }, 0)).toBe(0)
  })
})

describe('falling blade', () => {
  it('stays hidden until the last part of the warning, then drops with growing speed', () => {
    const start = 1 - BLADE_FALL_SHARE
    expect(bladeFall(start - 0.01)).toBeNull()
    expect(bladeFall(start)).toBeCloseTo(0)
    expect(bladeFall(1)).toBe(1)
    expect(bladeLift(0)).toBeCloseTo(BLADE_DROP_HEIGHT)
    expect(bladeLift(1)).toBe(0)
    const early = bladeLift(0) - bladeLift(0.25)
    const late = bladeLift(0.75) - bladeLift(1)
    expect(late).toBeGreaterThan(early * 2)
    expect(bladeSpin(1)).toBe(0)
  })

  it('sticks into the ground when the warning ran out', () => {
    expect(bladeLanding({ amount: 0.98, delay: 0.02, seenAt: 10 }, 10.03)).toBeCloseTo(10.02)
  })

  it('still sticks when the sim was advanced past the landing between two frames', () => {
    expect(bladeLanding({ amount: 0.4, delay: 0.6, seenAt: 10 }, 12)).toBeCloseTo(10.6)
  })

  it('is removed at once when the warning disappears early', () => {
    expect(bladeLanding({ amount: 0.5, delay: 0.5, seenAt: 10 }, 10.1)).toBeNull()
  })

  it('stays planted, then sinks, then is gone', () => {
    expect(bladeSink(10, 10)).toBe(0)
    expect(bladeSink(10 + BLADE_STUCK_TIME - 0.01, 10)).toBe(0)
    expect(bladeSink(10 + BLADE_STUCK_TIME + BLADE_SINK_TIME / 2, 10)).toBeCloseTo(0.5)
    expect(bladeSink(10 + BLADE_STUCK_TIME + BLADE_SINK_TIME, 10)).toBeNull()
  })

  it('keeps the blade face toward the camera', () => {
    for (let id = 1; id < 400; id++) {
      const yaw = bladeYaw(id)
      const offset = Math.abs(Math.atan2(Math.sin(yaw), Math.cos(yaw)))
      expect(Math.min(offset, Math.PI - offset)).toBeLessThanOrEqual(Math.PI / 4)
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(bladeQuaternion(yaw, 0))
      expect(Math.abs(normal.z)).toBeGreaterThan(0.6)
    }
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(bladeQuaternion(0, 0))
    expect(normal.y).toBeGreaterThan(0.3)
  })

  it('buries the tip at the strike point', () => {
    const tip = new THREE.Vector3(0.524, 0.263, 0)
    for (const yaw of [0, 0.5, Math.PI, Math.PI - 0.6]) {
      const rotation = bladeQuaternion(yaw, 0)
      const anchor = bladeAnchor(tip, 1.3, rotation, 6, 9)
      const world = tip.clone().multiplyScalar(1.3).applyQuaternion(rotation).add(anchor)
      expect(world.x).toBeCloseTo(6)
      expect(world.z).toBeCloseTo(9)
      expect(world.y).toBeCloseTo(-BLADE_BURY)
      expect(anchor.y).toBeGreaterThan(0)
    }
    expect(bladeAnchor(tip, 1, bladeQuaternion(0, 0), 0, 0).y).toBeCloseTo(0.322 * Math.cos(Math.PI / 7.2) - BLADE_BURY, 2)
  })
})

function fired(speed: number, dirX: number, dirY: number, steps: number, step = 1 / 60): LaunchBullet {
  const origin = { x: 5, y: 5 }
  const offset = 0.45
  const traveled = speed * step * steps
  const along = offset + traveled
  const previous = steps <= 1 ? 0 : offset + traveled - speed * step
  return {
    pos: { x: origin.x + dirX * along, y: origin.y + dirY * along },
    prev: steps <= 1 ? { ...origin } : { x: origin.x + dirX * previous, y: origin.y + dirY * previous },
    dirX,
    dirY,
    speed,
    traveled,
  }
}

describe('muzzle launch', () => {
  it('keeps the base window unless catching up would slow the bullet too much', () => {
    expect(launchWindow(15, 0)).toBe(LAUNCH_SECONDS)
    expect(launchWindow(15, -0.3)).toBe(LAUNCH_SECONDS)
    expect(launchWindow(0, 0.5)).toBe(LAUNCH_SECONDS)
    const slow = launchWindow(8, 1)
    expect(slow).toBeGreaterThan(LAUNCH_SECONDS)
    let last = -Infinity
    for (let i = 0; i <= 200; i++) {
      const age = (slow * i) / 200
      const along = 8 * age + launchFade(age, slow)
      if (i > 0) expect(along - last).toBeGreaterThanOrEqual(LAUNCH_KEEP * 8 * (slow / 200) - 1e-9)
      last = along
    }
    const behind = launchWindow(10, -2)
    expect(behind).toBeGreaterThan(LAUNCH_SECONDS)
    for (let i = 1; i <= 200; i++) {
      const age = (behind * i) / 200
      const step = 10 * (behind / 200) - 2 * (launchFade(age, behind) - launchFade(age - behind / 200, behind))
      expect(step).toBeLessThanOrEqual((1 + LAUNCH_SURGE) * 10 * (behind / 200) + 1e-9)
    }
  })

  it('fades smoothly from one to zero over the window', () => {
    expect(launchFade(0, 0.1)).toBe(1)
    expect(launchFade(0.05, 0.1)).toBeCloseTo(0.5)
    expect(launchFade(0.1, 0.1)).toBe(0)
    expect(launchFade(1, 0.1)).toBe(0)
    expect(launchFade(0.01, 0)).toBe(0)
    expect(launchFade(0.001, 0.1)).toBeGreaterThan(0.99)
  })

  it('shows the bullet tail at the muzzle on the first frame it is drawn, whatever the interpolation', () => {
    const muzzle = new THREE.Vector3(5.3, 0.82, 5.25)
    for (const [steps, alpha] of [[1, 0], [1, 0.8], [2, 0.5]] as const) {
      const bullet = fired(15, 1, 0, steps)
      const track = trackLaunch(muzzle, bullet, 0.62, alpha, 0.3)
      expect(track).not.toBeNull()
      const out = new THREE.Vector3()
      expect(launchAt(track!, bullet, alpha, 0.62, out)).toBe(true)
      expect(out.x).toBeCloseTo(muzzle.x + 0.3)
      expect(out.y).toBeCloseTo(muzzle.y)
      expect(out.z).toBeCloseTo(muzzle.z)
    }
  })

  it('moves forward every frame and lands on the sim path once the window ends', () => {
    const muzzle = new THREE.Vector3(5.6, 0.82, 5.25)
    const first = fired(10, 1, 0, 1)
    const track = trackLaunch(muzzle, first, 0.62, 0, 0.3)!
    const out = new THREE.Vector3()
    let last = -Infinity
    let steps = 1
    for (; steps < 60; steps++) {
      const bullet = fired(10, 1, 0, steps)
      if (!launchAt(track, bullet, 0.5, 0.62, out)) break
      expect(out.x).toBeGreaterThan(last)
      last = out.x
    }
    expect(steps).toBeLessThan(60)
    expect((steps - 1) / 60).toBeGreaterThanOrEqual(Math.max(track.window, track.reach) - 1 / 60)
    expect(launchAt(track, fired(10, 1, 0, steps + 1), 0.5, 0.62, out)).toBe(false)
  })

  it('pulls the side offset in quickly and the forward lead in more gently', () => {
    const muzzle = new THREE.Vector3(5.45, 0.82, 5.25)
    const bullet = fired(10, 1, 0, 1)
    const track = trackLaunch(muzzle, bullet, 0.62, 0, 0.6)!
    expect(track.side.z).toBeCloseTo(0.25)
    expect(track.side.y).toBeCloseTo(0.2)
    expect(track.ahead).toBeCloseTo(0.6)
    expect(track.reach).toBeGreaterThan(track.window)
    const shift = launchShift(track, track.window, new THREE.Vector3())
    expect(shift.z).toBeCloseTo(0)
    expect(shift.y).toBeCloseTo(0)
    expect(shift.x).toBeGreaterThan(0)
    expect(launchShift(track, track.reach, new THREE.Vector3()).length()).toBeCloseTo(0)
  })

  it('skips bullets that were first seen after the window and stops when the bullet bounces', () => {
    const muzzle = new THREE.Vector3(5.45, 0.82, 5.25)
    expect(trackLaunch(muzzle, fired(15, 1, 0, Math.ceil(LAUNCH_LATE * 60) + 1), 0.62, 1, 0)).toBeNull()
    expect(trackLaunch(muzzle, { ...fired(15, 1, 0, 1), speed: 0 }, 0.62, 1, 0)).toBeNull()
    const bullet = fired(15, 1, 0, 1)
    const track = trackLaunch(muzzle, bullet, 0.62, 0, 0)!
    expect(launchAt(track, { ...bullet, dirX: -1 }, 0, 0.62, new THREE.Vector3())).toBe(false)
  })

  it('aims the start along any direction', () => {
    const dirX = Math.cos(2.2)
    const dirY = Math.sin(2.2)
    const bullet = fired(20, dirX, dirY, 1)
    const muzzle = new THREE.Vector3(4.7, 0.8, 5.6)
    const track = trackLaunch(muzzle, bullet, 0.62, 0, 0.5)!
    const out = new THREE.Vector3()
    launchAt(track, bullet, 0, 0.62, out)
    expect(out.x).toBeCloseTo(muzzle.x + dirX * 0.5)
    expect(out.z).toBeCloseTo(muzzle.z + dirY * 0.5)
  })

  it('only moves lobs that were just thrown', () => {
    expect(freshLob(0, 1)).toBe(true)
    expect(freshLob((LOB_LAUNCH_SECONDS * 0.5) / 0.8, 0.8)).toBe(true)
    expect(freshLob(LOB_LAUNCH_SECONDS / 0.8, 0.8)).toBe(false)
  })
})
