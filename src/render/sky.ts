import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { toonMaterial } from './toon'

export interface SkyColors {
  base: string
  high: string
  cloud: string
  cloudShade: string
  horizon: string
  sun: string
  sunHalo: string
}

export interface SkyOptions {
  colors: SkyColors
  sunDirection: THREE.Vector3
  sea: string
  seaShadow: string
  seaHeight: number
  center: THREE.Vector3
  north: THREE.Vector3
}

export interface Sky {
  readonly group: THREE.Group
  readonly far: THREE.Group
  update(camera: THREE.Camera, dt: number): void
  dispose(): void
}

const RADIUS = 1400
const BOTTOM = -0.12
const TOP = 1.02

const DOME_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vDir = world.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const DOME_FRAGMENT = /* glsl */ `
uniform vec3 skyBase;
uniform vec3 skyHigh;
uniform vec3 cloudColor;
uniform vec3 cloudShade;
uniform vec3 horizonColor;
uniform vec3 sunColor;
uniform vec3 sunHalo;
uniform vec3 inkColor;
uniform vec3 sunDir;
uniform float time;
varying vec3 vDir;

float hash(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

float billow(vec2 p) {
  return noise(p) * 0.56 + noise(p * 2.3 + 11.0) * 0.3 + noise(p * 5.1 + 3.0) * 0.14;
}

void main() {
  vec3 dir = normalize(vDir);
  float up = dir.y;
  float bearing = atan(dir.z, dir.x);
  float wave = noise(vec2(bearing * 2.2, 3.0)) * 0.08 + noise(vec2(bearing * 6.0, 9.0)) * 0.03;
  vec3 color = mix(skyBase, skyHigh, step(0.4 + wave, up));
  float sunAngle = acos(clamp(dot(dir, sunDir), -1.0, 1.0));
  color = mix(color, sunHalo, step(sunAngle, 0.2));
  vec2 drift = vec2(time * 0.006, time * 0.002);
  vec2 p = dir.xz / (max(up, 0.0) + 0.3) * 2.4 + drift;
  vec2 below = dir.xz / (max(up - 0.035, 0.0) + 0.3) * 2.4 + drift;
  float shape = billow(p);
  float lower = billow(below);
  float level = 0.585;
  float cover = step(level, shape);
  float under = step(lower, level);
  vec3 cloud = mix(cloudColor, cloudShade, under);
  float width = max(fwidth(shape), 0.0005);
  float rim = 1.0 - smoothstep(width * 1.1, width * 2.2, abs(shape - level));
  float inner = 0.0;
  float present = smoothstep(0.05, 0.12, up);
  color = mix(color, cloud, cover * present);
  color = mix(color, inkColor, max(rim, inner) * present * 0.85);
  color = mix(color, sunColor * 1.25, step(sunAngle, 0.085));
  float band = step(up, 0.045 + wave * 0.5);
  color = mix(color, horizonColor, band);
  gl_FragColor = vec4(color, 1.0);
}
`

const SEA_VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const SEA_FRAGMENT = /* glsl */ `
uniform vec3 seaColor;
uniform vec3 shadowColor;
uniform vec3 horizonColor;
uniform vec3 inkColor;
uniform vec3 eye;
uniform float time;
varying vec3 vWorld;

float hash(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p) {
  float total = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    total += noise(p) * amplitude;
    p = p * 2.03 + vec2(17.1, 9.3);
    amplitude *= 0.5;
  }
  return total;
}

float dots(vec2 frag, float amount) {
  vec2 rotated = mat2(0.7071, -0.7071, 0.7071, 0.7071) * frag / 6.0;
  vec2 cell = fract(rotated) - 0.5;
  float d = length(cell);
  float r = sqrt(clamp(amount, 0.0, 1.0)) * 0.55;
  return 1.0 - smoothstep(r - 0.06, r + 0.06, d);
}

void main() {
  vec2 p = vWorld.xz * 0.012 + vec2(time * 0.004, time * 0.0015);
  float puff = fbm(p);
  float detail = fbm(p * 3.1 + 4.0);
  float shape = puff * 0.75 + detail * 0.25;
  vec3 color = mix(shadowColor, seaColor, smoothstep(0.42, 0.52, shape));
  float distance = length(vWorld.xz - eye.xz);
  float lineFade = 1.0 - smoothstep(120.0, 520.0, distance);
  float contour = (1.0 - smoothstep(0.0, 0.06, abs(shape - 0.46))) * lineFade;
  color = mix(color, color * 0.72, dots(gl_FragCoord.xy, (1.0 - smoothstep(0.38, 0.5, shape)) * 0.8) * lineFade);
  color = mix(color, inkColor, contour * 0.55);
  float fade = smoothstep(200.0, 1300.0, distance);
  color = mix(color, horizonColor, fade);
  gl_FragColor = vec4(color, 1.0);
}
`

function islandGeometry(radius: number, depth: number, seed: number): THREE.BufferGeometry {
  const geometry = new THREE.ConeGeometry(radius, depth, 9, 3, false)
  geometry.rotateX(Math.PI)
  geometry.translate(0, -depth / 2, 0)
  const position = geometry.getAttribute('position')
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i)
    if (y > -0.01) continue
    const angle = Math.atan2(position.getZ(i), position.getX(i))
    const wobble = 1 + Math.sin(angle * 3 + seed) * 0.12 + Math.sin(angle * 7 + seed * 2) * 0.06
    position.setX(i, position.getX(i) * wobble)
    position.setZ(i, position.getZ(i) * wobble)
  }
  geometry.computeVertexNormals()
  return geometry
}

function farIsland(seed: number, radius: number, rock: THREE.Material, grass: THREE.Material, tree: THREE.Material): THREE.Group {
  const group = new THREE.Group()
  const base = new THREE.Mesh(islandGeometry(radius, radius * 1.3, seed), rock)
  group.add(base)
  const top = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.02, radius * 0.98, radius * 0.08, 9), grass)
  top.position.y = radius * 0.04
  group.add(top)
  const count = 3 + (seed % 4)
  for (let i = 0; i < count; i++) {
    const angle = seed * 1.7 + i * 2.1
    const distance = radius * (0.25 + ((seed * 13 + i * 7) % 10) / 16)
    const size = radius * (0.1 + ((i * 5 + seed) % 4) * 0.03)
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 0), tree)
    crown.position.set(Math.cos(angle) * distance, radius * 0.08 + size * 0.8, Math.sin(angle) * distance)
    group.add(crown)
  }
  return group
}

function starTower(stone: THREE.Material, trim: THREE.Material, glow: THREE.Material): THREE.Group {
  const group = new THREE.Group()
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(9, 16, 260, 8), stone)
  shaft.position.y = 130
  group.add(shaft)
  for (let i = 0; i < 4; i++) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(18 - i * 2.2, 18 - i * 2.2, 7, 8), trim)
    ring.position.y = 50 + i * 55
    group.add(ring)
  }
  const crown = new THREE.Mesh(new THREE.ConeGeometry(14, 60, 8), trim)
  crown.position.y = 290
  group.add(crown)
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(12, 0), glow)
  star.position.y = 340
  star.scale.set(1, 1.4, 0.4)
  star.name = 'star'
  group.add(star)
  const base = new THREE.Mesh(islandGeometry(70, 110, 5), stone)
  group.add(base)
  return group
}

export function mergeByMaterial(root: THREE.Object3D, keep: THREE.Object3D): void {
  root.updateMatrixWorld(true)
  const inverse = root.matrixWorld.clone().invert()
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>()
  const merged: THREE.Mesh[] = []
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || mesh === keep || Array.isArray(mesh.material)) return
    const geometry = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(mesh.matrixWorld.clone().premultiply(inverse))
    for (const name of Object.keys(geometry.attributes)) if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name)
    const list = groups.get(mesh.material) ?? []
    list.push(geometry)
    groups.set(mesh.material, list)
    merged.push(mesh)
  })
  for (const mesh of merged) {
    mesh.removeFromParent()
    mesh.geometry.dispose()
  }
  for (const node of [...root.children]) if (node !== keep && node.children.length === 0 && !(node as THREE.Mesh).isMesh) node.removeFromParent()
  for (const [material, geometries] of groups) {
    const geometry = mergeGeometries(geometries)
    for (const part of geometries) part.dispose()
    if (!geometry) continue
    geometry.computeBoundingSphere()
    root.add(new THREE.Mesh(geometry, material))
  }
}

export function createSky(options: SkyOptions): Sky {
  const group = new THREE.Group()
  group.name = 'sky'
  const far = new THREE.Group()
  far.name = 'far'
  const colors = options.colors
  const domeMaterial = new THREE.ShaderMaterial({
    vertexShader: DOME_VERTEX,
    fragmentShader: DOME_FRAGMENT,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      skyBase: { value: new THREE.Color(colors.base) },
      skyHigh: { value: new THREE.Color(colors.high) },
      cloudColor: { value: new THREE.Color(colors.cloud) },
      cloudShade: { value: new THREE.Color(colors.cloudShade) },
      horizonColor: { value: new THREE.Color(colors.horizon) },
      sunColor: { value: new THREE.Color(colors.sun) },
      sunHalo: { value: new THREE.Color(colors.sunHalo) },
      inkColor: { value: new THREE.Color('#1d1714') },
      sunDir: { value: options.sunDirection.clone().normalize() },
      time: { value: 0 },
    },
  })

  const height = (TOP - BOTTOM) * RADIUS
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS, RADIUS, height, 96, 1, true), domeMaterial)
  wall.position.y = (BOTTOM + TOP) * 0.5 * RADIUS
  wall.renderOrder = -1000
  wall.userData.noInk = true
  group.add(wall)

  const capGeometry = new THREE.CircleGeometry(RADIUS, 96)
  capGeometry.rotateX(Math.PI / 2)
  const cap = new THREE.Mesh(capGeometry, domeMaterial)
  cap.position.y = TOP * RADIUS - 0.5
  cap.renderOrder = -1000
  cap.userData.noInk = true
  group.add(cap)

  const lowGeometry = new THREE.CylinderGeometry(RADIUS, RADIUS, RADIUS, 48, 1, true)
  const low = new THREE.Mesh(lowGeometry, domeMaterial)
  low.position.y = BOTTOM * RADIUS - RADIUS / 2
  low.renderOrder = -1001
  low.userData.noInk = true
  group.add(low)

  const seaMaterial = new THREE.ShaderMaterial({
    vertexShader: SEA_VERTEX,
    fragmentShader: SEA_FRAGMENT,
    uniforms: {
      seaColor: { value: new THREE.Color(options.sea) },
      shadowColor: { value: new THREE.Color(options.seaShadow) },
      horizonColor: { value: new THREE.Color(colors.horizon) },
      inkColor: { value: new THREE.Color('#1d1714') },
      eye: { value: new THREE.Vector3() },
      time: { value: 0 },
    },
  })
  const sea = new THREE.Mesh(new THREE.CircleGeometry(RADIUS * 1.2, 64), seaMaterial)
  sea.rotation.x = -Math.PI / 2
  sea.position.set(options.center.x, options.seaHeight, options.center.z)
  sea.userData.noInk = true
  far.add(sea)

  const rock = toonMaterial({ color: '#9a7a5c' })
  const grass = toonMaterial({ color: '#86b85a' })
  const tree = toonMaterial({ color: '#4f8a3e' })
  const spots = [
    { angle: 0.4, distance: 520, radius: 70, lift: 30 },
    { angle: 1.3, distance: 760, radius: 120, lift: 80 },
    { angle: 2.2, distance: 430, radius: 45, lift: -10 },
    { angle: 2.9, distance: 880, radius: 150, lift: 120 },
    { angle: 3.8, distance: 610, radius: 85, lift: 50 },
    { angle: 4.6, distance: 380, radius: 38, lift: 20 },
    { angle: 5.3, distance: 700, radius: 110, lift: -20 },
    { angle: 5.9, distance: 980, radius: 160, lift: 140 },
  ]
  spots.forEach((spot, index) => {
    const island = farIsland(index + 2, spot.radius, rock, grass, tree)
    island.position.set(options.center.x + Math.cos(spot.angle) * spot.distance, spot.lift, options.center.z + Math.sin(spot.angle) * spot.distance)
    island.rotation.y = spot.angle * 2.3
    far.add(island)
  })

  mergeByMaterial(far, sea)

  const stone = toonMaterial({ color: '#c9c2d6' })
  const trim = toonMaterial({ color: '#d8b25a' })
  const glow = toonMaterial({ color: '#fff2b0', emissive: '#ffe27a', emissiveIntensity: 3 })
  const tower = starTower(stone, trim, glow)
  tower.position.copy(options.center).addScaledVector(options.north, 1500)
  tower.position.y = -60
  far.add(tower)
  const towerStar = tower.getObjectByName('star')

  let time = 0
  return {
    group,
    far,
    update(camera, dt) {
      time += dt
      group.position.set(camera.position.x, camera.position.y, camera.position.z)
      seaMaterial.uniforms.time.value = time
      domeMaterial.uniforms.time.value = time
      seaMaterial.uniforms.eye.value.copy(camera.position)
      if (towerStar) towerStar.rotation.y = time * 0.6
    },
    dispose() {
      domeMaterial.dispose()
      group.traverse((object) => {
        const mesh = object as THREE.Mesh
        if (mesh.isMesh) mesh.geometry.dispose()
      })
      far.traverse((object) => {
        const mesh = object as THREE.Mesh
        if (mesh.isMesh) mesh.geometry.dispose()
      })
      seaMaterial.dispose()
      rock.dispose()
      grass.dispose()
      tree.dispose()
      stone.dispose()
      trim.dispose()
      glow.dispose()
    },
  }
}
