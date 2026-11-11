import { CARDS, type CardId } from '../data/supply-cards'
import { element } from './dom'

export interface SupplyCards {
  show(cards: readonly CardId[]): void
  hide(): void
  isOpen(): boolean
  setTaken(cards: readonly CardId[]): void
}

export function createSupplyCards(container: HTMLElement, onPick: (index: number) => void): SupplyCards {
  const root = element('div', 'supply-cards', container)
  element('div', 'supply-cards-title', root, '补给点 · 挑一张，到本关结束都有效（按数字键选）')
  const row = element('div', 'supply-cards-row', root)
  const taken = element('div', 'supply-taken', container)
  let open = false
  return {
    show(cards) {
      open = true
      row.replaceChildren()
      cards.forEach((id, index) => {
        const card = element('button', 'supply-card', row)
        card.type = 'button'
        element('span', 'supply-card-key', card, String(index + 1))
        element('span', 'supply-card-name', card, CARDS[id].name)
        element('span', 'supply-card-text', card, CARDS[id].text)
        card.addEventListener('click', () => onPick(index))
      })
      root.classList.add('visible')
    },
    hide() {
      open = false
      root.classList.remove('visible')
    },
    isOpen: () => open,
    setTaken(cards) {
      taken.textContent = cards.length > 0 ? `补给：${cards.map((id) => CARDS[id].name).join('、')}` : ''
    },
  }
}
