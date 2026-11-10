import { describe, expect, it } from 'vitest'
import { STREAK_WORDS, streakLabel, streakStep } from './sfx-words'

describe('streak words', () => {
  it('says nothing for a single kill', () => {
    expect(streakLabel(0)).toBeNull()
    expect(streakLabel(1)).toBeNull()
  })

  it('names short streaks and keeps a catch-all for long ones', () => {
    expect(streakLabel(2)).toBe('两连！')
    expect(streakLabel(5)).toBe('五连！')
    expect(streakLabel(9)).toBe(STREAK_WORDS.beyond)
  })

  it('grows the kill word step by step up to the cap', () => {
    expect(streakStep(1)).toBe(0)
    expect(streakStep(2)).toBe(1)
    expect(streakStep(4)).toBe(3)
    expect(streakStep(40)).toBe(STREAK_WORDS.cap)
  })
})
