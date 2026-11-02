import * as THREE from 'three'
import { getBoss } from '../data/bosses'
import type { Tuning } from '../data/tuning'
import type { WeaponId } from '../data/weapons'
import { spawnBlast } from '../sim/combat'
import { fogHides } from '../sim/fog'
import { Tile, blocksMovement, tileAt } from '../sim/grid'
import type { BuiltLevel } from '../sim/level'
import { spawnLob } from '../sim/lobs'
import { spawnPickup } from '../sim/pickups'
import { spawnBullet } from '../sim/projectiles'
import type { GameEvent } from '../sim/types'
import { createEnemy, createWorld, type World } from '../sim/world'
import { WEAPON_MODEL_IDS } from './asset-urls'
import { createDebris } from './boss-debris'
import { createEffects } from './effects'
import { createEntityViews } from './entity-views'
import { hasFog } from './fog-motion'
import { heldFromLibrary } from './kai-model'
import { levelEnemyKinds } from './level-models'
import type { ModelInstance, ModelLibrary } from './model-library'
import { createPickupViews } from './pickup-views'
import { createProjectileViews } from './projectile-views'
import { isShadowOnly } from './shadow-proxies'
import { interleave, sliced, type SliceOptions, type Steps } from './slices'
import type { Stage } from './stage'
import { WARMUP_SLICES } from './themes'

export type RenderPass = 'main' | 'shadow'

export interface ProgramVariant {
  key: string
  pass: RenderPass
  object: THREE.Object3D
  material: THREE.Material
}

export interface WarmupSources {
  level: BuiltLevel
  tuning: Tuning
  models: ModelLibrary
  scene: THREE.Object3D
  landmarks: THREE.Object3D
}

export interface WarmupPlan {
  readonly variants: Map<string, ProgramVariant>
  dispose(): void
}

export interface WarmupPacing {
  budget: SliceOptions['budget']
  wait: number
  poll: number
  hurry(): boolean
}

export interface Warmer {
  warm(sources: WarmupSources, cancelled?: () => boolean): Promise<boolean>
  warmSteps(sources: WarmupSources): Steps<boolean>
  preload(textures: readonly THREE.Texture[], cancelled?: () => boolean): Promise<boolean>
  preloadAlongside<T>(textures: readonly THREE.Texture[], work: Steps<T>, cancelled?: () => boolean): Promise<T | null>
}

type WarmStage = Pick<Stage, 'precompile' | 'settleProgram' | 'preload' | 'holdUpload'>

const MAP_SLOTS = [
  'map',
  'alphaMap',
  'lightMap',
  'aoMap',
  'bumpMap',
  'normalMap',
  'displacementMap',
  'emissiveMap',
  'metalnessMap',
  'roughnessMap',
  'specularMap',
  'gradientMap',
  'matcap',
] as const

const SHADOW_SIDES: Readonly<Record<THREE.Side, THREE.Side>> = {
  [THREE.FrontSide]: THREE.BackSide,
  [THREE.BackSide]: THREE.FrontSide,
  [THREE.DoubleSide]: THREE.DoubleSide,
}

const shaderKeepers = new Map<string, THREE.ShaderMaterial>()

const DEFEAT_STEP = 0.25
const DEFEAT_SECONDS = 9
const REHEARSAL_EVENTS: readonly GameEvent[] = [
  { type: 'shockwave', x: 0, y: 0, radius: 2 },
  { type: 'barrierBroken', x: 0, y: 0, radius: 2 },
  { type: 'ultimateFired', x: 0, y: 0 },
  { type: 'chain', fromX: 0, fromY: 0, toX: 1, toY: 1 },
]

type Drawable = THREE.Mesh | THREE.Sprite | THREE.Points | THREE.Line

function drawable(object: THREE.Object3D): object is Drawable {
  const item = object as { isMesh?: boolean; isSprite?: boolean; isPoints?: boolean; isLine?: boolean }
  return Boolean(item.isMesh || item.isSprite || item.isPoints || item.isLine)
}

function materialsOf(object: Drawable): THREE.Material[] {
  return Array.isArray(object.material) ? object.material : [object.material]
}

function textureSlot(value: unknown): string {
  if (!(value instanceof THREE.Texture)) return '-'
  return `${value.channel}${(value as { isVideoTexture?: boolean }).isVideoTexture ? 'v' : ''}`
}

const PLAIN_PROGRAM = THREE.Material.prototype.onBeforeCompile.toString()

function programKey(material: THREE.Material): string {
  const key = material.customProgramCacheKey()
  return key === PLAIN_PROGRAM ? '' : `+${key}`
}

function shaderKey(material: THREE.Material): string {
  if (!(material instanceof THREE.ShaderMaterial)) return material.type
  const source = `${material.vertexShader}|${material.fragmentShader}|${JSON.stringify(material.defines ?? {})}`
  let hash = 0
  for (let i = 0; i < source.length; i++) hash = (Math.imul(hash, 31) + source.charCodeAt(i)) | 0
  return `${material.type}#${(hash >>> 0).toString(36)}`
}

function sidesOf(material: THREE.Material): THREE.Side[] {
  if (material.transparent && material.side === THREE.DoubleSide && !material.forceSinglePass) return [THREE.BackSide, THREE.FrontSide]
  return [material.side]
}

export function variantKey(object: THREE.Object3D, material: THREE.Material, side: THREE.Side = material.side): string {
  const geometry = (object as THREE.Mesh).geometry as THREE.BufferGeometry | undefined
  const attributes = geometry?.attributes ?? {}
  const color = attributes.color as THREE.BufferAttribute | undefined
  const fields = material as unknown as Record<string, unknown>
  const lit = material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshLambertMaterial || material instanceof THREE.MeshPhongMaterial
  const normalMap = Boolean(fields.normalMap)
  const instanced = (object as THREE.InstancedMesh).isInstancedMesh === true
  return [
    shaderKey(material) + programKey(material),
    MAP_SLOTS.map((slot) => textureSlot(fields[slot])).join(''),
    fields.envMap ? 'env' : '',
    material.alphaTest > 0 ? 'at' : '',
    material.alphaHash ? 'ah' : '',
    material.alphaToCoverage ? 'a2c' : '',
    material.transparent === false && material.blending === THREE.NormalBlending && !material.alphaToCoverage ? 'opaque' : 'blend',
    material.premultipliedAlpha ? 'pma' : '',
    material.dithering ? 'dither' : '',
    material.vertexColors ? 'vc' : '',
    material.vertexColors && color?.itemSize === 4 ? 'va' : '',
    fields.flatShading === true || (lit && !attributes.normal && !normalMap) ? 'flat' : '',
    fields.fog === true ? 'fog' : '',
    fields.sizeAttenuation === true ? 'size' : '',
    fields.wireframe === true ? 'wire' : '',
    typeof fields.depthPacking === 'number' ? `dp${fields.depthPacking}` : '',
    side === THREE.DoubleSide ? 'double' : side === THREE.BackSide ? 'back' : 'front',
    instanced ? 'inst' : '',
    instanced && (object as THREE.InstancedMesh).instanceColor ? 'icolor' : '',
    instanced && (object as THREE.InstancedMesh).morphTexture ? 'imorph' : '',
    (object as THREE.SkinnedMesh).isSkinnedMesh ? 'skin' : '',
    (object as THREE.Points).isPoints ? 'points' : '',
    (object as THREE.Sprite).isSprite ? 'sprite' : '',
    (object as THREE.Line).isLine ? 'line' : '',
    attributes.normal ? 'n' : '',
    attributes.tangent && (normalMap || (fields.anisotropy as number) > 0) ? 't' : '',
    geometry?.morphAttributes.position ? 'mp' : '',
    geometry?.morphAttributes.normal ? 'mn' : '',
    geometry?.morphAttributes.color ? 'mc' : '',
  ].join('/')
}

export function depthMaterialFor(object: THREE.Object3D, material: THREE.Material): THREE.MeshDepthMaterial {
  const custom = object.customDepthMaterial
  const result = custom instanceof THREE.MeshDepthMaterial ? custom.clone() : new THREE.MeshDepthMaterial()
  const fields = material as unknown as Record<string, unknown>
  const target = result as unknown as Record<string, unknown>
  const assign = (key: string, value: unknown) => {
    const locked = custom && typeof Object.getOwnPropertyDescriptor(custom, key)?.get === 'function'
    target[key] = locked ? (custom as unknown as Record<string, unknown>)[key] : value
  }
  assign('side', material.shadowSide ?? SHADOW_SIDES[material.side])
  assign('alphaMap', fields.alphaMap ?? null)
  assign('alphaTest', material.alphaToCoverage ? 0.5 : material.alphaTest)
  assign('map', fields.map ?? null)
  assign('displacementMap', fields.displacementMap ?? null)
  assign('wireframe', fields.wireframe === true)
  return result
}

function castsInto(object: Drawable, material: THREE.Material): object is THREE.Mesh {
  return object.castShadow && material.visible && (object as THREE.Mesh).isMesh === true
}

interface FoundVariant {
  key: string
  pass: RenderPass
  material: THREE.Material
}

function* variantsOf(object: THREE.Object3D, known: (key: string) => boolean): Generator<FoundVariant> {
  if (!drawable(object)) return
  const shown = !isShadowOnly(object)
  for (const material of materialsOf(object)) {
    for (const side of shown ? sidesOf(material) : []) {
      const key = `main:${variantKey(object, material, side)}`
      if (!known(key)) yield { key, pass: 'main', material }
    }
    if (!castsInto(object, material)) continue
    const depth = depthMaterialFor(object, material)
    const key = `shadow:${variantKey(object, depth)}`
    if (known(key)) depth.dispose()
    else yield { key, pass: 'shadow', material: depth }
  }
}

export function addVariants(object: THREE.Object3D, into: Map<string, ProgramVariant>): void {
  for (const { key, pass, material } of variantsOf(object, (key) => into.has(key))) into.set(key, { key, pass, object, material })
}

export function collectVariants(root: THREE.Object3D, into: Map<string, ProgramVariant> = new Map()): Map<string, ProgramVariant> {
  root.traverse((object) => addVariants(object, into))
  return into
}

function keeperMesh(source: THREE.Mesh, material: THREE.Material, tinted = true): THREE.Mesh {
  if (!(source instanceof THREE.InstancedMesh)) return new THREE.Mesh(source.geometry, material)
  const mesh = new THREE.InstancedMesh(source.geometry, material, 1)
  if (tinted && source.instanceColor) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3), 3)
  return mesh
}

function keeperOf(object: THREE.Object3D, material: THREE.Material): THREE.Object3D {
  if ((object as THREE.Sprite).isSprite) return new THREE.Sprite(material as THREE.SpriteMaterial)
  if ((object as THREE.Points).isPoints) return new THREE.Points((object as THREE.Points).geometry, material)
  if ((object as THREE.Line).isLine) return new THREE.Line((object as THREE.Line).geometry, material)
  return keeperMesh(object as THREE.Mesh, material)
}

class Stamp {
  private readonly values: unknown[] = []
  private index = 0
  private changed = false

  begin(): void {
    this.index = 0
    this.changed = false
  }

  put(value: unknown): void {
    if (this.values[this.index] !== value) {
      this.values[this.index] = value
      this.changed = true
    }
    this.index += 1
  }

  end(): boolean {
    if (this.values.length !== this.index) {
      this.values.length = this.index
      this.changed = true
    }
    return this.changed
  }
}

function shapeOf(geometry: THREE.BufferGeometry | undefined): number {
  if (!geometry) return -1
  const { attributes, morphAttributes } = geometry
  const color = attributes.color as THREE.BufferAttribute | undefined
  return (
    (attributes.normal ? 1 : 0) |
    (attributes.tangent ? 2 : 0) |
    ((color?.itemSize ?? 0) << 2) |
    (morphAttributes.position ? 32 : 0) |
    (morphAttributes.normal ? 64 : 0) |
    (morphAttributes.color ? 128 : 0)
  )
}

function stampMaterial(stamp: Stamp, material: THREE.Material): void {
  stamp.put(material)
  stamp.put(material.version)
  stamp.put(material.visible)
  stamp.put(material.side)
  stamp.put(material.shadowSide)
  stamp.put(material.transparent)
  stamp.put(material.alphaTest)
}

function restamp(stamp: Stamp, object: Drawable): boolean {
  const mesh = object as THREE.InstancedMesh
  const depth = object.customDepthMaterial
  stamp.begin()
  stamp.put(mesh.geometry)
  stamp.put(shapeOf(mesh.geometry))
  stamp.put(object.castShadow)
  stamp.put(object.layers.mask)
  stamp.put(mesh.instanceColor ?? null)
  stamp.put(mesh.morphTexture ?? null)
  stamp.put(depth ?? null)
  stamp.put(depth?.version ?? -1)
  const { material } = object
  if (Array.isArray(material)) for (const item of material) stampMaterial(stamp, item)
  else stampMaterial(stamp, material)
  return stamp.end()
}

export interface Capture {
  readonly variants: Map<string, ProgramVariant>
  look(object: THREE.Object3D): void
  capture(root: THREE.Object3D): void
}

export function createCapture(): Capture {
  const variants = new Map<string, ProgramVariant>()
  const stamps = new WeakMap<THREE.Object3D, Stamp>()
  const known = (key: string) => variants.has(key)
  const look = (object: THREE.Object3D) => {
    if (!drawable(object)) return
    let stamp = stamps.get(object)
    if (!stamp) {
      stamp = new Stamp()
      stamps.set(object, stamp)
    }
    if (!restamp(stamp, object)) return
    for (const found of variantsOf(object, known)) {
      const material = found.pass === 'main' ? found.material.clone() : found.material
      const keeper = found.pass === 'main' ? keeperOf(object, material) : keeperMesh(object as THREE.Mesh, material)
      variants.set(found.key, { key: found.key, pass: found.pass, object: keeper, material })
    }
  }
  return { variants, look, capture: (root) => root.traverse(look) }
}

function* walk(root: THREE.Object3D, visit: (object: THREE.Object3D) => void, every: number): Steps<void> {
  const stack: THREE.Object3D[] = [root]
  let visited = 0
  while (stack.length > 0) {
    const object = stack.pop() as THREE.Object3D
    visit(object)
    for (let i = object.children.length - 1; i >= 0; i--) stack.push(object.children[i])
    visited += 1
    if (visited % every === 0) yield
  }
}

function hiddenSpot(world: World): { x: number; y: number } | null {
  if (!hasFog(world.level)) return null
  const { grid } = world
  for (let row = 0; row < grid.rows; row++) {
    for (let column = 0; column < grid.columns; column++) {
      if (blocksMovement(tileAt(grid, column, row))) continue
      if (fogHides(world, column + 0.5, row + 0.5)) return { x: column + 0.5, y: row + 0.5 }
    }
  }
  return null
}

function areaAt(world: World, y: number): number {
  const rows = world.level.areaOfRow
  return rows[Math.max(0, Math.min(rows.length - 1, Math.floor(y)))]
}

function fadeOf(mesh: THREE.Mesh, material: THREE.Material): THREE.Mesh {
  const copy = material.clone()
  copy.transparent = true
  copy.depthWrite = false
  copy.shadowSide = material.side
  const keeper = keeperMesh(mesh, copy)
  keeper.castShadow = mesh.castShadow
  return keeper
}

function fadesOf(object: THREE.Object3D, twins: Map<THREE.Side, THREE.MeshBasicMaterial>): THREE.Mesh[] {
  const mesh = object as THREE.Mesh
  if (!mesh.isMesh || isShadowOnly(mesh) || (mesh instanceof THREE.InstancedMesh && mesh.instanceColor)) return []
  const list = materialsOf(mesh)
  if (list.some((material) => material instanceof THREE.ShaderMaterial)) return []
  const keepers = list.map((material) => fadeOf(mesh, material))
  if (list.some((material) => material.transparent || material.alphaTest > 0)) return keepers
  let twin = twins.get(list[0].side)
  if (!twin) {
    twin = new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true, depthWrite: true, side: list[0].side })
    twins.set(list[0].side, twin)
  }
  keepers.push(keeperMesh(mesh, twin, false))
  return keepers
}

export function fadeKeepers(root: THREE.Object3D): THREE.Mesh[] {
  const keepers: THREE.Mesh[] = []
  const twins = new Map<THREE.Side, THREE.MeshBasicMaterial>()
  root.traverse((object) => keepers.push(...fadesOf(object, twins)))
  return keepers
}

function* captureFades(root: THREE.Object3D, look: (object: THREE.Object3D) => void, every: number): Steps<void> {
  const meshes: THREE.Object3D[] = []
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshes.push(object)
  })
  const twins = new Map<THREE.Side, THREE.MeshBasicMaterial>()
  try {
    for (let i = 0; i < meshes.length; i++) {
      for (const keeper of fadesOf(meshes[i], twins)) {
        look(keeper)
        const material = keeper.material as THREE.Material
        if (twins.get(material.side) !== material) material.dispose()
      }
      if ((i + 1) % every === 0) yield
    }
  } finally {
    for (const twin of twins.values()) twin.dispose()
  }
}

function offstage(scene: THREE.Scene): Stage {
  return { scene, addTrauma: () => {} } as unknown as Stage
}

export function* rehearse(level: BuiltLevel, tuning: Tuning, models: ModelLibrary, scene: THREE.Scene, capture: (root: THREE.Object3D) => void): Steps<void> {
  const stage = offstage(scene)
  const effects = createEffects(scene)
  const views = createEntityViews(stage, tuning, effects, { showSight: false }, models)
  const pickups = createPickupViews(scene, models)
  const projectiles = createProjectileViews(scene, models, effects)
  const debris = [createDebris(1), createDebris(1)]
  const held: ModelInstance[] = []
  try {
    yield
    const world = createWorld(level, tuning, { seed: 1, debug: { invincible: true } })
    const { player } = world
    const sync = (dt: number) => {
      views.sync(world, 1, dt)
      pickups.sync(world, dt)
      projectiles.sync(world, 1, dt)
      effects.update(dt)
      capture(scene)
    }
    sync(0)
    yield
    const spots = [{ x: player.pos.x, y: player.pos.y }]
    const hidden = hiddenSpot(world)
    if (hidden) spots.push(hidden)
    for (const kind of levelEnemyKinds(level)) {
      let first = true
      for (const spot of spots) {
        for (const affixes of [[], ['tough'] as const]) {
          world.enemies.push(createEnemy(world, kind, spot, areaAt(world, spot.y), { affixes }))
          if (!first) continue
          first = false
          sync(0)
          yield
        }
      }
      sync(0)
      yield
    }
    const minions = world.enemies.filter((enemy) => enemy.kind !== 'boss')
    if (minions[0]) minions[0].status.frozen = 1
    if (minions[1]) minions[1].status.stunned = 1
    if (minions[2]) minions[2].status.burn = 1
    world.spawns.push({ id: world.nextId++, pos: { ...player.pos }, remaining: 1, total: 2, kind: 'grunt', area: areaAt(world, player.pos.y), summoned: false })
    const blast = { x: player.pos.x, y: player.pos.y, radius: 2, delay: 1, playerDamage: 0, enemyDamage: 0, source: 'boss' as const, ownerId: 0 }
    spawnBlast(world, blast)
    spawnBlast(world, { ...blast, inner: 1, gapWidth: 0.5 })
    spawnBlast(world, { ...blast, arcWidth: 1 })
    const boss = world.boss?.boss ?? null
    if (boss && getBoss(boss.id).mines) world.mines.push({ id: world.nextId++, pos: { ...player.pos }, age: 1, fuse: 0.5, blast: 0, cause: null, owner: boss.id, attack: null })
    sync(0)
    yield
    spawnPickup(world, { type: 'heal', amount: 1 }, player.pos.x, player.pos.y, { persistent: true })
    spawnPickup(world, { type: 'ammo' }, player.pos.x, player.pos.y, { persistent: true })
    spawnPickup(world, { type: 'buff', buff: 'might' }, player.pos.x, player.pos.y, { persistent: true })
    for (const weapon of WEAPON_MODEL_IDS) spawnPickup(world, { type: 'weapon', weapon, ammo: 1 }, player.pos.x, player.pos.y, { persistent: true })
    world.clues.push({ id: world.clues.length, clue: level.clues[0]?.id ?? 'star-altar', pos: { ...player.pos }, area: areaAt(world, player.pos.y), taken: false })
    const crate = world.grid.tiles.indexOf(Tile.Crate)
    if (crate >= 0) world.grid.tiles[crate] = Tile.Floor
    sync(0)
    yield
    const weapons = Object.keys(tuning.weapons) as WeaponId[]
    for (const team of ['player', 'enemy'] as const) {
      for (const weapon of weapons) {
        spawnBullet(world, team, player.pos.x, player.pos.y, 0.5, 0, weapon)
        projectiles.sync(world, 1, 0)
        capture(scene)
        yield
      }
      sync(0)
      yield
      for (const weapon of weapons) {
        spawnLob(world, team, player.pos, { x: player.pos.x + 3, y: player.pos.y }, weapon)
        projectiles.sync(world, 1, 0)
        capture(scene)
        yield
      }
      sync(0)
      yield
    }
    for (const event of REHEARSAL_EVENTS) projectiles.handle(event)
    effects.puff(player.pos.x, 0.5, player.pos.y, '#ffffff', 0.2, 0.4, 1)
    for (const bits of debris) {
      bits.emit({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, color: '#ffffff', length: 0.2, width: 0.1, life: 1 })
      scene.add(bits.mesh)
    }
    debris[1].fade(0.5)
    for (const supply of world.supplies) supply.used = true
    sync(0)
    yield
    if (world.boss?.boss) {
      world.boss.boss.phase = 'stunned'
      sync(0)
      yield
      world.boss.hp = 0
      for (let elapsed = 0; elapsed < DEFEAT_SECONDS; elapsed += DEFEAT_STEP) {
        world.time += DEFEAT_STEP
        sync(DEFEAT_STEP)
        yield
      }
    }
    for (const weapon of WEAPON_MODEL_IDS) {
      if (!models.has(weapon)) continue
      const model = heldFromLibrary(models, weapon)
      held.push(model)
      scene.add(model.root)
      capture(model.root)
      yield
    }
    for (const id of models.ids()) {
      const model = models.shared(id)
      scene.add(model.root)
      capture(model.root)
      yield
    }
    capture(scene)
  } finally {
    views.reset()
    pickups.reset()
    projectiles.reset()
    effects.clear()
    for (const bits of debris) bits.dispose()
    for (const model of held) model.dispose()
    scene.clear()
  }
}

export function* planWarmup(sources: WarmupSources): Steps<WarmupPlan> {
  const { variants, look, capture } = createCapture()
  let planned = false
  try {
    yield* walk(sources.scene, look, WARMUP_SLICES.objectsPerStep)
    yield
    yield* captureFades(sources.landmarks, look, WARMUP_SLICES.fadesPerStep)
    yield
    yield* rehearse(sources.level, sources.tuning, sources.models, new THREE.Group() as unknown as THREE.Scene, capture)
    planned = true
    return {
      variants,
      dispose() {
        for (const variant of variants.values()) {
          const { material } = variant
          const source = material instanceof THREE.ShaderMaterial ? `${material.vertexShader}|${material.fragmentShader}` : null
          if (source !== null && !shaderKeepers.has(source)) shaderKeepers.set(source, material as THREE.ShaderMaterial)
          else material.dispose()
        }
      },
    }
  } finally {
    if (!planned) for (const variant of variants.values()) variant.material.dispose()
  }
}

export function* warmSteps(stage: Pick<Stage, 'precompile' | 'settleProgram'>, sources: WarmupSources, poll: number): Steps<boolean> {
  const plan = yield* planWarmup(sources)
  try {
    for (const variant of plan.variants.values()) {
      stage.precompile(variant.object, variant.pass)
      yield
    }
  } finally {
    plan.dispose()
  }
  for (let state = stage.settleProgram(); state !== 'none'; state = stage.settleProgram()) yield state === 'linking' ? poll : undefined
  return true
}

function* uploadSteps(stage: Pick<Stage, 'preload' | 'holdUpload'>, textures: readonly THREE.Texture[], poll: number, paced: () => boolean): Steps<boolean> {
  for (const texture of textures) {
    while (paced() && stage.holdUpload(texture)) yield poll
    stage.preload(texture)
    yield
  }
  return true
}

export function createWarmer(stage: WarmStage, pacing: WarmupPacing): Warmer {
  const options = (cancelled: () => boolean): SliceOptions => ({ budget: pacing.budget, wait: pacing.wait, hurry: pacing.hurry, cancelled })
  return {
    async warm(sources, cancelled = () => false) {
      return (await sliced(warmSteps(stage, sources, pacing.poll), options(cancelled))) === true
    },
    warmSteps: (sources) => warmSteps(stage, sources, pacing.poll),
    async preload(textures, cancelled = () => false) {
      return (await sliced(uploadSteps(stage, textures, pacing.poll, () => !pacing.hurry()), options(cancelled))) === true
    },
    async preloadAlongside(textures, work, cancelled = () => false) {
      const done = await sliced(interleave(uploadSteps(stage, textures, pacing.poll, () => true), work), options(cancelled))
      return done === null ? null : done[1]
    },
  }
}

export function sceneTextures(root: THREE.Object3D): THREE.Texture[] {
  const found = new Set<THREE.Texture>()
  root.traverse((object) => {
    if (!drawable(object)) return
    for (const material of materialsOf(object)) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) found.add(value)
      if (!(material instanceof THREE.ShaderMaterial)) continue
      for (const uniform of Object.values(material.uniforms)) if (uniform.value instanceof THREE.Texture) found.add(uniform.value)
    }
  })
  return [...found]
}
