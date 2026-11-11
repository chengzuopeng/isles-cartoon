import './style.css'
import './ui/fps.css'
import * as THREE from 'three'
import { createMusic } from './audio/music'
import { createSfx } from './audio/sfx'
import { createSoundtrackState, trackFor } from './audio/soundtrack'
import { createFixedStep } from './core/fixed-step'
import { loadSettings, saveSettings, type Settings } from './core/settings'
import { readJson, removeKey, writeJson } from './core/storage'
import { AUTOPILOT_KITE_LEVELS, AUTOPILOT_ONWARD_LEVELS, AUTOPILOT_SIEGE_LEVELS, type AutopilotSkillId } from './data/autopilot'
import { BOSSES } from './data/bosses'
import type { DifficultyId } from './data/difficulty'
import { INTERLUDES, STORIES } from './data/dialogue'
import type { MinionKind } from './data/enemies'
import { LEVEL_1_1 } from './data/levels/level-1-1'
import { LEVEL_1_2 } from './data/levels/level-1-2'
import { LEVEL_1_3 } from './data/levels/level-1-3'
import { LEVEL_1_4 } from './data/levels/level-1-4'
import { LEVEL_1_5 } from './data/levels/level-1-5'
import { TRAINING } from './data/levels/training'
import { TRIAL_HARVESTER } from './data/levels/trial-harvester'
import { TRIAL_SYSTEMS } from './data/levels/trial-systems'
import type { LevelDef } from './data/levels/types'
import { HEAL_SMALL, type BuffId, type DropType } from './data/loot'
import type { TrackId } from './data/music'
import type { AttributeId } from './data/progression'
import { SLOT_UNLOCK_LEVEL, type SkillId, type SkillSlot } from './data/skills'
import { CHAIN_WORDS } from './data/chains'
import { createDefaultTuning, type Tuning } from './data/tuning'
import type { PlayerWeaponId } from './data/weapons'
import { createFpsInput } from './input/fps-input'
import { loadKeys, saveKeys } from './input/keymap'
import { GRASS_EYE_HEIGHT, loadLookSettings, saveLookSettings } from './input/look-settings'
import { RESIDENT_MODEL_IDS, VIEWMODEL_MODEL_IDS, type ModelId } from './render/asset-urls'
import { createEffects } from './render/effects'
import { createPropFires } from './render/prop-fires'
import { createEntityViews, type EntityViews, type ViewFlags } from './render/entity-views'
import { createFpsLevelView, type FpsLevelView } from './render/fps-level-view'
import { createFpsStage, type ViewMode } from './render/fps-stage'
import { gltfSource } from './render/gltf-source'
import { levelsToKeep, modelsFor, nextLevel } from './render/level-models'
import { createModelLibrary } from './render/model-library'
import { createPickupViews, type PickupViews } from './render/pickup-views'
import { muzzleSource, shareMuzzle } from './render/muzzle-link'
import { createProjectileViews, type ProjectileViews } from './render/projectile-views'
import { createRingViews } from './render/ring-views'
import type { RenderInfo } from './render/stage'
import { LEVEL_CACHE } from './render/themes'
import { toonify } from './render/toon'
import { createViewmodel } from './render/viewmodel'
import { giveSpecialWeapon } from './sim/arsenal'
import { createAutopilot } from './sim/autopilot'
import { giveBuff } from './sim/buffs'
import {
  breakTargets,
  clearCurrentArea,
  dropNearPlayer,
  lightLamps,
  openPens,
  raiseAlarms,
  randomAffixes,
  spawnEnemyNear,
  teleportToArea,
  teleportToBoss,
} from './sim/cheats'
import { buildLevel, validateLevel, type BuiltLevel } from './sim/level'
import { lerp } from './sim/math'
import { sneakReady } from './sim/melee'
import { dashGauge } from './sim/player'
import { playerHidden } from './sim/perception'
import { makeItem, weaponItem } from './sim/pickups'
import {
  allocate,
  createProfile,
  equipSkill,
  grantXp,
  keepClues,
  learnSkill,
  levelUnlocked,
  loadoutOf,
  markInterlude,
  nextSeed,
  pendingInterlude,
  resetSkills,
  respec,
  sanitizeProfile,
  settleRun,
  skillBlock,
  variedRun,
  xpScaleFor,
  xpToNext,
  type Profile,
} from './sim/profile'
import { levelChallenges, rateRun } from './sim/rating'
import { stepWorld } from './sim/step'
import { runTallies } from './sim/tallies'
import type { GameEvent, PlayerCommand } from './sim/types'
import { createWorld, type DebugFlags, type World } from './sim/world'
import { createBountyCard } from './ui/bounty-card'
import { createDamageNumbers } from './ui/damage-numbers'
import { createDialogue } from './ui/dialogue'
import { createFpsOverlay } from './ui/fps-overlay'
import { createHud } from './ui/hud'
import { createMapOverlay } from './ui/map-overlay'
import { createNoticeMarks } from './ui/notice-marks'
import { createPrepScreen } from './ui/prep-screen'
import { createResults } from './ui/results'
import { appendRunLog, readRunLog, summarizeRun, type RunLogEntry, type RunResult } from './ui/run-log'
import { createSettingsPanel } from './ui/settings-panel'
import { createSfxWords, streakLabel, streakStep, STREAK_WORDS, type SfxWord } from './ui/sfx-words'
import { createTips } from './ui/tips'

type Screen = 'prep' | 'play'

interface GameDebugHandle {
  readonly world: World
  readonly tuning: Tuning
  readonly profile: Profile
  readonly paused: boolean
  readonly screen: Screen
  readonly difficulty: DifficultyId
  readonly music: TrackId | null
  readonly models: readonly string[]
  readonly level: string
  readonly view: ViewMode
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly debug: DebugFlags
  start(): void
  startLevel(id?: string): Promise<void>
  openPrep(): void
  restart(): void
  teleport(area: number): void
  teleportToBoss(): void
  setDifficulty(id: DifficultyId): void
  setAutopilot(on: boolean, skill?: AutopilotSkillId): void
  advance(seconds: number, interact?: boolean): void
  freeze(on: boolean): void
  act(next: Partial<PlayerCommand>, seconds: number): void
  skipDialogue(): void
  playInterlude(id: string): void
  setView(mode: ViewMode): void
  look(yaw: number, pitch: number): void
  setStyle(toggles: Partial<Record<'toon' | 'outline' | 'halftone' | 'bloom' | 'grade', boolean>>): unknown
  styleInfo(): unknown
  freeCamera(x: number, y: number, z: number, yaw: number, pitch: number): void
  giveWeapon(id: PlayerWeaponId): void
  giveBuff(id: BuffId): void
  drop(type: DropType): void
  addXp(amount: number): void
  allocate(id: AttributeId): void
  learnSkill(id: SkillId): void
  equipSkill(id: SkillId, slot: SkillSlot): void
  unlockSlotE(): void
  chargeUltimate(): void
  resetSave(): void
  breakTargets(area?: number): number
  openPens(area?: number): number
  raiseAlarms(): number
  lightLamps(area?: number): number
  runLog(): RunLogEntry[]
  toScreen(x: number, y: number): { x: number; y: number }
  renderInfo(): RenderInfo
}

declare global {
  interface Window {
    __game?: GameDebugHandle
  }
}

const SAVE_KEY = 'isles-cartoon.save.v1'
const ELITE_KINDS: readonly MinionKind[] = ['grunt', 'gunner', 'shield', 'thrower']
const VIEWMODEL_MODELS: readonly ModelId[] = ['blaster', ...VIEWMODEL_MODEL_IDS]
const DEG = Math.PI / 180
const BOB_HEIGHT = 0.035
const BOB_RATE = 2.2
const STEP_EASE = 14
const HIT_ROLL = { perKnock: 0.004, max: 0.05, stiffness: 140, damping: 16 } as const
const STEP_SNAP = 1.2

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('#app not found')
const container: HTMLDivElement = app
container.classList.add('fps-mode')

const devTools = import.meta.env.DEV ? await import('./ui/tuning-panel') : null
const training = Boolean(devTools) && new URLSearchParams(location.search).get('mode') === 'arena'
const levels: readonly LevelDef[] = training ? [TRAINING] : [LEVEL_1_1, LEVEL_1_2, LEVEL_1_3, LEVEL_1_4, LEVEL_1_5, TRIAL_SYSTEMS, TRIAL_HARVESTER]
const builtLevels = new Map<string, BuiltLevel>()
const levelModels = new Map<string, ModelId[]>()
let levelDef = levels[0]
let level = builtOf(levelDef)

const tuning = createDefaultTuning()
devTools?.loadTuningOverrides(tuning)
const debug: DebugFlags = { invincible: false, noWaves: false }
const viewFlags: ViewFlags = { showSight: false }
let profile = sanitizeProfile(readJson(SAVE_KEY))
let seed = 1
const toggles: { autopilot: boolean; autopilotSkill: AutopilotSkillId } = { autopilot: false, autopilotSkill: 'perfect' }
let autopilot = pilot()
const settings = loadSettings()
const look = loadLookSettings()
const keys = loadKeys()
let world = newWorld()
let screen: Screen = training ? 'play' : 'prep'
let paused = false
let frozen = false
let settled = false
let logged = false
let outroPlayed = false
let interluding = false
let yaw = -Math.PI / 2
let pitch = 0
let eyeDip = 0
let eyeDipVelocity = 0
let bobPhase = 0
let bobAmount = 0
let eyeBase: number | null = null
let crouch = 0
let hitRoll = 0
let hitRollVelocity = 0
let fovKick = 0
let rush = 0
let lastStatus = world.status
const lookDelta = { x: 0, y: 0 }
let meleeBatch = false
const seenIntros = new Set<string>()
const warmed = new Set<string>()
let levelView: FpsLevelView | null = null
let recent: string[] = []
let loading: string | null = null
let wanted: string | null = null
let skipIntro = false
let preparing: Promise<unknown> = Promise.resolve()

const stage = createFpsStage({ container, grid: level.grid, quality: settings, fov: look.fov })
const models = createModelLibrary(gltfSource(stage))
const effects = createEffects(stage.scene)
const propFires = createPropFires(effects)
const sfx = createSfx()
const music = createMusic()
const soundtrack = createSoundtrackState()
const hud = createHud(container, stage, {
  title: levelDef.title,
  subtitle: levelDef.subtitle,
  objective: levelDef.objective,
  training,
  devHints: Boolean(devTools),
  onResume: resume,
  onRestart: startRun,
  onQuit: openPrep,
  onToggleMute: toggleMute,
  onSettings: openSettings,
})
const numbers = createDamageNumbers(container, stage, tuning)
const tips = createTips(container)
let map = createMapOverlay(container, level, Boolean(devTools))
const overlay = createFpsOverlay(container, stage.renderer.domElement)
const words = createSfxWords(container, stage)
const notices = createNoticeMarks(container, stage)
const bounty = createBountyCard(container)
const prep = createPrepScreen(container, {
  missions: levels.map((def) => ({
    id: def.id,
    title: def.title,
    subtitle: def.subtitle,
    objective: def.objective,
    chapter: def.chapter,
    challenges: levelChallenges(builtOf(def)),
    unlockAfter: def.unlockAfter,
    wip: def.wip,
  })),
  isUnlocked: (id, current) => unlocked(id, current),
  onStart: (id) => {
    input.requestLock()
    void startLevel(id)
  },
  onAllocate: spendPoint,
  onRespec: resetPoints,
  onLearn: (id) => changeSkills(() => learnSkill(profile, id)),
  onEquip: (id, slot) => changeSkills(() => equipSkill(profile, id, slot)),
  onResetSkills: () =>
    changeSkills(() => {
      resetSkills(profile)
      return true
    }),
  onSettings: openSettings,
  onInterlude: (id) => playInterlude(id),
  difficulty: () => settings.difficulty,
  onDifficulty: (id) => {
    settings.difficulty = id
    applySettings(settings)
    prep.refresh(profile)
  },
})
const results = createResults(container, {
  onAllocate: spendPoint,
  onReplay: startRun,
  onPrep: openPrep,
  onNext: goNext,
  onLevelUp: () => sfx.cue('levelUp'),
})
const dialogue = createDialogue(container)
const settingsPanel = createSettingsPanel(container, settings, {
  onChange: applySettings,
  onResetTips: () => tips.resetSeen(),
  look,
  onLook: applyLook,
  keys,
  onKeys: () => saveKeys(keys),
})
const input = createFpsInput(stage.canvas, () => keys)
const loop = createFixedStep({ hz: 60 })
const command: PlayerCommand = {
  moveX: 0,
  moveY: 0,
  aimX: 0,
  aimY: 0,
  pitch: 0,
  fire: false,
  slot: null,
  interact: false,
  skill: null,
  ultimate: false,
  jump: false,
  dash: false,
  melee: false,
}
let holdFireUntilRelease = false

let views: EntityViews
let pickupViews: PickupViews
let projectileViews: ProjectileViews
let viewsReady = false
const viewmodel = createViewmodel(models)
const rings = createRingViews(stage.scene)
stage.setOverlay((renderer) => viewmodel.draw(renderer))

const booted = (async () => {
  await models.ensure([...RESIDENT_MODEL_IDS, ...VIEWMODEL_MODELS])
  views = createEntityViews(stage, tuning, effects, viewFlags, models)
  pickupViews = createPickupViews(stage.scene, models)
  projectileViews = createProjectileViews(stage.scene, models, effects)
  const thirdPerson = muzzleSource(stage.scene)
  shareMuzzle(stage.scene, {
    muzzle: (out) => (stage.view === 'fps' ? viewmodel.muzzle(stage.camera, out) : (thirdPerson?.muzzle(out) ?? null)),
  })
  viewsReady = true
})()

input.onLockChange((locked) => {
  if (!locked && screen === 'play' && world.status === 'playing' && !results.isOpen() && !dialogue.isOpen()) setPaused(true)
})

window.addEventListener('pointerdown', unlockAudio)
window.addEventListener('keydown', unlockAudio)
window.addEventListener('blur', () => {
  if (screen === 'play') setPaused(true)
})
stage.canvas.addEventListener('webglcontextlost', () => setPaused(true))
stage.onRestore(async () => {
  warmed.clear()
  await prepare(loading ?? levelDef.id)
})

if (screen === 'prep') {
  prep.show(profile, levelDef.id)
  playPendingInterlude()
}

function build(def: LevelDef): BuiltLevel {
  const built = buildLevel(def)
  if (devTools) {
    const problems = validateLevel(built)
    if (problems.length > 0) console.warn(`level ${def.id} problems`, problems)
  }
  return built
}

function builtOf(def: LevelDef): BuiltLevel {
  let built = builtLevels.get(def.id)
  if (!built) {
    built = build(def)
    builtLevels.set(def.id, built)
  }
  return built
}

function modelsOf(def: LevelDef): ModelId[] {
  let ids = levelModels.get(def.id)
  if (!ids) {
    ids = [...new Set<ModelId>([...modelsFor(builtOf(def)), ...VIEWMODEL_MODELS])]
    levelModels.set(def.id, ids)
  }
  return ids
}

function keptModels(current: string, ahead: string | null): ModelId[] {
  const ids = new Set<ModelId>([...RESIDENT_MODEL_IDS, ...VIEWMODEL_MODELS])
  for (const id of levelsToKeep(current, ahead, recent, LEVEL_CACHE.extraLevels)) {
    const def = levels.find((item) => item.id === id)
    if (def) for (const model of modelsOf(def)) ids.add(model)
  }
  return [...ids]
}

function unlocked(id: string, current: Profile = profile): boolean {
  const def = levels.find((item) => item.id === id)
  return def !== undefined && levelUnlocked(current, def, Boolean(devTools))
}

function nextUnlocked(): LevelDef | null {
  const next = nextLevel(levels, levelDef.id)
  return next && unlocked(next.id) ? next : null
}

function pilot(): ReturnType<typeof createAutopilot> {
  return createAutopilot({
    skill: toggles.autopilotSkill,
    seed,
    siege: AUTOPILOT_SIEGE_LEVELS.includes(levelDef.id),
    onward: AUTOPILOT_ONWARD_LEVELS.includes(levelDef.id),
    kite: AUTOPILOT_KITE_LEVELS.includes(levelDef.id),
  })
}

function newWorld(): World {
  if (training) seed += 1
  else {
    seed = nextSeed(profile, levelDef.id)
    persist()
  }
  return createWorld(level, tuning, {
    seed,
    debug,
    difficulty: settings.difficulty,
    loadout: loadoutOf(profile),
    xpScale: training ? 1 : xpScaleFor(profile, levelDef.id),
    varied: !training && variedRun(profile, levelDef.id, settings.difficulty),
  })
}

function persist(): void {
  if (!training) writeJson(SAVE_KEY, profile)
}

function switchLevel(def: LevelDef, built: BuiltLevel): void {
  levelDef = def
  level = built
  if (levelView) {
    levelView.dispose()
    levelView = null
  }
  resetScene()
  levelView = createFpsLevelView(level, models)
  stage.scene.add(levelView.group)
  stage.setLevel(level.grid)
  map.dispose()
  map = createMapOverlay(container, level, Boolean(devTools))
  hud.setLevel(def)
  devPanel?.setAreas(level.areas.map((area) => area.name))
}

function prepare(id: string): Promise<boolean> {
  wanted = id
  const job = preparing.then(() => readyLevel(id)).catch((error: unknown) => {
    console.error(error)
    return false
  })
  preparing = job
  return job
}

async function readyLevel(id: string): Promise<boolean> {
  await booted
  const def = levels.find((item) => item.id === id)
  const stale = () => wanted !== id
  if (!def || stale()) return false
  const built = builtOf(def)
  models.keep(keptModels(id, null))
  await models.ensure(modelsOf(def))
  if (stale()) return false
  if (def !== levelDef || !levelView) switchLevel(def, built)
  if (!warmed.has(id)) {
    syncViews(0, 1)
    toonify(stage.scene)
    await stage.renderer.compileAsync(stage.scene, stage.camera)
    if (stale()) return false
    warmed.add(id)
  }
  return true
}

function resetScene(): void {
  if (!interluding) dialogue.stop()
  world = newWorld()
  autopilot = pilot()
  settled = false
  logged = false
  outroPlayed = false
  lastStatus = world.status
  loop.reset()
  if (viewsReady) {
    views.reset()
    pickupViews.reset()
    projectileViews.reset()
  }
  rings.reset()
  effects.clear()
  propFires.clear()
  hud.reset()
  numbers.clear()
  tips.clear()
  overlay.clear()
  words.clear()
  notices.clear()
  bounty.hide()
  Object.assign(soundtrack, createSoundtrackState())
  results.hide()
  if (map.isOpen()) map.toggle()
  yaw = world.player.facing
  pitch = 0
  bobAmount = 0
  eyeBase = null
  crouch = 0
  hitRoll = 0
  hitRollVelocity = 0
  stage.look(yaw, pitch)
}

async function startLevel(id: string = levelDef.id): Promise<void> {
  if (!unlocked(id) || loading) return
  if (screen !== 'prep' && !training) openPrep()
  loading = id
  skipIntro = false
  prep.setLoading(id)
  const ready = await prepare(id)
  loading = null
  prep.setLoading(null)
  if (!ready || levelDef.id !== id || !levelView) return
  resetScene()
  syncViews(0, 1)
  beginRun()
  const intro = STORIES[levelDef.id]?.intro
  if (training || !intro || seenIntros.has(levelDef.id)) return
  seenIntros.add(levelDef.id)
  if (skipIntro) return
  dialogue.play(intro, () => {
    holdFireUntilRelease = true
  })
}

function startRun(): void {
  if (!levelView) {
    void startLevel(levelDef.id)
    return
  }
  resetScene()
  beginRun()
}

function beginRun(): void {
  stopInterlude()
  recent = [levelDef.id, ...recent.filter((id) => id !== levelDef.id)].slice(0, LEVEL_CACHE.extraLevels + 1)
  prep.hide()
  screen = 'play'
  setPaused(false)
  holdFireUntilRelease = true
  input.requestLock()
  sfx.cue('start')
}

function goNext(): void {
  const next = nextUnlocked()
  if (!next) {
    openPrep()
    return
  }
  input.requestLock()
  void startLevel(next.id)
}

function openPrep(): void {
  if (training) {
    startRun()
    return
  }
  stopInterlude()
  resetScene()
  screen = 'prep'
  setPaused(false)
  input.releaseLock()
  prep.show(profile, levelDef.id)
  playPendingInterlude()
  void prepare(levelDef.id)
}

function playPendingInterlude(): void {
  const interlude = pendingInterlude(profile)
  if (interlude) playInterlude(interlude.id)
}

function playInterlude(id: string): void {
  const interlude = INTERLUDES.find((item) => item.id === id)
  if (training || !interlude || screen !== 'prep' || loading || dialogue.isOpen()) return
  if (markInterlude(profile, interlude.id)) persist()
  interluding = true
  prep.setStaged(true)
  dialogue.play(interlude.lines, () => {
    interluding = false
    prep.setStaged(false)
    prep.refresh(profile)
  })
}

function stopInterlude(): void {
  if (!interluding) return
  interluding = false
  dialogue.stop()
  prep.setStaged(false)
}

function resume(): void {
  input.requestLock()
  setPaused(false)
}

function setPaused(next: boolean): void {
  paused = next && screen === 'play' && world.status === 'playing' && !results.isOpen() && !dialogue.isOpen()
  hud.setPaused(paused, sfx.isMuted())
}

function applySettings(next: Settings): void {
  saveSettings(next)
  stage.setQuality(next)
  stage.setShakeScale(next.shake)
  numbers.setDamageVisible(next.damageNumbers)
  tips.setEnabled(next.tips && !training)
}

function applyLook(): void {
  saveLookSettings(look)
  stage.setFov(look.fov)
}

function openSettings(): void {
  input.releaseLock()
  settingsPanel.open()
}

function unlockAudio(): void {
  sfx.unlock()
  music.unlock()
}

function currentTrack(): TrackId | null {
  if (screen === 'prep' || results.isOpen()) return 'prep'
  return trackFor(world, soundtrack)
}

function toggleMute(): void {
  sfx.setMuted(!sfx.isMuted())
  music.setMuted(sfx.isMuted())
  hud.setPaused(paused, sfx.isMuted())
}

function spendPoint(id: AttributeId): void {
  if (!allocate(profile, id)) return
  persist()
  sfx.cue('allocate')
  prep.refresh(profile)
  results.refresh(profile)
}

function changeSkills(change: () => boolean): void {
  if (!change()) return
  persist()
  sfx.cue('allocate')
  prep.refresh(profile)
  if (screen === 'play') world.player.skills = loadoutOf(profile).skills.map((skill) => ({ ...skill, cooldown: 0 }))
}

function devLearn(id: SkillId): void {
  changeSkills(() => {
    while (skillBlock(profile, id) === 'noPoints') grantXp(profile, xpToNext(profile.level) - profile.xp)
    const learned = learnSkill(profile, id)
    if (learned) equipSkill(profile, id, 'q')
    return learned
  })
}

function unlockSlotE(): void {
  changeSkills(() => {
    while (profile.level < SLOT_UNLOCK_LEVEL.e) grantXp(profile, xpToNext(profile.level) - profile.xp)
    return true
  })
}

function chargeUltimate(): void {
  if (world.player.alive) world.player.ultimate = 1
}

function resetPoints(): void {
  respec(profile)
  persist()
  sfx.cue('click')
  prep.refresh(profile)
}

function addXp(amount: number): void {
  grantXp(profile, amount)
  persist()
  prep.refresh(profile)
  results.refresh(profile)
}

function resetSave(): void {
  removeKey(SAVE_KEY)
  profile = createProfile()
  if (screen === 'prep') openPrep()
}

function settle(): void {
  settled = true
  tips.clear()
  input.releaseLock()
  if (training) return
  logRun('clear')
  const rating = rateRun(world)
  const settlement = settleRun(profile, world, rating)
  persist()
  results.show({ rating, settlement, tallies: runTallies(world) }, profile)
  const next = nextUnlocked()
  results.setNext(next ? `${next.title} · ${next.subtitle}` : null)
  if (!next) return
  models.keep(keptModels(levelDef.id, next.id))
  void models.ensure(modelsOf(next)).catch((error: unknown) => console.error(error))
}

function finishLevel(): void {
  if (dialogue.isOpen()) return
  const outro = STORIES[levelDef.id]?.outro
  if (training || !outro || outroPlayed) {
    settle()
    return
  }
  outroPlayed = true
  dialogue.play(outro, settle)
}

function logRun(result: RunResult): void {
  if (logged || training) return
  logged = true
  appendRunLog(summarizeRun(world, result, profile.level))
}

function dropItem(type: DropType): void {
  if (!world.player.alive) return
  const item = type === 'heal' ? { type, amount: HEAL_SMALL } : type === 'weapon' ? weaponItem(world) : makeItem(world, type)
  dropNearPlayer(world, item)
}

function readCommand(dt: number): void {
  const { player } = world
  const delta = input.takeLook()
  const turning = screen === 'play' && !paused && !map.isOpen() && input.locked()
  if (turning) {
    yaw += delta.x * look.sensitivity * DEG
    pitch -= delta.y * look.sensitivity * DEG * (look.invertY ? -1 : 1)
    pitch = Math.max(-85 * DEG, Math.min(85 * DEG, pitch))
  }
  stage.look(yaw, pitch)
  lookDelta.x = turning ? delta.x : 0
  lookDelta.y = turning ? delta.y : 0
  if (stage.view === 'free') {
    const axes = input.moveAxes()
    const speed = (input.held('ShiftLeft') ? 40 : 12) * dt
    stage.freeMove(axes.forward * speed, axes.right * speed, (Number(input.held('KeyE')) - Number(input.held('KeyQ'))) * speed)
    command.moveX = 0
    command.moveY = 0
    command.fire = false
    return
  }
  const axes = input.moveAxes()
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  command.moveX = axes.forward * cos - axes.right * sin
  command.moveY = axes.forward * sin + axes.right * cos
  command.aimX = player.pos.x + cos * 20
  command.aimY = player.pos.y + sin * 20
  command.pitch = pitch
  if (input.actionPressed('primary')) command.slot = 'primary'
  else if (input.actionPressed('special')) command.slot = 'special'
  else if (input.wheel() !== 0) command.slot = player.slot === 'primary' ? 'special' : 'primary'
  if (input.actionPressed('interact')) command.interact = true
  if (input.actionPressed('skillQ')) command.skill = 'q'
  else if (input.actionPressed('skillE')) command.skill = 'e'
  if (input.actionPressed('ultimate')) command.ultimate = true
  if (input.actionPressed('jump')) command.jump = true
  if (input.actionPressed('dash')) command.dash = true
  if (input.meleePressed() || input.actionPressed('melee')) command.melee = true
  if (holdFireUntilRelease && !input.fireHeld()) holdFireUntilRelease = false
  command.fire = input.fireHeld() && !holdFireUntilRelease
}

function clearEdges(): void {
  command.slot = null
  command.interact = false
  command.skill = null
  command.ultimate = false
  command.jump = false
  command.dash = false
  command.melee = false
}

function step(): void {
  const applied = toggles.autopilot ? autopilot.next(world) : command
  if (toggles.autopilot) {
    yaw = Math.atan2(applied.aimY - world.player.pos.y, applied.aimX - world.player.pos.x)
    pitch = applied.pitch
  }
  stepWorld(world, applied, loop.stepSeconds)
  clearEdges()
}

function simulate(steps: number): void {
  if (screen === 'play' && !map.isOpen() && !paused && !frozen && !dialogue.isOpen()) {
    for (let i = 0; i < steps; i++) step()
  }
  if (screen !== 'play') clearEdges()
}

function handleKeys(): void {
  if (input.actionPressed('mute')) toggleMute()
  if (settingsPanel.isOpen()) {
    if (input.pressed('Escape') && !settingsPanel.capturing()) settingsPanel.close()
    return
  }
  if (dialogue.isOpen()) {
    if (input.pressed('Escape')) dialogue.skip()
    else if (input.pressed('Space') || input.pressed('Enter') || input.actionPressed('interact') || input.clicked()) dialogue.advance()
    return
  }
  if (screen === 'prep') {
    if (!loading && (input.pressed('Enter') || input.pressed('Space'))) {
      input.requestLock()
      void startLevel(levelDef.id)
    }
    return
  }
  if (results.isOpen()) {
    if (input.pressed('KeyR')) startRun()
    else if (input.pressed('Enter')) goNext()
    else if (input.pressed('Escape')) openPrep()
    else if (input.pressed('Space')) results.skip()
    return
  }
  if (world.status === 'dead') {
    if (input.pressed('KeyR') || input.pressed('Space') || input.clicked()) startRun()
    else if (input.pressed('Enter')) openPrep()
    return
  }
  if (paused) {
    if (input.clicked()) resume()
    if (input.pressed('KeyR')) startRun()
    return
  }
  if (!input.locked() && input.clicked() && !map.isOpen()) input.requestLock()
  if (input.actionPressed('map')) map.toggle()
  if (devTools && input.pressed('KeyV')) stage.setView(stage.view === 'fps' ? 'top' : stage.view === 'top' ? 'free' : 'fps')
}

function relativeAngle(x: number, y: number): number {
  const angle = Math.atan2(y - world.player.pos.y, x - world.player.pos.x) - yaw
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

function wordAt(word: SfxWord, x: number, y: number, z: number, scale = 1): void {
  words.pop(word, x, y, z, scale)
}

function keepFoundClues(): void {
  if (training || keepClues(profile, world).length === 0) return
  persist()
}

function dispatch(event: GameEvent): void {
  if (event.type === 'clueFound') keepFoundClues()
  levelView?.handle(event)
  views.handle(event)
  projectileViews.handle(event)
  hud.handle(event, world)
  numbers.handle(event)
  sfx.handle(event, world)
  tips.handle(event, world)
  switch (event.type) {
    case 'shot':
      viewmodel.shot()
      break
    case 'melee':
      viewmodel.melee()
      if (event.hits > 0) {
        stage.addTrauma(0.25)
        rush = Math.max(rush, 0.8)
        wordAt('kuang', event.x + Math.cos(event.angle) * 1.3, event.y + Math.sin(event.angle) * 1.3, world.player.z + 1.2, 1.1)
      }
      break
    case 'enemyHit':
      overlay.hit(event.crit ? 'crit' : 'hit')
      if (meleeBatch && Math.hypot(event.x - world.player.pos.x, event.y - world.player.pos.y) <= 3) break
      if (event.crit) words.say('暴击！', 'crit', event.x, event.y, event.z + 0.2, 1)
      else wordAt('pa', event.x, event.y, event.z, 0.8)
      break
    case 'enemyKilled': {
      overlay.hit('kill')
      const step = streakStep(event.streak ?? 0)
      const label = streakLabel(event.streak ?? 0)
      const lift = step * STREAK_WORDS.lift
      wordAt('clatter', event.x, event.y, world.player.z + 1.1 + lift, (event.kind === 'boss' ? 1.8 : 1) * (1 + step * STREAK_WORDS.grow))
      if (label) words.say(label, 'streak', event.x, event.y, world.player.z + 1.75 + lift, 1 + step * STREAK_WORDS.grow)
      break
    }
    case 'eliteShieldBroken':
      words.say('破盾！', 'shield', event.x, event.y, world.player.z + 1.5, 1)
      break
    case 'bossShield':
      if (!event.held) words.say('破盾！', 'shield', event.x, event.y, world.player.z + 2.2, 1.3)
      break
    case 'stunned':
      words.say('打断！', 'stun', event.x, event.y, world.player.z + 1.6, 0.9)
      break
    case 'combo':
      words.say(CHAIN_WORDS[event.kind], 'combo', event.x, event.y, event.z + 1.9, 1.15)
      break
    case 'enemyBumped':
      wordAt('kuang', event.x, event.y, event.z + 1.3, 0.9)
      break
    case 'blast':
      wordAt('hong', event.x, event.y, event.z + 1.2, Math.min(1.8, 0.8 + event.radius * 0.25))
      break
    case 'shieldBlocked':
      wordAt('dang', event.x, event.y, world.player.z + 1.2, 0.9)
      break
    case 'playerHit': {
      const angle = relativeAngle(event.fromX, event.fromY)
      overlay.hurt(angle, Math.min(1, event.damage / 250))
      stage.addTrauma(Math.min(0.5, 0.12 + event.damage / 600))
      if (event.knockback > 0) hitRollVelocity += -Math.sign(Math.sin(angle)) * Math.min(HIT_ROLL.max, event.knockback * HIT_ROLL.perKnock) * HIT_ROLL.damping
      break
    }
    case 'jumped':
      viewmodel.jumped()
      break
    case 'landed':
      viewmodel.landed(event.fall)
      eyeDipVelocity -= Math.min(2.4, 0.6 + event.fall * 0.9)
      break
    case 'dashed':
      fovKick = 1
      rush = 1
      break
    case 'weaponChanged':
      viewmodel.switched()
      break
    case 'bossIntro':
      if (world.boss?.boss) bounty.show(world.boss.boss.id)
      break
    case 'bossDefeated':
      if (world.boss?.boss) bounty.settle(world.boss.boss.id)
      break
    case 'enemyWindup':
      if (!onScreen(event.id)) {
        const enemy = world.enemies.find((item) => item.id === event.id)
        if (enemy) overlay.threat(relativeAngle(enemy.pos.x, enemy.pos.y))
      }
      break
  }
}

const probe = { x: 0, y: 0, visible: false }
function onScreen(id: number): boolean {
  const enemy = world.enemies.find((item) => item.id === id)
  if (!enemy) return true
  stage.project(enemy.pos.x, enemy.z + 1, enemy.pos.y, probe)
  return probe.visible && probe.x >= 0 && probe.y >= 0 && probe.x <= stage.width && probe.y <= stage.height
}

function dispatchEvents(): void {
  if (!viewsReady) return
  const batch = world.events.splice(0)
  meleeBatch = batch.some((event) => event.type === 'melee' && event.hits > 0)
  for (const event of batch) {
    if (event.type === 'bossIntro' && event.story && playBossStory(event)) continue
    dispatch(event)
  }
  if (world.status === 'dead' && lastStatus !== 'dead') {
    logRun('dead')
    input.releaseLock()
  }
  lastStatus = world.status
  if (world.status === 'complete' && !settled) finishLevel()
}

function playBossStory(event: GameEvent): boolean {
  const lines = STORIES[levelDef.id]?.boss
  if (training || !lines || lines.length === 0 || dialogue.isOpen()) return false
  const run = world
  dialogue.play(lines, () => {
    holdFireUntilRelease = true
    if (world === run) dispatch(event)
  })
  return true
}

function placeEye(alpha: number, dt: number): void {
  const { player } = world
  const x = lerp(player.prev.x, player.pos.x, alpha)
  const y = lerp(player.prev.y, player.pos.y, alpha)
  const z = lerp(player.prevZ, player.z, alpha)
  if (eyeBase === null || !player.grounded || Math.abs(z - eyeBase) > STEP_SNAP) eyeBase = z
  else eyeBase += (z - eyeBase) * Math.min(1, dt * STEP_EASE)
  eyeDipVelocity += (-eyeDip * 160 - eyeDipVelocity * 18) * dt
  eyeDip += eyeDipVelocity * dt * 0.1
  const speed = Math.hypot(player.pos.x - player.prev.x, player.pos.y - player.prev.y) / loop.stepSeconds
  const bobbing = look.bob && player.alive && player.grounded && speed > 0.5 && screen === 'play' && !paused
  bobAmount += ((bobbing ? Math.min(1, speed / Math.max(1, tuning.player.speed)) : 0) - bobAmount) * Math.min(1, dt * 8)
  if (bobbing) bobPhase += dt * speed * BOB_RATE
  const bob = Math.abs(Math.sin(bobPhase)) * BOB_HEIGHT * bobAmount
  crouch += ((player.alive && playerHidden(world) ? 1 : 0) - crouch) * Math.min(1, dt * 7)
  overlay.setHidden(screen === 'play' ? crouch : 0)
  const height = player.alive ? lerp(look.eyeHeight, GRASS_EYE_HEIGHT, crouch) : 0.45
  stage.setEye(x, y, eyeBase + height + eyeDip + bob)
  fovKick = Math.max(0, fovKick - dt * 3.2)
  rush = Math.max(0, rush - dt * 3.4)
  stage.setRush(rush)
  stage.setFovBoost(fovKick * 5)
  hitRollVelocity += (-hitRoll * HIT_ROLL.stiffness - hitRollVelocity * HIT_ROLL.damping) * dt
  hitRoll = Math.max(-HIT_ROLL.max, Math.min(HIT_ROLL.max, hitRoll + hitRollVelocity * dt))
  stage.setRoll(player.alive ? hitRoll * settings.shake : 0.35)
}

function syncViews(dt: number, alpha: number): void {
  levelView?.update(world, dt, stage.camera.position)
  views.sync(world, alpha, dt)
  pickupViews.sync(world, dt, stage.camera.position)
  projectileViews.sync(world, alpha, dt)
  rings.sync(world, alpha)
}

let last = performance.now()

function frame(now: number): void {
  const frameMs = now - last
  last = now
  const dt = Math.min(frameMs, 100) / 1000
  const sceneDt = frozen ? 0 : dt

  handleKeys()
  readCommand(dt)
  const { steps, alpha } = loop.advance(frameMs)
  simulate(steps)
  dispatchEvents()

  if (viewsReady && levelView && (screen === 'play' || !prep.covers())) {
    placeEye(alpha, dt)
    syncViews(sceneDt, alpha)
    propFires.update(world, sceneDt)
    effects.update(sceneDt, stage.view === 'fps' ? stage.camera.position : undefined)
    const { player } = world
    viewmodel.update(
      {
        dt: sceneDt,
        lookX: lookDelta.x,
        lookY: lookDelta.y,
        speed: Math.hypot(player.pos.x - player.prev.x, player.pos.y - player.prev.y) / loop.stepSeconds,
        grounded: player.grounded,
        dashing: player.rollTime > 0,
        weapon: player.slot === 'special' && player.special ? player.special : player.primary,
        ammo: player.ammo,
        magazine: player.magazine,
        reload: player.reload,
        ultimate: player.ultShots > 0 || player.ultimate >= 1,
        supporting: player.ultShots > 0,
        alive: player.alive && stage.view === 'fps' && screen === 'play' && !dialogue.isOpen(),
      },
    )
    viewmodel.resize(stage.width * stage.renderer.getPixelRatio(), stage.height * stage.renderer.getPixelRatio())
    views.setPlayerVisible(stage.view !== 'fps')
    toonify(stage.scene)
    stage.render(sceneDt)
  }
  hud.update(world, alpha)
  numbers.update(dt, world)
  overlay.update(
    {
      hp: world.player.hp,
      maxHp: world.player.maxHp,
      dashReady: dashGauge(world),
      meleeReady: 1 - Math.min(1, world.player.meleeCooldown / 0.6),
      alive: world.player.alive,
      playing: screen === 'play' && !results.isOpen() && !dialogue.isOpen(),
      locked: input.locked(),
      barrier: world.player.barrier > 0,
      sneak: screen === 'play' && sneakReady(world),
    },
    dt,
  )
  overlay.setHint(screen === 'play' && paused ? '点击画面继续' : null)
  words.update(dt)
  if (screen === 'play' && views) notices.update(world)
  else notices.clear()
  bounty.update(dt)
  if (screen === 'play' && !paused && !dialogue.isOpen() && !map.isOpen()) tips.update(world, dt)
  map.update(world, dt)
  results.update(dt)
  dialogue.update(dt)
  sfx.setListener(world.player.pos.x, world.player.pos.y, yaw)
  if (screen === 'play' && !paused && !dialogue.isOpen()) sfx.update(world, dt)
  sfx.setVolume(tuning.audio.volume * settings.sfx)
  music.setVolume(settings.music)
  music.play(currentTrack())
  music.update()
  input.endFrame()
  requestAnimationFrame(frame)
}

function advance(seconds: number, interact = false): void {
  const steps = Math.max(1, Math.round(seconds / loop.stepSeconds))
  command.interact = interact
  for (let i = 0; i < steps; i++) step()
  stage.look(yaw, pitch)
  dispatchEvents()
}

const devPanel = devTools?.createTuningPanel(
  tuning,
  {
    flags: debug,
    view: viewFlags,
    areas: level.areas.map((area) => area.name),
    levels: levels.map((def) => ({ id: def.id, title: def.title })),
    training,
    bosses: Object.values(BOSSES),
    look,
    style: stage.pipeline,
    onLook: applyLook,
  },
  {
    startLevel: (id) => void startLevel(id),
    restart: startRun,
    teleport: (index) => teleportToArea(world, index),
    teleportToBoss: () => teleportToBoss(world),
    clearArea: () => clearCurrentArea(world),
    switchMode: () => {
      const url = new URL(location.href)
      if (training) url.searchParams.delete('mode')
      else url.searchParams.set('mode', 'arena')
      location.href = url.toString()
    },
    giveWeapon: (id) => world.player.alive && giveSpecialWeapon(world, id),
    giveBuff: (id) => world.player.alive && giveBuff(world, id),
    drop: dropItem,
    learnSkill: devLearn,
    unlockSlotE,
    chargeUltimate,
    resetSkills: () =>
      changeSkills(() => {
        resetSkills(profile)
        return true
      }),
    addXp,
    levelUp: () => addXp(xpToNext(profile.level) - profile.xp),
    resetSave,
    spawnEnemy: (kind) => world.player.alive && spawnEnemyNear(world, kind),
    spawnElite: () => world.player.alive && spawnEnemyNear(world, ELITE_KINDS[world.rng.int(ELITE_KINDS.length)], randomAffixes(world)),
  },
)

if (devTools) {
  window.__game = {
    get world() {
      return world
    },
    get profile() {
      return profile
    },
    get paused() {
      return paused
    },
    get screen() {
      return screen
    },
    get difficulty() {
      return settings.difficulty
    },
    get music() {
      return music.current()
    },
    get models() {
      return models.ids()
    },
    get level() {
      return levelDef.id
    },
    get view() {
      return stage.view
    },
    get scene() {
      return stage.scene
    },
    get camera() {
      return stage.camera
    },
    debug,
    tuning,
    start: startRun,
    startLevel,
    openPrep,
    restart: startRun,
    teleport: (index) => {
      teleportToArea(world, index)
    },
    teleportToBoss: () => {
      teleportToBoss(world)
    },
    setDifficulty(id) {
      settings.difficulty = id
      applySettings(settings)
      prep.refresh(profile)
    },
    setAutopilot(on, skill) {
      toggles.autopilot = on
      if (skill && skill !== toggles.autopilotSkill) {
        toggles.autopilotSkill = skill
        autopilot = pilot()
      }
    },
    advance,
    freeze(on) {
      frozen = on
    },
    act(next, seconds) {
      const saved = { ...command }
      Object.assign(command, next)
      if (next.pitch !== undefined) pitch = next.pitch
      if (next.aimX !== undefined && next.aimY !== undefined) yaw = Math.atan2(next.aimY - world.player.pos.y, next.aimX - world.player.pos.x)
      advance(seconds)
      Object.assign(command, saved, { jump: false, dash: false, melee: false, interact: false, ultimate: false, skill: null, slot: null })
      stage.look(yaw, pitch)
    },
    skipDialogue() {
      while (dialogue.isOpen()) dialogue.skip()
      if (loading) skipIntro = true
    },
    playInterlude,
    setView: (mode) => stage.setView(mode),
    look(nextYaw, nextPitch) {
      yaw = nextYaw
      pitch = nextPitch
      stage.look(yaw, pitch)
    },
    setStyle: (toggles) => stage.setStyle(toggles),
    styleInfo: () => stage.styleInfo(),
    freeCamera(x, y, z, nextYaw, nextPitch) {
      stage.setView('free')
      stage.setEye(x, y, z)
      stage.setView('fps')
      stage.setView('free')
      yaw = nextYaw
      pitch = nextPitch
      stage.look(yaw, pitch)
    },
    giveWeapon: (id) => {
      if (world.player.alive) giveSpecialWeapon(world, id)
    },
    giveBuff: (id) => {
      if (world.player.alive) giveBuff(world, id)
    },
    drop: dropItem,
    addXp,
    allocate: spendPoint,
    learnSkill: devLearn,
    equipSkill: (id, slot) => changeSkills(() => equipSkill(profile, id, slot)),
    unlockSlotE,
    chargeUltimate,
    resetSave,
    breakTargets: (area) => breakTargets(world, area),
    openPens: (area) => openPens(world, area),
    raiseAlarms: () => raiseAlarms(world),
    lightLamps: (area) => lightLamps(world, area),
    runLog: readRunLog,
    toScreen(x, y) {
      const point = { x: 0, y: 0, visible: false }
      stage.project(x, world.player.z + 1, y, point)
      const rect = stage.canvas.getBoundingClientRect()
      return { x: rect.left + point.x, y: rect.top + point.y }
    },
    renderInfo: () => stage.renderInfo(),
  }
}

hud.setPaused(false, sfx.isMuted())
applySettings(settings)
requestAnimationFrame(frame)
if (training) void startLevel(levelDef.id)
else void prepare(levelDef.id)
