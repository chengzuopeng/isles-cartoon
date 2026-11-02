# 技术架构

- 状态：草案，M0 / M1 照这份搭
- 更新：2026-10-31
- 相关决策：[ADR-0001 独立仓库](../decisions/0001-separate-repo.md)、[ADR-0002 逻辑用 2.5D](../decisions/0002-2.5d-sim.md)、[ADR-0003 墨线渲染](../decisions/0003-comic-ink-rendering.md)；主仓库 `docs/tech/architecture.md`

## 技术栈

和主仓库相同，版本也先对齐，方便拷代码：

| 用途 | 选型 |
|---|---|
| 语言 / 构建 | TypeScript 7 + Vite 8，包管理用 pnpm |
| 渲染 | Three.js 0.186（WebGLRenderer）。后处理用 three 自带的 `three/addons/postprocessing`，不加新依赖。管线见[墨线渲染管线](rendering.md) |
| 模型 | GLB，贴图 KTX2（UASTC），沿用主仓库的 `pack-glb.mjs` 和 Basis 转码器 |
| 单元测试 | Vitest 5 |
| 端到端测试 | Playwright，用本机 Chrome，不下载浏览器 |
| 调参面板 | Tweakpane，只在开发环境加载 |
| 碰撞、视线、弹道 | 自己写，2.5D（见下文） |
| 音频 | Web Audio；敌人的声音用 PannerNode 带方位 |
| 桌面打包 | Electron（以后） |

端口：开发 5280，e2e 5290，性能测量 5291，截图巡检 5292，和主仓库（5180 / 5190 / 5191）错开，两个仓库能同时开。

## 分层

```
src/
  main.ts   组装入口
  core/     主循环、设置、存档
  sim/      纯逻辑：实体、移动、碰撞、战斗、技能、AI、关卡目标（2.5D）
  render/   Three.js：镜头、第一人称手臂、模型、墨线渲染管线、特效
  input/    键鼠 → 统一指令（move / look / fire / melee / dash / jump / super / skill）
  ui/       HUD、字幕、对白泡、卡片、菜单
  audio/    音效、音乐、方位
  data/     武器、敌人、Boss、关卡、台词、高度表
```

依赖方向和主仓库一样：

- sim 只依赖 core 里的纯工具和 data，不 import three，不碰 DOM / window
- render 和 ui 只读 sim 的状态，不改
- input 把设备输入转成指令，sim 在下一个逻辑步里消费
- sim 用事件（命中、暴击、近战、死亡、拾取等）通知 render、ui、音频做表现
- data 只放数据

第一人称多出来的一条：**视角不等逻辑步**。鼠标转视角要每帧跟手，高刷新率屏幕上不能有 60 Hz 的顿挫。所以 input 每帧累积鼠标位移，render 直接用最新的偏航和俯仰摆镜头；同一组角度作为指令交给 sim，开火时 sim 用它算弹道。镜头的位置照旧取 sim 状态的插值。

## 主循环

同主仓库：逻辑固定每秒 60 步（`core/fixed-step.ts`），一帧最多补 5 步；渲染每帧一次，用 alpha 在上一步和当前步之间插值。

## 坐标

- sim 用平面坐标 (x, y)，1 格 = 1 米，地图左上角是 (0, 0)，第 c 列第 r 行格子的中心是 (c + 0.5, r + 0.5)。新增高度 z，向上为正，单位米
- render 把 sim 的 (x, y, z) 映射成 three 的 (x, z, y)，three 的 y 轴朝上
- 朝向用偏航 yaw（平面上的角度，约定和主仓库的瞄准方向一致）加俯仰 pitch（抬头为正，限制在 ±85°）

## 2.5D 世界模型

关卡还是字符画格子，每格多记两个高度：

| 字段 | 含义 |
|---|---|
| `floor` | 地面高度（米） |
| `top` | 这一格上挡东西的顶面：空地等于 `floor`，墙是 `floor + 3`，石头和草垛 `floor + 1.2`，栅栏 `floor + 0.9` |

障碍的高度按字符类型查表，写在 `src/data/heights.ts`；地标可以在自己的配置里写高度。

| 东西 | 怎么算 |
|---|---|
| 角色 | 竖直圆柱：半径沿用主仓库，高度按类型（主角 1.6 米、冲锋兵 1.1 米、射手 1.8 米……）；脚底 z = 所在格的 `floor` 加上跳起的高度 |
| 走动 | 圆和格子的碰撞照旧；相邻两格 `floor` 差不超过 0.5 米能直接走过去，再高要跳（主角）或者绕路（敌人） |
| 跳和重力 | 只有主角会跳；重力按固定步长积分，落地时 z 贴回 `floor` |
| 子弹 | 位置 (x, y, z)、带俯仰的单位方向、速度。每一步扫过一段线段：穿过的每一格里，线段的高度低于 `top` 就撞墙，低于 `floor` 就落地（榴弹、投掷物在这里爆）；和角色的圆柱求交，先判眼灯、弱点这类小球，打中算暴击 |
| 视线 | 从眼睛到目标胸口连一条线段，按格子走一遍，哪一格的 `top` 高过线段在那里的高度就算挡住。敌人发现玩家、射手瞄准都用它 |
| 寻路 | 流场 BFS 照旧，相邻格能不能走多一个条件：高度差不超过 0.5 米 |
| 近战 | 主角朝向左右各 40°、2 米以内的角色，不看高度 |
| 预警 | 数据还是地上的图形（长条、圆、扇形），加一种贴地扩散的冲击波环，带高度 |

做不到的：楼上楼下叠在一起的地方（桥底下走人、两层的房子），见 [ADR-0002](../decisions/0002-2.5d-sim.md)。桥只修在不能走的格子（河、悬崖）上面。

代码位置（2026-10-31）：

- 高度表 `src/data/heights.ts`：格子高度 `TILE_HEIGHTS`（键是格子名）、身高 `BODY_HEIGHTS`、眼灯高 `EYE_HEIGHTS`、枪口高 `MUZZLE_HEIGHTS`、胸口高 `CHEST_HEIGHT`、弱点 `WEAK_POINTS`
- 格子 `src/sim/grid.ts`：`Grid.floor` / `Grid.top`；取值用 `cellFloor`、`cellTop`、`floorAt`、`topAt`、`standHeight`；改格子统一走 `setTile`（关门、打碎木箱、地标被打坏时 `top` 跟着变）。新增格子「O」大草垛 / 大石头，2.5 米
- 身体高度和落地 `src/sim/terrain.ts`，近战和「快散架」`src/sim/melee.ts`，冲击波环 `src/sim/rings.ts`，弱点 `bossExposed`（`src/sim/boss.ts`）
- 子弹 `Bullet` 多了 `z`、`prevZ`、`vz` 和开火位置 `origin`，`speed` 是水平速度；投掷物 `Lob` 多了 `fromZ`、`toZ`、`z`、`prevZ`
- 能站上去的：石头、木箱、板车、栅栏、大草垛（站在顶面）。墙、树、关着的门、水、地标永远进不去

### 关卡格式

在主仓库的关卡格式（`LevelDef`，每个区域一段字符画加区域配置）上加一项：每个区域可以写一张和字符画同样大小的高度图 `heights`，字符 `0`~`9` 表示地面高 0~4.5 米（每档 0.5 米），不写就整个区域都是 0。

`validateLevel` 加上高度检查：出口和每个敌人在高度限制下仍然走得到；跳上去才能到的地方要标出来（隐藏区可以要求跳）。

关卡写了 `firstPerson: true` 以后，`validateLevel` 还会按第一人称的规则查开局、叫醒、隐藏区和 Boss 场大小（`src/sim/level-rules.ts`，规则见[关卡 1-1](../design/levels/1-1.md)「第一人称的关卡规则」）。还没重做的关卡写 `wip`（整备界面的任务卡片上显示）。

地标写了 `building`（现在只有谷仓）就不加载模型，由 `src/render/buildings.ts` 按占地生成墙、门洞、人字顶、房梁和室内陈设，能走进去；墙外面和里面分两种材质。

## 从主仓库拿什么

2026-10-31 的实际做法：`src/` 整个从主仓库工作区拷来（当时主仓库提交 `e38713d` 加未提交的 1-5 和第 1 章收尾），基线 1313 个测试全过；再删掉自动驾驶、平衡、校准和只靠它们跑的测试，把 sim 改成 2.5D，渲染和入口按第一人称重写。敌人、子弹、掉落物、特效、HUD、对话、结算、音效这些模块拿来就能用，只补了高度。俯视版专用的场景模块里，`level-view.ts`、`terrain.ts`、`row-cull.ts` 在 2026-11-02 平滑地形接上后删了；`landmark-views.ts`、`landmark-fade.ts` 还被刀片、传送带的俯视画面引用，等 1-5 做第一人称版时一起清理。

下面是建仓时的计划，行数是 2026-10-31 主仓库工作区的：

| 模块 | 主仓库 | 处理 |
|---|---|---|
| `core/` | 202 行 | 原样拷 |
| `sim/` 的逻辑（战斗、敌人、Boss、掉落、增益、技能、关卡构建、警觉、小队配合） | 约 7800 行，另有测试约 7400 行 | 先原样拷，让测试在平面下全部通过；再按上面的规则加高度，测试跟着改 |
| `sim/` 的自动驾驶、平衡和校准 | 约 2400 行 | 先不拷。第一人称的难度主要看玩家的枪法，先靠真人试玩；以后要做机器人测试再拷 |
| `data/` | 约 4700 行 | 拷第 1 章用到的：武器、敌人、Boss、掉落、增益、技能、台词、提示、1-1；距离类数值按新尺度调 |
| `render/` | 约 3.1 万行 | 大部分重写。能借的：GLB 和 KTX2 加载（`gltf-source.ts`、`model-library.ts`），刚性零件动画（`rigid-parts.ts`、`node-parts.ts`、`enemy-rigs.ts`、`enemy-poses.ts`），着色器预热和贴图上传节流（`shader-warmup.ts`、`upload-pacing.ts`、`slices.ts`），画质档（`quality.ts`） |
| `ui/` | 约 3900 行 | 对话、台词条、设置面板、阵亡报告、结算、新手提示能借；HUD 重做；屏幕外威胁提示（`threat-indicators.ts`）的逻辑借来改成围着准星的弧线 |
| `input/` | 115 行 | 重写：指针锁定、鼠标视角、改键 |
| `audio/` | 834 行 | 拷占位音效和音乐，加方位 |
| `scripts/` | | 拷 `build-assets.sh`、`pack-glb.mjs`、`art-tool.swift`；性能测量脚本 M1 以后再拷 |
| `public/assets/` | 93 MB | 只拷 1-1 用到的模型、立绘和 Basis 转码器 |

拷的时候在提交说明里记下来源（见 AGENTS.md「规则」）。

## 调试接口

开发环境下 `window.__game`。先沿用主仓库的成员（`world`、`tuning`、`start()`、`startLevel()`、`restart()`、`teleport()`、`advance()`、`giveWeapon()`、`drop()`、`chargeUltimate()`、`skipDialogue()`、`renderInfo()`、`toScreen()`、`runLog()` 等），再加：

| 成员 | 作用 |
|---|---|
| `setView('fps' \| 'top' \| 'free')` | 第一人称 / 俯视 / 自由飞行镜头。M0 比画风、查关卡用 |
| `look(yaw, pitch)` | 直接设视角。指针锁定要用户手势，自动化测试里拿不到，靠它转视角 |
| `setStyle({ toon, outline, halftone, bloom, grade })` | 单独开关渲染管线的每一步，方便前后对比截图 |
| `styleInfo()` | 渲染管线每一步的耗时（GPU 计时查询，浏览器不支持时返回 null） |

## 测试

- sim：碰撞、跳跃、2.5D 弹道（俯仰、撞墙、落地、暴击）、视线（高低差挡不挡）、近战、寻路的高度限制，都配 Vitest
- 关卡：`validateLevel` 带着高度对所有关卡跑一遍
- 画面：开发服务器加截图，和 `art/concept/` 的目标图并排比。`pnpm shots` 到固定机位截图（机位在 `scripts/shots/spots.json`，截图时藏起区域横幅、无线电、对话框和调参面板），改画面前后各截一次，`--compare` 给出每个机位变了多少像素；整备界面和设置面板的截图基线在 `pnpm e2e` 里
- 性能：M0 起记录渲染管线每一步的耗时，预算见[墨线渲染管线](rendering.md)「预算」
