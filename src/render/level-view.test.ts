import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { LEVEL_1_2 } from '../data/levels/level-1-2'
import { LEVEL_1_3 } from '../data/levels/level-1-3'
import { LEVEL_1_5 } from '../data/levels/level-1-5'
import { LANDMARKS } from '../data/landmarks'
import type { AreaDef } from '../data/levels/types'
import { createDefaultTuning } from '../data/tuning'
import { openPens, raiseAlarms } from '../sim/cheats'
import { Tile } from '../sim/grid'
import { damageLandmark, openLandmark } from '../sim/landmark-state'
import { buildLevel, type BuiltLevel } from '../sim/level'
import { levelFromAreas } from '../sim/testing'
import { createWorld, type World } from '../sim/world'
import type { ModelId } from './asset-urls'
import type { Effects } from './effects'
import { fadesBehind } from './landmark-fade'
import { createLandmarkViews, onePart, sharesLook } from './landmark-views'
import { buildLevelView, createLevelView } from './level-view'
import { modelsFor } from './level-models'
import { loadModels, type ModelLibrary } from './model-library'
import { glbLibrary } from './testing'
import { chunkOf, facingYaw, glowLevel, glowRule, hingeOf } from './scene-models'
import { isShadowOnly, proxyGeometry } from './shadow-proxies'
import { sliced } from './slices'
import { ALARM_BELL, BELT_CARGO, GATE_LIFT, LANDMARK_CRASH, LANDMARK_OPEN, SCENE_CHUNK, SHADOW_LAYER, SHADOW_PROXY, TERRAIN } from './themes'

function named<T extends THREE.Object3D>(object: T, name: string, parent: THREE.Object3D): T {
  object.name = name
  object.userData.name = name
  parent.add(object)
  return object
}

function material(name: string): THREE.MeshStandardMaterial {
  const result = new THREE.MeshStandardMaterial()
  result.name = name
  return result
}

function scene(id: string): THREE.Object3D {
  const root = named(new THREE.Group(), 'root', new THREE.Group())
  root.userData.model = id
  if (id === 'ch1-fence') {
    named(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.16), material('mat_post')), 'post', root)
    const rail = named(new THREE.Group(), 'rail', root)
    named(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.5).translate(0, 0.3, -0.25), material('mat_rail')), 'bar', rail)
    return root.removeFromParent()
  }
  if (id === 'ch1-bridge') {
    named(new THREE.Mesh(new THREE.BoxGeometry(1, 0.05, 1), material('mat_deck')), 'deck', root)
    named(new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 0.06).translate(0, 0.2, -0.47), material('mat_rail')), 'rail', root)
    named(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.9, 0.13).translate(0.44, 0.1, -0.44), material('mat_end')), 'rail_end', root)
    return root.removeFromParent()
  }
  if (id === 'ch1-airship') {
    named(new THREE.Mesh(new THREE.BoxGeometry(10, 1.8, 4.6).translate(0, 0.9, 0), material('mat_hull')), 'hull', root)
    named(new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 2.4).translate(5, 0.15, 0), material('mat_ramp')), 'ramp', root)
    const balloon = named(new THREE.Group(), 'balloon', root)
    named(new THREE.Mesh(new THREE.BoxGeometry(10, 4.5, 5).translate(0, 7.25, 0), material('mat_balloon')), 'envelope', balloon)
    for (const [name, z] of [['prop_l', -2.6], ['prop_r', 2.6]] as const) {
      const prop = named(new THREE.Group(), name, root)
      prop.position.set(-4, 3, z)
      named(new THREE.Mesh(new THREE.BoxGeometry(0.05, 1, 0.1), material('mat_brass')), `${name}_blade`, prop)
    }
    return root.removeFromParent()
  }
  if (id === 'ch1-star-altar') {
    named(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 1.8), material('mat_stone')), 'body', root)
    const glow = material('mat_glow')
    glow.emissive.set('#bfefff')
    glow.emissiveIntensity = 0.5
    named(new THREE.Mesh(new THREE.CircleGeometry(0.3, 5), glow), 'star', root).position.y = 0.52
    return root.removeFromParent()
  }
  named(new THREE.Mesh(new THREE.BoxGeometry(0.9, 1, 0.9).translate(0, 0.5, 0), material('mat_body')), 'body', root)
  if (id === 'ch1-windmill') {
    const sails = named(new THREE.Group(), 'sails', root)
    sails.position.set(1.5, 5, 0)
    named(new THREE.Mesh(new THREE.BoxGeometry(0.2, 4, 0.4), material('mat_wood')), 'blade', sails)
  }
  if (id === 'ch1-barn') named(new THREE.Mesh(new THREE.BoxGeometry(6, 0.5, 6), material('mat_roof')), 'roof', root)
  if (id === 'ch1-sheep-pen') {
    const gate = named(new THREE.Group(), 'gate', root)
    gate.position.set(1.411, 0, 0.5)
    named(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 0.98).translate(0, 0.35, -0.49), material('mat_gate')), 'gate_board', gate)
  }
  if (id === 'ch1-watermill') {
    named(new THREE.Group(), 'wheel', root).position.set(-0.35, 1.2, -3.06)
    named(new THREE.Group(), 'secret_door', root).position.set(0.95, 0, -2.33)
  }
  if (id === 'ch1-gate') {
    const socket = named(new THREE.Object3D(), 'socket_fx_glow', root)
    socket.position.set(0, 1.1, 0)
  }
  if (id === 'ch1-bell-tower') {
    named(new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.3, 2.6), material('mat_roof')), 'roof', root).position.y = 4.9
    const bell = named(new THREE.Group(), 'bell', root)
    bell.position.set(0.28, 4.42, 0)
    named(new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 8).translate(0, -0.5, 0), material('mat_brass')), 'bell_body', bell)
    const lamp = named(new THREE.Group(), 'lamp', root)
    lamp.position.set(1.25, 4.06, 1.25)
    const glass = material('mat_glow')
    glass.emissive.set('#ff4f26')
    glass.emissiveIntensity = 1.6
    named(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.6, 0.3), glass), 'lamp_glass', lamp)
  }
  if (id === 'ch1-cellar') {
    for (const [name, z] of [['door_l', -0.838], ['door_r', 0.838]] as const) {
      const door = named(new THREE.Group(), name, root)
      door.position.set(0, 0.33, z)
      door.quaternion.set(0.132, 0.991, 0, 0).normalize()
      named(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.8).translate(0, 0, z < 0 ? -0.4 : 0.4), material('mat_wood')), `${name}_board`, door)
    }
  }
  if (id === 'ch1-smithy' || id === 'ch1-farmhouse') {
    if (id === 'ch1-smithy') {
      const fire = material('mat_glow')
      fire.emissive.set('#d23a18')
      fire.emissiveIntensity = 1.05
      named(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.4), fire), 'embers', root).position.set(-1.06, 0.6, -0.6)
      named(new THREE.Object3D(), 'socket_fx_forge', root).position.set(-1.06, 0.74, -0.6)
    }
    named(new THREE.Object3D(), 'socket_fx_smoke', root).position.set(-1.59, 4.2, -0.57)
  }
  return root.removeFromParent()
}

function library(ids: string[]): Promise<ModelLibrary> {
  return loadModels(ids as ModelId[], async (id) => scene(id))
}

function fakeWorld(level: BuiltLevel, player = { x: 0, y: 0 }): World {
  return {
    time: 0,
    status: 'playing',
    tuning: createDefaultTuning(),
    grid: { columns: level.grid.columns, rows: level.grid.rows, tiles: level.grid.tiles.slice() },
    crates: new Map<number, number>(),
    boss: null,
    player: { pos: { ...player }, aim: { ...player }, alive: true },
    landmarks: [],
    blades: [],
  } as unknown as World
}

function instancedIn(view: { group: THREE.Group }): THREE.InstancedMesh[] {
  const found: THREE.InstancedMesh[] = []
  view.group.traverse((child) => {
    if (child instanceof THREE.InstancedMesh) found.push(child)
  })
  return found
}

function withMaterial(view: { group: THREE.Group }, name: string): THREE.InstancedMesh[] {
  return instancedIn(view).filter((mesh) => (mesh.material as THREE.Material).name === name)
}

function meshesOf(view: { group: THREE.Group }, models: ModelLibrary, id: string): THREE.InstancedMesh[] {
  const geometries = new Set(models.parts(id as ModelId).map((part) => part.geometry))
  return instancedIn(view).filter((mesh) => geometries.has(mesh.geometry))
}

function boxes(view: { group: THREE.Group }, test: (parameters: BoxParameters) => boolean): THREE.InstancedMesh[] {
  return instancedIn(view).filter((mesh) => mesh.geometry instanceof THREE.BoxGeometry && test(mesh.geometry.parameters))
}

function bushes(view: { group: THREE.Group }): THREE.InstancedMesh[] {
  return instancedIn(view).filter(
    (mesh) => mesh.geometry instanceof THREE.IcosahedronGeometry && mesh.geometry.parameters.radius === 0.55,
  )
}

type BoxParameters = THREE.BoxGeometry['parameters']

function countTiles(level: BuiltLevel, tile: Tile, area?: number): number {
  let count = 0
  level.grid.tiles.forEach((value, index) => {
    const row = Math.floor(index / level.grid.columns)
    if (value === tile && (area === undefined || level.areaOfRow[row] === area)) count++
  })
  return count
}

function yawOf(mesh: THREE.InstancedMesh, instance: number): number {
  const matrix = new THREE.Matrix4()
  mesh.getMatrixAt(instance, matrix)
  const rotation = new THREE.Quaternion()
  matrix.decompose(new THREE.Vector3(), rotation, new THREE.Vector3())
  return new THREE.Euler().setFromQuaternion(rotation, 'YXZ').y
}

function instanceMatrix(mesh: THREE.InstancedMesh, instance: number): THREE.Matrix4 {
  const matrix = new THREE.Matrix4()
  mesh.getMatrixAt(instance, matrix)
  return matrix
}

function scaleOf(mesh: THREE.InstancedMesh, instance: number): number {
  const matrix = new THREE.Matrix4()
  mesh.getMatrixAt(instance, matrix)
  return matrix.getMaxScaleOnAxis()
}

const total = (meshes: THREE.InstancedMesh[]) => meshes.reduce((sum, mesh) => sum + mesh.count, 0)

function groundOf(view: { group: THREE.Group }): THREE.Mesh {
  const found = view.group.children.filter(
    (child): child is THREE.Mesh => (child as THREE.Mesh).isMesh && !(child instanceof THREE.InstancedMesh) && (child as THREE.Mesh).geometry.getAttribute('uv1') !== undefined,
  )
  expect(found).toHaveLength(1)
  return found[0]
}

function groundTops(view: { group: THREE.Group }, height: number): { column: number; row: number }[] {
  const geometry = groundOf(view).geometry
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const cells: { column: number; row: number }[] = []
  for (let vertex = 0; vertex < position.count; vertex += 4) {
    if (normal.getY(vertex) !== 1 || Math.abs(position.getY(vertex) - height) > 1e-6) continue
    cells.push({ column: Math.min(position.getX(vertex), position.getX(vertex + 2)), row: Math.min(position.getZ(vertex), position.getZ(vertex + 2)) })
  }
  return cells
}

const raisedOf = (mesh: THREE.InstancedMesh) => Array.from({ length: mesh.count }, (_, instance) => instance).filter((instance) => scaleOf(mesh, instance) > 0)

const FARM: AreaDef = { name: 'farm', theme: 'farm', rows: ['#o.....#', '#.o.P..#', '########'] }
const SLOPE: AreaDef = { name: 'slope', theme: 'meadow', rows: ['########', '#..o...#', '#......#'] }

describe('level view tile models', () => {
  it('picks wall models by area theme and keeps boxes where a model is missing', async () => {
    const models = await library(['ch1-wall-wood'])
    const level = levelFromAreas([FARM, SLOPE])
    const view = createLevelView(level, models)
    expect(total(meshesOf(view, models, 'ch1-wall-wood'))).toBe(countTiles(level, Tile.Wall, 0))
    expect(total(boxes(view, (box) => box.height === 1.1))).toBe(countTiles(level, Tile.Wall, 1))
    expect(groundTops(view, TERRAIN.floor.top)).toHaveLength(level.grid.columns * level.grid.rows - countTiles(level, Tile.Wall, 1))
    expect(groundTops(view, TERRAIN.island.top)).toHaveLength(countTiles(level, Tile.Wall, 1))
  })

  it('spreads variants over the cells and turns each by a quarter turn', async () => {
    const ids = ['ch1-wall-wood-a', 'ch1-wall-wood-b', 'ch1-wall-wood-c']
    const models = await library(ids)
    const level = levelFromAreas([FARM, SLOPE])
    const view = createLevelView(level, models)
    const batches = ids.map((id) => meshesOf(view, models, id))
    expect(batches.filter((meshes) => meshes.length > 0).length).toBeGreaterThanOrEqual(2)
    expect(total(batches.flat())).toBe(countTiles(level, Tile.Wall, 0))
    for (const mesh of batches.flat()) {
      for (let instance = 0; instance < mesh.count; instance++) {
        const quarter = yawOf(mesh, instance) / (Math.PI / 2)
        expect(Math.abs(quarter - Math.round(quarter))).toBeLessThan(1e-6)
      }
    }
  })

  it('draws o as haystacks on the farm and rocks on the slope, and hides one the boss broke', async () => {
    const models = await library(['ch1-haystack', 'ch1-rock'])
    const level = levelFromAreas([FARM, SLOPE])
    const view = createLevelView(level, models)
    const haystacks = meshesOf(view, models, 'ch1-haystack')
    const rocks = meshesOf(view, models, 'ch1-rock')
    expect(total(haystacks)).toBe(2)
    expect(total(rocks)).toBe(1)
    const world = fakeWorld(level)
    const index = world.grid.tiles.findIndex((tile, i) => tile === Tile.Rock && level.areaOfRow[Math.floor(i / level.grid.columns)] === 1)
    world.grid.tiles[index] = Tile.Floor
    view.update(world, 0.016)
    expect(scaleOf(rocks[0], 0)).toBe(0)
    expect(scaleOf(haystacks[0], 0)).toBeCloseTo(1)
  })

  it('stands carts as their own model and never as crates', async () => {
    const rows = ['#C.c.C#', '#..P..#', '#######']
    const withModel = await library(['ch1-cart', 'crate'])
    const level = levelFromAreas([{ name: 'yard', theme: 'village', rows }])
    const view = createLevelView(level, withModel)
    expect(total(meshesOf(view, withModel, 'ch1-cart'))).toBe(2)
    expect(total(meshesOf(view, withModel, 'crate'))).toBe(1)
    const fallback = createLevelView(level, await library([]))
    expect(total(boxes(fallback, (box) => box.width === 0.92))).toBe(2)
    expect(total(boxes(fallback, (box) => box.width === 0.86))).toBe(1)
  })

  it('draws each prop that never casts its own shadow as one mesh for the whole level, culled row by row as the camera moves', async () => {
    const models = await library(['ch1-wall-wood', 'ch1-tree', 'ch1-bush-grass', 'ch1-fence', 'ch1-haystack', 'crate'])
    const rows = ['#TT"".T#', '#.ff.o.#', '#.c.P.T#', '########']
    const level = levelFromAreas([{ name: 'yard', theme: 'village', rows }, { name: 'more', theme: 'village', rows }])
    const view = createLevelView(level, models)
    for (const id of ['ch1-wall-wood', 'ch1-tree', 'ch1-bush-grass']) {
      const meshes = meshesOf(view, models, id)
      expect(meshes).toHaveLength(1)
      expect(meshes[0].frustumCulled).toBe(false)
    }
    for (const name of ['mat_post', 'mat_rail']) {
      expect(withMaterial(view, name)).toHaveLength(1)
      expect(withMaterial(view, name)[0].frustumCulled).toBe(false)
    }
    for (const id of ['ch1-haystack', 'crate']) expect(meshesOf(view, models, id).every((mesh) => mesh.frustumCulled)).toBe(true)
    const ground = groundOf(view)
    expect(ground.frustumCulled).toBe(false)
    expect(ground.receiveShadow).toBe(true)
    expect(ground.castShadow).toBe(false)
  })

  it('merges a metal wall whose two materials share a texture but not their shine into one mesh', async () => {
    const atlas = new THREE.Texture()
    const look = (name: string, roughness: number, metalness: number) => {
      const result = material(name)
      result.map = atlas
      result.roughness = roughness
      result.metalness = metalness
      return result
    }
    const models = await loadModels(['ch1-wall-metal'] as ModelId[], async () => {
      const root = named(new THREE.Group(), 'root', new THREE.Group())
      named(new THREE.Mesh(new THREE.BoxGeometry(1, 1.1, 0.6).translate(0, 0.55, 0), look('mat_body', 0.55, 0.2)), 'body', root)
      named(new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.1, 0.65).translate(0, 1.1, 0), look('mat_dark', 0.5, 0.25)), 'trim', root)
      return root.removeFromParent()
    })
    const level = levelFromAreas([{ name: 'gate', theme: 'outpost', rows: ['#......#', '#..P...#', '########'] }])
    const view = createLevelView(level, models)
    const walls = instancedIn(view).filter((mesh) => (mesh.material as THREE.MeshStandardMaterial).map === atlas)
    expect(walls).toHaveLength(1)
    expect(walls[0].count).toBe(countTiles(level, Tile.Wall))
    const merged = walls[0].material as THREE.MeshStandardMaterial
    expect(merged.roughnessMap).not.toBeNull()
    expect(merged.metalnessMap).toBe(merged.roughnessMap)
    expect(walls[0].geometry.getAttribute('uv1')).toBeDefined()
    view.dispose()
  })

  it('builds fences from a post per cell and a rail towards each neighbouring fence', async () => {
    const models = await library(['ch1-fence'])
    const level = levelFromAreas([{ name: 'pen', theme: 'farm', rows: ['#......#', '#.fff..#', '#.f.P..#', '#.....f#', '########'] }])
    const view = createLevelView(level, models)
    expect(total(withMaterial(view, 'mat_post'))).toBe(5)
    expect(total(withMaterial(view, 'mat_rail'))).toBe(2 + 2 + 1 + 1)
    const rail = withMaterial(view, 'mat_rail')[0]
    const yaws = Array.from({ length: rail.count }, (_, index) => yawOf(rail, index))
    expect(yaws.filter((yaw) => Math.abs(yaw - facingYaw(0)) < 1e-6)).toHaveLength(2)
    expect(total(boxes(view, (box) => box.height === 0.55))).toBe(0)
    const plain = createLevelView(level, await library([]))
    expect(total(boxes(plain, (box) => box.height === 0.55))).toBe(5)
    for (const name of ['mat_post', 'mat_rail']) expect(withMaterial(view, name).every((mesh) => mesh.instanceColor === null)).toBe(true)
  })

  it('lays bridge decks over water, with a rail only on the sides that touch water', async () => {
    const rows = ['#~,,~#', '#~,,~#', '#.P..#', '######']
    const level = levelFromAreas([{ name: 'river', theme: 'meadow', rows }])
    const models = await library(['ch1-bridge'])
    const view = createLevelView(level, models)
    expect(total(withMaterial(view, 'mat_deck'))).toBe(4)
    expect(total(withMaterial(view, 'mat_rail'))).toBe(4)
    expect(total(withMaterial(view, 'mat_end'))).toBe(2)
    for (const name of ['mat_deck', 'mat_rail', 'mat_end']) expect(withMaterial(view, name).every((mesh) => mesh.instanceColor === null)).toBe(true)
    expect(groundTops(view, TERRAIN.water.top)).toHaveLength(8)
    const plain = createLevelView(level, await library([]))
    expect(groundTops(plain, TERRAIN.water.top)).toHaveLength(4)
  })

  it('stands trees and bushes at any angle and a slightly varied size, tinted cell by cell', async () => {
    const models = await library(['ch1-tree', 'ch1-bush-grass'])
    const rows = ['#TTTTTT#', '#TTTTTT#', '#""""""#', '#""P"""#', '########']
    const level = levelFromAreas([{ name: 'wood', theme: 'forest', rows }])
    const view = createLevelView(level, models)
    for (const id of ['ch1-tree', 'ch1-bush-grass']) {
      const meshes = meshesOf(view, models, id)
      expect(total(meshes)).toBe(id === 'ch1-tree' ? 12 : 11)
      const yaws: number[] = []
      const scales: number[] = []
      for (const mesh of meshes) {
        expect(mesh.instanceColor).not.toBeNull()
        for (let instance = 0; instance < mesh.count; instance++) {
          yaws.push(yawOf(mesh, instance))
          scales.push(scaleOf(mesh, instance))
        }
      }
      expect(yaws.some((yaw) => Math.abs(yaw / (Math.PI / 2) - Math.round(yaw / (Math.PI / 2))) > 0.05)).toBe(true)
      expect(Math.min(...scales)).toBeGreaterThanOrEqual(0.92 - 1e-6)
      expect(Math.max(...scales)).toBeLessThanOrEqual(1.08 + 1e-6)
      expect(new Set(scales.map((scale) => scale.toFixed(3))).size).toBeGreaterThan(3)
    }
  })

  it('draws trees and plank walls as one mesh when their two materials only differ a little in roughness', async () => {
    const looks: Record<string, readonly [string, string]> = {
      'ch1-tree': ['mat_leaf', 'mat_trunk'],
      'ch1-tree-b': ['mat_leaf', 'mat_trunk'],
      'ch1-wall-wood': ['mat_plank', 'mat_rope'],
      'ch1-wall-stone': ['mat_stone', 'mat_moss'],
    }
    const twoLooks = (id: string) => {
      const root = named(new THREE.Group(), 'root', new THREE.Group())
      const atlas = new THREE.Texture()
      const [main, trim] = looks[id].map((name, index) => {
        const result = material(name)
        result.map = atlas
        result.roughness = index === 0 ? 0.85 : 0.9
        return result
      })
      named(new THREE.Mesh(new THREE.BoxGeometry(0.9, 1, 0.9, 2, 2, 2), main), 'body', root)
      named(new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.2, 0.2), trim), 'trim', root)
      return root.removeFromParent()
    }
    const models = await loadModels(Object.keys(looks) as ModelId[], async (id) => twoLooks(id))
    const grove: AreaDef = { name: 'grove', theme: 'farm', rows: ['#T.T.T.#', '#.T.P..#', '########'] }
    const level = levelFromAreas([grove, SLOPE])
    const view = createLevelView(level, models)
    const trees = withMaterial(view, 'mat_leaf')
    expect(total(trees)).toBe(countTiles(level, Tile.Tree))
    expect(withMaterial(view, 'mat_trunk')).toEqual([])
    const leafVertices = new THREE.BoxGeometry(0.9, 1, 0.9, 2, 2, 2).getAttribute('position').count
    const trunkVertices = new THREE.BoxGeometry(0.2, 1.2, 0.2).getAttribute('position').count
    for (const mesh of trees) expect(mesh.geometry.getAttribute('position').count).toBe(leafVertices + trunkVertices)
    expect(total(withMaterial(view, 'mat_plank'))).toBe(countTiles(level, Tile.Wall, 0))
    expect(withMaterial(view, 'mat_rope')).toEqual([])
    expect(total(withMaterial(view, 'mat_stone'))).toBe(countTiles(level, Tile.Wall, 1))
    expect(withMaterial(view, 'mat_moss')).toEqual([])
  })

  it('merges a wheat bush whose leaves are double-sided into one double-sided mesh of its own', async () => {
    const atlas = new THREE.Texture()
    const look = (name: string, side: THREE.Side) => {
      const result = material(name)
      result.map = atlas
      result.side = side
      return result
    }
    const leaf = look('mat_leaf', THREE.DoubleSide)
    const ear = look('mat_ear', THREE.FrontSide)
    const wheat = () => {
      const root = named(new THREE.Group(), 'root', new THREE.Group())
      named(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.8), leaf), 'leaves', root)
      named(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.8, 0.4, 2, 2, 2), ear), 'ears', root)
      return root.removeFromParent()
    }
    const models = await loadModels(['ch1-bush-wheat'] as ModelId[], async () => wheat())
    const level = levelFromAreas([{ name: 'field', theme: 'farm', rows: ['#' + '"'.repeat(3) + '..#', '#..P..#', '#######'] }])
    const view = createLevelView(level, models)
    const merged = instancedIn(view).filter((mesh) => (mesh.material as THREE.Material).name === 'mat_ear')
    expect(total(merged)).toBe(countTiles(level, Tile.Bush))
    expect(withMaterial(view, 'mat_leaf')).toEqual([])
    const copy = merged[0].material as THREE.MeshStandardMaterial
    expect(copy).not.toBe(ear)
    expect(copy.side).toBe(THREE.DoubleSide)
    expect(copy.map).toBe(atlas)
    const disposed = vi.fn()
    copy.addEventListener('dispose', disposed)
    const kept = vi.fn()
    ear.addEventListener('dispose', kept)
    view.dispose()
    expect(disposed).toHaveBeenCalled()
    expect(kept).not.toHaveBeenCalled()
  })

  it('splits instances into blocks so the camera and the shadow pass can skip what is off screen', async () => {
    const width = Math.min(SCENE_CHUNK.width * 3, 48)
    const depth = SCENE_CHUNK.depth * 2
    const wall = '#'.repeat(width)
    const inside = (row: number) => (row === 1 ? `#${'c'.repeat(width - 3)}P#` : `#${'.'.repeat(width - 2)}#`)
    const rows = [wall, ...Array.from({ length: depth }, (_, row) => inside(row)), wall]
    const models = await library(['ch1-wall-wood', 'crate', 'crate-broken'])
    const level = levelFromAreas([{ name: 'yard', theme: 'farm', rows }])
    const { columns } = level.grid
    const blockOf = (x: number, z: number) => chunkOf(Math.floor(x), Math.floor(z), columns, SCENE_CHUNK.width, SCENE_CHUNK.depth)
    const blocksOf = (mesh: THREE.InstancedMesh) => {
      const blocks = new Set<number>()
      const matrix = new THREE.Matrix4()
      const position = new THREE.Vector3()
      for (let instance = 0; instance < mesh.count; instance++) {
        mesh.getMatrixAt(instance, matrix)
        position.setFromMatrixPosition(matrix)
        blocks.add(blockOf(position.x, position.z))
      }
      return blocks
    }
    const view = createLevelView(level, models)
    const walls = meshesOf(view, models, 'ch1-wall-wood')
    expect(walls).toHaveLength(1)
    expect(total(walls)).toBe(countTiles(level, Tile.Wall))
    expect(blocksOf(walls[0]).size).toBeGreaterThanOrEqual(3)
    expect(walls[0].frustumCulled).toBe(false)
    const order = Array.from({ length: walls[0].count }, (_, instance) => instanceMatrix(walls[0], instance).elements)
    const keys = order.map(([, , , , , , , , , , , , x, , z]) => Math.floor(z) * 1000 + Math.floor(x))
    expect(keys).toEqual([...keys].sort((a, b) => a - b))
    const whole = meshesOf(view, models, 'crate')
    const cracked = meshesOf(view, models, 'crate-broken')
    const crateBlocks = new Set(Array.from({ length: width - 3 }, (_, i) => blockOf(i + 1, level.areas[0].top + 1)))
    expect(whole).toHaveLength(crateBlocks.size)
    expect(total(whole)).toBe(width - 3)
    const world = fakeWorld(level)
    const index = world.grid.tiles.findIndex((tile) => tile === Tile.Crate)
    world.crates.set(index, 1)
    const before = cracked.map((mesh) => mesh.instanceMatrix.version)
    view.update(world, 0.016)
    const changed = cracked.filter((mesh, i) => mesh.instanceMatrix.version !== before[i])
    expect(changed).toHaveLength(1)
    expect(scaleOf(changed[0], 0)).toBeCloseTo(1)
  })

  it('draws gates as one instanced mesh per part and lifts a gate when it closes', async () => {
    const level = levelFromAreas([
      { name: 'arena', theme: 'arena', kind: 'lock', rows: ['##DD##', '#.m..#', '#....#', '##DD##'] },
      { name: 'start', theme: 'farm', rows: ['##DD##', '#....#', '#.P..#', '##DD##'] },
    ])
    const models = await library(['ch1-gate'])
    const view = createLevelView(level, models)
    const doors = meshesOf(view, models, 'ch1-gate')
    const glows = boxes(view, (box) => box.width === 0.98)
    expect(doors).toHaveLength(1)
    expect(glows).toHaveLength(1)
    expect(total(doors)).toBe(8)
    expect(total(glows)).toBe(8)
    const [door] = doors
    const [glow] = glows
    expect(door.instanceColor).not.toBeNull()
    for (const mesh of [door, glow]) {
      expect(mesh.visible).toBe(false)
      expect(raisedOf(mesh)).toEqual([])
    }
    const world = fakeWorld(level)
    const closed = world.grid.tiles.findIndex((tile) => tile === Tile.Gate)
    world.grid.tiles[closed] = Tile.GateClosed
    for (let i = 0; i < 60; i++) view.update(world, 0.05)
    expect(door.visible).toBe(true)
    expect(glow.visible).toBe(true)
    const raised = raisedOf(door)
    expect(raised).toHaveLength(1)
    expect(raisedOf(glow)).toEqual(raised)
    const at = new THREE.Vector3().setFromMatrixPosition(instanceMatrix(door, raised[0]))
    expect(at.y).toBeCloseTo(GATE_LIFT.model.up, 2)
    expect(at.x).toBeCloseTo((closed % level.grid.columns) + 0.5)
    expect(new THREE.Vector3().setFromMatrixPosition(instanceMatrix(glow, raised[0])).y - at.y).toBeCloseTo(1.1)
    expect(door.boundingSphere?.center.x).toBeCloseTo(at.x, 5)
    expect(door.boundingSphere?.center.z).toBeCloseTo(at.z, 5)
    const settled = door.instanceMatrix.version
    view.update(world, 0.05)
    expect(door.instanceMatrix.version).toBe(settled)
    world.grid.tiles[closed] = Tile.Gate
    for (let i = 0; i < 60; i++) view.update(world, 0.05)
    expect(door.visible).toBe(false)
    expect(raisedOf(door)).toEqual([])
  })
})

describe('instanced shadow depth', () => {
  it('gives the instanced tiles one shadow depth material when tinted and another when plain', async () => {
    const models = await library(['ch1-wall-wood', 'ch1-fence'])
    const level = levelFromAreas([{ name: 'pen', theme: 'farm', rows: ['#......#', '#.fff..#', '#.f.P..#', '########'] }])
    const view = createLevelView(level, models)
    const instanced = instancedIn(view)
    const tinted = instanced.filter((mesh) => mesh.instanceColor !== null)
    const plain = instanced.filter((mesh) => mesh.instanceColor === null)
    expect(tinted.length).toBeGreaterThan(0)
    expect(plain.length).toBeGreaterThan(0)
    expect(new Set(tinted.map((mesh) => mesh.customDepthMaterial)).size).toBe(1)
    expect(new Set(plain.map((mesh) => mesh.customDepthMaterial)).size).toBe(1)
    expect(tinted[0].customDepthMaterial).toBeInstanceOf(THREE.MeshDepthMaterial)
    expect(plain[0].customDepthMaterial).toBeInstanceOf(THREE.MeshDepthMaterial)
    expect(tinted[0].customDepthMaterial).not.toBe(plain[0].customDepthMaterial)
  })
})

describe('shadow casters', () => {
  const shadowOnlyIn = (view: { group: THREE.Group }) => view.group.children.filter((child): child is THREE.Mesh => (child as THREE.Mesh).isMesh && isShadowOnly(child))

  it('lets walls, trees and bushes cast through one shadow-only mesh per block, and keeps fences and flat decor out of the shadow', async () => {
    const models = await library(['ch1-wall-wood', 'ch1-tree', 'ch1-bush-grass', 'ch1-fence', 'ch1-haystack', 'crate'])
    const rows = ['#TT""..#', '#.ff.o.#', '#.c.P..#', '########']
    const level = levelFromAreas([{ name: 'yard', theme: 'village', rows }])
    const view = createLevelView(level, models)
    for (const id of ['ch1-wall-wood', 'ch1-tree', 'ch1-bush-grass']) {
      const meshes = meshesOf(view, models, id)
      expect(meshes.length).toBeGreaterThan(0)
      expect(meshes.some((mesh) => mesh.castShadow)).toBe(false)
    }
    expect(withMaterial(view, 'mat_post').some((mesh) => mesh.castShadow)).toBe(false)
    expect(meshesOf(view, models, 'ch1-haystack').every((mesh) => mesh.castShadow)).toBe(true)
    expect(meshesOf(view, models, 'crate').every((mesh) => mesh.castShadow)).toBe(true)
    const proxies = shadowOnlyIn(view)
    expect(proxies).toHaveLength(1)
    const [proxy] = proxies
    expect(proxy.castShadow).toBe(true)
    expect(proxy.receiveShadow).toBe(false)
    expect(proxy.layers.isEnabled(SHADOW_LAYER)).toBe(true)
    expect(proxy.layers.isEnabled(0)).toBe(false)
    expect(proxy.geometry.boundingSphere).not.toBeNull()
    const triangles = (geometry: THREE.BufferGeometry | null) => (geometry?.getIndex()?.count ?? 0) / 3
    const lathe = (id: ModelId) => triangles(proxyGeometry(models.parts(id).map((part) => part.geometry), 'lathe'))
    expect(lathe('ch1-tree')).toBeGreaterThan(0)
    expect(lathe('ch1-tree')).toBeLessThanOrEqual(2 * SHADOW_PROXY.segments * (SHADOW_PROXY.rings + 1))
    const expected = countTiles(level, Tile.Wall) * 12 + countTiles(level, Tile.Tree) * lathe('ch1-tree') + countTiles(level, Tile.Bush) * lathe('ch1-bush-grass')
    expect(triangles(proxy.geometry)).toBe(expected)
    proxy.geometry.computeBoundingBox()
    expect(proxy.geometry.boundingBox?.min.x).toBeLessThan(0.5)
    expect(proxy.geometry.boundingBox?.max.x).toBeGreaterThan(level.grid.columns - 0.5)
    expect(proxy.geometry.boundingBox?.max.y).toBeLessThanOrEqual(1.08 + 1e-3)
    view.dispose()
  })

  it('splits the shadow-only meshes into the same blocks as the tiles', async () => {
    const width = SCENE_CHUNK.width * 2
    const rows = ['#'.repeat(width), `#${'.'.repeat(width - 3)}P#`, '#'.repeat(width)]
    const models = await library(['ch1-wall-wood'])
    const level = levelFromAreas([{ name: 'hall', theme: 'farm', rows }])
    const view = createLevelView(level, models)
    const proxies = shadowOnlyIn(view)
    const blocks = new Set<number>()
    level.grid.tiles.forEach((tile, index) => {
      if (tile !== Tile.Wall) return
      blocks.add(chunkOf(index % level.grid.columns, Math.floor(index / level.grid.columns), level.grid.columns, SCENE_CHUNK.width, SCENE_CHUNK.depth))
    })
    expect(proxies).toHaveLength(blocks.size)
    for (const proxy of proxies) {
      const centre = proxy.geometry.boundingSphere?.center ?? new THREE.Vector3()
      const block = chunkOf(Math.floor(centre.x), Math.floor(centre.z), level.grid.columns, SCENE_CHUNK.width, SCENE_CHUNK.depth)
      proxy.geometry.computeBoundingBox()
      const box = proxy.geometry.boundingBox ?? new THREE.Box3()
      expect(chunkOf(Math.floor(box.min.x + 0.01), Math.floor(box.min.z + 0.01), level.grid.columns, SCENE_CHUNK.width, SCENE_CHUNK.depth)).toBe(block)
      expect(chunkOf(Math.floor(box.max.x - 0.01), Math.floor(box.max.z - 0.01), level.grid.columns, SCENE_CHUNK.width, SCENE_CHUNK.depth)).toBe(block)
    }
  })

  it('keeps flat decor landmarks out of the shadow pass', async () => {
    const models = await library(['ch1-wheat-ears', 'ch1-ruined-wall'])
    const level = levelFromAreas([
      { name: 'yard', theme: 'farm', rows: ['#......#', '#......#', '#..P...#', '########'], landmarks: [{ id: 'ch1-wheat-ears', at: [2, 1] }, { id: 'ch1-ruined-wall', at: [5, 1] }] },
    ])
    const views = createLandmarkViews(level, models)
    const batched = (id: string) => instancedIn(views).filter((mesh) => mesh.userData.model === id)
    expect(batched('ch1-wheat-ears').length).toBeGreaterThan(0)
    expect(batched('ch1-wheat-ears').some((mesh) => mesh.castShadow)).toBe(false)
    expect(batched('ch1-ruined-wall').every((mesh) => mesh.castShadow)).toBe(true)
  })
})

describe('gate badges', () => {
  it('turns north-south gates so the badge faces the middle of the map', async () => {
    const models = await library(['ch1-gate'])
    const rows = ['##########', '#........#', 'D...P....D', 'D........D', '##########']
    const level = levelFromAreas([{ name: 'hall', theme: 'arena', rows }])
    const view = createLevelView(level, models)
    const world = fakeWorld(level)
    world.grid.tiles.forEach((tile, index) => {
      if (tile === Tile.Gate) world.grid.tiles[index] = Tile.GateClosed
    })
    for (let i = 0; i < 60; i++) view.update(world, 0.05)
    const [door] = meshesOf(view, models, 'ch1-gate')
    const placed = raisedOf(door).map((instance) => {
      const position = new THREE.Vector3()
      const turn = new THREE.Quaternion()
      instanceMatrix(door, instance).decompose(position, turn, new THREE.Vector3())
      return { position, turn }
    })
    const west = placed.filter((gate) => gate.position.x < 1)
    const east = placed.filter((gate) => gate.position.x > level.grid.columns - 1)
    expect(west).toHaveLength(2)
    expect(east).toHaveLength(2)
    const facing = (degrees: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), facingYaw(degrees))
    for (const gate of west) expect(gate.turn.angleTo(facing(270))).toBeLessThan(1e-6)
    for (const gate of east) expect(gate.turn.angleTo(facing(90))).toBeLessThan(1e-6)
  })
})

describe('landmark views', () => {
  const YARD: AreaDef = {
    name: 'yard',
    theme: 'village',
    rows: [
      '################',
      '#..............#',
      '#..............#',
      '#..............#',
      '#..............#',
      '#..............#',
      '#..............#',
      '#.....P........#',
      '################',
    ],
    landmarks: [
      { id: 'ch1-barn', at: [1, 1] },
      { id: 'ch1-windmill', at: [7, 1], facing: 90 },
      { id: 'ch1-wheat-stack', at: [13, 5] },
      { id: 'ch1-wheat-ears', at: [8, 7], variant: 2 },
    ],
  }

  it('places models at the middle of their footprint, facing the way the level says', async () => {
    const models = await library(['ch1-barn', 'ch1-windmill', 'ch1-wheat-ears-b'])
    const level = levelFromAreas([YARD])
    const views = createLandmarkViews(level, models)
    expect(views.modelCount).toBe(3)
    const byModel = (id: string) => views.group.children.find((child) => child.userData.model === id)!
    expect(byModel('ch1-barn').position.toArray()).toEqual([4, 0, 4])
    expect(byModel('ch1-windmill').position.toArray()).toEqual([7 + 2.5, 0, 1 + 3])
    expect(byModel('ch1-windmill').rotation.y).toBeCloseTo(facingYaw(90))
    const ears = byModel('ch1-wheat-ears-b') as THREE.InstancedMesh
    expect(ears).toBeInstanceOf(THREE.InstancedMesh)
    expect(new THREE.Vector3().setFromMatrixPosition(instanceMatrix(ears, 0)).toArray()).toEqual([8.5, 0, 7.5])
    expect(views.placeholderCells).toBe(0)
  })

  it('spins the windmill blades and lifts the barn roof while the player is inside', async () => {
    const models = await library(['ch1-barn', 'ch1-windmill'])
    const level = levelFromAreas([YARD])
    const views = createLandmarkViews(level, models)
    const blades = views.group.getObjectByName('sails')!
    const roof = views.group.getObjectByName('roof')!
    const rest = blades.quaternion.clone()
    views.update(fakeWorld(level, { x: 6.5, y: 7.5 }), 1)
    expect(blades.quaternion.angleTo(rest)).toBeGreaterThan(0.1)
    expect(roof.visible).toBe(true)
    views.update(fakeWorld(level, { x: 3.5, y: 3.5 }), 0.016)
    expect(roof.visible).toBe(false)
  })

  it('makes the star on the old altar glow and breathe on its own copy of the material', async () => {
    const models = await library(['ch1-star-altar'])
    const level = levelFromAreas([{ ...YARD, landmarks: [{ id: 'ch1-star-altar', at: [1, 1], facing: 270 }] }])
    const views = createLandmarkViews(level, models)
    const star = views.group.getObjectByName('star') as THREE.Mesh
    const glow = star.material as THREE.MeshStandardMaterial
    const source = models.shared('ch1-star-altar' as ModelId).nodes.get('star') as THREE.Mesh
    expect(glow).not.toBe(source.material)
    const rule = glowRule('ch1-star-altar')!
    const seen: number[] = []
    for (let i = 0; i < 80; i++) {
      views.update(fakeWorld(level, { x: 6.5, y: 7.5 }), 0.05)
      seen.push(glow.emissiveIntensity)
    }
    expect(seen[0]).toBeCloseTo(0.5 * glowLevel(rule, 0.05))
    expect(Math.max(...seen)).toBeCloseTo(0.5 * (rule.gain + rule.swing), 1)
    expect(Math.min(...seen)).toBeCloseTo(0.5 * (rule.gain - rule.swing), 1)
    expect((source.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0.5)
  })

  it('falls back to theme-coloured boxes over the occupied cells, and to bushes for hiding spots', async () => {
    const models = await library([])
    const level = levelFromAreas([YARD])
    const views = createLandmarkViews(level, models)
    const barnCells = level.landmarks[0].cells.length
    const windmillCells = level.landmarks[1].cells.length
    expect(views.modelCount).toBe(0)
    expect(views.placeholderCells).toBe(barnCells + windmillCells + 1)
    const view = createLevelView(level, models)
    expect(total(boxes(view, (box) => box.width === 1 && box.height === 1 && box.depth === 1))).toBe(barnCells + windmillCells + 1)
    expect(total(bushes(view))).toBe(1)
    const dressed = createLevelView(level, await library(['ch1-wheat-stack']))
    expect(bushes(dressed)).toHaveLength(0)
  })

  it('swaps a grain cart for its wreck with a burst of chips and grain, and back for a new run', async () => {
    const models = await library(['ch1-hay-cart', 'ch1-hay-cart-wreck'])
    const level = buildLevel(LEVEL_1_2)
    const fx = { puff: vi.fn<Effects['puff']>(), burst: vi.fn<Effects['burst']>(), update: vi.fn<Effects['update']>(), clear: vi.fn<Effects['clear']>() }
    const views = createLandmarkViews(level, models, fx)
    const carts = views.group.children.filter((child) => child.userData.model === 'ch1-hay-cart')
    const wrecks = views.group.children.filter((child) => child.userData.model === 'ch1-hay-cart-wreck')
    expect(carts).toHaveLength(3)
    expect(wrecks).toHaveLength(3)
    const world = createWorld(level, createDefaultTuning())
    views.update(world, 0.016)
    expect(carts.every((cart) => cart.visible) && wrecks.every((wreck) => !wreck.visible)).toBe(true)
    const index = level.landmarks.findIndex((item) => item.id === 'ch1-hay-cart')
    damageLandmark(world, index, 100)
    views.update(world, 0.016)
    expect(carts[0].scale.y).toBeLessThan(1)
    damageLandmark(world, index, 1e6)
    views.update(world, 0.016)
    expect(carts[0].visible).toBe(false)
    expect(wrecks[0].visible).toBe(true)
    expect(wrecks[0].position.toArray()).toEqual(carts[0].position.toArray())
    expect(fx.burst).toHaveBeenCalledTimes(1)
    const debris = views.group.children.find((child) => child instanceof THREE.InstancedMesh && child.count > 0)
    expect(debris?.visible).toBe(true)
    views.update(createWorld(level, createDefaultTuning()), 0.016)
    expect(carts[0].visible).toBe(true)
    expect(wrecks[0].visible).toBe(false)
    expect(fx.burst).toHaveBeenCalledTimes(1)
  })

  it('swings a pen gate out by about 100 degrees over 0.6 s, opens the mill secret door inwards, and resets them for a new run', async () => {
    const models = await library(['ch1-sheep-pen', 'ch1-watermill'])
    const level = buildLevel(LEVEL_1_2)
    const views = createLandmarkViews(level, models)
    const world = createWorld(level, createDefaultTuning())
    views.update(world, 0.016)
    const gates = views.group.children.filter((child) => child.userData.model === 'ch1-sheep-pen').map((pen) => pen.getObjectByName('gate')!)
    const door = views.group.getObjectByName('secret_door')!
    const rest = gates[0].quaternion.clone()
    const pens = level.landmarks.filter((item) => item.gate)
    openPens(world, pens[0].area)
    views.update(world, LANDMARK_OPEN.seconds / 2)
    const half = gates[0].quaternion.angleTo(rest)
    expect(half).toBeGreaterThan(0.5)
    expect(half).toBeLessThan((100 * Math.PI) / 180)
    views.update(world, LANDMARK_OPEN.seconds / 2)
    expect(gates[0].quaternion.angleTo(rest)).toBeCloseTo((100 * Math.PI) / 180, 5)
    const turned = new THREE.Vector3(0, 0, -1).applyQuaternion(gates[0].quaternion)
    expect(turned.x).toBeGreaterThan(0.9)
    const mill = level.landmarks.findIndex((item) => item.id === 'ch1-watermill')
    openLandmark(world, mill)
    views.update(world, LANDMARK_OPEN.seconds)
    expect(new THREE.Euler().setFromQuaternion(door.quaternion).y).toBeCloseTo(-Math.PI / 2, 5)
    views.update(createWorld(level, createDefaultTuning()), 0.016)
    expect(gates[0].quaternion.angleTo(rest)).toBeLessThan(1e-9)
    expect(door.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-9)
  })

  it('draws water under the dock and the water wheel and never mistakes the dock for a bridge', async () => {
    const level = buildLevel(LEVEL_1_2)
    const wet = level.landmarks.flatMap((item) => item.water)
    expect(wet).toHaveLength(12 + 4)
    const plain = createLevelView(level, await library([]))
    expect(groundTops(plain, TERRAIN.water.top)).toHaveLength(countTiles(level, Tile.Water) + wet.length)
    const bridged = createLevelView(level, await library(['ch1-bridge']))
    const decks = total(withMaterial(bridged, 'mat_deck'))
    const decked = createLevelView({ ...level, landmarks: [] }, await library(['ch1-bridge']))
    expect(total(withMaterial(decked, 'mat_deck')) - decks).toBe(12)
  })

  it('instances the many one-cell ruined walls and wheat stacks per variant and block instead of one mesh each', async () => {
    const ids = ['ch1-ruined-wall', 'ch1-ruined-wall-b', 'ch1-ruined-wall-c', 'ch1-wheat-stack', 'ch1-wheat-stack-b', 'ch1-wheat-stack-c']
    const models = await library(ids)
    const level = buildLevel(LEVEL_1_3)
    const views = createLandmarkViews(level, models)
    const placed = (id: string) => level.landmarks.filter((item) => item.id === id).length
    const meshes = (id: string) => views.group.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh && child.userData.model === id)
    const walls = ['ch1-ruined-wall', 'ch1-ruined-wall-b', 'ch1-ruined-wall-c'].flatMap(meshes)
    const stacks = ['ch1-wheat-stack', 'ch1-wheat-stack-b', 'ch1-wheat-stack-c'].flatMap(meshes)
    expect(total(walls)).toBe(placed('ch1-ruined-wall'))
    expect(total(stacks)).toBe(placed('ch1-wheat-stack'))
    expect(views.batchCount).toBe(walls.length + stacks.length)
    const blocks = (id: string) =>
      new Set(
        level.landmarks
          .filter((item) => item.id === id)
          .map((item) => `${item.variant}:${chunkOf(item.column, item.row, level.grid.columns, SCENE_CHUNK.width, SCENE_CHUNK.depth)}`),
      ).size
    expect(walls.length).toBe(blocks('ch1-ruined-wall'))
    expect(stacks.length).toBe(blocks('ch1-wheat-stack'))
    expect(walls.length + stacks.length).toBeLessThan((placed('ch1-ruined-wall') + placed('ch1-wheat-stack')) / 2)
    expect(views.modelCount).toBe(placed('ch1-ruined-wall') + placed('ch1-wheat-stack'))
    expect(walls.every((mesh) => mesh.receiveShadow === false && mesh.boundingSphere !== null)).toBe(true)
    for (const mesh of walls) {
      for (let instance = 0; instance < mesh.count; instance++) {
        const quarter = (yawOf(mesh, instance) - facingYaw(0)) / (Math.PI / 2)
        expect(Math.abs(quarter - Math.round(quarter))).toBeLessThan(1e-6)
      }
    }
    const yaws = stacks.flatMap((mesh) => Array.from({ length: mesh.count }, (_, instance) => yawOf(mesh, instance)))
    expect(yaws.some((yaw) => Math.abs(yaw / (Math.PI / 2) - Math.round(yaw / (Math.PI / 2))) > 0.05)).toBe(true)
    const dressed = createLevelView(level, models)
    expect(bushes(dressed)).toHaveLength(0)
  })

  it('draws a one-cell landmark whose materials share one texture as a single part, but keeps glowing or differently textured ones apart', () => {
    const atlas = new THREE.Texture()
    const other = new THREE.Texture()
    const make = (name: string, map: THREE.Texture, roughness = 0.9) => {
      const result = material(name)
      result.map = map
      result.roughness = roughness
      return result
    }
    const box = (size: number) => new THREE.BoxGeometry(size, size, size)
    const straw = { geometry: box(1), material: make('mat_straw', atlas) }
    const rope = { geometry: box(0.5), material: make('mat_rope', atlas.clone(), 0.85) }
    expect(sharesLook([straw.material, rope.material])).toBe(true)
    const single = onePart([straw, rope])
    expect(single?.material).toBe(straw.material)
    expect(single?.geometry.getAttribute('position').count).toBe(
      straw.geometry.getAttribute('position').count + rope.geometry.getAttribute('position').count,
    )
    expect(onePart([straw, { geometry: box(0.5), material: make('mat_other', other) }])).toBeNull()
    const glow = make('mat_glow', atlas)
    glow.emissive.set('#ff0000')
    expect(onePart([straw, { geometry: box(0.5), material: glow }])).toBeNull()
    expect(onePart([straw, { geometry: box(0.5), material: make('mat_rough', atlas, 0.5) }])).toBeNull()
    expect(onePart([straw])).toBeNull()
  })

  it('keeps the bell still until the rope is pulled, swings it wide and blinks the lamp once the alarm rings, and sends rings out', async () => {
    const models = await library(['ch1-bell-tower'])
    const level = buildLevel(LEVEL_1_3)
    const views = createLandmarkViews(level, models)
    const world = createWorld(level, createDefaultTuning())
    const bell = views.group.getObjectByName('bell')!
    const glass = (views.group.getObjectByName('lamp_glass') as THREE.Mesh).material as THREE.MeshStandardMaterial
    const rest = bell.quaternion.clone()
    const waves = () => views.group.children.filter((child) => child instanceof THREE.Mesh && child.geometry instanceof THREE.RingGeometry && child.visible)
    let quiet = 0
    for (let i = 0; i < 120; i++) {
      views.update(world, 1 / 60)
      quiet = Math.max(quiet, bell.quaternion.angleTo(rest))
    }
    expect(quiet).toBe(0)
    expect(glass.emissiveIntensity).toBeCloseTo(1.6 * ALARM_BELL.lampIdle)
    expect(waves()).toHaveLength(0)
    world.alarms[0].status = 'running'
    world.alarms[0].pulling = 0.3
    let pulled = 0
    const lamps = new Set<number>()
    for (let i = 0; i < 90; i++) {
      views.update(world, 1 / 60)
      pulled = Math.max(pulled, bell.quaternion.angleTo(rest))
      lamps.add(Number(glass.emissiveIntensity.toFixed(3)))
    }
    expect(pulled).toBeGreaterThan(0.02)
    expect(lamps.size).toBeGreaterThan(1)
    world.alarms[0].pulling = 0
    raiseAlarms(world)
    views.update(world, 1 / 60)
    expect(waves().length).toBeGreaterThan(0)
    let rung = 0
    for (let i = 0; i < 240; i++) {
      views.update(world, 1 / 60)
      rung = Math.max(rung, bell.quaternion.angleTo(rest))
    }
    expect(rung).toBeGreaterThan(pulled * 1.5)
    expect(rung).toBeLessThanOrEqual(ALARM_BELL.rungSwing + 1e-6)
    expect(waves()).toHaveLength(0)
    views.update(createWorld(level, createDefaultTuning()), 1 / 60)
    expect(bell.quaternion.angleTo(rest)).toBeLessThan(1e-9)
  })

  it('flips both cellar doors outwards in opposite directions when the secret is found, and shuts them for a new run', async () => {
    const models = await library(['ch1-cellar'])
    const level = buildLevel(LEVEL_1_3)
    const views = createLandmarkViews(level, models)
    const world = createWorld(level, createDefaultTuning())
    views.update(world, 1 / 60)
    const left = views.group.getObjectByName('door_l')!
    const right = views.group.getObjectByName('door_r')!
    const restLeft = left.quaternion.clone()
    const restRight = right.quaternion.clone()
    openLandmark(world, level.landmarks.findIndex((item) => item.id === 'ch1-cellar'))
    views.update(world, LANDMARK_OPEN.seconds / 2)
    expect(left.quaternion.angleTo(restLeft)).toBeGreaterThan(0.5)
    views.update(world, LANDMARK_OPEN.seconds / 2)
    const angle = hingeOf('ch1-cellar', 'door_l').angle
    expect(left.quaternion.angleTo(restLeft)).toBeCloseTo(Math.abs(angle), 5)
    expect(right.quaternion.angleTo(restRight)).toBeCloseTo(Math.abs(angle), 5)
    const leftEdge = new THREE.Vector3(0, 0, -0.8).applyQuaternion(left.quaternion)
    const rightEdge = new THREE.Vector3(0, 0, 0.8).applyQuaternion(right.quaternion)
    expect(leftEdge.y).toBeGreaterThan(0.5)
    expect(rightEdge.y).toBeGreaterThan(0.5)
    expect(leftEdge.z).toBeLessThan(0)
    expect(rightEdge.z).toBeGreaterThan(0)
    views.update(createWorld(level, createDefaultTuning()), 1 / 60)
    expect(left.quaternion.angleTo(restLeft)).toBeLessThan(1e-6)
    expect(right.quaternion.angleTo(restRight)).toBeLessThan(1e-6)
  })

  it('rocks a silo the boss rams and spills grain from the side it was hit, then settles back upright', async () => {
    const models = await library(['ch1-silo'])
    const level = buildLevel(LEVEL_1_3)
    const fx = { puff: vi.fn<Effects['puff']>(), burst: vi.fn<Effects['burst']>(), update: vi.fn<Effects['update']>(), clear: vi.fn<Effects['clear']>() }
    const views = createLandmarkViews(level, models, fx)
    const world = createWorld(level, createDefaultTuning())
    views.update(world, 1 / 60)
    const index = level.landmarks.findIndex((item) => item.id === 'ch1-silo')
    const silo = views.group.children.find((child) => child.userData.model === 'ch1-silo' && Math.abs(child.position.x - (level.landmarks[index].column + 1.5)) < 1e-6)!
    const upright = silo.quaternion.clone()
    world.landmarks[index].crashes = 1
    let tilt = 0
    for (let i = 0; i < 30; i++) {
      views.update(world, 1 / 60)
      tilt = Math.max(tilt, silo.quaternion.angleTo(upright))
    }
    expect(tilt).toBeGreaterThan(LANDMARK_CRASH.tilt * 0.3)
    expect(tilt).toBeLessThanOrEqual(LANDMARK_CRASH.tilt + 1e-6)
    expect(fx.puff).toHaveBeenCalled()
    const debris = views.group.children.find((child) => child instanceof THREE.InstancedMesh && child.visible && child.userData.model === undefined)
    expect(debris).toBeDefined()
    for (let i = 0; i < 120; i++) views.update(world, 1 / 60)
    expect(silo.quaternion.angleTo(upright)).toBeLessThan(1e-9)
  })

  it('glows the smithy forge and puffs smoke from both chimneys while the player is around', async () => {
    const models = await library(['ch1-smithy', 'ch1-farmhouse'])
    const level = buildLevel(LEVEL_1_3)
    const fx = { puff: vi.fn<Effects['puff']>(), burst: vi.fn<Effects['burst']>(), update: vi.fn<Effects['update']>(), clear: vi.fn<Effects['clear']>() }
    const views = createLandmarkViews(level, models, fx)
    const smithy = level.landmarks.find((item) => item.id === 'ch1-smithy')!
    const house = level.landmarks.find((item) => item.id === 'ch1-farmhouse')!
    const world = createWorld(level, createDefaultTuning())
    world.player.pos = { x: smithy.column + 2, y: smithy.row + 6 }
    for (let i = 0; i < 120; i++) views.update(world, 1 / 60)
    const near = fx.puff.mock.calls.filter(([x, , y]) => Math.hypot(x - smithy.column - 2, y - smithy.row - 2) < 3)
    expect(near.some(([, height]) => height > 3.5)).toBe(true)
    expect(near.some(([, height]) => height < 1.2)).toBe(true)
    const smithyRoot = views.group.children.find((child) => child.userData.model === 'ch1-smithy')!
    const glows: THREE.MeshStandardMaterial[] = []
    smithyRoot.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.isMesh && (mesh.material as THREE.Material).name === 'mat_glow') glows.push(mesh.material as THREE.MeshStandardMaterial)
    })
    expect(glows).toHaveLength(1)
    expect(glows[0].emissiveIntensity).not.toBeCloseTo(1.05, 3)
    expect(views.group.children.some((child) => child instanceof THREE.Mesh && child.geometry instanceof THREE.IcosahedronGeometry)).toBe(true)
    fx.puff.mockClear()
    world.player.pos = { x: house.column + 2, y: house.row + 6 }
    for (let i = 0; i < 120; i++) views.update(world, 1 / 60)
    expect(fx.puff.mock.calls.some(([x, height, y]) => height > 4 && Math.hypot(x - house.column - 2.5, y - house.row - 2) < 3.5)).toBe(true)
    fx.puff.mockClear()
    world.player.pos = { x: 20, y: level.areas[level.areas.length - 1].top + 6 }
    for (let i = 0; i < 120; i++) views.update(world, 1 / 60)
    expect(fx.puff.mock.calls.filter(([, height]) => height > 3.5)).toHaveLength(0)
  })

  it('disposes its own copies but never the shared model parts', async () => {
    const models = await library(['ch1-barn', 'ch1-windmill', 'ch1-wall-wood'])
    const level = levelFromAreas([YARD])
    const view = createLevelView(level, models)
    const spies = models.parts('ch1-wall-wood' as ModelId).map((part) => vi.spyOn(part.geometry, 'dispose'))
    const blades = view.group.getObjectByName('blade') as THREE.Mesh
    const bladeMaterial = vi.spyOn(blades.material as THREE.Material, 'dispose')
    view.dispose()
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    expect(bladeMaterial).toHaveBeenCalled()
  })
})

describe('the airship of the sorting hall', () => {
  const HALL: AreaDef = {
    name: 'hall',
    theme: 'factory',
    rows: [
      '##########',
      '#........#',
      '#........#',
      '#........#',
      '#........#',
      '#........#',
      '#........#',
      '#........#',
      '#........#',
      '#........#',
      '#........#',
      '#........#',
      '#........#',
      '#........#',
      '#...P....#',
      '##########',
    ],
    landmarks: [{ id: 'ch1-airship', at: [2, 1] }],
  }

  it('hides the balloon while the player stands in its 6 x 12 footprint or within two cells of it, and keeps the hull, ramp and propellers', async () => {
    const models = await library(['ch1-airship'])
    const level = levelFromAreas([HALL])
    const views = createLandmarkViews(level, models)
    const balloon = views.group.getObjectByName('balloon')!
    const hull = views.group.getObjectByName('hull')!
    expect(balloon.visible).toBe(true)
    views.update(fakeWorld(level, { x: 4.5, y: 5.5 }), 0.016)
    expect(balloon.visible).toBe(false)
    expect(hull.visible).toBe(true)
    views.update(fakeWorld(level, { x: 2.2, y: 12.9 }), 0.016)
    expect(balloon.visible).toBe(false)
    views.update(fakeWorld(level, { x: 4.5, y: 13.1 }), 0.016)
    expect(balloon.visible).toBe(false)
    views.update(fakeWorld(level, { x: 9.9, y: 5.5 }), 0.016)
    expect(balloon.visible).toBe(false)
    views.update(fakeWorld(level, { x: 4.5, y: 15.1 }), 0.016)
    expect(balloon.visible).toBe(true)
    views.update(fakeWorld(level, { x: 10.1, y: 5.5 }), 0.016)
    expect(balloon.visible).toBe(true)
  })

  it('never fades the airship as a whole, because its hull is lower than the fade height and the balloon hides instead', async () => {
    const models = await library(['ch1-airship'])
    const level = levelFromAreas([HALL])
    const views = createLandmarkViews(level, models)
    expect(views.fadingCount).toBe(0)
    const placeholder = createLandmarkViews(level, await library([]))
    expect(placeholder.fadingCount).toBe(0)
    expect(placeholder.placeholderCells).toBe(level.landmarks[0].cells.length)
  })

  it('leaves every landmark with nodes hidden from inside out of the fade, however tall its definition says it is', () => {
    expect(LANDMARKS['ch1-airship'].height).toBeGreaterThan(2.5)
    expect(fadesBehind(LANDMARKS['ch1-airship'])).toBe(false)
    expect(fadesBehind({ height: 9.5 })).toBe(true)
    expect(fadesBehind(LANDMARKS['ch1-factory-gate'])).toBe(true)
  })

  it('spins both propellers about the long axis of the ship', async () => {
    const models = await library(['ch1-airship'])
    const level = levelFromAreas([HALL])
    const views = createLandmarkViews(level, models)
    const left = views.group.getObjectByName('prop_l')!
    const right = views.group.getObjectByName('prop_r')!
    const rest = left.quaternion.clone()
    views.update(fakeWorld(level, { x: 4.5, y: 14.5 }), 0.25)
    expect(left.quaternion.angleTo(rest)).toBeGreaterThan(0.5)
    const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(left.quaternion)
    expect(Math.abs(axis.x)).toBeCloseTo(1)
    expect(right.quaternion.angleTo(rest)).toBeGreaterThan(0.5)
  })
})

describe('conveyors and their cargo', () => {
  const level = buildLevel(LEVEL_1_5)
  const hall = level.areas.findIndex((area) => area.name === '分拣车间')
  const near = { x: 20.5, y: level.areas[hall].top + 12.5 }
  const far = { x: 19.5, y: level.areas[0].top + 20.5 }

  function arrows(view: { group: THREE.Group }): THREE.InstancedMesh[] {
    return instancedIn(view).filter((mesh) => mesh.geometry instanceof THREE.ConeGeometry)
  }

  function cargo(view: { group: THREE.Group }): THREE.InstancedMesh[] {
    const colors = Object.values(BELT_CARGO.fallback).map((color) => new THREE.Color(color))
    return instancedIn(view).filter((mesh) => {
      const tint = (mesh.material as THREE.MeshStandardMaterial).color
      return mesh.geometry instanceof THREE.BoxGeometry && colors.some((color) => tint?.equals(color))
    })
  }

  function snapshot(mesh: THREE.InstancedMesh): number[] {
    return Array.from(mesh.instanceMatrix.array as Float32Array)
  }

  it('keeps the belts of the sorting hall running while the boss arena belts wait for the boss', async () => {
    const view = createLevelView(level, await library([]))
    const sets = arrows(view)
    expect(sets.map((mesh) => mesh.count).sort((a, b) => a - b)).toEqual([60, (level.conveyors.length - 30) * 2])
    const [boss, running] = [...sets].sort((a, b) => a.count - b.count)
    const before = [snapshot(boss), snapshot(running)]
    view.update(fakeWorld(level, near), 0.1)
    expect(snapshot(boss)).toEqual(before[0])
    expect(snapshot(running)).not.toEqual(before[1])
    const world = fakeWorld(level, near)
    ;(world as { boss: unknown }).boss = { boss: { hazards: ['conveyor'] } }
    view.update(world, 0.1)
    expect(snapshot(boss)).not.toEqual(before[0])
    view.dispose()
  })

  it('carries wheat bales and anchor crates on the running belts while the player is near, and stops drawing them far away', async () => {
    const view = createLevelView(level, await library([]))
    const loads = cargo(view)
    expect(loads).toHaveLength(2)
    expect(loads.every((mesh) => !mesh.visible)).toBe(true)
    view.update(fakeWorld(level, near), 0.5)
    expect(loads.some((mesh) => mesh.visible && mesh.count > 0)).toBe(true)
    const total = loads.reduce((sum, mesh) => sum + mesh.count, 0)
    expect(total).toBeGreaterThan(8)
    expect(loads.every((mesh) => mesh.castShadow)).toBe(true)
    view.update(fakeWorld(level, far), 0.5)
    expect(loads.every((mesh) => !mesh.visible)).toBe(true)
    view.dispose()
  })

  it('carries the bale model instead of the straw box once the bale block is loaded', async () => {
    const models = await library(['ch1-bale-block'])
    const view = createLevelView(level, models)
    const [part] = models.parts('ch1-bale-block' as ModelId)
    const withBale = () => instancedIn(view).filter((mesh) => mesh.geometry === part.geometry)
    view.update(fakeWorld(level, far), 0.5)
    const stacked = withBale().filter((mesh) => mesh.visible)
    view.update(fakeWorld(level, near), 0.5)
    const carried = withBale().filter((mesh) => mesh.visible && !stacked.includes(mesh))
    expect(stacked.length).toBeGreaterThan(0)
    expect(carried).toHaveLength(1)
    expect(carried[0].count).toBeGreaterThan(0)
    expect(cargo(view)).toHaveLength(1)
    view.dispose()
  })
})

describe('building the level view in slices', () => {
  const sharedOf = (models: ModelLibrary, ids: readonly ModelId[]) => {
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    const textures = new Set<THREE.Texture>()
    for (const id of ids) {
      for (const part of models.parts(id)) {
        geometries.add(part.geometry)
        materials.add(part.material)
      }
      models.shared(id).root.traverse((object) => {
        const mesh = object as THREE.Mesh
        if (!mesh.isMesh) return
        geometries.add(mesh.geometry)
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material)
      })
    }
    for (const material of materials) for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value)
    return { geometries, materials, textures }
  }

  const summary = (group: THREE.Object3D) => {
    const lines: string[] = []
    group.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      const material = mesh.material as THREE.Material
      lines.push(`${mesh.type}|${material.type}:${material.name}|${(mesh as THREE.InstancedMesh).count ?? ''}|${mesh.geometry.getAttribute('position').count}|${mesh.castShadow}`)
    })
    return lines.sort()
  }

  it('builds the same view a few milliseconds at a time as in one go', async () => {
    const level = buildLevel(LEVEL_1_3)
    const ids = modelsFor(level)
    const models = await glbLibrary(ids)
    const whole = createLevelView(level, models)
    const steps = buildLevelView(level, models)
    let count = 0
    let step = steps.next()
    while (!step.done) {
      count += 1
      step = steps.next()
    }
    expect(count).toBeGreaterThan(40)
    expect(summary(step.value.group)).toEqual(summary(whole.group))
    const paced = await sliced(buildLevelView(level, models), { budget: 1, wait: 5, cancelled: () => false, hurry: () => false })
    expect(paced && summary(paced.group)).toEqual(summary(whole.group))
    whole.dispose()
    step.value.dispose()
    paced?.dispose()
  })

  it('frees whatever it had built when it is stopped halfway, and never the shared model parts', async () => {
    const level = buildLevel(LEVEL_1_3)
    const ids = modelsFor(level)
    const models = await glbLibrary(ids)
    const shared = sharedOf(models, ids)
    let total = 0
    for (const steps = buildLevelView(level, models); !steps.next().done; ) total += 1
    for (const stop of [0, 1, 2, 3, 5, 8, 13, 21, 34, Math.floor(total / 2), total - 3, total - 1]) {
      const added: THREE.Object3D[] = []
      const add = vi.spyOn(THREE.Object3D.prototype, 'add').mockImplementation(function (this: THREE.Object3D, ...objects: THREE.Object3D[]) {
        added.push(...objects)
        for (const object of objects) {
          object.removeFromParent()
          object.parent = this
          this.children.push(object)
        }
        return this
      })
      const geometry = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose')
      const material = vi.spyOn(THREE.Material.prototype, 'dispose')
      const texture = vi.spyOn(THREE.Texture.prototype, 'dispose')
      const instances = vi.spyOn(THREE.InstancedMesh.prototype, 'dispose')
      try {
        const steps = buildLevelView(level, models)
        for (let i = 0; i < stop; i++) steps.next()
        steps.return(undefined as never)
        const freed = {
          geometries: new Set(geometry.mock.contexts),
          materials: new Set(material.mock.contexts),
          textures: new Set(texture.mock.contexts),
          instances: new Set(instances.mock.contexts),
        }
        for (const item of shared.geometries) expect(freed.geometries.has(item)).toBe(false)
        for (const item of shared.materials) expect(freed.materials.has(item)).toBe(false)
        for (const item of shared.textures) expect(freed.textures.has(item)).toBe(false)
        const meshes: THREE.Mesh[] = []
        for (const root of added) {
          root.traverse((object) => {
            if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh)
          })
        }
        for (const mesh of meshes) {
          if (mesh instanceof THREE.InstancedMesh) expect(freed.instances.has(mesh)).toBe(true)
          if (!shared.geometries.has(mesh.geometry)) expect(freed.geometries.has(mesh.geometry)).toBe(true)
          for (const item of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            if (!shared.materials.has(item)) expect(freed.materials.has(item)).toBe(true)
            for (const value of Object.values(item)) {
              if (value instanceof THREE.Texture && !shared.textures.has(value)) expect(freed.textures.has(value)).toBe(true)
            }
          }
        }
      } finally {
        add.mockRestore()
        geometry.mockRestore()
        material.mockRestore()
        texture.mockRestore()
        instances.mockRestore()
      }
    }
  })
})
