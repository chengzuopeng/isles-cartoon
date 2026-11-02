import { readJson, writeJson } from '../core/storage'

export type KeyAction =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'dash'
  | 'interact'
  | 'skillQ'
  | 'skillE'
  | 'ultimate'
  | 'primary'
  | 'special'
  | 'melee'
  | 'map'
  | 'mute'

export type KeyMap = Record<KeyAction, string | null>

export interface KeyActionDef {
  id: KeyAction
  label: string
  fixed?: string
}

export const KEY_ACTIONS: readonly KeyActionDef[] = [
  { id: 'forward', label: '前进', fixed: '↑' },
  { id: 'back', label: '后退', fixed: '↓' },
  { id: 'left', label: '左移', fixed: '←' },
  { id: 'right', label: '右移', fixed: '→' },
  { id: 'jump', label: '跳' },
  { id: 'dash', label: '冲刺闪避', fixed: '右 Shift' },
  { id: 'interact', label: '拾取 / 开宝箱' },
  { id: 'skillQ', label: '技能一' },
  { id: 'skillE', label: '技能二' },
  { id: 'ultimate', label: '大招' },
  { id: 'primary', label: '主武器', fixed: '滚轮' },
  { id: 'special', label: '特殊武器', fixed: '滚轮' },
  { id: 'melee', label: '枪托砸', fixed: '鼠标右键' },
  { id: 'map', label: '地图' },
  { id: 'mute', label: '静音' },
]

export const DEFAULT_KEYS: Readonly<KeyMap> = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  dash: 'ShiftLeft',
  interact: 'KeyF',
  skillQ: 'KeyQ',
  skillE: 'KeyE',
  ultimate: 'KeyR',
  primary: 'Digit1',
  special: 'Digit2',
  melee: null,
  map: 'KeyM',
  mute: 'KeyN',
}

export const FIXED_KEYS: Readonly<Partial<Record<KeyAction, readonly string[]>>> = {
  forward: ['ArrowUp'],
  back: ['ArrowDown'],
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  dash: ['ShiftRight'],
}

export const RESERVED_KEYS: ReadonlySet<string> = new Set(['Escape', 'Backquote', 'Enter', 'NumpadEnter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftRight', 'MetaLeft', 'MetaRight', 'F5', 'F11', 'F12'])

const STORAGE_KEY = 'isles-cartoon.keys.v1'
const CODE_PATTERN = /^(Key[A-Z]|Digit[0-9]|Numpad[0-9A-Za-z]+|F[0-9]{1,2}|Space|Tab|CapsLock|ShiftLeft|ControlLeft|ControlRight|AltLeft|AltRight|Backspace|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Insert|Delete|Home|End|PageUp|PageDown)$/

export function isBindable(code: string): boolean {
  return CODE_PATTERN.test(code) && !RESERVED_KEYS.has(code)
}

export function sanitizeKeys(raw: unknown): KeyMap {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_KEYS }
  const source = raw as Partial<Record<KeyAction, unknown>>
  const keys: KeyMap = { ...DEFAULT_KEYS }
  const used = new Set<string>()
  for (const { id } of KEY_ACTIONS) {
    const value = id in source ? source[id] : DEFAULT_KEYS[id]
    const code = typeof value === 'string' && isBindable(value) && !used.has(value) ? value : null
    keys[id] = code
    if (code !== null) used.add(code)
  }
  return keys
}

export function rebind(keys: KeyMap, action: KeyAction, code: string): KeyAction | null {
  if (!isBindable(code)) return null
  const previous = keys[action]
  let swapped: KeyAction | null = null
  for (const { id } of KEY_ACTIONS) {
    if (id === action || keys[id] !== code) continue
    keys[id] = previous
    swapped = id
  }
  keys[action] = code
  return swapped
}

export function actionCodes(keys: KeyMap, action: KeyAction): readonly string[] {
  const bound = keys[action]
  const fixed = FIXED_KEYS[action] ?? []
  return bound === null ? fixed : [bound, ...fixed]
}

export function loadKeys(): KeyMap {
  return sanitizeKeys(readJson(STORAGE_KEY))
}

export function saveKeys(keys: KeyMap): void {
  writeJson(STORAGE_KEY, keys)
}

const NAMED: Readonly<Record<string, string>> = {
  Space: '空格',
  Tab: 'Tab',
  CapsLock: 'Caps Lock',
  ShiftLeft: '左 Shift',
  ShiftRight: '右 Shift',
  ControlLeft: '左 Ctrl',
  ControlRight: '右 Ctrl',
  AltLeft: '左 Alt',
  AltRight: '右 Alt',
  Backspace: '退格',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Insert: 'Insert',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
}

export function keyLabel(code: string | null): string {
  if (code === null) return '未绑定'
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return `小键盘 ${code.slice(6)}`
  return NAMED[code] ?? code
}

export function actionLabel(keys: KeyMap, action: KeyAction): string {
  return keyLabel(keys[action])
}
