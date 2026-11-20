export type EnemyRole = 'courier' | 'bolt'

export const RARE_SEED_SALT = 0x6c8e9cf5

export const COURIER = {
  firstChance: 0.35,
  replayChance: 0.5,
  skipFirstLevel: '1-1',
  hp: 500,
  speed: 5.5,
  fleeSeconds: 12,
  exitReach: 2.2,
  minSpawnDistance: 6,
  leakShare: 0.25,
  maxLeaks: 3,
  foodDrops: 3,
  weaponChance: 0.3,
  xp: 25,
  barkSeconds: 3.5,
} as const

export const BOLT_CAMEO = {
  unlockAfter: '1-5',
  chance: 0.2,
  halfShare: 0.5,
  warning: 1.5,
  blastRadius: 2.5,
  blastDamage: 150,
  hp: 1500,
  retreatShare: 0.3,
  xp: 25,
  dropMinRange: 5.5,
  dropMaxRange: 13,
  barkSeconds: 4,
} as const

export const COURIER_LINES: readonly string[] = [
  '对不起！这袋先借走，回头补借条！',
  '借过借过！家里还等米下锅呢！',
  '抱歉！麻袋太沉了，先走一步！',
]

export const BOLT_ARRIVE_LINES: readonly string[] = [
  '哈哈！想不到吧！备用逃生舱也能开炮！',
  '站住！本上尉顺路来收点利息！',
]

export const BOLT_RETREAT_LINES: readonly string[] = [
  '弹射！弹射！……箱子算我借你的，下次再算账！',
  '装甲报警了？撤！弹射！你给我记住！',
]
