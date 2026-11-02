import { describe, expect, it } from 'vitest'
import { createDefaultTuning } from '../data/tuning'
import { singleArea } from '../sim/testing'
import { createWorld } from '../sim/world'
import { spotOf } from './sfx'

describe('where sounds come from', () => {
  const world = createWorld(singleArea(['##########', '#P....m..#', '##########']), createDefaultTuning())
  const enemy = world.enemies[0]

  it('places enemy shots, windups and blasts where they happen, and the hero getting hit toward the attacker', () => {
    expect(spotOf({ type: 'enemyShot', x: 3, y: 4, z: 1, angle: 0, pitch: 0, weapon: 'rifle' }, world)).toEqual({ x: 3, y: 4, attenuate: true })
    expect(spotOf({ type: 'enemyWindup', id: enemy.id }, world)).toEqual({ x: enemy.pos.x, y: enemy.pos.y, attenuate: true })
    expect(spotOf({ type: 'blast', x: 5, y: 1, z: 0, radius: 2, source: 'bomber' }, world)).toEqual({ x: 5, y: 1, attenuate: true })
    expect(spotOf({ type: 'playerHit', x: 1, y: 1, damage: 10, absorbed: 0, fromX: 6, fromY: 1, knockback: 0 }, world)).toEqual({ x: 6, y: 1, attenuate: false })
  })

  it('keeps the hero own shots and hit confirmations in the middle', () => {
    expect(spotOf({ type: 'shot', x: 1, y: 1, z: 1, angle: 0, pitch: 0, weapon: 'blaster' }, world)).toBeNull()
    expect(spotOf({ type: 'enemyHit', id: enemy.id, x: 6, y: 1, z: 1, damage: 10, crit: false, kind: 'grunt' } as never, world)).toBeNull()
  })
})
