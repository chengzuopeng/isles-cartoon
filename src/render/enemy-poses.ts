import { createDefaultTuning, type Tuning } from '../data/tuning'
import { clamp } from '../sim/math'
import type { Enemy, EnemyKind, EnemyState } from '../sim/types'

export interface EnemyPose {
  attack?: string
  held?: readonly string[]
  pose(enemy: Enemy, tuning: Tuning): number
}

export interface StateSample {
  state: EnemyState
  stateTime: number
  time: number
}

const STILL: EnemyPose = { pose: () => 0 }
const DEFAULTS = createDefaultTuning()
const FIRE_SLACK = 1e-6
const LAMP_IDLE_HZ = 1.5
const LAMP_AGGRO_HZ = 5
const LAMP_ARMED_HZ = 20
const SHIELD_PUSH_IN = 0.08
const SHIELD_PUSH_OUT = 0.32
const RUSH_BRACE = 0.7

export const ENEMY_POSES: Partial<Record<EnemyKind, EnemyPose>> = {
  grunt: {
    attack: 'arm_claw',
    pose: (enemy, tuning) => {
      if (enemy.state === 'windup') return progress(enemy.stateTime, tuning.weapons.claw.windup)
      if (enemy.state === 'charge') return progress(enemy.stateTime, tuning.weapons.rush.windup) * RUSH_BRACE
      return enemy.state === 'dash' ? 1 : 0
    },
  },
  gunner: {
    attack: 'arm_rifle',
    held: ['arm_rifle', 'arm_support'],
    pose: (enemy, tuning) => aimAmount(enemy, tuning.weapons.rifle.windup, tuning.ai.rangedRecover),
  },
  thrower: {
    attack: 'arm_bomb',
    pose: (enemy, tuning) => (enemy.state === 'aim' ? progress(enemy.stateTime, tuning.weapons.bomb.windup) : 0),
  },
  turret: {
    pose: (enemy, tuning) => aimAmount(enemy, tuning.weapons.cannon.windup, tuning.ai.rangedRecover),
  },
  bomber: {
    pose: (enemy, tuning) => (enemy.state === 'arming' ? progress(enemy.stateTime, tuning.weapons.fuse.windup) : 0),
  },
  shield: {
    held: ['arm_shield'],
    pose: (enemy, tuning) => (enemy.state === 'windup' ? progress(enemy.stateTime, tuning.weapons.bash.windup) : 0),
  },
}

export function enemyPose(kind: EnemyKind): EnemyPose {
  return ENEMY_POSES[kind] ?? STILL
}

export function progress(time: number, total: number): number {
  return clamp(time / Math.max(0.01, total), 0, 1)
}

export function aimAmount(enemy: Enemy, windup: number, recover: number): number {
  if (enemy.state === 'aim') return progress(enemy.stateTime, windup)
  if (enemy.state === 'recover') return 1 - progress(enemy.stateTime, recover)
  return 0
}

export function modelScale(enemy: Enemy): number {
  if (enemy.kind === 'boss') return 1
  return enemy.radius / DEFAULTS[enemy.kind].radius
}

export function sampleState(enemy: Enemy, time: number, out: StateSample = { state: 'idle', stateTime: 0, time: 0 }): StateSample {
  out.state = enemy.state
  out.stateTime = enemy.stateTime
  out.time = time
  return out
}

export function firedSince(before: StateSample | null, now: StateSample, windup: number, disabled: boolean): boolean {
  if (!before || disabled || before.state !== 'aim' || now.state !== 'recover') return false
  return before.stateTime + (now.time - before.time) - now.stateTime >= windup - FIRE_SLACK
}

export function recoil(elapsed: number, duration: number): number {
  if (!(elapsed >= 0) || elapsed >= duration) return 0
  const left = 1 - elapsed / duration
  return left * left
}

export function fuseBlinkRate(stateTime: number, windup: number): number {
  return LAMP_AGGRO_HZ + (LAMP_ARMED_HZ - LAMP_AGGRO_HZ) * progress(stateTime, windup)
}

export function fuseBlinkCycles(stateTime: number, windup: number): number {
  const time = Math.max(0, stateTime)
  const total = Math.max(0.01, windup)
  const ramp = LAMP_ARMED_HZ - LAMP_AGGRO_HZ
  if (time <= total) return LAMP_AGGRO_HZ * time + (ramp * time * time) / (2 * total)
  return ((LAMP_AGGRO_HZ + LAMP_ARMED_HZ) * total) / 2 + LAMP_ARMED_HZ * (time - total)
}

export function bomberLampCycles(enemy: Enemy, time: number, windup: number): number {
  if (enemy.state === 'arming') return fuseBlinkCycles(enemy.stateTime, windup)
  return time * (enemy.aggro ? LAMP_AGGRO_HZ : LAMP_IDLE_HZ) + enemy.id * 0.37
}

export function lampLit(cycles: number): boolean {
  return cycles - Math.floor(cycles) < 0.5
}

export function shieldReach(enemy: Enemy, tuning: Tuning): number {
  if (enemy.state === 'windup') return -progress(enemy.stateTime, tuning.weapons.bash.windup)
  if (enemy.state !== 'recover') return 0
  const time = enemy.stateTime
  if (time < SHIELD_PUSH_IN) return -1 + (2 * time) / SHIELD_PUSH_IN
  if (time < SHIELD_PUSH_IN + SHIELD_PUSH_OUT) return 1 - (time - SHIELD_PUSH_IN) / SHIELD_PUSH_OUT
  return 0
}

export function shieldShake(elapsed: number, duration: number): number {
  if (!(elapsed >= 0) || elapsed >= duration) return 0
  return Math.sin(elapsed * 55) * (1 - elapsed / duration)
}
