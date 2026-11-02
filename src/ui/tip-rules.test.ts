import { describe, expect, it } from 'vitest'
import { LEVEL_1_2 } from '../data/levels/level-1-2'
import { LEVEL_1_3 } from '../data/levels/level-1-3'
import { LEVEL_1_4 } from '../data/levels/level-1-4'
import { LEVEL_1_5 } from '../data/levels/level-1-5'
import { TRIAL_HARVESTER } from '../data/levels/trial-harvester'
import { createDefaultTuning } from '../data/tuning'
import { breakTargets, lightLamps, openPens } from '../sim/cheats'
import { buildLevel } from '../sim/level'
import { penDoorway, spawnPickup, weaponItem } from '../sim/pickups'
import { stepWorld } from '../sim/step'
import { singleArea } from '../sim/testing'
import type { GameEvent, PlayerCommand } from '../sim/types'
import { createEnemy, createWorld, type World } from '../sim/world'
import { tipForEvent, tipsForState } from './tip-rules'

const FIELD = [
  '##############',
  '#............#',
  '#..P....."".$#',
  '#........""..#',
  '##############',
]

function idle(world: World): PlayerCommand {
  const { pos } = world.player
  return {
    moveX: 0,
    moveY: 0,
    aimX: pos.x + 1,
    aimY: pos.y,
    pitch: 0,
    fire: false,
    slot: null,
    interact: false,
    skill: null,
    ultimate: false,
    jump: false,
    dash: false,
    melee: false,
  }
}

function setup(): World {
  return createWorld(singleArea(FIELD), createDefaultTuning())
}

describe('tip rules', () => {
  it('teaches the controls at the start of a run and nothing else far from things', () => {
    const world = setup()
    expect(tipsForState(world)).toEqual(['controls'])
    for (let i = 0; i < 90; i++) stepWorld(world, idle(world), 1 / 60)
    expect(tipsForState(world)).toEqual([])
  })

  it('points out chests, weapons on the ground and bushes when the player is next to them', () => {
    const world = setup()
    for (let i = 0; i < 90; i++) stepWorld(world, idle(world), 1 / 60)
    world.player.pos = { x: 9.5, y: 2.5 }
    expect(tipsForState(world)).toEqual(expect.arrayContaining(['chest', 'bush']))
    spawnPickup(world, weaponItem(world), 9.5, 1.5, { scatter: false })
    expect(tipsForState(world)).toContain('weapon')
  })

  it('reacts to the ultimate, buffs and newly alerted enemy kinds', () => {
    const world = setup()
    expect(tipForEvent(world, { type: 'ultimateReady' })).toBe('ultimate')
    const buff = { type: 'pickedUp', item: { type: 'buff', buff: 'frenzy' }, x: 0, y: 0, amount: 0 } as const
    expect(tipForEvent(world, buff)).toBe('buff')
    const shield = createEnemy(world, 'shield', { x: 6.5, y: 1.5 }, 0)
    const elite = createEnemy(world, 'grunt', { x: 6.5, y: 3.5 }, 0, { affixes: ['tough'] })
    world.enemies.push(shield, elite)
    expect(tipForEvent(world, { type: 'enemyAlerted', id: shield.id, x: 0, y: 0 })).toBe('shield')
    expect(tipForEvent(world, { type: 'enemyAlerted', id: elite.id, x: 0, y: 0 })).toBe('elite')
    expect(tipForEvent(world, { type: 'areaLocked', index: 0 })).toBe('lock')
  })

  it('explains the sheep pen next to a closed gate and the loading yard while its gate is sealed', () => {
    const world = createWorld(buildLevel(LEVEL_1_2), createDefaultTuning())
    for (let i = 0; i < 90; i++) stepWorld(world, idle(world), 1 / 60)
    const pen = world.level.landmarks.find((item) => item.gate)
    if (!pen?.gate) throw new Error('no pen')
    world.player.pos = penDoorway(pen.gate)
    expect(tipsForState(world)).toContain('pen')
    openPens(world, pen.area)
    expect(tipsForState(world)).not.toContain('pen')
    const yard = world.level.areas.findIndex((area) => area.kind === 'destroy')
    expect(tipForEvent(world, { type: 'areaEntered', index: yard, name: '' })).toBe('destroy')
    expect(tipForEvent(world, { type: 'areaEntered', index: 0, name: '' })).toBeNull()
    breakTargets(world, yard)
    stepWorld(world, idle(world), 1 / 60)
    expect(tipForEvent(world, { type: 'areaEntered', index: yard, name: '' })).toBeNull()
  })

  it('explains hiding in the wheat on the way into the area with the bell, and the bell runner the first time one sets off', () => {
    const world = createWorld(buildLevel(LEVEL_1_3), createDefaultTuning())
    const field = world.level.alarms[0].area
    expect(tipForEvent(world, { type: 'areaEntered', index: field, name: '' })).toBe('stealth')
    expect(tipForEvent(world, { type: 'areaEntered', index: 0, name: '' })).toBeNull()
    expect(tipForEvent(world, { type: 'areaEntered', index: field + 1, name: '' })).toBeNull()
    expect(tipForEvent(world, { type: 'alarmRunner', alarm: 0, id: 1, x: 0, y: 0 })).toBe('alarmRunner')
    expect(tipForEvent(world, { type: 'alarmStopped', alarm: 0, id: 1, x: 0, y: 0 })).toBeNull()
  })

  it('explains the fog inside it, the fog lamp next to an unlit one and the turret the first time it is in sight', () => {
    const world = createWorld(buildLevel(LEVEL_1_4), createDefaultTuning())
    for (let i = 0; i < 90; i++) stepWorld(world, idle(world), 1 / 60)
    const [creek, woods] = world.level.areas
    const at = (area: typeof creek, column: number, row: number) => {
      world.player.pos = { x: column + 0.5, y: area.top + row + 0.5 }
      return tipsForState(world)
    }
    expect(at(creek, 19, 19)).not.toEqual(expect.arrayContaining(['fog']))
    expect(at(creek, 19, 19)).not.toContain('turret')
    expect(at(creek, 20, 10)).toContain('turret')
    expect(at(woods, 13, 14)).toContain('fog')
    const lamp = world.level.lamps[0]
    world.player.pos = { x: lamp.x + 1, y: lamp.y + 0.5 }
    expect(tipsForState(world)).toEqual(expect.arrayContaining(['lamp']))
    lightLamps(world, lamp.area)
    expect(tipsForState(world)).not.toContain('lamp')
    expect(tipsForState(world)).not.toContain('fog')
  })

  it('explains the blades the first time a red line lights up in the area the player is in', () => {
    const world = createWorld(buildLevel(LEVEL_1_5), createDefaultTuning(), { debug: { invincible: true } })
    let warning: GameEvent | null = null
    for (let i = 0; i < 120 && !warning; i++) {
      stepWorld(world, idle(world), 1 / 60)
      warning = world.events.find((event) => event.type === 'bladeWarning') ?? null
      world.events.length = 0
    }
    if (!warning || warning.type !== 'bladeWarning') throw new Error('no blade warned')
    expect(world.level.blades[warning.index].area).toBe(world.areaIndex)
    expect(tipForEvent(world, warning)).toBe('blade')
    world.areaIndex = 1
    expect(tipForEvent(world, warning)).toBeNull()
    expect(tipForEvent(world, { type: 'bladeSweep', index: 0, x: 0, y: 0, angle: 0 })).toBeNull()
  })

  it('explains the conveyor the first time the player stands on a running belt, but not on the boss arena belts', () => {
    const world = createWorld(buildLevel(LEVEL_1_5), createDefaultTuning())
    for (let i = 0; i < 90; i++) stepWorld(world, idle(world), 1 / 60)
    expect(tipsForState(world)).not.toContain('conveyor')
    const belt = world.level.conveyors.find((item) => world.level.areas[world.level.areaOfRow[Math.floor(item.index / world.grid.columns)]].kind !== 'boss')
    if (!belt) throw new Error('no running belt')
    world.player.pos = { x: (belt.index % world.grid.columns) + 0.5, y: Math.floor(belt.index / world.grid.columns) + 0.5 }
    expect(tipsForState(world)).toContain('conveyor')
    const trial = createWorld(buildLevel(TRIAL_HARVESTER), createDefaultTuning())
    for (let i = 0; i < 90; i++) stepWorld(trial, idle(trial), 1 / 60)
    const arena = trial.level.conveyors[0]
    trial.player.pos = { x: (arena.index % trial.grid.columns) + 0.5, y: Math.floor(arena.index / trial.grid.columns) + 0.5 }
    expect(tipsForState(trial)).not.toContain('conveyor')
  })

  it('tells the player to smash a robot in sight that is falling apart or dizzy', () => {
    const world = createWorld(singleArea(['#################', '#P.....#........#', '#...............#', '#################']), createDefaultTuning())
    const grunt = createEnemy(world, 'grunt', { x: 5.5, y: 2.5 }, 0)
    grunt.aggro = true
    world.enemies.push(grunt)
    expect(tipsForState(world)).not.toContain('melee')
    grunt.hp = grunt.maxHp * 0.2
    expect(tipsForState(world)).toContain('melee')
    grunt.hp = grunt.maxHp
    grunt.status.stunned = grunt.status.dazed = 0.5
    expect(tipsForState(world)).toContain('melee')
    grunt.pos = { x: 8.5, y: 1.5 }
    expect(tipsForState(world)).not.toContain('melee')
  })
})
