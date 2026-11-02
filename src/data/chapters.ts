export interface ChapterDef {
  id: number
  name: string
  title: string
  levels: readonly string[]
}

export const CHAPTERS: readonly ChapterDef[] = [
  { id: 1, name: '晨风镇', title: '借麦子的强盗', levels: ['1-1', '1-2', '1-3', '1-4', '1-5'] },
  { id: 2, name: '赤砂矿坑', title: '地下的救援', levels: [] },
  { id: 3, name: '霜牙要塞', title: '守望者', levels: [] },
  { id: 4, name: '熔炉工厂', title: '炉火与白光', levels: [] },
  { id: 5, name: '天穹', title: '碎了的星', levels: [] },
]

export function chapterOf(id: number): ChapterDef {
  const chapter = CHAPTERS.find((item) => item.id === id)
  if (!chapter) throw new Error(`unknown chapter ${id}`)
  return chapter
}
