import { describe, expect, it } from 'vitest'
import { BARKS } from '../data/dialogue'
import { LEVEL_1_1 } from '../data/levels/level-1-1'
import { LEVEL_1_3 } from '../data/levels/level-1-3'
import { LEVEL_1_4 } from '../data/levels/level-1-4'
import type { AreaDef } from '../data/levels/types'
import { createDefaultTuning } from '../data/tuning'
import { updateBarks } from './barks'
import { lightLamps, teleportToArea } from './cheats'
import { lightLamp } from './fog'
import { buildLevel, validateLevel } from './level'
import { interactTarget, openChest } from './pickups'
import { createProfile, settleRun } from './profile'
import { radarTarget } from './radar'
import { challengesOf, levelChallenges, rateRun } from './rating'
import { stepWorld } from './step'
import { runTallies } from './tallies'
import { levelFromAreas } from './testing'
import type { GameEvent, PlayerCommand } from './types'
import { createEnemy, createWorld, type World } from './world'

const DT = 1 / 60

function idle(world: World, patch: Partial<PlayerCommand> = {}): PlayerCommand {
  return { moveX: 0, moveY: 0, aimX: world.player.pos.x, aimY: world.player.pos.y - 1, fire: false, slot: null, interact: false, skill: null, ultimate: false, pitch: 0, jump: false, dash: false, melee: false, ...patch }
}

function place(world: World, x: number, y: number): void {
  world.player.pos = { x, y }
  world.player.prev = { x, y }
}

describe('radar signal', () => {
  it('points at the way out of the current area and goes quiet in the boss clearing', () => {
    const level = buildLevel(LEVEL_1_4)
    const world = createWorld(level, createDefaultTuning())
    const seen = level.areas.map((area) => {
      teleportToArea(world, area.index)
      stepWorld(world, idle(world), DT)
      return radarTarget(world)
    })
    for (let index = 0; index < 4; index++) {
      const target = seen[index]!
      expect(Math.floor(target.y)).toBe(level.areas[index].top)
      expect(level.areaOfRow[Math.floor(target.y) - 1]).toBe(index + 1)
    }
    expect(seen[4]).toBeNull()
    expect([seen[0]!.x, seen[1]!.x, seen[2]!.x, seen[3]!.x]).toEqual([19, 14, 12, 20])
  })

  it('stays off in levels without the tracking task', () => {
    const world = createWorld(buildLevel(LEVEL_1_3), createDefaultTuning())
    expect(world.level.waypoints.length).toBe(world.level.areas.length)
    expect(radarTarget(world)).toBeNull()
  })

  it('aims at the gap on the route to the exit when the edge has two gaps', () => {
    const level = levelFromAreas([
      { name: 'low', theme: 'forest', rows: ['#.###..#', '#......#', '#..P...#'] },
      { name: 'high', theme: 'forest', rows: ['####X###', '#.##...#', '#.##...#'] },
    ], { radar: true })
    expect(level.waypoints[0]).toEqual({ x: 6, y: 3.5 })
    expect(level.waypoints[1]).toEqual({ x: 4.5, y: 0.5 })
  })
})

describe('chest on top of a landmark', () => {
  const YARD = ['############', '#..........#', '#..........#', '#..........#', '#.....W....#', '#..........#', '#..........#', '#....P....X#', '############']

  function yard(at: [number, number], ladder: [number, number]) {
    const rows = [...YARD]
    rows[4] = '#..........#'
    rows[ladder[1]] = rows[ladder[1]].slice(0, ladder[0]) + 'W' + rows[ladder[1]].slice(ladder[0] + 1)
    const area: AreaDef = { name: 'camp', theme: 'forest', rows, landmarks: [{ id: 'ch1-sawmill', at }], perches: [{ at: ladder, on: 'ch1-sawmill' }] }
    return levelFromAreas([area])
  }

  it('rests the chest on the lumber pile and opens it from the ladder beside it', () => {
    const level = yard([1, 1], [6, 2])
    expect(validateLevel(level)).toEqual([])
    const chest = level.chests[0]
    expect(chest.perch).toEqual({ landmark: 0, x: 1 + 2.5 + 1.47, y: 1 + 2 - 0.2, height: 2.5 })
    const world = createWorld(level, createDefaultTuning())
    expect(world.chests[0].perch).toEqual(chest.perch)
    place(world, 6.5, 2.5)
    expect(interactTarget(world)).toMatchObject({ kind: 'chest' })
    stepWorld(world, idle(world, { interact: true }), DT)
    const drops = world.events.filter((event): event is Extract<GameEvent, { type: 'pickupDropped' }> => event.type === 'pickupDropped')
    expect(drops).toHaveLength(1)
    expect(world.pickups[0].from).toEqual({ x: chest.perch!.x, y: chest.perch!.y })
    expect(Math.hypot(world.pickups[0].pos.x - 6.5, world.pickups[0].pos.y - 2.5)).toBeLessThan(1.2)
  })

  it('turns the top of the pile with the landmark', () => {
    const level = yard([1, 1], [5, 3])
    const turned = levelFromAreas([
      {
        name: 'camp',
        theme: 'forest',
        rows: ['############', '#..........#', '#..........#', '#..........#', '#..........#', '#..........#', '#..W.......#', '#....P....X#', '############'],
        landmarks: [{ id: 'ch1-sawmill', at: [1, 1], facing: 90 }],
        perches: [{ at: [3, 6], on: 'ch1-sawmill' }],
      },
    ])
    expect(turned.chests[0].perch).toMatchObject({ x: 1 + 2 + 0.2, y: 1 + 2.5 + 1.47 })
    expect(validateLevel(turned)).toEqual([])
    expect(level.chests[0].perch?.height).toBe(2.5)
  })

  it('wants the ladder right beside the landmark and close to its top', () => {
    expect(validateLevel(yard([1, 1], [8, 2]))).toContain('weapon chest at 8,2 is not beside ch1-sawmill, so its ladder does not reach the top')
    expect(validateLevel(yard([1, 1], [2, 5]))).toContain('weapon chest at 2,5 is too far from the top of ch1-sawmill')
    expect(() =>
      levelFromAreas([{ name: 'camp', theme: 'forest', rows: YARD, perches: [{ at: [6, 4], on: 'ch1-sawmill' }] }]),
    ).toThrow(/not in the area or has no top/)
  })
})

describe('the rare chest behind the waterfall', () => {
  it('always gives the sniper rifle named in the level, plus a buff', () => {
    const world = createWorld(buildLevel(LEVEL_1_4), createDefaultTuning())
    const rare = world.chests.find((chest) => chest.tier === 'rare')!
    expect(rare.weapon).toBe('sniper')
    openChest(world, rare)
    const items = world.pickups.map((pickup) => pickup.item)
    expect(items).toContainEqual(expect.objectContaining({ type: 'weapon', weapon: 'sniper' }))
    expect(items.some((item) => item.type === 'buff')).toBe(true)
    expect(world.rewards.chests).toBeGreaterThan(0)
  })

  it('finds the hidden area as soon as Kai steps into the cave mouth', () => {
    const world = createWorld(buildLevel(LEVEL_1_4), createDefaultTuning())
    const secret = world.level.secrets[0]
    place(world, secret.column + 0.5, secret.row + 0.5)
    stepWorld(world, idle(world), DT)
    expect(world.events.find((event) => event.type === 'secretFound')).toMatchObject({ index: 0, landmark: null })
    expect(world.secrets).toEqual([true])
  })
})

describe('1-4 tallies and challenges', () => {
  it('counts three chests, the crayon drawing, the waterfall cave and the four fog lamps', () => {
    const world = createWorld(buildLevel(LEVEL_1_4), createDefaultTuning())
    expect(runTallies(world)).toEqual({
      chests: { done: 0, total: 3 },
      sheep: { done: 0, total: 0 },
      clues: { done: 0, total: 1 },
      secrets: { done: 0, total: 1 },
      targets: { done: 0, total: 0 },
      alarms: { done: 0, total: 0 },
      lamps: { done: 0, total: 4 },
      elites: { done: 0, total: 0 },
    })
    lightLamp(world, 1)
    expect(runTallies(world).lamps).toEqual({ done: 1, total: 4 })
  })

  it('adds the lamp challenge only where fog lamps stand, done when every lamp is lit by the end', () => {
    expect(levelChallenges(buildLevel(LEVEL_1_1))).toEqual(['flawless', 'sweep', 'secret'])
    expect(levelChallenges(buildLevel(LEVEL_1_3))).toEqual(['flawless', 'sweep', 'secret', 'stealth'])
    const level = buildLevel(LEVEL_1_4)
    expect(levelChallenges(level)).toEqual(['flawless', 'sweep', 'secret', 'lamps'])
    const world = createWorld(level, createDefaultTuning())
    lightLamps(world, 1)
    world.status = 'complete'
    expect(challengesOf(world).find((item) => item.id === 'lamps')?.done).toBe(false)
    lightLamps(world)
    expect(challengesOf(world).find((item) => item.id === 'lamps')?.done).toBe(true)
    world.status = 'playing'
    expect(challengesOf(world).find((item) => item.id === 'lamps')?.done).toBe(false)
  })

  it('pays 25 experience the first time every lamp is lit', () => {
    const world = createWorld(buildLevel(LEVEL_1_4), createDefaultTuning())
    lightLamps(world)
    world.status = 'complete'
    const profile = createProfile()
    const first = settleRun(profile, world, rateRun(world))
    expect(first.reward.lines).toContainEqual({ label: '挑战「点灯」', amount: 25 })
    expect(profile.records['1-4'].challenges).toContain('lamps')
    const again = settleRun(profile, world, rateRun(world))
    expect(again.reward.lines.some((line) => line.label === '挑战「点灯」')).toBe(false)
  })
})

describe('1-4 barks', () => {
  it('has Alo name the turret, Kai read the drawing and Captain Bolt cut in over the radio at the camp', () => {
    expect(BARKS['1-4'].map((bark) => [bark.id, bark.speaker, bark.trigger.on, bark.radio ?? false])).toEqual([
      ['turret', 'alo', 'sees', false],
      ['daddy', 'kai', 'clue', false],
      ['mom', 'bolt', 'enter', true],
    ])
    const world = createWorld(buildLevel(LEVEL_1_4), createDefaultTuning())
    teleportToArea(world, 3)
    stepWorld(world, idle(world), DT)
    const bark = world.events.find((event) => event.type === 'bark')
    expect(bark).toMatchObject({ id: 'mom', speaker: 'bolt', text: '妈，再收一片地就回家。你的腰好点没？', radio: true })
  })

  it('reads the crayon drawing out loud when Kai picks it up', () => {
    const world = createWorld(buildLevel(LEVEL_1_4), createDefaultTuning())
    const clue = world.clues.find((drop) => drop.clue === 'drawing')!
    place(world, clue.pos.x, clue.pos.y)
    stepWorld(world, idle(world), DT)
    expect(world.cluesFound).toEqual(['drawing'])
    expect(world.events.find((event) => event.type === 'bark')).toMatchObject({ id: 'daddy', speaker: 'kai', text: '……机器人哪来的爸爸。' })
  })

  it('only counts seeing a turret when the fog does not hide it', () => {
    const rows = ['##########', ...Array.from({ length: 12 }, () => '#........#'), '##########']
    rows[11] = '#...P....#'
    const sees = [{ id: 'gun', speaker: 'alo' as const, text: '炮塔', display: 'bar' as const, trigger: { on: 'sees' as const, kind: 'turret' as const, range: 10 } }]
    const look = (fog: boolean) => {
      const world = createWorld(levelFromAreas([{ name: 'woods', theme: 'forest', rows, ...(fog ? { fog: {} } : {}) }]), createDefaultTuning())
      world.enemies.push(createEnemy(world, 'turret', { x: 4.5, y: 3.5 }, 0))
      updateBarks(world, sees)
      return world.events.some((event) => event.type === 'bark')
    }
    expect(look(false)).toBe(true)
    expect(look(true)).toBe(false)
  })
})
