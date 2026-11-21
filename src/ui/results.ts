import { BADGES } from '../data/badges'
import { createWeapons } from '../data/weapons'
import { CHALLENGES } from '../data/challenges'
import type { SpecId } from '../data/progression'
import { assetUrl } from '../render/asset-urls'
import { totalXpAt, type Profile, type Settlement } from '../sim/profile'
import type { RunRating } from '../sim/rating'
import type { RunTallies } from '../sim/tallies'
import { icon } from './assets'
import { createAttributeCards } from './attribute-cards'
import { tallyLines, tallyText } from './level-info'
import { button, element } from './dom'
import { createXpBar, splitXp } from './xp-bar'

const WEAPONS = createWeapons()

export interface ResultsData {
  rating: RunRating
  settlement: Settlement
  tallies: RunTallies
}

export interface ResultsOptions {
  onAllocate(id: SpecId): void
  onReplay(): void
  onPrep(): void
  onNext(): void
  onLevelUp(level: number): void
}

export interface ResultsScreen {
  show(data: ResultsData, profile: Profile): void
  hide(): void
  isOpen(): boolean
  filling(): boolean
  refresh(profile: Profile): void
  setNext(title: string | null): void
  update(dt: number): void
  skip(): void
}

const FILL_SECONDS = 1.4
const FILL_DELAY = 0.4

export function createResults(container: HTMLElement, options: ResultsOptions): ResultsScreen {
  const root = element('div', 'screen results-screen', container)
  icon(root, 'screen-hero', assetUrl.portrait('kai-happy'))
  const panel = element('div', 'screen-panel results-panel', root)
  element('h1', '', panel, '关卡完成')
  const stars = element('div', 'stars', panel)
  const criteria = element('div', 'criteria', panel)
  const reward = element('div', 'reward-lines', panel)
  const xp = createXpBar(panel)
  const levelUp = element('div', 'level-up', panel)
  const note = element('div', 'results-note', panel)
  const allocate = element('div', 'allocate-block', panel)
  const allocateTitle = element('div', 'allocate-title', allocate)
  const cards = createAttributeCards(allocate, options.onAllocate)
  const buttons = element('div', 'screen-buttons', panel)
  button(buttons, 'ghost', '再玩一次（R）', options.onReplay)
  const prep = button(buttons, 'primary', '返回整备（Enter）', options.onPrep)
  const next = button(buttons, 'primary', '下一关', options.onNext)
  next.style.display = 'none'

  let open = false
  let from = 0
  let to = 0
  let elapsed = 0
  let shownLevel = 1
  let latest: Profile | null = null

  const advance = (dt: number) => {
    const before = elapsed
    elapsed += dt
    const t = Math.min(1, Math.max(0, (elapsed - FILL_DELAY) / FILL_SECONDS))
    const eased = 1 - (1 - t) ** 3
    const split = splitXp(from + (to - from) * eased)
    xp.set(split.level, split.xp)
    if (split.level > shownLevel) {
      shownLevel = split.level
      levelUp.textContent = `升级！Lv ${split.level}`
      levelUp.classList.remove('visible')
      void levelUp.offsetWidth
      levelUp.classList.add('visible')
      options.onLevelUp(split.level)
    }
    const done = FILL_DELAY + FILL_SECONDS
    if (before < done && elapsed >= done && latest) showAllocation(latest)
  }

  const skip = () => {
    if (open) advance(Math.max(0, FILL_DELAY + FILL_SECONDS - elapsed))
  }

  // Revealing the allocation panel moves the buttons. Let the intended button receive its click first.
  root.addEventListener('click', skip)

  const showAllocation = (profile: Profile) => {
    const visible = profile.points > 0 && elapsed >= FILL_DELAY + FILL_SECONDS
    allocate.classList.toggle('visible', visible)
    if (!visible) return
    allocateTitle.textContent = `选择一项属性加强（剩余 ${profile.points} 点）`
    cards.render(profile)
  }

  return {
    show(data, profile) {
      open = true
      latest = profile
      root.classList.add('visible')
      const { rating, settlement } = data
      stars.replaceChildren()
      for (let i = 0; i < 3; i++) element('span', i < rating.stars ? 'star on' : 'star', stars, '★')
      criteria.replaceChildren()
      element('div', 'ok', criteria, '✓ 通关')
      element('div', rating.inTime ? 'ok' : 'miss', criteria, `${rating.inTime ? '✓' : '✗'} 用时 ${clock(rating.time)}（目标 ${clock(rating.parSeconds)} 以内）`)
      element('div', rating.fewHits ? 'ok' : 'miss', criteria, `${rating.fewHits ? '✓' : '✗'} 受击 ${rating.hits} 次（不超过 ${rating.maxHits} 次）`)
      element('div', 'plain', criteria, `击败 ${rating.kills} 个敌人`)
      const extras = element('div', 'tally-row', criteria)
      for (const line of tallyLines(data.tallies)) {
        element('span', line.done >= line.total ? 'tally done' : 'tally', extras, tallyText(line))
      }
      const goals = element('div', 'tally-row challenge-row', criteria)
      for (const item of rating.challenges) {
        const def = CHALLENGES[item.id]
        element('span', item.done ? 'tally done' : 'tally', goals, `${item.done ? '✓' : '✗'} 挑战「${def.name}」${def.text}`)
      }
      reward.replaceChildren()
      for (const line of settlement.reward.lines) {
        const row = element('div', 'reward-line', reward)
        element('span', '', row, line.label)
        element('span', 'reward-amount', row, `+${line.amount}`)
      }
      const total = element('div', 'reward-line total', reward)
      element('span', '', total, settlement.reward.replay ? '经验合计（已通关过，减半）' : '经验合计')
      element('span', 'reward-amount', total, `+${settlement.reward.total}`)
      from = totalXpAt(settlement.before.level, settlement.before.xp)
      to = totalXpAt(settlement.after.level, settlement.after.xp)
      elapsed = 0
      shownLevel = settlement.before.level
      xp.set(settlement.before.level, settlement.before.xp)
      levelUp.classList.remove('visible')
      allocate.classList.remove('visible')
      note.textContent = [
        settlement.skillPointsGained > 0 ? `获得 ${settlement.skillPointsGained} 个技能点，回整备界面学习技能` : '',
        ...settlement.newWeapons.map((id) => `武器架解锁：${WEAPONS[id].name}`),
        ...settlement.newBadges.map((id) => `新徽章：${BADGES[id].name}`),
      ]
        .filter(Boolean)
        .join('　')
    },
    hide() {
      open = false
      root.classList.remove('visible')
    },
    isOpen: () => open,
    filling: () => open && elapsed < FILL_DELAY + FILL_SECONDS,
    refresh(profile) {
      latest = profile
      if (open) showAllocation(profile)
    },
    setNext(title) {
      next.style.display = title ? '' : 'none'
      next.textContent = title ? `下一关：${title}（Enter）` : '下一关'
      prep.textContent = title ? '返回整备（Esc）' : '返回整备（Enter）'
      prep.classList.toggle('primary', !title)
      prep.classList.toggle('ghost', Boolean(title))
    },
    update(dt) {
      if (open) advance(dt)
    },
    skip,
  }
}

function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
