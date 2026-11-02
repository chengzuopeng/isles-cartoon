import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { ModelId } from './asset-urls'
import { ENEMY_JOINTS } from './enemy-rigs'
import { HELD_JOINTS, KAI_JOINTS } from './kai-model'
import { createModelLibrary, nodeMap, type ModelInstance } from './model-library'
import {
  JOINT_ATTRIBUTE,
  RIGID_PROGRAM,
  RigidDepthMaterial,
  RigidStandardMaterial,
  bindRigid,
  jointMatrices,
  mergeRigid,
  rigidMeshes,
  rigidVertex,
  type RigidTable,
} from './rigid-parts'
import { glbLibrary } from './testing'
import { RIGID_PARTS } from './themes'

const atlas = new THREE.Texture()

function look(name: string, roughness: number, emissive = '#000000'): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ map: emissive === '#000000' ? atlas : null, roughness, emissive })
  material.name = name
  return material
}

function part<T extends THREE.Object3D>(object: T, name: string, parent: THREE.Object3D, x = 0, y = 0, z = 0): T {
  object.name = name
  object.userData.name = name
  object.position.set(x, y, z)
  parent.add(object)
  return object
}

function box(material: THREE.Material, size = 0.2): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(size, size, size), material)
}

function puppet(): THREE.Group {
  const shell = look('mat_shell', 0.6)
  const trim = look('mat_trim', 0.4)
  const glow = look('mat_glow', 0.3, '#ff6a00')
  const decal = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), alphaTest: 0.5 })
  decal.name = 'mat_decal'
  const scene = new THREE.Group()
  const root = part(new THREE.Object3D(), 'root', scene)
  const body = part(box(shell, 0.6), 'body', root, 0, 0.5, 0)
  part(box(decal, 0.1), 'decal', body, 0.31, 0, 0)
  part(box(glow, 0.1), 'lamp', body, 0, 0.35, 0)
  const arm = part(box(trim, 0.15), 'arm', body, 0, 0.1, 0.4)
  arm.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.3)
  const hand = part(new THREE.Group(), 'hand', arm, 0, -0.3, 0)
  hand.scale.setScalar(0.8)
  part(box(shell, 0.12), 'glove', hand, 0.05, 0, 0)
  part(box(glow, 0.05), 'knuckle', hand, 0.1, 0, 0)
  part(new THREE.Object3D(), 'socket_hand', hand, 0.2, 0, 0)
  return scene
}

function worldPoints(root: THREE.Object3D): string[] {
  root.updateWorldMatrix(true, true)
  const rigid = new Set(rigidMeshes(root))
  const table = root.userData.rigid as RigidTable | undefined
  const values = table ? new Float32Array(table.names.length * 16) : null
  if (table && values) jointMatrices(table, root, nodeMap(root))(values)
  const points: string[] = []
  const joint = new THREE.Matrix4()
  const point = new THREE.Vector3()
  const visit = (object: THREE.Object3D) => {
    if (!object.visible) return
    const mesh = object as THREE.Mesh
    if (mesh.isMesh) {
      const position = mesh.geometry.getAttribute('position')
      const joints = mesh.geometry.getAttribute(JOINT_ATTRIBUTE)
      for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position, i)
        if (rigid.has(mesh) && values) {
          joint.fromArray(values, joints.getX(i) * 16)
          if (joint.elements.every((value) => value === 0)) continue
          point.applyMatrix4(joint)
        }
        point.applyMatrix4(mesh.matrixWorld)
        points.push(point.toArray().map((value) => value.toFixed(4)).join(','))
      }
    }
    for (const child of object.children) visit(child)
  }
  visit(root)
  return points.sort()
}

function pose(model: { root: THREE.Object3D }, joints: readonly string[], seed: number): void {
  const nodes = nodeMap(model.root)
  joints.forEach((name, index) => {
    const node = nodes.get(name)
    if (!node) return
    const angle = 0.35 + ((seed * 7 + index * 13) % 11) * 0.09
    const axis = new THREE.Vector3(Math.sin(index + seed), 1, Math.cos(index * 2 + seed)).normalize()
    node.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis, angle))
    node.position.x += 0.01 * (index % 3)
    if (index % 4 === 1) node.scale.multiplyScalar(1.15)
  })
}

function placed(model: { root: THREE.Object3D }): THREE.Group {
  const holder = new THREE.Group()
  holder.position.set(12.5, 0.2, 7.25)
  holder.rotation.set(0.1, 2.1, -0.05)
  holder.scale.set(1.2, 0.9, 1.2)
  holder.add(model.root)
  return holder
}

function renderer(frame: number): THREE.WebGLRenderer {
  return { info: { render: { frame } } } as unknown as THREE.WebGLRenderer
}

describe('rigid joints in the vertex shader', () => {
  it('patch the vertex stage of the standard, depth and basic programs', () => {
    for (const source of [THREE.ShaderLib.standard.vertexShader, THREE.ShaderLib.depth.vertexShader, THREE.ShaderLib.basic.vertexShader]) {
      const patched = rigidVertex(source)
      expect(patched).toContain(`uniform mat4 rigidJoints[ ${RIGID_PARTS.joints} ];`)
      expect(patched).toContain(`attribute float ${JOINT_ATTRIBUTE};`)
      expect(patched).toMatch(/#include <begin_vertex>\ntransformed = \( rigidJoints\[/)
      expect(patched).toMatch(/#include <beginnormal_vertex>\nobjectNormal = mat3\( rigidJoints\[/)
    }
  })

  it('hand the joint values to the program and keep the patch through clones', () => {
    const material = new RigidStandardMaterial({ map: atlas, roughness: 0.4 })
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader }
    material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms)
    expect((shader.uniforms as Record<string, unknown>).rigidJoints).toBe(material.rigidJoints)
    expect(shader.vertexShader).toContain(JOINT_ATTRIBUTE)
    expect(material.customProgramCacheKey()).toBe(RIGID_PROGRAM)
    const copy = material.clone()
    expect(copy).toBeInstanceOf(RigidStandardMaterial)
    expect(copy.customProgramCacheKey()).toBe(RIGID_PROGRAM)
    expect(copy.rigidJoints).not.toBe(material.rigidJoints)
    expect(copy.map).toBe(atlas)
    expect(copy.roughness).toBe(0.4)
    expect(new RigidDepthMaterial().clone()).toBeInstanceOf(RigidDepthMaterial)
  })
})

describe('folding the parts of a jointed model into rigid meshes', () => {
  it('puts each look that spans joints into one mesh under the root and keeps every joint node', () => {
    const scene = puppet()
    const merged = mergeRigid(scene, ['arm', 'hand'])
    const meshes = rigidMeshes(scene)
    expect(meshes).toHaveLength(2)
    expect(merged.added).toEqual(expect.arrayContaining(meshes))
    for (const mesh of meshes) {
      expect(mesh.parent).toBe(scene)
      expect(mesh.material).toBeInstanceOf(RigidStandardMaterial)
      expect(mesh.userData.still).toBe(true)
    }
    const [solid, glow] = meshes.sort((a, b) => Number((a.material as THREE.MeshStandardMaterial).emissive.getHex() !== 0) - Number((b.material as THREE.MeshStandardMaterial).emissive.getHex() !== 0))
    expect((solid.material as THREE.MeshStandardMaterial).roughnessMap?.channel).toBe(1)
    expect((glow.material as THREE.MeshStandardMaterial).emissive.getHexString()).toBe('ff6a00')
    const joints = solid.geometry.getAttribute(JOINT_ATTRIBUTE)
    const seen = new Set<number>()
    for (let i = 0; i < joints.count; i++) seen.add(joints.getX(i))
    expect([...seen].sort()).toEqual([0, 1, 2])
    expect(scene.userData.rigid.names).toEqual(['', 'arm', 'hand'])
    expect(scene.userData.rigid.rest).toHaveLength(48)
    const nodes = nodeMap(scene)
    const arm = nodes.get('arm')
    expect((arm as THREE.Mesh).isMesh).toBeUndefined()
    expect(arm?.position.z).toBeCloseTo(0.4)
    expect(arm?.children.map((child) => child.userData.name)).toEqual(['hand'])
    expect(nodes.get('hand')?.children.map((child) => child.userData.name)).toEqual(['socket_hand'])
    expect(nodes.has('glove')).toBe(false)
    expect(nodes.get('decal')?.parent).toBe(nodes.get('body'))
    const natural = new THREE.Sphere()
    new THREE.Box3().setFromBufferAttribute(solid.geometry.getAttribute('position') as THREE.BufferAttribute).getBoundingSphere(natural)
    expect(solid.geometry.boundingSphere?.radius).toBeGreaterThan(natural.radius)
  })

  it('moves every vertex with its own joint, follows the root and drops the parts of hidden joints', () => {
    const plain = puppet()
    const rigid = puppet()
    mergeRigid(rigid, ['arm', 'hand'])
    const before = worldPoints(plain)
    expect(worldPoints(rigid)).toEqual(before)
    for (const model of [{ root: plain }, { root: rigid }]) {
      pose(model, ['arm', 'hand'], 3)
      placed(model)
    }
    expect(worldPoints(rigid)).toEqual(worldPoints(plain))
    nodeMap(plain).get('hand')!.visible = false
    nodeMap(rigid).get('hand')!.visible = false
    expect(worldPoints(rigid)).toEqual(worldPoints(plain))
    expect(worldPoints(rigid).length).toBeLessThan(before.length)
  })

  it('merges joint by joint as before when a model has more joints than the program holds', () => {
    const scene = new THREE.Group()
    let parent: THREE.Object3D = scene
    const names: string[] = []
    for (let i = 0; i <= RIGID_PARTS.joints; i++) {
      const link = part(new THREE.Group(), `link_${i}`, parent, 0, 0.1, 0)
      part(box(look('mat_a', 0.5)), `a_${i}`, link)
      part(box(look('mat_b', 0.7)), `b_${i}`, link)
      names.push(`link_${i}`)
      parent = link
    }
    mergeRigid(scene, names)
    expect(scene.userData.rigid).toBeUndefined()
    expect(rigidMeshes(scene)).toEqual([])
    const still: THREE.Object3D[] = []
    scene.traverse((object) => {
      if (object.userData.still) still.push(object)
    })
    expect(still).toHaveLength(names.length)
  })
})

describe('binding the joints of each instance', () => {
  async function library() {
    return createModelLibrary(async () => puppet())
  }

  it('gives each instance its own joint values, shared with its shadow material and refreshed once a frame', async () => {
    const models = await library()
    await models.ensure(['grunt'])
    const first = models.instance('grunt', ['arm', 'hand'])
    const second = models.instance('grunt', ['arm', 'hand'])
    const meshes = rigidMeshes(first.root)
    expect(meshes).toHaveLength(2)
    const values = (meshes[0].material as RigidStandardMaterial).rigidJoints.value
    for (const mesh of meshes) {
      expect((mesh.material as RigidStandardMaterial).rigidJoints.value).toBe(values)
      expect(mesh.customDepthMaterial).toBeInstanceOf(RigidDepthMaterial)
      expect((mesh.customDepthMaterial as RigidDepthMaterial).rigidJoints.value).toBe(values)
    }
    expect((rigidMeshes(second.root)[0].material as RigidStandardMaterial).rigidJoints.value).not.toBe(values)
    expect(meshes[0].geometry).toBe(rigidMeshes(second.root)[0].geometry)
    const expected = new Float32Array(values.length)
    const fill = jointMatrices(first.root.userData.rigid as RigidTable, first.root, first.nodes)
    pose(first, ['arm', 'hand'], 5)
    first.root.updateWorldMatrix(true, true)
    meshes[0].onBeforeRender(renderer(1), new THREE.Scene(), new THREE.Camera(), meshes[0].geometry, meshes[0].material as THREE.Material, new THREE.Group())
    fill(expected)
    expect([...values]).toEqual([...expected])
    pose(first, ['arm'], 9)
    first.root.updateWorldMatrix(true, true)
    meshes[1].onBeforeShadow(renderer(1), new THREE.Scene(), new THREE.Camera(), new THREE.Camera(), meshes[1].geometry, meshes[1].material as THREE.Material, new THREE.Group())
    expect([...values]).toEqual([...expected])
    meshes[1].onBeforeShadow(renderer(2), new THREE.Scene(), new THREE.Camera(), new THREE.Camera(), meshes[1].geometry, meshes[1].material as THREE.Material, new THREE.Group())
    fill(expected)
    expect([...values]).toEqual([...expected])
    const disposed = vi.fn()
    const kept = vi.fn()
    meshes[0].customDepthMaterial?.addEventListener('dispose', disposed)
    rigidMeshes(second.root)[0].customDepthMaterial?.addEventListener('dispose', kept)
    first.dispose()
    expect(disposed).toHaveBeenCalled()
    expect(kept).not.toHaveBeenCalled()
  })

  it('leaves models without jointed meshes alone', async () => {
    const models = await library()
    await models.ensure(['grunt'])
    const model: ModelInstance = models.instance('grunt')
    expect(bindRigid(model)).toEqual([])
    expect(rigidMeshes(model.root)).toEqual([])
  })
})

describe('the real models', () => {
  const cases: [ModelId, readonly string[]][] = [
    ['kai', KAI_JOINTS],
    ['blaster', HELD_JOINTS.blaster],
    ['grenade', HELD_JOINTS.grenade],
    ['rocket', HELD_JOINTS.rocket],
    ...Object.entries(ENEMY_JOINTS).map(([kind, joints]) => [kind as ModelId, joints] as [ModelId, readonly string[]]),
  ]

  for (const [id, joints] of cases) {
    it(`${id}: the posed rigid build lands on the posed plain build`, async () => {
      const models = await glbLibrary([id])
      const plain = models.instance(id)
      const rigid = models.instance(id, joints)
      expect(rigidMeshes(rigid.root).length).toBeGreaterThan(0)
      expect((rigid.root.userData.rigid as RigidTable).names.length).toBeLessThanOrEqual(RIGID_PARTS.joints)
      for (const name of joints) expect(rigid.nodes.has(name), name).toBe(true)
      for (const name of plain.nodes.keys()) if (name.startsWith('socket_')) expect(rigid.nodes.has(name), name).toBe(true)
      for (const model of [plain, rigid]) {
        pose(model, joints, id.length)
        placed(model)
      }
      expect(worldPoints(rigid.root)).toEqual(worldPoints(plain.root))
      const hidden = joints[joints.length - 1]
      plain.nodes.get(hidden)!.visible = false
      rigid.nodes.get(hidden)!.visible = false
      expect(worldPoints(rigid.root)).toEqual(worldPoints(plain.root))
    })
  }
})
