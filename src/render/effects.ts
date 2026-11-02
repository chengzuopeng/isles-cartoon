import * as THREE from 'three'

interface Puff {
  mesh: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>
  age: number
  duration: number
  from: number
  to: number
  base: number
  rise: number
}

export interface Effects {
  puff(
    x: number,
    height: number,
    y: number,
    color: THREE.ColorRepresentation,
    from: number,
    to: number,
    duration: number,
    rise?: number,
  ): void
  burst(x: number, y: number, color: THREE.ColorRepresentation, size?: number): void
  update(dt: number): void
  clear(): void
}

const BURST_OFFSETS = [
  [0, 0.7, 0],
  [0.28, 0.5, 0.12],
  [-0.22, 0.55, 0.2],
  [0.06, 0.95, -0.25],
] as const

const START_OPACITY = 0.9

export function createEffects(scene: THREE.Scene): Effects {
  const geometry = new THREE.IcosahedronGeometry(0.5, 1)
  const active: Puff[] = []
  const idle: Puff[] = []

  const createPuff = (): Puff => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }))
    scene.add(mesh)
    return { mesh, age: 0, duration: 1, from: 1, to: 1, base: 0, rise: 0 }
  }

  const puff: Effects['puff'] = (x, height, y, color, from, to, duration, rise = 0) => {
    const item = idle.pop() ?? createPuff()
    item.mesh.material.color.set(color)
    item.mesh.material.opacity = START_OPACITY
    item.mesh.position.set(x, height, y)
    item.mesh.scale.setScalar(from)
    item.mesh.visible = true
    item.age = 0
    item.duration = duration
    item.from = from
    item.to = to
    item.base = height
    item.rise = rise
    active.push(item)
  }

  return {
    puff,
    burst(x, y, color, size = 1) {
      for (const [dx, height, dy] of BURST_OFFSETS) {
        puff(x + dx * size, height * size, y + dy * size, color, 0.45 * size, 1.4 * size, 0.32)
      }
    },
    update(dt) {
      for (let i = active.length - 1; i >= 0; i--) {
        const item = active[i]
        item.age += dt
        const t = Math.min(1, item.age / item.duration)
        const eased = 1 - (1 - t) ** 3
        item.mesh.scale.setScalar(item.from + (item.to - item.from) * eased)
        if (item.rise !== 0) item.mesh.position.y = item.base + item.rise * (1 - (1 - t) ** 2)
        item.mesh.material.opacity = START_OPACITY * (1 - t)
        if (t < 1) continue
        item.mesh.visible = false
        active.splice(i, 1)
        idle.push(item)
      }
    },
    clear() {
      for (const item of active) {
        item.mesh.visible = false
        idle.push(item)
      }
      active.length = 0
    },
  }
}
