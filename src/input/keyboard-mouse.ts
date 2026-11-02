export interface PointerState {
  x: number
  y: number
  inside: boolean
}

export interface KeyboardMouse {
  readonly pointer: PointerState
  moveAxes(): { x: number; y: number }
  fireHeld(): boolean
  pressed(code: string): boolean
  clicked(): boolean
  altClicked(): boolean
  endFrame(): void
  dispose(): void
}

const CAPTURED_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
])

export function createKeyboardMouse(surface: HTMLElement): KeyboardMouse {
  const held = new Set<string>()
  const justPressed = new Set<string>()
  const pointer: PointerState = { x: 0, y: 0, inside: false }
  let fire = false
  let click = false
  let altClick = false

  const onKeyDown = (event: KeyboardEvent) => {
    if (isTyping(event.target)) return
    if (!event.repeat) justPressed.add(event.code)
    held.add(event.code)
    if (CAPTURED_KEYS.has(event.code)) event.preventDefault()
  }
  const onKeyUp = (event: KeyboardEvent) => {
    held.delete(event.code)
  }
  const onPointerMove = (event: PointerEvent) => {
    const rect = surface.getBoundingClientRect()
    pointer.x = event.clientX - rect.left
    pointer.y = event.clientY - rect.top
    pointer.inside = true
  }
  const onPointerDown = (event: PointerEvent) => {
    onPointerMove(event)
    if (event.button === 2) {
      altClick = true
      return
    }
    if (event.button !== 0) return
    fire = true
    click = true
  }
  const onPointerUp = (event: PointerEvent) => {
    if (event.button === 0) fire = false
  }
  const onBlur = () => {
    held.clear()
    fire = false
  }
  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault()
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('blur', onBlur)
  surface.addEventListener('pointerdown', onPointerDown)
  surface.addEventListener('contextmenu', onContextMenu)

  return {
    pointer,
    moveAxes() {
      const right = held.has('KeyD') || held.has('ArrowRight')
      const left = held.has('KeyA') || held.has('ArrowLeft')
      const down = held.has('KeyS') || held.has('ArrowDown')
      const up = held.has('KeyW') || held.has('ArrowUp')
      return { x: Number(right) - Number(left), y: Number(down) - Number(up) }
    },
    fireHeld: () => fire,
    pressed: (code) => justPressed.has(code),
    clicked: () => click,
    altClicked: () => altClick,
    endFrame() {
      justPressed.clear()
      click = false
      altClick = false
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('blur', onBlur)
      surface.removeEventListener('pointerdown', onPointerDown)
      surface.removeEventListener('contextmenu', onContextMenu)
    },
  }
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}
