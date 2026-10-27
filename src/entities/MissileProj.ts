// 可控导弹族（Projectile aiStyle 9 = AI_009_MagicMissiles，Projectile.cs:43996-44230 + AI_009_MagicMissiles_Old :44231 起——★BJ665 勘正 1456 伪锚 :40518-40751）
// + 老星怒天降落星（proj 9，aiStyle 5，Projectile.cs:24081-24364;1456 伪锚 :22130-22247 勘正 + Player.cs 出生链）。
// 此前两族都被 Game.useCombatWeapon 的"兜底 mArrow"当直线弹发出去——导弹失去
// 光标操控语义、老星怒失去天降语义。本文件 1:1 移植两族行为层。
//
// ── 成员（SetDefaults 实测，aiStyle 全部 = 9，:24644 分派——★BJ665 勘正 伪锚 :22676-22680）─────────────
//   16 魔法飞弹   item 113 Magic Missile（:976-986——★BJ665 勘正 伪锚 :714-724）   32×32 alpha100 light0.8
//                 magic ignoreWater；penetrate 缺省 1（命中即灭）
//   34 Flamelash  item 218（:902-912）                 32×32 penetrate2 light0.8 magic
//                 usesLocalNPCImmunity / localNPCHitCooldown=12；6 帧动画 Main.cs:8593（★BJ665 勘正 伪锚 :8403）
//   79 彩虹魔杖弹 item 495 Rainbow Rod（:1596-1608——★BJ665 勘正 伪锚 :1322-1333）   32×32 penetrate3 light0.8 magic
//                 同 34 免疫档 + ignoreWater
//   ★ 任务清单里的 579/753/1262 经核对【不是】本族：579=Drax（钻镐，shoot 107）、
//     753=Seaweed（海龟宠物链，buffType 42，shoot 127=aiStyle 26 宠物）、
//     1262=ChlorophyteJackhammer（shoot 252=aiStyle 20 手持钻头，:23837-23942）。
//     aiStyle 20 是钻头/链锯挂手 AI（:23837），28 是直线风动物理族（:24866）——
//     都不是光标导弹，本实体只接管 aiStyle 9（同族还有 491 Flying Knife，走
//     AI_009_MagicMissiles_Old :44231 回旋语义（★BJ665 勘正 伪锚 :40753），另案登记）。
//
// ── 操控语义（AI_009_MagicMissiles 逐段）──────────────────────────────────
//   channel 期间 ai[0]/ai[1] = 光标点（:44042-44051——★BJ665 勘正 伪锚 :40560-40574），amount=1 的 Lerp（:44132——★BJ665 勘正 伪锚 :40654）
//   → 速度直接对齐 normalize(目标−中心)×min(32, 距离)——转向是【瞬时】的；
//   "转向速率"只作用于视觉 rotation：AngleTowards(速度角, π/4/tick)（:44158-44161——★BJ665 勘正 伪锚 :40678-40681）。
//   近距 <64px 改为衰减盘旋：vel×0.3 + (目标−中心)×0.3（:44136-44138——★BJ665 勘正 伪锚 :40657-40660）。
//   松手（:44055-44075——★BJ665 勘正 伪锚 :40575-40593）：FindTargetWithLineOfSight（:46466-46493——★BJ665 勘正 伪锚 :42972-42999：800px 内最近
//   CanBeChasedBy(NPC.cs:91139-91150——★BJ665 勘正 1456 伪锚 :91070-91082) NPC + Collision.CanHit 视线 + 免疫表空）→
//   ai[1]=NPC 槽位追踪（amount 公式 :44098-44100——★BJ665 勘正 伪锚 :40620-40623 恒收敛 0.2，逐字保留）；无目标 →
//   速度归一 32 直飞（<2 时取 DirectionFrom(玩家)），timeLeft 钳 300（:44151-44154——★BJ665 勘正 伪锚 :40667-40676）。
//   持按连发：原版 item.channel 武器每 useAnimation 循环重用一次（pendingItemReuse
//   Player.cs:43152-43158 → ItemCheck_TryStartUse :52659（★BJ665 勘正 伪锚 :42143-42147/:51182-51196）每拍扣 mana）——
//   每循环【一发】新弹，由最新存活弹独占驱动（否则 N 弹会指数增殖）。
//   碰撞面（★BJ277 2026-09-22）：HandleMovement TileCollision 4×4 盒扫掠（Center−2 盒,
//   GetCollisionParams :19982/:20127-20131）+ aiStyle 9 反应支（:19439-19462,1458 同）——
//   79 引导档碰块免死（命中轴 ×0.1 贴面跟随,用户实报面）;16/34 全相与 79 松手档碰块
//   Kill。旧「中心格实心即灭」杀位退役（原版 HandleMovement 内无 tile 杀位）。
import { Entity } from './Entity';
import { TILE } from '../core/constants';
import type { GameHooks } from './types';
import { projSprite, projFrameImg, projFrameCount } from './Arrow';
import { applyProjStatus } from './projStatus';
import { noteVanillaProjImmune, applyBannerDamageDealt } from './projTargets';
import { projectileSnapStrikeBonus } from '../stats/SnapStrike';
import { ghostHurtOnHit, playerHasGhostHurt, spectreVictimEligible, vanillaFlag10LifeMaxOk } from './SpectreSoulProj';
import { nebulaBoosterOnHit } from './NebulaBooster';   // ★BJ424 星云套装 on-hit 单源
// RainbowRodHit 编排本体（收编池;L5 批 2026-08-31——79 命中/Kill 爆本地直生 +
// broadcast 上行同用此函数）。★终零波裁决注：module8 已有 netApply 消费面
// （Game.netApplyParticleOrchestra case RainbowRodHit → 同一 rainbowRodHitFx），
// 但 broadcast 通道为"服务器排除发送者"语义（Game.broadcastParticleOrchestra
// 只 sendParticleOrchestra、无本地回环）——"module8 已接则本地组合可简化"
// 不成立：拆掉本地直调 = 单机/发送端自身失明。维持"生产端双发（本地直生+
// broadcast 上行）、两面对同一收编本体"的原版等价形态。
import { rainbowRodHitFx } from '../fx/orchestraFx';
import { drawStripTrail, type TrailPt, type TrailSpec } from '../fx/TrailShader';
import type { Renderer } from '../render/Renderer';
import { ParticleOrchestraType } from '../net/syncModules';
import { hitCritters, hitCrittersAll, hitTownNpcs, playerCanHitEnemy, hitTownNpcsAoeBox } from './projTargets';   // ★BJ729-A：hitCrittersAll（KILL_BURST D4 critter 臂）
import { rollVanillaHitCrit } from './proj1457';
import type { VDust } from '../fx/VanillaDust';
import { canHit } from '../physics/LineOfSight';
import { projectileData } from '../data/vanillaProjectiles';
// ★通用湿段（Projectile.cs:16903-17113 全体弹共用段;2026-09-06 武器弹簇接入批）
import { projectileWetSection, projWaterDragFactor } from './projWetSection';
import { cutTilesBox } from './ProjCutTiles';   // ★BJ285 死亡段割面（BJ260 同款前置习语）
import { globalTimeWrappedHourly } from '../core/GameTime';   // ★BJ330 GTW 单源

// ===================== 数学原语（逐字对源码） =====================

/**
 * Player.LimitPointToPlayerReachableArea（Player.cs:45830-45858）——★BJ290 件2/件3
 * （2026-09-23,普-U1 单源化）：实现迁往单源 ./PlayerReachableArea（定尺寸平移钳——
 * Utils.Clamp 矩形版 Utils.cs:236-239 盒恒 1920×1200 只平移,不与 play area 相交裁剪;
 * 判序=先 max 后 min）。本文件旧【相交裁剪】实现（盒可缩小+玩家恒居裁后盒心,
 * 半宽按裁后尺寸）=P1③ 偏差本体（U1 例:世界宽 8400/玩家 cx=700/目标 2000:
 * 原版可达不动,旧版钳到 1660）,就此退役。re-export 承接 491/16/34/79 与测试旧 import 面。
 * 消费位：AI_009_MagicMissiles_Old :44247-44249（491 飞刀）与 AI_009_MagicMissiles
 * :44045-44046（16/34/79 新导弹族）都在算距离前先钳。★BJ279 移交②（BJ277 批并刀,
 * 2026-09-22）：新导弹族接线已补（steer 引导支）——「接线遗漏判定」销账。
 */
import { limitPointToPlayerReachableArea } from './PlayerReachableArea';
import { damageVarRoll } from '../stats/DamageVar';   // ★BJ723-C M02：16/34/79 可控导弹族 DV 首掷（:12970）
export { limitPointToPlayerReachableArea };

/** Utils.GetLerpValue（Utils.cs:315-322——★BJ665 勘正 伪锚 :283-307，clamped=true）——含 from>to 倒置区间 */
function lerpValue(from: number, to: number, t: number): number {
  if (from < to) {
    if (t < from) return 0;
    if (t > to) return 1;
  } else {
    if (t < to) return 1;
    if (t > from) return 0;
  }
  return (t - from) / (to - from);
}

/** MathHelper.Lerp */
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Main.rand.NextVector2Circular(rx, ry)——角度均匀 + 半径 √rand 圆盘取样 */
function circularVec2(r: number): [number, number] {
  const a = Math.random() * Math.PI * 2;
  const m = Math.sqrt(Math.random()) * r;
  return [Math.cos(a) * m, Math.sin(a) * m];
}

/** 34 白热光环用全白帧（Main.cs:33680-33694 画的是 GlowMask 白模;本仓无 glowmask
 *  图集 → 本体帧 source-in 白填充等价合成,Arrow.whiteSpriteOf 同法。按帧缓存） */
const WHITE34_CACHE = new Map<number, HTMLCanvasElement>();
function whiteHot34(frame: number): HTMLCanvasElement | null {
  const key = ((frame % 6) + 6) % 6;
  const hit = WHITE34_CACHE.get(key);
  if (hit) return hit;
  const src = projFrameImg(34, key);
  if (!src) return null;
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const cc = c.getContext('2d');
  if (!cc) return null;
  cc.imageSmoothingEnabled = false;
  cc.drawImage(src, 0, 0);
  cc.globalCompositeOperation = 'source-in';
  cc.fillStyle = '#fff';
  cc.fillRect(0, 0, c.width, c.height);
  if (WHITE34_CACHE.size > 64) WHITE34_CACHE.clear();
  WHITE34_CACHE.set(key, c);
  return c;
}

/** 79 光环六团染色纹理（Main.cs:33505 `hslToRgb(i/6,1,.5)×0.3`＝tex×color 调制;
 *  canvas 无逐 draw 染色通道 → JS 像素域一次烘焙 tex.rgb×tint（straight 域逐通道
 *  乘,α 原样——与本体 'lighter' drawImage 的既定预乘直译同口径）,按 img×色相缓存）。
 *  node 测试环境（无 DOM/canvas）→ null（调用侧跳光环,本体白团不受影响）。 */
const TINT79_CACHE = new WeakMap<object, Map<string, HTMLCanvasElement | null>>();
function tinted79(img: HTMLImageElement | ImageBitmap, tint: readonly [number, number, number]): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  let perImg = TINT79_CACHE.get(img);
  if (!perImg) { perImg = new Map(); TINT79_CACHE.set(img, perImg); }
  const key = `${tint[0]},${tint[1]},${tint[2]}`;
  const hit = perImg.get(key);
  if (hit !== undefined) return hit;
  let out: HTMLCanvasElement | null = null;
  try {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const cc = c.getContext('2d', { willReadFrequently: true });
    if (cc) {
      cc.drawImage(img, 0, 0);
      const d = cc.getImageData(0, 0, c.width, c.height);
      const px = d.data;
      for (let i = 0; i < px.length; i += 4) {
        px[i] = (px[i] * tint[0]) / 255;
        px[i + 1] = (px[i + 1] * tint[1]) / 255;
        px[i + 2] = (px[i + 2] * tint[2]) / 255;
      }
      cc.putImageData(d, 0, 0);
      out = c;
    }
  } catch { out = null; }
  perImg.set(key, out);
  return out;
}

const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** float.AngleTowards（Utils.cs:2174-2185——★BJ665 勘正 伪锚 :2142-2159）：最短路径钳 maxChange/tick */
function angleTowards(cur: number, target: number, maxChange: number): number {
  let c = wrapAngle(cur);
  const t = wrapAngle(target);
  if (c < t) { if (t - c > Math.PI) c += Math.PI * 2; }
  else if (c - t > Math.PI) c -= Math.PI * 2;
  c += Math.max(-maxChange, Math.min(maxChange, t - c));
  return wrapAngle(c);
}

/** float.AngleLerp（Utils.cs:2154-2172——★BJ665 勘正 伪锚 :2122-2140）：最短路径 Lerp(amount) */
function angleLerp(cur: number, target: number, amount: number): number {
  let angle: number;
  if (target < cur) {
    const up = target + Math.PI * 2;
    angle = (up - cur > cur - target) ? lerp(cur, target, amount) : lerp(cur, up, amount);
  } else if (target > cur) {
    const dn = target - Math.PI * 2;
    angle = (target - cur > cur - dn) ? lerp(cur, dn, amount) : lerp(cur, target, amount);
  } else {
    return cur;
  }
  return wrapAngle(angle);
}

/** XNA Vector2.MoveTowards：整向量朝 target 最多移动 max（方向保持） */
function moveTowardsV2(cx: number, cy: number, tx: number, ty: number, max: number): [number, number] {
  const dx = tx - cx, dy = ty - cy;
  const d = Math.hypot(dx, dy);
  if (d <= max || d === 0) return [tx, ty];
  return [cx + dx / d * max, cy + dy / d * max];
}

/** Main.hslToRgb(H, S=1, L)（Main.cs:48689-48737——★BJ665 勘正 伪锚 :48695-48737;双精度 hue2rgb + byte=Math.Round，
 *  与 fx/orchestraFx.leafHslToRgb255 同式）。S 钉 1 的纯色环：飞行拖尾/14×火花用
 *  缺省 L=.5（原文 hslToRgb(rand,1,.5)），Kill 迸散尾迹用 L=.65（:72441）。
 *  ★终清波升级：旧六边形分段表只支持 L=.5，79 Kill 的 newColor3 是 L=.65 档——
 *  直接引入闭式替代保证亮度档正确。 */
function hueToRgb(h: number, l = 0.5): [number, number, number] {
  const hue2rgb = (c: number, t1: number, t2: number): number => {
    let x = c;
    if (x < 0) x += 1;                          // C# double 直写 c++/c--
    if (x > 1) x -= 1;
    if (6 * x < 1) return t1 + (t2 - t1) * 6 * x;
    if (2 * x < 1) return t2;
    if (3 * x < 2) return t1 + (t2 - t1) * (2 / 3 - x) * 6;
    return t1;
  };
  h = ((h % 1) + 1) % 1;
  const s = 1;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const t = 2 * l - q;
  return [
    Math.round(hue2rgb(h + 1 / 3, t, q) * 255),
    Math.round(hue2rgb(h, t, q) * 255),
    Math.round(hue2rgb(h - 1 / 3, t, q) * 255),
  ];
}

// ===================== 可控导弹（aiStyle 9） =====================

/** 敌怪视图（CanBeChasedBy 口径，NPC.cs:91070-91082） */
interface MissileEnemyView {
  x: number; y: number; w: number; h: number; id: number;
  cx?: number; cy?: number; maxHp?: number; dead: boolean;
  def?: { friendly?: boolean; critter?: boolean; hitSound?: string[] };
  hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean,
    pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean;
}

/** 同族存活链：尾部 = 最新弹，独占"持按连发"循环（原版每 useAnimation 一发新弹） */
const ALIVE: MagicMissileProj[] = [];

/**
 * ★MAJOR-4（2026-09-02 红队 J′ 定罪）：Kill 死亡爆散逐型参数表——把 79 已真值化的
 * killNow 爆散骨架（Resize(盒)→penetrate=−1→Damage() AoE→Item10→沿 oldPos 全程
 * d267 尾迹迸散+CloneDust 白影）按型差异入表后接 16/34。原文三段：
 *   79 :72426-72503 / 16 :72503-72596 / 34 :72597-72650（1458 同）。
 * 字段：
 *   aoe       Resize 盒边长（死亡 AoE 半宽 = aoe/2；16=128 / 34=96 / 79=128）
 *   huePhase  79 式色相 = 单 rand 相位逐点累进 lvp2（:72440）;false = 逐点独立 rand
 *             经 hueOf（16 :72516 固定档 4/9+rand×2/9 / 34 :72611 rand×1/9）
 *   lum       hslToRgb 亮度档（79/16 = .65、34 = .5）
 *   count     迸散计数基数 Next(1,count)（79/16 = 4、34 = 5）
 *   decay     [阈值×N, 减数] 升序（79 三级 .3/.65/.85→1/2/3 :72446-72454;
 *             16/34 两级 .3/.75→1/2 :72520-72530/:72615-72625）
 *   scale267  267 主尘 scale 初值闭式（:72448 .9+1.2r / :72536 r×.8 / :72627 r×1）
 *   fadeIn267 267 主尘 fadeIn 闭式(k67)（:72449 1.2r·k67 / :72537 1.2r·k67 / :72628 2r）
 *   chase     267 主尘 +=单位向×chase（79/16 = 6 :72452/:72540、34 = 8 :72631）
 *   gate267   267 支受理门 Next(gate267)==0（16/34 = 3 :72533/:72622 即 1/3 门;
 *             79 = 0 恒走 267）;未受理走备支尘（alt）
 *   cloneFadeIn CloneDust 尾系数（79 = fadeIn×0.85 :72495;16/34 = fadeIn/2
 *             :72593/:72645;scale/2 与纯白覆写三型同）
 *   alt       备支尘（16 = d15 :72570-72588 / 34 = d6 :72619-72632;79 无）——
 *             初速 −vel×0.2、alpha100、vel×2、+=单位向×chase、scale×k67、noLight;
 *             16 恒 noGravity + fadeIn=(0.6+r×0.4)k67;34 是 50% 门 noGravity+scale×2.5
 *   tail      Kill 尾段 20 循环径向尘（16 = d15 圆盘 1.5/scale1.2+.5r/pos+=v×Next(1,16)
 *             :72578-72596;34 = d6 圆盘 6/scale1.6/fadeIn1.3+r :72633-72650;79 无）
 */
interface KillBurstSpec {
  aoe: number;
  huePhase: boolean;
  hueOf?: (r: number) => number;
  lum: number;
  count: number;
  decay: ReadonlyArray<readonly [number, number]>;
  scale267: (r: number) => number;
  fadeIn267: (r: number, k: number) => number;
  chase: number;
  gate267: number;
  cloneFadeIn: 'mul0.85' | 'half';
  alt?: {
    type: number;
    chase: number;
    fadeInOf?: (r: number, k: number) => number;
    heavyGate?: boolean;
  };
  tail?: 'd15' | 'd6';
}

const KILL_BURST: Record<number, KillBurstSpec> = {
  79: {
    aoe: 128, huePhase: true, lum: 0.65, count: 4,
    decay: [[0.3, 1], [0.65, 2], [0.85, 3]],
    scale267: (r) => 0.9 + r * 1.2, fadeIn267: (r, k) => r * 1.2 * k, chase: 6,
    gate267: 0, cloneFadeIn: 'mul0.85',
  },
  16: {
    aoe: 128, huePhase: false, hueOf: (r) => 4 / 9 + r * (2 / 9), lum: 0.65, count: 4,
    decay: [[0.3, 1], [0.75, 2]],
    scale267: (r) => r * 0.8, fadeIn267: (r, k) => r * 1.2 * k, chase: 6,
    gate267: 3, cloneFadeIn: 'half',
    alt: { type: 15, chase: 9, fadeInOf: (r, k) => (0.6 + r * 0.4) * k },
    tail: 'd15',
  },
  34: {
    aoe: 96, huePhase: false, hueOf: (r) => r * (1 / 9), lum: 0.5, count: 5,
    decay: [[0.3, 1], [0.75, 2]],
    scale267: (r) => r, fadeIn267: (r) => r * 2, chase: 8,
    gate267: 3, cloneFadeIn: 'half',
    alt: { type: 6, chase: 6, heavyGate: true },
    tail: 'd6',
  },
};

export interface MissileCtor {
  projId: number;
  damage: number;
  knockback: number;
  /** 原版 item useTime（== useAnimation，113/218/495 三件均相等）——持按连发节奏 */
  useTime: number;
  /** channel 电平（按住 && 同物品在手 && 未被 UI 挡） */
  channelCb: () => boolean;
  /** 光标世界坐标（Main.MouseWorld，:40566） */
  aimCb: () => { x: number; y: number };
  /** 每循环扣魔（ItemCheck_ActuallyPayMana :51190）——失败则本循环不发新弹 */
  payMana: () => boolean;
  /** 生成同族新弹（Game 侧闭包：枪口位 + 当前瞄准向 × shootSpeed） */
  fireExtra?: () => void;
}

export class MagicMissileProj extends Entity {
  projId: number;
  damage: number;
  knockback: number;
  /** 绘制 scale（SetDefaults scale；16/34/79 均 1） */
  drawScale = 1;
  /** 暴击总概率（spawn 侧注入，同 mArrow 口径） */
  critChance = 0.04;
  /** 护甲穿透（N:81913 减防——spawn 注入） */
  armorPen = 0;
  /** ★BJ424 星云触发已单源 nebulaBoosterOnHit（ghostHurtOnHit 同位）——回调退役 */
  /** 弹体点光（Game 实体光扫读） */
  lightRGB: [number, number, number] | null = null;
  dead = false;

  /** ai[0] 三态：0=光标操控（≥0）/ 1=已松手（−1）/ 2=34 命中后的终段（−2） */
  private mode = 0;
  /** ai[1]：松手后的追踪目标 NPC id（−1 = 无） */
  private homingId = -1;
  /** 34 的 num3 翻页位（:40544-40549：穿透余 1 且仍在操控 → 置位） */
  private page = false;
  /** localAI[0]：发红计时（:40555-40558） */
  private redT = 0;
  /** rotation（Projectile.cs:324 初值 0——★BJ665 勘正 伪锚 :523；AI :44158-44161 驱动——★BJ665 勘正 伪锚 :40678-40685） */
  rot = 0;
  /** timeLeft（SetDefaults 默认 3600，:526） */
  timeLeft: number;
  /** 穿透（16=1 / 34=2 / 79=3；穿透弹语义同 Arrow） */
  pierce: number;
  private pierceInit: number;
  /** 34 六帧动画（:40534-40543） */
  private frame = 0;
  private frameCounter = 0;
  /** Item9 周期音（:40689-40693） */
  private soundDelay = 0;
  /** 上 tick 速度（:40686 flag3 急转判定） */
  private pvx = 0;
  private pvy = 0;
  /** 16/34/79 着色器拖尾顶点带（TrailingMode[16]=[34]=[79]=3 的 oldPos 复刻——
   *  P.cs:17246-17253 每 tick【位移后】记录 oldPos[0]=position、旧点整体后移,再自尾
   *  向头逐点向邻新点 Lerp 0.65 收缩（距离>2 才收缩）;新→老,[0]=头=本拍位移后弹心,
   *  与原版 Drawer 侧 +Size/2 同位）。容量 TrailCacheLength（ProjectileID.cs:387）：
   *  16/34=30、79=60。★裁定 a（2026-09-02 J′）：79 彩虹带并入同构记录——旧 push 追尾
   *  12 点带（无收缩、旧→新存数、killNow 迸散与拖尾消费）退役,三条带单源。
   *  ★T1 清偿（2026-09-02,红队 E′）：原版 Main.cs:28615-28622 由 FlameLashDrawer/
   *  MagicMissileDrawer 沿该带绘着色器火带,本仓此前整缺 */
  private strip: Array<{ x: number; y: number }> = [];
  /** 本型带容量（TrailCacheLength;0 = 无带型——本实体只接 16/34/79,恒非 0） */
  private stripCap: number;
  /** Main.GlobalTimeWrappedHourly（Main.cs:17014 游戏运行秒 %3600）——拖尾色相相位
   *  基准。★2026-08-31 台账 C1 清偿：曾用逐弹本地钟（每 tick +1/60 自起点起算），
   *  同帧发射的多弹色相恒差一个常数偏移、也和世界的 GlobalTime 不同相；★BJ330 起直读
   *  GameTime 单源 %3600（Main.TotalGameTime 等价——暂停/失焦随世界冻结） */
  private globalT = globalTimeWrappedHourly();
  /** Main.DiscoR/G/B（Main.cs:19786-19831 六段 ±7/帧——★BJ665 勘正 伪锚 :19441；79 点光 =SetDefaults light :1602——★BJ665 勘正 伪锚 :15157-15160） */
  private discoR = 255;
  private discoG = 0;
  private discoB = 0;
  private discoStyle = 0;
  /** 同敌冷却（34/79 usesLocalNPCImmunity=12t；16 单发无需） */
  private hitCd = new Map<number, number>();
  /** 持按连发计数（useTime 拍） */
  private reuseT = 0;
  // ---- ★通用湿段（Projectile.cs:16903-17113 全体弹共用段;2026-09-06 武器弹簇批）----
  //  本类服务 id 全集 = aiStyle 9 三型（Game.ts:16718 projId:cw.shoot）逐 id 定谳
  //  （SetDefaults P.cs 699-10676 逐块）：
  //    · 16 魔法飞弹   — block :976-986 ignoreWater=true :985 = 豁免（段 no-op）
  //    · 34 Flamelash    — block :1164-1175 【无】ignoreWater 行 = 受段！溅花 +
  //      水中位移阻尼（tileCollide 缺省 true → HandleMovement :17581 阻尼块生效）
  //      + IsDestroyedByWater 水death（ProjectileID.Sets :287 六型含 34;:16923-16925
  //      `wet && !lavaWet` → Kill——经 hooks.kill 接 killNow,段内特支 34 浆穿
  //      :16933-16936 由共享体内建）。出生侧禁射门（Player.cs:52751 wet&&¬lavaWet——★BJ665 勘正 伪锚 :51274
  //      &&shoot∈{85,15,34}）已在 Game.useCombatWeapon :16701。
  //    · 79 彩虹魔杖弹 — block :1596-1606 ignoreWater=true :1607 = 豁免（段 no-op）
  //  段位序 = AI(steer) → 湿段 → 位移（直积分乘 drag,速度场不减）;本类 AI 无湿旗
  //  消费者 → 无需 spawn 前置预置（共享体首拍内建 :10886-10892 等价）。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984 置 10 / :17109-17112 逐拍 −1） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价——首拍 AI 后/位移前同位） */
  presetDone = false;
  private useTime: number;
  private channelCb: () => boolean;
  private aimCb: () => { x: number; y: number };
  private payMana: () => boolean;
  private fireExtra?: () => void;

  constructor(x: number, y: number, vx: number, vy: number, o: MissileCtor) {
    super();
    const pd = projectileData(o.projId);
    this.projId = o.projId;
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.damage = o.damage;
    this.knockback = o.knockback;
    this.useTime = Math.max(1, o.useTime);
    this.channelCb = o.channelCb;
    this.aimCb = o.aimCb;
    this.payMana = o.payMana;
    this.fireExtra = o.fireExtra;
    if (pd?.width) this.w = pd.width;
    if (pd?.height) this.h = pd.height;
    this.drawScale = pd?.scale ?? 1;
    this.timeLeft = pd?.timeLeft ?? 3600;
    this.pierce = this.pierceInit = Math.max(1, pd?.penetrate ?? 1);
    this.stripCap = o.projId === 79 ? 60 : 30;   // TrailCacheLength（ProjectileID.cs:387）
    ALIVE.push(this);
  }

  /** EntityManager 剔除时的兜底出链（world unload / 测试直弃） */
  destroy(): void {
    const i = ALIVE.indexOf(this);
    if (i >= 0) ALIVE.splice(i, 1);
  }

  /** ★⑥杀拍口径（2026-09-06,Arrow.ts 配方推广）：原版 Update 对湿段【无 active 门】
   *  ——AI(:16880 `if (active)`)内 Kill（active=false）当拍湿段(:16895
   *  `if (!ignoreWater)`)照跑,`!active` 门在 HandleMovement(:17120) 之后 :17132 才
   *  生效、只拦 Damage 管线。本类杀位=timeLeft 头杀(fixedUpdate 首)与 steer 内
   *  非有限速度杀位(steer 尾 killNow+return)——曾整体跳过湿段=杀拍溅花缺口;hitStep/出界
   *  杀位在活拍湿段【后】(wetSectionRan 已置,防双跑)。死亡拍位移仍跳过=零观感
   *  （Kill 尘已结死、弹体随即移除,证毕登记非债,Arrow 同口径）;杀拍段内水death
   *  (34) 的补 Kill 借 killNow 头幂等门（P.cs:71755-71758 `if (!active) return;`）
   *  免双爆。 */
  private wetSectionRan = false;

  private wetSectionStep(game: GameHooks): void {
    if (this.wetSectionRan) return;   // 防同拍双跑（活拍已跑 → 杀拍补跑 no-op）
    this.wetSectionRan = true;
    // ---- ★通用湿段（:16895-17113,共享体;溅花尘/音由 wetSplashStepShared 承载,
    //  不自写;16/79 豁免经数据面分流 = 段门 no-op（:16895;出生预置 :10886-10893
    //  无条件跑=共享体逐字面化批口径）。34 水death Kill（:16921-16925）经钩走
    //  killNow——原版 Kill 后 HandleMovement 仍跑一步（段无 active 门）,`!active`
    //  早退 :17157 跳过 Damage 与拖尾记录带,故死亡拍位移照走、带记录/命中不跑。 ----
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater,
      { kill: () => this.killNow(game) });
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    this.wetSectionRan = false;
    // timeLeft 头杀（vanilla timeLeft 杀在 Update 尾 :17307-17311=湿段后——本仓
    // 头杀位不再直接早退,湿段由下方 dead 支补跑=杀拍口径⑥）
    if (--this.timeLeft <= 0) this.killNow(game);
    if (!this.dead) {
      this.pvx = this.vx; this.pvy = this.vy;
      this.globalT = globalTimeWrappedHourly();   // GlobalTimeWrappedHourly（Main.cs:17014）——★BJ330 GTW 单源
      this.steer(game);
    }
    if (this.dead) { this.wetSectionStep(game); return; }   // ★杀拍补跑（防双跑见 wetSectionRan 注）
    this.wetSectionStep(game);   // ★活拍：AI 后/位移前 = 原版 Update 同序
    // ---- ★BJ277 碰撞扫掠+反应链（HandleMovement :17578 TileCollision + :18004 flag 旗
    //  + :19439-19462 aiStyle 9 反应支 + UpdatePosition :20549-20569;1458 同面）----
    //  ★用户实报修复核心：79 引导档（ai[0]>=0 ↔ mode 0）碰实心块【不 Kill】——
    //  TileCollision 夹速至贴面 + 命中轴 ×0.1（:19448-19455 字面）→ 下一拍 steer
    //  amount=1 重瞄 → 星体贴墙滑行持续跟随光标。旧 hitStep 中心格实心杀位不分相位,
    //  引导星一触墙即 BJ255 迸散 = 原版无此死面。wetVelocity 反应链【前】捕获
    //  （:17721-17764 湿支:夹后×系数,命中轴覆盖夹后全值;79/16 ignoreWater 恒干,34
    //  死支无 damp → 捕获序无观感差）。Kill 后位移照走+带记录/Damage 跳过 = 原版
    //  UpdatePosition 在反应链后恒跑、:17153 !active 门在其后同构。
    const sweep = this.tileSweep(game);          // 扫掠输入恒 velocity（:17726-17754 非湿速）
    const drag = projWaterDragFactor(this);      // 湿档系数（干态=1 恒等;速度场不减只削位移）
    const wvx = sweep.hitX ? sweep.rx : sweep.rx * drag;   // wetVelocity :17755-17763
    const wvy = sweep.hitY ? sweep.ry : sweep.ry * drag;
    this.vx = sweep.rx; this.vy = sweep.ry;      // velocity 字段=夹后值（:17959 写回;Kill 爆读此值）
    if (sweep.hitX || sweep.hitY) {              // lastVelocity != velocity → flag（:18004-18006）
      if (this.projId === 79 && this.mode === 0) {
        // type 79 特支（:19442-19456,1458 :19444-19458 同）：引导档免死,命中轴 ×0.1。
        if (sweep.hitX) this.vx *= 0.1;
        if (sweep.hitY) this.vy *= 0.1;
      } else {
        // 16/34 全相 + 79 松手档（:19458-19461 flag22=owner==myPlayer 支;79 松手=
        // BJ255 迸散面）
        this.killNow(game);
      }
    }
    this.x += this.wet ? wvx : this.vx;          // UpdatePosition :20563-20569 `if (wet)`
    this.y += this.wet ? wvy : this.vy;
    if (this.dead) return;   // 反应链/湿段杀位——:17153 !active 早退,不入带不结算
    if (this.stripCap > 0) this.stripRecord();   // Projectile.cs:17246（位移后;TrailingMode[16/34/79]=3——★BJ665 勘正 伪锚 :17197 mode-0 支）
    this.hitStep(game);
  }

  /** TrailingMode 3 记录+收缩（P.cs:17246-17253；本族 extraUpdates=0 → 每 tick 一次）。
   *  整带后移一位、[0]=本次位移后心；再自尾（i=末槽）向头逐点：与邻新点距离>2 时
   *  向其 Lerp 0.65 收缩（原版 `oldPos[num28]=Vector2.Lerp(oldPos[num28],oldPos[num28-1],0.65f)`）。
   *  同段还重算 oldRot[i]=指向邻新点方向——canvas 带以段向法线承载（drawShaderTrail/
   *  draw79Trail 与 killNow 迸散环同消费此带），不维护 rot 镜像。容量 =stripCap
   *  （TrailCacheLength[16]=[34]=30、[79]=60,ProjectileID.cs:387）。
   *  ★时序注（记录 vs 致死）：原版记录段在 Damage()(:17182) 之后、位移致死在
   *  HandleMovement 内 :17129 `if(!active) return` 早退不入带——★BJ277 后本仓同构：
   *  反应链 Kill（fixedUpdate 扫掠面）在 stripRecord 前 → dead 早退跳过记录;hitStep
   *  穿透耗尽杀位仍在记录后 = Damage 致死拍同款。旧「碰撞致死拍多一柱」残差随杀位
   *  上移自动消解 */
  private stripRecord(): void {
    this.strip.unshift({ x: this.cx, y: this.cy });
    if (this.strip.length > this.stripCap) this.strip.length = this.stripCap;
    for (let i = this.strip.length - 1; i >= 1; i--) {
      const cur = this.strip[i], newer = this.strip[i - 1];
      const dx = newer.x - cur.x, dy = newer.y - cur.y;
      if (Math.hypot(dx, dy) > 2) {
        cur.x += dx * 0.65;
        cur.y += dy * 0.65;
      }
    }
  }

  /** AI_009_MagicMissiles 主体（:40518-40751） */
  private steer(game: GameHooks): void {
    const num = 32;   // :40525 最大速度
    // ---- type 34：帧动画 + 翻页/发红计时（:40534-40558）----
    if (this.projId === 34) {
      // ★MINOR-5（P.cs:44013-44019 `frameCounter++ >= 4` 后增比较）——旧 ++前增
      //  4 拍/帧,原版 5 拍/帧（计数值 0..4 五拍后换帧）
      if (this.frameCounter++ >= 4) {
        this.frameCounter = 0;
        this.frame = (this.frame + 1) % projFrameCount(34);
      }
      if (this.pierce === 1 && this.mode === 0 && !this.page) this.page = true;    // :40544-40549
      if (this.pierce === 1 && this.mode === 1) this.mode = 2;                      // :40550-40554
      if (this.page || this.mode === 2) this.redT++;                               // :40555-40558
    }
    // ---- 主人操控（:40560-40604）----
    let aim: { x: number; y: number } | null = null;
    if (this.mode === 0) {
      if (this.channelCb()) {
        // channel 期用魔动画续期（Player.cs:43143-43146 itemAnimation 持续>0 每帧
        // ItemCheck_ApplyManaRegenDelay → delay 钉 4 = 全程 5% 滴流回蓝；2026-08-22
        // 审计 ❌ 修复——channel 弹寿命>useTime,不续期则 10t 后回满速回蓝白嫖魔力）
        game.player.onChannelManaHold?.();
        // ai[0]/ai[1] = 光标（:40566-40573）。★BJ279 移交②（BJ277 批并刀）：
        // Main.MouseWorld 先经 LimitPointToPlayerReachableArea（:44044-44046;
        // Player.cs:45832-45861——★BJ665 勘正 伪锚 :45830-45858）钳进玩家可达区——旧直传裸光标=超射程引导目标域偏差
        // （limitPointToPlayerReachableArea 头注登记的「新导弹族接线遗漏」就此销账）。
        const raw = this.aimCb();
        const [clx, cly] = limitPointToPlayerReachableArea(raw.x, raw.y,
          game.player.cx, game.player.cy, game.world.store.w * TILE, game.world.store.h * TILE);
        aim = { x: clx, y: cly };
        // 持按连发（Player.cs:42143-42147 循环重用）：每 useTime 一发新弹，由最新
        // 存活弹独占驱动（尾部）；扣魔走 Game 侧 payMana 回调（1457 ManaV2 恒放行,
        // 空蓝照发+slowMagicUse 标记——CheckMana :53216-53253 同语义）
        while (ALIVE.length && ALIVE[ALIVE.length - 1].dead) ALIVE.pop();
        if (ALIVE[ALIVE.length - 1] === this) {
          if (++this.reuseT >= this.useTime) {
            this.reuseT = 0;
            if (this.payMana()) this.fireExtra?.();
          }
        }
      } else {
        // 松手（:40575-40593）：ai[0]=-1；找视线内最近目标，无则速度归一 32
        this.mode = 1;
        this.homingId = this.findTarget(game);
        if (this.homingId === -1) {
          const sp = Math.hypot(this.vx, this.vy);
          if (sp < 2) {
            // DirectionFrom(player.Center)（:40587）——中心重合时为零向量
            const p = game.player;
            const dx = this.cx - p.cx, dy = this.cy - p.cy;
            const dl = Math.hypot(dx, dy);
            this.vx = dl > 0 ? dx / dl * num : 0;
            this.vy = dl > 0 ? dy / dl * num : 0;
          } else {
            this.vx = this.vx / sp * num;
            this.vy = this.vy / sp * num;
          }
        }
      }
    }
    if (this.mode !== 0 && this.homingId === -1) {
      const t = this.findTarget(game);      // :40595-40603（命中清 ai[1] 后重索敌）
      if (t !== -1) this.homingId = t;
    }
    // ---- 目标解析（:40605-40630）----
    let tx = 0, ty = 0, has = false;
    let amount = 1;
    if (this.mode === 0 && aim) { tx = aim.x; ty = aim.y; has = true; }  // :40607-40609
    if (this.mode !== 0 && this.homingId >= 0) {
      const e = this.findEnemy(game, this.homingId);
      if (!e) {
        this.homingId = -1;                // :40624-40628（目标失效清 ai[1]）
      } else {
        const ecx = e.cx ?? e.x + e.w / 2, ecy = e.cy ?? e.y + e.h / 2;
        tx = ecx; ty = ecy; has = true;
        const d = Math.hypot(ecx - this.cx, ecy - this.cy);
        const num7 = lerpValue(0, 100, d) * lerpValue(600, 400, d);       // :40621
        amount = lerp(0, 0.2, lerpValue(200, 20, 1 - num7));             // :40622（恒收敛 0.2）
      }
    }
    // ---- 转向/移动（:40636-40677）----
    let flag2 = this.mode !== 0;            // :40631-40635（flag = 已松手）
    if (has) {
      const dx = tx - this.cx, dy = ty - this.cy;
      const d = Math.hypot(dx, dy);
      if (d >= 64) {                        // :40639-40655
        flag2 = true;
        const sp2 = Math.hypot(this.vx, this.vy);
        if (sp2 < 4 && sp2 > 0) {
          // vel += normalize(vel).RotatedBy(π/4)*4（:40646-40649；零向量不踢）
          const a = Math.atan2(this.vy, this.vx) + Math.PI / 4;
          this.vx += Math.cos(a) * 4;
          this.vy += Math.sin(a) * 4;
        }
        if (!Number.isFinite(this.vx) || !Number.isFinite(this.vy)) { this.killNow(game); return; }
        const want = Math.min(num, d);
        this.vx = lerp(this.vx, dx / d * want, amount);
        this.vy = lerp(this.vy, dy / d * want, amount);
      } else {                              // :40656-40661 近距盘旋
        this.vx *= 0.3; this.vy *= 0.3;
        this.vx += (tx - this.cx) * 0.3;
        this.vy += (ty - this.cy) * 0.3;
        flag2 = Math.hypot(this.vx, this.vy) >= 2;
      }
      if (this.timeLeft < 60) this.timeLeft = 60;   // :40662-40665
    }
    if (this.mode !== 0 && this.homingId < 0) {
      // :40667-40676 直飞档：速度朝 normalize(vel)|UnitY ×32 以 ≤4/tick 收敛；寿命钳 300
      const sp3 = Math.hypot(this.vx, this.vy);
      if (sp3 !== num) {
        const ux = sp3 > 0 ? this.vx / sp3 : 0;
        const uy = sp3 > 0 ? this.vy / sp3 : 1;   // SafeNormalize(UnitY)（:40671）
        [this.vx, this.vy] = moveTowardsV2(this.vx, this.vy, ux * num, uy * num, 4);
      }
      if (this.timeLeft > 300) this.timeLeft = 300;
    }
    // ---- rotation（:40678-40685）----
    const velA = Math.atan2(this.vy, this.vx);
    if (flag2 && (this.vx !== 0 || this.vy !== 0)) {
      this.rot = angleTowards(this.rot, velA, Math.PI / 4);
    } else {
      this.rot = angleLerp(this.rot, 0, 0.2);
    }
    this.fxStep(game);
  }

  /** 尘/音/光（:40687-40750 + ProjLight :14808-15160） */
  private fxStep(game: GameHooks): void {
    if (this.projId === 16) {
      // :40689-40693 Item9 周期音（soundDelay=10，|vx|+|vy|>2 门）——原版 soundDelay
      // 在 Update 头递减、AI 判 ==0（R27 对齐十拍节拍：曾"判<=0 再减"=11 拍/响）
      if (this.soundDelay > 0) this.soundDelay--;
      if (this.soundDelay === 0 && Math.abs(this.vx) + Math.abs(this.vy) > 2) {
        this.soundDelay = 10;
        game.playSfxFiles(['Item_9'], 0.5, this.cx, this.cy);
      }
      // :40694-40702 尘 15（1/9 概率无重力漂尘）
      if (Math.random() < 1 / 9) game.spawnParticles(this.cx, this.cy, '#9CD8FF', 1, 1.1, { life: 20 });
      this.lightRGB = [0.08, 0.32, 1.0];   // :15006-15010（light0.8 × (0.1,0.4,1)）
    } else if (this.projId === 34) {
      // :40721-40736 火尘（发红档 Crimson 按 localAI[0] 0→10 渐入）
      const red = lerpValue(0, 10, this.redT);
      if (Math.random() < 1 / 6) {
        game.spawnParticles(this.cx, this.cy, red > 0.5 ? '#C41E3A' : '#FFA040', 1, 1.4, { life: 18 });
      }
      this.lightRGB = [0.8, 0.8, 0.8];     // 无覆盖档（:14815-14817 白 × light）
    } else if (this.projId === 79) {
      // ★BJ255 定谳（2026-09-21，推翻 R27 §12 归属）：1.4.5.7/1458 的 type==79 disco
      //  尘块（1457 :44389-44407 / 1458 :44390-44408，Dust 66+Main.Disco 色）位于
      //  【AI_009_MagicMissiles_Old】方法体内（1457 起始 :44231 / 1458 :44232），
      //  而 Old 全文件唯一调用点 = AI_009 头 `if (type == 491)` 分支（:44000）——
      //  79 走 aiStyle 9 新 AI（:24644 → AI_009_MagicMissiles，43996-44230），新 AI
      //  内无任何 79 块 → 原版 79 【飞行期无尘、无 Item9 循环音】（尘/音块=旧频道式
      //  AI 死码遗产）。旧刀把 :44390 误读为"在 `type != 34 return`(:44196) 之后的
      //  同方法体"=跨函数误归属，d66 尘+Item9 音整面退役。保留项（均原版在位）：
      //  · ProjLight :16600-16605 type==79 light = Disco 色（下方 disco 状态机+lightRGB）
      //  · Kill :72426-72465 彩虹迸散（killNow 链,不在本函数）
      const n = 7;                          // Main.cs:19786-19831 六段 ±7/帧（★BJ665 勘正 伪锚 :19441）
      switch (this.discoStyle) {
        case 0: this.discoG = Math.min(255, this.discoG + n); if (this.discoG >= 255) this.discoStyle++; break;
        case 1: this.discoR = Math.max(0, this.discoR - n); if (this.discoR <= 0) this.discoStyle++; break;
        case 2: this.discoB = Math.min(255, this.discoB + n); if (this.discoB >= 255) this.discoStyle++; break;
        case 3: this.discoG = Math.max(0, this.discoG - n); if (this.discoG <= 0) this.discoStyle++; break;
        case 4: this.discoR = Math.min(255, this.discoR + n); if (this.discoR >= 255) this.discoStyle++; break;
        default: this.discoB = Math.max(0, this.discoB - n); if (this.discoB <= 0) this.discoStyle = 0; break;
      }
      this.lightRGB = [this.discoR / 255 * 0.8, this.discoG / 255 * 0.8, this.discoB / 255 * 0.8]; // SetDefaults light=0.8 :1602（★BJ665 勘正 伪锚 :15157-15160）
    }
    // 急转尘爆（:40686 flag3——oldVel·vel 归一 < 0.2 时 2-5 尘，:40703-40715/:40737-40749）
    // ★BJ255：原版 flag3 尘块分别整体位于 `if (type == 16)`/:44112 与 type==34 段内
    // （16 dust15 :44122-44135、34 dust6 :44210-44224）——79 无此面（新 AI 无 79 块），
    // 79 摘除（旧 '#FFD0FF' 分支=同 R27 误归属家族）。
    const speed = Math.hypot(this.vx, this.vy);
    const pSpeed = Math.hypot(this.pvx, this.pvy);
    if (this.projId !== 79 && speed > 0.1 && pSpeed > 0.1) {
      const dot = (this.pvx * this.vx + this.pvy * this.vy) / (pSpeed * speed);
      if (dot < 0.2) {
        game.spawnParticles(this.cx, this.cy,
          this.projId === 34 ? '#FF7030' : '#9CD8FF',
          2, 0.8, { life: 14 });
      }
    }
  }

  /** FindTargetWithLineOfSight（:42972-42999）：800px 内最近可追 + CanHit 视线 */
  private findTarget(game: GameHooks): number {
    let best = 800, result = -1;
    const st = game.world.store;
    for (const ent of game.enemies()) {
      const e = ent as MissileEnemyView;
      if (e.dead || e.id === undefined) continue;
      if (!((e.maxHp ?? 99) > 5) || e.def?.friendly || e.def?.critter) continue; // NPC.cs:91070
      if (this.hitCd.has(e.id)) continue;                  // localNPCImmunity（:42980）
      const d = Math.hypot((e.cx ?? e.x + e.w / 2) - this.cx, (e.cy ?? e.y + e.h / 2) - this.cy);
      if (d < best && canHit(st, this.x, this.y, this.w, this.h, e.x, e.y, e.w, e.h)) {
        best = d; result = e.id;
      }
    }
    return result;
  }

  private findEnemy(game: GameHooks, id: number): MissileEnemyView | null {
    for (const ent of game.enemies()) {
      const e = ent as MissileEnemyView;
      if (!e.dead && e.id === id
        && (e.maxHp ?? 99) > 5 && !e.def?.friendly && !e.def?.critter) return e;
    }
    return null;
  }

  /** ★BJ277 TileCollision 核心扫掠（Collision.cs:2299-2459 单遍 1:1,aiStyle 9 专参）。
   *  · 盒 = GetCollisionParams（:19982 resizeAnchor 缺省 (0.5,0.5) + :20127-20131
   *    aiStyle 9 → colWidth=colHeight=4）→ 盒左上 = Center−(2,2)（:17698）。
   *  · 扫描带 = [value,value2)/[value3,value4)【独占】界（:2315-2324;value3/value4
   *    双钳 maxTilesY−40=底 40 行不扫,★BJ288 F1/F2——旧闭末槽多扫右/底一列已退役）。
   *  · 单遍【目标位盒】重叠判定（:2355 vector2=Position+Velocity）——32px/拍对单格墙
   *    可隧穿 = 原版同款快弹 quirk（wiki「Wall-piercing weapons」类,刻意不补步进）。
   *  · 四向夹速残量=贴面距（从上 :2388/从左 :2406/从右 :2426/从下 :2446）+ 原版
   *    num 簿记 1:1：X 命中格(num,num2)/Y 命中格(num3,num4),夹速为【逐格覆写】
   *    （i/j 升序末格胜出——从左支对多列跨压取最远列面 = 原版字面,wiki 穿墙 quirk
   *    的成因）,非 min/max 累计;从上支带 num6 最顶面门（:2391/:2402）;跨轴复原
   *    num3==num → result.Y=vector.Y（:2420/:2440）、num4==num2 → result.X=vector.X
   *    （:2452）;halfBrick 顶 8px（:2349-2354）+ 从上行号 num4++（:2395-2398）;
   *    hoik 邻格坡门（:2412 左邻坡 2/4、:2432 右邻坡 1/3 → 跳过,hoik 缺省 true,
   *    FX34b 判例）;up 支 gravDir=1 → +0.01px（:2451 字面）。嵌入盒（四向分支全不中）
   *    无夹速自由穿出 = 原版同款（出生嵌墙逃逸）。
   *  · 平台全穿透：TileCollision 实参 fallThrough=fall2=flag6=true（:17587 aiStyle 9
   *    无特支 → :2391 前置取反不计数;侧/底支 !tileSolidTop 门）。
   *  · 坡面格按实心 bbox 档（:2361-2384 坡候选 flag2/flag3 与 SlopeCollision
   *    :17961-17987 残差面未移植,登记残差——仍严格严于旧「中心格实心即灭」档）。
   *  · 返回 rx/ry=夹后位移,hitX/hitY=轴命中（≡ velocity 轴被改,:18004 旗;
   *    跨轴复原后净变=false 同 vanilla lastVelocity 逐轴比较）。 */
  private tileSweep(game: GameHooks): { rx: number; ry: number; hitX: boolean; hitY: boolean } {
    const st = game.world.store;
    const bw = 4, bh = 4;                       // colWidth/colHeight（GetCollisionParams aiStyle 9）
    const bx = this.cx - 2, by = this.cy - 2;   // resizeAnchor 0.5 → 盒左上 = Center−半盒
    const dx = this.vx, dy = this.vy;
    let rx = dx, ry = dy;
    // ★BJ288 F1/F2（Collision.cs:2315-2324 逐字;physics/TileCollision.ts:1299-1302 同习语）：
    //  上界=【独占】界（i<value2/j<value4）——旧 `<=` 把 floor+2 当闭末槽=右/底各多扫
    //  一列/行（vanilla 从不扫描的列面曾把引导星锁在墙面上,deviating 面退役;独占界下
    //  「整速穿墙」=原版快弹隧穿 quirk 刻意保留）;value3/value4 双双钳 maxTilesY−40
    //  （底 40 行 TileCollision 永不扫=原版 quirk;旧钳 st.h−1 系 tileSweep 孤例）。
    const tx0 = Math.max(0, Math.min(Math.floor(bx / TILE) - 1, st.w - 1));
    const tx1 = Math.max(0, Math.min(Math.floor((bx + bw) / TILE) + 2, st.w - 1));   // 独占
    const ty0 = Math.max(0, Math.min(Math.floor(by / TILE) - 1, st.h - 40));
    const ty1 = Math.max(0, Math.min(Math.floor((by + bh) / TILE) + 2, st.h - 40));  // 独占+底钳
    let num6 = (ty1 + 3) * TILE;                // :2319 num6（从上支最顶面门,初值=扫描带底外;用钳后 value4）
    let num = -1, num2 = -1, num3 = -1, num4 = -1;   // :2311-2314 X 命中格(num,num2)/Y 命中格(num3,num4)
    const slopeAt = (i: number, j: number): number =>
      i >= 0 && i < st.w && j >= 0 && j < st.h ? st.slope[st.idx(i, j)] : 0;   // null 格=坡 0（:2408-2411/:2428-2431）
    for (let i = tx0; i < tx1; i++) {
      for (let j = ty0; j < ty1; j++) {
        if (!st.inBounds(i, j) || !st.isActive(i, j) || !st.isSolid(i, j)) continue;
        let vy4 = j * TILE, h7 = TILE;
        if (st.half[st.idx(i, j)]) { vy4 += 8; h7 -= 8; }            // halfBrick :2349-2354
        const vx4 = i * TILE;
        // 目标位盒不重叠 → 跳过（:2355 vector2 = Position+Velocity）
        if (bx + dx + bw <= vx4 || bx + dx >= vx4 + TILE || by + dy + bh <= vy4 || by + dy >= vy4 + h7) continue;
        if (by + bh <= vy4) {                              // 从上（:2388 down 支）
          if (num6 > vy4) {                                // :2391 num6 门（最顶面胜出）
            num3 = i; num4 = j;
            if (h7 < TILE) num4++;                         // :2395-2398 半砖行号 +1
            if (num3 !== num) {                            // :2399（flag2 坡候选恒 false,见头注）
              ry = vy4 - (by + bh);                        // :2401（gravDir=1 无 ε）
              num6 = vy4;
            }
          }
        } else if (bx + bw <= vx4) {                       // 从左（:2406）
          if (i < 1 || (slopeAt(i - 1, j) !== 2 && slopeAt(i - 1, j) !== 4)) {   // :2412 hoik 左邻坡门
            num = i; num2 = j;
            if (num2 !== num4) rx = vx4 - (bx + bw);       // :2416-2418（覆写,末格胜出）
            if (num3 === num) ry = dy;                     // :2420-2422 result.Y = vector.Y
          }
        } else if (bx >= vx4 + TILE) {                     // 从右（:2426）
          if (slopeAt(i + 1, j) !== 1 && slopeAt(i + 1, j) !== 3) {              // :2432 hoik 右邻坡门
            num = i; num2 = j;
            if (num2 !== num4) rx = vx4 + TILE - bx;       // :2436-2438（覆写,末格胜出）
            if (num3 === num) ry = dy;                     // :2440-2442 result.Y = vector.Y
          }
        } else if (by >= vy4 + h7) {                       // 从下（:2446 up 支）
          num3 = i; num4 = j;
          ry = vy4 + h7 - by + 0.01;                       // :2451（gravDir=1 → +0.01 字面）
          if (num4 === num2) rx = dx;                      // :2452-2454 result.X = vector.X
        }
      }
    }
    return { rx, ry, hitX: rx !== dx, hitY: ry !== dy };
  }

  /** 位移后的命中段（Damage 管线;:17153 !active 已过）。★BJ277：中心格实心杀位退役——
   *  tile 碰撞面已上移 HandleMovement 扫掠+反应链（fixedUpdate;原版 HandleMovement 内
   *  无 tile 杀位,弹体死亡面全在反应链 Kill/湿段水death/timeLeft/穿透耗尽）。inBounds
   *  杀位与割草面维持原位（cutTile 消费面不变）。 */
  private hitStep(game: GameHooks): void {
    const world = game.world;
    const tx = Math.floor((this.x + this.w / 2) / TILE);
    const ty = Math.floor((this.y + this.h / 2) / TILE);
    if (!world.store.inBounds(tx, ty)) { this.killNow(game); return; }
    if (world.store.get(tx, ty) !== 0) game.cutTile(tx, ty);   // ★BJ277:杀位移交扫掠反应链,割草面原位
    for (const [k, v] of this.hitCd) {
      if (v <= 1) this.hitCd.delete(k); else this.hitCd.set(k, v - 1);
    }
    // ★BJ285（BJ232 死亡段割面族,2026-09-22）：CutTiles（Projectile.cs:12517 调用点/方法 :15276）在 Damage() 内
    //  先于 Damage_PVE（:12523）——16/34/79 penetrate 1/2/3 计数耗尽即亡拍【照割】
    //  （SetDefaults :976-984/:1164-1180/:1596-1610,aiStyle 9/friendly）;中央割
    //  !e.dead 门=死亡拍整缺 → BJ260 前置习语。三型均过两道门（CanCutTiles :15407
    //  两表均无;CanDealDamage :12461 无——唯一关联排除 1092 与本族无关）。
    cutTilesBox(game, this.x, this.y, this.w, this.h);
    if (hitCritters(this, game)) { this.killNow(game); return; }
    for (const ent of game.enemies()) {
      if (!playerCanHitEnemy(ent, game, this.projId)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
      const e = ent as MissileEnemyView;
      if (e.dead) continue;
      if (!(this.x < e.x + e.w && this.x + this.w > e.x && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
      if (this.projId !== 16) {
        const cd = this.hitCd.get(e.id) ?? 0;
        if (cd > 0) continue;
        this.hitCd.set(e.id, 12);   // localNPCHitCooldown=12（SetDefaults 34/79）
      }
      // ★BJ489 def-3：16/34/79 掷率=rollVanillaHitCrit（magic 旗,命中拍 owner 装配+
      //  :25712 持械折入动态,critTotal 出生拍冻结载体退役）;critChance≤0 关断钉保留
      const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
      // ★BJ723-C M02（2026-10-26）：DamageVar 首掷（Projectile.cs:12970——16 魔法
      //  飞弹/34 烈焰火鞭/79 彩虹魔杖弹三型共面,每受理靶 ±15% 31 档离散+luck
      //  重掷,BJ716-A Arrow 主环同式;crit ×2 后置=StrikeNPC 内序）
      const dmgMsl = damageVarRoll(this.damage, ((game.player as unknown as { luck?: number } | null)?.luck) ?? 0);
      const dmg = dmgMsl;   // ★S02(BJ723-B):crit ×2 移 Enemy.hurt 防后(NPC.cs:82067)
      // + 催化指环 6185（StatusNPC :11192-11196,玩家弹命中 398 300t）
      applyProjStatus(this.projId, e as unknown as Record<string, number>,
        { catalystBand: ((game.player as unknown as { equipStats?: { catalystBand?: boolean } } | null)?.equipStats?.catalystBand) === true });
      // 可控导弹族三型（16/34/79）均 magic 数据面 → 原版同样不触发；双支类门
      // projectileSnapStrikeBonus 单源（melee|ranged/ranged 过滤），站位补齐；
      // 返回 num14 加伤随暴击并入实伤参。
      const snapBonusMissile = projectileSnapStrikeBonus(game, this,
        (e as { cx?: number }).cx ?? e.x + e.w / 2, (e as { cy?: number }).cy ?? e.y + e.h / 2,
        e.id, { victimBox: { w: e.w, h: e.h,
          cx: (e as { cx?: number }).cx ?? e.x + e.w / 2,
          cy: (e as { cy?: number }).cy ?? e.y + e.h / 2 } });
      e.hurt(applyBannerDamageDealt(game, e, dmg)
        + (snapBonusMissile ? snapBonusMissile : 0),
        Math.sign(this.vx) * this.knockback, 0, game, this.armorPen, crit, this.pierceInit, true);   // 音/飘值=单点;★S02 crit ×2=Enemy.hurt 防后
      // ★GC1 写方桥（Projectile.Damage :14031-14183 命中尾梯,StrikeNPC 后原位）：
      // 16 显型档=immune[owner]=8（:14096-14098）→ 非 local 面按表写；
      // 34/79 usesLocalNPCImmunity（1457 SetDefaults :1173/:1605,cd=12）→ 写 0
      // 清全局窗（节流归上方 hitCd 局部表）。蓝队二轮 F5 起该 face 由补表自动解析,
      // 此处显参保留为历史锚。penetrate 取写前现存 this.pierce（未递减——
      // :14189 的 penetrate-- 在梯子后）
      noteVanillaProjImmune(game, this.projId, e.id,
        { penetrate: this.pierce, localFace: this.projId === 34 || this.projId === 79 });
      // 命中清追踪（StrikeNPC :13260-13283：34 仅 ai[0]==-1 档清 / 79 恒清 + 彩虹粒子；
      // 34 的 ai[0]==-2 终段不再清——逐字对源码）。79 命中的 RainbowRodHit 编排
      // （Projectile.cs:14293-14304:ai[0]==-1 门→ RequestParticleSpawn clientOnly:false,
      //   PositionInWorld=targetNPC.Center、MovementVector=velocity）——L5 批真值升级
      // （原 #FFB0FF 占位紫粒退役）+ module8 上行
      if (this.projId === 79 && this.mode !== 0) {
        this.homingId = -1;
        const ecx = (e as { cx?: number }).cx ?? e.x + e.w / 2;
        const ecy = (e as { cy?: number }).cy ?? e.y + e.h / 2;
        rainbowRodHitFx(game, ecx, ecy, this.vx, this.vy);
        game.broadcastParticleOrchestra?.(ParticleOrchestraType.RainbowRodHit,
          ecx, ecy, this.vx, this.vy);
      } else if (this.projId === 34 && this.mode === 1) {
        this.homingId = -1;
      }
      // 幽灵套吸血（Projectile.cs:13877-13879：magic 弹 ghostHeal）。★BJ157-②：numHits
      //  = 此前受理命中数（:14263 numHits++ 在 proc 块【后】⇒ 首跳读 0 率 0.20;旧
      //  「numHits 含本次」+1 系 off-by-one——首跳 0.15）。pierceInit−pierce = 已递减
      //  次数（本跳递减在下方 :784,读点未减）=此前命中数;同敌 hitCd 12t 再命中每跳
      //  递减亦计入（原版 numHits 同相;城镇 NPC 递减支亦计入=原版 Damage_PVE_Inner 同链）
      // ★BJ167-②③④（2026-09-19）spectre 域三小件对齐（MagicProj BJ157-① 同款习语）：
      //  ②victim 门 spectreVictimEligible——原版 Projectile.cs:13875
      //    `if (targetNPC.canGhostHeal | flag9)` 对 ghostHeal(:13877-79) 与
      //    ghostHurt(:13881-83) 【同块】设门;false 族 384/387/388/523
      //    （NPC.cs:13921/:13961/:13978/:15839 写点,字段缺省 true :6270）——
      //    旧码命中该族仍治疗
      //  ③dmg = num41 等位（:13712 `int num41 = targetNPC.StrikeNPC(...)` 返回值,
      //    :13879 实参）=防后实扣（Enemy.lastStrikeDealt 单源;旧传
      //    Math.round(dmg)=防前伤,治疗量按防御/旗乘差值虚高）
      //  ④出生点 = 受害者 Center（:13879 `new Vector2(targetNPC.Center.X,.Y)`;旧传
      //    弹体左上 this.x,y——治疗弹 298 起飞原点差几像素）
      const v156 = e as unknown as { vanillaId?: number | null; lastStrikeDealt?: number;
        maxHp?: number; def?: { lifeMax?: number } };
      // ★BJ385 flag10 lifeMax>5 段补门（:13712）——BJ167 老站缺段,门单源
      //  vanillaFlag10LifeMaxOk（critter 一击致死族原版不 proc）
      if (vanillaFlag10LifeMaxOk(v156) && spectreVictimEligible(v156.vanillaId)) {
        game.applyLifeSteal?.('ghost', v156.lastStrikeDealt ?? 0, this.pierceInit - this.pierce,
          e.cx ?? e.x + e.w / 2, e.cy ?? e.y + e.h / 2, true);
      }
      // ★GB1（GC 契约，2026-08-31）：幽灵伤害头 ghostHurt（Projectile.cs:13881 →
      //  :12021 方法体）——触发位在 StrikeNPC(:13712)/ghostHeal(:13879) 之后、同一
      //  flag10 on-hit 段内。导弹族三型（16 魔法飞弹 /34 Flamelash /79 彩虹魔杖弹）
      //  的 SetDefaults 均为 magic=true（vanilla-projectiles.json 三条 magic 位）；
      //  按弹 id 数据门（magic 归属面）+ Spectre Mask 套装 → 受害者 Center 放浮魂
      //  弹 356。dealt = Enemy.lastStrikeDealt（StrikeNPC num41 等价位）
      if (this.projId > 0 && projectileData(this.projId)?.magic === true
        && playerHasGhostHurt(game.player)) {
        ghostHurtOnHit(game,
          { magic: true, projDamage: this.damage,
            projX: this.x, projY: this.y, projW: this.w, projH: this.h,
            ownerCx: game.player.cx, ownerCy: game.player.cy },
          { x: e.x, y: e.y, w: e.w, h: e.h, cx: e.cx ?? e.x + e.w / 2, cy: e.cy ?? e.y + e.h / 2,
            vanillaId: v156.vanillaId,
            dealt: v156.lastStrikeDealt ?? 0 });   // 本拍结算面（蓝队 F2② 修订）
      }
      // ★BJ424 星云套装 proc（:13885-13891,ghostHurt 同块同位）——触发单源
      // nebulaBoosterOnHit（全 magic 弹面）;旧 nebulaCb 仅 Game 四专支接线且
      // 调用在 e.hurt 前（dealt 未结算）+ 私有数组无渲染,已退役
      nebulaBoosterOnHit(game,
        { projId: this.projId, projDirX: this.vx },
        { x: e.x, y: e.y, w: e.w, h: e.h, cx: e.cx ?? e.x + e.w / 2, cy: e.cy ?? e.y + e.h / 2,
          vanillaId: v156.vanillaId,
          lifeMax: v156.maxHp ?? v156.def?.lifeMax,
          dealt: v156.lastStrikeDealt ?? 0 });
      if (--this.pierce <= 0) { this.killNow(game); return; }
    }
    if (hitTownNpcs(this, game, this.damage, Math.sign(this.vx) * 2)
      && --this.pierce <= 0) { this.killNow(game); return; }
  }

  /** 统一消亡出口。★R27：79 彩虹魔杖 Kill 爆（Projectile.cs:72426-72503，1458 同）+
   *  ★MAJOR-4（2026-09-02 红队 J′）：同骨架参数化接 16（:72503-72596）/34（:72597-72650）——
   *  Resize(盒) → maxPenetrate=−1 → Damage()（死亡 AoE 二次结算）→ Item10 音 →
   *  沿 oldPos（=本批 strip 带：79 60 槽 / 16/34 30 槽,裁定 a ③④）全程 d267 尾迹
   *  迸散（逐点 hue/数量按「距头部」衰减/白影 = Dust.CloneDust 真克隆体——
   *  2026-09-01 终清波真值化）→ 型专属尾段（79 = RainbowRodHit 编排×2 + 14×d66;
   *  16/34 = 20 循环径向尘）。逐型差异全在 KILL_BURST 表（见其头注） */
  private killNow(game: GameHooks): void {
    // ★Kill 幂等头门（P.cs:71755-71758 `if (!active) return;` 1:1）——二次 Kill
    //  no-op（杀拍湿段水death 补 Kill/杀位连射防双爆:死亡 AoE/onProjectileDeath
    //  只结一次）
    if (this.dead) return;
    const spec = KILL_BURST[this.projId];
    if (spec && !this.dead) {
      // Resize(盒) 死亡 AoE（:72428-72434/:72504-72510/:72598-72604）：以弹心为心
      // 128px(79/16)/96px(34) 盒重结算一次伤害
      const R = spec.aoe / 2;
      for (const ent of game.enemies()) {
        const e = ent as MissileEnemyView;
        if (e.dead) continue;
        const ecx = (e.cx ?? e.x + e.w / 2), ecy = (e.cy ?? e.y + e.h / 2);
        if (!(Math.abs(ecx - this.cx) < R + e.w / 2 && Math.abs(ecy - this.cy) < R + e.h / 2)) continue;
        if (!playerCanHitEnemy(e, game, this.projId)) continue;
        // ★BJ489 def-3：Kill 死亡爆掷率=rollVanillaHitCrit（命中拍动态,冻结载体退役）
        const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
        // ★F3 对账收口（蓝队四轮）：Kill 死亡爆 = Resize 后 Damage()
        // 二次结算面 → 双支单源站位（79/16 数据面 magic ⇒ 恒拒=原版同真值,翻旗自动生效）
        const snapBonusRainbow = projectileSnapStrikeBonus(game,
          { projId: this.projId }, ecx, ecy, e.id ?? -1,
          { victimBox: { w: e.w, h: e.h, cx: ecx, cy: ecy } });
        // ★BJ723-C M02（2026-10-26）：死亡爆 AoE 同掷（Kill Resize → Damage() →
        //  :12970 逐受害靶 DV——同 hitStep 面,审计清单漏列的第 7 面,同族并入）
        const dmgKB = damageVarRoll(this.damage, ((game.player as unknown as { luck?: number } | null)?.luck) ?? 0);
        e.hurt(applyBannerDamageDealt(game, e, dmgKB)
          + (snapBonusRainbow ? snapBonusRainbow : 0),
          Math.sign(this.vx) * this.knockback, 0, game, this.armorPen, crit, 0, true);   // ★S02 crit ×2=Enemy.hurt 防后
      }
      // ★BJ727-A（C-D4 族刀,2026-10-27）：Kill 爆 AoE 城镇臂（BJ723-C D4 登记本体清偿）
      //  ——原版 Resize(盒)+penetrate=-1+Damage() 重跑（79 :72432/16 :72510/34 :72604）
      //  victim 循环（:12592）含城镇 voodoo 靶（:12618-12631）;单源 hitTownNpcsAoeBox,
      //  敌怪臂 M02 链镜像（DV :12970+crit :12915-27 逐靶掷）。79/16/34 玩家弹=
      //  playerProj 档（巫毒窄门内无娃娃 no-op）。
      // ★BJ729-A（D4,2026-10-27）：KILL_BURST critter 臂——原版 Resize(盒)+penetrate
      //  =-1+Damage() 重跑 victim 循环（:12592）对小动物同链（79/16/34 非 minion/
      //  sentry → CanNPCBeHit :20675 放行）→ hitCrittersAll 全结算（多靶;主环接触
      //  面 :847/:1689/:1862 hitCritters 单发档与此分立,两 bucket 面各自 1:1）。
      hitCrittersAll({ x: this.cx - R, y: this.cy - R, w: R * 2, h: R * 2, projId: this.projId }, game);
      hitTownNpcsAoeBox(this.cx, this.cy, R, game, this.damage, this.projId, 'playerProj',
        () => ({
          dmg: damageVarRoll(this.damage, ((game.player as unknown as { luck?: number } | null)?.luck) ?? 0),
          crit: this.critChance > 0 && rollVanillaHitCrit(this.projId, game),
          penPercent: this.armorPen,
        }));
      game.playSfxFiles?.(['Item_10'], 1, this.cx, this.cy);
      // 沿 oldPos 尾迹迸散（79 :72436-72487 / 16 :72511-72577 / 34 :72605-72632，
      // 1458 与 1047 彩虹巨石族同构）。
      // ★终清波真值化（2026-09-01）+ MAJOR-4 参数化：消费带 = strip（新→老,[0]=头
      // 与原版 oldPos 同序,故 num=下标即「距头部」）——旧 12 点 push 带退役（裁定 a）。
      // 本段全链：
      //   · 迭代序 = 头（oldPos[0]）→尾；target4 从 Center 起步逐点回走（:72439），
      //     DirectionTo().SafeNormalize(Vector2.Zero)（零长→零向）。
      //   · 主尘 267：NewDust(vector13,w,h,267,0,0,0,newColor) → velocity×=r×0.8 →
      //     noGravity=true → scale=scale267(r) → fadeIn=fadeIn267(r,k67) →
      //     velocity += 向更近点单位向×chase → scale×=k67 →
      //     position=Lerp(盒心,dustPos,lvp2)。16/34 有 Next(3)==0 受理门,未受理走
      //     备支尘（16=d15 / 34=d6,见 KILL_BURST.alt 注）。
      //   · newColor = hslToRgb(hue, 1, lum)——hue/lum 逐型（79 单 rand 相位逐点累进;
      //     16 固定档 4/9+2r/9;34 rand/9）。
      //   · lvp2 = GetLerpValue(N,0,num) = 1−num/N；k67 = Lerp(.3,1,lvp2)；
      //     count = Next(1,count) − decay 表逐阈减（可负 = 不出粒）。
      //   · 克隆仅在主尘成功时进行（:72491 `if (num69 != 6000)` 门 ↔ 引擎池满 null）；
      //     克隆走引擎 VanillaDust.clone 1:1 件（Game.vanillaDust 直读，缺省面静默
      //     跳过——测试桩/池满同兜底语义）。
      interface DustCloneHost { clone(rf: VDust): VDust | null }
      const pts = this.strip;
      const N = pts.length;
      const hue0 = Math.random();
      const dustCloneHost = (game as unknown as { vanillaDust?: DustCloneHost }).vanillaDust;
      let tgx = this.cx, tgy = this.cy;                    // target4（:72438 初值 Center）
      for (let num = 0; num < N; num++) {                  // num=距头部（oldPos 下标语义）
        // ★带坐标 = 本仓 strip 存【中心】（= oldPos+Size/2,Drawer 侧同位）;原文本段
        // 读【左上】oldPos 且 target4 初值是 Center——num=0 的 vector14 因此恒为
        // Size/2 对角向（:72440 DirectionTo(Center)）,逐点回走后 tg=上一点左上、
        // 与左上差分 = 中心差分同向。px/py 取左上以逐字对齐原文几何
        const px = pts[num].x - this.w / 2, py = pts[num].y - this.h / 2;   // vector13=oldPos
        const dl = Math.hypot(tgx - px, tgy - py);
        const uxv = dl > 0 ? (tgx - px) / dl : 0;
        const uyv = dl > 0 ? (tgy - py) / dl : 0;
        tgx = px; tgy = py;                                // target4 = vector13（:72474）
        const lvp2 = 1 - num / N;                          // GetLerpValue(N,0,num)（:72444）
        const k67 = lerp(0.3, 1, lvp2);                    // num67/num75/num81（:72445 系）
        let count = 1 + Math.floor(Math.random() * (spec.count - 1));   // Next(1,count)
        for (const [thr, sub] of spec.decay) {             // :72446-72454 / :72520-72530 / :72615-72625
          if (num >= N * thr) count -= sub;
        }
        const hue = spec.huePhase ? (hue0 + lvp2) % 1 : spec.hueOf!(Math.random());
        const [rr, gg, bb] = hueToRgb(hue, spec.lum);
        for (let k = 0; k < Math.max(count, 0); k++) {
          if (spec.gate267 > 0 && Math.floor(Math.random() * spec.gate267) !== 0) {
            // 备支尘（16 :72570-72588 d15 / 34 :72619-72632 d6；79 无备支）
            const alt = spec.alt!;
            const heavy = alt.heavyGate === true && Math.floor(Math.random() * 2) === 0;
            const ad = game.spawnDust?.(px, py, this.w, this.h,
              alt.type, -this.vx * 0.2, -this.vy * 0.2, 100, null, undefined,
              alt.heavyGate ? heavy : true);
            if (ad) {
              if (heavy) ad.scale *= 2.5;                  // :72623-72626（同一掷定 noGravity+×2.5）
              ad.vx *= 2; ad.vy *= 2;                      // :72576/:72628 velocity×2
              ad.vx += uxv * alt.chase; ad.vy += uyv * alt.chase;   // +=vector17*9 / vector19*6
              ad.scale *= k67;                             // :72579/:72630
              ad.noLight = true; ad.noLightEmittance = true;   // :72585/:72632
              if (alt.fadeInOf) ad.fadeIn = alt.fadeInOf(Math.random(), k67);   // :72583
            }
            continue;
          }
          const dd = game.spawnDust?.(px, py, this.w, this.h,
            267, 0, 0, 0, { r: rr, g: gg, b: bb, a: 255 }, undefined, true);
          if (!dd) continue;                               // num69 != 6000 门（主尘失败无克隆）
          dd.vx *= Math.random() * 0.8;                    // :72446/:72534/:72624
          dd.vy *= Math.random() * 0.8;
          dd.scale = spec.scale267(Math.random()) * k67;   // :72448+:72453 两步覆写并一步
          dd.fadeIn = spec.fadeIn267(Math.random(), k67);  // :72449/:72537/:72628
          dd.vx += uxv * spec.chase;                       // :72452 velocity += vector14*chase
          dd.vy += uyv * spec.chase;
          const ax0 = px + this.w / 2, ay0 = py + this.h / 2;   // vector13+vector15 = Center
          dd.x = ax0 + (dd.x - ax0) * lvp2;                // :72455 position Lerp 盒心钉头
          dd.y = ay0 + (dd.y - ay0) * lvp2;
          const cd = dustCloneHost?.clone(dd as VDust);    // CloneDust(num69)（:72492 系）
          if (cd) {
            cd.scale /= 2;                                 // :72493/:72591/:72637
            if (spec.cloneFadeIn === 'mul0.85') cd.fadeIn *= 0.85;   // :72495（79 专属）
            else cd.fadeIn /= 2;                           // :72593/:72645（16/34 ÷2）
            cd.color = { r: 255, g: 255, b: 255, a: 255 }; // :72496/:72594/:72646
          }
        }
      }
      if (this.projId === 79) {
        // RainbowRodHit 编排粒子 ×2（:72486-72496）——L5 批收编真值本体（六掷虹彩
        // 簇+12×d267 双层）;原版 clientOnly:true 不上网,本地直驱同口径。
        // ★终零波补载荷（:72492 MovementVector=UnitX.RotatedBy(num70·2π)·16,num70
        //  步 0/0.25 → (16,0)/(0,16)):movement 向量进 Spawn_ 的抖动向量与 d267 出速
        // （fx/orchestraFx.rainbowRodHitFx moveX/moveY 消费位）——曾传缺省 0 = 两组
        // 编排完全同参,远端复放与本地皆失一轴偏置。
        rainbowRodHitFx(game, this.cx, this.cy, 16, 0);
        rainbowRodHitFx(game, this.cx, this.cy, 0, 16);
        // 14×d66 随机色 vel×3（:72496-72502）
        for (let i = 0; i < 14; i++) {
          const [rr, gg, bb] = hueToRgb(Math.random());
          const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 66, 0, 0, 100,
            { r: rr, g: gg, b: bb, a: 255 }, 1.7, true);
          if (d) { d.vx *= 3; d.vy *= 3; }
        }
      } else if (spec.tail) {
        // ★MAJOR-4 尾段：Kill 尾 20 循环径向尘（16 :72578-72596 d15 / 34 :72633-72650 d6）
        for (let i = 0; i < 20; i++) {
          const type = spec.tail === 'd15' ? 15 : 6;
          const sx = spec.tail === 'd15' ? 0 : -this.vx * 0.2;
          const sy = spec.tail === 'd15' ? 0 : -this.vy * 0.2;
          const d = game.spawnDust?.(this.x, this.y, this.w, this.h, type, sx, sy,
            spec.tail === 'd15' ? 0 : 100, null, undefined,
            spec.tail === 'd15' ? true : undefined);
          if (d) {
            if (spec.tail === 'd15') {
              d.noGravity = true;                          // :72581
              [d.vx, d.vy] = circularVec2(1.5);            // :72582 NextVector2Circular(1,1)×1.5
              d.scale = 1.2 + Math.random() * 0.5;         // :72583
            } else {
              d.noGravity = true;                          // :72636
              [d.vx, d.vy] = circularVec2(6);              // :72637 ×6
              d.scale = 1.6;                               // :72638
              d.fadeIn = 1.3 + Math.random();              // :72639
            }
            d.noLight = true; d.noLightEmittance = true;   // :72584/:72640
            d.vx += this.vx * (spec.tail === 'd15' ? 0.01 : 0.1);   // :72585/:72641
            d.vy += this.vy * (spec.tail === 'd15' ? 0.01 : 0.1);
          }
          const d2 = game.spawnDust?.(this.x, this.y, this.w, this.h, type, sx, sy, 100,
            null, undefined, undefined);
          if (d2) {
            if (spec.tail === 'd15') {
              d2.vx *= 1.2; d2.vy *= 1.2;                  // :72588
              d2.noLight = true; d2.noLightEmittance = true;
              d2.vx += this.vx * 0.01; d2.vy += this.vy * 0.01;   // :72590
              d2.scale *= 0.8 + Math.random() * 0.2;       // :72592
            } else {
              d2.vx *= 2; d2.vy *= 2;                      // :72644
              d2.noLight = true; d2.noLightEmittance = true;
              d2.vx += this.vx * 0.1; d2.vy += this.vy * 0.1;   // :72647
            }
            const m = 1 + Math.floor(Math.random() * 15);  // Next(1,16)（16 专有 :72586/:72593）
            if (spec.tail === 'd15') { d2.x += d2.vx * m; d2.y += d2.vy * m; }
          }
        }
      }
    }
    this.dead = true;
    const i = ALIVE.indexOf(this);
    if (i >= 0) ALIVE.splice(i, 1);
    game.onProjectileDeath?.(this.projId, this.x, this.y, this.w, this.h);
  }

  draw(r: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D;
    atlas?: NonNullable<import('../render/Renderer').Renderer['atlas']> | null }): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const speed = Math.hypot(this.vx, this.vy);
    // ---- 79 彩虹魔杖（BJ247 2026-09-21 用户实报"粗椭圆团串"定谳+1:1 落刀）----
    //  原版渲染栈（Main.cs 绘制序）：① RainbowRodDrawer.Draw（:28673-28676,
    //  VertexStrip 顶点带 × GameShaders.Misc["RainbowRod"]=obj55 "MagicMissile"
    //  pass,DyeInitializer.cs:471-474）＝细彩虹光线；② 大列表段本体（:33231-33236
    //  覆写 color87=(255,255,255,0) 纯加算白 + :33498-33512 六团彩虹光环）＝头部亮白。
    //  旧实现=stroke 粗线带（StripWidth 半宽误当全宽 ×2=64px 逐段圆头线帽+逐段离散
    //  色相+无 Catmull-Rom 补间+无着色器侵蚀）＝用户截图 2 的"彩色椭圆团串",退役。
    if (this.projId === 79) {
      this.drawRainbowRodTrail(ctx, r as unknown as Renderer);
      this.draw79Head(ctx, r as unknown as Renderer);
      return;
    }
    // ---- 34/16 着色器火带（★MINOR-1：本体【之前】绘——原版 DrawProj 在
    //      Main.cs:28615-28622 由 FlameLashDrawer/MagicMissileDrawer 先绘带,
    //      本体在其后 DrawProjDirect 通用段;旧序=带压本体,倒置）----
    if (this.projId === 34 || this.projId === 16) {
      // SM2 字节码像素面（drawStripTrail）需要 atlas——r 实参=Renderer 本体
      // （Renderer.ts 实体分发 draw(this, cam)），鸭子签名收窄后透传
      this.drawShaderTrail(ctx, r as unknown as Renderer);
    }
    // ---- 16/34 旋转族（Main.cs:33192 族段 + :33192-33236 各型覆写）----
    const img = this.projId === 34 ? projFrameImg(34, this.frame) : projSprite(this.projId);
    if (img) {
      const asImg = img as HTMLImageElement;
      const ready = (img as HTMLCanvasElement).width !== undefined
        ? (img as HTMLCanvasElement).width > 0
        : (asImg.width > 0) && asImg.width > 0;
      if (ready) {
        const lerpS = lerpValue(0, 8, speed);   // GetLerpValue(0,8,|vel|)（:33194/:33222）
        const iw = (img as HTMLCanvasElement).width || asImg.width;
        const ih = (img as HTMLCanvasElement).height || asImg.height;
        if (this.projId === 34) {
          // ★MINOR-2：34 充能白热光环（Main.cs:33680-33694,glow 链段本体前）——
          // redT>0 时 4 份白模本体绕 anchor 公转：offset=(4×t2d,0) RotBy
          // (rot+num387×2π)（num387 0.25 步进 0/.25/.5/.75）、绘制 rotation=本体角、
          // scale=t2d、color105=(255,255,255,127)×0.75=(191,191,191,95) 固定色【无
          // GetAlpha 光乘】。本仓无 glowmask 图集,以本体帧 source-in 白填充等价合成
          // （whiteHot34 按帧缓存）。
          // ★BJ288（红蓝 T1 漏修#2,与 79 黑影 BJ278 同族）：旧直绘 worldCanvas
          //  source-over+α 面 ga=0.373 双重偏差——①被 compositeLight 光乘（原版全亮）
          //  ②source-over 把 α 面当 rgb 权重=rgb 减半且遮挡亮背景（XNA 预乘 AlphaBlend:
          //  rgb 面 191/255 恒加算,α 面 95/255 只进 dst 衰减因子）。收编 BJ278
          //  projFullbrightQueue（compositeLight 后主画布 'lighter' 加算,opaque 底 α
          //  无意义）——ga=rgb 面 191/255;α 面 dst 衰减 (1−texA×95/255) 不建模（79
          //  A=0 同族登记残差,opaque 加算底不可表达）。几何当帧冻结入闭包;mock（无
          //  队列方法）回退直绘保持既有验证链。
          const t2d = lerpValue(0, 6, this.redT);          // lerpValue10（:33682 GetLerpValue(0,6,localAI[0])）
          if (t2d > 0) {
            const wf = whiteHot34(this.frame);
            if (wf) {
              const drawRot = lerpS * this.rot - Math.PI / 2 * lerpS;   // num340（:33223/:33225）
              const ax = this.cx - this.vx / 2, ay = this.cy - this.vy / 2;   // vector81（:33229）
              const rw = wf.width * t2d, rh = wf.height * t2d;
              const drawAura = (c: CanvasRenderingContext2D): void => {
                c.save();
                c.globalCompositeOperation = 'lighter';
                c.imageSmoothingEnabled = false;
                c.globalAlpha = 191 / 255;               // color105.rgb 面=(255×0.75) 截断入 byte
                for (let k = 0; k < 4; k++) {
                  const oa = drawRot + k * 0.25 * Math.PI * 2;          // num387×2π 步进
                  c.save();
                  c.translate(ax + Math.cos(oa) * 4 * t2d, ay + Math.sin(oa) * 4 * t2d);
                  c.rotate(drawRot);
                  c.drawImage(wf, -rw / 2, -rh / 2, rw, rh);            // scale16=t2d
                  c.restore();
                }
                c.restore();
              };
              const q = (r as unknown as {
                queueProjFullbright?: (fn: (c: CanvasRenderingContext2D) => void) => void;
              } | undefined)?.queueProjFullbright;
              if (typeof q === 'function') q.call(r, drawAura);
              else drawAura(ctx);
            }
          }
        }
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        if (this.projId === 16) {
          // :33192-33199：rotation×lerp8；scale 0.6、X lerp(1,1.5)、Y lerp(1,0.8)；
          // SetDefaults alpha100 → GetAlpha ≈ (255−100)/255
          ctx.globalAlpha = 155 / 255;
          ctx.translate(this.cx, this.cy);
          ctx.rotate(this.rot * lerpS);
          const sx = 0.6 * lerp(1, 1.5, lerpS) * this.drawScale;
          const sy = 0.6 * lerp(1, 0.8, lerpS) * this.drawScale;
          ctx.drawImage(img as CanvasImageSource, -iw * sx / 2, -ih * sy / 2, iw * sx, ih * sy);
        } else {
          // ★裁定 b（2026-09-02 J′）：:33229-33236 rotation = lerp9×(rot−π/2)、
          // X scale lerp(1,0.8)、绘制位 = oldPos[0]+Size/2−vel/2。oldPos[0] 是
          // 【本拍位移后】心（P.cs:17246 mode-3 记录在位移后写 oldPos[0]=position）,
          // 即 this.cx——旧码用 prevCx（拍前心）= 整体落后一个位移步;
          // 注释原引 Main.cs:32436 系 stale 行号（1456 基线遗留）,更正为 :33229。
          ctx.translate(this.cx - this.vx / 2, this.cy - this.vy / 2);
          ctx.rotate(lerpS * this.rot - Math.PI / 2 * lerpS);
          const sx = lerp(1, 0.8, lerpS) * this.drawScale;
          const sy = this.drawScale;
          ctx.drawImage(img as CanvasImageSource, -iw * sx / 2, -ih * sy / 2, iw * sx, ih * sy);
        }
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }
  }

  /** 34/16 着色器火带拖尾（T1 清偿 2026-09-02;★2026-09-03 SM2 字节码化——像素面从
   *  四边形 fill 近似迁 drawStripTrail 的 obj55 "MagicMissile" pass 逐像素执行
   *  （FlameLash/MagicMissile 两技术同 pass,只差三张噪声贴图 + UseSaturation 钉值,
   *  由 TrailShader.EXTRA_SETS 按 set 携带）。顶点带 = strip（TrailingMode 3,30 槽,
   *  [0]=最新与 XNA oldPos[0] 同序）;顶点色/宽 = StripColors/StripWidth 逐值转录,
   *  通道按 XNA Color 语义逐段 byte 化（Lerp/乘法后 round）;uOpacity 回归原版独立
   *  通道（FlameLashDrawer.cs:17 Lerp(4,8,t2d) / MagicMissileDrawer.cs:16 =2）——
   *  顶点 A 不再把 opacity 折算（A/=8 → fade/8、A/=2 → fade/2,StripColors 原值）;
   *  uTime = globalT（GlobalTimeWrappedHourly 同口径,秒）。netPuppet 不跑
   *  stripRecord → 无带（同 79 拖尾既有限制）。 */
  private drawShaderTrail(ctx: CanvasRenderingContext2D, renderer: Renderer): void {
    const pts = this.strip;
    const N = pts.length;
    if (N < 2) return;
    const flame = this.projId === 34;
    const t2d = flame ? lerpValue(0, 6, this.redT) : 0;   // transitToDark（FlameLashDrawer.cs:14）
    // XNA Color byte 化两语义（2026-09-03 复核钉死）：Color.Lerp → float ctor =
    // round；Color.op_Multiply(Color,float) = (byte) cast = 【向零截断】——两路
    // 不得混用（旧 byte() 单 helper=round 曾把乘法档也 round,fade=1 时 A/8 差 1）
    const rnd = (v: number): number => Math.round(v);
    const trn = (v: number): number => Math.max(0, Math.min(255, Math.trunc(v)));
    const trailPts: TrailPt[] = [];
    for (let i = 0; i < N; i++) {
      const p = i / (N - 1);                    // progressOnStrip（0 头=最新 → 1 尾）
      const fade = 1 - lerpValue(0, 0.98, p);   // 尾淡出因子（两 Drawer 共有）
      let rC: number, gC: number, bC: number, aC: number, hwC: number;
      if (flame) {
        const lv = lerpValue(-0.1 * t2d, 0.7 - 0.2 * t2d, p);            // StripColors :26
        // Color.Lerp(Color.Lerp(W,O,t2d·0.5), Red, lv)：内层/外层各 round 一次
        const ig = rnd(lerp(255, 165, t2d * 0.5)), ib = rnd(lerp(255, 0, t2d * 0.5));
        const og = rnd(lerp(ig, 0, lv)), ob = rnd(lerp(ib, 0, lv));     // 外层 Lerp(·,Red,lv)：R 恒 255
        // × fade = op_Multiply (byte) 截断（:27 尾乘）——★复核批补：曾整段丢
        //  fade 因子（带尾 rgb 不衰减,只有 alpha 单边淡出）
        rC = trn(255 * fade);
        gC = trn(og * fade);
        bC = trn(ob * fade);
        aC = trn(trn(255 * fade) / 8);          // result.A /= 8（byte 整除,:29）
        let wv = lerpValue(0, 0.06 + t2d * 0.01, p);                     // StripWidth :34
        wv = 1 - (1 - wv) * (1 - wv);                                    // :35
        hwC = lerp(24 + t2d * 16, 8, p) * wv;                            // :36 半宽
      } else {
        const k = lerpValue(0, 0.7, p);                                  // StripColors :25
        const vr = rnd(lerp(255, 238, k)), vg = rnd(lerp(255, 130, k)), vb = rnd(lerp(255, 238, k));
        rC = trn(vr * fade);                    // Lerp(W,Violet,k)×fade（截断）
        gC = trn(vg * fade);
        bC = trn(vb * fade);
        aC = trn(trn(255 * fade) / 2);          // result.A /= 2（byte 整除,:27）
        hwC = lerp(26, 32, lerpValue(0, 0.2, p)) * lerpValue(0, 0.07, p);  // :32 半宽
      }
      trailPts.push({ x: pts[i].x, y: pts[i].y, hw: hwC,
        r: rC / 255, g: gC / 255, b: bC / 255, a: aC / 255 });
    }
    // ★2026-09-03 黑椭圆止血：条带拖尾改入全亮队列（renderer.flushTrailShade 在
    //  compositeLight 后直绘主画布 'lighter' 加算——原 worldCanvas 直绘经保 α 的
    //  source-over 回填=次暗像素替换背景落黑块）;mock（探针/测试）无队列方法时
    //  回退直绘保持既有验证链
    const spec: TrailSpec = {
      set: flame ? 'FlameLash' : 'MagicMissile',
      pts: trailPts,
      opacity: flame ? lerp(4, 8, t2d) : 2,     // UseOpacity（FlameLashDrawer.cs:17 / :16）
      time: this.globalT,                        // GlobalTimeWrappedHourly（秒,%3600）
    };
    const q = (renderer as unknown as { queueTrailShade?: (s: TrailSpec) => void }).queueTrailShade;
    if (typeof q === 'function') q.call(renderer, spec);
    else drawStripTrail(ctx, renderer, spec);
  }

  /** 79 彩虹拖尾——RainbowRodDrawer.cs:12-37 + VertexStrip.cs:69-120 逐行 1:1
   *  （BJ247；旧 stroke 粗线带退役,见 draw() 内注释。netPuppet 不跑 stripRecord →
   *  无带早退,同 34/16 既有限制）。
   *  ①顶点带=strip（TrailingMode 3,60 槽,[0]=最新；VertexStrip :73 逐 oldPos 正序
   *    入带 ⇒ progressOnStrip 0=头（弹侧）1=尾；紧凑带 ≡ 原版零槽停机——SetDefaults
   *    P.cs:725-735 把 oldPos 全槽清零、Drawer :73 遇零停）。
   *  ②oldRot 复刻（P.cs:17261-17265 mode-3 逐拍重算）：rot[0]=AI rotation（
   *    :44156-44163 同款 this.rot）；rot[i≥1]=(oldPos[i−1]−oldPos[i]).SafeNormalize
   *    (default).ToRotation()——零距=default 向量→ToRotation=0。
   *  ③PrepareStripWithProceduralPadding（:69-120）：逐对 |WrapAngle(Δrot)|≥15° →
   *    num3=⌊|Δ|/(π/12)⌋ → num3+1 个 Catmull-Rom 内插点（控制点=两端沿各自 rot
   *    外伸 segLen :91-92；内插点 rot=指向 target(前一点)方向,零距=NaN→上点 rot
   *    :99-103——Utils.DirectionTo=裸 Normalize :2076-2078,零向量→NaN）。
   *  ④StripColors（:23-29）：value=hslToRgb((p*1.6−GlobalTime)%1,1,.5)→
   *    Lerp(White,value,GetLerpValue(−0.2,0.5,p,clamp))×(1−GetLerpValue(0,0.98,p)
   *    【缺省无 clamp,p>0.98 负值→trn 归零,同 34/16 截断语义】)；A=0——XNA α=0
   *    纯加算习语：obj55 inst#15 顶点 α 只进 out.a、加算 (One,·) 面 rgb 无消费;
   *    TrailShader 的 ca 门（TrailShader.ts:340）为 34/16 淡出面设 → 顶点 a 传 1
   *    过门（登记注）。色相取值域：原版 %1f 保号可负（−1,0）——Main.hslToRgb 的
   *    hue2rgb 单次 c++ 包绕+byte 回绕恰≈模 1 包绕（两补数截断 mod 256 ≡ mod 1,
   *    差 ≤1 byte）,hueToRgb 全包绕等价。
   *  ⑤StripWidth（:31-37）=【半宽】Lerp(0,32,1−(1−lerp(0,0.2,p))²)（AddVertexPair
   *    pos±(rot−π/2)·hw,VertexStrip.cs:153-159；旧实现误当全宽 ×2=64px=粗团根因）。
   *  ⑥uOpacity=4（:16 UseOpacity(4f)）、uTime=globalT（GlobalTimeWrappedHourly）、
   *    UseSaturation(−2.8f)=EXTRA_SETS.RainbowRod.sm2 既有钉值。 */
  private drawRainbowRodTrail(ctx: CanvasRenderingContext2D, renderer: Renderer): void {
    const raw = this.strip;
    const N = raw.length;
    if (N < 2) return;                            // DrawTrail :206（<2 顶点对=退化带）
    const rots: number[] = new Array(N);          // oldRot 复刻（见注②）
    rots[0] = this.rot;
    for (let i = 1; i < N; i++) {
      const dx = raw[i - 1].x - raw[i].x, dy = raw[i - 1].y - raw[i].y;
      rots[i] = dx === 0 && dy === 0 ? 0 : Math.atan2(dy, dx);
    }
    // PrepareStripWithProceduralPadding（见注③）
    const px: number[] = [], py: number[] = [], pr: number[] = [];
    for (let i = 0; i < N; i++) {
      px.push(raw[i].x); py.push(raw[i].y);
      const rot = wrapAngle(rots[i]);
      pr.push(rot);
      if (i + 1 >= N) break;                      // :79-82（紧凑带零停等价）
      const rot2 = wrapAngle(rots[i + 1]);
      const num3 = Math.floor(Math.abs(wrapAngle(rot2 - rot)) / (Math.PI / 12));   // :85
      if (num3 === 0) continue;                   // :86-89
      const segLen = Math.hypot(raw[i + 1].x - raw[i].x, raw[i + 1].y - raw[i].y); // :90
      const c1x = raw[i].x + Math.cos(rot) * segLen, c1y = raw[i].y + Math.sin(rot) * segLen;          // :91
      const c2x = raw[i + 1].x - Math.cos(rot2) * segLen, c2y = raw[i + 1].y - Math.sin(rot2) * segLen; // :92
      const num5 = num3 + 2, step = 1 / num5;                                      // :93-94
      let tx = raw[i].x, ty = raw[i].y;                                            // :95
      for (let k = 1; k < num5; k++) {                                             // :96
        const t = k * step;
        // MonoGame Vector2.CatmullRom(p1,p2,p3,p4,t)：0.5×(2p2+(−p1+p3)t+(2p1−5p2+4p3−p4)t²+(−p1+3p2−3p3+p4)t³)
        const t2 = t * t, t3 = t2 * t;
        const x0 = raw[i].x, y0 = raw[i].y, x1 = raw[i + 1].x, y1 = raw[i + 1].y;
        const qx = 0.5 * (2 * x0 + (x1 - c1x) * t + (2 * c1x - 5 * x0 + 4 * x1 - c2x) * t2 + (3 * x0 - c1x - 3 * x1 + c2x) * t3);
        const qy = 0.5 * (2 * y0 + (y1 - c1y) * t + (2 * c1y - 5 * y0 + 4 * y1 - c2y) * t2 + (3 * y0 - c1y - 3 * y1 + c2y) * t3);
        const ddx = tx - qx, ddy = ty - qy;       // :99 DirectionTo(target)
        const rotN = (ddx === 0 && ddy === 0) ? pr[pr.length - 1]                    // Normalize(0)=NaN→Last
          : wrapAngle(Math.atan2(ddy, ddx));
        px.push(qx); py.push(qy); pr.push(rotN);
        tx = qx; ty = qy;                         // :106 target=vector3
      }
    }
    // 顶点对：StripColors/StripWidth 逐值；progressOnStrip=j/(count−1)（:116）
    const count = px.length;
    if (count < 2) return;
    const trn = (v: number): number => Math.max(0, Math.min(255, Math.trunc(v)));  // op_Multiply 截断
    const pts: TrailPt[] = [];
    for (let j = 0; j < count; j++) {
      const p = j / (count - 1);
      const g = lerpValue(0, 0.2, p);                             // :34 clamped
      const hw = 32 * (1 - (1 - g) * (1 - g));                    // :35-36 半宽
      const [hr, hg, hb] = hueToRgb(p * 1.6 - this.globalT);      // :25（%1 包绕在 hueToRgb 内）
      const lv = lerpValue(-0.2, 0.5, p);                         // :26 clamped
      const fade = 1 - p / 0.98;                                  // :26 缺省无 clamp
      pts.push({
        x: px[j], y: py[j], hw,
        r: trn(Math.round(lerp(255, hr, lv)) * fade) / 255,       // Lerp→Round、×fade→截断
        g: trn(Math.round(lerp(255, hg, lv)) * fade) / 255,
        b: trn(Math.round(lerp(255, hb, lv)) * fade) / 255,
        a: 1,                                                     // XNA A=0 过门面（见注④）
      });
    }
    const spec: TrailSpec = { set: 'RainbowRod', pts, opacity: 4, time: this.globalT };
    const q = (renderer as unknown as { queueTrailShade?: (s: TrailSpec) => void }).queueTrailShade;
    if (typeof q === 'function') q.call(renderer, spec);
    else drawStripTrail(ctx, renderer, spec);
  }

  /** 79 头部（Main.cs 大列表段 :33143（79 在列）→ :33231-33236 覆写 → :33498-33512
   *  光环支 → :33558-33562 公共本体绘制段）。绘制序=光环 6 团 → 本体白团。
   *  ★BJ247 两处修正（BJ228 域,源码定谳）：
   *  · 本体【双绘】1:1——光环支尾 :33511 与公共绘制段 :33558-33562 同参
   *    (value95, vector81=中心, null, color87, num340=0, origin=中心, vector82,
   *    dir=None) 各绘一次,加算 ≡ 2×亮;旧实现只画一次。
   *  · spawn 回退退役——P.cs:725-735 SetDefaults 把 oldPos 全槽【清零】,全文件
   *    oldPos 写点仅六处 mode 记录段 oldPos[0]=position（:17203/17213/17242/17254/
   *    17287/17299）,无任何 position 预填 → 出生 12 拍内 oldPos[12]=Vector2.Zero,
   *    :33234 dist(position,(0,0))=|position|≫32 → GetLerpValue=0 → scale=0
   *    【本体不可见】。旧回退"strip<12 → 取最新记录=dist 0 满亮"偏离原版,退役
   *    （紧凑 strip[12] 存在 ⇔ oldPos[12] 非零,与 Drawer 零停判据同构）。
   *  vector82 = proj.scale(79=1)×GetLerpValue(32,0,dist(position,oldPos[12]))
   *  （:33233-33235,BJ228 s79 等价式）；num340=0；color87=(255,255,255,0) 纯加算白
   *  → 'lighter' ga=1（A=0 预乘直译,BJ228 既定口径）。
   *  光环（:33499-33511）：scale13=vector82×1.4;自转轴径=2×scale13.X+cos(2πT)×0.4
   *  （RotatedBy(num340+2πT)）,6 团各再转 i/6·2π;色=hslToRgb(i/6,1,.5)×0.3
   *  【op_Multiply 截断入 byte,折进染色纹理】、A=0 加算;rotation=num340=0、
   *  origin=中心。 */
  private draw79Head(ctx: CanvasRenderingContext2D, renderer?: Renderer): void {
    if (this.strip.length < 13) return;           // oldPos[12]=零槽 → scale 0（见注）
    const img = projSprite(79);
    if (!img || img.width <= 0) return;
    const ref = this.strip[12];
    const s79 = Math.max(0, Math.min(1, 1 - Math.hypot(this.cx - ref.x, this.cy - ref.y) / 32));
    if (s79 <= 0.01) return;                      // GetLerpValue(32,0,·)≈0（快速飞行段）
    const twoPi = Math.PI * 2;
    const T = this.globalT;
    const spinR = 2 * (1.4 * s79) + Math.cos(T * twoPi) * 0.4;     // :33500 轴径
    const iw = img.width, ih = img.height;
    const cx = this.cx, cy = this.cy;
    // ---- BJ278 全亮队列（2026-09-22 用户实报"引导期光芒有黑影"）----
    //  原版 :33235 对 79 无条件覆写 color87=(255,255,255,0)（:33165 常规
    //  GetAlpha(projectileColor) 光乘被覆）=【不吃光照乘】;A=0 ⇒ XNA 预乘
    //  AlphaBlend dst 因子=1 ⇒ 纯加算 raw rgb、永不遮挡。旧直绘 worldCanvas
    //  双重偏差：①'tighter'连 α 一起加 → worldCanvas 经 compositeLight 保 α +
    //  source-over 回主画布 ⇒ 光环 texel α 遮挡亮背景+×0.3 染色低 rgb 替换
    //  =星体四周暗块（亮背景可见,夜/不透明墙域不可见——探针分账定谳）;
    //  ②被 compositeLight 光乘（原版全亮）。挪 compositeLight 后主画布
    //  'lighter' 加算（opaque 底 α 无意义）=与拖尾 trailShadeQueue 同族同门
    //  （2026-09-03 黑椭圆先例）。几何当帧冻结入闭包;mock（无队列方法）回退
    //  直绘保持既有验证链。
    const drawHead = (c: CanvasRenderingContext2D): void => {
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.imageSmoothingEnabled = false;
      for (let i = 0; i < 6; i++) {               // :33501-33509 六团彩虹光环
        const h79 = hueToRgb(i / 6, 0.5);
        const tinted = tinted79(img, [
          Math.max(0, Math.min(255, Math.trunc(h79[0] * 0.3))),    // ×0.3 截断（:33505）
          Math.max(0, Math.min(255, Math.trunc(h79[1] * 0.3))),
          Math.max(0, Math.min(255, Math.trunc(h79[2] * 0.3))),
        ]);
        if (!tinted) continue;
        const ang = T * twoPi + (i / 6) * twoPi; // :33500/:33502 两次 RotatedBy 合成
        const w = iw * 1.4 * s79, h = ih * 1.4 * s79;
        c.drawImage(tinted, cx + Math.cos(ang) * spinR - w / 2,
          cy + Math.sin(ang) * spinR - h / 2, w, h);
      }
      const w = iw * s79, h = ih * s79;           // :33511 + :33558-33562 双绘
      c.drawImage(img, cx - w / 2, cy - h / 2, w, h);
      c.drawImage(img, cx - w / 2, cy - h / 2, w, h);
      c.restore();
    };
    const q = (renderer as unknown as { queueProjFullbright?: (fn: (c: CanvasRenderingContext2D) => void) => void } | undefined)
      ?.queueProjFullbright;
    if (typeof q === 'function') q.call(renderer, drawHead);
    else drawHead(ctx);
  }
}

// ===================== 飞刀 491（aiStyle 9 的 Old 分支，AI_009_MagicMissiles_Old） =====================

/**
 * proj 491（SetDefaults :5131-5139：26×26 aiStyle9 friendly melee penetrate−1）——
 * item 3030 飞刀（Item.cs:28055 起——★BJ665 勘正 伪锚 :28029-28045：channel、useStyle1、shootSpeed17、dmg40、
 * noMelee）。AI_009 入口 :43998-44002 把 type==491 整体转投 Old 分支（:44231 起——★BJ665 勘正 伪锚 :40520-40524/:40753-40910），
 * 与本文件新导弹（光标点对齐 + 松手索敌/直飞）语义完全不同：
 *   · channel 期间（:40757-40830）：距光标 ≥100px → 速度朝光标方向 4:1 收敛
 *     （上限 20px/t，:40794-40817）；<100px → 只沿当前方向 ×1.1 加速并自锁
 *     ai[0]=−10 计数（:40778-40793）——近距是"悬停绕圈"不是贴脸瞬移；
 *   · 松手（:40832-40863）：491 不重瞄鼠标，ai[0]=1 直接回收；
 *   · 回收（:40869-40880）：localAI[0]>15 后穿墙，速度朝玩家 5:1 收敛到 25px/t，
 *     距玩家 <20px 消失；
 *   · 撞块（:18576-18587 type 491 支;★S1 行号漂移勘误 BJ263——旧引 :17053-17066 系湿段尘区,非反弹支）：双轴反弹（lastVelocity 取反），操控态自锁 ai[0]=−10；
 *   · 距玩家 >2000px 消失（:40894-40897）；穿透 −1（同敌 10t 冷却后可再中）。
 */
export interface FlyingKnifeCtor {
  /** channel 电平（:40757 player.channel && HeldItem.shoot==491——Game 侧
   *  mouseHeld+持物 id+未死 的既有口径） */
  channelCb: () => boolean;
  /** 光标世界坐标（Main.MouseWorld :40769）。★2026-08-31 台账 A6 清偿：消费侧
   *  steer() 先经 limitPointToPlayerReachableArea 钳进玩家可达区（原版
   *  Projectile.cs:44249 同位），"未建模登记偏差"就此关闭 */
  aimCb: () => { x: number; y: number };
}

export class FlyingKnifeProj extends Entity {
  readonly projId = 491;
  damage: number;
  knockback: number;
  /** 暴击总概率（spawn 侧注入，同 mArrow 口径） */
  critChance = 0.04;
  /** 护甲穿透（spawn 注入，命中传 hurt 减防） */
  armorPen = 0;
  dead = false;
  w = 26; h = 26;                        // :5132-5133
  /** ai[0]：≤0 操控（−10..−1 自锁计数，:40791）/ 1 松手回收（:40862） */
  private ai0 = 0;
  /** localAI[0]（:40868——回收延迟计数） */
  private localT = 0;
  /** rotation（:40882-40893：ai0<0/零速 自旋 0.3、ai0>0 按 direction 自旋、否则 atan2+π/2） */
  private rot = 0;
  /** projectile.direction（原版 Update 按 velocity.X 符号刷新的近似） */
  private dir = 1;
  /** timeLeft（SetDefaults 缺省 3600，:526） */
  private timeLeft = 3600;
  // ---- ★通用湿段(Projectile.cs:16903-17113 全体弹共用段,2026-09-06 终波;491 非豁免
  //  ——SetDefaults :5132-5133 无 ignoreWater 行,数据面缺行=受段)----
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  wetCount = 0;
  presetDone = false;
  private wetSectionRan = false;
  /** AI 前速度快照(:16870 wetVelocity 语义)——回收态(tileCollide=false)湿位移消费
   *  此快照(无阻尼滞后一子步 quirk,UpdatePosition :20549-20562 分叉,Boomerang/
   *  YoyoProj 回收态同款先例) */
  private preVx = 0;
  private preVy = 0;
  /** 回收段 tileCollide=false（:40871） */
  private passTiles = false;
  /** 同敌冷却（NPC.immune[owner]=10——:13189-13192 penetrate≠1 缺省档） */
  private hitCd = new Map<number, number>();
  private channelCb: () => boolean;
  private aimCb: () => { x: number; y: number };

  constructor(x: number, y: number, vx: number, vy: number, damage: number, knockback: number,
    o: FlyingKnifeCtor) {
    super();
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.damage = damage; this.knockback = knockback;
    this.channelCb = o.channelCb; this.aimCb = o.aimCb;
    if (vx !== 0) this.dir = vx > 0 ? 1 : -1;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    this.wetSectionRan = false;
    this.preVx = this.vx; this.preVy = this.vy;   // :16870 AI 前快照(回收态湿位移源)
    if (--this.timeLeft <= 0) { this.killNow(game); this.wetSectionStep(game); return; }   // 杀拍湿段(原版湿段无 active 门)
    for (const [k, v] of this.hitCd) {
      if (v <= 1) this.hitCd.delete(k); else this.hitCd.set(k, v - 1);
    }
    this.steer(game);                      // :40753-40909（操控/回收/姿态/2000px 门）
    this.wetSectionStep(game);             // ★活拍湿段(原版序 AI:16880→湿段:16903→HandleMovement:17120)
    if (this.dead) return;
    this.moveStep(game);                   // 撞块反弹 :18576-18587（★BJ263 勘误旧引 :17053-17066）/ 回收穿墙 :40871
    if (this.dead) return;
    this.hitStep(game);                    // 穿透 −1：10t 冷却后同敌可再中
  }

  /** ★⑥杀拍口径(Arrow.ts wetSectionStep 同配方):活拍=steer 后/moveStep 前,杀拍=
   *  timeLeft/steer killNow 早退支补跑;wetSectionRan 防同子步双跑。 */
  private wetSectionStep(game: GameHooks): void {
    if (this.wetSectionRan) return;
    this.wetSectionRan = true;
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, false);
  }

  /** AI_009_MagicMissiles_Old（:40753-40910） */
  private steer(game: GameHooks): void {
    const p = game.player;
    // ---- 操控/松手分流（:40755-40863）----
    if (this.ai0 <= 0) {
      if (this.channelCb()) {
        const num = 20;                    // :40764-40767（491 专属上限）
        // ★2026-08-31 台账 A6 清偿（Projectile.cs:44247-44249）：光标先钳进玩家可达区
        // （LimitPointToPlayerReachableArea，Player.cs:45832-45861——★BJ665 勘正 伪锚 :45830-45858 盒=1920×1200 中心
        // 玩家∩世界边框内缩 640px）再算距离——曾直追原始 MouseWorld 导致"距光标<100px
        // 刹车/悬停环"在大屏/越界光标下永远不可达（未建模登记就此关闭）
        const raw = this.aimCb();
        const lim = limitPointToPlayerReachableArea(raw.x, raw.y, p.cx, p.cy,
          game.world.store.w * TILE, game.world.store.h * TILE);
        const dx = lim[0] - this.cx, dy = lim[1] - this.cy;
        const d = Math.hypot(dx, dy);      // :40773
        if (this.ai0 < 0) this.ai0 += 1;   // :40774-40777（自锁计数回卷）
        if (d < 100) {                     // :40778-40793 近距：只加速 + 自锁 −10
          if (Math.hypot(this.vx, this.vy) < num) {
            this.vx *= 1.1; this.vy *= 1.1;
            const sp = Math.hypot(this.vx, this.vy);
            if (sp > num) { this.vx = this.vx / sp * num; this.vy = this.vy / sp * num; }
          }
          if (this.ai0 === 0) this.ai0 = -10;
        } else if (d > num) {              // :40794-40817（491 在 d≥100 时恒真）
          this.vx = (this.vx * 4 + dx / d * num) / 5;   // :40807-40811
          this.vy = (this.vy * 4 + dy / d * num) / 5;
        } else {                           // :40818-40830（d∈(20,100) 被 <100 支截，不可达）
          this.vx = dx; this.vy = dy;
        }
      } else if (this.ai0 <= 0) {
        this.ai0 = 1;                      // :40832-40863（491 不重瞄鼠标）
      }
    }
    // ---- 回收/姿态/射程/尘（:40866-40909，两相恒跑）----
    this.localT += 1;                      // :40868
    if (this.ai0 > 0 && this.localT > 15) {
      this.passTiles = true;               // :40871
      const dx = p.cx - this.cx, dy = p.cy - this.cy;
      const d = Math.hypot(dx, dy);
      if (d < 20) { this.killNow(game); return; }       // :40873-40876
      const ux = d > 0 ? dx / d : 0, uy = d > 0 ? dy / d : 0;
      this.vx = (this.vx * 5 + ux * 25) / 6;            // :40877-40879
      this.vy = (this.vy * 5 + uy * 25) / 6;
    }
    if (this.ai0 < 0 || (this.vx === 0 && this.vy === 0)) this.rot += 0.3;      // :40882-40885
    else if (this.ai0 > 0) this.rot += 0.3 * this.dir;                          // :40886-40889
    else this.rot = Math.atan2(this.vy, this.vx) + Math.PI / 2;                 // :40890-40893
    if (this.vx !== 0) this.dir = this.vx > 0 ? 1 : -1;
    if (Math.hypot(this.cx - p.cx, this.cy - p.cy) > 2000) { this.killNow(game); return; } // :40894-40897
    // 尘（:40898-40909：1/2 概率，15/57/58 三色随机、初速 = 速度×0.25 后再 ×0.25）
    if (Math.random() < 0.5) {
      const c = ['#9CD8FF', '#FFD080', '#FFA050'][Math.floor(Math.random() * 3)];
      game.spawnParticles((this.cx + this.x) / 2, (this.cy + this.y) / 2, c, 1, 0.7, { life: 18 });
    }
  }

  /** 移动 + 撞块反弹（:18576-18587 type 491 支——双轴 lastVelocity 取反 + 操控态自锁 −10;★S1 行号漂移勘误 BJ263,旧引 :17053-17066） */
  private moveStep(game: GameHooks): void {
    if (this.passTiles) {
      // 回收态 tileCollide=false(:40871)→湿位移消费 AI 前快照(无阻尼滞后 quirk;干态=当拍速)
      this.x += this.wet ? this.preVx : this.vx;
      this.y += this.wet ? this.preVy : this.vy;
      return;
    }
    const st = game.world.store;
    const drag = projWaterDragFactor(this);   // 操控态 tileCollide=true→湿阻尼乘位移(速度场不减)
    const solidBox = (x: number, y: number): boolean => {
      const x0 = Math.floor(x / TILE), y0 = Math.floor(y / TILE);
      const x1 = Math.floor((x + this.w - 1) / TILE), y1 = Math.floor((y + this.h - 1) / TILE);
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        if (st.inBounds(tx, ty) && st.isSolid(tx, ty)) return true;
      }
      return false;
    };
    const lvx = this.vx, lvy = this.vy;
    let hitX = false, hitY = false;
    const nx = this.x + this.vx * drag;
    if (solidBox(nx, this.y)) hitX = true; else this.x = nx;
    const ny = this.y + this.vy * drag;
    if (solidBox(this.x, ny)) hitY = true; else this.y = ny;
    if (!hitX && !hitY) return;
    game.spawnParticles(this.cx, this.cy, '#A09080', 3, 1.5, { life: 14, size: 2 });
    game.playSfx('dig', 1, this.cx, this.cy);
    if (this.ai0 <= 0) this.ai0 = -10;     // :17055-17058
    if (hitX && lvx !== 0) this.vx = -lvx; // :17059-17062
    if (hitY && lvy !== 0) this.vy = -lvy; // :17063-17066
  }

  /** 命中结算（穿透 −1：10t 冷却；StatusNPC 表驱动；直飞 Arrow 同口径） */
  private hitStep(game: GameHooks): void {
    const world = game.world;
    const tx = Math.floor((this.x + this.w / 2) / TILE);
    const ty = Math.floor((this.y + this.h / 2) / TILE);
    if (!world.store.inBounds(tx, ty)) { this.killNow(game); return; }
    game.cutTile(tx, ty);                  // CutTiles（挥砍草/陶罐同链）
    if (hitCritters(this, game)) return;
    if (hitTownNpcs(this, game, this.damage, Math.sign(this.vx) * 2)) return;
    for (const ent of game.enemies()) {
      if (!playerCanHitEnemy(ent, game, this.projId)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
      const e = ent as MissileEnemyView;
      if (e.dead) continue;
      if (!(this.x < e.x + e.w && this.x + this.w > e.x && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
      const cd = this.hitCd.get(e.id) ?? 0;
      if (cd > 0) continue;
      this.hitCd.set(e.id, 10);
      // ★BJ489 def-3：491 掷率=rollVanillaHitCrit（melee 旗,命中拍动态;冻结载体退役）
      const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
      const dmg = damageVarRoll(this.damage, ((game.player as unknown as { luck?: number } | null)?.luck) ?? 0);   // ★BJ723-C D1 清偿（BJ725-A）:DV :12970 逐靶掷——★S02:crit ×2 移 Enemy.hurt 防后(NPC.cs:82067)
      // + 催化指环 6185（StatusNPC :11192-11196,玩家弹命中 398 300t）
      applyProjStatus(this.projId, e as unknown as Record<string, number>,
        { catalystBand: ((game.player as unknown as { equipStats?: { catalystBand?: boolean } } | null)?.equipStats?.catalystBand) === true });
      // ★焰爆石+拍击石弹幕双支位（Projectile.cs:13439-13446；F3/F1 收编升级）——
      // 飞刀 491 数据面 melee（SetDefaults 类旗投影）→ 过 kind1 门即脉冲、kind0 门
      // 天然拒；返回 num14 加伤随暴击并入实伤参
      const snapBonusKnife = projectileSnapStrikeBonus(game, this,
        (e as { cx?: number }).cx ?? e.x + e.w / 2, (e as { cy?: number }).cy ?? e.y + e.h / 2,
        e.id, { victimBox: { w: e.w, h: e.h,
          cx: (e as { cx?: number }).cx ?? e.x + e.w / 2,
          cy: (e as { cy?: number }).cy ?? e.y + e.h / 2 } });
      e.hurt(applyBannerDamageDealt(game, e, dmg)
        + (snapBonusKnife ? snapBonusKnife : 0),
        Math.sign(this.vx) * this.knockback, 0, game, this.armorPen, crit, 0, true);   // 音/飘值=单点
    }
  }

  private killNow(game: GameHooks): void {
    this.dead = true;
    game.onProjectileDeath?.(this.projId, this.x, this.y, this.w, this.h);
  }

  draw(r: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const img = projSprite(this.projId);
    if (!img || !(img.width > 0) || img.width === 0) return;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.rot);                  // GetAlpha 恒白（:76286-76291），无淡入
    ctx.drawImage(img, -this.w / 2, -this.h / 2, this.w, this.w * img.height / img.width);
    ctx.restore();
  }
}

// ===================== 老星怒落星（proj 9，aiStyle 5） =====================

/**
 * proj 9（SetDefaults :626-636：24×24 aiStyle5 penetrate2 scale0.8 tileCollide=false
 * melee）。出生链 = Player.cs:47661-47676;1456 伪锚 :46613-46625 勘正（projToShoot==9：出生点 = 光标 X + 远离
 * 玩家侧 rand(0..200)、Y = MountedCenter−600；伤害 ×1.5、击退清零）+
 * :49607-49620;1456 伪锚 :48479-48491 勘正（type 65：目标线从光标向出生点方向逐 16px 回退到首个非实心格）。
 * 行为（:24081-24364;1456 伪锚 :22130-22247 勘正）：恒速无重力；tileCollide = Bottom.Y ≥ ai[1]（:24116-24119;1456 伪锚 :22159-22162 勘正，
 * 与 503 的 Center.Y > ai[1] 不同——底边对齐）；alpha −15/t（线上钳 150 / 线下钳 0，
 * :22194-22207）；Item9 周期音 20-60t（:22175-22179）；rotation 按
 * (|vx|+|vy|)×0.01×direction 翻滚（:22246，非 503 的 vel−π/2）；尘 86 粉星尾
 * （:22325-22337）。
 */
export class StarfuryStar extends Entity {
  /** 原版弹型 id（SetDefaults :626-636 melee 旗——resolveProjClass 类门数据源） */
  readonly projId = 9;
  damage: number;
  /** 出生注入的穿透（SetDefaults 2） */
  pierce: number;
  critChance = 0.04;
  armorPen = 0;
  /** 目标线 Y（ai[1]）：Bottom.Y ≥ targetY 后开始撞块 */
  targetY: number;
  /** alpha（255 起 −15/t；线上钳 150 / 线下钳 0） */
  alpha = 255;
  /** rotation（翻滚累积，:22246） */
  rot = 0;
  /** timeLeft（SetDefaults 默认 3600） */
  timeLeft: number;
  dead = false;
  private soundT = 0;

  // ---- ★通用湿段（Projectile.cs:16895-17113 全体弹共用段;2026-09-06 杂项弹簇批,
  //  红队 P1-2）----
  //  豁免核对：9 SetDefaults（P.cs:888-898：24×24/aiStyle 5/penetrate 2/scale 0.8/
  //  tileCollide=false/melee）【无 ignoreWater 行】= 受段（projectileData 数据面同向）。
  //  阻尼（湿支 :17721-17764 只在 HandleMovement tileCollide 支）：9 的 tileCollide
  //  动态门（:24116-24119;1456 伪锚 :22159-22162 勘正 Bottom.Y ≥ ai[1]）——越线【前】false → 位移全速;越线【后】
  //  true → 湿态档位消费（水 0.5/蜂蜜 0.25/微光 0.375,乘进位移行,速度场不减）。
  //  杀拍口径（Arrow.ts ⑥配方）：杀位=timeLeft 头杀（fixedUpdate 首;vanilla timeLeft
  //  杀在 Update 尾 :17307-17311=湿段后）/出界/撞块/穿透尽——头杀拍由 dead 支补跑
  //  （wetSectionRan 防双跑;活拍位=AI 后/位移前）,其余杀位在活拍湿段【后】已跑。
  //  死拍位移跳过=零观感（Arrow 同口径,证毕登记非债）。IsDestroyedByWater 域不含
  //  9（{85,15,188,34,1097,1106}）→ hooks 不接。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount :16984 置 10 / :17109-17112 逐拍 −1） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10893 等价;共享体首调自做） */
  presetDone = false;

  constructor(x: number, y: number, vx: number, vy: number,
    damage: number, pierce: number, targetY: number) {
    super();
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.pierce = pierce;
    this.targetY = targetY;
    // SetDefaults :889-890 24×24 × scale=0.8（:895）→ SetDefaults 尾 :10672-10673
    // `width = (int)((float)width * scale)` = (int)19.2 = 19——判定盒 19×19
    //（★红队 P1-2：旧 24×24 漏乘 SetDefaults 尾缩放;溅花弹面盒/Bottom.Y 越线门/
    //  Center.Y α 钳位全部随真盒收正）
    this.w = 19; this.h = 19;
    this.timeLeft = 3600;
  }

  /** ★⑥杀拍口径（Arrow.ts 配方推广,见字段块头注） */
  private wetSectionRan = false;

  private wetSectionStep(game: GameHooks): void {
    if (this.wetSectionRan) return;   // 防同拍双跑（活拍已跑 → 杀拍补跑 no-op）
    this.wetSectionRan = true;
    // ---- ★通用湿段（:16895-17113,共享体;溅花尘/音=wetSplashStepShared 弹面 10 粒,
    //  盒 19×19 → 弹面 (31,24)）----
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater);
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    this.wetSectionRan = false;
    // timeLeft 头杀（vanilla 杀在 Update 尾 :17307-17311=湿段后——杀拍湿段由下方
    // dead 支补跑=杀拍口径⑥）
    if (--this.timeLeft <= 0) this.killNow(game);
    if (this.dead) { this.wetSectionStep(game); return; }   // ★杀拍补跑
    // :24116-24119（1456 伪锚 :22159-22162 勘正）tileCollide = Bottom.Y ≥ ai[1]（越线前穿墙）
    const collide = this.y + this.h >= this.targetY;
    // :22175-22179 Item9 周期音（20-60t 掷一次）
    if (this.soundT <= 0) {
      this.soundT = 20 + Math.floor(Math.random() * 41);
      game.playSfxFiles(['Item_9'], 0.5, this.cx, this.cy);
    } else this.soundT--;
    // :22194-22207 alpha −15/t；线上（Center.Y < ai[1]）钳 150，线下钳 0
    const floor = this.cy < this.targetY ? 150 : 0;
    this.alpha = Math.max(floor, this.alpha - 15);
    // :22246 翻滚（503 才是 rotation = vel−π/2，:22242）
    this.rot += (Math.abs(this.vx) + Math.abs(this.vy)) * 0.01;
    this.wetSectionStep(game);   // ★活拍：AI 后/位移前 = 原版 Update 同序
    // 位移（★水中位移阻尼：HandleMovement :17721 湿支只在 tileCollide 支——
    // 越线前 tileCollide=false 全速,越线后湿态吃档位;速度场不减只削当拍位移）
    const drag = collide ? projWaterDragFactor(this) : 1;
    this.x += this.vx * drag;
    this.y += this.vy * drag;
    // :22325-22337 尘 86 粉星尾（1/4 概率；半数位置回退 vel×4）
    if (Math.random() < 0.25) {
      const px = Math.random() < 0.5 ? this.cx - this.vx * 4 : this.cx;
      game.spawnParticles(px, this.cy, '#FF8CD8', 1, 0.8, { life: 22 });
    }
    const world = game.world;
    const tx = Math.floor((this.x + this.w / 2) / TILE);
    const ty = Math.floor((this.y + this.h / 2) / TILE);
    if (!world.store.inBounds(tx, ty)) { this.killNow(game); return; }
    if (collide && world.store.get(tx, ty) !== 0) {
      game.cutTile(tx, ty);
      if (world.store.isSolid(tx, ty)) { this.killNow(game); return; }
    }
    // ★BJ285（BJ232 死亡段割面族,2026-09-22）：CutTiles（Projectile.cs:12517 调用点/方法 :15276）先于 Damage_PVE
    //  （:12523）——星体 9 penetrate=2 耗尽即亡拍【照割】（SetDefaults :888-897,aiStyle 5/
    //  friendly/tileCollide=false）;中央割 !e.dead 门=死亡拍整缺 → BJ260 前置习语。
    //  9 过两道门（CanCutTiles :15407 两表均无;Damage_CanDealDamage :12461 无）。
    cutTilesBox(game, this.x, this.y, this.w, this.h);
    if (hitCritters(this, game)) { this.killNow(game); return; }
    for (const ent of game.enemies()) {
      if (!playerCanHitEnemy(ent, game)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
      const e = ent as MissileEnemyView;
      if (e.dead) continue;
      if (!(this.x < e.x + e.w && this.x + this.w > e.x && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
      // ★BJ486③ 掷率=owner 装配（rollVanillaHitCrit:12915-12927,9 melee 旗）。
      const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
      const dmg = damageVarRoll(this.damage, ((game.player as unknown as { luck?: number } | null)?.luck) ?? 0);   // ★BJ723-C D1 清偿（BJ725-A）:DV :12970 逐靶掷——★S02:crit ×2 移 Enemy.hurt 防后(NPC.cs:82067)
      // ★焰爆石+拍击石弹幕双支位（Projectile.cs:13439-13446；F3/F1 收编升级）——
      // 老星怒落星 9 数据面 melee → 过 kind1 门即脉冲；返回 num14 加伤随暴击并入实伤参
      const snapBonusStar = projectileSnapStrikeBonus(game, this,
        (e as { cx?: number }).cx ?? e.x + e.w / 2, (e as { cy?: number }).cy ?? e.y + e.h / 2,
        e.id, { victimBox: { w: e.w, h: e.h,
          cx: (e as { cx?: number }).cx ?? e.x + e.w / 2,
          cy: (e as { cy?: number }).cy ?? e.y + e.h / 2 } });
      e.hurt(applyBannerDamageDealt(game, e, dmg)
        + (snapBonusStar ? snapBonusStar : 0),
        Math.sign(this.vx) * 5, 0, game, this.armorPen, crit, this.pierce, true);   // 音/飘值=单点
      if (--this.pierce <= 0) { this.killNow(game); return; }
    }
    if (hitTownNpcs(this, game, this.damage, Math.sign(this.vx) * 2)
      && --this.pierce <= 0) { this.killNow(game); return; }
  }

  private killNow(game: GameHooks): void {
    // ★Kill 幂等头门（P.cs:71755-71758 `if (!active) return;` 1:1）——二次 Kill
    //  no-op（杀拍湿段/杀位连射防 onProjectileDeath 双爆）
    if (this.dead) return;
    this.dead = true;
    // ★Kill 消亡面清偿批 2（2026-09-02）：补传消亡速度——Game.onProjectileDeath 9 支
    // （Projectile.cs:77259-77318）尘 58 初速 = v×0.1、gore 16/17 初速 = v×0.05，
    // 此前 4 参回传 oldV 缺省 0 → 两面只剩 NewDust/NewGore 内建抖动（登记清偿）
    game.onProjectileDeath?.(9, this.x, this.y, this.w, this.h, this.vx, this.vy);
  }

  /** 星体绘制（Main.cs:31820-32003 星族块 type==9 支 1:1；★终零波 C 项升格——
   *  Extra[91] 星芒真值组合退役"渐隐金粉曳光近似"：
   *  · 静态首芒（:31971）：纹理=Extra[91] 整帧(34×90)、origin=(w/2,10)、
   *    rotation=velocity.ToRotation()+π/2、锚点 vector53：type9 分支先 +velocity 再
   *    −velocity(:31899/:31930) = 恒 Center、再 +vector52(normalize(v)×8,:31928)；
   *    尺度 num216/217/218=0.9/0/0（type9 覆写 :31924-31926）——二三芒 scale 0
   *    不可见,只绘首条（零乘空 Draw 语义等价）
   *  · 双拍交叉渐隐芒（:32016-32029）：锚点 vector54=Center−v×0.5 再 +vector52，
   *    相位 f=(tfe/60 %0.5)/0.5 与 num232∈{0,0.5} 错半相,alpha=color58×三角波、
   *    scale=(0.5+f×0.5)×num219（type9 num219=1×0.75 :31931）
   *  · 星体本体（:32032 最后一张）：色=Lerp(Gold(A=180),(194,22,134,127),num227)
   *    （GetAlpha 初值被覆写→不消费弹体 alpha）、scale=num220=proj.scale+0.1+
   *    num227×0.2、rot=this.rot。num227=1−Remap(phase,.15,.5,0,1)×
   *    Remap(phase,.5,.85,1,0)，phase=(rot×0.5 wrap 后归一)/2π
   *  XNA Color 字面值逐通道截断转录（Multiply-then-round 即 XNA op*）：value40=
   *  (194,22,134)×.75(A/=2)=(145,16,100,95)、value43=(180,20,255)×.225=(40,4,57,57)、
   *  value41=Lerp(Gold,W,.5)(A/=4)×.85×.75=(162,149,81,39)、value44=(W,0)×.15=(38,38,38,0)。
   *  flag31=false(:31920) → A 取上述值不再覆写。SpriteBatch AlphaBlend 直-alpha 语义 =
   *  canvas globalAlpha 直绘。染色经 starRaySprite 像素级 multiply（tint 缓存池,
   *  半加载贴图拒烘）；贴图未就绪时回退旧曳光线（懒加载首帧兜底,加载后自愈） */
  draw(r: { canvas?: HTMLCanvasElement; ctx: CanvasRenderingContext2D;
    atlas?: { ensureVImage?: (f: string) => ImageBitmap | HTMLImageElement | null } | null }): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const img = projSprite(9);
    if (!img || !(img.width > 0) || img.width === 0) return;
    const sp = Math.hypot(this.vx, this.vy) || 1;
    const nx = this.vx / sp, ny = this.vy / sp;
    const phase = wrapAngle(this.rot * 0.5) / (Math.PI * 2) + 0.5;
    const p227 = 1 - lerpValue(0.15, 0.5, phase) * lerpValue(0.5, 0.85, phase);
    const mixC = (a: RGBA, b: RGBA): RGBA => ({
      r: a.r + (b.r - a.r) * p227, g: a.g + (b.g - a.g) * p227,
      b: a.b + (b.b - a.b) * p227, a: a.a + (b.a - a.a) * p227,
    });
    const rayRot = Math.atan2(this.vy, this.vx) + Math.PI / 2;
    const cRay = mixC({ r: 145, g: 16, b: 100, a: 95 }, { r: 40, g: 4, b: 57, a: 57 });
    const cPulseBase = mixC({ r: 162, g: 149, b: 81, a: 39 }, { r: 38, g: 38, b: 38, a: 0 });
    const cBody = mixC({ r: 255, g: 215, b: 0, a: 180 }, { r: 194, g: 22, b: 134, a: 127 });
    // ---- 双拍交叉渐隐芒（画序在静态芒之后、本体之前 :32016 起）----
    const tfe = (performance.now() / 1000) * 60;        // Main.timeForVisualEffects 拍钟
    const imgRayRaw = r.atlas?.ensureVImage ? r.atlas.ensureVImage('vanilla/Extra_91.png') : null;
    const rayReady = !!(imgRayRaw && imgRayRaw.width > 0 && imgRayRaw.height > 0
      && !(imgRayRaw instanceof HTMLImageElement && !imgRayRaw.complete));
    const angAnchorX = this.cx + nx * 8, angAnchorY = this.cy + ny * 8;
    const pulseAX = this.cx - this.vx * 0.5 + nx * 8, pulseAY = this.cy - this.vy * 0.5 + ny * 8;
    let raysDrawn = false;
    if (rayReady && imgRayRaw) {
      const spriteStatic = starRaySprite(imgRayRaw, cRay);
      // 静态首芒 scale 0.9（二三芒 type9 scale=0 直接跳过）
      if (spriteStatic) {
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.translate(angAnchorX, angAnchorY);
        ctx.rotate(rayRot);
        ctx.drawImage(spriteStatic, -(imgRayRaw.width / 2) * 0.9, -10 * 0.9,
          imgRayRaw.width * 0.9, imgRayRaw.height * 0.9);
        ctx.restore();
        for (const off of [0, 0.5]) {
          let f = ((tfe / 60) % 0.5) / 0.5 + off;
          f %= 1;
          let tri = f * 2;
          if (tri > 1) tri = 2 - tri;
          const sc = (0.5 + f * 0.5) * 0.75;
          const spritePulse = starRaySprite(imgRayRaw,
            { ...cPulseBase, a: cPulseBase.a * tri });
          if (!spritePulse || sc <= 0) continue;
          ctx.save();
          ctx.imageSmoothingEnabled = false;
          ctx.translate(pulseAX, pulseAY);
          ctx.rotate(rayRot);
          ctx.drawImage(spritePulse, -(imgRayRaw.width / 2) * sc, -10 * sc,
            imgRayRaw.width * sc, imgRayRaw.height * sc);
          ctx.restore();
        }
        raysDrawn = true;
      }
    }
    if (!raysDrawn) {
      // 回退：贴图未就绪（懒加载窗口）——旧金粉曳光线，加载完成后自动走上方真值面
      ctx.save();
      ctx.strokeStyle = `rgba(255,215,0,${(0.25 * cBody.a / 255).toFixed(3)})`;
      ctx.lineWidth = 2 + 5 * 0.8 * p227;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(angAnchorX - nx * 26, angAnchorY - ny * 26);
      ctx.lineTo(angAnchorX, angAnchorY);
      ctx.stroke();
      ctx.restore();
    }
    // ---- 星体本体（:32032 origin=整帧中心,scale=[0.9,1.1] 按 pulse）----
    const num220 = 0.8 + 0.1 + p227 * 0.2;               // proj.scale(SetDefaults 0.8)+0.1+0.2×pulse
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, cBody.a / 255));
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, -img.width * num220 / 2, -img.height * num220 / 2,
      img.width * num220, img.height * num220);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

// =============================================================================
// 终零波·Extra_91 星芒染色副本周转池（StarfuryStar.draw 消费；Main.cs:31971 起
// EntitySpriteDraw color 参的 canvas 等价物——XNA 在采样期做 srcColor×tint，
// canvas 无单 sprite tint,这里像素级 multiply 一次产出后按色值复用）。
// ★烘焙入口两闸（celestial 天体系平色矩形毒化判例,MEMORY celestial-flare 判例同源）：
//   · texReady 门：HTMLImageElement.complete!==true 直接返回 null（拒烘半加载帧）；
//   · 色键全通道非黑门不设——本调用位颜色恒来自固定 lerp 带,无单色退化输入面。
// =============================================================================

interface RGBA { r: number; g: number; b: number; a: number }

const STAR_RAY_TINT_CACHE = new Map<string, HTMLCanvasElement>();

function starRaySprite(src: ImageBitmap | HTMLImageElement, col: RGBA): CanvasImageSource | null {
  const iw = 'width' in src ? src.width : 0;
  const ih = 'height' in src ? src.height : 0;
  if (!iw || !ih) return null;
  const key = `${Math.round(col.r)}|${Math.round(col.g)}|${Math.round(col.b)}|${Math.round(col.a)}`;
  const hit = STAR_RAY_TINT_CACHE.get(key);
  if (hit) return hit;
  if (src instanceof HTMLImageElement && !src.complete) return null;   // 拒烘半加载
  if (STAR_RAY_TINT_CACHE.size >= 96) {
    const oldest = STAR_RAY_TINT_CACHE.keys().next().value;
    if (oldest !== undefined) STAR_RAY_TINT_CACHE.delete(oldest);       // FIFO 淘汰
  }
  try {
    const c = document.createElement('canvas');
    c.width = iw; c.height = ih;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(src as CanvasImageSource, 0, 0);
    const d = g.getImageData(0, 0, iw, ih);
    const p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      p[i] = (p[i]! * col.r / 255) | 0;
      p[i + 1] = (p[i + 1]! * col.g / 255) | 0;
      p[i + 2] = (p[i + 2]! * col.b / 255) | 0;
      p[i + 3] = (p[i + 3]! * col.a / 255) | 0;
    }
    g.putImageData(d, 0, 0);
    STAR_RAY_TINT_CACHE.set(key, c);
    return c;
  } catch {
    return null;                                        // getImageData 异常 → 静默走本体直绘
  }
}
