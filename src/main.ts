import './style.css'
import './ui/fps.css'
import * as THREE from 'three'
import { createMusic } from './audio/music'
import { createSfx } from './audio/sfx'
import { createSoundtrackState, trackFor } from './audio/soundtrack'
import { createFixedStep } from './core/fixed-step'
import { loadSettings, saveSettings, type Settings } from './core/settings'
import { readJson, removeKey, writeJson } from './core/storage'
import { BOSSES } from './data/bosses'
import { STORIES } from './data/dialogue'
import type { MinionKind } from './data/enemies'
import { LEVEL_1_1 } from './data/levels/level-1-1'
import type { LevelDef } from './data/levels/types'
import { HEAL_SMALL, type BuffId, type DropType } from './data/loot'
import type { AttributeId } from './data/progression'
import { SLOT_UNLOCK_LEVEL, type SkillId } from './data/skills'
import { createDefaultTuning } from './data/tuning'
import type { PlayerWeaponId } from './data/weapons'
import { createFpsInput } from './input/fps-input'
import { loadLookSettings, saveLookSettings } from './input/look-settings'
import { RESIDENT_MODEL_IDS, type ModelId } from './render/asset-urls'
import { createEffects } from './render/effects'
import { createEntityViews, type EntityViews, type ViewFlags } from './render/entity-views'
import { createFpsLevelView, type FpsLevelView } from './render/fps-level-view'
import { createFpsStage, type ViewMode } from './render/fps-stage'
import { gltfSource } from './render/gltf-source'
import { modelsFor } from './render/level-models'
import { createModelLibrary } from './render/model-library'
import { createPickupViews, type PickupViews } from './render/pickup-views'
import { createProjectileViews, type ProjectileViews } from './render/projectile-views'
import { createRingViews } from './render/ring-views'
import type { RenderInfo } from './render/stage'
import { toonify } from './render/toon'
import { createViewmodel } from './render/viewmodel'
import { giveSpecialWeapon } from './sim/arsenal'
import { giveBuff } from './sim/buffs'
import { clearCurrentArea, dropNearPlayer, randomAffixes, spawnEnemyNear, teleportToArea, teleportToBoss } from './sim/cheats'
import { buildLevel, validateLevel } from './sim/level'
import { lerp } from './sim/math'
import { makeItem, weaponItem } from './sim/pickups'
import { allocate, createProfile, equipSkill, grantXp, learnSkill, loadoutOf, resetSkills, sanitizeProfile, settleRun, skillBlock, xpToNext, type Profile } from './sim/profile'
import { rateRun } from './sim/rating'
import { stepWorld } from './sim/step'
import { runTallies } from './sim/tallies'
import type { GameEvent, PlayerCommand } from './sim/types'
import { createWorld, type DebugFlags, type World } from './sim/world'
import { createBountyCard } from './ui/bounty-card'
import { createDamageNumbers } from './ui/damage-numbers'
import { createDialogue } from './ui/dialogue'
import { element } from './ui/dom'
import { createFpsOverlay } from './ui/fps-overlay'
import { createHud } from './ui/hud'
import { createMapOverlay } from './ui/map-overlay'
import { createResults } from './ui/results'
import { appendRunLog, readRunLog, summarizeRun, type RunLogEntry, type RunResult } from './ui/run-log'
import { createSettingsPanel } from './ui/settings-panel'
import { createSfxWords, type SfxWord } from './ui/sfx-words'
import { createTips } from './ui/tips'

type Screen = 'title' | 'play'

interface GameDebugHandle {
  readonly world: World
  readonly tuning: ReturnType<typeof createDefaultTuning>
  readonly profile: Profile
  readonly paused: boolean
  readonly screen: Screen
  readonly models: readonly string[]
  readonly view: ViewMode
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly debug: DebugFlags
  start(): void
  startLevel(id?: string): Promise<void>
  restart(): void
  teleport(area: number): void
  teleportToBoss(): void
  advance(seconds: number, interact?: boolean): void
  act(next: Partial<PlayerCommand>, seconds: number): void
  skipDialogue(): void
  setView(mode: ViewMode): void
  look(yaw: number, pitch: number): void
  setStyle(toggles: Partial<Record<'toon' | 'outline' | 'halftone' | 'bloom' | 'grade', boolean>>): unknown
  styleInfo(): unknown
  freeCamera(x: number, y: number, z: number, yaw: number, pitch: number): void
  giveWeapon(id: PlayerWeaponId): void
  giveBuff(id: BuffId): void
  drop(type: DropType): void
  chargeUltimate(): void
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
const DEG = Math.PI / 180

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('#app not found')
const container: HTMLDivElement = app
container.classList.add('fps-mode')

const devTools = import.meta.env.DEV ? await import('./ui/tuning-panel') : null
const levelDef: LevelDef = LEVEL_1_1
const level = buildLevel(levelDef)
if (devTools) {
  const problems = validateLevel(level)
  if (problems.length > 0) console.warn(`level ${levelDef.id} problems`, problems)
}

const tuning = createDefaultTuning()
devTools?.loadTuningOverrides(tuning)
const debug: DebugFlags = { invincible: false, noWaves: false }
const viewFlags: ViewFlags = { showSight: false }
let profile = sanitizeProfile(readJson(SAVE_KEY))
let seed = 1
const settings = loadSettings()
const look = loadLookSettings()
let world = newWorld()
let screen: Screen = 'title'
let paused = false
let settled = false
let logged = false
let outroPlayed = false
let introPlayed = false
let ready = false
let yaw = -Math.PI / 2
let pitch = 0
let eyeDip = 0
let eyeDipVelocity = 0
let fovKick = 0
let lastStatus = world.status
const lookDelta = { x: 0, y: 0 }
let meleeBatch = false

const stage = createFpsStage({ container, grid: level.grid, quality: settings, fov: look.fov })
const models = createModelLibrary(gltfSource(stage))
const effects = createEffects(stage.scene)
const sfx = createSfx()
const music = createMusic()
const soundtrack = createSoundtrackState()
const hud = createHud(container, stage, {
  title: levelDef.title,
  subtitle: levelDef.subtitle,
  objective: levelDef.objective,
  training: false,
  devHints: Boolean(devTools),
  onResume: resume,
  onRestart: startRun,
  onQuit: openTitle,
  onToggleMute: toggleMute,
  onSettings: openSettings,
})
const numbers = createDamageNumbers(container, stage, tuning)
const tips = createTips(container)
const map = createMapOverlay(container, level, Boolean(devTools))
const overlay = createFpsOverlay(container)
const words = createSfxWords(container, stage)
const bounty = createBountyCard(container)
const results = createResults(container, {
  onAllocate: spendPoint,
  onReplay: startRun,
  onPrep: openTitle,
  onLevelUp: () => sfx.cue('levelUp'),
})
const dialogue = createDialogue(container)
const settingsPanel = createSettingsPanel(container, settings, {
  onChange: applySettings,
  onResetTips: () => tips.resetSeen(),
})
const input = createFpsInput(stage.canvas)
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

const title = element('div', 'fps-start', container)
element('div', 'fps-start-title', title, '碎星群岛')
element('div', 'fps-start-sub', title, '1-1 出发 · 第一人称试玩')
const startHint = element('div', 'fps-start-sub', title, '载入中……')
element(
  'div',
  'fps-start-keys',
  title,
  'WASD 移动 · 鼠标视角 · 左键射击 · 右键枪托砸 · Shift 冲刺 · 空格跳 · R 大招 · Q / E 技能 · F 拾取 / 开箱 · 1 / 2 / 滚轮 换枪 · M 地图 · Esc 暂停',
)
title.addEventListener('click', () => {
  unlockAudio()
  if (!ready) return
  input.requestLock()
  void startLevel()
})

let views: EntityViews
let pickupViews: PickupViews
let projectileViews: ProjectileViews
let levelView: FpsLevelView | null = null
const viewmodel = createViewmodel(models)
const rings = createRingViews(stage.scene)
stage.setOverlay((renderer) => viewmodel.draw(renderer))
const sunDirection = new THREE.Vector3(-7, 22, 8).normalize()
const muzzle = new THREE.Vector3()

input.onLockChange((locked) => {
  if (!locked && screen === 'play' && world.status === 'playing' && !results.isOpen() && !dialogue.isOpen()) setPaused(true)
})

window.addEventListener('pointerdown', unlockAudio)
window.addEventListener('keydown', unlockAudio)
window.addEventListener('blur', () => {
  if (screen === 'play') setPaused(true)
})

async function boot(): Promise<void> {
  const ids = [...new Set<ModelId>([...RESIDENT_MODEL_IDS, ...modelsFor(level), 'blaster' as ModelId])]
  await models.ensure(ids)
  views = createEntityViews(stage, tuning, effects, viewFlags, models)
  pickupViews = createPickupViews(stage.scene, models)
  projectileViews = createProjectileViews(stage.scene, models, effects)
  levelView = createFpsLevelView(level, models)
  stage.scene.add(levelView.group)
  resetScene()
  syncViews(0, 1)
  toonify(stage.scene)
  stage.renderer.compile(stage.scene, stage.camera)
  ready = true
  startHint.textContent = '点击画面开始'
}

function newWorld(): World {
  seed += 1
  return createWorld(level, tuning, {
    seed,
    debug,
    difficulty: settings.difficulty,
    loadout: loadoutOf(profile),
    xpScale: 1,
  })
}

function persist(): void {
  writeJson(SAVE_KEY, profile)
}

function resetScene(): void {
  dialogue.stop()
  world = newWorld()
  settled = false
  logged = false
  outroPlayed = false
  lastStatus = world.status
  loop.reset()
  if (views) {
    views.reset()
    pickupViews.reset()
    projectileViews.reset()
  }
  rings.reset()
  effects.clear()
  hud.reset()
  numbers.clear()
  tips.clear()
  overlay.clear()
  words.clear()
  bounty.hide()
  Object.assign(soundtrack, createSoundtrackState())
  results.hide()
  if (map.isOpen()) map.toggle()
  yaw = world.player.facing
  pitch = 0
  stage.look(yaw, pitch)
}

async function startLevel(): Promise<void> {
  if (!ready) return
  resetScene()
  screen = 'play'
  title.classList.add('hidden')
  setPaused(false)
  holdFireUntilRelease = true
  sfx.cue('start')
  const intro = STORIES[levelDef.id]?.intro
  if (!intro || introPlayed) return
  introPlayed = true
  dialogue.play(intro, () => {
    holdFireUntilRelease = true
  })
}

function startRun(): void {
  if (!ready) return
  resetScene()
  screen = 'play'
  title.classList.add('hidden')
  setPaused(false)
  holdFireUntilRelease = true
  input.requestLock()
}

function openTitle(): void {
  resetScene()
  screen = 'title'
  setPaused(false)
  title.classList.remove('hidden')
  input.releaseLock()
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
  tips.setEnabled(next.tips)
}

function openSettings(): void {
  input.releaseLock()
  settingsPanel.open()
}

function unlockAudio(): void {
  sfx.unlock()
  music.unlock()
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
  results.refresh(profile)
}

function changeSkills(change: () => boolean): void {
  if (!change()) return
  persist()
  if (screen === 'play') world.player.skills = loadoutOf(profile).skills.map((skill) => ({ ...skill, cooldown: 0 }))
}

function settle(): void {
  settled = true
  tips.clear()
  input.releaseLock()
  logRun('clear')
  const rating = rateRun(world)
  const settlement = settleRun(profile, world, rating)
  persist()
  results.show({ rating, settlement, tallies: runTallies(world) }, profile)
}

function finishLevel(): void {
  if (dialogue.isOpen()) return
  const outro = STORIES[levelDef.id]?.outro
  if (!outro || outroPlayed) {
    settle()
    return
  }
  outroPlayed = true
  dialogue.play(outro, settle)
}

function logRun(result: RunResult): void {
  if (logged) return
  logged = true
  appendRunLog(summarizeRun(world, result, profile.level))
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
  if (input.pressed('Digit1')) command.slot = 'primary'
  else if (input.pressed('Digit2')) command.slot = 'special'
  else if (input.wheel() !== 0) command.slot = player.slot === 'primary' ? 'special' : 'primary'
  if (input.pressed('KeyF')) command.interact = true
  if (input.pressed('KeyQ')) command.skill = 'q'
  else if (input.pressed('KeyE')) command.skill = 'e'
  if (input.pressed('KeyR')) command.ultimate = true
  if (input.pressed('Space')) command.jump = true
  if (input.pressed('ShiftLeft') || input.pressed('ShiftRight')) command.dash = true
  if (input.meleePressed()) command.melee = true
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

function simulate(steps: number): void {
  if (screen === 'play' && !map.isOpen() && !paused && !dialogue.isOpen()) {
    for (let i = 0; i < steps; i++) {
      stepWorld(world, command, loop.stepSeconds)
      clearEdges()
    }
  }
  if (screen !== 'play') clearEdges()
}

function handleKeys(): void {
  if (input.pressed('KeyN')) toggleMute()
  if (settingsPanel.isOpen()) {
    if (input.pressed('Escape')) settingsPanel.close()
    return
  }
  if (dialogue.isOpen()) {
    if (input.pressed('Escape')) dialogue.skip()
    else if (input.pressed('Space') || input.pressed('Enter') || input.pressed('KeyF') || input.clicked()) dialogue.advance()
    return
  }
  if (screen === 'title') {
    if (ready && (input.pressed('Enter') || input.pressed('Space'))) {
      input.requestLock()
      void startLevel()
    }
    return
  }
  if (results.isOpen()) {
    if (input.pressed('KeyR')) startRun()
    else if (input.pressed('Enter')) openTitle()
    else if (input.pressed('Space')) results.skip()
    return
  }
  if (world.status === 'dead') {
    if (input.pressed('KeyR') || input.pressed('Space') || input.clicked()) startRun()
    else if (input.pressed('Enter')) openTitle()
    return
  }
  if (paused) {
    if (input.clicked()) resume()
    if (input.pressed('KeyR')) startRun()
    return
  }
  if (!input.locked() && input.clicked() && !map.isOpen()) input.requestLock()
  if (input.pressed('KeyM')) map.toggle()
  if (devTools && input.pressed('KeyV')) stage.setView(stage.view === 'fps' ? 'top' : stage.view === 'top' ? 'free' : 'fps')
}

function relativeAngle(x: number, y: number): number {
  const angle = Math.atan2(y - world.player.pos.y, x - world.player.pos.x) - yaw
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

function wordAt(word: SfxWord, x: number, y: number, z: number, scale = 1): void {
  words.pop(word, x, y, z, scale)
}

function dispatch(event: GameEvent): void {
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
        wordAt('kuang', event.x + Math.cos(event.angle) * 1.3, event.y + Math.sin(event.angle) * 1.3, world.player.z + 1.2, 1.1)
      }
      break
    case 'enemyHit':
      overlay.hit(event.crit ? 'crit' : 'hit')
      if (!meleeBatch || Math.hypot(event.x - world.player.pos.x, event.y - world.player.pos.y) > 3) wordAt(event.crit ? 'ding' : 'pa', event.x, event.y, event.z, event.crit ? 1.05 : 0.8)
      break
    case 'enemyKilled':
      overlay.hit('kill')
      wordAt('clatter', event.x, event.y, world.player.z + 1.1, event.kind === 'boss' ? 1.8 : 1)
      break
    case 'blast':
      wordAt('hong', event.x, event.y, world.player.z + 1.4, Math.min(1.8, 0.8 + event.radius * 0.25))
      break
    case 'shieldBlocked':
      wordAt('dang', event.x, event.y, world.player.z + 1.2, 0.9)
      break
    case 'playerHit':
      overlay.hurt(relativeAngle(event.fromX, event.fromY), Math.min(1, event.damage / 250))
      stage.addTrauma(Math.min(0.5, 0.12 + event.damage / 600))
      break
    case 'jumped':
      viewmodel.jumped()
      break
    case 'landed':
      viewmodel.landed(event.fall)
      eyeDipVelocity -= Math.min(2.4, 0.6 + event.fall * 0.9)
      break
    case 'dashed':
      fovKick = 1
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
  if (!views) return
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
  if (!lines || lines.length === 0 || dialogue.isOpen()) return false
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
  eyeDipVelocity += (-eyeDip * 160 - eyeDipVelocity * 18) * dt
  eyeDip += eyeDipVelocity * dt * 0.1
  const height = player.alive ? look.eyeHeight : 0.45
  stage.setEye(x, y, z + height + eyeDip)
  fovKick = Math.max(0, fovKick - dt * 3.2)
  stage.setFovBoost(fovKick * 5)
  stage.setRoll(player.alive ? 0 : 0.35)
}

function syncViews(dt: number, alpha: number): void {
  levelView?.update(world, dt)
  views.sync(world, alpha, dt)
  pickupViews.sync(world, dt)
  projectileViews.sync(world, alpha, dt)
  rings.sync(world, alpha)
}

let last = performance.now()

function frame(now: number): void {
  const frameMs = now - last
  last = now
  const dt = Math.min(frameMs, 100) / 1000

  handleKeys()
  readCommand(dt)
  const { steps, alpha } = loop.advance(frameMs)
  simulate(steps)
  dispatchEvents()

  if (views) {
    placeEye(alpha, dt)
    syncViews(dt, alpha)
    effects.update(dt)
    const { player } = world
    viewmodel.update(
      {
        dt,
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
        alive: player.alive && stage.view === 'fps',
      },
      stage.camera,
      sunDirection,
    )
    viewmodel.resize(stage.width * stage.renderer.getPixelRatio(), stage.height * stage.renderer.getPixelRatio())
    views.setPlayerVisible(stage.view !== 'fps')
    toonify(stage.scene)
    stage.render(dt)
    viewmodel.muzzle(stage.camera, muzzle)
  }
  hud.update(world, alpha)
  numbers.update(dt, world)
  overlay.update(
    {
      hp: world.player.hp,
      maxHp: world.player.maxHp,
      dashReady: 1 - Math.min(1, world.player.dashCooldown / 3),
      meleeReady: 1 - Math.min(1, world.player.meleeCooldown / 0.6),
      alive: world.player.alive,
      playing: screen === 'play' && !results.isOpen(),
      locked: input.locked(),
    },
    dt,
  )
  overlay.setHint(screen === 'play' && paused ? '点击画面继续' : null)
  words.update(dt)
  bounty.update(dt)
  if (screen === 'play' && !paused && !dialogue.isOpen() && !map.isOpen()) tips.update(world, dt)
  map.update(world, dt)
  results.update(dt)
  dialogue.update(dt)
  sfx.setVolume(tuning.audio.volume * settings.sfx)
  music.setVolume(settings.music)
  music.play(screen === 'title' || results.isOpen() ? 'prep' : trackFor(world, soundtrack))
  music.update()
  input.endFrame()
  requestAnimationFrame(frame)
}

function advance(seconds: number, interact = false): void {
  const steps = Math.max(1, Math.round(seconds / loop.stepSeconds))
  command.interact = interact
  for (let i = 0; i < steps; i++) {
    stepWorld(world, command, loop.stepSeconds)
    clearEdges()
  }
  dispatchEvents()
}

function dropItem(type: DropType): void {
  if (!world.player.alive) return
  const item = type === 'heal' ? { type, amount: HEAL_SMALL } : type === 'weapon' ? weaponItem(world) : makeItem(world, type)
  dropNearPlayer(world, item)
}

if (devTools) {
  devTools.createTuningPanel(
    tuning,
    {
      flags: debug,
      view: viewFlags,
      areas: level.areas.map((area) => area.name),
      training: false,
      bosses: Object.values(BOSSES),
      look,
      style: stage.pipeline,
      onLook: () => {
        saveLookSettings(look)
        stage.setFov(look.fov)
      },
    },
    {
      restart: startRun,
      teleport: (index) => teleportToArea(world, index),
      teleportToBoss: () => teleportToBoss(world),
      clearArea: () => clearCurrentArea(world),
      switchMode: () => {},
      giveWeapon: (id) => world.player.alive && giveSpecialWeapon(world, id),
      giveBuff: (id) => world.player.alive && giveBuff(world, id),
      drop: dropItem,
      learnSkill: (id: SkillId) =>
        changeSkills(() => {
          while (skillBlock(profile, id) === 'noPoints') grantXp(profile, xpToNext(profile.level) - profile.xp)
          const learned = learnSkill(profile, id)
          if (learned) equipSkill(profile, id, 'q')
          return learned
        }),
      unlockSlotE: () =>
        changeSkills(() => {
          while (profile.level < SLOT_UNLOCK_LEVEL.e) grantXp(profile, xpToNext(profile.level) - profile.xp)
          return true
        }),
      chargeUltimate: () => {
        if (world.player.alive) world.player.ultimate = 1
      },
      resetSkills: () =>
        changeSkills(() => {
          resetSkills(profile)
          return true
        }),
      addXp: (amount) => {
        grantXp(profile, amount)
        persist()
      },
      levelUp: () => {
        grantXp(profile, xpToNext(profile.level) - profile.xp)
        persist()
      },
      resetSave: () => {
        removeKey(SAVE_KEY)
        profile = createProfile()
      },
      spawnEnemy: (kind) => world.player.alive && spawnEnemyNear(world, kind),
      spawnElite: () => world.player.alive && spawnEnemyNear(world, ELITE_KINDS[world.rng.int(ELITE_KINDS.length)], randomAffixes(world)),
    },
  )
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
    get models() {
      return models.ids()
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
    restart: startRun,
    teleport: (index) => teleportToArea(world, index),
    teleportToBoss: () => teleportToBoss(world),
    advance,
    act(next, seconds) {
      const saved = { ...command }
      Object.assign(command, next)
      if (next.pitch !== undefined) pitch = next.pitch
      if (next.aimX !== undefined && next.aimY !== undefined) yaw = Math.atan2(next.aimY - world.player.pos.y, next.aimX - world.player.pos.x)
      advance(seconds)
      Object.assign(command, saved, { jump: false, dash: false, melee: false, interact: false, ultimate: false, skill: null, slot: null })
      stage.look(yaw, pitch)
    },
    skipDialogue: () => dialogue.skip(),
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
    chargeUltimate: () => {
      if (world.player.alive) world.player.ultimate = 1
    },
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
void boot().catch((error: unknown) => {
  console.error(error)
  startHint.textContent = '载入失败，请看控制台'
})
