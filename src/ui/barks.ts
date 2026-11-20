import { BARKS, SPEAKERS, type SpeakerId } from '../data/dialogue'
import { lineClear } from '../sim/collision'
import { blocksSight, floorAt } from '../sim/grid'
import { playerEye } from '../sim/terrain'
import { assetUrl, type PortraitId } from '../render/asset-urls'
import type { ScreenPoint, Stage } from '../render/stage'
import { lerp } from '../sim/math'
import type { GameEvent } from '../sim/types'
import type { World } from '../sim/world'
import { icon, preload } from './assets'
import { element } from './dom'
import { fogVeil, hiddenInFog } from './fog-veil'
import './barks.css'

type BarkEvent = Extract<GameEvent, { type: 'bark' }>

interface Line {
  speaker: SpeakerId | null
  text: string
  seconds: number
  radio: boolean
}

interface Bubble {
  root: HTMLDivElement
  enemy: number | null
  x: number
  y: number
  z: number
  left: number
  total: number
  veil: number
  shown: string
}

export interface Barks {
  handle(event: GameEvent, world: World): void
  update(world: World, alpha: number): void
  reset(): void
}

const FADE_SECONDS = 0.4
const BUBBLE_HEIGHT = 1.95

export function portraitOf(speaker: SpeakerId | null): string | null {
  if (!speaker) return null
  const portrait = SPEAKERS[speaker].portrait
  return portrait ? assetUrl.portrait(`${portrait}-normal` as PortraitId) : null
}

export function createBarks(parent: HTMLElement, stage: Stage): Barks {
  const bar = element('div', 'bark-bar', parent)
  const face = icon(bar, 'bark-face', '')
  const body = element('div', 'bark-body', bar)
  const name = element('div', 'bark-name', body)
  const text = element('div', 'bark-text', body)
  const layer = element('div', 'bark-layer', parent)
  const queue: Line[] = []
  const bubbles: Bubble[] = []
  const point: ScreenPoint = { x: 0, y: 0, visible: true }
  let current: Line | null = null
  let left = 0
  let tracked: World | null = null
  let last = 0

  preload(
    Object.values(BARKS)
      .flat()
      .map((bark) => portraitOf(bark.speaker))
      .filter((url): url is string => url !== null),
  )

  const show = (line: Line) => {
    current = line
    left = line.seconds
    const url = portraitOf(line.speaker)
    face.style.display = url ? '' : 'none'
    if (url) face.src = url
    const speaker = line.speaker ? SPEAKERS[line.speaker] : null
    name.textContent = speaker ? (speaker.radio || line.radio ? `${speaker.name} · 无线电` : speaker.name) : ''
    name.style.display = speaker?.name ? '' : 'none'
    text.textContent = line.text
    bar.classList.remove('visible', 'leaving')
    void bar.offsetWidth
    bar.classList.add('visible')
  }

  const hide = () => {
    current = null
    bar.classList.remove('visible', 'leaving')
  }

  const addBubble = (event: BarkEvent, world: World) => {
    const root = element('div', 'bark-bubble', layer, event.text)
    root.classList.toggle('actor', event.z !== undefined)
    const z = event.z ?? floorAt(world.grid, event.x, event.y) + BUBBLE_HEIGHT
    bubbles.push({ root, enemy: event.enemy, x: event.x, y: event.y, z, left: event.seconds, total: event.seconds, veil: -1, shown: '' })
  }

  const actorOnScreen = (event: BarkEvent, world: World): boolean => {
    const { x, y, z } = event
    if (z === undefined) return false
    stage.project(x, z, y, point)
    if (!point.visible || point.x < 120 || point.x > stage.width - 120 || point.y < 72 || point.y > stage.height) return false
    return lineClear(world.grid, playerEye(world.player), { x, y, z: z - 0.28 }, blocksSight)
  }

  return {
    handle(event, world) {
      if (event.type !== 'bark') return
      if (event.display === 'bubble' || actorOnScreen(event, world)) {
        addBubble(event, world)
        return
      }
      const line = { speaker: event.speaker, text: event.text, seconds: event.seconds, radio: event.radio === true }
      if (current) queue.push(line)
      else show(line)
    },
    update(world, alpha) {
      const dt = tracked === world ? Math.max(0, world.time - last) : 0
      tracked = world
      last = world.time
      if (current) {
        left -= dt
        bar.classList.toggle('leaving', left <= FADE_SECONDS)
        if (left <= 0) {
          hide()
          const next = queue.shift()
          if (next) show(next)
        }
      }
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const bubble = bubbles[i]
        bubble.left -= dt
        if (bubble.left <= 0) {
          bubble.root.remove()
          bubbles.splice(i, 1)
          continue
        }
        const enemy = bubble.enemy === null ? null : world.enemies.find((item) => item.id === bubble.enemy && item.hp > 0)
        if (enemy) {
          bubble.x = lerp(enemy.prev.x, enemy.pos.x, alpha)
          bubble.y = lerp(enemy.prev.y, enemy.pos.y, alpha)
          bubble.z = lerp(enemy.prevZ, enemy.z, alpha) + BUBBLE_HEIGHT
        }
        stage.project(bubble.x, bubble.z, bubble.y, point)
        bubble.root.style.transform = `translate3d(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px, 0)`
        bubble.root.style.visibility = point.visible ? 'visible' : 'hidden'
        bubble.root.classList.toggle('leaving', bubble.left <= FADE_SECONDS)
        if (bubble.enemy !== null) {
          bubble.veil = fogVeil(bubble.veil, hiddenInFog(world, bubble.x, bubble.y), dt)
          const filter = bubble.veil > 0 ? `opacity(${(1 - bubble.veil).toFixed(3)})` : ''
          if (filter !== bubble.shown) {
            bubble.shown = filter
            bubble.root.style.filter = filter
          }
        }
      }
    },
    reset() {
      queue.length = 0
      hide()
      for (const bubble of bubbles) bubble.root.remove()
      bubbles.length = 0
    },
  }
}
