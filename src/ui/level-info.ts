import { LANDMARKS, type LandmarkId } from '../data/landmarks'
import { isTarget, targetTally } from '../sim/landmark-state'
import type { RunTallies, Tally } from '../sim/tallies'
import type { AlarmStatus } from '../sim/types'
import type { World } from '../sim/world'

export interface TallyLine {
  label: string
  done: number
  total: number
  text?: string
}

export interface AlarmLabel {
  text: string
  status: AlarmStatus
}

const ALARM_WORDS: Readonly<Record<AlarmStatus, string>> = {
  quiet: '没响',
  running: '有人跑去敲钟',
  rung: '响了',
}

const TARGET_NAMES: Readonly<Partial<Record<LandmarkId, string>>> = { 'ch1-hay-cart': '运粮车' }

export function targetName(id: LandmarkId): string {
  return TARGET_NAMES[id] ?? LANDMARKS[id].name
}

export function targetLabel(world: World, area: number): string | null {
  const placement = world.level.landmarks.find((item) => item.area === area && isTarget(item))
  if (!placement) return null
  const tally = targetTally(world, area)
  return `${targetName(placement.id)} ${tally.done} / ${tally.total}`
}

export function showsTargetBar(world: World, index: number): boolean {
  const placement = world.level.landmarks[index]
  const state = world.landmarks[index]
  if (!placement || !state || state.broken || state.maxHp <= 0) return false
  if (state.hp < state.maxHp) return true
  return world.areas[placement.area]?.status === 'sealed' && world.areaIndex === placement.area
}

export function alarmLabel(world: World, area: number): AlarmLabel | null {
  const index = world.level.alarms.findIndex((alarm) => alarm.area === area)
  const state = index >= 0 ? world.alarms[index] : undefined
  if (!state) return null
  return { text: `警报：${ALARM_WORDS[state.status]}`, status: state.status }
}

export function tallyLines(tallies: RunTallies): TallyLine[] {
  const entries: [string, Tally][] = [
    ['宝箱', tallies.chests],
    ['放羊', tallies.sheep],
    ['线索', tallies.clues],
    ['隐藏区', tallies.secrets],
    ['驱雾灯', tallies.lamps],
    ['精英', tallies.elites],
  ]
  const lines: TallyLine[] = entries.filter(([, tally]) => tally.total > 0).map(([label, tally]) => ({ label, done: tally.done, total: tally.total }))
  const { alarms } = tallies
  if (alarms.total > 0) lines.push({ label: '警报', done: alarms.done, total: alarms.total, text: alarms.done >= alarms.total ? ALARM_WORDS.quiet : ALARM_WORDS.rung })
  return lines
}

export function tallyText(line: TallyLine): string {
  return `${line.label} ${line.text ?? `${line.done} / ${line.total}`}`
}
