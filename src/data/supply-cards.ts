export type CardId = 'frenzy' | 'might' | 'swift' | 'shield' | 'charge' | 'leech'

export interface CardDef {
  name: string
  text: string
}

export const CARD_ORDER: readonly CardId[] = ['frenzy', 'might', 'swift', 'shield', 'charge', 'leech']

export const CARDS: Readonly<Record<CardId, CardDef>> = {
  frenzy: { name: '狂热', text: '射速 +12%' },
  might: { name: '强攻', text: '伤害 +10%' },
  swift: { name: '疾风', text: '移速 +10%' },
  shield: { name: '护盾', text: '每 30 秒自动回一层 150 的护盾' },
  charge: { name: '充能', text: '能量枪回弹药快 25%' },
  leech: { name: '吸血', text: '造成伤害的 2% 转成生命' },
}

export const CARD = {
  offer: 3,
  apprenticeOffer: 4,
  frenzy: 0.12,
  might: 0.1,
  swift: 0.1,
  shieldEvery: 30,
  shieldAmount: 150,
  charge: 0.25,
  leech: 0.02,
} as const
