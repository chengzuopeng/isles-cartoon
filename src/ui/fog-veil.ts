import { hasFog, veilStep } from '../render/fog-motion'
import { FOG_VEIL } from '../render/themes'
import { fogHides } from '../sim/fog'
import type { World } from '../sim/world'

export function hiddenInFog(world: World, x: number, y: number): boolean {
  return hasFog(world.level) && fogHides(world, x, y)
}

export function fogVeil(current: number, hidden: boolean, dt: number): number {
  return current < 0 ? (hidden ? 1 : 0) : veilStep(current, hidden, dt, FOG_VEIL.seconds)
}
