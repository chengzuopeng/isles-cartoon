import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { applyHold, armChain, solveHold } from './kai-pose'
import { WEAPON_HOLDS } from './themes'

interface FileSystem {
  readFileSync(path: URL): Uint8Array
}

interface GltfNode {
  name?: string
  children?: number[]
  translation?: number[]
  rotation?: number[]
  scale?: number[]
}

interface Gltf {
  nodes: GltfNode[]
  scenes: { nodes: number[] }[]
  scene?: number
}

const FS_MODULE = 'node:fs'
const fs = (await import(/* @vite-ignore */ FS_MODULE)) as FileSystem
const ROOT = new URL('../../', import.meta.url)
const TOLERANCE = 1e-4

function skeleton(id: string): Map<string, THREE.Object3D> {
  const bytes = fs.readFileSync(new URL(`public/assets/models/${id}.glb`, ROOT))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const length = view.getUint32(12, true)
  const gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))) as Gltf
  const nodes = new Map<string, THREE.Object3D>()
  const build = (index: number): THREE.Object3D => {
    const def = gltf.nodes[index]
    const object = new THREE.Object3D()
    if (def.translation) object.position.fromArray(def.translation)
    if (def.rotation) object.quaternion.fromArray(def.rotation)
    if (def.scale) object.scale.fromArray(def.scale)
    if (def.name) {
      object.userData.name = def.name
      nodes.set(def.name, object)
    }
    for (const child of def.children ?? []) object.add(build(child))
    return object
  }
  const scene = new THREE.Group()
  for (const index of gltf.scenes[gltf.scene ?? 0].nodes) scene.add(build(index))
  return nodes
}

function syntheticArm(): Map<string, THREE.Object3D> {
  const named = (name: string, parent: THREE.Object3D | null, x: number, y: number, z: number) => {
    const node = new THREE.Object3D()
    node.userData.name = name
    node.position.set(x, y, z)
    parent?.add(node)
    return node
  }
  const root = named('root', null, 0, 0, 0)
  const torso = named('torso', root, 0, 0.6, 0)
  torso.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.3)
  const upper = named('arm_r', torso, 0, 0.2, 0.15)
  upper.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.4)
  const lower = named('arm_r_lower', upper, 0, -0.16, 0.02)
  const hand = named('hand_r', lower, 0.1, 0.02, 0)
  const socket = named('socket_weapon', hand, 0.02, 0.03, 0.01)
  socket.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2)
  return new Map([root, torso, upper, lower, hand, socket].map((node) => [node.userData.name as string, node]))
}

function expectAimed(socket: THREE.Object3D, grip: readonly number[]): void {
  socket.updateWorldMatrix(true, false)
  const position = new THREE.Vector3()
  const turn = new THREE.Quaternion()
  socket.matrixWorld.decompose(position, turn, new THREE.Vector3())
  expect(position.distanceTo(new THREE.Vector3(grip[0], grip[1], grip[2]))).toBeLessThan(TOLERANCE)
  expect(new THREE.Vector3(1, 0, 0).applyQuaternion(turn).dot(new THREE.Vector3(1, 0, 0))).toBeGreaterThan(1 - TOLERANCE)
  expect(new THREE.Vector3(0, 1, 0).applyQuaternion(turn).dot(new THREE.Vector3(0, 1, 0))).toBeGreaterThan(1 - TOLERANCE)
}

describe('kai hold pose', () => {
  it('needs the whole right arm chain', () => {
    const nodes = syntheticArm()
    nodes.delete('arm_r_lower')
    expect(armChain(nodes)).toBeNull()
  })

  it('puts the socket on the grip and points the weapon forward, even with rest rotations up the chain', () => {
    const nodes = syntheticArm()
    const chain = armChain(nodes)
    expect(chain).not.toBeNull()
    if (!chain) return
    const grip = [0.15, 0.62, 0.22] as const
    const solution = solveHold(chain, grip, [0, -0.5, 1])
    expect(solution.reach).toBeLessThan(solution.limit)
    applyHold(chain, solution)
    expectAimed(chain.socket, grip)
  })

  it('bends the elbow toward the pole', () => {
    const outward = armChain(syntheticArm())
    const inward = armChain(syntheticArm())
    if (!outward || !inward) throw new Error('chain missing')
    const grip = [0.12, 0.66, 0.2] as const
    applyHold(outward, solveHold(outward, grip, [0, 0, 1]))
    applyHold(inward, solveHold(inward, grip, [0, 0, -1]))
    const elbow = (chain: typeof outward) => chain.lower.getWorldPosition(new THREE.Vector3()).z
    expect(elbow(outward)).toBeGreaterThan(elbow(inward))
  })

  for (const [id, hold] of Object.entries(WEAPON_HOLDS)) {
    it(`reaches the ${id} grip with kai's real arm and aims it forward`, () => {
      const nodes = skeleton('kai')
      const chain = armChain(nodes)
      expect(chain).not.toBeNull()
      if (!chain) return
      const solution = solveHold(chain, hold.grip, hold.elbow)
      expect(solution.reach).toBeLessThan(solution.limit)
      applyHold(chain, solution)
      expectAimed(chain.socket, hold.grip)
    })
  }
})
