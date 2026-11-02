import { element } from './dom'
import { syncStyle, syncText } from './dom-sync'

export type HitKind = 'hit' | 'crit' | 'kill'

export interface OverlayState {
  hp: number
  maxHp: number
  dashReady: number
  meleeReady: number
  alive: boolean
  playing: boolean
  locked: boolean
}

export interface FpsOverlay {
  hit(kind: HitKind): void
  hurt(angle: number, amount: number): void
  threat(angle: number): void
  update(state: OverlayState, dt: number): void
  setHint(text: string | null): void
  clear(): void
}

const CROSSHAIR = `<svg viewBox="-20 -20 40 40" aria-hidden="true"><path d="M0 -15 L3 -3 L15 0 L3 3 L0 15 L-3 3 L-15 0 L-3 -3 Z" /></svg>`
const ARC_LIFE = 1.1
const THREAT_LIFE = 0.6

interface Arc {
  root: HTMLDivElement
  age: number
  life: number
}

export function createFpsOverlay(container: HTMLElement): FpsOverlay {
  const root = element('div', 'fps-overlay', container)
  const cross = element('div', 'fps-crosshair', root)
  cross.innerHTML = CROSSHAIR
  const marker = element('div', 'fps-hitmarker', root)
  const kill = element('div', 'fps-kill', root, '×')
  const arcs = element('div', 'fps-arcs', root)
  const panel = element('div', 'fps-health', root)
  const hpTrack = element('div', 'fps-hp-track', panel)
  const hpFill = element('div', 'fps-hp-fill', hpTrack)
  const hpGhost = element('div', 'fps-hp-ghost', hpTrack)
  const hpText = element('div', 'fps-hp-text', panel)
  const dash = element('div', 'fps-dash', root)
  element('span', 'fps-dash-key', dash, 'Shift')
  const dashFill = element('div', 'fps-dash-fill', dash)
  const hint = element('div', 'fps-hint', root)
  const vignette = element('div', 'fps-hurt-vignette', root)
  const live: Arc[] = []
  let markerTime = 0
  let killTime = 0
  let ghost = 1
  let hurtFlash = 0
  let markerKind: HitKind = 'hit'

  const addArc = (angle: number, className: string, life: number, strength: number) => {
    const arc = element('div', className, arcs)
    arc.style.transform = `rotate(${((angle * 180) / Math.PI).toFixed(1)}deg)`
    arc.style.setProperty('--strength', strength.toFixed(2))
    live.push({ root: arc, age: 0, life })
  }

  return {
    hit(kind) {
      markerKind = kind
      markerTime = kind === 'hit' ? 0.12 : 0.22
      marker.dataset.kind = kind
      if (kind === 'kill') killTime = 0.45
    },
    hurt(angle, amount) {
      addArc(angle, 'fps-arc hurt', ARC_LIFE, Math.min(1, 0.45 + amount))
      hurtFlash = Math.min(1, hurtFlash + 0.4 + amount)
    },
    threat(angle) {
      addArc(angle, 'fps-arc threat', THREAT_LIFE, 1)
    },
    update(state, dt) {
      root.classList.toggle('hidden', !state.playing)
      cross.classList.toggle('dim', !state.alive)
      markerTime = Math.max(0, markerTime - dt)
      killTime = Math.max(0, killTime - dt)
      syncStyle(marker, 'opacity', markerTime > 0 ? '1' : '0')
      syncStyle(marker, 'transform', `translate(-50%, -50%) scale(${(1 + markerTime * (markerKind === 'hit' ? 2 : 3)).toFixed(2)})`)
      syncStyle(kill, 'opacity', killTime > 0 ? (killTime / 0.45).toFixed(2) : '0')
      const ratio = state.maxHp > 0 ? Math.max(0, state.hp / state.maxHp) : 0
      ghost = ghost > ratio ? Math.max(ratio, ghost - dt * 0.5) : ratio
      syncStyle(hpFill, 'width', `${(ratio * 100).toFixed(1)}%`)
      syncStyle(hpGhost, 'width', `${(ghost * 100).toFixed(1)}%`)
      panel.classList.toggle('low', ratio < 0.3)
      syncText(hpText, `${Math.ceil(state.hp)} / ${state.maxHp}`)
      syncStyle(dashFill, 'transform', `scaleX(${state.dashReady.toFixed(3)})`)
      dash.classList.toggle('ready', state.dashReady >= 1)
      hurtFlash = Math.max(0, hurtFlash - dt * 1.6)
      const low = ratio < 0.3 ? (0.3 - ratio) / 0.3 : 0
      syncStyle(vignette, 'opacity', Math.min(1, hurtFlash * 0.7 + low * 0.6).toFixed(2))
      for (let i = live.length - 1; i >= 0; i--) {
        const arc = live[i]
        arc.age += dt
        if (arc.age >= arc.life) {
          arc.root.remove()
          live.splice(i, 1)
          continue
        }
        arc.root.style.opacity = (1 - arc.age / arc.life).toFixed(2)
      }
    },
    setHint(text) {
      syncText(hint, text ?? '')
      hint.classList.toggle('shown', Boolean(text))
    },
    clear() {
      for (const arc of live) arc.root.remove()
      live.length = 0
      markerTime = 0
      killTime = 0
      hurtFlash = 0
      ghost = 1
    },
  }
}
