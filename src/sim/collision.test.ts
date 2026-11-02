import { describe, expect, it } from 'vitest'
import { corridorClear, resolveCircleGrid, segmentClear } from './collision'
import { blocksBullets, blocksMovement, parseMap } from './grid'

const { grid } = parseMap(['#######', '#P....#', '#..#..#', '#..~..#', '#######'].join('\n'))

describe('resolveCircleGrid', () => {
  it('pushes a circle out of a wall it overlaps', () => {
    const pos = { x: 1.3, y: 1.5 }
    expect(resolveCircleGrid(pos, 0.4, grid)).toBe(true)
    expect(pos.x).toBeCloseTo(1.4)
    expect(pos.y).toBeCloseTo(1.5)
  })

  it('keeps the motion along a wall so the body slides', () => {
    const pos = { x: 1.3, y: 2.2 }
    resolveCircleGrid(pos, 0.4, grid)
    expect(pos.x).toBeCloseTo(1.4)
    expect(pos.y).toBeCloseTo(2.2)
  })

  it('leaves a circle in open space alone', () => {
    const pos = { x: 4.5, y: 1.5 }
    expect(resolveCircleGrid(pos, 0.4, grid)).toBe(false)
    expect(pos).toEqual({ x: 4.5, y: 1.5 })
  })

  it('blocks movement on water but not when testing for bullets', () => {
    const walker = { x: 4.3, y: 3.5 }
    resolveCircleGrid(walker, 0.4, grid, blocksMovement)
    expect(walker.x).toBeCloseTo(4.4)
    const bullet = { x: 4.3, y: 3.5 }
    expect(resolveCircleGrid(bullet, 0.4, grid, blocksBullets)).toBe(false)
  })
})

describe('segmentClear', () => {
  it('is blocked by walls', () => {
    expect(segmentClear(grid, { x: 1.5, y: 2.5 }, { x: 5.5, y: 2.5 })).toBe(false)
    expect(segmentClear(grid, { x: 1.5, y: 1.5 }, { x: 5.5, y: 1.5 })).toBe(true)
  })

  it('lets bullets cross water but not walkers', () => {
    const from = { x: 1.5, y: 3.5 }
    const to = { x: 5.5, y: 3.5 }
    expect(segmentClear(grid, from, to, blocksMovement)).toBe(false)
    expect(segmentClear(grid, from, to, blocksBullets)).toBe(true)
  })

  it('checks the width of a body with corridorClear', () => {
    const from = { x: 1.5, y: 1.5 }
    const to = { x: 5.5, y: 1.5 }
    expect(corridorClear(grid, from, to, 0.3)).toBe(true)
    expect(corridorClear(grid, from, to, 0.6)).toBe(false)
  })
})
