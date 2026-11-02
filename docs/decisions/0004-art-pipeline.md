# ADR-0004 美术素材沿用主仓库的做法

- 状态：已采纳
- 日期：2026-10-31

## 背景

这个仓库没有美工，和主仓库一样。主仓库已经跑通了两条线：图片用 Codex 生成（主仓库 ADR-0002），3D 模型由 Opus 写 Blender 脚本（主仓库 ADR-0005）。新画风和第一人称带来了新的素材：目标图、天空、线稿贴图、第一人称手臂和枪、平视的敌人。

## 决策

- 图片（目标图、立绘、天空、卡片、图标、拟声字、线稿贴图）用 Codex CLI 的 `image_gen` 生成，命令见 AGENTS.md。每次带上[画风](../design/art-direction.md)的「统一风格描述」，同名 `.prompt.txt` 放在图旁边
- 3D 模型由 Opus 写 Blender 脚本生成，拆成刚性零件，动画用程序做。流程照主仓库 `docs/tech/model-pipeline.md`：参考图 → 三视图 → 建模脚本 → 剪影对比 → 烘焙贴图 → 在 three.js 里检查
- 线主要靠渲染（描边），模型不烘焙轮廓线；表面的手绘线（木纹、石缝、铆钉边）烘焙进贴图
- 主仓库已有的设定图（`art/reference/`）是造型的依据。出新图时用 `-i` 附上，造型和配色不变，只换画风
- 画面验收以 `art/concept/` 的目标图为准；目标图和设定冲突时以设定为准

## 新增的约定

- 第一人称手臂和枪是精度最高的模型，面数和贴图分辨率给到其他模型的两倍左右
- 敌人要按平视检查正面（主仓库的模型是先按斜上方 55° 检查轮廓的）
- 字体这类第三方素材，用之前先问用户，登记进 `art/CREDITS.md`

## 2026-11-02 更新：3D 模型可以用混元 3D

用户定了：建模可以用腾讯混元 3D 的网页版 3D Studio（用户的 Chrome 里已经登录，在那里操作），做法见主仓库的 skill `hunyuan-3d-web`。第一个用它做的是第一人称手臂：

1. Codex 画多视图设定图：手握一根素灰色的棒子（`art/models/fp-arm-right/`、`fp-arm-left/` 的 `model-sheet.png`）。棒子是为了让手摆出握枪、托枪的姿势，游戏里它藏在枪身里面
2. 混元：多视图生成几何（50 万面）→ 重拓扑（High、三角面）→ 展 UV → 多视图贴图，下载带贴图的 GLB
3. `art/models/fp-arms/assemble.py`（Blender 后台脚本）按贴图颜色找到灰棒子，把右手对到能量枪的握把上、左手对到枪管下面；只留颜色贴图（缩到 2048），材质改成不带金属感的哑光，右手棒子的范围存进节点 extras，导出 `fp-arms.glb`。重跑：`blender --background --factory-startup --python art/models/fp-arms/assemble.py -- --right <混元右臂.glb> --left <混元左臂.glb>`，预览图写到系统临时目录的 `fp-arms-preview/`
4. `scripts/build-assets.sh` 打包成运行时资源（贴图 1024，KTX2）

混元的模型是一整块网格，没有关节和零件。混元下载的原始 GLB（每个 25 MB 左右，大头是 4K 贴图）不进仓库，`assemble.py` 的输出才是源文件。

能量枪的第一人称版（`fp-blaster`）也用混元做了，同一天：

1. 输入：主仓库能量枪三视图切成正面、右侧、俯视三张，右侧左右翻一下当左侧，走「道具」流程（`studio/creation/prop/`）
2. 部件拆分（Component Splitting）试过：先自动预分成 28 块，再生成 28 个独立的零件网格（合计约 88 万面，每块都重新生成了一遍）。线圈的环大多单独成块，但有两三个环粘在一起；枪口护套被拆成前后几片，不是绕枪管一圈的瓣片，没法直接当张开的瓣片用。拆出来的是白模；这次没在拆分结果上接着重拓扑和贴图（没试过混元会不会保留零件），改用没拆分的几何走完流程，零件在下一步自己拆
3. 实际用的：没拆分的几何 → 重拓扑 High（8,501 面）→ 展 UV → 多视图贴图
4. `art/models/fp-blaster/assemble.py` 自己拆零件：按贴图颜色找出青色的线圈，沿枪管方向按间隙分成 6 圈（`coil_1`~`coil_6`，从后往前）；枪口八角护套沿角度切成 8 片（`petal_1`~`petal_8`），大招时张开；其余是 `body`。再按旧枪的握把位置和长度（0.42 米）对齐，加上 `socket_muzzle`，导出 `fp-blaster.glb`。重跑：`blender --background --factory-startup --python art/models/fp-blaster/assemble.py -- --source <混元的枪.glb>`

第三人称（俯视、自由镜头）还用旧的 `blaster`。
