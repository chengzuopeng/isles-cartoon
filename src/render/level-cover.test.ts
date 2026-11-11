import { describe, expect, it } from 'vitest'
import { parseRows } from '../sim/grid'
import type { BuiltLevel } from '../sim/level'
import { HIDDEN_TOP, TREE_THIN, hiddenTops, treeDepths, treeLook, walkableCells } from './level-cover'

function levelOf(rows: string[], heights?: string[]): BuiltLevel {
  const { grid, markers } = parseRows(rows, heights)
  const start = markers.find((marker) => marker.symbol === 'P')!
  return { grid, playerStart: { x: start.x, y: start.y } } as unknown as BuiltLevel
}

describe('trees deep in a wood', () => {
  const forest = levelOf(['##########', '#TTTTTTTT#', '#TTTTTTTT#', '#TTTTTTTT#', '#TTTTTTTT#', '#TTTTTTTT#', '#P.......#', '##########'])
  const depth = treeDepths(forest.grid)
  const at = (column: number, row: number) => depth[row * forest.grid.columns + column]

  it('count how far each tree stands from open ground', () => {
    expect([5, 4, 3, 2, 1].map((row) => at(4, row))).toEqual([1, 2, 3, 4, 5])
    expect(at(0, 0)).toBe(0)
    expect(at(2, 6)).toBe(0)
  })

  it('keep the two rows by the path, every other tree behind them and only a few far in', () => {
    expect(treeLook(1, 3, 5)).toEqual({ scale: 1, shadow: true, ink: true })
    expect(treeLook(2, 3, 4)).toEqual({ scale: 1, shadow: false, ink: true })
    expect(treeLook(3, 2, 2)?.scale).toBe(TREE_THIN.halfScale)
    expect(treeLook(3, 2, 3)).toBeNull()
    const far = []
    for (let column = 0; column < 100; column++) for (let row = 0; row < 100; row++) far.push(treeLook(8, column, row))
    const kept = far.filter((look) => look !== null)
    expect(kept.length / far.length).toBeCloseTo(TREE_THIN.sparseShare, 1)
    expect(kept.every((look) => !look.shadow && !look.ink && look.scale === TREE_THIN.sparseScale)).toBe(true)
  })
})

describe('plateau tops out of sight', () => {
  const rows = ['##############', '#""""""""""""#', '#""""""""""""#', '#""""""""""""#', '#""""""""""""#', '#""""""""""""#', '#""""""""""""#', '#""""""""""""#', '#P...........#', '##############']
  const raised = ['00000000000000', '06666666666660', '06666666666660', '06666666666660', '06666666666660', '06666666666660', '06666666666660', '06666666666660', '00000000000000', '00000000000000']

  it('let the hero walk the lane but not climb a bank three metres up', () => {
    const level = levelOf(rows, raised)
    const walk = walkableCells(level.grid, level.playerStart)
    expect(walk[8 * 14 + 10]).toBe(1)
    expect(walk[7 * 14 + 10]).toBe(0)
  })

  it('skip the middle of a high bank but keep the edge that shows from below', () => {
    const level = levelOf(rows, raised)
    const hidden = hiddenTops(level)
    const at = (column: number, row: number) => hidden[row * 14 + column]
    expect(at(6, 7)).toBe(0)
    expect(at(6, 8 - HIDDEN_TOP.gap + 1)).toBe(0)
    expect(at(6, 8 - HIDDEN_TOP.gap)).toBe(1)
    expect(at(6, 1)).toBe(1)
  })

  it('keep a field at the same height even when water keeps the hero off it', () => {
    const level = levelOf(['##########', '#""""""""#', '#""""""""#', '#""""""""#', '#""""""""#', '#~~~~~~~~#', '#P.......#', '##########'])
    expect(hiddenTops(level).every((cell) => cell === 0)).toBe(true)
  })

  it('keep a low bank the hero could see over', () => {
    const low = raised.map((line) => line.replace(/6/g, '2'))
    const level = levelOf(rows, low)
    expect(walkableCells(level.grid, level.playerStart)[7 * 14 + 10]).toBe(1)
    expect(hiddenTops(level).every((cell) => cell === 0)).toBe(true)
  })
})
