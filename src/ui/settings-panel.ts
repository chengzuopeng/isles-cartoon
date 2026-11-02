import type { Settings } from '../core/settings'
import { RESOLUTIONS, RESOLUTION_ORDER, SHADOW_LEVELS, SHADOW_ORDER } from '../data/quality'
import { button, element } from './dom'
import './settings-panel.css'

export interface SettingsPanelOptions {
  onChange(settings: Settings): void
  onResetTips(): void
}

export interface SettingsPanel {
  open(): void
  close(): void
  isOpen(): boolean
}

type VolumeKey = 'music' | 'sfx' | 'shake'
type ToggleKey = 'damageNumbers' | 'tips' | 'antialias'

interface Toggle {
  key: ToggleKey
  label: string
  note?: string
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

const CONTROLS: readonly [string, string][] = [
  ['WASD', '移动'],
  ['鼠标', '视角'],
  ['左键', '射击'],
  ['右键', '枪托砸（砸散快散架的机器人能回血）'],
  ['Shift', '冲刺闪避'],
  ['空格', '跳'],
  ['R', '大招'],
  ['1 / 2 / 滚轮', '切换主武器和特殊武器'],
  ['Q / E', '技能'],
  ['F', '拾取武器、开宝箱'],
  ['M', '地图'],
  ['Esc', '暂停'],
  ['N', '静音'],
]

export function createSettingsPanel(
  container: HTMLElement,
  settings: Settings,
  options: SettingsPanelOptions,
): SettingsPanel {
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
  element('h3', '', panel, '按键说明')
  const keys = element('div', 'settings-keys', panel)
  for (const [key, action] of CONTROLS) {
    element('span', 'settings-key', keys, key)
    element('span', 'settings-action', keys, action)
  }
  const buttons = element('div', 'screen-buttons', panel)
  button(buttons, 'primary', '关闭（Esc）', () => close())
  let open = false

  const close = () => {
    open = false
    const focused = document.activeElement
    if (focused instanceof HTMLElement && root.contains(focused)) focused.blur()
    root.classList.remove('visible')
  }

  root.addEventListener('keydown', (event) => {
    if (event.code !== 'Escape') return
    event.preventDefault()
    close()
  })

  return {
    open() {
      open = true
      resetTips.textContent = '重新显示新手提示'
      resetTips.disabled = false
      for (const refresh of refreshers) refresh()
      root.classList.add('visible')
    },
    close,
    isOpen: () => open,
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
