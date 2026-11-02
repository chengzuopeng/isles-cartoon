import { ALARM } from '../data/alarms'
import { landmarkCenter } from './landmark-state'
import type { BuiltLevel } from './level'
import type { Vec2 } from './math'
import { directionTo } from './navigation'
import { aggro } from './perception'
import { stationary } from './enemies/registry'
import type { AlarmState, Enemy } from './types'
import type { World } from './world'

export function createAlarmStates(level: BuiltLevel): AlarmState[] {
  return level.alarms.map((alarm) => ({ status: 'quiet', runner: null, pos: { x: alarm.post.x, y: alarm.post.y }, pulling: 0, runners: 0 }))
}

export function alarmRaised(world: World): boolean {
  return world.alarms.some((alarm) => alarm.status === 'rung')
}

export function runnerAlarm(world: World, enemy: Enemy): number {
  if (world.alarms.length === 0) return -1
  return world.alarms.findIndex((alarm) => alarm.status === 'running' && alarm.runner === enemy.id)
}

export function claimRunner(world: World, enemy: Enemy): void {
  if (world.alarms.length === 0 || world.debug.quietAlarms) return
  if (enemy.kind === 'boss' || enemy.summoned || enemy.hp <= 0 || stationary(enemy)) return
  world.level.alarms.forEach((placement, index) => {
    const alarm = world.alarms[index]
    if (placement.area !== enemy.area || alarm.status !== 'quiet') return
    alarm.status = 'running'
    alarm.runner = enemy.id
    alarm.pulling = 0
    alarm.runners += 1
    alarm.pos.x = enemy.pos.x
    alarm.pos.y = enemy.pos.y
    world.events.push({ type: 'alarmRunner', alarm: index, id: enemy.id, x: enemy.pos.x, y: enemy.pos.y })
  })
}

export function runForAlarm(world: World, enemy: Enemy, dt: number): Vec2 | null {
  const index = runnerAlarm(world, enemy)
  if (index < 0) return null
  const alarm = world.alarms[index]
  const placement = world.level.alarms[index]
  const post = placement.post
  alarm.pos.x = enemy.pos.x
  alarm.pos.y = enemy.pos.y
  const gap = Math.hypot(post.x - enemy.pos.x, post.y - enemy.pos.y)
  if (gap > ALARM.arrive && alarm.pulling <= 0) {
    const direction = directionTo(world, enemy.pos, enemy.radius, post)
    if (!direction) return { x: 0, y: 0 }
    const speed = runSpeed(world, enemy)
    enemy.facing = Math.atan2(direction.y, direction.x)
    return { x: direction.x * speed, y: direction.y * speed }
  }
  const source = landmarkCenter(world.level.landmarks[placement.landmark])
  enemy.facing = Math.atan2(source.y - enemy.pos.y, source.x - enemy.pos.x)
  if (alarm.pulling <= 0) world.events.push({ type: 'alarmPull', alarm: index, id: enemy.id, x: enemy.pos.x, y: enemy.pos.y })
  alarm.pulling += dt
  if (alarm.pulling >= ALARM.pull) raiseAlarm(world, index)
  return { x: 0, y: 0 }
}

export function raiseAlarm(world: World, index = 0): boolean {
  const alarm = world.alarms[index]
  const placement = world.level.alarms[index]
  if (!alarm || !placement || alarm.status === 'rung') return false
  alarm.status = 'rung'
  alarm.runner = null
  alarm.pulling = 0
  const center = landmarkCenter(world.level.landmarks[placement.landmark])
  world.events.push({ type: 'alarmRaised', alarm: index, landmark: placement.landmark, x: center.x, y: center.y })
  for (const enemy of world.enemies) {
    if (enemy.area === placement.area && enemy.hp > 0) aggro(world, enemy, 0)
  }
  world.areas.forEach((area, areaIndex) => {
    if (area.status === 'locked') callReinforcements(world, areaIndex)
  })
  return true
}

export function updateAlarms(world: World): void {
  world.level.reinforcements.forEach((squad, index) => {
    if (!world.reinforced[index] && world.areas[squad.area]?.status === 'locked') callReinforcements(world, squad.area)
  })
  world.alarms.forEach((alarm, index) => {
    if (alarm.status !== 'running') return
    const runner = world.enemies.find((enemy) => enemy.id === alarm.runner)
    if (runner && runner.hp > 0) return
    const id = alarm.runner ?? 0
    alarm.status = 'quiet'
    alarm.runner = null
    alarm.pulling = 0
    world.events.push({ type: 'alarmStopped', alarm: index, id, x: alarm.pos.x, y: alarm.pos.y })
  })
}

export function callReinforcements(world: World, area: number): number {
  if (!alarmRaised(world)) return 0
  let called = 0
  world.level.reinforcements.forEach((squad, index) => {
    if (squad.area !== area || world.reinforced[index] || squad.points.length === 0) return
    const standing =
      world.enemies.filter((enemy) => enemy.area === area && enemy.hp > 0).length + world.spawns.filter((marker) => marker.area === area).length
    if (standing > squad.left) return
    world.reinforced[index] = true
    let slot = 0
    for (const wave of squad.enemies) {
      for (let i = 0; i < Math.max(0, Math.round(wave.count)); i++) {
        const point = squad.points[slot++ % squad.points.length]
        world.spawns.push({
          id: world.nextId++,
          pos: { x: point.x, y: point.y },
          remaining: ALARM.reinforceWarning,
          total: ALARM.reinforceWarning,
          kind: wave.kind,
          area,
          summoned: false,
        })
        called += 1
      }
    }
  })
  if (called > 0) world.events.push({ type: 'reinforcements', area, count: called })
  return called
}

function runSpeed(world: World, enemy: Enemy): number {
  if (enemy.kind === 'boss' || enemy.kind === 'turret') return 0
  return world.tuning[enemy.kind].speed * ALARM.runScale
}
