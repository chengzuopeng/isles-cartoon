import { execFile, spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium } from '@playwright/test'

const run = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(here, '../../..')
const PROBE = path.resolve(here, '../probe.js')
const SETTINGS_KEY = 'shattered-isles.settings.v1'
const CHROME_ARGS = ['--use-angle=metal']
const UNLOCKED_ARGS = ['--disable-gpu-vsync', '--disable-frame-rate-limit']
const DEFAULT_SERVER_PORT = 5291

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
    return response.ok
  } catch {
    return false
  }
}

export async function ensureServer(url, port = DEFAULT_SERVER_PORT) {
  if (url) {
    if (!(await reachable(url))) throw new Error(`被测地址打不开：${url}`)
    return { url, stop: async () => {} }
  }
  const own = `http://localhost:${port}/`
  if (await reachable(own)) throw new Error(`端口 ${port} 已被占用；先关掉它，或用 --url 指定被测地址`)
  const child = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  child.stdout.on('data', (chunk) => (log += chunk))
  child.stderr.on('data', (chunk) => (log += chunk))
  const started = Date.now()
  while (!(await reachable(own))) {
    if (child.exitCode !== null) throw new Error(`开发服务器没起来：\n${log}`)
    if (Date.now() - started > 60_000) {
      child.kill('SIGTERM')
      throw new Error(`开发服务器 60 秒内没起来：\n${log}`)
    }
    await sleep(300)
  }
  return {
    url: own,
    stop: async () => {
      if (child.exitCode !== null) return
      child.kill('SIGTERM')
      await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(5000)])
      if (child.exitCode === null) child.kill('SIGKILL')
    },
  }
}

export async function launchBrowser(options = {}) {
  return chromium.launch({ channel: 'chrome', headless: !options.headed, args: options.vsync ? CHROME_ARGS : [...UNLOCKED_ARGS, ...CHROME_ARGS] })
}

export async function openPage(browser, options = {}) {
  const context = await browser.newContext({ viewport: { width: options.width ?? 1600, height: options.height ?? 900 }, deviceScaleFactor: options.scale ?? 1 })
  const config = { recordFrames: Boolean(options.recordFrames) }
  await context.addInitScript({
    content: `window.__perfConfig = ${JSON.stringify(config)};try{localStorage.setItem(${JSON.stringify(SETTINGS_KEY)}, ${JSON.stringify(JSON.stringify({ tips: false }))})}catch{}`,
  })
  await context.addInitScript({ path: PROBE })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(`console: ${message.text()}`)
  })
  page.on('crash', () => errors.push('crash'))
  const cdp = await context.newCDPSession(page)
  return { context, page, cdp, errors }
}

export async function collectGarbage(cdp) {
  await cdp.send('HeapProfiler.collectGarbage')
  await sleep(50)
  await cdp.send('HeapProfiler.collectGarbage')
}

export async function heapUsage(cdp) {
  const usage = await cdp.send('Runtime.getHeapUsage')
  return {
    used: usage.usedSize,
    total: usage.totalSize,
    embedder: usage.embedderHeapUsedSize ?? null,
    backing: usage.backingStorageSize ?? null,
  }
}

function parseFootprint(text) {
  const match = /phys_footprint:\s*([\d.]+)\s*(KB|MB|GB|B)/.exec(text)
  if (!match) return null
  const value = Number(match[1])
  const scale = { B: 1 / 1024 / 1024, KB: 1 / 1024, MB: 1, GB: 1024 }[match[2]]
  return value * scale
}

export async function processMemory(browser) {
  if (process.platform !== 'darwin') return null
  const session = await browser.newBrowserCDPSession()
  try {
    const { processInfo } = await session.send('SystemInfo.getProcessInfo')
    const candidates = []
    for (const item of processInfo.filter((entry) => entry.type === 'renderer')) {
      try {
        const { stdout } = await run('ps', ['-p', String(item.id), '-o', 'args='])
        if (!/webui/i.test(stdout)) candidates.push(item)
      } catch {}
    }
    const renderers = candidates.sort((a, b) => b.cpuTime - a.cpuTime)
    const gpu = processInfo.find((item) => item.type === 'GPU')
    const measure = async (item) => {
      if (!item) return null
      try {
        const { stdout } = await run('footprint', [String(item.id)])
        return parseFootprint(stdout)
      } catch {
        return null
      }
    }
    return { renderer: await measure(renderers[0]), gpu: await measure(gpu) }
  } finally {
    await session.detach().catch(() => {})
  }
}

export async function measureMemory(browser, cdp, page) {
  await collectGarbage(cdp)
  const heap = await heapUsage(cdp)
  const inPage = await page.evaluate(() => ({ memory: window.__perf.memory(), info: window.__perf.renderInfo() }))
  const processes = await processMemory(browser)
  return { heap, ...inPage.memory, renderInfo: inPage.info, processes }
}

export async function waitForGame(page, timeout = 90_000) {
  await page.waitForFunction(() => window.__game?.screen === 'prep' || window.__game?.screen === 'play', null, { timeout, polling: 50 })
}

export async function waitQuiet(page, { quiet = 1500, timeout = 90_000 } = {}) {
  const started = Date.now()
  for (;;) {
    const state = await page.evaluate(() => ({ now: performance.now(), gl: window.__perf.gl.last, last: window.__perf.activity().last }))
    if (state.now - state.last >= quiet) return state.gl
    if (Date.now() - started > timeout) return state.gl
    await sleep(Math.max(100, Math.min(500, quiet - (state.now - state.last))))
  }
}

export async function startLevel(page, id) {
  return page.evaluate(async (level) => {
    const game = window.__game
    const begin = performance.now()
    const pending = game.startLevel(level)
    game.skipDialogue()
    await pending
    while (game.screen !== 'play' || game.level !== level) {
      if (performance.now() - begin > 120_000) throw new Error(`进不了关卡 ${level}`)
      await new Promise((resolve) => setTimeout(resolve, 4))
      game.skipDialogue()
    }
    const end = performance.now()
    game.skipDialogue()
    return { begin, end, ms: end - begin }
  }, id)
}

export async function restartLevel(page) {
  await page.evaluate(() => {
    window.__game.skipDialogue()
    window.__game.restart()
    window.__game.skipDialogue()
  })
}

export async function placeAtSpot(page, spot) {
  return page.evaluate((target) => {
    const game = window.__game
    game.debug.invincible = true
    game.restart()
    game.skipDialogue()
    if (target.boss) {
      game.teleportToBoss()
      game.act({ moveX: 0, moveY: -1 }, 2)
    } else game.teleport(target.area)
    if (target.at) {
      const player = game.world.player
      player.pos.x = target.at[0]
      player.pos.y = target.at[1]
      player.prev.x = player.pos.x
      player.prev.y = player.pos.y
    }
    if (target.advance) game.advance(target.advance)
    game.look(target.yaw ?? -Math.PI / 2, target.pitch ?? 0)
    const world = game.world
    return {
      area: world.areaIndex,
      areaName: world.level.areas[world.areaIndex]?.name ?? '',
      enemies: world.enemies.filter((enemy) => enemy.hp > 0).length,
      bossPhase: world.boss?.boss?.phase ?? null,
    }
  }, spot)
}
