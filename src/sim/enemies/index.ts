import { ELITE } from '../../data/elites'
import { runForAlarm } from '../alarms'
import { bossBlocks } from '../boss'
import { decay, type Vec2 } from '../math'
import { aggro, canSeePlayer, sightOf, watchPlayer } from '../perception'
import { disabled, speedFactor, updateEnemyStatus } from '../status'
import { settleWalker } from '../terrain'
import type { AlertState, Enemy } from '../types'
import type { World } from '../world'
import { calm } from './calm'
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
  decay(enemy.knock, world.tuning.feel.knockbackDecay, dt)
  settleWalker(world, enemy)
}
