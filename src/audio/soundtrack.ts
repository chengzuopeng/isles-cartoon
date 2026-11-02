import { BATTLE_ENEMIES, BATTLE_HOLD, BATTLE_RANGE, type TrackId } from '../data/music'
import type { World } from '../sim/world'

export interface SoundtrackState {
  battleUntil: number
}

export function createSoundtrackState(): SoundtrackState {
  return { battleUntil: -Infinity }
}

export function trackFor(world: World, state: SoundtrackState): TrackId | null {
  if (world.status === 'dead') return null
  const boss = world.boss
  if (boss?.boss && boss.boss.phase !== 'dormant' && boss.hp > 0) return 'boss'
  const { player } = world
  const locked = world.areas[world.areaIndex]?.status === 'locked'
  let crowd = 0
  for (const enemy of world.enemies) {
    if (enemy.hp <= 0 || !enemy.aggro) continue
    if (Math.hypot(enemy.pos.x - player.pos.x, enemy.pos.y - player.pos.y) <= BATTLE_RANGE) crowd += 1
  }
  if (locked || crowd >= BATTLE_ENEMIES) state.battleUntil = world.time + BATTLE_HOLD
  return world.time < state.battleUntil ? 'battle' : 'explore'
}
