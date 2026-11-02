import * as THREE from 'three'
import { CONVEYOR } from '../data/conveyors'
import { LANDMARKS } from '../data/landmarks'
import type { BuiltLevel, Conveyor } from '../sim/level'
import type { World } from '../sim/world'
import { cargoItems, cargoTracks, normalBelts, trackCapacity, trackPoint, type CargoKind, type CargoTrack, type DeckAt } from './belt-cargo'
import { instancedDepth } from './instanced-depth'
import { castsShadowAs, onePart } from './landmark-views'
import type { ModelLibrary } from './model-library'
import { atlasGroups, type NodePart } from './node-parts'
import { landmarkModel } from './scene-models'
import { BELT_CARGO, BELT_VIEW } from './themes'

export interface BeltViews {
  readonly group: THREE.Group
  readonly tracks: readonly CargoTrack[]
  readonly cargoMeshes: readonly THREE.InstancedMesh[]
  update(world: World, dt: number): void
  dispose(): void
}

interface BeltCell {
  x: number
  z: number
  dx: number
  dy: number
  yaw: number
}

interface BeltSet {
  cells: BeltCell[]
  arrows: THREE.InstancedMesh
  material: THREE.MeshBasicMaterial
  shift: number
  active: boolean
  top: number
  bottom: number
}

interface CargoSet {
  meshes: THREE.InstancedMesh[]
  count: number
}

const CARGO_KINDS: readonly CargoKind[] = ['bale', 'crate']
const SAMPLE_STEP = 0.5
const CARGO_TOP = 1.6

export function createBeltViews(level: BuiltLevel, models: ModelLibrary): BeltViews {
  const group = new THREE.Group()
  const owned: { dispose(): void }[] = []
  const instanced: THREE.InstancedMesh[] = []
  const { columns } = level.grid
  const has = (id: string) => models.has(id)
  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  const compose = (x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number) =>
    matrix.compose(position.set(x, y, z), rotation.setFromAxisAngle(up, yaw), scale.set(sx, sy, sz))
  const own = <T extends { dispose(): void }>(resource: T): T => {
    owned.push(resource)
    return resource
  }
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, count: number) => {
    const made = new THREE.InstancedMesh(geometry, material, count)
    instanced.push(made)
    group.add(made)
    return made
  }

  const normal = new Set(normalBelts(level))
  const bossBelts = level.conveyors.filter((item) => !normal.has(item))
  const boxGeometry = own(new THREE.BoxGeometry(0.96, 0.06, 0.96))
  const boxMaterial = own(new THREE.MeshStandardMaterial({ color: BELT_VIEW.belt }))
  const arrowGeometry = own(new THREE.ConeGeometry(0.16, 0.32, 3))
  arrowGeometry.rotateZ(-Math.PI / 2)

  const cellOf = (item: Conveyor): BeltCell => {
    const column = item.index % columns
    const row = (item.index - column) / columns
    return { x: column + 0.5, z: row + 0.5, dx: item.dx, dy: item.dy, yaw: -Math.atan2(item.dy, item.dx) }
  }
  const placeArrows = (set: BeltSet) => {
    set.cells.forEach((cell, instance) => {
      for (let k = 0; k < 2; k++) {
        const offset = ((set.shift + k * 0.5) % 1) - 0.5
        set.arrows.setMatrixAt(instance * 2 + k, compose(cell.x + cell.dx * offset, 0.09, cell.z + cell.dy * offset, cell.yaw, 1, 0.4, 1))
      }
    })
    set.arrows.instanceMatrix.needsUpdate = true
  }
  const beltSet = (belts: readonly Conveyor[], color: string, active: boolean): BeltSet | null => {
    if (belts.length === 0) return null
    const cells = belts.map(cellOf)
    const boxes = mesh(boxGeometry, boxMaterial, cells.length)
    cells.forEach((cell, instance) => boxes.setMatrixAt(instance, matrix.makeTranslation(cell.x, 0.03, cell.z)))
    const material = own(new THREE.MeshBasicMaterial({ color }))
    const set: BeltSet = {
      cells,
      arrows: mesh(arrowGeometry, material, cells.length * 2),
      material,
      shift: 0,
      active,
      top: Math.min(...cells.map((cell) => cell.z)),
      bottom: Math.max(...cells.map((cell) => cell.z)),
    }
    placeArrows(set)
    return set
  }
  const boss = beltSet(bossBelts, BELT_VIEW.boss.idle, false)
  const running = beltSet([...normal], BELT_VIEW.normal, true)

  const deckAt: DeckAt = (column, row) => {
    for (const placement of level.landmarks) {
      const height = BELT_CARGO.decks[placement.id]
      if (height === undefined) continue
      if (column < placement.column || column >= placement.column + placement.width || row < placement.row || row >= placement.row + placement.depth) continue
      return landmarkModel(has, placement.id, placement.variant) ? height : null
    }
    return null
  }
  const tracks = running ? cargoTracks(level, deckAt) : []
  const capacity = tracks.reduce((sum, track) => sum + trackCapacity(track), 0)
  const bounds = new THREE.Box3()
  const point = { x: 0, y: 0, angle: 0 }
  for (const track of tracks) {
    for (let s = 0; s <= track.length + SAMPLE_STEP; s += SAMPLE_STEP) {
      trackPoint(track, s, point)
      bounds.expandByPoint(position.set(point.x, 0, point.y))
      bounds.expandByPoint(position.set(point.x, CARGO_TOP, point.y))
    }
  }
  const sphere = bounds.isEmpty() ? null : bounds.getBoundingSphere(new THREE.Sphere())
  if (sphere) sphere.radius += 1

  const cargoParts = (kind: CargoKind): readonly NodePart[] => {
    const base = BELT_CARGO.models[kind]
    const id = landmarkModel(has, base, 1)
    if (id && models.has(id)) {
      const parts = models.parts(id)
      if (parts.length < 2) return parts
      const single = onePart(parts)
      if (single) {
        own(single.geometry)
        if (single.copied) own(single.material)
        return [single]
      }
      const grouped = atlasGroups(parts)
      owned.push(...grouped.owned)
      return grouped.parts
    }
    const { height } = LANDMARKS[base]
    const geometry = own(new THREE.BoxGeometry(1, height, 1).translate(0, height / 2, 0))
    const material = own(new THREE.MeshStandardMaterial({ color: BELT_CARGO.fallback[kind], flatShading: true }))
    return [{ geometry, material }]
  }
  const cargo = new Map<CargoKind, CargoSet>()
  if (capacity > 0) {
    for (const kind of CARGO_KINDS) {
      const meshes = cargoParts(kind).map((part) => {
        const made = mesh(part.geometry, part.material, capacity)
        made.count = 0
        made.visible = false
        made.castShadow = castsShadowAs(part.material)
        made.receiveShadow = true
        made.customDepthMaterial = instancedDepth(made)
        if (sphere) made.boundingSphere = sphere.clone()
        return made
      })
      cargo.set(kind, { meshes, count: 0 })
    }
  }

  let clock = 0
  const near = (world: World, set: BeltSet) => {
    const { y } = world.player.pos
    return y >= set.top - BELT_VIEW.range && y <= set.bottom + BELT_VIEW.range
  }
  const hideCargo = () => {
    for (const set of cargo.values()) {
      set.count = 0
      for (const item of set.meshes) {
        item.count = 0
        item.visible = false
      }
    }
  }
  const fillCargo = () => {
    for (const set of cargo.values()) set.count = 0
    tracks.forEach((track, index) => {
      cargoItems(track, index + 1, clock, CONVEYOR.speed, (item) => {
        const set = cargo.get(item.kind)
        if (!set || set.count >= capacity) return
        compose(item.x, item.height, item.y, -item.angle, item.scale, item.scale, item.scale)
        for (const part of set.meshes) part.setMatrixAt(set.count, matrix)
        set.count += 1
      })
    })
    for (const set of cargo.values()) {
      for (const part of set.meshes) {
        part.count = set.count
        part.visible = set.count > 0
        part.instanceMatrix.needsUpdate = true
      }
    }
  }

  return {
    group,
    tracks,
    cargoMeshes: [...cargo.values()].flatMap((set) => set.meshes),
    update(world, dt) {
      clock += dt
      if (boss) {
        const active = world.boss?.boss?.hazards.includes('conveyor') ?? false
        if (active) boss.shift = (boss.shift + dt * BELT_VIEW.boss.speed) % 1
        if (active !== boss.active) boss.material.color.set(active ? BELT_VIEW.boss.active : BELT_VIEW.boss.idle)
        if (active) placeArrows(boss)
        boss.active = active
      }
      if (!running) return
      if (!near(world, running)) {
        hideCargo()
        return
      }
      running.shift = (running.shift + dt * CONVEYOR.speed) % 1
      placeArrows(running)
      if (cargo.size > 0) fillCargo()
    },
    dispose() {
      for (const item of instanced) {
        item.removeFromParent()
        item.dispose()
      }
      instanced.length = 0
      group.clear()
      for (const resource of owned) resource.dispose()
      owned.length = 0
    },
  }
}
