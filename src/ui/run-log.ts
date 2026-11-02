import { readJson, writeJson } from '../core/storage'
import type { World } from '../sim/world'
import { attackLabel } from './attack-names'

const LOG_KEY = 'isles-cartoon.runlog.v1'
const LOG_LIMIT = 40

export type RunResult = 'clear' | 'dead'

export interface RunLogEntry {
  at: string
  level: string
  result: RunResult
  playerLevel: number
  time: number
  area: string
  hits: number
  damageTaken: number
  accuracy: number
  ultimates: number
  killedBy: string
  taken: { source: string; damage: number; hits: number }[]
  areaTime: Record<string, number>
  critRate: number
  melees: number
  meleeHits: number
  smashes: number
  dashes: number
  jumps: number
  foodHealed: number
  packHealed: number
}

export function summarizeRun(
  world: World,
  result: RunResult,
  playerLevel: number,
): RunLogEntry {
  const { stats, tuning, level } = world
  const areaTime: Record<string, number> = {}
  stats.areaTime.forEach((seconds, index) => {
    if (seconds > 0) areaTime[level.areas[index]?.name ?? String(index)] = round(seconds)
  })
  return {
    at: new Date().toISOString(),
    level: level.def.id,
    result,
    playerLevel,
    time: round(stats.time),
    area: level.areas[world.areaIndex]?.name ?? '',
    hits: stats.hits,
    damageTaken: Math.round(stats.damageTaken),
    accuracy: stats.bulletsFired > 0 ? round(stats.bulletsHit / stats.bulletsFired, 2) : 0,
    ultimates: stats.ultimates,
    killedBy: stats.killedBy ? attackLabel(stats.killedBy, tuning.weapons) : '',
    taken: [...stats.taken]
      .sort((a, b) => b.damage - a.damage)
      .map((entry) => ({
        source: attackLabel(entry.attack, tuning.weapons),
        damage: Math.round(entry.damage),
        hits: entry.hits,
      })),
    areaTime,
    critRate: stats.bulletsHit > 0 ? round(stats.crits / stats.bulletsHit, 2) : 0,
    melees: stats.melees,
    meleeHits: stats.meleeHits,
    smashes: stats.smashes,
    dashes: stats.dashes,
    jumps: stats.jumps,
    foodHealed: Math.round(stats.foodHealed),
    packHealed: Math.round(stats.packHealed),
  }
}

export function readRunLog(): RunLogEntry[] {
  const raw = readJson(LOG_KEY)
  return Array.isArray(raw) ? (raw as RunLogEntry[]) : []
}

export function appendRunLog(entry: RunLogEntry): void {
  writeJson(LOG_KEY, [...readRunLog(), entry].slice(-LOG_LIMIT))
}

function round(value: number, digits = 1): number {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}
