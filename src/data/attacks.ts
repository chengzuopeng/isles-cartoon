import type { WeaponId } from './weapons'

export type AttackCause = WeaponId | 'charge' | 'burn' | 'volatile' | 'blade' | 'keg'

export const CAUSE_NAMES: Readonly<Partial<Record<AttackCause, string>>> = {
  charge: '冲撞',
  burn: '灼烧',
  volatile: '爆裂',
  blade: '收割刀片',
  keg: '火药桶',
}

export const ATTACK_TIPS: Readonly<Partial<Record<AttackCause, string>>> = {
  claw: '冲锋兵扑击前会停顿约 0.4 秒，看到地面扇形就后撤',
  rush: '冲锋兵冲锋前地面会亮起一道长条，往侧面躲开；它冲空了会晕一下，趁机反打',
  rifle: '射手会瞄你要去的位置，红线停住那一刻变向或躲到墙后',
  cannon: '炮塔一次打出三发散射，贴着墙推进，从侧面接近',
  fuse: '自爆兵冲过来时优先击杀，脚下红圈出现后立刻拉开距离',
  bash: '盾兵正面挡子弹、转身慢，绕到侧面或背后再打',
  bomb: '投弹兵会把炸弹扔到你脚下，看到地面红圈就离开',
  strawFan: '散射之间有空隙，横向移动穿过去',
  strawSlam: '震地前地面会出现红圈，跑到圈外',
  reaperSweep: '横扫只打前方扇形，绕到 Boss 身侧或身后',
  baleToss: '麦捆会连着砸下来，每个落点都有红圈，保持移动',
  bladeSpin: '刀片旋转的圆环有一个缺口，跑进缺口里',
  fallingBlade: '场地边缘会落刀，地面红圈出现就离开',
  chiefBomb: '爆破头目一次扔三颗炸弹，每个落点都有红圈；扔完会停顿一下，趁这时候打它',
  chiefCannon: '炮口连射前地上有红线，横着走开或躲到草垛柱子后面',
  captainRush: '铁盾队长冲锋前地上有长条，往侧面躲；站在粮仓前引它冲过来，撞上粮仓它会掉盾、发晕',
  captainBash: '盾击只打前方扇形，后撤或绕到侧面；打完它转身很慢，绕到背后打',
  tankShell: '三联炮开火前地上有三条红线，站到两条线中间，或者躲到树桩、石头后面',
  tankMine: '地雷落点先有红圈，别站在圈里；落地的地雷走近就会爆，绕开它或者开枪先打爆',
  tankRam: '炮车倒车前车尾方向有长条，往侧面躲；站在树桩后面引它倒车，撞上树桩它会发晕',
  charge: 'Boss 冲撞前会对准你，往侧面躲；引它撞墙或石头能让它眩晕',
  burn: '着火时离开火源，等火势熄灭',
  volatile: '爆裂精英倒下后会原地爆炸，击败后马上远离',
  blade: '等红线消失、刀片扫过去再穿过收割道',
  keg: '火药桶被打中会先冒火星再炸：离它三米以外，或者引敌人过去再打',
}
