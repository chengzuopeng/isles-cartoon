import * as THREE from 'three'
import { LANDMARKS, type LandmarkMotion } from '../data/landmarks'
import type { CoverDef, Theme, WallStyle } from '../data/levels/types'
import { Tile, cellFloor, cellTop, tileAt, type Grid } from '../sim/grid'
import type { BuiltLevel } from '../sim/level'
import type { GameEvent } from '../sim/types'
import type { World } from '../sim/world'
import type { ModelId } from './asset-urls'
import { lineTexture, type LineTextureKind } from './line-textures'
import type { ModelLibrary } from './model-library'
import { buildBuilding } from './buildings'
import { buildCover } from './cover-props'
import { barnPartAt, buildLevelStructures } from './level-buildings'
import { buildLevelPlatforms, framedPlatformCells } from './level-platforms'
import { buildTerrain, createTerrainMaterials, platformSurfaceOf, surfaceHeight, terrainChunks } from './fps-terrain'
import { STALK_STYLES, createStalkMaterial, stalkGeometry, stalkMatrices } from './stalks'
import { createStoryActors } from './story-actors'
import { flowerBatches, flowerHeadGeometry, flowerStemGeometry, hedgeTopBatches, hedgeTopGeometry, pebbleBatches, pebbleGeometry, spikeBatches, spikeGeometry, type DetailBatch, type WallEdge } from './ground-details'
import { hiddenTops, treeDepths, treeLook } from './level-cover'
import { bakeNode, type NodePart } from './node-parts'
import {
  BACKDROP_THEMES,
  PROP_MODELS,
  bridgeAt,
  cellHash,
  facingYaw,
  footprintCenter,
  gateFacing,
  landmarkModel,
  landmarkYaw,
  linksOf,
  motionAngle,
  motionAxis,
  propModel,
  propScale,
  propYaw,
  variantModel,
  type PropKind,
} from './scene-models'
import { CRATE_STACK, crateLayers } from './prop-motion'
import { KEG_LOOK, buildKeg } from './keg-model'
import { PALETTES } from './themes'
import { toToon, toonMaterial, toonify } from './toon'

export interface FpsLevelView {
  readonly group: THREE.Group
  heightAt(x: number, z: number): number
  update(world: World, dt: number, eye?: THREE.Vector3Like): void
  handle(event: GameEvent): void
  dispose(): void
}

export const VISUAL_HEIGHTS = {
  wall: 3,
  wallSink: 0.4,
  fence: 0.9,
  gate: 3,
  boulder: 2.5,
} as const

const BOULDER_WIDTH = 1.3

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)
const ASH = { radius: 0.62, color: '#3b3330' } as const

export const LEVEL_CULL = {
  chunkRows: 20,
  drawDistance: 90,
} as const

const PROP_FIT: Readonly<Partial<Record<PropKind, number>>> = {
  rock: 1.2 / 0.75,
  bush: 1.0 / 0.75,
  tree: 3.4,
  cart: 1.45,
}

const WALL_TEXTURES: Readonly<Record<Theme, LineTextureKind>> = {
  farm: 'wood',
  village: 'wood',
  arena: 'wood',
  meadow: 'stone',
  forest: 'rock',
  outpost: 'metal',
  factory: 'metal',
}

export type WallLook = Theme | WallStyle

const WALL_STYLES: Readonly<Record<WallStyle, { color: string; texture: LineTextureKind }>> = {
  hedge: { color: '#5a9440', texture: 'grass' },
  bales: { color: '#d4ab68', texture: 'bales' },
  timber: { color: '#a47956', texture: 'wood' },
}

const TILE_PROPS: Readonly<Partial<Record<Tile, PropKind>>> = {
  [Tile.Rock]: 'rock',
  [Tile.Boulder]: 'rock',
  [Tile.Bush]: 'bush',
  [Tile.Tree]: 'tree',
  [Tile.Cart]: 'cart',
}

interface Batch {
  name: string
  band: number
  parts: readonly NodePart[]
  matrices: THREE.Matrix4[]
  shadow: boolean
  ink: boolean
}

interface GateView {
  index: number
  root: THREE.Object3D
  base: number
  lift: number
}

interface CrateView {
  index: number
  root: THREE.Object3D
}

interface KegView {
  index: number
  row: number
  root: THREE.Object3D
  body: THREE.MeshToonMaterial
  spark: THREE.Object3D
  yaw: number
}

interface HayView {
  index: number
  key: string
  at: number
  x: number
  y: number
  z: number
  gone: boolean
}

interface Motion {
  node: THREE.Object3D
  rest: THREE.Quaternion
  axis: THREE.Vector3
  motion: LandmarkMotion
}

export function isBorder(grid: Grid, column: number, row: number): boolean {
  return column === 0 || row === 0 || column === grid.columns - 1 || row === grid.rows - 1
}

export function innerNeighbor(grid: Grid, column: number, row: number): { column: number; row: number } | null {
  if (column === 0) return { column: 1, row }
  if (column === grid.columns - 1) return { column: grid.columns - 2, row }
  if (row === 0) return { column, row: 1 }
  if (row === grid.rows - 1) return { column, row: grid.rows - 2 }
  return null
}

function themeOf(level: BuiltLevel, row: number): Theme {
  return level.areas[level.areaOfRow[row]]?.theme ?? 'farm'
}

function wallStyleOf(level: BuiltLevel, row: number): WallStyle | null {
  return level.areas[level.areaOfRow[row]]?.walls ?? null
}

function wallLookOf(level: BuiltLevel, row: number): WallLook {
  return wallStyleOf(level, row) ?? themeOf(level, row)
}

class GeometryBuilder {
  readonly positions: number[] = []
  readonly normals: number[] = []
  readonly colors: number[] = []
  readonly uvs: number[] = []

  quad(a: THREE.Vector3Like, b: THREE.Vector3Like, c: THREE.Vector3Like, d: THREE.Vector3Like, normal: THREE.Vector3Like, color: THREE.Color, uv: readonly number[] = [0, 0, 1, 0, 1, 1, 0, 1]): void {
    const corners = [a, b, c, a, c, d]
    const order = [0, 1, 2, 0, 2, 3]
    corners.forEach((corner, index) => {
      this.positions.push(corner.x, corner.y, corner.z)
      this.normals.push(normal.x, normal.y, normal.z)
      this.colors.push(color.r, color.g, color.b)
      this.uvs.push(uv[order[index] * 2], uv[order[index] * 2 + 1])
    })
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2))
    geometry.computeBoundingSphere()
    return geometry
  }
}

const SIDES: readonly { dc: number; dr: number; normal: THREE.Vector3 }[] = [
  { dc: 0, dr: -1, normal: new THREE.Vector3(0, 0, -1) },
  { dc: 1, dr: 0, normal: new THREE.Vector3(1, 0, 0) },
  { dc: 0, dr: 1, normal: new THREE.Vector3(0, 0, 1) },
  { dc: -1, dr: 0, normal: new THREE.Vector3(-1, 0, 0) },
]

function edgeCorners(column: number, row: number, side: (typeof SIDES)[number]): [number, number, number, number] {
  if (side.dr === -1) return [column + 1, row, column, row]
  if (side.dc === 1) return [column + 1, row + 1, column + 1, row]
  if (side.dr === 1) return [column, row + 1, column + 1, row + 1]
  return [column, row, column, row + 1]
}

export function buildWalls(level: BuiltLevel, fromRow = 0, toRow = level.grid.rows): Map<WallLook, THREE.BufferGeometry> {
  const { grid } = level
  const builders = new Map<WallLook, GeometryBuilder>()
  const white = new THREE.Color('#ffffff')
  const solid = (column: number, row: number) => column >= 0 && row >= 0 && column < grid.columns && row < grid.rows && tileAt(grid, column, row) === Tile.Wall && !isBorder(grid, column, row)
  for (let row = fromRow; row < Math.min(toRow, grid.rows); row++) {
    for (let column = 0; column < grid.columns; column++) {
      if (!solid(column, row) || barnPartAt(level, column, row) === 'wall') continue
      const look = wallLookOf(level, row)
      let builder = builders.get(look)
      if (!builder) {
        builder = new GeometryBuilder()
        builders.set(look, builder)
      }
      const base = cellFloor(grid, column, row)
      const top = base + VISUAL_HEIGHTS.wall
      builder.quad({ x: column, y: top, z: row }, { x: column, y: top, z: row + 1 }, { x: column + 1, y: top, z: row + 1 }, { x: column + 1, y: top, z: row }, { x: 0, y: 1, z: 0 }, white, [column, row, column, row + 1, column + 1, row + 1, column + 1, row])
      for (const side of SIDES) {
        const nc = column + side.dc
        const nr = row + side.dr
        if (solid(nc, nr) && Math.abs(cellFloor(grid, nc, nr) - base) < 0.01) continue
        const floor = Math.min(base, surfaceHeight(grid, nc, nr)) - VISUAL_HEIGHTS.wallSink
        const [x1, z1, x2, z2] = edgeCorners(column, row, side)
        const along = side.dc === 0 ? x1 : z1
        const along2 = side.dc === 0 ? x2 : z2
        const uv = look === 'bales'
          ? [along / 4, 1, along / 4, 0, along2 / 4, 0, along2 / 4, 1]
          : [along, top, along, floor, along2, floor, along2, top]
        builder.quad({ x: x1, y: top, z: z1 }, { x: x1, y: floor, z: z1 }, { x: x2, y: floor, z: z2 }, { x: x2, y: top, z: z2 }, side.normal, white, uv)
      }
    }
  }
  const result = new Map<WallLook, THREE.BufferGeometry>()
  for (const [look, builder] of builders) result.set(look, builder.build())
  return result
}

export function wallEdges(level: BuiltLevel): WallEdge[] {
  const { grid } = level
  const solid = (column: number, row: number) => column >= 0 && row >= 0 && column < grid.columns && row < grid.rows && tileAt(grid, column, row) === Tile.Wall && !isBorder(grid, column, row)
  const edges: WallEdge[] = []
  for (let row = 0; row < grid.rows; row++) {
    for (let column = 0; column < grid.columns; column++) {
      if (!solid(column, row)) continue
      const theme = themeOf(level, row)
      const base = cellFloor(grid, column, row)
      for (const side of SIDES) {
        const nc = column + side.dc
        const nr = row + side.dr
        if (solid(nc, nr) && Math.abs(cellFloor(grid, nc, nr) - base) < 0.01) continue
        const [x1, z1, x2, z2] = edgeCorners(column, row, side)
        edges.push({ x1, z1, x2, z2, inX: -side.normal.x, inZ: -side.normal.z, top: base + VISUAL_HEIGHTS.wall, theme, style: wallStyleOf(level, row), color: PALETTES[theme].wall, row, seed: row * grid.columns + column })
      }
    }
  }
  return edges
}

export function tuftGeometry(): THREE.BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  const base = new THREE.Color(TUFT.base, TUFT.base, TUFT.base)
  const tip = new THREE.Color(TUFT.tip, TUFT.tip, TUFT.tip)
  const blades = [
    { angle: 0, lean: 0.2, height: 1, width: 0.13 },
    { angle: 1.6, lean: 0.34, height: 0.72, width: 0.12 },
    { angle: 3.1, lean: 0.28, height: 0.86, width: 0.12 },
    { angle: 4.6, lean: 0.36, height: 0.66, width: 0.11 },
  ]
  for (const blade of blades) {
    const dx = Math.cos(blade.angle)
    const dz = Math.sin(blade.angle)
    const sx = -dz * blade.width
    const sz = dx * blade.width
    positions.push(-sx, 0, -sz, sx, 0, sz, dx * blade.lean, blade.height, dz * blade.lean)
    colors.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b)
    positions.push(sx, 0, sz, -sx, 0, -sz, dx * blade.lean, blade.height, dz * blade.lean)
    colors.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(positions.map((_, index) => (index % 3 === 1 ? 1 : 0)), 3))
  return geometry
}

const TUFT_THEMES: ReadonlySet<Theme> = new Set(['farm', 'meadow', 'arena', 'forest'])
const BACKDROP = {
  scale: 2.8,
  rows: [
    { every: 2, shift: 0, out: 0.6, spread: 0.6, drift: 0.8, sink: 0.3, tall: 0.8, tallSpread: 0.5, wide: 0.85, wideSpread: 0.3, shadow: true, ink: true },
    { every: 3, shift: 1, out: 2.6, spread: 0.8, drift: 1, sink: 0.6, tall: 1.35, tallSpread: 0.5, wide: 1.15, wideSpread: 0.35, shadow: false, ink: false },
  ],
} as const
const TUFT = { base: 0.74, tip: 1.12, tint: 0.92, tintSpread: 0.2, denseShare: 0.35, dense: 3, sparse: 2 } as const

export function createFpsLevelView(level: BuiltLevel, models: ModelLibrary): FpsLevelView {
  const { grid } = level
  const group = new THREE.Group()
  group.name = 'level'
  const disposables: { dispose(): void }[] = []
  const ashGeometry = new THREE.CircleGeometry(ASH.radius, 12)
  const ashMaterial = toonMaterial({ color: ASH.color })
  disposables.push(ashGeometry, ashMaterial)
  const has = (id: string) => models.has(id)

  const culled: { object: THREE.Object3D; near: number; far: number }[] = []
  const band = (row: number) => Math.floor(row / LEVEL_CULL.chunkRows)
  const bandRange = (index: number) => ({ near: index * LEVEL_CULL.chunkRows, far: (index + 1) * LEVEL_CULL.chunkRows })
  const framed = framedPlatformCells(level)
  const terrain = buildTerrain(level, framed)
  const terrainMaterials = createTerrainMaterials(level)
  for (const chunk of terrainChunks(terrain, grid.rows, LEVEL_CULL.chunkRows)) {
    const mesh = new THREE.Mesh(chunk.geometry, terrainMaterials.ground)
    mesh.receiveShadow = true
    mesh.name = 'ground'
    group.add(mesh)
    culled.push({ object: mesh, near: chunk.near, far: chunk.far })
    if (chunk.geometry !== terrain.geometry) disposables.push(chunk.geometry)
  }
  const waterMesh = new THREE.Mesh(terrain.water, terrainMaterials.water)
  waterMesh.receiveShadow = true
  waterMesh.name = 'water'
  group.add(waterMesh)
  const undersideMesh = new THREE.Mesh(terrain.underside, terrainMaterials.underside)
  undersideMesh.name = 'underside'
  group.add(undersideMesh)
  disposables.push(terrain.geometry, terrain.water, terrain.underside, terrainMaterials)
  const groundAt = (x: number, z: number, floor: number) => Math.min(floor, terrain.heightAt(x, z))

  const wallMaterials = new Map<WallLook, THREE.Material>()
  for (let index = 0; index * LEVEL_CULL.chunkRows < grid.rows; index++) {
    const range = bandRange(index)
    for (const [look, geometry] of buildWalls(level, range.near, range.far)) {
      let material = wallMaterials.get(look)
      if (!material) {
        const style = look in WALL_STYLES ? WALL_STYLES[look as WallStyle] : { color: PALETTES[look as Theme].wall, texture: WALL_TEXTURES[look as Theme] }
        material = toonMaterial({ color: style.color, map: lineTexture(style.texture) })
        wallMaterials.set(look, material)
        disposables.push(material)
      }
      const mesh = new THREE.Mesh(geometry, material)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.name = `walls-${look}`
      group.add(mesh)
      culled.push({ object: mesh, ...range })
      disposables.push(geometry)
    }
  }
  for (const structure of [...buildLevelStructures(level), ...buildLevelPlatforms(level, framed)]) {
    group.add(structure.group)
    disposables.push(structure)
    culled.push({ object: structure.group, near: structure.near, far: structure.far })
  }

  const batches = new Map<string, Batch>()
  const quaternion = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  const position = new THREE.Vector3()
  const yAxis = new THREE.Vector3(0, 1, 0)
  const partsOf = (id: string, node: string | null): readonly NodePart[] | null => {
    if (!has(id)) return null
    if (!node) return models.parts(id as ModelId)
    return bakeNode(models.shared(id as ModelId).root, node)
  }
  const place = (name: string, parts: readonly NodePart[] | null, x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, shadow: boolean, ink = true): { key: string; at: number } | null => {
    if (!parts) return null
    const key = `${name}#${band(Math.floor(z))}#${shadow ? 'cast' : 'flat'}#${ink ? 'ink' : 'plain'}`
    let batch = batches.get(key)
    if (!batch) {
      batch = { name, band: band(Math.floor(z)), parts, matrices: [], shadow, ink }
      batches.set(key, batch)
    }
    position.set(x, y, z)
    quaternion.setFromAxisAngle(yAxis, yaw)
    scale.set(sx, sy, sz)
    batch.matrices.push(new THREE.Matrix4().compose(position, quaternion, scale))
    return { key, at: batch.matrices.length - 1 }
  }

  const fenceJoins = (tile: Tile) => tile === Tile.Fence || tile === Tile.Wall || tile === Tile.Gate || tile === Tile.GateClosed
  const fenceParts = { post: partsOf('ch1-fence', 'post'), rail: partsOf('ch1-fence', 'rail') }
  const fenceScale = VISUAL_HEIGHTS.fence / 0.55
  const railYaw: Record<string, number> = { north: 0, east: -Math.PI / 2, south: Math.PI, west: Math.PI / 2 }
  const borderJoins = (column: number, row: number) => (tile: Tile) => fenceJoins(tile) && (tile !== Tile.Wall || isBorder(grid, column, row))

  const gates: GateView[] = []
  const crates: CrateView[] = []
  const kegs: KegView[] = []
  const kegCells = new Set(level.kegs)
  const hayCells = new Set(level.hay)
  const hays: HayView[] = []
  const ashes: THREE.Mesh[] = []
  const coverCells = new Set<number>()
  const coverParts = new Map<string, readonly NodePart[]>()
  const placeCover = (style: CoverDef['style'], column: number, row: number, width: number, depth: number) => {
    const floor = cellFloor(grid, column, row)
    const height = cellTop(grid, column, row) - floor
    const length = Math.max(width, depth)
    const name = `cover-${style}-${height.toFixed(2)}-${length}`
    let parts = coverParts.get(name)
    if (!parts) {
      parts = buildCover(style, height, length)
      coverParts.set(name, parts)
      for (const part of parts) disposables.push(part.geometry, part.material)
    }
    const x = column + width / 2
    const z = row + depth / 2
    const spot = place(name, parts, x, floor, z, depth > width ? Math.PI / 2 : 0, 1, 1, 1, true)
    const index = row * grid.columns + column
    if (spot && hayCells.has(index)) hays.push({ index, ...spot, x, y: floor, z, gone: false })
  }
  for (const area of level.areas) {
    for (const { style, from, to } of area.scenery?.covers ?? []) {
      const separate = style === 'bales' || style === 'sacks'
      for (let row = area.top + from[1]; row <= area.top + to[1]; row++) {
        for (let column = from[0]; column <= to[0]; column++) {
          coverCells.add(row * grid.columns + column)
          if (separate) placeCover(style, column, row, 1, 1)
        }
      }
      if (!separate) placeCover(style, from[0], area.top + from[1], to[0] - from[0] + 1, to[1] - from[1] + 1)
    }
  }

  const houseCells = new Set<number>()
  for (const { id, column, row, depth, width } of level.landmarks) {
    const kind = LANDMARKS[id].building
    if (kind !== 'workshop' && kind !== 'weighhouse' && kind !== 'tool-shed') continue
    for (let r = row; r < row + depth; r++) {
      for (let c = column; c < column + width; c++) houseCells.add(r * grid.columns + c)
    }
  }
  const stalkSpots = new Map<string, { theme: Theme; band: number; matrices: THREE.Matrix4[] }>()
  const gateParts = has('ch1-gate')
  const crateModel = has('crate')
  const hidden = hiddenTops(level)
  const depths = treeDepths(grid)
  const fenceUnseen = (column: number, row: number) => {
    const inner = innerNeighbor(grid, column, row)
    if (!inner) return false
    const tile = tileAt(grid, inner.column, inner.row)
    return tile === Tile.Wall || tile === Tile.Tree || hidden[inner.row * grid.columns + inner.column] === 1
  }

  for (let row = 0; row < grid.rows; row++) {
    const theme = themeOf(level, row)
    for (let column = 0; column < grid.columns; column++) {
      if (coverCells.has(row * grid.columns + column)) continue
      const tile = tileAt(grid, column, row)
      const floor = cellFloor(grid, column, row)
      const x = column + 0.5
      const z = row + 0.5
      const border = isBorder(grid, column, row)
      if (tile === Tile.Wall && border && BACKDROP_THEMES.has(theme) && (column === 0 || column === grid.columns - 1)) {
        const side = column === 0 ? -1 : 1
        BACKDROP.rows.forEach((ring, index) => {
          if ((row + (column === 0 ? ring.shift : 1 - ring.shift)) % ring.every !== 0) return
          const id = variantModel(has, propModel('tree', theme), PROP_MODELS.tree.variants, column + index * 3, row + index * 5)
          if (!id) return
          const salt = index * 10
          const tall = BACKDROP.scale * (ring.tall + cellHash(column, row, 7 + salt) * ring.tallSpread)
          const wide = BACKDROP.scale * (ring.wide + cellHash(column, row, 8 + salt) * ring.wideSpread)
          const out = ring.out + cellHash(column, row, 9 + salt) * ring.spread
          const along = (cellHash(column, row, 10 + salt) - 0.5) * ring.drift
          place(id, models.parts(id as ModelId), x + side * out, floor - ring.sink, z + along, propYaw('tree', column + index, row), wide, tall, wide, ring.shadow, ring.ink)
        })
      }
      if (tile === Tile.Fence || (tile === Tile.Wall && border)) {
        if (border && fenceUnseen(column, row)) continue
        place('fence-post', fenceParts.post, x, floor, z, 0, 1.15, fenceScale, 1.15, false)
        const links = linksOf(grid, column, row, border ? borderJoins(column, row) : fenceJoins)
        for (const [direction, linked] of Object.entries(links)) {
          if (!linked) continue
          place('fence-rail', fenceParts.rail, x, floor, z, railYaw[direction], 1, fenceScale, 1, false)
        }
        continue
      }
      if (tile === Tile.Gate || tile === Tile.GateClosed) {
        if (!gateParts) continue
        const instance = models.instance('ch1-gate' as ModelId)
        toonify(instance.root)
        instance.root.position.set(x, floor, z)
        instance.root.rotation.y = facingYaw(gateFacing(grid, column, row))
        instance.root.scale.set(1, VISUAL_HEIGHTS.gate / 1.25, 1)
        instance.root.traverse((object) => {
          object.castShadow = true
          object.receiveShadow = true
        })
        group.add(instance.root)
        gates.push({ index: row * grid.columns + column, root: instance.root, base: floor, lift: tile === Tile.Gate ? 1 : 0 })
        continue
      }
      if (tile === Tile.Crate && kegCells.has(row * grid.columns + column)) {
        const keg = buildKeg()
        const yaw = cellHash(column, row, 6) * Math.PI * 2
        keg.root.position.set(x, floor, z)
        keg.root.rotation.y = yaw
        group.add(keg.root)
        const index = row * grid.columns + column
        kegs.push({ index, row, root: keg.root, body: keg.body, spark: keg.spark, yaw })
        disposables.push(keg.body)
        continue
      }
      if (tile === Tile.Crate) {
        if (!crateModel) continue
        const index = row * grid.columns + column
        const layers = crateLayers(grid.top[index] - floor)
        for (let layer = 0; layer < layers.length; layer++) {
          const instance = models.instance('crate' as ModelId)
          toonify(instance.root)
          instance.root.position.set(x, floor + layers[layer].base, z)
          instance.root.rotation.y = Math.floor(cellHash(column, row + layer * 7, 4) * 4) * (Math.PI / 2) + layer * CRATE_STACK.twist
          instance.root.scale.setScalar(layers[layer].size)
          instance.root.traverse((object) => {
            object.castShadow = true
            object.receiveShadow = true
          })
          group.add(instance.root)
          crates.push({ index, root: instance.root })
        }
        continue
      }
      const bridge = tile === Tile.Path || tile === Tile.Floor ? bridgeAt(grid, column, row) : null
      if (bridge) {
        place('bridge-deck', partsOf('ch1-bridge', 'deck'), x, floor, z, facingYaw(bridge.facing), 1.02, 1, 1.02, false)
        for (const rail of bridge.rails) place('bridge-rail', partsOf('ch1-bridge', 'rail'), x, floor, z, facingYaw(rail), 1, 1.3, 1, true)
      }
      const kind = TILE_PROPS[tile]
      if (!kind) continue
      if (hidden[row * grid.columns + column] === 1) continue
      const stalks = kind === 'bush' ? STALK_STYLES[theme] : undefined
      if (stalks) {
        const key = `${theme}#${band(row)}`
        const list = stalkSpots.get(key) ?? { theme, band: band(row), matrices: [] }
        list.matrices.push(...stalkMatrices(column, row, terrain.heightAt, stalks))
        stalkSpots.set(key, list)
        continue
      }
      const rule = PROP_MODELS[kind]
      const base = propModel(kind, theme)
      const id = variantModel(has, base, rule.variants, column, row)
      if (!id) continue
      if (tile === Tile.Boulder) {
        const wide = BOULDER_WIDTH * (0.95 + cellHash(column, row, 5) * 0.1)
        place(id, models.parts(id as ModelId), x, groundAt(x, z, floor) - 0.1, z, propYaw(kind, column, row), wide, VISUAL_HEIGHTS.boulder / 0.75, wide, true)
        continue
      }
      const fit = PROP_FIT[kind] ?? 1
      const s = propScale(kind, column, row) * fit
      if (kind === 'tree') {
        const look = treeLook(depths[row * grid.columns + column], column, row)
        if (!look) continue
        place(id, models.parts(id as ModelId), x, groundAt(x, z, floor) - 0.06, z, propYaw(kind, column, row), s * look.scale, s * look.scale, s * look.scale, look.shadow, look.ink)
        continue
      }
      const spot = place(id, models.parts(id as ModelId), x, groundAt(x, z, floor) - (kind === 'cart' ? 0 : 0.06), z, propYaw(kind, column, row), s, s, s, kind !== 'bush')
      const cell = row * grid.columns + column
      if (spot && tile === Tile.Rock && hayCells.has(cell)) hays.push({ index: cell, ...spot, x, y: floor, z, gone: false })
    }
  }

  const batchMeshes = new Map<string, THREE.InstancedMesh[]>()
  for (const [key, batch] of batches) {
    const meshes: THREE.InstancedMesh[] = []
    batchMeshes.set(key, meshes)
    for (const part of batch.parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, toToon(part.material), batch.matrices.length)
      meshes.push(mesh)
      batch.matrices.forEach((m, index) => mesh.setMatrixAt(index, m))
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
      mesh.castShadow = batch.shadow
      mesh.receiveShadow = true
      mesh.name = batch.name
      if (!batch.ink) mesh.userData.noInk = true
      group.add(mesh)
      culled.push({ object: mesh, ...bandRange(batch.band) })
    }
  }

  const stalkMaterial = createStalkMaterial()
  const stalkGeometries = new Map<Theme, THREE.BufferGeometry>()
  disposables.push(stalkMaterial.material)
  for (const spot of stalkSpots.values()) {
    const style = STALK_STYLES[spot.theme]
    if (!style) continue
    let geometry = stalkGeometries.get(spot.theme)
    if (!geometry) {
      geometry = stalkGeometry(style)
      stalkGeometries.set(spot.theme, geometry)
      disposables.push(geometry)
    }
    const mesh = new THREE.InstancedMesh(geometry, stalkMaterial.material, spot.matrices.length)
    spot.matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix))
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    mesh.receiveShadow = true
    mesh.name = 'stalks'
    mesh.userData.noInk = true
    group.add(mesh)
    culled.push({ object: mesh, ...bandRange(spot.band) })
  }

  const tuftSpots = new Map<number, THREE.Matrix4[]>()
  const tuftTints = new Map<number, THREE.Color[]>()
  const unseen = (column: number, row: number) => {
    const cell = row * grid.columns + column
    return hidden[cell] === 1 || houseCells.has(cell) || platformSurfaceOf(level, column, row) !== undefined
  }
  for (let row = 0; row < grid.rows; row++) {
    if (!TUFT_THEMES.has(themeOf(level, row))) continue
    for (let column = 0; column < grid.columns; column++) {
      if (tileAt(grid, column, row) !== Tile.Floor || isBorder(grid, column, row) || unseen(column, row)) continue
      if (barnPartAt(level, column, row) === 'interior') continue
      const count = cellHash(column, row, 11) < TUFT.denseShare ? TUFT.dense : TUFT.sparse
      for (let k = 0; k < count; k++) {
        const tx = column + 0.15 + cellHash(column, row, 20 + k) * 0.7
        const tz = row + 0.15 + cellHash(column, row, 40 + k) * 0.7
        const size = 0.26 + cellHash(column, row, 60 + k) * 0.18
        position.set(tx, terrain.heightAt(tx, tz) - 0.02, tz)
        quaternion.setFromAxisAngle(yAxis, cellHash(column, row, 80 + k) * Math.PI * 2)
        scale.set(size, size * (0.9 + cellHash(column, row, 90 + k) * 0.5), size)
        const spots = tuftSpots.get(band(row)) ?? []
        spots.push(new THREE.Matrix4().compose(position, quaternion, scale))
        tuftSpots.set(band(row), spots)
        const tints = tuftTints.get(band(row)) ?? []
        tints.push(new THREE.Color(PALETTES[themeOf(level, row)].floorA).multiplyScalar(TUFT.tint + cellHash(column, row, 70 + k) * TUFT.tintSpread))
        tuftTints.set(band(row), tints)
      }
    }
  }
  if (tuftSpots.size > 0) {
    const tuftGeo = tuftGeometry()
    const tuftMaterial = toonMaterial({ vertexColors: true, depthWrite: false })
    disposables.push(tuftGeo, tuftMaterial)
    for (const [index, spots] of tuftSpots) {
      const tufts = new THREE.InstancedMesh(tuftGeo, tuftMaterial, spots.length)
      spots.forEach((m, at) => tufts.setMatrixAt(at, m))
      tuftTints.get(index)?.forEach((tint, at) => tufts.setColorAt(at, tint))
      tufts.instanceMatrix.needsUpdate = true
      tufts.computeBoundingSphere()
      tufts.receiveShadow = true
      tufts.name = 'tufts'
      tufts.userData.noInk = true
      tufts.renderOrder = 1
      group.add(tufts)
      culled.push({ object: tufts, ...bandRange(index) })
    }
  }

  const addDetails = (name: string, batches: Map<number, DetailBatch>, geometry: THREE.BufferGeometry, material: THREE.Material, ink: boolean, tinted = true) => {
    if (batches.size === 0) {
      geometry.dispose()
      material.dispose()
      return
    }
    disposables.push(geometry, material)
    for (const [index, batch] of batches) {
      const mesh = new THREE.InstancedMesh(geometry, material, batch.matrices.length)
      batch.matrices.forEach((m, at) => mesh.setMatrixAt(at, m))
      if (tinted) batch.colors.forEach((c, at) => mesh.setColorAt(at, c))
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()
      mesh.receiveShadow = true
      mesh.name = name
      mesh.userData.noInk = !ink
      group.add(mesh)
      culled.push({ object: mesh, ...bandRange(index) })
    }
  }
  const surface = (x: number, z: number) => terrain.heightAt(x, z)
  const flowers = flowerBatches(grid, (row) => themeOf(level, row), surface, band, (column, row) => isBorder(grid, column, row) || unseen(column, row))
  addDetails('flower-stems', flowers, flowerStemGeometry(), toonMaterial({ vertexColors: true, side: THREE.DoubleSide }), false, false)
  addDetails('flower-heads', flowers, flowerHeadGeometry(), toonMaterial({ side: THREE.DoubleSide }), false)
  addDetails('pebbles', pebbleBatches(grid, surface, band, unseen), pebbleGeometry(), toonMaterial({}), false)
  const edges = wallEdges(level)
  addDetails('palisade-tips', spikeBatches(edges, band), spikeGeometry(), toonMaterial({}), true)
  addDetails('hedge-tops', hedgeTopBatches(edges, band), hedgeTopGeometry(), toonMaterial({}), true)

  const exitMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color('#9ff6ff').multiplyScalar(1.1), transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide })
  const exitGeometry = new THREE.CylinderGeometry(0.32, 0.42, 4.5, 20, 1, true)
  disposables.push(exitMaterial, exitGeometry)
  const exits: THREE.Mesh[] = []
  for (const index of level.exits) {
    const column = index % grid.columns
    const row = Math.floor(index / grid.columns)
    const beam = new THREE.Mesh(exitGeometry, exitMaterial)
    beam.position.set(column + 0.5, cellFloor(grid, column, row) + 2.25, row + 0.5)
    beam.userData.noInk = true
    group.add(beam)
    exits.push(beam)
  }

  const motions: Motion[] = []
  for (const placement of level.landmarks) {
    const kind = LANDMARKS[placement.id].building
    if (kind) {
      const building = buildBuilding(kind, placement, cellFloor(grid, placement.column, placement.row))
      group.add(building.group)
      disposables.push(building)
      culled.push({ object: building.group, near: placement.row - 1, far: placement.row + placement.depth + 1 })
      continue
    }
    const id = landmarkModel(has, placement.id, placement.variant)
    if (!id) continue
    const instance = models.instance(id as ModelId)
    toonify(instance.root)
    const center = footprintCenter(placement.column, placement.row, placement.width, placement.depth)
    const floor = cellFloor(grid, Math.min(grid.columns - 1, Math.floor(center.x)), Math.min(grid.rows - 1, Math.floor(center.z)))
    instance.root.position.set(center.x, floor, center.z)
    instance.root.rotation.y = landmarkYaw(placement.id, placement.facing, placement.column, placement.row)
    instance.root.traverse((object) => {
      object.castShadow = true
      object.receiveShadow = true
    })
    group.add(instance.root)
    for (const motion of LANDMARKS[placement.id].motion ?? []) {
      const node = instance.nodes.get(motion.node)
      if (!node) continue
      const [ax, ay, az] = motionAxis(motion.axis)
      motions.push({ node, rest: node.quaternion.clone(), axis: new THREE.Vector3(ax, ay, az), motion })
    }
  }
  const actors = level.actors.length ? createStoryActors(level, group) : undefined
  if (actors) disposables.push(actors)

  let time = 0
  const turn = new THREE.Quaternion()
  return {
    group,
    heightAt: terrain.heightAt,
    update(world, dt, eye) {
      time += dt
      actors?.update(world.areaIndex, time)
      terrainMaterials.update(dt)
      stalkMaterial.update(dt)
      const z = eye ? eye.z : world.player.pos.y
      for (const item of culled) item.object.visible = item.far >= z - LEVEL_CULL.drawDistance && item.near <= z + LEVEL_CULL.drawDistance
      for (const entry of motions) {
        turn.setFromAxisAngle(entry.axis, motionAngle(entry.motion, time))
        entry.node.quaternion.copy(entry.rest).multiply(turn)
      }
      for (const gate of gates) {
        const open = world.grid.tiles[gate.index] === Tile.Gate
        gate.lift += ((open ? 1 : 0) - gate.lift) * Math.min(1, dt * 3)
        gate.root.position.y = gate.base - gate.lift * (VISUAL_HEIGHTS.gate + 0.2)
        gate.root.visible = gate.lift < 0.98
      }
      for (const crate of crates) crate.root.visible = world.grid.tiles[crate.index] === Tile.Crate
      for (const keg of kegs) {
        keg.root.visible = world.grid.tiles[keg.index] === Tile.Crate && Math.abs(keg.row + 0.5 - z) <= LEVEL_CULL.drawDistance
        const lit = keg.root.visible && world.blasts.some((blast) => blast.keg === keg.index)
        const beat = lit ? 0.5 + 0.5 * Math.sin(time * KEG_LOOK.pulse) : 0
        keg.body.emissiveIntensity = beat * 0.9
        keg.spark.visible = lit
        keg.root.rotation.y = keg.yaw + (lit ? Math.sin(time * 40) * 0.06 : 0)
        keg.root.scale.setScalar(1 + beat * 0.05)
      }
      for (const hay of hays) {
        if (hay.gone || world.grid.tiles[hay.index] === Tile.Rock) continue
        hay.gone = true
        for (const mesh of batchMeshes.get(hay.key) ?? []) {
          mesh.setMatrixAt(hay.at, HIDDEN)
          mesh.instanceMatrix.needsUpdate = true
        }
        const ash = new THREE.Mesh(ashGeometry, ashMaterial)
        ash.rotation.x = -Math.PI / 2
        ash.rotation.z = cellHash(Math.floor(hay.x), Math.floor(hay.z), 9) * Math.PI
        ash.position.set(hay.x, hay.y + 0.03, hay.z)
        ash.receiveShadow = true
        group.add(ash)
        ashes.push(ash)
      }
      for (const beam of exits) {
        beam.rotation.y = time * 0.8
        beam.visible = world.status === 'playing'
      }
    },
    handle() {},
    dispose() {
      group.removeFromParent()
      for (const item of disposables) item.dispose()
      group.traverse((object) => {
        const mesh = object as THREE.InstancedMesh
        if (mesh.isInstancedMesh) mesh.dispose()
      })
    },
  }
}
