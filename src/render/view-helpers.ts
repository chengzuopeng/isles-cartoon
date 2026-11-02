import * as THREE from 'three'

export type Disposable = { dispose(): void }

export const BULLET_HEIGHT = 0.62
export const GEAR_COLOR = '#2f3440'

export function flat<T extends THREE.Object3D>(object: T, height: number): T {
  object.rotation.x = -Math.PI / 2
  object.position.y = height
  return object
}

export function part(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(x, y, z)
  mesh.castShadow = true
  return mesh
}

export function standard(color: string, owned: Disposable[]): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color, emissive: '#ffffff', emissiveIntensity: 0 })
  owned.push(material)
  return material
}
