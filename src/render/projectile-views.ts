import * as THREE from 'three'
import type { WeaponId } from '../data/weapons'
import { clamp, lerp } from '../sim/math'
import type { Bullet, GameEvent, Lob } from '../sim/types'
import type { World } from '../sim/world'
import type { Effects } from './effects'
import type { ModelId } from './asset-urls'
import { hasFog } from './fog-motion'
import { socketWorld, type ModelLibrary } from './model-library'
import { launcherSource, muzzleSource } from './muzzle-link'
import {
  baleTumble,
  bladeAnchor,
  bladeFall,
  bladeLanding,
  bladeLift,
  bladeQuaternion,
  bladeSink,
  bladeSpin,
  bladeYaw,
  bombTumble,
  bulletTraveled,
  freshLob,
  grenadeRoll,
  launchAt,
  launchShift,
  lobPose,
  lobProgress,
  ROCKET_ROLL_PER_METER,
  ROCKET_TRAIL_SPACING,
  sparkFlicker,
  trackLaunch,
  type BladeTrack,
  type LaunchTrack,
  type LobPose,
} from './projectile-motion'
import { PROJECTILE_POOL_MODELS, PROJECTILE_SCALES } from './themes'

interface BulletStyle {
  color: string
  stretch: number
  scale: number
  opacity: number
  grow: number
}

interface Flash {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  age: number
  duration: number
  from: number
  to: number
}

type ProjectileModelId = keyof typeof PROJECTILE_SCALES
type LobModelId = 'grenade-shell' | 'legion-bomb' | 'chief-bomb' | 'wheat-bale' | 'mine'

interface PoolItem {
  root: THREE.Object3D
  spark: THREE.Object3D | null
  meshes: { mesh: THREE.Mesh; base: THREE.Material | THREE.Material[] }[]
}

interface FramePool {
  items: PoolItem[]
  used: number
}

interface FallingBlade {
  item: PoolItem
  yaw: number
  anchor: THREE.Vector3
  track: BladeTrack
  landedAt: number | null
  frame: number
}

interface Trail {
  emitted: number
  frame: number
}

interface Launch {
  track: LaunchTrack | null
  frame: number
}

interface LobLaunch {
  offset: THREE.Vector3 | null
  since: number
  frame: number
}

export interface ProjectileViews {
  sync(world: World, alpha: number, dt: number): void
  handle(event: GameEvent): void
  reset(): void
}

const BASE_RADIUS = 0.13
export const PLAYER_BOLT_GROW = { start: 0.3, distance: 5 }
const ENEMY_STYLE: BulletStyle = { color: '#ff4f8b', stretch: 1, scale: 1, opacity: 1, grow: 0 }
const ENEMY_STYLES: Partial<Record<WeaponId, BulletStyle>> = {
  chiefCannon: { color: '#ff8a3d', stretch: 1.55, scale: 1.15, opacity: 1, grow: 0 },
  tankShell: { color: '#ffa13d', stretch: 1.45, scale: 1.1, opacity: 1, grow: 0 },
}
const DEFAULT_STYLE: BulletStyle = { color: '#ffe38a', stretch: 2.4, scale: 1, opacity: 1, grow: 0 }
const STYLES: Partial<Record<WeaponId, BulletStyle>> = {
  shotgun: { color: '#ffd27a', stretch: 1.6, scale: 1, opacity: 1, grow: 0 },
  sniper: { color: '#fff6c9', stretch: 5, scale: 1, opacity: 1, grow: 0 },
  ricochet: { color: '#6dffc8', stretch: 2, scale: 1, opacity: 1, grow: 0 },
  flamer: { color: '#ff8a3d', stretch: 1, scale: 1, opacity: 0.7, grow: 1.4 },
  frost: { color: '#9fe4ff', stretch: 1.6, scale: 1.1, opacity: 1, grow: 0 },
  rocket: { color: '#d9d2b8', stretch: 2.8, scale: 1.1, opacity: 1, grow: 0 },
  arc: { color: '#fff36d', stretch: 3, scale: 1, opacity: 1, grow: 0 },
  starVolley: { color: '#5ff0ff', stretch: 3.4, scale: 1.3, opacity: 1, grow: 0 },
}
const CHAIN_SEGMENTS = 6
const CHAIN_JITTER = 0.22
const LOB_MODELS: Partial<Record<WeaponId, LobModelId>> = {
  grenade: 'grenade-shell',
  bomb: 'legion-bomb',
  chiefBomb: 'chief-bomb',
  baleToss: 'wheat-bale',
  tankMine: 'mine',
}
const LOB_LAUNCH: Partial<Record<WeaponId, number>> = { grenade: 0.75, bomb: 1.12, chiefBomb: 1.6, baleToss: 3.45, tankMine: 1.4 }
const DEFAULT_LAUNCH = 0.5
const BALL_RADIUS = 0.2
const ROCKET_TAIL = new THREE.Vector3(-0.17, 0, 0)
const BLADE_TIP = new THREE.Vector3(0.524, 0.263, 0)
const BLADE_SINK_DEPTH = 1.1
const SPARK_SIZE = 0.035
const SPARK_COLOR = '#ffd36b'
const FLAME_COLOR = '#ffb04a'
const SMOKE_COLOR = '#d6d0c2'

export function createProjectileViews(scene: THREE.Scene, models: ModelLibrary, effects: Effects): ProjectileViews {
  const sphere = new THREE.SphereGeometry(BASE_RADIUS, 10, 8)
  const materials = new Map<string, THREE.MeshBasicMaterial>()
  let foggy = false
  let foggyLevel: World['level'] | null = null
  const material = (color: string, opacity: number) => {
    const key = `${color}:${opacity}`
    let item = materials.get(key)
    if (!item) {
      item = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1 || foggy, opacity, depthWrite: opacity >= 1 })
      materials.set(key, item)
    }
    return item
  }
  const overFog = new Map<THREE.Material, THREE.Material>()
  const fogCopy = (source: THREE.Material) => {
    let copy = overFog.get(source)
    if (!copy) {
      copy = source.clone()
      copy.transparent = true
      overFog.set(source, copy)
    }
    return copy
  }
  const spawned: PoolItem[] = []
  const dress = (item: PoolItem) => {
    for (const { mesh, base } of item.meshes) {
      mesh.material = foggy ? (Array.isArray(base) ? base.map(fogCopy) : fogCopy(base)) : base
    }
  }
  const layerFor = (world: World) => {
    if (world.level === foggyLevel) return
    foggyLevel = world.level
    const was = foggy
    foggy = hasFog(world.level)
    for (const item of [...materials.values(), lobMaterial]) {
      const transparent = item.opacity < 1 || foggy
      if (item.transparent === transparent) continue
      item.transparent = transparent
      item.needsUpdate = true
    }
    if (foggy !== was) for (const item of spawned) dress(item)
  }
  const bullets: THREE.Mesh[] = []
  const lobGeometry = new THREE.SphereGeometry(BALL_RADIUS, 12, 10)
  const lobMaterial = new THREE.MeshStandardMaterial({ color: '#3f5a36', emissive: '#7dff6a', emissiveIntensity: 0.25 })
  const balls: THREE.Mesh[] = []
  const markerGeometry = new THREE.RingGeometry(0.9, 1, 40)
  const markerFill = new THREE.CircleGeometry(1, 40)
  const markers: { ring: THREE.Mesh; fill: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial> }[] = []
  const playerMarker = new THREE.MeshBasicMaterial({ color: '#5ff0ff', transparent: true, opacity: 0.45, depthWrite: false })
  const enemyMarker = new THREE.MeshBasicMaterial({ color: '#ff3b30', transparent: true, opacity: 0.5, depthWrite: false })
  const flashes: Flash[] = []
  const ringGeometry = new THREE.RingGeometry(0.85, 1, 48)
  const chainMaterial = new THREE.LineBasicMaterial({ color: '#fff9b0', transparent: true, opacity: 1 })
  const chains: { line: THREE.Line; age: number }[] = []
  const pools = new Map<ProjectileModelId, FramePool>()
  const anchors = new Map<ProjectileModelId, THREE.Vector3>()
  const rests = new Map<LobModelId, number>()
  const tails = new Map<LobModelId, number>()
  const sparkGeometry = new THREE.OctahedronGeometry(SPARK_SIZE, 0)
  const sparkMaterial = new THREE.MeshBasicMaterial({ color: SPARK_COLOR })
  const spareBlades: PoolItem[] = []
  const blades = new Map<number, FallingBlade>()
  const trails = new Map<number, Trail>()
  const launches = new Map<number, Launch>()
  const lobLaunches = new Map<number, LobLaunch>()
  const muzzle = new THREE.Vector3()
  const place = new THREE.Vector3()
  const shift = new THREE.Vector3()
  const bladeTurn = new THREE.Quaternion()
  let frame = 0

  function flat<T extends THREE.Object3D>(object: T, height: number): T {
    object.rotation.x = -Math.PI / 2
    object.position.y = height
    return object
  }

  function localPoint(root: THREE.Object3D, node: THREE.Object3D | undefined, fallback: THREE.Vector3): THREE.Vector3 {
    if (!node) return fallback.clone()
    return root.worldToLocal(socketWorld(node, new THREE.Vector3()))
  }

  function modelOf(id: ProjectileModelId): ModelId {
    return PROJECTILE_POOL_MODELS[id] ?? (id as ModelId)
  }

  function spawn(id: ProjectileModelId): PoolItem {
    const { root, nodes } = models.shared(modelOf(id))
    if (id === 'rocket-shell' && !anchors.has(id)) anchors.set(id, localPoint(root, nodes.get('socket_fx_trail'), ROCKET_TAIL))
    if (id === 'falling-blade' && !anchors.has(id)) anchors.set(id, localPoint(root, nodes.get('socket_tip'), BLADE_TIP))
    root.scale.setScalar(PROJECTILE_SCALES[id])
    root.rotation.order = id === 'wheat-bale' ? 'YXZ' : 'YZX'
    root.visible = false
    let spark: THREE.Object3D | null = null
    const socket = modelOf(id) === 'legion-bomb' ? nodes.get('socket_fx_spark') : undefined
    if (socket) {
      spark = new THREE.Mesh(sparkGeometry, sparkMaterial)
      spark.position.x = SPARK_SIZE * 0.6
      socket.add(spark)
    }
    const meshes: PoolItem['meshes'] = []
    root.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (mesh.isMesh) meshes.push({ mesh, base: mesh.material })
    })
    const item: PoolItem = { root, spark, meshes }
    spawned.push(item)
    dress(item)
    scene.add(root)
    return item
  }

  function next(id: ProjectileModelId): PoolItem {
    let pool = pools.get(id)
    if (!pool) {
      pool = { items: [], used: 0 }
      pools.set(id, pool)
    }
    let item = pool.items[pool.used]
    if (!item) {
      item = spawn(id)
      pool.items.push(item)
    }
    pool.used += 1
    item.root.visible = true
    return item
  }

  function beginPools(): void {
    for (const pool of pools.values()) pool.used = 0
  }

  function endPools(): void {
    for (const pool of pools.values()) {
      for (let i = pool.used; i < pool.items.length; i++) pool.items[i].root.visible = false
    }
  }

  function restOf(id: LobModelId): number {
    let rest = rests.get(id)
    if (rest === undefined) {
      rest = Math.max(0, -models.bounds(modelOf(id)).min.y)
      rests.set(id, rest)
    }
    return rest
  }

  function launchOf(bullet: Bullet, alpha: number, lead: number): Launch | null {
    if (bullet.team !== 'player') return null
    let launch = launches.get(bullet.id)
    if (!launch) {
      const source = muzzleSource(scene)
      const track = source?.muzzle(muzzle) ? trackLaunch(muzzle, bullet, bulletHeight(bullet, alpha), alpha, lead) : null
      launch = { track, frame }
      launches.set(bullet.id, launch)
    }
    launch.frame = frame
    return launch
  }

  function bulletPoint(bullet: Bullet, alpha: number, lead: number, out: THREE.Vector3): THREE.Vector3 {
    const launch = launchOf(bullet, alpha, lead)
    if (launch?.track) {
      if (launchAt(launch.track, bullet, alpha, bulletHeight(bullet, alpha), out)) return out
      launch.track = null
    }
    return out.set(lerp(bullet.prev.x, bullet.pos.x, alpha), bulletHeight(bullet, alpha), lerp(bullet.prev.y, bullet.pos.y, alpha))
  }

  function bulletHeight(bullet: Bullet, alpha: number): number {
    return lerp(bullet.prevZ, bullet.z, alpha)
  }

  function placeRocket(bullet: Bullet, alpha: number): void {
    const { root } = next('rocket-shell')
    const traveled = bulletTraveled(bullet.traveled, bullet.prev, bullet.pos, alpha)
    root.position.copy(bulletPoint(bullet, alpha, rocketTail(), place))
    root.rotation.set(traveled * ROCKET_ROLL_PER_METER, -Math.atan2(bullet.dirY, bullet.dirX), 0)
    emitTrail(bullet, launches.get(bullet.id)?.track ?? null)
  }

  function rocketTail(): number {
    return -(anchors.get('rocket-shell') ?? ROCKET_TAIL).x * PROJECTILE_SCALES['rocket-shell']
  }

  function emitTrail(bullet: Bullet, launch: LaunchTrack | null): void {
    let trail = trails.get(bullet.id)
    if (!trail) {
      trail = { emitted: 0, frame }
      trails.set(bullet.id, trail)
    }
    trail.frame = frame
    const due = Math.floor(bullet.traveled / ROCKET_TRAIL_SPACING)
    const tail = rocketTail()
    for (let k = trail.emitted + 1; k <= due; k++) {
      const back = bullet.traveled - k * ROCKET_TRAIL_SPACING + tail
      if (launch) launchShift(launch, (k * ROCKET_TRAIL_SPACING) / bullet.speed, shift)
      else shift.set(0, 0, 0)
      const x = bullet.pos.x - bullet.dirX * back + shift.x
      const height = bullet.z - (bullet.vz / Math.max(bullet.speed, 0.001)) * back + shift.y
      const y = bullet.pos.y - bullet.dirY * back + shift.z
      if (k % 2 === 0) effects.puff(x, height, y, FLAME_COLOR, 0.14, 0.3, 0.16)
      else effects.puff(x, height, y, SMOKE_COLOR, 0.18, 0.5, 0.45)
    }
    trail.emitted = Math.max(trail.emitted, due)
  }

  function syncBullets(world: World, alpha: number): void {
    const rocketModel = models.has('rocket-shell')
    let spheres = 0
    for (const bullet of world.bullets) {
      if (rocketModel && bullet.team === 'player' && bullet.weapon === 'rocket') {
        placeRocket(bullet, alpha)
        continue
      }
      let mesh = bullets[spheres]
      if (!mesh) {
        mesh = new THREE.Mesh(sphere, material(DEFAULT_STYLE.color, 1))
        scene.add(mesh)
        bullets.push(mesh)
      }
      spheres += 1
      const style = bullet.team === 'enemy' ? (ENEMY_STYLES[bullet.weapon] ?? ENEMY_STYLE) : (STYLES[bullet.weapon] ?? DEFAULT_STYLE)
      const progress = bullet.range > 0 ? clamp(bullet.traveled / bullet.range, 0, 1) : 0
      const near = bullet.team === 'player' ? PLAYER_BOLT_GROW.start + (1 - PLAYER_BOLT_GROW.start) * clamp(bullet.traveled / PLAYER_BOLT_GROW.distance, 0, 1) : 1
      const size = (bullet.radius / BASE_RADIUS) * style.scale * (1 + style.grow * progress) * near
      mesh.material = material(style.color, style.grow > 0 ? Math.max(0.15, style.opacity * (1 - progress)) : style.opacity)
      mesh.scale.set(size * style.stretch, size, size)
      mesh.visible = true
      mesh.position.copy(bulletPoint(bullet, alpha, bullet.radius * style.scale * style.stretch * near, place))
      mesh.rotation.y = -Math.atan2(bullet.dirY, bullet.dirX)
    }
    for (let i = spheres; i < bullets.length; i++) bullets[i].visible = false
    for (const [id, trail] of trails) if (trail.frame !== frame) trails.delete(id)
    for (const [id, launch] of launches) if (launch.frame !== frame) launches.delete(id)
  }

  function orientLob(id: LobModelId, item: PoolItem, lob: Lob, pose: LobPose, t: number, now: number): void {
    const time = t * lob.total
    const { root } = item
    if (id === 'grenade-shell') {
      root.rotation.set(grenadeRoll(time), -pose.heading, pose.pitch)
      return
    }
    if (id === 'mine') {
      root.rotation.set(Math.sin(time * 9 + lob.id) * 0.35, time * 7 + lob.id, Math.cos(time * 7 + lob.id) * 0.25)
      return
    }
    if (modelOf(id) === 'legion-bomb') {
      const tumble = bombTumble(t, lob.to.x - lob.from.x, now, lob.id)
      root.rotation.set(0, tumble.yaw, tumble.roll)
      item.spark?.scale.setScalar(sparkFlicker(now, lob.id))
      return
    }
    const tumble = baleTumble(lob.to.x - lob.from.x, lob.to.y - lob.from.y, time)
    root.rotation.set(tumble.roll, tumble.yaw, 0)
  }

  function marker(index: number, lob: Lob, t: number): void {
    let item = markers[index]
    if (!item) {
      const ring = flat(new THREE.Mesh(markerGeometry, playerMarker), 0.05)
      const fill = flat(new THREE.Mesh(markerFill, new THREE.MeshBasicMaterial({ color: '#5ff0ff', transparent: true, opacity: 0.2, depthWrite: false })), 0.045)
      scene.add(ring, fill)
      item = { ring, fill }
      markers.push(item)
    }
    item.ring.visible = true
    item.ring.material = lob.team === 'enemy' ? enemyMarker : playerMarker
    item.ring.position.set(lob.to.x, lob.toZ + 0.05, lob.to.y)
    item.ring.scale.setScalar(lob.radius)
    item.fill.visible = true
    item.fill.material.color.set(lob.team === 'enemy' ? '#ff3b30' : '#5ff0ff')
    item.fill.position.set(lob.to.x, lob.toZ + 0.045, lob.to.y)
    item.fill.scale.setScalar(Math.max(0.05, lob.radius * t))
  }

  function lobLaunch(lob: Lob, t: number, at: THREE.Vector3, lead: number): LobLaunch | null {
    const source = lob.team === 'player' ? muzzleSource(scene) : launcherSource(scene, lob.weapon)
    if (lob.team !== 'player' && !source) return null
    let launch = lobLaunches.get(lob.id)
    if (!launch) {
      let offset: THREE.Vector3 | null = null
      if (freshLob(t, lob.total) && t < 1 && source?.muzzle(muzzle)) {
        const dx = lob.to.x - lob.from.x
        const dy = lob.to.y - lob.from.y
        const length = Math.hypot(dx, dy)
        const ahead = length > 1e-6 ? lead / length : 0
        offset = new THREE.Vector3(muzzle.x + dx * ahead, muzzle.y, muzzle.z + dy * ahead).sub(at)
      }
      launch = { offset, since: t, frame }
      lobLaunches.set(lob.id, launch)
    }
    launch.frame = frame
    return launch
  }

  function placeLob(object: THREE.Object3D, lob: Lob, t: number, height: number, lead: number): void {
    object.position.set(lerp(lob.from.x, lob.to.x, t), height, lerp(lob.from.y, lob.to.y, t))
    const launch = lobLaunch(lob, t, object.position, lead)
    if (launch?.offset) object.position.addScaledVector(launch.offset, clamp((1 - t) / (1 - launch.since), 0, 1))
  }

  function lobTail(id: LobModelId): number {
    let tail = tails.get(id)
    if (tail === undefined) {
      tail = Math.max(0, -models.bounds(modelOf(id)).min.x) * PROJECTILE_SCALES[id]
      tails.set(id, tail)
    }
    return tail
  }

  function syncLobs(world: World, alpha: number): void {
    let used = 0
    world.lobs.forEach((lob, index) => {
      const t = lobProgress(lob, alpha)
      marker(index, lob, t)
      const launch = LOB_LAUNCH[lob.weapon] ?? DEFAULT_LAUNCH
      const id = LOB_MODELS[lob.weapon]
      if (id && models.has(modelOf(id))) {
        const item = next(id)
        const pose = lobPose(lob, t, launch, restOf(id) * PROJECTILE_SCALES[id])
        placeLob(item.root, lob, t, pose.height, lobTail(id))
        orientLob(id, item, lob, pose, t, world.time)
        return
      }
      let ball = balls[used]
      if (!ball) {
        ball = new THREE.Mesh(lobGeometry, lobMaterial)
        ball.castShadow = true
        scene.add(ball)
        balls.push(ball)
      }
      used += 1
      ball.visible = true
      placeLob(ball, lob, t, lobPose(lob, t, launch, BALL_RADIUS).height, BALL_RADIUS)
    })
    for (let i = used; i < balls.length; i++) balls[i].visible = false
    for (const [id, launch] of lobLaunches) if (launch.frame !== frame) lobLaunches.delete(id)
    for (let i = world.lobs.length; i < markers.length; i++) {
      markers[i].ring.visible = false
      markers[i].fill.visible = false
    }
  }

  function takeBlade(): PoolItem {
    const item = spareBlades.pop() ?? spawn('falling-blade')
    item.root.visible = false
    return item
  }

  function dropBlade(id: number, blade: FallingBlade): void {
    blade.item.root.visible = false
    spareBlades.push(blade.item)
    blades.delete(id)
  }

  function clearBlades(): void {
    for (const [id, blade] of blades) dropBlade(id, blade)
  }

  function poseBlade(blade: FallingBlade, spin: number, lift: number): void {
    const { root } = blade.item
    bladeQuaternion(blade.yaw, spin, root.quaternion)
    root.position.set(blade.anchor.x, blade.anchor.y + lift, blade.anchor.z)
    root.visible = true
  }

  function syncBlades(world: World): void {
    if (!models.has('falling-blade')) return
    const now = world.time
    const scale = PROJECTILE_SCALES['falling-blade']
    for (const blast of world.blasts) {
      if (blast.attack?.cause !== 'fallingBlade') continue
      const amount = blast.total > 0 ? clamp(1 - blast.delay / blast.total, 0, 1) : 1
      let blade = blades.get(blast.id)
      if (!blade) {
        const item = takeBlade()
        const yaw = bladeYaw(blast.id)
        const tip = anchors.get('falling-blade') ?? BLADE_TIP
        const anchor = bladeAnchor(tip, scale, bladeQuaternion(yaw, 0, bladeTurn), blast.x, blast.y)
        blade = { item, yaw, anchor, track: { amount, delay: blast.delay, seenAt: now }, landedAt: null, frame }
        blades.set(blast.id, blade)
      }
      blade.frame = frame
      blade.track.amount = amount
      blade.track.delay = blast.delay
      blade.track.seenAt = now
      const fall = bladeFall(amount)
      if (fall === null) blade.item.root.visible = false
      else poseBlade(blade, bladeSpin(fall), bladeLift(fall))
    }
    for (const [id, blade] of blades) {
      if (blade.frame === frame) continue
      blade.landedAt ??= bladeLanding(blade.track, now)
      const sink = blade.landedAt === null ? null : bladeSink(now, blade.landedAt)
      if (sink === null) dropBlade(id, blade)
      else poseBlade(blade, 0, -sink * BLADE_SINK_DEPTH * scale)
    }
  }

  function ring(x: number, y: number, color: string, from: number, to: number, duration: number): void {
    const mesh = flat(new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false })), 0.08)
    mesh.position.x = x
    mesh.position.z = y
    mesh.scale.setScalar(from)
    scene.add(mesh)
    flashes.push({ mesh, age: 0, duration, from, to })
  }

  function chain(fromX: number, fromY: number, toX: number, toY: number): void {
    const points: THREE.Vector3[] = []
    for (let i = 0; i <= CHAIN_SEGMENTS; i++) {
      const t = i / CHAIN_SEGMENTS
      const edge = i === 0 || i === CHAIN_SEGMENTS
      const jitterX = edge ? 0 : (Math.random() - 0.5) * CHAIN_JITTER * 2
      const jitterY = edge ? 0 : (Math.random() - 0.5) * CHAIN_JITTER * 2
      points.push(new THREE.Vector3(lerp(fromX, toX, t) + jitterX, 0.8 + (edge ? 0 : Math.random() * 0.3), lerp(fromY, toY, t) + jitterY))
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), chainMaterial.clone())
    scene.add(line)
    chains.push({ line, age: 0 })
  }

  function updateFlashes(dt: number): void {
    for (let i = flashes.length - 1; i >= 0; i--) {
      const flash = flashes[i]
      flash.age += dt
      const t = Math.min(1, flash.age / flash.duration)
      flash.mesh.scale.setScalar(flash.from + (flash.to - flash.from) * (1 - (1 - t) ** 3))
      flash.mesh.material.opacity = 0.85 * (1 - t)
      if (t < 1) continue
      scene.remove(flash.mesh)
      flash.mesh.material.dispose()
      flashes.splice(i, 1)
    }
    for (let i = chains.length - 1; i >= 0; i--) {
      const item = chains[i]
      item.age += dt
      const lineMaterial = item.line.material
      if (lineMaterial instanceof THREE.LineBasicMaterial) lineMaterial.opacity = Math.max(0, 1 - item.age / 0.18)
      if (item.age < 0.18) continue
      scene.remove(item.line)
      item.line.geometry.dispose()
      if (lineMaterial instanceof THREE.Material) lineMaterial.dispose()
      chains.splice(i, 1)
    }
  }

  return {
    sync(world, alpha, dt) {
      frame += 1
      layerFor(world)
      beginPools()
      syncBullets(world, alpha)
      syncLobs(world, alpha)
      endPools()
      syncBlades(world)
      updateFlashes(dt)
    },
    handle(event) {
      switch (event.type) {
        case 'shockwave':
          ring(event.x, event.y, '#bfe9ff', 0.4, event.radius, 0.35)
          break
        case 'barrierBroken':
          ring(event.x, event.y, '#e8fbff', 0.5, Math.max(1.2, event.radius), 0.3)
          break
        case 'ultimateFired':
          ring(event.x, event.y, '#5ff0ff', 0.3, 2.2, 0.3)
          break
        case 'chain':
          chain(event.fromX, event.fromY, event.toX, event.toY)
          break
        case 'bossDefeated':
          clearBlades()
          break
        default:
          break
      }
    },
    reset() {
      for (const pool of pools.values()) {
        for (const item of pool.items) item.root.visible = false
        pool.used = 0
      }
      clearBlades()
      trails.clear()
      launches.clear()
      lobLaunches.clear()
      for (const flash of flashes) {
        scene.remove(flash.mesh)
        flash.mesh.material.dispose()
      }
      flashes.length = 0
      for (const item of chains) {
        scene.remove(item.line)
        item.line.geometry.dispose()
      }
      chains.length = 0
    },
  }
}
