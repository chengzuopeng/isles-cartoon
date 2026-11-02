import { describe, expect, it } from 'vitest'
import { ELITE } from '../data/elites'
import { ELITE_XP } from '../data/progression'
import type { AffixId } from '../data/elites'
import type { MinionKind } from '../data/enemies'
import { createDefaultTuning } from '../data/tuning'
import { giveSpecialWeapon } from './arsenal'
import { damageEnemy, killEnemy } from './combat'
import { stepWorld } from './step'
import { singleArea } from './testing'
import type { Enemy, PlayerCommand } from './types'
import { createEnemy, createWorld, type World } from './world'

const DT = 1 / 60
const FIELD = [
  '########################',
  '#......................#',
  '#......................#',
  '#.P....................#',
  '#......................#',
  '#......................#',
  '########################',
]

function idle(aimX = 100, aimY = 3.5): PlayerCommand {
  return { moveX: 0, moveY: 0, aimX, aimY, fire: false, slot: null, interact: false, skill: null, ultimate: false, pitch: 0, jump: false, dash: false, melee: false }
}

function setup(rows = FIELD) {
  const tuning = createDefaultTuning()
  const world = createWorld(singleArea(rows), tuning)
  return { world, tuning }
}

function run(world: World, command: PlayerCommand, seconds: number): void {
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) stepWorld(world, command, DT)
}

function add(world: World, kind: MinionKind, x: number, y: number, affixes: AffixId[] = []): Enemy {
  const enemy = createEnemy(world, kind, { x, y }, 0, { affixes })
  enemy.aggro = true
  enemy.alert = 'combat'
  enemy.state = 'chase'
  world.enemies.push(enemy)
  return enemy
}

describe('shield bearer', () => {
  it('blocks bullets that hit its shield from the front', () => {
    const { world, tuning } = setup()
    tuning.shield.speed = 0
    const guard = add(world, 'shield', 8.5, 3.5)
    guard.facing = Math.PI
    stepWorld(world, { ...idle(8.5, 3.5), fire: true }, DT)
    run(world, idle(8.5, 3.5), 0.6)
    expect(guard.hp).toBe(guard.maxHp)
    expect(world.events.some((event) => event.type === 'shieldBlocked')).toBe(true)
  })

  it('takes full damage from behind and from explosions', () => {
    const { world, tuning } = setup()
    tuning.shield.speed = 0
    tuning.shield.turnRate = 0
    const guard = add(world, 'shield', 8.5, 3.5)
    guard.facing = 0
    stepWorld(world, { ...idle(8.5, 3.5), fire: true }, DT)
    run(world, idle(8.5, 3.5), 0.6)
    const burst = tuning.weapons.blaster.damage * tuning.weapons.blaster.burstCount
    expect(guard.hp).toBe(guard.maxHp - burst)
    const front = add(world, 'shield', 8.5, 1.5)
    front.facing = Math.PI
    giveSpecialWeapon(world, 'rocket')
    stepWorld(world, { ...idle(8.5, 1.5), fire: true }, DT)
    run(world, idle(8.5, 1.5), 1)
    expect(front.hp).toBeLessThan(front.maxHp)
  })

  it('turns slowly enough to be flanked', () => {
    const { world, tuning } = setup()
    tuning.shield.speed = 0
    const guard = add(world, 'shield', 8.5, 3.5)
    guard.facing = 0
    stepWorld(world, idle(), DT)
    expect(Math.abs(guard.facing)).toBeLessThan(tuning.shield.turnRate * DT * 1.01)
  })

  it('bashes a player standing in front of it', () => {
    const { world, tuning } = setup()
    const guard = add(world, 'shield', 3.5, 3.5)
    guard.facing = Math.PI
    run(world, idle(), tuning.weapons.bash.windup + 0.1)
    expect(world.player.hp).toBe(world.player.maxHp - tuning.weapons.bash.damage)
  })
})

describe('thrower', () => {
  it('lobs bombs over walls at the player', () => {
    const { world, tuning } = setup([
      '########################',
      '#......................#',
      '#..........#...........#',
      '#.P........#.......g...#',
      '#..........#...........#',
      '#......................#',
      '########################',
    ])
    const thrower = world.enemies[0]
    thrower.aggro = true
    thrower.alert = 'combat'
    thrower.lastSeen = { x: world.player.pos.x, y: world.player.pos.y }
    tuning.thrower.speed = 0
    tuning.weapons.bomb.range = 20
    run(world, idle(), tuning.weapons.bomb.windup + 0.1)
    expect(world.lobs).toHaveLength(1)
    expect(world.lobs[0].team).toBe('enemy')
    run(world, idle(), 3)
    expect(world.player.hp).toBe(world.player.maxHp - tuning.weapons.bomb.splash)
  })
})

describe('elites', () => {
  it('are bigger and tougher, pay elite experience and always drop loot', () => {
    const { world, tuning } = setup()
    const elite = add(world, 'grunt', 12.5, 3.5, ['tough'])
    expect(elite.maxHp).toBe(Math.round(tuning.grunt.maxHp * ELITE.hpScale * ELITE.toughHp))
    expect(elite.radius).toBeGreaterThan(tuning.grunt.radius)
    killEnemy(world, elite, true)
    expect(world.rewards.kills).toBe(ELITE_XP)
    expect(world.pickups).toHaveLength(1)
  })

  it('soak damage with a shield that comes back after a pause', () => {
    const { world, tuning } = setup()
    tuning.grunt.speed = 0
    const elite = add(world, 'grunt', 12.5, 3.5, ['shielded'])
    const shield = elite.elite?.shieldMax ?? 0
    expect(shield).toBeGreaterThan(0)
    damageEnemy(world, elite, shield + 50, 1, 0, 0)
    expect(elite.hp).toBe(elite.maxHp - 50)
    expect(world.events.some((event) => event.type === 'eliteShieldBroken')).toBe(true)
    run(world, idle(), ELITE.shieldDelay + 1 / ELITE.shieldRegen + 0.2)
    expect(elite.elite?.shield).toBeCloseTo(shield, 0)
  })

  it('split into two smaller enemies when a splitter falls', () => {
    const { world } = setup()
    const elite = add(world, 'grunt', 12.5, 3.5, ['splitter'])
    damageEnemy(world, elite, elite.maxHp + 1, 1, 0, 0)
    const children = world.enemies.filter((enemy) => enemy !== elite && enemy.hp > 0)
    expect(children).toHaveLength(ELITE.splitCount)
    expect(children.every((child) => child.elite === null && child.maxHp < elite.maxHp)).toBe(true)
  })

  it('blow up after a short delay when a volatile one falls', () => {
    const { world } = setup()
    const elite = add(world, 'gunner', 3.5, 3.5, ['volatile'])
    damageEnemy(world, elite, elite.maxHp + 1, 1, 0, 0)
    expect(world.blasts).toHaveLength(1)
    run(world, idle(), ELITE.volatileDelay + 0.1)
    expect(world.player.hp).toBe(world.player.maxHp - ELITE.volatileDamage)
  })

  it('move faster when swift', () => {
    const { world, tuning } = setup()
    tuning.grunt.weave = 0
    const swift = add(world, 'grunt', 14.5, 1.5, ['swift'])
    const plain = add(world, 'grunt', 14.5, 5.5)
    swift.flank = plain.flank = 0
    run(world, idle(), 0.5)
    const swiftMoved = 14.5 - swift.pos.x
    const plainMoved = 14.5 - plain.pos.x
    expect(swiftMoved).toBeGreaterThan(plainMoved * (ELITE.swiftSpeed - 0.1))
    expect(plainMoved).toBeGreaterThan(tuning.grunt.speed * 0.4)
  })
})
