import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mineRule } from '../sim/mines'
import type { Mine } from '../sim/types'
import type { World } from '../sim/world'
import type { Effects } from './effects'
import { glowSprite, radialTexture } from './glow-textures'
import type { ModelLibrary, ModelPart } from './model-library'
import { atlasPart, type AtlasPart } from './node-parts'
import { mineGlow, mineSettle, mineSpark, mineWarning } from './tank-motion'
import { MINE_LIGHT, PROJECTILE_SCALES } from './themes'

export const MINE_NODES = ['body', 'light'] as const

interface MineView {
  root: THREE.Group
  lamps: { material: THREE.MeshStandardMaterial; base: number }[]
  halo: THREE.Sprite
  spark: THREE.Sprite
  ring: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
}

interface MineBody {
  solid: readonly (ModelPart | AtlasPart)[]
  lamps: readonly ModelPart[]
}

export interface MineViews {
  sync(world: World, dt: number): void
  reset(): void
}

const FALLBACK_COLOR = '#4a423a'
const LAMP_MATERIAL = 'mat_lamp'

export function warningGeometry(width: number = MINE_LIGHT.ringWidth, fill: number = MINE_LIGHT.ringFill): THREE.BufferGeometry {
  const inner = 1 - width
  const disc = new THREE.CircleGeometry(inner, 48)
  const band = new THREE.RingGeometry(inner, 1, 48, 1)
  const discCount = disc.getAttribute('position').count
  const geometry = mergeGeometries([disc, band], false)
  disc.dispose()
  band.dispose()
  if (!geometry) throw new Error('mine warning geometry failed to merge')
  const count = geometry.getAttribute('position').count
  const colors = new Float32Array(count * 4).fill(1)
  for (let i = 0; i < discCount; i++) colors[i * 4 + 3] = fill
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4))
  return geometry
}

export function createMineViews(scene: THREE.Scene, models: ModelLibrary, effects: Effects | null): MineViews {
  const views: MineView[] = []
  const texture = radialTexture(32, 1.6, 0.1)
  const sparkTexture = radialTexture(32, 1.2, 0.4)
  const idleColor = new THREE.Color(MINE_LIGHT.ring)
  const litColor = new THREE.Color(MINE_LIGHT.ringArmed)
  let warning: THREE.BufferGeometry | null = null
  let body: MineBody | null = null
  let fallbackGeometry: THREE.CylinderGeometry | null = null
  let fallbackMaterial: THREE.MeshStandardMaterial | null = null
  let used = 0
  const known = new Set<number>()

  const bodyOf = (): MineBody => {
    if (body) return body
    const parts = models.parts('mine')
    const lamps = parts.filter((part) => part.material.name === LAMP_MATERIAL)
    const solid = parts.filter((part) => !lamps.includes(part))
    const atlas = atlasPart(solid)
    body = { solid: atlas ? [atlas] : solid, lamps }
    return body
  }

  const build = (): MineView => {
    const root = new THREE.Group()
    const lamps: MineView['lamps'] = []
    if (models.has('mine')) {
      const model = new THREE.Group()
      model.scale.setScalar(PROJECTILE_SCALES.mine)
      const { solid, lamps: lit } = bodyOf()
      for (const part of solid) {
        const mesh = new THREE.Mesh(part.geometry, part.material)
        mesh.castShadow = true
        model.add(mesh)
      }
      for (const part of lit) {
        const material = part.material.clone()
        model.add(new THREE.Mesh(part.geometry, material))
        if (material instanceof THREE.MeshStandardMaterial) lamps.push({ material, base: material.emissiveIntensity })
      }
      root.add(model)
    } else {
      fallbackGeometry ??= new THREE.CylinderGeometry(0.15, 0.15, 0.1, 14).translate(0, 0.05, 0)
      fallbackMaterial ??= new THREE.MeshStandardMaterial({ color: FALLBACK_COLOR })
      const fallback = new THREE.Mesh(fallbackGeometry, fallbackMaterial)
      fallback.castShadow = true
      root.add(fallback)
    }
    const halo = glowSprite(texture, MINE_LIGHT.halo, MINE_LIGHT.haloSize)
    halo.position.y = MINE_LIGHT.height
    halo.renderOrder = 1
    const spark = glowSprite(sparkTexture, MINE_LIGHT.spark, MINE_LIGHT.sparkSize)
    spark.material.blending = THREE.NormalBlending
    spark.position.y = MINE_LIGHT.height
    spark.renderOrder = 2
    warning ??= warningGeometry()
    const ring = new THREE.Mesh(
      warning,
      new THREE.MeshBasicMaterial({ color: MINE_LIGHT.ring, vertexColors: true, transparent: true, opacity: 0, depthWrite: false }),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = MINE_LIGHT.ringHeight
    ring.castShadow = false
    root.add(halo, spark, ring)
    root.visible = false
    scene.add(root)
    return { root, lamps, halo, spark, ring }
  }

  const place = (view: MineView, mine: Mine, time: number) => {
    view.root.visible = true
    view.root.position.set(mine.pos.x, MINE_LIGHT.drop * mineSettle(mine.age, MINE_LIGHT.settle), mine.pos.y)
    view.root.rotation.y = (mine.id * 2.399) % (Math.PI * 2)
    const glow = mineGlow(mine.age, mine.fuse, time + mine.id * 0.37, MINE_LIGHT)
    for (const lamp of view.lamps) lamp.material.emissiveIntensity = lamp.base * glow
    view.halo.material.opacity = MINE_LIGHT.haloOpacity * Math.min(1, glow / MINE_LIGHT.armed[1]) * (mine.fuse >= 0 ? 1.4 : 1)
    view.halo.scale.setScalar(MINE_LIGHT.haloSize * (mine.fuse >= 0 ? 1.5 : 1))
    view.spark.material.opacity = mineSpark(mine.fuse, glow, MINE_LIGHT)
    const radius = mineRule(mine)?.trigger ?? 0
    view.ring.visible = radius > 0
    view.ring.scale.setScalar(Math.max(radius, 1e-3))
    view.ring.position.y = MINE_LIGHT.ringHeight - view.root.position.y
    view.ring.material.opacity = mineWarning(mine.age, mine.fuse, glow, MINE_LIGHT)
    view.ring.material.color.copy(mine.fuse >= 0 ? litColor : idleColor)
  }

  return {
    sync(world) {
      used = 0
      for (const mine of world.mines) {
        const view = views[used] ?? build()
        if (!views[used]) views.push(view)
        used += 1
        if (!known.has(mine.id)) {
          known.add(mine.id)
          effects?.puff(mine.pos.x, 0.12, mine.pos.y, '#c8b48a', 0.12, 0.45, 0.35)
        }
        place(view, mine, world.time)
      }
      for (let i = used; i < views.length; i++) views[i].root.visible = false
      if (world.mines.length === 0) known.clear()
    },
    reset() {
      for (const view of views) view.root.visible = false
      known.clear()
      used = 0
    },
  }
}
