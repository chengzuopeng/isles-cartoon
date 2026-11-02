import * as THREE from 'three'
import type { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import type { GraphicsQuality } from '../data/quality'
import type { CameraTuning, FeelTuning } from '../data/tuning'
import type { Grid } from '../sim/grid'
import type { Vec2 } from '../sim/math'
import { applyShadowQuality, pixelRatioFor } from './quality'
import { SHADOW_FIT, createShadowRegion, cullFrustum, fitShadow, shadowBasis, snapToTexel } from './shadow-fit'
import { SHADOW_LAYER, UPLOAD_PACING } from './themes'
import { createUploadPacer, textureBytes } from './upload-pacing'

export interface StageOptions {
  container: HTMLElement
  grid: Grid
  camera: CameraTuning
  feel: FeelTuning
  quality: GraphicsQuality
}

export interface ScreenPoint {
  x: number
  y: number
  visible: boolean
}

export type ProgramSettle = 'settled' | 'linking' | 'none'

type LinkingProgram = THREE.WebGLProgram & { isReady(): boolean }

export function settleState(queue: readonly { isReady(): boolean }[]): 'ready' | 'linking' | 'none' {
  if (queue.length === 0) return 'none'
  return queue.every((program) => program.isReady()) ? 'ready' : 'linking'
}

export interface RenderInfo {
  calls: number
  triangles: number
  geometries: number
  textures: number
  programs: number
}

export interface Stage {
  readonly scene: THREE.Scene
  readonly canvas: HTMLCanvasElement
  readonly width: number
  readonly height: number
  setQuality(quality: GraphicsQuality): void
  follow(x: number, y: number, dt: number, snap?: boolean): void
  setZoom(extra: number): void
  addTrauma(amount: number): void
  setShakeScale(scale: number): void
  screenToGround(px: number, py: number, height?: number): Vec2 | null
  project(x: number, height: number, y: number, out: ScreenPoint): ScreenPoint
  render(dt: number): void
  precompile(root: THREE.Object3D, pass: 'main' | 'shadow'): void
  settleProgram(): ProgramSettle
  preload(texture: THREE.Texture): void
  holdUpload(texture: THREE.Texture): boolean
  detectTextureSupport(loader: KTX2Loader): void
  onRestore(task: () => Promise<void>): void
  renderInfo(): RenderInfo
  dispose(): void
}

const SKY = '#9cc7e4'
const SHAKE_DECAY = 1.6
const SHAKE_FREQUENCY = 32
const AIM_HEIGHT = 0.5
export const SUN_OFFSET = new THREE.Vector3(-7, 22, 8)
const SHADOW_UP = new THREE.Vector3(0, 0, -1)

export function createStage({ container, grid, camera: view, feel, quality }: StageOptions): Stage {
  const renderer = new THREE.WebGLRenderer({ antialias: quality.antialias })
  renderer.debug.checkShaderErrors = false
  let resolution = quality.resolution
  let shadows = quality.shadows
  renderer.setPixelRatio(pixelRatioFor(resolution, window.devicePixelRatio))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  castProxies(renderer.shadowMap)
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(SKY)

  const center = new THREE.Vector3(grid.columns / 2, 0, grid.rows / 2)
  scene.add(new THREE.HemisphereLight('#ffffff', '#5a6b4a', 1.3))
  const sun = new THREE.DirectionalLight('#fff4e0', 2.2)
  sun.castShadow = true
  applyShadowQuality(sun, shadows)
  sun.shadow.bias = -0.0005
  sun.shadow.normalBias = 0.02
  sun.shadow.camera.up.copy(SHADOW_UP)
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 60
  scene.add(sun, sun.target)
  const shadowAxes = shadowBasis(SUN_OFFSET, SHADOW_UP)
  const shadowRegion = createShadowRegion()
  const shadowPlanes = new THREE.Frustum()
  const shadowCull = new THREE.Frustum()
  sun.shadow.getFrustum = () => shadowCull
  const sunAnchor = new THREE.Vector3()
  const fitted = { fov: NaN, aspect: NaN, pitch: NaN, distance: NaN }

  const camera = new THREE.PerspectiveCamera(view.fov, 1, 0.1, 200)
  const focus = center.clone()
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const hit = new THREE.Vector3()
  const projected = new THREE.Vector3()
  let focusReady = false
  let zoom = 0
  let trauma = 0
  let shakeTime = 0
  let shakeScale = 1

  const placeCamera = () => {
    if (camera.fov !== view.fov) {
      camera.fov = view.fov
      camera.updateProjectionMatrix()
    }
    const pitch = THREE.MathUtils.degToRad(view.pitch)
    const distance = view.distance + zoom
    camera.position.set(focus.x, Math.sin(pitch) * distance, focus.z + Math.cos(pitch) * distance)
    camera.lookAt(focus)
  }

  const fitSun = () => {
    const distance = view.distance + zoom
    if (fitted.fov === camera.fov && fitted.aspect === camera.aspect && fitted.pitch === view.pitch && fitted.distance === distance) return
    fitted.fov = camera.fov
    fitted.aspect = camera.aspect
    fitted.pitch = view.pitch
    fitted.distance = distance
    camera.updateMatrixWorld()
    const { box, outline } = fitShadow(camera, focus, shadowAxes, SHADOW_FIT, shadowRegion)
    cullFrustum(outline, shadowAxes, SHADOW_FIT.margin, shadowPlanes)
    const shadow = sun.shadow.camera
    if (box.left !== shadow.left || box.right !== shadow.right || box.bottom !== shadow.bottom || box.top !== shadow.top) {
      shadow.left = box.left
      shadow.right = box.right
      shadow.bottom = box.bottom
      shadow.top = box.top
      shadow.updateProjectionMatrix()
    }
  }

  const aimSun = () => {
    fitSun()
    shadowCull.planes.forEach((plane, i) => plane.copy(shadowPlanes.planes[i]).translate(focus))
    const shadow = sun.shadow.camera
    const texelU = (shadow.right - shadow.left) / sun.shadow.mapSize.x
    const texelV = (shadow.top - shadow.bottom) / sun.shadow.mapSize.y
    snapToTexel(focus, shadowAxes, texelU, texelV, sunAnchor)
    sun.target.position.copy(sunAnchor)
    sun.position.copy(sunAnchor).add(SUN_OFFSET)
  }

  let viewWidth = 0
  let viewHeight = 0
  const resize = () => {
    const width = container.clientWidth
    const height = container.clientHeight
    if (width === 0 || height === 0 || (width === viewWidth && height === viewHeight)) return
    viewWidth = width
    viewHeight = height
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(container)
  resize()
  placeCamera()
  aimSun()

  const restorers: (() => Promise<void>)[] = []
  let lost = false
  let restoring: Promise<void> | null = null
  const unsettled: LinkingProgram[] = []
  const pacer = createUploadPacer(() => renderer.getContext() as WebGL2RenderingContext, UPLOAD_PACING)
  renderer.domElement.addEventListener('webglcontextlost', () => {
    lost = true
    unsettled.length = 0
    pacer.reset()
  })
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    lost = false
    castProxies(renderer.shadowMap)
    applyShadowQuality(sun, shadows)
    const run: Promise<void> = (async () => {
      for (const task of restorers) await task().catch((error: unknown) => console.error(error))
    })().finally(() => {
      if (restoring === run) restoring = null
    })
    restoring = run
  })

  const kept = new WeakSet<object>()
  let depthTarget: THREE.WebGLRenderTarget | null = null
  const linked = (program: THREE.WebGLProgram) => {
    const gl = renderer.getContext()
    return gl.isContextLost() || gl.getProgramParameter(program.program as WebGLProgram, gl.LINK_STATUS) === true
  }
  const keepPrograms = (fresh: LinkingProgram[] | null = null) => {
    for (const program of renderer.info.programs ?? []) {
      if (kept.has(program)) continue
      kept.add(program)
      program.usedTimes += 1
      if (fresh) fresh.push(program as LinkingProgram)
      else if (!linked(program)) console.error(`THREE.WebGLProgram: ${program.name} failed to link`, renderer.getContext().getProgramInfoLog(program.program as WebGLProgram))
    }
  }

  return {
    scene,
    canvas: renderer.domElement,
    get width() {
      return viewWidth
    },
    get height() {
      return viewHeight
    },
    setQuality(next) {
      if (next.resolution !== resolution) {
        resolution = next.resolution
        renderer.setPixelRatio(pixelRatioFor(resolution, window.devicePixelRatio))
      }
      if (next.shadows !== shadows) {
        shadows = next.shadows
        applyShadowQuality(sun, shadows)
      }
    },
    follow(x, y, dt, snap = false) {
      if (!focusReady || snap) {
        focus.set(x, 0, y)
        focusReady = true
      } else {
        const blend = 1 - Math.exp(-view.followSharpness * dt)
        focus.x += (x - focus.x) * blend
        focus.z += (y - focus.z) * blend
      }
      placeCamera()
    },
    setZoom(extra) {
      zoom = extra
    },
    addTrauma(amount) {
      trauma = Math.min(1, trauma + amount * shakeScale)
    },
    setShakeScale(scale) {
      shakeScale = Math.max(0, scale)
      if (shakeScale === 0) trauma = 0
    },
    screenToGround(px, py, height = AIM_HEIGHT) {
      if (viewWidth === 0 || viewHeight === 0) return null
      pointer.set((px / viewWidth) * 2 - 1, -(py / viewHeight) * 2 + 1)
      raycaster.setFromCamera(pointer, camera)
      groundPlane.constant = -height
      return raycaster.ray.intersectPlane(groundPlane, hit) ? { x: hit.x, y: hit.z } : null
    },
    project(x, height, y, out) {
      projected.set(x, height, y).project(camera)
      out.x = (projected.x + 1) * 0.5 * viewWidth
      out.y = (1 - projected.y) * 0.5 * viewHeight
      out.visible = projected.z < 1
      return out
    },
    render(dt) {
      if (restoring) return
      placeCamera()
      if (shadows !== 'off') aimSun()
      if (trauma > 0) {
        shakeTime += dt
        trauma = Math.max(0, trauma - SHAKE_DECAY * dt)
        const offset = trauma * trauma * feel.shakeMaxOffset
        const t = shakeTime * SHAKE_FREQUENCY
        camera.position.x += offset * noise(t, 1)
        camera.position.z += offset * noise(t, 2)
      }
      renderer.render(scene, camera)
      pacer.drew()
      keepPrograms()
    },
    precompile(root, pass) {
      if (lost) return
      renderer.capabilities.getMaxAnisotropy()
      if (pass === 'shadow') {
        depthTarget ??= new THREE.WebGLRenderTarget(1, 1)
        renderer.setRenderTarget(depthTarget)
      }
      try {
        renderer.compile(root, camera, scene)
      } finally {
        if (pass === 'shadow') renderer.setRenderTarget(null)
      }
      keepPrograms(unsettled)
    },
    settleProgram() {
      if (lost) return 'none'
      const state = settleState(unsettled)
      if (state !== 'ready') return state
      const program = unsettled.shift() as LinkingProgram
      renderer.debug.checkShaderErrors = !linked(program)
      try {
        program.getUniforms()
        program.getAttributes()
      } finally {
        renderer.debug.checkShaderErrors = false
      }
      return 'settled'
    },
    preload(texture) {
      if (lost) return
      const bytes = textureBytes(texture)
      renderer.initTexture(texture)
      pacer.sent(bytes)
    },
    holdUpload(texture) {
      return !lost && textureBytes(texture) > 0 && pacer.busy()
    },
    detectTextureSupport(loader) {
      loader.detectSupport(renderer)
    },
    onRestore(task) {
      restorers.push(task)
    },
    renderInfo() {
      const { render, memory, programs } = renderer.info
      return {
        calls: render.calls,
        triangles: render.triangles,
        geometries: memory.geometries,
        textures: memory.textures,
        programs: programs?.length ?? 0,
      }
    },
    dispose() {
      observer.disconnect()
      depthTarget?.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}

export function castProxies(shadowMap: THREE.WebGLShadowMap): void {
  const draw = shadowMap.render.bind(shadowMap)
  shadowMap.render = (lights, scene, camera) => {
    const mask = camera.layers.mask
    camera.layers.enable(SHADOW_LAYER)
    try {
      draw(lights, scene, camera)
    } finally {
      camera.layers.mask = mask
    }
  }
}

function noise(t: number, seed: number): number {
  const value = Math.sin(t * 12.9898 + seed * 78.233) * 43758.5453
  return (value - Math.floor(value)) * 2 - 1
}
