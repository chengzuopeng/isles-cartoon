# 地图工具：`pnpm map`

- 状态：2026-11-11 从 1-1 的临时测量脚本整理成命令。地图逻辑在 Node 中执行，`draw` 和 `compare` 用本机 Chrome 生成 PNG
- 相关：[1-1 地图重做](../design/levels/1-1-layout.md)（第一次用这套办法）、[1-2 地图重做](../design/levels/1-2-layout.md)（第一次用这个命令，从草稿到落地走完了一遍）、[自动驾驶](autopilot.md)

改一关的地图之前，先回答三个问题：现在的地图哪里一览无余、新布局挡住了没有、新布局走不走得通。这个命令把三件事都做成一条：

```bash
pnpm map draw 1-2                                  # 画现在的 1-2，打印视线统计和关卡校验
pnpm map compare 1-3 scripts/map/sketches/1-3.mjs  # 现在和草稿并排
pnpm map play scripts/map/sketches/1-3.mjs --points brawl=1,gun=1 --skills q=concussion:1 --carry shotgun --badges straw   # 自动驾驶三档各跑 5 局
pnpm map play 1-1 --replay --chapter1 --seeds 1,2,3 --skills q=concussion:1   # 按通关第 1 章后的重玩规则跑
pnpm map text 1-1                                  # 打印字符画和高度表，带行号
pnpm map emit scripts/map/sketches/1-3.mjs src/data/levels/level-1-3.ts   # 草稿写成关卡数据
pnpm map --help                                    # 全部命令和选项
```

「关卡」可以写三种：关卡 id（读 `src/data/levels/` 里现在的数据）、草稿 `.mjs`、`LevelDef` 的 `.json`。结果默认写在系统临时目录的 `isles-cartoon-map/<时间>/`，`--out` 改目录。

`--replay` 开启重玩的冲锋波配方、随机精英和运粮兵概率。再加 `--chapter1` 后，带冲锋波的关卡可能抽到螺栓上尉客串。事件由种子决定。

## 图怎么读

俯视图，北在上，一格 8 像素（`--cell`），两张对比图同一比例。

| 画的 | 含义 |
|---|---|
| 红色半透明 | 站在起点看得见的地面 |
| 红圈 | 站在起点看得见的敌人 |
| 蓝色虚线 | 主路线：从起点到出口的最短路，门当成开着；`--via`（或草稿里的 `via`）让它依次经过指定的格子 |
| 深黄、深绿的大块 | 垫高、主角上不去的地面（田坎、草坡），用来挡视线 |
| 棕黑 | 墙；深绿圆点是树 |
| 细线 | 相邻两格有高差：浅色是能走的台阶（0.5 米），深色是走不上去的坎 |
| 黑圆圈数字 | 草稿里 `notes` 的编号，右边一栏是说明 |

敌人、宝箱、冲锋波出生点、破坏目标等的图例在图的最下面，只列这张图里出现了的。

## 统计口径

算法在 `src/sim/level-survey.ts`（`surveyLevel`、`surveyStats`），用的是游戏自己的格子、高度和视线判定（`lineClear` 加 `blocksSight`），和敌人看主角、子弹打不打得到是同一套。

| 数字 | 怎么算 |
|---|---|
| 能走的地面 | 从起点走、跳能到的格子数（`climbableFrom`），1 格 1 平方米 |
| 站在起点看得见的地面 | 眼睛在起点、离地 1.5 米；一格地面上方 1 米或 0.2 米处有一个点看得见就算。占能走地面的比例 |
| 站在起点看得见的敌人 | 敌人的头顶下面一点或半身高处看得见就算，不管距离 |
| 沿主路同时看得见的敌人 | 主路线上每隔 2 格站一次，按上一条数，取平均和最大。敌人都按站在原位算 |
| 四周能看多远 | 同样每隔 2 格，朝 72 个方向看，到第一个顶面高过眼睛的格子为止，取平均 |
| 惊动一个最多带醒 | `wakeChain` 的最大值；埋伏的不算 |
| 关卡校验 | `validateLevel`，第一人称关卡包含开局、叫醒、隐藏区、Boss 场四条 |

这些数字只说挡没挡住，不说好不好玩。主路线是最短路，不是玩家真走的路；敌人会动，真打起来看见的比这多。

## 草稿

大改布局时，直接改 `walled(...)` 里几十行字符画很慢，高度表还要另外对齐。草稿是一个 `.mjs`，用 `scripts/map/lib/sketch.mjs` 的 `Area` 往格子上画矩形、圆和路，再导出成关卡数据：

```js
import { Area, levelOf } from '../lib/sketch.mjs'

const a = new Area(60, { name: '牧场入口', theme: 'meadow', depth: 44, base: 0, fill: '.', fillHeight: 6, walls: 'hedge' })
a.carve(9, 37, 14, 43)                                   // 挖出一块平地（高度默认是 base）
a.wall(16, 22, 58, 23)                                   // 墙
a.raise(25, 33, 30, 36, 6)                               // 只改高度，数字是高度表里的那一位，一级 0.5 米
a.road([[11.5, 44], [11.5, 34], [15, 30.5]], 4)          // 沿折线铺 4 米宽的土路；{ clear: 1.6 } 顺便把两边的树和墙清掉
a.box(29, 12, 36, 17, '"')                               // 填一种符号
a.put(35, 15, 'b')                                       // 放一个符号：敌人、宝箱、起点等
a.thinForest(1, 9)                                       // 树林只在空地和水边留 1 排树，再往里换成高度 9 的土坡
a.extra = { ambush: [[35, 15]], landmarks: [...] }       // 区域的其余字段，原样进关卡数据

export const level = levelOf({ id: '1-2', title: '1-2 牧场', /* 其余关卡字段 */ }, [a /* 从南到北 */])
export const via = [[11, 199], [20, 193]]                // 可选：主路线经过的格子，整张图的坐标
export const notes = [{ at: [12, 202.5], name: '起点', text: '……' }]   // 可选：图上的编号说明
export const names = { 牧场入口: 'ENTRANCE' }            // 可选：emit 时各区域的常量名
```

- 坐标和关卡数据一样：x 是整行里的第几列（第 0 列和最后一列是边墙），y 是区域里的第几行，0 在最北边
- 两边的边墙不用管：符号总是墙，高度跟着里面挨着的那一格
- `fill` 是区域一开始填满的东西：`'#'` 是墙，`'T'` 是树林，`'.'` 配上高一截的 `fillHeight` 就是一整块上不去的台地，再往里挖
- 垫高的地要比旁边能走的地高 3 米（6 级）以上才上不去；旁边有 1.2 米的石头时也够。台子顶离墙至少隔一格，不然能从台子跳上墙。画完看图：上得去的台地是浅色，上不去的是深色
- 树 `T` 是一棵棵模型，是最贵的东西。用树林当填充（`fill: 'T'`）时，最后调一次 `thinForest`：站在路上看，一排树已经是不透的树墙，后面的树看不见却照样要画。1-2 的磨坊照建议稿铺满是 531 棵，留一排以后 142 棵，装车场入口的三角形从 231 万降到 171 万
- 台子上的射手、口子和门洞对得太正时，隔着两个院子也看得见人。画完看统计里「沿主路同时看得见的敌人最多」在哪一步，把门洞错开
- 草稿放在 `scripts/map/sketches/`。用户定了方向、`emit` 写成关卡数据以后，以 `src/data/levels/` 为准，草稿删掉（1-2 的已经删了）

## 一关的流程

1. `pnpm map draw <关卡>` 看现在的问题，数字记进建议稿
2. 写草稿，`draw` 反复看图，直到关卡校验通过
3. `pnpm map play <草稿>` 看自动驾驶走不走得通；加点（`--points`）和技能（`--skills 槽位=技能:等级`）和这一关的校准用例一致（`calibration-<关卡>.test.ts` 里的 `createLoadout`）
4. `pnpm map compare <关卡> <草稿>` 出对比图，写建议稿（`docs/design/levels/<关卡>-layout.md`），给用户看
5. 用户定了以后 `emit` 写成关卡数据，改写死坐标的单元测试、对话触发点、截图机位（`scripts/shots/spots.json`）、e2e 的走位
6. 量性能：先 `git archive HEAD` 出一份改前的副本量基线，再量改后（`pnpm perf spots --levels <关卡>`，机位在 `scripts/perf/spots.json`）；超了预算先数树
7. 自动驾驶多跑一些种子（10 局的波动能差两三局），和改前的副本比；通关数掉了就看死在哪，回草稿改，再 `emit`

## 实现

- `scripts/map/map.mjs` 是入口。它用 Vite 的 SSR 加载在 Node 里直接跑 `src/sim` 和 `src/data` 的 TypeScript（`scripts/map/lib/load.mjs`），不起开发服务器、不开游戏页面；sim 不碰 DOM，所以能这么跑
- `lib/draw.mjs` 把测量结果画成 SVG，`lib/page.mjs` 拼成带表格和图例的页面，用本机 Chrome 无界面截成 PNG
- `lib/emit.mjs` 把关卡数据写成 `level-*.ts` 的样子：每个区域一组 `*_ROWS`、`*_HEIGHTS` 常量，整块同一高度的写成 `flatHeights`。写之前先过关卡校验，不过就不写
- `play` 用的是 `src/sim/calibration-runs.ts` 的 `play`，和校准用例同一个函数

## 还没有的

- 把草稿放进引擎里截图。1-1 那次是把新布局写进仓库外的一份副本再截的；要做进命令，得让开发版能加载一份不在关卡表里的关卡数据
- 草稿不认识剧情触发点、截图机位这些关卡数据以外的东西，落地时要手改
