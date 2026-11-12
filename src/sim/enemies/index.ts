import { CHAIN } from '../../data/chains'
import { STEP_HEIGHT } from '../../data/heights'
import { ELITE } from '../../data/elites'
import { runForAlarm } from '../alarms'
import { bossBlocks } from '../boss'
import { decay, type Vec2 } from '../math'
import { damageEnemy } from '../combat'
import { cellFloor } from '../grid'
import { aggro, canSeePlayer, sightOf, watchPlayer } from '../perception'
import { disabled, reelEnemy, speedFactor, updateEnemyStatus } from '../status'
import { looseBody, settleWalker } from '../terrain'
import type { AlertState, Enemy } from '../types'
import type { World } from '../world'
import { calm } from './calm'
import { lured } from '../baits'
import { setState, still } from './kit'
import { behaviorOf, stationary } from './registry'
import { assignSlots } from './tactics'

export { meleeReach } from './kit'

export function updateEnemies(world: World, dt: number): void {
  const { player, tuning } = world
  assignSlots(world)
  for (const enemy of world.enemies) {
    if (enemy.hp <= 0 || enemy.kind === 'boss') continue
    updateEnemyStatus(world, enemy, dt)
    if (enemy.hp <= 0) continue
    updateEliteShield(enemy, dt)
    if (disabled(enemy)) {
      integrate(world, enemy, still(), dt)
      continue
    }
    const bait = lured(world, enemy, dt)
    if (bait) {
      integrate(world, enemy, bait, dt)
      continue
    }
    if (!enemy.aggro) {
      const distance = Math.hypot(player.pos.x - enemy.pos.x, player.pos.y - enemy.pos.y)
      if (distance > tuning.perception.activationRadius && enemy.alert === 'idle') continue
      if (enemy.idleMode === 'ambush' && enemy.alert === 'idle') {
        if (player.alive && distance <= tuning.perception.ambushRadius) aggro(world, enemy)
        else {
          integrate(world, enemy, still(), dt)
          continue
        }
      } else {
        const watch = enemy.leashed ? 'none' : watchPlayer(world, enemy, dt)
        if (watch === 'spotted') aggro(world, enemy)
        else if (watch === 'noticing') {
          integrate(world, enemy, still(), dt)
          continue
        } else {
          integrate(world, enemy, calm(world, enemy, dt), dt)
          continue
        }
      }
    }
    const errand = runForAlarm(world, enemy, dt)
    if (errand) {
      integrate(world, enemy, errand, dt)
      continue
    }
    if (!track(world, enemy, dt)) continue
    enemy.stateTime += dt
    enemy.cooldown = Math.max(0, enemy.cooldown - dt)
    integrate(world, enemy, behaviorOf(enemy)?.act(world, enemy, dt) ?? still(), dt)
  }
  world.enemies = world.enemies.filter((enemy) => enemy.hp > 0)
}

export function interruptEnemy(world: World, enemy: Enemy): void {
  behaviorOf(enemy)?.interrupt?.(world, enemy)
}

export function shieldBlocks(world: World, enemy: Enemy, dirX: number, dirY: number): boolean {
  if (enemy.kind === 'boss') return bossBlocks(enemy, dirX, dirY)
  if (disabled(enemy)) return false
  return behaviorOf(enemy)?.blocks?.(world, enemy, dirX, dirY) ?? false
}

function updateEliteShield(enemy: Enemy, dt: number): void {
  const elite = enemy.elite
  if (!elite || elite.shieldMax <= 0) return
  elite.sinceHit += dt
  if (elite.sinceHit >= ELITE.shieldDelay && elite.shield < elite.shieldMax) {
    elite.shield = Math.min(elite.shieldMax, elite.shield + elite.shieldMax * ELITE.shieldRegen * dt)
  }
}

function track(world: World, enemy: Enemy, dt: number): boolean {
  const { player, tuning } = world
  if (canSeePlayer(world, enemy, sightOf(world, enemy) * tuning.perception.trackScale)) {
    enemy.lastSeen.x = player.pos.x
    enemy.lastSeen.y = player.pos.y
    enemy.sinceSeen = 0
  } else {
    enemy.sinceSeen += dt
  }
  if (enemy.summoned || world.areas[enemy.area]?.status === 'locked' || world.level.def.waves) return true
  const fromHome = Math.hypot(enemy.pos.x - enemy.home.x, enemy.pos.y - enemy.home.y)
  if (enemy.sinceSeen >= tuning.perception.loseTime) return !giveUp(world, enemy, 'search', false)
  if (fromHome > tuning.perception.leash) return !giveUp(world, enemy, 'return', true)
  return true
}

function giveUp(world: World, enemy: Enemy, next: AlertState, leashed: boolean): boolean {
  if (behaviorOf(enemy)?.holdsOn?.(enemy)) return false
  interruptEnemy(world, enemy)
  enemy.aggro = false
  enemy.alert = next
  enemy.alertTime = 0
  enemy.lookTime = 0
  enemy.leashed = leashed
  setState(enemy, 'idle')
  world.events.push({ type: 'enemyGaveUp', id: enemy.id, x: enemy.pos.x, y: enemy.pos.y })
  return true
}

function integrate(world: World, enemy: Enemy, move: Vec2, dt: number): void {
  if (stationary(enemy)) return
  const factor = speedFactor(enemy) * enemy.speedScale
  enemy.pos.x += (move.x * factor + enemy.knock.x) * dt
  enemy.pos.y += (move.y * factor + enemy.knock.y) * dt
  bump(world, enemy)
  const loose = looseBody(enemy)
  decay(enemy.knock, world.tuning.feel.knockbackDecay, dt)
  settleWalker(world, enemy)
  if (loose) fall(world, enemy, dt)
}

function fall(world: World, enemy: Enemy, dt: number): void {
  const floor = cellFloor(world.grid, Math.floor(enemy.pos.x), Math.floor(enemy.pos.y))
  if (!enemy.airborne) {
    if (floor >= enemy.z - STEP_HEIGHT - 1e-4) return
    enemy.airborne = true
    enemy.vz = 0
    enemy.fallFrom = enemy.z
  }
  enemy.vz -= CHAIN.gravity * dt
  enemy.z += enemy.vz * dt
  if (enemy.z > floor) return
  enemy.z = floor
  enemy.vz = 0
  enemy.airborne = false
  const drop = enemy.fallFrom - floor
  if (drop < CHAIN.fallMin) return
  world.events.push({ type: 'combo', kind: 'fall', x: enemy.pos.x, y: enemy.pos.y, z: floor })
  world.killCause = 'fall'
  damageEnemy(world, enemy, CHAIN.fallDamage * drop, 0, 0, 0)
  world.killCause = null
  if (enemy.hp > 0) reelEnemy(world, enemy, CHAIN.fallReel)
}

function bump(world: World, enemy: Enemy): void {
  const { feel } = world.tuning
  const speed = Math.hypot(enemy.knock.x, enemy.knock.y)
  if (speed < feel.bumpSpeed) return
  for (const other of world.enemies) {
    if (other === enemy || other.hp <= 0 || other.kind === 'boss' || other.kind === 'turret') continue
    if (Math.hypot(other.knock.x, other.knock.y) >= feel.bumpSpeed) continue
    const reach = enemy.radius + other.radius
    if (Math.hypot(other.pos.x - enemy.pos.x, other.pos.y - enemy.pos.y) > reach || Math.abs(other.z - enemy.z) > 1) continue
    other.knock.x += enemy.knock.x * feel.bumpShare
    other.knock.y += enemy.knock.y * feel.bumpShare
    enemy.knock.x *= 1 - feel.bumpShare
    enemy.knock.y *= 1 - feel.bumpShare
    reelEnemy(world, other, feel.bumpDaze)
    world.events.push({ type: 'enemyBumped', id: other.id, x: other.pos.x, y: other.pos.y, z: other.z })
    return
  }
}
