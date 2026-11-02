import { describe, expect, it } from 'vitest'
import { CHAPTERS, chapterOf } from './chapters'
import { LEVEL_1_1 } from './levels/level-1-1'
import { LEVEL_1_2 } from './levels/level-1-2'
import { LEVEL_1_3 } from './levels/level-1-3'
import { LEVEL_1_4 } from './levels/level-1-4'
import { LEVEL_1_5 } from './levels/level-1-5'

describe('chapters', () => {
  it('lists the five chapters in order with their names from the story', () => {
    expect(CHAPTERS.map((chapter) => [chapter.id, chapter.name, chapter.title])).toEqual([
      [1, '晨风镇', '借麦子的强盗'],
      [2, '赤砂矿坑', '地下的救援'],
      [3, '霜牙要塞', '守望者'],
      [4, '熔炉工厂', '炉火与白光'],
      [5, '天穹', '碎了的星'],
    ])
    expect(chapterOf(3).name).toBe('霜牙要塞')
    expect(() => chapterOf(6)).toThrow()
  })

  it('puts the five story levels of chapter 1 in it, leaves the trials out and the later chapters empty for now', () => {
    const levels = [LEVEL_1_1, LEVEL_1_2, LEVEL_1_3, LEVEL_1_4, LEVEL_1_5]
    expect(chapterOf(1).levels).toEqual(levels.map((level) => level.id))
    for (const level of levels) expect(level.chapter).toBe(1)
    for (const chapter of CHAPTERS.slice(1)) expect(chapter.levels).toEqual([])
  })
})
