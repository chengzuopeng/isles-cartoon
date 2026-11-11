import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { renderMap } from './lib/draw.mjs'
import { emitLevel } from './lib/emit.mjs'
import { openSim, resolveLevel } from './lib/load.mjs'
import { comparePage, singlePage, snapshot } from './lib/page.mjs'
import { planText } from './lib/sketch.mjs'

const SKILL_NAMES = { perfect: '完美', human: '普通玩家', novice: '新手' }

const HELP = `用法：pnpm map <命令> <关卡…> [选项]

命令：
  draw <关卡…>             画俯视图：地形、敌人、宝箱、主路线，站在起点看得见的地面和敌人标红；打印视线统计和关卡校验
  compare <现在> <新方案>   两张图同一比例并排，带对比表；新方案是草稿时把草稿里的编号说明画上去
  play <关卡…>             自动驾驶三档各跑几局，看走不走得通、用时和挨打次数
  text <关卡>              打印字符画和高度表（北在上，带行号）
  emit <草稿> [输出.ts]     把草稿写成关卡数据文件；不写输出就打印出来

关卡可以写：
  关卡 id                  1-1、1-2、trial-systems……读 src/data/levels 里现在的数据
  草稿 .mjs                用 scripts/map/lib/sketch.mjs 画出来的布局，导出 level，可选 title、via、notes、names
  关卡数据 .json           LevelDef 的 JSON

选项：
  --out <目录>             结果目录（默认系统临时目录下 isles-cartoon-map/<时间>）
  --via 'x,y;x,y'          主路线依次经过这些格子（整张图的坐标）；不写就走到出口的最短路。compare 时给新方案用
  --via-before 'x,y;x,y'   compare 时现在那张图的主路线经过的格子
  --cell <像素>            每格画多大（默认 8）
  --scale <倍>             PNG 的像素比（默认 1）
  --titles '现在,新方案'   compare 两张图的标题
  --heading <文字>         compare 的大标题
  --json                   draw / compare 时另存测量数据
  --seeds 1,2,3            play 用的种子（默认 1,2,3,4,5）
  --points brawl=1         play 的专精加点（gun、brawl、move、energy），和关卡的校准用例保持一致（1-2 是 brawl=1）
  --skills q=concussion:1  play 带的技能，槽位=技能:等级（3 级可以写 :3b 选 B 支），逗号隔开；和校准用例保持一致
  --carry shotgun          play 带进关的特殊武器
  --badges straw,fuse      play 装的徽章
`

function parseArgs(argv) {
  const positional = []
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const next = argv[i + 1]
    options[arg.slice(2)] = next !== undefined && !next.startsWith('--') ? (i++, next) : true
  }
  return { positional, options }
}

function stamp() {
  const date = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function parseVia(text) {
  return String(text)
    .split(';')
    .filter(Boolean)
    .map((pair) => pair.split(',').map(Number))
}

function parsePoints(text) {
  if (!text || text === true) return {}
  return Object.fromEntries(
    String(text)
      .split(',')
      .map((pair) => pair.split('='))
      .map(([name, value]) => [name, Number(value)]),
  )
}

function parseSkills(text) {
  if (!text || text === true) return []
  return String(text)
    .split(',')
    .map((pair) => pair.split('='))
    .map(([slot, rest]) => {
      const [id, rank = '1'] = rest.split(':')
      return { slot, id, rank: Number.parseInt(rank, 10), branch: rank.endsWith('b') ? 'b' : 'a' }
    })
}

function printStats(title, stats) {
  const lines = [
    ['整张地图', `${stats.columns} × ${stats.rows} 米`],
    ['能走的地面', `${stats.open} 平方米`],
    ['主路线', `${stats.route} 米`],
    ['站在起点看得见的地面', `${Math.round(stats.share * 100)}%`],
    ['站在起点看得见的敌人', stats.seen > 0 ? `${stats.seen} / ${stats.enemies} 个，最远 ${Math.round(stats.far)} 米` : `0 / ${stats.enemies} 个`],
    ['沿主路同时看得见的敌人', `平均 ${stats.average.toFixed(1)} 个，最多 ${stats.peak} 个`],
    ['沿主路四周能看多远', `平均 ${Math.round(stats.reach)} 米`],
    ['惊动一个最多带醒', `${stats.wakeMax} 个`],
    ['关卡校验', stats.problems.length === 0 ? '通过' : `${stats.problems.length} 个问题`],
  ]
  console.log(`\n${title}`)
  for (const [name, value] of lines) console.log(`  ${name.padEnd(14, '　')}${value}`)
  for (const problem of stats.problems) console.log(`    - ${problem}`)
}

async function measure(sim, source, options) {
  const { surveyLevel, surveyStats } = await sim.load('sim/level-survey.ts')
  const entry = await resolveLevel(sim, source)
  const via = options.via ? parseVia(options.via) : entry.via
  const survey = surveyLevel(entry.def, { via })
  return { ...entry, survey, stats: surveyStats(survey) }
}

function outDir(options) {
  const out = path.resolve(options.out === true || !options.out ? path.join(os.tmpdir(), 'isles-cartoon-map', stamp()) : options.out)
  fs.mkdirSync(out, { recursive: true })
  return out
}

async function draw(sim, sources, options) {
  if (sources.length === 0) throw new Error('draw 要写至少一个关卡')
  const out = outDir(options)
  const cell = Number(options.cell ?? 8)
  for (const source of sources) {
    const entry = await measure(sim, source, options)
    printStats(entry.title, entry.stats)
    fs.writeFileSync(path.join(out, `${entry.label}.svg`), renderMap(entry.survey, { cell, title: entry.title, callouts: entry.notes.map((note) => note.at) }))
    if (options.json) fs.writeFileSync(path.join(out, `${entry.label}.json`), JSON.stringify({ stats: entry.stats, survey: entry.survey }))
    await snapshot(singlePage(entry, { cell }), path.join(out, `${entry.label}.png`), Number(options.scale ?? 1))
    console.log(`  图：${path.join(out, `${entry.label}.png`)}`)
  }
}

async function compare(sim, sources, options) {
  if (sources.length !== 2) throw new Error('compare 要写两个关卡：现在的和新方案')
  const out = outDir(options)
  const cell = Number(options.cell ?? 8)
  const before = await measure(sim, sources[0], { ...options, via: options['via-before'] })
  const after = await measure(sim, sources[1], options)
  const [first, second] = options.titles && options.titles !== true ? String(options.titles).split(',') : ['现在', '新方案']
  before.title = first
  after.title = second
  printStats(before.title, before.stats)
  printStats(after.title, after.stats)
  if (options.json) fs.writeFileSync(path.join(out, 'compare.json'), JSON.stringify({ before: before.stats, after: after.stats }))
  await snapshot(comparePage(before, after, { cell, heading: options.heading === true ? undefined : options.heading }), path.join(out, 'compare.png'), Number(options.scale ?? 1))
  console.log(`\n图：${path.join(out, 'compare.png')}`)
}

async function play(sim, sources, options) {
  if (sources.length === 0) throw new Error('play 要写至少一个关卡')
  const runs = await sim.load('sim/calibration-runs.ts')
  const { createLoadout } = await sim.load('sim/stats.ts')
  const { AUTOPILOT_SKILL_ORDER } = await sim.load('data/autopilot.ts')
  const seeds = String(options.seeds === true || !options.seeds ? '1,2,3,4,5' : options.seeds)
    .split(',')
    .map(Number)
  const points = parsePoints(options.points)
  const skills = parseSkills(options.skills)
  const carry = options.carry && options.carry !== true ? String(options.carry) : null
  const badges = options.badges && options.badges !== true ? String(options.badges).split(',') : []
  for (const source of sources) {
    const entry = await resolveLevel(sim, source)
    console.log(`\n${entry.title}，${entry.label}（种子 ${seeds.join(',')}${Object.keys(points).length > 0 ? `，加点 ${JSON.stringify(points)}` : ''}${skills.length > 0 ? `，技能 ${skills.map((item) => `${item.slot}=${item.id}:${item.rank}`).join(',')}` : ''}${carry ? `，带 ${carry}` : ''}${badges.length > 0 ? `，徽章 ${badges.join(',')}` : ''}）`)
    const all = []
    for (const skill of AUTOPILOT_SKILL_ORDER) {
      const mine = seeds.map((seed) => runs.play(entry.def, skill, seed, createLoadout(points, skills, carry, badges)))
      all.push(...mine)
      const clears = mine.filter((run) => run.status === 'complete')
      const time = clears.length > 0 ? Math.round(clears.reduce((sum, run) => sum + run.time, 0) / clears.length) : 0
      const hits = mine.reduce((sum, run) => sum + run.hits, 0) / mine.length
      console.log(`  ${(SKILL_NAMES[skill] ?? skill).padEnd(4, '　')} 通关 ${clears.length} / ${mine.length}，平均 ${time} 秒，挨打 ${hits.toFixed(1)} 次`)
      for (const run of mine.filter((item) => item.status !== 'complete')) {
        console.log(`    - 种子 ${run.seed}：${run.status === 'dead' ? `死在「${run.area}」（${run.killedBy}）` : `卡在「${run.area}」`}，${run.time} 秒`)
      }
    }
    if (options.out && options.out !== true) {
      fs.mkdirSync(path.resolve(options.out), { recursive: true })
      fs.writeFileSync(path.join(path.resolve(options.out), `play-${entry.label}.json`), JSON.stringify(all))
    }
  }
}

async function text(sim, sources) {
  if (sources.length !== 1) throw new Error('text 要写一个关卡')
  const entry = await resolveLevel(sim, sources[0])
  process.stdout.write(planText(entry.def))
}

async function emit(sim, sources) {
  if (sources.length < 1 || sources.length > 2) throw new Error('emit 要写草稿，后面可以跟输出文件')
  const entry = await resolveLevel(sim, sources[0])
  const { buildLevel, validateLevel } = await sim.load('sim/level.ts')
  const problems = validateLevel(buildLevel(entry.def))
  if (problems.length > 0) throw new Error(`草稿没过关卡校验，先改好再写文件：\n${problems.map((problem) => `  - ${problem}`).join('\n')}`)
  const source = emitLevel(entry.def, entry.names)
  if (sources.length === 1) process.stdout.write(source)
  else {
    fs.writeFileSync(path.resolve(sources[1]), source)
    console.log(`写好了：${path.resolve(sources[1])}`)
  }
}

const COMMANDS = { draw, compare, play, text, emit }

async function main() {
  const { positional, options } = parseArgs(process.argv.slice(2))
  const [command, ...sources] = positional
  if (!command || options.help || !COMMANDS[command]) {
    console.log(HELP)
    process.exitCode = command && !options.help && !COMMANDS[command] ? 1 : 0
    return
  }
  const sim = await openSim()
  try {
    await COMMANDS[command](sim, sources, options)
  } finally {
    await sim.close()
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
