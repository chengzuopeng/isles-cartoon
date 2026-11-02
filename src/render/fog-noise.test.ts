import { describe, expect, it } from 'vitest'
import { fogNoise, fogNoiseSteps, latticeValue, type FogNoiseSpec } from './fog-noise'
import { FOG_LAYER } from './themes'

const SPEC: FogNoiseSpec = FOG_LAYER.noise

const fract = (x: number) => x - Math.floor(x)

function hash(x: number, y: number): number {
  let px = fract(x * 123.34)
  let py = fract(y * 456.21)
  const d = px * (px + 45.32) + py * (py + 45.32)
  px += d
  py += d
  return fract(px * py)
}

function realtimeNoise(x: number, y: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const ux = (x - ix) ** 2 * (3 - 2 * (x - ix))
  const uy = (y - iy) ** 2 * (3 - 2 * (y - iy))
  const upper = hash(ix, iy) + (hash(ix + 1, iy) - hash(ix, iy)) * ux
  const lower = hash(ix, iy + 1) + (hash(ix + 1, iy + 1) - hash(ix, iy + 1)) * ux
  return upper + (lower - upper) * uy
}

function realtimeFbm(x: number, y: number): number {
  let value = 0
  let amount = 0.5
  for (let i = 0; i < 3; i++) {
    value += amount * realtimeNoise(x, y)
    x = x * 2.03 + 17.1
    y = y * 2.03 + 9.2
    amount *= 0.5
  }
  return value / 0.875
}

function channelOf(data: Uint8Array, channel: number): Float64Array {
  const values = new Float64Array(data.length / 2)
  for (let i = 0; i < values.length; i++) values[i] = data[i * 2 + channel] / 255
  return values
}

function moments(values: ArrayLike<number>): { mean: number; deviation: number } {
  let sum = 0
  for (let i = 0; i < values.length; i++) sum += values[i]
  const mean = sum / values.length
  let squares = 0
  for (let i = 0; i < values.length; i++) squares += (values[i] - mean) ** 2
  return { mean, deviation: Math.sqrt(squares / values.length) }
}

function correlation(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const ma = moments(a)
  const mb = moments(b)
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += (a[i] - ma.mean) * (b[i] - mb.mean)
  return sum / a.length / (ma.deviation * mb.deviation)
}

function textureLag(values: Float64Array, size: number, lag: number): number {
  const shifted = new Float64Array(values.length)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) shifted[y * size + x] = values[y * size + ((x + lag) % size)]
  return correlation(values, shifted)
}

function realtimeLag(lag: number): number {
  const base: number[] = []
  const moved: number[] = []
  for (let j = 0; j < 160; j++) {
    for (let i = 0; i < 160; i++) {
      const x = i * 0.37 + 3.1
      const y = j * 0.41 + 7.7
      base.push(realtimeFbm(x, y))
      moved.push(realtimeFbm(x + lag, y))
    }
  }
  return correlation(base, moved)
}

describe('fog noise texture', () => {
  const data = fogNoise(SPEC)

  it('is one byte per channel per texel, the same every time, and different for another seed', () => {
    expect(data.length).toBe(SPEC.size * SPEC.size * SPEC.seeds.length)
    expect(fogNoise(SPEC)).toEqual(data)
    expect(fogNoise({ ...SPEC, seeds: [SPEC.seeds[0] + 1, SPEC.seeds[1]] })).not.toEqual(data)
    expect(latticeValue(3, 4, 11, 0)).toBe(latticeValue(3, 4, 11, 0))
    expect(latticeValue(3, 4, 11, 0)).not.toBe(latticeValue(3, 4, 11, 1))
  })

  it('tiles without a seam in either direction', () => {
    const { size } = SPEC
    for (let channel = 0; channel < 2; channel++) {
      const values = channelOf(data, channel)
      let inner = 0
      let seam = 0
      for (let row = 0; row < size; row++) {
        for (let column = 0; column < size - 1; column++) {
          inner = Math.max(inner, Math.abs(values[row * size + column + 1] - values[row * size + column]))
          inner = Math.max(inner, Math.abs(values[(column + 1) * size + row] - values[column * size + row]))
        }
        seam = Math.max(seam, Math.abs(values[row * size] - values[row * size + size - 1]))
        seam = Math.max(seam, Math.abs(values[row] - values[(size - 1) * size + row]))
      }
      expect(seam).toBeLessThanOrEqual(inner)
      expect(inner).toBeLessThan(0.12)
    }
  })

  it('has the mean and spread of the real-time noise it replaced, with two unrelated channels', () => {
    const red = channelOf(data, 0)
    const green = channelOf(data, 1)
    for (const values of [red, green]) {
      const { mean, deviation } = moments(values)
      expect(mean).toBeCloseTo(SPEC.mean, 2)
      expect(deviation).toBeCloseTo(SPEC.deviation, 2)
    }
    const reference: number[] = []
    for (let i = 0; i < 40000; i++) reference.push(realtimeFbm((i % 200) * 0.53 + 0.2, Math.floor(i / 200) * 0.47 + 0.9))
    expect(moments(reference).deviation).toBeCloseTo(SPEC.deviation, 2)
    expect(Math.abs(correlation(red, green))).toBeLessThan(0.1)
  })

  it('has blobs of the same size as the real-time noise it replaced: one noise unit is size / period texels', () => {
    const red = channelOf(data, 0)
    const unit = SPEC.size / SPEC.period
    for (const lag of [0.125, 0.25, 0.5, 1]) {
      expect(Math.abs(textureLag(red, SPEC.size, Math.round(lag * unit)) - realtimeLag(lag))).toBeLessThan(0.05)
    }
  })

  it('is made a few rows at a time and ends with the same texture', () => {
    const steps = fogNoiseSteps(SPEC)
    let yields = 0
    let step = steps.next()
    while (!step.done) {
      yields += 1
      step = steps.next()
    }
    expect(yields).toBe(1 + (2 * SPEC.size) / SPEC.rowsPerStep)
    expect(step.value).toEqual(data)
  })
})
