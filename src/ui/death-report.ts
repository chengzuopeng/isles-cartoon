import { ATTACK_TIPS } from '../data/attacks'
import type { World } from '../sim/world'
import { attackLabel } from './attack-names'
import { element } from './dom'

const SOURCE_LIMIT = 3

export interface DeathReport {
  render(world: World): void
}

export function createDeathReport(parent: HTMLElement): DeathReport {
  const root = element('div', 'death-report', parent)
  const cause = element('div', 'death-cause', root)
  const tip = element('div', 'death-tip', root)
  const sources = element('div', 'death-sources', root)
  let shown: World | null = null

  return {
    render(world) {
      if (shown === world) return
      shown = world
      const { stats, tuning } = world
      const killer = stats.killedBy
      const advice = killer ? ATTACK_TIPS[killer.cause] : undefined
      cause.textContent = killer ? `致命一击：${attackLabel(killer, tuning.weapons)}` : ''
      tip.textContent = advice ? `提示：${advice}` : ''
      const total = stats.damageTaken
      const top = [...stats.taken].sort((a, b) => b.damage - a.damage).slice(0, SOURCE_LIMIT)
      sources.textContent =
        total > 0 && top.length > 0
          ? `本局受伤来源：${top
              .map((entry) => `${attackLabel(entry.attack, tuning.weapons)} ${Math.round((entry.damage / total) * 100)}%`)
              .join(' · ')}`
          : ''
      root.classList.toggle('visible', killer !== null || top.length > 0)
    },
  }
}
