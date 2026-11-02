import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { applyShadowQuality, pixelRatioFor } from './quality'

describe('graphics quality', () => {
  it('caps the pixel ratio without ever raising it above the screen', () => {
    expect(pixelRatioFor('ultra', 3)).toBe(2)
    expect(pixelRatioFor('ultra', 1)).toBe(1)
    expect(pixelRatioFor('high', 2)).toBe(1.5)
    expect(pixelRatioFor('high', 1.25)).toBe(1.25)
    expect(pixelRatioFor('standard', 2)).toBe(1)
  })

  it('sizes the shadow map for high and low, and stops the shadow pass when off without touching the shaders', () => {
    const sun = new THREE.DirectionalLight()
    sun.castShadow = true
    applyShadowQuality(sun, 'high')
    expect(sun.shadow.mapSize.toArray()).toEqual([2048, 1280])
    expect(sun.shadow.intensity).toBe(1)
    expect(sun.shadow.autoUpdate).toBe(true)

    applyShadowQuality(sun, 'low')
    expect(sun.shadow.mapSize.toArray()).toEqual([1024, 640])
    expect(sun.shadow.autoUpdate).toBe(true)

    applyShadowQuality(sun, 'off')
    expect(sun.castShadow).toBe(true)
    expect(sun.shadow.intensity).toBe(0)
    expect(sun.shadow.autoUpdate).toBe(false)
    expect(sun.shadow.needsUpdate).toBe(true)
    expect(sun.shadow.mapSize.toArray()).toEqual([1, 1])

    applyShadowQuality(sun, 'high')
    expect(sun.shadow.intensity).toBe(1)
    expect(sun.shadow.autoUpdate).toBe(true)
    expect(sun.shadow.mapSize.toArray()).toEqual([2048, 1280])
  })
})
