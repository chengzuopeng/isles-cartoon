import type { AlarmState } from '../sim/types'
import { ALARM_BELL } from './themes'

export type AlarmBell = typeof ALARM_BELL

export interface BellSwing {
  amount: number
  phase: number
  rate: number
}

export interface WaveLook {
  visible: boolean
  scale: number
  opacity: number
}

export function freshSwing(): BellSwing {
  return { amount: 0, phase: 0, rate: ALARM_BELL.rungRate }
}

export function bellTarget(alarm: AlarmState | null, rig: AlarmBell = ALARM_BELL): { swing: number; rate: number } {
  if (alarm?.status === 'rung') return { swing: rig.rungSwing, rate: rig.rungRate }
  if (alarm?.status === 'running' && alarm.pulling > 0) return { swing: rig.pullSwing, rate: rig.pullRate }
  return { swing: 0, rate: rig.rungRate }
}

export function stepBell(swing: BellSwing, alarm: AlarmState | null, dt: number, rig: AlarmBell = ALARM_BELL): number {
  const step = Math.max(0, dt)
  const target = bellTarget(alarm, rig)
  const rate = target.swing >= swing.amount ? rig.rise : rig.calm
  swing.amount = target.swing + (swing.amount - target.swing) * Math.exp(-rate * step)
  if (swing.amount < 1e-4 && target.swing === 0) swing.amount = 0
  swing.rate = target.rate + (swing.rate - target.rate) * Math.exp(-rig.rise * step)
  swing.phase = (swing.phase + step * swing.rate) % (Math.PI * 2)
  return swing.amount * Math.sin(swing.phase)
}

export function lampLevel(alarm: AlarmState | null, time: number, rig: AlarmBell = ALARM_BELL): number {
  if (!alarm) return rig.lampIdle
  const blink = alarm.status === 'rung' ? rig.rungBlink : alarm.status === 'running' ? (alarm.pulling > 0 ? rig.pullBlink : rig.runnerBlink) : 0
  if (blink <= 0) return rig.lampIdle
  return Math.sin(time * blink * Math.PI * 2) >= 0 ? rig.lampOn : rig.lampOff
}

export function waveLook(sinceRung: number, index: number, rig: AlarmBell = ALARM_BELL, out: WaveLook = { visible: false, scale: 1, opacity: 0 }): WaveLook {
  const t = (sinceRung - index * rig.waveGap) / rig.waveSeconds
  out.visible = index < rig.waves && t >= 0 && t < 1
  const eased = 1 - (1 - Math.min(1, Math.max(0, t))) ** 2
  out.scale = rig.waveFrom + (rig.waveTo - rig.waveFrom) * eased
  out.opacity = out.visible ? rig.waveOpacity * (1 - t) : 0
  return out
}

export function wavesDone(sinceRung: number, rig: AlarmBell = ALARM_BELL): boolean {
  return sinceRung >= (rig.waves - 1) * rig.waveGap + rig.waveSeconds
}
