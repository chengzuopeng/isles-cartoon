import * as THREE from 'three'
import type { World } from '../sim/world'
import { assetUrl } from './asset-urls'

export const BAIT_LOOK = { size: 0.55, arc: 2.2, bob: 0.06, spin: 2 } as const

export interface BaitViews {
  update(world: World, time: number): void
  clear(): void
}

export function createBaitViews(scene: THREE.Scene): BaitViews {
  const texture = new THREE.TextureLoader().load(assetUrl.item('food-bread'))
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
  const sprites = new Map<number, THREE.Sprite>()
  return {
    update(world, time) {
      const alive = new Set<number>()
      for (const bait of world.baits) {
        alive.add(bait.id)
        let sprite = sprites.get(bait.id)
        if (!sprite) {
          sprite = new THREE.Sprite(material)
          sprite.scale.setScalar(BAIT_LOOK.size)
          scene.add(sprite)
          sprites.set(bait.id, sprite)
        }
        const t = bait.flight > 0 ? 1 - bait.flight / Math.max(0.01, bait.total) : 1
        const x = bait.from.x + (bait.pos.x - bait.from.x) * t
        const y = bait.from.y + (bait.pos.y - bait.from.y) * t
        const lift = bait.flight > 0 ? 4 * BAIT_LOOK.arc * t * (1 - t) + (1 - t) * 1.2 : 0.3 + Math.sin(time * 4 + bait.id) * BAIT_LOOK.bob
        sprite.position.set(x, bait.z + lift, y)
        sprite.material.rotation = bait.flight > 0 ? time * BAIT_LOOK.spin * 6 : 0
      }
      for (const [id, sprite] of sprites) {
        if (alive.has(id)) continue
        sprite.removeFromParent()
        sprites.delete(id)
      }
    },
    clear() {
      for (const sprite of sprites.values()) sprite.removeFromParent()
      sprites.clear()
    },
  }
}
