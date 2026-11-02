import { fogged } from '../sim/fog'
import type { BuiltLevel } from '../sim/level'
import type { World } from '../sim/world'

export interface FogSpan {
  top: number
  rows: number
  columns: number
}

export interface FogFade {
  from: Float32Array
  to: Float32Array
  start: Float32Array
}

export const DISSOLVE_CHANNELS = 4

export interface LampSource {
  x: number
  y: number
  perCell: number
}

export function hasFog(level: BuiltLevel): boolean {
  return level.areas.some((area) => area.fog)
}

export function fogSpan(level: BuiltLevel, margin: number): FogSpan | null {
  let top = Infinity
  let bottom = -Infinity
  for (const area of level.areas) {
    if (!area.fog) continue
    top = Math.min(top, area.top)
    bottom = Math.max(bottom, area.bottom)
  }
  if (!Number.isFinite(top)) return null
  const first = Math.max(0, top - margin)
  const last = Math.min(level.grid.rows, bottom + margin)
  return { top: first, rows: last - first, columns: level.grid.columns }
}

export function fogTargets(world: World, span: FogSpan, out: Float32Array = new Float32Array(span.rows * span.columns)): Float32Array {
  for (let row = 0; row < span.rows; row++) {
    for (let column = 0; column < span.columns; column++) {
      out[row * span.columns + column] = fogged(world, column + 0.5, span.top + row + 0.5) ? 1 : 0
    }
  }
  return out
}

export function createFade(size: number): FogFade {
  return { from: new Float32Array(size), to: new Float32Array(size), start: new Float32Array(size) }
}

export function settleFade(fade: FogFade, target: Float32Array): void {
  fade.from.set(target)
  fade.to.set(target)
  fade.start.fill(0)
}

function progress(elapsed: number, seconds: number): number {
  if (seconds <= 0) return elapsed >= 0 ? 1 : 0
  return Math.min(1, Math.max(0, elapsed / seconds))
}

export function fadeValue(fade: FogFade, index: number, now: number, seconds: number): number {
  const from = fade.from[index]
  const to = fade.to[index]
  if (from === to) return to
  return from + (to - from) * progress(now - fade.start[index], seconds)
}

export function retarget(fade: FogFade, target: Float32Array, now: number, delay: (index: number) => number, seconds: number): boolean {
  let changed = false
  for (let i = 0; i < target.length; i++) {
    const next = target[i]
    if (next === fade.to[i]) continue
    changed = true
    const current = fadeValue(fade, i, now, seconds)
    fade.to[i] = next
    if (next >= current) {
      fade.from[i] = next
      fade.start[i] = now
    } else {
      fade.from[i] = current
      fade.start[i] = now + delay(i)
    }
  }
  return changed
}

export function settlesBy(fade: FogFade, seconds: number): number {
  let end = -Infinity
  for (let i = 0; i < fade.from.length; i++) if (fade.from[i] !== fade.to[i]) end = Math.max(end, fade.start[i] + seconds)
  return end
}

export interface MaskWork {
  channel: Float32Array
  blurred: Float32Array
  scratch: Float32Array
}

export function createMaskWork(size: number): MaskWork {
  return { channel: new Float32Array(size), blurred: new Float32Array(size), scratch: new Float32Array(size) }
}

function maskSize(span: FogSpan): number {
  return span.rows * span.columns * DISSOLVE_CHANNELS
}

export function dissolveMask(
  fade: FogFade,
  span: FogSpan,
  passes: number,
  now: number,
  seconds: number,
  out: Float32Array = new Float32Array(maskSize(span)),
  work: MaskWork = createMaskWork(span.rows * span.columns),
): Float32Array {
  const size = span.rows * span.columns
  const { channel, blurred, scratch } = work
  for (let c = 0; c < DISSOLVE_CHANNELS; c++) {
    for (let i = 0; i < size; i++) {
      const done = fade.from[i] === fade.to[i] || now >= fade.start[i] + seconds
      const level = done ? fade.to[i] : fade.from[i]
      const drop = done ? 0 : fade.from[i] - fade.to[i]
      const at = done ? 0 : fade.start[i] - now
      channel[i] = c === 0 ? level : c === 1 ? drop : c === 2 ? drop * at : drop * at * at
    }
    blurMask(channel, span.columns, span.rows, passes, blurred, scratch)
    for (let i = 0; i < size; i++) out[i * DISSOLVE_CHANNELS + c] = blurred[i]
  }
  return out
}

export function snapshotMask(
  fade: FogFade,
  span: FogSpan,
  passes: number,
  now: number,
  seconds: number,
  out: Float32Array = new Float32Array(maskSize(span)),
  work: MaskWork = createMaskWork(span.rows * span.columns),
): Float32Array {
  const size = span.rows * span.columns
  const { channel, blurred, scratch } = work
  for (let i = 0; i < size; i++) channel[i] = fadeValue(fade, i, now, seconds)
  blurMask(channel, span.columns, span.rows, passes, blurred, scratch)
  out.fill(0)
  for (let i = 0; i < size; i++) out[i * DISSOLVE_CHANNELS] = blurred[i]
  return out
}

function rampArea(x: number): number {
  const clamped = Math.min(1, Math.max(0, x))
  return 0.5 * clamped * clamped + Math.max(x - 1, 0)
}

export function softRamp(x: number, spread: number): number {
  if (spread <= 1e-3) return Math.min(1, Math.max(0, x))
  if (x - spread >= 1) return 1
  if (x + spread <= 0) return 0
  return (rampArea(x + spread) - rampArea(x - spread)) / (2 * spread)
}

export function dissolvedValue(texel: ArrayLike<number>, offset: number, since: number, seconds: number): number {
  const level = texel[offset]
  const drop = texel[offset + 1]
  if (drop <= 1e-4) return Math.min(1, Math.max(0, level))
  const mean = texel[offset + 2] / drop
  const spread = Math.sqrt(Math.max(0, texel[offset + 3] / drop - mean * mean) * 3)
  const length = Math.max(seconds, 1e-4)
  return Math.min(1, Math.max(0, level - drop * softRamp((since - mean) / length, spread / length)))
}

export function lampSources(level: BuiltLevel, indices: readonly number[], rule: { spread: number; areaSpread: number }): LampSource[] {
  return indices.map((index) => {
    const lamp = level.lamps[index]
    return { x: lamp.x, y: lamp.y, perCell: lamp.clears ? rule.areaSpread : rule.spread }
  })
}

export function dissolveDelay(span: FogSpan, sources: readonly LampSource[], maxDelay: number): (index: number) => number {
  return (index) => {
    const column = index % span.columns
    const row = (index - column) / span.columns
    const x = column + 0.5
    const y = span.top + row + 0.5
    let best = maxDelay
    for (const source of sources) best = Math.min(best, Math.hypot(x - source.x, y - source.y) * source.perCell)
    return best
  }
}

export function blurMask(source: Float32Array, columns: number, rows: number, passes: number, out: Float32Array, scratch: Float32Array): Float32Array {
  out.set(source)
  for (let pass = 0; pass < passes; pass++) {
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const index = row * columns + column
        const left = out[index - (column > 0 ? 1 : 0)]
        const right = out[index + (column < columns - 1 ? 1 : 0)]
        scratch[index] = 0.25 * left + 0.5 * out[index] + 0.25 * right
      }
    }
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const index = row * columns + column
        const up = scratch[index - (row > 0 ? columns : 0)]
        const down = scratch[index + (row < rows - 1 ? columns : 0)]
        out[index] = 0.25 * up + 0.5 * scratch[index] + 0.25 * down
      }
    }
  }
  return out
}

export function litLamps(previous: readonly boolean[], current: readonly boolean[]): number[] {
  const lit: number[] = []
  current.forEach((on, index) => {
    if (on && !previous[index]) lit.push(index)
  })
  return lit
}

export function veilStep(current: number, hidden: boolean, dt: number, seconds: number): number {
  const target = hidden ? 1 : 0
  if (seconds <= 0) return target
  const step = Math.max(0, dt) / seconds
  return current < target ? Math.min(target, current + step) : Math.max(target, current - step)
}

export interface LampLook {
  glow: number
  flash: number
  ring: number
  ringOpacity: number
}

export function lampLook(
  since: number,
  clock: number,
  reach: number,
  rule: { rise: number; breath: number; breathRate: number; flash: number; flashSeconds: number; ringSeconds: number },
  out: LampLook = { glow: 0, flash: 0, ring: 0, ringOpacity: 0 },
): LampLook {
  if (since < 0) {
    out.glow = 0
    out.flash = 0
    out.ring = 0
    out.ringOpacity = 0
    return out
  }
  const rise = rule.rise > 0 ? Math.min(1, since / rule.rise) : 1
  out.glow = (1 - (1 - rise) ** 3) * (1 + rule.breath * Math.sin(clock * rule.breathRate))
  const flash = rule.flashSeconds > 0 ? Math.max(0, 1 - since / rule.flashSeconds) : 0
  out.flash = 1 + (rule.flash - 1) * flash * flash
  const k = rule.ringSeconds > 0 ? since / rule.ringSeconds : 1
  out.ring = k < 1 ? reach * (1 - (1 - k) ** 2) : 0
  out.ringOpacity = k < 1 ? 1 - k : 0
  return out
}
