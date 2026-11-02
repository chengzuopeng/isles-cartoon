import * as THREE from 'three'
import { HEAL_LARGE, PICKUP_BLINK } from '../data/loot'
import type { PlayerWeaponId } from '../data/weapons'
import { lerp } from '../sim/math'
import type { Chest, ClueDrop, Pickup, Supply } from '../sim/types'
import { floorAt } from '../sim/grid'
import type { World } from '../sim/world'
import { assetUrl } from './asset-urls'
import { createCrateDebris } from './crate-debris'
import { hasFog } from './fog-motion'
import { rotateFromRest, type ModelInstance, type ModelLibrary } from './model-library'
import { groundWeaponScale, groundWeaponYaw, lidAngle, lidOpen, propHash, spentGlow } from './prop-motion'
import { facingYaw } from './scene-models'
import { AMMO_COLOR, BUFF_COLORS, CAMPFIRE_FLAME, CHEST_COLORS, CLUE_PAPER, FOG_LAYER, GROUND_WEAPON, HEAL_COLOR, PERCH_DROP, WEAPON_GLOW } from './themes'

interface PickupView {
  root: THREE.Group
  spin: THREE.Group
  swings: boolean
  seen: boolean
  height: number
}

interface Shine {
  material: THREE.MeshStandardMaterial
  base: number
}

interface ChestView {
  root: THREE.Group
  lid: THREE.Object3D | null
  hinge: THREE.Vector3
  lidScale: number
  glow: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  shines: Shine[]
  model: ModelInstance | null
  openedAt: number | null
  seen: boolean
}

interface Charred {
  material: THREE.MeshStandardMaterial
  color: THREE.Color
}

interface SupplyView {
  root: THREE.Group
  flame: THREE.Group
  outer: THREE.Mesh
  inner: THREE.Mesh
  fresh: THREE.Object3D
  burnt: THREE.Object3D | null
  charred: Charred[]
  models: ModelInstance[]
  owned: THREE.Material[]
  used: boolean | null
  seen: boolean
}

interface ClueView {
  root: THREE.Group
  paper: THREE.Group
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  seen: boolean
}

export interface PickupViews {
  sync(world: World, dt: number): void
  reset(): void
}

const POP_TIME = 0.3
const POP_HEIGHT = 1.1
const FLOAT_HEIGHT = 0.55
const BLINK_RATE = 8
const FALLBACK_LID_OPEN = -1.9
const ICON_SIZE = 0.72
const X_AXIS = new THREE.Vector3(1, 0, 0)
const Z_AXIS = new THREE.Vector3(0, 0, 1)
const WOOD_MATERIALS = /^mat_(wood|decal)/

export function createPickupViews(scene: THREE.Scene, models: ModelLibrary): PickupViews {
  const standardCache = new Map<string, THREE.MeshStandardMaterial>()
  const basicCache = new Map<string, THREE.MeshBasicMaterial>()
  const standard = (color: string, glow = 0.45) => {
    const key = `${color}:${glow}`
    let material = standardCache.get(key)
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: glow, flatShading: true })
      standardCache.set(key, material)
    }
    return material
  }
  const basic = (color: string, opacity: number) => {
    const key = `${color}:${opacity}`
    let material = basicCache.get(key)
    if (!material) {
      material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
      basicCache.set(key, material)
    }
    return material
  }

  const loader = new THREE.TextureLoader()
  const iconCache = new Map<string, THREE.SpriteMaterial>()
  const iconMaterial = (url: string) => {
    let material = iconCache.get(url)
    if (!material) {
      const texture = loader.load(url)
      texture.colorSpace = THREE.SRGBColorSpace
      material = new THREE.SpriteMaterial({ map: texture, alphaTest: 0.08 })
      iconCache.set(url, material)
    }
    return material
  }
  const iconSprite = (url: string, width: number, height: number) => {
    const sprite = new THREE.Sprite(iconMaterial(url))
    sprite.scale.set(width, height, 1)
    return sprite
  }
  const ring = new THREE.RingGeometry(0.3, 0.4, 32)
  const chestBody = new THREE.BoxGeometry(0.8, 0.46, 0.58)
  const chestLid = new THREE.BoxGeometry(0.82, 0.16, 0.6)
  const chestBand = new THREE.BoxGeometry(0.1, 0.48, 0.6)
  const chestGlow = new THREE.RingGeometry(0.55, 0.68, 40)
  const claspGeometry = new THREE.BoxGeometry(0.14, 0.14, 0.06)
  const stone = new THREE.DodecahedronGeometry(0.11, 0)
  const log = new THREE.CylinderGeometry(0.07, 0.07, 0.6, 6)
  const stoneMaterial = new THREE.MeshStandardMaterial({ color: '#8d8a84', flatShading: true })
  const flameGeometry = (radius: number, height: number) => new THREE.ConeGeometry(radius, height, 10).translate(0, height / 2, 0)
  const outerFlameGeometry = flameGeometry(CAMPFIRE_FLAME.outer.radius, CAMPFIRE_FLAME.outer.height)
  const innerFlameGeometry = flameGeometry(CAMPFIRE_FLAME.inner.radius, CAMPFIRE_FLAME.inner.height)
  const flameMaterial = (style: { color: string; opacity: number }) =>
    new THREE.MeshBasicMaterial({ color: style.color, transparent: true, opacity: style.opacity, depthWrite: false })
  const outerFlameMaterial = flameMaterial(CAMPFIRE_FLAME.outer)
  const innerFlameMaterial = flameMaterial(CAMPFIRE_FLAME.inner)

  const paperGeometry = new THREE.PlaneGeometry(CLUE_PAPER.width / 2, CLUE_PAPER.height)
  const inkGeometry = new THREE.PlaneGeometry(CLUE_PAPER.width * 0.34, 0.018)
  const sealGeometry = new THREE.CircleGeometry(0.045, 16)
  const clueRing = new THREE.RingGeometry(0.36, 0.46, 36)
  const beamGeometry = new THREE.CylinderGeometry(CLUE_PAPER.beamRadius, CLUE_PAPER.beamRadius * 0.6, CLUE_PAPER.beamHeight, 18, 1, true).translate(0, CLUE_PAPER.beamHeight / 2, 0)
  const beamMaterial = new THREE.MeshBasicMaterial({
    color: CLUE_PAPER.beam,
    transparent: true,
    opacity: CLUE_PAPER.beamOpacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  })
  const paperMaterial = new THREE.MeshStandardMaterial({
    color: CLUE_PAPER.color,
    emissive: CLUE_PAPER.glow,
    emissiveIntensity: CLUE_PAPER.glowBase,
    side: THREE.DoubleSide,
  })
  const inkMaterial = new THREE.MeshBasicMaterial({ color: CLUE_PAPER.ink, side: THREE.DoubleSide })
  const sealMaterial = new THREE.MeshBasicMaterial({ color: CLUE_PAPER.seal, side: THREE.DoubleSide })
  let world: World | null = null
  let foggy = false
  const layer = (root: THREE.Object3D) => {
    if (!foggy) return
    root.traverse((object) => {
      if ((object as THREE.Group).isGroup) object.renderOrder = FOG_LAYER.under
    })
  }
  const perchHeight = (pickup: Pickup): number => {
    for (const chest of world?.chests ?? []) {
      const perch = chest.perch
      if (perch && Math.hypot(perch.x - pickup.from.x, perch.y - pickup.from.y) < 0.05) return perch.height
    }
    return 0
  }
  const pickups = new Map<number, PickupView>()
  const chests = new Map<number, ChestView>()
  const supplies = new Map<number, SupplyView>()
  const clues = new Map<number, ClueView>()
  const debris = createCrateDebris(scene, models)

  function flat<T extends THREE.Object3D>(object: T, height: number): T {
    object.rotation.x = -Math.PI / 2
    object.position.y = height
    return object
  }

  function groundWeapon(weapon: PlayerWeaponId): THREE.Object3D | null {
    if (!models.has(weapon)) return null
    const model = models.shared(weapon)
    const box = models.bounds(weapon)
    model.root.position.copy(box.getCenter(new THREE.Vector3())).negate()
    const scaled = new THREE.Group()
    scaled.scale.setScalar(groundWeaponScale(box.getSize(new THREE.Vector3()).x))
    scaled.add(model.root)
    const tilt = new THREE.Group()
    tilt.rotation.x = -GROUND_WEAPON.tilt
    tilt.add(scaled)
    return tilt
  }

  function buildPickup(pickup: Pickup): PickupView {
    const root = new THREE.Group()
    const spin = new THREE.Group()
    root.add(spin)
    const { item } = pickup
    let tint = WEAPON_GLOW
    let swings = false
    switch (item.type) {
      case 'heal': {
        const size = item.food ? ICON_SIZE * 1.2 : item.amount >= HEAL_LARGE ? ICON_SIZE * 1.35 : ICON_SIZE
        spin.add(iconSprite(assetUrl.item(item.food ? `food-${item.food}` : 'heal'), size, size))
        tint = HEAL_COLOR
        break
      }
      case 'buff':
        tint = BUFF_COLORS[item.buff]
        spin.add(iconSprite(assetUrl.buff(item.buff), ICON_SIZE, ICON_SIZE))
        break
      case 'ammo':
        tint = AMMO_COLOR
        spin.add(iconSprite(assetUrl.item('ammo'), ICON_SIZE, ICON_SIZE))
        break
      case 'weapon': {
        const model = groundWeapon(item.weapon)
        swings = model !== null
        spin.add(model ?? iconSprite(assetUrl.weapon(item.weapon), ICON_SIZE * 1.6, ICON_SIZE * 0.8))
        break
      }
    }
    const base = flat(new THREE.Mesh(ring, basic(tint, 0.55)), 0.03)
    root.add(base)
    layer(root)
    scene.add(root)
    return { root, spin, swings, seen: true, height: 0 }
  }

  function buildFallbackChest(chest: Chest, root: THREE.Group): Pick<ChestView, 'lid' | 'hinge' | 'lidScale'> {
    const colors = CHEST_COLORS[chest.tier]
    const bodyMaterial = standard(colors.body, 0.05)
    const trimMaterial = standard(colors.trim, 0.35)
    const body = new THREE.Mesh(chestBody, bodyMaterial)
    body.position.y = 0.23
    body.castShadow = true
    const left = new THREE.Mesh(chestBand, trimMaterial)
    left.position.set(-0.26, 0.24, 0)
    const right = left.clone()
    right.position.x = 0.26
    const lid = new THREE.Group()
    lid.position.set(0, 0.46, -0.3)
    const top = new THREE.Mesh(chestLid, bodyMaterial)
    top.position.set(0, 0.08, 0.3)
    top.castShadow = true
    const clasp = new THREE.Mesh(claspGeometry, trimMaterial)
    clasp.position.set(0, 0.02, 0.61)
    lid.add(top, clasp)
    root.add(body, left, right, lid)
    return { lid, hinge: X_AXIS, lidScale: FALLBACK_LID_OPEN / lidAngle(1) }
  }

  function buildChest(chest: Chest): ChestView {
    const colors = CHEST_COLORS[chest.tier]
    const root = new THREE.Group()
    const id = `chest-${chest.tier}`
    let model: ModelInstance | null = null
    let parts: Pick<ChestView, 'lid' | 'hinge' | 'lidScale'>
    if (models.has(id)) {
      model = models.instance(id)
      const holder = new THREE.Group()
      holder.rotation.y = -Math.PI / 2
      holder.add(model.root)
      root.add(holder)
      parts = { lid: model.nodes.get('lid') ?? null, hinge: Z_AXIS, lidScale: 1 }
    } else {
      parts = buildFallbackChest(chest, root)
    }
    const shines = model ? [...model.glow.values()].map((material) => ({ material, base: material.emissiveIntensity })) : []
    const glow = flat(new THREE.Mesh(chestGlow, new THREE.MeshBasicMaterial({ color: colors.trim, transparent: true, opacity: 0.6, depthWrite: false })), 0.03)
    root.add(glow)
    const perch = chest.perch
    if (perch) {
      root.position.set(perch.x, perch.height, perch.y)
      const facing = world?.level.landmarks[perch.landmark]?.facing ?? 0
      root.rotation.y = facingYaw(facing) - facingYaw(0)
    } else root.position.set(chest.pos.x, world ? floorAt(world.grid, chest.pos.x, chest.pos.y) : 0, chest.pos.y)
    layer(root)
    scene.add(root)
    return { root, ...parts, glow, shines, model, openedAt: chest.opened ? -Infinity : null, seen: true }
  }

  function charredOf(materials: readonly THREE.Material[]): Charred[] {
    return materials
      .filter((material): material is THREE.MeshStandardMaterial => material instanceof THREE.MeshStandardMaterial && WOOD_MATERIALS.test(material.name))
      .map((material) => ({ material, color: material.color.clone() }))
  }

  function buildFallbackCampfire(root: THREE.Group): { fresh: THREE.Group; charred: Charred[]; owned: THREE.Material[] } {
    const fresh = new THREE.Group()
    for (let i = 0; i < 7; i++) {
      const angle = (i / 7) * Math.PI * 2
      const rock = new THREE.Mesh(stone, stoneMaterial)
      rock.position.set(Math.cos(angle) * 0.36, 0.06, Math.sin(angle) * 0.36)
      fresh.add(rock)
    }
    const logs = new THREE.MeshStandardMaterial({ color: '#7a5534', flatShading: true })
    const first = new THREE.Mesh(log, logs)
    first.rotation.set(0, 0.5, Math.PI / 2)
    first.position.y = 0.08
    const second = first.clone()
    second.rotation.set(0, -0.6, Math.PI / 2)
    fresh.add(first, second)
    root.add(fresh)
    return { fresh, charred: [{ material: logs, color: logs.color.clone() }], owned: [logs] }
  }

  function buildSupply(supply: Supply): SupplyView {
    const root = new THREE.Group()
    const flame = new THREE.Group()
    const outer = new THREE.Mesh(outerFlameGeometry, outerFlameMaterial)
    const inner = new THREE.Mesh(innerFlameGeometry, innerFlameMaterial)
    inner.renderOrder = 1
    flame.add(outer, inner)
    const instances: ModelInstance[] = []
    let fresh: THREE.Object3D
    let burnt: THREE.Object3D | null = null
    let charred: Charred[] = []
    let owned: THREE.Material[] = []
    if (models.has('campfire')) {
      const model = models.instance('campfire')
      instances.push(model)
      fresh = model.root
      root.add(fresh)
      if (models.has('campfire-burnt')) {
        const spent = models.instance('campfire-burnt')
        instances.push(spent)
        burnt = spent.root
        burnt.visible = false
        root.add(burnt)
      } else {
        charred = charredOf(model.materials)
      }
      const socket = model.nodes.get('socket_fx_fire')
      if (socket) socket.add(flame)
      else {
        flame.position.y = 0.35
        root.add(flame)
      }
    } else {
      const fallback = buildFallbackCampfire(root)
      fresh = fallback.fresh
      charred = fallback.charred
      owned = fallback.owned
      flame.position.y = 0.06
      flame.scale.setScalar(CAMPFIRE_FLAME.fallbackScale)
      root.add(flame)
    }
    root.rotation.y = propHash(supply.id, 17) * Math.PI * 2
    root.position.set(supply.pos.x, world ? floorAt(world.grid, supply.pos.x, supply.pos.y) : 0, supply.pos.y)
    layer(root)
    scene.add(root)
    return { root, flame, outer, inner, fresh, burnt, charred, models: instances, owned, used: null, seen: true }
  }

  function paperHalf(side: number): THREE.Group {
    const half = new THREE.Group()
    const sheet = new THREE.Mesh(paperGeometry, paperMaterial)
    sheet.position.x = (side * CLUE_PAPER.width) / 4
    sheet.castShadow = true
    half.add(sheet)
    for (const [index, y] of [0.17, 0.08, -0.01, -0.1].entries()) {
      if (side > 0 && index === 3) continue
      const line = new THREE.Mesh(inkGeometry, inkMaterial)
      line.position.set((side * CLUE_PAPER.width) / 4, y, 0.002)
      half.add(line)
    }
    if (side > 0) {
      const seal = new THREE.Mesh(sealGeometry, sealMaterial)
      seal.position.set(CLUE_PAPER.width * 0.3, -0.18, 0.003)
      half.add(seal)
    }
    half.rotation.y = -side * CLUE_PAPER.fold * 0.5
    return half
  }

  function buildClue(drop: ClueDrop): ClueView {
    const root = new THREE.Group()
    const paper = new THREE.Group()
    paper.rotation.order = 'YXZ'
    paper.add(paperHalf(-1), paperHalf(1))
    root.add(paper)
    const ring = flat(new THREE.Mesh(clueRing, new THREE.MeshBasicMaterial({ color: CLUE_PAPER.ring, transparent: true, opacity: 0.6, depthWrite: false })), 0.03)
    const beam = new THREE.Mesh(beamGeometry, beamMaterial)
    beam.renderOrder = 2
    root.add(ring, beam)
    root.position.set(drop.pos.x, world ? floorAt(world.grid, drop.pos.x, drop.pos.y) : 0, drop.pos.y)
    layer(root)
    scene.add(root)
    return { root, paper, ring, seen: true }
  }

  function removeClue(view: ClueView): void {
    scene.remove(view.root)
    view.ring.material.dispose()
  }

  function syncClues(world: World): void {
    const time = world.time
    for (const view of clues.values()) view.seen = false
    for (const drop of world.clues) {
      if (drop.taken) continue
      let view = clues.get(drop.id)
      if (!view) {
        view = buildClue(drop)
        clues.set(drop.id, view)
      }
      view.seen = true
      view.paper.position.y = CLUE_PAPER.float + Math.sin(time * CLUE_PAPER.bobRate + drop.id) * CLUE_PAPER.bob
      view.paper.rotation.set(-CLUE_PAPER.tilt, Math.sin(time * CLUE_PAPER.swayRate + drop.id) * CLUE_PAPER.sway, 0)
      view.ring.material.opacity = 0.4 + Math.sin(time * 4 + drop.id) * 0.25
    }
    paperMaterial.emissiveIntensity = CLUE_PAPER.glowBase + CLUE_PAPER.glowSwing * Math.sin(time * CLUE_PAPER.glowRate)
    beamMaterial.opacity = CLUE_PAPER.beamOpacity * (0.75 + 0.25 * Math.sin(time * CLUE_PAPER.glowRate))
    for (const [id, view] of clues) {
      if (view.seen) continue
      removeClue(view)
      clues.delete(id)
    }
  }

  function removeChest(view: ChestView): void {
    scene.remove(view.root)
    view.glow.material.dispose()
    view.model?.dispose()
  }

  function removeSupply(view: SupplyView): void {
    scene.remove(view.root)
    for (const model of view.models) model.dispose()
    for (const material of view.owned) material.dispose()
  }

  function syncPickups(world: World): void {
    const time = world.time
    for (const view of pickups.values()) view.seen = false
    for (const pickup of world.pickups) {
      let view = pickups.get(pickup.id)
      if (!view) {
        view = buildPickup(pickup)
        view.height = perchHeight(pickup)
        pickups.set(pickup.id, view)
      }
      view.seen = true
      const pop = view.height > 0 ? PERCH_DROP.seconds : POP_TIME
      const popping = pickup.age < pop
      const k = popping ? pickup.age / pop : 1
      const px = lerp(pickup.from.x, pickup.pos.x, k)
      const py = lerp(pickup.from.y, pickup.pos.y, k)
      view.root.position.set(px, floorAt(world.grid, px, py), py)
      view.spin.position.y = popping
        ? FLOAT_HEIGHT + view.height * (1 - k * k) + 4 * k * (1 - k) * (view.height > 0 ? PERCH_DROP.arc : POP_HEIGHT)
        : FLOAT_HEIGHT + Math.sin(time * 3 + pickup.id) * 0.08
      if (view.swings) view.spin.rotation.y = groundWeaponYaw(time, pickup.id)
      view.root.visible = pickup.life > PICKUP_BLINK || Math.floor(time * BLINK_RATE) % 2 === 0
    }
    for (const [id, view] of pickups) {
      if (view.seen) continue
      scene.remove(view.root)
      pickups.delete(id)
    }
  }

  function syncChests(world: World): void {
    const time = world.time
    for (const view of chests.values()) view.seen = false
    for (const chest of world.chests) {
      let view = chests.get(chest.id)
      if (!view) {
        view = buildChest(chest)
        chests.set(chest.id, view)
      }
      view.seen = true
      if (chest.opened && view.openedAt === null) view.openedAt = time
      const open = view.openedAt === null ? 0 : lidOpen(time - view.openedAt)
      if (view.lid) rotateFromRest(view.lid, view.hinge, lidAngle(open) * view.lidScale)
      const dim = spentGlow(open)
      for (const shine of view.shines) shine.material.emissiveIntensity = shine.base * dim
      view.glow.visible = !chest.opened
      view.glow.material.opacity = 0.35 + Math.sin(time * 4 + chest.id) * 0.25
    }
    for (const [id, view] of chests) {
      if (view.seen) continue
      removeChest(view)
      chests.delete(id)
    }
  }

  function syncSupplies(world: World): void {
    const time = world.time
    for (const view of supplies.values()) view.seen = false
    for (const supply of world.supplies) {
      let view = supplies.get(supply.id)
      if (!view) {
        view = buildSupply(supply)
        supplies.set(supply.id, view)
      }
      view.seen = true
      if (view.used !== supply.used) {
        view.used = supply.used
        view.flame.visible = !supply.used
        if (view.burnt) {
          view.fresh.visible = !supply.used
          view.burnt.visible = supply.used
        }
        for (const item of view.charred) {
          item.material.color.copy(item.color)
          if (supply.used) item.material.color.multiplyScalar(CAMPFIRE_FLAME.charred)
        }
      }
      if (supply.used) continue
      const flicker = 1 + Math.sin(time * 17 + supply.id) * 0.08 + Math.sin(time * 29) * 0.05
      view.outer.scale.set(flicker, 1 + Math.sin(time * 11 + supply.id) * 0.15, flicker)
      view.inner.scale.set(2 - flicker, 1 + Math.sin(time * 13 + supply.id * 2) * 0.2, 2 - flicker)
    }
    for (const [id, view] of supplies) {
      if (view.seen) continue
      removeSupply(view)
      supplies.delete(id)
    }
  }

  return {
    sync(next) {
      if (next.level !== world?.level) foggy = hasFog(next.level)
      world = next
      syncPickups(next)
      syncChests(next)
      syncSupplies(next)
      syncClues(next)
      debris.sync(next)
    },
    reset() {
      for (const view of pickups.values()) scene.remove(view.root)
      for (const view of chests.values()) removeChest(view)
      for (const view of supplies.values()) removeSupply(view)
      for (const view of clues.values()) removeClue(view)
      clues.clear()
      pickups.clear()
      chests.clear()
      supplies.clear()
      debris.reset()
    },
  }
}
