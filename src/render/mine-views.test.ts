import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { getBoss } from '../data/bosses'
import { LEVEL_1_4 } from '../data/levels/level-1-4'
import { createDefaultTuning } from '../data/tuning'
import { buildLevel } from '../sim/level'
import type { Mine } from '../sim/types'
import { createWorld, type World } from '../sim/world'
import { loadModels } from './model-library'
import { createMineViews, warningGeometry } from './mine-views'
import { MINE_LIGHT } from './themes'

function named<T extends THREE.Object3D>(object: T, name: string, parent: THREE.Object3D): T {
  object.userData.name = name
  parent.add(object)
  return object
}

function mineModel(): THREE.Object3D {
  const atlas = new THREE.Texture()
  const part = (name: string, roughness: number, metalness: number) => {
    const material = new THREE.MeshStandardMaterial({ map: atlas, roughness, metalness })
    material.name = name
    return material
  }
  const root = new THREE.Group()
  const body = named(new THREE.Group(), 'body', root)
  body.add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.09), part('mat_body', 0.6, 0)))
  body.add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.095), part('mat_dark', 0.55, 0.25)))
  body.add(new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.01), part('mat_brass', 0.4, 0.25)))
  const lamp = new THREE.MeshStandardMaterial({ emissive: '#ff0b03', emissiveIntensity: 1.2 })
  lamp.name = 'mat_lamp'
  named(new THREE.Mesh(new THREE.SphereGeometry(0.07), lamp), 'light', body).position.y = 0.084
  return root
}

function mine(world: World, patch: Partial<Mine> = {}): Mine {
  const item: Mine = { id: world.nextId++, pos: { x: 20, y: 15 }, age: 2, fuse: -1, blast: -1, cause: null, owner: 'forest-tank', attack: null, ...patch }
  world.mines.push(item)
  return item
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

async function setup() {
  const models = await loadModels(['mine'], async () => mineModel())
  const scene = new THREE.Scene()
  const views = createMineViews(scene, models, null)
  const world = createWorld(buildLevel(LEVEL_1_4), createDefaultTuning())
  return { scene, views, world }
}

function warning(root: THREE.Object3D): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  const ring = drawn(root).find((mesh) => mesh.geometry.getAttribute('color')?.itemSize === 4)
  if (!ring) throw new Error('no warning ring')
  return ring as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
}

describe('mine views', () => {
  it('rings every quiet mine at its trigger distance with a faint red circle', async () => {
    const { scene, views, world } = await setup()
    mine(world)
    mine(world, { pos: { x: 23, y: 16 } })
    views.sync(world, 0.016)
    const roots = scene.children.filter((child) => child.visible)
    expect(roots).toHaveLength(2)
    const ring = warning(roots[0])
    expect(ring.scale.x).toBeCloseTo(getBoss('forest-tank').mines?.trigger ?? 0, 6)
    expect(ring.material.opacity).toBeGreaterThanOrEqual(MINE_LIGHT.ringIdle[0] - 1e-9)
    expect(ring.material.opacity).toBeLessThanOrEqual(MINE_LIGHT.ringIdle[1] + 1e-9)
    expect(ring.material.color.getHexString()).toBe(new THREE.Color(MINE_LIGHT.ring).getHexString())
    expect(ring.material.depthWrite).toBe(false)
    expect(ring.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(MINE_LIGHT.ringHeight, 6)
  })

  it('makes the ring solid and bright once the mine is triggered', async () => {
    const { scene, views, world } = await setup()
    const item = mine(world)
    views.sync(world, 0.016)
    const ring = warning(scene.children[0])
    const quiet = ring.material.opacity
    item.fuse = 0.2
    views.sync(world, 0.016)
    expect(ring.material.opacity).toBe(MINE_LIGHT.ringLit)
    expect(ring.material.opacity).toBeGreaterThan(quiet)
    expect(ring.material.color.getHexString()).toBe(new THREE.Color(MINE_LIGHT.ringArmed).getHexString())
  })

  it('adds a solid red spark over the lamp and draws the body in one piece', async () => {
    const { scene, views, world } = await setup()
    mine(world)
    views.sync(world, 0.016)
    const root = scene.children[0]
    const sprites = root.children.filter((child): child is THREE.Sprite => child instanceof THREE.Sprite)
    const spark = sprites.find((sprite) => sprite.material.blending === THREE.NormalBlending)
    expect(spark).toBeDefined()
    expect(spark?.material.color.getHexString()).toBe(new THREE.Color(MINE_LIGHT.spark).getHexString())
    expect(spark?.material.opacity).toBeGreaterThanOrEqual(MINE_LIGHT.sparkLow)
    const solid = drawn(root).filter((mesh) => mesh.material instanceof THREE.MeshStandardMaterial)
    expect(solid).toHaveLength(2)
    expect(solid.map((mesh) => (mesh.material as THREE.MeshStandardMaterial).name).sort()).toEqual(['mat_brass', 'mat_lamp'])
  })

  it('shares one merged body between mines and blinks every lamp on its own', async () => {
    const { scene, views, world } = await setup()
    mine(world)
    mine(world, { pos: { x: 23, y: 16 }, fuse: 0.2 })
    views.sync(world, 0.016)
    const solids = scene.children.map((root) => drawn(root).filter((mesh) => mesh.material instanceof THREE.MeshStandardMaterial))
    const bodies = solids.map((list) => list.find((mesh) => (mesh.material as THREE.MeshStandardMaterial).name !== 'mat_lamp'))
    const lamps = solids.map((list) => list.find((mesh) => (mesh.material as THREE.MeshStandardMaterial).name === 'mat_lamp'))
    expect(bodies[0]?.geometry).toBe(bodies[1]?.geometry)
    expect(bodies[0]?.material).toBe(bodies[1]?.material)
    expect(bodies[0]?.castShadow).toBe(true)
    expect(lamps[0]?.material).not.toBe(lamps[1]?.material)
    expect(lamps[0]?.castShadow).toBe(false)
  })

  it('hides views that no mine needs any more', async () => {
    const { scene, views, world } = await setup()
    mine(world)
    mine(world, { pos: { x: 23, y: 16 } })
    views.sync(world, 0.016)
    world.mines.pop()
    views.sync(world, 0.016)
    expect(scene.children.filter((child) => child.visible)).toHaveLength(1)
  })

  it('builds the warning as a faint disc inside a solid band', () => {
    const geometry = warningGeometry(0.2, 0.25)
    const alpha = geometry.getAttribute('color')
    const position = geometry.getAttribute('position')
    let inner = 0
    let band = 0
    for (let i = 0; i < position.count; i++) {
      const radius = Math.hypot(position.getX(i), position.getY(i))
      if (alpha.getW(i) === 1) band = Math.max(band, radius)
      else {
        expect(alpha.getW(i)).toBeCloseTo(0.25, 6)
        inner = Math.max(inner, radius)
      }
    }
    expect(inner).toBeCloseTo(0.8, 6)
    expect(band).toBeCloseTo(1, 6)
  })
})
