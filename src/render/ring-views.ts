import * as THREE from 'three'
import { lerp } from '../sim/math'
import type { Ring } from '../sim/types'
import type { World } from '../sim/world'
import { INK_COLOR } from './toon'

export interface RingViews {
  sync(world: World, alpha: number): void
  reset(): void
}

interface RingView {
  root: THREE.Group
  wall: THREE.Mesh
  crest: THREE.Mesh
  floor: THREE.Mesh
  seen: boolean
}

const WALL_COLOR = new THREE.Color('#ff7a3d').multiplyScalar(1.6)
const FLOOR_COLOR = new THREE.Color('#ff3b30')

export function createRingViews(scene: THREE.Scene): RingViews {
  const wallGeometry = new THREE.CylinderGeometry(1, 1, 1, 72, 1, true)
  wallGeometry.translate(0, 0.5, 0)
  const crestGeometry = new THREE.TorusGeometry(1, 0.035, 6, 72)
  crestGeometry.rotateX(Math.PI / 2)
  const floorGeometry = new THREE.RingGeometry(0.92, 1, 72)
  floorGeometry.rotateX(-Math.PI / 2)
  const wallMaterial = new THREE.MeshBasicMaterial({ color: WALL_COLOR, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false })
  const crestMaterial = new THREE.MeshBasicMaterial({ color: INK_COLOR })
  const floorMaterial = new THREE.MeshBasicMaterial({ color: FLOOR_COLOR, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide })
  const views = new Map<number, RingView>()

  const build = (): RingView => {
    const root = new THREE.Group()
    const wall = new THREE.Mesh(wallGeometry, wallMaterial)
    const crest = new THREE.Mesh(crestGeometry, crestMaterial)
    const floor = new THREE.Mesh(floorGeometry, floorMaterial)
    wall.userData.noInk = true
    floor.userData.noInk = true
    root.add(wall, crest, floor)
    scene.add(root)
    return { root, wall, crest, floor, seen: true }
  }

  const place = (view: RingView, ring: Ring, alpha: number) => {
    const radius = Math.max(0.05, lerp(ring.prevRadius, ring.radius, alpha))
    const fade = 1 - Math.max(0, (radius - ring.maxRadius * 0.8) / (ring.maxRadius * 0.2))
    view.root.position.set(ring.x, ring.z, ring.y)
    view.wall.scale.set(radius, ring.height, radius)
    view.crest.scale.set(radius, 1, radius)
    view.crest.position.y = ring.height
    view.floor.scale.set(radius, 1, radius)
    view.floor.position.y = 0.04
    view.root.visible = fade > 0.02
  }

  return {
    sync(world, alpha) {
      for (const view of views.values()) view.seen = false
      for (const ring of world.rings) {
        let view = views.get(ring.id)
        if (!view) {
          view = build()
          views.set(ring.id, view)
        }
        view.seen = true
        place(view, ring, alpha)
      }
      for (const [id, view] of views) {
        if (view.seen) continue
        scene.remove(view.root)
        views.delete(id)
      }
    },
    reset() {
      for (const view of views.values()) scene.remove(view.root)
      views.clear()
    },
  }
}
