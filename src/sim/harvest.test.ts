import { describe, expect, it } from 'vitest'
import { BLADE } from '../data/blades'
import { getBoss } from '../data/bosses'
import { BARKS, STORIES } from '../data/dialogue'
import { LEVEL_1_5 } from '../data/levels/level-1-5'
import { TRIAL_HARVESTER } from '../data/levels/trial-harvester'
import { createDefaultTuning } from '../data/tuning'
import { activateBoss } from './boss'
import { damagePlayer, killEnemy } from './combat'
import { Tile, tileAt } from './grid'
import { buildLevel, insideRegion, reachableFrom } from './level'
import { stepWorld } from './step'
import { runTallies } from './tallies'
import type { GameEvent, PlayerCommand } from './types'
import { createWorld, type World } from './world'

const DT = 1 / 60
const LEVEL = buildLevel(LEVEL_1_5)

function idle(world: World): PlayerCommand {
  return { moveX: 0, moveY: 0, aimX: world.player.pos.x, aimY: world.player.pos.y - 1, fire: false, slot: null, interact: false, skill: null, ultimate: false, pitch: 0, jump: false, dash: false, melee: false }
}

function run(world: World, seconds: number, seen: GameEvent[] = []): GameEvent[] {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    stepWorld(world, idle(world), DT)
    seen.push(...world.events)
    world.events.length = 0
  }
  return seen
}

function place(world: World, area: number, column: number, row: number): void {
  const spot = { x: column + 0.5, y: world.level.areas[area].top + row + 0.5 }
  world.player.pos = { ...spot }
  world.player.prev = { ...spot }
}

function barksOf(events: readonly GameEvent[]): string[] {
  return events.flatMap((event) => (event.type === 'bark' ? [event.id] : []))
}

describe('1-5 harvest fields', () => {
  it('has Alo call out the first red line of a blade lane', () => {
    const world = createWorld(LEVEL, createDefaultTuning())
    const first = Math.min(...LEVEL.blades.map((lane) => lane.delay + lane.rest - lane.warning))
    const events = run(world, first - 0.1)
    expect(barksOf(events)).not.toContain('redLine')
    const later = run(world, 0.2)
    expect(later.some((event) => event.type === 'bladeWarning')).toBe(true)
    const bark = later.find((event) => event.type === 'bark' && event.id === 'redLine')
    expect(bark).toMatchObject({ speaker: 'alo', text: '红线！刀片要扫过来了！', display: 'bar' })
  })

  it('points out the first elite in sight, and counts every elite downed for the results', () => {
    const world = createWorld(LEVEL, createDefaultTuning())
    expect(runTallies(world).elites).toEqual({ done: 0, total: 3 })
    const swift = world.enemies.find((enemy) => enemy.elite?.affixes.includes('swift'))!
    world.player.pos = { x: swift.pos.x, y: swift.pos.y + 4 }
    world.player.prev = { ...world.player.pos }
    const events = run(world, DT)
    expect(barksOf(events)).toContain('crown')
    killEnemy(world, swift, true)
    const tough = world.enemies.find((enemy) => enemy.elite?.affixes.includes('tough'))!
    killEnemy(world, tough, false)
    expect(runTallies(world).elites).toEqual({ done: 2, total: 3 })
    expect(runTallies(createWorld(buildLevel(TRIAL_HARVESTER), createDefaultTuning())).elites).toEqual({ done: 0, total: 0 })
  })

  it('says the sorting hall, the anchor crate and the factory gate lines where the design puts them', () => {
    expect(BARKS['1-5'].map((bark) => [bark.id, bark.speaker, bark.trigger])).toEqual([
      ['redLine', 'alo', { on: 'blade' }],
      ['crown', 'alo', { on: 'elite', range: 8 }],
      ['belts', 'kai', { on: 'enter', area: 2 }],
      ['anchor', 'kai', { on: 'clue', clue: 'anchor-crate' }],
      ['gate', 'alo', { on: 'enter', area: 3 }],
    ])
    const world = createWorld(LEVEL, createDefaultTuning())
    const clue = world.clues[0]
    world.player.pos = { ...clue.pos }
    world.player.prev = { ...clue.pos }
    const events = run(world, DT * 2)
    expect(events.some((event) => event.type === 'clueFound' && event.clue === 'anchor-crate')).toBe(true)
    expect(barksOf(events)).toEqual(expect.arrayContaining(['belts', 'anchor']))
  })

  it('lets the hold of the airship be walked, with the rear behind breakable crates as the hidden area', () => {
    const [ship] = LEVEL.landmarks.filter((placement) => placement.id === 'ch1-airship')
    const { grid } = LEVEL
    const at = (column: number, row: number) => tileAt(grid, ship.column + column, ship.row + row)
    for (let column = 0; column < 6; column++) expect(at(column, 0)).toBe(Tile.Landmark)
    for (let row = 1; row <= 8; row++) {
      expect(at(0, row)).toBe(Tile.Landmark)
      expect(at(5, row)).toBe(Tile.Landmark)
    }
    expect([at(0, 9), at(1, 9), at(2, 9), at(3, 9), at(4, 9), at(5, 9)]).toEqual([Tile.Landmark, Tile.Landmark, Tile.Floor, Tile.Floor, Tile.Landmark, Tile.Landmark])
    for (let column = 1; column <= 4; column++) {
      expect(at(column, 3)).toBe(Tile.Crate)
      expect(at(column, 5)).toBe(Tile.Floor)
    }
    const rare = LEVEL.chests.find((chest) => chest.tier === 'rare')!
    expect(rare.weapon).toBe('grenade')
    const cell = Math.floor(rare.y) * grid.columns + Math.floor(rare.x)
    expect(reachableFrom(grid, LEVEL.playerStart)[cell]).toBe(0)
    expect(reachableFrom(grid, LEVEL.playerStart, true)[cell]).toBe(1)
    const secret = LEVEL.secrets[0]
    expect(insideRegion(secret, rare.x, rare.y)).toBe(true)
    const world = createWorld(LEVEL, createDefaultTuning())
    place(world, 2, 33, 3)
    const events = run(world, DT)
    expect(events.some((event) => event.type === 'secretFound' && event.index === 0)).toBe(true)
  })

  it('plays the boss lines once the harvester shows up, only in 1-5', () => {
    expect(STORIES['1-5'].boss?.map((line) => line.speaker)).toEqual(['bolt', 'kai', 'bolt'])
    expect(STORIES['trial-harvester'].boss).toBeUndefined()
    const world = createWorld(LEVEL, createDefaultTuning())
    activateBoss(world)
    expect(world.events.find((event) => event.type === 'bossIntro')).toEqual({ type: 'bossIntro', name: '巨型收割机', story: true })
    const trial = createWorld(buildLevel(TRIAL_HARVESTER), createDefaultTuning())
    activateBoss(trial)
    expect(trial.events.find((event) => event.type === 'bossIntro')).toEqual({ type: 'bossIntro', name: '巨型收割机' })
  })

  it('runs its own lighter harvester in the factory and leaves the trial one as it was', () => {
    const tuning = LEVEL_1_5.bossTuning!
    const world = createWorld(LEVEL, createDefaultTuning())
    expect(world.boss).toMatchObject({ hp: tuning.maxHp, maxHp: tuning.maxHp })
    const trial = createWorld(buildLevel(TRIAL_HARVESTER), createDefaultTuning())
    expect(trial.boss?.maxHp).toBe(getBoss('harvester').maxHp)
    damagePlayer(world, 200, 0, 1, 0)
    expect(world.player.maxHp - world.player.hp).toBe(200)
    place(world, 4, 19, 14)
    run(world, DT)
    expect(world.areaIndex).toBe(4)
    expect(world.areas[4].status).toBe('locked')
    world.player.hp = world.player.maxHp
    damagePlayer(world, 200, 0, 1, 0)
    expect(world.player.maxHp - world.player.hp).toBe(200 * (tuning.damage ?? 1))
    damagePlayer(trial, 200, 0, 1, 0)
    expect(trial.player.maxHp - trial.player.hp).toBe(200)
  })

  it('keeps the blade lanes of the fields to their staggered speeds', () => {
    expect(LEVEL.blades.map((lane) => [lane.speed, lane.rest, lane.delay])).toEqual([
      [7, 2, 0],
      [BLADE.speed, BLADE.rest, 0],
      [9, 1.2, 0.5],
    ])
  })
})
