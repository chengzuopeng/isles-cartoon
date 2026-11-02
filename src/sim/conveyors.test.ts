import { describe, expect, it } from 'vitest'
import { getBoss } from '../data/bosses'
import { CONVEYOR } from '../data/conveyors'
import { createDefaultTuning } from '../data/tuning'
import { activateBoss } from './boss'
import { beltAt } from './conveyors'
import { stepWorld } from './step'
import { levelFromAreas, singleArea } from './testing'
import type { PlayerCommand } from './types'
import { createEnemy, createWorld, type World } from './world'

const DT = 1 / 60
const HALL = [
  '##################',
  '#...............X#',
  '#................#',
  '#.>>>>>>>>>>>>>..#',
  '#.>>>>>>>>>>>>>..#',
  '#................#',
  '#.....P..........#',
  '##################',
]

function idle(world: World, moveX = 0, moveY = 0): PlayerCommand {
  return { moveX, moveY, aimX: world.player.pos.x, aimY: world.player.pos.y - 1, fire: false, slot: null, interact: false, skill: null, ultimate: false, pitch: 0, jump: false, dash: false, melee: false }
}

function run(world: World, seconds: number, moveX = 0, moveY = 0): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    stepWorld(world, idle(world, moveX, moveY), DT)
    world.events.length = 0
  }
}

describe('conveyors outside boss fights', () => {
  it('keep running and carry the player along at the belt speed', () => {
    const world = createWorld(singleArea(HALL), createDefaultTuning())
    world.player.pos = { x: 4.5, y: 3.5 }
    world.player.prev = { x: 4.5, y: 3.5 }
    expect(beltAt(world, world.player.pos)).toEqual({ x: 1, y: 0 })
    run(world, 1)
    expect(world.player.pos.x).toBeCloseTo(4.5 + CONVEYOR.speed, 1)
    expect(world.player.pos.y).toBeCloseTo(3.5, 5)
    expect(CONVEYOR.speed).toBe(getBoss('harvester').hazards.conveyorSpeed)
  })

  it('add to walking with the belt and slow walking against it', () => {
    const along = createWorld(singleArea(HALL), createDefaultTuning())
    along.player.pos = { x: 3.5, y: 4.5 }
    run(along, 0.5, 1, 0)
    const against = createWorld(singleArea(HALL), createDefaultTuning())
    against.player.pos = { x: 14.5, y: 4.5 }
    run(against, 0.5, -1, 0)
    const speed = along.playerStats.speed
    expect(along.player.pos.x - 3.5).toBeCloseTo((speed + CONVEYOR.speed) * 0.5, 1)
    expect(14.5 - against.player.pos.x).toBeCloseTo((speed - CONVEYOR.speed) * 0.5, 1)
  })

  it('leave a rolling player and the enemies standing on them alone', () => {
    const tuning = createDefaultTuning()
    tuning.perception.ambushRadius = 4.5
    const world = createWorld(singleArea(HALL), tuning)
    world.player.pos = { x: 4.5, y: 3.5 }
    world.player.rollTime = 0.5
    world.player.rollSpeed = 0
    const grunt = createEnemy(world, 'grunt', { x: 9.5, y: 4.5 }, 0, { idle: 'ambush' })
    world.enemies.push(grunt)
    run(world, 0.3)
    expect(world.player.pos.x).toBeCloseTo(4.5, 5)
    expect(grunt.pos.x).toBeCloseTo(9.5, 5)
  })

  it('stay with the boss in a boss arena: off until the harvester turns them on', () => {
    const arena = levelFromAreas(
      [
        { name: 'gate', theme: 'meadow', rows: ['#...................#', '#.........P.........#', '#####################'] },
        {
          name: 'factory',
          theme: 'factory',
          kind: 'boss',
          rows: [
            '#########DDD#########',
            '#^.................v#',
            '#^......S..........v#',
            '#^........B........v#',
            '#^.................v#',
            '#^.........S.......v#',
            '#########DDD#########',
          ],
        },
        { name: 'exit', theme: 'meadow', rows: ['#####################', '#........XXX........#', '#...................#'] },
      ],
      { bossId: 'harvester' },
    )
    const world = createWorld(arena, createDefaultTuning(), { debug: { invincible: true } })
    activateBoss(world)
    world.player.pos = { x: 1.5, y: 7.5 }
    expect(beltAt(world, world.player.pos)).toBeNull()
    run(world, 0.5)
    expect(world.player.pos.y).toBeCloseTo(7.5, 1)
  })
})
