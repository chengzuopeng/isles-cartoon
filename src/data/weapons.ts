export type WeaponKind = 'projectile' | 'melee' | 'blast' | 'lob'

export type AmmoModel = 'reload' | 'limited' | 'none'

export type StatusKind = 'none' | 'burn' | 'chill'

export type WeaponDef = {
  name: string
  kind: WeaponKind
  ammo: AmmoModel
  magazine: number
  reloadSeconds: number
  cooldown: number
  windup: number
  burstCount: number
  burstInterval: number
  pellets: number
  spreadDeg: number
  jitterDeg: number
  speed: number
  range: number
  falloffStart: number
  falloffMin: number
  radius: number
  damage: number
  enemyDamage: number
  knockback: number
  pierce: number
  arcDeg: number
  lunge: number
  bounces: number
  chain: number
  chainRange: number
  chainFalloff: number
  explodeRadius: number
  splash: number
  status: StatusKind
  statusPower: number
  statusDuration: number
}

export type PlayerWeaponId =
  | 'blaster'
  | 'shotgun'
  | 'smg'
  | 'sniper'
  | 'grenade'
  | 'ricochet'
  | 'flamer'
  | 'frost'
  | 'rocket'
  | 'arc'

export type UltimateWeaponId = 'starVolley'

export type EnemyWeaponId =
  | 'claw'
  | 'rush'
  | 'rifle'
  | 'cannon'
  | 'fuse'
  | 'bash'
  | 'bomb'
  | 'strawFan'
  | 'strawSlam'
  | 'reaperSweep'
  | 'baleToss'
  | 'bladeSpin'
  | 'fallingBlade'
  | 'chiefBomb'
  | 'chiefCannon'
  | 'captainRush'
  | 'captainBash'
  | 'tankShell'
  | 'tankMine'
  | 'tankRam'

export type WeaponId = PlayerWeaponId | UltimateWeaponId | EnemyWeaponId

export const SPECIAL_WEAPONS: readonly PlayerWeaponId[] = [
  'shotgun',
  'smg',
  'sniper',
  'grenade',
  'ricochet',
  'flamer',
  'frost',
  'rocket',
  'arc',
]

export const WEAPON_BLURBS: Readonly<Record<PlayerWeaponId, string>> = {
  blaster: '三连发，按住连射，弹药自己回',
  shotgun: '近距离散射，贴脸伤害最高',
  smg: '射速极快，适合持续压制',
  sniper: '射程最远，单发高伤并能穿透',
  grenade: '抛物线越过掩体，落地爆炸',
  ricochet: '子弹碰墙反弹，能打到墙后的敌人',
  flamer: '近距离喷火，点燃并穿透敌群',
  frost: '命中减速敌人，叠满后冻结',
  rocket: '命中后大范围爆炸',
  arc: '命中后电流跳向附近的敌人',
}

export const LOB_ARC = { minFlight: 0.35, peakBase: 1.1, peakPerTile: 0.16 } as const

const BASE: WeaponDef = {
  name: '',
  kind: 'projectile',
  ammo: 'none',
  magazine: 0,
  reloadSeconds: 0,
  cooldown: 0.5,
  windup: 0,
  burstCount: 1,
  burstInterval: 0,
  pellets: 1,
  spreadDeg: 0,
  jitterDeg: 0,
  speed: 10,
  range: 8,
  falloffStart: 0,
  falloffMin: 1,
  radius: 0.15,
  damage: 100,
  enemyDamage: 0,
  knockback: 0,
  pierce: 0,
  arcDeg: 0,
  lunge: 0,
  bounces: 0,
  chain: 0,
  chainRange: 0,
  chainFalloff: 0,
  explodeRadius: 0,
  splash: 0,
  status: 'none',
  statusPower: 0,
  statusDuration: 0,
}

export function createWeapons(): Record<WeaponId, WeaponDef> {
  return {
    blaster: {
      ...BASE,
      name: '能量枪',
      ammo: 'reload',
      magazine: 6,
      reloadSeconds: 0.5,
      cooldown: 0.3,
      burstCount: 3,
      burstInterval: 0.07,
      speed: 45,
      range: 40,
      falloffStart: 20,
      falloffMin: 0.5,
      radius: 0.14,
      damage: 90,
      knockback: 2.6,
    },
    shotgun: {
      ...BASE,
      name: '霰弹枪',
      ammo: 'limited',
      magazine: 12,
      cooldown: 0.85,
      pellets: 6,
      spreadDeg: 42,
      jitterDeg: 3,
      speed: 25.6,
      range: 7.7,
      radius: 0.13,
      damage: 70,
      knockback: 3.2,
    },
    smg: {
      ...BASE,
      name: '冲锋枪',
      ammo: 'limited',
      magazine: 60,
      cooldown: 0.085,
      jitterDeg: 9,
      speed: 28.8,
      range: 11.2,
      radius: 0.11,
      damage: 34,
      knockback: 0.6,
    },
    sniper: {
      ...BASE,
      name: '狙击枪',
      ammo: 'limited',
      magazine: 8,
      cooldown: 1.1,
      speed: 54.4,
      range: 22.4,
      radius: 0.12,
      damage: 420,
      knockback: 4,
      pierce: 2,
    },
    grenade: {
      ...BASE,
      name: '榴弹炮',
      kind: 'lob',
      ammo: 'limited',
      magazine: 10,
      cooldown: 1,
      speed: 20.8,
      range: 14.4,
      radius: 0.2,
      damage: 0,
      knockback: 4,
      explodeRadius: 1.7,
      splash: 230,
    },
    ricochet: {
      ...BASE,
      name: '弹射枪',
      ammo: 'limited',
      magazine: 24,
      cooldown: 0.4,
      speed: 22.4,
      range: 20.8,
      radius: 0.14,
      damage: 85,
      knockback: 1.5,
      bounces: 2,
    },
    flamer: {
      ...BASE,
      name: '火焰喷射器',
      ammo: 'limited',
      magazine: 100,
      cooldown: 0.1,
      pellets: 2,
      spreadDeg: 26,
      jitterDeg: 8,
      speed: 12.8,
      range: 5.6,
      radius: 0.32,
      damage: 14,
      knockback: 0.25,
      pierce: 4,
      status: 'burn',
      statusPower: 40,
      statusDuration: 3,
    },
    frost: {
      ...BASE,
      name: '冰冻枪',
      ammo: 'limited',
      magazine: 30,
      cooldown: 0.5,
      speed: 20.8,
      range: 11.2,
      radius: 0.17,
      damage: 70,
      knockback: 0.8,
      status: 'chill',
      statusPower: 0.2,
      statusDuration: 2.5,
    },
    rocket: {
      ...BASE,
      name: '火箭筒',
      ammo: 'limited',
      magazine: 5,
      cooldown: 1.6,
      speed: 16,
      range: 16,
      radius: 0.22,
      damage: 120,
      knockback: 5,
      explodeRadius: 2.2,
      splash: 260,
    },
    arc: {
      ...BASE,
      name: '链式电枪',
      ammo: 'limited',
      magazine: 40,
      cooldown: 0.45,
      speed: 41.6,
      range: 10.4,
      radius: 0.12,
      damage: 110,
      knockback: 0.6,
      chain: 2,
      chainRange: 5.6,
      chainFalloff: 0.2,
    },
    starVolley: {
      ...BASE,
      name: '星光连射',
      burstCount: 12,
      burstInterval: 0.1,
      speed: 32,
      range: 17.6,
      radius: 0.22,
      damage: 150,
      knockback: 2.5,
      pierce: 3,
    },
    claw: {
      ...BASE,
      name: '利爪',
      kind: 'melee',
      cooldown: 0.55,
      windup: 0.4,
      radius: 0.5,
      damage: 140,
      knockback: 7,
      arcDeg: 140,
      lunge: 5,
    },
    rush: {
      ...BASE,
      name: '冲锋',
      kind: 'melee',
      cooldown: 3.2,
      windup: 0.5,
      speed: 14.4,
      range: 10.4,
      radius: 0.3,
      damage: 160,
      knockback: 9,
    },
    rifle: {
      ...BASE,
      name: '步枪',
      cooldown: 1.3,
      windup: 0.55,
      speed: 19.2,
      range: 16,
      radius: 0.2,
      damage: 110,
      knockback: 2,
    },
    cannon: {
      ...BASE,
      name: '三联炮',
      cooldown: 1.9,
      windup: 0.6,
      pellets: 3,
      spreadDeg: 28,
      speed: 12,
      range: 16,
      radius: 0.2,
      damage: 90,
      knockback: 2,
    },
    fuse: {
      ...BASE,
      name: '自爆',
      kind: 'blast',
      windup: 0.65,
      radius: 1.9,
      damage: 300,
      enemyDamage: 400,
      knockback: 8,
    },
    bash: {
      ...BASE,
      name: '盾击',
      kind: 'melee',
      cooldown: 1,
      windup: 0.55,
      radius: 0.55,
      damage: 120,
      knockback: 9,
      arcDeg: 100,
      lunge: 3,
    },
    bomb: {
      ...BASE,
      name: '炸弹',
      kind: 'lob',
      cooldown: 2.6,
      windup: 0.5,
      speed: 11.2,
      range: 13.6,
      radius: 0.22,
      damage: 0,
      knockback: 6,
      explodeRadius: 1.6,
      splash: 160,
    },
    strawFan: {
      ...BASE,
      name: '稻草散射',
      windup: 0.6,
      burstCount: 2,
      burstInterval: 0.45,
      pellets: 5,
      spreadDeg: 60,
      speed: 9.6,
      range: 17.6,
      radius: 0.24,
      damage: 70,
      knockback: 3,
    },
    strawSlam: {
      ...BASE,
      name: '震地',
      kind: 'blast',
      windup: 1,
      radius: 2.8,
      damage: 200,
      knockback: 8,
    },
    reaperSweep: {
      ...BASE,
      name: '横扫',
      kind: 'blast',
      windup: 0.85,
      radius: 3.8,
      arcDeg: 150,
      damage: 270,
      knockback: 9,
    },
    baleToss: {
      ...BASE,
      name: '抛射麦捆',
      kind: 'lob',
      cooldown: 0.35,
      speed: 7,
      range: 10,
      radius: 0.35,
      damage: 0,
      knockback: 6,
      explodeRadius: 1.4,
      splash: 190,
    },
    bladeSpin: {
      ...BASE,
      name: '刀片旋转',
      kind: 'blast',
      windup: 1.1,
      radius: 4.8,
      damage: 270,
      knockback: 8,
    },
    fallingBlade: {
      ...BASE,
      name: '落刀',
      kind: 'blast',
      windup: 1,
      radius: 1.1,
      damage: 170,
      knockback: 5,
    },
    chiefBomb: {
      ...BASE,
      name: '抛掷炸弹',
      kind: 'lob',
      cooldown: 0.4,
      speed: 9,
      range: 22.4,
      radius: 0.3,
      damage: 0,
      knockback: 6,
      explodeRadius: 1.5,
      splash: 170,
    },
    chiefCannon: {
      ...BASE,
      name: '炮口连射',
      speed: 16,
      range: 22.4,
      radius: 0.24,
      damage: 75,
      knockback: 2.5,
    },
    captainRush: {
      ...BASE,
      name: '举盾冲锋',
      kind: 'melee',
      damage: 200,
      knockback: 10,
    },
    captainBash: {
      ...BASE,
      name: '盾击',
      kind: 'blast',
      windup: 0.7,
      radius: 2.5,
      arcDeg: 100,
      damage: 220,
      knockback: 9,
    },
    tankShell: {
      ...BASE,
      name: '三联炮',
      speed: 11,
      range: 14,
      radius: 0.26,
      damage: 150,
      knockback: 3,
    },
    tankMine: {
      ...BASE,
      name: '地雷',
      kind: 'lob',
      speed: 8,
      range: 12,
      radius: 0.3,
      damage: 0,
      knockback: 7,
      explodeRadius: 1.2,
      splash: 200,
    },
    tankRam: {
      ...BASE,
      name: '倒车冲撞',
      kind: 'melee',
      damage: 220,
      knockback: 10,
    },
  }
}
