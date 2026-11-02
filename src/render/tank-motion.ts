import { wrapAngle } from './boss-motion'
import { MINE_LIGHT, TANK_DEFEAT, TANK_RIG } from './themes'

export type TankRig = typeof TANK_RIG
export type TankDefeat = typeof TANK_DEFEAT
export type MineLight = typeof MINE_LIGHT

export interface TrackTravel {
  left: number
  right: number
}

export interface Retreat {
  x: number
  y: number
  along: number
  heading: number
  fade: number
}

export function barrelNode(barrel: number, rule: TankRig = TANK_RIG): string {
  return rule.barrels[barrel] ?? rule.barrels[1]
}

export function muzzleNode(barrel: number, rule: TankRig = TANK_RIG): string {
  return rule.muzzles[barrel] ?? rule.muzzles[1]
}

export function recoilAmount(since: number, rule: TankRig = TANK_RIG): number {
  if (since < 0) return 0
  if (since < rule.kickIn) return since / rule.kickIn
  const back = (since - rule.kickIn) / rule.kickOut
  return back >= 1 ? 0 : (1 - back) ** 2
}

export function lidStep(current: number, open: boolean, dt: number, rule: TankRig = TANK_RIG): number {
  const target = open ? 1 : 0
  if (rule.lidSeconds <= 0) return target
  const step = Math.max(0, dt) / rule.lidSeconds
  return current < target ? Math.min(target, current + step) : Math.max(target, current - step)
}

export function lidAngle(progress: number, rule: TankRig = TANK_RIG): number {
  const k = Math.min(1, Math.max(0, progress))
  return rule.lidAngle * (1 - (1 - k) ** 3)
}

export function lidSweeping(angle: number, rule: TankRig = TANK_RIG): boolean {
  return angle > rule.lidSafe[0] && angle < rule.lidSafe[1]
}

export function turretAngle(relative: number, lid: number, rule: TankRig = TANK_RIG): number {
  const angle = wrapAngle(relative)
  if (!lidSweeping(lid, rule)) return angle
  return Math.max(-rule.turretLimit, Math.min(rule.turretLimit, angle))
}

export function easeAngle(current: number, target: number, rate: number, dt: number): number {
  const diff = wrapAngle(target - current)
  return wrapAngle(current + diff * (1 - Math.exp(-rate * Math.max(0, dt))))
}

export function trackTravel(forward: number, turn: number, gauge: number = TANK_RIG.gauge): TrackTravel {
  return { left: forward + turn * gauge, right: forward - turn * gauge }
}

export function trackOffset(offset: number, travel: number, period: number = TANK_RIG.trackPeriod): number {
  const next = offset - travel / period
  return next - Math.floor(next)
}

export function mineGlow(age: number, fuse: number, time: number, rule: MineLight = MINE_LIGHT): number {
  const [low, high] = fuse >= 0 ? rule.armed : rule.idle
  const rate = fuse >= 0 ? rule.armedRate : rule.idleRate
  const wave = 0.5 + 0.5 * Math.sin(time * rate * Math.PI * 2)
  const on = age < rule.settle ? Math.max(0, age / rule.settle) : 1
  return (low + (high - low) * wave * wave) * on
}

export function mineWarning(age: number, fuse: number, glow: number, rule: MineLight = MINE_LIGHT): number {
  if (fuse >= 0) return rule.ringLit
  const [low, high] = rule.idle
  const k = high > low ? Math.min(1, Math.max(0, (glow - low) / (high - low))) : 1
  const on = age < rule.settle ? Math.max(0, age / rule.settle) : 1
  return (rule.ringIdle[0] + (rule.ringIdle[1] - rule.ringIdle[0]) * k) * on
}

export function mineSpark(fuse: number, glow: number, rule: MineLight = MINE_LIGHT): number {
  const peak = fuse >= 0 ? rule.armed[1] : rule.idle[1]
  const k = peak > 0 ? Math.min(1, Math.max(0, glow / peak)) : 1
  return glow > 0 ? rule.sparkLow + (1 - rule.sparkLow) * k : 0
}

export function mineSettle(age: number, settle: number = MINE_LIGHT.settle): number {
  if (settle <= 0 || age >= settle || age < 0) return 0
  const k = age / settle
  return Math.sin(Math.PI * k) * (1 - k)
}

export function retreatDistance(time: number, rule: TankDefeat = TANK_DEFEAT): number {
  const t = Math.max(0, time)
  return rule.slow * Math.min(t, rule.open) + rule.fast * Math.max(0, t - rule.open)
}

export function retreatAt(
  time: number,
  from: { x: number; y: number },
  gate: { x: number; y: number } | null,
  rule: TankDefeat = TANK_DEFEAT,
  out: Retreat = { x: 0, y: 0, along: 0, heading: 0, fade: 1 },
): Retreat {
  const end = gate ?? { x: from.x, y: from.y - 6 }
  const first = Math.hypot(end.x - from.x, end.y - from.y)
  const total = first + rule.beyond
  const along = Math.min(total, retreatDistance(time, rule))
  if (along <= first && first > 1e-6) {
    const k = along / first
    out.x = from.x + (end.x - from.x) * k
    out.y = from.y + (end.y - from.y) * k
    out.heading = Math.atan2(from.y - end.y, from.x - end.x)
  } else {
    out.x = end.x
    out.y = end.y - (along - first)
    out.heading = Math.PI / 2
  }
  out.along = along
  const reach = reachTime(first + rule.beyond * 0.35, rule)
  const start = Math.min(reach, rule.seconds - rule.fade)
  out.fade = 1 - Math.min(1, Math.max(0, (time - start) / rule.fade))
  return out
}

export function reachTime(distance: number, rule: TankDefeat = TANK_DEFEAT): number {
  const early = rule.slow * rule.open
  if (distance <= early) return rule.slow > 0 ? distance / rule.slow : rule.open
  return rule.open + (rule.fast > 0 ? (distance - early) / rule.fast : 0)
}
