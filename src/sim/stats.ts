import { BUFFS } from '../data/loot'
import { MILESTONE, SPECS, SPEC_BONUS, SPEC_ORDER, STAT_FLOOR, type SpecId } from '../data/progression'
import type { SkillBranch, SkillId, SkillSlot } from '../data/skills'
import { LEGACY_REGEN, type Tuning } from '../data/tuning'
import type { PlayerWeaponId } from '../data/weapons'
import { hasBuff } from './buffs'
import type { World } from './world'

export type SpecRanks = Record<SpecId, number>

export type MilestoneId = `${SpecId}${2 | 5 | 10}`

export interface EquippedSkill {
  slot: SkillSlot
  id: SkillId
  rank: number
  branch?: SkillBranch
}

export interface Loadout {
  specs: SpecRanks
  skills: EquippedSkill[]
  special: PlayerWeaponId | null
}

export interface PlayerStats {
  speed: number
  damage: number
  meleeDamage: number
  fireInterval: number
  reload: number
  dashRecharge: number
  ultCharge: number
  streakWindow: number
  regenRate: number
  regenDelay: number
  skillCooldown: number
}

export function emptySpecs(): SpecRanks {
  const ranks = {} as SpecRanks
  for (const id of SPEC_ORDER) ranks[id] = 0
  return ranks
}

export function createLoadout(specs: Partial<SpecRanks> = {}, skills: EquippedSkill[] = [], special: PlayerWeaponId | null = null): Loadout {
  return { specs: { ...emptySpecs(), ...specs }, skills: skills.map((skill) => ({ ...skill })), special }
}

export function reached(specs: SpecRanks, id: MilestoneId): boolean {
  const spec = id.replace(/\d+$/, '') as SpecId
  const rank = Number(id.slice(spec.length))
  return specs[spec] >= rank && SPECS[spec].milestones.some((item) => item.rank === rank)
}

export function hasMilestone(world: World, id: MilestoneId): boolean {
  return reached(world.loadout.specs, id)
}

export function maxHpFor(tuning: Tuning, loadout: Loadout): number {
  return Math.round(tuning.player.maxHp * (1 + SPEC_BONUS.brawl.health * loadout.specs.brawl))
}

export function magazineFor(tuning: Tuning, _loadout: Loadout): number {
  return Math.max(1, Math.round(tuning.weapons.blaster.magazine))
}

export function createStats(): PlayerStats {
  return { speed: 0, damage: 1, meleeDamage: 1, fireInterval: 1, reload: 1, dashRecharge: 1, ultCharge: 1, streakWindow: 3, regenRate: 0, regenDelay: 0, skillCooldown: 1 }
}

export function refreshStats(world: World): PlayerStats {
  const { tuning, player, playerStats: stats } = world
  const specs = world.loadout.specs
  const legacy = tuning.player.legacyRegen >= 1
  const swift = hasBuff(player, 'swift') ? 1 + BUFFS.swift.value : 1
  const might = hasBuff(player, 'might') ? 1 + BUFFS.might.value : 1
  const frenzy = hasBuff(player, 'frenzy') ? 1 + BUFFS.frenzy.value : 1
  stats.speed = tuning.player.speed * (1 + SPEC_BONUS.move.speed * specs.move) * swift
  stats.damage = (1 + SPEC_BONUS.gun.damage * specs.gun) * might
  stats.meleeDamage = (1 + SPEC_BONUS.brawl.melee * specs.brawl) * might
  stats.fireInterval = 1 / frenzy
  stats.reload = 1 / (1 + SPEC_BONUS.gun.recharge * specs.gun)
  stats.dashRecharge = 1 / (1 + SPEC_BONUS.move.dash * specs.move)
  stats.ultCharge = 1 + SPEC_BONUS.energy.ult * specs.energy
  stats.streakWindow = reached(specs, 'energy2') ? MILESTONE.streakWindow : tuning.player.streak.window
  stats.regenRate = legacy ? LEGACY_REGEN.perSecond : tuning.player.regenPerSecond
  stats.regenDelay = legacy ? LEGACY_REGEN.delay : tuning.player.regenDelay
  stats.skillCooldown = Math.max(STAT_FLOOR, 1 - SPEC_BONUS.energy.cooldown * specs.energy)
  return stats
}
