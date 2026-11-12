import { BOUNTIES } from '../data/bounties'
import type { World } from '../sim/world'
import { element } from './dom'

export interface BountyList {
  update(world: World, visible: boolean): void
}

export function createBountyList(container: HTMLElement): BountyList {
  const root = element('div', 'bounty-list', container)
  let last = ''
  return {
    update(world, visible) {
      const text = visible
        ? world.bounties
            .map((bounty) => {
              const def = BOUNTIES[bounty.id]
              const state = bounty.done ? 'done' : bounty.failed ? 'failed' : 'open'
              const progress = def.hold ? '' : ` ${bounty.count} / ${bounty.goal}`
              return `${state}|悬赏「${def.name}」${def.text}${progress}`
            })
            .join('\n')
        : ''
      if (text === last) return
      last = text
      root.replaceChildren()
      for (const entry of text ? text.split('\n') : []) {
        const [state, body] = entry.split('|')
        element('div', `bounty-line ${state}`, root, body)
      }
    },
  }
}
