import * as THREE from 'three'
import type { MinionKind } from '../data/enemies'
import { assetUrl } from './asset-urls'
import { kaiFromLibrary } from './kai-model'
import { prepareOverlay, type ModelLibrary, type Rig } from './model-library'

export const EYE_COLOR = '#ffb02e'

type Triple = readonly [number, number, number]

export interface PlayerModel {
  root: THREE.Object3D
  materials: THREE.Material[]
  tintable: THREE.MeshStandardMaterial[]
  nodes: Map<string, THREE.Object3D>
  scarf: THREE.Object3D[][]
  rig: Rig | null
  mount: THREE.Object3D | null
}

export interface RobotParts {
  lift: THREE.Object3D | null
  lamps: THREE.Mesh[]
}

export interface ReaperParts {
  reel: THREE.Object3D
  shard: THREE.Object3D
}

export interface ModelKit {
  buildKai(models?: ModelLibrary): PlayerModel
  buildRobot(kind: MinionKind, body: THREE.MeshStandardMaterial, base: THREE.Group, turn: THREE.Group): RobotParts
  decorateScarecrow(turn: THREE.Group): void
  buildReaper(body: THREE.MeshStandardMaterial, turn: THREE.Group, tint: THREE.MeshStandardMaterial[]): ReaperParts
}

export function createModelKit(): ModelKit {
  const box = new THREE.BoxGeometry(1, 1, 1)
  const cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 14)
  const sphere = new THREE.SphereGeometry(0.5, 18, 14)
  const cone = new THREE.ConeGeometry(0.5, 1, 8)
  const plane = new THREE.PlaneGeometry(1, 1)
  const ring = new THREE.TorusGeometry(0.5, 0.16, 8, 24)
  const star = new THREE.OctahedronGeometry(0.5, 0)

  const emblemTexture = new THREE.TextureLoader().load(assetUrl.item('emblem'))
  emblemTexture.colorSpace = THREE.SRGBColorSpace
  const emblem = new THREE.MeshBasicMaterial({ map: emblemTexture, alphaTest: 0.5 })
  const eye = new THREE.MeshBasicMaterial({ color: EYE_COLOR })
  const lamp = new THREE.MeshBasicMaterial({ color: '#ff3b30' })
  const dark = new THREE.MeshStandardMaterial({ color: '#2f3440', flatShading: true })
  const brass = new THREE.MeshStandardMaterial({ color: '#c9a04a', metalness: 0.35, roughness: 0.45 })
  const wood = new THREE.MeshStandardMaterial({ color: '#8a5a32', flatShading: true })
  const straw = new THREE.MeshStandardMaterial({ color: '#e2c25e', flatShading: true })
  const glass = new THREE.MeshStandardMaterial({ color: '#cfeeff', transparent: true, opacity: 0.38, roughness: 0.1, depthWrite: false })
  const skin = new THREE.MeshStandardMaterial({ color: '#f5cfa8' })
  const rust = new THREE.MeshStandardMaterial({ color: '#b5482e' })
  const shardGlow = new THREE.MeshBasicMaterial({ color: '#c9fbff' })

  function add(
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    position: Triple,
    scale: Triple | number,
    rotation: Triple = [0, 0, 0],
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(position[0], position[1], position[2])
    if (typeof scale === 'number') mesh.scale.setScalar(scale)
    else mesh.scale.set(scale[0], scale[1], scale[2])
    mesh.rotation.set(rotation[0], rotation[1], rotation[2])
    mesh.castShadow = true
    parent.add(mesh)
    return mesh
  }

  function decal(parent: THREE.Object3D, position: Triple, size: number, facing: 'front' | 'up' | 'left' | 'right'): void {
    const rotation: Triple =
      facing === 'front' ? [0, Math.PI / 2, 0] : facing === 'up' ? [-Math.PI / 2, 0, 0] : facing === 'left' ? [0, 0, 0] : [0, Math.PI, 0]
    const mesh = add(parent, plane, emblem, position, size, rotation)
    mesh.castShadow = false
  }

  function legs(parent: THREE.Object3D, spread: number, height: number, foot: Triple): void {
    for (const side of [-1, 1]) {
      add(parent, cylinder, dark, [0, height / 2 + 0.04, side * spread], [0.09, height, 0.09])
      add(parent, box, dark, [0.03, 0.05, side * spread], foot)
    }
  }

  return {
    buildKai(models) {
      if (models?.has('kai')) return kaiFromLibrary(models)
      const materials: THREE.MeshStandardMaterial[] = []
      const paint = (color: string) => {
        const material = new THREE.MeshStandardMaterial({ color, emissive: '#ff4d3d', emissiveIntensity: 0, transparent: true })
        materials.push(material)
        return material
      }
      const jacket = paint('#f08a24')
      const scarfColor = paint('#ff6a1a')
      const hair = paint('#6b4630')
      const face = paint('#f5cfa8')
      const pants = paint('#34303c')
      const boots = paint('#5a3a22')
      const goggle = paint('#3a3a44')
      const lens = paint('#ffc24d')
      const pupil = paint('#1d1d24')
      const root = new THREE.Group()

      for (const side of [-1, 1]) {
        add(root, box, boots, [0.04, 0.06, side * 0.1], [0.22, 0.12, 0.13])
        add(root, cylinder, pants, [0, 0.2, side * 0.09], [0.13, 0.2, 0.13])
        add(root, cylinder, jacket, [0.16, 0.58, side * 0.19], [0.1, 0.26, 0.1], [0, 0, Math.PI / 2 - 0.25])
        add(root, sphere, face, [0.3, 0.62, side * 0.17], 0.1)
      }
      add(root, cylinder, jacket, [0, 0.48, 0], [0.46, 0.34, 0.42])
      add(root, cylinder, boots, [0, 0.33, 0], [0.48, 0.06, 0.44])
      add(root, sphere, face, [0, 0.9, 0], 0.56)
      add(root, sphere, hair, [-0.06, 1.04, 0], [0.62, 0.4, 0.62])
      add(root, sphere, hair, [0.16, 1.1, 0], [0.2, 0.1, 0.42])
      for (const [x, y, z, tilt, turn] of [
        [-0.04, 1.2, 0, 0.3, 0],
        [-0.14, 1.15, 0.13, 0.7, 0.6],
        [-0.14, 1.15, -0.13, 0.7, -0.6],
        [-0.24, 1.03, 0, 1.25, 0],
        [0.06, 1.17, 0.14, -0.2, 0.9],
      ] as const) {
        add(root, cone, hair, [x, y, z], [0.13, 0.22, 0.13], [turn, 0, tilt])
      }
      for (const side of [-1, 1]) {
        add(root, cylinder, goggle, [0.2, 1.18, side * 0.1], [0.18, 0.07, 0.18], [0, 0, Math.PI / 2 - 1.0])
        add(root, cylinder, lens, [0.215, 1.195, side * 0.1], [0.13, 0.07, 0.13], [0, 0, Math.PI / 2 - 1.0])
        add(root, sphere, pupil, [0.255, 0.9, side * 0.08], [0.05, 0.08, 0.05])
      }
      add(root, ring, scarfColor, [0, 0.7, 0], [0.42, 0.42, 0.42], [Math.PI / 2, 0, 0])
      const scarf = new THREE.Group()
      scarf.position.set(-0.18, 0.72, 0.04)
      scarf.rotation.z = 0.35
      for (const offset of [-0.07, 0.07]) {
        add(scarf, box, scarfColor, [-0.24, 0, offset], [0.5, 0.05, 0.13], [0, offset * 2.5, 0])
      }
      root.add(scarf)
      prepareOverlay(root, 11)
      return { root, materials, tintable: materials, nodes: new Map(), scarf: [[scarf]], rig: null, mount: null }
    },

    buildRobot(kind, body, base, turn) {
      const parts: RobotParts = { lift: null, lamps: [] }
      switch (kind) {
        case 'grunt':
          legs(turn, 0.13, 0.16, [0.18, 0.1, 0.14])
          add(turn, box, body, [0, 0.46, 0], [0.5, 0.42, 0.56])
          add(turn, box, body, [0.03, 0.82, 0], [0.36, 0.28, 0.38])
          add(turn, box, eye, [0.215, 0.84, 0], [0.04, 0.07, 0.26])
          decal(turn, [0.252, 0.48, 0], 0.26, 'front')
          add(turn, box, dark, [0.05, 0.46, 0.33], [0.2, 0.1, 0.1])
          add(turn, box, dark, [0.14, 0.48, -0.33], [0.36, 0.1, 0.1])
          for (const z of [-0.07, 0, 0.07]) add(turn, box, dark, [0.42, 0.48, -0.33 + z], [0.22, 0.04, 0.04])
          break
        case 'gunner':
          legs(turn, 0.1, 0.3, [0.16, 0.08, 0.12])
          add(turn, cylinder, body, [0, 0.58, 0], [0.42, 0.52, 0.38])
          add(turn, box, body, [0, 0.96, 0], [0.26, 0.22, 0.26])
          add(turn, sphere, eye, [0.13, 0.97, 0], 0.11)
          add(turn, cylinder, dark, [-0.06, 1.2, 0.06], [0.025, 0.28, 0.025])
          add(turn, sphere, lamp, [-0.06, 1.35, 0.06], 0.08)
          add(turn, box, dark, [0.4, 0.66, -0.21], [0.62, 0.1, 0.1])
          add(turn, box, dark, [0.12, 0.62, -0.21], [0.18, 0.16, 0.12])
          decal(turn, [0.216, 0.6, 0], 0.22, 'front')
          break
        case 'bomber':
          legs(turn, 0.12, 0.12, [0.14, 0.08, 0.1])
          add(turn, sphere, body, [0, 0.42, 0], 0.72)
          for (const z of [-0.12, 0.12]) parts.lamps.push(add(turn, sphere, lamp, [0.3, 0.52, z], 0.08))
          decal(turn, [0.37, 0.36, 0], 0.24, 'front')
          break
        case 'shield':
          legs(turn, 0.16, 0.16, [0.2, 0.1, 0.16])
          add(turn, box, body, [0, 0.52, 0], [0.56, 0.5, 0.66])
          add(turn, box, body, [-0.02, 0.9, 0], [0.34, 0.26, 0.36])
          add(turn, box, eye, [0.155, 0.92, 0], [0.04, 0.06, 0.24])
          add(turn, box, wood, [0.5, 0.6, 0], [0.1, 0.95, 0.92])
          for (const y of [0.3, 0.9]) add(turn, box, dark, [0.5, y, 0], [0.11, 0.07, 0.94])
          add(turn, box, dark, [0.5, 0.6, 0], [0.11, 0.07, 1.05], [0.62, 0, 0])
          decal(turn, [0.557, 0.6, 0], 0.4, 'front')
          break
        case 'thrower': {
          legs(turn, 0.12, 0.16, [0.16, 0.08, 0.12])
          add(turn, box, body, [0, 0.48, 0], [0.44, 0.44, 0.48])
          add(turn, box, body, [0.02, 0.84, 0], [0.3, 0.24, 0.32])
          add(turn, box, eye, [0.175, 0.86, 0], [0.04, 0.06, 0.2])
          add(turn, cylinder, dark, [-0.22, 0.86, 0.05], [0.22, 0.5, 0.22], [0, 0, 0.35])
          add(turn, ring, brass, [-0.3, 1.09, 0.05], [0.24, 0.24, 0.24], [Math.PI / 2, 0.35, 0])
          decal(turn, [0.225, 0.5, 0], 0.22, 'front')
          const lift = new THREE.Group()
          add(lift, sphere, dark, [0.28, 0.8, 0.27], 0.34)
          turn.add(lift)
          parts.lift = lift
          break
        }
        case 'turret':
          for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 2 + Math.PI / 6
            const leg = add(base, box, dark, [Math.cos(angle) * 0.3, 0.2, Math.sin(angle) * 0.3], [0.08, 0.46, 0.08])
            leg.rotation.set(Math.sin(angle) * 0.45, 0, -Math.cos(angle) * 0.45)
          }
          add(base, cylinder, body, [0, 0.44, 0], [0.5, 0.16, 0.5])
          add(turn, box, body, [0, 0.67, 0], [0.6, 0.32, 0.6])
          add(turn, sphere, eye, [0.3, 0.72, 0], 0.12)
          for (const z of [-0.15, 0, 0.15]) add(turn, box, dark, [0.55, 0.68, z], [0.6, 0.09, 0.09])
          decal(turn, [-0.05, 0.831, 0], 0.4, 'up')
          break
      }
      return parts
    },

    decorateScarecrow(turn) {
      for (const z of [-1.5, 1.5]) {
        for (const spread of [-0.25, 0, 0.25]) add(turn, cone, straw, [0, 1.75 + spread * 0.4, z + Math.sign(z) * 0.15], [0.14, 0.4, 0.14], [spread, 0, Math.sign(z) * 1.4])
      }
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2
        add(turn, cone, straw, [Math.cos(angle) * 0.78, 2.45, Math.sin(angle) * 0.78], [0.16, 0.36, 0.16], [Math.sin(angle) * 2.8, 0, -Math.cos(angle) * 2.8])
      }
      decal(turn, [0.915, 1.45, 0], 0.7, 'front')
    },

    buildReaper(body, turn, tint) {
      body.color.set('#c8322a')
      const metal = new THREE.MeshStandardMaterial({ color: '#c9b28a', emissive: '#ffffff', emissiveIntensity: 0 })
      tint.push(metal)
      add(turn, box, body, [0, 1.0, 0], [2.3, 1.2, 2])
      for (const [x, z] of [
        [-0.8, 1],
        [0.8, 1],
        [-0.8, -1],
        [0.8, -1],
      ] as const) {
        add(turn, cylinder, dark, [x, 0.42, z], [0.84, 0.3, 0.84], [Math.PI / 2, 0, 0])
      }
      for (const side of [-1, 1]) decal(turn, [0, 1.05, side * 1.005], 0.8, side > 0 ? 'left' : 'right')
      add(turn, box, metal, [-0.55, 1.75, 0], [0.9, 0.4, 1.1])
      add(turn, sphere, skin, [-0.5, 2.1, 0], 0.26)
      add(turn, sphere, rust, [-0.52, 2.2, 0], [0.32, 0.24, 0.32])
      add(turn, cylinder, dark, [-0.52, 2.36, 0], [0.08, 0.12, 0.08])
      const dome = add(turn, sphere, glass, [-0.55, 2.05, 0], [0.92, 0.8, 1.0])
      dome.castShadow = false
      add(turn, cylinder, dark, [-0.9, 2.3, 0.6], [0.26, 0.9, 0.3])
      const reel = new THREE.Group()
      reel.position.set(1.5, 0.75, 0)
      turn.add(reel)
      add(reel, cylinder, metal, [0, 0, 0], [0.44, 3.2, 0.44], [Math.PI / 2, 0, 0])
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2
        add(reel, box, dark, [Math.cos(angle) * 0.33, Math.sin(angle) * 0.33, -1.3 + i * 0.65], [0.24, 0.06, 0.45], [0, 0, angle])
      }
      for (const z of [-0.7, 0.7]) add(turn, sphere, eye, [1.16, 1.45, z], 0.26)
      const shard = add(turn, star, shardGlow, [1.15, 1.35, 0], [0.5, 0.62, 0.5])
      shard.castShadow = false
      return { reel, shard }
    },
  }
}
