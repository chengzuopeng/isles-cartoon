---
name: isles-cartoon-visual-qa
description: 验收《碎星群岛》第一人称版的画面改动。用户要求检查渲染、关卡画面、UI、动画或新美术素材的实机效果时使用。
---

# 碎星群岛画面验收

1. 从仓库根目录选择受影响的关卡、机位和游戏状态。参考 [画风](../../../docs/design/art-direction.md) 和 [概念图](../../../art/concept/)，确定本次要核对的画面细节。
2. 需要交互或检查 HUD 时，运行 `pnpm dev` 并打开 `http://localhost:5280`。用 `window.__game` 确认关卡、镜头和状态，例如等待 `startLevel(id)` 完成，再用 `look`、`teleport` 或 `act` 到达目标状态。接口见 [本地开发与验证](../../../docs/tech/local-development.md)。
3. 固定机位用 `pnpm shots`。从 [机位表](../../../scripts/shots/spots.json) 选择覆盖改动的机位，例如 `pnpm shots --spots 1-1-gate`。已有同机位基线时加 `--compare <旧截图目录>`。脚本会冻结场景并隐藏横幅、台词和调参面板，检查这些 UI 或动画时用实时浏览器另验。
4. 并排检查实机截图和目标图，聚焦改动范围。新素材在游戏实际尺寸下检查透明边缘、锚点和遮挡。渲染开销可能变化时，用 `pnpm perf spots --levels <关卡>` 在相同机位记录绘制调用、三角形和帧时间。
5. 汇报关卡、机位或状态、截图路径和实测结果。涉及整备界面、改键、关卡流程或模型卸载时，用 `pnpm e2e` 核对相应回归。
