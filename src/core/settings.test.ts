import { describe, expect, it } from 'vitest'
import { RESOLUTIONS, SHADOW_LEVELS } from '../data/quality'
import { DEFAULT_SETTINGS, sanitizeSettings } from './settings'

describe('settings', () => {
  it('falls back to defaults for missing or broken saves', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings('oops')).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings({ music: 'loud', tips: 1 })).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps valid values and clamps volumes into 0..1', () => {
    expect(sanitizeSettings({ music: 2, sfx: -1, shake: 0.4, damageNumbers: false, tips: false })).toEqual({
      music: 1,
      sfx: 0,
      shake: 0.4,
      damageNumbers: false,
      tips: false,
      difficulty: 'normal',
      resolution: 'ultra',
      antialias: true,
      shadows: 'high',
    })
  })

  it('remembers a known difficulty and ignores unknown ones', () => {
    expect(sanitizeSettings({ difficulty: 'hard' }).difficulty).toBe('hard')
    expect(sanitizeSettings({ difficulty: 'nightmare' }).difficulty).toBe('normal')
  })

  it('gives saves from before the graphics options the current picture', () => {
    const old = sanitizeSettings({ music: 0.3, sfx: 0.5, shake: 1, damageNumbers: true, tips: false, difficulty: 'hard' })
    expect(old).toMatchObject({ resolution: 'ultra', antialias: true, shadows: 'high' })
    expect(RESOLUTIONS[DEFAULT_SETTINGS.resolution].maxPixelRatio).toBe(2)
    expect(DEFAULT_SETTINGS.antialias).toBe(true)
    expect(SHADOW_LEVELS[DEFAULT_SETTINGS.shadows].mapSize).toEqual([2048, 1280])
  })

  it('keeps chosen graphics options and drops unknown ones', () => {
    expect(sanitizeSettings({ resolution: 'standard', antialias: false, shadows: 'off' })).toMatchObject({
      resolution: 'standard',
      antialias: false,
      shadows: 'off',
    })
    expect(sanitizeSettings({ resolution: 'high', shadows: 'low' })).toMatchObject({ resolution: 'high', shadows: 'low' })
    expect(sanitizeSettings({ resolution: '4k', antialias: 'yes', shadows: 'ultra' })).toMatchObject({
      resolution: 'ultra',
      antialias: true,
      shadows: 'high',
    })
  })

  it('caps the pixel ratio at 1, 1.5 and 2 and halves the shadow map on low', () => {
    expect([RESOLUTIONS.standard, RESOLUTIONS.high, RESOLUTIONS.ultra].map((level) => level.maxPixelRatio)).toEqual([1, 1.5, 2])
    const [width, height] = SHADOW_LEVELS.high.mapSize
    expect(SHADOW_LEVELS.low.mapSize).toEqual([width / 2, height / 2])
    expect([SHADOW_LEVELS.off.drawn, SHADOW_LEVELS.low.drawn, SHADOW_LEVELS.high.drawn]).toEqual([false, true, true])
  })
})
