import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { LEVEL_1_2 } from '../data/levels/level-1-2'
import { createDefaultTuning } from '../data/tuning'
import { openPens } from '../sim/cheats'
import { buildLevel } from '../sim/level'
import { updateSheep } from '../sim/sheep'
import { createWorld, type World } from '../sim/world'
import type { ModelId } from './asset-urls'
import type { Effects } from './effects'
import { loadModels } from './model-library'
import { SHEEP_NODES, createSheepViews } from './sheep-views'

function named<T extends THREE.Object3D>(object: T, name: string, parent: THREE.Object3D): T {
  object.name = name
  object.userData.name = name
  parent.add(object)
  return object
}

function sheepScene(): THREE.Object3D {
  const holder = new THREE.Group()
  const root = named(new THREE.Group(), 'root', holder)
  const wool = new THREE.MeshStandardMaterial({ name: 'mat_wool' })
  const skin = new THREE.MeshStandardMaterial({ name: 'mat_skin' })
  const face = new THREE.MeshStandardMaterial({ name: 'mat_face', alphaTest: 0.5 })
  const body = named(new THREE.Group(), 'body', root)
  body.position.set(0, 0.262, 0)
  named(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.45), wool), 'fleece', body)
  const head = named(new THREE.Group(), 'head', body)
  head.position.set(0.222, 0.01, 0)
  named(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2).translate(0.15, 0.05, 0), skin), 'face_mesh', head)
  named(new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.05), face), 'face_eye_l', head)
  for (const [name, x, z] of [['leg_fl', 0.167, -0.108], ['leg_fr', 0.167, 0.108], ['leg_rl', -0.167, -0.108], ['leg_rr', -0.167, 0.108]] as const) {
    const leg = named(new THREE.Group(), name, root)
    leg.position.set(x, 0.171, z)
    named(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.17, 0.05).translate(0, -0.085, 0), skin), `${name}_mesh`, leg)
  }
  return root.removeFromParent()
}

function effects() {
  return { puff: vi.fn<Effects['puff']>(), burst: vi.fn<Effects['burst']>(), sparks: vi.fn<Effects['sparks']>(), smoke: vi.fn<Effects['smoke']>(), explosion: vi.fn<Effects['explosion']>(), star: vi.fn<Effects['star']>(), update: vi.fn<Effects['update']>(), clear: vi.fn<Effects['clear']>() }
}

function meshes(scene: THREE.Scene): THREE.InstancedMesh[] {
  return scene.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh)
}

function placed(mesh: THREE.InstancedMesh, index: number): { position: THREE.Vector3; rotation: THREE.Quaternion } {
  const matrix = new THREE.Matrix4()
  mesh.getMatrixAt(index, matrix)
  const position = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  matrix.decompose(position, rotation, new THREE.Vector3())
  return { position, rotation }
}

function run(world: World, seconds: number, step: (world: World) => void): void {
  for (let t = 0; t < seconds; t += 1 / 60) {
    updateSheep(world, 1 / 60)
    world.time += 1 / 60
    step(world)
  }
}

describe('sheep views', () => {
  it('draws every sheep of the level with one instanced mesh per part and material', async () => {
    const models = await loadModels(['sheep' as ModelId], async () => sheepScene())
    const scene = new THREE.Scene()
    const views = createSheepViews(scene, models)
    const world = createWorld(buildLevel(LEVEL_1_2), createDefaultTuning())
    views.sync(world, 1, 0.016)
    expect(SHEEP_NODES).toEqual(['body', 'head', 'leg_fl', 'leg_fr', 'leg_rl', 'leg_rr'])
    const all = meshes(scene)
    expect(views.meshCount).toBe(all.length)
    expect(all).toHaveLength(1 + 2 + 4)
    expect(all.every((mesh) => mesh.count === world.sheep.length)).toBe(true)
    expect(all.find((mesh) => (mesh.material as THREE.Material).name === 'mat_face')?.castShadow).toBe(false)
    const depth = all.find((mesh) => mesh.castShadow)?.customDepthMaterial
    expect(depth).toBeInstanceOf(THREE.MeshDepthMaterial)
    expect(all.filter((mesh) => mesh.castShadow).every((mesh) => mesh.customDepthMaterial === depth)).toBe(true)
    expect(all.find((mesh) => (mesh.material as THREE.Material).name === 'mat_face')?.customDepthMaterial).toBeUndefined()
    const body = all[0]
    world.sheep.forEach((sheep, index) => {
      const { position } = placed(body, index)
      expect(position.x).toBeCloseTo(sheep.pos.x, 5)
      expect(position.z).toBeCloseTo(sheep.pos.y, 5)
      expect(position.y).toBeCloseTo(0.262, 5)
    })
    views.reset()
    expect(all.every((mesh) => mesh.count === 0)).toBe(true)
    views.dispose()
    expect(meshes(scene)).toHaveLength(0)
  })

  it('walks the legs in diagonal pairs on the way out and lowers the head to graze in the pasture', async () => {
    const models = await loadModels(['sheep' as ModelId], async () => sheepScene())
    const scene = new THREE.Scene()
    const fx = effects()
    const views = createSheepViews(scene, models, fx)
    const world = createWorld(buildLevel(LEVEL_1_2), createDefaultTuning())
    views.sync(world, 1, 0.016)
    const all = meshes(scene)
    const front = all[3]
    const rear = all[6]
    const swingOf = (mesh: THREE.InstancedMesh) =>
      new THREE.Euler().setFromQuaternion(placed(mesh, 0).rotation.clone().premultiply(placed(all[0], 0).rotation.clone().invert())).z
    const area = world.level.landmarks[world.sheep[0].pen].area
    openPens(world, area)
    for (const event of world.events.splice(0)) views.handle(event)
    expect(fx.puff).toHaveBeenCalled()
    let swung = 0
    let paired = true
    run(world, 2, (current) => {
      views.sync(current, 1, 1 / 60)
      if (!current.sheep[0].moving) return
      swung = Math.max(swung, Math.abs(swingOf(front)))
      if (Math.abs(swingOf(front)) > 0.05) paired &&= Math.sign(swingOf(front)) === Math.sign(swingOf(rear))
    })
    expect(world.sheep[0].state).toBe('leaving')
    expect(swung).toBeGreaterThan(0.2)
    expect(swung).toBeLessThanOrEqual((25 * Math.PI) / 180 + 1e-6)
    expect(paired).toBe(true)
    for (const sheep of world.sheep) {
      sheep.state = 'grazing'
      sheep.target = null
      sheep.wait = 5
      sheep.moving = false
    }
    run(world, 1.5, (current) => views.sync(current, 1, 1 / 60))
    const head = all[1]
    const tilt = new THREE.Euler().setFromQuaternion(placed(head, 0).rotation.clone().premultiply(placed(all[0], 0).rotation.clone().invert()))
    expect(tilt.z).toBeLessThan(-0.3)
  })
})
