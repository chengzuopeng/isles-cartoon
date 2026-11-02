import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export interface NodePart {
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

export function bakeNode(root: THREE.Object3D, name: string): NodePart[] | null {
  let node: THREE.Object3D | null = null
  root.traverse((object) => {
    if (!node && object.userData.name === name) node = object
  })
  if (!node) return null
  root.updateWorldMatrix(true, true)
  const inverse = root.matrixWorld.clone().invert()
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>()
  ;(node as THREE.Object3D).traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || Array.isArray(mesh.material)) return
    const geometry = floatCopy(mesh.geometry)
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld))
    const list = groups.get(mesh.material)
    if (list) list.push(geometry)
    else groups.set(mesh.material, [geometry])
  })
  const parts: NodePart[] = []
  for (const [material, list] of groups) {
    for (const geometry of list.length === 1 ? list : mergeSameAttributes(list)) parts.push({ geometry, material })
  }
  return parts.length > 0 ? parts : null
}

export function floatCopy(source: THREE.BufferGeometry): THREE.BufferGeometry {
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

function mergeSameAttributes(list: THREE.BufferGeometry[]): THREE.BufferGeometry[] {
  const prepared = list.every((geometry) => geometry.index !== null) ? list : list.map((geometry) => (geometry.index ? geometry.toNonIndexed() : geometry))
  const names = Object.keys(prepared[0].attributes).filter((name) => prepared.every((geometry) => name in geometry.attributes))
  for (const geometry of prepared) {
    for (const name of Object.keys(geometry.attributes)) if (!names.includes(name)) geometry.deleteAttribute(name)
  }
  const merged = mergeGeometries(prepared, false)
  if (!merged) {
    for (const geometry of list) if (!prepared.includes(geometry)) geometry.dispose()
    return prepared
  }
  for (const geometry of new Set([...list, ...prepared])) geometry.dispose()
  return [merged]
}

export interface MergedPart {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  castShadow: boolean
  starts: number[]
  meshes: THREE.Mesh[]
}

export interface AtlasPart {
  geometry: THREE.BufferGeometry
  material: THREE.MeshStandardMaterial
  lookup: THREE.DataTexture
}

export interface StillMerge {
  added: THREE.Mesh[]
  materials: THREE.MeshStandardMaterial[]
  owned: { dispose(): void }[]
}

const ATLAS_BLOCKERS = ['roughnessMap', 'metalnessMap', 'normalMap', 'bumpMap', 'aoMap', 'emissiveMap', 'alphaMap', 'lightMap', 'displacementMap', 'envMap'] as const

export function atlasKey(material: THREE.Material): string | null {
  if (!(material instanceof THREE.MeshStandardMaterial) || material instanceof THREE.MeshPhysicalMaterial) return null
  const { map } = material
  if (!map || map.channel !== 0 || material.emissive.getHex() !== 0 || material.vertexColors) return null
  if (ATLAS_BLOCKERS.some((name) => material[name] !== null)) return null
  return [
    map.uuid,
    material.color.getHexString(),
    material.side,
    material.transparent,
    material.opacity,
    material.alphaTest,
    material.flatShading,
    material.depthWrite,
    material.depthTest,
    material.blending,
  ].join('|')
}

export function atlasPart(parts: readonly NodePart[]): AtlasPart | null {
  if (parts.length < 2) return null
  const key = atlasKey(parts[0].material)
  if (key === null || parts.some((part) => atlasKey(part.material) !== key)) return null
  const names = Object.keys(parts[0].geometry.attributes).filter((name) => name !== 'uv1' && parts.every((part) => name in part.geometry.attributes))
  if (!names.includes('position') || !names.includes('uv')) return null
  const looks: string[] = []
  const slots = parts.map((part) => {
    const { roughness, metalness } = part.material as THREE.MeshStandardMaterial
    const look = `${roughness}|${metalness}`
    if (!looks.includes(look)) looks.push(look)
    return looks.indexOf(look)
  })
  const width = looks.length
  const indexed = parts.every((part) => part.geometry.index !== null)
  const list = parts.map((part, index) => {
    const source = indexed ? part.geometry : part.geometry.index ? part.geometry.toNonIndexed() : part.geometry
    const copy = new THREE.BufferGeometry()
    for (const name of names) copy.setAttribute(name, source.getAttribute(name))
    if (indexed && source.index) copy.setIndex(source.index)
    const count = source.getAttribute('position').count
    const lookup = new Float32Array(count * 2)
    const u = (slots[index] + 0.5) / width
    for (let i = 0; i < count; i++) {
      lookup[i * 2] = u
      lookup[i * 2 + 1] = 0.5
    }
    copy.setAttribute('uv1', new THREE.BufferAttribute(lookup, 2))
    return copy
  })
  const geometry = mergeGeometries(list, false)
  if (!geometry) return null
  const data = new Uint8Array(width * 4)
  looks.forEach((look, index) => {
    const [roughness, metalness] = look.split('|').map(Number)
    data.set([255, Math.round(roughness * 255), Math.round(metalness * 255), 255], index * 4)
  })
  const lookup = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat)
  lookup.magFilter = THREE.NearestFilter
  lookup.minFilter = THREE.NearestFilter
  lookup.generateMipmaps = false
  lookup.channel = 1
  lookup.needsUpdate = true
  const main = parts.reduce((best, part) => (part.geometry.getAttribute('position').count > best.geometry.getAttribute('position').count ? part : best))
  const material = (main.material as THREE.MeshStandardMaterial).clone()
  material.roughness = 1
  material.metalness = 1
  material.roughnessMap = lookup
  material.metalnessMap = lookup
  return { geometry, material, lookup }
}

export interface GroupedParts {
  parts: NodePart[]
  owned: { dispose(): void }[]
}

export function atlasGroups(parts: readonly NodePart[]): GroupedParts {
  const byKey = new Map<string, NodePart[]>()
  const rest: NodePart[] = []
  for (const part of parts) {
    const key = atlasKey(part.material)
    if (key === null) {
      rest.push(part)
      continue
    }
    const list = byKey.get(key)
    if (list) list.push(part)
    else byKey.set(key, [part])
  }
  const result: GroupedParts = { parts: [], owned: [] }
  for (const list of byKey.values()) {
    const atlas = atlasPart(list)
    if (!atlas) {
      result.parts.push(...list)
      continue
    }
    result.parts.push(atlas)
    result.owned.push(atlas.geometry, atlas.material, atlas.lookup)
  }
  result.parts.push(...rest)
  return result
}

export function ownMeshes(node: THREE.Object3D | undefined, named: ReadonlySet<THREE.Object3D>): THREE.Mesh[] {
  const found: THREE.Mesh[] = []
  const visit = (object: THREE.Object3D) => {
    const mesh = object as THREE.Mesh
    if (mesh.isMesh && object.children.length === 0) found.push(mesh)
    for (const child of object.children) if (!named.has(child)) visit(child)
  }
  if (node) visit(node)
  return found
}

export function mergeStill(space: THREE.Object3D, meshes: readonly THREE.Mesh[]): StillMerge {
  const result: StillMerge = { added: [], materials: [], owned: [] }
  const parts = mergeMeshes([meshes], space)
  const byKey = new Map<string, MergedPart[]>()
  const rest: MergedPart[] = []
  for (const part of parts) {
    const key = atlasKey(part.material)
    if (key === null) {
      rest.push(part)
      continue
    }
    const list = byKey.get(key)
    if (list) list.push(part)
    else byKey.set(key, [part])
  }
  const place = (geometry: THREE.BufferGeometry, material: THREE.Material, castShadow: boolean, sources: readonly THREE.Mesh[]) => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = castShadow
    mesh.userData.still = true
    space.add(mesh)
    for (const source of sources) source.removeFromParent()
    result.added.push(mesh)
    result.owned.push(geometry)
  }
  for (const list of byKey.values()) {
    const atlas = atlasPart(list)
    if (!atlas) {
      rest.push(...list)
      continue
    }
    place(
      atlas.geometry,
      atlas.material,
      list.some((part) => part.castShadow),
      list.flatMap((part) => part.meshes),
    )
    result.materials.push(atlas.material)
    result.owned.push(atlas.material, atlas.lookup)
    for (const part of list) part.geometry.dispose()
  }
  for (const part of rest) {
    if (part.meshes.length > 1) place(part.geometry, part.material, part.castShadow, part.meshes)
    else part.geometry.dispose()
  }
  return result
}

export function mergeJoints(root: THREE.Object3D, joints: readonly string[]): StillMerge {
  const spaces: THREE.Object3D[] = [root]
  root.traverse((object) => {
    if (object !== root && joints.includes(object.userData.name)) spaces.push(object)
  })
  const stops = new Set(spaces)
  const lists = spaces.map((space) => ownMeshes(space, stops))
  const result: StillMerge = { added: [], materials: [], owned: [] }
  spaces.forEach((space, index) => {
    const merged = mergeStill(space, lists[index])
    result.added.push(...merged.added)
    result.materials.push(...merged.materials)
    result.owned.push(...merged.owned)
  })
  return result
}

export function mergeMeshes(groups: readonly (readonly THREE.Mesh[])[], space: THREE.Object3D): MergedPart[] {
  space.updateWorldMatrix(true, true)
  const inverse = space.matrixWorld.clone().invert()
  const byMaterial = new Map<THREE.Material, { lists: THREE.BufferGeometry[][]; castShadow: boolean; meshes: THREE.Mesh[] }>()
  groups.forEach((meshes, group) => {
    for (const mesh of meshes) {
      if (Array.isArray(mesh.material)) continue
      mesh.updateWorldMatrix(true, false)
      const geometry = floatCopy(mesh.geometry)
      geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld))
      let entry = byMaterial.get(mesh.material)
      if (!entry) {
        entry = { lists: groups.map(() => []), castShadow: false, meshes: [] }
        byMaterial.set(mesh.material, entry)
      }
      entry.lists[group].push(geometry)
      entry.meshes.push(mesh)
      entry.castShadow ||= mesh.castShadow
    }
  })
  const parts: MergedPart[] = []
  for (const [material, entry] of byMaterial) {
    const flat = entry.lists.flat()
    const indexed = flat.every((geometry) => geometry.index !== null)
    const prepared = entry.lists.map((list) => list.map((geometry) => (indexed || !geometry.index ? geometry : geometry.toNonIndexed())))
    const sizeOf = (geometry: THREE.BufferGeometry) => (indexed ? (geometry.index?.count ?? 0) : (geometry.getAttribute('position')?.count ?? 0))
    const starts: number[] = []
    let count = 0
    for (const list of prepared) {
      starts.push(count)
      for (const geometry of list) count += sizeOf(geometry)
    }
    const all = prepared.flat()
    const names = Object.keys(all[0].attributes).filter((name) => all.every((geometry) => name in geometry.attributes))
    for (const geometry of all) {
      for (const name of Object.keys(geometry.attributes)) if (!names.includes(name)) geometry.deleteAttribute(name)
    }
    const merged = all.length === 1 ? all[0] : names.includes('position') ? mergeGeometries(all, false) : null
    for (const geometry of new Set([...flat, ...all])) if (geometry !== merged) geometry.dispose()
    if (merged) parts.push({ geometry: merged, material, castShadow: entry.castShadow, starts, meshes: entry.meshes })
  }
  return parts
}
