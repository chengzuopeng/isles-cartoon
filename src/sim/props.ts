import { CHAIN } from '../data/chains'
import { HAY_FIRE, KEG } from '../data/props'
import { hazardAttack } from './attacks'
import { blastReaches, damagePlayer, insideBlast, spawnBlast } from './combat'
import { Tile, cellFloor, setTile } from './grid'
import { invalidateNavigation } from './navigation'
import { applyStatusHit } from './status'
import type { Blast } from './types'
import type { World } from './world'

export interface Fire {
  index: number
  x: number
  y: number
  z: number
  left: number
  tick: number
}

function centerOf(world: World, index: number): { x: number; y: number; z: number } {
  const column = index % world.grid.columns
  const row = (index - column) / world.grid.columns
  return { x: column + 0.5, y: row + 0.5, z: cellFloor(world.grid, column, row) }
}

export function kegLit(world: World, index: number): boolean {
  return world.blasts.some((blast) => blast.keg === index)
}

export function igniteKeg(world: World, index: number, fuse: number = KEG.fuse): boolean {
  if (!world.kegs.has(index) || kegLit(world, index)) return false
  const { x, y, z } = centerOf(world, index)
  spawnBlast(world, {
    x,
    y,
    z,
    radius: KEG.radius,
    delay: fuse,
    playerDamage: KEG.playerDamage,
    enemyDamage: KEG.enemyDamage,
    source: 'keg',
    ownerId: 0,
    attack: hazardAttack('keg'),
    chainable: true,
    ignites: true,
    keg: index,
  })
  world.events.push({ type: 'kegLit', x, y, z, index })
  return true
}

export function burstKeg(world: World, blast: Blast): void {
  if (blast.keg < 0 || !world.kegs.delete(blast.keg)) return
  setTile(world.grid, blast.keg, Tile.Floor)
  world.crates.delete(blast.keg)
  invalidateNavigation(world)
}

export function meleeKegs(world: World): void {
  const { player } = world
  const dirX = Math.cos(player.facing)
  const dirY = Math.sin(player.facing)
  for (const reach of KEG.meleeReach) {
    const column = Math.floor(player.pos.x + dirX * reach)
    const row = Math.floor(player.pos.y + dirY * reach)
    if (column < 0 || row < 0 || column >= world.grid.columns || row >= world.grid.rows) continue
    if (igniteKeg(world, row * world.grid.columns + column)) return
  }
}

export function setOffProps(world: World, blast: Blast): boolean {
  let chained = false
  for (const index of world.kegs) {
    const { x, y, z } = centerOf(world, index)
    if (!insideBlast(blast, x, y, 0.5) || !blastReaches(blast, z, 1)) continue
    if (igniteKeg(world, index, CHAIN.chainDelay)) chained = true
  }
  for (const index of world.hay) {
    const { x, y, z } = centerOf(world, index)
    if (!insideBlast(blast, x, y, 0.5) || !blastReaches(blast, z, 1)) continue
    if (igniteHay(world, index)) chained = true
  }
  return chained
}

export function igniteHay(world: World, index: number): boolean {
  if (!world.hay.has(index) || world.fires.some((fire) => fire.index === index)) return false
  const { x, y, z } = centerOf(world, index)
  world.fires.push({ index, x, y, z, left: HAY_FIRE.seconds, tick: 0 })
  world.events.push({ type: 'hayLit', x, y, z, index })
  return true
}

export function updateFires(world: World, dt: number): void {
  if (world.hay.size === 0) return
  catchFromBurning(world)
  if (world.fires.length === 0) return
  const kept: Fire[] = []
  for (const fire of world.fires) {
    fire.tick += dt
    while (fire.tick >= HAY_FIRE.tick) {
      fire.tick -= HAY_FIRE.tick
      scorch(world, fire)
    }
    fire.left -= dt
    if (fire.left > 0) {
      kept.push(fire)
      continue
    }
    world.hay.delete(fire.index)
    setTile(world.grid, fire.index, Tile.Floor)
    invalidateNavigation(world)
    world.events.push({ type: 'hayBurnt', x: fire.x, y: fire.y, z: fire.z, index: fire.index })
  }
  world.fires = kept
}

function near(fire: Fire, x: number, y: number, radius: number): boolean {
  const dx = Math.max(0, Math.abs(x - fire.x) - 0.5)
  const dy = Math.max(0, Math.abs(y - fire.y) - 0.5)
  return Math.hypot(dx, dy) <= HAY_FIRE.reach + radius
}

function scorch(world: World, fire: Fire): void {
  const { player } = world
  if (player.alive && near(fire, player.pos.x, player.pos.y, player.radius) && player.z < fire.z + 2) {
    damagePlayer(world, HAY_FIRE.damage, 0, 0, 0, hazardAttack('burn'), { x: fire.x, y: fire.y })
  }
  for (const enemy of world.enemies) {
    if (enemy.hp <= 0 || enemy.kind === 'boss' || !near(fire, enemy.pos.x, enemy.pos.y, enemy.radius)) continue
    applyStatusHit(world, enemy, { status: 'burn', statusPower: HAY_FIRE.burnPower, statusDuration: HAY_FIRE.burnSeconds })
  }
}

function catchFromBurning(world: World): void {
  const { grid } = world
  for (const enemy of world.enemies) {
    if (enemy.hp <= 0 || enemy.status.burn <= 0) continue
    const column = Math.floor(enemy.pos.x)
    const row = Math.floor(enemy.pos.y)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = column + dx
        const r = row + dy
        if (c < 0 || r < 0 || c >= grid.columns || r >= grid.rows) continue
        const index = r * grid.columns + c
        if (!world.hay.has(index)) continue
        const fire = { index, x: c + 0.5, y: r + 0.5, z: 0, left: 0, tick: 0 }
        if (near(fire, enemy.pos.x, enemy.pos.y, enemy.radius)) igniteHay(world, index)
      }
    }
  }
}
