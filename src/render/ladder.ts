import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { BuiltLevel } from '../sim/level'
import type { ModelLibrary } from './model-library'
import { LADDER } from './themes'

export interface LadderPose {
  foot: { x: number; y: number }
  top: { x: number; y: number }
  height: number
  yaw: number
  pitch: number
  length: number
  toward: { x: number; y: number }
}

export const LADDER_MODEL = 'ch1-ladder'

export interface Ladders {
  readonly group: THREE.Group
  readonly count: number
  dispose(): void
}

export function ladderPose(cell: { x: number; y: number }, perch: { x: number; y: number; height: number }, rule: typeof LADDER = LADDER): LadderPose {
  const dx = perch.x - cell.x
  const dy = perch.y - cell.y
  const alongX = Math.abs(dx) >= Math.abs(dy)
  const stepX = alongX ? Math.sign(dx) || 1 : 0
  const stepY = alongX ? 0 : Math.sign(dy) || 1
  const top = { x: cell.x + stepX * (0.5 - rule.inset), y: cell.y + stepY * (0.5 - rule.inset) }
  const run = perch.height / Math.tan(rule.angle)
  const foot = { x: top.x - stepX * run, y: top.y - stepY * run }
  return {
    foot,
    top,
    height: perch.height,
    yaw: Math.atan2(stepY, stepX),
    pitch: rule.angle,
    length: Math.hypot(run, perch.height) + rule.lip,
    toward: { x: stepX, y: stepY },
  }
}

export function ladderModelYaw(toward: { x: number; y: number }): number {
  return Math.atan2(toward.y, -toward.x)
}

export function ladderGeometry(length: number, rule: typeof LADDER = LADDER): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = []
  for (const side of [-1, 1]) {
    pieces.push(new THREE.BoxGeometry(rule.rail, length, rule.rail).translate(0, length / 2, (side * rule.width) / 2))
  }
  const rungs = Math.floor((length - rule.gap * 0.5) / rule.gap)
  for (let i = 1; i <= rungs; i++) {
    pieces.push(new THREE.BoxGeometry(rule.rung, rule.rung, rule.width).translate(0, i * rule.gap, 0))
  }
  const merged = mergeGeometries(pieces, false)
  for (const piece of pieces) piece.dispose()
  return merged ?? new THREE.BoxGeometry(rule.rail, length, rule.width)
}

export function createLadders(level: BuiltLevel, models: ModelLibrary): Ladders {
  const group = new THREE.Group()
  const owned: { dispose(): void }[] = []
  const perched = level.chests.filter((chest) => chest.perch !== null)
  let material: THREE.MeshStandardMaterial | null = null
  for (const chest of perched) {
    const perch = chest.perch
    if (!perch) continue
    const pose = ladderPose({ x: chest.x, y: chest.y }, perch)
    if (models.has(LADDER_MODEL)) {
      const model = models.shared(LADDER_MODEL)
      model.root.position.set(chest.x, 0, chest.y)
      model.root.rotation.y = ladderModelYaw(pose.toward)
      group.add(model.root)
      continue
    }
    material ??= new THREE.MeshStandardMaterial({ color: LADDER.color, roughness: 0.85 })
    const geometry = ladderGeometry(pose.length)
    owned.push(geometry)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = true
    const holder = new THREE.Group()
    holder.position.set(pose.foot.x, 0, pose.foot.y)
    holder.rotation.set(0, -pose.yaw, 0)
    mesh.rotation.z = -(Math.PI / 2 - pose.pitch)
    holder.add(mesh)
    group.add(holder)
  }
  if (material) owned.push(material)
  return {
    group,
    count: perched.length,
    dispose() {
      group.clear()
      for (const item of owned) item.dispose()
    },
  }
}
