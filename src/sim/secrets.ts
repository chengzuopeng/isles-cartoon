import { openLandmark } from './landmark-state'
import { insideRegion } from './level'
import type { World } from './world'

export function updateSecrets(world: World): void {
  const { player } = world
  if (!player.alive || world.status !== 'playing') return
  world.level.secrets.forEach((secret, index) => {
    if (world.secrets[index] || !insideRegion(secret, player.pos.x, player.pos.y)) return
    world.secrets[index] = true
    world.events.push({ type: 'secretFound', index, landmark: secret.landmark, x: player.pos.x, y: player.pos.y })
    if (secret.landmark !== null) openLandmark(world, secret.landmark)
  })
}
