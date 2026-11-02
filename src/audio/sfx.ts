import type { WeaponId } from '../data/weapons'
import type { GameEvent } from '../sim/types'
import type { World } from '../sim/world'
import { bladeLoudness } from './blade-audio'

export type SfxCue = 'levelUp' | 'allocate' | 'start' | 'click'

export interface Sfx {
  cue(name: SfxCue): void
  unlock(): void
  setVolume(volume: number): void
  setMuted(muted: boolean): void
  isMuted(): boolean
  handle(event: GameEvent, world?: World): void
}

interface Tone {
  type: OscillatorType
  from: number
  to: number
  duration: number
  gain: number
  attack?: number
  delay?: number
}

interface Noise {
  filter: BiquadFilterType
  from: number
  to: number
  duration: number
  gain: number
  q?: number
  delay?: number
}

const THROTTLE_MS: Partial<Record<GameEvent['type'], number>> = {
  enemyHit: 30,
  enemyAlerted: 90,
  enemyShot: 40,
  bulletHitWall: 60,
  enemyWindup: 120,
  enemyCharge: 150,
  pickupDropped: 80,
  pickedUp: 50,
  bulletBounced: 60,
  chain: 40,
  dodged: 120,
  shieldBlocked: 60,
  enemySuspicious: 200,
  bossBackHit: 80,
  bladeHit: 70,
}

const VICTORY_NOTES = [523, 659, 784, 1046]
const LEVEL_UP_NOTES = [392, 523, 659, 784, 1046]
const CHEST_NOTES = [659, 880, 1175]

export function createSfx(): Sfx {
  let context: AudioContext | null = null
  let master: GainNode | null = null
  let noise: AudioBuffer | null = null
  let volume = 0.6
  let muted = false
  let counter = 0
  const lastPlayed = new Map<string, number>()

  const output = () => {
    if (!context || !master || context.state !== 'running') return null
    return { context, master }
  }

  const variance = () => {
    counter += 1
    return 1 + ((counter % 7) - 3) * 0.02
  }

  const tone = (spec: Tone) => {
    const out = output()
    if (!out) return
    const start = out.context.currentTime + (spec.delay ?? 0)
    const pitch = variance()
    const oscillator = out.context.createOscillator()
    const gain = out.context.createGain()
    oscillator.type = spec.type
    oscillator.frequency.setValueAtTime(spec.from * pitch, start)
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, spec.to * pitch), start + spec.duration)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.linearRampToValueAtTime(spec.gain, start + (spec.attack ?? 0.005))
    gain.gain.exponentialRampToValueAtTime(0.0001, start + spec.duration)
    oscillator.connect(gain).connect(out.master)
    oscillator.start(start)
    oscillator.stop(start + spec.duration + 0.03)
  }

  const hiss = (spec: Noise) => {
    const out = output()
    if (!out || !noise) return
    const start = out.context.currentTime + (spec.delay ?? 0)
    const source = out.context.createBufferSource()
    const filter = out.context.createBiquadFilter()
    const gain = out.context.createGain()
    source.buffer = noise
    filter.type = spec.filter
    filter.frequency.setValueAtTime(spec.from, start)
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, spec.to), start + spec.duration)
    filter.Q.value = spec.q ?? 0.8
    gain.gain.setValueAtTime(spec.gain, start)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + spec.duration)
    source.connect(filter).connect(gain).connect(out.master)
    source.start(start)
    source.stop(start + spec.duration + 0.03)
  }

  const shot = (weapon: WeaponId) => {
    switch (weapon) {
      case 'shotgun':
        hiss({ filter: 'lowpass', from: 2600, to: 300, duration: 0.2, gain: 0.32 })
        tone({ type: 'triangle', from: 220, to: 80, duration: 0.14, gain: 0.16 })
        break
      case 'smg':
        tone({ type: 'square', from: 1300, to: 700, duration: 0.035, gain: 0.05 })
        hiss({ filter: 'highpass', from: 3500, to: 2500, duration: 0.03, gain: 0.05 })
        break
      case 'sniper':
        tone({ type: 'sawtooth', from: 1700, to: 180, duration: 0.28, gain: 0.12 })
        hiss({ filter: 'bandpass', from: 4000, to: 600, duration: 0.25, gain: 0.18, q: 1.2 })
        break
      case 'grenade':
        tone({ type: 'sine', from: 160, to: 90, duration: 0.18, gain: 0.2 })
        hiss({ filter: 'lowpass', from: 900, to: 300, duration: 0.12, gain: 0.12 })
        break
      case 'ricochet':
        tone({ type: 'triangle', from: 1500, to: 900, duration: 0.07, gain: 0.08 })
        break
      case 'flamer':
        hiss({ filter: 'bandpass', from: 700, to: 500, duration: 0.12, gain: 0.08, q: 0.6 })
        break
      case 'frost':
        tone({ type: 'sine', from: 2200, to: 1500, duration: 0.12, gain: 0.07 })
        tone({ type: 'sine', from: 3300, to: 2600, duration: 0.1, gain: 0.04 })
        break
      case 'rocket':
        hiss({ filter: 'bandpass', from: 400, to: 1600, duration: 0.35, gain: 0.25, q: 0.8 })
        break
      case 'arc':
        tone({ type: 'sawtooth', from: 2400, to: 600, duration: 0.09, gain: 0.07 })
        hiss({ filter: 'highpass', from: 6000, to: 4000, duration: 0.08, gain: 0.08 })
        break
      case 'starVolley':
        tone({ type: 'square', from: 1400, to: 900, duration: 0.07, gain: 0.06 })
        tone({ type: 'sine', from: 2100, to: 2800, duration: 0.07, gain: 0.04 })
        break
      default:
        tone({ type: 'square', from: 900, to: 420, duration: 0.06, gain: 0.07 })
        hiss({ filter: 'highpass', from: 3000, to: 2000, duration: 0.03, gain: 0.04 })
    }
  }

  const blast = (big: boolean) => {
    hiss({ filter: 'lowpass', from: 1400, to: 110, duration: big ? 0.7 : 0.5, gain: big ? 0.6 : 0.45 })
    tone({ type: 'sine', from: 95, to: 35, duration: big ? 0.6 : 0.45, gain: 0.35 })
  }

  const throttled = (type: GameEvent['type']) => {
    const gap = THROTTLE_MS[type]
    if (!gap) return false
    const now = performance.now()
    if (now - (lastPlayed.get(type) ?? -Infinity) < gap) return true
    lastPlayed.set(type, now)
    return false
  }

  const chime = (notes: number[], gap: number, gain: number, type: OscillatorType = 'triangle') => {
    notes.forEach((note, index) => tone({ type, from: note, to: note, duration: 0.18, gain, delay: index * gap }))
  }

  return {
    cue(name) {
      switch (name) {
        case 'levelUp':
          chime(LEVEL_UP_NOTES, 0.08, 0.1)
          break
        case 'allocate':
          tone({ type: 'triangle', from: 740, to: 1100, duration: 0.12, gain: 0.08 })
          break
        case 'start':
          tone({ type: 'sawtooth', from: 220, to: 440, duration: 0.25, gain: 0.06 })
          break
        case 'click':
          tone({ type: 'square', from: 900, to: 700, duration: 0.04, gain: 0.04 })
          break
      }
    },
    unlock() {
      if (!context) {
        const AudioContextClass = window.AudioContext
        if (!AudioContextClass) return
        context = new AudioContextClass()
        master = context.createGain()
        master.gain.value = muted ? 0 : volume
        master.connect(context.destination)
        noise = context.createBuffer(1, context.sampleRate, context.sampleRate)
        const data = noise.getChannelData(0)
        let seed = 12345
        for (let i = 0; i < data.length; i++) {
          seed = (seed * 1103515245 + 12345) >>> 0
          data[i] = (seed / 4294967296) * 2 - 1
        }
      }
      if (context.state === 'suspended') void context.resume()
    },
    setVolume(next) {
      if (next === volume) return
      volume = next
      if (master && !muted) master.gain.value = volume
    },
    setMuted(next) {
      muted = next
      if (master) master.gain.value = muted ? 0 : volume
    },
    isMuted: () => muted,
    handle(event, world) {
      if (throttled(event.type)) return
      switch (event.type) {
        case 'shot':
          shot(event.weapon)
          break
        case 'enemyShot':
          if (event.weapon === 'bomb' || event.weapon === 'baleToss' || event.weapon === 'chiefBomb') {
            hiss({ filter: 'bandpass', from: 500, to: 1400, duration: 0.25, gain: 0.12, q: 0.8 })
          } else tone({ type: 'sawtooth', from: 380, to: 190, duration: 0.09, gain: 0.06 })
          break
        case 'bulletHitWall':
          hiss({ filter: 'bandpass', from: 1200, to: 700, duration: 0.05, gain: 0.05, q: 2 })
          break
        case 'enemyHit':
          hiss({ filter: 'bandpass', from: 1900, to: 1200, duration: 0.05, gain: 0.12, q: 1.5 })
          break
        case 'enemyKilled':
          if (event.kind === 'boss') blast(true)
          else {
            tone({ type: 'triangle', from: 540, to: 140, duration: 0.16, gain: 0.12 })
            hiss({ filter: 'lowpass', from: 1600, to: 300, duration: 0.12, gain: 0.12 })
          }
          break
        case 'enemyAlerted':
          tone({ type: 'sine', from: 1300, to: 1650, duration: 0.07, gain: 0.05 })
          break
        case 'enemyWindup':
          tone({ type: 'sine', from: 320, to: 520, duration: 0.14, gain: 0.04 })
          break
        case 'enemyCharge':
          tone({ type: 'sawtooth', from: 160, to: 420, duration: 0.42, gain: 0.05 })
          break
        case 'playerHit':
          tone({ type: 'sine', from: 180, to: 60, duration: 0.22, gain: 0.28 })
          hiss({ filter: 'lowpass', from: 700, to: 200, duration: 0.14, gain: 0.18 })
          break
        case 'playerDied':
          tone({ type: 'triangle', from: 420, to: 70, duration: 0.8, gain: 0.18 })
          break
        case 'blast':
          blast(event.source === 'boss')
          break
        case 'bossCrash':
          blast(false)
          break
        case 'areaLocked':
        case 'areaCleared':
          tone({ type: 'square', from: 110, to: 65, duration: 0.3, gain: 0.12 })
          hiss({ filter: 'lowpass', from: 500, to: 120, duration: 0.25, gain: 0.14 })
          break
        case 'bossIntro':
          tone({ type: 'sawtooth', from: 98, to: 92, duration: 1, gain: 0.1, attack: 0.25 })
          tone({ type: 'sawtooth', from: 147, to: 139, duration: 1, gain: 0.07, attack: 0.25 })
          break
        case 'bossMove':
          if (event.move === 'charge') tone({ type: 'sawtooth', from: 210, to: 120, duration: 0.45, gain: 0.08 })
          break
        case 'bossDefeated':
        case 'levelComplete':
          VICTORY_NOTES.forEach((note, index) => {
            tone({ type: 'triangle', from: note, to: note, duration: 0.22, gain: 0.1, delay: index * 0.12 })
          })
          break
        case 'weaponChanged':
          tone({ type: 'triangle', from: 660, to: 990, duration: 0.08, gain: 0.07 })
          break
        case 'weaponEmpty':
          tone({ type: 'square', from: 300, to: 190, duration: 0.12, gain: 0.07 })
          break
        case 'waveStarted':
          tone({ type: 'triangle', from: 440, to: 660, duration: 0.16, gain: 0.08 })
          break
        case 'pickupDropped':
          tone({ type: 'sine', from: 880, to: 1320, duration: 0.09, gain: 0.05 })
          break
        case 'pickedUp':
          if (event.item.type === 'heal') chime([523, 784], 0.06, 0.08, 'sine')
          else if (event.item.type === 'buff') chime([784, 988, 1319], 0.05, 0.07)
          else if (event.item.type === 'ammo') {
            hiss({ filter: 'bandpass', from: 2400, to: 1600, duration: 0.05, gain: 0.12, q: 2 })
            hiss({ filter: 'bandpass', from: 2000, to: 1400, duration: 0.05, gain: 0.1, q: 2, delay: 0.07 })
          } else {
            tone({ type: 'square', from: 300, to: 180, duration: 0.06, gain: 0.08 })
            tone({ type: 'square', from: 520, to: 420, duration: 0.06, gain: 0.08, delay: 0.09 })
          }
          break
        case 'buffEnded':
          tone({ type: 'sine', from: 660, to: 330, duration: 0.18, gain: 0.05 })
          break
        case 'shieldBroken':
          hiss({ filter: 'highpass', from: 5000, to: 2500, duration: 0.25, gain: 0.14 })
          tone({ type: 'triangle', from: 1200, to: 300, duration: 0.25, gain: 0.08 })
          break
        case 'chestOpened':
          hiss({ filter: 'lowpass', from: 900, to: 300, duration: 0.2, gain: 0.12 })
          chime(CHEST_NOTES, 0.07, 0.09)
          break
        case 'crateBroken':
          hiss({ filter: 'lowpass', from: 1800, to: 200, duration: 0.22, gain: 0.3 })
          tone({ type: 'triangle', from: 160, to: 70, duration: 0.16, gain: 0.14 })
          break
        case 'supplyUsed':
          hiss({ filter: 'bandpass', from: 600, to: 1800, duration: 0.5, gain: 0.12, q: 0.7 })
          chime([392, 523, 659], 0.09, 0.08, 'sine')
          break
        case 'bonusXp':
          chime([1046, 1319, 1568], 0.06, 0.07)
          break
        case 'skillCast':
          if (event.skill === 'roll') hiss({ filter: 'bandpass', from: 1200, to: 400, duration: 0.2, gain: 0.14, q: 0.7 })
          else if (event.skill === 'barrier') chime([523, 784, 1046], 0.04, 0.07, 'sine')
          break
        case 'shockwave':
          tone({ type: 'sine', from: 140, to: 50, duration: 0.4, gain: 0.3 })
          hiss({ filter: 'lowpass', from: 2000, to: 200, duration: 0.35, gain: 0.25 })
          break
        case 'dodged':
          hiss({ filter: 'highpass', from: 3000, to: 5000, duration: 0.1, gain: 0.06 })
          break
        case 'barrierBroken':
          hiss({ filter: 'highpass', from: 6000, to: 2000, duration: 0.3, gain: 0.16 })
          break
        case 'ultimateReady':
          chime([659, 988, 1319], 0.07, 0.09)
          break
        case 'ultimateFired':
          tone({ type: 'sawtooth', from: 300, to: 900, duration: 0.3, gain: 0.1 })
          break
        case 'bulletBounced':
          tone({ type: 'triangle', from: 2200, to: 1800, duration: 0.05, gain: 0.05 })
          break
        case 'chain':
          hiss({ filter: 'highpass', from: 5000, to: 3000, duration: 0.07, gain: 0.07 })
          break
        case 'frozen':
          tone({ type: 'triangle', from: 1800, to: 900, duration: 0.25, gain: 0.08 })
          hiss({ filter: 'highpass', from: 4000, to: 2500, duration: 0.2, gain: 0.08 })
          break
        case 'stunned':
          tone({ type: 'square', from: 700, to: 500, duration: 0.12, gain: 0.05 })
          break
        case 'shieldBlocked':
          tone({ type: 'square', from: 1600, to: 1200, duration: 0.05, gain: 0.05 })
          hiss({ filter: 'highpass', from: 5000, to: 3000, duration: 0.05, gain: 0.06 })
          break
        case 'eliteShieldBroken':
          hiss({ filter: 'highpass', from: 6000, to: 2500, duration: 0.25, gain: 0.14 })
          break
        case 'enemySuspicious':
          tone({ type: 'sine', from: 600, to: 900, duration: 0.12, gain: 0.04 })
          break
        case 'bossStunned':
          tone({ type: 'triangle', from: 900, to: 300, duration: 0.4, gain: 0.12 })
          chime([1319, 1568, 1319], 0.08, 0.05, 'sine')
          break
        case 'bossPhase':
          tone({ type: 'sawtooth', from: 80, to: 60, duration: 1.2, gain: 0.16, attack: 0.15 })
          tone({ type: 'sawtooth', from: 120, to: 90, duration: 1.2, gain: 0.1, attack: 0.15 })
          hiss({ filter: 'lowpass', from: 900, to: 200, duration: 1, gain: 0.18 })
          break
        case 'rockBroken':
          hiss({ filter: 'lowpass', from: 1500, to: 150, duration: 0.4, gain: 0.35 })
          break
        case 'landmarkBroken':
          hiss({ filter: 'lowpass', from: 2000, to: 160, duration: 0.55, gain: 0.4 })
          tone({ type: 'triangle', from: 140, to: 55, duration: 0.35, gain: 0.18 })
          break
        case 'landmarkOpened':
          tone({ type: 'square', from: 220, to: 160, duration: 0.18, gain: 0.04 })
          break
        case 'clueFound':
        case 'secretFound':
          chime([784, 988, 1175], 0.07, 0.08, 'sine')
          break
        case 'alarmRunner':
          tone({ type: 'square', from: 880, to: 1320, duration: 0.14, gain: 0.05 })
          tone({ type: 'square', from: 880, to: 1320, duration: 0.14, gain: 0.05, delay: 0.18 })
          break
        case 'alarmPull':
          tone({ type: 'triangle', from: 330, to: 300, duration: 0.6, gain: 0.06, attack: 0.2 })
          break
        case 'alarmRaised':
          for (let i = 0; i < 3; i++) {
            tone({ type: 'sine', from: 392, to: 386, duration: 1.4, gain: 0.2, delay: i * 0.55 })
            tone({ type: 'triangle', from: 940, to: 925, duration: 0.9, gain: 0.06, delay: i * 0.55 })
          }
          break
        case 'alarmStopped':
          tone({ type: 'triangle', from: 600, to: 300, duration: 0.25, gain: 0.06 })
          break
        case 'landmarkCrashed':
          hiss({ filter: 'lowpass', from: 1200, to: 200, duration: 0.6, gain: 0.3 })
          tone({ type: 'triangle', from: 110, to: 60, duration: 0.45, gain: 0.2 })
          break
        case 'bossShield':
          if (event.held) tone({ type: 'square', from: 300, to: 420, duration: 0.12, gain: 0.05 })
          else {
            tone({ type: 'square', from: 260, to: 120, duration: 0.3, gain: 0.08 })
            hiss({ filter: 'lowpass', from: 1500, to: 300, duration: 0.3, gain: 0.15, delay: 0.3 })
          }
          break
        case 'bossBackHit':
          tone({ type: 'sine', from: 1200, to: 1500, duration: 0.06, gain: 0.03 })
          break
        case 'bladeWarning': {
          const level = world ? bladeLoudness(world, event.index) : 1
          if (level <= 0) break
          tone({ type: 'square', from: 1180, to: 1180, duration: 0.07, gain: 0.05 * level })
          tone({ type: 'square', from: 1180, to: 1180, duration: 0.07, gain: 0.05 * level, delay: 0.13 })
          tone({ type: 'square', from: 1480, to: 1480, duration: 0.09, gain: 0.05 * level, delay: 0.26 })
          break
        }
        case 'bladeSweep': {
          const level = world ? bladeLoudness(world, event.index) : 1
          if (level <= 0) break
          tone({ type: 'sawtooth', from: 70, to: 210, duration: 0.75, gain: 0.08 * level, attack: 0.08 })
          tone({ type: 'square', from: 140, to: 420, duration: 0.6, gain: 0.025 * level, attack: 0.06 })
          hiss({ filter: 'bandpass', from: 300, to: 1400, duration: 0.7, gain: 0.07 * level, q: 1.1 })
          break
        }
        case 'bladeHit': {
          const loud = world ? bladeLoudness(world, event.index, event) : 1
          const soft = world && event.id === world.player.id && world.player.invulnerable > 0 ? 0.45 : 1
          const level = loud * soft
          if (level <= 0) break
          tone({ type: 'square', from: 1900, to: 950, duration: 0.09, gain: 0.07 * level })
          tone({ type: 'triangle', from: 2900, to: 2500, duration: 0.18, gain: 0.04 * level, delay: 0.01 })
          hiss({ filter: 'highpass', from: 5200, to: 2600, duration: 0.12, gain: 0.12 * level })
          tone({ type: 'sine', from: 210, to: 80, duration: 0.16, gain: 0.12 * level })
          break
        }
        default:
          break
      }
    },
  }
}
