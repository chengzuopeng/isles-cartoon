import { DEFAULT_DIFFICULTY, DIFFICULTIES, type Difficulty, type DifficultyId } from '../data/difficulty'
import { getBoss } from '../data/bosses'
import type { ClueId } from '../data/clues'
import { ELITE, type AffixId } from '../data/elites'
import type { IdleMode } from '../data/enemies'
import type { Tuning } from '../data/tuning'
import { createAlarmStates } from './alarms'
import { resolveBarkEnemies } from './barks'
import { createBladeStates } from './blades'
import { createClueDrops } from './clues'
import { Tile, floorAt, setTile, type Grid } from './grid'
import { createLandmarkStates } from './landmark-state'
import type { BuiltLevel } from './level'
import type { Vec2 } from './math'
import { createFlowField, type FlowField } from './pathing'
import { createRng, type Rng } from './rng'
import { createSheep } from './sheep'
import { createLoadout, createStats, magazineFor, maxHpFor, type Loadout, type PlayerStats } from './stats'
import { createStatus } from './status'
import type {
  AlarmState,
  Attack,
  BladeState,
  Blast,
  Bullet,
  Chest,
  ClueDrop,
  Enemy,
  GameEvent,
  LandmarkState,
  Lob,
  Mine,
  MinionKind,
  Pickup,
  Player,
  Ring,
  Sheep,
  SpawnMarker,
  Supply,
} from './types'

export type WorldStatus = 'playing' | 'dead' | 'complete'

export type DebugFlags = {
  invincible: boolean
  noWaves?: boolean
  quietAlarms?: boolean
}

export interface AreaRuntime {
  status: 'open' | 'locked' | 'sealed' | 'cleared'
  visited: boolean
}

export interface DamageTally {
  attack: Attack
  damage: number
  hits: number
}

export interface RunStats {
  time: number
  kills: number
  hits: number
  damageTaken: number
  bulletsFired: number
  bulletsHit: number
  crits: number
  ultimates: number
  elites: number
  melees: number
  meleeHits: number
  smashes: number
  sneaks: number
  dashes: number
  jumps: number
  foodHealed: number
  packHealed: number
  taken: DamageTally[]
  killedBy: Attack | null
  areaTime: number[]
}

export interface RunRewards {
  kills: number
  boss: number
  chests: number
  targets: number
}

export interface World {
  tick: number
  time: number
  level: BuiltLevel
  grid: Grid
  tuning: Tuning
  rng: Rng
  lootRng: Rng
  player: Player
  playerStats: PlayerStats
  loadout: Loadout
  enemies: Enemy[]
  boss: Enemy | null
  bullets: Bullet[]
  lobs: Lob[]
  blasts: Blast[]
  rings: Ring[]
  spawns: SpawnMarker[]
  pickups: Pickup[]
  chests: Chest[]
  supplies: Supply[]
  crates: Map<number, number>
  rocks: Map<number, number>
  landmarks: LandmarkState[]
  sheep: Sheep[]
  clues: ClueDrop[]
  cluesFound: ClueId[]
  secrets: boolean[]
  alarms: AlarmState[]
  reinforced: boolean[]
  rushed: boolean[]
  lamps: boolean[]
  mines: Mine[]
  blades: BladeState[]
  barks: Map<string, number>
  barkEnemies: Map<string, number>
  sheepRng: Rng
  conveyors: Map<number, Vec2>
  navFields: Map<number, Float32Array>
  dropPity: number
  flow: FlowField
  events: GameEvent[]
  nextId: number
  status: WorldStatus
  areaIndex: number
  areas: AreaRuntime[]
  stats: RunStats
  rewards: RunRewards
  chapter: number
  xpScale: number
  hitstop: number
  wave: number
  waveTimer: number
  volleyAt: number
  difficulty: Difficulty
  debug: DebugFlags
}

export interface EnemyOptions {
  summoned?: boolean
  idle?: IdleMode
  route?: Vec2[]
  affixes?: readonly AffixId[]
}

export interface WorldOptions {
  seed?: number
  debug?: DebugFlags
  loadout?: Loadout
  xpScale?: number
  difficulty?: DifficultyId
}

const LOOT_SEED_SALT = 0x9e3779b9
const SHEEP_SEED_SALT = 0x5bd1e995

export function createWorld(level: BuiltLevel, tuning: Tuning, options: WorldOptions = {}): World {
  const grid: Grid = {
    columns: level.grid.columns,
    rows: level.grid.rows,
    tiles: level.grid.tiles.slice(),
    floor: level.grid.floor.slice(),
    top: level.grid.top.slice(),
  }
  const seed = options.seed ?? 1
  const loadout = options.loadout ?? createLoadout()
  const world: World = {
    tick: 0,
    time: 0,
    level,
    grid,
    tuning,
    rng: createRng(seed),
    lootRng: createRng(seed ^ LOOT_SEED_SALT),
    player: createPlayer(level.playerStart, floorAt(grid, level.playerStart.x, level.playerStart.y), tuning, loadout),
    playerStats: createStats(),
    loadout,
    enemies: [],
    boss: null,
    bullets: [],
    lobs: [],
    blasts: [],
    rings: [],
    spawns: [],
    pickups: [],
    chests: [],
    supplies: [],
    crates: new Map(),
    rocks: new Map(),
    landmarks: createLandmarkStates(level),
    sheep: createSheep(level),
    clues: createClueDrops(level),
    cluesFound: [],
    secrets: level.secrets.map(() => false),
    alarms: createAlarmStates(level),
    reinforced: level.reinforcements.map(() => false),
    rushed: level.rushes.map(() => false),
    lamps: level.lamps.map(() => false),
    mines: [],
    blades: createBladeStates(level),
    barks: new Map(),
    barkEnemies: new Map(),
    sheepRng: createRng(seed ^ SHEEP_SEED_SALT),
    conveyors: new Map(level.conveyors.map((item) => [item.index, { x: item.dx, y: item.dy }])),
    navFields: new Map(),
    dropPity: 0,
    flow: createFlowField(grid),
    events: [],
    nextId: 2,
    status: 'playing',
    areaIndex: level.areaOfRow[Math.floor(level.playerStart.y)],
    areas: level.areas.map((): AreaRuntime => ({ status: 'open', visited: false })),
    stats: createRunStats(),
    rewards: { kills: 0, boss: 0, chests: 0, targets: 0 },
    chapter: level.def.chapter,
    xpScale: options.xpScale ?? 1,
    hitstop: 0,
    wave: 0,
    waveTimer: 1,
    volleyAt: 0,
    difficulty: DIFFICULTIES[options.difficulty ?? DEFAULT_DIFFICULTY],
    debug: options.debug ?? { invincible: false },
  }
  for (const placement of level.enemies) {
    world.enemies.push(
      createEnemy(world, placement.kind, placement, placement.area, {
        idle: placement.idle,
        route: placement.route,
        affixes: placement.affixes,
      }),
    )
  }
  if (level.boss) {
    const boss = createBoss(world, level.boss.id, level.boss, level.boss.area)
    world.enemies.push(boss)
    world.boss = boss
  }
  for (const chest of level.chests) {
    world.chests.push({
      id: world.nextId++,
      tier: chest.tier,
      pos: { x: chest.x, y: chest.y },
      area: chest.area,
      opened: false,
      weapon: chest.weapon,
      perch: chest.perch ? { ...chest.perch } : null,
    })
  }
  for (const supply of level.supplies) {
    world.supplies.push({ id: world.nextId++, pos: { x: supply.x, y: supply.y }, area: supply.area, used: false })
  }
  level.areas.forEach((area, index) => {
    if (area.kind !== 'destroy') return
    for (const gate of area.gates) setTile(grid, gate, Tile.GateClosed)
    world.areas[index].status = 'sealed'
  })
  world.barkEnemies = resolveBarkEnemies(world)
  return world
}

export function createRunStats(): RunStats {
  return {
    time: 0,
    kills: 0,
    hits: 0,
    damageTaken: 0,
    bulletsFired: 0,
    bulletsHit: 0,
    crits: 0,
    ultimates: 0,
    elites: 0,
    melees: 0,
    meleeHits: 0,
    smashes: 0,
    sneaks: 0,
    dashes: 0,
    jumps: 0,
    foodHealed: 0,
    packHealed: 0,
    taken: [],
    killedBy: null,
    areaTime: [],
  }
}

function createPlayer(spawn: Vec2, z: number, tuning: Tuning, loadout: Loadout): Player {
  const maxHp = maxHpFor(tuning, loadout)
  const magazine = magazineFor(tuning, loadout)
  return {
    id: 1,
    pos: { x: spawn.x, y: spawn.y },
    prev: { x: spawn.x, y: spawn.y },
    z,
    prevZ: z,
    knock: { x: 0, y: 0 },
    radius: tuning.player.radius,
    hp: maxHp,
    maxHp,
    facing: -Math.PI / 2,
    pitch: 0,
    vz: 0,
    grounded: true,
    dashCooldown: 0,
    meleeCooldown: 0,
    primary: 'blaster',
    magazine,
    ammo: magazine,
    reload: 0,
    special: null,
    specialAmmo: 0,
    slot: 'primary',
    cooldown: 0,
    burstLeft: 0,
    burstTimer: 0,
    burstAngle: 0,
    burstWeapon: 'blaster',
    sinceDamage: 0,
    sinceAttack: 0,
    buffs: [],
    shield: 0,
    regenerating: false,
    aim: { x: spawn.x, y: spawn.y - 1 },
    skills: loadout.skills.map((skill) => ({ slot: skill.slot, id: skill.id, rank: skill.rank, cooldown: 0 })),
    rollTime: 0,
    stagger: 0,
    rollDirX: 0,
    rollDirY: 0,
    rollSpeed: 0,
    invulnerable: 0,
    empowered: 0,
    burstEmpower: 0,
    barrier: 0,
    barrierTime: 0,
    barrierBurst: 0,
    ultimate: 0,
    ultShots: 0,
    ultTimer: 0,
    streak: 0,
    streakAt: -1e9,
    status: createStatus(),
    alive: true,
  }
}

export function createEnemy(world: World, kind: MinionKind, pos: Vec2, area: number, options: EnemyOptions = {}): Enemy {
  const config = world.tuning[kind]
  const affixes = options.affixes ?? []
  const elite = affixes.length > 0
  const tough = affixes.includes('tough')
  const hpScale = elite ? ELITE.hpScale * (tough ? ELITE.toughHp : 1) : 1
  const sizeScale = elite ? ELITE.sizeScale * (tough ? ELITE.toughSize : 1) : 1
  const swift = affixes.includes('swift')
  const maxHp = Math.round(config.maxHp * hpScale)
  const route = options.route ?? []
  const shieldMax = affixes.includes('shielded') ? Math.round(maxHp * ELITE.shieldShare) : 0
  const id = world.nextId++
  const z = floorAt(world.grid, pos.x, pos.y)
  return {
    id,
    kind,
    pos: { x: pos.x, y: pos.y },
    prev: { x: pos.x, y: pos.y },
    z,
    prevZ: z,
    knock: { x: 0, y: 0 },
    radius: config.radius * sizeScale,
    hp: maxHp,
    maxHp,
    facing: Math.PI / 2,
    state: 'idle',
    stateTime: 0,
    home: { x: pos.x, y: pos.y },
    area,
    aggro: false,
    alert: 'idle',
    alertTime: 0,
    notice: 0,
    lookTime: 0,
    lastSeen: { x: pos.x, y: pos.y },
    sinceSeen: 0,
    idleMode: route.length > 1 ? 'patrol' : (options.idle === 'patrol' ? 'guard' : (options.idle ?? 'guard')),
    baseFacing: Math.PI / 2,
    route: route.map((point) => ({ x: point.x, y: point.y })),
    routeIndex: 0,
    wanderTarget: null,
    wanderWait: 0,
    leashed: false,
    speedScale: swift ? ELITE.swiftSpeed : 1,
    cooldownScale: swift ? ELITE.swiftCooldown : 1,
    cooldown: 0,
    aimAngle: 0,
    aimPitch: null,
    rushCooldown: (0.8 + (id % 5) * 0.2) * world.difficulty.rushRate,
    dashFrom: { x: pos.x, y: pos.y },
    dashHit: false,
    cover: null,
    flank: ((id % 3) - 1) * ((world.tuning.grunt.flankDeg * Math.PI) / 180),
    engaged: false,
    summoned: options.summoned ?? false,
    airborne: false,
    vz: 0,
    fallFrom: z,
    status: createStatus(),
    elite: elite ? { affixes: [...affixes], shield: shieldMax, shieldMax, sinceHit: 0 } : null,
    boss: null,
  }
}

export function createBoss(world: World, id: string, pos: Vec2, area: number): Enemy {
  const def = getBoss(id)
  const maxHp = world.level.def.bossTuning?.maxHp ?? def.maxHp
  const z = floorAt(world.grid, pos.x, pos.y)
  return {
    id: world.nextId++,
    kind: 'boss',
    pos: { x: pos.x, y: pos.y },
    prev: { x: pos.x, y: pos.y },
    z,
    prevZ: z,
    knock: { x: 0, y: 0 },
    radius: def.radius,
    hp: maxHp,
    maxHp,
    facing: Math.PI / 2,
    state: 'idle',
    stateTime: 0,
    home: { x: pos.x, y: pos.y },
    area,
    aggro: false,
    alert: 'idle',
    alertTime: 0,
    notice: 0,
    lookTime: 0,
    lastSeen: { x: pos.x, y: pos.y },
    sinceSeen: 0,
    idleMode: 'guard',
    baseFacing: Math.PI / 2,
    route: [],
    routeIndex: 0,
    wanderTarget: null,
    wanderWait: 0,
    leashed: false,
    speedScale: 1,
    cooldownScale: 1,
    cooldown: 0,
    aimAngle: 0,
    aimPitch: null,
    rushCooldown: 0,
    dashFrom: { x: pos.x, y: pos.y },
    dashHit: false,
    cover: null,
    flank: 0,
    engaged: false,
    summoned: false,
    airborne: false,
    vz: 0,
    fallFrom: z,
    status: createStatus(),
    elite: null,
    boss: {
      id,
      phase: 'dormant',
      move: null,
      order: [...def.moves],
      moveIndex: 0,
      timer: 0,
      volleysLeft: 0,
      chargeX: 0,
      chargeY: 1,
      chargeTraveled: 0,
      chargeHit: false,
      summoned: false,
      phaseIndex: 0,
      hazards: [],
      bladeTimer: 0,
      frenzyLeft: 0,
      balesLeft: 0,
      shotsLeft: 0,
      bombs: def.rack?.size ?? 0,
      rackTimer: 0,
      shield: def.guard ? { held: true, x: pos.x, y: pos.y, facing: Math.PI / 2, lift: 0 } : null,
      ...(def.tread ? { tank: { turret: Math.PI / 2, hatch: false, minesLeft: 0, barrels: 0, reverse: false, lap: 1, retreat: 0 } } : {}),
    },
  }
}
