import type { BossTier } from './bosses'
import type { MinionKind } from './enemies'

export type SpecId = 'gun' | 'brawl' | 'move' | 'energy'

export type SpecIcon = 'damage' | 'health' | 'speed' | 'cooldown'

export interface MilestoneDef {
  rank: number
  name: string
  text: string
}

export interface SpecDef {
  name: string
  icon: SpecIcon
  per: string
  milestones: readonly [MilestoneDef, MilestoneDef, MilestoneDef]
}

export const SPEC_ORDER: readonly SpecId[] = ['gun', 'brawl', 'move', 'energy']

export const SPEC_MAX = 10

export const SPEC_BONUS = {
  gun: { damage: 0.03, recharge: 0.03 },
  brawl: { health: 0.05, melee: 0.08 },
  move: { speed: 0.02, dash: 0.04 },
  energy: { cooldown: 0.03, ult: 0.03 },
} as const

export const SPECS: Readonly<Record<SpecId, SpecDef>> = {
  gun: {
    name: '枪法',
    icon: 'damage',
    per: '每级：所有枪的伤害 +3%，能量枪回弹药快 3%',
    milestones: [
      { rank: 2, name: '首发', text: '能量枪弹药全满时，第一次三连发必定暴击' },
      { rank: 5, name: '回收', text: '打中眼灯的暴击回 1 格弹药，1 秒内最多一次' },
      { rank: 10, name: '四连发', text: '能量枪每次多打一发，还是只耗一格' },
    ],
  },
  brawl: {
    name: '拳脚',
    icon: 'health',
    per: '每级：最大生命 +5%，近战伤害 +8%',
    milestones: [
      { rank: 2, name: '大口吃', text: '砸散掉的吃的回血 15% → 20%，6 米内自己飞过来' },
      { rank: 5, name: '余震', text: '砸散一个小兵时，震开 2.5 米内别的小兵，让它们踉跄 0.6 秒' },
      { rank: 10, name: '硬骨头', text: '回血溢出的部分变成护盾（最多 200）；生命低于 30% 时近战冷却减半' },
    ],
  },
  move: {
    name: '身法',
    icon: 'speed',
    per: '每级：移速 +2%，冲刺回充快 4%',
    milestones: [
      { rank: 2, name: '借力', text: '冲刺结束后 1 秒内，近战够距 3 米、伤害 +50%' },
      { rank: 5, name: '空中冲刺', text: '在空中也能冲刺，每次起跳一次' },
      { rank: 10, name: '擦弹', text: '冲刺的无敌时间里躲掉一次攻击，这次冲刺的充能立刻还回来，另充 5% 大招' },
    ],
  },
  energy: {
    name: '能量',
    icon: 'cooldown',
    per: '每级：技能冷却 −3%，大招充能快 3%',
    milestones: [
      { rank: 2, name: '不断', text: '连杀的间隔从 3 秒放宽到 4.5 秒' },
      { rank: 5, name: '回路', text: '一次技能伤到或眩晕 3 个以上的敌人，还回这个技能 30% 的冷却' },
      { rank: 10, name: '超载', text: '星光连射从 12 发加到 16 发；放完大招，两个技能立刻冷却好' },
    ],
  },
}

export const MILESTONE = {
  recycleGap: 1,
  extraBurst: 1,
  foodHeal: 0.2,
  foodMagnet: 6,
  aftershockRadius: 2.5,
  aftershockReel: 0.6,
  aftershockPush: 1.2,
  overhealCap: 200,
  desperateBelow: 0.3,
  desperateCooldown: 0.5,
  leverageWindow: 1,
  leverageReach: 3,
  leverageDamage: 1.5,
  airDashes: 1,
  grazeUlt: 0.05,
  streakWindow: 4.5,
  circuitHits: 3,
  circuitRefund: 0.3,
  overloadShots: 4,
} as const

export const STAT_FLOOR = 0.2

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
