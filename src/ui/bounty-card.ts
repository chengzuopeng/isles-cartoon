import { assetUrl, type PortraitId } from '../render/asset-urls'
import { element } from './dom'

export interface BountyPoster {
  name: string
  portrait: PortraitId
  crime: string
  reward: string
}

export const POSTERS: Readonly<Record<string, BountyPoster>> = {
  scarecrow: {
    name: '铁皮稻草人',
    portrait: 'scarecrow-wanted',
    crime: '替强盗看守抢来的麦子，见人就叉，连乌鸦都不放过',
    reward: '120 星币',
  },
  'demo-chief': {
    name: '爆破头目',
    portrait: 'demo-chief-wanted',
    crime: '往牧场的运粮车里塞满炸弹，见篱笆就炸',
    reward: '180 星币',
  },
  'shield-captain': {
    name: '铁盾队长',
    portrait: 'shield-captain-wanted',
    crime: '拆了农庄两扇谷仓门当盾牌，霸占粮仓不还',
    reward: '220 星币',
  },
  'forest-tank': {
    name: '林地炮车',
    portrait: 'forest-tank-wanted',
    crime: '披着树枝在雾林里打冷炮，沿路埋满地雷',
    reward: '260 星币',
  },
  harvester: {
    name: '巨型收割机',
    portrait: 'harvester-wanted',
    crime: '一口吞掉整片麦田；驾驶员螺栓上尉另案通缉',
    reward: '500 星币',
  },
}

export interface BountyCard {
  show(id: string): void
  settle(id: string): void
  update(dt: number): void
  hide(): void
}

const SHOW_SECONDS = 3.4
const SETTLE_SECONDS = 2.8

export function createBountyCard(container: HTMLElement): BountyCard {
  const root = element('div', 'bounty-card', container)
  const pin = element('div', 'bounty-pin', root)
  pin.setAttribute('aria-hidden', 'true')
  element('div', 'bounty-head', root, '悬　赏')
  const frame = element('div', 'bounty-frame', root)
  const face = element('img', 'bounty-face', frame)
  face.alt = ''
  const name = element('div', 'bounty-name', root)
  const crime = element('div', 'bounty-crime', root)
  const reward = element('div', 'bounty-reward', root)
  element('div', 'bounty-foot', root, '晨风镇治安所 · 凭此令领赏')
  const stamp = element('div', 'bounty-stamp', root, '已结')
  let timer = 0

  const fill = (id: string) => {
    const poster = POSTERS[id]
    if (!poster) return false
    face.src = assetUrl.portrait(poster.portrait)
    name.textContent = poster.name
    crime.textContent = `罪名：${poster.crime}`
    reward.textContent = `赏金 ${poster.reward}`
    return true
  }

  return {
    show(id) {
      if (!fill(id)) return
      root.classList.remove('settled')
      root.classList.add('shown')
      timer = SHOW_SECONDS
    },
    settle(id) {
      if (!fill(id)) return
      root.classList.add('shown', 'settled')
      stamp.classList.remove('slam')
      void stamp.offsetWidth
      stamp.classList.add('slam')
      timer = SETTLE_SECONDS
    },
    update(dt) {
      if (timer <= 0) return
      timer -= dt
      if (timer <= 0) root.classList.remove('shown')
    },
    hide() {
      timer = 0
      root.classList.remove('shown', 'settled')
    },
  }
}
