import * as THREE from 'three'
import { SHEEP } from '../data/sheep'
import { lerp } from '../sim/math'
import type { GameEvent, Sheep } from '../sim/types'
import type { World } from '../sim/world'
import type { Effects } from './effects'
import { instancedDepth } from './instanced-depth'
import type { ModelLibrary } from './model-library'
import { atlasGroups, bakeNode, type NodePart } from './node-parts'
import { SHEEP_LEGS, bodyBob, headPitch, legSwing, turnToward, type SheepLeg } from './sheep-motion'
import { SHEEP_RIG } from './themes'

export const SHEEP_NODES = ['body', 'head', ...SHEEP_LEGS] as const

type SheepNode = (typeof SHEEP_NODES)[number]

interface PartSet {
  node: SheepNode
  rest: THREE.Matrix4
  meshes: THREE.InstancedMesh[]
}

interface Pose {
  yaw: number
  phase: number
  stride: number
  ready: boolean
}

interface Fallback {
  root: THREE.Group
  head: THREE.Mesh
}

export interface SheepViews {
  readonly meshCount: number
  sync(world: World, alpha: number, dt: number): void
  handle(event: GameEvent): void
  reset(): void
  dispose(): void
}

const Z_AXIS = new THREE.Vector3(0, 0, 1)
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const SHADOWLESS = /^mat_(face|decal|emblem)/

function castsShadow(material: THREE.Material): boolean {
  return !(material.transparent || material.alphaTest > 0 || SHADOWLESS.test(material.name))
}

export function createSheepViews(scene: THREE.Scene, models: ModelLibrary, effects: Effects | null = null): SheepViews {
  const sets: PartSet[] = []
  const owned: { dispose(): void }[] = []
  const poses: Pose[] = []
  const fallbacks: Fallback[] = []
  const fallbackOwned: { dispose(): void }[] = []
  let capacity = 0
  let parts: { node: SheepNode; rest: THREE.Matrix4; parts: NodePart[] }[] | null = null

  const rootMatrix = new THREE.Matrix4()
  const bodyMatrix = new THREE.Matrix4()
  const work = new THREE.Matrix4()
  const turn = new THREE.Matrix4()
  const quaternion = new THREE.Quaternion()
  const position = new THREE.Vector3()
  const unit = new THREE.Vector3(1, 1, 1)

  function bake(): { node: SheepNode; rest: THREE.Matrix4; parts: NodePart[] }[] {
    const { root, nodes } = models.shared('sheep')
    root.updateMatrixWorld(true)
    const head = nodes.get('head')
    head?.removeFromParent()
    const baked: { node: SheepNode; rest: THREE.Matrix4; parts: NodePart[] }[] = []
    for (const name of SHEEP_NODES) {
      const node = name === 'head' ? head : nodes.get(name)
      if (!node) continue
      node.updateMatrix()
      const raw = bakeNode(node, name) ?? []
      const grouped = atlasGroups(raw)
      const kept = new Set(grouped.parts.map((part) => part.geometry))
      for (const part of raw) {
        if (!kept.has(part.geometry)) part.geometry.dispose()
      }
      for (const part of grouped.parts) owned.push(part.geometry)
      owned.push(...grouped.owned)
      baked.push({ node: name, rest: node.matrix.clone(), parts: grouped.parts })
    }
    return baked
  }

  function build(count: number): void {
    clearMeshes()
    capacity = count
    if (count === 0) return
    if (!models.has('sheep')) {
      buildFallbacks(count)
      return
    }
    parts ??= bake()
    for (const entry of parts) {
      const meshes = entry.parts.map((part) => {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, count)
        mesh.name = `sheep:${entry.node}`
        mesh.castShadow = castsShadow(part.material)
        mesh.receiveShadow = false
        mesh.customDepthMaterial = instancedDepth(mesh)
        mesh.count = 0
        scene.add(mesh)
        return mesh
      })
      sets.push({ node: entry.node, rest: entry.rest, meshes })
    }
  }

  function buildFallbacks(count: number): void {
    const wool = new THREE.MeshStandardMaterial({ color: SHEEP_RIG.fallbackWool, flatShading: true })
    const face = new THREE.MeshStandardMaterial({ color: SHEEP_RIG.fallbackFace })
    const bodyGeometry = new THREE.IcosahedronGeometry(0.3, 1)
    const headGeometry = new THREE.BoxGeometry(0.2, 0.2, 0.18)
    fallbackOwned.push(wool, face, bodyGeometry, headGeometry)
    for (let i = 0; i < count; i++) {
      const root = new THREE.Group()
      const body = new THREE.Mesh(bodyGeometry, wool)
      body.position.y = 0.32
      body.scale.set(1.25, 0.9, 1)
      body.castShadow = true
      const head = new THREE.Mesh(headGeometry, face)
      head.position.set(0.38, 0.4, 0)
      head.castShadow = true
      root.add(body, head)
      root.visible = false
      scene.add(root)
      fallbacks.push({ root, head })
    }
  }

  function clearMeshes(): void {
    for (const set of sets) {
      for (const mesh of set.meshes) {
        mesh.removeFromParent()
        mesh.dispose()
      }
    }
    sets.length = 0
    for (const item of fallbacks) item.root.removeFromParent()
    fallbacks.length = 0
    for (const resource of fallbackOwned) resource.dispose()
    fallbackOwned.length = 0
    capacity = 0
  }

  function poseOf(index: number, sheep: Sheep, dt: number): Pose {
    let pose = poses[index]
    if (!pose) {
      pose = { yaw: -sheep.facing, phase: 0, stride: 0, ready: false }
      poses[index] = pose
    }
    pose.yaw = pose.ready ? turnToward(pose.yaw, -sheep.facing, SHEEP_RIG.turnRate, dt) : -sheep.facing
    pose.stride += ((sheep.moving ? 1 : 0) - pose.stride) * Math.min(1, dt * SHEEP_RIG.moveEase)
    const speed = sheep.state === 'grazing' ? SHEEP.grazeSpeed : SHEEP.walkSpeed
    if (pose.stride > 0.01) pose.phase += dt * speed * SHEEP_RIG.stepRate
    pose.ready = true
    return pose
  }

  function write(set: PartSet, index: number, matrix: THREE.Matrix4): void {
    for (const mesh of set.meshes) mesh.setMatrixAt(index, matrix)
  }

  function syncModels(world: World, alpha: number, dt: number): void {
    const count = world.sheep.length
    const body = sets.find((set) => set.node === 'body') ?? null
    world.sheep.forEach((sheep, index) => {
      const pose = poseOf(index, sheep, dt)
      position.set(lerp(sheep.prev.x, sheep.pos.x, alpha), 0, lerp(sheep.prev.y, sheep.pos.y, alpha))
      quaternion.setFromAxisAngle(Y_AXIS, pose.yaw)
      rootMatrix.compose(position, quaternion, unit)
      bodyMatrix.multiplyMatrices(rootMatrix, work.makeTranslation(0, bodyBob(pose.phase, pose.stride), 0))
      if (body) {
        bodyMatrix.multiply(body.rest)
        write(body, index, bodyMatrix)
      }
      const pitch = headPitch(sheep.state, pose.stride, pose.phase, world.time, sheep.id * 1.7)
      for (const set of sets) {
        if (set === body) continue
        if (set.node === 'head') {
          work.multiplyMatrices(bodyMatrix, set.rest).multiply(turn.makeRotationAxis(Z_AXIS, pitch))
        } else {
          const swing = legSwing(set.node as SheepLeg, pose.phase, pose.stride)
          work.multiplyMatrices(rootMatrix, set.rest).multiply(turn.makeRotationAxis(Z_AXIS, swing))
        }
        write(set, index, work)
      }
    })
    for (const set of sets) {
      for (const mesh of set.meshes) {
        mesh.count = count
        mesh.instanceMatrix.needsUpdate = true
        mesh.computeBoundingSphere()
      }
    }
  }

  function syncFallbacks(world: World, alpha: number, dt: number): void {
    world.sheep.forEach((sheep, index) => {
      const item = fallbacks[index]
      if (!item) return
      const pose = poseOf(index, sheep, dt)
      item.root.visible = true
      item.root.position.set(lerp(sheep.prev.x, sheep.pos.x, alpha), bodyBob(pose.phase, pose.stride), lerp(sheep.prev.y, sheep.pos.y, alpha))
      item.root.rotation.y = pose.yaw
      item.head.position.y = 0.4 + headPitch(sheep.state, pose.stride, pose.phase, world.time, sheep.id * 1.7) * 0.4
    })
  }

  return {
    get meshCount() {
      return sets.reduce((sum, set) => sum + set.meshes.length, 0) + fallbacks.length
    },
    sync(world, alpha, dt) {
      if (world.sheep.length > capacity || (capacity > 0 && world.sheep.length === 0)) build(world.sheep.length)
      if (world.sheep.length === 0) return
      if (fallbacks.length > 0) syncFallbacks(world, alpha, dt)
      else syncModels(world, alpha, dt)
    },
    handle(event) {
      if (!effects) return
      if (event.type === 'sheepFreed') {
        effects.puff(event.x, 0.3, event.y, SHEEP_RIG.freed, 0.2, 0.75, 0.45)
        effects.puff(event.x + 0.2, 0.15, event.y - 0.1, SHEEP_RIG.freed, 0.12, 0.5, 0.35)
      } else if (event.type === 'sheepHome') {
        effects.puff(event.x, 0.55, event.y, SHEEP_RIG.home, 0.15, 0.7, 0.55)
        effects.puff(event.x - 0.15, 0.3, event.y + 0.1, SHEEP_RIG.freed, 0.1, 0.45, 0.4)
      }
    },
    reset() {
      poses.length = 0
      for (const set of sets) for (const mesh of set.meshes) mesh.count = 0
      for (const item of fallbacks) item.root.visible = false
    },
    dispose() {
      clearMeshes()
      for (const item of new Set(owned)) item.dispose()
      owned.length = 0
      parts = null
    },
  }
}
