import * as THREE from 'three'
import type { BossDef } from '../data/bosses'
import type { Tuning } from '../data/tuning'
import type { BossState } from '../sim/types'
import { anchorOf, fader, heightIn, lightOf, mount, near, scatter, shine, tracker, type Fader, type Light, type Shift } from './boss-kit'
import { approach, forwardTravel, telegraphProgress, wrapAngle } from './boss-motion'
import type { BossBody, BossRig, DefeatTarget } from './boss-rigs'
import type { Effects } from './effects'
import { glowSprite, radialTexture } from './glow-textures'
import { restQuaternion, rotateFromRest, socketWorld, type ModelLibrary } from './model-library'
import { dropLauncher, shareLauncher, type MuzzleSource } from './muzzle-link'
import { mergeStill, ownMeshes } from './node-parts'
import { barrelNode, easeAngle, lidAngle, lidStep, muzzleNode, recoilAmount, retreatAt, trackOffset, trackTravel, turretAngle, type Retreat } from './tank-motion'
import { TANK_DEFEAT, TANK_RIG } from './themes'

export const TANK_NODES = [
  'body',
  'turret',
  'barrel_1',
  'barrel_2',
  'barrel_3',
  'lid_l',
  'lid_r',
  'track_l',
  'track_r',
  'eye',
  'socket_muzzle_1',
  'socket_muzzle_2',
  'socket_muzzle_3',
  'socket_mine',
  'socket_head',
] as const

export const TANK_STILL: readonly (readonly string[])[] = [
  ['body', 'emblem_l', 'emblem_r', 'eye', 'leaves_body'],
  ['turret', 'leaves_turret'],
  ['barrel_1'],
  ['barrel_2'],
  ['barrel_3'],
  ['lid_l'],
  ['lid_r'],
]

export interface TankKit {
  models: ModelLibrary
  effects: Effects | null
  tuning: Tuning
}

interface Track {
  maps: THREE.Texture[]
  offset: number
}

interface Barrel {
  node: THREE.Object3D
  rest: number
  firedAt: number
}

interface Show {
  previous: number
  from: { x: number; y: number }
  gate: { x: number; y: number } | null
  along: number
  fade: Fader
  smokeAt: number
}

const MAX_STEP = 0.1
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const Z_AXIS = new THREE.Vector3(0, 0, 1)
const point = new THREE.Vector3()
const shake = new THREE.Quaternion()

export function scrollingCopy(map: THREE.Texture): THREE.Texture {
  const { source } = map
  const version = source.version
  const copy = map.clone()
  source.version = version
  copy.wrapS = THREE.RepeatWrapping
  return copy
}

export function createTankRig(def: BossDef, view: BossBody, kit: TankKit): BossRig {
  const R = TANK_RIG
  const D = TANK_DEFEAT
  const { models, effects, tuning } = kit
  const model = models.instance('forest-tank')
  mount(view, model)
  const { nodes, root } = model
  const turret = nodes.get('turret') ?? null
  const lids = ['lid_l', 'lid_r'].map((name) => nodes.get(name) ?? null)
  const eye = nodes.get('eye') ?? null
  const mineSocket = nodes.get('socket_mine') ?? null
  if (turret) restQuaternion(turret)
  for (const lid of lids) if (lid) restQuaternion(lid)
  restQuaternion(root)
  const barrels: (Barrel | null)[] = [0, 1, 2].map((index) => {
    const node = nodes.get(barrelNode(index))
    return node ? { node, rest: node.position.x, firedAt: -Infinity } : null
  })
  const muzzles = [0, 1, 2].map((index) => nodes.get(muzzleNode(index)) ?? null)
  const tracks: Track[] = ['track_l', 'track_r'].map((name) => {
    const maps: THREE.Texture[] = []
    nodes.get(name)?.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (!(material instanceof THREE.MeshStandardMaterial) || !material.map) continue
        const map = scrollingCopy(material.map)
        material.map = map
        maps.push(map)
        view.owned.push(map)
      }
    })
    return { maps, offset: 0 }
  })
  const named = new Set(nodes.values())
  const still: THREE.Material[] = []
  for (const [space, ...parts] of TANK_STILL) {
    const node = nodes.get(space)
    if (!node) continue
    const merged = mergeStill(node, [space, ...parts].flatMap((name) => ownMeshes(nodes.get(name), named)))
    view.owned.push(...merged.owned)
    view.materials.push(...merged.materials)
    still.push(...merged.materials)
  }
  const eyeLight = lightOf(model.glow.get('mat_eye'))
  const lamps: Light[] = [lightOf(model.glow.get('mat_lamp')), lightOf(model.glow.get('mat_glow'))].filter((item): item is Light => item !== null)
  const starHeight = heightIn(root, nodes.get('socket_head'), 2.5)
  const haloTexture = radialTexture(48, 1.7, 0.08)
  view.owned.push(haloTexture)
  const halo = glowSprite(haloTexture, R.eyeHalo, R.eyeSize)
  view.owned.push(halo.material)
  if (eye) {
    halo.position.set(0.06, 0, 0)
    eye.add(halo)
  }
  halo.visible = eye !== null
  const haloColor = new THREE.Color(R.eyeHalo)
  const white = new THREE.Color('#ffffff')

  const scene = anchorOf(view).parent
  const mineWeapon = def.mines?.weapon
  const launcher: MuzzleSource = { muzzle: (out) => (mineSocket ? socketWorld(mineSocket, out) : null) }
  if (scene && mineWeapon) {
    shareLauncher(scene, mineWeapon, launcher)
    view.owned.push({ dispose: () => dropLauncher(scene, mineWeapon, launcher) })
  }

  const shift: Shift = { dx: 0, dz: 0 }
  const track = tracker(view, R.teleport)
  let hull: number | null = null
  let turretWorld: number | null = null
  let lid = 0
  let now = 0
  let flash = 0
  let jolt = 0
  let hop = 0
  let dustAt = 0
  let show: Show | null = null
  const retreat: Retreat = { x: 0, y: 0, along: 0, heading: 0, fade: 1 }

  const scroll = (travel: { left: number; right: number }) => {
    tracks[0].offset = trackOffset(tracks[0].offset, travel.left)
    tracks[1].offset = trackOffset(tracks[1].offset, travel.right)
    for (const item of tracks) for (const map of item.maps) map.offset.x = item.offset
  }

  const puffAt = (node: THREE.Object3D | null, color: string, from: number, to: number, seconds: number, rise = 0) => {
    if (!node || !effects) return
    socketWorld(node, point)
    effects.puff(point.x, point.y, point.z, color, from, to, seconds, rise)
  }

  const kickDust = (heading: number, behind: boolean) => {
    const { position } = anchorOf(view)
    const back = behind ? -1 : 1
    for (const side of [-1, 1]) {
      const x = position.x + view.body.position.x + Math.cos(heading) * back * 1.1 - Math.sin(heading) * side * R.gauge
      const z = position.z + view.body.position.z + Math.sin(heading) * back * 1.1 + Math.cos(heading) * side * R.gauge
      effects?.puff(x + scatter(0.15), 0.15 + Math.random() * 0.15, z + scatter(0.15), R.dust, 0.25, 0.85, 0.55)
    }
  }

  const syncBarrels = () => {
    for (const barrel of barrels) {
      if (!barrel) continue
      barrel.node.position.x = barrel.rest - R.recoil * recoilAmount(now - barrel.firedAt)
    }
  }

  const syncLids = (open: boolean, dt: number) => {
    lid = lidStep(lid, open, dt)
    const angle = lidAngle(lid)
    for (const node of lids) if (node) rotateFromRest(node, Z_AXIS, angle)
    return angle
  }

  const syncEye = (level: number) => {
    shine([eyeLight], level)
    halo.material.opacity = Math.min(1, R.eyeOpacity * Math.max(0, level) * (1 + flash))
    halo.material.color.copy(haloColor).lerp(white, Math.min(1, flash))
  }

  function begin(target: DefeatTarget | null): Show {
    const { position } = anchorOf(view)
    view.body.position.set(0, 0, 0)
    view.body.rotation.set(0, 0, 0)
    root.quaternion.copy(restQuaternion(root))
    hull ??= -view.pivot.rotation.y
    return {
      previous: 0,
      from: { x: position.x, y: position.z },
      gate: target?.exit ?? null,
      along: 0,
      fade: fader([...model.materials, ...still], root),
      smokeAt: 0,
    }
  }

  return {
    starHeight,
    defeatSeconds: D.seconds,
    sync(state: BossState, clock, rawDt) {
      const dt = Math.min(MAX_STEP, rawDt)
      now = clock
      track(shift)
      const facing = -view.pivot.rotation.y
      const previous = hull ?? facing
      hull = hull === null ? facing : easeAngle(hull, facing, R.hullTurn, dt)
      view.pivot.rotation.y = -hull
      const turn = wrapAngle(hull - previous)
      scroll(trackTravel(forwardTravel(shift.dx, shift.dz, hull), turn))
      const tank = state.tank
      const angle = syncLids(tank?.hatch ?? false, dt)
      const aim = tank ? tank.turret : hull
      turretWorld = turretWorld === null ? aim : easeAngle(turretWorld, aim, R.turretEase, dt)
      if (turret) rotateFromRest(turret, Y_AXIS, -turretAngle(turretWorld - hull, angle))
      syncBarrels()
      flash = approach(flash, 0, R.flashDecay, dt)
      jolt = approach(jolt, 0, R.joltDecay, dt)
      hop = approach(hop, 0, R.joltDecay, dt)
      root.quaternion.copy(restQuaternion(root)).multiply(shake.setFromAxisAngle(Z_AXIS, Math.sin(clock * 31) * jolt * R.jolt))
      root.position.y = hop * R.hop
      const stunned = state.phase === 'stunned'
      const telegraph = telegraphProgress(def, state, tuning.weapons)
      const intro = state.phase === 'intro' ? Math.min(1, 1 - state.timer / Math.max(0.01, def.introTime)) : 1
      const breath = 1 + R.eyeBreath * Math.sin(clock * R.eyeRate)
      syncEye(stunned ? R.eyeStunned : intro * (breath + telegraph * (R.eyeTelegraph - 1)))
      const speed = rawDt > 0 ? Math.hypot(shift.dx, shift.dz) / rawDt : 0
      const ramming = state.phase === 'active' && state.move === 'charge'
      if ((ramming || speed > 1.5) && clock >= dustAt) {
        dustAt = clock + R.dustGap * (ramming ? 1 : 2)
        kickDust(hull, !(tank?.reverse ?? false))
      }
      if (stunned && Math.random() < dt * 4) puffAt(turret, D.smoke, 0.2, 0.8, 0.9, 0.8)
    },
    handle(event) {
      if (show) return
      switch (event.type) {
        case 'tankShot': {
          if (!near(view, event.x, event.y, def.radius + 0.5)) break
          const barrel = barrels[event.barrel]
          if (barrel) barrel.firedAt = now
          const muzzle = muzzles[event.barrel] ?? null
          puffAt(muzzle, R.muzzleFlash, 0.25, 0.8, 0.12)
          puffAt(muzzle, R.muzzleSmoke, 0.3, 1.05, 0.5, 0.3)
          break
        }
        case 'enemyShot':
          if (event.weapon !== mineWeapon || !near(view, event.x, event.y, def.radius + 1)) break
          puffAt(mineSocket, R.muzzleSmoke, 0.2, 0.7, 0.35, 0.4)
          break
        case 'enemyHit':
          if (!near(view, event.x, event.y, def.radius + 0.4)) break
          flash = 1
          hop = Math.min(1, hop + 0.6)
          break
        case 'bossCrash':
          if (!near(view, event.x, event.y, def.radius + 1.5)) break
          jolt = 1
          break
        case 'enemyKilled':
          return event.kind === 'boss' && near(view, event.x, event.y, def.radius + 0.5)
        default:
          break
      }
    },
    defeat(time, target) {
      if (!show) show = begin(target)
      const step = Math.min(MAX_STEP, Math.max(0, time - show.previous))
      show.previous = time
      const anchor = anchorOf(view).position
      retreatAt(time, show.from, show.gate, D, retreat)
      view.body.position.set(retreat.x - anchor.x, 0, retreat.y - anchor.z)
      const before = hull ?? retreat.heading
      hull = easeAngle(before, retreat.heading, D.turn, step)
      view.pivot.rotation.y = -hull
      const moved = retreat.along - show.along
      show.along = retreat.along
      const slip = -(moved * D.slip + (time < D.open ? D.spin * step : 0))
      scroll(trackTravel(slip, wrapAngle(hull - before) * 0.5))
      lid = lidStep(lid, false, step)
      for (const node of lids) if (node) rotateFromRest(node, Z_AXIS, lidAngle(lid))
      for (const barrel of barrels) if (barrel) barrel.node.position.x = barrel.rest
      if (time >= show.smokeAt) {
        show.smokeAt = time + D.smokeGap
        puffAt(turret, D.smoke, 0.3, 1.2, 1.1, 1.2)
        if (Math.random() < 0.5) kickDust(hull, true)
      }
      const flicker = time < 1.2 ? 0.5 + 0.5 * Math.sin(time * 40) : D.lamps
      syncEye(flicker * retreat.fade)
      shine(lamps, D.lamps + (1 - D.lamps) * Math.max(0, 1 - time))
      show.fade(retreat.fade)
    },
  }
}
