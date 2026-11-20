import { FOOD_HEAL, type FoodKind } from '../data/loot'
import { MILESTONE } from '../data/progression'
import {
  BOLT_ARRIVE_LINES,
  BOLT_CAMEO,
  BOLT_RETREAT_LINES,
  COURIER,
  COURIER_LINES,
  RARE_SEED_SALT,
} from '../data/rare-events'
import { SPECIAL_WEAPONS, type PlayerWeaponId } from '../data/weapons'
import { addBounty, failBounty } from './bounties'
import { spawnBlast } from './combat'
import { still } from './enemies/kit'
import { Tile, blocksMovement, floorAt, tileAt } from './grid'
import { insideRegion, type BuiltLevel } from './level'
import type { Vec2 } from './math'
import { directionTo, distanceField, roomy, tileIndex } from './navigation'
import { spawnPickup, weaponItem } from './pickups'
import { createRng, type Rng } from './rng'
import { hasMilestone } from './stats'
import type { Blast, Enemy, SpawnMarker } from './types'
import { createEnemy, type World } from './world'

export interface RareEventOptions {
  rareEvents?: boolean
  replay?: boolean
  chapter1Cleared?: boolean
  unlockedWeapons?: readonly PlayerWeaponId[]
}

export interface CourierRuntime {
  area: number
  spawned: boolean
  enemyId: number | null
  exit: Vec2 | null
  fleeing: boolean
  fleeLeft: number
  leaked: number
}

export interface BoltPodLanding {
  area: number
  blast: Blast
}

export interface BoltRuntime {
  rushIndex: number
  triggered: boolean
  waveMarkers: number[]
  waveEnemies: number[]
  waveTotal: number
  landing: BoltPodLanding | null
  enemyId: number | null
  ejected: boolean
}

export interface RareEventState {
  rng: Rng
  unlockedWeapons: PlayerWeaponId[]
  courier: CourierRuntime | null
  bolt: BoltRuntime | null
}

/**
 * 创建本局稀有事件状态（运粮兵与螺栓上尉客串）
 * @param level - 已构建的关卡数据
 * @param seed - 本局随机种子
 * @param options - 稀有事件开启与解锁上下文
 * @returns 稀有事件运行时状态
 */
export function createRareEventState(level: BuiltLevel, seed: number, options: RareEventOptions = {}): RareEventState {
  const rng = createRng(seed ^ RARE_SEED_SALT)
  const unlockedWeapons = [...(options.unlockedWeapons ?? [])]
  let courier: CourierRuntime | null = null
  let bolt: BoltRuntime | null = null

  if (options.rareEvents && !level.def.waves) {
    const skipFirst = !options.replay && level.def.id === COURIER.skipFirstLevel
    if (!skipFirst) {
      const eligible = level.areas.filter((area, index) => index > 0 && area.kind !== 'boss')
      const chance = options.replay ? COURIER.replayChance : COURIER.firstChance
      if (eligible.length > 0 && rng.next() < chance) {
        const picked = eligible[rng.int(eligible.length)]
        courier = {
          area: picked.index,
          spawned: false,
          enemyId: null,
          exit: null,
          fleeing: false,
          fleeLeft: COURIER.fleeSeconds,
          leaked: 0,
        }
      }
    }

    if (options.replay && options.chapter1Cleared && level.rushes.length > 0 && rng.next() < BOLT_CAMEO.chance) {
      bolt = {
        rushIndex: rng.int(level.rushes.length),
        triggered: false,
        waveMarkers: [],
        waveEnemies: [],
        waveTotal: 0,
        landing: null,
        enemyId: null,
        ejected: false,
      }
    }
  }

  return { rng, unlockedWeapons, courier, bolt }
}

/**
 * 记录冲锋波触发，供螺栓上尉客串判定该波过半时机
 * @param world - 当前世界状态
 * @param rushIndex - 冲锋波索引
 * @param markers - 本波生成的出生预警标记
 */
export function noteRushForRareEvents(world: World, rushIndex: number, markers: readonly SpawnMarker[]): void {
  const bolt = world.rare.bolt
  if (!bolt || bolt.triggered || bolt.rushIndex !== rushIndex || markers.length === 0) return
  bolt.waveMarkers = markers.map((marker) => marker.id)
  bolt.waveEnemies = []
  bolt.waveTotal = markers.length
}

/**
 * 记录出生预警标记转化为实体敌人，追踪目标冲锋波存活数
 * @param world - 当前世界状态
 * @param markerId - 出生标记 ID
 * @param enemyId - 新生成的敌人 ID
 */
export function noteSpawnForRareEvents(world: World, markerId: number, enemyId: number): void {
  const bolt = world.rare.bolt
  if (!bolt || bolt.waveTotal <= 0) return
  const index = bolt.waveMarkers.indexOf(markerId)
  if (index < 0) return
  bolt.waveMarkers.splice(index, 1)
  bolt.waveEnemies.push(enemyId)
}

/**
 * 在指定区域生成背麻袋的运粮兵，并挂上「抓住它」悬赏
 * @param world - 当前世界状态
 * @param areaIndex - 目标区域下标
 * @param customPos - 可选的强制出生坐标（调试或测试用）
 * @returns 生成的运粮兵实体，若无合法位置则返回 null
 */
export function spawnCourier(world: World, areaIndex = world.areaIndex, customPos?: Vec2): Enemy | null {
  if (world.rare.courier?.enemyId != null) return null
  const area = world.level.areas[areaIndex]
  if (!area) return null
  const spot = customPos ? { x: customPos.x, y: customPos.y } : findFarthestCorner(world, areaIndex)
  if (!spot) return null
  const exit = findAreaExit(world, areaIndex, spot)
  const enemy = createEnemy(world, 'grunt', spot, areaIndex, { summoned: true, role: 'courier' })
  enemy.hp = COURIER.hp
  enemy.maxHp = COURIER.hp
  enemy.facing = Math.atan2(world.player.pos.y - spot.y, world.player.pos.x - spot.x)
  enemy.baseFacing = enemy.facing
  world.enemies.push(enemy)
  world.rare.courier = {
    area: areaIndex,
    spawned: true,
    enemyId: enemy.id,
    exit,
    fleeing: false,
    fleeLeft: COURIER.fleeSeconds,
    leaked: 0,
  }
  addBounty(world, 'courier')
  world.events.push({ type: 'courierSpawned', id: enemy.id, x: enemy.pos.x, y: enemy.pos.y })
  return enemy
}

/**
 * 呼叫螺栓上尉的逃生舱空投（1.5 秒落点预警）
 * @param world - 当前世界状态
 * @param customPos - 可选的强制落点坐标（调试或测试用）
 * @returns 空投落点运行时数据，若无合法空地则返回 null
 */
export function callBoltCameo(world: World, customPos?: Vec2): BoltPodLanding | null {
  const bolt = world.rare.bolt
  if (bolt && (bolt.landing || bolt.enemyId !== null)) return null
  const spot = customPos ? { x: customPos.x, y: customPos.y } : findPodLandingSpot(world, world.areaIndex)
  if (!spot) return null
  const z = floorAt(world.grid, spot.x, spot.y)
  const blast = spawnBlast(world, {
    x: spot.x,
    y: spot.y,
    z,
    radius: BOLT_CAMEO.blastRadius,
    delay: BOLT_CAMEO.warning,
    playerDamage: BOLT_CAMEO.blastDamage,
    enemyDamage: BOLT_CAMEO.blastDamage,
    source: 'pod',
    ownerId: 0,
    attack: { by: 'turret', cause: 'pod', elite: false, boss: null },
    chainable: false,
  })
  const landing = { area: world.areaIndex, blast }
  if (!bolt) {
    world.rare.bolt = {
      rushIndex: -1,
      triggered: true,
      waveMarkers: [],
      waveEnemies: [],
      waveTotal: 0,
      landing,
      enemyId: null,
      ejected: false,
    }
  } else {
    bolt.triggered = true
    bolt.landing = landing
  }
  world.events.push({ type: 'boltIncoming', x: spot.x, y: spot.y, z, delay: BOLT_CAMEO.warning })
  return landing
}

/**
 * 每步推进稀有事件的触发与逃生舱落地展开
 * @param world - 当前世界状态
 */
export function updateRareEvents(world: World): void {
  if (world.status !== 'playing' || !world.player.alive) return
  const { courier, bolt } = world.rare

  if (courier && !courier.spawned && world.areaIndex === courier.area) {
    courier.spawned = true
    spawnCourier(world, courier.area)
  }

  if (bolt && !bolt.triggered && bolt.waveTotal > 0 && world.level.rushes[bolt.rushIndex]?.area === world.areaIndex) {
    const aliveEnemies = bolt.waveEnemies.filter((id) => world.enemies.some((enemy) => enemy.id === id && enemy.hp > 0)).length
    const remaining = bolt.waveMarkers.length + aliveEnemies
    const defeated = bolt.waveTotal - remaining
    if (defeated >= Math.ceil(bolt.waveTotal * BOLT_CAMEO.halfShare)) {
      bolt.triggered = true
      callBoltCameo(world)
    }
  }

  // 爆炸在本步先结算，炮台随后入场。
  if (bolt?.landing && bolt.landing.blast.delay <= 0) {
    const landing = bolt.landing
    bolt.landing = null
    landBoltPod(world, bolt, landing)
  }
}

/**
 * 运粮兵被惊动后的逃跑行为：冒道歉气泡、沿路奔向区域出口、超时或到出口翻墙消失
 * @param world - 当前世界状态
 * @param enemy - 运粮兵实体
 * @param dt - 逻辑步时长（秒）
 * @returns 本步期望水平速度向量
 */
export function actCourier(world: World, enemy: Enemy, dt: number): Vec2 {
  const courier = world.rare.courier
  if (!courier || courier.enemyId !== enemy.id) return still()

  if (!courier.fleeing) {
    courier.fleeing = true
    const line = COURIER_LINES[world.rare.rng.int(COURIER_LINES.length)]
    world.events.push({
      type: 'bark',
      id: `courier-sorry-${enemy.id}`,
      speaker: null,
      text: line,
      display: 'bubble',
      enemy: enemy.id,
      x: enemy.pos.x,
      y: enemy.pos.y,
      seconds: COURIER.barkSeconds,
    })
  }

  courier.fleeLeft -= dt
  const exit = courier.exit
  const nearExit = exit !== null && Math.hypot(enemy.pos.x - exit.x, enemy.pos.y - exit.y) <= COURIER.exitReach
  if (courier.fleeLeft <= 0 || nearExit) {
    escapeCourier(world, enemy)
    return still()
  }

  const direction = exit ? directionTo(world, enemy.pos, enemy.radius, exit) : null
  if (direction) {
    enemy.facing = Math.atan2(direction.y, direction.x)
    return { x: direction.x * COURIER.speed, y: direction.y * COURIER.speed }
  }
  const awayX = enemy.pos.x - world.player.pos.x
  const awayY = enemy.pos.y - world.player.pos.y
  const length = Math.hypot(awayX, awayY)
  if (length < 1e-6) return still()
  enemy.facing = Math.atan2(awayY, awayX)
  return { x: (awayX / length) * COURIER.speed, y: (awayY / length) * COURIER.speed }
}

/**
 * 处理稀有敌人受击后的特殊结算（运粮兵每掉 25% 血漏粮；螺栓上尉 30% 血锁血弹射留宝箱）
 * @param world - 当前世界状态
 * @param enemy - 受击敌人
 * @returns 若返回 true 表示该敌人已通过弹射退场，调用方不再执行死亡散架逻辑
 */
export function onRareEnemyDamaged(world: World, enemy: Enemy): boolean {
  if (enemy.role === 'courier') {
    const courier = world.rare.courier
    if (courier && courier.enemyId === enemy.id && enemy.hp > 0) {
      const lostShare = (enemy.maxHp - enemy.hp) / enemy.maxHp
      const targetLeaks = Math.min(COURIER.maxLeaks, Math.floor((lostShare + 1e-6) / COURIER.leakShare))
      while (courier.leaked < targetLeaks) {
        courier.leaked += 1
        dropCourierFood(world, enemy.pos, courier.leaked)
        world.events.push({ type: 'courierLeaked', id: enemy.id, leaked: courier.leaked, x: enemy.pos.x, y: enemy.pos.y })
      }
    }
    return false
  }

  if (enemy.role === 'bolt' && enemy.hp <= enemy.maxHp * BOLT_CAMEO.retreatShare) {
    ejectBoltPod(world, enemy)
    return true
  }

  return false
}

/**
 * 处理运粮兵被击倒时的专属掉落、经验与悬赏完成事件
 * @param world - 当前世界状态
 * @param enemy - 被击倒的运粮兵
 */
export function onCourierKilled(world: World, enemy: Enemy): void {
  world.rewards.kills += COURIER.xp * world.chapter
  for (let i = 0; i < COURIER.foodDrops; i++) {
    dropCourierFood(world, enemy.pos, enemy.id + i)
  }
  spawnPickup(world, { type: 'ammo' }, enemy.pos.x, enemy.pos.y, { from: enemy.pos })
  const unowned = SPECIAL_WEAPONS.filter((id) => !world.rare.unlockedWeapons.includes(id))
  if (unowned.length > 0 && world.lootRng.next() < COURIER.weaponChance) {
    const picked = unowned[world.lootRng.int(unowned.length)]
    spawnPickup(world, weaponItem(world, picked), enemy.pos.x, enemy.pos.y, { persistent: true, from: enemy.pos })
  }
  world.events.push({ type: 'courierCaught', x: enemy.pos.x, y: enemy.pos.y })
}

function dropCourierFood(world: World, pos: Vec2, index: number): void {
  const food: FoodKind = index % 2 === 0 ? 'bread' : 'apple'
  const amount = hasMilestone(world, 'brawl2') ? MILESTONE.foodHeal : FOOD_HEAL
  spawnPickup(world, { type: 'heal', amount, food }, pos.x, pos.y, { from: pos })
}

function escapeCourier(world: World, enemy: Enemy): void {
  enemy.hp = 0
  failBounty(world, 'courier')
  world.events.push({ type: 'courierEscaped', id: enemy.id, x: enemy.pos.x, y: enemy.pos.y, z: enemy.z })
}

function landBoltPod(world: World, bolt: BoltRuntime, landing: BoltPodLanding): void {
  const { x, y, z } = landing.blast
  const enemy = createEnemy(world, 'turret', { x, y }, landing.area, { summoned: true, role: 'bolt' })
  enemy.hp = BOLT_CAMEO.hp
  enemy.maxHp = BOLT_CAMEO.hp
  enemy.aggro = true
  enemy.alert = 'combat'
  enemy.facing = Math.atan2(world.player.pos.y - y, world.player.pos.x - x)
  world.enemies.push(enemy)
  bolt.enemyId = enemy.id
  world.events.push({ type: 'boltLanded', id: enemy.id, x, y, z })
  const line = BOLT_ARRIVE_LINES[world.rare.rng.int(BOLT_ARRIVE_LINES.length)]
  world.events.push({
    type: 'bark',
    id: `bolt-cameo-arrive-${enemy.id}`,
    speaker: 'bolt',
    text: line,
    display: 'bar',
    enemy: null,
    x,
    y,
    seconds: BOLT_CAMEO.barkSeconds,
    radio: true,
  })
}

function ejectBoltPod(world: World, enemy: Enemy): void {
  enemy.hp = 0
  const bolt = world.rare.bolt
  if (bolt?.ejected) return
  if (bolt) bolt.ejected = true
  world.rewards.kills += BOLT_CAMEO.xp * world.chapter
  world.chests.push({
    id: world.nextId++,
    tier: 'weapon',
    pos: { x: enemy.pos.x, y: enemy.pos.y },
    area: enemy.area,
    opened: false,
    weapon: null,
    perch: null,
  })
  world.events.push({ type: 'boltEjected', id: enemy.id, x: enemy.pos.x, y: enemy.pos.y, z: enemy.z })
  const line = BOLT_RETREAT_LINES[world.rare.rng.int(BOLT_RETREAT_LINES.length)]
  world.events.push({
    type: 'bark',
    id: `bolt-cameo-retreat-${enemy.id}`,
    speaker: 'bolt',
    text: line,
    display: 'bar',
    enemy: null,
    x: enemy.pos.x,
    y: enemy.pos.y,
    seconds: BOLT_CAMEO.barkSeconds,
    radio: true,
  })
}

function inSecret(level: BuiltLevel, x: number, y: number): boolean {
  return level.secrets.some((secret) => insideRegion(secret, x, y))
}

function findFarthestCorner(world: World, areaIndex: number): Vec2 | null {
  const { grid, level, player, tuning } = world
  const area = level.areas[areaIndex]
  if (!area) return null
  const field = distanceField(grid, [tileIndex(grid, player.pos)])
  const pick = (strictRoom: boolean): Vec2 | null => {
    let best: Vec2 | null = null
    let bestScore = -1
    for (let row = area.top; row < area.bottom; row++) {
      for (let column = 1; column < grid.columns - 1; column++) {
        const cell = row * grid.columns + column
        if (!Number.isFinite(field[cell])) continue
        const tile = tileAt(grid, column, row)
        if (blocksMovement(tile) || tile === Tile.Exit) continue
        const x = column + 0.5
        const y = row + 0.5
        if (inSecret(level, x, y)) continue
        if (strictRoom && !roomy(grid, column, row, tuning.grunt.radius)) continue
        const dist = Math.hypot(x - player.pos.x, y - player.pos.y)
        const score = dist + field[cell] * 0.25
        if (score > bestScore) {
          bestScore = score
          best = { x, y }
        }
      }
    }
    return best
  }
  const chosen = pick(true) ?? pick(false)
  if (!chosen) return null
  if (Math.hypot(chosen.x - player.pos.x, chosen.y - player.pos.y) < COURIER.minSpawnDistance && level.areas.length > 1) return null
  return chosen
}

function findAreaExit(world: World, areaIndex: number, fromPos: Vec2): Vec2 {
  const { grid, level } = world
  const area = level.areas[areaIndex]
  const field = distanceField(grid, [tileIndex(grid, fromPos)])

  let bestExit: Vec2 | null = null
  let bestExitSteps = Infinity
  for (const exitCell of level.exits) {
    const row = Math.floor(exitCell / grid.columns)
    if (row < area.top || row >= area.bottom || !Number.isFinite(field[exitCell])) continue
    if (field[exitCell] < bestExitSteps) {
      bestExitSteps = field[exitCell]
      bestExit = { x: (exitCell % grid.columns) + 0.5, y: row + 0.5 }
    }
  }
  if (bestExit) return bestExit

  if (area.gates.length > 0) {
    const northGates = area.gates.filter((cell) => Math.floor(cell / grid.columns) === area.top)
    const targets = northGates.length > 0 ? northGates : area.gates
    let gateSpot: Vec2 | null = null
    let bestSteps = Infinity
    for (const gate of targets) {
      const col = gate % grid.columns
      const gateRow = Math.floor(gate / grid.columns)
      for (const candidateRow of [gateRow, gateRow + 1]) {
        if (candidateRow < 0 || candidateRow >= grid.rows) continue
        const cell = candidateRow * grid.columns + col
        if (!Number.isFinite(field[cell])) continue
        if (field[cell] < bestSteps) {
          bestSteps = field[cell]
          gateSpot = { x: col + 0.5, y: candidateRow + 0.5 }
        }
      }
    }
    if (gateSpot) return gateSpot
  }

  let minRow = Infinity
  const rowCells: number[] = []
  for (let row = area.top; row < area.bottom; row++) {
    for (let column = 1; column < grid.columns - 1; column++) {
      const cell = row * grid.columns + column
      if (!Number.isFinite(field[cell])) continue
      if (inSecret(level, column + 0.5, row + 0.5)) continue
      if (row < minRow) {
        minRow = row
        rowCells.length = 0
        rowCells.push(cell)
      } else if (row === minRow) {
        rowCells.push(cell)
      }
    }
  }
  if (rowCells.length > 0 && minRow < Math.floor(fromPos.y) - 2) {
    const middle = rowCells[Math.floor(rowCells.length / 2)]
    return { x: (middle % grid.columns) + 0.5, y: Math.floor(middle / grid.columns) + 0.5 }
  }

  let farthest = { x: fromPos.x, y: fromPos.y }
  let bestSteps = -1
  for (let row = area.top; row < area.bottom; row++) {
    for (let column = 1; column < grid.columns - 1; column++) {
      const cell = row * grid.columns + column
      if (!Number.isFinite(field[cell]) || inSecret(level, column + 0.5, row + 0.5)) continue
      if (field[cell] > bestSteps) {
        bestSteps = field[cell]
        farthest = { x: column + 0.5, y: row + 0.5 }
      }
    }
  }
  return farthest
}

function findPodLandingSpot(world: World, areaIndex: number): Vec2 | null {
  const { grid, level, player, tuning } = world
  const area = level.areas[areaIndex]
  if (!area) return null
  const field = distanceField(grid, [tileIndex(grid, player.pos)])
  const preferred: Vec2[] = []
  const fallback: Vec2[] = []
  const clearance = tuning.turret.radius + 0.25

  for (let row = area.top + 1; row < area.bottom - 1; row++) {
    for (let column = 1; column < grid.columns - 1; column++) {
      const cell = row * grid.columns + column
      if (!Number.isFinite(field[cell]) || !roomy(grid, column, row, clearance)) continue
      const x = column + 0.5
      const y = row + 0.5
      if (inSecret(level, x, y)) continue
      if (world.chests.some((chest) => Math.hypot(chest.pos.x - x, chest.pos.y - y) < 1.8)) continue
      if (world.supplies.some((supply) => Math.hypot(supply.pos.x - x, supply.pos.y - y) < 1.8)) continue
      const dist = Math.hypot(x - player.pos.x, y - player.pos.y)
      if (dist >= BOLT_CAMEO.dropMinRange && dist <= BOLT_CAMEO.dropMaxRange) preferred.push({ x, y })
      else if (dist >= 2.5) fallback.push({ x, y })
    }
  }

  const pool = preferred.length > 0 ? preferred : fallback
  if (pool.length === 0) return null
  return pool[world.rare.rng.int(pool.length)]
}
