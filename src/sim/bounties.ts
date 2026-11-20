import { getBoss } from '../data/bosses'
import { BOUNTIES, BOUNTY, BOUNTY_ORDER, type BountyId, type BountyNeed } from '../data/bounties'
import type { MinionKind } from '../data/enemies'
import { SPECIAL_WEAPONS } from '../data/weapons'
import type { BuiltLevel } from './level'
import { createRng } from './rng'
import type { GameEvent } from './types'
import type { World } from './world'

export interface BountyRun {
  id: BountyId
  count: number
  goal: number
  done: boolean
  failed: boolean
}

export interface AreaClock {
  entered: number
  cleared: boolean
  limit: number
}

export function levelKinds(level: BuiltLevel): Set<MinionKind> {
  const kinds = new Set<MinionKind>(level.enemies.map((enemy) => enemy.kind))
  for (const rush of level.rushes) for (const recipe of rush.variants) for (const squad of recipe) kinds.add(squad.kind)
  if (level.boss) {
    const def = getBoss(level.boss.id)
    for (const squad of def.summon) kinds.add(squad.kind)
    for (const phase of def.phases) if (phase.summon) kinds.add(phase.summon.kind)
  }
  return kinds
}

function meets(level: BuiltLevel, need: BountyNeed, varied: boolean): boolean {
  const kinds = levelKinds(level)
  switch (need) {
    case 'always':
      return true
    case 'friendly':
      return kinds.has('bomber') || kinds.has('thrower')
    case 'bombers':
      return kinds.has('bomber')
    case 'rushes':
      return level.rushes.length > 0
    case 'kegs':
      return level.kegs.length > 0
    case 'elites':
      return varied || level.enemies.some((enemy) => enemy.affixes.length > 0)
    case 'courier':
      return false
    case 'pens':
      return level.landmarks.some((placement) => placement.gate !== null)
  }
}

export function bountyPool(level: BuiltLevel, varied: boolean): BountyId[] {
  return BOUNTY_ORDER.filter((id) => meets(level, BOUNTIES[id].need, varied))
}

export function drawBoard(level: BuiltLevel, varied: boolean, seed: number): BountyId[] {
  const pool = bountyPool(level, varied)
  const rng = createRng(seed)
  const board: BountyId[] = []
  while (board.length < BOUNTY.board && pool.length > 0) board.push(pool.splice(rng.int(pool.length), 1)[0])
  return BOUNTY_ORDER.filter((id) => board.includes(id))
}

export function createBountyRuns(ids: readonly BountyId[]): BountyRun[] {
  return ids.map((id) => ({ id, count: 0, goal: BOUNTIES[id].goal, done: false, failed: false }))
}

export function addBounty(world: World, id: BountyId): void {
  if (world.bounties.some((item) => item.id === id)) return
  world.bounties.push(...createBountyRuns([id]))
}

export function areaLimit(level: BuiltLevel, area: number): number {
  const standing = level.enemies.filter((enemy) => enemy.area === area).length
  const rushing = level.rushes.filter((rush) => rush.area === area).reduce((sum, rush) => sum + rush.enemies.reduce((total, squad) => total + squad.count, 0), 0)
  return standing + rushing > 0 ? BOUNTY.speedBase + BOUNTY.speedPerEnemy * (standing + rushing) : 0
}

export function updateBounties(world: World, events: readonly GameEvent[]): void {
  if (world.bounties.length === 0) return
  for (const event of events) note(world, event)
  timeAreas(world)
  countPens(world)
  if (world.status === 'complete') {
    for (const bounty of world.bounties) if (BOUNTIES[bounty.id].hold && !bounty.failed) bump(world, bounty.id, bounty.goal)
  }
}

function bump(world: World, id: BountyId, amount = 1): void {
  const bounty = world.bounties.find((item) => item.id === id)
  if (!bounty || bounty.done || bounty.failed) return
  bounty.count = Math.min(bounty.goal, bounty.count + amount)
  if (bounty.count < bounty.goal) return
  bounty.done = true
  world.events.push({ type: 'bountyDone', id })
}

export function failBounty(world: World, id: BountyId): void {
  const bounty = world.bounties.find((item) => item.id === id)
  if (!bounty || bounty.done || bounty.failed) return
  bounty.failed = true
  world.events.push({ type: 'bountyFailed', id })
}

function note(world: World, event: GameEvent): void {
  switch (event.type) {
    case 'enemyKilled':
      if (event.kind === 'boss') return
      if (event.cause === 'friendly' || event.cause === 'fall') bump(world, 'friendly')
      if (event.cause === 'sneak') bump(world, 'sneak')
      if (event.cause === 'keg') bump(world, 'kegs')
      if (event.crit) bump(world, 'crits')
      if (event.fuse) bump(world, 'defuse')
      if (event.elite) bump(world, 'elite')
      if ((event.streak ?? 0) >= BOUNTY.streak) bump(world, 'streak')
      if (!world.player.grounded) bump(world, 'airborne')
      return
    case 'smashed':
      bump(world, 'smash')
      return
    case 'shot':
      if ((SPECIAL_WEAPONS as readonly string[]).includes(event.weapon)) failBounty(world, 'thrifty')
      return
    case 'courierCaught':
      bump(world, 'courier')
      return
    case 'blast':
      if (world.sheep.some((sheep) => Math.hypot(sheep.pos.x - event.x, sheep.pos.y - event.y) <= event.radius + BOUNTY.sheepMargin)) failBounty(world, 'shepherd')
      return
  }
}

function timeAreas(world: World): void {
  if (!world.bounties.some((item) => item.id === 'speed' && !item.done)) return
  const index = world.areaIndex
  let clock = world.areaClocks[index]
  if (!clock) {
    clock = { entered: world.time, cleared: false, limit: areaLimit(world.level, index) }
    world.areaClocks[index] = clock
  }
  if (clock.cleared || clock.limit <= 0) return
  const standing = world.enemies.some((enemy) => enemy.area === index && enemy.hp > 0 && !enemy.summoned && enemy.kind !== 'boss')
  const coming = world.spawns.some((marker) => marker.area === index) || world.level.rushes.some((rush, at) => rush.area === index && !world.rushed[at])
  if (standing || coming) return
  clock.cleared = true
  if (world.time - clock.entered <= clock.limit) bump(world, 'speed')
}

function countPens(world: World): void {
  if (!world.bounties.some((item) => item.id === 'pens' && !item.done)) return
  const pens = world.level.landmarks.map((placement, index) => (placement.gate ? world.landmarks[index] : null)).filter((state) => state !== null)
  if (pens.length > 0 && pens.every((state) => state.open)) bump(world, 'pens')
}
