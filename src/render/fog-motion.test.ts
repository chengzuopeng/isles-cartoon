import { DataUtils } from 'three'
import { describe, expect, it } from 'vitest'
import { FOG } from '../data/fog'
import { LEVEL_1_1 } from '../data/levels/level-1-1'
import { LEVEL_1_4 } from '../data/levels/level-1-4'
import type { AreaDef } from '../data/levels/types'
import { createDefaultTuning } from '../data/tuning'
import { lightLamp } from '../sim/fog'
import { buildLevel } from '../sim/level'
import { levelFromAreas } from '../sim/testing'
import { createWorld, type World } from '../sim/world'
import {
  blurMask,
  createFade,
  DISSOLVE_CHANNELS,
  dissolveDelay,
  dissolvedValue,
  dissolveMask,
  fadeValue,
  fogSpan,
  fogTargets,
  hasFog,
  lampLook,
  lampSources,
  litLamps,
  retarget,
  settleFade,
  settlesBy,
  snapshotMask,
  softRamp,
  veilStep,
} from './fog-motion'
import { FOG_LAYER, LAMP_GLOW } from './themes'

const OPEN = '#' + '.'.repeat(30) + '#'
const WALL = '#'.repeat(32)

function woods(): World {
  const rows = [WALL, ...Array.from({ length: 22 }, () => OPEN), WALL]
  rows[20] = '#..............P...............#'
  const area: AreaDef = { name: 'woods', theme: 'forest', rows, fog: {}, landmarks: [{ id: 'ch1-fog-lamp', at: [3, 2] }] }
  return createWorld(levelFromAreas([area]), createDefaultTuning())
}

describe('fog span', () => {
  it('covers only the foggy areas of a level, with a margin of clear rows', () => {
    expect(hasFog(buildLevel(LEVEL_1_1))).toBe(false)
    expect(fogSpan(buildLevel(LEVEL_1_1), 2)).toBeNull()
    const level = buildLevel(LEVEL_1_4)
    expect(hasFog(level)).toBe(true)
    const foggy = level.areas.filter((area) => area.fog)
    const top = Math.min(...foggy.map((area) => area.top))
    const bottom = Math.max(...foggy.map((area) => area.bottom))
    expect(fogSpan(level, 2)).toEqual({ top: top - 2, rows: bottom - top + 4, columns: level.grid.columns })
  })

  it('marks fogged cells and clears the circle around a lit lamp', () => {
    const world = woods()
    const span = fogSpan(world.level, 0)
    if (!span) throw new Error('no fog')
    const before = fogTargets(world, span)
    expect(before.every((value) => value === 1)).toBe(true)
    lightLamp(world, 0)
    const after = fogTargets(world, span)
    const at = (column: number, row: number) => after[(row - span.top) * span.columns + column]
    expect(at(3, 2)).toBe(0)
    expect(at(3 + 7, 2)).toBe(0)
    expect(at(3 + FOG.lampRadius + 1, 2)).toBe(1)
    expect(at(25, 20)).toBe(1)
  })
})

describe('fog dissolve', () => {
  it('thins out cells only after their delay, then reaches the target in the fade time', () => {
    const fade = createFade(3)
    settleFade(fade, Float32Array.from([1, 1, 1]))
    const delays = [0, 0.5, 0]
    expect(retarget(fade, Float32Array.from([0, 0, 1]), 10, (index) => delays[index], 0.4)).toBe(true)
    expect(fadeValue(fade, 0, 10, 0.4)).toBe(1)
    expect(fadeValue(fade, 0, 10.2, 0.4)).toBeCloseTo(0.5, 6)
    expect(fadeValue(fade, 1, 10.2, 0.4)).toBe(1)
    expect(fadeValue(fade, 1, 10.7, 0.4)).toBeCloseTo(0.5, 6)
    expect(fadeValue(fade, 0, 10.6, 0.4)).toBe(0)
    expect(fadeValue(fade, 1, 11, 0.4)).toBe(0)
    expect(fadeValue(fade, 2, 10.6, 0.4)).toBe(1)
    expect(settlesBy(fade, 0.4)).toBeCloseTo(10.9, 6)
    expect(retarget(fade, Float32Array.from([0, 0, 1]), 12, () => 0, 0.4)).toBe(false)
  })

  it('brings fog back at once when a cell gets thicker', () => {
    const fade = createFade(2)
    settleFade(fade, Float32Array.from([0, 0]))
    expect(retarget(fade, Float32Array.from([1, 0]), 3, () => 1, 0.4)).toBe(true)
    expect(fadeValue(fade, 0, 3, 0.4)).toBe(1)
    expect(fadeValue(fade, 1, 3, 0.4)).toBe(0)
  })

  it('packs a settled mask as the blurred fog, the same at any time', () => {
    const span = { top: 0, rows: 3, columns: 4 }
    const fade = createFade(12)
    settleFade(fade, Float32Array.from([1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0]))
    expect(settlesBy(fade, 0.45)).toBe(-Infinity)
    const packed = dissolveMask(fade, span, 2, 7, 0.45)
    const blurred = blurMask(fade.to, span.columns, span.rows, 2, new Float32Array(12), new Float32Array(12))
    for (let i = 0; i < 12; i++) {
      expect(packed[i * DISSOLVE_CHANNELS + 1]).toBe(0)
      expect(dissolvedValue(packed, i * DISSOLVE_CHANNELS, 0, 0.45)).toBeCloseTo(blurred[i], 6)
      expect(dissolvedValue(packed, i * DISSOLVE_CHANNELS, 30, 0.45)).toBeCloseTo(blurred[i], 6)
    }
  })

  it('packs cells that finished fading as settled and snapshots the exact blur at a moment', () => {
    const span = { top: 0, rows: 1, columns: 4 }
    const fade = createFade(4)
    settleFade(fade, Float32Array.from([1, 1, 1, 1]))
    retarget(fade, Float32Array.from([0, 0, 1, 1]), 2, (index) => index * 0.5, 0.4)
    const packed = dissolveMask(fade, span, 0, 2.45, 0.4)
    expect(Array.from(packed.subarray(0, DISSOLVE_CHANNELS))).toEqual([0, 0, 0, 0])
    expect(packed[DISSOLVE_CHANNELS]).toBe(1)
    expect(packed[DISSOLVE_CHANNELS + 1]).toBe(1)
    expect(packed[DISSOLVE_CHANNELS + 2]).toBeCloseTo(0.05, 6)
    expect(dissolvedValue(packed, DISSOLVE_CHANNELS, 0.25, 0.4)).toBeCloseTo(0.5, 6)
    const snapshot = snapshotMask(fade, span, 1, 2.75, 0.4)
    const values = Float32Array.from([0, 1, 2, 3], (index) => fadeValue(fade, index, 2.75, 0.4))
    const blurred = blurMask(values, 4, 1, 1, new Float32Array(4), new Float32Array(4))
    for (let i = 0; i < 4; i++) {
      expect(snapshot[i * DISSOLVE_CHANNELS]).toBeCloseTo(blurred[i], 6)
      expect(snapshot[i * DISSOLVE_CHANNELS + 1]).toBe(0)
    }
  })

  it('averages a ramp over the spread of start times and keeps a plain ramp without spread', () => {
    expect(softRamp(-0.2, 0)).toBe(0)
    expect(softRamp(0.25, 0)).toBe(0.25)
    expect(softRamp(1.3, 0)).toBe(1)
    expect(softRamp(0.5, 0.2)).toBeCloseTo(0.5, 6)
    expect(softRamp(0, 0.2)).toBeCloseTo(0.05, 6)
    expect(softRamp(-0.3, 0.2)).toBe(0)
    expect(softRamp(1.3, 0.2)).toBeCloseTo(1, 9)
  })

  it('dissolves every texel of 1-4 like blurring the per-cell fade, lamp by lamp and all at once', () => {
    const level = buildLevel(LEVEL_1_4)
    const span = fogSpan(level, FOG_LAYER.margin)
    if (!span) throw new Error('no fog')
    const size = span.rows * span.columns
    const values = new Float32Array(size)
    const exact = new Float32Array(size)
    const scratch = new Float32Array(size)
    const half = (value: number) => DataUtils.fromHalfFloat(DataUtils.toHalfFloat(value))
    const worst = (orders: number[][]): number => {
      const world = createWorld(level, createDefaultTuning())
      const fade = createFade(size)
      const target = new Float32Array(size)
      settleFade(fade, fogTargets(world, span, target))
      let error = 0
      let now = 4
      for (const lit of orders) {
        for (const index of lit) lightLamp(world, index)
        const delay = dissolveDelay(span, lampSources(level, lit, FOG_LAYER), FOG_LAYER.maxDelay)
        expect(retarget(fade, fogTargets(world, span, target), now, delay, FOG_LAYER.fade)).toBe(true)
        const packed = dissolveMask(fade, span, FOG_LAYER.blur, now, FOG_LAYER.fade).map(half)
        for (let t = 0; t <= 1.3; t += 1 / 30) {
          for (let i = 0; i < size; i++) values[i] = fadeValue(fade, i, now + t, FOG_LAYER.fade)
          blurMask(values, span.columns, span.rows, FOG_LAYER.blur, exact, scratch)
          for (let i = 0; i < size; i++) error = Math.max(error, Math.abs(dissolvedValue(packed, i * DISSOLVE_CHANNELS, t, FOG_LAYER.fade) - exact[i]))
          for (let row = 0; row + 1 < span.rows; row += 3) {
            for (let column = 0; column + 1 < span.columns; column += 3) {
              const corners = [row * span.columns + column, row * span.columns + column + 1, (row + 1) * span.columns + column, (row + 1) * span.columns + column + 1]
              const between = Array.from({ length: DISSOLVE_CHANNELS }, (_, c) => corners.reduce((sum, i) => sum + packed[i * DISSOLVE_CHANNELS + c], 0) / 4)
              const expected = corners.reduce((sum, i) => sum + exact[i], 0) / 4
              error = Math.max(error, Math.abs(dissolvedValue(between, 0, t, FOG_LAYER.fade) - expected))
            }
          }
        }
        now += 2.5
      }
      return error
    }
    expect(worst(level.lamps.map((_, index) => [index]))).toBeLessThan(0.015)
    expect(worst([level.lamps.map((_, index) => index)])).toBeLessThan(0.015)
  })

  it('spreads the dissolve outwards from the lamp that was lit, capped by the max delay', () => {
    const span = { top: 10, rows: 3, columns: 20 }
    const delay = dissolveDelay(span, [{ x: 0.5, y: 10.5, perCell: 0.1 }], 1)
    expect(delay(0)).toBe(0)
    expect(delay(4)).toBeCloseTo(0.4, 6)
    expect(delay(2 * 20 + 19)).toBe(1)
  })

  it('softens a hard edge without losing the far sides', () => {
    const source = Float32Array.from([1, 1, 0, 0])
    const out = new Float32Array(4)
    blurMask(source, 4, 1, 1, out, new Float32Array(4))
    expect(out[0]).toBe(1)
    expect(out[1]).toBeCloseTo(0.75, 6)
    expect(out[2]).toBeCloseTo(0.25, 6)
    expect(out[3]).toBe(0)
  })

  it('reports which lamps were lit since the last look', () => {
    expect(litLamps([false, true, false], [true, true, false])).toEqual([0])
    expect(litLamps([], [false, true])).toEqual([1])
  })
})

describe('veil and lamp look', () => {
  it('fades an enemy into the fog and back over the veil time', () => {
    expect(veilStep(0, true, 0.1, 0.4)).toBeCloseTo(0.25, 6)
    expect(veilStep(0.9, true, 0.1, 0.4)).toBe(1)
    expect(veilStep(0.2, false, 0.1, 0.4)).toBe(0)
    expect(veilStep(0.3, true, 0.1, 0)).toBe(1)
  })

  it('lights the glass, flashes and sends a ring out to the lamp radius', () => {
    const off = lampLook(-1, 0, 8, LAMP_GLOW)
    expect(off).toEqual({ glow: 0, flash: 0, ring: 0, ringOpacity: 0 })
    const early = lampLook(0.05, 0, 8, LAMP_GLOW)
    expect(early.glow).toBeGreaterThan(0)
    expect(early.flash).toBeGreaterThan(1)
    expect(early.ring).toBeGreaterThan(0)
    expect(early.ring).toBeLessThan(8)
    const late = lampLook(LAMP_GLOW.ringSeconds + 1, 0, 8, LAMP_GLOW)
    expect(late.glow).toBeCloseTo(1, 6)
    expect(late.flash).toBe(1)
    expect(late.ringOpacity).toBe(0)
  })
})
