import { getBoss } from '../data/bosses'
import { BLAST_REACH, bodyHeightOf } from '../data/heights'
import { ELITE } from '../data/elites'
import { ELITE_WEIGHTS } from '../data/loot'
import { BOSS_XP, ELITE_XP, KILL_XP } from '../data/progression'
import type { WeaponId } from '../data/weapons'
import { attackOf, sameAttack } from './attacks'
import { absorbDamage } from './buffs'
import { damageCratesInRadius } from './crates'
import { floorAt } from './grid'
import { blastLandmarks } from './landmark-state'
import { aggro, witnessDeath } from './perception'
import { rollEnemyDrop, rollItem, spawnPickup } from './pickups'
import { barrierBurstKnockback, pushEnemies } from './skills'
import { feelPain, stunEnemy } from './status'
import type { Vec2 } from './math'
import { bodyHeight } from './terrain'
import { chargeUltimate, ultShareOf } from './ultimate'
import type { Attack, Blast, BlastSource, Enemy } from './types'
import { createEnemy, type World } from './world'

export interface HitInfo {
  z?: number
  crit?: boolean
}

export interface BlastSpec {
  x: number
  y: number
  z?: number
  radius: number
  delay: number
  playerDamage: number
  enemyDamage: number
  source: BlastSource
  ownerId: number
  inner?: number
  arcCenter?: number
  arcWidth?: number
  gapCenter?: number
  gapWidth?: number
  attack?: Attack | null
  weapon?: WeaponId | null
  stun?: number
}

export function damagePlayer(
  world: World,
  amount: number,
  dirX: number,
  dirY: number,
  knockback: number,
  attack: Attack | null = null,
  source: Vec2 | null = null,
  shove = false,
): void {
  const { player, tuning } = world
  if (!player.alive || world.status !== 'playing') return
  if (player.invulnerable > 0) {
    world.events.push({ type: 'dodged', x: player.pos.x, y: player.pos.y })
    return
  }
  const scale = world.level.def.bossTuning?.damage
  if (scale !== undefined && world.boss && world.areaIndex === world.boss.area) amount *= scale
  player.sinceDamage = 0
  const push = shove ? 1 : tuning.feel.playerKnockScale
  player.knock.x += dirX * knockback * push
  player.knock.y += dirY * knockback * push
  player.stagger = Math.max(player.stagger, Math.min(tuning.feel.staggerMax, knockback * tuning.feel.staggerPerKnock))
  const blocked = absorbBarrier(world, amount)
  const absorbed = blocked + absorbDamage(world, amount - blocked)
  const damage = amount - absorbed
  if (damage > 0) {
    world.stats.hits += 1
    world.hitstop = Math.max(world.hitstop, tuning.feel.hitstopHurt)
    tallyDamage(world, attack, damage)
  }
  const fromX = source ? source.x : player.pos.x - dirX
  const fromY = source ? source.y : player.pos.y - dirY
  world.events.push({ type: 'playerHit', x: player.pos.x, y: player.pos.y, damage, absorbed, fromX, fromY, knockback })
  if (world.debug.invincible || damage <= 0) return
  player.hp = Math.max(0, player.hp - damage)
  if (player.hp > 0) return
  player.alive = false
  player.burstLeft = 0
  world.status = 'dead'
  world.stats.killedBy = attack
  world.events.push({ type: 'playerDied', x: player.pos.x, y: player.pos.y, attack })
}

function tallyDamage(world: World, attack: Attack | null, damage: number): void {
  const { stats } = world
  stats.damageTaken += damage
  if (!attack) return
  const entry = stats.taken.find((item) => sameAttack(item.attack, attack))
  if (entry) {
    entry.damage += damage
    entry.hits += 1
  } else {
    stats.taken.push({ attack, damage, hits: 1 })
  }
}

function absorbBarrier(world: World, amount: number): number {
  const { player } = world
  if (player.barrier <= 0 || amount <= 0) return 0
  const absorbed = Math.min(player.barrier, amount)
  player.barrier -= absorbed
  if (player.barrier > 0) return absorbed
  player.barrier = 0
  player.barrierTime = 0
  world.events.push({ type: 'barrierBroken', x: player.pos.x, y: player.pos.y, radius: player.barrierBurst })
  if (player.barrierBurst > 0) pushEnemies(world, player.barrierBurst, barrierBurstKnockback(), 0, 0)
  return absorbed
}

export function damageEnemy(
  world: World,
  enemy: Enemy,
  amount: number,
  dirX: number,
  dirY: number,
  knockback: number,
  hit: HitInfo = {},
): void {
  if (enemy.hp <= 0) return
  const phase = enemy.boss?.phase
  if (phase === 'shift') return
  let damage = amount
  if (phase === 'stunned' && enemy.boss) damage *= getBoss(enemy.boss.id).stunDamageScale
  const elite = enemy.elite
  if (elite) {
    elite.sinceHit = 0
    if (elite.shield > 0) {
      const absorbed = Math.min(elite.shield, damage)
      elite.shield -= absorbed
      damage -= absorbed
      if (elite.shield <= 0) world.events.push({ type: 'eliteShieldBroken', id: enemy.id, x: enemy.pos.x, y: enemy.pos.y })
    }
  }
  enemy.hp -= damage
  const pushable = enemy.kind !== 'boss' && enemy.kind !== 'turret'
  if (pushable) {
    enemy.knock.x += dirX * knockback
    enemy.knock.y += dirY * knockback
  }
  world.events.push({
    type: 'enemyHit',
    id: enemy.id,
    x: enemy.pos.x,
    y: enemy.pos.y,
    z: hit.z ?? enemy.z + bodyHeight(enemy) / 2,
    damage: amount,
    crit: hit.crit ?? false,
  })
  aggro(world, enemy)
  if (enemy.hp <= 0) killEnemy(world, enemy, true, true, true, dirX, dirY)
  else if (knockback > 0 || hit.z !== undefined) feelPain(world, enemy, damage)
}

export function killEnemy(world: World, enemy: Enemy, byPlayer: boolean, chain = true, drop = true, dirX = 0, dirY = 0): void {
  enemy.hp = 0
  if (enemy.elite && !enemy.summoned) world.stats.elites += 1
  if (byPlayer) {
    world.stats.kills += 1
    if (enemy.kind !== 'boss') {
      world.rewards.kills += (enemy.elite ? ELITE_XP : KILL_XP[enemy.kind]) * world.chapter
      if (drop && enemy.elite) spawnPickup(world, rollItem(world, ELITE_WEIGHTS), enemy.pos.x, enemy.pos.y, { from: enemy.pos })
      else if (drop) rollEnemyDrop(world, enemy)
    }
  }
  const { feel } = world.tuning
  world.hitstop = Math.max(world.hitstop, enemy.kind === 'boss' ? feel.hitstopBoss : feel.hitstopKill)
  world.events.push({ type: 'enemyKilled', id: enemy.id, kind: enemy.kind, x: enemy.pos.x, y: enemy.pos.y, dirX, dirY })
  if (enemy.kind === 'bomber' && chain) detonateBomber(world, enemy)
  if (enemy.elite && chain) eliteDeath(world, enemy)
  if (enemy.boss) defeatBoss(world, enemy)
  else witnessDeath(world, enemy)
}

function eliteDeath(world: World, enemy: Enemy): void {
  const affixes = enemy.elite?.affixes ?? []
  if (affixes.includes('volatile')) {
    spawnBlast(world, {
      x: enemy.pos.x,
      y: enemy.pos.y,
      z: enemy.z,
      radius: ELITE.volatileRadius,
      delay: ELITE.volatileDelay,
      playerDamage: ELITE.volatileDamage,
      enemyDamage: 0,
      source: 'bomber',
      ownerId: 0,
      attack: attackOf(enemy, 'volatile'),
    })
  }
  if (affixes.includes('splitter') && enemy.kind !== 'boss' && enemy.kind !== 'turret') {
    for (let i = 0; i < ELITE.splitCount; i++) {
      const angle = (i / ELITE.splitCount) * Math.PI * 2 + world.rng.range(0, Math.PI)
      const child = createEnemy(
        world,
        enemy.kind,
        { x: enemy.pos.x + Math.cos(angle) * ELITE.splitSpread, y: enemy.pos.y + Math.sin(angle) * ELITE.splitSpread },
        enemy.area,
        { summoned: enemy.summoned },
      )
      child.maxHp = Math.round(child.maxHp * ELITE.splitHp)
      child.hp = child.maxHp
      child.radius *= ELITE.splitSize
      child.home = { x: enemy.home.x, y: enemy.home.y }
      world.enemies.push(child)
      world.events.push({ type: 'enemySpawned', id: child.id, x: child.pos.x, y: child.pos.y })
      aggro(world, child, 0)
    }
  }
}

function detonateBomber(world: World, bomber: Enemy): void {
  const pending = world.blasts.find((blast) => blast.ownerId === bomber.id)
  if (pending) {
    pending.delay = 0
    return
  }
  const fuse = world.tuning.weapons.fuse
  spawnBlast(world, {
    x: bomber.pos.x,
    y: bomber.pos.y,
    z: bomber.z,
    radius: fuse.radius,
    delay: 0,
    playerDamage: fuse.damage,
    enemyDamage: fuse.enemyDamage,
    source: 'bomber',
    ownerId: bomber.id,
    attack: attackOf(bomber, 'fuse'),
  })
}

function defeatBoss(world: World, boss: Enemy): void {
  if (!boss.boss) return
  const def = getBoss(boss.boss.id)
  world.rewards.boss += BOSS_XP[def.tier] * world.chapter
  boss.boss.hazards = []
  for (const enemy of world.enemies) {
    if (enemy.summoned && enemy.hp > 0) killEnemy(world, enemy, false, false)
  }
  world.spawns = world.spawns.filter((marker) => !marker.summoned)
  world.blasts = world.blasts.filter((blast) => blast.source !== 'boss')
  world.rings = []
  world.lobs = world.lobs.filter((lob) => lob.team !== 'enemy')
  if (world.mines.length > 0) world.mines = []
  const tank = boss.boss.tank
  if (tank) {
    tank.retreat = def.retreat
    tank.reverse = true
    tank.hatch = false
    tank.barrels = 0
    tank.minesLeft = 0
  }
  for (const bullet of world.bullets) {
    if (bullet.team === 'enemy') bullet.traveled = bullet.range
  }
  world.events.push({ type: 'bossDefeated', name: def.name, x: boss.pos.x, y: boss.pos.y })
}

export function spawnBlast(world: World, spec: BlastSpec): Blast {
  const blast: Blast = {
    id: world.nextId++,
    x: spec.x,
    y: spec.y,
    z: spec.z ?? floorAt(world.grid, spec.x, spec.y),
    radius: spec.radius,
    delay: spec.delay,
    total: spec.delay,
    playerDamage: spec.playerDamage,
    enemyDamage: spec.enemyDamage,
    source: spec.source,
    ownerId: spec.ownerId,
    inner: spec.inner ?? 0,
    arcCenter: spec.arcCenter ?? 0,
    arcWidth: spec.arcWidth ?? 0,
    gapCenter: spec.gapCenter ?? 0,
    gapWidth: spec.gapWidth ?? 0,
    attack: spec.attack ?? null,
    weapon: spec.weapon ?? null,
    stun: spec.stun ?? 0,
  }
  world.blasts.push(blast)
  return blast
}

export function insideBlast(blast: Blast, x: number, y: number, margin: number): boolean {
  const dx = x - blast.x
  const dy = y - blast.y
  const distance = Math.hypot(dx, dy)
  if (distance > blast.radius + margin) return false
  if (blast.inner > 0 && distance < blast.inner - margin) return false
  if (distance < 1e-6) return blast.inner <= 0
  const angle = Math.atan2(dy, dx)
  if (blast.arcWidth > 0 && Math.abs(angleBetween(angle, blast.arcCenter)) > blast.arcWidth / 2) return false
  if (blast.gapWidth > 0 && Math.abs(angleBetween(angle, blast.gapCenter)) < blast.gapWidth / 2) return false
  return true
}

export function blastReaches(blast: Blast, feet: number, height: number): boolean {
  return feet <= blast.z + blast.radius * BLAST_REACH.up && feet + height >= blast.z - blast.radius * BLAST_REACH.down
}

export function angleBetween(a: number, b: number): number {
  let diff = a - b
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  return diff
}

export function updateBlasts(world: World, dt: number): void {
  const pending: Blast[] = []
  const ready: Blast[] = []
  for (const blast of world.blasts) {
    blast.delay -= dt
    if (blast.delay <= 0) ready.push(blast)
    else pending.push(blast)
  }
  world.blasts = pending
  for (const blast of ready) detonate(world, blast)
}

function detonate(world: World, blast: Blast): void {
  const { player } = world
  const knockback = world.tuning.feel.blastKnockback
  world.events.push({ type: 'blast', x: blast.x, y: blast.y, z: blast.z, radius: blast.radius, source: blast.source })
  if (blast.playerDamage > 0 && player.alive && insideBlast(blast, player.pos.x, player.pos.y, player.radius) && blastReaches(blast, player.z, bodyHeightOf('player'))) {
    const dx = player.pos.x - blast.x
    const dy = player.pos.y - blast.y
    const distance = Math.hypot(dx, dy)
    const length = distance > 1e-6 ? distance : 1
    damagePlayer(world, blast.playerDamage, dx / length, distance > 1e-6 ? dy / length : 1, knockback, blast.attack, { x: blast.x, y: blast.y })
  }
  if (blast.enemyDamage > 0) {
    for (const enemy of world.enemies) {
      if (enemy.hp <= 0 || enemy.id === blast.ownerId) continue
      if (enemy.boss?.phase === 'dormant') continue
      if (!insideBlast(blast, enemy.pos.x, enemy.pos.y, enemy.radius)) continue
      if (!blastReaches(blast, enemy.z, bodyHeight(enemy))) continue
      const dx = enemy.pos.x - blast.x
      const dy = enemy.pos.y - blast.y
      const distance = Math.hypot(dx, dy)
      const length = distance > 1e-6 ? distance : 1
      damageEnemy(world, enemy, blast.enemyDamage, dx / length, dy / length, knockback)
      if (blast.stun > 0 && enemy.hp > 0) stunEnemy(world, enemy, blast.stun)
      if (blast.source === 'player') chargeUltimate(world, blast.enemyDamage * ultShareOf(world, blast.weapon))
    }
  }
  if (blast.arcWidth <= 0 && blast.gapWidth <= 0 && blast.inner <= 0) {
    damageCratesInRadius(world, blast.x, blast.y, blast.radius, Math.max(blast.playerDamage, blast.enemyDamage))
    blastLandmarks(world, blast)
  }
  const owner = world.enemies.find((enemy) => enemy.id === blast.ownerId)
  if (owner && owner.kind === 'bomber' && owner.hp > 0) killEnemy(world, owner, false, false)
}
