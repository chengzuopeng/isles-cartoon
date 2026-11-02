import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { enter } from './commands/enter.mjs'
import { leak } from './commands/leak.mjs'
import { spots } from './commands/spots.mjs'
import { startup } from './commands/startup.mjs'
import { stutter } from './commands/stutter.mjs'
import { writeResult } from './lib/report.mjs'
import { ensureServer, launchBrowser, openPage } from './lib/session.mjs'

const COMMANDS = { startup, spots, enter, leak, stutter }
const ALL = ['startup', 'spots', 'enter', 'leak', 'stutter']
const LEVELS = ['1-1']
const LISTS = new Set(['levels', 'spots'])
const NUMBERS = new Set(['seconds', 'warmup', 'scale', 'width', 'height', 'port', 'runs', 'quiet', 'rounds', 'settle', 'restarts', 'play', 'maxMinutes', 'capacity'])

const HELP = `用法：pnpm perf <命令…> [选项]

命令（可以写多个，按顺序跑；all = ${ALL.join(' ')}）：
  startup    启动：整备界面出现、可以操作、当前关准备好、长任务、下载和转码、整备界面期间的帧、启动后内存、一出整备界面就点出发要等多久
  spots      重点位置（scripts/perf/spots.json）：draw call、三角形、帧时间、主线程
  enter      进关：从整备界面 startLevel 到进关的时间、期间的下载、链接和上传、进关后第一帧
  leak       泄漏：循环进关、同关重开，每次自动驾驶打几秒，强制 GC 后记资源数和内存
  stutter    卡顿：自动驾驶（完美、无敌）从进关打到通关、同页重开再打一遍，逐帧记长帧、着色器链接、贴图上传

选项：
  --url <地址>         被测地址；不写就在 5291 端口自己起一份当前代码的开发服务器
  --port <端口>        自己起开发服务器时用的端口（默认 5291）
  --out <目录>         结果目录（默认系统临时目录下 isles-cartoon-perf/<时间>）
  --label <文字>       写进结果的标签，比如 baseline、current
  --levels a,b         spots 只量这些关；enter / leak / stutter 跑这些关（默认 ${LEVELS.join(',')}）
  --spots a,b          只量 spots.json 里这些 id
  --seconds <秒>       spots 每个位置量多久（默认 4）
  --warmup <秒>        spots 到位后先跑多久再量（默认 1）
  --runs <次>          startup 量几次（默认 3）；stutter 每关打几遍（默认 2）
  --quiet <毫秒>       startup 认定当前关准备好之前要安静多久（默认 2000）
  --rounds <轮>        enter 默认 2 轮，leak 默认 3 轮
  --settle <毫秒>      enter 每次进关前在整备界面等多久（默认 1500）
  --level <关卡>       leak 重开用的关（默认 1-1）
  --restarts <次>      leak 同关重开几次（默认 10）
  --play <秒>          leak 每次进关后用自动驾驶打多久（默认 3）
  --max-minutes <分>   stutter 每遍最多跑多久（默认 10）
  --capacity <帧>      stutter 每遍最多记多少帧（默认 600000）
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
      if (arg === 'all') commands.push(...ALL)
      else commands.push(arg)
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
  const meta = { label: options.label ?? null, url: server.url, started: new Date().toISOString(), chrome: browser.version(), cpu: os.cpus()[0]?.model ?? '', loadBefore: os.loadavg(), options }
  const sections = []
  try {
    for (const command of commands) {
      process.stderr.write(`${command}…\n`)
      const begin = Date.now()
      const ctx = {
        url: server.url,
        browser,
        options,
        out,
        levels: options.levels ?? LEVELS,
        open: (extra = {}) => openPage(browser, { width: options.width, height: options.height, scale: options.scale, ...extra }),
      }
      const load = os.loadavg()
      const { data, markdown } = await COMMANDS[command](ctx)
      writeResult(out, command, { meta: { ...meta, command, load, loadAfter: os.loadavg(), seconds: (Date.now() - begin) / 1000 }, ...data }, markdown)
      sections.push(markdown)
      process.stdout.write(`${markdown}\n\n`)
    }
  } finally {
    await browser.close().catch(() => {})
    await server.stop()
  }
  const header = [
    `# 性能测量${meta.label ? `（${meta.label}）` : ''}`,
    `- 地址：${meta.url}`,
    `- 时间：${meta.started}`,
    `- 机器：${meta.cpu}；Chrome ${meta.chrome}${options.vsync ? '（锁 60 帧）' : ''}；开始时 load average ${meta.loadBefore.map((value) => value.toFixed(1)).join(' / ')}`,
  ].join('\n')
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(out, 'summary.md'), `${header}\n\n${sections.join('\n\n')}\n`)
  process.stderr.write(`结果在 ${out}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`)
  process.exitCode = 1
})
