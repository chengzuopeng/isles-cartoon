import { CAUSE_NAMES } from '../data/attacks'
import { getBoss } from '../data/bosses'
import { ENEMY_NAMES } from '../data/enemies'
import type { WeaponDef, WeaponId } from '../data/weapons'
import type { Attack } from '../sim/types'

export function attackerName(attack: Attack): string {
  const base = attack.boss ? getBoss(attack.boss).name : attack.by && attack.by !== 'boss' ? ENEMY_NAMES[attack.by] : ''
  return base && attack.elite ? `精英${base}` : base
}

export function causeName(attack: Attack, weapons: Readonly<Record<WeaponId, WeaponDef>>): string {
  return CAUSE_NAMES[attack.cause] ?? weapons[attack.cause as WeaponId]?.name ?? attack.cause
}

export function attackLabel(attack: Attack, weapons: Readonly<Record<WeaponId, WeaponDef>>): string {
  const attacker = attackerName(attack)
  const cause = causeName(attack, weapons)
  return attacker ? `${attacker}的${cause}` : cause
}
