import type * as THREE from 'three'
import type { WeaponId } from '../data/weapons'

export interface MuzzleSource {
  muzzle(out: THREE.Vector3): THREE.Vector3 | null
}

const sources = new WeakMap<THREE.Object3D, MuzzleSource>()
const launchers = new WeakMap<THREE.Object3D, Map<WeaponId, MuzzleSource>>()

export function shareMuzzle(scene: THREE.Object3D, source: MuzzleSource): void {
  sources.set(scene, source)
}

export function muzzleSource(scene: THREE.Object3D): MuzzleSource | null {
  return sources.get(scene) ?? null
}

export function shareLauncher(scene: THREE.Object3D, weapon: WeaponId, source: MuzzleSource): void {
  let map = launchers.get(scene)
  if (!map) {
    map = new Map()
    launchers.set(scene, map)
  }
  map.set(weapon, source)
}

export function dropLauncher(scene: THREE.Object3D, weapon: WeaponId, source: MuzzleSource): void {
  const map = launchers.get(scene)
  if (map?.get(weapon) === source) map.delete(weapon)
}

export function launcherSource(scene: THREE.Object3D, weapon: WeaponId): MuzzleSource | null {
  return launchers.get(scene)?.get(weapon) ?? null
}
