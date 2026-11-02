import { describe, expect, it } from 'vitest'
import { settleState } from './stage'

function program(ready: boolean): { isReady(): boolean } {
  return { isReady: () => ready }
}

describe('settleState', () => {
  it('settles nothing until every queued program has finished linking', () => {
    expect(settleState([])).toBe('none')
    expect(settleState([program(true), program(false)])).toBe('linking')
    expect(settleState([program(false), program(true)])).toBe('linking')
    expect(settleState([program(true), program(true)])).toBe('ready')
  })
})
