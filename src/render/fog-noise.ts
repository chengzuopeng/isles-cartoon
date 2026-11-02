import { finish, type Steps } from './slices'

export interface FogNoiseSpec {
  size: number
  period: number
  octaves: number
  seeds: readonly number[]
  mean: number
  deviation: number
  rowsPerStep: number
}

export function latticeValue(x: number, y: number, seed: number, octave: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(octave | 0, 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

interface Octave {
  cells: number
  lattice: Float32Array
  low: Int32Array
  high: Int32Array
  weight: Float32Array
  amount: number
}

function octaveOf(spec: FogNoiseSpec, seed: number, octave: number, amount: number): Octave {
  const cells = spec.period * 2 ** octave
  const lattice = new Float32Array(cells * cells)
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) lattice[j * cells + i] = latticeValue(i, j, seed, octave)
  const low = new Int32Array(spec.size)
  const high = new Int32Array(spec.size)
  const weight = new Float32Array(spec.size)
  for (let x = 0; x < spec.size; x++) {
    const p = ((x + 0.5) * cells) / spec.size
    const i = Math.floor(p)
    const f = p - i
    low[x] = i % cells
    high[x] = (i + 1) % cells
    weight[x] = f * f * (3 - 2 * f)
  }
  return { cells, lattice, low, high, weight, amount }
}

function addRow(octave: Octave, y: number, size: number, out: Float32Array, offset: number): void {
  const { cells, lattice, low, high, weight, amount } = octave
  const top = low[y] * cells
  const bottom = high[y] * cells
  const wy = weight[y]
  for (let x = 0; x < size; x++) {
    const wx = weight[x]
    const a = lattice[top + low[x]]
    const b = lattice[top + high[x]]
    const c = lattice[bottom + low[x]]
    const d = lattice[bottom + high[x]]
    const upper = a + (b - a) * wx
    out[offset + x] += amount * (upper + (c + (d - c) * wx - upper) * wy)
  }
}

export function* fogNoiseSteps(spec: FogNoiseSpec): Steps<Uint8Array> {
  const { size, octaves, seeds } = spec
  const channels = seeds.length
  const texels = size * size
  const fields = seeds.map((seed) => {
    const list: Octave[] = []
    let amount = 0.5
    let total = 0
    for (let octave = 0; octave < octaves; octave++) {
      list.push(octaveOf(spec, seed, octave, amount))
      total += amount
      amount *= 0.5
    }
    for (const octave of list) octave.amount /= total
    return { octaves: list, values: new Float32Array(texels), sum: 0, squares: 0, mean: 0, gain: 0 }
  })
  yield
  for (let y = 0; y < size; y++) {
    for (const field of fields) {
      for (const octave of field.octaves) addRow(octave, y, size, field.values, y * size)
      for (let i = y * size; i < (y + 1) * size; i++) {
        field.sum += field.values[i]
        field.squares += field.values[i] * field.values[i]
      }
    }
    if ((y + 1) % spec.rowsPerStep === 0) yield
  }
  for (const field of fields) {
    field.mean = field.sum / texels
    const deviation = Math.sqrt(Math.max(0, field.squares / texels - field.mean * field.mean))
    field.gain = deviation > 0 ? spec.deviation / deviation : 0
  }
  const out = new Uint8Array(texels * channels)
  for (let y = 0; y < size; y++) {
    fields.forEach((field, channel) => {
      for (let i = y * size; i < (y + 1) * size; i++) out[i * channels + channel] = Math.round(Math.min(1, Math.max(0, spec.mean + (field.values[i] - field.mean) * field.gain)) * 255)
    })
    if ((y + 1) % spec.rowsPerStep === 0) yield
  }
  return out
}

export function fogNoise(spec: FogNoiseSpec): Uint8Array {
  return finish(fogNoiseSteps(spec))
}
