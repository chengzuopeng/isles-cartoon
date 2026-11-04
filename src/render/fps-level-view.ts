import * as THREE from 'three'
import { LANDMARKS, type LandmarkMotion } from '../data/landmarks'
import type { Theme } from '../data/levels/types'
import { Tile, cellFloor, tileAt, type Grid } from '../sim/grid'
import type { BuiltLevel } from '../sim/level'
import type { GameEvent } from '../sim/types'
import type { World } from '../sim/world'
import type { ModelId } from './asset-urls'
import { lineTexture, type LineTextureKind } from './line-textures'
import type { ModelLibrary } from './model-library'
import { buildBuilding } from './buildings'
import { buildTerrain, createTerrainMaterials, surfaceHeight, terrainChunks } from './fps-terrain'
import { STALK_STYLES, createStalkMaterial, stalkGeometry, stalkMatrices } from './stalks'
import { flowerBatches, flowerHeadGeometry, flowerStemGeometry, pebbleBatches, pebbleGeometry, spikeBatches, spikeGeometry, type DetailBatch, type WallEdge } from './ground-details'
import { bakeNode, type NodePart } from './node-parts'
import {
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

interface Motion {
  node: THREE.Object3D
  rest: THREE.Quaternion
  axis: THREE.Vector3
  motion: LandmarkMotion
}

export function isBorder(grid: Grid, column: number, row: number): boolean {
  return column === 0 || row === 0 || column === grid.columns - 1 || row === grid.rows - 1
}

function themeOf(level: BuiltLevel, row: number): Theme {
  return level.areas[level.areaOfRow[row]]?.theme ?? 'farm'
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

export function buildWalls(level: BuiltLevel, fromRow = 0, toRow = level.grid.rows): Map<Theme, THREE.BufferGeometry> {
  const { grid } = level
  const builders = new Map<Theme, GeometryBuilder>()
  const white = new THREE.Color('#ffffff')
  const solid = (column: number, row: number) => column >= 0 && row >= 0 && column < grid.columns && row < grid.rows && tileAt(grid, column, row) === Tile.Wall && !isBorder(grid, column, row)
  for (let row = fromRow; row < Math.min(toRow, grid.rows); row++) {
    for (let column = 0; column < grid.columns; column++) {
      if (!solid(column, row)) continue
      const theme = themeOf(level, row)
      let builder = builders.get(theme)
      if (!builder) {
        builder = new GeometryBuilder()
        builders.set(theme, builder)
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
        builder.quad({ x: x1, y: top, z: z1 }, { x: x1, y: floor, z: z1 }, { x: x2, y: floor, z: z2 }, { x: x2, y: top, z: z2 }, side.normal, white, [along, top, along, floor, along2, floor, along2, top])
      }
    }
  }
  const result = new Map<Theme, THREE.BufferGeometry>()
  for (const [theme, builder] of builders) result.set(theme, builder.build())
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
        edges.push({ x1, z1, x2, z2, inX: -side.normal.x, inZ: -side.normal.z, top: base + VISUAL_HEIGHTS.wall, theme, color: PALETTES[theme].wall, row, seed: row * grid.columns + column })
      }
    }
  }
  return edges
}

export function tuftGeometry(): THREE.BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  const base = new THREE.Color('#4f7f3a')
  const tip = new THREE.Color('#b9d97a')
  const blades = [
    { angle: 0, lean: 0.22, height: 1, width: 0.26 },
    { angle: 2.1, lean: 0.3, height: 0.8, width: 0.24 },
    { angle: 4.2, lean: 0.26, height: 0.9, width: 0.24 },
  ]
  for (const blade of blades) {
    const dx = Math.cos(blade.angle)
    const dz = Math.sin(blade.angle)
    const sx = -dz * blade.width
    const sz = dx * blade.width
    positions.push(-sx, 0, -sz, sx, 0, sz, dx * blade.lean, blade.height, dz * blade.lean)
    colors.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
}

const TUFT_THEMES: ReadonlySet<Theme> = new Set(['farm', 'meadow', 'arena', 'forest'])

export function createFpsLevelView(level: BuiltLevel, models: ModelLibrary): FpsLevelView {
  const { grid } = level
  const group = new THREE.Group()
  group.name = 'level'
  const disposables: { dispose(): void }[] = []
  const has = (id: string) => models.has(id)

  const culled: { object: THREE.Object3D; near: number; far: number }[] = []
  const band = (row: number) => Math.floor(row / LEVEL_CULL.chunkRows)
  const bandRange = (index: number) => ({ near: index * LEVEL_CULL.chunkRows, far: (index + 1) * LEVEL_CULL.chunkRows })
  const terrain = buildTerrain(level)
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

  const wallMaterials = new Map<Theme, THREE.Material>()
  for (let index = 0; index * LEVEL_CULL.chunkRows < grid.rows; index++) {
    const range = bandRange(index)
    for (const [theme, geometry] of buildWalls(level, range.near, range.far)) {
      let material = wallMaterials.get(theme)
      if (!material) {
        material = toonMaterial({ color: PALETTES[theme].wall, map: lineTexture(WALL_TEXTURES[theme]) })
        wallMaterials.set(theme, material)
        disposables.push(material)
      }
      const mesh = new THREE.Mesh(geometry, material)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.name = `walls-${theme}`
      group.add(mesh)
      culled.push({ object: mesh, ...range })
      disposables.push(geometry)
    }
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
  const place = (name: string, parts: readonly NodePart[] | null, x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, shadow: boolean) => {
    if (!parts) return
    const key = `${name}#${band(Math.floor(z))}`
    let batch = batches.get(key)
    if (!batch) {
      batch = { name, band: band(Math.floor(z)), parts, matrices: [], shadow }
      batches.set(key, batch)
    }
    position.set(x, y, z)
    quaternion.setFromAxisAngle(yAxis, yaw)
    scale.set(sx, sy, sz)
    batch.matrices.push(new THREE.Matrix4().compose(position, quaternion, scale))
  }

  const fenceJoins = (tile: Tile) => tile === Tile.Fence || tile === Tile.Wall || tile === Tile.Gate || tile === Tile.GateClosed
  const fenceParts = { post: partsOf('ch1-fence', 'post'), rail: partsOf('ch1-fence', 'rail') }
  const fenceScale = VISUAL_HEIGHTS.fence / 0.55
  const railYaw: Record<string, number> = { north: 0, east: -Math.PI / 2, south: Math.PI, west: Math.PI / 2 }
  const borderJoins = (column: number, row: number) => (tile: Tile) => fenceJoins(tile) && (tile !== Tile.Wall || isBorder(grid, column, row))

  const gates: GateView[] = []
  const crates: CrateView[] = []
  const stalkSpots = new Map<string, { theme: Theme; band: number; matrices: THREE.Matrix4[] }>()
  const gateParts = has('ch1-gate')
  const crateModel = has('crate')

  for (let row = 0; row < grid.rows; row++) {
    const theme = themeOf(level, row)
    for (let column = 0; column < grid.columns; column++) {
      const tile = tileAt(grid, column, row)
      const floor = cellFloor(grid, column, row)
      const x = column + 0.5
      const z = row + 0.5
      const border = isBorder(grid, column, row)
      if (tile === Tile.Fence || (tile === Tile.Wall && border)) {
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
      place(id, models.parts(id as ModelId), x, groundAt(x, z, floor) - (kind === 'cart' ? 0 : 0.06), z, propYaw(kind, column, row), s, s, s, kind !== 'bush')
    }
  }

  for (const batch of batches.values()) {
    for (const part of batch.parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, toToon(part.material), batch.matrices.length)
      batch.matrices.forEach((m, index) => mesh.setMatrixAt(index, m))
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
      mesh.castShadow = batch.shadow
      mesh.receiveShadow = true
      mesh.name = batch.name
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
  for (let row = 0; row < grid.rows; row++) {
    if (!TUFT_THEMES.has(themeOf(level, row))) continue
    for (let column = 0; column < grid.columns; column++) {
      if (tileAt(grid, column, row) !== Tile.Floor || isBorder(grid, column, row)) continue
      const count = cellHash(column, row, 11) < 0.35 ? 3 : 1
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
      }
    }
  }
  if (tuftSpots.size > 0) {
    const tuftGeo = tuftGeometry()
    const tuftMaterial = toonMaterial({ vertexColors: true, side: THREE.DoubleSide })
    disposables.push(tuftGeo, tuftMaterial)
    for (const [index, spots] of tuftSpots) {
      const tufts = new THREE.InstancedMesh(tuftGeo, tuftMaterial, spots.length)
      spots.forEach((m, at) => tufts.setMatrixAt(at, m))
      tufts.instanceMatrix.needsUpdate = true
      tufts.computeBoundingSphere()
      tufts.receiveShadow = true
      tufts.name = 'tufts'
      tufts.userData.noInk = true
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
  const flowers = flowerBatches(grid, (row) => themeOf(level, row), surface, band, (column, row) => isBorder(grid, column, row))
  addDetails('flower-stems', flowers, flowerStemGeometry(), toonMaterial({ vertexColors: true, side: THREE.DoubleSide }), false, false)
  addDetails('flower-heads', flowers, flowerHeadGeometry(), toonMaterial({ side: THREE.DoubleSide }), false)
  addDetails('pebbles', pebbleBatches(grid, surface, band), pebbleGeometry(), toonMaterial({}), false)
  addDetails('palisade-tips', spikeBatches(wallEdges(level), band), spikeGeometry(), toonMaterial({}), true)

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

  let time = 0
  const turn = new THREE.Quaternion()
  return {
    group,
    heightAt: terrain.heightAt,
    update(world, dt, eye) {
      time += dt
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
