import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { LEVEL_1_4 } from '../data/levels/level-1-4'
import { TRAINING } from '../data/levels/training'
import { createDefaultTuning } from '../data/tuning'
import { fogHides } from '../sim/fog'
import { blocksMovement, tileAt } from '../sim/grid'
import { buildLevel } from '../sim/level'
import type { MinionKind } from '../sim/types'
import { createEnemy, createWorld, type World } from '../sim/world'
import { blobMask, blobMatrix, blobTone, createBlobShadows, shadowHeading } from './blob-shadows'
import { createEffects } from './effects'
import { createEntityViews } from './entity-views'
import type { Stage } from './stage'
import { glbLibrary, stubImages } from './testing'
import { BLOB_SHADOW, FOG_VEIL } from './themes'

const KINDS: readonly MinionKind[] = ['grunt', 'gunner', 'bomber', 'turret', 'shield', 'thrower']
const models = await glbLibrary([...KINDS, 'elite-crown', 'legion-bomb'])

function blobsIn(scene: THREE.Object3D): THREE.InstancedMesh {
  const found = scene.children.find((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh && child.renderOrder === BLOB_SHADOW.order)
  if (!found) throw new Error('no blob shadows')
  return found
}

function casters(scene: THREE.Object3D): number {
  let count = 0
  scene.traverse((object) => {
    if ((object as THREE.Mesh).isMesh && object.castShadow) count++
  })
  return count
}

function viewsFor(world: World) {
  const scene = new THREE.Scene()
  const stage = { scene, addTrauma: () => {} } as unknown as Stage
  const views = createEntityViews(stage, world.tuning, createEffects(scene), { showSight: false }, models)
  return { scene, views }
}

describe('blob shadow placement', () => {
  it('points the way the sun throws shadows', () => {
    const heading = shadowHeading(new THREE.Vector3(-7, 22, 8))
    expect(heading.x).toBeCloseTo(7 / Math.hypot(7, 8))
    expect(heading.z).toBeCloseTo(-8 / Math.hypot(7, 8))
  })

  it('lays a flat ellipse just above the ground, nudged and stretched along the shadow', () => {
    const heading = { x: 0.6, z: -0.8 }
    const look = { darkness: 0.3, size: 1.2, stretch: 1.5, offset: 0.25, height: 0.02 }
    const matrix = blobMatrix(4, 6, 0.4, new THREE.Matrix4(), look, heading)
    const position = new THREE.Vector3()
    const turn = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    matrix.decompose(position, turn, scale)
    expect(position.y).toBeCloseTo(0.02)
    expect(position.x).toBeCloseTo(4 + 0.6 * 0.4 * 0.25 * 2)
    expect(position.z).toBeCloseTo(6 - 0.8 * 0.4 * 0.25 * 2)
    expect(scale.x).toBeCloseTo(0.4 * 2 * 1.2 * 1.5)
    expect(scale.z).toBeCloseTo(0.4 * 2 * 1.2)
    const along = new THREE.Vector3(1, 0, 0).applyQuaternion(turn)
    expect(along.x).toBeCloseTo(0.6)
    expect(along.z).toBeCloseTo(-0.8)
  })

  it('darkens by the configured amount at full strength and not at all when faded out', () => {
    const tone = new THREE.Color()
    expect(blobTone(1, tone).getStyle(THREE.SRGBColorSpace)).toBe(new THREE.Color().setRGB(BLOB_SHADOW.darkness, BLOB_SHADOW.darkness, BLOB_SHADOW.darkness, THREE.SRGBColorSpace).getStyle(THREE.SRGBColorSpace))
    expect(blobTone(0, tone).r).toBe(0)
    expect(blobTone(2, tone).r).toBeCloseTo(blobTone(1, new THREE.Color()).r)
  })

  it('keeps a solid core and fades smoothly to nothing at the rim', () => {
    expect(blobMask(0)).toBe(1)
    expect(blobMask(BLOB_SHADOW.inner)).toBe(1)
    expect(blobMask(1)).toBe(0)
    let last = 1
    for (let d = BLOB_SHADOW.inner; d <= 1; d += 0.05) {
      expect(blobMask(d)).toBeLessThanOrEqual(last + 1e-9)
      last = blobMask(d)
    }
  })

  it('draws every blob with one instanced mesh that grows when it runs out of room', () => {
    const scene = new THREE.Group()
    const blobs = createBlobShadows(scene, 2)
    const first = blobs.mesh
    expect(first.instanceColor).not.toBeNull()
    expect(first.castShadow).toBe(false)
    blobs.begin()
    blobs.add(1, 1, 0.4, 1)
    blobs.add(2, 1, 0.4, 0)
    blobs.add(3, 1, 0.4, 0.5)
    blobs.add(4, 1, 0.4, 1)
    blobs.end()
    expect(blobs.mesh).not.toBe(first)
    expect(first.parent).toBeNull()
    expect(blobs.mesh.parent).toBe(scene)
    expect(blobs.mesh.count).toBe(3)
    const at = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(blobs.mesh.instanceMatrix.array, 16))
    expect(at.x).toBeGreaterThan(3)
    blobs.begin()
    blobs.end()
    expect(blobs.mesh.visible).toBe(false)
    blobs.dispose()
    expect(scene.children).toHaveLength(0)
  })
})

describe('minion shadows', () => {
  it('let minions with models cast real shadows where there is no fog, with no blob under them', () => {
    const restore = stubImages()
    try {
      const tuning = createDefaultTuning()
      const world = createWorld(buildLevel(TRAINING), tuning, { seed: 1 })
      world.enemies.length = 0
      const { scene, views } = viewsFor(world)
      views.sync(world, 1, 1 / 60)
      const before = casters(scene)
      KINDS.forEach((kind, index) => {
        world.enemies.push(createEnemy(world, kind, { x: world.player.pos.x + index - 2.5, y: world.player.pos.y - 2 }, 0, { affixes: index === 0 ? ['tough'] : [] }))
      })
      views.sync(world, 1, 1 / 60)
      const standing = casters(scene)
      expect(standing).toBeGreaterThan(before)
      expect(blobsIn(scene).count).toBe(0)
      world.enemies[1].hp = 0
      views.sync(world, 1, 1 / 60)
      expect(casters(scene)).toBeLessThan(standing)
      views.reset()
      expect(casters(scene)).toBe(before)
      expect(blobsIn(scene).visible).toBe(false)
    } finally {
      restore()
    }
  })

  it('fades the blob out with a minion that the fog hides', () => {
    const restore = stubImages()
    try {
      const tuning = createDefaultTuning()
      const world = createWorld(buildLevel(LEVEL_1_4), tuning, { seed: 1 })
      world.enemies.length = 0
      let hidden: { x: number; y: number } | null = null
      for (let row = 0; row < world.grid.rows && !hidden; row++) {
        for (let column = 0; column < world.grid.columns && !hidden; column++) {
          if (!blocksMovement(tileAt(world.grid, column, row)) && fogHides(world, column + 0.5, row + 0.5)) hidden = { x: column + 0.5, y: row + 0.5 }
        }
      }
      if (!hidden) throw new Error('no fogged spot')
      world.enemies.push(createEnemy(world, 'grunt', hidden, 0))
      world.enemies.push(createEnemy(world, 'grunt', { ...world.player.pos }, 0))
      const { scene, views } = viewsFor(world)
      views.sync(world, 1, 1 / 60)
      expect(blobsIn(scene).count).toBe(1)
      world.enemies[0].pos = { ...world.player.pos }
      world.enemies[0].prev = { ...world.player.pos }
      views.sync(world, 1, FOG_VEIL.seconds / 2)
      const tone = new THREE.Color()
      blobsIn(scene).getColorAt(1, tone)
      expect(blobsIn(scene).count).toBe(2)
      expect(tone.r).toBeGreaterThan(0)
      expect(tone.r).toBeLessThan(blobTone(1, new THREE.Color()).r)
    } finally {
      restore()
    }
  })
})
