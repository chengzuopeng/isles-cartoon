import { SPECS, SPEC_MAX, SPEC_ORDER, type SpecId } from '../data/progression'
import { assetUrl } from '../render/asset-urls'
import { allocationBlock, type Profile } from '../sim/profile'
import { icon } from './assets'
import { element } from './dom'

interface SpecView {
  root: HTMLDivElement
  rank: HTMLSpanElement
  cells: HTMLButtonElement[]
  stones: HTMLDivElement[]
}

export interface SpecBars {
  readonly root: HTMLDivElement
  render(profile: Profile): void
}

export function createAttributeCards(parent: HTMLElement, onPick: (id: SpecId) => void, onRefund?: (id: SpecId) => void): SpecBars {
  const root = element('div', 'spec-grid', parent)
  const views = new Map<SpecId, SpecView>()
  for (const id of SPEC_ORDER) {
    const def = SPECS[id]
    const column = element('div', 'spec-column', root)
    const head = element('div', 'spec-head', column)
    icon(head, 'spec-icon', assetUrl.attribute(def.icon))
    element('span', 'spec-name', head, def.name)
    const rank = element('span', 'spec-rank', head)
    element('div', 'spec-per', column, def.per)
    const bar = element('div', 'spec-bar', column)
    const cells: HTMLButtonElement[] = []
    for (let at = 1; at <= SPEC_MAX; at++) {
      const milestone = def.milestones.find((item) => item.rank === at)
      const cell = element('button', milestone ? 'spec-cell star' : 'spec-cell', bar)
      cell.type = 'button'
      cell.tabIndex = -1
      cell.title = milestone ? `${at} 级 · ${milestone.name}：${milestone.text}` : `${at} 级`
      cell.addEventListener('mousedown', (event) => event.preventDefault())
      cell.addEventListener('click', () => onPick(id))
      cell.addEventListener('contextmenu', (event) => {
        event.preventDefault()
        onRefund?.(id)
      })
      cells.push(cell)
    }
    const stones = def.milestones.map((milestone) => {
      const stone = element('div', 'spec-stone', column)
      element('span', 'spec-stone-name', stone, `${milestone.rank} 级 · ${milestone.name}`)
      element('span', 'spec-stone-text', stone, milestone.text)
      return stone
    })
    views.set(id, { root: column, rank, cells, stones })
  }
  return {
    root,
    render(profile) {
      for (const id of SPEC_ORDER) {
        const view = views.get(id)
        if (!view) continue
        const rank = profile.specs[id]
        const block = allocationBlock(profile, id)
        view.rank.textContent = `${rank} / ${SPEC_MAX}`
        view.cells.forEach((cell, index) => {
          cell.classList.toggle('on', index < rank)
          cell.classList.toggle('next', index === rank && block === null)
        })
        SPECS[id].milestones.forEach((milestone, index) => view.stones[index].classList.toggle('reached', rank >= milestone.rank))
        view.root.classList.toggle('maxed', block === 'maxed')
      }
    },
  }
}
