import * as THREE from 'three'
import { LANDMARKS } from '../data/landmarks'
import type { Theme } from '../data/levels/types'
import { Tile, tileAt, type Grid } from '../sim/grid'
import type { BuiltLevel } from '../sim/level'
import type { GameEvent } from '../sim/types'
import type { World } from '../sim/world'
import type { ModelId } from './asset-urls'
import { createBeltViews, type BeltViews } from './belt-views'
import { createBladeViews, type BladeLaneLook, type BladeViews } from './blade-views'
import type { Effects } from './effects'
import { buildFogView, type FogView } from './fog-view'
import { shareInstancedDepth } from './instanced-depth'
import { createLadders, type Ladders } from './ladder'
import { buildLandmarkViews, castsShadowAs, onePart, type LandmarkViews } from './landmark-views'
import { socketWorld, type ModelLibrary, type ModelPart } from './model-library'
import { CRATE_CENTER, crateTurn } from './prop-motion'
import { atlasPart, bakeNode, type NodePart } from './node-parts'
import { createRowView, rowInstancedMesh, sortRowItems, type RowItem } from './row-cull'
import {
  PROP_MODELS,
  SCENE_NODES,
  bridgeAt,
  cellHash,
  chunkOf,
  facingYaw,
  fallbackShadow,
  gateFacing,
  landmarkModel,
  linksOf,
  modelShadow,
  onePartProp,
  propModel,
  propScale,
  propYaw,
  proxyShape,
  railEnds,
  railFacings,
  variantModel,
  type BridgeCell,
  type PropKind,
} from './scene-models'
import { addShadowProxy, proxyGeometry, type PlacedProxy, type ProxyShape } from './shadow-proxies'
import { finish, type Steps } from './slices'
import { terrainLookup, terrainMaterial, terrainSteps, type GroundCell } from './terrain'
import { CRATE_TINT, GATE_LIFT, PALETTES, ROCK_FALLBACK_COLORS, SCENE_CHUNK, SCENE_TINT, TERRAIN, type Palette } from './themes'

interface Cell {
  column: number
  row: number
  tile: Tile
  theme: Theme
  palette: Palette
}

interface Spot {
  column: number
  row: number
  yaw: number
  scale: number
}

interface Batch<T> {
  items: T[]
  meshes: THREE.InstancedMesh[]
}

interface GatePart {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  castShadow: boolean
  local: THREE.Matrix4
}

interface GateLook {
  id: ModelId | null
  parts: GatePart[]
  up: number
  down: number
}

interface GateChunk {
  gates: GateView[]
  meshes: THREE.InstancedMesh[]
  raised: number
}

interface GateView {
  column: number
  row: number
  index: number
  yaw: number
  look: GateLook
  lift: number
  shown: boolean
  instance: number
  chunk: GateChunk | null
}

export interface LevelView {
  readonly group: THREE.Group
  update(world: World, dt: number, alpha?: number): void
  handle(event: GameEvent): void
  bladeLanes(): BladeLaneLook[]
  dispose(): void
}

interface TrackedSlot {
  index: number
  meshes: THREE.InstancedMesh[]
  instance: number
  matrix: THREE.Matrix4
  shown: boolean
}

type CrateState = 'gone' | 'whole' | 'cracked'

interface CrateChunk {
  whole: THREE.InstancedMesh[]
  cracked: THREE.InstancedMesh[]
  shown: Record<CrateState, number>
}

interface CrateSlot {
  column: number
  row: number
  index: number
  instance: number
  matrix: THREE.Matrix4
  hidden: THREE.Matrix4
  color: THREE.Color
  state: CrateState
  chunk: CrateChunk | null
}

type Placer<T> = (item: T, matrix: THREE.Matrix4, color: THREE.Color) => void

interface Placed {
  column: number
  row: number
}

interface SortedModels {
  kind: PropKind
  byModel: Map<ModelId, Spot[]>
  rest: Cell[]
}

const CRATE_COLOR = '#a8743f'
const CART_COLOR = '#9a6a3c'
const WHEEL_COLOR = '#5a3d24'
const FENCE_COLOR = '#c99d66'
const TRUNK_COLOR = '#7a5534'
const EXIT_COLOR = '#5ff0ff'
const CELLS_PER_STEP = 2048

export function createLevelView(level: BuiltLevel, models: ModelLibrary, effects: Effects | null = null): LevelView {
  return finish(buildLevelView(level, models, effects))
}

export function* buildLevelView(level: BuiltLevel, models: ModelLibrary, effects: Effects | null = null): Steps<LevelView> {
  const { grid } = level
  const group = new THREE.Group()
  const owned: { dispose(): void }[] = []
  const instanced: THREE.InstancedMesh[] = []
  let landmarkViews: LandmarkViews | null = null
  let ladderViews: Ladders | null = null
  let fogView: FogView | null = null
  let beltViews: BeltViews | null = null
  let bladeViews: BladeViews | null = null
  const release = () => {
    landmarkViews?.dispose()
    ladderViews?.dispose()
    fogView?.dispose()
    beltViews?.dispose()
    bladeViews?.dispose()
    for (const mesh of instanced) mesh.dispose()
    for (const resource of owned) resource.dispose()
    instanced.length = 0
    owned.length = 0
  }
  let built = false
  try {
    const has = (id: string) => models.has(id)
    const underWater = new Set(level.landmarks.flatMap((placement) => placement.water))
    const floors: Cell[] = []
    const walls: Cell[] = []
    const waters: Cell[] = []
    const bushes: Cell[] = []
    const trees: Cell[] = []
    const rocks: Cell[] = []
    const crates: Cell[] = []
    const carts: Cell[] = []
    const fences: Cell[] = []
    const gates: Cell[] = []
    const exits: Cell[] = []

    const dressedBush = new Set<number>()
    for (const placement of level.landmarks) {
      if (!LANDMARKS[placement.id].hides || !landmarkModel(has, placement.id, placement.variant)) continue
      for (const index of placement.cells) dressedBush.add(index)
    }

    const bridges: { cell: Cell; bridge: BridgeCell; id: ModelId }[] = []
    const spotsFor = (map: Map<ModelId, Spot[]>, id: ModelId) => {
      let list = map.get(id)
      if (!list) {
        list = []
        map.set(id, list)
      }
      return list
    }

    for (let row = 0; row < grid.rows; row++) {
      const theme = level.areas[level.areaOfRow[row]].theme
      const palette = PALETTES[theme]
      for (let column = 0; column < grid.columns; column++) {
        const tile = tileAt(grid, column, row)
        const cell = { column, row, tile, theme, palette }
        const wet = underWater.has(row * grid.columns + column)
        const bridge = !wet && has(propModel('bridge', theme)) ? bridgeAt(grid, column, row) : null
        const deckId = bridge ? variantModel(has, propModel('bridge', theme), PROP_MODELS.bridge.variants, column, row) : null
        if (tile === Tile.Wall) walls.push(cell)
        else if (tile === Tile.Water || wet) waters.push(cell)
        else if (bridge && deckId && models.has(deckId)) {
          waters.push(cell)
          bridges.push({ cell, bridge, id: deckId })
        } else floors.push(cell)
        if (tile === Tile.Bush && !dressedBush.has(row * grid.columns + column)) bushes.push(cell)
        else if (tile === Tile.Tree) trees.push(cell)
        else if (tile === Tile.Rock) rocks.push(cell)
        else if (tile === Tile.Crate) crates.push(cell)
        else if (tile === Tile.Cart) carts.push(cell)
        else if (tile === Tile.Fence) fences.push(cell)
        else if (tile === Tile.Gate || tile === Tile.GateClosed) gates.push(cell)
        else if (tile === Tile.Exit) exits.push(cell)
      }
    }
    yield

    const own = <T extends { dispose(): void }>(resource: T): T => {
      owned.push(resource)
      return resource
    }
    const instancedMesh = (geometry: THREE.BufferGeometry, material: THREE.Material, count: number) => {
      const mesh = new THREE.InstancedMesh(geometry, material, count)
      instanced.push(mesh)
      return mesh
    }
    const chunked = <T extends Placed>(items: readonly T[]): T[][] => [
      ...groupBy(items, (item) => chunkOf(item.column, item.row, grid.columns, SCENE_CHUNK.width, SCENE_CHUNK.depth)).values(),
    ]

    const position = new THREE.Vector3()
    const rotation = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)
    const compose = (matrix: THREE.Matrix4, x: number, y: number, z: number, turn: number, sx: number, sy: number, sz: number) =>
      matrix.compose(position.set(x, y, z), rotation.setFromAxisAngle(up, turn), scale.set(sx, sy, sz))

    const batches = function* <T extends Placed>(
      parts: readonly NodePart[],
      items: readonly T[],
      place: Placer<T>,
      shadows: boolean,
      tinted: boolean,
    ): Steps<Batch<T>[]> {
      if (items.length === 0 || parts.length === 0) return []
      const matrix = new THREE.Matrix4()
      const color = new THREE.Color()
      const made: Batch<T>[] = []
      for (const list of chunked(items)) {
        const meshes = parts.map((part) => {
          const mesh = instancedMesh(part.geometry, part.material, list.length)
          list.forEach((item, index) => {
            place(item, matrix, color)
            mesh.setMatrixAt(index, matrix)
            if (tinted) mesh.setColorAt(index, color)
          })
          mesh.computeBoundingSphere()
          mesh.castShadow = shadows
          mesh.receiveShadow = true
          group.add(mesh)
          return mesh
        })
        made.push({ items: list, meshes })
        yield
      }
      return made
    }
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, cells: Cell[], place: Placer<Cell>, shadows: boolean) =>
      batches([{ geometry, material }], cells, place, shadows, true)

    const sharedRoots = new Map<ModelId, THREE.Object3D>()
    const bakedNodes = new Map<string, NodePart[] | null>()
    const nodeParts = (id: ModelId, node: string): NodePart[] | null => {
      const key = `${id}#${node}`
      if (!bakedNodes.has(key)) {
        let root = sharedRoots.get(id)
        if (!root) {
          root = models.shared(id).root
          sharedRoots.set(id, root)
        }
        const parts = bakeNode(root, node)
        for (const part of parts ?? []) own(part.geometry)
        bakedNodes.set(key, parts)
      }
      return bakedNodes.get(key) ?? null
    }

    const placeSpot: Placer<Spot> = (spot, matrix, color) => {
      compose(matrix, spot.column + 0.5, 0, spot.row + 0.5, spot.yaw, spot.scale, spot.scale, spot.scale)
      color.setScalar(SCENE_TINT.base + SCENE_TINT.spread * cellHash(spot.column, spot.row, 3))
    }
    const addParts = (parts: readonly NodePart[], spots: Spot[], tinted: boolean, shadows: boolean): Steps<Batch<Spot>[]> =>
      batches(parts, spots, placeSpot, shadows, tinted)

    const rows = createRowView(grid.rows)
    const addRowParts = (parts: readonly NodePart[], spots: readonly Spot[], tinted: boolean, shadows: boolean) => {
      if (spots.length === 0 || parts.length === 0) return
      const color = new THREE.Color()
      const items: RowItem[] = sortRowItems(spots).map((spot) => {
        const matrix = new THREE.Matrix4()
        placeSpot(spot, matrix, color)
        return { column: spot.column, row: spot.row, matrix, color: tinted ? color.clone() : null }
      })
      for (const part of parts) {
        const mesh = rowInstancedMesh(part.geometry, part.material, items, rows, grid.rows)
        instanced.push(mesh)
        mesh.castShadow = shadows
        mesh.receiveShadow = true
        group.add(mesh)
      }
    }

    const proxies = new Map<number, PlacedProxy[]>()
    const proxyShapes = new Map<ModelId, THREE.BufferGeometry | null>()
    const proxyOf = (id: ModelId, shape: ProxyShape): THREE.BufferGeometry | null => {
      if (!proxyShapes.has(id)) {
        const geometry = proxyGeometry(
          models.parts(id).map((part) => part.geometry),
          shape,
        )
        if (geometry) own(geometry)
        proxyShapes.set(id, geometry)
      }
      return proxyShapes.get(id) ?? null
    }
    const addProxies = (id: ModelId, shape: ProxyShape, spots: readonly Spot[]) => {
      const geometry = proxyOf(id, shape)
      if (!geometry) return
      const tint = new THREE.Color()
      for (const spot of spots) {
        const key = chunkOf(spot.column, spot.row, grid.columns, SCENE_CHUNK.width, SCENE_CHUNK.depth)
        const matrix = new THREE.Matrix4()
        placeSpot(spot, matrix, tint)
        const list = proxies.get(key)
        if (list) list.push({ geometry, matrix })
        else proxies.set(key, [{ geometry, matrix }])
      }
    }

    const cartYaw = (cell: Cell) => propYaw('cart', cell.column, cell.row)
    const spotOf = (kind: PropKind, cell: Placed, yaw = propYaw(kind, cell.column, cell.row)): Spot => ({
      column: cell.column,
      row: cell.row,
      yaw,
      scale: propScale(kind, cell.column, cell.row),
    })
    const sortByModel = (kind: PropKind, cells: Cell[]): SortedModels => {
      const byModel = new Map<ModelId, Spot[]>()
      const rest: Cell[] = []
      for (const cell of cells) {
        const id = variantModel(has, propModel(kind, cell.theme), PROP_MODELS[kind].variants, cell.column, cell.row)
        if (id && models.has(id)) spotsFor(byModel, id).push(spotOf(kind, cell))
        else rest.push(cell)
      }
      return { kind, byModel, rest }
    }
    const singles = new Map<string, readonly NodePart[]>()
    const single = (key: string, id: ModelId, parts: readonly NodePart[]): readonly NodePart[] => {
      if (!onePartProp(id)) return parts
      let found = singles.get(key)
      if (!found) {
        const merged = onePart(parts, true)
        if (merged) {
          own(merged.geometry)
          if (merged.copied) own(merged.material)
        }
        found = merged ? [merged] : parts
        singles.set(key, found)
      }
      return found
    }
    const propParts = (id: ModelId): readonly NodePart[] => single(id, id, models.parts(id))
    const atlases = new Map<ModelId, readonly NodePart[]>()
    const wallParts = (id: ModelId): readonly NodePart[] => {
      const parts = propParts(id)
      if (parts.length < 2) return parts
      let found = atlases.get(id)
      if (!found) {
        const atlas = atlasPart(parts)
        if (atlas) owned.push(atlas.geometry, atlas.material, atlas.lookup)
        found = atlas ? [atlas] : parts
        atlases.set(id, found)
      }
      return found
    }
    const placeParts = function* (kind: PropKind, parts: readonly NodePart[], spots: Spot[]): Steps<Batch<Spot>[]> {
      if (modelShadow(kind)) return yield* addParts(parts, spots, PROP_MODELS[kind].tint, true)
      addRowParts(parts, spots, PROP_MODELS[kind].tint, false)
      return []
    }
    const addModels = function* ({ kind, byModel }: SortedModels): Steps<Batch<Spot>[]> {
      const all: Batch<Spot>[] = []
      const shape = proxyShape(kind)
      for (const [id, spots] of byModel) {
        all.push(...(yield* placeParts(kind, kind === 'wall' ? wallParts(id) : propParts(id), spots)))
        if (shape) addProxies(id, shape, spots)
        yield
      }
      return all
    }

    const wallModels = sortByModel('wall', walls)
    for (const spots of wallModels.byModel.values()) {
      for (const spot of spots) floors.push({ column: spot.column, row: spot.row, tile: Tile.Floor, ...themeAt(level, spot.row) })
    }

    const shades = new Map<string, THREE.Color>()
    const shade = (style: string) => {
      let found = shades.get(style)
      if (!found) {
        found = new THREE.Color(style)
        shades.set(style, found)
      }
      return found
    }
    const island = new THREE.Color(TERRAIN.island.color)
    const ground: GroundCell[] = Array.from({ length: grid.columns * grid.rows }, () => ({ kind: 'open', color: island }))
    for (const [index, cell] of floors.entries()) {
      const style = cell.tile === Tile.Path || cell.tile === Tile.Exit ? cell.palette.path : (cell.column + cell.row) % 2 === 0 ? cell.palette.floorA : cell.palette.floorB
      const color = shade(style).clone().offsetHSL(0, 0, (hash(cell.column, cell.row) - 0.5) * 0.03)
      ground[cell.row * grid.columns + cell.column] = { kind: 'floor', color }
      if (index % CELLS_PER_STEP === CELLS_PER_STEP - 1) yield
    }
    for (const cell of waters) ground[cell.row * grid.columns + cell.column] = { kind: 'water', color: shade(cell.palette.water) }
    yield
    const terrain = yield* terrainSteps(ground, grid.columns, grid.rows, island)
    const land = new THREE.Mesh(own(terrain.geometry), own(terrainMaterial(own(terrainLookup()))))
    land.receiveShadow = true
    land.frustumCulled = false
    rows.cover(TERRAIN.island.bottom, TERRAIN.floor.top)
    land.onBeforeRender = (renderer, _scene, camera) => {
      rows.update(renderer, camera)
      const { first, last } = rows.span
      const from = first <= last ? terrain.starts[first] : 0
      terrain.geometry.setDrawRange(from, first <= last ? terrain.starts[last + 1] - from : 0)
    }
    group.add(land)
    yield

    yield* addModels(wallModels)
    yield* add(own(new THREE.BoxGeometry(1, 1.1, 1)), own(new THREE.MeshStandardMaterial()), wallModels.rest, (cell, matrix, color) => {
      matrix.makeTranslation(cell.column + 0.5, 0.55, cell.row + 0.5)
      color.set(cell.palette.wall).offsetHSL(0, 0, (hash(cell.column, cell.row) - 0.5) * 0.08)
    }, fallbackShadow('wall'))

    const decks = new Map<number, BridgeCell['facing']>()
    for (const { cell, bridge } of bridges) decks.set(cell.row * grid.columns + cell.column, bridge.facing)
    for (const [id, list] of groupBy(bridges, (item) => item.id)) {
      const deck = nodeParts(id, SCENE_NODES.bridgeDeck) ?? models.parts(id)
      yield* placeParts(
        'bridge',
        deck,
        list.map(({ cell, bridge }) => spotOf('bridge', cell, facingYaw(bridge.facing))),
      )
      const rail = nodeParts(id, SCENE_NODES.bridgeRail)
      if (rail) {
        yield* placeParts(
          'bridge',
          rail,
          list.flatMap(({ cell, bridge }) => bridge.rails.map((facing) => spotOf('bridge', cell, facingYaw(facing)))),
        )
      }
      const railEnd = rail ? nodeParts(id, SCENE_NODES.bridgeRailEnd) : null
      if (railEnd) {
        const isDeck = (facing: BridgeCell['facing']) => (column: number, row: number) =>
          column >= 0 && column < grid.columns && decks.get(row * grid.columns + column) === facing
        yield* placeParts(
          'bridge',
          railEnd,
          list.flatMap(({ cell, bridge }) =>
            railEnds(bridge, cell.column, cell.row, isDeck(bridge.facing)).map((facing) => spotOf('bridge', cell, facingYaw(facing))),
          ),
        )
      }
    }

    const bushModels = sortByModel('bush', bushes)
    yield* addModels(bushModels)
    yield* add(own(new THREE.IcosahedronGeometry(0.55, 0)), own(new THREE.MeshStandardMaterial({ flatShading: true })), bushModels.rest, (cell, matrix, color) => {
      const jitter = hash(cell.row, cell.column)
      compose(matrix, cell.column + 0.5, 0.32, cell.row + 0.5, jitter * Math.PI, 1, 0.75 + jitter * 0.15, 1)
      color.set(cell.palette.bush).offsetHSL(0, 0, (jitter - 0.5) * 0.08)
    }, fallbackShadow('bush'))

    const treeModels = sortByModel('tree', trees)
    yield* addModels(treeModels)
    yield* add(own(new THREE.CylinderGeometry(0.12, 0.17, 0.8, 6)), own(new THREE.MeshStandardMaterial()), treeModels.rest, (cell, matrix, color) => {
      compose(matrix, cell.column + 0.5, 0.4, cell.row + 0.5, 0, 1, 1, 1)
      color.set(TRUNK_COLOR)
    }, fallbackShadow('tree'))

    yield* add(
      own(new THREE.IcosahedronGeometry(0.62, 0)),
      own(new THREE.MeshStandardMaterial({ flatShading: true })),
      treeModels.rest,
      (cell, matrix, color) => {
        const jitter = hash(cell.column, cell.row)
        const size = 0.85 + jitter * 0.35
        compose(matrix, cell.column + 0.5, 1.05 + jitter * 0.2, cell.row + 0.5, jitter * 6, size, size * 1.1, size)
        color.set(cell.palette.canopy).offsetHSL(0, 0, (jitter - 0.5) * 0.1)
      },
      fallbackShadow('tree'),
    )

    const rockSlots: TrackedSlot[] = []
    const track = (batch: Batch<Placed>) =>
      batch.items.forEach((item, instance) => {
        const matrix = new THREE.Matrix4()
        batch.meshes[0]?.getMatrixAt(instance, matrix)
        rockSlots.push({ index: item.row * grid.columns + item.column, meshes: batch.meshes, instance, matrix, shown: true })
      })
    const rockModels = sortByModel('rock', rocks)
    for (const batch of yield* addModels(rockModels)) track(batch)
    const rockFallback = yield* add(
      own(new THREE.DodecahedronGeometry(0.48, 0)),
      own(new THREE.MeshStandardMaterial({ flatShading: true })),
      rockModels.rest,
      (cell, matrix, color) => {
        const jitter = hash(cell.column + 7, cell.row)
        const size = 0.85 + jitter * 0.25
        compose(matrix, cell.column + 0.5, 0.3, cell.row + 0.5, jitter * 6, size, size * 0.75, size)
        color.set(ROCK_FALLBACK_COLORS[propModel('rock', cell.theme)] ?? ROCK_FALLBACK_COLORS['ch1-rock']).offsetHSL(0, 0, (jitter - 0.5) * 0.1)
      },
      fallbackShadow('rock'),
    )
    for (const batch of rockFallback) track(batch)

    const crateModel = models.has('crate')
    const wholeParts: readonly ModelPart[] = crateModel
      ? models.parts('crate')
      : [{ geometry: own(new THREE.BoxGeometry(0.86, 0.86, 0.86)), material: own(new THREE.MeshStandardMaterial()) }]
    const crackedParts: readonly ModelPart[] = crateModel && models.has('crate-broken') ? models.parts('crate-broken') : []
    const crateSlots: CrateSlot[] = crates.map((cell) => {
      const matrix = crateModel
        ? compose(new THREE.Matrix4(), cell.column + 0.5, 0, cell.row + 0.5, crateTurn(cell.column, cell.row), 1, 1, 1)
        : compose(new THREE.Matrix4(), cell.column + 0.5, CRATE_CENTER, cell.row + 0.5, (hash(cell.column, cell.row + 3) - 0.5) * 0.4, 1, 1, 1)
      const hidden = matrix.clone().scale(new THREE.Vector3(0, 0, 0))
      const color = new THREE.Color()
      const jitter = hash(cell.column, cell.row + 3)
      if (!crateModel) color.set(CRATE_COLOR).offsetHSL(0, 0, (jitter - 0.5) * 0.08)
      else {
        const shade = CRATE_TINT.base + CRATE_TINT.spread * jitter
        const warm = hash(cell.column + 5, cell.row) * CRATE_TINT.warmth
        color.setRGB(shade, shade * (1 - warm * 0.5), shade * (1 - warm))
      }
      const index = cell.row * grid.columns + cell.column
      return { column: cell.column, row: cell.row, index, instance: 0, matrix, hidden, color, state: 'whole', chunk: null }
    })
    const crateSet = (parts: readonly ModelPart[], slots: CrateSlot[], shown: boolean) =>
      parts.map((part) => {
        const mesh = instancedMesh(part.geometry, part.material, slots.length)
        slots.forEach((slot) => {
          mesh.setMatrixAt(slot.instance, slot.matrix)
          mesh.setColorAt(slot.instance, slot.color)
        })
        mesh.computeBoundingSphere()
        if (!shown) for (const slot of slots) mesh.setMatrixAt(slot.instance, slot.hidden)
        mesh.visible = shown
        mesh.castShadow = castsShadowAs(part.material)
        mesh.receiveShadow = true
        group.add(mesh)
        return mesh
      })
    for (const slots of chunked(crateSlots)) {
      slots.forEach((slot, instance) => (slot.instance = instance))
      const chunk: CrateChunk = {
        whole: crateSet(wholeParts, slots, true),
        cracked: crateSet(crackedParts, slots, false),
        shown: { gone: 0, whole: slots.length, cracked: 0 },
      }
      for (const slot of slots) slot.chunk = chunk
    }
    yield

    const cartModels = sortByModel('cart', carts)
    yield* addModels(cartModels)
    yield* add(own(new THREE.BoxGeometry(0.92, 0.34, 0.66)), own(new THREE.MeshStandardMaterial()), cartModels.rest, (cell, matrix, color) => {
      compose(matrix, cell.column + 0.5, 0.5, cell.row + 0.5, cartYaw(cell), 1, 1, 1)
      color.set(CART_COLOR).offsetHSL(0, 0, (hash(cell.column, cell.row + 9) - 0.5) * 0.08)
    }, fallbackShadow('cart'))
    yield* add(
      own(new THREE.CylinderGeometry(0.24, 0.24, 0.8, 10).rotateX(Math.PI / 2)),
      own(new THREE.MeshStandardMaterial()),
      cartModels.rest,
      (cell, matrix, color) => {
        compose(matrix, cell.column + 0.5, 0.24, cell.row + 0.5, cartYaw(cell) + Math.PI / 2, 1, 1, 1)
        color.set(WHEEL_COLOR)
      },
      fallbackShadow('cart'),
    )

    const fencePosts = new Map<ModelId, Spot[]>()
    const fenceRails = new Map<ModelId, Spot[]>()
    const fenceRest: Cell[] = []
    for (const cell of fences) {
      const id = variantModel(has, propModel('fence', cell.theme), PROP_MODELS.fence.variants, cell.column, cell.row)
      if (!id || !models.has(id) || !nodeParts(id, SCENE_NODES.fencePost) || !nodeParts(id, SCENE_NODES.fenceRail)) {
        fenceRest.push(cell)
        continue
      }
      spotsFor(fencePosts, id).push(spotOf('fence', cell))
      for (const facing of railFacings(linksOf(grid, cell.column, cell.row, isFenceTile))) {
        spotsFor(fenceRails, id).push(spotOf('fence', cell, facingYaw(facing)))
      }
    }
    const fenceParts = (id: ModelId, node: string) => single(`${id}#${node}`, id, nodeParts(id, node) ?? [])
    for (const [id, spots] of fencePosts) yield* placeParts('fence', fenceParts(id, SCENE_NODES.fencePost), spots)
    for (const [id, spots] of fenceRails) yield* placeParts('fence', fenceParts(id, SCENE_NODES.fenceRail), spots)
    yield* add(own(new THREE.BoxGeometry(1, 0.55, 0.16)), own(new THREE.MeshStandardMaterial()), fenceRest, (cell, matrix, color) => {
      const horizontal = isFence(grid, cell.column - 1, cell.row) || isFence(grid, cell.column + 1, cell.row)
      compose(matrix, cell.column + 0.5, 0.28, cell.row + 0.5, horizontal ? 0 : Math.PI / 2, 1, 1, 1)
      color.set(FENCE_COLOR)
    }, fallbackShadow('fence'))

    if (proxies.size > 0) {
      const proxyMaterial = own(new THREE.MeshBasicMaterial())
      for (const items of proxies.values()) {
        const geometry = addShadowProxy(group, items, proxyMaterial)
        if (geometry) own(geometry)
        yield
      }
    }

    const hidden = new THREE.Matrix4().makeScale(0, 0, 0)
    const syncRocks = (world: World) => {
      const touched = new Set<THREE.InstancedMesh>()
      for (const slot of rockSlots) {
        const present = world.grid.tiles[slot.index] === Tile.Rock
        if (present === slot.shown) continue
        slot.shown = present
        for (const mesh of slot.meshes) {
          mesh.setMatrixAt(slot.instance, present ? slot.matrix : hidden)
          touched.add(mesh)
        }
      }
      for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true
    }
    const syncCrates = (world: World) => {
      const touched = new Set<CrateChunk>()
      for (const slot of crateSlots) {
        const { chunk } = slot
        if (!chunk) continue
        const state: CrateState =
          world.grid.tiles[slot.index] !== Tile.Crate ? 'gone' : chunk.cracked.length > 0 && world.crates.has(slot.index) ? 'cracked' : 'whole'
        if (state === slot.state) continue
        chunk.shown[slot.state] -= 1
        chunk.shown[state] += 1
        slot.state = state
        for (const mesh of chunk.whole) mesh.setMatrixAt(slot.instance, state === 'whole' ? slot.matrix : slot.hidden)
        for (const mesh of chunk.cracked) mesh.setMatrixAt(slot.instance, state === 'cracked' ? slot.matrix : slot.hidden)
        touched.add(chunk)
      }
      for (const chunk of touched) {
        for (const mesh of chunk.whole) {
          mesh.instanceMatrix.needsUpdate = true
          mesh.visible = chunk.shown.whole > 0
        }
        for (const mesh of chunk.cracked) {
          mesh.instanceMatrix.needsUpdate = true
          mesh.visible = chunk.shown.cracked > 0
        }
      }
    }

    const belts = (beltViews = createBeltViews(level, models))
    group.add(belts.group)
    const blades = (bladeViews = createBladeViews(level, models, effects))
    if (blades.count > 0) group.add(blades.group)
    yield

    const gateGeometry = own(new THREE.BoxGeometry(1, 1.25, 0.3))
    const gateMaterial = own(
      new THREE.MeshStandardMaterial({ color: '#3b3f47', emissive: GATE_LIFT.glow.color, emissiveIntensity: GATE_LIFT.glow.intensity }),
    )
    const glowGeometry = own(new THREE.BoxGeometry(0.98, GATE_LIFT.glow.height, GATE_LIFT.glow.depth))
    const glowMaterial = own(
      new THREE.MeshStandardMaterial({ color: '#2a2d33', emissive: GATE_LIFT.glow.color, emissiveIntensity: GATE_LIFT.glow.intensity * 1.6 }),
    )
    const quarterTurn = new THREE.Matrix4().makeRotationY(Math.PI / 2)
    const gateLooks = new Map<ModelId | null, GateLook>()
    const gateLook = (id: ModelId | null): GateLook => {
      let look = gateLooks.get(id)
      if (look) return look
      if (id) {
        const model = models.shared(id)
        const casts = new Map<THREE.Material, boolean>()
        model.root.traverse((object) => {
          const mesh = object as THREE.Mesh
          if (mesh.isMesh && !Array.isArray(mesh.material)) casts.set(mesh.material, (casts.get(mesh.material) ?? false) || mesh.castShadow)
        })
        const glowAt = new THREE.Vector3(0, GATE_LIFT.glow.top, 0)
        const socket = model.nodes.get(SCENE_NODES.gateGlow)
        if (socket) model.root.worldToLocal(socketWorld(socket, glowAt))
        const glowLocal = new THREE.Matrix4().makeTranslation(glowAt.x, glowAt.y, glowAt.z).multiply(quarterTurn)
        look = {
          id,
          parts: [
            ...models.parts(id).map((part) => ({ ...part, castShadow: casts.get(part.material) ?? true, local: new THREE.Matrix4() })),
            { geometry: glowGeometry, material: glowMaterial, castShadow: false, local: glowLocal },
          ],
          ...GATE_LIFT.model,
        }
      } else {
        look = { id, parts: [{ geometry: gateGeometry, material: gateMaterial, castShadow: true, local: quarterTurn }], ...GATE_LIFT.box }
      }
      gateLooks.set(id, look)
      return look
    }
    const gateViews: GateView[] = gates.map((cell) => {
      const id = variantModel(has, propModel('gate', cell.theme), PROP_MODELS.gate.variants, cell.column, cell.row)
      const look = gateLook(id && models.has(id) ? id : null)
      return {
        column: cell.column,
        row: cell.row,
        index: cell.row * grid.columns + cell.column,
        yaw: facingYaw(gateFacing(grid, cell.column, cell.row)),
        look,
        lift: look.down,
        shown: false,
        instance: 0,
        chunk: null,
      }
    })
    const gateMatrix = new THREE.Matrix4()
    const partMatrix = new THREE.Matrix4()
    const partSphere = new THREE.Sphere()
    const white = new THREE.Color(1, 1, 1)
    const placeGate = (gate: GateView, chunk: GateChunk, lift: number) => {
      compose(gateMatrix, gate.column + 0.5, lift, gate.row + 0.5, gate.yaw, 1, 1, 1)
      gate.look.parts.forEach((part, k) => chunk.meshes[k].setMatrixAt(gate.instance, partMatrix.multiplyMatrices(gateMatrix, part.local)))
    }
    const fitRaised = (chunk: GateChunk) => {
      for (const mesh of chunk.meshes) {
        if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere()
        const sphere = (mesh.boundingSphere ??= new THREE.Sphere()).makeEmpty()
        for (const gate of chunk.gates) {
          if (!gate.shown || !mesh.geometry.boundingSphere) continue
          mesh.getMatrixAt(gate.instance, partMatrix)
          sphere.union(partSphere.copy(mesh.geometry.boundingSphere).applyMatrix4(partMatrix))
        }
      }
    }
    for (const list of groupBy(gateViews, (gate) => gate.look).values()) {
      for (const members of chunked(list)) {
        const { look } = members[0]
        const chunk: GateChunk = {
          gates: members,
          meshes: look.parts.map((part) => {
            const mesh = instancedMesh(part.geometry, part.material, members.length)
            mesh.castShadow = part.castShadow
            mesh.receiveShadow = false
            mesh.visible = false
            if (look.id) mesh.userData.model = look.id
            group.add(mesh)
            return mesh
          }),
          raised: 0,
        }
        members.forEach((gate, instance) => {
          gate.instance = instance
          gate.chunk = chunk
          for (const mesh of chunk.meshes) {
            mesh.setMatrixAt(instance, hidden)
            mesh.setColorAt(instance, white)
          }
        })
        fitRaised(chunk)
      }
    }
    const syncGates = (world: World, blend: number) => {
      const touched = new Set<GateChunk>()
      for (const gate of gateViews) {
        const { chunk, look } = gate
        const target = world.grid.tiles[gate.index] === Tile.GateClosed ? look.up : look.down
        if (!chunk || gate.lift === target) continue
        gate.lift += (target - gate.lift) * blend
        if (Math.abs(target - gate.lift) < GATE_LIFT.settle) gate.lift = target
        const shown = gate.lift > look.down + 0.05
        if (shown !== gate.shown) chunk.raised += shown ? 1 : -1
        gate.shown = shown
        if (shown) placeGate(gate, chunk, gate.lift)
        else for (const mesh of chunk.meshes) mesh.setMatrixAt(gate.instance, hidden)
        touched.add(chunk)
      }
      for (const chunk of touched) {
        fitRaised(chunk)
        for (const mesh of chunk.meshes) {
          mesh.instanceMatrix.needsUpdate = true
          mesh.visible = chunk.raised > 0
        }
      }
    }

    const exitMaterial = own(new THREE.MeshStandardMaterial({ color: EXIT_COLOR, emissive: EXIT_COLOR, emissiveIntensity: 0.9 }))
    const padGeometry = own(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 20))
    for (const cell of exits) {
      const pad = new THREE.Mesh(padGeometry, exitMaterial)
      pad.position.set(cell.column + 0.5, 0.03, cell.row + 0.5)
      group.add(pad)
    }
    const beamMaterial = own(
      new THREE.MeshBasicMaterial({
        color: EXIT_COLOR,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    if (exits.length > 0) {
      const centerX = exits.reduce((sum, cell) => sum + cell.column + 0.5, 0) / exits.length
      const centerZ = exits.reduce((sum, cell) => sum + cell.row + 0.5, 0) / exits.length
      const beam = new THREE.Mesh(own(new THREE.CylinderGeometry(exits.length * 0.35, exits.length * 0.35, 8, 24, 1, true)), beamMaterial)
      beam.position.set(centerX, 4, centerZ)
      group.add(beam)
    }
    yield

    const landmarks = (landmarkViews = yield* buildLandmarkViews(level, models, effects))
    group.add(landmarks.group)
    const ladders = (ladderViews = createLadders(level, models))
    if (ladders.count > 0) group.add(ladders.group)
    yield
    const fog = (fogView = yield* buildFogView(level))
    if (fog.active) group.add(fog.group)

    shareInstancedDepth(instanced)
    let clock = 0
    built = true
    return {
      group,
      update(world, dt, alpha = 1) {
        clock += dt
        syncGates(world, 1 - Math.exp(-12 * dt))
        beamMaterial.opacity = 0.2 + Math.sin(clock * 3) * 0.08
        syncCrates(world)
        syncRocks(world)
        landmarks.update(world, dt)
        fog.update(world, dt)
        belts.update(world, dt)
        blades.sync(world, alpha, dt)
      },
      handle(event) {
        blades.handle(event)
      },
      bladeLanes: () => blades.lanes(),
      dispose: release,
    }
  } finally {
    if (!built) release()
  }
}

function themeAt(level: BuiltLevel, row: number): { theme: Theme; palette: Palette } {
  const theme = level.areas[level.areaOfRow[row]].theme
  return { theme, palette: PALETTES[theme] }
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>()
  for (const item of items) {
    const value = key(item)
    const list = groups.get(value)
    if (list) list.push(item)
    else groups.set(value, [item])
  }
  return groups
}

function isFenceTile(tile: Tile): boolean {
  return tile === Tile.Fence
}

function isFence(grid: Grid, column: number, row: number): boolean {
  return tileAt(grid, column, row) === Tile.Fence
}

function hash(column: number, row: number): number {
  const value = Math.sin(column * 127.1 + row * 311.7) * 43758.5453
  return value - Math.floor(value)
}
