import { chapterOf } from './chapters'
import type { ClueId } from './clues'
import type { MinionKind } from './enemies'
import type { LandmarkId } from './landmarks'
import type { GridPoint } from './levels/types'

export type SpeakerId = 'narrator' | 'kai' | 'greyhawk' | 'auntMai' | 'alo' | 'bolt' | 'laoTang' | 'mingzhu'

export type Expression = 'normal' | 'happy' | 'angry' | 'surprised'

export type StoryScene = 'prologue' | 'chapter-1-title' | 'chapter-1'

export interface SpeakerDef {
  name: string
  portrait: string | null
  expressions: readonly Expression[]
  side: 'left' | 'right'
  radio: boolean
}

export interface ChapterCard {
  kicker: string
  title: string
}

export interface DialogueLine {
  speaker: SpeakerId
  text: string
  expression?: Expression
  scene?: StoryScene
  card?: ChapterCard
  radio?: boolean
}

export interface LevelStory {
  intro?: readonly DialogueLine[]
  boss?: readonly DialogueLine[]
  outro?: readonly DialogueLine[]
}

export interface Interlude {
  id: string
  chapter: number
  title: string
  after: string
  lines: readonly DialogueLine[]
}

export const SPEAKERS: Readonly<Record<SpeakerId, SpeakerDef>> = {
  narrator: { name: '', portrait: null, expressions: [], side: 'left', radio: false },
  kai: { name: '凯', portrait: 'kai', expressions: ['normal', 'happy', 'angry', 'surprised'], side: 'left', radio: false },
  greyhawk: { name: '灰隼', portrait: 'greyhawk', expressions: ['normal'], side: 'right', radio: false },
  auntMai: { name: '麦婶', portrait: 'aunt-mai', expressions: ['normal'], side: 'right', radio: false },
  alo: { name: '阿洛博士', portrait: 'alo', expressions: ['normal'], side: 'right', radio: true },
  bolt: { name: '螺栓上尉', portrait: 'bolt', expressions: ['normal'], side: 'right', radio: false },
  laoTang: { name: '老汤', portrait: 'lao-tang', expressions: ['normal'], side: 'right', radio: false },
  mingzhu: { name: '明烛长老', portrait: 'mingzhu', expressions: ['normal'], side: 'right', radio: false },
}

function chapterCard(id: number, scene: StoryScene): DialogueLine {
  const chapter = chapterOf(id)
  return { speaker: 'narrator', scene, card: { kicker: `第 ${chapter.id} 章`, title: chapter.name }, text: chapter.title }
}

export const STORIES: Readonly<Record<string, LevelStory>> = {
  '1-1': {
    intro: [
      { speaker: 'narrator', scene: 'prologue', text: '昨夜，星穹塔上空的星核碎成了五块，其中一道流光落进了晨风镇外的麦田。' },
      { speaker: 'auntMai', text: '凯！悬赏板刚贴上新的——齿轮男爵，十万星币！' },
      { speaker: 'kai', expression: 'happy', text: '十万？这单我接了，办成了就能换正式执照！' },
      { speaker: 'greyhawk', text: '我这条腿是追不动了。能量枪你拿着，三发一停，别贪枪。' },
      { speaker: 'greyhawk', text: '……这把枪欠一件对的事。' },
      { speaker: 'alo', text: '这里是星穹塔的阿洛。碎片信号正往收割场移动，群岛每天都在往下沉，拜托你了！' },
      { speaker: 'kai', expression: 'angry', text: '瞄准，然后——别犹豫！' },
      chapterCard(1, 'chapter-1-title'),
    ],
    outro: [
      { speaker: 'alo', text: '稻草人只是看门的。碎片的信号……往牧场那边去了。' },
      { speaker: 'kai', text: '那就追到牧场去。' },
    ],
  },
  '1-2': {
    intro: [
      { speaker: 'laoTang', text: '它们把干草和麦子都装车了！' },
      { speaker: 'kai', expression: 'surprised', text: '车往哪边走了？' },
      { speaker: 'laoTang', text: '往装车场去了，再晚一步就拉走了！' },
      { speaker: 'alo', text: '小心，那边有会自爆的机器人。看到地上的红圈就躲开！' },
    ],
    outro: [
      { speaker: 'narrator', text: '谷仓塌了一半。爆破头目倒下前，把炸弹一颗颗摆好，像在交还工具。' },
      { speaker: 'kai', text: '……它们到底从哪来的？' },
      { speaker: 'alo', text: '运粮车是往北边的废弃农庄去的，碎片的信号也在那里。' },
    ],
  },
  '1-3': {
    intro: [
      { speaker: 'alo', text: '农庄被改成粮仓了。硬闯会惊动整个粮仓，试试从麦垛里摸进去。' },
      { speaker: 'kai', expression: 'surprised', text: '钻麦垛？我会打喷嚏的。' },
      { speaker: 'alo', text: '那就憋着。北边有座钟楼，被它们发现的话，会有机器人跑去敲钟。' },
    ],
    outro: [
      { speaker: 'narrator', text: '铁盾队长倒下前，把盾牌立好，敬了个礼。' },
      { speaker: 'kai', text: '打架还这么讲究。' },
      { speaker: 'alo', text: '运粮单上的车往北边的林子去了，碎片的信号也在那边。小心，林子里起雾了。' },
    ],
  },
  '1-4': {
    intro: [
      { speaker: 'alo', text: '雾里我也看不清，跟着信号走。看到琥珀色的光点，那是它们的眼灯。' },
      { speaker: 'kai', text: '信号往林子深处去了？' },
      { speaker: 'alo', text: '对。林子里有老林场留下的驱雾灯，点亮了能看远一点。' },
    ],
    outro: [
      { speaker: 'narrator', text: '林地炮车冒着黑烟，倒车撤进了收割场。' },
      { speaker: 'alo', text: '碎片就在前面那座工厂里，信号很强。' },
    ],
  },
  '1-5': {
    intro: [
      { speaker: 'kai', expression: 'angry', text: '它们要把整片麦田都收光！' },
      { speaker: 'alo', text: '工厂里的读数……碎片被当成发动机用了。' },
      { speaker: 'alo', text: '麦田里有自动收割刀，地上亮红线就是要扫过来了，先躲进麦丛。' },
    ],
    boss: [
      { speaker: 'bolt', text: '哈哈！有星核碎片当动力，这台收割机天下无敌！' },
      { speaker: 'kai', expression: 'angry', text: '把碎片交出来！' },
      { speaker: 'bolt', text: '想要？先问问我的刀片！' },
    ],
    outro: [
      { speaker: 'bolt', text: '弹射！弹射！……你给我记住！我妈还等着麦子呢！' },
      { speaker: 'kai', expression: 'surprised', text: '……他妈妈？' },
      { speaker: 'alo', text: '第一块碎片到手了！快带回星穹塔！' },
      { speaker: 'narrator', text: '晨星在凯手里轻轻地往风车坡的方向拽了一下。' },
      { speaker: 'kai', expression: 'surprised', text: '它想去哪？' },
      { speaker: 'alo', text: '残余磁性，别管它，带回来。' },
      { speaker: 'kai', expression: 'happy', text: '收工！' },
    ],
  },
  'trial-harvester': {
    intro: [
      { speaker: 'bolt', text: '哈哈！有星核碎片当动力，这台收割机天下无敌！' },
      { speaker: 'kai', expression: 'angry', text: '把碎片交出来！' },
      { speaker: 'bolt', text: '想要？先问问我的刀片！' },
    ],
    outro: [
      { speaker: 'bolt', text: '弹射！弹射！……你给我记住！我妈还等着麦子呢！' },
      { speaker: 'kai', expression: 'surprised', text: '……他妈妈？' },
      { speaker: 'alo', text: '第一块碎片到手了！快带回星穹塔！' },
      { speaker: 'kai', expression: 'happy', text: '收工！' },
    ],
  },
}

export const INTERLUDES: readonly Interlude[] = [
  {
    id: 'interlude-1',
    chapter: 1,
    title: '初到星穹塔',
    after: '1-5',
    lines: [
      { speaker: 'narrator', text: '凯第一次走进星穹塔。守星长老亲自在观星台等她。' },
      { speaker: 'mingzhu', text: '你就是晨风镇的小猎人？……来，先吃颗星星糖。' },
      { speaker: 'kai', expression: 'surprised', text: '呃……谢谢长老。' },
      { speaker: 'mingzhu', text: '晨风镇的英雄，不用拘束。碎片带来了吧？' },
      { speaker: 'narrator', scene: 'chapter-1', text: '晨星放进星核座的那一刻，脚下的星环岛轻轻往上一抬，塔里的人都欢呼起来。' },
      { speaker: 'alo', scene: 'chapter-1', radio: false, text: '读数在涨！星环岛……升起来了！' },
      { speaker: 'kai', expression: 'happy', text: '路上那帮强盗可客气了，打架前还先道歉。' },
      { speaker: 'mingzhu', text: '……机器人哪懂什么道歉。光要省着用，碎片放在塔里，大家才睡得踏实。' },
      { speaker: 'kai', text: '那正式执照……' },
      { speaker: 'mingzhu', text: '五块碎片都回来的那天，执照、赏金，一样都不会少。' },
      { speaker: 'narrator', text: '离开前，凯趴在观星台的栏杆上往下看。' },
      { speaker: 'narrator', text: '云层下面，晨风镇的码头……好像又低了一点。' },
      { speaker: 'kai', text: '……是我看错了吧。' },
      { speaker: 'alo', radio: false, text: '凯！第二块碎片的信号找到了，在赤砂矿坑！' },
      { speaker: 'kai', expression: 'happy', text: '矿坑？行，这单我也接了！' },
    ],
  },
]

export const BOSS_LINES: Readonly<Record<string, string>> = {
  scarecrow: '……麦田……禁止……通行……',
  harvester: '螺栓上尉：收割开始！一粒麦子都不留！',
  'demo-chief': '……爆破作业……闲人……退后……',
  'shield-captain': '……粮仓重地……队长在此……止步……',
  'forest-tank': '……伪装……完毕……开炮……',
}

export type BarkTrigger =
  | { on: 'enter'; area: number }
  | { on: 'near'; landmark: LandmarkId; radius: number }
  | { on: 'targets'; count: number }
  | { on: 'spotted'; area: number; at: GridPoint }
  | { on: 'sees'; kind: MinionKind; range: number }
  | { on: 'runner' }
  | { on: 'alarm' }
  | { on: 'clue'; clue: ClueId }
  | { on: 'blade' }
  | { on: 'elite'; range: number }
  | { on: 'after'; bark: string; seconds: number }

export type BarkDisplay = 'bar' | 'bubble'

export interface Bark {
  id: string
  speaker: SpeakerId | null
  text: string
  display: BarkDisplay
  trigger: BarkTrigger
  radio?: boolean
}

export const BARK_SECONDS = 4

export const BARKS: Readonly<Record<string, readonly Bark[]>> = {
  '1-1': [
    {
      id: 'sorry',
      speaker: null,
      text: '抱歉！麦子借用一下！',
      display: 'bubble',
      trigger: { on: 'spotted', area: 0, at: [18, 22] },
    },
    {
      id: 'robbery',
      speaker: 'kai',
      text: '借？你们这叫抢！',
      display: 'bar',
      trigger: { on: 'after', bark: 'sorry', seconds: 1.2 },
    },
    {
      id: 'aim',
      speaker: 'alo',
      text: '看到红线就是射手在瞄你，躲到石头后面。',
      display: 'bar',
      trigger: { on: 'enter', area: 1 },
    },
    {
      id: 'altar',
      speaker: 'kai',
      text: '石台上刻着一颗星……跟碎片一个形状？',
      display: 'bar',
      trigger: { on: 'clue', clue: 'star-altar' },
    },
  ],
  '1-2': [
    {
      id: 'sorry',
      speaker: null,
      text: '抱歉！干草也借用一下！',
      display: 'bubble',
      trigger: { on: 'spotted', area: 2, at: [24, 20] },
    },
    {
      id: 'cashbox',
      speaker: 'laoTang',
      text: '钱箱就在那儿，碰都没碰。',
      display: 'bar',
      trigger: { on: 'targets', count: 1 },
    },
    {
      id: 'plough',
      speaker: 'laoTang',
      text: '这不是二十年前镇上买的耕地机吗？那时候有人开着船来卖，便宜又结实。',
      display: 'bar',
      trigger: { on: 'near', landmark: 'grunt-wreck', radius: 4 },
    },
  ],
  '1-3': [
    {
      id: 'shieldBearer',
      speaker: 'alo',
      text: '那个举着门板的，正面打不动。绕到它背后去！',
      display: 'bar',
      trigger: { on: 'sees', kind: 'shield', range: 8 },
    },
    {
      id: 'thief',
      speaker: null,
      text: '警报！有人偷麦子！',
      display: 'bubble',
      trigger: { on: 'runner' },
    },
    {
      id: 'bell',
      speaker: 'alo',
      text: '钟响了！前面的院子会来更多机器人。',
      display: 'bar',
      trigger: { on: 'alarm' },
    },
    {
      id: 'rustAnchor',
      speaker: 'alo',
      text: '锈锚……地图上没有这个地方。',
      display: 'bar',
      trigger: { on: 'clue', clue: 'manifest' },
    },
  ],
  '1-4': [
    {
      id: 'turret',
      speaker: 'alo',
      text: '那是固定炮塔，躲到原木后面，等它打完一轮再探头！',
      display: 'bar',
      trigger: { on: 'sees', kind: 'turret', range: 10 },
    },
    {
      id: 'daddy',
      speaker: 'kai',
      text: '……机器人哪来的爸爸。',
      display: 'bar',
      trigger: { on: 'clue', clue: 'drawing' },
    },
    {
      id: 'mom',
      speaker: 'bolt',
      text: '妈，再收一片地就回家。你的腰好点没？',
      display: 'bar',
      trigger: { on: 'enter', area: 3 },
      radio: true,
    },
  ],
  '1-5': [
    {
      id: 'redLine',
      speaker: 'alo',
      text: '红线！刀片要扫过来了！',
      display: 'bar',
      trigger: { on: 'blade' },
    },
    {
      id: 'crown',
      speaker: 'alo',
      text: '戴冠的那个是精英，皮厚，还带着本事。',
      display: 'bar',
      trigger: { on: 'elite', range: 8 },
    },
    {
      id: 'belts',
      speaker: 'kai',
      text: '传送带把麦子全往飞艇里送……',
      display: 'bar',
      trigger: { on: 'enter', area: 2 },
    },
    {
      id: 'anchor',
      speaker: 'kai',
      text: '这些箱子也印着船锚。麦子都要运去锈锚？',
      display: 'bar',
      trigger: { on: 'clue', clue: 'anchor-crate' },
    },
    {
      id: 'gate',
      speaker: 'alo',
      text: '收割机就在门后面。补好血再进去。',
      display: 'bar',
      trigger: { on: 'enter', area: 3 },
    },
  ],
}
