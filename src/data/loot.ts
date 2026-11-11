import type { MinionKind } from './enemies'
import type { PlayerWeaponId } from './weapons'

export type BuffId = 'frenzy' | 'might' | 'swift' | 'shield' | 'infinite' | 'leech'

export type ChestTier = 'normal' | 'weapon' | 'rare'

export type DropType = 'heal' | 'buff' | 'ammo' | 'weapon'

export type FoodKind = 'bread' | 'apple'

export type BuffDef = {
  name: string
  duration: number
  value: number
}

export const BUFF_ORDER: readonly BuffId[] = ['frenzy', 'might', 'swift', 'shield', 'infinite', 'leech']

export const BUFFS: Readonly<Record<BuffId, BuffDef>> = {
  frenzy: { name: '狂热', duration: 15, value: 0.3 },
  might: { name: '强攻', duration: 15, value: 0.25 },
  swift: { name: '疾风', duration: 12, value: 0.25 },
  shield: { name: '护盾', duration: 20, value: 300 },
  infinite: { name: '无限弹药', duration: 8, value: 0 },
  leech: { name: '吸血', duration: 15, value: 0.05 },
}

export const CHEST_NAMES: Readonly<Record<ChestTier, string>> = {
  normal: '宝箱',
  weapon: '武器宝箱',
  rare: '稀有宝箱',
}

export const DROP_RATES: Readonly<Record<MinionKind, number>> = {
  grunt: 0.08,
  gunner: 0.1,
  bomber: 0.08,
  turret: 0.25,
  shield: 0.15,
  thrower: 0.1,
}

export const DROP_PITY = 8

export const DROP_WEIGHTS: Readonly<Record<DropType, number>> = {
  heal: 35,
  buff: 30,
  ammo: 30,
  weapon: 5,
}

export const ELITE_WEIGHTS: Readonly<Record<DropType, number>> = {
  heal: 15,
  buff: 40,
  ammo: 25,
  weapon: 20,
}

export const CHEST_WEIGHTS: Readonly<Record<DropType, number>> = {
  heal: 35,
  buff: 30,
  ammo: 20,
  weapon: 0,
}

export const CHEST_ITEMS_MIN = 2
export const CHEST_ITEMS_MAX = 3

export const HEAL_SMALL = 0.2
export const HEAL_LARGE = 0.5
export const HEAL_LARGE_CHANCE = 0.2
export const AMMO_REFILL = 0.5

export const PICKUP_LIFETIME = 20
export const PICKUP_BLINK = 5
export const PICKUP_SCATTER_MIN = 0.35
export const PICKUP_SCATTER_MAX = 0.85
export const PICKUP_BODY = 0.3
export const CHEST_REACH = 0.45
export const PICKUP_DELAY = 0.3
export const PICKUP_RADIUS = 0.45
export const PICKUP_REACH_UP = 1
export const INTERACT_RANGE = 2
export const INTERACT_AIM_DEG = 35
export const INTERACT_TILT_DEG = 60
export const INTERACT_NEAR = 1.2
export const INTERACT_HEIGHTS = { weapon: 0.3, chest: 0.5, pen: 0.8, lamp: 1.6 } as const

export const CRATE_HP = 400
export const CRATE_DROP_CHANCE = 0.3
export const CRATE_AMMO_CHANCE = 0.3

export const SUPPLY_HEAL = 0.5
export const SUPPLY_RADIUS = 0.9

export const BOSS_HEAL = HEAL_LARGE

export const FOOD_HEAL = 0.15
export const PICKUP_MAGNET = { radius: 4, speed: 14 } as const

export const FOOD_NAMES: Readonly<Record<FoodKind, string>> = {
  bread: '麦饼',
  apple: '苹果',
}

export const CLEAR_WEAPONS: Readonly<Record<string, PlayerWeaponId>> = {
  '1-1': 'shotgun',
  '1-2': 'smg',
  '1-3': 'ricochet',
  '1-4': 'sniper',
  '1-5': 'rocket',
}

export const CHAPTER_WEAPONS: Readonly<Record<number, readonly PlayerWeaponId[]>> = {
  1: ['shotgun', 'smg', 'sniper', 'grenade', 'ricochet', 'flamer', 'frost', 'rocket', 'arc'],
}
