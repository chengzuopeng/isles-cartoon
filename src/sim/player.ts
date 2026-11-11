import { MAX_PITCH, STEP_HEIGHT, THROW_HEIGHT, eyeHeightOf } from '../data/heights'
import type { PlayerWeaponId } from '../data/weapons'
import { activeWeaponId, firePattern, weaponOf } from './arsenal'
import { consumesAmmo } from './buffs'
import { climberTest, resolveCircle, supportHeight } from './collision'
import { climbable, floorAt, standHeight, supportsStanding, tileAt } from './grid'
import { spawnLob } from './lobs'
import { clamp, decay, type Vec2 } from './math'
import { swingMelee } from './melee'
import { aggro, emitNoise } from './perception'
import { refreshStats } from './stats'
import { playerDisabled, playerSpeedFactor, reelEnemy } from './status'
import { SUPPORT_SHARE, heightsOverlap, playerReach } from './terrain'
import type { Player, PlayerCommand, WeaponSlot } from './types'
import type { World } from './world'

export function updatePlayer(world: World, command: PlayerCommand, dt: number): void {
  const { player, tuning } = world
  const stats = refreshStats(world)
  if (!player.alive || world.status !== 'playing') return

  player.aim.x = command.aimX
  player.aim.y = command.aimY
  const aimX = command.aimX - player.pos.x
  const aimY = command.aimY - player.pos.y
  if (aimX * aimX + aimY * aimY > 0.0001) player.facing = Math.atan2(aimY, aimX)
  player.pitch = clamp(Number.isFinite(command.pitch) ? command.pitch : 0, -MAX_PITCH, MAX_PITCH)

  rechargeDash(world, dt)
  player.meleeCooldown = Math.max(0, player.meleeCooldown - dt)
  const free = !playerDisabled(player)
  if (command.dash && free && dashReady(player)) dash(world, command)
  if (command.jump && free && player.grounded) jump(world)

  let moveX = player.knock.x * dt
  let moveY = player.knock.y * dt
  const rolling = player.rollTime > 0
  if (player.rollTime > 0) {
    const step = Math.min(dt, player.rollTime)
    moveX += player.rollDirX * player.rollSpeed * step
    moveY += player.rollDirY * player.rollSpeed * step
    player.rollTime = Math.max(0, player.rollTime - dt)
  } else {
    const moveLength = Math.hypot(command.moveX, command.moveY)
    const speed = stats.speed * playerSpeedFactor(player) * (player.stagger > 0 ? tuning.feel.staggerSpeed : 1)
    const moveScale = moveLength > 1 ? speed / moveLength : speed
    moveX += command.moveX * moveScale * dt
    moveY += command.moveY * moveScale * dt
  }
  decay(player.knock, tuning.feel.knockbackDecay, dt)
  player.stagger = Math.max(0, player.stagger - dt)
  movePlayer(world, moveX, moveY, dt)
  if (rolling) shoveEnemies(world)
  else if (free) vault(world, command, dt)

  if (command.slot) selectSlot(world, command.slot)

  const primary = weaponOf(world, player.primary)
  if (player.ammo < player.magazine) {
    player.reload += dt / Math.max(0.05, primary.reloadSeconds * stats.reload)
    if (player.reload >= 1) {
      player.ammo += 1
      player.reload = player.ammo < player.magazine ? player.reload - 1 : 0
    }
  } else {
    player.reload = 0
  }

  player.cooldown = Math.max(0, player.cooldown - dt)
  const activeId = activeWeaponId(player)
  const usingSpecial = player.slot === 'special' && player.special !== null
  const hasAmmo = usingSpecial ? player.specialAmmo >= 1 : player.ammo >= 1
  const busy = player.ultShots > 0 || player.rollTime > 0 || !free
  if (command.fire && !busy && player.burstLeft === 0 && player.cooldown === 0 && hasAmmo) {
    const weapon = weaponOf(world, activeId)
    if (consumesAmmo(player)) {
      if (usingSpecial) player.specialAmmo -= 1
      else player.ammo -= 1
    }
    player.cooldown = weapon.cooldown * stats.fireInterval
    player.burstLeft = Math.max(1, Math.round(weapon.burstCount))
    player.burstTimer = 0
    player.burstAngle = player.facing
    player.burstWeapon = activeId
    player.burstEmpower = player.empowered
    player.empowered = 0
    player.sinceAttack = 0
  }

  if (player.burstLeft > 0) {
    const weapon = weaponOf(world, player.burstWeapon)
    player.burstTimer -= dt
    while (player.burstLeft > 0 && player.burstTimer <= 0) {
      player.burstAngle = player.facing
      fire(world, player.burstWeapon, player.facing, player.pitch)
      player.burstLeft -= 1
      player.burstTimer += weapon.burstInterval
    }
  }

  if (player.special && player.specialAmmo <= 0 && player.burstLeft === 0 && player.slot === 'special') {
    world.events.push({ type: 'weaponEmpty', weapon: player.special })
    selectSlot(world, 'primary')
  }

  if (command.melee && free && player.meleeCooldown === 0) {
    swingMelee(world)
    player.sinceAttack = 0
  }

  player.sinceDamage += dt
  player.sinceAttack += dt
  player.regenerating = player.hp < player.maxHp && canRegenerate(world)
  if (player.regenerating) player.hp = Math.min(player.maxHp, player.hp + stats.regenRate * dt)
}

function dash(world: World, command: PlayerCommand): void {
  const { player, tuning } = world
  const length = Math.hypot(command.moveX, command.moveY)
  const dirX = length > 0.01 ? command.moveX / length : Math.cos(player.facing)
  const dirY = length > 0.01 ? command.moveY / length : Math.sin(player.facing)
  const time = Math.max(0.05, tuning.player.dashTime)
  player.rollTime = time
  player.rollDirX = dirX
  player.rollDirY = dirY
  player.rollSpeed = tuning.player.dashDistance / time
  player.invulnerable = Math.max(player.invulnerable, time)
  player.dashCharges -= 1
  if (player.dashRecharge <= 0) player.dashRecharge = tuning.player.dashRecharge
  player.rammed = []
  world.stats.dashes += 1
  world.events.push({ type: 'dashed', x: player.pos.x, y: player.pos.y, angle: Math.atan2(dirY, dirX) })
}

export function dashReady(player: Player): boolean {
  return player.dashCharges > 0 && player.rollTime <= 0
}

export function dashGauge(world: World): number {
  const { player, tuning } = world
  const full = Math.max(1, tuning.player.dashCharges)
  if (player.dashCharges >= full) return 1
  const partial = 1 - player.dashRecharge / Math.max(0.05, tuning.player.dashRecharge)
  return Math.min(1, (player.dashCharges + Math.max(0, partial)) / full)
}

function rechargeDash(world: World, dt: number): void {
  const { player, tuning } = world
  if (player.dashCharges >= tuning.player.dashCharges) {
    player.dashRecharge = 0
    return
  }
  player.dashRecharge -= dt
  if (player.dashRecharge > 0) return
  player.dashCharges += 1
  player.dashRecharge = player.dashCharges < tuning.player.dashCharges ? player.dashRecharge + tuning.player.dashRecharge : 0
}

function shoveEnemies(world: World): void {
  const { player, tuning } = world
  const push = tuning.player.dashShove * tuning.feel.knockbackDecay
  for (const enemy of world.enemies) {
    if (enemy.hp <= 0 || enemy.kind === 'boss' || enemy.kind === 'turret' || player.rammed.includes(enemy.id)) continue
    if (!heightsOverlap(world, enemy)) continue
    const dx = enemy.pos.x - player.pos.x
    const dy = enemy.pos.y - player.pos.y
    const reach = player.radius + enemy.radius + 0.15
    if (dx * dx + dy * dy > reach * reach) continue
    player.rammed.push(enemy.id)
    enemy.knock.x += player.rollDirX * push
    enemy.knock.y += player.rollDirY * push
    if (enemy.status.painRest <= 0) {
      reelEnemy(world, enemy, tuning.feel.bumpDaze)
      enemy.status.painRest = tuning.feel.reelCooldown
    }
    aggro(world, enemy)
    world.events.push({ type: 'enemyBumped', id: enemy.id, x: enemy.pos.x, y: enemy.pos.y, z: enemy.z })
  }
}

function vault(world: World, command: PlayerCommand, dt: number): void {
  const { player, grid, tuning } = world
  const length = Math.hypot(command.moveX, command.moveY)
  if (!player.grounded || length < 0.1) {
    player.vaultTime = 0
    return
  }
  const probe = player.radius + 0.25
  const column = Math.floor(player.pos.x + (command.moveX / length) * probe)
  const row = Math.floor(player.pos.y + (command.moveY / length) * probe)
  const tile = tileAt(grid, column, row)
  const rise = climbable(tile) && supportsStanding(tile) ? standHeight(grid, column, row) - player.z : Infinity
  if (rise <= STEP_HEIGHT + 1e-4 || rise > tuning.player.vaultHeight + 1e-4) {
    player.vaultTime = 0
    return
  }
  player.vaultTime += dt
  if (player.vaultTime < tuning.player.vaultTime) return
  player.vaultTime = 0
  jump(world)
  world.events.push({ type: 'vaulted', x: player.pos.x, y: player.pos.y })
}

function jump(world: World): void {
  const { player, tuning } = world
  player.vz = Math.sqrt(2 * tuning.player.gravity * tuning.player.jumpHeight)
  player.grounded = false
  world.stats.jumps += 1
  world.events.push({ type: 'jumped' })
}

export function movePlayer(world: World, moveX: number, moveY: number, dt: number): void {
  const { player, grid, tuning } = world
  const reach = playerReach(player)
  player.pos.x += moveX
  player.pos.y += moveY
  resolveCircle(player.pos, player.radius, climberTest(grid, reach))
  const radius = player.radius * SUPPORT_SHARE
  if (player.grounded) {
    const ground = groundUnder(world, radius, reach)
    if (ground >= player.z - STEP_HEIGHT - 1e-4) {
      player.z = ground
      player.vz = 0
      return
    }
    player.grounded = false
    player.vz = 0
  }
  const before = player.z
  const gravity = tuning.player.gravity
  player.z += player.vz * dt - 0.5 * gravity * dt * dt
  player.vz -= gravity * dt
  const ground = groundUnder(world, radius, Math.max(before, player.z))
  if (player.z > ground) return
  const fall = (player.vz * player.vz) / (2 * gravity)
  player.z = ground
  player.vz = 0
  player.grounded = true
  world.events.push({ type: 'landed', fall })
}

function groundUnder(world: World, radius: number, reach: number): number {
  const { player, grid } = world
  const ground = supportHeight(grid, player.pos, radius, reach)
  return Number.isFinite(ground) ? ground : floorAt(grid, player.pos.x, player.pos.y)
}

export function threatNearby(world: World, radius: number): boolean {
  if (radius <= 0) return false
  const { player } = world
  const radiusSq = radius * radius
  for (const enemy of world.enemies) {
    if (enemy.hp <= 0 || !enemy.aggro) continue
    const dx = enemy.pos.x - player.pos.x
    const dy = enemy.pos.y - player.pos.y
    if (dx * dx + dy * dy <= radiusSq) return true
  }
  return false
}

function canRegenerate(world: World): boolean {
  const { player, tuning, playerStats: stats } = world
  if (tuning.player.idleRegen < 1 && !world.difficulty.regen) return false
  if (player.sinceDamage < stats.regenDelay) return false
  if (tuning.player.legacyRegen >= 1) return player.sinceAttack >= stats.regenDelay
  return !threatNearby(world, tuning.player.regenSafeRadius)
}

function selectSlot(world: World, slot: WeaponSlot): void {
  const { player } = world
  if (slot === player.slot || (slot === 'special' && (!player.special || player.specialAmmo <= 0))) return
  player.slot = slot
  player.burstLeft = 0
  world.events.push({ type: 'weaponChanged', weapon: activeWeaponId(player), slot })
}

export function lobTarget(world: World, angle: number, pitch: number, id: PlayerWeaponId): Vec2 {
  const { player } = world
  const range = weaponOf(world, id).range
  const eye = eyeHeightOf('player')
  const distance = pitch < -0.01 ? Math.min(range, eye / Math.tan(-pitch)) : range
  return { x: player.pos.x + Math.cos(angle) * distance, y: player.pos.y + Math.sin(angle) * distance }
}

function fire(world: World, id: PlayerWeaponId, angle: number, pitch: number): void {
  const { player } = world
  const offset = player.radius + 0.1
  const eye = player.z + eyeHeightOf('player')
  const damageScale = world.playerStats.damage * (1 + player.burstEmpower)
  if (weaponOf(world, id).kind === 'lob') {
    spawnLob(world, 'player', player.pos, lobTarget(world, angle, pitch, id), id, damageScale, null, undefined, player.z + THROW_HEIGHT)
  } else {
    firePattern(world, 'player', player.pos.x, player.pos.y, offset, angle, id, { damageScale, z: eye, pitch })
  }
  emitNoise(world, player.pos, world.tuning.perception.noiseRadius)
  const flat = Math.cos(pitch) * offset
  world.events.push({
    type: 'shot',
    x: player.pos.x + Math.cos(angle) * flat,
    y: player.pos.y + Math.sin(angle) * flat,
    z: eye + Math.sin(pitch) * offset,
    angle,
    pitch,
    weapon: id,
  })
}
