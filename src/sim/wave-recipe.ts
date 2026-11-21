import { AFFIX_ORDER } from '../data/elites'
import { RUSH_VARIETY } from '../data/levels/rules'
import type { ReinforcePlacement } from './level'
import type { MinionKind, SpawnMarker } from './types'
import type { World } from './world'

export function waveRecipe(world: World, wave: ReinforcePlacement) {
  return world.eliteChance > 0 && wave.variants.length > 1 ? wave.variants[world.rng.int(wave.variants.length)] : wave.enemies
}

export function promoteOne(world: World, markers: SpawnMarker[]): void {
  if (world.eliteChance <= 0 || world.elitesAdded >= RUSH_VARIETY.maxElites) return
  const candidates = markers.filter((marker) => (RUSH_VARIETY.eliteKinds as readonly MinionKind[]).includes(marker.kind))
  if (candidates.length === 0 || world.rng.next() >= world.eliteChance) return
  const marker = candidates[world.rng.int(candidates.length)]
  marker.affixes = [AFFIX_ORDER[world.rng.int(AFFIX_ORDER.length)]]
  world.elitesAdded += 1
}
