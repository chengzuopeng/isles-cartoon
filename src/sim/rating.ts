import type { ChallengeId } from '../data/challenges'
import type { BuiltLevel } from './level'
import type { World } from './world'

export interface ChallengeResult {
  id: ChallengeId
  done: boolean
}

export interface RunRating {
  stars: number
  cleared: boolean
  inTime: boolean
  fewHits: boolean
  time: number
  parSeconds: number
  kills: number
  hits: number
  maxHits: number
  challenges: ChallengeResult[]
}

export function rateRun(world: World): RunRating {
  const { stats, level, status } = world
  const cleared = status === 'complete'
  const inTime = cleared && stats.time <= level.def.parSeconds
  const fewHits = cleared && stats.hits <= level.def.maxHits
  return {
    stars: Number(cleared) + Number(inTime) + Number(fewHits),
    cleared,
    inTime,
    fewHits,
    time: stats.time,
    parSeconds: level.def.parSeconds,
    kills: stats.kills,
    hits: stats.hits,
    maxHits: level.def.maxHits,
    challenges: challengesOf(world),
  }
}

export function levelChallenges(level: BuiltLevel): ChallengeId[] {
  const ids: ChallengeId[] = ['flawless']
  if (level.enemies.length > 0) ids.push('sweep')
  if (level.secrets.length > 0) ids.push('secret')
  if (level.alarms.length > 0) ids.push('stealth')
  if (level.lamps.length > 0) ids.push('lamps')
  return ids
}

export function challengeTotal(level: BuiltLevel): number {
  return levelChallenges(level).length
}

export function challengesOf(world: World): ChallengeResult[] {
  const cleared = world.status === 'complete'
  const done: Readonly<Record<ChallengeId, () => boolean>> = {
    flawless: () => world.stats.hits === 0,
    sweep: () => !world.enemies.some((enemy) => enemy.hp > 0 && !enemy.summoned && enemy.kind !== 'boss'),
    secret: () => world.secrets.every(Boolean),
    stealth: () => world.alarms.every((alarm) => alarm.status !== 'rung'),
    lamps: () => world.lamps.every(Boolean),
  }
  return levelChallenges(world.level).map((id) => ({ id, done: cleared && done[id]() }))
}
