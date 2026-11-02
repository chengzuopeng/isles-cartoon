import { describe, expect, it } from 'vitest'
import { LEVEL_1_3 } from '../data/levels/level-1-3'
import { createDefaultTuning } from '../data/tuning'
import { killEnemy } from './combat'
import { challengesOf, challengeTotal, levelChallenges } from './rating'
import { buildLevel } from './level'
import { levelFromAreas, singleArea } from './testing'
import { createWorld } from './world'

const ROWS = ['##########', '#P..m....#', '##########']
const EMPTY = ['#####', '#P..#', '#####']

function withSecret() {
  return levelFromAreas([{ name: 'test', theme: 'meadow', rows: ROWS, secrets: [{ from: [6, 1], to: [7, 1] }] }])
}

describe('challenges', () => {
  it('offers flawless everywhere, sweep where enemies stand and secret where something is hidden', () => {
    expect(challengeTotal(singleArea(EMPTY))).toBe(1)
    expect(challengeTotal(singleArea(ROWS))).toBe(2)
    expect(challengeTotal(withSecret())).toBe(3)
  })

  it('lists the challenges of a level in the order the prep card shows them, stealth only where an alarm stands', () => {
    expect(levelChallenges(singleArea(EMPTY))).toEqual(['flawless'])
    expect(levelChallenges(withSecret())).toEqual(['flawless', 'sweep', 'secret'])
    expect(levelChallenges(buildLevel(LEVEL_1_3))).toEqual(['flawless', 'sweep', 'secret', 'stealth'])
  })

  it('needs a clean clear for flawless and every placed enemy down for sweep', () => {
    const world = createWorld(singleArea(ROWS), createDefaultTuning())
    world.status = 'complete'
    expect(challengesOf(world)).toEqual([
      { id: 'flawless', done: true },
      { id: 'sweep', done: false },
    ])
    killEnemy(world, world.enemies[0], true)
    world.enemies = world.enemies.filter((enemy) => enemy.hp > 0)
    world.stats.hits = 1
    expect(challengesOf(world)).toEqual([
      { id: 'flawless', done: false },
      { id: 'sweep', done: true },
    ])
  })

  it('wants every hidden area found', () => {
    const world = createWorld(withSecret(), createDefaultTuning())
    world.status = 'complete'
    expect(challengesOf(world).find((item) => item.id === 'secret')?.done).toBe(false)
    world.secrets[0] = true
    expect(challengesOf(world).find((item) => item.id === 'secret')?.done).toBe(true)
  })

  it('counts nothing for a run that did not reach the end', () => {
    const world = createWorld(singleArea(ROWS), createDefaultTuning())
    expect(challengesOf(world).every((item) => !item.done)).toBe(true)
  })
})
