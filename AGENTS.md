# 碎星群岛 · 第一人称卡通版

《碎星群岛》的第一人称版：第一人称街机射击，加美漫墨线画风。2026-11-02 起是正式开发仓库，主仓库的俯视版（本机 `../game`，GitHub `chengzuopeng/shattered-isles`）停在第 1 章，留作参考（[ADR-0005](docs/decisions/0005-full-first-person.md)）。剧情、世界和人物以主仓库为准，关卡布局、数值、操作、美术规格以这里为准。开工前先看 [docs/README.md](docs/README.md)。

## 现状

- 2026-10-31：第一关 demo 能从头打到尾。1-1 缩减版（镇口麦田 → 风车坡 → 带篝火的短路 → 收割场打铁皮稻草人），第一人称加墨线画风
- 2026-11-02：用户定了全面转第一人称，先做第 1 章 5 关。完整计划见 [路线图](docs/plan/roadmap.md)

## 命令

端口和主仓库错开，两个仓库可以同时开：

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 本地开发，http://localhost:5280（主仓库是 5180）。先进整备界面，选关出发后鼠标会被锁定，Esc 解锁并暂停 |
| `pnpm test` | Vitest 单元测试 |
| `pnpm typecheck` | 类型检查 |
| `pnpm build` | 类型检查 + 生产构建 |
| `pnpm e2e` | Playwright 冒烟测试：用本机 Chrome 无界面打开真实页面跑整备、设置改键、1-1 开枪进谷仓打 Boss 到结算、切关卸载模型，整备界面和截图基线对比（自己在 5290 端口起开发服务器） |
| `pnpm e2e:update` | 改了整备界面的样式后重新生成截图基线 |
| `pnpm perf <命令…>` | 性能测量（自己在 5291 端口起开发服务器）：`spots` 到重点位置量 draw call、三角形、帧时间，`startup` 启动到整备界面出现和 1-1 准备好的时间、启动后内存，`enter` 进关的时间和进关后第一帧，`leak` 反复进关、重开后的资源数和内存，`stutter` 自动驾驶从进关打到通关看卡顿，`all` 依次全跑；要用关卡的默认只跑 1-1。命令和选项见 `docs/tech/performance.md`「测法」 |
| `pnpm shots` | 截图巡检：到 `scripts/shots/spots.json` 里的固定机位各截一张图（自己在 5292 端口起开发服务器；截图时逻辑冻住，敌人不动），`--out` 指定目录，`--compare <上次的目录>` 算每张图和上次相比变了多少像素，`--spots` 只截一部分 |
| `./scripts/build-assets.sh` | 把 `art/` 里的原图处理成 `public/assets/` 下的运行时资源（天空无缝拼接、抠图、裁切） |

在 Claude Code 桌面版里，如果会话最早是在主仓库开的，内置浏览器的 `preview_start` 只认主仓库的 `.claude/launch.json`，起的会是主仓库的服务器。这时在后台跑 `pnpm exec vite --port 5280 --strictPort`，再用 `preview_start` 的 `url` 打开 http://localhost:5280。浏览器面板隐藏时页面不刷新，帧率和 GPU 计时都不准。

## 目录

| 路径 | 职责 |
|---|---|
| `src/main.ts` | 组装入口：开始界面、主循环、事件分发、调试接口 |
| `src/core/` | 主循环、设置、存档 |
| `src/sim/` | 纯逻辑：实体、移动、碰撞、战斗、AI、关卡，2.5D（平面坐标加高度） |
| `src/render/` | Three.js。第一人称新写的：`fps-stage.ts`（镜头、灯光、阴影）、`ink-pipeline.ts`（描边和后处理）、`toon.ts`（往材质里注入墨线着色）、`sky.ts`、`fps-level-view.ts`（带高度的地形和道具）、`viewmodel.ts`（手臂和枪）、`ring-views.ts`（冲击波环）。敌人、子弹、掉落物等沿用主仓库的模块 |
| `src/input/` | `fps-input.ts` 指针锁定和鼠标视角，`look-settings.ts` 灵敏度、视野角、眼高 |
| `src/ui/` | HUD 沿用主仓库的，第一人称另加 `fps-overlay.ts`（准星、受伤方向、生命）、`sfx-words.ts`（拟声字）、`bounty-card.ts`（悬赏令 Boss 卡），样式在 `fps.css` |
| `src/audio/` | 音效和音乐（主仓库的占位合成音） |
| `src/data/` | 数值、敌人、关卡、台词、高度表（`heights.ts`） |
| `public/assets/` | 运行时资源：模型从主仓库原样拷来（已经是 KTX2），天空、拟声字、食物图标、悬赏令头像由 `scripts/build-assets.sh` 生成 |
| `docs/` | 设计、技术、计划、决策和参考资料 |
| `art/concept/` | 新画风的目标图（Codex 生成）。画面验收以这几张为准 |
| `art/reference/` | 从主仓库拷来的设定图，出新图时用 `-i` 附上，保证造型一致。来源见 `art/README.md` |
| `art/scenes/`、`art/ui/`、`art/bosses/` | 本仓库生成的原图和提示词 |
| `scripts/codex-image.sh` | 用 Codex 出图，带重试和额度检查 |
| `.claude/skills/` | Three.js 参考 skill，用法见下文「项目内 skill」 |

## 规则

- 剧情、人物、世界观以主仓库的 `docs/design/` 为准，这里不改剧情。要改先在主仓库改
- 从主仓库拷代码或素材时，在提交说明里写上来源：主仓库的提交号；拷的是主仓库没提交的改动时，写「主仓库工作区」加日期
- 本仓库的改动不往主仓库回写，除非用户要求（比如画风定下来以后把墨线渲染搬回俯视版）
- `src/sim` 不 import three，不碰 DOM / window；render 和 ui 只读 sim 的状态；玩家操作经 input 转成指令交给 sim
- 玩法数值写在 `src/data`，不在逻辑里写死
- 逻辑改动配 Vitest 用例；画面改动起开发服务器，在浏览器里截图，并通过 `window.__game` 读状态验证；画面截图要和 `art/concept/` 的目标图并排比
- 设计、技术方案、重要决策写进 `docs/` 对应目录，改了设计要同步更新文档
- 原创：参考预告片只借这一类游戏通用的做法，不照搬它的角色、梗、卡片版式、字体和题材，清单见 [参考预告片拆解](docs/reference/trailer-notes.md)「不借什么」。参考视频和它的截图不进仓库
- 图片素材用 Codex CLI 生成，提示词带上 [画风](docs/design/art-direction.md)里的「统一风格描述」；要抠成透明底的图画在纯品红 `#FF00FF` 平涂背景上；每张生成图旁边放同名 `.prompt.txt`
- 3D 模型沿用主仓库的做法：Opus 写 Blender 脚本，模型拆成刚性零件做程序动画（主仓库 ADR-0005、`docs/tech/model-pipeline.md`）
- 新增依赖之前先问用户（Rapier、第三方后处理库、字体文件等）；第三方素材在 `art/CREDITS.md` 登记来源和许可

## 调试接口

开发环境下 `window.__game`（生产构建里没有）：

| 成员 | 作用 |
|---|---|
| `world` / `tuning` / `profile` / `debug` | 当前局面、生效的参数、存档、调试开关（`debug.invincible = true` 无敌） |
| `screen` / `level` / `paused` / `view` | 当前画面（`prep` 整备 / `play` 关卡）、当前关卡 id、是否暂停、镜头（`fps` / `top` / `free`） |
| `difficulty` / `music` / `models` | 当前难度；正在放的背景音乐；已加载的模型 id（常驻的 + 当前关 + 最多一关留着的） |
| `start()` / `restart()` | 开始一局 / 重开本关。自动化里拿不到指针锁定，照样能进关 |
| `startLevel(关卡)` / `openPrep()` | 切到某一关（`1-1`~`1-5`、`trial-systems`、`trial-harvester`）并开始；回到整备界面。`startLevel` 先回整备界面加载模型、编译着色器，返回的 Promise 在进关后完成 |
| `skipDialogue()` / `playInterlude(幕间)` | 关掉正在播的对话（关卡还在加载时调用，进关后就不播开场对话）；在整备界面播一段幕间 |
| `setDifficulty(难度)` | 切换难度（`easy` / `normal` / `hard`），下一局生效 |
| `setAutopilot(开关, 水平)` | 打开或关闭自动驾驶；水平可选 `perfect` 完美、`human` 普通玩家、`novice` 新手。开着时镜头跟着它的瞄准走，`advance()` 也用它的指令。做法见 `docs/tech/autopilot.md` |
| `teleport(区域)` / `teleportToBoss()` | 传送 |
| `advance(秒)` / `act(指令, 秒)` | 不依赖画面刷新直接推进逻辑；`act` 带着指定的指令推进，比如 `act({ fire: true, aimX, aimY, pitch }, 1)`、`act({ melee: true }, 0.05)`、`act({ jump: true }, 0.3)` |
| `freeze(开关)` | 冻住：主循环不再推进逻辑，麦秆、云、特效、手臂的动画也停住，画面照常刷新，`advance` / `act` 还能用。截图巡检靠它拍出可以对比的画面 |
| `look(偏航, 俯仰)` | 直接设视角（弧度） |
| `setView(模式)` / `freeCamera(x, y, z, 偏航, 俯仰)` | 切镜头；自由镜头放到指定位置（sim 坐标，z 是高度） |
| `setStyle({ toon, outline, halftone, bloom, grade })` / `styleInfo()` | 单独开关渲染管线的每一步；每一步的 GPU 耗时（浏览器支持计时查询时） |
| `renderInfo()` | 上一帧所有遍合计的 draw call、三角形数、显存里的资源数 |
| `scene` / `camera` | three 的场景和镜头，查问题用 |
| `giveWeapon()` / `giveBuff()` / `drop()` / `chargeUltimate()` | 给武器、增益、掉落、充满大招 |
| `addXp()` / `allocate()` / `learnSkill()` / `equipSkill()` / `unlockSlotE()` / `resetSave()` | 加经验、加点、学技能、装备技能、解锁 E 槽、清空存档 |
| `breakTargets(区域)` / `openPens(区域)` / `raiseAlarms()` / `lightLamps(区域)` | 打爆破坏目标、打开羊圈、敲响警报、点亮驱雾灯，返回处理了几个（1-2~1-4 的机制） |
| `toScreen(x, y)` / `runLog()` | sim 坐标换算成页面坐标；最近的战斗记录 |

开发环境按 V 在第一人称、俯视、自由镜头之间切；`` ` `` 打开调参面板，里面有「第一人称」和「墨线画风」两组参数。

## 调用 Codex CLI

和主仓库一样，直接用登录的 ChatGPT 账号，模型和推理强度显式写上，出图不开 fast：

```bash
codex exec -m gpt-6.1-sol -c model_reasoning_effort='"xhigh"' -c service_tier='"default"' -C . -s workspace-write "<任务>"
```

批量出图用 `scripts/codex-image.sh <任务文件> <日志> [参考图...]`，它已经带上这几项，换模型用环境变量 `CODEX_MODELS`。账号额度用尽时脚本以 3 退出，这时停下来问用户。

## 项目内 skill

`.claude/skills/` 下有 4 个 Three.js skill，来自 [threejs-game-skills](https://github.com/majidmanzarpour/threejs-game-skills)（MIT 许可，commit 8286774，许可证见 `.claude/skills/THREEJS-GAME-SKILLS-LICENSE`）：`threejs-gameplay-systems`、`threejs-aaa-graphics-builder`、`threejs-debug-profiler`、`threejs-qa-release`。只作参考资料：

- 架构以本文件和 `docs/tech/architecture.md` 为准，skill 里的脚手架、目录结构、包揽一切的 `Game` 大类、可变步长循环都不照搬
- 不运行 `create_threejs_game.py`，不运行凭据探测脚本，不接入 Gemini、Tripo、ElevenLabs；图片走 Codex
- 画布检查脚本的输出路径保持在项目目录内
