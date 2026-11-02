import { SPEAKERS, type DialogueLine, type SpeakerDef } from '../data/dialogue'
import { assetUrl, type PortraitId } from '../render/asset-urls'
import { preload } from './assets'
import { element } from './dom'

export interface DialogueBox {
  play(lines: readonly DialogueLine[], onDone: () => void): void
  advance(): void
  skip(): void
  stop(): void
  isOpen(): boolean
  update(dt: number): void
}

interface Actor {
  root: HTMLDivElement
  image: HTMLImageElement
  shown: string
}

const CHARS_PER_SECOND = 38

export function createDialogue(container: HTMLElement): DialogueBox {
  const root = element('div', 'dialogue', container)
  const scene = element('div', 'dialogue-scene', root)
  const stage = element('div', 'dialogue-stage', root)
  const actors = {
    left: createActor(stage, 'left'),
    right: createActor(stage, 'right'),
  }
  const card = element('div', 'dialogue-card', root)
  const kicker = element('div', 'dialogue-card-kicker', card)
  const heading = element('div', 'dialogue-card-title', card)
  const subtitle = element('div', 'dialogue-card-text', card)
  element('div', 'dialogue-card-hint', root, '点击 / 空格继续 · Esc 跳过')
  const box = element('div', 'dialogue-box', root)
  const name = element('div', 'dialogue-name', box)
  const text = element('div', 'dialogue-text', box)
  element('div', 'dialogue-hint', box, '点击 / 空格继续 · Esc 跳过')
  root.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    advance()
  })

  let lines: readonly DialogueLine[] = []
  let index = 0
  let shown = 0
  let done: (() => void) | null = null

  const portraitOf = (speaker: SpeakerDef, line: DialogueLine): string | null => {
    if (!speaker.portrait) return null
    const expression = line.expression && speaker.expressions.includes(line.expression) ? line.expression : 'normal'
    return assetUrl.portrait(`${speaker.portrait}-${expression}` as PortraitId)
  }

  const showLine = () => {
    const line = lines[index]
    const speaker = SPEAKERS[line.speaker]
    const radio = line.radio ?? speaker.radio
    shown = line.card ? line.text.length : 0
    text.textContent = ''
    name.textContent = radio ? `${speaker.name} · 无线电` : speaker.name
    name.style.visibility = speaker.name ? 'visible' : 'hidden'
    box.classList.toggle('narration', line.speaker === 'narrator')
    root.classList.toggle('carded', Boolean(line.card))
    kicker.textContent = line.card?.kicker ?? ''
    heading.textContent = line.card?.title ?? ''
    subtitle.textContent = line.card ? line.text : ''
    scene.style.backgroundImage = line.scene ? `url(${assetUrl.scene(line.scene)})` : ''
    scene.classList.toggle('visible', Boolean(line.scene))
    const url = portraitOf(speaker, line)
    for (const side of ['left', 'right'] as const) {
      const actor = actors[side]
      const speaking = Boolean(url) && speaker.side === side
      if (speaking && url && actor.shown !== url) {
        actor.shown = url
        actor.image.src = url
      }
      actor.root.classList.toggle('visible', actor.shown !== '' && !line.scene)
      actor.root.classList.toggle('speaking', speaking)
      if (speaking) actor.root.classList.toggle('radio', radio)
    }
  }

  const close = (notify: boolean) => {
    root.classList.remove('visible', 'carded')
    lines = []
    for (const actor of Object.values(actors)) {
      actor.shown = ''
      actor.root.classList.remove('visible', 'speaking', 'radio')
    }
    const finish = done
    done = null
    if (notify) finish?.()
  }

  function advance(): void {
    if (lines.length === 0) return
    const line = lines[index]
    if (shown < line.text.length) {
      shown = line.text.length
      text.textContent = line.text
      return
    }
    index += 1
    if (index >= lines.length) close(true)
    else showLine()
  }

  return {
    play(next, onDone) {
      if (next.length === 0) {
        onDone()
        return
      }
      preload(
        next.flatMap((line) => {
          const url = portraitOf(SPEAKERS[line.speaker], line)
          return [url, line.scene ? assetUrl.scene(line.scene) : null].filter((item): item is string => item !== null)
        }),
      )
      lines = next
      index = 0
      done = onDone
      root.classList.add('visible')
      showLine()
    },
    advance,
    skip() {
      if (lines.length > 0) close(true)
    },
    stop() {
      if (lines.length > 0) close(false)
    },
    isOpen: () => lines.length > 0,
    update(dt) {
      if (lines.length === 0) return
      const line = lines[index]
      if (shown >= line.text.length) return
      shown = Math.min(line.text.length, shown + dt * CHARS_PER_SECOND)
      text.textContent = line.text.slice(0, Math.floor(shown))
    },
  }
}

function createActor(parent: HTMLElement, side: 'left' | 'right'): Actor {
  const root = element('div', `dialogue-actor ${side}`, parent)
  const image = element('img', 'dialogue-portrait', root)
  image.alt = ''
  image.draggable = false
  return { root, image, shown: '' }
}
