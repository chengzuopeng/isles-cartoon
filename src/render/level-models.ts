import { BOSSES } from '../data/bosses'
import { MINION_KINDS, type MinionKind } from '../data/enemies'
import { LANDMARKS } from '../data/landmarks'
import { Tile, tileAt } from '../sim/grid'
import type { BuiltLevel } from '../sim/level'
import { MODEL_IDS, RESIDENT_MODEL_IDS, type ModelId } from './asset-urls'
import { normalBelts } from './belt-cargo'
import { BLADE_MODEL } from './blade-views'
import { LADDER_MODEL } from './ladder'
import { BACKDROP_THEMES, PROP_MODELS, bridgeAt, propModel, variantIds, type PropKind } from './scene-models'
import { BELT_CARGO } from './themes'

const KNOWN = new Set<string>(MODEL_IDS)

const TILE_PROPS: Readonly<Partial<Record<Tile, PropKind>>> = {
  [Tile.Wall]: 'wall',
  [Tile.Rock]: 'rock',
  [Tile.Bush]: 'bush',
  [Tile.Tree]: 'tree',
  [Tile.Cart]: 'cart',
  [Tile.Fence]: 'fence',
  [Tile.Gate]: 'gate',
  [Tile.GateClosed]: 'gate',
}

const BOSS_PARTS: Readonly<Partial<Record<string, readonly ModelId[]>>> = {
  harvester: ['shard-morning'],
}

export function isModelId(id: string): id is ModelId {
  return KNOWN.has(id)
}

export function levelEnemyKinds(level: BuiltLevel): MinionKind[] {
  const kinds = new Set<MinionKind>(level.enemies.map((enemy) => enemy.kind))
  for (const wave of [...level.reinforcements, ...level.rushes]) {
    for (const recipe of wave.variants) for (const squad of recipe) kinds.add(squad.kind)
  }
  const boss = level.boss ? BOSSES[level.boss.id] : undefined
  if (boss) {
    for (const summon of boss.summon) kinds.add(summon.kind)
    for (const phase of boss.phases) if (phase.summon) kinds.add(phase.summon.kind)
  }
  if (level.def.waves) for (const kind of MINION_KINDS) kinds.add(kind)
  return MINION_KINDS.filter((kind) => kinds.has(kind))
}

export function levelModelIds(level: BuiltLevel): ModelId[] {
  const ids = new Set<ModelId>()
  const add = (id: string) => {
    if (isModelId(id)) ids.add(id)
  }
  const family = (base: string, count: number) => {
    add(base)
    for (const id of variantIds(base, count)) add(id)
  }
  const { grid } = level
  for (const area of level.areas) {
    if (BACKDROP_THEMES.has(area.theme)) family(propModel('tree', area.theme), PROP_MODELS.tree.variants)
  }
  for (let row = 0; row < grid.rows; row++) {
    const theme = level.areas[level.areaOfRow[row]].theme
    for (let column = 0; column < grid.columns; column++) {
      const tile = tileAt(grid, column, row)
      const kind = TILE_PROPS[tile]
      if (kind) family(propModel(kind, theme), PROP_MODELS[kind].variants)
      if (bridgeAt(grid, column, row)) family(propModel('bridge', theme), PROP_MODELS.bridge.variants)
    }
  }
  for (const placement of level.landmarks) {
    const def = LANDMARKS[placement.id]
    if (def.building) continue
    family(placement.id, def.variants ?? 1)
    for (const state of def.states ?? []) add(`${placement.id}-${state}`)
  }
  if (level.blades.length > 0) family(BLADE_MODEL, 1)
  if (normalBelts(level).length > 0) for (const id of Object.values(BELT_CARGO.models)) family(id, 1)
  for (const chest of level.chests) {
    add(`chest-${chest.tier}`)
    if (chest.perch) add(LADDER_MODEL)
  }
  if (level.supplies.length > 0) {
    add('campfire')
    add('campfire-burnt')
  }
  add('ch1-fence')
  for (const kind of levelEnemyKinds(level)) add(kind)
  if (!level.def.waves && level.areas.some((area, index) => index > 0 && area.kind !== 'boss')) add('grunt')
  if (level.rushes.length > 0) {
    add('turret')
    add('chest-weapon')
  }
  if (level.enemies.some((enemy) => enemy.affixes.length > 0)) add('elite-crown')
  if (level.boss) {
    add(level.boss.id)
    for (const id of BOSS_PARTS[level.boss.id] ?? []) add(id)
  }
  return [...ids].sort()
}

export function modelsFor(level: BuiltLevel): ModelId[] {
  return [...new Set<ModelId>([...RESIDENT_MODEL_IDS, ...levelModelIds(level)])].sort()
}

export function levelsToKeep(current: string, ahead: string | null, recent: readonly string[], extra: number): string[] {
  const kept = [current]
  for (const id of [ahead, ...recent]) {
    if (kept.length > extra) break
    if (id !== null && !kept.includes(id)) kept.push(id)
  }
  return kept
}

export function nextLevel<T extends { id: string; unlockAfter?: string }>(levels: readonly T[], id: string): T | null {
  return levels.find((def) => def.unlockAfter === id) ?? null
}
