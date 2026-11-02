export type ClueId = 'star-altar' | 'iou' | 'manifest' | 'drawing' | 'anchor-crate'

export interface ClueDef {
  title: string
  text: string
  chapter: number
  level: string
}

export const CLUE_ORDER: readonly ClueId[] = ['star-altar', 'iou', 'manifest', 'drawing', 'anchor-crate']

export const CLUES: Readonly<Record<ClueId, ClueDef>> = {
  'star-altar': {
    title: '刻星的石台',
    text: '石台上刻着一颗星，和星核碎片的形状一样。镇上没人说得清它是谁刻的。',
    chapter: 1,
    level: '1-1',
  },
  iou: {
    title: '借条',
    text: '歪歪扭扭的字：「借干草三车、麦子两车，秋收后奉还。」落款是一个船锚。',
    chapter: 1,
    level: '1-2',
  },
  manifest: {
    title: '运粮单',
    text: '一张盖着船锚印的运粮单：「麦子四十车、干草二十车。」目的地一栏写着「锈锚」，这两个字被描了好几遍。',
    chapter: 1,
    level: '1-3',
  },
  drawing: {
    title: '蜡笔画',
    text: '一张贴在机器人背上的蜡笔画：一座插着铁锚的小岛，旁边歪歪扭扭写着「爸爸早点回家」。',
    chapter: 1,
    level: '1-4',
  },
  'anchor-crate': {
    title: '船锚货箱',
    text: '传送带上的货箱都印着同一个船锚，和借条落款、运粮单上的一样。飞艇要把整片麦田运去同一个地方。',
    chapter: 1,
    level: '1-5',
  },
}

export const CLUE_REACH = 0.75

export function isClueId(value: string): value is ClueId {
  return (CLUE_ORDER as readonly string[]).includes(value)
}
