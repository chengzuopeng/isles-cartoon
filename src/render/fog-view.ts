import * as THREE from 'three'
import { FOG } from '../data/fog'
import type { BuiltLevel } from '../sim/level'
import type { World } from '../sim/world'
import {
  createFade,
  createMaskWork,
  DISSOLVE_CHANNELS,
  dissolveDelay,
  dissolveMask,
  fogSpan,
  fogTargets,
  lampSources,
  litLamps,
  retarget,
  settleFade,
  settlesBy,
  snapshotMask,
  type FogFade,
  type FogSpan,
} from './fog-motion'
import { fogNoiseSteps } from './fog-noise'
import { finish, type Steps } from './slices'
import { FOG_LAYER } from './themes'

export interface FogView {
  readonly group: THREE.Group
  readonly active: boolean
  update(world: World, dt: number): void
  dispose(): void
}

const VERTEX = `
uniform vec4 uRect;
uniform float uScale;
uniform vec2 uDrift;
uniform float uTime;
uniform float uNoiseScale;
varying vec2 vGround;
varying vec2 vUv;
varying vec4 vNoise;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec3 ray = world.xyz - cameraPosition;
  float down = max(1e-3, -ray.y);
  vec2 ground = world.xz + ray.xz * (world.y / down);
  vGround = ground;
  vUv = (ground - uRect.xy) / uRect.zw;
  vec2 p = ground * uScale + uDrift * uTime;
  vNoise = vec4(p * uNoiseScale, (p * 1.7 - uDrift * uTime * 0.6 + 31.0) * uNoiseScale);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const FRAGMENT = `
uniform sampler2D uNoise;
uniform sampler2D uMask;
uniform vec2 uPlayer;
uniform float uSight;
uniform float uClear;
uniform float uEdge;
uniform float uSince;
uniform float uFade;
uniform float uDensity;
uniform vec3 uColor;
uniform vec3 uShade;
varying vec2 vGround;
varying vec2 vUv;
varying vec4 vNoise;

float rampArea(float x) {
  float clamped = clamp(x, 0.0, 1.0);
  return 0.5 * clamped * clamped + max(x - 1.0, 0.0);
}

float fogMask(vec2 uv) {
  vec4 cell = texture2D(uMask, uv);
  if (cell.g <= 1e-4) return clamp(cell.r, 0.0, 1.0);
  float mean = cell.b / cell.g;
  float spread = sqrt(max(cell.a / cell.g - mean * mean, 0.0) * 3.0) / uFade;
  float x = (uSince - mean) / uFade;
  float ramp = clamp(x, 0.0, 1.0);
  if (spread > 1e-3 && x - spread < 1.0 && x + spread > 0.0) ramp = (rampArea(x + spread) - rampArea(x - spread)) / (2.0 * spread);
  return clamp(cell.r - cell.g * ramp, 0.0, 1.0);
}

void main() {
  float inside = step(0.0, vUv.x) * step(vUv.x, 1.0) * step(0.0, vUv.y) * step(vUv.y, 1.0);
  float clear = smoothstep(uSight - uClear, uSight + uEdge, distance(vGround, uPlayer));
  float mask = clear > 0.0 && inside > 0.0 ? fogMask(vUv) : 0.0;
  if (mask <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }
  float n = texture2D(uNoise, vNoise.xy).r;
  float m = texture2D(uNoise, vNoise.zw).g;
  float density = mask * clear * uDensity * clamp(0.45 + 1.1 * n * (0.6 + 0.8 * m), 0.0, 1.3);
  vec3 color = mix(uShade, uColor, smoothstep(0.25, 0.85, n));
  gl_FragColor = vec4(color, clamp(density, 0.0, 1.0));
  #include <colorspace_fragment>
}
`

const INACTIVE: FogView = {
  group: new THREE.Group(),
  active: false,
  update() {},
  dispose() {},
}

let noiseData: Uint8Array | null = null

function* noiseSteps(): Steps<Uint8Array> {
  noiseData ??= yield* fogNoiseSteps(FOG_LAYER.noise)
  return noiseData
}

function noiseTexture(data: Uint8Array): THREE.DataTexture {
  const { size } = FOG_LAYER.noise
  const texture = new THREE.DataTexture(data, size, size, THREE.RGFormat, THREE.UnsignedByteType)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

export function createFogView(level: BuiltLevel): FogView {
  return finish(buildFogView(level))
}

export function* buildFogView(level: BuiltLevel): Steps<FogView> {
  const span = fogSpan(level, FOG_LAYER.margin)
  if (!span) return { ...INACTIVE, group: new THREE.Group() }
  return fogLayers(level, span, noiseTexture(yield* noiseSteps()))
}

function fogLayers(level: BuiltLevel, span: FogSpan, noise: THREE.DataTexture): FogView {
  const group = new THREE.Group()
  const size = span.rows * span.columns
  const fade: FogFade = createFade(size)
  const target = new Float32Array(size)
  const packed = new Float32Array(size * DISSOLVE_CHANNELS)
  const work = createMaskWork(size)
  const halves = new Uint16Array(size * DISSOLVE_CHANNELS)
  const mask = new THREE.DataTexture(halves, span.columns, span.rows, THREE.RGBAFormat, THREE.HalfFloatType)
  mask.magFilter = THREE.LinearFilter
  mask.minFilter = THREE.LinearFilter
  mask.wrapS = THREE.ClampToEdgeWrapping
  mask.wrapT = THREE.ClampToEdgeWrapping
  mask.generateMipmaps = false
  mask.needsUpdate = true
  const geometry = new THREE.PlaneGeometry(span.columns, span.rows).rotateX(-Math.PI / 2)
  const materials: THREE.ShaderMaterial[] = []
  const player = new THREE.Vector2(level.playerStart.x, level.playerStart.y)
  const time = { value: 0 }
  const since = { value: 0 }
  const fadeSeconds = { value: Math.max(FOG_LAYER.fade, 1e-4) }
  for (const layer of FOG_LAYER.layers) {
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uNoise: { value: noise },
        uNoiseScale: { value: 1 / FOG_LAYER.noise.period },
        uMask: { value: mask },
        uRect: { value: new THREE.Vector4(0, span.top, span.columns, span.rows) },
        uPlayer: { value: player },
        uSight: { value: FOG.sight },
        uClear: { value: FOG_LAYER.clear },
        uEdge: { value: FOG_LAYER.edge },
        uTime: time,
        uSince: since,
        uFade: fadeSeconds,
        uDensity: { value: layer.density },
        uScale: { value: layer.scale },
        uDrift: { value: new THREE.Vector2(layer.drift[0], layer.drift[1]) },
        uColor: { value: new THREE.Color(FOG_LAYER.color) },
        uShade: { value: new THREE.Color(FOG_LAYER.shade) },
      },
    })
    materials.push(material)
    const plane = new THREE.Mesh(geometry, material)
    plane.position.set(span.columns / 2, layer.height, span.top + span.rows / 2)
    plane.renderOrder = layer.order
    plane.castShadow = false
    plane.receiveShadow = false
    plane.userData.fog = true
    group.add(plane)
  }

  let tracked: World | null = null
  let lamps: boolean[] = []
  let clock = 0
  let ref = 0
  let snapshotsUntil = 0

  const upload = () => {
    ref = clock
    since.value = 0
    if (snapshotsUntil > clock) snapshotMask(fade, span, FOG_LAYER.blur, clock, FOG_LAYER.fade, packed, work)
    else {
      snapshotsUntil = 0
      dissolveMask(fade, span, FOG_LAYER.blur, clock, FOG_LAYER.fade, packed, work)
    }
    for (let i = 0; i < packed.length; i++) halves[i] = THREE.DataUtils.toHalfFloat(packed[i])
    mask.needsUpdate = true
  }

  return {
    group,
    active: true,
    update(world, dt) {
      clock += dt
      time.value = clock
      since.value = clock - ref
      player.set(world.player.pos.x, world.player.pos.y)
      if (world !== tracked) {
        tracked = world
        lamps = [...world.lamps]
        settleFade(fade, fogTargets(world, span, target))
        snapshotsUntil = 0
        upload()
        return
      }
      const lit = litLamps(lamps, world.lamps)
      if (lit.length > 0 || lamps.length !== world.lamps.length) {
        lamps = [...world.lamps]
        const busy = settlesBy(fade, FOG_LAYER.fade)
        const delay = dissolveDelay(span, lampSources(world.level, lit, FOG_LAYER), FOG_LAYER.maxDelay)
        if (retarget(fade, fogTargets(world, span, target), clock, delay, FOG_LAYER.fade)) {
          snapshotsUntil = busy > clock ? busy : 0
          upload()
          return
        }
      }
      if (snapshotsUntil > 0) upload()
    },
    dispose() {
      group.clear()
      geometry.dispose()
      for (const material of materials) material.dispose()
      mask.dispose()
      noise.dispose()
    },
  }
}
