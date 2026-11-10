import { JUMP_HEIGHT } from './heights'
import { createWeapons, type WeaponDef, type WeaponId } from './weapons'

export type PlayerTuning = {
  speed: number
  radius: number
  maxHp: number
  regenDelay: number
  regenPerSecond: number
  regenSafeRadius: number
  legacyRegen: number
  idleRegen: number
  ultimateCharge: number
  specialUltShare: number
  jumpHeight: number
  gravity: number
  dashDistance: number
  dashTime: number
  dashCooldown: number
  meleeRange: number
  meleeArcDeg: number
  meleeDamage: number
  meleeKnockback: number
  meleeCooldown: number
  crumbleAt: number
}

export type GruntTuning = {
  speed: number
  radius: number
  maxHp: number
  sight: number
  rushMin: number
  rushMax: number
  stagger: number
  lead: number
  rushLead: number
  weave: number
  flankDeg: number
}

export type GunnerTuning = {
  speed: number
  radius: number
  maxHp: number
  sight: number
  keepMin: number
  keepMax: number
  fireRange: number
  lead: number
  track: number
  coverRadius: number
}

export type BomberTuning = {
  speed: number
  radius: number
  maxHp: number
  sight: number
  triggerRange: number
}

export type TurretTuning = {
  radius: number
  maxHp: number
  sight: number
}

export type ShieldTuning = {
  speed: number
  radius: number
  maxHp: number
  sight: number
  turnRate: number
  guardArcDeg: number
}

export type ThrowerTuning = {
  speed: number
  radius: number
  maxHp: number
  sight: number
  keepMin: number
  keepMax: number
}

export type PerceptionTuning = {
  bushSight: number
  ambushRadius: number
  alertRadius: number
  alertThroughWalls: number
  activationRadius: number
  fovDeg: number
  proximity: number
  noiseRadius: number
  noticeSeconds: number
  noticeFade: number
  noticeSuspicious: number
  loseTime: number
  searchTime: number
  suspicionTime: number
  leash: number
  sweepDeg: number
  sweepPeriod: number
  patrolSpeed: number
  wanderRadius: number
  trackScale: number
  lookSpeed: number
  investigateCap: number
  suspiciousSpeed: number
  searchSpeed: number
  returnSpeed: number
  patrolPause: number
  wanderSpeed: number
  wanderWaitMin: number
  wanderWaitMax: number
  wanderMinShare: number
}

export type AiTuning = {
  rangedRecover: number
  strafeShare: number
  strafeRate: number
  bomberRearm: number
  shieldStrikeDeg: number
  interruptCooldown: number
  meleeSlots: number
  unseenSlots: number
  viewHalfDeg: number
  orbitRadius: number
  volleyGap: number
  alertHops: number
}

export type WaveTuning = {
  base: number
  growth: number
  max: number
  delay: number
  warning: number
  minDistance: number
  jitter: number
  stagger: number
}

export type FeelTuning = {
  hitstopKill: number
  hitstopHurt: number
  hitstopBoss: number
  hitstopScale: number
  knockbackDecay: number
  playerKnockScale: number
  staggerPerKnock: number
  staggerMax: number
  staggerSpeed: number
  blastKnockback: number
  shakeShot: number
  shakeHit: number
  shakeKill: number
  shakeHurt: number
  shakeBlast: number
  shakeMaxOffset: number
  flashSeconds: number
}

export type CameraTuning = {
  pitch: number
  distance: number
  fov: number
  lead: number
  maxLead: number
  followSharpness: number
  bossZoom: number
  bossFocus: number
}

export type AudioTuning = {
  volume: number
}

export type Tuning = {
  player: PlayerTuning
  grunt: GruntTuning
  gunner: GunnerTuning
  bomber: BomberTuning
  turret: TurretTuning
  shield: ShieldTuning
  thrower: ThrowerTuning
  perception: PerceptionTuning
  ai: AiTuning
  waves: WaveTuning
  feel: FeelTuning
  camera: CameraTuning
  audio: AudioTuning
  weapons: Record<WeaponId, WeaponDef>
}

export const LEGACY_REGEN = { delay: 3, perSecond: 130 } as const

export function createDefaultTuning(): Tuning {
  return {
    player: {
      speed: 6,
      radius: 0.35,
      maxHp: 1000,
      regenDelay: 5,
      regenPerSecond: 30,
      regenSafeRadius: 19.2,
      legacyRegen: 0,
      idleRegen: 1,
      ultimateCharge: 2500,
      specialUltShare: 0.5,
      jumpHeight: JUMP_HEIGHT,
      gravity: 22,
      dashDistance: 5,
      dashTime: 0.25,
      dashCooldown: 3,
      meleeRange: 2,
      meleeArcDeg: 80,
      meleeDamage: 150,
      meleeKnockback: 1.5,
      meleeCooldown: 0.6,
      crumbleAt: 0.3,
    },
    grunt: {
      speed: 4.3,
      radius: 0.45,
      maxHp: 600,
      sight: 11.2,
      rushMin: 4.2,
      rushMax: 9.6,
      stagger: 0.9,
      lead: 0.6,
      rushLead: 0.85,
      weave: 0.55,
      flankDeg: 55,
    },
    gunner: {
      speed: 3.5,
      radius: 0.4,
      maxHp: 480,
      sight: 16,
      keepMin: 7.2,
      keepMax: 12.8,
      fireRange: 15.2,
      lead: 0.9,
      track: 0.55,
      coverRadius: 5.6,
    },
    bomber: {
      speed: 5.6,
      radius: 0.42,
      maxHp: 200,
      sight: 10.4,
      triggerRange: 1.4,
    },
    turret: {
      radius: 0.55,
      maxHp: 900,
      sight: 13.6,
    },
    shield: {
      speed: 2.9,
      radius: 0.47,
      maxHp: 560,
      sight: 11.2,
      turnRate: 1,
      guardArcDeg: 120,
    },
    thrower: {
      speed: 3.2,
      radius: 0.4,
      maxHp: 360,
      sight: 12.8,
      keepMin: 7.2,
      keepMax: 12.8,
    },
    perception: {
      bushSight: 2.9,
      ambushRadius: 7.2,
      alertRadius: 12.8,
      alertThroughWalls: 5.1,
      activationRadius: 38.4,
      fovDeg: 140,
      proximity: 4,
      noiseRadius: 9.6,
      noticeSeconds: 0.55,
      noticeFade: 1.6,
      noticeSuspicious: 1.6,
      loseTime: 5,
      searchTime: 4,
      suspicionTime: 3,
      leash: 38.4,
      sweepDeg: 50,
      sweepPeriod: 4,
      patrolSpeed: 0.55,
      wanderRadius: 4.8,
      trackScale: 1.5,
      lookSpeed: 2.2,
      investigateCap: 10,
      suspiciousSpeed: 0.7,
      searchSpeed: 0.85,
      returnSpeed: 1.4,
      patrolPause: 0.8,
      wanderSpeed: 0.8,
      wanderWaitMin: 1,
      wanderWaitMax: 2.6,
      wanderMinShare: 0.3,
    },
    ai: {
      rangedRecover: 0.35,
      strafeShare: 0.45,
      strafeRate: 0.7,
      bomberRearm: 1.2,
      shieldStrikeDeg: 30,
      interruptCooldown: 0.5,
      meleeSlots: 2,
      unseenSlots: 1,
      viewHalfDeg: 70,
      orbitRadius: 5.4,
      volleyGap: 0.6,
      alertHops: 2,
    },
    waves: {
      base: 3,
      growth: 1,
      max: 12,
      delay: 2,
      warning: 1.1,
      minDistance: 6,
      jitter: 0.6,
      stagger: 0.12,
    },
    feel: {
      hitstopKill: 0.045,
      hitstopHurt: 0.07,
      hitstopBoss: 0.14,
      hitstopScale: 0.05,
      knockbackDecay: 9,
      playerKnockScale: 0.3,
      staggerPerKnock: 0.03,
      staggerMax: 0.45,
      staggerSpeed: 0.55,
      blastKnockback: 8,
      shakeShot: 0.04,
      shakeHit: 0.08,
      shakeKill: 0.3,
      shakeHurt: 0.45,
      shakeBlast: 0.5,
      shakeMaxOffset: 0.45,
      flashSeconds: 0.1,
    },
    camera: {
      pitch: 58,
      distance: 17,
      fov: 42,
      lead: 0.25,
      maxLead: 2.5,
      followSharpness: 9,
      bossZoom: 5,
      bossFocus: 0.3,
    },
    audio: {
      volume: 0.6,
    },
    weapons: createWeapons(),
  }
}
