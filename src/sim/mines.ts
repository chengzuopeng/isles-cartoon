import { getBoss, type MineMove } from '../data/bosses'
import { weaponOf } from './arsenal'
import { spawnBlast } from './combat'
import type { Bullet, Lob, Mine, MineCause } from './types'
import type { World } from './world'

export function mineRule(mine: Mine): MineMove | null {
  return getBoss(mine.owner).mines
}

export function layMine(world: World, lob: Lob): Mine | null {
  const owner = lob.attack?.boss ?? null
  const rule = owner ? getBoss(owner).mines : null
  if (!owner || !rule) return null
  const mine: Mine = { id: world.nextId++, pos: { x: lob.to.x, y: lob.to.y }, age: 0, fuse: -1, blast: -1, cause: null, owner, attack: lob.attack }
  world.mines.push(mine)
  world.events.push({ type: 'mineLaid', id: mine.id, x: mine.pos.x, y: mine.pos.y })
  const idle = world.mines.filter((item) => item.fuse < 0)
  if (idle.length > rule.max) triggerMine(world, idle[0], 'crowded', rule.overflow)
  return mine
}

export function triggerMine(world: World, mine: Mine, cause: MineCause, delay?: number): void {
  const rule = mineRule(mine)
  if (!rule) return
  const fuse = Math.max(0, delay ?? rule.fuse)
  if (mine.fuse >= 0) {
    const pending = world.blasts.find((blast) => blast.id === mine.blast)
    if (pending && fuse < pending.delay) pending.delay = fuse
    mine.fuse = Math.min(mine.fuse, fuse)
    if (cause === 'shot') mine.cause = cause
    return
  }
  const weapon = weaponOf(world, rule.weapon)
  const blast = spawnBlast(world, {
    x: mine.pos.x,
    y: mine.pos.y,
    radius: weapon.explodeRadius,
    delay: fuse,
    playerDamage: weapon.splash,
    enemyDamage: weapon.enemyDamage,
    source: 'boss',
    ignites: true,
    ownerId: mine.id,
    attack: mine.attack,
    weapon: rule.weapon,
  })
  mine.fuse = fuse
  mine.blast = blast.id
  mine.cause = cause
  world.events.push({ type: 'mineTriggered', id: mine.id, x: mine.pos.x, y: mine.pos.y, fuse })
}

export function updateMines(world: World, dt: number): void {
  if (world.mines.length === 0) return
  const { player } = world
  const live = player.alive && world.status === 'playing'
  let kept = 0
  for (const mine of world.mines) {
    mine.age += dt
    if (mine.fuse >= 0) {
      if (!world.blasts.some((blast) => blast.id === mine.blast)) {
        world.events.push({ type: 'mineExploded', id: mine.id, x: mine.pos.x, y: mine.pos.y, cause: mine.cause ?? 'stepped' })
        continue
      }
      mine.fuse = Math.max(0, mine.fuse - dt)
    } else if (live) {
      const rule = mineRule(mine)
      if (rule && Math.hypot(player.pos.x - mine.pos.x, player.pos.y - mine.pos.y) <= player.radius + rule.trigger) triggerMine(world, mine, 'stepped')
    }
    world.mines[kept++] = mine
  }
  world.mines.length = kept
}

export function mineRadius(world: World, mine: Mine): number {
  const rule = mineRule(mine)
  return rule ? weaponOf(world, rule.weapon).radius : 0
}

export function mineHitBy(world: World, bullet: Bullet): Mine | null {
  for (const mine of world.mines) {
    const reach = mineRadius(world, mine) + bullet.radius
    const dx = mine.pos.x - bullet.pos.x
    const dy = mine.pos.y - bullet.pos.y
    if (dx * dx + dy * dy <= reach * reach) return mine
  }
  return null
}

export function shootMine(world: World, mine: Mine): void {
  triggerMine(world, mine, 'shot', 0)
}

export function clearMines(world: World): void {
  world.mines = []
}
