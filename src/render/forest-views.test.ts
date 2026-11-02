import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { LEVEL_1_3 } from '../data/levels/level-1-3'
import { LEVEL_1_4 } from '../data/levels/level-1-4'
import { createDefaultTuning } from '../data/tuning'
import { lightLamp } from '../sim/fog'
import { buildLevel } from '../sim/level'
import { createWorld, type World } from '../sim/world'
import type { ModelId } from './asset-urls'
import {
  blurMask,
  createFade,
  DISSOLVE_CHANNELS,
  dissolveDelay,
  dissolvedValue,
  fadeValue,
  fogSpan,
  fogTargets,
  lampSources,
  retarget,
  settleFade,
  settlesBy,
} from './fog-motion'
import { buildFogView, createFogView, type FogView } from './fog-view'
import { batchesLandmark, createLandmarkViews } from './landmark-views'
import { loadModels, type ModelLibrary } from './model-library'
import { collectVariants } from './shader-warmup'
import { FOG_LAYER, LAMP_GLOW } from './themes'

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
  const body = named(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.8).translate(0, 0.3, 0), material('mat_bark')), 'body', root)
  if (id === 'ch1-fog-lamp') {
    const lamp = named(new THREE.Group(), 'lamp', body)
    lamp.position.set(0, 2.065, 0.32)
    named(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.4, 0.26), material('mat_glass')), 'glass', lamp).position.y = -0.4
    named(new THREE.Object3D(), 'socket_fx_light', lamp).position.y = -0.425
  }
  if (id === 'ch1-waterfall-cave') named(new THREE.Object3D(), 'socket_fx_waterfall', root).position.set(0.96, 2.42, 0)
  return root.removeFromParent()
}

function library(ids: string[]): Promise<ModelLibrary> {
  return loadModels(ids as ModelId[], async (id) => scene(id))
}

function mossy(): THREE.Object3D {
  const atlas = new THREE.Texture()
  const root = named(new THREE.Group(), 'root', new THREE.Group())
  const body = named(new THREE.Group(), 'body', root)
  const parts: [string, number][] = [
    ['mat_bark', 0.9],
    ['mat_wood', 0.8],
    ['mat_moss', 0.95],
    ['mat_mushroom', 0.7],
  ]
  parts.forEach(([name, roughness], index) => {
    const part = material(name)
    part.map = atlas
    part.roughness = roughness
    part.metalness = 0
    body.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3).translate(index * 0.2, 0.15, 0), part))
  })
  return root.removeFromParent()
}

function forest(): World {
  return createWorld(buildLevel(LEVEL_1_4), createDefaultTuning())
}

function instanced(group: THREE.Object3D): THREE.InstancedMesh[] {
  const found: THREE.InstancedMesh[] = []
  group.traverse((child) => {
    if (child instanceof THREE.InstancedMesh) found.push(child)
  })
  return found
}

function scaleAtSpot(meshes: THREE.InstancedMesh[], x: number, z: number): number | null {
  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  for (const mesh of meshes) {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix)
      position.setFromMatrixPosition(matrix)
      if (Math.abs(position.x - x) < 1e-6 && Math.abs(position.z - z) < 1e-6) return matrix.getMaxScaleOnAxis()
    }
  }
  return null
}

describe('1-4 landmark views', () => {
  it('batches logs, short logs and stumps, but keeps every fog lamp separate', () => {
    expect(batchesLandmark('ch1-log')).toBe(true)
    expect(batchesLandmark('ch1-log-short')).toBe(true)
    expect(batchesLandmark('ch1-stump')).toBe(true)
    expect(batchesLandmark('ch1-fog-lamp')).toBe(false)
    expect(batchesLandmark('grunt-wreck')).toBe(false)
    expect(batchesLandmark('ch1-hay-cart')).toBe(false)
  })

  it('draws the 12 logs in instanced batches and swaps a stump for its broken shape when it snaps', async () => {
    const models = await library(['ch1-log', 'ch1-log-short', 'ch1-stump', 'ch1-stump-b', 'ch1-stump-c'])
    const world = forest()
    const views = createLandmarkViews(world.level, models)
    views.update(world, 0.016)
    const of = (...ids: string[]) => instanced(views.group).filter((mesh) => ids.includes(mesh.userData.model as string))
    const logs = world.level.landmarks.filter((item) => item.id === 'ch1-log' || item.id === 'ch1-log-short').length
    expect(logs).toBe(12)
    expect(of('ch1-log', 'ch1-log-short').reduce((sum, mesh) => sum + mesh.count, 0)).toBe(logs)
    const index = world.level.landmarks.findIndex((item) => item.id === 'ch1-stump' && item.variant === 1)
    const stump = world.level.landmarks[index]
    const x = stump.column + 0.5
    const z = stump.row + 0.5
    expect(scaleAtSpot(of('ch1-stump'), x, z)).toBeCloseTo(1, 6)
    expect(scaleAtSpot(of('ch1-stump-b'), x, z)).toBe(0)
    world.landmarks[index].crashes = 1
    views.update(world, 0.05)
    expect(scaleAtSpot(of('ch1-stump'), x, z)).toBeCloseTo(1, 6)
    world.landmarks[index].crashes = 2
    world.landmarks[index].broken = true
    views.update(world, 0.05)
    views.update(world, 2)
    expect(scaleAtSpot(of('ch1-stump'), x, z)).toBe(0)
    expect(scaleAtSpot(of('ch1-stump-b'), x, z)).toBeCloseTo(1, 6)
    views.dispose()
  })

  it('draws a stump whose parts only differ in roughness as one batch and leaves unused broken stumps out of the draw', async () => {
    const models = await loadModels(['ch1-stump', 'ch1-stump-b', 'ch1-stump-c'] as ModelId[], async (id) => (id === 'ch1-stump-c' ? mossy() : scene(id)))
    const world = forest()
    const views = createLandmarkViews(world.level, models)
    views.update(world, 0.016)
    const of = (id: string) => instanced(views.group).filter((mesh) => mesh.userData.model === id)
    const mossyBatches = of('ch1-stump-c')
    expect(mossyBatches.length).toBeGreaterThan(0)
    expect(new Set(mossyBatches.map((mesh) => mesh.material)).size).toBe(1)
    const look = mossyBatches[0].material as THREE.MeshStandardMaterial
    expect(look.roughnessMap?.channel).toBe(1)
    expect(look.roughnessMap).toBe(look.metalnessMap)
    expect(mossyBatches[0].geometry.getAttribute('uv1')).toBeDefined()
    expect(mossyBatches.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(3)
    const broken = of('ch1-stump-b')
    expect(broken.length).toBeGreaterThan(0)
    expect(broken.every((mesh) => !mesh.visible)).toBe(true)
    expect(of('ch1-stump').every((mesh) => mesh.visible)).toBe(true)
    const index = world.level.landmarks.findIndex((item) => item.id === 'ch1-stump' && item.variant === 3)
    world.landmarks[index].crashes = 2
    world.landmarks[index].broken = true
    views.update(world, 0.05)
    expect(broken.filter((mesh) => mesh.visible)).toHaveLength(1)
    views.dispose()
  })

  it('lights only the fog lamp that was switched on', async () => {
    const models = await library(['ch1-fog-lamp'])
    const world = forest()
    const views = createLandmarkViews(world.level, models)
    views.update(world, 0.016)
    const glass: THREE.MeshStandardMaterial[] = []
    views.group.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (mesh.isMesh && mesh.material instanceof THREE.MeshStandardMaterial && mesh.material.name === 'mat_glass') glass.push(mesh.material)
    })
    expect(glass.length).toBe(world.level.lamps.length)
    expect(new Set(glass).size).toBe(glass.length)
    expect(glass.every((item) => item.emissiveIntensity === 0)).toBe(true)
    lightLamp(world, 0)
    views.update(world, 0.016)
    views.update(world, LAMP_GLOW.rise + 0.5)
    const lit = glass.filter((item) => item.emissiveIntensity > 1)
    expect(lit.length).toBe(1)
    expect(lit[0].emissive.getHexString()).toBe(new THREE.Color(LAMP_GLOW.emissive).getHexString())
    views.dispose()
  })

  it('hangs a waterfall in front of the cave that thins out while Kai stands in the secret', async () => {
    const models = await library(['ch1-waterfall-cave'])
    const world = forest()
    const views = createLandmarkViews(world.level, models)
    views.update(world, 0.016)
    const curtains: THREE.ShaderMaterial[] = []
    views.group.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (mesh.isMesh && mesh.material instanceof THREE.ShaderMaterial) curtains.push(mesh.material)
    })
    expect(curtains.length).toBe(1)
    const before = curtains[0].uniforms.uOpacity.value as number
    const secret = world.level.secrets[0]
    world.player.pos = { x: secret.column + 0.5, y: secret.row + 0.5 }
    for (let i = 0; i < 30; i++) views.update(world, 0.05)
    expect(curtains[0].uniforms.uOpacity.value).toBeLessThan(before * 0.5)
    views.dispose()
  })
})

describe('fog view', () => {
  it('draws all four layers with one shader program that samples one tileable noise texture', () => {
    const world = forest()
    const view = createFogView(world.level)
    const planes = view.group.children as THREE.Mesh[]
    expect(planes.map((plane) => plane.position.y)).toEqual(FOG_LAYER.layers.map((layer) => layer.height))
    const materials = planes.map((plane) => plane.material as THREE.ShaderMaterial)
    const textures = new Set(materials.map((material) => material.uniforms.uNoise.value as THREE.DataTexture))
    expect(textures.size).toBe(1)
    const [texture] = textures
    expect(texture.image.width).toBe(FOG_LAYER.noise.size)
    expect(texture.wrapS).toBe(THREE.RepeatWrapping)
    expect(texture.wrapT).toBe(THREE.RepeatWrapping)
    expect(texture.generateMipmaps).toBe(false)
    expect(materials.every((material) => material.uniforms.uNoiseScale.value === 1 / FOG_LAYER.noise.period)).toBe(true)
    expect([...collectVariants(view.group).keys()]).toHaveLength(1)
    let disposed = false
    texture.addEventListener('dispose', () => {
      disposed = true
    })
    view.dispose()
    expect(disposed).toBe(true)
  })

  it('makes the noise once and lets later fog views reuse it without stepping', () => {
    const world = forest()
    const noiseOf = (view: FogView) => (((view.group.children[0] as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.uNoise.value as THREE.DataTexture).image.data
    const first = createFogView(world.level)
    const step = buildFogView(world.level).next()
    expect(step.done).toBe(true)
    if (!step.done) throw new Error('the second fog view should not step')
    expect(noiseOf(step.value)).toBe(noiseOf(first))
    first.dispose()
    step.value.dispose()
  })

  it('stays empty in levels without fog', () => {
    const view = createFogView(buildLevel(LEVEL_1_3))
    expect(view.active).toBe(false)
    expect(view.group.children.length).toBe(0)
  })

  it('lays ground fog under everything drawn with the default order and thins it around a lit lamp with one mask upload', () => {
    const world = forest()
    const view = createFogView(world.level)
    expect(view.active).toBe(true)
    const planes = view.group.children as THREE.Mesh[]
    expect(planes.length).toBe(FOG_LAYER.layers.length)
    expect(planes.every((plane) => plane.renderOrder < 0 && plane.renderOrder > FOG_LAYER.under)).toBe(true)
    view.update(world, 0.016)
    const material = planes[0].material as THREE.ShaderMaterial
    const texture = material.uniforms.uMask.value as THREE.DataTexture
    const data = texture.image.data as Uint16Array
    const lamp = world.level.lamps[0]
    const rect = material.uniforms.uRect.value as THREE.Vector4
    const at = (x: number, y: number) => {
      const index = (Math.floor(y - rect.y) * rect.z + Math.floor(x)) * DISSOLVE_CHANNELS
      const texel = Array.from({ length: DISSOLVE_CHANNELS }, (_, channel) => THREE.DataUtils.fromHalfFloat(data[index + channel]))
      return dissolvedValue(texel, 0, material.uniforms.uSince.value as number, material.uniforms.uFade.value as number)
    }
    expect(at(lamp.x, lamp.y)).toBe(1)
    lightLamp(world, 0)
    view.update(world, 0.05)
    const version = texture.version
    for (let i = 0; i < 6; i++) view.update(world, 0.05)
    expect(at(lamp.x, lamp.y)).toBeLessThan(0.6)
    expect(at(lamp.x + 5, lamp.y)).toBeGreaterThan(0.95)
    for (let i = 0; i < 40; i++) view.update(world, 0.05)
    expect(texture.version).toBe(version)
    expect(at(lamp.x, lamp.y)).toBe(0)
    expect(at(lamp.x + 5, lamp.y)).toBe(0)
    expect(at(lamp.x + 12, lamp.y - 6)).toBeGreaterThan(0.78)
    view.dispose()
  })

  it('uploads exact snapshots while two lamps dissolve at once, then hands the rest to the shader', () => {
    const world = forest()
    const view = createFogView(world.level)
    const material = (view.group.children[0] as THREE.Mesh).material as THREE.ShaderMaterial
    const texture = material.uniforms.uMask.value as THREE.DataTexture
    const data = texture.image.data as Uint16Array
    const span = fogSpan(world.level, FOG_LAYER.margin)
    if (!span) throw new Error('no fog')
    const size = span.rows * span.columns
    const fade = createFade(size)
    const target = new Float32Array(size)
    const values = new Float32Array(size)
    const exact = new Float32Array(size)
    const scratch = new Float32Array(size)
    const dt = 1 / 60
    let clock = 0
    let error = 0
    const step = () => {
      clock += dt
      const version = texture.version
      view.update(world, dt)
      return texture.version !== version
    }
    const check = () => {
      for (let i = 0; i < size; i++) values[i] = fadeValue(fade, i, clock, FOG_LAYER.fade)
      blurMask(values, span.columns, span.rows, FOG_LAYER.blur, exact, scratch)
      for (let i = 0; i < size; i++) {
        const texel = Array.from({ length: DISSOLVE_CHANNELS }, (_, channel) => THREE.DataUtils.fromHalfFloat(data[i * DISSOLVE_CHANNELS + channel]))
        const shown = dissolvedValue(texel, 0, material.uniforms.uSince.value as number, material.uniforms.uFade.value as number)
        error = Math.max(error, Math.abs(shown - exact[i]))
      }
    }
    const light = (index: number) => {
      lightLamp(world, index)
      const uploaded = step()
      retarget(fade, fogTargets(world, span, target), clock, dissolveDelay(span, lampSources(world.level, [index], FOG_LAYER), FOG_LAYER.maxDelay), FOG_LAYER.fade)
      check()
      return uploaded
    }
    step()
    settleFade(fade, fogTargets(world, span, target))
    expect(light(0)).toBe(true)
    for (let i = 0; i < 30; i++) {
      expect(step()).toBe(false)
      check()
    }
    const busy = settlesBy(fade, FOG_LAYER.fade)
    expect(busy).toBeGreaterThan(clock + 0.2)
    expect(light(1)).toBe(true)
    const lit = clock
    const uploads: boolean[] = []
    for (let i = 0; i < 90; i++) {
      uploads.push(step())
      check()
    }
    const last = uploads.lastIndexOf(true)
    expect(uploads.slice(0, last + 1).every(Boolean)).toBe(true)
    expect(lit + (last + 1) * dt).toBeGreaterThanOrEqual(busy - 1e-9)
    expect(lit + last * dt).toBeLessThan(busy)
    expect(error).toBeLessThan(0.015)
    view.dispose()
  })
})
