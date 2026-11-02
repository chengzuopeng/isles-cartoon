import * as THREE from 'three'

const PLAIN_DEPTH = solidDepth()
const TINTED_DEPTH = solidDepth()

function solidDepth(): THREE.MeshDepthMaterial {
  const material = new THREE.MeshDepthMaterial()
  for (const key of ['map', 'alphaMap'] as const) Object.defineProperty(material, key, { get: () => null, set: () => {} })
  return material
}

export function needsOwnDepth(material: THREE.Material): boolean {
  return (
    material.alphaTest > 0 ||
    material.alphaToCoverage ||
    (material.clippingPlanes?.length ?? 0) > 0 ||
    ('displacementMap' in material && Boolean(material.displacementMap))
  )
}

export function instancedDepth(mesh: THREE.InstancedMesh): THREE.MeshDepthMaterial | undefined {
  const { material } = mesh
  if (Array.isArray(material) || needsOwnDepth(material)) return undefined
  return mesh.instanceColor ? TINTED_DEPTH : PLAIN_DEPTH
}

export function shareInstancedDepth(meshes: Iterable<THREE.InstancedMesh>): void {
  for (const mesh of meshes) mesh.customDepthMaterial = instancedDepth(mesh)
}
