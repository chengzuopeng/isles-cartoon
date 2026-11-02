import { describe, expect, it } from 'vitest'
import { CONVEYOR } from '../data/conveyors'
import { LEVEL_1_5 } from '../data/levels/level-1-5'
import { TRIAL_HARVESTER } from '../data/levels/trial-harvester'
import { buildLevel } from '../sim/level'
import { levelFromAreas } from '../sim/testing'
import { beltStrips, cargoItems, cargoTracks, climbAt, normalBelts, presence, roundedTrack, trackCapacity, trackPoint, type CargoItem, type CargoTrack } from './belt-cargo'
import { BELT_CARGO } from './themes'

const level = buildLevel(LEVEL_1_5)
const hall = level.areas.findIndex((area) => area.name === '分拣车间')
const top = level.areas[hall].top
const airship = level.landmarks.find((placement) => placement.id === 'ch1-airship')
const ramp = BELT_CARGO.decks['ch1-airship'] ?? 0

function deck(column: number, row: number): number | null {
  if (!airship) return null
  const inside = column >= airship.column && column < airship.column + airship.width && row >= airship.row && row < airship.row + airship.depth
  return inside ? BELT_CARGO.decks['ch1-airship'] ?? null : null
}

function items(track: CargoTrack, seed: number, time: number): CargoItem[] {
  const found: CargoItem[] = []
  cargoItems(track, seed, time, CONVEYOR.speed, (item) => found.push(item))
  return found
}

describe('conveyor strips', () => {
  it('splits the running belts of the sorting hall into the eastward, northward and westward strips', () => {
    const strips = beltStrips(level.grid, normalBelts(level))
    const summary = strips.map(({ dx, dy, x0, x1, y0, y1 }) => ({ dx, dy, x0, x1, y0: y0 - top, y1: y1 - top })).sort((a, b) => a.y0 - b.y0)
    expect(summary).toEqual([
      { dx: -1, dy: 0, x0: 5, x1: 28, y0: 6, y1: 7 },
      { dx: 0, dy: -1, x0: 33, x1: 34, y0: 13, y1: 17 },
      { dx: 1, dy: 0, x0: 3, x1: 32, y0: 16, y1: 17 },
    ])
  })

  it('leaves the boss arena belts to the boss: no running belts and no cargo in the harvester trial', () => {
    const trial = buildLevel(TRIAL_HARVESTER)
    expect(trial.conveyors.length).toBeGreaterThan(0)
    expect(normalBelts(trial)).toEqual([])
    expect(cargoTracks(trial)).toEqual([])
    expect(normalBelts(level).length).toBe(level.conveyors.length - 30)
  })
})

describe('cargo tracks', () => {
  it('runs the south belt out of the west sorter, round the corner and up the ramp to the airship hatch', () => {
    const tracks = cargoTracks(level, deck)
    expect(tracks).toHaveLength(2)
    const south = tracks.find((track) => track.end === 'door')
    if (!south) throw new Error('no track ends at the hatch')
    expect(south.start).toBe('machine')
    expect(trackPoint(south, 0)).toMatchObject({ x: 2.5, y: top + 17, angle: 0 })
    const end = trackPoint(south, south.length)
    expect(end.x).toBeCloseTo(34)
    expect(end.y).toBeCloseTo(top + 10.5)
    expect(end.angle).toBeCloseTo(-Math.PI / 2)
    expect(south.length).toBeCloseTo(31.5 + 6.5 - (2 - Math.PI / 2), 6)
    expect(south.enter).toBe(0)
    expect(south.leave).toBeCloseTo(south.length - BELT_CARGO.grow)
    expect(south.climb).toEqual({ from: south.length - 2.5, to: south.length - 0.5, height: ramp })
    const corner = trackPoint(south, 30.5 + Math.PI / 4)
    expect(corner.angle).toBeCloseTo(-Math.PI / 4)
    expect(Math.hypot(corner.x - 33, corner.y - (top + 16))).toBeCloseTo(1)
    const belts = new Set(level.conveyors.map((item) => item.index))
    for (let s = 0.55; s < south.length - 2.55; s += 0.25) {
      const point = trackPoint(south, s)
      expect(belts.has(Math.floor(point.y) * level.grid.columns + Math.floor(point.x))).toBe(true)
    }
  })

  it('only climbs the ramp when there is an airship model to climb', () => {
    const south = cargoTracks(level).find((track) => track.end === 'door')
    expect(south?.climb).toBeNull()
    const climbing = cargoTracks(level, deck).find((track) => track.end === 'door')
    if (!climbing) throw new Error('no track ends at the hatch')
    expect(climbAt(climbing, climbing.length - 3)).toBe(0)
    expect(climbAt(climbing, climbing.length - 1.5)).toBeCloseTo(ramp / 2)
    expect(climbAt(climbing, climbing.length)).toBeCloseTo(ramp)
  })

  it('drops cargo onto the open east end of the north belt and lets the west sorter swallow it', () => {
    const north = cargoTracks(level, deck).find((track) => track.end === 'machine')
    if (!north) throw new Error('no track ends in a machine')
    expect(north.start).toBe('open')
    expect(trackPoint(north, 0)).toMatchObject({ x: 29, y: top + 7, angle: Math.PI })
    expect(trackPoint(north, north.length).x).toBeCloseTo(4.5)
    expect(north.leave).toBe(north.length)
    expect(presence(north, 0)).toBe(0)
    expect(presence(north, north.enter)).toBe(1)
    expect(presence(north, north.length)).toBe(1)
  })

  it('rounds a right-angled corner into a quarter circle and keeps straight runs straight', () => {
    const { segments, length } = roundedTrack(
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
      ],
      1,
    )
    expect(segments.map((segment) => segment.kind)).toEqual(['line', 'arc', 'line'])
    expect(length).toBeCloseTo(6 + Math.PI / 2)
    const middle = trackPoint({ segments, length }, 3 + Math.PI / 4)
    expect(middle.angle).toBeCloseTo(Math.PI / 4)
    expect(Math.hypot(middle.x - 3, middle.y - 1)).toBeCloseTo(1)
    expect(roundedTrack([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 5, y: 0 }], 1).segments.map((segment) => segment.kind)).toEqual(['line', 'line'])
  })

  it('makes a lone belt between open floor a track that grows its cargo in and shrinks it out', () => {
    const lone = levelFromAreas([{ name: 'yard', theme: 'factory', rows: ['########', '#P.....#', '#.>>>>.#', '#......#', '########'] }])
    const [track] = cargoTracks(lone)
    expect(track).toMatchObject({ start: 'open', end: 'open', climb: null })
    expect(track.length).toBe(4)
    expect(presence(track, 0)).toBe(0)
    expect(presence(track, 2)).toBe(1)
    expect(presence(track, 4)).toBe(0)
  })
})

describe('cargo on the belts', () => {
  const tracks = cargoTracks(level, deck)
  const north = tracks.find((track) => track.end === 'machine') as CargoTrack
  const south = tracks.find((track) => track.end === 'door') as CargoTrack

  it('is the same for the same time and spaced so that two loads never overlap', () => {
    for (const track of [north, south]) {
      const now = items(track, 3, 12.5)
      expect(now).toEqual(items(track, 3, 12.5))
      expect(now.length).toBeGreaterThan(track.length / BELT_CARGO.gap / 2)
      expect(now.length).toBeLessThanOrEqual(trackCapacity(track))
    }
    for (let t = 0; t < 40; t += 0.7) {
      const along = items(north, 3, t)
        .map((item) => 29 - item.x)
        .sort((a, b) => a - b)
      for (let i = 1; i < along.length; i++) expect(along[i] - along[i - 1]).toBeGreaterThan(BELT_CARGO.gap - 2 * BELT_CARGO.jitter - 1e-9)
    }
  })

  it('moves every load along the belt at the belt speed, mixing wheat bales and anchor crates', () => {
    const before = items(north, 1, 20)
    const after = items(north, 1, 20.1)
    const shift = CONVEYOR.speed * 0.1
    const inner = before.filter((item) => item.x < 27 && item.x > 6)
    expect(inner.length).toBeGreaterThan(3)
    for (const item of inner) {
      const moved = after.find((other) => Math.abs(other.x - (item.x - shift)) < 1e-6)
      expect(moved?.kind).toBe(item.kind)
      expect(moved?.y).toBeCloseTo(item.y)
    }
    const kinds = new Set<string>()
    for (let t = 0; t < 30; t += 1) for (const item of items(north, 1, t)) kinds.add(item.kind)
    expect([...kinds].sort()).toEqual(['bale', 'crate'])
  })

  it('shrinks the loads away at the airship hatch and lifts them up the ramp', () => {
    let lastScale = Infinity
    let highest = 0
    for (let t = 0; t < 20; t += 0.05) {
      for (const item of items(south, 2, t)) {
        if (item.y < top + 11) lastScale = Math.min(lastScale, item.scale)
        highest = Math.max(highest, item.height)
      }
    }
    expect(lastScale).toBeLessThan(BELT_CARGO.scale * 0.6)
    expect(highest).toBeCloseTo(BELT_CARGO.surface + ramp, 1)
  })
})
