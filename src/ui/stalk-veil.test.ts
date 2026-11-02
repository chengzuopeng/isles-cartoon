import { describe, expect, it } from 'vitest'
import { stalkVeilSvg } from './stalk-veil'

describe('stalk veil', () => {
  it('draws the same stalks every time, an inked stem and a head for each', () => {
    const svg = stalkVeilSvg(800, 450, 10, 3)
    expect(svg).toBe(stalkVeilSvg(800, 450, 10, 3))
    expect(svg.match(/<path /g)).toHaveLength(20)
    expect(svg.match(/<ellipse /g)).toHaveLength(10)
    expect(svg.startsWith('<svg')).toBe(true)
  })
})
