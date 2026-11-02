import { describe, expect, it } from 'vitest'
import { INTERACT_NEAR, INTERACT_RANGE } from '../data/loot'
import { createDefaultTuning } from '../data/tuning'
import { interactTarget } from './pickups'
import { singleArea } from './testing'
import { createWorld } from './world'

describe('interacting in first person', () => {
  const setup = () => createWorld(singleArea(['##########', '#...$....#', '#........#', '#P.......#', '##########']), createDefaultTuning())

  it('opens the chest the crosshair points at from up to two metres away', () => {
    const world = setup()
    const chest = world.chests[0]
    world.player.pos = { x: chest.pos.x - 1.2, y: chest.pos.y + 1.2 }
    world.player.facing = Math.atan2(chest.pos.y - world.player.pos.y, chest.pos.x - world.player.pos.x)
    expect(Math.hypot(chest.pos.x - world.player.pos.x, chest.pos.y - world.player.pos.y)).toBeLessThan(INTERACT_RANGE)
    expect(interactTarget(world)?.kind).toBe('chest')
    world.player.facing += Math.PI
    expect(interactTarget(world)).toBeNull()
  })

  it('takes whatever stands right next to the hero even without aiming at it', () => {
    const world = setup()
    const chest = world.chests[0]
    world.player.pos = { x: chest.pos.x, y: chest.pos.y + INTERACT_NEAR - 0.1 }
    world.player.facing = Math.PI / 2
    expect(interactTarget(world)?.kind).toBe('chest')
  })
})
