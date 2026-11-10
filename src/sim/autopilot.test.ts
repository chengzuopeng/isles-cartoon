import { describe, expect, it } from 'vitest'
import { AUTOPILOT, AUTOPILOT_SKILLS } from '../data/autopilot'
import { getBoss } from '../data/bosses'
import { WEAK_POINTS, eyeHeightOf } from '../data/heights'
import { LEVEL_1_1 } from '../data/levels/level-1-1'
import { LEVEL_1_3 } from '../data/levels/level-1-3'
import { LEVEL_1_4 } from '../data/levels/level-1-4'
import { LEVEL_1_5 } from '../data/levels/level-1-5'
import { createDefaultTuning } from '../data/tuning'
import { createAutopilot } from './autopilot'
import { teleportToBoss } from './cheats'
import { spawnBlast } from './combat'
import { floorAt } from './grid'
import { buildLevel } from './level'
import { spawnPickup } from './pickups'
import { stepWorld } from './step'
import { bodyHeight } from './terrain'
import { levelFromAreas, singleArea } from './testing'
import type { Enemy, Mine } from './types'
import { createWorld, type World } from './world'

const DT = 1 / 60
const LIMIT_SECONDS = 20 * 60

function eyeOf(world: World): number {
  return world.player.z + eyeHeightOf('player')
}

function chestPitch(world: World, enemy: Enemy): number {
  const { player } = world
  const flat = Math.hypot(enemy.pos.x - player.pos.x, enemy.pos.y - player.pos.y)
  return Math.atan2(enemy.z + bodyHeight(enemy) * AUTOPILOT.chestShare - eyeOf(world), flat)
}

describe('autopilot on level 1-1', () => {
  it('walks from the start to the exit through every lock and the boss when invincible', () => {
    const world = createWorld(buildLevel(LEVEL_1_1), createDefaultTuning(), { debug: { invincible: true } })
    const pilot = createAutopilot()
    const entered: string[] = []
    for (let step = 0; step < LIMIT_SECONDS / DT && world.status === 'playing'; step++) {
      stepWorld(world, pilot.next(world), DT)
      for (const event of world.events) if (event.type === 'areaEntered') entered.push(event.name)
      world.events.length = 0
    }
    expect(entered).toEqual(LEVEL_1_1.areas.map((area) => area.name))
    expect(world.boss?.hp).toBe(0)
    expect(world.areas.every((area) => area.status !== 'locked')).toBe(true)
    expect(world.status).toBe('complete')
  })

  it('detours to open a chest and grab a weapon before heading to the exit', () => {
    const level = singleArea(['##############', '#....W.......#', '#............#', '#P..........X#', '##############'])
    const world = createWorld(level, createDefaultTuning())
    const pilot = createAutopilot()
    for (let step = 0; step < 60 / DT && world.status === 'playing'; step++) {
      stepWorld(world, pilot.next(world), DT)
      world.events.length = 0
    }
    expect(world.status).toBe('complete')
    expect(world.chests[0].opened).toBe(true)
    expect(world.player.special).not.toBeNull()
  })
})

describe('autopilot on special tasks', () => {
  it('breaks every target to open a sealed destroy area, then leaves', () => {
    const level = levelFromAreas([
      { name: 'start', theme: 'meadow', rows: ['#............#', '#.....P......#', '#............#'] },
      {
        name: 'yard',
        theme: 'farm',
        kind: 'destroy',
        rows: ['######DD######', '#............#', '#............#', '#............#', '#............#', '#............#'],
        landmarks: [
          { id: 'ch1-hay-cart', at: [2, 1] },
          { id: 'ch1-hay-cart', at: [9, 1], facing: 90 },
        ],
      },
      { name: 'end', theme: 'meadow', rows: ['##############', '#.....XX.....#', '#............#'] },
    ])
    const world = createWorld(level, createDefaultTuning())
    const pilot = createAutopilot()
    for (let step = 0; step < 120 / DT && world.status === 'playing'; step++) {
      stepWorld(world, pilot.next(world), DT)
      world.events.length = 0
    }
    expect(world.landmarks.map((state) => state.broken)).toEqual([true, true])
    expect(world.areas[1].status).toBe('cleared')
    expect(world.status).toBe('complete')
  })

  it('looks past a chest walled in by crates to the supplies it needs', () => {
    const level = singleArea(['##############', '#.ccR#########', '#.c###########', '#X....P.....+#', '##############'])
    const world = createWorld(level, createDefaultTuning())
    world.player.hp = world.player.maxHp * 0.4
    const pilot = createAutopilot()
    for (let step = 0; step < 30 / DT && world.status === 'playing'; step++) {
      stepWorld(world, pilot.next(world), DT)
      world.events.length = 0
    }
    expect(world.supplies[0].used).toBe(true)
    expect(world.chests[0].opened).toBe(false)
    expect(world.status).toBe('complete')
  })
})

describe('human-like autopilot', () => {
  const ROOM = ['############', '#..........#', '#....P.....#', '#..........#', '############']

  function firstDodge(skill: 'perfect' | 'human', seed: number): number | null {
    const world = createWorld(singleArea(ROOM), createDefaultTuning(), { debug: { invincible: true } })
    const { pos } = world.player
    spawnBlast(world, {
      x: pos.x,
      y: pos.y,
      radius: 1.5,
      delay: 3,
      playerDamage: 100,
      enemyDamage: 0,
      source: 'bomber',
      ownerId: 0,
    })
    const pilot = createAutopilot({ skill, seed })
    const start = world.time
    for (let step = 0; step < 2 / DT; step++) {
      const command = pilot.next(world)
      if (command.moveX !== 0 || command.moveY !== 0) return world.time - start
      stepWorld(world, command, DT)
    }
    return null
  }

  it('waits for its reaction time before dodging a telegraph', () => {
    expect(firstDodge('perfect', 1)).toBe(0)
    const reactions = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => firstDodge('human', seed))
    for (const reaction of reactions) {
      if (reaction !== null) expect(reaction).toBeGreaterThanOrEqual(AUTOPILOT_SKILLS.human.reaction - 1e-9)
    }
    expect(reactions.some((reaction) => reaction !== null)).toBe(true)
  })
})

describe('aiming in three dimensions', () => {
  function range(target: string, heights?: string[]): World {
    const rows = ['##################', '#................#', `#P.......${target}.......#`, '#................#', '##################']
    return createWorld(levelFromAreas([{ name: 'range', theme: 'meadow', rows, heights }]), createDefaultTuning(), { debug: { invincible: true } })
  }

  it('pitches down at the chest of a short charger and up at a gunner on a ledge', () => {
    const low = range('m')
    const grunt = low.enemies[0]
    const down = createAutopilot().next(low)
    expect(down.pitch).toBeCloseTo(chestPitch(low, grunt), 3)
    expect(down.pitch).toBeLessThan(-0.05)

    const ledge = ['000000000000000000', '000000000333333333', '000000000333333333', '000000000333333333', '000000000000000000']
    const high = range('r', ledge)
    const gunner = high.enemies[0]
    expect(gunner.z).toBe(1.5)
    const up = createAutopilot().next(high)
    expect(up.pitch).toBeCloseTo(chestPitch(high, gunner), 3)
    expect(up.pitch).toBeGreaterThan(0.05)
  })

  it('lands its shots on a short charger it could not hit with a level gun', () => {
    const world = range('m')
    const pilot = createAutopilot()
    for (let step = 0; step < 4 / DT && world.enemies.some((enemy) => enemy.hp > 0); step++) {
      stepWorld(world, pilot.next(world), DT)
      world.events.length = 0
    }
    expect(world.stats.bulletsHit).toBeGreaterThan(0)
    expect(world.enemies.every((enemy) => enemy.hp <= 0)).toBe(true)
  })

  it('aims at the glowing weak point while the boss is exposed and at its chest otherwise', () => {
    const level = levelFromAreas(
      [
        { name: 'gate', theme: 'meadow', rows: ['#...................#', '#.........P.........#', '#####################'] },
        {
          name: 'arena',
          theme: 'arena',
          kind: 'boss',
          rows: ['#########DDD#########', '#...................#', '#.........B.........#', '#...................#', '#...................#', '#...................#', '#########DDD#########'],
        },
        { name: 'exit', theme: 'meadow', rows: ['#####################', '#.........X.........#', '#...................#'] },
      ],
      { bossId: 'scarecrow' },
    )
    const world = createWorld(level, createDefaultTuning(), { debug: { invincible: true } })
    const pilot = createAutopilot()
    const boss = world.boss!
    world.player.pos = { x: 10.5, y: 12.5 }
    world.player.prev = { ...world.player.pos }
    for (let step = 0; step < 30 && boss.boss?.phase === 'dormant'; step++) stepWorld(world, pilot.next(world), DT)
    const state = boss.boss!
    state.phase = 'walk'
    state.timer = 5
    boss.facing = Math.atan2(world.player.pos.y - boss.pos.y, world.player.pos.x - boss.pos.x)
    const walking = pilot.next(world)
    expect(walking.pitch).toBeCloseTo(chestPitch(world, boss), 3)
    state.phase = 'recover'
    const weak = WEAK_POINTS.scarecrow
    const x = boss.pos.x + Math.cos(boss.facing) * weak.forward
    const y = boss.pos.y + Math.sin(boss.facing) * weak.forward
    const exposed = pilot.next(world)
    const expected = Math.atan2(boss.z + weak.height - eyeOf(world), Math.hypot(x - world.player.pos.x, y - world.player.pos.y))
    expect(exposed.pitch).toBeCloseTo(expected, 3)
  })

  it('spreads its aim error over both yaw and pitch', () => {
    const world = range('t')
    const turret = world.enemies[0]
    const pilot = createAutopilot({ skill: 'human', seed: 3 })
    const ideal = chestPitch(world, turret)
    const pitches: number[] = []
    const yaws: number[] = []
    for (let sample = 0; sample < 40; sample++) {
      world.time += AUTOPILOT_SKILLS.human.aimHold
      const command = pilot.next(world)
      pitches.push(command.pitch - ideal)
      yaws.push(Math.atan2(command.aimY - world.player.pos.y, command.aimX - world.player.pos.x) - Math.atan2(turret.pos.y - world.player.pos.y, turret.pos.x - world.player.pos.x))
    }
    const limit = (AUTOPILOT_SKILLS.human.aimError * Math.PI) / 180 + 1e-6
    for (const offset of [...pitches, ...yaws]) expect(Math.abs(offset)).toBeLessThanOrEqual(limit)
    expect(Math.max(...pitches)).toBeGreaterThan(limit / 3)
    expect(Math.min(...pitches)).toBeLessThan(-limit / 3)
    expect(Math.max(...yaws)).toBeGreaterThan(limit / 3)
    expect(Math.min(...yaws)).toBeLessThan(-limit / 3)
  })
})

describe('autopilot on uneven ground', () => {
  function walk(rows: string[], heights: string[], seconds = 30): World {
    const world = createWorld(levelFromAreas([{ name: 'steps', theme: 'meadow', rows, heights }]), createDefaultTuning())
    const pilot = createAutopilot()
    for (let step = 0; step < seconds / DT && world.status === 'playing'; step++) {
      stepWorld(world, pilot.next(world), DT)
      world.events.length = 0
    }
    return world
  }

  it('jumps up a one-metre step it cannot walk up to reach the exit', () => {
    const world = walk(['##############', '#............#', '#P..........X#', '#............#', '##############'], ['00000000000000', '00000002222222', '00000002222222', '00000002222222', '00000000000000'])
    expect(world.status).toBe('complete')
    expect(world.stats.jumps).toBeGreaterThanOrEqual(1)
  })

  it('climbs a rock to get onto a ledge too high to jump from the ground', () => {
    const world = walk(['##############', '#............#', '#P.....o....X#', '#............#', '##############'], ['00000000000000', '00000000444440', '00000000444440', '00000000444440', '00000000000000'])
    expect(world.status).toBe('complete')
    expect(world.stats.jumps).toBeGreaterThanOrEqual(2)
  })

  it('drops off a ledge when the only way on is down', () => {
    const world = walk(['##############', '#............#', '#P..........X#', '#............#', '##############'], ['00000000000000', '04444440000000', '04444440000000', '04444440000000', '00000000000000'])
    expect(world.status).toBe('complete')
  })

  it('keeps out of a pit it could not climb back out of, even for a health pack lying in it', () => {
    const rows = ['################', '#..............#', '#P............X#', '#..............#', '#..............#', '################']
    const heights = ['0000000000000000', '0333333333333330', '0333333333333330', '0333333333333330', '0333300000333330', '0000000000000000']
    const world = createWorld(levelFromAreas([{ name: 'pit', theme: 'meadow', rows, heights }]), createDefaultTuning())
    world.player.hp = world.player.maxHp * 0.3
    spawnPickup(world, { type: 'heal', amount: 0.5 }, 7.5, 4.5, { persistent: true })
    const pilot = createAutopilot()
    let lowest = Infinity
    for (let step = 0; step < 30 / DT && world.status === 'playing'; step++) {
      stepWorld(world, pilot.next(world), DT)
      world.events.length = 0
      lowest = Math.min(lowest, floorAt(world.grid, world.player.pos.x, world.player.pos.y))
    }
    expect(world.status).toBe('complete')
    expect(lowest).toBe(1.5)
  })
})

describe('autopilot against the shockwave ring', () => {
  const ARENA = levelFromAreas(
    [
      { name: 'gate', theme: 'meadow', rows: ['#...................#', '#.........P.........#', '#####################'] },
      {
        name: 'arena',
        theme: 'arena',
        kind: 'boss',
        rows: [
          '#########DDD#########',
          '#...................#',
          '#...................#',
          '#.........B.........#',
          '#...................#',
          '#...................#',
          '#...................#',
          '#...................#',
          '#...................#',
          '#...................#',
          '#...................#',
          '#########DDD#########',
        ],
      },
      { name: 'exit', theme: 'meadow', rows: ['#####################', '#.........X.........#', '#...................#'] },
    ],
    { bossId: 'scarecrow' },
  )

  function slam(skill: 'perfect' | 'human', seed: number): { hit: boolean; jumped: boolean } {
    const world = createWorld(ARENA, createDefaultTuning(), { seed })
    world.player.pos = { x: 10.5, y: 12.5 }
    world.player.prev = { ...world.player.pos }
    const pilot = createAutopilot({ skill, seed })
    stepWorld(world, pilot.next(world), DT)
    const boss = world.boss!
    const state = boss.boss!
    state.order = ['slam']
    state.moveIndex = 0
    state.phase = 'walk'
    state.timer = 0
    let hit = false
    let jumped = false
    let rang = false
    const ring = getBoss('scarecrow').ring!
    for (let step = 0; step < 4 / DT && !(rang && world.rings.length === 0); step++) {
      const command = pilot.next(world)
      command.fire = false
      command.ultimate = false
      stepWorld(world, command, DT)
      if (world.rings.length > 0) rang = true
      for (const event of world.events) {
        if (event.type === 'playerHit' && world.player.hp < world.player.maxHp) hit = true
        if (event.type === 'jumped') jumped = true
      }
      world.events.length = 0
      if (state.phase === 'walk' && rang) state.timer = 10
    }
    expect(rang).toBe(true)
    expect(ring.height).toBeGreaterThan(0)
    return { hit, jumped }
  }

  it('jumps over the ring the scarecrow sends out instead of taking the hit', () => {
    for (const seed of [1, 2, 3]) {
      const result = slam('perfect', seed)
      expect(result.jumped, `seed ${seed}`).toBe(true)
      expect(result.hit, `seed ${seed}`).toBe(false)
    }
  })

  it('clears the ring most of the time on the human level', () => {
    const results = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => slam('human', seed))
    expect(results.filter((result) => !result.hit).length).toBeGreaterThanOrEqual(5)
  })
})

describe('autopilot up close', () => {
  it('runs in and smashes a dazed charger with the gun butt', () => {
    const world = createWorld(singleArea(['##############', '#............#', '#P...m.......#', '#............#', '##############']), createDefaultTuning(), { debug: { invincible: true } })
    const grunt = world.enemies[0]
    grunt.status.stunned = 2
    grunt.status.dazed = 2
    world.player.hp = world.player.maxHp * 0.5
    const pilot = createAutopilot()
    for (let step = 0; step < 2 / DT && world.stats.smashes === 0; step++) {
      const command = pilot.next(world)
      command.fire = false
      stepWorld(world, command, DT)
      world.events.length = 0
    }
    expect(world.stats.smashes).toBe(1)
    expect(grunt.hp).toBeLessThanOrEqual(0)
  })
})

describe('autopilot against shields', () => {
  it('baits the shield captain into the silos and beats it there', () => {
    const world = createWorld(buildLevel(LEVEL_1_3), createDefaultTuning(), { debug: { invincible: true } })
    for (const enemy of world.enemies) if (enemy.kind !== 'boss') enemy.hp = 0
    world.enemies = world.enemies.filter((enemy) => enemy.hp > 0)
    teleportToBoss(world)
    const pilot = createAutopilot({ siege: true })
    let stuns = 0
    let silos = 0
    for (let step = 0; step < 180 / DT && world.status === 'playing'; step++) {
      stepWorld(world, pilot.next(world), DT)
      for (const event of world.events) {
        if (event.type === 'bossStunned') stuns += 1
        if (event.type === 'landmarkCrashed') silos += 1
      }
      world.events.length = 0
    }
    expect(world.boss?.hp).toBe(0)
    expect(world.status).toBe('complete')
    expect(stuns).toBeGreaterThanOrEqual(1)
    expect(silos).toBeGreaterThanOrEqual(stuns)
  })

  it('circles round to the back of a lone shield bearer when asked to lay siege', () => {
    const room = singleArea([
      '##################',
      '#................#',
      '#................#',
      '#.......h........#',
      '#................#',
      '#................#',
      '#................#',
      '#.......P........#',
      '#................#',
      '#...............X#',
      '##################',
    ])
    const killTime = (siege: boolean) => {
      const world = createWorld(room, createDefaultTuning(), { debug: { invincible: true } })
      const pilot = createAutopilot({ siege })
      for (let step = 0; step < 120 / DT && world.enemies.length > 0; step++) {
        stepWorld(world, pilot.next(world), DT)
        world.events.length = 0
      }
      return world.enemies.length === 0 ? world.time : Infinity
    }
    expect(killTime(true)).toBeLessThan(30)
  })
})

describe('autopilot in the foggy woods', () => {
  const WOODS = [
    '####################',
    '#..................#',
    '#.........X........#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#.........P........#',
    '####################',
  ]
  const WIDE = WOODS.map((row) => `${row.slice(0, 1)}${'.'.repeat(12)}${row.slice(1)}`)

  function walk(lamp: [number, number]): World {
    const level = levelFromAreas([{ name: 'woods', theme: 'forest', fog: {}, rows: WIDE, landmarks: [{ id: 'ch1-fog-lamp', at: lamp }] }])
    const world = createWorld(level, createDefaultTuning())
    const pilot = createAutopilot()
    for (let step = 0; step < 60 / DT && world.status === 'playing'; step++) {
      stepWorld(world, pilot.next(world), DT)
      world.events.length = 0
    }
    return world
  }

  it('lights a fog lamp on its way and leaves one far off the path alone', () => {
    const near = walk([24, 6])
    expect(near.status).toBe('complete')
    expect(near.lamps).toEqual([true])
    const far = walk([1, 1])
    expect(far.status).toBe('complete')
    expect(far.lamps).toEqual([false])
  })

  function mined(spots: [number, number][]): World {
    const world = createWorld(singleArea(WOODS), createDefaultTuning(), { debug: { invincible: true } })
    const attack = { by: 'boss' as const, cause: 'tankMine' as const, elite: false, boss: 'forest-tank' }
    for (const [x, y] of spots) {
      const mine: Mine = { id: world.nextId++, pos: { x, y }, age: 1, fuse: -1, blast: -1, cause: null, owner: 'forest-tank', attack }
      world.mines.push(mine)
    }
    return world
  }

  it('walks round a mine lying on its way instead of stepping on it', () => {
    const world = mined([[10.5, 7.5]])
    const pilot = createAutopilot()
    let triggered = 0
    for (let step = 0; step < 60 / DT && world.status === 'playing'; step++) {
      stepWorld(world, pilot.next(world), DT)
      for (const event of world.events) if (event.type === 'mineTriggered' && event.fuse > 0) triggered += 1
      world.events.length = 0
    }
    expect(world.status).toBe('complete')
    expect(triggered).toBe(0)
    expect(world.stats.hits).toBe(0)
  })

  it('shoots a mine from a safe distance when it blocks the way', () => {
    const world = mined([[10.5, 6.5], [9.5, 6.5], [11.5, 6.5], [8.5, 6.5], [12.5, 6.5], [7.5, 6.5], [13.5, 6.5]])
    const pilot = createAutopilot()
    const shot: number[] = []
    for (let step = 0; step < 60 / DT && world.status === 'playing'; step++) {
      stepWorld(world, pilot.next(world), DT)
      for (const event of world.events) if (event.type === 'mineExploded' && event.cause === 'shot') shot.push(event.id)
      world.events.length = 0
    }
    expect(world.status).toBe('complete')
    expect(shot.length).toBeGreaterThan(0)
    expect(world.stats.hits).toBe(0)
  })
})

describe('autopilot against the forest tank', () => {
  it('baits the tank into the stumps, keeps clear of its triple cannon and beats it', () => {
    const world = createWorld(buildLevel(LEVEL_1_4), createDefaultTuning(), { debug: { invincible: true } })
    for (const enemy of world.enemies) if (enemy.kind !== 'boss') enemy.hp = 0
    world.enemies = world.enemies.filter((enemy) => enemy.hp > 0)
    teleportToBoss(world)
    const pilot = createAutopilot()
    let stuns = 0
    let stumps = 0
    let shells = 0
    let volleys = 0
    for (let step = 0; step < 180 / DT && world.status === 'playing'; step++) {
      stepWorld(world, pilot.next(world), DT)
      for (const event of world.events) {
        if (event.type === 'bossStunned') stuns += 1
        if (event.type === 'landmarkCrashed' && event.id === 'ch1-stump') stumps += 1
        if (event.type === 'tankShot' && event.barrel === 0) volleys += 1
      }
      world.events.length = 0
      shells = world.stats.taken.find((item) => item.attack.cause === 'tankShell')?.hits ?? 0
    }
    expect(world.boss?.hp).toBe(0)
    expect(world.status).toBe('complete')
    expect(stuns).toBeGreaterThanOrEqual(1)
    expect(stumps).toBeGreaterThanOrEqual(stuns)
    expect(volleys).toBeGreaterThanOrEqual(2)
    expect(shells).toBeLessThan(volleys)
  })
})

describe('autopilot in the harvest fields', () => {
  const FIELD = [
    '##############################',
    '#.............X..............#',
    '#............................#',
    '#""""""""""""""""""""""""""""#',
    '#,,,,,,,,,,,,,,,,,,,,,,,,,,,,#',
    '#,,,,,,,,,,,,,,,,,,,,,,,,,,,,#',
    '#""""""""""""""""""""""""""""#',
    '#............................#',
    '#.............P..............#',
    '##############################',
  ]

  it('waits beside a blade lane while the blade comes by, then crosses behind it', () => {
    let waited = 0
    let crossedWhileSweeping = 0
    for (const delay of [0, 0.4, 0.8, 1.2, 1.6]) {
      const level = levelFromAreas([{ name: 'field', theme: 'farm', rows: FIELD, blades: [{ from: [1, 4], to: [28, 5], speed: 9.6, rest: 0.6, delay }] }])
      const world = createWorld(level, createDefaultTuning())
      const pilot = createAutopilot()
      for (let step = 0; step < 1.5 / DT; step++) {
        const idle = pilot.next(world)
        idle.moveX = 0
        idle.moveY = 0
        stepWorld(world, idle, DT)
        world.events.length = 0
      }
      for (let step = 0; step < 30 / DT && world.status === 'playing'; step++) {
        const command = pilot.next(world)
        stepWorld(world, command, DT)
        const blade = world.blades[0]
        const still = command.moveX === 0 && command.moveY === 0
        if (still && world.player.pos.y > 6 && world.player.pos.y < 7.2) waited += DT
        const ahead = (world.player.pos.x - blade.pos.x) * (blade.forward ? 1 : -1)
        if (world.player.pos.y > 4 && world.player.pos.y < 6 && blade.phase === 'sweep' && ahead > -1 && ahead < 3) crossedWhileSweeping += 1
        for (const event of world.events) expect(event.type === 'bladeHit' && event.id === world.player.id, `delay ${delay}`).toBe(false)
        world.events.length = 0
      }
      expect(world.status, `delay ${delay}`).toBe('complete')
    }
    expect(waited).toBeGreaterThan(0.5)
    expect(crossedWhileSweeping).toBe(0)
  })

  it('leans into a conveyor so it crosses in a straight line', () => {
    const rows = [...FIELD]
    rows[3] = '#>>>>>>>>>>>>>>>>>>>>>>>>>>>>#'
    rows[4] = '#>>>>>>>>>>>>>>>>>>>>>>>>>>>>#'
    rows[5] = '#>>>>>>>>>>>>>>>>>>>>>>>>>>>>#'
    rows[6] = '#>>>>>>>>>>>>>>>>>>>>>>>>>>>>#'
    const world = createWorld(singleArea(rows), createDefaultTuning())
    const pilot = createAutopilot()
    let drift = 0
    for (let step = 0; step < 20 / DT && world.status === 'playing'; step++) {
      stepWorld(world, pilot.next(world), DT)
      drift = Math.max(drift, Math.abs(world.player.pos.x - 14.5))
      world.events.length = 0
    }
    expect(world.status).toBe('complete')
    expect(drift).toBeLessThan(0.6)
  })

  it('leaves chests behind in areas it has already left when asked to press onward', () => {
    const level = levelFromAreas([
      { name: 'south', theme: 'meadow', rows: ['#..............#', '#..............#', '#$.............#', '#..............#', '#.........P....#'] },
      { name: 'north', theme: 'meadow', rows: ['#######X########', '#..............#', '#..............#', '#..............#', '#..............#'] },
    ])
    const walk = (onward: boolean) => {
      const world = createWorld(level, createDefaultTuning())
      world.player.pos = { x: 13.5, y: 4.5 }
      world.player.prev = { ...world.player.pos }
      const pilot = createAutopilot({ onward })
      for (let step = 0; step < 30 / DT && world.status === 'playing'; step++) {
        stepWorld(world, pilot.next(world), DT)
        world.events.length = 0
      }
      return world
    }
    expect(walk(false).chests[0].opened).toBe(true)
    const onward = walk(true)
    expect(onward.status).toBe('complete')
    expect(onward.chests[0].opened).toBe(false)
  })

  it('backs away from the harvester along the open side instead of into a corner, and goes looking for it when it is out of range', () => {
    const level = buildLevel(LEVEL_1_5)
    let pinned = 0
    for (const seed of [1, 2, 3]) {
      const world = createWorld(level, createDefaultTuning(), { seed, debug: { invincible: true } })
      teleportToBoss(world)
      const pilot = createAutopilot({ seed, kite: true, siege: true, onward: true })
      for (let step = 0; step < 240 / DT && world.status === 'playing'; step++) {
        stepWorld(world, pilot.next(world), DT)
        const arena = world.level.areas[4]
        const { x, y } = world.player.pos
        if (world.areaIndex === 4 && (x < 4.2 || x > 35.8) && (y < arena.top + 4.6 || y > arena.top + 18.4)) pinned += DT
        world.events.length = 0
      }
      expect(world.status, `seed ${seed}`).toBe('complete')
    }
    expect(pinned).toBeLessThan(12)
  })
})
