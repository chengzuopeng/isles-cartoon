import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { ModelId } from './asset-urls'
import { atlasGroups } from './node-parts'
import { bindRigid, mergeRigid } from './rigid-parts'

export interface ModelInstance {
  root: THREE.Object3D
  nodes: Map<string, THREE.Object3D>
  tintable: THREE.MeshStandardMaterial[]
  materials: THREE.Material[]
  glow: Map<string, THREE.MeshStandardMaterial>
  dispose(): void
}

export interface ModelPart {
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

export interface ModelLibrary {
  has(id: string): id is ModelId
  instance(id: ModelId, joints?: readonly string[]): ModelInstance
  shared(id: ModelId): ModelInstance
  parts(id: ModelId): readonly ModelPart[]
  bounds(id: ModelId): THREE.Box3
  ids(): ModelId[]
  ensure(ids: readonly ModelId[]): Promise<void>
  keep(ids: readonly ModelId[]): ModelId[]
  textures(ids?: readonly ModelId[]): THREE.Texture[]
}

export type ModelSource = (id: ModelId) => Promise<THREE.Object3D>

export interface Limb {
  upper: THREE.Object3D
  lower: THREE.Object3D | null
  side: number
  held: boolean
}

export interface Rig {
  legs: Limb[]
  arms: Limb[]
  attack: Limb | null
  stride: number
  phase: number
}

export interface RigOptions {
  attack?: string
  held?: readonly string[]
}

export const SHADOW_RULES = {
  smallPart: 0.1,
  smallShare: 0.25,
  glowPart: 0.3,
  materials: /^mat_(decal|emblem|face|badge|glass)/,
} as const

const X_AXIS = new THREE.Vector3(1, 0, 0)
const Z_AXIS = new THREE.Vector3(0, 0, 1)
const ORIGIN = new THREE.Vector3()
const rests = new WeakMap<THREE.Object3D, THREE.Quaternion>()
const turn = new THREE.Quaternion()
const partBox = new THREE.Box3()
const partSize = new THREE.Vector3()

function missing(id: ModelId): never {
  throw new Error(`model ${id} is not loaded`)
}

export const EMPTY_LIBRARY: ModelLibrary = {
  has: (_id: string): _id is ModelId => false,
  instance: missing,
  shared: missing,
  parts: missing,
  bounds: missing,
  ids: () => [],
  ensure: async () => {},
  keep: () => [],
  textures: () => [],
}

export async function loadModels(ids: readonly ModelId[], source: ModelSource): Promise<ModelLibrary> {
  const library = createModelLibrary(source)
  await library.ensure(ids)
  return library
}

export function createModelLibrary(source: ModelSource): ModelLibrary {
  const loaded = new Map<ModelId, THREE.Object3D>()
  const pending = new Map<ModelId, Promise<void>>()
  const partCache = new Map<ModelId, ModelPart[]>()
  const partOwned = new Map<ModelId, { dispose(): void }[]>()
  const boundCache = new Map<ModelId, THREE.Box3>()
  const jointCache = new Map<string, THREE.Object3D>()
  const pristine = new Map<THREE.Material, THREE.Material>()

  function sourceOf(id: ModelId): THREE.Object3D {
    return loaded.get(id) ?? missing(id)
  }

  function freshCopy(material: THREE.Material): THREE.Material {
    return (pristine.get(material) ?? material).clone()
  }

  function jointed(id: ModelId, joints: readonly string[]): THREE.Object3D {
    const key = `${id}|${joints.join(',')}`
    let template = jointCache.get(key)
    if (!template) {
      template = sourceOf(id).clone(true)
      eachMaterial(template, (material) => pristine.get(material) ?? material)
      mergeRigid(template, joints)
      jointCache.set(key, template)
    }
    return template
  }

  function load(id: ModelId): Promise<void> {
    let task = pending.get(id)
    if (!task) {
      const current: Promise<void> = source(id).then(
        (scene) => {
          if (pending.get(id) !== current) {
            release(scene)
            return
          }
          scene.updateMatrixWorld(true)
          const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3())
          const modelSize = Math.max(size.x, size.y, size.z)
          scene.traverse((object) => {
            const mesh = object as THREE.Mesh
            if (!mesh.isMesh) return
            mesh.castShadow = castsShadow(mesh, modelSize)
            for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
              if (!pristine.has(material)) pristine.set(material, material.clone())
            }
          })
          loaded.set(id, scene)
        },
        (error) => {
          console.warn(`model ${id} failed to load, falling back to primitives`, error)
        },
      )
      task = current
      pending.set(id, task)
    }
    return task
  }

  function release(root: THREE.Object3D): void {
    root.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.geometry.dispose()
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const copy = pristine.get(material)
        if (copy) {
          pristine.delete(material)
          copy.dispose()
        }
        for (const texture of texturesOf(material)) {
          texture.dispose()
          closeImage(texture)
        }
        material.dispose()
      }
    })
  }

  function unload(id: ModelId): void {
    const scene = loaded.get(id)
    loaded.delete(id)
    pending.delete(id)
    boundCache.delete(id)
    for (const part of partCache.get(id) ?? []) part.geometry.dispose()
    partCache.delete(id)
    for (const item of partOwned.get(id) ?? []) item.dispose()
    partOwned.delete(id)
    for (const [key, template] of jointCache) {
      if (!key.startsWith(`${id}|`)) continue
      jointCache.delete(key)
      release(template)
    }
    if (scene) release(scene)
  }

  return {
    has: (id: string): id is ModelId => loaded.has(id as ModelId),
    instance(id, joints) {
      if (!joints) return ownedCopy(sourceOf(id), freshCopy)
      const model = ownedCopy(jointed(id, joints), freshCopy)
      bindRigid(model)
      return model
    },
    shared: (id) => sharedCopy(sourceOf(id)),
    parts(id) {
      let parts = partCache.get(id)
      if (!parts) {
        const baked = bakeParts(sourceOf(id))
        parts = baked.parts
        partCache.set(id, parts)
        if (baked.owned.length > 0) partOwned.set(id, baked.owned)
      }
      return parts
    },
    bounds(id) {
      let box = boundCache.get(id)
      if (!box) {
        const scene = sourceOf(id)
        scene.updateWorldMatrix(true, true)
        box = new THREE.Box3().setFromObject(scene)
        boundCache.set(id, box)
      }
      return box.clone()
    },
    ids: () => [...loaded.keys()].sort(),
    async ensure(ids) {
      await Promise.all(ids.map(load))
    },
    keep(ids) {
      const wanted = new Set<ModelId>(ids)
      const dropped = [...new Set([...loaded.keys(), ...pending.keys()])].filter((id) => !wanted.has(id))
      for (const id of dropped) unload(id)
      return dropped.sort()
    },
    textures(ids = [...loaded.keys()]) {
      const found = new Set<THREE.Texture>()
      for (const id of ids) {
        loaded.get(id)?.traverse((object) => {
          const mesh = object as THREE.Mesh
          if (!mesh.isMesh) return
          for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            for (const texture of texturesOf(material)) found.add(texture)
          }
        })
      }
      return [...found]
    },
  }
}

export function texturesOf(material: THREE.Material): THREE.Texture[] {
  const found: THREE.Texture[] = []
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture && !found.includes(value)) found.push(value)
  }
  return found
}

function closeImage(texture: THREE.Texture): void {
  const image: unknown = texture.image
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close()
}

export function castsShadow(mesh: THREE.Mesh, modelSize: number): boolean {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  if (materials.some((material) => material.transparent || material.alphaTest > 0 || SHADOW_RULES.materials.test(material.name))) return false
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
  partBox.copy(mesh.geometry.boundingBox as THREE.Box3).applyMatrix4(mesh.matrixWorld).getSize(partSize)
  const largest = Math.max(partSize.x, partSize.y, partSize.z)
  if (largest < Math.min(SHADOW_RULES.smallPart, modelSize * SHADOW_RULES.smallShare)) return false
  return largest >= SHADOW_RULES.glowPart || !materials.every(glows)
}

function glows(material: THREE.Material): boolean {
  return material instanceof THREE.MeshStandardMaterial && material.emissive.getHex() !== 0
}

function eachMaterial(root: THREE.Object3D, adopt: (material: THREE.Material) => THREE.Material): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(adopt) : adopt(mesh.material)
  })
}

function ownedCopy(source: THREE.Object3D, copyMaterial: (material: THREE.Material) => THREE.Material): ModelInstance {
  const root = source.clone(true)
  const copies = new Map<THREE.Material, THREE.Material>()
  const materials: THREE.Material[] = []
  const tintable: THREE.MeshStandardMaterial[] = []
  const glow = new Map<string, THREE.MeshStandardMaterial>()
  eachMaterial(root, (material) => {
    const known = copies.get(material)
    if (known) return known
    const copy = copyMaterial(material)
    copies.set(material, copy)
    materials.push(copy)
    if (copy instanceof THREE.MeshStandardMaterial) {
      if (copy.emissive.getHex() === 0) tintable.push(copy)
      else if (copy.name && !glow.has(copy.name)) glow.set(copy.name, copy)
    }
    return copy
  })
  return {
    root,
    nodes: nodeMap(root),
    tintable,
    materials,
    glow,
    dispose() {
      for (const material of materials) material.dispose()
    },
  }
}

function sharedCopy(source: THREE.Object3D): ModelInstance {
  const root = source.clone(true)
  const materials: THREE.Material[] = []
  eachMaterial(root, (material) => {
    if (!materials.includes(material)) materials.push(material)
    return material
  })
  return { root, nodes: nodeMap(root), tintable: [], materials, glow: new Map(), dispose: () => {} }
}

function bakeParts(source: THREE.Object3D): { parts: ModelPart[]; owned: { dispose(): void }[] } {
  source.updateWorldMatrix(true, true)
  const inverse = source.matrixWorld.clone().invert()
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>()
  source.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || Array.isArray(mesh.material)) return
    const geometry = floatCopy(mesh.geometry)
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld))
    const list = groups.get(mesh.material)
    if (list) list.push(geometry)
    else groups.set(mesh.material, [geometry])
  })
  const raw: ModelPart[] = []
  for (const [material, list] of groups) {
    for (const geometry of mergeAll(list)) raw.push({ geometry, material })
  }
  const grouped = atlasGroups(raw)
  const kept = new Set(grouped.parts.map((part) => part.geometry))
  for (const part of raw) {
    if (!kept.has(part.geometry)) part.geometry.dispose()
  }
  return grouped
}

function floatCopy(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  for (const [name, attribute] of Object.entries(source.attributes)) {
    const { count, itemSize } = attribute
    const array = new Float32Array(count * itemSize)
    for (let i = 0; i < count; i++) for (let c = 0; c < itemSize; c++) array[i * itemSize + c] = attribute.getComponent(i, c)
    geometry.setAttribute(name, new THREE.BufferAttribute(array, itemSize))
  }
  if (source.index) geometry.setIndex(source.index.clone())
  return geometry
}

function mergeAll(list: THREE.BufferGeometry[]): THREE.BufferGeometry[] {
  if (list.length === 1) return list
  const indexed = list.every((geometry) => geometry.index !== null)
  const prepared = indexed ? list : list.map((geometry) => (geometry.index ? geometry.toNonIndexed() : geometry))
  const names = Object.keys(prepared[0].attributes).filter((name) => prepared.every((geometry) => name in geometry.attributes))
  for (const geometry of prepared) {
    for (const name of Object.keys(geometry.attributes)) if (!names.includes(name)) geometry.deleteAttribute(name)
  }
  const merged = mergeGeometries(prepared, false)
  return merged ? [merged] : prepared
}

export function nodeMap(root: THREE.Object3D): Map<string, THREE.Object3D> {
  const nodes = new Map<string, THREE.Object3D>()
  root.traverse((object) => {
    const name = object.userData.name
    if (typeof name === 'string' && name) nodes.set(name, object)
  })
  return nodes
}

export function restQuaternion(node: THREE.Object3D): THREE.Quaternion {
  let rest = rests.get(node)
  if (!rest) {
    rest = node.quaternion.clone()
    rests.set(node, rest)
  }
  return rest
}

export function rotateFromRest(node: THREE.Object3D, axis: THREE.Vector3, angle: number): void {
  node.quaternion.copy(restQuaternion(node)).multiply(turn.setFromAxisAngle(axis, angle))
}

export function socketWorld(node: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
  node.updateWorldMatrix(true, false)
  return out.setFromMatrixPosition(node.matrixWorld)
}

export function hingeAxis(node: THREE.Object3D, center: THREE.Vector3 = ORIGIN): THREE.Vector3 {
  const radial = new THREE.Vector3(0, node.position.y - center.y, node.position.z - center.z)
  if (radial.lengthSq() < 1e-12) radial.set(0, 1, 0)
  const axis = new THREE.Vector3().crossVectors(X_AXIS, radial.normalize())
  return axis.applyQuaternion(restQuaternion(node).clone().invert()).normalize()
}

export function prepareOverlay(root: THREE.Object3D, renderOrder: number): void {
  root.traverse((object) => {
    object.renderOrder = renderOrder
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (material.transparent) continue
      material.transparent = true
      material.needsUpdate = true
    }
  })
}

function limb(nodes: Map<string, THREE.Object3D>, name: string, side: number, held: boolean): Limb | null {
  const upper = nodes.get(name)
  if (!upper) return null
  const lower = nodes.get(`${name}_lower`) ?? null
  restQuaternion(upper)
  if (lower) restQuaternion(lower)
  return { upper, lower, side, held }
}

export function rigOf(nodes: Map<string, THREE.Object3D>, options: RigOptions = {}): Rig {
  const held = new Set(options.held ?? [])
  const legs = [limb(nodes, 'leg_l', 1, false), limb(nodes, 'leg_r', -1, false)].filter((part): part is Limb => part !== null)
  const arms: Limb[] = []
  for (const [name, upper] of nodes) {
    if (!name.startsWith('arm_') || name.endsWith('_lower')) continue
    const side = upper.position.z > 0 ? -1 : 1
    const part = limb(nodes, name, side, held.has(name))
    if (part) arms.push(part)
  }
  const attackNode = options.attack ? nodes.get(options.attack) : undefined
  const attack = attackNode ? (arms.find((arm) => arm.upper === attackNode) ?? null) : null
  return { legs, arms, attack, stride: 0, phase: 0 }
}

function bend(part: Limb, upper: number, lower: number): void {
  rotateFromRest(part.upper, Z_AXIS, upper)
  if (part.lower) rotateFromRest(part.lower, Z_AXIS, lower)
}

export function animateRig(rig: Rig, dt: number, moving: boolean, speed: number, pose: number): void {
  rig.stride += ((moving ? 1 : 0) - rig.stride) * Math.min(1, dt * 8)
  rig.phase += dt * speed
  const swing = Math.sin(rig.phase) * rig.stride
  for (const leg of rig.legs) bend(leg, swing * 0.45 * leg.side, -Math.max(0, -swing * leg.side) * 0.7)
  for (const arm of rig.arms) {
    if (arm === rig.attack && pose > 0) bend(arm, pose * 1.25, pose * 0.6)
    else if (arm.held) bend(arm, 0, 0)
    else bend(arm, -swing * 0.35 * arm.side, Math.max(0, swing * arm.side) * 0.25)
  }
}
