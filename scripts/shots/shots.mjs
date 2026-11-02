import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureServer, launchBrowser, sleep, startLevel, waitForGame } from '../perf/lib/session.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[i + 1]
    options[key] = next !== undefined && !next.startsWith('--') ? (i++, next) : true
  }
  return options
}

function stamp() {
  const date = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

async function compare(page, before, after) {
  const read = (file) => `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`
  return page.evaluate(
    async ({ a, b }) => {
      const load = (src) =>
        new Promise((resolve, reject) => {
          const image = new Image()
          image.onload = () => resolve(image)
          image.onerror = reject
          image.src = src
        })
      const [first, second] = await Promise.all([load(a), load(b)])
      if (first.width !== second.width || first.height !== second.height) return 1
      const canvas = document.createElement('canvas')
      canvas.width = first.width
      canvas.height = first.height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(first, 0, 0)
      const left = context.getImageData(0, 0, canvas.width, canvas.height).data
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(second, 0, 0)
      const right = context.getImageData(0, 0, canvas.width, canvas.height).data
      let changed = 0
      for (let i = 0; i < left.length; i += 4) {
        const delta = Math.abs(left[i] - right[i]) + Math.abs(left[i + 1] - right[i + 1]) + Math.abs(left[i + 2] - right[i + 2])
        if (delta > 48) changed += 1
      }
      return changed / (left.length / 4)
    },
    { a: read(before), b: read(after) },
  )
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const config = JSON.parse(fs.readFileSync(path.resolve(here, 'spots.json'), 'utf8'))
  const chosen = options.spots ? config.spots.filter((spot) => String(options.spots).split(',').includes(spot.id)) : config.spots
  const out = path.resolve(options.out ?? path.join(os.tmpdir(), 'isles-cartoon-shots', stamp()))
  fs.mkdirSync(out, { recursive: true })
  const server = await ensureServer(options.url, Number(options.port ?? 5292))
  const browser = await launchBrowser({ vsync: true })
  const rows = []
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
    await context.addInitScript({ content: `try{localStorage.setItem('shattered-isles.settings.v1', JSON.stringify({ tips: false }))}catch{}` })
    const page = await context.newPage()
    await page.goto(server.url, { waitUntil: 'commit' })
    await waitForGame(page)
    await page.addStyleTag({ content: '.hud-banner, .bark-bar, .dialogue, .tp-dfwv { visibility: hidden !important; }' })
    let current = null
    for (const spot of chosen) {
      if (spot.level !== current) {
        await startLevel(page, spot.level)
        current = spot.level
      }
      await page.evaluate((target) => {
        const game = window.__game
        game.debug.invincible = true
        game.freeze(true)
        game.restart()
        game.skipDialogue()
        for (const enemy of game.world.enemies) enemy.notice = 0
        const player = game.world.player
        player.pos.x = target.at[0]
        player.pos.y = target.at[1]
        player.prev.x = player.pos.x
        player.prev.y = player.pos.y
        game.advance(0.05)
        game.look(target.yaw, target.pitch)
      }, spot)
      await sleep(900)
      const file = path.join(out, `${spot.id}.png`)
      await page.screenshot({ path: file })
      let diff = null
      if (options.compare) {
        const baseline = path.resolve(String(options.compare), `${spot.id}.png`)
        if (fs.existsSync(baseline)) diff = await compare(page, baseline, file)
      }
      rows.push({ id: spot.id, name: spot.name, diff })
      process.stderr.write(`  ${spot.id} ${spot.name}${diff === null ? '' : ` 差异 ${(diff * 100).toFixed(1)}%`}\n`)
    }
    await context.close()
  } finally {
    await browser.close().catch(() => {})
    await server.stop()
  }
  const lines = ['| 机位 | 位置 | 和对照组的差异 |', '|---|---|---|', ...rows.map((row) => `| ${row.id} | ${row.name} | ${row.diff === null ? '—' : `${(row.diff * 100).toFixed(1)}%`} |`)]
  fs.writeFileSync(path.join(out, 'summary.md'), `${lines.join('\n')}\n`)
  process.stdout.write(`${lines.join('\n')}\n截图在 ${out}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`)
  process.exitCode = 1
})
