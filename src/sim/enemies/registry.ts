import type { MinionKind } from '../../data/enemies'
import type { Enemy } from '../types'
import { bomber } from './bomber'
import { grunt } from './grunt'
import { gunner } from './gunner'
import type { EnemyBehavior } from './kit'
import { shield } from './shield'
import { thrower } from './thrower'
import { turret } from './turret'

export const BEHAVIORS: Readonly<Record<MinionKind, EnemyBehavior>> = {
  grunt,
  gunner,
  bomber,
  turret,
  shield,
  thrower,
}

export function behaviorOf(enemy: Enemy): EnemyBehavior | null {
  return enemy.kind === 'boss' ? null : BEHAVIORS[enemy.kind]
}

export function stationary(enemy: Enemy): boolean {
  return behaviorOf(enemy)?.stationary === true
}
