import * as THREE from 'three'
import { getBoss } from '../data/bosses'
import type { BuiltLevel } from '../sim/level'
import type { World } from '../sim/world'
import { freshSwing, lampLevel, stepBell } from './alarm-motion'
import type { Effects } from './effects'
import { groundGlow, radialTexture } from './glow-textures'
import { rotateFromRest, type ModelInstance, type ModelLibrary } from './model-library'
import { hingeOf, motionAxis, openProgress, swingEase } from './scene-models'
import { ALARM_RIGS, LANDMARK_CRASH, LANDMARK_OPEN } from './themes'
import { toonMaterial } from './toon'

// The wheel ruts carry on past the exit into the forest trail.
function farmExit(models: ModelLibrary, soft: THREE.Texture, owned: { dispose(): void }[]) {
  const group = new THREE.Group()
  group.name = 'farm-forest-exit'
  type Outline = [number, number][]
  const patch = (color: string, height: number, ...outlines: Outline[]) => {
    const shapes = outlines.map((points) => new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z))))
    const geometry = new THREE.ShapeGeometry(shapes)
    const material = toonMaterial({ color })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.y = height
    group.add(mesh)
    owned.push(geometry, material)
    return mesh
  }
  patch('#728365', -0.08, [[-7, 1], [7, 1], [11, -7], [7, -16], [-4, -21], [-12, -14], [-11, -5]])
  patch('#b49a71', -0.06, [[-1.9, 1], [1.9, 1], [2, -5], [-0.6, -11], [-2.2, -16], [-3.8, -15], [-3.1, -10], [-0.8, -5]])
  const rut: Outline = [[-0.65, 0.1], [-0.42, -5], [-2.85, -11], [-3.22, -14], [-3.05, -14], [-2.63, -11], [-0.24, -5], [-0.46, 0.1]]
  patch('#927554', -0.045, rut, rut.map(([x, z]) => [x + 1.3, z]))
  const arrow: Outline = [[-0.52, 0.32], [0, -0.16], [0.52, 0.32], [0.52, 0.52], [0, 0.07], [-0.52, 0.52]]
  const threshold = patch('#ffdc73', 0.035, arrow, arrow.map(([x, z]) => [x, z + 0.7]))
  threshold.position.z = 1.5
  threshold.visible = false
  threshold.userData.noInk = true

  if (models.has('ch1-tree')) {
    const trees = [[-5, -4, 2.8], [5, -7, 3.1], [-8, -9, 3.6], [7, -12, 3.3], [-6, -14, 3.1], [2, -15, 3.6], [-4, -18, 3.2]]
    for (const part of models.parts('ch1-tree')) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, trees.length)
      trees.forEach(([x, z, size], i) => {
        const matrix = new THREE.Matrix4().makeRotationY(i * 1.7).scale(new THREE.Vector3(size, size, size)).setPosition(x, -0.1, z)
        mesh.setMatrixAt(i, matrix)
      })
      mesh.userData.noInk = true
      mesh.computeBoundingSphere()
      group.add(mesh)
      owned.push(mesh)
    }
  }
  const mist = new THREE.SpriteMaterial({ map: soft, color: '#bdd9df', transparent: true, opacity: 0.7, depthWrite: false })
  owned.push(mist)
  for (const [x, z] of [[-5, -8], [5, -11], [-1, -15]]) {
    const layer = new THREE.Sprite(mist)
    layer.position.set(x, 1.4, z)
    layer.scale.set(16, 5, 1)
    group.add(layer)
  }
  return { group, threshold }
}

/** Animate the joints retained by the static mesh merger, using the simulation's landmark indices. */
export function createFarmLandmarks(level: BuiltLevel, models: ModelLibrary, effects?: Effects) {
  const updates: ((world: World, dt: number, time: number, fresh: boolean) => void)[] = []
  const rings: THREE.InstancedMesh[] = []
  const soft = radialTexture(64, 1.5)
  const owned: { dispose(): void }[] = [soft]
  const { group: exit, threshold } = farmExit(models, soft, owned)
  const exitColumn = level.exits.reduce((sum, cell) => sum + cell % level.grid.columns + 0.5, 0) / level.exits.length
  exit.position.set(exitColumn, level.grid.floor[level.exits[0]], 0)
  const band = new THREE.CylinderGeometry(1.41, 1.41, 0.12, 24, 1, true)
  const paint = new THREE.MeshBasicMaterial({ toneMapped: false })
  const full = new THREE.Color('#ffcb57')
  const spent = new THREE.Color('#594e48')
  const guard = getBoss('shield-captain').guard!
  let lastWorld: World | null = null

  return {
    exit,
    bind(index: number, model: ModelInstance) {
      const placement = level.landmarks[index]
      if (placement.id === 'ch1-bell-tower') {
        const rule = ALARM_RIGS[placement.id]!
        const alarm = level.alarms.findIndex((item) => item.landmark === index)
        const bell = model.nodes.get(rule.bell)
        const lamp = model.glow.get('mat_glow')
        const base = lamp?.emissiveIntensity ?? 1
        const axis = new THREE.Vector3(...motionAxis(rule.axis))
        let swing = freshSwing()
        updates.push((world, dt, time, fresh) => {
          if (fresh) swing = freshSwing()
          const state = world.alarms[alarm] ?? null
          if (bell) rotateFromRest(bell, axis, stepBell(swing, state, dt))
          if (lamp) lamp.emissiveIntensity = base * lampLevel(state, time)
        })
      } else if (placement.id === 'ch1-cellar') {
        const light = groundGlow(soft, '#a9d9eb', 1.55, 0.04)
        light.material.opacity = 0.32
        light.position.x = 0.9
        light.userData.noInk = true
        model.root.add(light)
        owned.push(light.geometry, light.material)
        const doors = Object.keys(LANDMARK_OPEN.hinges[placement.id]).map((name) => {
          const { axis, angle } = hingeOf(placement.id, name)
          return { node: model.nodes.get(name), axis: new THREE.Vector3(...axis), angle }
        })
        let progress = 0
        updates.push((world, dt, _time, fresh) => {
          const open = world.landmarks[index].open
          progress = fresh ? Number(open) : openProgress(progress, open, dt, LANDMARK_OPEN.seconds)
          light.material.opacity = 0.32 + progress * 0.22
          for (const door of doors) if (door.node) rotateFromRest(door.node, door.axis, door.angle * swingEase(progress))
        })
      } else if (placement.id === guard.crashInto) {
        const marks = new THREE.InstancedMesh(band, paint, guard.crashStuns)
        marks.name = 'silo-impact-bands'
        marks.userData.noInk = true
        for (let i = 0; i < marks.count; i++) {
          marks.setMatrixAt(i, new THREE.Matrix4().makeTranslation(0, 1.65 + i * 0.32, 0))
          marks.setColorAt(i, full)
        }
        marks.computeBoundingSphere()
        model.root.add(marks)
        rings.push(marks)
        let previous = 0
        let impactTime = -Infinity
        updates.push((world, _dt, time, fresh) => {
          const crashes = world.landmarks[index].crashes
          if (fresh || previous !== crashes) {
            impactTime = fresh ? -Infinity : time
            previous = crashes
            for (let i = 0; i < marks.count; i++) marks.setColorAt(i, i < marks.count - crashes ? full : spent)
            marks.instanceColor!.needsUpdate = true
            if (!fresh && model.root.visible && effects) {
              const { x, y, z } = model.root.position
              for (let i = 0; i < 10; i++) {
                const angle = i * 2.4
                effects.puff(x + Math.cos(angle) * 1.4, y + 1.8 + i % 3 * 0.17, z + Math.sin(angle) * 1.4, LANDMARK_CRASH.grain, 0.09, 0.03, 0.52, -1.9)
              }
            }
          }
          const since = time - impactTime
          model.root.rotation.z = since < LANDMARK_CRASH.seconds
            ? LANDMARK_CRASH.tilt * Math.exp(-LANDMARK_CRASH.decay * since) * Math.sin(LANDMARK_CRASH.rate * since) : 0
        })
      }
    },
    update(world: World, dt: number, time: number) {
      const fresh = world !== lastWorld
      lastWorld = world
      threshold.visible = world.areas[world.areas.length - 1].status === 'cleared'
      for (const update of updates) update(world, dt, time, fresh)
    },
    dispose() {
      for (const ring of rings) {
        ring.removeFromParent()
        ring.dispose()
      }
      paint.dispose()
      band.dispose()
      for (const item of owned) item.dispose()
      exit.removeFromParent()
    },
  }
}
