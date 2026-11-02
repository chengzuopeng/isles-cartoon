# 文档

| 目录 | 内容 |
|---|---|
| [design/](design/) | 策划：愿景、玩法、画风、样机关卡、设定摘要 |
| [tech/](tech/) | 技术：架构、墨线渲染管线 |
| [plan/](plan/) | 计划：路线图 |
| [decisions/](decisions/) | 决策记录（ADR）：一个决策一个文件，编号递增；已采纳的不改，推翻时新开一篇并注明替代了哪篇 |
| [reference/](reference/) | 参考资料 |

## 先看哪些

1. [路线图](plan/roadmap.md)：完整的开发计划，现在做到哪
2. [愿景](design/vision.md)：设计支柱，和俯视版有什么不同
3. [第一人称玩法](design/gameplay.md)
4. [画风：会动的漫画](design/art-direction.md)，配合 `art/concept/` 里的目标图看
5. [样机关卡：1-1 出发](design/prototype-1-1.md)
6. [技术架构](tech/architecture.md)、[墨线渲染管线](tech/rendering.md)

## 全部文档

- 设计
  - [愿景](design/vision.md)
  - [第一人称玩法](design/gameplay.md)
  - [画风：会动的漫画](design/art-direction.md)
  - [样机关卡：1-1 出发](design/prototype-1-1.md)
  - [设定摘要](design/setting.md)
- 技术
  - [技术架构](tech/architecture.md)
  - [墨线渲染管线](tech/rendering.md)
  - [自动驾驶和机器人测试](tech/autopilot.md)
- [路线图](plan/roadmap.md)
- 决策
  - [ADR-0001 独立仓库做第一人称卡通版试验](decisions/0001-separate-repo.md)（部分被 ADR-0005 替代）
  - [ADR-0002 逻辑用 2.5D：格子加高度](decisions/0002-2.5d-sim.md)
  - [ADR-0003 墨线渲染：WebGL 加自己写的屏幕空间描边](decisions/0003-comic-ink-rendering.md)
  - [ADR-0004 美术素材沿用主仓库的做法](decisions/0004-art-pipeline.md)
  - [ADR-0005 全面转第一人称，这个仓库转为正式开发仓库](decisions/0005-full-first-person.md)
- 参考
  - [参考预告片拆解](reference/trailer-notes.md)

## 和主仓库文档的关系

剧情、角色、关卡原设计、数值都在主仓库的 `docs/`（本机 `../game/docs/`）。这里只写第一人称和新画风带来的改动，没写到的规则按主仓库来。主仓库改了剧情或数值，这边不用跟着改文档，用到时去主仓库看最新的。
