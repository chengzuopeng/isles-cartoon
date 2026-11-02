import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { LEVEL_1_4 } from '../data/levels/level-1-4'
import { buildLevel } from '../sim/level'
import { facingYaw } from './scene-models'
import { ladderModelYaw, ladderPose } from './ladder'
import { LADDER } from './themes'

describe('ladder', () => {
  it('leans against the face of the landmark the perch sits on, square to it', () => {
    const level = buildLevel(LEVEL_1_4)
    const chest = level.chests.find((item) => item.perch !== null)
    if (!chest?.perch) throw new Error('no perched chest')
    const pose = ladderPose({ x: chest.x, y: chest.y }, chest.perch)
    expect(pose.toward).toEqual({ x: -1, y: 0 })
    expect(pose.top.x).toBeCloseTo(chest.x - 0.5 + LADDER.inset, 6)
    expect(pose.top.y).toBeCloseTo(chest.y, 6)
    expect(pose.foot.x).toBeGreaterThan(pose.top.x)
    expect(pose.foot.x).toBeLessThan(chest.x + 0.5)
    expect(pose.height).toBe(chest.perch.height)
  })

  it('turns the ladder model so its back faces the landmark, like a landmark facing 270 in 1-4', () => {
    expect(ladderModelYaw({ x: -1, y: 0 })).toBeCloseTo(0, 6)
    const yaw = ladderModelYaw({ x: -1, y: 0 })
    const back = new THREE.Vector3(-1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    expect(back.x).toBeCloseTo(-1, 6)
    expect(Math.cos(yaw - facingYaw(270))).toBeCloseTo(1, 6)
    for (const toward of [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ]) {
      const turned = new THREE.Vector3(-1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), ladderModelYaw(toward))
      expect(turned.x).toBeCloseTo(toward.x, 6)
      expect(turned.z).toBeCloseTo(toward.y, 6)
    }
  })
})
