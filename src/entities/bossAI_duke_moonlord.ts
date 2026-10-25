// Boss AI 1:1 移植(二):猪鲨鱼龙 AI_069(NPC 370)与月亮领主 aiStyle 77/78/79(NPC 398 核心 / 397 手 / 396 头)。
// 源码(1456=Terarria1456 / 1457=Terarria1457 NPC.cs;下文注释 ≤:50127 者为 1456 系锚,
// 1457 真位:AI_069 块 +152(:49295-50279)、AI_071 块 +88(:35284-35405),红蓝对抗 E-8 登记) ——
//   猪鲨 AI_069_DukeFishron        1456 :49143-50127 / 1457 :49295-50279
//   月总核心 aiStyle 77(398)      1456 :36774-37198(1457 :36926 起,+152 族)
//   月总手   aiStyle 78(397)      1456 :37199-37711
//   月总头   aiStyle 79(396)      1456 :37712-38128
//   攻击时间表 MoonLordAttacksArray :6830-6946 / MoonLordAttacksArray2 :6948-6987
//   死亡转换 checkDead             :78841-78867(396/397 血尽→ai0=-2 闭眼残肢+召真眼;398 血尽→ai0=2 死亡演出)
//   鲨鱼 NPC aiStyle 71(372/373)  1456 :35196-35328 / 1457 :35284-35405(升空蓄力 90t→16 速扑咬,撞墙即死)
// 弹体(原版 Projectile.cs 1:1,本文件内实现为投射桶实体):
//   龙卷水弹 385 aiStyle 65        :28402-28482(小:斜落/大:追踪玩家 50px 引爆)+ Kill 落龙卷 :70714-70778
//   鲨鱼龙卷 384/386 aiStyle 64    :28287-28398(逐段向上生长,周期 NewNPC 372/373 出鲨)
//   死亡之光 455 aiStyle 84        :30291-30549(锚源 NPC 眼部,±2π/540 每 t 扫射,180t 寿命,
//                                  Colliding 线段判定 :14673-14682,命中伤害 = NewProjectile 伤 ×2 :13781)
// 经典模式主链 1:1;getGoodWorld 分支已实装(月总头死亡之光收束尾 30 连射 1021,
// :37940-37950;猪鲨 AI_069 与月总手/核心 1456 无 g 分支);expert 分支保留注释;
// netcode 跳过。
// 无敌语义:R23b(2026-08-24)起手/头/核心各态改写真旗标 dontTakeDamage
// (iframes=2 近似被 hurt 免疫门的 pierce!==1 豁免绕过——单发弹直伤无敌期;
// 同 golem/四柱先例)。★2026-08-31 台账①收口:猪鲨四态(-1 出生/4·9 变身/12 瞬移,
// NPC.cs :50278 dontTakeDamage=!flag7)+鲨鱼龙起扑窗(AI_071 :35300/:35381)与月总
// 核心两态(-2 归位/:41601、-1 出生/:41625)全部落真旗标——iframes=2 白嫖近似退役。
// 死光/幻影族命中改走 BossNoCheese 独立 40t 免工件槽(见 MLDeathray 与
// projTargets.DAMAGE_EVP_NO_CHEESE_PROJS,台账⑥);371 泡泡按 1458 行为裁定重做
// (台账②,报告顶部单列)。
import type { Enemy } from './Enemy';
import type { GameHooks } from './types';
import type { Player } from './Player';
import type { Camera } from '../render/Camera';
import type { Renderer } from '../render/Renderer';
import { Entity } from './Entity';
import { TILE } from '../core/constants';
import { hostileProjectileDamage, mainDifficulty, mainExpertMode, damageVar } from '../stats/ScaleStats';
import { spawnPart, shoot, shootBolt462, accelTo, losClear } from './bossAI';
import { projSprite, projFrameCount, volleyPhantomOrbs } from './Arrow';
import { GorePiece } from './GorePiece';
import { BuffType } from '../stats/Buffs';
import { damageEvPNoCheese, evpDirectDmg, bannerNpcKeyOf } from './projTargets';   // ★台账⑥ BossNoCheese 分桶命中通道;BJ710-C 直调站门序单源+发射者旗键
import { projectileWetSection, projWaterDragFactor } from './projWetSection';
import { wetCollision } from './npcLiquid';
import { projectileData } from '../data/vanillaProjectiles';

// ---------------------------------------------------------------------------
// 通用工具
// ---------------------------------------------------------------------------

/** Boss 伤害/防御基值缓存(状态机每 tick 从基值派生临时修正,防重复乘膨胀) */
const baseStats = new WeakMap<Enemy, { dmg: number; def: number }>();
const baseOf = (e: Enemy) => {
  let b = baseStats.get(e);
  if (!b) { b = { dmg: e.def.damage, def: e.def.defense ?? 0 }; baseStats.set(e, b); }
  return b;
};

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** 标量区间平滑(驱动向量 SmoothStep 的 amount 因子) */
const smoothAmt = (t: number) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};
/** 原版 Vector2.SmoothStep(cur, target, amount):Lerp(amount²(3-2amount)) */
const vSmoothStep = (cur: number, target: number, amount: number) => lerp(cur, target, smoothAmt(amount));
/** 角度插值(原版 float.AngleLerp:取最短方向步进) */
const angleLerp = (cur: number, target: number, t: number) => {
  let d = target - cur;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return cur + d * t;
};

/** Utils.Vector2FromElipse(Utils.cs:948-965) 1:1——月总瞳孔/束锚椭圆。
 *  ★非 naive (cosθ·sx, sinθ·sy):角度向量先乘 One/Normalize(sizes)=(|s|/sx,|s|/sy)
 *  再归一化(重参数化到椭圆真参数化角),最后乘 sizes/**2**——幅度只有 naive 的一半
 *  且方向被拉偏。曾按 naive 实现令瞳孔行程 ×2:头瞳孔(+58)甩出眼洞(cy+32)外
 *  = 眼窝恒空、手瞳孔甩出掌洞 = 双手无瞳(2026-08-19 修)。sizes 已含 localAI[1]
 *  开度(原版调用形态 Vector2FromElipse(rot, (w,h)×localAI[1])) */
export function mlElipseVec(angle: number, sx: number, sy: number): [number, number] {
  if (sx === 0 && sy === 0) return [0, 0];      // elipseSizes == Zero 首卫兵
  const c = Math.cos(angle), s = Math.sin(angle);
  if (c === 0 && s === 0) return [0, 0];        // angleVector == Zero 首卫兵
  const len = Math.hypot(sx, sy);
  let ax = c * (len / sx), ay = s * (len / sy); // *(One/Normalize(sizes))
  const l2 = Math.hypot(ax, ay) || 1;
  ax /= l2; ay /= l2;                            // 归一化(重参数化)
  return [ax * sx / 2, ay * sy / 2];            // * sizes/2
}

/** 原版 SimpleFlyMovement(:78100)+ 速度折半混合(月总 8/0.5+Lerp0.5 的组合写法):
 *  先单轴步进逼近目标速度,再与步进前速度做 0.5 Lerp(等效步长减半) */
const flyLerp = (e: Enemy, tx: number, ty: number, acc: number) => {
  const ox = e.vx, oy = e.vy;
  e.vx = accelTo(e.vx, tx, acc);
  e.vy = accelTo(e.vy, ty, acc);
  e.vx = lerp(ox, e.vx, 0.5);
  e.vy = lerp(oy, e.vy, 0.5);
};

/** 每实例附加槽位(原版 direction/spriteDirection/localAI/frameCounter 等无对应 Enemy 字段) */
interface DukeX { dir: number; spr: number }
const dukeX = new WeakMap<Enemy, DukeX>();
const dukeOf = (e: Enemy): DukeX => {
  let x = dukeX.get(e);
  if (!x) { x = { dir: 1, spr: 1 }; dukeX.set(e, x); }
  return x;
};
interface HandX { frame: number; l0: number; l1: number }
const handX = new WeakMap<Enemy, HandX>();
const handOf = (e: Enemy): HandX => {
  let x = handX.get(e);
  if (!x) { x = { frame: 0, l0: 0, l1: 0 }; handX.set(e, x); }
  return x;
};
interface HeadX { f2: number; f3: number; l0: number; l1: number; l2: number }
const headX = new WeakMap<Enemy, HeadX>();
const headOf = (e: Enemy): HeadX => {
  let x = headX.get(e);
  if (!x) { x = { f2: 0, f3: 0, l0: 0, l1: 0, l2: 0 }; headX.set(e, x); }
  return x;
};

/** 核心帧引擎(FindFrame case 398,1457 NPC.cs:72712-72740 的 frameCounter/frame.Y
 *  侧写):fc 每睁核 tick +1,≥30 回卷到 6(帧号=fc%30/6,首程 fc∈{1..5} 帧号全 0,
 *  此后 1-4 循环)。★BJ591 定谳:原版 burst 门=「上一拍算出的 frame.Y==0」而非
 *  一次性——首程连爆 6 拍(睁核首拍吃 ≤0 期遗留 0 + fc∈{1..5} 五拍)+6×(4 gore
 *  619-622 + 尘 209×50);fc≥6 后帧号恒 ≥1 不再爆;ai0 回 ≤0 期(:72714-72717)每拍
 *  把 frame.Y 清 0 而 fc 不清 → 再睁核首拍恒再爆一拍(远距瞬移归位 ai0=-2 支可达)。
 *  frameY0 ≙ 原版 frame.Y==0 态(初值 true ≙ Rectangle 缺省 0) */
interface CoreX { fc: number; frameY0: boolean }
const coreX = new WeakMap<Enemy, CoreX>();
const coreOf = (e: Enemy): CoreX => {
  let x = coreX.get(e);
  if (!x) { x = { fc: 0, frameY0: true }; coreX.set(e, x); }
  return x;
};

/** 实心块内判定(原版 Collision.SolidCollision(position,width,height) 全盒 any 等价件):
 *  扫描矩形覆盖到的【全部】tile 列行,任一实心即真——曾按中心格单点近似,
 *  半砖/边缘骑线时猪鲨隐身渐变与鲨龙蓄力/起扑窗判定集体漏检(台账④,
 *  与 bossAI_dd2 solidBody 同款修法;对应 dd2 文件内五点采样版)。
 *  ★halfBrick 子矩形(:2739-2745 vector.Y+=8/num2−8——下半 8px 才算实心)与
 *  平台/已致动格排除(st.isSolid 内建 active/actuated 门+平台 solid:false)=
 *  红蓝对抗 R1-F6 补,曾整格算实心=半砖上缘/平台误判隐身渐变与撞块死 */
const inSolid = (game: GameHooks, e: { x: number; y: number; w: number; h: number }): boolean => {
  const st = game.world.store;
  const x0 = Math.floor(e.x / TILE), x1 = Math.floor((e.x + e.w - 0.001) / TILE);
  const y0 = Math.floor(e.y / TILE), y1 = Math.floor((e.y + e.h - 0.001) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!st.inBounds(tx, ty) || !st.isSolid(tx, ty)) continue;
      if (st.half[st.idx(tx, ty)]) {   // halfBrick:仅与下半 8px 子矩形相交才算
        const ry = ty * TILE + 8;
        if (e.y + e.h > ry && e.y < ry + 8) return true;
      } else {
        return true;
      }
    }
  }
  return false;
};

/** 原版"攻击时间表"推进(NPC.cs :37229-37251 / :37740-37762 / :38243-38264 同构):
 *  ai1 全局计时,逐槽累计时长定位当前槽;全部槽走完回绕 ai1=0。
 *  注意:只回写 ai1,不写 ai0——手/头由调用方把槽攻击号赋给 ai0(即其状态),
 *  核心二阶段 ai0 是相位状态(0/1/2/3),绝不能被攻击号覆盖。 */
function attackSlot(e: Enemy, table: ReadonlyArray<readonly [number, number]>): { atk: number; inSlot: number; dur: number } {
  let slot = 0, consumed = 0;
  while (slot < table.length) {
    const dur = table[slot][1];
    if (dur + consumed > e.ai1) break;
    consumed += dur;
    slot++;
  }
  if (slot === table.length) { slot = 0; e.ai1 = 0; consumed = 0; }
  const atk = table[slot][0];
  return { atk, inSlot: e.ai1 - consumed, dur: table[slot][1] };
}

// ---------------------------------------------------------------------------
// AI_069 猪鲨鱼龙(NPC 370,NPC.cs:49143-50127)
// ---------------------------------------------------------------------------
// 状态 ai0:-1 出生(75t) → 一阶段循环 0 悬浮(num3 t)→1 冲撞(num6 t)×5→2 泡泡弹(80t)
//   →3 鲨鱼龙卷(90t);血 ≤50% →4 变身(180t) →5 二阶段循环:0→6 冲撞→7 旋转泡泡冲刺(120t)
//   →8 鲨鱼龙卷;9(expert 15% 血)二段变身(180t) →10 隐身悬浮→11 冲撞/12 瞬移(30t)/13 旋转冲刺。
// 经典参数:悬浮 60t/0.45/7.5、冲撞 30t@16 速、泡泡 80t 每 4t 一发、龙卷 90t(60t 时发射)、变身 180t。

const DUKE = {
  spawnT: 75,          // num21 :49215
  hoverT: 60,          // num3  :49168(经典)
  hoverAcc: 0.45,      // num4  :49169
  hoverSpd: 7.5,       // num5  :49170
  chargeT: 30,         // num6  :49187
  chargeSpd: 16,       // num7  :49188
  bubbleT: 80,         // num8  :49202
  bubbleEvery: 4,      // num9  :49203
  bubbleAcc: 0.3,      // num10 :49204
  bubbleSpd: 5,        // num11 :49205
  nadoT: 90,           // num12 :49206
  p1T: 180,            // num13 :49207(一→二阶段变身)
  p2T: 180,            // num14 :49208(二段狂暴变身,expert)
  teleT: 30,           // num15 :49209(瞬移)
  spinT: 120,          // num16 :49210(旋转冲刺)
  spinEvery: 4,        // num17 :49211
  spinBubbleSpd: 6,    // num18 :49212
  spinDashSpd: 20,     // num19 :49213
};
/** 旋转冲刺角速度 num20 = 2π/(num16/2) = 2π/60(:49214) */
const DUKE_SPIN_RATE = TAU / (DUKE.spinT / 2);

/** 狂暴判定 flag6(:49238):玩家在太空(y<800)/地下(y>worldSurface*16)/离开两侧海洋带 */
function dukeEnraged(game: GameHooks, player: Player): boolean {
  const st = game.world.store;
  const surface = (game.world.groundLevel || Math.floor(st.h * 0.3)) * TILE;
  return player.y < 800 || player.y > surface ||
    (player.x > 6400 && player.x < st.w * TILE - 6400);
}

/** 一阶段悬浮结束的下一招(:49471-49542) */
function dukePick1(e: Enemy, enraged: boolean): number {
  const a3 = Math.floor(e.ai3);
  let next = 0; // 0=无事(原版 switch 无匹配分支,ai2 继续累计)
  if (a3 >= 0 && a3 <= 9) next = 1;          // 冲撞
  else if (a3 === 10) { e.ai3 = 1; next = 2; } // 泡泡弹
  else if (a3 === 11) { e.ai3 = 0; next = 3; } // 鲨鱼龙卷
  if (enraged && next === 2) next = 3;       // :49495 狂暴时泡泡弹换龙卷
  if (e.hp <= e.maxHp * 0.5) next = 4;       // :49499 半血变身
  return next;
}
/** 二阶段悬浮结束的下一招(:49736-49809)。flag2 = expertMode && life≤15%
 *  （:49300）→ num33=4（:49908-49910）→ ai0=9 二段狂暴变身—— expert 大师档
 *  血线触发三段形态(10-13 隐身悬浮/冲撞/瞬移爆冲)。★曾整支漏写=expert 下
 *  ai0=9 永不可达、10-13 全段死码(2026-09-03 批4 补) */
function dukePick2(e: Enemy, enraged: boolean, flag2: boolean): number {
  const a3 = Math.floor(e.ai3);
  let next = 0;
  if (a3 >= 0 && a3 <= 5) next = 1;          // 冲撞(6)
  else if (a3 === 6) { e.ai3 = 1; next = 2; } // 旋转泡泡冲刺(7)
  else if (a3 === 7) { e.ai3 = 0; next = 3; } // 鲨鱼龙卷(8)
  if (flag2) next = 4;                       // :49908-49910 expert 15% 血 → 9
  if (enraged && next === 2) next = 3;       // :49760
  return next;
}
/** 冲撞起手(:49503-49520 / :49764-49781 / :49988-50004 同构):定速直冲+朝向修正 */
function dukeCharge(e: Enemy, player: Player, spd: number, toState: number, st: DukeX) {
  const dx = player.cx - e.cx, dy = player.cy - e.cy;
  const d = Math.hypot(dx, dy) || 1;
  e.vx = (dx / d) * spd;
  e.vy = (dy / d) * spd;
  e.ai0 = toState; e.ai1 = 0; e.ai2 = 0;
  e.spin = Math.atan2(e.vy, e.vx);
  const s = Math.sign(dx) || st.dir;
  st.dir = s;
  if (st.spr === 1) e.spin += Math.PI;
  st.spr = -s;
}
/** 悬浮段共用(:49415-49468 / :49680-49733 / :49932-49967 同构):
 *  目标点 = 玩家 + (ai1 侧偏, -200);desired = normalize(目标-自身-速度)*spd 后 SimpleFlyMovement */
function dukeHover(e: Enemy, player: Player, acc: number, spd: number, sideOff: number, st: DukeX) {
  if (e.ai1 === 0) e.ai1 = sideOff * Math.sign(e.cx - player.cx || 1);
  const dx = player.cx + e.ai1 - e.cx - e.vx;
  const dy = player.cy - 200 - e.cy - e.vy;
  const d = Math.hypot(dx, dy) || 1;
  e.vx = accelTo(e.vx, (dx / d) * spd, acc);
  e.vy = accelTo(e.vy, (dy / d) * spd, acc);
  const s = Math.sign(player.cx - e.cx) || st.dir;
  // 态10 悬浮翻面支清残影（:50107-50111 活码;态0/5 悬浮无此支——曾整段缺=翻面拖影,
  // 红蓝对抗 R5-F13⑤ 补;case12 侧翻支同款在原版是 ai2==0 恒假死码,不补）
  if (e.ai2 === 0 && s !== st.dir) {
    e.spin += Math.PI;
    if (e.ai0 === 10) e.clearTrailHistory();
  }
  st.dir = s;
  if (st.spr !== -st.dir) e.spin += Math.PI;
  st.spr = -st.dir;
}

/** 冲撞尾流（:49696-49708 / :49964-49976 / :50171-50189 三态逐字同构;1456 :49544-49554 系）。
 *  原版每 tick 7 粒 d172（气泡尾流,α100/scale1.4,后置 noGravity+noLight）：
 *   · pos = center + [norm(v)⊙((w+50)/2,h)·0.75].RotatedBy((j−2)·π/7) + vector5
 *     ——★Vector2×Vector2=组件乘(RB12a 家族);扇形角 (j−2)π/7, j=0..6（原版整除
 *     num29/2−1=2,非对称扇）;vector5 = 均匀角 [−π/2,π/2) × Next(3,8)=3..7 整数幅;
 *   · NewDust 0×0 盒 → 池内 +4 落点/±2 初速抖动由 spawnDust 1:1 承载;
 *   · 后置覆写：noLight=true、velocity=(抖动+v5·2)/4 − npc 速度（尾流向后拖——
 *     冲刺时尘相对本体后掠的观感来源）。
 *  ★BJ310（2026-09-23,用户实报"冲刺没有粒子"）：旧实现 = 2 粒 #8FD8FF 泛用
 *  spawnParticles（case6/11 连偏移都没有）——d172 尾流整缺,本案判谳锚。 */
function dukeDashDust(e: Enemy, game: GameHooks): void {
  const nv = Math.hypot(e.vx, e.vy) || 1;
  const nvx = e.vx / nv, nvy = e.vy / nv;
  for (let j = 0; j < 7; j++) {
    const ang = (j - 2) * Math.PI / 7;
    const bx = nvx * ((e.w + 50) / 2) * 0.75, by = nvy * e.h * 0.75;
    const rx = bx * Math.cos(ang) - by * Math.sin(ang), ry = bx * Math.sin(ang) + by * Math.cos(ang);
    const a5 = Math.random() * Math.PI - Math.PI / 2;
    const m5 = 3 + Math.floor(Math.random() * 5);          // Main.rand.Next(3,8) → 3..7
    const v5x = Math.cos(a5) * m5, v5y = Math.sin(a5) * m5;
    const d = game.spawnDust?.(e.cx + rx + v5x, e.cy + ry + v5y, 0, 0, 172,
      v5x * 2, v5y * 2, 100, null, 1.4, true);
    if (d) {   // 池满 null → 原版 Main.dust[6000] 越界槽不存在的等价豁免
      d.noLight = true;
      d.vx = d.vx / 4 - e.vx;
      d.vy = d.vy / 4 - e.vy;
    }
  }
}

/** 猪鲨 FindFrame(NPC.cs FindFrame case 370 :72824-72917)——AI 侧每 tick 维护,
 *  帧号直写 customFrameIdx 供渲染端直读(694 先例;npcFrameT = frameCounter)。
 *  帧 0-5 = 游动帶(6t/帧,二阶段悬浮 5t/帧)、6/7 = 张口帶;8 帧贴图:
 *  - ai0 0/5 悬浮:游动循环,ai0==5 步进加速(num51 5→4,:72828-72832);
 *  - ai0 1/6 冲撞与 2/7 旋转冲刺:ai2<10 帧 6,≥10 帧 7(:72844-72865);
 *  - ai0 3/8 龙卷蓄力与 -1 出生(num52=90):ai2<60 或 >80 游动,否则帧 6
 *    (ai2∈(70,75) 帧 7)(:72866-72889);
 *  - ai0 4/9 变身(num53=180):ai2<120 或 >160 游动,否则帧 6(ai2∈(130,155) 帧 7)
 *    (:72891-72916);
 *  - ai0 10-13(expert 狂暴段)原版无分支 → 帧保持不变。
 *  游动帶回卷门 `frame.Y >= 6 → 0` 每 tick 生效(:72839-72842)——张口帧 6/7 收
 *  尾回到悬浮帶时首 tick 即回卷到帧 0,与原版一致。 */
function dukeFindFrame(e: Enemy): void {
  const a0 = Math.floor(e.ai0);
  let f = e.customFrameIdx ?? 0;
  /** 游动帶步进(threshold=num51:counter 先 +1 再比 >num51 → 5=6t/帧、4=5t/帧) */
  const swim = (threshold: number): void => {
    e.npcFrameT += 1;
    if (e.npcFrameT > threshold) { e.npcFrameT = 0; f += 1; }
    if (f >= 6) f = 0;                                     // :72839-72842 回卷
  };
  if (a0 === 0 || a0 === 5) {
    swim(a0 === 5 ? 4 : 5);                                // :72826-72843
  } else if (a0 === 1 || a0 === 6 || a0 === 2 || a0 === 7) {
    f = e.ai2 < 10 ? 6 : 7;                                // :72844-72865
  } else if (a0 === 3 || a0 === 8 || a0 === -1) {
    if (e.ai2 < 60 || e.ai2 > 80) swim(5);                 // num52=90-30/90-10 :72868-72881
    else {                                                  // :72882-72889 计时窗张口
      f = 6;
      if (e.ai2 > 70 && e.ai2 < 75) f = 7;
    }
  } else if (a0 === 4 || a0 === 9) {
    if (e.ai2 < 120 || e.ai2 > 160) swim(5);               // num53=180-60/180-20 :72895-72908
    else {                                                  // :72909-72916 变身窗张口
      f = 6;
      if (e.ai2 > 130 && e.ai2 < 155) f = 7;
    }
  }
  e.customFrameIdx = f;
}

/** AI_069 主入口(经典模式) */
export function dukeFishronAI(e: Enemy, game: GameHooks, player: Player | null) {
  const st = dukeOf(e);
  if (!e.bInit) { e.bInit = true; e.ai0 = -1; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0; e.spawnAlpha = 255; } // :49247-49257
  const b = baseOf(e);
  const enraged = player ? dukeEnraged(game, player) : false;
  const flag3 = e.ai0 > 4;                                  // flag3 :49301(二阶段状态 5-13)
  const flag4 = e.ai0 > 9;                                  // flag4 :49150(expert 狂暴段 10-13)
  const flag5 = e.ai3 < (flag3 ? 3 : 5) * 2;                // flag5 :49151-49152

  // 伤害/防御修正(1457 :49305-49319,1456 :49153-49167 + 狂暴 1457 :49390-49398)——每 tick
  // 从基值派生。★expert num=1.2 第二乘区(:49298)(红蓝对抗 R2-F1 补:曾整表缺失,
  // expert 大师档接触伤低 17%;Math.round vs 原版 (int) 截断在全参数域逐值相等——
  // f32 积恰落在整数上沿)
  const expert = mainExpertMode(game.world);
  const dmgTier = expert ? 1.2 : 1;
  if (flag4) { e.def.damage = Math.round(b.dmg * 1.1 * dmgTier); e.def.defense = 0; }
  else if (flag3) { e.def.damage = Math.round(b.dmg * 1.2 * dmgTier); e.def.defense = Math.round(b.def * 0.8); }
  else { e.def.damage = b.dmg; e.def.defense = b.def; }
  if (enraged) { e.def.damage = b.dmg * 2; e.def.defense = b.def * 2; }

  // 悬浮/冲撞参数(1457 :49320-49353,1456 :49168-49201)——expert 档全表(R2-F1 补)
  let hoverT = expert ? 40 : 60, hoverAcc = expert ? 0.55 : 0.45, hoverSpd = expert ? 8.5 : 7.5;
  if (flag4) { hoverAcc = 0.7; hoverSpd = 12; hoverT = 30; }            // :49325-49329
  else if (flag3 && flag5) {                                            // :49330-49335
    hoverAcc = expert ? 0.6 : 0.5; hoverSpd = expert ? 10 : 8; hoverT = expert ? 40 : 20;
  } else if (flag5 && !flag3 && !flag4) hoverT = 30;                     // :49336-49339
  let chargeT = expert ? 28 : 30, chargeSpd = expert ? 17 : 16;          // :49340-49342
  if (flag4) { chargeT = 25; chargeSpd = 27; }                           // :49343-49346
  else if (flag5 && flag3) { chargeT = expert ? 27 : 30; if (expert) chargeSpd = 21; }  // :49347-49353
  if (enraged) { hoverT = 10; chargeSpd += 6; }                          // :49390-49398 flag6 块(在档位之后加算)

  // 玩家死/远离 5600px(1457 :49376-49389,1456 :49218-49237):减速升空离场+
  // EncourageDespawn(10)+ai0 归位+ai2=0;原版本支【不 return】,续走旋转伺服/状态机
  // 尾句(:50278 dontTakeDamage=!flag7)——本仓早退,故补 dontTakeDamage=false 等价
  // (R2-F5)。原版此处无回血逻辑。
  if (!player || player.dead || Math.hypot(player.cx - e.cx, player.cy - e.cy) > 5600) {
    e.vy -= 0.4;
    e.encourageDespawn(10); // :49376-49389 急升逃离 + EncourageDespawn(10)
    e.ai0 = e.ai0 > 4 ? 5 : 0;
    e.ai2 = 0;
    // ★本支早退跳过尾句 dontTakeDamage=!flag7——原版本支【不 return】落到 :50278
    // (flag7 恒 true→每拍 false),逃离期即刻可受击(红蓝对抗 R2-F5 补,曾残留无敌)
    e.dontTakeDamage = false;
    e.x += e.vx; e.y += e.vy;
    dukeFindFrame(e); // FindFrame 在 AI 之后仍逐 tick 执行(原版 UpdateNPC 时序)
    return;
  }

  // ---- 身体旋转朝向(:49258-49345)----
  let target = Math.atan2(player.cy - e.cy, player.cx - e.cx);
  if (st.spr === 1) target += Math.PI;
  if (target < 0) target += TAU; else if (target > TAU) target -= TAU;
  if (e.ai0 === -1 || e.ai0 === 3 || e.ai0 === 4 || e.ai0 === 8) target = 0; // :49271-49286
  let step = 0.04;                                                            // num23 :49287
  if (e.ai0 === 1 || e.ai0 === 6 || e.ai0 === 7) step = 0;                    // :49288-49295
  if (e.ai0 === 3 || e.ai0 === 4 || e.ai0 === 8) step = 0.01;                 // :49296-49307
  let rot = e.spin;
  if (rot < target) rot += (target - rot > Math.PI ? -step : step);
  if (rot > target) rot += (rot - target > Math.PI ? step : -step);
  if (rot > target - step && rot < target + step) rot = target;
  if (rot < 0) rot += TAU; else if (rot > TAU) rot -= TAU;
  if (rot > target - step && rot < target + step) rot = target;
  e.spin = rot;

  // ---- 透明度(:49346-49363;近似为 spawnAlpha 渐变)----
  // 入实心块 +15/出块 −15,钳 [0,150](★上限 150 非 255——入块半隐,2026-08-19 台账 E 修)
  if (e.ai0 !== -1 && e.ai0 < 9) e.spawnAlpha = inSolid(game, e) ? Math.min(150, e.spawnAlpha + 15) : Math.max(0, e.spawnAlpha - 15);

  let invuln = false; // flag7(dontTakeDamage = !flag7,:50126)
  switch (e.ai0) {
    case -1: { // 出生(:49365-49414)
      invuln = true;
      e.vx *= 0.98; e.vy *= 0.98;
      const s = Math.sign(player.cx - e.cx) || st.dir;
      st.dir = s; st.spr = -s;
      if (e.ai2 > 20) {
        e.vy = -2;
        e.spawnAlpha = clamp(e.spawnAlpha - 5 + (inSolid(game, e) ? 15 : 0), 0, 150); // :49517-49533
      }
      // (原版本支无 else 复位支——spawnAlpha 初值 255 使 else 恒不可达,R2-F7 清)
      if (e.ai2 === DUKE.nadoT - 30) { // 出生尘环（1457 NPC.cs:49548-49556;旧注 :49507-49528 系 1456 行号）
        // 36 粒 d172 椭圆环:pos = Center + 2×[Normalize(v)·(w/2,h)·0.375].RotatedBy(
        // (i−17)·2π/36),速度 = 径向外 3(R5-F13-9 补:曾 18 粒泛用泛向近似)。
        // ★BJ342 ND4：原版 `Dust.NewDust(vector + vector2,…)`（:49548-49556——
        // vector=Center+rotOffset、vector2=vector−Center ⇒ 落点=(Center+off)+off
        // =Center+2×rotOffset;曾 1×=环半径减半偏离）
        const n = 36;
        const nv = Math.hypot(e.vx, e.vy) || 1;
        for (let i = 0; i < n; i++) {
          const ang = (i - (n / 2 - 1)) * (Math.PI * 2) / n;
          const bx = (e.vx / nv) * (e.w / 2) * 0.375, by = (e.vy / nv) * e.h * 0.375;
          const rx = bx * Math.cos(ang) - by * Math.sin(ang), ry = bx * Math.sin(ang) + by * Math.cos(ang);
          const ol = Math.hypot(rx, ry) || 1;
          game.spawnParticles(2 * rx + e.cx, 2 * ry + e.cy, '#8FD8FF', 1, 3,
            { life: 100, grav: 0, size: 1.4, vx: (rx / ol) * 3, vy: (ry / ol) * 3 });
        }
        game.playSfxWav?.('Zombie_20', 1, e.cx, e.cy);   // :49529 PlaySound(29,…,20) 满响(曾借 roar 0.8)
      }
      e.ai2 += 1;
      if (e.ai2 >= DUKE.spawnT) { e.ai0 = 0; e.ai1 = 0; e.ai2 = 0; }
      break;
    }
    case 0: { // 一阶段悬浮(:49415-49543)
      if (player.dead) break;
      dukeHover(e, player, hoverAcc, hoverSpd, 300, st);
      e.ai2 += 1;
      if (e.ai2 >= hoverT) {
        const next = dukePick1(e, enraged);
        if (next === 1) dukeCharge(e, player, chargeSpd, 1, st);
        else if (next === 2) { e.ai0 = 2; e.ai1 = 0; e.ai2 = 0; }
        else if (next === 3) {
          e.ai0 = 3; e.ai1 = 0; e.ai2 = 0;
          if (enraged) e.ai2 = DUKE.nadoT - 40; // :49530-49533 狂暴跳过前摇
        } else if (next === 4) { e.ai0 = 4; e.ai1 = 0; e.ai2 = 0; }
      }
      break;
    }
    case 1: { // 冲撞(:49544-49566)
      dukeDashDust(e, game);                                // ★BJ310:7×d172 尾流(旧=2 粒泛用近似,整缺判谳)
      e.ai2 += 1;
      if (e.ai2 >= chargeT) { e.ai0 = 0; e.ai1 = 0; e.ai2 = 0; e.ai3 += 2; }
      break;
    }
    case 2: { // 泡泡弹幕(:49567-49637)
      if (player.dead) break;
      if (e.ai1 === 0) e.ai1 = 300 * Math.sign(e.cx - player.cx || 1);
      const dx = player.cx + e.ai1 - e.cx - e.vx;
      const dy = player.cy - 200 - e.cy - e.vy;
      const d = Math.hypot(dx, dy) || 1;
      e.vx = accelTo(e.vx, (dx / d) * DUKE.bubbleSpd, DUKE.bubbleAcc);
      e.vy = accelTo(e.vy, (dy / d) * DUKE.bubbleSpd, DUKE.bubbleAcc);
      if (e.ai2 === 0) game.playSfxWav?.('Zombie_20', 1, e.cx, e.cy);   // :49608 PlaySound(29,…,20) 满响(曾借 roar 0.5)
      if (e.ai2 % DUKE.bubbleEvery === 0) { // :49610-49618 每 4t 吐一颗爆裂泡泡(NPC 371)
        const ddx = player.cx - e.cx, ddy = player.cy - e.cy;
        const dd = Math.hypot(ddx, ddy) || 1;
        const bub = spawnPart(game, e, 371);
        if (bub) {
          bub.x = e.cx + (ddx / dd) * ((e.w + 20) / 2) - bub.w / 2;
          // NewNPC(X,Y) 是 Bottom 锚(NPC.cs:81600 center=Y−h/2)——曾按中心语义写
          // −h/2 → 泡泡整体低 h/2=18px(红蓝对抗 R2-F4 校正)
          bub.y = e.cy + (ddy / dd) * ((e.w + 20) / 2) + 45 - bub.h;
        }
        // :49612 每吐一颗播 PlaySound(4,…,19)=NPC_Killed_19(case4=死音库)
        game.playSfxWav?.('NPC_Killed_19', 1, e.cx, e.cy);
      }
      const s = Math.sign(player.cx - e.cx) || st.dir;
      st.dir = s; st.spr = -s;
      e.ai2 += 1;
      if (e.ai2 >= DUKE.bubbleT) { e.ai0 = 0; e.ai1 = 0; e.ai2 = 0; }
      break;
    }
    case 3: dukeSharknado(e, game, player, st, false); break;          // :49638-49660
    case 4: { // 一→二阶段变身(:49661-49679)
      invuln = true;
      e.vx *= 0.98;
      e.vy = lerp(e.vy, 0, 0.02);
      if (e.ai2 === DUKE.p1T - 60) game.playSfxWav?.('Zombie_20', 1, e.cx, e.cy);   // :49668 PlaySound(29,…,20)(曾借 roar 0.9)
      e.ai2 += 1;
      if (e.ai2 >= DUKE.p1T) { e.ai0 = 5; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0; }
      break;
    }
    case 5: { // 二阶段悬浮(:49680-49811)
      if (player.dead) break;
      dukeHover(e, player, hoverAcc, hoverSpd, 300, st);
      e.ai2 += 1;
      if (e.ai2 >= hoverT) {
        // flag2(:49300)：expert(大师也算,Main.expertMode)且血 ≤15%——三段狂暴变身门
        const flag2 = mainExpertMode(game.world) && e.hp <= e.maxHp * 0.15;
        const next = dukePick2(e, enraged, flag2);
        if (next === 1) dukeCharge(e, player, chargeSpd, 6, st);
        else if (next === 2) { // 旋转泡泡冲刺起手(:49782-49797):20 速直冲
          const dx = player.cx - e.cx, dy = player.cy - e.cy;
          const d = Math.hypot(dx, dy) || 1;
          e.vx = (dx / d) * DUKE.spinDashSpd;
          e.vy = (dy / d) * DUKE.spinDashSpd;
          e.spin = Math.atan2(e.vy, e.vx);
          const s = Math.sign(dx) || st.dir;
          st.dir = s;
          if (st.spr === 1) e.spin += Math.PI;
          st.spr = -s;
          e.ai0 = 7; e.ai1 = 0; e.ai2 = 0;
        } else if (next === 3) { e.ai0 = 8; e.ai1 = 0; e.ai2 = 0; }
        else if (next === 4) { e.ai0 = 9; e.ai1 = 0; e.ai2 = 0; } // expert
      }
      break;
    }
    case 6: { // 二阶段冲撞(:49812-49834)
      dukeDashDust(e, game);                                // ★BJ310:7×d172 尾流(同态1)
      e.ai2 += 1;
      if (e.ai2 >= chargeT) { e.ai0 = 5; e.ai1 = 0; e.ai2 = 0; e.ai3 += 2; }
      break;
    }
    case 7: { // 旋转泡泡冲刺(:49835-49864)
      if (e.ai2 === 0) game.playSfxWav?.('Zombie_20', 1, e.cx, e.cy);   // :49839 PlaySound(29,…,20)(曾借 roar 0.6)
      if (e.ai2 % DUKE.spinEvery === 0) { // 每 4t 沿垂直方向甩一颗泡泡
        const vlen = Math.hypot(e.vx, e.vy) || 1;
        const bub = spawnPart(game, e, 371);
        game.playSfxWav?.('NPC_Killed_19', 1, e.cx, e.cy);   // :49843 每颗吐音(case4,19)
        if (bub) {
          bub.bInit = true; bub.ai0 = 0; bub.ai1 = 0;          // 预置初速,跳过自初始化
          // :50003 随机 scale——Main.rand.Next(80,121) 整数域 0.80..1.20（★BJ310 续刀
          //  整散化:曾 Math.random()*41 连续域=上限 1.21 且非离散,371 scale=ai3 面可见）
          bub.ai3 = (80 + Math.floor(Math.random() * 41)) / 100;
          bub.x = e.cx + (e.vx / vlen) * ((e.w + 20) / 2) - bub.w / 2;
          bub.y = e.cy + (e.vy / vlen) * ((e.w + 20) / 2) + 45 - bub.h;   // Bottom 锚(同上,R2-F4)
          const ang = Math.atan2(e.vy / vlen, e.vx / vlen) + (Math.PI / 2) * st.dir;
          bub.vx = Math.cos(ang) * DUKE.spinBubbleSpd;
          bub.vy = Math.sin(ang) * DUKE.spinBubbleSpd;
        }
      }
      // 速度/身体同步旋转(-num20*direction,:49854-49855)
      {
        const r = -DUKE_SPIN_RATE * st.dir;
        const cos = Math.cos(r), sin = Math.sin(r);
        const nvx = e.vx * cos - e.vy * sin, nvy = e.vx * sin + e.vy * cos;
        e.vx = nvx; e.vy = nvy;
        e.spin -= DUKE_SPIN_RATE * st.dir;
      }
      e.ai2 += 1;
      if (e.ai2 >= DUKE.spinT) { e.ai0 = 5; e.ai1 = 0; e.ai2 = 0; }
      break;
    }
    case 8: dukeSharknado(e, game, player, st, true); break;           // :49865-49885
    case 9: { // expert 二段狂暴变身(:49886-49931;经典不可达,保留供 expert 接线)
      invuln = true;
      // 嵌块半隐钳 [0,150](1457 :50043-50058;曾 255=全隐,红蓝对抗 R2-F3 校正)
      if (e.ai2 < DUKE.p2T - 90) e.spawnAlpha = clamp(e.spawnAlpha + (inSolid(game, e) ? 15 : -15), 0, 150);
      else e.spawnAlpha = Math.min(255, e.spawnAlpha + 4);
      e.vx *= 0.98;
      e.vy = lerp(e.vy, 0, 0.02);
      if (e.ai2 === DUKE.p2T - 60) game.playSfxWav?.('Zombie_20', 1, e.cx, e.cy);   // :49920 PlaySound(29,…,20)(曾借 roar 0.9)
      e.ai2 += 1;
      if (e.ai2 >= DUKE.p2T) { e.ai0 = 10; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0; }
      break;
    }
    case 10: { // expert 狂暴段悬浮(:49932-50018)
      if (player.dead) break;
      e.spawnAlpha = Math.min(255, e.spawnAlpha + 25); // 隐身逼近
      dukeHover(e, player, hoverAcc, hoverSpd, 360, st);
      e.ai2 += 1;
      if (e.ai2 >= hoverT) {
        const a3 = Math.floor(e.ai3);
        const next = (a3 === 0 || a3 === 2 || a3 === 3 || a3 === 5 || a3 === 6 || a3 === 7) ? 1 : 2;
        if (next === 1) dukeCharge(e, player, chargeSpd, 11, st);
        else { e.ai0 = 12; e.ai1 = 0; e.ai2 = 0; }
      }
      break;
    }
    case 11: { // expert 狂暴段冲撞(:50019-50047)
      e.spawnAlpha = Math.max(0, e.spawnAlpha - 25);
      dukeDashDust(e, game);                                // ★BJ310:7×d172 尾流(同态1)
      e.ai2 += 1;
      if (e.ai2 >= chargeT) { e.ai0 = 10; e.ai1 = 0; e.ai2 = 0; e.ai3 += 1; }
      break;
    }
    case 12: { // expert 瞬移爆冲(:50048-50107)
      invuln = true;
      e.spawnAlpha = Math.min(255, e.spawnAlpha + 17);
      e.vx *= 0.98;
      e.vy = lerp(e.vy, 0, 0.02);
      if (e.ai2 === DUKE.teleT / 2) { // :50066-50093 中点瞬移到玩家另一侧
        if (e.ai1 === 0) e.ai1 = 300 * Math.sign(e.cx - player.cx || 1);
        e.x = player.cx - e.ai1 - e.w / 2;
        e.y = player.cy - 200 - e.h / 2;
        // :50075-50091 侧翻补偿:瞬移后 num41=玩家在新身哪侧,direction 重定;
        // spriteDirection != -direction 时 rotation += π(朝向翻转 180°,
        // 2026-08-19 台账 E 补——曾漏 = 瞬移后鱼头朝向不变);(原版 :50078 的
        // ai[2]==0 门在 ai[2]==num15/2 内恒假=死代码,略)
        const s = Math.sign(player.cx - e.cx);
        if (s !== 0) {
          st.dir = s;
          if (st.spr !== -s) e.spin += Math.PI;
          st.spr = -s;
        }
        // 原版瞬移拍无尘(B1-E11③:曾多 14 粒蓝尘,2026-09-03 登记-校正)
        game.playSfxWav?.('Zombie_20', 1, e.cx, e.cy);   // :50064 PlaySound(29,…,20)(曾借 roar 0.6)
      }
      e.ai2 += 1;
      if (e.ai2 >= DUKE.teleT) {
        e.ai0 = 10; e.ai1 = 0; e.ai2 = 0; e.ai3 += 1;
        if (e.ai3 >= 9) e.ai3 = 0;
      }
      break;
    }
    case 13: { // expert 狂暴段旋转冲刺(:50108-50125;不吐泡泡)
      if (e.ai2 === 0) game.playSfxWav?.('Zombie_20', 1, e.cx, e.cy);   // :50112 PlaySound(29,…,20)(曾借 roar 0.6)
      {
        const r = -DUKE_SPIN_RATE * st.dir;
        const cos = Math.cos(r), sin = Math.sin(r);
        const nvx = e.vx * cos - e.vy * sin, nvy = e.vx * sin + e.vy * cos;
        e.vx = nvx; e.vy = nvy;
        e.spin -= DUKE_SPIN_RATE * st.dir;
      }
      e.ai2 += 1;
      if (e.ai2 >= DUKE.spinT) { e.ai0 = 10; e.ai1 = 0; e.ai2 = 0; e.ai3 += 1; }
      break;
    }
    default: break;
  }
  // ★台账①(2026-08-31):猪鲨无敌真旗标。原版 AI_069 尾句每 tick 双向赋值
  // `dontTakeDamage = !flag7`(1458 NPC.cs:50278;flag7 初值 true :49398,态 -1/:49519、
  // 4/:49815、9/:50040、12/:50202 置 false ⇒ 这四态无敌)——出生/变身/瞬移段单发弹
  // 直伤白嫖窗(iframes=2 近似被 hurt 的 pierce!==1 豁免绕过)就此闭合;非四态每拍
  // 显式清旗(可受击),受击免疫帧仍由 Enemy.hurt 通用通道承担。
  e.dontTakeDamage = invuln;
  e.facing = st.spr;
  e.x += e.vx;
  e.y += e.vy;
  dukeFindFrame(e); // FindFrame case 370(:72824-72917)——AI 后逐 tick,customFrameIdx 直读
}

/** 鲨鱼龙卷(状态 3 :49638-49660 / 状态 8 :49865-49885 共用):
 *  减速悬停,ai2==60(nadoT-30)时发射龙卷水弹 proj 385(伤害 0 的落地生成器)——
 *  小龙卷两发斜落(±dir*2, 8)、克苏龙卷一发原地(0,0,ai0=1=追踪型,ai2=狂暴旗)。
 *  落地/近身 50px 后由弹体自身 Kill 生成 384/386 龙卷,龙卷逐段向上生长并周期
 *  NewNPC 372/373 鲨鱼(见 DukeSharknadoBolt / DukeSharknadoTornado)。 */
function dukeSharknado(e: Enemy, game: GameHooks, player: Player, st: DukeX, big: boolean) {
  e.vx *= 0.98;
  e.vy = lerp(e.vy, 0, 0.02);
  if (e.ai2 === DUKE.nadoT - 30) {
    if (big) {
      // :49871 大龙卷 = PlaySound(29,…,20) Zombie_20 满响(曾借 roar 0.7)
      game.playSfxWav?.('Zombie_20', 1, e.cx, e.cy);
      // 状态 8:克苏龙卷弹(:49873-49876;ai2=flag6 狂暴→追踪速度 +12)
      addProj(game, new DukeSharknadoBolt(e.cx, e.cy, 0, 0, true, dukeEnraged(game, player), e, player));
    } else {
      // :49644 小龙卷 = PlaySound(29,…,9) Zombie_9 满响
      game.playSfxWav?.('Zombie_9', 1, e.cx, e.cy);
      // 状态 3:左右两发斜落(:49646-49651;vector8 = rotation·(dir,0)·(w+20)/2 偏移)
      const ox = Math.cos(e.spin) * st.dir * (e.w + 20) / 2;
      addProj(game, new DukeSharknadoBolt(e.cx + ox, e.cy, st.dir * 2, 8, false, false, e));
      addProj(game, new DukeSharknadoBolt(e.cx + ox, e.cy, -st.dir * 2, 8, false, false, e));
    }
  }
  e.ai2 += 1;
  if (e.ai2 >= DUKE.nadoT) { e.ai0 = big ? 5 : 0; e.ai1 = 0; e.ai2 = 0; }
}

/** 投射桶入桶辅助(同 bossAI.addProj;类在本文件内,避免跨模块构造注入) */
function addProj(game: GameHooks, p: Entity): void {
  (game as unknown as { entities: { add: (e: Entity, b: string) => void } }).entities.add(p, 'projectiles');
}

// ---------------------------------------------------------------------------
// 龙卷水弹 385(Projectile.cs:28402-28482 AI / :70714-70778 Kill 落龙卷)
// ---------------------------------------------------------------------------
// aiStyle 65:ai1==0(状态 3 小弹)→ vy 余弦摆动斜落,撞块/入水/超时 Kill;
//  ai1>0(状态 8 克苏弹)→ 追踪玩家,速 4(+12 狂暴)+age/20,贴身 50px Kill。
//  Kill:小弹原地落 384 鲨鱼龙卷(伤 40);大弹自弹体 tile 向下扫描 100 格落 386
//  克苏龙卷(伤 80)——龙卷接触伤另按原版 hostile ×2 规则结算(Projectile.cs:13781)。
/** v6 联机弹体打包元数据（Boss 锚定弹体族共用形状，Game.netProjBroadcast 消费） */
export interface NetProjMeta {
  kind: number;        // msg27 kind（5-8）
  tag: string;         // 锚参数打包（各类自定义，≤32 字符）
  aux: number;         // i16 辅助通道
  dmg: number;         // 快照 dmg 字段
  /** 可选：以 vx/vy 通道携带的角度方向（重建端 atan2 还原） */
  exVx?: number;
  exVy?: number;
}

export class DukeSharknadoBolt extends Entity {
  w = 30; h = 30; // SetDefaults 385
  private vx0: number;
  private vy0: number;
  private big: boolean;
  private enraged: boolean;
  /** 小弹 vy 摆动相位(原版 ai[0]) */
  private phase = 0;
  private age = 0;
  /** 绘制态（AI_065 :30023-30035/:30055-30067 两支同款）：localAI[0]>10 后
   *  α−5/substep 钳 100、rotation += v.X×0.1、frame=(localAI[0]/3)%3。
   *  projFrames[385]=3(Main.cs:8652)；贴图 68×204 帧高 68 */
  private visAlpha = 255;     // SetDefaults :4684 alpha=255
  private rotDraw = 0;
  private aiFrame = 0;
  life = 300; // SetDefaults timeLeft
  /** 鲨鱼生成所需的 Duke 引用(spawnPart 位置供体,实际落点由龙卷覆写) */
  private src: Enemy;
  /** 冻结追踪目标(原版 ai[1]=target+1,NPC.cs:49875 出弹瞬冻结;v6 重建端无此参
   *  =undefined → 回退 src.targetRef→本地玩家,同访客端旧行为) */
  private tgt: Player | null;
  dead = false;
  /** ★BJ294 敌射侧拒割位：385 SetDefaults hostile（P.cs:4684）→ 原版 CutTiles 调用点
   *  `friendly && owner==myPlayer…`（:12515）整支不进。详 Entity.ts 中央门 BJ294 注。 */
  noVanillaCut = true;

  // ---- ★通用湿段（Projectile.cs:16903-17113 全体弹共用段,projWetSection.ts 共享体
  //  1:1;溅花尘/音由共享体 wetSplashStepShared 承载,本类不自写）----
  //  豁免核对：385 SetDefaults P.cs:4678-4686（30×30/aiStyle 65/hostile/penetrate −1/
  //  alpha 255/timeLeft 300）【无】ignoreWater 行 → 受段（384/386 龙卷兄弟段
  //  :4672/:4694 才有 ignoreWater=true;数据面 PROJ_IGNORE_WATER 亦无 385）。
  //  阻尼适用：tileCollide 缺省 true（无覆写行）→ HandleMovement 湿支
  //  :17721-17764 跑（wetVelocity = velocity×0.5/0.25/0.375,UpdatePosition :20557
  //  `if (wet) position += wetVelocity` 消费）;aiStyle 65 不在 UpdatePosition 早退表
  //  （:20551）。速度场（vx0/vy0）不减,只削当拍位移（干态档=1 数值恒等）。
  //  位序 = 原版 Update:AI_065（读上拍 wet 旗——:30078 AI 内 `if (wet)` 水面 Kill 支
  //  消费上子步旗）→ 本湿段 → 位移。extraUpdates 缺省 0（SetDefaults 无行）→
  //  1 子步/拍,AI 读"上一拍"旗:入水拍置旗+阻尼位移,次拍 AI 抬 16px Kill。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112 逐子步 −1） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892——fixedUpdate 头显式前置,
   *  早于首拍 AI 湿旗消费;共享体段内预置同位同值,置位后自动跳过） */
  presetDone = false;

  constructor(x: number, y: number, vx: number, vy: number, big: boolean, enraged: boolean, src: Enemy,
    tgt?: Player | null) {
    super();
    this.x = x - this.w / 2;
    this.y = y - this.h / 2;
    this.vx0 = vx; this.vy0 = vy;
    this.big = big; this.enraged = enraged;
    this.src = src;
    this.tgt = tgt ?? null;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (--this.life <= 0) { this.kill(game); return; }
    // ★NewProjectile 出生预置（P.cs:10886-10892,spawn 时、首次 Update AI 之前）：
    //  wet = 出生盒 WetCollision（ignoreWater 反清 :10888-10890——385 无此行不反清）、
    //  honey/shimmer 随 Collision 静态;lavaWet【不】预置（首拍湿段 :16906 粘滞并入,
    //  原版同序,段内置位跳过预置后仍照常跑）。385 AI 尾支 `if (wet)`（:30078）消费
    //  此旗 → 原版水面出生首拍即 Kill;共享体段内预置在湿段首调（AI 之后）才跑,
    //  时点晚一拍 → 此处显式前置。
    if (!this.presetDone) {
      this.presetDone = true;
      const rP = wetCollision(game.world.store, this.x, this.y, this.w, this.h);
      this.wet = rP.wet;                               // :10887
      if (rP.honey) this.honeyWet = true;              // :10891
      if (rP.shimmer) this.shimmerWet = true;          // :10892
    }
    this.age++;
    // 绘制态推进（AI_065 :30023-30035 追踪支 / :30055-30067 摆动支同款）：
    // localAI[0]>10 后 α−5 钳 100、rotation += v.X×0.1、frame=(localAI[0]/3)%3
    if (this.age > 10) {
      this.visAlpha = Math.max(100, this.visAlpha - 5);
      this.rotDraw += this.vx0 * 0.1;
      this.aiFrame = Math.floor(this.age / 3) % 3;
    }
    // 追踪目标 = 出弹瞬冻结的公爵索敌目标(原版 Main.player[ai[1]-1],Projectile.cs
    // :28405-28447;ai[1]=target+1 由 NPC.cs:49875 NewProjectile 冻结)——M11 索敌链。
    // 傀儡重建(访客端)无 tgt 无 src → 回退本地玩家(目标不同步,数据链限制)
    const p = this.tgt ?? this.src?.targetRef(game) ?? game.player;
    if (this.big) {
      // :28405-28447 追踪:速 4(+12 狂暴)+localAI[0]/20,距玩家 <50px 即 Kill
      if (p && !p.dead) {
        const dx = p.cx - this.cx, dy = p.cy - this.cy;
        const d = Math.hypot(dx, dy) || 1;
        const spd = 4 + (this.enraged ? 12 : 0) + this.age / 20;
        this.vx0 = (dx / d) * spd;
        this.vy0 = (dy / d) * spd;
        if (d < 50) { this.kill(game); return; }
      }
    } else {
      // :28448-28475 vy 余弦摆动:vy += (cos(π/15·θₙ₊₁) − cos(π/15·θₙ))·4
      const f = (t: number) => (Math.cos((Math.PI / 15) * t) - 0.5) * 4;
      const d0 = f(this.phase);
      this.phase += 1;
      this.vy0 += f(this.phase) - d0;
    }
    // ---- AI_065 尾支（:30078-30082,aiStyle65 块末、大小两支共用）----
    // `if (wet) { position.Y -= 16; Kill(); }`——原版 Update 内 AI（:16880）先于
    // 湿段（:16892）→ 此处读的 wet = 上一拍湿段/出生预置所留旗（extraUpdates=0 →
    // 1 子步/拍,"上子步"=上一拍）。入水拍：本支 wet=false 不 Kill → 湿段置旗 +
    // 位移 ×0.5;次拍：本支见旗 → 抬 16px 后 Kill（Kill 拍序 = 入水后一拍,与
    // 原版逐值同相——旧中心格液面近似=入水当拍 Kill,提前一拍,已废）。
    // ★不 return:原版 Kill 后同拍湿段/HandleMovement 照跑（!active 门在
    //  HandleMovement 后 :17126,湿段 :16892 无门）→ 浅触水 Kill 拍在抬高 16px 的
    //  探针位走"出水溅花"面（wetCount==0 门,10 粒+Splash_1）;幂等由 kill() 头
    //  `if (dead) return`（原版 Kill :71763 `if (!active) return`）承载。
    if (this.wet) { this.y -= 16; this.kill(game); }
    // ---- ★通用湿段（:16903-17113,projWetSection 共享体 1:1）----
    // 位序 = 原版 Update:AI_065（上支消费上拍 wet 旗）→ 本段 → HandleMovement。
    // 溅花尘/音由共享体调 wetSplashStepShared（弹面 10 粒四液逐值注在彼处）,本类
    // 不自写。出生预置已上提至 fixedUpdate 头（见彼注）。
    // ★projId 传字面 385:本类刻意不设 projId 字段（Game.ts:3042 快照收集器
    //  `projId !== undefined` 通判会抢 kind1 武器族,压掉本类 netProjMeta kind5
    //  分支——InfernoHostileBlast 同款规避）。
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      385, !!projectileData(385)?.ignoreWater);
    // 水中位移阻尼（HandleMovement :17721-17764 + UpdatePosition :20557-20562）
    // ——tileCollide=true 宿主:速度场（vx0/vy0）不减只削当拍位移,干态档=1 恒等。
    // 入水拍即 ×0.5（本拍湿段置旗在先,原版 UpdatePosition `if (wet)` 同拍消费）。
    const df = projWaterDragFactor(this);
    this.x += this.vx0 * df;
    this.y += this.vy0 * df;
    // tileCollide 撞块 Kill(原版 HandleMovement TileCollision 命中即 Kill;中心格
    // 近似为既有既批面,不在本登记内)
    const st = game.world.store;
    const tx = Math.floor(this.cx / TILE), ty = Math.floor(this.cy / TILE);
    if (st.inBounds(tx, ty) && st.isSolid(tx, ty)) { this.kill(game); return; }
  }

  /** Kill(:70714-70778):尘环 + 落龙卷(小 384 / 大 386 向下扫描地面)。
   *  v6 联机傀儡:运动/消亡本地自算(确定性),但不落龙卷——房主的龙卷经 kind6 同步,
   *  双端各自生成会重复 */
  private kill(game: GameHooks): void {
    if (this.dead) return;   // 原版 Kill :71763 `if (!active) return`——Kill 拍湿段/撞块面照跑时防双龙卷/双音
    this.dead = true;
    game.spawnParticles(this.cx, this.cy, '#7FB8E8', 10, 2.4, { life: 24, damp: 0.94 });
    // :70716 弹 385 落地 = PlaySound(4,…,19) = NPC_Killed_19(case4=死音库,2026-08-19 终审补)
    game.playSfxWav?.('NPC_Killed_19', 1, this.cx, this.cy);
    if (this.netPuppet) return;
    if (this.big) {
      // :70752-70770 自弹体 tile 向下扫 100 格,落点 = 首个实心/液体格上沿 -24px
      const st = game.world.store;
      let tx = clamp(Math.floor(this.cx / TILE), 10, st.w - 10);
      let ty = clamp(Math.floor(this.cy / TILE), 10, st.h - 110);
      let ground = ty + 15;
      for (let y = ty; y < ty + 100; y++) {
        if (st.inBounds(tx, y) && (st.isSolid(tx, y) || st.liquid[st.idx(tx, y)] !== 0)) { ground = y; break; }
      }
      addProj(game, new DukeSharknadoTornado(tx * TILE + 8, ground * TILE - 24, true, this.src));
    } else {
      // :70733-70737 原地落 384(中心反向偏移 direction*30, y-4)
      const dir = Math.sign(this.vx0) || 1;
      addProj(game, new DukeSharknadoTornado(this.cx - dir * 30, this.cy - 4, false, this.src));
    }
  }

  /** v6 联机打包：kind=5，tag=big 标记（访客重建后本地跑确定性运动，见 kill 傀儡门禁）。
   *  终审 M1：速度经 exVx/exVy 通道携带（本类运动用私有 vx0/vy0，Entity.vx/vy 恒 0——
   *  不补则访客重建的小弹水平静止原地摆到寿终） */
  netProjMeta(): NetProjMeta {
    return { kind: 5, tag: this.big ? '1' : '0', aux: 0, dmg: 0, exVx: this.vx0, exVy: this.vy0 };
  }

  /** 绘制保真（2026-08-31 平涂扫描批）：弹 385 贴图在盘（Projectile_385.png 68×204×3
   *  帧）——旧 #8FD8FF fillStyle 圆点退役，转 drawImage 帧切片。
   *  原版 = type==385 专支(Main.cs:34878-34897)：帧窗 H/projFrames[385]、
   *  origin=贴图中心、rotation、proj.scale=1；body 颜色 GetAlpha(light) 缺省尾
   *  (P.cs:81509) rgb×(255−α)/255——α 半透明按 GetAlpha 系数近似为 globalAlpha
   *  （CoinPortalProj :41 同仓口径）。oldPos[4] 插值运动尾迹段(:34884-34893)需
   *  TrailCacheLength 轨迹缓存登记不接；追踪支 d172 尘环×6/substep(AI_065
   *  :30018-30033,AI 域债非本批)同批登记。 */
  draw(r: Renderer, _cam: Camera): void {
    void _cam;
    const ctx = r.ctx;
    if (!ctx) return;
    const img = projSprite(385);
    ctx.save();
    if (img && img.width > 0) {
      const fh = img.height / projFrameCount(385);       // H/3（Main.cs:34879）
      ctx.translate(this.cx, this.cy);
      ctx.rotate(this.rotDraw);
      ctx.imageSmoothingEnabled = false;
      // GetAlpha(rgb×(255−α)/255) 单系数口径；A 支(newColor.A−alpha)并入同系数
      ctx.globalAlpha = Math.max(0, Math.min(1, (255 - this.visAlpha) / 255));
      ctx.drawImage(img, 0, this.aiFrame * fh, img.width, fh,
        -img.width / 2, -fh / 2, img.width, fh);         // origin=中心(:34895)
    } else {
      // 兜底(贴图懒加载未就绪;projSprite 失败带 10s TTL 自愈):近似色点
      // ★P0-B 零上传兜底：arc 路径 op 在 acc 态=逐帧栅格化+上传——solid
      //   fillRect quad 同位同径替形（decode 直译零上传）
      ctx.fillStyle = '#8FD8FF';
      ctx.fillRect(this.cx - 6, this.cy - 6, 12, 12);
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// 鲨鱼龙卷 384 / 克苏龙卷 386(Projectile.cs:28287-28398,aiStyle 64)
// ---------------------------------------------------------------------------
// 原版是"父段 ai0 倒计时到 1 → 在正上方生成子段(ai0=10, ai1-1)直至 ai1=0"的投射物塔;
// 本实现以单实体模拟该塔:列顶随段生长上移,鲨鱼在"新段出现且 ai1 % 出鲨模 == 0"时
// 于列顶 NewNPC(小 384:模 4 → 3 只/塔;大 386:模 2 → 12 只/塔,ai2=幅宽 ai3=-1.5)。
// 接触伤害:小 40 / 大 80(经典 NewProjectile 值),命中按原版 hostile 弹 ×2 规则(:13781)。
export class DukeSharknadoTornado extends Entity {
  private big: boolean;
  private ai0: number;   // 段生长倒计时(父段 16,子段 10)
  private ai1: number;   // 剩余段数(小 15 / 大 24)
  private ai1Start: number;
  /** 列顶中心 y(鲨鱼生成点/绘制塔顶) */
  private topY: number;
  private segs = 0;      // 已生长段数
  private age = 0;
  private alpha = 255;   // 原版 alpha(实体内嵌 SolidCollision 逐渐显形)
  life: number;          // timeLeft 小 540 / 大 840
  private src: Enemy;
  /** ★BJ710-C：发射者旗追踪键（Duke Fishron 无旗 → 恒 null 零行为；构造期自 src
   *  冻结，接线保直调站门序单源）。null=未冻结。 */
  bannerNpcId: number | null = null;
  dead = false;
  /** ★BJ294 敌射侧拒割位：384/386 SetDefaults hostile（P.cs:4666-75/:4688-97）→ 原版
   *  CutTiles 调用点 friendly 门（:12515）整支不进。详 Entity.ts 中央门 BJ294 注。 */
  noVanillaCut = true;

  // ---- ★通用湿段（Projectile.cs:16903-17113,projWetSection.ts 共享体 1:1）----
  //  豁免核对（双 id）：384 Sharknado SetDefaults P.cs:4666-4675 ignoreWater=true
  //  【:4672】/ 386 Cthulunado P.cs:4688-4697 ignoreWater=true【:4694】→ 两档全豁免
  //  （数据面 PROJ_IGNORE_WATER 亦含 384/386）→ 段门恒闭（:16903）= 原版零行为
  //  （字段照加、段照调,豁免分流由 ignoreWater 参数自动承载;projId 传字面——本类
  //  无 projId 字段,防 Game.ts:3042 快照通判抢 kind1,同 DukeSharknadoBolt 注）。
  //  阻尼不适用（双证）：①豁免;②aiStyle 64 tileCollide=false（:4671/:4693）→
  //  HandleMovement 湿阻尼支 :17721-17764 不进,且位移全由 AI 段生长/摇摆直写
  //  （resize/topY/x 摇摆),velocity 不积分（aiStyle 64 不在 UpdatePosition 早退表
  //  :20551,但 wet 分支 position += wetVelocity = AI 前快照——本类 AI 后无 velocity
  //  位移面可乘）。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价） */
  presetDone = false;

  constructor(x: number, y: number, big: boolean, src: Enemy) {
    super();
    this.big = big;
    this.ai0 = 16;                       // NewProjectile ai0
    this.ai1 = big ? 24 : 15;            // NewProjectile ai1
    this.ai1Start = this.ai1;
    this.topY = y;
    this.life = big ? 840 : 540;         // SetDefaults timeLeft
    this.src = src;
    this.bannerNpcId = bannerNpcKeyOf(src);   // ★BJ710-C：发射者旗冻结
    this.x = x; this.y = y;
    this.resize();
  }

  /** 段缩放(aiStyle 64 :28297-28316):小 (25-ai1)/25;大 (32-ai1)*1.5/32 */
  private scaleOf(ai1: number): number {
    return this.big ? (32 - ai1) * 1.5 / 32 : (25 - ai1) / 25;
  }
  private resize(): void {
    const s = this.scaleOf(this.ai1);
    // (int) 截断(B1-E11②:原版 width=(int)(num509·scale)——曾 Math.round=ai1=16 档差 1px)
    this.w = Math.floor(150 * s);        // SetDefaults 150×42 × scale
    this.h = Math.floor(42 * s);
    this.x = this.cx - this.w / 2;
    this.y = this.topY - this.h / 2;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    // ★通用湿段（:16903-17113）——384/386 豁免 id（P.cs:4672/:4694 ignoreWater=true）
    //  → 段门恒闭零行为;插 tick 头与 AI/位移序无观察差（段内唯一可见面=溅花,豁免即恒无）
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.big ? 386 : 384, !!projectileData(this.big ? 386 : 384)?.ignoreWater);
    if (--this.life <= 0) { this.killDust(game); this.dead = true; return; }
    this.age++;
    // alpha(:28336-28360):嵌实体块渐隐,否则向 60(大 100)显形
    const st = game.world.store;
    const inSolidTile = st.inBounds(Math.floor(this.cx / TILE), Math.floor(this.cy / TILE)) && st.isSolid(Math.floor(this.cx / TILE), Math.floor(this.cy / TILE));
    if (inSolidTile) this.alpha = Math.min(150, this.alpha + 30);
    else this.alpha = Math.max(this.big ? 100 : 60, this.alpha - 30);

    if (this.ai0 > 0) this.ai0--;
    if (this.ai0 === 1 && this.ai1 > 0) {
      // :28363-28390 子段落点:列顶再上移 (42·sP + 42·sC)/2 − 2
      const sP = this.scaleOf(this.ai1), sC = this.scaleOf(this.ai1 - 1);
      this.topY -= (42 * sP) / 2 + (42 * sC) / 2 - 2;
      // 出鲨(:28372-28385):ai1 % 模 == 0 且 ai1≠0 → NewNPC 372/373 于列顶。
      // v6 傀儡不出鲨——房主的鲨鱼经 msg23 同步,双端各出会翻倍
      const mod = this.big ? 2 : 4;
      if (!this.netPuppet && this.ai1 % mod === 0 && this.ai1 !== 0) {
        const shark = spawnPart(game, this.src, this.big ? 373 : 372);
        if (shark) {
          shark.x = this.cx - shark.w / 2;
          // NewNPC Bottom 锚(NPC.cs:81600,Projectile.cs:29986 center4)=中心 topY−h/2
          // ——曾按中心语义写 −h/2 → 鲨中心低 12px(红蓝对抗 R1-F4,sP/sC≡num511 亲推证)
          shark.y = this.topY - shark.h;
          shark.vx = this.vx; shark.vy = this.vy; // Main.npc.velocity = 弹体速度
          shark.bInit = false;                    // 由 sharkronAI 按 ai2/ai3 初始化
          shark.ai2 = this.big ? this.w : 0;      // 373 横游幅宽(:28382)
          shark.ai3 = this.big ? -1.5 : 0;        // 373 升速(:28383)
        }
      }
      this.ai1 -= 1;
      this.ai0 = 10;
      this.segs += 1;
      this.resize();
    }
    if (this.ai0 <= 0 && this.ai1 <= 0) {
      // :28392-28398 停止生长后横向摇摆(cos(π/30·−ai0) − 0.5)·幅宽
      const amp = (this.w / 5) * (this.big ? 2 : 1);
      const f = (t: number) => (Math.cos((Math.PI / 30) * t) - 0.5) * amp;
      this.x -= f(-this.ai0) * -1;
      this.ai0 -= 1;
      this.x += f(-this.ai0) * -1;
    }

    // 接触伤害(hostile 弹 ×2 规则,Projectile.cs:13781:小 40→80 / 大 80→160)
    // 判定盒 = 整列(基座→列顶),宽取当前最宽段(= this.w,列顶段)
    // ★victim-settles:恒查本地玩家(damagePlayer 只结算本地血;kind6 傀儡在访客
    //  端本地重建各查各的 game.player)——非索敌残留,勿改 targetRef
    const p = game.player;
    if (p && !p.dead) {
      const halfW = this.w / 2;
      const colTop = Math.min(this.topY, this.cy);
      const colH = Math.abs(this.cy - this.topY) + this.h;
      if (Math.abs(p.cx - this.cx) < halfW + p.w / 2 && Math.abs(p.cy - (colTop + colH / 2)) < colH / 2 + p.h / 2) {
        // 弹幕命中：attacker 仅做死亡归因，contactOnly 缺省 false → 荆棘不反伤
        // （反伤只在 NPC 接触分支 Player.cs:30910-30944）
        // ★伤害链定谳（2026-08-21）：龙卷由 SharknadoBolt 385 Kill 弹生弹
        //  （Projectile.cs :4919 段）——基础值生成处难度分支：小 384 =
        //  expertMode?25:40、大 386 = expertMode?50:80；命中走 Damage_EVP
        //  （:13770-13781）= hostileProjectileDamage 乘区（旅程0.5/经典1/专家2/
        //  大师3）× 通用敌弹 ×2 → 旅程 40/80、经典 80/160、专家 100/200、
        //  大师 150/300。曾烤死经典终值 80/160 = 专家/大师低伤、旅程双倍伤
        const base = this.big
          ? (mainExpertMode(game.world) ? 50 : 80)
          : (mainExpertMode(game.world) ? 25 : 40);
        game.damagePlayer(
          evpDirectDmg(game, damageVar(base, -p.luck), this.bannerNpcId),   // ★BJ710-C：banner→缩放→×2 门序单源
          this.cx, this.cy, this.src,
          // ★红队 R1-F2 修正(2026-10-13):本伤=Damage_EVP 弹幕语义(上方定谳注),
          //  attacker 仅死亡归因——projDomain 旗防错域进 modifyHurtByNpc 接触链
          //  ★D3 清偿(2026-10-13):projVid 接 modifyHitPlayerByProj 弹域倍率链
          //  (龙卷列=384 小/386 大,Sharknado aiStyle 64;385=零伤落地生成器)
          false, false, true, { projDomain: true, projVid: this.big ? 386 : 384 });
      }
    }
  }

  /** v6 联机打包：kind=6，tag=`${big},${剩余段数ai1},${段倒计时ai0}`。
   *  近似收紧②：携带生长状态——中途入视野的龙卷按快照段盒+段数确定性恢复
   *  （topY = 快照y + 当前段半高,与房主同公式）,不再从零重长 */
  netProjMeta() {
    return { kind: 6, tag: `${this.big ? 1 : 0},${this.ai1},${this.ai0}`, aux: 0, dmg: 0 };
  }

  /** v6 近似收紧②：访客重建时由快照段盒 + ai1/ai0 恢复生长态。
   *  topY 与 ai1 是确定性函数关系（resize: y = topY − h(ai1)/2），故由
   *  snapY 反解即可精确对齐房主当前态（含列顶位置,判定盒不再错位） */
  netStateSync(ai1: number, ai0: number, snapX: number, snapY: number): void {
    if (!Number.isFinite(ai1) || ai1 < 0 || ai1 > this.ai1Start) return; // 非法态保持新建
    this.ai1 = ai1;
    this.ai0 = Number.isFinite(ai0) ? ai0 : 10;
    this.segs = this.ai1Start - ai1;
    // 帧相位重建（BJ299）：age 仅贴图帧消费,由 (segs, ai0) 反解与房主同相——
    // 根段 ai0=16−age;子段 ai0=10−(age−s_k),s_k=15+9(k−1)（sway 支无条件 −1,
    // 与生长段同线性,负 ai0 亦成立）。segs=0 → age=16−ai0;segs≥1 →
    // age=15+9(segs−1)+10−ai0。ai0 缺省 10（旧宿主无此参）=列顶初生拍近似。
    this.age = this.segs === 0 ? 16 - this.ai0 : 15 + 9 * (this.segs - 1) + 10 - this.ai0;
    this.resize();
    this.x = snapX;                    // cx = snapX + w/2,resize 后 x = cx − w/2 = snapX
    this.topY = snapY + this.h / 2;    // 反解列顶（y = topY − h/2 的逆）
    this.y = snapY;
  }

  /** 段中心链（BJ299）：cy[k] = 段 k 中心 y（k=0 基座 … k=segs 列顶=this.cy）。
   *  生成公式反演（P.cs:29958-29968 子中心 = 父中心 − 42(sP+sC)/2 + 2）→ 往下
   *  逐段 centerY_k = centerY_{k+1} + 42·(s_k + s_{k+1})/2 − 2（段间重叠 2px,
   *  塔顶到基座累计 2·segs px——旧画法连续堆叠缺此重叠,整塔偏矮）。 */
  private segCenterYs(): number[] {
    const cy: number[] = new Array(this.segs + 1);
    cy[this.segs] = this.cy;
    for (let k = this.segs - 1; k >= 0; k--) {
      const sTop = this.scaleOf(Math.max(0, this.ai1Start - k - 1));
      const sCur = this.scaleOf(Math.max(0, this.ai1Start - k));
      cy[k] = cy[k + 1] + (42 * (sTop + sCur)) / 2 - 2;
    }
    return cy;
  }

  /** Kill 尘（BJ299;P.cs:75381-75390）：20 × d212（vx = direction·2——direction
   *  链定谳恒 1,见 draw 注;vy=0;α=100;scale=1.4;色 CornflowerBlue(100,149,237)
   *  → lerp White 0.3 = (146,180,242);noGravity=true）。原版=各段弹幕随自身
   *  timeLeft 底→顶逐段消散、各自盒 20 颗;本仓单实体整塔同拍亡 → 20 颗散布
   *  整列盒（单实体近似,登记;基座段宽 < 列顶 → 盒宽取列顶最宽段）。 */
  private killDust(game: GameHooks): void {
    if (!game.spawnDust) return;
    const cy = this.segCenterYs();
    const s0 = this.scaleOf(Math.max(0, this.ai1Start));
    const colTop = this.y;
    const colH = Math.max(4, cy[0] + (42 * s0) / 2 - colTop);
    for (let k = 0; k < 20; k++) {
      game.spawnDust(this.x, colTop, this.w, colH, 212, 2, 0, 100,
        { r: 146, g: 180, b: 242, a: 255 }, 1.4, true);
    }
  }

  /** 绘制（BJ299 定谳刀,替换 2026-08-31"贴图未解包"占位柱——贴图早已在盘
   *  Projectile_384/386.png 162×264×6 帧）：原版 384/386 每段=独立弹幕走专支
   *  （Main.cs:32580-32589）——帧窗 H/projFrames=44px（projFrames 384/386=6,
   *  Main.cs:8651/8653）、origin=帧中心、scale=段缩放、rotation=0（AI 不写）、
   *  色=GetAlpha(projectileColor) 缺省尾 rgb×(255−α)/255（P.cs:81509 →
   *  globalAlpha 系数,385 同仓口径）。翻转=1:1 无:通用 dir 仅 spriteDirection==−1
   *  才 FlipHorizontally（Main.cs:30525-30529）,而龙卷 spriteDirection 恒 1——
   *  direction 链:Entity.cs:20 缺省 1、NewProjectile 不写、385 aiStyle65 不写 →
   *  小塔出生 vx=(−1)×0.01（P.cs:75191）经 AI :29903 `direction=(spriteDirection=
   *  −Sign(vx))` 反号仍 1;大塔 vx=0（:75228）不进该支,SetDefaults :752 复位 1。
   *  段账:段 k（0=基座）生成拍 s_k=15+9(k−1)（根段 ai0=16 :75191/:75228;子段
   *  ai0=10 :29970,==1 时生成下段=9 拍/段）;帧每 3 拍进 1 mod 6（:29908-29916）→
   *  frame_k = ⌊(age−s_k)/3⌋ mod 6。层序=DrawProjectiles index 升序（:22396 区）
   *  → 基座先画、列顶后画。
   *  ★登记债（AI 域既有近似,牵动命中盒/kind6 同步,非本批）:sway 逐段化（原版
   *  每段 ai0≤0 后独立摆,amp=各段宽/5、386 ×2,:29926-29943;本仓整塔刚性、
   *  仅生长完后以顶段相位摆）。 */
  draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const id = this.big ? 386 : 384;
    const img = projSprite(id);
    ctx.save();
    if (img && img.width > 0) {
      const fh = img.height / projFrameCount(id);        // 264/6=44（Main.cs:32582）
      ctx.imageSmoothingEnabled = false;
      // GetAlpha(rgb×(255−α)/255) 单系数口径（P.cs:81509;385 draw 同款）
      ctx.globalAlpha = Math.max(0, Math.min(1, (255 - this.alpha) / 255));
      const cy = this.segCenterYs();
      for (let k = 0; k <= this.segs; k++) {             // 基座先画、列顶后画
        const s = this.scaleOf(Math.max(0, this.ai1Start - k));
        const s_k = k === 0 ? 0 : 15 + 9 * (k - 1);
        const frame = Math.floor(Math.max(0, this.age - s_k) / 3) % 6;
        const dw = img.width * s, dh = fh * s;
        ctx.drawImage(img, 0, frame * fh, img.width, fh,
          this.cx - dw / 2, cy[k] - dh / 2, dw, dh);     // origin=帧中心(:32588)
      }
    } else {
      // 兜底(贴图懒加载未就绪;projSprite 失败带 10s TTL 自愈):占位柱降级保留
      ctx.globalAlpha = 1 - this.alpha / 255;
      const cy = this.segCenterYs();
      for (let k = 0; k <= this.segs; k++) {
        const s = this.scaleOf(Math.max(0, this.ai1Start - k));
        const sh = 42 * s;
        ctx.fillStyle = k % 2 ? '#9FD4F0' : '#7FB8E8';
        ctx.fillRect(this.cx - (150 * s) / 2, cy[k] - sh / 2, 150 * s, sh);
      }
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// 鲨鱼 NPC aiStyle 71(NPC 372 Sharkron / 373,1457 NPC.cs:35284-35405 / 1456 :35196-35328)
// ---------------------------------------------------------------------------
// ai0=0:ai3 升速垂直蓄力 90t(dontTakeDamage;373 另带 ai2 幅宽余弦横游+渐显);
// 期满 ai0=1 → 16 速直扑玩家;ai0=1:渐显(−60/t)、撞实心块即死、60t 后恢复重力。
// ★行号约定:下文注释 ≰:35328 者为 1456 系锚,1457 真位 ≈ +88(红蓝对抗 F5 登记全块)。
export function sharkronAI(e: Enemy, game: GameHooks, player: Player | null): void {
  if (!e.bInit) {
    e.bInit = true;
    e.ai0 = 0; e.ai1 = 0;
    e.spawnAlpha = 255; e.alphaFade = false; // 渐显由本 AI 按 :35228/:35267 驱动
    e.sharkronSdir = -1;                     // :6522 字段缺省 -1(NewNPC 不复位)
  }
  // :35200-35205 玩家失效 → TargetClosest(faceTarget:false)+direction=1 重瞄,
  // AI 照常运转(原版对尸位坐标继续扑,不消散——曾 dead=true 即散 = 存续断裂,
  // 2026-08-19 台账 E 修;本仓单玩家无处重瞄 → 置 direction=1、维持现速滑行)
  if (!player || player.dead) {
    e.facing = 1;
    player = null;
  }
  const RISE_T = 90; // num1077
  if (e.ai0 === 0) {
    // ★台账①:升空蓄力段真旗标(:35300 每 tick 置位)——iframes 近似被单发弹绕过。
    // 原版无"每拍清旗"(dash 支内自行解除),受阻蓄势窗持续无敌
    e.dontTakeDamage = true;
    // :35211-35212 蓄力段只写 velocity.Y=ai[3];velocity.X 不动(继承龙卷弹初速——
    // 静旋龙卷出生速度 (0,0),曾画蛇添足清零=语义漂移,2026-09-03 批4 校正)
    e.vy = e.ai3;               // velocity.Y = ai[3](:35212)
    if (e.vanillaId === 373) {
      e.spawnAlpha = Math.max(0, e.spawnAlpha - 6); // :35228 渐显
      // :35213-35227 蓄力段横游+摆头(373 专有)。原版序:ai[1]++(:35210)→ 摆头
      // 余弦两次读 l1(增前/增后):x += [f(l1)−f(l1−1)]·(−direction),f=cos(π/30·l1)
      // −0.5 乘 ai2 幅宽;|cos−0.5|>0.25 时 spriteDirection 按 cos 符号重写
      // (cos≥0.5→−1 / 否则 1);rotation = vy·spriteDirection·0.1 钳 ±0.2——
      // ★direction(AI 字段,本仓 facing)与 spriteDirection(渲染字段,本仓
      // sharkronSdir)是两个字段:摆头只写后者,横游乘子恒用前者(2026-09-03 批4:
      // 曾用 -facing 代位 spriteDirection=摆头翻转与倾斜耦合错误)
      const kk = Math.PI / 30;
      const l1 = e.ai1 + 1;                      // 本 tick 的 l1 终值(:35210 先 ++)
      const cos = Math.cos(kk * l1) - 0.5;       // :35216-35218 增后读数
      if (e.ai2 > 0) {
        const prev = (Math.cos(kk * (l1 - 1)) - 0.5) * e.ai2;
        e.x += (cos * e.ai2 - prev) * -e.facing;  // :35214-35219 位移差(−direction)
      }
      if (Math.abs(cos) > 0.25) e.sharkronSdir = cos >= 0 ? -1 : 1;  // :35219-35221
      e.spin = clamp(e.vy * e.sharkronSdir * 0.1, -0.2, 0.2);        // :35222-35227
    }
    e.ai1 += 1;
    if (e.ai1 >= RISE_T) {
      // :35242-35261 蓄力期满:16 速扑咬(撞块内则 ai1=0 延后起扑);
      // :35250 PlaySound(4,…,19)=**NPCKilled** style19(case4=死音库!曾误用
      // NPC_Hit_19 错库,2026-08-19 终审修)
      e.ai0 = 1;
      e.ai1 = inSolid(game, e) ? 0 : 1;
      game.playSfxFiles?.(['NPC_Killed_19'], 1, e.cx, e.cy);
      if (player) {
        const dx = player.cx - e.cx, dy = player.cy - e.cy;
        const d = Math.hypot(dx, dy) || 1;
        e.vx = (dx / d) * 16;
        e.vy = (dy / d) * 16;
        e.facing = dx < 0 ? -1 : 1;
        // ★rotation 与 flip 并存（红蓝对抗 R1-F1/B1-D1 三方实锤,2026-09-03 校正）:
        //  原版(1457 :35344-35348)spriteDirection=direction **且** rotation=ToRotation()
        //  +π·[direction==−1]——flip 只补镜像不补 180°,曾误判"裸值+flip"致向左扑咬
        //  整条 180° 错向(贴图原生朝左,左扑应 rot≈2π≡0 正立)。本仓 facing≡direction。
        e.spin = Math.atan2(e.vy, e.vx) + (e.facing < 0 ? Math.PI : 0);
      }
    }
  } else {
    // ai0 === 1(:35264-35316)
    if (e.ai1 < 1 && !inSolid(game, e)) e.ai1 = 1;
    // :35280-35284 入实心块渐显:alpha −= 15、钳 [150,…]——曾写 min(150,+15) 极性反
    // (255 直接跳 150,原版 255→240→…→150 七拍渐显,2026-09-03 批4 校正)
    if (inSolid(game, e)) e.spawnAlpha = Math.max(150, e.spawnAlpha - 15);
    if (e.ai1 >= 1) {
      e.spawnAlpha = Math.max(0, e.spawnAlpha - 60); // :35378 渐显
      // :35381 起扑生效拍解除无敌(1458 `dontTakeDamage = false;`)——蓄势窗
      // (ai0=0 尾+被困延后段)维持升空态的无敌,起扑离块才开始可受击(台账①)
      e.dontTakeDamage = false;
      e.ai1 += 1;
      if (inSolid(game, e)) {
        // :35295-35303 撞墙即死:PlaySound(DeathSound)——372/373 SetDefaults
        // (:13666-13688)DeathSound=NPCDeath1 → NPC_Killed_1
        game.playSfxFiles(['NPC_Killed_1'], 1, e.cx, e.cy);
        e.dead = true;
        return;
      }
    }
    if (e.ai1 >= 60) e.applyGravity(game); // :35395-35398 恢复重力(共享 UpdateNPC_UpdateGravity)
    // :35399-35403 rotation=ToRotation()+π·[direction==−1](与 flip 并存,同上——R1-F1)
    e.spin = Math.atan2(e.vy, e.vx) + (e.facing < 0 ? Math.PI : 0);
  }
  e.x += e.vx;
  e.y += e.vy;
}

/** AI_070 爆裂泡泡(NPC 371,NPC.cs 1458 :35210-35279 / 1456 :35122-35195):
 *  朝玩家漂移(风偏+微上浮),玩家贴近(外扩 40px)或 150t 后进入爆裂态(体积扩到
 *  100×100,dontTakeDamage,4t 后消散)。
 *  ★★1458 行为裁定(2026-08-31 台账②,Claude.md「1458 未触数值面」与反编译冲突,
 *  按仓规取最新版真值)★★:
 *   · 1456 曾在 StrikeNPC 内把每次命中【伤害清零】并立即转引信态(cs:82102-82107)
 *     ——本仓旧档即此语义(Enemy.hurt 内挂同构块);
 *   · 1457/1458 已删该支:命中照常扣血(SetDefaults lifeMax=1 ⇒ 任一实弹命中皆
 *     致命),血尽走 checkDead(NPC.cs:78850-78855 `type==371` 支)→ ai[0]=1/ai[1]=4 +
 *     PrepareForDeathAnimation(life=lifeMax/dontTakeDamage=true/netUpdate);每次命中
 *     另在 StrikeNPC(:85185-85190)播 legacy 死音库 style3 音(「啵」破裂声)、致命拍
 *     撒 60 粒蓝环尘(d212)。aiStyle70 的 `justHit || ai[0]==1` 扩盒支(:35270-35278)
 *     本就存在——非致命擦伤同样进扩盒态(本仓 justHit 分支保留=不再是近似而是真值);
 *   · 引信到期消散 = `life=0; HitEffect(); active=false`(:35262-35268)不走掉落管线,
 *     本仓沿用 dead=true 直出桶。 */
export function dukeBubbleAI(e: Enemy, game: GameHooks, player: Player | null) {
  void game;
  // ai0/ai1 复位先于任何读点(原在 player 门内——无玩家时 ai0 留 -1120 会让
  // :844 `ai0===0` 落空直入爆炸分支 1 tick 即死;2026-08-13 ai0 清查)
  if (!e.bInit) { e.bInit = true; e.ai0 = 0; e.ai1 = 0; }
  // :35226 `scale = ai[3]`(每拍恒等式)——C 条目回归:随机尺寸真实应用到渲染
  if (e.ai3 > 0) e.vanillaScale = e.ai3;
  // checkDead 血尽转换(:78850-78855):先于扩盒判定执行——ai[0]=1/ai[1]=4 +
  // PrepareForDeathAnimation(life=lifeMax/dontTakeDamage=true)。原版时序=
  // StrikeNPC 扣血之后、本 tick NPC.Update 内的 AI 段之前跑转换,故与 justHit 并存。
  // 致命拍尘环 = StrikeNPC 371 支(:85190-85211)60 粒 d212 蓝环(hslToRgb(.4±.2,.9,.5)
  // lerp 白 .3,径向 45..91/10)——2026-09-03 登记账 R1-F2 升精确:60 粒 d212,
  // 位置吸附半径 25·scale 环,速度=前 30 粒随机幅/后 30 粒径向 4.5..9,noGravity
  // scale 0.7。命中破裂音在 Enemy.hurt 的每次 Strike 面(:85185 PlaySound(4,…,3))
  // 承担,此处不重播。
  if (e.hp <= 0) {
    e.ai0 = 1; e.ai1 = 4;
    const r371 = 25 * (e.vanillaScale || 1);
    for (let i = 0; i < 60; i++) {
      const ang = Math.random() * Math.PI * 2;
      const px = e.cx + Math.cos(ang) * r371, py = e.cy + Math.sin(ang) * r371;
      const spd = i < 30 ? Math.random() * 4 : (45 + Math.random() * 46) / 10;
      const h = 0.4 + Math.random() * 0.2;
      const c = 0.9, x = h * 6, sec = Math.floor(x) % 6, f = x - Math.floor(x);
      const p1 = c * (1 - Math.abs(sec % 2 - 1)), mn = 0.05;
      let r0 = 0, g0 = 0, b0 = 0;
      if (sec === 0) { r0 = c; g0 = p1; } else if (sec === 1) { r0 = p1; g0 = c; }
      else if (sec === 2) { g0 = c; b0 = p1; } else if (sec === 3) { g0 = p1; b0 = c; }
      else if (sec === 4) { r0 = p1; b0 = c; } else { r0 = c; b0 = p1; }
      const col = {
        r: Math.round((r0 + mn + (1 - (r0 + mn)) * 0.3) * 255),
        g: Math.round((g0 + mn + (1 - (g0 + mn)) * 0.3) * 255),
        b: Math.round((b0 + mn + (1 - (b0 + mn)) * 0.3) * 255), a: 255,
      };
      game.spawnDust?.(px - 2, py - 2, 4, 4, 212, Math.cos(ang) * spd, Math.sin(ang) * spd,
        100, col, 0.7, true);   // noGravity=1（原版 dust61.noGravity=true）
    }
    e.hp = e.maxHp;
    e.dontTakeDamage = true;
    game.spawnParticles(e.cx, e.cy, '#5AA6D8', 24, 5.5, { life: 26, damp: 0.92 });
  }
  // :35270-35278 命中(justHit 单帧旗标)/已在爆裂态 → 无敌 + 扩盒 100×100 +
  // EncourageDespawn(3)(消散计时由下方 ai1 引信承担)。1458 该支与血尽转换并存:
  // 非致命擦伤同样即刻进入引信态(不再有"吃下伤害继续漂浮"的中间相)
  if (e.ai0 !== 1 && e.justHit) { e.ai0 = 1; e.ai1 = 4; }
  if (e.bInit && player && e.ai3 <= 0) { // :35124-35131 初速 = 朝玩家 ±100px 随机偏移 × 11~17.7 速
    // :35215 随机 scale——Next(80,121) 整数域 0.80..1.20（★BJ310 续刀整散化,同上）
    e.ai3 = (80 + Math.floor(Math.random() * 41)) / 100;
    const jx = e.cx - player.cx + (Math.random() - 0.5) * 200;
    const jy = e.cy - player.cy + (Math.random() - 0.5) * 200;
    const d = Math.hypot(jx, jy) || 1;
    const spd = (165 + Math.random() * 100) / 15;
    e.vx = -(jx / d) * spd;
    e.vy = -(jy / d) * spd;
    e.alphaFade = false;
    e.spawnAlpha = 50; // :35136-35140
  }
  if (player) {
    // :35132-35133 主漂移:v = (v*40 + dir*20)/41
    const dx = player.cx - e.cx, dy = player.cy - e.cy;
    const d = Math.hypot(dx, dy) || 1;
    e.vx = (e.vx * 40 + (dx / d) * 20) / 41;
    e.vy = (e.vy * 40 + (dy / d) * 20) / 41;
  }
  // :35141-35146 风扰+上浮(风取 0)
  e.vx = (e.vx * 50 + (Math.random() - 0.5) * 2) / 51;
  e.vy = (e.vy * 50 - 0.25 + (Math.random() - 0.5) * 4) / 51;
  if (e.vy > 0) e.vy -= 0.04;
  if (e.ai0 === 0 && player) { // :35147-35175 玩家贴近 → 爆炸
    const pad = 40 + e.w / 2;
    if (Math.abs(player.cx - e.cx) < pad + player.w / 2 && Math.abs(player.cy - e.cy) < pad + player.h / 2) {
      e.ai0 = 1; e.ai1 = 4;
    }
  }
  if (e.ai0 === 0) {
    e.ai1 += 1;
    if (e.ai1 >= 150) { e.ai0 = 1; e.ai1 = 4; } // :35167-35175 超时自爆
  } else {
    // 爆炸:体积扩到 100×100(:35187-35193)并 4t 后消散
    if (e.w !== 100) {
      e.x = e.cx - 50; e.y = e.cy - 50;
      e.w = 100; e.h = 100;
      game.spawnParticles(e.cx, e.cy, '#BFE8FF', 8, 2, { life: 20 });
    }
    e.dontTakeDamage = true; // :35273 爆裂态每拍置位（真旗标,台账①面）
    e.ai1 -= 1;
    if (e.ai1 <= 0) { e.dead = true; return; } // :35262-35268 消散不走掉落管线
  }
  e.x += e.vx;
  e.y += e.vy;
}

// ---------------------------------------------------------------------------
// 月亮领主 aiStyle 77 核心(NPC 398,NPC.cs:36774-37198)
// ---------------------------------------------------------------------------
// ai0:-1 出生演出(60t,生成 2×397 手 + 1×396 头)→ 0 一阶段(双手+头存活期间无敌,随玩家悬停)
//   → 1 二阶段(三部件全部闭眼(ai0=-2)后解除无敌,自主追玩家+弹幕循环)
//   → 2 死亡演出(600t 后真死,全族消散)/ 3 玩家全灭离场(60t 后全族清除)。
//   -2:远距(>2400px)传送归位后的短演出。

/** 二阶段弹幕表 = MoonLordAttacksArray2(InitializeMoonLordAttacks2,1457 :6992-7029,
 *  10 槽循环),驱动 NPC 400 真眼(AI_081_TrueEyeOfCthulhu,由部件 checkDead 召出,
 *  见 spawnTrueEye)。1457 起五个悬停槽 90→53(与头部 1200t 循环相位对齐)。
 *  真眼数据/贴图缺失导致 spawn 失败时,攻击主链才折叠到核心上执行兜底。 */
const ML_CORE_P2: ReadonlyArray<readonly [number, number]> = [
  [0, 53], [1, 90], [0, 53], [2, 135], [0, 53], [3, 200], [0, 53], [4, 375], [0, 53], [2, 135],
];

/** 朝玩家发射一发弹幕的通用出口(伤害/弹 id 全部来自原版 NewProjectile 调用点;
 *  2026-08-19 弹道批后无调用方——454 齐射改走 volleyPhantomOrbs,保留为
 *  真眼数据缺失兜底的通用出口位) */
function mlShoot(e: Enemy, game: GameHooks, player: Player, ox: number, oy: number,
  spd: number, dmg: number, projId: number) {
  const dx = player.cx - (e.cx + ox), dy = player.cy - (e.cy + oy);
  const d = Math.hypot(dx, dy) || 1;
  shoot(game, e.cx + ox, e.cy + oy, (dx / d) * spd, (dy / d) * spd, dmg, projId, 600);
}
void mlShoot;

/** checkDead(:78845-78857)+1457 MoonLord_SpawnTrueEyeOfCthulhu(:41562-41583):
 *  手 397 / 头 396 血尽 → ai0=-2 闭眼残肢的同时,于部件中心召 NPC 400 真眼。
 *  1457 重做生成参数：ai[0]=-2（残肢态,表驱动悬停槽接管）、ai[1]=相位对齐值——
 *    num2 = 1200/3 = 400;num3 = 188+400 = 588;num6 = 588+400×已有真眼数;
 *    num7 = (参考ai1 − num6) mod 1200（负则 +1200）。
 *    参考ai1 = 头 396 的 ai[1]（部件为手 397 时 FindFirstNPC(396) 取头部——
 *    手自身 ai[1] 已被 checkDead 清零,头的是攻击循环相位基准）。
 *  ai[3] = 部件的 ai[3](核心 id,游离眼 AI 据此锚定核心) */
function spawnTrueEye(game: GameHooks, part: Enemy): void {
  // CountNPCS(400) 在 NewNPC 之前计（:41564）——本仓 spawnPart 即入桶,先数后召
  const count = (game.enemies() as Enemy[]).filter((n) => !n.dead && n.vanillaId === 400).length;
  const eye = spawnPart(game, part, 400);
  if (!eye) return;
  eye.x = part.cx - eye.w / 2;
  eye.y = part.cy - eye.h / 2;
  const LOOP = 1200;                       // MoonLordHeadAttackTotalLoopTime :6030
  const num2 = Math.trunc(LOOP / 3);       // 400（:41568）
  const num3 = 188 + num2;                 // 588（:41569）
  let ref = part.ai1;
  if (part.vanillaId === 397) {            // :41571-41577 手 → 取头部相位
    const head = (game.enemies() as Enemy[]).find((n) => !n.dead && n.vanillaId === 396);
    if (head) ref = head.ai1;
  }
  let phase = ref - (num3 + num2 * count); // :41578-41580
  phase %= LOOP;
  if (phase < 0) phase += LOOP;
  eye.ai0 = -2;                            // :41583 NewNPC 第 6 参 ai[0]=-2f
  eye.ai1 = phase;                         // 第 7 参 ai[1]=num7 相位
  eye.ai2 = 0;
  eye.ai3 = part.ai3;
}

/** 月噬弹 456（Projectile.cs:5008 SetDefaults + aiStyle 85 :30678-30750）：
 *  16×16 / hostile / 0 伤 / noTileCollide / timeLeft 600。ai[0]>0 出击段：每 tick 朝
 *  玩家 min(16, 距离) 直飞，贴身 <20px 时 AddBuff(145 MoonLeech, 840t/专家 960t)
 *  （:30722-30732，本仓经典模式恒 840t = 14s）；age≥330 或玩家失联 → ai[0] 翻负
 *  回程段：朝 额前(0,+216) 直飞，<20px Kill（吸血视觉闭环）。
 *  弹体自旋角 = (源心 - 玩家心 + (0,216)).ToRotation() + π/2（1458 :32353 / 1456
 *  :30717 稳态式——2026-08-31 台账 C 条目回归,此前用自身速度角近似）。 */
export class MoonLeechProj extends Entity {
  w = 16; h = 16;
  vx = 0; vy = 0;
  private srcId: number;
  private out = true;      // ai[0] 符号：true = 出击 / false = 回程
  private age = 0;         // localAI[0]
  private fed = false;     // localAI[1]（已吸血，不重复授 buff）
  private life = 600;      // timeLeft
  /** 冻结追踪目标（原版 ai[1]=出弹瞬的玩家槽，Projectile.cs:30682-30747 全程
   *  Main.player[ai[1]]——追踪/失联回程/授 buff 三处同一冻结目标） */
  private tgt: Player;
  /** 姿态角（aiStyle85 :32353 每 tick 重算的稳态旋转，见下方注释；C 条目回归：
   *  曾按自身速度角近似——出膛加速相与回程折返相姿态滞后失真） */
  private poseAng = 0;
  dead = false;
  /** ★BJ294 敌射侧拒割位：456 MoonLeech SetDefaults hostile（P.cs:5292）→ 原版
   *  CutTiles 调用点 friendly 门（:12515）整支不进。详 Entity.ts 中央门 BJ294 注。 */
  noVanillaCut = true;

  constructor(src: Enemy, player: Player) {
    super();
    this.srcId = src.id;
    this.tgt = player;
    this.x = src.cx - this.w / 2;
    this.y = src.cy + 216 - this.h / 2;   // 额前 (0,+216)
    const dx = player.cx - this.cx, dy = player.cy - this.cy;
    const d = Math.hypot(dx, dy) || 1;
    this.vx = (dx / d) * 6; this.vy = (dy / d) * 6;   // :37823 出速 6（AI 段接管为 16 上限）
    this.poseAng = this.recalcPose(src);
  }

  /** aiStyle85 稳态旋转公式(P.cs :32353,1458 / :28417 1456 同式):
   *  rotation = (npc.Center − player.Center + vector79).ToRotation() + π/2,
   *  vector79=(0,216)——姿态只由源心↔玩家心的连线决定,与本弹自身位置/相位无关
   *  (出攻击/回程两相同一公式)。玩家死亡后坐标仍可读(原版同取 Main.player 值)。 */
  private recalcPose(src: Enemy): number {
    return Math.atan2(src.cy - this.tgt.cy + 216, src.cx - this.tgt.cx) + Math.PI / 2;
  }

  // ---- ★通用湿段（Projectile.cs:16903-17113,projWetSection.ts 共享体 1:1）----
  //  豁免核对：456 MoonLeech SetDefaults P.cs:5283-5293（16×16/aiStyle 85/hostile/
  //  penetrate −1/alpha 255/timeLeft 600/tileCollide=false）【无】ignoreWater 行 →
  //  受段（数据面 PROJ_IGNORE_WATER 亦无 456）。456 ∉ IsDestroyedByWater 六型、
  //  非 2/34/80/155 → 各特支钩缺省。
  //  阻尼不适用（原版形态锚）：tileCollide=false【:5292】→ HandleMovement 湿阻尼支
  //  :17721-17764 整支不进（湿支嵌 :17585 `if (tileCollide)` 内）,wetVelocity 保持
  //  :16870 的 AI 前 velocity 快照（无阻尼、滞后一子步 quirk,YoyoProj 回收态同款
  //  三分叉先例）→ wet 位移 = AI 前快照 / dry 位移 = post-AI velocity（UpdatePosition
  //  :20557-20562 分叉,aiStyle 85 不在早退表 :20551）。本类 AI 每拍从零重算速度 →
  //  快照 = 上拍末速,湿态即一拍滞后。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价——首拍同位测值） */
  presetDone = false;

  fixedUpdate(_dt: number, game: GameHooks): void {
    const src = (game.enemies() as Enemy[]).find((n) => n.id === this.srcId);
    // :16870 `Vector2 wetVelocity = velocity`（逐子步 AI 前 velocity 快照——456
    //  tileCollide=false,湿态位移消费这份快照,见字段块头注）
    const preVx = this.vx, preVy = this.vy;
    // 目标 = 构造期冻结的月总索敌目标（moonLordHeadAI 分发层 targetRef 传参；
    // 原版 Main.player[ai[1]] 同源冻结）——M11 索敌链。本弹无 netProjMeta（房主
    // 独占），联机目标为访客代理时 buff 施加不上链（引擎级缺口，同 proxy buff 类）
    const player = this.tgt;
    if (--this.life <= 0 || !src || src.dead) { this.dead = true; return; }
    this.poseAng = this.recalcPose(src);   // aiStyle85 :32353 每拍稳态旋转（台账 C 回归）
    if (!player || player.dead) { if (this.out) this.out = false; }   // :30706-30712 玩家失联即回程
    this.age++;
    if (this.age >= 330 && this.out) this.out = false;                // :30702-30705
    // 出击：朝玩家心直飞（:30722-30725）；回程：朝源额前 (0,+216)（:30734-30738）
    const tx = this.out ? player.cx : src.cx;
    const ty = this.out ? player.cy : src.cy + 216;
    const dx = tx - this.cx, dy = ty - this.cy;
    const d = Math.hypot(dx, dy);
    const spd = Math.min(16, d);
    if (d > 0.001) { this.vx = (dx / d) * spd; this.vy = (dy / d) * spd; }
    // ---- ★通用湿段（:16903-17113,projWetSection 共享体 1:1）----
    // 位序 = 原版 Update:AI_085 → 本段 → HandleMovement/UpdatePosition。溅花尘/音
    // 由共享体调 wetSplashStepShared,本类不自写。
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      456, !!projectileData(456)?.ignoreWater);
    // 位移（tileCollide=false :5292 → 湿阻尼支不进）：wet → position += AI 前快照
    // （:16870,无阻尼滞后一子步 quirk）/ dry → post-AI velocity（:20557-20562 分叉）
    if (this.wet) { this.x += preVx; this.y += preVy; }
    else { this.x += this.vx; this.y += this.vy; }
    // 贴身结算：出击段 <20px 授 MoonLeech 145（:30726-30732）；回程段 <20px Kill（:30740-30743）
    if (this.out && d < 20 && !this.fed) {
      this.fed = true;
      player.buffs.apply(BuffType.MoonLeech, 840 / 60);
    } else if (!this.out && d < 20) {
      this.dead = true;
    }
  }

  draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const img = projSprite(456);
    if (!img || !(img.width > 0) || img.width === 0) return;
    // 自旋（:32353 稳态公式，C 条目回归——曾用自身速度角近似出膛/折返相滞后）
    const ang = this.poseAng;
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(ang);
    ctx.imageSmoothingEnabled = false;
    // 多帧行切片（Main.projFrames[456]=4，Main.cs:8490；aiStyle 85 不推帧 → 恒帧 0，
    // 帧格 22×24）。曾整条 22×96 压进 16×16 判定盒 = 胶片条（G11）
    const frames = projFrameCount(456);
    const fh = img.height / frames;
    ctx.drawImage(img, 0, 0, img.width, fh, -img.width / 2, -fh / 2,
      img.width, fh);
    ctx.restore();
  }
}

/** 月噬怪召出(:37828-37842 残肢 / :37975-37989 月噬攻击):头在 lt/inSlot=120/180/240
 *  于玩家处召 NPC 401,ai[0]=头 whoAmI+1 / ai[1]=源弹 456 索引。
 *  原版门禁 = 遍历全部 456 弹,其 ai[1] 指向的玩家 FindBuffIndex(145) != -1 才召
 *  （每弹一只）。本仓单玩家:debuff 145 已由 MoonLeechProj 贴身授予 → 玩家身中
 *  MoonLeech 即召,等价替换旧「弹已射出即命中」无条件近似
 *  (ai[1] 源弹索引以 -1 代,moonLeechAI 以出生点代弹着点,不受影响)。 */
function spawnMoonLeech(game: GameHooks, head: Enemy, player: Player): void {
  if (!player.buffs.moonLeech) return;
  const leech = spawnPart(game, head, 401);
  if (!leech) return;
  leech.x = player.cx - leech.w / 2;
  leech.y = player.cy - leech.h / 2;
  leech.ai0 = head.id + 1;
  leech.ai1 = -1;
  leech.ai2 = 0;
  leech.vx = 0; leech.vy = 0;
}

// ---------------------------------------------------------------------------
// 死亡之光 455 PhantasmalDeathray(Projectile.cs:30291-30549,aiStyle 84)
// ---------------------------------------------------------------------------
// 定轴扫射激光:锚定源 NPC 眼部(头 396 椭圆 (27,59)·睁眼度 / 真眼 400 椭圆 (30,30)),
// 每 tick 转 ai0(=±2π/540),寿命 180t,scale = sin(age·π/180)·10·maxScale 脉冲张合;
// 束长 LaserScan(3 采样,最大 2400)以 0.5/t Lerp 逼近;命中判定 = 玩家矩形 vs
// 「源心 → 源心+dir·束长」线段,线宽 36·scale(Colliding :14673-14682);
// 伤害 = NewProjectile 原值(头 75 / 真眼 50) × 敌弹标准乘区(难度缩放 ×2,
// :13770-13781 Damage_EVP——projTargets.hitPlayer 同式,经典 ×2=150/100、专家 ×4=300/200;
// G8 定谳 2026-08-19:×2 是通用敌弹规则非 iframes 补偿,漏乘难度缩放已修。
// ★台账⑥(2026-08-31):455 免工件独立 BossNoCheese 40t 槽已接线(原版 Damage_EVP
// 按弹型分槽 P.cs:14853-14858/1456 :13710-13720)——束不吃玩家 General 无敌帧、按独立桶
// 节流,跨源穿透(旧"单槽引擎差异备案")就此闭合;接线复用 projTargets
// .damageEvPNoCheese + Player.damage 的 __swNextHitBucket 通道)。
export class MLDeathray extends Entity {
  w = 36; h = 36; // SetDefaults 455
  private srcId: number;
  /** v6 联机：锚定 NPC 的 netId（访客端锚=msg23 傀儡；0=本端真身走 srcId 查找） */
  srcNetId = 0;
  /** 'head' = 396 头眼 / 'core' = 400 真眼(本仓折叠到核心 398) */
  private kind: 'head' | 'core';
  /** 扫射角速度(原版 ai[0] = ±2π/540) */
  private sweep: number;
  /** 当前束角(原版 velocity.ToRotation,每 tick +sweep) */
  private angle: number;
  private age = 0;
  /** 束长 Lerp 值(原版 localAI[1]) */
  private len = 0;
  private dmg: number;
  /** ★BJ710-G35 D4（2026-10-25）：发射者旗追踪键（原版 bannerIdToRespondTo 投影，
   *  ML 头/核心无旗 → 恒 null 零行为；结构对齐 BJ710-C 14 直调站族）。
   *  net 傀儡重建（src=null）→ 无旗面（vanilla msg27 bitsByte28[3] 同步旗,MP 债登记）。 */
  bannerNpcId: number | null = null;
  dead = false;
  /** ★BJ294 敌射侧拒割位：455 PhantasmalDeathray SetDefaults hostile（P.cs:5281）→
   *  原版 CutTiles 调用点 friendly 门（:12515）整支不进。详 Entity.ts 中央门 BJ294 注。 */
  noVanillaCut = true;

  // ---- ★通用湿段（Projectile.cs:16903-17113,projWetSection.ts 共享体 1:1）----
  //  豁免核对：455 PhantasmalDeathray SetDefaults P.cs:5272-5282（36×36/aiStyle 84/
  //  hostile/penetrate −1/alpha 255/timeLeft 600/tileCollide=false）【无】ignoreWater
  //  行 → 受段（数据面 PROJ_IGNORE_WATER 亦无 455;月主姊妹弹 453 才豁免 :5251）。
  //  455 ∉ IsDestroyedByWater 六型、非 2/34/80/155 → 各特支钩缺省。
  //  阻尼不适用（双证）：①aiStyle 84 ∈ UpdatePosition 早退表（:20551 `aiStyle == 84`
  //  → position 不积分,位移全由 AI 锚定写位）;②本类 AI 每 tick 直写 position
  //  （束原点 = 源心 + 眼球椭圆偏移,:30293-30308）,无 velocity 积分宿主。
  //  位序 = 原版 Update:AI（写位）→ 本段 → HandleMovement（无位移面）。溅花尘/音
  //  由共享体 wetSplashStepShared 承载（束体入/出水各溅一次,10 粒四液）。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价） */
  presetDone = false;

  constructor(src: Enemy | null, kind: 'head' | 'core', angle: number, sweep: number, dmg: number, x?: number, y?: number) {
    super();
    this.srcId = src?.id ?? 0;
    this.bannerNpcId = bannerNpcKeyOf(src);   // ★BJ710-G35 D4：发射者旗冻结（ML 无旗=null）
    this.kind = kind;
    this.angle = angle;
    this.sweep = sweep;
    this.dmg = dmg;
    // v6 傀儡重建：src=null 时由调用方传显式坐标（真身路径 src 必非空）
    this.x = (x ?? src!.cx) - this.w / 2;
    this.y = (y ?? src!.cy) - this.h / 2;
  }

  /** v6 联机打包：kind=7，tag=`${srcId},${0|1 数值位（0=head 1=core）}`，aux=扫速×10000，
   *  束角经 vx/vy 通道携带（重建端 atan2 还原后本地扫射——确定性自包含） */
  netProjMeta(): NetProjMeta {
    return {
      kind: 7,
      tag: `${this.srcId},${this.kind === 'head' ? 0 : 1}`,
      aux: Math.max(-32768, Math.min(32767, Math.round(this.sweep * 10000))),
      dmg: this.dmg,
      exVx: Math.cos(this.angle) * 1000,
      exVy: Math.sin(this.angle) * 1000,
    };
  }

  /** scale 上限:头 1.0 / 真眼 0.4(:30468-30478 num728) */
  private get maxScale(): number { return this.kind === 'head' ? 1 : 0.4; }

  fixedUpdate(_dt: number, game: GameHooks): void {
    // 死光出生音：aiStyle84 首帧 PlaySound(29,…,104)=Zombie_104(pcs:30405-30408,
    // ×0.55 档自动;曾整段无声,2026-08-19 终审补)
    if (this.age === 0) game.playSfxWav?.('Zombie_104', 1, this.cx, this.cy);
    // v6 近似收紧①：束角回写——快照把房主实时角度放在 vx/vy 通道（exVx/exVy），
    // 傀儡消费式同步（读后清零防下一 tick 重复回拉振荡）；快照间隙内本地按扫速
    // 自推插值。后台页暂停恢复后由下一快照纠偏（此前只按首帧角自推会永久漂移）
    if (this.netPuppet && (this.vx !== 0 || this.vy !== 0)) {
      this.angle = Math.atan2(this.vy, this.vx);
      this.vx = 0; this.vy = 0;
    }
    // v6 联机：傀儡端按 netId 找锚（msg23 傀儡）；本端真身按本地 id
    const src = this.srcNetId
      ? (game.enemies() as Enemy[]).find((n) => n.netId === this.srcNetId)
      : (game.enemies() as Enemy[]).find((n) => n.id === this.srcId);
    if (!src || src.dead) { this.dead = true; return; }        // 源消亡即 Kill(:30297)
    if (!this.netPuppet && this.kind === 'head' && src.ai0 === -2) { this.dead = true; return; } // :30296 头闭眼残肢（ai0 不同步,傀儡跳过——msg28 兜底）
    this.age++;
    if (this.age >= 180) { this.dead = true; return; }         // :30472 寿命 180t
    this.angle += this.sweep;                                  // :30521 rotation += ai[0]

    // 锚点:束原点 = 源心 + 眼球椭圆偏移(:30293-30308)
    // 头 396 = ellipse((27,59)×localAI[1]) @localAI[0](headX);真眼 400 = ellipse
    // ((30,30)×localAI[1]) @localAI[0]——400 的瞳角/睁眼度已由 moonLordFreeEyeAI
    // 镜像到 lai0/lai1,束角与瞳角逐 t 同步解码步进(:38656-38663)
    const hx = headOf(src);
    const open = this.kind === 'head' ? hx.l1 : src.lai1;
    const eyeA = this.kind === 'head' ? hx.l0 : src.lai0;
    // Projectile.cs:30296-30307:源 396 = Vector2FromElipse(l0,(27,59)×l1)、源 400 = (30,30)×l1
    const [ex, ey] = this.kind === 'head'
      ? mlElipseVec(eyeA, 27 * open, 59 * open)
      : mlElipseVec(eyeA, 30 * open, 30 * open);
    this.x = src.cx + ex - this.w / 2;
    this.y = src.cy + ey - this.h / 2;

    // ---- ★通用湿段（:16903-17113,projWetSection 共享体 1:1）----
    // 位序 = 原版 Update:AI_084（束原点锚定写位）→ 本段 → HandleMovement（aiStyle 84
    // 早退,无位移面）。测位 = 本拍锚定位（原版 post-AI 同位;段后束长/尘均不改位）。
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      455, !!projectileData(455)?.ignoreWater);

    // 束长:LaserScan 3 采样(线宽 36·scale,最大 2400)均值,:30483-30509
    const scale = Math.min(this.maxScale, Math.sin((this.age * Math.PI) / 180) * 10 * this.maxScale);
    const wSq = 36 * scale;
    const dirX = Math.cos(this.angle), dirY = Math.sin(this.angle);
    let amt = 0.5;
    let dist = this.laserScan(game, dirX, dirY, wSq);
    // :30511-30519 头与玩家无视线 → 束长取 距玩家+150(防隔墙盲射)。玩家 =
    // Main.player[nPC13.target]（源头 396 的索敌目标，M11 链 src.targetRef；
    // 傀儡端 targetPlayer 恒 null → 回退本地玩家=旧行为）
    const tp = src.targetRef(game);
    if (this.kind === 'head' && tp && !tp.dead && !losClear(game, this.cx, this.cy, tp.cx, tp.cy)) {
      dist = Math.min(2400, Math.hypot(tp.cx - src.cx, tp.cy - src.cy) + 150);
      amt = 0.75;
    }
    this.len = lerp(this.len, dist, amt);

    // ---- 双尘 229(Vortex 青焰,:30524-30532):束端 Center+dir·(len−14) 沿 ±π/2
    // 侧抛 2-4 速、noGravity scale 1.7;1/5 概率尘 31 烟束(:30533-30540,垂直束向
    // ±width/2 随机偏移、上飘 vy 取负)。粒子系统以定向 spawnBurst 近似色粒。
    const tipX = this.cx + dirX * (this.len - 14), tipY = this.cy + dirY * (this.len - 14);
    for (let k = 0; k < 2; k++) {
      const da = this.angle + (Math.random() < 0.5 ? -1 : 1) * (Math.PI / 2);
      game.spawnBurst?.(tipX, tipY, '#5FE8D0', 1, Math.random() * 2 + 2, da, 0, { life: 30, damp: 0.96 });
    }
    if (Math.random() < 0.2) {
      const off = (Math.random() - 0.5) * 36;          // :30535 偏移幅 = width(非 ×scale)
      game.spawnBurst?.(tipX - dirY * off, tipY + dirX * off, '#C8D0D8', 1, 1.5, -Math.PI / 2, 0.3, { life: 40, damp: 0.97 });
    }
    // ---- 束光 CastLight(:30541-30543):PlotTileLine(Center → Center+dir·len,
    // width·scale) 三线带(中心 ±width/2 垂直偏移线,逐格)投 (0.3,0.65,0.7)
    {
      const half = wSq / 2;
      for (let d = 0; d <= this.len; d += TILE) {
        game.addLightAt?.(this.cx + dirX * d, this.cy + dirY * d, 0.3, 0.65, 0.7);
        game.addLightAt?.(this.cx + dirX * d - dirY * half, this.cy + dirY * d + dirX * half, 0.3, 0.65, 0.7);
        game.addLightAt?.(this.cx + dirX * d + dirY * half, this.cy + dirY * d - dirX * half, 0.3, 0.65, 0.7);
      }
    }

    // 命中:玩家矩形 vs 束线段(线宽 36·scale)。
    // 弹幕命中：attacker 仅做死亡归因，contactOnly 缺省 false → 荆棘不反伤
    // （反伤只在 NPC 接触分支 Player.cs:30910-30944）
    // 伤害 = NewProjectile 原值 75/50 × 敌弹标准乘区（hostileDamageScaling ×2，
    // Projectile.cs:13770-13781 Damage_EVP——projTargets.hitPlayer 同式内联；
    // ★G8 定谳 2026-08-19：×2 是 :13781 通用敌弹规则【非】iframes 补偿）
    // ★台账⑥(2026-08-31)：455 命中改走 BossNoCheese 独立免工件槽（Damage_EVP 分槽
    // 表 P.cs:14853-14858 / projTargets.DAMAGE_EVP_NO_CHEESE_PROJS 接线）——
    // 不吃玩家 General 无敌帧、按独立 40t 桶节流（桶写面在 Player.damage 内）；
    // 桶表缺失(纯单测)由 damageEvPNoCheese 回退直连。
    // ★victim-settles：命中判定恒本地玩家（damagePlayer 只结算本地血；kind7 傀儡
    //  在访客端本地重建各查各的 game.player）——与上方 LOS 钳制的索敌目标分离
    const p = game.player;
    // ★R23b-K3 修:1458 Colliding 有 20t 武装延迟(Projectile.cs:16078-16081
    // `num44=20; if (localAI[0] < num44) return false;`)——束体出生前 20t 无敌不判伤,
    // 发射瞬间贴脸即吃束曾变相加强死光
    if (this.age < 20) return;
    if (p && !p.dead && segHitsRect(this.cx, this.cy, dirX * this.len, dirY * this.len, wSq, p)) {
      // ★BJ710-G35 D4（2026-10-25）：内联缩放退场 → evpDirectDmg 门序单源（banner→
      //  缩放→×2,与 BJ710-C 14 站同源;ML 无旗=数值逐位不变）+ 弹域双旗点亮
      //  （projDomain+projVid 455 → Game.damagePlayer :44690 mod 修正链,旧缺=静默
      //  no-op——BJ704-R3 P1 同款病;BossNoCheese 桶语义不变,opts 经
      //  damageEvPNoCheese 第 6 参透传）。
      damageEvPNoCheese(
        game,
        evpDirectDmg(game, damageVar(this.dmg, -p.luck), this.bannerNpcId),
        this.cx, this.cy, src,
        { projDomain: true, projVid: 455 });
    }
  }

  /** Collision.LaserScan 近似:垂直束向 ±半宽 3 条采样线,8px 步进至首实心块 */
  private laserScan(game: GameHooks, dirX: number, dirY: number, width: number): number {
    const px = -dirY, py = dirX; // 垂直束向
    let sum = 0;
    for (let k = -1; k <= 1; k++) {
      const off = (k * width) / 2;
      const ox = this.cx + px * off, oy = this.cy + py * off;
      const steps = Math.ceil(2400 / 8);
      let d = 2400;
      for (let i = 1; i <= steps; i++) {
        const t = i * 8;
        const tx = Math.floor((ox + dirX * t) / TILE), ty = Math.floor((oy + dirY * t) / TILE);
        const st = game.world.store;
        if (!st.inBounds(tx, ty)) { d = t - 8; break; }
        if (st.isSolid(tx, ty)) { d = t - 8; break; }
      }
      sum += d;
    }
    return sum / 3;
  }

  draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const scale = Math.min(this.maxScale, Math.sin((this.age * Math.PI) / 180) * 10 * this.maxScale);
    if (scale <= 0.01 || this.len <= 1) return;
    // 原版三件套(Main.cs:31951-31992):炮口 Projectile_455(origin 尺寸/2)→
    // 束身 Extra_21 五帧行平铺(行 = timeLeft/3%5 起、16px 段沿束向逐段 +16 滚动、
    // 越 96 回 0、尾段按余量截高,origin (w/2,0))→ 端帽 Extra_22(origin (0,0))。
    // 颜色 (255,255,255,0)×0.9 = XNA 预乘混色下的加性白光 → canvas lighter 近似;
    // 绘制角 = 束角 − π/2(Projectile.cs:30483 rotation = num731 − π/2,纹理竖排)。
    const muzzle = projSprite(455);
    const ex21 = r.atlas?.ensureVImage?.('vanilla/Extra_21.png') ?? null;
    const ex22 = r.atlas?.ensureVImage?.('vanilla/Extra_22.png') ?? null;
    if (!muzzle || muzzle.width === 0 || !ex21 || !ex22 || ex21.width === 0 || ex22.width === 0) {
      // 贴图未就绪兜底(懒加载首帧):旧自绘紫矩形,加载完成后自愈
      const thick = Math.max(2, 36 * scale);
      ctx.save();
      ctx.globalAlpha = clamp(scale * 1.6, 0.25, 1);
      ctx.translate(this.cx, this.cy);
      ctx.rotate(this.angle);
      ctx.fillStyle = '#B040D0';
      ctx.fillRect(0, -thick / 2, this.len, thick);
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.9;
    ctx.imageSmoothingEnabled = false;
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.angle - Math.PI / 2);
    // 炮口(:31961)
    ctx.drawImage(muzzle, -muzzle.width / 2, -muzzle.height / 2,
      muzzle.width * scale, muzzle.height * scale);
    // 束身(:31966-31986):有效长 = len −(炮口半高 + 端帽高)·scale,自炮口前沿
    // (局部 +y = 束向)逐段 16px·scale 平铺
    const remain = this.len - (muzzle.height / 2 + ex22.height) * scale;
    let adv = 0;
    let sy = 16 * (Math.floor((600 - this.age) / 3) % 5);   // 行 = timeLeft/3%5
    const startY = (muzzle.height / 2) * scale;
    while (adv + 1 < remain) {
      let h = 16;
      if (remain - adv < h) h = remain - adv;
      ctx.drawImage(ex21, 0, sy, ex21.width, h, -ex21.width / 2, startY + adv,
        ex21.width * scale, h * scale);
      adv += h * scale;
      sy += 16;
      if (sy + 16 > ex21.height) sy = 0;                    // 段行滚动回卷
    }
    // 端帽(:31988,origin = (0,0))
    ctx.drawImage(ex22, 0, 0, ex22.width, ex22.height, 0, startY + adv,
      ex22.width * scale, ex22.height * scale);
    ctx.restore();
  }
}

/** 线段 vs AABB(原版 Collision.CheckAABBvLineCollision 语义:线宽胶囊与矩形相交)。
 *  bossAI_dd2 BetsyBreath 喷焰判定共用(2026-08-19 弹道批导出)。 */
export function segHitsRect(x0: number, y0: number, dx: number, dy: number, width: number,
  t: { x: number; y: number; w: number; h: number }): boolean {
  // 最近点参数 t∈[0,1](钳到段内)
  const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
  const len2 = dx * dx + dy * dy || 1;
  let k = ((cx - x0) * dx + (cy - y0) * dy) / len2;
  k = clamp(k, 0, 1);
  const px = x0 + dx * k, py = y0 + dy * k;
  // 最近点到矩形距离(逐轴钳位)
  const nx = clamp(px, t.x, t.x + t.w), ny = clamp(py, t.y, t.y + t.h);
  return Math.hypot(px - nx, py - ny) < width / 2;
}

/** 死亡之光发射出口(原版 :37902-37916 头 / :38625-38637 真眼):
 *  起角 = 朝玩家角 ∓ 60°(num1278 = 玩家在左 +1),角速度 = num1278·2π/540。
 *  返回源 NPC 的扫射编码角初值((起角+3π)·num1278,头部 ai2 逐 t 解码步进用)。 */
function mlDeathray(game: GameHooks, src: Enemy, kind: 'head' | 'core', player: Player, dmg: number): number {
  const dx = player.cx - src.cx, dy = player.cy - src.cy;
  const d = Math.hypot(dx, dy) || 1;
  const n = dx / d < 0 ? 1 : -1;                       // num1278
  const ang = Math.atan2(dy, dx) - n * (TAU / 6);
  addProj(game, new MLDeathray(src, kind, ang, n * (TAU / 540), dmg));
  return (ang + Math.PI * 3) * n;
}

/** 核心悬停移动(:36854-36865 / :36912-36923 同构):目标 = 玩家 + (0,130),8 速/0.5 步进+半程混合 */
function mlCoreHover(e: Enemy, player: Player) {
  const dx = player.cx - e.cx;
  const dy = player.cy + 130 - e.cy;
  if (Math.hypot(dx, dy) > 20) {
    const d = Math.hypot(dx - e.vx, dy - e.vy) || 1;
    flyLerp(e, ((dx - e.vx) / d) * 8, ((dy - e.vy) / d) * 8, 0.5);
  }
}

/** :36934-36952(死亡演出 ai1==60)/:37074-37099(玩家全灭离场 ai1==40)清弹段:
 *  全部 456/462/455/452/454 弹 + NPC 400(原版前者 Kill()/后者 active=false——
 *  本仓统一 dead=true 出桶) */
function mlClearDeathrayProjectiles(game: GameHooks): void {
  const ents = (game as unknown as {
    entities?: { projectiles?: Array<{ dead?: boolean; projId?: number }> };
  }).entities;
  for (const p of ents?.projectiles ?? []) {
    if (p.dead) continue;
    const id = p.projId;
    if (id === 456 || id === 462 || id === 455 || id === 452 || id === 454) p.dead = true;
  }
  for (const n of game.enemies() as Enemy[]) {
    if (!n.dead && n.vanillaId === 400) n.dead = true;
  }
}

export function moonLordCoreAI(e: Enemy, game: GameHooks, player: Player | null) {
  // :36776-36778 1/200 环境吼(PlaySound 29 style Next(93,100) = Zombie_93..99,
  // case29 93-99 文件级 ×0.4 自动档);出生(-1)与死亡演出(2)两态不吼
  if (e.ai0 !== -1 && e.ai0 !== 2 && Math.floor(Math.random() * 200) === 0) {
    game.playSfxWav?.(`Zombie_${93 + Math.floor(Math.random() * 7)}`, 1, e.cx, e.cy);
  }
  if (!e.bInit) { e.bInit = true; e.ai0 = -1; e.ai1 = 0; e.ai2 = 0; e.lai3 = 1; } // :36780-36785（localAI[3]=1 首帧哨兵——MoonLordProgressBar.IsInBadAI 的 type398&&localAI[3]==0 剔除门消费）
  // 原版 checkDead(:78859-78867):血尽 → ai0=2 死亡演出,满血续命 600t 后真死
  // PrepareForDeathAnimation(:78836-78841:life=lifeMax/dontTakeDamage/netUpdate)——
  // ★台账①家族收口:iframes=2 近似退役(pierce===1 转换帧白嫖直伤)
  if (e.hp <= 0 && e.ai0 !== 2) { e.ai0 = 2; e.ai1 = 0; e.hp = e.maxHp; e.dontTakeDamage = true; }

  if (e.ai0 === -2) { // 远距传送归位(1458 :41599-41618 / 1456 :37250 同构)
    // ★台账①:真旗标 dontTakeDamage(:41601)——iframes=2 近似被 pierce===1 单发弹
    // 绕过 = 归位演出期白嫖直伤
    e.dontTakeDamage = true;
    e.ai1 += 1;
    // :36792-36795 ai1==30 PlaySound(29,…,92)=Zombie_92(case29 style92 ×0.5 自动档;
    // 曾整段无声,2026-08-19 渲染断链批补)
    if (e.ai1 === 30) game.playSfxWav?.('Zombie_92', 1, e.cx, e.cy);
    if (e.ai1 >= 60) { e.ai1 = 0; e.ai0 = 0; }
  } else if (e.ai0 === -1) { // 出生演出(1458 :41623-41663)
    e.dontTakeDamage = true;   // ★台账①:真旗标(:41625),同 -2 归位态
    e.ai1 += 1;
    // :36816-36817 ai1==30 PlaySound(29,…,92)(曾误在 >=60 段尾播,2026-08-19 修)
    if (e.ai1 === 30) game.playSfxWav?.('Zombie_92', 1, e.cx, e.cy);
    if (e.ai1 >= 60) {
      e.ai1 = 0; e.ai0 = 0; e.ai2 = 0;
      // 生成双手 397(核心两侧 ±400)与头 396(上方 400);ai3 = 核心 id(锚定)
      for (let i = 0; i < 2; i++) {
        const h = spawnPart(game, e, 397);
        if (h) {
          h.x = e.cx + i * 800 - 400 - h.w / 2;
          h.y = e.cy - 100 - h.h / 2;
          h.ai0 = 0; h.ai1 = 0; h.ai2 = i; h.ai3 = e.id; h.bInit = true;
          h.master = e;   // 层序:部件画本体前(原版槽序 398→397×2→396)
        }
      }
      const hd = spawnPart(game, e, 396);
      if (hd) {
        hd.x = e.cx - hd.w / 2;
        hd.y = e.cy - 400 - hd.h / 2;
        hd.ai0 = 0; hd.ai1 = 0; hd.ai2 = 0; hd.ai3 = e.id; hd.bInit = true;
        hd.master = e;   // 头最后生成=槽序最前(与手同锚核心,插入序保证头居末=最前)
      }
    }
  } else if (e.ai0 === 0 || e.ai0 === 1) {
    // 三部件(锚定本核心)
    const parts = (game.enemies() as Enemy[]).filter(
      (n) => !n.dead && (n.vanillaId === 396 || n.vanillaId === 397) && n.ai3 === e.id);
    if (e.ai0 === 0) {
      e.dontTakeDamage = true; // :41701(★R23b 系统性修:真旗标,iframes 近似被 pierce===1 绕过)
      // 部件缺失 → 核心即毁(:41682-41701 flag:任一 397/396 失效 → life=0 +
      // HitEffect + active=false 直清,**不经 checkDead**——无击败公告/不写
      // downedBoss3/无掉落,与 ai0=3 玩家全灭离场同语义。★bossFled 置位:
      // Game boss 槽以 dead 触发完整击败流程,直写 dead 曾播"月亮领主已被
      // 打败!"+写 downed_398 假通关(生成期部件 spawn 失败即触发;
      // 2026-08-23 蓝队 R1-06 修,同 :1553 ai0=3 分支 2026-08-22 修法)
      if (parts.length < 3) { e.bossFled = true; e.dead = true; return; }
      // 三部件全部闭眼残肢(ai0=-2)→ 解除无敌进二阶段(:36891-36909 flag85)
      if (parts.every((p) => p.ai0 === -2)) { e.ai0 = 1; e.ai1 = 0; }
    }
    if (e.ai0 === 1) {
      // :36913 phase1 分支首句 dontTakeDamage=false——原版每 tick 清无敌。
      // ★曾缺失:phase0 每 tick 置 true 后无人复位 → 三残肢解锁后核心仍永久
      // 无敌(与头部眼睑单向阀同批"只写 true 不复位"类,2026-08-25 用户实报
      // "血量卡 9500 永远打不死"的第二处根因)
      e.dontTakeDamage = false;
    }
    if (player) {
      mlCoreHover(e, player);
      // TargetClosest(faceTarget:false) 的 direction 语义(离场态 vx 目标用)
      e.facing = player.cx > e.cx ? 1 : -1;
    }
    if (e.ai0 === 1 && player) {
      // 原版二阶段核心只悬停(:36912-36923),攻击全部由真眼 400(aiStyle 81)执行;
      // 真眼已由部件 checkDead 召出 → 不再走折叠弹幕(否则双倍)。真眼 spawn 失败
      // (数据缺失)时保留折叠兜底
      const eyes = (game.enemies() as Enemy[]).some(
        (n) => !n.dead && n.vanillaId === 400 && n.ai3 === e.id);
      if (!eyes) {
        e.ai1 += 1;
        mlCoreBarrage(e, game, player); // 二阶段弹幕(真眼主链折叠兜底)
      }
    }
  } else if (e.ai0 === 2) { // 死亡演出(:36925-37064)
    e.dontTakeDamage = true;   // PrepareForDeathAnimation(真旗标,同上)
    // :36928 命名参数陷阱——Lerp(value1: velocity, value2: (0,-0.5), amount: 0.98):
    // 反编译显示参数序颠倒,实语义 = velocity = Lerp(velocity, (0,-0.5), 0.98),
    // 即每 tick 98% 逼近 (0,-0.5)(曾误读 0.02 = 缓飘 50t 才到位)
    e.vx = lerp(e.vx, 0, 0.98);
    e.vy = lerp(e.vy, -0.5, 0.98);
    e.ai1 += 1;
    // :36934-36952 ai1==60 清全部 456/462/455/452/454 弹 + NPC 400(HitEffect 9999)
    if (e.ai1 === 60) mlClearDeathrayProjectiles(game);
    // :36954-37022 每 3t 一簇爆炎(60t<ai1<580);:37049-37051 ai1==1 NPCDeath61
    if (e.ai1 === 1) game.playSfxFiles?.(['NPC_Killed_61'], 1, e.cx, e.cy);
    if (e.ai1 % 3 === 0 && e.ai1 > 60 && e.ai1 < 580) {
      game.spawnParticles(
        e.cx + (Math.random() - 0.5) * 400, e.cy + (Math.random() - 0.5) * 400,
        '#C04030', 6, 3, { life: 30 });
    }
    // :37022-37041 每 15t(90<=ai1<480)周身 20-420px 随机空位掷 proj 622 星屑
    // (SetDefaults :6412-6418:10×10/aiStyle1/extraUpdates2 视觉弹,damage 0 不伤人;
    //  速度 =(0,−rand·0.5−0.5).RotatedBy(±π/8..3π/8)×6——extraUpdates 2 = 每 tick
    //  3 步,Arrow 直飞按 ×3 折算,寿命 23t 对齐 23×MaxUpdates Kill)
    if (e.ai1 % 15 === 0 && e.ai1 >= 90 && e.ai1 < 480) {
      const ang = Math.random() * TAU;
      const dist = 20 + Math.random() * 400;
      const px = e.cx + Math.cos(ang) * dist, py = e.cy + Math.sin(ang) * dist;
      const st = game.world.store;
      const tx6 = Math.floor(px / TILE), ty6 = Math.floor(py / TILE);
      if (st.inBounds(tx6, ty6) && !st.isSolid(tx6, ty6)) {
        const swing = (Math.random() < 0.5 ? -1 : 1) * (Math.PI / 8 + Math.PI / 4 * Math.random());
        const h6 = 6 * (Math.random() * 0.5 + 0.5) * 3;
        shoot(game, px, py, Math.sin(swing) * h6, -Math.cos(swing) * h6, 0, 622, 23, { hostile: false });
      }
    }
    if (e.ai1 >= 600) { // :37053-37063 真死 → life=0+checkDead 走完整 NPCLoot
      // ★须 die() 而非直写 dead——hurt 对 398 放行(血尽转演出),直写=标准
      // 死亡管线永不触发:boss 袋/夜明矿/武器池/白金全部不出(零掉落,终审修)
      e.dontTakeDamage = false;   // 先清无敌旗再走 hurt 管线(die() 内部经 hurt)
      e.die(game);
      return;
    }
  } else if (e.ai0 === 3) { // 玩家全灭离场(:37065-37135)
    e.dontTakeDamage = true;   // 同死亡演出(真旗标)
    // :37068 同款命名参数陷阱:Lerp(velocity, (direction,-0.5), 0.98)——
    // vx 目标 = direction(TargetClosest 持久朝向,由上方 0/1 态持续写入 facing)
    e.vx = lerp(e.vx, e.facing, 0.98);
    e.vy = lerp(e.vy, -0.5, 0.98);
    e.ai1 += 1;
    // :37074-37107 ai1==40 清全部 456/462/455/452/454 弹 + NPC 400(+gore 619-622)
    if (e.ai1 === 40) mlClearDeathrayProjectiles(game);
    if (e.ai1 >= 60) { // :37109-37127 清除全部部件与自身
      // ★离场非击败:原版 active=false 直清不播击败公告/不写 downed 旗
      // (玩家全灭/离场语义)。曾 dead 直写 → Game boss 槽检测 dead 走击败流程
      // = "月亮领主已被打败!"+downed_398 误置位(用户报 F6 召唤即"已被打败",
      // 实为召唤头顶 150px 出生演出期玩家被部件碰撞秒杀 → ai0=3 清族误记账)。
      // bossFled → Game boss 块播 BossFled toast、不写 downed(2026-08-22 修)
      e.bossFled = true;
      for (const n of game.enemies() as Enemy[]) {
        if (!n.dead && (n.vanillaId === 396 || n.vanillaId === 397 || n.vanillaId === 400) && n.ai3 === e.id) n.dead = true;
      }
      e.dead = true;
      return;
    }
  }

  // 玩家全灭 → 离场(:37136-37161)
  if (!player && e.ai0 !== -1 && e.ai0 !== -2 && e.ai0 !== 2 && e.ai0 !== 3) { e.ai0 = 3; e.ai1 = 0; }
  // 玩家远距 >2400px → 全族瞬移归位(:37162-37197)
  if (player && e.ai0 >= 0 && e.ai0 < 2 && Math.hypot(player.cx - e.cx, player.cy - e.cy) > 2400) {
    const dx = player.cx - e.cx;
    const dy = player.cy - 150 - e.cy;
    e.x += dx; e.y += dy;
    for (const n of game.enemies() as Enemy[]) {
      if (!n.dead && (n.vanillaId === 396 || n.vanillaId === 397 || n.vanillaId === 400) && n.ai3 === e.id) {
        n.x += dx; n.y += dy;
      }
    }
    e.ai0 = -2; e.ai1 = 0;
  }

  // ---- 核心帧引擎(FindFrame case 398,1457 NPC.cs:72712-72740)----
  // ai0<=0 恒帧 0(:72714-72717);ai0>0:frameCounter +1、≥30 回卷 6,帧 = fc%30/6
  // (:72731-72738)。burst 门 = frame.Y==0(:72719)——旧刀「一次性哨兵」漏了 6 拍
  // 重复窗与再睁核复爆(定谳见 CoreX 头注,判别测试 tests/bj591-lunar-core-kobold-vfx)。
  // 帧号写 customFrameIdx,Renderer.vanillaFrameIdx 直读。
  const fx = coreOf(e);
  if (e.ai0 > 0) {
    if (fx.frameY0) {
      // :72721-72724 Gore.NewGore(position+(∓10,∓15), velocity, 619..622)
      GorePiece.newGore(619, e.x - 10, e.y - 15, e.vx, e.vy);
      GorePiece.newGore(620, e.x + 10, e.y - 15, e.vx, e.vy);
      GorePiece.newGore(621, e.x - 10, e.y + 15, e.vx, e.vy);
      GorePiece.newGore(622, e.x + 10, e.y + 15, e.vx, e.vy);
      // :72725-72729 Dust 209(月总星尘,品红)×50 盒内随机——本仓粒子替身:
      // VanillaDust 精植表无 209(贴图/物理近似在档),掷门/数量 1:1
      game.spawnParticles(e.cx, e.cy, '#E060D0', 50, 2.5, { life: 34 });
    }
    fx.fc += 1;
    if (fx.fc >= 30) fx.fc = 6;                         // :72732-72734
    const idx = Math.floor((fx.fc % 30) / 6);           // :72736-72738
    e.customFrameIdx = idx;
    fx.frameY0 = idx === 0;                             // 下一拍 burst 门(:72719 frame.Y==0)
  } else {
    e.customFrameIdx = 0;                               // :72716
    fx.frameY0 = true;                                  // :72716 frame.Y = 0(fc 不清,原版同)
  }
  e.x += e.vx;
  e.y += e.vy;
}

/** 核心兜底弹幕的螺旋眼角态(原版真眼 localAI[0]=眼角/ai[2]=角速度;核心折叠用) */
interface MlBarrageX { ang: number; rate: number }
const mlBarrageX = new WeakMap<Enemy, MlBarrageX>();
const mlBarrageOf = (e: Enemy): MlBarrageX => {
  let x = mlBarrageX.get(e);
  if (!x) { x = { ang: 0, rate: 0 }; mlBarrageX.set(e, x); }
  return x;
};

/** 核心二阶段弹幕(原版 NPC 400 真眼攻击链,aiStyle 81 :38243-38600;
 *  攻击号语义按 MoonLordAttacksArray2 槽位(2026-08-19 台账 E 1↔3 归位):
 *  1 = 三连幻影矢 462 35 伤(:38347-38384)——曾误接 452 环射;
 *  3 = 幻影之眼 452 螺旋 35 伤(:38508-38572)——曾误接三连矢;
 *  2 = 幻影能量球 454 40 伤(:38385-38506,近似);
 *  4 = 死亡之光 455(:38580-38637) */
function mlCoreBarrage(e: Enemy, game: GameHooks, player: Player) {
  const { atk, inSlot, dur } = attackSlot(e, ML_CORE_P2);
  switch (atk) {
    case 1: { // 三连幻影矢 462(:38347-38384):dur-35 音,dur-14/-7/末 三发 8 速 35 伤
      const pvx = (player as unknown as { vx: number }).vx ?? 0;
      const pvy = (player as unknown as { vy: number }).vy ?? 0;
      const dx = player.cx + pvx * 20 - e.cx, dy = player.cy + pvy * 20 - e.cy;   // :38359 预判 20t
      const d = Math.hypot(dx, dy) || 1;
      // :38374-38377 PlaySound(4,…,6)=死音库 → NPC_Killed_6(终审修)
      if (inSlot === dur - 35) game.playSfxWav?.('NPC_Killed_6', 1, e.cx, e.cy);
      if (inSlot === dur - 14 || inSlot === dur - 7 || inSlot === dur) {
        // :38378-38382 NewProjectile(462)——出膛口走 shootBolt462(首拍二选一音
        // Item_124/125 + 尘 229,Projectile.cs:56236-56257,工单⑦)
        shootBolt462(game, e.cx, e.cy, dx / d * 8, dy / d * 8, 35);
      }
      break;
    }
    case 2: // 幻影能量球 454(:38385-38506 真眼攻击 2 折叠):ai0=30 直接列队,
      // t==105(:38487-38505)全数置 -1 以瞄准向 12 速齐射(核心折叠的齐射时刻=60)
      if (inSlot === 0) {
        for (let k = 0; k < 3; k++) {
          const ang = -Math.PI / 2 + (k - 1) * 0.6;
          // 出生 ai0=30(真眼弹 NewProjectile 第 9 参,:38452-38457)——跳过随行段
          shoot(game, e.cx, e.cy, Math.cos(ang) * 4, Math.sin(ang) * 4, 40, 454, 600,
            { phantomOrb: { ownerId: e.id, ai0: 30 } });
        }
      } else if (inSlot === 60) {
        const dx = player.cx - e.cx, dy = player.cy - e.cy;
        const d = Math.hypot(dx, dy) || 1;
        volleyPhantomOrbs(game, e.id, (dx / d) * 12, (dy / d) * 12);   // :38493-38505
      }
      break;
    case 3: { // 幻影之眼 452 螺旋(:38508-38572):45..185 眼角自旋(±2π/40,每 40t ×0.95),
      // 每 10t 沿眼角 8 速射一发 452(35 伤,出膛 = 中心 + 眼角方向 ×(30,30)长×0.4≈17px)
      const bx = mlBarrageOf(e);
      if (inSlot >= 45 && inSlot < 185) {
        if (inSlot === 45) bx.rate = (Math.floor(Math.random() * 2) === 0 ? 1 : -1) * (TAU / 40);
        if ((inSlot - 45) % 40 === 0) bx.rate *= 0.95;   // :38540-38543
        bx.ang += bx.rate;
        if ((inSlot - 45) % 10 === 0) {                  // :38554-38559
          const ux = Math.cos(bx.ang), uy = Math.sin(bx.ang);
          // ai[1] = (2π·rand−π)/30 + π/180·ai[2](:38558,ai[2]=螺旋角速度→bx.rate)
          shoot(game, e.cx + ux * 17, e.cy + uy * 17, ux * 8, uy * 8, 35, 452, 600,
            { phantasm: { spin: (TAU * Math.random() - Math.PI) / 30 + (Math.PI / 180) * bx.rate } });
        }
      }
      break;
    }
    case 4: // 死亡之光 455(:38625-38647):inSlot==180 一发定轴扫射激光(NewProjectile 原值 50)
      // 原版此槽 375t:0-179 蓄能尘,180 发束,束体自转 180t 至槽末;真眼瞳角动画随束同步
      // (localAI[0],:38642-38652)——真眼不在本仓范围,锚点用核心中心 (30,30) 椭圆近似
      // 伤害乘区（难度×2）在 MLDeathray 命中时结算（G8 批 2026-08-19 改）
      if (inSlot === 180) { e.ai2 = mlDeathray(game, e, 'core', player, 50); }
      break;
    default: break; // 0 = 闭眼冷却 90t
  }
}

// ---------------------------------------------------------------------------
// 月亮领主 aiStyle 78 手(NPC 397,NPC.cs:37199-37711)
// ---------------------------------------------------------------------------
// 攻击时间表 MoonLordAttacksArray[0, ai2](:6854-6883):
//   ai2=0(左手,side=-1):[闭50, 眼70, 球330, 闭60, 矢90]
//   ai2=1(右手,side=+1):[眼70, 闭50, 矢90, 闭60, 球330]
// 攻击:0 闭眼悬停(无敌)/ 1 眼球环射 452(30 伤)/ 2 能量球扫射 454(40 伤,末段全数转向玩家)
//   / 3 三连幻影矢 462(30 伤,预判 20t)。
// 无敌语义:dontTakeDamage = frame>=21(:37215)——只有攻击中(睁眼)可受击。

/** 手攻击表(MoonLordAttacksArray[0/1],NPC.cs:6938-6962)——Renderer SmolBullet
 *  预警(蓝队 R1-03)按 ai2 选行解码槽内时间,导出共用 */
export const ML_HAND_ATTACKS: Readonly<Record<number, ReadonlyArray<readonly [number, number]>>> = {
  0: [[0, 50], [1, 70], [2, 330], [0, 60], [3, 90]],
  1: [[1, 70], [0, 50], [3, 90], [0, 60], [2, 330]],
};

export function moonLordHandAI(e: Enemy, game: GameHooks, player: Player | null) {
  // 锚定核心;核心缺失/死亡 → 自毁(:37202-37207)
  const core = (game.enemies() as Enemy[]).find((n) => n.id === e.ai3 && n.vanillaId === 398);
  if (!core || core.dead) { e.dead = true; return; }
  // 原版 checkDead(:78845-78857):血尽 → ai0=-2 闭眼残肢(满血续命+无敌)+召真眼 400
  if (e.hp <= 0 && e.ai0 !== -2) {
    // PrepareForDeathAnimation(:78836-78841)——★台账①家族收口:真旗标
    e.ai0 = -2; e.ai1 = 0; e.hp = e.maxHp; e.dontTakeDamage = true;
    spawnTrueEye(game, e);
  }

  const x = handOf(e);
  const side = e.ai2 === 0 ? -1 : 1;  // num1231 :37208-37210
  e.facing = side;                    // spriteDirection

  // 攻击表推进(:37221-37251;ai0=-2 残肢态不参与调度)
  let inSlot = 0, dur = 0;
  if (e.ai0 !== -2) {
    e.ai1 += 1;
    const s = attackSlot(e, ML_HAND_ATTACKS[e.ai2 === 0 ? 0 : 1]);
    e.ai0 = s.atk; // :37245 原版 ai[0] 即攻击号(亦为手部状态)
    inSlot = s.inSlot; dur = s.dur;
  }
  let frameT = 0; // num1234(帧目标=frameT*7)

  if (e.ai0 === -2) { // 闭眼残肢(1458 :42062-42074)
    frameT = 0;
    // ★R23b-K1 修：残肢接触伤 1456=80 → **1458=0**(NPC.cs:42066),摸断手不再白挨触碰伤。
    // 手的 ai[1] 推进在原版整体被 `ai[0] != -2` 门住(:42028)= 残肢期冻结(与头相反),
    // 本分支只保持无敌近似 + 归位悬停。
    e.def.damage = 0;
    e.dontTakeDamage = true;          // ★台账①家族收口(:42068 真旗标,iframes 近似退役)
    handHover(e, core, side);
  } else if (e.ai0 === 0) { // 闭眼悬停(:37281-37303)
    frameT = 3;
    x.l1 = Math.max(0, x.l1 - 0.05);
    handHover(e, core, side);
  } else if (e.ai0 === 1 && player) { // 眼球环射(:37304-37346)
    frameT = 0;
    const cyc = 28; // num1240*num1241 = 7*4
    if (inSlot >= cyc * 2) {
      x.l1 = Math.max(0, x.l1 - 0.07);
    } else if (inSlot >= cyc) {
      x.l1 = Math.min(0.75, x.l1 + 0.05);
      const ang = (TAU * (inSlot % cyc)) / cyc - Math.PI / 2; // :37324
      x.l0 = Math.atan2(Math.sin(ang) * 66, Math.cos(ang) * 30);
      if (inSlot % 4 === 0) handFireEye(e, game, x, side); // :37326-37334 452(30 伤)
    } else {
      x.l1 = Math.min(0.75, x.l1 + 0.02);
      const ang = (TAU * (inSlot % cyc)) / cyc - Math.PI / 2;
      x.l0 = Math.atan2(Math.sin(ang) * 66, Math.cos(ang) * 30);
    }
  } else if (e.ai0 === 2) { // 能量球扫射(:37347-37447)
    const ax = core.cx + 220 * side + side * 100;   // vector168
    const ay = core.cy - 60 - 50;
    const swx = 400 * side, swy = -60;              // vector169
    if (inSlot < 30) {
      handApproach(e, ax, ay, 8, 0.2);
    } else if (inSlot < 210) {
      frameT = 1;
      if ((inSlot - 30) % 30 === 0 && player) { // :37372-37380 每 30t 一发 454(40 伤)
        const k = Math.floor((inSlot - 30) / 30);
        let vx = 5 * side + (k - 3.5) * side * 3;
        let vy = -8 + (k - 4.5);
        vx *= 1.2; vy *= 1.2;
        // 出生 ai0=0(随行 30t → 列队;ai[1]=whoAmI→ownerId,齐射指令圈定用)
        shoot(game, e.cx, e.cy, vx, vy, 40, 454, 600,
          { phantomOrb: { ownerId: e.id, ai0: 0 } });
      }
      const t = smoothAmt((inSlot - 30) / 180);
      handSeek(e, ax + swx * t, ay + swy * t, 20, 0.5); // :37381-37387
    } else if (inSlot < 282) {
      frameT = 0;
      e.vx *= 0.9; e.vy *= 0.9;
    } else if (inSlot < 287) {
      frameT = 1;
      e.vx *= 0.9; e.vy *= 0.9;
    } else if (inSlot < 292) {
      frameT = 2;
      e.vx *= 0.9; e.vy *= 0.9;
    } else if (inSlot < 300) {
      frameT = 3;
      // :37407-37427 num1232==292:本手全部 454(ai0≠-1)置 -1 齐射——统一速度 =
      // normalize(玩家 − (手心+(0,−350)))·12(vector175,全部球同矢量平行冲阵)
      if (inSlot === 292 && player) {
        const dx = player.cx - e.cx, dy = player.cy - (e.cy - 350);
        const d = Math.hypot(dx, dy) || 1;
        volleyPhantomOrbs(game, e.id, (dx / d) * 12, (dy / d) * 12);
      }
      const t = 1 - (inSlot - 270) / 30;
      handSeek(e, ax + swx * smoothAmt(t), ay + swy * smoothAmt(t), 14, 0.1); // :37428-37434
    } else {
      frameT = 3;
      handApproach(e, ax, ay, 8, 0.2); // :37436-37446 归位
    }
  } else if (e.ai0 === 3 && player) { // 三连幻影矢(:37448-37472)
    frameT = 0;
    const pvx = (player as unknown as { vx: number }).vx ?? 0;
    const pvy = (player as unknown as { vy: number }).vy ?? 0;
    const dx = player.cx + pvx * 20 - e.cx, dy = player.cy + pvy * 20 - e.cy; // :37455 预判 20t
    x.l0 = angleLerp(x.l0, Math.atan2(dy, dx), 0.5);
    x.l1 = Math.min(1, x.l1 + 0.05);
    if (inSlot === dur - 35) game.playSfxWav?.('NPC_Killed_6', 1, e.cx, e.cy);   // :37464(组4 死音库,终审修)
    if (inSlot === dur - 14 || inSlot === dur - 7 || inSlot === dur) {
      // :37466-37471 从眼球位置射 462(30 伤,8 速)——出生点 = Vector2FromElipse(l0,(30,66)×l1)
      // 出膛口走 shootBolt462(首拍二选一音 Item_124/125 + 尘 229,:56236-56257,工单⑦)
      const [exx, eyy] = mlElipseVec(x.l0, 30 * x.l1, 66 * x.l1);
      const d = Math.hypot(dx, dy) || 1;
      shootBolt462(game, e.cx + exx, e.cy + eyy, (dx / d) * 8, (dy / d) * 8, 30);
    }
  }

  // 睁闭眼帧推进(:37493-37509):每 tick 向目标帧走 1,dontTakeDamage = frame>=21
  const frameTarget = frameT * 7;
  if (frameTarget > x.frame) x.frame += 1;
  else if (frameTarget < x.frame) x.frame -= 1;
  x.frame = clamp(x.frame, 0, 21);

  // ---- 渲染镜像(Renderer.drawMoonLordHand 直读;蜂后 222 写 lai0 同款先例)----
  // 瞳孔轨道角/睁眼度 → lai0/lai1(原版 localAI[0]/[1],Main.cs:24437-24438 椭圆
  // (30,66)×localAI[1]);手开合帧 frameCounter/7 → customFrameIdx(FindFrame case 397
  // :72644-72648 frame.Y = num·(frameCounter/7),0/7/14/21 四档由攻击态推进)。
  e.lai0 = x.l0;
  e.lai1 = x.l1;
  e.customFrameIdx = Math.floor(x.frame / 7);

  // 位置钳制(:37473-37492):下一位置锁在核心侧上方盒内
  let minX = core.cx + 220 * side + 110 * side, minY = core.cy - 60 - 150;
  let maxX = minX + 370 * side, maxY = minY + 150;
  if (minX > maxX) { const t = minX; minX = maxX; maxX = t; }
  if (minY > maxY) { const t = minY; minY = maxY; maxY = t; }
  const nx = clamp(e.cx + e.vx, minX, maxX);
  const ny = clamp(e.cy + e.vy, minY, maxY);
  e.x = nx - e.w / 2;
  e.y = ny - e.h / 2;

  // 无敌:闭眼(frame>=21)或残肢态。★R23b 系统性修:改真旗标 dontTakeDamage
  // (原版 :42024 每 tick 重算 `dontTakeDamage = frameCounter >= 21f`,残肢支再置 true)
  // ——iframes 免疫门有 pierce!==1 豁免,单发弹(箭/枪弹)会绕过近似直伤无敌期;
  // 可受击时显式清旗,保留 hurt() 的 8t 受击免疫通道
  e.dontTakeDamage = x.frame >= 21 || e.ai0 === -2;
  e.spin = x.l0; // 手部眼球角度(渲染朝向)
}

/** 手部悬停(:37266-37279 / :37289-37302):核心侧上方 (350*side, -100),6 速/0.3 步进+半程混合 */
function handHover(e: Enemy, core: Enemy, side: number) {
  const dx = core.cx + 350 * side - e.cx;
  const dy = core.cy - 100 - e.cy;
  const d = Math.hypot(dx, dy);
  if (d > 20) flyLerp(e, (dx / d) * 6, (dy / d) * 6, 0.3);
}
/** SmoothStep 趋近(:37358-37367 / :37438-37445):velocity = SmoothStep(v, normalize(delta)*min(spd,|delta|), k) */
function handApproach(e: Enemy, tx: number, ty: number, spd: number, k: number) {
  const dx = tx - e.cx, dy = ty - e.cy;
  const d = Math.hypot(dx, dy);
  if (d < 0.01) return;
  const m = Math.min(spd, d);
  e.vx = vSmoothStep(e.vx, (dx / d) * m, k);
  e.vy = vSmoothStep(e.vy, (dy / d) * m, k);
}
/** 扫射段追随(:37381-37387 / :37428-37434):Lerp(v, normalize(delta)*min(spd,|delta|), k) */
function handSeek(e: Enemy, tx: number, ty: number, spd: number, k: number) {
  const dx = tx - e.cx, dy = ty - e.cy;
  const d = Math.hypot(dx, dy);
  if (d < 0.01) return;
  e.vx = lerp(e.vx, (dx / d) * Math.min(spd, d), k);
  e.vy = lerp(e.vy, (dy / d) * Math.min(spd, d), k);
}
/** 眼球环射一发 452(:37326-37334):从眼球椭圆外沿射出,沿眼球朝向 8 速,30 伤;
 *  ai[1] 弧线弯转角 = (2π·rand−π)/30 + π/180·num1231(:37332,side) */
function handFireEye(e: Enemy, game: GameHooks, x: HandX, side: number) {
  // :37329-37332 vector165 = Vector2FromElipse(l0,(30,66)×l1);枪口 = Center +
  // Normalize(vector165)×|(30,66)|×0.4 + (−side,3);弹速 = Normalize(vector165)×8
  const [exx, eyy] = mlElipseVec(x.l0, 30 * x.l1, 66 * x.l1);
  const d = Math.hypot(exx, eyy) || 1;
  const px = e.cx + (exx / d) * 72.51 * 0.4 - side; // |vector159|=√(30²+66²)≈72.51(:37330)
  const py = e.cy + (eyy / d) * 72.51 * 0.4 + 3;
  shoot(game, px, py, (exx / d) * 8, (eyy / d) * 8, 30, 452, 600,
    { phantasm: { spin: (TAU * Math.random() - Math.PI) / 30 + (Math.PI / 180) * side } });
}

// ---------------------------------------------------------------------------
// 月亮领主 aiStyle 79 头(NPC 396,NPC.cs:37712-38128)
// ---------------------------------------------------------------------------
// 恒定悬停在核心正上方 400px(无自主移动);攻击表 MoonLordAttacksArray[0,2](:6874-6883):
//   [矢180, 闭30, 吸血435, 矢180, 光375]。
// 攻击:0 睁眼瞄准(无敌)/ 1 死亡之光 455(75 伤,:37902-37916)/ 2 月噬 456(0 伤,:37957-37973)
//   / 3 三连幻影矢 462(30 伤,:37991-38015)。-2 闭眼残肢(80 接触伤)/ -3 核心死亡后永闭。
// 无敌语义:dontTakeDamage = localAI[3]>=15(:37724)。

/** 头攻击表(MoonLordAttacksArray[2],NPC.cs:6974-6990)——Renderer 预警共用 */
export const ML_HEAD_ATTACKS: ReadonlyArray<readonly [number, number]> = [
  [3, 180], [0, 30], [2, 435], [3, 180], [1, 375],
];

/** 攻击表纯解码（attackSlot 的无副作用版,Main.cs 绘制侧 :25180-25191/:25246-25257/
 *  :25324-25336 同构循环——只读 ai1 定位槽,不回写）。Renderer SmolBullet 预警/
 *  死光蓄能星芒(蓝队 R1-03)消费 */
export function mlSlotDecode(
  ai1: number, table: ReadonlyArray<readonly [number, number]>,
): { atk: number; t: number; dur: number } {
  let consumed = 0;
  let slot = 0;
  for (; slot < table.length; slot++) {
    if (!(table[slot][1] + consumed <= ai1)) break;
    consumed += table[slot][1];
  }
  if (slot >= table.length) slot = table.length - 1;   // 越界取末槽(AI 侧每 tick 回绕,瞬态)
  return { atk: table[slot][0], t: ai1 - consumed, dur: table[slot][1] };
}

export function moonLordHeadAI(e: Enemy, game: GameHooks, player: Player | null) {
  // 类默认 ai0=-1120 会令 `ai0>=0` 攻击表门恒假 = 头部冻结(2026-08-13 ai0 清查;
  // 现网靠父核 :1184 预置 0 挡住,此为入口防御)。放行运行态 -2/-3(闭眼残肢)
  if (e.ai0 < -3) e.ai0 = 0;
  const core = (game.enemies() as Enemy[]).find((n) => n.id === e.ai3 && n.vanillaId === 398);
  if (!core || core.dead) { e.dead = true; return; } // :37714-37719
  // checkDead(:78845-78857)同手:血尽 → ai0=-2 闭眼残肢 + 召真眼 400。
  // 1457 :78856 追加相位槽清理 ai[(type!=396)?1:2]=0——头 396 清 ai[2]、手 397 清
  // ai[1];头的 ai[1] 保留 = 真眼生成相位的基准（spawnTrueEye 读它）
  if (e.hp <= 0 && e.ai0 !== -2 && e.ai0 !== -3) {
    // PrepareForDeathAnimation(:78836-78841)——★台账①家族收口:真旗标
    e.ai0 = -2; e.ai2 = 0; e.hp = e.maxHp; e.dontTakeDamage = true;
    spawnTrueEye(game, e);
  }

  const x = headOf(e);
  e.vx = 0; e.vy = 0; // :37725
  e.x = core.cx - e.w / 2; // :37726 恒定在核心上方 400px
  e.y = core.cy - 400 - e.h / 2;

  // 攻击表推进(1458 :42536-42559)。★R23b-D4 修:`ai[1]++` 与表回卷在原版是
  // 【无条件】执行(:42544 在全部态分支之前),只有 ai[0]=槽攻击号的赋值被
  // `if (ai[0] >= 0f)` 门住(:42553)——残肢期头时钟继续走,后死部件召出的真眼
  // 以「活的」头 ai1 为相位基准(spawnTrueEye num4);曾仅 ai0>=0 推进 → 残肢后
  // 冻结、后续召出的真眼与先召真眼整体错相。
  let inSlot = 0, dur = 0;
  e.ai1 += 1;
  const s = attackSlot(e, ML_HEAD_ATTACKS);
  if (e.ai0 >= 0) {
    e.ai0 = s.atk; // :42558 原版 ai[0] 即攻击号(亦为头部状态)
    inSlot = s.inSlot; dur = s.dur;
  }
  let f2T = 0, f3T = 0; // num1262/num1263(帧目标 = f2T*7 / f3T*5)

  if (e.ai0 === -3) { // 核心死亡后永闭(1458 :42560-42580;由 -2 分支转入 :42583-42587)
    e.def.damage = 0;
    e.spin = lerp(e.spin, Math.PI / 12, 0.07);
    e.ai2 += 1;                                   // :42568 永闭期 ai[2] 时钟(wrap 32)
    if (e.ai2 >= 32) e.ai2 = 0;
    if (x.f2 < 14) x.f2 += 1;                     // localAI[2] < 14（:42576-42579）
    e.dontTakeDamage = true;                      // :42562(真旗标)
    return;
  }
  if (e.ai0 === -2) { // 闭眼残肢(1458 :42581-42600)
    if (core.ai0 === 2) { e.ai0 = -3; return; } // :42583-42587 转入永闭(仅此 tick 跳帧推进)
    // ★R23b-K1/K2 修(1456 残留两处):
    // ①接触伤 1456=80 → **1458=0**(NPC.cs:42589),摸断眼不再白挨触碰伤;
    // ②整段「残肢月噬循环」(ai[2] 555 大循环 + ai2≥120 发 456/召 401,
    //   1456 :37782-37844)已被 1458 删除——1458 本支仅剩 damage=0 +
    //   dontTakeDamage + `ai[2]++ wrap 32`(:42589-42599),月噬只存在于
    //   攻击表槽 2(已实现)。曾保留=断眼期多出一整套吸血相位且 wrap 值不符。
    e.def.damage = 0;
    e.dontTakeDamage = true;                      // :42590(真旗标)
    e.ai2 += 1;
    if (e.ai2 >= 32) e.ai2 = 0;
    // ★原版本分支无 return(后直落帧推进)——曾提前 return 令
    // f2/f3 帧目标(0)永不收敛 = 残肢冻帧(2026-08-19 台账 E 修)
  }

  if (e.ai0 === 0 && player) { // 睁眼瞄准(:37845-37864)
    f3T = 3;
    const dx = player.cx - e.cx, dy = player.cy + 22 - e.cy;
    const d = Math.hypot(dx, dy) || 1;
    x.l0 = Math.atan2(dy, dx);
    x.l1 = Math.min(1, Math.max(0, (1 - Math.min(1, d / 500)) * 2)); // :37850-37860
    x.l2 = lerp(x.l2, 1, 0.2);
  } else if (e.ai0 === 1 && player) { // 死亡之光(:37865-37952)
    if (inSlot < 180) {
      x.l1 = Math.max(0, x.l1 - 0.05);
      if (inSlot >= 60) { // :37876-37898 聚能尘
        game.spawnParticles(
          e.cx + (Math.random() - 0.5) * 27, e.cy + (Math.random() - 0.5) * 59, '#B040C0', 2, 1.2, { life: 24 });
      }
    } else if (inSlot < dur - 15) {
      // :37902-37916 发射 455 死亡之光(NewProjectile 原值 75):起角 ∓60° 预偏,
      // 束体以 ±2π/540 每 t 扫射 180t(束体自转见 MLDeathray);伤害乘区(难度×2)
      // 在 MLDeathray 命中时结算(G8 批 2026-08-19 改)
      if (inSlot === 180) {
        e.ai2 = mlDeathray(game, e, 'head', player, 75); // :37913 扫射编码角初值
        // 原版 NPC 侧死光发射零吼(:37700-37970 无 PlaySound)——曾借 roar 0.8,2026-08-18 对账删
      }
      // :37917-37947 头部瞳角与束体同角速度扫射(ai2 存编码角,逐 t 解码步进)
      if (inSlot >= 180) {
        const n = e.ai2 >= 0 ? 1 : -1; // num1279
        const a = Math.abs(e.ai2) - Math.PI * 3 + n * (TAU / 540);
        x.l0 = a;
        e.ai2 = (a + Math.PI * 3) * n;
      }
      x.l1 = Math.min(1, x.l1 + 0.05);
    } else {
      f3T = 3;
      // :37927-37950 收束段:l1 −0.07/t;跌破 0 的 tick 在 FTW 下于头部中心连射
      // 30 发 1021 弹(伤 70;±15.99 / [−15.99,0) 随机速;逐发门 = 中心格非实心)。
      // 原文先钳 0 再掷,状态尾段仅 ~15t 且 l1 自 1 收束,实际近似每轮死亡之光一发;
      // 逐句照抄(钳后若状态仍延续会连发——原版语义)
      x.l1 -= 0.07;
      if (x.l1 < 0) {
        x.l1 = 0;
        if (game.world.seedFlags?.getGoodWorld) {
          const st = game.world.store;
          const tx = Math.floor(e.cx / TILE), ty = Math.floor(e.cy / TILE);
          if (st.inBounds(tx, ty) && !st.isSolid(tx, ty)) {
            for (let num1281 = 0; num1281 < 30; num1281++) {
              // 1021 aiStyle 25 巨砾物理(:24341-24725):grav 0.06/终端 16/滚动
              // 加速/弹地 Dig 音 + X 反弹 ×−0.75×3 次(:17578-17600);
              // extraUpdates=1 走数据表;life = 默认 300×3=900(原版基 3600×3=
              // 10800,死亡实际由三次反弹限主导,取任务口径 900)
              shoot(game, e.cx, e.cy,
                (Math.floor(Math.random() * 3199) - 1599) * 0.01,
                (Math.floor(Math.random() * 1600) - 1599) * 0.01, 70, 1021, 900,
                { grav: 0.06, mlBoulder: true });
            }
          }
        }
      }
    }
  } else if (e.ai0 === 2) { // 月噬(:37953-37990)
    f2T = 2;
    f3T = 3;
    if (inSlot === 0 && player) { // :37958-37973 额前 216px 朝玩家月噬 456(0 伤,MoonLeechProj)
      addProj(game, new MoonLeechProj(e, player));
    }
    // :37975-37989 inSlot=120/180/240 于玩家处召 401 月噬怪(门禁说明见 spawnMoonLeech)
    if (player && (inSlot === 120 || inSlot === 180 || inSlot === 240)) spawnMoonLeech(game, e, player);
  } else if (e.ai0 === 3 && player) { // 三连幻影矢(:37991-38015)
    const pvx = (player as unknown as { vx: number }).vx ?? 0;
    const pvy = (player as unknown as { vy: number }).vy ?? 0;
    const dx = player.cx + pvx * 20 - e.cx, dy = player.cy + pvy * 20 - e.cy;
    x.l0 = angleLerp(x.l0, Math.atan2(dy, dx), 0.5);
    x.l1 = Math.min(1, x.l1 + 0.05);
    if (inSlot === dur - 35) game.playSfxWav?.('NPC_Killed_6', 1, e.cx, e.cy);   // :38007(组4 死音库,终审修)
    if (inSlot === dur - 14 || inSlot === dur - 7 || inSlot === dur) {
      // 眼球椭圆 (27,59)(:37727 vector200)——Vector2FromElipse(:38001),8 速 30 伤
      // 出膛口走 shootBolt462(首拍二选一音 Item_124/125 + 尘 229,:56236-56257,工单⑦)
      const [exx, eyy] = mlElipseVec(x.l0, 27 * x.l1, 59 * x.l1);
      const d = Math.hypot(dx, dy) || 1;
      shootBolt462(game, e.cx + exx, e.cy + eyy, (dx / d) * 8, (dy / d) * 8, 30);
    }
  }

  // 帧推进(:38016-38049;注:原版 :38042-38048 钳制误写 localAI[2],此处按语义钳 [3])
  const f2Target = f2T * 7, f3Target = f3T * 5;
  if (f2Target > x.f2) x.f2 += 1; else if (f2Target < x.f2) x.f2 -= 1;
  x.f2 = clamp(x.f2, 0, 14);
  if (f3Target > x.f3) x.f3 += 1; else if (f3Target < x.f3) x.f3 -= 1;
  x.f3 = clamp(x.f3, 0, 15);
  // :42532 dontTakeDamage = localAI[3]>=15f——原版每 tick【双向赋值】(眼睑全闭
  // 才无敌,睁开即恢复可击)。★曾单向只写 true:状态 0(f3T=3)眼睑合拢过一次即
  // 永久无敌 → 双手眼毁后头无法受击、核心锁死 phase0、叶绿弹全图无可索目标 =
  // "月总血量卡 9500 打不死"(2026-08-25 用户实报,探针复现 head.dont=true 卡死)。
  // -2 残肢/-3 永闭态的无敌已在上方分支显式置 true(原版序:眼睑赋值先、分支
  // 覆盖后;本仓分支在前,故此处限常规态 ai0>=0 双向)
  if (e.ai0 >= 0) e.dontTakeDamage = x.f3 >= 15;

  // ---- 渲染镜像(Renderer.drawMoonLordHead 直读)----
  // 瞳孔角/睁眼度 → lai0/lai1(原版 localAI[0]/[1],Main.cs:24464 椭圆 (27,59)×[1]);
  // 破体覆层帧行底 f2/f3(=localAI[2]/[3])→ lai2/lai3(Main.cs:24468-24475:
  // Extra_25 行 = localAI[2]/7、Extra_29 行 = localAI[3]/5)
  e.lai0 = x.l0;
  e.lai1 = x.l1;
  e.lai2 = x.f2;
  e.lai3 = x.f3;
  e.spin = x.l0;
}
