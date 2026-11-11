import { CHALLENGES, CHALLENGE_ORDER, isChallengeId, type ChallengeId } from '../data/challenges'
import { CLUES, CLUE_ORDER, isClueId, type ClueId } from '../data/clues'
import { INTERLUDES, type Interlude } from '../data/dialogue'
import type { LevelDef } from '../data/levels/types'
import {
  ATTRIBUTES,
  ATTRIBUTE_ORDER,
  CLEAR_XP,
  LEVEL_CAP,
  REPLAY_XP_SCALE,
  THREE_STAR_XP,
  XP_BASE,
  XP_STEP,
  type AttributeId,
} from '../data/progression'
import {
  FREE_SKILL_POINTS,
  RETIRED_SKILLS,
  SKILLS,
  SKILL_MAX_RANK,
  SKILL_ORDER,
  SKILL_POINT_EVERY,
  SKILL_SLOTS,
  SLOT_UNLOCK_LEVEL,
  STARTER_SKILL,
  type SkillId,
  type SkillSlot,
} from '../data/skills'
import { CLEAR_WEAPONS } from '../data/loot'
import { SPECIAL_WEAPONS, type PlayerWeaponId } from '../data/weapons'
import type { RunRating } from './rating'
import { createLoadout, emptyRanks, type AttributeRanks, type EquippedSkill, type Loadout } from './stats'
import type { World } from './world'

export const PROFILE_VERSION = 2

export interface LevelRecord {
  cleared: boolean
  bestStars: number
  bestTime: number
  clears: number
  challenges?: ChallengeId[]
}

export interface Profile {
  version: number
  level: number
  xp: number
  points: number
  attributes: AttributeRanks
  skills: Partial<Record<SkillId, number>>
  equipped: Record<SkillSlot, SkillId | null>
  chapter: number
  records: Record<string, LevelRecord>
  clues: ClueId[]
  interludes: string[]
  plays: Record<string, number>
  weapons: PlayerWeaponId[]
  carry: PlayerWeaponId | null
}

export type SkillBlock = 'maxed' | 'chapter' | 'noPoints'

export type AllocationBlock = 'noPoints' | 'maxed' | 'level' | 'skill'

export interface RewardLine {
  label: string
  amount: number
}

export interface RunReward {
  lines: RewardLine[]
  total: number
  replay: boolean
}

export interface Settlement {
  reward: RunReward
  before: { level: number; xp: number }
  after: { level: number; xp: number }
  levelsGained: number
  skillPointsGained: number
  firstClear: boolean
  newBest: boolean
  newClues: ClueId[]
  newWeapons: PlayerWeaponId[]
}

export interface ClueEntry {
  id: ClueId
  level: string
  found: boolean
  title: string
  text: string
}

export function createProfile(): Profile {
  return {
    version: PROFILE_VERSION,
    level: 1,
    xp: 0,
    points: 0,
    attributes: emptyRanks(),
    skills: { [STARTER_SKILL]: 1 },
    equipped: { q: STARTER_SKILL, e: null },
    chapter: 1,
    records: {},
    clues: [],
    interludes: [],
    plays: {},
    weapons: [],
    carry: null,
  }
}

export function xpToNext(level: number): number {
  return XP_BASE + XP_STEP * (Math.max(1, level) - 1)
}

export function totalXpAt(level: number, xp: number): number {
  let total = xp
  for (let current = 1; current < level; current++) total += xpToNext(current)
  return total
}

export function grantXp(profile: Profile, amount: number): number {
  let gained = 0
  if (profile.level >= LEVEL_CAP) {
    profile.xp = 0
    return 0
  }
  profile.xp += Math.max(0, Math.round(amount))
  while (profile.level < LEVEL_CAP && profile.xp >= xpToNext(profile.level)) {
    profile.xp -= xpToNext(profile.level)
    profile.level += 1
    profile.points += 1
    gained += 1
  }
  if (profile.level >= LEVEL_CAP) profile.xp = 0
  if (gained > 0) fillOpenSlots(profile)
  return gained
}

export function knowsSkill(profile: Profile): boolean {
  return Object.values(profile.skills).some((rank) => rank > 0)
}

export function nextRankLevel(id: AttributeId, rank: number): number {
  return ATTRIBUTES[id].unlockLevels[rank] ?? 0
}

export function allocationBlock(profile: Profile, id: AttributeId): AllocationBlock | null {
  const def = ATTRIBUTES[id]
  const rank = profile.attributes[id]
  if (rank >= def.maxRank) return 'maxed'
  if (profile.level < nextRankLevel(id, rank)) return 'level'
  if (def.needsSkill && !knowsSkill(profile)) return 'skill'
  if (profile.points <= 0) return 'noPoints'
  return null
}

export function allocate(profile: Profile, id: AttributeId): boolean {
  if (allocationBlock(profile, id) !== null) return false
  profile.attributes[id] += 1
  profile.points -= 1
  return true
}

export function spentPoints(profile: Profile): number {
  return ATTRIBUTE_ORDER.reduce((sum, id) => sum + profile.attributes[id], 0)
}

export function respec(profile: Profile): void {
  profile.points += spentPoints(profile)
  profile.attributes = emptyRanks()
}

export function skillRank(profile: Profile, id: SkillId): number {
  return profile.skills[id] ?? 0
}

export function skillPointsTotal(level: number): number {
  return FREE_SKILL_POINTS + Math.floor(level / SKILL_POINT_EVERY)
}

export function skillPointsSpent(profile: Profile): number {
  return SKILL_ORDER.reduce((sum, id) => sum + skillRank(profile, id), 0)
}

export function skillPointsLeft(profile: Profile): number {
  return skillPointsTotal(profile.level) - skillPointsSpent(profile)
}

export function slotUnlocked(profile: Profile, slot: SkillSlot): boolean {
  return profile.level >= SLOT_UNLOCK_LEVEL[slot]
}

export function fillOpenSlots(profile: Profile): void {
  for (const slot of SKILL_SLOTS) {
    if (!slotUnlocked(profile, slot) || profile.equipped[slot] !== null) continue
    const equipped = (id: SkillId) => SKILL_SLOTS.some((item) => profile.equipped[item] === id)
    const spare = SKILL_ORDER.find((id) => skillRank(profile, id) > 0 && !equipped(id))
    if (spare) profile.equipped[slot] = spare
  }
}

export function skillBlock(profile: Profile, id: SkillId): SkillBlock | null {
  if (skillRank(profile, id) >= SKILL_MAX_RANK) return 'maxed'
  if (profile.chapter < SKILLS[id].unlockChapter) return 'chapter'
  if (skillPointsLeft(profile) <= 0) return 'noPoints'
  return null
}

export function learnSkill(profile: Profile, id: SkillId): boolean {
  if (skillBlock(profile, id) !== null) return false
  profile.skills[id] = skillRank(profile, id) + 1
  if (!SKILL_SLOTS.some((slot) => profile.equipped[slot] === id)) {
    const free = SKILL_SLOTS.find((slot) => slotUnlocked(profile, slot) && profile.equipped[slot] === null)
    if (free) profile.equipped[free] = id
  }
  return true
}

export function equipSkill(profile: Profile, id: SkillId, slot: SkillSlot): boolean {
  if (skillRank(profile, id) <= 0 || !slotUnlocked(profile, slot)) return false
  const other = SKILL_SLOTS.find((item) => item !== slot && profile.equipped[item] === id)
  if (other) profile.equipped[other] = profile.equipped[slot]
  profile.equipped[slot] = id
  return true
}

export function resetSkills(profile: Profile): void {
  profile.skills = {}
  profile.equipped = { q: null, e: null }
}

export function loadoutOf(profile: Profile): Loadout {
  const skills: EquippedSkill[] = []
  for (const slot of SKILL_SLOTS) {
    const id = profile.equipped[slot]
    if (id && slotUnlocked(profile, slot) && skillRank(profile, id) > 0) skills.push({ slot, id, rank: skillRank(profile, id) })
  }
  return createLoadout({ ...profile.attributes }, skills, profile.carry && profile.weapons.includes(profile.carry) ? profile.carry : null)
}

export function unlockWeapon(profile: Profile, id: PlayerWeaponId): boolean {
  if (profile.weapons.includes(id) || !SPECIAL_WEAPONS.includes(id)) return false
  profile.weapons = SPECIAL_WEAPONS.filter((item) => item === id || profile.weapons.includes(item))
  if (profile.carry === null) profile.carry = id
  return true
}

export function setCarry(profile: Profile, id: PlayerWeaponId | null): boolean {
  if (id !== null && !profile.weapons.includes(id)) return false
  profile.carry = id
  return true
}

export function recordOf(profile: Profile, levelId: string): LevelRecord | undefined {
  return profile.records[levelId]
}

export function nextSeed(profile: Profile, levelId: string): number {
  const plays = (profile.plays[levelId] ?? 0) + 1
  profile.plays[levelId] = plays
  return seedOf(levelId, plays)
}

export function seedOf(levelId: string, plays: number): number {
  let hash = 2166136261
  for (let i = 0; i < levelId.length; i++) hash = Math.imul(hash ^ levelId.charCodeAt(i), 16777619)
  return ((hash >>> 0) + plays * 7919) % 2147483647 || 1
}

export function variedRun(profile: Profile, levelId: string, difficulty: string): boolean {
  return isReplay(profile, levelId) || difficulty === 'hard'
}

export function isReplay(profile: Profile, levelId: string): boolean {
  return recordOf(profile, levelId)?.cleared ?? false
}

export function xpScaleFor(profile: Profile, levelId: string): number {
  return isReplay(profile, levelId) ? REPLAY_XP_SCALE : 1
}

export function runXp(world: World): number {
  const { kills, boss, chests, targets } = world.rewards
  return Math.round((kills + boss + chests + targets) * world.xpScale)
}

export function computeReward(world: World, rating: RunRating, record: LevelRecord | undefined): RunReward {
  const scale = world.xpScale
  const lines: RewardLine[] = []
  if (!rating.cleared) return { lines, total: 0, replay: scale < 1 }
  const add = (label: string, amount: number) => {
    const rounded = Math.round(amount)
    if (rounded > 0) lines.push({ label, amount: rounded })
  }
  add('击败敌人', world.rewards.kills * scale)
  add('破坏目标', world.rewards.targets * scale)
  add('击败 Boss', world.rewards.boss * scale)
  add('宝箱', world.rewards.chests * scale)
  if (rating.cleared) add('通关', CLEAR_XP * world.chapter * scale)
  if (rating.cleared && rating.stars >= 3 && (record?.bestStars ?? 0) < 3) add('首次三星', THREE_STAR_XP * world.chapter)
  for (const id of newChallenges(rating, record)) add(`挑战「${CHALLENGES[id].name}」`, CHALLENGES[id].xp * world.chapter)
  return { lines, total: lines.reduce((sum, line) => sum + line.amount, 0), replay: scale < 1 }
}

export function newChallenges(rating: RunRating, record: LevelRecord | undefined): ChallengeId[] {
  const done = record?.challenges ?? []
  return rating.challenges.filter((item) => item.done && !done.includes(item.id)).map((item) => item.id)
}

export function keepClues(profile: Profile, world: World): ClueId[] {
  const added = world.cluesFound.filter((id) => !profile.clues.includes(id))
  if (added.length > 0) profile.clues = CLUE_ORDER.filter((id) => profile.clues.includes(id) || added.includes(id))
  return added
}

export function clueBook(profile: Profile, chapter: number): ClueEntry[] {
  return CLUE_ORDER.filter((id) => CLUES[id].chapter === chapter).map((id) => {
    const found = profile.clues.includes(id)
    return { id, level: CLUES[id].level, found, title: found ? CLUES[id].title : '？？？', text: found ? CLUES[id].text : '' }
  })
}

export function interludeUnlocked(profile: Profile, interlude: Interlude): boolean {
  return recordOf(profile, interlude.after)?.cleared ?? false
}

export function pendingInterlude(profile: Profile): Interlude | null {
  return INTERLUDES.find((item) => interludeUnlocked(profile, item) && !profile.interludes.includes(item.id)) ?? null
}

export function seenInterludes(profile: Profile, chapter: number): Interlude[] {
  return INTERLUDES.filter((item) => item.chapter === chapter && profile.interludes.includes(item.id))
}

export function markInterlude(profile: Profile, id: string): boolean {
  if (profile.interludes.includes(id) || !INTERLUDES.some((item) => item.id === id)) return false
  profile.interludes = INTERLUDES.filter((item) => item.id === id || profile.interludes.includes(item.id)).map((item) => item.id)
  return true
}

export function levelUnlocked(profile: Profile, def: LevelDef, dev = false): boolean {
  if (dev || !def.unlockAfter) return true
  return recordOf(profile, def.unlockAfter)?.cleared ?? false
}

export function settleRun(profile: Profile, world: World, rating: RunRating): Settlement {
  const levelId = world.level.def.id
  const record = recordOf(profile, levelId)
  const reward = computeReward(world, rating, record)
  const newClues = keepClues(profile, world)
  const before = { level: profile.level, xp: profile.xp }
  const levelsGained = grantXp(profile, reward.total)
  const previous = record ?? { cleared: false, bestStars: 0, bestTime: 0, clears: 0 }
  const earned = newChallenges(rating, record)
  const challenges = CHALLENGE_ORDER.filter((id) => (previous.challenges ?? []).includes(id) || earned.includes(id))
  const newBest = rating.cleared && (!previous.cleared || rating.stars > previous.bestStars || rating.time < previous.bestTime)
  const prize = rating.cleared && !previous.cleared ? CLEAR_WEAPONS[levelId] : undefined
  const newWeapons = prize && unlockWeapon(profile, prize) ? [prize] : []
  profile.records[levelId] = {
    cleared: previous.cleared || rating.cleared,
    bestStars: Math.max(previous.bestStars, rating.stars),
    bestTime: previous.cleared ? Math.min(previous.bestTime, rating.time) : rating.time,
    clears: previous.clears + (rating.cleared ? 1 : 0),
    challenges,
  }
  return {
    reward,
    before,
    after: { level: profile.level, xp: profile.xp },
    levelsGained,
    skillPointsGained: skillPointsTotal(profile.level) - skillPointsTotal(before.level),
    firstClear: rating.cleared && !previous.cleared,
    newBest,
    newClues,
    newWeapons,
  }
}

export function sanitizeProfile(raw: unknown): Profile {
  const profile = createProfile()
  if (!isRecord(raw)) return profile
  profile.level = clampInt(raw.level, 1, LEVEL_CAP, 1)
  profile.xp = profile.level >= LEVEL_CAP ? 0 : clampInt(raw.xp, 0, xpToNext(profile.level) - 1, 0)
  if (isRecord(raw.attributes)) {
    for (const id of ATTRIBUTE_ORDER) profile.attributes[id] = clampInt(raw.attributes[id], 0, ATTRIBUTES[id].maxRank, 0)
  }
  profile.chapter = clampInt(raw.chapter, 1, 5, 1)
  resetSkills(profile)
  if (isRecord(raw.skills)) {
    const saved: Record<string, unknown> = { ...raw.skills }
    for (const [old, next] of Object.entries(RETIRED_SKILLS)) if (saved[next] === undefined && saved[old] !== undefined) saved[next] = saved[old]
    for (const id of SKILL_ORDER) {
      const value = clampInt(saved[id], 0, SKILL_MAX_RANK, 0)
      if (value > 0) profile.skills[id] = value
    }
  }
  if (skillPointsSpent(profile) > skillPointsTotal(profile.level)) profile.skills = {}
  if (!knowsSkill(profile)) profile.skills[STARTER_SKILL] = 1
  if (isRecord(raw.equipped)) {
    for (const slot of SKILL_SLOTS) {
      const saved = raw.equipped[slot]
      const id = typeof saved === 'string' ? (RETIRED_SKILLS[saved] ?? saved) : saved
      if (typeof id !== 'string' || !isSkillId(id)) continue
      if (skillRank(profile, id) > 0 && slotUnlocked(profile, slot) && !SKILL_SLOTS.some((item) => profile.equipped[item] === id)) {
        profile.equipped[slot] = id
      }
    }
  }
  fillOpenSlots(profile)
  if (isRecord(raw.records)) {
    for (const [id, value] of Object.entries(raw.records)) {
      if (!isRecord(value)) continue
      const cleared = value.cleared === true
      profile.records[id] = {
        cleared,
        bestStars: clampInt(value.bestStars, 0, 3, 0),
        bestTime: cleared ? clampNumber(value.bestTime, 0, 1e6, 0) : 0,
        clears: clampInt(value.clears, 0, 1e6, cleared ? 1 : 0),
        challenges: Array.isArray(value.challenges)
          ? CHALLENGE_ORDER.filter((challenge) => (value.challenges as unknown[]).some((item) => isChallengeId(item) && item === challenge))
          : [],
      }
    }
  }
  if (Array.isArray(raw.clues)) {
    const kept = raw.clues.filter((id): id is ClueId => typeof id === 'string' && isClueId(id))
    profile.clues = CLUE_ORDER.filter((id) => kept.includes(id))
  }
  if (Array.isArray(raw.weapons)) {
    const kept = raw.weapons as unknown[]
    profile.weapons = SPECIAL_WEAPONS.filter((id) => kept.includes(id))
  }
  const carry = raw.carry
  profile.carry = typeof carry === 'string' && profile.weapons.some((id) => id === carry) ? (carry as PlayerWeaponId) : null
  if (isRecord(raw.plays)) {
    for (const [id, value] of Object.entries(raw.plays)) {
      const plays = clampInt(value, 0, 1e9, 0)
      if (plays > 0) profile.plays[id] = plays
    }
  }
  if (Array.isArray(raw.interludes)) {
    const seen = raw.interludes as unknown[]
    profile.interludes = INTERLUDES.filter((item) => seen.includes(item.id)).map((item) => item.id)
  }
  const earned = profile.level - 1
  const spent = spentPoints(profile)
  if (spent > earned) {
    profile.attributes = emptyRanks()
    profile.points = earned
  } else {
    profile.points = earned - spent
  }
  return profile
}

function isSkillId(value: string): value is SkillId {
  return (SKILL_ORDER as readonly string[]).includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}
