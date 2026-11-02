import * as THREE from 'three'
import type { BossBody } from './boss-rigs'
import { restQuaternion, socketWorld, type ModelInstance } from './model-library'
import { BOSS_DEFEAT } from './themes'

export interface Light {
  material: THREE.MeshStandardMaterial
  base: number
}

export interface Joint {
  upper: THREE.Object3D
  lower: THREE.Object3D | null
  side: number
}

export interface Shift {
  dx: number
  dz: number
}

export interface Placement {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
}

export interface Fader {
  (level: number): void
}

const point = new THREE.Vector3()
const euler = new THREE.Euler()
const turn = new THREE.Quaternion()
const held = new THREE.Quaternion()

export function orient(node: THREE.Object3D, x: number, y: number, z: number): void {
  node.quaternion.copy(restQuaternion(node)).multiply(turn.setFromEuler(euler.set(x, y, z)))
}

export function lightOf(material: THREE.MeshStandardMaterial | undefined): Light | null {
  return material ? { material, base: material.emissiveIntensity } : null
}

export function shine(lights: readonly (Light | null)[], level: number): void {
  for (const light of lights) if (light) light.material.emissiveIntensity = light.base * level
}

export function heightIn(root: THREE.Object3D, node: THREE.Object3D | undefined, fallback: number): number {
  if (!node) return fallback
  root.updateWorldMatrix(true, true)
  return root.worldToLocal(socketWorld(node, point)).y
}

export function anchorOf(view: BossBody): THREE.Object3D {
  return view.body.parent ?? view.body
}

export function tracker(view: BossBody, limit: number): (out: Shift) => Shift {
  let x = 0
  let z = 0
  let ready = false
  return (out) => {
    const { position } = anchorOf(view)
    out.dx = ready ? position.x - x : 0
    out.dz = ready ? position.z - z : 0
    if (Math.hypot(out.dx, out.dz) > limit) {
      out.dx = 0
      out.dz = 0
    }
    x = position.x
    z = position.z
    ready = true
    return out
  }
}

export function near(view: BossBody, x: number, y: number, reach: number): boolean {
  const { position } = anchorOf(view)
  return Math.hypot(position.x - x, position.z - y) <= reach
}

export function jointsOf(nodes: Map<string, THREE.Object3D>, names: readonly string[]): Joint[] {
  const joints: Joint[] = []
  for (const name of names) {
    const upper = nodes.get(name)
    if (!upper) continue
    const lower = nodes.get(`${name}_lower`) ?? null
    restQuaternion(upper)
    if (lower) restQuaternion(lower)
    joints.push({ upper, lower, side: upper.position.z > 0 ? -1 : 1 })
  }
  return joints
}

export function mount(view: BossBody, model: ModelInstance): void {
  view.pivot.add(model.root)
  view.materials.push(...model.tintable)
  view.owned.push(model)
}

export function detach(node: THREE.Object3D, anchor: THREE.Object3D): Placement {
  anchor.attach(node)
  return { position: node.position.clone(), quaternion: node.quaternion.clone() }
}

export function headingOf(view: BossBody, out: THREE.Vector3): THREE.Vector3 {
  out.set(1, 0, 0).applyQuaternion(view.pivot.quaternion)
  out.y = 0
  if (out.lengthSq() < 1e-9) out.set(1, 0, 0)
  return out.normalize()
}

export function sideOf(heading: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  return out.set(-heading.z, 0, heading.x)
}

export function toWorld(anchor: THREE.Object3D, local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  anchor.updateWorldMatrix(true, false)
  return out.copy(local).applyMatrix4(anchor.matrixWorld)
}

export function toLocal(anchor: THREE.Object3D, x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  anchor.updateWorldMatrix(true, false)
  return anchor.worldToLocal(out.set(x, y, z))
}

export function fader(materials: readonly THREE.Material[], root: THREE.Object3D | null): Fader {
  const bases = materials.map((material) => ({ material, opacity: material.opacity, transparent: material.transparent }))
  let current = 1
  let shadows = true
  return (level) => {
    if (level === current) return
    for (const base of bases) {
      const transparent = base.transparent || level < 1
      if (base.material.transparent !== transparent) {
        base.material.transparent = transparent
        base.material.needsUpdate = true
      }
      base.material.opacity = base.opacity * level
    }
    current = level
    if (!root || !shadows || level >= BOSS_DEFEAT.shadowFade) return
    shadows = false
    root.traverse((object) => {
      object.castShadow = false
    })
  }
}

export function blendFrom(saved: ReadonlyMap<THREE.Object3D, THREE.Quaternion>, weight: number): void {
  if (weight >= 1) return
  for (const [node, quaternion] of saved) {
    held.copy(node.quaternion)
    node.quaternion.copy(quaternion).slerp(held, weight)
  }
}

export function remember(nodes: readonly (THREE.Object3D | null)[]): Map<THREE.Object3D, THREE.Quaternion> {
  const saved = new Map<THREE.Object3D, THREE.Quaternion>()
  for (const node of nodes) if (node) saved.set(node, node.quaternion.clone())
  return saved
}

export function scatter(radius: number): number {
  return (Math.random() * 2 - 1) * radius
}
