export type MinionKind = 'grunt' | 'gunner' | 'bomber' | 'turret' | 'shield' | 'thrower'

export const MINION_KINDS: readonly MinionKind[] = ['grunt', 'gunner', 'bomber', 'turret', 'shield', 'thrower']

export const ENEMY_NAMES: Readonly<Record<MinionKind, string>> = {
  grunt: '冲锋兵',
  gunner: '射手',
  bomber: '自爆兵',
  turret: '炮塔',
  shield: '盾兵',
  thrower: '投弹兵',
}

export type IdleMode = 'guard' | 'patrol' | 'wander' | 'ambush'
