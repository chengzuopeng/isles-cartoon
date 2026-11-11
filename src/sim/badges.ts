import { BADGE, type BadgeId } from '../data/badges'
import type { World } from './world'

export function hasBadge(world: World, id: BadgeId): boolean {
  return world.loadout.badges.includes(id)
}

export function starPower(world: World): number {
  return hasBadge(world, 'star') && world.player.ultimate >= 1 && world.player.ultShots === 0 ? 1 + BADGE.starDamage : 1
}

export function critScale(world: World, base: number): number {
  return hasBadge(world, 'stars') ? BADGE.starsCrit * (base / 2) : base
}
