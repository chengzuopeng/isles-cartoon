import fs from 'node:fs'
import { chromium } from '@playwright/test'
import { CHEST_COLORS, ENEMY_COLORS, ENEMY_NAMES, enemyMark, renderMap } from './draw.mjs'

const STYLE = `
<style>
  body { margin: 0; background: #f6f1e4; font-family: -apple-system, "PingFang SC", Helvetica, sans-serif; color: #2b2118; }
  .wrap { padding: 22px 26px 26px; display: inline-block; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { font-size: 13px; color: #6a5a48; margin-bottom: 14px; }
  .cols { display: flex; gap: 18px; align-items: flex-start; }
  .card { background: #fffaf0; border: 1.5px solid #2b2118; border-radius: 6px; padding: 10px 12px 12px; box-shadow: 3px 3px 0 #2b2118; }
  table { border-collapse: collapse; font-size: 13px; margin: 0 0 12px; }
  th, td { border: 1px solid #b9a98f; padding: 5px 10px; text-align: left; }
  th { background: #efe4cc; }
  td.bad { color: #b3122a; font-weight: 700; }
  td.good { color: #1f7a3d; font-weight: 700; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 12px; margin: 12px 0 0; align-items: center; max-width: 1100px; }
  .legend span { display: inline-flex; align-items: center; gap: 5px; }
  .sw { display: inline-block; width: 13px; height: 13px; border: 1px solid #2b2118; }
  ol { margin: 0; padding-left: 22px; font-size: 12.5px; line-height: 1.55; width: 300px; }
  ol b { font-weight: 700; }
  .problems { font-size: 12.5px; color: #b3122a; margin: 0 0 12px; padding-left: 20px; }
</style>
`

function icon(body, width = 14, height = 14) {
  return `<svg width="${width}" height="${height}">${body}</svg>`
}

function swatch(color, opacity = 1) {
  return `<i class="sw" style="background:${color};opacity:${opacity}"></i>`
}

function legend(surveys) {
  const items = []
  const tiles = new Set(surveys.flatMap((survey) => survey.tiles))
  const high = (kind) => surveys.some((survey) => survey.tiles.some((tile, index) => tile === kind && survey.reach[index] !== 1))
  const kinds = new Set(surveys.flatMap((survey) => survey.enemies.map((enemy) => enemy.kind)))
  const has = (pick) => surveys.some((survey) => pick(survey))
  items.push(`${swatch('#ff3d2e', 0.5)}红色：站在起点看得见的地面`)
  items.push(`${icon('<circle cx="8" cy="8" r="6.3" fill="none" stroke="#ff2a1a" stroke-width="1.6"/><circle cx="8" cy="8" r="3.4" fill="#d8362b"/>', 16, 16)}红圈：站在起点看得见的敌人`)
  items.push(`${icon('<path d="M1 6h28" stroke="#1d5fd1" stroke-width="2" stroke-dasharray="5 4"/>', 30, 12)}主路线`)
  for (const kind of Object.keys(ENEMY_COLORS)) {
    if (kinds.has(kind)) items.push(`${icon(enemyMark(kind, 'guard', 7, 8), 14, 15)}${ENEMY_NAMES[kind]}`)
  }
  if (has((survey) => survey.enemies.some((enemy) => enemy.idle === 'ambush'))) items.push(`${icon(enemyMark('grunt', 'ambush', 7, 7))}埋伏（颜色同兵种）`)
  if (has((survey) => survey.rushes.length > 0)) items.push(`${icon('<path d="M7 11l-3.5 -6h7z" fill="#ff9d1c" stroke="#7a3b00" stroke-width=".8"/>')}冲锋波出生点`)
  if (has((survey) => survey.chests.length > 0)) {
    items.push(`${icon(`<rect x="3" y="3.5" width="8" height="7" rx="1" fill="${CHEST_COLORS.normal}" stroke="#3a2a08"/>`)}宝箱（蓝色稀有、粉色武器）`)
  }
  if (has((survey) => survey.supplies.length > 0)) items.push(`${icon('<path d="M7 2q4 4 0 9q-4 -5 0 -9z" fill="#ff7a1f" stroke="#7a2a00" stroke-width=".9"/>')}补给点`)
  if (has((survey) => survey.landmarks.some((item) => item.target))) {
    items.push(`${icon('<rect x="4" y="3" width="8" height="10" fill="#f2c230" stroke="#3a2a08"/><circle cx="8" cy="8" r="7" fill="none" stroke="#c0392b" stroke-width="1.4" stroke-dasharray="3 2"/>', 16, 16)}破坏目标`)
  }
  if (has((survey) => survey.secrets.length > 0)) items.push(`${icon('<rect x="2" y="2" width="10" height="10" fill="none" stroke="#2f7fd8" stroke-width="1.3" stroke-dasharray="3 2"/>')}隐藏区`)
  if (has((survey) => survey.pastures.length > 0)) items.push(`${icon('<rect x="2" y="2" width="10" height="10" fill="#7fc97f" fill-opacity=".4" stroke="#2f7a3a" stroke-width="1.2" stroke-dasharray="3 2"/>')}草场`)
  if (tiles.has('wall')) items.push(`${swatch('#5c4636')}墙（3 米）`)
  if (high('bush')) items.push(`${swatch('#d6ac42')}垫高的麦田、长草（上不去）`)
  if (high('floor') || high('path')) items.push(`${swatch('#96aa68')}垫高的草地（上不去）`)
  if (tiles.has('tree')) items.push(`${swatch('#3a7046')}树（5 米）`)
  if (tiles.has('boulder')) items.push(`${swatch('#7d7f8a')}大石头、大草垛（2.5 米）`)
  if (has((survey) => survey.tiles.some((tile, index) => tile === 'crate' && survey.top[index] - survey.floor[index] > 1.5))) items.push(`${swatch('#8a5a2b')}木箱堆（2.5 米，能打碎）`)
  if (tiles.has('fence')) items.push(`${icon('<path d="M0 7H14M7 0V14" stroke="#8a6a45" stroke-width="1.6"/>')}栅栏（0.9 米）`)
  if (tiles.has('water')) items.push(`${swatch('#76b0d6')}水`)
  if (tiles.has('gateClosed') || tiles.has('gate')) items.push(`${swatch('#c0392b')}门`)
  return `<div class="legend">${items.map((item) => `<span>${item}</span>`).join('')}</div>`
}

function percent(value) {
  return `${Math.round(value * 100)}%`
}

function statRows(stats) {
  return [
    ['整张地图', `${stats.columns} × ${stats.rows} 米`, false],
    ['能走的地面', `${stats.open} 平方米`, false],
    ['主路线长度', `${stats.route} 米`, false],
    ['站在起点看得见的地面', percent(stats.share), true],
    ['站在起点看得见的敌人', stats.seen > 0 ? `${stats.seen} / ${stats.enemies} 个，最远 ${Math.round(stats.far)} 米` : `0 / ${stats.enemies} 个`, true],
    ['沿主路走，平均同时看得见的敌人', `${stats.average.toFixed(1)} 个`, true],
    ['沿主路走，同时看得见的敌人最多', `${stats.peak} 个`, true],
    ['沿主路走，四周平均能看多远', `${Math.round(stats.reach)} 米`, true],
    ['惊动一个最多带醒', `${stats.wakeMax} 个`, false],
  ]
}

function problemList(title, problems) {
  if (problems.length === 0) return ''
  return `<ul class="problems">${problems.map((problem) => `<li>${title}：${problem}</li>`).join('')}</ul>`
}

export function singlePage(entry, options = {}) {
  const rows = statRows(entry.stats)
  const table = `<table>${rows.map(([name, value]) => `<tr><th>${name}</th><td>${value}</td></tr>`).join('')}</table>`
  const callouts = (entry.notes ?? []).map((note) => note.at)
  const notes = (entry.notes ?? []).map((note) => `<li><b>${note.name}</b>：${note.text}</li>`).join('')
  const map = renderMap(entry.survey, { cell: options.cell, title: entry.title, callouts })
  return `<html><head><meta charset="utf8">${STYLE}</head><body><div class="wrap">
<h1>${entry.title}</h1>
<div class="sub">按关卡数据画的俯视图，北在上，主角从最下面出发往北走。视线用游戏自己的判定算，眼高 1.5 米。</div>
${table}${problemList('校验', entry.stats.problems)}
<div class="cols"><div class="card">${map}</div>${notes ? `<div class="card"><ol>${notes}</ol></div>` : ''}</div>
${legend([entry.survey])}
</div></body></html>`
}

export function comparePage(before, after, options = {}) {
  const left = statRows(before.stats)
  const right = statRows(after.stats)
  const table =
    `<table><tr><th></th><th>${before.title}</th><th>${after.title}</th></tr>` +
    left.map(([name, value, mark], index) => `<tr><td>${name}</td><td class="${mark ? 'bad' : ''}">${value}</td><td class="${mark ? 'good' : ''}">${right[index][1]}</td></tr>`).join('') +
    '</table>'
  const notes = (after.notes ?? []).map((note) => `<li><b>${note.name}</b>：${note.text}</li>`).join('')
  const widthCells = Math.max(before.survey.columns, after.survey.columns)
  const first = renderMap(before.survey, { cell: options.cell, title: before.title, widthCells: before.survey.columns })
  const second = renderMap(after.survey, { cell: options.cell, title: after.title, callouts: (after.notes ?? []).map((note) => note.at), widthCells: after.survey.columns })
  return `<html><head><meta charset="utf8">${STYLE}</head><body><div class="wrap" data-width="${widthCells}">
<h1>${options.heading ?? `${after.survey.id} 地图：${before.title}和${after.title}（同一比例）`}</h1>
<div class="sub">两张图都是按关卡数据画的俯视图，北在上，主角从最下面出发往北走。视线用游戏自己的判定算，眼高 1.5 米。</div>
${table}${problemList(before.title, before.stats.problems)}${problemList(after.title, after.stats.problems)}
<div class="cols"><div class="card">${first}</div><div class="card">${second}</div>${notes ? `<div class="card"><ol>${notes}</ol></div>` : ''}</div>
${legend([before.survey, after.survey])}
</div></body></html>`
}

export async function snapshot(html, output, scale = 1) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: scale })
    const page = await context.newPage()
    await page.setContent(html)
    const width = await page.evaluate(() => Math.ceil((document.querySelector('.wrap') ?? document.body).getBoundingClientRect().width))
    await page.setViewportSize({ width: Math.max(400, width), height: 900 })
    await page.waitForTimeout(150)
    await page.screenshot({ path: output, fullPage: true })
    await context.close()
  } finally {
    await browser.close().catch(() => {})
  }
  return fs.statSync(output).size
}
