import type { FpsStage } from '../render/fps-stage'
import type { ScreenPoint } from '../render/stage'
import { element } from './dom'

export type SfxWord = 'pa' | 'kuang' | 'hong' | 'dang' | 'ding' | 'clatter'

const WORD_FILES: Readonly<Record<SfxWord, number>> = { pa: 1, kuang: 2, hong: 3, dang: 4, ding: 5, clatter: 6 }
const WORD_SIZE: Readonly<Record<SfxWord, number>> = { pa: 0.9, kuang: 1.1, hong: 1.5, dang: 0.95, ding: 1.05, clatter: 1.25 }
export type SayTone = 'crit' | 'shield' | 'stun' | 'streak' | 'combo'

const LIFE = 0.75
const LIMIT = 12
const SAY_FONT = 0.36
const SAY_LIFT: Readonly<Record<SayTone, number>> = { crit: 0.3, shield: 0.3, stun: 0.3, streak: 0.72, combo: 0.5 }

interface Pop {
  root: HTMLElement
  text: boolean
  tone: SayTone | null
  lift: number
  x: number
  y: number
  z: number
  age: number
  spin: number
  drift: number
  size: number
}

export interface SfxWords {
  pop(word: SfxWord, x: number, y: number, z: number, scale?: number): void
  say(text: string, tone: SayTone, x: number, y: number, z: number, scale?: number): void
  update(dt: number): void
  clear(): void
}

export const STREAK_WORDS = { grow: 0.18, lift: 0.32, cap: 4, labels: ['', '', '两连！', '三连！', '四连！', '五连！'], beyond: '停不下来！' } as const

export function streakLabel(streak: number): string | null {
  if (streak < 2) return null
  return STREAK_WORDS.labels[streak] ?? STREAK_WORDS.beyond
}

export function streakStep(streak: number): number {
  return Math.max(0, Math.min(streak - 1, STREAK_WORDS.cap))
}

export function wordUrl(word: SfxWord): string {
  return `${import.meta.env.BASE_URL}assets/ui/sfx/word-${WORD_FILES[word]}.png`
}

export function createSfxWords(container: HTMLElement, stage: FpsStage): SfxWords {
  const layer = element('div', 'sfx-words', container)
  const pops: Pop[] = []
  const point: ScreenPoint = { x: 0, y: 0, visible: false }
  const last = new Map<string, number>()
  let clock = 0
  for (const word of Object.keys(WORD_FILES) as SfxWord[]) {
    const image = new Image()
    image.src = wordUrl(word)
  }

  const remove = (index: number) => {
    pops[index].root.remove()
    pops.splice(index, 1)
  }

  return {
    pop(word, x, y, z, scale = 1) {
      const previous = last.get(word) ?? -Infinity
      if (clock - previous < 0.07) return
      last.set(word, clock)
      if (pops.length >= LIMIT) remove(0)
      const root = document.createElement('img')
      root.className = 'sfx-word'
      root.src = wordUrl(word)
      root.draggable = false
      layer.appendChild(root)
      const seed = Math.sin(clock * 91.7 + x * 3.1) * 0.5 + 0.5
      pops.push({ root, text: false, tone: null, lift: 0, x, y, z, age: 0, spin: (seed - 0.5) * 24, drift: (seed - 0.5) * 50, size: WORD_SIZE[word] * scale })
    },
    say(text, tone, x, y, z, scale = 1) {
      const previous = last.get(text) ?? -Infinity
      if (clock - previous < 0.25) return
      last.set(text, clock)
      if (tone === 'streak') for (let i = pops.length - 1; i >= 0; i--) if (pops[i].tone === 'streak') remove(i)
      if (pops.length >= LIMIT) remove(0)
      const root = document.createElement('span')
      root.className = `sfx-say sfx-say-${tone}`
      root.textContent = text
      layer.appendChild(root)
      const seed = Math.sin(clock * 57.3 + y * 2.3) * 0.5 + 0.5
      pops.push({ root, text: true, tone, lift: SAY_LIFT[tone], x, y, z, age: 0, spin: (seed - 0.5) * 14 - 4, drift: (seed - 0.5) * 30, size: scale })
    },
    update(dt) {
      clock += dt
      const height = Math.max(1, stage.height)
      for (let i = pops.length - 1; i >= 0; i--) {
        const pop = pops[i]
        pop.age += dt
        if (pop.age >= LIFE) {
          remove(i)
          continue
        }
        stage.project(pop.x, pop.z, pop.y, point)
        if (!point.visible) {
          pop.root.style.opacity = '0'
          continue
        }
        const t = pop.age / LIFE
        const punch = t < 0.18 ? 0.4 + (t / 0.18) * 0.85 : 1.25 - Math.min(0.25, (t - 0.18) * 0.6)
        const fade = t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1
        const base = (height / 1080) * 150 * pop.size
        const px = point.x + pop.drift * t
        const py = Math.max(base * (pop.text ? SAY_FONT * 0.9 : 0.35), point.y - 40 * t - base * (0.3 + pop.lift))
        if (pop.text) pop.root.style.fontSize = `${Math.round(base * SAY_FONT)}px`
        else pop.root.style.width = `${Math.round(base * 1.5)}px`
        pop.root.style.opacity = fade.toFixed(3)
        pop.root.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, -50%) rotate(${pop.spin.toFixed(1)}deg) scale(${punch.toFixed(3)})`
      }
    },
    clear() {
      while (pops.length > 0) remove(0)
    },
  }
}
