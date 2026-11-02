import * as THREE from 'three'
import { lerp } from '../sim/math'
import { radarTarget } from '../sim/radar'
import type { World } from '../sim/world'
import { easeAngle } from './tank-motion'
import { RADAR_ARROW } from './themes'

export interface RadarView {
  sync(world: World, alpha: number, dt: number): void
  reset(): void
}

export function arrowShape(size: number): THREE.Shape {
  const shape = new THREE.Shape()
  shape.moveTo(size, 0)
  shape.lineTo(-size * 0.55, size * 0.62)
  shape.lineTo(-size * 0.22, 0)
  shape.lineTo(-size * 0.55, -size * 0.62)
  shape.closePath()
  return shape
}

export function radarHeading(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return Math.atan2(to.y - from.y, to.x - from.x)
}

export function createRadarView(scene: THREE.Scene): RadarView {
  const R = RADAR_ARROW
  const group = new THREE.Group()
  const material = new THREE.MeshBasicMaterial({ color: R.color, transparent: true, opacity: 0, depthWrite: false, depthTest: false, side: THREE.DoubleSide })
  const arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape(R.size)), material)
  arrow.rotation.x = -Math.PI / 2
  arrow.position.set(R.radius, 0, 0)
  const trail = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape(R.size * 0.62)), material)
  trail.rotation.x = -Math.PI / 2
  trail.position.set(R.radius - R.size * 0.95, 0, 0)
  arrow.renderOrder = 6
  trail.renderOrder = 6
  const pivot = new THREE.Group()
  pivot.add(arrow, trail)
  pivot.position.y = R.height
  group.add(pivot)
  group.visible = false
  scene.add(group)
  let heading: number | null = null
  let clock = 0
  let shown = 0

  return {
    sync(world, alpha, dt) {
      clock += dt
      const { player } = world
      const target = player.alive && world.status === 'playing' ? radarTarget(world) : null
      shown = Math.max(0, Math.min(1, shown + (target ? dt : -dt) * 4))
      group.visible = shown > 0
      if (!group.visible) {
        heading = null
        return
      }
      const x = lerp(player.prev.x, player.pos.x, alpha)
      const y = lerp(player.prev.y, player.pos.y, alpha)
      group.position.set(x, 0, y)
      if (target) {
        const goal = radarHeading({ x, y }, target)
        heading = heading === null ? goal : easeAngle(heading, goal, R.turn, dt)
      }
      pivot.rotation.y = -(heading ?? 0)
      const pulse = 0.5 + 0.5 * Math.sin(clock * R.rate * Math.PI * 2)
      material.opacity = R.opacity * shown * (1 - R.pulse + R.pulse * pulse)
      arrow.position.x = R.radius + R.ring * pulse
      trail.position.x = R.radius - R.size * 0.95 + R.ring * pulse * 0.6
    },
    reset() {
      heading = null
      shown = 0
      group.visible = false
    },
  }
}
