import type { SheepState } from '../sim/types'
import { SHEEP_RIG } from './themes'

export type SheepRig = typeof SHEEP_RIG

export const SHEEP_LEGS = ['leg_fl', 'leg_fr', 'leg_rl', 'leg_rr'] as const

export type SheepLeg = (typeof SHEEP_LEGS)[number]

const TAU = Math.PI * 2
const LEG_PHASE: Readonly<Record<SheepLeg, number>> = { leg_fl: 0, leg_rr: 0, leg_fr: Math.PI, leg_rl: Math.PI }

export function legSwing(leg: SheepLeg, phase: number, stride: number, rig: SheepRig = SHEEP_RIG): number {
  return Math.sin(phase + LEG_PHASE[leg]) * rig.legSwing * stride
}

export function headPitch(state: SheepState, stride: number, phase: number, time: number, seed: number, rig: SheepRig = SHEEP_RIG): number {
  const walking = Math.sin(phase * 2) * rig.walkNod * stride
  if (state === 'grazing') {
    const down = rig.graze + Math.sin(time * rig.nibbleRate + seed) * rig.nibble
    return down * (1 - stride) + walking
  }
  return Math.sin(time * rig.idleRate + seed) * rig.idleNod * (1 - stride) + walking
}

export function bodyBob(phase: number, stride: number, rig: SheepRig = SHEEP_RIG): number {
  return Math.abs(Math.sin(phase)) * rig.bob * stride
}

export function turnToward(current: number, target: number, rate: number, dt: number): number {
  const delta = (((target - current + Math.PI) % TAU) + TAU) % TAU - Math.PI
  return current + delta * (1 - Math.exp(-rate * Math.max(0, dt)))
}
