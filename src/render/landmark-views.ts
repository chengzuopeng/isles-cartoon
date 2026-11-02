import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { FOG } from '../data/fog'
import { LANDMARKS, type LandmarkDef, type LandmarkId, type LandmarkMotion } from '../data/landmarks'
import type { BuiltLevel } from '../sim/level'
import type { LandmarkPlacement } from '../sim/landmarks'
import type { AlarmState } from '../sim/types'
import type { World } from '../sim/world'
import { freshSwing, lampLevel, stepBell, waveLook, wavesDone, type BellSwing, type WaveLook } from './alarm-motion'
import { createDebris, type Debris } from './boss-debris'
import type { Effects } from './effects'
import { radialTexture } from './glow-textures'
import { shareInstancedDepth } from './instanced-depth'
import { createLampRig, type LampParts, type LampRig } from './lamp-rig'
import { bakeSight, boxSight, cameraEye, createFader, fadesBehind, freshFade, hidesPlayer, settleFade, type FadeState, type Fader, type Sight } from './landmark-fade'
import type { ModelId } from './asset-urls'
import { SHADOW_RULES, rotateFromRest, socketWorld, type ModelInstance, type ModelLibrary, type ModelPart } from './model-library'
import { atlasPart } from './node-parts'
import { finish, type Steps } from './slices'
import { createWaterfall, type Waterfall } from './waterfall'
import {
  SCENE_NODES,
  alarmNodes,
  cellHash,
  chunkOf,
  facingYaw,
  footprintCenter,
  fxSockets,
  glowLevel,
  glowRule,
  hiddenInside,
  hideMargin,
  hingeOf,
  insideFootprint,
  lampRule,
  landmarkModel,
  landmarkYaw,
  motionAngle,
  motionAxis,
  openProgress,
  stateModel,
  swingEase,
  type GlowRule,
} from './scene-models'
import {
  ALARM_BELL,
  ALARM_RIGS,
  CHIMNEY_SMOKE,
  FORGE_FIRE,
  LAMP_GLOW,
  LANDMARK_BATCH,
  LANDMARK_BREAK,
  LANDMARK_CRASH,
  LANDMARK_FALLBACK,
  LANDMARK_FX,
  LANDMARK_HIT,
  LANDMARK_OPEN,
  PALETTES,
  SCENE_CHUNK,
  SCENE_TINT,
  SHADOWLESS_LANDMARKS,
  STUMP_CRASH,
} from './themes'

interface Spinner {
  node: THREE.Object3D
  axis: THREE.Vector3
  motion: LandmarkMotion
}

interface Glow {
  rule: GlowRule
  materials: { material: THREE.MeshStandardMaterial; base: number }[]
}

interface Opener {
  node: THREE.Object3D
  axis: THREE.Vector3
  angle: number
}

interface AlarmRig {
  alarm: number
  bell: THREE.Object3D | null
  axis: THREE.Vector3
  lamp: { material: THREE.MeshStandardMaterial; base: number }[]
  swing: BellSwing
  status: AlarmState['status']
  rungAt: number
  waves: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[]
}

interface Forge {
  at: THREE.Vector3
  glow: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>
  heat: { material: THREE.MeshStandardMaterial; base: number }[]
  next: number
}

interface Chimney {
  at: THREE.Vector3
  next: number
}

type BreakStyle = 'cart' | 'pillar'

interface PlacedModel {
  index: number
  id: LandmarkId
  model: ModelInstance
  owned: boolean
  spinners: Spinner[]
  glow: Glow | null
  roof: THREE.Object3D | null
  inside: THREE.Object3D[]
  margin: number
  openers: Opener[]
  opened: number
  wreck: ModelInstance | null
  style: BreakStyle | null
  broken: boolean
  hp: number
  jolt: number
  puffAt: number
  crashes: number
  crashAt: number
  tilt: THREE.Vector3
  yaw: number
  alarm: AlarmRig | null
  forge: Forge | null
  chimney: Chimney | null
  lamp: { rig: LampRig; index: number } | null
  waterfall: Waterfall | null
  center: THREE.Vector3
  height: number
  column: number
  row: number
  width: number
  depth: number
}

interface FadingLandmark {
  sight: Sight
  roof: THREE.Object3D | null
  fader: Fader
  state: FadeState
  owner: PlacedModel | null
}

interface FallbackCell {
  column: number
  row: number
  height: number
  color: THREE.Color
}

interface BatchSlot {
  meshes: THREE.InstancedMesh[]
  instance: number
  matrix: THREE.Matrix4
}

interface Scattered {
  placement: LandmarkPlacement
  column: number
  row: number
  hidden: boolean
  slot: BatchSlot
}

interface BatchedBreak {
  index: number
  whole: BatchSlot
  wreck: BatchSlot | null
  center: THREE.Vector3
  yaw: number
  broken: boolean
  crashes: number
  crashAt: number
  tilted: boolean
  tilt: THREE.Vector3
}

export interface LandmarkViews {
  readonly group: THREE.Group
  readonly modelCount: number
  readonly placeholderCells: number
  readonly fadingCount: number
  readonly batchCount: number
  update(world: World, dt: number): void
  dispose(): void
}

const BREAK_STYLES: Readonly<Partial<Record<LandmarkId, BreakStyle>>> = {
  'ch1-hay-cart': 'cart',
  'ch1-hay-pillar': 'pillar',
}
const TAU = Math.PI * 2
const UP = new THREE.Vector3(0, 1, 0)

function boxMesh(geometry: THREE.BufferGeometry, material: THREE.Material, cells: readonly FallbackCell[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, cells.length)
  const matrix = new THREE.Matrix4()
  cells.forEach((cell, instance) => {
    matrix.makeScale(1, cell.height, 1).setPosition(cell.column + 0.5, 0, cell.row + 0.5)
    mesh.setMatrixAt(instance, matrix)
  })
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

function emissiveUnder(node: THREE.Object3D | undefined, named?: string): { material: THREE.MeshStandardMaterial; base: number }[] {
  const found: { material: THREE.MeshStandardMaterial; base: number }[] = []
  node?.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial) || material.emissive.getHex() === 0) continue
      if (named !== undefined && material.name !== named) continue
      if (!found.some((entry) => entry.material === material)) found.push({ material, base: material.emissiveIntensity })
    }
  })
  return found
}

function glowOf(model: ModelInstance, rule: GlowRule): Glow | null {
  const materials = emissiveUnder(model.nodes.get(rule.node))
  return materials.length > 0 ? { rule, materials } : null
}

function scatter(radius: number): number {
  return (Math.random() * 2 - 1) * radius
}

export function castsShadowAs(material: THREE.Material): boolean {
  return !(material.transparent || material.alphaTest > 0 || SHADOW_RULES.materials.test(material.name))
}

export function mergedModel(models: ModelLibrary, id: ModelId, own: boolean): ModelInstance {
  const root = new THREE.Group()
  root.userData.model = id
  const copies = new Map<THREE.Material, THREE.Material>()
  for (const part of models.parts(id)) {
    let material = part.material
    if (own) {
      material = copies.get(part.material) ?? part.material.clone()
      copies.set(part.material, material)
    }
    const mesh = new THREE.Mesh(part.geometry, material)
    mesh.castShadow = castsShadowAs(material)
    root.add(mesh)
  }
  const materials = own ? [...copies.values()] : [...new Set(models.parts(id).map((part) => part.material))]
  return {
    root,
    nodes: new Map(),
    tintable: [],
    materials,
    glow: new Map(),
    dispose() {
      if (own) for (const material of materials) material.dispose()
    },
  }
}

export interface OnePart extends ModelPart {
  copied: boolean
}

export function sharesLook(materials: readonly THREE.Material[], roughness = 0.1, mixedSides = false): boolean {
  const [first] = materials
  if (!(first instanceof THREE.MeshStandardMaterial)) return false
  return materials.every(
    (material) =>
      material instanceof THREE.MeshStandardMaterial &&
      material.map?.source === first.map?.source &&
      material.color.equals(first.color) &&
      material.emissive.getHex() === 0 &&
      (mixedSides || material.side === first.side) &&
      material.transparent === first.transparent &&
      material.alphaTest === first.alphaTest &&
      material.vertexColors === first.vertexColors &&
      material.metalness === first.metalness &&
      Math.abs(material.roughness - first.roughness) <= roughness,
  )
}

export function onePart(parts: readonly ModelPart[], mixedSides = false): OnePart | null {
  if (parts.length < 2 || !sharesLook(parts.map((part) => part.material), 0.1, mixedSides)) return null
  const names = Object.keys(parts[0].geometry.attributes).filter((name) => parts.every((part) => name in part.geometry.attributes))
  const indexed = parts.every((part) => part.geometry.index !== null)
  const list = parts.map((part) => {
    const source = indexed ? part.geometry : part.geometry.index ? part.geometry.toNonIndexed() : part.geometry
    const copy = new THREE.BufferGeometry()
    for (const name of names) copy.setAttribute(name, source.getAttribute(name))
    if (indexed && source.index) copy.setIndex(source.index)
    return copy
  })
  const merged = mergeGeometries(list, false)
  if (!merged) return null
  const main = parts.reduce((best, part) => (part.geometry.getAttribute('position').count > best.geometry.getAttribute('position').count ? part : best))
  if (parts.every((part) => part.material.side === main.material.side)) return { geometry: merged, material: main.material, copied: false }
  const material = main.material.clone()
  material.side = THREE.DoubleSide
  return { geometry: merged, material, copied: true }
}

function needsNodes(id: LandmarkId): boolean {
  const def = LANDMARKS[id]
  return (
    (def.motion?.length ?? 0) > 0 ||
    Boolean(def.opens) ||
    Boolean(def.nodes?.includes(SCENE_NODES.roof)) ||
    hiddenInside(id).length > 0 ||
    glowRule(id) !== undefined ||
    alarmNodes(id).length > 0 ||
    lampRule(id) !== undefined
  )
}

export function batchesLandmark(id: LandmarkId, def: LandmarkDef = LANDMARKS[id]): boolean {
  const listed = LANDMARK_BATCH.includes(id)
  const single = def.size[0] === 1 && def.size[1] === 1
  const breaks = def.breaks ? listed && single && def.breaks.rule === 'crashes' : true
  return (
    (single || listed) &&
    !def.footprint &&
    breaks &&
    !def.deck &&
    !def.lamp &&
    !fadesBehind(def) &&
    !needsNodes(id) &&
    fxSockets(id).length === 0
  )
}

export function createLandmarkViews(level: BuiltLevel, models: ModelLibrary, effects: Effects | null = null): LandmarkViews {
  return finish(buildLandmarkViews(level, models, effects))
}

export function* buildLandmarkViews(level: BuiltLevel, models: ModelLibrary, effects: Effects | null = null): Steps<LandmarkViews> {
  const cleanup = { dispose: () => {} }
  let built = false
  try {
    const views = yield* landmarkSteps(level, models, effects, cleanup)
    built = true
    return views
  } finally {
    if (!built) cleanup.dispose()
  }
}

function* landmarkSteps(level: BuiltLevel, models: ModelLibrary, effects: Effects | null, cleanup: { dispose(): void }): Steps<LandmarkViews> {
  const group = new THREE.Group()
  const placed: PlacedModel[] = []
  const fading: FadingLandmark[] = []
  const fallbackCells: FallbackCell[] = []
  const boxes: THREE.InstancedMesh[] = []
  const batches: THREE.InstancedMesh[] = []
  const owned: { dispose(): void }[] = []
  const has = (id: string) => models.has(id)
  const { columns } = level.grid
  const scattered = new Map<ModelId, Scattered[]>()
  const breakables: BatchedBreak[] = []
  let boxGeometry: THREE.BufferGeometry | null = null
  let waveGeometry: THREE.RingGeometry | null = null
  let glowGeometry: THREE.IcosahedronGeometry | null = null
  let lampParts: LampParts | null = null
  let placeholderCells = 0
  let debris: Debris | null = null
  let debrisUntil = 0
  let clock = 0
  let tracked: World | null = null

  const dispose = () => {
    for (const item of fading) item.fader.dispose()
    fading.length = 0
    for (const item of placed) {
      item.model.root.removeFromParent()
      if (item.owned) item.model.dispose()
      item.wreck?.root.removeFromParent()
      item.lamp?.rig.dispose()
      item.waterfall?.dispose()
    }
    breakables.length = 0
    placed.length = 0
    for (const mesh of boxes) {
      mesh.removeFromParent()
      mesh.dispose()
    }
    boxes.length = 0
    for (const mesh of batches) {
      mesh.removeFromParent()
      mesh.dispose()
    }
    batches.length = 0
    group.clear()
    for (const resource of owned) resource.dispose()
    owned.length = 0
  }
  cleanup.dispose = dispose

  const unitBox = () => {
    if (!boxGeometry) {
      boxGeometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
      owned.push(boxGeometry)
    }
    return boxGeometry
  }

  const ring = (): THREE.RingGeometry => {
    if (!waveGeometry) {
      waveGeometry = new THREE.RingGeometry(1 - ALARM_BELL.waveWidth, 1, 64)
      owned.push(waveGeometry)
    }
    return waveGeometry
  }

  const ember = () => {
    if (!glowGeometry) {
      glowGeometry = new THREE.IcosahedronGeometry(1, 1)
      owned.push(glowGeometry)
    }
    return glowGeometry
  }

  const lampKit = (): LampParts => {
    if (!lampParts) {
      lampParts = { glow: radialTexture(64, 1.8), ring: new THREE.RingGeometry(1 - LAMP_GLOW.ringWidth, 1, 72) }
      owned.push(lampParts.glow, lampParts.ring)
    }
    return lampParts
  }

  const blankSlot = (): BatchSlot => ({ meshes: [], instance: 0, matrix: new THREE.Matrix4() })

  const queueBatch = (id: ModelId, placement: LandmarkPlacement, hidden: boolean): BatchSlot => {
    const slot = blankSlot()
    const list = scattered.get(id) ?? []
    list.push({ placement, column: placement.column, row: placement.row, hidden, slot })
    scattered.set(id, list)
    return slot
  }

  const position = (root: THREE.Object3D, center: { x: number; z: number }, facing: number) => {
    root.position.set(center.x, 0, center.z)
    root.rotation.y = facingYaw(facing)
  }

  const socketsOf = (id: ModelId, center: { x: number; z: number }, facing: number, names: readonly string[]): Map<string, THREE.Vector3> => {
    const probe = models.shared(id)
    position(probe.root, center, facing)
    probe.root.updateWorldMatrix(true, true)
    const found = new Map<string, THREE.Vector3>()
    for (const name of names) {
      const node = probe.nodes.get(name)
      if (node) found.set(name, socketWorld(node, new THREE.Vector3()))
    }
    return found
  }

  const alarmRig = (index: number, model: ModelInstance): AlarmRig | null => {
    const placement = level.landmarks[index]
    const rule = ALARM_RIGS[placement.id]
    const alarm = level.alarms.findIndex((item) => item.landmark === index)
    if (!rule) return null
    const waves = Array.from({ length: ALARM_BELL.waves * 2 }, () => {
      const material = new THREE.MeshBasicMaterial({
        color: ALARM_BELL.wave,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      })
      owned.push(material)
      const wave = new THREE.Mesh(ring(), material)
      wave.rotation.x = -Math.PI / 2
      wave.visible = false
      wave.castShadow = false
      wave.renderOrder = 30
      group.add(wave)
      return wave
    })
    const bell = model.nodes.get(rule.bell) ?? null
    return {
      alarm,
      bell,
      axis: new THREE.Vector3(...motionAxis(rule.axis)),
      lamp: emissiveUnder(model.nodes.get(rule.lamp)),
      swing: freshSwing(),
      status: 'quiet',
      rungAt: -Infinity,
      waves,
    }
  }

  for (const [index, placement] of level.landmarks.entries()) {
    const def = LANDMARKS[placement.id]
    const id = landmarkModel(has, placement.id, placement.variant)
    const fades = fadesBehind(def) && placement.cells.length > 0
    if (id && models.has(id) && batchesLandmark(placement.id, def)) {
      const whole = queueBatch(id, placement, false)
      if (def.breaks) {
        const wreckId = stateModel(has, placement.id, def.breaks.into)
        const center = footprintCenter(placement.column, placement.row, placement.width, placement.depth)
        breakables.push({
          index,
          whole,
          wreck: wreckId && models.has(wreckId) ? queueBatch(wreckId, placement, true) : null,
          center: new THREE.Vector3(center.x, 0, center.z),
          yaw: landmarkYaw(placement.id, placement.facing, placement.column, placement.row),
          broken: false,
          crashes: 0,
          crashAt: -Infinity,
          tilted: false,
          tilt: new THREE.Vector3(1, 0, 0),
        })
      }
      yield
      continue
    }
    if (id && models.has(id)) {
      const motions = def.motion ?? []
      const rule = glowRule(placement.id)
      const fx = LANDMARK_FX[placement.id]
      const lamp = def.lamp ? lampRule(placement.id) : undefined
      const own =
        motions.length > 0 || fades || rule !== undefined || alarmNodes(placement.id).length > 0 || fx?.forge !== undefined || lamp !== undefined
      const model = needsNodes(placement.id) ? (own ? models.instance(id) : models.shared(id)) : mergedModel(models, id, own)
      const center = footprintCenter(placement.column, placement.row, placement.width, placement.depth)
      position(model.root, center, placement.facing)
      if (SHADOWLESS_LANDMARKS.includes(placement.id)) model.root.traverse((object) => (object.castShadow = false))
      group.add(model.root)
      const spinners: Spinner[] = []
      for (const motion of motions) {
        const node = model.nodes.get(motion.node)
        if (node) spinners.push({ node, axis: new THREE.Vector3(...motionAxis(motion.axis)), motion })
      }
      const roof = model.nodes.get(SCENE_NODES.roof) ?? null
      const inside = hiddenInside(placement.id)
        .map((name) => model.nodes.get(name))
        .filter((node): node is THREE.Object3D => node !== undefined)
      const openers: Opener[] = []
      for (const name of def.opens ?? []) {
        const node = model.nodes.get(name)
        if (!node) continue
        const hinge = hingeOf(placement.id, name)
        openers.push({ node, axis: new THREE.Vector3(...hinge.axis), angle: hinge.angle })
      }
      const wreckId = def.breaks ? stateModel(has, placement.id, def.breaks.into) : null
      let wreck: ModelInstance | null = null
      if (wreckId && models.has(wreckId)) {
        wreck = mergedModel(models, wreckId, false)
        position(wreck.root, center, placement.facing)
        wreck.root.visible = false
        group.add(wreck.root)
      }
      const sockets = fx ? socketsOf(id, center, placement.facing, fxSockets(placement.id)) : new Map<string, THREE.Vector3>()
      const forgeAt = fx?.forge ? sockets.get(fx.forge) : undefined
      let forge: Forge | null = null
      if (forgeAt) {
        const material = new THREE.MeshBasicMaterial({
          color: FORGE_FIRE.glow,
          transparent: true,
          opacity: FORGE_FIRE.opacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
        owned.push(material)
        const glow = new THREE.Mesh(ember(), material)
        glow.position.copy(forgeAt)
        glow.scale.setScalar(FORGE_FIRE.size)
        glow.castShadow = false
        group.add(glow)
        forge = {
          at: forgeAt,
          glow,
          heat: model.materials
            .filter((item): item is THREE.MeshStandardMaterial => item instanceof THREE.MeshStandardMaterial && item.name === FORGE_FIRE.material)
            .map((material) => ({ material, base: material.emissiveIntensity })),
          next: 0,
        }
      }
      const smokeAt = fx?.smoke ? sockets.get(fx.smoke) : undefined
      const fallAt = fx?.waterfall ? sockets.get(fx.waterfall) : undefined
      const lampIndex = level.lamps.findIndex((item) => item.landmark === index)
      const lampView =
        lamp && lampIndex >= 0
          ? { rig: createLampRig(model, lamp, group, lampKit(), level.lamps[lampIndex].clears ? LAMP_GLOW.areaRing : FOG.lampRadius, effects), index: lampIndex }
          : null
      const item: PlacedModel = {
        index,
        id: placement.id,
        model,
        owned: own,
        spinners,
        glow: rule ? glowOf(model, rule) : null,
        roof,
        inside,
        margin: hideMargin(placement.id),
        openers,
        opened: 0,
        wreck,
        style: BREAK_STYLES[placement.id] ?? null,
        broken: false,
        hp: def.breaks?.hp ?? 0,
        jolt: 0,
        puffAt: -Infinity,
        crashes: 0,
        crashAt: -Infinity,
        tilt: new THREE.Vector3(1, 0, 0),
        yaw: facingYaw(placement.facing),
        alarm: null,
        forge,
        chimney: smokeAt ? { at: smokeAt, next: 0 } : null,
        lamp: lampView,
        waterfall: fallAt
          ? createWaterfall(
              group,
              fallAt,
              facingYaw(placement.facing),
              level.secrets.filter((secret) => secret.area === placement.area),
            )
          : null,
        center: new THREE.Vector3(center.x, 0, center.z),
        height: def.height,
        column: placement.column,
        row: placement.row,
        width: placement.width,
        depth: placement.depth,
      }
      item.alarm = alarmRig(index, model)
      placed.push(item)
      if (fades) {
        const sweeping = spinners.filter((spinner) => spinner.motion.swing === undefined)
        yield
        const sight = yield* bakeSight(model.root, sweeping, roof)
        fading.push({
          sight,
          roof,
          fader: createFader(model.root, model.materials),
          state: freshFade(),
          owner: item,
        })
      }
      yield
      continue
    }
    if (def.hides) continue
    const palette = PALETTES[level.areas[placement.area].theme]
    const decor = !def.blocksMovement
    const height = decor ? LANDMARK_FALLBACK.decorHeight : Math.min(def.height, LANDMARK_FALLBACK.maxHeight)
    const color = new THREE.Color(decor ? palette.bush : def.blocksShots ? palette.wall : LANDMARK_FALLBACK.lowColor)
    color.offsetHSL(0, 0, decor ? LANDMARK_FALLBACK.decorLighten : -LANDMARK_FALLBACK.solidDarken)
    const cells = placement.cells.map((cell): FallbackCell => {
      const column = cell % columns
      return { column, row: (cell - column) / columns, height, color }
    })
    placeholderCells += cells.length
    if (!fades) {
      fallbackCells.push(...cells)
      continue
    }
    const material = new THREE.MeshStandardMaterial({ color, flatShading: true })
    owned.push(material)
    const mesh = boxMesh(unitBox(), material, cells)
    boxes.push(mesh)
    const holder = new THREE.Group()
    holder.add(mesh)
    group.add(holder)
    fading.push({ sight: boxSight(placement.cells, columns, height), roof: null, fader: createFader(holder, [material]), state: freshFade(), owner: null })
  }

  const matrix = new THREE.Matrix4()
  const turn = new THREE.Quaternion()
  const unit = new THREE.Vector3(1, 1, 1)
  const spot = new THREE.Vector3()
  const tint = new THREE.Color()
  let scatteredCount = 0
  const hiddenScale = new THREE.Vector3(0, 0, 0)
  const shownInstances = new Map<THREE.InstancedMesh, Set<number>>()
  const showInstance = (mesh: THREE.InstancedMesh, instance: number, shown: boolean) => {
    let set = shownInstances.get(mesh)
    if (!set) {
      set = new Set()
      shownInstances.set(mesh, set)
    }
    if (shown) set.add(instance)
    else set.delete(instance)
    mesh.visible = set.size > 0
  }
  for (const [id, list] of scattered) {
    scatteredCount += list.filter((item) => !item.hidden).length
    const chunks = new Map<number, Scattered[]>()
    for (const item of list) {
      const key = chunkOf(item.column, item.row, columns, SCENE_CHUNK.width, SCENE_CHUNK.depth)
      chunks.set(key, [...(chunks.get(key) ?? []), item])
    }
    const single = onePart(models.parts(id))
    const atlas = single ? null : atlasPart(models.parts(id))
    if (single) owned.push(single.geometry)
    if (atlas) owned.push(atlas.geometry, atlas.material, atlas.lookup)
    const parts = single ? [single] : atlas ? [atlas] : models.parts(id)
    for (const items of chunks.values()) {
      items.forEach((item, instance) => {
        const { placement } = item
        spot.set(item.column + placement.width / 2, 0, item.row + placement.depth / 2)
        turn.setFromAxisAngle(UP, landmarkYaw(placement.id, placement.facing, item.column, item.row))
        item.slot.instance = instance
        item.slot.matrix.compose(spot, turn, unit)
      })
      for (const part of parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, items.length)
        items.forEach((item, instance) => {
          mesh.setMatrixAt(instance, item.slot.matrix)
          mesh.setColorAt(instance, tint.setScalar(SCENE_TINT.base + SCENE_TINT.spread * cellHash(item.column, item.row, 3)))
          item.slot.meshes.push(mesh)
        })
        mesh.computeBoundingSphere()
        items.forEach((item, instance) => {
          showInstance(mesh, instance, !item.hidden)
          if (!item.hidden) return
          item.slot.matrix.decompose(spot, turn, unit)
          mesh.setMatrixAt(instance, matrix.compose(spot, turn, hiddenScale))
          unit.set(1, 1, 1)
        })
        mesh.castShadow = castsShadowAs(part.material) && !SHADOWLESS_LANDMARKS.includes(items[0].placement.id)
        mesh.userData.model = id
        batches.push(mesh)
        group.add(mesh)
      }
    }
    yield
  }

  if (fallbackCells.length > 0) {
    const material = new THREE.MeshStandardMaterial({ flatShading: true })
    owned.push(material)
    const mesh = boxMesh(unitBox(), material, fallbackCells)
    fallbackCells.forEach((cell, instance) => mesh.setColorAt(instance, cell.color))
    boxes.push(mesh)
    group.add(mesh)
  }

  const debrisOf = (): Debris => {
    if (!debris) {
      debris = createDebris(LANDMARK_BREAK.debris)
      group.add(debris.mesh)
      owned.push(debris)
    }
    return debris
  }

  const fling = (item: PlacedModel, count: number, color: (index: number) => string, size: [number, number], width: [number, number], push: number, lift: number) => {
    const bits = debrisOf()
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * TAU
      const speed = push * (0.45 + Math.random() * 0.55)
      bits.emit({
        x: item.center.x + scatter(item.width * 0.3),
        y: 0.4 + Math.random() * item.height * 0.5,
        z: item.center.z + scatter(item.depth * 0.3),
        vx: Math.cos(angle) * speed,
        vy: lift * (0.55 + Math.random() * 0.45),
        vz: Math.sin(angle) * speed,
        color: color(i),
        length: size[0] + Math.random() * (size[1] - size[0]),
        width: width[0] + Math.random() * (width[1] - width[0]),
        life: 2.4 + Math.random() * 1.4,
      })
    }
    debrisUntil = Math.max(debrisUntil, clock + 4)
  }

  const shatter = (item: PlacedModel) => {
    const { x, z } = item.center
    if (item.style === 'cart') {
      const style = LANDMARK_BREAK.cart
      fling(item, style.woodBits, (i) => style.wood[i % style.wood.length], [0.16, 0.36], [0.04, 0.08], 3.2, 5)
      fling(item, style.grainBits, () => style.grain, [0.05, 0.08], [0.03, 0.045], 3.8, 5.5)
      fling(item, style.strawBits, () => style.straw, [0.22, 0.4], [0.02, 0.035], 2.6, 4.2)
      for (let i = 0; i < style.puffs; i++) {
        effects?.puff(x + scatter(0.9), 0.5 + Math.random() * 0.9, z + scatter(0.9), i % 2 === 0 ? style.straw : style.grain, 0.3, 1.1, 0.55)
      }
      effects?.burst(x, z, LANDMARK_BREAK.dust, style.burst)
      return
    }
    if (item.style === 'pillar') {
      const style = LANDMARK_BREAK.pillar
      fling(item, style.strawBits, (i) => (i % 4 === 0 ? style.dark : style.straw), [0.2, 0.42], [0.025, 0.045], 3, 5)
      for (let i = 0; i < style.puffs; i++) {
        effects?.puff(x + scatter(1), 0.4 + Math.random() * 1.8, z + scatter(1), style.straw, 0.35, 1.3, 0.7)
      }
      effects?.burst(x, z, LANDMARK_BREAK.dust, style.burst)
      return
    }
    effects?.burst(x, z, LANDMARK_BREAK.dust, 1)
  }

  const spill = (item: PlacedModel, toward: THREE.Vector3) => {
    const C = LANDMARK_CRASH
    const bits = debrisOf()
    const reach = Math.min(item.width, item.depth) * 0.42
    for (let i = 0; i < C.grainBits + C.strawBits; i++) {
      const straw = i >= C.grainBits
      const side = scatter(0.9)
      const speed = 0.8 + Math.random() * 1.6
      bits.emit({
        x: item.center.x + toward.x * reach - toward.z * side,
        y: item.height * (0.45 + Math.random() * 0.4),
        z: item.center.z + toward.z * reach + toward.x * side,
        vx: toward.x * speed + scatter(0.6),
        vy: Math.random() * 1.2,
        vz: toward.z * speed + scatter(0.6),
        color: straw ? C.straw : C.grain,
        length: straw ? 0.2 + Math.random() * 0.18 : 0.05 + Math.random() * 0.03,
        width: straw ? 0.025 : 0.03 + Math.random() * 0.015,
        life: 2.6 + Math.random() * 1.2,
      })
    }
    debrisUntil = Math.max(debrisUntil, clock + 4)
    for (let i = 0; i < C.puffs; i++) {
      const side = scatter(1)
      effects?.puff(item.center.x + toward.x * reach * 1.2 - toward.z * side, 0.25 + Math.random() * 0.5, item.center.z + toward.z * reach * 1.2 + toward.x * side, C.dust, 0.35, 1.2, 0.7)
    }
  }

  const restMatrix = new THREE.Matrix4()
  const placeSlot = (slot: BatchSlot, shown: boolean, pose: THREE.Matrix4 | null) => {
    let target = pose ?? slot.matrix
    if (!shown) {
      slot.matrix.decompose(spot, turn, unit)
      target = restMatrix.compose(spot, turn, hiddenScale)
      unit.set(1, 1, 1)
    }
    for (const mesh of slot.meshes) {
      mesh.setMatrixAt(slot.instance, target)
      mesh.instanceMatrix.needsUpdate = true
      showInstance(mesh, slot.instance, shown)
    }
  }

  const chips = (center: THREE.Vector3, away: THREE.Vector3 | null, count: number, push: number, lift: number) => {
    const bits = debrisOf()
    const heading = away ? Math.atan2(away.z, away.x) : 0
    for (let i = 0; i < count; i++) {
      const angle = away ? heading + scatter(1.2) : Math.random() * TAU
      const speed = push * (0.45 + Math.random() * 0.55)
      bits.emit({
        x: center.x + scatter(0.25),
        y: 0.25 + Math.random() * 0.35,
        z: center.z + scatter(0.25),
        vx: Math.cos(angle) * speed,
        vy: lift * (0.5 + Math.random() * 0.5),
        vz: Math.sin(angle) * speed,
        color: STUMP_CRASH.chips[i % STUMP_CRASH.chips.length],
        length: 0.08 + Math.random() * 0.16,
        width: 0.04 + Math.random() * 0.04,
        life: 2 + Math.random() * 1.2,
      })
    }
    debrisUntil = Math.max(debrisUntil, clock + 4)
  }

  const wobble = new THREE.Quaternion()
  const wobbleYaw = new THREE.Quaternion()
  const wobbleMatrix = new THREE.Matrix4()
  const away = new THREE.Vector3()
  const syncBreakable = (item: BatchedBreak, world: World, fresh: boolean) => {
    const state = world.landmarks[item.index]
    const broken = state?.broken ?? false
    const crashes = state?.crashes ?? 0
    const C = STUMP_CRASH
    if (fresh) {
      item.crashes = crashes
      item.crashAt = -Infinity
    } else if (crashes > item.crashes) {
      item.crashes = crashes
      item.crashAt = clock
      const boss = world.boss
      away.set(boss ? item.center.x - boss.pos.x : 0, 0, boss ? item.center.z - boss.pos.y : -1)
      if (away.lengthSq() < 1e-6) away.set(0, 0, -1)
      away.normalize()
      item.tilt.crossVectors(UP, away).normalize()
      chips(item.center, away, C.chipBits, 2.6, 3.2)
      for (let i = 0; i < C.puffs; i++) {
        effects?.puff(item.center.x - away.x * 0.4 + scatter(0.3), 0.2 + Math.random() * 0.3, item.center.z - away.z * 0.4 + scatter(0.3), C.dust, 0.25, 0.9, 0.6)
      }
    }
    if (broken !== item.broken || fresh) {
      const changed = broken !== item.broken
      item.broken = broken
      placeSlot(item.whole, !broken || !item.wreck, null)
      if (item.wreck) placeSlot(item.wreck, broken, null)
      if (changed && broken && !fresh) {
        chips(item.center, null, C.breakBits, 3.4, 4.6)
        for (let i = 0; i < C.breakPuffs; i++) {
          effects?.puff(item.center.x + scatter(0.5), 0.25 + Math.random() * 0.5, item.center.z + scatter(0.5), C.dust, 0.3, 1.1, 0.75)
        }
        effects?.burst(item.center.x, item.center.z, C.dust, C.burst)
      }
    }
    const since = clock - item.crashAt
    const slot = item.broken && item.wreck ? item.wreck : item.whole
    if (since >= 0 && since < C.seconds) {
      wobble.setFromAxisAngle(item.tilt, C.tilt * Math.exp(-C.decay * since) * Math.sin(C.rate * since))
      wobble.multiply(wobbleYaw.setFromAxisAngle(UP, item.yaw))
      spot.set(item.center.x, 0, item.center.z)
      placeSlot(slot, true, wobbleMatrix.compose(spot, wobble, unit))
      item.tilted = true
    } else if (item.tilted) {
      item.tilted = false
      placeSlot(slot, true, null)
    }
  }

  const showBroken = (item: PlacedModel, broken: boolean, quiet: boolean) => {
    item.broken = broken
    if (item.wreck) {
      item.model.root.visible = !broken
      item.wreck.root.visible = broken
    }
    if (broken && !quiet) shatter(item)
  }

  const look: WaveLook = { visible: false, scale: 1, opacity: 0 }
  const bellAt = new THREE.Vector3()
  const syncAlarm = (rig: AlarmRig, world: World, fresh: boolean, dt: number) => {
    const state = rig.alarm >= 0 ? (world.alarms[rig.alarm] ?? null) : null
    const status = state?.status ?? 'quiet'
    if (fresh) {
      rig.swing = freshSwing()
      rig.rungAt = -Infinity
      if (status === 'rung') rig.swing.amount = ALARM_BELL.rungSwing
    } else if (status === 'rung' && rig.status !== 'rung') rig.rungAt = clock
    rig.status = status
    const angle = stepBell(rig.swing, state, fresh ? 0 : dt)
    if (rig.bell) rotateFromRest(rig.bell, rig.axis, angle)
    const level = lampLevel(state, clock)
    for (const { material, base } of rig.lamp) material.emissiveIntensity = base * level
    const since = clock - rig.rungAt
    if (rig.bell && !wavesDone(since)) socketWorld(rig.bell, bellAt)
    rig.waves.forEach((wave, slot) => {
      const ground = slot >= ALARM_BELL.waves
      waveLook(since, ground ? slot - ALARM_BELL.waves : slot, ALARM_BELL, look)
      wave.visible = look.visible
      if (!look.visible) return
      wave.position.set(bellAt.x, ground ? ALARM_BELL.groundHeight : bellAt.y, bellAt.z)
      wave.scale.setScalar(look.scale)
      wave.material.opacity = look.opacity * (ground ? ALARM_BELL.groundOpacity : 1)
    })
  }

  const near = (item: PlacedModel, world: World, range: number) =>
    Math.hypot(world.player.pos.x - item.center.x, world.player.pos.y - item.center.z) <= range

  const syncForge = (forge: Forge, item: PlacedModel, world: World) => {
    const F = FORGE_FIRE
    const flicker = Math.sin(clock * F.rate) * 0.5 + Math.sin(clock * F.rate * 0.63 + 1.7) * 0.5
    forge.glow.material.opacity = F.opacity * (1 + F.flicker * flicker)
    forge.glow.scale.setScalar(F.size * (1 + 0.12 * flicker))
    for (const { material, base } of forge.heat) material.emissiveIntensity = base * (F.heat + F.flicker * flicker)
    if (clock < forge.next || !near(item, world, CHIMNEY_SMOKE.range)) return
    forge.next = clock + F.sparkGap[0] + Math.random() * (F.sparkGap[1] - F.sparkGap[0])
    const count = 1 + Math.floor(Math.random() * 3)
    for (let i = 0; i < count; i++) {
      effects?.puff(
        forge.at.x + scatter(0.16),
        forge.at.y + 0.05 + Math.random() * 0.2,
        forge.at.z + scatter(0.16),
        Math.random() < 0.5 ? F.hot : F.spark,
        0.035,
        0.012,
        0.45 + Math.random() * 0.35,
        F.sparkRise * (0.6 + Math.random() * 0.8),
      )
    }
  }

  const syncChimney = (chimney: Chimney, item: PlacedModel, world: World) => {
    const S = CHIMNEY_SMOKE
    if (clock < chimney.next || !near(item, world, S.range)) return
    chimney.next = clock + S.gap * (0.8 + Math.random() * 0.4)
    effects?.puff(chimney.at.x + scatter(S.jitter), chimney.at.y + 0.1, chimney.at.z + scatter(S.jitter), S.color, S.from, S.to, S.seconds, S.rise)
  }

  const crashTilt = new THREE.Quaternion()
  const yawTurn = new THREE.Quaternion()
  const toward = new THREE.Vector3()
  const syncCrash = (item: PlacedModel, world: World, fresh: boolean) => {
    const crashes = world.landmarks[item.index]?.crashes ?? 0
    if (fresh) {
      item.crashes = crashes
      item.crashAt = -Infinity
    } else if (crashes > item.crashes) {
      item.crashes = crashes
      item.crashAt = clock
      const boss = world.boss
      toward.set(boss ? boss.pos.x - item.center.x : 0, 0, boss ? boss.pos.y - item.center.z : 1)
      if (toward.lengthSq() < 1e-6) toward.set(0, 0, 1)
      toward.normalize()
      item.tilt.crossVectors(UP, toward).multiplyScalar(-1).normalize()
      spill(item, toward)
    }
    const C = LANDMARK_CRASH
    const since = clock - item.crashAt
    yawTurn.setFromAxisAngle(UP, item.yaw)
    if (since >= 0 && since < C.seconds) {
      crashTilt.setFromAxisAngle(item.tilt, C.tilt * Math.exp(-C.decay * since) * Math.sin(C.rate * since))
      item.model.root.quaternion.copy(crashTilt).multiply(yawTurn)
    } else item.model.root.quaternion.copy(yawTurn)
  }

  shareInstancedDepth([...boxes, ...batches])
  const eye = new THREE.Vector3()
  return {
    group,
    modelCount: placed.length + scatteredCount,
    placeholderCells,
    fadingCount: fading.length,
    batchCount: batches.length,
    update(world, dt) {
      clock += dt
      const fresh = world !== tracked
      tracked = world
      for (const item of placed) {
        const state = world.landmarks[item.index]
        const broken = state?.broken ?? false
        if (broken !== item.broken) showBroken(item, broken, fresh)
        const hp = state?.hp ?? 0
        if (!fresh && hp < item.hp - 1e-6 && !broken) {
          item.jolt = 1
          if (clock - item.puffAt >= LANDMARK_HIT.puffGap) {
            item.puffAt = clock
            effects?.puff(item.center.x + scatter(0.6), LANDMARK_HIT.puffHeight + scatter(0.3), item.center.z + scatter(0.6), LANDMARK_HIT.straw, 0.15, 0.5, 0.35)
          }
        }
        item.hp = hp
        if (fresh) item.jolt = 0
        if (item.jolt > 0) item.jolt = Math.max(0, item.jolt - dt / LANDMARK_HIT.seconds)
        const squash = LANDMARK_HIT.squash * item.jolt
        item.model.root.scale.set(1 + squash, 1 - squash, 1 + squash)
        syncCrash(item, world, fresh)
        for (const spinner of item.spinners) rotateFromRest(spinner.node, spinner.axis, motionAngle(spinner.motion, clock))
        if (item.glow) {
          const level = glowLevel(item.glow.rule, clock)
          for (const { material, base } of item.glow.materials) material.emissiveIntensity = base * level
        }
        if (item.openers.length > 0) {
          const open = state?.open ?? false
          item.opened = fresh ? (open ? 1 : 0) : openProgress(item.opened, open, dt, LANDMARK_OPEN.seconds)
          for (const opener of item.openers) rotateFromRest(opener.node, opener.axis, opener.angle * swingEase(item.opened))
        }
        if (item.roof || item.inside.length > 0) {
          const { x, y } = world.player.pos
          if (item.roof) item.roof.visible = !insideFootprint(x, y, item.column, item.row, item.width, item.depth)
          const { margin } = item
          const near = insideFootprint(x, y, item.column - margin, item.row - margin, item.width + margin * 2, item.depth + margin * 2)
          for (const node of item.inside) node.visible = !near
        }
        if (item.alarm) syncAlarm(item.alarm, world, fresh, dt)
        if (item.forge) syncForge(item.forge, item, world)
        if (item.chimney) syncChimney(item.chimney, item, world)
        if (item.lamp) item.lamp.rig.sync(world.lamps[item.lamp.index] ?? false, fresh, clock)
        item.waterfall?.sync(world, clock, dt, fresh)
      }
      for (const item of breakables) syncBreakable(item, world, fresh)
      if (debris) {
        debris.update(dt)
        debris.mesh.visible = clock < debrisUntil
      }
      if (fading.length === 0) return
      const { player } = world
      cameraEye(player, player.alive && world.status === 'playing', world.tuning.camera, eye)
      for (const item of fading) {
        if (item.owner?.broken && item.owner.wreck) {
          if (item.state.opacity < 1) Object.assign(item.state, freshFade())
          item.fader.set(1)
          continue
        }
        const blocked = hidesPlayer(item.sight, player.pos, eye, !item.roof || item.roof.visible)
        item.fader.set(settleFade(item.state, blocked, dt).opacity)
      }
    },
    dispose,
  }
}
