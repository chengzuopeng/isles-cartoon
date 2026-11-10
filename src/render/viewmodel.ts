import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { ModelId } from './asset-urls'
import { clipGeometry, isClipBox } from './clip-geometry'
import type { ModelLibrary } from './model-library'
import { INK_COLOR, toonMaterial, toonify } from './toon'

export interface ViewmodelState {
  dt: number
  lookX: number
  lookY: number
  speed: number
  grounded: boolean
  dashing: boolean
  weapon: string
  ammo: number
  magazine: number
  reload: number
  ultimate: boolean
  supporting: boolean
  alive: boolean
}

export interface Viewmodel {
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  update(state: ViewmodelState): void
  shot(): void
  melee(): void
  switched(): void
  jumped(): void
  landed(fall: number): void
  muzzle(worldCamera: THREE.PerspectiveCamera, out: THREE.Vector3): THREE.Vector3 | null
  draw(renderer: THREE.WebGLRenderer): void
  resize(width: number, height: number): void
  setVisible(visible: boolean): void
}

const HULL_VERTEX = /* glsl */ `
uniform float hullWidth;
uniform vec2 resolution;
void main() {
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vec4 clip = projectionMatrix * view;
  vec3 n = normalize(normalMatrix * normal);
  vec2 direction = (projectionMatrix * vec4(n, 0.0)).xy;
  float size = length(direction);
  if (size > 0.0001) clip.xy += direction / size * hullWidth * clip.w * 2.0 / resolution;
  gl_Position = clip;
}
`

const HULL_FRAGMENT = /* glsl */ `
uniform vec3 inkColor;
void main() {
  gl_FragColor = vec4(inkColor, 1.0);
}
`

const REST = new THREE.Vector3(0.17, -0.1, -0.41)
const HOLD = new THREE.Euler(0.05, 2.15, 0.06, 'ZXY')
const GUN_SCALE = 0.62
const RAISE = { drop: 0.22, tilt: 0.7, rate: 7 }
const TRIGGER_PULL = 0.28
const LEFT_GRIP = { pivot: new THREE.Vector3(0.22, 0.065, 0), swing: -0.7, show: 0.35, rate: 14 }
const KEY_LIGHT = new THREE.Vector3(-2.4, 3.4, 2.8)
const MUZZLE_FLASH = {
  energy: '#7ff6ff',
  powder: '#ffd84a',
  core: '#ffffff',
  glow: 1,
  coreGlow: 1.15,
  ink: { outer: 0.1, inner: 0.04 },
  color: { outer: 0.082, inner: 0.032 },
  white: { outer: 0.04, inner: 0.018 },
  seconds: 0.06,
} as const
const COIL_LIT = new THREE.Color('#5ff0ff')
const COIL_DIM = new THREE.Color('#1c3c48')
const COIL_GLOW = { lit: 0.85, dim: 0.12, charge: 0.6, core: 0.2, shade: 0.4 }
const FIRST_PERSON_MODELS: Readonly<Partial<Record<string, ModelId>>> = {
  blaster: 'fp-blaster',
  shotgun: 'fp-shotgun',
  smg: 'fp-smg',
  sniper: 'fp-sniper',
  grenade: 'fp-grenade',
  ricochet: 'fp-ricochet',
  flamer: 'fp-flamer',
  frost: 'fp-frost',
  rocket: 'fp-rocket',
  arc: 'fp-arc',
}
const PETAL_OPEN = 1.05
const MUZZLE_FALLBACK = new THREE.Vector3(0.36, 0.08, 0)
const UP = new THREE.Vector3(0, 1, 0)
const PULL = new THREE.Quaternion()

interface ArmRig {
  root: THREE.Object3D
  index: THREE.Object3D | null
  indexRest: THREE.Quaternion
  left: THREE.Object3D | null
}

interface Coil {
  material: THREE.MeshStandardMaterial | THREE.MeshToonMaterial
  base: THREE.Color
}

interface WeaponRig {
  id: string
  root: THREE.Object3D
  muzzle: THREE.Object3D | null
  petals: { node: THREE.Object3D; axis: THREE.Vector3; rest: THREE.Quaternion }[]
  coils: Coil[]
}

function hullGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const plain = new THREE.BufferGeometry()
  plain.setAttribute('position', geometry.getAttribute('position').clone())
  if (geometry.index) plain.setIndex(geometry.index.clone())
  const merged = mergeVertices(plain, 1e-4)
  merged.computeVertexNormals()
  plain.dispose()
  return merged
}

function addHulls(root: THREE.Object3D, material: THREE.ShaderMaterial): void {
  const meshes: THREE.Mesh[] = []
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (mesh.isMesh && !mesh.userData.hull && !mesh.userData.noHull) meshes.push(mesh)
  })
  for (const mesh of meshes) {
    const hull = new THREE.Mesh(hullGeometry(mesh.geometry), material)
    hull.userData.hull = true
    hull.renderOrder = -1
    mesh.add(hull)
  }
}

function splitByAxis(geometry: THREE.BufferGeometry, parts: number): THREE.BufferGeometry[] {
  const source = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  const position = source.getAttribute('position')
  const normal = source.getAttribute('normal')
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < position.count; i++) {
    min = Math.min(min, position.getX(i))
    max = Math.max(max, position.getX(i))
  }
  const buckets: number[][] = Array.from({ length: parts }, () => [])
  for (let triangle = 0; triangle < position.count / 3; triangle++) {
    const x = (position.getX(triangle * 3) + position.getX(triangle * 3 + 1) + position.getX(triangle * 3 + 2)) / 3
    const slot = Math.min(parts - 1, Math.max(0, Math.floor(((x - min) / Math.max(max - min, 1e-6)) * parts)))
    buckets[slot].push(triangle)
  }
  const result = buckets.map((triangles) => {
    const positions = new Float32Array(triangles.length * 9)
    const normals = new Float32Array(triangles.length * 9)
    triangles.forEach((triangle, index) => {
      for (let corner = 0; corner < 3; corner++) {
        const from = triangle * 3 + corner
        const to = (index * 3 + corner) * 3
        positions[to] = position.getX(from)
        positions[to + 1] = position.getY(from)
        positions[to + 2] = position.getZ(from)
        if (normal) {
          normals[to] = normal.getX(from)
          normals[to + 1] = normal.getY(from)
          normals[to + 2] = normal.getZ(from)
        }
      }
    })
    const part = new THREE.BufferGeometry()
    part.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    part.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    return part
  })
  source.dispose()
  return result
}

function coilNodes(root: THREE.Object3D): THREE.Object3D[] {
  const nodes: THREE.Object3D[] = []
  root.traverse((object) => {
    if (/^coil_\d+$/.test(object.name)) nodes.push(object)
  })
  return nodes.sort((a, b) => Number(a.name.slice(5)) - Number(b.name.slice(5)))
}

function buildWeapon(models: ModelLibrary, id: string, hull: THREE.ShaderMaterial): WeaponRig | null {
  const variant = FIRST_PERSON_MODELS[id]
  const model = variant && models.has(variant) ? variant : id
  if (!models.has(model)) return null
  const instance = models.instance(model as ModelId)
  const root = instance.root
  toonify(root)
  const coils: Coil[] = []
  for (const node of coilNodes(root)) {
    node.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      const material = (mesh.material as THREE.MeshStandardMaterial).clone()
      material.emissive = COIL_LIT.clone()
      material.emissiveIntensity = COIL_GLOW.lit
      mesh.material = material
      coils.push({ material, base: material.color.clone() })
    })
  }
  const glowMeshes: THREE.Mesh[] = []
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const material = mesh.material as THREE.Material
    if (material.name === 'mat_glow') glowMeshes.push(mesh)
    if (material.name.startsWith('mat_glow')) (material as THREE.MeshToonMaterial).emissiveIntensity = material.name === 'mat_glow_core' ? COIL_GLOW.core : COIL_GLOW.lit
  })
  if (id === 'blaster' && coils.length === 0 && glowMeshes.length > 0) {
    const glow = glowMeshes[0]
    const pieces = splitByAxis(glow.geometry, 3)
    pieces.forEach((piece) => {
      const material = toonMaterial({ color: '#bdf6ff', emissive: COIL_LIT, emissiveIntensity: COIL_GLOW.lit })
      const mesh = new THREE.Mesh(piece, material)
      mesh.position.copy(glow.position)
      mesh.quaternion.copy(glow.quaternion)
      mesh.scale.copy(glow.scale)
      mesh.userData.noHull = true
      glow.parent?.add(mesh)
      coils.push({ material, base: material.color.clone() })
    })
    glow.visible = false
    glow.userData.noHull = true
  }
  addHulls(root, hull)
  const muzzle = root.getObjectByName('socket_muzzle') ?? null
  const center = muzzle ? muzzle.position.clone() : MUZZLE_FALLBACK.clone()
  const petals: WeaponRig['petals'] = []
  root.traverse((object) => {
    if (!/^petal_\d$/.test(object.name)) return
    const radial = new THREE.Vector3(0, object.position.y - center.y, object.position.z - center.z)
    if (radial.lengthSq() < 1e-8) radial.set(0, 1, 0)
    radial.normalize()
    petals.push({ node: object, axis: new THREE.Vector3(0, -radial.z, radial.y), rest: object.quaternion.clone() })
  })
  return { id, root, muzzle, petals, coils }
}

function buildArms(models: ModelLibrary, hull: THREE.ShaderMaterial): ArmRig | null {
  if (!models.has('fp-arms')) return null
  const { root } = models.instance('fp-arms')
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (mesh.isMesh && isClipBox(mesh.userData.clip)) mesh.geometry = clipGeometry(mesh.geometry, mesh.userData.clip)
  })
  toonify(root)
  addHulls(root, hull)
  const index = root.getObjectByName('index_r') ?? null
  const arm = root.getObjectByName('arm_l') ?? null
  let left: THREE.Object3D | null = null
  if (arm) {
    left = new THREE.Group()
    left.position.copy(LEFT_GRIP.pivot)
    root.add(left)
    arm.position.sub(LEFT_GRIP.pivot)
    left.add(arm)
    left.visible = false
  }
  return {
    root,
    index,
    indexRest: index ? index.quaternion.clone() : new THREE.Quaternion(),
    left,
  }
}

function starGeometry(outer: number, inner: number, depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? outer : inner
    const angle = Math.PI / 2 + (i * Math.PI) / 5
    const x = Math.cos(angle) * radius
    const y = Math.sin(angle) * radius
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false })
  geometry.translate(0, 0, -depth / 2)
  return geometry
}

function worldTan(camera: THREE.PerspectiveCamera): number {
  return Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
}

function damp(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt)
}

export function createViewmodel(models: ModelLibrary): Viewmodel {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, 1, 0.02, 10)
  const hemisphere = new THREE.HemisphereLight('#d9ebff', '#9a8a68', 1.25)
  const sun = new THREE.DirectionalLight('#fff0d4', 2.5)
  sun.position.copy(KEY_LIGHT)
  scene.add(hemisphere, sun, sun.target)
  const hull = new THREE.ShaderMaterial({
    vertexShader: HULL_VERTEX,
    fragmentShader: HULL_FRAGMENT,
    side: THREE.BackSide,
    uniforms: {
      hullWidth: { value: 2.4 },
      resolution: { value: new THREE.Vector2(1920, 1080) },
      inkColor: { value: INK_COLOR.clone() },
    },
  })

  const rig = new THREE.Group()
  rig.position.copy(REST)
  scene.add(rig)
  const holder = new THREE.Group()
  holder.rotation.copy(HOLD)
  holder.scale.setScalar(GUN_SCALE)
  rig.add(holder)

  const flashLayer = (outer: number, inner: number, color: THREE.ColorRepresentation, order: number) => {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide })
    const mesh = new THREE.Mesh(starGeometry(outer, inner, 0.001), material)
    mesh.renderOrder = order
    mesh.userData.noHull = true
    return mesh
  }
  const flashInk = flashLayer(MUZZLE_FLASH.ink.outer, MUZZLE_FLASH.ink.inner, INK_COLOR, 10)
  const flashColor = flashLayer(MUZZLE_FLASH.color.outer, MUZZLE_FLASH.color.inner, new THREE.Color(MUZZLE_FLASH.energy).multiplyScalar(MUZZLE_FLASH.glow), 11)
  const flashCore = flashLayer(MUZZLE_FLASH.white.outer, MUZZLE_FLASH.white.inner, new THREE.Color(MUZZLE_FLASH.core).multiplyScalar(MUZZLE_FLASH.coreGlow), 12)
  const flash = new THREE.Group()
  flash.add(flashInk, flashColor, flashCore)
  flash.visible = false
  flash.userData.noHull = true

  const weapons = new Map<string, WeaponRig | null>()
  let current: WeaponRig | null = null
  let arms: ArmRig | null = null
  let raise = 1
  let wasAlive = false
  let trigger = 0
  let support = 0
  let swayX = 0
  let swayY = 0
  let bobTime = 0
  let bobAmount = 0
  let recoil = 0
  let meleeTime = -1
  let switchTime = -1
  let jumpOffset = 0
  let jumpVelocity = 0
  let dashTilt = 0
  let petals = 0
  let flashTime = 0
  let visible = true

  const equip = (id: string) => {
    if (current?.id === id) return
    let next = weapons.get(id)
    if (next === undefined) {
      next = buildWeapon(models, id, hull)
      weapons.set(id, next)
    }
    if (!next) {
      next = weapons.get('blaster') ?? buildWeapon(models, 'blaster', hull)
      weapons.set('blaster', next)
    }
    if (current) holder.remove(current.root)
    current = next
    if (current) {
      holder.add(current.root)
      ;(current.muzzle ?? current.root).add(flash)
      if (!current.muzzle) flash.position.copy(MUZZLE_FALLBACK)
      flash.rotation.set(0, Math.PI / 2, 0)
    }
  }

  return {
    scene,
    camera,
    update(state) {
      const { dt } = state
      equip(state.weapon)
      if (!arms) {
        arms = buildArms(models, hull)
        if (arms) holder.add(arms.root)
      }
      if (state.alive && !wasAlive) raise = 1
      wasAlive = state.alive
      raise = damp(raise, 0, RAISE.rate, dt)
      trigger = damp(trigger, 0, 18, dt)
      support = damp(support, state.supporting ? 1 : 0, LEFT_GRIP.rate, dt)
      rig.visible = visible && state.alive

      swayX = damp(swayX, THREE.MathUtils.clamp(-state.lookX * 0.0006, -0.04, 0.04), 9, dt)
      swayY = damp(swayY, THREE.MathUtils.clamp(state.lookY * 0.0006, -0.035, 0.035), 9, dt)
      const moving = state.grounded && state.speed > 0.5 ? Math.min(1, state.speed / 6) : 0
      bobAmount = damp(bobAmount, moving, 8, dt)
      bobTime += dt * (2 + state.speed * 1.35)
      recoil = damp(recoil, 0, 14, dt)
      dashTilt = damp(dashTilt, state.dashing ? 1 : 0, 12, dt)
      petals = damp(petals, state.ultimate ? 1 : 0, 10, dt)
      jumpVelocity += (-jumpOffset * 90 - jumpVelocity * 12) * dt
      jumpOffset += jumpVelocity * dt
      flashTime = Math.max(0, flashTime - dt)
      flash.visible = flashTime > 0
      flash.scale.setScalar(0.7 + flashTime * 8)
      flash.rotation.z += dt * 9

      let swing = 0
      let thrust = 0
      if (meleeTime >= 0) {
        meleeTime += dt
        const t = meleeTime / 0.32
        if (t >= 1) meleeTime = -1
        else {
          const wind = t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7
          swing = Math.sin(Math.min(1, t * 1.6) * Math.PI) * 1
          thrust = wind
        }
      }
      let lower = 0
      if (switchTime >= 0) {
        switchTime += dt
        const t = switchTime / 0.35
        if (t >= 1) switchTime = -1
        else lower = Math.sin(t * Math.PI)
      }

      const bobX = Math.sin(bobTime) * 0.008 * bobAmount
      const bobY = -Math.abs(Math.cos(bobTime)) * 0.009 * bobAmount + Math.sin(bobTime * 0.35) * 0.002
      rig.position.set(
        REST.x + swayX + bobX - thrust * 0.06 - dashTilt * 0.015,
        REST.y + swayY + bobY - lower * 0.16 + jumpOffset - thrust * 0.015 - raise * RAISE.drop,
        REST.z + recoil * 0.045 - thrust * 0.08,
      )
      rig.rotation.set(recoil * 0.22 + swing * 0.35 + swayY * 2 - raise * RAISE.tilt, swayX * 2.5 + swing * 0.55, -dashTilt * 0.25 - swing * 0.4)

      if (arms) {
        if (arms.index) arms.index.quaternion.copy(arms.indexRest).multiply(PULL.setFromAxisAngle(UP, trigger * TRIGGER_PULL))
        if (arms.left) {
          arms.left.visible = support > LEFT_GRIP.show
          arms.left.rotation.x = (1 - support) * LEFT_GRIP.swing
        }
      }

      if (current) {
        current.petals.forEach((petal) => {
          petal.node.quaternion.copy(petal.rest)
          if (petals > 0.001) petal.node.rotateOnAxis(petal.axis, petals * PETAL_OPEN)
        })
        const filled = state.magazine > 0 ? (state.ammo / state.magazine) * current.coils.length : 0
        current.coils.forEach(({ material, base }, index) => {
          const lit = index < filled - 1e-6
          const charging = !lit && index === Math.floor(filled) ? state.reload : 0
          material.emissive.copy(lit ? COIL_LIT : COIL_DIM).lerp(COIL_LIT, charging * 0.5)
          material.emissiveIntensity = lit ? COIL_GLOW.lit : COIL_GLOW.dim + charging * COIL_GLOW.charge
          material.color.copy(base).multiplyScalar(lit ? 1 : COIL_GLOW.shade + charging * (1 - COIL_GLOW.shade))
        })
      }
    },
    shot() {
      recoil = Math.min(1.4, recoil + 1)
      flashTime = MUZZLE_FLASH.seconds
      flash.rotation.z = Math.random() * Math.PI
      flashColor.material.color.set(current?.id === 'blaster' ? MUZZLE_FLASH.energy : MUZZLE_FLASH.powder).multiplyScalar(MUZZLE_FLASH.glow)
      trigger = 1
    },
    melee() {
      meleeTime = 0
    },
    switched() {
      switchTime = 0
    },
    jumped() {
      jumpVelocity -= 0.25
    },
    landed(fall) {
      jumpVelocity -= Math.min(0.6, 0.15 + fall * 0.12)
    },
    muzzle(worldCamera, out) {
      if (!rig.visible) return null
      rig.updateMatrixWorld(true)
      if (current?.muzzle) current.muzzle.getWorldPosition(out)
      else out.set(REST.x, REST.y + 0.05, REST.z - 0.4)
      const depth = -out.z
      out.project(camera)
      out.set(out.x * worldCamera.aspect * worldTan(worldCamera), out.y * worldTan(worldCamera), -1).multiplyScalar(depth)
      return out.applyMatrix4(worldCamera.matrixWorld)
    },
    draw(renderer) {
      if (!rig.visible) return
      renderer.render(scene, camera)
    },
    resize(width, height) {
      camera.aspect = width / Math.max(1, height)
      camera.updateProjectionMatrix()
      hull.uniforms.resolution.value.set(width, height)
      hull.uniforms.hullWidth.value = Math.max(1.5, 2.4 * (height / 1080))
    },
    setVisible(next) {
      visible = next
    },
  }
}
