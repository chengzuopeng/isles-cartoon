import { AUTOPILOT, AUTOPILOT_SKILLS, type AutopilotSkillId } from '../data/autopilot'
import { getBoss, type BossDef } from '../data/bosses'
import { CONVEYOR } from '../data/conveyors'
import { MAX_PITCH, WEAK_POINTS, eyeHeightOf } from '../data/heights'
import type { LandmarkId } from '../data/landmarks'
import { INTERACT_RANGE, PICKUP_REACH_UP } from '../data/loot'
import { SKILLS, type SkillSlot } from '../data/skills'
import { activeWeaponId, specialMagazine, weaponOf } from './arsenal'
import { firstSolid, footing, guardLedge, jumpRise, pathSafe, pilotField, pilotStep, safeCells, stride, wantsJump, type Stride } from './autopilot-paths'
import { acrossOf, alongOf, forecastBlade, laneEnds, laneMiddle } from './blades'
import { bossExposed, nextMove, tripleLanes } from './boss'
import { corridorClear, lineClear } from './collision'
import { insideBlast } from './combat'
import { beltAt } from './conveyors'
import { meleeReach, shieldBlocks } from './enemies'
import { trackShare } from './enemies/tactics'
import { blocksBullets, blocksMovement, cellFloor, cellTop, floorAt, tileAt } from './grid'
import { isTarget, landmarkCenter } from './landmark-state'
import { reachableFrom, type BladeLane } from './level'
import { clamp, type Vec2, type Vec3 } from './math'
import { crumbling } from './melee'
import { mineRadius, mineRule } from './mines'
import { tileIndex } from './navigation'
import { threatNearby } from './player'
import { createRng } from './rng'
import { concussionTarget, rankOf } from './skills'
import { playerSpeedFactor } from './status'
import { idleCommand } from './step'
import { bodyHeight, centerOf, playerChest, playerEye } from './terrain'
import type { BladeState, Enemy, Mine, PlayerCommand, Ring, WeaponSlot } from './types'
import type { World } from './world'

interface LootGoal {
  key: string
  pos: Vec2
  interact: boolean
  ground: boolean
}

export interface Autopilot {
  next(world: World): PlayerCommand
}

export interface AutopilotOptions {
  stealthy?: boolean
  siege?: boolean
  onward?: boolean
  kite?: boolean
  skill?: AutopilotSkillId
  seed?: number
}

interface Threat {
  key: string
  move: Vec2 | null
}

interface Sighting {
  since: number
  noticed: boolean
  step: number
}

interface RingNote extends Sighting {
  offset: number
}

interface Demolition {
  index: number
  aim: Vec3
  reach: number
  clear: boolean
}

interface PathPoint {
  x: number
  y: number
  t: number
}

interface BandRun {
  start: number
  end: number
}

interface Aim {
  x: number
  y: number
  pitch: number
}

type RingAction = 'jump' | 'dash'

const MINE_TURNS: readonly number[] = [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2.1, -2.1]
const MINE_BULLET = 0.2
const LANE_STEP = 0.1
const STEP_SECONDS = 1 / 60

const NEIGHBORS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

export function createAutopilot(options: AutopilotOptions = {}): Autopilot {
  let exitField: Float32Array | null = null
  let exitKey = ''
  const fields = new Map<string, { field: Float32Array; age: number }>()
  const skill = AUTOPILOT_SKILLS[options.skill ?? 'perfect']
  const rng = createRng(options.seed ?? 1)
  const sightings = new Map<string, Sighting>()
  const ringNotes = new Map<number, RingNote>()
  let slamNote: (Sighting & { until: number }) | null = null
  let steps = 0
  let yawOffset = 0
  let pitchOffset = 0
  let aimUntil = -Infinity
  const siege = { id: -1, since: 0 }
  let detour: number | null = null
  const crossings = new Map<number, { misread: boolean }>()
  let safe: { level: World['level']; key: string; age: number; cells: Uint8Array | null } | null = null

  const notice = (): boolean => skill.dodgeChance >= 1 || rng.next() < skill.dodgeChance

  const react = (world: World): Vec2 | null => {
    steps += 1
    let chosen: Vec2 | null = null
    let decided = false
    for (const threat of threats(world, options.kite ?? false)) {
      let seen = sightings.get(threat.key)
      if (!seen) {
        seen = { since: world.time, noticed: notice(), step: steps }
        sightings.set(threat.key, seen)
      }
      seen.step = steps
      if (!decided && seen.noticed && world.time - seen.since >= skill.reaction) {
        chosen = threat.move
        decided = true
      }
    }
    for (const [key, seen] of sightings) {
      if (seen.step !== steps) sightings.delete(key)
    }
    return chosen
  }

  const watchRings = (world: World, move: Vec2 | null): RingAction | null => {
    const boss = world.boss
    const state = boss?.boss
    if (boss && state && state.phase === 'telegraph' && state.move === 'slam' && getBoss(state.id).ring) {
      if (!slamNote || world.time > slamNote.until) slamNote = { since: world.time, noticed: notice(), step: steps, until: world.time + AUTOPILOT.ringNotice }
    }
    let action: RingAction | null = null
    for (const ring of world.rings) {
      if (ring.hitPlayer) continue
      let note = ringNotes.get(ring.id)
      if (!note) {
        const inherited = slamNote && world.time <= slamNote.until ? slamNote : null
        note = {
          since: inherited?.since ?? world.time,
          noticed: inherited ? inherited.noticed : notice(),
          step: steps,
          offset: skill.jumpError > 0 ? rng.range(-1, 1) * skill.jumpError : 0,
        }
        ringNotes.set(ring.id, note)
      }
      note.step = steps
      if (!note.noticed || world.time - note.since < skill.reaction) continue
      const plan = ringTiming(world, ring, move, note.offset)
      if (plan === 'jump') return 'jump'
      if (plan === 'dash') action = 'dash'
    }
    for (const [id, note] of ringNotes) {
      if (note.step !== steps) ringNotes.delete(id)
    }
    return action
  }

  const aimAt = (world: World, point: Vec3, lob = false): Aim => {
    const { player } = world
    const eye = playerEye(player)
    const dx = point.x - eye.x
    const dy = point.y - eye.y
    const flat = Math.hypot(dx, dy)
    let yaw = flat > 1e-6 ? Math.atan2(dy, dx) : player.facing
    let pitch = lob ? lobPitch(flat) : Math.atan2(point.z - eye.z, Math.max(flat, 1e-6))
    if (skill.aimError > 0) {
      if (world.time >= aimUntil) {
        const spread = (skill.aimError * Math.PI) / 180
        yawOffset = rng.range(-1, 1) * spread
        pitchOffset = rng.range(-1, 1) * spread
        aimUntil = world.time + skill.aimHold
      }
      yaw += yawOffset
      pitch = lob ? lobPitch(flat * (1 + pitchOffset)) : pitch + pitchOffset
    }
    const reach = Math.max(flat, 1)
    return { x: player.pos.x + Math.cos(yaw) * reach, y: player.pos.y + Math.sin(yaw) * reach, pitch: clamp(pitch, -MAX_PITCH, MAX_PITCH) }
  }

  const refreshSafe = (world: World): Uint8Array | null => {
    const key = world.areas.map((area) => area.status).join()
    if (!safe || safe.level !== world.level || safe.key !== key || safe.age <= 0) {
      safe = { level: world.level, key, age: AUTOPILOT.safeReplan, cells: safeCells(world) }
    }
    safe.age -= 1
    return safe.cells
  }

  const allowedFor = (world: World): Uint8Array | null => {
    const cells = safe?.level === world.level ? safe.cells : refreshSafe(world)
    if (!cells) return null
    return cells[tileIndex(world.grid, world.player.pos)] === 1 ? cells : null
  }

  const fieldTo = (world: World, key: string, pos: Vec2): Float32Array => fieldToCells(world, key, [tileIndex(world.grid, pos)])

  const fieldToCells = (world: World, key: string, cells: number[]): Float32Array => {
    const cached = fields.get(key)
    if (cached && cached.age > 0) {
      cached.age -= 1
      return cached.field
    }
    const field = pilotField(world.grid, cells, jumpRise(world), allowedFor(world))
    fields.set(key, { field, age: AUTOPILOT.replanSteps })
    if (fields.size > 12) fields.delete(fields.keys().next().value ?? key)
    return field
  }

  let hidden: { level: World['level']; chests: Set<string> } | null = null
  const hiddenChests = (world: World): Set<string> => {
    if (hidden?.level !== world.level) {
      const { level } = world
      const reachable = reachableFrom(level.grid, level.playerStart)
      const blocked = level.chests.filter((chest) => reachable[Math.floor(chest.y) * level.grid.columns + Math.floor(chest.x)] !== 1)
      hidden = { level, chests: new Set(blocked.map((chest) => `${chest.x},${chest.y}`)) }
    }
    return hidden.chests
  }

  return {
    next(world) {
      const { player, grid } = world
      const command = idleCommand(world)
      if (!player.alive || world.status !== 'playing') return command
      const safeNow = refreshSafe(world)

      const lob = weaponOf(world, activeWeaponId(player)).kind === 'lob'
      const target = pickTarget(world, options.stealthy ?? false) ?? (options.kite ? huntBoss(world) : null)
      const point = target ? aimPointOf(target) : null
      if (target && point) {
        const aim = aimAt(world, point, lob)
        command.aimX = aim.x
        command.aimY = aim.y
        command.pitch = aim.pitch
        command.slot = pickSlot(world, target.pos)
        command.fire = inReach(world, point) && canHit(world, point) && !guarded(world, target)
      }

      const demolition = pickDemolition(world)
      if (demolition && !command.fire) {
        const aim = aimAt(world, demolition.aim, lob)
        command.aimX = aim.x
        command.aimY = aim.y
        command.pitch = aim.pitch
        command.slot = pickSlot(world, demolition.aim)
        command.fire = demolition.clear && demolition.reach <= weaponOf(world, activeWeaponId(player)).range - 0.3
      }

      if (command.fire && world.mines.length > 0 && mineInLine(world, command.aimX, command.aimY)) command.fire = false

      const loots = pickLoot(world, hiddenChests(world), options.onward ? world.areaIndex : 0)
      const loot = loots[0] ?? null
      if (loot?.interact && distance(player.pos, loot.pos) <= INTERACT_RANGE - 0.15) command.interact = true

      if (target && point && player.ultimate >= 1 && distance(player.pos, target.pos) <= AUTOPILOT.ultimateRange) {
        command.ultimate = canHit(world, point) && !(target.boss && guarded(world, target))
        if (command.ultimate && world.mines.length > 0 && mineInLine(world, target.pos.x, target.pos.y)) command.ultimate = false
      }
      const evade = react(world)
      command.skill = pickSkill(world)
      const captain = guardBoss(world)
      const tank = tankBoss(world)
      if (!target || target.id !== siege.id) {
        siege.id = target && target.kind !== 'boss' && guarded(world, target) ? target.id : -1
        siege.since = world.time
      }
      const besieged = options.siege === true && target !== null && siege.id === target.id && world.time - siege.since >= AUTOPILOT.siegeSeconds
      const smashing = smashTarget(world)

      let route: Float32Array | null = null
      const planned: { step: Stride | null } = { step: null }
      const traced = (field: Float32Array): Float32Array => {
        route = field
        return field
      }
      const walk = (field: Float32Array): Vec2 | null => {
        traced(field)
        const step = stride(world, field)
        planned.step = step
        return step ? { x: step.x, y: step.y } : null
      }
      const plans: readonly (() => Vec2 | null)[] = [
        () => evade,
        () => (captain && (target === captain || !target) ? outwit(world, captain, (key, pos) => fieldTo(world, key, pos), walk) : null),
        () => (tank && (target === tank || !target) ? maneuver(world, tank, (key, pos) => fieldTo(world, key, pos), walk) : null),
        () => (besieged && target ? circleBehind(world, target) : null),
        () => (smashing ? closeIn(world, smashing) : null),
        () => snack(world),
        () => engage(world, target, (enemy) => fieldTo(world, `enemy:${enemy.id}`, enemy.pos), walk, options.kite ?? false),
        () => seek(world, loot, (goal) => fieldTo(world, goal.key, goal.pos), walk),
        () => approach(world, demolition, (goal) => fieldToCells(world, `target:${goal.index}`, besideTarget(world, goal.index)), walk),
        () => followExit(),
      ]
      let chosen: Vec2 | null = null
      for (const plan of plans) {
        route = null
        planned.step = null
        chosen = plan()
        if (chosen) break
      }
      let move = chosen && world.mines.length > 0 ? avoidMines(world, chosen, command) : chosen
      if (world.level.blades.length > 0) move = mindBlades(world, move, route)
      if (world.conveyors.size > 0) move = rideBelts(world, move)
      if (move) move = guardLedge(world, move, safeNow)
      if (move) {
        command.moveX = move.x
        command.moveY = move.y
      }

      const smash = smashing && meleeReady(world, smashing) ? smashing : null
      if (smash) {
        const aim = aimAt(world, centerOf(smash))
        command.aimX = aim.x
        command.aimY = aim.y
        command.melee = true
        command.fire = false
      } else if (player.meleeCooldown === 0 && interruptible(world)) {
        command.melee = true
      }

      const ring = watchRings(world, move)
      const step = planned.step
      if (ring === 'jump' && player.grounded) command.jump = true
      else if (step && move && wantsJump(world, step) && step.x * move.x + step.y * move.y > 0.7) command.jump = true

      if (player.dashCooldown === 0 && command.skill === null && !command.jump) {
        if (ring === 'dash') {
          const center = ringCenter(world)
          if (center) {
            const dir = normalize(center.x - player.pos.x, center.y - player.pos.y)
            if (dir && pathSafe(world, dir, world.tuning.player.dashDistance, safeNow)) {
              command.moveX = dir.x
              command.moveY = dir.y
              command.dash = true
            }
          }
        } else if (evade && urgentDanger(world)) {
          const dir = normalize(command.moveX, command.moveY)
          if (dir && pathSafe(world, dir, world.tuning.player.dashDistance, safeNow)) command.dash = true
        }
      }
      return command

      function mindBlades(world: World, wanted: Vec2 | null, field: Float32Array | null): Vec2 | null {
        const path = previewRoute(world, wanted, field)
        let move = wanted
        world.level.blades.forEach((lane, index) => {
          const blade = world.blades[index]
          const reach = world.player.radius + AUTOPILOT.bladeMargin
          const inside = inBand(lane, world.player.pos, reach)
          const run = bandRun(lane, path, reach)
          const episode = crossings.get(index)
          if (episode && !inside && bandGap(lane, world.player.pos, reach) > AUTOPILOT.bladeForget) crossings.delete(index)
          if (!run) return
          const risky = (!inside && blade.phase === 'warning') || clashes(lane, blade, path, run, reach)
          if (!risky) return
          let current = crossings.get(index)
          if (!current) {
            current = { misread: skill.bladeMisread > 0 && rng.next() < skill.bladeMisread }
            crossings.set(index, current)
          }
          if (current.misread) return
          move = inside ? escapeLane(world, lane, blade, move) : holdOutside(world, lane, move, reach)
        })
        return move
      }

      function avoidMines(world: World, wanted: Vec2, command: PlayerCommand): Vec2 {
        if (Math.hypot(wanted.x, wanted.y) < 1e-6) return wanted
        const blocker = mineAhead(world, wanted)
        if (!blocker) {
          detour = null
          return wanted
        }
        const gap = distance(world.player.pos, blocker.pos)
        const spot = { x: blocker.pos.x, y: blocker.pos.y, z: floorAt(world.grid, blocker.pos.x, blocker.pos.y) + AUTOPILOT.mineAimHeight }
        if (!command.fire && gap >= AUTOPILOT.mineShotMin && gap <= AUTOPILOT.mineShotMax && canHit(world, spot)) {
          const aim = aimAt(world, spot, lob)
          command.aimX = aim.x
          command.aimY = aim.y
          command.pitch = aim.pitch
          command.fire = !mineInLine(world, aim.x, aim.y)
        }
        const heading = Math.atan2(wanted.y, wanted.x)
        let best: { angle: number; score: number } | null = null
        for (const turn of MINE_TURNS) {
          if (turn === 0) continue
          const angle = heading + turn
          const step = { x: Math.cos(angle), y: Math.sin(angle) }
          if (mineAhead(world, step)) continue
          const probe = { x: world.player.pos.x + step.x * AUTOPILOT.mineWallProbe, y: world.player.pos.y + step.y * AUTOPILOT.mineWallProbe }
          if (blocksMovement(tileAt(world.grid, Math.floor(probe.x), Math.floor(probe.y)))) continue
          let bend = angle - (detour ?? angle)
          while (bend > Math.PI) bend -= Math.PI * 2
          while (bend < -Math.PI) bend += Math.PI * 2
          const score = Math.abs(turn) + Math.abs(bend) * AUTOPILOT.mineDetourStick
          if (!best || score < best.score) best = { angle, score }
        }
        if (best) {
          detour = best.angle
          return { x: Math.cos(best.angle), y: Math.sin(best.angle) }
        }
        const near = nearestMine(world)
        return near ? (normalize(world.player.pos.x - near.pos.x, world.player.pos.y - near.pos.y) ?? wanted) : wanted
      }

      function followExit(): Vec2 | null {
        const key = world.areas.map((area) => area.status).join()
        if (!exitField || key !== exitKey) {
          exitField = pilotField(grid, world.level.exits, jumpRise(world), allowedFor(world))
          exitKey = key
        }
        return walk(exitField)
      }
    },
  }
}

function lobPitch(flat: number): number {
  return -Math.atan(eyeHeightOf('player') / Math.max(flat, 0.1))
}

function aimPointOf(enemy: Enemy): Vec3 {
  return weakPointOf(enemy) ?? { x: enemy.pos.x, y: enemy.pos.y, z: enemy.z + bodyHeight(enemy) * AUTOPILOT.chestShare }
}

function weakPointOf(enemy: Enemy): Vec3 | null {
  const id = enemy.boss?.id
  const weak = id ? WEAK_POINTS[id] : undefined
  if (!weak || !bossExposed(enemy)) return null
  return {
    x: enemy.pos.x + Math.cos(enemy.facing) * weak.forward,
    y: enemy.pos.y + Math.sin(enemy.facing) * weak.forward,
    z: enemy.z + weak.height,
  }
}

function canHit(world: World, point: Vec3): boolean {
  return lineClear(world.grid, playerEye(world.player), point, blocksBullets)
}

function inReach(world: World, point: Vec3): boolean {
  const eye = playerEye(world.player)
  const reach = Math.hypot(point.x - eye.x, point.y - eye.y, point.z - eye.z)
  return reach <= weaponOf(world, activeWeaponId(world.player)).range - 0.3
}

function previewRoute(world: World, move: Vec2 | null, field: Float32Array | null): PathPoint[] {
  const { player, grid } = world
  const points: PathPoint[] = [{ x: player.pos.x, y: player.pos.y, t: 0 }]
  const length = move ? Math.hypot(move.x, move.y) : 0
  if (!move || length < 1e-6) {
    points.push({ x: player.pos.x, y: player.pos.y, t: AUTOPILOT.bladeHold })
    return points
  }
  const pace = Math.max(0.5, world.playerStats.speed * playerSpeedFactor(player) * Math.min(1, length))
  if (field && Number.isFinite(field[tileIndex(grid, player.pos)])) {
    const rise = jumpRise(world)
    let column = Math.floor(player.pos.x)
    let row = Math.floor(player.pos.y)
    let { x, y } = player.pos
    let t = 0
    for (let step = 0; step < AUTOPILOT.bladePreview; step++) {
      const next = pilotStep(grid, field, column, row, footing(grid, column, row), rise)
      if (!next) break
      const nx = next.column + 0.5
      const ny = next.row + 0.5
      t += Math.hypot(nx - x, ny - y) / pace
      x = nx
      y = ny
      column = next.column
      row = next.row
      points.push({ x, y, t })
    }
    return points
  }
  const dirX = move.x / length
  const dirY = move.y / length
  for (let reach = AUTOPILOT.bladeSample; reach <= AUTOPILOT.bladeReachAhead; reach += AUTOPILOT.bladeSample) {
    const x = player.pos.x + dirX * reach
    const y = player.pos.y + dirY * reach
    if (blocksMovement(tileAt(grid, Math.floor(x), Math.floor(y)))) break
    points.push({ x, y, t: reach / pace })
  }
  return points
}

function inBand(lane: BladeLane, pos: Vec2, reach: number): boolean {
  const [low, high] = laneEnds(lane)
  const along = alongOf(lane, pos)
  if (along < low - lane.reach - reach || along > high + lane.reach + reach) return false
  return Math.abs(acrossOf(lane, pos) - laneMiddle(lane)) < lane.half + reach
}

function bandGap(lane: BladeLane, pos: Vec2, reach: number): number {
  return Math.max(0, Math.abs(acrossOf(lane, pos) - laneMiddle(lane)) - lane.half - reach)
}

function bandRun(lane: BladeLane, path: readonly PathPoint[], reach: number): BandRun | null {
  let start = -1
  for (let index = 0; index < path.length; index++) {
    const inside = inBand(lane, path[index], reach)
    if (inside && start < 0) start = index
    if (!inside && start >= 0) return { start, end: index - 1 }
  }
  return start >= 0 ? { start, end: path.length - 1 } : null
}

function alongAt(lane: BladeLane, path: readonly PathPoint[], t: number): number {
  if (t <= path[0].t) return alongOf(lane, path[0])
  for (let index = 1; index < path.length; index++) {
    const a = path[index - 1]
    const b = path[index]
    if (t > b.t) continue
    const share = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1
    return alongOf(lane, a) + (alongOf(lane, b) - alongOf(lane, a)) * share
  }
  return alongOf(lane, path[path.length - 1])
}

function clashes(lane: BladeLane, blade: BladeState, path: readonly PathPoint[], run: BandRun, reach: number): boolean {
  const before = path[Math.max(0, run.start - 1)].t
  const after = path[run.end + 1]?.t ?? path[run.end].t + (lane.half * 2 + reach * 2) / AUTOPILOT.bladeExitPace
  const from = Math.max(0, before - AUTOPILOT.bladeSlack)
  const to = after + AUTOPILOT.bladeSlack
  const gap = lane.reach + reach + AUTOPILOT.bladeLead
  for (let t = from; t <= to + 1e-9; t += AUTOPILOT.bladeStep) {
    const ahead = forecastBlade(lane, blade, t)
    if (ahead.sweeping && Math.abs(ahead.along - alongAt(lane, path, Math.min(t, after))) < gap) return true
  }
  return false
}

function bladeArrival(lane: BladeLane, blade: BladeState, along: number, reach: number): number {
  const gap = lane.reach + reach + AUTOPILOT.bladeLead
  for (let t = 0; t <= AUTOPILOT.bladeHorizon; t += AUTOPILOT.bladeStep) {
    const ahead = forecastBlade(lane, blade, t)
    if (ahead.sweeping && Math.abs(ahead.along - along) < gap) return t
  }
  return Infinity
}

function escapeLane(world: World, lane: BladeLane, blade: BladeState, move: Vec2 | null): Vec2 {
  const { player } = world
  const reach = player.radius + AUTOPILOT.bladeMargin
  const pace = Math.max(0.5, world.playerStats.speed * playerSpeedFactor(player))
  const middle = laneMiddle(lane)
  const across = acrossOf(lane, player.pos)
  const low = (across - (middle - lane.half - reach)) / pace
  const high = (middle + lane.half + reach - across) / pace
  const hit = bladeArrival(lane, blade, alongOf(lane, player.pos), player.radius)
  const wanted = move ? Math.sign(lane.axis === 'x' ? move.y : move.x) : 0
  let side = low <= high ? -1 : 1
  if (wanted !== 0 && (wanted < 0 ? low : high) < hit) side = wanted
  else if ((side < 0 ? low : high) >= hit && (side < 0 ? high : low) < hit) side = -side
  return lane.axis === 'x' ? { x: 0, y: side } : { x: side, y: 0 }
}

function holdOutside(world: World, lane: BladeLane, move: Vec2 | null, reach: number): Vec2 | null {
  if (!move) return move
  const { player } = world
  if (bandGap(lane, player.pos, reach) > AUTOPILOT.bladeStop) return move
  const toward = Math.sign(laneMiddle(lane) - acrossOf(lane, player.pos))
  const acrossMove = lane.axis === 'x' ? move.y : move.x
  if (acrossMove * toward <= 0) return move
  const kept = lane.axis === 'x' ? { x: move.x, y: 0 } : { x: 0, y: move.y }
  return Math.hypot(kept.x, kept.y) < AUTOPILOT.bladeSlide ? { x: 0, y: 0 } : kept
}

function rideBelts(world: World, move: Vec2 | null): Vec2 | null {
  const { player } = world
  if (player.rollTime > 0) return move
  const belt = beltAt(world, player.pos)
  if (!belt) return move
  const pace = world.playerStats.speed * playerSpeedFactor(player)
  if (pace <= CONVEYOR.speed) return move
  const pushX = belt.x * CONVEYOR.speed
  const pushY = belt.y * CONVEYOR.speed
  const length = move ? Math.hypot(move.x, move.y) : 0
  if (!move || length < 1e-6) return { x: -pushX / pace, y: -pushY / pace }
  const dirX = move.x / length
  const dirY = move.y / length
  const along = dirX * pushX + dirY * pushY
  const net = along + Math.sqrt(along * along - CONVEYOR.speed * CONVEYOR.speed + pace * pace)
  return { x: (net * dirX - pushX) / pace, y: (net * dirY - pushY) / pace }
}

function pickSlot(world: World, at: Vec2): WeaponSlot | null {
  const { player } = world
  if (!player.special) return null
  const gap = distance(player.pos, at)
  const wanted: WeaponSlot = gap <= weaponOf(world, player.special).range - 0.3 ? 'special' : 'primary'
  return wanted === player.slot ? null : wanted
}

function pickSkill(world: World): SkillSlot | null {
  const { player } = world
  for (const skill of player.skills) {
    if (skill.cooldown > 0) continue
    switch (skill.id) {
      case 'concussion': {
        const rank = rankOf(SKILLS.concussion.ranks, skill.rank)
        const landing = concussionTarget(world, rank.range)
        let caught = 0
        let charging = false
        for (const enemy of world.enemies) {
          if (enemy.hp <= 0 || enemy.kind === 'boss' || !enemy.aggro) continue
          if (distance(enemy.pos, landing) > rank.radius + enemy.radius) continue
          caught += 1
          if (enemy.state === 'windup' || enemy.state === 'charge') charging = true
        }
        if (caught >= 2 || charging) return skill.slot
        break
      }
      case 'barrier': {
        let crowd = 0
        for (const enemy of world.enemies) {
          if (enemy.hp > 0 && enemy.aggro && distance(enemy.pos, player.pos) <= AUTOPILOT.crowdRange) crowd += 1
        }
        if (crowd >= 3 || (player.hp < player.maxHp * AUTOPILOT.barrierBelow && threatNearby(world, AUTOPILOT.barrierThreat))) return skill.slot
        break
      }
      case 'shockwave': {
        const radius = rankOf(SKILLS.shockwave.ranks, skill.rank).radius
        let crowd = 0
        let melee = false
        for (const enemy of world.enemies) {
          if (enemy.hp <= 0 || enemy.kind === 'boss' || !enemy.aggro) continue
          if (distance(enemy.pos, player.pos) > radius + enemy.radius) continue
          crowd += 1
          if (enemy.kind === 'grunt' || enemy.kind === 'bomber') melee = true
        }
        if (crowd >= 2 || melee) return skill.slot
        break
      }
    }
  }
  return null
}

function urgentDanger(world: World): boolean {
  const { player } = world
  for (const blast of world.blasts) {
    const soon = blast.delay > 0 && blast.delay < AUTOPILOT.urgentSeconds
    if (soon && distance(player.pos, blast) < blast.radius + player.radius) return true
  }
  for (const enemy of world.enemies) {
    if (enemy.hp <= 0) continue
    if (enemy.kind === 'grunt' && enemy.state === 'windup') {
      const left = world.tuning.weapons.claw.windup - enemy.stateTime
      if (left < AUTOPILOT.urgentSeconds && distance(player.pos, enemy.pos) < meleeReach(world, enemy)) return true
    }
    const lane = attackLane(world, enemy)
    if (lane && lane.left < AUTOPILOT.urgentSeconds && lane.along > -1 && lane.along < lane.length && Math.abs(lane.across) < lane.width) {
      return true
    }
    const state = enemy.boss
    if (state && state.phase === 'telegraph' && state.move === 'triple' && state.timer < AUTOPILOT.urgentSeconds && laneEscape(world, enemy, 0)) return true
    if (state && state.phase === 'telegraph' && state.move === 'cannon' && state.timer < AUTOPILOT.urgentSeconds) {
      const line = cannonLine(world, enemy)
      if (line && line.along > 0 && Math.abs(line.across) < line.width) return true
    }
    if (state && state.phase === 'telegraph' && state.move === 'charge' && state.timer < AUTOPILOT.urgentSeconds) {
      const across = (player.pos.x - enemy.pos.x) * -state.chargeY + (player.pos.y - enemy.pos.y) * state.chargeX
      const along = (player.pos.x - enemy.pos.x) * state.chargeX + (player.pos.y - enemy.pos.y) * state.chargeY
      if (along > -1 && along < chargeLength(enemy) && Math.abs(across) < enemy.radius + player.radius) return true
    }
  }
  for (const bullet of world.bullets) {
    if (bullet.team !== 'enemy') continue
    const dx = player.pos.x - bullet.pos.x
    const dy = player.pos.y - bullet.pos.y
    const along = dx * bullet.dirX + dy * bullet.dirY
    if (along < 0 || along > AUTOPILOT.bulletUrgent) continue
    if (Math.abs(dx * -bullet.dirY + dy * bullet.dirX) < player.radius + bullet.radius) return true
  }
  return false
}

function chargeLength(enemy: Enemy): number {
  const id = enemy.boss?.id
  return (id ? getBoss(id).charge.distance : 0) + AUTOPILOT.chargeOvershoot
}

function pickTarget(world: World, stealthy: boolean): Enemy | null {
  const { player } = world
  const locked = world.areas[world.areaIndex]?.status === 'locked'
  let best: Enemy | null = null
  let bestScore = Infinity
  for (const enemy of world.enemies) {
    if (enemy.hp <= 0 || enemy.boss?.phase === 'dormant') continue
    const range = distance(enemy.pos, player.pos)
    if (range > AUTOPILOT.engageRange) continue
    const visible = canHit(world, aimPointOf(enemy))
    if (!visible && !enemy.aggro) continue
    if (stealthy && !enemy.aggro && !locked) continue
    const score =
      range + (visible ? 0 : AUTOPILOT.hiddenPenalty) + (enemy.aggro ? 0 : AUTOPILOT.calmPenalty) + (guarded(world, enemy) ? AUTOPILOT.guardedPenalty : 0)
    if (score < bestScore) {
      best = enemy
      bestScore = score
    }
  }
  return best
}

function pickLoot(world: World, hidden: ReadonlySet<string>, fromArea: number): LootGoal[] {
  const { player } = world
  const found: { goal: LootGoal; gap: number }[] = []
  const consider = (goal: LootGoal, range: number) => {
    const gap = distance(player.pos, goal.pos)
    if (gap <= range) found.push({ goal, gap })
  }
  const health = player.hp / player.maxHp
  for (const pickup of world.pickups) {
    const { item } = pickup
    const wanted =
      (item.type === 'heal' && health < AUTOPILOT.healBelow) ||
      item.type === 'buff' ||
      (item.type === 'ammo' &&
        player.special !== null &&
        player.specialAmmo < specialMagazine(world, player.special) * AUTOPILOT.ammoBelow) ||
      (item.type === 'weapon' && player.special === null)
    if (!wanted) continue
    consider({ key: `pickup:${pickup.id}`, pos: pickup.pos, interact: item.type === 'weapon', ground: true }, AUTOPILOT.lootRange)
  }
  for (const chest of world.chests) {
    if (chest.opened || hidden.has(`${chest.pos.x},${chest.pos.y}`) || chest.area < fromArea) continue
    consider({ key: `chest:${chest.id}`, pos: chest.pos, interact: true, ground: false }, AUTOPILOT.chestRange)
  }
  world.level.lamps.forEach((lamp, index) => {
    if (!world.lamps[index]) consider({ key: `lamp:${index}`, pos: { x: lamp.x, y: lamp.y }, interact: true, ground: false }, AUTOPILOT.lampRange)
  })
  if (health < AUTOPILOT.supplyBelow) {
    for (const supply of world.supplies) {
      if (!supply.used) consider({ key: `supply:${supply.id}`, pos: supply.pos, interact: false, ground: false }, AUTOPILOT.chestRange)
    }
  }
  return found.sort((a, b) => a.gap - b.gap).map((item) => item.goal)
}

function seek(world: World, goal: LootGoal | null, fieldFor: (goal: LootGoal) => Float32Array, walk: (field: Float32Array) => Vec2 | null): Vec2 | null {
  if (!goal) return null
  const { player, grid } = world
  const perched = goal.ground && Math.abs(player.z - floorAt(grid, goal.pos.x, goal.pos.y)) > PICKUP_REACH_UP
  const spot = perched ? { x: Math.floor(goal.pos.x) + 0.5, y: Math.floor(goal.pos.y) + 0.5 } : goal.pos
  if (distance(player.pos, spot) < (perched ? AUTOPILOT.perchedArrive : 0.4)) return null
  if (corridorClear(grid, player.pos, spot, player.radius)) {
    return normalize(spot.x - player.pos.x, spot.y - player.pos.y)
  }
  const field = fieldFor(goal)
  if (!Number.isFinite(field[tileIndex(grid, player.pos)])) return null
  return walk(field) ?? normalize(spot.x - player.pos.x, spot.y - player.pos.y)
}

function pickDemolition(world: World): Demolition | null {
  const { player, grid, level } = world
  let best: Demolition | null = null
  for (let index = 0; index < level.landmarks.length; index++) {
    const placement = level.landmarks[index]
    if (!isTarget(placement) || world.landmarks[index].broken || world.areas[placement.area]?.status !== 'sealed') continue
    for (const cell of placement.cells) {
      const column = cell % grid.columns
      const row = (cell - column) / grid.columns
      const floor = cellFloor(grid, column, row)
      const height = clamp(cellTop(grid, column, row) - floor, 0.2, AUTOPILOT.targetAimHeight * 2)
      const aim = { x: column + 0.5, y: row + 0.5, z: floor + height / 2 }
      const reach = distance(player.pos, aim)
      if (!best || reach < best.reach) best = { index, aim, reach, clear: false }
    }
  }
  if (!best) return null
  best.clear = level.landmarkAt[firstSolid(grid, playerEye(player), best.aim, blocksBullets)] === best.index
  return best
}

function besideTarget(world: World, index: number): number[] {
  const { grid } = world
  const own = new Set(world.level.landmarks[index].cells)
  const cells = new Set<number>()
  for (const cell of own) {
    const column = cell % grid.columns
    const row = (cell - column) / grid.columns
    for (const [dc, dr] of NEIGHBORS) {
      const next = (row + dr) * grid.columns + column + dc
      if (!own.has(next) && !blocksMovement(tileAt(grid, column + dc, row + dr))) cells.add(next)
    }
  }
  return [...cells]
}

function approach(
  world: World,
  goal: Demolition | null,
  fieldFor: (goal: Demolition) => Float32Array,
  walk: (field: Float32Array) => Vec2 | null,
): Vec2 | null {
  if (!goal) return null
  const { player } = world
  if (goal.clear && goal.reach <= weaponOf(world, activeWeaponId(player)).range - 0.3) return { x: 0, y: 0 }
  return walk(fieldFor(goal))
}

function guarded(world: World, enemy: Enemy): boolean {
  const { player } = world
  const range = distance(player.pos, enemy.pos)
  if (range < 1e-6) return false
  return shieldBlocks(world, enemy, (enemy.pos.x - player.pos.x) / range, (enemy.pos.y - player.pos.y) / range)
}

function engage(
  world: World,
  target: Enemy | null,
  fieldToward: (enemy: Enemy) => Float32Array,
  walk: (field: Float32Array) => Vec2 | null,
  kite = false,
): Vec2 | null {
  if (!target) return null
  const { player, grid } = world
  const locked = world.areas[world.areaIndex]?.status === 'locked'
  if (!target.aggro && !locked) return null
  const range = distance(player.pos, target.pos)
  if (guarded(world, target) && range <= AUTOPILOT.keepMax + 1) {
    const side = Math.sin(world.time * 0.4 + target.id) >= 0 ? 1 : -1
    const toward = range < AUTOPILOT.flankRange ? -0.35 : 0.35
    return normalize(
      (target.pos.y - player.pos.y) * side + (target.pos.x - player.pos.x) * toward,
      (player.pos.x - target.pos.x) * side + (target.pos.y - player.pos.y) * toward,
    )
  }
  if (range < AUTOPILOT.keepMin && target.kind !== 'turret') {
    const away = normalize(player.pos.x - target.pos.x, player.pos.y - target.pos.y)
    if (!away) return away
    return kite || !roomFor(world, away) ? sidestep(world, away) : away
  }
  const visible = canHit(world, aimPointOf(target))
  if (visible && range <= AUTOPILOT.keepMax) {
    const side = Math.sin(world.time * 0.9) >= 0 ? 1 : -1
    return normalize((target.pos.y - player.pos.y) * side, (player.pos.x - target.pos.x) * side)
  }
  if (corridorClear(grid, player.pos, target.pos, player.radius)) {
    return normalize(target.pos.x - player.pos.x, target.pos.y - player.pos.y)
  }
  return walk(fieldToward(target))
}

function smashTarget(world: World): Enemy | null {
  const { player, grid } = world
  let best: Enemy | null = null
  let bestGap = Infinity
  for (const enemy of world.enemies) {
    if (enemy.hp <= 0 || enemy.kind === 'boss' || !crumbling(world, enemy)) continue
    const gap = distance(enemy.pos, player.pos) - enemy.radius
    if (gap > AUTOPILOT.smashRange || gap >= bestGap) continue
    if (!corridorClear(grid, player.pos, enemy.pos, player.radius * AUTOPILOT.kiteSlim)) continue
    if (!lineClear(grid, playerChest(player), centerOf(enemy))) continue
    best = enemy
    bestGap = gap
  }
  return best
}

function meleeReady(world: World, enemy: Enemy): boolean {
  const { player, tuning } = world
  if (player.meleeCooldown > 0) return false
  return distance(enemy.pos, player.pos) - enemy.radius <= tuning.player.meleeRange - AUTOPILOT.meleeMargin
}

function snack(world: World): Vec2 | null {
  const { player, grid } = world
  if (player.hp >= player.maxHp * AUTOPILOT.healBelow) return null
  let best: Vec2 | null = null
  let bestGap: number = AUTOPILOT.snackRange
  for (const pickup of world.pickups) {
    if (pickup.item.type !== 'heal') continue
    const gap = distance(player.pos, pickup.pos)
    if (gap >= bestGap || Math.abs(player.z - floorAt(grid, pickup.pos.x, pickup.pos.y)) > PICKUP_REACH_UP) continue
    if (!corridorClear(grid, player.pos, pickup.pos, player.radius)) continue
    best = pickup.pos
    bestGap = gap
  }
  return best ? normalize(best.x - player.pos.x, best.y - player.pos.y) : null
}

function closeIn(world: World, enemy: Enemy): Vec2 | null {
  const { player } = world
  if (player.hp >= player.maxHp * AUTOPILOT.smashBelow && enemy.status.dazed <= 0) return null
  const gap = distance(enemy.pos, player.pos) - enemy.radius
  if (gap <= world.tuning.player.meleeRange - AUTOPILOT.meleeMargin) return { x: 0, y: 0 }
  return normalize(enemy.pos.x - player.pos.x, enemy.pos.y - player.pos.y)
}

function interruptible(world: World): boolean {
  const { player, tuning } = world
  const half = (tuning.player.meleeArcDeg * Math.PI) / 360
  for (const enemy of world.enemies) {
    if (enemy.hp <= 0 || enemy.kind !== 'grunt' || enemy.state !== 'windup') continue
    const dx = enemy.pos.x - player.pos.x
    const dy = enemy.pos.y - player.pos.y
    const gap = Math.hypot(dx, dy)
    if (gap - enemy.radius > tuning.player.meleeRange - AUTOPILOT.meleeMargin) continue
    let turn = Math.atan2(dy, dx) - player.facing
    while (turn > Math.PI) turn -= Math.PI * 2
    while (turn < -Math.PI) turn += Math.PI * 2
    if (Math.abs(turn) <= half) return true
  }
  return false
}

function sidestep(world: World, away: Vec2): Vec2 {
  const { player, grid } = world
  const slim = player.radius * AUTOPILOT.kiteSlim
  const room = (dir: Vec2) => {
    let reach = 0
    while (reach < AUTOPILOT.kiteRoom) {
      const next = reach + AUTOPILOT.bladeSample
      if (!corridorClear(grid, player.pos, { x: player.pos.x + dir.x * next, y: player.pos.y + dir.y * next }, slim)) break
      reach = next
    }
    return reach
  }
  const heading = Math.atan2(away.y, away.x)
  let best = away
  let bestScore = room(away)
  for (const turn of AUTOPILOT.kiteTurns) {
    for (const side of [1, -1]) {
      const angle = heading + turn * side
      const dir = { x: Math.cos(angle), y: Math.sin(angle) }
      const score = room(dir) - turn * AUTOPILOT.kiteTurnCost
      if (score > bestScore + 1e-6) {
        best = dir
        bestScore = score
      }
    }
  }
  return best
}

function roomFor(world: World, dir: Vec2): boolean {
  const { player } = world
  const end = { x: player.pos.x + dir.x * AUTOPILOT.dodgeRoom, y: player.pos.y + dir.y * AUTOPILOT.dodgeRoom }
  return corridorClear(world.grid, player.pos, end, player.radius * AUTOPILOT.kiteSlim)
}

function circleBehind(world: World, target: Enemy): Vec2 | null {
  const { player } = world
  const range = distance(player.pos, target.pos)
  if (range > AUTOPILOT.keepMax + 1) return null
  const bearing = Math.atan2(player.pos.y - target.pos.y, player.pos.x - target.pos.x)
  const behind = target.facing + Math.PI
  let diff = behind - bearing
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  const preferred = diff >= 0 ? 1 : -1
  const ring = AUTOPILOT.siegeRing
  const toward = range < ring - 0.5 ? -0.6 : range > ring + 0.6 ? 0.6 : 0
  const dx = (target.pos.x - player.pos.x) / Math.max(range, 1e-6)
  const dy = (target.pos.y - player.pos.y) / Math.max(range, 1e-6)
  for (const side of [preferred, -preferred]) {
    const move = normalize(dy * side + dx * toward, -dx * side + dy * toward)
    if (!move) continue
    const ahead = { x: player.pos.x + move.x * AUTOPILOT.siegeProbe, y: player.pos.y + move.y * AUTOPILOT.siegeProbe }
    if (corridorClear(world.grid, player.pos, ahead, player.radius)) return move
  }
  return null
}

function huntBoss(world: World): Enemy | null {
  const boss = world.boss
  if (!boss?.boss || boss.hp <= 0 || boss.boss.phase === 'dormant' || boss.area !== world.areaIndex) return null
  return boss
}

function tankBoss(world: World): Enemy | null {
  const boss = world.boss
  if (!boss?.boss || boss.hp <= 0 || boss.boss.phase === 'dormant') return null
  return getBoss(boss.boss.id).ram ? boss : null
}

function maneuver(
  world: World,
  boss: Enemy,
  fieldTo: (key: string, pos: Vec2) => Float32Array,
  walk: (field: Float32Array) => Vec2 | null,
): Vec2 | null {
  const state = boss.boss
  if (!state) return null
  const def = getBoss(state.id)
  const ram = def.ram
  if (!ram || state.phase === 'stunned' || state.phase === 'telegraph' || state.phase === 'active') return null
  const spot = baitSpot(world, boss, def, ram.into, ram.stuns)
  return spot ? goTo(world, spot, fieldTo, walk) : null
}

function laneEscape(world: World, boss: Enemy, margin: number): Vec2 | null {
  const state = boss.boss
  if (!state) return null
  const def = getBoss(state.id)
  const triple = def.triple
  if (!triple) return null
  const { player, grid } = world
  const lanes = tripleLanes(boss, def).map((angle) => ({ x: Math.cos(angle), y: Math.sin(angle) }))
  const width = weaponOf(world, triple.weapon).radius + player.radius + margin
  const inside = (x: number, y: number) => lanes.some((lane) => x * lane.x + y * lane.y > 0 && Math.abs(-x * lane.y + y * lane.x) < width)
  const dx = player.pos.x - boss.pos.x
  const dy = player.pos.y - boss.pos.y
  if (!inside(dx, dy)) return null
  const across = { x: -Math.sin(boss.aimAngle), y: Math.cos(boss.aimAngle) }
  let best: { side: number; gap: number } | null = null
  for (const side of [1, -1]) {
    for (let gap = LANE_STEP; gap <= AUTOPILOT.laneReach; gap += LANE_STEP) {
      const x = dx + across.x * side * gap
      const y = dy + across.y * side * gap
      if (blocksMovement(tileAt(grid, Math.floor(boss.pos.x + x), Math.floor(boss.pos.y + y)))) break
      if (inside(x, y)) continue
      if (!best || gap < best.gap) best = { side, gap }
      break
    }
  }
  const side = best?.side ?? 1
  return { x: across.x * side, y: across.y * side }
}

function mineAhead(world: World, step: Vec2): Mine | null {
  const { player } = world
  const reach = AUTOPILOT.mineLook
  for (const mine of world.mines) {
    if (mine.fuse >= 0) continue
    const rule = mineRule(mine)
    if (!rule) continue
    const dx = mine.pos.x - player.pos.x
    const dy = mine.pos.y - player.pos.y
    const along = Math.max(0, Math.min(reach, dx * step.x + dy * step.y))
    const gap = Math.hypot(dx - step.x * along, dy - step.y * along)
    if (gap < rule.trigger + player.radius + AUTOPILOT.mineMargin) return mine
  }
  return null
}

function nearestMine(world: World): Mine | null {
  let best: Mine | null = null
  for (const mine of world.mines) {
    if (!best || distance(mine.pos, world.player.pos) < distance(best.pos, world.player.pos)) best = mine
  }
  return best
}

function mineInLine(world: World, aimX: number, aimY: number): boolean {
  const { player } = world
  const dir = normalize(aimX - player.pos.x, aimY - player.pos.y)
  if (!dir) return false
  for (const mine of world.mines) {
    const rule = mineRule(mine)
    if (!rule) continue
    const dx = mine.pos.x - player.pos.x
    const dy = mine.pos.y - player.pos.y
    const along = dx * dir.x + dy * dir.y
    const blast = weaponOf(world, rule.weapon).explodeRadius + player.radius + AUTOPILOT.mineMargin
    if (along <= 0 || Math.hypot(dx, dy) > blast) continue
    if (Math.abs(-dx * dir.y + dy * dir.x) <= mineRadius(world, mine) + MINE_BULLET) return true
  }
  return false
}

function guardBoss(world: World): Enemy | null {
  const boss = world.boss
  if (!boss?.boss || boss.hp <= 0 || boss.boss.phase === 'dormant') return null
  return getBoss(boss.boss.id).guard ? boss : null
}

function outwit(
  world: World,
  boss: Enemy,
  fieldTo: (key: string, pos: Vec2) => Float32Array,
  walk: (field: Float32Array) => Vec2 | null,
): Vec2 | null {
  const state = boss.boss
  if (!state) return null
  const def = getBoss(state.id)
  const guard = def.guard
  if (!guard) return null
  const { player } = world
  const gap = distance(player.pos, boss.pos)
  if (state.phase === 'stunned' || !state.shield?.held) return goTo(world, flankPoint(world, boss, AUTOPILOT.stunGap), fieldTo, walk)
  if (state.phase === 'recover' || state.phase === 'active' || (state.phase === 'telegraph' && state.move !== 'charge')) {
    return goTo(world, flankPoint(world, boss, AUTOPILOT.behindGap), fieldTo, walk)
  }
  if (state.phase !== 'walk' && state.phase !== 'intro') return null
  if (nextMove(state, def) === 'bash' && gap < AUTOPILOT.kiteGap) return normalize(player.pos.x - boss.pos.x, player.pos.y - boss.pos.y)
  const spot = baitSpot(world, boss, def, guard.crashInto, guard.crashStuns)
  return spot ? goTo(world, spot, fieldTo, walk) : null
}

function baitSpot(world: World, boss: Enemy, def: BossDef, into: LandmarkId, stuns: number): Vec2 | null {
  const { player, grid, level } = world
  let best: Vec2 | null = null
  let bestScore = Infinity
  level.landmarks.forEach((placement, index) => {
    if (placement.id !== into || world.landmarks[index].crashes >= stuns) return
    const center = landmarkCenter(placement)
    const away = normalize(boss.pos.x - center.x, boss.pos.y - center.y)
    if (!away) return
    const half = Math.max(placement.width, placement.depth) / 2
    const offset = half + player.radius + AUTOPILOT.baitGap
    const spot = { x: center.x + away.x * offset, y: center.y + away.y * offset }
    if (blocksMovement(tileAt(grid, Math.floor(spot.x), Math.floor(spot.y)))) return
    const run = distance(boss.pos, center) - half
    const score = distance(player.pos, spot) + (run > def.charge.distance ? AUTOPILOT.baitTooFar : 0)
    if (score < bestScore) {
      best = spot
      bestScore = score
    }
  })
  return best
}

function flankPoint(world: World, boss: Enemy, gap: number): Vec2 {
  const { grid, player } = world
  const forwardX = Math.cos(boss.facing)
  const forwardY = Math.sin(boss.facing)
  const offsets = [
    [-1, 0],
    [-0.7, 0.7],
    [-0.7, -0.7],
    [0, 1],
    [0, -1],
  ] as const
  let best: Vec2 | null = null
  let bestScore = Infinity
  for (const [back, side] of offsets) {
    const x = boss.pos.x + (forwardX * back + forwardY * side) * gap
    const y = boss.pos.y + (forwardY * back - forwardX * side) * gap
    if (blocksMovement(tileAt(grid, Math.floor(x), Math.floor(y)))) continue
    const score = Math.hypot(x - player.pos.x, y - player.pos.y) + Math.abs(side) * 1.5
    if (score < bestScore) {
      best = { x, y }
      bestScore = score
    }
  }
  return best ?? { x: player.pos.x, y: player.pos.y }
}

function goTo(world: World, spot: Vec2, fieldTo: (key: string, pos: Vec2) => Float32Array, walk: (field: Float32Array) => Vec2 | null): Vec2 {
  const { player, grid } = world
  if (distance(player.pos, spot) < 0.3) return { x: 0, y: 0 }
  if (corridorClear(grid, player.pos, spot, player.radius)) return normalize(spot.x - player.pos.x, spot.y - player.pos.y) ?? { x: 0, y: 0 }
  const field = fieldTo(`spot:${tileIndex(grid, spot)}`, spot)
  return walk(field) ?? normalize(spot.x - player.pos.x, spot.y - player.pos.y) ?? { x: 0, y: 0 }
}

function ringTiming(world: World, ring: Ring, move: Vec2 | null, offset: number): RingAction | null {
  const { player, tuning } = world
  const dx = player.pos.x - ring.x
  const dy = player.pos.y - ring.y
  const gap = Math.hypot(dx, dy)
  if (gap - player.radius > ring.maxRadius) return null
  const need = ring.z + ring.height - player.z
  if (need <= 0) return null
  if (!player.grounded) return null
  const pace = world.playerStats.speed * playerSpeedFactor(player)
  const radial = gap > 1e-6 && move ? ((move.x * dx + move.y * dy) / gap) * pace : 0
  const closing = Math.max(AUTOPILOT.ringSlowest, ring.speed - radial)
  const arrive = (gap - player.radius - ring.radius) / closing
  const leave = (gap + player.radius - ring.radius) / closing + STEP_SECONDS
  if (leave < 0) return null
  const gravity = tuning.player.gravity
  const launch = Math.sqrt(2 * gravity * tuning.player.jumpHeight)
  const apex = launch / gravity
  const room = launch * launch - 2 * gravity * need
  const dashWindow = tuning.player.dashTime
  if (room <= 0) return arrive <= dashWindow / 2 && arrive >= -STEP_SECONDS ? 'dash' : null
  const rise = (launch - Math.sqrt(room)) / gravity
  if ((arrive + leave) / 2 > apex + offset) return null
  if (offset === 0 && arrive < rise) return arrive <= dashWindow / 2 ? 'dash' : null
  return 'jump'
}

function ringCenter(world: World): Vec2 | null {
  let best: Ring | null = null
  let bestGap = Infinity
  for (const ring of world.rings) {
    if (ring.hitPlayer) continue
    const gap = Math.abs(Math.hypot(world.player.pos.x - ring.x, world.player.pos.y - ring.y) - ring.radius)
    if (gap < bestGap) {
      best = ring
      bestGap = gap
    }
  }
  return best ? { x: best.x, y: best.y } : null
}

function threats(world: World, kite = false): Threat[] {
  const { player } = world
  const margin = AUTOPILOT.dodgeMargin
  const found: Threat[] = []
  for (const blast of world.blasts) {
    if (blast.delay <= 0 || blast.playerDamage <= 0) continue
    if (insideBlast(blast, player.pos.x, player.pos.y, player.radius + margin)) {
      const away = normalize(player.pos.x - blast.x, player.pos.y - blast.y) ?? { x: 1, y: 0 }
      found.push({ key: `blast:${blast.id}`, move: away })
    }
  }
  for (const lob of world.lobs) {
    if (lob.team !== 'enemy' || lob.total - lob.time > AUTOPILOT.lobWarning) continue
    if (distance(player.pos, lob.to) < lob.radius + player.radius + margin) {
      const away = normalize(player.pos.x - lob.to.x, player.pos.y - lob.to.y) ?? { x: 1, y: 0 }
      found.push({ key: `lob:${lob.id}`, move: away })
    }
  }
  for (const enemy of world.enemies) {
    if (enemy.hp <= 0) continue
    if (enemy.kind === 'grunt' && enemy.state === 'windup') {
      if (distance(player.pos, enemy.pos) < meleeReach(world, enemy) + margin) {
        found.push({ key: `claw:${enemy.id}`, move: normalize(player.pos.x - enemy.pos.x, player.pos.y - enemy.pos.y) })
      }
    }
    const lane = attackLane(world, enemy)
    if (lane && lane.along > -1 && lane.along < lane.length && Math.abs(lane.across) < lane.width + margin) {
      found.push({ key: lane.key, move: lateral(world, lane.dirX, lane.dirY, lane.across) })
    }
    const state = enemy.boss
    const charging = state && (state.move === 'charge' || state.move === 'frenzy') && (state.phase === 'telegraph' || (kite && state.phase === 'active'))
    if (state && charging && (state.move === 'charge' || kite)) {
      const along = (player.pos.x - enemy.pos.x) * state.chargeX + (player.pos.y - enemy.pos.y) * state.chargeY
      const across = (player.pos.x - enemy.pos.x) * -state.chargeY + (player.pos.y - enemy.pos.y) * state.chargeX
      if (along > -1 && along < chargeLength(enemy) && Math.abs(across) < enemy.radius + player.radius + margin) {
        let move = lateral(world, state.chargeX, state.chargeY, across)
        if (kite) {
          const side = across >= 0 ? 1 : -1
          const flip = !roomFor(world, { x: -state.chargeY * side, y: state.chargeX * side }) ? -side : side
          move = { x: -state.chargeY * flip, y: state.chargeX * flip }
        }
        found.push({ key: `charge:${enemy.id}${state.phase === 'active' ? ':run' : ''}`, move })
      }
    }
    if (state && state.phase === 'telegraph' && state.move === 'triple') {
      const escape = laneEscape(world, enemy, AUTOPILOT.laneMargin)
      if (escape) found.push({ key: `triple:${enemy.id}`, move: escape })
    }
    if (state && state.phase === 'telegraph' && state.move === 'cannon') {
      const line = cannonLine(world, enemy)
      if (line && line.along > 0 && Math.abs(line.across) < line.width + margin) {
        found.push({ key: `cannon:${enemy.id}`, move: lateral(world, line.dirX, line.dirY, line.across) })
      }
    }
  }
  for (const bullet of world.bullets) {
    if (bullet.team !== 'enemy') continue
    const dx = player.pos.x - bullet.pos.x
    const dy = player.pos.y - bullet.pos.y
    const along = dx * bullet.dirX + dy * bullet.dirY
    if (along < 0 || along > AUTOPILOT.bulletWarning) continue
    const across = dx * -bullet.dirY + dy * bullet.dirX
    if (Math.abs(across) < player.radius + bullet.radius + AUTOPILOT.bulletMargin) {
      found.push({ key: `bullet:${bullet.id}`, move: lateral(world, bullet.dirX, bullet.dirY, across) })
    }
  }
  return found
}

function lateral(world: World, dirX: number, dirY: number, across: number): Vec2 {
  let side = across >= 0 ? 1 : -1
  if (!roomFor(world, { x: -dirY * side, y: dirX * side }) && roomFor(world, { x: dirY * side, y: -dirX * side })) side = -side
  return { x: -dirY * side, y: dirX * side }
}

function attackLane(
  world: World,
  enemy: Enemy,
): { key: string; along: number; across: number; width: number; length: number; left: number; dirX: number; dirY: number } | null {
  const { player, tuning } = world
  const start = (world.time - enemy.stateTime).toFixed(2)
  const dirX = Math.cos(enemy.aimAngle)
  const dirY = Math.sin(enemy.aimAngle)
  const dx = player.pos.x - enemy.pos.x
  const dy = player.pos.y - enemy.pos.y
  const along = dx * dirX + dy * dirY
  const across = dx * -dirY + dy * dirX
  if (enemy.kind === 'grunt' && (enemy.state === 'charge' || enemy.state === 'dash')) {
    const rush = tuning.weapons.rush
    const left = enemy.state === 'charge' ? rush.windup - enemy.stateTime : 0
    const width = enemy.radius + player.radius + rush.radius
    return { key: `rush:${enemy.id}:${start}`, along, across, width, length: rush.range + enemy.radius + 1, left, dirX, dirY }
  }
  if (enemy.kind === 'gunner' && enemy.state === 'aim' && enemy.stateTime >= tuning.weapons.rifle.windup * trackShare(world)) {
    const rifle = tuning.weapons.rifle
    const left = rifle.windup - enemy.stateTime + Math.max(0, along) / rifle.speed
    return { key: `aim:${enemy.id}:${start}`, along, across, width: rifle.radius + player.radius, length: rifle.range, left, dirX, dirY }
  }
  return null
}

function cannonLine(world: World, boss: Enemy): { along: number; across: number; width: number; dirX: number; dirY: number } | null {
  const id = boss.boss ? getBoss(boss.boss.id).cannon?.weapon : undefined
  if (!id) return null
  const { player } = world
  const dirX = Math.cos(boss.aimAngle)
  const dirY = Math.sin(boss.aimAngle)
  const dx = player.pos.x - boss.pos.x
  const dy = player.pos.y - boss.pos.y
  return { along: dx * dirX + dy * dirY, across: dx * -dirY + dy * dirX, width: weaponOf(world, id).radius + player.radius, dirX, dirY }
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function normalize(x: number, y: number): Vec2 | null {
  const length = Math.hypot(x, y)
  return length < 1e-6 ? null : { x: x / length, y: y / length }
}
