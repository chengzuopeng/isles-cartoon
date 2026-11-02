import { BUFFS } from '../data/loot'
import type { Tuning } from '../data/tuning'
import type { ScreenPoint, Stage } from '../render/stage'
import type { GameEvent } from '../sim/types'
import type { World } from '../sim/world'
import { element } from './dom'
import { fogVeil, hiddenInFog } from './fog-veil'

export type FloatKind = 'enemy' | 'player' | 'alert' | 'heal' | 'loot' | 'shield' | 'xp'

interface Floating {
  node: HTMLDivElement
  key: string
  value: number
  x: number
  y: number
  height: number
  age: number
  drift: number
  enemy: number | null
  veil: number
}

export interface DamageNumbers {
  handle(event: GameEvent): void
  update(dt: number, world?: World): void
  clear(): void
  setDamageVisible(visible: boolean): void
}

export function followsFog(kind: FloatKind): boolean {
  return kind === 'alert'
}

const LIFETIME = 0.75
const MERGE_WINDOW = 0.35
const NUMBER_HEIGHT = 1.5
const ALERT_HEIGHT = 2
const RISE = 46

export function createDamageNumbers(container: HTMLElement, stage: Stage, tuning: Tuning): DamageNumbers {
  const layer = element('div', 'damage-layer', container)
  const active: Floating[] = []
  const idle: Floating[] = []
  const byKey = new Map<string, Floating>()
  const point: ScreenPoint = { x: 0, y: 0, visible: true }
  let counter = 0
  let damageVisible = true

  const hide = (item: Floating) => {
    item.node.style.display = 'none'
    if (byKey.get(item.key) === item) byKey.delete(item.key)
    idle.push(item)
  }

  const show = (key: string, x: number, y: number, amount: number, kind: FloatKind, label?: string, enemy: number | null = null) => {
    const current = byKey.get(key)
    if (current && label === undefined && kind !== 'alert' && current.age < MERGE_WINDOW) {
      current.value += amount
      current.node.textContent = String(Math.round(current.value))
      current.x = x
      current.y = y
      current.age = 0
      return
    }
    const item = idle.pop() ?? {
      node: element('div', '', layer),
      key,
      value: 0,
      x: 0,
      y: 0,
      height: 0,
      age: 0,
      drift: 0,
      enemy: null,
      veil: -1,
    }
    counter += 1
    item.key = key
    item.value = amount
    item.node.className = `damage ${kind}`
    item.node.textContent = label ?? (kind === 'alert' ? '!' : String(Math.round(amount)))
    item.node.style.display = ''
    item.x = x
    item.y = y
    item.height = kind === 'alert' ? ALERT_HEIGHT : NUMBER_HEIGHT
    item.age = 0
    item.drift = kind === 'alert' || label !== undefined ? 0 : ((counter % 5) - 2) * 9
    item.enemy = followsFog(kind) ? enemy : null
    item.veil = -1
    active.push(item)
    if (kind !== 'alert' && label === undefined) byKey.set(key, item)
  }

  const veiled = (item: Floating, dt: number, world: World | undefined) => {
    if (item.enemy === null || !world) return 0
    const enemy = world.enemies.find((unit) => unit.id === item.enemy && unit.hp > 0)
    item.veil = fogVeil(item.veil, hiddenInFog(world, enemy?.pos.x ?? item.x, enemy?.pos.y ?? item.y), dt)
    return item.veil
  }

  return {
    handle(event) {
      switch (event.type) {
        case 'enemyHit':
          if (damageVisible) show(`enemy:${event.id}`, event.x, event.y, event.damage, 'enemy')
          break
        case 'playerHit':
          if (!damageVisible) break
          if (event.damage > 0) show('player', event.x, event.y, event.damage, 'player')
          else if (event.absorbed > 0) show('shield', event.x, event.y, event.absorbed, 'shield')
          break
        case 'enemyAlerted':
          show(`alert:${event.id}`, event.x, event.y, 0, 'alert', undefined, event.id)
          break
        case 'enemySuspicious':
          show(`alert:${event.id}`, event.x, event.y, 0, 'alert', '?', event.id)
          break
        case 'pickedUp': {
          const { item } = event
          if (item.type === 'heal') show('', event.x, event.y, 0, 'heal', `+${Math.round(event.amount)}`)
          else if (item.type === 'buff') show('', event.x, event.y, 0, 'loot', BUFFS[item.buff].name)
          else if (item.type === 'ammo') show('', event.x, event.y, 0, 'loot', `弹药 +${event.amount}`)
          else show('', event.x, event.y, 0, 'loot', tuning.weapons[item.weapon].name)
          break
        }
        case 'supplyUsed':
          show('', event.x, event.y, 0, 'heal', `+${Math.round(event.amount)}`)
          break
        case 'bonusXp':
          show('', event.x, event.y, 0, 'xp', `经验 +${Math.round(event.amount)}`)
          break
        default:
          break
      }
    },
    update(dt, world) {
      for (let i = active.length - 1; i >= 0; i--) {
        const item = active[i]
        item.age += dt
        const t = item.age / LIFETIME
        if (t >= 1) {
          active.splice(i, 1)
          hide(item)
          continue
        }
        stage.project(item.x, item.height, item.y, point)
        const rise = RISE * (1 - (1 - t) ** 3)
        const pop = t < 0.12 ? 1.35 - (t / 0.12) * 0.35 : 1
        const x = point.x + item.drift * t
        const y = point.y - rise
        item.node.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%) scale(${pop.toFixed(3)})`
        const shown = 1 - veiled(item, dt, world)
        const opacity = t < 0.65 ? 1 : (1 - t) / 0.35
        item.node.style.opacity = shown >= 1 && t < 0.65 ? '1' : (opacity * shown).toFixed(3)
      }
    },
    clear() {
      for (const item of active) hide(item)
      active.length = 0
    },
    setDamageVisible(visible) {
      damageVisible = visible
    },
  }
}
