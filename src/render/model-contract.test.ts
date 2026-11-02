import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { MODEL_IDS, WEAPON_MODEL_IDS } from './asset-urls'
import { CAPTAIN_NODES } from './captain-rig'
import { CHIEF_NODES } from './chief-rig'
import { ENEMY_JOINTS } from './enemy-rigs'
import { MINE_NODES } from './mine-views'
import { drivenNodes, lampRule, landmarkOf } from './scene-models'
import { SHEEP_NODES } from './sheep-views'
import { TANK_NODES } from './tank-rig'

interface FileSystem {
  readFileSync(path: URL): Uint8Array
  readFileSync(path: URL, encoding: 'utf8'): string
  existsSync(path: URL): boolean
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
  nodes?: GltfNode[]
  scenes?: { nodes?: number[] }[]
  scene?: number
  meshes?: { primitives: { material?: number }[] }[]
  materials?: { name?: string }[]
}

const FS_MODULE = 'node:fs'
const fs = (await import(/* @vite-ignore */ FS_MODULE)) as FileSystem
const ROOT = new URL('../../', import.meta.url)
const GLB_MAGIC = 0x46546c67
const JSON_CHUNK = 0x4e4f534a
const MUZZLE_SIDEWAYS = 0.03
const WEAPONS: readonly string[] = WEAPON_MODEL_IDS
const TURRET_NODES = ['socket_head', 'socket_muzzle_1', 'socket_muzzle_2', 'socket_muzzle_3']
const RIGGED_NODES: Readonly<Record<string, readonly string[]>> = {
  ...ENEMY_JOINTS,
  'demo-chief': CHIEF_NODES,
  'shield-captain': CAPTAIN_NODES,
  'forest-tank': TANK_NODES,
  mine: MINE_NODES,
  sheep: SHEEP_NODES,
}

function file(path: string): URL {
  return new URL(path, ROOT)
}

function readGlb(id: string): Gltf {
  const bytes = fs.readFileSync(file(`public/assets/models/${id}.glb`))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  expect(view.getUint32(0, true)).toBe(GLB_MAGIC)
  expect(view.getUint32(16, true)).toBe(JSON_CHUNK)
  const length = view.getUint32(12, true)
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))) as Gltf
}

function positions(gltf: Gltf): Map<string, THREE.Vector3> {
  const nodes = gltf.nodes ?? []
  const found = new Map<string, THREE.Vector3>()
  const visit = (index: number, parent: THREE.Matrix4) => {
    const node = nodes[index]
    const local = node.matrix
      ? new THREE.Matrix4().fromArray(node.matrix)
      : new THREE.Matrix4().compose(
          new THREE.Vector3().fromArray(node.translation ?? [0, 0, 0]),
          new THREE.Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
          new THREE.Vector3().fromArray(node.scale ?? [1, 1, 1]),
        )
    const world = parent.clone().multiply(local)
    if (node.name) found.set(node.name, new THREE.Vector3().setFromMatrixPosition(world))
    for (const child of node.children ?? []) visit(child, world)
  }
  const scene = gltf.scenes?.[gltf.scene ?? 0]
  for (const index of scene?.nodes ?? []) visit(index, new THREE.Matrix4())
  return found
}

function materialsUnder(gltf: Gltf, name: string): string[] {
  const nodes = gltf.nodes ?? []
  const start = nodes.findIndex((node) => node.name === name)
  const found: string[] = []
  const visit = (index: number) => {
    const node = nodes[index]
    for (const primitive of gltf.meshes?.[node.mesh ?? -1]?.primitives ?? []) {
      const material = gltf.materials?.[primitive.material ?? -1]?.name
      if (material) found.push(material)
    }
    for (const child of node.children ?? []) visit(child)
  }
  if (start >= 0) visit(start)
  return found
}

function requiredNodes(id: string): string[] {
  const spec = file(`art/models/${id}/model.json`)
  if (!fs.existsSync(spec)) return []
  const { required } = JSON.parse(fs.readFileSync(spec, 'utf8')) as { required?: string[] }
  return required ?? []
}

function codeNodes(id: string): string[] {
  if (WEAPONS.includes(id)) return ['socket_muzzle']
  if (id.startsWith('chest-')) return ['lid']
  if (id === 'turret') return [...TURRET_NODES, ...ENEMY_JOINTS.turret]
  const rigged = RIGGED_NODES[id]
  if (rigged) return [...rigged]
  return drivenNodes(id)
}

describe('model contract', () => {
  it('has a runtime GLB for every registered model', () => {
    expect(MODEL_IDS.filter((id) => !fs.existsSync(new URL(`public/assets/models/${id}.glb`, ROOT)))).toEqual([])
  })

  for (const id of MODEL_IDS) {
    describe(id, () => {
      const nodes = positions(readGlb(id))

      it('has the nodes model.json requires and the nodes the code drives', () => {
        const wanted = [...new Set([...requiredNodes(id), ...codeNodes(id)])]
        expect(wanted.filter((name) => !nodes.has(name))).toEqual([])
      })

      const landmark = landmarkOf(id)
      const lamp = landmark ? lampRule(landmark) : undefined
      if (lamp) {
        it('keeps the lamp glass the code lights under the lamp node', () => {
          expect(materialsUnder(readGlb(id), lamp.node)).toContain(lamp.glass)
        })
      }

      if (WEAPONS.includes(id)) {
        it('points socket_muzzle along +X', () => {
          const muzzle = nodes.get('socket_muzzle')
          expect(muzzle?.x).toBeGreaterThan(0)
          expect(Math.abs(muzzle?.z ?? Infinity)).toBeLessThan(MUZZLE_SIDEWAYS)
        })
      }
    })
  }
})
