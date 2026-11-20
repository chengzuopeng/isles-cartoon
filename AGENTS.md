# 碎星群岛 · 第一人称卡通版

本仓库是《碎星群岛》的正式开发仓库。开工前从 [文档索引](docs/README.md) 找相关设计、技术说明和[路线图](docs/plan/roadmap.md)。俯视版主仓库 `chengzuopeng/shattered-isles`（本机 `../game`）是剧情、人物和世界观的来源。第一人称版的关卡布局、数值、操作和美术规格在这里维护。见 [ADR-0005](docs/decisions/0005-full-first-person.md)。

## 工程规则

- `src/main.ts` 组装游戏。输入层把操作转成命令，`src/sim/` 按固定步长推进 2.5D 逻辑。sim 保持纯逻辑，依赖限于纯工具和数据，避免引入 Three.js、DOM 或 `window`。渲染和 UI 读取状态、消费事件，状态更新由 sim 执行。玩法数值维护在 `src/data/`。
- 逻辑改动配 Vitest 用例。画面改动需要在开发环境截图，通过 `window.__game` 确认状态，并与 `art/concept/` 的目标图并排检查。见[画面验收](.agents/skills/isles-cartoon-visual-qa/SKILL.md)。
- 新增依赖（包括字体和第三方物理、渲染库）前先问用户。第三方素材的来源和许可登记在 [art/CREDITS.md](art/CREDITS.md)。
- 剧情、人物和世界观的变更先在俯视版主仓库维护。从主仓库拷代码或素材时，在提交说明里记录来源提交号。来源是未提交改动时，写「主仓库工作区」及日期。向主仓库回写需用户授权。
- 设计、技术方案和重要决策记录在 `docs/`，设计发生变化时同步更新文档。
- 参考预告片用于研究同类游戏的通用做法。角色、梗、版式、字体和题材按原创方案设计，参考视频和截图留在仓库之外。见[预告片拆解](docs/reference/trailer-notes.md)。

## 本地开发

在当前仓库运行 `pnpm dev`，在 Codex 浏览器打开 <http://localhost:5280>。常用检查为 `pnpm typecheck`、`pnpm test`、`pnpm build` 和 `pnpm e2e`。关卡布局用 `pnpm map`，画面回归用 `pnpm shots`，性能用 `pnpm perf`。完整命令、环境要求和 `window.__game` 接口见[本地开发与验证](docs/tech/local-development.md)。

## 美术素材

- 图片在当前 Codex 会话内用内置 `image_gen` 生成。提示词带上[统一风格描述](docs/design/art-direction.md#统一风格描述)，按需引用 `art/reference/` 的已有设定图。原图留在 `$CODEX_HOME/generated_images/`，把选中的版本复制到 `art/`，旁边保存完整的同名 `.prompt.txt`。
- 独立透明素材使用工具输出的 alpha。既有抠图和分格流程继续按纯品红 `#FF00FF` 平涂背景处理。运行时资产生成方式见[美术素材说明](art/README.md)。
- 3D 模型沿用 Blender 装配和刚性零件动画流程。Codex 维护建模脚本，保留挂点和模型合约。混元 3D 的现有用法及工作树路径参数见[美术素材说明](art/README.md#3d-模型流程)。

## Three.js 参考资料

[上游参考资料](docs/reference/threejs/README.md)可按需查阅。工程架构和验收以本仓库为准，现有脚手架和外部服务探测脚本仅供参考。2D 出图使用内置 ImageGen，画面验证使用本仓库的脚本。
