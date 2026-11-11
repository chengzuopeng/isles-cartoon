import { describe, expect, it } from 'vitest'
import { TRIAL_HARVESTER } from '../data/levels/trial-harvester'
import { createDefaultTuning } from '../data/tuning'
import { createAutopilot } from './autopilot'
import { DT, LIMIT_SECONDS, SEEDS } from './balance-runs'
import { buildLevel } from './level'
import { stepWorld } from './step'
import { createLoadout } from './stats'
import { createWorld } from './world'

describe('chapter boss trial', () => {
  it('is hard but beatable for the autopilot', () => {
    const level = buildLevel(TRIAL_HARVESTER)
    const runs = SEEDS.map((seed) => {
      const loadout = createLoadout({ brawl: 3, gun: 2 }, [{ slot: 'q', id: 'barrier', rank: 1 }])
      const world = createWorld(level, createDefaultTuning(), { seed, loadout })
      const pilot = createAutopilot()
      let fight = 0
      let phases = 0
      for (let step = 0; step < LIMIT_SECONDS / DT && world.status === 'playing'; step++) {
        stepWorld(world, pilot.next(world), DT)
        if (world.boss?.boss && world.boss.boss.phase !== 'dormant' && world.boss.hp > 0) fight += DT
        for (const event of world.events) if (event.type === 'bossPhase') phases += 1
        world.events.length = 0
      }
      return { seed, status: world.status, fight: Math.round(fight), hits: world.stats.hits, phases, bossHp: Math.round(world.boss?.hp ?? 0) }
    })
    console.table(runs)
    const wins = runs.filter((run) => run.status === 'complete').length
    expect(wins).toBeGreaterThanOrEqual(3)
    for (const run of runs.filter((item) => item.status === 'complete')) expect(run.fight).toBeGreaterThanOrEqual(60)
  }, 120_000)
})
