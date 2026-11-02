import { BLADE } from '../data/blades'
import { hazardAttack } from './attacks'
import { damageEnemy, damagePlayer } from './combat'
import type { BladeLane, BuiltLevel } from './level'
import { clamp, type Vec2 } from './math'
import type { BladeState } from './types'
import type { World } from './world'

const MAX_PHASES_PER_STEP = 4
const MAX_FORECAST_PHASES = 8

export interface BladeForecast {
  along: number
  sweeping: boolean
}

export function createBladeStates(level: BuiltLevel): BladeState[] {
  return level.blades.map((lane) => ({
    pos: { x: lane.from.x, y: lane.from.y },
    prev: { x: lane.from.x, y: lane.from.y },
    facing: Math.atan2(lane.to.y - lane.from.y, lane.to.x - lane.from.x),
    phase: 'rest',
    timer: lane.delay + lane.rest - lane.warning,
    warning: 0,
    forward: true,
    hits: new Map(),
  }))
}

export function alongOf(lane: BladeLane, pos: Vec2): number {
  return lane.axis === 'x' ? pos.x : pos.y
}

export function acrossOf(lane: BladeLane, pos: Vec2): number {
  return lane.axis === 'x' ? pos.y : pos.x
}

export function laneMiddle(lane: BladeLane): number {
  return acrossOf(lane, lane.from)
}

export function laneEnds(lane: BladeLane): [number, number] {
  const a = alongOf(lane, lane.from)
  const b = alongOf(lane, lane.to)
  return a < b ? [a, b] : [b, a]
}

export function bladeOverlaps(lane: BladeLane, from: number, to: number, pos: Vec2, radius: number): boolean {
  const low = Math.min(from, to) - lane.reach
  const high = Math.max(from, to) + lane.reach
  const middle = laneMiddle(lane)
  const along = alongOf(lane, pos)
  const across = acrossOf(lane, pos)
  const da = along - clamp(along, low, high)
  const dc = across - clamp(across, middle - lane.half, middle + lane.half)
  return da * da + dc * dc < radius * radius
}

export function forecastBlade(lane: BladeLane, blade: BladeState, seconds: number): BladeForecast {
  let along = alongOf(lane, blade.pos)
  let phase = blade.phase
  let timer = blade.timer
  let forward = blade.forward
  let left = Math.max(0, seconds)
  for (let guard = 0; guard < MAX_FORECAST_PHASES; guard++) {
    if (phase !== 'sweep') {
      const wait = phase === 'rest' ? timer + lane.warning : timer
      if (left <= wait) return { along, sweeping: false }
      left -= wait
      phase = 'sweep'
      continue
    }
    const end = alongOf(lane, forward ? lane.to : lane.from)
    const travel = Math.abs(end - along) / lane.speed
    if (left <= travel) return { along: along + Math.sign(end - along) * left * lane.speed, sweeping: true }
    left -= travel
    along = end
    forward = !forward
    phase = 'rest'
    timer = lane.rest - lane.warning
  }
  return { along, sweeping: false }
}

export function updateBlades(world: World, dt: number): void {
  const { level } = world
  for (let index = 0; index < level.blades.length; index++) {
    const lane = level.blades[index]
    const blade = world.blades[index]
    blade.prev.x = blade.pos.x
    blade.prev.y = blade.pos.y
    advance(world, index, lane, blade, dt)
    blade.warning = blade.phase === 'warning' ? blade.timer : 0
    const from = alongOf(lane, blade.prev)
    const to = alongOf(lane, blade.pos)
    if (from !== to) strike(world, index, lane, blade, from, to)
  }
}

function advance(world: World, index: number, lane: BladeLane, blade: BladeState, dt: number): void {
  let left = dt
  for (let guard = 0; guard < MAX_PHASES_PER_STEP && left > 0; guard++) {
    if (blade.phase === 'rest' || blade.phase === 'warning') {
      if (blade.timer > left) {
        blade.timer -= left
        return
      }
      left -= blade.timer
      if (blade.phase === 'rest') {
        blade.phase = 'warning'
        blade.timer = lane.warning
        world.events.push({ type: 'bladeWarning', index, x: blade.pos.x, y: blade.pos.y, angle: blade.facing, seconds: lane.warning })
      } else {
        blade.phase = 'sweep'
        blade.timer = 0
        world.events.push({ type: 'bladeSweep', index, x: blade.pos.x, y: blade.pos.y, angle: blade.facing })
      }
      continue
    }
    const end = blade.forward ? lane.to : lane.from
    const gap = Math.hypot(end.x - blade.pos.x, end.y - blade.pos.y)
    const travel = lane.speed * left
    if (travel < gap) {
      blade.pos.x += ((end.x - blade.pos.x) / gap) * travel
      blade.pos.y += ((end.y - blade.pos.y) / gap) * travel
      return
    }
    blade.pos.x = end.x
    blade.pos.y = end.y
    left -= gap / lane.speed
    blade.forward = !blade.forward
    const next = blade.forward ? lane.to : lane.from
    blade.facing = Math.atan2(next.y - blade.pos.y, next.x - blade.pos.x)
    blade.phase = 'rest'
    blade.timer = lane.rest - lane.warning
    world.events.push({ type: 'bladeParked', index, x: blade.pos.x, y: blade.pos.y })
  }
}

function strike(world: World, index: number, lane: BladeLane, blade: BladeState, from: number, to: number): void {
  const { player } = world
  if (player.alive && bladeOverlaps(lane, from, to, player.pos, player.radius) && ready(world, blade, player.id)) {
    const out = outward(lane, player.pos)
    world.events.push({ type: 'bladeHit', index, id: player.id, x: player.pos.x, y: player.pos.y, damage: BLADE.damage })
    damagePlayer(world, BLADE.damage, out.x, out.y, BLADE.knockback, hazardAttack('blade'))
  }
  for (const enemy of [...world.enemies]) {
    if (enemy.hp <= 0 || enemy.kind === 'boss') continue
    if (!bladeOverlaps(lane, from, to, enemy.pos, enemy.radius) || !ready(world, blade, enemy.id)) continue
    const out = outward(lane, enemy.pos)
    world.events.push({ type: 'bladeHit', index, id: enemy.id, x: enemy.pos.x, y: enemy.pos.y, damage: BLADE.damage })
    damageEnemy(world, enemy, BLADE.damage, out.x, out.y, BLADE.knockback)
  }
}

function ready(world: World, blade: BladeState, id: number): boolean {
  const last = blade.hits.get(id)
  if (last !== undefined && world.time - last < BLADE.cooldown) return false
  blade.hits.set(id, world.time)
  return true
}

function outward(lane: BladeLane, pos: Vec2): Vec2 {
  const side = acrossOf(lane, pos) < laneMiddle(lane) ? -1 : 1
  return lane.axis === 'x' ? { x: 0, y: side } : { x: side, y: 0 }
}
