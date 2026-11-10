import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { TRAINING } from '../data/levels/training'
import { createDefaultTuning } from '../data/tuning'
import { buildLevel } from '../sim/level'
import { createWorld } from '../sim/world'
import type { ModelKit, PlayerModel } from './character-models'
import type { Effects } from './effects'
import { kaiFromModel } from './kai-model'
import { EMPTY_LIBRARY, loadModels, restQuaternion } from './model-library'
import { muzzleSource } from './muzzle-link'
import { createPlayerView } from './player-view'
import type { Stage } from './stage'
import { KAI_DEATH } from './themes'

type Triple = [number, number, number]

function joint(name: string, parent: THREE.Object3D, position: Triple, mesh = true): THREE.Object3D {
  const node = mesh ? new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), new THREE.MeshStandardMaterial()) : new THREE.Object3D()
  node.userData.name = name
  node.position.set(...position)
  parent.add(node)
  return node
}

function kaiScene(): THREE.Object3D {
  const root = new THREE.Group()
  root.userData.name = 'root'
  const hips = joint('hips', root, [0, 0.6, 0])
  const legL = joint('leg_l', hips, [0, -0.04, -0.065])
  joint('leg_l_lower', legL, [-0.008, -0.21, -0.05])
  const legR = joint('leg_r', hips, [0, -0.04, 0.065])
  joint('leg_r_lower', legR, [-0.008, -0.21, 0.05])
  const torso = joint('torso', hips, [-0.01, 0.04, 0])
  const armL = joint('arm_l', torso, [-0.02, 0.18, -0.132])
  const forearmL = joint('arm_l_lower', armL, [-0.01, -0.155, -0.043])
  joint('hand_l', forearmL, [0.028, -0.105, -0.025])
  const armR = joint('arm_r', torso, [-0.02, 0.18, 0.132])
  const forearmR = joint('arm_r_lower', armR, [-0.07, -0.14, 0.033])
  const hand = joint('hand_r', forearmR, [0.07, 0.055, 0.047])
  const socket = joint('socket_weapon', hand, [0.03, 0.037, 0.026], false)
  socket.quaternion.set(0, -Math.SQRT1_2, 0, Math.SQRT1_2)
  joint('weapon_default', socket, [0, 0, 0])
  joint('head', torso, [-0.02, 0.235, 0])
  const scarf = joint('scarf_1', torso, [-0.09, 0.22, 0.04])
  joint('scarf_1_2', scarf, [-0.1, -0.12, 0.12])
  return root
}

function plainKai(): PlayerModel {
  const root = new THREE.Group()
  const material = new THREE.MeshStandardMaterial({ transparent: true })
  root.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.2, 0.4), material))
  return { root, materials: [material], tintable: [material], nodes: new Map(), scarf: [], rig: null, mount: null }
}

async function setup(rigged = true) {
  const library = rigged ? await loadModels(['kai'], async () => kaiScene()) : EMPTY_LIBRARY
  const kai = rigged ? kaiFromModel(library.instance('kai')) : plainKai()
  const kit = { buildKai: () => kai } as unknown as ModelKit
  const scene = new THREE.Scene()
  const stage = { scene, addTrauma: vi.fn() } as unknown as Stage
  const effects: Effects = { puff: vi.fn(), burst: vi.fn(), sparks: vi.fn(), smoke: vi.fn(), explosion: vi.fn(), update: vi.fn(), clear: vi.fn() }
  const tuning = createDefaultTuning()
  const view = createPlayerView(stage, tuning, effects, kit, library)
  const world = createWorld(buildLevel(TRAINING), tuning)
  world.player.facing = 0.4
  return { scene, effects, view, world, kai }
}

function play(view: ReturnType<typeof createPlayerView>, world: ReturnType<typeof createWorld>, seconds: number, step = 1 / 60): void {
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += step) {
    world.time += step
    view.sync(world, 1, step, world.time)
  }
}

function upright(object: THREE.Object3D): number {
  object.updateWorldMatrix(true, false)
  const up = new THREE.Vector3(0, 1, 0).transformDirection(object.matrixWorld)
  return up.angleTo(new THREE.Vector3(0, 1, 0))
}

function heldGun(kai: PlayerModel): THREE.Object3D | undefined {
  return kai.mount?.children.find((child) => child.visible && child.userData.name !== 'weapon_default')
}

describe('player view', () => {
  it('shares the held gun muzzle only while kai is alive and drawn', async () => {
    const { scene, view, world } = await setup()
    const source = muzzleSource(scene)
    expect(source).not.toBeNull()
    expect(source?.muzzle(new THREE.Vector3())).toBeNull()
    play(view, world, 0.2)
    const muzzle = source?.muzzle(new THREE.Vector3())
    expect(muzzle).not.toBeNull()
    const { pos } = world.player
    expect(Math.hypot(muzzle!.x - pos.x, muzzle!.z - pos.y)).toBeLessThan(1.2)
    expect(muzzle!.y).toBeGreaterThan(0.5)
    world.player.alive = false
    play(view, world, 0.05)
    expect(source?.muzzle(new THREE.Vector3())).toBeNull()
  })

  it('knocks kai onto his back, drops the gun, and stands him back up on reset', async () => {
    const { scene, effects, view, world, kai } = await setup()
    play(view, world, 0.3)
    const gun = heldGun(kai)
    expect(gun).toBeDefined()
    expect(upright(kai.root)).toBeCloseTo(0)
    world.player.alive = false
    view.handle({ type: 'playerDied', x: world.player.pos.x, y: world.player.pos.y, attack: null })
    play(view, world, KAI_DEATH.fallEnd + KAI_DEATH.settle + 0.5)
    expect(upright(kai.root)).toBeGreaterThan(1.2)
    expect(gun?.parent).not.toBe(kai.mount)
    const rest = gun!.getWorldPosition(new THREE.Vector3())
    expect(rest.y).toBeLessThan(0.15)
    const leg = kai.nodes.get('leg_l_lower')!
    expect(leg.quaternion.angleTo(restQuaternion(leg))).toBeGreaterThan(0.5)
    expect(vi.mocked(effects.puff).mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(scene.children.every((child) => child.visible)).toBe(true)

    view.reset()
    world.player.alive = true
    play(view, world, 0.1)
    expect(upright(kai.root)).toBeCloseTo(0)
    expect(gun?.parent).toBe(kai.mount)
    expect(leg.quaternion.angleTo(restQuaternion(leg))).toBeLessThan(0.3)
    expect(kai.nodes.get('head')!.quaternion.angleTo(restQuaternion(kai.nodes.get('head')!))).toBeCloseTo(0)
    expect(muzzleSource(scene)?.muzzle(new THREE.Vector3())).not.toBeNull()
  })

  it('stands kai back up when a new run starts without a reset', async () => {
    const { view, world, kai } = await setup()
    play(view, world, 0.2)
    world.player.alive = false
    play(view, world, 1.2)
    world.player.alive = true
    play(view, world, 0.05)
    expect(upright(kai.root)).toBeCloseTo(0)
    expect(heldGun(kai)?.parent).toBe(kai.mount)
  })

  it('plays the death from the first frame it sees, however late that is', async () => {
    const { view, world, kai } = await setup()
    play(view, world, 0.2)
    world.player.alive = false
    world.time += 30
    view.sync(world, 1, 1 / 60, world.time)
    expect(upright(kai.root)).toBeCloseTo(0)
    play(view, world, 1.2)
    expect(upright(kai.root)).toBeGreaterThan(1.2)
  })

  it('tips the plain fallback body over and drops its box gun', async () => {
    const { view, world, kai } = await setup(false)
    play(view, world, 0.2)
    world.player.alive = false
    play(view, world, 1.5)
    expect(upright(kai.root)).toBeGreaterThan(1.2)
    view.reset()
    world.player.alive = true
    play(view, world, 0.05)
    expect(upright(kai.root)).toBeCloseTo(0)
  })
})
