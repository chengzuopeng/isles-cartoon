import * as THREE from 'three'
import { regionContainsCell, type PlatformDef, type Theme } from '../data/levels/types'
import { Tile, cellFloor, tileAt, type Grid } from '../sim/grid'
import type { BuiltLevel } from '../sim/level'
import { barnPartAt } from './level-buildings'
import { deckHeightAt, framedPlatformCells, platformHeights } from './level-platforms'
import { lineTexture } from './line-textures'
import { cellHash } from './scene-models'
import { PALETTES } from './themes'
import { inkify, toonGradient } from './toon'

export const TERRAIN = {
  sub: 3,
  margin: 7,
  blur: 2,
  settle: 0.3,
  waterBed: 0.6,
  waterLevel: 0.2,
  waterReach: 0.3,
  rimNear: 1.5,
  rimFar: 4.5,
  cliffSlope: 14,
  cliffDepth: 46,
} as const

const SOIL = new THREE.Color('#8a6a48')
const BANK = new THREE.Color('#a07c56')
const CLIFF = new THREE.Color('#9a7f66')
const UNDERSIDE = new THREE.Color('#86664a')

export interface Terrain {
  readonly geometry: THREE.BufferGeometry
  readonly water: THREE.BufferGeometry
  readonly underside: THREE.BufferGeometry
  readonly width: number
  readonly depth: number
  heightAt(x: number, z: number): number
}

export interface TerrainChunk {
  readonly geometry: THREE.BufferGeometry
  readonly near: number
  readonly far: number
}

export interface TerrainMaterials {
  readonly ground: THREE.MeshToonMaterial
  readonly water: THREE.MeshToonMaterial
  readonly underside: THREE.MeshToonMaterial
  update(dt: number): void
  dispose(): void
}

function themeOf(level: BuiltLevel, row: number): Theme {
  return level.areas[level.areaOfRow[row]]?.theme ?? 'farm'
}

function lattice(x: number, z: number, salt: number): number {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = x - ix
  const fz = z - iz
  const sx = fx * fx * (3 - 2 * fx)
  const sz = fz * fz * (3 - 2 * fz)
  const a = cellHash(ix, iz, salt)
  const b = cellHash(ix + 1, iz, salt)
  const c = cellHash(ix, iz + 1, salt)
  const d = cellHash(ix + 1, iz + 1, salt)
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz
}

export function rimEdge(x: number, z: number): number {
  const shape = lattice(x * 0.2, z * 0.2, 71) * 0.65 + lattice(x * 0.65, z * 0.65, 73) * 0.35
  return TERRAIN.rimNear + (TERRAIN.rimFar - TERRAIN.rimNear) * shape
}

export function surfaceHeight(grid: Grid, column: number, row: number): number {
  if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) return -TERRAIN.cliffDepth
  const floor = cellFloor(grid, column, row)
  return tileAt(grid, column, row) === Tile.Water ? floor - TERRAIN.waterBed : floor
}

export function rawHeight(grid: Grid, x: number, z: number): number {
  const column = Math.min(grid.columns - 1, Math.max(0, Math.floor(x)))
  const row = Math.min(grid.rows - 1, Math.max(0, Math.floor(z)))
  if (x >= 0 && z >= 0 && x < grid.columns && z < grid.rows) return surfaceHeight(grid, column, row)
  const floor = cellFloor(grid, column, row)
  const dx = x < 0 ? -x : x > grid.columns ? x - grid.columns : 0
  const dz = z < 0 ? -z : z > grid.rows ? z - grid.rows : 0
  const beyond = Math.hypot(dx, dz) - rimEdge(x, z)
  if (beyond <= 0) return floor
  return floor - Math.min(TERRAIN.cliffDepth, beyond * TERRAIN.cliffSlope)
}

function blurAxis(source: Float32Array, width: number, depth: number, horizontal: boolean): Float32Array {
  const result = new Float32Array(source.length)
  const radius = TERRAIN.blur
  for (let j = 0; j < depth; j++) {
    for (let i = 0; i < width; i++) {
      let total = 0
      let weights = 0
      for (let k = -radius; k <= radius; k++) {
        const si = horizontal ? Math.min(width - 1, Math.max(0, i + k)) : i
        const sj = horizontal ? j : Math.min(depth - 1, Math.max(0, j + k))
        const weight = radius + 1 - Math.abs(k)
        total += source[sj * width + si] * weight
        weights += weight
      }
      result[j * width + i] = total / weights
    }
  }
  return result
}

function perimeter(width: number, depth: number): number[] {
  const loop: number[] = []
  for (let i = 0; i < width - 1; i++) loop.push(i)
  for (let j = 0; j < depth - 1; j++) loop.push(j * width + width - 1)
  for (let i = width - 1; i > 0; i--) loop.push((depth - 1) * width + i)
  for (let j = depth - 1; j > 0; j--) loop.push(j * width)
  return loop
}

function buildUnderside(grid: Grid, heights: Float32Array, width: number, depth: number, sampleX: (i: number) => number, sampleZ: (j: number) => number): THREE.BufferGeometry {
  const loop = perimeter(width, depth)
  const cx = grid.columns / 2
  const cz = grid.rows / 2
  const halfX = grid.columns / 2 + TERRAIN.margin
  const halfZ = grid.rows / 2 + TERRAIN.margin
  const rings = [
    { inset: 0, y: 0, jitter: 0 },
    { inset: 5, y: -56, jitter: 2.5 },
    { inset: 13, y: -74, jitter: 3.5 },
  ]
  const points = rings.map((ring, r) =>
    loop.map((index, k) => {
      const x = sampleX(index % width)
      const z = sampleZ(Math.floor(index / width))
      if (r === 0) return new THREE.Vector3(x, heights[index], z)
      const noise = (lattice(k * 0.05, r * 3.1, 90 + r) - 0.5) * 2 * ring.jitter
      const scaleX = Math.max(0.05, (halfX - ring.inset) / halfX)
      const scaleZ = Math.max(0.05, (halfZ - ring.inset * 1.3) / halfZ)
      return new THREE.Vector3(cx + (x - cx) * scaleX + noise, ring.y + noise * 2, cz + (z - cz) * scaleZ - noise)
    }),
  )
  const tip = new THREE.Vector3(cx, -104, cz)
  const positions: number[] = []
  const push = (...corners: THREE.Vector3[]) => {
    for (const corner of corners) positions.push(corner.x, corner.y, corner.z)
  }
  for (let r = 0; r < points.length - 1; r++) {
    const outer = points[r]
    const inner = points[r + 1]
    for (let k = 0; k < outer.length; k++) {
      const next = (k + 1) % outer.length
      push(outer[k], outer[next], inner[k])
      push(outer[next], inner[next], inner[k])
    }
  }
  const last = points[points.length - 1]
  for (let k = 0; k < last.length; k++) push(last[k], last[(k + 1) % last.length], tip)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const uvs: number[] = []
  for (let i = 0; i < positions.length; i += 3) uvs.push((positions[i] + positions[i + 2]) * 0.05, positions[i + 1] * 0.05)
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.computeVertexNormals()
  return geometry
}

function buildWater(level: BuiltLevel): THREE.BufferGeometry {
  const { grid } = level
  const positions: number[] = []
  const colors: number[] = []
  const color = new THREE.Color()
  const wet = (column: number, row: number) => tileAt(grid, column, row) === Tile.Water && column >= 0 && row >= 0 && column < grid.columns && row < grid.rows
  for (let row = 0; row < grid.rows; row++) {
    for (let column = 0; column < grid.columns; column++) {
      if (!wet(column, row)) continue
      const y = cellFloor(grid, column, row) - TERRAIN.waterLevel
      const reach = TERRAIN.waterReach
      const x0 = column - (wet(column - 1, row) ? 0 : reach)
      const x1 = column + 1 + (wet(column + 1, row) ? 0 : reach)
      const z0 = row - (wet(column, row - 1) ? 0 : reach)
      const z1 = row + 1 + (wet(column, row + 1) ? 0 : reach)
      positions.push(x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0)
      color.set(PALETTES[themeOf(level, row)].water)
      for (let k = 0; k < 6; k++) colors.push(color.r, color.g, color.b)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  const normals = new Float32Array(positions.length)
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.computeBoundingSphere()
  return geometry
}

export function buildTerrain(level: BuiltLevel, framed = framedPlatformCells(level)): Terrain {
  const { grid } = level
  // Keep the smoothed ground below authored decks. The decks supply their own top and risers.
  const ground = framed.size > 0 ? { ...grid, floor: grid.floor.slice() } : grid
  for (const [index, platform] of framed) ground.floor[index] = platform.frame.base
  const { sub, margin } = TERRAIN
  const width = (grid.columns + margin * 2) * sub
  const depth = (grid.rows + margin * 2) * sub
  const sampleX = (i: number) => -margin + (i + 0.5) / sub
  const sampleZ = (j: number) => -margin + (j + 0.5) / sub
  const raw = new Float32Array(width * depth)
  for (let j = 0; j < depth; j++) for (let i = 0; i < width; i++) raw[j * width + i] = rawHeight(ground, sampleX(i), sampleZ(j))
  const blurred = blurAxis(blurAxis(raw, width, depth, true), width, depth, false)
  const heights = new Float32Array(raw.length)
  for (let k = 0; k < raw.length; k++) heights[k] = raw[k] + Math.max(-TERRAIN.settle, Math.min(TERRAIN.settle, blurred[k] - raw[k]))

  const positions = new Float32Array(width * depth * 3)
  for (let j = 0; j < depth; j++) {
    for (let i = 0; i < width; i++) {
      const k = j * width + i
      positions[k * 3] = sampleX(i)
      positions[k * 3 + 1] = heights[k]
      positions[k * 3 + 2] = sampleZ(j)
    }
  }
  const indices = new Uint32Array((width - 1) * (depth - 1) * 6)
  let cursor = 0
  for (let j = 0; j < depth - 1; j++) {
    for (let i = 0; i < width - 1; i++) {
      const a = j * width + i
      const b = a + 1
      const c = a + width + 1
      const d = a + width
      if (Math.abs(heights[a] - heights[c]) <= Math.abs(heights[b] - heights[d])) {
        indices.set([a, c, b, a, d, c], cursor)
      } else {
        indices.set([a, d, b, b, d, c], cursor)
      }
      cursor += 6
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()

  const heightAt = (x: number, z: number) => {
    if (x >= 0 && x < grid.columns && z >= 0 && z < grid.rows) {
      const index = Math.floor(z) * grid.columns + Math.floor(x)
      const platform = framed.get(index)
      if (platform) return deckHeightAt(platformHeights(level, index, platform), x - Math.floor(x), z - Math.floor(z))
    }
    const fi = Math.min(width - 1, Math.max(0, (x + margin) * sub - 0.5))
    const fj = Math.min(depth - 1, Math.max(0, (z + margin) * sub - 0.5))
    const i0 = Math.min(width - 2, Math.floor(fi))
    const j0 = Math.min(depth - 2, Math.floor(fj))
    const tx = fi - i0
    const tz = fj - j0
    const h00 = heights[j0 * width + i0]
    const h10 = heights[j0 * width + i0 + 1]
    const h01 = heights[(j0 + 1) * width + i0]
    const h11 = heights[(j0 + 1) * width + i0 + 1]
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz
  }

  return {
    geometry,
    water: buildWater(level),
    underside: buildUnderside(grid, heights, width, depth, sampleX, sampleZ),
    width,
    depth,
    heightAt,
  }
}

export function terrainChunks(terrain: Terrain, rows: number, chunkRows: number): TerrainChunk[] {
  const { sub, margin } = TERRAIN
  const source = terrain.geometry
  const index = source.getIndex()
  if (!index) return [{ geometry: source, near: -margin, far: rows + margin }]
  const cellsPerRow = terrain.width - 1
  const chunks: TerrainChunk[] = []
  const count = Math.ceil(rows / chunkRows)
  for (let k = 0; k < count; k++) {
    const firstRow = k === 0 ? 0 : (k * chunkRows + margin) * sub
    const lastRow = k === count - 1 ? terrain.depth - 1 : (Math.min(rows, (k + 1) * chunkRows) + margin) * sub
    if (lastRow <= firstRow) continue
    const geometry = new THREE.BufferGeometry()
    for (const name of Object.keys(source.attributes)) geometry.setAttribute(name, source.getAttribute(name))
    geometry.setIndex(new THREE.BufferAttribute((index.array as Uint32Array).slice(firstRow * cellsPerRow * 6, lastRow * cellsPerRow * 6), 1))
    const box = new THREE.Box3()
    const position = source.getAttribute('position')
    const point = new THREE.Vector3()
    for (let j = firstRow; j <= lastRow; j++) {
      for (let i = 0; i < terrain.width; i += 3) box.expandByPoint(point.fromBufferAttribute(position, j * terrain.width + i))
      box.expandByPoint(point.fromBufferAttribute(position, j * terrain.width + terrain.width - 1))
    }
    geometry.boundingBox = box
    geometry.boundingSphere = box.getBoundingSphere(new THREE.Sphere())
    chunks.push({ geometry, near: k === 0 ? -margin : k * chunkRows, far: k === count - 1 ? rows + margin : (k + 1) * chunkRows })
  }
  return chunks
}

function cellTexture(grid: Grid, fill: (column: number, row: number, out: number[]) => void): THREE.DataTexture {
  const data = new Uint8Array(grid.columns * grid.rows * 4)
  const out = [0, 0, 0, 0]
  for (let row = 0; row < grid.rows; row++) {
    for (let column = 0; column < grid.columns; column++) {
      fill(column, row, out)
      data.set(out.map((value) => Math.round(Math.min(1, Math.max(0, value)) * 255)), (row * grid.columns + column) * 4)
    }
  }
  const texture = new THREE.DataTexture(data, grid.columns, grid.rows, THREE.RGBAFormat)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.generateMipmaps = false
  texture.colorSpace = THREE.NoColorSpace
  texture.needsUpdate = true
  return texture
}

const DRY_THEMES: ReadonlySet<Theme> = new Set(['arena', 'village', 'factory'])

export function platformSurfaceOf(level: BuiltLevel, column: number, row: number): PlatformDef['surface'] | undefined {
  const area = level.areas[level.areaOfRow[row]]
  if (!area) return
  const localRow = row - area.top
  return area.scenery?.platforms?.find((region) => regionContainsCell(region, column, localRow))?.surface
}

export function terrainMasks(level: BuiltLevel): { a: THREE.DataTexture; b: THREE.DataTexture; c: THREE.DataTexture } {
  const { grid } = level
  const color = new THREE.Color()
  const paved = (tile: Tile) => tile === Tile.Path || tile === Tile.Exit || tile === Tile.Gate || tile === Tile.GateClosed
  const a = cellTexture(grid, (column, row, out) => {
    color.set(PALETTES[themeOf(level, row)].floorA)
    out[0] = color.r
    out[1] = color.g
    out[2] = color.b
    out[3] = paved(tileAt(grid, column, row)) || barnPartAt(level, column, row) === 'interior' ? 1 : 0
  })
  const b = cellTexture(grid, (column, row, out) => {
    const theme = themeOf(level, row)
    color.set(PALETTES[theme].path)
    out[0] = color.r
    out[1] = color.g
    out[2] = color.b
    out[3] = tileAt(grid, column, row) === Tile.Bush && theme === 'farm' ? 1 : 0
  })
  const c = cellTexture(grid, (column, row, out) => {
    const surface = platformSurfaceOf(level, column, row)
    out[0] = tileAt(grid, column, row) === Tile.Water ? 1 : 0
    out[1] = DRY_THEMES.has(themeOf(level, row)) ? 1 : 0
    out[2] = surface === 'wood' ? 1 : 0
    out[3] = surface === 'straw' ? 1 : 0
  })
  return { a, b, c }
}

const NOISE = /* glsl */ `
float terrainHash(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float terrainNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(terrainHash(i), terrainHash(i + vec2(1.0, 0.0)), f.x), mix(terrainHash(i + vec2(0.0, 1.0)), terrainHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`

const GROUND_HEAD = /* glsl */ `
uniform sampler2D terrainA;
uniform sampler2D terrainB;
uniform sampler2D terrainC;
uniform sampler2D terrainGrass;
uniform sampler2D terrainGravel;
uniform sampler2D terrainBank;
uniform sampler2D terrainStubble;
uniform sampler2D terrainPlanks;
uniform sampler2D terrainBales;
uniform vec2 terrainSize;
uniform vec3 terrainSoil;
uniform vec3 terrainBankColor;
uniform vec3 terrainCliff;
uniform vec3 terrainDeckColor;
uniform vec3 terrainBaleColor;
${NOISE}
vec3 terrainColor(vec3 world, vec3 normal) {
  vec2 cell = world.xz / terrainSize;
  vec4 a = texture2D(terrainA, cell);
  vec4 b = texture2D(terrainB, cell);
  vec4 c = texture2D(terrainC, cell);
  if (c.b > 0.5) {
    vec2 woodUV = normal.y < 0.72 ? vec2(world.y * 0.85, (world.x + world.z) * 0.2) : vec2(world.z, world.x * 0.25);
    return terrainDeckColor * texture2D(terrainPlanks, woodUV).rgb;
  }
  if (c.a > 0.5) {
    vec2 baleUV = normal.y < 0.72 ? vec2((world.x + world.z) * 0.25, (world.y - 1.0) * 0.5) : world.xz * 0.35;
    return terrainBaleColor * texture2D(terrainBales, baleUV).rgb;
  }
  float warp = terrainNoise(world.xz * 0.45) - 0.5;
  float fine = terrainNoise(world.xz * 2.1 + 3.7) - 0.5;
  float path = smoothstep(0.42, 0.58, a.a + warp * 0.45 + fine * 0.14);
  float field = smoothstep(0.4, 0.6, b.a + warp * 0.3);
  float patchy = terrainNoise(world.xz * 0.13 + 7.0);
  float dry = smoothstep(0.55, 0.85, terrainNoise(world.xz * 0.05 + 31.0));
  vec3 grass = a.rgb * (0.9 + patchy * 0.2);
  grass = mix(grass, grass * vec3(1.1, 1.04, 0.8), dry * 0.55);
  float tufts = texture2D(terrainGrass, world.xz * 0.4).r;
  float stubble = texture2D(terrainStubble, world.xz * vec2(0.45, 0.6)).r;
  grass *= mix(mix(1.0, tufts, 0.45 + patchy * 0.55), stubble, c.g);
  float furrow = smoothstep(-0.35, 0.35, sin(world.x * 15.7 + warp * 2.5));
  vec3 soil = terrainSoil * (0.86 + 0.2 * furrow);
  vec3 ground = mix(grass, soil, field);
  float gravel = texture2D(terrainGravel, world.xz * 0.32).r;
  vec3 dirt = b.rgb * (0.93 + terrainNoise(world.xz * 0.7) * 0.14) * gravel;
  float edge = 1.0 - abs(path * 2.0 - 1.0);
  ground *= 1.0 - 0.12 * edge;
  vec3 color = mix(ground, dirt, path);
  float steep = 1.0 - smoothstep(0.55, 0.85, normal.y);
  float cliff = 1.0 - smoothstep(0.2, 0.5, normal.y);
  float strata = texture2D(terrainBank, vec2((world.x + world.z) * 0.35, world.y * 0.55)).r;
  vec3 side = mix(terrainBankColor, terrainCliff, cliff) * strata;
  return mix(color, side, steep);
}
`

const WATER_HEAD = /* glsl */ `
uniform sampler2D terrainC;
uniform vec2 terrainSize;
uniform float waterTime;
${NOISE}
vec3 waterColor(vec3 world, vec3 base) {
  vec2 p = world.xz;
  float wet = texture2D(terrainC, p / terrainSize).r;
  float drift = terrainNoise(p * 1.2 + vec2(waterTime * 0.3, 0.0)) - 0.5;
  float shore = 1.0 - smoothstep(0.62, 0.9, wet + drift * 0.3);
  float wave = sin(p.x * 1.7 - waterTime * 1.3 + sin(p.y * 1.9 + waterTime * 0.7) * 1.4 + drift * 3.0);
  float lines = smoothstep(0.88, 0.96, wave) * smoothstep(0.25, 0.6, terrainNoise(p * 0.7 + vec2(waterTime * 0.2, 0.0)));
  vec3 color = base * (0.9 + 0.16 * terrainNoise(p * 0.3 + vec2(waterTime * 0.06, 0.0)));
  color = mix(color, vec3(0.92, 0.97, 1.0), lines * 0.6);
  return mix(color, vec3(1.0), shore * 0.75);
}
`

export function createTerrainMaterials(level: BuiltLevel): TerrainMaterials {
  const masks = terrainMasks(level)
  const size = new THREE.Vector2(level.grid.columns, level.grid.rows)
  const time = { value: 0 }
  const ground = new THREE.MeshToonMaterial({ gradientMap: toonGradient() })
  ground.name = 'terrain'
  const groundUniforms = {
    terrainA: { value: masks.a },
    terrainB: { value: masks.b },
    terrainC: { value: masks.c },
    terrainGrass: { value: lineTexture('grass') },
    terrainGravel: { value: lineTexture('gravel') },
    terrainBank: { value: lineTexture('bank') },
    terrainStubble: { value: lineTexture('stubble') },
    terrainPlanks: { value: lineTexture('wood') },
    terrainBales: { value: lineTexture('bales') },
    terrainSize: { value: size },
    terrainSoil: { value: SOIL },
    terrainBankColor: { value: BANK },
    terrainCliff: { value: CLIFF },
    terrainDeckColor: { value: new THREE.Color('#9c693f') },
    terrainBaleColor: { value: new THREE.Color('#e1b96b') },
  }
  ground.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, groundUniforms)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GROUND_HEAD}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = terrainColor(inkWorldPosition, normalize(inkWorldNormal));')
  }
  ground.customProgramCacheKey = () => 'terrain-ground'
  inkify(ground)

  const water = new THREE.MeshToonMaterial({ gradientMap: toonGradient(), vertexColors: true, emissive: '#0b3a5a', emissiveIntensity: 0.35 })
  water.name = 'water'
  const waterUniforms = { terrainC: { value: masks.c }, terrainSize: { value: size }, waterTime: time }
  water.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, waterUniforms)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${WATER_HEAD}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = waterColor(inkWorldPosition, diffuseColor.rgb);')
  }
  water.customProgramCacheKey = () => 'terrain-water'
  inkify(water)

  const underside = inkify(new THREE.MeshToonMaterial({ gradientMap: toonGradient(), color: UNDERSIDE, map: lineTexture('rock') }))
  underside.name = 'underside'

  return {
    ground,
    water,
    underside,
    update(dt) {
      time.value += dt
    },
    dispose() {
      ground.dispose()
      water.dispose()
      underside.dispose()
      masks.a.dispose()
      masks.b.dispose()
      masks.c.dispose()
    },
  }
}
