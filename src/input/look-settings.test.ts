import { describe, expect, it } from 'vitest'
import { DEFAULT_LOOK_SETTINGS, LOOK_LIMITS, sanitizeLookSettings } from './look-settings'

describe('look settings', () => {
  it('falls back to defaults for missing or broken values', () => {
    expect(sanitizeLookSettings(null)).toEqual(DEFAULT_LOOK_SETTINGS)
    expect(sanitizeLookSettings({ sensitivity: 'fast', fov: Number.NaN, invertY: 1 })).toEqual(DEFAULT_LOOK_SETTINGS)
  })

  it('clamps numbers into their ranges', () => {
    const settings = sanitizeLookSettings({ sensitivity: 9, fov: 30, eyeHeight: 3 })
    expect(settings.sensitivity).toBe(LOOK_LIMITS.sensitivity[1])
    expect(settings.fov).toBe(LOOK_LIMITS.fov[0])
    expect(settings.eyeHeight).toBe(LOOK_LIMITS.eyeHeight[1])
  })

  it('keeps valid choices', () => {
    const settings = sanitizeLookSettings({ sensitivity: 0.15, invertY: true, fov: 100, bob: true, eyeHeight: 1.2 })
    expect(settings).toEqual({ sensitivity: 0.15, invertY: true, fov: 100, bob: true, eyeHeight: 1.2 })
  })
})
