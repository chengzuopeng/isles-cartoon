import { BADGES, BADGE_ORDER, BADGE_SLOT_LEVELS, type BadgeId } from '../data/badges'
import { badgeSlots, ownedBadges, type Profile } from '../sim/profile'
import { button, element } from './dom'

export interface BadgeBox {
  readonly root: HTMLDivElement
  render(profile: Profile): void
}

export function createBadgeBox(parent: HTMLElement, onToggle: (id: BadgeId) => void): BadgeBox {
  const root = element('div', 'badge-box', parent)
  const title = element('div', 'badge-title', root)
  const slots = element('div', 'badge-slots', root)
  const grid = element('div', 'badge-grid', root)
  const cards = new Map<BadgeId, HTMLButtonElement>()
  for (const id of BADGE_ORDER) {
    const def = BADGES[id]
    const card = button(grid, 'badge-card', '', () => onToggle(id))
    element('span', 'badge-name', card, def.name)
    element('span', 'badge-text', card, def.text)
    element('span', 'badge-how', card, def.how)
    cards.set(id, card)
  }
  return {
    root,
    render(profile) {
      const owned = ownedBadges(profile)
      const open = badgeSlots(profile)
      title.textContent = `徽章 · 已拿到 ${owned.length} / ${BADGE_ORDER.length}，装备 ${profile.badges.length} / ${open}（点一下装上或取下）`
      slots.textContent = BADGE_SLOT_LEVELS.map((level, index) => {
        if (profile.level < level) return `槽 ${index + 1}：${level} 级开放`
        const id = profile.badges[index]
        return `槽 ${index + 1}：${id ? BADGES[id].name : '空'}`
      }).join('　　')
      for (const [id, card] of cards) {
        const has = owned.includes(id)
        const worn = profile.badges.includes(id)
        card.classList.toggle('locked', !has)
        card.classList.toggle('worn', worn)
        card.disabled = !has || (!worn && profile.badges.length >= open)
      }
    },
  }
}
