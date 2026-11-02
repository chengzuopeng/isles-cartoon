import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { ModelId } from './asset-urls'
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
  alive: boolean
}

export interface Viewmodel {
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  update(state: ViewmodelState, worldCamera: THREE.Camera, sun: THREE.Vector3): void
  shot(): void
  melee(): void
  switched(): void
  jumped(): void
  landed(fall: number): void
  muzzle(worldCamera: THREE.PerspectiveCamera, out: THREE.Vector3): THREE.Vector3
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

const REST = new THREE.Vector3(0.15, -0.105, -0.42)
const GUN_SCALE = 0.55
const ARM_SCALE = 0.78
const COIL_LIT = new THREE.Color('#5ff0ff')
const COIL_DIM = new THREE.Color('#1c3c48')
const PETAL_OPEN = 1.05
const MUZZLE_FALLBACK = new THREE.Vector3(0.36, 0.08, 0)

interface WeaponRig {
  id: string
  root: THREE.Object3D
  muzzle: THREE.Object3D | null
  petals: { node: THREE.Object3D; axis: THREE.Vector3; rest: THREE.Quaternion }[]
  coils: THREE.MeshToonMaterial[]
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

function buildWeapon(models: ModelLibrary, id: string, hull: THREE.ShaderMaterial): WeaponRig | null {
  if (!models.has(id)) return null
  const instance = models.instance(id as ModelId)
  const root = instance.root
  toonify(root)
  const coils: THREE.MeshToonMaterial[] = []
  const glowMeshes: THREE.Mesh[] = []
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const material = mesh.material as THREE.Material
    if (material.name === 'mat_glow') glowMeshes.push(mesh)
    if (material.name.startsWith('mat_glow')) (material as THREE.MeshToonMaterial).emissiveIntensity = 2.4
  })
  if (id === 'blaster' && glowMeshes.length > 0) {
    const glow = glowMeshes[0]
    const pieces = splitByAxis(glow.geometry, 3)
    pieces.forEach((piece) => {
      const material = toonMaterial({ color: '#bdf6ff', emissive: COIL_LIT, emissiveIntensity: 2.4 })
      const mesh = new THREE.Mesh(piece, material)
      mesh.position.copy(glow.position)
      mesh.quaternion.copy(glow.quaternion)
      mesh.scale.copy(glow.scale)
      mesh.userData.noHull = true
      glow.parent?.add(mesh)
      coils.push(material)
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

function capsule(radius: number, length: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 3, 8), material)
  return mesh
}

function buildArm(): THREE.Group {
  const arm = new THREE.Group()
  const orange = toonMaterial({ color: '#e8742a' })
  const cuff = toonMaterial({ color: '#5a3a26' })
  const glove = toonMaterial({ color: '#2b2523' })
  const plate = toonMaterial({ color: '#8d9298' })
  const skin = toonMaterial({ color: '#f2b98f' })
  const patch = toonMaterial({ color: '#2a2524' })
  const star = toonMaterial({ color: '#fbf3e2' })

  const forearm = new THREE.Group()
  forearm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0.58, -0.42, 0.7).normalize())
  arm.add(forearm)
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.092, 0.62, 12, 1, true), orange)
  sleeve.rotation.x = Math.PI / 2
  sleeve.position.z = 0.42
  forearm.add(sleeve)
  const fold = new THREE.Mesh(new THREE.TorusGeometry(0.069, 0.012, 6, 14), orange)
  fold.position.z = 0.12
  forearm.add(fold)
  const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.012, 18), patch)
  badge.rotation.z = Math.PI / 2
  badge.position.set(0.078, 0.02, 0.3)
  forearm.add(badge)
  const badgeStar = new THREE.Mesh(starGeometry(0.028, 0.012, 0.006), star)
  badgeStar.rotation.y = Math.PI / 2
  badgeStar.position.set(0.085, 0.02, 0.3)
  forearm.add(badgeStar)
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.06, 0.07, 12), cuff)
  band.rotation.x = Math.PI / 2
  band.position.z = 0.075
  forearm.add(band)
  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.047, 0.05, 10), skin)
  wrist.rotation.x = Math.PI / 2
  wrist.position.z = 0.03
  forearm.add(wrist)

  const hand = new THREE.Group()
  hand.position.set(0.012, -0.03, 0.004)
  arm.add(hand)
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.088, 0.086), glove)
  palm.position.set(0.02, -0.004, 0.0)
  hand.add(palm)
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.05, 0.056), plate)
  back.position.set(0.057, 0.004, 0.0)
  hand.add(back)
  for (let i = 0; i < 4; i++) {
    const y = 0.026 - i * 0.022
    const finger = capsule(0.0115, 0.042, glove)
    finger.rotation.set(0, -0.5, Math.PI / 2)
    finger.position.set(-0.016, y, -0.04)
    hand.add(finger)
    const tip = capsule(0.0085, 0.004, skin)
    tip.rotation.set(0, -0.9, Math.PI / 2)
    tip.position.set(-0.04, y, -0.026)
    hand.add(tip)
  }
  const thumb = capsule(0.013, 0.05, glove)
  thumb.rotation.set(Math.PI / 2, 0, 0.35)
  thumb.position.set(-0.03, 0.04, -0.02)
  hand.add(thumb)
  const thumbTip = capsule(0.0085, 0.006, skin)
  thumbTip.rotation.set(Math.PI / 2, 0, 0.35)
  thumbTip.position.set(-0.036, 0.042, -0.06)
  hand.add(thumbTip)
  return arm
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

function damp(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt)
}

export function createViewmodel(models: ModelLibrary): Viewmodel {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, 1, 0.02, 10)
  const hemisphere = new THREE.HemisphereLight('#d9ebff', '#9a8a68', 1.25)
  const sun = new THREE.DirectionalLight('#fff0d4', 2.5)
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
  holder.rotation.set(0.04, Math.PI / 2 + 0.07, 0)
  holder.scale.setScalar(GUN_SCALE)
  rig.add(holder)
  const arm = buildArm()
  arm.scale.setScalar(ARM_SCALE)
  rig.add(arm)
  addHulls(arm, hull)

  const flashMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color('#d6fbff').multiplyScalar(3), transparent: true, depthWrite: false, side: THREE.DoubleSide })
  const flash = new THREE.Mesh(starGeometry(0.16, 0.05, 0.001), flashMaterial)
  flash.visible = false
  flash.userData.noHull = true

  const weapons = new Map<string, WeaponRig | null>()
  let current: WeaponRig | null = null
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
  const sunView = new THREE.Vector3()
  const inverse = new THREE.Matrix4()

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
    update(state, worldCamera, sunDirection) {
      const { dt } = state
      equip(state.weapon)
      rig.visible = visible && state.alive
      inverse.copy(worldCamera.matrixWorld).invert()
      sunView.copy(sunDirection).transformDirection(inverse)
      sun.position.copy(sunView).multiplyScalar(5)
      sun.target.position.set(0, 0, 0)

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
        REST.y + swayY + bobY - lower * 0.16 + jumpOffset - thrust * 0.015,
        REST.z + recoil * 0.045 - thrust * 0.08,
      )
      rig.rotation.set(recoil * 0.22 + swing * 0.35 + swayY * 2, swayX * 2.5 + swing * 0.55, -dashTilt * 0.25 - swing * 0.4)

      if (current) {
        current.petals.forEach((petal) => {
          petal.node.quaternion.copy(petal.rest)
          if (petals > 0.001) petal.node.rotateOnAxis(petal.axis, petals * PETAL_OPEN)
        })
        current.coils.forEach((material, index) => {
          const lit = index < state.ammo
          const charging = !lit && index === state.ammo ? state.reload : 0
          material.emissive.copy(lit ? COIL_LIT : COIL_DIM).lerp(COIL_LIT, charging * 0.5)
          material.emissiveIntensity = lit ? 2.4 : 0.35 + charging * 1.2
        })
      }
    },
    shot() {
      recoil = Math.min(1.4, recoil + 1)
      flashTime = 0.06
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
      rig.updateMatrixWorld(true)
      if (current?.muzzle) current.muzzle.getWorldPosition(out)
      else out.set(REST.x, REST.y + 0.05, REST.z - 0.4)
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
