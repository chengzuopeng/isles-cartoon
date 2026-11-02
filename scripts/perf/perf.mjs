import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spots } from './commands/spots.mjs'
import { writeResult } from './lib/report.mjs'
import { ensureServer, launchBrowser, openPage } from './lib/session.mjs'

const COMMANDS = { spots }
const LISTS = new Set(['levels', 'spots'])
const NUMBERS = new Set(['seconds', 'warmup', 'scale', 'width', 'height', 'port'])

const HELP = `用法：pnpm perf <命令…> [选项]

命令：
  spots      重点位置（scripts/perf/spots.json）：draw call、三角形、帧时间、主线程

选项：
  --url <地址>         被测地址；不写就在 5291 端口自己起一份当前代码的开发服务器
  --out <目录>         结果目录（默认系统临时目录下 isles-cartoon-perf/<时间>）
  --label <文字>       写进结果的标签，比如 baseline、current
  --levels a,b         只量这些关
  --spots a,b          只量 spots.json 里这些 id
  --seconds <秒>       每个位置量多久（默认 4）
  --warmup <秒>        到位后先跑多久再量（默认 1）
  --width / --height   视口（默认 1600 × 900）
  --scale <倍>         设备像素比（默认 1）
  --vsync              锁 60 帧
  --headed             有界面地跑浏览器（调试用）
`

function parseArgs(argv) {
  const commands = []
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      commands.push(arg)
      continue
    }
    const raw = arg.slice(2)
    if (raw === 'help') {
      options.help = true
      continue
    }
    const key = raw.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    const next = argv[i + 1]
    const value = next !== undefined && !next.startsWith('--') ? (i++, next) : true
    if (LISTS.has(key)) options[key] = String(value).split(',').filter(Boolean)
    else if (NUMBERS.has(key)) options[key] = Number(value)
    else options[key] = value
  }
  return { commands, options }
}

function stamp() {
  const date = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

async function main() {
  const { commands, options } = parseArgs(process.argv.slice(2))
  if (options.help || commands.length === 0) {
    process.stdout.write(HELP)
    return
  }
  const unknown = commands.filter((command) => !COMMANDS[command])
  if (unknown.length > 0) throw new Error(`不认识的命令：${unknown.join(', ')}\n\n${HELP}`)
  const out = path.resolve(options.out ?? path.join(os.tmpdir(), 'isles-cartoon-perf', stamp()))
  const server = await ensureServer(options.url, options.port)
  const browser = await launchBrowser(options)
  const meta = { label: options.label ?? null, url: server.url, started: new Date().toISOString(), chrome: browser.version(), cpu: os.cpus()[0]?.model ?? '', options }
  const sections = []
  try {
    for (const command of commands) {
      process.stderr.write(`${command}…\n`)
      const ctx = { url: server.url, browser, options, open: () => openPage(browser, options) }
      const { data, markdown } = await COMMANDS[command](ctx)
      writeResult(out, command, { meta: { ...meta, command }, ...data }, markdown)
      sections.push(markdown)
      process.stdout.write(`${markdown}\n\n`)
    }
  } finally {
    await browser.close().catch(() => {})
    await server.stop()
  }
  const header = [`# 性能测量${meta.label ? `（${meta.label}）` : ''}`, `- 地址：${meta.url}`, `- 时间：${meta.started}`, `- 机器：${meta.cpu}；Chrome ${meta.chrome}${options.vsync ? '（锁 60 帧）' : ''}`].join('\n')
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(out, 'summary.md'), `${header}\n\n${sections.join('\n\n')}\n`)
  process.stderr.write(`结果在 ${out}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`)
  process.exitCode = 1
})
