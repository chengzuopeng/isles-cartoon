import { SKILLS, type BarrierRank, type RollRank, type ShockwaveRank } from '../data/skills'
import { damageEnemy } from './combat'
import { interruptEnemy } from './enemies'
import { refreshStats } from './stats'
import { playerDisabled, stunEnemy } from './status'
import type { PlayerCommand, SkillRuntime } from './types'
import type { World } from './world'

export function rankOf<Rank>(ranks: readonly [Rank, Rank, Rank], rank: number): Rank {
  return ranks[Math.min(ranks.length, Math.max(1, Math.round(rank))) - 1]
}

export function skillCooldownOf(world: World, skill: SkillRuntime): number {
  return rankOf<{ cooldown: number }>(SKILLS[skill.id].ranks, skill.rank).cooldown * world.playerStats.skillCooldown
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
      player.barrier = 0
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
    case 'roll':
      roll(world, rankOf<RollRank>(SKILLS.roll.ranks, skill.rank), command)
      break
    case 'barrier':
      raiseBarrier(world, rankOf<BarrierRank>(SKILLS.barrier.ranks, skill.rank))
      break
    case 'shockwave':
      shockwave(world, rankOf<ShockwaveRank>(SKILLS.shockwave.ranks, skill.rank))
      break
  }
  world.events.push({ type: 'skillCast', skill: skill.id, x: player.pos.x, y: player.pos.y })
}

function roll(world: World, rank: RollRank, command: PlayerCommand): void {
  const { player } = world
  const length = Math.hypot(command.moveX, command.moveY)
  const dirX = length > 0.01 ? command.moveX / length : Math.cos(player.facing)
  const dirY = length > 0.01 ? command.moveY / length : Math.sin(player.facing)
  player.rollTime = rank.duration
  player.rollDirX = dirX
  player.rollDirY = dirY
  player.rollSpeed = rank.distance / Math.max(0.05, rank.duration)
  player.invulnerable = Math.max(player.invulnerable, rank.duration)
  if (rank.empower > 0) player.empowered = rank.empower
}

function raiseBarrier(world: World, rank: BarrierRank): void {
  const { player } = world
  player.barrier = rank.absorb
  player.barrierTime = rank.duration
  player.barrierBurst = rank.burstRadius
}

function shockwave(world: World, rank: ShockwaveRank): void {
  const { player } = world
  pushEnemies(world, rank.radius, rank.knockback, rank.damage * world.playerStats.damage, rank.stun)
  world.events.push({ type: 'shockwave', x: player.pos.x, y: player.pos.y, radius: rank.radius })
}

export function pushEnemies(world: World, radius: number, knockback: number, damage: number, stun: number): void {
  const { player } = world
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
  }
}

export function barrierBurstKnockback(): number {
  return SKILLS.barrier.ranks[2].burstKnockback
}
