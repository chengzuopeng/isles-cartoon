import type { BuildingKind } from '../data/landmarks'
import type { RegionDef } from '../data/levels/types'
import { Tile, cellFloor, tileAt } from '../sim/grid'
import type { AreaInfo, BuiltLevel } from '../sim/level'
import { buildBuilding, type Building } from './buildings'

interface Structure extends Building {
  near: number
  far: number
}

export function barnPartAt(level: BuiltLevel, column: number, row: number): 'interior' | 'wall' | null {
  const area = level.areas[level.areaOfRow[row]]
  if (!area) return null
  const barn = area.scenery?.barn
  if (!barn) return null
  const local = row - area.top
  const [left, north] = barn.from
  const [right, south] = barn.to
  if (column < left || column > right || local < north || local > south) return null
  return column === left || column === right || local === north || local === south ? 'wall' : 'interior'
}

function buildStructure(level: BuiltLevel, area: AreaInfo, region: RegionDef, kind: BuildingKind): Structure {
  const [column, north] = region.from
  const row = area.top + north
  const width = region.to[0] - column + 1
  const depth = region.to[1] - north + 1
  const mask = Array.from({ length: depth }, (_, z) =>
    Array.from({ length: width }, (_, x) => {
      if (kind === 'big-barn') return tileAt(level.grid, column + x, row + z) === Tile.Wall ? '#' : '.'
      const corner = (x === 0 || x === width - 1) && (z === 0 || z === depth - 1)
      return corner ? '#' : '.'
    }).join(''),
  )
  const building = buildBuilding(kind, { column, row, width, depth, mask }, cellFloor(level.grid, column, row))
  return { ...building, near: row - 1, far: row + depth + 1 }
}

export function buildLevelStructures(level: BuiltLevel): Structure[] {
  const structures: Structure[] = []
  for (const area of level.areas) {
    const { scenery } = area
    for (const shed of scenery?.sheds ?? []) structures.push(buildStructure(level, area, shed, 'loading-shed'))
    if (scenery?.barn) structures.push(buildStructure(level, area, scenery.barn, 'big-barn'))
  }
  return structures
}
