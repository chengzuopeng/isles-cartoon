export type SkillId = 'concussion' | 'barrier' | 'shockwave'

export type SkillSlot = 'q' | 'e'

export type SkillBranch = 'a' | 'b'

export interface BranchDef {
  name: string
  line: string
}

export type ConcussionRank = {
  cooldown: number
  range: number
  radius: number
  stun: number
  damage: number
  flight: number
  daze: boolean
  bomblets: number
}

export type BarrierRank = {
  cooldown: number
  absorb: number
  duration: number
  burstRadius: number
  burstKnockback: number
  reflect: boolean
}

export type ShockwaveRank = {
  cooldown: number
  radius: number
  knockback: number
  damage: number
  stun: number
  pullTo: number
}

export type SkillDef<Rank> = {
  name: string
  kind: string
  unlockChapter: number
  lines: readonly [string, string]
  ranks: readonly [Rank, Rank, Rank]
  branches: Readonly<Record<SkillBranch, BranchDef>>
  branchB: Rank
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

export const SLOT_UNLOCK_LEVEL: Readonly<Record<SkillSlot, number>> = { q: 1, e: 4 }

export const SKILL_POINT_EVERY = 2
export const FREE_SKILL_POINTS = 1
export const STARTER_SKILL: SkillId = 'concussion'
export const SKILL_MAX_RANK = 3

export const SKILLS: SkillBook = {
  concussion: {
    name: '震荡雷',
    kind: '投掷',
    unlockChapter: 1,
    lines: ['朝准星方向抛一颗雷，落地炸开，3 米内的敌人眩晕 1.2 秒', '冷却从 10 秒缩短到 8 秒'],
    ranks: [
      { cooldown: 10, range: 14, radius: 3, stun: 1.2, damage: 60, flight: 0.55, daze: false, bomblets: 0 },
      { cooldown: 8, range: 14, radius: 3, stun: 1.2, damage: 60, flight: 0.55, daze: false, bomblets: 0 },
      { cooldown: 8, range: 14, radius: 4, stun: 1.8, damage: 60, flight: 0.55, daze: true, bomblets: 0 },
    ],
    branches: {
      a: { name: '震晕', line: '范围 4 米，眩晕 1.8 秒；被这颗雷眩晕的小兵可以直接砸散' },
      b: { name: '连环雷', line: '落地后再往外弹出 3 颗小雷，各炸 2 米、40 伤害、眩晕 0.8 秒；盖得广，适合引爆火药桶和自爆兵' },
    },
    branchB: { cooldown: 8, range: 14, radius: 3, stun: 1.2, damage: 60, flight: 0.55, daze: false, bomblets: 3 },
  },
  barrier: {
    name: '能量护盾',
    kind: '防御',
    unlockChapter: 1,
    lines: ['获得吸收 400 伤害的护盾，持续 4 秒', '吸收量提高到 600'],
    ranks: [
      { cooldown: 12, absorb: 400, duration: 4, burstRadius: 0, burstKnockback: 0, reflect: false },
      { cooldown: 12, absorb: 600, duration: 4, burstRadius: 0, burstKnockback: 0, reflect: false },
      { cooldown: 12, absorb: 600, duration: 4, burstRadius: 2.6, burstKnockback: 9, reflect: false },
    ],
    branches: {
      a: { name: '震爆', line: '护盾被打破或者到时间时，震退 2.6 米内的敌人' },
      b: { name: '反射', line: '护盾在的时候，正面飞来的子弹原样弹回去' },
    },
    branchB: { cooldown: 12, absorb: 600, duration: 4, burstRadius: 0, burstKnockback: 0, reflect: true },
  },
  shockwave: {
    name: '冲击波',
    kind: '控制',
    unlockChapter: 1,
    lines: ['击退身边 3 米内的敌人，打断它们正在蓄力的招式', '附带 1 秒眩晕'],
    ranks: [
      { cooldown: 10, radius: 3, knockback: 10, damage: 60, stun: 0, pullTo: 0 },
      { cooldown: 10, radius: 3, knockback: 10, damage: 60, stun: 1, pullTo: 0 },
      { cooldown: 10, radius: 4, knockback: 10, damage: 60, stun: 1, pullTo: 0 },
    ],
    branches: {
      a: { name: '扩散', line: '范围扩大到 4 米' },
      b: { name: '引力', line: '反过来，把 6 米内的小兵拉到面前 2 米并眩晕 0.6 秒' },
    },
    branchB: { cooldown: 10, radius: 6, knockback: 0, damage: 60, stun: 0.6, pullTo: 2 },
  },
}

export const BOMBLET = { spread: 2.5, radius: 2, damage: 40, stun: 0.8, delay: 0.25 } as const

export function skillCooldown(id: SkillId, rank: number): number {
  return SKILLS[id].ranks[clampRank(rank) - 1].cooldown
}

export function clampRank(rank: number): number {
  return Math.min(SKILL_MAX_RANK, Math.max(1, Math.round(rank)))
}
