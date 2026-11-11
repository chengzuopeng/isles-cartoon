export type ChainKind = 'shatter' | 'fuse' | 'pileup' | 'friendly' | 'chain' | 'fall'

export const CHAIN = {
  pileupPush: 2,
  pileupReel: 1,
  pileupCone: 0.5,
  chainDelay: 0.3,
  looseKnock: 2,
  gravity: 22,
  fallMin: 1,
  fallDamage: 80,
  fallReel: 1.5,
} as const

export const CHAIN_WORDS: Readonly<Record<ChainKind, string>> = {
  shatter: '碎了！',
  fuse: '着火了！',
  pileup: '撞车！',
  friendly: '自己人！',
  chain: '连环爆！',
  fall: '摔下去了！',
}
