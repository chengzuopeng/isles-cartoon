import * as THREE from 'three'

export type LineTextureKind = 'wood' | 'stone' | 'rock' | 'metal' | 'dirt' | 'grass' | 'gravel' | 'bank' | 'stubble'

const SIZE = 256
const INK = 'rgba(29, 23, 20, 0.85)'
const SOFT_INK = 'rgba(29, 23, 20, 0.35)'
const GRASS_INK = 'rgba(38, 62, 18, 0.34)'
const EARTH_INK = 'rgba(52, 34, 18, 0.3)'
const OFFSETS: readonly [number, number][] = [-SIZE, 0, SIZE].flatMap((dx) => [-SIZE, 0, SIZE].map((dy) => [dx, dy] as [number, number]))

function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0
    state ^= state >>> 13
    return (state >>> 0) / 4294967296
  }
}

function stroke(context: CanvasRenderingContext2D, points: [number, number][], width: number, color: string): void {
  context.strokeStyle = color
  context.lineWidth = width
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.beginPath()
  points.forEach(([x, y], index) => (index === 0 ? context.moveTo(x, y) : context.lineTo(x, y)))
  context.stroke()
}

function wood(context: CanvasRenderingContext2D, rand: () => number): void {
  const planks = 4
  const width = SIZE / planks
  for (let i = 0; i < planks; i++) {
    const shade = 0.88 + rand() * 0.12
    context.fillStyle = `rgb(${Math.round(255 * shade)}, ${Math.round(246 * shade)}, ${Math.round(232 * shade)})`
    context.fillRect(i * width, 0, width, SIZE)
    for (let g = 0; g < 3; g++) {
      const x = i * width + width * (0.2 + rand() * 0.6)
      const points: [number, number][] = []
      for (let y = 0; y <= SIZE; y += 32) points.push([x + Math.sin(y * 0.05 + rand() * 6) * 3, y])
      stroke(context, points, 1.2, SOFT_INK)
    }
    if (rand() < 0.6) {
      const kx = i * width + width * (0.3 + rand() * 0.4)
      const ky = rand() * SIZE
      context.strokeStyle = SOFT_INK
      context.lineWidth = 1.4
      context.beginPath()
      context.ellipse(kx, ky, 4, 7, 0, 0, Math.PI * 2)
      context.stroke()
    }
    stroke(context, [[i * width + 1.5, 0], [i * width + 1.5, SIZE]], 3.2, INK)
    for (const y of [SIZE * 0.12, SIZE * 0.88]) {
      context.fillStyle = INK
      context.beginPath()
      context.arc(i * width + width / 2, y, 2.6, 0, Math.PI * 2)
      context.fill()
    }
  }
}

function stone(context: CanvasRenderingContext2D, rand: () => number): void {
  context.fillStyle = '#f4efe6'
  context.fillRect(0, 0, SIZE, SIZE)
  const rows = 4
  const height = SIZE / rows
  for (let r = 0; r < rows; r++) {
    let x = r % 2 === 0 ? 0 : -height * 0.6
    while (x < SIZE) {
      const width = height * (1.1 + rand() * 0.8)
      const shade = 0.86 + rand() * 0.14
      context.fillStyle = `rgb(${Math.round(250 * shade)}, ${Math.round(245 * shade)}, ${Math.round(236 * shade)})`
      const inset = 3
      context.beginPath()
      context.roundRect(x + inset, r * height + inset, width - inset * 2, height - inset * 2, 8)
      context.fill()
      context.strokeStyle = INK
      context.lineWidth = 2.6
      context.stroke()
      if (rand() < 0.5) stroke(context, [[x + width * 0.3, r * height + height * 0.3], [x + width * 0.45, r * height + height * 0.55], [x + width * 0.4, r * height + height * 0.75]], 1.2, SOFT_INK)
      x += width
    }
  }
}

function rock(context: CanvasRenderingContext2D, rand: () => number): void {
  context.fillStyle = '#f2ece2'
  context.fillRect(0, 0, SIZE, SIZE)
  for (let i = 0; i < 9; i++) {
    let x = rand() * SIZE
    let y = rand() * SIZE
    const points: [number, number][] = [[x, y]]
    for (let s = 0; s < 4; s++) {
      x += (rand() - 0.5) * 70
      y += 20 + rand() * 40
      points.push([x, y])
    }
    stroke(context, points, 1.4 + rand() * 1.4, i % 3 === 0 ? INK : SOFT_INK)
  }
  for (let i = 0; i < 40; i++) {
    context.fillStyle = SOFT_INK
    context.fillRect(rand() * SIZE, rand() * SIZE, 2, 2)
  }
}

function metal(context: CanvasRenderingContext2D, rand: () => number): void {
  context.fillStyle = '#eef0f2'
  context.fillRect(0, 0, SIZE, SIZE)
  const panels = 2
  const size = SIZE / panels
  for (let px = 0; px < panels; px++) {
    for (let py = 0; py < panels; py++) {
      context.strokeStyle = INK
      context.lineWidth = 3
      context.strokeRect(px * size + 2, py * size + 2, size - 4, size - 4)
      for (const [cx, cy] of [[10, 10], [size - 10, 10], [10, size - 10], [size - 10, size - 10]]) {
        context.fillStyle = INK
        context.beginPath()
        context.arc(px * size + cx, py * size + cy, 3, 0, Math.PI * 2)
        context.fill()
      }
      if (rand() < 0.5) stroke(context, [[px * size + size * 0.2, py * size + size * 0.6], [px * size + size * 0.5, py * size + size * 0.55]], 1.2, SOFT_INK)
    }
  }
}

function dirt(context: CanvasRenderingContext2D, rand: () => number): void {
  context.fillStyle = '#f4eee3'
  context.fillRect(0, 0, SIZE, SIZE)
  for (let i = 0; i < 22; i++) {
    const x = rand() * SIZE
    const y = rand() * SIZE
    const lean = (rand() - 0.5) * 6
    stroke(context, [[x, y], [x + lean, y - 7 - rand() * 5]], 1.3, SOFT_INK)
    stroke(context, [[x + 3, y], [x + 4 + lean, y - 5 - rand() * 4]], 1.1, SOFT_INK)
  }
  for (let i = 0; i < 10; i++) {
    context.strokeStyle = SOFT_INK
    context.lineWidth = 1.2
    context.beginPath()
    context.ellipse(rand() * SIZE, rand() * SIZE, 2.5 + rand() * 3, 1.8 + rand() * 2, rand() * 3, 0, Math.PI * 2)
    context.stroke()
  }
}

function wrapped(points: [number, number][]): [number, number][][] {
  return OFFSETS.map(([dx, dy]) => points.map(([x, y]) => [x + dx, y + dy] as [number, number]))
}

function wrappedStroke(context: CanvasRenderingContext2D, points: [number, number][], width: number, color: string): void {
  for (const copy of wrapped(points)) stroke(context, copy, width, color)
}

function wrappedEllipse(context: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, angle: number, fill: string | null, line: string | null, width = 1.2): void {
  for (const [dx, dy] of OFFSETS) {
    context.beginPath()
    context.ellipse(x + dx, y + dy, rx, ry, angle, 0, Math.PI * 2)
    if (fill) {
      context.fillStyle = fill
      context.fill()
    }
    if (line) {
      context.strokeStyle = line
      context.lineWidth = width
      context.stroke()
    }
  }
}

function grass(context: CanvasRenderingContext2D, rand: () => number): void {
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, SIZE, SIZE)
  for (let i = 0; i < 30; i++) {
    const x = rand() * SIZE
    const y = rand() * SIZE
    const blades = 2 + Math.floor(rand() * 3)
    const lean = (rand() - 0.5) * 5
    for (let b = 0; b < blades; b++) {
      const spread = (b - (blades - 1) / 2) * 3.4
      const height = 7 + rand() * 8
      const tip = lean + spread * 0.8
      wrappedStroke(context, [[x + spread, y], [x + spread + tip * 0.45, y - height * 0.55], [x + spread + tip, y - height]], 1.3, GRASS_INK)
    }
  }
  for (let i = 0; i < 40; i++) wrappedEllipse(context, rand() * SIZE, rand() * SIZE, 1 + rand() * 0.8, 0.8 + rand() * 0.6, 0, GRASS_INK, null)
}

function gravel(context: CanvasRenderingContext2D, rand: () => number): void {
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, SIZE, SIZE)
  for (let i = 0; i < 26; i++) {
    const shade = 0.88 + rand() * 0.1
    const tone = `rgb(${Math.round(255 * shade)}, ${Math.round(250 * shade)}, ${Math.round(240 * shade)})`
    wrappedEllipse(context, rand() * SIZE, rand() * SIZE, 3 + rand() * 5, 2 + rand() * 3, rand() * Math.PI, tone, EARTH_INK, 1.3)
  }
  for (let i = 0; i < 6; i++) {
    let x = rand() * SIZE
    let y = rand() * SIZE
    const points: [number, number][] = [[x, y]]
    for (let s = 0; s < 4; s++) {
      x += 8 + rand() * 14
      y += (rand() - 0.5) * 14
      points.push([x, y])
    }
    wrappedStroke(context, points, 1.1, EARTH_INK)
  }
  for (let i = 0; i < 70; i++) wrappedEllipse(context, rand() * SIZE, rand() * SIZE, 0.9 + rand(), 0.9 + rand(), 0, EARTH_INK, null)
}

function bank(context: CanvasRenderingContext2D, rand: () => number): void {
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, SIZE, SIZE)
  for (let layer = 0; layer < 6; layer++) {
    const base = layer * (SIZE / 6) + rand() * 10
    let x = rand() * 40
    while (x < SIZE) {
      const length = 30 + rand() * 60
      const points: [number, number][] = []
      for (let s = 0; s <= 4; s++) points.push([x + (length * s) / 4, base + Math.sin((x + s * 13) * 0.05) * 3 + (rand() - 0.5) * 2])
      wrappedStroke(context, points, 1.4, EARTH_INK)
      x += length + 8 + rand() * 30
    }
  }
  for (let i = 0; i < 14; i++) wrappedEllipse(context, rand() * SIZE, rand() * SIZE, 3 + rand() * 4, 2 + rand() * 2.5, rand() * 0.6, null, EARTH_INK, 1.3)
  for (let i = 0; i < 5; i++) {
    let x = rand() * SIZE
    let y = rand() * SIZE * 0.4
    const points: [number, number][] = [[x, y]]
    for (let s = 0; s < 5; s++) {
      x += (rand() - 0.5) * 10
      y += 7 + rand() * 8
      points.push([x, y])
    }
    wrappedStroke(context, points, 1, EARTH_INK)
  }
}

function stubble(context: CanvasRenderingContext2D, rand: () => number): void {
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, SIZE, SIZE)
  for (let y = 6; y < SIZE; y += 14 + rand() * 6) {
    let x = rand() * 8
    while (x < SIZE) {
      const height = 4 + rand() * 5
      const lean = (rand() - 0.5) * 3
      wrappedStroke(context, [[x, y], [x + lean, y - height]], 1.2, EARTH_INK)
      x += 5 + rand() * 6
    }
  }
  for (let i = 0; i < 24; i++) {
    const x = rand() * SIZE
    const y = rand() * SIZE
    const angle = rand() * Math.PI
    const length = 6 + rand() * 8
    wrappedStroke(context, [[x, y], [x + Math.cos(angle) * length, y + Math.sin(angle) * length]], 1, EARTH_INK)
  }
}

const PAINTERS: Record<LineTextureKind, (context: CanvasRenderingContext2D, rand: () => number) => void> = { wood, stone, rock, metal, dirt, grass, gravel, bank, stubble }

const cache = new Map<LineTextureKind, THREE.Texture>()

export function lineTexture(kind: LineTextureKind): THREE.Texture {
  const cached = cache.get(kind)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas 2d context unavailable')
  PAINTERS[kind](context, random(kind.length * 977 + kind.charCodeAt(0)))
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 8
  cache.set(kind, texture)
  return texture
}
