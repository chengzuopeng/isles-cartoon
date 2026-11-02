import { describe, expect, it } from 'vitest'
import type { AlarmState } from '../sim/types'
import { bellTarget, freshSwing, lampLevel, stepBell, waveLook, wavesDone } from './alarm-motion'
import { ALARM_BELL } from './themes'

function alarm(status: AlarmState['status'], pulling = 0): AlarmState {
  return { status, runner: status === 'running' ? 7 : null, pos: { x: 0, y: 0 }, pulling, runners: status === 'quiet' ? 0 : 1 }
}

function peak(state: AlarmState | null, seconds: number, swing = freshSwing()): { swing: ReturnType<typeof freshSwing>; peak: number } {
  let top = 0
  for (let t = 0; t < seconds; t += 1 / 60) top = Math.max(top, Math.abs(stepBell(swing, state, 1 / 60)))
  return { swing, peak: top }
}

describe('alarm bell', () => {
  it('hangs still while nobody pulls the rope, even with a runner on the way', () => {
    expect(bellTarget(alarm('quiet')).swing).toBe(0)
    expect(bellTarget(null).swing).toBe(0)
    expect(peak(alarm('quiet'), 3).peak).toBe(0)
    expect(peak(alarm('running'), 3).peak).toBe(0)
  })

  it('starts to rock while the rope is pulled and swings wide once it has rung', () => {
    const pulled = peak(alarm('running', 0.4), 1.5)
    expect(pulled.peak).toBeGreaterThan(ALARM_BELL.pullSwing * 0.5)
    expect(pulled.peak).toBeLessThanOrEqual(ALARM_BELL.pullSwing + 1e-9)
    const rung = peak(alarm('rung'), 3, pulled.swing)
    expect(rung.peak).toBeGreaterThan(ALARM_BELL.pullSwing * 1.5)
    expect(rung.peak).toBeLessThanOrEqual(ALARM_BELL.rungSwing + 1e-9)
    expect(peak(alarm('rung'), 6, rung.swing).peak).toBeGreaterThan(ALARM_BELL.rungSwing * 0.9)
  })

  it('stays within the 25 degrees the bell was checked against the tower', () => {
    expect(ALARM_BELL.rungSwing).toBeLessThanOrEqual((25 * Math.PI) / 180)
    expect(ALARM_BELL.pullSwing).toBeLessThan(ALARM_BELL.rungSwing)
  })

  it('settles back to rest if the runner is stopped mid-pull', () => {
    const pulled = peak(alarm('running', 0.4), 1)
    const calmed = peak(alarm('quiet'), 8, pulled.swing)
    expect(calmed.swing.amount).toBeLessThan(1e-3)
  })

  it('keeps the lamp dim while quiet and blinks it from the moment a runner sets off', () => {
    expect(lampLevel(alarm('quiet'), 0.3)).toBe(ALARM_BELL.lampIdle)
    expect(lampLevel(null, 0.3)).toBe(ALARM_BELL.lampIdle)
    for (const state of [alarm('running'), alarm('running', 0.3), alarm('rung')]) {
      const levels = new Set(Array.from({ length: 60 }, (_, i) => lampLevel(state, i / 60)))
      expect([...levels].sort()).toEqual([ALARM_BELL.lampOff, ALARM_BELL.lampOn].sort())
    }
  })

  it('sends rings out from the bell right after it rings, growing and fading, then stops', () => {
    const first = waveLook(0.05, 0)
    expect(first.visible).toBe(true)
    const later = waveLook(0.6, 0)
    expect(later.scale).toBeGreaterThan(first.scale)
    expect(later.opacity).toBeLessThan(first.opacity)
    expect(waveLook(0.05, 1).visible).toBe(false)
    expect(waveLook(ALARM_BELL.waveGap + 0.05, 1).visible).toBe(true)
    expect(waveLook(-Infinity, 0).visible).toBe(false)
    expect(waveLook(5, ALARM_BELL.waves).visible).toBe(false)
    expect(wavesDone(0.5)).toBe(false)
    expect(wavesDone((ALARM_BELL.waves - 1) * ALARM_BELL.waveGap + ALARM_BELL.waveSeconds)).toBe(true)
  })
})
