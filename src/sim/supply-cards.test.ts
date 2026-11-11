import { describe, expect, it } from 'vitest'
import { CARD, CARD_ORDER } from '../data/supply-cards'
import { createDefaultTuning } from '../data/tuning'
import { createAutopilot } from './autopilot'
import { takeCard } from './pickups'
import { stepWorld } from './step'
import { createLoadout } from './stats'
import { singleArea } from './testing'
import type { GameEvent, PlayerCommand } from './types'
import { createWorld, type World } from './world'

const DT = 1 / 60
const ROWS = ['############', '#..........#', '#.P+.......#', '#..........#', '############']

function setup(badges: ('apprentice')[] = []): World {
  return createWorld(singleArea(ROWS), createDefaultTuning(), { loadout: createLoadout({}, [], null, badges) })
}

function command(world: World, patch: Partial<PlayerCommand> = {}): PlayerCommand {
  const { player } = world
  return { moveX: 0, moveY: 0, aimX: player.pos.x + 20, aimY: player.pos.y, pitch: 0, fire: false, slot: null, interact: false, skill: null, ultimate: false, jump: false, dash: false, melee: false, ...patch }
}

function run(world: World, seconds: number, patch: Partial<PlayerCommand> = {}): GameEvent[] {
  const events: GameEvent[] = []
  for (let i = 0; i < Math.max(1, Math.round(seconds / DT)); i++) {
    stepWorld(world, command(world, patch), DT)
    events.push(...world.events)
    world.events.length = 0
  }
  return events
}

describe('supply cards', () => {
  it('offer three different cards at a supply point, even at full health', () => {
    const world = setup()
    const events = run(world, 0.5, { moveX: 1 })
    expect(events.some((event) => event.type === 'supplyUsed')).toBe(true)
    expect(world.offer).toHaveLength(CARD.offer)
    expect(new Set(world.offer).size).toBe(CARD.offer)
  })

  it('offer four with the apprentice hunter badge', () => {
    const world = setup(['apprentice'])
    run(world, 0.5, { moveX: 1 })
    expect(world.offer).toHaveLength(CARD.apprenticeOffer)
  })

  it('keep the picked card for the rest of the level and close the offer', () => {
    const world = setup()
    run(world, 0.5, { moveX: 1 })
    const card = world.offer![1]
    const events = run(world, DT, { pick: 1 })
    expect(world.offer).toBeNull()
    expect(world.cards).toEqual([card])
    expect(events.some((event) => event.type === 'cardTaken' && event.card === card)).toBe(true)
  })

  it('apply each card to the hero', () => {
    for (const card of CARD_ORDER) {
      const world = setup()
      run(world, DT)
      const before = { ...world.playerStats }
      world.offer = [card]
      expect(takeCard(world, 0)).toBe(true)
      run(world, DT)
      const after = world.playerStats
      if (card === 'might') expect(after.damage).toBeCloseTo(before.damage * (1 + CARD.might), 5)
      if (card === 'frenzy') expect(after.fireInterval).toBeCloseTo(before.fireInterval / (1 + CARD.frenzy), 5)
      if (card === 'swift') expect(after.speed).toBeCloseTo(before.speed * (1 + CARD.swift), 5)
      if (card === 'charge') expect(after.reload).toBeCloseTo(before.reload / (1 + CARD.charge), 5)
      if (card === 'shield') expect(world.player.armor).toBe(CARD.shieldAmount)
    }
  })

  it('let the shield card refill its shield every thirty seconds', () => {
    const world = setup()
    world.offer = ['shield']
    takeCard(world, 0)
    world.player.armor = 0
    run(world, CARD.shieldEvery + 0.1)
    expect(world.player.armor).toBe(CARD.shieldAmount)
  })

  it('get picked by the autopilot in its fixed order', () => {
    const world = setup()
    world.offer = ['shield', 'leech', 'swift']
    const pilot = createAutopilot()
    stepWorld(world, pilot.next(world), DT)
    expect(world.cards).toEqual(['leech'])
  })
})
