export interface FixedStepOptions {
  hz: number
  maxStepsPerFrame?: number
}

export interface FixedStepAdvance {
  steps: number
  alpha: number
}

export interface FixedStep {
  readonly stepMs: number
  readonly stepSeconds: number
  advance(frameMs: number): FixedStepAdvance
  reset(): void
}

export function createFixedStep({ hz, maxStepsPerFrame = 5 }: FixedStepOptions): FixedStep {
  const stepMs = 1000 / hz
  const maxBacklogMs = stepMs * maxStepsPerFrame
  let accumulator = 0

  return {
    stepMs,
    stepSeconds: stepMs / 1000,
    advance(frameMs) {
      accumulator = Math.min(accumulator + Math.max(0, frameMs), maxBacklogMs)
      const steps = Math.floor(accumulator / stepMs)
      accumulator -= steps * stepMs
      return { steps, alpha: accumulator / stepMs }
    },
    reset() {
      accumulator = 0
    },
  }
}
