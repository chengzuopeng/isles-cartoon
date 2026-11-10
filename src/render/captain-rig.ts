import * as THREE from 'three'
import type { BossDef, BossMoveId } from '../data/bosses'
import type { Tuning } from '../data/tuning'
import { anchorOf, blendFrom, fader, heightIn, lightOf, mount, near, orient, remember, scatter, shine, toWorld, tracker, type Fader, type Shift } from './boss-kit'
import { approach, flicker, mix, passed, smooth, span, stepGait, strideRate, telegraphProgress } from './boss-motion'
import type { BossBody, BossRig } from './boss-rigs'
import {
  POSE_KEYS,
  blankCaptainPose,
  blenderTurn,
  captainDefeatSeconds,
  captainLegs,
  captainPose,
  captainShow,
  lyingSpot,
  lyingTurn,
  pickProgress,
  standSpot,
  standTurn,
  type CaptainLegs,
  type CaptainShow,
} from './captain-motion'
import type { Effects } from './effects'
import { restQuaternion, rotateFromRest, socketWorld, type ModelLibrary } from './model-library'
import { CAPTAIN_DEFEAT, CAPTAIN_RIG } from './themes'

export const CAPTAIN_NODES = [
  'body',
  'head',
  'eye',
  'core',
  'shield',
  'socket_fx_shield',
  'socket_head',
  'arm_l',
  'arm_l_lower',
  'hand_l',
  'arm_r',
  'arm_r_lower',
  'hand_r',
  'leg_l',
  'leg_l_lower',
  'leg_r',
  'leg_r_lower',
] as const

export interface CaptainKit {
  models: ModelLibrary
  effects: Effects | null
  tuning: Tuning
}

type ShieldMode = 'hand' | 'falling' | 'ground' | 'show'

interface Show {
  previous: number
  saved: Map<THREE.Object3D, THREE.Quaternion>
  fade: Fader
  shieldFade: Fader
  from: { position: THREE.Vector3; quaternion: THREE.Quaternion }
  to: { position: THREE.Vector3; quaternion: THREE.Quaternion }
  pose: CaptainShow
}

const MAX_STEP = 0.1
const Z_AXIS = new THREE.Vector3(0, 0, 1)
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const point = new THREE.Vector3()
const spot = new THREE.Vector3()
const turn = new THREE.Quaternion()
const scale = new THREE.Vector3()
const local = new THREE.Matrix4()
const world = new THREE.Matrix4()

export function createCaptainRig(def: BossDef, view: BossBody, kit: CaptainKit): BossRig {
  const R = CAPTAIN_RIG
  const D = CAPTAIN_DEFEAT
  const { models, effects, tuning } = kit
  const model = models.instance('shield-captain')
  mount(view, model)
  const { nodes, root } = model
  const body = nodes.get('body') ?? null
  const armL = nodes.get('arm_l') ?? null
  const armLLower = nodes.get('arm_l_lower') ?? null
  const armR = nodes.get('arm_r') ?? null
  const armRLower = nodes.get('arm_r_lower') ?? null
  const legL = nodes.get('leg_l') ?? null
  const legLLower = nodes.get('leg_l_lower') ?? null
  const legR = nodes.get('leg_r') ?? null
  const legRLower = nodes.get('leg_r_lower') ?? null
  const hand = nodes.get('hand_l') ?? null
  const shield = nodes.get('shield') ?? null
  const sparkSocket = nodes.get('socket_fx_shield') ?? null
  const joints = [body, armL, armLLower, armR, armRLower, legL, legLLower, legR, legRLower]
  for (const joint of joints) if (joint) restQuaternion(joint)
  const eye = lightOf(model.glow.get('mat_eye'))
  const core = lightOf(model.glow.get('mat_glow'))
  const starHeight = heightIn(root, nodes.get('socket_head'), 2.7)
  const salute = { arm: blenderTurn(D.salute.arm), forearm: blenderTurn(D.salute.forearm) }

  const shieldRest = shield ? { position: shield.position.clone(), quaternion: shield.quaternion.clone() } : null
  const shieldTint: THREE.MeshStandardMaterial[] = []
  const shieldMaterials: THREE.Material[] = []
  if (shield) {
    const copies = new Map<THREE.Material, THREE.Material>()
    shield.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      const adopt = (material: THREE.Material) => {
        let copy = copies.get(material)
        if (!copy) {
          copy = material.clone()
          copies.set(material, copy)
          shieldMaterials.push(copy)
          if (copy instanceof THREE.MeshStandardMaterial && copy.emissive.getHex() === 0) shieldTint.push(copy)
        }
        return copy
      }
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(adopt) : adopt(mesh.material)
    })
    view.materials.push(...shieldTint)
    view.owned.push({ dispose: () => shield.removeFromParent() })
    view.owned.push({ dispose: () => shieldMaterials.forEach((material) => material.dispose()) })
  }
  let shieldLength = 1.85
  if (shield) {
    shield.updateWorldMatrix(true, true)
    const box = new THREE.Box3().setFromObject(shield)
    shield.getWorldPosition(point)
    shieldLength = Math.max(0.5, box.max.y - point.y)
  }

  const waveGeometry = new THREE.CircleGeometry(1, 28, -((tuning.weapons.captainBash.arcDeg * Math.PI) / 180) / 2, (tuning.weapons.captainBash.arcDeg * Math.PI) / 180)
  const waveMaterial = new THREE.MeshBasicMaterial({ color: R.wave, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
  view.owned.push(waveGeometry, waveMaterial)
  const waveHolder = new THREE.Group()
  const wave = new THREE.Mesh(waveGeometry, waveMaterial)
  wave.rotation.x = -Math.PI / 2
  wave.position.y = 0.06
  wave.visible = false
  waveHolder.add(wave)
  anchorOf(view).add(waveHolder)

  const gait = { phase: 0, stride: 0 }
  const shift: Shift = { dx: 0, dz: 0 }
  const track = tracker(view, R.teleport)
  const target = blankCaptainPose()
  const pose = blankCaptainPose()
  const legs: CaptainLegs = { leftHip: 0, leftKnee: 0, rightHip: 0, rightKnee: 0 }
  const fall = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }
  const ground = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }
  const lifted = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }
  let mode: ShieldMode = 'hand'
  let dropAt = 0
  let now = 0
  let hop = 0
  let shake = 0
  let flash = 0
  let sparkAt = -Infinity
  let dustAt = -Infinity
  let waveAt = -Infinity
  let move: BossMoveId | null = null
  let show: Show | null = null

  const sceneOf = () => anchorOf(view).parent ?? anchorOf(view)

  const handPlacement = (out: { position: THREE.Vector3; quaternion: THREE.Quaternion }) => {
    if (!hand || !shieldRest) return out
    hand.updateWorldMatrix(true, false)
    local.compose(shieldRest.position, shieldRest.quaternion, scale.set(1, 1, 1))
    world.multiplyMatrices(hand.matrixWorld, local)
    world.decompose(out.position, out.quaternion, scale)
    return out
  }

  const release = () => {
    for (const material of shieldTint) {
      const index = view.materials.indexOf(material)
      if (index >= 0) view.materials.splice(index, 1)
      material.emissiveIntensity = 0
      if (material.userData.baseColor instanceof THREE.Color) material.color.copy(material.userData.baseColor)
    }
  }

  const regain = () => {
    for (const material of shieldTint) if (!view.materials.includes(material)) view.materials.push(material)
  }

  const dropShield = (drop: { x: number; y: number; facing: number }) => {
    if (!shield) return
    const scene = sceneOf()
    scene.attach(shield)
    fall.position.copy(shield.position)
    fall.quaternion.copy(shield.quaternion)
    const { position } = anchorOf(view)
    lyingSpot(drop, { x: position.x, y: position.z }, shieldLength, R, ground.position)
    lyingTurn(drop.facing, R, ground.quaternion)
    mode = 'falling'
    dropAt = now
    release()
  }

  const holdShield = () => {
    if (!shield || !hand || !shieldRest) return
    hand.add(shield)
    shield.position.copy(shieldRest.position)
    shield.quaternion.copy(shieldRest.quaternion)
    mode = 'hand'
    regain()
  }

  const placeShield = (from: { position: THREE.Vector3; quaternion: THREE.Quaternion }, to: { position: THREE.Vector3; quaternion: THREE.Quaternion }, k: number, rise: number) => {
    if (!shield) return
    shield.position.lerpVectors(from.position, to.position, k)
    shield.position.y += 4 * rise * k * (1 - k)
    shield.quaternion.slerpQuaternions(from.quaternion, to.quaternion, k)
  }

  const dust = (x: number, z: number, count: number, size: number) => {
    for (let i = 0; i < count; i++) effects?.puff(x + scatter(0.3), 0.12 + Math.random() * 0.15, z + scatter(0.3), R.dust, 0.2 * size, 0.75 * size, 0.45)
  }

  const kickDust = () => {
    for (const foot of [legLLower, legRLower]) {
      if (!foot) continue
      socketWorld(foot, point)
      dust(point.x, point.z, 1, 1)
    }
  }

  const sparks = () => {
    if (!sparkSocket || !effects) return
    socketWorld(sparkSocket, point)
    effects.puff(point.x, point.y, point.z, R.spark, 0.18, 0.7, 0.14)
    for (let i = 0; i < 5; i++) {
      effects.puff(point.x + scatter(0.4), point.y + scatter(0.45), point.z + scatter(0.4), i % 2 === 0 ? R.spark : R.ember, 0.08, 0.02, 0.35, 0.3 + Math.random() * 0.4)
    }
  }

  const bashImpact = () => {
    const radius = tuning.weapons.captainBash.radius
    waveAt = now
    waveHolder.rotation.y = view.pivot.rotation.y
    const anchor = anchorOf(view)
    const half = ((tuning.weapons.captainBash.arcDeg * Math.PI) / 180) / 2
    for (let i = 0; i < 6; i++) {
      const angle = -view.pivot.rotation.y + (i / 5 - 0.5) * 2 * half * 0.9
      const reach = radius * (0.55 + Math.random() * 0.35)
      toWorld(anchor, spot.set(Math.cos(angle) * reach, 0, Math.sin(angle) * reach), point)
      effects?.puff(point.x, 0.2 + Math.random() * 0.2, point.z, R.dust, 0.25, 0.95, 0.4)
    }
  }

  const syncShield = (state: Parameters<BossRig['sync']>[0]) => {
    const held = state.shield?.held ?? true
    if (held) {
      if (mode !== 'hand') holdShield()
      return
    }
    const drop = state.shield
    if (!drop) return
    if (mode === 'hand') dropShield(drop)
    if (mode === 'falling') {
      const k = Math.min(1, (now - dropAt) / R.dropSeconds)
      placeShield(fall, ground, smooth(k), R.dropRise)
      if (k >= 1) {
        mode = 'ground'
        dust(ground.position.x, ground.position.z, 4, 1.3)
      }
      return
    }
    const lift = pickProgress(def, state)
    if (lift > 0) {
      root.updateWorldMatrix(true, true)
      placeShield(ground, handPlacement(lifted), smooth(lift), 0.25)
    } else if (shield) {
      shield.position.copy(ground.position)
      shield.quaternion.copy(ground.quaternion)
    }
  }

  function begin(): Show {
    view.body.position.set(0, 0, 0)
    view.body.rotation.set(0, 0, 0)
    view.body.scale.setScalar(1)
    const anchor = anchorOf(view)
    const facing = -view.pivot.rotation.y
    const from = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }
    if (shield) {
      anchor.attach(shield)
      from.position.copy(shield.position)
      from.quaternion.copy(shield.quaternion)
    }
    mode = 'show'
    release()
    wave.visible = false
    return {
      previous: 0,
      saved: remember(joints),
      fade: fader(model.materials, root),
      shieldFade: fader(shieldMaterials, shield),
      from,
      to: { position: standSpot(facing), quaternion: standTurn(facing) },
      pose: { plant: 0, salute: 0, angle: 0, light: 1, fade: 1 },
    }
  }

  return {
    starHeight,
    defeatSeconds: captainDefeatSeconds(def.show, D),
    sync(state, clock, rawDt) {
      const dt = Math.min(MAX_STEP, rawDt)
      now = clock
      move = state.move
      track(shift)
      const speed = rawDt > 0 ? Math.hypot(shift.dx, shift.dz) / rawDt : 0
      const stunned = state.phase === 'stunned'
      captainPose(def, state, tuning.weapons, R, target)
      for (const key of POSE_KEYS) pose[key] = approach(pose[key], target[key], R.ease, dt)
      const running = pose.run > 0.5
      stepGait(gait, dt, speed > R.moving && !stunned, strideRate(speed, R.walkRate, R.minRate, R.maxRate * (running ? R.runRate : 1)), R.strideEase)
      captainLegs(gait, pose.run, R, legs)
      if (legL) rotateFromRest(legL, Z_AXIS, legs.leftHip)
      if (legLLower) rotateFromRest(legLLower, Z_AXIS, legs.leftKnee)
      if (legR) rotateFromRest(legR, Z_AXIS, legs.rightHip)
      if (legRLower) rotateFromRest(legRLower, Z_AXIS, legs.rightKnee)
      shake = approach(shake, 0, R.blockDecay, dt)
      hop = approach(hop, 0, R.hopDecay, dt)
      flash = approach(flash, 0, R.flashDecay, dt)
      const step = Math.sin(gait.phase) * gait.stride
      const reach = pose.reach - shake * R.blockShake
      if (armL) rotateFromRest(armL, Z_AXIS, reach)
      if (armLLower) rotateFromRest(armLLower, Z_AXIS, -reach)
      const swing = Math.max(-0.1, Math.min(0.26, step * 0.22))
      if (armR) rotateFromRest(armR, Z_AXIS, swing + pose.lunge * 0.4)
      if (armRLower) rotateFromRest(armRLower, Z_AXIS, Math.max(0, swing) * 0.4 + pose.lunge * 0.6)
      const wobble = stunned ? Math.sin(clock * R.stunRate) * R.stunWobble : 0
      if (body) orient(body, wobble, pose.twist, -pose.bend)
      const idle = Math.sin(clock * R.idleRate) * R.idleBob * (1 - gait.stride)
      root.position.set(pose.lunge, idle + Math.abs(Math.sin(gait.phase)) * gait.stride * R.bob - pose.crouch, 0)
      root.rotation.set(step * R.sway, 0, -pose.lean + hop * R.hopLean)
      const telegraph = telegraphProgress(def, state, tuning.weapons)
      shine([eye], stunned ? R.eyeStunned : 1 + R.eyeBreath * Math.sin(clock * R.eyeRate) + telegraph * (R.eyeTelegraph - 1))
      shine([core], 1 + R.coreBreath * Math.sin(clock * R.coreRate) + flash * R.coreFlash)
      syncShield(state)
      if (state.phase === 'active' && state.move === 'charge' && clock - dustAt >= R.dustGap) {
        dustAt = clock
        kickDust()
      }
      const since = clock - waveAt
      wave.visible = since >= 0 && since < R.waveSeconds
      if (wave.visible) {
        const k = since / R.waveSeconds
        wave.scale.setScalar(tuning.weapons.captainBash.radius * mix(R.waveFrom, 1, 1 - (1 - k) ** 2))
        waveMaterial.opacity = R.waveOpacity * (1 - k)
      }
    },
    handle(event) {
      if (show) return
      switch (event.type) {
        case 'shieldBlocked':
          if (!near(view, event.x, event.y, def.radius + 1.6)) break
          shake = 1
          if (now - sparkAt >= R.sparkGap) {
            sparkAt = now
            sparks()
          }
          break
        case 'bossBackHit':
          if (near(view, event.x, event.y, def.radius)) flash = 1
          break
        case 'enemyHit':
          if (near(view, event.x, event.y, def.radius * 0.8)) hop = Math.min(1, hop + R.hitHop)
          break
        case 'blast':
          if (event.source !== 'boss' || move !== 'bash' || !near(view, event.x, event.y, 0.6)) break
          bashImpact()
          return true
        default:
          break
      }
    },
    defeat(time) {
      if (!show) show = begin()
      const previous = show.previous
      show.previous = time
      const p = captainShow(time, def.show, D, show.pose)
      const lay = def.show?.lay ?? 0
      const fallSeconds = def.show?.fall ?? 1
      const heel = D.heel
      root.rotation.set(0, 0, p.angle)
      root.position.set(heel * (1 - Math.cos(p.angle)), -heel * Math.sin(p.angle), 0)
      if (body) orient(body, 0, 0, 0)
      for (const joint of [legL, legLLower, legR, legRLower, armL, armLLower]) if (joint) rotateFromRest(joint, Z_AXIS, 0)
      if (armR) armR.quaternion.copy(restQuaternion(armR)).multiply(turn.identity().slerp(salute.arm, p.salute))
      if (armRLower) armRLower.quaternion.copy(restQuaternion(armRLower)).multiply(turn.identity().slerp(salute.forearm, p.salute))
      blendFrom(show.saved, smooth(span(time, 0, 0.12)))
      if (shield) {
        shield.position.lerpVectors(show.from.position, show.to.position, p.plant)
        shield.position.y += 4 * 0.12 * p.plant * (1 - p.plant)
        shield.quaternion.slerpQuaternions(show.from.quaternion, show.to.quaternion, p.plant)
      }
      if (passed(previous, time, Math.min(D.plant, Math.max(lay, 0.01)))) {
        toWorld(anchorOf(view), show.to.position, point)
        dust(point.x, point.z, 3, 0.9)
      }
      if (passed(previous, time, lay + fallSeconds)) {
        root.updateWorldMatrix(true, false)
        for (let i = 0; i < 6; i++) {
          root.localToWorld(spot.set(-1.3 + scatter(0.7), 0.25 + Math.random() * 0.4, scatter(0.8)))
          effects?.puff(spot.x, spot.y, spot.z, D.dust, 0.3, 1.2, 0.7)
        }
        toWorld(anchorOf(view), spot.set(-1.2, 0, 0).applyAxisAngle(Y_AXIS, view.pivot.rotation.y), point)
        effects?.burst(point.x, point.z, D.dust, 1.6)
      }
      shine([eye], p.light < 1 ? flicker(time - lay, D.eyeFade, D.flicker) : 1)
      shine([core], mix(0.15, 1, p.light))
      show.fade(p.fade)
      show.shieldFade(p.fade)
    },
  }
}
