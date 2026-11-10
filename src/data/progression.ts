import type { BossTier } from './bosses'
import type { MinionKind } from './enemies'

export type AttributeId = 'health' | 'damage' | 'fireRate' | 'reload' | 'speed' | 'magazine' | 'recovery' | 'cooldown'

export type AttributeDef = {
  name: string
  perRank: number
  maxRank: number
  unlockLevels: readonly number[]
  needsSkill: boolean
}

export const ATTRIBUTE_ORDER: readonly AttributeId[] = [
  'health',
  'damage',
  'fireRate',
  'reload',
  'speed',
  'magazine',
  'recovery',
  'cooldown',
]

export const ATTRIBUTES: Readonly<Record<AttributeId, AttributeDef>> = {
  health: { name: '生命', perRank: 0.08, maxRank: 10, unlockLevels: [], needsSkill: false },
  damage: { name: '伤害', perRank: 0.05, maxRank: 10, unlockLevels: [], needsSkill: false },
  fireRate: { name: '射速', perRank: 0.04, maxRank: 8, unlockLevels: [], needsSkill: false },
  reload: { name: '装填', perRank: 0.05, maxRank: 8, unlockLevels: [], needsSkill: false },
  speed: { name: '移速', perRank: 0.03, maxRank: 6, unlockLevels: [], needsSkill: false },
  magazine: { name: '弹匣', perRank: 1, maxRank: 2, unlockLevels: [5, 15], needsSkill: false },
  recovery: { name: '回复', perRank: 0.12, maxRank: 5, unlockLevels: [], needsSkill: false },
  cooldown: { name: '冷却', perRank: 0.05, maxRank: 10, unlockLevels: [], needsSkill: true },
}

export const RECOVERY_DELAY_PER_RANK = 0.2
export const STAT_FLOOR = 0.2
export const MIN_REGEN_DELAY = 0.5

export const LEVEL_CAP = 30
export const XP_BASE = 200
export const XP_STEP = 100

export const KILL_XP: Readonly<Record<MinionKind, number>> = {
  grunt: 3,
  gunner: 5,
  bomber: 3,
  turret: 8,
  shield: 8,
  thrower: 5,
}

export const ELITE_XP = 25

export const BOSS_XP: Readonly<Record<BossTier, number>> = {
  mini: 80,
  chapter: 250,
}

export const CLEAR_XP = 100
export const THREE_STAR_XP = 50
export const RARE_CHEST_XP = 100
export const REPLAY_XP_SCALE = 0.5
