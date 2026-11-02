import { SKILLS, SKILL_ORDER, SKILL_SLOTS, SLOT_UNLOCK_LEVEL, type SkillId, type SkillSlot } from '../data/skills'
import { assetUrl } from '../render/asset-urls'
import { skillBlock, skillPointsLeft, skillPointsSpent, skillRank, slotUnlocked, type Profile } from '../sim/profile'
import { icon } from './assets'
import { button, element } from './dom'

export interface SkillCardsOptions {
  onLearn(id: SkillId): void
  onEquip(id: SkillId, slot: SkillSlot): void
  onReset(): void
}

export interface SkillCards {
  readonly root: HTMLDivElement
  render(profile: Profile): void
}

interface SkillView {
  pips: HTMLSpanElement[]
  lines: HTMLDivElement[]
  learn: HTMLButtonElement
  equip: Map<SkillSlot, HTMLButtonElement>
}

export function createSkillCards(parent: HTMLElement, options: SkillCardsOptions): SkillCards {
  const root = element('div', 'skill-section', parent)
  const header = element('div', 'skill-header', root)
  const title = element('div', 'skill-title', header)
  const reset = button(header, 'ghost small', '重置技能（免费）', options.onReset)
  const slotsLine = element('div', 'skill-slots-line', root)
  const grid = element('div', 'skill-grid', root)
  const views = new Map<SkillId, SkillView>()
  for (const id of SKILL_ORDER) {
    const def = SKILLS[id]
    const card = element('div', 'skill-card', grid)
    const head = element('div', 'skill-card-head', card)
    icon(head, 'skill-card-icon', assetUrl.skill(id))
    element('span', 'skill-card-name', head, def.name)
    element('span', 'skill-card-kind', head, def.kind)
    const pipRow = element('span', 'skill-pips', head)
    const pips = [0, 1, 2].map(() => element('span', 'skill-pip', pipRow))
    const lines = def.lines.map((line, index) => element('div', 'skill-line', card, `${index + 1} 级：${line}`))
    const actions = element('div', 'skill-actions', card)
    const learn = button(actions, 'small', '', () => options.onLearn(id))
    const equip = new Map<SkillSlot, HTMLButtonElement>()
    for (const slot of SKILL_SLOTS) equip.set(slot, button(actions, 'ghost small', '', () => options.onEquip(id, slot)))
    views.set(id, { pips, lines, learn, equip })
  }

  return {
    root,
    render(profile) {
      const points = skillPointsLeft(profile)
      title.textContent = `技能 · 可用技能点 ${points}（每 3 级 1 点）`
      title.classList.toggle('has-points', points > 0)
      reset.disabled = skillPointsSpent(profile) === 0
      slotsLine.textContent = SKILL_SLOTS.map((slot) => {
        if (!slotUnlocked(profile, slot)) return `${slot.toUpperCase()}：${SLOT_UNLOCK_LEVEL[slot]} 级开放`
        const id = profile.equipped[slot]
        return `${slot.toUpperCase()}：${id ? SKILLS[id].name : '空'}`
      }).join('　　')
      for (const id of SKILL_ORDER) {
        const view = views.get(id)
        if (!view) continue
        const rank = skillRank(profile, id)
        view.pips.forEach((pip, index) => pip.classList.toggle('on', index < rank))
        view.lines.forEach((line, index) => line.classList.toggle('on', index < rank))
        const block = skillBlock(profile, id)
        view.learn.disabled = block !== null
        view.learn.textContent =
          block === 'maxed' ? '已满级' : block === 'chapter' ? `第 ${SKILLS[id].unlockChapter} 章解锁` : rank === 0 ? '学习（1 点）' : '升级（1 点）'
        for (const [slot, node] of view.equip) {
          const unlocked = slotUnlocked(profile, slot)
          const equipped = profile.equipped[slot] === id
          node.disabled = rank === 0 || !unlocked || equipped
          node.textContent = !unlocked ? `${slot.toUpperCase()} 未开放` : equipped ? `已装备 ${slot.toUpperCase()}` : `装备到 ${slot.toUpperCase()}`
        }
      }
    },
  }
}
