import type { LandmarkId, MotionAxis } from '../data/landmarks'
import type { Theme } from '../data/levels/types'
import type { BuffId, ChestTier } from '../data/loot'
import type { PlayerWeaponId } from '../data/weapons'

export interface Palette {
  floorA: string
  floorB: string
  path: string
  wall: string
  bush: string
  water: string
  canopy: string
}

export const PALETTES: Record<Theme, Palette> = {
  farm: {
    floorA: '#a9a552',
    floorB: '#a09c4b',
    path: '#c49a60',
    wall: '#b48a5e',
    bush: '#dcc257',
    water: '#4aa6dc',
    canopy: '#4f9a3c',
  },
  meadow: {
    floorA: '#9aa856',
    floorB: '#919f4f',
    path: '#c7a064',
    wall: '#b9b2a5',
    bush: '#3f9a3a',
    water: '#3aa0d8',
    canopy: '#3f8f36',
  },
  village: {
    floorA: '#b8a47c',
    floorB: '#ad9972',
    path: '#97815f',
    wall: '#9a6a46',
    bush: '#6a9a3a',
    water: '#3a96c8',
    canopy: '#4a8a34',
  },
  forest: {
    floorA: '#5e9c4e',
    floorB: '#579446',
    path: '#8f7550',
    wall: '#6e6a62',
    bush: '#2e7a33',
    water: '#2f8fc0',
    canopy: '#2f7a2c',
  },
  outpost: {
    floorA: '#8e959d',
    floorB: '#868d95',
    path: '#70777f',
    wall: '#56606c',
    bush: '#4f7f4a',
    water: '#3a8ab8',
    canopy: '#46703c',
  },
  factory: {
    floorA: '#9c8f7a',
    floorB: '#938671',
    path: '#7d6f5a',
    wall: '#6b4b3a',
    bush: '#6f8f3a',
    water: '#3a86b8',
    canopy: '#4f7a34',
  },
  arena: {
    floorA: '#c4a476',
    floorB: '#ba9a6c',
    path: '#a88b61',
    wall: '#8b6a49',
    bush: '#7d9a3d',
    water: '#3a96c8',
    canopy: '#56853a',
  },
}

export const BUFF_COLORS: Record<BuffId, string> = {
  frenzy: '#ff9a3d',
  might: '#ff4d5e',
  swift: '#5ff0ff',
  shield: '#6aa8ff',
  infinite: '#ffd34d',
  leech: '#c46bff',
}

export const HEAL_COLOR = '#52e07a'
export const AMMO_COLOR = '#ffc94d'
export const WEAPON_GLOW = '#5ff0ff'

export const CHEST_COLORS: Record<ChestTier, { body: string; trim: string }> = {
  normal: { body: '#a8743f', trim: '#e7c06a' },
  weapon: { body: '#55606e', trim: '#5ff0ff' },
  rare: { body: '#c9932e', trim: '#fff1a8' },
}

export const GUN_SHAPES: Record<PlayerWeaponId, { length: number; thickness: number; color: string }> = {
  blaster: { length: 1, thickness: 1, color: '#2f3440' },
  shotgun: { length: 0.85, thickness: 1.5, color: '#6b4527' },
  smg: { length: 0.8, thickness: 0.9, color: '#3c4656' },
  sniper: { length: 1.6, thickness: 0.8, color: '#1d2128' },
  grenade: { length: 0.9, thickness: 1.8, color: '#3f5a36' },
  ricochet: { length: 1, thickness: 1.1, color: '#2f8f6a' },
  flamer: { length: 1, thickness: 1.6, color: '#8a3b1d' },
  frost: { length: 0.95, thickness: 1.2, color: '#5fa8d8' },
  rocket: { length: 1.4, thickness: 2, color: '#4b5320' },
  arc: { length: 1, thickness: 1, color: '#c9a227' },
}

export const PROJECTILE_SCALES: Readonly<
  Record<'rocket-shell' | 'grenade-shell' | 'legion-bomb' | 'chief-bomb' | 'wheat-bale' | 'falling-blade' | 'mine', number>
> = {
  'rocket-shell': 1.8,
  'grenade-shell': 2.2,
  'legion-bomb': 1.8,
  'chief-bomb': 2.2,
  'wheat-bale': 1.6,
  'falling-blade': 1.5,
  mine: 1,
}

export const PROJECTILE_POOL_MODELS: Readonly<Partial<Record<keyof typeof PROJECTILE_SCALES, 'legion-bomb'>>> = {
  'chief-bomb': 'legion-bomb',
}

export interface WeaponHold {
  grip: readonly [number, number, number]
  elbow: readonly [number, number, number]
  kick: number
}

export const WEAPON_HOLDS: Record<PlayerWeaponId, WeaponHold> = {
  blaster: { grip: [0.15, 0.74, 0.22], elbow: [-0.6, -0.8, 0.4], kick: 0.035 },
  shotgun: { grip: [0.1, 0.72, 0.27], elbow: [-1, -0.6, 0], kick: 0.06 },
  smg: { grip: [0.1, 0.73, 0.26], elbow: [-1, -0.6, 0], kick: 0.02 },
  sniper: { grip: [0.1, 0.72, 0.27], elbow: [-1, -0.6, 0], kick: 0.06 },
  grenade: { grip: [0.11, 0.72, 0.27], elbow: [-1, -0.6, 0], kick: 0.05 },
  ricochet: { grip: [0.13, 0.73, 0.24], elbow: [-1, -0.6, 0.2], kick: 0.04 },
  flamer: { grip: [0.1, 0.7, 0.28], elbow: [-1, -0.6, 0], kick: 0.012 },
  frost: { grip: [0.13, 0.72, 0.24], elbow: [-1, -0.6, 0.2], kick: 0.04 },
  rocket: { grip: [0.1, 0.71, 0.28], elbow: [-1, -0.6, 0], kick: 0.06 },
  arc: { grip: [0.14, 0.73, 0.23], elbow: [-1, -0.6, 0.2], kick: 0.04 },
}

export const GROUND_WEAPON = {
  length: 0.9,
  minScale: 1.1,
  maxScale: 2,
  tilt: 0.8,
  swing: Math.PI / 6,
  swingRate: 1.3,
} as const

export const CRATE_TINT = { base: 0.86, spread: 0.14, warmth: 0.05 } as const

export const SCENE_TINT = { base: 0.9, spread: 0.1 } as const

export const ENEMY_LOOK = { brighten: 1.35 } as const

export const HIT_STARS = { hit: 0.55, crit: 0.85, wall: 0.32 } as const

export const HIT_WHITEOUT = { glow: 0.92, dim: 0.9 } as const

export const ROCK_FALLBACK_COLORS: Readonly<Record<string, string>> = {
  'ch1-rock': '#9b968b',
  'ch1-haystack': '#c9a14c',
}

export const LANDMARK_FALLBACK = {
  maxHeight: 2,
  decorHeight: 0.08,
  lowColor: '#c99d66',
  decorLighten: 0.12,
  solidDarken: 0.08,
} as const

export const GATE_LIFT = {
  box: { up: 0.62, down: -0.75 },
  model: { up: 0, down: -1.35 },
  glow: { color: '#ff4a1f', intensity: 0.55, height: 0.08, depth: 0.34, top: 1.25 },
  settle: 0.001,
} as const

export const CAMPFIRE_FLAME = {
  outer: { radius: 0.13, height: 0.42, color: '#ff8a2a', opacity: 0.78 },
  inner: { radius: 0.07, height: 0.26, color: '#ffe07a', opacity: 0.95 },
  fallbackScale: 1.3,
  charred: 0.45,
} as const

export const ENEMY_MUZZLE_COLOR = '#ffb070'
export const ENEMY_IMPACT_COLOR = '#ffc9a8'
export const MORTAR_FLASH_COLOR = '#ffb36b'
export const MORTAR_SMOKE_COLOR = '#e8dcc4'
export const HELD_BOMB_SCALE = 1

export const ELITE_CROWN = { scale: 1.3, glow: '#ffb020', glowIntensity: 0.35 } as const

export const SCARECROW_POSE = {
  lean: 0.3,
  leanBack: 0.14,
  armBack: 0.95,
  elbowBack: 0.35,
  armRaise: 2.75,
  elbowRaise: 0.45,
  raiseSpread: 0.25,
  raiseHead: 0.15,
  tremble: 0.04,
  trembleRate: 40,
  armStrike: 1.15,
  elbowStrike: -0.3,
  spread: 1.25,
  elbowSpread: 0.55,
  slumpLean: 0.16,
  slumpArm: 0.25,
  slumpHead: 0.35,
  wobble: 0.08,
  wobbleRate: 6,
  sway: 0.06,
  bob: 0.05,
  armSwing: 0.25,
  legSwing: 0.32,
  knee: 0.3,
  strideEase: 8,
  walkRate: 4.5,
  minRate: 6,
  maxRate: 18,
  moving: 0.3,
  ease: 14,
  strikeSeconds: 0.7,
  slamLean: 0.12,
  hitHop: 0.7,
  hatHop: 0.14,
  hatTilt: 0.2,
  hatStun: 0.32,
  hatWind: 0.18,
  hatDecay: 6,
  kickLean: 0.12,
  kickDecay: 9,
  eyeTelegraph: 1.6,
  eyeStunned: 0.35,
  straw: '#e8c860',
} as const

export const HARVESTER_RIG = {
  reel: { idle: 2, intro: 8, walk: 4, phaseStep: 1.5, windup: 6, max: 12, bales: 5, recover: 4, stunned: 2 },
  reelEase: 4,
  balePitch: 1.4,
  baleKick: 0.3,
  kickDecay: 7,
  yawEase: 10,
  settle: 5,
  headerLift: 0.12,
  headerEase: 6,
  rumble: 0.008,
  chargeRumble: 0.02,
  rumbleRate: 38,
  stunRoll: 0.04,
  stunRate: 7,
  teleport: 2,
  smoke: '#4a4540',
  smokeGap: 0.16,
  shiftGap: 0.07,
  steam: '#e8e8e8',
  steamGap: 0.3,
  straw: '#e8c860',
} as const

export const MORNING_STAR = {
  scale: 1.7,
  tilt: 1.15,
  spin: 0.9,
  pulse: 0.06,
  pulseRate: 3,
  forward: 0.34,
  glow: 1.8,
  shiftRate: 6,
} as const

export const CHIEF_RIG = {
  idleBob: 0.022,
  idleRate: 2.3,
  walkRate: 3.4,
  minRate: 5,
  maxRate: 11,
  strideEase: 8,
  moving: 0.3,
  legSwing: 0.4,
  knee: 0.55,
  bob: 0.045,
  sway: 0.035,
  armSwing: 0.2,
  heldSwing: 0.08,
  raise: 1.95,
  raiseElbow: 0.55,
  follow: 0.3,
  followElbow: -0.12,
  snap: 0.12,
  rehide: 0.3,
  ease: 16,
  brace: 0.22,
  throwLean: 0.07,
  cannonBrace: 0.18,
  cannonDip: 0.06,
  cannonKick: 0.16,
  cannonSlide: 0.09,
  kickDecay: 10,
  bodyKick: 0.045,
  boreGlow: 2.6,
  eyeTelegraph: 1.7,
  lampBreath: 0.45,
  lampRate: 3.1,
  eyeBreath: 0.22,
  eyeRate: 1.9,
  hitHop: 0.6,
  hopDecay: 7,
  hopLean: 0.05,
  teleport: 2,
  spark: '#fff3a0',
  sparkSize: 0.05,
  ember: '#ffb04a',
  emberGap: 0.22,
  flash: '#ffb04a',
  smoke: '#e8dcc4',
} as const

export const CHIEF_DEFEAT = {
  lie: 2.3,
  fade: 0.9,
  reach: 0.55,
  layLean: -0.16,
  bombFlight: 0.42,
  bombRise: 0.5,
  bombForward: 1.6,
  bombSpacing: 0.32,
  bombRest: 0.14,
  fallAngle: 1.32,
  heel: -0.42,
  bounce: 0.07,
  eyeFade: 0.9,
  flicker: 30,
  dust: '#c8b48a',
  smoke: '#4a4540',
} as const

const DEG = Math.PI / 180

export const CAPTAIN_RIG = {
  idleBob: 0.016,
  idleRate: 2.1,
  walkRate: 3.2,
  minRate: 4.2,
  maxRate: 9,
  runRate: 1.6,
  strideEase: 7,
  moving: 0.25,
  hipForward: 13 * DEG,
  hipBack: 16 * DEG,
  leftForward: 17 * DEG,
  leftLift: 13 * DEG,
  leftRamp: 5 * DEG,
  leftKnee: 0.85,
  kneeBack: 0.3,
  runHip: 20 * DEG,
  runKnee: 1.3,
  bob: 0.03,
  sway: 0.025,
  walkReach: 17 * DEG,
  chargeReach: 36 * DEG,
  braceLean: 0.04,
  chargeLean: 0.055,
  crouch: 0.02,
  recoverReach: 30 * DEG,
  bashWind: 4 * DEG,
  bashTwist: 0.2,
  bashPush: 50 * DEG,
  bashLunge: 0.24,
  bashLean: 0.06,
  bashSnap: 0.1,
  bashHold: 0.22,
  introReach: 30 * DEG,
  stunSlump: 0.13,
  stunWobble: 0.05,
  stunRate: 5.5,
  pickLean: 0.22,
  pickReach: 26 * DEG,
  ease: 12,
  eyeBreath: 0.25,
  eyeRate: 1.9,
  eyeTelegraph: 1.8,
  eyeStunned: 0.3,
  coreBreath: 0.35,
  coreRate: 1.5,
  coreFlash: 2.6,
  flashDecay: 6,
  hitHop: 0.5,
  hopDecay: 7,
  hopLean: 0.035,
  blockShake: 5 * DEG,
  blockDecay: 14,
  sparkGap: 0.05,
  spark: '#fff6d0',
  ember: '#ffb04a',
  dust: '#c8b48a',
  dustGap: 0.06,
  wave: '#ffe2a8',
  waveSeconds: 0.34,
  waveFrom: 0.35,
  waveOpacity: 0.6,
  dropSeconds: 0.38,
  dropRise: 0.45,
  lieHeight: 0.1,
  lieOut: 0.3,
  lieTurn: -15 * DEG,
  teleport: 2,
} as const

export const CAPTAIN_DEFEAT = {
  plant: 0.55,
  raiseStart: 0.3,
  raise: 0.5,
  standForward: 1.15,
  standSide: 0.3,
  standTurn: -15 * DEG,
  salute: { arm: [-60 * DEG, -120 * DEG, 15 * DEG], forearm: [60 * DEG, 0, 30 * DEG] },
  saluteKept: 0.3,
  lie: 2.3,
  fade: 0.9,
  fallAngle: 1.36,
  heel: -0.45,
  bounce: 0.06,
  eyeFade: 0.9,
  flicker: 30,
  dust: '#c8b48a',
} as const

export const BOSS_DEFEAT = {
  blendIn: 0.12,
  maxBursts: 6,
  debris: 72,
  gravity: 14,
  bounce: 0.32,
  friction: 0.55,
  shrink: 0.35,
  shadowFade: 0.5,
  spark: '#ffd27a',
  ember: '#ff8a3d',
  dust: '#c8b48a',
  smoke: '#4a4540',
} as const

export const FX = {
  sparks: { max: 700, gravity: 11, drag: 1.6, width: 0.05, stretch: 0.06, glow: 2.6, hit: '#ffd060', crit: '#fff2a0', wall: '#ffe6b0', kill: '#ffb040', blast: '#ffc24a' },
  blobs: { max: 160 },
  fire: { count: 7, life: 0.42, glow: 1.9, colors: ['#ffe45a', '#ffb02e', '#ff7a1f'] },
  smoke: { count: 16, life: 1.3, colors: ['#5c4536', '#7a5f47', '#4a372c', '#93755a'] },
} as const

export const WRECK = {
  gravity: 16,
  push: 3.2,
  pushHeavy: 1.4,
  spread: 1.5,
  spreadHeavy: 0.5,
  lift: 4,
  liftHeavy: 2,
  spin: 10,
  spinHeavy: 3,
  jitter: 0.3,
  minRest: 0.06,
  climb: 0.25,
  bounce: 0.3,
  wallBounce: 0.35,
  restSpeed: 0.7,
  friction: 0.84,
  life: 2.6,
  sink: 0.5,
  sinkScale: 0.4,
  flash: 0.2,
  glow: 1.4,
} as const

export const SCARECROW_DEFEAT = {
  seconds: 4.6,
  recoil: 0.3,
  recoilLean: 0.32,
  wobble: 0.1,
  wobbleRate: 10,
  fall: 1.25,
  fallSeconds: 0.55,
  fallAngle: 1.5,
  bounce: 0.1,
  settle: 0.5,
  heel: -0.35,
  kneel: 0.2,
  hip: 0.5,
  knee: 1,
  armOut: 1.1,
  armFling: 0.6,
  armFlail: 1.3,
  armRest: 0,
  headSnap: 0.4,
  headDroop: -0.35,
  headLoll: 0.35,
  eyeFade: 1.1,
  flicker: 38,
  hatPop: 0.1,
  hatFlight: 0.9,
  hatRise: 1.8,
  hatBack: 1.4,
  hatSide: 1.1,
  hatSpin: 10,
  hatRest: 0.32,
  hatTilt: 0.2,
  hatRock: 0.16,
  forkTip: -1.31,
  forkLie: 0.04,
  forkDrop: 0.22,
  forkFall: 0.45,
  strawBurst: 22,
  strawLand: 12,
  strawGap: 0.16,
  wispGap: 0.4,
  sinkStart: 3.4,
  sinkDepth: 0.5,
  straw: '#e8c860',
  tin: '#c68a57',
  dust: '#bfa27a',
} as const

export const HARVESTER_DEFEAT = {
  seconds: 6.8,
  reelStop: 1.6,
  shake: 0.045,
  shakeRoll: 0.03,
  shakeRate: 33,
  shakeEnd: 1,
  unloaderStart: 0.1,
  unloaderEnd: 0.85,
  unloaderPitch: 1.58,
  slumpStart: 0.3,
  slumpEnd: 1.2,
  sink: 0.1,
  roll: 0.06,
  pitch: -0.025,
  headerLift: 0.1,
  roofPop: 1,
  roofAngle: 0.663,
  roofSpeed: 7,
  roofClear: 2,
  roofDrag: 1.4,
  roofGravity: 18,
  roofRest: 0.1,
  seatFire: 1.45,
  seatAccel: 30,
  seatClear: 2,
  seatBrake: 3,
  seatDrift: 1.6,
  seatTumble: 5,
  seatCenter: 0.34,
  seatHide: 15,
  seatBurn: 0.9,
  seatPlume: 0.035,
  shardPop: 1.9,
  shardFlight: 0.75,
  shardRise: 1.4,
  shardForward: 2.3,
  shardSide: 1.3,
  shardHover: 0.6,
  shardBob: 0.1,
  shardGlow: 3,
  shardCollect: 3.3,
  shardCollectSeconds: 0.55,
  shardCatch: 1,
  shardArc: 1.5,
  shardGrow: 1.8,
  shardSparkle: 0.3,
  fadeStart: 5.8,
  fadeSink: 0.25,
  smokeGap: 0.08,
  sparkGap: 0.11,
  smoke: '#38332e',
  flame: '#ff7a2a',
  steel: '#6e6873',
  paint: '#c8322a',
  glow: '#5ff0ff',
} as const

export const FALLBACK_DEFEAT = {
  seconds: 3.2,
  topple: 1.35,
  toppleSeconds: 0.7,
  tilt: 0.14,
  sink: 0.3,
  shrinkStart: 2.5,
  puffGap: 0.14,
} as const

export const KAI_DEATH = {
  blend: 0.12,
  stagger: 0.14,
  buckleStart: 0.06,
  buckleEnd: 0.38,
  fallStart: 0.26,
  fallEnd: 0.66,
  settle: 0.22,
  pitch: 1.42,
  bounce: 0.09,
  roll: 0.3,
  slide: 0.2,
  sink: 0.05,
  pivot: -0.14,
  flinch: 0.42,
  torso: 0.12,
  head: 0.4,
  headTurn: 0.35,
  thigh: 0.85,
  knee: 1.35,
  arm: 1.25,
  armLift: 0.35,
  elbow: 0.6,
  forearm: -1.4,
  gunDrop: 0,
  gunHop: 1.2,
  gunForward: 0.12,
  gunSide: 0.42,
  gunSpin: 1.1,
  gunBounce: 0.28,
  gravity: 9.8,
  dust: '#d8c9a8',
  burst: 0.75,
} as const

export const LANDMARK_FADE = {
  minHeight: 2.5,
  opacity: 0.35,
  seconds: 0.2,
  enterDelay: 0.1,
  leaveDelay: 0.2,
  probes: [
    [0, 0.35],
    [0, 0.65],
    [0, 1.1],
    [-0.25, 0.65],
    [0.25, 0.65],
  ],
  clearance: 0.05,
  cell: 0.5,
  slices: 24,
  depthOrder: 20,
  colorOrder: 21,
} as const

export const SCENE_CHUNK = { width: 12, depth: 12 } as const

export const TERRAIN = {
  floor: { top: 0, bottom: -0.2 },
  water: { top: -0.1, bottom: -0.22 },
  island: { top: -0.2, bottom: -1.6, color: '#7a5a3c' },
  roughness: { ground: 1, water: 0.25 },
} as const

export const PROP_ONE_PART: readonly string[] = ['ch1-tree', 'ch1-wall-wood', 'ch1-wall-stone', 'ch1-wall-rock', 'ch1-haystack', 'ch1-bush-wheat', 'ch1-fence']

export const SHADOW_LAYER = 1

export const SHADOWLESS_LANDMARKS: readonly LandmarkId[] = ['ch1-wheat-ears']

export const SHADOW_PROXY = {
  segments: 8,
  rings: 5,
  sectors: 8,
  bins: 6,
} as const

export const RIGID_PARTS = {
  joints: 24,
  bounds: 1.3,
} as const

export const BLOB_SHADOW = {
  darkness: 0.28,
  size: 1.2,
  stretch: 1.25,
  offset: 0.22,
  height: 0.06,
  inner: 0.3,
  texture: 64,
  order: -4,
} as const

export const LANDMARK_GLOW = {
  'ch1-star-altar': { node: 'star', gain: 2.4, swing: 0.7, speed: 1.6 },
} as const satisfies Readonly<Record<string, { node: string; gain: number; swing: number; speed: number }>>

export const CLUE_GLOW = '#ffe08a'

export const CLUE_PAPER = {
  width: 0.48,
  height: 0.58,
  fold: 0.36,
  color: '#f6ecd2',
  ink: '#6b5a44',
  seal: '#b8432f',
  glow: '#ffe7a3',
  glowBase: 0.55,
  glowSwing: 0.25,
  glowRate: 3,
  float: 0.75,
  bob: 0.08,
  bobRate: 2.4,
  sway: 0.5,
  swayRate: 1.3,
  tilt: 0.85,
  ring: '#ffd34d',
  beam: '#ffe08a',
  beamRadius: 0.32,
  beamHeight: 1.8,
  beamOpacity: 0.22,
  fadeNear: 1.6,
  fadeFar: 5.5,
  glowNear: 0.1,
} as const

export const SHEEP_RIG = {
  legSwing: (25 * Math.PI) / 180,
  stepRate: 9,
  moveEase: 8,
  turnRate: 7,
  bob: 0.02,
  walkNod: 0.06,
  graze: -0.4,
  nibble: 0.05,
  nibbleRate: 7,
  idleNod: 0.07,
  idleRate: 0.8,
  freed: '#fffaf0',
  home: '#c8f59a',
  fallbackWool: '#f4efe4',
  fallbackFace: '#2b2b2b',
} as const

export interface HingeRule {
  axis: MotionAxis
  angle: number
}

export const LANDMARK_OPEN = {
  seconds: 0.6,
  hinges: {
    'ch1-sheep-pen': { gate: { axis: 'z', angle: -(100 * Math.PI) / 180 } },
    'ch1-watermill': { secret_door: { axis: 'z', angle: -Math.PI / 2 } },
    'ch1-cellar': {
      door_l: { axis: 'x', angle: (110 * Math.PI) / 180 },
      door_r: { axis: 'x', angle: -(110 * Math.PI) / 180 },
    },
  },
} as const satisfies { seconds: number; hinges: Readonly<Partial<Record<LandmarkId, Readonly<Record<string, HingeRule>>>>> }

export const LANDMARK_SCATTER: Readonly<Partial<Record<LandmarkId, 'quarter' | 'any'>>> = {
  'ch1-ruined-wall': 'quarter',
  'ch1-wheat-stack': 'any',
  'ch1-stump': 'quarter',
  'ch1-bale-block': 'quarter',
  'ch1-anchor-crate': 'quarter',
}

export const LANDMARK_BATCH: readonly LandmarkId[] = ['ch1-log', 'ch1-log-short', 'ch1-stump']

export const ALARM_RIGS: Readonly<Partial<Record<LandmarkId, { bell: string; lamp: string; axis: MotionAxis }>>> = {
  'ch1-bell-tower': { bell: 'bell', lamp: 'lamp', axis: 'x' },
}

export const ALARM_BELL = {
  pullSwing: 0.14,
  rungSwing: 0.4,
  pullRate: 6,
  rungRate: 3.3,
  rise: 3,
  calm: 1.1,
  lampIdle: 0.2,
  lampOn: 2.8,
  lampOff: 0.3,
  runnerBlink: 2.5,
  pullBlink: 5,
  rungBlink: 4,
  wave: '#ffe08a',
  waves: 3,
  waveGap: 0.42,
  waveSeconds: 1.4,
  waveFrom: 1.4,
  waveTo: 10,
  waveOpacity: 0.7,
  waveWidth: 0.05,
  groundHeight: 0.12,
  groundOpacity: 0.55,
} as const

export const LANDMARK_FX: Readonly<Partial<Record<LandmarkId, { forge?: string; smoke?: string; waterfall?: string }>>> = {
  'ch1-smithy': { forge: 'socket_fx_forge', smoke: 'socket_fx_smoke' },
  'ch1-farmhouse': { smoke: 'socket_fx_smoke' },
  'ch1-waterfall-cave': { waterfall: 'socket_fx_waterfall' },
}

export const LANDMARK_LAMPS: Readonly<Partial<Record<LandmarkId, { node: string; glass: string; light: string }>>> = {
  'ch1-fog-lamp': { node: 'lamp', glass: 'mat_glass', light: 'socket_fx_light' },
}

export const CHIMNEY_SMOKE = {
  gap: 0.34,
  color: '#cbc4b9',
  from: 0.18,
  to: 0.68,
  seconds: 2.6,
  rise: 1.9,
  jitter: 0.12,
  range: 24,
} as const

export const FORGE_FIRE = {
  glow: '#ff6a1f',
  size: 0.2,
  opacity: 0.36,
  flicker: 0.35,
  rate: 11,
  material: 'mat_glow',
  heat: 1.35,
  sparkGap: [0.18, 0.75],
  spark: '#ffb04a',
  hot: '#fff1a0',
  sparkRise: 0.6,
} as const

export const LANDMARK_CRASH = {
  tilt: 0.055,
  rate: 15,
  decay: 3.4,
  seconds: 1.6,
  grain: '#f1c24a',
  straw: '#e8c860',
  grainBits: 30,
  strawBits: 8,
  puffs: 4,
  dust: '#c8b48a',
} as const

export const LANDMARK_HIT = {
  seconds: 0.22,
  squash: 0.035,
  puffGap: 0.12,
  puffHeight: 1.1,
  straw: '#e8c860',
} as const

export const LANDMARK_BREAK = {
  debris: 160,
  dust: '#c8b48a',
  cart: {
    wood: ['#8a5a32', '#c47c3c', '#6b4527'],
    grain: '#f1c24a',
    straw: '#e8c860',
    woodBits: 14,
    grainBits: 34,
    strawBits: 14,
    puffs: 6,
    burst: 1.5,
  },
  pillar: {
    straw: '#e8c860',
    dark: '#c4721a',
    strawBits: 30,
    puffs: 9,
    burst: 1.7,
  },
} as const

export const FOG_LAYER = {
  color: '#a9bec2',
  shade: '#5f777d',
  layers: [
    { height: 0.22, density: 0.38, scale: 0.17, drift: [0.11, 0.045], order: -2 },
    { height: 0.7, density: 0.32, scale: 0.12, drift: [-0.07, 0.06], order: -1.75 },
    { height: 1.2, density: 0.27, scale: 0.095, drift: [0.05, -0.05], order: -1.5 },
    { height: 1.75, density: 0.22, scale: 0.075, drift: [-0.04, 0.08], order: -1.25 },
  ],
  noise: { size: 256, period: 16, octaves: 3, seeds: [7, 90], mean: 0.5, deviation: 0.137, rowsPerStep: 32 },
  clear: 1.3,
  edge: 0.25,
  margin: 2,
  blur: 2,
  spread: 0.07,
  areaSpread: 0.022,
  maxDelay: 0.6,
  fade: 0.45,
  under: -3,
} as const

export const FOG_VEIL = {
  seconds: 0.35,
  eye: '#ffa526',
  eyeSize: 0.46,
  eyeOpacity: 1,
  halo: '#ff7a14',
  haloSize: 1.5,
  haloOpacity: 0.6,
  flicker: 0.12,
  flickerRate: 6.5,
  hideAt: 0.55,
  fallbackHeight: 1,
  fallbackForward: 0.25,
} as const

export const LAMP_GLOW = {
  emissive: '#ffc35a',
  intensity: 1.8,
  breath: 0.1,
  breathRate: 2.3,
  rise: 0.5,
  halo: '#ffd27a',
  haloSize: 1.9,
  haloOpacity: 0.8,
  pool: '#ffc96a',
  poolRadius: 2.8,
  poolOpacity: 0.5,
  ring: '#ffe3a0',
  ringSeconds: 1.1,
  ringOpacity: 0.9,
  ringWidth: 0.07,
  ringHeight: 0.09,
  areaRing: 15,
  flash: 1.6,
  flashSeconds: 0.45,
  motes: 10,
} as const

export const WATERFALL = {
  width: 1.5,
  forward: 0.1,
  bulge: 0.38,
  columns: 8,
  rows: 14,
  color: '#e8f7ff',
  deep: '#5aa6d0',
  opacity: 1,
  faded: 0.22,
  speed: 1.7,
  fadeSeconds: 0.35,
  splash: '#d8f2ff',
  splashRadius: 0.95,
  splashOpacity: 0.28,
  mist: '#eef6fa',
  mistSize: [0.5, 1.3],
  mistOpacity: 0.26,
  mistSeconds: 1.6,
  mistRise: 0.9,
  mistCount: 9,
  range: 24,
  secretReach: 3,
} as const

export const STUMP_CRASH = {
  tilt: 0.12,
  rate: 17,
  decay: 4.2,
  seconds: 1.2,
  chips: ['#c48a52', '#8a5634', '#e9b674', '#6b4527'],
  chipBits: 18,
  puffs: 3,
  dust: '#c8b48a',
  breakBits: 36,
  breakPuffs: 7,
  burst: 1.3,
} as const

export const LADDER = {
  angle: (73 * Math.PI) / 180,
  width: 0.48,
  rail: 0.065,
  rung: 0.038,
  gap: 0.3,
  lip: 0.28,
  inset: 0.04,
  color: '#9a6a3c',
} as const

export const PERCH_DROP = { seconds: 0.55, arc: 0.6 } as const

export const RADAR_ARROW = {
  color: '#5ff0ff',
  radius: 2.15,
  size: 0.42,
  opacity: 0.85,
  pulse: 0.3,
  rate: 3.2,
  height: 0.07,
  ring: 0.18,
  turn: 10,
} as const

export const TANK_RIG = {
  barrels: ['barrel_3', 'barrel_2', 'barrel_1'],
  muzzles: ['socket_muzzle_3', 'socket_muzzle_2', 'socket_muzzle_1'],
  recoil: 0.1,
  kickIn: 0.04,
  kickOut: 0.34,
  lidAngle: (100 * Math.PI) / 180,
  lidSeconds: 0.16,
  lidSafe: [(10 * Math.PI) / 180, (85 * Math.PI) / 180],
  turretLimit: (120 * Math.PI) / 180,
  turretEase: 9,
  hullTurn: 7,
  trackPeriod: 0.312,
  gauge: 0.698,
  eyeHalo: '#ffb02e',
  eyeSize: 1.15,
  eyeOpacity: 0.7,
  eyeTelegraph: 1.9,
  eyeStunned: 0.35,
  eyeBreath: 0.15,
  eyeRate: 2.1,
  flashDecay: 7,
  dust: '#c8b48a',
  dustGap: 0.06,
  muzzleFlash: '#ffb36b',
  muzzleSmoke: '#e8dcc4',
  jolt: 0.07,
  joltDecay: 6,
  hop: 0.035,
  teleport: 2,
} as const

export const TANK_DEFEAT = {
  slow: 1.1,
  fast: 3.6,
  open: 2,
  turn: 2.4,
  slip: 3.2,
  spin: 2.4,
  beyond: 2.6,
  fade: 0.8,
  seconds: 7.2,
  smoke: '#2f2b28',
  smokeGap: 0.07,
  dust: '#c8b48a',
  lamps: 0.25,
} as const

export const MINE_LIGHT = {
  idle: [0.3, 1.9],
  idleRate: 1.3,
  armed: [0.5, 3.4],
  armedRate: 11,
  halo: '#ff3a1e',
  haloSize: 0.55,
  haloOpacity: 0.6,
  height: 0.13,
  spark: '#ff2a14',
  sparkSize: 0.2,
  sparkLow: 0.35,
  ring: '#ff4b3a',
  ringArmed: '#ff2a14',
  ringWidth: 0.14,
  ringFill: 0.3,
  ringHeight: 0.02,
  ringIdle: [0.22, 0.45],
  ringLit: 0.9,
  settle: 0.16,
  drop: 0.12,
} as const

export const BLADE_RIG = {
  turnSeconds: 0.55,
  reel: { rest: 1.4, warning: 7, sweep: 16 },
  reelEase: 5,
  shake: { rest: 0, warning: 0.012, sweep: 0.024 },
  shakeRate: 37,
  fallback: {
    body: '#b8322a',
    dark: '#3a3e45',
    steel: '#d3dae1',
    stripe: '#f2c230',
    brass: '#c9a24a',
    eye: '#ffb02e',
  },
} as const

export const BLADE_WARNING = {
  height: 0.04,
  color: '#ff2414',
  hot: '#ffd23a',
  warning: 0.5,
  sweep: 0.62,
  pulse: 0.18,
  pulseRate: 9,
  stripe: 1.3,
  stripeSpeed: 2.4,
  head: 0.9,
  edge: 0.12,
} as const

export const BLADE_SPARKS = {
  flash: '#fff4c8',
  core: '#ffffff',
  spark: '#ffd27a',
  ember: '#ff8a3d',
  smoke: '#9aa0a6',
  chips: ['#ffe9a8', '#ffd27a', '#ff9a3d', '#8d939a', '#ffd27a', '#b8322a'],
  debris: 64,
  height: 0.55,
  player: { flash: 1.3, sparks: 12, chips: 16, push: 4.2, smoke: 0 },
  enemy: { flash: 1.4, sparks: 14, chips: 22, push: 4.6, smoke: 0.7 },
  dodged: { flash: 0.7, sparks: 6, chips: 6, push: 3, smoke: 0 },
} as const

export const BELT_VIEW = {
  boss: { speed: 1.3, active: '#ffb238', idle: '#6b5a3a' },
  normal: '#ffb238',
  belt: '#3c3f44',
  range: 18,
} as const

export const BELT_CARGO = {
  models: { bale: 'ch1-bale-block', crate: 'ch1-anchor-crate' },
  fallback: { bale: '#d8b25a', crate: '#8a5a32' },
  gap: 2.6,
  jitter: 0.35,
  empty: 0.18,
  bale: 0.55,
  scale: 0.72,
  surface: 0.06,
  grow: 0.6,
  drop: 0.4,
  corner: 1,
  tail: 3,
  turn: 0.1,
  decks: { 'ch1-airship': 0.02 } as Readonly<Partial<Record<LandmarkId, number>>>,
} as const

export const LEVEL_CACHE = { extraLevels: 1 } as const

export const VIEW_SLICES = { budgetMs: 4, coveredMs: 10, waitMs: 50 } as const

export const WARMUP_SLICES = { budgetMs: 4, coveredMs: 10, compilingMs: 6, waitMs: 50, pollMs: 10, objectsPerStep: 128, fadesPerStep: 16 } as const

export const TEXTURE_TRANSCODER = { idleMs: 2000 } as const

export const UPLOAD_PACING = { batchBytes: 8 * 1024 * 1024, idleMs: 100 } as const
