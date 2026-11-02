import * as THREE from 'three'

export function radialTexture(size = 64, falloff = 2.2, core = 0): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4)
  const half = (size - 1) / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.min(1, Math.hypot(x - half, y - half) / half)
      const glow = Math.pow(1 - distance, falloff)
      const alpha = distance < core ? 1 : glow
      const index = (y * size + x) * 4
      data[index] = 255
      data[index + 1] = 255
      data[index + 2] = 255
      data[index + 3] = Math.round(Math.min(1, alpha) * 255)
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

export function glowSprite(texture: THREE.Texture, color: THREE.ColorRepresentation, size: number): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: texture,
    color,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const sprite = new THREE.Sprite(material)
  sprite.scale.setScalar(size)
  sprite.castShadow = false
  return sprite
}

export function groundGlow(texture: THREE.Texture, color: THREE.ColorRepresentation, radius: number, height: number): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), material)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = height
  mesh.castShadow = false
  return mesh
}
