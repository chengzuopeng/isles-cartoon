import type { FpsStage } from '../render/fps-stage'
import type { ScreenPoint } from '../render/stage'
import { element } from './dom'

export type SfxWord = 'pa' | 'kuang' | 'hong' | 'dang' | 'ding' | 'clatter'

const WORD_FILES: Readonly<Record<SfxWord, number>> = { pa: 1, kuang: 2, hong: 3, dang: 4, ding: 5, clatter: 6 }
const WORD_SIZE: Readonly<Record<SfxWord, number>> = { pa: 0.9, kuang: 1.1, hong: 1.5, dang: 0.95, ding: 1.05, clatter: 1.25 }
const LIFE = 0.75
const LIMIT = 9

interface Pop {
  root: HTMLImageElement
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
  update(dt: number): void
  clear(): void
}

export function wordUrl(word: SfxWord): string {
  return `${import.meta.env.BASE_URL}assets/ui/sfx/word-${WORD_FILES[word]}.png`
}

export function createSfxWords(container: HTMLElement, stage: FpsStage): SfxWords {
  const layer = element('div', 'sfx-words', container)
  const pops: Pop[] = []
  const point: ScreenPoint = { x: 0, y: 0, visible: false }
  const last = new Map<SfxWord, number>()
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
      pops.push({ root, x, y, z, age: 0, spin: (seed - 0.5) * 24, drift: (seed - 0.5) * 50, size: WORD_SIZE[word] * scale })
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
        const py = point.y - 40 * t - base * 0.3
        pop.root.style.width = `${Math.round(base * 1.5)}px`
        pop.root.style.opacity = fade.toFixed(3)
        pop.root.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, -50%) rotate(${pop.spin.toFixed(1)}deg) scale(${punch.toFixed(3)})`
      }
    },
    clear() {
      while (pops.length > 0) remove(0)
    },
  }
}
