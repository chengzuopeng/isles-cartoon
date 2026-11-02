import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { instancedDepth, shareInstancedDepth } from './instanced-depth'

function instanced(material: THREE.Material, tinted: boolean): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), material, 2)
  if (tinted) mesh.setColorAt(0, new THREE.Color(1, 1, 1))
  return mesh
}

describe('instanced shadow depth', () => {
  it('gives every plain instanced mesh one depth material and every tinted one another', () => {
    const plain = [instanced(new THREE.MeshStandardMaterial(), false), instanced(new THREE.MeshStandardMaterial({ map: new THREE.Texture() }), false)]
    const tinted = [instanced(new THREE.MeshStandardMaterial(), true), instanced(new THREE.MeshBasicMaterial(), true)]
    shareInstancedDepth([...plain, ...tinted])
    const [a, b] = plain.map((mesh) => mesh.customDepthMaterial)
    const [c, d] = tinted.map((mesh) => mesh.customDepthMaterial)
    expect(a).toBeInstanceOf(THREE.MeshDepthMaterial)
    expect(b).toBe(a)
    expect(c).toBeInstanceOf(THREE.MeshDepthMaterial)
    expect(d).toBe(c)
    expect(c).not.toBe(a)
  })

  it('keeps the shared depth materials free of color maps so the shadow pass samples no textures', () => {
    const depth = instancedDepth(instanced(new THREE.MeshStandardMaterial({ map: new THREE.Texture() }), true))
    expect(depth).toBeDefined()
    if (!depth) return
    depth.map = new THREE.Texture()
    depth.alphaMap = new THREE.Texture()
    expect(depth.map).toBeNull()
    expect(depth.alphaMap).toBeNull()
  })

  it('leaves cut-out and displaced materials to the renderer, which needs a depth material per source', () => {
    expect(instancedDepth(instanced(new THREE.MeshStandardMaterial({ alphaTest: 0.5, map: new THREE.Texture() }), true))).toBeUndefined()
    expect(instancedDepth(instanced(new THREE.MeshStandardMaterial({ displacementMap: new THREE.Texture() }), false))).toBeUndefined()
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), [new THREE.MeshStandardMaterial()], 1)
    expect(instancedDepth(mesh)).toBeUndefined()
  })
})
