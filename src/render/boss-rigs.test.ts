import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { getBoss } from '../data/bosses'
import { TRAINING } from '../data/levels/training'
import { createDefaultTuning } from '../data/tuning'
import { buildLevel } from '../sim/level'
import type { BossState, GameEvent } from '../sim/types'
import { createBoss, createWorld } from '../sim/world'
import { createBossRigs, type BossBody, type BossRig, type DefeatTarget } from './boss-rigs'
import type { ModelKit } from './character-models'
import type { Effects } from './effects'
import { loadModels, nodeMap, socketWorld, type ModelLibrary } from './model-library'
import { CHIEF_RACK } from './chief-rig'
import { launcherSource } from './muzzle-link'
import { CHIEF_DEFEAT, CHIEF_RIG, FALLBACK_DEFEAT, HARVESTER_DEFEAT, HARVESTER_RIG, MORNING_STAR, SCARECROW_DEFEAT } from './themes'

interface FileSystem {
  readFileSync(path: URL): Uint8Array
}

interface GltfNode {
  name?: string
  children?: number[]
  translation?: number[]
  rotation?: number[]
  scale?: number[]
  mesh?: number
}

interface GltfMaterial {
  name?: string
  emissiveFactor?: number[]
  alphaMode?: string
}

interface Gltf {
  nodes: GltfNode[]
  meshes: { primitives: { material?: number }[] }[]
  materials: GltfMaterial[]
  scenes: { nodes: number[] }[]
  scene?: number
}

const FS_MODULE = 'node:fs'
const fs = (await import(/* @vite-ignore */ FS_MODULE)) as FileSystem
const ROOT = new URL('../../', import.meta.url)
const STEP = 1 / 60
const tuning = createDefaultTuning()

function readGlb(id: string): Gltf {
  const bytes = fs.readFileSync(new URL(`public/assets/models/${id}.glb`, ROOT))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const length = view.getUint32(12, true)
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))) as Gltf
}

function skeleton(id: string): THREE.Object3D {
  const gltf = readGlb(id)
  const geometry = new THREE.BufferGeometry()
  const materials = gltf.materials.map((entry) => {
    const material = new THREE.MeshStandardMaterial()
    material.name = entry.name ?? ''
    if (entry.emissiveFactor?.some((value) => value > 0)) material.emissive.fromArray(entry.emissiveFactor)
    if (entry.alphaMode === 'BLEND') material.transparent = true
    return material
  })
  const build = (index: number): THREE.Object3D => {
    const node = gltf.nodes[index]
    const object = new THREE.Object3D()
    object.name = node.name ?? ''
    object.userData.name = node.name
    object.position.fromArray(node.translation ?? [0, 0, 0])
    object.quaternion.fromArray(node.rotation ?? [0, 0, 0, 1])
    object.scale.fromArray(node.scale ?? [1, 1, 1])
    if (node.mesh !== undefined) {
      for (const primitive of gltf.meshes[node.mesh].primitives) object.add(new THREE.Mesh(geometry, materials[primitive.material ?? 0]))
    }
    for (const child of node.children ?? []) object.add(build(child))
    return object
  }
  const scene = new THREE.Group()
  for (const index of gltf.scenes[gltf.scene ?? 0].nodes) scene.add(build(index))
  return scene
}

function library(): Promise<ModelLibrary> {
  return loadModels(['scarecrow', 'harvester', 'shard-morning'], async (id) => skeleton(id))
}

function effects() {
  return { puff: vi.fn<Effects['puff']>(), burst: vi.fn<Effects['burst']>(), update: vi.fn<Effects['update']>(), clear: vi.fn<Effects['clear']>() }
}

function fakeKit(): ModelKit {
  return {
    buildKai: () => {
      throw new Error('not used')
    },
    buildRobot: () => ({ lift: null, lamps: [] }),
    decorateScarecrow: () => {},
    buildReaper: (_body, turn) => {
      const reel = new THREE.Group()
      const shard = new THREE.Object3D()
      shard.scale.set(0.5, 0.62, 0.5)
      turn.add(reel, shard)
      return { reel, shard }
    },
  }
}

function shell() {
  const root = new THREE.Group()
  const body = new THREE.Group()
  const pivot = new THREE.Group()
  body.add(pivot)
  root.add(body)
  const material = new THREE.MeshStandardMaterial()
  const view: BossBody = { body, pivot, material, materials: [material], owned: [] }
  return { root, view }
}

function bossState(id: string, patch: Partial<BossState> = {}): BossState {
  const world = createWorld(buildLevel(TRAINING), tuning)
  const state = createBoss(world, id, { x: 0, y: 0 }, 0).boss
  if (!state) throw new Error('no boss state')
  return Object.assign(state, patch)
}

function run(rig: BossRig, state: BossState, seconds: number, clock = 0): number {
  let time = clock
  for (let t = 0; t < seconds - 1e-9; t += STEP) {
    time += STEP
    rig.sync(state, time, STEP)
  }
  return time
}

function turnOf(node: THREE.Object3D | undefined): THREE.Euler {
  if (!node) throw new Error('missing node')
  return new THREE.Euler().setFromQuaternion(node.quaternion)
}

function heightOf(node: THREE.Object3D | undefined): number {
  if (!node) throw new Error('missing node')
  return socketWorld(node, new THREE.Vector3()).y
}

describe('boss rigs', () => {
  it('falls back to primitives without models and keeps the shard at its own size', () => {
    const { view } = shell()
    const rig = createBossRigs(fakeKit()).build(getBoss('harvester'), view)
    const shard = view.pivot.children[1]
    const reel = view.pivot.children[0]
    run(rig, bossState('harvester', { phase: 'dormant' }), 1)
    expect(shard.scale.x).toBeGreaterThan(0.5 * 0.9)
    expect(shard.scale.x).toBeLessThan(0.5 * 1.1)
    expect(shard.scale.y).toBeGreaterThan(0.62 * 0.9)
    expect(reel.rotation.z).toBeCloseTo(-HARVESTER_RIG.reel.idle, 5)
  })

  it('builds the harvester from its model with the morning star hung on socket_star', async () => {
    const models = await library()
    const { view } = shell()
    const rig = createBossRigs(fakeKit(), models).build(getBoss('harvester'), view)
    const nodes = nodeMap(view.pivot)
    expect(nodes.get('star')?.visible).toBe(false)
    const socket = nodes.get('socket_star')
    if (!socket) throw new Error('no socket_star')
    const crystal = nodeMap(socket).get('crystal')
    expect(crystal).toBeDefined()
    expect(turnOf(crystal).z).toBeGreaterThanOrEqual(1.05)
    expect(turnOf(crystal).z).toBeLessThanOrEqual(1.3)
    expect(rig.starHeight).toBeCloseTo(3.02, 2)
    expect(view.owned).toHaveLength(2)
    expect(view.materials.length).toBeGreaterThan(5)
    expect(view.materials.some((material) => material.emissive.getHex() !== 0 && material.emissiveIntensity > 0)).toBe(false)
    let glass = 0
    nodes.get('glass_cockpit')?.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      glass++
      expect(mesh.castShadow).toBe(false)
      expect((mesh.material as THREE.Material).depthWrite).toBe(false)
    })
    expect(glass).toBeGreaterThan(0)
  })

  it('rolls each wheel by the distance driven over its radius and spins the reel by dt', async () => {
    const models = await library()
    const { root, view } = shell()
    const rig = createBossRigs(fakeKit(), models).build(getBoss('harvester'), view)
    const nodes = nodeMap(view.pivot)
    const dormant = bossState('harvester', { phase: 'dormant' })
    rig.sync(dormant, 0, 0.02)
    expect(turnOf(nodes.get('reel')).z).toBeCloseTo(-HARVESTER_RIG.reel.idle * 0.02, 6)
    rig.sync(dormant, 0.02, 0.04)
    expect(turnOf(nodes.get('reel')).z).toBeCloseTo(-HARVESTER_RIG.reel.idle * 0.06, 6)
    const front = nodes.get('wheel_fl')?.position.y ?? 0
    const rear = nodes.get('wheel_rr')?.position.y ?? 0
    expect(front).toBeCloseTo(0.301, 3)
    expect(rear).toBeCloseTo(0.556, 3)
    root.position.x += 0.4
    rig.sync(dormant, 0.06, STEP)
    expect(turnOf(nodes.get('wheel_fl')).z).toBeCloseTo(-0.4 / front, 5)
    expect(turnOf(nodes.get('wheel_rr')).z).toBeCloseTo(-0.4 / rear, 5)
    view.pivot.rotation.y = -Math.PI / 2
    root.position.z += 0.3
    rig.sync(dormant, 0.08, STEP)
    expect(turnOf(nodes.get('wheel_rr')).z).toBeCloseTo(-0.7 / rear, 5)
    root.position.x += 50
    rig.sync(dormant, 0.1, STEP)
    expect(turnOf(nodes.get('wheel_rr')).z).toBeCloseTo(-0.7 / rear, 5)
  })

  it('lifts the unloader to about 80 degrees so bales leave socket_bale near 3.45 m, and kicks on each toss', async () => {
    const models = await library()
    const { view } = shell()
    const fx = effects()
    const def = getBoss('harvester')
    const rig = createBossRigs(fakeKit(), models, fx).build(def, view)
    const nodes = nodeMap(view.pivot)
    const bales = def.bales
    if (!bales) throw new Error('harvester has no bales')
    const state = bossState('harvester', { phase: 'telegraph', move: 'bales', timer: bales.windup })
    rig.sync(state, 0, STEP)
    expect(turnOf(nodes.get('unloader')).z).toBeCloseTo(0, 5)
    state.phase = 'active'
    state.timer = 0
    rig.sync(state, STEP, STEP)
    expect(turnOf(nodes.get('unloader')).z).toBeCloseTo(HARVESTER_RIG.balePitch, 5)
    const release = heightOf(nodes.get('socket_bale'))
    expect(release).toBeGreaterThan(3.4)
    expect(release).toBeLessThan(3.52)
    const shot: GameEvent = { type: 'enemyShot', x: 0, y: 0, z: 1, angle: 1, pitch: 0, weapon: bales.weapon }
    rig.handle(shot)
    expect(fx.puff).toHaveBeenCalledTimes(1)
    rig.sync(state, 2 * STEP, STEP)
    expect(turnOf(nodes.get('unloader')).z).toBeGreaterThan(HARVESTER_RIG.balePitch + 0.1)
    run(rig, state, 1, 3 * STEP)
    const settled = turnOf(nodes.get('unloader'))
    expect(settled.z).toBeCloseTo(HARVESTER_RIG.balePitch, 2)
    expect(settled.y).toBeCloseTo(-1, 2)
    state.phase = 'recover'
    state.timer = 0
    run(rig, state, 2)
    expect(turnOf(nodes.get('unloader')).z).toBeCloseTo(0, 2)
    expect(turnOf(nodes.get('unloader')).y).toBeCloseTo(0, 2)
  })

  it('ignores bale tosses and slams that come from somewhere else', async () => {
    const models = await library()
    const { view } = shell()
    const fx = effects()
    const def = getBoss('harvester')
    const rig = createBossRigs(fakeKit(), models, fx).build(def, view)
    rig.handle({ type: 'enemyShot', x: 9, y: 9, z: 1, angle: 1, pitch: 0, weapon: 'baleToss' })
    rig.handle({ type: 'enemyShot', x: 0, y: 0, z: 1, angle: 1, pitch: 0, weapon: 'strawFan' })
    expect(fx.puff).not.toHaveBeenCalled()
  })

  it('smokes from the exhaust in the third phase only', async () => {
    const models = await library()
    const { view } = shell()
    const fx = effects()
    const rig = createBossRigs(fakeKit(), models, fx).build(getBoss('harvester'), view)
    run(rig, bossState('harvester', { phase: 'walk', phaseIndex: 1 }), 1)
    expect(fx.puff).not.toHaveBeenCalled()
    run(rig, bossState('harvester', { phase: 'walk', phaseIndex: 2 }), 1)
    expect(fx.puff.mock.calls.length).toBeGreaterThan(3)
    const exhaust = heightOf(nodeMap(view.pivot).get('socket_fx_exhaust'))
    expect(fx.puff.mock.calls[0][1]).toBeCloseTo(exhaust, 1)
  })

  it('spins the morning star slowly about the vertical and pulses its holder', async () => {
    const models = await library()
    const { view } = shell()
    const rig = createBossRigs(fakeKit(), models).build(getBoss('harvester'), view)
    const socket = nodeMap(view.pivot).get('socket_star')
    const holder = socket?.children[0]
    const shardRoot = holder?.children[0]
    if (!holder || !shardRoot) throw new Error('no holder')
    run(rig, bossState('harvester', { phase: 'walk' }), 1)
    expect(shardRoot.rotation.y).toBeCloseTo(MORNING_STAR.spin, 1)
    expect(shardRoot.scale.x).toBeCloseTo(MORNING_STAR.scale, 5)
    expect(Math.abs(holder.scale.x - 1)).toBeLessThanOrEqual(MORNING_STAR.pulse + 1e-9)
    expect(holder.position.x).toBeCloseTo(MORNING_STAR.forward, 5)
  })

  it('builds the scarecrow from its model with the stun stars over socket_head', async () => {
    const models = await library()
    const { view } = shell()
    const rig = createBossRigs(fakeKit(), models).build(getBoss('scarecrow'), view)
    expect(rig.starHeight).toBeCloseTo(3.6, 1)
    expect(nodeMap(view.pivot).has('pitchfork')).toBe(true)
  })

  it('leans the scarecrow forward and swings its arms back for a charge', async () => {
    const models = await library()
    const { root, view } = shell()
    const def = getBoss('scarecrow')
    const rig = createBossRigs(fakeKit(), models).build(def, view)
    const nodes = nodeMap(view.pivot)
    const model = view.pivot.children[0]
    const state = bossState('scarecrow', { phase: 'active', move: 'charge' })
    for (let i = 0; i < 40; i++) {
      root.position.x += def.charge.speed * STEP
      rig.sync(state, i * STEP, STEP)
    }
    expect(model.rotation.z).toBeLessThan(-0.25)
    expect(turnOf(nodes.get('arm_r')).z).toBeLessThan(-0.6)
    expect(turnOf(nodes.get('arm_l')).z).toBeLessThan(-0.6)
    expect(Math.abs(turnOf(nodes.get('leg_l')).z)).toBeGreaterThan(0.01)
  })

  it('raises the scarecrow arms over the slam windup and brings them down on the blast', async () => {
    const models = await library()
    const { view } = shell()
    const fx = effects()
    const def = getBoss('scarecrow')
    const rig = createBossRigs(fakeKit(), models, fx).build(def, view)
    const nodes = nodeMap(view.pivot)
    const windup = tuning.weapons.strawSlam.windup
    const state = bossState('scarecrow', { phase: 'walk' })
    run(rig, state, 0.5)
    state.phase = 'telegraph'
    state.move = 'slam'
    const elbow = () => heightOf(nodes.get('arm_l_lower')) - heightOf(nodes.get('arm_l'))
    const resting = elbow()
    expect(resting).toBeLessThan(-0.3)
    const lifts: number[] = []
    let clock = 0.5
    for (let left = windup; left > 0; left -= STEP) {
      state.timer = left
      clock += STEP
      rig.sync(state, clock, STEP)
      lifts.push(elbow())
    }
    expect(lifts[lifts.length - 1]).toBeGreaterThan(0.25)
    expect(lifts[lifts.length - 1]).toBeGreaterThan(lifts[Math.floor(lifts.length / 3)])
    const hat = nodes.get('hat')
    const hatRest = hat?.position.y ?? 0
    state.phase = 'recover'
    state.timer = def.slam?.recover ?? 0.8
    rig.handle({ type: 'blast', x: 0, y: 0, z: 0, radius: 2.8, source: 'boss' })
    run(rig, state, 0.1, clock)
    const down = elbow()
    expect(down).toBeLessThan(0)
    expect(down).toBeGreaterThan(resting)
    const shoulder = socketWorld(nodes.get('arm_l') ?? view.pivot, new THREE.Vector3())
    const reach = socketWorld(nodes.get('arm_l_lower') ?? view.pivot, new THREE.Vector3())
    expect(reach.x - shoulder.x).toBeGreaterThan(0.25)
    expect(hat?.position.y).toBeGreaterThan(hatRest)
  })

  it('puffs straw from socket_muzzle for every fan volley and bounces the hat when hit', async () => {
    const models = await library()
    const { view } = shell()
    const fx = effects()
    const def = getBoss('scarecrow')
    const rig = createBossRigs(fakeKit(), models, fx).build(def, view)
    const nodes = nodeMap(view.pivot)
    const state = bossState('scarecrow', { phase: 'active', move: 'fan' })
    run(rig, state, 0.3)
    rig.handle({ type: 'enemyShot', x: 1, y: 0, z: 1, angle: 0, pitch: 0, weapon: 'strawFan' })
    rig.handle({ type: 'enemyShot', x: 1, y: 0, z: 1, angle: 0, pitch: 0, weapon: 'strawFan' })
    expect(fx.puff).toHaveBeenCalledTimes(2)
    const muzzle = socketWorld(nodes.get('socket_muzzle') ?? view.pivot, new THREE.Vector3())
    const [x, height, y] = fx.puff.mock.calls[0]
    expect(x).toBeCloseTo(muzzle.x, 5)
    expect(height).toBeCloseTo(muzzle.y, 5)
    expect(y).toBeCloseTo(muzzle.z, 5)
    const hat = nodes.get('hat')
    const rest = hat?.position.y ?? 0
    rig.handle({ type: 'enemyHit', id: 1, x: 0, y: 0, z: 1, damage: 50, crit: false })
    rig.sync(state, 0.4, STEP)
    expect(hat?.position.y).toBeGreaterThan(rest + 0.05)
    run(rig, state, 2, 0.4)
    expect(hat?.position.y).toBeCloseTo(rest, 2)
  })
})

describe('boss defeat shows', () => {
  const D = HARVESTER_DEFEAT
  const F = SCARECROW_DEFEAT
  const DEG = Math.PI / 180

  function play(rig: BossRig, from: number, to: number, target: DefeatTarget | null = null): number {
    let time = from
    for (; time <= to + 1e-9; time += STEP) rig.defeat(time, target)
    return time - STEP
  }

  function need(node: THREE.Object3D | undefined): THREE.Object3D {
    if (!node) throw new Error('missing node')
    return node
  }

  function opacities(root: THREE.Object3D): number[] {
    const values: number[] = []
    root.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) values.push(material.opacity)
    })
    return values
  }

  it('ejects the harvester pilot only after the unloader is up and the roof has flown clear, as the model notes require', async () => {
    const models = await library()
    const { root, view } = shell()
    const rig = createBossRigs(fakeKit(), models, effects()).build(getBoss('harvester'), view)
    expect(rig.defeatSeconds).toBe(D.seconds)
    const nodes = nodeMap(view.pivot)
    const roof = need(nodes.get('cockpit_roof'))
    const seat = need(nodes.get('seat'))
    const cockpit = need(nodes.get('cockpit'))
    const unloader = need(nodes.get('unloader'))
    const roofRest = roof.position.clone()
    const seatRest = seat.position.clone()
    const roofTurn = roof.quaternion.clone()
    const seatTurn = seat.quaternion.clone()
    let roofFlew = false
    let seatFlew = false
    let roofGone = -1
    let seatGone = -1
    for (let time = 0; time <= D.seconds; time += STEP) {
      rig.defeat(time, null)
      const pitch = turnOf(unloader).z
      expect(pitch).toBeLessThanOrEqual(1.75 + 1e-6)
      if (roof.parent === cockpit) {
        const moved = roof.position.clone().sub(roofRest)
        if (moved.length() > 1e-6) {
          roofFlew = true
          expect(pitch).toBeGreaterThanOrEqual(1.4)
          expect(Math.abs(turnOf(unloader).y)).toBeLessThan(1e-6)
          const angle = Math.atan2(moved.y, moved.x)
          expect(angle).toBeGreaterThanOrEqual(30 * DEG)
          expect(angle).toBeLessThanOrEqual(45 * DEG)
          expect(Math.abs(moved.z)).toBeLessThan(1e-9)
          expect(moved.length()).toBeLessThanOrEqual(D.roofClear + 1e-9)
          expect(roof.quaternion.angleTo(roofTurn)).toBeLessThan(1e-9)
        }
        expect(seat.position.distanceTo(seatRest)).toBeLessThan(1e-9)
      } else if (roofGone < 0) roofGone = time
      if (seat.parent === cockpit) {
        const moved = seat.position.clone().sub(seatRest)
        if (moved.length() > 1e-6) {
          seatFlew = true
          expect(roof.parent).toBe(root)
          expect(pitch).toBeGreaterThanOrEqual(1.4)
          expect(Math.hypot(moved.x, moved.z)).toBeLessThan(1e-9)
          expect(moved.y).toBeLessThanOrEqual(D.seatClear + 1e-9)
          expect(seat.quaternion.angleTo(seatTurn)).toBeLessThan(1e-9)
        }
      } else if (seatGone < 0) seatGone = time
    }
    expect(roofFlew && seatFlew).toBe(true)
    expect(roofGone).toBeGreaterThan(0)
    expect(seatGone).toBeGreaterThan(roofGone)
    expect(roof.parent).toBe(root)
    expect(roof.position.y).toBeCloseTo(D.roofRest, 5)
    expect(seat.parent).toBe(root)
    expect(seat.visible).toBe(false)
    expect(nodeMap(seat).has('pilot')).toBe(true)
  })

  it('stalls the harvester, drops the morning star and flies it to the player, then fades the wreck away', async () => {
    const models = await library()
    const { root, view } = shell()
    const fx = effects()
    const rig = createBossRigs(fakeKit(), models, fx).build(getBoss('harvester'), view)
    const nodes = nodeMap(view.pivot)
    run(rig, bossState('harvester', { phase: 'active', move: 'charge' }), 1)
    const holder = need(nodes.get('socket_star')).children[0]
    const last = play(rig, 0, 1)
    const puffs = fx.puff.mock.calls.length
    expect(puffs).toBeGreaterThan(5)
    rig.defeat(last, null)
    rig.defeat(last, null)
    expect(fx.puff.mock.calls.length).toBe(puffs)
    expect(root.children.some((child) => child instanceof THREE.InstancedMesh)).toBe(true)
    play(rig, 1, D.reelStop + 0.2)
    const stopped = turnOf(nodes.get('reel')).z
    const landed = play(rig, D.reelStop + 0.2 + STEP, D.shardPop + D.shardFlight + 0.1)
    expect(turnOf(nodes.get('reel')).z).toBeCloseTo(stopped, 9)
    expect(holder.parent).toBe(root)
    expect(Math.abs(holder.position.y - D.shardHover)).toBeLessThanOrEqual(D.shardBob + 1e-6)
    const target = { x: 6, y: 2 }
    play(rig, landed + STEP, D.shardCollect + D.shardCollectSeconds + 0.05, target)
    expect(holder.visible).toBe(false)
    const end = play(rig, D.shardCollect + D.shardCollectSeconds + 0.1, D.seconds - STEP, target)
    expect(end).toBeLessThan(D.seconds)
    rig.defeat(D.seconds, target)
    const faded = opacities(view.pivot)
    expect(faded.length).toBeGreaterThan(5)
    expect(Math.max(...faded)).toBeLessThan(1e-6)
  })

  it('knocks the scarecrow onto its back, sends the hat flying and lays the pitchfork flat', async () => {
    const models = await library()
    const { root, view } = shell()
    const fx = effects()
    const rig = createBossRigs(fakeKit(), models, fx).build(getBoss('scarecrow'), view)
    expect(rig.defeatSeconds).toBe(F.seconds)
    const nodes = nodeMap(view.pivot)
    const hat = need(nodes.get('hat'))
    const fork = need(nodes.get('pitchfork'))
    const body = view.pivot.children[0]
    run(rig, bossState('scarecrow', { phase: 'walk' }), 0.5)
    play(rig, 0, F.fall + F.fallSeconds + F.settle + F.forkFall)
    expect(body.rotation.z).toBeCloseTo(F.fallAngle, 3)
    expect(hat.parent).toBe(root)
    expect(hat.position.y).toBeCloseTo(F.hatRest, 5)
    expect(Math.hypot(hat.position.x, hat.position.z)).toBeGreaterThan(1)
    expect(fork.parent).toBe(root)
    const shaft = new THREE.Vector3(0, 1, 0).applyQuaternion(fork.quaternion)
    expect(Math.abs(shaft.y)).toBeLessThan(0.02)
    const tip = new THREE.Vector3(0, F.forkTip, 0).applyQuaternion(fork.quaternion).add(fork.position)
    expect(tip.y).toBeCloseTo(F.forkLie, 3)
    expect(fx.puff.mock.calls.length).toBeGreaterThan(10)
    expect(fx.burst).toHaveBeenCalled()
    rig.handle({ type: 'enemyHit', id: 1, x: 0, y: 0, z: 1, damage: 50, crit: false })
    rig.defeat(F.seconds, null)
    expect(Math.max(...opacities(view.pivot))).toBeLessThan(1e-6)
  })

  it('topples and shrinks the primitive fallbacks when no model is loaded', () => {
    for (const id of ['scarecrow', 'harvester']) {
      const { view } = shell()
      const fx = effects()
      const rig = createBossRigs(fakeKit(), undefined, fx).build(getBoss(id), view)
      expect(rig.defeatSeconds).toBe(FALLBACK_DEFEAT.seconds)
      play(rig, 0, FALLBACK_DEFEAT.toppleSeconds)
      if (id === 'scarecrow') expect(view.body.rotation.z).toBeCloseTo(FALLBACK_DEFEAT.topple, 5)
      else expect(view.body.position.y).toBeCloseTo(-FALLBACK_DEFEAT.sink, 5)
      rig.defeat(FALLBACK_DEFEAT.seconds, null)
      expect(view.body.scale.x).toBeLessThan(0.01)
      expect(fx.puff).toHaveBeenCalled()
      expect(fx.burst).toHaveBeenCalledTimes(2)
    }
  })
})

describe('demolition chief rig', () => {
  const R = CHIEF_RIG
  const C = CHIEF_DEFEAT
  const def = getBoss('demo-chief')
  const MAX_RAISE = (120 * Math.PI) / 180

  function chief(): Promise<ModelLibrary> {
    return loadModels(['demo-chief'], async (id) => skeleton(id))
  }

  function staged() {
    const scene = new THREE.Scene()
    const parts = shell()
    scene.add(parts.root)
    return { scene, ...parts }
  }

  function node(view: BossBody, name: string): THREE.Object3D {
    const found = nodeMap(view.pivot).get(name)
    if (!found) throw new Error(`missing ${name}`)
    return found
  }

  it('builds the chief from its model, hangs the stun stars over socket_head and hands its bombs to the projectile views', async () => {
    const models = await chief()
    const { scene, view } = staged()
    const rig = createBossRigs(fakeKit(), models).build(def, view)
    expect(rig.starHeight).toBeCloseTo(2.683, 2)
    expect(rig.defeatSeconds).toBeCloseTo((def.show?.lay ?? 0) + (def.show?.fall ?? 0) + C.lie + C.fade, 6)
    const launcher = launcherSource(scene, 'chiefBomb')
    expect(launcher).not.toBeNull()
    const hand = launcher?.muzzle(new THREE.Vector3())
    expect(hand?.distanceTo(socketWorld(node(view, 'socket_hand_r'), new THREE.Vector3()))).toBeLessThan(1e-9)
    for (const item of view.owned) item.dispose()
    expect(launcherSource(scene, 'chiefBomb')).toBeNull()
  })

  it('shows as many bombs on the rack as the boss has left, emptying it from the right end', async () => {
    const models = await chief()
    const { view } = staged()
    const rig = createBossRigs(fakeKit(), models).build(def, view)
    run(rig, bossState('demo-chief', { phase: 'walk', bombs: 5 }), 0.1)
    const shown = CHIEF_RACK.map((name) => node(view, name).visible)
    expect(shown).toEqual([false, false, false, true, true, true, true, true])
    run(rig, bossState('demo-chief', { phase: 'walk', bombs: 8 }), 0.1)
    expect(CHIEF_RACK.every((name) => node(view, name).visible)).toBe(true)
  })

  it('raises the right arm for a toss, hides the bomb in the claw on release and lets it reappear', async () => {
    const models = await chief()
    const { view } = staged()
    const rig = createBossRigs(fakeKit(), models).build(def, view)
    const arm = node(view, 'arm_r')
    const held = node(view, 'bomb_hand')
    let clock = run(rig, bossState('demo-chief', { phase: 'walk' }), 0.2)
    const rest = turnOf(arm).z
    const windup = def.bales?.windup ?? 0
    clock = run(rig, bossState('demo-chief', { phase: 'telegraph', move: 'bales', timer: 0 }), 0.6, clock)
    const raised = turnOf(arm).z
    expect(raised - rest).toBeGreaterThan(1.5)
    expect(raised).toBeLessThanOrEqual(MAX_RAISE)
    expect(windup).toBeGreaterThan(0)
    expect(held.visible).toBe(true)
    rig.handle({ type: 'enemyShot', x: 0, y: 0, z: 1, angle: 0, pitch: 0, weapon: 'chiefBomb' })
    const active = bossState('demo-chief', { phase: 'active', move: 'bales', balesLeft: 2 })
    clock = run(rig, active, R.snap, clock)
    expect(held.visible).toBe(false)
    expect(turnOf(arm).z).toBeLessThan(raised - 0.5)
    run(rig, active, R.rehide, clock)
    expect(held.visible).toBe(true)
  })

  it('kicks the cannon back and flashes socket_muzzle on every cannon shot, ignoring shots from elsewhere', async () => {
    const models = await chief()
    const { view } = staged()
    const fx = effects()
    const rig = createBossRigs(fakeKit(), models, fx).build(def, view)
    const cannon = node(view, 'cannon')
    const firing = bossState('demo-chief', { phase: 'active', move: 'cannon', shotsLeft: 4 })
    let clock = run(rig, firing, 0.3)
    const rest = cannon.position.x
    const puffs = fx.puff.mock.calls.length
    rig.handle({ type: 'enemyShot', x: 9, y: 9, z: 1, angle: 0, pitch: 0, weapon: 'chiefCannon' })
    clock = run(rig, firing, STEP, clock)
    expect(cannon.position.x).toBeCloseTo(rest, 6)
    rig.handle({ type: 'enemyShot', x: 0, y: 0, z: 1, angle: 0, pitch: 0, weapon: 'chiefCannon' })
    run(rig, firing, STEP, clock)
    expect(cannon.position.x).toBeLessThan(rest - R.cannonSlide * 0.5)
    const muzzle = socketWorld(node(view, 'socket_muzzle'), new THREE.Vector3())
    const flashes = fx.puff.mock.calls.slice(puffs).filter(([x, y, z, color]) => color === R.flash && Math.hypot(x - muzzle.x, y - muzzle.y, z - muzzle.z) < 0.2)
    expect(flashes).toHaveLength(1)
  })

  it('lays the bombs on the ground in a row in front of itself, then falls on its back and fades out', async () => {
    const models = await chief()
    const { root, view } = staged()
    const fx = effects()
    const rig = createBossRigs(fakeKit(), models, fx).build(def, view)
    view.pivot.rotation.y = -Math.PI / 2
    run(rig, bossState('demo-chief', { phase: 'walk' }), 0.2)
    const show = def.show
    if (!show) throw new Error('no defeat show')
    for (let time = 0; time <= show.lay + C.bombFlight + 1e-9; time += STEP) rig.defeat(time, null)
    const heading = new THREE.Vector3(1, 0, 0).applyQuaternion(view.pivot.quaternion)
    const bombs = CHIEF_RACK.map((name) => nodeMap(root).get(name) ?? null)
    expect(bombs.every((bomb) => bomb?.parent === root)).toBe(true)
    for (const bomb of bombs) {
      expect(bomb?.position.y).toBeCloseTo(C.bombRest, 5)
      expect(bomb?.position.dot(heading)).toBeCloseTo(C.bombForward, 5)
    }
    const sides = bombs.map((bomb) => bomb?.position.x ?? 0).sort((a, b) => a - b)
    for (let i = 1; i < sides.length; i++) expect(sides[i] - sides[i - 1]).toBeCloseTo(C.bombSpacing, 5)
    const model = view.pivot.children[0]
    for (let time = show.lay + C.bombFlight; time <= show.lay + show.fall + 0.05; time += STEP) rig.defeat(time, null)
    expect(model.rotation.z).toBeCloseTo(C.fallAngle, 1)
    expect(model.position.y).toBeGreaterThan(0)
    expect(fx.burst).toHaveBeenCalled()
    rig.defeat(rig.defeatSeconds, null)
    const faded: number[] = []
    model.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (mesh.isMesh) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) faded.push(material.opacity)
    })
    expect(Math.max(...faded)).toBeLessThan(1e-6)
  })
})
