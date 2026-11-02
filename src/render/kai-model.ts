import * as THREE from 'three'
import type { PlayerWeaponId } from '../data/weapons'
import type { PlayerModel } from './character-models'
import { prepareOverlay, rigOf, type ModelInstance, type ModelLibrary } from './model-library'

export const PLAYER_RENDER_ORDER = 11
export const PLAYER_FLASH_COLOR = '#ff4d3d'

const UP = new THREE.Vector3(0, 1, 0)
const SCARF_TUCK: Readonly<Record<string, number>> = { scarf_1: -0.3, scarf_2: 0.4 }

const SCARF_CHAINS = [
  ['scarf_1', 'scarf_1_2', 'scarf_1_3'],
  ['scarf_2', 'scarf_2_2', 'scarf_2_3'],
] as const

export const KAI_JOINTS: readonly string[] = [
  'hips',
  'torso',
  'head',
  'leg_l',
  'leg_l_lower',
  'leg_r',
  'leg_r_lower',
  'arm_l',
  'arm_l_lower',
  'arm_r',
  'arm_r_lower',
  'hand_r',
  ...SCARF_CHAINS.flat(),
  'weapon_default',
]

const PETALS = ['petal_1', 'petal_2', 'petal_3', 'petal_4', 'petal_5'] as const

export const HELD_JOINTS: Readonly<Record<PlayerWeaponId, readonly string[]>> = {
  blaster: PETALS,
  shotgun: [],
  smg: [],
  sniper: [],
  grenade: ['drum'],
  ricochet: [],
  flamer: [],
  frost: [],
  rocket: ['warhead'],
  arc: [],
}

function prepareHeld(model: Pick<ModelInstance, 'root' | 'tintable'>): void {
  prepareOverlay(model.root, PLAYER_RENDER_ORDER)
  for (const material of model.tintable) {
    material.emissive.set(PLAYER_FLASH_COLOR)
    material.emissiveIntensity = 0
  }
}

export function kaiFromLibrary(models: ModelLibrary): PlayerModel {
  return kaiFromModel(models.instance('kai', KAI_JOINTS))
}

export function heldFromLibrary(models: ModelLibrary, id: PlayerWeaponId): ModelInstance {
  const model = models.instance(id, HELD_JOINTS[id])
  prepareHeld(model)
  for (const material of model.materials) material.depthWrite = true
  return model
}

export function kaiFromModel(model: ModelInstance): PlayerModel {
  const { nodes } = model
  prepareHeld(model)
  const spare = nodes.get('weapon_default')
  if (spare) spare.visible = false
  const scarf: THREE.Object3D[][] = []
  for (const names of SCARF_CHAINS) {
    const chain: THREE.Object3D[] = []
    for (const name of names) {
      const node = nodes.get(name)
      if (!node) break
      const tuck = SCARF_TUCK[name]
      if (tuck) node.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, tuck))
      chain.push(node)
    }
    if (chain.length > 0) scarf.push(chain)
  }
  return {
    root: model.root,
    materials: model.materials,
    tintable: model.tintable,
    nodes,
    scarf,
    rig: rigOf(nodes, { held: ['arm_r'] }),
    mount: nodes.get('socket_weapon') ?? null,
  }
}
