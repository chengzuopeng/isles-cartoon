import { CHAIN } from '../../data/chains'
import { weaponOf } from '../arsenal'
import { attackOf } from '../attacks'
import { corridorClear } from '../collision'
import { damagePlayer } from '../combat'
import { reelEnemy } from '../status'
import type { Vec2 } from '../math'
import { heightsOverlap } from '../terrain'
import type { Enemy } from '../types'
import type { World } from '../world'
import { armBomber } from './bomber'
import { interruptMelee, meleeReach, setState, still, strike, type EnemyBehavior } from './kit'
import { approach, orbit, predict } from './tactics'

const BLOCK_PROBE = 0.25
const DASH_SLACK = 0.3

export const grunt: EnemyBehavior = {
  act,
  interrupt: (_world, enemy) => {
    interruptMelee(enemy)
    if (enemy.state === 'charge' || enemy.state === 'dash') setState(enemy, 'recover')
  },
}

function act(world: World, enemy: Enemy, dt: number): Vec2 {
  const { player } = world
  const config = world.tuning.grunt
  const claw = weaponOf(world, 'claw')
  const rush = weaponOf(world, 'rush')
  enemy.rushCooldown = Math.max(0, enemy.rushCooldown - dt)
  const reach = meleeReach(world, enemy)
  switch (enemy.state) {
    case 'windup':
      if (enemy.stateTime >= claw.windup) strike(world, enemy, reach, 'claw')
      return still()
    case 'recover':
      if (enemy.stateTime >= claw.cooldown * enemy.cooldownScale) setState(enemy, 'chase')
      return still()
    case 'charge':
      if (enemy.stateTime >= rush.windup) {
        setState(enemy, 'dash')
        enemy.dashFrom.x = enemy.pos.x
        enemy.dashFrom.y = enemy.pos.y
        enemy.dashHit = false
      }
      return still()
    case 'dash':
      return dash(world, enemy)
  }
  if (!player.alive) return still()
  const dx = player.pos.x - enemy.pos.x
  const dy = player.pos.y - enemy.pos.y
  const distance = Math.hypot(dx, dy)
  if (distance <= reach) {
    setState(enemy, 'windup')
    enemy.facing = Math.atan2(dy, dx)
    world.events.push({ type: 'enemyWindup', id: enemy.id })
    return still()
  }
  if (enemy.engaged && enemy.rushCooldown === 0 && distance >= config.rushMin && distance <= config.rushMax) {
    const flight = rush.windup + distance / rush.speed
    const target = predict(world, flight * config.rushLead * world.difficulty.lead, dt)
    if (corridorClear(world.grid, enemy.pos, target, enemy.radius)) {
      const angle = Math.atan2(target.y - enemy.pos.y, target.x - enemy.pos.x)
      enemy.aimAngle = angle
      enemy.facing = angle
      setState(enemy, 'charge')
      world.events.push({ type: 'enemyCharge', id: enemy.id, x: enemy.pos.x, y: enemy.pos.y, angle })
      return still()
    }
  }
  if (!enemy.engaged) return orbit(world, enemy, config.speed)
  return approach(world, enemy, config.speed, config.lead * world.difficulty.lead, dt)
}

function dash(world: World, enemy: Enemy): Vec2 {
  const { player, grid } = world
  const rush = weaponOf(world, 'rush')
  const dirX = Math.cos(enemy.aimAngle)
  const dirY = Math.sin(enemy.aimAngle)
  if (!enemy.dashHit && player.alive && heightsOverlap(world, enemy)) {
    const gap = Math.hypot(player.pos.x - enemy.pos.x, player.pos.y - enemy.pos.y)
    if (gap <= enemy.radius + player.radius + rush.radius) {
      enemy.dashHit = true
      damagePlayer(world, rush.damage, dirX, dirY, rush.knockback, attackOf(enemy, 'rush'), enemy.pos)
      return finish(world, enemy)
    }
  }
  const victim = rammed(world, enemy, dirX, dirY)
  if (victim) {
    pileup(world, enemy, victim, dirX, dirY)
    return finish(world, enemy)
  }
  const traveled = Math.hypot(enemy.pos.x - enemy.dashFrom.x, enemy.pos.y - enemy.dashFrom.y)
  const probe = enemy.radius + BLOCK_PROBE
  const ahead = { x: enemy.pos.x + dirX * probe, y: enemy.pos.y + dirY * probe }
  const blocked = !corridorClear(grid, enemy.pos, ahead, enemy.radius * 0.8)
  const overdue = enemy.stateTime > rush.range / rush.speed + DASH_SLACK
  if (traveled >= rush.range || blocked || overdue) return finish(world, enemy)
  return { x: dirX * rush.speed, y: dirY * rush.speed }
}

function finish(world: World, enemy: Enemy): Vec2 {
  enemy.rushCooldown = weaponOf(world, 'rush').cooldown * enemy.cooldownScale * world.difficulty.rushRate
  setState(enemy, 'recover')
  if (!enemy.dashHit) {
    const stagger = world.tuning.grunt.stagger
    enemy.status.stunned = Math.max(enemy.status.stunned, stagger)
    enemy.status.dazed = Math.max(enemy.status.dazed, stagger)
    world.events.push({ type: 'stunned', id: enemy.id, x: enemy.pos.x, y: enemy.pos.y })
  }
  return still()
}

function rammed(world: World, enemy: Enemy, dirX: number, dirY: number): Enemy | null {
  for (const other of world.enemies) {
    if (other === enemy || other.hp <= 0 || other.kind === 'boss' || other.kind === 'turret') continue
    if (Math.abs(other.z - enemy.z) > 1) continue
    const dx = other.pos.x - enemy.pos.x
    const dy = other.pos.y - enemy.pos.y
    const distance = Math.hypot(dx, dy)
    if (distance > enemy.radius + other.radius) continue
    if (dx * dirX + dy * dirY < distance * CHAIN.pileupCone) continue
    return other
  }
  return null
}

function pileup(world: World, enemy: Enemy, victim: Enemy, dirX: number, dirY: number): void {
  const push = CHAIN.pileupPush * world.tuning.feel.knockbackDecay
  victim.knock.x += dirX * push
  victim.knock.y += dirY * push
  reelEnemy(world, victim, CHAIN.pileupReel)
  armBomber(world, victim)
  enemy.dashHit = false
  world.events.push({ type: 'enemyBumped', id: victim.id, x: victim.pos.x, y: victim.pos.y, z: victim.z })
  world.events.push({ type: 'combo', kind: 'pileup', x: victim.pos.x, y: victim.pos.y, z: victim.z })
}
