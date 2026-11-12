export type BountyId =
  | 'friendly'
  | 'sneak'
  | 'smash'
  | 'streak'
  | 'crits'
  | 'thrifty'
  | 'defuse'
  | 'kegs'
  | 'airborne'
  | 'elite'
  | 'courier'
  | 'speed'
  | 'pens'
  | 'shepherd'

export type BountyNeed = 'always' | 'friendly' | 'bombers' | 'rushes' | 'kegs' | 'elites' | 'courier' | 'pens'

export interface BountyDef {
  name: string
  text: string
  goal: number
  xp: number
  need: BountyNeed
  hold: boolean
}

export const BOUNTY_ORDER: readonly BountyId[] = ['friendly', 'sneak', 'smash', 'streak', 'crits', 'thrifty', 'defuse', 'kegs', 'airborne', 'elite', 'courier', 'speed', 'pens', 'shepherd']

export const BOUNTIES: Readonly<Record<BountyId, BountyDef>> = {
  friendly: { name: '借刀', text: '让敌人炸死或摔死 3 个自己人', goal: 3, xp: 30, need: 'friendly', hold: false },
  sneak: { name: '背后一下', text: '偷袭砸散 4 个', goal: 4, xp: 30, need: 'always', hold: false },
  smash: { name: '铁拳', text: '近战砸散 10 个', goal: 10, xp: 20, need: 'always', hold: false },
  streak: { name: '停不下来', text: '打出一次五连', goal: 1, xp: 30, need: 'rushes', hold: false },
  crits: { name: '神枪手', text: '暴击击倒 8 个', goal: 8, xp: 25, need: 'always', hold: false },
  thrifty: { name: '省子弹', text: '不用特殊武器通关', goal: 1, xp: 25, need: 'always', hold: true },
  defuse: { name: '拆弹', text: '在自爆兵点引信的那半秒里击倒 3 个', goal: 3, xp: 30, need: 'bombers', hold: false },
  kegs: { name: '爆破手', text: '用火药桶击倒 5 个', goal: 5, xp: 25, need: 'kegs', hold: false },
  airborne: { name: '不落地', text: '在空中击倒 3 个', goal: 3, xp: 30, need: 'always', hold: false },
  elite: { name: '精英猎人', text: '击倒 1 个精英', goal: 1, xp: 40, need: 'elites', hold: false },
  courier: { name: '抓住它', text: '打掉背麻袋的运粮兵', goal: 1, xp: 40, need: 'courier', hold: false },
  speed: { name: '快手', text: '随便哪个区域，从进去到清完不超过限时', goal: 1, xp: 25, need: 'always', hold: false },
  pens: { name: '放羊', text: '打开全部羊圈', goal: 1, xp: 15, need: 'pens', hold: false },
  shepherd: { name: '牧羊人', text: '一只羊都没被炸到', goal: 1, xp: 20, need: 'pens', hold: true },
}

export const BOUNTY = {
  board: 3,
  streak: 5,
  speedBase: 10,
  speedPerEnemy: 3,
  sheepMargin: 0.5,
  boardSalt: 7919,
} as const

export const BOARD_LINES: readonly string[] = [
  '麦婶：今天的活儿都在板上，挑顺手的接。',
  '麦婶：揭了就得办成，办成了赏钱一分不少。',
  '麦婶：别光顾着打，悬赏写的是怎么打。',
]
