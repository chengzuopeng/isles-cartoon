import { TIP_FIGHT_RANGE, TIP_NEAR, TIP_SEE_TURRET, type TipId } from '../data/tips'
import { lineClear, segmentClear } from '../sim/collision'
import { beltAt } from '../sim/conveyors'
import { fogBlocks, fogged } from '../sim/fog'
import { blocksSight } from '../sim/grid'
import type { Vec2 } from '../sim/math'
import { crumbling } from '../sim/melee'
import { playerHidden } from '../sim/perception'
import { penDoorway } from '../sim/pickups'
import { centerOf, playerEye } from '../sim/terrain'
import type { Enemy, GameEvent } from '../sim/types'
import type { World } from '../sim/world'

const KIND_TIPS: Partial<Record<Enemy['kind'], TipId>> = {
  gunner: 'gunner',
  shield: 'shield',
  thrower: 'thrower',
  bomber: 'bomber',
  turret: 'turret',
}

export function tipForEvent(world: World, event: GameEvent): TipId | null {
  switch (event.type) {
    case 'ultimateReady':
      return 'ultimate'
    case 'areaLocked':
      return 'lock'
    case 'bossIntro':
      return 'boss'
    case 'areaEntered':
      if (world.level.alarms.some((alarm) => alarm.area === event.index)) return 'stealth'
      return world.level.areas[event.index]?.kind === 'destroy' && world.areas[event.index]?.status === 'sealed' ? 'destroy' : null
    case 'alarmRunner':
      return 'alarmRunner'
    case 'bladeWarning':
      return world.level.blades[event.index]?.area === world.areaIndex ? 'blade' : null
    case 'pickedUp':
      return event.item.type === 'buff' ? 'buff' : null
    case 'enemyCharge':
      return 'rush'
    case 'enemyAlerted': {
      const enemy = world.enemies.find((item) => item.id === event.id)
      if (!enemy) return null
      if (enemy.elite) return 'elite'
      return KIND_TIPS[enemy.kind] ?? null
    }
    default:
      return null
  }
}

export function tipsForState(world: World): TipId[] {
  const { player } = world
  if (!player.alive || world.status !== 'playing') return []
  const found: TipId[] = []
  if (world.time < 1) found.push('controls')
  if (world.chests.some((chest) => !chest.opened && near(player.pos, chest.pos, TIP_NEAR))) found.push('chest')
  if (world.pickups.some((pickup) => pickup.item.type === 'weapon' && near(player.pos, pickup.pos, TIP_NEAR))) {
    found.push('weapon')
  }
  if (world.supplies.some((supply) => !supply.used && near(player.pos, supply.pos, TIP_NEAR))) found.push('supply')
  if (closedPenNear(world, player.pos)) found.push('pen')
  if (fogged(world, player.pos.x, player.pos.y)) found.push('fog')
  if (beltAt(world, player.pos)) found.push('conveyor')
  if (world.level.lamps.some((lamp, index) => !world.lamps[index] && near(player.pos, lamp, TIP_NEAR))) found.push('lamp')
  if (turretSeen(world)) found.push('turret')
  if (crumblingSeen(world)) found.push('melee')
  if (playerHidden(world)) found.push('bush')
  if (player.regenerating) found.push('regen')
  if (player.skills.length > 0 && fighting(world)) found.push('skill')
  return found
}

function turretSeen(world: World): boolean {
  const { pos } = world.player
  return world.enemies.some(
    (enemy) =>
      enemy.kind === 'turret' &&
      enemy.hp > 0 &&
      near(pos, enemy.pos, TIP_SEE_TURRET) &&
      !fogBlocks(world, pos, enemy.pos) &&
      segmentClear(world.grid, pos, enemy.pos, blocksSight),
  )
}

function crumblingSeen(world: World): boolean {
  const { player } = world
  const eye = playerEye(player)
  return world.enemies.some(
    (enemy) =>
      enemy.hp > 0 &&
      enemy.aggro &&
      crumbling(world, enemy) &&
      near(player.pos, enemy.pos, TIP_FIGHT_RANGE) &&
      lineClear(world.grid, eye, centerOf(enemy), blocksSight),
  )
}

function closedPenNear(world: World, pos: Vec2): boolean {
  return world.level.landmarks.some((placement, index) => {
    if (!placement.gate || world.landmarks[index]?.open) return false
    return near(pos, penDoorway(placement.gate), TIP_NEAR)
  })
}

function fighting(world: World): boolean {
  const { pos } = world.player
  return world.enemies.some((enemy) => enemy.hp > 0 && enemy.aggro && near(pos, enemy.pos, TIP_FIGHT_RANGE))
}

function near(a: Vec2, b: Vec2, range: number): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= range
}
