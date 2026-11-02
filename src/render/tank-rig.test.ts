import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { getBoss } from '../data/bosses'
import { LEVEL_1_4 } from '../data/levels/level-1-4'
import { createDefaultTuning } from '../data/tuning'
import { buildLevel } from '../sim/level'
import type { BossState } from '../sim/types'
import { createBoss, createWorld } from '../sim/world'
import type { BossBody } from './boss-rigs'
import type { Effects } from './effects'
import { loadModels, type ModelLibrary } from './model-library'
import { TANK_NODES, createTankRig } from './tank-rig'
import { TANK_DEFEAT, TANK_RIG } from './themes'

interface FileSystem {
  readFileSync(path: URL): Uint8Array
}

interface Gltf {
  nodes: { name?: string; children?: number[]; translation?: number[]; rotation?: number[]; mesh?: number }[]
  meshes: { primitives: { material?: number }[] }[]
  materials: {
    name?: string
    emissiveFactor?: number[]
    alphaMode?: string
    pbrMetallicRoughness?: { baseColorTexture?: { index: number }; metallicFactor?: number; roughnessFactor?: number }
  }[]
  textures: { source?: number; extensions?: { KHR_texture_basisu?: { source: number } } }[]
  scenes: { nodes: number[] }[]
  scene?: number
}

const FS_MODULE = 'node:fs'
const fs = (await import(/* @vite-ignore */ FS_MODULE)) as FileSystem
const ROOT = new URL('../../', import.meta.url)
const STEP = 1 / 60
const DEG = Math.PI / 180
const tuning = createDefaultTuning()
const def = getBoss('forest-tank')

function skeleton(): THREE.Object3D {
  const bytes = fs.readFileSync(new URL('public/assets/models/forest-tank.glb', ROOT))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + view.getUint32(12, true)))) as Gltf
  const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2)
  const images = new Map<number, THREE.Texture>()
  const materials = gltf.materials.map((entry) => {
    const material = new THREE.MeshStandardMaterial()
    material.name = entry.name ?? ''
    if (entry.emissiveFactor?.some((value) => value > 0)) material.emissive.fromArray(entry.emissiveFactor)
    const pbr = entry.pbrMetallicRoughness
    material.roughness = pbr?.roughnessFactor ?? 1
    material.metalness = pbr?.metallicFactor ?? 1
    if (entry.alphaMode === 'MASK') material.alphaTest = 0.5
    const texture = pbr?.baseColorTexture
    if (texture) {
      const entry = gltf.textures[texture.index]
      const source = entry.extensions?.KHR_texture_basisu?.source ?? entry.source ?? texture.index
      const image = images.get(source) ?? new THREE.Texture()
      images.set(source, image)
      material.map = image
    }
    return material
  })
  const build = (index: number): THREE.Object3D => {
    const node = gltf.nodes[index]
    const object = new THREE.Object3D()
    object.name = node.name ?? ''
    object.userData.name = node.name
    object.position.fromArray(node.translation ?? [0, 0, 0])
    object.quaternion.fromArray(node.rotation ?? [0, 0, 0, 1])
    if (node.mesh !== undefined) for (const primitive of gltf.meshes[node.mesh].primitives) object.add(new THREE.Mesh(geometry, materials[primitive.material ?? 0]))
    for (const child of node.children ?? []) object.add(build(child))
    return object
  }
  const scene = new THREE.Group()
  for (const index of gltf.scenes[gltf.scene ?? 0].nodes) scene.add(build(index))
  return scene
}

function library(): Promise<ModelLibrary> {
  return loadModels(['forest-tank'], async () => skeleton())
}

function effects() {
  return { puff: vi.fn<Effects['puff']>(), burst: vi.fn<Effects['burst']>(), update: vi.fn<Effects['update']>(), clear: vi.fn<Effects['clear']>() }
}

function shell() {
  const scene = new THREE.Scene()
  const root = new THREE.Group()
  const body = new THREE.Group()
  const pivot = new THREE.Group()
  body.add(pivot)
  root.add(body)
  scene.add(root)
  const material = new THREE.MeshStandardMaterial()
  const view: BossBody = { body, pivot, material, materials: [material], owned: [] }
  return { root, view }
}

function tankState(patch: Partial<BossState> = {}): BossState {
  const world = createWorld(buildLevel(LEVEL_1_4), tuning)
  const state = createBoss(world, 'forest-tank', { x: 0, y: 0 }, 0).boss
  if (!state?.tank) throw new Error('no tank state')
  return Object.assign(state, { phase: 'walk' }, patch)
}

function find(view: BossBody, name: string): THREE.Object3D {
  let found: THREE.Object3D | null = null
  view.pivot.traverse((object) => {
    if (object.userData.name === name) found = object
  })
  if (!found) throw new Error(`missing ${name}`)
  return found
}

function drawn(root: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = []
  const visit = (object: THREE.Object3D) => {
    if (!object.visible) return
    if ((object as THREE.Mesh).isMesh) found.push(object as THREE.Mesh)
    for (const child of object.children) visit(child)
  }
  visit(root)
  return found
}

function stillOf(view: BossBody, name: string): THREE.Mesh[] {
  return find(view, name).children.filter((child): child is THREE.Mesh => (child as THREE.Mesh).isMesh && child.userData.still === true)
}

function maps(view: BossBody, name: string): THREE.Texture[] {
  const found: THREE.Texture[] = []
  find(view, name).traverse((object) => {
    const mesh = object as THREE.Mesh
    if (mesh.isMesh && mesh.material instanceof THREE.MeshStandardMaterial && mesh.material.map) found.push(mesh.material.map)
  })
  return found
}

describe('forest tank rig', () => {
  it('drives the nodes the model contract checks', () => {
    expect(TANK_NODES).toEqual(expect.arrayContaining(['turret', 'barrel_1', 'barrel_2', 'barrel_3', 'lid_l', 'lid_r', 'track_l', 'track_r', 'eye', 'socket_mine', 'socket_head']))
  })

  it('merges the still parts of every moving node into one draw per look', async () => {
    const models = await library()
    const { view } = shell()
    const before = drawn(models.instance('forest-tank').root).length
    createTankRig(def, view, { models, effects: effects(), tuning })
    expect(before).toBe(41)
    expect(drawn(view.pivot)).toHaveLength(16)
    for (const name of ['body', 'turret', 'barrel_1', 'barrel_2', 'barrel_3', 'lid_l', 'lid_r']) expect(stillOf(view, name).length).toBeGreaterThan(0)
    expect(stillOf(view, 'body')).toHaveLength(2)
    const barrel = stillOf(view, 'barrel_1')[0].material as THREE.MeshStandardMaterial
    expect(barrel.roughness).toBe(1)
    expect(barrel.metalness).toBe(1)
    expect(barrel.roughnessMap).toBe(barrel.metalnessMap)
    expect(barrel.roughnessMap?.channel).toBe(1)
    expect(view.materials).toContain(barrel)
    const lookup = (barrel.roughnessMap as THREE.DataTexture).image.data as Uint8Array
    const looks = Array.from({ length: lookup.length / 4 }, (_, i) => [lookup[i * 4 + 1] / 255, lookup[i * 4 + 2] / 255])
    expect(looks).toEqual(
      expect.arrayContaining([
        [expect.closeTo(0.45, 2), expect.closeTo(0.25, 2)],
        [expect.closeTo(0.4, 2), expect.closeTo(0.25, 2)],
        [expect.closeTo(0.5, 2), 0],
        [expect.closeTo(0.55, 2), expect.closeTo(0.25, 2)],
      ]),
    )
    const lit = drawn(view.pivot).map((mesh) => mesh.material as THREE.MeshStandardMaterial)
    expect(lit.filter((material) => material.name === 'mat_eye')).toHaveLength(1)
    expect(lit.filter((material) => material.name === 'mat_emblem')).toHaveLength(1)
    expect(lit.filter((material) => material.name.startsWith('mat_track'))).toHaveLength(2)
  })

  it('keeps the merged barrels, lids and turret moving with their nodes', async () => {
    const models = await library()
    const { view } = shell()
    const rig = createTankRig(def, view, { models, effects: effects(), tuning })
    const state = tankState()
    if (!state.tank) throw new Error('no tank')
    const turret = find(view, 'turret')
    const barrel = stillOf(view, 'barrel_3')[0]
    const lid = stillOf(view, 'lid_l')[0]
    const along = () => turret.worldToLocal(barrel.getWorldPosition(new THREE.Vector3())).x
    const turn = () => lid.getWorldQuaternion(new THREE.Quaternion())
    rig.sync(state, 1, STEP)
    const rest = along()
    const shut = turn()
    state.tank.hatch = true
    for (let i = 1; i <= 30; i++) rig.sync(state, 1 + i * STEP, STEP)
    rig.handle({ type: 'tankShot', barrel: 0, x: 0, y: 0, angle: 0 })
    rig.sync(state, 1 + 30 * STEP + TANK_RIG.kickIn, TANK_RIG.kickIn)
    expect(along()).toBeCloseTo(rest - TANK_RIG.recoil, 3)
    expect(turn().angleTo(shut)).toBeCloseTo(TANK_RIG.lidAngle, 2)
  })

  it('gives each track its own texture and rolls them as the tank drives', async () => {
    const models = await library()
    const { root, view } = shell()
    const rig = createTankRig(def, view, { models, effects: effects(), tuning })
    const left = maps(view, 'track_l')[0]
    const right = maps(view, 'track_r')[0]
    expect(left).toBeDefined()
    expect(left).not.toBe(right)
    const state = tankState()
    rig.sync(state, STEP, STEP)
    for (let i = 1; i <= 10; i++) {
      root.position.x += 0.05
      rig.sync(state, (i + 1) * STEP, STEP)
    }
    expect(left.offset.x).not.toBe(0)
    expect(left.offset.x).toBeCloseTo(right.offset.x, 6)
  })

  it('scrolls the tracks over the library texture without uploading it again for every tank', async () => {
    const models = await library()
    const source = models.instance('forest-tank').nodes.get('track_l')
    const mesh = source?.children.find((child): child is THREE.Mesh => (child as THREE.Mesh).isMesh)
    const shared = (mesh?.material as THREE.MeshStandardMaterial | undefined)?.map
    if (!shared) throw new Error('no track texture')
    const version = shared.source.version
    const built = [shell(), shell()].map(({ view }) => {
      createTankRig(def, view, { models, effects: effects(), tuning })
      return view
    })
    expect(shared.source.version).toBe(version)
    const tracks = built.flatMap((view) => [...maps(view, 'track_l'), ...maps(view, 'track_r')])
    expect(new Set(tracks).size).toBe(4)
    for (const map of tracks) {
      expect(map).not.toBe(shared)
      expect(map.source).toBe(shared.source)
      expect(map.version).toBeGreaterThan(0)
      expect(map.wrapS).toBe(THREE.RepeatWrapping)
    }
    for (const view of built) for (const item of view.owned) item.dispose()
    expect(shared.source.version).toBe(version)
  })

  it('kicks back the barrel that fired, on the matching side', async () => {
    const models = await library()
    const { view } = shell()
    const rig = createTankRig(def, view, { models, effects: effects(), tuning })
    const state = tankState()
    const rests = ['barrel_1', 'barrel_2', 'barrel_3'].map((name) => find(view, name).position.x)
    rig.sync(state, 1, STEP)
    rig.handle({ type: 'tankShot', barrel: 0, x: 0, y: 0, angle: 0 })
    rig.sync(state, 1 + TANK_RIG.kickIn, TANK_RIG.kickIn)
    expect(find(view, 'barrel_3').position.x).toBeCloseTo(rests[2] - TANK_RIG.recoil, 3)
    expect(find(view, 'barrel_1').position.x).toBeCloseTo(rests[0], 6)
    expect(find(view, 'barrel_2').position.x).toBeCloseTo(rests[1], 6)
  })

  it('swings the mine hatch open and keeps the turret off the lids while they move', async () => {
    const models = await library()
    const { view } = shell()
    const rig = createTankRig(def, view, { models, effects: effects(), tuning })
    const state = tankState()
    if (!state.tank) throw new Error('no tank')
    state.tank.turret = Math.PI
    rig.sync(state, STEP, STEP)
    state.tank.hatch = true
    rig.sync(state, 2 * STEP, STEP)
    const turret = find(view, 'turret')
    const yaw = new THREE.Euler().setFromQuaternion(turret.quaternion, 'YXZ').y
    expect(Math.abs(yaw)).toBeLessThanOrEqual(TANK_RIG.turretLimit + 1e-6)
    for (let i = 3; i < 40; i++) rig.sync(state, i * STEP, STEP)
    const lid = new THREE.Euler().setFromQuaternion(find(view, 'lid_l').quaternion).z
    expect(lid).toBeCloseTo(TANK_RIG.lidAngle, 3)
    expect(Math.abs(new THREE.Euler().setFromQuaternion(turret.quaternion, 'YXZ').y)).toBeGreaterThan(150 * DEG)
  })

  it('backs away to the exit without blowing up and fades out', async () => {
    const models = await library()
    const { root, view } = shell()
    root.position.set(20, 0, 20)
    const fx = effects()
    const rig = createTankRig(def, view, { models, effects: fx, tuning })
    rig.sync(tankState(), STEP, STEP)
    expect(rig.handle({ type: 'enemyKilled', id: 1, kind: 'boss', x: 20, y: 20 })).toBe(true)
    const target = { x: 20, y: 25, exit: { x: 20, y: 3.5 } }
    rig.defeat(0.5, target)
    const early = view.body.position.z
    rig.defeat(TANK_DEFEAT.open + 1, target)
    expect(view.body.position.z).toBeLessThan(early)
    expect(view.body.position.z).toBeLessThan(0)
    rig.defeat(TANK_DEFEAT.seconds - 0.01, target)
    expect(fx.burst).not.toHaveBeenCalled()
    expect(fx.puff).toHaveBeenCalled()
    expect(rig.defeatSeconds).toBe(TANK_DEFEAT.seconds)
  })
})
