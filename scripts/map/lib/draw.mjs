const LEFT = 96
const TOP = 34
const RIGHT = 16
const BOTTOM = 40

const GROUND = {
  floor: [201, 199, 122],
  path: [222, 190, 140],
  bush: [232, 196, 84],
  water: [118, 176, 214],
  wall: [92, 70, 54],
  tree: [58, 112, 70],
  gate: [192, 57, 43],
  gateClosed: [192, 57, 43],
  exit: [63, 174, 106],
  landmark: [176, 84, 62],
  landmarkLow: [176, 140, 110],
}
const HIGH = { floor: [150, 170, 104], bush: [214, 172, 66], path: [150, 170, 104] }
const OBJECTS = new Set(['rock', 'boulder', 'crate', 'cart', 'fence'])
const NO_CONTOUR = new Set(['wall', 'tree', 'landmark'])

export const ENEMY_COLORS = { grunt: '#d8362b', gunner: '#7a3fd0', bomber: '#e07a10', thrower: '#1f8a8a', shield: '#3a5fb0', turret: '#555555' }
export const ENEMY_NAMES = { grunt: '冲锋兵', gunner: '射手', bomber: '自爆兵', thrower: '投弹兵', shield: '盾兵', turret: '炮台' }
export const CHEST_COLORS = { normal: '#f2c230', rare: '#58b7ff', weapon: '#ff7ad1' }

const LABELS = {
  'ch1-town-gate': '镇门',
  'ch1-field-tool-shed': '农具棚',
  'ch1-windmill': '风车',
  'ch1-barn': '谷仓',
  'ch1-star-altar': '星石台',
  'ch1-sheep-pen': '羊圈',
  'ch1-feed-shed': '饲料棚',
  'ch1-repair-workshop': '修车屋',
  'ch1-weighhouse': '地磅房',
  'ch1-hay-cart': '车',
  'ch1-dock': '码头',
  'ch1-watermill': '水车磨坊',
}

function shade(color, height) {
  const lift = Math.min(height, 5) * 0.045
  return color.map((value) => Math.round(value + (255 - value) * lift))
}

function hex(color) {
  return `#${color.map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

function groundFill(kind, height, reached) {
  if (OBJECTS.has(kind)) return hex(shade(GROUND.floor, height))
  if (!reached && HIGH[kind]) return hex(HIGH[kind])
  const color = GROUND[kind] ?? GROUND.floor
  return kind === 'floor' || kind === 'path' || kind === 'bush' ? hex(shade(color, height)) : hex(color)
}

function fixed(value) {
  return Number(value.toFixed(1))
}

export function enemyMark(kind, idle, x, y) {
  const color = ENEMY_COLORS[kind] ?? ENEMY_COLORS.grunt
  if (idle === 'ambush') return `<circle cx="${x}" cy="${y}" r="3.4" fill="#fff" stroke="${color}" stroke-width="1.8"/>`
  if (kind === 'gunner') return `<path d="M${x} ${y - 4.4}l4.4 4.4l-4.4 4.4l-4.4 -4.4z" fill="${color}" stroke="#1a0a2a" stroke-width="0.9"/>`
  if (kind === 'bomber') return `<circle cx="${x}" cy="${y}" r="3.6" fill="${color}" stroke="#3a1a00" stroke-width="0.9"/><path d="M${x} ${y - 3.6}v-2.6" stroke="#3a1a00" stroke-width="1.1"/>`
  return `<circle cx="${x}" cy="${y}" r="3.6" fill="${color}" stroke="#3a0a06" stroke-width="0.9"/>`
}

export function renderMap(survey, options = {}) {
  const cell = options.cell ?? 8
  const title = options.title ?? survey.title
  const callouts = options.callouts ?? []
  const { columns, rows, tiles, floor, top, reach } = survey
  const wide = (options.widthCells ?? columns) * cell
  const totalWidth = LEFT + wide + RIGHT
  const totalHeight = TOP + rows * cell + BOTTOM
  const ox = LEFT + (wide - columns * cell) / 2
  const oy = TOP
  const out = []
  const add = (text) => out.push(text)

  add(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}" font-family="-apple-system, PingFang SC, Helvetica, sans-serif">`)
  add(`<rect width="${totalWidth}" height="${totalHeight}" fill="#f6f1e4"/>`)
  add(`<text x="${LEFT}" y="22" font-size="15" font-weight="700" fill="#2b2118">${title}</text>`)
  add(`<g transform="translate(${ox},${oy})">`)

  add('<g shape-rendering="crispEdges">')
  for (let row = 0; row < rows; row++) {
    let start = 0
    let last = null
    for (let column = 0; column <= columns; column++) {
      const index = row * columns + column
      const fill = column < columns ? groundFill(tiles[index], floor[index], reach[index] === 1) : null
      if (fill === last) continue
      if (last !== null) add(`<rect x="${start * cell}" y="${row * cell}" width="${(column - start) * cell}" height="${cell}" fill="${last}"/>`)
      start = column
      last = fill
    }
  }
  add('</g>')

  add('<g>')
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const index = row * columns + column
      const kind = tiles[index]
      const x = column * cell
      const y = row * cell
      const cx = x + cell / 2
      const cy = y + cell / 2
      if (kind === 'tree') add(`<circle cx="${cx}" cy="${cy}" r="${cell * 0.46}" fill="#2f6a3e"/><circle cx="${cx - 1}" cy="${cy - 1}" r="${cell * 0.22}" fill="#4f9a5e"/>`)
      else if (kind === 'boulder') add(`<rect x="${x + 0.5}" y="${y + 0.5}" width="${cell - 1}" height="${cell - 1}" rx="2.5" fill="#7d7f8a" stroke="#4a4b55" stroke-width="0.8"/>`)
      else if (kind === 'rock') add(`<circle cx="${cx}" cy="${cy}" r="${cell * 0.3}" fill="#a9abb3" stroke="#6c6e78" stroke-width="0.6"/>`)
      else if (kind === 'crate') {
        const tall = top[index] - floor[index] > 1.5
        add(`<rect x="${x + 1}" y="${y + 1}" width="${cell - 2}" height="${cell - 2}" fill="${tall ? '#8a5a2b' : '#c08a4a'}" stroke="#5e3d1c" stroke-width="0.7"/>`)
        if (tall) add(`<path d="M${x + 1} ${y + 1}l${cell - 2} ${cell - 2}M${x + cell - 1} ${y + 1}l${2 - cell} ${cell - 2}" stroke="#5e3d1c" stroke-width="0.6"/>`)
      } else if (kind === 'cart') add(`<rect x="${x + 0.8}" y="${y + 1.6}" width="${cell - 1.6}" height="${cell - 3.2}" fill="#9a6a3a" stroke="#5e3d1c" stroke-width="0.7"/>`)
      else if (kind === 'fence') add(`<path d="M${x} ${cy}H${x + cell}M${cx} ${y}V${y + cell}" stroke="#8a6a45" stroke-width="1.3" opacity="0.9"/>`)
      else if (kind === 'bush' && reach[index] !== 1) {
        if ((column + row) % 2 === 0) add(`<path d="M${x + 2} ${y + 6}v-3M${x + 5} ${y + 5.5}v-3.5" stroke="#a87a14" stroke-width="0.8"/>`)
      } else if (kind === 'bush') add(`<path d="M${x + 2} ${y + 6}v-3M${x + 4} ${y + 6.5}v-4.5M${x + 6} ${y + 6}v-3" stroke="#b98a1e" stroke-width="0.8"/>`)
      else if (kind === 'water') add(`<path d="M${x + 1} ${cy}q1.5 -1.5 3 0t3 0" stroke="#e8f4fb" stroke-width="0.7" fill="none"/>`)
    }
  }
  add('</g>')

  add('<g stroke-linecap="square">')
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const index = row * columns + column
      for (const [dc, dr] of [[1, 0], [0, 1]]) {
        const nc = column + dc
        const nr = row + dr
        if (nc >= columns || nr >= rows) continue
        const other = nr * columns + nc
        const diff = Math.abs(floor[index] - floor[other])
        if (diff < 0.01 || NO_CONTOUR.has(tiles[index]) || NO_CONTOUR.has(tiles[other])) continue
        const steep = diff > 0.51
        const stroke = `stroke="${steep ? '#5a4a2a' : '#9a8a5a'}" stroke-width="${steep ? 1.4 : 0.6}"`
        if (dc === 1) add(`<path d="M${nc * cell} ${row * cell}V${(row + 1) * cell}" ${stroke}/>`)
        else add(`<path d="M${column * cell} ${nr * cell}H${(column + 1) * cell}" ${stroke}/>`)
      }
    }
  }
  add('</g>')

  add('<g>')
  for (const item of survey.pastures) {
    add(`<rect x="${item.column * cell}" y="${item.row * cell}" width="${item.width * cell}" height="${item.depth * cell}" fill="#7fc97f" fill-opacity="0.28" stroke="#2f7a3a" stroke-width="1.2" stroke-dasharray="4 3"/>`)
  }
  for (const item of survey.landmarks) {
    const x = item.column * cell
    const y = item.row * cell
    const w = item.width * cell
    const h = item.depth * cell
    if (item.width * item.depth === 1) {
      add(`<circle cx="${x + cell / 2}" cy="${y + cell / 2}" r="1.6" fill="#f4d35e" stroke="#8a6a12" stroke-width="0.5"/>`)
      continue
    }
    if (item.target) add(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#f2c230" stroke="#3a2a08" stroke-width="1.4"/><circle cx="${x + w / 2}" cy="${y + h / 2}" r="${Math.max(w, h) / 2 + 4}" fill="none" stroke="#c0392b" stroke-width="1.6" stroke-dasharray="3 2"/>`)
    else if (item.solid) add(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#b5533c" fill-opacity="0.55" stroke="#6e2a1a" stroke-width="1.4"/>`)
    else add(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#c9a26a" fill-opacity="0.45" stroke="#6e4a1a" stroke-width="1" stroke-dasharray="3 2"/>`)
    if (item.width * item.depth < 6) continue
    const label = LABELS[item.id] ?? item.name
    const dark = item.target
    add(`<text x="${x + w / 2}" y="${y + h / 2 + 4}" font-size="${label.length > 3 ? 10 : 11}" font-weight="700" text-anchor="middle" fill="${dark ? '#3a2a08' : '#fff'}" stroke="${dark ? '#fff' : '#3a1408'}" stroke-width="2.4" paint-order="stroke">${label}</text>`)
  }
  add('</g>')

  add('<g shape-rendering="crispEdges">')
  survey.spawnView.seen.forEach((line, row) => {
    let start = -1
    for (let column = 0; column <= columns; column++) {
      const on = line.charAt(column) === '1'
      if (on && start < 0) start = column
      if (!on && start >= 0) {
        add(`<rect x="${start * cell}" y="${row * cell}" width="${(column - start) * cell}" height="${cell}" fill="#ff3d2e" fill-opacity="0.38"/>`)
        start = -1
      }
    }
  })
  add('</g>')

  if (survey.route.length > 1) {
    const points = survey.route.map(([x, y]) => `${fixed(x * cell)},${fixed(y * cell)}`).join(' ')
    add('<g fill="none" stroke-linejoin="round" stroke-linecap="round">')
    add(`<polyline points="${points}" stroke="#ffffff" stroke-width="3.6" opacity="0.9"/>`)
    add(`<polyline points="${points}" stroke="#1d5fd1" stroke-width="1.8" stroke-dasharray="5 4"/>`)
    add('</g>')
  }

  add('<g>')
  for (const rush of survey.rushes) {
    for (const point of rush.points) add(`<path d="M${point.x * cell} ${point.y * cell + 4}l-3.5 -6h7z" fill="#ff9d1c" stroke="#7a3b00" stroke-width="0.8"/>`)
  }
  for (const point of survey.summonPoints) add(`<circle cx="${point.x * cell}" cy="${point.y * cell}" r="3" fill="none" stroke="#ff6a3d" stroke-width="1.2" stroke-dasharray="2 1.5"/>`)
  for (const chest of survey.chests) {
    const x = chest.x * cell
    const y = chest.y * cell
    add(`<rect x="${x - 4}" y="${y - 3.5}" width="8" height="7" rx="1" fill="${CHEST_COLORS[chest.tier] ?? CHEST_COLORS.normal}" stroke="#3a2a08" stroke-width="1.1"/><path d="M${x - 4} ${y - 0.5}h8" stroke="#3a2a08" stroke-width="0.9"/>`)
  }
  for (const supply of survey.supplies) add(`<path d="M${supply.x * cell} ${supply.y * cell - 5}q4 4 0 9q-4 -5 0 -9z" fill="#ff7a1f" stroke="#7a2a00" stroke-width="0.9"/>`)
  for (const secret of survey.secrets) {
    add(`<rect x="${secret.column * cell}" y="${secret.row * cell}" width="${secret.width * cell}" height="${secret.depth * cell}" fill="none" stroke="#2f7fd8" stroke-width="1.3" stroke-dasharray="3 2"/>`)
  }
  const seen = new Set(survey.spawnView.enemies.map((item) => item.index))
  survey.enemies.forEach((enemy, index) => {
    const x = fixed(enemy.x * cell)
    const y = fixed(enemy.y * cell)
    const color = ENEMY_COLORS[enemy.kind] ?? ENEMY_COLORS.grunt
    if (enemy.route.length > 0) {
      const points = [{ x: enemy.x, y: enemy.y }, ...enemy.route].map((point) => `${fixed(point.x * cell)},${fixed(point.y * cell)}`).join(' ')
      add(`<polyline points="${points}" fill="none" stroke="${color}" stroke-width="1" stroke-dasharray="2 2"/>`)
    }
    if (seen.has(index)) add(`<circle cx="${x}" cy="${y}" r="6.3" fill="none" stroke="#ff2a1a" stroke-width="1.6"/>`)
    add(enemyMark(enemy.kind, enemy.idle, x, y))
  })
  if (survey.boss) {
    const x = survey.boss.x * cell
    const y = survey.boss.y * cell
    const star = Array.from({ length: 10 }, (_, i) => {
      const angle = -Math.PI / 2 + (i * Math.PI) / 5
      const radius = i % 2 === 0 ? 9 : 4
      return `${fixed(x + Math.cos(angle) * radius)},${fixed(y + Math.sin(angle) * radius)}`
    }).join(' ')
    add(`<polygon points="${star}" fill="#b3122a" stroke="#2a0408" stroke-width="1.2"/>`)
    add(`<text x="${x + 12}" y="${y + 4}" font-size="11" font-weight="700" fill="#2a0408" stroke="#fff" stroke-width="2.4" paint-order="stroke">Boss</text>`)
  }
  const sx = survey.start.x * cell
  const sy = survey.start.y * cell
  add(`<path d="M${sx} ${sy - 7}l6 12h-12z" fill="#1d7bff" stroke="#fff" stroke-width="1.6"/>`)
  add(`<text x="${sx + 10}" y="${sy + 4}" font-size="11" font-weight="700" fill="#0b3a8a" stroke="#fff" stroke-width="2.6" paint-order="stroke">起点</text>`)
  add('</g>')

  add('<g>')
  callouts.forEach(([cx, cy], index) => {
    const x = cx * cell
    const y = cy * cell
    add(`<circle cx="${x}" cy="${y}" r="8" fill="#1f1a14" stroke="#fff" stroke-width="1.6"/><text x="${x}" y="${y + 4}" font-size="11" font-weight="700" text-anchor="middle" fill="#fff">${index + 1}</text>`)
  })
  add('</g>')

  add(`<rect x="0" y="0" width="${columns * cell}" height="${rows * cell}" fill="none" stroke="#2b2118" stroke-width="1.5"/>`)
  add('</g>')

  add('<g>')
  for (const area of survey.areas) {
    const y0 = oy + area.top * cell
    const y1 = oy + area.bottom * cell
    const mid = (y0 + y1) / 2
    add(`<path d="M${LEFT - 8} ${y0 + 2}h-6V${y1 - 2}h6" fill="none" stroke="#6a5a48" stroke-width="1.3"/>`)
    add(`<text x="${LEFT - 20}" y="${mid - 2}" font-size="12.5" font-weight="700" text-anchor="end" fill="#2b2118">${area.name}</text>`)
    add(`<text x="${LEFT - 20}" y="${mid + 13}" font-size="10.5" text-anchor="end" fill="#6a5a48">${area.bottom - area.top} 米</text>`)
    if (area.top > 0) add(`<path d="M${ox} ${y0}H${ox + columns * cell}" stroke="#2b2118" stroke-width="1" stroke-dasharray="6 4" opacity="0.55"/>`)
  }
  add('</g>')

  const by = TOP + rows * cell + 16
  add(`<path d="M${ox} ${by}h${10 * cell}M${ox} ${by - 4}v8M${ox + 10 * cell} ${by - 4}v8" stroke="#2b2118" stroke-width="1.4" fill="none"/>`)
  add(`<text x="${ox + 10 * cell + 6}" y="${by + 4}" font-size="11" fill="#2b2118">10 米　整张 ${columns} × ${rows} 米</text>`)
  const nx = ox + columns * cell - 12
  add(`<path d="M${nx} ${by + 8}v-16m-4 5l4 -6l4 6" stroke="#2b2118" stroke-width="1.4" fill="none"/><text x="${nx - 16}" y="${by + 5}" font-size="11" fill="#2b2118">北</text>`)
  add('</svg>')
  return out.join('\n')
}
