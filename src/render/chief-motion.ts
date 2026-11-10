import type { BossDef, DefeatShow } from '../data/bosses'
import { blocksBullets, tileAt, type Grid } from '../sim/grid'
import type { BossState } from '../sim/types'
import { clamp01, elapsed, mix, smooth, span, telegraphProgress, type Windups } from './boss-motion'
import { CHIEF_DEFEAT, CHIEF_RIG } from './themes'

export type ChiefRig = typeof CHIEF_RIG

export type ChiefDefeat = typeof CHIEF_DEFEAT

export interface ArmPose {
  raise: number
  elbow: number
  lean: number
}

export interface Fall {
  angle: number
  lean: number
  reach: number
  light: number
  fade: number
}

export function rackShown(slot: number, bombs: number, size: number): boolean {
  return slot > size - Math.max(0, Math.min(size, Math.round(bombs)))
}

export function handShown(sinceToss: number, rig: ChiefRig = CHIEF_RIG): boolean {
  return !(sinceToss >= 0 && sinceToss < rig.rehide)
}

export function throwPose(def: BossDef, state: BossState, sinceToss: number, rig: ChiefRig = CHIEF_RIG, out: ArmPose = { raise: 0, elbow: 0, lean: 0 }): ArmPose {
  out.raise = 0
  out.elbow = 0
  out.lean = 0
  const bales = def.bales
  if (!bales || state.move !== 'bales') return out
  if (state.phase === 'telegraph') {
    const k = smooth(elapsed(state.timer, bales.windup))
    out.raise = rig.raise * k
    out.elbow = rig.raiseElbow * k
    return out
  }
  if (state.phase === 'active') {
    if (!(sinceToss >= 0) || !Number.isFinite(sinceToss)) {
      out.raise = rig.raise
      out.elbow = rig.raiseElbow
      return out
    }
    if (sinceToss < rig.snap) {
      const s = smooth(sinceToss / rig.snap)
      out.raise = mix(rig.raise, rig.follow, s)
      out.elbow = mix(rig.raiseElbow, rig.followElbow, s)
      out.lean = rig.throwLean * Math.sin(Math.PI * s)
      return out
    }
    if (state.balesLeft > 0) {
      const r = smooth((sinceToss - rig.snap) / Math.max(0.05, bales.interval - rig.snap))
      out.raise = mix(rig.follow, rig.raise, r)
      out.elbow = mix(rig.followElbow, rig.raiseElbow, r)
      return out
    }
    out.raise = rig.follow
    out.elbow = rig.followElbow
    return out
  }
  if (state.phase === 'recover') {
    const k = bales.recover > 0 ? clamp01(state.timer / bales.recover) : 0
    out.raise = rig.follow * k
    out.elbow = rig.followElbow * k
  }
  return out
}

export function cannonGlow(def: BossDef, state: BossState, weapons: Windups, rig: ChiefRig = CHIEF_RIG): number {
  if (state.phase === 'recover' || state.phase === 'stunned') return rig.boreGlow
  if (state.move !== 'cannon' || !def.cannon) return 1
  if (state.phase === 'telegraph') return 1 + (rig.boreGlow - 1) * telegraphProgress(def, state, weapons)
  if (state.phase === 'active') return rig.boreGlow
  return 1
}

export function cannonBrace(def: BossDef, state: BossState, weapons: Windups): number {
  if (state.move !== 'cannon' || !def.cannon) return 0
  if (state.phase === 'telegraph') return smooth(telegraphProgress(def, state, weapons))
  if (state.phase === 'active') return 1
  if (state.phase === 'recover') return def.cannon.recover > 0 ? clamp01(state.timer / def.cannon.recover) : 0
  return 0
}

export function laySpot(index: number, count: number, rig: ChiefDefeat = CHIEF_DEFEAT): { forward: number; side: number } {
  return { forward: rig.bombForward, side: (index - (count - 1) / 2) * rig.bombSpacing }
}

export function layStart(index: number, count: number, show: DefeatShow, rig: ChiefDefeat = CHIEF_DEFEAT): number {
  if (count <= 0) return 0
  const slot = show.lay / count
  return index * slot + Math.max(0, slot - rig.bombFlight) * 0.5
}

export function chiefDefeatSeconds(show: DefeatShow | null, rig: ChiefDefeat = CHIEF_DEFEAT): number {
  const lay = show?.lay ?? 0
  const fall = show?.fall ?? 1
  return lay + fall + rig.lie + rig.fade
}

export function chiefFall(time: number, show: DefeatShow | null, count: number, rig: ChiefDefeat = CHIEF_DEFEAT, out?: Fall): Fall {
  const result = out ?? { angle: 0, lean: 0, reach: 0, light: 1, fade: 1 }
  const lay = show?.lay ?? 0
  const fall = show?.fall ?? 1
  const laying = time < lay
  const slot = count > 0 ? lay / count : lay
  const phase = laying && slot > 0 ? (time % slot) / slot : 0
  result.reach = laying && count > 0 ? Math.sin(Math.PI * phase) : 0
  result.lean = laying ? rig.layLean * smooth(span(time, 0, 0.3)) : rig.layLean * (1 - smooth(span(time, lay, lay + fall * 0.4)))
  const drop = span(time, lay, lay + fall)
  const after = Math.max(0, time - lay - fall)
  const settle = drop >= 1 ? rig.bounce * Math.abs(Math.sin(after * 9)) * Math.exp(-after * 5) : 0
  result.angle = rig.fallAngle * drop * drop - settle
  result.light = time < lay ? 1 : Math.max(0, 1 - span(time, lay, lay + rig.eyeFade))
  const total = chiefDefeatSeconds(show, rig)
  result.fade = 1 - smooth(span(time, total - rig.fade, total))
  return result
}

export function heelShift(angle: number, heel: number): { x: number; y: number } {
  return { x: heel * (1 - Math.cos(angle)), y: -heel * Math.sin(angle) }
}

export function laneLength(grid: Grid, x: number, y: number, angle: number, range: number, step = 0.1): number {
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  for (let traveled = step; traveled < range; traveled += step) {
    if (blocksBullets(tileAt(grid, Math.floor(x + dx * traveled), Math.floor(y + dy * traveled)))) return Math.max(0, traveled - step * 0.5)
  }
  return range
}

export function firstShown(bombs: number, size: number): number {
  return Math.max(0, Math.min(size, size - Math.round(bombs)))
}

export function stripStart(starts: readonly number[], total: number, first: number): number {
  return first < starts.length ? starts[first] : total
}
