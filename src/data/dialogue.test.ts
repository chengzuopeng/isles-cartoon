import { describe, expect, it } from 'vitest'
import { PORTRAIT_IDS } from '../render/asset-urls'
import { BOSSES } from './bosses'
import { CHAPTERS } from './chapters'
import { BARKS, BOSS_LINES, INTERLUDES, SPEAKERS, STORIES, type DialogueLine } from './dialogue'
import { LANDMARKS } from './landmarks'
import { LEVEL_1_1 } from './levels/level-1-1'
import { LEVEL_1_2 } from './levels/level-1-2'
import { LEVEL_1_3 } from './levels/level-1-3'
import { LEVEL_1_4 } from './levels/level-1-4'
import { LEVEL_1_5 } from './levels/level-1-5'
import { TRIAL_HARVESTER } from './levels/trial-harvester'

const MAX_LINES = 7
const MAX_CHARS = 48

function allLines(): DialogueLine[] {
  return [
    ...Object.values(STORIES).flatMap((story) => [...(story.intro ?? []), ...(story.boss ?? []), ...(story.outro ?? [])]),
    ...INTERLUDES.flatMap((interlude) => interlude.lines),
  ]
}

describe('dialogue', () => {
  it('only tells stories for levels that exist', () => {
    const levels = new Set([LEVEL_1_1.id, LEVEL_1_2.id, LEVEL_1_3.id, LEVEL_1_4.id, LEVEL_1_5.id, TRIAL_HARVESTER.id])
    for (const id of Object.keys(STORIES)) expect(levels.has(id), id).toBe(true)
    for (const id of Object.keys(BARKS)) expect(levels.has(id), id).toBe(true)
  })

  it('keeps every segment short', () => {
    for (const [id, story] of Object.entries(STORIES)) {
      for (const segment of [story.intro, story.boss, story.outro]) {
        if (!segment) continue
        const spoken = segment.filter((line) => !line.card)
        expect(spoken.length, id).toBeGreaterThan(0)
        expect(spoken.length, id).toBeLessThanOrEqual(MAX_LINES)
      }
    }
    for (const line of allLines()) expect(line.text.length, line.text).toBeLessThanOrEqual(MAX_CHARS)
  })

  it('has a portrait for every speaker and expression it uses', () => {
    const portraits = new Set<string>(PORTRAIT_IDS)
    for (const line of allLines()) {
      const speaker = SPEAKERS[line.speaker]
      if (!speaker.portrait) {
        expect(line.speaker, line.text).toBe('narrator')
        continue
      }
      const expression = line.expression ?? 'normal'
      expect(speaker.expressions, line.text).toContain(expression)
      expect(portraits.has(`${speaker.portrait}-${expression}`), line.text).toBe(true)
    }
  })

  it('only gives lines to bosses that exist', () => {
    for (const id of Object.keys(BOSS_LINES)) expect(BOSSES[id], id).toBeDefined()
  })

  it('tells 1-3 over Alo\'s radio and gives the shield captain its line', () => {
    const story = STORIES['1-3']
    expect(story.intro?.map((line) => line.speaker)).toEqual(['alo', 'kai', 'alo'])
    expect(story.intro?.[0].text).toBe('农庄被改成粮仓了。硬闯会惊动整个粮仓，试试从麦垛里摸进去。')
    expect(story.outro?.map((line) => line.speaker)).toEqual(['narrator', 'kai', 'alo'])
    expect(story.outro?.[0].text).toBe('铁盾队长倒下前，把盾牌立好，敬了个礼。')
    expect(BOSS_LINES['shield-captain']).toBe('……粮仓重地……队长在此……止步……')
  })

  it('follows the signal into the fog in 1-4 and lets the forest tank speak before the fight', () => {
    const story = STORIES['1-4']
    expect(story.intro?.map((line) => line.speaker)).toEqual(['alo', 'kai', 'alo'])
    expect(story.intro?.[0].text).toBe('雾里我也看不清，跟着信号走。看到琥珀色的光点，那是它们的眼灯。')
    expect(story.outro?.map((line) => line.speaker)).toEqual(['narrator', 'alo'])
    expect(story.outro?.[0].text).toBe('林地炮车冒着黑烟，倒车撤进了收割场。')
    expect(story.outro?.[1].text).toBe('碎片就在前面那座工厂里，信号很强。')
    expect(BOSS_LINES['forest-tank']).toBe('……伪装……完毕……开炮……')
    expect(SPEAKERS.bolt.portrait).toBe('bolt')
  })

  it('opens 1-5 with Kai and Alo, saves Captain Bolt for the moment the harvester shows up, and ends the chapter', () => {
    const story = STORIES['1-5']
    expect(story.intro?.map((line) => [line.speaker, line.text])).toEqual([
      ['kai', '它们要把整片麦田都收光！'],
      ['alo', '工厂里的读数……碎片被当成发动机用了。'],
      ['alo', '麦田里有自动收割刀，地上亮红线就是要扫过来了，先躲进麦丛。'],
    ])
    expect(story.boss).toEqual(STORIES['trial-harvester'].intro)
    expect(story.outro?.map((line) => line.speaker)).toEqual(['bolt', 'kai', 'alo', 'narrator', 'kai', 'alo', 'kai'])
    expect(story.outro?.slice(0, 3)).toEqual(STORIES['trial-harvester'].outro?.slice(0, 3))
    expect(story.outro?.[6]).toEqual(STORIES['trial-harvester'].outro?.[3])
    expect(story.outro?.[3].text).toBe('晨星在凯手里轻轻地往风车坡的方向拽了一下。')
    expect(BOSS_LINES.harvester).toBe('螺栓上尉：收割开始！一粒麦子都不留！')
    for (const [id, other] of Object.entries(STORIES)) if (id !== '1-5') expect(other.boss, id).toBeUndefined()
  })

  it('tells 1-2 with Lao Tang, who has a portrait', () => {
    const story = STORIES['1-2']
    expect(story.intro?.[0]).toMatchObject({ speaker: 'laoTang', text: '它们把干草和麦子都装车了！' })
    expect(story.outro?.map((line) => line.speaker)).toEqual(['narrator', 'kai', 'alo'])
    expect(SPEAKERS.laoTang).toMatchObject({ name: '老汤', portrait: 'lao-tang', side: 'right', radio: false })
    expect(BOSS_LINES['demo-chief']).toBe('……爆破作业……闲人……退后……')
  })

  it('keeps barks short, unique and said by speakers with portraits', () => {
    const portraits = new Set<string>(PORTRAIT_IDS)
    for (const [level, barks] of Object.entries(BARKS)) {
      expect(new Set(barks.map((bark) => bark.id)).size, level).toBe(barks.length)
      for (const bark of barks) {
        expect(bark.text.length, bark.text).toBeLessThanOrEqual(MAX_CHARS)
        if (bark.display === 'bubble') {
          expect(bark.speaker, bark.id).toBeNull()
          expect(['spotted', 'runner'], bark.id).toContain(bark.trigger.on)
        } else {
          expect(bark.speaker, bark.id).not.toBeNull()
          const speaker = SPEAKERS[bark.speaker ?? 'narrator']
          if (speaker.portrait) expect(portraits.has(`${speaker.portrait}-normal`), bark.id).toBe(true)
        }
        if (bark.trigger.on === 'near') expect(LANDMARKS[bark.trigger.landmark], bark.id).toBeDefined()
        if (bark.trigger.on === 'after') expect(barks.map((item) => item.id), bark.id).toContain(bark.trigger.bark)
      }
    }
    expect(BARKS['1-3'].map((bark) => [bark.id, bark.display, bark.trigger.on])).toEqual([
      ['shieldBearer', 'bar', 'sees'],
      ['thief', 'bubble', 'runner'],
      ['bell', 'bar', 'alarm'],
      ['rustAnchor', 'bar', 'clue'],
    ])
    expect(BARKS['1-2'].map((bark) => bark.text)).toEqual([
      '抱歉！干草也借用一下！',
      '钱箱就在那儿，碰都没碰。',
      '这不是二十年前镇上买的耕地机吗？那时候有人开着船来卖，便宜又结实。',
    ])
  })

  it('opens 1-1 with the prologue, lets Greyhawk hint at the gun and ends on the chapter 1 title card', () => {
    const intro = STORIES['1-1'].intro ?? []
    expect(intro.map((line) => line.speaker)).toEqual(['narrator', 'auntMai', 'kai', 'greyhawk', 'greyhawk', 'alo', 'kai', 'narrator'])
    expect(intro[4].text).toBe('……这把枪欠一件对的事。')
    expect(intro.at(-1)).toEqual({ speaker: 'narrator', scene: 'chapter-1-title', card: { kicker: '第 1 章', title: CHAPTERS[0].name }, text: CHAPTERS[0].title })
    expect(allLines().filter((line) => line.card)).toHaveLength(1)
  })

  it('lets the 1-1 charger apologise, Kai answer back, Alo explain the red lines and Kai notice the star on the altar', () => {
    expect(BARKS['1-1'].map((bark) => [bark.id, bark.speaker, bark.display, bark.trigger])).toEqual([
      ['sorry', null, 'bubble', { on: 'spotted', area: 0, at: [5, 23] }],
      ['robbery', 'kai', 'bar', { on: 'after', bark: 'sorry', seconds: 1.2 }],
      ['aim', 'alo', 'bar', { on: 'enter', area: 1 }],
      ['altar', 'kai', 'bar', { on: 'clue', clue: 'star-altar' }],
    ])
  })

  it('plays interlude 1 in the Star Dome Tower once 1-5 is cleared, in 10 to 20 short lines', () => {
    expect(INTERLUDES.map((item) => [item.id, item.chapter, item.title, item.after])).toEqual([['interlude-1', 1, '初到星穹塔', '1-5']])
    const { lines } = INTERLUDES[0]
    expect(lines.length).toBeGreaterThanOrEqual(10)
    expect(lines.length).toBeLessThanOrEqual(20)
    expect(lines.filter((line) => line.speaker === 'mingzhu').length).toBeGreaterThanOrEqual(3)
    expect(lines.filter((line) => line.scene === 'chapter-1').length).toBeGreaterThan(0)
    expect(lines.filter((line) => line.speaker === 'alo').every((line) => line.radio === false)).toBe(true)
    expect(lines.some((line) => line.text.includes('光要省着用'))).toBe(true)
    expect(lines.some((line) => line.text.includes('码头'))).toBe(true)
    expect(lines.at(-2)).toMatchObject({ speaker: 'alo', text: '凯！第二块碎片的信号找到了，在赤砂矿坑！' })
    expect(SPEAKERS.mingzhu).toMatchObject({ name: '明烛长老', portrait: 'mingzhu', side: 'right', radio: false })
  })
})
