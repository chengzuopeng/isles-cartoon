import * as THREE from 'three'
import type { Theme } from '../data/levels/types'
import { cellHash } from './scene-models'
import { toonMaterial } from './toon'

export interface StalkStyle {
  stem: string
  stemTip: string
  headColor: string
  headSize: number
  perCell: number
  height: readonly [number, number]
  width: number
}

export const STALK_STYLES: Readonly<Partial<Record<Theme, StalkStyle>>> = {
  farm: { stem: '#b88a3a', stemTip: '#e8c25a', headColor: '#f2cf63', headSize: 0.17, perCell: 22, height: [0.92, 1.18], width: 0.028 },
  meadow: { stem: '#3f7a35', stemTip: '#8fc95b', headColor: '#a9d86a', headSize: 0.06, perCell: 18, height: [0.8, 1.1], width: 0.05 },
}

export const STALK_WIND = {
  speed: 1.7,
  sway: 0.07,
  gust: 0.32,
} as const

export function stalkGeometry(style: StalkStyle): THREE.BufferGeometry {
  const width = style.width
  const head = style.headSize
  const stem = new THREE.Color(style.stem)
  const tip = new THREE.Color(style.stemTip)
  const headColor = new THREE.Color(style.headColor)
  const positions: number[] = []
  const colors: number[] = []
  const push = (x: number, y: number, z: number, color: THREE.Color) => {
    positions.push(x, y, z)
    colors.push(color.r, color.g, color.b)
  }
  const top = 1 - head * 0.6
  for (const [dx, dz] of [
    [1, 0],
    [0, 1],
  ]) {
    const hx = (dx * width) / 2
    const hz = (dz * width) / 2
    push(-hx, 0, -hz, stem)
    push(hx, 0, hz, stem)
    push(hx * 0.6, top, hz * 0.6, tip)
    push(-hx, 0, -hz, stem)
    push(hx * 0.6, top, hz * 0.6, tip)
    push(-hx * 0.6, top, -hz * 0.6, tip)
  }
  if (head > 0.08) {
    const wide = width * 2.6
    for (const [dx, dz] of [
      [1, 0],
      [0, 1],
    ]) {
      const hx = (dx * wide) / 2
      const hz = (dz * wide) / 2
      const base = top - head * 0.15
      const middle = top + head * 0.35
      const peak = top + head
      push(0, base, 0, headColor)
      push(hx, middle, hz, headColor)
      push(0, peak, 0, headColor)
      push(0, base, 0, headColor)
      push(0, peak, 0, headColor)
      push(-hx, middle, -hz, headColor)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
}

export function stalkMatrices(column: number, row: number, ground: (x: number, z: number) => number, style: StalkStyle): THREE.Matrix4[] {
  const matrices: THREE.Matrix4[] = []
  const position = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  const euler = new THREE.Euler()
  const scale = new THREE.Vector3()
  for (let k = 0; k < style.perCell; k++) {
    const x = column + 0.04 + cellHash(column, row, 300 + k) * 0.92
    const z = row + 0.04 + cellHash(column, row, 400 + k) * 0.92
    const height = style.height[0] + cellHash(column, row, 500 + k) * (style.height[1] - style.height[0])
    euler.set((cellHash(column, row, 600 + k) - 0.5) * 0.22, cellHash(column, row, 700 + k) * Math.PI * 2, (cellHash(column, row, 800 + k) - 0.5) * 0.22)
    rotation.setFromEuler(euler)
    position.set(x, ground(x, z) - 0.03, z)
    scale.set(1, height, 1)
    matrices.push(new THREE.Matrix4().compose(position, rotation, scale))
  }
  return matrices
}

export interface StalkMaterial {
  readonly material: THREE.MeshToonMaterial
  update(dt: number): void
}

export function createStalkMaterial(): StalkMaterial {
  const time = { value: 0 }
  const material = toonMaterial({ vertexColors: true, side: THREE.DoubleSide })
  material.name = 'stalks'
  const previous = material.onBeforeCompile.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    shader.uniforms.stalkTime = time
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float stalkTime;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
vec3 stalkRoot = instanceMatrix[3].xyz;
float stalkPhase = stalkRoot.x * 0.83 + stalkRoot.z * 0.61;
float stalkGust = 0.5 + 0.5 * sin(stalkTime * 0.37 + stalkRoot.x * 0.11 + stalkRoot.z * 0.07);
float stalkBend = position.y * position.y * (${STALK_WIND.sway.toFixed(3)} + ${STALK_WIND.gust.toFixed(3)} * stalkGust * 0.25);
transformed.x += sin(stalkTime * ${STALK_WIND.speed.toFixed(3)} + stalkPhase) * stalkBend;
transformed.z += cos(stalkTime * ${(STALK_WIND.speed * 0.8).toFixed(3)} + stalkPhase * 1.3) * stalkBend * 0.6;
#endif`,
      )
    previous(shader, renderer)
  }
  const key = material.customProgramCacheKey.bind(material)
  material.customProgramCacheKey = () => `${key()}|stalks`
  return {
    material,
    update(dt) {
      time.value += dt
    },
  }
}
