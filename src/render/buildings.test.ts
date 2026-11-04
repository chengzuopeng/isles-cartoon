import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { LANDMARKS } from '../data/landmarks'
import type { LandmarkPlacement } from '../sim/landmarks'
import { BUILDING_STYLES, buildBuilding, openingsOf } from './buildings'

vi.mock('./line-textures', () => ({ lineTexture: () => new THREE.Texture() }))

function barnAt(column: number, row: number): LandmarkPlacement {
  const mask = [...(LANDMARKS['ch1-barn'].footprint ?? [])]
  return { id: 'ch1-barn', area: 0, column, row, width: mask[0].length, depth: mask.length, facing: 0, variant: 1, mask, cells: [], water: [], pool: [], gate: null }
}

describe('buildings', () => {
  it('finds the barn door as one two-cell gap in the south wall', () => {
    expect(openingsOf(LANDMARKS['ch1-barn'].footprint ?? [])).toEqual([{ side: 'south', from: 3, to: 5 }])
    expect(openingsOf(['###', '#..', '###'])).toEqual([{ side: 'east', from: 1, to: 2 }])
  })

  it('builds walls, trim, roof, ceiling, beams, hay and doors inside the footprint plus the eaves', () => {
    const building = buildBuilding('barn', barnAt(3, 11), 2)
    const names = building.group.children.map((child) => child.name)
    expect(names).toEqual(['walls', 'trim', 'roof', 'ceiling', 'beams', 'hay', 'doors'])
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
})
