import { LOB_ARC, type WeaponId } from '../data/weapons'
import { weaponOf } from './arsenal'
import { spawnBlast } from './combat'
import { floorAt } from './grid'
import { clamp, type Vec2 } from './math'
import { layMine } from './mines'
import type { Attack, Lob, Team } from './types'
import type { World } from './world'

export function spawnLob(
  world: World,
  team: Team,
  from: Vec2,
  target: Vec2,
  id: WeaponId,
  damageScale = 1,
  attack: Attack | null = null,
  flight?: number,
  fromZ?: number,
): Lob {
  const weapon = weaponOf(world, id)
  const dx = target.x - from.x
  const dy = target.y - from.y
  const length = Math.hypot(dx, dy)
  const dirX = length > 1e-6 ? dx / length : 1
  const dirY = length > 1e-6 ? dy / length : 0
  const distance = Math.min(weapon.range, length)
  const to = {
    x: clamp(from.x + dirX * distance, 0.5, world.grid.columns - 0.5),
    y: clamp(from.y + dirY * distance, 0.5, world.grid.rows - 0.5),
  }
  const startZ = fromZ ?? floorAt(world.grid, from.x, from.y) + 1
  const lob: Lob = {
    id: world.nextId++,
    team,
    weapon: id,
    lands: 'blast',
    from: { x: from.x, y: from.y },
    to,
    pos: { x: from.x, y: from.y },
    prev: { x: from.x, y: from.y },
    fromZ: startZ,
    toZ: floorAt(world.grid, to.x, to.y),
    z: startZ,
    prevZ: startZ,
    height: 0,
    peak: LOB_ARC.peakBase + distance * LOB_ARC.peakPerTile,
    time: 0,
    total: flight ?? Math.max(LOB_ARC.minFlight, distance / Math.max(0.1, weapon.speed)),
    radius: weapon.explodeRadius,
    damage: weapon.splash * damageScale,
    enemyDamage: weapon.enemyDamage * damageScale,
    knockback: weapon.knockback,
    attack,
  }
  world.lobs.push(lob)
  return lob
}

export function lobPitch(lob: Lob): number {
  const distance = Math.hypot(lob.to.x - lob.from.x, lob.to.y - lob.from.y)
  return Math.atan2(lob.toZ - lob.fromZ + 4 * lob.peak, Math.max(1e-6, distance))
}

export function updateLobs(world: World, dt: number): void {
  if (world.lobs.length === 0) return
  let kept = 0
  for (const lob of world.lobs) {
    lob.time += dt
    const t = Math.min(1, lob.time / lob.total)
    lob.pos.x = lob.from.x + (lob.to.x - lob.from.x) * t
    lob.pos.y = lob.from.y + (lob.to.y - lob.from.y) * t
    lob.height = 4 * lob.peak * t * (1 - t)
    lob.z = lob.fromZ + (lob.toZ - lob.fromZ) * t + lob.height
    const ground = floorAt(world.grid, lob.pos.x, lob.pos.y)
    if (t < 1 && lob.z > ground) {
      world.lobs[kept++] = lob
      continue
    }
    if (t < 1) {
      lob.to.x = lob.pos.x
      lob.to.y = lob.pos.y
    }
    lob.z = ground
    if (lob.lands === 'mine') {
      layMine(world, lob)
      continue
    }
    spawnBlast(world, {
      x: lob.to.x,
      y: lob.to.y,
      z: lob.z,
      radius: lob.radius,
      delay: 0,
      playerDamage: lob.team === 'enemy' ? lob.damage : 0,
      enemyDamage: lob.team === 'player' ? lob.damage : lob.enemyDamage,
      source: lob.team === 'player' ? 'player' : 'bomber',
      ownerId: 0,
      attack: lob.attack,
      weapon: lob.weapon,
    })
  }
  world.lobs.length = kept
}
