export type ResolutionId = 'standard' | 'high' | 'ultra'

export type ShadowQualityId = 'off' | 'low' | 'high'

export interface GraphicsQuality {
  resolution: ResolutionId
  antialias: boolean
  shadows: ShadowQualityId
}

export interface ResolutionLevel {
  name: string
  maxPixelRatio: number
}

export interface ShadowLevel {
  name: string
  drawn: boolean
  mapSize: readonly [number, number]
}

export const RESOLUTION_ORDER: readonly ResolutionId[] = ['standard', 'high', 'ultra']

export const RESOLUTIONS: Readonly<Record<ResolutionId, ResolutionLevel>> = {
  standard: { name: '标准', maxPixelRatio: 1 },
  high: { name: '高', maxPixelRatio: 1.5 },
  ultra: { name: '超高', maxPixelRatio: 2 },
}

export const SHADOW_ORDER: readonly ShadowQualityId[] = ['off', 'low', 'high']

export const SHADOW_LEVELS: Readonly<Record<ShadowQualityId, ShadowLevel>> = {
  off: { name: '关', drawn: false, mapSize: [1, 1] },
  low: { name: '低', drawn: true, mapSize: [1024, 640] },
  high: { name: '高', drawn: true, mapSize: [2048, 1280] },
}

export const DEFAULT_QUALITY: Readonly<GraphicsQuality> = {
  resolution: 'ultra',
  antialias: true,
  shadows: 'high',
}

export function isResolutionId(value: unknown): value is ResolutionId {
  return typeof value === 'string' && (RESOLUTION_ORDER as readonly string[]).includes(value)
}

export function isShadowQualityId(value: unknown): value is ShadowQualityId {
  return typeof value === 'string' && (SHADOW_ORDER as readonly string[]).includes(value)
}
