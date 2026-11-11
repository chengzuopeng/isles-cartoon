import { eyeHeightOf } from '../data/heights'
import { MILESTONE } from '../data/progression'
import { BOMBLET, CONCUSSION_MIN, SKILLS, type BarrierRank, type ConcussionRank, type ShockwaveRank, type SkillBranch, type SkillDef, type SkillId } from '../data/skills'
import { damageEnemy, spawnBlast } from './combat'
import { interruptEnemy } from './enemies'
import { blocksMovement, floorAt, tileAt } from './grid'
import { hasMilestone, refreshStats } from './stats'
import { playerDisabled, stunEnemy } from './status'
import type { PlayerCommand, SkillRuntime } from './types'
import type { World } from './world'

export function rankFor<Rank>(def: SkillDef<Rank>, rank: number, branch: SkillBranch = 'a'): Rank {
  return rank >= 3 && branch === 'b' ? def.branchB : rankOf(def.ranks, rank)
}

export function rankOf<Rank>(ranks: readonly [Rank, Rank, Rank], rank: number): Rank {
  return ranks[Math.min(ranks.length, Math.max(1, Math.round(rank))) - 1]
}

export function skillCooldownOf(world: World, skill: SkillRuntime): number {
  return rankFor<{ cooldown: number }>(SKILLS[skill.id] as SkillDef<{ cooldown: number }>, skill.rank, skill.branch).cooldown * world.playerStats.skillCooldown
}

export function updateSkills(world: World, command: PlayerCommand, dt: number): void {
  const { player } = world
  refreshStats(world)
  for (const skill of player.skills) skill.cooldown = Math.max(0, skill.cooldown - dt)
  player.invulnerable = Math.max(0, player.invulnerable - dt)
  if (player.barrierTime > 0) {
    player.barrierTime -= dt
    if (player.barrierTime <= 0) {
      player.barrierTime = 0
      if (player.barrier > 0 && player.barrierBurst > 0) {
        world.events.push({ type: 'barrierBroken', x: player.pos.x, y: player.pos.y, radius: player.barrierBurst })
        pushEnemies(world, player.barrierBurst, barrierBurstKnockback(), 0, 0)
      }
      player.barrier = 0
      player.barrierReflect = false
    }
  }
  if (!command.skill || !player.alive || world.status !== 'playing' || playerDisabled(player)) return
  const skill = player.skills.find((item) => item.slot === command.skill)
  if (!skill || skill.cooldown > 0) return
  cast(world, skill, command)
}

function cast(world: World, skill: SkillRuntime, command: PlayerCommand): void {
  const { player } = world
  skill.cooldown = skillCooldownOf(world, skill)
  switch (skill.id) {
    case 'concussion':
      throwConcussion(world, rankFor(SKILLS.concussion, skill.rank, skill.branch), command)
      break
    case 'barrier':
      raiseBarrier(world, rankFor(SKILLS.barrier, skill.rank, skill.branch))
      break
    case 'shockwave':
      shockwave(world, rankFor(SKILLS.shockwave, skill.rank, skill.branch))
      break
  }
  world.events.push({ type: 'skillCast', skill: skill.id, x: player.pos.x, y: player.pos.y })
}

export function concussionTarget(world: World, range: number, yaw = world.player.facing, pitch = world.player.pitch): { x: number; y: number } {
  const { player, grid } = world
  const eye = eyeHeightOf('player')
  const aimed = pitch < -0.02 ? eye / Math.tan(-pitch) : range
  const reach = Math.max(CONCUSSION_MIN, Math.min(range, aimed))
  const dirX = Math.cos(yaw)
  const dirY = Math.sin(yaw)
  let landed = reach
  for (let travel = 0.5; travel <= reach; travel += 0.25) {
    if (!blocksMovement(tileAt(grid, Math.floor(player.pos.x + dirX * travel), Math.floor(player.pos.y + dirY * travel)))) continue
    landed = Math.max(0.5, travel - 0.6)
    break
  }
  return { x: player.pos.x + dirX * landed, y: player.pos.y + dirY * landed }
}

function throwConcussion(world: World, rank: ConcussionRank, command: PlayerCommand): void {
  const { player } = world
  const yaw = Math.atan2(command.aimY - player.pos.y, command.aimX - player.pos.x)
  const target = concussionTarget(world, rank.range, yaw, command.pitch)
  spawnBlast(world, {
    x: target.x,
    y: target.y,
    z: floorAt(world.grid, target.x, target.y),
    radius: rank.radius,
    delay: rank.flight,
    playerDamage: 0,
    enemyDamage: rank.damage * world.playerStats.damage,
    source: 'player',
    ownerId: 0,
    stun: rank.stun,
    skill: 'concussion',
    daze: rank.daze,
  })
  for (let i = 0; i < rank.bomblets; i++) {
    const angle = yaw + (i / rank.bomblets) * Math.PI * 2
    const x = target.x + Math.cos(angle) * BOMBLET.spread
    const y = target.y + Math.sin(angle) * BOMBLET.spread
    spawnBlast(world, {
      x,
      y,
      z: floorAt(world.grid, x, y),
      radius: BOMBLET.radius,
      delay: rank.flight + BOMBLET.delay,
      playerDamage: 0,
      enemyDamage: BOMBLET.damage * world.playerStats.damage,
      source: 'player',
      ownerId: 0,
      stun: BOMBLET.stun,
      skill: 'concussion',
    })
  }
}

function raiseBarrier(world: World, rank: BarrierRank): void {
  const { player } = world
  player.barrier = rank.absorb
  player.barrierTime = rank.duration
  player.barrierBurst = rank.burstRadius
  player.barrierReflect = rank.reflect
}

function shockwave(world: World, rank: ShockwaveRank): void {
  const { player } = world
  const struck = rank.pullTo > 0 ? pullEnemies(world, rank) : pushEnemies(world, rank.radius, rank.knockback, rank.damage * world.playerStats.damage, rank.stun)
  closeCircuit(world, 'shockwave', struck)
  world.events.push({ type: 'shockwave', x: player.pos.x, y: player.pos.y, radius: rank.radius })
}

function pullEnemies(world: World, rank: ShockwaveRank): number {
  const { player } = world
  const decay = world.tuning.feel.knockbackDecay
  let struck = 0
  for (const enemy of world.enemies) {
    if (enemy.hp <= 0 || enemy.kind === 'boss' || enemy.kind === 'turret') continue
    const dx = player.pos.x - enemy.pos.x
    const dy = player.pos.y - enemy.pos.y
    const distance = Math.hypot(dx, dy)
    if (distance > rank.radius + enemy.radius || distance < 1e-6) continue
    interruptEnemy(world, enemy)
    const travel = Math.max(0, distance - rank.pullTo)
    enemy.knock.x = (dx / distance) * travel * decay
    enemy.knock.y = (dy / distance) * travel * decay
    if (rank.damage > 0) damageEnemy(world, enemy, rank.damage * world.playerStats.damage, 0, 0, 0)
    if (enemy.hp > 0 && rank.stun > 0) stunEnemy(world, enemy, rank.stun)
    struck += 1
  }
  return struck
}

export function closeCircuit(world: World, id: SkillId, struck: number): void {
  if (struck < MILESTONE.circuitHits || !hasMilestone(world, 'energy5')) return
  const skill = world.player.skills.find((item) => item.id === id)
  if (!skill) return
  skill.cooldown = Math.max(0, skill.cooldown - skillCooldownOf(world, skill) * MILESTONE.circuitRefund)
  world.events.push({ type: 'circuit', skill: id })
}

export function pushEnemies(world: World, radius: number, knockback: number, damage: number, stun: number): number {
  const { player } = world
  let struck = 0
  for (const enemy of world.enemies) {
    if (enemy.hp <= 0 || enemy.boss?.phase === 'dormant') continue
    const dx = enemy.pos.x - player.pos.x
    const dy = enemy.pos.y - player.pos.y
    const distance = Math.hypot(dx, dy)
    if (distance > radius + enemy.radius) continue
    const length = distance > 1e-6 ? distance : 1
    interruptEnemy(world, enemy)
    if (damage > 0) damageEnemy(world, enemy, damage, dx / length, dy / length, knockback)
    else if (enemy.kind !== 'boss' && enemy.kind !== 'turret') {
      enemy.knock.x += (dx / length) * knockback
      enemy.knock.y += (dy / length) * knockback
    }
    if (stun > 0 && enemy.hp > 0) stunEnemy(world, enemy, stun)
    struck += 1
  }
  return struck
}

export function barrierBurstKnockback(): number {
  return SKILLS.barrier.ranks[2].burstKnockback
}
