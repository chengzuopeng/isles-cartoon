import { describe, expect, it } from 'vitest'
import { TRAINING } from '../data/levels/training'
import { createDefaultTuning } from '../data/tuning'
import { countStreak, killEnemy } from './combat'
import { buildLevel } from './level'
import { chargeUltimate, streakBoost } from './ultimate'
import { createEnemy, createWorld } from './world'

function setup() {
  const world = createWorld(buildLevel(TRAINING), createDefaultTuning())
  return world
}

describe('kill streaks', () => {
  it('counts kills that come within the window and starts over after it', () => {
    const world = setup()
    const { window } = world.tuning.player.streak
    countStreak(world)
    expect(world.player.streak).toBe(1)
    world.time += window * 0.5
    countStreak(world)
    world.time += window * 0.9
    countStreak(world)
    expect(world.player.streak).toBe(3)
    world.time += window + 0.01
    countStreak(world)
    expect(world.player.streak).toBe(1)
  })

  it('tags the kill event with the streak when the player scores it', () => {
    const world = setup()
    const enemy = createEnemy(world, 'grunt', { x: 7.5, y: 2.5 }, 0)
    killEnemy(world, enemy, true)
    const event = world.events.find((e) => e.type === 'enemyKilled')
    expect(event && event.type === 'enemyKilled' ? event.streak : -1).toBe(1)
  })

  it('does not count kills the player did not make', () => {
    const world = setup()
    const enemy = createEnemy(world, 'grunt', { x: 7.5, y: 2.5 }, 0)
    killEnemy(world, enemy, false)
    expect(world.player.streak).toBe(0)
    const event = world.events.find((e) => e.type === 'enemyKilled')
    expect(event && event.type === 'enemyKilled' ? event.streak : -1).toBe(0)
  })

  it('charges the ultimate faster during a streak, up to a cap', () => {
    const world = setup()
    const rule = world.tuning.player.streak
    expect(streakBoost(world)).toBe(1)
    countStreak(world)
    expect(streakBoost(world)).toBe(1)
    countStreak(world)
    expect(streakBoost(world)).toBeCloseTo(1 + rule.ultBonus)
    for (let i = 0; i < rule.maxSteps + 4; i++) countStreak(world)
    expect(streakBoost(world)).toBeCloseTo(1 + rule.ultBonus * rule.maxSteps)
    world.time += rule.window + 0.01
    expect(streakBoost(world)).toBe(1)
  })

  it('applies the boost to ultimate charge from minion damage', () => {
    const plain = setup()
    const streaking = setup()
    const minion = createEnemy(streaking, 'grunt', { x: 7.5, y: 2.5 }, 0)
    countStreak(streaking)
    countStreak(streaking)
    countStreak(streaking)
    chargeUltimate(plain, 200, createEnemy(plain, 'grunt', { x: 7.5, y: 2.5 }, 0))
    chargeUltimate(streaking, 200, minion)
    expect(streaking.player.ultimate).toBeCloseTo(plain.player.ultimate * streakBoost(streaking))
    expect(streaking.player.ultimate).toBeGreaterThan(plain.player.ultimate)
  })

  it('leaves boss damage and untargeted charge unboosted', () => {
    const plain = setup()
    const streaking = setup()
    countStreak(streaking)
    countStreak(streaking)
    const boss = { ...createEnemy(streaking, 'grunt', { x: 7.5, y: 2.5 }, 0), kind: 'boss' as const }
    chargeUltimate(plain, 200)
    chargeUltimate(streaking, 200, boss)
    expect(streaking.player.ultimate).toBeCloseTo(plain.player.ultimate)
    chargeUltimate(streaking, 200)
    chargeUltimate(plain, 200)
    expect(streaking.player.ultimate).toBeCloseTo(plain.player.ultimate)
  })
})
