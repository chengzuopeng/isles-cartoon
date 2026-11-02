import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createUploadPacer, textureBytes, type SyncContext, type UploadPacer } from './upload-pacing'

interface FakeFence {
  id: number
  signaled: boolean
  deleted: boolean
}

function fakeContext(): { gl: SyncContext; fences: FakeFence[]; calls: string[] } {
  const fences: FakeFence[] = []
  const calls: string[] = []
  const gl: SyncContext = {
    SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
    SYNC_STATUS: 0x9114,
    SIGNALED: 0x9119,
    fenceSync() {
      const fence = { id: fences.length, signaled: false, deleted: false }
      fences.push(fence)
      calls.push(`fence ${fence.id}`)
      return fence as unknown as WebGLSync
    },
    getSyncParameter(sync, pname) {
      expect(pname).toBe(0x9114)
      return (sync as unknown as FakeFence).signaled ? 0x9119 : 0x9118
    },
    deleteSync(sync) {
      const fence = sync as unknown as FakeFence
      fence.deleted = true
      calls.push(`delete ${fence.id}`)
    },
    flush() {
      calls.push('flush')
    },
  }
  return { gl, fences, calls }
}

function pacerWithClock(): { pacer: UploadPacer; fences: FakeFence[]; calls: string[]; clock: { now: number } } {
  const { gl, fences, calls } = fakeContext()
  const clock = { now: 0 }
  const pacer = createUploadPacer(() => gl, { batchBytes: 1000, idleMs: 100 }, () => clock.now)
  pacer.drew()
  return { pacer, fences, calls, clock }
}

function compressed(...sizes: number[]): THREE.CompressedTexture {
  const levels = sizes.map((size, level) => ({ data: new Uint8Array(size), width: 64 >> level, height: 64 >> level }))
  return new THREE.CompressedTexture(levels, 64, 64, THREE.RGBA_ASTC_4x4_Format)
}

describe('textureBytes', () => {
  it('counts the mip levels a compressed texture still holds and nothing once they are released', () => {
    const texture = compressed(4096, 1024, 256)
    expect(textureBytes(texture)).toBe(5376)
    const copy = texture.clone()
    expect(textureBytes(copy)).toBe(5376)
    texture.source.dataReady = false
    expect(textureBytes(texture)).toBe(0)
    expect(textureBytes(copy)).toBe(0)
  })

  it('counts nothing for textures without mip data of their own', () => {
    expect(textureBytes(new THREE.Texture())).toBe(0)
    expect(textureBytes(new THREE.DataTexture(new Uint8Array(16), 2, 2))).toBe(0)
  })
})

describe('createUploadPacer', () => {
  it('lets uploads through until a batch is sent, then waits for the GPU to take it', () => {
    const { pacer, fences, calls } = pacerWithClock()
    pacer.sent(400)
    pacer.sent(0)
    pacer.sent(599)
    expect(pacer.busy()).toBe(false)
    expect(calls).toEqual([])
    pacer.sent(1)
    expect(calls).toEqual(['fence 0', 'flush'])
    expect(pacer.busy()).toBe(true)
    expect(pacer.busy()).toBe(true)
    fences[0].signaled = true
    expect(pacer.busy()).toBe(false)
    expect(fences[0].deleted).toBe(true)
    expect(pacer.busy()).toBe(false)
    pacer.sent(999)
    expect(fences).toHaveLength(1)
  })

  it('waits for the newest batch when more is sent before the GPU caught up', () => {
    const { pacer, fences, calls } = pacerWithClock()
    pacer.sent(1500)
    pacer.sent(1000)
    expect(calls).toEqual(['fence 0', 'flush', 'delete 0', 'fence 1', 'flush'])
    fences[0].signaled = true
    expect(pacer.busy()).toBe(true)
    fences[1].signaled = true
    expect(pacer.busy()).toBe(false)
  })

  it('does not hold uploads back while nothing is being drawn, and does again once drawing resumes', () => {
    const { pacer, fences, clock } = pacerWithClock()
    pacer.sent(1000)
    clock.now = 99
    expect(pacer.busy()).toBe(true)
    clock.now = 100
    expect(pacer.busy()).toBe(false)
    expect(fences[0].deleted).toBe(false)
    clock.now = 150
    pacer.drew()
    expect(pacer.busy()).toBe(true)
    fences[0].signaled = true
    expect(pacer.busy()).toBe(false)
  })

  it('forgets the fence and the count when the context is lost', () => {
    const { pacer, fences } = pacerWithClock()
    pacer.sent(1000)
    expect(pacer.busy()).toBe(true)
    pacer.reset()
    expect(pacer.busy()).toBe(false)
    pacer.sent(999)
    expect(fences).toHaveLength(1)
  })
})
