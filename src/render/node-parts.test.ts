import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { atlasGroups, atlasKey, atlasPart, mergeJoints, mergeMeshes, mergeStill, ownMeshes } from './node-parts'

function painted(map: THREE.Texture, roughness: number, metalness: number, name = 'mat_part'): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ map, roughness, metalness })
  material.name = name
  return material
}

describe('merging parts that share an atlas', () => {
  it('keeps each part look in a lookup texture read through uv1', () => {
    const atlas = new THREE.Texture()
    const parts = [
      { geometry: new THREE.BoxGeometry(1, 1, 1), material: painted(atlas, 0.62, 0) },
      { geometry: new THREE.BoxGeometry(0.5, 0.5, 0.5).translate(2, 0, 0), material: painted(atlas, 0.4, 0.25) },
      { geometry: new THREE.BoxGeometry(0.5, 0.5, 0.5).translate(-2, 0, 0), material: painted(atlas, 0.62, 0) },
    ]
    const merged = atlasPart(parts)
    if (!merged) throw new Error('not merged')
    const { geometry, material, lookup } = merged
    expect(material.map).toBe(atlas)
    expect(material.roughness).toBe(1)
    expect(material.metalness).toBe(1)
    expect(material.roughnessMap).toBe(lookup)
    expect(material.metalnessMap).toBe(lookup)
    expect(lookup.channel).toBe(1)
    expect(lookup.magFilter).toBe(THREE.NearestFilter)
    expect(lookup.image.width).toBe(2)
    const data = lookup.image.data as Uint8Array
    const texel = (u: number) => Math.floor(u * lookup.image.width)
    const uv1 = geometry.getAttribute('uv1')
    const position = geometry.getAttribute('position')
    expect(uv1.count).toBe(position.count)
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i)
      const at = texel(uv1.getX(i)) * 4
      const [roughness, metalness] = x > 1.5 ? [0.4, 0.25] : [0.62, 0]
      expect(data[at + 1] / 255).toBeCloseTo(roughness, 2)
      expect(data[at + 2] / 255).toBeCloseTo(metalness, 2)
    }
  })

  it('leaves alone what cannot share one draw', () => {
    const atlas = new THREE.Texture()
    const glowing = painted(atlas, 0.5, 0)
    glowing.emissive.set('#ff0000')
    const other = painted(new THREE.Texture(), 0.5, 0)
    const plain = new THREE.MeshStandardMaterial()
    const box = () => new THREE.BoxGeometry(1, 1, 1)
    expect(atlasKey(glowing)).toBeNull()
    expect(atlasKey(plain)).toBeNull()
    expect(atlasKey(new THREE.MeshBasicMaterial({ map: atlas }))).toBeNull()
    expect(atlasPart([{ geometry: box(), material: painted(atlas, 0.5, 0) }])).toBeNull()
    expect(atlasPart([{ geometry: box(), material: painted(atlas, 0.5, 0) }, { geometry: box(), material: other }])).toBeNull()
    expect(atlasPart([{ geometry: box(), material: painted(atlas, 0.5, 0) }, { geometry: box(), material: glowing }])).toBeNull()
  })

  it('folds the still meshes of a node into one draw per look and drops what it replaced', () => {
    const atlas = new THREE.Texture()
    const space = new THREE.Group()
    const decal = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), alphaTest: 0.5 })
    const lamp = new THREE.MeshStandardMaterial({ emissive: '#ff2200' })
    const add = (material: THREE.Material, x: number, parent: THREE.Object3D = space) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), material)
      mesh.position.x = x
      mesh.castShadow = true
      parent.add(mesh)
      return mesh
    }
    const moving = new THREE.Group()
    moving.userData.name = 'moving'
    space.add(moving)
    const body = add(painted(atlas, 0.6, 0), 0)
    const trim = add(painted(atlas, 0.4, 0.25), 0.3)
    const left = add(decal, -0.5)
    const right = add(decal, 0.5)
    const light = add(lamp, 0.8)
    const carried = add(painted(atlas, 0.6, 0), 1, moving)
    const meshes = ownMeshes(space, new Set([moving]))
    expect(meshes).toEqual([body, trim, left, right, light])
    const result = mergeStill(space, meshes)
    expect(result.added).toHaveLength(2)
    expect(result.materials).toHaveLength(1)
    expect([body, trim, left, right].every((mesh) => mesh.parent === null)).toBe(true)
    expect(light.parent).toBe(space)
    expect(carried.parent).toBe(moving)
    expect(space.children.filter((child) => (child as THREE.Mesh).isMesh && !child.visible)).toEqual([])
    expect(result.added.every((mesh) => mesh.parent === space && mesh.userData.still === true && mesh.castShadow)).toBe(true)
    expect(result.added.map((mesh) => mesh.material)).toEqual(expect.arrayContaining([decal, result.materials[0]]))
  })
})

describe('merging around joints', () => {
  it('folds the still meshes under the root and under each joint into that space, stopping at other joints', () => {
    const atlas = new THREE.Texture()
    const body = painted(atlas, 0.6, 0)
    const steel = painted(atlas, 0.42, 0.25)
    const glow = new THREE.MeshStandardMaterial({ emissive: '#ff8800' })
    const root = new THREE.Group()
    const joint = (name: string, parent: THREE.Object3D) => {
      const node = new THREE.Group()
      node.userData.name = name
      parent.add(node)
      return node
    }
    const add = (material: THREE.Material, parent: THREE.Object3D) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), material)
      parent.add(mesh)
      return mesh
    }
    const torso = joint('body', root)
    const head = joint('head', torso)
    const arm = joint('arm', torso)
    const hand = joint('hand', arm)
    const chest = [add(body, torso), add(steel, torso), add(body, head), add(steel, head)]
    const eye = add(glow, head)
    const lamp = add(glow, torso)
    lamp.add(new THREE.Object3D())
    const sleeve = [add(body, arm), add(steel, arm)]
    const fingers = [add(body, hand), add(steel, hand)]
    const result = mergeJoints(root, ['arm', 'hand', 'missing'])
    expect(result.added.map((mesh) => mesh.parent)).toEqual([root, arm, hand])
    expect([...chest, ...sleeve, ...fingers].every((mesh) => mesh.parent === null)).toBe(true)
    expect(eye.parent).toBe(head)
    expect(lamp.parent).toBe(torso)
    expect(result.materials).toHaveLength(3)
    expect(result.added.every((mesh) => mesh.userData.still === true && result.materials.includes(mesh.material as THREE.MeshStandardMaterial))).toBe(true)
    expect(result.added[0].geometry.getAttribute('position').count).toBe(4 * 24)
  })
})

function box(material: THREE.Material, x: number, parent: THREE.Object3D): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), material)
  mesh.position.x = x
  parent.add(mesh)
  return mesh
}

describe('merging meshes', () => {
  it('merges meshes by material in group order and remembers where each group starts', () => {
    const space = new THREE.Group()
    space.position.set(5, 0, 0)
    const iron = new THREE.MeshStandardMaterial({ name: 'iron' })
    const brass = new THREE.MeshStandardMaterial({ name: 'brass' })
    const groups = [0, 1, 2].map((index) => {
      const holder = new THREE.Group()
      holder.position.x = index
      space.add(holder)
      const meshes = [box(iron, 0, holder)]
      if (index !== 1) meshes.push(box(brass, 0.5, holder))
      return meshes
    })
    groups[2][0].castShadow = true
    const parts = mergeMeshes(groups, space)
    expect(parts.map((part) => part.material)).toEqual([iron, brass])
    const [ironPart, brassPart] = parts
    const perBox = new THREE.BoxGeometry(0.2, 0.2, 0.2).index?.count ?? 0
    expect(ironPart.starts).toEqual([0, perBox, perBox * 2])
    expect(brassPart.starts).toEqual([0, perBox, perBox])
    expect(ironPart.geometry.index?.count).toBe(perBox * 3)
    expect(ironPart.castShadow).toBe(true)
    expect(brassPart.castShadow).toBe(false)
    expect(ironPart.meshes).toHaveLength(3)
    ironPart.geometry.computeBoundingBox()
    const bounds = ironPart.geometry.boundingBox
    expect(bounds?.min.x).toBeCloseTo(-0.1, 6)
    expect(bounds?.max.x).toBeCloseTo(2.1, 6)
  })

  it('skips meshes without positions instead of merging empty geometry', () => {
    const space = new THREE.Group()
    const material = new THREE.MeshStandardMaterial()
    const empty = [new THREE.Mesh(new THREE.BufferGeometry(), material), new THREE.Mesh(new THREE.BufferGeometry(), material)]
    for (const mesh of empty) space.add(mesh)
    expect(mergeMeshes([empty], space)).toEqual([])
  })
})

describe('grouping parts by the atlas they share', () => {
  it('merges each set of parts on one texture into one part and keeps the glowing and untextured ones apart', () => {
    const atlas = new THREE.Texture()
    const other = new THREE.Texture()
    const glow = new THREE.MeshStandardMaterial({ emissive: '#ffb02e' })
    const parts = [
      { geometry: new THREE.BoxGeometry(1, 1, 1), material: painted(atlas, 0.6, 0) },
      { geometry: new THREE.BoxGeometry(1, 1, 1), material: painted(atlas, 0.3, 0.2) },
      { geometry: new THREE.BoxGeometry(1, 1, 1), material: painted(other, 0.6, 0) },
      { geometry: new THREE.BoxGeometry(0.2, 0.2, 0.2), material: glow },
    ]
    const grouped = atlasGroups(parts)
    expect(grouped.parts).toHaveLength(3)
    expect((grouped.parts[0].material as THREE.MeshStandardMaterial).map).toBe(atlas)
    expect(grouped.parts[0].geometry.getAttribute('uv1')).toBeDefined()
    expect(grouped.parts[1]).toBe(parts[2])
    expect(grouped.parts[2]).toBe(parts[3])
    expect(grouped.owned).toHaveLength(3)
  })
})
