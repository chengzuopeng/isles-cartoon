import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { FACINGS, type Facing } from '../data/landmarks'
import { LEVEL_1_1 } from '../data/levels/level-1-1'
import { LEVEL_1_5 } from '../data/levels/level-1-5'
import type { Theme } from '../data/levels/types'
import { Tile, parseRows } from '../sim/grid'
import { rotateFootprint } from '../sim/landmarks'
import { buildLevel } from '../sim/level'
import {
  bridgeAt,
  cellHash,
  chunkOf,
  drivenNodes,
  hiddenInside,
  insideFootprint,
  fallbackShadow,
  facingStep,
  facingYaw,
  gateFacing,
  glowLevel,
  landmarkModel,
  landmarkOf,
  modelShadow,
  motionAngle,
  motionAxis,
  hingeOf,
  onePartProp,
  landmarkYaw,
  openProgress,
  pickVariant,
  propModel,
  propScale,
  propYaw,
  proxyShape,
  quarterTurn,
  railEnds,
  railFacings,
  stateModel,
  stateOf,
  swingEase,
  variantIds,
  variantModel,
  type Links,
} from './scene-models'
import { LANDMARK_OPEN } from './themes'

const THEMES: Theme[] = ['farm', 'meadow', 'village', 'forest', 'outpost', 'arena', 'factory']
const STEP: Readonly<Record<keyof Links, readonly [number, number]>> = {
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0],
}

function loaded(...ids: string[]): (id: string) => boolean {
  const set = new Set(ids)
  return (id) => set.has(id)
}

const UP = new THREE.Vector3(0, 1, 0)

function modelDirection(facing: number, x: number, z: number): [number, number] {
  const vector = new THREE.Vector3(x, 0, z).applyAxisAngle(UP, facingYaw(facing))
  return [Math.round(vector.x) + 0, Math.round(vector.z) + 0]
}

function mapTurn(facing: number, dx: number, dz: number): [number, number] {
  const vector = new THREE.Vector3(dx, 0, dz).applyAxisAngle(UP, facingYaw(facing) - facingYaw(0))
  return [Math.round(vector.x) + 0, Math.round(vector.z) + 0]
}

describe('tile models by theme', () => {
  it('builds walls from wood on farms, yards and the arena, stone on the slope, rock in the woods and metal at outposts', () => {
    const walls = Object.fromEntries(THEMES.map((theme) => [theme, propModel('wall', theme)]))
    expect(walls).toEqual({
      farm: 'ch1-wall-wood',
      village: 'ch1-wall-wood',
      arena: 'ch1-wall-wood',
      meadow: 'ch1-wall-stone',
      forest: 'ch1-wall-rock',
      outpost: 'ch1-wall-metal',
      factory: 'ch1-wall-metal',
    })
  })

  it('draws o as a haystack on farmland and in the threshing yard, and as a rock elsewhere', () => {
    expect(propModel('rock', 'farm')).toBe('ch1-haystack')
    expect(propModel('rock', 'village')).toBe('ch1-haystack')
    for (const theme of ['meadow', 'forest', 'outpost', 'arena', 'factory'] as const) expect(propModel('rock', theme)).toBe('ch1-rock')
    expect(propModel('bush', 'farm')).toBe('ch1-bush-wheat')
    expect(propModel('bush', 'meadow')).toBe('ch1-bush-grass')
    expect(propModel('cart', 'village')).toBe('ch1-cart')
    expect(propModel('gate', 'arena')).toBe('ch1-gate')
  })
})

describe('variants', () => {
  it('names extra variants after the base model', () => {
    expect(variantIds('ch1-tree', 3)).toEqual(['ch1-tree-a', 'ch1-tree-b', 'ch1-tree-c'])
    expect(variantIds('ch1-cart', 1)).toEqual(['ch1-cart-a'])
  })

  it('picks the same variant for a cell every time and uses all of them across a patch', () => {
    const seen = new Set<number>()
    let changes = 0
    for (let row = 0; row < 10; row++) {
      for (let column = 0; column < 10; column++) {
        const variant = pickVariant(column, row, 3)
        expect(variant).toBe(pickVariant(column, row, 3))
        expect(variant).toBeGreaterThanOrEqual(1)
        expect(variant).toBeLessThanOrEqual(3)
        seen.add(variant)
        if (column > 0 && variant !== pickVariant(column - 1, row, 3)) changes++
      }
    }
    expect([...seen].sort()).toEqual([1, 2, 3])
    expect(changes).toBeGreaterThan(40)
    expect(pickVariant(4, 7, 1)).toBe(1)
  })

  it('turns props by whole quarter turns, spread over all four', () => {
    const turns = new Set<Facing>()
    for (let row = 0; row < 8; row++) for (let column = 0; column < 8; column++) turns.add(quarterTurn(column, row))
    expect([...turns].sort((a, b) => a - b)).toEqual([0, 90, 180, 270])
    for (let i = 0; i < 50; i++) {
      const value = cellHash(i, i * 3)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('turns walls, rocks and carts by quarter turns, and trees and bushes to any angle at a slightly varied size', () => {
    const quarters = (kind: 'wall' | 'rock' | 'cart') => {
      for (let row = 0; row < 6; row++) {
        for (let column = 0; column < 6; column++) {
          const quarter = (propYaw(kind, column, row) - facingYaw(0)) / (Math.PI / 2)
          expect(Math.abs(quarter - Math.round(quarter))).toBeLessThan(1e-9)
          expect(propScale(kind, column, row)).toBe(1)
        }
      }
    }
    quarters('wall')
    quarters('rock')
    quarters('cart')
    for (const kind of ['tree', 'bush'] as const) {
      const yaws: number[] = []
      const scales: number[] = []
      for (let row = 0; row < 8; row++) {
        for (let column = 0; column < 8; column++) {
          expect(propYaw(kind, column, row)).toBe(propYaw(kind, column, row))
          yaws.push(propYaw(kind, column, row))
          scales.push(propScale(kind, column, row))
        }
      }
      const offQuarter = yaws.filter((yaw) => {
        const quarter = yaw / (Math.PI / 2)
        return Math.abs(quarter - Math.round(quarter)) > 0.05
      })
      expect(offQuarter.length).toBeGreaterThan(yaws.length / 2)
      expect(Math.min(...yaws)).toBeGreaterThanOrEqual(0)
      expect(Math.max(...yaws)).toBeLessThan(Math.PI * 2)
      expect(Math.min(...scales)).toBeGreaterThanOrEqual(0.92)
      expect(Math.max(...scales)).toBeLessThanOrEqual(1.08)
      expect(Math.max(...scales) - Math.min(...scales)).toBeGreaterThan(0.1)
    }
  })

  it('falls back to the base model, then to nothing', () => {
    const column = [...Array(20).keys()].find((c) => pickVariant(c, 0, 3) === 2) ?? 0
    expect(variantModel(loaded('ch1-rock-a', 'ch1-rock-b'), 'ch1-rock', 3, column, 0)).toBe('ch1-rock-b')
    expect(variantModel(loaded('ch1-rock-a', 'ch1-rock-c'), 'ch1-rock', 3, column, 0)).toBe('ch1-rock-a')
    expect(variantModel(loaded('ch1-rock'), 'ch1-rock', 3, column, 0)).toBe('ch1-rock')
    expect(variantModel(loaded(), 'ch1-rock', 3, column, 0)).toBeNull()
    expect(landmarkModel(loaded('ch1-wheat-ears-a', 'ch1-wheat-ears-b'), 'ch1-wheat-ears', 2)).toBe('ch1-wheat-ears-b')
    expect(landmarkModel(loaded('ch1-wheat-ears-a'), 'ch1-wheat-ears', 3)).toBe('ch1-wheat-ears-a')
    expect(landmarkModel(loaded('ch1-barn'), 'ch1-barn', 1)).toBe('ch1-barn')
    expect(landmarkModel(loaded(), 'ch1-windmill', 1)).toBeNull()
  })

  it('folds every variant of the trees, the walls but metal, the haystacks, the wheat bushes and the fence into one part, and nothing else', () => {
    const folded = ['ch1-tree', 'ch1-tree-a', 'ch1-tree-b', 'ch1-tree-c', 'ch1-wall-wood', 'ch1-wall-wood-b', 'ch1-wall-wood-c', 'ch1-wall-stone', 'ch1-wall-rock-b', 'ch1-haystack-c', 'ch1-bush-wheat', 'ch1-fence']
    for (const id of folded) expect(onePartProp(id), id).toBe(true)
    for (const id of ['ch1-wall-metal', 'ch1-wall-metal-b', 'ch1-rock', 'ch1-bush-grass', 'ch1-cart', 'ch1-bridge', 'ch1-treehouse']) expect(onePartProp(id), id).toBe(false)
  })
})

describe('shadow casters', () => {
  it('casts walls as boxes, trees and bushes as lathes, keeps the cover props as they are and leaves fences and bridges out', () => {
    expect(proxyShape('wall')).toBe('box')
    expect(proxyShape('tree')).toBe('lathe')
    expect(proxyShape('bush')).toBe('lathe')
    for (const kind of ['rock', 'cart', 'gate'] as const) {
      expect(modelShadow(kind), kind).toBe(true)
      expect(proxyShape(kind), kind).toBeNull()
    }
    for (const kind of ['wall', 'tree', 'bush', 'fence', 'bridge'] as const) expect(modelShadow(kind), kind).toBe(false)
    for (const kind of ['fence', 'bridge'] as const) {
      expect(fallbackShadow(kind), kind).toBe(false)
      expect(proxyShape(kind), kind).toBeNull()
    }
    for (const kind of ['wall', 'tree', 'bush', 'rock', 'cart'] as const) expect(fallbackShadow(kind), kind).toBe(true)
  })
})

describe('facing', () => {
  it('turns the model front (+X) to the south at 0 and clockwise on the map from there', () => {
    expect(modelDirection(0, 1, 0)).toEqual([0, 1])
    expect(modelDirection(90, 1, 0)).toEqual([-1, 0])
    expect(modelDirection(180, 1, 0)).toEqual([0, -1])
    expect(modelDirection(270, 1, 0)).toEqual([1, 0])
    expect(modelDirection(0, 0, -1)).toEqual([1, 0])
  })

  it('agrees with the way the sim rotates footprints', () => {
    const front = ['...', '...', '.#.']
    for (const facing of FACINGS) {
      const mask = rotateFootprint(front, facing)
      const row = mask.findIndex((line) => line.includes('#'))
      const column = mask[row].indexOf('#')
      expect([column - 1, row - 1]).toEqual(modelDirection(facing, 1, 0))
    }
  })
})

describe('fences', () => {
  it('points one rail from the post at each neighbouring fence', () => {
    expect(railFacings({ north: false, east: true, south: false, west: true })).toEqual([0, 180])
    expect(railFacings({ north: true, east: true, south: false, west: false })).toEqual([0, 270])
    expect(railFacings({ north: false, east: false, south: false, west: false })).toEqual([])
    const all = railFacings({ north: true, east: true, south: true, west: true })
    expect(all.map((facing) => mapTurn(facing, 1, 0).join())).toEqual(['1,0', '0,1', '-1,0', '0,-1'])
    const sides: (keyof Links)[] = ['east', 'south', 'west', 'north']
    all.forEach((facing, index) => expect(mapTurn(facing, 1, 0)).toEqual([...STEP[sides[index]]]))
  })

  it('puts the rail of the fence model, which points to Blender +Y, on the east side at facing 0', () => {
    expect(modelDirection(0, 0, -1)).toEqual([1, 0])
    expect(modelDirection(railFacings({ north: true, east: false, south: false, west: false })[0], 0, -1)).toEqual([0, -1])
  })
})

describe('bridges and gates', () => {
  it('finds the two bridges over the river on the windmill slope', () => {
    const level = buildLevel(LEVEL_1_1)
    const slope = level.areas[1]
    const bridges: [number, number, Facing[]][] = []
    for (let row = slope.top; row < slope.bottom; row++) {
      for (let column = 0; column < level.grid.columns; column++) {
        const bridge = bridgeAt(level.grid, column, row)
        if (bridge) {
          expect(bridge.facing).toBe(0)
          bridges.push([column, row - slope.top, bridge.rails])
        }
      }
    }
    expect(bridges).toHaveLength(24)
    expect(new Set(bridges.map(([, row]) => row))).toEqual(new Set([8, 9, 10, 11]))
    expect(new Set(bridges.map(([column]) => column))).toEqual(new Set([7, 8, 9, 30, 31, 32]))
    expect(bridges.find(([column, row]) => column === 7 && row === 8)?.[2]).toEqual([180])
    expect(bridges.find(([column, row]) => column === 8 && row === 8)?.[2]).toEqual([])
    expect(bridges.find(([column, row]) => column === 9 && row === 8)?.[2]).toEqual([0])
  })

  it('lays a bridge east to west over a river that runs north to south', () => {
    const river = parseRows(['#.~.#', '#.~.#', '#,,,#', '#.~.#']).grid
    expect(bridgeAt(river, 2, 2)).toEqual({ facing: 90, rails: [90, 270] })
    expect(bridgeAt(river, 1, 2)).toBeNull()
    expect(bridgeAt(river, 2, 1)).toBeNull()
    const ford = parseRows(['#~.~#', '#~,~#', '#~.~#']).grid
    expect(bridgeAt(ford, 2, 1)).toEqual({ facing: 0, rails: [0, 180] })
    const wide = parseRows(['~........~', '~........~']).grid
    expect(bridgeAt(wide, 4, 0)).toBeNull()
    expect(wide.tiles[4]).toBe(Tile.Floor)
  })

  it('turns gates along the line of gates, with the badge of a north-south gate towards the middle of the map', () => {
    const { grid } = parseRows(['##DDD##', '#.....#', 'D.....D', 'D.....D', '#######'])
    expect(gateFacing(grid, 3, 0)).toBe(0)
    expect(gateFacing(grid, 0, 2)).toBe(270)
    expect(gateFacing(grid, 6, 3)).toBe(90)
    expect(modelDirection(gateFacing(grid, 0, 2), 1, 0)).toEqual([1, 0])
    expect(modelDirection(gateFacing(grid, 6, 3), 1, 0)).toEqual([-1, 0])
  })

  it('steps from a cell to the neighbour on the +X end of a model at each facing', () => {
    for (const facing of FACINGS) expect([...facingStep(facing)]).toEqual(modelDirection(facing, 1, 0))
  })

  it('caps each bridge rail with an end post where the next cell along it is not deck', () => {
    const level = buildLevel(LEVEL_1_1)
    const slope = level.areas[1]
    const { grid } = level
    const isDeck = (column: number, row: number) => bridgeAt(grid, column, row) !== null
    const ends: [number, number, Facing][] = []
    for (let row = slope.top; row < slope.bottom; row++) {
      for (let column = 0; column < grid.columns; column++) {
        const bridge = bridgeAt(grid, column, row)
        if (bridge) for (const facing of railEnds(bridge, column, row, isDeck)) ends.push([column, row - slope.top, facing])
      }
    }
    expect(ends.sort()).toEqual(
      [
        [7, 8, 180],
        [9, 11, 0],
        [30, 8, 180],
        [32, 11, 0],
      ].sort(),
    )
    const ford = parseRows(['#~.~#', '#~,~#', '#~.~#']).grid
    const onFord = (column: number, row: number) => bridgeAt(ford, column, row) !== null
    expect([0, 1, 2].map((row) => railEnds(bridgeAt(ford, 2, row)!, 2, row, onFord))).toEqual([[180], [], [0]])
    const river = parseRows(['#.~.#', '#.~.#', '#,,,#', '#.~.#']).grid
    const crossing = bridgeAt(river, 2, 2)!
    expect(railEnds(crossing, 2, 2, (column, row) => bridgeAt(river, column, row) !== null)).toEqual([90, 270])
  })
})

describe('chunks', () => {
  it('groups cells into blocks counted row by row across the map', () => {
    expect(chunkOf(0, 0, 40, 8, 8)).toBe(0)
    expect(chunkOf(7, 7, 40, 8, 8)).toBe(0)
    expect(chunkOf(8, 0, 40, 8, 8)).toBe(1)
    expect(chunkOf(39, 0, 40, 8, 8)).toBe(4)
    expect(chunkOf(0, 8, 40, 8, 8)).toBe(5)
    expect(chunkOf(39, 99, 40, 8, 8)).toBe(12 * 5 + 4)
    expect(chunkOf(39, 19, 40, 20, 10)).toBe(3)
    expect(chunkOf(19, 9, 40, 20, 10)).toBe(0)
  })
})

describe('nodes the code drives', () => {
  it('lists the fence, bridge and gate nodes, and the moving, hiding and glowing landmark nodes for every variant', () => {
    expect(drivenNodes('ch1-fence')).toEqual(['post', 'rail'])
    expect(drivenNodes('ch1-bridge')).toEqual(['deck', 'rail', 'rail_end'])
    expect(drivenNodes('ch1-gate')).toEqual(['socket_fx_glow'])
    expect(drivenNodes('ch1-windmill')).toEqual(['sails'])
    expect(drivenNodes('ch1-star-altar')).toEqual(['star'])
    expect(drivenNodes('ch1-barn')).toEqual(['roof'])
    expect(drivenNodes('ch1-wheat-ears-b')).toEqual([])
    expect(drivenNodes('ch1-wall-wood-b')).toEqual([])
    expect(landmarkOf('ch1-wheat-ears-c')).toBe('ch1-wheat-ears')
    expect(landmarkOf('ch1-log-short')).toBe('ch1-log-short')
    expect(landmarkOf('ch1-rock-b')).toBeNull()
  })

  it('counts the player inside a footprint from its north-west corner up to, but not on, its far edges', () => {
    const level = buildLevel(LEVEL_1_5)
    const airship = level.landmarks.find((placement) => placement.id === 'ch1-airship')
    if (!airship) throw new Error('no airship')
    expect([airship.width, airship.depth]).toEqual([6, 12])
    const inside = (x: number, y: number) => insideFootprint(x, y, airship.column, airship.row, airship.width, airship.depth)
    expect(inside(airship.column, airship.row)).toBe(true)
    expect(inside(airship.column + 3.5, airship.row + 11.9)).toBe(true)
    expect(inside(airship.column + 6, airship.row + 5)).toBe(false)
    expect(inside(airship.column + 3, airship.row + 12)).toBe(false)
    expect(inside(airship.column - 0.01, airship.row + 5)).toBe(false)
  })

  it('adds the airship propellers and the balloon it hides from inside, and the reel of the blade trap', () => {
    expect(drivenNodes('ch1-airship')).toEqual(['prop_l', 'prop_r', 'balloon'])
    expect(hiddenInside('ch1-airship')).toEqual(['balloon'])
    expect(hiddenInside('ch1-barn')).toEqual([])
    expect(drivenNodes('ch1-blade-trap')).toEqual(['reel'])
  })

  it('adds the gate of the sheep pen and the wheel and secret door of the watermill, but nothing for broken states', () => {
    expect(drivenNodes('ch1-sheep-pen')).toEqual(['gate'])
    expect(drivenNodes('ch1-watermill')).toEqual(['wheel', 'secret_door'])
    expect(drivenNodes('ch1-feed-shed')).toEqual(['roof'])
    expect(landmarkOf('ch1-hay-cart-wreck')).toBe('ch1-hay-cart')
    expect(landmarkOf('ch1-hay-pillar-collapsed')).toBe('ch1-hay-pillar')
    expect(stateOf('ch1-hay-cart', 'ch1-hay-cart-wreck')).toBe('wreck')
    expect(stateOf('ch1-hay-cart', 'ch1-hay-cart-burnt')).toBeNull()
    expect(drivenNodes('ch1-hay-cart-wreck')).toEqual([])
    expect(drivenNodes('ch1-hay-pillar-collapsed')).toEqual([])
  })

  it('drives the bell and the alarm lamp of the bell tower, the well crank and bucket, both cellar doors and the smoke and forge sockets', () => {
    expect(drivenNodes('ch1-bell-tower')).toEqual(['roof', 'bell', 'lamp'])
    expect(drivenNodes('ch1-well')).toEqual(['crank', 'bucket', 'roof'])
    expect(drivenNodes('ch1-cellar')).toEqual(['door_l', 'door_r'])
    expect(drivenNodes('ch1-smithy')).toEqual(['socket_fx_forge', 'socket_fx_smoke'])
    expect(drivenNodes('ch1-farmhouse')).toEqual(['socket_fx_smoke'])
    expect(drivenNodes('ch1-silo')).toEqual([])
    expect(drivenNodes('ch1-wheat-stack-c')).toEqual([])
    expect(drivenNodes('ch1-ruined-wall-b')).toEqual([])
  })

  it('turns ruined walls by quarter turns and wheat stacks by any angle, cell by cell, and leaves other landmarks as placed', () => {
    const quarter = (yaw: number) => Math.abs(yaw / (Math.PI / 2) - Math.round(yaw / (Math.PI / 2)))
    const walls = Array.from({ length: 24 }, (_, i) => landmarkYaw('ch1-ruined-wall', 0, i, 3))
    expect(walls.every((yaw) => quarter(yaw - facingYaw(0)) < 1e-9)).toBe(true)
    expect(new Set(walls.map((yaw) => yaw.toFixed(4))).size).toBeGreaterThan(2)
    const stacks = Array.from({ length: 24 }, (_, i) => landmarkYaw('ch1-wheat-stack', 0, i, 5))
    expect(stacks.some((yaw) => quarter(yaw) > 0.05)).toBe(true)
    expect(landmarkYaw('ch1-wheat-stack', 0, 4, 5)).toBe(landmarkYaw('ch1-wheat-stack', 0, 4, 5))
    expect(landmarkYaw('ch1-silo', 90, 4, 5)).toBe(facingYaw(90))
    for (const id of ['ch1-bale-block', 'ch1-anchor-crate'] as const) {
      const turns = Array.from({ length: 24 }, (_, i) => landmarkYaw(id, 0, i, 7))
      expect(turns.every((yaw) => quarter(yaw - facingYaw(0)) < 1e-9)).toBe(true)
      expect(new Set(turns.map((yaw) => yaw.toFixed(4))).size).toBeGreaterThan(2)
    }
  })

  it('finds a broken state model only when it is loaded', () => {
    const loaded = new Set(['ch1-hay-cart', 'ch1-hay-cart-wreck'])
    expect(stateModel((id) => loaded.has(id), 'ch1-hay-cart', 'wreck')).toBe('ch1-hay-cart-wreck')
    expect(stateModel((id) => loaded.has(id), 'ch1-hay-pillar', 'collapsed')).toBeNull()
  })

  it('makes the star glow breathe around its gain', () => {
    const rule = { node: 'star', gain: 2, swing: 0.5, speed: 1 }
    expect(glowLevel(rule, 0)).toBeCloseTo(2)
    expect(glowLevel(rule, Math.PI / 2)).toBeCloseTo(2.5)
    expect(glowLevel(rule, (3 * Math.PI) / 2)).toBeCloseTo(1.5)
  })
})

describe('landmark motion', () => {
  it('spins at a steady rate or swings back and forth', () => {
    expect(motionAngle({ node: 'blades', axis: 'x', spin: 0.5 }, 4)).toBeCloseTo(2)
    expect(motionAngle({ node: 'bell', axis: 'x', swing: 0.3, speed: 2 }, Math.PI / 4)).toBeCloseTo(0.3)
    expect(motionAngle({ node: 'bell', axis: 'x', swing: 0.3, speed: 2 }, 0)).toBeCloseTo(0)
  })

  it('maps Blender axes onto the node axes after the glTF export', () => {
    expect(motionAxis('x')).toEqual([1, 0, 0])
    expect(motionAxis('y')).toEqual([0, 0, -1])
    expect(motionAxis('z')).toEqual([0, 1, 0])
  })
})

describe('opening gates and doors', () => {
  it('swings open over the opening time and closes the same way', () => {
    let amount = 0
    for (let i = 0; i < 6; i++) amount = openProgress(amount, true, 0.1, 0.6)
    expect(amount).toBeCloseTo(1, 9)
    expect(openProgress(amount, true, 0.1, 0.6)).toBe(1)
    expect(openProgress(0, true, 0.3, 0.6)).toBeCloseTo(0.5, 9)
    expect(openProgress(1, false, 0.3, 0.6)).toBeCloseTo(0.5, 9)
    expect(openProgress(0.2, true, 0.1, 0)).toBe(1)
  })

  it('eases out so the gate slows down as it reaches the stop', () => {
    expect(swingEase(0)).toBe(0)
    expect(swingEase(1)).toBe(1)
    expect(swingEase(0.5)).toBeGreaterThan(0.5)
    expect(swingEase(2)).toBe(1)
  })

  it('opens the pen gate outwards by about 100 degrees and the secret door inwards by 90, both round the upright', () => {
    const hinges = { 'ch1-sheep-pen': { gate: { axis: 'z', angle: -1.7 } } } as const
    expect(hingeOf('ch1-sheep-pen', 'gate', hinges)).toEqual({ axis: [0, 1, 0], angle: -1.7 })
    expect(hingeOf('ch1-barn', 'door_l', hinges)).toEqual({ axis: [0, 1, 0], angle: 0 })
    expect(hingeOf('ch1-sheep-pen', 'gate').angle).toBeCloseTo((-100 * Math.PI) / 180, 9)
    expect(hingeOf('ch1-watermill', 'secret_door')).toEqual({ axis: [0, 1, 0], angle: LANDMARK_OPEN.hinges['ch1-watermill'].secret_door.angle })
    expect(LANDMARK_OPEN.hinges['ch1-watermill'].secret_door.angle).toBeCloseTo(-Math.PI / 2, 9)
  })

  it('flips both cellar doors outwards round their own hinge, no further than the 120 degrees the model was checked for', () => {
    const left = hingeOf('ch1-cellar', 'door_l')
    const right = hingeOf('ch1-cellar', 'door_r')
    expect(left.axis).toEqual([1, 0, 0])
    expect(right.axis).toEqual([1, 0, 0])
    expect(left.angle).toBeGreaterThan(Math.PI / 2)
    expect(left.angle).toBeLessThanOrEqual((120 * Math.PI) / 180)
    expect(right.angle).toBeCloseTo(-left.angle, 9)
  })
})
