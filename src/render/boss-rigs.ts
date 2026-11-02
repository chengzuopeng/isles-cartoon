import * as THREE from 'three'
import { BOSSES, type BossDef } from '../data/bosses'
import { createDefaultTuning, type Tuning } from '../data/tuning'
import type { BossState, GameEvent } from '../sim/types'
import { createDebris, type Debris } from './boss-debris'
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
  toLocal,
  toWorld,
  tracker,
  type Fader,
  type Placement,
  type Shift,
} from './boss-kit'
import {
  approach,
  arc,
  blankCollapse,
  blankPose,
  coastAngle,
  dragged,
  flicker,
  forwardTravel,
  harvesterEjection,
  headerLift,
  landingTime,
  legBend,
  mix,
  passed,
  reelSpeed,
  riseThenSettle,
  scarecrowCollapse,
  scarecrowPose,
  smooth,
  span,
  stepGait,
  strideRate,
  telegraphProgress,
  ticks,
  unloaderLift,
  unloaderYaw,
  wheelTurn,
  wrapAngle,
  type Ejection,
  type ScarecrowPose,
} from './boss-motion'
import type { ModelKit } from './character-models'
import { createCaptainRig } from './captain-rig'
import { createChiefRig } from './chief-rig'
import { createTankRig } from './tank-rig'
import type { Effects } from './effects'
import {
  EMPTY_LIBRARY,
  restQuaternion,
  rotateFromRest,
  socketWorld,
  type ModelInstance,
  type ModelLibrary,
} from './model-library'
import {
  BOSS_DEFEAT,
  FALLBACK_DEFEAT,
  HARVESTER_DEFEAT,
  HARVESTER_RIG,
  MORNING_STAR,
  SCARECROW_DEFEAT,
  SCARECROW_POSE,
} from './themes'
import { part, standard, type Disposable } from './view-helpers'

export interface BossBody {
  body: THREE.Group
  pivot: THREE.Group
  material: THREE.MeshStandardMaterial
  materials: THREE.MeshStandardMaterial[]
  owned: Disposable[]
}

export interface DefeatTarget {
  x: number
  y: number
  exit?: { x: number; y: number } | null
}

export interface BossRig {
  readonly starHeight: number
  readonly defeatSeconds: number
  sync(state: BossState, clock: number, dt: number): void
  handle(event: GameEvent): boolean | void
  defeat(time: number, target: DefeatTarget | null): void
}

export interface BossRigs {
  build(def: BossDef, view: BossBody): BossRig
}

interface Wheel {
  node: THREE.Object3D
  radius: number
  angle: number
}

interface Star {
  node: THREE.Object3D
  materials: THREE.Material[]
  sync(dt: number, clock: number, glow: number): void
}

interface HarvesterShow {
  previous: number
  from: { pitch: number; yaw: number }
  reel: number
  speed: number
  raise: number
  debris: Debris
  fade: Fader
  glow: Fader | null
  heading: THREE.Vector3
  side: THREE.Vector3
  roof: { start: Placement; along: THREE.Vector3; rise: number; reach: number; axis: THREE.Vector3; land: number; from: number } | null
  seat: { start: Placement; center: THREE.Vector3 } | null
  shard: { start: Placement; land: THREE.Vector3; from: THREE.Vector3 | null; gone: boolean } | null
}

interface ScarecrowShow {
  previous: number
  lean: number
  saved: Map<THREE.Object3D, THREE.Quaternion>
  debris: Debris
  fade: Fader
  heading: THREE.Vector3
  side: THREE.Vector3
  hat: { start: Placement; land: THREE.Vector3; yaw: number } | null
  fork: { start: Placement; tip: THREE.Vector3; over: THREE.Quaternion } | null
}

const TAU = Math.PI * 2
const MAX_STEP = 0.1
const Z_AXIS = new THREE.Vector3(0, 0, 1)
const WHEELS = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'] as const
const POSE_KEYS = ['lean', 'back', 'raise', 'spread', 'slump'] as const
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const point = new THREE.Vector3()
const spot = new THREE.Vector3()
const twist = new THREE.Quaternion()
const held = new THREE.Quaternion()
const lay = new THREE.Quaternion()
const upright = new THREE.Euler(0, 0, 0, 'YXZ')
const HARVESTER_SPARKS: readonly (readonly [number, number, number])[] = [
  [0.95, 0.55, 0.7],
  [0.95, 0.55, -0.7],
  [0.35, 2.05, 0.3],
  [-0.9, 2.2, 0.55],
  [-0.6, 1.45, 0.9],
  [-0.6, 1.45, -0.9],
  [-1.25, 1.3, 0],
  [0.1, 0.95, 0.8],
  [0.1, 0.95, -0.8],
]
const SEAT_DRIFT = new THREE.Vector3(0.35, 0, -1).normalize()
const SEAT_TUMBLE = new THREE.Vector3(1, 0, 0.35).normalize()
const HARVESTER_BITS = [HARVESTER_DEFEAT.paint, HARVESTER_DEFEAT.steel, '#2f3440', HARVESTER_DEFEAT.paint] as const

function bossIdOf(def: BossDef): string {
  for (const [id, entry] of Object.entries(BOSSES)) if (entry === def) return id
  return def.tier === 'chapter' ? 'harvester' : 'scarecrow'
}

function relativeTurn(node: THREE.Object3D, anchor: THREE.Object3D, out: THREE.Quaternion): THREE.Quaternion {
  node.updateWorldMatrix(true, false)
  node.getWorldQuaternion(out)
  anchor.getWorldQuaternion(held)
  return out.premultiply(held.invert())
}

export function createBossRigs(
  kit: ModelKit,
  models: ModelLibrary = EMPTY_LIBRARY,
  effects: Effects | null = null,
  tuning: Tuning = createDefaultTuning(),
): BossRigs {
  const geometries = {
    body: new THREE.CapsuleGeometry(0.9, 1.0, 8, 20),
    hat: new THREE.ConeGeometry(1.0, 0.8, 18),
    brim: new THREE.CylinderGeometry(1.45, 1.45, 0.08, 24),
    arms: new THREE.BoxGeometry(0.26, 0.26, 3.0),
    eye: new THREE.SphereGeometry(0.13, 10, 8),
  }

  function puffAt(node: THREE.Object3D | null, color: string, from: number, to: number, duration: number): void {
    if (!node || !effects) return
    socketWorld(node, point)
    effects.puff(point.x, point.y, point.z, color, from, to, duration)
  }

  function settle(view: BossBody, state: BossState, clock: number): void {
    const resting = state.phase === 'recover' || state.phase === 'stunned'
    view.body.position.y = resting ? -0.15 : 0
    view.body.rotation.z = state.phase === 'stunned' ? Math.sin(clock * 6) * 0.08 : 0
  }

  function puffWorld(at: THREE.Vector3, color: string, from: number, to: number, duration: number): void {
    effects?.puff(at.x, at.y, at.z, color, from, to, duration)
  }

  function crumble(view: BossBody, straw: boolean, spin: (() => { reel: THREE.Object3D; angle: number; speed: number }) | null): (time: number) => void {
    const F = FALLBACK_DEFEAT
    const color = straw ? SCARECROW_DEFEAT.straw : HARVESTER_DEFEAT.smoke
    let previous = 0
    let reel: { reel: THREE.Object3D; angle: number; speed: number } | null = null
    let started = false
    return (time) => {
      const anchor = anchorOf(view)
      if (!started) {
        started = true
        reel = spin?.() ?? null
        view.body.position.set(0, 0, 0)
        view.body.rotation.set(0, 0, 0)
      }
      const topple = span(time, 0, F.toppleSeconds)
      if (straw) {
        const angle = F.topple * topple * topple
        const heel = SCARECROW_DEFEAT.heel
        view.body.rotation.set(0, 0, angle)
        view.body.position.set(heel * (1 - Math.cos(angle)), -heel * Math.sin(angle), 0)
      } else {
        const slump = smooth(topple)
        view.body.rotation.set(F.tilt * 0.6 * slump, 0, F.tilt * slump)
        view.body.position.set(0, -F.sink * slump, 0)
      }
      if (reel) reel.reel.rotation.z = reel.angle - coastAngle(reel.speed, time, HARVESTER_DEFEAT.reelStop)
      view.body.scale.setScalar(Math.max(1e-3, 1 - smooth(span(time, F.shrinkStart, F.seconds))))
      const puffs = Math.min(BOSS_DEFEAT.maxBursts, ticks(previous, time, 0, F.shrinkStart, F.puffGap))
      for (let i = 0; i < puffs; i++) {
        toWorld(anchor, spot.set(scatter(0.7), (straw ? 0.4 : 1.2) + Math.random() * 1.2, scatter(0.7)), point)
        puffWorld(point, color, 0.3, 1.1, 0.8)
      }
      if (passed(previous, time, 0) || passed(previous, time, F.shrinkStart)) {
        toWorld(anchor, spot.set(0, 0, 0), point)
        effects?.burst(point.x, point.z, straw ? SCARECROW_DEFEAT.dust : BOSS_DEFEAT.smoke, 1.5)
      }
      previous = time
    }
  }

  function reaper(def: BossDef, view: BossBody): BossRig {
    const parts = kit.buildReaper(view.material, view.pivot, view.materials)
    for (const item of view.materials) if (item !== view.material) view.owned.push(item)
    const shardScale = parts.shard.scale.clone()
    let speed: number = HARVESTER_RIG.reel.idle
    let angle = 0
    const fall = crumble(view, false, () => ({ reel: parts.reel, angle, speed }))
    return {
      starHeight: 3,
      defeatSeconds: FALLBACK_DEFEAT.seconds,
      sync(state, clock, rawDt) {
        const dt = Math.min(MAX_STEP, rawDt)
        settle(view, state, clock)
        speed = approach(speed, reelSpeed(def, state, tuning.weapons), HARVESTER_RIG.reelEase, dt)
        angle = (angle - speed * dt) % TAU
        parts.reel.rotation.z = angle
        parts.shard.rotation.y = clock * 1.6
        parts.shard.scale.copy(shardScale).multiplyScalar(1 + Math.sin(clock * 5) * 0.08)
      },
      handle() {},
      defeat(time) {
        fall(time)
        parts.shard.rotation.y = time * 6
      },
    }
  }

  function scarecrow(view: BossBody): BossRig {
    const straw = standard('#d8b65a', view.owned)
    view.materials.push(straw)
    const eyeMaterial = new THREE.MeshBasicMaterial({ color: '#ffb02e' })
    view.owned.push(eyeMaterial)
    view.body.add(part(geometries.body, view.material, 0, 1.4, 0))
    view.pivot.add(
      part(geometries.brim, straw, 0, 2.62, 0),
      part(geometries.hat, straw, 0, 3.05, 0),
      part(geometries.arms, view.material, 0, 1.75, 0),
      part(geometries.eye, eyeMaterial, 0.78, 2.05, 0.28),
      part(geometries.eye, eyeMaterial, 0.78, 2.05, -0.28),
    )
    kit.decorateScarecrow(view.pivot)
    const fall = crumble(view, true, null)
    const eyeColor = eyeMaterial.color.clone()
    return {
      starHeight: 3.6,
      defeatSeconds: FALLBACK_DEFEAT.seconds,
      sync(state, clock) {
        settle(view, state, clock)
      },
      handle() {},
      defeat(time) {
        fall(time)
        eyeMaterial.color.copy(eyeColor).multiplyScalar(Math.max(0.15, flicker(time, SCARECROW_DEFEAT.eyeFade, SCARECROW_DEFEAT.flicker)))
      },
    }
  }

  function scarecrowModel(def: BossDef, view: BossBody): BossRig {
    const P = SCARECROW_POSE
    const model = models.instance('scarecrow')
    mount(view, model)
    const { nodes, root } = model
    const legs = jointsOf(nodes, ['leg_l', 'leg_r'])
    const arms = jointsOf(nodes, ['arm_l', 'arm_r'])
    const gait = { phase: 0, stride: 0 }
    const head = nodes.get('head') ?? null
    const hat = nodes.get('hat') ?? null
    const hatRest = hat ? hat.position.y : 0
    const muzzle = nodes.get('socket_muzzle') ?? null
    const eye = lightOf(model.glow.get('mat_eye'))
    const starHeight = heightIn(root, nodes.get('socket_head'), 3.6)
    const target = blankPose()
    const pose: ScarecrowPose = blankPose()
    const shift: Shift = { dx: 0, dz: 0 }
    const track = tracker(view, HARVESTER_RIG.teleport)
    let strike = 0
    let kick = 0
    let hop = 0
    let tiltAngle = 0
    let stunSide = 1
    const F = SCARECROW_DEFEAT
    const torso = nodes.get('body') ?? null
    const fork = nodes.get('pitchfork') ?? null
    const collapse = blankCollapse()
    const core = new THREE.Vector3()
    let show: ScarecrowShow | null = null

    function begin(): ScarecrowShow {
      const anchor = anchorOf(view)
      view.body.position.set(0, 0, 0)
      view.body.rotation.set(0, 0, 0)
      view.body.scale.setScalar(1)
      const debris = createDebris()
      anchor.add(debris.mesh)
      view.owned.push(debris)
      const heading = headingOf(view, new THREE.Vector3())
      const joints = [...legs, ...arms].flatMap((joint) => [joint.upper, joint.lower])
      return {
        previous: 0,
        lean: root.rotation.z,
        saved: remember([...joints, head]),
        debris,
        fade: fader(model.materials, root),
        heading,
        side: sideOf(heading, new THREE.Vector3()),
        hat: null,
        fork: null,
      }
    }

    function shoot(debris: Debris, speed: number, lift: number): void {
      const angle = Math.random() * TAU
      const push = speed * (0.6 + Math.random() * 0.4)
      debris.emit({
        x: core.x + scatter(0.25),
        y: core.y + scatter(0.3),
        z: core.z + scatter(0.25),
        vx: Math.cos(angle) * push,
        vy: lift * (0.5 + Math.random() * 0.5),
        vz: Math.sin(angle) * push,
        color: Math.random() < 0.85 ? F.straw : F.tin,
        length: 0.25 + Math.random() * 0.3,
        width: 0.035 + Math.random() * 0.03,
        life: 2.4 + Math.random() * 1.2,
      })
    }

    function flyHat(show: ScarecrowShow, previous: number, time: number): void {
      if (!hat) return
      const anchor = anchorOf(view)
      if (!show.hat && time >= F.hatPop) {
        const start = detach(hat, anchor)
        const land = start.position.clone().addScaledVector(show.heading, -F.hatBack).addScaledVector(show.side, F.hatSide)
        land.y = F.hatRest
        show.hat = { start, land, yaw: upright.setFromQuaternion(start.quaternion, 'YXZ').y }
        toWorld(anchor, start.position, point)
        puffWorld(point, F.straw, 0.3, 1.2, 0.4)
      }
      const flight = show.hat
      if (!flight) return
      const tau = time - F.hatPop
      const k = Math.min(1, tau / F.hatFlight)
      hat.position.set(
        mix(flight.start.position.x, flight.land.x, k),
        arc(flight.start.position.y, flight.land.y, F.hatRise, k),
        mix(flight.start.position.z, flight.land.z, k),
      )
      const after = Math.max(0, tau - F.hatFlight)
      const rock = k < 1 ? (1 - k) * 0.5 * Math.sin(tau * 9) + k * F.hatTilt : F.hatTilt + F.hatRock * Math.sin(after * 14) * Math.exp(-after * 5)
      const spin = flight.yaw + F.hatSpin * F.hatFlight * (k - (k * k) / 2)
      twist.setFromEuler(upright.set(rock, spin, 0, 'YXZ'))
      hat.quaternion.copy(flight.start.quaternion).slerp(twist, smooth(tau / BOSS_DEFEAT.blendIn))
      if (passed(previous, time, F.hatPop + F.hatFlight)) {
        toWorld(anchor, flight.land, point)
        effects?.burst(point.x, point.z, F.dust, 0.6)
      }
    }

    function dropFork(show: ScarecrowShow, previous: number, time: number): void {
      if (!fork) return
      const anchor = anchorOf(view)
      if (!show.fork && time >= F.fall) {
        const start = detach(fork, anchor)
        const tip = new THREE.Vector3(0, F.forkTip, 0).applyQuaternion(start.quaternion).add(start.position)
        const shaft = new THREE.Vector3(0, 1, 0).applyQuaternion(start.quaternion).normalize()
        const away = new THREE.Vector3(shaft.x, 0, shaft.z)
        if (away.length() < 0.35) away.set(tip.x, 0, tip.z)
        if (away.lengthSq() < 1e-6) away.copy(show.side)
        away.normalize()
        show.fork = { start, tip, over: new THREE.Quaternion().setFromUnitVectors(shaft, away) }
      }
      const drop = show.fork
      if (!drop) return
      const tau = time - F.fall
      const fallen = Math.min(Math.max(0, drop.tip.y - F.forkLie), 0.5 * BOSS_DEFEAT.gravity * tau * tau)
      const tilt = span(tau, F.forkDrop, F.forkDrop + F.forkFall)
      const after = Math.max(0, tau - F.forkDrop - F.forkFall)
      const weight = tilt < 1 ? tilt * tilt : 1 - Math.abs(0.08 * Math.sin(after * 20) * Math.exp(-after * 8))
      fork.quaternion.copy(lay.identity().slerp(drop.over, weight).multiply(drop.start.quaternion))
      spot.set(0, F.forkTip, 0).applyQuaternion(fork.quaternion)
      fork.position.set(drop.tip.x - spot.x, drop.tip.y - fallen - spot.y, drop.tip.z - spot.z)
      if (passed(previous, time, F.fall + F.forkDrop + F.forkFall)) {
        toWorld(anchor, fork.position, point)
        puffWorld(point, F.dust, 0.25, 0.9, 0.4)
      }
    }

    function spill(show: ScarecrowShow, previous: number, time: number): void {
      const anchor = anchorOf(view)
      if (torso) socketWorld(torso, point)
      else toWorld(anchor, spot.set(0, 1.6, 0), point)
      toLocal(anchor, point.x, point.y, point.z, core)
      const impact = F.fall + F.fallSeconds
      if (passed(previous, time, 0)) {
        for (let i = 0; i < F.strawBurst; i++) shoot(show.debris, 3.2, 4.5)
        for (let i = 0; i < 4; i++) {
          effects?.puff(point.x + scatter(0.4), point.y + scatter(0.4), point.z + scatter(0.4), F.straw, 0.35, 1.2, 0.5)
        }
      }
      const bursts = Math.min(BOSS_DEFEAT.maxBursts, ticks(previous, time, F.recoil, impact, F.strawGap))
      for (let i = 0; i < bursts; i++) {
        shoot(show.debris, 1.8, 3)
        shoot(show.debris, 1.8, 3)
        effects?.puff(point.x + scatter(0.3), point.y + scatter(0.3), point.z + scatter(0.3), F.straw, 0.2, 0.7, 0.4)
      }
      if (passed(previous, time, impact)) {
        for (let i = 0; i < F.strawLand; i++) shoot(show.debris, 2.4, 2.2)
        effects?.burst(point.x, point.z, F.dust, 1.4)
      }
      const wisps = Math.min(BOSS_DEFEAT.maxBursts, ticks(previous, time, impact, F.sinkStart, F.wispGap))
      for (let i = 0; i < wisps; i++) {
        effects?.puff(point.x + scatter(0.5), point.y + 0.2 + Math.random() * 0.5, point.z + scatter(0.5), F.straw, 0.15, 0.6, 0.7)
      }
      const dust = Math.min(BOSS_DEFEAT.maxBursts, ticks(previous, time, F.sinkStart, F.seconds, 0.2))
      for (let i = 0; i < dust; i++) {
        effects?.puff(point.x + scatter(1), 0.15, point.z + scatter(1), F.dust, 0.3, 1.1, 0.6)
      }
    }

    return {
      starHeight,
      defeatSeconds: F.seconds,
      defeat(time) {
        if (!show) show = begin()
        const previous = show.previous
        show.previous = time
        const c = scarecrowCollapse(time, show.lean, F, collapse)
        const heel = c.lean >= 0 ? F.heel : -F.heel
        root.rotation.set(0, 0, c.lean)
        root.position.set(heel * (1 - Math.cos(c.lean)), -heel * Math.sin(c.lean) + c.drop - c.sink, 0)
        for (const leg of legs) {
          rotateFromRest(leg.upper, Z_AXIS, c.hip)
          if (leg.lower) rotateFromRest(leg.lower, Z_AXIS, c.knee)
        }
        for (const arm of arms) {
          orient(arm.upper, arm.side * c.armOut, 0, c.armUp)
          if (arm.lower) orient(arm.lower, -arm.side * c.armOut * 0.3, 0, 0.25 * c.armUp)
        }
        if (head) orient(head, c.roll, 0, c.head)
        blendFrom(show.saved, smooth(span(time, 0, BOSS_DEFEAT.blendIn)))
        if (eye) shine([eye], c.eye)
        flyHat(show, previous, time)
        dropFork(show, previous, time)
        spill(show, previous, time)
        show.debris.update(Math.max(0, time - previous))
        show.fade(c.fade)
        show.debris.fade(c.fade)
      },
      sync(state, clock, rawDt) {
        const dt = Math.min(MAX_STEP, rawDt)
        track(shift)
        const speed = rawDt > 0 ? Math.hypot(shift.dx, shift.dz) / rawDt : 0
        scarecrowPose(def, state, tuning.weapons, target)
        for (const key of POSE_KEYS) pose[key] = approach(pose[key], target[key], P.ease, dt)
        strike = Math.max(0, strike - dt / P.strikeSeconds)
        kick = approach(kick, 0, P.kickDecay, dt)
        hop = approach(hop, 0, P.hatDecay, dt)
        const stunned = state.phase === 'stunned'
        const moving = speed > P.moving && !stunned
        stepGait(gait, dt, moving, strideRate(speed, P.walkRate, P.minRate, P.maxRate), P.strideEase)
        for (const leg of legs) {
          const [hip, knee] = legBend(gait, leg.side, P.legSwing, P.knee)
          rotateFromRest(leg.upper, Z_AXIS, hip)
          if (leg.lower) rotateFromRest(leg.lower, Z_AXIS, knee)
        }
        const step = Math.sin(gait.phase) * gait.stride
        const slam = smooth(strike)
        const tremble = pose.raise > 0.9 ? Math.sin(clock * P.trembleRate) * P.tremble : 0

        for (const arm of arms) {
          const swing = -step * P.armSwing * arm.side
          const abduct = pose.spread * P.spread + pose.raise * P.raiseSpread
          const forward =
            -pose.back * P.armBack + pose.raise * P.armRaise + slam * P.armStrike + pose.slump * P.slumpArm + swing + tremble
          orient(arm.upper, arm.side * abduct, 0, forward)
          if (arm.lower) {
            const bend = -pose.back * P.elbowBack + pose.raise * P.elbowRaise + slam * P.elbowStrike
            orient(arm.lower, -arm.side * pose.spread * P.elbowSpread, 0, bend)
          }
        }

        const lean =
          (pose.lean >= 0 ? pose.lean * P.lean : pose.lean * P.leanBack) + pose.slump * P.slumpLean + slam * P.slamLean - kick * P.kickLean
        const wobble = Math.sin(clock * P.wobbleRate) * P.wobble * pose.slump
        root.rotation.set(step * P.sway + wobble, 0, -lean)
        root.position.y = Math.abs(Math.sin(gait.phase)) * gait.stride * P.bob

        if (head) orient(head, 0, 0, -pose.slump * P.slumpHead + pose.raise * P.raiseHead)
        if (hat) {
          const tilt = hop * P.hatTilt
          const sideTilt = Math.sin(tiltAngle) * tilt + stunSide * pose.slump * P.hatStun + wobble * 1.5
          const backTilt = Math.cos(tiltAngle) * tilt + pose.back * P.hatWind
          orient(hat, sideTilt, 0, backTilt)
          hat.position.y = hatRest + hop * P.hatHop
        }
        if (eye) {
          shine([eye], stunned ? P.eyeStunned : 1 + telegraphProgress(def, state, tuning.weapons) * P.eyeTelegraph)
        }
        if (!stunned) stunSide = Math.sign(Math.sin(clock * 0.37)) || 1
      },
      handle(event) {
        if (show) return
        switch (event.type) {
          case 'enemyHit':
            if (!near(view, event.x, event.y, def.radius * 0.6)) break
            if (hop < 0.3) tiltAngle = Math.random() * TAU
            hop = Math.min(1, hop + P.hitHop)
            break
          case 'enemyShot':
            if (event.weapon !== def.fan?.weapon || !near(view, event.x, event.y, def.radius + 0.6)) break
            kick = 1
            puffAt(muzzle, P.straw, 0.25, 0.9, 0.3)
            break
          case 'blast':
            if (event.source !== 'boss' || !near(view, event.x, event.y, def.radius)) break
            strike = 1
            pose.raise = Math.min(pose.raise, 0.35)
            hop = 1
            tiltAngle = Math.random() * TAU
            break
          default:
            break
        }
      },
    }
  }

  function mountMorningStar(view: BossBody, model: ModelInstance): Star | null {
    const socket = model.nodes.get('socket_star')
    const builtIn = model.nodes.get('star') ?? null
    if (socket && models.has('shard-morning')) {
      const S = MORNING_STAR
      const shard = models.instance('shard-morning')
      view.owned.push(shard)
      if (builtIn) builtIn.visible = false
      const holder = new THREE.Group()
      holder.position.x = S.forward
      socket.add(holder)
      const crystal = shard.nodes.get('crystal') ?? null
      shard.root.scale.setScalar(S.scale)
      shard.root.position.y = -(crystal?.position.y ?? 0) * S.scale
      if (crystal) orient(crystal, 0, 0, S.tilt)
      holder.add(shard.root)
      const lights = [...shard.glow.values()].map(lightOf)
      let angle = 0
      return {
        node: holder,
        materials: shard.materials,
        sync(dt, clock, glow) {
          angle = (angle + dt * S.spin) % TAU
          shard.root.rotation.y = angle
          holder.scale.setScalar(1 + S.pulse * Math.sin(clock * S.pulseRate))
          shine(lights, glow)
        },
      }
    }
    if (!builtIn) return null
    const lights = [lightOf(model.glow.get('mat_glow')), lightOf(model.glow.get('mat_glow_core'))]
    const rest = builtIn.scale.clone()
    return {
      node: builtIn,
      materials: [],
      sync(_dt, clock, glow) {
        builtIn.scale.copy(rest).multiplyScalar(1 + MORNING_STAR.pulse * Math.sin(clock * MORNING_STAR.pulseRate))
        shine(lights, glow)
      },
    }
  }

  function clearGlass(node: THREE.Object3D | undefined): void {
    node?.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = false
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        material.depthWrite = false
        material.needsUpdate = true
      }
    })
  }

  function harvesterModel(def: BossDef, view: BossBody): BossRig {
    const R = HARVESTER_RIG
    const model = models.instance('harvester')
    mount(view, model)
    const { nodes, root } = model
    const body = nodes.get('body') ?? null
    const bodyRest = body ? body.position.y : 0
    const header = nodes.get('header') ?? null
    const reel = nodes.get('reel') ?? null
    const unloader = nodes.get('unloader') ?? null
    const bale = nodes.get('socket_bale') ?? null
    const exhaust = nodes.get('socket_fx_exhaust') ?? null
    const wheels: Wheel[] = []
    for (const name of WHEELS) {
      const node = nodes.get(name)
      if (!node) continue
      restQuaternion(node)
      wheels.push({ node, radius: Math.max(0.05, node.position.y), angle: 0 })
    }
    if (body) restQuaternion(body)
    clearGlass(nodes.get('glass_cockpit'))
    const star = mountMorningStar(view, model)
    const starHeight = heightIn(root, nodes.get('socket_head'), 3)
    const shift: Shift = { dx: 0, dz: 0 }
    const track = tracker(view, R.teleport)
    let speed: number = R.reel.idle
    let reelAngle = 0
    let lift = 0
    let yaw = 0
    let aim: number | null = null
    let kick = 0
    let raise = 0
    let smoke = 0
    const D = HARVESTER_DEFEAT
    const roof = nodes.get('cockpit_roof') ?? null
    const seat = nodes.get('seat') ?? null
    const cockpit = nodes.get('cockpit') ?? null
    const roofRest = roof ? roof.position.clone() : null
    const seatRest = seat ? seat.position.clone() : null
    const roofDir = new THREE.Vector3(Math.cos(D.roofAngle), Math.sin(D.roofAngle), 0)
    const ejection = harvesterEjection(0, { pitch: 0, yaw: 0 })
    const core = new THREE.Vector3()
    let show: HarvesterShow | null = null

    function begin(): HarvesterShow {
      const anchor = anchorOf(view)
      view.body.position.set(0, 0, 0)
      view.body.rotation.set(0, 0, 0)
      view.body.scale.setScalar(1)
      const debris = createDebris()
      anchor.add(debris.mesh)
      view.owned.push(debris)
      const heading = headingOf(view, new THREE.Vector3())
      return {
        previous: 0,
        from: { pitch: lift * R.balePitch + kick * R.baleKick, yaw },
        reel: reelAngle,
        speed,
        raise,
        debris,
        fade: fader(model.materials, root),
        glow: star ? fader(star.materials, null) : null,
        heading,
        side: sideOf(heading, new THREE.Vector3()),
        roof: null,
        seat: null,
        shard: null,
      }
    }

    function fling(debris: Debris, count: number, at: THREE.Vector3, speed: number, lift: number): void {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * TAU
        const push = speed * (0.5 + Math.random() * 0.5)
        debris.emit({
          x: at.x + scatter(0.3),
          y: at.y + scatter(0.2),
          z: at.z + scatter(0.3),
          vx: Math.cos(angle) * push,
          vy: lift * (0.6 + Math.random() * 0.4),
          vz: Math.sin(angle) * push,
          color: HARVESTER_BITS[i % HARVESTER_BITS.length],
          length: 0.12 + Math.random() * 0.2,
          width: 0.05 + Math.random() * 0.05,
          life: 2.6 + Math.random() * 1.2,
        })
      }
    }

    function sparkle(count: number, flames: number): void {
      root.updateWorldMatrix(true, false)
      for (let i = 0; i < count; i++) {
        const [x, y, z] = HARVESTER_SPARKS[Math.floor(Math.random() * HARVESTER_SPARKS.length)]
        root.localToWorld(spot.set(x + scatter(0.1), y + scatter(0.1), z + scatter(0.1)))
        puffWorld(spot, BOSS_DEFEAT.spark, 0.08, 0.4, 0.2)
        if (Math.random() < flames) puffWorld(spot, D.flame, 0.2, 0.7, 0.45)
      }
    }

    function ejectRoof(show: HarvesterShow, e: Ejection, previous: number, time: number): void {
      if (!roof || !roofRest) return
      const anchor = anchorOf(view)
      if (!show.roof) {
        if (e.roof <= 0) return
        roof.position.copy(roofRest).addScaledVector(roofDir, Math.min(e.roof, D.roofClear))
        if (passed(previous, time, D.roofPop)) {
          socketWorld(roof, point)
          puffWorld(point, '#d8d2c8', 0.4, 1.4, 0.45)
          sparkle(3, 0)
          fling(show.debris, 5, toLocal(anchor, point.x, point.y, point.z, core), 2, 3)
        }
        if (e.roof < D.roofClear) return
        const dir = roofDir.clone().applyQuaternion(relativeTurn(roof.parent ?? anchor, anchor, twist))
        const start = detach(roof, anchor)
        const flat = Math.hypot(dir.x, dir.z)
        const along = flat > 1e-6 ? new THREE.Vector3(dir.x / flat, 0, dir.z / flat) : show.heading.clone()
        const rise = dir.y * D.roofSpeed
        show.roof = {
          start,
          along,
          rise,
          reach: flat * D.roofSpeed,
          axis: new THREE.Vector3().crossVectors(Y_AXIS, along).normalize(),
          land: landingTime(rise, D.roofGravity, start.position.y - D.roofRest),
          from: D.roofPop + D.roofClear / D.roofSpeed,
        }
      }
      const flight = show.roof
      const u = Math.min(Math.max(0, time - flight.from), flight.land)
      const out = dragged(flight.reach, D.roofDrag, u)
      roof.position.set(
        flight.start.position.x + flight.along.x * out,
        flight.start.position.y + flight.rise * u - 0.5 * D.roofGravity * u * u,
        flight.start.position.z + flight.along.z * out,
      )
      roof.quaternion.setFromAxisAngle(flight.axis, Math.PI * (flight.land > 0 ? u / flight.land : 1)).multiply(flight.start.quaternion)
      if (passed(previous, time, flight.from + flight.land)) {
        toWorld(anchor, roof.position, point)
        effects?.burst(point.x, point.z, BOSS_DEFEAT.dust, 0.9)
        fling(show.debris, 4, roof.position, 1.5, 2)
      }
    }

    function ejectSeat(show: HarvesterShow, e: Ejection, previous: number, time: number): void {
      if (!seat || !seatRest) return
      const anchor = anchorOf(view)
      if (passed(previous, time, D.seatFire)) {
        socketWorld(seat, point)
        puffWorld(point, D.flame, 0.4, 1.3, 0.35)
        puffWorld(point, '#d8d2c8', 0.5, 1.8, 0.8)
      }
      if (!show.seat) {
        if (e.seat <= 0) return
        seat.position.copy(seatRest)
        seat.position.y += Math.min(e.seat, D.seatClear)
        if (e.seat >= D.seatClear) {
          const start = detach(seat, anchor)
          show.seat = { start, center: new THREE.Vector3(0, D.seatCenter, 0).applyQuaternion(start.quaternion).add(start.position) }
        }
      }
      const flight = show.seat
      if (flight) {
        seat.quaternion.setFromAxisAngle(SEAT_TUMBLE, e.tumble).multiply(flight.start.quaternion)
        spot.set(0, D.seatCenter, 0).applyQuaternion(seat.quaternion)
        seat.position.copy(flight.center).addScaledVector(Y_AXIS, e.seat - D.seatClear).addScaledVector(SEAT_DRIFT, e.drift).sub(spot)
        seat.visible = e.seat < D.seatHide
      }
      const plumes = Math.min(BOSS_DEFEAT.maxBursts, ticks(previous, time, D.seatFire, D.seatFire + D.seatBurn, D.seatPlume))
      if (plumes <= 0 || !seat.visible) return
      socketWorld(seat, point)
      for (let i = 0; i < plumes; i++) {
        effects?.puff(point.x + scatter(0.08), point.y - 0.1 - i * 0.15, point.z + scatter(0.08), i % 2 ? '#d8d2c8' : D.flame, 0.18, 0.75, 0.5)
      }
    }

    function dropShard(show: HarvesterShow, previous: number, time: number, target: DefeatTarget | null): void {
      if (!star) return
      const step = Math.max(0, time - previous)
      const anchor = anchorOf(view)
      if (!show.shard && time >= D.shardPop) {
        const start = detach(star.node, anchor)
        const land = start.position.clone().addScaledVector(show.heading, D.shardForward).addScaledVector(show.side, D.shardSide)
        land.y = D.shardHover
        show.shard = { start, land, from: null, gone: false }
        toWorld(anchor, start.position, point)
        puffWorld(point, D.glow, 0.3, 1.4, 0.4)
        sparkle(2, 0)
      }
      const drop = show.shard
      if (!drop) {
        star.sync(step, time, 1 + (D.shardGlow - 1) * smooth(span(time, 0, D.shardPop)))
        return
      }
      if (drop.gone) return
      const node = star.node
      const tau = time - D.shardPop
      const k = Math.min(1, tau / D.shardFlight)
      const bob = k >= 1 ? D.shardBob * Math.sin((tau - D.shardFlight) * 3) : 0
      node.position.set(
        mix(drop.start.position.x, drop.land.x, k),
        arc(drop.start.position.y, drop.land.y, D.shardRise, k) + bob,
        mix(drop.start.position.z, drop.land.z, k),
      )
      if (passed(previous, time, D.shardPop + D.shardFlight)) {
        toWorld(anchor, drop.land, point)
        effects?.burst(point.x, point.z, D.glow, 0.5)
      }
      star.sync(step, time, 1 + (D.shardGlow - 1) * (0.75 + 0.25 * Math.sin(time * 6)))
      node.scale.multiplyScalar(mix(1, D.shardGrow, smooth(k)))
      const glints = Math.min(BOSS_DEFEAT.maxBursts, ticks(previous, time, D.shardPop + D.shardFlight, D.shardCollect + D.shardCollectSeconds, D.shardSparkle))
      for (let i = 0; i < glints; i++) puffWorld(socketWorld(node, point), D.glow, 0.2, 0.9, 0.35)
      if (!target || time < D.shardCollect) return
      if (!drop.from) drop.from = node.position.clone()
      const c = span(time, D.shardCollect, D.shardCollect + D.shardCollectSeconds)
      toLocal(anchor, target.x, D.shardCatch, target.y, spot)
      node.position.set(mix(drop.from.x, spot.x, smooth(c)), arc(drop.from.y, spot.y, D.shardArc, c), mix(drop.from.z, spot.z, smooth(c)))
      node.scale.multiplyScalar(1 - 0.6 * c)
      if (c < 1) return
      drop.gone = true
      node.visible = false
      puffWorld(toWorld(anchor, spot, point), D.glow, 0.4, 1.6, 0.4)
      effects?.burst(point.x, point.z, D.glow, 0.8)
    }

    function burn(show: HarvesterShow, previous: number, time: number): void {
      const anchor = anchorOf(view)
      if (passed(previous, time, 0)) {
        fling(show.debris, 14, core.set(0, 1.4, 0), 3.5, 5.5)
        sparkle(6, 0.5)
        puffAt(exhaust, D.smoke, 0.5, 1.8, 1.1)
        puffAt(exhaust, BOSS_DEFEAT.ember, 0.3, 0.9, 0.25)
      }
      const smokes = Math.min(BOSS_DEFEAT.maxBursts, ticks(previous, time, 0, D.fadeStart + 0.5, D.smokeGap))
      for (let i = 0; i < smokes; i++) {
        if (exhaust) {
          socketWorld(exhaust, point)
          effects?.puff(point.x + scatter(0.15), point.y + Math.random() * 0.5, point.z + scatter(0.15), D.smoke, 0.35, 1.4, 1.2)
        }
        if (cockpit && time > D.roofPop && Math.random() < 0.6) {
          socketWorld(cockpit, point)
          effects?.puff(point.x + scatter(0.3), point.y + 0.7 + Math.random() * 0.6, point.z + scatter(0.3), BOSS_DEFEAT.smoke, 0.3, 1.1, 1)
        }
      }
      const sparks = Math.min(BOSS_DEFEAT.maxBursts, ticks(previous, time, 0, D.fadeStart, D.sparkGap))
      for (let i = 0; i < sparks; i++) if (Math.random() < 1 - (0.7 * time) / D.fadeStart) sparkle(1, 0.35)
      if (passed(previous, time, D.fadeStart)) {
        root.updateWorldMatrix(true, false)
        for (let i = 0; i < 8; i++) {
          root.localToWorld(spot.set(scatter(1.2), 0.6 + Math.random() * 1.8, scatter(1)))
          puffWorld(spot, D.smoke, 0.6, 2.2, 1.3)
        }
        toWorld(anchor, core.set(0, 0, 0), point)
        effects?.burst(point.x, point.z, BOSS_DEFEAT.smoke, 2)
        fling(show.debris, 10, core.set(0, 1.2, 0), 3, 4)
      }
    }

    function exhale(state: BossState, dt: number): void {
      smoke -= dt
      if (smoke > 0) return
      if (state.phase === 'shift') {
        smoke = R.shiftGap
        puffAt(exhaust, R.smoke, 0.3, 1.1, 0.9)
      } else if (state.phase === 'stunned') {
        smoke = R.steamGap
        puffAt(exhaust, R.steam, 0.2, 0.8, 0.6)
      } else if (state.phaseIndex >= 2) {
        smoke = R.smokeGap
        puffAt(exhaust, R.smoke, 0.22, 0.85, 0.8)
      } else {
        smoke = R.smokeGap
      }
    }

    return {
      starHeight,
      defeatSeconds: D.seconds,
      defeat(time, target) {
        if (!show) show = begin()
        const previous = show.previous
        show.previous = time
        const e = harvesterEjection(time, show.from, D, ejection)
        if (reel) rotateFromRest(reel, Z_AXIS, show.reel - coastAngle(show.speed, time, D.reelStop))
        const slump = smooth(span(time, D.slumpStart, D.slumpEnd))
        const quake = 1 - span(time, 0, D.shakeEnd)
        if (body) {
          body.position.y = bodyRest - D.sink * slump + Math.sin(time * D.shakeRate) * quake * D.shake
          orient(body, D.roll * slump + Math.sin(time * D.shakeRate * 0.7) * quake * D.shakeRoll, 0, D.pitch * slump)
        }
        if (header) rotateFromRest(header, Z_AXIS, mix(show.raise, D.headerLift, slump))
        if (unloader) orient(unloader, 0, e.yaw, e.pitch)
        const fade = 1 - smooth(span(time, D.fadeStart, D.seconds))
        root.position.y = -D.fadeSink * (1 - fade)
        ejectRoof(show, e, previous, time)
        ejectSeat(show, e, previous, time)
        dropShard(show, previous, time, target)
        burn(show, previous, time)
        show.debris.update(Math.max(0, time - previous))
        show.fade(fade)
        show.glow?.(fade)
        show.debris.fade(fade)
      },
      sync(state, clock, rawDt) {
        const dt = Math.min(MAX_STEP, rawDt)
        track(shift)
        const facing = -view.pivot.rotation.y
        const travel = forwardTravel(shift.dx, shift.dz, facing)
        for (const wheel of wheels) {
          wheel.angle = (wheel.angle + wheelTurn(travel, wheel.radius)) % TAU
          rotateFromRest(wheel.node, Z_AXIS, wheel.angle)
        }
        speed = approach(speed, reelSpeed(def, state, tuning.weapons), R.reelEase, dt)
        reelAngle = (reelAngle - speed * dt) % TAU
        if (reel) rotateFromRest(reel, Z_AXIS, reelAngle)
        raise = approach(raise, headerLift(def, state, tuning.weapons) * R.headerLift, R.headerEase, dt)
        if (header) rotateFromRest(header, Z_AXIS, raise)

        const up = unloaderLift(def, state)
        lift = riseThenSettle(lift, up, R.settle, dt)
        kick = approach(kick, 0, R.kickDecay, dt)
        if (up <= 0) aim = null
        const goal = aim === null ? 0 : unloaderYaw(aim, facing)
        yaw = wrapAngle(yaw + wrapAngle(goal - yaw) * (1 - Math.exp(-R.yawEase * dt)))
        if (unloader) orient(unloader, 0, yaw, lift * R.balePitch + kick * R.baleKick)

        const charging = state.phase === 'active' && (state.move === 'charge' || state.move === 'frenzy')
        if (body) {
          body.position.y = bodyRest + Math.sin(clock * R.rumbleRate) * (R.rumble + (charging ? R.chargeRumble : 0))
          orient(body, state.phase === 'stunned' ? Math.sin(clock * R.stunRate) * R.stunRoll : 0, 0, 0)
        }
        const charge = state.phase === 'shift' ? Math.abs(Math.sin(clock * MORNING_STAR.shiftRate)) : telegraphProgress(def, state, tuning.weapons)
        star?.sync(dt, clock, 1 + charge * (MORNING_STAR.glow - 1))
        exhale(state, dt)
      },
      handle(event) {
        if (show || event.type !== 'enemyShot' || event.weapon !== def.bales?.weapon) return
        if (!near(view, event.x, event.y, def.radius + 0.6)) return
        aim = event.angle
        kick = 1
        puffAt(bale, R.straw, 0.2, 0.7, 0.3)
      },
    }
  }

  return {
    build(def, view) {
      const id = bossIdOf(def)
      if (id === 'harvester' && models.has('harvester')) return harvesterModel(def, view)
      if (id === 'scarecrow' && models.has('scarecrow')) return scarecrowModel(def, view)
      if (id === 'demo-chief' && models.has('demo-chief')) return createChiefRig(def, view, { models, effects, tuning })
      if (id === 'shield-captain' && models.has('shield-captain')) return createCaptainRig(def, view, { models, effects, tuning })
      if (id === 'forest-tank' && models.has('forest-tank')) return createTankRig(def, view, { models, effects, tuning })
      return def.tier === 'chapter' ? reaper(def, view) : scarecrow(view)
    },
  }
}
