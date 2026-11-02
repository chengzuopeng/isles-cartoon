export type Steps<T> = Generator<number | void, T, void>

export interface SliceOptions {
  budget: number | (() => number)
  wait: number
  cancelled(): boolean
  hurry(): boolean
}

export interface SlicePace {
  budgetMs: number
  coveredMs: number
  compilingMs?: number
}

export function paceBudget(pace: SlicePace, covered: boolean, compiling: boolean): number {
  if (!covered) return pace.budgetMs
  return compiling && pace.compilingMs !== undefined ? pace.compilingMs : pace.coveredMs
}

export function* interleave<A, B>(lead: Steps<A>, fill: Steps<B>, now: () => number = () => performance.now()): Steps<[A, B]> {
  let led: { value: A } | null = null
  let filled: { value: B } | null = null
  let leadAt = 0
  let fillAt = 0
  try {
    for (;;) {
      if (!led && now() >= leadAt) {
        const step = lead.next()
        if (step.done) led = { value: step.value }
        else if (typeof step.value === 'number') leadAt = now() + step.value
        else {
          yield
          continue
        }
      }
      if (!filled && now() >= fillAt) {
        const step = fill.next()
        if (step.done) filled = { value: step.value }
        else if (typeof step.value === 'number') fillAt = now() + step.value
        else {
          yield
          continue
        }
      }
      if (led && filled) return [led.value, filled.value]
      yield Math.max(0, Math.min(led ? Infinity : leadAt, filled ? Infinity : fillAt) - now())
    }
  } finally {
    if (!led) lead.return(undefined as never)
    if (!filled) fill.return(undefined as never)
  }
}

export function finish<T>(steps: Steps<T>): T {
  for (;;) {
    const step = steps.next()
    if (step.done) return step.value
  }
}

export function afterFrame(wait: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const go = () => {
      if (done) return
      done = true
      setTimeout(resolve, 0)
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go)
    setTimeout(go, wait)
  })
}

export function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function sliced<T>(steps: Steps<T>, options: SliceOptions): Promise<T | null> {
  const { budget } = options
  const limit = typeof budget === 'number' ? () => budget : budget
  let started = performance.now()
  for (;;) {
    if (options.cancelled()) {
      steps.return(undefined as never)
      return null
    }
    const step = steps.next()
    if (step.done) return step.value
    if (typeof step.value === 'number') {
      await pause(step.value)
      started = performance.now()
      continue
    }
    if (options.hurry() || performance.now() - started < limit()) continue
    await afterFrame(options.wait)
    started = performance.now()
  }
}
