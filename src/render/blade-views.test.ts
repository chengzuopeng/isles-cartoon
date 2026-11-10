import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { LEVEL_1_4 } from '../data/levels/level-1-4'
import { LEVEL_1_5 } from '../data/levels/level-1-5'
import { createDefaultTuning } from '../data/tuning'
import { buildLevel } from '../sim/level'
import { stepWorld } from '../sim/step'
import type { PlayerCommand } from '../sim/types'
import { createWorld, type World } from '../sim/world'
import type { ModelId } from './asset-urls'
import { BLADE_MODEL, createBladeViews, type BladeViews } from './blade-views'
import type { Effects } from './effects'
import { EMPTY_LIBRARY, loadModels } from './model-library'
import { BLADE_RIG, BLADE_SPARKS } from './themes'

const level = buildLevel(LEVEL_1_5)
const STEP = 1 / 60

function idle(world: World): PlayerCommand {
  const { pos } = world.player
  return { moveX: 0, moveY: 0, aimX: pos.x, aimY: pos.y - 1, pitch: 0, fire: false, slot: null, interact: false, skill: null, ultimate: false, jump: false, dash: false, melee: false }
}

function fresh(): World {
  const world = createWorld(level, createDefaultTuning(), { seed: 1, debug: { invincible: true } })
  for (const enemy of world.enemies) enemy.speedScale = 0
  return world
}

function run(world: World, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / STEP); i++) stepWorld(world, idle(world), STEP)
  world.events.length = 0
}

function instanced(views: BladeViews): THREE.InstancedMesh[] {
  return views.group.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh && child.count === level.blades.length)
}

function strips(views: BladeViews): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] {
  return views.group.children.filter((child): child is THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> => child instanceof THREE.Mesh && child.material instanceof THREE.ShaderMaterial)
}

function pose(mesh: THREE.InstancedMesh, index: number): { position: THREE.Vector3; front: THREE.Vector3; rotation: THREE.Quaternion } {
  const matrix = new THREE.Matrix4()
  mesh.getMatrixAt(index, matrix)
  const position = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  matrix.decompose(position, rotation, new THREE.Vector3())
  return { position, front: new THREE.Vector3(1, 0, 0).applyQuaternion(rotation), rotation }
}

function spyEffects(): Effects & { puff: ReturnType<typeof vi.fn> } {
  return { puff: vi.fn(), burst: vi.fn(), sparks: vi.fn(), smoke: vi.fn(), explosion: vi.fn(), star: vi.fn(), update: vi.fn(), clear: vi.fn() } as unknown as Effects & { puff: ReturnType<typeof vi.fn> }
}

function named<T extends THREE.Object3D>(object: T, name: string, parent: THREE.Object3D): T {
  object.name = name
  object.userData.name = name
  parent.add(object)
  return object
}

function trapScene(): THREE.Object3D {
  const scene = new THREE.Group()
  const root = named(new THREE.Group(), 'root', scene)
  const body = named(new THREE.Group(), 'body', root)
  const paint = new THREE.MeshStandardMaterial({ color: '#b8322a' })
  paint.name = 'mat_body'
  const eye = new THREE.MeshStandardMaterial({ emissive: '#ffb02e' })
  eye.name = 'mat_eye'
  named(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 1.9).translate(-0.25, 0.3, 0), paint), 'chassis', body)
  named(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1).translate(-0.1, 0.6, 0.3), eye), 'eye', body)
  const reel = named(new THREE.Group(), 'reel', body)
  reel.position.set(0.16, 0.4, 0)
  const steel = new THREE.MeshStandardMaterial({ color: '#d3dae1' })
  steel.name = 'mat_steel'
  named(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 1.8), steel), 'fin', reel)
  return scene
}

describe('blade views without the model', () => {
  it('draws the three blades of 1-5 as one instanced body and one instanced reel, at the blades, fronts facing the next sweep', () => {
    const world = fresh()
    const views = createBladeViews(level, EMPTY_LIBRARY)
    expect(views.count).toBe(3)
    expect(views.model).toBe(false)
    expect(views.meshCount).toBe(2)
    views.sync(world, 1, 0)
    const [body, reel] = instanced(views)
    expect(body.castShadow).toBe(true)
    world.blades.forEach((blade, index) => {
      const { position, front } = pose(body, index)
      expect(position.x).toBeCloseTo(blade.pos.x)
      expect(position.z).toBeCloseTo(blade.pos.y)
      expect(front.x).toBeCloseTo(Math.cos(blade.facing))
      expect(front.z).toBeCloseTo(Math.sin(blade.facing))
      expect(pose(reel, index).position.y).toBeCloseTo(0.4, 1)
    })
    views.dispose()
    expect(views.group.children).toHaveLength(0)
  })

  it('spins the reels slowly while parked and much faster while sweeping', () => {
    const world = fresh()
    const views = createBladeViews(level, EMPTY_LIBRARY)
    views.sync(world, 1, 0)
    const [, reel] = instanced(views)
    const turned = (index: number) => {
      const before = pose(reel, index).rotation.clone()
      views.sync(world, 1, 1 / 30)
      return before.angleTo(pose(reel, index).rotation)
    }
    const parked = turned(0)
    run(world, 2.4)
    expect(world.blades[0].phase).toBe('sweep')
    for (let i = 0; i < 30; i++) views.sync(world, 1, 1 / 60)
    const sweeping = turned(0)
    expect(parked).toBeGreaterThan(0)
    expect(sweeping).toBeGreaterThan(parked * 4)
    views.dispose()
  })

  it('lights only the lane whose blade is warning, filled from the parked blade, and keeps the part ahead of it lit while it sweeps', () => {
    const world = fresh()
    const views = createBladeViews(level, EMPTY_LIBRARY)
    views.sync(world, 1, 0)
    expect(strips(views).every((strip) => !strip.visible)).toBe(true)
    run(world, 1.0)
    expect(world.blades.map((blade) => blade.phase)).toEqual(['rest', 'warning', 'warning'])
    views.sync(world, 1, STEP)
    const lanes = views.lanes()
    expect(lanes.map((lane) => lane.visible)).toEqual([false, true, true])
    const middle = world.blades[1]
    const fill = 1 - middle.warning / level.blades[1].warning
    expect(lanes[1].to).toBeCloseTo(1)
    expect(lanes[1].from).toBeCloseTo(1 - fill, 2)
    expect(lanes[2].from).toBeCloseTo(0)
    expect(strips(views)[1].material.uniforms.uFrom.value).toBeCloseTo(lanes[1].from)
    run(world, 1.2)
    expect(world.blades[1].phase).toBe('sweep')
    views.sync(world, 1, STEP)
    const sweeping = views.lanes()[1]
    const lane = level.blades[1]
    const front = (world.blades[1].pos.x - lane.reach - lane.column) / lane.width
    expect(sweeping.visible).toBe(true)
    expect(sweeping.from).toBeCloseTo(0)
    expect(sweeping.to).toBeCloseTo(front, 2)
    views.dispose()
  })

  it('turns a blade round over about half a second when it parks, through the camera side, stepping off the end wall', () => {
    const world = fresh()
    const views = createBladeViews(level, EMPTY_LIBRARY)
    const lane = level.blades[0]
    const blade = world.blades[0]
    blade.pos.x = lane.to.x
    blade.prev.x = lane.to.x
    views.sync(world, 1, 0)
    const [body] = instanced(views)
    expect(pose(body, 0).front.x).toBeCloseTo(1)
    blade.facing = Math.PI
    let southward = -1
    let stepped = 0
    for (let t = 0; t < BLADE_RIG.turnSeconds + 0.1; t += STEP) {
      views.sync(world, 1, STEP)
      const { position, front } = pose(body, 0)
      southward = Math.max(southward, front.z)
      stepped = Math.max(stepped, lane.to.x - position.x)
    }
    const { position, front } = pose(body, 0)
    expect(southward).toBeGreaterThan(0.99)
    expect(stepped).toBeGreaterThan(0.5)
    expect(stepped).toBeLessThan(Math.hypot(lane.reach, lane.half) - lane.reach + 1e-3)
    expect(position.x).toBeCloseTo(lane.to.x)
    expect(front.x).toBeCloseTo(-1)
    views.dispose()
  })

  it('throws sparks and chips where a blade hits, fewer when the player rolls through it', () => {
    const world = fresh()
    const effects = spyEffects()
    const views = createBladeViews(level, EMPTY_LIBRARY, effects)
    views.sync(world, 1, 0)
    run(world, 2.4)
    const blade = world.blades[0]
    views.handle({ type: 'bladeHit', index: 0, id: world.player.id, x: blade.pos.x + 0.5, y: blade.pos.y, damage: 200 })
    views.sync(world, 1, STEP)
    expect(effects.puff.mock.calls.length).toBe(2 + BLADE_SPARKS.player.sparks)
    const debris = views.group.children.find((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh && child.instanceMatrix.count === BLADE_SPARKS.debris)
    expect(debris?.visible).toBe(true)
    expect(debris?.count).toBe(BLADE_SPARKS.player.chips)
    effects.puff.mockClear()
    views.handle({ type: 'bladeHit', index: 0, id: world.player.id, x: 7, y: blade.pos.y, damage: 200 })
    views.handle({ type: 'dodged', x: 7, y: blade.pos.y })
    views.sync(world, 1, STEP)
    expect(effects.puff.mock.calls.length).toBe(2 + BLADE_SPARKS.dodged.sparks)
    effects.puff.mockClear()
    views.handle({ type: 'bladeHit', index: 0, id: 99, x: 9, y: blade.pos.y, damage: 200 })
    views.sync(world, 1, STEP)
    expect(effects.puff.mock.calls.length).toBe(2 + BLADE_SPARKS.enemy.sparks)
    expect(effects.burst).toHaveBeenCalledTimes(1)
    views.dispose()
  })

  it('draws nothing for a level without blades', () => {
    const views = createBladeViews(buildLevel(LEVEL_1_4), EMPTY_LIBRARY)
    expect(views.count).toBe(0)
    expect(views.group.children).toHaveLength(0)
    views.dispose()
  })
})

describe('blade views with the model', () => {
  it('instances the baked body and the reel node, turning the reel about its own axle', async () => {
    const models = await loadModels([BLADE_MODEL as ModelId], async () => trapScene())
    const world = fresh()
    const views = createBladeViews(level, models)
    expect(views.model).toBe(true)
    views.sync(world, 1, 0)
    const meshes = instanced(views)
    expect(meshes.every((mesh) => mesh.userData.model === BLADE_MODEL)).toBe(true)
    const reel = meshes.find((mesh) => (mesh.material as THREE.Material).name === 'mat_steel')
    expect(reel).toBeDefined()
    if (!reel) return
    const blade = world.blades[0]
    const axle = pose(reel, 0).position
    expect(axle.x).toBeCloseTo(blade.pos.x + 0.16)
    expect(axle.y).toBeCloseTo(0.4)
    const before = pose(reel, 0).rotation.clone()
    views.sync(world, 1, 0.1)
    expect(pose(reel, 0).position.distanceTo(axle)).toBeLessThan(1e-6)
    expect(before.angleTo(pose(reel, 0).rotation)).toBeGreaterThan(0)
    const disposed = vi.fn()
    models.shared(BLADE_MODEL as ModelId).root.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (mesh.isMesh) (mesh.material as THREE.Material).addEventListener('dispose', disposed)
    })
    views.dispose()
    expect(disposed).not.toHaveBeenCalled()
  })
})
