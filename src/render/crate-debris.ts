import * as THREE from 'three'
import { Tile } from '../sim/grid'
import type { World } from '../sim/world'
import { nodeMap, type ModelLibrary } from './model-library'
import { mergeJoints } from './node-parts'
import { crateLayers, crateTurn, debrisLaunches, debrisLife, debrisPose, type CrateLayer, type DebrisLaunch, type DebrisPiece } from './prop-motion'

interface Burst {
  root: THREE.Object3D
  pieces: THREE.Object3D[]
  launches: DebrisLaunch[]
  start: number
  life: number
}

export interface CrateDebris {
  sync(world: World): void
  reset(): void
}

const PIECE_NAME = /^piece_(\d+)$/

export function createCrateDebris(scene: THREE.Scene, models: ModelLibrary): CrateDebris {
  const available = models.has('crate-broken')
  const active: Burst[] = []
  const idle: Burst[] = []
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  let layout: DebrisPiece[] | null = null
  let tracked: World | null = null
  let standing = new Map<number, CrateLayer[]>()
  let template: THREE.Object3D | null = null

  function mergedPieces(): THREE.Object3D {
    const { root } = models.shared('crate-broken')
    mergeJoints(root, [...nodeMap(root).keys()].filter((name) => PIECE_NAME.test(name)))
    return root
  }

  function create(): Burst {
    template ??= mergedPieces()
    const root = template.clone(true)
    const pieces = [...nodeMap(root)]
      .filter(([name]) => PIECE_NAME.test(name))
      .sort(([a], [b]) => Number(PIECE_NAME.exec(a)?.[1]) - Number(PIECE_NAME.exec(b)?.[1]))
      .map(([, node]) => node)
    if (!layout) {
      root.updateWorldMatrix(true, true)
      const size = new THREE.Vector3()
      layout = pieces.map((piece) => {
        new THREE.Box3().setFromObject(piece).getSize(size)
        return { center: piece.position.clone(), rest: Math.min(size.x, size.y, size.z) / 2 }
      })
    }
    root.visible = false
    scene.add(root)
    return { root, pieces, launches: [], start: 0, life: 0 }
  }

  function retire(burst: Burst): void {
    burst.root.visible = false
    idle.push(burst)
  }

  function spawn(world: World, index: number, lift: number, layer: number): void {
    const burst = idle.pop() ?? create()
    if (!layout) {
      idle.push(burst)
      return
    }
    const column = index % world.grid.columns
    const row = (index - column) / world.grid.columns
    burst.root.position.set(column + 0.5, world.grid.floor[index], row + 0.5)
    burst.root.rotation.y = crateTurn(column, row) + layer
    const pieces = lift > 0 ? layout.map((piece) => ({ ...piece, center: piece.center.clone().setY(piece.center.y + lift) })) : layout
    burst.launches = debrisLaunches(pieces, index + layer * 31)
    burst.start = world.time
    burst.life = Math.max(...burst.launches.map(debrisLife))
    burst.root.visible = true
    active.push(burst)
  }

  function track(world: World): void {
    for (const burst of active.splice(0)) retire(burst)
    tracked = world
    standing = new Map()
    world.grid.tiles.forEach((tile, index) => {
      if (tile === Tile.Crate) standing.set(index, crateLayers(world.grid.top[index] - world.grid.floor[index]))
    })
  }

  return {
    sync(world) {
      if (!available) return
      if (world !== tracked) track(world)
      for (const [index, layers] of standing) {
        if (world.grid.tiles[index] === Tile.Crate) continue
        standing.delete(index)
        layers.forEach((layer, k) => spawn(world, index, layer.base, k))
      }
      for (let i = active.length - 1; i >= 0; i--) {
        const burst = active[i]
        const t = world.time - burst.start
        if (t >= burst.life || t < 0) {
          active.splice(i, 1)
          retire(burst)
          continue
        }
        burst.pieces.forEach((piece, k) => {
          const launch = burst.launches[k]
          if (!launch) return
          debrisPose(launch, t, position, quaternion)
          piece.position.copy(position)
          piece.quaternion.copy(quaternion)
        })
      }
    },
    reset() {
      for (const burst of active.splice(0)) retire(burst)
      tracked = null
      standing.clear()
    },
  }
}
