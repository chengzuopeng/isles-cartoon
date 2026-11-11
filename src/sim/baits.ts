import { BAIT, type BaitRank } from '../data/skills'
import { spawnBlast } from './combat'
import { interruptEnemy } from './enemies'
import { floorAt } from './grid'
import { distanceTo, moveTo } from './enemies/calm'
import type { Vec2 } from './math'
import type { Enemy } from './types'
import type { World } from './world'

export interface Bait {
  id: number
  pos: Vec2
  z: number
  from: Vec2
  flight: number
  total: number
  left: number
  lure: number
  radius: number
  burstRadius: number
  burstDamage: number
}

export function throwBaits(world: World, rank: BaitRank, target: Vec2, yaw: number): void {
  const { player } = world
  const sideX = -Math.sin(yaw)
  const sideY = Math.cos(yaw)
  for (let i = 0; i < rank.count; i++) {
    const offset = (i - (rank.count - 1) / 2) * rank.spacing
    const pos = { x: target.x + sideX * offset, y: target.y + sideY * offset }
    world.baits.push({
      id: world.nextId++,
      pos,
      z: floorAt(world.grid, pos.x, pos.y),
      from: { x: player.pos.x, y: player.pos.y },
      flight: rank.flight,
      total: rank.flight,
      left: rank.lure,
      lure: rank.lure,
      radius: rank.radius,
      burstRadius: rank.burstRadius,
      burstDamage: rank.burstDamage * world.playerStats.damage,
    })
  }
  world.events.push({ type: 'baitThrown', x: target.x, y: target.y, count: rank.count })
}

export function updateBaits(world: World, dt: number): void {
  if (world.baits.length === 0) return
  const kept: Bait[] = []
  for (const bait of world.baits) {
    if (bait.flight > 0) {
      bait.flight -= dt
      if (bait.flight <= 0) land(world, bait)
      kept.push(bait)
      continue
    }
    bait.left -= dt
    if (bait.left > 0) kept.push(bait)
    else release(world, bait)
  }
  world.baits = kept
}

function land(world: World, bait: Bait): void {
  world.events.push({ type: 'baitLanded', x: bait.pos.x, y: bait.pos.y, z: bait.z })
  for (const enemy of world.enemies) {
    if (enemy.hp <= 0 || enemy.kind === 'boss' || enemy.kind === 'turret' || enemy.state === 'arming') continue
    if (distanceTo(enemy, bait.pos) > bait.radius) continue
    const lure = bait.lure * (enemy.elite ? BAIT.eliteShare : 1)
    const current = world.baits.find((item) => item.id === enemy.lure)
    if (current && distanceTo(enemy, current.pos) <= distanceTo(enemy, bait.pos)) continue
    interruptEnemy(world, enemy)
    enemy.lure = bait.id
    enemy.lureLeft = lure
  }
}

function release(world: World, bait: Bait): void {
  for (const enemy of world.enemies) {
    if (enemy.lure !== bait.id) continue
    enemy.lure = 0
    enemy.lureLeft = 0
  }
}

export function lured(world: World, enemy: Enemy, dt: number): Vec2 | null {
  if (enemy.lureLeft <= 0) return null
  const bait = world.baits.find((item) => item.id === enemy.lure)
  enemy.lureLeft -= dt
  if (!bait || enemy.lureLeft <= 0) {
    enemy.lure = 0
    enemy.lureLeft = 0
    return null
  }
  if (distanceTo(enemy, bait.pos) > BAIT.reach + enemy.radius) return moveTo(world, enemy, bait.pos, 1)
  if (bait.burstRadius > 0) {
    spawnBlast(world, {
      x: bait.pos.x,
      y: bait.pos.y,
      z: bait.z,
      radius: bait.burstRadius,
      delay: 0,
      playerDamage: 0,
      enemyDamage: bait.burstDamage,
      source: 'player',
      ownerId: 0,
      skill: 'bait',
    })
    world.events.push({ type: 'baitEaten', x: bait.pos.x, y: bait.pos.y, z: bait.z, burst: true })
    world.baits = world.baits.filter((item) => item !== bait)
    release(world, bait)
    return { x: 0, y: 0 }
  }
  enemy.facing = Math.atan2(bait.pos.y - enemy.pos.y, bait.pos.x - enemy.pos.x)
  return { x: 0, y: 0 }
}

export function wake(enemy: Enemy): void {
  enemy.lure = 0
  enemy.lureLeft = 0
}
