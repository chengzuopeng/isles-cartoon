# 美术素材

## 二维素材流程

从[统一风格描述](../docs/design/art-direction.md#统一风格描述)和现有设定图起草提示词，在当前 Codex 会话用内置 `image_gen` 生成。源输出保留在 `$CODEX_HOME/generated_images/`。把选中的图复制到 `art/` 的对应目录，并保存同名 `.prompt.txt`，记录完整提示词及用到的参考图。

独立透明素材直接使用生成图的 alpha。需要沿用现有抠图或者分格流程时，按原图的布局出纯品红 `#FF00FF` 背景。运行时素材按需裁切、缩放和打包到 `public/assets/`。现有转换参数和输出路径在 [build-assets.sh](../scripts/build-assets.sh)，其中 Swift 工具的 `trim` 可按已有 alpha 裁切。

接入后检查游戏里的实际尺寸、透明边缘和锚点，并在实际显示场景截图。出图流程的决策记录见 [ADR-0006](../docs/decisions/0006-codex-art-workflow.md)。

## concept/：画风目标图

新画风的目标，画面验收以这几张为准（[画风](../docs/design/art-direction.md)「目标图」）。2026-10-31 用 Codex（`gpt-6.1-sol`，xhigh）生成，完整提示词在同名 `.prompt.txt`。

| 图 | 内容 | 附的参考图 | 和设定不一致的地方 |
|---|---|---|---|
| `style-frame-1-1.png` | 第一人称看 1-1 镇口麦田：扛着麦袋的冲锋兵、冲过来的冲锋兵和地上的红色长条、坡上射手的红线、风车、远处的浮岛和星穹塔，命中冒「啪！」 | 凯、能量枪、冲锋兵、射手、第 1 章标题卡 | 准星小得几乎看不见；网点偏淡，游戏里要更明显 |
| `viewmodel-kai.png` | 第一人称手臂和能量枪四格：待机、开火、近战、大招 | 凯、能量枪、能量枪五瓣展开、凯的立绘 | 开火那格 3 圈线圈都还亮着，应该暗一圈；大招那格枪口张开成 6 瓣，设定是 5 瓣 |
| `enemies-ch1.png` | 第 1 章 6 种敌人平视、带第 1 章装扮；下排 5 个眼灯表情 | 6 种敌人的三视图 | 岛徽的齿轮画得不明显 |
| `boss-scarecrow.png` | 仰视铁皮稻草人：举叉要砸地，地上红色预警圈，胸口弱点发光 | 铁皮稻草人、凯、能量枪 | 从下往上看，草帽不太像宽檐帽；胸口岛徽只画了船锚 |
| `sfx-lettering.png` | 6 个中文拟声字：啪！哐！轰！当！叮！哐啷啷 | 无 | 没有。背景是纯品红，能直接抠图试用 |

## 游戏里用的图

用 Codex（`gpt-6.1-sol`，xhigh）生成（2026-10-31 起），提示词在同名 `.prompt.txt`；`scripts/build-assets.sh` 把它们处理成 `public/assets/` 下的运行时资源。

| 原图 | 运行时资源 | 处理 |
|---|---|---|
| `scenes/sky-ch1.png` | `scenes/sky-ch1.jpg` | 第 1 章天空全景。左右边缘交叉淡化成横向无缝，游戏里绕一圈贴两遍 |
| `concept/sfx-lettering.png` | `ui/sfx/word-1.png`~`word-6.png` | 6 个拟声字逐个抠图；「叮！」的格子被「哐啷啷」的碎片挤进来一点，单独按区域裁 |
| `ui/items/food.png` | `ui/items/food-bread.png`、`food-apple.png` | 近战砸散掉的麦饼和苹果 |
| `bosses/scarecrow/wanted.png` | `portraits/scarecrow-wanted.png` | 悬赏令上的铁皮稻草人头像，附了主仓库的三视图 |
| `bosses/demo-chief/`、`shield-captain/`、`forest-tank/`、`harvester/` 下的 `wanted.png` | `portraits/<id>-wanted.png` | 另外 4 个 Boss 的悬赏令头像（2026-11-02），各附主仓库的三视图。第一次出图有 3 张没画成品红底，又让 Codex 在原图上把背景改成纯品红 |
| `ui/skills/concussion.png` | `ui/skills/concussion.png` | 震荡雷技能图标（2026-11-02），附冲击波图标定画风。Codex 直接给了透明底，抠图时保留原有的透明 |

## reference/：从主仓库拷来的设定图

出新图时把对应图片作为参考，造型和配色以它们为准。2026-10-31 从主仓库拷来。除 `chapter-1-title.png` 来自主仓库当时的工作区，其余均来自提交 `e38713d`。提示词和建模备注在主仓库的对应目录。

| 文件 | 主仓库路径 | 内容 |
|---|---|---|
| `kai-model-sheet.png` | `art/models/kai/model-sheet.png` | 凯的三视图 |
| `kai-portrait-normal.png` | `art/characters/kai/portrait-normal.png` | 凯的立绘（普通表情） |
| `blaster-model-sheet.png` | `art/models/blaster/model-sheet.png` | 能量枪三视图，枪的造型以这张为准 |
| `blaster-petals-open.png` | `art/models/blaster/petals-open.png` | 能量枪大招时枪口五瓣张开的渲染图 |
| `grunt-model-sheet.png` | `art/models/grunt/model-sheet.png` | 冲锋兵 |
| `gunner-model-sheet.png` | `art/models/gunner/model-sheet.png` | 射手 |
| `bomber-model-sheet.png` | `art/models/bomber/model-sheet.png` | 自爆兵 |
| `shield-model-sheet.png` | `art/models/shield/model-sheet.png` | 盾兵 |
| `thrower-model-sheet.png` | `art/models/thrower/model-sheet.png` | 投弹兵 |
| `turret-model-sheet.png` | `art/models/turret/model-sheet.png` | 炮塔 |
| `scarecrow-model-sheet.png` | `art/models/scarecrow/model-sheet.png` | 铁皮稻草人 |
| `demo-chief-model-sheet.png` | `art/models/demo-chief/model-sheet.png` | 爆破头目（2026-11-02 拷来，下同） |
| `shield-captain-model-sheet.png` | `art/models/shield-captain/model-sheet.png` | 铁盾队长 |
| `forest-tank-model-sheet.png` | `art/models/forest-tank/model-sheet.png` | 林地炮车 |
| `harvester-model-sheet.png` | `art/models/harvester/model-sheet.png` | 巨型收割机 |
| `skill-shockwave.png` | `art/ui/skills/shockwave.png` | 冲击波技能图标，出新技能图标时定画风 |
| `chapter-1-title.png` | `art/scenes/chapter-1-title.png` | 第 1 章标题卡插图，场景气氛的参考 |

## 3D 模型流程

Codex 维护 Blender 装配脚本。沿用刚性零件动画、材质和挂点约定，导出的源 GLB 放在 `art/models/`，打包后将 KTX2 版放到 `public/assets/models/`。已有混元 3D 源网格的制作记录见 [ADR-0004](../docs/decisions/0004-art-pipeline.md#2026-11-02-更新3d-模型可以用混元-3d)。

手臂和武器装配默认到与仓库相邻的 `game/` 里找俯视版参考模型。独立工作树或其他检出目录下，传参考 GLB 的绝对路径。手臂脚本用 `--blaster`，能量枪和特种武器脚本用 `--reference`。例如在仓库根目录为霰弹枪装配：

```bash
blender --background --factory-startup --python art/models/fp-weapons/assemble.py -- \
  --id shotgun --source /path/to/source-shotgun.glb --reference /path/to/game/art/models/shotgun/shotgun.glb
```

### 当前模型源文件

| 目录 | 内容 |
|---|---|
| `fp-arm-right/`、`fp-arm-left/` | 第一人称右臂、左臂的多视图设定图（Codex 画，2026-11-02），给混元 3D 当输入。手里握着一根素灰色的棒子，用来摆出握枪、托枪的姿势；右臂那张的「俯视图」画成了另一个侧视，没用 |
| `fp-arms/` | `assemble.py` 把混元做好的两只手臂对到能量枪的握把和枪管上，输出 `fp-arms.glb`（游戏里的 `fp-arms` 模型）。混元的原始下载不进仓库：右臂 8,757 面、左臂 12,867 面，都是 Studio 里 High 档重拓扑的结果 |
| `fp-weapons/` | 第一人称的特殊武器：霰弹枪、冲锋枪、狙击枪、榴弹炮（2026-11-02），弹射枪、火焰喷射器、冰冻枪、火箭筒、链式电枪（2026-11-03），用主仓库各自的三视图在混元「道具」流程里做（火焰喷射器、链式电枪先把设定图上枪口的火焰和电弧涂掉）。`assemble.py --id <武器>` 把混元的模型按旧模型（主仓库 `art/models/<武器>/<武器>.glb`）对齐：先试两个朝向、按长度缩放、包围盒对中，再用最近点迭代平移到贴合，枪口挂点直接用旧模型的；输出 `fp-<武器>.glb`。面数：霰弹枪 4,858、冲锋枪 3,659、狙击枪 4,520、榴弹炮 7,500、弹射枪 7,012、火焰喷射器 6,327、冰冻枪 5,908、火箭筒 5,298、链式电枪 10,056 |
| `fp-blaster/` | 第一人称的能量枪（2026-11-02）：用 `reference/blaster-model-sheet.png` 切的视图在混元「道具」流程里做，`assemble.py` 按贴图颜色拆出 6 圈线圈、按角度切出 8 片护套，输出 `fp-blaster.glb`（8,501 面）。混元的原始下载不进仓库 |

## 以后的目录

沿用主仓库的分法，游戏实际加载的版本放 `public/assets/`，原图留在这里：

```
art/
  concept/             画风目标图
  reference/           从主仓库拷来的设定图
  characters/<id>/     立绘
  enemies/<id>/        敌人设定图
  bosses/<id>/         Boss 设定图
  scenes/              章节卡、悬赏令、天空
  textures/            线稿贴图
  ui/<group>/          图标、拟声字
  models/<id>/         3D 模型：三视图、建模脚本、导出的 GLB
  CREDITS.md           第三方素材的来源和许可
```

每张生成图旁边放同名 `.prompt.txt`。
