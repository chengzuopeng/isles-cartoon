import { describe, expect, it } from 'vitest'
import { createDefaultTuning } from '../data/tuning'
import { sneakReady } from './melee'
import { stepWorld } from './step'
import { levelFromAreas } from './testing'
import type { Enemy, GameEvent, MinionKind, PlayerCommand } from './types'
import { createEnemy, createWorld, type World } from './world'

const DT = 1 / 60
const FIELD = [
  '######################',
  '#....................#',
  '#....................#',
  '#....................#',
  '#....................#',
  '#....................#',
  '#....................#',
  '#....................#',
  '#....................#',
  '#P...................#',
  '######################',
]

function setup(): World {
  const tuning = createDefaultTuning()
  tuning.grunt.speed = 0
  tuning.gunner.speed = 0
  tuning.perception.sweepDeg = 0
  return createWorld(levelFromAreas([{ name: 'yard', theme: 'meadow', rows: FIELD }]), tuning)
}

function guard(world: World, kind: MinionKind, x: number, y: number, facing = Math.PI / 2): Enemy {
  const enemy = createEnemy(world, kind, { x, y }, 0)
  enemy.facing = facing
  enemy.baseFacing = facing
  world.enemies.push(enemy)
  return enemy
}

function stand(world: World, x: number, y: number): void {
  world.player.pos = { x, y }
  world.player.prev = { x, y }
}

function command(target: Enemy, patch: Partial<PlayerCommand> = {}): PlayerCommand {
  return {
    moveX: 0,
    moveY: 0,
    aimX: target.pos.x,
    aimY: target.pos.y,
    pitch: 0,
    fire: false,
    slot: null,
    interact: false,
    skill: null,
    ultimate: false,
    jump: false,
    dash: false,
    melee: false,
    ...patch,
  }
}

function run(world: World, target: Enemy, seconds: number, patch: Partial<PlayerCommand> = {}): GameEvent[] {
  const events: GameEvent[] = []
  for (let i = 0; i < Math.max(1, Math.round(seconds / DT)); i++) {
    stepWorld(world, command(target, patch), DT)
    events.push(...world.events)
    world.events.length = 0
  }
  return events
}

describe('the blind spot behind an unaware robot', () => {
  it('never notices the player standing close behind it', () => {
    const world = setup()
    const grunt = guard(world, 'grunt', 10, 5)
    stand(world, 10, 3.2)
    run(world, grunt, 2)
    expect(grunt.aggro).toBe(false)
    expect(grunt.notice).toBe(0)
  })

  it('still spots the player right away from the side or the front at that distance', () => {
    for (const [x, y] of [
      [11.8, 5],
      [10, 6.8],
    ]) {
      const world = setup()
      const grunt = guard(world, 'grunt', 10, 5)
      stand(world, x, y)
      run(world, grunt, 0.1)
      expect(grunt.aggro).toBe(true)
    }
  })

  it('turns around when shots are fired behind it', () => {
    const world = setup()
    const grunt = guard(world, 'grunt', 10, 5)
    stand(world, 10, 3.2)
    run(world, grunt, 0.4, { fire: true, aimX: 3, aimY: 1 })
    expect(grunt.alert).not.toBe('idle')
  })
})

describe('sneak attacks', () => {
  it('smashes an unaware charger at full health with one swing and keeps its neighbour calm', () => {
    const world = setup()
    const grunt = guard(world, 'grunt', 10, 5)
    const neighbour = guard(world, 'grunt', 16, 8, -Math.PI / 2)
    stand(world, 10, 3.4)
    run(world, grunt, 0.2)
    expect(sneakReady(world)).toBe(true)
    const events = run(world, grunt, DT, { melee: true })
    expect(grunt.hp).toBe(0)
    expect(world.stats.sneaks).toBe(1)
    expect(events.some((event) => event.type === 'combo' && event.kind === 'sneak')).toBe(true)
    expect(events.some((event) => event.type === 'smashed' && event.id === grunt.id)).toBe(true)
    expect(world.pickups.some((pickup) => pickup.item.type === 'heal')).toBe(true)
    expect(neighbour.aggro).toBe(false)
  })

  it('takes half an unaware elite down and leaves it reeling instead of smashing it', () => {
    const world = setup()
    const elite = createEnemy(world, 'gunner', { x: 10, y: 5 }, 0, { affixes: ['tough'] })
    elite.facing = Math.PI / 2
    elite.baseFacing = Math.PI / 2
    world.enemies.push(elite)
    stand(world, 10, 3.3)
    run(world, elite, 0.2)
    run(world, elite, DT, { melee: true })
    expect(elite.hp).toBeCloseTo(elite.maxHp / 2, 0)
    expect(elite.status.dazed).toBeGreaterThan(0)
    expect(elite.aggro).toBe(true)
  })

  it('offers no sneak attack once the robot is fighting', () => {
    const world = setup()
    const grunt = guard(world, 'grunt', 10, 5)
    stand(world, 10, 3.4)
    run(world, grunt, 0.2)
    grunt.aggro = true
    grunt.alert = 'combat'
    expect(sneakReady(world)).toBe(false)
    run(world, grunt, DT, { melee: true })
    expect(grunt.hp).toBe(grunt.maxHp - world.tuning.player.meleeDamage)
  })
})
