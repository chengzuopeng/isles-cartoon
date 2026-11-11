import { CHAIN } from '../data/chains'
import { BOSS_ROCK_HITS, getBoss, type BossDef, type BossMoveId, type BossSummon, type GuardDef, type RamDef, type TreadDef } from '../data/bosses'
import { STORIES } from '../data/dialogue'
import type { LandmarkId } from '../data/landmarks'
import { BOSS_HEAL } from '../data/loot'
import { fireEnemyWeapon, weaponOf } from './arsenal'
import { attackOf } from './attacks'
import { corridorClear, resolveCircleGrid } from './collision'
import { angleBetween, damagePlayer, spawnBlast } from './combat'
import { igniteKeg } from './props'
import { Tile, blocksMovement, setTile, tileAt } from './grid'
import { breakLandmark, landmarkCenter } from './landmark-state'
import { lobPitch, spawnLob } from './lobs'
import { directionTo, invalidateNavigation, wideDirectionTo } from './navigation'
import { spawnPickup } from './pickups'
import { spawnRing } from './rings'
import { speedFactor, updateEnemyStatus } from './status'
import { heightsOverlap, muzzleOf, resolvePlayer, settleWalker } from './terrain'
import type { BossState, Enemy, TankState } from './types'
import type { World } from './world'

const DEGREES = Math.PI / 180
const RAM_CONTACT = 0.12
const RAM_FACING = 0.5

export function activateBoss(world: World): void {
  const boss = world.boss
  if (!boss?.boss || boss.hp <= 0 || boss.boss.phase !== 'dormant') return
  const def = getBoss(boss.boss.id)
  boss.boss.phase = 'intro'
  boss.boss.timer = def.introTime
  boss.aggro = true
  const ring = world.level.ring
  if (boss.boss.tank && ring) {
    const around = Math.atan2(boss.pos.y - ring.y, boss.pos.x - ring.x)
    boss.facing = angleBetween(around + (boss.boss.tank.lap * Math.PI) / 2, 0)
    boss.boss.tank.turret = Math.atan2(world.player.pos.y - boss.pos.y, world.player.pos.x - boss.pos.x)
  }
  const first = def.phases[0]
  if (first) {
    boss.boss.order = [...first.moves]
    boss.boss.hazards = [...first.hazards]
  }
  const story = (STORIES[world.level.def.id]?.boss?.length ?? 0) > 0
  world.events.push({ type: 'bossIntro', name: def.name, ...(story ? { story: true } : {}) })
}

export function updateBoss(world: World, dt: number): void {
  const boss = world.boss
  if (!boss?.boss) return
  if (boss.hp <= 0) {
    const tank = boss.boss.tank
    if (tank && tank.retreat > 0) tank.retreat = Math.max(0, tank.retreat - dt)
    return
  }
  const state = boss.boss
  if (state.phase === 'dormant') return
  updateEnemyStatus(world, boss, dt)
  if (boss.hp <= 0) return
  const def = getBoss(state.id)
  const { player } = world
  const dx = player.pos.x - boss.pos.x
  const dy = player.pos.y - boss.pos.y
  updateHazards(world, boss, state, def, dt)
  state.timer -= dt

  switch (state.phase) {
    case 'intro':
      face(boss, def, Math.atan2(dy, dx), def.guard?.turnDeg, dt)
      if (state.timer <= 0) startWalk(state, def)
      break
    case 'walk': {
      if (state.tank && def.tread) {
        drive(world, boss, state.tank, def, def.tread, dt)
        if (state.timer <= 0 && player.alive) startMove(world, boss, state, def, dt)
        break
      }
      face(boss, def, Math.atan2(dy, dx), def.guard?.turnDeg, dt)
      const gap = Math.hypot(dx, dy)
      const closing = def.bash !== null && nextMove(state, def) === 'bash'
      const stop = closing && def.bash ? def.bash.reach : boss.radius + player.radius + def.keepDistance
      if (gap > stop) {
        const direction = wideDirectionTo(world, boss.pos, boss.radius, player.pos)
        if (direction) {
          boss.pos.x += direction.x * def.walkSpeed * speedFactor(boss) * dt
          boss.pos.y += direction.y * def.walkSpeed * speedFactor(boss) * dt
        }
      }
      const waiting = closing && def.bash !== null && gap > def.bash.reach && state.timer > -def.bash.chase
      if (state.timer <= 0 && player.alive && !waiting) startMove(world, boss, state, def, dt)
      break
    }
    case 'telegraph':
      if (state.move === 'fan') boss.facing = Math.atan2(dy, dx)
      if (state.timer <= 0) beginActive(world, boss, state, def)
      break
    case 'active':
      if (state.move === 'charge' || state.move === 'frenzy') stepCharge(world, boss, state, def, dt)
      else if (state.move === 'fan' && state.timer <= 0) fireVolley(world, boss, state, def)
      else if (state.move === 'bales' && state.timer <= 0) tossBale(world, boss, state, def, dt)
      else if (state.move === 'cannon' && state.timer <= 0) fireCannon(world, boss, state, def)
      else if (state.move === 'triple' && state.timer <= 0) fireTriple(world, boss, state, def)
      else if (state.move === 'mines' && state.timer <= 0) tossMine(world, boss, state, def, dt)
      break
    case 'recover': {
      const shield = state.shield
      if (shield && !shield.held) shield.lift = Math.max(0, state.timer)
      else if (def.guard) face(boss, def, Math.atan2(dy, dx), def.guard.recoverTurnDeg, dt)
      if (state.timer > 0) break
      if (shield && !shield.held) raiseShield(world, boss, state)
      if (state.frenzyLeft > 0) aimCharge(world, boss, state, def.frenzy?.telegraph ?? def.charge.telegraph)
      else startWalk(state, def)
      break
    }
    case 'stunned':
    case 'shift':
      if (state.timer > 0) break
      if (state.shield && !state.shield.held && def.guard) {
        startRecover(state, def.guard.pickup)
        state.shield.lift = def.guard.pickup
      } else startWalk(state, def)
      break
  }

  settleWalker(world, boss)
  if (state.tank && def.tread) aimTurret(world, boss, state, state.tank, def.tread, dt)
  refillRack(state, def, dt)
  if (def.phases.length > 0) checkPhase(world, boss, state, def)
  else checkSummon(world, boss, state, def)
}

function refillRack(state: BossState, def: BossDef, dt: number): void {
  const rack = def.rack
  const tossing = state.move === 'bales' && (state.phase === 'telegraph' || state.phase === 'active')
  if (!rack || tossing || state.bombs >= rack.size) {
    state.rackTimer = 0
    return
  }
  state.rackTimer += dt
  if (state.rackTimer < rack.refill) return
  state.rackTimer -= rack.refill
  state.bombs += 1
}

export function startWalk(state: BossState, def: BossDef): void {
  state.phase = 'walk'
  state.timer = def.walkTime
  state.move = null
  state.frenzyLeft = 0
}

function startRecover(state: BossState, time: number): void {
  state.phase = 'recover'
  state.timer = time
}

function currentMoves(state: BossState, def: BossDef): readonly BossMoveId[] {
  return def.phases[state.phaseIndex]?.moves ?? def.moves
}

export function nextMove(state: BossState, def: BossDef): BossMoveId | null {
  if (state.moveIndex < state.order.length) return state.order[state.moveIndex] ?? null
  return def.order === 'cycle' ? (currentMoves(state, def)[0] ?? null) : null
}

function face(boss: Enemy, def: BossDef, angle: number, turnDeg: number | undefined, dt: number): void {
  if (!def.guard || turnDeg === undefined) {
    boss.facing = angle
    return
  }
  const step = turnDeg * DEGREES * dt
  const diff = angleBetween(angle, boss.facing)
  boss.facing = angleBetween(boss.facing + Math.max(-step, Math.min(step, diff)), 0)
}

export function bossExposed(enemy: Enemy): boolean {
  const phase = enemy.boss?.phase
  return enemy.hp > 0 && (phase === 'recover' || phase === 'stunned')
}

export function bossBlocks(boss: Enemy, dirX: number, dirY: number): boolean {
  const state = boss.boss
  if (!state?.shield?.held || state.phase === 'stunned' || state.phase === 'dormant') return false
  const guard = getBoss(state.id).guard
  if (!guard) return false
  const half = (guard.frontDeg * DEGREES) / 2
  return -(dirX * Math.cos(boss.facing) + dirY * Math.sin(boss.facing)) >= Math.cos(half)
}

export function backScale(boss: Enemy, dirX: number, dirY: number): number {
  const state = boss.boss
  if (!state || state.phase === 'dormant') return 1
  const guard = getBoss(state.id).guard
  if (!guard) return 1
  const half = (guard.backDeg * DEGREES) / 2
  return dirX * Math.cos(boss.facing) + dirY * Math.sin(boss.facing) >= Math.cos(half) ? guard.backScale : 1
}

function startMove(world: World, boss: Enemy, state: BossState, def: BossDef, dt: number): void {
  if (state.moveIndex >= state.order.length) {
    const moves = currentMoves(state, def)
    state.order = def.order === 'cycle' ? [...moves] : shuffle(world, moves)
    state.moveIndex = 0
  }
  const move = state.order[state.moveIndex++]
  state.move = move
  state.phase = 'telegraph'
  const { player } = world
  const toPlayer = Math.atan2(player.pos.y - boss.pos.y, player.pos.x - boss.pos.x)
  switch (move) {
    case 'charge':
      aimCharge(world, boss, state, def.charge.telegraph)
      if (state.tank) {
        boss.facing = angleBetween(boss.facing + Math.PI, 0)
        state.tank.reverse = true
      }
      break
    case 'triple': {
      const triple = def.triple
      let aim = toPlayer
      if (triple && triple.lead > 0) {
        const travel = Math.hypot(player.pos.x - boss.pos.x, player.pos.y - boss.pos.y) / Math.max(0.1, weaponOf(world, triple.weapon).speed)
        const spot = predicted(world, dt, (triple.telegraph + travel) * triple.lead)
        aim = Math.atan2(spot.y - boss.pos.y, spot.x - boss.pos.x)
      }
      boss.aimAngle = aim
      state.timer = triple?.telegraph ?? 0
      if (state.tank) state.tank.barrels = triple?.barrels ?? 0
      break
    }
    case 'mines':
      state.timer = def.mines?.windup ?? 0
      boss.facing = angleBetween(toPlayer + Math.PI, 0)
      if (state.tank) {
        state.tank.minesLeft = def.mines?.count ?? 0
        state.tank.hatch = true
      }
      break
    case 'frenzy':
      state.frenzyLeft = def.frenzy?.charges ?? 1
      aimCharge(world, boss, state, def.frenzy?.firstTelegraph ?? def.charge.telegraph)
      break
    case 'slam': {
      const slam = weaponOf(world, def.slam?.weapon ?? 'strawSlam')
      state.timer = slam.windup
      if (def.ring) break
      spawnBlast(world, {
        x: boss.pos.x,
        y: boss.pos.y,
        z: boss.z,
        radius: slam.radius,
        delay: slam.windup,
        playerDamage: slam.damage,
        enemyDamage: 0,
        source: 'boss',
        ownerId: boss.id,
        attack: attackOf(boss, def.slam?.weapon ?? 'strawSlam'),
      })
      break
    }
    case 'fan': {
      const fan = weaponOf(world, def.fan?.weapon ?? 'strawFan')
      state.timer = fan.windup
      state.volleysLeft = Math.max(1, Math.round(fan.burstCount))
      break
    }
    case 'sweep': {
      const sweep = weaponOf(world, def.sweep?.weapon ?? 'reaperSweep')
      boss.facing = toPlayer
      state.timer = sweep.windup
      spawnBlast(world, {
        x: boss.pos.x,
        y: boss.pos.y,
        radius: sweep.radius,
        delay: sweep.windup,
        playerDamage: sweep.damage,
        enemyDamage: 0,
        source: 'boss',
        ownerId: boss.id,
        arcCenter: toPlayer,
        arcWidth: (sweep.arcDeg * Math.PI) / 180,
        attack: attackOf(boss, def.sweep?.weapon ?? 'reaperSweep'),
      })
      break
    }
    case 'spin': {
      const spin = weaponOf(world, def.spin?.weapon ?? 'bladeSpin')
      state.timer = spin.windup
      spawnBlast(world, {
        x: boss.pos.x,
        y: boss.pos.y,
        radius: spin.radius,
        delay: spin.windup,
        playerDamage: spin.damage,
        enemyDamage: 0,
        source: 'boss',
        ownerId: boss.id,
        inner: def.spin?.inner ?? 1,
        gapCenter: world.rng.range(-Math.PI, Math.PI),
        gapWidth: ((def.spin?.gapDeg ?? 60) * Math.PI) / 180,
        attack: attackOf(boss, def.spin?.weapon ?? 'bladeSpin'),
      })
      break
    }
    case 'bales':
      state.timer = def.bales?.windup ?? 0
      state.balesLeft = def.bales?.count ?? 0
      break
    case 'bash': {
      const bash = def.bash
      const weapon = weaponOf(world, bash?.weapon ?? 'captainBash')
      state.timer = weapon.windup
      spawnBlast(world, {
        x: boss.pos.x,
        y: boss.pos.y,
        radius: weapon.radius,
        delay: weapon.windup,
        playerDamage: weapon.damage,
        enemyDamage: 0,
        source: 'boss',
        ownerId: boss.id,
        arcCenter: boss.facing,
        arcWidth: weapon.arcDeg * DEGREES,
        attack: attackOf(boss, bash?.weapon ?? 'captainBash'),
      })
      break
    }
    case 'cannon': {
      const cannon = def.cannon
      const telegraph = cannon?.telegraph ?? 0
      let aim = toPlayer
      if (cannon && cannon.lead > 0) {
        const travel = Math.hypot(player.pos.x - boss.pos.x, player.pos.y - boss.pos.y) / Math.max(0.1, weaponOf(world, cannon.weapon).speed)
        const spot = predicted(world, dt, (telegraph + travel) * cannon.lead)
        aim = Math.atan2(spot.y - boss.pos.y, spot.x - boss.pos.x)
      }
      boss.aimAngle = aim
      boss.facing = aim
      state.timer = telegraph
      state.shotsLeft = cannon?.shots ?? 0
      break
    }
  }
  world.events.push({ type: 'bossMove', move })
}

function aimCharge(world: World, boss: Enemy, state: BossState, telegraph: number): void {
  const { player } = world
  const dx = player.pos.x - boss.pos.x
  const dy = player.pos.y - boss.pos.y
  const length = Math.hypot(dx, dy) || 1
  state.chargeX = dx / length
  state.chargeY = dy / length
  state.chargeTraveled = 0
  state.chargeHit = false
  state.phase = 'telegraph'
  state.timer = telegraph
  boss.facing = Math.atan2(state.chargeY, state.chargeX)
}

function beginActive(world: World, boss: Enemy, state: BossState, def: BossDef): void {
  switch (state.move) {
    case 'charge':
    case 'frenzy':
    case 'bales':
    case 'cannon':
    case 'triple':
    case 'mines':
      state.phase = 'active'
      state.timer = 0
      break
    case 'fan':
      state.phase = 'active'
      state.timer = 0
      fireVolley(world, boss, state, def)
      break
    case 'slam':
      if (def.ring) slamRing(world, boss, def)
      startRecover(state, def.slam?.recover ?? 0.8)
      break
    case 'sweep':
      startRecover(state, def.sweep?.recover ?? 0.7)
      break
    case 'spin':
      startRecover(state, def.spin?.recover ?? 0.9)
      break
    case 'bash':
      startRecover(state, def.bash?.recover ?? 0.8)
      break
    case null:
      startWalk(state, def)
      break
  }
}

function slamRing(world: World, boss: Enemy, def: BossDef): void {
  const ring = def.ring
  if (!ring) return
  const id = def.slam?.weapon ?? 'strawSlam'
  const slam = weaponOf(world, id)
  spawnRing(world, {
    x: boss.pos.x,
    y: boss.pos.y,
    z: boss.z,
    maxRadius: ring.radius,
    speed: ring.speed,
    height: ring.height,
    damage: slam.damage,
    knockback: slam.knockback,
    attack: attackOf(boss, id),
  })
}

function stepCharge(world: World, boss: Enemy, state: BossState, def: BossDef, dt: number): void {
  const step = def.charge.speed * dt
  const beforeX = boss.pos.x
  const beforeY = boss.pos.y
  boss.pos.x += state.chargeX * step
  boss.pos.y += state.chargeY * step
  settleWalker(world, boss)
  const moved = Math.hypot(boss.pos.x - beforeX, boss.pos.y - beforeY)
  state.chargeTraveled += moved
  const { player } = world
  if (!state.chargeHit && player.alive && heightsOverlap(world, boss)) {
    const reach = boss.radius + player.radius + 0.1
    if (Math.hypot(player.pos.x - boss.pos.x, player.pos.y - boss.pos.y) <= reach) {
      state.chargeHit = true
      damagePlayer(world, def.charge.damage, state.chargeX, state.chargeY, def.charge.knockback, attackOf(boss, def.charge.cause ?? 'charge'), boss.pos)
    }
  }
  const struck = def.ram ? rammed(world, boss, state, def.ram.into) : -1
  if (moved < step * 0.5 || struck >= 0) {
    crash(world, boss, state, def, struck)
    return
  }
  if (state.chargeTraveled < def.charge.distance) return
  if (state.frenzyLeft > 1) {
    state.frenzyLeft -= 1
    startRecover(state, def.frenzy?.gap ?? 0.5)
    return
  }
  state.frenzyLeft = 0
  startRecover(state, def.charge.recover)
}

function crash(world: World, boss: Enemy, state: BossState, def: BossDef, struck = -1): void {
  world.events.push({ type: 'bossCrash', x: boss.pos.x, y: boss.pos.y })
  if (def.guard) {
    crashGuarded(world, boss, state, def, def.guard)
    return
  }
  if (def.ram) {
    crashRam(world, boss, state, def, def.ram, struck)
    return
  }
  const reach = boss.radius + 0.6
  const column = Math.floor(boss.pos.x + state.chargeX * reach)
  const row = Math.floor(boss.pos.y + state.chargeY * reach)
  igniteKeg(world, row * world.grid.columns + column, CHAIN.chainDelay)
  if (tileAt(world.grid, column, row) === Tile.Rock) {
    const index = row * world.grid.columns + column
    const hits = (world.rocks.get(index) ?? 0) + 1
    world.rocks.set(index, hits)
    if (hits >= BOSS_ROCK_HITS) {
      setTile(world.grid, index, Tile.Floor)
      world.rocks.delete(index)
      invalidateNavigation(world)
      world.events.push({ type: 'rockBroken', x: column + 0.5, y: row + 0.5, index })
    }
  }
  state.frenzyLeft = 0
  state.phase = 'stunned'
  state.timer = def.stunSeconds
  world.events.push({ type: 'bossStunned', x: boss.pos.x, y: boss.pos.y })
}

function rammed(world: World, boss: Enemy, state: BossState, into: LandmarkId): number {
  const { grid, level } = world
  const reach = boss.radius + RAM_CONTACT
  for (let row = Math.floor(boss.pos.y - reach); row <= Math.floor(boss.pos.y + reach); row++) {
    for (let column = Math.floor(boss.pos.x - reach); column <= Math.floor(boss.pos.x + reach); column++) {
      if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) continue
      const index = level.landmarkAt[row * grid.columns + column] ?? -1
      if (index < 0 || level.landmarks[index].id !== into) continue
      const nearX = Math.max(column, Math.min(boss.pos.x, column + 1)) - boss.pos.x
      const nearY = Math.max(row, Math.min(boss.pos.y, row + 1)) - boss.pos.y
      const gap = Math.hypot(nearX, nearY)
      if (gap > reach || (gap > 1e-6 && (nearX * state.chargeX + nearY * state.chargeY) / gap < RAM_FACING)) continue
      return index
    }
  }
  return -1
}

function crashRam(world: World, boss: Enemy, state: BossState, def: BossDef, ram: RamDef, struck: number): void {
  state.frenzyLeft = 0
  const index = struck >= 0 ? struck : crashedInto(world, boss, state, ram.into)
  if (index >= 0) {
    const placement = world.level.landmarks[index]
    const landmark = world.landmarks[index]
    landmark.crashes += 1
    const center = landmarkCenter(placement)
    const left = Math.max(0, ram.stuns - landmark.crashes)
    world.events.push({ type: 'landmarkCrashed', index, id: placement.id, x: center.x, y: center.y, crashes: landmark.crashes, left })
    if (landmark.crashes <= ram.stuns) {
      if (landmark.crashes >= ram.stuns) breakLandmark(world, index)
      state.phase = 'stunned'
      state.timer = def.stunSeconds
      world.events.push({ type: 'bossStunned', x: boss.pos.x, y: boss.pos.y })
      return
    }
  }
  startRecover(state, def.charge.recover)
}

function crashGuarded(world: World, boss: Enemy, state: BossState, def: BossDef, guard: GuardDef): void {
  state.frenzyLeft = 0
  const index = crashedInto(world, boss, state, guard.crashInto)
  if (index >= 0) {
    const placement = world.level.landmarks[index]
    const landmark = world.landmarks[index]
    landmark.crashes += 1
    const center = landmarkCenter(placement)
    const left = Math.max(0, guard.crashStuns - landmark.crashes)
    world.events.push({ type: 'landmarkCrashed', index, id: placement.id, x: center.x, y: center.y, crashes: landmark.crashes, left })
    if (landmark.crashes <= guard.crashStuns) {
      dropShield(world, boss, state, guard)
      state.phase = 'stunned'
      state.timer = def.stunSeconds
      world.events.push({ type: 'bossStunned', x: boss.pos.x, y: boss.pos.y })
      return
    }
  }
  startRecover(state, def.charge.recover)
}

function crashedInto(world: World, boss: Enemy, state: BossState, into: LandmarkId): number {
  const { grid, level } = world
  const reach = boss.radius + 0.6
  const ahead = Math.floor(boss.pos.y + state.chargeY * reach) * grid.columns + Math.floor(boss.pos.x + state.chargeX * reach)
  const match = (cell: number) => {
    const index = level.landmarkAt[cell] ?? -1
    return index >= 0 && level.landmarks[index].id === into ? index : -1
  }
  const direct = match(ahead)
  if (direct >= 0) return direct
  const touch = boss.radius + 0.35
  for (let row = Math.floor(boss.pos.y - touch); row <= Math.floor(boss.pos.y + touch); row++) {
    for (let column = Math.floor(boss.pos.x - touch); column <= Math.floor(boss.pos.x + touch); column++) {
      if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) continue
      const nearX = Math.max(column, Math.min(boss.pos.x, column + 1)) - boss.pos.x
      const nearY = Math.max(row, Math.min(boss.pos.y, row + 1)) - boss.pos.y
      if (Math.hypot(nearX, nearY) > touch || nearX * state.chargeX + nearY * state.chargeY < 0) continue
      const index = match(row * grid.columns + column)
      if (index >= 0) return index
    }
  }
  return -1
}

function dropShield(world: World, boss: Enemy, state: BossState, guard: GuardDef): void {
  const shield = state.shield
  if (!shield) return
  const forwardX = Math.cos(boss.facing)
  const forwardY = Math.sin(boss.facing)
  const spots = [1, -1].map((side) => ({
    x: boss.pos.x + forwardY * guard.dropSide * side - forwardX * guard.dropBack,
    y: boss.pos.y - forwardX * guard.dropSide * side - forwardY * guard.dropBack,
  }))
  const spot = spots.find((item) => !blocksMovement(tileAt(world.grid, Math.floor(item.x), Math.floor(item.y)))) ?? { x: boss.pos.x, y: boss.pos.y }
  shield.held = false
  shield.x = spot.x
  shield.y = spot.y
  shield.facing = boss.facing
  shield.lift = 0
  world.events.push({ type: 'bossShield', held: false, x: spot.x, y: spot.y, facing: boss.facing })
}

function raiseShield(world: World, boss: Enemy, state: BossState): void {
  const shield = state.shield
  if (!shield || shield.held) return
  shield.held = true
  shield.lift = 0
  shield.x = boss.pos.x
  shield.y = boss.pos.y
  world.events.push({ type: 'bossShield', held: true, x: boss.pos.x, y: boss.pos.y, facing: boss.facing })
}

function fireVolley(world: World, boss: Enemy, state: BossState, def: BossDef): void {
  const { player } = world
  const weapon = def.fan?.weapon ?? 'strawFan'
  const angle = Math.atan2(player.pos.y - boss.pos.y, player.pos.x - boss.pos.x)
  boss.facing = angle
  fireEnemyWeapon(world, boss, weapon, angle, state.volleysLeft % 2 === 0 ? 0.5 : 0)
  state.volleysLeft -= 1
  if (state.volleysLeft <= 0) startRecover(state, def.fan?.recover ?? 0.7)
  else state.timer = weaponOf(world, weapon).burstInterval
}

function fireCannon(world: World, boss: Enemy, state: BossState, def: BossDef): void {
  const cannon = def.cannon
  if (!cannon || state.shotsLeft <= 0) {
    startRecover(state, cannon?.recover ?? 0.7)
    return
  }
  boss.facing = boss.aimAngle
  fireEnemyWeapon(world, boss, cannon.weapon, boss.aimAngle)
  state.shotsLeft -= 1
  if (state.shotsLeft <= 0) startRecover(state, cannon.recover)
  else state.timer = cannon.interval
}

function drive(world: World, boss: Enemy, tank: TankState, def: BossDef, tread: TreadDef, dt: number): void {
  tank.reverse = false
  const ring = world.level.ring
  if (!ring) return
  const dx = boss.pos.x - ring.x
  const dy = boss.pos.y - ring.y
  const distance = Math.hypot(dx, dy) || 1
  const outX = dx / distance
  const outY = dy / distance
  const pull = Math.max(-1, Math.min(1, (ring.radius - distance) * tread.pull))
  const steerX = -outY * tank.lap + outX * pull
  const steerY = outX * tank.lap + outY * pull
  const length = Math.hypot(steerX, steerY) || 1
  const ahead = { x: boss.pos.x + (steerX / length) * tread.probe, y: boss.pos.y + (steerY / length) * tread.probe }
  let direction: { x: number; y: number } | null = { x: steerX / length, y: steerY / length }
  if (!corridorClear(world.grid, boss.pos, ahead, boss.radius)) {
    const around = Math.atan2(dy, dx) + tank.lap * tread.lead
    direction = directionTo(world, boss.pos, boss.radius, { x: ring.x + Math.cos(around) * ring.radius, y: ring.y + Math.sin(around) * ring.radius })
  }
  if (!direction) return
  const speed = def.walkSpeed * speedFactor(boss)
  boss.pos.x += direction.x * speed * dt
  boss.pos.y += direction.y * speed * dt
  boss.facing = Math.atan2(direction.y, direction.x)
}

function aimTurret(world: World, boss: Enemy, state: BossState, tank: TankState, tread: TreadDef, dt: number): void {
  if (state.phase === 'stunned') return
  const { player } = world
  const locked = state.move === 'triple' && (state.phase === 'telegraph' || state.phase === 'active')
  const target = locked ? boss.aimAngle : Math.atan2(player.pos.y - boss.pos.y, player.pos.x - boss.pos.x)
  const step = tread.turretDeg * DEGREES * dt
  const diff = angleBetween(target, tank.turret)
  tank.turret = angleBetween(tank.turret + Math.max(-step, Math.min(step, diff)), 0)
}

export function tripleLanes(boss: Enemy, def: BossDef): number[] {
  const triple = def.triple
  if (!triple) return []
  const spread = triple.spreadDeg * DEGREES
  const middle = (triple.barrels - 1) / 2
  return Array.from({ length: triple.barrels }, (_, barrel) => boss.aimAngle + (barrel - middle) * spread)
}

function fireTriple(world: World, boss: Enemy, state: BossState, def: BossDef): void {
  const triple = def.triple
  const tank = state.tank
  if (!triple || !tank || tank.barrels <= 0) {
    startRecover(state, triple?.recover ?? 0)
    return
  }
  const barrel = triple.barrels - tank.barrels
  const angle = tripleLanes(boss, def)[barrel]
  fireEnemyWeapon(world, boss, triple.weapon, angle)
  world.events.push({ type: 'tankShot', barrel, x: boss.pos.x, y: boss.pos.y, angle })
  tank.barrels -= 1
  if (tank.barrels <= 0) startRecover(state, triple.recover)
  else state.timer = triple.interval
}

function tossMine(world: World, boss: Enemy, state: BossState, def: BossDef, dt: number): void {
  const mines = def.mines
  const tank = state.tank
  if (!mines || !tank || tank.minesLeft <= 0) {
    if (tank) tank.hatch = false
    startRecover(state, mines?.recover ?? 0)
    return
  }
  const first = tank.minesLeft === mines.count
  const angle = world.rng.range(0, Math.PI * 2)
  const spread = first ? 0 : world.rng.range(mines.scatterMin, mines.scatter)
  const center = predicted(world, dt, mines.flight * mines.lead)
  const target = { x: center.x + Math.cos(angle) * spread, y: center.y + Math.sin(angle) * spread }
  resolveCircleGrid(target, weaponOf(world, mines.weapon).radius, world.grid)
  const rear = { x: boss.pos.x - Math.cos(boss.facing) * boss.radius, y: boss.pos.y - Math.sin(boss.facing) * boss.radius }
  const hand = muzzleOf(boss)
  const lob = spawnLob(world, 'enemy', rear, target, mines.weapon, 1, attackOf(boss, mines.weapon), mines.flight, hand.z)
  lob.lands = 'mine'
  world.events.push({
    type: 'enemyShot',
    x: rear.x,
    y: rear.y,
    z: hand.z,
    angle: Math.atan2(target.y - rear.y, target.x - rear.x),
    pitch: lobPitch(lob),
    weapon: mines.weapon,
  })
  tank.minesLeft -= 1
  if (tank.minesLeft > 0) {
    state.timer = mines.interval
    return
  }
  tank.hatch = false
  startRecover(state, mines.recover)
}

function predicted(world: World, dt: number, seconds: number): { x: number; y: number } {
  const { player } = world
  if (dt <= 0 || seconds <= 0) return { x: player.pos.x, y: player.pos.y }
  let vx = (player.pos.x - player.prev.x) / dt
  let vy = (player.pos.y - player.prev.y) / dt
  const speed = Math.hypot(vx, vy)
  const cap = world.playerStats.speed
  if (speed > cap && speed > 0) {
    vx *= cap / speed
    vy *= cap / speed
  }
  return { x: player.pos.x + vx * seconds, y: player.pos.y + vy * seconds }
}

function tossBale(world: World, boss: Enemy, state: BossState, def: BossDef, dt: number): void {
  const bales = def.bales
  if (!bales || state.balesLeft <= 0) {
    startRecover(state, bales?.recover ?? 0.8)
    return
  }
  const { player } = world
  const angle = world.rng.range(0, Math.PI * 2)
  const spread = state.balesLeft === bales.count ? 0 : world.rng.range(bales.scatterMin, bales.scatter)
  const flight = bales.flight > 0 ? bales.flight : undefined
  const center = bales.lead > 0 ? predicted(world, dt, (flight ?? 0) * bales.lead) : player.pos
  const target = { x: center.x + Math.cos(angle) * spread, y: center.y + Math.sin(angle) * spread }
  const hand = muzzleOf(boss)
  const lob = spawnLob(world, 'enemy', boss.pos, target, bales.weapon, 1, attackOf(boss, bales.weapon), flight, hand.z)
  if (def.rack) state.bombs = Math.max(0, state.bombs - 1)
  world.events.push({
    type: 'enemyShot',
    x: boss.pos.x,
    y: boss.pos.y,
    z: hand.z,
    angle: Math.atan2(target.y - boss.pos.y, target.x - boss.pos.x),
    pitch: lobPitch(lob),
    weapon: bales.weapon,
  })
  state.balesLeft -= 1
  state.timer = bales.interval
}

function checkSummon(world: World, boss: Enemy, state: BossState, def: BossDef): void {
  if (state.summoned || def.summonAt <= 0 || boss.hp > boss.maxHp * def.summonAt) return
  state.summoned = true
  summon(world, boss, def.summon, def.summonWarning)
  dropHealPack(world, boss)
}

function checkPhase(world: World, boss: Enemy, state: BossState, def: BossDef): void {
  const first = def.phases[0]
  if (state.phaseIndex === 0 && !state.summoned && first?.summon && boss.hp <= boss.maxHp * def.summonAt) {
    state.summoned = true
    summon(world, boss, [first.summon], def.summonWarning)
  }
  const next = def.phases[state.phaseIndex + 1]
  if (!next || boss.hp > boss.maxHp * next.at) return
  state.phaseIndex += 1
  state.order = shuffle(world, next.moves)
  state.moveIndex = 0
  state.hazards = [...next.hazards]
  state.bladeTimer = def.hazards.bladeInterval
  state.frenzyLeft = 0
  state.balesLeft = 0
  state.move = null
  state.phase = 'shift'
  state.timer = def.phaseShift
  world.blasts = world.blasts.filter((blast) => blast.ownerId !== boss.id)
  if (next.summon) summon(world, boss, [next.summon], def.summonWarning)
  dropHealPack(world, boss)
  world.events.push({ type: 'bossPhase', index: state.phaseIndex, name: next.name })
}

function summon(world: World, boss: Enemy, waves: readonly BossSummon[], warning: number): void {
  const { player } = world
  const points = [...world.level.summonPoints].sort(
    (a, b) => Math.hypot(b.x - player.pos.x, b.y - player.pos.y) - Math.hypot(a.x - player.pos.x, a.y - player.pos.y),
  )
  if (points.length === 0) return
  let slot = 0
  for (const wave of waves) {
    const count = Math.max(0, Math.round(wave.count))
    for (let i = 0; i < count; i++) {
      const point = points[slot++ % points.length]
      world.spawns.push({
        id: world.nextId++,
        pos: { x: point.x, y: point.y },
        remaining: warning,
        total: warning,
        kind: wave.kind,
        area: boss.area,
        summoned: true,
      })
      world.events.push({ type: 'spawnWarning', x: point.x, y: point.y })
    }
  }
  world.events.push({ type: 'bossSummon' })
}

function dropHealPack(world: World, boss: Enemy): void {
  const spot = [...world.level.summonPoints].sort(
    (a, b) => Math.hypot(b.x - boss.pos.x, b.y - boss.pos.y) - Math.hypot(a.x - boss.pos.x, a.y - boss.pos.y),
  )[0]
  if (spot) spawnPickup(world, { type: 'heal', amount: BOSS_HEAL }, spot.x, spot.y, { persistent: true, scatter: false })
}

function updateHazards(world: World, boss: Enemy, state: BossState, def: BossDef, dt: number): void {
  if (state.hazards.length === 0) return
  const { player, grid } = world
  if (state.hazards.includes('conveyor') && player.alive && player.rollTime <= 0) {
    const push = world.conveyors.get(Math.floor(player.pos.y) * grid.columns + Math.floor(player.pos.x))
    if (push) {
      player.pos.x += push.x * def.hazards.conveyorSpeed * dt
      player.pos.y += push.y * def.hazards.conveyorSpeed * dt
      resolvePlayer(world)
    }
  }
  if (!state.hazards.includes('blades') || def.hazards.bladeInterval <= 0) return
  state.bladeTimer -= dt
  if (state.bladeTimer > 0) return
  state.bladeTimer = def.hazards.bladeInterval
  const spot = edgeSpot(world, boss, def.hazards.bladeEdge)
  if (!spot) return
  const blade = weaponOf(world, 'fallingBlade')
  spawnBlast(world, {
    x: spot.x,
    y: spot.y,
    radius: blade.radius,
    delay: blade.windup,
    playerDamage: blade.damage,
    enemyDamage: 0,
    source: 'boss',
    ownerId: 0,
    attack: attackOf(boss, 'fallingBlade'),
  })
}

function edgeSpot(world: World, boss: Enemy, edge: number): { x: number; y: number } | null {
  const area = world.level.areas[boss.area]
  if (!area) return null
  const { grid } = world
  const center = boss.home
  let reach = 0
  for (let row = area.top + 1; row < area.bottom - 1; row++) {
    for (let column = 1; column < grid.columns - 1; column++) {
      if (blocksMovement(tileAt(grid, column, row))) continue
      reach = Math.max(reach, Math.hypot(column + 0.5 - center.x, row + 0.5 - center.y))
    }
  }
  for (let attempt = 0; attempt < 16; attempt++) {
    const column = 1 + world.rng.int(grid.columns - 2)
    const row = area.top + 1 + world.rng.int(Math.max(1, area.bottom - area.top - 2))
    const tile = tileAt(grid, column, row)
    if (blocksMovement(tile) || tile === Tile.Gate) continue
    const x = column + 0.5
    const y = row + 0.5
    if (Math.hypot(x - center.x, y - center.y) < reach * edge) continue
    return { x, y }
  }
  return null
}

function shuffle(world: World, moves: readonly BossMoveId[]): BossMoveId[] {
  const order = [...moves]
  for (let i = order.length - 1; i > 0; i--) {
    const j = world.rng.int(i + 1)
    const swap = order[i]
    order[i] = order[j]
    order[j] = swap
  }
  return order
}
