import * as THREE from 'three'

export type EyeFace = 'calm' | 'alert' | 'angry' | 'dizzy' | 'sorry'

export const EYE_FACES: readonly EyeFace[] = ['calm', 'alert', 'angry', 'dizzy', 'sorry']

export const EYE_FACE_LOOK = {
  size: 128,
  ink: '#1d1714',
  glow: '#ffd27a',
  hot: '#ff6a3c',
  dizzy: '#fff3a0',
  facingCut: 0.15,
} as const

export interface EyeFaceInput {
  aggro: boolean
  notice: number
  dazed: boolean
  sorry: boolean
}

export function eyeFaceOf(input: EyeFaceInput): EyeFace {
  if (input.dazed) return 'dizzy'
  if (input.sorry) return 'sorry'
  if (input.aggro) return 'angry'
  if (input.notice > 0) return 'alert'
  return 'calm'
}

function paint(face: EyeFace, context: CanvasRenderingContext2D, size: number): void {
  const c = size / 2
  context.clearRect(0, 0, size, size)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  const glow = (color: string, blur: number) => {
    context.shadowColor = color
    context.shadowBlur = blur
  }
  switch (face) {
    case 'calm': {
      glow(EYE_FACE_LOOK.glow, 18)
      context.fillStyle = EYE_FACE_LOOK.glow
      context.beginPath()
      context.arc(c, c, size * 0.2, 0, Math.PI * 2)
      context.fill()
      break
    }
    case 'alert': {
      glow(EYE_FACE_LOOK.glow, 22)
      context.fillStyle = EYE_FACE_LOOK.glow
      context.beginPath()
      context.arc(c, c, size * 0.32, 0, Math.PI * 2)
      context.fill()
      context.shadowBlur = 0
      context.fillStyle = '#fffaf0'
      context.beginPath()
      context.arc(c - size * 0.1, c - size * 0.1, size * 0.08, 0, Math.PI * 2)
      context.fill()
      break
    }
    case 'angry': {
      glow(EYE_FACE_LOOK.hot, 20)
      context.fillStyle = EYE_FACE_LOOK.hot
      context.beginPath()
      context.moveTo(c - size * 0.36, c - size * 0.12)
      context.lineTo(c + size * 0.36, c + size * 0.02)
      context.lineTo(c + size * 0.3, c + size * 0.16)
      context.lineTo(c - size * 0.32, c + size * 0.08)
      context.closePath()
      context.fill()
      break
    }
    case 'dizzy': {
      glow(EYE_FACE_LOOK.dizzy, 14)
      context.strokeStyle = EYE_FACE_LOOK.dizzy
      context.lineWidth = size * 0.07
      context.beginPath()
      for (let t = 0; t <= Math.PI * 4.2; t += 0.12) {
        const r = size * 0.03 + t * size * 0.026
        const x = c + Math.cos(t) * r
        const y = c + Math.sin(t) * r
        if (t === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      }
      context.stroke()
      break
    }
    case 'sorry': {
      glow(EYE_FACE_LOOK.glow, 16)
      context.strokeStyle = EYE_FACE_LOOK.glow
      context.lineWidth = size * 0.1
      context.beginPath()
      context.arc(c, c + size * 0.12, size * 0.26, Math.PI * 1.15, Math.PI * 1.85)
      context.stroke()
      break
    }
  }
}

const cache = new Map<EyeFace, THREE.Texture>()

export function eyeFaceTexture(face: EyeFace): THREE.Texture {
  const cached = cache.get(face)
  if (cached) return cached
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    const blank = new THREE.Texture()
    cache.set(face, blank)
    return blank
  }
  const canvas = document.createElement('canvas')
  canvas.width = EYE_FACE_LOOK.size
  canvas.height = EYE_FACE_LOOK.size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas 2d context unavailable')
  paint(face, context, EYE_FACE_LOOK.size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  cache.set(face, texture)
  return texture
}
