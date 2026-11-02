import * as THREE from 'three'
import type { Effects } from './effects'
import { lampLook, type LampLook } from './fog-motion'
import { glowSprite, groundGlow } from './glow-textures'
import { socketWorld, type ModelInstance } from './model-library'
import { LAMP_GLOW } from './themes'

export interface LampRig {
  readonly light: THREE.Vector3
  sync(lit: boolean, fresh: boolean, clock: number): void
  dispose(): void
}

export interface LampParts {
  glow: THREE.Texture
  ring: THREE.RingGeometry
}

export function createLampRig(
  model: ModelInstance,
  rule: { node: string; glass: string; light: string },
  group: THREE.Group,
  parts: LampParts,
  reach: number,
  effects: Effects | null,
): LampRig {
  const glass = model.materials.filter(
    (material): material is THREE.MeshStandardMaterial => material instanceof THREE.MeshStandardMaterial && material.name === rule.glass,
  )
  for (const material of glass) {
    material.emissive.set(LAMP_GLOW.emissive)
    material.emissiveIntensity = 0
  }
  model.root.updateWorldMatrix(true, true)
  const socket = model.nodes.get(rule.light) ?? model.nodes.get(rule.node) ?? null
  const light = socket ? socketWorld(socket, new THREE.Vector3()) : model.root.getWorldPosition(new THREE.Vector3()).setY(1.6)
  const halo = glowSprite(parts.glow, LAMP_GLOW.halo, LAMP_GLOW.haloSize)
  halo.position.copy(light)
  halo.visible = false
  const pool = groundGlow(parts.glow, LAMP_GLOW.pool, LAMP_GLOW.poolRadius, 0.05)
  pool.position.set(light.x, 0.05, light.z)
  pool.visible = false
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: LAMP_GLOW.ring,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  })
  const ring = new THREE.Mesh(parts.ring, ringMaterial)
  ring.rotation.x = -Math.PI / 2
  ring.position.set(light.x, LAMP_GLOW.ringHeight, light.z)
  ring.visible = false
  ring.castShadow = false
  group.add(halo, pool, ring)
  const look: LampLook = { glow: 0, flash: 0, ring: 0, ringOpacity: 0 }
  let litAt: number | null = null

  return {
    light,
    sync(lit, fresh, clock) {
      if (!lit) litAt = null
      else if (litAt === null) {
        litAt = fresh ? -Infinity : clock
        if (!fresh) {
          for (let i = 0; i < LAMP_GLOW.motes; i++) {
            const angle = (i / LAMP_GLOW.motes) * Math.PI * 2
            effects?.puff(light.x + Math.cos(angle) * 0.35, light.y, light.z + Math.sin(angle) * 0.35, LAMP_GLOW.halo, 0.08, 0.02, 0.8 + Math.random() * 0.4, 0.9 + Math.random() * 0.6)
          }
        }
      }
      const since = litAt === null ? -1 : litAt === -Infinity ? 1e3 : clock - litAt
      lampLook(since, clock, reach, LAMP_GLOW, look)
      for (const material of glass) material.emissiveIntensity = LAMP_GLOW.intensity * look.glow * look.flash
      halo.visible = look.glow > 0.001
      halo.material.opacity = Math.min(1, LAMP_GLOW.haloOpacity * look.glow)
      halo.scale.setScalar(LAMP_GLOW.haloSize * (0.85 + 0.15 * look.glow) * look.flash)
      pool.visible = halo.visible
      pool.material.opacity = LAMP_GLOW.poolOpacity * Math.min(1, look.glow)
      ring.visible = look.ringOpacity > 0.001
      if (ring.visible) {
        ring.scale.setScalar(Math.max(0.3, look.ring))
        ringMaterial.opacity = LAMP_GLOW.ringOpacity * look.ringOpacity
      }
    },
    dispose() {
      halo.removeFromParent()
      pool.removeFromParent()
      ring.removeFromParent()
      halo.material.dispose()
      pool.geometry.dispose()
      pool.material.dispose()
      ringMaterial.dispose()
    },
  }
}
