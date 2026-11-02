import { describe, expect, it } from 'vitest'
import { ATTACK_TIPS } from '../data/attacks'
import type { AffixId } from '../data/elites'
import type { MinionKind } from '../data/enemies'
import { createDefaultTuning } from '../data/tuning'
import { SPECIAL_WEAPONS, type WeaponId } from '../data/weapons'
import { attackLabel } from '../ui/attack-names'
import { activateBoss } from './boss'
import { killEnemy } from './combat'
import { applyStatusToPlayer } from './status'
import { stepWorld } from './step'
import { levelFromAreas, pitchToward, singleArea } from './testing'
import type { Attack, Enemy, PlayerCommand } from './types'
import { createEnemy, createWorld, type World } from './world'

const DT = 1 / 60
const WEAPONS = createDefaultTuning().weapons
const FIELD = [
  '########################',
  '#......................#',
  '#......................#',
  '#.P....................#',
  '#......................#',
  '#......................#',
  '########################',
]

function idle(aimX = 100, aimY = 3.5): PlayerCommand {
  return { moveX: 0, moveY: 0, aimX, aimY, fire: false, slot: null, interact: false, skill: null, ultimate: false, pitch: 0, jump: false, dash: false, melee: false }
}

function setup(invincible = true): World {
  return createWorld(singleArea(FIELD), createDefaultTuning(), { debug: { invincible } })
}

function run(world: World, seconds: number, command = idle()): void {
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) stepWorld(world, command, DT)
}

function add(world: World, kind: MinionKind, x: number, y: number, affixes: AffixId[] = []): Enemy {
  const enemy = createEnemy(world, kind, { x, y }, 0, { affixes })
  enemy.aggro = true
  enemy.alert = 'combat'
  enemy.state = 'chase'
  enemy.facing = Math.atan2(world.player.pos.y - y, world.player.pos.x - x)
  world.enemies.push(enemy)
  return enemy
}

function attack(by: Attack['by'], cause: Attack['cause'], elite = false, boss: string | null = null): Attack {
  return { by, cause, elite, boss }
}

function takenFrom(world: World, expected: Attack): number {
  return world.stats.taken
    .filter(({ attack: hit }) => hit.by === expected.by && hit.cause === expected.cause && hit.elite === expected.elite)
    .reduce((sum, entry) => sum + entry.damage, 0)
}

describe('damage sources', () => {
  it('credits melee, bullets, bombs and fuses to the enemy that used them', () => {
    const cases: { kind: MinionKind; x: number; cause: Attack['cause']; seconds: number }[] = [
      { kind: 'grunt', x: 3.5, cause: 'claw', seconds: 1 },
      { kind: 'gunner', x: 7.5, cause: 'rifle', seconds: 2 },
      { kind: 'thrower', x: 8.5, cause: 'bomb', seconds: 2.5 },
      { kind: 'bomber', x: 3.6, cause: 'fuse', seconds: 1 },
      { kind: 'shield', x: 3.6, cause: 'bash', seconds: 1.5 },
    ]
    for (const item of cases) {
      const world = setup()
      add(world, item.kind, item.x, 3.5)
      run(world, item.seconds)
      expect(takenFrom(world, attack(item.kind, item.cause)), item.kind).toBeGreaterThan(0)
      expect(world.stats.damageTaken).toBeGreaterThan(0)
    }
  })

  it('marks elite explosions and burning separately', () => {
    const world = setup()
    const elite = add(world, 'grunt', 3.5, 3.5, ['volatile'])
    killEnemy(world, elite, true)
    run(world, 1)
    expect(takenFrom(world, attack('grunt', 'volatile', true))).toBeGreaterThan(0)
    applyStatusToPlayer(world, { status: 'burn', statusPower: 40, statusDuration: 1 })
    run(world, 1.2)
    expect(takenFrom(world, attack(null, 'burn'))).toBeGreaterThan(0)
  })

  it('remembers the killing blow', () => {
    const world = setup(false)
    world.player.hp = 1
    add(world, 'grunt', 3.5, 3.5)
    run(world, 1)
    expect(world.status).toBe('dead')
    expect(world.stats.killedBy).toEqual(attack('grunt', 'claw'))
    expect(world.events.some((event) => event.type === 'playerDied' && event.attack?.cause === 'claw')).toBe(true)
  })

  it('credits boss moves to the boss', () => {
    const arena = levelFromAreas(
      [
        { name: 'gate', theme: 'meadow', rows: ['#...................#', '#.........P.........#', '#####################'] },
        {
          name: 'factory',
          theme: 'factory',
          kind: 'boss',
          rows: [
            '#########DDD#########',
            '#...................#',
            '#.......S...........#',
            '#...................#',
            '#.........B.........#',
            '#...................#',
            '#...................#',
            '#..........S........#',
            '#########DDD#########',
          ],
        },
        { name: 'exit', theme: 'meadow', rows: ['#####################', '#........XXX........#', '#...................#'] },
      ],
      { bossId: 'harvester' },
    )
    const world = createWorld(arena, createDefaultTuning(), { debug: { invincible: true } })
    activateBoss(world)
    const boss = world.boss
    if (!boss) throw new Error('no boss')
    world.player.pos = { x: boss.pos.x + 2.6, y: boss.pos.y }
    world.player.prev = { ...world.player.pos }
    for (let i = 0; i < 20 / DT && world.stats.taken.length === 0; i++) stepWorld(world, idle(boss.pos.x, boss.pos.y), DT)
    expect(world.stats.taken.length).toBeGreaterThan(0)
    for (const entry of world.stats.taken) {
      expect(entry.attack.by).toBe('boss')
      expect(entry.attack.boss).toBe('harvester')
    }
  })
})

describe('shot accuracy', () => {
  it('counts every bullet fired and each bullet that lands once', () => {
    const world = setup()
    const target = add(world, 'turret', 6.5, 3.5)
    target.cooldown = 99
    const pitch = pitchToward(world, 6.5, 3.5, 0.65)
    run(world, 0.6, { ...idle(6.5, 3.5), pitch, fire: true })
    run(world, 0.5, { ...idle(6.5, 3.5), pitch })
    expect(world.stats.bulletsFired).toBeGreaterThan(0)
    expect(world.stats.bulletsHit).toBe(world.stats.bulletsFired)
    const fired = world.stats.bulletsFired
    run(world, 0.6, { ...idle(6.5, 0.5), fire: true })
    run(world, 0.5, idle(6.5, 0.5))
    expect(world.stats.bulletsFired).toBeGreaterThan(fired)
    expect(world.stats.bulletsHit).toBe(fired)
  })
})

describe('attack names', () => {
  it('reads like a sentence for the death screen', () => {
    expect(attackLabel(attack('thrower', 'bomb'), WEAPONS)).toBe('投弹兵的炸弹')
    expect(attackLabel(attack('grunt', 'volatile', true), WEAPONS)).toBe('精英冲锋兵的爆裂')
    expect(attackLabel(attack('boss', 'reaperSweep', false, 'harvester'), WEAPONS)).toBe('巨型收割机的横扫')
    expect(attackLabel(attack('boss', 'charge', false, 'scarecrow'), WEAPONS)).toBe('铁皮稻草人的冲撞')
    expect(attackLabel(attack(null, 'burn'), WEAPONS)).toBe('灼烧')
  })

  it('has a survival tip for every enemy attack', () => {
    const playerWeapons = new Set<WeaponId>([...SPECIAL_WEAPONS, 'blaster', 'starVolley'])
    const enemyWeapons = (Object.keys(WEAPONS) as WeaponId[]).filter((id) => !playerWeapons.has(id))
    for (const id of [...enemyWeapons, 'charge', 'burn', 'volatile', 'blade'] as const) {
      expect(ATTACK_TIPS[id], id).toBeTruthy()
    }
  })
})
