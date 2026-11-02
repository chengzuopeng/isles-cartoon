import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { Tile } from '../sim/grid'
import { singleArea } from '../sim/testing'
import type { World } from '../sim/world'
import type { ModelId } from './asset-urls'
import { createCrateDebris } from './crate-debris'
import { createLevelView } from './level-view'
import { loadModels, type ModelLibrary } from './model-library'
import { debrisLaunches, debrisLife } from './prop-motion'

const PIECE_CENTERS: [number, number, number][] = [
  [0.26, 0.68, -0.06],
  [-0.29, 0.67, 0.07],
  [-0.08, 0.16, -0.27],
  [0.25, 0.17, 0.25],
  [-0.33, 0.15, 0.33],
]

function named<T extends THREE.Object3D>(object: T, name: string, parent: THREE.Object3D): T {
  object.name = name
  object.userData.name = name
  parent.add(object)
  return object
}

function wood(name: string): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial()
  material.name = name
  return material
}

function crateScene(): THREE.Object3D {
  const root = named(new THREE.Group(), 'root', new THREE.Group())
  const body = named(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8).translate(0, 0.43, 0), wood('mat_wood')), 'body', root)
  named(new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.1, 0.86), wood('mat_steel')), 'trim', body)
  return root.removeFromParent()
}

function brokenScene(): THREE.Object3D {
  const root = named(new THREE.Group(), 'root', new THREE.Group())
  const material = wood('mat_wood')
  PIECE_CENTERS.forEach(([x, y, z], i) => {
    const piece = named(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), material), `piece_${i + 1}`, root)
    piece.position.set(x, y, z)
  })
  return root.removeFromParent()
}

function atlasBrokenScene(): THREE.Object3D {
  const root = named(new THREE.Group(), 'root', new THREE.Group())
  const atlas = new THREE.Texture()
  const looks: [number, number][] = [
    [0.75, 0],
    [0.45, 0.25],
    [0.85, 0],
  ]
  const materials = looks.map(([roughness, metalness], index) => {
    const material = wood(`mat_part_${index}`)
    material.map = atlas
    material.roughness = roughness
    material.metalness = metalness
    return material
  })
  const decal = new THREE.MeshStandardMaterial({ name: 'mat_decal', map: new THREE.Texture(), alphaTest: 0.5 })
  PIECE_CENTERS.forEach(([x, y, z], i) => {
    const piece = named(new THREE.Group(), `piece_${i + 1}`, root)
    piece.position.set(x, y, z)
    materials.forEach((material, k) => {
      named(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.3).translate(0, k * 0.1 - 0.1, 0), material), `piece_${i + 1}_part_${k}`, piece)
    })
    named(new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1).translate(0, 0, 0.16), decal), `decal_piece_${i + 1}`, piece)
  })
  return root.removeFromParent()
}

function visibleMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = []
  root.traverseVisible((object) => {
    if ((object as THREE.Mesh).isMesh) found.push(object as THREE.Mesh)
  })
  return found
}

function library(ids: ModelId[] = ['crate', 'crate-broken']): Promise<ModelLibrary> {
  return loadModels(ids, async (id) => (id === 'crate' ? crateScene() : brokenScene()))
}

function fakeWorld(cells: ArrayLike<number>, columns: number, time = 0): World {
  const tiles = Uint8Array.from(cells)
  return {
    time,
    grid: { columns, rows: Math.ceil(tiles.length / columns), tiles },
    crates: new Map<number, number>(),
    boss: null,
  } as unknown as World
}

function crateIndex(world: World): number {
  return world.grid.tiles.findIndex((tile) => tile === Tile.Crate)
}

describe('crate debris', () => {
  it('throws the pieces of a crate that just broke and then retires them', async () => {
    const models = await library()
    const scene = new THREE.Scene()
    const debris = createCrateDebris(scene, models)
    const world = fakeWorld([Tile.Floor, Tile.Crate, Tile.Floor, Tile.Floor], 2)
    const { tiles } = world.grid
    debris.sync(world)
    expect(scene.children).toHaveLength(0)

    tiles[1] = Tile.Floor
    debris.sync(world)
    expect(scene.children).toHaveLength(1)
    const burst = scene.children[0]
    expect(burst.visible).toBe(true)
    expect(burst.position.x).toBeCloseTo(1.5)
    expect(burst.position.z).toBeCloseTo(0.5)
    const piece = burst.getObjectByName('piece_1')!
    const start = piece.position.clone()

    world.time = 0.15
    debris.sync(world)
    expect(piece.position.y).toBeGreaterThan(start.y)
    expect(Math.hypot(piece.position.x, piece.position.z)).toBeGreaterThan(Math.hypot(start.x, start.z))

    const pieces = PIECE_CENTERS.map(([x, y, z]) => ({ center: new THREE.Vector3(x, y, z), rest: 0.15 }))
    world.time = Math.max(...debrisLaunches(pieces, 1).map(debrisLife)) + 0.01
    debris.sync(world)
    expect(burst.visible).toBe(false)
  })

  it('reuses pooled bursts and forgets the old world after a reset', async () => {
    const models = await library()
    const scene = new THREE.Scene()
    const debris = createCrateDebris(scene, models)
    const world = fakeWorld([Tile.Crate, Tile.Crate], 2)
    const { tiles } = world.grid
    debris.sync(world)
    tiles[0] = Tile.Floor
    debris.sync(world)
    expect(scene.children.filter((child) => child.visible)).toHaveLength(1)

    debris.reset()
    expect(scene.children.filter((child) => child.visible)).toHaveLength(0)
    const next = fakeWorld([Tile.Crate, Tile.Crate], 2)
    debris.sync(next)
    expect(scene.children.filter((child) => child.visible)).toHaveLength(0)
    next.grid.tiles[1] = Tile.Floor
    debris.sync(next)
    expect(scene.children).toHaveLength(1)
    expect(scene.children[0].visible).toBe(true)
  })

  it('throws each piece as one mesh plus its decal, sharing them between bursts', async () => {
    const models = await loadModels(['crate-broken' as ModelId], async () => atlasBrokenScene())
    const scene = new THREE.Scene()
    const debris = createCrateDebris(scene, models)
    const world = fakeWorld([Tile.Crate, Tile.Crate], 2)
    debris.sync(world)
    world.grid.tiles[0] = Tile.Floor
    world.grid.tiles[1] = Tile.Floor
    debris.sync(world)
    expect(scene.children).toHaveLength(2)
    const [first, second] = scene.children
    for (let i = 1; i <= PIECE_CENTERS.length; i++) {
      const meshes = visibleMeshes(first.getObjectByName(`piece_${i}`)!)
      expect(meshes).toHaveLength(2)
      expect(meshes.filter((mesh) => mesh.castShadow)).toHaveLength(1)
    }
    expect(visibleMeshes(first)).toHaveLength(2 * PIECE_CENTERS.length)
    const materials = (root: THREE.Object3D) => new Set(visibleMeshes(root).map((mesh) => mesh.material))
    expect(materials(second)).toEqual(materials(first))
  })

  it('does nothing without the broken crate model', async () => {
    const models = await library(['crate'])
    const scene = new THREE.Scene()
    const debris = createCrateDebris(scene, models)
    const world = fakeWorld([Tile.Crate], 1)
    debris.sync(world)
    world.grid.tiles[0] = Tile.Floor
    debris.sync(world)
    expect(scene.children).toHaveLength(0)
  })
})

describe('level view crates', () => {
  const rows = ['.c.c', '..P.']

  function crateMeshes(view: { group: THREE.Group }, models: ModelLibrary, id: ModelId): THREE.InstancedMesh[] {
    const geometries = new Set(models.parts(id).map((part) => part.geometry))
    return view.group.children.filter(
      (child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh && geometries.has(child.geometry),
    )
  }

  function scaleOf(mesh: THREE.InstancedMesh, instance: number): number {
    const matrix = new THREE.Matrix4()
    mesh.getMatrixAt(instance, matrix)
    return matrix.getMaxScaleOnAxis()
  }

  it('builds one instanced mesh per material and stands crates on the ground', async () => {
    const models = await library()
    const level = singleArea(rows)
    const view = createLevelView(level, models)
    const whole = crateMeshes(view, models, 'crate')
    expect(whole).toHaveLength(models.parts('crate').length)
    expect(whole[0].count).toBe(2)
    const matrix = new THREE.Matrix4()
    whole[0].getMatrixAt(0, matrix)
    const position = new THREE.Vector3().setFromMatrixPosition(matrix)
    expect(position.y).toBe(0)
    expect(position.x % 1).toBeCloseTo(0.5)
    const color = new THREE.Color()
    whole[0].getColorAt(0, color)
    expect(Math.min(color.r, color.g, color.b)).toBeGreaterThan(0.75)
    for (const mesh of crateMeshes(view, models, 'crate-broken')) {
      expect(scaleOf(mesh, 0)).toBe(0)
      expect(mesh.visible).toBe(false)
    }
  })

  it('swaps a damaged crate for the cracked model and hides a broken one', async () => {
    const models = await library()
    const level = singleArea(rows)
    const view = createLevelView(level, models)
    const world = fakeWorld(level.grid.tiles, level.grid.columns)
    const { tiles } = world.grid
    const index = crateIndex(world)
    const whole = crateMeshes(view, models, 'crate')
    const cracked = crateMeshes(view, models, 'crate-broken')

    world.crates.set(index, 100)
    view.update(world, 0.016)
    expect(scaleOf(whole[0], 0)).toBe(0)
    expect(scaleOf(cracked[0], 0)).toBeCloseTo(1)
    expect(scaleOf(whole[0], 1)).toBeCloseTo(1)
    expect(cracked.every((mesh) => mesh.visible)).toBe(true)
    expect(whole.every((mesh) => mesh.visible)).toBe(true)

    tiles[index] = Tile.Floor
    world.crates.delete(index)
    view.update(world, 0.016)
    expect(scaleOf(whole[0], 0)).toBe(0)
    expect(scaleOf(cracked[0], 0)).toBe(0)
    expect(cracked.some((mesh) => mesh.visible)).toBe(false)
    const matrix = new THREE.Matrix4()
    cracked[0].getMatrixAt(0, matrix)
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).length()).toBeGreaterThan(0)

    tiles[index] = Tile.Crate
    view.update(world, 0.016)
    expect(scaleOf(whole[0], 0)).toBeCloseTo(1)
  })

  it('stops drawing a block of crates once none of them is standing', async () => {
    const models = await library()
    const level = singleArea(rows)
    const view = createLevelView(level, models)
    const world = fakeWorld(level.grid.tiles, level.grid.columns)
    const { tiles } = world.grid
    const whole = crateMeshes(view, models, 'crate')
    const indices = [...tiles.keys()].filter((index) => tiles[index] === Tile.Crate)
    expect(indices).toHaveLength(2)
    for (const index of indices) tiles[index] = Tile.Floor
    view.update(world, 0.016)
    expect(whole.some((mesh) => mesh.visible)).toBe(false)
    tiles[indices[1]] = Tile.Crate
    view.update(world, 0.016)
    expect(whole.every((mesh) => mesh.visible)).toBe(true)
  })

  it('disposes only its own resources, never the shared model parts', async () => {
    const models = await library()
    const view = createLevelView(singleArea(rows), models)
    const spies = [...models.parts('crate'), ...models.parts('crate-broken')].flatMap((part) => [
      vi.spyOn(part.geometry, 'dispose'),
      vi.spyOn(part.material, 'dispose'),
    ])
    const own = view.group.children.find(
      (child): child is THREE.Mesh => child instanceof THREE.Mesh && !(child instanceof THREE.InstancedMesh) && child.geometry.getAttribute('uv1') !== undefined,
    )!
    const ownDispose = vi.spyOn(own.geometry, 'dispose')
    view.dispose()
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    expect(ownDispose).toHaveBeenCalled()
  })

  it('falls back to box crates without the models', async () => {
    const models = await library([])
    const view = createLevelView(singleArea(rows), models)
    const boxes = view.group.children.filter(
      (child): child is THREE.InstancedMesh =>
        child instanceof THREE.InstancedMesh && child.geometry instanceof THREE.BoxGeometry && child.geometry.parameters.width === 0.86,
    )
    expect(boxes).toHaveLength(1)
    const matrix = new THREE.Matrix4()
    boxes[0].getMatrixAt(0, matrix)
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).y).toBeCloseTo(0.43)
  })
})
