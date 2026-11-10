import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { LEVEL_1_4 } from '../data/levels/level-1-4'
import { TRAINING } from '../data/levels/training'
import { createDefaultTuning } from '../data/tuning'
import { spawnBlast } from '../sim/combat'
import { buildLevel } from '../sim/level'
import { spawnLob } from '../sim/lobs'
import { spawnBullet } from '../sim/projectiles'
import type { Attack } from '../sim/types'
import { createWorld } from '../sim/world'
import type { ModelId } from './asset-urls'
import type { Effects } from './effects'
import { loadModels } from './model-library'
import { shareMuzzle } from './muzzle-link'
import { BLADE_SINK_TIME, BLADE_STUCK_TIME, LAUNCH_LATE, ROCKET_TRAIL_SPACING } from './projectile-motion'
import { createProjectileViews } from './projectile-views'
import { FOG_LAYER, PROJECTILE_SCALES } from './themes'

const SOCKETS: Partial<Record<ModelId, [string, number, number, number]>> = {
  'rocket-shell': ['socket_fx_trail', -0.17, 0, 0],
  'legion-bomb': ['socket_fx_spark', 0.04, 0.18, 0],
  'falling-blade': ['socket_tip', 0.524, 0.263, 0],
}

function fakeModel(id: ModelId): THREE.Object3D {
  const scene = new THREE.Group()
  scene.userData.model = id
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshStandardMaterial())
  body.userData.name = 'body'
  scene.add(body)
  const socket = SOCKETS[id]
  if (socket) {
    const node = new THREE.Object3D()
    node.userData.name = socket[0]
    node.position.set(socket[1], socket[2], socket[3])
    body.add(node)
  }
  return scene
}

async function setup(ids: readonly ModelId[] = ['rocket-shell', 'grenade-shell', 'legion-bomb', 'wheat-bale', 'falling-blade']) {
  const models = await loadModels(ids, async (id) => fakeModel(id))
  const scene = new THREE.Scene()
  const effects: Effects = { puff: vi.fn(), burst: vi.fn(), sparks: vi.fn(), smoke: vi.fn(), explosion: vi.fn(), star: vi.fn(), update: vi.fn(), clear: vi.fn() }
  const views = createProjectileViews(scene, models, effects)
  const world = createWorld(buildLevel(TRAINING), createDefaultTuning())
  return { scene, effects, views, world, models }
}

function roots(scene: THREE.Scene, id: ModelId): THREE.Object3D[] {
  return scene.children.filter((child) => child.userData.model === id)
}

function shown(scene: THREE.Scene, id: ModelId): THREE.Object3D[] {
  return roots(scene, id).filter((child) => child.visible)
}

function spheres(scene: THREE.Scene): THREE.Mesh[] {
  return scene.children.filter(
    (child): child is THREE.Mesh => child instanceof THREE.Mesh && child.geometry instanceof THREE.SphereGeometry && child.visible,
  )
}

const BLADE_ATTACK: Attack = { by: 'boss', cause: 'fallingBlade', elite: false, boss: 'harvester' }

function blade(world: ReturnType<typeof createWorld>, x = 6, y = 6) {
  return spawnBlast(world, {
    x,
    y,
    radius: 1.1,
    delay: 1,
    playerDamage: 1,
    enemyDamage: 0,
    source: 'boss',
    ownerId: 0,
    attack: BLADE_ATTACK,
  })
}

describe('projectile views', () => {
  it('draws player rockets with the model and keeps other bullets as spheres', async () => {
    const { scene, views, world } = await setup()
    spawnBullet(world, 'player', 4, 4, 0.45, 0, 'rocket')
    spawnBullet(world, 'enemy', 6, 6, 0.45, 0, 'rifle')
    views.sync(world, 1, 0.016)
    expect(shown(scene, 'rocket-shell')).toHaveLength(1)
    expect(spheres(scene)).toHaveLength(1)
    expect(shown(scene, 'rocket-shell')[0].scale.x).toBeCloseTo(PROJECTILE_SCALES['rocket-shell'])
    world.bullets.length = 0
    views.sync(world, 1, 0.016)
    expect(shown(scene, 'rocket-shell')).toHaveLength(0)
    expect(roots(scene, 'rocket-shell')).toHaveLength(1)
    expect(spheres(scene)).toHaveLength(0)
  })

  it('falls back to spheres when the rocket model is missing', async () => {
    const { scene, views, world } = await setup(['grenade-shell'])
    spawnBullet(world, 'player', 4, 4, 0.45, 0, 'rocket')
    views.sync(world, 1, 0.016)
    expect(spheres(scene)).toHaveLength(1)
  })

  it('puffs the rocket trail once per spacing of travel', async () => {
    const { effects, views, world } = await setup()
    spawnBullet(world, 'player', 4, 4, 0.45, 0, 'rocket')
    world.bullets[0].traveled = ROCKET_TRAIL_SPACING * 2.5
    views.sync(world, 1, 0.016)
    expect(effects.puff).toHaveBeenCalledTimes(2)
    views.sync(world, 1, 0.016)
    expect(effects.puff).toHaveBeenCalledTimes(2)
    world.bullets[0].traveled = ROCKET_TRAIL_SPACING * 3.1
    views.sync(world, 1, 0.016)
    expect(effects.puff).toHaveBeenCalledTimes(3)
  })

  it('gives each lob weapon its own model pool and keeps the landing marker', async () => {
    const { scene, views, world } = await setup()
    spawnLob(world, 'player', { x: 4, y: 4 }, { x: 8, y: 4 }, 'grenade')
    spawnLob(world, 'enemy', { x: 5, y: 5 }, { x: 5, y: 9 }, 'bomb')
    spawnLob(world, 'enemy', { x: 6, y: 6 }, { x: 9, y: 9 }, 'baleToss')
    views.sync(world, 1, 0.016)
    expect(shown(scene, 'grenade-shell')).toHaveLength(1)
    expect(shown(scene, 'legion-bomb')).toHaveLength(1)
    expect(shown(scene, 'wheat-bale')).toHaveLength(1)
    expect(spheres(scene)).toHaveLength(0)
    const grenade = shown(scene, 'grenade-shell')[0]
    expect(grenade.position.y).toBeCloseTo(0.75 + 0.1 * PROJECTILE_SCALES['grenade-shell'])
    const bale = shown(scene, 'wheat-bale')[0]
    expect(bale.position.y).toBeGreaterThan(3.4)
    const rings = scene.children.filter((child) => child instanceof THREE.Mesh && child.geometry instanceof THREE.RingGeometry && child.visible)
    expect(rings).toHaveLength(3)
    world.lobs.splice(1, 2)
    views.sync(world, 1, 0.016)
    expect(shown(scene, 'legion-bomb')).toHaveLength(0)
    expect(shown(scene, 'wheat-bale')).toHaveLength(0)
    expect(shown(scene, 'grenade-shell')).toHaveLength(1)
  })

  it('draws every model projectile over the fog in foggy levels and hands the shared materials back elsewhere', async () => {
    const ids: ModelId[] = ['rocket-shell', 'grenade-shell', 'legion-bomb', 'wheat-bale', 'falling-blade', 'mine']
    const { scene, views, models } = await setup(ids)
    const tuning = createDefaultTuning()
    const throwAll = (world: ReturnType<typeof createWorld>) => {
      spawnBullet(world, 'player', 4, 4, 0.45, 0, 'rocket')
      spawnBullet(world, 'enemy', 6, 6, 0.45, 0, 'tankShell')
      spawnLob(world, 'player', { x: 4, y: 4 }, { x: 8, y: 4 }, 'grenade')
      spawnLob(world, 'enemy', { x: 5, y: 5 }, { x: 5, y: 9 }, 'bomb')
      spawnLob(world, 'enemy', { x: 6, y: 5 }, { x: 6, y: 9 }, 'chiefBomb')
      spawnLob(world, 'enemy', { x: 6, y: 6 }, { x: 9, y: 9 }, 'baleToss')
      spawnLob(world, 'enemy', { x: 7, y: 6 }, { x: 9, y: 8 }, 'tankMine')
      blade(world).delay = 0.2
    }
    const projectiles = () =>
      scene.children.filter((child) => child.visible && (typeof child.userData.model === 'string' || (child instanceof THREE.Mesh && child.geometry instanceof THREE.SphereGeometry)))
    const meshesOf = (roots: THREE.Object3D[]) => {
      const found: THREE.Mesh[] = []
      for (const root of roots) root.traverse((object) => (object as THREE.Mesh).isMesh && found.push(object as THREE.Mesh))
      return found
    }
    const foggy = createWorld(buildLevel(LEVEL_1_4), tuning)
    throwAll(foggy)
    views.sync(foggy, 1, 0.016)
    const shownModels = new Set(projectiles().map((root) => root.userData.model as string | undefined))
    expect([...shownModels].filter(Boolean).sort()).toEqual(['falling-blade', 'legion-bomb', 'mine', 'grenade-shell', 'rocket-shell', 'wheat-bale'].sort())
    const top = Math.max(...FOG_LAYER.layers.map((layer) => layer.order))
    const inFog = meshesOf(projectiles())
    expect(inFog.length).toBeGreaterThanOrEqual(8)
    for (const mesh of inFog) {
      const material = mesh.material as THREE.Material
      expect(material.transparent).toBe(true)
      expect(material.opacity).toBe(1)
      expect(material.depthWrite).toBe(true)
      expect(mesh.renderOrder).toBeGreaterThan(top)
    }
    const shared = new Set(ids.flatMap((id) => models.shared(id).materials))
    const clear = createWorld(buildLevel(TRAINING), tuning)
    throwAll(clear)
    views.sync(clear, 1, 0.016)
    const outside = meshesOf(projectiles().filter((root) => typeof root.userData.model === 'string'))
    expect(outside.length).toBeGreaterThanOrEqual(7)
    for (const mesh of outside) {
      const material = mesh.material as THREE.Material
      expect(material.transparent).toBe(false)
      expect(shared.has(material) || material instanceof THREE.MeshBasicMaterial).toBe(true)
    }
    expect([...shared].every((material) => !material.transparent)).toBe(true)
  })

  it('drops the blade late in the warning and plants it when the warning runs out', async () => {
    const { scene, views, world } = await setup()
    const blast = blade(world)
    views.sync(world, 1, 0.016)
    expect(shown(scene, 'falling-blade')).toHaveLength(0)
    blast.delay = 0.2
    views.sync(world, 1, 0.016)
    const [falling] = shown(scene, 'falling-blade')
    expect(falling.position.y).toBeGreaterThan(1)
    world.time += 0.2
    world.blasts.length = 0
    views.sync(world, 1, 0.016)
    const planted = shown(scene, 'falling-blade')[0].position.y
    expect(planted).toBeLessThan(1)
    expect(planted).toBeGreaterThan(0)
    world.time += BLADE_STUCK_TIME + BLADE_SINK_TIME / 2
    views.sync(world, 1, 0.016)
    expect(shown(scene, 'falling-blade')[0].position.y).toBeLessThan(planted)
    world.time += BLADE_SINK_TIME
    views.sync(world, 1, 0.016)
    expect(shown(scene, 'falling-blade')).toHaveLength(0)
    blade(world, 8, 8).delay = 0.1
    views.sync(world, 1, 0.016)
    expect(shown(scene, 'falling-blade')).toHaveLength(1)
    expect(roots(scene, 'falling-blade')).toHaveLength(1)
  })

  it('removes a blade at once when its warning is cleared early', async () => {
    const { scene, views, world } = await setup()
    blade(world).delay = 0.3
    views.sync(world, 1, 0.016)
    expect(shown(scene, 'falling-blade')).toHaveLength(1)
    world.time += 0.05
    world.blasts.length = 0
    views.sync(world, 1, 0.016)
    expect(shown(scene, 'falling-blade')).toHaveLength(0)
  })

  it('clears planted blades when the boss is defeated and on reset', async () => {
    const { scene, views, world } = await setup()
    blade(world).delay = 0.01
    views.sync(world, 1, 0.016)
    world.time += 0.01
    world.blasts.length = 0
    views.sync(world, 1, 0.016)
    expect(shown(scene, 'falling-blade')).toHaveLength(1)
    views.handle({ type: 'bossDefeated', name: 'harvester', x: 0, y: 0 })
    views.sync(world, 1, 0.016)
    expect(shown(scene, 'falling-blade')).toHaveLength(0)
    blade(world).delay = 0.01
    spawnLob(world, 'enemy', { x: 5, y: 5 }, { x: 5, y: 9 }, 'bomb')
    views.sync(world, 1, 0.016)
    const children = scene.children.length
    views.reset()
    expect(shown(scene, 'falling-blade')).toHaveLength(0)
    expect(shown(scene, 'legion-bomb')).toHaveLength(0)
    expect(scene.children.length).toBe(children)
  })

  describe('player shots leave the muzzle', () => {
    const MUZZLE = new THREE.Vector3(4.5, 0.82, 4.25)
    const HEIGHT = 0.62

    function fly(world: ReturnType<typeof createWorld>, steps: number) {
      for (const bullet of world.bullets) {
        for (let i = 0; i < steps; i++) {
          bullet.prev.x = bullet.pos.x
          bullet.prev.y = bullet.pos.y
          const move = bullet.speed / 60
          bullet.pos.x += bullet.dirX * move
          bullet.pos.y += bullet.dirY * move
          bullet.traveled += move
        }
      }
    }

    async function armed(ids?: readonly ModelId[], muzzle: THREE.Vector3 | null = MUZZLE) {
      const context = await setup(ids)
      shareMuzzle(context.scene, { muzzle: (out) => (muzzle ? out.copy(muzzle) : null) })
      return context
    }

    it('starts a player bullet with its tail at the muzzle and hands it back to the sim path', async () => {
      const { scene, views, world } = await armed()
      spawnBullet(world, 'player', 4, 4, 0.45, 0, 'blaster')
      fly(world, 1)
      views.sync(world, 0.6, 0.016)
      const [bullet] = spheres(scene)
      const lead = bullet.scale.x * 0.13
      expect(bullet.position.x).toBeCloseTo(MUZZLE.x + lead)
      expect(bullet.position.y).toBeCloseTo(MUZZLE.y)
      expect(bullet.position.z).toBeCloseTo(MUZZLE.z)
      fly(world, 30)
      views.sync(world, 1, 0.016)
      const sim = world.bullets[0].pos
      expect(spheres(scene)[0].position.x).toBeCloseTo(sim.x)
      expect(spheres(scene)[0].position.y).toBeCloseTo(world.bullets[0].z)
      expect(spheres(scene)[0].position.z).toBeCloseTo(sim.y)
    })

    it('leaves enemy bullets and bullets first seen late on the sim path', async () => {
      const { scene, views, world } = await armed()
      spawnBullet(world, 'enemy', 6, 6, 0.45, 0, 'rifle')
      views.sync(world, 1, 0.016)
      expect(spheres(scene)[0].position.x).toBeCloseTo(world.bullets[0].pos.x)
      expect(spheres(scene)[0].position.y).toBeCloseTo(world.bullets[0].z)
      world.bullets.length = 0
      spawnBullet(world, 'player', 4, 4, 0.45, 0, 'blaster')
      fly(world, Math.ceil(LAUNCH_LATE * 60) + 2)
      views.sync(world, 1, 0.016)
      expect(spheres(scene)[0].position.x).toBeCloseTo(world.bullets[0].pos.x)
      expect(spheres(scene)[0].position.y).toBeCloseTo(world.bullets[0].z)
    })

    it('keeps the old path when there is no muzzle to start from', async () => {
      const { scene, views, world } = await armed(undefined, null)
      spawnBullet(world, 'player', 4, 4, 0.45, 0, 'blaster')
      views.sync(world, 1, 0.016)
      expect(spheres(scene)[0].position.y).toBeCloseTo(world.bullets[0].z)
      expect(spheres(scene)[0].position.x).toBeCloseTo(world.bullets[0].pos.x)
    })

    it('fans every shotgun pellet out of the same muzzle', async () => {
      const { scene, views, world } = await armed()
      for (const angle of [-0.35, -0.1, 0.2, 0.35]) spawnBullet(world, 'player', 4, 4, 0.45, angle, 'shotgun')
      views.sync(world, 0, 0.016)
      const pellets = spheres(scene)
      expect(pellets).toHaveLength(4)
      world.bullets.forEach((bullet, index) => {
        const lead = pellets[index].scale.x * 0.13
        expect(pellets[index].position.x - bullet.dirX * lead).toBeCloseTo(MUZZLE.x)
        expect(pellets[index].position.z - bullet.dirY * lead).toBeCloseTo(MUZZLE.z)
        expect(pellets[index].position.y).toBeCloseTo(MUZZLE.y)
      })
    })

    it('starts the rocket model and its first trail puffs at the launcher', async () => {
      const { scene, effects, views, world } = await armed()
      spawnBullet(world, 'player', 4, 4, 0.45, 0, 'rocket')
      views.sync(world, 0, 0.016)
      const [rocket] = shown(scene, 'rocket-shell')
      const tail = 0.17 * PROJECTILE_SCALES['rocket-shell']
      expect(rocket.position.x).toBeCloseTo(MUZZLE.x + tail)
      expect(rocket.position.y).toBeCloseTo(MUZZLE.y)
      fly(world, 3)
      views.sync(world, 1, 0.016)
      const puff = vi.mocked(effects.puff).mock.calls[0]
      expect(puff[1]).toBeGreaterThan(HEIGHT)
      expect(puff[2]).toBeGreaterThan(4)
    })

    it('throws player grenades from the muzzle and still lands them on the marker', async () => {
      const { scene, views, world } = await armed()
      const lob = spawnLob(world, 'player', { x: 4, y: 4 }, { x: 8, y: 4 }, 'grenade')
      spawnLob(world, 'enemy', { x: 5, y: 5 }, { x: 5, y: 9 }, 'bomb')
      views.sync(world, 1, 0.016)
      const grenade = shown(scene, 'grenade-shell')[0]
      expect(grenade.position.x).toBeCloseTo(MUZZLE.x + 0.1 * PROJECTILE_SCALES['grenade-shell'])
      expect(grenade.position.y).toBeCloseTo(MUZZLE.y)
      expect(grenade.position.z).toBeCloseTo(MUZZLE.z)
      expect(shown(scene, 'legion-bomb')[0].position.x).toBeCloseTo(5)
      lob.time = lob.total * 0.5
      lob.pos.x = lob.prev.x = lob.from.x + (lob.to.x - lob.from.x) * 0.5
      views.sync(world, 1, 0.016)
      const midway = shown(scene, 'grenade-shell')[0].position.z
      expect(midway).toBeGreaterThan(4)
      expect(midway).toBeLessThan(MUZZLE.z)
      lob.time = lob.total * 0.999
      lob.pos.x = lob.prev.x = lob.from.x + (lob.to.x - lob.from.x) * 0.999
      views.sync(world, 1, 0.016)
      expect(shown(scene, 'grenade-shell')[0].position.x).toBeCloseTo(8, 1)
      expect(shown(scene, 'grenade-shell')[0].position.z).toBeCloseTo(4, 1)
    })

    it('forgets launches on reset so reused ids start fresh', async () => {
      const { scene, views, world } = await armed()
      spawnBullet(world, 'player', 4, 4, 0.45, 0, 'blaster')
      fly(world, 40)
      views.sync(world, 1, 0.016)
      views.reset()
      world.bullets.length = 0
      world.nextId -= 1
      spawnBullet(world, 'player', 4, 4, 0.45, 0, 'blaster')
      views.sync(world, 0, 0.016)
      expect(spheres(scene)[0].position.y).toBeCloseTo(MUZZLE.y)
    })
  })
})
