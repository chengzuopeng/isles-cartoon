import { describe, expect, it } from 'vitest'
import { getBoss, type BossMoveId } from '../data/bosses'
import { LEVEL_1_3 } from '../data/levels/level-1-3'
import { createDefaultTuning } from '../data/tuning'
import { attackLabel } from '../ui/attack-names'
import { backScale, bossBlocks } from './boss'
import { killEnemy, spawnBlast } from './combat'
import { buildLevel } from './level'
import { spawnBullet } from './projectiles'
import { stepWorld } from './step'
import { levelFromAreas } from './testing'
import type { Enemy, GameEvent, PlayerCommand } from './types'
import { createWorld, type World } from './world'

const DT = 1 / 60
const DEF = getBoss('shield-captain')
const GUARD = DEF.guard!
const BASH = DEF.bash!
const WEAPONS = createDefaultTuning().weapons
const DEGREES = Math.PI / 180

const YARD = levelFromAreas(
  [
    { name: 'gate', theme: 'farm', rows: ['#...............#', '#.......P.......#', '#################'] },
    {
      name: 'yard',
      theme: 'arena',
      kind: 'boss',
      rows: [
        '#######DDD#######',
        '#...............#',
        '#.S.....B.....S.#',
        '#...............#',
        '#...............#',
        '#...............#',
        '#...............#',
        '#...............#',
        '#...............#',
        '#...............#',
        '#...............#',
        '#...............#',
        '#...............#',
        '#...............#',
        '#######DDD#######',
      ],
      landmarks: [{ id: 'ch1-silo', at: [7, 9] }],
    },
    { name: 'exit', theme: 'meadow', rows: ['#################', '#.......XXX.....#', '#...............#'] },
  ],
  { bossId: 'shield-captain' },
)

const TOP = YARD.areas[1].top
const SILO = YARD.landmarks.findIndex((landmark) => landmark.id === 'ch1-silo')

describe('the four silos in the playable farm', () => {
  const level = buildLevel(LEVEL_1_3)
  const silos = level.landmarks.filter((placement) => placement.id === 'ch1-silo')
  it.each(silos)('predicts charge contact and spends both stuns at $column,$row', (silo) => {
    const world = createWorld(level, createDefaultTuning(), { debug: { invincible: true } })
    const index = level.landmarks.indexOf(silo)
    const x = silo.column + silo.width / 2
    const front = silo.row + silo.depth
    place(world, x, front + 1.7)
    run(world, DT)
    for (const remaining of [2, 1, 0]) {
      place(world, x, front + 1.7)
      const boss = put(world, x, front + 6.5, -Math.PI / 2)
      force(world, 'charge')
      untilPhase(world, 'telegraph')
      const start = boss.pos.y
      const warning = boss.boss!.shield!.chargeImpact
      expect(warning?.target).toBe(remaining ? index : -1)
      const events = untilPhase(world, remaining ? 'stunned' : 'recover')
      expect(events.some((event) => event.type === 'bossCrash')).toBe(true)
      expect(events).toContainEqual(expect.objectContaining({ type: 'landmarkCrashed', index, left: Math.max(0, remaining - 1) }))
      expect(warning!.reach).toBeCloseTo(start - boss.pos.y + boss.radius, 1)
      if (remaining) {
        expect(boss.boss!.shield!.held).toBe(false)
        untilPhase(world, 'walk')
      } else {
        expect(events.some((event) => event.type === 'bossStunned')).toBe(false)
        expect(world.landmarks[index].crashes).toBe(3)
      }
      expect(boss.boss!.shield!.held).toBe(true)
    }
  })
})

function idle(): PlayerCommand {
  return { moveX: 0, moveY: 0, aimX: 8.5, aimY: 0, fire: false, slot: null, interact: false, skill: null, ultimate: false, pitch: 0, jump: false, dash: false, melee: false }
}

function place(world: World, x: number, y: number): void {
  world.player.pos = { x, y }
  world.player.prev = { x, y }
}

function run(world: World, seconds: number): GameEvent[] {
  const seen: GameEvent[] = []
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    world.events.length = 0
    stepWorld(world, idle(), DT)
    seen.push(...world.events)
  }
  return seen
}

function captain(world: World): Enemy {
  if (!world.boss?.boss) throw new Error('no boss')
  return world.boss
}

function setup(): World {
  const world = createWorld(YARD, createDefaultTuning(), { debug: { invincible: true } })
  place(world, 8.5, TOP + 7.5)
  stepWorld(world, idle(), DT)
  const boss = captain(world)
  boss.boss!.phase = 'walk'
  boss.boss!.timer = 99
  return world
}

function force(world: World, move: BossMoveId): void {
  const state = captain(world).boss!
  state.order = [move]
  state.moveIndex = 0
  state.phase = 'walk'
  state.timer = 0
}

function put(world: World, x: number, y: number, facing: number): Enemy {
  const boss = captain(world)
  boss.pos = { x, y }
  boss.prev = { x, y }
  boss.facing = facing
  return boss
}

function untilPhase(world: World, phase: string, limit = 5): GameEvent[] {
  const seen: GameEvent[] = []
  for (let i = 0; i < limit / DT && captain(world).boss!.phase !== phase; i++) seen.push(...run(world, DT))
  return seen
}

describe('the shield captain', () => {
  it('blocks bullets with the barn-door shield up front, takes 1.5x from behind and normal damage from the side', () => {
    const world = setup()
    const boss = put(world, 8.5, TOP + 4.5, Math.PI / 2)
    expect(bossBlocks(boss, 0, -1)).toBe(true)
    expect(bossBlocks(boss, Math.cos(-Math.PI / 2 + 55 * DEGREES), Math.sin(-Math.PI / 2 + 55 * DEGREES))).toBe(true)
    expect(bossBlocks(boss, 1, 0)).toBe(false)
    expect(bossBlocks(boss, 0, 1)).toBe(false)
    expect(backScale(boss, 0, 1)).toBe(GUARD.backScale)
    expect(backScale(boss, 1, 0)).toBe(1)
    expect(backScale(boss, 0, -1)).toBe(1)

    const full = boss.hp
    spawnBullet(world, 'player', 8.5, TOP + 7, 0, -Math.PI / 2, 'blaster')
    const front = run(world, 0.3)
    expect(boss.hp).toBe(full)
    expect(front.filter((event) => event.type === 'shieldBlocked').map((event) => event.type === 'shieldBlocked' && event.id)).toEqual([boss.id])

    boss.facing = Math.PI / 2
    spawnBullet(world, 'player', boss.pos.x, boss.pos.y - 2.5, 0, Math.PI / 2, 'blaster')
    const back = run(world, 0.25)
    expect(full - boss.hp).toBeCloseTo(WEAPONS.blaster.damage * GUARD.backScale, 5)
    expect(back.some((event) => event.type === 'bossBackHit' && event.id === boss.id)).toBe(true)
  })

  it('takes explosions in full from any side', () => {
    const world = setup()
    const boss = put(world, 8.5, TOP + 4.5, Math.PI / 2)
    const full = boss.hp
    spawnBlast(world, { x: boss.pos.x, y: boss.pos.y + 1.5, radius: 2, delay: 0, playerDamage: 0, enemyDamage: 230, source: 'player', ownerId: 0 })
    run(world, DT)
    expect(full - boss.hp).toBe(230)
  })

  it('turns slowly: about 120 degrees a second while walking and 45 while recovering', () => {
    const world = setup()
    place(world, 14.5, TOP + 4.5)
    const boss = put(world, 8.5, TOP + 4.5, Math.PI)
    run(world, 0.5)
    const walked = Math.abs(Math.PI - Math.abs(boss.facing))
    expect(walked).toBeGreaterThan(55 * DEGREES)
    expect(walked).toBeLessThanOrEqual(GUARD.turnDeg * 0.5 * DEGREES + 1e-6)
    boss.facing = Math.PI
    boss.boss!.phase = 'recover'
    boss.boss!.timer = 2
    run(world, 0.5)
    const recovered = Math.abs(Math.PI - Math.abs(boss.facing))
    expect(recovered).toBeGreaterThan(20 * DEGREES)
    expect(recovered).toBeLessThanOrEqual(GUARD.recoverTurnDeg * 0.5 * DEGREES + 1e-6)
  })

  it('bashes a 100-degree fan of radius 2.5 in front of it after 0.7 s, then stands for 0.8 s', () => {
    const world = setup()
    place(world, 8.5, TOP + 6.5)
    const boss = put(world, 8.5, TOP + 4.5, Math.PI / 2)
    force(world, 'bash')
    const started = run(world, DT)
    expect(started).toContainEqual({ type: 'bossMove', move: 'bash' })
    const blast = world.blasts.find((item) => item.ownerId === boss.id)!
    const bash = WEAPONS[BASH.weapon]
    expect(blast).toMatchObject({ radius: bash.radius, total: bash.windup, playerDamage: bash.damage, source: 'boss' })
    expect(bash).toMatchObject({ radius: 2.5, windup: 0.7, arcDeg: 100 })
    expect(blast.arcWidth).toBeCloseTo(100 * DEGREES, 6)
    expect(blast.arcCenter).toBeCloseTo(boss.facing, 6)
    const hit = untilPhase(world, 'recover', bash.windup + 0.5)
    expect(hit.some((event) => event.type === 'playerHit')).toBe(true)
    expect(boss.boss!.phase).toBe('recover')
    expect(boss.boss!.timer).toBeGreaterThan(BASH.recover - 0.05)
  })

  it('walks up to the player before a bash instead of swinging from afar', () => {
    const world = setup()
    place(world, 8.5, TOP + 8)
    const boss = put(world, 8.5, TOP + 2.5, Math.PI / 2)
    force(world, 'bash')
    run(world, 0.5)
    expect(boss.boss!.phase).toBe('walk')
    untilPhase(world, 'telegraph', BASH.chase + 1)
    expect(boss.boss!.move).toBe('bash')
    expect(Math.hypot(world.player.pos.x - boss.pos.x, world.player.pos.y - boss.pos.y)).toBeLessThanOrEqual(BASH.reach + 0.1)
  })

  it('charges into a silo, drops the shield on the ground and stays stunned for 2.5 s', () => {
    const world = setup()
    place(world, 8.5, TOP + 12.5)
    const boss = put(world, 8.5, TOP + 3.5, Math.PI / 2)
    force(world, 'charge')
    untilPhase(world, 'telegraph')
    expect(boss.boss!.shield!.chargeImpact?.target).toBe(SILO)
    const events = untilPhase(world, 'stunned', 4)
    expect(events.filter((event) => event.type === 'landmarkCrashed')).toEqual([
      { type: 'landmarkCrashed', index: SILO, id: 'ch1-silo', x: 8.5, y: TOP + 10.5, crashes: 1, left: GUARD.crashStuns - 1 },
    ])
    expect(events.some((event) => event.type === 'bossStunned')).toBe(true)
    expect(boss.boss!.timer).toBeCloseTo(DEF.stunSeconds, 1)
    const shield = boss.boss!.shield!
    expect(shield.held).toBe(false)
    expect(Math.hypot(shield.x - boss.pos.x, shield.y - boss.pos.y)).toBeGreaterThan(0.5)
    expect(shield.facing).toBeCloseTo(boss.facing, 6)
    expect(events.filter((event) => event.type === 'bossShield')).toEqual([{ type: 'bossShield', held: false, x: shield.x, y: shield.y, facing: shield.facing }])
    expect(world.landmarks[SILO].crashes).toBe(1)
    const full = boss.hp
    spawnBullet(world, 'player', boss.pos.x, boss.pos.y - 3, 0, Math.PI / 2, 'blaster')
    run(world, 0.4)
    expect(full - boss.hp).toBeCloseTo(WEAPONS.blaster.damage * GUARD.backScale * DEF.stunDamageScale, 5)
    expect(bossBlocks(boss, -Math.cos(boss.facing), -Math.sin(boss.facing))).toBe(false)
  })

  it('picks the shield back up for 0.6 s after the stun, still open to hits until it is back in hand', () => {
    const world = setup()
    place(world, 8.5, TOP + 12.5)
    const boss = put(world, 8.5, TOP + 3.5, Math.PI / 2)
    force(world, 'charge')
    untilPhase(world, 'stunned', 4)
    untilPhase(world, 'recover', DEF.stunSeconds + 0.2)
    const shield = boss.boss!.shield!
    expect(shield.held).toBe(false)
    expect(shield.lift).toBeGreaterThan(GUARD.pickup - 0.05)
    expect(bossBlocks(boss, -Math.cos(boss.facing), -Math.sin(boss.facing))).toBe(false)
    const events = untilPhase(world, 'walk', GUARD.pickup + 0.2)
    expect(shield.held).toBe(true)
    expect(shield.lift).toBe(0)
    expect(events.filter((event) => event.type === 'bossShield').map((event) => event.type === 'bossShield' && event.held)).toEqual([true])
  })

  it('only gets stunned twice by the same silo; the third crash just staggers it like a wall', () => {
    const world = setup()
    world.landmarks[SILO].crashes = GUARD.crashStuns
    place(world, 8.5, TOP + 12.5)
    const boss = put(world, 8.5, TOP + 3.5, Math.PI / 2)
    force(world, 'charge')
    untilPhase(world, 'telegraph')
    expect(boss.boss!.shield!.chargeImpact?.target).toBe(-1)
    const events = untilPhase(world, 'recover', 4)
    expect(events.filter((event) => event.type === 'landmarkCrashed')).toEqual([
      expect.objectContaining({ crashes: GUARD.crashStuns + 1, left: 0 }),
    ])
    expect(events.some((event) => event.type === 'bossStunned')).toBe(false)
    expect(boss.boss!.shield!.held).toBe(true)
    expect(boss.boss!.timer).toBeCloseTo(DEF.charge.recover, 1)
  })

  it('only staggers for 1.2 s when it charges into a wall or into nothing', () => {
    const world = setup()
    place(world, 1.6, TOP + 4.5)
    const boss = put(world, 5.5, TOP + 4.5, Math.PI)
    force(world, 'charge')
    const events = untilPhase(world, 'recover', 4)
    expect(events.some((event) => event.type === 'bossCrash')).toBe(true)
    expect(events.some((event) => event.type === 'bossStunned' || event.type === 'landmarkCrashed')).toBe(false)
    expect(boss.boss!.shield!.held).toBe(true)
    expect(boss.boss!.timer).toBeCloseTo(DEF.charge.recover, 1)
  })

  it('takes turns between the shield charge and the bash, and names its charge on the death screen', () => {
    const world = setup()
    const boss = captain(world)
    boss.boss!.timer = 0
    const moves: BossMoveId[] = []
    for (let i = 0; i < 30 / DT && moves.length < 4; i++) {
      for (const event of run(world, DT)) if (event.type === 'bossMove') moves.push(event.move)
    }
    expect(moves).toEqual(['charge', 'bash', 'charge', 'bash'])
    expect(DEF.charge.cause).toBe('captainRush')
    expect(attackLabel({ by: 'boss', cause: 'captainRush', elite: false, boss: 'shield-captain' }, WEAPONS)).toBe('铁盾队长的举盾冲锋')
    expect(attackLabel({ by: 'boss', cause: 'captainBash', elite: false, boss: 'shield-captain' }, WEAPONS)).toBe('铁盾队长的盾击')
  })

  it('calls two shield bearers at half health and leaves a health pack', () => {
    const world = setup()
    const boss = captain(world)
    boss.hp = boss.maxHp * DEF.summonAt - 1
    run(world, DT)
    expect(world.spawns.map((marker) => marker.kind)).toEqual(['shield', 'shield'])
    expect(world.pickups.filter((pickup) => pickup.item.type === 'heal')).toHaveLength(1)
    run(world, DEF.summonWarning + 0.1)
    expect(world.enemies.filter((enemy) => enemy.summoned).map((enemy) => enemy.kind)).toEqual(['shield', 'shield'])
  })

  it('opens the yard when beaten and tells the picture how long to salute before it falls', () => {
    const world = setup()
    expect(world.areas[1].status).toBe('locked')
    killEnemy(world, captain(world), true)
    run(world, DT)
    expect(world.areas[1].status).toBe('cleared')
    expect(DEF).toMatchObject({ name: '铁盾队长', tier: 'mini', radius: 1, show: { lay: 2, fall: 1 } })
  })
})
