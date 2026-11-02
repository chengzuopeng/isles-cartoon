import * as THREE from 'three'
import { SUN_OFFSET } from './stage'
import { BLOB_SHADOW } from './themes'

export interface BlobShadows {
  readonly mesh: THREE.InstancedMesh
  begin(): void
  add(x: number, z: number, radius: number, strength: number): void
  end(): void
  dispose(): void
}

export interface BlobLook {
  darkness: number
  size: number
  stretch: number
  offset: number
  height: number
}

const UP = new THREE.Vector3(0, 1, 0)
const SPOT = new THREE.Vector3()
const TURN = new THREE.Quaternion()
const SCALE = new THREE.Vector3()

export function shadowHeading(sun: THREE.Vector3 = SUN_OFFSET): { x: number; z: number } {
  const length = Math.hypot(sun.x, sun.z)
  return length > 1e-6 ? { x: -sun.x / length, z: -sun.z / length } : { x: 0, z: 0 }
}

const HEADING = shadowHeading()

export function blobMatrix(x: number, z: number, radius: number, out: THREE.Matrix4, look: BlobLook = BLOB_SHADOW, heading = HEADING): THREE.Matrix4 {
  const width = radius * 2 * look.size
  SPOT.set(x + heading.x * radius * look.offset * 2, look.height, z + heading.z * radius * look.offset * 2)
  TURN.setFromAxisAngle(UP, Math.atan2(-heading.z, heading.x))
  SCALE.set(width * look.stretch, 1, width)
  return out.compose(SPOT, TURN, SCALE)
}

export function blobTone(strength: number, out: THREE.Color, look: BlobLook = BLOB_SHADOW): THREE.Color {
  const amount = look.darkness * Math.min(1, Math.max(0, strength))
  return out.setRGB(amount, amount, amount, THREE.SRGBColorSpace)
}

export function blobMask(distance: number, inner: number = BLOB_SHADOW.inner): number {
  const t = Math.min(1, Math.max(0, (distance - inner) / Math.max(1e-6, 1 - inner)))
  return 1 - t * t * (3 - 2 * t)
}

export function blobTexture(size: number = BLOB_SHADOW.texture, inner: number = BLOB_SHADOW.inner): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4)
  const half = size / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4
      data[index] = 255
      data[index + 1] = 255
      data[index + 2] = 255
      data[index + 3] = Math.round(blobMask(Math.hypot(x + 0.5 - half, y + 0.5 - half) / half, inner) * 255)
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

export function createBlobShadows(parent: THREE.Object3D, capacity = 32): BlobShadows {
  const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  const texture = blobTexture()
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
    blending: THREE.SubtractiveBlending,
  })
  const matrix = new THREE.Matrix4()
  const tone = new THREE.Color()
  let size = capacity
  let used = 0
  const build = () => {
    const created = new THREE.InstancedMesh(geometry, material, size)
    created.setColorAt(0, tone.setScalar(0))
    created.count = 0
    created.frustumCulled = false
    created.castShadow = false
    created.receiveShadow = false
    created.renderOrder = BLOB_SHADOW.order
    parent.add(created)
    return created
  }
  let mesh = build()
  return {
    get mesh() {
      return mesh
    },
    begin() {
      used = 0
    },
    add(x, z, radius, strength) {
      if (strength <= 0) return
      if (used >= size) {
        const previous = mesh
        size *= 2
        mesh = build()
        for (let i = 0; i < used; i++) {
          previous.getMatrixAt(i, matrix)
          mesh.setMatrixAt(i, matrix)
          previous.getColorAt(i, tone)
          mesh.setColorAt(i, tone)
        }
        previous.removeFromParent()
        previous.dispose()
      }
      mesh.setMatrixAt(used, blobMatrix(x, z, radius, matrix))
      mesh.setColorAt(used, blobTone(strength, tone))
      used += 1
    },
    end() {
      mesh.count = used
      mesh.visible = used > 0
      if (used === 0) return
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    },
    dispose() {
      mesh.removeFromParent()
      mesh.dispose()
      geometry.dispose()
      material.dispose()
      texture.dispose()
    },
  }
}
