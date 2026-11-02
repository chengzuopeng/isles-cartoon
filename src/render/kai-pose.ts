import * as THREE from 'three'
import { restQuaternion } from './model-library'

export interface ArmChain {
  upper: THREE.Object3D
  lower: THREE.Object3D
  hand: THREE.Object3D
  socket: THREE.Object3D
  toParent: THREE.Matrix4
  parentTurn: THREE.Quaternion
}

export interface HoldSolution {
  upper: THREE.Quaternion
  lower: THREE.Quaternion
  hand: THREE.Quaternion
  reach: number
  limit: number
}

type Triple = readonly [number, number, number]

const grip = new THREE.Vector3()
const bend = new THREE.Vector3()
const wrist = new THREE.Vector3()
const offset = new THREE.Vector3()
const along = new THREE.Vector3()
const elbow = new THREE.Vector3()
const reached = new THREE.Vector3()
const from = new THREE.Vector3()
const to = new THREE.Vector3()
const handTurn = new THREE.Quaternion()
const inverse = new THREE.Quaternion()
const unturn = new THREE.Quaternion()
const rest = new THREE.Matrix4()

function restFrame(node: THREE.Object3D, root: THREE.Object3D): THREE.Matrix4 {
  const chain: THREE.Object3D[] = []
  for (let at: THREE.Object3D | null = node; at && at !== root; at = at.parent) chain.push(at)
  const frame = new THREE.Matrix4()
  for (let i = chain.length - 1; i >= 0; i--) {
    const part = chain[i]
    frame.multiply(rest.compose(part.position, restQuaternion(part), part.scale))
  }
  return frame
}

export function armChain(nodes: Map<string, THREE.Object3D>, side: 'l' | 'r' = 'r'): ArmChain | null {
  const root = nodes.get('root')
  const upper = nodes.get(`arm_${side}`)
  const lower = nodes.get(`arm_${side}_lower`)
  const hand = nodes.get(`hand_${side}`)
  const socket = nodes.get('socket_weapon')
  if (!root || !upper?.parent || !lower || !hand || !socket || socket.parent !== hand) return null
  for (const part of [upper, lower, hand, socket]) restQuaternion(part)
  const frame = restFrame(upper.parent, root)
  return {
    upper,
    lower,
    hand,
    socket,
    toParent: frame.clone().invert(),
    parentTurn: new THREE.Quaternion().setFromRotationMatrix(frame),
  }
}

export function solveHold(chain: ArmChain, target: Triple, pole: Triple, out?: HoldSolution): HoldSolution {
  const solution = out ?? { upper: new THREE.Quaternion(), lower: new THREE.Quaternion(), hand: new THREE.Quaternion(), reach: 0, limit: 0 }
  const { upper, lower, hand, socket } = chain
  inverse.copy(chain.parentTurn).invert()
  grip.set(target[0], target[1], target[2]).applyMatrix4(chain.toParent)
  handTurn.copy(inverse).multiply(unturn.copy(restQuaternion(socket)).invert())
  wrist.copy(socket.position).applyQuaternion(handTurn).negate().add(grip)
  const upperLength = lower.position.length()
  const lowerLength = hand.position.length()
  const limit = upperLength + lowerLength
  along.subVectors(wrist, upper.position)
  const reach = along.length()
  const distance = THREE.MathUtils.clamp(reach, Math.abs(upperLength - lowerLength) + 1e-4, limit - 1e-4)
  along.normalize()
  bend.set(pole[0], pole[1], pole[2]).applyQuaternion(inverse)
  bend.addScaledVector(along, -bend.dot(along))
  if (bend.lengthSq() < 1e-10) bend.set(0, -1, 0).addScaledVector(along, -along.y)
  bend.normalize()
  const cos = THREE.MathUtils.clamp((upperLength * upperLength + distance * distance - lowerLength * lowerLength) / (2 * upperLength * distance), -1, 1)
  const sin = Math.sqrt(1 - cos * cos)
  elbow.copy(upper.position).addScaledVector(along, upperLength * cos).addScaledVector(bend, upperLength * sin)
  reached.copy(upper.position).addScaledVector(along, distance)
  from.copy(lower.position).applyQuaternion(restQuaternion(upper)).normalize()
  to.subVectors(elbow, upper.position).normalize()
  solution.upper.setFromUnitVectors(from, to).multiply(restQuaternion(upper))
  from.copy(hand.position).applyQuaternion(restQuaternion(lower)).normalize()
  offset.subVectors(reached, elbow).applyQuaternion(unturn.copy(solution.upper).invert()).normalize()
  solution.lower.setFromUnitVectors(from, offset).multiply(restQuaternion(lower))
  solution.hand.copy(solution.upper).multiply(solution.lower).invert().multiply(handTurn)
  solution.reach = reach
  solution.limit = limit
  return solution
}

export function applyHold(chain: ArmChain, solution: HoldSolution): void {
  chain.upper.quaternion.copy(solution.upper)
  chain.lower.quaternion.copy(solution.lower)
  chain.hand.quaternion.copy(solution.hand)
}
