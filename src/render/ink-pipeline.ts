import * as THREE from 'three'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { RigidStandardMaterial, rigidNormalFor } from './rigid-parts'
import { INK_COLOR } from './toon'

export interface StyleToggles {
  toon: boolean
  outline: boolean
  halftone: boolean
  bloom: boolean
  grade: boolean
}

export interface InkLook {
  lineWidth: number
  creaseWidth: number
  depthThreshold: number
  normalThreshold: number
  lineNear: number
  lineMin: number
  creaseStart: number
  creaseEnd: number
  detailNear: number
  detailFar: number
  hazeStart: number
  hazeEnd: number
  hazeMax: number
  haze: THREE.Color
  bloomStrength: number
  bloomRadius: number
  bloomThreshold: number
  vignette: number
  aberration: number
  grain: number
  saturation: number
  warmth: number
  pulse: number
  rush: number
}

export interface InkTimings {
  main: number
  normal: number
  ink: number
  overlay: number
  bloom: number
  grade: number
}

export interface InkPipeline {
  readonly look: InkLook
  readonly toggles: StyleToggles
  setSize(width: number, height: number, pixelRatio: number): void
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, overlay: ((renderer: THREE.WebGLRenderer) => void) | null): void
  timings(): InkTimings | null
  dispose(): void
}

export const DEFAULT_LOOK: InkLook = {
  lineWidth: 3.4,
  creaseWidth: 1.6,
  depthThreshold: 0.035,
  normalThreshold: 0.22,
  lineNear: 14,
  lineMin: 1.3,
  creaseStart: 45,
  creaseEnd: 110,
  detailNear: 6,
  detailFar: 14,
  hazeStart: 18,
  hazeEnd: 170,
  hazeMax: 0.6,
  haze: new THREE.Color('#e9dcc0'),
  bloomStrength: 0.5,
  bloomRadius: 0.35,
  bloomThreshold: 1.02,
  vignette: 0.3,
  aberration: 0.9,
  grain: 0.05,
  saturation: 1.08,
  warmth: 0.03,
  pulse: 0,
  rush: 0,
}

const QUAD_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const INK_FRAGMENT = /* glsl */ `
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tNormal;
uniform vec2 resolution;
uniform float cameraNear;
uniform float cameraFar;
uniform float lineWidth;
uniform float creaseWidth;
uniform float depthThreshold;
uniform float normalThreshold;
uniform float lineNear;
uniform float lineMin;
uniform float creaseStart;
uniform float creaseEnd;
uniform float hazeStart;
uniform float hazeEnd;
uniform float hazeMax;
uniform vec3 hazeColor;
uniform vec3 inkColor;
uniform float outlines;
varying vec2 vUv;

float viewDepth(vec2 uv) {
  return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar);
}

float inverseDepth(vec2 uv) {
  return 1.0 / max(viewDepth(uv), 0.0001);
}

float ridge(vec2 uv, vec2 offset, float center) {
  float a = inverseDepth(uv + offset);
  float b = inverseDepth(uv - offset);
  return (2.0 * center - a - b) / center;
}

float crease(vec2 uv, vec2 offset, vec3 normal, float center) {
  float w = inverseDepth(uv + offset);
  if (abs(w - center) / center > 0.08) return 0.0;
  vec3 other = texture2D(tNormal, uv + offset).xyz * 2.0 - 1.0;
  return 1.0 - dot(normal, other);
}

void main() {
  vec4 base = texture2D(tColor, vUv);
  float raw = texture2D(tDepth, vUv).x;
  vec3 color = base.rgb;
  if (raw >= 0.99999) {
    gl_FragColor = vec4(color, 1.0);
    return;
  }
  float distance = -perspectiveDepthToViewZ(raw, cameraNear, cameraFar);
  float center = 1.0 / max(distance, 0.0001);
  vec2 pixel = 1.0 / resolution;
  float scale = resolution.y / 1080.0;
  float width = max(max(lineMin, lineWidth * min(1.0, lineNear / distance)) * scale, 1.0);
  vec2 h = vec2(pixel.x * width, 0.0);
  vec2 v = vec2(0.0, pixel.y * width);
  vec2 d1 = vec2(pixel.x, pixel.y) * width * 0.7071;
  vec2 d2 = vec2(pixel.x, -pixel.y) * width * 0.7071;
  float silhouette = max(max(ridge(vUv, h, center), ridge(vUv, v, center)), max(ridge(vUv, d1, center), ridge(vUv, d2, center)));
  float edge = smoothstep(depthThreshold, depthThreshold * 1.8, silhouette);
  vec4 surface = texture2D(tNormal, vUv);
  vec3 normal = surface.xyz * 2.0 - 1.0;
  float cw = creaseWidth * scale;
  vec2 ch = vec2(pixel.x * cw, 0.0);
  vec2 cv = vec2(0.0, pixel.y * cw);
  float bend = max(max(crease(vUv, ch, normal, center), crease(vUv, -ch, normal, center)), max(crease(vUv, cv, normal, center), crease(vUv, -cv, normal, center)));
  float fold = smoothstep(normalThreshold, normalThreshold + 0.12, bend) * (1.0 - smoothstep(creaseStart, creaseEnd, distance)) * surface.a;
  float line = max(edge, fold) * outlines;
  float mist = smoothstep(hazeStart, hazeEnd, distance) * hazeMax;
  color = mix(color, hazeColor, mist);
  vec3 ink = mix(inkColor, hazeColor, clamp(mist * 1.25, 0.0, 0.85));
  color = mix(color, ink, line);
  gl_FragColor = vec4(color, 1.0);
}
`

const GRADE_FRAGMENT = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 resolution;
uniform float vignette;
uniform float aberration;
uniform float grain;
uniform float saturation;
uniform float warmth;
uniform float grade;
uniform float pulse;
uniform float rush;
uniform float beat;
varying vec2 vUv;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec3 toSrgb(vec3 linear) {
  vec3 low = linear * 12.92;
  vec3 high = 1.055 * pow(max(linear, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(low, high, step(vec3(0.0031308), linear));
}

void main() {
  vec2 offset = vUv - 0.5;
  float radius = length(offset * vec2(resolution.x / resolution.y, 1.0));
  vec3 color;
  if (grade > 0.5) {
    vec2 shift = offset * aberration * (1.0 + pulse * 7.0) * radius / resolution * 2.0;
    color.r = texture2D(tColor, vUv + shift).r;
    color.g = texture2D(tColor, vUv).g;
    color.b = texture2D(tColor, vUv - shift).b;
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(luma), color, saturation);
    color *= vec3(1.0 + warmth, 1.0, 1.0 - warmth);
    vec3 over = max(color - 0.82, 0.0);
    color = min(color, 0.82) + over / (1.0 + over * 2.6);
    color *= 1.0 - vignette * smoothstep(0.45, 1.05, radius);
    float wedge = floor((atan(offset.y, offset.x) + 3.14159) * 22.0);
    float ray = hash(vec2(wedge, beat));
    float reach = 0.34 + hash(vec2(wedge + 7.0, beat)) * 0.3;
    float streak = step(0.7, ray) * smoothstep(reach, reach + 0.05, radius) * rush;
    color = mix(color, vec3(1.0, 0.99, 0.94), streak * 0.9);
    vec2 paper = gl_FragCoord.xy;
    float fiber = valueNoise(paper * vec2(0.9, 0.35)) * 0.6 + valueNoise(paper * 0.08) * 0.4;
    float speck = hash(floor(paper / 1.5));
    color *= 1.0 - grain * (fiber - 0.5) - grain * 0.5 * (speck - 0.5);
  } else {
    color = texture2D(tColor, vUv).rgb;
    color = min(color, vec3(1.0));
  }
  gl_FragColor = vec4(toSrgb(clamp(color, 0.0, 1.0)), 1.0);
}
`

interface Swapped {
  object: THREE.Object3D & { material?: THREE.Material | THREE.Material[] }
  material: THREE.Material | THREE.Material[] | undefined
  visible: boolean
}

export function detailGain(distance: number, radius: number, near: number, far: number): number {
  const start = radius * near
  const end = Math.max(start + 0.001, radius * far)
  const t = Math.min(1, Math.max(0, (distance - start) / (end - start)))
  return 1 - t * t * (3 - 2 * t)
}

function hiddenFromNormals(object: THREE.Object3D, material: THREE.Material | undefined): boolean {
  if (object.userData.noInk === true || !material) return true
  if (material.transparent) return true
  return (material as THREE.MeshBasicMaterial).alphaTest > 0 && material.userData.inkSolid !== true
}

export function createInkPipeline(renderer: THREE.WebGLRenderer, look: InkLook = { ...DEFAULT_LOOK, haze: DEFAULT_LOOK.haze.clone() }): InkPipeline {
  const toggles: StyleToggles = { toon: true, outline: true, halftone: true, bloom: true, grade: true }
  let width = 1
  let height = 1
  const depthTexture = new THREE.DepthTexture(1, 1)
  depthTexture.type = THREE.UnsignedIntType
  const mainTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: 4,
    depthTexture,
  })
  const normalTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType, depthBuffer: true })
  const inkTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true })
  const normalFront = new THREE.MeshNormalMaterial({ side: THREE.FrontSide })
  const normalDouble = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide })
  const normalBack = new THREE.MeshNormalMaterial({ side: THREE.BackSide })
  const inkMaterial = new THREE.ShaderMaterial({
    vertexShader: QUAD_VERTEX,
    fragmentShader: INK_FRAGMENT,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tColor: { value: mainTarget.texture },
      tDepth: { value: depthTexture },
      tNormal: { value: normalTarget.texture },
      resolution: { value: new THREE.Vector2(1, 1) },
      cameraNear: { value: 0.1 },
      cameraFar: { value: 1000 },
      lineWidth: { value: look.lineWidth },
      creaseWidth: { value: look.creaseWidth },
      depthThreshold: { value: look.depthThreshold },
      normalThreshold: { value: look.normalThreshold },
      lineNear: { value: look.lineNear },
      lineMin: { value: look.lineMin },
      creaseStart: { value: look.creaseStart },
      creaseEnd: { value: look.creaseEnd },
      hazeStart: { value: look.hazeStart },
      hazeEnd: { value: look.hazeEnd },
      hazeMax: { value: look.hazeMax },
      hazeColor: { value: look.haze },
      inkColor: { value: INK_COLOR.clone() },
      outlines: { value: 1 },
    },
  })
  const gradeMaterial = new THREE.ShaderMaterial({
    vertexShader: QUAD_VERTEX,
    fragmentShader: GRADE_FRAGMENT,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tColor: { value: inkTarget.texture },
      resolution: { value: new THREE.Vector2(1, 1) },
      vignette: { value: look.vignette },
      aberration: { value: look.aberration },
      grain: { value: look.grain },
      saturation: { value: look.saturation },
      warmth: { value: look.warmth },
      grade: { value: 1 },
      pulse: { value: 0 },
      rush: { value: 0 },
      beat: { value: 0 },
    },
  })
  const inkQuad = new FullScreenQuad(inkMaterial)
  const gradeQuad = new FullScreenQuad(gradeMaterial)
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), look.bloomStrength, look.bloomRadius, look.bloomThreshold)
  const swapped: Swapped[] = []
  const clearColor = new THREE.Color()

  const gl = renderer.getContext() as WebGL2RenderingContext
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null
  const stages: (keyof InkTimings)[] = ['main', 'normal', 'ink', 'overlay', 'bloom', 'grade']
  const pending: { queries: WebGLQuery[] }[] = []
  let latest: InkTimings | null = null
  let measuring: WebGLQuery[] | null = null

  const begin = (index: number) => {
    if (!timer || !measuring) return
    const query = gl.createQuery()
    if (!query) return
    measuring[index] = query
    gl.beginQuery(timer.TIME_ELAPSED_EXT, query)
  }
  const end = () => {
    if (!timer || !measuring) return
    gl.endQuery(timer.TIME_ELAPSED_EXT)
  }
  const collect = () => {
    if (!timer) return
    while (pending.length > 0) {
      const frame = pending[0]
      const last = frame.queries[frame.queries.length - 1]
      if (!last || !gl.getQueryParameter(last, gl.QUERY_RESULT_AVAILABLE)) break
      pending.shift()
      if (gl.getParameter(timer.GPU_DISJOINT_EXT)) {
        for (const query of frame.queries) gl.deleteQuery(query)
        continue
      }
      const result = { main: 0, normal: 0, ink: 0, overlay: 0, bloom: 0, grade: 0 }
      frame.queries.forEach((query, index) => {
        result[stages[index]] = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6
        gl.deleteQuery(query)
      })
      latest = result
    }
  }

  const syncUniforms = (camera: THREE.PerspectiveCamera) => {
    const u = inkMaterial.uniforms
    u.cameraNear.value = camera.near
    u.cameraFar.value = camera.far
    u.lineWidth.value = look.lineWidth
    u.creaseWidth.value = look.creaseWidth
    u.depthThreshold.value = look.depthThreshold
    u.normalThreshold.value = look.normalThreshold
    u.lineNear.value = look.lineNear
    u.lineMin.value = look.lineMin
    u.creaseStart.value = look.creaseStart
    u.creaseEnd.value = look.creaseEnd
    u.hazeStart.value = look.hazeStart
    u.hazeEnd.value = look.hazeEnd
    u.hazeMax.value = look.hazeMax
    u.outlines.value = toggles.outline ? 1 : 0
    const g = gradeMaterial.uniforms
    g.vignette.value = look.vignette
    g.aberration.value = look.aberration
    g.grain.value = look.grain
    g.saturation.value = look.saturation
    g.warmth.value = look.warmth
    g.pulse.value = look.pulse
    g.rush.value = look.rush
    g.beat.value = Math.floor(performance.now() / 45) % 997
    g.grade.value = toggles.grade ? 1 : 0
    bloom.strength = look.bloomStrength
    bloom.radius = look.bloomRadius
    bloom.threshold = look.bloomThreshold
  }

  const sphere = new THREE.Sphere()
  const bounds = (object: THREE.Object3D): boolean => {
    const instanced = object as THREE.InstancedMesh
    if (instanced.isInstancedMesh) {
      if (!instanced.boundingSphere) instanced.computeBoundingSphere()
      if (!instanced.boundingSphere) return false
      sphere.copy(instanced.boundingSphere).applyMatrix4(object.matrixWorld)
      return true
    }
    const geometry = (object as THREE.Mesh).geometry
    if (!geometry) return false
    if (!geometry.boundingSphere) geometry.computeBoundingSphere()
    if (!geometry.boundingSphere) return false
    sphere.copy(geometry.boundingSphere).applyMatrix4(object.matrixWorld)
    return true
  }
  const tooFar = (object: THREE.Object3D, eye: THREE.Vector3): boolean => bounds(object) && eye.distanceTo(sphere.center) - sphere.radius > look.creaseEnd
  const detail = (object: THREE.Object3D, eye: THREE.Vector3): number => (bounds(object) ? detailGain(eye.distanceTo(sphere.center), sphere.radius, look.detailNear, look.detailFar) : 1)
  const swapToNormals = (scene: THREE.Scene, eye: THREE.Vector3) => {
    scene.traverseVisible((object) => {
      const drawn = object as THREE.Object3D & { material?: THREE.Material | THREE.Material[]; isMesh?: boolean; isPoints?: boolean; isLine?: boolean; isSprite?: boolean }
      if (!drawn.isMesh && !drawn.isPoints && !drawn.isLine && !drawn.isSprite) return
      const material = drawn.material
      const first = Array.isArray(material) ? material[0] : material
      swapped.push({ object: drawn, material, visible: drawn.visible })
      if (!drawn.isMesh || hiddenFromNormals(drawn, first) || tooFar(drawn, eye)) {
        drawn.visible = false
        return
      }
      if (first instanceof RigidStandardMaterial) {
        const gain = detail(drawn, eye)
        if (gain <= 0) {
          drawn.visible = false
          return
        }
        const normal = rigidNormalFor(first)
        normal.rigidCrease.value = gain
        drawn.material = normal
        return
      }
      drawn.material = first?.side === THREE.DoubleSide ? normalDouble : first?.side === THREE.BackSide ? normalBack : normalFront
    })
  }
  const restore = () => {
    for (const entry of swapped) {
      if (entry.material) entry.object.material = entry.material
      entry.object.visible = entry.visible
    }
    swapped.length = 0
  }

  return {
    look,
    toggles,
    setSize(cssWidth, cssHeight, pixelRatio) {
      width = Math.max(1, Math.round(cssWidth * pixelRatio))
      height = Math.max(1, Math.round(cssHeight * pixelRatio))
      mainTarget.setSize(width, height)
      normalTarget.setSize(width, height)
      inkTarget.setSize(width, height)
      bloom.setSize(Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2)))
      inkMaterial.uniforms.resolution.value.set(width, height)
      gradeMaterial.uniforms.resolution.value.set(width, height)
    },
    render(scene, camera, overlay) {
      syncUniforms(camera)
      collect()
      measuring = timer && pending.length < 4 ? [] : null
      const background = scene.background
      renderer.getClearColor(clearColor)
      const clearAlpha = renderer.getClearAlpha()

      begin(0)
      renderer.setRenderTarget(mainTarget)
      renderer.clear(true, true, true)
      renderer.render(scene, camera)
      end()

      begin(1)
      if (toggles.outline) {
        scene.background = null
        renderer.setRenderTarget(normalTarget)
        renderer.setClearColor(0x8080ff, 1)
        renderer.clear(true, true, true)
        swapToNormals(scene, camera.position)
        try {
          renderer.render(scene, camera)
        } finally {
          restore()
          scene.background = background
          renderer.setClearColor(clearColor, clearAlpha)
        }
      }
      end()

      begin(2)
      renderer.setRenderTarget(inkTarget)
      renderer.clear(true, true, true)
      inkQuad.render(renderer)
      end()

      begin(3)
      if (overlay) {
        renderer.setRenderTarget(inkTarget)
        renderer.clearDepth()
        overlay(renderer)
      }
      end()

      begin(4)
      if (toggles.bloom) bloom.render(renderer, inkTarget, inkTarget, 0, false)
      end()

      begin(5)
      renderer.setRenderTarget(null)
      gradeQuad.render(renderer)
      end()

      if (measuring && measuring.length === stages.length) pending.push({ queries: measuring })
      measuring = null
    },
    timings: () => latest,
    dispose() {
      mainTarget.dispose()
      depthTexture.dispose()
      normalTarget.dispose()
      inkTarget.dispose()
      normalFront.dispose()
      normalDouble.dispose()
      normalBack.dispose()
      inkMaterial.dispose()
      gradeMaterial.dispose()
      inkQuad.dispose()
      gradeQuad.dispose()
      bloom.dispose()
    },
  }
}
