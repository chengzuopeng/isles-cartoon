import { ALARM } from '../data/alarms'
import { getBoss } from '../data/bosses'
import { CLUES } from '../data/clues'
import { BOSS_LINES } from '../data/dialogue'
import { AFFIXES } from '../data/elites'
import { floorAt } from '../sim/grid'
import { LANDMARKS } from '../data/landmarks'
import { BUFFS, CHEST_NAMES, type BuffId } from '../data/loot'
import { SKILLS, SKILL_SLOTS, type SkillSlot } from '../data/skills'
import { WEAPON_BLURBS } from '../data/weapons'
import { assetUrl, type PortraitId } from '../render/asset-urls'
import { modelScale } from '../render/enemy-poses'
import type { ScreenPoint, Stage } from '../render/stage'
import { BUFF_COLORS } from '../render/themes'
import { runnerAlarm } from '../sim/alarms'
import { fogHides } from '../sim/fog'
import { isTarget } from '../sim/landmark-state'
import { lerp } from '../sim/math'
import { playerHidden } from '../sim/perception'
import { interactTarget } from '../sim/pickups'
import { runXp } from '../sim/profile'
import { skillCooldownOf } from '../sim/skills'
import type { GameEvent, MinionKind } from '../sim/types'
import type { World, WorldStatus } from '../sim/world'
import { icon, preload } from './assets'
import { createBarks } from './barks'
import { alarmLabel, showsTargetBar, targetGlyph, targetHpText, targetLabel } from './level-info'
import { createDeathReport } from './death-report'
import { button, element } from './dom'
import { syncStyle, syncText } from './dom-sync'
import './hud-extras.css'

interface UnitBar {
  root: HTMLDivElement
  fill: HTMLDivElement
}

interface TargetBar extends UnitBar {
  mark: HTMLDivElement
  label: HTMLDivElement
  shown: string
}

interface EnemyBar extends UnitBar {
  tag: HTMLDivElement
  shield: HTMLDivElement
  shieldFill: HTMLDivElement
  runner: HTMLDivElement
  runnerText: HTMLSpanElement
  shown: string
}

export interface HudLevelInfo {
  title: string
  subtitle: string
  objective: string
}

interface BuffChip {
  root: HTMLDivElement
  time: HTMLSpanElement
}

interface PlayerBar extends UnitBar {
  text: HTMLDivElement
  tag: HTMLDivElement
  buffs: HTMLDivElement
  chips: Map<BuffId, BuffChip>
  shield: HTMLDivElement
  shieldFill: HTMLDivElement
  ammo: HTMLDivElement
  cells: HTMLDivElement[]
}

interface WeaponSlotView {
  root: HTMLDivElement
  image: HTMLImageElement
  name: HTMLSpanElement
  ammo: HTMLSpanElement
  shown: string
}

interface SkillSlotView {
  root: HTMLDivElement
  image: HTMLImageElement
  name: HTMLDivElement
  shade: HTMLDivElement
  time: HTMLDivElement
  shown: string
}

export interface HudOptions {
  title: string
  subtitle: string
  objective: string
  training: boolean
  devHints: boolean
  onResume(): void
  onRestart(): void
  onQuit(): void
  onToggleMute(): void
  onSettings(): void
}

export interface Hud {
  update(world: World, alpha: number): void
  handle(event: GameEvent, world: World): void
  setPaused(paused: boolean, muted: boolean): void
  setLevel(info: HudLevelInfo): void
  reset(): void
}

const PLAYER_BAR_HEIGHT = 1.75
export const BAR_SCALE = { reference: 9, min: 0.45, max: 1, lift: 0.18, plateRange: 30 } as const

const ENEMY_BAR_HEIGHTS: Readonly<Record<MinionKind, { plain: number; crowned: number }>> = {
  grunt: { plain: 1.3, crowned: 1.42 },
  gunner: { plain: 1.6, crowned: 1.8 },
  bomber: { plain: 1.45, crowned: 1.52 },
  turret: { plain: 1.2, crowned: 1.36 },
  shield: { plain: 1.35, crowned: 1.56 },
  thrower: { plain: 1.4, crowned: 1.48 },
}
const BUFF_WARNING = 3
const HURT_FACE_MS = 900
const CHEER_FACE_MS = 2600
const DEATH_SCREEN_DELAY_MS = 1000
const LOW_HEALTH = 0.3
const BOSS_PORTRAITS: Readonly<Record<string, PortraitId>> = {
  scarecrow: 'scarecrow',
  harvester: 'harvester',
  'demo-chief': 'demo-chief',
  'shield-captain': 'shield-captain',
  'forest-tank': 'forest-tank',
}
const KAI_FACES: readonly PortraitId[] = ['kai-normal', 'kai-happy', 'kai-angry', 'kai-surprised']
const TARGET_BAR_LIFT = 0.9
const TARGET_AIM = { share: 1.6, minPixels: 28, scale: 0.9 } as const
const TOAST_MS = 3200
const BELL_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5a1.6 1.6 0 0 1 1.6 1.6v.6c3 .8 4.9 3.4 4.9 6.6v3.6l2 2.5v1.1h-17v-1.1l2-2.5v-3.6c0-3.2 1.9-5.8 4.9-6.6v-.6A1.6 1.6 0 0 1 12 2.5Z"/><circle cx="12" cy="20.6" r="2.1"/></svg>'

export function createHud(container: HTMLElement, stage: Stage, options: HudOptions): Hud {
  const root = element('div', 'hud', container)
  const info = element('div', 'hud-info', root)
  const titleLabel = element('div', 'hud-title', info, options.title)
  const objectiveLabel = element('div', 'hud-objective', info, `目标：${options.objective}`)
  let levelTitle = options.title
  let levelSubtitle = options.subtitle
  const areaLabel = element('div', 'hud-area', info)
  const statsLabel = element('div', 'hud-stats', info)

  const bossBar = element('div', 'boss-bar', root)
  const bossFace = icon(bossBar, 'boss-face', '')
  bossFace.style.display = 'none'
  const bossName = element('div', 'boss-name', bossBar)
  const bossTrack = element('div', 'boss-track', bossBar)
  const bossFill = element('div', 'boss-fill', bossTrack)
  let shownBoss = ''
  const remaining = element('div', 'hud-remaining', root)
  const toast = element('div', 'hud-toast', root)
  const toastLabel = element('div', 'hud-toast-label', toast)
  const toastText = element('div', 'hud-toast-text', toast)
  let toastTimer = 0

  const banner = element('div', 'hud-banner', root)
  const bannerTitle = element('div', 'hud-banner-title', banner)
  const bannerSub = element('div', 'hud-banner-sub', banner)
  const vignette = element('div', 'hud-vignette', root)
  const bars = element('div', 'hud-bars', root)

  const avatar = element('div', 'hud-avatar', root)
  const avatarFace = icon(avatar, 'hud-avatar-face', assetUrl.portrait('kai-normal'))
  preload(KAI_FACES.map((id) => assetUrl.portrait(id)))
  let shownFace: PortraitId = 'kai-normal'
  let hurtUntil = 0
  let cheerUntil = 0

  const weaponPanel = element('div', 'weapon-panel', root)
  const primarySlot = createWeaponSlot(weaponPanel, '1')
  const specialSlot = createWeaponSlot(weaponPanel, '2')

  const skillPanel = element('div', 'skill-panel', root)
  const skillSlots = new Map<SkillSlot, SkillSlotView>()
  for (const slot of SKILL_SLOTS) skillSlots.set(slot, createSkillSlot(skillPanel, slot.toUpperCase()))
  const ult = element('div', 'ult-meter', skillPanel)
  const ultHead = element('div', 'ult-head', ult)
  icon(ultHead, 'ult-icon', assetUrl.item('shard'))
  element('div', 'ult-label', ultHead, 'R · 星光连射')
  const ultTrack = element('div', 'ult-track', ult)
  const ultFill = element('div', 'ult-fill', ultTrack)

  const prompt = element('div', 'interact-prompt', root)
  const promptIcon = icon(prompt, 'interact-icon', '')
  promptIcon.style.display = 'none'
  const promptBody = element('div', 'interact-body', prompt)
  const promptText = element('span', '', promptBody)
  const promptBlurb = element('span', 'interact-blurb', promptBody)
  const help = ['WASD 移动', '鼠标瞄准', '左键射击', '1 / 2 切换武器', 'Q / E 技能', '右键 大招', 'F 拾取 / 开箱', 'M 地图', 'Esc 暂停']
  if (options.devHints) help.push('` 调参')
  element('div', 'hud-help', root, help.join(' · '))

  const dead = element('div', 'hud-overlay interactive', root)
  icon(dead, 'overlay-face', assetUrl.portrait('kai-surprised'))
  element('h1', '', dead, '你倒下了')
  const deadStats = element('div', 'hud-overlay-line', dead)
  const deadXp = element('div', 'hud-overlay-line dim', dead)
  const deathReport = createDeathReport(dead)
  const deadButtons = element('div', 'screen-buttons', dead)
  button(deadButtons, 'primary', options.training ? '重新开始（R）' : '重新开始本关（R）', options.onRestart)
  if (!options.training) button(deadButtons, 'ghost', '返回整备（Enter）', options.onQuit)

  const pause = element('div', 'hud-overlay interactive', root)
  element('h1', '', pause, '暂停')
  const pauseObjective = element('div', 'hud-overlay-line', pause, `目标：${options.objective}`)
  const pauseButtons = element('div', 'screen-buttons', pause)
  button(pauseButtons, 'primary', '继续（Esc）', options.onResume)
  button(pauseButtons, 'ghost', '重开本关（R）', options.onRestart)
  const muteButton = button(pauseButtons, 'ghost', '', options.onToggleMute)
  button(pauseButtons, 'ghost', '设置', options.onSettings)
  const quitButton = options.training ? null : button(pauseButtons, 'ghost', '返回整备', () => confirmQuit())
  let quitArmed = false
  const armQuit = (armed: boolean) => {
    quitArmed = armed
    if (!quitButton) return
    quitButton.textContent = armed ? '确认返回？本局经验作废' : '返回整备'
    quitButton.classList.toggle('primary', armed)
    quitButton.classList.toggle('ghost', !armed)
  }
  const confirmQuit = () => {
    if (!quitArmed) {
      armQuit(true)
      return
    }
    armQuit(false)
    options.onQuit()
  }

  const playerBar = createPlayerBar(bars)
  const barks = createBarks(root, stage)
  const targetBars = new Map<number, TargetBar>()
  const spareTargets: TargetBar[] = []
  const aimAt: ScreenPoint = { x: 0, y: 0, visible: true }
  const aimTop: ScreenPoint = { x: 0, y: 0, visible: true }
  const enemyBars = new Map<number, EnemyBar>()
  const spareBars: EnemyBar[] = []
  const seen = new Set<number>()
  const point: ScreenPoint = { x: 0, y: 0, visible: true }
  let shownArea = -1
  let shownStats = ''
  let shownRemaining = ''
  let shownRemainingKind = ''
  let shownPrompt = ''
  let shownStatus: WorldStatus = 'playing'
  let deadSince: number | null = null

  const place = (bar: UnitBar, x: number, y: number, height: number, scale = 1) => {
    stage.project(x, height, y, point)
    syncStyle(bar.root, 'transform', `translate3d(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px, 0) scale(${scale.toFixed(2)})`)
    syncStyle(bar.root, 'visibility', point.visible ? 'visible' : 'hidden')
  }
  const barScale = (world: World, x: number, y: number) => Math.max(BAR_SCALE.min, Math.min(BAR_SCALE.max, BAR_SCALE.reference / Math.max(1, Math.hypot(x - world.player.pos.x, y - world.player.pos.y))))

  const releaseBar = (id: number, bar: EnemyBar) => {
    syncStyle(bar.root, 'display', 'none')
    bar.root.classList.toggle('fogged', false)
    bar.shown = ''
    syncStyle(bar.runner, 'display', 'none')
    bar.root.classList.toggle('runner', false)
    enemyBars.delete(id)
    spareBars.push(bar)
  }

  const releaseTarget = (index: number, bar: TargetBar) => {
    syncStyle(bar.root, 'display', 'none')
    targetBars.delete(index)
    spareTargets.push(bar)
  }

  const syncTargets = (world: World) => {
    world.level.landmarks.forEach((placement, index) => {
      const shown = showsTargetBar(world, index)
      let bar = targetBars.get(index)
      if (!shown) {
        if (bar) releaseTarget(index, bar)
        return
      }
      if (!bar) {
        bar = spareTargets.pop() ?? createTargetBar(bars)
        syncStyle(bar.root, 'display', '')
        targetBars.set(index, bar)
      }
      const state = world.landmarks[index]
      const cx = placement.column + placement.width / 2
      const cy = placement.row + placement.depth / 2
      const floor = floorAt(world.grid, cx, cy)
      const height = LANDMARKS[placement.id].height
      stage.project(cx, floor + height / 2, cy, aimAt)
      stage.project(cx, floor + height, cy, aimTop)
      const reach = Math.max(TARGET_AIM.minPixels, Math.abs(aimAt.y - aimTop.y) * TARGET_AIM.share)
      const aimed = aimAt.visible && Math.hypot(aimAt.x - stage.width / 2, aimAt.y - stage.height / 2) <= reach
      const scale = barScale(world, cx, cy)
      place(bar, cx, cy, floor + height + TARGET_BAR_LIFT, aimed ? Math.max(scale, TARGET_AIM.scale) : scale)
      syncStyle(bar.fill, 'transform', `scaleX(${Math.max(0, state.hp / state.maxHp).toFixed(4)})`)
      const glyph = targetGlyph(placement.id)
      if (bar.mark.textContent !== glyph) bar.mark.textContent = glyph
      const text = aimed ? targetHpText(state.hp, state.maxHp) : ''
      if (text !== bar.shown) {
        bar.shown = text
        bar.label.textContent = text
        bar.root.classList.toggle('aimed', aimed)
      }
    })
  }

  const syncRunner = (world: World, enemy: World['enemies'][number], bar: EnemyBar) => {
    const index = runnerAlarm(world, enemy)
    const alarm = index >= 0 ? world.alarms[index] : null
    const pulling = alarm ? alarm.pulling > 0 : false
    const text = alarm ? (pulling ? '拉钟绳！' : '跑去敲钟！') : ''
    if (text !== bar.shown) {
      bar.shown = text
      bar.runnerText.textContent = text
      syncStyle(bar.runner, 'display', text ? '' : 'none')
      bar.root.classList.toggle('runner', text !== '')
      bar.runner.classList.toggle('pulling', pulling)
    }
    if (alarm && pulling) syncStyle(bar.runner, '--pull', Math.min(1, alarm.pulling / ALARM.pull).toFixed(3))
  }

  const showToast = (label: string, text: string) => {
    toastLabel.textContent = label
    toastText.textContent = text
    toast.classList.remove('visible')
    void toast.offsetWidth
    toast.classList.add('visible')
    window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => toast.classList.remove('visible'), TOAST_MS)
  }

  const showBanner = (title: string, sub: string) => {
    bannerTitle.textContent = title
    bannerSub.textContent = sub
    banner.animate(
      [
        { opacity: 0, transform: 'translate(-50%, -50%) scale(1.3)' },
        { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 0.12 },
        { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 0.78 },
        { opacity: 0, transform: 'translate(-50%, -50%) scale(0.96)' },
      ],
      { duration: 2000, easing: 'ease-out' },
    )
  }

  const syncWeapons = (world: World) => {
    const { player, tuning } = world
    const primary = tuning.weapons[player.primary]
    syncText(primarySlot.name, primary.name)
    syncText(primarySlot.ammo, `${player.ammo}/${player.magazine}`)
    showImage(primarySlot, assetUrl.weapon(player.primary))
    primarySlot.root.classList.toggle('active', player.slot === 'primary' || !player.special)
    specialSlot.root.classList.toggle('empty', !player.special)
    specialSlot.root.classList.toggle('active', player.slot === 'special' && Boolean(player.special))
    syncText(specialSlot.name, player.special ? tuning.weapons[player.special].name : '无特殊武器')
    syncText(specialSlot.ammo, player.special ? `×${player.specialAmmo}` : '')
    showImage(specialSlot, player.special ? assetUrl.weapon(player.special) : '')
  }

  const syncAvatar = (world: World) => {
    const { player } = world
    const now = performance.now()
    const face: PortraitId =
      now < cheerUntil
        ? 'kai-happy'
        : now < hurtUntil
          ? 'kai-angry'
          : player.hp < player.maxHp * LOW_HEALTH
            ? 'kai-surprised'
            : 'kai-normal'
    avatar.classList.toggle('low', player.alive && player.hp < player.maxHp * LOW_HEALTH)
    avatar.classList.toggle('gone', !player.alive || world.status !== 'playing')
    if (face === shownFace) return
    shownFace = face
    avatarFace.src = assetUrl.portrait(face)
  }

  const syncSkills = (world: World) => {
    const { player } = world
    for (const [slot, view] of skillSlots) {
      const skill = player.skills.find((item) => item.slot === slot)
      view.root.classList.toggle('empty', !skill)
      showImage(view, skill ? assetUrl.skill(skill.id) : '')
      if (!skill) {
        syncText(view.name, '—')
        syncStyle(view.shade, 'background', 'none')
        syncText(view.time, '')
        continue
      }
      syncText(view.name, SKILLS[skill.id].name)
      const total = skillCooldownOf(world, skill)
      const share = total > 0 ? skill.cooldown / total : 0
      syncStyle(view.shade, 'background', share > 0 ? `conic-gradient(rgba(0, 0, 0, 0.62) ${(share * 360).toFixed(1)}deg, transparent 0deg)` : 'none')
      syncText(view.time, skill.cooldown > 0 ? skill.cooldown.toFixed(skill.cooldown < 1 ? 1 : 0) : '')
      view.root.classList.toggle('ready', skill.cooldown <= 0)
    }
    syncStyle(ultFill, 'transform', `scaleX(${Math.min(1, player.ultimate).toFixed(4)})`)
    ult.classList.toggle('ready', player.ultimate >= 1)
  }

  const syncPrompt = (world: World) => {
    let text = ''
    let image = ''
    let blurb = ''
    if (world.player.alive && world.status === 'playing') {
      const target = interactTarget(world)
      if (target?.kind === 'chest') {
        text = `F 打开${CHEST_NAMES[target.chest.tier]}`
        image = assetUrl.item(`chest-${target.chest.tier}`)
      } else if (target?.kind === 'pen') {
        text = 'F 打开羊圈'
      } else if (target?.kind === 'lamp') {
        text = 'F 点亮驱雾灯'
      } else if (target?.kind === 'weapon' && target.pickup.item.type === 'weapon') {
        const { weapon, ammo } = target.pickup.item
        const verb = world.player.special ? '换成' : '拾取'
        text = `F ${verb}${world.tuning.weapons[weapon].name}（${ammo} 发）`
        image = assetUrl.weapon(weapon)
        blurb = `${WEAPON_BLURBS[weapon]} · 射程 ${world.tuning.weapons[weapon].range}`
      }
    }
    if (text === shownPrompt) return
    shownPrompt = text
    promptText.textContent = text
    promptBlurb.textContent = blurb
    promptIcon.style.display = image ? '' : 'none'
    if (image) promptIcon.src = image
    prompt.classList.toggle('visible', text !== '')
  }

  const syncBuffs = (world: World) => {
    const { player } = world
    for (const [id, chip] of playerBar.chips) {
      if (player.buffs.some((buff) => buff.id === id)) continue
      chip.root.remove()
      playerBar.chips.delete(id)
    }
    for (const buff of player.buffs) {
      let chip = playerBar.chips.get(buff.id)
      if (!chip) {
        const node = element('div', 'buff-chip', playerBar.buffs)
        node.style.borderColor = BUFF_COLORS[buff.id]
        node.title = BUFFS[buff.id].name
        icon(node, 'buff-icon', assetUrl.buff(buff.id))
        chip = { root: node, time: element('span', 'buff-time', node) }
        playerBar.chips.set(buff.id, chip)
      }
      syncText(chip.time, String(Math.ceil(buff.remaining)))
      chip.root.classList.toggle('ending', buff.remaining < BUFF_WARNING)
    }
    const shielded = player.shield > 0
    syncStyle(playerBar.shield, 'display', shielded ? '' : 'none')
    if (shielded) syncStyle(playerBar.shieldFill, 'transform', `scaleX(${Math.min(1, player.shield / BUFFS.shield.value).toFixed(4)})`)
  }

  return {
    update(world, alpha) {
      if (world.areaIndex !== shownArea) {
        shownArea = world.areaIndex
        areaLabel.textContent = world.level.areas[world.areaIndex]?.name ?? ''
      }
      const stats = options.training
        ? `第 ${world.wave} 波 · 击败 ${world.stats.kills}`
        : `用时 ${clock(world.stats.time)} · 击败 ${world.stats.kills} · 经验 +${runXp(world)}`
      if (stats !== shownStats) {
        shownStats = stats
        statsLabel.textContent = stats
      }
      if (world.status !== shownStatus) {
        shownStatus = world.status
        deadSince = world.status === 'dead' ? performance.now() : null
        if (world.status === 'dead') {
          deadStats.textContent = options.training
            ? `坚持到第 ${world.wave} 波，击败 ${world.stats.kills} 个敌人`
            : `倒在「${world.level.areas[world.areaIndex]?.name ?? ''}」，用时 ${clock(world.stats.time)}`
          deadXp.textContent = options.training || runXp(world) === 0 ? '' : `本局获得的 ${runXp(world)} 经验作废`
          deathReport.render(world)
        }
      }
      dead.classList.toggle('visible', deadSince !== null && performance.now() - deadSince >= DEATH_SCREEN_DELAY_MS)

      const boss = world.boss
      const bossActive = Boolean(boss?.boss && boss.boss.phase !== 'dormant' && boss.hp > 0)
      bossBar.classList.toggle('visible', bossActive)
      if (boss?.boss && bossActive) {
        const def = getBoss(boss.boss.id)
        const phase = def.phases[boss.boss.phaseIndex]
        const label = phase ? `${def.name} · ${phase.name}` : def.name
        if (label !== shownBoss) {
          shownBoss = label
          bossName.textContent = label
          const face = BOSS_PORTRAITS[boss.boss.id]
          bossFace.style.display = face ? '' : 'none'
          bossFace.dataset.boss = boss.boss.id
          if (face) bossFace.src = assetUrl.portrait(face)
          for (const tick of bossTrack.querySelectorAll('.boss-tick')) tick.remove()
          for (const item of def.phases.slice(1)) {
            const tick = element('div', 'boss-tick', bossTrack)
            tick.style.left = `${(item.at * 100).toFixed(1)}%`
          }
        }
        syncStyle(bossFill, 'transform', `scaleX(${Math.max(0, boss.hp / boss.maxHp).toFixed(4)})`)
        bossBar.classList.toggle('stunned', boss.boss.phase === 'stunned')
      }

      const area = world.level.areas[world.areaIndex]
      const locked = area?.kind === 'lock' && world.areas[world.areaIndex]?.status === 'locked'
      const sealed = area?.kind === 'destroy' && world.areas[world.areaIndex]?.status === 'sealed'
      const left = locked ? world.enemies.filter((enemy) => enemy.area === world.areaIndex && enemy.hp > 0).length : 0
      const alarm = locked || sealed ? null : alarmLabel(world, world.areaIndex)
      const remainingText = locked ? `剩余敌人 ${left}` : sealed ? (targetLabel(world, world.areaIndex) ?? '') : (alarm?.text ?? '')
      const remainingKind = sealed ? 'targets' : alarm ? `alarm ${alarm.status}` : ''
      if (remainingText !== shownRemaining || remainingKind !== shownRemainingKind) {
        shownRemaining = remainingText
        shownRemainingKind = remainingKind
        remaining.textContent = remainingText
        remaining.className = `hud-remaining${remainingText !== '' ? ' visible' : ''}${remainingKind ? ` ${remainingKind}` : ''}`
      }

      syncWeapons(world)
      syncSkills(world)
      syncPrompt(world)
      syncAvatar(world)

      const { player } = world
      syncStyle(playerBar.root, 'display', player.alive && world.status === 'playing' ? '' : 'none')
      if (player.alive) {
        place(playerBar, lerp(player.prev.x, player.pos.x, alpha), lerp(player.prev.y, player.pos.y, alpha), PLAYER_BAR_HEIGHT)
        syncStyle(playerBar.fill, 'transform', `scaleX(${(player.hp / player.maxHp).toFixed(4)})`)
        playerBar.fill.classList.toggle('regen', player.regenerating)
        syncText(playerBar.text, String(Math.ceil(player.hp)))
        syncStyle(playerBar.tag, 'display', playerHidden(world) ? '' : 'none')
        syncBuffs(world)
        syncAmmo(playerBar, player.ammo, player.reload, player.magazine)
      }

      seen.clear()
      const foggy = world.level.areas.some((area) => area.fog)
      for (const enemy of world.enemies) {
        if (enemy.hp <= 0 || enemy.kind === 'boss') continue
        const plate = enemy.elite !== null && Math.hypot(enemy.pos.x - player.pos.x, enemy.pos.y - player.pos.y) <= BAR_SCALE.plateRange
        if (!enemy.aggro && enemy.hp >= enemy.maxHp && !plate) continue
        seen.add(enemy.id)
        let bar = enemyBars.get(enemy.id)
        if (!bar) {
          bar = spareBars.pop() ?? createEnemyBar(bars)
          syncStyle(bar.root, 'display', '')
          enemyBars.set(enemy.id, bar)
        }
        const heights = ENEMY_BAR_HEIGHTS[enemy.kind]
        const height = lerp(enemy.prevZ, enemy.z, alpha) + (enemy.elite ? heights.crowned : heights.plain) * modelScale(enemy) + BAR_SCALE.lift
        const x = lerp(enemy.prev.x, enemy.pos.x, alpha)
        const y = lerp(enemy.prev.y, enemy.pos.y, alpha)
        place(bar, x, y, height, barScale(world, x, y))
        syncStyle(bar.fill, 'transform', `scaleX(${Math.max(0, enemy.hp / enemy.maxHp).toFixed(4)})`)
        const elite = enemy.elite
        syncText(bar.tag, elite ? `精英 · ${elite.affixes.map((id) => AFFIXES[id].name).join(' ')}` : '')
        syncStyle(bar.tag, 'display', elite ? '' : 'none')
        bar.root.classList.toggle('elite', Boolean(elite))
        const shielded = Boolean(elite && elite.shieldMax > 0)
        syncStyle(bar.shield, 'display', shielded ? '' : 'none')
        if (elite && shielded) syncStyle(bar.shieldFill, 'transform', `scaleX(${(elite.shield / elite.shieldMax).toFixed(4)})`)
        syncRunner(world, enemy, bar)
        bar.root.classList.toggle('fogged', foggy && fogHides(world, enemy.pos.x, enemy.pos.y))
      }
      for (const [id, bar] of enemyBars) {
        if (!seen.has(id)) releaseBar(id, bar)
      }
      syncTargets(world)
      barks.update(world, alpha)
    },
    handle(event, world) {
      const areas = world.level.areas
      barks.handle(event)
      switch (event.type) {
        case 'areaEntered': {
          const label = areas[event.index]?.kind === 'destroy' && world.areas[event.index]?.status === 'sealed' ? targetLabel(world, event.index) : null
          if (event.index === 0) showBanner(levelTitle, `${levelSubtitle} · ${event.name}`)
          else if (label) showBanner(event.name, `北门关着，打爆全部目标才能打开（${label}）`)
          else showBanner(event.name, `区域 ${event.index + 1} / ${areas.length}`)
          break
        }
        case 'areaLocked':
          if (areas[event.index]?.kind === 'lock') showBanner('门关上了', '击败这里的所有敌人')
          break
        case 'areaCleared':
          if (areas[event.index]?.kind === 'lock') showBanner('区域已清理', '门打开了，继续前进')
          else if (areas[event.index]?.kind === 'destroy') showBanner('北门打开了', '目标全部打爆，继续前进')
          else if (areas[event.index]?.kind === 'boss' && retreats(world)) showBanner('北门打开了', '跟着信号继续前进')
          break
        case 'landmarkBroken':
          if (world.level.landmarks[event.index] && isTarget(world.level.landmarks[event.index])) cheerUntil = performance.now() + CHEER_FACE_MS / 2
          break
        case 'clueFound':
          showToast('线索', `获得线索：${CLUES[event.clue].title}`)
          cheerUntil = performance.now() + CHEER_FACE_MS / 2
          break
        case 'secretFound':
          showToast('探索', '发现隐藏区')
          break
        case 'bossIntro': {
          const id = world.boss?.boss?.id
          showBanner(event.name, (id && BOSS_LINES[id]) || 'Boss 战')
          break
        }
        case 'bossSummon':
          showBanner('援兵来了', '场地边上出现了回血包')
          break
        case 'alarmRaised':
          showBanner('钟响了！', '整片麦田的机器人都被惊动了')
          break
        case 'rush':
          showBanner('又来一波！', `${event.count} 个机器人冲过来了`)
          break
        case 'reinforcements':
          showBanner('援兵来了', `北门进来了 ${event.count} 个机器人，全部打倒才开门`)
          break
        case 'bossDefeated':
          showBanner(`击败「${event.name}」`, retreats(world) ? '它倒车撤走了，北门马上打开' : '出口已打开')
          cheerUntil = performance.now() + CHEER_FACE_MS
          break
        case 'chestOpened':
          cheerUntil = performance.now() + CHEER_FACE_MS / 2
          break
        case 'bossPhase':
          showBanner(event.name, '招式变了，场地边上出现了回血包')
          break
        case 'bossStunned':
          showBanner('撞晕了！', '伤害 +50%，抓紧输出')
          break
        case 'waveStarted':
          showBanner(`第 ${event.wave} 波`, '')
          break
        case 'ultimateReady':
          ult.animate([{ transform: 'scale(1.15)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'ease-out' })
          break
        case 'weaponEmpty':
          showBanner('弹药耗尽', `${world.tuning.weapons[event.weapon].name}已丢弃，切回主武器`)
          break
        case 'playerHit':
          if (event.damage > 0) {
            vignette.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 420, easing: 'ease-out' })
            hurtUntil = performance.now() + HURT_FACE_MS
            avatar.animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 180 })
          }
          break
        default:
          break
      }
    },
    setLevel(level) {
      levelTitle = level.title
      levelSubtitle = level.subtitle
      titleLabel.textContent = level.title
      objectiveLabel.textContent = `目标：${level.objective}`
      pauseObjective.textContent = `目标：${level.objective}`
      shownBoss = ''
    },
    setPaused(paused, muted) {
      pause.classList.toggle('visible', paused)
      if (!paused) armQuit(false)
      muteButton.textContent = `声音：${muted ? '关' : '开'}（N）`
    },
    reset() {
      for (const [id, bar] of enemyBars) releaseBar(id, bar)
      for (const [index, bar] of targetBars) releaseTarget(index, bar)
      barks.reset()
      window.clearTimeout(toastTimer)
      toast.classList.remove('visible')
      for (const chip of playerBar.chips.values()) chip.root.remove()
      playerBar.chips.clear()
      shownArea = -1
      shownStats = ''
      shownRemaining = ''
      shownRemainingKind = ''
      shownPrompt = ''
      shownStatus = 'playing'
      deadSince = null
      hurtUntil = 0
      cheerUntil = 0
      dead.classList.remove('visible')
      remaining.className = 'hud-remaining'
      prompt.classList.remove('visible')
    },
  }
}

function retreats(world: World): boolean {
  const id = world.boss?.boss?.id
  return id !== undefined && getBoss(id).retreat > 0
}

function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(total / 60)
  return `${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function createSkillSlot(parent: HTMLElement, key: string): SkillSlotView {
  const root = element('div', 'skill-slot', parent)
  const image = icon(root, 'skill-icon', '')
  image.style.visibility = 'hidden'
  const name = element('div', 'skill-name', root)
  const shade = element('div', 'skill-shade', root)
  const time = element('div', 'skill-time', root)
  element('div', 'skill-key', root, key)
  return { root, image, name, shade, time, shown: '' }
}

function createWeaponSlot(parent: HTMLElement, key: string): WeaponSlotView {
  const root = element('div', 'weapon-slot', parent)
  element('span', 'weapon-key', root, key)
  const image = icon(root, 'weapon-icon', '')
  image.style.visibility = 'hidden'
  const name = element('span', 'weapon-name', root)
  const ammo = element('span', 'weapon-ammo', root)
  return { root, image, name, ammo, shown: '' }
}

function showImage(view: { image: HTMLImageElement; shown: string }, url: string): void {
  if (view.shown === url) return
  view.shown = url
  if (url) view.image.src = url
  view.image.style.visibility = url ? 'visible' : 'hidden'
}

function createPlayerBar(parent: HTMLElement): PlayerBar {
  const root = element('div', 'unit-bar player-bar', parent)
  const inner = element('div', 'unit-bar-inner', root)
  const buffs = element('div', 'buff-chips', inner)
  const tag = element('div', 'hidden-tag', inner, '隐藏中')
  tag.style.display = 'none'
  const text = element('div', 'hp-text', inner)
  const shield = element('div', 'shield-bar', inner)
  const shieldFill = element('div', 'shield-fill', shield)
  shield.style.display = 'none'
  const track = element('div', 'hp-bar', inner)
  const fill = element('div', 'hp-fill', track)
  const ammo = element('div', 'ammo', inner)
  return { root, fill, text, tag, buffs, chips: new Map(), shield, shieldFill, ammo, cells: [] }
}

function createTargetBar(parent: HTMLElement): TargetBar {
  const root = element('div', 'unit-bar target-bar', parent)
  const inner = element('div', 'unit-bar-inner', root)
  const label = element('div', 'target-label', inner)
  const mark = element('div', 'target-mark', inner)
  const track = element('div', 'hp-bar', inner)
  const fill = element('div', 'hp-fill', track)
  return { root, fill, mark, label, shown: '' }
}

function createEnemyBar(parent: HTMLElement): EnemyBar {
  const root = element('div', 'unit-bar enemy-bar', parent)
  const inner = element('div', 'unit-bar-inner', root)
  const runner = element('div', 'runner-tag', inner)
  runner.style.display = 'none'
  const bell = element('span', 'runner-bell', runner)
  bell.innerHTML = BELL_ICON
  const runnerText = element('span', 'runner-text', runner)
  const tag = element('div', 'elite-tag', inner)
  tag.style.display = 'none'
  const shield = element('div', 'shield-bar', inner)
  const shieldFill = element('div', 'shield-fill', shield)
  shield.style.display = 'none'
  const track = element('div', 'hp-bar', inner)
  const fill = element('div', 'hp-fill', track)
  return { root, fill, tag, shield, shieldFill, runner, runnerText, shown: '' }
}

function syncAmmo(bar: PlayerBar, ammo: number, reload: number, maxAmmo: number): void {
  while (bar.cells.length < maxAmmo) {
    const cell = element('div', 'ammo-cell', bar.ammo)
    element('div', 'ammo-fill', cell)
    bar.cells.push(cell)
  }
  while (bar.cells.length > maxAmmo) bar.cells.pop()?.remove()
  bar.cells.forEach((cell, index) => {
    const amount = index < ammo ? 1 : index === ammo ? reload : 0
    const fill = cell.firstElementChild
    if (fill instanceof HTMLElement) syncStyle(fill, 'transform', `scaleX(${amount.toFixed(3)})`)
    cell.classList.toggle('loading', index >= ammo)
  })
}
