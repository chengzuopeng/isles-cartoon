import type { MinionKind } from './enemies'
import type { LandmarkId } from './landmarks'
import type { WeaponId } from './weapons'

export type BossMoveId = 'charge' | 'slam' | 'fan' | 'sweep' | 'bales' | 'spin' | 'frenzy' | 'cannon' | 'bash' | 'triple' | 'mines'

export type MoveOrder = 'shuffle' | 'cycle'

export type BossTier = 'mini' | 'chapter'

export type BossHazard = 'conveyor' | 'blades'

export type ChargeMove = {
  telegraph: number
  speed: number
  distance: number
  damage: number
  knockback: number
  recover: number
  cause?: WeaponId
}

export type WeaponMove = {
  weapon: WeaponId
  recover: number
}

export type RingMove = {
  radius: number
  height: number
  speed: number
}

export type BalesMove = {
  weapon: WeaponId
  count: number
  windup: number
  interval: number
  scatterMin: number
  scatter: number
  recover: number
  flight: number
  lead: number
}

export type CannonMove = {
  weapon: WeaponId
  telegraph: number
  shots: number
  interval: number
  recover: number
  lead: number
}

export type BashMove = {
  weapon: WeaponId
  recover: number
  reach: number
  chase: number
}

export type GuardDef = {
  frontDeg: number
  backDeg: number
  backScale: number
  turnDeg: number
  recoverTurnDeg: number
  pickup: number
  crashInto: LandmarkId
  crashStuns: number
  dropSide: number
  dropBack: number
}

export type TreadDef = {
  pull: number
  probe: number
  lead: number
  turretDeg: number
}

export type TripleMove = {
  weapon: WeaponId
  barrels: number
  telegraph: number
  spreadDeg: number
  interval: number
  recover: number
  lead: number
}

export type MineMove = {
  weapon: WeaponId
  count: number
  windup: number
  interval: number
  flight: number
  scatterMin: number
  scatter: number
  trigger: number
  fuse: number
  max: number
  overflow: number
  recover: number
  lead: number
}

export type RamDef = {
  into: LandmarkId
  stuns: number
}

export type BombRack = {
  size: number
  refill: number
}

export type DefeatShow = {
  lay: number
  fall: number
}

export type SpinMove = {
  weapon: WeaponId
  inner: number
  gapDeg: number
  recover: number
}

export type FrenzyMove = {
  charges: number
  gap: number
  telegraph: number
  firstTelegraph: number
}

export type BossSummon = {
  kind: MinionKind
  count: number
}

export type BossPhaseDef = {
  at: number
  name: string
  moves: BossMoveId[]
  summon: BossSummon | null
  hazards: BossHazard[]
}

export type HazardTuning = {
  conveyorSpeed: number
  bladeInterval: number
  bladeEdge: number
}

export type BossDef = {
  name: string
  tier: BossTier
  radius: number
  maxHp: number
  walkSpeed: number
  walkTime: number
  keepDistance: number
  introTime: number
  moves: BossMoveId[]
  order: MoveOrder
  summonAt: number
  summon: readonly BossSummon[]
  summonWarning: number
  stunSeconds: number
  stunDamageScale: number
  phaseShift: number
  charge: ChargeMove
  slam: WeaponMove | null
  ring: RingMove | null
  fan: WeaponMove | null
  sweep: WeaponMove | null
  bales: BalesMove | null
  spin: SpinMove | null
  frenzy: FrenzyMove | null
  cannon: CannonMove | null
  bash: BashMove | null
  guard: GuardDef | null
  rack: BombRack | null
  show: DefeatShow | null
  tread: TreadDef | null
  triple: TripleMove | null
  mines: MineMove | null
  ram: RamDef | null
  retreat: number
  phases: BossPhaseDef[]
  hazards: HazardTuning
}

const NO_HAZARDS: HazardTuning = { conveyorSpeed: 0, bladeInterval: 0, bladeEdge: 0 }

export const BOSS_ROCK_HITS = 2

export const BOSSES: Record<string, BossDef> = {
  scarecrow: {
    name: '铁皮稻草人',
    tier: 'mini',
    radius: 1.6,
    maxHp: 7600,
    walkSpeed: 2.9,
    walkTime: 1.4,
    keepDistance: 1.9,
    introTime: 1.4,
    moves: ['charge', 'fan', 'slam'],
    order: 'shuffle',
    summonAt: 0.5,
    summon: [{ kind: 'grunt', count: 2 }],
    summonWarning: 1.2,
    stunSeconds: 2.5,
    stunDamageScale: 1.5,
    phaseShift: 1.2,
    charge: { telegraph: 0.9, speed: 17.6, distance: 14.4, damage: 180, knockback: 10, recover: 1.2 },
    slam: { weapon: 'strawSlam', recover: 0.8 },
    ring: { radius: 12, height: 0.6, speed: 9 },
    fan: { weapon: 'strawFan', recover: 0.7 },
    sweep: null,
    bales: null,
    spin: null,
    frenzy: { charges: 2, gap: 0.45, telegraph: 0.55, firstTelegraph: 0.8 },
    cannon: null,
    bash: null,
    guard: null,
    rack: null,
    show: null,
    tread: null,
    triple: null,
    mines: null,
    ram: null,
    retreat: 0,
    phases: [
      { at: 1, name: '第一阶段', moves: ['charge', 'fan', 'slam'], summon: null, hazards: [] },
      { at: 0.5, name: '狂怒', moves: ['frenzy', 'fan', 'slam', 'charge'], summon: { kind: 'grunt', count: 2 }, hazards: [] },
    ],
    hazards: NO_HAZARDS,
  },
  harvester: {
    name: '巨型收割机',
    tier: 'chapter',
    radius: 1.35,
    maxHp: 68000,
    walkSpeed: 1.8,
    walkTime: 0.9,
    keepDistance: 1.2,
    introTime: 2,
    moves: ['sweep', 'charge', 'charge'],
    order: 'shuffle',
    summonAt: 0.8,
    summon: [],
    summonWarning: 1.2,
    stunSeconds: 2.5,
    stunDamageScale: 1.5,
    phaseShift: 1.5,
    charge: { telegraph: 0.8, speed: 12, distance: 11, damage: 260, knockback: 11, recover: 1 },
    slam: null,
    ring: null,
    fan: null,
    sweep: { weapon: 'reaperSweep', recover: 0.7 },
    bales: { weapon: 'baleToss', count: 5, windup: 0.4, interval: 0.35, scatterMin: 0.4, scatter: 2.4, recover: 0.8, flight: 0, lead: 0 },
    spin: { weapon: 'bladeSpin', inner: 1.3, gapDeg: 70, recover: 0.9 },
    frenzy: { charges: 3, gap: 0.5, telegraph: 0.45, firstTelegraph: 0.72 },
    cannon: null,
    bash: null,
    guard: null,
    rack: null,
    show: null,
    tread: null,
    triple: null,
    mines: null,
    ram: null,
    retreat: 0,
    phases: [
      { at: 1, name: '第一阶段', moves: ['sweep', 'charge', 'charge'], summon: { kind: 'grunt', count: 3 }, hazards: [] },
      { at: 0.6, name: '第二阶段', moves: ['sweep', 'charge', 'bales', 'spin'], summon: null, hazards: ['conveyor'] },
      {
        at: 0.3,
        name: '第三阶段',
        moves: ['frenzy', 'sweep', 'bales', 'spin'],
        summon: { kind: 'bomber', count: 3 },
        hazards: ['conveyor', 'blades'],
      },
    ],
    hazards: { conveyorSpeed: 2.6, bladeInterval: 0.7, bladeEdge: 0.5 },
  },
  'demo-chief': {
    name: '爆破头目',
    tier: 'mini',
    radius: 1,
    maxHp: 11000,
    walkSpeed: 1.6,
    walkTime: 1.1,
    keepDistance: 3,
    introTime: 1.6,
    moves: ['bales', 'cannon'],
    order: 'cycle',
    summonAt: 0.5,
    summon: [
      { kind: 'bomber', count: 2 },
      { kind: 'thrower', count: 1 },
    ],
    summonWarning: 1.2,
    stunSeconds: 2.5,
    stunDamageScale: 1.5,
    phaseShift: 0,
    charge: { telegraph: 0.9, speed: 10, distance: 8, damage: 0, knockback: 0, recover: 1 },
    slam: null,
    ring: null,
    fan: null,
    sweep: null,
    bales: { weapon: 'chiefBomb', count: 3, windup: 0.5, interval: 0.4, scatterMin: 0.8, scatter: 1.8, recover: 0.8, flight: 1, lead: 0.8 },
    spin: null,
    frenzy: null,
    cannon: { weapon: 'chiefCannon', telegraph: 0.6, shots: 5, interval: 0.14, recover: 0.7, lead: 0.8 },
    bash: null,
    guard: null,
    rack: { size: 8, refill: 0.9 },
    show: { lay: 2, fall: 1 },
    tread: null,
    triple: null,
    mines: null,
    ram: null,
    retreat: 0,
    phases: [],
    hazards: NO_HAZARDS,
  },
  'shield-captain': {
    name: '铁盾队长',
    tier: 'mini',
    radius: 1,
    maxHp: 12800,
    walkSpeed: 1.7,
    walkTime: 1.1,
    keepDistance: 3,
    introTime: 1.6,
    moves: ['charge', 'bash'],
    order: 'cycle',
    summonAt: 0.5,
    summon: [{ kind: 'shield', count: 2 }],
    summonWarning: 1.2,
    stunSeconds: 2.5,
    stunDamageScale: 1.5,
    phaseShift: 0,
    charge: { telegraph: 0.9, speed: 10, distance: 9, damage: 200, knockback: 10, recover: 1.2, cause: 'captainRush' },
    slam: null,
    ring: null,
    fan: null,
    sweep: null,
    bales: null,
    spin: null,
    frenzy: null,
    cannon: null,
    bash: { weapon: 'captainBash', recover: 0.8, reach: 2.6, chase: 2 },
    guard: {
      frontDeg: 120,
      backDeg: 120,
      backScale: 1.5,
      turnDeg: 120,
      recoverTurnDeg: 45,
      pickup: 0.6,
      crashInto: 'ch1-silo',
      crashStuns: 2,
      dropSide: 1,
      dropBack: 0.3,
    },
    rack: null,
    show: { lay: 2, fall: 1 },
    tread: null,
    triple: null,
    mines: null,
    ram: null,
    retreat: 0,
    phases: [],
    hazards: NO_HAZARDS,
  },
  'forest-tank': {
    name: '林地炮车',
    tier: 'mini',
    radius: 1.1,
    maxHp: 20400,
    walkSpeed: 2.4,
    walkTime: 0.8,
    keepDistance: 3,
    introTime: 1.6,
    moves: ['triple', 'mines', 'charge'],
    order: 'cycle',
    summonAt: 0.5,
    summon: [{ kind: 'bomber', count: 2 }],
    summonWarning: 1.2,
    stunSeconds: 2.5,
    stunDamageScale: 1.5,
    phaseShift: 0,
    charge: { telegraph: 0.9, speed: 9, distance: 9, damage: 220, knockback: 10, recover: 1.2, cause: 'tankRam' },
    slam: null,
    ring: null,
    fan: null,
    sweep: null,
    bales: null,
    spin: null,
    frenzy: null,
    cannon: null,
    bash: null,
    guard: null,
    rack: null,
    show: null,
    tread: { pull: 0.8, probe: 1.2, lead: 0.55, turretDeg: 160 },
    triple: { weapon: 'tankShell', barrels: 3, telegraph: 0.8, spreadDeg: 22, interval: 0.08, recover: 0.8, lead: 0.6 },
    mines: {
      weapon: 'tankMine',
      count: 4,
      windup: 0.5,
      interval: 0.3,
      flight: 1,
      scatterMin: 1.2,
      scatter: 2.6,
      trigger: 0.6,
      fuse: 0.25,
      max: 8,
      overflow: 0.8,
      recover: 0.6,
      lead: 0.6,
    },
    ram: { into: 'ch1-stump', stuns: 2 },
    retreat: 2,
    phases: [],
    hazards: NO_HAZARDS,
  },
}

export function getBoss(id: string): BossDef {
  const def = BOSSES[id]
  if (!def) throw new Error(`unknown boss "${id}"`)
  return def
}
