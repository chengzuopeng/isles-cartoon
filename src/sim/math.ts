export interface Vec2 {
  x: number
  y: number
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

export function decay(vector: Vec2, rate: number, dt: number): void {
  const factor = Math.exp(-rate * dt)
  vector.x *= factor
  vector.y *= factor
}

export interface Vec3 {
  x: number
  y: number
  z: number
}
