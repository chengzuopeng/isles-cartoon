import * as THREE from 'three'

export interface ClipBox {
  center: readonly [number, number, number]
  axes: readonly (readonly [number, number, number])[]
  half: readonly [number, number, number]
}

export function isClipBox(value: unknown): value is ClipBox {
  const box = value as ClipBox | undefined
  return !!box && Array.isArray(box.center) && Array.isArray(box.axes) && box.axes.length === 3 && Array.isArray(box.half)
}

export function clipGeometry(geometry: THREE.BufferGeometry, box: ClipBox): THREE.BufferGeometry {
  const result = geometry.clone()
  const position = result.getAttribute('position')
  const center = new THREE.Vector3(...box.center)
  const axes = box.axes.map((axis) => new THREE.Vector3(...axis))
  const index = result.index
  const count = index ? index.count : position.count
  const kept: number[] = []
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const centroid = new THREE.Vector3()
  for (let i = 0; i < count; i += 3) {
    const ia = index ? index.getX(i) : i
    const ib = index ? index.getX(i + 1) : i + 1
    const ic = index ? index.getX(i + 2) : i + 2
    a.fromBufferAttribute(position, ia)
    b.fromBufferAttribute(position, ib)
    c.fromBufferAttribute(position, ic)
    centroid.copy(a).add(b).add(c).divideScalar(3).sub(center)
    const inside = axes.every((axis, k) => Math.abs(centroid.dot(axis)) <= box.half[k])
    if (!inside) kept.push(ia, ib, ic)
  }
  result.setIndex(kept)
  result.clearGroups()
  return result
}
