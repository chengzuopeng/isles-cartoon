import { BARKS, BARK_SECONDS, type Bark } from '../data/dialogue'
import { alarmRaised } from './alarms'
import { lineClear } from './collision'
import { fogBlocks } from './fog'
import { blocksSight, floorAt } from './grid'
import { landmarkCenter, targetTally } from './landmark-state'
import type { LandmarkPlacement } from './landmarks'
import { clamp, type Vec2 } from './math'
import { centerOf, playerEye } from './terrain'
import type { Enemy } from './types'
import type { World } from './world'

const SPOT_MATCH = 1.5
const ACTOR_BUBBLE_HEIGHT = 2

interface BarkHit {
  x: number
  y: number
  enemy: number | null
  key?: string
}

export function barksOf(world: World): readonly Bark[] {
  return BARKS[world.level.def.id] ?? []
}

export function resolveBarkEnemies(world: World): Map<string, number> {
  const found = new Map<string, number>()
  for (const bark of barksOf(world)) {
    const trigger = bark.trigger
    if (trigger.on !== 'spotted') continue
    const area = world.level.areas[trigger.area]
    if (!area) continue
    const x = trigger.at[0] + 0.5
    const y = area.top + trigger.at[1] + 0.5
    let best: Enemy | null = null
    let bestDistance = SPOT_MATCH
    for (const enemy of world.enemies) {
      if (enemy.area !== trigger.area || enemy.kind === 'boss') continue
      const distance = Math.hypot(enemy.pos.x - x, enemy.pos.y - y)
      if (distance < bestDistance) {
        best = enemy
        bestDistance = distance
      }
    }
    if (best) found.set(bark.id, best.id)
  }
  return found
}

export function updateBarks(world: World, barks: readonly Bark[] = barksOf(world)): void {
  if (world.status !== 'playing' || !world.player.alive) return
  for (const bark of barks) {
    if (world.barks.has(bark.id)) continue
    const hit = triggered(world, bark)
    if (!hit) continue
    const actor = bark.actorArea === world.areaIndex
      ? world.level.actors.find((placement) => placement.area === bark.actorArea && placement.speaker === bark.speaker)
      : undefined
    world.barks.set(hit.key ?? bark.id, world.time)
    world.events.push({
      type: 'bark',
      id: bark.id,
      speaker: bark.speaker,
      text: bark.text,
      display: bark.display,
      enemy: hit.enemy,
      x: actor?.x ?? hit.x,
      y: actor?.y ?? hit.y,
      ...(actor ? { z: floorAt(world.grid, actor.x, actor.y) + ACTOR_BUBBLE_HEIGHT } : {}),
      seconds: BARK_SECONDS,
      ...(bark.radio ? { radio: true } : {}),
    })
  }
}

function triggered(world: World, bark: Bark): BarkHit | null {
  const { player } = world
  const trigger = bark.trigger
  switch (trigger.on) {
    case 'enter':
      return world.areas[trigger.area]?.visited ? at(player.pos) : null
    case 'targets':
      return targetTally(world).done >= trigger.count ? at(player.pos) : null
    case 'near': {
      for (const placement of world.level.landmarks) {
        if (placement.id === trigger.landmark && reach(placement, player.pos) <= trigger.radius) return at(landmarkCenter(placement))
      }
      return null
    }
    case 'spotted': {
      const id = world.barkEnemies.get(bark.id)
      const enemy = world.enemies.find((item) => item.id === id)
      if (!enemy || enemy.hp <= 0 || !enemy.aggro) return null
      return { x: enemy.pos.x, y: enemy.pos.y, enemy: enemy.id }
    }
    case 'sees': {
      for (const enemy of world.enemies) {
        if (enemy.kind !== trigger.kind || enemy.hp <= 0) continue
        if (Math.hypot(enemy.pos.x - player.pos.x, enemy.pos.y - player.pos.y) > trigger.range) continue
        if (fogBlocks(world, player.pos, enemy.pos)) continue
        if (lineClear(world.grid, playerEye(player), centerOf(enemy), blocksSight)) return at(player.pos)
      }
      return null
    }
    case 'runner': {
      for (const alarm of world.alarms) {
        if (alarm.status !== 'running' || alarm.runner === null) continue
        const key = `${bark.id}:${alarm.runner}`
        if (world.barks.has(key)) continue
        const enemy = world.enemies.find((item) => item.id === alarm.runner)
        if (!enemy || enemy.hp <= 0) continue
        return { x: enemy.pos.x, y: enemy.pos.y, enemy: enemy.id, key }
      }
      return null
    }
    case 'alarm':
      return alarmRaised(world) ? at(player.pos) : null
    case 'clue':
      return world.cluesFound.includes(trigger.clue) ? at(player.pos) : null
    case 'blade':
      return world.level.blades.some((lane, index) => lane.area === world.areaIndex && world.blades[index].phase === 'warning') ? at(player.pos) : null
    case 'elite': {
      for (const enemy of world.enemies) {
        if (!enemy.elite || enemy.hp <= 0) continue
        if (Math.hypot(enemy.pos.x - player.pos.x, enemy.pos.y - player.pos.y) > trigger.range) continue
        if (fogBlocks(world, player.pos, enemy.pos)) continue
        if (lineClear(world.grid, playerEye(player), centerOf(enemy), blocksSight)) return at(player.pos)
      }
      return null
    }
    case 'after': {
      const fired = world.barks.get(trigger.bark)
      return fired !== undefined && world.time - fired >= trigger.seconds ? at(player.pos) : null
    }
  }
}

function reach(placement: LandmarkPlacement, pos: Vec2): number {
  const dx = pos.x - clamp(pos.x, placement.column, placement.column + placement.width)
  const dy = pos.y - clamp(pos.y, placement.row, placement.row + placement.depth)
  return Math.hypot(dx, dy)
}

function at(pos: Vec2): BarkHit {
  return { x: pos.x, y: pos.y, enemy: null }
}
