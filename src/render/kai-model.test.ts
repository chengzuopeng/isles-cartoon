import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { TRAINING } from '../data/levels/training'
import { createDefaultTuning } from '../data/tuning'
import type { PlayerWeaponId } from '../data/weapons'
import { Tile } from '../sim/grid'
import { buildLevel } from '../sim/level'
import { createWorld } from '../sim/world'
import { WEAPON_MODEL_IDS, type ModelId } from './asset-urls'
import type { ModelKit } from './character-models'
import type { Effects } from './effects'
import { HELD_JOINTS, KAI_JOINTS, PLAYER_FLASH_COLOR, PLAYER_RENDER_ORDER, heldFromLibrary, kaiFromLibrary, kaiFromModel } from './kai-model'
import { loadModels, type ModelInstance, type ModelLibrary } from './model-library'
import { createPlayerView } from './player-view'
import type { Stage } from './stage'

interface FileSystem {
  readFileSync(path: URL): Uint8Array
}

interface Gltf {
  nodes: { name?: string; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; mesh?: number }[]
  meshes: { primitives: { material?: number; attributes: Record<string, number> }[] }[]
  accessors: { min?: number[]; max?: number[] }[]
  materials: {
    name?: string
    emissiveFactor?: number[]
    alphaMode?: string
    pbrMetallicRoughness?: { baseColorTexture?: { index: number }; metallicFactor?: number; roughnessFactor?: number }
  }[]
  textures: { source?: number; sampler?: number; extensions?: { KHR_texture_basisu?: { source: number } } }[]
  scenes: { nodes: number[] }[]
  scene?: number
}

interface Tracked {
  id: ModelId
  model: ModelInstance
  rest: Map<string, string>
  changed: Set<string>
}

const FS_MODULE = 'node:fs'
const fs = (await import(/* @vite-ignore */ FS_MODULE)) as FileSystem
const ROOT = new URL('../../', import.meta.url)
const STEP = 1 / 60
const DRAW_BUDGET = 12
const KAI_MESHES = [53, 3] as const
const KAI_CASTERS = 1
const HELD_MESHES: Readonly<Record<PlayerWeaponId, readonly [number, number]>> = {
  blaster: [18, 4],
  shotgun: [8, 1],
  smg: [7, 2],
  sniper: [6, 2],
  grenade: [7, 2],
  ricochet: [10, 2],
  flamer: [7, 2],
  frost: [7, 3],
  rocket: [5, 1],
  arc: [7, 3],
}

function readGltf(id: string): Gltf {
  const bytes = fs.readFileSync(new URL(`public/assets/models/${id}.glb`, ROOT))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + view.getUint32(12, true)))) as Gltf
}

function skeleton(id: string): THREE.Object3D {
  const gltf = readGltf(id)
  const maps = new Map<string, THREE.Texture>()
  const materials = gltf.materials.map((entry) => {
    const material = new THREE.MeshStandardMaterial()
    material.name = entry.name ?? ''
    const pbr = entry.pbrMetallicRoughness
    material.roughness = pbr?.roughnessFactor ?? 1
    material.metalness = pbr?.metallicFactor ?? 1
    if (entry.emissiveFactor) material.emissive.fromArray(entry.emissiveFactor)
    if (entry.alphaMode === 'MASK') material.alphaTest = 0.5
    if (entry.alphaMode === 'BLEND') {
      material.transparent = true
      material.depthWrite = false
    }
    const slot = pbr?.baseColorTexture
    if (slot) {
      const texture = gltf.textures[slot.index]
      const key = `${texture.extensions?.KHR_texture_basisu?.source ?? texture.source}:${texture.sampler}`
      const map = maps.get(key) ?? new THREE.Texture()
      maps.set(key, map)
      material.map = map
    }
    return material
  })
  const primitive = (entry: Gltf['meshes'][number]['primitives'][number]) => {
    const bounds = gltf.accessors[entry.attributes.POSITION]
    const low = new THREE.Vector3().fromArray(bounds.min ?? [0, 0, 0])
    const high = new THREE.Vector3().fromArray(bounds.max ?? [0, 0, 0])
    const size = high.clone().sub(low)
    const center = high.clone().add(low).multiplyScalar(0.5)
    const geometry = new THREE.BoxGeometry(size.x, size.y, size.z).translate(center.x, center.y, center.z)
    if (!('TEXCOORD_0' in entry.attributes)) geometry.deleteAttribute('uv')
    return new THREE.Mesh(geometry, materials[entry.material ?? 0])
  }
  const build = (index: number): THREE.Object3D => {
    const node = gltf.nodes[index]
    const primitives = node.mesh === undefined ? [] : gltf.meshes[node.mesh].primitives.map(primitive)
    const object = primitives.length === 1 ? primitives[0] : primitives.length > 1 ? new THREE.Group().add(...primitives) : new THREE.Object3D()
    object.name = node.name ?? ''
    object.userData.name = node.name
    object.position.fromArray(node.translation ?? [0, 0, 0])
    object.quaternion.fromArray(node.rotation ?? [0, 0, 0, 1])
    object.scale.fromArray(node.scale ?? [1, 1, 1])
    for (const child of node.children ?? []) object.add(build(child))
    return object
  }
  const scene = new THREE.Group()
  for (const index of gltf.scenes[gltf.scene ?? 0].nodes) scene.add(build(index))
  return scene
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

function drawCalls(root: THREE.Object3D): number {
  const meshes = drawn(root)
  return meshes.length + meshes.filter((mesh) => mesh.castShadow).length
}

function pose(node: THREE.Object3D): string {
  return [...node.position.toArray(), ...node.quaternion.toArray(), ...node.scale.toArray()].map((value) => value.toFixed(5)).join(',') + String(node.visible)
}

function posesOf(model: ModelInstance): Map<string, string> {
  return new Map([...model.nodes].map(([name, node]) => [name, pose(node)]))
}

function tracking(library: ModelLibrary, tracked: Tracked[]): ModelLibrary {
  return {
    ...library,
    instance(id, joints) {
      const model = library.instance(id, joints)
      tracked.push({ id, model, rest: posesOf(model), changed: new Set() })
      return model
    },
  }
}

function part(name: string, parent: THREE.Object3D, material: THREE.Material, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), material)
  mesh.userData.name = name
  mesh.position.z = z
  parent.add(mesh)
  return mesh
}

function kaiScene(): THREE.Object3D {
  const cloth = new THREE.MeshStandardMaterial({ name: 'mat_cloth' })
  const glow = new THREE.MeshStandardMaterial({ name: 'mat_glow', emissive: '#30e0ff' })
  const face = new THREE.MeshStandardMaterial({ name: 'mat_face', alphaTest: 0.5 })
  const root = new THREE.Group()
  root.userData.name = 'root'
  const torso = part('torso', root, cloth)
  part('face', torso, face)
  const left = part('arm_l', torso, cloth, -0.13)
  part('arm_l_lower', left, cloth)
  const right = part('arm_r', torso, cloth, 0.13)
  const lower = part('arm_r_lower', right, cloth)
  const hand = part('hand_r', lower, cloth)
  const socket = new THREE.Object3D()
  socket.userData.name = 'socket_weapon'
  hand.add(socket)
  part('weapon_default', socket, glow)
  part('leg_l', root, cloth, -0.06)
  part('leg_r', root, cloth, 0.06)
  const scarf = part('scarf_1', torso, cloth)
  part('scarf_1_2', scarf, cloth)
  const loose = part('scarf_2', torso, cloth)
  part('scarf_2_3', loose, cloth)
  return root
}

describe('kai model', () => {
  it('prepares the glTF kai for overlays, flashes and the held weapon', async () => {
    const library = await loadModels(['kai'], async () => kaiScene())
    const kai = kaiFromModel(library.instance('kai'))
    expect(kai.nodes.get('weapon_default')?.visible).toBe(false)
    expect(kai.mount).toBe(kai.nodes.get('socket_weapon'))
    expect(kai.scarf.map((chain) => chain.map((node) => node.userData.name))).toEqual([['scarf_1', 'scarf_1_2'], ['scarf_2']])
    const tail = (name: string) => new THREE.Vector3(0, 0, name === 'scarf_1' ? 1 : -1).applyQuaternion(kai.nodes.get(name)?.quaternion ?? new THREE.Quaternion())
    expect(tail('scarf_1').x).toBeLessThan(0)
    expect(tail('scarf_2').x).toBeLessThan(0)
    expect(kai.nodes.get('scarf_1_2')?.quaternion.equals(new THREE.Quaternion())).toBe(true)
    kai.root.traverse((object) => expect(object.renderOrder).toBe(PLAYER_RENDER_ORDER))
    for (const material of kai.materials) expect(material.transparent).toBe(true)
    expect(kai.tintable.length).toBeGreaterThan(0)
    for (const material of kai.tintable) {
      expect(material.emissive.getHexString()).toBe(new THREE.Color(PLAYER_FLASH_COLOR).getHexString())
      expect(material.emissiveIntensity).toBe(0)
    }
    expect(kai.tintable.some((material) => material.name === 'mat_glow')).toBe(false)
    const rig = kai.rig
    expect(rig?.legs).toHaveLength(2)
    expect(rig?.arms.find((arm) => arm.upper === kai.nodes.get('arm_r'))?.held).toBe(true)
    expect(rig?.arms.find((arm) => arm.upper === kai.nodes.get('arm_l'))?.held).toBe(false)
  })
})

describe('merging the still parts of kai and his guns', () => {
  it('names only nodes that exist in the models', () => {
    const names = (id: string) => new Set(readGltf(id).nodes.map((node) => node.name))
    const kai = names('kai')
    for (const name of KAI_JOINTS) expect(kai.has(name), name).toBe(true)
    expect(Object.keys(HELD_JOINTS).sort()).toEqual([...WEAPON_MODEL_IDS].sort())
    for (const id of WEAPON_MODEL_IDS) {
      const gun = names(id)
      for (const name of HELD_JOINTS[id]) expect(gun.has(name), `${id} ${name}`).toBe(true)
    }
  })

  it('folds what rides on each joint of kai into one draw per look', async () => {
    const library = await loadModels(['kai'], async () => skeleton('kai'))
    expect(drawn(kaiFromModel(library.instance('kai')).root)).toHaveLength(KAI_MESHES[0])
    const kai = kaiFromLibrary(library)
    const meshes = drawn(kai.root)
    expect(meshes).toHaveLength(KAI_MESHES[1])
    const hidden: THREE.Object3D[] = []
    kai.root.traverse((object) => {
      if ((object as THREE.Mesh).isMesh && !object.visible) hidden.push(object)
    })
    expect(hidden).toEqual([])
    for (const name of library.instance('kai').nodes.keys()) if (name.startsWith('socket_')) expect(kai.nodes.has(name), name).toBe(true)
    expect(meshes.filter((mesh) => mesh.castShadow)).toHaveLength(KAI_CASTERS)
    expect(kai.nodes.get('weapon_default')?.visible).toBe(false)
    const joints = new Set<THREE.Object3D>([kai.root])
    for (const name of KAI_JOINTS) {
      const node = kai.nodes.get(name)
      expect(node, name).toBeDefined()
      if (node) joints.add(node)
    }
    const still = meshes.filter((mesh) => mesh.userData.still === true)
    expect(still).toHaveLength(2)
    for (const mesh of still) expect(joints.has(mesh.parent as THREE.Object3D)).toBe(true)
    for (const mesh of meshes) expect(mesh.renderOrder).toBe(PLAYER_RENDER_ORDER)
    const atlas = still.map((mesh) => mesh.material as THREE.MeshStandardMaterial).filter((material) => material.roughnessMap !== null)
    expect(atlas).toHaveLength(1)
    for (const material of atlas) {
      expect(kai.tintable).toContain(material)
      expect(kai.materials).toContain(material)
      expect(material.transparent).toBe(true)
      expect(material.emissive.getHexString()).toBe(new THREE.Color(PLAYER_FLASH_COLOR).getHexString())
    }
  })

  for (const id of WEAPON_MODEL_IDS) {
    it(`${id}: merges the held gun around the parts that move`, async () => {
      const library = await loadModels([id], async () => skeleton(id))
      const [before, after] = HELD_MESHES[id]
      expect(drawn(library.instance(id).root)).toHaveLength(before)
      const model = heldFromLibrary(library, id)
      expect(drawn(model.root)).toHaveLength(after)
      model.root.traverse((object) => expect(Boolean((object as THREE.Mesh).isMesh) && !object.visible, object.name).toBe(false))
      const muzzle = (instance: ModelInstance) => {
        instance.root.updateMatrixWorld(true)
        return instance.nodes.get('socket_muzzle')?.getWorldPosition(new THREE.Vector3()) ?? null
      }
      const plain = muzzle(library.instance(id))
      expect(plain).not.toBeNull()
      expect(muzzle(model)?.distanceTo(plain ?? new THREE.Vector3())).toBeLessThan(1e-9)
      for (const material of model.materials) expect(material.depthWrite).toBe(true)
      const lit = new Set(drawn(model.root).map((mesh) => mesh.material))
      for (const material of model.glow.values()) expect(lit.has(material), material.name).toBe(true)
    })
  }

  it('keeps every node the player view moves apart and stays within the draw budget with each gun', async () => {
    const tracked: Tracked[] = []
    const library = tracking(await loadModels(['kai', ...WEAPON_MODEL_IDS], async (id) => skeleton(id)), tracked)
    const scene = new THREE.Scene()
    const stage = { scene, addTrauma: vi.fn() } as unknown as Stage
    const effects: Effects = { puff: vi.fn(), burst: vi.fn(), update: vi.fn(), clear: vi.fn() }
    const kit = { buildKai: (models: ModelLibrary) => kaiFromLibrary(models) } as unknown as ModelKit
    const tuning = createDefaultTuning()
    const view = createPlayerView(stage, tuning, effects, kit, library)
    const world = createWorld(buildLevel(TRAINING), tuning)
    const { player } = world
    player.facing = 0.4
    const budget = new Map<PlayerWeaponId, number>()
    const run = (frames: number, update?: () => void) => {
      for (let i = 0; i < frames; i++) {
        update?.()
        world.time += STEP
        view.sync(world, 1, STEP, world.time)
        for (const item of tracked) for (const [name, node] of item.model.nodes) if (item.rest.get(name) !== pose(node)) item.changed.add(name)
      }
    }
    const walk = (dx: number, dy: number, frames: number) =>
      run(frames, () => {
        player.prev.x = player.pos.x
        player.prev.y = player.pos.y
        player.pos.x += dx
        player.pos.y += dy
      })
    const hold = (id: PlayerWeaponId) => {
      player.special = id === 'blaster' ? null : id
      player.slot = id === 'blaster' ? 'primary' : 'special'
      player.specialAmmo = 5
    }
    run(10)
    walk(0.05, 0.02, 40)
    walk(-0.05, -0.02, 40)
    walk(0, 0.05, 40)
    walk(0.035, -0.035, 30)
    player.rollDirX = 1
    player.rollDirY = 0
    player.rollTime = 0.25
    walk(0.12, 0, 15)
    player.rollTime = 0
    for (const id of WEAPON_MODEL_IDS) {
      hold(id)
      run(6)
      view.handle({ type: 'shot', x: player.pos.x, y: player.pos.y, z: 1.5, angle: player.facing, pitch: 0, weapon: id })
      run(12)
      budget.set(id, drawCalls(scene))
    }
    hold('rocket')
    player.burstWeapon = 'rocket'
    player.cooldown = 1
    run(4)
    player.cooldown = 0
    run(4)
    hold('blaster')
    run(20, () => {
      player.ultShots = 3
    })
    player.ultShots = 0
    run(20)
    view.handle({ type: 'playerHit', x: player.pos.x, y: player.pos.y, damage: 3, absorbed: 0, fromX: player.pos.x, fromY: player.pos.y })
    const cell = Math.floor(player.pos.y) * world.grid.columns + Math.floor(player.pos.x)
    const tile = world.grid.tiles[cell]
    world.grid.tiles[cell] = Tile.Bush
    run(10)
    world.grid.tiles[cell] = tile
    player.alive = false
    view.handle({ type: 'playerDied', x: player.pos.x, y: player.pos.y, attack: null })
    run(150)
    player.alive = true
    run(10)

    expect([...budget.keys()].sort()).toEqual([...WEAPON_MODEL_IDS].sort())
    for (const [id, calls] of budget) expect(calls, id).toBeLessThanOrEqual(DRAW_BUDGET)
    const kai = tracked.find((item) => item.id === 'kai')
    expect(kai).toBeDefined()
    expect([...(kai?.changed ?? [])].filter((name) => !KAI_JOINTS.includes(name))).toEqual([])
    for (const name of ['hips', 'torso', 'head', 'leg_l_lower', 'arm_l', 'arm_r', 'arm_r_lower', 'hand_r', 'scarf_1_3', 'scarf_2_3']) {
      expect(kai?.changed.has(name), name).toBe(true)
    }
    const guns = tracked.filter((item) => item.id !== 'kai')
    expect(guns.map((item) => item.id).sort()).toEqual([...WEAPON_MODEL_IDS].sort())
    for (const gun of guns) {
      const joints = HELD_JOINTS[gun.id as PlayerWeaponId]
      expect([...gun.changed].filter((name) => !joints.includes(name)), gun.id).toEqual([])
      for (const name of joints) expect(gun.changed.has(name), `${gun.id} ${name}`).toBe(true)
    }
  })
})
