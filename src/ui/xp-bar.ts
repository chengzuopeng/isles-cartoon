import { LEVEL_CAP } from '../data/progression'
import { xpToNext } from '../sim/profile'
import { element } from './dom'

export interface XpBar {
  readonly root: HTMLDivElement
  set(level: number, xp: number): void
}

export function createXpBar(parent: HTMLElement): XpBar {
  const root = element('div', 'xp-block', parent)
  const level = element('div', 'xp-level', root)
  const track = element('div', 'xp-track', root)
  const fill = element('div', 'xp-fill', track)
  const text = element('div', 'xp-text', root)
  return {
    root,
    set(current, xp) {
      level.textContent = `Lv ${current}`
      if (current >= LEVEL_CAP) {
        fill.style.transform = 'scaleX(1)'
        text.textContent = '已满级'
        return
      }
      const need = xpToNext(current)
      fill.style.transform = `scaleX(${Math.min(1, xp / need).toFixed(4)})`
      text.textContent = `${Math.floor(xp)} / ${need}`
    },
  }
}

export function splitXp(total: number): { level: number; xp: number } {
  let level = 1
  let rest = Math.max(0, total)
  while (level < LEVEL_CAP && rest >= xpToNext(level)) {
    rest -= xpToNext(level)
    level += 1
  }
  return { level, xp: level >= LEVEL_CAP ? 0 : rest }
}
