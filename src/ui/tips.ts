import { readJson, removeKey, writeJson } from '../core/storage'
import { TIPS, TIP_SECONDS, type TipId } from '../data/tips'
import type { GameEvent } from '../sim/types'
import type { World } from '../sim/world'
import { element } from './dom'
import { tipForEvent, tipsForState } from './tip-rules'
import './tips.css'

const SEEN_KEY = 'shattered-isles.tips.v1'

export interface Tips {
  update(world: World, dt: number): void
  handle(event: GameEvent, world: World): void
  clear(): void
  setEnabled(enabled: boolean): void
  resetSeen(): void
}

export function createTips(container: HTMLElement): Tips {
  const root = element('div', 'tip-card', container)
  element('div', 'tip-label', root, '提示')
  const text = element('div', 'tip-text', root)
  const seen = new Set<TipId>(readSeen())
  const queue: TipId[] = []
  let current: TipId | null = null
  let remaining = 0
  let enabled = true

  const offer = (id: TipId | null) => {
    if (!id || !enabled || seen.has(id) || current === id || queue.includes(id)) return
    queue.push(id)
  }

  const hide = () => {
    current = null
    remaining = 0
    root.classList.remove('visible')
  }

  return {
    update(world, dt) {
      for (const id of tipsForState(world)) offer(id)
      if (current) {
        remaining -= dt
        if (remaining <= 0) hide()
        return
      }
      const next = queue.shift()
      if (!next || !enabled) return
      current = next
      remaining = TIP_SECONDS
      seen.add(next)
      writeJson(SEEN_KEY, [...seen])
      text.textContent = TIPS[next]
      root.classList.remove('visible')
      void root.offsetWidth
      root.classList.add('visible')
    },
    handle(event, world) {
      offer(tipForEvent(world, event))
    },
    clear() {
      queue.length = 0
      hide()
    },
    setEnabled(next) {
      enabled = next
      if (!next) {
        queue.length = 0
        hide()
      }
    },
    resetSeen() {
      seen.clear()
      removeKey(SEEN_KEY)
    },
  }
}

function readSeen(): TipId[] {
  const raw = readJson(SEEN_KEY)
  if (!Array.isArray(raw)) return []
  return raw.filter((id): id is TipId => typeof id === 'string' && id in TIPS)
}
