import { weaponOf } from '../arsenal'
import { attackOf } from '../attacks'
import { spawnBlast } from '../combat'
import type { Vec2 } from '../math'
import { pursue } from '../steering'
import type { Enemy } from '../types'
import type { World } from '../world'
import { setState, still, type EnemyBehavior } from './kit'

export const bomber: EnemyBehavior = {
  act,
  interrupt,
  holdsOn: (enemy) => enemy.state === 'arming',
}

function act(world: World, enemy: Enemy): Vec2 {
  const { player } = world
  const config = world.tuning.bomber
  if (enemy.state === 'arming' || !player.alive) return still()
  const distance = Math.hypot(player.pos.x - enemy.pos.x, player.pos.y - enemy.pos.y)
  if (distance <= config.triggerRange && enemy.cooldown === 0) {
    const fuse = weaponOf(world, 'fuse')
    setState(enemy, 'arming')
    spawnBlast(world, {
      x: enemy.pos.x,
      y: enemy.pos.y,
      z: enemy.z,
      radius: fuse.radius,
      delay: fuse.windup,
      playerDamage: fuse.damage,
      enemyDamage: fuse.enemyDamage,
      source: 'bomber',
      ownerId: enemy.id,
      attack: attackOf(enemy, 'fuse'),
    })
    world.events.push({ type: 'enemyWindup', id: enemy.id })
    return still()
  }
  return pursue(world, enemy, config.speed)
}

function interrupt(world: World, enemy: Enemy): void {
  if (enemy.state !== 'arming') return
  world.blasts = world.blasts.filter((blast) => blast.ownerId !== enemy.id)
  setState(enemy, 'chase')
  enemy.cooldown = world.tuning.ai.bomberRearm
}
