import type { Theme } from './levels/types'

export const KEG = {
  symbol: '!',
  fuse: 0.4,
  radius: 2.5,
  enemyDamage: 400,
  playerDamage: 200,
  startClear: 6,
  meleeReach: [1.2, 1.9],
} as const

export const HAY_FIRE = {
  seconds: 6,
  tick: 0.5,
  damage: 40,
  reach: 1,
  burnPower: 80,
  burnSeconds: 1,
} as const

export const HAY_THEMES: readonly Theme[] = ['farm', 'village']
