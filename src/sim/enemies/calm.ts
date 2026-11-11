import { segmentClear } from '../collision'
import { blocksMovement, tileAt } from '../grid'
import type { Vec2 } from '../math'
import { directionTo } from '../navigation'
import type { Enemy } from '../types'
import type { World } from '../world'
import { still } from './kit'
import { stationary } from './registry'

const ARRIVED = 0.45

export function calm(world: World, enemy: Enemy, dt: number): Vec2 {
  const { perception } = world.tuning
  switch (enemy.alert) {
    case 'suspicious':
      return investigate(world, enemy, dt, perception.suspicionTime, perception.suspiciousSpeed)
    case 'search':
      return investigate(world, enemy, dt, perception.searchTime, perception.searchSpeed)
    case 'return':
      return goHome(world, enemy)
    case 'combat':
    case 'idle':
      return idle(world, enemy, dt)
  }
}

function idle(world: World, enemy: Enemy, dt: number): Vec2 {
  const { perception } = world.tuning
  switch (enemy.idleMode) {
    case 'patrol': {
      const target = enemy.route[enemy.routeIndex]
      if (!target) return still()
      if (distanceTo(enemy, target) > ARRIVED) return walk(world, enemy, target, perception.patrolSpeed)
      enemy.wanderWait += dt
      if (enemy.wanderWait >= perception.patrolPause) {
        enemy.wanderWait = 0
        enemy.routeIndex = (enemy.routeIndex + 1) % enemy.route.length
      }
      return still()
    }
    case 'wander': {
      if (enemy.wanderTarget && distanceTo(enemy, enemy.wanderTarget) > ARRIVED) {
        return walk(world, enemy, enemy.wanderTarget, perception.patrolSpeed * perception.wanderSpeed)
      }
      enemy.wanderTarget = null
      enemy.wanderWait -= dt
      if (enemy.wanderWait <= 0) {
        enemy.wanderWait = world.rng.range(perception.wanderWaitMin, perception.wanderWaitMax)
        enemy.wanderTarget = pickWanderSpot(world, enemy)
      }
      return still()
    }
    case 'ambush':
      return still()
    case 'guard': {
      if (distanceTo(enemy, enemy.home) > ARRIVED && !stationary(enemy)) {
        return walk(world, enemy, enemy.home, perception.patrolSpeed)
      }
      const sweep = (perception.sweepDeg * Math.PI) / 180
      enemy.facing = enemy.baseFacing + Math.sin((world.time * Math.PI * 2) / perception.sweepPeriod + enemy.id) * sweep
      return still()
    }
  }
}

function investigate(world: World, enemy: Enemy, dt: number, lookFor: number, speed: number): Vec2 {
  const { perception } = world.tuning
  enemy.alertTime += dt
  if (enemy.lookTime >= lookFor || enemy.alertTime >= perception.investigateCap) {
    enemy.alert = 'return'
    enemy.alertTime = 0
    enemy.lookTime = 0
    return still()
  }
  const fixed = stationary(enemy)
  if (!fixed && distanceTo(enemy, enemy.lastSeen) > ARRIVED * 2) {
    const move = walk(world, enemy, enemy.lastSeen, speed)
    if (move.x !== 0 || move.y !== 0) return move
  }
  if (fixed) enemy.facing = Math.atan2(enemy.lastSeen.y - enemy.pos.y, enemy.lastSeen.x - enemy.pos.x)
  else enemy.facing += perception.lookSpeed * dt
  enemy.lookTime += dt
  return still()
}

function goHome(world: World, enemy: Enemy): Vec2 {
  const target = enemy.idleMode === 'patrol' ? nearestRoutePoint(enemy) : enemy.home
  if (stationary(enemy) || distanceTo(enemy, target) <= ARRIVED) {
    enemy.alert = 'idle'
    enemy.leashed = false
    enemy.facing = enemy.baseFacing
    enemy.wanderWait = 0
    return still()
  }
  if (enemy.leashed && distanceTo(enemy, enemy.home) < world.tuning.perception.leash / 2) enemy.leashed = false
  const { perception } = world.tuning
  return walk(world, enemy, target, perception.patrolSpeed * perception.returnSpeed)
}

function nearestRoutePoint(enemy: Enemy): Vec2 {
  let best = enemy.route[0] ?? enemy.home
  let bestIndex = 0
  enemy.route.forEach((point, index) => {
    if (distanceTo(enemy, point) < distanceTo(enemy, best)) {
      best = point
      bestIndex = index
    }
  })
  enemy.routeIndex = bestIndex
  return best
}

function pickWanderSpot(world: World, enemy: Enemy): Vec2 | null {
  const { wanderRadius: radius, wanderMinShare } = world.tuning.perception
  for (let attempt = 0; attempt < 6; attempt++) {
    const angle = world.rng.range(0, Math.PI * 2)
    const distance = world.rng.range(radius * wanderMinShare, radius)
    const spot = { x: enemy.home.x + Math.cos(angle) * distance, y: enemy.home.y + Math.sin(angle) * distance }
    if (blocksMovement(tileAt(world.grid, Math.floor(spot.x), Math.floor(spot.y)))) continue
    if (!segmentClear(world.grid, enemy.home, spot, blocksMovement)) continue
    return spot
  }
  return null
}

export function moveTo(world: World, enemy: Enemy, target: Vec2, share: number): Vec2 {
  return walk(world, enemy, target, share)
}

function walk(world: World, enemy: Enemy, target: Vec2, share: number): Vec2 {
  const speed = speedOf(world, enemy) * share
  if (speed <= 0) return still()
  const direction = directionTo(world, enemy.pos, enemy.radius, target)
  if (!direction) return still()
  enemy.facing = Math.atan2(direction.y, direction.x)
  return { x: direction.x * speed, y: direction.y * speed }
}

function speedOf(world: World, enemy: Enemy): number {
  switch (enemy.kind) {
    case 'turret':
    case 'boss':
      return 0
    default:
      return world.tuning[enemy.kind].speed
  }
}

export function distanceTo(enemy: Enemy, point: Vec2): number {
  return Math.hypot(point.x - enemy.pos.x, point.y - enemy.pos.y)
}
