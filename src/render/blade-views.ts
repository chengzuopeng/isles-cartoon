import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { acrossOf, alongOf, laneMiddle } from '../sim/blades'
import type { BladeLane, BuiltLevel } from '../sim/level'
import { lerp } from '../sim/math'
import type { GameEvent } from '../sim/types'
import type { World } from '../sim/world'
import { bladeShake, bladeYaw, easeSpin, laneEdges, normalizedSpan, reelSpeed, sweepDirection, turnDelta, turnPose, warningSpan, type BladeTurn } from './blade-motion'
import { createDebris, type Debris } from './boss-debris'
import type { Effects } from './effects'
import { instancedDepth } from './instanced-depth'
import { castsShadowAs, onePart } from './landmark-views'
import type { ModelLibrary } from './model-library'
import { atlasGroups, bakeNode, type NodePart } from './node-parts'
import { motionAxis } from './scene-models'
import { BLADE_RIG, BLADE_SPARKS, BLADE_WARNING } from './themes'

export const BLADE_MODEL: string = 'ch1-blade-trap'
export const BLADE_NODES = ['body', 'reel'] as const

export interface BladeLaneLook {
  visible: boolean
  from: number
  to: number
  head: number
}

export interface BladeViews {
  readonly group: THREE.Group
  readonly count: number
  readonly meshCount: number
  readonly model: boolean
  sync(world: World, alpha: number, dt: number): void
  handle(event: GameEvent): void
  lanes(): BladeLaneLook[]
  dispose(): void
}

interface BladeLook {
  body: NodePart[]
  reel: NodePart[]
  reelRest: THREE.Matrix4
  reelAxis: THREE.Vector3
  model: boolean
}

interface BladeSlot {
  facing: number
  shown: number
  turn: BladeTurn | null
  spin: number
  reel: number
}

interface Strip {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  look: BladeLaneLook
}

interface PendingHit {
  index: number
  id: number
  x: number
  y: number
  dodged: boolean
}

const TAU = Math.PI * 2
const UP = new THREE.Vector3(0, 1, 0)
const SAME_SPOT = 1e-6
const DEBRIS_SECONDS = 2.6

const STRIP_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const STRIP_FRAGMENT = `
uniform vec3 uColor;
uniform vec3 uHot;
uniform float uFrom;
uniform float uTo;
uniform float uHead;
uniform float uLength;
uniform float uWidth;
uniform float uTime;
uniform float uOpacity;
uniform float uFlow;
uniform float uStripe;
uniform float uStripeSpeed;
uniform float uHeadSize;
uniform float uEdge;
varying vec2 vUv;

void main() {
  if (vUv.x < uFrom || vUv.x > uTo) discard;
  float along = vUv.x * uLength;
  float across = (vUv.y - 0.5) * uWidth;
  float stripe = step(0.5, fract((along * uFlow + abs(across)) / uStripe - uTime * uStripeSpeed));
  float edge = step(uWidth * 0.5 - uEdge, abs(across));
  float head = exp(-2.0 * abs(along - uHead * uLength) / uHeadSize);
  float alpha = uOpacity * (0.72 + 0.28 * stripe) + edge * 0.28 + head * 0.4;
  vec3 color = mix(uColor, uHot, clamp(head * 0.85 + edge * 0.3, 0.0, 1.0));
  gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.95));
  #include <colorspace_fragment>
}
`

function scatter(radius: number): number {
  return (Math.random() * 2 - 1) * radius
}

function paint(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const tint = new THREE.Color(color)
  const count = geometry.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) colors.set([tint.r, tint.g, tint.b], i * 3)
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

function merged(pieces: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const geometry = mergeGeometries(pieces, false)
  for (const piece of pieces) piece.dispose()
  if (!geometry) throw new Error('blade fallback geometry failed to merge')
  return geometry
}

export function fallbackBody(): THREE.BufferGeometry {
  const F = BLADE_RIG.fallback
  return merged([
    paint(new THREE.BoxGeometry(0.5, 0.42, 1.96).translate(-0.25, 0.29, 0), F.body),
    paint(new THREE.BoxGeometry(0.36, 0.08, 0.72).translate(-0.27, 0.54, 0), F.dark),
    paint(new THREE.BoxGeometry(0.44, 0.44, 0.05).translate(0.16, 0.4, 0.975), F.body),
    paint(new THREE.BoxGeometry(0.44, 0.44, 0.05).translate(0.16, 0.4, -0.975), F.body),
    paint(new THREE.BoxGeometry(0.46, 0.07, 0.02).translate(-0.25, 0.36, 0.99), F.stripe),
    paint(new THREE.BoxGeometry(0.46, 0.07, 0.02).translate(-0.25, 0.36, -0.99), F.stripe),
    paint(new THREE.BoxGeometry(0.06, 0.06, 1.84).translate(0.16, 0.8, 0), F.dark),
    paint(new THREE.CylinderGeometry(0.035, 0.035, 0.46, 6).translate(-0.42, 0.77, -0.72), F.brass),
    paint(new THREE.BoxGeometry(0.1, 0.1, 0.1).translate(-0.12, 0.63, 0.32), F.eye),
  ])
}

export function fallbackReel(): THREE.BufferGeometry {
  const F = BLADE_RIG.fallback
  const pieces = [paint(new THREE.CylinderGeometry(0.13, 0.13, 1.84, 10).rotateX(Math.PI / 2), F.dark)]
  for (let k = 0; k < 6; k++) {
    const fin = new THREE.BoxGeometry(0.22, 0.035, 1.76).rotateZ(0.35).translate(0.23, 0, 0).rotateZ((k / 6) * TAU)
    pieces.push(paint(fin, F.steel))
  }
  return merged(pieces)
}

function compact(parts: NodePart[], owned: { dispose(): void }[]): NodePart[] {
  if (parts.length < 2) return parts
  const single = onePart(parts)
  if (single) {
    owned.push(single.geometry)
    if (single.copied) owned.push(single.material)
    return [single]
  }
  const grouped = atlasGroups(parts)
  owned.push(...grouped.owned)
  return grouped.parts
}

function modelLook(models: ModelLibrary, owned: { dispose(): void }[]): BladeLook | null {
  const id = BLADE_MODEL
  if (!models.has(id)) return null
  const { root, nodes } = models.shared(id)
  root.updateMatrixWorld(true)
  const reel = nodes.get('reel') ?? null
  const reelRest = new THREE.Matrix4()
  if (reel) {
    reelRest.copy(root.matrixWorld).invert().multiply(reel.matrixWorld)
    reel.removeFromParent()
  }
  const body = bakeNode(root, 'root') ?? bakeNode(root, 'body') ?? []
  const spin = reel ? (bakeNode(reel, 'reel') ?? []) : []
  for (const part of [...body, ...spin]) owned.push(part.geometry)
  return { body: compact(body, owned), reel: compact(spin, owned), reelRest, reelAxis: new THREE.Vector3(...motionAxis('y')), model: true }
}

function fallbackLook(owned: { dispose(): void }[]): BladeLook {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.65, metalness: 0.15 })
  const body = fallbackBody()
  const reel = fallbackReel()
  owned.push(material, body, reel)
  return {
    body: [{ geometry: body, material }],
    reel: [{ geometry: reel, material }],
    reelRest: new THREE.Matrix4().makeTranslation(0.16, 0.4, 0),
    reelAxis: new THREE.Vector3(...motionAxis('y')),
    model: false,
  }
}

function stripMaterial(lane: BladeLane): THREE.ShaderMaterial {
  const W = BLADE_WARNING
  const { length } = laneEdges(lane)
  return new THREE.ShaderMaterial({
    vertexShader: STRIP_VERTEX,
    fragmentShader: STRIP_FRAGMENT,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new THREE.Color(W.color) },
      uHot: { value: new THREE.Color(W.hot) },
      uFrom: { value: 0 },
      uTo: { value: 0 },
      uHead: { value: 0 },
      uLength: { value: length },
      uWidth: { value: lane.half * 2 },
      uTime: { value: 0 },
      uOpacity: { value: W.warning },
      uFlow: { value: 1 },
      uStripe: { value: W.stripe },
      uStripeSpeed: { value: W.stripeSpeed },
      uHeadSize: { value: W.head },
      uEdge: { value: W.edge },
    },
  })
}

export function createBladeViews(level: BuiltLevel, models: ModelLibrary, effects: Effects | null = null): BladeViews {
  const group = new THREE.Group()
  const owned: { dispose(): void }[] = []
  const lanes = level.blades
  const count = lanes.length
  const look = count > 0 ? (modelLook(models, owned) ?? fallbackLook(owned)) : null
  const instance = (part: NodePart): THREE.InstancedMesh => {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, count)
    mesh.castShadow = castsShadowAs(part.material)
    mesh.receiveShadow = true
    mesh.customDepthMaterial = instancedDepth(mesh)
    if (look?.model) mesh.userData.model = BLADE_MODEL
    group.add(mesh)
    return mesh
  }
  const bodies = (look?.body ?? []).map(instance)
  const reels = (look?.reel ?? []).map(instance)
  const stripGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  owned.push(stripGeometry)
  const strips: Strip[] = lanes.map((lane) => {
    const material = stripMaterial(lane)
    owned.push(material)
    const mesh = new THREE.Mesh(stripGeometry, material)
    const { length } = laneEdges(lane)
    mesh.position.set(lane.column + lane.width / 2, BLADE_WARNING.height, lane.row + lane.depth / 2)
    if (lane.axis === 'y') mesh.rotation.y = -Math.PI / 2
    mesh.scale.set(length, 1, lane.half * 2)
    mesh.visible = false
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.renderOrder = -5
    group.add(mesh)
    return { mesh, look: { visible: false, from: 0, to: 0, head: 0 } }
  })
  const debris: Debris | null = count > 0 ? createDebris(BLADE_SPARKS.debris) : null
  if (debris) {
    debris.mesh.visible = false
    group.add(debris.mesh)
  }
  const slots: BladeSlot[] = lanes.map((lane) => {
    const facing = Math.atan2(lane.to.y - lane.from.y, lane.to.x - lane.from.x)
    return { facing, shown: facing, turn: null, spin: reelSpeed('rest'), reel: 0 }
  })
  const pending: PendingHit[] = []
  const root = new THREE.Matrix4()
  const reelTurn = new THREE.Matrix4()
  const work = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  const unit = new THREE.Vector3(1, 1, 1)
  let tracked: World | null = null
  let clock = 0
  let debrisUntil = -Infinity

  const burst = (hit: PendingHit, world: World) => {
    const lane = lanes[hit.index]
    const blade = world.blades[hit.index]
    if (!lane || !blade) return
    const style = hit.dodged ? BLADE_SPARKS.dodged : hit.id === world.player.id ? BLADE_SPARKS.player : BLADE_SPARKS.enemy
    const direction = sweepDirection(lane, blade.forward)
    const forwardX = lane.axis === 'x' ? direction : 0
    const forwardY = lane.axis === 'y' ? direction : 0
    const side = acrossOf(lane, hit) < laneMiddle(lane) ? -1 : 1
    const outX = lane.axis === 'y' ? side : 0
    const outY = lane.axis === 'x' ? side : 0
    const S = BLADE_SPARKS
    if (effects) {
      const x = hit.x - forwardX * 0.25
      const z = hit.y - forwardY * 0.25
      effects.puff(x, S.height, z, S.flash, 0.4 * style.flash, 1.5 * style.flash, 0.18)
      effects.puff(x, S.height, z, S.core, 0.16 * style.flash, 0.65 * style.flash, 0.11)
      for (let i = 0; i < style.sparks; i++) {
        effects.puff(
          x + scatter(0.6),
          0.2 + Math.random() * 0.8,
          z + scatter(0.6),
          i % 2 === 0 ? S.spark : S.ember,
          0.22,
          0.04,
          0.25 + Math.random() * 0.2,
          0.5 + Math.random() * 0.6,
        )
      }
      if (style.smoke > 0) effects.burst(hit.x, hit.y, S.smoke, style.smoke)
    }
    if (!debris) return
    for (let i = 0; i < style.chips; i++) {
      const speed = style.push * (0.5 + Math.random() * 0.6)
      debris.emit({
        x: hit.x + scatter(0.2),
        y: 0.35 + Math.random() * 0.4,
        z: hit.y + scatter(0.2),
        vx: (outX * 0.8 + forwardX * 0.6) * speed + scatter(0.8),
        vy: 2.2 + Math.random() * 2.2,
        vz: (outY * 0.8 + forwardY * 0.6) * speed + scatter(0.8),
        color: S.chips[i % S.chips.length],
        length: 0.1 + Math.random() * 0.16,
        width: 0.05 + Math.random() * 0.04,
        life: 1.2 + Math.random() * 0.8,
      })
    }
    debrisUntil = clock + DEBRIS_SECONDS
  }

  const syncStrip = (strip: Strip, lane: BladeLane, world: World, index: number, along: number) => {
    const blade = world.blades[index]
    const span = blade ? warningSpan(lane, blade, along) : null
    strip.mesh.visible = span !== null
    strip.look.visible = span !== null
    if (!span || !blade) return
    const normal = normalizedSpan(lane, span)
    const W = BLADE_WARNING
    const { uniforms } = strip.mesh.material
    uniforms.uFrom.value = normal.from
    uniforms.uTo.value = normal.to
    uniforms.uHead.value = normal.head
    uniforms.uTime.value = clock
    uniforms.uFlow.value = sweepDirection(lane, blade.forward)
    const base = blade.phase === 'sweep' ? W.sweep : W.warning
    uniforms.uOpacity.value = base * (1 + W.pulse * Math.sin(clock * W.pulseRate))
    strip.look.from = normal.from
    strip.look.to = normal.to
    strip.look.head = normal.head
  }

  return {
    group,
    count,
    get meshCount() {
      return bodies.length + reels.length
    },
    model: look?.model ?? false,
    sync(world, alpha, dt) {
      if (count === 0) return
      clock += dt
      const fresh = world !== tracked
      tracked = world
      if (fresh) pending.length = 0
      for (const hit of pending.splice(0)) burst(hit, world)
      lanes.forEach((lane, index) => {
        const blade = world.blades[index]
        const slot = slots[index]
        if (!blade || !slot) return
        const x = lerp(blade.prev.x, blade.pos.x, alpha)
        const y = lerp(blade.prev.y, blade.pos.y, alpha)
        if (fresh) {
          slot.facing = blade.facing
          slot.shown = blade.facing
          slot.turn = null
          slot.spin = reelSpeed(blade.phase)
          slot.reel = 0
        } else if (Math.abs(blade.facing - slot.facing) > 1e-6) {
          slot.turn = { from: slot.shown, delta: turnDelta(slot.shown, blade.facing), start: clock }
          slot.facing = blade.facing
        }
        let shift = 0
        if (slot.turn) {
          const pose = turnPose(slot.turn, clock, lane.reach, lane.half)
          slot.shown = pose.angle
          shift = pose.shift
          if (pose.done) {
            slot.turn = null
            slot.shown = slot.facing
          }
        }
        slot.spin = fresh ? slot.spin : easeSpin(slot.spin, reelSpeed(blade.phase), dt)
        slot.reel = (slot.reel + slot.spin * dt) % TAU
        position.set(x + Math.cos(slot.facing) * shift, bladeShake(blade.phase, clock, index * 2.3), y + Math.sin(slot.facing) * shift)
        rotation.setFromAxisAngle(UP, bladeYaw(slot.shown))
        root.compose(position, rotation, unit)
        for (const mesh of bodies) mesh.setMatrixAt(index, root)
        if (look && reels.length > 0) {
          work.multiplyMatrices(root, look.reelRest).multiply(reelTurn.makeRotationAxis(look.reelAxis, slot.reel))
          for (const mesh of reels) mesh.setMatrixAt(index, work)
        }
        const strip = strips[index]
        if (strip) syncStrip(strip, lane, world, index, alongOf(lane, { x, y }))
      })
      for (const mesh of [...bodies, ...reels]) {
        mesh.instanceMatrix.needsUpdate = true
        mesh.computeBoundingSphere()
      }
      if (debris) {
        debris.update(dt)
        debris.mesh.visible = clock < debrisUntil
      }
    },
    handle(event) {
      if (count === 0) return
      if (event.type === 'bladeHit') {
        pending.push({ index: event.index, id: event.id, x: event.x, y: event.y, dodged: false })
        return
      }
      if (event.type !== 'dodged') return
      const hit = pending.find((item) => !item.dodged && Math.abs(item.x - event.x) < SAME_SPOT && Math.abs(item.y - event.y) < SAME_SPOT)
      if (hit) hit.dodged = true
    },
    lanes: () => strips.map((strip) => ({ ...strip.look })),
    dispose() {
      for (const mesh of [...bodies, ...reels]) {
        mesh.removeFromParent()
        mesh.dispose()
      }
      for (const strip of strips) strip.mesh.removeFromParent()
      debris?.dispose()
      group.clear()
      for (const resource of owned) resource.dispose()
      owned.length = 0
      pending.length = 0
    },
  }
}
