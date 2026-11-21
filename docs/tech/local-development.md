# 本地开发与验证

在仓库根目录运行命令。常用环境是 Node.js 22.12+ 和 pnpm。浏览器回归、固定机位截图、地图 PNG 和性能测量使用本机 Chrome。美术资源重打包使用 macOS 的 Swift 和 `sips`，Blender 用于装配源 GLB。

新检出先运行 `pnpm install --frozen-lockfile`，再运行 `pnpm dev`。在 Codex 浏览器打开 <http://localhost:5280>。Codex 桌面端的本地环境可以在新工作树安装锁定的依赖，并通过 **Run** 运行同一条启动命令。两份游戏工作树同时运行时，可给第二份加 `--port 5281`。

## 命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 5280 端口。进整备界面，选关后点击画面锁定鼠标，Esc 解锁并暂停。俯视版主仓库使用 5180 |
| `pnpm typecheck`、`pnpm test`、`pnpm build` | 类型检查、Vitest、类型检查加生产构建 |
| `pnpm e2e` | 5290 端口。Playwright 使用无界面 Chrome 检查整备、改键、1-1 战斗、1-2 剧情、1-3 的警报和探索、首通奖励存档、结算进入 1-4，以及切关时的模型卸载。预期中的整备界面变化用 `pnpm e2e:update` 更新截图基线 |
| `pnpm perf <命令>` | 5291 端口。测固定机位、启动、进关、重复加载和游玩卡顿，见[性能测法](performance.md#测法) |
| `pnpm shots` | 5292 端口。按 [spots.json](../../scripts/shots/spots.json) 冻结并截图。用 `--spots` 选机位，`--out` 写检查产物，`--compare` 与前一组截图比较 |
| `pnpm map <命令> <关卡>` | 校验、画图和用自动驾驶测关卡。它在 Node 中加载关卡数据，`draw` 和 `compare` 另用无界面 Chrome 出 PNG。见[地图工具](map-tools.md) |
| `./scripts/build-assets.sh` | 用 `art/` 的源文件更新 `public/assets/`，见[美术素材说明](../../art/README.md) |

## 调试接口

开发服务器会暴露 `window.__game`。按 V 在第一人称、俯视和自由镜头间切换，按反引号打开调参面板。自动化可直接进关并用命令推进逻辑。

| 接口 | 用法 |
|---|---|
| `world`、`tuning`、`profile`、`debug` | 读取局面、参数和进度。调试时可设 `debug.invincible = true` |
| `screen`、`level`、`paused`、`view`、`difficulty`、`music`、`models` | 检查画面、关卡、暂停、镜头、难度、配乐和加载的模型 |
| `start()`、`restart()`、`openPrep()` | 开始、重开、回整备 |
| `startLevel(id)`、`skipDialogue()`、`playInterlude(id)` | 切关并等待模型和着色器准备好，可在等待期间调用 `skipDialogue()` 跳过开场。本机可切 `1-1` 到 `1-5` 及两个试炼 |
| `setDifficulty(id)`、`setAutopilot(on, skill)` | 难度设为 `easy`、`normal` 或 `hard`，下一局生效。自动驾驶档位为 `perfect`、`human`、`novice`。见[自动驾驶](autopilot.md) |
| `teleport(area)`、`teleportToBoss()`、`look(yaw, pitch)` | 设置位置和视角，角度用弧度 |
| `setView(mode)`、`freeCamera(x, y, z, yaw, pitch)` | 镜头可选 `fps`、`top`、`free`。自由镜头使用 sim 坐标，z 为高度 |
| `advance(seconds)`、`act(command, seconds)`、`freeze(on)` | 推进逻辑或按指定指令模拟，例如 `act({ jump: true }, 0.3)`。冻结时渲染继续，`advance` 和 `act` 仍可推进逻辑 |
| `setStyle(options)`、`styleInfo()`、`renderInfo()` | 开关 `toon`、`outline`、`halftone`、`bloom`、`grade`。读取可用的 GPU 计时、上一帧的绘制调用和三角形数 |
| `scene`、`camera`、`toScreen(x, y)`、`runLog()` | 检查 Three.js 场景、世界坐标投影和最近的战斗记录 |
| `giveWeapon()`、`giveBuff()`、`drop()`、`chargeUltimate()` | 添加武器、增益、掉落物或大招能量 |
| `addXp()`、`allocate()`、`learnSkill()`、`equipSkill()`、`unlockSlotE()`、`resetSave()` | 调试进度和整备。使用隔离浏览器上下文来验证会修改存档的流程 |
| `breakTargets(area)`、`openPens(area)`、`raiseAlarms()`、`lightLamps(area)` | 触发 1-2 至 1-4 的关卡机制，返回处理数量 |
| `spawnCourier(area?)`、`callBoltCameo()` | 本局各触发一次运粮兵和空降，用于复查演出。返回是否找到出生点或落点 |

完整类型和实现见 [main.ts](../../src/main.ts)。验证画面变更时，用[画面验收 skill](../../.agents/skills/isles-cartoon-visual-qa/SKILL.md)选择机位和状态。
