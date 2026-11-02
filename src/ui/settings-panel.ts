import type { Settings } from '../core/settings'
import { RESOLUTIONS, RESOLUTION_ORDER, SHADOW_LEVELS, SHADOW_ORDER } from '../data/quality'
import { DEFAULT_KEYS, KEY_ACTIONS, isBindable, keyLabel, rebind, type KeyAction, type KeyMap } from '../input/keymap'
import { DEFAULT_LOOK_SETTINGS, LOOK_LIMITS, type LookSettings } from '../input/look-settings'
import { button, element } from './dom'
import './settings-panel.css'

export interface SettingsPanelOptions {
  onChange(settings: Settings): void
  onResetTips(): void
  look: LookSettings
  onLook(look: LookSettings): void
  keys: KeyMap
  onKeys(keys: KeyMap): void
}

export interface SettingsPanel {
  open(): void
  close(): void
  isOpen(): boolean
  capturing(): boolean
}

type VolumeKey = 'music' | 'sfx' | 'shake'
type ToggleKey = 'damageNumbers' | 'tips' | 'antialias'

interface Toggle {
  key: ToggleKey
  label: string
  note?: string
}

interface LookSlider {
  key: 'sensitivity' | 'fov' | 'eyeHeight'
  label: string
  step: number
  format(value: number): string
}

const SLIDERS: readonly { key: VolumeKey; label: string }[] = [
  { key: 'music', label: '音乐音量' },
  { key: 'sfx', label: '音效音量' },
  { key: 'shake', label: '震屏强度' },
]

const TOGGLES: readonly Toggle[] = [
  { key: 'damageNumbers', label: '显示伤害数字' },
  { key: 'tips', label: '新手提示' },
]

const ANTIALIAS: Toggle = { key: 'antialias', label: '抗锯齿', note: '重启游戏后生效' }

const LOOK_SLIDERS: readonly LookSlider[] = [
  { key: 'sensitivity', label: '鼠标灵敏度', step: 0.005, format: (value) => (value / DEFAULT_LOOK_SETTINGS.sensitivity).toFixed(2) },
  { key: 'fov', label: '视野角', step: 1, format: (value) => `${Math.round(value)}°` },
  { key: 'eyeHeight', label: '眼睛高度', step: 0.05, format: (value) => `${value.toFixed(2)} 米` },
]

const LOOK_TOGGLES: readonly { key: 'bob' | 'invertY'; label: string }[] = [
  { key: 'bob', label: '跑动时镜头晃动' },
  { key: 'invertY', label: '鼠标 Y 轴反转' },
]

const FIXED_CONTROLS: readonly [string, string][] = [
  ['鼠标', '视角'],
  ['左键', '射击'],
  ['右键', '枪托砸（砸散快散架的机器人能回血）'],
  ['Esc', '暂停'],
]

export function createSettingsPanel(container: HTMLElement, settings: Settings, options: SettingsPanelOptions): SettingsPanel {
  const root = element('div', 'settings-screen', container)
  const panel = element('div', 'settings-panel', root)
  element('h2', '', panel, '设置')
  for (const { key, label } of SLIDERS) {
    const row = element('label', 'settings-row', panel)
    element('span', 'settings-label', row, label)
    const input = element('input', 'settings-slider', row)
    input.type = 'range'
    input.min = '0'
    input.max = '100'
    input.step = '5'
    input.value = String(Math.round(settings[key] * 100))
    const value = element('span', 'settings-value', row, `${input.value}%`)
    input.addEventListener('input', () => {
      settings[key] = Number(input.value) / 100
      value.textContent = `${input.value}%`
      options.onChange(settings)
    })
  }
  const toggle = ({ key, label, note }: Toggle) => {
    const row = element('label', note ? 'settings-row toggle noted' : 'settings-row toggle', panel)
    element('span', 'settings-label', row, label)
    const input = element('input', 'settings-check', row)
    input.type = 'checkbox'
    input.checked = settings[key]
    if (note) element('span', 'settings-note', row, note)
    input.addEventListener('change', () => {
      settings[key] = input.checked
      options.onChange(settings)
    })
  }
  for (const item of TOGGLES) toggle(item)
  const tools = element('div', 'settings-tools', panel)
  const resetTips = button(tools, 'ghost small', '重新显示新手提示', () => {
    options.onResetTips()
    resetTips.textContent = '已重置，会再提示一遍'
    resetTips.disabled = true
  })

  element('h3', '', panel, '视角')
  const look = options.look
  const lookRefreshers: (() => void)[] = []
  for (const slider of LOOK_SLIDERS) {
    const row = element('label', 'settings-row', panel)
    element('span', 'settings-label', row, slider.label)
    const input = element('input', 'settings-slider', row)
    const [low, high] = LOOK_LIMITS[slider.key]
    input.type = 'range'
    input.min = String(low)
    input.max = String(high)
    input.step = String(slider.step)
    const value = element('span', 'settings-value', row)
    const refresh = () => {
      input.value = String(look[slider.key])
      value.textContent = slider.format(look[slider.key])
    }
    refresh()
    lookRefreshers.push(refresh)
    input.addEventListener('input', () => {
      look[slider.key] = Number(input.value)
      value.textContent = slider.format(look[slider.key])
      options.onLook(look)
    })
  }
  for (const { key, label } of LOOK_TOGGLES) {
    const row = element('label', 'settings-row toggle', panel)
    element('span', 'settings-label', row, label)
    const input = element('input', 'settings-check', row)
    input.type = 'checkbox'
    lookRefreshers.push(() => {
      input.checked = look[key]
    })
    input.addEventListener('change', () => {
      look[key] = input.checked
      options.onLook(look)
    })
  }
  const lookTools = element('div', 'settings-tools', panel)
  button(lookTools, 'ghost small', '视角恢复默认', () => {
    Object.assign(look, DEFAULT_LOOK_SETTINGS)
    for (const refresh of lookRefreshers) refresh()
    options.onLook(look)
  })
  for (const refresh of lookRefreshers) refresh()

  element('h3', '', panel, '画质')
  const refreshers = [
    choices(panel, '渲染分辨率', RESOLUTION_ORDER, (id) => RESOLUTIONS[id].name, () => settings.resolution, (id) => {
      settings.resolution = id
      options.onChange(settings)
    }),
    choices(panel, '阴影', SHADOW_ORDER, (id) => SHADOW_LEVELS[id].name, () => settings.shadows, (id) => {
      settings.shadows = id
      options.onChange(settings)
    }),
  ]
  toggle(ANTIALIAS)

  element('h3', '', panel, '按键')
  element('div', 'settings-hint', panel, '点一下按键再按新的键改键；按 Esc 取消。和别的动作撞键时两边互换。')
  const keys = options.keys
  const bindings = element('div', 'settings-bindings', panel)
  const keyButtons = new Map<KeyAction, HTMLButtonElement>()
  let waiting: KeyAction | null = null
  const renderKeys = () => {
    for (const [id, node] of keyButtons) {
      node.textContent = id === waiting ? '按下新按键…' : keyLabel(keys[id])
      node.classList.toggle('waiting', id === waiting)
      node.classList.toggle('unbound', keys[id] === null && id !== waiting)
    }
  }
  for (const action of KEY_ACTIONS) {
    element('span', 'settings-action', bindings, action.label)
    const node = button(bindings, 'ghost small settings-bind', '', () => {
      waiting = waiting === action.id ? null : action.id
      renderKeys()
    })
    keyButtons.set(action.id, node)
    element('span', 'settings-fixed', bindings, action.fixed ? `另有 ${action.fixed}` : '')
  }
  const keyTools = element('div', 'settings-tools', panel)
  button(keyTools, 'ghost small', '按键恢复默认', () => {
    Object.assign(keys, DEFAULT_KEYS)
    waiting = null
    renderKeys()
    options.onKeys(keys)
  })
  const fixed = element('div', 'settings-keys', panel)
  for (const [key, action] of FIXED_CONTROLS) {
    element('span', 'settings-key', fixed, key)
    element('span', 'settings-action', fixed, action)
  }
  renderKeys()

  const buttons = element('div', 'screen-buttons', panel)
  button(buttons, 'primary', '关闭（Esc）', () => close())
  let open = false

  const close = () => {
    open = false
    waiting = null
    renderKeys()
    const focused = document.activeElement
    if (focused instanceof HTMLElement && root.contains(focused)) focused.blur()
    root.classList.remove('visible')
  }

  window.addEventListener(
    'keydown',
    (event) => {
      if (!open || waiting === null) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.code !== 'Escape' && isBindable(event.code)) {
        rebind(keys, waiting, event.code)
        options.onKeys(keys)
      }
      waiting = null
      renderKeys()
    },
    true,
  )

  root.addEventListener('keydown', (event) => {
    if (event.code !== 'Escape' || waiting !== null) return
    event.preventDefault()
    close()
  })

  return {
    open() {
      open = true
      waiting = null
      resetTips.textContent = '重新显示新手提示'
      resetTips.disabled = false
      for (const refresh of refreshers) refresh()
      for (const refresh of lookRefreshers) refresh()
      renderKeys()
      root.classList.add('visible')
    },
    close,
    isOpen: () => open,
    capturing: () => waiting !== null,
  }
}

function choices<T extends string>(
  panel: HTMLElement,
  label: string,
  order: readonly T[],
  name: (id: T) => string,
  current: () => T,
  pick: (id: T) => void,
): () => void {
  const row = element('div', 'settings-row choice', panel)
  element('span', 'settings-label', row, label)
  const group = element('div', 'settings-choices', row)
  group.setAttribute('role', 'group')
  group.setAttribute('aria-label', label)
  const nodes = new Map<T, HTMLButtonElement>()
  const refresh = () => {
    for (const [id, node] of nodes) {
      node.classList.toggle('active', id === current())
      node.setAttribute('aria-pressed', String(id === current()))
    }
  }
  for (const id of order) {
    nodes.set(
      id,
      button(group, 'ghost', name(id), () => {
        pick(id)
        refresh()
      }),
    )
  }
  refresh()
  return refresh
}
