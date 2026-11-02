import * as THREE from 'three'
import type { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import type { GraphicsQuality } from '../data/quality'
import type { Grid } from '../sim/grid'
import type { Vec2 } from '../sim/math'
import { createInkPipeline, type InkPipeline, type InkTimings, type StyleToggles } from './ink-pipeline'
import { applyShadowQuality, pixelRatioFor } from './quality'
import { createSky, type Sky } from './sky'
import { castProxies, settleState, type ProgramSettle, type RenderInfo, type ScreenPoint, type Stage } from './stage'
import { INK_UNIFORMS } from './toon'
import { UPLOAD_PACING } from './themes'
import { createUploadPacer, textureBytes } from './upload-pacing'

export type ViewMode = 'fps' | 'top' | 'free'

export interface FpsStageOptions {
  container: HTMLElement
  grid: Grid
  quality: GraphicsQuality
  fov: number
}

export interface FpsStage extends Stage {
  readonly camera: THREE.PerspectiveCamera
  readonly renderer: THREE.WebGLRenderer
  readonly pipeline: InkPipeline
  readonly sky: Sky
  readonly view: ViewMode
  setView(mode: ViewMode): void
  setEye(x: number, y: number, z: number): void
  look(yaw: number, pitch: number): void
  setFov(horizontalDegrees: number): void
  setFovBoost(degrees: number): void
  setRoll(radians: number): void
  setOverlay(draw: ((renderer: THREE.WebGLRenderer) => void) | null): void
  setLevel(grid: Grid): void
  setStyle(toggles: Partial<StyleToggles>): StyleToggles
  styleInfo(): InkTimings | null
  freeMove(forward: number, right: number, up: number): void
  yaw(): number
  pitch(): number
}

const SUN_DIRECTION = new THREE.Vector3(-7, 22, 8).normalize()
const SHADOW_HALF = 42
const SHADOW_DEPTH = 160
const TOP_PITCH = THREE.MathUtils.degToRad(58)
const TOP_DISTANCE = 22
const SHAKE_DECAY = 1.8
const SHAKE_FREQUENCY = 28
const SHAKE_ANGLE = 0.035

export function verticalFov(horizontalDegrees: number, aspect: number): number {
  const half = THREE.MathUtils.degToRad(horizontalDegrees) / 2
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(half) / Math.max(aspect, 0.1)))
}

export function lookDirection(yaw: number, pitch: number, out: THREE.Vector3): THREE.Vector3 {
  const flat = Math.cos(pitch)
  return out.set(Math.cos(yaw) * flat, Math.sin(pitch), Math.sin(yaw) * flat)
}

export function createFpsStage({ container, grid, quality, fov }: FpsStageOptions): FpsStage {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
  renderer.debug.checkShaderErrors = false
  renderer.toneMapping = THREE.NoToneMapping
  renderer.outputColorSpace = THREE.SRGBColorSpace
  let resolution = quality.resolution
  let shadows = quality.shadows
  renderer.setPixelRatio(pixelRatioFor(resolution, window.devicePixelRatio))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  castProxies(renderer.shadowMap)
  renderer.autoClear = false
  renderer.info.autoReset = false
  container.appendChild(renderer.domElement)

  const pipeline = createInkPipeline(renderer)
  const scene = new THREE.Scene()
  const center = new THREE.Vector3(grid.columns / 2, 0, grid.rows / 2)
  const sky = createSky({
    texture: `${import.meta.env.BASE_URL}assets/scenes/sky-ch1.jpg`,
    repeats: 2,
    zenith: '#1f86de',
    horizon: '#f3e4c4',
    sea: '#fbf3e2',
    seaShadow: '#b9b6d8',
    seaHeight: -42,
    center,
    north: new THREE.Vector3(0, 0, -1),
  })
  scene.add(sky.group, sky.far)

  const hemisphere = new THREE.HemisphereLight('#d9ebff', '#9a8a68', 1.25)
  scene.add(hemisphere)
  const sun = new THREE.DirectionalLight('#fff0d4', 2.5)
  sun.castShadow = true
  applyShadowQuality(sun, shadows)
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.bias = -0.0006
  sun.shadow.normalBias = 0.03
  const shadowCamera = sun.shadow.camera
  shadowCamera.left = -SHADOW_HALF
  shadowCamera.right = SHADOW_HALF
  shadowCamera.top = SHADOW_HALF
  shadowCamera.bottom = -SHADOW_HALF
  shadowCamera.near = 1
  shadowCamera.far = SHADOW_DEPTH
  shadowCamera.updateProjectionMatrix()
  scene.add(sun, sun.target)

  const camera = new THREE.PerspectiveCamera(70, 1, 0.08, 3200)
  camera.rotation.order = 'YXZ'
  const eye = new THREE.Vector3(center.x, 1.5, center.z)
  const free = new THREE.Vector3(center.x, 12, center.z + 20)
  let view: ViewMode = 'fps'
  let yaw = -Math.PI / 2
  let pitch = 0
  let horizontalFov = fov
  let fovBoost = 0
  let roll = 0
  let trauma = 0
  let shakeTime = 0
  let shakeScale = 1
  let overlay: ((renderer: THREE.WebGLRenderer) => void) | null = null
  const look = new THREE.Vector3()
  const target = new THREE.Vector3()
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const hit = new THREE.Vector3()
  const projected = new THREE.Vector3()
  const sunAnchor = new THREE.Vector3()
  const lightSpace = new THREE.Matrix4()
  const lightInverse = new THREE.Matrix4()
  const snapped = new THREE.Vector3()

  const placeCamera = () => {
    const vertical = verticalFov(horizontalFov + fovBoost, camera.aspect)
    if (Math.abs(camera.fov - vertical) > 0.001) {
      camera.fov = vertical
      camera.updateProjectionMatrix()
    }
    let shakeYaw = 0
    let shakePitch = 0
    if (trauma > 0) {
      const amount = trauma * trauma * SHAKE_ANGLE * shakeScale
      shakeYaw = amount * noise(shakeTime * SHAKE_FREQUENCY, 1)
      shakePitch = amount * noise(shakeTime * SHAKE_FREQUENCY, 2)
    }
    if (view === 'top') {
      camera.position.set(eye.x, eye.y + Math.sin(TOP_PITCH) * TOP_DISTANCE, eye.z + Math.cos(TOP_PITCH) * TOP_DISTANCE)
      camera.lookAt(eye.x, eye.y, eye.z)
      return
    }
    const origin = view === 'free' ? free : eye
    camera.position.copy(origin)
    lookDirection(yaw + shakeYaw, pitch + shakePitch, look)
    target.copy(origin).add(look)
    camera.up.set(0, 1, 0)
    camera.lookAt(target)
    if (roll !== 0) camera.rotateZ(roll)
  }

  const aimSun = () => {
    const focus = view === 'free' ? free : eye
    sunAnchor.set(focus.x, 0, focus.z).addScaledVector(look.set(Math.cos(yaw), 0, Math.sin(yaw)), view === 'fps' ? SHADOW_HALF * 0.45 : 0)
    lightSpace.lookAt(SUN_DIRECTION, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0))
    lightInverse.copy(lightSpace).invert()
    snapped.copy(sunAnchor).applyMatrix4(lightInverse)
    const texel = (SHADOW_HALF * 2) / sun.shadow.mapSize.x
    snapped.x = Math.round(snapped.x / texel) * texel
    snapped.y = Math.round(snapped.y / texel) * texel
    snapped.applyMatrix4(lightSpace)
    sun.target.position.copy(snapped)
    sun.position.copy(snapped).addScaledVector(SUN_DIRECTION, SHADOW_DEPTH * 0.6)
    sun.target.updateMatrixWorld()
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
    pipeline.setSize(width, height, renderer.getPixelRatio())
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(container)
  resize()
  placeCamera()

  const restorers: (() => Promise<void>)[] = []
  let lost = false
  let restoring: Promise<void> | null = null
  type LinkingProgram = THREE.WebGLProgram & { isReady(): boolean }
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
  const warmTarget = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType })
  const shadowWarmTarget = new THREE.WebGLRenderTarget(1, 1)

  return {
    scene,
    camera,
    renderer,
    pipeline,
    sky,
    canvas: renderer.domElement,
    get width() {
      return viewWidth
    },
    get height() {
      return viewHeight
    },
    get view() {
      return view
    },
    setQuality(next) {
      if (next.resolution !== resolution) {
        resolution = next.resolution
        renderer.setPixelRatio(pixelRatioFor(resolution, window.devicePixelRatio))
        pipeline.setSize(viewWidth, viewHeight, renderer.getPixelRatio())
      }
      if (next.shadows !== shadows) {
        shadows = next.shadows
        applyShadowQuality(sun, shadows)
        sun.shadow.mapSize.set(2048, 2048)
      }
    },
    follow(x, y) {
      eye.x = x
      eye.z = y
    },
    setZoom() {},
    addTrauma(amount) {
      trauma = Math.min(1, trauma + amount * shakeScale)
    },
    setShakeScale(scale) {
      shakeScale = Math.max(0, scale)
      if (shakeScale === 0) trauma = 0
    },
    screenToGround(px, py, height = 0.5): Vec2 | null {
      if (viewWidth === 0 || viewHeight === 0) return null
      pointer.set((px / viewWidth) * 2 - 1, -(py / viewHeight) * 2 + 1)
      raycaster.setFromCamera(pointer, camera)
      groundPlane.constant = -height
      return raycaster.ray.intersectPlane(groundPlane, hit) ? { x: hit.x, y: hit.z } : null
    },
    project(x, height, y, out: ScreenPoint) {
      projected.set(x, height, y).project(camera)
      out.x = (projected.x + 1) * 0.5 * viewWidth
      out.y = (1 - projected.y) * 0.5 * viewHeight
      out.visible = projected.z < 1 && projected.z > -1
      return out
    },
    setView(mode) {
      if (mode === 'free' && view !== 'free') free.copy(eye)
      view = mode
    },
    setEye(x, y, z) {
      eye.set(x, z, y)
    },
    look(nextYaw, nextPitch) {
      yaw = nextYaw
      pitch = THREE.MathUtils.clamp(nextPitch, -THREE.MathUtils.degToRad(85), THREE.MathUtils.degToRad(85))
    },
    setFov(degrees) {
      horizontalFov = degrees
    },
    setFovBoost(degrees) {
      fovBoost = degrees
    },
    setRoll(radians) {
      roll = radians
    },
    setOverlay(draw) {
      overlay = draw
    },
    setLevel(next) {
      sky.far.position.set(next.columns / 2 - center.x, 0, next.rows / 2 - center.z)
    },
    setStyle(next) {
      Object.assign(pipeline.toggles, next)
      INK_UNIFORMS.inkDots.value = pipeline.toggles.halftone ? 1 : 0
      INK_UNIFORMS.inkTintAmount.value = pipeline.toggles.toon ? 0.6 : 0
      return { ...pipeline.toggles }
    },
    styleInfo: () => pipeline.timings(),
    freeMove(forward, right, up) {
      lookDirection(yaw, pitch, look)
      free.addScaledVector(look, forward)
      free.x += -Math.sin(yaw) * right
      free.z += Math.cos(yaw) * right
      free.y += up
    },
    yaw: () => yaw,
    pitch: () => pitch,
    render(dt) {
      if (restoring) return
      renderer.info.reset()
      if (trauma > 0) {
        shakeTime += dt
        trauma = Math.max(0, trauma - SHAKE_DECAY * dt)
      }
      placeCamera()
      sky.update(camera, dt)
      if (shadows !== 'off') aimSun()
      pipeline.render(scene, camera, overlay)
      pacer.drew()
      keepPrograms()
    },
    precompile(root, pass) {
      if (lost) return
      renderer.setRenderTarget(pass === 'shadow' ? shadowWarmTarget : warmTarget)
      try {
        renderer.compile(root, camera, scene)
      } finally {
        renderer.setRenderTarget(null)
      }
      keepPrograms(unsettled)
    },
    settleProgram(): ProgramSettle {
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
    detectTextureSupport(loader: KTX2Loader) {
      loader.detectSupport(renderer)
    },
    onRestore(task) {
      restorers.push(task)
    },
    renderInfo(): RenderInfo {
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
      warmTarget.dispose()
      shadowWarmTarget.dispose()
      sky.dispose()
      pipeline.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}

function noise(t: number, seed: number): number {
  const value = Math.sin(t * 12.9898 + seed * 78.233) * 43758.5453
  return (value - Math.floor(value)) * 2 - 1
}
