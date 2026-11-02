import type { MinionKind } from '../data/enemies'
import type { BuffId, ChestTier } from '../data/loot'
import type { AttributeId } from '../data/progression'
import type { SkillId } from '../data/skills'
import type { PlayerWeaponId } from '../data/weapons'

export const PORTRAIT_IDS = [
  'kai-normal',
  'kai-happy',
  'kai-angry',
  'kai-surprised',
  'greyhawk-normal',
  'aunt-mai-normal',
  'alo-normal',
  'bolt-normal',
  'lao-tang-normal',
  'mingzhu-normal',
  'scarecrow',
  'scarecrow-wanted',
  'demo-chief-wanted',
  'shield-captain-wanted',
  'forest-tank-wanted',
  'harvester-wanted',
  'harvester',
  'demo-chief',
  'shield-captain',
  'forest-tank',
] as const

export type PortraitId = (typeof PORTRAIT_IDS)[number]

export const SCENE_IDS = [
  'prep-observatory',
  'prologue',
  'chapter-1-title',
  'chapter-1',
  'archipelago',
  'card-1-1',
  'card-1-2',
  'card-1-3',
  'card-1-4',
  'card-1-5',
  'card-trial-systems',
  'card-trial-harvester',
] as const

export type SceneId = (typeof SCENE_IDS)[number]

export type ItemIcon = 'heal' | 'ammo' | 'supply' | 'shard' | 'emblem' | 'food-bread' | 'food-apple' | `chest-${ChestTier}`

export const ITEM_ICONS: readonly ItemIcon[] = ['heal', 'ammo', 'supply', 'shard', 'emblem', 'food-bread', 'food-apple', 'chest-normal', 'chest-weapon', 'chest-rare']

export type MapIcon = `chest-${ChestTier}` | 'supply' | 'exit' | 'boss' | 'shard' | 'branch'

export const MAP_ICONS: readonly MapIcon[] = ['chest-normal', 'chest-weapon', 'chest-rare', 'supply', 'exit', 'boss', 'shard', 'branch']

export const CHARACTER_MODEL_IDS = ['kai'] as const
export const VIEWMODEL_MODEL_IDS = ['fp-arms'] as const
export const ANIMAL_MODEL_IDS = ['sheep'] as const
export const WEAPON_MODEL_IDS = [
  'blaster',
  'shotgun',
  'smg',
  'sniper',
  'grenade',
  'ricochet',
  'flamer',
  'frost',
  'rocket',
  'arc',
] as const satisfies readonly PlayerWeaponId[]
export const ENEMY_MODEL_IDS = ['grunt', 'gunner', 'bomber', 'turret', 'shield', 'thrower'] as const satisfies readonly MinionKind[]
export const ELITE_MODEL_IDS = ['elite-crown'] as const
export const BOSS_MODEL_IDS = ['scarecrow', 'harvester', 'shard-morning', 'demo-chief', 'shield-captain', 'forest-tank'] as const
export const PROP_MODEL_IDS = [
  'chest-normal',
  'chest-weapon',
  'chest-rare',
  'campfire',
  'campfire-burnt',
  'crate',
  'crate-broken',
  'ch1-ladder',
] as const
export const PROJECTILE_MODEL_IDS = ['rocket-shell', 'grenade-shell', 'legion-bomb', 'wheat-bale', 'falling-blade', 'mine'] as const
export const SCENE_MODEL_IDS = [
  'ch1-wall-wood',
  'ch1-wall-wood-b',
  'ch1-wall-wood-c',
  'ch1-wall-stone',
  'ch1-wall-stone-b',
  'ch1-wall-stone-c',
  'ch1-wall-rock',
  'ch1-wall-rock-b',
  'ch1-wall-rock-c',
  'ch1-wall-metal',
  'ch1-wall-metal-b',
  'ch1-wall-metal-c',
  'ch1-rock',
  'ch1-rock-b',
  'ch1-rock-c',
  'ch1-haystack',
  'ch1-haystack-b',
  'ch1-haystack-c',
  'ch1-tree',
  'ch1-tree-b',
  'ch1-tree-c',
  'ch1-bush-wheat',
  'ch1-bush-wheat-b',
  'ch1-bush-wheat-c',
  'ch1-bush-grass',
  'ch1-bush-grass-b',
  'ch1-bush-grass-c',
  'ch1-fence',
  'ch1-bridge',
  'ch1-gate',
  'ch1-cart',
] as const
export const LANDMARK_MODEL_IDS = [
  'ch1-town-gate',
  'ch1-windmill',
  'ch1-star-altar',
  'ch1-wheat-ears',
  'ch1-wheat-ears-b',
  'ch1-wheat-ears-c',
  'ch1-sheep-pen',
  'ch1-feed-shed',
  'ch1-dock',
  'ch1-hay-cart',
  'ch1-hay-cart-wreck',
  'ch1-hay-pillar',
  'ch1-hay-pillar-collapsed',
  'ch1-watermill',
  'ch1-ruined-wall',
  'ch1-ruined-wall-b',
  'ch1-ruined-wall-c',
  'ch1-smithy',
  'ch1-wheat-stack',
  'ch1-wheat-stack-b',
  'ch1-wheat-stack-c',
  'ch1-bell-tower',
  'ch1-farmhouse',
  'ch1-well',
  'ch1-cellar',
  'ch1-silo',
  'grunt-wreck',
  'ch1-log',
  'ch1-log-short',
  'ch1-fog-lamp',
  'ch1-cabin',
  'ch1-waterfall-cave',
  'ch1-sawmill',
  'ch1-stump',
  'ch1-stump-b',
  'ch1-stump-c',
  'grunt-wreck-drawing',
  'ch1-blade-trap',
  'ch1-bale-block',
  'ch1-bale-block-b',
  'ch1-bale-block-c',
  'ch1-anchor-crate',
  'ch1-anchor-crate-b',
  'ch1-anchor-crate-c',
  'ch1-airship',
  'ch1-factory-gate',
] as const

export const MODEL_IDS = [
  ...CHARACTER_MODEL_IDS,
  ...VIEWMODEL_MODEL_IDS,
  ...ANIMAL_MODEL_IDS,
  ...WEAPON_MODEL_IDS,
  ...ENEMY_MODEL_IDS,
  ...ELITE_MODEL_IDS,
  ...BOSS_MODEL_IDS,
  ...PROP_MODEL_IDS,
  ...PROJECTILE_MODEL_IDS,
  ...SCENE_MODEL_IDS,
  ...LANDMARK_MODEL_IDS,
] as const

export type ModelId = (typeof MODEL_IDS)[number]

export const RESIDENT_MODEL_IDS: readonly ModelId[] = [
  ...CHARACTER_MODEL_IDS,
  ...VIEWMODEL_MODEL_IDS,
  ...WEAPON_MODEL_IDS,
  ...PROJECTILE_MODEL_IDS,
  ...ANIMAL_MODEL_IDS,
  'crate',
  'crate-broken',
]

const BASE = `${import.meta.env.BASE_URL}assets/`

export const assetUrl = {
  buff: (id: BuffId) => `${BASE}ui/buffs/${id}.png`,
  skill: (id: SkillId) => `${BASE}ui/skills/${id}.png`,
  attribute: (id: AttributeId) => `${BASE}ui/attributes/${id}.png`,
  weapon: (id: PlayerWeaponId) => `${BASE}ui/weapons/${id}.png`,
  item: (id: ItemIcon) => `${BASE}ui/items/${id}.png`,
  mapIcon: (id: MapIcon) => `${BASE}ui/map/${id}.png`,
  portrait: (id: PortraitId) => `${BASE}portraits/${id}.png`,
  scene: (id: SceneId) => `${BASE}scenes/${id}.jpg`,
  logo: () => `${BASE}scenes/logo.png`,
  model: (id: ModelId) => `${BASE}models/${id}.glb`,
  basis: () => `${BASE}basis/`,
}
