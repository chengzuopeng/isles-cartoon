import { describe, expect, it } from 'vitest'
import { LEVEL_1_1 } from '../data/levels/level-1-1'
import { LEVEL_1_5 } from '../data/levels/level-1-5'
import { TRIAL_HARVESTER } from '../data/levels/trial-harvester'
import { createDefaultTuning } from '../data/tuning'
import { buildLevel, insideRegion } from '../sim/level'
import { createWorld } from '../sim/world'
import { beltArrows, bladeMark, mapMarks } from './map-overlay'

const level = buildLevel(LEVEL_1_5)
const [south, middle] = level.blades
const tutorial = buildLevel(LEVEL_1_1)

describe('map marks', () => {
  it('shows a question mark for chests in areas not visited yet, and keeps the hidden area chest off until it is found', () => {
    const world = createWorld(tutorial, createDefaultTuning())
    expect(world.areas[0].visited).toBe(false)
    const hidden = world.chests.findIndex((chest) => tutorial.secrets.some((region) => insideRegion(region, chest.pos.x, chest.pos.y)))
    expect(world.chests[hidden]).toMatchObject({ tier: 'rare', area: 1 })
    const chests = mapMarks(world).filter((mark) => mark.key.startsWith('chest-'))
    expect(chests.map((mark) => mark.key)).not.toContain(`chest-${hidden}`)
    expect(chests).toHaveLength(world.chests.length - 1)
    for (const mark of chests) {
      const chest = world.chests[Number(mark.key.slice('chest-'.length))]
      expect(mark.icon).toBe(chest.area === 0 ? `chest-${chest.tier}` : 'branch')
      expect(mark).toMatchObject({ x: chest.pos.x, y: chest.pos.y, done: false })
    }
    world.areas[1].visited = true
    world.secrets[0] = true
    world.chests[hidden].opened = true
    expect(mapMarks(world).find((mark) => mark.key === `chest-${hidden}`)).toMatchObject({ icon: 'chest-rare', done: true })
  })

  it('marks the supply points, the exit and the boss, and puts the star shard next to the chapter boss only', () => {
    const world = createWorld(tutorial, createDefaultTuning())
    world.supplies[0].used = true
    const marks = mapMarks(world)
    expect(marks.filter((mark) => mark.icon === 'supply').map((mark) => mark.done)).toEqual(world.supplies.map((_, index) => index === 0))
    const exit = marks.find((mark) => mark.key === 'exit')
    expect(exit?.y).toBeLessThan(tutorial.boss?.y ?? 0)
    expect(marks.find((mark) => mark.key === 'boss')).toMatchObject({ icon: 'boss', x: tutorial.boss?.x, y: tutorial.boss?.y, done: false })
    expect(marks.some((mark) => mark.icon === 'shard')).toBe(false)
    const finale = createWorld(level, createDefaultTuning())
    const harvester = finale.enemies.find((enemy) => enemy.kind === 'boss')
    expect(mapMarks(finale).find((mark) => mark.icon === 'shard')).toMatchObject({ done: false })
    if (harvester) harvester.hp = 0
    expect(mapMarks(finale).filter((mark) => mark.done).map((mark) => mark.key)).toEqual(expect.arrayContaining(['boss', 'shard']))
  })
})

describe('blade lanes on the map', () => {
  it('marks the whole lane, the blade as a 1 x 2 block and its front edge on the side it will sweep towards', () => {
    const mark = bladeMark(south, { pos: { ...south.from }, phase: 'rest', warning: 0, forward: true })
    expect(mark.lane).toEqual({ x: 1, y: south.row, width: 38, height: 2 })
    expect(mark.lit).toBeNull()
    expect(mark.blade).toEqual({ x: 1, y: south.row, width: 1, height: 2 })
    expect(mark.front).toEqual({ x1: 2, y1: south.row, x2: 2, y2: south.row + 2 })
    const east = bladeMark(middle, { pos: { ...middle.from }, phase: 'rest', warning: 0, forward: true })
    expect(east.front.x1).toBe(38)
  })

  it('fills the part of the lane that is lit while the blade warns or sweeps', () => {
    const warning = bladeMark(south, { pos: { ...south.from }, phase: 'warning', warning: south.warning / 2, forward: true })
    expect(warning.lit?.x).toBeCloseTo(1)
    expect(warning.lit?.width).toBeCloseTo(19)
    expect(warning.lit?.height).toBe(2)
    const sweeping = bladeMark(south, { pos: { x: 20, y: south.from.y }, phase: 'sweep', warning: 0, forward: true })
    expect(sweeping.lit).toEqual({ x: 20.5, y: south.row, width: 18.5, height: 2 })
    expect(sweeping.blade.x).toBeCloseTo(19.5)
  })
})

describe('belts on the map', () => {
  it('lists the running belts with their push direction and leaves the boss arena belts off', () => {
    const arrows = beltArrows(level)
    expect(arrows).toHaveLength(level.conveyors.length - 30)
    expect(new Set(arrows.map((arrow) => `${arrow.dx},${arrow.dy}`))).toEqual(new Set(['1,0', '-1,0', '0,-1']))
    expect(beltArrows(buildLevel(TRIAL_HARVESTER))).toEqual([])
  })
})
