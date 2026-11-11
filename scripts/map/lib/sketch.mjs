const OPEN = new Set(['.', ','])

export class Area {
  constructor(width, { name, theme, depth, base = 0, fill = '#', fillHeight = base, kind, idle, walls }) {
    this.width = width
    this.name = name
    this.theme = theme
    this.depth = depth
    this.base = base
    this.kind = kind
    this.idle = idle
    this.walls = walls
    this.tiles = Array.from({ length: depth }, () => Array(width).fill(fill))
    this.levels = Array.from({ length: depth }, () => Array(width).fill(fillHeight))
    this.extra = {}
  }

  inside(x, y) {
    return x >= 1 && x <= this.width - 2 && y >= 0 && y < this.depth
  }

  at(x, y) {
    return this.inside(x, y) ? this.tiles[y][x] : '#'
  }

  heightAt(x, y) {
    return this.inside(x, y) ? this.levels[y][x] : this.base
  }

  put(x, y, symbol, height) {
    if (!this.inside(x, y)) return this
    this.tiles[y][x] = symbol
    if (height !== undefined) this.levels[y][x] = height
    return this
  }

  box(x0, y0, x1, y1, symbol, height, only) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
        if (!this.inside(x, y)) continue
        if (only && !only.includes(this.tiles[y][x])) continue
        if (symbol !== undefined && symbol !== null) this.tiles[y][x] = symbol
        if (height !== undefined && height !== null) this.levels[y][x] = height
      }
    }
    return this
  }

  carve(x0, y0, x1, y1, height = this.base) {
    return this.box(x0, y0, x1, y1, '.', height)
  }

  wall(x0, y0, x1, y1) {
    return this.box(x0, y0, x1, y1, '#', this.base)
  }

  raise(x0, y0, x1, y1, height) {
    return this.box(x0, y0, x1, y1, null, height)
  }

  ramp(x0, y0, x1, y1, from, to, along = 'y') {
    const length = along === 'y' ? Math.abs(y1 - y0) : Math.abs(x1 - x0)
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
        if (!this.inside(x, y)) continue
        const step = along === 'y' ? Math.abs(y - y0) : Math.abs(x - x0)
        this.levels[y][x] = Math.round(from + ((to - from) * step) / Math.max(1, length))
        if (!OPEN.has(this.tiles[y][x])) this.tiles[y][x] = '.'
      }
    }
    return this
  }

  disc(cx, cy, radius, symbol, height, test) {
    for (let y = Math.floor(cy - radius) - 1; y <= Math.floor(cy + radius) + 1; y++) {
      for (let x = Math.floor(cx - radius) - 1; x <= Math.floor(cx + radius) + 1; x++) {
        if (!this.inside(x, y)) continue
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > radius) continue
        if (test && !test(x, y)) continue
        this.tiles[y][x] = symbol
        if (height !== undefined && height !== null) this.levels[y][x] = height
      }
    }
    return this
  }

  road(points, width = 4, { symbol = ',', clear, dig, limit = 4 } = {}) {
    const half = width / 2
    const level = dig ?? this.base
    for (let index = 1; index < points.length; index++) {
      const [ax, ay] = points[index - 1]
      const [bx, by] = points[index]
      const steps = Math.floor(Math.max(1e-6, Math.hypot(bx - ax, by - ay)) * 4) + 1
      for (let step = 0; step <= steps; step++) {
        const t = step / steps
        const cx = ax + (bx - ax) * t
        const cy = ay + (by - ay) * t
        if (clear !== undefined) this.disc(cx, cy, half + clear, '.', level, (x, y) => this.tiles[y][x] === 'T' || this.tiles[y][x] === '#' || this.levels[y][x] >= this.base + limit)
        this.disc(cx, cy, half, symbol, null, (x, y) => OPEN.has(this.tiles[y][x]) && this.levels[y][x] < this.base + limit)
      }
    }
    return this
  }

  stamp(x, y, lines, height) {
    lines.forEach((line, dy) => {
      for (let dx = 0; dx < line.length; dx++) {
        const symbol = line.charAt(dx)
        if (symbol !== ' ') this.put(x + dx, y + dy, symbol, height)
      }
    })
    return this
  }

  rows() {
    return this.tiles.map((row) => `#${row.slice(1, -1).join('')}#`)
  }

  heights() {
    return this.levels.map((row) => [row[1], ...row.slice(1, -1), row[row.length - 2]].join(''))
  }

  define() {
    const out = { name: this.name, theme: this.theme }
    if (this.kind) out.kind = this.kind
    if (this.walls) out.walls = this.walls
    if (this.idle) out.idle = this.idle
    return { ...out, ...this.extra, heights: this.heights(), rows: this.rows() }
  }
}

export function levelOf(meta, areas) {
  for (const area of areas) {
    for (const row of area.levels) {
      for (const value of row) if (!Number.isInteger(value) || value < 0 || value > 9) throw new Error(`「${area.name}」里有不在 0~9 之间的高度：${value}`)
    }
  }
  return { ...meta, areas: areas.map((area) => area.define()) }
}

export function planText(level) {
  const lines = []
  for (const area of [...level.areas].reverse()) {
    lines.push(`== ${area.name}（${area.rows.length} 行）`)
    area.rows.forEach((row, index) => lines.push(`${String(index).padStart(3)} ${row}   ${area.heights?.[index] ?? ''}`))
  }
  return `${lines.join('\n')}\n`
}
