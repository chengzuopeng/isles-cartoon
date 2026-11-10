import * as THREE from 'three'

export const HIT_STAR = {
  texels: 128,
  points: 8,
  inner: 0.42,
  ink: 0.11,
  sharp: 1.6,
  core: [1, 1, 0.94],
  rim: [1, 0.82, 0.32],
  inkColor: [0.11, 0.09, 0.08],
  life: 0.09,
  grow: 0.35,
  glow: 1.7,
  pool: 24,
} as const

export function starRadius(angle: number, points: number = HIT_STAR.points, inner: number = HIT_STAR.inner, sharp: number = HIT_STAR.sharp): number {
  const wave = Math.abs(Math.cos((angle * points) / 2))
  return inner + (1 - inner) * Math.pow(wave, sharp)
}

function smooth(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

export function starTexels(size: number = HIT_STAR.texels): Uint8Array {
  const data = new Uint8Array(size * size * 4)
  const pixel = 2 / size
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const x = ((column + 0.5) / size) * 2 - 1
      const y = ((row + 0.5) / size) * 2 - 1
      const r = Math.hypot(x, y) / 0.96
      const edge = starRadius(Math.atan2(y, x))
      const outside = smooth(edge - pixel, edge + pixel, r)
      const fill = 1 - smooth(edge - HIT_STAR.ink - pixel, edge - HIT_STAR.ink + pixel, r)
      const heat = Math.min(1, r / Math.max(edge - HIT_STAR.ink, 0.001))
      const index = (row * size + column) * 4
      for (let channel = 0; channel < 3; channel++) {
        const flame = HIT_STAR.core[channel] + (HIT_STAR.rim[channel] - HIT_STAR.core[channel]) * heat * heat
        const color = HIT_STAR.inkColor[channel] + (flame - HIT_STAR.inkColor[channel]) * fill
        data[index + channel] = Math.round(Math.min(1, color) * 255)
      }
      data[index + 3] = Math.round((1 - outside) * 255)
    }
  }
  return data
}

let texture: THREE.DataTexture | null = null

export function starTexture(): THREE.DataTexture {
  if (texture) return texture
  texture = new THREE.DataTexture(starTexels(), HIT_STAR.texels, HIT_STAR.texels, THREE.RGBAFormat)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

export function starScale(age: number, life: number = HIT_STAR.life, grow: number = HIT_STAR.grow): number {
  if (age < 0 || age >= life) return 0
  const t = age / life
  return t < grow ? 0.55 + 0.45 * (t / grow) : 1 - (t - grow) * 0.25
}
