import { propHash } from './prop-motion'
import { WRECK } from './themes'

export interface WreckSeed {
  x: number
  y: number
  z: number
  rest: number
  heavy: boolean
}

export interface WreckPiece {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  ax: number
  ay: number
  az: number
  spin: number
  angle: number
  rest: number
  age: number
}

export type Ground = (x: number, z: number) => number

export function launchWreck(parts: readonly WreckSeed[], origin: { x: number; z: number }, dirX: number, dirZ: number, seed: number): WreckPiece[] {
  const push = Math.hypot(dirX, dirZ)
  const hx = push > 1e-6 ? dirX / push : 0
  const hz = push > 1e-6 ? dirZ / push : 0
  return parts.map((part, i) => {
    const roll = (k: number) => propHash(seed + i * 13.7, k * 7.3)
    const jitter = (k: number) => 1 + (roll(k) - 0.5) * 2 * WRECK.jitter
    const ox = part.x - origin.x
    const oz = part.z - origin.z
    const out = Math.hypot(ox, oz)
    const heading = out > 0.05 ? Math.atan2(oz, ox) : roll(1) * Math.PI * 2
    const along = (part.heavy ? WRECK.pushHeavy : WRECK.push) * jitter(2)
    const spread = (part.heavy ? WRECK.spreadHeavy : WRECK.spread) * jitter(3)
    const axis = { x: roll(4) - 0.5, y: roll(5) - 0.5, z: roll(6) - 0.5 }
    const size = Math.hypot(axis.x, axis.y, axis.z) || 1
    return {
      x: part.x,
      y: part.y,
      z: part.z,
      vx: hx * along + Math.cos(heading) * spread,
      vy: (part.heavy ? WRECK.liftHeavy : WRECK.lift) * jitter(7),
      vz: hz * along + Math.sin(heading) * spread,
      ax: axis.x / size,
      ay: axis.y / size,
      az: axis.z / size,
      spin: (part.heavy ? WRECK.spinHeavy : WRECK.spin) * jitter(8) * (roll(9) < 0.5 ? -1 : 1),
      angle: 0,
      rest: Math.max(WRECK.minRest, part.rest),
      age: 0,
    }
  })
}

export function stepWreck(piece: WreckPiece, dt: number, ground: Ground): WreckPiece {
  if (dt <= 0) return piece
  piece.age += dt
  piece.vy -= WRECK.gravity * dt
  const nx = piece.x + piece.vx * dt
  const nz = piece.z + piece.vz * dt
  if (ground(nx, nz) > piece.y - piece.rest + WRECK.climb) {
    piece.vx *= -WRECK.wallBounce
    piece.vz *= -WRECK.wallBounce
  } else {
    piece.x = nx
    piece.z = nz
  }
  piece.y += piece.vy * dt
  piece.angle += piece.spin * dt
  const floor = ground(piece.x, piece.z) + piece.rest
  if (piece.y > floor) return piece
  piece.y = floor
  if (piece.vy < 0) piece.vy = -piece.vy * WRECK.bounce
  if (piece.vy < WRECK.restSpeed) piece.vy = 0
  const grip = Math.pow(WRECK.friction, dt * 60)
  piece.vx *= grip
  piece.vz *= grip
  piece.spin *= grip
  return piece
}

export function wreckFade(piece: WreckPiece): number {
  const start = WRECK.life - WRECK.sink
  if (piece.age <= start) return 0
  return Math.min(1, (piece.age - start) / WRECK.sink)
}

export function wreckFlash(age: number): number {
  return age >= WRECK.flash ? 0 : 1 - age / WRECK.flash
}
