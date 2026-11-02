import * as THREE from 'three'
import { BOSS_DEFEAT } from './themes'

export interface Bit {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  roll: number
  yaw: number
  tilt: number
  spin: number
  age: number
  life: number
  length: number
  width: number
}

export interface BitPhysics {
  readonly gravity: number
  readonly bounce: number
  readonly friction: number
}

export interface Shot {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  color: THREE.ColorRepresentation
  length: number
  width: number
  life: number
  spin?: number
}

export interface Debris {
  readonly mesh: THREE.InstancedMesh
  readonly live: number
  emit(shot: Shot): void
  update(dt: number): void
  fade(level: number): void
  dispose(): void
}

const REST_SPEED = 0.6
const HALF_TURN = Math.PI

export function stepBit(bit: Bit, dt: number, physics: BitPhysics = BOSS_DEFEAT): Bit {
  if (dt <= 0) return bit
  bit.age += dt
  bit.vy -= physics.gravity * dt
  bit.x += bit.vx * dt
  bit.y += bit.vy * dt
  bit.z += bit.vz * dt
  bit.roll += bit.spin * dt
  bit.tilt += bit.spin * 0.6 * dt
  const floor = bit.width * 0.5
  if (bit.y > floor) return bit
  bit.y = floor
  if (bit.vy < 0) bit.vy = -bit.vy * physics.bounce
  if (bit.vy < REST_SPEED) bit.vy = 0
  const grip = Math.pow(physics.friction, dt * 60)
  bit.vx *= grip
  bit.vz *= grip
  bit.spin *= grip
  const flat = Math.round(bit.tilt / HALF_TURN) * HALF_TURN
  bit.tilt = flat + (bit.tilt - flat) * grip
  return bit
}

export function bitScale(bit: Bit, shrink: number = BOSS_DEFEAT.shrink): number {
  const left = bit.life - bit.age
  if (left <= 0) return 0
  return shrink > 0 && left < shrink ? left / shrink : 1
}

export function createDebris(capacity: number = BOSS_DEFEAT.debris): Debris {
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, flatShading: true })
  const mesh = new THREE.InstancedMesh(geometry, material, capacity)
  mesh.count = 0
  mesh.frustumCulled = false
  mesh.castShadow = false
  mesh.setColorAt(0, new THREE.Color('#ffffff'))
  const bits: Bit[] = []
  const color = new THREE.Color()
  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const turn = new THREE.Quaternion()
  const euler = new THREE.Euler(0, 0, 0, 'YZX')
  let next = 0
  let opacity = 1

  function write(index: number, bit: Bit): void {
    const size = bitScale(bit)
    position.set(bit.x, bit.y, bit.z)
    turn.setFromEuler(euler.set(bit.roll, bit.yaw, bit.tilt, 'YZX'))
    scale.set(bit.length * size, bit.width * size, bit.width * size)
    mesh.setMatrixAt(index, matrix.compose(position, turn, scale))
  }

  return {
    mesh,
    get live() {
      return bits.filter((bit) => bit.age < bit.life).length
    },
    emit(shot) {
      const index = bits.length < capacity ? bits.length : next
      next = (index + 1) % capacity
      const bit: Bit = {
        x: shot.x,
        y: shot.y,
        z: shot.z,
        vx: shot.vx,
        vy: shot.vy,
        vz: shot.vz,
        roll: Math.random() * Math.PI * 2,
        yaw: Math.random() * Math.PI * 2,
        tilt: Math.random() * Math.PI * 2,
        spin: shot.spin ?? 6 + Math.random() * 10,
        age: 0,
        life: shot.life,
        length: shot.length,
        width: shot.width,
      }
      bits[index] = bit
      mesh.count = bits.length
      mesh.setColorAt(index, color.set(shot.color))
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      write(index, bit)
      mesh.instanceMatrix.needsUpdate = true
    },
    update(dt) {
      if (dt <= 0 || bits.length === 0) return
      bits.forEach((bit, index) => {
        if (bit.age >= bit.life) return
        stepBit(bit, dt)
        write(index, bit)
      })
      mesh.instanceMatrix.needsUpdate = true
    },
    fade(level) {
      if (level === opacity) return
      const fading = level < 1
      if (material.transparent !== fading) {
        material.transparent = fading
        material.needsUpdate = true
      }
      material.opacity = level
      opacity = level
    },
    dispose() {
      mesh.removeFromParent()
      mesh.dispose()
      geometry.dispose()
      material.dispose()
    },
  }
}
