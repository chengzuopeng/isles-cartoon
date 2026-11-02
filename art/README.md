# 美术素材

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

出新图时用 `-i` 附上，造型和配色以它们为准。2026-10-31 从主仓库拷来：除了 `chapter-1-title.png` 是主仓库工作区里还没提交的文件，其余都和主仓库提交 `e38713d` 里的一样。提示词和建模备注在主仓库的对应目录。

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

## models/：3D 模型

| 目录 | 内容 |
|---|---|
| `fp-arm-right/`、`fp-arm-left/` | 第一人称右臂、左臂的多视图设定图（Codex 画，2026-11-02），给混元 3D 当输入。手里握着一根素灰色的棒子，用来摆出握枪、托枪的姿势；右臂那张的「俯视图」画成了另一个侧视，没用 |
| `fp-arms/` | `assemble.py` 把混元做好的两只手臂对到能量枪的握把和枪管上，输出 `fp-arms.glb`（游戏里的 `fp-arms` 模型）。混元的原始下载不进仓库：右臂 8,757 面、左臂 12,873 面，都是 Studio 里 High 档重拓扑的结果 |

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
