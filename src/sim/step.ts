import { updateAlarms } from './alarms'
import { updateAreas } from './areas'
import { updateBarks } from './barks'
import { updateBlades } from './blades'
import { updateBoss } from './boss'
import { updateBuffs } from './buffs'
import { updateClues } from './clues'
import { updateShaking } from './landmark-state'
import { updateLobs } from './lobs'
import { updateBlasts } from './combat'
import { updateConveyors } from './conveyors'
import { updateEnemies } from './enemies'
import type { Vec2 } from './math'
import { updateMines } from './mines'
import { updateFires } from './props'
import { updateBaits } from './baits'
import { updateFlowField } from './pathing'
import { updatePickups } from './pickups'
import { updatePlayer } from './player'
import { updateBullets } from './projectiles'
import { updateRings } from './rings'
import { updateSecrets } from './secrets'
import { updateSheep } from './sheep'
import { updateSkills } from './skills'
import { updatePlayerStatus } from './status'
import { updateRushes, updateSpawns, updateWaves } from './spawns'
import { bodyHeight, heightsOverlap, resolvePlayer, settleWalker } from './terrain'
import type { Body, Enemy, PlayerCommand } from './types'
import { updateUltimate } from './ultimate'
import type { World } from './world'

export function stepWorld(world: World, command: PlayerCommand, dt: number): void {
  world.tick += 1
  snapshot(world)
  if (world.status === 'complete') return
  let simDt = dt
  if (world.hitstop > 0) {
    world.hitstop = Math.max(0, world.hitstop - dt)
    simDt = dt * world.tuning.feel.hitstopScale
  }
  world.time += simDt
  if (world.status === 'playing') {
    world.stats.time += simDt
    world.stats.areaTime[world.areaIndex] = (world.stats.areaTime[world.areaIndex] ?? 0) + simDt
  }
  updateBuffs(world, simDt)
  updatePlayerStatus(world, simDt)
  updateSkills(world, command, simDt)
  updatePlayer(world, command, simDt)
  updateConveyors(world, simDt)
  updateUltimate(world, command, simDt)
  updatePickups(world, command, simDt)
  updateBullets(world, simDt)
  updateLobs(world, simDt)
  updateFlowField(world.flow, world.grid, world.player.pos)
  updateBaits(world, simDt)
  updateEnemies(world, simDt)
  updateBoss(world, simDt)
  updateRings(world, simDt)
  separateBodies(world)
  updateBlades(world, simDt)
  updateBlasts(world, simDt)
  updateFires(world, simDt)
  updateMines(world, simDt)
  updateShaking(world)
  updateAlarms(world)
  updateRushes(world)
  updateSpawns(world, simDt)
  if (world.level.def.waves && !world.debug.noWaves) updateWaves(world, simDt)
  updateSheep(world, simDt)
  updateClues(world)
  updateSecrets(world)
  updateAreas(world)
  updateBarks(world)
}

function snapshot(world: World): void {
  const { player } = world
  copy(player.prev, player.pos)
  player.prevZ = player.z
  for (const enemy of world.enemies) {
    copy(enemy.prev, enemy.pos)
    enemy.prevZ = enemy.z
  }
  for (const bullet of world.bullets) {
    copy(bullet.prev, bullet.pos)
    bullet.prevZ = bullet.z
  }
  for (const lob of world.lobs) {
    copy(lob.prev, lob.pos)
    lob.prevZ = lob.z
  }
  for (const sheep of world.sheep) copy(sheep.prev, sheep.pos)
}

export function idleCommand(world: World): PlayerCommand {
  const { player } = world
  return {
    moveX: 0,
    moveY: 0,
    aimX: player.pos.x + Math.cos(player.facing) * 20,
    aimY: player.pos.y + Math.sin(player.facing) * 20,
    pitch: player.pitch,
    fire: false,
    slot: null,
    interact: false,
    skill: null,
    ultimate: false,
    jump: false,
    dash: false,
    melee: false,
  }
}

function copy(target: Vec2, source: Vec2): void {
  target.x = source.x
  target.y = source.y
}

function separateBodies(world: World): void {
  const { enemies, player } = world
  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i]
    if (enemy.hp <= 0) continue
    for (let j = i + 1; j < enemies.length; j++) {
      const other = enemies[j]
      if (other.hp > 0 && stacked(enemy, other)) pushApart(enemy, other, mass(enemy), mass(other))
    }
    if (player.alive && heightsOverlap(world, enemy)) pushApart(enemy, player, mass(enemy), mass(enemy) === Infinity ? 1 : Infinity)
  }
  for (const enemy of enemies) {
    if (enemy.hp > 0 && enemy.kind !== 'turret') settleWalker(world, enemy)
  }
  if (player.alive) resolvePlayer(world)
}

function stacked(a: Enemy, b: Enemy): boolean {
  return a.z < b.z + bodyHeight(b) && b.z < a.z + bodyHeight(a)
}

function mass(enemy: Enemy): number {
  return enemy.kind === 'boss' || enemy.kind === 'turret' ? Infinity : 1
}

function pushApart(a: Body, b: Body, massA: number, massB: number): void {
  if (massA === Infinity && massB === Infinity) return
  const dx = a.pos.x - b.pos.x
  const dy = a.pos.y - b.pos.y
  const minDistance = a.radius + b.radius
  const distanceSq = dx * dx + dy * dy
  if (distanceSq >= minDistance * minDistance) return
  const distance = Math.sqrt(distanceSq)
  const normalX = distance > 1e-6 ? dx / distance : 1
  const normalY = distance > 1e-6 ? dy / distance : 0
  const overlap = minDistance - distance
  const shareA = massA === Infinity ? 0 : massB === Infinity ? 1 : massB / (massA + massB)
  const shareB = 1 - shareA
  a.pos.x += normalX * overlap * shareA
  a.pos.y += normalY * overlap * shareA
  b.pos.x -= normalX * overlap * shareB
  b.pos.y -= normalY * overlap * shareB
}
