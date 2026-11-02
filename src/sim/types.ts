import type { AttackCause } from '../data/attacks'
import type { BossHazard, BossMoveId } from '../data/bosses'
import type { ClueId } from '../data/clues'
import type { BarkDisplay, SpeakerId } from '../data/dialogue'
import type { AffixId } from '../data/elites'
import type { IdleMode, MinionKind } from '../data/enemies'
import type { LandmarkId } from '../data/landmarks'
import type { BuffId, ChestTier, FoodKind } from '../data/loot'
import type { SkillId, SkillSlot } from '../data/skills'
import type { PlayerWeaponId, StatusKind, WeaponId } from '../data/weapons'
import type { Vec2 } from './math'

export type { MinionKind } from '../data/enemies'

export type Team = 'player' | 'enemy'

export type EnemyKind = MinionKind | 'boss'

export type EnemyState = 'idle' | 'chase' | 'windup' | 'recover' | 'aim' | 'arming' | 'charge' | 'dash'

export type BossPhase = 'dormant' | 'intro' | 'walk' | 'telegraph' | 'active' | 'recover' | 'stunned' | 'shift'

export type AlertState = 'idle' | 'suspicious' | 'combat' | 'search' | 'return'

export interface EliteState {
  affixes: AffixId[]
  shield: number
  shieldMax: number
  sinceHit: number
}

export type BlastSource = 'bomber' | 'boss' | 'player'

export type MineCause = 'stepped' | 'shot' | 'crowded'

export interface Attack {
  by: EnemyKind | null
  cause: AttackCause
  elite: boolean
  boss: string | null
}

export interface StatusState {
  burn: number
  burnDps: number
  burnTick: number
  chill: number
  chillTime: number
  chillSlow: number
  frozen: number
  stunned: number
  dazed: number
}

export interface SkillRuntime {
  slot: SkillSlot
  id: SkillId
  rank: number
  cooldown: number
}

export interface Body {
  id: number
  pos: Vec2
  prev: Vec2
  z: number
  prevZ: number
  knock: Vec2
  radius: number
}

export type WeaponSlot = 'primary' | 'special'

export interface ActiveBuff {
  id: BuffId
  remaining: number
  duration: number
}

export interface Player extends Body {
  hp: number
  maxHp: number
  facing: number
  pitch: number
  vz: number
  grounded: boolean
  dashCooldown: number
  meleeCooldown: number
  primary: PlayerWeaponId
  magazine: number
  ammo: number
  reload: number
  special: PlayerWeaponId | null
  specialAmmo: number
  slot: WeaponSlot
  cooldown: number
  burstLeft: number
  burstTimer: number
  burstAngle: number
  burstWeapon: PlayerWeaponId
  sinceDamage: number
  sinceAttack: number
  buffs: ActiveBuff[]
  shield: number
  regenerating: boolean
  aim: Vec2
  skills: SkillRuntime[]
  rollTime: number
  rollDirX: number
  rollDirY: number
  rollSpeed: number
  invulnerable: number
  empowered: number
  burstEmpower: number
  barrier: number
  barrierTime: number
  barrierBurst: number
  ultimate: number
  ultShots: number
  ultTimer: number
  status: StatusState
  alive: boolean
}

export interface BossShield {
  held: boolean
  x: number
  y: number
  facing: number
  lift: number
}

export interface TankState {
  turret: number
  hatch: boolean
  minesLeft: number
  barrels: number
  reverse: boolean
  lap: number
  retreat: number
}

export interface BossState {
  id: string
  phase: BossPhase
  move: BossMoveId | null
  order: BossMoveId[]
  moveIndex: number
  timer: number
  volleysLeft: number
  chargeX: number
  chargeY: number
  chargeTraveled: number
  chargeHit: boolean
  summoned: boolean
  phaseIndex: number
  hazards: BossHazard[]
  bladeTimer: number
  frenzyLeft: number
  balesLeft: number
  shotsLeft: number
  bombs: number
  rackTimer: number
  shield: BossShield | null
  tank?: TankState
}

export interface Enemy extends Body {
  kind: EnemyKind
  hp: number
  maxHp: number
  facing: number
  state: EnemyState
  stateTime: number
  home: Vec2
  area: number
  aggro: boolean
  alert: AlertState
  alertTime: number
  notice: number
  lookTime: number
  lastSeen: Vec2
  sinceSeen: number
  idleMode: IdleMode
  baseFacing: number
  route: Vec2[]
  routeIndex: number
  wanderTarget: Vec2 | null
  wanderWait: number
  leashed: boolean
  speedScale: number
  cooldownScale: number
  cooldown: number
  aimAngle: number
  rushCooldown: number
  dashFrom: Vec2
  dashHit: boolean
  cover: Vec2 | null
  flank: number
  engaged: boolean
  summoned: boolean
  status: StatusState
  elite: EliteState | null
  boss: BossState | null
}

export interface Bullet {
  id: number
  team: Team
  weapon: WeaponId
  pos: Vec2
  prev: Vec2
  z: number
  prevZ: number
  origin: Vec2
  dirX: number
  dirY: number
  speed: number
  vz: number
  traveled: number
  range: number
  radius: number
  damage: number
  knockback: number
  pierce: number
  bounces: number
  chain: number
  chainRange: number
  chainFalloff: number
  explodeRadius: number
  splash: number
  status: StatusKind
  statusPower: number
  statusDuration: number
  hits: number[]
  landed: boolean
  attack: Attack | null
}

export type LobLanding = 'blast' | 'mine'

export interface Lob {
  id: number
  team: Team
  weapon: WeaponId
  lands: LobLanding
  from: Vec2
  to: Vec2
  pos: Vec2
  prev: Vec2
  fromZ: number
  toZ: number
  z: number
  prevZ: number
  height: number
  peak: number
  time: number
  total: number
  radius: number
  damage: number
  knockback: number
  attack: Attack | null
}

export interface Blast {
  id: number
  x: number
  y: number
  radius: number
  delay: number
  total: number
  playerDamage: number
  enemyDamage: number
  source: BlastSource
  ownerId: number
  inner: number
  arcCenter: number
  arcWidth: number
  gapCenter: number
  gapWidth: number
  attack: Attack | null
  weapon: WeaponId | null
}

export interface Ring {
  id: number
  x: number
  y: number
  z: number
  radius: number
  prevRadius: number
  maxRadius: number
  speed: number
  height: number
  damage: number
  knockback: number
  hitPlayer: boolean
  attack: Attack | null
}

export interface SpawnMarker {
  id: number
  pos: Vec2
  remaining: number
  total: number
  kind: MinionKind
  area: number
  summoned: boolean
}

export type PickupItem =
  | { type: 'heal'; amount: number; food?: FoodKind }
  | { type: 'buff'; buff: BuffId }
  | { type: 'ammo' }
  | { type: 'weapon'; weapon: PlayerWeaponId; ammo: number }

export interface Pickup {
  id: number
  item: PickupItem
  pos: Vec2
  from: Vec2
  age: number
  life: number
}

export interface ChestPerch {
  landmark: number
  x: number
  y: number
  height: number
}

export interface Chest {
  id: number
  tier: ChestTier
  pos: Vec2
  area: number
  opened: boolean
  weapon: PlayerWeaponId | null
  perch: ChestPerch | null
}

export interface Mine {
  id: number
  pos: Vec2
  age: number
  fuse: number
  blast: number
  cause: MineCause | null
  owner: string
  attack: Attack | null
}

export interface LandmarkState {
  hp: number
  maxHp: number
  broken: boolean
  open: boolean
  crashes: number
}

export type BladePhase = 'rest' | 'warning' | 'sweep'

export interface BladeState {
  pos: Vec2
  prev: Vec2
  facing: number
  phase: BladePhase
  timer: number
  warning: number
  forward: boolean
  hits: Map<number, number>
}

export type AlarmStatus = 'quiet' | 'running' | 'rung'

export interface AlarmState {
  status: AlarmStatus
  runner: number | null
  pos: Vec2
  pulling: number
  runners: number
}

export type SheepState = 'penned' | 'leaving' | 'grazing'

export interface Sheep {
  id: number
  pen: number
  pos: Vec2
  prev: Vec2
  facing: number
  state: SheepState
  wait: number
  target: Vec2 | null
  moving: boolean
}

export interface ClueDrop {
  id: number
  clue: ClueId
  pos: Vec2
  area: number
  taken: boolean
}

export interface Supply {
  id: number
  pos: Vec2
  area: number
  used: boolean
}

export interface PlayerCommand {
  moveX: number
  moveY: number
  aimX: number
  aimY: number
  pitch: number
  fire: boolean
  slot: WeaponSlot | null
  interact: boolean
  skill: SkillSlot | null
  ultimate: boolean
  jump: boolean
  dash: boolean
  melee: boolean
}

export type GameEvent =
  | { type: 'shot'; x: number; y: number; z: number; angle: number; pitch: number; weapon: WeaponId }
  | { type: 'enemyShot'; x: number; y: number; z: number; angle: number; pitch: number; weapon: WeaponId }
  | { type: 'weaponChanged'; weapon: PlayerWeaponId; slot: WeaponSlot }
  | { type: 'weaponEmpty'; weapon: PlayerWeaponId }
  | { type: 'bulletHitWall'; x: number; y: number; z: number; team: Team }
  | { type: 'bulletExpired'; x: number; y: number; z: number; team: Team }
  | { type: 'enemyHit'; id: number; x: number; y: number; z: number; damage: number; crit: boolean }
  | { type: 'enemyKilled'; id: number; kind: EnemyKind; x: number; y: number }
  | { type: 'enemyWindup'; id: number }
  | { type: 'enemyCharge'; id: number; x: number; y: number; angle: number }
  | { type: 'enemyAlerted'; id: number; x: number; y: number }
  | { type: 'enemySpawned'; id: number; x: number; y: number }
  | { type: 'playerHit'; x: number; y: number; damage: number; absorbed: number; fromX: number; fromY: number }
  | { type: 'playerDied'; x: number; y: number; attack: Attack | null }
  | { type: 'blast'; x: number; y: number; radius: number; source: BlastSource }
  | { type: 'waveStarted'; wave: number }
  | { type: 'areaEntered'; index: number; name: string }
  | { type: 'areaLocked'; index: number }
  | { type: 'areaCleared'; index: number }
  | { type: 'bossIntro'; name: string; story?: boolean }
  | { type: 'bossMove'; move: BossMoveId }
  | { type: 'bossCrash'; x: number; y: number }
  | { type: 'bossSummon' }
  | { type: 'bossDefeated'; name: string; x: number; y: number }
  | { type: 'levelComplete' }
  | { type: 'pickupDropped'; id: number; x: number; y: number; item: PickupItem }
  | { type: 'pickedUp'; item: PickupItem; x: number; y: number; amount: number }
  | { type: 'buffEnded'; buff: BuffId }
  | { type: 'shieldBroken'; x: number; y: number }
  | { type: 'chestOpened'; x: number; y: number; tier: ChestTier }
  | { type: 'bonusXp'; x: number; y: number; amount: number }
  | { type: 'crateBroken'; x: number; y: number; index: number }
  | { type: 'supplyUsed'; x: number; y: number; amount: number }
  | { type: 'skillCast'; skill: SkillId; x: number; y: number }
  | { type: 'shockwave'; x: number; y: number; radius: number }
  | { type: 'melee'; x: number; y: number; angle: number; hits: number }
  | { type: 'smashed'; id: number; kind: EnemyKind; x: number; y: number; z: number }
  | { type: 'jumped' }
  | { type: 'landed'; fall: number }
  | { type: 'dashed'; x: number; y: number; angle: number }
  | { type: 'ringStarted'; id: number; x: number; y: number }
  | { type: 'dodged'; x: number; y: number }
  | { type: 'barrierBroken'; x: number; y: number; radius: number }
  | { type: 'ultimateReady' }
  | { type: 'ultimateFired'; x: number; y: number }
  | { type: 'bulletBounced'; x: number; y: number }
  | { type: 'chain'; fromX: number; fromY: number; toX: number; toY: number }
  | { type: 'frozen'; id: number; x: number; y: number }
  | { type: 'enemySuspicious'; id: number; x: number; y: number }
  | { type: 'enemyGaveUp'; id: number; x: number; y: number }
  | { type: 'shieldBlocked'; id: number; x: number; y: number }
  | { type: 'eliteShieldBroken'; id: number; x: number; y: number }
  | { type: 'bossStunned'; x: number; y: number }
  | { type: 'bossPhase'; index: number; name: string }
  | { type: 'rockBroken'; x: number; y: number; index: number }
  | { type: 'stunned'; id: number; x: number; y: number }
  | { type: 'landmarkHit'; index: number; x: number; y: number; damage: number }
  | { type: 'landmarkBroken'; index: number; id: LandmarkId; state: string; x: number; y: number }
  | { type: 'landmarkOpened'; index: number; id: LandmarkId; node: string; x: number; y: number }
  | { type: 'sheepFreed'; id: number; pen: number; x: number; y: number }
  | { type: 'sheepHome'; id: number; x: number; y: number }
  | { type: 'clueDropped'; id: number; clue: ClueId; x: number; y: number }
  | { type: 'clueFound'; id: number; clue: ClueId; x: number; y: number }
  | { type: 'secretFound'; index: number; landmark: number | null; x: number; y: number }
  | { type: 'alarmRunner'; alarm: number; id: number; x: number; y: number }
  | { type: 'alarmPull'; alarm: number; id: number; x: number; y: number }
  | { type: 'alarmStopped'; alarm: number; id: number; x: number; y: number }
  | { type: 'alarmRaised'; alarm: number; landmark: number; x: number; y: number }
  | { type: 'reinforcements'; area: number; count: number }
  | { type: 'bossBackHit'; id: number; x: number; y: number; damage: number }
  | { type: 'bossShield'; held: boolean; x: number; y: number; facing: number }
  | { type: 'landmarkCrashed'; index: number; id: LandmarkId; x: number; y: number; crashes: number; left: number }
  | { type: 'lampLit'; index: number; landmark: number; x: number; y: number; radius: number; area: number | null }
  | { type: 'tankShot'; barrel: number; x: number; y: number; angle: number }
  | { type: 'mineLaid'; id: number; x: number; y: number }
  | { type: 'mineTriggered'; id: number; x: number; y: number; fuse: number }
  | { type: 'mineExploded'; id: number; x: number; y: number; cause: MineCause }
  | { type: 'bladeWarning'; index: number; x: number; y: number; angle: number; seconds: number }
  | { type: 'bladeSweep'; index: number; x: number; y: number; angle: number }
  | { type: 'bladeParked'; index: number; x: number; y: number }
  | { type: 'bladeHit'; index: number; id: number; x: number; y: number; damage: number }
  | {
      type: 'bark'
      id: string
      speaker: SpeakerId | null
      text: string
      display: BarkDisplay
      enemy: number | null
      x: number
      y: number
      seconds: number
      radio?: boolean
    }
