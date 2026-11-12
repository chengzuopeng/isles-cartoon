import { describe, expect, it } from 'vitest'
import { BOUNTIES, BOUNTY } from '../data/bounties'
import { LEVEL_1_1 } from '../data/levels/level-1-1'
import { LEVEL_1_2 } from '../data/levels/level-1-2'
import { createDefaultTuning } from '../data/tuning'
import { bountyPool, drawBoard, updateBounties } from './bounties'
import { killEnemy, spawnBlast } from './combat'
import { buildLevel } from './level'
import { boardOf, createProfile, settleRun } from './profile'
import { rateRun } from './rating'
import { stepWorld } from './step'
import { createLoadout } from './stats'
import { singleArea } from './testing'
import type { BountyId } from '../data/bounties'
import type { Enemy, MinionKind, PlayerCommand } from './types'
import { createEnemy, createWorld, type World } from './world'

const DT = 1 / 60
const FIELD = ['######################', '#....................#', '#....................#', '#..P.................#', '#....................#', '#....................#', '######################']

function setup(bounties: BountyId[], rows = FIELD): World {
  return createWorld(singleArea(rows, 'normal', { id: 'test' }), createDefaultTuning(), { bounties, loadout: createLoadout({}, [], 'shotgun') })
}

function add(world: World, kind: MinionKind, x: number, y: number): Enemy {
  const enemy = createEnemy(world, kind, { x, y }, 0)
  enemy.aggro = true
  enemy.alert = 'combat'
  world.enemies.push(enemy)
  return enemy
}

function command(world: World, patch: Partial<PlayerCommand> = {}): PlayerCommand {
  const { player } = world
  return { moveX: 0, moveY: 0, aimX: player.pos.x + 20, aimY: player.pos.y, pitch: 0, fire: false, slot: null, interact: false, skill: null, ultimate: false, jump: false, dash: false, melee: false, ...patch }
}

function step(world: World, patch: Partial<PlayerCommand> = {}): void {
  stepWorld(world, command(world, patch), DT)
}

const progress = (world: World, id: BountyId) => world.bounties.find((item) => item.id === id)

describe('the bounty board', () => {
  it('only offers bounties a level can fulfil', () => {
    const outskirts = bountyPool(buildLevel(LEVEL_1_1), false)
    expect(outskirts).toContain('kegs')
    expect(outskirts).toContain('streak')
    expect(outskirts).not.toContain('defuse')
    expect(outskirts).not.toContain('pens')
    expect(outskirts).not.toContain('elite')
    expect(outskirts).not.toContain('courier')
    expect(bountyPool(buildLevel(LEVEL_1_1), true)).toContain('elite')
    const ranch = bountyPool(buildLevel(LEVEL_1_2), false)
    for (const id of ['friendly', 'defuse', 'pens', 'shepherd', 'kegs'] as const) expect(ranch).toContain(id)
  })

  it('pins three different bounties, the same ones for the same seed', () => {
    const level = buildLevel(LEVEL_1_2)
    const board = drawBoard(level, false, 42)
    expect(board).toHaveLength(BOUNTY.board)
    expect(new Set(board).size).toBe(BOUNTY.board)
    expect(drawBoard(level, false, 42)).toEqual(board)
  })

  it('keeps a level board in the save until the level is cleared', () => {
    const profile = createProfile()
    const level = buildLevel(LEVEL_1_2)
    const board = boardOf(profile, level, false)
    expect(boardOf(profile, level, false)).toEqual(board)
    const world = createWorld(level, createDefaultTuning(), { bounties: board })
    world.bounties[0].done = true
    world.status = 'complete'
    const settlement = settleRun(profile, world, rateRun(world))
    expect(settlement.bountiesDone).toEqual([board[0]])
    expect(settlement.reward.lines.some((line) => line.label === `悬赏「${BOUNTIES[board[0]].name}」`)).toBe(true)
    expect(profile.bounties).toBe(1)
    expect(profile.boards['1-2']).toBeUndefined()
  })
})

describe('tracking bounties in a run', () => {
  it('counts sneak smashes, smashes, crit kills, airborne kills and fuse kills', () => {
    const world = setup(['sneak', 'smash', 'crits', 'airborne', 'defuse'])
    const guard = createEnemy(world, 'grunt', { x: 4.6, y: 3.5 }, 0)
    guard.facing = 0
    world.enemies.push(guard)
    step(world, { melee: true })
    expect(progress(world, 'sneak')?.count).toBe(1)
    expect(progress(world, 'smash')?.count).toBe(1)
    world.events.length = 0
    killEnemy(world, add(world, 'gunner', 12, 5), true, true, true, 1, 0, true)
    updateBounties(world, world.events.splice(0))
    expect(progress(world, 'crits')?.count).toBe(1)
    world.player.grounded = false
    killEnemy(world, add(world, 'grunt', 14, 5), true)
    updateBounties(world, world.events.splice(0))
    expect(progress(world, 'airborne')?.count).toBe(1)
    world.player.grounded = true
    const bomber = add(world, 'bomber', 16, 2)
    bomber.state = 'ignite'
    killEnemy(world, bomber, true)
    updateBounties(world, world.events.splice(0))
    expect(progress(world, 'defuse')?.count).toBe(1)
  })

  it('counts robots blown up by their own side and by powder kegs', () => {
    const world = setup(['friendly', 'kegs'])
    add(world, 'grunt', 12, 3.5)
    spawnBlast(world, { x: 12, y: 3.5, radius: 2, delay: 0, playerDamage: 0, enemyDamage: 999, source: 'bomber', ownerId: 0 })
    step(world)
    expect(progress(world, 'friendly')?.count).toBe(1)
    add(world, 'grunt', 15, 3.5)
    spawnBlast(world, { x: 15, y: 3.5, radius: 2, delay: 0, playerDamage: 0, enemyDamage: 999, source: 'keg', ownerId: 0 })
    step(world)
    expect(progress(world, 'kegs')?.count).toBe(1)
  })

  it('fails thrifty the moment a special weapon fires and grants it at the exit otherwise', () => {
    const spent = setup(['thrifty'])
    step(spent, { slot: 'special' })
    step(spent, { fire: true })
    expect(progress(spent, 'thrifty')?.failed).toBe(true)
    const kept = setup(['thrifty'])
    step(kept, { fire: true })
    expect(progress(kept, 'thrifty')?.done).toBe(false)
    kept.status = 'complete'
    updateBounties(kept, [])
    expect(progress(kept, 'thrifty')?.done).toBe(true)
  })

  it('times an area from entry to the last robot down', () => {
    const world = setup(['speed'])
    const grunt = add(world, 'grunt', 12, 3.5)
    world.level.enemies.push({ kind: 'grunt', x: 12, y: 3.5, area: 0, idle: 'guard', route: [], affixes: [] })
    step(world)
    grunt.hp = 0
    step(world)
    expect(progress(world, 'speed')?.done).toBe(true)
  })
})
