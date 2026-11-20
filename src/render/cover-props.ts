import * as THREE from 'three'
import type { CoverDef } from '../data/levels/types'
import { Mesher } from './buildings'
import { lineTexture, type LineTextureKind } from './line-textures'
import type { NodePart } from './node-parts'
import { toonMaterial } from './toon'

function box(mesh: Mesher, x: number, y: number, z: number, width: number, height: number, depth: number): void {
  mesh.box(new THREE.Vector3(x, y, z), new THREE.Vector3(x + width, y + height, z + depth))
}

function sack(mesh: Mesher, y: number, height: number, shift: number): void {
  const ring = (at: number, width: number, depth: number) => {
    const blunt = 0.14
    return [
      [-width, -depth + blunt], [-width, depth - blunt], [-width + blunt, depth], [width - blunt, depth],
      [width, depth - blunt], [width, -depth + blunt], [width - blunt, -depth], [-width + blunt, -depth],
    ].map(([x, z]) => new THREE.Vector3(x + shift, at, z))
  }
  const rings = [
    ring(y, 0.4, 0.39),
    ring(y + height * 0.28, 0.48, 0.5),
    ring(y + height * 0.74, 0.48, 0.49),
    ring(y + height, 0.39, 0.38),
  ]
  const u = (p: THREE.Vector3) => p.x + p.z
  const v = (p: THREE.Vector3) => p.y
  for (let r = 0; r < rings.length - 1; r++) {
    const bottom = rings[r]
    const top = rings[r + 1]
    for (let i = 0; i < bottom.length; i++) {
      const j = (i + 1) % bottom.length
      const normal = bottom[j].clone().sub(bottom[i]).cross(top[i].clone().sub(bottom[i])).normalize()
      mesh.face([bottom[i], bottom[j], top[j], top[i]], normal, u, v)
    }
  }
  const top = rings[rings.length - 1]
  const center = new THREE.Vector3(shift, y + height, 0)
  const up = new THREE.Vector3(0, 1, 0)
  for (let i = 0; i < top.length; i++) mesh.face([top[i], top[(i + 1) % top.length], center], up, (p) => p.x, (p) => p.z)
}

export function buildCover(style: CoverDef['style'], height: number, length: number): NodePart[] {
  const parts: NodePart[] = []
  const add = (mesh: Mesher, color: string, texture?: LineTextureKind) => {
    parts.push({ geometry: mesh.build(), material: toonMaterial({ color, map: texture ? lineTexture(texture) : null }) })
  }
  const body = new Mesher(0.65)
  const trim = new Mesher(0.65)
  const left = -length / 2
  if (style === 'water-trough' || style === 'feed-trough') {
    const water = style === 'water-trough'
    // Recessed basin with a continuous, standable rim.
    box(body, left + 0.075, 0.17, -0.445, length - 0.15, height - 0.35, 0.89)
    for (const side of [-0.5, 0.35]) box(body, left, height - 0.38, side, length, 0.38, 0.15)
    for (const end of [left, -left - 0.16]) box(body, end, height - 0.38, -0.35, 0.16, 0.38, 0.7)
    for (const end of [left + 0.14, -left - 0.4]) box(trim, end, -0.13, -0.43, 0.26, 0.58, 0.86)
    const bed = new Mesher(0.6)
    box(bed, left + 0.16, height - 0.21, -0.35, length - 0.32, 0.13, 0.7)
    add(body, water ? '#938778' : '#a3774d', water ? 'stone' : 'wood')
    add(trim, '#78614c', 'wood')
    add(bed, water ? '#60a9a4' : '#9b8d4c', water ? undefined : 'stubble')
  } else if (style === 'sleepers') {
    const course = height / 3
    for (let layer = 0; layer < 3; layer++) {
      box(body, left, course * layer - 0.012, -0.48 + (layer % 2) * 0.03, length, course + 0.012, 0.96 - (layer % 2) * 0.03)
    }
    for (const x of [left * 0.62, -left * 0.62]) box(trim, x - 0.05, -0.04, -0.496, 0.1, height + 0.043, 0.992)
    add(body, '#8f6441', 'wood')
    add(trim, '#645e4c', 'metal')
  } else if (style === 'sacks') {
    const course = height / 3
    sack(body, -0.08, course + 0.09, -0.01)
    sack(trim, course - 0.015, course + 0.035, 0.01)
    sack(body, 2 * course - 0.025, course + 0.025, -0.01)
    add(body, '#c9ad83', 'dirt')
    add(trim, '#b3916d', 'dirt')
  } else {
    const courses = height > 2 ? 3 : 2
    const course = height / courses
    for (let layer = 0; layer < courses; layer++) {
      const inset = layer % 2 === 0 ? 0.005 : 0.026
      const bottom = layer === 0 ? -0.14 : layer * course + 0.014
      const top = (layer + 1) * course
      box(body, -0.5 + inset, bottom, -0.5 + inset, 1 - 2 * inset, top - bottom, 1 - 2 * inset)
      for (const x of [-0.23, 0.23]) box(trim, x - 0.026, bottom, -0.504 + inset, 0.052, top - bottom + 0.004, 1.008 - 2 * inset)
    }
    add(body, '#d4aa55', 'stubble')
    add(trim, '#8e6338')
  }
  return parts
}
