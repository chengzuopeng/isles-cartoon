import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { floorAt } from '../sim/grid'
import type { BuiltLevel } from '../sim/level'
import { toonMaterial } from './toon'

function farmerGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const shirt = '#a13c2d'
  const canvas = '#6a5743'
  const boot = '#38302a'
  const skin = '#e2a274'
  const straw = '#e3b35f'
  const beard = '#676055'
  const color = new THREE.Color()
  const add = (geometry: THREE.BufferGeometry, tint: string) => {
    const piece = geometry.toNonIndexed()
    geometry.dispose()
    const colors = new Float32Array(piece.attributes.position.count * 3)
    color.set(tint)
    for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i)
    piece.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    parts.push(piece)
  }
  const oval = (tint: string, x: number, y: number, z: number, w: number, h: number, d: number) =>
    add(new THREE.SphereGeometry(1, 14, 10).scale(w, h, d).translate(x, y, z), tint)
  const block = (tint: string, x: number, y: number, z: number, w: number, h: number, d: number, tilt = 0) =>
    add(new THREE.BoxGeometry(w, h, d).rotateZ(tilt).translate(x, y, z), tint)

  for (const x of [-0.15, 0.15]) {
    oval(boot, x, 0.12, 0.065, 0.123, 0.12, 0.195)
    oval(canvas, x, 0.42, -0.012, 0.134, 0.36, 0.142)
  }
  oval(canvas, 0, 0.7, 0, 0.305, 0.22, 0.205)
  oval(shirt, 0, 0.99, 0, 0.33, 0.365, 0.213)
  block(canvas, 0, 0.965, 0.182, 0.414, 0.355, 0.076)
  block('#514235', 0, 0.962, 0.228, 0.18, 0.129, 0.018)
  for (const s of [-1, 1]) {
    oval(shirt, s * 0.33, 1.105, 0, 0.145, 0.235, 0.14)
    block(canvas, s * 0.188, 1.175, 0.177, 0.081, 0.29, 0.04, s * 0.14)
    block('#d6ad52', s * 0.178, 1.115, 0.204, 0.064, 0.055, 0.024)
  }
  oval('#f1d4b5', -0.39, 0.954, 0.06, 0.114, 0.072, 0.114)
  oval(skin, -0.35, 0.833, 0.112, 0.091, 0.145, 0.095)
  oval('#f1d4b5', 0.412, 1, 0.08, 0.112, 0.072, 0.108)
  oval(skin, 0.465, 0.984, 0.181, 0.105, 0.075, 0.127)

  oval(skin, 0, 1.48, 0.018, 0.203, 0.245, 0.177)
  oval(beard, 0, 1.341, 0.116, 0.177, 0.111, 0.111)
  for (const s of [-1, 1]) {
    oval(skin, s * 0.196, 1.477, 0.011, 0.047, 0.064, 0.043)
    oval(beard, s * 0.117, 1.404, 0.145, 0.074, 0.07, 0.077)
    oval('#332a24', s * 0.076, 1.536, 0.174, 0.022, 0.026, 0.017)
    oval(beard, s * 0.077, 1.579, 0.169, 0.046, 0.017, 0.017)
  }
  oval('#d78a63', 0, 1.471, 0.195, 0.052, 0.045, 0.049)

  add(new THREE.CylinderGeometry(0.337, 0.347, 0.048, 20).scale(1, 1, 0.89).translate(0, 1.679, 0.006), straw)
  add(new THREE.CylinderGeometry(0.153, 0.208, 0.191, 20).scale(1, 1, 0.86).translate(0, 1.786, -0.016), straw)
  add(new THREE.CylinderGeometry(0.207, 0.216, 0.043, 20).scale(1, 1, 0.86).translate(0, 1.717, -0.016), '#855438')

  const crook = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.52, 0.03, 0.222),
    new THREE.Vector3(0.52, 0.48, 0.222),
    new THREE.Vector3(0.516, 0.99, 0.222),
    new THREE.Vector3(0.516, 1.39, 0.222),
    new THREE.Vector3(0.532, 1.565, 0.222),
    new THREE.Vector3(0.643, 1.628, 0.222),
    new THREE.Vector3(0.731, 1.527, 0.222),
    new THREE.Vector3(0.71, 1.439, 0.222),
  ])
  add(new THREE.TubeGeometry(crook, 26, 0.036, 8, false), '#8e5e37')

  const geometry = mergeGeometries(parts)
  for (const piece of parts) piece.dispose()
  return geometry
}

export function createStoryActors(level: BuiltLevel, parent: THREE.Group): { update(area: number, time: number): void; dispose(): void } {
  const geometry = farmerGeometry()
  const material = toonMaterial({ vertexColors: true })
  const actors = level.actors.map((placement) => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = `story-actor-${placement.speaker}-${placement.area}`
    mesh.position.set(placement.x, floorAt(level.grid, placement.x, placement.y), placement.y)
    mesh.rotation.y = (-placement.facing * Math.PI) / 180
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.visible = placement.area === 0
    parent.add(mesh)
    return { mesh, area: placement.area }
  })
  return {
    update(area, time) {
      for (const actor of actors) {
        actor.mesh.visible = actor.area === area
        actor.mesh.scale.y = 1 + Math.sin(time * 2.2) * 0.008
      }
    },
    dispose() {
      for (const { mesh } of actors) mesh.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
