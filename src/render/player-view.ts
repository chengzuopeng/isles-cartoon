import * as THREE from 'three'
import { BUFF_ORDER, type BuffId } from '../data/loot'
import type { Tuning } from '../data/tuning'
import type { PlayerWeaponId } from '../data/weapons'
import { activeWeaponId } from '../sim/arsenal'
import { lerp } from '../sim/math'
import { playerHidden } from '../sim/perception'
import type { GameEvent } from '../sim/types'
import type { World } from '../sim/world'
import type { ModelKit } from './character-models'
import type { Effects } from './effects'
import { PLAYER_FLASH_COLOR, PLAYER_RENDER_ORDER, heldFromLibrary } from './kai-model'
import { applyHold, armChain, solveHold, type HoldSolution } from './kai-pose'
import { EMPTY_LIBRARY, animateRig, hingeAxis, restQuaternion, rotateFromRest, socketWorld, type ModelLibrary } from './model-library'
import { shareMuzzle } from './muzzle-link'
import {
  addRecoil,
  advanceDrum,
  deathPose,
  ease,
  gait,
  gunDrop,
  restHeight,
  settleRecoil,
  shownWeapon,
  stepToward,
  trailScarf,
  turnDrum,
  warheadLoaded,
  type DeathPose,
  type Drum,
} from './player-motion'
import type { Stage } from './stage'
import { BUFF_COLORS, GUN_SHAPES, KAI_DEATH, WEAPON_HOLDS } from './themes'
import { BULLET_HEIGHT, flat } from './view-helpers'

export interface PlayerView {
  sync(world: World, alpha: number, dt: number, clock: number): void
  handle(event: GameEvent): void
  reset(): void
  setVisible(visible: boolean): void
}

interface Petal {
  node: THREE.Object3D
  axis: THREE.Vector3
}

interface Home {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  scale: THREE.Vector3
}

interface HeldWeapon {
  id: PlayerWeaponId
  root: THREE.Object3D
  home: Home
  bounds: THREE.Box3 | null
  muzzle: THREE.Object3D
  materials: THREE.Material[]
  tintable: THREE.MeshStandardMaterial[]
  drum: THREE.Object3D | null
  turn: Drum
  warhead: THREE.Object3D | null
  petals: Petal[]
}

interface MaterialBase {
  opacity: number
  alphaTest: number
}

interface DeathJoint {
  node: THREE.Object3D
  from: THREE.Quaternion
  target: (pose: DeathPose, out: THREE.Quaternion) => THREE.Quaternion
}

interface Drop {
  weapon: HeldWeapon
  from: THREE.Vector3
  turn: THREE.Quaternion
  rest: THREE.Quaternion
  toss: THREE.Vector3
  height: number
  landed: boolean
}

const PLAYER_BODY_Y = 0.65
const PLAYER_MARK_COLOR = '#5ff0ff'
const SHIELD_COLOR = BUFF_COLORS.shield
const HIDDEN_OPACITY = 0.45
const FLASH_GLOW = 1.2
const FALLBACK_MOUNT = [0.13, 0.72, 0] as const
const STRIDE_RATE = 14
const RIGGED_BOB = 0.03
const PLAIN_BOB = 0.07
const MAX_TWIST = Math.PI / 3
const TWIST_RATE = 10
const HOLD_RATE = 18
const RECOIL_LIMIT = 0.06
const RECOIL_RETURN = 16
const DRUM_STEP = Math.PI / 4
const DRUM_RATE = 28
const WARHEAD_LEAD = 0.3
const PETAL_ANGLE = (65 * Math.PI) / 180
const PETAL_SECONDS = 0.12
const SCARF_RATES = [8, 6, 5] as const
const SCARF_WEIGHTS = [1, 0.5, 0.35] as const
const SCARF_FLUTTER = [0.015, 0.025, 0.035] as const
const SCARF_IDLE = 0
const SCARF_RUN = 0.22
const SCARF_SIDE = 0.1
const SCARF_SWAY = 0.4
const DUST_HEIGHT = 0.08
const X_AXIS = new THREE.Vector3(1, 0, 0)
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const Z_AXIS = new THREE.Vector3(0, 0, 1)

export function createPlayerView(
  stage: Stage,
  tuning: Tuning,
  effects: Effects,
  kit: ModelKit,
  models: ModelLibrary = EMPTY_LIBRARY,
): PlayerView {
  const { scene } = stage
  const lineGeometry = new THREE.PlaneGeometry(1, 0.12)
  lineGeometry.translate(0.5, 0, 0)

  const kai = kit.buildKai(models)
  const playerGeometry = new THREE.CapsuleGeometry(0.36, 0.62, 6, 16)
  const playerRoot = new THREE.Group()
  const playerBody = new THREE.Group()
  playerBody.position.y = PLAYER_BODY_Y
  const playerFacing = new THREE.Group()
  playerFacing.position.y = -PLAYER_BODY_Y
  const playerFall = new THREE.Group()
  playerFacing.add(playerFall)
  playerFall.add(kai.root)
  const ghostMaterial = new THREE.MeshBasicMaterial({
    color: PLAYER_MARK_COLOR,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    depthFunc: THREE.GreaterDepth,
  })
  const playerGhost = new THREE.Mesh(playerGeometry, ghostMaterial)
  playerGhost.renderOrder = 10
  playerGhost.position.y = PLAYER_BODY_Y
  playerFall.add(playerGhost)
  playerBody.add(playerFacing)
  const markMaterial = new THREE.MeshBasicMaterial({ color: PLAYER_MARK_COLOR, transparent: true, opacity: 0.85, depthWrite: false })
  const playerMark = flat(new THREE.Mesh(new THREE.RingGeometry(0.44, 0.56, 40), markMaterial), 0.025)
  const playerTurret = new THREE.Group()
  const guideMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.2, depthWrite: false })
  const guide = flat(new THREE.Mesh(lineGeometry, guideMaterial), 0.03)
  guide.position.x = 0.45
  playerTurret.add(guide)
  const fallbackMount = new THREE.Group()
  fallbackMount.position.set(...FALLBACK_MOUNT)
  playerTurret.add(fallbackMount)
  const mount = kai.mount ?? fallbackMount
  playerRoot.add(playerBody, playerMark, playerTurret)
  scene.add(playerRoot)
  const bubbleMaterial = new THREE.MeshBasicMaterial({ color: SHIELD_COLOR, transparent: true, opacity: 0.25, depthWrite: false })
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.66, 24, 16), bubbleMaterial)
  bubble.position.y = PLAYER_BODY_Y
  bubble.visible = false
  const barrierMaterial = new THREE.MeshBasicMaterial({ color: '#e8fbff', transparent: true, opacity: 0.3, depthWrite: false })
  const barrierBubble = new THREE.Mesh(new THREE.SphereGeometry(0.78, 24, 16), barrierMaterial)
  barrierBubble.position.y = PLAYER_BODY_Y
  barrierBubble.visible = false
  playerRoot.add(barrierBubble)
  const auraMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, depthWrite: false })
  const aura = flat(new THREE.Mesh(new THREE.RingGeometry(0.6, 0.7, 40), auraMaterial), 0.028)
  aura.visible = false
  playerRoot.add(bubble, aura)

  const bases = new Map<THREE.Material, MaterialBase>()
  const remember = (materials: readonly THREE.Material[]) => {
    for (const material of materials) if (!bases.has(material)) bases.set(material, { opacity: material.opacity, alphaTest: material.alphaTest })
  }
  const fade = (materials: readonly THREE.Material[], factor: number) => {
    for (const material of materials) {
      const base = bases.get(material)
      if (!base) continue
      material.opacity = base.opacity * factor
      if (base.alphaTest > 0) material.alphaTest = base.alphaTest * factor
    }
  }
  remember(kai.materials)

  const arm = kai.rig ? armChain(kai.nodes) : null
  const hips = kai.nodes.get('hips') ?? null
  const torso = kai.nodes.get('torso') ?? null
  if (hips) restQuaternion(hips)
  if (torso) restQuaternion(torso)
  for (const chain of kai.scarf) for (const segment of chain) restQuaternion(segment)
  const scarfDepth = Math.max(1, ...kai.scarf.map((chain) => chain.length))
  const scarfTrail = new Array<number>(scarfDepth).fill(SCARF_IDLE)
  const scarfSway = new Array<number>(scarfDepth).fill(0)
  const hold: HoldSolution = { upper: new THREE.Quaternion(), lower: new THREE.Quaternion(), hand: new THREE.Quaternion(), reach: 0, limit: 0 }
  const grip: [number, number, number] = [...WEAPON_HOLDS.blaster.grip]
  const pole: [number, number, number] = [...WEAPON_HOLDS.blaster.elbow]
  let gripReady = false

  const boxGeometry = new THREE.BoxGeometry(0.5, 0.14, 0.14)
  const coilGeometry = new THREE.TorusGeometry(0.1, 0.028, 8, 20)
  const weapons = new Map<PlayerWeaponId, HeldWeapon>()
  const turnZ = new THREE.Quaternion()
  const turnX = new THREE.Quaternion()
  const muzzlePoint = new THREE.Vector3()
  const rollAxis = new THREE.Vector3()
  const fallTurn = new THREE.Quaternion()
  const sideTurn = new THREE.Quaternion()
  const fallPivot = new THREE.Vector3(KAI_DEATH.pivot, 0, 0)
  const dustPoint = new THREE.Vector3()
  const pivotShift = new THREE.Vector3()
  const jointTurn = new THREE.Quaternion()
  const deathJoints = kai.rig ? jointsOf(kai.nodes) : []
  let current: HeldWeapon | null = null
  let ready = false
  let deathAt: number | null = null
  let bodyLanded = false
  let drop: Drop | null = null
  let shieldFlash = 0
  let playerFlash = 0
  let recoil = 0
  let petalOpen = 0
  let twist = 0

  function boxWeapon(id: PlayerWeaponId): HeldWeapon {
    const shape = GUN_SHAPES[id]
    const root = new THREE.Group()
    const material = new THREE.MeshStandardMaterial({ color: shape.color, transparent: true, emissive: PLAYER_FLASH_COLOR, emissiveIntensity: 0 })
    const gun = new THREE.Mesh(boxGeometry, material)
    gun.scale.set(shape.length, shape.thickness, shape.thickness)
    gun.position.x = 0.25 * shape.length
    gun.castShadow = true
    root.add(gun)
    const materials: THREE.Material[] = [material]
    if (id === 'blaster') {
      const coilMaterial = new THREE.MeshBasicMaterial({ color: PLAYER_MARK_COLOR, transparent: true })
      const coil = new THREE.Mesh(coilGeometry, coilMaterial)
      coil.rotation.y = Math.PI / 2
      coil.position.x = gun.position.x + 0.08 * shape.length
      root.add(coil)
      materials.push(coilMaterial)
    }
    const muzzle = new THREE.Object3D()
    muzzle.position.x = 0.5 * shape.length
    root.add(muzzle)
    root.traverse((part) => {
      part.renderOrder = PLAYER_RENDER_ORDER
    })
    return { id, root, home: homeOf(root), bounds: null, muzzle, materials, tintable: [material], drum: null, turn: { angle: 0, target: 0 }, warhead: null, petals: [] }
  }

  function modelWeapon(id: PlayerWeaponId): HeldWeapon {
    const model = heldFromLibrary(models, id)
    const { nodes, root } = model
    const muzzle = nodes.get('socket_muzzle') ?? root
    const drum = nodes.get('drum') ?? null
    if (drum) restQuaternion(drum)
    root.updateMatrixWorld(true)
    const petals: Petal[] = []
    for (let i = 1; i <= 5; i++) {
      const node = nodes.get(`petal_${i}`)
      if (!node?.parent) continue
      const center = node.parent.worldToLocal(muzzle.getWorldPosition(new THREE.Vector3()))
      petals.push({ node, axis: hingeAxis(node, center) })
    }
    return {
      id,
      root,
      home: homeOf(root),
      bounds: null,
      muzzle,
      materials: model.materials,
      tintable: model.tintable,
      drum,
      turn: { angle: 0, target: 0 },
      warhead: nodes.get('warhead') ?? null,
      petals,
    }
  }

  function weaponFor(id: PlayerWeaponId): HeldWeapon {
    let weapon = weapons.get(id)
    if (!weapon) {
      weapon = models.has(id) ? modelWeapon(id) : boxWeapon(id)
      remember(weapon.materials)
      weapon.root.visible = false
      mount.add(weapon.root)
      weapons.set(id, weapon)
    }
    return weapon
  }

  function show(id: PlayerWeaponId): HeldWeapon {
    if (current?.id === id) return current
    if (current) current.root.visible = false
    current = weaponFor(id)
    current.root.visible = true
    return current
  }

  function pose(node: THREE.Object3D, lift: number, sway: number): void {
    node.quaternion.copy(restQuaternion(node)).multiply(turnZ.setFromAxisAngle(Z_AXIS, -lift)).multiply(turnX.setFromAxisAngle(X_AXIS, sway))
  }

  function waveScarf(trail: number, sway: number, walking: boolean, dt: number, clock: number): void {
    trailScarf(scarfTrail, trail, dt, SCARF_RATES)
    trailScarf(scarfSway, sway, dt, SCARF_RATES)
    const flutterRate = walking ? 11 : 2.4
    const flutterScale = walking ? 1 : 0.6
    kai.scarf.forEach((chain, side) => {
      chain.forEach((segment, depth) => {
        const weight = SCARF_WEIGHTS[Math.min(depth, SCARF_WEIGHTS.length - 1)]
        const flutter = Math.sin(clock * flutterRate - depth * 0.9 + side * 1.7) * SCARF_FLUTTER[Math.min(depth, SCARF_FLUTTER.length - 1)] * flutterScale
        pose(segment, scarfTrail[depth] * weight + flutter, scarfSway[depth] * weight + flutter * SCARF_SWAY)
      })
    })
  }

  function boundsOf(weapon: HeldWeapon): THREE.Box3 {
    if (weapon.bounds) return weapon.bounds
    const box = new THREE.Box3()
    const part = new THREE.Box3()
    const local = new THREE.Matrix4()
    weapon.root.updateWorldMatrix(true, true)
    const inverse = weapon.root.matrixWorld.clone().invert()
    weapon.root.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
      const bounds = mesh.geometry.boundingBox
      if (bounds) box.union(part.copy(bounds).applyMatrix4(local.multiplyMatrices(inverse, mesh.matrixWorld)))
    })
    weapon.bounds = box
    return box
  }

  function release(weapon: HeldWeapon, facing: number): void {
    playerRoot.attach(weapon.root)
    const rest = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, -(facing + KAI_DEATH.gunSpin)).multiply(turnX.setFromAxisAngle(X_AXIS, Math.PI / 2))
    const forward = KAI_DEATH.gunForward
    const side = KAI_DEATH.gunSide
    drop = {
      weapon,
      from: weapon.root.position.clone(),
      turn: weapon.root.quaternion.clone(),
      rest,
      toss: new THREE.Vector3(Math.cos(facing) * forward - Math.sin(facing) * side, 0, Math.sin(facing) * forward + Math.cos(facing) * side),
      height: restHeight(boundsOf(weapon), rest, weapon.root.scale),
      landed: false,
    }
  }

  function dropGun(elapsed: number): void {
    if (!drop) return
    const fall = gunDrop(elapsed - KAI_DEATH.gunDrop, drop.from.y, drop.height, KAI_DEATH)
    const { root } = drop.weapon
    root.position.set(drop.from.x + drop.toss.x * fall.travel, fall.height, drop.from.z + drop.toss.z * fall.travel)
    root.quaternion.slerpQuaternions(drop.turn, drop.rest, fall.turn)
    if (fall.landed && !drop.landed) {
      drop.landed = true
      root.getWorldPosition(dustPoint)
      effects.puff(dustPoint.x, DUST_HEIGHT, dustPoint.z, KAI_DEATH.dust, 0.1, 0.35, 0.3)
    }
  }

  function fallOver(pose: DeathPose): void {
    fallTurn.setFromAxisAngle(Z_AXIS, pose.pitch).multiply(sideTurn.setFromAxisAngle(X_AXIS, pose.roll))
    playerFall.quaternion.copy(fallTurn)
    playerFall.position.copy(fallPivot).sub(pivotShift.copy(fallPivot).applyQuaternion(fallTurn))
    playerFall.position.x -= pose.slide
    playerFall.position.y -= pose.sink
  }

  function die(world: World, dt: number, clock: number): void {
    const { player } = world
    if (deathAt === null) {
      deathAt = world.time
      bodyLanded = false
      for (const joint of deathJoints) joint.from.copy(joint.node.quaternion)
    }
    const elapsed = Math.max(0, world.time - deathAt)
    const pose = deathPose(elapsed, KAI_DEATH)
    guide.visible = false
    playerMark.visible = false
    bubble.visible = false
    barrierBubble.visible = false
    aura.visible = false
    playerBody.rotation.set(0, 0, 0)
    playerBody.position.y = PLAYER_BODY_Y
    playerFacing.rotation.y = -player.facing
    fallOver(pose)
    const blend = Math.min(1, elapsed / KAI_DEATH.blend)
    const weight = blend * blend * (3 - 2 * blend)
    for (const joint of deathJoints) joint.node.quaternion.slerpQuaternions(joint.from, joint.target(pose, jointTurn), weight)
    if (!drop && current && elapsed >= KAI_DEATH.gunDrop) release(current, player.facing)
    dropGun(elapsed)
    waveScarf(SCARF_IDLE, 0, false, dt, clock)
    if (pose.landed && !bodyLanded) {
      bodyLanded = true
      playerFall.updateWorldMatrix(true, false)
      playerFall.localToWorld(dustPoint.set(-0.6, 0, 0))
      effects.puff(dustPoint.x, DUST_HEIGHT, dustPoint.z, KAI_DEATH.dust, 0.25, 0.9, 0.45)
    }
  }

  function revive(): void {
    deathAt = null
    bodyLanded = false
    playerFall.position.set(0, 0, 0)
    playerFall.quaternion.identity()
    for (const joint of deathJoints) joint.node.quaternion.copy(restQuaternion(joint.node))
    guide.visible = true
    playerMark.visible = true
    if (drop) {
      const { root, home } = drop.weapon
      mount.add(root)
      root.position.copy(home.position)
      root.quaternion.copy(home.quaternion)
      root.scale.copy(home.scale)
      drop = null
    }
  }

  function holdWeapon(id: PlayerWeaponId, dt: number): void {
    if (!arm) return
    const target = WEAPON_HOLDS[id]
    const rate = gripReady ? dt : Infinity
    for (let i = 0; i < 3; i++) {
      grip[i] = ease(grip[i], target.grip[i], rate, HOLD_RATE)
      pole[i] = ease(pole[i], target.elbow[i], rate, HOLD_RATE)
    }
    gripReady = true
    applyHold(arm, solveHold(arm, grip, pole, hold))
  }

  shareMuzzle(scene, {
    muzzle(out) {
      if (!ready || !current || deathAt !== null) return null
      return socketWorld(current.muzzle, out)
    },
  })

  function shade(world: World, weapon: HeldWeapon | null, dt: number): void {
    const hidden = playerHidden(world)
    markMaterial.opacity = hidden ? 0.35 : 0.85
    playerFlash = Math.max(0, playerFlash - dt / Math.max(0.01, tuning.feel.flashSeconds * 2))
    const factor = hidden ? HIDDEN_OPACITY : 1
    fade(kai.materials, factor)
    for (const material of kai.tintable) material.emissiveIntensity = playerFlash * FLASH_GLOW
    if (!weapon) return
    fade(weapon.materials, factor)
    for (const material of weapon.tintable) material.emissiveIntensity = playerFlash * FLASH_GLOW
  }

  let bodyShown = true
  return {
    setVisible(visible) {
      bodyShown = visible
    },
    sync(world, alpha, dt, clock) {
      const { player } = world
      playerRoot.visible = bodyShown
      playerRoot.position.set(lerp(player.prev.x, player.pos.x, alpha), lerp(player.prevZ, player.z, alpha), lerp(player.prev.y, player.pos.y, alpha))
      if (!player.alive) {
        die(world, dt, clock)
        shade(world, current, dt)
        return
      }
      if (deathAt !== null) revive()
      playerTurret.rotation.y = -player.facing
      const active = activeWeaponId(player)
      guide.scale.x = tuning.weapons[active].range
      const loaded = player.slot === 'special' ? player.specialAmmo >= 1 : player.ammo >= 1
      guideMaterial.opacity = loaded ? 0.22 : 0.07
      const dx = player.pos.x - player.prev.x
      const dy = player.pos.y - player.prev.y
      const moving = Math.hypot(dx, dy) > 0.001
      const rolling = player.rollTime > 0
      const walking = moving && !rolling
      playerFacing.rotation.y = -player.facing

      const steps = gait(player.facing, dx, dy, MAX_TWIST)
      const { rig } = kai
      if (rig) {
        if (rolling) rig.stride = 0
        animateRig(rig, dt, walking, STRIDE_RATE * steps.direction, 0)
      }
      twist = ease(twist, walking ? steps.twist : 0, dt, TWIST_RATE)
      if (hips && torso) {
        rotateFromRest(hips, Y_AXIS, -twist)
        rotateFromRest(torso, Y_AXIS, twist)
      }
      const bob = rig ? Math.abs(Math.cos(rig.phase)) * RIGGED_BOB * rig.stride : walking ? Math.abs(Math.sin(clock * STRIDE_RATE)) * PLAIN_BOB : 0
      playerBody.position.y = PLAYER_BODY_Y + bob
      if (rolling) {
        playerBody.rotation.set(0, 0, 0)
        rollAxis.set(player.rollDirY, 0, -player.rollDirX).normalize()
        playerBody.rotateOnWorldAxis(rollAxis, (1 - player.rollTime / 0.25) * Math.PI * 2)
        playerBody.position.y = PLAYER_BODY_Y * 0.7
      } else {
        playerBody.rotation.set(0, 0, 0)
      }

      const ahead = walking ? Math.max(0, Math.cos(steps.relative)) : 0
      waveScarf(SCARF_IDLE + (SCARF_RUN - SCARF_IDLE) * ahead, walking ? SCARF_SIDE * Math.sin(steps.relative) : 0, walking, dt, clock)

      const weapon = show(shownWeapon(player))
      holdWeapon(weapon.id, dt)
      recoil = settleRecoil(recoil, dt, RECOIL_RETURN)
      weapon.root.position.x = -recoil
      if (weapon.drum) {
        turnDrum(weapon.turn, dt, DRUM_RATE)
        rotateFromRest(weapon.drum, X_AXIS, weapon.turn.angle)
      }
      if (weapon.warhead) weapon.warhead.visible = warheadLoaded(player, weapon.id, WARHEAD_LEAD)
      petalOpen = stepToward(petalOpen, player.ultShots > 0 ? 1 : 0, dt, PETAL_SECONDS)
      for (const petal of weapon.petals) rotateFromRest(petal.node, petal.axis, petalOpen * PETAL_ANGLE)

      barrierBubble.visible = player.barrier > 0
      barrierMaterial.opacity = 0.22 + Math.sin(clock * 7) * 0.06
      shade(world, weapon, dt)
      ready = true
      shieldFlash = Math.max(0, shieldFlash - dt * 4)
      bubble.visible = player.shield > 0
      bubbleMaterial.opacity = 0.18 + Math.sin(clock * 5) * 0.04 + shieldFlash * 0.4
      const shown = strongestBuff(player.buffs.map((buff) => buff.id))
      aura.visible = shown !== null
      if (shown) {
        const remaining = player.buffs.find((buff) => buff.id === shown)?.remaining ?? 0
        auraMaterial.color.set(BUFF_COLORS[shown])
        auraMaterial.opacity = remaining < 3 && Math.floor(clock * 6) % 2 === 0 ? 0.15 : 0.55 + Math.sin(clock * 6) * 0.15
        aura.scale.setScalar(1 + Math.sin(clock * 4) * 0.05)
      }
    },
    handle(event) {
      const { feel } = tuning
      switch (event.type) {
        case 'shot': {
          const weapon = current
          if (weapon && playerRoot.visible) {
            recoil = addRecoil(recoil, WEAPON_HOLDS[weapon.id].kick, RECOIL_LIMIT)
            playerFacing.rotation.y = -event.angle
            playerTurret.rotation.y = -event.angle
            socketWorld(weapon.muzzle, muzzlePoint)
            effects.puff(muzzlePoint.x, muzzlePoint.y, muzzlePoint.z, '#fff1a8', 0.22, 0.5, 0.07)
          } else {
            effects.puff(event.x, BULLET_HEIGHT, event.y, '#fff1a8', 0.22, 0.5, 0.07)
          }
          const fired = weapons.get(event.weapon as PlayerWeaponId)
          if (fired?.drum) advanceDrum(fired.turn, DRUM_STEP)
          stage.addTrauma(feel.shakeShot)
          break
        }
        case 'playerHit':
          if (event.damage > 0) {
            playerFlash = 1
            stage.addTrauma(feel.shakeHurt)
          }
          if (event.absorbed > 0) shieldFlash = 1
          break
        case 'skillCast':
          if (event.skill === 'concussion') effects.puff(event.x, 1.2, event.y, '#cfe9ff', 0.2, 0.6, 0.2)
          break
        case 'dodged':
          effects.puff(event.x, 0.7, event.y, '#ffffff', 0.2, 0.9, 0.2)
          break
        case 'ultimateFired':
          stage.addTrauma(0.35)
          break
        case 'shieldBroken':
          effects.burst(event.x, event.y, SHIELD_COLOR, 0.9)
          break
        case 'playerDied':
          effects.burst(event.x, event.y, '#ffb238', KAI_DEATH.burst)
          stage.addTrauma(0.9)
          break
        default:
          break
      }
    },
    reset() {
      revive()
      ready = false
      playerFlash = 0
      recoil = 0
      petalOpen = 0
      twist = 0
      gripReady = false
      scarfTrail.fill(SCARF_IDLE)
      scarfSway.fill(0)
      for (const weapon of weapons.values()) {
        weapon.turn.angle = 0
        weapon.turn.target = 0
      }
    },
  }
}

function homeOf(root: THREE.Object3D): Home {
  return { position: root.position.clone(), quaternion: root.quaternion.clone(), scale: root.scale.clone() }
}

function jointsOf(nodes: Map<string, THREE.Object3D>): DeathJoint[] {
  const turn = new THREE.Quaternion()
  const bend = (name: string, angles: (pose: DeathPose) => [number, number, number]): DeathJoint | null => {
    const node = nodes.get(name)
    if (!node) return null
    const rest = restQuaternion(node)
    return {
      node,
      from: new THREE.Quaternion(),
      target(pose, out) {
        const [x, y, z] = angles(pose)
        out.copy(rest).multiply(turn.setFromAxisAngle(Z_AXIS, z))
        out.multiply(turn.setFromAxisAngle(Y_AXIS, y))
        return out.multiply(turn.setFromAxisAngle(X_AXIS, x))
      },
    }
  }
  const joints = [
    bend('hips', () => [0, 0, 0]),
    bend('torso', (pose) => [0, 0, pose.torso]),
    bend('head', (pose) => [KAI_DEATH.headTurn * pose.landing * 0.5, KAI_DEATH.headTurn * pose.landing, pose.head]),
    bend('leg_l', (pose) => [0.12 * pose.landing, 0, pose.thigh * 0.8]),
    bend('leg_l_lower', (pose) => [0, 0, -pose.knee * 0.85]),
    bend('leg_r', (pose) => [-0.08 * pose.landing, 0, pose.thigh]),
    bend('leg_r_lower', (pose) => [0, 0, -pose.knee]),
    bend('arm_l', (pose) => [pose.arm, 0, KAI_DEATH.armLift * pose.spread]),
    bend('arm_l_lower', (pose) => [0, 0, pose.elbow]),
    bend('hand_l', () => [0, 0, 0]),
    bend('arm_r', (pose) => [-pose.arm * 0.85, 0, KAI_DEATH.armLift * pose.spread * 0.6]),
    bend('arm_r_lower', (pose) => [0, 0, KAI_DEATH.forearm * pose.spread + pose.elbow * 0.5]),
    bend('hand_r', () => [0, 0, 0]),
  ]
  return joints.filter((joint): joint is DeathJoint => joint !== null)
}

function strongestBuff(ids: BuffId[]): BuffId | null {
  for (const id of BUFF_ORDER) if (id !== 'shield' && ids.includes(id)) return id
  return null
}
