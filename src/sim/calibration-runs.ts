import { AUTOPILOT_SKILLS, AUTOPILOT_SKILL_ORDER, type AutopilotSkillId } from '../data/autopilot'
import { LEVEL_1_3 } from '../data/levels/level-1-3'
import { LEVEL_1_4 } from '../data/levels/level-1-4'
import { LEVEL_1_5 } from '../data/levels/level-1-5'
import type { DifficultyId } from '../data/difficulty'
import type { LevelDef } from '../data/levels/types'
import { createDefaultTuning } from '../data/tuning'
import { attackLabel } from '../ui/attack-names'
import { createAutopilot } from './autopilot'
import { raiseAlarms } from './cheats'
import { buildLevel, type BuiltLevel } from './level'
import { stepWorld } from './step'
import { createLoadout, type Loadout } from './stats'
import { createWorld, type World } from './world'

export const DT = 1 / 60
export const LIMIT_SECONDS = 15 * 60
export const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const WEAPONS = createDefaultTuning().weapons

export interface Run {
  skill: AutopilotSkillId
  seed: number
  status: string
  area: string
  time: number
  hits: number
  taken: number
  accuracy: number
  ultimates: number
  crits: number
  smashes: number
  food: number
  dashes: number
  jumps: number
  killedBy: string
  worst: string
  slowest: string
}

function report(world: World, level: BuiltLevel, skill: AutopilotSkillId, seed: number): Run {
  const { stats } = world
  const worst = [...stats.taken].sort((a, b) => b.damage - a.damage)[0]
  const slowestIndex = stats.areaTime.reduce((best, time, index) => (time > (stats.areaTime[best] ?? 0) ? index : best), 0)
  return {
    skill,
    seed,
    status: world.status,
    area: level.areas[world.areaIndex]?.name ?? '',
    time: Math.round(stats.time),
    hits: stats.hits,
    taken: Math.round(stats.damageTaken),
    accuracy: stats.bulletsFired > 0 ? stats.bulletsHit / stats.bulletsFired : 0,
    ultimates: stats.ultimates,
    crits: stats.bulletsHit > 0 ? stats.crits / stats.bulletsHit : 0,
    smashes: stats.smashes,
    food: Math.round(stats.foodHealed),
    dashes: stats.dashes,
    jumps: stats.jumps,
    killedBy: stats.killedBy ? attackLabel(stats.killedBy, WEAPONS) : '',
    worst: worst ? `${attackLabel(worst.attack, WEAPONS)} ${Math.round((worst.damage / stats.damageTaken) * 100)}%` : '',
    slowest: `${level.areas[slowestIndex]?.name ?? ''} ${Math.round(stats.areaTime[slowestIndex] ?? 0)}s`,
  }
}

export interface PlayExtras {
  rareEvents?: boolean
  replay?: boolean
  chapter1Cleared?: boolean
  varied?: boolean
}

export function play(def: LevelDef, skill: AutopilotSkillId, seed: number, loadout: Loadout, extras: PlayExtras = {}): Run {
  const level = buildLevel(def)
  const world = createWorld(level, createDefaultTuning(), {
    seed,
    loadout,
    rareEvents: extras.rareEvents ?? true,
    replay: extras.replay ?? false,
    chapter1Cleared: extras.chapter1Cleared ?? false,
    varied: extras.varied ?? false,
  })
  const pilot = createAutopilot({ skill, seed })
  for (let step = 0; step < LIMIT_SECONDS / DT && world.status === 'playing'; step++) {
    stepWorld(world, pilot.next(world), DT)
    world.events.length = 0
  }
  return report(world, level, skill, seed)
}

export function summarize(runs: Run[]) {
  return AUTOPILOT_SKILL_ORDER.map((skill) => {
    const mine = runs.filter((run) => run.skill === skill)
    const clears = mine.filter((run) => run.status === 'complete')
    const average = (pick: (run: Run) => number, list = mine) =>
      list.length > 0 ? list.reduce((sum, run) => sum + pick(run), 0) / list.length : 0
    return {
      skill: AUTOPILOT_SKILLS[skill].name,
      clears: `${clears.length}/${mine.length}`,
      time: Math.round(average((run) => run.time, clears)),
      hits: average((run) => run.hits).toFixed(1),
      accuracy: `${Math.round(average((run) => run.accuracy) * 100)}%`,
      ultimates: average((run) => run.ultimates).toFixed(1),
      crits: `${Math.round(average((run) => run.crits) * 100)}%`,
      smashes: average((run) => run.smashes).toFixed(1),
      food: Math.round(average((run) => run.food)),
      dashes: average((run) => run.dashes).toFixed(1),
      jumps: average((run) => run.jumps).toFixed(1),
    }
  })
}

export function table<T extends Run>(runs: T[]) {
  return runs.map((run) => ({
    ...run,
    skill: AUTOPILOT_SKILLS[run.skill].name,
    accuracy: `${Math.round(run.accuracy * 100)}%`,
    crits: `${Math.round(run.crits * 100)}%`,
  }))
}

export function clearsOf(runs: readonly Run[], skill: AutopilotSkillId): number {
  return runs.filter((run) => run.skill === skill && run.status === 'complete').length
}

export function averageOf<T extends Run>(runs: readonly T[], skill: AutopilotSkillId, pick: (run: T) => number): number {
  const mine = runs.filter((run) => run.skill === skill)
  return mine.reduce((sum, run) => sum + pick(run), 0) / mine.length
}

export type BellMode = 'rung' | 'quiet'

export interface FarmRun extends Run {
  lock: number
  boss: number
  stuns: number
}

export function firstSteps(): Loadout {
  return createLoadout({}, [{ slot: 'q', id: 'concussion', rank: 1 }])
}

export function afterOutskirts(): Loadout {
  return createLoadout({ brawl: 1 }, [{ slot: 'q', id: 'concussion', rank: 2 }], 'shotgun', ['straw'])
}

export function afterPasture(): Loadout {
  return createLoadout({ brawl: 1, gun: 1 }, [{ slot: 'q', id: 'barrier', rank: 1 }])
}

export function playFarm(skill: AutopilotSkillId, seed: number, bell: BellMode): FarmRun {
  const level = buildLevel(LEVEL_1_3)
  const world = createWorld(level, createDefaultTuning(), { seed, loadout: afterPasture(), debug: { invincible: false, quietAlarms: bell === 'quiet' } })
  const pilot = createAutopilot({ skill, seed, siege: true })
  let lock = 0
  let boss = 0
  let stuns = 0
  for (let step = 0; step < LIMIT_SECONDS / DT && world.status === 'playing'; step++) {
    if (bell === 'rung' && world.areaIndex === 1 && world.alarms.every((alarm) => alarm.status !== 'rung')) raiseAlarms(world)
    stepWorld(world, pilot.next(world), DT)
    if (world.areas[2].status === 'locked') lock += DT
    if (world.boss?.boss && world.boss.boss.phase !== 'dormant' && world.boss.hp > 0) boss += DT
    for (const event of world.events) if (event.type === 'bossStunned') stuns += 1
    world.events.length = 0
  }
  return { ...report(world, level, skill, seed), lock: Math.round(lock), boss: Math.round(boss), stuns }
}

export function farmSummary(runs: FarmRun[]) {
  return summarize(runs).map((row, index) => {
    const mine = runs.filter((run) => run.skill === AUTOPILOT_SKILL_ORDER[index] && run.status === 'complete')
    const average = (pick: (run: FarmRun) => number) => (mine.length > 0 ? mine.reduce((sum, run) => sum + pick(run), 0) / mine.length : 0)
    return { ...row, lock: Math.round(average((run) => run.lock)), boss: Math.round(average((run) => run.boss)), stuns: average((run) => run.stuns).toFixed(1) }
  })
}

export interface TrailRun extends Run {
  boss: number
  stuns: number
  lamps: number
}

export function afterFarm(): Loadout {
  return createLoadout({ brawl: 2, gun: 1 }, [{ slot: 'q', id: 'barrier', rank: 1 }])
}

export function playTrail(skill: AutopilotSkillId, seed: number): TrailRun {
  const level = buildLevel(LEVEL_1_4)
  const world = createWorld(level, createDefaultTuning(), { seed, loadout: afterFarm() })
  const pilot = createAutopilot({ skill, seed })
  let boss = 0
  let stuns = 0
  for (let step = 0; step < LIMIT_SECONDS / DT && world.status === 'playing'; step++) {
    stepWorld(world, pilot.next(world), DT)
    if (world.boss?.boss && world.boss.boss.phase !== 'dormant' && world.boss.hp > 0) boss += DT
    for (const event of world.events) if (event.type === 'bossStunned') stuns += 1
    world.events.length = 0
  }
  return { ...report(world, level, skill, seed), boss: Math.round(boss), stuns, lamps: world.lamps.filter(Boolean).length }
}

export function trailSummary(runs: TrailRun[]) {
  return summarize(runs).map((row, index) => {
    const mine = runs.filter((run) => run.skill === AUTOPILOT_SKILL_ORDER[index] && run.status === 'complete')
    const average = (pick: (run: TrailRun) => number) => (mine.length > 0 ? mine.reduce((sum, run) => sum + pick(run), 0) / mine.length : 0)
    return { ...row, boss: Math.round(average((run) => run.boss)), stuns: average((run) => run.stuns).toFixed(1), lamps: average((run) => run.lamps).toFixed(1) }
  })
}

export interface HarvestRun extends Run {
  boss: number
  stuns: number
  phase: number
  bladeHits: number
  bladeKills: number
  elites: number
  chests: number
  weapon: string
  areaTimes: number[]
  areaHits: number[]
  enterHp: number[]
}

export function afterTrail(): Loadout {
  return createLoadout({ brawl: 2, gun: 2 }, [{ slot: 'q', id: 'barrier', rank: 1 }])
}

export function playHarvest(
  skill: AutopilotSkillId,
  seed: number,
  difficulty: DifficultyId = 'normal',
  loadout: Loadout = afterTrail(),
  def: LevelDef = LEVEL_1_5,
): HarvestRun {
  const level = buildLevel(def)
  const world = createWorld(level, createDefaultTuning(), { seed, loadout, difficulty })
  const pilot = createAutopilot({ skill, seed, siege: true, onward: true, kite: true })
  let boss = 0
  let stuns = 0
  let bladeHits = 0
  let bladeKills = 0
  let weapon = ''
  const areaHits = level.areas.map(() => 0)
  const enterHp = level.areas.map(() => 0)
  for (let step = 0; step < LIMIT_SECONDS / DT && world.status === 'playing'; step++) {
    stepWorld(world, pilot.next(world), DT)
    if (world.boss?.boss && world.boss.boss.phase !== 'dormant' && world.boss.hp > 0) boss += DT
    let sliced = -1
    for (const event of world.events) {
      if (event.type === 'bossStunned') stuns += 1
      else if (event.type === 'bladeHit') {
        if (event.id === world.player.id) bladeHits += 1
        sliced = event.id
      } else if (event.type === 'enemyKilled' && event.id === sliced) bladeKills += 1
      else if (event.type === 'pickedUp' && event.item.type === 'weapon') weapon = event.item.weapon
      else if (event.type === 'playerHit' && event.damage > 0) areaHits[world.areaIndex] += 1
      else if (event.type === 'areaEntered') enterHp[event.index] = Math.round((world.player.hp / world.player.maxHp) * 100)
    }
    world.events.length = 0
  }
  return {
    ...report(world, level, skill, seed),
    boss: Math.round(boss),
    stuns,
    phase: (world.boss?.boss?.phaseIndex ?? 0) + 1,
    bladeHits,
    bladeKills,
    elites: world.stats.elites,
    chests: world.chests.filter((chest) => chest.opened).length,
    weapon,
    areaTimes: level.areas.map((_, index) => Math.round(world.stats.areaTime[index] ?? 0)),
    areaHits,
    enterHp,
  }
}

export function harvestSummary(runs: HarvestRun[]) {
  return summarize(runs).map((row, index) => {
    const skill = AUTOPILOT_SKILL_ORDER[index]
    const mine = runs.filter((run) => run.skill === skill)
    const clears = mine.filter((run) => run.status === 'complete')
    const average = (list: HarvestRun[], pick: (run: HarvestRun) => number) => (list.length > 0 ? list.reduce((sum, run) => sum + pick(run), 0) / list.length : 0)
    return {
      ...row,
      boss: Math.round(average(clears, (run) => run.boss)),
      stuns: average(clears, (run) => run.stuns).toFixed(1),
      bladeHits: average(mine, (run) => run.bladeHits).toFixed(1),
      bladeKills: average(mine, (run) => run.bladeKills).toFixed(1),
      areas: [0, 1, 2, 3, 4].map((area) => Math.round(average(clears, (run) => run.areaTimes[area] ?? 0))).join(' / '),
      areaHits: [0, 1, 2, 3, 4].map((area) => average(mine, (run) => run.areaHits[area] ?? 0).toFixed(1)).join(' / '),
      bossHp: Math.round(average(mine.filter((run) => run.enterHp[4] > 0), (run) => run.enterHp[4])),
    }
  })
}
