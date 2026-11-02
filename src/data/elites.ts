export type AffixId = 'tough' | 'swift' | 'shielded' | 'splitter' | 'volatile'

export type AffixDef = {
  name: string
  hint: string
}

export const AFFIX_ORDER: readonly AffixId[] = ['tough', 'swift', 'shielded', 'splitter', 'volatile']

export const AFFIXES: Readonly<Record<AffixId, AffixDef>> = {
  tough: { name: '坚韧', hint: '生命更多、体型更大' },
  swift: { name: '迅捷', hint: '移动和出手都更快' },
  shielded: { name: '护盾', hint: '带一层会恢复的能量护盾' },
  splitter: { name: '分裂', hint: '倒下时分裂成两个小个子' },
  volatile: { name: '爆裂', hint: '倒下后原地爆炸' },
}

export const ELITE = {
  hpScale: 1.6,
  sizeScale: 1.15,
  toughHp: 2,
  toughSize: 1.15,
  swiftSpeed: 1.4,
  swiftCooldown: 0.75,
  shieldShare: 0.4,
  shieldDelay: 4,
  shieldRegen: 0.25,
  splitCount: 2,
  splitHp: 0.4,
  splitSize: 0.8,
  splitSpread: 0.6,
  volatileRadius: 1.8,
  volatileDamage: 150,
  volatileDelay: 0.7,
}
