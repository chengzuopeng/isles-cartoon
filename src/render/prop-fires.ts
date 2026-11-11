import type { World } from '../sim/world'
import type { Effects } from './effects'
import { KEG_LOOK } from './keg-model'

export const FIRE_LOOK = {
  flameEvery: 0.12,
  smokeEvery: 0.35,
  flames: ['#d9481f', '#e8652a', '#f08a32'],
  smoke: '#4a4440',
  sparkEvery: 0.05,
} as const

export interface PropFires {
  update(world: World, dt: number): void
  clear(): void
}

export function createPropFires(effects: Effects): PropFires {
  const flameTimers = new Map<number, number>()
  const smokeTimers = new Map<number, number>()
  const sparkTimers = new Map<number, number>()
  return {
    update(world, dt) {
      if (dt <= 0) return
      for (const fire of world.fires) {
        const flame = (flameTimers.get(fire.index) ?? 0) - dt
        if (flame <= 0) {
          const color = FIRE_LOOK.flames[Math.floor(Math.random() * FIRE_LOOK.flames.length)]
          const fade = Math.min(1, fire.left / 1.5)
          effects.puff(fire.x + (Math.random() - 0.5) * 0.7, fire.z + 0.5 + Math.random() * 0.5, fire.y + (Math.random() - 0.5) * 0.7, color, 0.12 * fade, 0.3 * fade, 0.5, 1.2)
          flameTimers.set(fire.index, FIRE_LOOK.flameEvery)
        } else flameTimers.set(fire.index, flame)
        const smoke = (smokeTimers.get(fire.index) ?? 0) - dt
        if (smoke <= 0) {
          effects.smoke(fire.x, fire.z + 1.4, fire.y, 0.5, 1, FIRE_LOOK.smoke)
          smokeTimers.set(fire.index, FIRE_LOOK.smokeEvery)
        } else smokeTimers.set(fire.index, smoke)
      }
      for (const blast of world.blasts) {
        if (blast.keg < 0) continue
        const left = (sparkTimers.get(blast.keg) ?? 0) - dt
        if (left > 0) {
          sparkTimers.set(blast.keg, left)
          continue
        }
        effects.sparks(blast.x, blast.z + 1.3, blast.y, 0, 0, { count: 3, speed: 3, life: 0.3, color: KEG_LOOK.spark, spread: 0.6, lift: 2.5 })
        sparkTimers.set(blast.keg, FIRE_LOOK.sparkEvery)
      }
    },
    clear() {
      flameTimers.clear()
      smokeTimers.clear()
      sparkTimers.clear()
    },
  }
}
