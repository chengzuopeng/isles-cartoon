import { actionCodes, type KeyAction, type KeyMap } from './keymap'

export interface LookDelta {
  x: number
  y: number
}

export interface FpsInput {
  locked(): boolean
  requestLock(): void
  releaseLock(): void
  takeLook(): LookDelta
  moveAxes(): { forward: number; right: number }
  held(code: string): boolean
  pressed(code: string): boolean
  actionHeld(action: KeyAction): boolean
  actionPressed(action: KeyAction): boolean
  lastPressed(): string | null
  fireHeld(): boolean
  meleePressed(): boolean
  wheel(): number
  clicked(): boolean
  onLockChange(listener: (locked: boolean) => void): void
  endFrame(): void
  dispose(): void
}

const CAPTURED_KEYS = new Set(['Space', 'ShiftLeft', 'ShiftRight', 'Tab', 'AltLeft', 'AltRight', 'ControlLeft', 'ControlRight', 'Backspace', 'Slash', 'Quote'])

export function createFpsInput(surface: HTMLElement, keys: () => KeyMap): FpsInput {
  const held = new Set<string>()
  const justPressed = new Set<string>()
  const look: LookDelta = { x: 0, y: 0 }
  const listeners: ((locked: boolean) => void)[] = []
  let fire = false
  let melee = false
  let click = false
  let wheelSteps = 0
  let isLocked = false
  let lastLockRequest = 0
  let last: string | null = null
  const isHeld = (action: KeyAction) => actionCodes(keys(), action).some((code) => held.has(code))
  const isPressed = (action: KeyAction) => actionCodes(keys(), action).some((code) => justPressed.has(code))
  const bound = (code: string) => Object.values(keys()).includes(code)

  const onKeyDown = (event: KeyboardEvent) => {
    if (isTyping(event.target)) return
    if (!event.repeat) {
      justPressed.add(event.code)
      last = event.code
    }
    held.add(event.code)
    if (isLocked && (CAPTURED_KEYS.has(event.code) || bound(event.code))) event.preventDefault()
  }
  const onKeyUp = (event: KeyboardEvent) => {
    held.delete(event.code)
  }
  const onMouseMove = (event: MouseEvent) => {
    if (!isLocked) return
    look.x += event.movementX
    look.y += event.movementY
  }
  const onPointerDown = (event: PointerEvent) => {
    click = true
    if (!isLocked) return
    if (event.button === 0) fire = true
    else if (event.button === 2) melee = true
  }
  const onPointerUp = (event: PointerEvent) => {
    if (event.button === 0) fire = false
  }
  const onWheel = (event: WheelEvent) => {
    if (!isLocked) return
    wheelSteps += Math.sign(event.deltaY)
  }
  const onBlur = () => {
    held.clear()
    fire = false
  }
  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault()
  }
  const onLock = () => {
    const next = document.pointerLockElement === surface
    if (next === isLocked) return
    isLocked = next
    if (!next) {
      fire = false
      held.clear()
    }
    look.x = 0
    look.y = 0
    for (const listener of listeners) listener(next)
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('blur', onBlur)
  window.addEventListener('wheel', onWheel, { passive: true })
  surface.addEventListener('pointerdown', onPointerDown)
  surface.addEventListener('contextmenu', onContextMenu)
  document.addEventListener('pointerlockchange', onLock)

  return {
    locked: () => isLocked,
    requestLock() {
      if (isLocked) return
      const now = performance.now()
      if (now - lastLockRequest < 300) return
      lastLockRequest = now
      const request = surface.requestPointerLock({ unadjustedMovement: true }) as Promise<void> | undefined
      request?.catch(() => {
        const fallback = surface.requestPointerLock() as Promise<void> | undefined
        fallback?.catch(() => {})
      })
    },
    releaseLock() {
      if (document.pointerLockElement === surface) document.exitPointerLock()
    },
    takeLook() {
      const delta = { x: look.x, y: look.y }
      look.x = 0
      look.y = 0
      return delta
    },
    moveAxes() {
      const forward = Number(isHeld('forward')) - Number(isHeld('back'))
      const right = Number(isHeld('right')) - Number(isHeld('left'))
      return { forward, right }
    },
    held: (code) => held.has(code),
    pressed: (code) => justPressed.has(code),
    actionHeld: isHeld,
    actionPressed: isPressed,
    lastPressed: () => last,
    fireHeld: () => fire,
    meleePressed: () => melee,
    wheel: () => wheelSteps,
    clicked: () => click,
    onLockChange(listener) {
      listeners.push(listener)
    },
    endFrame() {
      justPressed.clear()
      last = null
      melee = false
      click = false
      wheelSteps = 0
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('wheel', onWheel)
      surface.removeEventListener('pointerdown', onPointerDown)
      surface.removeEventListener('contextmenu', onContextMenu)
      document.removeEventListener('pointerlockchange', onLock)
    },
  }
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}
