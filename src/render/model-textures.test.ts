import { describe, expect, it } from 'vitest'
import { MODEL_IDS } from './asset-urls'

interface FileSystem {
  readFileSync(path: URL): Uint8Array
  readFileSync(path: URL, encoding: 'utf8'): string
}

interface TextureSlot {
  index: number
}

interface Gltf {
  extensionsUsed?: string[]
  extensionsRequired?: string[]
  images?: { bufferView?: number; mimeType?: string; name?: string }[]
  textures?: { source?: number; sampler?: number; extensions?: { KHR_texture_basisu?: { source: number } } }[]
  bufferViews: { byteOffset?: number; byteLength: number }[]
  materials?: Record<string, unknown>[]
}

interface Ktx2 {
  vkFormat: number
  width: number
  height: number
  levels: number
  supercompression: number
  colorModel: number
  transfer: number
}

const FS_MODULE = 'node:fs'
const fs = (await import(/* @vite-ignore */ FS_MODULE)) as FileSystem
const ROOT = new URL('../../', import.meta.url)
const BASISU = 'KHR_texture_basisu'
const KTX2_ID = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]
const VK_FORMAT_UNDEFINED = 0
const ZSTANDARD = 2
const UASTC_MODEL = 166
const TRANSFER_LINEAR = 1
const TRANSFER_SRGB = 2
const COLOR_SLOTS = new Set(['baseColorTexture', 'emissiveTexture', 'sheenColorTexture', 'specularColorTexture'])
const BLOCK = 4

function textureMax(): number {
  const script = fs.readFileSync(new URL('scripts/build-assets.sh', ROOT), 'utf8')
  const match = /MODEL_TEXTURE_MAX:-(\d+)/.exec(script)
  expect(match).not.toBeNull()
  return Number(match?.[1])
}

function readGlb(id: string): { gltf: Gltf; bin: Uint8Array } {
  const bytes = fs.readFileSync(new URL(`public/assets/models/${id}.glb`, ROOT))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const jsonLength = view.getUint32(12, true)
  const gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as Gltf
  const binAt = 20 + jsonLength
  const bin = bytes.subarray(binAt + 8, binAt + 8 + view.getUint32(binAt, true))
  return { gltf, bin }
}

function readKtx2(bytes: Uint8Array): Ktx2 {
  expect([...bytes.subarray(0, KTX2_ID.length)]).toEqual(KTX2_ID)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const dfd = view.getUint32(48, true)
  return {
    vkFormat: view.getUint32(12, true),
    width: view.getUint32(20, true),
    height: view.getUint32(24, true),
    levels: view.getUint32(40, true),
    supercompression: view.getUint32(44, true),
    colorModel: view.getUint8(dfd + 12),
    transfer: view.getUint8(dfd + 14),
  }
}

function colorImages(gltf: Gltf): Set<number> {
  const found = new Set<number>()
  const visit = (value: unknown, key?: string) => {
    if (!value || typeof value !== 'object') return
    const slot = value as TextureSlot
    if (key && COLOR_SLOTS.has(key) && Number.isInteger(slot.index)) {
      const texture = gltf.textures?.[slot.index]
      const image = texture?.extensions?.[BASISU]?.source
      if (image !== undefined) found.add(image)
    }
    for (const [childKey, child] of Object.entries(value)) visit(child, childKey)
  }
  for (const material of gltf.materials ?? []) visit(material)
  return found
}

describe('runtime model textures', () => {
  const max = textureMax()

  it.each([...MODEL_IDS])('%s embeds its textures as UASTC KTX2 with a full mip chain', (id) => {
    const { gltf, bin } = readGlb(id)
    const images = gltf.images ?? []
    if (images.length === 0) return
    expect(gltf.extensionsUsed).toContain(BASISU)
    expect(gltf.extensionsRequired).toContain(BASISU)
    for (const texture of gltf.textures ?? []) {
      expect(texture.source).toBeUndefined()
      expect(texture.extensions?.[BASISU]?.source).toBeTypeOf('number')
    }
    const color = colorImages(gltf)
    images.forEach((image, index) => {
      expect(image.mimeType).toBe('image/ktx2')
      expect(image.bufferView).toBeTypeOf('number')
      const view = gltf.bufferViews[image.bufferView ?? 0]
      const start = view.byteOffset ?? 0
      const ktx2 = readKtx2(bin.subarray(start, start + view.byteLength))
      const name = `${id} ${image.name ?? index}`
      expect(ktx2.vkFormat, name).toBe(VK_FORMAT_UNDEFINED)
      expect(ktx2.colorModel, name).toBe(UASTC_MODEL)
      expect(ktx2.supercompression, name).toBe(ZSTANDARD)
      expect(Math.max(ktx2.width, ktx2.height), name).toBeLessThanOrEqual(max)
      expect(ktx2.width % BLOCK, name).toBe(0)
      expect(ktx2.height % BLOCK, name).toBe(0)
      expect(ktx2.levels, name).toBe(Math.floor(Math.log2(Math.max(ktx2.width, ktx2.height))) + 1)
      expect(ktx2.transfer, name).toBe(color.has(index) ? TRANSFER_SRGB : TRANSFER_LINEAR)
    })
  })
})
