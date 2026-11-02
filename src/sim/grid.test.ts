import { describe, expect, it } from 'vitest'
import { TRAINING } from '../data/levels/training'
import { Tile, blocksBullets, blocksMovement, parseMap, parseRows, tileAt } from './grid'

describe('parseMap', () => {
  it('reads tiles and spawn points', () => {
    const map = parseMap(['#####', '#P~E#', '#"..#', '#####'].join('\n'))
    expect(map.grid.columns).toBe(5)
    expect(map.grid.rows).toBe(4)
    expect(tileAt(map.grid, 2, 1)).toBe(Tile.Water)
    expect(tileAt(map.grid, 1, 2)).toBe(Tile.Bush)
    expect(tileAt(map.grid, 1, 1)).toBe(Tile.Floor)
    expect(map.playerSpawn).toEqual({ x: 1.5, y: 1.5 })
    expect(map.enemySpawns).toEqual([{ x: 3.5, y: 1.5 }])
  })

  it('treats everything outside the map as wall', () => {
    const map = parseMap(['P.', '..'].join('\n'))
    expect(tileAt(map.grid, -1, 0)).toBe(Tile.Wall)
    expect(tileAt(map.grid, 2, 1)).toBe(Tile.Wall)
  })

  it('rejects ragged rows, unknown symbols and maps without a player spawn', () => {
    expect(() => parseMap('P..\n..')).toThrow(/columns/)
    expect(() => parseMap('P?')).toThrow(/unknown/)
    expect(() => parseMap('...')).toThrow(/player spawn/)
  })

  it('parses the training ground', () => {
    const map = parseMap(TRAINING.areas[0].rows.join('\n'))
    expect(map.grid.columns).toBe(28)
    expect(map.grid.rows).toBe(20)
    expect(map.enemySpawns).toHaveLength(5)
  })
})

describe('terrain', () => {
  it('reads every terrain symbol and records markers', () => {
    const { grid, markers } = parseRows(['#~"Toc', 'f,DXPm'])
    const row0 = [Tile.Wall, Tile.Water, Tile.Bush, Tile.Tree, Tile.Rock, Tile.Crate]
    const row1 = [Tile.Fence, Tile.Path, Tile.Gate, Tile.Exit, Tile.Floor, Tile.Floor]
    row0.forEach((tile, column) => expect(tileAt(grid, column, 0)).toBe(tile))
    row1.forEach((tile, column) => expect(tileAt(grid, column, 1)).toBe(tile))
    expect(markers.map((marker) => marker.symbol)).toEqual(['P', 'm'])
  })

  it('gives markers the ground they stand on, so a spawn on a dirt road stays on the road', () => {
    const { grid } = parseRows(['.,,,.', '.,P,.', '.,,,.', '..m..', '.....'])
    expect(tileAt(grid, 2, 1)).toBe(Tile.Path)
    expect(tileAt(grid, 2, 3)).toBe(Tile.Floor)
    const edge = parseRows(['.P,'])
    expect(tileAt(edge.grid, 1, 0)).toBe(Tile.Floor)
  })

  it('lets bullets fly over water and fences but not through trees, rocks, crates or closed gates', () => {
    expect(blocksBullets(Tile.Water)).toBe(false)
    expect(blocksBullets(Tile.Fence)).toBe(false)
    expect(blocksBullets(Tile.Gate)).toBe(false)
    for (const tile of [Tile.Wall, Tile.Tree, Tile.Rock, Tile.Crate, Tile.GateClosed]) {
      expect(blocksBullets(tile)).toBe(true)
    }
    for (const tile of [Tile.Water, Tile.Fence, Tile.GateClosed]) expect(blocksMovement(tile)).toBe(true)
    for (const tile of [Tile.Bush, Tile.Path, Tile.Gate, Tile.Exit]) expect(blocksMovement(tile)).toBe(false)
  })
})
