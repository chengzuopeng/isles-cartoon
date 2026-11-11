import { describe, expect, it } from 'vitest'
import { BUFFS } from '../data/loot'
import { createDefaultTuning } from '../data/tuning'
import { giveBuff } from './buffs'
import { damagePlayer } from './combat'
import { stepWorld } from './step'
import { createLoadout } from './stats'
import { pitchAt, singleArea } from './testing'
import type { PlayerCommand } from './types'
import { createEnemy, createWorld, type World } from './world'

const DT = 1 / 60
const OPEN = ['####################', '#..................#', '#.P................#', '#..................#', '####################']

function idle(aimX = 100, aimY = 2.5): PlayerCommand {
  return { moveX: 0, moveY: 0, aimX, aimY, fire: false, slot: null, interact: false, skill: null, ultimate: false, pitch: 0, jump: false, dash: false, melee: false }
}

function setup(loadout = createLoadout(), rows = OPEN) {
  const tuning = createDefaultTuning()
  const world = createWorld(singleArea(rows), tuning, { loadout })
  return { world, tuning }
}

function run(world: World, command: PlayerCommand, seconds: number): void {
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) stepWorld(world, command, DT)
}

describe('buffs', () => {
  it('frenzy shortens the time between attacks', () => {
    const { world, tuning } = setup()
    giveBuff(world, 'frenzy')
    stepWorld(world, { ...idle(), fire: true }, DT)
    expect(world.player.cooldown).toBeCloseTo(tuning.weapons.blaster.cooldown / (1 + BUFFS.frenzy.value), 5)
  })

  it('might raises bullet damage', () => {
    const { world, tuning } = setup()
    giveBuff(world, 'might')
    stepWorld(world, { ...idle(), fire: true }, DT)
    expect(world.bullets[0].damage).toBeCloseTo(tuning.weapons.blaster.damage * (1 + BUFFS.might.value), 5)
  })

  it('swift speeds up movement', () => {
    const wide = ['##############################', '#............................#', '#.......P....................#', '#............................#', '##############################']
    const { world, tuning } = setup(createLoadout(), wide)
    const start = world.player.pos.x
    run(world, { ...idle(), moveX: 1 }, 1)
    expect(world.player.pos.x - start).toBeCloseTo(tuning.player.speed, 1)
    giveBuff(world, 'swift')
    const fast = world.player.pos.x
    run(world, { ...idle(), moveX: -1 }, 1)
    expect(fast - world.player.pos.x).toBeCloseTo(tuning.player.speed * (1 + BUFFS.swift.value), 1)
  })

  it('shield soaks damage until it breaks', () => {
    const { world } = setup()
    const { player } = world
    giveBuff(world, 'shield')
    damagePlayer(world, 200, 1, 0, 0)
    expect(player.hp).toBe(player.maxHp)
    expect(player.shield).toBe(BUFFS.shield.value - 200)
    expect(world.stats.hits).toBe(0)
    damagePlayer(world, 200, 1, 0, 0)
    expect(player.hp).toBe(player.maxHp - (400 - BUFFS.shield.value))
    expect(player.shield).toBe(0)
    expect(world.events.some((event) => event.type === 'shieldBroken')).toBe(true)
    stepWorld(world, idle(), DT)
    expect(player.buffs).toHaveLength(0)
  })

  it('infinite ammo keeps the magazine full', () => {
    const { world } = setup()
    giveBuff(world, 'infinite')
    for (let i = 0; i < 4; i++) {
      stepWorld(world, { ...idle(), fire: true }, DT)
      run(world, idle(), 0.35)
    }
    expect(world.player.ammo).toBe(world.player.magazine)
  })

  it('leech heals a share of the damage dealt', () => {
    const { world, tuning } = setup()
    tuning.grunt.speed = 0
    const target = createEnemy(world, 'grunt', { x: 7.5, y: 2.5 }, 0)
    world.enemies.push(target)
    world.player.hp = 500
    giveBuff(world, 'leech')
    const pitch = pitchAt(world, target)
    stepWorld(world, { ...idle(7.5, 2.5), pitch, fire: true }, DT)
    run(world, { ...idle(7.5, 2.5), pitch }, 0.5)
    const dealt = tuning.weapons.blaster.damage * tuning.weapons.blaster.burstCount
    expect(world.player.hp).toBeCloseTo(500 + dealt * BUFFS.leech.value, 3)
  })

  it('refreshes the timer when picked up again instead of stacking', () => {
    const { world } = setup()
    giveBuff(world, 'frenzy')
    run(world, idle(), 5)
    giveBuff(world, 'frenzy')
    expect(world.player.buffs).toEqual([{ id: 'frenzy', remaining: BUFFS.frenzy.duration, duration: BUFFS.frenzy.duration }])
  })

  it('runs out after its duration', () => {
    const { world } = setup()
    giveBuff(world, 'swift')
    run(world, idle(), BUFFS.swift.duration + 0.1)
    expect(world.player.buffs).toHaveLength(0)
    expect(world.events.some((event) => event.type === 'buffEnded' && event.buff === 'swift')).toBe(true)
  })
})

describe('specialisations', () => {
  it('shape the hero from the saved ranks', () => {
    const { world, tuning } = setup(createLoadout({ brawl: 4, gun: 5, move: 3, energy: 2 }))
    const { player } = world
    expect(player.maxHp).toBe(Math.round(tuning.player.maxHp * 1.2))
    expect(player.hp).toBe(player.maxHp)
    expect(player.magazine).toBe(tuning.weapons.blaster.magazine)
    stepWorld(world, { ...idle(), fire: true }, DT)
    expect(player.cooldown).toBeCloseTo(tuning.weapons.blaster.cooldown, 5)
    expect(world.bullets[0].damage).toBeCloseTo(tuning.weapons.blaster.damage * 1.15, 5)
    expect(world.playerStats.speed).toBeCloseTo(tuning.player.speed * 1.06, 5)
    expect(world.playerStats.meleeDamage).toBeCloseTo(1.32, 5)
    expect(world.playerStats.skillCooldown).toBeCloseTo(0.94, 5)
    expect(world.playerStats.ultCharge).toBeCloseTo(1.06, 5)
    expect(world.playerStats.dashRecharge).toBeCloseTo(1 / 1.12, 5)
    expect(world.playerStats.streakWindow).toBe(4.5)
    player.ammo = 0
    player.reload = 0
    run(world, idle(), tuning.weapons.blaster.reloadSeconds / 1.15 + 0.02)
    expect(player.ammo).toBe(1)
  })
})

describe('regeneration', () => {
  it('does not heal by itself on normal difficulty', () => {
    const { world, tuning } = setup()
    world.player.hp = 500
    run(world, idle(), tuning.player.regenDelay + 3)
    expect(world.player.hp).toBe(500)
  })

  it('waits out of combat before healing slowly where idle healing is on', () => {
    const { world, tuning } = setup()
    tuning.player.idleRegen = 1
    world.player.hp = 500
    run(world, idle(), tuning.player.regenDelay - 0.1)
    expect(world.player.hp).toBe(500)
    run(world, idle(), 1.1)
    expect(world.player.hp).toBeGreaterThan(500)
    expect(world.player.hp).toBeLessThanOrEqual(500 + tuning.player.regenPerSecond * 1.2)
  })

  it('stops while an alerted enemy is close and resumes once it is far away', () => {
    const tuning = createDefaultTuning()
    tuning.grunt.speed = 0
    tuning.player.idleRegen = 1
    const rows = ['##################################', '#P...............................#', '##################################']
    const world = createWorld(singleArea(rows), tuning)
    const enemy = createEnemy(world, 'grunt', { x: 13.5, y: 1.5 }, 0)
    enemy.aggro = true
    world.enemies.push(enemy)
    world.player.hp = 500
    run(world, idle(), tuning.player.regenDelay + 2)
    expect(world.player.hp).toBe(500)
    enemy.pos.x = 30.5
    enemy.prev.x = 30.5
    run(world, idle(), 1)
    expect(world.player.hp).toBeGreaterThan(500)
  })

  it('can switch back to the old rule for comparison', () => {
    const { world, tuning } = setup()
    tuning.player.legacyRegen = 1
    tuning.player.idleRegen = 1
    tuning.grunt.speed = 0
    const enemy = createEnemy(world, 'grunt', { x: 18.5, y: 2.5 }, 0)
    enemy.aggro = true
    world.enemies.push(enemy)
    world.player.hp = 500
    run(world, idle(), 3.5)
    expect(world.player.hp).toBeGreaterThan(500)
  })
})
