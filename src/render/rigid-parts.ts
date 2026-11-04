import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { ModelInstance } from './model-library'
import { atlasKey, atlasPart, floatCopy, mergeStill, ownMeshes, type StillMerge } from './node-parts'
import { RIGID_PARTS } from './themes'

export const RIGID_PROGRAM = `rigid-joints-${RIGID_PARTS.joints}`
export const JOINT_ATTRIBUTE = 'rigidJoint'

export interface JointValues {
  value: Float32Array
}

export interface RigidTable {
  names: string[]
  rest: number[]
}

interface Entry {
  mesh: THREE.Mesh
  joint: number
}

interface Made {
  mesh: THREE.Mesh
  material: RigidStandardMaterial
  owned: { dispose(): void }[]
}

const PICK = `rigidJoints[ int( ${JOINT_ATTRIBUTE} + 0.5 ) ]`

export function rigidVertex(source: string): string {
  return source
    .replace('#include <common>', `#include <common>\nuniform mat4 rigidJoints[ ${RIGID_PARTS.joints} ];\nattribute float ${JOINT_ATTRIBUTE};`)
    .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\nobjectNormal = mat3( ${PICK} ) * objectNormal;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed = ( ${PICK} * vec4( transformed, 1.0 ) ).xyz;`)
}

function patch(shader: THREE.WebGLProgramParametersWithUniforms, joints: JointValues): void {
  shader.uniforms.rigidJoints = joints
  shader.vertexShader = rigidVertex(shader.vertexShader)
}

export class RigidStandardMaterial extends THREE.MeshStandardMaterial {
  rigidJoints: JointValues = { value: new Float32Array(16) }

  override onBeforeCompile(shader: THREE.WebGLProgramParametersWithUniforms): void {
    patch(shader, this.rigidJoints)
  }

  override customProgramCacheKey(): string {
    return RIGID_PROGRAM
  }
}

export class RigidDepthMaterial extends THREE.MeshDepthMaterial {
  rigidJoints: JointValues = { value: new Float32Array(16) }

  override onBeforeCompile(shader: THREE.WebGLProgramParametersWithUniforms): void {
    patch(shader, this.rigidJoints)
  }

  override customProgramCacheKey(): string {
    return RIGID_PROGRAM
  }
}

export class RigidNormalMaterial extends THREE.MeshNormalMaterial {
  rigidJoints: JointValues = { value: new Float32Array(16) }

  override onBeforeCompile(shader: THREE.WebGLProgramParametersWithUniforms): void {
    patch(shader, this.rigidJoints)
  }

  override customProgramCacheKey(): string {
    return RIGID_PROGRAM
  }
}

const normals = new WeakMap<RigidStandardMaterial, RigidNormalMaterial>()

export function rigidNormalFor(material: RigidStandardMaterial): RigidNormalMaterial {
  const known = normals.get(material)
  if (known) return known
  const normal = new RigidNormalMaterial({ side: material.side })
  normal.rigidJoints = material.rigidJoints
  material.addEventListener('dispose', () => normal.dispose())
  normals.set(material, normal)
  return normal
}

function jointCopy(mesh: THREE.Mesh, inverse: THREE.Matrix4, joint: number): THREE.BufferGeometry {
  const geometry = floatCopy(mesh.geometry)
  geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld))
  const count = geometry.getAttribute('position').count
  geometry.setAttribute(JOINT_ATTRIBUTE, new THREE.BufferAttribute(new Float32Array(count).fill(joint), 1))
  return geometry
}

function mergeAll(list: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (list.length === 1) return list[0]
  const indexed = list.every((geometry) => geometry.index !== null)
  const prepared = list.map((geometry) => (indexed || !geometry.index ? geometry : geometry.toNonIndexed()))
  const names = Object.keys(prepared[0].attributes).filter((name) => prepared.every((geometry) => name in geometry.attributes))
  for (const geometry of prepared) {
    for (const name of Object.keys(geometry.attributes)) if (!names.includes(name)) geometry.deleteAttribute(name)
  }
  const merged = names.includes('position') ? mergeGeometries(prepared, false) : null
  for (const geometry of new Set([...list, ...prepared])) if (geometry !== merged) geometry.dispose()
  return merged
}

function rigidMesh(entries: readonly Entry[], inverse: THREE.Matrix4): Made | null {
  const first = entries[0].mesh.material
  if (!(first instanceof THREE.MeshStandardMaterial) || first instanceof THREE.MeshPhysicalMaterial) return null
  const parts = entries.map((entry) => ({ geometry: jointCopy(entry.mesh, inverse, entry.joint), material: entry.mesh.material as THREE.Material }))
  const owned: { dispose(): void }[] = []
  let geometry: THREE.BufferGeometry | null
  let base: THREE.MeshStandardMaterial = first
  if (parts.every((part) => part.material === first)) {
    geometry = mergeAll(parts.map((part) => part.geometry))
  } else {
    const atlas = atlasPart(parts)
    for (const part of parts) part.geometry.dispose()
    if (!atlas) return null
    geometry = atlas.geometry
    base = atlas.material
    owned.push(atlas.lookup)
  }
  if (!geometry) return null
  const material = new RigidStandardMaterial().copy(base)
  if (base !== first) base.dispose()
  geometry.computeBoundingSphere()
  if (geometry.boundingSphere) geometry.boundingSphere.radius *= RIGID_PARTS.bounds
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = entries.some((entry) => entry.mesh.castShadow)
  mesh.userData.still = true
  mesh.userData.rigid = true
  owned.push(geometry, material)
  return { mesh, material, owned }
}

function rigidTable(spaces: readonly THREE.Object3D[], inverse: THREE.Matrix4): RigidTable {
  const rest: number[] = []
  const matrix = new THREE.Matrix4()
  spaces.forEach((space, index) => {
    if (index === 0) matrix.identity()
    else matrix.multiplyMatrices(inverse, space.matrixWorld).invert()
    rest.push(...matrix.elements)
  })
  return { names: spaces.map((space, index) => (index === 0 ? '' : String(space.userData.name))), rest }
}

function spaceMeshes(space: THREE.Object3D, stops: ReadonlySet<THREE.Object3D>): THREE.Mesh[] {
  const found: THREE.Mesh[] = []
  const visit = (object: THREE.Object3D) => {
    if ((object as THREE.Mesh).isMesh) found.push(object as THREE.Mesh)
    for (const child of object.children) if (!stops.has(child)) visit(child)
  }
  visit(space)
  return found
}

function retire(mesh: THREE.Mesh, keep: boolean): THREE.Object3D | null {
  const parent = mesh.parent
  if (!parent) return null
  if (!keep && mesh.children.length === 0) {
    mesh.removeFromParent()
    return null
  }
  const node = new THREE.Object3D()
  node.name = mesh.name
  node.userData = JSON.parse(JSON.stringify(mesh.userData))
  node.position.copy(mesh.position)
  node.quaternion.copy(mesh.quaternion)
  node.scale.copy(mesh.scale)
  node.visible = mesh.visible
  node.renderOrder = mesh.renderOrder
  node.matrix.copy(mesh.matrix)
  node.matrixWorld.copy(mesh.matrixWorld)
  parent.children[parent.children.indexOf(mesh)] = node
  node.parent = parent
  mesh.parent = null
  for (const child of [...mesh.children]) node.add(child)
  return node
}

export function mergeRigid(root: THREE.Object3D, joints: readonly string[]): StillMerge {
  const spaces: THREE.Object3D[] = [root]
  root.traverse((object) => {
    if (object !== root && joints.includes(object.userData.name)) spaces.push(object)
  })
  const stops = new Set(spaces)
  const lists = spaces.map((space) => ownMeshes(space, stops))
  const result: StillMerge = { added: [], materials: [], owned: [] }
  const taken = new Set<THREE.Mesh>()
  if (spaces.length > 1 && spaces.length <= RIGID_PARTS.joints) {
    const groups = new Map<string | THREE.Material, Entry[]>()
    spaces.forEach((space, joint) => {
      for (const mesh of spaceMeshes(space, stops)) {
        if (Array.isArray(mesh.material)) continue
        const key = atlasKey(mesh.material) ?? mesh.material
        const list = groups.get(key)
        if (list) list.push({ mesh, joint })
        else groups.set(key, [{ mesh, joint }])
      }
    })
    root.updateWorldMatrix(true, true)
    const inverse = root.matrixWorld.clone().invert()
    const table = rigidTable(spaces, inverse)
    for (const entries of groups.values()) {
      if (new Set(entries.map((entry) => entry.joint)).size < 2) continue
      const made = rigidMesh(entries, inverse)
      if (!made) continue
      root.add(made.mesh)
      for (const entry of entries) taken.add(entry.mesh)
      result.added.push(made.mesh)
      result.materials.push(made.material)
      result.owned.push(...made.owned)
    }
    if (result.added.length > 0) root.userData.rigid = table
    for (const mesh of taken) {
      const index = spaces.indexOf(mesh)
      const node = retire(mesh, index >= 0)
      if (node && index >= 0) spaces[index] = node
    }
  }
  spaces.forEach((space, index) => {
    const merged = mergeStill(
      space,
      lists[index].filter((mesh) => !taken.has(mesh)),
    )
    result.added.push(...merged.added)
    result.materials.push(...merged.materials)
    result.owned.push(...merged.owned)
  })
  return result
}

function hidden(joint: THREE.Object3D, base: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = joint; node && node !== base; node = node.parent) if (!node.visible) return true
  return false
}

export function rigidMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = []
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh && object.userData.rigid === true) found.push(object as THREE.Mesh)
  })
  return found
}

export function jointMatrices(table: RigidTable, base: THREE.Object3D, nodes: ReadonlyMap<string, THREE.Object3D>): (out: Float32Array) => void {
  const joints = table.names.map((name, index) => (index === 0 ? base : (nodes.get(name) ?? null)))
  const rest = joints.map((_, index) => new THREE.Matrix4().fromArray(table.rest, index * 16))
  const inverse = new THREE.Matrix4()
  const relative = new THREE.Matrix4()
  return (out) => {
    inverse.copy(base.matrixWorld).invert()
    for (let index = 0; index < joints.length; index++) {
      const joint = joints[index]
      if (!joint || hidden(joint, base)) out.fill(0, index * 16, index * 16 + 16)
      else relative.multiplyMatrices(inverse, joint.matrixWorld).multiply(rest[index]).toArray(out, index * 16)
    }
  }
}

export function bindRigid(model: ModelInstance): THREE.Mesh[] {
  const table = model.root.userData.rigid as RigidTable | undefined
  const meshes = rigidMeshes(model.root)
  if (!table || meshes.length === 0) return []
  const values = new Float32Array(table.names.length * 16)
  const fill = jointMatrices(table, model.root, model.nodes)
  let frame = -1
  const update = (renderer: THREE.WebGLRenderer) => {
    const now = renderer.info.render.frame
    if (now === frame) return
    frame = now
    fill(values)
  }
  const owned: THREE.Material[] = []
  for (const mesh of meshes) {
    const material = mesh.material
    if (!(material instanceof RigidStandardMaterial)) continue
    material.rigidJoints.value = values
    const depth = new RigidDepthMaterial()
    depth.rigidJoints.value = values
    mesh.customDepthMaterial = depth
    owned.push(depth)
    mesh.onBeforeRender = update
    mesh.onBeforeShadow = update
  }
  const release = model.dispose
  model.dispose = () => {
    release()
    for (const material of owned) material.dispose()
  }
  return meshes
}
