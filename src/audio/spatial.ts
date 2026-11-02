export const SPATIAL = {
  near: 6,
  falloff: 1.4,
  floor: 0.08,
  far: 48,
  panWidth: 0.85,
  behindShare: 0.3,
  behindCut: 1700,
} as const

export interface Listener {
  x: number
  y: number
  yaw: number
}

export interface Placement {
  level: number
  pan: number
  behind: boolean
}

export function placeSound(listener: Listener, x: number, y: number, attenuate = true): Placement {
  const dx = x - listener.x
  const dy = y - listener.y
  const distance = Math.hypot(dx, dy)
  if (attenuate && distance > SPATIAL.far) return { level: 0, pan: 0, behind: false }
  const forward = dx * Math.cos(listener.yaw) + dy * Math.sin(listener.yaw)
  const lateral = -dx * Math.sin(listener.yaw) + dy * Math.cos(listener.yaw)
  const pan = distance > 0.05 ? Math.max(-1, Math.min(1, lateral / distance)) * SPATIAL.panWidth : 0
  const level = attenuate ? Math.max(SPATIAL.floor, 1 / (1 + Math.pow(Math.max(0, distance - 1) / SPATIAL.near, SPATIAL.falloff))) : 1
  return { level, pan, behind: distance > 0.5 && forward < -distance * SPATIAL.behindShare }
}

export function beepGap(distance: number, near = 3, far = 18, fastest = 0.12, slowest = 0.9): number {
  const t = Math.max(0, Math.min(1, (distance - near) / (far - near)))
  return fastest + (slowest - fastest) * t
}
