import { readJson, writeJson } from '../core/storage'

export interface LookSettings {
  sensitivity: number
  invertY: boolean
  fov: number
  bob: boolean
  eyeHeight: number
}

export const GRASS_EYE_HEIGHT = 0.95

export const LOOK_LIMITS = {
  sensitivity: [0.02, 0.4],
  fov: [75, 110],
  eyeHeight: [1.2, 1.5],
} as const

export const DEFAULT_LOOK_SETTINGS: Readonly<LookSettings> = {
  sensitivity: 0.09,
  invertY: false,
  fov: 90,
  bob: false,
  eyeHeight: 1.5,
}

const KEY = 'isles-cartoon.look.v1'

function clamp(value: unknown, [low, high]: readonly [number, number], fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback
}

export function sanitizeLookSettings(raw: unknown): LookSettings {
  const source = typeof raw === 'object' && raw !== null ? (raw as Partial<Record<keyof LookSettings, unknown>>) : {}
  return {
    sensitivity: clamp(source.sensitivity, LOOK_LIMITS.sensitivity, DEFAULT_LOOK_SETTINGS.sensitivity),
    invertY: typeof source.invertY === 'boolean' ? source.invertY : DEFAULT_LOOK_SETTINGS.invertY,
    fov: clamp(source.fov, LOOK_LIMITS.fov, DEFAULT_LOOK_SETTINGS.fov),
    bob: typeof source.bob === 'boolean' ? source.bob : DEFAULT_LOOK_SETTINGS.bob,
    eyeHeight: clamp(source.eyeHeight, LOOK_LIMITS.eyeHeight, DEFAULT_LOOK_SETTINGS.eyeHeight),
  }
}

export function loadLookSettings(): LookSettings {
  return sanitizeLookSettings(readJson(KEY))
}

export function saveLookSettings(settings: LookSettings): void {
  writeJson(KEY, settings)
}
