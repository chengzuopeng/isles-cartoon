import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { TRAINING } from '../data/levels/training'
import { createDefaultTuning } from '../data/tuning'
import { ENEMY_WEAPON } from '../sim/arsenal'
import { buildLevel } from '../sim/level'
import type { Enemy, EnemyState, MinionKind } from '../sim/types'
import { createEnemy, createWorld } from '../sim/world'
import { ENEMY_MODEL_IDS } from './asset-urls'
import type { Effects } from './effects'
import { enemyPose } from './enemy-poses'
import { ENEMY_JOINTS, createEnemyRig, type EnemyFrame } from './enemy-rigs'
import { EMPTY_LIBRARY, loadModels, nodeMap, type ModelInstance, type ModelLibrary } from './model-library'

interface FileSystem {
  readFileSync(path: URL): Uint8Array
}

interface Gltf {
  nodes: { name?: string; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; mesh?: number }[]
  meshes: { primitives: { material?: number; attributes: Record<string, number> }[] }[]
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

const FS_MODULE = 'node:fs'
const fs = (await import(/* @vite-ignore */ FS_MODULE)) as FileSystem
const ROOT = new URL('../../', import.meta.url)
const STEP = 1 / 60
const MESHES: Readonly<Record<MinionKind, readonly [number, number]>> = {
  grunt: [30, 3],
  gunner: [33, 4],
  bomber: [20, 5],
  turret: [14, 4],
  shield: [43, 5],
  thrower: [48, 3],
}
const STATES: readonly EnemyState[] = ['windup', 'charge', 'dash', 'aim', 'recover', 'arming', 'chase']

function readGltf(kind: MinionKind): Gltf {
  const bytes = fs.readFileSync(new URL(`public/assets/models/${kind}.glb`, ROOT))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + view.getUint32(12, true)))) as Gltf
}

function skeleton(kind: MinionKind): THREE.Object3D {
  const gltf = readGltf(kind)
  const maps = new Map<string, THREE.Texture>()
  const materials = gltf.materials.map((entry) => {
    const material = new THREE.MeshStandardMaterial()
    material.name = entry.name ?? ''
    const pbr = entry.pbrMetallicRoughness
    material.roughness = pbr?.roughnessFactor ?? 1
    material.metalness = pbr?.metallicFactor ?? 1
    if (entry.emissiveFactor) material.emissive.fromArray(entry.emissiveFactor)
    if (entry.alphaMode === 'MASK') material.alphaTest = 0.5
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
    const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2)
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

function hiddenMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = []
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh && !object.visible) found.push(object as THREE.Mesh)
  })
  return found
}

function stillOf(model: ModelInstance): THREE.Mesh[] {
  return drawn(model.root).filter((mesh) => mesh.userData.still === true)
}

function standardOf(mesh: THREE.Mesh): THREE.MeshStandardMaterial {
  return mesh.material as THREE.MeshStandardMaterial
}

function pose(node: THREE.Object3D): string {
  return [...node.position.toArray(), ...node.quaternion.toArray(), ...node.scale.toArray()].map((value) => value.toFixed(5)).join(',') + String(node.visible)
}

function moved(kind: MinionKind, model: ModelInstance, models: ModelLibrary): string[] {
  const { tuning, enemy } = setup(kind)
  const rig = createEnemyRig(kind, enemyPose(kind), { model, models, effects: effects() })
  const rest = new Map([...model.nodes].map(([name, node]) => [name, pose(node)]))
  const changed = new Set<string>()
  let time = 0
  const run = (frames: number, extra: Partial<EnemyFrame> = {}) => {
    for (let i = 0; i < frames; i++) {
      time += STEP
      enemy.stateTime += STEP
      rig.sync(frame(enemy, tuning, time, { yaw: 0.7, ...extra }))
      for (const [name, node] of model.nodes) if (rest.get(name) !== pose(node)) changed.add(name)
    }
  }
  run(5)
  run(40, { moving: true })
  for (const state of STATES) {
    enemy.state = state
    enemy.stateTime = 0
    run(40, { moving: state === 'chase' })
  }
  enemy.state = 'aim'
  enemy.stateTime = tuning.weapons[ENEMY_WEAPON[kind]].windup
  run(1)
  enemy.state = 'recover'
  enemy.stateTime = 0
  run(20)
  run(40, { disabled: true })
  rig.blocked()
  run(5)
  return [...changed]
}

function named(name: string, parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Object3D {
  const node = new THREE.Object3D()
  node.userData.name = name
  node.position.set(x, y, z)
  parent.add(node)
  return node
}

function glowing(name: string): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ emissive: '#ff0000', emissiveIntensity: 1 })
  material.name = name
  return material
}

function instance(build: (root: THREE.Object3D) => void, lights: string[] = []): ModelInstance {
  const root = new THREE.Group()
  root.userData.name = 'root'
  build(root)
  const glow = new Map(lights.map((name) => [name, glowing(name)]))
  return { root, nodes: nodeMap(root), tintable: [], materials: [...glow.values()], glow, dispose: () => {} }
}

function effects() {
  return { puff: vi.fn<Effects['puff']>(), burst: vi.fn<Effects['burst']>(), update: vi.fn<Effects['update']>(), clear: vi.fn<Effects['clear']>() }
}

function setup(kind: MinionKind) {
  const tuning = createDefaultTuning()
  const world = createWorld(buildLevel(TRAINING), tuning)
  const enemy = createEnemy(world, kind, { x: 0, y: 0 }, 0)
  enemy.aggro = true
  return { tuning, enemy }
}

function frame(enemy: Enemy, tuning: EnemyFrame['tuning'], time: number, extra: Partial<EnemyFrame> = {}): EnemyFrame {
  return { enemy, tuning, time, step: 1 / 60, dt: 1 / 60, moving: false, disabled: false, yaw: 0, pose: enemyPose(enemy.kind).pose(enemy, tuning), ...extra }
}

describe('enemy rigs', () => {
  it('turns the turret head without the tripod and puffs the three muzzles one after another', () => {
    const { tuning, enemy } = setup('turret')
    const model = instance((root) => {
      const base = named('base', root)
      const head = named('turret', base, 0, 0.42, 0)
      const barrel = named('barrel', head, 0.11, 0.25, 0)
      for (const index of [1, 2, 3]) named(`socket_muzzle_${index}`, barrel, 0.32, 0.1 * index, 0)
      named('socket_head', root, 0, 1, 0)
    }, ['mat_eye'])
    const fx = effects()
    const rig = createEnemyRig('turret', enemyPose('turret'), { model, models: EMPTY_LIBRARY, effects: fx })
    const windup = tuning.weapons.cannon.windup
    enemy.state = 'aim'
    enemy.stateTime = windup - 0.01
    rig.sync(frame(enemy, tuning, 5, { yaw: 1 }))
    expect(model.nodes.get('turret')?.rotation.y).toBeCloseTo(-1)
    expect(model.nodes.get('base')?.rotation.y).toBe(0)
    expect(model.glow.get('mat_eye')?.emissiveIntensity).toBeGreaterThan(1)
    expect(fx.puff).not.toHaveBeenCalled()
    enemy.state = 'recover'
    enemy.stateTime = 0.01
    rig.sync(frame(enemy, tuning, 5.02, { yaw: 1 }))
    expect(fx.puff).toHaveBeenCalledTimes(1)
    expect(model.nodes.get('barrel')?.rotation.z).toBeGreaterThan(0.1)
    enemy.stateTime = 0.2
    rig.sync(frame(enemy, tuning, 5.21, { yaw: 1 }))
    expect(fx.puff).toHaveBeenCalledTimes(3)
    expect(rig.anchor?.userData.name).toBe('socket_head')
  })

  it('shows the thrower bomb only while aiming and hides it with a muzzle puff when the mortar fires', () => {
    const { tuning, enemy } = setup('thrower')
    const model = instance((root) => {
      const body = named('body', root, 0, 0.3, 0)
      const arm = named('arm_bomb', body, 0, 0.23, 0.22)
      const lower = named('arm_bomb_lower', arm, 0, -0.13, 0.05)
      named('bomb', lower, 0.14, -0.07, -0.12)
      named('socket_weapon', lower, 0.14, -0.07, -0.12)
      const mortar = named('mortar', body, -0.29, 0.36, -0.22)
      named('socket_muzzle', mortar, 0.5, 0.34, 0)
    })
    const fx = effects()
    const rig = createEnemyRig('thrower', enemyPose('thrower'), { model, models: EMPTY_LIBRARY, effects: fx })
    const bomb = model.nodes.get('bomb')
    const mortar = model.nodes.get('mortar')
    rig.sync(frame(enemy, tuning, 1))
    expect(bomb?.visible).toBe(false)
    enemy.state = 'aim'
    enemy.stateTime = tuning.weapons.bomb.windup - 0.01
    rig.sync(frame(enemy, tuning, 2))
    expect(bomb?.visible).toBe(true)
    expect(mortar?.rotation.z).toBeGreaterThan(0.2)
    enemy.state = 'recover'
    enemy.stateTime = 0
    rig.sync(frame(enemy, tuning, 2.02))
    expect(bomb?.visible).toBe(false)
    expect(fx.puff).toHaveBeenCalled()
    expect(mortar?.position.x).toBeLessThan(-0.29)
  })

  it('swells only the bomber body and blinks its lamps while arming', () => {
    const { tuning, enemy } = setup('bomber')
    const model = instance((root) => {
      named('body', root, 0, 0.41, 0)
      named('leg_l', root, 0, 0.2, -0.17)
      named('leg_r', root, 0, 0.2, 0.17)
    }, ['mat_lamp'])
    const rig = createEnemyRig('bomber', enemyPose('bomber'), { model, models: EMPTY_LIBRARY, effects: effects() })
    const lamp = model.glow.get('mat_lamp')
    enemy.state = 'arming'
    const seen = new Set<number>()
    for (let i = 0; i < 30; i++) {
      enemy.stateTime = i * 0.02
      rig.sync(frame(enemy, tuning, 3 + i * 0.02))
      seen.add(lamp?.emissiveIntensity ?? 0)
    }
    expect(seen.size).toBe(2)
    expect(model.nodes.get('body')?.scale.x).toBeGreaterThan(1.2)
    expect(model.nodes.get('leg_l')?.scale.x).toBe(1)
  })

  it('lowers the shield while the shield bearer is disabled and shakes it after a block', () => {
    const { tuning, enemy } = setup('shield')
    const model = instance((root) => {
      const body = named('body', root, 0, 0.45, 0)
      const arm = named('arm_shield', body, 0, 0.35, -0.25)
      const lower = named('arm_shield_lower', arm, 0, -0.19, -0.11)
      named('shield', lower, 0.25, -0.05, 0.11)
    })
    const rig = createEnemyRig('shield', enemyPose('shield'), { model, models: EMPTY_LIBRARY, effects: effects() })
    const board = model.nodes.get('shield')
    const rest = board?.quaternion.clone() ?? new THREE.Quaternion()
    for (let i = 0; i < 60; i++) rig.sync(frame(enemy, tuning, i / 60, { disabled: true }))
    expect(board?.quaternion.angleTo(rest)).toBeGreaterThan(0.8)
    for (let i = 0; i < 60; i++) rig.sync(frame(enemy, tuning, 1 + i / 60))
    expect(board?.quaternion.angleTo(rest)).toBeLessThan(0.01)
    rig.blocked()
    rig.sync(frame(enemy, tuning, 2.5))
    rig.sync(frame(enemy, tuning, 2.53))
    expect(board?.quaternion.angleTo(rest)).toBeGreaterThan(0.01)
    rig.sync(frame(enemy, tuning, 3))
    expect(board?.quaternion.angleTo(rest)).toBeLessThan(1e-3)
  })

  it('keeps the gunner rifle level while raising it, and brightens the eye once alerted', () => {
    const { tuning, enemy } = setup('gunner')
    const model = instance((root) => {
      const body = named('body', root, 0, 0.72, 0)
      const rifle = named('arm_rifle', body, 0, 0.21, 0.15)
      const rifleLower = named('arm_rifle_lower', rifle, 0, -0.15, 0.04)
      named('socket_muzzle', rifleLower, 0.69, 0.05, -0.1)
      const support = named('arm_support', body, 0, 0.21, -0.15)
      named('arm_support_lower', support, 0, -0.17, -0.04)
    }, ['mat_eye', 'mat_glow'])
    const rig = createEnemyRig('gunner', enemyPose('gunner'), { model, models: EMPTY_LIBRARY, effects: effects() })
    enemy.state = 'aim'
    enemy.stateTime = tuning.weapons.rifle.windup
    rig.sync(frame(enemy, tuning, 4))
    const upper = model.nodes.get('arm_rifle')
    const lower = model.nodes.get('arm_rifle_lower')
    expect(upper?.rotation.z).toBeGreaterThan(0.3)
    expect((upper?.rotation.z ?? 0) + (lower?.rotation.z ?? 0)).toBeCloseTo(0)
    expect(model.glow.get('mat_eye')?.emissiveIntensity).toBeGreaterThan(1)
  })
})

describe('merging the still parts of each enemy', () => {
  it('has a joint list for every enemy model', () => {
    expect(Object.keys(ENEMY_JOINTS).sort()).toEqual([...ENEMY_MODEL_IDS].sort())
  })

  for (const kind of ENEMY_MODEL_IDS) {
    it(`${kind}: folds what rides on each joint into one draw per look and keeps the joints apart`, async () => {
      const models = await loadModels([kind], async () => skeleton(kind))
      const [before, after] = MESHES[kind]
      expect(drawn(models.instance(kind).root)).toHaveLength(before)
      const model = models.instance(kind, ENEMY_JOINTS[kind])
      expect(drawn(model.root)).toHaveLength(after)
      expect(hiddenMeshes(model.root)).toEqual([])
      for (const name of models.instance(kind).nodes.keys()) {
        if (name === 'eye' || name.startsWith('socket_')) expect(model.nodes.has(name), name).toBe(true)
      }
      const joints = new Set<THREE.Object3D>([model.root])
      for (const name of ENEMY_JOINTS[kind]) {
        const node = model.nodes.get(name)
        expect(node, name).toBeDefined()
        if (node) joints.add(node)
      }
      const still = stillOf(model)
      expect(still.length).toBeGreaterThan(0)
      for (const mesh of still) expect(joints.has(mesh.parent as THREE.Object3D)).toBe(true)
      expect(still.some((mesh) => standardOf(mesh).roughnessMap !== null)).toBe(true)
      const lit = new Set(drawn(model.root).map((mesh) => mesh.material))
      for (const material of model.glow.values()) expect(lit.has(material), material.name).toBe(true)
      expect(model.nodes.get('socket_head')).toBeDefined()
    })

    it(`${kind}: the rig only moves nodes that stay apart`, async () => {
      const models = await loadModels([kind], async () => skeleton(kind))
      const changed = moved(kind, models.instance(kind, ENEMY_JOINTS[kind]), models)
      expect(changed.length).toBeGreaterThan(0)
      expect(changed.filter((name) => !ENEMY_JOINTS[kind].includes(name))).toEqual([])
    })
  }

  it('gives each enemy its own merged materials so a flash or a fog fade stays on that enemy', async () => {
    const models = await loadModels(['shield'], async () => skeleton('shield'))
    const first = models.instance('shield', ENEMY_JOINTS.shield)
    const second = models.instance('shield', ENEMY_JOINTS.shield)
    const [a, b] = [stillOf(first), stillOf(second)]
    expect(a).toHaveLength(b.length)
    a.forEach((mesh, index) => {
      expect(mesh.geometry).toBe(b[index].geometry)
      expect(mesh.material).not.toBe(b[index].material)
      expect(standardOf(mesh).roughnessMap).toBe(standardOf(b[index]).roughnessMap)
    })
    const atlas = a.map(standardOf).filter((material) => material.roughnessMap !== null)
    expect(atlas).toHaveLength(1)
    for (const material of atlas) {
      expect(first.tintable).toContain(material)
      expect(first.materials).toContain(material)
    }
    for (const material of first.tintable) {
      material.emissive.set('#ffffff')
      material.emissiveIntensity = 1.4
      material.transparent = true
      material.opacity = 0.3
    }
    for (const material of b.map(standardOf)) {
      expect(material.emissive.getHex()).toBe(0)
      expect(material.transparent).toBe(false)
      expect(material.opacity).toBe(1)
    }
    const geometry = vi.fn()
    const material = vi.fn()
    a[0].geometry.addEventListener('dispose', geometry)
    standardOf(b[0]).addEventListener('dispose', material)
    first.dispose()
    expect(geometry).not.toHaveBeenCalled()
    expect(material).not.toHaveBeenCalled()
    const third = models.instance('shield', ENEMY_JOINTS.shield)
    expect(standardOf(stillOf(third)[0]).emissive.getHex()).toBe(0)
  })
})
