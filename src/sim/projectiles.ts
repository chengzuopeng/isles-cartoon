import { CHEST_HEIGHT, EYE_CRIT, WEAK_POINTS, WEAK_POINT_SCALE, eyeHeightOf } from '../data/heights'
import type { WeaponId } from '../data/weapons'
import { weaponOf } from './arsenal'
import { backScale, bossExposed } from './boss'
import { onDamageDealt } from './buffs'
import { lineClear } from './collision'
import { damageEnemy, damagePlayer, spawnBlast } from './combat'
import { MILESTONE } from '../data/progression'

const REFLECT_FRONT = 0.5
import { BADGE } from '../data/badges'
import { critScale, hasBadge } from './badges'
import { damageCrate } from './crates'
import { hasMilestone } from './stats'
import { igniteHay } from './props'
import { shieldBlocks } from './enemies'
import { Tile, blocksBullets, cellFloor, cellTop, floorAt, insideGrid, tileAt } from './grid'
import { hitLandmarkCell } from './landmark-state'
import { mineHitBy, shootMine } from './mines'
import { applyStatusHit, applyStatusToPlayer } from './status'
import { PLAYER_HEIGHT, bodyHeight, centerOf, heightKey } from './terrain'
import type { Attack, Bullet, Enemy, Team } from './types'
import { chargeUltimate, ultShareOf } from './ultimate'
import type { World } from './world'

const SUBSTEP = 0.25

export interface BulletOptions {
  damageScale?: number
  sureCrit?: boolean
  attack?: Attack | null
  z?: number
  pitch?: number
}

export function spawnBullet(
  world: World,
  team: Team,
  originX: number,
  originY: number,
  offset: number,
  angle: number,
  id: WeaponId,
  options: BulletOptions = {},
): Bullet {
  const spec = weaponOf(world, id)
  const dirX = Math.cos(angle)
  const dirY = Math.sin(angle)
  const pitch = options.pitch ?? 0
  const flat = Math.cos(pitch)
  const rise = Math.sin(pitch)
  const z = options.z ?? floorAt(world.grid, originX, originY) + CHEST_HEIGHT
  const damageScale = options.damageScale ?? 1
  if (team === 'player') world.stats.bulletsFired += 1
  const bullet: Bullet = {
    id: world.nextId++,
    team,
    weapon: id,
    pos: { x: originX + dirX * flat * offset, y: originY + dirY * flat * offset },
    prev: { x: originX, y: originY },
    z: z + rise * offset,
    prevZ: z,
    origin: { x: originX, y: originY },
    dirX,
    dirY,
    speed: spec.speed * flat,
    vz: spec.speed * rise,
    traveled: 0,
    range: spec.range,
    radius: spec.radius,
    damage: spec.damage * damageScale,
    knockback: spec.knockback,
    pierce: Math.max(0, Math.round(spec.pierce)),
    bounces: Math.max(0, Math.round(spec.bounces)),
    chain: Math.max(0, Math.round(spec.chain)),
    chainRange: spec.chainRange,
    chainFalloff: spec.chainFalloff,
    explodeRadius: spec.explodeRadius,
    splash: spec.splash * damageScale,
    status: spec.status,
    statusPower: spec.statusPower,
    statusDuration: spec.statusDuration,
    hits: [],
    landed: false,
    sureCrit: options.sureCrit ?? false,
    attack: options.attack ?? null,
  }
  world.bullets.push(bullet)
  return bullet
}

export function updateBullets(world: World, dt: number): void {
  const survivors: Bullet[] = []
  for (const bullet of world.bullets) {
    if (advance(world, bullet, dt)) survivors.push(bullet)
  }
  world.bullets = survivors
}

function advance(world: World, bullet: Bullet, dt: number): boolean {
  if (bullet.traveled >= bullet.range) {
    expire(world, bullet)
    return false
  }
  const { grid } = world
  const distance = Math.hypot(bullet.speed, bullet.vz) * dt
  const steps = Math.max(1, Math.ceil(distance / SUBSTEP))
  const flat = (bullet.speed * dt) / steps
  const stepLength = distance / steps
  for (let i = 0; i < steps; i++) {
    const fromX = bullet.pos.x
    const fromY = bullet.pos.y
    const fromZ = bullet.z
    bullet.pos.x += bullet.dirX * flat
    bullet.pos.y += bullet.dirY * flat
    bullet.z += (bullet.vz * dt) / steps
    bullet.traveled += stepLength
    const column = Math.floor(bullet.pos.x)
    const row = Math.floor(bullet.pos.y)
    if (!insideGrid(grid, column, row)) {
      expire(world, bullet)
      return false
    }
    const tile = tileAt(grid, column, row)
    if (blocksBullets(tile) && bullet.z < cellTop(grid, column, row)) {
      const index = row * grid.columns + column
      if (tile === Tile.Crate && (bullet.team === 'player' || world.kegs.has(index))) damageCrate(world, index, bullet.damage)
      if (bullet.status === 'burn') igniteHay(world, index)
      if (tile === Tile.Landmark && bullet.team === 'player') hitLandmarkCell(world, row * grid.columns + column, bullet.damage)
      if (bullet.bounces > 0) {
        bounce(world, bullet, fromX, fromY, fromZ, column, row)
        continue
      }
      if (bullet.explodeRadius > 0) explode(world, bullet, fromX, fromY)
      world.events.push({ type: 'bulletHitWall', x: fromX, y: fromY, z: fromZ, team: bullet.team })
      return false
    }
    const floor = cellFloor(grid, column, row)
    if (bullet.z < floor) {
      if (bullet.bounces > 0) {
        bounceGround(world, bullet, floor)
        continue
      }
      if (bullet.explodeRadius > 0) explode(world, bullet, bullet.pos.x, bullet.pos.y)
      world.events.push({ type: 'bulletHitWall', x: bullet.pos.x, y: bullet.pos.y, z: floor, team: bullet.team })
      return false
    }
    if (bullet.team === 'player') {
      const target = findEnemyTarget(world, bullet)
      if (target) markLanded(world, bullet)
      if (target && shieldBlocks(world, target, bullet.dirX, bullet.dirY)) {
        world.events.push({ type: 'shieldBlocked', id: target.id, x: fromX, y: fromY })
        if (bullet.explodeRadius > 0) explode(world, bullet, fromX, fromY)
        return false
      }
      if (target) {
        hitEnemy(world, bullet, target)
        if (bullet.explodeRadius > 0) {
          explode(world, bullet, target.pos.x, target.pos.y)
          return false
        }
        if (bullet.pierce <= 0) return false
        bullet.pierce -= 1
        bullet.hits.push(target.id)
      } else if (world.mines.length > 0) {
        const mine = mineHitBy(world, bullet)
        if (mine) {
          shootMine(world, mine)
          if (bullet.explodeRadius > 0) explode(world, bullet, mine.pos.x, mine.pos.y)
          return false
        }
      }
    } else if (hitsPlayer(world, bullet)) {
      if (parry(world, bullet)) return false
      if (reflect(world, bullet)) continue
      damagePlayer(world, bullet.damage, bullet.dirX, bullet.dirY, bullet.knockback, bullet.attack, bullet.origin)
      if (bullet.status !== 'none') applyStatusToPlayer(world, bullet)
      if (bullet.explodeRadius > 0) explode(world, bullet, bullet.pos.x, bullet.pos.y)
      return false
    }
    if (bullet.traveled >= bullet.range) {
      expire(world, bullet)
      return false
    }
  }
  return true
}

function markLanded(world: World, bullet: Bullet): void {
  if (bullet.landed) return
  bullet.landed = true
  world.stats.bulletsHit += 1
}

export function criticalHit(bullet: Bullet, target: Enemy): boolean {
  if (target.boss) {
    const weak = WEAK_POINTS[target.boss.id]
    if (!weak || !bossExposed(target)) return false
    const x = target.pos.x + Math.cos(target.facing) * weak.forward
    const y = target.pos.y + Math.sin(target.facing) * weak.forward
    const z = target.z + weak.height
    return Math.hypot(bullet.pos.x - x, bullet.pos.y - y, bullet.z - z) <= weak.radius + bullet.radius
  }
  const eye = target.z + eyeHeightOf(heightKey(target))
  if (Math.abs(bullet.z - eye) > EYE_CRIT.band) return false
  return bullet.dirX * Math.cos(target.facing) + bullet.dirY * Math.sin(target.facing) < EYE_CRIT.facing
}

function parry(world: World, bullet: Bullet): boolean {
  const { player } = world
  if (world.time > player.guardUntil || !hasBadge(world, 'door')) return false
  if (bullet.dirX * Math.cos(player.facing) + bullet.dirY * Math.sin(player.facing) > -BADGE.doorFront) return false
  world.events.push({ type: 'parried', x: bullet.pos.x, y: bullet.pos.y, z: bullet.z })
  return true
}

function reflect(world: World, bullet: Bullet): boolean {
  const { player } = world
  if (player.barrier <= 0 || !player.barrierReflect || bullet.explodeRadius > 0) return false
  if (bullet.dirX * Math.cos(player.facing) + bullet.dirY * Math.sin(player.facing) > -REFLECT_FRONT) return false
  bullet.team = 'player'
  bullet.dirX = -bullet.dirX
  bullet.dirY = -bullet.dirY
  bullet.vz = -bullet.vz
  bullet.traveled = 0
  bullet.origin = { x: bullet.pos.x, y: bullet.pos.y }
  bullet.attack = null
  bullet.hits = []
  bullet.pos.x += bullet.dirX * (player.radius + bullet.radius + 0.1)
  bullet.pos.y += bullet.dirY * (player.radius + bullet.radius + 0.1)
  world.events.push({ type: 'reflected', x: bullet.pos.x, y: bullet.pos.y, z: bullet.z })
  return true
}

function recycleAmmo(world: World, bullet: Bullet): void {
  const { player } = world
  if (bullet.weapon !== player.primary || !hasMilestone(world, 'gun5') || player.ammo >= player.magazine) return
  if (world.time - player.recycledAt < MILESTONE.recycleGap) return
  player.recycledAt = world.time
  player.ammo += 1
}

export function falloffOf(world: World, bullet: Bullet): number {
  const spec = world.tuning.weapons[bullet.weapon]
  if (!spec || spec.falloffStart <= 0 || bullet.range <= spec.falloffStart) return 1
  const reach = Math.min(1, Math.max(0, (bullet.traveled - spec.falloffStart) / (bullet.range - spec.falloffStart)))
  return 1 - reach * (1 - spec.falloffMin)
}

function hitEnemy(world: World, bullet: Bullet, target: Enemy): void {
  const back = target.kind === 'boss' ? backScale(target, bullet.dirX, bullet.dirY) : 1
  const crit = bullet.sureCrit || criticalHit(bullet, target)
  const scale = crit ? (bullet.team === 'player' ? critScale(world, target.boss ? WEAK_POINT_SCALE : EYE_CRIT.scale) : target.boss ? WEAK_POINT_SCALE : EYE_CRIT.scale) : 1
  const damage = bullet.damage * back * falloffOf(world, bullet) * scale
  if (crit) world.stats.crits += 1
  if (crit && bullet.team === 'player') recycleAmmo(world, bullet)
  damageEnemy(world, target, damage, bullet.dirX, bullet.dirY, bullet.knockback, { z: bullet.z, crit })
  if (back > 1) world.events.push({ type: 'bossBackHit', id: target.id, x: target.pos.x, y: target.pos.y, damage })
  onDamageDealt(world, damage)
  chargeUltimate(world, damage * ultShareOf(world, bullet.weapon), target)
  if (bullet.status !== 'none') applyStatusHit(world, target, bullet)
  if (bullet.chain > 0) chainFrom(world, bullet, target)
}

function bounce(world: World, bullet: Bullet, fromX: number, fromY: number, fromZ: number, column: number, row: number): void {
  const crossedColumn = Math.floor(fromX) !== column
  const crossedRow = Math.floor(fromY) !== row
  if (crossedColumn) bullet.dirX = -bullet.dirX
  if (crossedRow) bullet.dirY = -bullet.dirY
  if (!crossedColumn && !crossedRow) {
    bullet.dirX = -bullet.dirX
    bullet.dirY = -bullet.dirY
  }
  bullet.pos.x = fromX
  bullet.pos.y = fromY
  bullet.z = fromZ
  bullet.bounces -= 1
  bullet.hits.length = 0
  world.events.push({ type: 'bulletBounced', x: fromX, y: fromY })
}

function bounceGround(world: World, bullet: Bullet, floor: number): void {
  bullet.vz = Math.abs(bullet.vz)
  bullet.z = floor + (floor - bullet.z)
  bullet.bounces -= 1
  bullet.hits.length = 0
  world.events.push({ type: 'bulletBounced', x: bullet.pos.x, y: bullet.pos.y })
}

function chainFrom(world: World, bullet: Bullet, first: Enemy): void {
  const hit = new Set<number>([first.id])
  let current = first
  let damage = bullet.damage
  for (let jump = 0; jump < bullet.chain; jump++) {
    damage *= 1 - bullet.chainFalloff
    let next: Enemy | null = null
    let best = Infinity
    for (const enemy of world.enemies) {
      if (enemy.hp <= 0 || hit.has(enemy.id) || enemy.boss?.phase === 'dormant') continue
      const gap = Math.hypot(enemy.pos.x - current.pos.x, enemy.pos.y - current.pos.y)
      if (gap > bullet.chainRange || gap >= best) continue
      if (!lineClear(world.grid, centerOf(current), centerOf(enemy), blocksBullets)) continue
      next = enemy
      best = gap
    }
    if (!next) return
    hit.add(next.id)
    world.events.push({ type: 'chain', fromX: current.pos.x, fromY: current.pos.y, toX: next.pos.x, toY: next.pos.y })
    damageEnemy(world, next, damage, 0, 0, 0)
    onDamageDealt(world, damage)
    chargeUltimate(world, damage * ultShareOf(world, bullet.weapon), next)
    current = next
  }
}

function explode(world: World, bullet: Bullet, x: number, y: number): void {
  spawnBlast(world, {
    x,
    y,
    z: bullet.z,
    radius: bullet.explodeRadius,
    delay: 0,
    playerDamage: bullet.team === 'enemy' ? bullet.splash : 0,
    enemyDamage: bullet.team === 'player' ? bullet.splash : 0,
    source: bullet.team === 'player' ? 'player' : 'bomber',
    ownerId: 0,
    attack: bullet.attack,
    weapon: bullet.weapon,
  })
  bullet.explodeRadius = 0
}

function expire(world: World, bullet: Bullet): void {
  if (bullet.explodeRadius > 0) explode(world, bullet, bullet.pos.x, bullet.pos.y)
  world.events.push({ type: 'bulletExpired', x: bullet.pos.x, y: bullet.pos.y, z: bullet.z, team: bullet.team })
}

function findEnemyTarget(world: World, bullet: Bullet): Enemy | undefined {
  for (const enemy of world.enemies) {
    if (enemy.hp <= 0 || enemy.boss?.phase === 'dormant' || bullet.hits.includes(enemy.id)) continue
    const dx = enemy.pos.x - bullet.pos.x
    const dy = enemy.pos.y - bullet.pos.y
    const reach = enemy.radius + bullet.radius
    if (dx * dx + dy * dy > reach * reach) continue
    if (bullet.z < enemy.z || bullet.z > enemy.z + bodyHeight(enemy)) continue
    return enemy
  }
  return undefined
}

function hitsPlayer(world: World, bullet: Bullet): boolean {
  const { player } = world
  if (!player.alive || player.invulnerable > 0) return false
  const dx = player.pos.x - bullet.pos.x
  const dy = player.pos.y - bullet.pos.y
  const reach = player.radius + bullet.radius
  if (dx * dx + dy * dy > reach * reach) return false
  return bullet.z >= player.z && bullet.z <= player.z + PLAYER_HEIGHT
}
