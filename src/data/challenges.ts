export type ChallengeId = 'flawless' | 'sweep' | 'secret' | 'stealth' | 'lamps'

export type ChallengeDef = {
  name: string
  text: string
  xp: number
}

export const CHALLENGE_ORDER: readonly ChallengeId[] = ['flawless', 'sweep', 'secret', 'stealth', 'lamps']

export const CHALLENGES: Readonly<Record<ChallengeId, ChallengeDef>> = {
  flawless: { name: '无伤', text: '一次都没挨打', xp: 30 },
  sweep: { name: '全歼', text: '击败关卡里所有的敌人', xp: 20 },
  secret: { name: '探秘', text: '找到所有隐藏区', xp: 20 },
  stealth: { name: '潜行', text: '潜入段没有敲响警报钟', xp: 25 },
  lamps: { name: '点灯', text: '点亮全部驱雾灯', xp: 25 },
}

export function isChallengeId(value: unknown): value is ChallengeId {
  return typeof value === 'string' && (CHALLENGE_ORDER as readonly string[]).includes(value)
}
