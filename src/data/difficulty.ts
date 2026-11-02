export type DifficultyId = 'easy' | 'normal' | 'hard'

export type Difficulty = {
  name: string
  blurb: string
  lead: number
  track: number
  rushRate: number
  slots: number
  volleyGap: number
  regen: boolean
}

export const DIFFICULTY_ORDER: readonly DifficultyId[] = ['easy', 'normal', 'hard']

export const DEFAULT_DIFFICULTY: DifficultyId = 'normal'

export const DIFFICULTIES: Readonly<Record<DifficultyId, Difficulty>> = {
  easy: {
    name: '简单',
    blurb: '射手很少预判走位，冲锋兵冲得少，一次只有一个敌人贴身',
    lead: 0.3,
    track: 0.5,
    rushRate: 1.8,
    slots: -1,
    volleyGap: 1.6,
    regen: true,
  },
  normal: {
    name: '普通',
    blurb: '射手会预判你的走位，冲锋兵会冲锋和包抄，同时最多两个敌人贴身',
    lead: 1,
    track: 1,
    rushRate: 1,
    slots: 0,
    volleyGap: 1,
    regen: false,
  },
  hard: {
    name: '困难',
    blurb: '射手瞄得更久更准，冲锋更频繁，同时最多三个敌人贴身',
    lead: 1.12,
    track: 1.3,
    rushRate: 0.7,
    slots: 1,
    volleyGap: 0.7,
    regen: false,
  },
}

export function isDifficultyId(value: unknown): value is DifficultyId {
  return typeof value === 'string' && (DIFFICULTY_ORDER as readonly string[]).includes(value)
}
