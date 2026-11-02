import { CRATE_AMMO_CHANCE, CRATE_DROP_CHANCE, CRATE_HP, HEAL_SMALL } from '../data/loot'
import { Tile, setTile } from './grid'
import { invalidateNavigation } from './navigation'
import { spawnPickup } from './pickups'
import type { World } from './world'

export function damageCrate(world: World, index: number, amount: number): void {
  const { grid } = world
  if (grid.tiles[index] !== Tile.Crate || amount <= 0) return
  const hp = (world.crates.get(index) ?? CRATE_HP) - amount
  if (hp > 0) {
    world.crates.set(index, hp)
    return
  }
  world.crates.delete(index)
  setTile(grid, index, Tile.Floor)
  invalidateNavigation(world)
  const column = index % grid.columns
  const row = (index - column) / grid.columns
  const x = column + 0.5
  const y = row + 0.5
  world.events.push({ type: 'crateBroken', x, y, index })
  if (world.lootRng.next() >= CRATE_DROP_CHANCE) return
  const ammo = world.player.special !== null && world.lootRng.next() < CRATE_AMMO_CHANCE
  spawnPickup(world, ammo ? { type: 'ammo' } : { type: 'heal', amount: HEAL_SMALL }, x, y, { scatter: false })
}

export function damageCratesInRadius(world: World, x: number, y: number, radius: number, amount: number): void {
  const { grid } = world
  const minColumn = Math.max(0, Math.floor(x - radius))
  const maxColumn = Math.min(grid.columns - 1, Math.floor(x + radius))
  const minRow = Math.max(0, Math.floor(y - radius))
  const maxRow = Math.min(grid.rows - 1, Math.floor(y + radius))
  for (let row = minRow; row <= maxRow; row++) {
    for (let column = minColumn; column <= maxColumn; column++) {
      const index = row * grid.columns + column
      if (grid.tiles[index] !== Tile.Crate) continue
      if (Math.hypot(column + 0.5 - x, row + 0.5 - y) <= radius + 0.5) damageCrate(world, index, amount)
    }
  }
}
