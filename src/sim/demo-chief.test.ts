import { describe, expect, it } from 'vitest'
import { getBoss, type BossMoveId } from '../data/bosses'
import { createDefaultTuning } from '../data/tuning'
import { killEnemy } from './combat'
import { stepWorld } from './step'
import { levelFromAreas } from './testing'
import type { Enemy, PlayerCommand } from './types'
import { createWorld, type World } from './world'

const DT = 1 / 60
const DEF = getBoss('demo-chief')
const BALES = DEF.bales!
const CANNON = DEF.cannon!
const RACK = DEF.rack!

const BARN = levelFromAreas(
  [
    { name: 'yard', theme: 'forest', rows: ['#.................#', '#........P........#', '###################'] },
    {
      name: 'barn',
      theme: 'arena',
      kind: 'boss',
      rows: [
        '#######DDD#########',
        '#.................#',
        '#S......B.......S.#',
        '#.................#',
        '#.................#',
        '#.................#',
        '#.................#',
        '#.................#',
        '#.................#',
        '#.................#',
        '#######DDD#########',
      ],
      landmarks: [{ id: 'ch1-hay-pillar', at: [3, 7] }],
    },
    { name: 'exit', theme: 'meadow', rows: ['###################', '#.......XXX.......#', '#.................#'] },
  ],
  { bossId: 'demo-chief' },
)

function idle(moveX = 0): PlayerCommand {
  return { moveX, moveY: 0, aimX: 9.5, aimY: 0, fire: false, slot: null, interact: false, skill: null, ultimate: false, pitch: 0, jump: false, dash: false, melee: false }
}

function setup(): World {
  const world = createWorld(BARN, createDefaultTuning(), { debug: { invincible: true } })
  place(world, 9.5, 10.5)
  stepWorld(world, idle(), DT)
  return world
}

function place(world: World, x: number, y: number): void {
  world.player.pos = { x, y }
  world.player.prev = { x, y }
}

function bossOf(world: World): Enemy {
  if (!world.boss?.boss) throw new Error('no boss')
  return world.boss
}

function force(world: World, move: BossMoveId): void {
  const state = bossOf(world).boss!
  state.order = [move]
  state.moveIndex = 0
  state.phase = 'walk'
  state.timer = 0
}

function run(world: World, seconds: number, command = idle()): void {
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) stepWorld(world, command, DT)
}

function shots(world: World, weapon: string): number {
  return world.events.filter((event) => event.type === 'enemyShot' && event.weapon === weapon).length
}

describe('demolition chief', () => {
  it('throws three bombs in a row, each warned by a one-second landing circle, then stands still', () => {
    const world = setup()
    force(world, 'bales')
    stepWorld(world, idle(), DT)
    const state = bossOf(world).boss!
    expect(state.phase).toBe('telegraph')
    run(world, BALES.windup + 0.05)
    expect(world.lobs).toHaveLength(1)
    expect(world.lobs[0].total).toBe(BALES.flight)
    expect(world.lobs[0].to).toEqual({ x: 9.5, y: 10.5 })
    run(world, BALES.interval * 2 + 0.05)
    expect(shots(world, 'chiefBomb')).toBe(3)
    expect(state.bombs).toBe(RACK.size - 3)
    run(world, BALES.interval + 0.05)
    expect(state.phase).toBe('recover')
    expect(state.timer).toBeGreaterThan(BALES.recover - 0.1)
    expect(shots(world, 'chiefBomb')).toBe(3)
  })

  it('leads a moving target with its bombs', () => {
    const world = setup()
    place(world, 4.5, 11.5)
    force(world, 'bales')
    run(world, BALES.windup + 0.05, idle(1))
    const lob = world.lobs[0]
    expect(lob.to.x).toBeGreaterThan(world.player.pos.x + 1)
  })

  it('hangs eight bombs on its back, one less per throw, and slowly puts them back', () => {
    const world = setup()
    const state = bossOf(world).boss!
    expect(state.bombs).toBe(RACK.size)
    force(world, 'bales')
    run(world, BALES.windup + BALES.interval * 2 + 0.1)
    expect(state.bombs).toBe(RACK.size - 3)
    run(world, BALES.recover + RACK.refill * 1.5)
    expect(state.bombs).toBeGreaterThan(RACK.size - 3)
    run(world, RACK.refill * 4)
    expect(state.bombs).toBeLessThanOrEqual(RACK.size)
  })

  it('knocks down a hay pillar when a bomb lands on it', () => {
    const world = setup()
    const pillar = world.level.landmarks.findIndex((landmark) => landmark.id === 'ch1-hay-pillar')
    place(world, 4, 12.5)
    force(world, 'bales')
    run(world, BALES.windup + BALES.flight + 0.1)
    expect(world.landmarks[pillar].broken).toBe(true)
    expect(world.events.some((event) => event.type === 'landmarkBroken' && event.index === pillar)).toBe(true)
  })

  it('aims its belly cannon for 0.6 seconds, then fires five shots down that line', () => {
    const world = setup()
    force(world, 'cannon')
    stepWorld(world, idle(), DT)
    const boss = bossOf(world)
    const state = boss.boss!
    expect(state.phase).toBe('telegraph')
    expect(boss.aimAngle).toBeCloseTo(Math.atan2(10.5 - boss.pos.y, 9.5 - boss.pos.x), 5)
    const aim = boss.aimAngle
    run(world, CANNON.telegraph - 0.05)
    expect(shots(world, 'chiefCannon')).toBe(0)
    for (let step = 0; step < 3 / DT && state.phase !== 'recover'; step++) stepWorld(world, idle(), DT)
    expect(shots(world, 'chiefCannon')).toBe(CANNON.shots)
    for (const event of world.events) if (event.type === 'enemyShot' && event.weapon === 'chiefCannon') expect(event.angle).toBeCloseTo(aim, 5)
    expect(state.phase).toBe('recover')
    expect(state.timer).toBeGreaterThan(CANNON.recover - 0.1)
  })

  it('takes turns between bombs and the cannon instead of shuffling', () => {
    const world = setup()
    const moves: BossMoveId[] = []
    for (let step = 0; step < 20 / DT && moves.length < 5; step++) {
      stepWorld(world, idle(), DT)
      for (const event of world.events) if (event.type === 'bossMove') moves.push(event.move)
      world.events.length = 0
    }
    expect(moves).toEqual(['bales', 'cannon', 'bales', 'cannon', 'bales'])
  })

  it('calls two bombers and a thrower at half health and leaves a health pack', () => {
    const world = setup()
    const boss = bossOf(world)
    boss.hp = boss.maxHp * DEF.summonAt - 1
    stepWorld(world, idle(), DT)
    expect(world.spawns.map((marker) => marker.kind)).toEqual(['bomber', 'bomber', 'thrower'])
    expect(world.events.filter((event) => event.type === 'bossSummon')).toHaveLength(1)
    expect(world.pickups.filter((pickup) => pickup.item.type === 'heal')).toHaveLength(1)
    run(world, DEF.summonWarning + 0.1)
    expect(world.enemies.filter((enemy) => enemy.summoned).map((enemy) => enemy.kind)).toEqual(['bomber', 'bomber', 'thrower'])
    expect(world.spawns).toHaveLength(0)
  })

  it('opens the barn when beaten and tells the picture how long to lay the bombs down', () => {
    const world = setup()
    expect(world.areas[1].status).toBe('locked')
    killEnemy(world, bossOf(world), true)
    stepWorld(world, idle(), DT)
    expect(world.areas[1].status).toBe('cleared')
    expect(DEF.show).toEqual({ lay: 2, fall: 1 })
    expect(DEF.tier).toBe('mini')
  })
})
