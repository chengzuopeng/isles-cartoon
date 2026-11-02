import { DEFAULT_DIFFICULTY, isDifficultyId, type DifficultyId } from '../data/difficulty'
import { DEFAULT_QUALITY, isResolutionId, isShadowQualityId, type GraphicsQuality } from '../data/quality'
import { readJson, writeJson } from './storage'

export interface Settings extends GraphicsQuality {
  music: number
  sfx: number
  shake: number
  damageNumbers: boolean
  tips: boolean
  difficulty: DifficultyId
}

const SETTINGS_KEY = 'shattered-isles.settings.v1'

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  music: 0.6,
  sfx: 0.8,
  shake: 1,
  damageNumbers: true,
  tips: true,
  difficulty: DEFAULT_DIFFICULTY,
  ...DEFAULT_QUALITY,
}

export function loadSettings(): Settings {
  return sanitizeSettings(readJson(SETTINGS_KEY))
}

export function saveSettings(settings: Settings): void {
  writeJson(SETTINGS_KEY, settings)
}

export function sanitizeSettings(raw: unknown): Settings {
  const settings: Settings = { ...DEFAULT_SETTINGS }
  if (typeof raw !== 'object' || raw === null) return settings
  const record = raw as Record<string, unknown>
  for (const key of ['music', 'sfx', 'shake'] as const) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) settings[key] = Math.min(1, Math.max(0, value))
  }
  for (const key of ['damageNumbers', 'tips', 'antialias'] as const) {
    if (typeof record[key] === 'boolean') settings[key] = record[key]
  }
  if (isDifficultyId(record.difficulty)) settings.difficulty = record.difficulty
  if (isResolutionId(record.resolution)) settings.resolution = record.resolution
  if (isShadowQualityId(record.shadows)) settings.shadows = record.shadows
  return settings
}
