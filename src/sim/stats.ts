import { BUFFS } from '../data/loot'
import {
  ATTRIBUTES,
  ATTRIBUTE_ORDER,
  MIN_REGEN_DELAY,
  RECOVERY_DELAY_PER_RANK,
  STAT_FLOOR,
  type AttributeId,
} from '../data/progression'
import type { SkillId, SkillSlot } from '../data/skills'
import type { PlayerWeaponId } from '../data/weapons'
import { LEGACY_REGEN, type Tuning } from '../data/tuning'
import { hasBuff } from './buffs'
import type { World } from './world'

export type AttributeRanks = Record<AttributeId, number>

export interface EquippedSkill {
  slot: SkillSlot
  id: SkillId
  rank: number
}

export interface Loadout {
  attributes: AttributeRanks
  skills: EquippedSkill[]
  special: PlayerWeaponId | null
}

export interface PlayerStats {
  speed: number
  damage: number
  fireInterval: number
  reload: number
  regenRate: number
  regenDelay: number
  skillCooldown: number
}

export function emptyRanks(): AttributeRanks {
  const ranks = {} as AttributeRanks
  for (const id of ATTRIBUTE_ORDER) ranks[id] = 0
  return ranks
}

export function createLoadout(attributes: Partial<AttributeRanks> = {}, skills: EquippedSkill[] = [], special: PlayerWeaponId | null = null): Loadout {
  return { attributes: { ...emptyRanks(), ...attributes }, skills: skills.map((skill) => ({ ...skill })), special }
}

export function attributeBonus(ranks: AttributeRanks, id: AttributeId): number {
  return ATTRIBUTES[id].perRank * ranks[id]
}

export function maxHpFor(tuning: Tuning, loadout: Loadout): number {
  return Math.round(tuning.player.maxHp * (1 + attributeBonus(loadout.attributes, 'health')))
}

export function magazineFor(tuning: Tuning, loadout: Loadout): number {
  return Math.max(1, Math.round(tuning.weapons.blaster.magazine)) + loadout.attributes.magazine
}

export function createStats(): PlayerStats {
  return { speed: 0, damage: 1, fireInterval: 1, reload: 1, regenRate: 0, regenDelay: 0, skillCooldown: 1 }
}

export function refreshStats(world: World): PlayerStats {
  const { tuning, player, playerStats: stats } = world
  const ranks = world.loadout.attributes
  const legacy = tuning.player.legacyRegen >= 1
  const swift = hasBuff(player, 'swift') ? 1 + BUFFS.swift.value : 1
  const might = hasBuff(player, 'might') ? 1 + BUFFS.might.value : 1
  const frenzy = hasBuff(player, 'frenzy') ? 1 + BUFFS.frenzy.value : 1
  stats.speed = tuning.player.speed * (1 + attributeBonus(ranks, 'speed')) * swift
  stats.damage = (1 + attributeBonus(ranks, 'damage')) * might
  stats.fireInterval = Math.max(STAT_FLOOR, 1 - attributeBonus(ranks, 'fireRate')) / frenzy
  stats.reload = Math.max(STAT_FLOOR, 1 - attributeBonus(ranks, 'reload'))
  const baseRate = legacy ? LEGACY_REGEN.perSecond : tuning.player.regenPerSecond
  const baseDelay = legacy ? LEGACY_REGEN.delay : tuning.player.regenDelay
  stats.regenRate = baseRate * (1 + attributeBonus(ranks, 'recovery'))
  stats.regenDelay = Math.max(MIN_REGEN_DELAY, baseDelay - RECOVERY_DELAY_PER_RANK * ranks.recovery)
  stats.skillCooldown = Math.max(STAT_FLOOR, 1 - attributeBonus(ranks, 'cooldown'))
  return stats
}
