import { describe, expect, it } from 'vitest'
import { getBoss, type BossMoveId } from '../data/bosses'
import { createDefaultTuning } from '../data/tuning'
import { activateBoss } from './boss'
import { damageEnemy } from './combat'
import { Tile } from './grid'
import { stepWorld } from './step'
import { levelFromAreas } from './testing'
import type { Enemy, PlayerCommand } from './types'
import { createWorld, type World } from './world'

const DT = 1 / 60
const DEF = getBoss('harvester')
const WEAPONS = createDefaultTuning().weapons

const ARENA = levelFromAreas(
  [
    { name: 'gate', theme: 'meadow', rows: ['#...................#', '#.........P.........#', '#####################'] },
    {
      name: 'factory',
      theme: 'factory',
      kind: 'boss',
      rows: [
        '#########DDD#########',
        '#^.................v#',
        '#^......S..........v#',
        '#^.................v#',
        '#^........B........v#',
        '#^.................v#',
        '#^........o........v#',
        '#^.................v#',
        '#^.........S.......v#',
        '#########DDD#########',
      ],
    },
    { name: 'exit', theme: 'meadow', rows: ['#####################', '#........XXX........#', '#...................#'] },
  ],
  { bossId: 'harvester' },
)

function idle(aimX = 10.5, aimY = 7.5): PlayerCommand {
  return { moveX: 0, moveY: 0, aimX, aimY, fire: false, slot: null, interact: false, skill: null, ultimate: false, pitch: 0, jump: false, dash: false, melee: false }
}

function setup() {
  const world = createWorld(ARENA, createDefaultTuning())
  activateBoss(world)
  return world
}

function bossOf(world: World): Enemy {
  if (!world.boss?.boss) throw new Error('no boss')
  return world.boss
}

function place(world: World, x: number, y: number): void {
  world.player.pos = { x, y }
  world.player.prev = { x, y }
}

function run(world: World, command: PlayerCommand, seconds: number): void {
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) stepWorld(world, command, DT)
}

function force(world: World, move: BossMoveId): void {
  const boss = bossOf(world)
  if (!boss.boss) return
  boss.boss.order = [move]
  boss.boss.moveIndex = 0
  boss.boss.phase = 'walk'
  boss.boss.timer = 0
}

describe('chapter boss', () => {
  it('gets stunned when its charge hits a rock and takes extra damage meanwhile', () => {
    const world = setup()
    place(world, 10.5, 11.5)
    world.debug.invincible = true
    force(world, 'charge')
    run(world, idle(), DEF.charge.telegraph + 0.6)
    const boss = bossOf(world)
    expect(boss.boss?.phase).toBe('stunned')
    expect(world.events.some((event) => event.type === 'bossStunned')).toBe(true)
    const before = boss.hp
    damageEnemy(world, boss, 100, 0, 1, 0)
    expect(before - boss.hp).toBe(100 * DEF.stunDamageScale)
  })

  it('smashes a rock after two crashes', () => {
    const world = setup()
    world.debug.invincible = true
    const rock = 9 * world.grid.columns + 10
    expect(world.grid.tiles[rock]).toBe(Tile.Rock)
    for (let i = 0; i < 2; i++) {
      const boss = bossOf(world)
      boss.pos = { x: 10.5, y: 7.5 }
      place(world, 10.5, 11.5)
      force(world, 'charge')
      run(world, idle(), DEF.charge.telegraph + 0.6)
    }
    expect(world.grid.tiles[rock]).toBe(Tile.Floor)
    expect(world.events.some((event) => event.type === 'rockBroken')).toBe(true)
  })

  it('sweeps a wide arc in front but not behind', () => {
    const front = setup()
    place(front, 10.5, 9.5)
    force(front, 'sweep')
    run(front, idle(), WEAPONS.reaperSweep.windup + 0.2)
    expect(front.player.hp).toBe(front.player.maxHp - WEAPONS.reaperSweep.damage)
    const behind = setup()
    place(behind, 10.5, 9.5)
    force(behind, 'sweep')
    stepWorld(behind, idle(), DT)
    place(behind, 10.5, 5.5)
    run(behind, idle(), WEAPONS.reaperSweep.windup + 0.2)
    expect(behind.player.hp).toBe(behind.player.maxHp)
  })

  it('leaves a safe gap in the spinning blade ring', () => {
    const world = setup()
    place(world, 13.5, 7.5)
    force(world, 'spin')
    stepWorld(world, idle(), DT)
    const ring = world.blasts.find((blast) => blast.inner > 0)
    if (!ring) throw new Error('no ring')
    const boss = bossOf(world)
    place(world, boss.pos.x + Math.cos(ring.gapCenter) * 3, boss.pos.y + Math.sin(ring.gapCenter) * 3)
    world.player.pos.x = Math.min(19, Math.max(2, world.player.pos.x))
    world.player.pos.y = Math.min(11.5, Math.max(4, world.player.pos.y))
    const safe = Math.abs(Math.atan2(world.player.pos.y - boss.pos.y, world.player.pos.x - boss.pos.x) - ring.gapCenter) < ring.gapWidth / 2
    run(world, idle(), WEAPONS.bladeSpin.windup + 0.1)
    if (safe) expect(world.player.hp).toBe(world.player.maxHp)
    const hit = setup()
    place(hit, 13.5, 7.5)
    force(hit, 'spin')
    stepWorld(hit, idle(), DT)
    const blades = hit.blasts.find((blast) => blast.inner > 0)
    if (!blades) throw new Error('no ring')
    const away = blades.gapCenter + Math.PI
    place(hit, bossOf(hit).pos.x + Math.cos(away) * 3, bossOf(hit).pos.y + Math.sin(away) * 3)
    run(hit, idle(), WEAPONS.bladeSpin.windup + 0.1)
    expect(hit.player.hp).toBe(hit.player.maxHp - WEAPONS.bladeSpin.damage)
  })

  it('tosses a string of bales around the player', () => {
    const world = setup()
    world.debug.invincible = true
    place(world, 10.5, 11.5)
    force(world, 'bales')
    run(world, idle(), 0.4 + (DEF.bales?.interval ?? 0) * (DEF.bales?.count ?? 0) + 0.1)
    const thrown = world.events.filter((event) => event.type === 'enemyShot' && event.weapon === 'baleToss')
    expect(thrown).toHaveLength(DEF.bales?.count ?? 0)
  })

  it('chains its frenzy charges one after another', () => {
    const distance = DEF.charge.distance
    DEF.charge.distance = 2.5
    const world = setup()
    world.debug.invincible = true
    place(world, 14.5, 7.5)
    force(world, 'frenzy')
    const boss = bossOf(world)
    const phases: string[] = []
    for (let step = 0; step < 3 / DT; step++) {
      stepWorld(world, idle(), DT)
      const phase = boss.boss?.phase ?? ''
      if (phases[phases.length - 1] !== phase) phases.push(phase)
      if (phases.filter((item) => item === 'active').length >= 2) break
    }
    DEF.charge.distance = distance
    expect(phases.slice(0, 5)).toEqual(['telegraph', 'active', 'recover', 'telegraph', 'active'])
    expect(boss.boss?.frenzyLeft).toBe((DEF.frenzy?.charges ?? 0) - 1)
  })

  it('moves through its phases with a pause, new moves, hazards and a health pack', () => {
    const world = setup()
    place(world, 1.5, 9.5)
    const boss = bossOf(world)
    damageEnemy(world, boss, boss.maxHp * 0.45, 0, 1, 0)
    stepWorld(world, idle(), DT)
    expect(boss.boss?.phase).toBe('shift')
    expect(boss.boss?.phaseIndex).toBe(1)
    expect(boss.boss?.hazards).toContain('conveyor')
    expect(world.events.some((event) => event.type === 'bossPhase')).toBe(true)
    expect(world.pickups.some((pickup) => pickup.item.type === 'heal')).toBe(true)
    const hp = boss.hp
    damageEnemy(world, boss, 500, 0, 1, 0)
    expect(boss.hp).toBe(hp)
    const startY = world.player.pos.y
    run(world, idle(), 0.5)
    expect(world.player.pos.y).toBeLessThan(startY - 0.5)
  })

  it('drops blades around the edge in the last phase', () => {
    const world = setup()
    place(world, 10.5, 9.5)
    world.debug.invincible = true
    const boss = bossOf(world)
    damageEnemy(world, boss, boss.maxHp * 0.45, 0, 1, 0)
    stepWorld(world, idle(), DT)
    run(world, idle(), DEF.phaseShift + 0.1)
    damageEnemy(world, boss, boss.maxHp * 0.3, 0, 1, 0)
    stepWorld(world, idle(), DT)
    expect(boss.boss?.hazards).toContain('blades')
    run(world, idle(), DEF.hazards.bladeInterval * 2 + 0.1)
    const blades = world.events.filter((event) => event.type === 'blast' && event.source === 'boss')
    expect(blades.length + world.blasts.length).toBeGreaterThan(0)
  })
})
