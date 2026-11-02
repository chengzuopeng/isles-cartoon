import type * as THREE from 'three'
import { RESOLUTIONS, SHADOW_LEVELS, type ResolutionId, type ShadowQualityId } from '../data/quality'

export function pixelRatioFor(resolution: ResolutionId, devicePixelRatio: number): number {
  return Math.min(devicePixelRatio, RESOLUTIONS[resolution].maxPixelRatio)
}

export function applyShadowQuality(light: THREE.DirectionalLight, id: ShadowQualityId): void {
  const { drawn, mapSize } = SHADOW_LEVELS[id]
  const { shadow } = light
  shadow.mapSize.set(mapSize[0], mapSize[1])
  shadow.intensity = drawn ? 1 : 0
  shadow.autoUpdate = drawn
  shadow.needsUpdate = !drawn
}
