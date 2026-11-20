import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { BoltPodLanding } from '../sim/rare-events'
import type { GameEvent } from '../sim/types'
import type { Effects } from './effects'
import { toonMaterial } from './toon'
import type { Disposable } from './view-helpers'

export const SACK_LOOK = {
  cloth: '#cca36a',
  rope: '#6b3e26',
  strap: '#5a3d28',
  emblem: '#c8372d',
  shrinkPerLeak: 0.13,
} as const

export const POD_LOOK = {
  hull: '#b84638',
  trim: '#3a2f2a',
  brass: '#c9a04a',
  glass: '#ffb02e',
  horn: '#d8b45c',
  flame: '#ff9a2e',
  dropHeight: 22,
  ejectSeconds: 0.85,
  ejectHeight: 26,
  escapeSeconds: 0.45,
  escapeArc: 2.1,
} as const

export interface CourierSack {
  root: THREE.Group
  bag: THREE.Group
  setLeaked(leaked: number): void
  sync(clock: number, moving: boolean): void
}

export interface RareEventFX {
  handle(event: GameEvent): void
  update(dt: number, landing: BoltPodLanding | null): void
  reset(): void
}

interface SharedGeometries {
  sackBody: THREE.BufferGeometry
  sackNeck: THREE.BufferGeometry
  sackTuft: THREE.BufferGeometry
  sackStrap: THREE.BufferGeometry
  sackPatch: THREE.BufferGeometry
  podHull: THREE.BufferGeometry
  podBands: THREE.BufferGeometry
  podWindowRim: THREE.BufferGeometry
  podWindowGlass: THREE.BufferGeometry
  podPetals: THREE.BufferGeometry
  podHorn: THREE.BufferGeometry
  podFlame: THREE.BufferGeometry
}

interface FallingPod {
  root: THREE.Group
  flame: THREE.Mesh
  smokeTimer: number
}

interface EjectingPod {
  root: THREE.Group
  flame: THREE.Mesh
  x: number
  y: number
  z: number
  elapsed: number
  smokeTimer: number
}

interface EscapingSack {
  root: THREE.Group
  x: number
  y: number
  z: number
  elapsed: number
}

let cached: SharedGeometries | null = null

function sharedGeometries(): SharedGeometries {
  if (cached) return cached

  const sackProfile: THREE.Vector2[] = [
    new THREE.Vector2(0.02, 0),
    new THREE.Vector2(0.28, 0.06),
    new THREE.Vector2(0.39, 0.24),
    new THREE.Vector2(0.41, 0.46),
    new THREE.Vector2(0.32, 0.66),
    new THREE.Vector2(0.16, 0.78),
    new THREE.Vector2(0.14, 0.83),
  ]
  const sackBody = new THREE.LatheGeometry(sackProfile, 14)
  const sackNeck = new THREE.TorusGeometry(0.16, 0.035, 8, 14).rotateX(Math.PI / 2).translate(0, 0.8, 0)
  const sackTuft = new THREE.ConeGeometry(0.22, 0.18, 10, 1, true).rotateX(Math.PI).translate(0, 0.9, 0)
  const sackStrap = new THREE.TorusGeometry(0.36, 0.032, 6, 16).rotateY(Math.PI / 2).rotateZ(-0.45).translate(0.24, 0.44, 0)
  const sackPatch = new THREE.CircleGeometry(0.14, 12).rotateY(-Math.PI / 2).translate(-0.405, 0.43, 0)

  const podProfile: THREE.Vector2[] = [
    new THREE.Vector2(0.42, 0),
    new THREE.Vector2(0.68, 0.12),
    new THREE.Vector2(0.72, 0.48),
    new THREE.Vector2(0.64, 0.86),
    new THREE.Vector2(0.48, 1.06),
  ]
  const podHull = new THREE.LatheGeometry(podProfile, 16)
  const podBands = mergeGeometries(
    [
      new THREE.CylinderGeometry(0.73, 0.73, 0.08, 16, 1, true).translate(0, 0.22, 0),
      new THREE.CylinderGeometry(0.67, 0.67, 0.08, 16, 1, true).translate(0, 0.78, 0),
    ],
    false,
  )
  const podWindowRim = new THREE.TorusGeometry(0.16, 0.035, 8, 16).rotateY(Math.PI / 2).translate(0.69, 0.52, 0)
  const podWindowGlass = new THREE.CircleGeometry(0.145, 14).rotateY(Math.PI / 2).translate(0.7, 0.52, 0)

  const petals: THREE.BufferGeometry[] = []
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4
    const flap = new THREE.BoxGeometry(0.34, 0.05, 0.24)
    flap.translate(0.17, 0, 0)
    flap.rotateZ(-0.65)
    flap.translate(0.45, 1.04, 0)
    flap.rotateY(angle)
    petals.push(flap)
  }
  const podPetals = mergeGeometries(petals, false)

  const hornCone = new THREE.ConeGeometry(0.14, 0.28, 10, 1, true)
  hornCone.rotateZ(-Math.PI / 2)
  hornCone.translate(0.62, 0.92, 0.36)
  const podHorn = hornCone

  const podFlame = new THREE.ConeGeometry(0.38, 1.15, 10).rotateX(Math.PI).translate(0, -0.55, 0)

  cached = {
    sackBody,
    sackNeck,
    sackTuft,
    sackStrap,
    sackPatch,
    podHull,
    podBands,
    podWindowRim,
    podWindowGlass,
    podPetals,
    podHorn,
    podFlame,
  }
  return cached
}

/**
 * 构建挂在运粮兵背上的大麻袋网格与材质
 * @param owned - 敌人视图持有的待释放资源数组
 * @returns 运粮兵麻袋控制器
 */
export function buildCourierSack(owned: Disposable[]): CourierSack {
  const parts = sharedGeometries()
  const root = new THREE.Group()
  root.name = 'courier-sack'
  root.position.set(-0.34, 0.42, 0)
  root.rotation.z = 0.26

  const cloth = toonMaterial({ color: SACK_LOOK.cloth, side: THREE.DoubleSide })
  const rope = toonMaterial({ color: SACK_LOOK.rope })
  const strapMat = toonMaterial({ color: SACK_LOOK.strap })
  const emblem = toonMaterial({ color: SACK_LOOK.emblem, side: THREE.DoubleSide })
  owned.push(cloth, rope, strapMat, emblem)

  const bag = new THREE.Group()
  bag.add(new THREE.Mesh(parts.sackBody, cloth))
  bag.add(new THREE.Mesh(parts.sackNeck, rope))
  bag.add(new THREE.Mesh(parts.sackTuft, cloth))
  bag.add(new THREE.Mesh(parts.sackPatch, emblem))
  root.add(bag)
  root.add(new THREE.Mesh(parts.sackStrap, strapMat))

  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) {
      object.castShadow = true
      object.receiveShadow = true
    }
  })

  let targetScale = 1
  return {
    root,
    bag,
    setLeaked(leaked) {
      targetScale = Math.max(0.55, 1 - leaked * SACK_LOOK.shrinkPerLeak)
    },
    sync(clock, moving) {
      const bounce = moving ? Math.sin(clock * 16) * 0.06 : Math.sin(clock * 3) * 0.015
      bag.scale.set(targetScale * (1 - bounce * 0.4), targetScale * (1 + bounce), targetScale * (1 - bounce * 0.4))
      root.rotation.x = moving ? Math.sin(clock * 8) * 0.08 : 0
    },
  }
}

/**
 * 构建套在螺栓上尉三联炮塔外的逃生舱底座网格
 * @param owned - 可选的资源释放收集列表
 * @param openPetals - 是否展示打开的舱盖与喇叭
 * @returns 逃生舱模型根节点
 */
export function buildEscapePodHull(owned?: Disposable[], openPetals = true): { root: THREE.Group; materials: THREE.Material[] } {
  const parts = sharedGeometries()
  const root = new THREE.Group()
  root.name = 'bolt-escape-pod'

  const hull = toonMaterial({ color: POD_LOOK.hull })
  const trim = toonMaterial({ color: POD_LOOK.trim, side: THREE.DoubleSide })
  const brass = toonMaterial({ color: POD_LOOK.brass, side: THREE.DoubleSide })
  const glass = new THREE.MeshStandardMaterial({
    color: POD_LOOK.glass,
    emissive: new THREE.Color(POD_LOOK.glass),
    emissiveIntensity: 1.35,
  })
  const materials: THREE.Material[] = [hull, trim, brass, glass]
  if (owned) owned.push(...materials)

  root.add(new THREE.Mesh(parts.podHull, hull))
  root.add(new THREE.Mesh(parts.podBands, trim))
  root.add(new THREE.Mesh(parts.podWindowRim, brass))
  root.add(new THREE.Mesh(parts.podWindowGlass, glass))
  if (openPetals) {
    root.add(new THREE.Mesh(parts.podPetals, hull))
    root.add(new THREE.Mesh(parts.podHorn, brass))
  } else {
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.49, 0.36, 16).translate(0, 1.24, 0), trim)
    if (owned) owned.push(cap.geometry)
    else materials.push()
    root.add(cap)
  }

  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) {
      object.castShadow = true
      object.receiveShadow = true
    }
  })

  return { root, materials }
}

/**
 * 创建稀有事件瞬态演出管理器（逃生舱高空空投、三成血喷火弹射升空、运粮兵翻墙跃出）
 * @param scene - Three.js 场景
 * @param effects - 粒子与烟雾特效池
 * @returns 瞬态演出控制器
 */
export function createRareEventFX(scene: THREE.Scene, effects: Effects): RareEventFX {
  const parts = sharedGeometries()
  let falling: FallingPod | null = null
  const ejecting: EjectingPod[] = []
  const escaping: EscapingSack[] = []
  const flameMaterial = new THREE.MeshBasicMaterial({ color: POD_LOOK.flame })
  const capGeometry = new THREE.ConeGeometry(0.49, 0.38, 16).translate(0, 1.25, 0)

  const sharedPod = () => {
    const group = new THREE.Group()
    const hull = toonMaterial({ color: POD_LOOK.hull })
    const trim = toonMaterial({ color: POD_LOOK.trim, side: THREE.DoubleSide })
    const brass = toonMaterial({ color: POD_LOOK.brass })
    const glass = new THREE.MeshBasicMaterial({ color: POD_LOOK.glass })
    group.userData.materials = [hull, trim, brass, glass]
    group.add(new THREE.Mesh(parts.podHull, hull))
    group.add(new THREE.Mesh(parts.podBands, trim))
    group.add(new THREE.Mesh(parts.podWindowRim, brass))
    group.add(new THREE.Mesh(parts.podWindowGlass, glass))
    group.add(new THREE.Mesh(capGeometry, trim))
    const flame = new THREE.Mesh(parts.podFlame, flameMaterial)
    flame.userData.noInk = true
    group.add(flame)
    return { group, flame }
  }

  const disposeGroup = (group: THREE.Group) => {
    scene.remove(group)
    const list = group.userData.materials as THREE.Material[] | undefined
    if (list) for (const mat of list) mat.dispose()
  }

  return {
    handle(event) {
      switch (event.type) {
        case 'boltIncoming': {
          const { group, flame } = sharedPod()
          group.name = 'bolt-pod-falling'
          group.position.set(event.x, event.z + POD_LOOK.dropHeight, event.y)
          scene.add(group)
          falling = { root: group, flame, smokeTimer: 0 }
          break
        }
        case 'boltEjected': {
          const { group, flame } = sharedPod()
          group.name = 'bolt-pod-ejecting'
          group.position.set(event.x, event.z, event.y)
          scene.add(group)
          effects.puff(event.x, event.z + 0.6, event.y, '#ffd27a', 0.45, 1.6, 0.45)
          effects.sparks(event.x, event.z + 0.5, event.y, 0, 0, { count: 16, speed: 7, life: 0.45, color: '#ffae38', spread: 1, lift: 5 })
          ejecting.push({
            root: group,
            flame,
            x: event.x,
            y: event.y,
            z: event.z,
            elapsed: 0,
            smokeTimer: 0,
          })
          break
        }
        case 'courierEscaped': {
          const group = new THREE.Group()
          const cloth = toonMaterial({ color: SACK_LOOK.cloth, side: THREE.DoubleSide })
          const rope = toonMaterial({ color: SACK_LOOK.rope })
          group.userData.materials = [cloth, rope]
          group.add(new THREE.Mesh(parts.sackBody, cloth))
          group.add(new THREE.Mesh(parts.sackNeck, rope))
          group.position.set(event.x, event.z + 0.5, event.y)
          scene.add(group)
          effects.puff(event.x, event.z + 0.5, event.y, '#e8dcc4', 0.35, 1.2, 0.45)
          escaping.push({ root: group, x: event.x, y: event.y, z: event.z, elapsed: 0 })
          break
        }
      }
    },
    update(dt, landing) {
      if (falling && !landing) {
        disposeGroup(falling.root)
        falling = null
      }
      if (falling && landing) {
        const { x, y, z, delay, total } = landing.blast
        const elapsed = total - delay
        const t = elapsed / total
        const height = POD_LOOK.dropHeight * (1 - t * t)
        falling.root.position.set(x, z + height, y)
        falling.root.rotation.y = elapsed * 5
        falling.flame.scale.set(1, 0.8 + Math.sin(elapsed * 40) * 0.25, 1)
        falling.smokeTimer -= dt
        if (dt > 0 && falling.smokeTimer <= 0) {
          falling.smokeTimer = 0.05
          effects.puff(x, z + height + 1.2, y, '#d9cfc2', 0.28, 0.95, 0.4)
        }
      }

      for (let i = ejecting.length - 1; i >= 0; i--) {
        const item = ejecting[i]
        item.elapsed += dt
        const t = Math.min(1, item.elapsed / POD_LOOK.ejectSeconds)
        const height = POD_LOOK.ejectHeight * t * t
        item.root.position.set(item.x, item.z + height, item.y)
        item.root.rotation.y += dt * 9
        item.root.scale.setScalar(Math.max(0.15, 1 - t * 0.45))
        item.flame.scale.set(1.15, 1.2 + Math.sin(item.elapsed * 50) * 0.3, 1.15)
        item.smokeTimer -= dt
        if (item.smokeTimer <= 0) {
          item.smokeTimer = 0.04
          effects.puff(item.x, item.z + Math.max(0.2, height - 0.5), item.y, '#f0e6d2', 0.32, 1.1, 0.45)
        }
        if (item.elapsed >= POD_LOOK.ejectSeconds) {
          disposeGroup(item.root)
          ejecting.splice(i, 1)
        }
      }

      for (let i = escaping.length - 1; i >= 0; i--) {
        const item = escaping[i]
        item.elapsed += dt
        const t = Math.min(1, item.elapsed / POD_LOOK.escapeSeconds)
        const arc = Math.sin(t * Math.PI * 0.85) * POD_LOOK.escapeArc + t * 0.8
        item.root.position.set(item.x, item.z + 0.5 + arc, item.y)
        item.root.rotation.z += dt * 8
        item.root.scale.setScalar(Math.max(0.05, 1 - t * 0.85))
        if (item.elapsed >= POD_LOOK.escapeSeconds) {
          disposeGroup(item.root)
          escaping.splice(i, 1)
        }
      }
    },
    reset() {
      if (falling) disposeGroup(falling.root)
      for (const item of ejecting) disposeGroup(item.root)
      for (const item of escaping) disposeGroup(item.root)
      falling = null
      ejecting.length = 0
      escaping.length = 0
    },
  }
}
