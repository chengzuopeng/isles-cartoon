import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelId } from './asset-urls'
import { createTextureKeeper, embeddedBasisu, glbImages, spawnTranscoders, whileBusy, type KeeperOptions } from './gltf-source'

interface FileSystem {
  readFileSync(path: URL): Uint8Array
}

interface GltfJson {
  images: { bufferView: number; name?: string }[]
  textures: { sampler?: number; extensions: { KHR_texture_basisu: { source: number } } }[]
  samplers?: Record<string, number>[]
  materials: { name?: string; pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }[]
  bufferViews: { byteOffset?: number; byteLength: number }[]
}

const FS_MODULE = 'node:fs'
const fs = (await import(/* @vite-ignore */ FS_MODULE)) as FileSystem
const ROOT = new URL('../../', import.meta.url)
const KTX2_ID = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]
const CLAMP = 33071
const REPEAT = 10497
const IDLE_MS = 2000

function glbFile(id: string): ArrayBuffer {
  const bytes = fs.readFileSync(new URL(`public/assets/models/${id}.glb`, ROOT))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function readGlb(id: string): { json: GltfJson; bin: Uint8Array } {
  const bytes = new Uint8Array(glbFile(id))
  const view = new DataView(bytes.buffer)
  const jsonLength = view.getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as GltfJson
  const binAt = 20 + jsonLength
  return { json, bin: bytes.slice(binAt + 8, binAt + 8 + view.getUint32(binAt, true)) }
}

function imageBytes(json: GltfJson, bin: Uint8Array, image: number): Uint8Array {
  const view = json.bufferViews[json.images[image].bufferView]
  return bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)
}

function writeGlb(json: GltfJson, bin: Uint8Array): ArrayBuffer {
  const text = new TextEncoder().encode(JSON.stringify(json))
  const jsonLength = Math.ceil(text.length / 4) * 4
  const binLength = Math.ceil(bin.length / 4) * 4
  const bytes = new Uint8Array(12 + 8 + jsonLength + 8 + binLength)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, bytes.length, true)
  view.setUint32(12, jsonLength, true)
  view.setUint32(16, 0x4e4f534a, true)
  bytes.fill(0x20, 20, 20 + jsonLength)
  bytes.set(text, 20)
  view.setUint32(20 + jsonLength, binLength, true)
  view.setUint32(24 + jsonLength, 0x004e4942, true)
  bytes.set(bin, 28 + jsonLength)
  return bytes.buffer
}

function transcoded(fill = 1, size = 16): THREE.CompressedTexture {
  const mipmaps = []
  for (let side = size; side >= 1; side = Math.floor(side / 2)) {
    const blocks = Math.ceil(side / 4) * Math.ceil(side / 4)
    mipmaps.push({ data: new Uint8Array(blocks * 16).fill(fill), width: side, height: side })
  }
  const texture = new THREE.CompressedTexture(mipmaps, size, size, THREE.RGBA_ASTC_4x4_Format)
  texture.needsUpdate = true
  return texture
}

function fakeTranscoder(parsed: Uint8Array[]): KTX2Loader {
  return {
    parse(buffer: ArrayBuffer, onLoad?: (texture: THREE.CompressedTexture) => void) {
      parsed.push(new Uint8Array(buffer.slice(0)))
      onLoad?.(transcoded())
    },
  } as unknown as KTX2Loader
}

function uploaded(texture: THREE.Texture): void {
  texture.onUpdate?.(texture)
}

function bytesOf(texture: THREE.Texture): number {
  return (texture.mipmaps as THREE.CompressedTextureMipmap[]).reduce((sum, level) => sum + level.data.byteLength, 0)
}

function keeperWith(overrides: Partial<KeeperOptions> = {}) {
  const options: KeeperOptions = {
    read: vi.fn(async () => {
      throw new Error('no reads expected')
    }),
    transcode: vi.fn(async () => transcoded(9)),
    upload: vi.fn(uploaded),
    ...overrides,
  }
  return { keeper: createTextureKeeper(options), options }
}

function maps(scene: THREE.Object3D): Map<string, THREE.Texture> {
  const found = new Map<string, THREE.Texture>()
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    for (const material of [mesh.material].flat() as THREE.MeshStandardMaterial[]) {
      if (material.map) found.set(material.name, material.map)
    }
  })
  return found
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('embeddedBasisu', () => {
  it('hands each embedded KTX2 image to the transcoder once, straight from the GLB, and configures it like GLTFLoader', async () => {
    const { json, bin } = readGlb('kai')
    const parsed: Uint8Array[] = []
    const tracked: [number, THREE.Texture][] = []
    const gltf = await new GLTFLoader()
      .register(embeddedBasisu(fakeTranscoder(parsed), (image, texture) => tracked.push([image, texture])))
      .parseAsync(writeGlb(json, bin), '')
    expect(parsed).toHaveLength(json.images.length)
    const expected = json.images.map((_, image) => imageBytes(json, bin, image))
    for (const bytes of parsed) {
      expect([...bytes.subarray(0, KTX2_ID.length)]).toEqual(KTX2_ID)
      expect(expected.some((image) => image.length === bytes.length && image.every((value, index) => value === bytes[index]))).toBe(true)
    }
    const textures = maps(gltf.scene)
    expect(textures.size).toBeGreaterThan(json.images.length)
    expect(new Set(textures.values()).size).toBe(json.images.length)
    for (const texture of textures.values()) {
      expect(texture).toBeInstanceOf(THREE.CompressedTexture)
      expect(texture.flipY).toBe(false)
      expect(texture.generateMipmaps).toBe(false)
      expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter)
      expect(texture.magFilter).toBe(THREE.LinearFilter)
      expect(texture.colorSpace).toBe(THREE.SRGBColorSpace)
      expect(json.images.map((image) => image.name)).toContain(texture.name)
    }
    expect(new Set(tracked.map(([, texture]) => texture))).toEqual(new Set(textures.values()))
    for (const [image, texture] of tracked) expect(texture.name).toBe(json.images[image].name)
  })

  it('gives an image used with a second sampler its own copy with that sampler', async () => {
    const { json, bin } = readGlb('crate')
    const material = json.materials.findIndex((entry) => entry.pbrMetallicRoughness?.baseColorTexture)
    const slot = json.materials[material].pbrMetallicRoughness?.baseColorTexture
    const original = json.textures[slot?.index ?? 0]
    json.samplers = [...(json.samplers ?? []), { magFilter: 9729, minFilter: 9987, wrapS: CLAMP, wrapT: CLAMP }]
    json.textures.push({ sampler: json.samplers.length - 1, extensions: { KHR_texture_basisu: { source: original.extensions.KHR_texture_basisu.source } } })
    json.materials.push({ ...json.materials[material], name: 'clamped', pbrMetallicRoughness: { baseColorTexture: { index: json.textures.length - 1 } } })
    const parsed: Uint8Array[] = []
    const tracked: THREE.Texture[] = []
    const parser = (await new GLTFLoader().register(embeddedBasisu(fakeTranscoder(parsed), (_, texture) => tracked.push(texture))).parseAsync(writeGlb(json, bin), '')).parser
    const repeated = (await parser.getDependency('texture', slot?.index ?? 0)) as THREE.Texture
    const clamped = (await parser.getDependency('texture', json.textures.length - 1)) as THREE.Texture
    expect(parsed).toHaveLength(json.images.length)
    expect(clamped).not.toBe(repeated)
    expect(clamped.source).toBe(repeated.source)
    expect(repeated.wrapS).toBe(THREE.RepeatWrapping)
    expect(clamped.wrapS).toBe(THREE.ClampToEdgeWrapping)
    expect(clamped.wrapT).toBe(THREE.ClampToEdgeWrapping)
    expect(tracked).toContain(repeated)
    expect(tracked).toContain(clamped)
  })

  it('keeps one texture for samplers that come out with the same settings', async () => {
    const { json, bin } = readGlb('crate')
    const slot = json.materials.find((entry) => entry.pbrMetallicRoughness?.baseColorTexture)?.pbrMetallicRoughness?.baseColorTexture
    const original = json.textures[slot?.index ?? 0]
    json.samplers = [...(json.samplers ?? []), { magFilter: 9729, minFilter: 9987, wrapS: REPEAT, wrapT: REPEAT }]
    json.textures.push({ sampler: json.samplers.length - 1, extensions: { KHR_texture_basisu: { source: original.extensions.KHR_texture_basisu.source } } })
    const parser = (await new GLTFLoader().register(embeddedBasisu(fakeTranscoder([]))).parseAsync(writeGlb(json, bin), '')).parser
    const first = (await parser.getDependency('texture', slot?.index ?? 0)) as THREE.Texture
    const second = (await parser.getDependency('texture', json.textures.length - 1)) as THREE.Texture
    expect(second).toBe(first)
  })
})

describe('createTextureKeeper', () => {
  it('keeps the transcoded levels until every texture made from the image is on the GPU, then lets them go', () => {
    const { keeper } = keeperWith()
    const shared = transcoded()
    const clamped = shared.clone()
    clamped.wrapS = THREE.ClampToEdgeWrapping
    keeper.track('crate', 0, shared)
    keeper.track('crate', 0, clamped)
    const sizes = shared.mipmaps.map((level) => [level.width, level.height])
    expect(keeper.holding()).toBe(1)
    uploaded(shared)
    expect(bytesOf(shared)).toBeGreaterThan(0)
    expect(shared.source.dataReady).toBe(true)
    uploaded(clamped)
    expect(bytesOf(shared)).toBe(0)
    expect(bytesOf(clamped)).toBe(0)
    expect(shared.source.dataReady).toBe(false)
    expect(keeper.holding()).toBe(0)
    expect(shared.mipmaps.map((level) => [level.width, level.height])).toEqual(sizes)
    expect(clamped.mipmaps).toHaveLength(sizes.length)
  })

  it('lets go once the only texture still waiting is disposed', () => {
    const { keeper } = keeperWith()
    const shared = transcoded()
    const clamped = shared.clone()
    keeper.track('crate', 0, shared)
    keeper.track('crate', 0, clamped)
    uploaded(shared)
    clamped.dispose()
    expect(bytesOf(shared)).toBe(0)
    expect(keeper.holding()).toBe(0)
  })

  it('reports a texture that gets uploaded again after its data was let go', () => {
    const { keeper } = keeperWith()
    const texture = transcoded()
    keeper.track('crate', 0, texture)
    uploaded(texture)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    uploaded(texture)
    expect(error).toHaveBeenCalledTimes(1)
    texture.dispose()
    uploaded(texture)
    expect(error).toHaveBeenCalledTimes(2)
  })

  it('brings released textures back from a fresh copy of the GLB, uploads them and lets them go again', async () => {
    const { json, bin } = readGlb('crate')
    const reads: ModelId[] = []
    const handed: Uint8Array[] = []
    const { keeper, options } = keeperWith({
      read: async (id) => {
        reads.push(id)
        return glbFile(id)
      },
      transcode: async (buffer) => {
        handed.push(new Uint8Array(buffer))
        return transcoded(7)
      },
    })
    const images = json.images.map(() => transcoded(3))
    images.forEach((texture, image) => keeper.track('crate', image, texture))
    const waiting = transcoded(5)
    keeper.track('sheep', 0, waiting)
    for (const texture of images) uploaded(texture)
    const versions = images.map((texture) => texture.version)
    expect(images.every((texture) => bytesOf(texture) === 0)).toBe(true)
    let restored = 0
    vi.mocked(options.upload).mockImplementation((texture) => {
      restored += 1
      expect(texture.source.dataReady).toBe(true)
      expect((texture.mipmaps as THREE.CompressedTextureMipmap[]).every((level) => level.data.every((value) => value === 7))).toBe(true)
      uploaded(texture)
    })
    await keeper.restore()
    expect(reads).toEqual(['crate'])
    expect(handed).toHaveLength(json.images.length)
    for (const bytes of handed) {
      expect([...bytes.subarray(0, KTX2_ID.length)]).toEqual(KTX2_ID)
      expect(json.images.some((_, image) => imageBytes(json, bin, image).every((value, index) => value === bytes[index]))).toBe(true)
    }
    expect(restored).toBe(images.length)
    images.forEach((texture, image) => {
      expect(texture.version).toBeGreaterThan(versions[image])
      expect(bytesOf(texture)).toBe(0)
      expect(texture.source.dataReady).toBe(false)
    })
    expect(bytesOf(waiting)).toBeGreaterThan(0)
    expect(keeper.holding()).toBe(1)
  })

  it('leaves disposed textures alone when restoring', async () => {
    const { keeper, options } = keeperWith()
    const texture = transcoded()
    keeper.track('crate', 0, texture)
    uploaded(texture)
    texture.dispose()
    await keeper.restore()
    expect(options.read).not.toHaveBeenCalled()
    expect(options.upload).not.toHaveBeenCalled()
  })
})

describe('glbImages', () => {
  it('copies out the bytes of each embedded image', () => {
    const { json, bin } = readGlb('kai')
    const file = glbFile('kai')
    const image = glbImages(file)
    json.images.forEach((_, index) => {
      const copied = image(index)
      const bytes = new Uint8Array(copied)
      const expected = imageBytes(json, bin, index)
      expect(copied).not.toBe(file)
      expect(bytes.length).toBe(expected.length)
      expect(bytes.every((value, at) => value === expected[at])).toBe(true)
    })
  })
})

describe('whileBusy', () => {
  it('passes results through, wakes when work starts and reports idle once work has stopped for the whole delay', async () => {
    vi.useFakeTimers()
    let idle = 0
    let woken = 0
    const busy = whileBusy(
      () => {
        idle += 1
      },
      IDLE_MS,
      () => {
        woken += 1
      },
    )
    const first = deferred<string>()
    const second = deferred<string>()
    const a = busy(() => first.promise)
    const b = busy(() => second.promise)
    expect(woken).toBe(1)
    first.resolve('kai')
    expect(await a).toBe('kai')
    second.resolve('crate')
    await b
    vi.advanceTimersByTime(IDLE_MS - 1)
    expect(idle).toBe(0)
    const third = deferred<string>()
    const c = busy(() => third.promise)
    expect(woken).toBe(2)
    vi.advanceTimersByTime(IDLE_MS)
    expect(idle).toBe(0)
    third.resolve('sheep')
    await c
    vi.advanceTimersByTime(IDLE_MS)
    expect(idle).toBe(1)
  })

  it('counts a failed task as finished and still rejects it', async () => {
    vi.useFakeTimers()
    let idle = 0
    const busy = whileBusy(() => {
      idle += 1
    }, IDLE_MS)
    await expect(
      busy(async () => {
        throw new Error('missing')
      }),
    ).rejects.toThrow('missing')
    vi.advanceTimersByTime(IDLE_MS)
    expect(idle).toBe(1)
  })
})

describe('spawnTranscoders', () => {
  it('starts every transcoder worker as soon as the transcoder has loaded', async () => {
    const ready = deferred<void>()
    const started: number[] = []
    const loader = { init: () => ready.promise, workerPool: { pool: 4, _initWorker: (id: number) => started.push(id) } } as unknown as KTX2Loader
    spawnTranscoders(loader)
    expect(started).toEqual([])
    ready.resolve()
    await ready.promise
    await Promise.resolve()
    expect(started).toEqual([0, 1, 2, 3])
  })
})
