import type { PlayerWeaponId, WeaponDef, WeaponId } from '../data/weapons'
import { attackOf } from './attacks'
import { spawnBullet } from './projectiles'
import { muzzleOf, playerChest } from './terrain'
import type { Attack, Enemy, MinionKind, Player, Team } from './types'
import type { World } from './world'

export const ENEMY_WEAPON: Readonly<Record<MinionKind, WeaponId>> = {
  grunt: 'claw',
  gunner: 'rifle',
  bomber: 'fuse',
  turret: 'cannon',
  shield: 'bash',
  thrower: 'bomb',
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

export interface FireOptions {
  stagger?: number
  damageScale?: number
  attack?: Attack | null
  z?: number
  pitch?: number
}

export function weaponOf(world: World, id: WeaponId): WeaponDef {
  return world.tuning.weapons[id]
}

export function activeWeaponId(player: Player): PlayerWeaponId {
  return player.slot === 'special' && player.special ? player.special : player.primary
}

export function specialMagazine(world: World, id: PlayerWeaponId): number {
  return Math.max(1, Math.round(weaponOf(world, id).magazine))
}

export function firePattern(
  world: World,
  team: Team,
  x: number,
  y: number,
  offset: number,
  angle: number,
  id: WeaponId,
  options: FireOptions = {},
): void {
  const weapon = weaponOf(world, id)
  const stagger = options.stagger ?? 0
  const count = Math.max(1, Math.round(weapon.pellets))
  const spread = (weapon.spreadDeg * Math.PI) / 180
  const jitter = (weapon.jitterDeg * Math.PI) / 180
  const pitch = options.pitch ?? 0
  const bullet = { damageScale: options.damageScale ?? 1, attack: options.attack ?? null, z: options.z }
  if (team === 'player') {
    for (let i = 0; i < count; i++) {
      const ring = count > 1 ? (spread / 2) * Math.sqrt((i + 0.5) / count) : 0
      const turn = i * GOLDEN_ANGLE
      const wobble = jitter > 0 ? jitter * Math.sqrt(world.rng.next()) : 0
      const swirl = jitter > 0 ? world.rng.range(0, Math.PI * 2) : 0
      const yaw = angle + ring * Math.cos(turn) + wobble * Math.cos(swirl)
      const tilt = pitch + ring * Math.sin(turn) + wobble * Math.sin(swirl)
      spawnBullet(world, team, x, y, offset, yaw, id, { ...bullet, pitch: tilt })
    }
    return
  }
  const gap = count > 1 ? spread / (count - 1) : 0
  for (let i = 0; i < count; i++) {
    const base = count === 1 ? 0 : -spread / 2 + gap * i
    const wobble = jitter > 0 ? world.rng.range(-jitter, jitter) : 0
    const aim = angle + base + stagger * gap + wobble
    spawnBullet(world, team, x, y, offset, aim, id, { ...bullet, pitch })
  }
}

export function fireEnemyWeapon(world: World, enemy: Enemy, id: WeaponId, angle: number, stagger = 0, lockedPitch: number | null = null): void {
  const offset = enemy.radius + 0.12
  const muzzle = muzzleOf(enemy)
  const chest = playerChest(world.player)
  const reach = Math.max(0.1, Math.hypot(chest.x - muzzle.x, chest.y - muzzle.y))
  const pitch = lockedPitch ?? Math.atan2(chest.z - muzzle.z, reach)
  const flat = Math.cos(pitch) * offset
  firePattern(world, 'enemy', enemy.pos.x, enemy.pos.y, offset, angle, id, { stagger, attack: attackOf(enemy, id), z: muzzle.z, pitch })
  world.events.push({
    type: 'enemyShot',
    x: enemy.pos.x + Math.cos(angle) * flat,
    y: enemy.pos.y + Math.sin(angle) * flat,
    z: muzzle.z + Math.sin(pitch) * offset,
    angle,
    pitch,
    weapon: id,
  })
}

export function equipSpecial(world: World, id: PlayerWeaponId, ammo: number): void {
  const { player } = world
  player.special = id
  player.specialAmmo = Math.max(1, Math.round(ammo))
  player.slot = 'special'
  player.burstLeft = 0
  world.events.push({ type: 'weaponChanged', weapon: id, slot: 'special' })
}

export function giveSpecialWeapon(world: World, id: PlayerWeaponId): void {
  equipSpecial(world, id, specialMagazine(world, id))
}
