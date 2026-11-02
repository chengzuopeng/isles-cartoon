import { describe, expect, it } from 'vitest'
import { ELITE } from '../data/elites'
import { TRAINING } from '../data/levels/training'
import { createDefaultTuning } from '../data/tuning'
import { buildLevel } from '../sim/level'
import type { EnemyState } from '../sim/types'
import { createEnemy, createWorld } from '../sim/world'
import {
  bomberLampCycles,
  enemyPose,
  firedSince,
  fuseBlinkCycles,
  fuseBlinkRate,
  lampLit,
  modelScale,
  recoil,
  shieldReach,
  shieldShake,
  type StateSample,
} from './enemy-poses'

function setup() {
  const tuning = createDefaultTuning()
  const world = createWorld(buildLevel(TRAINING), tuning)
  return { tuning, world }
}

function sample(state: EnemyState, stateTime: number, time: number): StateSample {
  return { state, stateTime, time }
}

describe('enemy poses', () => {
  it('raises the grunt claw over the windup and drops it otherwise', () => {
    const { tuning, world } = setup()
    const grunt = createEnemy(world, 'grunt', { x: 3, y: 3 }, 0)
    const table = enemyPose('grunt')
    expect(table.attack).toBe('arm_claw')
    grunt.state = 'windup'
    grunt.stateTime = tuning.weapons.claw.windup / 2
    expect(table.pose(grunt, tuning)).toBeCloseTo(0.5)
    grunt.stateTime = tuning.weapons.claw.windup * 3
    expect(table.pose(grunt, tuning)).toBe(1)
    for (const state of ['idle', 'chase', 'recover'] satisfies EnemyState[]) {
      grunt.state = state
      expect(table.pose(grunt, tuning)).toBe(0)
    }
  })

  it('shoulders the gunner rifle over the aim and lowers it during the recover', () => {
    const { tuning, world } = setup()
    const gunner = createEnemy(world, 'gunner', { x: 3, y: 3 }, 0)
    const table = enemyPose('gunner')
    expect(table.attack).toBe('arm_rifle')
    expect(table.held).toContain('arm_support')
    gunner.state = 'aim'
    gunner.stateTime = tuning.weapons.rifle.windup / 4
    expect(table.pose(gunner, tuning)).toBeCloseTo(0.25)
    gunner.state = 'recover'
    gunner.stateTime = 0
    expect(table.pose(gunner, tuning)).toBe(1)
    gunner.stateTime = tuning.ai.rangedRecover / 2
    expect(table.pose(gunner, tuning)).toBeCloseTo(0.5)
    gunner.stateTime = tuning.ai.rangedRecover * 2
    expect(table.pose(gunner, tuning)).toBe(0)
    gunner.state = 'chase'
    expect(table.pose(gunner, tuning)).toBe(0)
  })

  it('lifts the thrower bomb arm, swells the bomber and readies the shield only in their own wind-ups', () => {
    const { tuning, world } = setup()
    const cases = [
      { kind: 'thrower', state: 'aim', windup: tuning.weapons.bomb.windup, attack: 'arm_bomb' },
      { kind: 'bomber', state: 'arming', windup: tuning.weapons.fuse.windup, attack: undefined },
      { kind: 'shield', state: 'windup', windup: tuning.weapons.bash.windup, attack: undefined },
    ] as const
    for (const { kind, state, windup, attack } of cases) {
      const enemy = createEnemy(world, kind, { x: 3, y: 3 }, 0)
      const table = enemyPose(kind)
      expect(table.attack).toBe(attack)
      enemy.state = state
      enemy.stateTime = windup * 0.6
      expect(table.pose(enemy, tuning)).toBeCloseTo(0.6)
      enemy.state = 'recover'
      expect(table.pose(enemy, tuning)).toBe(0)
    }
    expect(enemyPose('shield').held).toEqual(['arm_shield'])
  })

  it('keeps the boss without an entry still', () => {
    const { tuning, world } = setup()
    const enemy = createEnemy(world, 'grunt', { x: 3, y: 3 }, 0)
    enemy.state = 'windup'
    enemy.stateTime = 0.5
    const table = enemyPose('boss')
    expect(table.attack).toBeUndefined()
    expect(table.pose(enemy, tuning)).toBe(0)
  })

  it('scales the model with the elite size and not with the base radius', () => {
    const { world } = setup()
    expect(modelScale(createEnemy(world, 'shield', { x: 3, y: 3 }, 0))).toBeCloseTo(1)
    expect(modelScale(createEnemy(world, 'gunner', { x: 3, y: 3 }, 0, { affixes: ['swift'] }))).toBeCloseTo(ELITE.sizeScale)
    expect(modelScale(createEnemy(world, 'turret', { x: 3, y: 3 }, 0, { affixes: ['tough'] }))).toBeCloseTo(ELITE.sizeScale * ELITE.toughSize)
  })
})

describe('enemy fire detection', () => {
  const windup = 0.55

  it('fires when the aim ran its full windup before turning into the recover', () => {
    expect(firedSince(sample('aim', 0.5, 10), sample('recover', 0.02, 10.08), windup, false)).toBe(true)
    expect(firedSince(sample('aim', 0.1, 10), sample('recover', 0.9, 11.5), windup, false)).toBe(true)
  })

  it('ignores an aim that was interrupted early', () => {
    expect(firedSince(sample('aim', 0.2, 10), sample('recover', 0.05, 10.1), windup, false)).toBe(false)
    expect(firedSince(sample('aim', 0.5, 10), sample('recover', 0, 10.1), windup, true)).toBe(false)
  })

  it('needs an aim followed by a recover', () => {
    expect(firedSince(null, sample('recover', 0, 10), windup, false)).toBe(false)
    expect(firedSince(sample('aim', 0.4, 10), sample('aim', 0.5, 10.1), windup, false)).toBe(false)
    expect(firedSince(sample('recover', 0.1, 10), sample('recover', 0.2, 10.1), windup, false)).toBe(false)
    expect(firedSince(sample('chase', 0.5, 10), sample('recover', 0.05, 10.1), windup, false)).toBe(false)
  })

  it('kicks back fully at the shot and settles by the end of the recoil', () => {
    expect(recoil(0, 0.3)).toBe(1)
    expect(recoil(0.1, 0.3)).toBeLessThan(recoil(0.05, 0.3))
    expect(recoil(0.3, 0.3)).toBe(0)
    expect(recoil(-0.1, 0.3)).toBe(0)
    expect(recoil(Infinity, 0.3)).toBe(0)
  })
})

describe('bomber lamps', () => {
  const windup = 0.65

  it('speeds up continuously from 5 Hz to 20 Hz over the fuse', () => {
    expect(fuseBlinkRate(0, windup)).toBe(5)
    expect(fuseBlinkRate(windup / 2, windup)).toBeCloseTo(12.5)
    expect(fuseBlinkRate(windup, windup)).toBe(20)
    expect(fuseBlinkRate(windup * 2, windup)).toBe(20)
  })

  it('accumulates blink cycles whose rate matches the ramp without jumps', () => {
    const step = 1e-4
    for (const time of [0.05, 0.3, 0.6, 0.9]) {
      const rate = (fuseBlinkCycles(time + step, windup) - fuseBlinkCycles(time - step, windup)) / (2 * step)
      expect(rate).toBeCloseTo(fuseBlinkRate(time, windup), 2)
    }
    expect(fuseBlinkCycles(0, windup)).toBe(0)
    expect(fuseBlinkCycles(windup + 1e-9, windup)).toBeCloseTo(fuseBlinkCycles(windup, windup), 6)
  })

  it('blinks slowly at rest, faster once alerted and by the fuse while arming', () => {
    const { world } = setup()
    const bomber = createEnemy(world, 'bomber', { x: 3, y: 3 }, 0)
    const calm = bomberLampCycles(bomber, 2, windup) - bomberLampCycles(bomber, 1, windup)
    bomber.aggro = true
    const alerted = bomberLampCycles(bomber, 2, windup) - bomberLampCycles(bomber, 1, windup)
    expect(alerted).toBeGreaterThan(calm)
    bomber.state = 'arming'
    bomber.stateTime = 0.3
    expect(bomberLampCycles(bomber, 99, windup)).toBeCloseTo(fuseBlinkCycles(0.3, windup))
  })

  it('lights the lamp for the first half of each cycle', () => {
    expect(lampLit(3.2)).toBe(true)
    expect(lampLit(3.7)).toBe(false)
  })
})

describe('shield guard', () => {
  it('pulls the shield back over the bash windup, shoves it out at the strike and settles', () => {
    const { tuning, world } = setup()
    const shield = createEnemy(world, 'shield', { x: 3, y: 3 }, 0)
    shield.state = 'windup'
    shield.stateTime = tuning.weapons.bash.windup / 2
    expect(shieldReach(shield, tuning)).toBeCloseTo(-0.5)
    shield.state = 'recover'
    shield.stateTime = 0
    expect(shieldReach(shield, tuning)).toBeCloseTo(-1)
    shield.stateTime = 0.08
    expect(shieldReach(shield, tuning)).toBeCloseTo(1)
    shield.stateTime = 0.2
    expect(shieldReach(shield, tuning)).toBeGreaterThan(0)
    shield.stateTime = 0.5
    expect(shieldReach(shield, tuning)).toBe(0)
    shield.state = 'chase'
    expect(shieldReach(shield, tuning)).toBe(0)
  })

  it('shakes after a block and stops', () => {
    expect(shieldShake(0.02, 0.28)).not.toBe(0)
    expect(Math.abs(shieldShake(0.25, 0.28))).toBeLessThan(Math.abs(Math.sin(0.25 * 55)))
    expect(shieldShake(0.3, 0.28)).toBe(0)
    expect(shieldShake(Infinity, 0.28)).toBe(0)
  })
})
