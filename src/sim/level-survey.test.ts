import { describe, expect, it } from 'vitest'
import { LEVEL_1_1 } from '../data/levels/level-1-1'
import { walled, type LevelDef } from '../data/levels/types'
import { surveyLevel, surveyStats } from './level-survey'

const ROOM: LevelDef = {
  id: 'survey-room',
  title: '测量用的小房间',
  subtitle: '',
  objective: '',
  chapter: 1,
  parSeconds: 60,
  maxHits: 3,
  areas: [
    {
      name: '房间',
      theme: 'farm',
      rows: walled(
        12,
        '####XX####',
        '####DD####',
        '.......m..',
        '.m........',
        '.....#####',
        '..........',
        '.....O....',
        '....P.....',
      ),
    },
  ],
}

describe('surveying a level', () => {
  const survey = surveyLevel(ROOM)
  const stats = surveyStats(survey)

  it('copies the grid, the start and what stands on it', () => {
    expect([survey.columns, survey.rows]).toEqual([12, 8])
    expect(survey.tiles).toHaveLength(96)
    expect(survey.start).toEqual({ x: 5.5, y: 7.5 })
    expect(survey.enemies.map((enemy) => [enemy.kind, enemy.x, enemy.y])).toEqual([
      ['grunt', 8.5, 2.5],
      ['grunt', 2.5, 3.5],
    ])
    expect(survey.exits).toHaveLength(2)
  })

  it('marks which ground and which enemies the start can see, eye at 1.5 metres', () => {
    expect(survey.spawnView.seen).toHaveLength(8)
    expect(survey.spawnView.seen[7].charAt(1)).toBe('1')
    expect(survey.spawnView.seen[2].charAt(9)).toBe('0')
    expect(survey.spawnView.seen[3].charAt(9)).toBe('0')
    expect(survey.spawnView.seen[2].charAt(2)).toBe('1')
    expect(survey.spawnView.enemies.map((item) => item.index)).toEqual([1])
    expect(stats.seen).toBe(1)
    expect(stats.enemies).toBe(2)
    expect(stats.share).toBeGreaterThan(0.5)
    expect(stats.share).toBeLessThan(1)
  })

  it('walks the shortest way to the exit, through the closed gate', () => {
    const [first] = survey.route
    const last = survey.route[survey.route.length - 1]
    expect(first).toEqual([5.5, 7.5])
    expect(last[1]).toBe(0.5)
    for (let index = 2; index < survey.route.length; index++) {
      const [ax, ay] = survey.route[index - 1]
      const [bx, by] = survey.route[index]
      expect(Math.abs(ax - bx) + Math.abs(ay - by)).toBe(1)
    }
    expect(stats.route).toBe(survey.route.length - 1)
    expect(stats.peak).toBeGreaterThanOrEqual(1)
  })

  it('goes by the cells it is told to pass', () => {
    const detour = surveyLevel(ROOM, { via: [[9, 5]] })
    expect(detour.route.some(([x, y]) => x === 9.5 && y === 5.5)).toBe(true)
    expect(detour.route.length).toBeGreaterThan(survey.route.length)
  })
})

describe('surveying level 1-1', () => {
  const stats = surveyStats(surveyLevel(LEVEL_1_1))

  it('shows no enemy and hardly any ground from the start, and passes validation', () => {
    expect([stats.columns, stats.rows]).toEqual([60, 210])
    expect(stats.seen).toBe(0)
    expect(stats.share).toBeLessThan(0.08)
    expect(stats.problems).toEqual([])
    expect(stats.wakeMax).toBeLessThanOrEqual(6)
    expect(stats.route).toBeGreaterThan(250)
  })
})
