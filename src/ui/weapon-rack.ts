import { SPECIAL_WEAPONS, WEAPON_BLURBS, createWeapons, type PlayerWeaponId } from '../data/weapons'
import { assetUrl } from '../render/asset-urls'
import type { Profile } from '../sim/profile'
import { icon } from './assets'
import { button, element } from './dom'

export interface WeaponRack {
  readonly root: HTMLDivElement
  render(profile: Profile): void
}

const NAMES = createWeapons()

export function createWeaponRack(parent: HTMLElement, onCarry: (id: PlayerWeaponId | null) => void): WeaponRack {
  const root = element('div', 'weapon-rack', parent)
  const title = element('div', 'weapon-rack-title', root)
  const row = element('div', 'weapon-rack-row', root)
  const none = button(row, 'ghost small weapon-rack-none', '不带', () => onCarry(null))
  const slots = new Map<PlayerWeaponId, HTMLButtonElement>()
  for (const id of SPECIAL_WEAPONS) {
    const slot = button(row, 'weapon-rack-slot', '', () => onCarry(id))
    icon(slot, 'weapon-rack-icon', assetUrl.weapon(id))
    element('span', 'weapon-rack-name', slot, NAMES[id].name)
    slots.set(id, slot)
  }
  const note = element('div', 'weapon-rack-note', root)
  return {
    root,
    render(profile) {
      const owned = profile.weapons.length
      title.textContent = `武器架 · 带一把进关（已解锁 ${owned} / ${SPECIAL_WEAPONS.length}）`
      none.classList.toggle('active', profile.carry === null)
      for (const [id, slot] of slots) {
        const unlocked = profile.weapons.includes(id)
        slot.disabled = !unlocked
        slot.classList.toggle('locked', !unlocked)
        slot.classList.toggle('active', profile.carry === id)
        slot.title = unlocked ? WEAPON_BLURBS[id] : '捡到一次就解锁'
      }
      note.textContent = profile.carry
        ? `${NAMES[profile.carry].name}：${WEAPON_BLURBS[profile.carry]}。进关时弹药是满的，打空了留在 2 号位，等敌人掉弹药`
        : owned > 0
          ? '这次只带能量枪'
          : '在关卡里捡到特殊武器、或者首次通关，就能把它挂上武器架'
    },
  }
}
