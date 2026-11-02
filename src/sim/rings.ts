import { damagePlayer } from './combat'
import type { Attack, Ring } from './types'
import type { World } from './world'

export interface RingSpec {
  x: number
  y: number
  z: number
  maxRadius: number
  speed: number
  height: number
  damage: number
  knockback: number
  attack: Attack | null
}

export function spawnRing(world: World, spec: RingSpec): Ring {
  const ring: Ring = { id: world.nextId++, ...spec, radius: 0, prevRadius: 0, hitPlayer: false }
  world.rings.push(ring)
  world.events.push({ type: 'ringStarted', id: ring.id, x: ring.x, y: ring.y })
  return ring
}

export function updateRings(world: World, dt: number): void {
  if (world.rings.length === 0) return
  let kept = 0
  for (const ring of world.rings) {
    ring.prevRadius = ring.radius
    ring.radius = Math.min(ring.maxRadius, ring.radius + ring.speed * dt)
    if (!ring.hitPlayer) sweep(world, ring)
    if (ring.prevRadius < ring.maxRadius) world.rings[kept++] = ring
  }
  world.rings.length = kept
}

function sweep(world: World, ring: Ring): void {
  const { player } = world
  if (!player.alive || world.status !== 'playing') return
  const dx = player.pos.x - ring.x
  const dy = player.pos.y - ring.y
  const distance = Math.hypot(dx, dy)
  if (ring.radius < distance - player.radius || ring.prevRadius > distance + player.radius) return
  if (player.z - ring.z >= ring.height) return
  ring.hitPlayer = true
  if (player.invulnerable > 0) {
    world.events.push({ type: 'dodged', x: player.pos.x, y: player.pos.y })
    return
  }
  const length = distance > 1e-6 ? distance : 1
  damagePlayer(world, ring.damage, dx / length, distance > 1e-6 ? dy / length : 1, ring.knockback, ring.attack, { x: ring.x, y: ring.y })
}
