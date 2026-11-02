import { describe, expect, it } from 'vitest'
import { ATTACK_TIPS } from '../data/attacks'
import { BLADE } from '../data/blades'
import type { BladeDef } from '../data/levels/types'
import { createDefaultTuning } from '../data/tuning'
import { attackLabel } from '../ui/attack-names'
import { forecastBlade } from './blades'
import { validateLevel } from './level'
import { stepWorld } from './step'
import { levelFromAreas } from './testing'
import type { GameEvent, PlayerCommand } from './types'
import { createEnemy, createWorld, type World } from './world'

const DT = 1 / 60
const WEAPONS = createDefaultTuning().weapons
const FIELD = [
  '##############################',
  '#...........................X#',
  '#..........P.................#',
  '#............................#',
  '#,,,,,,,,,,,,,,,,,,,,,,,,,,,,#',
  '#,,,,,,,,,,,,,,,,,,,,,,,,,,,,#',
  '#............................#',
  '#............................#',
  '##############################',
]

function field(blades: BladeDef[] = [{ from: [1, 4], to: [28, 5] }], rows = FIELD) {
  return levelFromAreas([{ name: 'field', theme: 'farm', rows, blades }])
}

function idle(world: World): PlayerCommand {
  return { moveX: 0, moveY: 0, aimX: world.player.pos.x, aimY: world.player.pos.y - 1, fire: false, slot: null, interact: false, skill: null, ultimate: false, pitch: 0, jump: false, dash: false, melee: false }
}

function run(world: World, seconds: number, seen: GameEvent[] = []): GameEvent[] {
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) {
    stepWorld(world, idle(world), DT)
    for (const event of world.events) seen.push(event)
    world.events.length = 0
  }
  return seen
}

function place(world: World, x: number, y: number): void {
  world.player.pos = { x, y }
  world.player.prev = { x, y }
}

describe('blade lanes', () => {
  it('turns the two corners of a lane into a sweep along its long side, from the first corner', () => {
    const level = field([
      { from: [1, 4], to: [28, 5] },
      { from: [28, 1], to: [1, 2], speed: 9, rest: 1.2, delay: 0.5 },
    ])
    expect(level.blades[0]).toMatchObject({ axis: 'x', from: { x: 1.5, y: 5 }, to: { x: 28.5, y: 5 }, half: 1, reach: BLADE.length / 2 })
    expect(level.blades[0]).toMatchObject({ speed: BLADE.speed, rest: BLADE.rest, warning: BLADE.warning, delay: BLADE.delay, column: 1, width: 28, depth: 2 })
    expect(level.blades[1]).toMatchObject({ from: { x: 28.5, y: 2 }, to: { x: 1.5, y: 2 }, speed: 9, rest: 1.2, warning: 0.9, delay: 0.5 })
    const upright = levelFromAreas([{ name: 'field', theme: 'farm', rows: FIELD, blades: [{ from: [5, 7], to: [6, 1] }] }])
    expect(upright.blades[0]).toMatchObject({ axis: 'y', from: { x: 6, y: 7.5 }, to: { x: 6, y: 1.5 } })
    expect(() => field([{ from: [1, 4], to: [2, 5] }])).toThrow(/as wide as it is long/)
  })

  it('wants every lane clear, inside its area, apart from the others and free of things standing in it', () => {
    expect(validateLevel(field())).toEqual([])
    const rows = [...FIELD]
    rows[4] = '#,,,,,,,o,,,,,,,,,,,,,,,,,,,,#'
    rows[5] = '#,,,,,,,,,,,,,,m,,,,,,,,,,,,,#'
    const blocked = validateLevel(field([{ from: [1, 4], to: [28, 5] }], rows))
    expect(blocked).toContain('blade lane at 1,4 is blocked at 8,4')
    expect(blocked).toContain('blade lane at 1,4 runs over the grunt at 15,5')
    const crossed = validateLevel(field([{ from: [1, 4], to: [28, 5] }, { from: [3, 1], to: [4, 7] }]))
    expect(crossed).toContain('blade lane at 1,4 crosses another blade lane')
  })

  it('rests, lights its warning, sweeps to the far end and back, again and again', () => {
    const world = createWorld(field([{ from: [1, 4], to: [28, 5] }, { from: [1, 1], to: [28, 2], delay: 2 }]), createDefaultTuning())
    place(world, 14.5, 7.5)
    const blade = world.blades[0]
    expect(blade).toMatchObject({ phase: 'rest', pos: { x: 1.5, y: 5 }, facing: 0, forward: true, warning: 0 })
    const events = run(world, 0.8)
    expect(blade.phase).toBe('warning')
    expect(blade.warning).toBeCloseTo(BLADE.warning - (0.8 - (BLADE.rest - BLADE.warning)), 1)
    expect(events.filter((event) => event.type === 'bladeWarning').map((event) => event.type === 'bladeWarning' && event.index)).toEqual([0])
    run(world, 1)
    expect(blade.phase).toBe('sweep')
    expect(blade.warning).toBe(0)
    expect(blade.pos.x).toBeCloseTo(1.5 + BLADE.speed * (1.8 - BLADE.rest), 1)
    const sweep = 27 / BLADE.speed
    const parked = run(world, BLADE.rest + sweep - 1.8 + 0.1).filter((event) => event.type === 'bladeParked' && event.index === 0)
    expect(parked).toHaveLength(1)
    expect(blade).toMatchObject({ phase: 'rest', pos: { x: 28.5, y: 5 }, forward: false })
    expect(blade.facing).toBeCloseTo(Math.PI, 5)
    run(world, BLADE.rest + 1)
    expect(blade.phase).toBe('sweep')
    expect(blade.pos.x).toBeLessThan(28.5)
    const late = world.blades[1]
    expect(late).toMatchObject({ pos: { x: 28.5, y: 2 }, forward: false })
    expect(late.phase).not.toBe('sweep')
  })

  it('cuts the player once as it sweeps by and pushes them out to the nearer side of the lane', () => {
    const world = createWorld(field(), createDefaultTuning())
    place(world, 10.5, 4.6)
    const events = run(world, BLADE.rest + 9.5 / BLADE.speed + 0.4)
    const hits = events.filter((event) => event.type === 'bladeHit')
    expect(hits).toEqual([expect.objectContaining({ index: 0, id: world.player.id, damage: BLADE.damage })])
    expect(world.player.hp).toBe(world.player.maxHp - BLADE.damage)
    expect(world.player.pos.y).toBeLessThan(4)
    expect(world.stats.taken).toEqual([{ attack: { by: null, cause: 'blade', elite: false, boss: null }, damage: BLADE.damage, hits: 1 }])
  })

  it('leaves a player alone while it rests, and only counts one hit per pass', () => {
    const world = createWorld(field(), createDefaultTuning())
    place(world, 2.5, 5)
    run(world, BLADE.rest - 0.05)
    expect(world.player.hp).toBe(world.player.maxHp)
    const events = run(world, 0.6)
    expect(events.filter((event) => event.type === 'bladeHit')).toHaveLength(1)
  })

  it('cannot cut a player in the middle of a roll, and the pass is spent on the dodge', () => {
    const world = createWorld(field(), createDefaultTuning())
    place(world, 6.5, 5)
    run(world, BLADE.rest + 3 / BLADE.speed)
    world.player.invulnerable = 0.3
    const events = run(world, 0.6)
    expect(events.some((event) => event.type === 'dodged')).toBe(true)
    expect(events.some((event) => event.type === 'bladeHit')).toBe(true)
    expect(world.player.hp).toBe(world.player.maxHp)
  })

  it("cuts enemies as well, and the kill is the player's", () => {
    const tuning = createDefaultTuning()
    tuning.perception.ambushRadius = 4.5
    const world = createWorld(field(), tuning)
    place(world, 14.5, 1.5)
    const bomber = createEnemy(world, 'bomber', { x: 8.5, y: 5 }, 0, { idle: 'ambush' })
    const grunt = createEnemy(world, 'grunt', { x: 20.5, y: 4.4 }, 0, { idle: 'ambush' })
    world.enemies.push(bomber, grunt)
    const events = run(world, BLADE.rest + 20 / BLADE.speed + 0.3)
    expect(events.some((event) => event.type === 'enemyKilled' && event.id === bomber.id)).toBe(true)
    expect(world.stats.kills).toBe(1)
    expect(world.rewards.kills).toBeGreaterThan(0)
    expect(grunt.hp).toBe(grunt.maxHp - BLADE.damage)
    expect(grunt.pos.y).toBeLessThan(4)
    expect(grunt.aggro).toBe(true)
  })

  it('names the blade on the death screen and tells the player how to get past', () => {
    const world = createWorld(field(), createDefaultTuning())
    place(world, 3.5, 5)
    world.player.hp = 50
    run(world, BLADE.rest + 0.5)
    expect(world.status).toBe('dead')
    expect(attackLabel(world.stats.killedBy!, WEAPONS)).toBe('收割刀片')
    expect(ATTACK_TIPS.blade).toBe('等红线消失、刀片扫过去再穿过收割道')
  })

  it('forecasts where the blade will be and whether it is sweeping, matching the simulation', () => {
    const level = field([{ from: [28, 4], to: [1, 5], speed: 9, rest: 1.2, delay: 0.5 }])
    const probe = createWorld(level, createDefaultTuning())
    place(probe, 14.5, 1.5)
    run(probe, 0.9)
    const lane = level.blades[0]
    const state = { ...probe.blades[0], pos: { ...probe.blades[0].pos } }
    for (let t = 0.37; t <= 14; t += 0.5) {
      const world = createWorld(level, createDefaultTuning())
      place(world, 14.5, 1.5)
      run(world, 0.9 + t)
      const ahead = forecastBlade(lane, state, t)
      expect(ahead.along, `t=${t}`).toBeCloseTo(world.blades[0].pos.x, 1)
      expect(ahead.sweeping, `t=${t}`).toBe(world.blades[0].phase === 'sweep')
    }
  })
})
