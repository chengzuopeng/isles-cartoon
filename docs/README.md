# 文档

| 目录 | 内容 |
|---|---|
| [design/](design/) | 策划：愿景、玩法、画风、样机关卡、设定摘要 |
| [tech/](tech/) | 技术：架构、墨线渲染管线、性能、自动驾驶、地图工具 |
| [plan/](plan/) | 计划：路线图 |
| [decisions/](decisions/) | 决策记录（ADR）：一个决策一个文件，编号递增；已采纳的不改，推翻时新开一篇并注明替代了哪篇 |
| [reference/](reference/) | 参考资料 |

## 先看哪些

1. [路线图](plan/roadmap.md)：完整的开发计划，现在做到哪
2. [愿景](design/vision.md)：设计支柱，和俯视版有什么不同
3. [第一人称玩法](design/gameplay.md)
4. [画风：会动的漫画](design/art-direction.md)，配合 `art/concept/` 里的目标图看
5. [关卡 1-1 出发（第一人称完整版）](design/levels/1-1.md)，M1 的缩减版见[样机关卡](design/prototype-1-1.md)
6. [技术架构](tech/architecture.md)、[墨线渲染管线](tech/rendering.md)

## 全部文档

- 设计
  - [愿景](design/vision.md)
  - [第一人称玩法](design/gameplay.md)
  - [战斗节奏：为什么显得呆，怎么改](design/combat-pacing.md)（第一轮：前四条和第 8 条已做，其余并进第二轮）
  - [可玩性第二轮：手里的东西、规则连锁、每局不一样](design/playability.md)（用户定了全部要做，分三个批次，还没开始）
  - [成长体系：专精、技能分支、徽章](design/progression.md)（2026-11-11 用户定了，排在可玩性第二轮的批次 2，还没开始）
  - [画风：会动的漫画](design/art-direction.md)
  - [画面复盘：为什么还不够好看，怎么改](design/visual-review.md)（12 项已落地，其余 9 项待做）
  - [样机关卡：1-1 出发](design/prototype-1-1.md)（M1 缩减版）
  - [关卡 1-1 出发（第一人称完整版）](design/levels/1-1.md)
  - [1-1 地图重做：为什么一览无余，改成了什么样](design/levels/1-1-layout.md)（2026-11-11 落地）
  - [关卡 1-2 牧场（第一人称版）](design/levels/1-2.md)（灰盒、新机制、Boss 做完，地图已换成新布局；场景和剧情还没做）
  - [1-2 地图重做：为什么改，改成了什么样](design/levels/1-2-layout.md)（2026-11-11 落地）
  - [设定摘要](design/setting.md)
- 技术
  - [技术架构](tech/architecture.md)
  - [墨线渲染管线](tech/rendering.md)
  - [性能](tech/performance.md)
  - [自动驾驶和机器人测试](tech/autopilot.md)
  - [地图工具：`pnpm map`](tech/map-tools.md)
- [路线图](plan/roadmap.md)
  - [检查点 A：试玩 1-1](plan/checkpoint-a.md)
- 决策
  - [ADR-0001 独立仓库做第一人称卡通版试验](decisions/0001-separate-repo.md)（部分被 ADR-0005 替代）
  - [ADR-0002 逻辑用 2.5D：格子加高度](decisions/0002-2.5d-sim.md)
  - [ADR-0003 墨线渲染：WebGL 加自己写的屏幕空间描边](decisions/0003-comic-ink-rendering.md)
  - [ADR-0004 美术素材沿用主仓库的做法](decisions/0004-art-pipeline.md)
  - [ADR-0005 全面转第一人称，这个仓库转为正式开发仓库](decisions/0005-full-first-person.md)
- 参考
  - [参考预告片拆解](reference/trailer-notes.md)

## 和主仓库文档的关系

剧情、角色、关卡原设计、数值都在主仓库的 `docs/`（本机 `../game/docs/`）。这里只写第一人称和新画风带来的改动，没写到的规则按主仓库来。成长（加点、技能、徽章）和特殊武器怎么带，从 2026-11-11 起以这里的[成长体系](design/progression.md)和[可玩性第二轮](design/playability.md)为准，做完以前游戏里还是主仓库的规则。主仓库改了剧情或数值，这边不用跟着改文档，用到时去主仓库看最新的。
