import { describe, expect, it } from 'vitest'
import { parseMap } from './grid'
import { createFlowField, distanceAt, flowDirection, updateFlowField } from './pathing'

const { grid, playerSpawn } = parseMap(['#######', '#..E..#', '#.###.#', '#..P..#', '#######'].join('\n'))

describe('flow field', () => {
  it('measures walking distance around walls', () => {
    const field = createFlowField(grid)
    updateFlowField(field, grid, playerSpawn)
    expect(distanceAt(field, grid, 3, 3)).toBe(0)
    expect(distanceAt(field, grid, 1, 1)).toBe(4)
    expect(distanceAt(field, grid, 3, 1)).toBe(6)
    expect(distanceAt(field, grid, 3, 2)).toBe(Infinity)
  })

  it('steers sideways when the target is behind a wall', () => {
    const field = createFlowField(grid)
    updateFlowField(field, grid, playerSpawn)
    const direction = flowDirection(field, grid, { x: 3.5, y: 1.5 })
    expect(direction).not.toBeNull()
    expect(Math.abs(direction?.x ?? 0)).toBeCloseTo(1)
    expect(direction?.y ?? 1).toBeCloseTo(0)
  })

  it('heads down the open side corridor', () => {
    const field = createFlowField(grid)
    updateFlowField(field, grid, playerSpawn)
    expect(flowDirection(field, grid, { x: 1.5, y: 1.5 })).toEqual({ x: 0, y: 1 })
  })
})
