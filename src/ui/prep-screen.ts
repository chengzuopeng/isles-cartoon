import { CHALLENGES, type ChallengeId } from '../data/challenges'
import { CHAPTERS } from '../data/chapters'
import { DIFFICULTIES, DIFFICULTY_ORDER, type DifficultyId } from '../data/difficulty'
import type { AttributeId } from '../data/progression'
import type { SkillId, SkillSlot } from '../data/skills'
import { assetUrl, type SceneId } from '../render/asset-urls'
import { clueBook, recordOf, seenInterludes, spentPoints, type Profile } from '../sim/profile'
import { icon } from './assets'
import { createAttributeCards } from './attribute-cards'
import { button, element } from './dom'
import { createSkillCards } from './skill-cards'
import { createXpBar } from './xp-bar'

export interface PrepLevelInfo {
  id: string
  title: string
  subtitle: string
  objective: string
  chapter: number
  challenges: readonly ChallengeId[]
  unlockAfter?: string
  wip?: string
}

export interface PrepScreenOptions {
  missions: PrepLevelInfo[]
  onStart(id: string): void
  onAllocate(id: AttributeId): void
  onRespec(): void
  onLearn(id: SkillId): void
  onEquip(id: SkillId, slot: SkillSlot): void
  onResetSkills(): void
  onSettings(): void
  onDifficulty(id: DifficultyId): void
  onInterlude(id: string): void
  difficulty(): DifficultyId
  isUnlocked(id: string, profile: Profile): boolean
}

export interface PrepScreen {
  show(profile: Profile, selected: string): void
  hide(): void
  isOpen(): boolean
  covers(): boolean
  refresh(profile: Profile): void
  setLoading(id: string | null): void
  setStaged(staged: boolean): void
}

interface MissionView {
  root: HTMLDivElement
  record: HTMLDivElement
  goals: HTMLDivElement
  start: HTMLButtonElement
}

interface IsleView {
  id: number
  levels: readonly string[]
  pin: HTMLDivElement
  row: HTMLDivElement
  status: HTMLSpanElement
}

const ISLE_SPOTS: Readonly<Record<number, readonly [number, number]>> = {
  1: [19, 62],
  2: [66, 70],
  3: [20, 25],
  4: [73, 24],
  5: [89, 47],
}

const TOWER_SPOT: readonly [number, number] = [46, 41]

const MISSION_CARDS: Readonly<Record<string, SceneId>> = {
  '1-1': 'card-1-1',
  '1-2': 'card-1-2',
  '1-3': 'card-1-3',
  '1-4': 'card-1-4',
  '1-5': 'card-1-5',
  'trial-systems': 'card-trial-systems',
  'trial-harvester': 'card-trial-harvester',
}

export function createPrepScreen(container: HTMLElement, options: PrepScreenOptions): PrepScreen {
  const root = element('div', 'screen prep-screen', container)
  const backdrop = assetUrl.scene('prep-observatory')
  root.style.backgroundImage = `linear-gradient(rgba(8, 10, 16, 0.25), rgba(8, 10, 16, 0.55)), url(${backdrop})`
  let backdropReady = false
  const art = new Image()
  art.addEventListener('load', () => {
    backdropReady = true
  })
  art.src = backdrop
  icon(root, 'screen-hero', assetUrl.portrait('kai-normal'))
  const panel = element('div', 'screen-panel prep-panel', root)
  icon(panel, 'prep-logo', assetUrl.logo())
  const header = element('div', 'prep-header', panel)
  element('h1', '', header, '整备')
  element('div', 'prep-hero', header, '凯 · 见习赏金猎人')
  button(header, 'ghost small prep-settings', '设置', options.onSettings)
  const xp = createXpBar(panel)
  const points = element('div', 'prep-points', panel)
  const cards = createAttributeCards(panel, options.onAllocate)
  const tools = element('div', 'prep-tools', panel)
  const respec = button(tools, 'ghost', '重置加点（免费）', options.onRespec)
  const skills = createSkillCards(panel, { onLearn: options.onLearn, onEquip: options.onEquip, onReset: options.onResetSkills })
  const difficulty = element('div', 'prep-difficulty', panel)
  element('span', 'prep-difficulty-label', difficulty, '难度')
  const choiceRow = element('div', 'prep-difficulty-options', difficulty)
  const choices = new Map<DifficultyId, HTMLButtonElement>()
  for (const id of DIFFICULTY_ORDER) choices.set(id, button(choiceRow, 'ghost', DIFFICULTIES[id].name, () => options.onDifficulty(id)))
  const blurb = element('div', 'prep-difficulty-blurb', difficulty)
  const isles = element('div', 'prep-isles', panel)
  const chart = element('div', 'prep-isles-map', isles)
  icon(chart, 'prep-isles-art', assetUrl.scene('archipelago'))
  place(element('div', 'prep-isle-tower', chart, '星穹塔'), TOWER_SPOT)
  const chapterList = element('div', 'prep-isles-list', isles)
  const isleViews: IsleView[] = CHAPTERS.map((chapter) => {
    const pin = element('div', 'prep-isle-pin', chart)
    place(pin, ISLE_SPOTS[chapter.id] ?? [50, 50])
    element('span', 'prep-isle-number', pin, String(chapter.id))
    element('span', 'prep-isle-name', pin, chapter.name)
    const row = element('div', 'prep-isle-row', chapterList)
    const head = element('div', 'prep-isle-head', row)
    element('span', 'prep-isle-title', head, `第 ${chapter.id} 章 · ${chapter.name}`)
    const status = element('span', 'prep-isle-status', head)
    element('div', 'prep-isle-subtitle', row, chapter.title)
    return { id: chapter.id, levels: chapter.levels, pin, row, status }
  })
  const missionList = element('div', 'prep-missions', panel)
  const missions = new Map<string, MissionView>()
  for (const mission of options.missions) {
    const card = element('div', 'prep-mission', missionList)
    const scene = MISSION_CARDS[mission.id]
    if (scene) icon(card, 'prep-mission-thumb', assetUrl.scene(scene))
    else icon(card, 'prep-mission-thumb placeholder', assetUrl.item('emblem'))
    const text = element('div', 'prep-mission-text', card)
    element('div', 'prep-mission-title', text, `${mission.title} · ${mission.subtitle}`)
    element('div', 'prep-mission-line', text, `目标：${mission.objective}`)
    if (mission.wip) element('div', 'prep-mission-wip', text, mission.wip)
    const record = element('div', 'prep-mission-line', text)
    const goals = element('div', 'prep-mission-goals', text)
    const start = button(card, 'primary', '出发', () => options.onStart(mission.id))
    missions.set(mission.id, { root: card, record, goals, start })
  }
  const book = element('div', 'prep-clues', panel)
  const stories = element('div', 'prep-stories', panel)
  let open = false
  let selected = options.missions[0]?.id ?? ''
  let loading: string | null = null
  let current: Profile | null = null

  const titleOf = (id: string) => options.missions.find((mission) => mission.id === id)?.title ?? id
  const chapterOfSelected = () => options.missions.find((mission) => mission.id === selected)?.chapter ?? 1

  const renderIsles = (profile: Profile) => {
    const chapter = chapterOfSelected()
    for (const view of isleViews) {
      const ready = view.levels.length > 0
      const cleared = view.levels.filter((id) => recordOf(profile, id)?.cleared).length
      view.status.textContent = !ready ? '未开放' : cleared >= view.levels.length ? `已通关 ${cleared} / ${view.levels.length}` : `进度 ${cleared} / ${view.levels.length}`
      for (const node of [view.pin, view.row]) {
        node.classList.toggle('locked', !ready)
        node.classList.toggle('current', view.id === chapter)
      }
    }
  }

  const renderStories = (profile: Profile) => {
    const seen = seenInterludes(profile, chapterOfSelected())
    stories.replaceChildren()
    stories.style.display = seen.length > 0 ? '' : 'none'
    for (const item of seen) button(stories, 'ghost small', `回看幕间：${item.title}`, () => options.onInterlude(item.id))
  }

  const renderBook = (profile: Profile) => {
    const chapter = chapterOfSelected()
    const entries = clueBook(profile, chapter)
    book.replaceChildren()
    book.style.display = entries.length > 0 ? '' : 'none'
    if (entries.length === 0) return
    const found = entries.filter((entry) => entry.found).length
    element('div', 'prep-clues-title', book, `线索簿 · 第 ${chapter} 章（${found} / ${entries.length}）`)
    for (const entry of entries) {
      const row = element('div', entry.found ? 'prep-clue' : 'prep-clue missing', book)
      element('span', 'prep-clue-level', row, entry.level)
      const body = element('div', 'prep-clue-body', row)
      element('div', 'prep-clue-title', body, entry.title)
      if (entry.text) element('div', 'prep-clue-text', body, entry.text)
    }
  }

  const refresh = (profile: Profile) => {
    current = profile
    xp.set(profile.level, profile.xp)
    points.textContent = profile.points > 0 ? `可分配属性点：${profile.points}` : '没有可分配的属性点，升级后获得'
    points.classList.toggle('has-points', profile.points > 0)
    cards.render(profile)
    respec.disabled = spentPoints(profile) === 0
    skills.render(profile)
    const level = options.difficulty()
    for (const [id, choice] of choices) choice.classList.toggle('active', id === level)
    blurb.textContent = DIFFICULTIES[level].blurb
    for (const [id, view] of missions) {
      const best = recordOf(profile, id)
      const unlocked = options.isUnlocked(id, profile)
      const mission = options.missions.find((item) => item.id === id)
      const after = mission?.unlockAfter
      const earned = best?.challenges ?? []
      const goals = mission && mission.challenges.length > 0 ? ` · 挑战 ${earned.length} / ${mission.challenges.length}` : ''
      view.record.textContent = !unlocked
        ? `通关「${after ? titleOf(after) : ''}」后解锁`
        : best?.cleared
          ? `最佳 ${'★'.repeat(best.bestStars)}${'☆'.repeat(3 - best.bestStars)}${goals} · 已通关，重玩经验减半`
          : '首次通关：经验全额'
      view.goals.replaceChildren()
      if (mission && mission.challenges.length > 0) {
        element('span', 'prep-goal-label', view.goals, '挑战')
        for (const challenge of mission.challenges) {
          const done = earned.includes(challenge)
          const chip = element('span', done ? 'prep-goal done' : 'prep-goal', view.goals, `${done ? '✓ ' : ''}${CHALLENGES[challenge].name}`)
          chip.title = CHALLENGES[challenge].text
        }
      }
      view.root.classList.toggle('selected', id === selected)
      view.root.classList.toggle('locked', !unlocked)
      view.start.disabled = !unlocked || loading !== null
      view.start.textContent = !unlocked ? '未解锁' : id === loading ? '加载中…' : id === selected ? '出发（Enter）' : '出发'
    }
    renderIsles(profile)
    renderBook(profile)
    renderStories(profile)
  }

  return {
    show(profile, current) {
      open = true
      if (missions.has(current)) selected = current
      if (!options.isUnlocked(selected, profile)) selected = options.missions.find((mission) => options.isUnlocked(mission.id, profile))?.id ?? selected
      root.classList.remove('staged')
      root.classList.add('visible')
      refresh(profile)
    },
    setStaged(staged) {
      root.classList.toggle('staged', staged)
    },
    hide() {
      open = false
      root.classList.remove('visible')
    },
    isOpen: () => open,
    covers: () => open && backdropReady,
    refresh(profile) {
      if (open) refresh(profile)
    },
    setLoading(id) {
      loading = id
      if (open && current) refresh(current)
    },
  }
}

function place(node: HTMLElement, [x, y]: readonly [number, number]): void {
  node.style.left = `${x}%`
  node.style.top = `${y}%`
}
