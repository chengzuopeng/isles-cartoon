export type SkillId = 'roll' | 'barrier' | 'shockwave'

export type SkillSlot = 'q' | 'e'

export type RollRank = {
  cooldown: number
  distance: number
  duration: number
  empower: number
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
  roll: SkillDef<RollRank>
  barrier: SkillDef<BarrierRank>
  shockwave: SkillDef<ShockwaveRank>
}

export const SKILL_ORDER: readonly SkillId[] = ['roll', 'barrier', 'shockwave']

export const SKILL_SLOTS: readonly SkillSlot[] = ['q', 'e']

export const SLOT_UNLOCK_LEVEL: Readonly<Record<SkillSlot, number>> = { q: 1, e: 8 }

export const SKILL_POINT_EVERY = 3
export const SKILL_MAX_RANK = 3

export const SKILLS: SkillBook = {
  roll: {
    name: '翻滚',
    kind: '位移',
    unlockChapter: 1,
    lines: ['朝移动方向翻滚 3 格，翻滚中 0.25 秒无敌', '冷却从 4 秒缩短到 3 秒', '翻滚后下一次攻击伤害 +50%'],
    ranks: [
      { cooldown: 4, distance: 3, duration: 0.25, empower: 0 },
      { cooldown: 3, distance: 3, duration: 0.25, empower: 0 },
      { cooldown: 3, distance: 3, duration: 0.25, empower: 0.5 },
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
