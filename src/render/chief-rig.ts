import * as THREE from 'three'
import type { BossDef } from '../data/bosses'
import type { Tuning } from '../data/tuning'
import {
  anchorOf,
  blendFrom,
  detach,
  fader,
  headingOf,
  heightIn,
  jointsOf,
  lightOf,
  mount,
  near,
  orient,
  remember,
  scatter,
  shine,
  sideOf,
  toWorld,
  tracker,
  type Fader,
  type Placement,
  type Shift,
} from './boss-kit'
import { approach, flicker, legBend, mix, passed, smooth, span, stepGait, strideRate, telegraphProgress, ticks } from './boss-motion'
import type { BossBody, BossRig } from './boss-rigs'
import {
  cannonBrace,
  cannonGlow,
  chiefDefeatSeconds,
  chiefFall,
  firstShown,
  handShown,
  heelShift,
  laySpot,
  layStart,
  rackShown,
  stripStart,
  throwPose,
  type ArmPose,
  type Fall,
} from './chief-motion'
import type { Effects } from './effects'
import { restQuaternion, rotateFromRest, socketWorld, type ModelLibrary } from './model-library'
import { dropLauncher, shareLauncher, type MuzzleSource } from './muzzle-link'
import { mergeMeshes } from './node-parts'
import { BOSS_DEFEAT, CHIEF_DEFEAT, CHIEF_RIG } from './themes'

export const CHIEF_RACK = ['bomb_1', 'bomb_2', 'bomb_3', 'bomb_4', 'bomb_5', 'bomb_6', 'bomb_7', 'bomb_8'] as const

export const CHIEF_NODES = [
  'body',
  'eye',
  'cannon',
  'fuse',
  'rack',
  ...CHIEF_RACK,
  'bomb_hand',
  'arm_l',
  'arm_l_lower',
  'arm_r',
  'arm_r_lower',
  'leg_l',
  'leg_l_lower',
  'leg_r',
  'leg_r_lower',
  'socket_muzzle',
  'socket_fx_spark',
  'socket_head',
  'socket_hand_r',
] as const

const STATIC_PARTS = ['body', 'emblem', 'eye', 'fuse', 'lamp_l', 'lamp_r', 'lamp_l_front', 'lamp_r_front', 'rack'] as const

interface Strip {
  mesh: THREE.Mesh
  starts: number[]
  total: number
}

export interface ChiefKit {
  models: ModelLibrary
  effects: Effects | null
  tuning: Tuning
}

interface Laid {
  node: THREE.Object3D
  start: Placement | null
  land: THREE.Vector3
  at: number
}

interface ChiefShow {
  previous: number
  laid: Laid[]
  saved: Map<THREE.Object3D, THREE.Quaternion>
  fade: Fader
  rest: THREE.Quaternion
  fall: Fall
}

const MAX_STEP = 0.1
const Z_AXIS = new THREE.Vector3(0, 0, 1)
const point = new THREE.Vector3()
const spot = new THREE.Vector3()

export function createChiefRig(def: BossDef, view: BossBody, kit: ChiefKit): BossRig {
  const R = CHIEF_RIG
  const D = CHIEF_DEFEAT
  const { models, effects, tuning } = kit
  const model = models.instance('demo-chief')
  mount(view, model)
  const { nodes, root } = model
  const legs = jointsOf(nodes, ['leg_l', 'leg_r'])
  const arms = jointsOf(nodes, ['arm_l', 'arm_r'])
  const right = arms.find((arm) => arm.upper === nodes.get('arm_r')) ?? null
  const left = arms.find((arm) => arm.upper === nodes.get('arm_l')) ?? null
  const cannon = nodes.get('cannon') ?? null
  const cannonRest = cannon ? cannon.position.clone() : new THREE.Vector3()
  if (cannon) restQuaternion(cannon)
  const muzzle = nodes.get('socket_muzzle') ?? null
  const hand = nodes.get('socket_hand_r') ?? null
  const handBomb = nodes.get('bomb_hand') ?? null
  const rack = CHIEF_RACK.map((name) => nodes.get(name) ?? null)
  const size = def.rack?.size ?? rack.length
  const fuse = nodes.get('socket_fx_spark') ?? null
  const lamps = lightOf(model.glow.get('mat_lamp'))
  const eye = lightOf(model.glow.get('mat_eye'))
  const bore = lightOf(model.glow.get('mat_glow'))
  const starHeight = heightIn(root, nodes.get('socket_head'), 2.7)
  const named = new Set(nodes.values())
  const ownMeshes = (node: THREE.Object3D | undefined): THREE.Mesh[] => {
    const found: THREE.Mesh[] = []
    const visit = (object: THREE.Object3D) => {
      const mesh = object as THREE.Mesh
      if (mesh.isMesh && object.children.length === 0) found.push(mesh)
      for (const child of object.children) if (!named.has(child)) visit(child)
    }
    if (node) visit(node)
    return found
  }
  const bodyNode = nodes.get('body')
  if (bodyNode) {
    for (const part of mergeMeshes([STATIC_PARTS.flatMap((name) => ownMeshes(nodes.get(name)))], bodyNode)) {
      const mesh = new THREE.Mesh(part.geometry, part.material)
      mesh.castShadow = part.castShadow
      bodyNode.add(mesh)
      view.owned.push(part.geometry)
      for (const source of part.meshes) source.visible = false
    }
  }
  const strip: Strip[] = []
  const rackNode = nodes.get('rack')
  if (rackNode && rack.every((bomb) => bomb !== null)) {
    const groups = rack.map((bomb) => {
      const list: THREE.Mesh[] = []
      bomb?.traverse((object) => {
        if ((object as THREE.Mesh).isMesh) list.push(object as THREE.Mesh)
      })
      return list
    })
    for (const part of mergeMeshes(groups, rackNode)) {
      const mesh = new THREE.Mesh(part.geometry, part.material)
      mesh.castShadow = part.castShadow
      rackNode.add(mesh)
      view.owned.push(part.geometry)
      strip.push({ mesh, starts: part.starts, total: part.geometry.index ? part.geometry.index.count : part.geometry.getAttribute('position').count })
    }
    if (strip.length > 0) for (const bomb of rack) if (bomb) bomb.visible = false
  }

  const sparkGeometry = new THREE.OctahedronGeometry(R.sparkSize, 0)
  const sparkMaterial = new THREE.MeshBasicMaterial({ color: R.spark })
  view.owned.push(sparkGeometry, sparkMaterial)
  const spark = fuse ? new THREE.Mesh(sparkGeometry, sparkMaterial) : null
  if (spark && fuse) {
    spark.castShadow = false
    spark.position.x = R.sparkSize * 0.6
    fuse.add(spark)
  }

  const scene = anchorOf(view).parent
  const launcher: MuzzleSource = { muzzle: (out) => (hand ? socketWorld(hand, out) : null) }
  const thrown = def.bales?.weapon
  if (scene && thrown) {
    shareLauncher(scene, thrown, launcher)
    view.owned.push({ dispose: () => dropLauncher(scene, thrown, launcher) })
  }

  const gait = { phase: 0, stride: 0 }
  const shift: Shift = { dx: 0, dz: 0 }
  const track = tracker(view, R.teleport)
  const target: ArmPose = { raise: 0, elbow: 0, lean: 0 }
  let raise = 0
  let elbow = 0
  let lean = 0
  let brace = 0
  let kick = 0
  let hop = 0
  let tossAt = -Infinity
  let now = 0
  let emberAt = -Infinity
  let bombs = size
  let show: ChiefShow | null = null

  function puffAt(node: THREE.Object3D | null, color: string, from: number, to: number, duration: number): void {
    if (!node || !effects) return
    socketWorld(node, point)
    effects.puff(point.x, point.y, point.z, color, from, to, duration)
  }

  function begin(): ChiefShow {
    view.body.position.set(0, 0, 0)
    view.body.rotation.set(0, 0, 0)
    view.body.scale.setScalar(1)
    const heading = headingOf(view, new THREE.Vector3())
    const side = sideOf(heading, new THREE.Vector3())
    const first = firstShown(bombs, size)
    for (const item of strip) item.mesh.visible = false
    const shown = rack.filter((node, index): node is THREE.Object3D => node !== null && (strip.length > 0 ? index >= first : node.visible))
    for (const node of shown) node.visible = true
    const laid = shown.map((node, index): Laid => {
      const where = laySpot(index, shown.length, D)
      const land = new THREE.Vector3().addScaledVector(heading, where.forward).addScaledVector(side, -where.side)
      land.y = D.bombRest
      return { node, start: null, land, at: def.show ? layStart(index, shown.length, def.show, D) : 0 }
    })
    const joints = [...legs, ...arms].flatMap((joint) => [joint.upper, joint.lower])
    return {
      previous: 0,
      laid,
      saved: remember([...joints, cannon]),
      fade: fader([...model.materials, sparkMaterial], root),
      rest: view.pivot.quaternion.clone(),
      fall: { angle: 0, lean: 0, reach: 0, light: 1, fade: 1 },
    }
  }

  function placeBombs(state: ChiefShow, previous: number, time: number): void {
    const anchor = anchorOf(view)
    for (const item of state.laid) {
      if (time < item.at) continue
      if (!item.start) {
        item.node.visible = true
        item.start = detach(item.node, anchor)
      }
      const k = Math.min(1, (time - item.at) / D.bombFlight)
      const from = item.start.position
      item.node.position.set(mix(from.x, item.land.x, k), mix(from.y, item.land.y, k) + 4 * D.bombRise * k * (1 - k), mix(from.z, item.land.z, k))
      item.node.quaternion.copy(item.start.quaternion).slerp(state.rest, smooth(k))
      if (passed(previous, time, item.at + D.bombFlight)) {
        toWorld(anchor, item.land, point)
        effects?.puff(point.x, 0.12, point.z, D.dust, 0.15, 0.55, 0.35)
      }
    }
  }

  function impact(previous: number, time: number): void {
    const lay = def.show?.lay ?? 0
    const fall = def.show?.fall ?? 1
    const anchor = anchorOf(view)
    const hit = lay + fall
    if (passed(previous, time, lay)) {
      if (spark) spark.visible = false
      puffAt(fuse, D.smoke, 0.15, 0.6, 0.6)
    }
    if (passed(previous, time, hit)) {
      toWorld(anchor, spot.set(0, 0, 0), point)
      effects?.burst(point.x, point.z, D.dust, 1.6)
      root.updateWorldMatrix(true, false)
      for (let i = 0; i < 5; i++) {
        root.localToWorld(spot.set(-1.2 + scatter(0.6), 0.3 + Math.random() * 0.5, scatter(0.8)))
        effects?.puff(spot.x, spot.y, spot.z, D.dust, 0.3, 1.2, 0.7)
      }
    }
    const wisps = Math.min(BOSS_DEFEAT.maxBursts, ticks(previous, time, hit, hit + D.lie, 0.35))
    for (let i = 0; i < wisps; i++) {
      if (!fuse) break
      socketWorld(fuse, point)
      effects?.puff(point.x + scatter(0.1), point.y + 0.1, point.z + scatter(0.1), D.smoke, 0.12, 0.5, 0.9)
    }
  }

  return {
    starHeight,
    defeatSeconds: chiefDefeatSeconds(def.show, D),
    sync(state, clock, rawDt) {
      const dt = Math.min(MAX_STEP, rawDt)
      now = clock
      track(shift)
      const speed = rawDt > 0 ? Math.hypot(shift.dx, shift.dz) / rawDt : 0
      const stunned = state.phase === 'stunned'
      stepGait(gait, dt, speed > R.moving && !stunned, strideRate(speed, R.walkRate, R.minRate, R.maxRate), R.strideEase)
      for (const leg of legs) {
        const [hip, knee] = legBend(gait, leg.side, R.legSwing, R.knee)
        rotateFromRest(leg.upper, Z_AXIS, hip)
        if (leg.lower) rotateFromRest(leg.lower, Z_AXIS, knee)
      }
      const step = Math.sin(gait.phase) * gait.stride
      const since = clock - tossAt
      throwPose(def, state, since, R, target)
      raise = approach(raise, target.raise, R.ease, dt)
      elbow = approach(elbow, target.elbow, R.ease, dt)
      lean = approach(lean, target.lean, R.ease, dt)
      brace = approach(brace, cannonBrace(def, state, tuning.weapons), R.ease, dt)
      kick = approach(kick, 0, R.kickDecay, dt)
      hop = approach(hop, 0, R.hopDecay, dt)
      const counter = R.raise > 0 ? (raise / R.raise) * R.brace : 0
      if (right) {
        orient(right.upper, right.side * brace * R.cannonBrace, 0, raise - step * R.heldSwing * right.side)
        if (right.lower) orient(right.lower, 0, 0, elbow)
      }
      if (left) {
        orient(left.upper, left.side * (brace * R.cannonBrace + counter * 0.4), 0, counter - step * R.armSwing * left.side)
        if (left.lower) orient(left.lower, 0, 0, counter * 0.5)
      }
      if (handBomb) handBomb.visible = handShown(since, R)
      bombs = state.bombs
      if (strip.length > 0) {
        const first = firstShown(state.bombs, size)
        for (const item of strip) item.mesh.geometry.setDrawRange(stripStart(item.starts, item.total, first), Infinity)
      } else {
        rack.forEach((node, index) => {
          if (node) node.visible = rackShown(index + 1, state.bombs, size)
        })
      }
      if (cannon) {
        rotateFromRest(cannon, Z_AXIS, kick * R.cannonKick - brace * R.cannonDip)
        cannon.position.set(cannonRest.x - kick * R.cannonSlide, cannonRest.y, cannonRest.z)
      }
      const idle = Math.sin(clock * R.idleRate) * R.idleBob * (1 - gait.stride)
      root.position.set(0, idle + Math.abs(Math.sin(gait.phase)) * gait.stride * R.bob, 0)
      const wobble = stunned ? Math.sin(clock * 6) * 0.06 : 0
      root.rotation.set(step * R.sway + wobble, 0, -lean + kick * R.bodyKick + hop * R.hopLean - brace * 0.03)
      const telegraph = telegraphProgress(def, state, tuning.weapons)
      shine([lamps], 1 + R.lampBreath * Math.sin(clock * R.lampRate) + telegraph)
      shine([eye], stunned ? 0.35 : 1 + R.eyeBreath * Math.sin(clock * R.eyeRate) + telegraph * (R.eyeTelegraph - 1))
      shine([bore], cannonGlow(def, state, tuning.weapons, R) * (1 + kick * 0.6))
      if (spark) spark.scale.setScalar(0.7 + 0.6 * Math.abs(Math.sin(clock * 23) * Math.sin(clock * 7.3)))
      if (fuse && clock - emberAt >= R.emberGap) {
        emberAt = clock
        puffAt(fuse, R.ember, 0.04, 0.16, 0.3)
      }
    },
    handle(event) {
      if (show) return
      switch (event.type) {
        case 'enemyShot':
          if (!near(view, event.x, event.y, def.radius + 0.6)) break
          if (event.weapon === def.bales?.weapon) tossAt = now
          else if (event.weapon === def.cannon?.weapon) {
            kick = 1
            puffAt(muzzle, R.flash, 0.25, 0.75, 0.1)
            puffAt(muzzle, R.smoke, 0.3, 0.9, 0.45)
          }
          break
        case 'enemyHit':
          if (near(view, event.x, event.y, def.radius * 0.8)) hop = Math.min(1, hop + R.hitHop)
          break
        default:
          break
      }
    },
    defeat(time) {
      if (!show) show = begin()
      const previous = show.previous
      show.previous = time
      const fall = chiefFall(time, def.show, show.laid.length, D, show.fall)
      const heel = heelShift(fall.angle, D.heel)
      root.rotation.set(0, 0, fall.angle + fall.lean)
      root.position.set(heel.x, heel.y, 0)
      for (const leg of legs) {
        rotateFromRest(leg.upper, Z_AXIS, 0)
        if (leg.lower) rotateFromRest(leg.lower, Z_AXIS, 0)
      }
      if (right) {
        orient(right.upper, 0, 0, R.follow + fall.reach * D.reach)
        if (right.lower) orient(right.lower, 0, 0, fall.reach * 0.3)
      }
      if (left) {
        orient(left.upper, 0, 0, 0.2 * span(time, def.show?.lay ?? 0, chiefDefeatSeconds(def.show, D)))
        if (left.lower) orient(left.lower, 0, 0, 0)
      }
      if (cannon) {
        rotateFromRest(cannon, Z_AXIS, 0)
        cannon.position.copy(cannonRest)
      }
      blendFrom(show.saved, smooth(span(time, 0, BOSS_DEFEAT.blendIn)))
      placeBombs(show, previous, time)
      shine([eye], fall.light < 1 ? flicker(time - (def.show?.lay ?? 0), D.eyeFade, D.flicker) : 1)
      shine([lamps], fall.light)
      shine([bore], fall.light * 0.5)
      impact(previous, time)
      show.fade(fall.fade)
    },
  }
}
