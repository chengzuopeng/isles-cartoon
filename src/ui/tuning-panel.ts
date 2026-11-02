import { Pane, type FolderApi } from 'tweakpane'
import type { BossDef } from '../data/bosses'
import { ENEMY_NAMES, MINION_KINDS, type MinionKind } from '../data/enemies'
import { BUFFS, BUFF_ORDER, type BuffId, type DropType } from '../data/loot'
import { SKILLS, SKILL_ORDER, type SkillId } from '../data/skills'
import { createDefaultTuning, type Tuning } from '../data/tuning'
import { SPECIAL_WEAPONS, type PlayerWeaponId, type WeaponDef } from '../data/weapons'
import type { LookSettings } from '../input/look-settings'
import type { ViewFlags } from '../render/entity-views'
import type { InkPipeline } from '../render/ink-pipeline'
import { INK_UNIFORMS } from '../render/toon'
import type { DebugFlags } from '../sim/world'
import { readRunLog } from './run-log'

const STORAGE_KEY = 'shattered-isles.tuning.v2'

type Flat = Record<string, number>

interface SavedTuning {
  defaults: Flat
  values: Flat
}

export interface DevState {
  flags: DebugFlags
  view: ViewFlags
  areas: string[]
  levels: readonly { id: string; title: string }[]
  training: boolean
  bosses: BossDef[]
  look: LookSettings
  style: InkPipeline
  onLook(): void
}

export interface DevPanel {
  setAreas(names: readonly string[]): void
}

export interface DevActions {
  startLevel(id: string): void
  restart(): void
  teleport(area: number): void
  teleportToBoss(): void
  clearArea(): void
  switchMode(): void
  giveWeapon(id: PlayerWeaponId): void
  giveBuff(id: BuffId): void
  drop(type: DropType): void
  addXp(amount: number): void
  levelUp(): void
  resetSave(): void
  spawnEnemy(kind: MinionKind): void
  learnSkill(id: SkillId): void
  unlockSlotE(): void
  chargeUltimate(): void
  resetSkills(): void
  spawnElite(): void
}

const DROP_LABELS: Record<DropType, string> = {
  heal: '回血包',
  buff: '随机增益',
  ammo: '弹药',
  weapon: '随机特殊武器',
}

type WeaponField = keyof WeaponDef

const WEAPON_FIELDS: Partial<Record<WeaponField, { label: string; min: number; max: number; step: number }>> = {
  damage: { label: '伤害', min: 0, max: 1000, step: 5 },
  cooldown: { label: '攻击间隔', min: 0.03, max: 4, step: 0.01 },
  windup: { label: '前摇', min: 0, max: 3, step: 0.01 },
  magazine: { label: '弹药', min: 0, max: 120, step: 1 },
  reloadSeconds: { label: '装填时间', min: 0, max: 4, step: 0.05 },
  burstCount: { label: '连发数', min: 1, max: 10, step: 1 },
  burstInterval: { label: '连发间隔', min: 0, max: 1, step: 0.01 },
  pellets: { label: '弹丸数', min: 1, max: 15, step: 1 },
  spreadDeg: { label: '散射角度', min: 0, max: 180, step: 1 },
  jitterDeg: { label: '随机散布', min: 0, max: 30, step: 0.5 },
  speed: { label: '弹速', min: 1, max: 50, step: 0.5 },
  range: { label: '射程', min: 0.5, max: 20, step: 0.1 },
  radius: { label: '半径', min: 0.05, max: 6, step: 0.05 },
  enemyDamage: { label: '误伤敌人', min: 0, max: 1500, step: 10 },
  knockback: { label: '击退', min: 0, max: 20, step: 0.1 },
  pierce: { label: '穿透', min: 0, max: 6, step: 1 },
  arcDeg: { label: '攻击角度', min: 10, max: 360, step: 5 },
  lunge: { label: '扑击力度', min: 0, max: 15, step: 0.5 },
  bounces: { label: '反弹次数', min: 0, max: 6, step: 1 },
  chain: { label: '连锁次数', min: 0, max: 6, step: 1 },
  chainRange: { label: '连锁距离', min: 0, max: 8, step: 0.1 },
  chainFalloff: { label: '每跳衰减', min: 0, max: 1, step: 0.05 },
  explodeRadius: { label: '爆炸半径', min: 0, max: 5, step: 0.1 },
  splash: { label: '爆炸伤害', min: 0, max: 1000, step: 10 },
  statusPower: { label: '状态强度', min: 0, max: 200, step: 0.05 },
  statusDuration: { label: '状态时长', min: 0, max: 10, step: 0.1 },
}

const WEAPON_GROUPS: { title: string; ids: (keyof Tuning['weapons'])[]; fields: WeaponField[] }[] = [
  {
    title: '主角武器',
    ids: ['blaster'],
    fields: ['damage', 'cooldown', 'magazine', 'reloadSeconds', 'burstCount', 'burstInterval', 'speed', 'range', 'knockback'],
  },
  {
    title: '特殊武器',
    ids: ['shotgun', 'smg', 'sniper', 'grenade', 'ricochet', 'flamer', 'frost', 'rocket', 'arc'],
    fields: [
      'damage',
      'cooldown',
      'magazine',
      'pellets',
      'spreadDeg',
      'jitterDeg',
      'speed',
      'range',
      'pierce',
      'bounces',
      'chain',
      'chainRange',
      'chainFalloff',
      'explodeRadius',
      'splash',
      'statusPower',
      'statusDuration',
    ],
  },
  {
    title: '大招',
    ids: ['starVolley'],
    fields: ['damage', 'burstCount', 'burstInterval', 'speed', 'range', 'pierce', 'knockback'],
  },
  {
    title: '敌人武器',
    ids: ['claw', 'rifle', 'cannon', 'fuse', 'bash', 'bomb'],
    fields: [
      'damage',
      'windup',
      'cooldown',
      'pellets',
      'spreadDeg',
      'speed',
      'range',
      'radius',
      'enemyDamage',
      'arcDeg',
      'lunge',
      'explodeRadius',
      'splash',
    ],
  },
  {
    title: 'Boss 武器',
    ids: ['strawFan', 'strawSlam', 'reaperSweep', 'baleToss', 'bladeSpin', 'fallingBlade'],
    fields: [
      'damage',
      'windup',
      'burstCount',
      'burstInterval',
      'pellets',
      'spreadDeg',
      'speed',
      'range',
      'radius',
      'arcDeg',
      'explodeRadius',
      'splash',
    ],
  },
]

const RELEVANT: Record<WeaponDef['kind'], ReadonlySet<WeaponField>> = {
  projectile: new Set<WeaponField>([
    'damage',
    'cooldown',
    'windup',
    'magazine',
    'reloadSeconds',
    'burstCount',
    'burstInterval',
    'pellets',
    'spreadDeg',
    'jitterDeg',
    'speed',
    'range',
    'radius',
    'knockback',
    'pierce',
    'bounces',
    'chain',
    'chainRange',
    'chainFalloff',
    'explodeRadius',
    'splash',
    'statusPower',
    'statusDuration',
  ]),
  lob: new Set<WeaponField>(['cooldown', 'windup', 'magazine', 'speed', 'range', 'explodeRadius', 'splash']),
  melee: new Set<WeaponField>(['damage', 'cooldown', 'windup', 'radius', 'knockback', 'arcDeg', 'lunge']),
  blast: new Set<WeaponField>(['damage', 'windup', 'radius', 'enemyDamage', 'arcDeg']),
}

export function loadTuningOverrides(tuning: Tuning): void {
  const saved = readSaved()
  if (!saved) return
  for (const [path, value] of Object.entries(flatten(createDefaultTuning()))) {
    const savedValue = saved.values[path]
    if (saved.defaults[path] !== value || typeof savedValue !== 'number' || !Number.isFinite(savedValue)) continue
    assign(tuning, path, savedValue)
  }
}

export function createTuningPanel(tuning: Tuning, state: DevState, actions: DevActions): DevPanel {
  const pane = new Pane({ title: '调参与开发工具（` 显示/隐藏）', expanded: false })

  const dev = pane.addFolder({ title: '开发工具', expanded: true })
  dev.addBinding(state.flags, 'invincible', { label: '无敌' })
  dev.addBinding(state.view, 'showSight', { label: '感知范围' })
  if (state.training) {
    state.flags.noWaves = state.flags.noWaves ?? false
    dev.addBinding(state.flags, 'noWaves', { label: '暂停波次' })
    for (const kind of MINION_KINDS) {
      dev.addButton({ title: `刷出：${ENEMY_NAMES[kind]}` }).on('click', () => actions.spawnEnemy(kind))
    }
    dev.addButton({ title: '刷出：随机精英' }).on('click', () => actions.spawnElite())
  }
  const gifts = dev.addFolder({ title: '给予', expanded: false })
  for (const id of SPECIAL_WEAPONS) {
    gifts.addButton({ title: `武器：${tuning.weapons[id].name}` }).on('click', () => actions.giveWeapon(id))
  }
  for (const id of BUFF_ORDER) {
    gifts.addButton({ title: `增益：${BUFFS[id].name}` }).on('click', () => actions.giveBuff(id))
  }
  for (const type of Object.keys(DROP_LABELS) as DropType[]) {
    gifts.addButton({ title: `掉落：${DROP_LABELS[type]}` }).on('click', () => actions.drop(type))
  }
  const skills = dev.addFolder({ title: '技能与大招', expanded: false })
  for (const id of SKILL_ORDER) {
    skills.addButton({ title: `学会 / 升级：${SKILLS[id].name}` }).on('click', () => actions.learnSkill(id))
  }
  skills.addButton({ title: '解锁 E 槽（直接升到 8 级）' }).on('click', () => actions.unlockSlotE())
  skills.addButton({ title: '大招充满' }).on('click', () => actions.chargeUltimate())
  skills.addButton({ title: '清空技能' }).on('click', () => actions.resetSkills())
  const growth = dev.addFolder({ title: '成长与存档', expanded: false })
  growth.addButton({ title: '经验 +100' }).on('click', () => actions.addXp(100))
  growth.addButton({ title: '经验 +500' }).on('click', () => actions.addXp(500))
  growth.addButton({ title: '直接升 1 级' }).on('click', () => actions.levelUp())
  growth.addButton({ title: '清空存档' }).on('click', () => actions.resetSave())
  growth.addButton({ title: '复制战斗记录 JSON（最近 40 局）' }).on('click', () => {
    void navigator.clipboard?.writeText(JSON.stringify(readRunLog(), null, 2)).catch(() => undefined)
  })
  let travel: FolderApi | null = null
  const setAreas = (names: readonly string[]) => {
    if (state.training) return
    travel?.dispose()
    travel = dev.addFolder({ title: '传送', expanded: false, index: 4 })
    names.forEach((name, index) => {
      travel?.addButton({ title: `传送：${name}` }).on('click', () => actions.teleport(index))
    })
    travel.addButton({ title: '传送到 Boss 门前' }).on('click', () => actions.teleportToBoss())
  }
  setAreas(state.areas)
  if (!state.training) {
    const switcher = dev.addFolder({ title: '切换关卡', expanded: false })
    for (const level of state.levels) switcher.addButton({ title: level.title }).on('click', () => actions.startLevel(level.id))
  }
  dev.addButton({ title: '清空当前区域的敌人' }).on('click', () => actions.clearArea())
  dev.addButton({ title: '重开（* 项重开后生效）' }).on('click', () => actions.restart())
  dev.addButton({ title: state.training ? '回到关卡 1-1' : '进入训练场' }).on('click', () => actions.switchMode())

  const view = pane.addFolder({ title: '第一人称', expanded: false })
  view.addBinding(state.look, 'sensitivity', { label: '鼠标灵敏度', min: 0.02, max: 0.4, step: 0.005 }).on('change', () => state.onLook())
  view.addBinding(state.look, 'fov', { label: '水平视野角', min: 75, max: 110, step: 1 }).on('change', () => state.onLook())
  view.addBinding(state.look, 'invertY', { label: 'Y 轴反转' }).on('change', () => state.onLook())
  view.addBinding(state.look, 'eyeHeight', { label: '眼高', min: 1.2, max: 1.5, step: 0.05 }).on('change', () => state.onLook())

  const ink = pane.addFolder({ title: '墨线画风', expanded: false })
  ink.addBinding(state.style.toggles, 'outline', { label: '描边' })
  ink.addBinding(state.style.toggles, 'bloom', { label: '泛光' })
  ink.addBinding(state.style.toggles, 'grade', { label: '收尾调色' })
  ink.addBinding(INK_UNIFORMS.inkDots, 'value', { label: '网点', min: 0, max: 1, step: 1 })
  ink.addBinding(INK_UNIFORMS.inkSurfaceDots, 'value', { label: '网点贴表面', min: 0, max: 1, step: 1 })
  ink.addBinding(INK_UNIFORMS.inkDotCell, 'value', { label: '网点格（像素）', min: 3, max: 14, step: 0.5 })
  ink.addBinding(INK_UNIFORMS.inkDotDarken, 'value', { label: '网点深浅', min: 0.3, max: 1, step: 0.01 })
  ink.addBinding(INK_UNIFORMS.inkShadeLow, 'value', { label: '暗部阈值低', min: 0.1, max: 1, step: 0.01 })
  ink.addBinding(INK_UNIFORMS.inkShadeHigh, 'value', { label: '暗部阈值高', min: 0.1, max: 1.2, step: 0.01 })
  ink.addBinding(INK_UNIFORMS.inkTintAmount, 'value', { label: '暗部偏色', min: 0, max: 1, step: 0.01 })
  ink.addBinding(INK_UNIFORMS.inkShadowLevel, 'value', { label: '暗部亮度', min: 0.2, max: 1, step: 0.01 })
  ink.addBinding(INK_UNIFORMS.inkMidLevel, 'value', { label: '中间调亮度', min: 0.5, max: 1, step: 0.01 })
  ink.addBinding(INK_UNIFORMS.inkSpecAmount, 'value', { label: '硬高光', min: 0, max: 1, step: 0.01 })
  ink.addBinding(state.style.look, 'lineWidth', { label: '外轮廓线宽', min: 0.5, max: 5, step: 0.1 })
  ink.addBinding(state.style.look, 'creaseWidth', { label: '转折线宽', min: 0.5, max: 3, step: 0.1 })
  ink.addBinding(state.style.look, 'depthThreshold', { label: '轮廓阈值', min: 0.005, max: 0.2, step: 0.001 })
  ink.addBinding(state.style.look, 'normalThreshold', { label: '转折阈值', min: 0.05, max: 0.8, step: 0.01 })
  ink.addBinding(state.style.look, 'hazeStart', { label: '远景淡化起点', min: 0, max: 200, step: 1 })
  ink.addBinding(state.style.look, 'hazeEnd', { label: '远景淡化终点', min: 50, max: 1500, step: 5 })
  ink.addBinding(state.style.look, 'hazeMax', { label: '远景淡化上限', min: 0, max: 1, step: 0.01 })
  ink.addBinding(state.style.look, 'bloomStrength', { label: '泛光强度', min: 0, max: 3, step: 0.01 })
  ink.addBinding(state.style.look, 'bloomThreshold', { label: '泛光阈值', min: 0.5, max: 3, step: 0.01 })
  ink.addBinding(state.style.look, 'vignette', { label: '暗角', min: 0, max: 1, step: 0.01 })
  ink.addBinding(state.style.look, 'aberration', { label: '色差', min: 0, max: 6, step: 0.1 })
  ink.addBinding(state.style.look, 'grain', { label: '纸纹', min: 0, max: 0.3, step: 0.005 })
  ink.addBinding(state.style.look, 'saturation', { label: '饱和度', min: 0.5, max: 1.6, step: 0.01 })

  const player = pane.addFolder({ title: '主角', expanded: false })
  player.addBinding(tuning.player, 'speed', { label: '移速', min: 1, max: 8, step: 0.1 })
  player.addBinding(tuning.player, 'maxHp', { label: '最大生命*', min: 100, max: 5000, step: 50 })
  player.addBinding(tuning.player, 'legacyRegen', { label: '回血规则', options: { 新规则: 0, 旧规则: 1 } })
  player.addBinding(tuning.player, 'regenDelay', { label: '回血等待', min: 0, max: 10, step: 0.1 })
  player.addBinding(tuning.player, 'regenPerSecond', { label: '每秒回血', min: 0, max: 1000, step: 10 })
  player.addBinding(tuning.player, 'regenSafeRadius', { label: '脱战距离', min: 0, max: 30, step: 0.5 })
  player.addBinding(tuning.player, 'ultimateCharge', { label: '大招充能所需伤害', min: 100, max: 6000, step: 50 })

  for (const group of WEAPON_GROUPS) {
    const folder = pane.addFolder({ title: group.title, expanded: false })
    for (const id of group.ids) addWeapon(folder, tuning.weapons[id], group.fields)
  }

  const grunt = pane.addFolder({ title: '冲锋兵', expanded: false })
  grunt.addBinding(tuning.grunt, 'speed', { label: '移速', min: 0, max: 8, step: 0.1 })
  grunt.addBinding(tuning.grunt, 'maxHp', { label: '生命*', min: 50, max: 3000, step: 10 })
  grunt.addBinding(tuning.grunt, 'sight', { label: '视野', min: 2, max: 15, step: 0.5 })

  const gunner = pane.addFolder({ title: '射手', expanded: false })
  gunner.addBinding(tuning.gunner, 'speed', { label: '移速', min: 0, max: 8, step: 0.1 })
  gunner.addBinding(tuning.gunner, 'maxHp', { label: '生命*', min: 50, max: 3000, step: 10 })
  gunner.addBinding(tuning.gunner, 'sight', { label: '视野', min: 2, max: 15, step: 0.5 })
  gunner.addBinding(tuning.gunner, 'keepMin', { label: '最近距离', min: 0, max: 8, step: 0.1 })
  gunner.addBinding(tuning.gunner, 'keepMax', { label: '最远距离', min: 1, max: 12, step: 0.1 })
  gunner.addBinding(tuning.gunner, 'fireRange', { label: '开火距离', min: 2, max: 15, step: 0.5 })

  const bomber = pane.addFolder({ title: '自爆兵', expanded: false })
  bomber.addBinding(tuning.bomber, 'speed', { label: '移速', min: 0, max: 8, step: 0.1 })
  bomber.addBinding(tuning.bomber, 'maxHp', { label: '生命*', min: 20, max: 2000, step: 10 })
  bomber.addBinding(tuning.bomber, 'sight', { label: '视野', min: 2, max: 15, step: 0.5 })
  bomber.addBinding(tuning.bomber, 'triggerRange', { label: '引爆距离', min: 0.5, max: 4, step: 0.1 })

  const turret = pane.addFolder({ title: '炮塔', expanded: false })
  turret.addBinding(tuning.turret, 'maxHp', { label: '生命*', min: 100, max: 5000, step: 50 })
  turret.addBinding(tuning.turret, 'sight', { label: '视野', min: 2, max: 15, step: 0.5 })

  const shield = pane.addFolder({ title: '盾兵', expanded: false })
  shield.addBinding(tuning.shield, 'speed', { label: '移速', min: 0, max: 8, step: 0.1 })
  shield.addBinding(tuning.shield, 'maxHp', { label: '生命*', min: 50, max: 3000, step: 10 })
  shield.addBinding(tuning.shield, 'sight', { label: '视野', min: 2, max: 15, step: 0.5 })
  shield.addBinding(tuning.shield, 'turnRate', { label: '转身速度', min: 0.2, max: 6, step: 0.1 })
  shield.addBinding(tuning.shield, 'guardArcDeg', { label: '盾牌角度', min: 30, max: 240, step: 5 })

  const thrower = pane.addFolder({ title: '投弹兵', expanded: false })
  thrower.addBinding(tuning.thrower, 'speed', { label: '移速', min: 0, max: 8, step: 0.1 })
  thrower.addBinding(tuning.thrower, 'maxHp', { label: '生命*', min: 50, max: 3000, step: 10 })
  thrower.addBinding(tuning.thrower, 'sight', { label: '视野', min: 2, max: 15, step: 0.5 })
  thrower.addBinding(tuning.thrower, 'keepMin', { label: '最近距离', min: 0, max: 10, step: 0.1 })
  thrower.addBinding(tuning.thrower, 'keepMax', { label: '最远距离', min: 1, max: 12, step: 0.1 })

  const perception = pane.addFolder({ title: '感知与警觉', expanded: false })
  perception.addBinding(tuning.perception, 'bushSight', { label: '草丛内被发现距离', min: 0, max: 6, step: 0.1 })
  perception.addBinding(tuning.perception, 'alertRadius', { label: '呼叫同伴半径', min: 0, max: 15, step: 0.5 })
  perception.addBinding(tuning.perception, 'activationRadius', { label: '激活半径', min: 8, max: 60, step: 1 })
  perception.addBinding(tuning.perception, 'fovDeg', { label: '视野角度', min: 30, max: 360, step: 5 })
  perception.addBinding(tuning.perception, 'proximity', { label: '贴身察觉距离', min: 0, max: 6, step: 0.1 })
  perception.addBinding(tuning.perception, 'noiseRadius', { label: '枪声惊动半径', min: 0, max: 15, step: 0.5 })
  perception.addBinding(tuning.perception, 'loseTime', { label: '丢失目标时间', min: 0.5, max: 15, step: 0.5 })
  perception.addBinding(tuning.perception, 'searchTime', { label: '搜索时间', min: 0, max: 15, step: 0.5 })
  perception.addBinding(tuning.perception, 'suspicionTime', { label: '怀疑查看时间', min: 0, max: 15, step: 0.5 })
  perception.addBinding(tuning.perception, 'leash', { label: '追击距离上限', min: 4, max: 40, step: 1 })
  perception.addBinding(tuning.perception, 'patrolSpeed', { label: '巡逻速度比例', min: 0.1, max: 1, step: 0.05 })
  perception.addBinding(tuning.perception, 'trackScale', { label: '战斗中视野倍数', min: 1, max: 3, step: 0.05 })
  const calm = perception.addFolder({ title: '巡逻与搜索细节', expanded: false })
  calm.addBinding(tuning.perception, 'lookSpeed', { label: '张望转身速度', min: 0, max: 8, step: 0.1 })
  calm.addBinding(tuning.perception, 'investigateCap', { label: '查看最长时间', min: 1, max: 30, step: 0.5 })
  calm.addBinding(tuning.perception, 'suspiciousSpeed', { label: '怀疑时走路速度', min: 0.1, max: 1.5, step: 0.05 })
  calm.addBinding(tuning.perception, 'searchSpeed', { label: '搜索时走路速度', min: 0.1, max: 1.5, step: 0.05 })
  calm.addBinding(tuning.perception, 'returnSpeed', { label: '回位速度倍数', min: 0.5, max: 3, step: 0.05 })
  calm.addBinding(tuning.perception, 'patrolPause', { label: '巡逻点停留', min: 0, max: 5, step: 0.1 })
  calm.addBinding(tuning.perception, 'wanderSpeed', { label: '游荡速度倍数', min: 0.1, max: 1.5, step: 0.05 })
  calm.addBinding(tuning.perception, 'wanderWaitMin', { label: '游荡停顿下限', min: 0, max: 5, step: 0.1 })
  calm.addBinding(tuning.perception, 'wanderWaitMax', { label: '游荡停顿上限', min: 0, max: 8, step: 0.1 })
  calm.addBinding(tuning.perception, 'wanderMinShare', { label: '游荡最近距离比例', min: 0, max: 1, step: 0.05 })

  const ai = pane.addFolder({ title: '敌人出手', expanded: false })
  ai.addBinding(tuning.ai, 'rangedRecover', { label: '远程出手后硬直', min: 0, max: 2, step: 0.05 })
  ai.addBinding(tuning.ai, 'strafeShare', { label: '横移速度比例', min: 0, max: 1.5, step: 0.05 })
  ai.addBinding(tuning.ai, 'strafeRate', { label: '横移换向频率', min: 0.1, max: 3, step: 0.05 })
  ai.addBinding(tuning.ai, 'bomberRearm', { label: '自爆兵被打断后重新引爆', min: 0, max: 5, step: 0.1 })
  ai.addBinding(tuning.ai, 'shieldStrikeDeg', { label: '盾击朝向容差', min: 5, max: 90, step: 1 })
  ai.addBinding(tuning.ai, 'interruptCooldown', { label: '被打断后冷却比例', min: 0, max: 1.5, step: 0.05 })

  for (const def of state.bosses) {
    const boss = pane.addFolder({ title: `Boss：${def.name}（不保存）`, expanded: false })
    boss.addBinding(def, 'maxHp', { label: '生命*', min: 500, max: 60000, step: 100 })
    boss.addBinding(def, 'walkSpeed', { label: '移速', min: 0, max: 6, step: 0.1 })
    boss.addBinding(def, 'walkTime', { label: '招式间隔', min: 0.2, max: 5, step: 0.1 })
    boss.addBinding(def.charge, 'telegraph', { label: '冲撞前摇', min: 0.2, max: 3, step: 0.05 })
    boss.addBinding(def.charge, 'speed', { label: '冲撞速度', min: 3, max: 25, step: 0.5 })
    boss.addBinding(def.charge, 'damage', { label: '冲撞伤害', min: 0, max: 1000, step: 10 })
    boss.addBinding(def.charge, 'recover', { label: '冲撞硬直', min: 0, max: 4, step: 0.05 })
    boss.addBinding(def, 'stunSeconds', { label: '撞墙眩晕', min: 0, max: 6, step: 0.1 })
    if (def.slam) boss.addBinding(def.slam, 'recover', { label: '震地硬直', min: 0, max: 4, step: 0.05 })
    if (def.fan) boss.addBinding(def.fan, 'recover', { label: '散射硬直', min: 0, max: 4, step: 0.05 })
    if (def.sweep) boss.addBinding(def.sweep, 'recover', { label: '横扫硬直', min: 0, max: 4, step: 0.05 })
    if (def.spin) boss.addBinding(def.spin, 'gapDeg', { label: '刀片缺口角度', min: 20, max: 180, step: 5 })
    if (def.bales) boss.addBinding(def.bales, 'count', { label: '麦捆数量', min: 1, max: 12, step: 1 })
  }

  const feel = pane.addFolder({ title: '打击感', expanded: false })
  feel.addBinding(tuning.feel, 'hitstopKill', { label: '击杀停顿', min: 0, max: 0.2, step: 0.005 })
  feel.addBinding(tuning.feel, 'hitstopHurt', { label: '受伤停顿', min: 0, max: 0.2, step: 0.005 })
  feel.addBinding(tuning.feel, 'hitstopBoss', { label: '击败 Boss 停顿', min: 0, max: 0.5, step: 0.01 })
  feel.addBinding(tuning.feel, 'hitstopScale', { label: '停顿时速度', min: 0, max: 1, step: 0.01 })
  feel.addBinding(tuning.feel, 'knockbackDecay', { label: '击退衰减', min: 1, max: 30, step: 0.5 })
  feel.addBinding(tuning.feel, 'blastKnockback', { label: '爆炸击退', min: 0, max: 20, step: 0.5 })
  feel.addBinding(tuning.feel, 'shakeShot', { label: '射击震屏', min: 0, max: 0.5, step: 0.01 })
  feel.addBinding(tuning.feel, 'shakeHit', { label: '命中震屏', min: 0, max: 1, step: 0.01 })
  feel.addBinding(tuning.feel, 'shakeKill', { label: '击杀震屏', min: 0, max: 1, step: 0.01 })
  feel.addBinding(tuning.feel, 'shakeHurt', { label: '受伤震屏', min: 0, max: 1, step: 0.01 })
  feel.addBinding(tuning.feel, 'shakeBlast', { label: '爆炸震屏', min: 0, max: 1, step: 0.01 })
  feel.addBinding(tuning.feel, 'shakeMaxOffset', { label: '震屏幅度', min: 0, max: 2, step: 0.05 })
  feel.addBinding(tuning.feel, 'flashSeconds', { label: '闪白时长', min: 0, max: 0.5, step: 0.01 })

  const camera = pane.addFolder({ title: '镜头', expanded: false })
  camera.addBinding(tuning.camera, 'pitch', { label: '俯角', min: 30, max: 89, step: 1 })
  camera.addBinding(tuning.camera, 'distance', { label: '距离', min: 6, max: 40, step: 0.5 })
  camera.addBinding(tuning.camera, 'fov', { label: '视野', min: 20, max: 80, step: 1 })
  camera.addBinding(tuning.camera, 'lead', { label: '瞄准前瞻', min: 0, max: 1, step: 0.01 })
  camera.addBinding(tuning.camera, 'maxLead', { label: '前瞻上限', min: 0, max: 8, step: 0.1 })
  camera.addBinding(tuning.camera, 'followSharpness', { label: '跟随灵敏度', min: 1, max: 30, step: 0.5 })
  camera.addBinding(tuning.camera, 'bossZoom', { label: 'Boss 战拉远', min: 0, max: 15, step: 0.5 })
  camera.addBinding(tuning.camera, 'bossFocus', { label: 'Boss 战焦点偏向', min: 0, max: 0.6, step: 0.05 })

  const audio = pane.addFolder({ title: '声音', expanded: false })
  audio.addBinding(tuning.audio, 'volume', { label: '音量', min: 0, max: 1, step: 0.05 })

  if (state.training) {
    const waves = pane.addFolder({ title: '训练场波次', expanded: false })
    waves.addBinding(tuning.waves, 'base', { label: '首波数量', min: 1, max: 20, step: 1 })
    waves.addBinding(tuning.waves, 'growth', { label: '每波增加', min: 0, max: 5, step: 1 })
    waves.addBinding(tuning.waves, 'max', { label: '每波上限', min: 1, max: 40, step: 1 })
    waves.addBinding(tuning.waves, 'delay', { label: '波次间隔', min: 0, max: 10, step: 0.1 })
    waves.addBinding(tuning.waves, 'warning', { label: '出生预警', min: 0, max: 3, step: 0.05 })
    waves.addBinding(tuning.waves, 'minDistance', { label: '出生点最小距离', min: 0, max: 15, step: 0.5 })
    waves.addBinding(tuning.waves, 'jitter', { label: '出生位置抖动', min: 0, max: 2, step: 0.05 })
    waves.addBinding(tuning.waves, 'stagger', { label: '依次出生间隔', min: 0, max: 1, step: 0.01 })
  }

  pane.addBlade({ view: 'separator' })
  pane.addButton({ title: '复制参数 JSON' }).on('click', () => {
    void navigator.clipboard?.writeText(JSON.stringify(tuning, null, 2)).catch(() => undefined)
  })
  pane.addButton({ title: '恢复默认' }).on('click', () => {
    for (const [path, value] of Object.entries(flatten(createDefaultTuning()))) assign(tuning, path, value)
    pane.refresh()
    saveTuning(tuning)
  })

  pane.on('change', () => saveTuning(tuning))
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Backquote') pane.hidden = !pane.hidden
  })
  return { setAreas }
}

function addWeapon(parent: FolderApi, weapon: WeaponDef, fields: WeaponField[]): void {
  const folder = parent.addFolder({ title: weapon.name, expanded: false })
  for (const field of fields) {
    const spec = WEAPON_FIELDS[field]
    if (!spec || !RELEVANT[weapon.kind].has(field)) continue
    if (field === 'magazine' && weapon.ammo === 'none') continue
    if (field === 'reloadSeconds' && weapon.ammo !== 'reload') continue
    if (field === 'arcDeg' && weapon.arcDeg <= 0) continue
    folder.addBinding(weapon, field, spec)
  }
}

function flatten(value: unknown, prefix = '', out: Flat = {}): Flat {
  if (typeof value === 'number') {
    out[prefix] = value
    return out
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, out)
  }
  return out
}

function assign(target: unknown, path: string, value: number): void {
  const keys = path.split('.')
  const last = keys.pop()
  let node: unknown = target
  for (const key of keys) {
    if (!node || typeof node !== 'object') return
    node = (node as Record<string, unknown>)[key]
  }
  if (!last || !node || typeof node !== 'object') return
  const record = node as Record<string, unknown>
  if (typeof record[last] === 'number') record[last] = value
}

function saveTuning(tuning: Tuning): void {
  try {
    const saved: SavedTuning = { defaults: flatten(createDefaultTuning()), values: flatten(tuning) }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
  } catch {
    return
  }
}

function readSaved(): SavedTuning | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { defaults, values } = parsed as Partial<SavedTuning>
    if (!defaults || !values) return null
    return { defaults, values }
  } catch {
    return null
  }
}
