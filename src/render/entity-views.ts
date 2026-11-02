import * as THREE from 'three'
import { getBoss, type BossDef } from '../data/bosses'
import type { Tuning } from '../data/tuning'
import type { WeaponId } from '../data/weapons'
import { tripleLanes } from '../sim/boss'
import { fogHides } from '../sim/fog'
import { Tile, blocksMovement, cellFloor, cellTop, floorAt, tileAt, type Grid } from '../sim/grid'
import { trackShare } from '../sim/enemies/tactics'
import { clamp, lerp } from '../sim/math'
import { sightOf } from '../sim/perception'
import { disabled } from '../sim/status'
import type { Blast, Enemy, EnemyKind, GameEvent, MinionKind } from '../sim/types'
import type { World } from '../sim/world'
import { createBlobShadows } from './blob-shadows'
import { defeatTime } from './boss-motion'
import { createBossRigs, type BossRig, type DefeatTarget } from './boss-rigs'
import { laneLength } from './chief-motion'
import { createModelKit } from './character-models'
import type { Effects } from './effects'
import { bomberLampCycles, enemyPose, lampLit, modelScale, progress, type EnemyPose } from './enemy-poses'
import { ENEMY_JOINTS, createEnemyRig, type EnemyRig } from './enemy-rigs'
import { hasFog, veilStep } from './fog-motion'
import { glowSprite, radialTexture } from './glow-textures'
import { createMineViews } from './mine-views'
import { EMPTY_LIBRARY, socketWorld, type ModelLibrary } from './model-library'
import { createPlayerView } from './player-view'
import { createSheepViews } from './sheep-views'
import type { Stage } from './stage'
import { BUFF_COLORS, CHEST_COLORS, CLUE_GLOW, ELITE_CROWN, FOG_LAYER, FOG_VEIL, HEAL_COLOR } from './themes'
import { BULLET_HEIGHT, GEAR_COLOR, flat, part, standard, type Disposable } from './view-helpers'
import { BODY_HEIGHTS, CHEST_HEIGHT, eyeHeightOf, muzzleHeightOf } from '../data/heights'
import { bossExposed } from '../sim/boss'
import { crumbling } from '../sim/melee'
import { cloneInked, toonMaterial } from './toon'
import { EYE_FACE_LOOK, eyeFaceOf, eyeFaceTexture, type EyeFace } from './eye-faces'

export type ViewFlags = {
  showSight: boolean
}

interface EnemyView {
  kind: EnemyKind
  root: THREE.Group
  body: THREE.Group
  pivot: THREE.Group
  ground: THREE.Group
  materials: THREE.MeshStandardMaterial[]
  telegraph: THREE.Object3D | null
  fill: THREE.Object3D | null
  lane: THREE.Object3D | null
  laneFill: THREE.Object3D | null
  fan: THREE.Mesh | null
  spark: THREE.Object3D | null
  lift: THREE.Object3D | null
  lamps: THREE.Mesh[]
  danger: THREE.Mesh | null
  lineMaterial: THREE.MeshBasicMaterial | null
  sight: THREE.Mesh | null
  ice: THREE.Mesh | null
  stars: THREE.Group | null
  model: EnemyRig | null
  pose: EnemyPose
  posed: number
  crown: THREE.Object3D | null
  boss: BossRig | null
  anchor: THREE.Object3D | null
  smoke: number
  owned: Disposable[]
  flash: number
  seen: boolean
  fallen: number | null
  veil: Veil
  fit: number
  marks: THREE.MeshStandardMaterial[] | null
  eyes: { material: THREE.MeshStandardMaterial; color: THREE.Color; intensity: number }[] | null
  crumbleSmoke: number
  beam: THREE.Mesh | null
  eliteRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> | null
  triple: TripleLanes | null
  cone: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null
  lamp: THREE.Group | null
  face: { sprite: THREE.Sprite; current: EyeFace; sorryUntil: number } | null
}

interface Veil {
  amount: number
  layered: boolean
  meshes: THREE.Mesh[]
  groups: THREE.Object3D[]
  owned: Map<THREE.Material, { opacity: number; transparent: boolean }>
  eye: THREE.Sprite | null
  halo: THREE.Sprite | null
  eyeNode: THREE.Object3D | null
}

interface TripleLanes {
  group: THREE.Group
  lanes: { lane: THREE.Group; area: THREE.Object3D; fill: THREE.Object3D }[]
}

export const ENTITY_CULL = { distance: 72 } as const

export interface EntityViews {
  sync(world: World, alpha: number, dt: number): void
  handle(event: GameEvent): void
  reset(): void
  setPlayerVisible(visible: boolean): void
}

const COLORS: Record<EnemyKind, string> = {
  grunt: '#d0453c',
  gunner: '#6b54d6',
  bomber: '#2b2f38',
  turret: '#6f7a86',
  shield: '#4f6a8a',
  thrower: '#6b7a3a',
  boss: '#9c5a2b',
}
const KILL_COLORS: Record<EnemyKind, string> = {
  grunt: '#ff7a4a',
  gunner: '#a98bff',
  bomber: '#ffb238',
  turret: '#cfd6de',
  shield: '#9fc2e6',
  thrower: '#c8d67a',
  boss: '#ffcf5a',
}
const MUZZLE_KINDS: Partial<Record<WeaponId, MinionKind>> = { rifle: 'gunner', cannon: 'turret', bomb: 'thrower' }
const RIGGED_SHOTS: Partial<Record<WeaponId, string>> = { chiefBomb: 'demo-chief', chiefCannon: 'demo-chief' }
const SHIELD_BLOCK_REACH = 1.5
const CANNON_LANE_MARGIN = 0.3
const STAR_HEIGHT = 1.35
const MOUNTED_SPARK = 0.6
const ELITE_COLOR = '#ffd34d'
const TELEGRAPH_COLOR = '#ff3b30'
const MARKER_COLOR = '#ff6a3d'
const BURN_COLOR = new THREE.Color('#ff7a1a')
const CHILL_COLOR = new THREE.Color('#5fc8ff')
const FLASH_COLOR = new THREE.Color('#ffffff')
const ARMING_COLOR = new THREE.Color(TELEGRAPH_COLOR)

const fitBox = new THREE.Box3()
const EXPOSED_COLOR = new THREE.Color('#ffd34d')
const BEAM_COLOR = new THREE.Color('#ff2a1a')
const BEAM_UP = new THREE.Vector3(0, 1, 0)
const beamDirection = new THREE.Vector3()
const CURTAIN_HEIGHT = 1

export const CRASH_MARK = {
  step: 0.25,
  pad: 0.18,
  radius: 0.85,
  pulse: 7,
  color: '#ffd34d',
} as const

export function curtainPath(points: readonly (readonly [number, number])[], closed: boolean): THREE.BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  let along = 0
  const count = closed ? points.length : points.length - 1
  for (let i = 0; i < count; i++) {
    const [x1, z1] = points[i]
    const [x2, z2] = points[(i + 1) % points.length]
    const length = Math.hypot(x2 - x1, z2 - z1)
    positions.push(x1, 0, z1, x2, 0, z2, x2, 1, z2, x1, 0, z1, x2, 1, z2, x1, 1, z1)
    uvs.push(along, 0, along + length, 0, along + length, 1, along, 0, along + length, 1, along, 1)
    along += length
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.computeBoundingSphere()
  return geometry
}

export function sectorOutline(radius: number, arcDeg: number, segments = 24): [number, number][] {
  const half = THREE.MathUtils.degToRad(arcDeg) / 2
  const points: [number, number][] = [[0, 0]]
  for (let i = 0; i <= segments; i++) {
    const angle = -half + (i / segments) * half * 2
    points.push([Math.cos(angle) * radius, -Math.sin(angle) * radius])
  }
  return points
}

export function circleOutline(radius: number, segments = 40): [number, number][] {
  return Array.from({ length: segments }, (_, i) => {
    const angle = (i / segments) * Math.PI * 2
    return [Math.cos(angle) * radius, Math.sin(angle) * radius] as [number, number]
  })
}

export function crashTarget(grid: Grid, x: number, y: number, dirX: number, dirY: number, distance: number, radius: number): { column: number; row: number; tile: Tile } | null {
  const length = Math.hypot(dirX, dirY)
  if (length < 1e-6) return null
  const fx = dirX / length
  const fy = dirY / length
  const sideX = -fy
  const sideY = fx
  for (let travelled = CRASH_MARK.step; travelled <= distance + radius; travelled += CRASH_MARK.step) {
    for (const offset of [0, radius - CRASH_MARK.pad, -(radius - CRASH_MARK.pad)]) {
      const px = x + fx * travelled + sideX * offset
      const py = y + fy * travelled + sideY * offset
      const column = Math.floor(px)
      const row = Math.floor(py)
      if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) return null
      const tile = tileAt(grid, column, row)
      if (blocksMovement(tile)) return { column, row, tile }
    }
  }
  return null
}
function curtainGradient(): THREE.DataTexture {
  const size = 32
  const data = new Uint8Array(size * 4)
  for (let i = 0; i < size; i++) {
    const t = i / (size - 1)
    data[i * 4] = 255
    data[i * 4 + 1] = 255
    data[i * 4 + 2] = 255
    data[i * 4 + 3] = Math.round(255 * Math.pow(1 - t, 1.6) * 0.75)
  }
  const texture = new THREE.DataTexture(data, 1, size, THREE.RGBAFormat)
  texture.needsUpdate = true
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  return texture
}
const beamGeometry = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0)

export const EYE_FACE_SIZES: Readonly<Partial<Record<EnemyKind, number>>> = {
  grunt: 0.34,
  gunner: 0.28,
  bomber: 0.26,
  turret: 0.32,
  shield: 0.28,
  thrower: 0.28,
}

const faceAt = new THREE.Vector3()

export const GRASS_LAMP = {
  kinds: ['grunt', 'bomber'] as readonly EnemyKind[],
  mast: 0.5,
  radius: 0.075,
  color: '#ff5a3c',
  calm: 1.6,
  angry: 9,
} as const

export const EYE_CONE = {
  length: 5.5,
  spreadDeg: 17,
  tiltDeg: -7,
  idle: 0.1,
  noticing: 0.4,
  color: '#fff1b8',
} as const

function coneGradient(): THREE.DataTexture {
  const size = 32
  const data = new Uint8Array(size * 4)
  for (let i = 0; i < size; i++) {
    const t = i / (size - 1)
    data[i * 4] = 255
    data[i * 4 + 1] = 255
    data[i * 4 + 2] = 255
    data[i * 4 + 3] = Math.round(255 * Math.pow(t, 1.4))
  }
  const texture = new THREE.DataTexture(data, 1, size, THREE.RGBAFormat)
  texture.needsUpdate = true
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  return texture
}

function coneGeometry(): THREE.BufferGeometry {
  const radius = Math.tan(THREE.MathUtils.degToRad(EYE_CONE.spreadDeg))
  const geometry = new THREE.ConeGeometry(radius, 1, 18, 1, true)
  geometry.translate(0, -0.5, 0)
  geometry.rotateZ(Math.PI / 2)
  geometry.rotateZ(THREE.MathUtils.degToRad(EYE_CONE.tiltDeg))
  return geometry
}
const CRUMBLE_EYE = new THREE.Color('#ff2a1a')

function materialMeshes(root: THREE.Object3D, name: string): THREE.Mesh[] {
  const found: THREE.Mesh[] = []
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (mesh.isMesh && !Array.isArray(mesh.material) && mesh.material?.name === name) found.push(mesh)
  })
  return found
}

function ownMaterials(meshes: THREE.Mesh[]): { material: THREE.MeshStandardMaterial; color: THREE.Color; intensity: number }[] {
  const owned: { material: THREE.MeshStandardMaterial; color: THREE.Color; intensity: number }[] = []
  for (const mesh of meshes) {
    const source = mesh.material
    if (Array.isArray(source) || !(source instanceof THREE.MeshStandardMaterial)) continue
    const material = cloneInked(source)
    mesh.material = material
    owned.push({ material, color: material.emissive.clone(), intensity: material.emissiveIntensity })
  }
  return owned
}

function sizeFit(enemy: Enemy, view: { pivot: THREE.Object3D }): number {
  const key = enemy.kind === 'boss' ? (enemy.boss?.id ?? 'scarecrow') : enemy.kind
  const target = BODY_HEIGHTS[key]
  if (!target) return 1
  view.pivot.scale.setScalar(1)
  view.pivot.updateWorldMatrix(true, true)
  fitBox.setFromObject(view.pivot)
  const height = fitBox.max.y - fitBox.min.y
  if (!Number.isFinite(height) || height < 0.2) return 1
  return target / height
}

export function createEntityViews(
  stage: Stage,
  tuning: Tuning,
  effects: Effects,
  flags: ViewFlags,
  models: ModelLibrary = EMPTY_LIBRARY,
): EntityViews {
  const { scene } = stage
  const gearMaterial = new THREE.MeshStandardMaterial({ color: GEAR_COLOR })
  const areaMaterial = new THREE.MeshBasicMaterial({ color: TELEGRAPH_COLOR, transparent: true, opacity: 0.28, depthWrite: false })
  const fillMaterial = new THREE.MeshBasicMaterial({ color: TELEGRAPH_COLOR, transparent: true, opacity: 0.6, depthWrite: false })
  const sightMaterial = new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0.35, depthWrite: false })
  const curtainGeometry = new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0)
  const curtainMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(TELEGRAPH_COLOR).multiplyScalar(1.3), map: curtainGradient(), transparent: true, depthWrite: false, side: THREE.DoubleSide })
  const lineGeometry = new THREE.PlaneGeometry(1, 0.12)
  lineGeometry.translate(0.5, 0, 0)
  const laneGeometry = new THREE.PlaneGeometry(1, 1)
  laneGeometry.translate(0.5, 0, 0)
  const kit = createModelKit()
  const fanCurtains = new Map<string, THREE.BufferGeometry>()
  const ringCurtain = curtainPath(circleOutline(1), true)
  const crashGeometry = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true).translate(0, 0.5, 0)
  const crashMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(CRASH_MARK.color).multiplyScalar(1.4), map: curtainGradient(), transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
  const crashMark = new THREE.Mesh(crashGeometry, crashMaterial)
  crashMark.visible = false
  crashMark.userData.noInk = true
  crashMark.renderOrder = 2
  scene.add(crashMark)
  const sectorCurtain = (radius: number, arcDeg: number): THREE.Mesh => {
    const key = `${radius.toFixed(2)}:${arcDeg.toFixed(1)}`
    let geometry = fanCurtains.get(key)
    if (!geometry) {
      geometry = curtainPath(sectorOutline(radius, arcDeg), true)
      fanCurtains.set(key, geometry)
    }
    const curtain = new THREE.Mesh(geometry, curtainMaterial)
    curtain.scale.y = CURTAIN_HEIGHT
    curtain.userData.noInk = true
    curtain.renderOrder = 2
    return curtain
  }
  const lampMast = new THREE.CylinderGeometry(0.018, 0.024, GRASS_LAMP.mast, 6).translate(0, GRASS_LAMP.mast / 2, 0)
  const lampBulb = new THREE.SphereGeometry(GRASS_LAMP.radius, 12, 8)
  const lampMastMaterial = toonMaterial({ color: '#3a3330' })
  const lampGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(GRASS_LAMP.color).multiplyScalar(2.2) })
  const eyeCone = coneGeometry()
  const eyeConeMaterial = new THREE.MeshBasicMaterial({ color: EYE_CONE.color, map: coneGradient(), transparent: true, opacity: EYE_CONE.idle, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
  const geometries = {
    fuse: new THREE.CylinderGeometry(0.04, 0.04, 0.22, 6),
    spark: new THREE.SphereGeometry(0.09, 8, 6),
    crown: new THREE.ConeGeometry(0.22, 0.3, 5),
    eliteRing: new THREE.RingGeometry(0.62, 0.75, 40),
  }
  const eliteMaterial = new THREE.MeshStandardMaterial({ color: ELITE_COLOR, emissive: ELITE_COLOR, emissiveIntensity: 0.5 })
  const eliteRingMaterial = new THREE.MeshBasicMaterial({ color: ELITE_COLOR, transparent: true, opacity: 0.7, depthWrite: false })
  const bossRigs = createBossRigs(kit, models, effects, tuning)
  const shapedBlasts = new Map<number, { group: THREE.Group; fill: THREE.Mesh; owned: Disposable[]; ring: boolean }>()
  const iceGeometry = new THREE.BoxGeometry(1, 1, 1)
  const iceMaterial = new THREE.MeshStandardMaterial({ color: '#bfeaff', transparent: true, opacity: 0.55, roughness: 0.1, depthWrite: false })
  const starGeometry = new THREE.SphereGeometry(0.07, 8, 6)
  const starMaterial = new THREE.MeshBasicMaterial({ color: '#ffe066' })
  const markerGeometry = new THREE.RingGeometry(0.3, 0.48, 32)
  const ringGeometry = new THREE.RingGeometry(0.93, 1, 48)
  const discGeometry = new THREE.CircleGeometry(1, 48)

  const player = createPlayerView(stage, tuning, effects, kit, models)
  const blobs = createBlobShadows(scene)
  const sheep = createSheepViews(scene, models, effects)
  const mines = createMineViews(scene, models, effects)
  let eyeTexture: THREE.Texture | null = null
  let haloTexture: THREE.Texture | null = null
  let foggy = false
  let foggyLevel: World['level'] | null = null
  const eyeAt = new THREE.Vector3()
  const dangerMaterial = new THREE.MeshBasicMaterial({ color: TELEGRAPH_COLOR, transparent: true, opacity: 0.32, depthWrite: false })

  const enemyViews = new Map<number, EnemyView>()
  const defeatTarget: DefeatTarget = { x: 0, y: 0 }
  const markerMeshes: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[] = []
  const blastMeshes: { ring: THREE.Mesh; fill: THREE.Mesh; wall: THREE.Mesh }[] = []
  let clock = 0

  function shell(kind: EnemyKind): EnemyView {
    const root = new THREE.Group()
    const body = new THREE.Group()
    const pivot = new THREE.Group()
    const ground = new THREE.Group()
    body.add(pivot)
    root.add(body, ground)
    scene.add(root)
    return {
      kind,
      root,
      body,
      pivot,
      ground,
      materials: [],
      telegraph: null,
      fill: null,
      lane: null,
      laneFill: null,
      fan: null,
      spark: null,
      lift: null,
      lamps: [],
      danger: null,
      lineMaterial: null,
      sight: null,
      ice: null,
      stars: null,
      model: null,
      pose: enemyPose(kind),
      posed: 0,
      crown: null,
      boss: null,
      anchor: null,
      smoke: 0,
      owned: [],
      flash: 0,
      seen: true,
      fallen: null,
      veil: { amount: 0, layered: false, meshes: [], groups: [], owned: new Map(), eye: null, halo: null, eyeNode: null },
      fit: 0,
      marks: null,
      eyes: null,
      crumbleSmoke: 0,
      beam: null,
      eliteRing: null,
      triple: null,
      cone: null,
      lamp: null,
      face: null,
    }
  }

  function sectorTelegraph(view: EnemyView, radius: number, arcDeg: number): void {
    const halfArc = THREE.MathUtils.degToRad(arcDeg) / 2
    const geometry = new THREE.CircleGeometry(radius, 28, -halfArc, halfArc * 2)
    view.owned.push(geometry)
    const group = new THREE.Group()
    const fill = flat(new THREE.Mesh(geometry, fillMaterial), 0.045)
    group.add(flat(new THREE.Mesh(geometry, areaMaterial), 0.035), fill, sectorCurtain(radius, arcDeg))
    group.visible = false
    view.ground.add(group)
    view.telegraph = group
    view.fill = fill
  }

  function addCurtains(lane: THREE.Group, length: number, width: number): THREE.Mesh[] {
    const curtains: THREE.Mesh[] = []
    for (const side of [-1, 1]) {
      const curtain = new THREE.Mesh(curtainGeometry, curtainMaterial)
      curtain.position.z = (side * width) / 2
      curtain.scale.set(length, CURTAIN_HEIGHT, 1)
      curtain.userData.noInk = true
      curtain.renderOrder = 2
      curtain.name = 'curtain'
      lane.add(curtain)
      curtains.push(curtain)
    }
    return curtains
  }

  function stretchCurtains(lane: THREE.Object3D, length: number): void {
    for (const child of lane.children) if (child.name === 'curtain') child.scale.x = Math.max(0.01, length)
  }

  function laneTelegraph(view: EnemyView, length: number, width: number): void {
    const lane = new THREE.Group()
    const area = flat(new THREE.Mesh(laneGeometry, areaMaterial), 0.036)
    const fill = flat(new THREE.Mesh(laneGeometry, fillMaterial), 0.046)
    area.scale.set(length, width, 1)
    fill.scale.set(0.01, width, 1)
    addCurtains(lane, length, width)
    lane.add(area, fill)
    lane.visible = false
    view.ground.add(lane)
    view.lane = lane
    view.laneFill = fill
  }

  function lineTelegraph(view: EnemyView, length: number, angles: number[]): void {
    const material = new THREE.MeshBasicMaterial({ color: TELEGRAPH_COLOR, transparent: true, opacity: 0.2, depthWrite: false })
    view.owned.push(material)
    view.lineMaterial = material
    const group = new THREE.Group()
    for (const angle of angles) {
      const line = flat(new THREE.Mesh(lineGeometry, material), 0.04)
      line.scale.x = length
      line.rotation.z = angle
      group.add(line)
    }
    group.visible = false
    view.ground.add(group)
    view.telegraph = group
  }

  function buildEnemy(enemy: Enemy): EnemyView {
    const view = shell(enemy.kind)
    const material = standard(COLORS[enemy.kind], view.owned)
    const kind = enemy.kind
    const model = kind !== 'boss' && models.has(kind) ? models.instance(kind, ENEMY_JOINTS[kind]) : null
    if (model && kind !== 'boss') {
      ;(kind === 'turret' ? view.body : view.pivot).add(model.root)
      view.materials.push(...model.tintable)
      view.owned.push(model)
      view.model = createEnemyRig(kind, view.pose, { model, models, effects })
      view.anchor = view.model.anchor
    } else {
      view.materials.push(material)
      if (enemy.kind !== 'boss') {
        const parts = kit.buildRobot(enemy.kind, material, view.body, view.pivot)
        view.lift = parts.lift
        view.lamps = parts.lamps
      }
    }
    switch (enemy.kind) {
      case 'grunt': {
        const claw = tuning.weapons.claw
        const rush = tuning.weapons.rush
        sectorTelegraph(view, tuning.grunt.radius + tuning.player.radius + claw.radius, claw.arcDeg)
        laneTelegraph(view, rush.range + tuning.grunt.radius, (tuning.grunt.radius + rush.radius) * 2)
        break
      }
      case 'gunner': {
        lineTelegraph(view, tuning.weapons.rifle.range, [0])
        if (view.telegraph) view.telegraph.visible = false
        const beam = new THREE.Mesh(beamGeometry, new THREE.MeshBasicMaterial({ color: BEAM_COLOR.clone(), transparent: true, opacity: 0.4, depthWrite: false }))
        beam.userData.noInk = true
        beam.visible = false
        view.owned.push(beam.material as THREE.Material)
        scene.add(beam)
        view.beam = beam
        break
      }
      case 'bomber': {
        const mount = view.model?.socket('socket_fx_spark') ?? null
        if (!mount) view.body.add(part(geometries.fuse, gearMaterial, 0, 0.86, 0))
        const sparkMaterial = new THREE.MeshBasicMaterial({ color: '#fff3a0' })
        view.owned.push(sparkMaterial)
        const spark = part(geometries.spark, sparkMaterial, 0, mount ? 0 : 1.0, 0)
        spark.castShadow = !mount
        ;(mount ?? view.body).add(spark)
        view.spark = spark
        const danger = flat(new THREE.Mesh(ringGeometry, dangerMaterial), 0.03)
        danger.visible = false
        const wall = new THREE.Mesh(ringCurtain, curtainMaterial)
        wall.rotation.x = Math.PI / 2
        wall.name = 'curtain'
        wall.userData.noInk = true
        wall.renderOrder = 2
        danger.add(wall)
        view.root.add(danger)
        view.danger = danger
        break
      }
      case 'turret': {
        const cannon = tuning.weapons.cannon
        const shots = Math.max(1, Math.round(cannon.pellets))
        const spread = THREE.MathUtils.degToRad(cannon.spreadDeg)
        const angles = Array.from({ length: shots }, (_, i) => (shots === 1 ? 0 : spread / 2 - (spread * i) / (shots - 1)))
        lineTelegraph(view, cannon.range, angles)
        break
      }
      case 'shield': {
        const bash = tuning.weapons.bash
        sectorTelegraph(view, tuning.shield.radius + tuning.player.radius + bash.radius, bash.arcDeg)
        break
      }
      case 'boss':
        buildBoss(view, material, enemy)
        break
    }
    if (kind !== 'boss') view.root.scale.setScalar(modelScale(enemy))
    if (enemy.elite) {
      const ringMaterial = eliteRingMaterial.clone()
      view.owned.push(ringMaterial)
      view.eliteRing = flat(new THREE.Mesh(geometries.eliteRing, ringMaterial), 0.03)
      view.root.add(view.eliteRing)
      view.crown = view.anchor && models.has('elite-crown') ? wearCrown(view.anchor) : null
      if (!view.crown) {
        const crown = part(geometries.crown, eliteMaterial, 0, view.anchor ? 0.15 : 1.45, 0)
        crown.castShadow = false
        ;(view.anchor ?? view.body).add(crown)
      }
    }
    if (kind !== 'boss') {
      const material = eyeConeMaterial.clone()
      view.owned.push(material)
      const cone = new THREE.Mesh(eyeCone, material)
      cone.position.y = eyeHeightOf(kind)
      cone.scale.setScalar(EYE_CONE.length)
      cone.userData.noInk = true
      cone.renderOrder = 3
      view.ground.add(cone)
      view.cone = cone
      const faceSize = EYE_FACE_SIZES[kind]
      if (faceSize && view.model?.socket('eye')) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: eyeFaceTexture('calm'), transparent: true, depthWrite: false }))
        sprite.scale.setScalar(faceSize)
        sprite.renderOrder = 3
        sprite.userData.noInk = true
        view.owned.push(sprite.material)
        view.root.add(sprite)
        view.face = { sprite, current: 'calm', sorryUntil: -Infinity }
      }
      if (GRASS_LAMP.kinds.includes(kind)) {
        const lamp = new THREE.Group()
        const mast = new THREE.Mesh(lampMast, lampMastMaterial)
        const bulb = new THREE.Mesh(lampBulb, lampGlow)
        bulb.position.y = GRASS_LAMP.mast
        bulb.name = 'bulb'
        lamp.add(mast, bulb)
        lamp.position.y = (BODY_HEIGHTS[kind] ?? 1) - 0.05
        lamp.visible = false
        view.root.add(lamp)
        view.lamp = lamp
      }
      view.root.traverse((object) => {
        object.castShadow = false
      })
      collectVeil(view, model ? model.materials : view.materials)
    }
    return view
  }

  function collectVeil(view: EnemyView, materials: readonly THREE.Material[]): void {
    const veil = view.veil
    const mine = new Set<unknown>([...materials, ...view.owned])
    view.body.traverse((object) => {
      if ((object as THREE.Group).isGroup) veil.groups.push(object)
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (!mine.has(material) || veil.owned.has(material)) continue
        veil.owned.set(material, { opacity: material.opacity, transparent: material.transparent })
      }
    })
    veil.eyeNode = view.model?.socket('eye') ?? view.model?.socket('socket_fx_spark') ?? null
    veil.amount = -1
  }

  function syncVeil(world: World, enemy: Enemy, view: EnemyView, dt: number): void {
    const veil = view.veil
    const hidden = foggy && fogHides(world, enemy.pos.x, enemy.pos.y)
    const amount = veil.amount < 0 ? (hidden ? 1 : 0) : veilStep(veil.amount, hidden, dt, FOG_VEIL.seconds)
    const was = veil.amount
    veil.amount = amount
    if (amount === 0 && was === 0) return
    const layered = amount > 0
    if (layered !== veil.layered) {
      veil.layered = layered
      for (const group of veil.groups) group.renderOrder = layered ? FOG_LAYER.under : 0
      for (const [material, base] of veil.owned) {
        const transparent = layered || base.transparent
        if (material.transparent !== transparent) {
          material.transparent = transparent
          material.needsUpdate = true
        }
        material.opacity = base.opacity
      }
    }
    const shown = 1 - amount
    if (layered) for (const [material, base] of veil.owned) material.opacity = base.opacity * shown
    view.body.visible = amount < 1
    if (view.crown) view.crown.visible = amount < FOG_VEIL.hideAt
    if (view.eliteRing) {
      view.eliteRing.visible = amount < 1
      view.eliteRing.material.opacity = 0.7 * shown
    }
    if (amount >= FOG_VEIL.hideAt) {
      if (view.stars) view.stars.visible = false
      if (view.ice) view.ice.visible = false
    }
    syncEye(view, enemy, amount)
  }

  function syncEye(view: EnemyView, enemy: Enemy, amount: number): void {
    const veil = view.veil
    if (amount <= 0) {
      if (veil.eye) veil.eye.visible = false
      if (veil.halo) veil.halo.visible = false
      return
    }
    if (!veil.eye || !veil.halo) {
      eyeTexture ??= radialTexture(32, 1.2, 0.45)
      haloTexture ??= radialTexture(48, 2.4, 0)
      veil.eye = glowSprite(eyeTexture, FOG_VEIL.eye, FOG_VEIL.eyeSize)
      veil.eye.material.blending = THREE.NormalBlending
      veil.eye.renderOrder = 2
      veil.halo = glowSprite(haloTexture, FOG_VEIL.halo, FOG_VEIL.haloSize)
      veil.halo.material.blending = THREE.NormalBlending
      veil.halo.renderOrder = 1
      view.owned.push(veil.eye.material, veil.halo.material)
      view.root.add(veil.halo, veil.eye)
    }
    const { eye, halo } = veil
    eye.visible = true
    halo.visible = true
    if (veil.eyeNode) view.root.worldToLocal(socketWorld(veil.eyeNode, eyeAt))
    else eyeAt.set(Math.cos(enemy.facing) * FOG_VEIL.fallbackForward, FOG_VEIL.fallbackHeight, Math.sin(enemy.facing) * FOG_VEIL.fallbackForward)
    eye.position.copy(eyeAt)
    halo.position.copy(eyeAt)
    const flicker = 1 + FOG_VEIL.flicker * Math.sin(clock * FOG_VEIL.flickerRate + enemy.id * 1.7)
    eye.material.opacity = Math.min(1, FOG_VEIL.eyeOpacity * amount * flicker)
    halo.material.opacity = Math.min(1, FOG_VEIL.haloOpacity * amount * flicker)
  }

  function syncFace(world: World, enemy: Enemy, view: EnemyView): void {
    const face = view.face
    const node = view.model?.socket('eye')
    if (!face || !node) return
    const toPlayerX = world.player.pos.x - enemy.pos.x
    const toPlayerY = world.player.pos.y - enemy.pos.y
    const length = Math.hypot(toPlayerX, toPlayerY) || 1
    const facing = (Math.cos(enemy.facing) * toPlayerX + Math.sin(enemy.facing) * toPlayerY) / length
    face.sprite.visible = facing > EYE_FACE_LOOK.facingCut && view.veil.amount <= 0
    if (!face.sprite.visible) return
    view.root.worldToLocal(socketWorld(node, faceAt))
    face.sprite.position.set(faceAt.x + Math.cos(enemy.facing) * 0.05, faceAt.y, faceAt.z + Math.sin(enemy.facing) * 0.05)
    const next = eyeFaceOf({ aggro: enemy.aggro, notice: enemy.notice, dazed: disabled(enemy) || enemy.status.dazed > 0, sorry: clock < face.sorryUntil })
    if (next === face.current) return
    face.current = next
    face.sprite.material.map = eyeFaceTexture(next)
    face.sprite.material.needsUpdate = true
  }

  function wearCrown(anchor: THREE.Object3D): THREE.Object3D {
    const crown = models.shared('elite-crown')
    for (const material of crown.materials) {
      if (material.name !== 'mat_brass' || !(material instanceof THREE.MeshStandardMaterial)) continue
      material.emissive.set(ELITE_CROWN.glow)
      material.emissiveIntensity = ELITE_CROWN.glowIntensity
    }
    crown.root.scale.setScalar(ELITE_CROWN.scale)
    anchor.add(crown.root)
    return crown.root
  }

  function buildBoss(view: EnemyView, material: THREE.MeshStandardMaterial, enemy: Enemy): void {
    const def = getBoss(enemy.boss?.id ?? 'scarecrow')
    view.boss = bossRigs.build(def, { body: view.body, pivot: view.pivot, material, materials: view.materials, owned: view.owned })
    const lane = new THREE.Group()
    const area = flat(new THREE.Mesh(laneGeometry, areaMaterial), 0.035)
    const fill = flat(new THREE.Mesh(laneGeometry, fillMaterial), 0.045)
    area.scale.set(def.charge.distance, def.radius * 2, 1)
    fill.scale.set(0.01, def.radius * 2, 1)
    lane.add(area, fill)
    addCurtains(lane, def.charge.distance, def.radius * 2)
    lane.visible = false
    view.ground.add(lane)
    view.telegraph = lane
    view.fill = fill
    if (def.cannon) {
      const weapon = tuning.weapons[def.cannon.weapon]
      const width = weapon.radius * 2 + CANNON_LANE_MARGIN
      const cannonLane = new THREE.Group()
      const cannonArea = flat(new THREE.Mesh(laneGeometry, areaMaterial), 0.036)
      const cannonFill = flat(new THREE.Mesh(laneGeometry, fillMaterial), 0.046)
      cannonArea.scale.set(weapon.range, width, 1)
      cannonFill.scale.set(0.01, width, 1)
      cannonLane.add(cannonArea, cannonFill)
      addCurtains(cannonLane, weapon.range, width)
      cannonLane.visible = false
      view.ground.add(cannonLane)
      view.lane = cannonLane
      view.laneFill = cannonFill
    }
    if (def.triple) view.triple = tripleTelegraph(view, def)
    if (!def.fan) return
    const halfArc = THREE.MathUtils.degToRad(tuning.weapons[def.fan.weapon].spreadDeg) / 2
    const fanGeometry = new THREE.CircleGeometry(5, 28, -halfArc, halfArc * 2)
    const fanMaterial = new THREE.MeshBasicMaterial({ color: TELEGRAPH_COLOR, transparent: true, opacity: 0, depthWrite: false })
    view.owned.push(fanGeometry, fanMaterial)
    const fan = flat(new THREE.Mesh(fanGeometry, fanMaterial), 0.04)
    fan.visible = false
    const fanWall = sectorCurtain(5, tuning.weapons[def.fan.weapon].spreadDeg)
    fanWall.rotation.x = Math.PI / 2
    fan.add(fanWall)
    view.ground.add(fan)
    view.fan = fan
  }

  function tripleTelegraph(view: EnemyView, def: BossDef): TripleLanes | null {
    const triple = def.triple
    if (!triple) return null
    const weapon = tuning.weapons[triple.weapon]
    const width = weapon.radius * 2 + CANNON_LANE_MARGIN
    const group = new THREE.Group()
    const lanes = Array.from({ length: triple.barrels }, () => {
      const lane = new THREE.Group()
      const area = flat(new THREE.Mesh(laneGeometry, areaMaterial), 0.037)
      const fill = flat(new THREE.Mesh(laneGeometry, fillMaterial), 0.047)
      area.scale.set(weapon.range, width, 1)
      fill.scale.set(0.01, width, 1)
      lane.add(area, fill)
      addCurtains(lane, weapon.range, width)
      group.add(lane)
      return { lane, area, fill }
    })
    group.visible = false
    view.ground.add(group)
    return { group, lanes }
  }

  function removeView(view: EnemyView): void {
    scene.remove(view.root)
    if (view.beam) scene.remove(view.beam)
    for (const item of view.owned) item.dispose()
    view.sight?.geometry.dispose()
  }

  function syncEnemy(world: World, enemy: Enemy, view: EnemyView, alpha: number, dt: number): void {
    view.root.position.set(lerp(enemy.prev.x, enemy.pos.x, alpha), lerp(enemy.prevZ, enemy.z, alpha), lerp(enemy.prev.y, enemy.pos.y, alpha))
    if (view.fit === 0) view.fit = sizeFit(enemy, view)
    view.pivot.scale.setScalar(view.fit)
    const sway = enemy.aggro || enemy.kind === 'boss' ? 0 : Math.sin(clock * 0.8 + enemy.id) * 0.6
    const yaw = enemy.facing + sway
    view.pivot.rotation.y = -yaw
    view.ground.rotation.y = -enemy.facing
    view.flash = Math.max(0, view.flash - dt / Math.max(0.01, tuning.feel.flashSeconds))
    const { status } = enemy
    const burning = status.burn > 0
    const tint = view.flash > 0 ? FLASH_COLOR : burning ? BURN_COLOR : status.chill > 0 || status.frozen > 0 ? CHILL_COLOR : FLASH_COLOR
    const glow = view.flash > 0 ? view.flash * 1.4 : burning ? 0.35 + Math.abs(Math.sin(clock * 18 + enemy.id)) * 0.4 : status.frozen > 0 ? 0.8 : status.chill * 0.2
    for (const material of view.materials) {
      material.emissive.copy(tint)
      material.emissiveIntensity = glow
    }
    if (burning) {
      view.smoke -= dt
      if (view.smoke <= 0) {
        view.smoke = 0.18
        effects.puff(enemy.pos.x + (Math.random() - 0.5) * 0.3, 0.9, enemy.pos.y, '#ff9a3d', 0.15, 0.45, 0.35)
      }
    }
    syncFrozen(view, enemy)
    syncStunned(view, enemy)
    const squash = 1 - view.flash * 0.16
    const stretch = 1 / Math.sqrt(squash)
    view.body.scale.set(stretch, squash, stretch)
    const moving = Math.hypot(enemy.pos.x - enemy.prev.x, enemy.pos.y - enemy.prev.y) > 0.001
    view.body.position.y = moving && enemy.kind !== 'boss' ? Math.abs(Math.sin(clock * 12 + enemy.id)) * 0.06 : 0
    const frozen = status.frozen > 0
    const off = disabled(enemy)
    if (!frozen) view.posed = off ? 0 : view.pose.pose(enemy, tuning)
    view.model?.sync({
      enemy,
      tuning,
      time: world.time,
      step: dt,
      dt: frozen ? 0 : dt,
      moving: moving && !frozen,
      disabled: off,
      yaw,
      pose: view.posed,
    })

    switch (enemy.kind) {
      case 'grunt': {
        showFill(view, enemy.state === 'windup', progress(enemy.stateTime, tuning.weapons.claw.windup))
        const bracing = enemy.state === 'charge'
        if (view.lane) view.lane.visible = bracing
        if (bracing && view.laneFill) {
          const length = tuning.weapons.rush.range + tuning.grunt.radius
          view.laneFill.scale.x = Math.max(0.01, length * progress(enemy.stateTime, tuning.weapons.rush.windup))
        }
        break
      }
      case 'gunner':
        showBeam(world, enemy, view, enemy.state === 'aim', progress(enemy.stateTime, tuning.weapons.rifle.windup))
        break
      case 'turret':
        showLines(view, enemy.state === 'aim', progress(enemy.stateTime, tuning.weapons.cannon.windup))
        break
      case 'bomber': {
        const arming = enemy.state === 'arming'
        const fuse = tuning.weapons.fuse
        if (view.danger) {
          view.danger.visible = enemy.aggro && !arming
          view.danger.scale.setScalar(fuse.radius)
          view.danger.getObjectByName('curtain')?.scale.set(1, CURTAIN_HEIGHT / Math.max(0.01, fuse.radius), 1)
        }
        if (!view.model) view.body.scale.multiplyScalar(arming ? 1 + progress(enemy.stateTime, fuse.windup) * 0.35 : 1)
        if (view.spark) view.spark.scale.setScalar((view.model ? MOUNTED_SPARK : 1) * (1 + Math.abs(Math.sin(clock * (arming ? 30 : 8))) * 0.8))
        const blink = lampLit(bomberLampCycles(enemy, world.time, fuse.windup))
        for (const lamp of view.lamps) lamp.visible = blink
        if (arming) {
          const pulse = Math.abs(Math.sin(clock * 24)) * 0.9
          for (const material of view.materials) {
            if (pulse <= material.emissiveIntensity) continue
            material.emissive.copy(ARMING_COLOR)
            material.emissiveIntensity = pulse
          }
        }
        break
      }
      case 'shield':
        showFill(view, enemy.state === 'windup', progress(enemy.stateTime, tuning.weapons.bash.windup))
        break
      case 'thrower':
        if (view.lift) view.lift.position.y = enemy.state === 'aim' ? progress(enemy.stateTime, tuning.weapons.bomb.windup) * 0.35 : 0
        break
      case 'boss':
        syncBoss(world, enemy, view, dt)
        break
    }

    if (enemy.kind !== 'boss') syncVeil(world, enemy, view, dt)
    const showSight = flags.showSight && !enemy.aggro && enemy.kind !== 'boss'
    if (showSight && !view.sight) {
      const sight = sightOf(world, enemy)
      const half = THREE.MathUtils.degToRad(tuning.perception.fovDeg) / 2
      view.sight = flat(new THREE.Mesh(new THREE.CircleGeometry(sight, 36, -half, half * 2), sightMaterial), 0.05)
      view.ground.add(view.sight)
    }
    if (view.sight) view.sight.visible = showSight
    if (enemy.kind === 'boss') syncWeakPoint(view, enemy)
    else syncCrumble(world, view, enemy, dt)
  }

  function syncWeakPoint(view: EnemyView, enemy: Enemy): void {
    view.marks ??= ownMaterials(materialMeshes(view.pivot, 'mat_emblem')).map((entry) => entry.material)
    const exposed = bossExposed(enemy)
    const pulse = 0.8 + Math.sin(clock * 11) * 0.2
    for (const material of view.marks) {
      material.emissive.copy(EXPOSED_COLOR)
      material.emissiveIntensity = exposed ? 2.8 * pulse : 0
    }
  }

  function syncCrumble(world: World, view: EnemyView, enemy: Enemy, dt: number): void {
    const breaking = crumbling(world, enemy)
    if (breaking) {
      view.crumbleSmoke -= dt
      if (view.crumbleSmoke <= 0) {
        view.crumbleSmoke = 0.2
        const top = (BODY_HEIGHTS[enemy.kind] ?? 1.2) * 0.85
        effects.puff(enemy.pos.x + (Math.random() - 0.5) * 0.4, enemy.z + top, enemy.pos.y + (Math.random() - 0.5) * 0.4, '#5d5852', 0.2, 0.75, 0.55)
      }
    }
    if (!breaking && !view.eyes) return
    view.eyes ??= ownMaterials(materialMeshes(view.pivot, 'mat_eye'))
    const blink = breaking && Math.sin(clock * 15 + enemy.id) > 0
    for (const eye of view.eyes) {
      if (blink) {
        eye.material.emissive.copy(CRUMBLE_EYE)
        eye.material.emissiveIntensity = 3.2
      } else if (breaking) {
        eye.material.emissive.copy(eye.color)
        eye.material.emissiveIntensity = eye.intensity
      }
    }
  }

  function syncFrozen(view: EnemyView, enemy: Enemy): void {
    const frozen = enemy.status.frozen > 0
    if (frozen && !view.ice) {
      view.ice = new THREE.Mesh(iceGeometry, iceMaterial)
      const size = enemy.radius * 2.6
      view.ice.scale.set(size, size * 1.3, size)
      view.ice.position.y = size * 0.6
      view.root.add(view.ice)
    }
    if (view.ice) view.ice.visible = frozen
  }

  function syncStunned(view: EnemyView, enemy: Enemy): void {
    const stunned = enemy.status.stunned > 0
    if (stunned && !view.stars) {
      view.stars = new THREE.Group()
      for (let i = 0; i < 3; i++) {
        const star = new THREE.Mesh(starGeometry, starMaterial)
        const angle = (i / 3) * Math.PI * 2
        star.position.set(Math.cos(angle) * 0.35, 0, Math.sin(angle) * 0.35)
        view.stars.add(star)
      }
      view.stars.position.y = view.anchor ? (view.crown ? crownMiddle(view.crown) : 0) : STAR_HEIGHT
      ;(view.anchor ?? view.root).add(view.stars)
    }
    if (!view.stars) return
    view.stars.visible = stunned
    view.stars.rotation.y = clock * 6
  }

  function syncBoss(world: World, enemy: Enemy, view: EnemyView, dt: number): void {
    const state = enemy.boss
    if (!state) return
    const def = getBoss(state.id)
    const chargeTelegraph = state.phase === 'telegraph' && (state.move === 'charge' || state.move === 'frenzy')
    if (view.telegraph) view.telegraph.visible = chargeTelegraph
    if (view.telegraph && def.tread) view.telegraph.rotation.y = -(Math.atan2(state.chargeY, state.chargeX) - enemy.facing)
    if (chargeTelegraph && view.fill) {
      const total = state.move === 'frenzy' ? 0.45 : def.charge.telegraph
      view.fill.scale.x = Math.max(0.01, def.charge.distance * clamp(1 - state.timer / total, 0, 1))
    }
    const crash = chargeTelegraph && !def.tread ? crashTarget(world.grid, enemy.pos.x, enemy.pos.y, state.chargeX, state.chargeY, def.charge.distance, enemy.radius) : null
    const marked = crash !== null && (crash.tile === Tile.Rock || crash.tile === Tile.Boulder)
    crashMark.visible = marked
    if (crash && marked) {
      const floor = cellFloor(world.grid, crash.column, crash.row)
      crashMark.position.set(crash.column + 0.5, floor, crash.row + 0.5)
      crashMark.scale.set(CRASH_MARK.radius, Math.max(1, cellTop(world.grid, crash.column, crash.row) - floor) + 0.6, CRASH_MARK.radius)
      crashMaterial.opacity = 0.55 + 0.45 * Math.abs(Math.sin(clock * CRASH_MARK.pulse))
    }
    const fanTelegraph = state.phase === 'telegraph' && state.move === 'fan'
    if (view.fan && def.fan) {
      view.fan.visible = fanTelegraph
      const material = view.fan.material
      if (fanTelegraph && material instanceof THREE.MeshBasicMaterial) {
        material.opacity = 0.12 + 0.35 * (1 - state.timer / Math.max(0.01, tuning.weapons[def.fan.weapon].windup))
      }
    }
    const cannonTelegraph = state.phase === 'telegraph' && state.move === 'cannon' && def.cannon !== null
    if (view.lane) {
      view.lane.visible = cannonTelegraph
      view.lane.rotation.y = -(enemy.aimAngle - enemy.facing)
    }
    if (cannonTelegraph && view.lane && view.laneFill && def.cannon) {
      const reach = laneLength(world.grid, enemy.pos.x, enemy.pos.y, enemy.aimAngle, tuning.weapons[def.cannon.weapon].range)
      view.lane.children[0]?.scale.setX(Math.max(0.01, reach))
      stretchCurtains(view.lane, reach)
      view.laneFill.scale.x = Math.max(0.01, reach * clamp(1 - state.timer / Math.max(0.01, def.cannon.telegraph), 0, 1))
    }
    if (view.triple && def.triple) {
      const showing = state.phase === 'telegraph' && state.move === 'triple'
      view.triple.group.visible = showing
      if (showing) {
        const amount = clamp(1 - state.timer / Math.max(0.01, def.triple.telegraph), 0, 1)
        const range = tuning.weapons[def.triple.weapon].range
        tripleLanes(enemy, def).forEach((angle, index) => {
          const item = view.triple?.lanes[index]
          if (!item) return
          const reach = laneLength(world.grid, enemy.pos.x, enemy.pos.y, angle, range)
          item.lane.rotation.y = -(angle - enemy.facing)
          item.area.scale.setX(Math.max(0.01, reach))
          stretchCurtains(item.lane, reach)
          item.fill.scale.setX(Math.max(0.01, reach * amount))
        })
      }
    }
    view.boss?.sync(state, clock, dt)
    if (state.phase === 'shift') for (const material of view.materials) material.emissiveIntensity = 0.2 + Math.abs(Math.sin(clock * 10)) * 0.4
    const stunned = state.phase === 'stunned'
    if (stunned && !view.stars) {
      view.stars = new THREE.Group()
      for (let i = 0; i < 4; i++) {
        const star = new THREE.Mesh(starGeometry, starMaterial)
        const angle = (i / 4) * Math.PI * 2
        star.scale.setScalar(1.8)
        star.position.set(Math.cos(angle) * 0.9, 0, Math.sin(angle) * 0.9)
        view.stars.add(star)
      }
      view.stars.position.y = view.boss?.starHeight ?? 3.6
      view.root.add(view.stars)
    }
    if (view.stars) {
      view.stars.visible = stunned
      view.stars.rotation.y = clock * 5
    }
  }

  function crownMiddle(crown: THREE.Object3D): number {
    return crown.position.y + models.bounds('elite-crown').max.y * crown.scale.y * 0.5
  }

  function nearestShield(x: number, y: number): EnemyView | null {
    let best: EnemyView | null = null
    let reach = SHIELD_BLOCK_REACH
    for (const view of enemyViews.values()) {
      if (view.kind !== 'shield' || !view.model) continue
      const distance = Math.hypot(view.root.position.x - x, view.root.position.z - y)
      if (distance >= reach) continue
      reach = distance
      best = view
    }
    return best
  }

  function showFill(view: EnemyView, visible: boolean, amount: number): void {
    if (view.telegraph) view.telegraph.visible = visible
    if (visible && view.fill) view.fill.scale.setScalar(Math.max(0.05, amount))
  }

  function showBeam(world: World, enemy: Enemy, view: EnemyView, visible: boolean, amount: number): void {
    const beam = view.beam
    if (!beam) return
    beam.visible = visible && enemy.hp > 0
    if (!beam.visible) return
    const { player } = world
    const fromZ = enemy.z + muzzleHeightOf(enemy.kind)
    const distance = Math.hypot(player.pos.x - enemy.pos.x, player.pos.y - enemy.pos.y)
    const pitch = enemy.aimPitch ?? Math.atan2(player.z + CHEST_HEIGHT - fromZ, Math.max(distance, 0.1))
    const length = Math.min(tuning.weapons.rifle.range, distance + 1.5) / Math.max(Math.cos(pitch), 0.2)
    beamDirection.set(Math.cos(enemy.aimAngle) * Math.cos(pitch), Math.sin(pitch), Math.sin(enemy.aimAngle) * Math.cos(pitch))
    beam.position.set(enemy.pos.x, fromZ, enemy.pos.y)
    beam.quaternion.setFromUnitVectors(BEAM_UP, beamDirection)
    const locked = amount > trackShare(world)
    const width = locked ? 0.07 : 0.032 + amount * 0.02
    beam.scale.set(width, length, width)
    const material = beam.material as THREE.MeshBasicMaterial
    material.opacity = locked ? 0.95 : 0.35 + amount * 0.35
    material.color.copy(BEAM_COLOR).multiplyScalar(locked ? 2.6 : 1.2)
  }

  function showLines(view: EnemyView, visible: boolean, amount: number): void {
    if (view.telegraph) view.telegraph.visible = visible
    if (visible && view.lineMaterial) view.lineMaterial.opacity = 0.15 + 0.6 * amount
  }

  function fell(view: EnemyView, time: number): void {
    view.fallen = time
    view.flash = 0
    view.body.scale.setScalar(1)
    for (const item of [view.telegraph, view.lane, view.fan, view.stars, view.ice, view.sight, view.danger, view.triple?.group]) if (item) item.visible = false
    for (const material of view.materials) material.emissiveIntensity = 0
  }

  function playDefeat(world: World, view: EnemyView): boolean {
    const rig = view.boss
    const since = rig && view.fallen !== null ? defeatTime(view.fallen, world.time, rig.defeatSeconds) : null
    if (!rig || since === null) return false
    const { player } = world
    defeatTarget.x = player.pos.x
    defeatTarget.y = player.pos.y
    defeatTarget.exit = arenaExit(world)
    rig.defeat(since, player.alive ? defeatTarget : null)
    return true
  }

  function arenaExit(world: World): { x: number; y: number } | null {
    const area = world.level.areas.find((item) => item.kind === 'boss')
    if (!area || area.gates.length === 0) return null
    const { columns } = world.level.grid
    const top = Math.min(...area.gates.map((index) => Math.floor(index / columns)))
    const cells = area.gates.filter((index) => Math.floor(index / columns) === top)
    const x = cells.reduce((sum, index) => sum + (index % columns) + 0.5, 0) / cells.length
    return { x, y: top + 0.5 }
  }

  function syncEnemies(world: World, alpha: number, dt: number): void {
    for (const view of enemyViews.values()) view.seen = false
    blobs.begin()
    for (const enemy of world.enemies) {
      if (enemy.hp <= 0) continue
      let view = enemyViews.get(enemy.id)
      if (view && view.fallen !== null) {
        removeView(view)
        view = undefined
      }
      if (!view) {
        view = buildEnemy(enemy)
        enemyViews.set(enemy.id, view)
      }
      view.seen = true
      const near = enemy.kind === 'boss' || Math.hypot(enemy.pos.x - world.player.pos.x, enemy.pos.y - world.player.pos.y) <= ENTITY_CULL.distance
      view.root.visible = near
      if (!near) continue
      syncEnemy(world, enemy, view, alpha, dt)
      if (view.cone) {
        view.cone.visible = !enemy.aggro
        view.cone.material.opacity = EYE_CONE.idle + (EYE_CONE.noticing - EYE_CONE.idle) * enemy.notice
      }
      if (view.face) syncFace(world, enemy, view)
      if (view.lamp) {
        const column = Math.floor(enemy.pos.x)
        const row = Math.floor(enemy.pos.y)
        const inGrass = tileAt(world.grid, column, row) === Tile.Bush || [-1, 1].some((d) => tileAt(world.grid, column + d, row) === Tile.Bush || tileAt(world.grid, column, row + d) === Tile.Bush)
        view.lamp.visible = inGrass
        if (inGrass) view.lamp.getObjectByName('bulb')?.scale.setScalar(1 + 0.35 * Math.max(0, Math.sin(clock * (enemy.aggro ? GRASS_LAMP.angry : GRASS_LAMP.calm) + enemy.id)))
      }
      if (enemy.kind !== 'boss') blobs.add(view.root.position.x, view.root.position.z, enemy.radius, 1 - Math.max(0, view.veil.amount))
    }
    blobs.end()
    for (const [id, view] of enemyViews) {
      if (view.seen) continue
      if (view.boss && view.fallen === null) fell(view, world.time)
      if (view.fallen !== null && playDefeat(world, view)) continue
      removeView(view)
      enemyViews.delete(id)
    }
  }

  function syncMarkers(world: World): void {
    world.spawns.forEach((marker, index) => {
      let mesh = markerMeshes[index]
      if (!mesh) {
        mesh = new THREE.Mesh(markerGeometry, new THREE.MeshBasicMaterial({ color: MARKER_COLOR, transparent: true, depthWrite: false }))
        mesh.rotation.x = -Math.PI / 2
        scene.add(mesh)
        markerMeshes.push(mesh)
      }
      const amount = marker.total > 0 ? 1 - marker.remaining / marker.total : 1
      mesh.visible = true
      mesh.position.set(marker.pos.x, floorAt(world.grid, marker.pos.x, marker.pos.y) + 0.03, marker.pos.y)
      mesh.scale.setScalar(1.3 - 0.4 * amount + Math.sin(clock * 14) * 0.06)
      mesh.material.opacity = 0.35 + 0.55 * amount
    })
    for (let i = world.spawns.length; i < markerMeshes.length; i++) markerMeshes[i].visible = false
  }

  function shapedBlast(blast: Blast) {
    let item = shapedBlasts.get(blast.id)
    if (item) return item
    const ring = blast.inner > 0
    const owned: Disposable[] = []
    const geometry = ring
      ? new THREE.RingGeometry(blast.inner, blast.radius, 56, 1, blast.gapWidth / 2, Math.PI * 2 - blast.gapWidth)
      : new THREE.CircleGeometry(blast.radius, 40, -blast.arcWidth / 2, blast.arcWidth)
    const fillMaterial = new THREE.MeshBasicMaterial({ color: TELEGRAPH_COLOR, transparent: true, opacity: 0.2, depthWrite: false })
    owned.push(geometry, fillMaterial)
    const group = new THREE.Group()
    const area = flat(new THREE.Mesh(geometry, areaMaterial), 0.05)
    const fill = flat(new THREE.Mesh(geometry, fillMaterial), 0.055)
    group.add(area, fill)
    group.position.set(blast.x, 0, blast.y)
    group.rotation.y = -(ring ? blast.gapCenter : blast.arcCenter)
    scene.add(group)
    item = { group, fill, owned, ring }
    shapedBlasts.set(blast.id, item)
    return item
  }

  function syncShapedBlasts(world: World): void {
    const alive = new Set<number>()
    for (const blast of world.blasts) {
      if (blast.inner <= 0 && blast.arcWidth <= 0 && blast.gapWidth <= 0) continue
      alive.add(blast.id)
      const item = shapedBlast(blast)
      const amount = blast.total > 0 ? clamp(1 - blast.delay / blast.total, 0, 1) : 1
      const material = item.fill.material
      if (item.ring) {
        if (material instanceof THREE.MeshBasicMaterial) material.opacity = 0.15 + 0.55 * amount
      } else {
        item.fill.scale.setScalar(Math.max(0.05, amount))
      }
    }
    for (const [id, item] of shapedBlasts) {
      if (alive.has(id)) continue
      scene.remove(item.group)
      for (const thing of item.owned) thing.dispose()
      shapedBlasts.delete(id)
    }
  }

  function syncBlasts(world: World): void {
    syncShapedBlasts(world)
    const round = world.blasts.filter((blast) => blast.inner <= 0 && blast.arcWidth <= 0 && blast.gapWidth <= 0)
    round.forEach((blast, index) => {
      let item = blastMeshes[index]
      if (!item) {
        const wall = new THREE.Mesh(ringCurtain, curtainMaterial)
        wall.userData.noInk = true
        wall.renderOrder = 2
        item = {
          ring: flat(new THREE.Mesh(ringGeometry, areaMaterial), 0.05),
          fill: flat(new THREE.Mesh(discGeometry, fillMaterial), 0.055),
          wall,
        }
        scene.add(item.ring, item.fill, item.wall)
        blastMeshes.push(item)
      }
      const amount = blast.total > 0 ? clamp(1 - blast.delay / blast.total, 0, 1) : 1
      item.ring.visible = true
      item.fill.visible = true
      item.wall.visible = true
      item.ring.position.set(blast.x, blast.z + 0.05, blast.y)
      item.fill.position.set(blast.x, blast.z + 0.055, blast.y)
      item.wall.position.set(blast.x, blast.z, blast.y)
      item.wall.scale.set(blast.radius, CURTAIN_HEIGHT, blast.radius)
      item.ring.scale.setScalar(blast.radius)
      item.fill.scale.setScalar(Math.max(0.05, blast.radius * amount))
    })
    for (let i = round.length; i < blastMeshes.length; i++) {
      blastMeshes[i].ring.visible = false
      blastMeshes[i].fill.visible = false
      blastMeshes[i].wall.visible = false
    }
  }

  return {
    setPlayerVisible(visible) {
      player.setVisible(visible)
    },
    sync(world, alpha, dt) {
      clock += dt
      if (world.level !== foggyLevel) {
        foggyLevel = world.level
        foggy = hasFog(world.level)
      }
      player.sync(world, alpha, dt, clock)
      sheep.sync(world, alpha, dt)
      mines.sync(world, dt)
      syncEnemies(world, alpha, dt)
      syncMarkers(world)
      syncBlasts(world)
    },
    handle(event) {
      player.handle(event)
      sheep.handle(event)
      let claimed = false
      for (const view of enemyViews.values()) if (view.boss?.handle(event)) claimed = true
      const { feel } = tuning
      if (event.type === 'bark' && event.enemy !== null) {
        const face = enemyViews.get(event.enemy)?.face
        if (face) face.sorryUntil = clock + event.seconds
      }
      switch (event.type) {
        case 'enemyShot': {
          const shooter = MUZZLE_KINDS[event.weapon] ?? RIGGED_SHOTS[event.weapon]
          if (!shooter || !models.has(shooter)) effects.puff(event.x, 'z' in event ? event.z : BULLET_HEIGHT, event.y, '#ff8fb3', 0.22, 0.55, 0.08)
          break
        }
        case 'clueFound':
          effects.puff(event.x, 0.6, event.y, CLUE_GLOW, 0.2, 0.9, 0.45)
          break
        case 'secretFound':
          effects.puff(event.x, 0.8, event.y, CLUE_GLOW, 0.3, 1.3, 0.6)
          break
        case 'bulletHitWall':
          effects.puff(event.x, 'z' in event ? event.z : BULLET_HEIGHT, event.y, event.team === 'player' ? '#f3e2c4' : '#ffb3c8', 0.2, 0.6, 0.16)
          break
        case 'bulletExpired':
          effects.puff(event.x, 'z' in event ? event.z : BULLET_HEIGHT, event.y, '#fff7d6', 0.12, 0.3, 0.1)
          break
        case 'enemyHit': {
          const view = enemyViews.get(event.id)
          if (view) view.flash = 1
          effects.puff(event.x, 0.75, event.y, '#ffffff', 0.3, 0.7, 0.12)
          stage.addTrauma(feel.shakeHit)
          break
        }
        case 'enemyKilled':
          if (!claimed) effects.burst(event.x, event.y, KILL_COLORS[event.kind], event.kind === 'boss' ? 2.2 : 1)
          stage.addTrauma(event.kind === 'boss' ? (claimed ? 0.45 : 1) : feel.shakeKill)
          break
        case 'enemySpawned':
          effects.puff(event.x, 0.4, event.y, '#ffb4a8', 0.4, 1.1, 0.25)
          break
        case 'bulletBounced':
          effects.puff(event.x, BULLET_HEIGHT, event.y, '#6dffc8', 0.15, 0.5, 0.12)
          break
        case 'frozen':
          effects.burst(event.x, event.y, '#bfeaff', 0.6)
          break
        case 'crateBroken':
          effects.burst(event.x, event.y, '#c8995a', 0.85)
          stage.addTrauma(feel.shakeHit)
          break
        case 'chestOpened':
          effects.burst(event.x, event.y, CHEST_COLORS[event.tier].trim, 0.8)
          break
        case 'supplyUsed':
          effects.burst(event.x, event.y, '#ffb347', 0.7)
          break
        case 'pickedUp': {
          const item = event.item
          const color =
            item.type === 'heal' ? HEAL_COLOR : item.type === 'buff' ? BUFF_COLORS[item.buff] : item.type === 'ammo' ? '#ffc94d' : '#5ff0ff'
          effects.puff(event.x, 0.6, event.y, color, 0.3, 1.2, 0.3)
          break
        }
        case 'blast':
          if (!claimed) effects.burst(event.x, event.y, event.source === 'boss' ? '#ffd27a' : event.source === 'player' ? '#ffb347' : '#ff9b3d', event.radius * 0.7)
          stage.addTrauma(feel.shakeBlast)
          break
        case 'bossCrash':
          effects.burst(event.x, event.y, '#d8c4a0', 1.2)
          stage.addTrauma(feel.shakeBlast)
          break
        case 'rockBroken':
          effects.burst(event.x, event.y, '#9b968b', 1)
          break
        case 'shieldBlocked':
          effects.puff(event.x, BULLET_HEIGHT, event.y, '#cfe3ff', 0.18, 0.55, 0.12)
          ;(enemyViews.get(event.id) ?? nearestShield(event.x, event.y))?.model?.blocked()
          break
        case 'eliteShieldBroken':
          effects.burst(event.x, event.y, '#8cc0ff', 0.7)
          break
        case 'bossPhase':
          stage.addTrauma(0.6)
          break
        default:
          break
      }
    },
    reset() {
      for (const view of enemyViews.values()) removeView(view)
      enemyViews.clear()
      blobs.begin()
      blobs.end()
      for (const item of shapedBlasts.values()) {
        scene.remove(item.group)
        for (const thing of item.owned) thing.dispose()
      }
      shapedBlasts.clear()
      player.reset()
      sheep.reset()
      mines.reset()
    },
  }
}
