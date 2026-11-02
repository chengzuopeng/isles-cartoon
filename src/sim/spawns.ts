import { resolveCircleGrid } from './collision'
import { aggro } from './perception'
import type { MinionKind, SpawnMarker } from './types'
import { createEnemy, type World } from './world'

export function updateSpawns(world: World, dt: number): void {
  const pending: SpawnMarker[] = []
  const ready: SpawnMarker[] = []
  for (const marker of world.spawns) {
    marker.remaining -= dt
    if (marker.remaining > 0) pending.push(marker)
    else ready.push(marker)
  }
  world.spawns = pending
  for (const marker of ready) {
    const enemy = createEnemy(world, marker.kind, marker.pos, marker.area, { summoned: marker.summoned })
    world.enemies.push(enemy)
    world.events.push({ type: 'enemySpawned', id: enemy.id, x: enemy.pos.x, y: enemy.pos.y })
    aggro(world, enemy, 0)
  }
}

export function updateWaves(world: World, dt: number): void {
  if (world.status !== 'playing') return
  if (world.spawns.length > 0 || world.enemies.some((enemy) => enemy.hp > 0)) return
  world.waveTimer -= dt
  if (world.waveTimer <= 0) startWave(world)
}

function startWave(world: World): void {
  const { tuning, rng, player, level } = world
  const config = tuning.waves
  world.wave += 1
  world.waveTimer = config.delay
  const far = level.waveSpawns.filter(
    (spawn) => Math.hypot(spawn.x - player.pos.x, spawn.y - player.pos.y) >= config.minDistance,
  )
  const candidates = far.length > 0 ? far : level.waveSpawns
  if (candidates.length === 0) return
  const kinds: MinionKind[] = world.wave <= 1 ? ['grunt'] : ['grunt', 'grunt', 'gunner', 'bomber']
  const count = Math.min(config.max, Math.round(config.base + (world.wave - 1) * config.growth))
  for (let i = 0; i < count; i++) {
    const base = candidates[rng.int(candidates.length)]
    const kind = kinds[rng.int(kinds.length)]
    const pos = {
      x: base.x + rng.range(-config.jitter, config.jitter),
      y: base.y + rng.range(-config.jitter, config.jitter),
    }
    resolveCircleGrid(pos, tuning[kind].radius, world.grid)
    const delay = config.warning + i * config.stagger
    world.spawns.push({ id: world.nextId++, pos, remaining: delay, total: delay, kind, area: 0, summoned: false })
  }
  world.events.push({ type: 'waveStarted', wave: world.wave })
}
