import { describe, expect, it } from 'vitest'
import { CLUES, CLUE_ORDER, isClueId } from './clues'
import { LEVEL_1_1 } from './levels/level-1-1'
import { LEVEL_1_2 } from './levels/level-1-2'
import { LEVEL_1_3 } from './levels/level-1-3'
import { LEVEL_1_4 } from './levels/level-1-4'
import { LEVEL_1_5 } from './levels/level-1-5'

describe('clues', () => {
  it('lists every clue once with a title and a short note', () => {
    expect([...CLUE_ORDER].sort()).toEqual(Object.keys(CLUES).sort())
    for (const id of CLUE_ORDER) {
      expect(CLUES[id].title.length, id).toBeGreaterThan(0)
      expect(CLUES[id].text.length, id).toBeGreaterThan(0)
      expect(CLUES[id].text.length, id).toBeLessThanOrEqual(60)
    }
    expect(isClueId('iou')).toBe(true)
    expect(isClueId('crayon')).toBe(false)
  })

  it('hides each clue exactly once, in the level it belongs to', () => {
    const placed = [LEVEL_1_1, LEVEL_1_2, LEVEL_1_3, LEVEL_1_4, LEVEL_1_5].flatMap((level) =>
      level.areas.flatMap((area) => (area.clues ?? []).map((clue) => ({ id: clue.id, level: level.id }))),
    )
    expect(placed.map((item) => item.id).sort()).toEqual([...CLUE_ORDER].sort())
    for (const item of placed) expect(CLUES[item.id].level).toBe(item.level)
    expect(CLUES['star-altar'].title).toBe('刻星的石台')
    expect(CLUES.iou.title).toBe('借条')
    expect(CLUES.manifest).toMatchObject({ title: '运粮单', level: '1-3', chapter: 1 })
    expect(CLUES.manifest.text).toContain('锈锚')
    expect(CLUES.drawing).toMatchObject({ title: '蜡笔画', level: '1-4', chapter: 1 })
    expect(CLUES.drawing.text).toContain('爸爸早点回家')
    expect(CLUES['anchor-crate']).toMatchObject({ title: '船锚货箱', level: '1-5', chapter: 1 })
    expect(CLUES['anchor-crate'].text).toBe('传送带上的货箱都印着同一个船锚，和借条落款、运粮单上的一样。飞艇要把整片麦田运去同一个地方。')
    expect(CLUE_ORDER.filter((id) => CLUES[id].chapter === 1)).toHaveLength(5)
  })
})
