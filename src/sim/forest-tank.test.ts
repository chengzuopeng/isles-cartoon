import { describe, expect, it } from 'vitest'
import { getBoss, type BossMoveId } from '../data/bosses'
import type { GridPoint } from '../data/levels/types'
import { createDefaultTuning } from '../data/tuning'
import { attackLabel } from '../ui/attack-names'
import { attackOf } from './attacks'
import { tripleLanes } from './boss'
import { damageEnemy, killEnemy } from './combat'
import { Tile, tileAt } from './grid'
import { spawnLob } from './lobs'
import { layMine } from './mines'
import { spawnBullet } from './projectiles'
import { stepWorld } from './step'
import { levelFromAreas } from './testing'
import type { Enemy, GameEvent, PlayerCommand, TankState } from './types'
import { createWorld, type World } from './world'

const DT = 1 / 60
const DEF = getBoss('forest-tank')
const TRIPLE = DEF.triple!
const MINES = DEF.mines!
const RAM = DEF.ram!
const WEAPONS = createDefaultTuning().weapons
const SIZE = 21
const CENTER = 11.5
const RADIUS = 6

function arenaRows(): string[] {
  const rows = ['#'.repeat(9) + 'DDDDD' + '#'.repeat(9)]
  for (let row = 0; row < SIZE; row++) {
    let line = '#'
    for (let column = 1; column <= SIZE; column++) {
      const distance = Math.hypot(column + 0.5 - CENTER, row + 1 + 0.5 - CENTER)
      line += Math.abs(distance - RADIUS) <= 1.05 ? ',' : '.'
    }
    rows.push(`${line}#`)
  }
  rows.push('#'.repeat(9) + 'DDDDD' + '#'.repeat(9))
  const mark = (column: number, row: number, symbol: string) => {
    rows[row] = rows[row].slice(0, column) + symbol + rows[row].slice(column + 1)
  }
  mark(11, 11 - RADIUS, 'B')
  for (const [column, row] of [
    [2, 2],
    [20, 2],
    [2, 20],
    [20, 20],
  ])
    mark(column, row, 'S')
  return rows
}

function arena(stumps: GridPoint[] = []) {
  const wide = (line: string) => line.padEnd(SIZE + 2, '.').slice(0, SIZE + 1) + '#'
  return levelFromAreas(
    [
      { name: 'gate', theme: 'forest', rows: [wide('#'), wide('#..........P'), '#'.repeat(SIZE + 2)] },
      { name: 'clearing', theme: 'arena', kind: 'boss', rows: arenaRows(), landmarks: stumps.map((at) => ({ id: 'ch1-stump' as const, at })) },
      { name: 'exit', theme: 'forest', rows: ['#'.repeat(SIZE + 2), wide('#.........XXX'), wide('#')] },
    ],
    { bossId: 'forest-tank' },
  )
}

const LEVEL = arena([[11, 9]])
const TOP = LEVEL.areas[1].top

function idle(world: World): PlayerCommand {
  return { moveX: 0, moveY: 0, aimX: world.player.pos.x, aimY: world.player.pos.y - 1, fire: false, slot: null, interact: false, skill: null, ultimate: false, pitch: 0, jump: false, dash: false, melee: false }
}

function place(world: World, x: number, y: number): void {
  world.player.pos = { x, y }
  world.player.prev = { x, y }
}

function run(world: World, seconds: number, hold?: { x: number; y: number }): GameEvent[] {
  const seen: GameEvent[] = []
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    world.events.length = 0
    if (hold) place(world, hold.x, hold.y)
    stepWorld(world, idle(world), DT)
    seen.push(...world.events)
  }
  return seen
}

function tank(world: World): Enemy {
  if (!world.boss?.boss) throw new Error('no boss')
  return world.boss
}

function tracks(world: World): TankState {
  const state = tank(world).boss?.tank
  if (!state) throw new Error('no tank state')
  return state
}

function awake(level = LEVEL): World {
  const world = createWorld(level, createDefaultTuning(), { debug: { invincible: true } })
  place(world, CENTER, TOP + 15.5)
  run(world, DT)
  expect(tank(world).boss?.phase).toBe('intro')
  return world
}

function start(world: World, move: BossMoveId, at?: { x: number; y: number }): void {
  const state = tank(world).boss!
  if (at) {
    tank(world).pos = { ...at }
    tank(world).prev = { ...at }
  }
  state.order = [move]
  state.moveIndex = 0
  state.phase = 'walk'
  state.timer = 0
}

describe('forest tank data', () => {
  it('follows the 1-4 design', () => {
    expect(DEF).toMatchObject({ name: '林地炮车', tier: 'mini', radius: 1.1, order: 'cycle', stunSeconds: 2.5, stunDamageScale: 1.5, retreat: 2 })
    expect(DEF.moves).toEqual(['triple', 'mines', 'charge'])
    expect(DEF.summon).toEqual([{ kind: 'bomber', count: 2 }])
    expect(TRIPLE).toMatchObject({ barrels: 3, telegraph: 0.8, recover: 0.8 })
    expect(MINES).toMatchObject({ count: 4, flight: 1, trigger: 0.6, max: 8 })
    expect(MINES.overflow).toBeGreaterThanOrEqual(0.8)
    expect(WEAPONS[MINES.weapon].explodeRadius).toBe(1.2)
    expect(DEF.charge).toMatchObject({ telegraph: 0.9, recover: 1.2, cause: 'tankRam' })
    expect(RAM).toEqual({ into: 'ch1-stump', stuns: 2 })
    expect(attackLabel(attackOf(tank(createWorld(LEVEL, createDefaultTuning())), 'tankRam'), WEAPONS)).toBe('林地炮车的倒车冲撞')
  })

  it('reads the ring road off the map', () => {
    expect(LEVEL.ring?.area).toBe(1)
    expect(LEVEL.ring?.x).toBeCloseTo(CENTER, 5)
    expect(LEVEL.ring?.y).toBeCloseTo(TOP + CENTER, 5)
    expect(LEVEL.ring?.radius).toBeGreaterThan(RADIUS - 0.4)
    expect(LEVEL.ring?.radius).toBeLessThan(RADIUS + 0.4)
  })
})

describe('forest tank', () => {
  it('drives along the ring road while its turret turns toward the player on its own', () => {
    const world = awake()
    const state = tank(world).boss!
    run(world, DEF.introTime + DT)
    expect(state.phase).toBe('walk')
    const ring = world.level.ring!
    let heading = 0
    for (let i = 0; i < 60; i++) {
      state.timer = 10
      run(world, 0.05, { x: CENTER, y: TOP + 15.5 })
      const boss = tank(world)
      const offset = Math.hypot(boss.pos.x - ring.x, boss.pos.y - ring.y) - ring.radius
      expect(Math.abs(offset)).toBeLessThan(0.35)
      const around = Math.atan2(boss.pos.y - ring.y, boss.pos.x - ring.x)
      heading = Math.cos(boss.facing - (around + Math.PI / 2))
      const toPlayer = Math.atan2(world.player.pos.y - boss.pos.y, world.player.pos.x - boss.pos.x)
      if (i > 20) expect(Math.cos(tracks(world).turret - toPlayer)).toBeGreaterThan(0.98)
    }
    expect(heading).toBeGreaterThan(0.8)
    expect(tracks(world).reverse).toBe(false)
  })

  it('fires the triple cannon down three red lines after 0.8 seconds, barrel by barrel, then stops for 0.8 seconds', () => {
    const world = awake()
    run(world, DEF.introTime + DT)
    start(world, 'triple', { x: CENTER, y: TOP + CENTER - RADIUS })
    const hold = { x: CENTER + 0.5, y: TOP + 16 }
    run(world, DT, hold)
    const boss = tank(world)
    expect(boss.boss?.phase).toBe('telegraph')
    expect(boss.boss?.move).toBe('triple')
    const lanes = tripleLanes(boss, DEF)
    expect(lanes).toHaveLength(3)
    expect(lanes[2] - lanes[1]).toBeCloseTo((TRIPLE.spreadDeg * Math.PI) / 180, 6)
    expect(lanes[1]).toBeCloseTo(boss.aimAngle, 6)
    const early = run(world, TRIPLE.telegraph - 0.1, hold)
    expect(early.some((event) => event.type === 'tankShot')).toBe(false)
    const shots = run(world, 0.4, hold).filter((event): event is Extract<GameEvent, { type: 'tankShot' }> => event.type === 'tankShot')
    expect(shots.map((event) => event.barrel)).toEqual([0, 1, 2])
    shots.forEach((event, barrel) => expect(event.angle).toBeCloseTo(lanes[barrel], 6))
    expect(world.bullets.filter((bullet) => bullet.weapon === TRIPLE.weapon).length).toBeGreaterThan(0)
    expect(boss.boss?.phase).toBe('recover')
    expect(boss.boss?.timer).toBeGreaterThan(TRIPLE.recover - 0.4)
  })

  it('opens the mine box with its back to the player and scatters four mines that land after a second', () => {
    const world = awake()
    run(world, DEF.introTime + DT)
    start(world, 'mines', { x: CENTER, y: TOP + CENTER - RADIUS })
    const hold = { x: CENTER, y: TOP + 15.5 }
    run(world, DT, hold)
    const boss = tank(world)
    expect(tracks(world).hatch).toBe(true)
    const toPlayer = Math.atan2(hold.y - boss.pos.y, hold.x - boss.pos.x)
    expect(Math.cos(boss.facing - toPlayer)).toBeLessThan(-0.99)
    let tossed = 0
    let waited = 0
    while (tossed < MINES.count && waited < 3) {
      tossed += run(world, DT, hold).filter((event) => event.type === 'enemyShot' && event.weapon === MINES.weapon).length
      waited += DT
    }
    expect(tossed).toBe(MINES.count)
    expect(waited).toBeGreaterThan(MINES.windup + MINES.interval * (MINES.count - 1) - 0.05)
    expect(waited).toBeLessThan(MINES.windup + MINES.interval * MINES.count)
    expect(world.lobs.filter((lob) => lob.lands === 'mine')).toHaveLength(MINES.count)
    expect(tracks(world).hatch).toBe(false)
    for (const lob of world.lobs) expect(Math.hypot(lob.to.x - hold.x, lob.to.y - hold.y)).toBeLessThanOrEqual(MINES.scatter + 0.5)
    place(world, 2.5, TOP + 18.5)
    const landed = run(world, MINES.flight + 0.1)
    expect(landed.filter((event) => event.type === 'mineLaid')).toHaveLength(MINES.count)
    expect(world.mines).toHaveLength(MINES.count)
    expect(world.blasts.filter((blast) => blast.weapon === MINES.weapon)).toHaveLength(0)
  })

  it('reverses into a stump: dazed 2.5 seconds and taking 50% more damage, the stump breaks on the second crash, then it only staggers', () => {
    const world = awake()
    run(world, DEF.introTime + DT)
    const from = { x: CENTER, y: TOP + 6.5 }
    const behind = { x: CENTER, y: TOP + 13.5 }
    const stump = world.level.landmarks.findIndex((placement) => placement.id === 'ch1-stump')
    for (let crash = 1; crash <= 3; crash++) {
      start(world, 'charge', from)
      run(world, DT, behind)
      const boss = tank(world)
      expect(boss.boss?.phase).toBe('telegraph')
      expect(tracks(world).reverse).toBe(true)
      expect(Math.cos(boss.facing - Math.atan2(boss.boss!.chargeY, boss.boss!.chargeX))).toBeLessThan(-0.99)
      const events = run(world, DEF.charge.telegraph + 1, behind)
      const crashed = events.find((event): event is Extract<GameEvent, { type: 'landmarkCrashed' }> => event.type === 'landmarkCrashed')
      expect(crashed).toMatchObject({ index: stump, id: 'ch1-stump', crashes: crash, left: Math.max(0, RAM.stuns - crash) })
      const dazed = events.some((event) => event.type === 'bossStunned')
      expect(dazed).toBe(crash <= RAM.stuns)
      expect(events.some((event) => event.type === 'landmarkBroken')).toBe(crash === RAM.stuns)
      if (crash <= RAM.stuns) {
        expect(boss.boss?.phase).toBe('stunned')
        const before = boss.hp
        damageEnemy(world, boss, 100, 0, 0, 0)
        expect(before - boss.hp).toBeCloseTo(150, 6)
      } else {
        expect(boss.boss?.phase).toBe('recover')
        expect(boss.boss?.timer).toBeGreaterThan(DEF.charge.recover - 1)
      }
    }
    expect(world.landmarks[stump]).toMatchObject({ broken: true, crashes: 3 })
    const cell = world.level.landmarks[stump].cells[0]
    expect(world.grid.tiles[cell]).toBe(Tile.LandmarkLow)
  })

  it('staggers for 1.2 seconds after ramming a wall or running out of road, without being dazed', () => {
    const world = awake(arena())
    run(world, DEF.introTime + DT)
    start(world, 'charge', { x: CENTER, y: TOP + 13.5 })
    const wall = run(world, DEF.charge.telegraph + 1.2, { x: CENTER, y: TOP + 20.5 })
    expect(wall.some((event) => event.type === 'bossCrash')).toBe(true)
    expect(wall.some((event) => event.type === 'bossStunned')).toBe(false)
    expect(tank(world).boss?.phase).toBe('recover')
    expect(tank(world).boss?.timer).toBeGreaterThan(DEF.charge.recover - 0.6)
    start(world, 'charge', { x: CENTER, y: TOP + 3.5 })
    const open = run(world, DEF.charge.telegraph + DEF.charge.distance / DEF.charge.speed + 0.1, { x: CENTER, y: TOP + 19.5 })
    expect(open.some((event) => event.type === 'bossCrash' || event.type === 'bossStunned')).toBe(false)
    expect(tank(world).boss?.phase).toBe('recover')
  })

  it('calls two bombers and leaves a heal pack at half health', () => {
    const world = awake()
    run(world, DEF.introTime + DT)
    const boss = tank(world)
    boss.hp = boss.maxHp * 0.49
    const events = run(world, DT, { x: CENTER, y: TOP + 15.5 })
    expect(events.some((event) => event.type === 'bossSummon')).toBe(true)
    expect(world.spawns.map((marker) => marker.kind)).toEqual(['bomber', 'bomber'])
    expect(world.pickups.filter((pickup) => pickup.item.type === 'heal')).toHaveLength(1)
  })

  it('clears its mines when beaten, backs away for two seconds, then the north gate opens', () => {
    const world = awake()
    run(world, DEF.introTime + DT)
    const lob = spawnLob(world, 'enemy', tank(world).pos, { x: 4.5, y: TOP + 18.5 }, MINES.weapon, 1, attackOf(tank(world), MINES.weapon), 0.1)
    layMine(world, lob)
    expect(world.mines).toHaveLength(1)
    killEnemy(world, tank(world), true)
    expect(world.mines).toHaveLength(0)
    expect(tracks(world)).toMatchObject({ retreat: DEF.retreat, reverse: true, hatch: false })
    const north = world.level.areas[1].gates.filter((gate) => Math.floor(gate / world.grid.columns) === TOP)
    const early = run(world, DEF.retreat - 0.2)
    expect(early.some((event) => event.type === 'areaCleared')).toBe(false)
    expect(world.grid.tiles[north[0]]).toBe(Tile.GateClosed)
    const later = run(world, 0.4)
    expect(later.some((event) => event.type === 'areaCleared')).toBe(true)
    expect(tileAt(world.grid, north[0] % world.grid.columns, TOP)).toBe(Tile.Gate)
  })
})

describe('mines', () => {
  function minefield(): World {
    const world = awake()
    run(world, DEF.introTime + DT)
    tank(world).boss!.phase = 'stunned'
    tank(world).boss!.timer = 99
    return world
  }

  function mine(world: World, x: number, y: number) {
    const lob = spawnLob(world, 'enemy', { x, y }, { x, y }, MINES.weapon, 1, attackOf(tank(world), MINES.weapon), 0.05)
    lob.lands = 'mine'
    return lob
  }

  it('blows up a moment after the player steps within 0.6 cells, hurting the player', () => {
    const world = minefield()
    world.debug.invincible = false
    place(world, 4.5, TOP + 18.5)
    mine(world, 4.5, TOP + 16.5)
    run(world, 0.2)
    expect(world.mines).toHaveLength(1)
    const hp = world.player.hp
    place(world, 4.5, TOP + 16.5 + 0.6 + world.player.radius - 0.05)
    const events = run(world, MINES.fuse + 0.1, { x: 4.5, y: TOP + 16.5 + 0.9 })
    expect(events.find((event) => event.type === 'mineTriggered')).toMatchObject({ fuse: MINES.fuse })
    expect(events.find((event) => event.type === 'mineExploded')).toMatchObject({ cause: 'stepped' })
    expect(world.player.hp).toBe(hp - WEAPONS[MINES.weapon].splash)
    expect(world.mines).toHaveLength(0)
  })

  it('stays put while the player keeps clear', () => {
    const world = minefield()
    place(world, 4.5, TOP + 18.5)
    mine(world, 4.5, TOP + 16.5)
    run(world, 2)
    expect(world.mines).toHaveLength(1)
    expect(world.mines[0].fuse).toBe(-1)
  })

  it('goes off at once when a player bullet hits it', () => {
    const world = minefield()
    place(world, 4.5, TOP + 19.5)
    mine(world, 4.5, TOP + 14.5)
    run(world, 0.2)
    spawnBullet(world, 'player', 4.5, TOP + 18.5, 0, -Math.PI / 2, 'blaster')
    const events = run(world, 0.5)
    expect(events.find((event) => event.type === 'mineExploded')).toMatchObject({ cause: 'shot' })
    expect(world.mines).toHaveLength(0)
  })

  it('sets off the oldest mine when a ninth one lands', () => {
    const world = minefield()
    place(world, 2.5, TOP + 2.5)
    for (let i = 0; i < MINES.max + 1; i++) mine(world, 4.5 + i * 1.5, TOP + 18.5)
    const events = run(world, 0.1)
    expect(events.filter((event) => event.type === 'mineLaid')).toHaveLength(MINES.max + 1)
    const oldest = world.mines[0]
    expect(oldest.fuse).toBeGreaterThan(MINES.fuse)
    expect(oldest.cause).toBe('crowded')
    expect(events.find((event) => event.type === 'mineTriggered')).toMatchObject({ id: oldest.id, fuse: MINES.overflow })
    run(world, MINES.overflow - 0.2)
    expect(world.mines).toHaveLength(MINES.max + 1)
    run(world, 0.3)
    expect(world.mines).toHaveLength(MINES.max)
    expect(world.mines.some((item) => item.id === oldest.id)).toBe(false)
  })
})
