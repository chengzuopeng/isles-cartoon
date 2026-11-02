import { describe, expect, it } from 'vitest'
import { createFixedStep } from './fixed-step'

describe('createFixedStep', () => {
  it('runs one step for a frame of exactly one tick', () => {
    const loop = createFixedStep({ hz: 50 })
    expect(loop.advance(20)).toEqual({ steps: 1, alpha: 0 })
  })

  it('carries partial frames over to the next advance', () => {
    const loop = createFixedStep({ hz: 50 })
    expect(loop.advance(10)).toEqual({ steps: 0, alpha: 0.5 })
    expect(loop.advance(15)).toEqual({ steps: 1, alpha: 0.25 })
  })

  it('caps the steps after a long stall and drops the backlog', () => {
    const loop = createFixedStep({ hz: 50, maxStepsPerFrame: 4 })
    expect(loop.advance(1000)).toEqual({ steps: 4, alpha: 0 })
    expect(loop.advance(20)).toEqual({ steps: 1, alpha: 0 })
  })

  it('ignores negative frame time', () => {
    const loop = createFixedStep({ hz: 50 })
    expect(loop.advance(-5)).toEqual({ steps: 0, alpha: 0 })
  })

  it('reset clears the carried time', () => {
    const loop = createFixedStep({ hz: 50 })
    loop.advance(15)
    loop.reset()
    expect(loop.advance(10)).toEqual({ steps: 0, alpha: 0.5 })
  })
})
