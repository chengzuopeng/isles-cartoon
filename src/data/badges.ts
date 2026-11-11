export type BadgeId = 'straw' | 'fuse' | 'door' | 'tread' | 'star' | 'apprentice' | 'veteran' | 'iou' | 'stars' | 'flawless'

export interface BadgeDef {
  name: string
  how: string
  text: string
}

export const BADGE_ORDER: readonly BadgeId[] = ['straw', 'fuse', 'door', 'tread', 'star', 'apprentice', 'veteran', 'iou', 'stars', 'flawless']

export const BADGES: Readonly<Record<BadgeId, BadgeDef>> = {
  straw: { name: '草帽', how: '首次打败铁皮稻草人（1-1）', text: '在草丛和麦田里移速 +20%；走出草丛后 2 秒内，敌人的发现值涨得慢一半' },
  fuse: { name: '引信', how: '首次打败爆破头目（1-2）', text: '你引发的爆炸（榴弹、火箭、震荡雷、火药桶）范围 +25%；自己挨爆炸的伤害减半' },
  door: { name: '门板', how: '首次打败铁盾队长（1-3）', text: '近战挥出去的 0.3 秒里，正面飞来的子弹被打飞' },
  tread: { name: '履带', how: '首次打败林地炮车（1-4）', text: '受到的击退和减速减半；冲刺撞开敌人的距离翻倍' },
  star: { name: '晨星碎片', how: '首次打败巨型收割机（1-5）', text: '大招充满着没放的时候，所有伤害 +10%；放大招时回 20% 生命' },
  apprentice: { name: '见习猎人章', how: '累计完成 5 张悬赏令', text: '补给点多一张卡可选，三选一变四选一' },
  veteran: { name: '老练猎人章', how: '累计完成 15 张悬赏令', text: '打出三连时还回一次冲刺' },
  iou: { name: '借条夹', how: '集齐第 1 章的 5 条线索', text: '砸散的机器人有 20% 多掉一个吃的' },
  stars: { name: '三星章', how: '第 1 章 5 关全部三星', text: '暴击伤害从 2 倍提到 2.3 倍' },
  flawless: { name: '毫发无伤', how: '任意一关完成「无伤」挑战', text: '生命全满时移速 +8%' },
}

export const BOSS_BADGES: Readonly<Record<string, BadgeId>> = {
  '1-1': 'straw',
  '1-2': 'fuse',
  '1-3': 'door',
  '1-4': 'tread',
  '1-5': 'star',
}

export const BADGE_SLOT_LEVELS: readonly number[] = [1, 5, 12]

export const BADGE = {
  strawSpeed: 0.2,
  strawLinger: 2,
  strawNotice: 0.5,
  fuseRadius: 1.25,
  fuseSelf: 0.5,
  doorWindow: 0.3,
  doorFront: 0.5,
  treadScale: 0.5,
  treadShove: 2,
  starDamage: 0.1,
  starHeal: 0.2,
  apprenticeBounties: 5,
  veteranBounties: 15,
  veteranStreak: 3,
  iouChance: 0.2,
  starsCrit: 2.3,
  flawlessSpeed: 0.08,
  clueChapter: 1,
  starLevels: ['1-1', '1-2', '1-3', '1-4', '1-5'],
} as const
