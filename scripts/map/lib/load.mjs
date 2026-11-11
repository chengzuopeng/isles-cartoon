import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(here, '../../..')

export async function openSim() {
  const server = await createServer({
    configFile: false,
    root: ROOT,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  })
  return { load: (file) => server.ssrLoadModule(`/src/${file}`), close: () => server.close() }
}

function isLevel(value) {
  return Boolean(value) && typeof value === 'object' && typeof value.id === 'string' && Array.isArray(value.areas)
}

function labelOf(source) {
  return path.basename(source).replace(/\.(json|mjs|js)$/, '')
}

export async function resolveLevel(sim, source) {
  if (source.endsWith('.json')) {
    const def = JSON.parse(fs.readFileSync(path.resolve(source), 'utf8'))
    if (!isLevel(def)) throw new Error(`${source} 不是关卡数据（要有 id 和 areas）`)
    return { def, label: labelOf(source), title: def.title, via: [], notes: [], names: {} }
  }
  if (source.endsWith('.mjs') || source.endsWith('.js')) {
    const module = await import(pathToFileURL(path.resolve(source)).href)
    if (!isLevel(module.level)) throw new Error(`${source} 要导出 level（关卡数据）`)
    return { def: module.level, label: `${labelOf(source)}-sketch`, title: module.title ?? module.level.title, via: module.via ?? [], notes: module.notes ?? [], names: module.names ?? {} }
  }
  for (const file of [`data/levels/level-${source}.ts`, `data/levels/${source}.ts`]) {
    if (!fs.existsSync(path.join(ROOT, 'src', file))) continue
    const module = await sim.load(file)
    const def = Object.values(module).find(isLevel)
    if (def) return { def, label: source, title: def.title, via: [], notes: [], names: {} }
  }
  throw new Error(`找不到关卡「${source}」：写关卡 id（比如 1-1）、关卡数据的 .json，或草稿 .mjs`)
}
