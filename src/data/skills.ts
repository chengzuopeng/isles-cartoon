export type SkillId = 'concussion' | 'barrier' | 'shockwave'

export type SkillSlot = 'q' | 'e'

export type ConcussionRank = {
  cooldown: number
  range: number
  radius: number
  stun: number
  damage: number
  flight: number
}

export type BarrierRank = {
  cooldown: number
  absorb: number
  duration: number
  burstRadius: number
  burstKnockback: number
}

export type ShockwaveRank = {
  cooldown: number
  radius: number
  knockback: number
  damage: number
  stun: number
}

export type SkillDef<Rank> = {
  name: string
  kind: string
  unlockChapter: number
  lines: readonly [string, string, string]
  ranks: readonly [Rank, Rank, Rank]
}

export type SkillBook = {
  concussion: SkillDef<ConcussionRank>
  barrier: SkillDef<BarrierRank>
  shockwave: SkillDef<ShockwaveRank>
}

export const SKILL_ORDER: readonly SkillId[] = ['concussion', 'barrier', 'shockwave']

export const RETIRED_SKILLS: Readonly<Record<string, SkillId>> = { roll: 'concussion' }

export const CONCUSSION_MIN = 2

export const SKILL_SLOTS: readonly SkillSlot[] = ['q', 'e']

export const SLOT_UNLOCK_LEVEL: Readonly<Record<SkillSlot, number>> = { q: 1, e: 8 }

export const SKILL_POINT_EVERY = 3
export const SKILL_MAX_RANK = 3

export const SKILLS: SkillBook = {
  concussion: {
    name: '震荡雷',
    kind: '投掷',
    unlockChapter: 1,
    lines: ['朝准星方向抛一颗雷，落地炸开，3 米内的敌人眩晕 1.2 秒', '冷却从 10 秒缩短到 8 秒', '范围扩大到 4 米，眩晕延长到 1.8 秒'],
    ranks: [
      { cooldown: 10, range: 14, radius: 3, stun: 1.2, damage: 60, flight: 0.55 },
      { cooldown: 8, range: 14, radius: 3, stun: 1.2, damage: 60, flight: 0.55 },
      { cooldown: 8, range: 14, radius: 4, stun: 1.8, damage: 60, flight: 0.55 },
    ],
  },
  barrier: {
    name: '能量护盾',
    kind: '防御',
    unlockChapter: 1,
    lines: ['获得吸收 400 伤害的护盾，持续 4 秒', '吸收量提高到 600', '护盾被打破时震退周围的敌人'],
    ranks: [
      { cooldown: 12, absorb: 400, duration: 4, burstRadius: 0, burstKnockback: 0 },
      { cooldown: 12, absorb: 600, duration: 4, burstRadius: 0, burstKnockback: 0 },
      { cooldown: 12, absorb: 600, duration: 4, burstRadius: 2.6, burstKnockback: 9 },
    ],
  },
  shockwave: {
    name: '冲击波',
    kind: '控制',
    unlockChapter: 1,
    lines: ['击退身边 3 格内的敌人，打断它们正在蓄力的招式', '附带 1 秒眩晕', '范围扩大到 4 格'],
    ranks: [
      { cooldown: 10, radius: 3, knockback: 10, damage: 60, stun: 0 },
      { cooldown: 10, radius: 3, knockback: 10, damage: 60, stun: 1 },
      { cooldown: 10, radius: 4, knockback: 10, damage: 60, stun: 1 },
    ],
  },
}

export function skillCooldown(id: SkillId, rank: number): number {
  return SKILLS[id].ranks[clampRank(rank) - 1].cooldown
}

export function clampRank(rank: number): number {
  return Math.min(SKILL_MAX_RANK, Math.max(1, Math.round(rank)))
}
