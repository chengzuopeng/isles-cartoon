import { BOARD_LINES, BOUNTIES, type BountyId } from '../data/bounties'
import { element } from './dom'

export interface BountyBoard {
  readonly root: HTMLDivElement
  render(title: string, ids: readonly BountyId[], chapter: number): void
}

export function createBountyBoard(parent: HTMLElement): BountyBoard {
  const root = element('div', 'bounty-board', parent)
  const head = element('div', 'bounty-board-title', root)
  const line = element('div', 'bounty-board-line', root)
  const row = element('div', 'bounty-board-row', root)
  return {
    root,
    render(title, ids, chapter) {
      head.textContent = `悬赏板 · ${title}（通关时完成的才算数，重玩经验不减半）`
      const pick = [...title].reduce((sum, char) => sum + char.charCodeAt(0), 0)
      line.textContent = BOARD_LINES[pick % BOARD_LINES.length]
      row.replaceChildren()
      for (const id of ids) {
        const def = BOUNTIES[id]
        const card = element('div', 'board-card', row)
        element('span', 'board-card-name', card, def.name)
        element('span', 'board-card-text', card, def.text)
        element('span', 'board-card-xp', card, `赏 ${def.xp * chapter} 经验`)
      }
    },
  }
}
