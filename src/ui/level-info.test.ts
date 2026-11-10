import { describe, expect, it } from 'vitest'
import { LEVEL_1_1 } from '../data/levels/level-1-1'
import { LEVEL_1_2 } from '../data/levels/level-1-2'
import { LEVEL_1_3 } from '../data/levels/level-1-3'
import { LEVEL_1_4 } from '../data/levels/level-1-4'
import { LEVEL_1_5 } from '../data/levels/level-1-5'
import { TRIAL_SYSTEMS } from '../data/levels/trial-systems'
import { createDefaultTuning } from '../data/tuning'
import { breakTargets, lightLamps, openPens, raiseAlarms, teleportToArea } from '../sim/cheats'
import { damageLandmark } from '../sim/landmark-state'
import { buildLevel } from '../sim/level'
import { stepWorld } from '../sim/step'
import { runTallies } from '../sim/tallies'
import type { PlayerCommand } from '../sim/types'
import { createWorld, type World } from '../sim/world'
import { alarmLabel, showsTargetBar, tallyLines, tallyText, targetGlyph, targetHpText, targetLabel, targetName } from './level-info'

const YARD = 2

function world(def = LEVEL_1_2): World {
  return createWorld(buildLevel(def), createDefaultTuning())
}

function idle(target: World): PlayerCommand {
  const { pos } = target.player
  return { moveX: 0, moveY: 0, aimX: pos.x, aimY: pos.y - 1, pitch: 0, fire: false, slot: null, interact: false, skill: null, ultimate: false, jump: false, dash: false, melee: false }
}

function carts(target: World): number[] {
  return target.level.landmarks.flatMap((item, index) => (item.id === 'ch1-hay-cart' ? [index] : []))
}

describe('level info for the HUD and the results screen', () => {
  it('counts the grain carts of the loading yard under their HUD name', () => {
    const run = world()
    expect(targetName('ch1-hay-cart')).toBe('运粮车')
    expect(targetName('ch1-hay-pillar')).toBe('草垛柱子')
    expect(targetGlyph('ch1-hay-cart')).toBe('车')
    expect(targetGlyph('ch1-hay-pillar')).toBe('★')
    expect(targetHpText(1536.2, 2400)).toBe('1537 / 2400')
    expect(targetHpText(-3, 2400)).toBe('0 / 2400')
    expect(targetLabel(run, YARD)).toBe('运粮车 0 / 3')
    expect(targetLabel(run, 0)).toBeNull()
    damageLandmark(run, carts(run)[0], 99999)
    expect(targetLabel(run, YARD)).toBe('运粮车 1 / 3')
  })

  it('shows a cart health bar inside the sealed yard or once the cart is hurt, and never for a wreck', () => {
    const run = world()
    const [first, second] = carts(run)
    expect(showsTargetBar(run, first)).toBe(false)
    damageLandmark(run, second, 100)
    expect(showsTargetBar(run, second)).toBe(true)
    teleportToArea(run, YARD)
    stepWorld(run, idle(run), 1 / 60)
    expect(run.areaIndex).toBe(YARD)
    expect(showsTargetBar(run, first)).toBe(true)
    breakTargets(run, YARD)
    stepWorld(run, idle(run), 1 / 60)
    expect(run.areas[YARD].status).toBe('cleared')
    for (const index of carts(run)) expect(showsTargetBar(run, index)).toBe(false)
    const pillar = run.level.landmarks.findIndex((item) => item.id === 'ch1-hay-pillar')
    expect(showsTargetBar(run, pillar)).toBe(false)
  })

  it('lists chests, sheep, clues and secrets on the results screen and skips what the level does not have', () => {
    const run = world()
    expect(tallyLines(runTallies(run))).toEqual([
      { label: '宝箱', done: 0, total: 3 },
      { label: '放羊', done: 0, total: 4 },
      { label: '线索', done: 0, total: 1 },
      { label: '隐藏区', done: 0, total: 1 },
    ])
    openPens(run, 1)
    expect(tallyLines(runTallies(run))[1]).toEqual({ label: '放羊', done: 4, total: 4 })
    expect(tallyLines(runTallies(world(LEVEL_1_1))).map((line) => line.label)).toEqual(['宝箱', '线索', '隐藏区'])
  })

  it('shows the bell in the wheat field as quiet, running or rung, and nowhere else', () => {
    const run = world(LEVEL_1_3)
    const field = run.level.alarms[0].area
    expect(alarmLabel(run, field)).toEqual({ text: '警报：没响', status: 'quiet' })
    expect(alarmLabel(run, 0)).toBeNull()
    run.alarms[0].status = 'running'
    expect(alarmLabel(run, field)?.text).toBe('警报：有人跑去敲钟')
    run.alarms[0].status = 'quiet'
    raiseAlarms(run)
    expect(alarmLabel(run, field)).toEqual({ text: '警报：响了', status: 'rung' })
  })

  it('adds the alarm to the 1-3 results after the chests, the clue and the secret', () => {
    const run = world(LEVEL_1_3)
    const quiet = tallyLines(runTallies(run))
    expect(quiet.map(tallyText)).toEqual(['宝箱 0 / 3', '线索 0 / 1', '隐藏区 0 / 1', '警报 没响'])
    expect(quiet[3]).toMatchObject({ done: 1, total: 1 })
    raiseAlarms(run)
    const rung = tallyLines(runTallies(run))
    expect(tallyText(rung[3])).toBe('警报 响了')
    expect(rung[3].done).toBeLessThan(rung[3].total)
  })

  it('counts the fog lamps of 1-4 after the chests, the clue and the secret', () => {
    const run = world(LEVEL_1_4)
    expect(tallyLines(runTallies(run)).map(tallyText)).toEqual(['宝箱 0 / 3', '线索 0 / 1', '隐藏区 0 / 1', '驱雾灯 0 / 4'])
    lightLamps(run, 1)
    expect(tallyLines(runTallies(run))[3]).toEqual({ label: '驱雾灯', done: 2, total: 4 })
    expect(tallyLines(runTallies(world(LEVEL_1_3))).some((line) => line.label === '驱雾灯')).toBe(false)
  })

  it('counts the elites of 1-5 after the chests, the clue and the secret, and leaves levels without elites as they were', () => {
    const run = world(LEVEL_1_5)
    expect(tallyLines(runTallies(run)).map(tallyText)).toEqual(['宝箱 0 / 3', '线索 0 / 1', '隐藏区 0 / 1', '精英 0 / 3'])
    run.stats.elites = 2
    expect(tallyLines(runTallies(run))[3]).toEqual({ label: '精英', done: 2, total: 3 })
    run.stats.elites = 3
    expect(tallyLines(runTallies(run))[3]).toEqual({ label: '精英', done: 3, total: 3 })
    for (const def of [LEVEL_1_1, LEVEL_1_2, LEVEL_1_3, LEVEL_1_4]) expect(tallyLines(runTallies(world(def))).some((line) => line.label === '精英')).toBe(false)
    expect(tallyLines(runTallies(world(TRIAL_SYSTEMS))).find((line) => line.label === '精英')).toEqual({ label: '精英', done: 0, total: 3 })
  })
})
