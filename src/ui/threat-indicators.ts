import type { ScreenPoint, Stage } from '../render/stage'
import type { Enemy } from '../sim/types'
import type { World } from '../sim/world'
import { element } from './dom'
import { syncStyle } from './dom-sync'

export interface ThreatIndicators {
  update(world: World): void
  clear(): void
}

const EDGE_MARGIN = 34
const ALERT_RANGE = 13
const LOB_ALERT = 4

export function createThreatIndicators(container: HTMLElement, stage: Stage): ThreatIndicators {
  const layer = element('div', 'threat-layer', container)
  const arrows: HTMLDivElement[] = []
  const point: ScreenPoint = { x: 0, y: 0, visible: true }

  const arrow = (index: number) => {
    let node = arrows[index]
    if (!node) {
      node = element('div', 'threat', layer)
      arrows.push(node)
    }
    return node
  }

  const offscreen = (width: number, height: number) =>
    point.x < 0 || point.x > width || point.y < 0 || point.y > height

  const pin = (node: HTMLDivElement, width: number, height: number) => {
    const centerX = width / 2
    const centerY = height / 2
    const dx = point.x - centerX
    const dy = point.y - centerY
    const scale = Math.min(
      (centerX - EDGE_MARGIN) / Math.max(1e-3, Math.abs(dx)),
      (centerY - EDGE_MARGIN) / Math.max(1e-3, Math.abs(dy)),
    )
    const angle = Math.atan2(dy, dx)
    syncStyle(node, 'display', '')
    syncStyle(
      node,
      'transform',
      `translate3d(${(centerX + dx * scale).toFixed(1)}px, ${(centerY + dy * scale).toFixed(1)}px, 0) translate(-50%, -50%) rotate(${angle.toFixed(3)}rad)`,
    )
  }

  return {
    update(world) {
      const { player } = world
      const { width, height } = stage
      let used = 0
      if (player.alive && world.status === 'playing') {
        for (const enemy of world.enemies) {
          if (!isThreat(enemy) || Math.hypot(enemy.pos.x - player.pos.x, enemy.pos.y - player.pos.y) > ALERT_RANGE) {
            continue
          }
          stage.project(enemy.pos.x, 0.6, enemy.pos.y, point)
          if (!offscreen(width, height)) continue
          const node = arrow(used++)
          pin(node, width, height)
          node.classList.toggle('lob', false)
          node.classList.toggle('urgent', enemy.state === 'aim' || enemy.state === 'arming' || enemy.state === 'windup')
        }
        for (const lob of world.lobs) {
          if (lob.team !== 'enemy') continue
          if (Math.hypot(lob.to.x - player.pos.x, lob.to.y - player.pos.y) > lob.radius + LOB_ALERT) continue
          stage.project(lob.pos.x, lob.height, lob.pos.y, point)
          if (!offscreen(width, height)) continue
          const node = arrow(used++)
          pin(node, width, height)
          node.classList.toggle('urgent', false)
          node.classList.toggle('lob', true)
        }
      }
      for (let i = used; i < arrows.length; i++) syncStyle(arrows[i], 'display', 'none')
    },
    clear() {
      for (const node of arrows) syncStyle(node, 'display', 'none')
    },
  }
}

function isThreat(enemy: Enemy): boolean {
  if (enemy.hp <= 0 || !enemy.aggro) return false
  return (
    enemy.kind === 'gunner' ||
    enemy.kind === 'turret' ||
    enemy.kind === 'bomber' ||
    enemy.kind === 'thrower' ||
    enemy.kind === 'boss'
  )
}
