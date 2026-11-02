import { describe, expect, it } from 'vitest'
import { eyeFaceOf } from './eye-faces'

describe('eye faces', () => {
  it('reads dazed first, then apologising, then fighting, then noticing', () => {
    expect(eyeFaceOf({ aggro: true, notice: 1, dazed: true, sorry: true })).toBe('dizzy')
    expect(eyeFaceOf({ aggro: true, notice: 1, dazed: false, sorry: true })).toBe('sorry')
    expect(eyeFaceOf({ aggro: true, notice: 1, dazed: false, sorry: false })).toBe('angry')
    expect(eyeFaceOf({ aggro: false, notice: 0.3, dazed: false, sorry: false })).toBe('alert')
    expect(eyeFaceOf({ aggro: false, notice: 0, dazed: false, sorry: false })).toBe('calm')
  })
})
