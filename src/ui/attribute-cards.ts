import { ATTRIBUTES, ATTRIBUTE_ORDER, RECOVERY_DELAY_PER_RANK, type AttributeId } from '../data/progression'
import { assetUrl } from '../render/asset-urls'
import { allocationBlock, nextRankLevel, type Profile } from '../sim/profile'
import { icon } from './assets'
import { element } from './dom'

interface CardView {
  root: HTMLButtonElement
  rank: HTMLDivElement
  current: HTMLDivElement
  next: HTMLDivElement
}

export interface AttributeCards {
  readonly root: HTMLDivElement
  render(profile: Profile): void
}

export function createAttributeCards(parent: HTMLElement, onPick: (id: AttributeId) => void): AttributeCards {
  const root = element('div', 'attr-grid', parent)
  const cards = new Map<AttributeId, CardView>()
  for (const id of ATTRIBUTE_ORDER) {
    const card = element('button', 'attr-card', root)
    card.type = 'button'
    card.tabIndex = -1
    const head = element('div', 'attr-head', card)
    icon(head, 'attr-icon', assetUrl.attribute(id))
    const title = element('div', 'attr-title', head)
    element('div', 'attr-name', title, ATTRIBUTES[id].name)
    const rank = element('div', 'attr-rank', title)
    const current = element('div', 'attr-effect', card)
    const next = element('div', 'attr-next', card)
    card.addEventListener('mousedown', (event) => event.preventDefault())
    card.addEventListener('click', () => onPick(id))
    cards.set(id, { root: card, rank, current, next })
  }
  return {
    root,
    render(profile) {
      for (const id of ATTRIBUTE_ORDER) {
        const view = cards.get(id)
        if (!view) continue
        const rank = profile.attributes[id]
        const max = ATTRIBUTES[id].maxRank
        const block = allocationBlock(profile, id)
        view.rank.textContent = `${rank} / ${max}`
        view.current.textContent = rank > 0 ? effectText(id, rank) : '尚未加点'
        view.next.textContent = describeNext(id, rank, block)
        view.root.disabled = block !== null
        view.root.classList.toggle('maxed', block === 'maxed')
        view.root.classList.toggle('locked', block === 'level' || block === 'skill')
      }
    },
  }
}

function describeNext(id: AttributeId, rank: number, block: ReturnType<typeof allocationBlock>): string {
  switch (block) {
    case 'maxed':
      return '已加满'
    case 'level':
      return `${nextRankLevel(id, rank)} 级解锁下一级`
    case 'skill':
      return '学会技能后开放'
    default:
      return `下一级：${effectText(id, rank + 1)}`
  }
}

export function effectText(id: AttributeId, rank: number): string {
  const total = ATTRIBUTES[id].perRank * rank
  switch (id) {
    case 'health':
      return `最大生命 +${percent(total)}`
    case 'damage':
      return `伤害 +${percent(total)}`
    case 'fireRate':
      return `攻击间隔 −${percent(total)}`
    case 'reload':
      return `装填时间 −${percent(total)}`
    case 'speed':
      return `移速 +${percent(total)}`
    case 'magazine':
      return `主武器弹药 +${total} 格`
    case 'recovery':
      return `回血 +${percent(total)}，等待 −${(RECOVERY_DELAY_PER_RANK * rank).toFixed(1)} 秒`
    case 'cooldown':
      return `技能冷却 −${percent(total)}`
  }
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}
