import * as THREE from 'three'
import type { PlatformDef } from '../data/levels/types'
import { insideGrid } from '../sim/grid'
import type { AreaInfo, BuiltLevel } from '../sim/level'
import { Mesher, type Building } from './buildings'
import { lineTexture } from './line-textures'
import { toonMaterial } from './toon'

type Frame = NonNullable<PlatformDef['frame']>
type FramedPlatform = PlatformDef & { frame: Frame }
type DeckHeights = readonly [northWest: number, northEast: number, southWest: number, southEast: number]

const flatDeck = (height: number): DeckHeights => [height, height, height, height]

export function deckHeightAt(heights: DeckHeights, x: number, z: number): number {
  const [nw, ne, sw, se] = heights
  const north = nw + (ne - nw) * x
  const south = sw + (se - sw) * x
  return north + (south - north) * z
}

export function framedPlatformCells(level: BuiltLevel): Map<number, FramedPlatform> {
  const cells = new Map<number, FramedPlatform>()
  const { columns, floor } = level.grid
  for (const area of level.areas) {
    for (const platform of area.scenery?.platforms ?? []) {
      if (!platform.frame) continue
      const framed = { ...platform, frame: platform.frame }
      for (let row = platform.from[1]; row <= platform.to[1]; row++) {
        for (let column = platform.from[0]; column <= platform.to[0]; column++) {
          const index = (area.top + row) * columns + column
          if (floor[index] > framed.frame.base) cells.set(index, framed)
        }
      }
    }
  }
  return cells
}

export function platformHeights(level: BuiltLevel, index: number, platform: FramedPlatform): DeckHeights {
  const { columns, floor } = level.grid
  const top = floor[index]
  const { ramp, base } = platform.frame
  if (!ramp) return flatDeck(top)
  const row = Math.floor(index / columns)
  const axis = ramp === 'north' ? 1 : 0
  const at = axis === 1 ? row - level.areas[level.areaOfRow[row]].top : index % columns
  const downhill = ramp === 'north' ? -columns : ramp === 'west' ? -1 : 1
  const foot = ramp === 'east' ? platform.to[axis] : platform.from[axis]
  const crest = ramp === 'east' ? platform.from[axis] : platform.to[axis]
  const low = at === foot ? base : (floor[index + downhill] + top) / 2
  const high = at === crest ? floor[index - downhill] : (floor[index - downhill] + top) / 2
  if (ramp === 'north') return [low, low, high, high]
  return ramp === 'west' ? [low, high, low, high] : [high, low, high, low]
}

const EDGES = [
  { dx: 0, dz: -1, from: [1, 0], to: [0, 0] },
  { dx: 1, dz: 0, from: [1, 1], to: [1, 0] },
  { dx: 0, dz: 1, from: [0, 1], to: [1, 1] },
  { dx: -1, dz: 0, from: [0, 0], to: [0, 1] },
] as const

const UP = new THREE.Vector3(0, 1, 0)
const axes = { x: (point: THREE.Vector3) => point.x, y: (point: THREE.Vector3) => point.y, z: (point: THREE.Vector3) => point.z }

const MATERIAL = {
  boards: { color: '#c49760', texture: 'wood' },
  lip: { color: '#e1ba83', texture: 'wood' },
  timber: { color: '#8c6548', texture: 'wood' },
  brace: { color: '#c19668', texture: 'wood' },
  stone: { color: '#9e8b73', texture: 'stone' },
  capstone: { color: '#cbbb9d', texture: 'stone' },
  straw: { color: '#dfb052', texture: 'stubble' },
  rope: { color: '#906239', texture: 'stubble' },
  steel: { color: '#747b6b', texture: 'metal' },
  seam: { color: '#66442f', texture: 'wood' },
} as const

type Part = keyof typeof MATERIAL

function deck(mesh: Mesher, x: number, z: number, heights: DeckHeights, from = 0, to = 1, near = 0, far = 1): void {
  const riseX = heights[1] - heights[0]
  const riseZ = heights[2] - heights[0]
  const normal = riseX === 0 && riseZ === 0 ? UP : new THREE.Vector3(-riseX, 1, -riseZ).normalize()
  const point = (u: number, v: number) => new THREE.Vector3(x + u, deckHeightAt(heights, u, v), z + v)
  mesh.face([
    point(from, near), point(from, far), point(to, far), point(to, near),
  ], normal, axes.x, axes.z)
}

function buildPlatforms(level: BuiltLevel, area: AreaInfo, cells: ReadonlyMap<number, FramedPlatform>): Building | null {
  const meshers = new Map<Part, Mesher>()
  const part = (name: Part) => {
    let mesh = meshers.get(name)
    if (!mesh) {
      mesh = new Mesher(name === 'stone' || name === 'capstone' ? 0.85 : 0.55)
      meshers.set(name, mesh)
    }
    return mesh
  }
  const { columns, floor } = level.grid
  for (const [index, platform] of cells) {
    const row = Math.floor(index / columns)
    if (row < area.top || row >= area.bottom) continue
    const x = index % columns
    const top = floor[index]
    const heights = platformHeights(level, index, platform)
    const { base, trim, ramp } = platform.frame
    const straw = platform.surface === 'straw'
    const stone = platform.surface === 'stone'
    const masonry = stone || trim === 'stone' || trim === 'steel'
    deck(part(straw ? 'straw' : stone ? 'capstone' : 'boards'), x, row, heights)
    if (trim === 'steel' && top - base >= 1) deck(part('steel'), x, row, flatDeck(top + 0.003), 0.08, 0.92, 0.08, 0.92)
    const straps = trim === 'straps'
      ? [0.28, 0.72].map((fraction) => platform.from[0] + (platform.to[0] - platform.from[0] + 1) * fraction - x)
      : []
    for (const strap of straps) {
      const from = Math.max(0, strap - 0.045)
      const to = Math.min(1, strap + 0.045)
      if (from < to) deck(part(straw ? 'rope' : 'steel'), x, row, flatDeck(top + 0.005), from, to)
    }

    for (const { dx, dz, from, to } of EDGES) {
      const neighbor = index + dx + dz * columns
      const adjoining = insideGrid(level.grid, x + dx, row + dz) ? cells.get(neighbor) : undefined
      const support = base - 0.35
      const neighborHeights = adjoining ? platformHeights(level, neighbor, adjoining) : flatDeck(support)
      const upperA = deckHeightAt(heights, from[0], from[1])
      const upperB = deckHeightAt(heights, to[0], to[1])
      const lowerA = Math.min(upperA, Math.max(support, deckHeightAt(neighborHeights, from[0] - dx, from[1] - dz)))
      const lowerB = Math.min(upperB, Math.max(support, deckHeightAt(neighborHeights, to[0] - dx, to[1] - dz)))
      if (lowerA === upperA && lowerB === upperB) continue
      const normal = new THREE.Vector3(dx, 0, dz)
      const point = (along: number, y: number, outset = 0) => new THREE.Vector3(
        x + from[0] + (to[0] - from[0]) * along + dx * outset,
        y,
        row + from[1] + (to[1] - from[1]) * along + dz * outset,
      )
      const panel = (name: Part, [a, b, c, d]: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3]) =>
        part(name).face([a, b, c, d], normal, dx === 0 ? axes.x : axes.z, axes.y)
      const lipA = straw ? upperA : Math.max(lowerA, upperA - 0.16)
      const lipB = straw ? upperB : Math.max(lowerB, upperB - 0.16)
      panel(straw ? 'straw' : masonry ? 'stone' : 'timber', [point(0, lowerA), point(1, lowerB), point(1, lipB), point(0, lipA)])
      if (!straw) panel(stone ? 'capstone' : 'lip', [point(0, lipA), point(1, lipB), point(1, upperB), point(0, upperA)])
      const foot = Math.max(base - 0.02, lowerA, lowerB)
      if (!masonry && !straw && !ramp && trim !== 'straps' && top - foot >= 0.75 && (x + row) % 2 === 0) {
        panel('brace', [point(0.07, foot, 0.005), point(0.19, foot, 0.005), point(0.19, top, 0.005), point(0.07, top, 0.005)])
        panel('brace', [point(0.19, foot, 0.005), point(0.33, foot, 0.005), point(0.9, lipB, 0.005), point(0.75, lipA, 0.005)])
      }
      if (trim === 'straps' && !straw) {
        for (const seam of [base + 0.27, base + 0.55]) {
          if (seam <= foot) continue
          panel('seam', [point(0, seam, 0.006), point(1, seam, 0.006), point(1, seam + 0.045, 0.006), point(0, seam + 0.045, 0.006)])
        }
      }
      if (dz === 0) continue
      for (const strap of straps) {
        const center = dz > 0 ? strap : 1 - strap
        const a = Math.max(0, center - 0.045)
        const b = Math.min(1, center + 0.045)
        if (a >= b) continue
        panel(straw ? 'rope' : 'steel', [point(a, lowerA, 0.008), point(b, lowerB, 0.008), point(b, top, 0.008), point(a, top, 0.008)])
      }
    }
  }
  if (meshers.size === 0) return null
  const group = new THREE.Group()
  group.name = 'framed-platforms'
  const meshes = [...meshers].map(([name, mesher]) => {
    const style = MATERIAL[name]
    const mesh = new THREE.Mesh(mesher.build(), toonMaterial({ color: style.color, map: lineTexture(style.texture) }))
    mesh.name = name
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
    return mesh
  })
  return {
    group,
    dispose() {
      group.removeFromParent()
      for (const mesh of meshes) {
        mesh.geometry.dispose()
        mesh.material.dispose()
      }
    },
  }
}

export function buildLevelPlatforms(level: BuiltLevel, cells: ReadonlyMap<number, FramedPlatform>) {
  return level.areas.flatMap((area) => {
    const building = buildPlatforms(level, area, cells)
    return building ? [{ ...building, near: area.top, far: area.bottom }] : []
  })
}
