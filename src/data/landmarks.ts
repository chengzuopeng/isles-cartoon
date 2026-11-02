export type Facing = 0 | 90 | 180 | 270

export const FACINGS: readonly Facing[] = [0, 90, 180, 270]

export type MotionAxis = 'x' | 'y' | 'z'

export interface LandmarkMotion {
  node: string
  axis: MotionAxis
  spin?: number
  swing?: number
  speed?: number
}

export type BreakRule = 'hits' | 'blasts' | 'crashes'

export interface LandmarkBreakDef {
  rule: BreakRule
  hp: number
  into: string
  xp: number
  target: boolean
}

export interface LandmarkPerch {
  x: number
  y: number
  height: number
}

export interface LandmarkDef {
  name: string
  level: string
  size: readonly [number, number]
  footprint?: readonly string[]
  blocksMovement: boolean
  blocksShots: boolean
  hides?: boolean
  height: number
  variants?: number
  motion?: readonly LandmarkMotion[]
  nodes?: readonly string[]
  states?: readonly string[]
  breaks?: LandmarkBreakDef
  gate?: readonly [number, number]
  opens?: readonly string[]
  deck?: boolean
  pool?: number
  lamp?: boolean
  perch?: LandmarkPerch
  hideInside?: readonly string[]
  hideMargin?: number
}

export const LANDMARK_IDS = [
  'ch1-town-gate',
  'ch1-windmill',
  'ch1-barn',
  'ch1-star-altar',
  'ch1-wheat-ears',
  'ch1-sheep-pen',
  'ch1-feed-shed',
  'ch1-hay-cart',
  'ch1-dock',
  'ch1-watermill',
  'ch1-hay-pillar',
  'ch1-ruined-wall',
  'ch1-smithy',
  'ch1-wheat-stack',
  'ch1-bell-tower',
  'ch1-farmhouse',
  'ch1-well',
  'ch1-cellar',
  'ch1-silo',
  'ch1-log',
  'ch1-log-short',
  'ch1-fog-lamp',
  'ch1-cabin',
  'ch1-waterfall-cave',
  'ch1-sawmill',
  'ch1-stump',
  'ch1-blade-trap',
  'ch1-bale-block',
  'ch1-airship',
  'ch1-anchor-crate',
  'ch1-factory-gate',
  'grunt-wreck',
  'grunt-wreck-drawing',
] as const

export type LandmarkId = (typeof LANDMARK_IDS)[number]

const solid = { blocksMovement: true, blocksShots: true } as const
const low = { blocksMovement: true, blocksShots: false } as const
const open = { blocksMovement: false, blocksShots: false } as const

export const LANDMARKS: Readonly<Record<LandmarkId, LandmarkDef>> = {
  'ch1-town-gate': {
    name: '晨风镇大门和悬赏板',
    level: '1-1',
    size: [10, 2],
    ...solid,
    height: 4.2,
    motion: [{ node: 'sign', axis: 'y', swing: 0.1, speed: 1.1 }],
    nodes: ['gate', 'sign', 'board', 'lamp_l', 'lamp_r', 'socket_fx_lamp_l', 'socket_fx_lamp_r'],
  },
  'ch1-windmill': {
    name: '大风车',
    level: '1-1',
    size: [6, 5],
    footprint: ['.####.', '######', '######', '######', '.####.'],
    ...solid,
    height: 8,
    motion: [{ node: 'sails', axis: 'x', spin: 0.7 }],
    nodes: ['body', 'cap', 'door'],
  },
  'ch1-barn': {
    name: '谷仓',
    level: '1-1',
    size: [6, 6],
    footprint: ['######', '#....#', '#....#', '#....#', '#....#', '##.###'],
    ...solid,
    height: 4.6,
    nodes: ['body', 'roof', 'door_l', 'door_r'],
  },
  'ch1-star-altar': {
    name: '刻星的老石台',
    level: '1-1',
    size: [2, 2],
    ...solid,
    height: 0.9,
    nodes: ['body', 'star', 'socket_fx_star'],
  },
  'ch1-wheat-ears': { name: '散落的麦穗', level: '1-1', size: [1, 1], ...open, height: 0.08, variants: 3 },
  'ch1-sheep-pen': {
    name: '羊圈',
    level: '1-2',
    size: [3, 3],
    footprint: ['###', '#.#', '###'],
    ...low,
    height: 0.75,
    nodes: ['body', 'gate'],
    gate: [1, 2],
    opens: ['gate'],
  },
  'ch1-feed-shed': {
    name: '饲料棚',
    level: '1-2',
    size: [3, 3],
    footprint: ['###', '#.#', '#.#'],
    ...solid,
    height: 2.8,
    nodes: ['body', 'roof'],
  },
  'ch1-hay-cart': {
    name: '草料车',
    level: '1-2',
    size: [2, 3],
    ...solid,
    height: 1.9,
    nodes: ['body', 'load', 'wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'],
    states: ['wreck'],
    breaks: { rule: 'hits', hp: 2400, into: 'wreck', xp: 15, target: true },
  },
  'ch1-dock': { name: '河边小码头', level: '1-2', size: [3, 4], ...open, height: 1.2, deck: true },
  'ch1-watermill': {
    name: '水车磨坊',
    level: '1-2',
    size: [7, 5],
    footprint: ['######~', '######~', '######~', '######~', '######.'],
    ...solid,
    height: 5.6,
    motion: [{ node: 'wheel', axis: 'y', spin: 0.9 }],
    nodes: ['body', 'secret_door'],
    opens: ['secret_door'],
  },
  'ch1-hay-pillar': {
    name: '草垛柱子',
    level: '1-2',
    size: [2, 2],
    ...solid,
    height: 2.6,
    nodes: ['post', 'bales'],
    states: ['collapsed'],
    breaks: { rule: 'blasts', hp: 0, into: 'collapsed', xp: 0, target: false },
  },
  'ch1-ruined-wall': { name: '倒塌的院墙', level: '1-3', size: [1, 1], ...solid, height: 1.1, variants: 3 },
  'ch1-smithy': {
    name: '塌了一半的铁匠铺',
    level: '1-3',
    size: [4, 4],
    footprint: ['####', '#..#', '#..#', '#.##'],
    ...solid,
    height: 4.2,
    nodes: ['body', 'socket_fx_forge', 'socket_fx_smoke'],
  },
  'ch1-wheat-stack': { name: '麦垛', level: '1-3', size: [1, 1], ...open, hides: true, height: 1, variants: 3 },
  'ch1-bell-tower': {
    name: '钟楼',
    level: '1-3',
    size: [3, 3],
    ...solid,
    height: 7,
    nodes: ['body', 'roof', 'bell', 'lamp'],
  },
  'ch1-farmhouse': { name: '农舍', level: '1-3', size: [5, 4], ...solid, height: 4.6, nodes: ['body', 'socket_fx_smoke'] },
  'ch1-well': {
    name: '水井',
    level: '1-3',
    size: [2, 2],
    ...solid,
    height: 2.2,
    motion: [
      { node: 'crank', axis: 'y', spin: 0.6 },
      { node: 'bucket', axis: 'x', swing: 0.07, speed: 1.3 },
    ],
    nodes: ['body', 'roof', 'crank', 'bucket'],
  },
  'ch1-cellar': {
    name: '地窖入口',
    level: '1-3',
    size: [2, 2],
    ...low,
    height: 0.6,
    nodes: ['frame', 'door_l', 'door_r'],
    opens: ['door_l', 'door_r'],
  },
  'ch1-silo': { name: '圆筒粮仓', level: '1-3', size: [3, 3], ...solid, height: 5.5, nodes: ['body'] },
  'ch1-log': { name: '原木', level: '1-4', size: [1, 3], ...solid, height: 0.75 },
  'ch1-log-short': { name: '短原木', level: '1-4', size: [1, 2], ...solid, height: 0.75 },
  'ch1-fog-lamp': { name: '驱雾灯', level: '1-4', size: [1, 1], ...low, height: 2.4, nodes: ['post', 'lamp', 'socket_fx_light'], lamp: true },
  'ch1-cabin': {
    name: '林中小屋',
    level: '1-4',
    size: [3, 3],
    footprint: ['###', '#.#', '#.#'],
    ...solid,
    height: 3.2,
    nodes: ['body', 'roof', 'door'],
  },
  'ch1-waterfall-cave': {
    name: '瀑布后的洞口',
    level: '1-4',
    size: [4, 2],
    footprint: ['####', '#..#'],
    ...solid,
    height: 3.5,
    nodes: ['socket_fx_waterfall'],
    pool: 1,
  },
  'ch1-sawmill': {
    name: '锯木场和木材堆',
    level: '1-4',
    size: [5, 4],
    ...solid,
    height: 3.6,
    motion: [{ node: 'saw', axis: 'x', spin: 6 }],
    nodes: ['body', 'roof', 'lumber'],
    perch: { x: 1.47, y: -0.2, height: 2.5 },
  },
  'ch1-stump': {
    name: '树桩',
    level: '1-4',
    size: [1, 1],
    ...solid,
    height: 0.6,
    variants: 3,
    states: ['b'],
    breaks: { rule: 'crashes', hp: 0, into: 'b', xp: 0, target: false },
  },
  'ch1-blade-trap': {
    name: '刀片陷阱',
    level: '1-5',
    size: [2, 1],
    ...open,
    height: 1,
    motion: [{ node: 'reel', axis: 'y', spin: 8 }],
    nodes: ['body'],
  },
  'ch1-bale-block': { name: '麦捆块', level: '1-5', size: [1, 1], ...solid, height: 1.1, variants: 3 },
  'ch1-airship': {
    name: '飞艇和货舱',
    level: '1-5',
    size: [6, 12],
    footprint: ['######', '#....#', '#....#', '#....#', '#....#', '#....#', '#....#', '#....#', '#....#', '##..##', '......', '......'],
    ...solid,
    height: 9.5,
    motion: [
      { node: 'prop_l', axis: 'x', spin: 4 },
      { node: 'prop_r', axis: 'x', spin: 4 },
    ],
    nodes: ['hull', 'balloon', 'ramp'],
    hideInside: ['balloon'],
    hideMargin: 2,
  },
  'ch1-anchor-crate': { name: '船锚徽记的箱子', level: '1-5', size: [1, 1], ...solid, height: 0.9, variants: 3 },
  'ch1-factory-gate': {
    name: '工厂大门',
    level: '1-5',
    size: [8, 2],
    footprint: ['##....##', '##....##'],
    ...solid,
    height: 5,
    nodes: ['frame', 'door_l', 'door_r'],
  },
  'grunt-wreck': { name: '冲锋兵残骸', level: '1-2', size: [2, 1], ...open, height: 0.5 },
  'grunt-wreck-drawing': { name: '贴着蜡笔画的冲锋兵残骸', level: '1-4', size: [2, 1], ...open, height: 0.5 },
}
