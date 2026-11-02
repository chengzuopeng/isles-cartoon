import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Worker, isMainThread, parentPort } from 'node:worker_threads'
import { NodeBasisEncoder } from 'ktx2-encoder'

const GLB_MAGIC = 0x46546c67
const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942
const BASISU = 'KHR_texture_basisu'
const KTX2_MIME = 'image/ktx2'
const BLOCK = 4
const UASTC = { level: 2, zstd: true }
const COLOR_SLOTS = new Set(['baseColorTexture', 'emissiveTexture', 'sheenColorTexture', 'specularColorTexture'])
const NORMAL_SLOTS = new Set(['normalTexture', 'clearcoatNormalTexture'])
const CACHE_DIR = path.join(os.tmpdir(), 'shattered-isles-ktx2')

const align4 = (value) => Math.ceil(value / 4) * 4
const kb = (bytes) => Math.round(bytes / 1024)

function readGlb(bytes) {
  if (bytes.readUInt32LE(0) !== GLB_MAGIC || bytes.readUInt32LE(16) !== JSON_CHUNK) throw new Error('not a GLB with a JSON chunk')
  const jsonLength = bytes.readUInt32LE(12)
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength))
  const binAt = 20 + jsonLength
  const hasBin = binAt + 8 <= bytes.length && bytes.readUInt32LE(binAt + 4) === BIN_CHUNK
  const bin = hasBin ? bytes.subarray(binAt + 8, binAt + 8 + bytes.readUInt32LE(binAt)) : Buffer.alloc(0)
  return { json, bin }
}

function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32LE(data.length, 0)
  head.writeUInt32LE(type, 4)
  return [head, data]
}

function writeGlb(json, bin) {
  const text = Buffer.from(JSON.stringify(json), 'utf8')
  const jsonData = Buffer.alloc(align4(text.length), 0x20)
  text.copy(jsonData)
  const parts = [...chunk(JSON_CHUNK, jsonData), ...chunk(BIN_CHUNK, bin)]
  const header = Buffer.alloc(12)
  header.writeUInt32LE(GLB_MAGIC, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + parts.reduce((sum, part) => sum + part.length, 0), 8)
  return Buffer.concat([header, ...parts])
}

function imageSize(bytes, mimeType) {
  if (mimeType === 'image/png') return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  if (mimeType !== 'image/jpeg') return null
  let at = 2
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) throw new Error('broken JPEG segment')
    const marker = bytes[at + 1]
    if (marker === 0xff) {
      at += 1
      continue
    }
    if (marker === 0xda || marker === 0xd9) return null
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) }
    }
    at += 2 + bytes.readUInt16BE(at + 2)
  }
  return null
}

function targetSize({ width, height }, max) {
  const scale = Math.min(1, max / Math.max(width, height))
  const snap = (value) => Math.max(BLOCK, Math.round((value * scale) / BLOCK) * BLOCK)
  return { width: snap(width), height: snap(height) }
}

function imageRoles(json, source) {
  const textureRoles = new Map()
  const visit = (value, key) => {
    if (!value || typeof value !== 'object') return
    if (key?.endsWith('Texture') && Number.isInteger(value.index)) {
      const role = COLOR_SLOTS.has(key) ? 'color' : NORMAL_SLOTS.has(key) ? 'normal' : 'linear'
      textureRoles.set(value.index, new Set([...(textureRoles.get(value.index) ?? []), role]))
    }
    for (const [childKey, child] of Object.entries(value)) visit(child, childKey)
  }
  for (const material of json.materials ?? []) visit(material)
  const roles = new Map()
  for (const [index, found] of textureRoles) {
    const texture = json.textures[index]
    const image = texture.extensions?.[BASISU]?.source ?? texture.source
    roles.set(image, new Set([...(roles.get(image) ?? []), ...found]))
  }
  const resolved = new Map()
  for (const [image, found] of roles) {
    if (found.size > 1) throw new Error(`${source}: image ${image} is used as ${[...found].join(' and ')}`)
    resolved.set(image, [...found][0])
  }
  return resolved
}

function resample(bytes, mimeType, size, work) {
  const input = path.join(work, mimeType === 'image/png' ? 'in.png' : 'in.jpg')
  const output = path.join(work, 'out.png')
  fs.writeFileSync(input, bytes)
  execFileSync('sips', ['-z', String(size.height), String(size.width), '-s', 'format', 'png', input, '--out', output], {
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  return fs.readFileSync(output)
}

function repack(json, bin, replaced, source) {
  if (json.buffers?.length !== 1 || json.bufferViews.some((view) => view.buffer !== 0 || view.extensions)) {
    throw new Error(`${source}: only one embedded buffer and plain bufferViews can be repacked`)
  }
  const order = json.bufferViews.map((view, index) => ({ view, index })).sort((a, b) => (a.view.byteOffset ?? 0) - (b.view.byteOffset ?? 0))
  const parts = []
  let offset = 0
  let end = 0
  for (const { view, index } of order) {
    const start = view.byteOffset ?? 0
    if (start < end) throw new Error(`${source}: bufferViews overlap`)
    end = start + view.byteLength
    const data = replaced.get(index) ?? bin.subarray(start, end)
    offset = align4(offset)
    parts.push({ offset, data })
    view.byteOffset = offset
    view.byteLength = data.length
    offset += data.length
  }
  const packed = Buffer.alloc(align4(offset))
  for (const part of parts) part.data.copy(packed, part.offset)
  json.buffers[0].byteLength = packed.length
  return packed
}

function useBasisu(json) {
  for (const texture of json.textures ?? []) {
    if (texture.source === undefined) continue
    texture.extensions = { ...texture.extensions, [BASISU]: { source: texture.source } }
    delete texture.source
  }
  for (const list of ['extensionsUsed', 'extensionsRequired']) json[list] = [...new Set([...(json[list] ?? []), BASISU])]
}

function encoderVersion() {
  const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  return `ktx2-encoder@${manifest.devDependencies['ktx2-encoder']}`
}

function createPool(size) {
  const workers = []
  const idle = []
  const queue = []
  const running = new Map()
  let next = 0
  const dispatch = () => {
    while (idle.length > 0 && queue.length > 0) {
      const worker = idle.pop()
      const job = queue.shift()
      running.set(job.id, { ...job, worker })
      worker.postMessage({ id: job.id, task: job.task }, [job.task.bytes.buffer])
    }
  }
  for (let i = 0; i < size; i++) {
    const worker = new Worker(new URL(import.meta.url))
    worker.on('message', ({ id, bytes, error }) => {
      const job = running.get(id)
      running.delete(id)
      idle.push(worker)
      if (error) job.reject(new Error(error))
      else job.resolve(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
      dispatch()
    })
    worker.on('error', (error) => {
      for (const job of [...running.values(), ...queue.splice(0)]) job.reject(error)
      running.clear()
    })
    workers.push(worker)
    idle.push(worker)
  }
  return {
    encode: (task) =>
      new Promise((resolve, reject) => {
        queue.push({ id: next++, task: { ...task, bytes: new Uint8Array(task.bytes) }, resolve, reject })
        dispatch()
      }),
    close: () => Promise.all(workers.map((worker) => worker.terminate())),
  }
}

function encode(basis, { bytes, png, role, width, height }) {
  const linear = role !== 'color'
  const encoder = new basis.BasisEncoder()
  try {
    if (role === 'normal') encoder.setNormalMapPreset()
    encoder.setStatusOutput(false)
    encoder.setDebug(false)
    const type = png ? basis.ldr_image_type.cPNGImage : basis.ldr_image_type.cJPGImage
    if (!encoder.setSliceSourceImage(0, bytes, 0, 0, type.value)) throw new Error('the encoder could not read the image')
    encoder.setCreateKTX2File(true)
    encoder.setFormatMode(basis.basis_tex_format.cUASTC_LDR_4x4.value)
    encoder.setPackUASTCFlags(UASTC.level)
    encoder.setKTX2UASTCSupercompression(UASTC.zstd)
    encoder.setCheckForAlpha(true)
    encoder.setPerceptual(!linear)
    encoder.setKTX2AndBasisSRGBTransferFunc(!linear)
    encoder.setMipGen(true)
    encoder.setMipSRGB(!linear)
    for (let capacity = width * height * 2 + 65536; capacity <= width * height * 64; capacity *= 2) {
      const output = new Uint8Array(capacity)
      const length = encoder.encode(output)
      if (length > 0) return verify(basis, output.slice(0, length), width, height, linear)
    }
    throw new Error('the encoder produced no output')
  } finally {
    encoder.delete()
  }
}

function verify(basis, bytes, width, height, linear) {
  const file = new basis.KTX2File(bytes)
  try {
    const levels = Math.floor(Math.log2(Math.max(width, height))) + 1
    if (!file.isValid() || !file.isUASTC()) throw new Error('the KTX2 output is not UASTC')
    if (file.getWidth() !== width || file.getHeight() !== height) throw new Error(`the KTX2 output is ${file.getWidth()}x${file.getHeight()}`)
    if (file.getLevels() !== levels) throw new Error(`the KTX2 output has ${file.getLevels()} levels instead of ${levels}`)
    if (file.isSRGB() === linear) throw new Error('the KTX2 output has the wrong transfer function')
    return bytes
  } finally {
    file.close()
    file.delete()
  }
}

function replaceFile(target, bytes) {
  const partial = `${target}.${process.pid}.part`
  fs.writeFileSync(partial, bytes)
  fs.renameSync(partial, target)
}

async function texture(data, mimeType, fit, role, resized, work, pool, stats) {
  const settings = { encoder: stats.encoder, ...UASTC, role, ...fit }
  const key = crypto.createHash('sha256').update(JSON.stringify(settings)).update(data).digest('hex')
  const cached = path.join(CACHE_DIR, `${key}.ktx2`)
  if (fs.existsSync(cached)) {
    stats.cached += 1
    return fs.readFileSync(cached)
  }
  const input = resized ? resample(data, mimeType, fit, work) : Buffer.from(data)
  const ktx2 = await pool.encode({ bytes: input, png: resized || mimeType === 'image/png', role, ...fit })
  replaceFile(cached, ktx2)
  stats.encoded += 1
  return ktx2
}

async function packModel(source, target, max, pool, work, stats) {
  const bytes = fs.readFileSync(source)
  const { json, bin } = readGlb(bytes)
  if (!json.images?.length) {
    replaceFile(target, bytes)
    return `${path.basename(target)}: no textures, copied`
  }
  const roles = imageRoles(json, source)
  const replaced = new Map()
  const notes = await Promise.all(
    json.images.map(async (image, index) => {
      if (image.bufferView === undefined) throw new Error(`${source}: image ${index} is not embedded`)
      if (image.mimeType === KTX2_MIME) return `${image.name ?? index} already KTX2`
      const view = json.bufferViews[image.bufferView]
      const data = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)
      const size = imageSize(data, image.mimeType)
      if (!size) throw new Error(`${source}: image ${index} is ${image.mimeType}, expected PNG or JPEG`)
      const fit = targetSize(size, max)
      const resized = fit.width !== size.width || fit.height !== size.height
      const ktx2 = await texture(data, image.mimeType, fit, roles.get(index) ?? 'color', resized, work, pool, stats)
      replaced.set(image.bufferView, ktx2)
      image.mimeType = KTX2_MIME
      const scaled = resized ? ` -> ${fit.width}x${fit.height}` : ''
      return `${image.name ?? index} ${size.width}x${size.height}${scaled} ${kb(data.length)} -> ${kb(ktx2.length)} KB`
    }),
  )
  useBasisu(json)
  const glb = writeGlb(json, repack(json, bin, replaced, source))
  replaceFile(target, glb)
  stats.before += bytes.length
  stats.after += glb.length
  return `${path.basename(target)}: ${notes.join(', ')}; ${kb(bytes.length)} KB -> ${kb(glb.length)} KB`
}

async function main() {
  const [limit, ...files] = process.argv.slice(2)
  const max = Number(limit)
  if (!Number.isInteger(max) || max < BLOCK || files.length === 0 || files.length % 2 !== 0) {
    console.error('usage: node scripts/pack-glb.mjs <max texture size> <in.glb> <out.glb> [<in.glb> <out.glb> ...]')
    process.exit(1)
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-glb-'))
  const pool = createPool(Math.max(1, Math.min(8, os.availableParallelism() - 2)))
  const stats = { encoder: encoderVersion(), encoded: 0, cached: 0, before: 0, after: 0 }
  try {
    const pairs = []
    for (let i = 0; i < files.length; i += 2) pairs.push([files[i], files[i + 1], fs.mkdtempSync(path.join(work, 'glb-'))])
    const lines = await Promise.all(pairs.map(([source, target, dir]) => packModel(source, target, max, pool, dir, stats)))
    for (const line of lines) console.log(line)
  } finally {
    await pool.close()
    fs.rmSync(work, { recursive: true, force: true })
  }
  console.log(`textures: ${stats.encoded} encoded, ${stats.cached} reused from ${CACHE_DIR}; GLBs with textures ${kb(stats.before)} KB -> ${kb(stats.after)} KB`)
}

if (isMainThread) {
  await main()
} else {
  const basis = await new NodeBasisEncoder().init()
  parentPort.on('message', ({ id, task }) => {
    try {
      const bytes = encode(basis, task)
      parentPort.postMessage({ id, bytes }, [bytes.buffer])
    } catch (error) {
      parentPort.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
    }
  })
}
