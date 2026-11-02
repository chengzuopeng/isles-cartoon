import { BOSS_SLOW_SCALE, BURN_TICK, CHILL_MAX_SLOW, CHILL_STACKS_TO_FREEZE, FREEZE_SECONDS } from '../data/status'
import type { StatusKind } from '../data/weapons'
import { hazardAttack } from './attacks'
import { damageEnemy, damagePlayer } from './combat'
import { interruptEnemy } from './enemies'
import type { Enemy, Player, StatusState } from './types'
import type { World } from './world'

export interface StatusHit {
  status: StatusKind
  statusPower: number
  statusDuration: number
}

export function createStatus(): StatusState {
  return { burn: 0, burnDps: 0, burnTick: 0, chill: 0, chillTime: 0, chillSlow: 0, frozen: 0, stunned: 0, dazed: 0 }
}

export function clearStatus(status: StatusState): void {
  Object.assign(status, createStatus())
}

export function applyStatusHit(world: World, enemy: Enemy, hit: StatusHit): void {
  if (enemy.hp <= 0) return
  const { status } = enemy
  switch (hit.status) {
    case 'burn':
      status.burn = Math.max(status.burn, hit.statusDuration)
      status.burnDps = Math.max(status.burnDps, hit.statusPower)
      break
    case 'chill':
      status.chillTime = hit.statusDuration
      status.chillSlow = hit.statusPower
      status.chill += 1
      if (status.chill >= CHILL_STACKS_TO_FREEZE) {
        status.chill = 0
        status.chillTime = 0
        freezeEnemy(world, enemy, FREEZE_SECONDS)
      }
      break
    case 'none':
      break
  }
}

export function freezeEnemy(world: World, enemy: Enemy, seconds: number): void {
  if (enemy.kind === 'boss' || enemy.hp <= 0) return
  enemy.status.frozen = Math.max(enemy.status.frozen, seconds)
  interruptEnemy(world, enemy)
  world.events.push({ type: 'frozen', id: enemy.id, x: enemy.pos.x, y: enemy.pos.y })
}

export function stunEnemy(world: World, enemy: Enemy, seconds: number): void {
  if (enemy.kind === 'boss' || enemy.hp <= 0 || seconds <= 0) return
  enemy.status.stunned = Math.max(enemy.status.stunned, seconds)
  interruptEnemy(world, enemy)
  world.events.push({ type: 'stunned', id: enemy.id, x: enemy.pos.x, y: enemy.pos.y })
}

export function updateEnemyStatus(world: World, enemy: Enemy, dt: number): void {
  const { status } = enemy
  status.frozen = Math.max(0, status.frozen - dt)
  status.stunned = Math.max(0, status.stunned - dt)
  status.dazed = Math.min(status.stunned, Math.max(0, status.dazed - dt))
  if (status.chillTime > 0) {
    status.chillTime -= dt
    if (status.chillTime <= 0) {
      status.chill = 0
      status.chillTime = 0
    }
  }
  if (status.burn <= 0) return
  status.burn -= dt
  status.burnTick += dt
  if (status.burnTick >= BURN_TICK) {
    status.burnTick -= BURN_TICK
    damageEnemy(world, enemy, status.burnDps * BURN_TICK, 0, 0, 0)
  }
  if (status.burn <= 0) {
    status.burn = 0
    status.burnDps = 0
    status.burnTick = 0
  }
}

export function disabled(enemy: Enemy): boolean {
  return enemy.status.frozen > 0 || enemy.status.stunned > 0
}

export function speedFactor(enemy: Enemy): number {
  if (disabled(enemy)) return 0
  const slow = Math.min(CHILL_MAX_SLOW, enemy.status.chill * enemy.status.chillSlow)
  return 1 - slow * (enemy.kind === 'boss' ? BOSS_SLOW_SCALE : 1)
}

export function applyStatusToPlayer(world: World, hit: StatusHit): void {
  const { status } = world.player
  if (!world.player.alive || world.player.invulnerable > 0) return
  switch (hit.status) {
    case 'burn':
      status.burn = Math.max(status.burn, hit.statusDuration)
      status.burnDps = Math.max(status.burnDps, hit.statusPower)
      break
    case 'chill':
      status.chillTime = hit.statusDuration
      status.chillSlow = hit.statusPower
      status.chill += 1
      if (status.chill >= CHILL_STACKS_TO_FREEZE) {
        status.chill = 0
        status.chillTime = 0
        status.frozen = Math.max(status.frozen, FREEZE_SECONDS)
      }
      break
    case 'none':
      break
  }
}

export function updatePlayerStatus(world: World, dt: number): void {
  const { status } = world.player
  status.frozen = Math.max(0, status.frozen - dt)
  status.stunned = Math.max(0, status.stunned - dt)
  if (status.chillTime > 0) {
    status.chillTime -= dt
    if (status.chillTime <= 0) {
      status.chill = 0
      status.chillTime = 0
    }
  }
  if (status.burn <= 0) return
  status.burn -= dt
  status.burnTick += dt
  if (status.burnTick >= BURN_TICK) {
    status.burnTick -= BURN_TICK
    damagePlayer(world, status.burnDps * BURN_TICK, 0, 0, 0, hazardAttack('burn'))
  }
  if (status.burn <= 0) {
    status.burn = 0
    status.burnDps = 0
    status.burnTick = 0
  }
}

export function playerDisabled(player: Player): boolean {
  return player.status.frozen > 0 || player.status.stunned > 0
}

export function playerSpeedFactor(player: Player): number {
  if (playerDisabled(player)) return 0
  return 1 - Math.min(CHILL_MAX_SLOW, player.status.chill * player.status.chillSlow)
}
