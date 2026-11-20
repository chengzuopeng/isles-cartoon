import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { LANDMARKS } from '../data/landmarks'
import { LEVEL_1_1 } from '../data/levels/level-1-1'
import { LEVEL_1_2 } from '../data/levels/level-1-2'
import { Tile, tileAt } from '../sim/grid'
import type { LandmarkPlacement } from '../sim/landmarks'
import { buildLevel } from '../sim/level'
import { BUILDING_STYLES, buildBuilding, openingsOf } from './buildings'
import { barnPartAt, buildLevelStructures } from './level-buildings'

vi.mock('./line-textures', () => ({ lineTexture: () => new THREE.Texture() }))

function barnAt(column: number, row: number): LandmarkPlacement {
  const mask = [...(LANDMARKS['ch1-barn'].footprint ?? [])]
  return { id: 'ch1-barn', area: 0, column, row, width: mask[0].length, depth: mask.length, facing: 0, variant: 1, mask, cells: [], water: [], pool: [], gate: null }
}

describe('buildings', () => {
  it('finds the barn passages at the original south door and the offset east door', () => {
    expect(openingsOf(LANDMARKS['ch1-barn'].footprint ?? [])).toEqual([
      { side: 'south', from: 3, to: 5 },
      { side: 'east', from: 4, to: 6 },
    ])
    expect(openingsOf(['###', '#..', '###'])).toEqual([{ side: 'east', from: 1, to: 2 }])
  })

  it('builds walls, trim, roof, ceiling, beams, hay and doors inside the footprint plus the eaves', () => {
    const building = buildBuilding('barn', barnAt(3, 11), 2)
    const names = building.group.children.map((child) => child.name)
    expect(names).toEqual(['walls', 'trim', 'roof', 'ceiling', 'beams', 'lanterns', 'hay', 'doors', 'lantern-light'])
    const box = new THREE.Box3().setFromObject(building.group)
    const style = BUILDING_STYLES.barn
    expect(box.min.x).toBeGreaterThanOrEqual(3 - style.overhang - 0.01)
    expect(box.max.x).toBeLessThanOrEqual(11 + style.overhang + 0.01)
    expect(box.min.y).toBeCloseTo(1.6)
    expect(box.max.y).toBeGreaterThan(2 + style.wallHeight + 1)
    building.dispose()
  })

  it('builds the feed shed of 1-2 as a small walk-in shed open to the south, with no hay stacked over its chest', () => {
    const mask = [...(LANDMARKS['ch1-feed-shed'].footprint ?? [])]
    expect(LANDMARKS['ch1-feed-shed'].building).toBe('shed')
    expect(openingsOf(mask)).toEqual([{ side: 'south', from: 1, to: 3 }])
    const placement: LandmarkPlacement = { id: 'ch1-feed-shed', area: 0, column: 4, row: 2, width: 4, depth: 5, facing: 0, variant: 1, mask, cells: [], water: [], pool: [], gate: null }
    const building = buildBuilding('shed', placement, 1)
    const names = building.group.children.map((child) => child.name)
    expect(names).not.toContain('hay')
    expect(names).toContain('roof')
    const box = new THREE.Box3().setFromObject(building.group)
    expect(box.max.y).toBeLessThan(1 + BUILDING_STYLES.barn.wallHeight)
    expect(box.max.y).toBeGreaterThan(1 + BUILDING_STYLES.shed.wallHeight)
    building.dispose()
  })

  it('paints the wall faces that look into the barn with the inside material', () => {
    const building = buildBuilding('barn', barnAt(0, 0), 0)
    const walls = building.group.getObjectByName('walls') as THREE.Mesh
    expect(Array.isArray(walls.material)).toBe(true)
    expect(walls.geometry.groups.map((group) => group.materialIndex)).toEqual([0, 1])
    expect(walls.geometry.groups.every((group) => group.count > 0)).toBe(true)
    building.dispose()
  })

  it('builds the pasture shelters on the existing barriers and keeps both barn gates playable', () => {
    const level = buildLevel(LEVEL_1_2)
    const yards = level.areas[2]
    for (const shed of yards.scenery?.sheds ?? []) {
      for (let row = shed.from[1]; row <= shed.to[1]; row++) {
        for (let column = shed.from[0]; column <= shed.to[0]; column++) {
          expect(tileAt(level.grid, column, row + yards.top)).toBe(Tile.Wall)
        }
      }
    }
    const buildings = buildLevelStructures(level)
    const barn = buildings.find((item) => item.group.name === 'building-big-barn')!
    expect(buildings.filter((item) => item.group.name === 'building-loading-shed')).toHaveLength(5)
    expect(barn.group.getObjectByName('lanterns')).toBeDefined()
    expect(barn.group.getObjectByName('doors')).toBeUndefined()
    const roof = new THREE.Box3().setFromObject(barn.group.getObjectByName('roof')!)
    expect(roof.min.y).toBeGreaterThan(9.7)
    expect(roof.max.y).toBeGreaterThan(14)
    expect(roof.max.y).toBeLessThan(14.5)
    for (const row of [3, 34]) {
      expect(barnPartAt(level, 29, row)).toBe('wall')
      expect(tileAt(level.grid, 29, row)).toBe(Tile.Gate)
    }
    expect(barnPartAt(level, 29, 18)).toBe('interior')
    buildings.forEach((building) => building.dispose())
  })

  it.each(['ch1-field-tool-shed', 'ch1-repair-workshop', 'ch1-weighhouse'] as const)('aligns both visible doorways and the exterior wall of %s with its footprint', (id) => {
    const level = buildLevel(id === 'ch1-field-tool-shed' ? LEVEL_1_1 : LEVEL_1_2)
    const placement = level.landmarks.find((item) => item.id === id)!
    const { column, row, width, depth } = placement
    const floor = level.grid.floor[row * level.grid.columns + column]
    const building = buildBuilding(LANDMARKS[id].building!, placement, floor)
    building.group.updateMatrixWorld(true)
    const hit = (x: number, z: number, dx: number, dz: number) =>
      new THREE.Raycaster(new THREE.Vector3(x, floor + 1.5, z), new THREE.Vector3(dx, 0, dz), 0, 2.4).intersectObject(building.group)
    expect(hit(column + 2, row + depth + 0.5, 0, -1)).toHaveLength(0)
    expect(hit(column + width + 0.5, row + 2, -1, 0)).toHaveLength(0)
    expect(hit(column - 0.5, row + 2, 1, 0)[0]?.point.x).toBeCloseTo(column)
    building.dispose()
  })

  it('leaves the new barn passage clear and frames it with a lantern above standing height', () => {
    const building = buildBuilding('barn', barnAt(3, 30), 2)
    building.group.updateMatrixWorld(true)
    const through = new THREE.Raycaster(new THREE.Vector3(11.5, 3.5, 35), new THREE.Vector3(-1, 0, 0), 0, 3.5)
    expect(through.intersectObject(building.group)).toHaveLength(0)
    const lantern = new THREE.Box3().setFromObject(building.group.getObjectByName('lanterns')!)
    expect(lantern.min.y).toBeGreaterThan(4.8)
    building.dispose()
  })
})
