import * as THREE from 'three'
import { HIT_STAR, starScale, starTexture } from './hit-star'
import { FX } from './themes'
import { toonMaterial } from './toon'

interface Puff {
  mesh: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>
  age: number
  duration: number
  from: number
  to: number
  base: number
  rise: number
}

interface Blob {
  mesh: THREE.Mesh
  age: number
  life: number
  size: number
  grow: number
  fade: number
  vx: number
  vy: number
  vz: number
  drag: number
}

interface Star {
  sprite: THREE.Sprite
  age: number
  size: number
}

interface Spark {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  age: number
  life: number
  width: number
  stretch: number
  color: THREE.Color
}

export interface SparkStyle {
  count: number
  speed: number
  life: number
  color: THREE.ColorRepresentation
  spread?: number
  lift?: number
  width?: number
}

export interface Effects {
  puff(
    x: number,
    height: number,
    y: number,
    color: THREE.ColorRepresentation,
    from: number,
    to: number,
    duration: number,
    rise?: number,
  ): void
  burst(x: number, y: number, color: THREE.ColorRepresentation, size?: number): void
  sparks(x: number, height: number, y: number, dirX: number, dirY: number, style: SparkStyle): void
  smoke(x: number, height: number, y: number, size: number, count?: number, color?: THREE.ColorRepresentation): void
  explosion(x: number, height: number, y: number, radius: number): void
  star(x: number, height: number, y: number, size: number, color?: THREE.ColorRepresentation): void
  update(dt: number, eye?: THREE.Vector3): void
  clear(): void
}

const BURST_OFFSETS = [
  [0, 0.7, 0],
  [0.28, 0.5, 0.12],
  [-0.22, 0.55, 0.2],
  [0.06, 0.95, -0.25],
] as const

const START_OPACITY = 0.9
const SMOKE_INK = {
  inkShadeLow: { value: 0.95 },
  inkShadeHigh: { value: 1.1 },
  inkTintAmount: { value: 0.3 },
  inkShadowLevel: { value: 0.8 },
  inkShadowDesat: { value: 0 },
  inkDotDarken: { value: 0.42 },
  inkDotCell: { value: 7 },
}
const FORWARD = new THREE.Vector3(0, 0, 1)

export const EYE_GAP = 0.45

export function clearOfEye(scale: number, distance: number, gap: number = EYE_GAP): number {
  return Math.min(scale, Math.max(0.0001, (distance - gap) * 2))
}

export function blobScale(age: number, life: number, grow: number, fade: number): number {
  if (age <= 0 || age >= life) return 0
  const t = age / life
  if (t < grow) return 1 - (1 - t / grow) ** 3
  if (t > 1 - fade) return Math.max(0, (1 - t) / fade)
  return 1
}

export function createEffects(scene: THREE.Scene): Effects {
  const geometry = new THREE.IcosahedronGeometry(0.5, 1)
  const round = new THREE.IcosahedronGeometry(0.5, 2)
  const active: Puff[] = []
  const idle: Puff[] = []
  const blobs: Blob[] = []
  const spare: THREE.Mesh[] = []
  const smokeMaterials = new Map<string, THREE.Material>()
  const fireMaterials = FX.fire.colors.map((color) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(FX.fire.glow) }))
  const sparks: Spark[] = []
  const sparkMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  const sparkMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), sparkMaterial, FX.sparks.max)
  sparkMesh.count = 0
  sparkMesh.frustumCulled = false
  sparkMesh.userData.noInk = true
  sparkMesh.renderOrder = 3
  sparkMesh.setColorAt(0, new THREE.Color('#ffffff'))
  scene.add(sparkMesh)
  const stars: Star[] = []
  const starMaterials = new Map<string, THREE.SpriteMaterial>()
  const starMaterial = (color: THREE.ColorRepresentation): THREE.SpriteMaterial => {
    const key = new THREE.Color(color).getHexString()
    let material = starMaterials.get(key)
    if (!material) {
      material = new THREE.SpriteMaterial({ map: starTexture(), color: new THREE.Color(color).multiplyScalar(HIT_STAR.glow), transparent: true, depthWrite: false })
      starMaterials.set(key, material)
    }
    return material
  }
  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const heading = new THREE.Vector3()
  const turn = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  const tint = new THREE.Color()

  const createPuff = (): Puff => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }))
    scene.add(mesh)
    return { mesh, age: 0, duration: 1, from: 1, to: 1, base: 0, rise: 0 }
  }

  const puff: Effects['puff'] = (x, height, y, color, from, to, duration, rise = 0) => {
    const item = idle.pop() ?? createPuff()
    item.mesh.material.color.set(color)
    item.mesh.material.opacity = START_OPACITY
    item.mesh.position.set(x, height, y)
    item.mesh.scale.setScalar(from)
    item.mesh.visible = true
    item.age = 0
    item.duration = duration
    item.from = from
    item.to = to
    item.base = height
    item.rise = rise
    active.push(item)
  }

  const smokeMaterial = (color: THREE.ColorRepresentation): THREE.Material => {
    const key = new THREE.Color(color).getHexString()
    let material = smokeMaterials.get(key)
    if (!material) {
      const made = toonMaterial({ color })
      const inked = made.onBeforeCompile.bind(made)
      made.onBeforeCompile = (shader, renderer) => {
        inked(shader, renderer)
        Object.assign(shader.uniforms, SMOKE_INK)
      }
      material = made
      smokeMaterials.set(key, material)
    }
    return material
  }

  const blob = (material: THREE.Material, x: number, y: number, z: number, size: number, life: number, delay: number, vx: number, vy: number, vz: number, grow: number, fade: number, drag: number) => {
    if (blobs.length >= FX.blobs.max) return
    const mesh = spare.pop() ?? new THREE.Mesh(round, material)
    mesh.material = material
    mesh.position.set(x, y, z)
    mesh.rotation.set(Math.random() * 6.28, Math.random() * 6.28, 0)
    mesh.scale.setScalar(0.0001)
    mesh.visible = false
    if (!mesh.parent) scene.add(mesh)
    blobs.push({ mesh, age: -delay, life, size, grow, fade, vx, vy, vz, drag })
  }

  const spray: Effects['sparks'] = (x, height, y, dirX, dirY, style) => {
    const aim = Math.hypot(dirX, dirY)
    const spread = style.spread ?? 1
    const base = new THREE.Color(style.color)
    for (let i = 0; i < style.count && sparks.length < FX.sparks.max; i++) {
      const yaw = Math.random() * Math.PI * 2
      const pitch = (Math.random() - 0.35) * Math.PI * 0.9
      let vx = Math.cos(yaw) * Math.cos(pitch) * spread
      let vy = Math.sin(pitch) * spread + (style.lift ?? 0.35)
      let vz = Math.sin(yaw) * Math.cos(pitch) * spread
      if (aim > 1e-6) {
        vx += dirX / aim
        vz += dirY / aim
      }
      const length = Math.hypot(vx, vy, vz) || 1
      const speed = style.speed * (0.45 + Math.random() * 0.85)
      sparks.push({
        x,
        y: height,
        z: y,
        vx: (vx / length) * speed,
        vy: (vy / length) * speed,
        vz: (vz / length) * speed,
        age: 0,
        life: style.life * (0.55 + Math.random() * 0.7),
        width: (style.width ?? FX.sparks.width) * (0.7 + Math.random() * 0.6),
        stretch: FX.sparks.stretch * (0.7 + Math.random() * 0.6),
        color: base.clone().multiplyScalar(FX.sparks.glow * (0.7 + Math.random() * 0.6)),
      })
    }
  }

  const smoke: Effects['smoke'] = (x, height, y, size, count = 7, color) => {
    for (let i = 0; i < count; i++) {
      const yaw = (i / count) * Math.PI * 2 + Math.random() * 0.9
      const reach = size * (0.15 + Math.random() * 0.4)
      const shade = color ?? FX.smoke.colors[i % FX.smoke.colors.length]
      blob(
        smokeMaterial(shade),
        x + Math.cos(yaw) * reach,
        height + (Math.random() - 0.3) * size * 0.5,
        y + Math.sin(yaw) * reach,
        size * (0.4 + Math.random() * 0.45),
        FX.smoke.life * (0.6 + Math.random() * 0.4),
        Math.random() * 0.08,
        Math.cos(yaw) * size * 0.9,
        size * (0.5 + Math.random() * 0.6),
        Math.sin(yaw) * size * 0.9,
        0.18,
        0.4,
        2.6,
      )
    }
  }

  return {
    puff,
    burst(x, y, color, size = 1) {
      for (const [dx, height, dy] of BURST_OFFSETS) {
        puff(x + dx * size, height * size, y + dy * size, color, 0.45 * size, 1.4 * size, 0.32)
      }
    },
    sparks: spray,
    smoke,
    star(x, height, y, size, color = '#ffffff') {
      let item = stars.find((entry) => !entry.sprite.visible)
      if (!item) {
        if (stars.length >= HIT_STAR.pool) item = stars.reduce((oldest, entry) => (entry.age > oldest.age ? entry : oldest))
        else {
          const sprite = new THREE.Sprite(starMaterial(color))
          sprite.renderOrder = 4
          scene.add(sprite)
          item = { sprite, age: 0, size }
          stars.push(item)
        }
      }
      item.sprite.material = starMaterial(color)
      item.sprite.material.rotation = Math.random() * Math.PI
      item.sprite.position.set(x, height, y)
      item.sprite.visible = true
      item.sprite.scale.setScalar(size * starScale(0))
      item.age = 0
      item.size = size
    },
    explosion(x, height, y, radius) {
      const size = Math.max(0.8, radius)
      puff(x, height + size * 0.4, y, '#fffbe0', size * 0.6, size * 2.4, 0.12)
      for (let i = 0; i < FX.fire.count; i++) {
        const yaw = (i / FX.fire.count) * Math.PI * 2 + Math.random()
        const reach = size * (0.1 + Math.random() * 0.45)
        blob(
          fireMaterials[i % fireMaterials.length],
          x + Math.cos(yaw) * reach,
          height + size * (0.2 + Math.random() * 0.5),
          y + Math.sin(yaw) * reach,
          size * (0.7 + Math.random() * 0.5),
          FX.fire.life * (0.8 + Math.random() * 0.5),
          Math.random() * 0.04,
          Math.cos(yaw) * size * 1.6,
          size * (0.8 + Math.random()),
          Math.sin(yaw) * size * 1.6,
          0.3,
          0.45,
          3,
        )
      }
      for (let i = 0; i < FX.smoke.count; i++) {
        const yaw = (i / FX.smoke.count) * Math.PI * 2 + Math.random() * 0.7
        const reach = size * (0.25 + Math.random() * 0.6)
        blob(
          smokeMaterial(FX.smoke.colors[i % FX.smoke.colors.length]),
          x + Math.cos(yaw) * reach,
          height + size * (0.15 + Math.random() * 0.8),
          y + Math.sin(yaw) * reach,
          size * (0.35 + Math.random() * 0.5),
          FX.smoke.life * (0.8 + Math.random() * 0.6),
          FX.fire.life * 0.5 + Math.random() * 0.14,
          Math.cos(yaw) * size * 1.3,
          size * (0.6 + Math.random() * 0.9),
          Math.sin(yaw) * size * 1.3,
          0.16,
          0.35,
          2.2,
        )
      }
      spray(x, height + size * 0.3, y, 0, 0, { count: Math.round(28 + size * 10), speed: 9 + size * 3, life: 0.55, color: FX.sparks.blast, spread: 1, lift: 0.5, width: FX.sparks.width * 1.3 })
    },
    update(dt, eye) {
      for (let i = active.length - 1; i >= 0; i--) {
        const item = active[i]
        item.age += dt
        const t = Math.min(1, item.age / item.duration)
        const eased = 1 - (1 - t) ** 3
        const grown = item.from + (item.to - item.from) * eased
        item.mesh.scale.setScalar(eye ? clearOfEye(grown, item.mesh.position.distanceTo(eye)) : grown)
        if (item.rise !== 0) item.mesh.position.y = item.base + item.rise * (1 - (1 - t) ** 2)
        item.mesh.material.opacity = START_OPACITY * (1 - t)
        if (t < 1) continue
        item.mesh.visible = false
        active.splice(i, 1)
        idle.push(item)
      }
      for (let i = blobs.length - 1; i >= 0; i--) {
        const item = blobs[i]
        item.age += dt
        if (item.age >= item.life) {
          item.mesh.visible = false
          spare.push(item.mesh)
          blobs.splice(i, 1)
          continue
        }
        if (item.age <= 0) continue
        const slow = Math.exp(-item.drag * dt)
        item.vx *= slow
        item.vy *= slow
        item.vz *= slow
        item.mesh.position.x += item.vx * dt
        item.mesh.position.y += item.vy * dt
        item.mesh.position.z += item.vz * dt
        item.mesh.visible = true
        const grown = Math.max(0.0001, item.size * blobScale(item.age, item.life, item.grow, item.fade))
        item.mesh.scale.setScalar(eye ? clearOfEye(grown, item.mesh.position.distanceTo(eye)) : grown)
      }
      for (const item of stars) {
        if (!item.sprite.visible) continue
        item.age += dt
        const grow = starScale(item.age)
        item.sprite.visible = grow > 0
        item.sprite.scale.setScalar(item.size * grow)
      }
      let shown = 0
      for (let i = sparks.length - 1; i >= 0; i--) {
        const item = sparks[i]
        item.age += dt
        if (item.age >= item.life) {
          sparks.splice(i, 1)
          continue
        }
        item.vy -= FX.sparks.gravity * dt
        const slow = Math.exp(-FX.sparks.drag * dt)
        item.vx *= slow
        item.vy *= slow
        item.vz *= slow
        item.x += item.vx * dt
        item.y += item.vy * dt
        item.z += item.vz * dt
      }
      for (const item of sparks) {
        const speed = Math.hypot(item.vx, item.vy, item.vz)
        if (speed < 1e-4) continue
        const left = 1 - item.age / item.life
        heading.set(item.vx / speed, item.vy / speed, item.vz / speed)
        turn.setFromUnitVectors(FORWARD, heading)
        position.set(item.x, item.y, item.z)
        scale.set(item.width * left, item.width * left, Math.max(item.width, speed * item.stretch))
        sparkMesh.setMatrixAt(shown, matrix.compose(position, turn, scale))
        sparkMesh.setColorAt(shown, tint.copy(item.color).multiplyScalar(0.35 + left * 0.65))
        shown++
      }
      sparkMesh.count = shown
      sparkMesh.instanceMatrix.needsUpdate = true
      if (sparkMesh.instanceColor) sparkMesh.instanceColor.needsUpdate = true
    },
    clear() {
      for (const item of active) {
        item.mesh.visible = false
        idle.push(item)
      }
      active.length = 0
      for (const item of blobs) {
        item.mesh.visible = false
        spare.push(item.mesh)
      }
      blobs.length = 0
      for (const item of stars) item.sprite.visible = false
      sparks.length = 0
      sparkMesh.count = 0
    },
  }
}
