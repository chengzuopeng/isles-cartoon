import { describe, expect, it } from 'vitest'
import { createDefaultTuning } from '../data/tuning'
import { killEnemy } from './combat'
import { stepWorld } from './step'
import { pitchAt, singleArea } from './testing'
import type { GameEvent, MinionKind, PlayerCommand } from './types'
import { createEnemy, createWorld, type World } from './world'

const DT = 1 / 60
const OPEN = ['############', '#..........#', '#.P........#', '#..........#', '#..........#', '############']

function idle(aimX = 100, aimY = 2.5): PlayerCommand {
  return { moveX: 0, moveY: 0, aimX, aimY, fire: false, slot: null, interact: false, skill: null, ultimate: false, pitch: 0, jump: false, dash: false, melee: false }
}

function setup(rows = OPEN) {
  const tuning = createDefaultTuning()
  const world = createWorld(singleArea(rows), tuning)
  return { world, tuning }
}

function run(world: World, command: PlayerCommand, seconds: number): void {
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) stepWorld(world, command, DT)
}

function count(world: World, type: string): number {
  return world.events.filter((event) => event.type === type).length
}

function spawn(world: World, kind: MinionKind, x: number, y: number) {
  const enemy = createEnemy(world, kind, { x, y }, 0)
  world.enemies.push(enemy)
  return enemy
}

describe('player attack', () => {
  it('fires a whole burst for one ammo', () => {
    const { world, tuning } = setup()
    stepWorld(world, { ...idle(), fire: true }, DT)
    expect(world.player.ammo).toBe(tuning.weapons.blaster.magazine - 1)
    run(world, idle(), 0.3)
    expect(count(world, 'shot')).toBe(tuning.weapons.blaster.burstCount)
  })

  it('cannot fire without ammo', () => {
    const { world } = setup()
    world.player.ammo = 0
    stepWorld(world, { ...idle(), fire: true }, DT)
    expect(world.bullets).toHaveLength(0)
  })

  it('reloads one ammo after the reload time', () => {
    const { world, tuning } = setup()
    world.player.ammo = 0
    run(world, idle(), tuning.weapons.blaster.reloadSeconds - 0.05)
    expect(world.player.ammo).toBe(0)
    run(world, idle(), 0.1)
    expect(world.player.ammo).toBe(1)
  })
})

describe('bullets', () => {
  it('damage and push back enemies', () => {
    const { world, tuning } = setup()
    tuning.grunt.speed = 0
    const enemy = spawn(world, 'grunt', 6.5, 2.5)
    const aim = { ...idle(6.5, 2.5), pitch: pitchAt(world, enemy) }
    stepWorld(world, { ...aim, fire: true }, DT)
    run(world, aim, 0.6)
    expect(enemy.hp).toBe(tuning.grunt.maxHp - tuning.weapons.blaster.burstCount * tuning.weapons.blaster.damage)
    expect(enemy.pos.x).toBeGreaterThan(6.5)
    expect(count(world, 'enemyHit')).toBe(tuning.weapons.blaster.burstCount)
  })

  it('kill enemies and count the kill', () => {
    const { world, tuning } = setup()
    tuning.grunt.speed = 0
    const enemy = spawn(world, 'grunt', 5.5, 2.5)
    enemy.hp = 50
    const aim = { ...idle(5.5, 2.5), pitch: pitchAt(world, enemy) }
    stepWorld(world, { ...aim, fire: true }, DT)
    run(world, aim, 0.4)
    expect(world.stats.kills).toBe(1)
    expect(world.enemies).toHaveLength(0)
    expect(count(world, 'enemyKilled')).toBe(1)
    const killed = world.events.find((event): event is Extract<GameEvent, { type: 'enemyKilled' }> => event.type === 'enemyKilled')
    expect(killed?.dirX).toBeCloseTo(1, 3)
    expect(killed?.dirY).toBeCloseTo(0, 3)
  })

  it('stop at walls', () => {
    const { world } = setup()
    stepWorld(world, { ...idle(2.5, -10), fire: true }, DT)
    run(world, idle(2.5, -10), 0.3)
    expect(count(world, 'bulletHitWall')).toBeGreaterThan(0)
    expect(world.bullets).toHaveLength(0)
  })
})

describe('melee enemy', () => {
  it('winds up and then hits a player who stays in reach', () => {
    const { world, tuning } = setup()
    const enemy = spawn(world, 'grunt', 3.5, 2.5)
    stepWorld(world, idle(), DT)
    expect(enemy.state).toBe('windup')
    expect(world.player.hp).toBe(tuning.player.maxHp)
    run(world, idle(), tuning.weapons.claw.windup + 0.05)
    expect(world.player.hp).toBe(tuning.player.maxHp - tuning.weapons.claw.damage)
  })

  it('misses a player who walks out of reach during the windup', () => {
    const { world, tuning } = setup()
    spawn(world, 'grunt', 3.5, 2.5)
    stepWorld(world, idle(), DT)
    run(world, { ...idle(), moveX: -1, moveY: 1 }, tuning.weapons.claw.windup + 0.05)
    expect(world.player.hp).toBe(tuning.player.maxHp)
  })

  it('ends the run when the player runs out of health', () => {
    const { world } = setup()
    world.player.hp = 10
    spawn(world, 'grunt', 3.5, 2.5)
    run(world, idle(), 0.6)
    expect(world.player.alive).toBe(false)
    expect(world.status).toBe('dead')
    expect(count(world, 'playerDied')).toBe(1)
  })
})

describe('world rules', () => {
  it('slows the simulation during hitstop', () => {
    const { world, tuning } = setup()
    world.hitstop = 0.1
    stepWorld(world, idle(), DT)
    expect(world.time).toBeCloseTo(DT * tuning.feel.hitstopScale)
  })

  it('regenerates health after a quiet period', () => {
    const { world, tuning } = setup()
    world.player.hp = 500
    run(world, idle(), tuning.player.regenDelay - 0.1)
    expect(world.player.hp).toBe(500)
    run(world, idle(), 1)
    expect(world.player.hp).toBeGreaterThan(500)
  })

  it('brings every enemy back when the level restarts', () => {
    const level = singleArea(['#######', '#P..m.#', '#######'])
    const tuning = createDefaultTuning()
    const first = createWorld(level, tuning)
    killEnemy(first, first.enemies[0], true)
    stepWorld(first, idle(), DT)
    expect(first.enemies).toHaveLength(0)
    const second = createWorld(level, tuning)
    expect(second.enemies).toHaveLength(1)
    expect(second.enemies[0].hp).toBe(tuning.grunt.maxHp)
  })
})
