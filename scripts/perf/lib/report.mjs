import fs from 'node:fs'
import path from 'node:path'

export const fixed = (value, digits = 1) => (value === null || value === undefined || Number.isNaN(Number(value)) ? '—' : Number(value).toFixed(digits))

export const mb = (bytes, digits = 0) => (bytes === null || bytes === undefined ? '—' : (bytes / 1048576).toFixed(digits))

export const pair = (a, b, digits = 1) => `${fixed(a, digits)} / ${fixed(b, digits)}`

export function median(values) {
  const list = values.filter((value) => typeof value === 'number' && !Number.isNaN(value)).sort((a, b) => a - b)
  if (list.length === 0) return null
  const middle = Math.floor(list.length / 2)
  return list.length % 2 === 1 ? list[middle] : (list[middle - 1] + list[middle]) / 2
}

export function table(headers, rows) {
  const escape = (cell) => String(cell ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const lines = [`| ${headers.map(escape).join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`]
  for (const row of rows) lines.push(`| ${row.map(escape).join(' | ')} |`)
  return lines.join('\n')
}

export function section(title, ...blocks) {
  return [`## ${title}`, ...blocks.filter(Boolean)].join('\n\n')
}

export function writeResult(out, name, data, markdown) {
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(out, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`)
  fs.writeFileSync(path.join(out, `${name}.md`), `${markdown}\n`)
}
