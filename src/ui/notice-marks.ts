import { bodyHeightOf } from '../data/heights'
import type { Stage, ScreenPoint } from '../render/stage'
import type { World } from '../sim/world'
import { element } from './dom'

export interface NoticeMarks {
  update(world: World): void
  clear(): void
}

export const NOTICE_MARKS = {
  range: 42,
  lift: 0.45,
  urgent: 0.7,
} as const

interface Mark {
  root: HTMLDivElement
  fill: HTMLDivElement
  seen: boolean
}

export function createNoticeMarks(container: HTMLElement, stage: Stage): NoticeMarks {
  const layer = element('div', 'notice-marks', container)
  const marks = new Map<number, Mark>()
  const point: ScreenPoint = { x: 0, y: 0, visible: false }

  const take = (id: number): Mark => {
    let mark = marks.get(id)
    if (!mark) {
      const root = element('div', 'notice-mark', layer)
      element('div', 'notice-mark-ghost', root, '?')
      const fill = element('div', 'notice-mark-fill', root, '?')
      mark = { root, fill, seen: false }
      marks.set(id, mark)
    }
    return mark
  }

  return {
    update(world) {
      for (const mark of marks.values()) mark.seen = false
      const { player } = world
      for (const enemy of world.enemies) {
        if (enemy.hp <= 0 || enemy.aggro || enemy.notice <= 0 || enemy.kind === 'boss') continue
        const distance = Math.hypot(enemy.pos.x - player.pos.x, enemy.pos.y - player.pos.y)
        if (distance > NOTICE_MARKS.range) continue
        stage.project(enemy.pos.x, enemy.z + bodyHeightOf(enemy.kind) + NOTICE_MARKS.lift, enemy.pos.y, point)
        if (!point.visible) continue
        const mark = take(enemy.id)
        mark.seen = true
        const scale = Math.max(0.55, Math.min(1.3, 12 / Math.max(distance, 1)))
        mark.root.style.transform = `translate(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px) translate(-50%, -100%) scale(${scale.toFixed(2)})`
        mark.fill.style.clipPath = `inset(${((1 - enemy.notice) * 100).toFixed(1)}% 0 0 0)`
        mark.root.classList.toggle('urgent', enemy.notice >= NOTICE_MARKS.urgent)
      }
      for (const [id, mark] of marks) {
        if (mark.seen) continue
        mark.root.remove()
        marks.delete(id)
      }
    },
    clear() {
      for (const mark of marks.values()) mark.root.remove()
      marks.clear()
    },
  }
}
