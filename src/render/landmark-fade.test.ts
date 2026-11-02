import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { LANDMARKS } from '../data/landmarks'
import type { AreaDef } from '../data/levels/types'
import { createDefaultTuning } from '../data/tuning'
import type { BuiltLevel } from '../sim/level'
import { levelFromAreas } from '../sim/testing'
import type { World } from '../sim/world'
import type { ModelId } from './asset-urls'
import { PLAYER_RENDER_ORDER } from './kai-model'
import {
  bakeSight,
  boxSight,
  cameraEye,
  createFader,
  fadeStep,
  fadesBehind,
  freshFade,
  hidesPlayer,
  meshSight,
  segmentHitsBounds,
  settleFade,
  type Point3,
  type Sight,
} from './landmark-fade'
import { createLandmarkViews } from './landmark-views'
import { loadModels, type ModelLibrary } from './model-library'
import { LANDMARK_FADE } from './themes'

const CAMERA = createDefaultTuning().camera
const STEP = 0.02

function eyeFor(x: number, y: number, aim = { x, y }): Point3 {
  return cameraEye({ pos: { x, y }, aim }, true, CAMERA, { x: 0, y: 0, z: 0 })
}

function hides(sight: Sight, x: number, y: number, options: { aim?: { x: number; y: number }; roof?: boolean } = {}): boolean {
  return hidesPlayer(sight, { x, y }, eyeFor(x, y, options.aim ?? { x, y }), options.roof ?? true)
}

function block(column: number, row: number, width: number, depth: number, columns = 64): number[] {
  const cells: number[] = []
  for (let r = row; r < row + depth; r++) for (let c = column; c < column + width; c++) cells.push(r * columns + c)
  return cells
}

function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const front = () => new THREE.MeshStandardMaterial()

describe('which landmarks fade', () => {
  it('fades the tall ones and leaves the low ones solid', () => {
    expect(fadesBehind(LANDMARKS['ch1-windmill'])).toBe(true)
    expect(fadesBehind(LANDMARKS['ch1-barn'])).toBe(true)
    expect(fadesBehind(LANDMARKS['ch1-town-gate'])).toBe(true)
    expect(fadesBehind(LANDMARKS['ch1-star-altar'])).toBe(false)
    expect(fadesBehind(LANDMARKS['ch1-well'])).toBe(false)
    expect(fadesBehind(LANDMARKS['ch1-fog-lamp'])).toBe(false)
  })

  it('draws the see-through pass after the player, depth first', () => {
    expect(LANDMARK_FADE.colorOrder).toBeGreaterThan(PLAYER_RENDER_ORDER)
    expect(LANDMARK_FADE.depthOrder).toBeLessThan(LANDMARK_FADE.colorOrder)
    expect(LANDMARK_FADE.opacity).toBeGreaterThanOrEqual(0.3)
    expect(LANDMARK_FADE.opacity).toBeLessThanOrEqual(0.4)
  })

  it('checks Kai at the feet, chest, head and both sides', () => {
    const heights = LANDMARK_FADE.probes.map(([, height]) => height)
    const sides = LANDMARK_FADE.probes.map(([offset]) => offset)
    expect(Math.min(...heights)).toBeLessThan(0.4)
    expect(Math.max(...heights)).toBeGreaterThan(1)
    expect(Math.min(...sides)).toBeLessThan(0)
    expect(Math.max(...sides)).toBeGreaterThan(0)
  })
})

describe('camera eye', () => {
  it('sits south of and above the player along the camera pitch', () => {
    const eye = eyeFor(10, 20)
    const pitch = THREE.MathUtils.degToRad(CAMERA.pitch)
    expect(eye.x).toBeCloseTo(10)
    expect(eye.y).toBeCloseTo(Math.sin(pitch) * CAMERA.distance)
    expect(eye.z).toBeCloseTo(20 + Math.cos(pitch) * CAMERA.distance)
  })

  it('follows the aim lead like the camera does, capped at the max lead', () => {
    const far = eyeFor(10, 20, { x: 10, y: 120 })
    expect(far.z - eyeFor(10, 20).z).toBeCloseTo(CAMERA.maxLead)
    const near = eyeFor(10, 20, { x: 12, y: 20 })
    expect(near.x).toBeCloseTo(10 + 2 * CAMERA.lead)
    const idle = cameraEye({ pos: { x: 10, y: 20 }, aim: { x: 10, y: 120 } }, false, CAMERA, { x: 0, y: 0, z: 0 })
    expect(idle.z).toBeCloseTo(eyeFor(10, 20).z)
  })
})

describe('placeholder boxes', () => {
  const windmill = boxSight(block(10, 10, 6, 5), 64, 2)

  it('clips a segment against a box', () => {
    const from = { x: 0, y: 0.5, z: 0 }
    const to = { x: 0, y: 5, z: 10 }
    expect(segmentHitsBounds(from, to, { x: -1, y: 0, z: 2 }, { x: 1, y: 2, z: 3 })).toBe(true)
    expect(segmentHitsBounds(from, to, { x: -1, y: 0, z: 6 }, { x: 1, y: 2, z: 7 })).toBe(false)
    expect(segmentHitsBounds(from, to, { x: 2, y: 0, z: 2 }, { x: 3, y: 4, z: 3 })).toBe(false)
  })

  it('hides Kai right behind a box, as far as her feet stay under its top along the camera ray', () => {
    expect(hides(windmill, 13, 9.1)).toBe(true)
    expect(hides(windmill, 13, 8.6)).toBe(false)
  })

  it('never hides Kai in front of it or standing beside it', () => {
    const radius = createDefaultTuning().player.radius
    expect(hides(windmill, 13, 15 + radius)).toBe(false)
    expect(hides(windmill, 10 - radius, 12)).toBe(false)
    expect(hides(windmill, 16 + radius, 12)).toBe(false)
  })

  it('counts the camera lead: aiming south looks over a longer stretch behind it', () => {
    expect(hides(windmill, 13, 8.8, { aim: { x: 13, y: 40 } })).toBe(true)
    expect(hides(windmill, 13, 8.8, { aim: { x: 13, y: -40 } })).toBe(false)
  })

  it('follows the footprint shape, not its bounding box', () => {
    const barnMask = ['######', '#....#', '#....#', '#....#', '#....#', '##.###']
    const cells: number[] = []
    barnMask.forEach((line, row) => {
      for (let column = 0; column < line.length; column++) if (line[column] === '#') cells.push((20 + row) * 64 + 20 + column)
    })
    const barn = boxSight(cells, 64, 2)
    expect(hides(barn, 23.5, 21.5)).toBe(false)
    expect(hides(barn, 23.5, 24.5)).toBe(true)
    expect(hides(barn, 22.5, 24.5)).toBe(false)
  })
})

describe('model sight', () => {
  it('agrees with three.js raycasting against the faces the camera can see', () => {
    const root = new THREE.Group()
    const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(1.2, 0.35, 48, 8), front())
    knot.position.set(-1.5, 2.5, 0.5)
    knot.rotation.set(0.4, 0.9, 0.2)
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 1.2), front())
    box.position.set(1.8, 1.5, -0.4)
    box.rotation.y = 0.6
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(3, 2), front())
    plane.position.set(0.2, 4.2, 1.8)
    plane.rotation.x = -0.7
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 2.5), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }))
    sheet.position.set(-0.5, 1.2, -2)
    sheet.rotation.y = 2.4
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), front())
    ball.position.set(0.8, 5.5, -1)
    ball.scale.set(-1, 1.3, 1)
    root.add(knot, box, plane, sheet, ball)
    root.position.set(20, 0, 30)
    root.rotation.y = -Math.PI / 2
    const sight = meshSight(root)
    root.updateMatrixWorld(true)
    const raycaster = new THREE.Raycaster()
    const random = seeded(7)
    let blocked = 0
    for (let i = 0; i < 800; i++) {
      const from = { x: 16 + 8 * random(), y: 0.1 + 1.4 * random(), z: 25 + 7 * random() }
      const to = { x: from.x - 3 + 6 * random(), y: 14.4, z: from.z + 9 }
      const direction = new THREE.Vector3(from.x - to.x, from.y - to.y, from.z - to.z)
      const length = direction.length()
      raycaster.set(new THREE.Vector3(to.x, to.y, to.z), direction.normalize())
      raycaster.far = length - LANDMARK_FADE.clearance
      const expected = raycaster.intersectObject(root, true).length > 0
      if (expected) blocked++
      expect(sight.blocks(from, to, true), `segment ${i}`).toBe(expected)
    }
    expect(blocked).toBeGreaterThan(80)
    expect(blocked).toBeLessThan(720)
  })

  it('ignores a one-sided face turned away from the camera', () => {
    const facing = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), front())
    facing.position.set(0, 2, 5)
    const away = facing.clone()
    away.rotation.y = Math.PI
    const both = new THREE.Mesh(facing.geometry, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }))
    both.position.copy(away.position)
    both.rotation.copy(away.rotation)
    const sightOf = (mesh: THREE.Mesh) => meshSight(new THREE.Group().add(mesh))
    expect(hides(sightOf(facing), 0, 3)).toBe(true)
    expect(hides(sightOf(away), 0, 3)).toBe(false)
    expect(hides(sightOf(both), 0, 3)).toBe(true)
  })

  it('leaves out the roof when asked, and meshes hidden when it was built', () => {
    const root = new THREE.Group()
    const roof = new THREE.Group()
    roof.add(new THREE.Mesh(new THREE.BoxGeometry(6, 2.4, 6).translate(0, 3.4, 0), front()))
    const wall = new THREE.Mesh(new THREE.BoxGeometry(6, 2.2, 0.2).translate(0, 1.1, 2.9), front())
    const ghost = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 1).translate(0, 3, 1.8), front())
    ghost.visible = false
    root.add(roof, wall, ghost)
    const sight = meshSight(root, [], roof)
    expect(hides(sight, 0, 1.3, { roof: true })).toBe(true)
    expect(hides(sight, 0, 1.3, { roof: false })).toBe(false)
    expect(hides(sight, 0, 2.45, { roof: false })).toBe(true)
  })

  it('sweeps a spinning part through its whole turn and keeps the rest where it was modelled', () => {
    const root = new THREE.Group()
    const hub = new THREE.Group()
    hub.position.set(0, 5.6, 0)
    hub.add(new THREE.Mesh(new THREE.BoxGeometry(7, 0.4, 0.1), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide })))
    root.add(hub)
    const still = meshSight(root)
    const turning = meshSight(root, [{ node: hub, axis: new THREE.Vector3(0, 0, 1) }])
    expect(hides(still, 3, -2.45)).toBe(false)
    expect(hides(turning, 3, -2.45)).toBe(true)
    expect(hides(turning, 3, -9)).toBe(false)
    expect(turning.max.y).toBeCloseTo(5.6 + Math.hypot(3.5, 0.2), 1)
    expect(still.max.y).toBeCloseTo(5.8)
  })

  it('keeps the sweep as thin as each slice along the axle, so a long hub does not widen the blades', () => {
    const root = new THREE.Group()
    const hub = new THREE.Group()
    hub.position.set(0, 5.6, 0)
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.4, 12).rotateX(Math.PI / 2).translate(0, 0, -0.5), front())
    const blade = new THREE.Mesh(new THREE.BoxGeometry(7, 0.4, 0.1), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }))
    hub.add(axle, blade)
    root.add(hub)
    const sight = meshSight(root, [{ node: hub, axis: new THREE.Vector3(0, 0, 1) }])
    expect(sight.blocks({ x: 2.5, y: 5.6, z: -1 }, { x: 2.5, y: 5.7, z: -0.3 }, true)).toBe(false)
    expect(sight.blocks({ x: 2.5, y: 5.6, z: -0.5 }, { x: 2.5, y: 5.7, z: 0.5 }, true)).toBe(true)
    expect(sight.blocks({ x: 0.1, y: 5.6, z: -1 }, { x: 0.1, y: 5.7, z: -0.3 }, true)).toBe(true)
  })

  it('skips the triangle grid when the ray misses the model', () => {
    const root = new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2).translate(0, 1, 0), front()))
    const sight = meshSight(root)
    expect(sight.min.y).toBeCloseTo(0)
    expect(sight.max.y).toBeCloseTo(2)
    expect(hides(sight, 10, 0)).toBe(false)
    expect(hides(sight, 0, -1.2)).toBe(true)
  })

  it('bakes a big model a piece at a time into the same sight', () => {
    const root = new THREE.Group()
    const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(2, 0.6, 240, 24), front())
    knot.position.set(0, 3, 0)
    root.add(knot, new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2).translate(3, 1, 0), front()))
    const whole = meshSight(root)
    const steps = bakeSight(root)
    let pieces = 0
    let step = steps.next()
    while (!step.done) {
      pieces += 1
      step = steps.next()
    }
    expect(pieces).toBeGreaterThan(4)
    expect(step.value.min).toEqual(whole.min)
    expect(step.value.max).toEqual(whole.max)
    for (let x = -4; x <= 6; x += 0.5) {
      for (let z = -3; z <= 3; z += 0.5) expect(hides(step.value, x, z)).toBe(hides(whole, x, z))
    }
  })
})

describe('fade timing', () => {
  it('fades out over the set time and back again, from any dt', () => {
    let opacity = 1
    opacity = fadeStep(opacity, true, LANDMARK_FADE.seconds / 2)
    expect(opacity).toBeCloseTo((1 + LANDMARK_FADE.opacity) / 2)
    opacity = fadeStep(opacity, true, LANDMARK_FADE.seconds / 2)
    expect(opacity).toBeCloseTo(LANDMARK_FADE.opacity)
    expect(fadeStep(opacity, true, 5)).toBe(LANDMARK_FADE.opacity)
    expect(fadeStep(opacity, false, 0)).toBe(opacity)
    expect(fadeStep(opacity, false, 5)).toBe(1)
    expect(fadeStep(1, false, 0.016)).toBe(1)
  })

  it('waits before fading and longer before coming back, so edge flicker never shows', () => {
    const state = freshFade()
    const hold = (blocked: boolean, seconds: number) => {
      for (let t = 0; t < seconds - 1e-9; t += STEP) settleFade(state, blocked, STEP)
    }
    hold(true, LANDMARK_FADE.enterDelay - 2 * STEP)
    expect(state.hidden).toBe(false)
    expect(state.opacity).toBe(1)
    hold(false, STEP)
    hold(true, LANDMARK_FADE.enterDelay - 2 * STEP)
    expect(state.opacity).toBe(1)
    hold(true, 2 * STEP)
    expect(state.hidden).toBe(true)
    expect(state.opacity).toBeLessThan(1)
    hold(true, LANDMARK_FADE.seconds)
    expect(state.opacity).toBeCloseTo(LANDMARK_FADE.opacity)
    hold(false, LANDMARK_FADE.leaveDelay - 2 * STEP)
    expect(state.hidden).toBe(true)
    expect(state.opacity).toBeCloseTo(LANDMARK_FADE.opacity)
    hold(false, 2 * STEP)
    expect(state.hidden).toBe(false)
    hold(false, LANDMARK_FADE.seconds)
    expect(state.opacity).toBe(1)
  })
})

describe('fader', () => {
  function rig() {
    const root = new THREE.Group()
    const wall = new THREE.MeshStandardMaterial({ name: 'mat_wall' })
    const decal = new THREE.MeshStandardMaterial({ name: 'mat_decal', transparent: true, opacity: 0.8 })
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), wall)
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), decal)
    root.add(body, sign)
    return { root, wall, decal, body, sign }
  }

  it('turns its own materials see-through with a depth pass and front-face shadows, and restores them exactly', () => {
    const { root, wall, decal, body, sign } = rig()
    const fader = createFader(root, [wall, decal])
    expect(body.children).toHaveLength(0)
    fader.set(0.5)
    expect(fader.faded).toBe(true)
    expect(wall.transparent).toBe(true)
    expect(wall.depthWrite).toBe(false)
    expect(wall.shadowSide).toBe(THREE.FrontSide)
    expect(wall.opacity).toBeCloseTo(0.5)
    expect(decal.opacity).toBeCloseTo(0.4)
    expect(root.renderOrder).toBe(LANDMARK_FADE.colorOrder)
    expect(body.renderOrder).toBe(LANDMARK_FADE.colorOrder)
    const twin = body.children[0] as THREE.Mesh
    expect(twin.geometry).toBe(body.geometry)
    expect(twin.visible).toBe(true)
    expect(twin.renderOrder).toBe(LANDMARK_FADE.depthOrder)
    expect((twin.material as THREE.Material).colorWrite).toBe(false)
    expect(sign.children).toHaveLength(0)
    fader.set(1)
    expect(fader.faded).toBe(false)
    expect(wall.transparent).toBe(false)
    expect(wall.depthWrite).toBe(true)
    expect(wall.shadowSide).toBeNull()
    expect(wall.opacity).toBe(1)
    expect(decal.transparent).toBe(true)
    expect(decal.opacity).toBeCloseTo(0.8)
    expect(root.renderOrder).toBe(0)
    expect(body.renderOrder).toBe(0)
    expect(twin.visible).toBe(false)
    fader.set(0.6)
    expect(body.children).toHaveLength(1)
  })

  it('shares instance matrices with placeholder boxes and cleans up its depth pass', () => {
    const material = new THREE.MeshStandardMaterial()
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, 3)
    const fader = createFader(mesh, [material])
    fader.set(0.4)
    const twin = mesh.children[0] as THREE.InstancedMesh
    expect(twin.instanceMatrix).toBe(mesh.instanceMatrix)
    expect(twin.count).toBe(3)
    const dispose = vi.spyOn(twin.material as THREE.Material, 'dispose')
    fader.dispose()
    expect(dispose).toHaveBeenCalled()
    expect(mesh.children).toHaveLength(0)
    expect(material.transparent).toBe(false)
    expect(material.opacity).toBe(1)
  })
})

function named<T extends THREE.Object3D>(object: T, name: string, parent: THREE.Object3D): T {
  object.name = name
  object.userData.name = name
  parent.add(object)
  return object
}

function part(parent: THREE.Object3D, name: string, size: [number, number, number], center: [number, number, number]): THREE.Mesh {
  const [sx, sy, sz] = size
  const [cx, cy, cz] = center
  const mesh = named(new THREE.Mesh(new THREE.BoxGeometry(sz, sy, sx), new THREE.MeshStandardMaterial({ name: `mat_${name}` })), name, parent)
  mesh.position.set(cz, cy, -cx)
  return mesh
}

function pivotAt(parent: THREE.Object3D, name: string, center: [number, number, number]): THREE.Group {
  const node = named(new THREE.Group(), name, parent)
  node.position.set(center[2], center[1], -center[0])
  return node
}

function scene(id: string): THREE.Object3D {
  const holder = new THREE.Group()
  const root = named(new THREE.Group(), 'root', holder)
  root.userData.model = id
  if (id === 'ch1-windmill') {
    part(root, 'body', [4, 7.5, 4], [0, 3.75, 0])
    const sails = pivotAt(root, 'sails', [0, 5.6, 2.45])
    part(sails, 'blade', [7, 0.4, 0.1], [0, 0, 0])
  } else if (id === 'ch1-barn') {
    const body = named(new THREE.Group(), 'body', root)
    part(body, 'wall_n', [6, 2.2, 0.2], [0, 1.1, -2.9])
    part(body, 'wall_s', [6, 2.2, 0.2], [0, 1.1, 2.9])
    part(body, 'wall_w', [0.2, 2.2, 6], [-2.9, 1.1, 0])
    part(body, 'wall_e', [0.2, 2.2, 6], [2.9, 1.1, 0])
    const roof = named(new THREE.Group(), 'roof', root)
    part(roof, 'slab', [6.4, 2.4, 6.4], [0, 3.4, 0])
  } else if (id === 'ch1-town-gate') {
    const gate = named(new THREE.Group(), 'gate', root)
    part(gate, 'post_w', [0.8, 4.2, 0.8], [-4.4, 2.1, 0.6])
    part(gate, 'post_e', [0.8, 4.2, 0.8], [4.4, 2.1, 0.6])
    part(gate, 'beam', [9.6, 0.6, 0.8], [0, 3.9, 0.6])
    const sign = pivotAt(gate, 'sign', [0, 3.6, 1.05])
    part(sign, 'board', [2, 0.8, 0.1], [0, -0.6, 0])
  } else {
    part(root, 'body', [1.8, 0.9, 1.8], [0, 0.45, 0])
  }
  return root.removeFromParent()
}

function library(ids: string[]): Promise<ModelLibrary> {
  return loadModels(ids as ModelId[], async (id) => scene(id))
}

function fakeWorld(x: number, y: number, aim = { x, y }): World {
  return {
    status: 'playing',
    tuning: createDefaultTuning(),
    player: { pos: { x, y }, aim: { ...aim }, alive: true },
    enemies: [],
    landmarks: [],
  } as unknown as World
}

function run(views: { update(world: World, dt: number): void }, world: World, seconds: number): void {
  for (let t = 0; t < seconds - 1e-9; t += STEP) views.update(world, STEP)
}

const SETTLE = LANDMARK_FADE.enterDelay + LANDMARK_FADE.leaveDelay + LANDMARK_FADE.seconds + 0.06

function materialsUnder(root: THREE.Object3D): THREE.MeshStandardMaterial[] {
  const found = new Set<THREE.MeshStandardMaterial>()
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (mesh.isMesh && mesh.material instanceof THREE.MeshStandardMaterial) found.add(mesh.material)
  })
  return [...found]
}

function opacityOf(root: THREE.Object3D): number {
  return materialsUnder(root)[0].opacity
}

describe('landmark views fade', () => {
  const yard = (rows: number, start: number) => {
    const wall = '#'.repeat(30)
    const floor = `#${'.'.repeat(28)}#`
    return [wall, ...Array.from({ length: rows - 2 }, (_, row) => (row + 1 === start ? `#.........P${'.'.repeat(18)}#` : floor)), wall]
  }
  const FIELD: AreaDef = {
    name: 'field',
    theme: 'meadow',
    rows: yard(20, 17),
    landmarks: [
      { id: 'ch1-windmill', at: [3, 8] },
      { id: 'ch1-barn', at: [14, 8] },
      { id: 'ch1-star-altar', at: [24, 3] },
      { id: 'ch1-wheat-ears', at: [24, 16] },
    ],
  }
  const GATEWAY: AreaDef = {
    name: 'gateway',
    theme: 'farm',
    rows: yard(19, 11),
    landmarks: [{ id: 'ch1-town-gate', at: [10, 15] }],
  }

  function placementOf(level: BuiltLevel, id: string) {
    return level.landmarks.find((placement) => placement.id === id)!
  }

  function modelOf(views: { group: THREE.Group }, id: string): THREE.Object3D {
    return views.group.children.find((child) => child.userData.model === id)!
  }

  it('fades the windmill only while its tower or its turning sails really cover Kai', async () => {
    const models = await library(['ch1-windmill', 'ch1-barn', 'ch1-star-altar'])
    const level = levelFromAreas([FIELD])
    const views = createLandmarkViews(level, models)
    expect(views.fadingCount).toBe(2)
    const windmill = modelOf(views, 'ch1-windmill')
    const altar = modelOf(views, 'ch1-star-altar')
    const source = models.shared('ch1-windmill' as ModelId).materials
    const own = materialsUnder(windmill)
    expect(own.some((material) => source.includes(material))).toBe(false)
    const mill = placementOf(level, 'ch1-windmill')
    const centerX = mill.column + mill.width / 2
    run(views, fakeWorld(centerX, mill.row - 0.4), SETTLE)
    for (const material of own) {
      expect(material.opacity).toBeCloseTo(LANDMARK_FADE.opacity)
      expect(material.transparent).toBe(true)
      expect(material.depthWrite).toBe(false)
    }
    expect(windmill.renderOrder).toBe(LANDMARK_FADE.colorOrder)
    for (const material of [...source, ...materialsUnder(altar)]) {
      expect(material.transparent).toBe(false)
      expect(material.opacity).toBe(1)
    }
    run(views, fakeWorld(centerX, mill.row - 4.5), SETTLE)
    for (const material of own) {
      expect(material.opacity).toBe(1)
      expect(material.transparent).toBe(false)
      expect(material.depthWrite).toBe(true)
    }
    run(views, fakeWorld(centerX + 3, mill.row + mill.depth / 2), SETTLE)
    expect(opacityOf(windmill)).toBeCloseTo(LANDMARK_FADE.opacity)
  })

  it('waits a moment before fading and a little longer before coming back', async () => {
    const models = await library(['ch1-windmill'])
    const level = levelFromAreas([FIELD])
    const views = createLandmarkViews(level, models)
    const windmill = modelOf(views, 'ch1-windmill')
    const mill = placementOf(level, 'ch1-windmill')
    const behind = fakeWorld(mill.column + mill.width / 2, mill.row - 0.4)
    const away = fakeWorld(mill.column + mill.width / 2, mill.row - 6)
    run(views, behind, LANDMARK_FADE.enterDelay - 2 * STEP)
    expect(opacityOf(windmill)).toBe(1)
    run(views, behind, LANDMARK_FADE.seconds + 2 * STEP)
    expect(opacityOf(windmill)).toBeLessThan(1)
    run(views, behind, LANDMARK_FADE.seconds)
    expect(opacityOf(windmill)).toBeCloseTo(LANDMARK_FADE.opacity)
    run(views, away, LANDMARK_FADE.leaveDelay - 2 * STEP)
    expect(opacityOf(windmill)).toBeCloseTo(LANDMARK_FADE.opacity)
    run(views, away, LANDMARK_FADE.seconds + 2 * STEP)
    expect(opacityOf(windmill)).toBe(1)
  })

  it('keeps the town gate solid at the spawn point and does not stretch it for the swinging sign', async () => {
    const models = await library(['ch1-town-gate'])
    const level = levelFromAreas([GATEWAY])
    const views = createLandmarkViews(level, models)
    const gate = modelOf(views, 'ch1-town-gate')
    const spot = placementOf(level, 'ch1-town-gate')
    const centerX = spot.column + spot.width / 2
    run(views, fakeWorld(centerX, spot.row - 2.5), SETTLE)
    expect(opacityOf(gate)).toBe(1)
    run(views, fakeWorld(centerX - 4.4, spot.row - 0.4), SETTLE)
    expect(opacityOf(gate)).toBeCloseTo(LANDMARK_FADE.opacity)
  })

  it('only counts the barn walls once its roof is lifted', async () => {
    const models = await library(['ch1-barn'])
    const level = levelFromAreas([FIELD])
    const views = createLandmarkViews(level, models)
    const barn = modelOf(views, 'ch1-barn')
    const roof = views.group.getObjectByName('roof')!
    const spot = placementOf(level, 'ch1-barn')
    const centerX = spot.column + spot.width / 2
    const southWall = spot.row + spot.depth - 0.2
    run(views, fakeWorld(centerX, southWall - 1.5), SETTLE)
    expect(roof.visible).toBe(false)
    expect(opacityOf(barn)).toBe(1)
    run(views, fakeWorld(centerX, southWall - 0.35), SETTLE)
    expect(opacityOf(barn)).toBeCloseTo(LANDMARK_FADE.opacity)
    run(views, fakeWorld(centerX, spot.row - 0.4), SETTLE)
    expect(roof.visible).toBe(true)
    expect(opacityOf(barn)).toBeCloseTo(LANDMARK_FADE.opacity)
  })

  it('fades placeholder boxes of tall landmarks without touching the shared placeholder mesh', async () => {
    const models = await library([])
    const level = levelFromAreas([FIELD])
    const views = createLandmarkViews(level, models)
    expect(views.fadingCount).toBe(2)
    const mill = placementOf(level, 'ch1-windmill')
    const boxes: THREE.InstancedMesh[] = []
    views.group.traverse((child) => {
      if (child instanceof THREE.InstancedMesh) boxes.push(child)
    })
    const millBox = boxes.find((mesh) => mesh.count === mill.cells.length)!
    const shared = boxes.find((mesh) => mesh.instanceColor !== null)!
    run(views, fakeWorld(mill.column + 3, mill.row - 0.4), SETTLE)
    expect((millBox.material as THREE.Material).opacity).toBeCloseTo(LANDMARK_FADE.opacity)
    expect(millBox.parent).toBeInstanceOf(THREE.Group)
    expect(millBox.parent!.renderOrder).toBe(LANDMARK_FADE.colorOrder)
    expect((shared.material as THREE.Material).transparent).toBe(false)
    run(views, fakeWorld(mill.column + 3, mill.row - 2), SETTLE)
    expect((millBox.material as THREE.Material).opacity).toBe(1)
    expect((millBox.material as THREE.Material).transparent).toBe(false)
  })

  it('disposes the depth pass with the rest of the views', async () => {
    const models = await library(['ch1-windmill'])
    const level = levelFromAreas([FIELD])
    const views = createLandmarkViews(level, models)
    const windmill = modelOf(views, 'ch1-windmill')
    const mill = placementOf(level, 'ch1-windmill')
    run(views, fakeWorld(mill.column + 3, mill.row - 0.4), SETTLE)
    const twins: THREE.Mesh[] = []
    windmill.traverse((object) => {
      if (object.renderOrder === LANDMARK_FADE.depthOrder) twins.push(object as THREE.Mesh)
    })
    expect(twins.length).toBeGreaterThan(0)
    const spies = twins.map((twin) => vi.spyOn(twin.material as THREE.Material, 'dispose'))
    const own = materialsUnder(windmill).map((material) => vi.spyOn(material, 'dispose'))
    views.dispose()
    for (const spy of [...spies, ...own]) expect(spy).toHaveBeenCalled()
    expect(views.group.children).toHaveLength(0)
  })
})
