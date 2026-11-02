import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDefaultTuning } from '../data/tuning'
import { singleArea } from '../sim/testing'
import { EMPTY_LIBRARY } from './model-library'
import { RIGID_PROGRAM, RigidDepthMaterial, RigidStandardMaterial } from './rigid-parts'
import { collectVariants, createCapture, createWarmer, depthMaterialFor, fadeKeepers, planWarmup, rehearse, variantKey, type WarmupPacing, type WarmupSources } from './shader-warmup'
import { shadowOnly } from './shadow-proxies'
import type { Steps } from './slices'
import type { ProgramSettle, Stage } from './stage'
import { stubImages } from './testing'

function mesh(material: THREE.Material, geometry: THREE.BufferGeometry = new THREE.BoxGeometry()): THREE.Mesh {
  return new THREE.Mesh(geometry, material)
}

function textured(channel = 0): THREE.MeshStandardMaterial {
  const map = new THREE.Texture()
  map.channel = channel
  return new THREE.MeshStandardMaterial({ map })
}

function sources(): WarmupSources {
  const scene = new THREE.Scene()
  const landmarks = new THREE.Group()
  landmarks.add(mesh(textured()))
  scene.add(landmarks)
  return { level: singleArea(['#####', '#P.m#', '#####']), tuning: createDefaultTuning(), models: EMPTY_LIBRARY, scene, landmarks }
}

type WarmStage = Pick<Stage, 'precompile' | 'settleProgram' | 'preload' | 'holdUpload'>

function pacing(overrides: Partial<WarmupPacing> = {}): WarmupPacing {
  return { budget: 1000, wait: 5, poll: 1, hurry: () => false, ...overrides }
}

function planSize(input: WarmupSources): number {
  const steps = planWarmup(input)
  let step = steps.next()
  while (!step.done) step = steps.next()
  const size = step.value.variants.size
  step.value.dispose()
  return size
}

let restore = () => {}
beforeEach(() => {
  restore = stubImages()
})
afterEach(() => restore())

describe('shader variant keys', () => {
  it('ignore colours and names but tell apart the features that pick a shader program', () => {
    const base = variantKey(mesh(new THREE.MeshStandardMaterial({ color: 'red' })), new THREE.MeshStandardMaterial({ color: 'red' }))
    const named = new THREE.MeshStandardMaterial({ color: 'blue', opacity: 0.5 })
    named.name = 'mat_body'
    expect(variantKey(mesh(named), named)).toBe(base)
    const variants = [
      new THREE.MeshStandardMaterial({ transparent: true }),
      new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }),
      new THREE.MeshStandardMaterial({ flatShading: true }),
      new THREE.MeshStandardMaterial({ alphaTest: 0.5 }),
      textured(),
      textured(1),
      new THREE.MeshBasicMaterial(),
    ]
    const keys = variants.map((material) => variantKey(mesh(material), material))
    expect(new Set([base, ...keys]).size).toBe(variants.length + 1)
    const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), 2)
    const plain = variantKey(instanced, instanced.material as THREE.Material)
    instanced.setColorAt(0, new THREE.Color('white'))
    expect(new Set([base, plain, variantKey(instanced, instanced.material as THREE.Material)]).size).toBe(3)
  })

  it('tell a jointed material apart from a plain one in both passes', () => {
    const plain = mesh(textured())
    plain.castShadow = true
    const rigid = mesh(new RigidStandardMaterial({ map: (plain.material as THREE.MeshStandardMaterial).map }))
    rigid.castShadow = true
    rigid.customDepthMaterial = new RigidDepthMaterial()
    const [plainKeys, rigidKeys] = [collectVariants(plain), collectVariants(rigid)].map((variants) => [...variants.keys()])
    expect(rigidKeys).toHaveLength(2)
    for (const key of rigidKeys) expect(plainKeys).not.toContain(key)
    expect(rigidKeys.every((key) => key.includes(RIGID_PROGRAM))).toBe(true)
    const depth = depthMaterialFor(rigid, rigid.material as THREE.Material)
    expect(depth).toBeInstanceOf(RigidDepthMaterial)
    expect(depth).not.toBe(rigid.customDepthMaterial)
    expect(depth.map).toBe((rigid.material as THREE.MeshStandardMaterial).map)
  })

  it('splits a transparent double-sided material into its back and front passes', () => {
    const material = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide })
    const keys = [...collectVariants(mesh(material)).keys()]
    expect(keys.filter((key) => key.startsWith('main:'))).toHaveLength(2)
    expect(keys.some((key) => key.includes('/back/'))).toBe(true)
    expect(keys.some((key) => key.includes('/front/'))).toBe(true)
  })

  it('adds the shadow pass only for meshes that cast shadows', () => {
    const caster = mesh(textured())
    expect([...collectVariants(caster).keys()].some((key) => key.startsWith('shadow:'))).toBe(false)
    caster.castShadow = true
    expect([...collectVariants(caster).keys()].some((key) => key.startsWith('shadow:'))).toBe(true)
  })

  it('compiles only the shadow pass for shadow-only proxies, which the camera never draws', () => {
    const proxy = shadowOnly(mesh(new THREE.MeshBasicMaterial()))
    const keys = [...collectVariants(proxy).keys()]
    expect(keys.some((key) => key.startsWith('main:'))).toBe(false)
    expect(keys.filter((key) => key.startsWith('shadow:'))).toHaveLength(1)
    const caster = mesh(new THREE.MeshStandardMaterial())
    caster.castShadow = true
    expect(keys[0]).toBe([...collectVariants(caster).keys()].find((key) => key.startsWith('shadow:')))
    const root = new THREE.Group()
    root.add(proxy)
    expect(fadeKeepers(root)).toEqual([])
  })
})

describe('shadow depth materials', () => {
  it('flip the side, keep the cut-out texture and follow an explicit shadow side', () => {
    const material = new THREE.MeshStandardMaterial({ alphaTest: 0.5, map: new THREE.Texture() })
    const depth = depthMaterialFor(mesh(material), material)
    expect(depth.side).toBe(THREE.BackSide)
    expect(depth.map).toBe(material.map)
    expect(depth.alphaTest).toBe(0.5)
    material.shadowSide = THREE.FrontSide
    expect(depthMaterialFor(mesh(material), material).side).toBe(THREE.FrontSide)
  })

  it('keep the fields a shared custom depth material locks', () => {
    const custom = new THREE.MeshDepthMaterial()
    Object.defineProperty(custom, 'map', { get: () => null, set: () => {} })
    const caster = new THREE.InstancedMesh(new THREE.BoxGeometry(), textured(), 1)
    caster.customDepthMaterial = custom
    const depth = depthMaterialFor(caster, caster.material as THREE.Material)
    expect(depth.map).toBeNull()
    expect(depth.side).toBe(THREE.BackSide)
  })
})

describe('landmark fade variants', () => {
  it('copy each material see-through with its own shadow side and add the depth-only twin', () => {
    const root = new THREE.Group()
    const solid = textured()
    root.add(mesh(solid))
    const tinted = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), 1)
    tinted.setColorAt(0, new THREE.Color('white'))
    root.add(tinted, mesh(new THREE.ShaderMaterial()))
    const keepers = fadeKeepers(root)
    expect(keepers).toHaveLength(2)
    const faded = keepers[0].material as THREE.MeshStandardMaterial
    expect(faded).not.toBe(solid)
    expect(faded.transparent).toBe(true)
    expect(faded.depthWrite).toBe(false)
    expect(faded.shadowSide).toBe(THREE.FrontSide)
    expect(solid.transparent).toBe(false)
    expect((keepers[1].material as THREE.MeshBasicMaterial).colorWrite).toBe(false)
  })
})

describe('warm-up plan', () => {
  it('rehearses the scene, the views and the fades without touching the live scene', () => {
    const input = sources()
    const children = input.scene.children.length
    const steps = planWarmup(input)
    let step = steps.next()
    while (!step.done) step = steps.next()
    const plan = step.value
    expect(input.scene.children.length).toBe(children)
    const keys = [...plan.variants.keys()]
    expect(keys.some((key) => key.startsWith('main:MeshStandardMaterial/0'))).toBe(true)
    expect(keys.some((key) => key.includes('/blend/'))).toBe(true)
    expect(keys.some((key) => key.startsWith('main:SpriteMaterial'))).toBe(true)
    expect(keys.some((key) => key.startsWith('shadow:'))).toBe(true)
    plan.dispose()
  })

  it('compiles every planned variant once, uploads the textures and stops when cancelled', async () => {
    const compiled: THREE.Object3D[] = []
    const passes: string[] = []
    const uploaded: THREE.Texture[] = []
    const stage: WarmStage = {
      precompile(root, pass) {
        root.traverse((object) => compiled.push(object))
        passes.push(pass)
      },
      settleProgram: () => 'none',
      preload: (texture) => uploaded.push(texture),
      holdUpload: () => false,
    }
    const warmer = createWarmer(stage, pacing())
    const planned = planSize(sources())
    expect(await warmer.warm(sources())).toBe(true)
    expect(compiled).toHaveLength(planned)
    expect(passes).toContain('shadow')
    const textures = [new THREE.Texture(), new THREE.Texture()]
    expect(await warmer.preload(textures)).toBe(true)
    expect(uploaded).toEqual(textures)
    compiled.length = 0
    expect(await warmer.warm(sources(), () => true)).toBe(false)
    expect(compiled).toHaveLength(0)
  })

  it('gives the main thread back between slices while nobody is waiting', async () => {
    const log: string[] = []
    const stage: WarmStage = {
      precompile: () => log.push('compile'),
      settleProgram: () => 'none',
      preload: () => log.push('upload'),
      holdUpload: () => false,
    }
    const ticker = setInterval(() => log.push('tick'), 0)
    const warmer = createWarmer(stage, pacing({ budget: 0 }))
    expect(await warmer.warm(sources())).toBe(true)
    expect(await warmer.preload([new THREE.Texture(), new THREE.Texture()])).toBe(true)
    clearInterval(ticker)
    const compiles = log.flatMap((entry, at) => (entry === 'compile' ? [at] : []))
    expect(log.slice(compiles[0], compiles[compiles.length - 1])).toContain('tick')
    expect(log.slice(log.indexOf('upload'), log.lastIndexOf('upload'))).toContain('tick')
  })

  it('does everything in one go while the player is waiting, except for programs still linking', async () => {
    const log: string[] = []
    const queue: ProgramSettle[] = ['linking', 'linking', 'settled', 'linking', 'settled', 'none']
    const stage: WarmStage = {
      precompile: () => log.push('compile'),
      settleProgram: () => {
        const state = queue.shift() ?? 'none'
        log.push(state)
        return state
      },
      preload: () => log.push('upload'),
      holdUpload: () => false,
    }
    const ticker = setInterval(() => log.push('tick'), 0)
    const warmer = createWarmer(stage, pacing({ budget: 0, poll: 5, hurry: () => true }))
    expect(await warmer.warm(sources())).toBe(true)
    clearInterval(ticker)
    const settling = log.indexOf('linking')
    expect(log.slice(0, settling)).not.toContain('tick')
    expect(log.slice(settling).filter((entry) => entry !== 'tick')).toEqual(['linking', 'linking', 'settled', 'linking', 'settled', 'none'])
    expect(log.slice(settling)).toContain('tick')
  })

  it('holds the next texture back until the GPU has taken the earlier uploads, unless the player is waiting', async () => {
    const log: string[] = []
    let pending = 0
    const stage: WarmStage = {
      precompile: () => {},
      settleProgram: () => 'none',
      preload: (texture) => {
        log.push(`upload ${texture.name}`)
        if (texture.name === 'b') pending = 3
      },
      holdUpload: (texture) => {
        if (pending === 0) return false
        pending -= 1
        log.push(`hold ${texture.name}`)
        return true
      },
    }
    const textures = ['a', 'b', 'c'].map((name) => Object.assign(new THREE.Texture(), { name }))
    const ticker = setInterval(() => log.push('tick'), 0)
    expect(await createWarmer(stage, pacing({ poll: 5 })).preload(textures)).toBe(true)
    clearInterval(ticker)
    expect(log.filter((entry) => entry !== 'tick')).toEqual(['upload a', 'upload b', 'hold c', 'hold c', 'hold c', 'upload c'])
    expect(log.slice(log.indexOf('hold c'), log.indexOf('upload c'))).toContain('tick')
    log.length = 0
    expect(await createWarmer(stage, pacing({ poll: 5, hurry: () => true })).preload(textures)).toBe(true)
    expect(log).toEqual(['upload a', 'upload b', 'upload c'])
  })

  it('works on the rest while the GPU takes the earlier uploads, even while the player waits', async () => {
    const log: string[] = []
    let pending = 0
    const stage: WarmStage = {
      precompile: () => {},
      settleProgram: () => 'none',
      preload: (texture) => {
        log.push(`upload ${texture.name}`)
        if (texture.name === 'b') pending = 2
      },
      holdUpload: (texture) => {
        if (pending === 0) return false
        pending -= 1
        log.push(`hold ${texture.name}`)
        return true
      },
    }
    function* build(): Steps<string> {
      for (let piece = 1; piece <= 3; piece++) {
        log.push(`build ${piece}`)
        yield
      }
      return 'built'
    }
    const textures = ['a', 'b', 'c'].map((name) => Object.assign(new THREE.Texture(), { name }))
    expect(await createWarmer(stage, pacing({ poll: 5, hurry: () => true })).preloadAlongside(textures, build())).toBe('built')
    expect(log.slice(0, 4)).toEqual(['upload a', 'upload b', 'hold c', 'build 1'])
    expect(log.filter((entry) => entry.startsWith('build'))).toEqual(['build 1', 'build 2', 'build 3'])
    expect(log.filter((entry) => entry === 'hold c')).toHaveLength(2)
    expect(log.at(-1)).toBe('upload c')
    pending = 0
    log.length = 0
    expect(await createWarmer(stage, pacing()).preloadAlongside(textures, build(), () => log.length > 1)).toBeNull()
    expect(log).toEqual(['upload a', 'upload b'])
  })
})

describe('capturing the scene step by step', () => {
  it('looks again only at what changed since the last time', () => {
    const material = new THREE.MeshStandardMaterial()
    let looks = 0
    material.customProgramCacheKey = () => {
      looks += 1
      return 'counted'
    }
    const root = new THREE.Group()
    const box = mesh(material)
    root.add(box)
    const { variants, capture } = createCapture()
    capture(root)
    const first = looks
    const keys = [...variants.keys()]
    expect(first).toBeGreaterThan(0)
    capture(root)
    expect(looks).toBe(first)
    expect([...variants.keys()]).toEqual(keys)
    box.castShadow = true
    capture(root)
    expect([...variants.keys()].some((key) => key.startsWith('shadow:'))).toBe(true)
    material.transparent = true
    material.needsUpdate = true
    capture(root)
    expect([...variants.keys()].some((key) => key.startsWith('main:') && key.includes('/blend/'))).toBe(true)
    const swapped = mesh(new THREE.MeshBasicMaterial())
    root.add(swapped)
    capture(root)
    expect([...variants.keys()].some((key) => key.startsWith('main:MeshBasicMaterial'))).toBe(true)
  })

  it('leaves nothing behind when a rehearsal is stopped half way', () => {
    const input = sources()
    const scene = new THREE.Group() as unknown as THREE.Scene
    const steps = rehearse(input.level, input.tuning, input.models, scene, () => {})
    steps.next()
    steps.next()
    expect(scene.children.length).toBeGreaterThan(0)
    steps.return()
    expect(scene.children).toHaveLength(0)
  })
})
