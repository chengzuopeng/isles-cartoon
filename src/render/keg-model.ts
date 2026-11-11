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

let shared: { body: THREE.BufferGeometry; hoop: THREE.BufferGeometry; emblem: THREE.BufferGeometry; badge: THREE.BufferGeometry; fuse: THREE.BufferGeometry; spark: THREE.BufferGeometry } | null = null

function geometries() {
  if (shared) return shared
  const height = KEG_HEIGHT - 0.08
  const profile: THREE.Vector2[] = []
  const steps = 10
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    profile.push(new THREE.Vector2(KEG_LOOK.radius + Math.sin(t * Math.PI) * KEG_LOOK.bulge, t * height))
  }
  const hoops = [0.16, height - 0.16].map((at) => new THREE.CylinderGeometry(KEG_LOOK.radius + 0.035, KEG_LOOK.radius + 0.035, 0.07, 16, 1, true).translate(0, at, 0))
  const reach = KEG_LOOK.radius + KEG_LOOK.bulge + 0.005
  const plates = [0, Math.PI].map((side) => new THREE.CircleGeometry(0.2, 20).rotateY(side).translate(Math.sin(side) * reach, height * 0.5, Math.cos(side) * reach))
  const badges = [0, Math.PI].map((side) => new THREE.RingGeometry(0.07, 0.11, 6).rotateY(side).translate(Math.sin(side) * (reach + 0.004), height * 0.5, Math.cos(side) * (reach + 0.004)))
  shared = {
    body: new THREE.LatheGeometry(profile, 16),
    hoop: mergeGeometries(hoops, false),
    emblem: mergeGeometries(plates, false),
    badge: mergeGeometries(badges, false),
    fuse: new THREE.CylinderGeometry(0.025, 0.025, 0.16, 6),
    spark: new THREE.SphereGeometry(0.06, 8, 6),
  }
  return shared
}

export function buildKeg(): KegParts {
  const parts = geometries()
  const root = new THREE.Group()
  root.name = 'keg'
  const body = toonMaterial({ color: KEG_LOOK.wood, emissive: new THREE.Color(KEG_LOOK.litGlow), emissiveIntensity: 0 })
  const hoop = toonMaterial({ color: KEG_LOOK.hoop, side: THREE.DoubleSide })
  const emblem = toonMaterial({ color: KEG_LOOK.emblem, side: THREE.DoubleSide })
  const badge = toonMaterial({ color: KEG_LOOK.emblemInk, side: THREE.DoubleSide })
  const fuse = toonMaterial({ color: KEG_LOOK.fuse })
  const height = KEG_HEIGHT - 0.08
  root.add(new THREE.Mesh(parts.body, body))
  root.add(new THREE.Mesh(parts.hoop, hoop))
  root.add(new THREE.Mesh(parts.emblem, emblem))
  root.add(new THREE.Mesh(parts.badge, badge))
  const wick = new THREE.Mesh(parts.fuse, fuse)
  wick.position.set(0.12, height + 0.08, 0)
  wick.rotation.z = -0.35
  root.add(wick)
  const spark = new THREE.Mesh(parts.spark, new THREE.MeshBasicMaterial({ color: KEG_LOOK.spark }))
  spark.position.set(0.16, height + 0.16, 0)
  spark.visible = false
  spark.userData.noInk = true
  root.add(spark)
  root.traverse((object) => {
    object.castShadow = object !== spark
    object.receiveShadow = true
  })
  return { root, body, spark, fuseTop: height + 0.16 }
}
