import * as THREE from 'three'
import type { Tuning } from '../data/tuning'
import type { BuiltLevel } from '../sim/level'
import type { World } from '../sim/world'
import type { ModelId } from './asset-urls'
import { createModelLibrary, type ModelLibrary } from './model-library'

interface FileSystem {
  readFileSync(path: URL): Uint8Array
}

interface GltfTextureSlot {
  index: number
  texCoord?: number
}

interface GltfMaterial {
  name?: string
  pbrMetallicRoughness?: {
    baseColorFactor?: number[]
    baseColorTexture?: GltfTextureSlot
    metallicFactor?: number
    roughnessFactor?: number
    metallicRoughnessTexture?: GltfTextureSlot
  }
  normalTexture?: GltfTextureSlot
  occlusionTexture?: GltfTextureSlot
  emissiveTexture?: GltfTextureSlot
  emissiveFactor?: number[]
  alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND'
  alphaCutoff?: number
  doubleSided?: boolean
  extensions?: { KHR_materials_emissive_strength?: { emissiveStrength?: number } }
}

interface GltfPrimitive {
  attributes: Record<string, number>
  material?: number
}

interface GltfNode {
  name?: string
  children?: number[]
  translation?: number[]
  rotation?: number[]
  scale?: number[]
  matrix?: number[]
  mesh?: number
}

interface Gltf {
  nodes: GltfNode[]
  meshes: { name?: string; primitives: GltfPrimitive[] }[]
  materials?: GltfMaterial[]
  textures?: { source?: number; sampler?: number; extensions?: { KHR_texture_basisu?: { source: number } } }[]
  accessors: { min?: number[]; max?: number[] }[]
  scenes: { nodes: number[] }[]
  scene?: number
}

export interface PlayFrame {
  scene: THREE.Scene
  landmarks: THREE.Object3D
  world: World
  level: BuiltLevel
  tuning: Tuning
}

const FS_MODULE = 'node:fs'
const fs = (await import(/* @vite-ignore */ FS_MODULE)) as FileSystem
const ROOT = new URL('../../', import.meta.url)
const MIN_EXTENT = 0.001

function readGlb(id: string): Gltf {
  const bytes = fs.readFileSync(new URL(`public/assets/models/${id}.glb`, ROOT))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + view.getUint32(12, true)))) as Gltf
}

export function glbScene(id: string): THREE.Group {
  const gltf = readGlb(id)
  const textures = new Map<string, THREE.Texture>()
  const texture = (slot: GltfTextureSlot, srgb: boolean) => {
    const entry = gltf.textures?.[slot.index]
    const key = `${entry?.extensions?.KHR_texture_basisu?.source ?? entry?.source ?? slot.index}:${entry?.sampler ?? ''}`
    let found = textures.get(key)
    if (!found) {
      found = new THREE.Texture()
      found.flipY = false
      textures.set(key, found)
    }
    if (slot.texCoord) {
      found = found.clone()
      found.channel = slot.texCoord
    }
    if (srgb) found.colorSpace = THREE.SRGBColorSpace
    return found
  }
  const materials = (gltf.materials ?? []).map((entry) => {
    const material = new THREE.MeshStandardMaterial()
    material.name = entry.name ?? ''
    const pbr = entry.pbrMetallicRoughness ?? {}
    if (pbr.baseColorFactor) {
      material.color.setRGB(pbr.baseColorFactor[0], pbr.baseColorFactor[1], pbr.baseColorFactor[2], THREE.LinearSRGBColorSpace)
      material.opacity = pbr.baseColorFactor[3] ?? 1
    }
    material.metalness = pbr.metallicFactor ?? 1
    material.roughness = pbr.roughnessFactor ?? 1
    if (pbr.baseColorTexture) material.map = texture(pbr.baseColorTexture, true)
    if (pbr.metallicRoughnessTexture) {
      material.metalnessMap = texture(pbr.metallicRoughnessTexture, false)
      material.roughnessMap = material.metalnessMap
    }
    if (entry.normalTexture) material.normalMap = texture(entry.normalTexture, false)
    if (entry.occlusionTexture) material.aoMap = texture(entry.occlusionTexture, false)
    if (entry.emissiveFactor) material.emissive.setRGB(entry.emissiveFactor[0], entry.emissiveFactor[1], entry.emissiveFactor[2], THREE.LinearSRGBColorSpace)
    if (entry.emissiveTexture) material.emissiveMap = texture(entry.emissiveTexture, true)
    const strength = entry.extensions?.KHR_materials_emissive_strength?.emissiveStrength
    if (strength !== undefined) material.emissiveIntensity = strength
    if (entry.doubleSided) material.side = THREE.DoubleSide
    if (entry.alphaMode === 'BLEND') {
      material.transparent = true
      material.depthWrite = false
    } else if (entry.alphaMode === 'MASK') material.alphaTest = entry.alphaCutoff ?? 0.5
    return material
  })
  const fallback = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 1 })
  const primitive = (entry: GltfPrimitive) => {
    const bounds = gltf.accessors[entry.attributes.POSITION]
    const min = new THREE.Vector3().fromArray(bounds.min ?? [0, 0, 0])
    const max = new THREE.Vector3().fromArray(bounds.max ?? [0, 0, 0])
    const size = max.clone().sub(min)
    const center = max.clone().add(min).multiplyScalar(0.5)
    const geometry = new THREE.BoxGeometry(Math.max(size.x, MIN_EXTENT), Math.max(size.y, MIN_EXTENT), Math.max(size.z, MIN_EXTENT))
    geometry.translate(center.x, center.y, center.z)
    if (!('TEXCOORD_0' in entry.attributes)) geometry.deleteAttribute('uv')
    if (!('NORMAL' in entry.attributes)) geometry.deleteAttribute('normal')
    return new THREE.Mesh(geometry, entry.material === undefined ? fallback : materials[entry.material])
  }
  const build = (index: number): THREE.Object3D => {
    const node = gltf.nodes[index]
    let object: THREE.Object3D
    if (node.mesh === undefined) object = new THREE.Object3D()
    else {
      const meshes = gltf.meshes[node.mesh].primitives.map(primitive)
      if (meshes.length === 1) object = meshes[0]
      else {
        object = new THREE.Group()
        object.add(...meshes)
      }
    }
    if (node.name) {
      object.name = node.name
      object.userData.name = node.name
    }
    if (node.matrix) object.applyMatrix4(new THREE.Matrix4().fromArray(node.matrix))
    else {
      object.position.fromArray(node.translation ?? [0, 0, 0])
      object.quaternion.fromArray(node.rotation ?? [0, 0, 0, 1])
      object.scale.fromArray(node.scale ?? [1, 1, 1])
    }
    for (const child of node.children ?? []) object.add(build(child))
    return object
  }
  const scene = new THREE.Group()
  for (const index of gltf.scenes[gltf.scene ?? 0].nodes) scene.add(build(index))
  return scene
}

export async function glbLibrary(ids: readonly ModelId[]): Promise<ModelLibrary> {
  const library = createModelLibrary(async (id) => glbScene(id))
  await library.ensure(ids)
  return library
}

export function recordingLibrary(library: ModelLibrary, used: Set<ModelId>): ModelLibrary {
  return {
    ...library,
    instance(id, joints) {
      used.add(id)
      return library.instance(id, joints)
    },
    shared(id) {
      used.add(id)
      return library.shared(id)
    },
    parts(id) {
      used.add(id)
      return library.parts(id)
    },
    bounds(id) {
      used.add(id)
      return library.bounds(id)
    },
  }
}

export function stubImages(): () => void {
  const scope = globalThis as { document?: unknown }
  if (scope.document !== undefined) return () => {}
  scope.document = {
    createElementNS: () => ({ addEventListener: () => {}, removeEventListener: () => {}, style: {} }),
  }
  return () => {
    delete scope.document
  }
}
