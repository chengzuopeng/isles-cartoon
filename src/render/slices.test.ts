import { describe, expect, it } from 'vitest'
import { finish, interleave, paceBudget, sliced, type Steps } from './slices'

function* counting(log: string[], steps: number): Steps<number> {
  try {
    for (let step = 0; step < steps; step++) {
      log.push(`step ${step}`)
      yield
    }
    return steps
  } finally {
    log.push('done')
  }
}

describe('slices', () => {
  it('takes bigger slices only while nothing behind the work is on screen, and smaller ones while shaders compile', () => {
    const view = { budgetMs: 4, coveredMs: 10 }
    const warmup = { budgetMs: 4, coveredMs: 10, compilingMs: 6 }
    expect(paceBudget(view, false, false)).toBe(4)
    expect(paceBudget(view, true, false)).toBe(10)
    expect(paceBudget(view, true, true)).toBe(10)
    expect(paceBudget(warmup, false, true)).toBe(4)
    expect(paceBudget(warmup, true, false)).toBe(10)
    expect(paceBudget(warmup, true, true)).toBe(6)
  })

  it('runs a build to the end in one go', () => {
    const log: string[] = []
    expect(finish(counting(log, 3))).toBe(3)
    expect(log).toEqual(['step 0', 'step 1', 'step 2', 'done'])
  })

  it('gives the main thread back between slices once the budget is spent', async () => {
    const log: string[] = []
    const ticker = setInterval(() => log.push('tick'), 0)
    const result = await sliced(counting(log, 4), { budget: 0, wait: 5, cancelled: () => false, hurry: () => false })
    clearInterval(ticker)
    expect(result).toBe(4)
    const steps = log.filter((entry) => entry.startsWith('step'))
    expect(steps).toHaveLength(4)
    const between = log.slice(log.indexOf('step 0'), log.indexOf('step 3'))
    expect(between).toContain('tick')
  })

  it('reads the budget again after every step, so a smaller one takes effect at once', async () => {
    const log: string[] = []
    let budget = 1000
    function* shrinking(): Steps<number> {
      for (let step = 0; step < 5; step++) {
        log.push(`step ${step}`)
        if (step === 1) budget = 0
        yield
      }
      return 5
    }
    const ticker = setInterval(() => log.push('tick'), 0)
    const result = await sliced(shrinking(), { budget: () => budget, wait: 5, cancelled: () => false, hurry: () => false })
    clearInterval(ticker)
    expect(result).toBe(5)
    expect(log.slice(0, 2)).toEqual(['step 0', 'step 1'])
    for (let step = 1; step < 4; step++) expect(log.slice(log.indexOf(`step ${step}`), log.indexOf(`step ${step + 1}`))).toContain('tick')
  })

  it('stops pausing as soon as the budget grows', async () => {
    const log: string[] = []
    let budget = 0
    function* growing(): Steps<number> {
      for (let step = 0; step < 5; step++) {
        log.push(`step ${step}`)
        if (step === 1) budget = 1000
        yield
      }
      return 5
    }
    const ticker = setInterval(() => log.push('tick'), 0)
    const result = await sliced(growing(), { budget: () => budget, wait: 5, cancelled: () => false, hurry: () => false })
    clearInterval(ticker)
    expect(result).toBe(5)
    expect(log.slice(log.indexOf('step 0'), log.indexOf('step 1'))).toContain('tick')
    expect(log.slice(log.indexOf('step 1'))).toEqual(['step 1', 'step 2', 'step 3', 'step 4'])
  })

  it('finishes without pausing while someone is waiting for it', async () => {
    const log: string[] = []
    const ticker = setInterval(() => log.push('tick'), 0)
    const result = await sliced(counting(log, 4), { budget: 0, wait: 5, cancelled: () => false, hurry: () => true })
    clearInterval(ticker)
    expect(result).toBe(4)
    expect(log.slice(0, 5)).toEqual(['step 0', 'step 1', 'step 2', 'step 3', 'done'])
  })

  it('waits as long as a step asks before going on, even while someone is waiting', async () => {
    const log: string[] = []
    function* polling(): Steps<number> {
      log.push('ask')
      yield 5
      log.push('again')
      return 1
    }
    const ticker = setInterval(() => log.push('tick'), 0)
    const result = await sliced(polling(), { budget: 1000, wait: 5, cancelled: () => false, hurry: () => true })
    clearInterval(ticker)
    expect(result).toBe(1)
    expect(log.slice(log.indexOf('ask'), log.indexOf('again'))).toContain('tick')
    expect(finish(polling())).toBe(1)
  })

  it('runs the lead whenever it is free and fills its waits with the other work', () => {
    const clock = { now: 0 }
    const log: string[] = []
    function* lead(): Steps<string> {
      log.push('upload 1')
      yield
      log.push('hold')
      yield 10
      log.push('upload 2')
      yield
      return 'uploaded'
    }
    function* fill(): Steps<string> {
      for (let piece = 1; piece <= 3; piece++) {
        log.push(`build ${piece}`)
        clock.now += 4
        yield
      }
      return 'built'
    }
    const steps = interleave(lead(), fill(), () => clock.now)
    let step = steps.next()
    while (!step.done) {
      if (typeof step.value === 'number') log.push(`wait ${step.value}`)
      step = steps.next()
    }
    expect(step.value).toEqual(['uploaded', 'built'])
    expect(log).toEqual(['upload 1', 'hold', 'build 1', 'build 2', 'build 3', 'upload 2'])
  })

  it('waits only as long as the sooner of the two asks once neither can go on', () => {
    const clock = { now: 0 }
    const log: string[] = []
    function* lead(): Steps<number> {
      log.push('hold')
      yield 10
      log.push('upload')
      return 1
    }
    function* fill(): Steps<number> {
      log.push('linking')
      yield 4
      log.push('linked')
      return 2
    }
    const steps = interleave(lead(), fill(), () => clock.now)
    let step = steps.next()
    while (!step.done) {
      if (typeof step.value === 'number') {
        log.push(`wait ${step.value}`)
        clock.now += step.value
      }
      step = steps.next()
    }
    expect(step.value).toEqual([1, 2])
    expect(log).toEqual(['hold', 'linking', 'wait 4', 'linked', 'wait 6', 'upload'])
  })

  it('lets both sides clean up when stopped half way', () => {
    const lead: string[] = []
    const fill: string[] = []
    function* holding(): Steps<void> {
      try {
        lead.push('hold')
        yield 10
        lead.push('upload')
      } finally {
        lead.push('done')
      }
    }
    const steps = interleave(holding(), counting(fill, 5), () => 0)
    steps.next()
    steps.next()
    steps.return(undefined as never)
    expect(lead).toEqual(['hold', 'done'])
    expect(fill).toEqual(['step 0', 'step 1', 'done'])
  })

  it('stops a cancelled build and lets it clean up after itself', async () => {
    const log: string[] = []
    let calls = 0
    const result = await sliced(counting(log, 10), { budget: 0, wait: 5, cancelled: () => ++calls > 3, hurry: () => false })
    expect(result).toBeNull()
    expect(log).toEqual(['step 0', 'step 1', 'step 2', 'done'])
  })
})
