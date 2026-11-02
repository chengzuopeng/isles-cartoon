import * as THREE from 'three'
import { GLTFLoader, type GLTFLoaderPlugin, type GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { assetUrl, type ModelId } from './asset-urls'
import type { ModelSource } from './model-library'
import type { Stage } from './stage'
import { TEXTURE_TRANSCODER } from './themes'

interface GltfSampler {
  magFilter?: number
  minFilter?: number
  wrapS?: number
  wrapT?: number
}

interface GltfTexture {
  name?: string
  sampler?: number
  extensions?: { KHR_texture_basisu?: { source: number } }
}

interface GltfJson {
  textures: GltfTexture[]
  images: { name?: string; bufferView?: number }[]
  samplers?: GltfSampler[]
  bufferViews: { byteOffset?: number; byteLength: number }[]
}

interface Sampler {
  magFilter: THREE.MagnificationTextureFilter
  minFilter: THREE.MinificationTextureFilter
  wrapS: THREE.Wrapping
  wrapT: THREE.Wrapping
}

interface Held {
  model: ModelId
  image: number
  name: string
  source: THREE.Texture['source']
  levels: THREE.CompressedTextureMipmap[]
  textures: Set<THREE.Texture>
  waiting: Set<THREE.Texture>
  released: boolean
  restoring: boolean
}

export type Track = (image: number, texture: THREE.Texture) => void
export type Busy = <T>(task: () => Promise<T>) => Promise<T>

export interface KeeperOptions {
  read(model: ModelId): Promise<ArrayBuffer>
  transcode(buffer: ArrayBuffer): Promise<THREE.CompressedTexture>
  upload(texture: THREE.Texture): void
}

export interface TextureKeeper {
  track(model: ModelId, image: number, texture: THREE.Texture): void
  restore(): Promise<void>
  holding(): number
}

const BASISU = 'KHR_texture_basisu'
const GLB_MAGIC = 0x46546c67
const EMPTY = new Uint8Array(0)
const MAG_FILTERS: Readonly<Record<number, THREE.MagnificationTextureFilter>> = {
  9728: THREE.NearestFilter,
  9729: THREE.LinearFilter,
}
const MIN_FILTERS: Readonly<Record<number, THREE.MinificationTextureFilter>> = {
  9728: THREE.NearestFilter,
  9729: THREE.LinearFilter,
  9984: THREE.NearestMipmapNearestFilter,
  9985: THREE.LinearMipmapNearestFilter,
  9986: THREE.NearestMipmapLinearFilter,
  9987: THREE.LinearMipmapLinearFilter,
}
const WRAPS: Readonly<Record<number, THREE.Wrapping>> = {
  33071: THREE.ClampToEdgeWrapping,
  33648: THREE.MirroredRepeatWrapping,
  10497: THREE.RepeatWrapping,
}

export function gltfSource(stage: Pick<Stage, 'detectTextureSupport' | 'preload' | 'onRestore'>): ModelSource {
  const textures = new KTX2Loader().setTranscoderPath(assetUrl.basis())
  stage.detectTextureSupport(textures)
  const busy = whileBusy(() => textures.workerPool.dispose(), TEXTURE_TRANSCODER.idleMs, () => spawnTranscoders(textures))
  const keeper = createTextureKeeper({
    read: (id) => busy(() => fetchBytes(assetUrl.model(id))),
    transcode: (buffer) => busy(() => new Promise((resolve, reject) => textures.parse(buffer, resolve, reject))),
    upload: (texture) => stage.preload(texture),
  })
  stage.onRestore(() => keeper.restore())
  return (id) =>
    busy(async () => {
      const loader = new GLTFLoader().register(embeddedBasisu(textures, (image, texture) => keeper.track(id, image, texture)))
      return (await loader.loadAsync(assetUrl.model(id))).scene
    })
}

export function whileBusy(idle: () => void, delayMs: number, wake: () => void = () => {}): Busy {
  let running = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  return async <T,>(task: () => Promise<T>): Promise<T> => {
    if (running === 0) wake()
    running += 1
    if (timer !== null) clearTimeout(timer)
    timer = null
    try {
      return await task()
    } finally {
      running -= 1
      if (running === 0) {
        timer = setTimeout(() => {
          timer = null
          idle()
        }, delayMs)
      }
    }
  }
}

export function spawnTranscoders(loader: KTX2Loader): void {
  loader.init().then(
    () => {
      for (let i = 0; i < loader.workerPool.pool; i++) loader.workerPool._initWorker(i)
    },
    () => {},
  )
}

export function embeddedBasisu(textures: KTX2Loader, track: Track = () => {}): (parser: GLTFParser) => GLTFLoaderPlugin {
  return (parser) => {
    const json = parser.json as GltfJson
    const decoded = new Map<number, Promise<THREE.Texture>>()
    const configured = new Map<string, Promise<THREE.Texture>>()
    const claimed = new WeakSet<THREE.Texture>()
    const decode = (source: number, bufferView: number) => {
      let task = decoded.get(source)
      if (!task) {
        task = parser
          .getDependency('bufferView', bufferView)
          .then((buffer: ArrayBuffer) => new Promise<THREE.Texture>((resolve, reject) => textures.parse(buffer, resolve, reject)))
        decoded.set(source, task)
      }
      return task
    }
    return {
      name: BASISU,
      loadTexture(index) {
        const definition = json.textures[index]
        const source = definition.extensions?.[BASISU]?.source
        if (source === undefined) return null
        const bufferView = json.images[source].bufferView
        if (bufferView === undefined) return parser.loadTextureImage(index, source, textures)
        const sampler = samplerOf(json.samplers?.[definition.sampler ?? -1])
        const key = `${source}:${sampler.magFilter},${sampler.minFilter},${sampler.wrapS},${sampler.wrapT}`
        let task = configured.get(key)
        if (!task) {
          task = decode(source, bufferView).then((shared) => {
            const texture = claimed.has(shared) ? shared.clone() : shared
            claimed.add(shared)
            applySampler(texture, sampler)
            texture.name = definition.name || json.images[source].name || ''
            parser.associations.set(texture, { textures: index })
            track(source, texture)
            return texture
          })
          configured.set(key, task)
        }
        return task
      },
    }
  }
}

export function createTextureKeeper(options: KeeperOptions): TextureKeeper {
  const sources = new WeakMap<THREE.Texture['source'], Held>()
  const live = new Set<Held>()
  let restoring: Promise<void> = Promise.resolve()

  const release = (held: Held) => {
    for (const level of held.levels) level.data = EMPTY
    held.source.dataReady = false
    held.released = true
  }

  const uploaded = (texture: THREE.Texture) => {
    const held = sources.get(texture.source)
    if (!held) return
    if (held.released) {
      if (!held.restoring && import.meta.env.DEV) {
        console.error(`texture ${held.name || held.image} of model ${held.model} was uploaded again after its data was released`)
      }
      return
    }
    if (!held.waiting.delete(texture)) return
    if (held.waiting.size === 0) release(held)
  }

  const forget = (event: { target: THREE.Texture }) => {
    const texture = event.target
    const held = sources.get(texture.source)
    if (!held || !held.textures.delete(texture)) return
    held.waiting.delete(texture)
    if (held.textures.size === 0) live.delete(held)
    else if (!held.released && held.waiting.size === 0) release(held)
  }

  const refill = (held: Held, fresh: THREE.CompressedTexture) => {
    const levels = fresh.mipmaps
    if (levels.length === held.levels.length) {
      held.levels.forEach((level, i) => Object.assign(level, levels[i]))
    } else {
      held.levels = levels
      for (const texture of held.textures) texture.mipmaps = [...levels]
    }
    held.source.dataReady = true
    held.released = false
    held.waiting = new Set(held.textures)
    for (const texture of held.textures) {
      texture.format = fresh.format
      texture.needsUpdate = true
    }
    for (const texture of [...held.textures]) options.upload(texture)
  }

  const restoreModel = async (model: ModelId, list: Held[]) => {
    try {
      const image = glbImages(await options.read(model))
      await Promise.all(
        list.map(async (held) => {
          const fresh = await options.transcode(image(held.image))
          if (live.has(held)) refill(held, fresh)
          fresh.dispose()
        }),
      )
    } catch (error) {
      console.error(`textures of model ${model} could not be restored`, error)
    } finally {
      for (const held of list) held.restoring = false
    }
  }

  const restoreAll = async () => {
    const byModel = new Map<ModelId, Held[]>()
    for (const held of live) {
      if (!held.released) continue
      held.restoring = true
      const list = byModel.get(held.model)
      if (list) list.push(held)
      else byModel.set(held.model, [held])
    }
    await Promise.all([...byModel].map(([model, list]) => restoreModel(model, list)))
  }

  return {
    track(model, image, texture) {
      let held = sources.get(texture.source)
      if (!held || !live.has(held)) {
        held = {
          model,
          image,
          name: texture.name,
          source: texture.source,
          levels: [...(texture.mipmaps as THREE.CompressedTextureMipmap[])],
          textures: new Set(),
          waiting: new Set(),
          released: false,
          restoring: false,
        }
        sources.set(texture.source, held)
        live.add(held)
      }
      held.textures.add(texture)
      held.waiting.add(texture)
      texture.onUpdate = uploaded
      texture.addEventListener('dispose', forget)
    },
    restore() {
      restoring = restoring.then(restoreAll)
      return restoring
    },
    holding() {
      let count = 0
      for (const held of live) if (!held.released) count += 1
      return count
    },
  }
}

export function glbImages(buffer: ArrayBuffer): (image: number) => ArrayBuffer {
  const view = new DataView(buffer)
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a GLB file')
  const jsonLength = view.getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength))) as GltfJson
  const bin = 20 + jsonLength + 8
  return (image) => {
    const index = json.images[image]?.bufferView
    if (index === undefined) throw new Error(`image ${image} is not embedded`)
    const { byteOffset = 0, byteLength } = json.bufferViews[index]
    return buffer.slice(bin + byteOffset, bin + byteOffset + byteLength)
  }
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  return response.arrayBuffer()
}

function samplerOf(sampler: GltfSampler = {}): Sampler {
  return {
    magFilter: MAG_FILTERS[sampler.magFilter ?? -1] ?? THREE.LinearFilter,
    minFilter: MIN_FILTERS[sampler.minFilter ?? -1] ?? THREE.LinearMipmapLinearFilter,
    wrapS: WRAPS[sampler.wrapS ?? -1] ?? THREE.RepeatWrapping,
    wrapT: WRAPS[sampler.wrapT ?? -1] ?? THREE.RepeatWrapping,
  }
}

function applySampler(texture: THREE.Texture, sampler: Sampler): void {
  texture.flipY = false
  texture.magFilter = sampler.magFilter
  texture.minFilter = sampler.minFilter
  texture.wrapS = sampler.wrapS
  texture.wrapT = sampler.wrapT
  const filtered = texture.minFilter !== THREE.NearestFilter && texture.minFilter !== THREE.LinearFilter
  texture.generateMipmaps = !(texture instanceof THREE.CompressedTexture) && filtered
}
