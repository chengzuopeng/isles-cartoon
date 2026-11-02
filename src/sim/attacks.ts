import type { AttackCause } from '../data/attacks'
import type { Attack, Enemy } from './types'

export function attackOf(enemy: Enemy, cause: AttackCause): Attack {
  return { by: enemy.kind, cause, elite: enemy.elite !== null, boss: enemy.boss?.id ?? null }
}

export function hazardAttack(cause: AttackCause): Attack {
  return { by: null, cause, elite: false, boss: null }
}

export function sameAttack(a: Attack, b: Attack): boolean {
  return a.by === b.by && a.cause === b.cause && a.elite === b.elite && a.boss === b.boss
}
