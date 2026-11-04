import * as THREE from 'three'
import type { ModelInstance } from './model-library'
import { JOINT_ATTRIBUTE, type RigidTable } from './rigid-parts'
import { WRECK } from './themes'
import { launchWreck, stepWreck, wreckFade, wreckFlash, type Ground, type WreckPiece } from './wreck-motion'

export interface WreckSource {
  instance: ModelInstance
  joints: readonly string[]
  objects: ReadonlySet<THREE.Object3D>
  lights: readonly THREE.MeshStandardMaterial[]
}

interface Piece {
  node: THREE.Object3D
  start: THREE.Matrix4
  motion: WreckPiece
  axis: THREE.Vector3
  size: number
}

interface Wreck {
  base: THREE.Object3D
  pieces: Piece[]
  instance: ModelInstance
  age: number
}

export interface EnemyWrecks {
  readonly live: number
  spawn(source: WreckSource, dirX: number, dirZ: number, seed: number): void
  update(dt: number, ground: Ground): void
  reset(): void
}

const FLASH = new THREE.Color('#ffffff')

export function wreckSource(instance: ModelInstance, joints: readonly string[], lights: readonly THREE.MeshStandardMaterial[] = []): WreckSource {
  const objects = new Set<THREE.Object3D>()
  instance.root.traverse((object) => objects.add(object))
  return { instance, joints, objects, lights }
}

function depthBelow(node: THREE.Object3D, base: THREE.Object3D): number {
  let depth = 0
  for (let item: THREE.Object3D | null = node; item && item !== base; item = item.parent) depth++
  return depth
}

function pieceBounds(base: THREE.Object3D, nodes: readonly THREE.Object3D[], instance: ModelInstance): THREE.Box3[] {
  const boxes = nodes.map(() => new THREE.Box3())
  const owners = new Map(nodes.map((node, index) => [node, index]))
  const table = base.userData.rigid as RigidTable | undefined
  const point = new THREE.Vector3()
  const box = new THREE.Box3()
  const joints = (table?.names ?? []).map((name, index) => {
    if (index === 0 || !table) return { matrix: base.matrixWorld.clone(), owner: 0 }
    const node = instance.nodes.get(name)
    if (!node) return { matrix: base.matrixWorld.clone(), owner: 0 }
    return { matrix: node.matrixWorld.clone().multiply(new THREE.Matrix4().fromArray(table.rest, index * 16)), owner: owners.get(node) ?? 0 }
  })
  base.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const position = mesh.geometry.getAttribute('position')
    const joint = mesh.geometry.getAttribute(JOINT_ATTRIBUTE)
    if (mesh.userData.rigid === true && joint && joints.length > 0) {
      for (let i = 0; i < position.count; i++) {
        const entry = joints[Math.round(joint.getX(i))] ?? joints[0]
        boxes[entry.owner].expandByPoint(point.fromBufferAttribute(position, i).applyMatrix4(entry.matrix))
      }
      return
    }
    let owner = 0
    for (let item: THREE.Object3D | null = mesh; item && item !== base; item = item.parent) {
      const found = owners.get(item)
      if (found !== undefined) {
        owner = found
        break
      }
    }
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    if (mesh.geometry.boundingBox) boxes[owner].union(box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld))
  })
  return boxes
}

export function createEnemyWrecks(scene: THREE.Scene): EnemyWrecks {
  const wrecks: Wreck[] = []
  const center = new THREE.Vector3()
  const size = new THREE.Vector3()
  const all = new THREE.Box3()
  const turn = new THREE.Quaternion()
  const place = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const world = new THREE.Matrix4()
  const local = new THREE.Matrix4()

  function remove(wreck: Wreck): void {
    scene.remove(wreck.base)
    wreck.instance.dispose()
  }

  return {
    get live() {
      return wrecks.length
    },
    spawn(source, dirX, dirZ, seed) {
      const { instance } = source
      const base = instance.root
      const strays: THREE.Object3D[] = []
      base.traverse((object) => {
        if (!source.objects.has(object)) strays.push(object)
      })
      for (const object of strays) object.removeFromParent()
      base.updateWorldMatrix(true, true)
      scene.attach(base)
      base.updateWorldMatrix(false, true)
      const nodes = [base, ...source.joints.map((name) => instance.nodes.get(name)).filter((node): node is THREE.Object3D => Boolean(node))]
      nodes.sort((a, b) => depthBelow(a, base) - depthBelow(b, base))
      const boxes = pieceBounds(base, nodes, instance)
      all.makeEmpty()
      const seeds = nodes.map((node, index) => {
        const box = boxes[index]
        if (box.isEmpty()) box.setFromCenterAndSize(node.getWorldPosition(center), size.setScalar(0.2))
        all.union(box)
        box.getCenter(center)
        box.getSize(size)
        return { x: center.x, y: center.y, z: center.z, rest: Math.min(size.x, size.y, size.z) / 2, heavy: node === base }
      })
      all.getCenter(center)
      const motions = launchWreck(seeds, { x: center.x, z: center.z }, dirX, dirZ, seed)
      const pieces = nodes.map((node, index) => {
        const motion = motions[index]
        const start = new THREE.Matrix4().makeTranslation(-motion.x, -motion.y, -motion.z).multiply(node.matrixWorld)
        boxes[index].getSize(size)
        return { node, start, motion, axis: new THREE.Vector3(motion.ax, motion.ay, motion.az), size: Math.max(size.x, size.y, size.z) }
      })
      const tinted = new Set<THREE.Material>(instance.tintable)
      for (const material of instance.materials) if (material instanceof THREE.MeshStandardMaterial && !tinted.has(material)) material.emissiveIntensity = 0
      for (const material of source.lights) material.emissiveIntensity = 0
      base.traverse((object) => {
        object.frustumCulled = false
      })
      wrecks.push({ base, pieces, instance, age: 0 })
    },
    update(dt, ground) {
      for (let i = wrecks.length - 1; i >= 0; i--) {
        const wreck = wrecks[i]
        wreck.age += dt
        if (wreck.age >= WRECK.life) {
          remove(wreck)
          wrecks.splice(i, 1)
          continue
        }
        const flash = wreckFlash(wreck.age) * WRECK.glow
        for (const material of wreck.instance.tintable) {
          material.emissive.copy(FLASH)
          material.emissiveIntensity = flash
        }
        for (const piece of wreck.pieces) {
          const motion = stepWreck(piece.motion, dt, ground)
          const fade = wreckFade(motion)
          place.set(motion.x, motion.y - fade * fade * piece.size, motion.z)
          turn.setFromAxisAngle(piece.axis, motion.angle)
          scale.setScalar(1 - fade * WRECK.sinkScale)
          world.compose(place, turn, scale).multiply(piece.start)
          const parent = piece.node.parent
          if (!parent || piece.node === wreck.base) {
            world.decompose(piece.node.position, piece.node.quaternion, piece.node.scale)
            continue
          }
          parent.updateWorldMatrix(true, false)
          local.copy(parent.matrixWorld).invert().multiply(world)
          local.decompose(piece.node.position, piece.node.quaternion, piece.node.scale)
        }
      }
    },
    reset() {
      for (const wreck of wrecks) remove(wreck)
      wrecks.length = 0
    },
  }
}
