import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  animateRig,
  createModelLibrary,
  hingeAxis,
  loadModels,
  nodeMap,
  prepareOverlay,
  rigOf,
  rotateFromRest,
  socketWorld,
  type ModelLibrary,
} from './model-library'

function node(name: string, parent: THREE.Object3D, primitives = 1): THREE.Object3D {
  const make = () => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
  const object = primitives > 1 ? new THREE.Group() : make()
  object.name = name
  object.userData.name = name
  if (primitives > 1) {
    for (let i = 1; i <= primitives; i++) {
      const child = make()
      child.name = `${name}_${i}`
      object.add(child)
    }
  }
  parent.add(object)
  return object
}

function robot() {
  const root = new THREE.Group()
  root.userData.name = 'root'
  const body = node('body', root, 3)
  const claw = node('arm_claw', body, 2)
  claw.position.z = -0.3
  node('arm_claw_lower', claw, 2)
  const short = node('arm_short', body)
  short.position.z = 0.3
  node('glass_arm_short', short)
  node('leg_l', root, 2)
  node('leg_r', root, 2)
  return root
}

function named(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name
  mesh.userData.name = name
  parent.add(mesh)
  return mesh
}

function paint(name: string, emissive = '#000000'): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ emissive })
  material.name = name
  return material
}

function library(scene: THREE.Object3D): Promise<ModelLibrary> {
  return loadModels(['grunt'], async () => scene)
}

function expectQuaternion(actual: THREE.Quaternion, expected: THREE.Quaternion): void {
  expect(Math.abs(actual.dot(expected))).toBeCloseTo(1, 6)
}

describe('model library', () => {
  it('maps only glTF nodes, not the primitives of multi-material parts', () => {
    const nodes = nodeMap(robot())
    expect([...nodes.keys()].sort()).toEqual(
      ['arm_claw', 'arm_claw_lower', 'arm_short', 'body', 'glass_arm_short', 'leg_l', 'leg_r', 'root'].sort(),
    )
  })

  it('rigs one limb per arm and leg, with the lower part attached', () => {
    const rig = rigOf(nodeMap(robot()), { attack: 'arm_claw' })
    expect(rig.arms.map((arm) => arm.upper.name).sort()).toEqual(['arm_claw', 'arm_short'])
    expect(rig.legs).toHaveLength(2)
    expect(rig.attack?.upper.name).toBe('arm_claw')
    expect(rig.attack?.lower?.name).toBe('arm_claw_lower')
  })

  it('swings the attack arm back during the windup', () => {
    const rig = rigOf(nodeMap(robot()), { attack: 'arm_claw' })
    animateRig(rig, 0.016, false, 6, 0.8)
    expect(rig.attack?.upper.rotation.z).toBeCloseTo(1)
  })

  it('copies a material shared by several meshes only once per instance', async () => {
    const root = new THREE.Group()
    const steel = paint('mat_steel')
    named('a', new THREE.BoxGeometry(), steel, root)
    named('b', new THREE.BoxGeometry(), steel, root)
    const models = await library(root)
    const first = models.instance('grunt')
    const second = models.instance('grunt')
    expect(first.materials).toHaveLength(1)
    const [copy] = first.materials
    expect(copy).not.toBe(steel)
    expect((first.nodes.get('a') as THREE.Mesh).material).toBe(copy)
    expect((first.nodes.get('b') as THREE.Mesh).material).toBe(copy)
    expect(second.materials[0]).not.toBe(copy)
    expect(first.tintable).toEqual([copy])
  })

  it('indexes glowing materials by name and keeps them out of the tint list', async () => {
    const root = new THREE.Group()
    named('shell', new THREE.BoxGeometry(), paint('mat_body'), root)
    named('lamp', new THREE.BoxGeometry(), paint('mat_glow', '#ff3b30'), root)
    named('eye', new THREE.BoxGeometry(), paint('mat_eye', '#ffb02e'), root)
    const model = (await library(root)).instance('grunt')
    expect([...model.glow.keys()].sort()).toEqual(['mat_eye', 'mat_glow'])
    expect(model.glow.get('mat_glow')).toBe((model.nodes.get('lamp') as THREE.Mesh).material)
    expect(model.tintable.map((material) => material.name)).toEqual(['mat_body'])
    for (const material of model.glow.values()) expect(model.tintable).not.toContain(material)
    expect(model.materials).toHaveLength(3)
  })

  it('disposes only the materials an instance copied', async () => {
    const root = new THREE.Group()
    const steel = paint('mat_steel')
    named('a', new THREE.BoxGeometry(), steel, root)
    const source = vi.fn()
    steel.addEventListener('dispose', source)
    const model = (await library(root)).instance('grunt')
    const copy = vi.fn()
    model.materials[0].addEventListener('dispose', copy)
    model.dispose()
    expect(copy).toHaveBeenCalledTimes(1)
    expect(source).not.toHaveBeenCalled()
  })

  it('shares the source materials in shared() and never disposes them', async () => {
    const root = new THREE.Group()
    const brass = paint('mat_brass')
    named('crown', new THREE.BoxGeometry(), brass, root)
    const disposed = vi.fn()
    brass.addEventListener('dispose', disposed)
    const models = await library(root)
    const first = models.shared('grunt')
    const second = models.shared('grunt')
    expect(first.root).not.toBe(second.root)
    expect((first.nodes.get('crown') as THREE.Mesh).material).toBe(brass)
    expect((second.nodes.get('crown') as THREE.Mesh).material).toBe(brass)
    expect(first.materials).toEqual([brass])
    expect(first.tintable).toEqual([])
    expect(first.glow.size).toBe(0)
    first.dispose()
    expect(disposed).not.toHaveBeenCalled()
  })

  it('clones instances from untouched materials even after shared or baked materials were edited', async () => {
    const root = new THREE.Group()
    named('shell', new THREE.BoxGeometry(), paint('mat_body'), root)
    named('lamp', new THREE.BoxGeometry(), paint('mat_glow', '#ff3b30'), root)
    const models = await library(root)
    for (const material of models.shared('grunt').materials) {
      const paintable = material as THREE.MeshStandardMaterial
      paintable.emissive.set('#ffffff')
      paintable.emissiveIntensity = 0.5
      paintable.transparent = true
      paintable.opacity = 0.2
    }
    for (const part of models.parts('grunt')) (part.material as THREE.MeshStandardMaterial).color.set('#123456')
    const model = models.instance('grunt')
    expect(model.tintable.map((material) => material.name)).toEqual(['mat_body'])
    expect([...model.glow.keys()]).toEqual(['mat_glow'])
    const [body] = model.tintable
    expect(body.emissive.getHex()).toBe(0)
    expect(body.emissiveIntensity).toBe(1)
    expect(body.transparent).toBe(false)
    expect(body.opacity).toBe(1)
    expect(body.color.getHex()).toBe(0xffffff)
    expect(model.glow.get('mat_glow')?.emissive.getHex()).toBe(0xff3b30)
  })

  it('folds the parts around the given joints into one jointed mesh once and copies its material per instance', async () => {
    const atlas = new THREE.Texture()
    const look = (name: string, roughness: number) => {
      const material = paint(name)
      material.map = atlas
      material.roughness = roughness
      return material
    }
    const root = new THREE.Group()
    const body = new THREE.Group()
    body.userData.name = 'body'
    root.add(body)
    named('shell', new THREE.BoxGeometry(), look('mat_body', 0.6), body)
    named('trim', new THREE.BoxGeometry(), look('mat_trim', 0.4), body)
    const arm = new THREE.Group()
    arm.userData.name = 'arm'
    body.add(arm)
    named('sleeve', new THREE.BoxGeometry(), look('mat_body', 0.6), arm)
    named('cuff', new THREE.BoxGeometry(), look('mat_steel', 0.42), arm)
    const models = await library(root)
    for (const material of models.shared('grunt').materials) (material as THREE.MeshStandardMaterial).emissive.set('#ffffff')
    const first = models.instance('grunt', ['arm'])
    const second = models.instance('grunt', ['arm'])
    const still = (model: { root: THREE.Object3D }) => {
      const found: THREE.Mesh[] = []
      model.root.traverse((object) => {
        if ((object as THREE.Mesh).isMesh && object.userData.still) found.push(object as THREE.Mesh)
      })
      return found
    }
    expect(still(first)).toHaveLength(1)
    expect(still(first)[0].parent).toBe(first.root)
    expect(still(first)[0].userData.rigid).toBe(true)
    expect(first.root.userData.rigid.names).toEqual(['', 'arm'])
    expect(first.nodes.get('arm')).toBeDefined()
    still(first).forEach((mesh, index) => {
      const copy = mesh.material as THREE.MeshStandardMaterial
      expect(mesh.geometry).toBe(still(second)[index].geometry)
      expect(copy).not.toBe(still(second)[index].material)
      expect(copy.roughnessMap?.channel).toBe(1)
      expect(copy.emissive.getHex()).toBe(0)
      expect(first.tintable).toContain(copy)
    })
    expect(first.nodes.has('sleeve')).toBe(false)
    expect((models.instance('grunt').nodes.get('sleeve') as THREE.Mesh).visible).toBe(true)
  })

  it('bakes node transforms into one merged geometry per material and caches it', async () => {
    const root = new THREE.Group()
    const wood = paint('mat_wood')
    const iron = paint('mat_iron')
    const lid = new THREE.Group()
    lid.position.set(0, 1, 0)
    root.add(lid)
    named('box', new THREE.BoxGeometry(1, 1, 1), wood, root)
    named('lid', new THREE.BoxGeometry(1, 0.2, 1), wood, lid).position.set(2, 0, 0)
    named('band', new THREE.BoxGeometry(0.1, 0.1, 0.1).toNonIndexed(), iron, root)
    const models = await library(root)
    const parts = models.parts('grunt')
    expect(parts.map((part) => part.material)).toEqual([wood, iron])
    const box = new THREE.Box3().setFromBufferAttribute(parts[0].geometry.getAttribute('position') as THREE.BufferAttribute)
    expect(box.min.toArray()).toEqual([-0.5, -0.5, -0.5])
    expect(box.max.x).toBeCloseTo(2.5)
    expect(box.max.y).toBeCloseTo(1.1)
    expect(models.parts('grunt')).toBe(parts)
  })

  it('atlases multi-material parts sharing one base texture during parts() bake', async () => {
    const atlas = new THREE.Texture()
    const look = (name: string, roughness: number) => {
      const material = paint(name)
      material.map = atlas
      material.roughness = roughness
      return material
    }
    const root = new THREE.Group()
    named('wood', new THREE.BoxGeometry(1, 1, 1), look('mat_wood', 0.8), root)
    named('iron', new THREE.BoxGeometry(0.5, 0.5, 0.5), look('mat_iron', 0.35), root)
    const models = await library(root)
    const parts = models.parts('grunt')
    expect(parts).toHaveLength(1)
    expect((parts[0].material as THREE.MeshStandardMaterial).roughnessMap?.channel).toBe(1)
  })

  it('keeps decals, glass, tiny bolts and small glowing parts out of the shadow pass', async () => {
    const root = new THREE.Group()
    const decal = paint('mat_emblem')
    decal.alphaTest = 0.5
    const glass = paint('mat_glass')
    glass.transparent = true
    named('body', new THREE.BoxGeometry(0.6, 0.9, 0.5), paint('mat_body'), root)
    named('emblem', new THREE.PlaneGeometry(0.3, 0.3), decal, root)
    named('canopy', new THREE.BoxGeometry(0.5, 0.4, 0.5), glass, root)
    named('bolt', new THREE.BoxGeometry(0.05, 0.05, 0.02), paint('mat_steel'), root)
    named('lamp', new THREE.BoxGeometry(0.15, 0.12, 0.1), paint('mat_lamp', '#ff3b30'), root)
    named('core', new THREE.BoxGeometry(0.5, 0.4, 0.3), paint('mat_glow', '#7fd4ff'), root)
    const arm = new THREE.Group()
    arm.scale.setScalar(4)
    root.add(arm)
    named('rivet', new THREE.BoxGeometry(0.04, 0.04, 0.04), paint('mat_dark'), arm)
    const models = await library(root)
    const casting = (model: { nodes: Map<string, THREE.Object3D> }) =>
      ['body', 'emblem', 'canopy', 'bolt', 'lamp', 'core', 'rivet'].filter((name) => (model.nodes.get(name) as THREE.Mesh).castShadow)
    expect(casting(models.instance('grunt'))).toEqual(['body', 'core', 'rivet'])
    expect(casting(models.shared('grunt'))).toEqual(['body', 'core', 'rivet'])
  })

  it('scales the small-part limit down for small models', async () => {
    const root = new THREE.Group()
    named('shell', new THREE.BoxGeometry(0.2, 0.1, 0.1), paint('mat_body'), root)
    named('band', new THREE.BoxGeometry(0.02, 0.06, 0.06), paint('mat_brass'), root)
    named('pin', new THREE.BoxGeometry(0.01, 0.03, 0.01), paint('mat_steel'), root)
    const model = (await library(root)).instance('grunt')
    expect((model.nodes.get('shell') as THREE.Mesh).castShadow).toBe(true)
    expect((model.nodes.get('band') as THREE.Mesh).castShadow).toBe(true)
    expect((model.nodes.get('pin') as THREE.Mesh).castShadow).toBe(false)
  })

  it('reports the bounds of the source model', async () => {
    const root = new THREE.Group()
    named('barrel', new THREE.BoxGeometry(0.6, 0.1, 0.2), paint('mat_dark'), root).position.set(0.2, 0.05, 0)
    const models = await library(root)
    const box = models.bounds('grunt')
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    expect(center.x).toBeCloseTo(0.2)
    expect(center.y).toBeCloseTo(0.05)
    expect(size.x).toBeCloseTo(0.6)
    expect(size.z).toBeCloseTo(0.2)
    box.min.set(9, 9, 9)
    expect(models.bounds('grunt').min.x).toBeCloseTo(-0.1)
  })

  it('loads each model once, lists what loaded and skips models that fail', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const source = vi.fn(async () => robot())
    const models = await loadModels(['grunt'], source)
    await models.ensure(['grunt'])
    expect(source).toHaveBeenCalledTimes(1)
    expect(models.ids()).toEqual(['grunt'])
    const broken = await loadModels(['grunt'], async () => {
      throw new Error('404')
    })
    expect(broken.has('grunt')).toBe(false)
    expect(broken.ids()).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('unloads the models it is not asked to keep, with their caches, geometry, materials and textures', async () => {
    const scenes = new Map<string, THREE.Object3D>()
    const source = vi.fn(async (id: string) => {
      const scene = robot()
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh
        if (mesh.isMesh) (mesh.material as THREE.MeshStandardMaterial).map = new THREE.Texture()
      })
      scenes.set(id, scene)
      return scene
    })
    const models = await loadModels(['grunt', 'gunner'], source)
    const grunt = scenes.get('grunt') as THREE.Object3D
    const disposed = new Set<unknown>()
    const watch = (item: THREE.EventDispatcher<{ dispose: object }>) => item.addEventListener('dispose', () => disposed.add(item))
    const textures = models.textures(['grunt'])
    expect(textures.length).toBeGreaterThan(0)
    expect(models.textures().length).toBeGreaterThan(textures.length)
    for (const texture of textures) watch(texture)
    grunt.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      watch(mesh.geometry)
      watch(mesh.material as THREE.Material)
    })
    const parts = models.parts('grunt')
    for (const part of parts) watch(part.geometry)
    const merged = models.instance('grunt', ['arm_claw'])
    merged.dispose()
    expect(models.keep(['gunner'])).toEqual(['grunt'])
    expect(models.ids()).toEqual(['gunner'])
    expect(models.has('grunt')).toBe(false)
    for (const texture of textures) expect(disposed.has(texture)).toBe(true)
    for (const part of parts) expect(disposed.has(part.geometry)).toBe(true)
    grunt.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      expect(disposed.has(mesh.geometry)).toBe(true)
      expect(disposed.has(mesh.material)).toBe(true)
    })
    await models.ensure(['grunt'])
    expect(source).toHaveBeenCalledTimes(3)
    expect(models.parts('grunt')).not.toBe(parts)
    expect(() => models.instance('grunt', ['arm_claw']).dispose()).not.toThrow()
  })

  it('drops a model that finishes loading after it stopped being wanted', async () => {
    let finish: (scene: THREE.Object3D) => void = () => {}
    const late = robot()
    const models = createModelLibrary(() => new Promise((resolve) => (finish = resolve)))
    const pending = models.ensure(['grunt'])
    expect(models.keep([])).toEqual(['grunt'])
    const disposed = vi.fn()
    late.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (mesh.isMesh) mesh.geometry.addEventListener('dispose', disposed)
    })
    finish(late)
    await pending
    expect(models.has('grunt')).toBe(false)
    expect(disposed).toHaveBeenCalled()
  })

  it('keeps held arms still while walking', () => {
    const nodes = nodeMap(robot())
    const rig = rigOf(nodes, { held: ['arm_short'] })
    for (let i = 0; i < 20; i++) animateRig(rig, 0.05, true, 12, 0)
    const held = nodes.get('arm_short') as THREE.Object3D
    const free = nodes.get('arm_claw') as THREE.Object3D
    expect(held.quaternion.equals(new THREE.Quaternion())).toBe(true)
    expect(Math.abs(free.rotation.z)).toBeGreaterThan(0.05)
    expect(rig.arms.find((arm) => arm.upper === held)?.held).toBe(true)
  })

  it('layers the animation on top of a joint rest rotation', () => {
    const nodes = nodeMap(robot())
    const claw = nodes.get('arm_claw') as THREE.Object3D
    claw.rotation.set(0.4, 0.3, 0.2)
    const rest = claw.quaternion.clone()
    const rig = rigOf(nodes, { attack: 'arm_claw' })
    animateRig(rig, 0.016, false, 6, 0.8)
    const expected = rest.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1))
    expectQuaternion(claw.quaternion, expected)
    animateRig(rig, 0.016, false, 6, 0)
    expectQuaternion(claw.quaternion, rest)
  })

  it('raises whichever arm the pose table names as the attack arm', () => {
    const nodes = nodeMap(robot())
    const rig = rigOf(nodes, { attack: 'arm_short', held: ['arm_short'] })
    animateRig(rig, 0.016, false, 6, 0.5)
    expect(nodes.get('arm_short')?.rotation.z).toBeCloseTo(0.625)
    expect(nodes.get('arm_claw')?.rotation.z).toBeCloseTo(0)
    animateRig(rig, 0.016, false, 6, 0)
    expect(nodes.get('arm_short')?.rotation.z).toBeCloseTo(0)
  })

  it('freezes the stride when dt is zero', () => {
    const rig = rigOf(nodeMap(robot()))
    for (let i = 0; i < 10; i++) animateRig(rig, 0.05, true, 12, 0)
    const phase = rig.phase
    const stride = rig.stride
    animateRig(rig, 0, false, 12, 0)
    expect(rig.phase).toBe(phase)
    expect(rig.stride).toBe(stride)
  })

  it('reads socket positions after the parent moved', () => {
    const root = new THREE.Group()
    const arm = new THREE.Group()
    const muzzle = new THREE.Object3D()
    arm.position.set(0, 1, 0)
    muzzle.position.set(0.5, 0, 0)
    root.add(arm)
    arm.add(muzzle)
    const out = new THREE.Vector3()
    expect(socketWorld(muzzle, out)).toBe(out)
    expect(out.x).toBeCloseTo(0.5)
    expect(out.y).toBeCloseTo(1)
    root.position.set(3, 0, 2)
    arm.rotation.y = Math.PI / 2
    socketWorld(muzzle, out)
    expect(out.x).toBeCloseTo(3)
    expect(out.y).toBeCloseTo(1)
    expect(out.z).toBeCloseTo(1.5)
  })

  it('opens petals outward from the barrel axis', () => {
    const barrel = new THREE.Group()
    const cases: [THREE.Vector3, THREE.Euler][] = [
      [new THREE.Vector3(0.1, 0.08, 0), new THREE.Euler()],
      [new THREE.Vector3(0.1, 0, -0.08), new THREE.Euler()],
      [new THREE.Vector3(0.1, -0.06, 0.06), new THREE.Euler(0.9, 0, 0)],
    ]
    for (const [position, rotation] of cases) {
      const petal = new THREE.Object3D()
      petal.position.copy(position)
      petal.rotation.copy(rotation)
      barrel.add(petal)
      const tip = new THREE.Vector3(0.2, 0, 0)
      petal.updateMatrix()
      const closed = tip.clone().applyMatrix4(petal.matrix)
      rotateFromRest(petal, hingeAxis(petal), 0.8)
      petal.updateMatrix()
      const open = tip.clone().applyMatrix4(petal.matrix)
      const radial = new THREE.Vector2(position.y, position.z).normalize()
      const before = new THREE.Vector2(closed.y, closed.z).dot(radial)
      const after = new THREE.Vector2(open.y, open.z).dot(radial)
      expect(after).toBeGreaterThan(before + 0.05)
      expect(open.distanceTo(petal.position)).toBeCloseTo(0.2)
    }
  })

  it('prepares overlay parts for the transparent queue', () => {
    const root = new THREE.Group()
    const material = paint('mat_body')
    const mesh = named('body', new THREE.BoxGeometry(), material, root)
    prepareOverlay(root, 11)
    expect(root.renderOrder).toBe(11)
    expect(mesh.renderOrder).toBe(11)
    expect(material.transparent).toBe(true)
  })
})
