import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { KEG_HEIGHT } from '../data/heights'
import { toonMaterial } from './toon'

export const KEG_LOOK = {
  radius: 0.4,
  bulge: 0.06,
  wood: '#8a5a32',
  hoop: '#3a2f2a',
  emblem: '#c8372d',
  emblemInk: '#f1e3c4',
  fuse: '#2b2f38',
  spark: '#ffd04a',
  litGlow: '#ff4a2a',
  pulse: 14,
} as const

export interface KegParts {
  root: THREE.Group
  body: THREE.MeshToonMaterial
  spark: THREE.Mesh
  fuseTop: number
}

let shared: {
  body: THREE.BufferGeometry
  trim: THREE.BufferGeometry
  spark: THREE.BufferGeometry
  trimMaterial: THREE.MeshToonMaterial
  sparkMaterial: THREE.MeshBasicMaterial
} | null = null

function paint(geometry: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const color = new THREE.Color(hex)
  const count = geometry.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

function geometries() {
  if (shared) return shared
  const height = KEG_HEIGHT - 0.08
  const profile: THREE.Vector2[] = []
  const steps = 10
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    profile.push(new THREE.Vector2(KEG_LOOK.radius + Math.sin(t * Math.PI) * KEG_LOOK.bulge, t * height))
  }
  const hoops = [0.16, height - 0.16].map((at) =>
    paint(new THREE.CylinderGeometry(KEG_LOOK.radius + 0.035, KEG_LOOK.radius + 0.035, 0.07, 16, 1, true).translate(0, at, 0), KEG_LOOK.hoop),
  )
  const reach = KEG_LOOK.radius + KEG_LOOK.bulge + 0.005
  const plates = [0, Math.PI].map((side) =>
    paint(new THREE.CircleGeometry(0.2, 20).rotateY(side).translate(Math.sin(side) * reach, height * 0.5, Math.cos(side) * reach), KEG_LOOK.emblem),
  )
  const badges = [0, Math.PI].map((side) =>
    paint(new THREE.RingGeometry(0.07, 0.11, 6).rotateY(side).translate(Math.sin(side) * (reach + 0.004), height * 0.5, Math.cos(side) * (reach + 0.004)), KEG_LOOK.emblemInk),
  )
  const fuse = paint(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 6).rotateZ(-0.35).translate(0.12, height + 0.08, 0), KEG_LOOK.fuse)
  const trimParts = [...hoops, ...plates, ...badges, fuse]
  const trim = mergeGeometries(trimParts, false)
  for (const part of trimParts) part.dispose()
  shared = {
    body: new THREE.LatheGeometry(profile, 16),
    trim,
    spark: new THREE.SphereGeometry(0.06, 8, 6),
    trimMaterial: toonMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    sparkMaterial: new THREE.MeshBasicMaterial({ color: KEG_LOOK.spark }),
  }
  return shared
}

export function buildKeg(): KegParts {
  const parts = geometries()
  const root = new THREE.Group()
  root.name = 'keg'
  const body = toonMaterial({ color: KEG_LOOK.wood, emissive: new THREE.Color(KEG_LOOK.litGlow), emissiveIntensity: 0 })
  const height = KEG_HEIGHT - 0.08
  const hull = new THREE.Mesh(parts.body, body)
  hull.castShadow = true
  hull.receiveShadow = true
  const trim = new THREE.Mesh(parts.trim, parts.trimMaterial)
  trim.castShadow = false
  trim.receiveShadow = true
  const spark = new THREE.Mesh(parts.spark, parts.sparkMaterial)
  spark.position.set(0.16, height + 0.16, 0)
  spark.visible = false
  spark.castShadow = false
  spark.receiveShadow = true
  spark.userData.noInk = true
  root.add(hull, trim, spark)
  return { root, body, spark, fuseTop: height + 0.16 }
}
