export type TipId =
  | 'controls'
  | 'chest'
  | 'weapon'
  | 'ultimate'
  | 'gunner'
  | 'rush'
  | 'melee'
  | 'bush'
  | 'regen'
  | 'buff'
  | 'skill'
  | 'shield'
  | 'thrower'
  | 'bomber'
  | 'turret'
  | 'elite'
  | 'lock'
  | 'supply'
  | 'boss'
  | 'pen'
  | 'destroy'
  | 'stealth'
  | 'alarmRunner'
  | 'fog'
  | 'lamp'
  | 'blade'
  | 'conveyor'
  | 'shatter'
  | 'burnFuse'
  | 'pileup'
  | 'friendly'
  | 'chainBlast'
  | 'fall'

export const TIPS: Readonly<Record<TipId, string>> = {
  controls: 'WASD 移动，鼠标看，按住左键射击；Shift 冲刺，空格跳',
  chest: '靠近宝箱按 F 打开',
  weapon: '地上的武器按 F 拾取，按 1 / 2 在主武器和特殊武器之间切换',
  ultimate: '大招充满了：按 R 释放星光连射',
  gunner: '射手会瞄你要去的位置：红线停住的那一刻变向，或者躲到石头后面',
  rush: '冲锋兵冲锋前地面会亮起一道长条，按 Shift 往侧面冲刺躲开；冲空了它会晕一下，按右键用枪托把它砸散',
  melee: '机器人冒烟闪红，或者被打得转圈踉跄时：按右键用枪托砸散它，掉出的麦饼和苹果会自己飞过来回血',
  bush: '躲在草丛里，敌人要贴得很近才能发现你',
  regen: '脱离战斗几秒后，生命会慢慢恢复',
  buff: '增益有时限，图标上显示剩余秒数',
  skill: '按 Q 使用技能，冷却时间显示在右下角',
  shield: '盾兵正面挡子弹，绕到侧面或背后再打',
  thrower: '投弹兵会隔着墙扔炸弹，地面出现红圈就离开',
  bomber: '自爆兵冲到身边会爆炸，优先打掉它；脚下出现红圈就拉开距离',
  turret: '炮塔打不动就躲到原木后面，等它打完一轮再探头',
  elite: '脚下有金色光圈的是精英：血更厚、带特殊能力，打倒必掉东西',
  lock: '锁门战：打完区域里的敌人，门才会打开',
  supply: '篝火是补给点，走过去恢复一半生命',
  boss: 'Boss 出招前都有预警；引它冲撞时撞上墙或石头，它会眩晕一会儿',
  pen: '走到羊圈门口按 F 打开羊圈，羊会自己走回草场',
  destroy: '打爆运粮车才能打开北门，车顶上有血条',
  stealth: '躲在麦垛里不会被发现；被发现的话，会有机器人跑去敲钟',
  alarmRunner: '打倒跑去敲钟的机器人，警报就不会响',
  fog: '雾里只能看清 5 格，琥珀色的光点是敌人的眼灯',
  lamp: '按 F 点亮驱雾灯',
  blade: '地上亮红线，刀片马上扫过来，先躲进麦丛',
  conveyor: '传送带会推着你走，Boss 战里也会用到',
  shatter: '冻住的机器人一砸就碎，照样掉吃的',
  burnFuse: '自爆兵一着火就点引信：离它远点，或者让它在同伴堆里炸开',
  pileup: '冲锋兵冲锋会撞翻挡路的同伴，被撞的会踉跄，上去砸散',
  friendly: '自爆兵和炸弹也会炸到机器人自己，把它们引到敌群里',
  chainBlast: '爆炸会引爆旁边的自爆兵，一个接一个',
  fall: '把机器人从高处打下去，它会摔晕，可以直接砸散',
}

export const TIP_SECONDS = 6
export const TIP_NEAR = 3.5
export const TIP_FIGHT_RANGE = 8
export const TIP_SEE_TURRET = 10
