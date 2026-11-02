import { describe, expect, it } from 'vitest'
import { BATTLE_HOLD, TRACKS } from '../data/music'
import { createDefaultTuning } from '../data/tuning'
import { activateBoss } from '../sim/boss'
import { singleArea } from '../sim/testing'
import { createBoss, createEnemy, createWorld, type World } from '../sim/world'
import { createSoundtrackState, trackFor } from './soundtrack'

const FIELD = ['##############', '#............#', '#..P.........#', '#............#', '##############']

function setup(): World {
  return createWorld(singleArea(FIELD), createDefaultTuning())
}

function alert(world: World, count: number): void {
  for (let i = 0; i < count; i++) {
    const enemy = createEnemy(world, 'grunt', { x: 8.5 + i, y: 2.5 }, 0)
    enemy.aggro = true
    world.enemies.push(enemy)
  }
}

describe('soundtrack', () => {
  it('explores quietly, switches to battle music in a fight and holds it for a moment', () => {
    const world = setup()
    const state = createSoundtrackState()
    expect(trackFor(world, state)).toBe('explore')
    alert(world, 3)
    expect(trackFor(world, state)).toBe('battle')
    for (const enemy of world.enemies) enemy.hp = 0
    world.time += BATTLE_HOLD / 2
    expect(trackFor(world, state)).toBe('battle')
    world.time += BATTLE_HOLD
    expect(trackFor(world, state)).toBe('explore')
  })

  it('plays the boss theme once the boss wakes up and goes silent on death', () => {
    const world = setup()
    const state = createSoundtrackState()
    world.boss = createBoss(world, 'scarecrow', { x: 10.5, y: 2.5 }, 0)
    world.enemies.push(world.boss)
    expect(trackFor(world, state)).toBe('explore')
    activateBoss(world)
    expect(trackFor(world, state)).toBe('boss')
    world.status = 'dead'
    expect(trackFor(world, state)).toBeNull()
  })

  it('keeps every track playable', () => {
    for (const track of Object.values(TRACKS)) {
      expect(track.lead.length % 8).toBe(0)
      expect(track.lead.length / 8).toBe(track.chords.length)
      expect(track.bass).toHaveLength(8)
      for (const pattern of Object.values(track.drums)) expect(pattern).toHaveLength(16)
    }
  })
})
