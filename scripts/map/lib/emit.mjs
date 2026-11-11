const LINE = 118

function quote(text) {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

function key(name) {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : quote(name)
}

function flat(value) {
  if (Array.isArray(value)) return `[${value.map(flat).join(', ')}]`
  if (value && typeof value === 'object') return `{ ${Object.entries(value).map(([name, item]) => `${key(name)}: ${flat(item)}`).join(', ')} }`
  if (typeof value === 'string') return quote(value)
  return JSON.stringify(value)
}

function pretty(value, indent, lead) {
  const single = flat(value)
  if (lead + single.length <= LINE) return single
  const pad = ' '.repeat(indent)
  if (Array.isArray(value)) return `[\n${value.map((item) => `${pad}  ${pretty(item, indent + 2, indent + 2)},\n`).join('')}${pad}]`
  if (value && typeof value === 'object') {
    return `{\n${Object.entries(value)
      .map(([name, item]) => `${pad}  ${key(name)}: ${pretty(item, indent + 2, indent + 4 + name.length)},\n`)
      .join('')}${pad}}`
  }
  return single
}

function uniformDigit(heights) {
  const digit = heights[0]?.charAt(0)
  return digit !== undefined && heights.every((row) => row === digit.repeat(row.length)) ? Number(digit) : null
}

export function emitLevel(level, names = {}) {
  const width = level.areas[0].rows[0].length
  const constant = `LEVEL_${level.id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`
  const out = []
  const body = []
  let usesFlat = false
  level.areas.forEach((area, index) => {
    const name = names[area.name] ?? `AREA_${index + 1}`
    for (const row of area.rows) {
      if (row.length !== width || !row.startsWith('#') || !row.endsWith('#')) throw new Error(`「${area.name}」有一行不是 ${width} 格宽、两头是墙`)
    }
    out.push(`const ${name}_ROWS = walled(`, '  WIDTH,', ...area.rows.map((row) => `  ${quote(row.slice(1, -1))},`), ')', '')
    const digit = area.heights ? uniformDigit(area.heights) : null
    if (area.heights && digit === null) out.push(`const ${name}_HEIGHTS = [`, ...area.heights.map((row) => `  ${quote(row)},`), ']', '')
    body.push('    {')
    for (const [field, value] of Object.entries(area)) {
      if (field === 'rows' || field === 'heights') continue
      body.push(`      ${field}: ${pretty(value, 6, 8 + field.length)},`)
    }
    if (area.heights && digit !== null) {
      usesFlat = true
      body.push(`      heights: flatHeights(${name}_ROWS, ${digit}),`)
    } else if (area.heights) body.push(`      heights: ${name}_HEIGHTS,`)
    body.push(`      rows: ${name}_ROWS,`, '    },')
  })
  const head = [`import { ${usesFlat ? 'flatHeights, ' : ''}walled, type LevelDef } from './types'`, '', `const WIDTH = ${width}`, '']
  const meta = Object.entries(level)
    .filter(([field]) => field !== 'areas')
    .map(([field, value]) => `  ${field}: ${pretty(value, 2, 4 + field.length)},`)
  return `${[...head, ...out, `export const ${constant}: LevelDef = {`, ...meta, '  areas: [', ...body, '  ],', '}'].join('\n')}\n`
}
