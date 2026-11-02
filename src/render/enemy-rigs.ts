import * as THREE from 'three'
import type { Tuning } from '../data/tuning'
import { ENEMY_WEAPON } from '../sim/arsenal'
import type { Enemy, MinionKind } from '../sim/types'
import type { Effects } from './effects'
import {
  aimAmount,
  bomberLampCycles,
  firedSince,
  lampLit,
  recoil,
  sampleState,
  shieldReach,
  shieldShake,
  type EnemyPose,
  type StateSample,
} from './enemy-poses'
import { animateRig, restQuaternion, rigOf, rotateFromRest, socketWorld, type ModelInstance, type ModelLibrary } from './model-library'
import { ENEMY_MUZZLE_COLOR, HELD_BOMB_SCALE, MORTAR_FLASH_COLOR, MORTAR_SMOKE_COLOR } from './themes'

export interface EnemyFrame {
  enemy: Enemy
  tuning: Tuning
  time: number
  step: number
  dt: number
  moving: boolean
  disabled: boolean
  yaw: number
  pose: number
}

export interface EnemyRig {
  readonly anchor: THREE.Object3D | null
  socket(name: string): THREE.Object3D | null
  sync(frame: EnemyFrame): void
  blocked(): void
}

interface Dress {
  sync(frame: EnemyFrame, firedAt: number): void
  blocked?(): void
}

interface Light {
  material: THREE.MeshStandardMaterial
  base: number
}

interface Kit {
  model: ModelInstance
  models: ModelLibrary
  effects: Effects
}

const X_AXIS = new THREE.Vector3(1, 0, 0)
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const Z_AXIS = new THREE.Vector3(0, 0, 1)
const WALK_RATE = 12
const EYE_AGGRO = 2.2
const EYE_AIM = 3.6
const GUNNER_RAISE = 0.75
const GUNNER_KICK = 0.32
const GUNNER_RECOIL_SECONDS = 0.22
const GUNNER_LAMP_HZ = 9
const GUNNER_LAMP_ON = 5
const GUNNER_LAMP_OFF = 0.35
const MORTAR_RAISE = 0.26
const MORTAR_SLIDE = 0.09
const MORTAR_RECOIL_SECONDS = 0.35
const TURRET_IDLE_PITCH = 0.1
const TURRET_KICK = 0.22
const TURRET_SLIDE = 0.07
const TURRET_RECOIL_SECONDS = 0.3
const TURRET_PUFF_GAP = 0.06
const BOMBER_SWELL = 0.35
const BOMBER_LAMP_ON = 4
const BOMBER_LAMP_OFF = 0.12
const SHIELD_REACH = 0.7
const SHIELD_DROP = 0.08
const SHIELD_TILT = 0.85
const SHIELD_TURN = 0.45
const SHIELD_SHAKE = 0.12
const SHIELD_SHAKE_SECONDS = 0.28
const SHIELD_LOWER_RATE = 10

const LEGS = ['leg_l', 'leg_l_lower', 'leg_r', 'leg_r_lower'] as const

export const ENEMY_JOINTS: Readonly<Record<MinionKind, readonly string[]>> = {
  grunt: ['arm_claw', 'arm_claw_lower', 'arm_short', 'arm_short_lower', ...LEGS],
  gunner: ['arm_rifle', 'arm_rifle_lower', 'arm_support', 'arm_support_lower', ...LEGS],
  bomber: ['body', 'leg_l', 'leg_r'],
  turret: ['turret', 'barrel'],
  shield: ['arm_fist', 'arm_fist_lower', 'arm_shield', 'arm_shield_lower', 'shield', ...LEGS],
  thrower: ['arm_bomb', 'arm_bomb_lower', 'bomb', 'arm_fist', 'arm_fist_lower', 'mortar', ...LEGS],
}

const point = new THREE.Vector3()
const turn = new THREE.Quaternion()
const axis = new THREE.Vector3()

export function createEnemyRig(kind: MinionKind, pose: EnemyPose, kit: Kit): EnemyRig {
  const { nodes } = kit.model
  const walk = kind === 'turret' ? null : rigOf(nodes, { attack: pose.attack, held: pose.held })
  const eye = light(kit.model.glow.get('mat_eye'))
  const weapon = ENEMY_WEAPON[kind]
  const before: StateSample = { state: 'idle', stateTime: 0, time: 0 }
  const now: StateSample = { state: 'idle', stateTime: 0, time: 0 }
  let sampled = false
  let firedAt = -Infinity
  const dress = DRESSES[kind]?.(kit) ?? null
  return {
    anchor: nodes.get('socket_head') ?? null,
    socket: (name) => nodes.get(name) ?? null,
    sync(frame) {
      const { enemy, time } = frame
      sampleState(enemy, time, now)
      if (firedSince(sampled ? before : null, now, frame.tuning.weapons[weapon].windup, frame.disabled)) firedAt = time - enemy.stateTime
      sampleState(enemy, time, before)
      sampled = true
      if (walk) animateRig(walk, frame.dt, frame.moving, WALK_RATE, frame.pose)
      shine(eye, enemy.state === 'aim' ? EYE_AIM : enemy.aggro ? EYE_AGGRO : 1)
      dress?.sync(frame, firedAt)
    },
    blocked() {
      dress?.blocked?.()
    },
  }
}

const DRESSES: Partial<Record<MinionKind, (kit: Kit) => Dress>> = {
  gunner: dressGunner,
  thrower: dressThrower,
  turret: dressTurret,
  bomber: dressBomber,
  shield: dressShield,
}

function light(material: THREE.MeshStandardMaterial | undefined): Light | null {
  return material ? { material, base: material.emissiveIntensity } : null
}

function shine(lamp: Light | null, level: number): void {
  if (lamp) lamp.material.emissiveIntensity = lamp.base * level
}

function puffAt(effects: Effects, node: THREE.Object3D | null, color: string, from: number, to: number, duration: number): void {
  if (!node) return
  socketWorld(node, point)
  effects.puff(point.x, point.y, point.z, color, from, to, duration)
}

function reach(upper: THREE.Object3D | undefined, lower: THREE.Object3D | undefined, angle: number, extra = 0): void {
  if (upper) rotateFromRest(upper, Z_AXIS, angle)
  if (lower) rotateFromRest(lower, Z_AXIS, -angle + extra)
}

function dressGunner({ model, effects }: Kit): Dress {
  const { nodes } = model
  const lamp = light(model.glow.get('mat_glow'))
  const muzzle = nodes.get('socket_muzzle') ?? null
  let puffed = -Infinity
  return {
    sync(frame, firedAt) {
      const { enemy, time } = frame
      const lift = frame.pose * GUNNER_RAISE
      const kick = recoil(time - firedAt, GUNNER_RECOIL_SECONDS) * GUNNER_KICK
      reach(nodes.get('arm_rifle'), nodes.get('arm_rifle_lower'), lift, kick)
      reach(nodes.get('arm_support'), nodes.get('arm_support_lower'), lift, kick)
      shine(lamp, enemy.state === 'aim' ? (lampLit(enemy.stateTime * GUNNER_LAMP_HZ) ? GUNNER_LAMP_ON : GUNNER_LAMP_OFF) : 1)
      if (firedAt > puffed) {
        puffed = firedAt
        puffAt(effects, muzzle, ENEMY_MUZZLE_COLOR, 0.2, 0.5, 0.08)
      }
    },
  }
}

function dressThrower({ model, models, effects }: Kit): Dress {
  const { nodes } = model
  const mortar = nodes.get('mortar') ?? null
  const muzzle = nodes.get('socket_muzzle') ?? null
  const socket = nodes.get('socket_weapon')
  const stone = nodes.get('bomb') ?? null
  let bomb: THREE.Object3D | null = stone
  if (socket && models.has('legion-bomb')) {
    const held = models.shared('legion-bomb').root
    held.scale.setScalar(HELD_BOMB_SCALE)
    socket.add(held)
    if (stone) stone.visible = false
    bomb = held
  }
  const rest = mortar?.position.clone() ?? new THREE.Vector3()
  const barrel = muzzle ? muzzle.position.clone().normalize() : new THREE.Vector3(1, 0, 0)
  let puffed = -Infinity
  return {
    sync(frame, firedAt) {
      const { enemy, time, tuning } = frame
      if (bomb) bomb.visible = enemy.state === 'aim'
      if (mortar) {
        rotateFromRest(mortar, Z_AXIS, aimAmount(enemy, tuning.weapons.bomb.windup, tuning.ai.rangedRecover) * MORTAR_RAISE)
        const slide = recoil(time - firedAt, MORTAR_RECOIL_SECONDS) * MORTAR_SLIDE
        mortar.position.copy(rest).addScaledVector(axis.copy(barrel).applyQuaternion(mortar.quaternion), -slide)
      }
      if (firedAt > puffed) {
        puffed = firedAt
        puffAt(effects, muzzle, MORTAR_FLASH_COLOR, 0.2, 0.55, 0.1)
        puffAt(effects, muzzle, MORTAR_SMOKE_COLOR, 0.25, 0.8, 0.4)
      }
    },
  }
}

function dressTurret({ model, effects }: Kit): Dress {
  const { nodes } = model
  const head = nodes.get('turret') ?? null
  const barrel = nodes.get('barrel') ?? null
  const muzzles = [1, 2, 3].map((index) => nodes.get(`socket_muzzle_${index}`) ?? null)
  const rest = barrel?.position.x ?? 0
  let volley = -Infinity
  let puffs = muzzles.length
  return {
    sync(frame, firedAt) {
      const { enemy, time } = frame
      if (head) rotateFromRest(head, Y_AXIS, -frame.yaw)
      const kick = recoil(time - firedAt, TURRET_RECOIL_SECONDS)
      if (barrel) {
        rotateFromRest(barrel, Z_AXIS, (enemy.aggro ? 0 : TURRET_IDLE_PITCH) + kick * TURRET_KICK)
        barrel.position.x = rest - kick * TURRET_SLIDE
      }
      if (firedAt > volley) {
        volley = firedAt
        puffs = 0
      }
      while (puffs < muzzles.length && time - volley >= puffs * TURRET_PUFF_GAP) {
        puffAt(effects, muzzles[puffs], ENEMY_MUZZLE_COLOR, 0.2, 0.55, 0.09)
        puffs += 1
      }
    },
  }
}

function dressBomber({ model }: Kit): Dress {
  const body = model.nodes.get('body') ?? null
  const lamp = light(model.glow.get('mat_lamp'))
  return {
    sync(frame) {
      const { enemy, time, tuning } = frame
      body?.scale.setScalar(1 + frame.pose * BOMBER_SWELL)
      shine(lamp, lampLit(bomberLampCycles(enemy, time, tuning.weapons.fuse.windup)) ? BOMBER_LAMP_ON : BOMBER_LAMP_OFF)
    },
  }
}

function dressShield({ model }: Kit): Dress {
  const { nodes } = model
  const board = nodes.get('shield') ?? null
  const rest = board?.position.clone() ?? new THREE.Vector3()
  let lowered = 0
  let shakeAt = -Infinity
  let pending = false
  return {
    sync(frame) {
      const { enemy, time, tuning } = frame
      if (pending) {
        shakeAt = time
        pending = false
      }
      lowered += ((frame.disabled ? 1 : 0) - lowered) * Math.min(1, frame.step * SHIELD_LOWER_RATE)
      reach(nodes.get('arm_shield'), nodes.get('arm_shield_lower'), shieldReach(enemy, tuning) * (1 - lowered) * SHIELD_REACH)
      if (!board) return
      board.position.set(rest.x, rest.y - lowered * SHIELD_DROP, rest.z)
      board.quaternion.copy(restQuaternion(board))
      board.quaternion.multiply(turn.setFromAxisAngle(Y_AXIS, lowered * SHIELD_TURN))
      board.quaternion.multiply(turn.setFromAxisAngle(X_AXIS, -lowered * SHIELD_TILT))
      board.quaternion.multiply(turn.setFromAxisAngle(Z_AXIS, shieldShake(time - shakeAt, SHIELD_SHAKE_SECONDS) * SHIELD_SHAKE))
    },
    blocked() {
      pending = true
    },
  }
}
