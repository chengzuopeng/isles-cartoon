import { lampTally } from './fog'
import { targetTally, type Tally } from './landmark-state'
import type { World } from './world'

export type { Tally } from './landmark-state'

export interface RunTallies {
  chests: Tally
  sheep: Tally
  clues: Tally
  secrets: Tally
  targets: Tally
  alarms: Tally
  lamps: Tally
  elites: Tally
}

export function runTallies(world: World): RunTallies {
  return {
    chests: { done: world.chests.filter((chest) => chest.opened).length, total: world.chests.length },
    sheep: { done: world.sheep.filter((sheep) => sheep.state !== 'penned').length, total: world.sheep.length },
    clues: {
      done: world.level.clues.filter((clue) => world.cluesFound.includes(clue.id)).length,
      total: world.level.clues.length,
    },
    secrets: { done: world.secrets.filter(Boolean).length, total: world.secrets.length },
    targets: targetTally(world),
    alarms: { done: world.alarms.filter((alarm) => alarm.status !== 'rung').length, total: world.alarms.length },
    lamps: lampTally(world),
    elites: eliteTally(world),
  }
}

export function eliteTally(world: World): Tally {
  const total = world.level.enemies.filter((enemy) => enemy.affixes.length > 0).length
  return { done: Math.min(total, world.stats.elites), total }
}
