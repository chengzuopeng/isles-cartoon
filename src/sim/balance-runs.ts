import type { LevelDef } from '../data/levels/types'
import type { SkillId } from '../data/skills'
import { createDefaultTuning } from '../data/tuning'
import { createAutopilot, type AutopilotOptions } from './autopilot'
import { buildLevel } from './level'
import { createProfile, grantXp, settleRun, type Profile } from './profile'
import { rateRun } from './rating'
import { stepWorld } from './step'
import { createLoadout } from './stats'
import { createWorld } from './world'

export const DT = 1 / 60
export const LIMIT_SECONDS = 15 * 60
export const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

export interface RunReport {
  seed: number
  status: string
  area: string
  time: number
  hits: number
  kills: number
  offered: number
  heals: number
  buffs: number
  ammo: number
  weapons: number
  chests: number
  supplies: number
  crates: number
  casts: number
  ultimates: number
  xp: number
  level: number
}

export function play(
  def: LevelDef,
  seed: number,
  skill: SkillId | null = null,
  start: () => Profile = createProfile,
  options: AutopilotOptions = {},
): RunReport {
  const level = buildLevel(def)
  const before = start()
  const loadout = createLoadout({ ...before.specs }, skill ? [{ slot: 'q', id: skill, rank: 1 }] : [])
  const world = createWorld(level, createDefaultTuning(), { seed, loadout })
  const pilot = createAutopilot(options)
  const report: RunReport = {
    seed,
    status: '',
    area: '',
    time: 0,
    hits: 0,
    kills: 0,
    offered: 0,
    heals: 0,
    buffs: 0,
    ammo: 0,
    weapons: 0,
    chests: 0,
    supplies: 0,
    crates: 0,
    casts: 0,
    ultimates: 0,
    xp: 0,
    level: 1,
  }
  for (let step = 0; step < LIMIT_SECONDS / DT && world.status === 'playing'; step++) {
    stepWorld(world, pilot.next(world), DT)
    for (const event of world.events) {
      if (event.type === 'pickedUp') {
        if (event.item.type === 'heal') report.heals += 1
        else if (event.item.type === 'buff') report.buffs += 1
        else if (event.item.type === 'ammo') report.ammo += 1
        else report.weapons += 1
      } else if (event.type === 'pickupDropped') {
        if (event.item.type === 'heal' || event.item.type === 'buff') report.offered += 1
      } else if (event.type === 'chestOpened') report.chests += 1
      else if (event.type === 'supplyUsed') report.supplies += 1
      else if (event.type === 'crateBroken') report.crates += 1
      else if (event.type === 'skillCast') report.casts += 1
      else if (event.type === 'ultimateFired') report.ultimates += 1
    }
    world.events.length = 0
  }
  const profile = before
  const settlement = world.status === 'complete' ? settleRun(profile, world, rateRun(world)) : null
  report.status = world.status
  report.area = level.areas[world.areaIndex]?.name ?? ''
  report.time = Math.round(world.stats.time)
  report.hits = world.stats.hits
  report.kills = world.stats.kills
  report.xp = settlement?.reward.total ?? 0
  report.level = profile.level
  return report
}

export function afterTutorial(): Profile {
  const profile = createProfile()
  grantXp(profile, 400)
  profile.specs.brawl = 1
  profile.points -= 1
  profile.records['1-1'] = { cleared: true, bestStars: 3, bestTime: 60, clears: 1 }
  return profile
}

export function afterPasture(): Profile {
  const profile = createProfile()
  grantXp(profile, 780)
  profile.specs.brawl = 1
  profile.specs.gun = 1
  profile.points -= 2
  profile.skills.barrier = 1
  profile.equipped.q = 'barrier'
  profile.records['1-1'] = { cleared: true, bestStars: 3, bestTime: 80, clears: 1 }
  profile.records['1-2'] = { cleared: true, bestStars: 3, bestTime: 110, clears: 1 }
  return profile
}

export function afterFarm(): Profile {
  const profile = createProfile()
  grantXp(profile, 1280)
  profile.specs.brawl = 2
  profile.specs.gun = 1
  profile.points -= 3
  profile.skills.barrier = 1
  profile.equipped.q = 'barrier'
  profile.records['1-1'] = { cleared: true, bestStars: 3, bestTime: 80, clears: 1 }
  profile.records['1-2'] = { cleared: true, bestStars: 3, bestTime: 110, clears: 1 }
  profile.records['1-3'] = { cleared: true, bestStars: 3, bestTime: 150, clears: 1 }
  return profile
}

export function afterTrail(): Profile {
  const profile = createProfile()
  grantXp(profile, 1770)
  profile.specs.brawl = 2
  profile.specs.gun = 2
  profile.points -= 4
  profile.skills.barrier = 1
  profile.equipped.q = 'barrier'
  profile.records['1-1'] = { cleared: true, bestStars: 3, bestTime: 80, clears: 1 }
  profile.records['1-2'] = { cleared: true, bestStars: 3, bestTime: 110, clears: 1 }
  profile.records['1-3'] = { cleared: true, bestStars: 3, bestTime: 150, clears: 1 }
  profile.records['1-4'] = { cleared: true, bestStars: 3, bestTime: 100, clears: 1 }
  return profile
}
