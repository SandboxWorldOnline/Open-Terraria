// 后期三大 Boss AI 1:1 移植(Terarria1456 = 1.4.5.6 反编译源码,经典模式主链):
//   aiStyle 84  拜月教邪教徒 439  AI_084_LunaticCultist()        NPC.cs:64921-65957
//   aiStyle 120 光之女皇     636  AI_120_HallowBoss()           NPC.cs:46299-47302(+DashTo :47304)
//   aiStyle 121 史莱姆皇后   657  AI_121_QueenSlime()           NPC.cs:45543-46177(+FlyMovement :45467)
// 由 Enemy.fixedUpdate 的 aiStyle 分发调用(接线见文件尾「接线清单」)。
// 弹幕走 bossAI.shoot(Arrow 直飞桶)+三类实体化弹:IceMistCloud/LightningOrb(原批)、
// FairyQueenLance 919/SunDanceBeam 923(2026-08-31 台账清偿批——AI_179/AI_180:
// 60t 零速预告(localAI[0] 门,★非 ai[1] 延时参)→40 速发射+旋转锁定+线形判定盒;
// 扫束锚本体 Center 随拍旋转,scale 三段梯度,timeLeft=180)。getGoodWorld 分支已
// 实装(女皇招式间隔折半/史后空中横移+砸地蓄力+凝胶环抬档);expert 数值链已实装
// (邪教徒选拍末日替换+间隔/伤害 Remap,NPC.cs:65134-65171/:65462-65477);netcode 跳过。
import { Enemy } from './Enemy';
import type { GameHooks } from './types';
import type { Player } from './Player';
import type { Camera } from '../render/Camera';
import type { Renderer } from '../render/Renderer';
import { TILE } from '../core/constants';
import { TILE_DEFS } from '../data/tiles';
import { spawnPart, shoot, losClear, addEnemy } from './bossAI';
import { Entity } from './Entity';
import { projSprite, projFrameImg } from './Arrow';
import { hitPlayer, hitTownNpcs, hitCritters, projOverlap } from './projTargets';
import { canHit } from '../physics/LineOfSight';
import { LightningBoltProj } from './LightningBoltProj';
import { segHitsRect } from './bossAI_duke_moonlord';   // 线段×AABB(CheckAABBvLineCollision 胶囊近似,共用)
import { getAttackDamageForProjectiles } from '../stats/ScaleStats';
import { hslToRgb255 } from '../render/AuroraSky';
import { TtlSprite } from '../assets/ttlSprite';
import { projectileWetSection } from './projWetSection';
import { projectileData } from '../data/vanillaProjectiles';

// ---------------------------------------------------------------------------
// 彩虹乘色烘焙(919/923 专供):本地 multiply+destination-in 两步染形,键按
// RGB 步进 8 量化(同 Renderer.tintedSprite/FakeFish.silhouetteOf 桶——色相连续
// 漂移防逐帧新键刷爆缓存)。半载窗(width==0)拒烘不缓存(天体渲染双修教训:
// 平色矩形永久毒化缓存);命中桶直接复用。
// ---------------------------------------------------------------------------
const rainbowTintCache = new Map<string, HTMLCanvasElement>();

function tintBake(
  prefix: string,
  img: CanvasImageSource | null | undefined,
  sx: number, sy: number, sw: number, sh: number,
  rgb: readonly [number, number, number],
): HTMLCanvasElement | null {
  if (!img || typeof document === 'undefined') return null;
  const iw = (img as { width?: number }).width ?? 0;
  const ih = (img as { height?: number }).height ?? 0;
  if (!(iw > 0) || !(ih > 0)) return null;              // 半载拒烘
  const w = Math.max(1, Math.ceil(sw)), h = Math.max(1, Math.ceil(sh));
  const q = (v: number) => Math.round(v) & ~7;
  const key = `${prefix}|${sx},${sy},${sw},${sh}|${q(rgb[0])},${q(rgb[1])},${q(rgb[2])}`;
  const hit = rainbowTintCache.get(key);
  if (hit) return hit;
  if (rainbowTintCache.size > 512) { const k0 = rainbowTintCache.keys().next().value; if (k0 !== undefined) rainbowTintCache.delete(k0); }   // ★逐条淘汰最旧(勿整表clear=重分配雪崩,2026-09-07 canvas哨兵案)
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cx = c.getContext('2d');
  if (!cx) return null;
  cx.imageSmoothingEnabled = false;
  cx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  cx.globalCompositeOperation = 'multiply';             // RGB 乘目标色
  cx.fillStyle = `rgb(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])})`;
  cx.fillRect(0, 0, w, h);
  cx.globalCompositeOperation = 'destination-in';       // 轮廓还原
  cx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  cx.globalCompositeOperation = 'source-over';
  rainbowTintCache.set(key, c);
  return c;
}

// ===================== 共用工具(与 bossAI.ts 同语义,私有副本) =====================

/** 原版 MathHelper.Clamp */
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
/** 原版 Utils.GetLerpValue(clamped) */
const lerpValue = (from: number, to: number, t: number): number =>
  from === to ? (t < from ? 0 : 1) : clamp((t - from) / (to - from), 0, 1);
/** 原版 Vector2.Lerp */
const vLerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** 伤害/防御基值缓存(状态机每 tick 从基值派生临时修正,防重复乘膨胀;同 bossAI.baseStats)。
 *  ★BJ712-A(2026-10-25 转报件3/4):基值=首 AI 拍捕获的 def.damage/def.defense
 *  =ScaleStats 后值(原版 defDamage/defDefense 快照,NPC.cs:18199-18201 在
 *  ScaleStats 尾部落成——AI 派生写 `damage=(int)(defDamage×num)` 族消费的是
 *  缩放后基线,女皇 :47432/史后无写位)。旧实现回落 e.vanilla.damage(未缩放
 *  原值)→ 女皇/史后每拍覆写把难度缩放抹平(80/80/80、60/60/60),回落退场,
 *  与 bossAI/golem/wof/duke 四处同语义对齐。 */
const baseStats = new WeakMap<Enemy, { dmg: number; def: number }>();
const baseOf = (e: Enemy): { dmg: number; def: number } => {
  let b = baseStats.get(e);
  if (!b) { b = { dmg: e.def.damage, def: e.def.defense ?? 0 }; baseStats.set(e, b); }
  return b;
};

/** 原版 localAI[0..3] 的外部存储(Enemy 只有 ai0-ai3 四个槽)。
 *  la2/la3 放宽为 unknown:邪教徒用 la2 存仪式圈心坐标对象、la3 存克隆体的真身引用 */
const localAI = new WeakMap<Enemy, { la0: number; la1: number; la2: unknown; la3: unknown }>();
const laOf = (e: Enemy): { la0: number; la1: number; la2: unknown; la3: unknown } => {
  let l = localAI.get(e);
  if (!l) { l = { la0: 0, la1: 0, la2: 0, la3: 0 }; localAI.set(e, l); }
  return l;
};

/** 原版 SimpleFlyMovement(NPC.cs:23866 雏形):逐轴向目标速度以加速度步进(钳 ±acc) */
function simpleFly(e: Enemy, dvx: number, dvy: number, acc: number): void {
  e.vx += clamp(dvx - e.vx, -acc, acc);
  e.vy += clamp(dvy - e.vy, -acc, acc);
}

/** 无碰撞积分(noTileCollide 族) */
function flyIntegrate(e: Enemy): void {
  e.x += e.vx;
  e.y += e.vy;
}

/** 地形碰撞(bossAI.collideGround 的私有副本:Queen Slime 走路/砸地需要) */
function collideGround(e: Enemy, game: GameHooks): void {
  const st = game.world.store;
  const tx = Math.floor(e.cx / TILE);
  const ty = Math.floor((e.y + e.h) / TILE);
  if (st.inBounds(tx, ty) && st.isSolid(tx, ty) && e.vy >= 0) {
    e.y = ty * TILE - e.h;
    e.vy = 0;
    e.onGround = true;
  } else {
    e.onGround = false;
  }
  const ty2 = Math.floor(e.y / TILE);
  if (st.inBounds(tx, ty2) && st.isSolid(tx, ty2) && e.vy < 0) {
    e.y = (ty2 + 1) * TILE;
    e.vy = 0;
  }
  const tx2 = Math.floor((e.x + e.w) / TILE);
  if (st.inBounds(tx2, Math.floor(e.cy / TILE)) && st.isSolid(tx2, Math.floor(e.cy / TILE)) && e.vx > 0) {
    e.x = tx2 * TILE - e.w; e.vx = 0;
  }
  const tx3 = Math.floor(e.x / TILE);
  if (st.inBounds(tx3, Math.floor(e.cy / TILE)) && st.isSolid(tx3, Math.floor(e.cy / TILE)) && e.vx < 0) {
    e.x = (tx3 + 1) * TILE; e.vx = 0;
  }
}

/** 朝玩家预测位置的单位向量(player.velocity*20 预判,NPC.cs:65380 系) */
function aimLead(e: Enemy, player: Player, fallbackX: number): { x: number; y: number } {
  const dx = player.cx + player.vx * 20 - e.cx;
  const dy = player.cy + player.vy * 20 - e.cy;
  const d = Math.hypot(dx, dy);
  if (!Number.isFinite(d) || d < 0.0001) return { x: fallbackX, y: 0 };
  return { x: dx / d, y: dy / d };
}
/** 旋转 */
const rot = (x: number, y: number, a: number): [number, number] =>
  [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

// ===================== AI_084 拜月教邪教徒 439 + 克隆体 440(NPC.cs:64921-65957) =====================
// 真身 439 与克隆体 440 共用本核(flag2 = type==439,:64971):克隆体由仪式态(ai0==5)生成,
//   ai[0]/ai[1] 每 tick 从真身镜像(:65000-65001);仅在仪式窗口(120-420t)可被击中——
//   打中克隆体 → 克隆体消散 + 真身进 6 态硬直 120t(:65003-65014);
//   打中真身 → 推进选招拍号并清同代克隆体(:65016-65060)。
//   仪式态外克隆体无敌且不可选(dontTakeDamage=flag3,:65953)。
// 状态机(ai0): -1 出生显形(420t,真身专属) / 0 选招(40t) / 1 飞掠占位(含克隆体环位补位) /
//   2 冰雾 464(:65362) / 3 火球 467(:65430,第三拍克隆体补射 468) / 4 闪电 465(:65531) /
//   5 仪式瞬移(:65623,生成/补位克隆体) / 6 硬直(:65771) / 7 远古之光(:65796,真身召
//   NPC522 轨道弹 + 第三拍克隆体补射 468×5) / 8 远古末日 NPC523(经典不可达,状态体保留)。
// 经典数值: 冰 35 伤(:64930)/火 30 伤·18t×3(:64941-64946)/闪电 45 伤(:64953)/
//   光 20t×2(:64963-64967)/末日 20t×3(:64970-64973);克隆体补射 468 恒 18 伤(:65491)。
// expert 数值链(1457/1458 逐字同段 NPC.cs:65130-65174;2026-08-31 台账批):
//   冰间隔 num 120→90(:65135-65137,g 再 −30 :65139-65142)、火 18×3→12×4
//   (:65146-65149,g 覆写 10×5 :65151-65154)、雷 num4 80→40(:65157-65160,g 再
//   −20 :65162-65165)、光拍距 num5 20→30(:65165-65171);打断清场预算 num9 10→3
//   (:65270-65273);弹伤 Remap = GetAttackDamage_ForProjectiles(normal,expert)
//   (NPC.cs:7079 Remap(difficulty,Classic,Expert,…)):冰 (35,25) :65133/
//   火 (30,20) :65144/雷 (45,30) :65156——克隆体 468 为字面 18 不参与。
//   getGoodWorld 沿用原文次序:expert 先赋值、g 再减/覆写(与 expert 叠加时同样规则)。
const CULTIST_CYCLE_P1 = [0, 1, 0, 2, 0, 3, 0, 1, 0, 2, 0, 4];
const CULTIST_CYCLE_P2 = [0, 1, 0, 5, 0, 3, 0, 5, 0, 2, 0, 3, 0, 4];

/** 选招(1458 :65381-65458 两张 switch 表合一;表尾拍把 ai3 复位 -1(P1 :65453-65455 /
 *  P2 :65407-65409)→ 下次完成攻击后回 0 重循环)。export=R23b 蓝队测试消费 */
export function cultistPick(e: Enemy, phase2: boolean): number {
  const table = phase2 ? CULTIST_CYCLE_P2 : CULTIST_CYCLE_P1;
  const i = Math.floor(e.ai3);
  if (i < 0 || i >= table.length) { e.ai3 = -1; return 0; }
  if (i === table.length - 1) e.ai3 = -1; // :65199/:65253 表尾复位
  return table[i];
}

/** 真身的全部存活克隆体(:65449 系:type==440 && ai[3]==whoAmI;
 *  本仓克隆体以 localAI 槽 la3 反存真身 Enemy 引用) */
function cultistClones(game: GameHooks, parent: Enemy): Enemy[] {
  return (game.enemies() as Enemy[]).filter(
    (n) => !n.dead && n.vanillaId === 440 && laOf(n).la3 === parent);
}

/** NPC.CountNPCS(typeId)(NPC.cs 调用点 :65471——全存活同型计数,与归属无关) */
function countVanillaNpcs(game: GameHooks, vanillaId: number): number {
  let n = 0;
  for (const e of game.enemies() as Enemy[]) if (!e.dead && e.vanillaId === vanillaId) n++;
  return n;
}

/** 仪式圈弹 490（Projectile.cs:5383 SetDefaults + aiStyle 89 :31193-31326）：
 *  14×14 / hostile / alpha 255 / timeLeft 600 / noTileCollide，锚定源邪教徒 ai[1]。
 *  淡入 300t（alpha -5/t 钳 0）→ 淡出（+12/t）；scale = (1-alpha/255)×0.6 随透明度
 *  张合；rotation 每 t +π/210；alpha==0 时每 t 2 颗 228 号紫尘沿 204×scale 半径
 *  向心收拢；出生播 Item123（真轨 Item_123.wav 已落位，roar 近似销核）。
 *  ai[0]==300 时原版召 NPC 454 幻影龙（场上无）否则 521 章鱼头（:31282-31292）——
 *  两 AI 族未移植（登记：CultistDragonHead/AncientCultistSquidhead），此处不召，
 *  圈弹视觉/淡入淡出/自旋 1:1。锚（439）消亡即 Kill（:31305-31320）。 */
export class CultistRitualCircle extends Entity {
  w = 14; h = 14;
  private srcId: number;
  private age = 0;         // ai[0]
  private alpha = 255;
  private rot = 0;
  private soundPlayed = false;  // localAI[1]
  /** ai[1] == -1（仪式被打破,Projectile.cs:31195 +12/t 快速淡出,不召龙） */
  private interrupted = false;
  dead = false;

  // ---- ★通用湿段（Projectile.cs:16903-17113,projWetSection.ts 共享体 1:1）----
  //  豁免核对：490 CultistRitual SetDefaults P.cs:5657-5668（14×14/aiStyle 89/
  //  hostile/alpha 255/ignoreWater=true【:5664】/tileCollide=false/timeLeft 600/
  //  netImportant）→ 豁免 id,段门恒闭（:16903）= 原版零行为（字段照加、段照调,
  //  豁免分流由 ignoreWater 参数自动承载）。阻尼不适用（双证）：①豁免;②零速
  //  锚定体（锚 NPC 心,AI 不积分 velocity）。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价） */
  presetDone = false;

  constructor(src: Enemy) {
    super();
    this.srcId = src.id;
    this.x = src.cx - this.w / 2;
    this.y = src.cy - this.h / 2;
  }

  /** 仪式窗口内真身被击中 → Main.projectile[ai[2]].ai[1] = -1（NPC.cs:65054） */
  interrupt(): void { this.interrupted = true; }

  /** (1-alpha/255)×0.6（:31208-31210） */
  private get scale(): number { return (1 - this.alpha / 255) * 0.6; }

  fixedUpdate(_dt: number, game: GameHooks): void {
    // ★通用湿段（:16903-17113）——490 豁免 id（P.cs:5664 ignoreWater=true）→ 段门
    //  恒闭零行为;插 tick 头与 AI/位移序无观察差（段内唯一可见面=溅花,豁免即恒无）
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      490, !!projectileData(490)?.ignoreWater);
    // 淡入/淡出（:31195-31214）：中断（ai[1]=-1）或 age≥300 → +12/t；否则 -5/t
    this.alpha += (this.interrupted || this.age >= 300) ? 12 : -5;
    this.alpha = Math.max(0, Math.min(255, this.alpha));
    this.rot += Math.PI / 210;                          // :31217
    if (!this.soundPlayed) {
      this.soundPlayed = true;
      // SoundID.Item123（Projectile.cs:31221，无坐标 = 全量不衰减）——原 roar 近似已销核
      game.playSfxFile?.('Item_123', 1);
    }
    // 完全显现期的收拢紫尘（:31223-31251，尘 228 / 半径 204×scale / 内圈 ×0.42）
    if (this.alpha === 0) {
      for (let k = 0; k < 2; k++) {
        const inner = k === 1;
        const a = Math.random() * Math.PI * 2;
        const rr = 204 * this.scale * (inner ? 0.42 : 1);
        game.spawnParticles(this.cx + Math.cos(a) * rr, this.cy + Math.sin(a) * rr,
          '#A060E0', 1, inner ? 1.5 : 2, { life: 30 });
      }
    }
    this.age++;
    // ---- :31279-31292 age==300 且未中断 → 召唤：场上无 454 幻影龙 → NewNPC(454)
    //      （头 + 455-458 身 ×4 + 459 尾共享头血池）；否则 → 521 远古幻象。
    //      召出后 ai[1] 复用为该 NPC 索引 = 圈锚从邪教徒切到龙（龙亡圈灭）----
    if (this.age === 300 && !this.interrupted) {
      const hasDragon = (game.enemies() as Enemy[])
        .some((n) => !n.dead && n.vanillaId === 454);
      const id = hasDragon ? 521 : 454;
      const head = Enemy.fromVanilla(id, this.cx, this.cy);
      if (head) {
        // ★Bottom 锚勘误（1457 Projectile.cs:32931/:32935 NewNPC((int)Center.X,
        //  (int)Center.Y,454/521) → NPC.cs:81594 nPC.Bottom=(X,Y)）:龙/幻象【底边】
        //  = 仪式弹中心——X 经 fromVanilla 中心锚恰同值,仅 Y 旧中心锚低 h/2
        //  （BJ113 域外登记②,2026-09-17 落刀）;链段随头位,须先换算再 spawnWormChain
        head.y = this.cy - head.h;
        addEnemy(game, head);
        this.srcId = head.id;              // ai[1] = NewNPC 返回索引（:31283/:31287）
        if (id === 454) {
          // 链段（NPC.cs:51743-51769 AI_006 专块 1:1）：30 段=456 主体 + 455 翼节
          // （(n-2)%4==0 且 n<26）+ 457/458/459 尾三连，realLife 共享头 10000 血。
          // 曾按 5 段 [455..459]=把专块读成仪式特例（2026-09-02 全面 review 纠）
          const spec = Enemy.wormChainSpec(454, Math.random)!;   // 454 ∈ WORM_CHAIN_HEADS 恒有表
          const segs = Enemy.spawnWormChain(head, spec.count, spec.segIds, true);
          for (const sg of segs) addEnemy(game, sg);
        }
      }
    } else if (this.age === 320) {
      this.dead = true;                                 // :31290-31294
      return;
    }
    // ---- flag44（:31295-31314）：中断且全隐 → Kill；或锚 NPC 失效/非 439/454/521 → Kill ----
    const src = (game.enemies() as Enemy[]).find((n) => n.id === this.srcId);
    const anchorOk = !!src && !src.dead
      && (src.vanillaId === 439 || src.vanillaId === 454 || src.vanillaId === 521);
    if ((this.interrupted && this.alpha >= 255) || !anchorOk) { this.dead = true; }
  }

  draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const img = projSprite(490);
    if (!img || !(img.width > 0) || img.width === 0) return;
    const s = this.scale;
    if (s <= 0.01) return;
    const iw = img.width, ih = img.height;
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.rot);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, -iw * s / 2, -ih * s / 2, iw * s, ih * s);
    ctx.restore();
  }
}

/** Extra_35（24×222 冰雾六角波纹，1×3 帧）懒加载（StardustMarkProj.beamSprite 同款） */
const hexWaveTtl = new TtlSprite('sprites/vanilla/Extra_35.png');
function extra35(): ImageBitmap | HTMLImageElement | null {
  return hexWaveTtl.get();   // TTL 自愈装载(2026-08-25 同类扫描)
}

/** 冰雾母云/子体 464（Projectile.cs aiStyle 86 :30747-30821 + SetDefaults :5078-5087）：
 *  邪教徒冰雾态(:65411-65421)发的是 ai[1]=1 的【母云】——60×60 / hostile /
 *  tileCollide=false / penetrate=-1 / alpha 255；速度=瞄玩家预判 ×4（发射向量），
 *  母云终身保持该速度漂移（UpdatePosition :19026 无早退）。
 *  母云（ai[1]==1，:30763-30790）：ai0<130 淡入 alpha−10/t、≥130 淡出 +10/t（钳
 *  0..255）；≥150 Kill；每 ai0%30==0 沿自转 rotation 派生一颗【子体 464】（同伤/
 *  同击退，速度=rotation 单位向量）；rotation += π/30 自旋；AddLight(0.3,0.75,0.9)。
 *  子体（ai[1]==0，:30792-30821）：AI 侧 position−=velocity + 引擎 UpdatePosition
 *  +velocity → 净静止（速度只作尘环几何参数）；<40t 淡入 −40/t、≥40 淡出 +3/t、
 *  ≥45 Kill；六角尘环——(0,−720).RotatedBy(速度角)×(ai0%45/45) 为半径向量，
 *  六个 60° 角点各 AddLight + 2 颗 197 号尘（noGravity）。
 *  绘制：母云走 Projectile_464.png 随 rotation 旋转（Main.cs:32360 大表分支默认画）；
 *  子体【不画 464 贴图】——六角点各画一张 Extra_35（1×3 帧带按角点序循环、旋
 *  角=角点角+速度角+π，Main.cs:32699-32721）。接触伤害=传入 damage（教徒冰雾 35）。
 *  首帧 Item_120 音（:30749-30752，母云与每颗子体各自首帧播——原调用点单播已随
 *  实体化迁入此处，避免双播）。 */
export class IceMistCloud extends Entity {
  readonly projId = 464;
  damage: number;
  w = 60; h = 60;                  // SetDefaults :5079-5080
  /** ai[1]==1 = 母云档 */
  private readonly mother: boolean;
  private ai0 = 0;
  private alpha = 255;
  private rot = 0;                 // rotation（NewProjectile 缺省 0，仅母云自旋改写）
  private sndPlayed = false;       // localAI[1]

  // ---- ★通用湿段（Projectile.cs:16903-17113,projWetSection.ts 共享体 1:1）----
  //  豁免核对：464 CultistBossIceMist SetDefaults P.cs:5353-5363（60×60/aiStyle 86/
  //  hostile/tileCollide=false/penetrate −1/alpha 255/ignoreWater=true【:5362】）→
  //  豁免 id,段门恒闭（:16903）= 原版零行为（字段照加、段照调,豁免分流由
  //  ignoreWater 参数自动承载）。阻尼不适用（双证）：①豁免;②母云漂移/子体
  //  净静止抵消（AI position∓velocity）= 原版 :16870 快照 quirk 域,无湿阻尼面。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价） */
  presetDone = false;

  /** x/y = NewProjectile 的 X/Y（中心锚）；vx/vy = 发射向量（母云=瞄速 4） */
  constructor(x: number, y: number, vx: number, vy: number, damage: number, mother: boolean) {
    super();
    this.x = x - this.w / 2;
    this.y = y - this.h / 2;
    this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.mother = mother;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (!this.sndPlayed) {         // :30749-30752（母云与子体各自首帧）
      this.sndPlayed = true;
      game.playSfxWav?.('Item_120', 1, this.x, this.y);
    }
    this.ai0++;
    // ★通用湿段（:16903-17113）——464 豁免 id（P.cs:5362 ignoreWater=true）→ 段门
    //  恒闭零行为;插 AI 中段与 AI/位移序无观察差（段内唯一可见面=溅花,豁免即恒无）
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      464, !!projectileData(464)?.ignoreWater);
    if (this.mother) {
      // ---- 母云档（:30763-30790）----
      this.alpha = Math.max(0, Math.min(255, this.alpha + (this.ai0 >= 130 ? 10 : -10)));
      if (this.ai0 >= 150) { this.dead = true; return; }          // :30778-30781
      if (this.ai0 % 30 === 0) {                                   // :30782-30787
        const child = new IceMistCloud(this.cx, this.cy,
          Math.cos(this.rot), Math.sin(this.rot), this.damage, false);
        (game as unknown as { entities: { add: (en: Entity, b: string) => void } }).entities
          .add(child, 'projectiles');
      }
      this.rot += Math.PI / 30;                                    // :30788
      game.addLightAt?.(this.cx, this.cy, 0.3, 0.75, 0.9);         // :30789
      this.x += this.vx;                                           // 引擎速度积分（漂移）
      this.y += this.vy;
    } else {
      // ---- 子体档（:30792-30821）----
      this.x -= this.vx;                                           // :30792（与引擎积分抵消→净静止）
      this.y -= this.vy;
      this.alpha = Math.max(0, Math.min(255, this.alpha + (this.ai0 >= 40 ? 3 : -40)));
      if (this.ai0 >= 45) { this.dead = true; return; }            // :30805-30808
      // 六角尘环（:30810-30821）
      const hex = this.hexPoints();
      for (let i = 0; i < 6; i++) {
        game.addLightAt?.(hex[i][0], hex[i][1], 0.3, 0.75, 0.9);
        for (let k = 0; k < 2; k++) {
          game.spawnDust?.(hex[i][0] + (Math.random() * 8 - 4), hex[i][1] + (Math.random() * 8 - 4),
            8, 8, 197, 0, 0, 100, null, 1, true);   // 尘 197 noGravity（:30817-30820）
        }
      }
      this.x += this.vx;                                           // 引擎速度积分（:19026）
      this.y += this.vy;
    }
    // 接触伤害（hostile penetrate=-1，命中不消耗；敌弹 ×2 缩放在 hitPlayer 内）
    hitPlayer(this, game, this.damage);
    hitTownNpcs(this, game, this.damage, 0, 'hostile');
    // 464 敌对弹对小动物零伤（命中出口中心裁决，2026-08-31 蓝队 F3）：原版
    // Damage_PVE_Inner :12631 受理式 `!(hostile & flag2)`——小动物非 friendly
    // NPC ⇒ hostile-only 弹（SetDefaults 464 无 friendly 列）不可能结其对伤；
    // hitCritters 内按数据面同判恒 false，调用保留为语义锚。
    hitCritters(this, game);
  }

  /** 六角波纹角点（中心+偏移）：(0,−720).RotatedBy(速度角)×(ai0%45/45) 再各旋 k·60° */
  private hexPoints(): Array<[number, number]> {
    const va = Math.atan2(this.vy, this.vx);
    const [rx, ry] = rot(0, -720, va);
    const k = (this.ai0 % 45) / 45;
    const sx = rx * k, sy = ry * k;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < 6; i++) {
      const [hx, hy] = rot(sx, sy, (i * Math.PI * 2) / 6);
      pts.push([this.cx + hx, this.cy + hy]);
    }
    return pts;
  }

  draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const bright = (255 - this.alpha) / 255;
    if (bright <= 0) return;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = bright;
    if (this.mother) {
      // Projectile_464.png × rotation（Main.cs:32360 大表分支默认画法）
      const img = projSprite(464);
      if (img && img.width > 0) {
        ctx.translate(this.cx, this.cy);
        ctx.rotate(this.rot);
        ctx.drawImage(img, -img.width / 2, -img.height / 2, img.width, img.height);
      } else {
        ctx.fillStyle = '#9FD8E8';
        ctx.beginPath(); ctx.arc(this.cx, this.cy, 24, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      // 六角波纹 Extra_35（Main.cs:32699-32721）：角点 i 用第 i%3 帧带、
      // 旋角=角点角+速度角+π；不画 464 贴图
      const img = extra35();
      const va = Math.atan2(this.vy, this.vx);
      const hex = this.hexPoints();
      for (let i = 0; i < 6; i++) {
        const ang = (i * Math.PI * 2) / 6;
        ctx.save();
        ctx.translate(hex[i][0], hex[i][1]);
        ctx.rotate(ang + va + Math.PI);
        if (img && img.width > 0) {
          const band = img.height / 3;
          ctx.drawImage(img, 0, (i % 3) * band, img.width, band,
            -img.width / 2, -band / 2, img.width, band);
        } else {
          ctx.fillStyle = '#BFE8F0';
          ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
    }
    ctx.restore();
  }
}

/** 闪电球 465（Projectile.cs aiStyle 88 type 段 :30860-30937 + SetDefaults :5109-5118）：
 *  邪教徒闪电态(:65563-65566)在头顶 100px 零速定点生成（原版 NewProjectile 速度 0——
 *  本仓旧实现曾坍缩为 6 速直飞 Arrow，实体化后还原定点）。
 *  80×80 / hostile / alpha 255 / tileCollide=false（无 timeLeft 覆写，AI 自灭）。
 *  生命周期：ai0<180 淡入 alpha−5/t（钳 0）；≥180 淡出 +5/t，≥255 Kill（:30870-30887）。
 *  每逢 ai0%30==0 且 <180（:30889-30917）：对 ≤5 个 <2000px 且 Collision.CanHit
 *  （1×1 点对）的玩家各掷一颗 466 闪电链（LightningBoltProj）——方向=弹心→玩家心
 *  RotatedByRandom(0.785) 归一 ×7 速、ai0=该方向角、ai1=Next(100) 种子。
 *  4 帧循环（frameCounter≥4 推帧，projFrames[465]=4，:30919-30925）；AddLight
 *  (0.4,0.85,0.9)；alpha<150 且 ai0<180 时每子步 2 圈尘 226（半径 w×0.2/0.6，
 *  速度=离心 2 / 0，:30929-30960）。首帧 Item_121 音（:30864-30867）保留在教徒
 *  调用点（任务约定不双播）。接触伤害=传入 damage（教徒闪电 45）。 */
export class LightningOrb extends Entity {
  readonly projId = 465;
  damage: number;
  w = 80; h = 80;                  // SetDefaults :5110-5111
  private ai0 = 0;
  private alpha = 255;
  private frameCounter = 0;
  private frame = 0;               // projFrames[465]=4（vanilla-projframes.json）

  // ---- ★通用湿段（Projectile.cs:16903-17113,projWetSection.ts 共享体 1:1）----
  //  豁免核对：465 CultistBossLightningOrb SetDefaults P.cs:5384-5393（80×80/
  //  aiStyle 88/hostile/alpha 255/ignoreWater=true【:5391】/tileCollide=false）→
  //  豁免 id,段门恒闭（:16903）= 原版零行为（字段照加、段照调,豁免分流由
  //  ignoreWater 参数自动承载）。掷出的 466 电弧也豁免（P.cs:5399）且走
  //  LightningBoltProj（湿段批已接）。阻尼不适用（双证）：①豁免;②零速定点
  //  （NewProjectile 速度 0,AI 不积分 velocity）。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价） */
  presetDone = false;

  /** x/y = NewProjectile 的 X/Y（中心锚 = 教徒 Center −(0,100)）；速度恒 0 */
  constructor(x: number, y: number, damage: number) {
    super();
    this.x = x - this.w / 2;
    this.y = y - this.h / 2;
    this.damage = damage;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    // ★通用湿段（:16903-17113）——465 豁免 id（P.cs:5391 ignoreWater=true）→ 段门
    //  恒闭零行为;插 tick 头与 AI/位移序无观察差（段内唯一可见面=溅花,豁免即恒无）
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      465, !!projectileData(465)?.ignoreWater);
    // 淡入/淡出（:30870-30887）
    if (this.ai0 < 180) this.alpha = Math.max(0, this.alpha - 5);
    else {
      this.alpha = Math.min(255, this.alpha + 5);
      if (this.alpha >= 255) { this.dead = true; return; }
    }
    this.ai0++;
    // 每 30t 掷 466（:30889-30917：按槽序扫玩家，逐个过 <2000px + CanHit 1×1 点对
    // 视线门后入列，满 5 即停——M11 索敌链：联机含访客代理，原版扫 Main.player[0..254]）
    if (this.ai0 % 30 === 0 && this.ai0 < 180) {
      let thrown = 0;
      for (const p of (game.candidatePlayers?.() ?? [game.player])) {
        if (thrown >= 5) break;                           // :30905-30909 num778≥5 break
        if (!p || p.dead) continue;
        const dist = Math.hypot(p.cx - this.cx, p.cy - this.cy);
        if (dist >= 2000) continue;
        if (!canHit(game.world.store, this.cx, this.cy, 1, 1, p.cx, p.cy, 1, 1)) continue;
        const v83x = p.cx - this.cx, v83y = p.cy - this.cy;
        const seed = Math.floor(Math.random() * 100);      // Main.rand.Next(100)
        // Normalize(v83.RotatedByRandom(0.785))×7（:30913-30914）
        const [rvx, rvy] = rot(v83x, v83y, (Math.random() - 0.5) * 2 * 0.7853981852531433);
        const d = Math.hypot(rvx, rvy) || 1;
        const bolt = new LightningBoltProj(this.cx, this.cy,
          (rvx / d) * 7, (rvy / d) * 7, 466, this.damage,
          Math.atan2(v83y, v83x), seed);
        (game as unknown as { entities: { add: (en: Entity, b: string) => void } }).entities
          .add(bolt, 'projectiles');
        thrown++;
      }
    }
    game.addLightAt?.(this.cx, this.cy, 0.4, 0.85, 0.9);     // :30918
    // 4 帧循环（:30919-30925）
    if (++this.frameCounter >= 4) {
      this.frameCounter = 0;
      this.frame = (this.frame + 1) % 4;
    }
    // 尘 226 双圈（:30929-30960；速度 0 → RotatedBy(0) 不转；alpha≥150 或 ≥180t 停）
    if (this.alpha < 150 && this.ai0 < 180) {
      for (const [radius, centrifugal] of [[this.w * 0.2, true], [this.w * 0.6, false]] as const) {
        const a = (Math.random() - 0.5) * Math.PI * 2;       // num781 ∈ ±0.5 ×2π
        const ox = Math.cos(a) * radius, oy = Math.sin(a) * radius;
        const d = game.spawnDust?.(this.cx + ox, this.cy + oy, 0, 0, 226,
          0, 0, 150, null, 0.7, true);
        if (d && centrifugal) {
          // 内圈尘离心 2（:30946）；外圈速度 0（:30958）
          const dl = Math.hypot(d.x - this.cx, d.y - this.cy) || 1;
          d.vx = ((d.x - this.cx) / dl) * 2;
          d.vy = ((d.y - this.cy) / dl) * 2;
        }
      }
    }
    // 接触伤害（hostile；敌弹 ×2 缩放在 hitPlayer 内）
    hitPlayer(this, game, this.damage);
    hitTownNpcs(this, game, this.damage, 0, 'hostile');
    // 465 敌对弹对小动物零伤——同 464 裁决（Damage_PVE_Inner :12631；出口中心判，
    // 本调用恒 false 仅作语义锚,2026-08-31 蓝队 F3）
    hitCritters(this, game);
  }

  draw(r: Renderer, _cam: Camera): void {
    // Main.cs:32812 帧切分支：Projectile_465.png 四帧行按 frame 切片居中、alpha 渐显。
    // ★BJ666 普查刀①（2026-10-12）：GetAlpha :81225-81228 `type==465 →
    //   Color(255,255,255,0)×(1−alpha/255)`——A=0【纯加算白】×(1−α/255) 渐显
    //   （XNA 预乘 out=tex.rgb×(1−α/255) 全额加算,不读格光=自发光）。旧实现
    //   source-over 直绘实体层 → compositeLight 全屏乘光压暗（BJ529 探针
    //   _bj529-skull-ab 暗腔 k=0.325 同病）+合成方式错（加算→over 双偏离）。
    //   承接=BJ530 Dart 44 判例同构：capture→本体不进实体层,projFullbrightQueue
    //   光照合成后主画布 'lighter' 复绘（ga=(255−α)/255 同曲线;mock 无队列回退
    //   直绘=测试/探针链）。α 曲线零改（AI :30919-30925 已接 −5/拍 渐显）。
    const ctx = r.ctx;
    if (!ctx) return;
    const bright = (255 - this.alpha) / 255;
    if (bright <= 0) return;
    const img = projFrameImg(465, this.frame) ?? projSprite(465);
    const cx465 = this.cx, cy465 = this.cy;
    const drawInto = (c: CanvasRenderingContext2D) => {
      c.save();
      c.imageSmoothingEnabled = false;
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = Math.max(0, Math.min(1, bright));
      if (img && img.width > 0) {
        c.drawImage(img, cx465 - img.width / 2, cy465 - img.height / 2,
          img.width, img.height);
      } else {
        c.fillStyle = '#9FE8F0';
        c.beginPath(); c.arc(cx465, cy465, 28, 0, Math.PI * 2); c.fill();
      }
      c.restore();
    };
    const qFb = (r as unknown as {
      queueProjFullbright?: (fn: (c: CanvasRenderingContext2D) => void) => void;
    }).queueProjFullbright;
    if (typeof qFb === 'function') qFb.call(r, drawInto);
    else drawInto(ctx);
  }
}

/** 克隆体生成出口(:65646-65650 NewNPC 440:X,Y 是底部中心坐标且 Y 再 +真身 height/2;
 *  ai[3]=真身 whoAmI / localAI[1]=仪式代数)。本仓:la3=真身引用、la1=代数、跳过出生显影。
 *  入场音:原版 localAI[0]==0 的入场演出块(:65298-65307,两版本同段)对克隆体同样生效
 *  ——NewNPC 首个 AI tick 也播 case29 style89(Zombie_89)且置 ai[0]=-1 显影,本仓跳过
 *  显影态但补播该声(等效出生点),2026-08-31 台账批 */
function spawnCultistClone(game: GameHooks, parent: Enemy, x: number, y: number, gen: number): Enemy | null {
  const c = spawnPart(game, parent, 440);
  if (!c) return null;
  const la = laOf(c);
  la.la3 = parent;
  la.la1 = gen;
  c.x = x - c.w / 2;
  c.y = y + parent.h / 2 - c.h;
  c.bInit = true; // 原版克隆体会落入 1t 的 -1 显影态(:65047),无实际效果,直接跳过
  game.playSfxWav?.('Zombie_89', 1, c.cx, c.cy);   // :65299(克隆体首个 AI tick 等效点)
  return c;
}

/** 克隆体补射 468(:65375-65397 冰雾 / :65462-65499 火球第三拍 / :65531-65562 闪电 /
 *  :65796-65822 光第三拍):每只克隆体朝玩家(预判 20t)发 count 发,18 伤,
 *  (6+rand4) 速 ±spread 散布,出口 = 克隆体中心 + (facing*30, 12)。
 *  弹 468 首拍音 Item_34(Projectile.cs:55280-55287 ai[1]==0 → SoundID.Item34):
 *  原版逐弹首 tick 各播一次——与触发招式无关,凡 468 出膛即播(2026-08-26 工单⑧补;
 *  1458 四处发射点 = NPC.cs:65610/:65683/:65761/:65990) */
function cloneSupplement(game: GameHooks, clones: Enemy[], player: Player, count: number, spread: number): void {
  for (const c of clones) {
    const dir = Math.sign(player.cx - c.cx);
    if (dir !== 0) c.facing = dir;
    const aim = aimLead(c, player, c.facing);
    for (let k = 0; k < count; k++) {
      const spd = 6 + Math.random() * 4;
      const [dvx, dvy] = rot(aim.x * spd, aim.y * spd, (Math.random() - 0.5) * 2 * spread);
      shoot(game, c.cx + c.facing * 30, c.cy + 12, dvx, dvy, 18, 468);
      game.playSfxWav?.('Item_34', 1, c.cx + c.facing * 30, c.cy + 12);   // :55285
    }
  }
}

/** 仪式圈心(原版 Projectile 490 的位置 = 仪式开始时真身中心,:65652)。
 *  真身存 la2;克隆体读真身的 la2 */
function ritualCenterOf(isReal: boolean, la: { la2: unknown }, parent: Enemy | null): { x: number; y: number } | null {
  const raw = (isReal ? la.la2 : (parent ? laOf(parent).la2 : null)) as { x: number; y: number } | null;
  return raw ?? null;
}

/** 教徒 FindFrame 帧机状态（counter+帧行对；localAI 槽被仪式圈心/克隆引用
 *  占用（la2/la3 勿动）→ 独立 WeakMap 落盘） */
const cultistAnim = new WeakMap<Enemy, { fc: number; row: number }>();

/** AI 态 → 原版 FindFrame localAI[2] 帧态六值（写点行号）：
 *  出生显形分段 :65120-65136（>360→13 / >300→10 / >120→1 / 其余→0，先自增
 *  后分段——本函数在 AI 自增前调用故 +1）/ 选招 :65148→10 / 飞掠 :65348→10 /
 *  冰 :65365→11 / 火 :65436→11 / 雷 :65520-65524→真身 12·克隆 11（flag2 门）/
 *  仪式 :65575 头部→10，[30,90) 与 [120,420) 两窗按到圈心向量覆写
 *  （|uy|<0.77→11 / uy<0→12 / 其余→10，:65657-65702/:65730-65763 同构）/
 *  硬直 :65786→13 / 光 :65811→11 / 末日 :65878→13 */
function cultistFrameState(
  e: Enemy, la: ReturnType<typeof laOf>, isReal: boolean, parent: Enemy | null,
): number {
  switch (e.ai0) {
    case -1: {
      const s = e.ai1 + 1;
      return s > 360 ? 13 : s > 300 ? 10 : s > 120 ? 1 : 0;
    }
    case 5: {
      const tt = e.ai1;
      if ((tt >= 30 && tt < 90) || (tt >= 120 && tt < 420)) {
        const cir = ritualCenterOf(isReal, la, parent);
        if (cir) {
          let dx = cir.x - e.cx, dy = cir.y - e.cy;
          const d = Math.hypot(dx, dy);
          if (d === 0) { dx = 0; dy = -1; } else { dx /= d; dy /= d; }
          return Math.abs(dy) < 0.77 ? 11 : dy < 0 ? 12 : 10;
        }
      }
      return 10;
    }
    case 4: return isReal ? 12 : 11;
    case 6: return 13;
    case 8: return 13;
    case 2:
    case 3:
    case 7: return 11;
    default: return 10;   // 选招 0 / 飞掠 1
  }
}

/** 教徒 FindFrame 副本（NPC.cs:72698-72783）：帧态→帧行——
 *  态0→行0 / 态1→行1 / 态2→行2 定格（先播一轮行带再落定格行）；
 *  态10→行4-6 / 态11→行10-12 / 态12→行7-9 / 态13→行13-15 恒循环。
 *  节拍 15t 一轮、行内 5t/帧（cs:72719 ≥15 回卷、cs:72726 /5），
 *  counter 每 tick +1（cs:72781）；帧号直写 customFrameIdx（694 先例） */
function cultistFrameTick(e: Enemy, st: number): void {
  let a = cultistAnim.get(e);
  if (!a) { a = { fc: 0, row: 0 }; cultistAnim.set(e, a); }
  const wrap = a.fc >= 15;
  if (wrap) a.fc = 0;
  const seg = Math.floor(a.fc / 5);
  switch (st) {
    case 0:
      if (wrap) a.row = 0;
      else if (a.row !== 0) a.row = seg + 4;
      break;
    case 10: a.row = seg + 4; break;
    case 1:
      if (wrap) a.row = 1;
      else if (a.row !== 1) a.row = seg + 10;
      break;
    case 11: a.row = seg + 10; break;
    case 2:
      if (wrap) a.row = 2;
      else if (a.row !== 2) a.row = seg + 7;
      break;
    case 12: a.row = seg + 7; break;
    case 13: a.row = seg + 13; break;
  }
  a.fc += 1;
  e.customFrameIdx = a.row;
}

export function lunaticCultistAI(e: Enemy, game: GameHooks, player: Player | null): void {
  const la = laOf(e);
  // expert 数值链 + getGoodWorld 抬档(NPC.cs:65130-65174,次序照原文:expert 先赋、g 再减/覆写):
  const ftw = !!game.world.seedFlags?.getGoodWorld;
  const expert = game.world.isExpert;              // Main.expertMode(:65130)
  const diff = e.difficulty;                       // npc.difficulty → GetAttackDamage_ForProjectiles
  // 冰间隔 num(:65132-65142):120 →(expert)90 →(g)−30
  let numIce = 120; if (expert) numIce = 90; if (ftw) numIce -= 30;
  // 火间隔/拍数 num2/num3(:65142-65154):18×3 →(expert)12×4 →(g)覆写 10×5
  let numFire = 18, fireCount = 3;
  if (expert) { numFire = 12; fireCount = 4; }
  if (ftw) { numFire = 10; fireCount = 5; }
  // 雷间隔 num4(:65155-65165):80 →(expert)40 →(g)−20
  let numBolt = 80; if (expert) numBolt = 40; if (ftw) numBolt -= 20;
  // 光拍距 num5/expert 30(:65165-65171)、拍数 num6 恒 2;末日节拍 num7=20×num8=3 不分档(:65173-65174)
  const lightIv = expert ? 30 : 20;
  const lightN = 2;
  // 弹伤 Remap(NPC.cs:7079 ForProjectiles=(int)Remap(difficulty,Classic,Expert,n,e)):冰 :65133/火 :65144/雷 :65156
  const iceDmg = getAttackDamageForProjectiles(35, 25, diff);
  const fireDmg = getAttackDamageForProjectiles(30, 20, diff);
  const boltDmg = getAttackDamageForProjectiles(45, 30, diff);
  const isReal = e.vanillaId !== 440; // flag2 = type==439(:64971);440 = 克隆体
  let parent: Enemy | null = null;
  // ---- 克隆体镜像段(:64998-65015):真身失效 → 消散;ai0/ai1 逐 tick 镜像;
  //      仪式态中被击中 → 自身消散 + 真身进 6 态硬直 ----
  if (!isReal) {
    parent = (la.la3 as unknown as Enemy) ?? null;
    if (!parent || parent.dead || parent.vanillaId !== 439) { // :64975-64982
      e.dead = true;
      return;
    }
    e.ai0 = parent.ai0;
    e.ai1 = parent.ai1;
    if (e.ai0 === 5) {
      if (e.justHit) { // :65003-65014
        game.spawnParticles(e.cx, e.cy, '#8060D0', 14, 2.4);
        e.dead = true;
        parent.ai0 = 6;
        parent.ai1 = 0;
        return;
      }
      // ★BJ347-②：仪式态克隆体可击（justHit 消费窗）——须显式清持续态
      // （原版 flag3/flag4 每 tick 重算,本仓 dontTakeDamage 持续位需两向写）
      e.dontTakeDamage = false;
    } else {
      // ★BJ347-②：仪式窗外克隆体无敌=原版 flag3/flag4（:65211-65212,合流
      //  dontTakeDamage=flag3 :66108,持续态）——旧 iframes=2 每 tick 刷新近似被
      //  hurt 免疫门 pierce===1 豁免绕过（Enemy.hurt `pierce!==1 && iframes>0`,
      //  R23b-P1 同族反模式）→ 箭/枪弹/多数随从可打仪式窗外克隆体=偏差
      e.dontTakeDamage = true;
    }
  } else if (!e.bInit) {
    // :65047-65057 localAI[0]==0:音效 + alpha=255 + ai[0]=-1(出生显形)
    e.bInit = true;
    e.ai0 = -1; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0;
    la.la0 = 1;
    e.spawnAlpha = 254;
    game.playSfxWav?.('Zombie_89', 1, e.cx, e.cy);   // :65093 PlaySound(29,…,89)——case29 style89 ×0.7 自动档(曾借 roar 0.6)
  }
  // 环境声（:64923-64926）：ai0≠-1 时 1/1000 播 Next(88,92)=Zombie_88-91 变体池
  if (e.ai0 !== -1 && Math.floor(Math.random() * 1000) === 0) {
    game.playSfxWav?.(`Zombie_${88 + Math.floor(Math.random() * 4)}`, 1, e.cx, e.cy);
  }
  const b = baseOf(e);
  const phase2 = e.hp <= e.maxHp / 2;                       // flag :64928
  e.def.defense = Math.floor(phase2 ? b.def * 0.65 : b.def); // :64982-64985 半血防御 ×0.65

  // :65060-65088 玩家死/超 5600px → 消散退场(连带清全部克隆体,:65078-65087)
  // ★BJ347：原版自毁 = life=0+HitEffect+active=false（NPC.cs:65272-65276，不走
  //   checkDead→Kill→NPCLoot）→ 无掉落、不写 downed_439、不召四柱、无击败公告
  //   （DoDeathEvents case 439 只挂击杀链 :80209）。TargetClosest(:78453) 跳过
  //   dead 玩家 → 单人死亡 = 无目标 = 自毁。本支必须置 bossFled=非击杀消散
  //   （同 Enemy.runDespawnFx 语义），否则 Game bossBlock 误走击败链
  //   （downed_439+triggerLunarApocalypse+击败公告）——用户实报"同归于尽没掉
  //   远古操作机"根因：自毁被误记账成击败。
  if (!player || player.dead || Math.hypot(player.cx - e.cx, player.cy - e.cy) > 5600) {
    game.spawnParticles(e.cx, e.cy, '#6040A0', 14, 2.4);
    if (isReal) {
      for (const c of cultistClones(game, e)) {
        game.spawnParticles(c.cx, c.cy, '#6040A0', 10, 2);
        c.dead = true;
      }
    }
    e.bossFled = true;    // 非击杀消散：无掉落无记账（原版 life=0+active=false 同相）
    e.dead = true;
    return;
  }

  // ---- 仪式窗口(120-420t)真身被击中(:65012-65056):推进选招 + 清同代克隆体(≤10)
  //      + 仪式圈 ai[1]=-1 快速淡出且不召龙（:65054 Main.projectile[ai[2]].ai[1] = -1）----
  if (isReal && e.ai0 === 5 && e.ai1 >= 120 && e.ai1 < 420 && e.justHit) {
    e.ai0 = 0; e.ai1 = 0; e.ai3 += 1; // :65014-65016
    e.vx = 0; e.vy = 0;
    let budget = expert ? 3 : 10; // num9 经典 10/expert 3(:65270-65273);两分支同为清场,差异仅联网消息
    for (const c of cultistClones(game, e)) {
      if (budget <= 0) break;
      budget--;
      game.spawnParticles(c.cx, c.cy, '#8060D0', 12, 2.4);
      c.dead = true;
    }
    const circle = la.la3;
    if (circle instanceof CultistRitualCircle) circle.interrupt();
  }

  // ---- FindFrame 帧机（cs:72698-72783）：原版 localAI[2] 六态→帧行；本仓 la2
  //      已挪用存仪式圈心（勿动）→ 帧态按各态语义重算（见 cultistFrameState），
  //      帧号直写 customFrameIdx（Renderer 首行直读，694 先例）。状态机各块早退
  //      前先走本段（与原版 AI 内写 localAI[2]、AI 后 FindFrame 的时序等价）；
  //      netPuppet 无本地 AI → 帧冻结（登记）----
  cultistFrameTick(e, cultistFrameState(e, la, isReal, parent));

  // 朝向(:65117-65120 sign(player.X - center.X);仪式态内被 :65676 系圈心朝向覆盖)
  const face = Math.sign(player.cx - e.cx);
  if (face !== 0) e.facing = face;

  // ---- ai0 == -1 出生显形(:65059-65109):420t,前段不可选中;300t 起上浮 ----
  if (e.ai0 === -1) {
    e.spawnAlpha = Math.max(0, 254 - e.ai1 * 5); // :65066 alpha -= 5/tick
    // ★BJ347-②：显形窗无敌=原版 flag3/flag4 持续态(:65345-65346,合流 :66108)——
    //  旧 iframes=2 每 tick 刷新被 hurt 免疫门 pierce===1 豁免绕过（R23b-P1 同族反模式）
    e.dontTakeDamage = true;
    e.ai1 += 1;
    if (e.ai1 > 360) { e.vx *= 0.95; e.vy *= 0.95; }      // :65109-65111 收势阻尼
    else if (e.ai1 > 300) { e.vx = 0; e.vy = -1; }        // :65113-65115 velocity=-UnitY
    // :65117-65124 显形末段(>360)播 (29,…,105)=Zombie_105——case29 衰减表
    // (LegacySoundPlayer.cs:1011-1049)只列 24-87×0.5/88-91×0.7/92×0.5/93-99×0.4/
    // 100-101×0.25/102×0.4/103×0.4/104×0.55,【105 无衰减项 = 满档】,终审补
    if (e.ai1 === 361) game.playSfxWav?.('Zombie_105', 1, e.cx, e.cy);
    flyIntegrate(e);
    if (e.ai1 >= 420) { e.ai0 = 0; e.ai1 = 0; e.spawnAlpha = 0; }
    return;
  }
  // ★BJ347-②：非显形 tick 显式清显形无敌（dontTakeDamage 持续位须两向写,
  //  原版 flag3/flag4 每 tick 重算——战斗态/仪式态本体可击）。
  //  ★仅真身：克隆体无敌位在本函数克隆分支内两向自洽（窗外 true/仪式窗 false）,
  //  此处误清会覆盖克隆体窗外无敌相
  if (isReal) e.dontTakeDamage = false;

  // ---- ai0 == 0 选招(:65110-65336):40t 后按 ai3 拍号取招(flag2 门控,克隆体不选) ----
  if (e.ai0 === 0) {
    e.ai1 += 1;
    if (isReal && e.ai1 >= 40) {
      e.ai1 = 0;
      let pick = cultistPick(e, phase2);
      // ---- 远古末日随机替换(:65462-65477,两版同段):expert ∧ 半血(flag) ∧ 拍号
      //      非 0 冲/4 仪式/5 光 → 按 maxValue 概率阶梯改拍末日 num13=6;
      //      CountNPCS(523) < 10 上限门(本仓=统计存活 vanillaId 523)。
      //      梯度原文:life<maxHp/3 → 4、再 <maxHp/4 → 3(逐条覆写式 if),否则 6。
      //      经典模式该支恒假(expertMode 门)——此前态体已在而选拍永不给(:65134 注)
      if (isReal && expert && phase2 && pick !== 0 && pick !== 4 && pick !== 5
        && countVanillaNpcs(game, 523) < 10) {
        const maxValue = e.hp < e.maxHp / 4 ? 3 : e.hp < e.maxHp / 3 ? 4 : 6; // :65462-65466
        if (Math.floor(Math.random() * maxValue) === 0) pick = 6;              // :65471 Next(maxValue)==0
      }
      if (pick === 0) {
        // 飞掠占位(:65277-65336):真身 + 全部克隆体一起入环——环位角
        // num16 = ((序号+flag5+1)/2)·2π·0.4/总数,奇数序取负(flag5=总数偶数),
        // 半径椭圆 (300,200),自转轴 (0,-1)。
        // num14 = ceil(真身到 (玩家中心+(0,-100)) 距离/50)（:65271 真身口径,全员共用
        // ——曾按各成员自身落点分别计算),velocity = 位移/num14,ai1 = num14*2
        const num14 = Math.max(1, Math.ceil(
          Math.hypot(player.cx - e.cx, player.cy - 100 - e.cy) / 50));
        const group = [e, ...cultistClones(game, e)];
        const flag5 = group.length % 2 === 0 ? 1 : 0; // :65286
        let idx = 0;
        for (const m of group) {
          let num16 = Math.floor((idx + flag5 + 1) / 2) * Math.PI * 2 * 0.4 / group.length; // :65291-65296
          if (idx % 2 === 1) num16 = -num16;
          if (group.length === 1) num16 = 0;
          const [ux, uy] = rot(0, -1, num16);
          const destX = player.cx + ux * 300;
          const destY = player.cy + uy * 200;
          m.vx = (destX - m.cx) / num14;
          m.vy = (destY - m.cy) / num14;
          m.ai0 = 1;
          m.ai1 = num14 * 2;
          // :65305-65308 whoAmI >= 自身 → 选招当帧回退(净位移 0);克隆体按 id 序决定
          if (m === e || e.id >= m.id) { m.x -= m.vx; m.y -= m.vy; }
          idx++;
        }
      } else if (pick === 1) { e.ai0 = 3; } // 火球
      else if (pick === 2) { e.ai0 = 2; }   // 冰雾
      else if (pick === 3) { e.ai0 = 4; }   // 闪电
      else if (pick === 4) { e.ai0 = 5; }   // 仪式瞬移
      else if (pick === 5) { e.ai0 = 7; }   // 远古之光
      else if (pick === 6) { e.ai0 = 8; e.ai1 = 0; }   // 远古末日(:65543-65546 expert∧半血随机替换,见上 doomRoll)
    }
    flyIntegrate(e);
    return;
  }

  // ---- ai0 == 1 飞掠(:65338-65361):奇数拍回退位移 → 实际隔拍移动;期间无敌(flag3) ----
  if (e.ai0 === 1) {
    e.iframes = 2;
    const undo = Math.floor(e.ai1) % 2 !== 0 && e.ai1 !== 1; // :65341-65344
    if (!undo) flyIntegrate(e);
    e.ai1 -= 1;
    if (e.ai1 <= 0) { e.ai0 = 0; e.ai1 = 0; if (isReal) e.ai3 += 1; e.vx = 0; e.vy = 0; }
    return;
  }

  // ---- ai0 == 2 冰雾 464(:65362-65429):4t 时克隆体各补 1 发 468 + 真身 1 发 464
  //      (伤=ForProjectiles(35,25),2026-08-31 remap);持续 4+num(num=120/expert90,
  //      g 再 −30 :65132-65142) ----
  if (e.ai0 === 2) {
    if (isReal && e.ai1 >= 4 && (e.ai1 - 4) % numIce === 0) {
      cloneSupplement(game, cultistClones(game, e), player, 1, 0.5235987901687622); // :65375-65397
      // :65411-65421 发的是 ai[1]=1 母云(IceMistCloud 实体,Projectile.cs:30763-30790)——
      // 每 30t 沿自转派生子体,150t 寿终;曾坍缩为单发直飞 Arrow(旧注释「直飞桶」);
      // Item_120 首帧音随实体化迁入 IceMistCloud 首帧(母云+每颗子体各播,:30749-30752)
      const aim = aimLead(e, player, e.facing);
      const cloud = new IceMistCloud(e.cx + e.facing * 30, e.cy + 12,
        aim.x * 4, aim.y * 4, iceDmg, true);
      (game as unknown as { entities: { add: (en: Entity, b: string) => void } }).entities
        .add(cloud, 'projectiles');
      // 原版冰雾发射零吼(:65040-65900 全段仅 65093/65122 两声)——曾借 roar 0.35,2026-08-18 对账删
    }
    e.ai1 += 1;
    if (e.ai1 >= 4 + numIce) { e.ai0 = 0; e.ai1 = 0; if (isReal) e.ai3 += 1; e.vx = 0; e.vy = 0; }
    return;
  }

  // ---- ai0 == 3 火球 467(:65430-65530):每 num2t 一发×num3(经典 18×3/expert 12×4/
  //      g 覆写 10×5 :65142-65154),(6+rand4) 速 ±0.52rad 散布,伤=ForProjectiles
  //      (30,20)(:65144);第三拍克隆体各补 1 发 468(:65462-65499);持续 4+num2*num3。
  //      ★弹道升级(2026-08-31 台账批):原版 467 为制导弹(AI_001 type==467 支,
  //      1458 P.cs:55133-55253/1457 :55132-55252),制导已由 Arrow 直飞桶内的
  //      projId===467 专支实装——ai[1] 状态机:0 首拍(播 Item34,发射点已代播)
  //      → 每 19 个 AI 更新回查锁定(CanHit 1×1 点对,首轮 [1..20) 计数循环语义,
  //      ★非每 tick 重试)→ 锁定后 ai[1]∈(20,200) 保速转向 AngleLerp(target,0.008),
  //      <20px 自爆 Kill;alpha −40/update 渐显 + AddLight + 尾尘环。命中侧
  //      OnFire(24)=vanillaProjStatusPlayer 表、消亡爆=Game.onProjectileDeath
  //      467 分支(P.cs:74390)双通道不变。
  //      ★ttl 裁定(终清波复核):vanilla SetDefaults(P.cs:5364-5372)无 timeLeft 覆写
  //      ⇒缺省 3600;本仓仍传 shoot 缺省 life=300 —— 判定【成立】:全仓弹幕实体无离屏
  //      剔除(VanillaDust 的 ±400 屏外裁剪只作用于尘池),放宽到 3600 会让脱靶制导火球
  //      在玩家远行期间持续存活/汇聚(参考返场即遇满屏追猎),维持 300 直至引擎补齐
  //      弹幕离屏剔除后一并放宽(已在此注留档,勿无声"顺手改真")----
  if (e.ai0 === 3) {
    if (isReal && e.ai1 >= 4 && (e.ai1 - 4) % numFire === 0) {
      // 原版硬编码第 3 拍(:65442 /num2==2)——FTW 5 拍下仍在第 3 拍补射,1:1 保留
      if ((e.ai1 - 4) / numFire === 2) {
        cloneSupplement(game, cultistClones(game, e), player, 1, 0.5235987901687622); // :65448-65462
      }
      const aim = aimLead(e, player, e.facing);
      const spd = 6 + Math.random() * 4;
      const [dvx, dvy] = rot(aim.x * spd, aim.y * spd, (Math.random() - 0.5) * 2 * 0.5235987901687622);
      shoot(game, e.cx + e.facing * 30, e.cy + 12, dvx, dvy, fireDmg, 467); // :65505-65517
      // 弹 467 首拍音(Projectile.cs:55133-55139 ai[1]==0 → SoundID.Item34,逐弹一声,弹位=出膛点)
      game.playSfxWav?.('Item_34', 1, e.cx + e.facing * 30, e.cy + 12);
    }
    e.ai1 += 1;
    if (e.ai1 >= 4 + numFire * fireCount) { e.ai0 = 0; e.ai1 = 0; if (isReal) e.ai3 += 1; e.vx = 0; e.vy = 0; }
    return;
  }

  // ---- ai0 == 4 闪电 465(:65531-65622):ai1==20 时克隆体各补 1 发 468(:65531-65562),
  //      之后每逢 (ai1-20)%num4==0 在头顶 100px 撒 465(伤=ForProjectiles(45,30)
  //      :65156)(num4=80/expert40,g 再 −20 :65155-65165);持续 20+num4 ----
  if (e.ai0 === 4) {
    if (isReal && e.ai1 >= 20 && (e.ai1 - 20) % numBolt === 0) {
      if (e.ai1 === 20) {
        cloneSupplement(game, cultistClones(game, e), player, 1, 0.5235987901687622);
        // 原版闪电发射零吼(同上全段普查)——曾借 roar 0.5,2026-08-18 对账删
      }
      // 原版 465 零速定点 180t(LightningOrb 实体,Projectile.cs:30860-30937),每 30t
      // 朝 ≤5 玩家掷 466 闪电链——曾坍缩为 6 速直飞 Arrow,实体化还原定点悬停
      const orb = new LightningOrb(e.cx, e.cy - 100, boltDmg);   // :65563-65566(速度 0)
      (game as unknown as { entities: { add: (en: Entity, b: string) => void } }).entities
        .add(orb, 'projectiles');
      game.playSfxWav?.('Item_121', 1, e.cx, e.cy - 100);   // 弹 465 首帧音(:30864-30867,保留调用点播,防实体内双播)
    }
    e.ai1 += 1;
    if (e.ai1 >= 20 + numBolt) { e.ai0 = 0; e.ai1 = 0; if (isReal) e.ai3 += 1; e.vx = 0; e.vy = 0; }
    return;
  }

  // ---- ai0 == 5 仪式瞬移(:65623-65770):0-30 淡出,30 环位重定位 + 生成/补位克隆体,
  //      30-90 隐形,90-120 淡入,120-420 显形可受击(打真身/克隆体窗口);持续 420 ----
  if (e.ai0 === 5) {
    const t = e.ai1;
    if (t >= 0 && t < 30) {
      e.spawnAlpha = Math.floor((t / 30) * 254);
      e.iframes = 2; // flag3/flag4
    } else if (t >= 30 && t < 90) {
      e.spawnAlpha = 254;
      e.iframes = 2;
      if (t === 30 && isReal) {
        // :65636-65675:环绕自身半径 180 的 num29 环位重定位——
        //   补位克隆体(总数目标 6,每轮至多新造 2),余下槽位重排既有克隆体;
        //   真身取「距玩家最远」槽(num31 = 最近槽的对侧);圈心(=重定位前中心)存
        //   la2 供本态朝向用,并于此原位发 490 仪式圈弹（:65643，ai[1]=真身索引）
        la.la1 += 1; // localAI[1] 仪式代数(:65637)
        la.la2 = { x: e.cx, y: e.cy };
        // ai[2] = 490 仪式圈弹索引（:65652）——真身 la3 反存圈引用供中断链（:65054）
        const circle = new CultistRitualCircle(e);
        la.la3 = circle;
        (game as unknown as { entities: { add: (en: Entity, b: string) => void } }).entities
          .add(circle, 'projectiles');
        const clones = cultistClones(game, e);
        let num28 = 6 - clones.length; // :65643-65647
        if (num28 > 2) num28 = 2;
        const num29 = clones.length + num28 + 1;
        const dists: number[] = [];
        for (let s = 0; s < num29; s++) { // :65650-65656 各槽到玩家距离
          const [rx, ry] = rot(180, 0, (s * Math.PI * 2) / num29 - Math.PI / 2);
          dists.push(Math.hypot(e.cx + rx - player.cx, e.cy + ry - player.cy));
        }
        let num31 = 0; // :65658-65664 取最近槽 → 映射到对侧(最远)槽
        for (let s = 1; s < num29; s++) if (dists[num31] > dists[s]) num31 = s;
        num31 = num31 >= num29 / 2 ? num31 - Math.floor(num29 / 2) : num31 + Math.floor(num29 / 2);
        let num33 = num28; // :65666 新造配额,耗尽后按序重排既有克隆体(list6[-num33-1])
        let reused = 0;
        for (let s = 0; s < num29; s++) {
          if (num31 === s) continue;
          const [rx, ry] = rot(180, 0, (s * Math.PI * 2) / num29 - Math.PI / 2);
          const px = e.cx + rx, py = e.cy + ry;
          if (num33-- > 0) spawnCultistClone(game, e, px, py, la.la1);
          else if (reused < clones.length) {
            const c = clones[reused++];
            c.x = px - c.w / 2;
            c.y = py - c.h / 2;
          }
        }
        // 真身移到 num31 槽(:65652 Center += 偏移向量)
        const [fx, fy] = rot(180, 0, (num31 * Math.PI * 2) / num29 - Math.PI / 2);
        e.x += fx;
        e.y += fy;
        e.vx = 0; e.vy = 0;
        game.spawnParticles(e.cx, e.cy, '#8060D0', 18, 2.6);
        // 原版仪式圈就位零吼(同上全段普查)——曾借 roar 0.7,2026-08-18 对账删
      }
    } else if (t >= 90 && t < 120) {
      e.spawnAlpha = Math.floor(254 * (1 - (t - 90) / 30));
      e.iframes = 2;
    } else {
      // 120-420:显形且可受击(alpha=0,不置 iframes;chaseable 原版为 false,:65954)
      e.spawnAlpha = 0;
      // 朝向:以仪式圈心为基准(:65706-65719 / :65743-65756 sign(圈心-自身).X)
      const cir = ritualCenterOf(isReal, la, parent);
      if (cir) {
        const dx = cir.x - e.cx;
        if (dx !== 0) e.facing = Math.sign(dx);
      }
    }
    e.ai1 += 1;
    if (e.ai1 >= 420) { e.ai0 = 0; e.ai1 = 0; if (isReal) e.ai3 += 1; e.vx = 0; e.vy = 0; }
    return;
  }

  // ---- ai0 == 6 硬直(:65771-65784):打中克隆体后真身暴露(不置 iframes),120t 后回选招 ----
  if (e.ai0 === 6) {
    e.ai1 += 1;
    if (e.ai1 >= 120) { e.ai0 = 0; e.ai1 = 0; if (isReal) e.ai3 += 1; e.vx = 0; e.vy = 0; }
    flyIntegrate(e);
    return;
  }

  // ---- ai0 == 7 远古之光(:65796-65877):每 num5t 一轮×num6(经典 20×2/expert 30×2,
  //      :65165-65171);第三拍克隆体各补 5 发 468(±1.2566rad,:65796-65822),真身每轮以
  //      扇面(步进 2π/25,8 速)召 5 只 NPC522(:65862-65865,ai1=逐 t 弯转角 → AI_100
  //      轨道弹);持续 4+num5*num6 ----
  if (e.ai0 === 7) {
    if (isReal && e.ai1 >= 4 && (e.ai1 - 4) % lightIv === 0) {
      e.facing = Math.sign(player.cx - e.cx) || e.facing; // :65839-65843
      const aim = aimLead(e, player, e.facing);
      const num47 = (Math.PI * 2) / 25; // :65856
      if ((e.ai1 - 4) / lightIv === 2) {
        cloneSupplement(game, cultistClones(game, e), player, 5, 1.2566370964050293);
      }
      for (let i = 0; i < 5; i++) {
        const [dvx, dvy] = rot(aim.x * 8, aim.y * 8, num47 * i - (Math.PI * 2 / 5 - num47) / 2); // :65860
        const n = spawnPart(game, e, 522);
        if (n) {
          // NewNPC(..., vector15.X, vector15.Y + 7, 522, ...) → X=中心横坐标,Y=底部纵坐标
          n.ai0 = 0;
          n.ai1 = (Math.random() - 0.5) * 0.3 * (Math.PI * 2) / 60; // :65861 逐 t 弯转角
          n.ai2 = dvx; n.ai3 = dvy;                                  // 初速(AI_100 首拍取用)
          n.x = e.cx + e.facing * 30 - n.w / 2;
          n.y = e.cy + 12 + 7 - n.h;
          n.vx = dvx; n.vy = dvy;
        }
      }
      // 原版火球(522)发射零吼(同上全段普查)——曾借 roar 0.5,2026-08-18 对账删
    }
    e.ai1 += 1;
    if (e.ai1 >= 4 + lightIv * lightN) { e.ai0 = 0; e.ai1 = 0; if (isReal) e.ai3 += 1; e.vx = 0; e.vy = 0; }
    return;
  }

  // ---- ai0 == 8 远古末日(:65873-65932):玩家附近随机空位撒 NPC523,数量 = min(克隆体+1, 3)
  //      (:65892-65897);选拍表不含 6——expert∧半血随机替换可达(见选拍 doomRoll),状态体常驻 ----
  if (e.ai0 === 8) {
    if (isReal && e.ai1 >= 4 && (e.ai1 - 4) % 20 === 0) {
      const st = game.world.store;
      const ptx = Math.floor(player.cx / TILE), pty = Math.floor(player.cy / TILE);
      const etx = Math.floor(e.cx / TILE), ety = Math.floor(e.cy / TILE);
      const want = Math.min(cultistClones(game, e).length + 1, 3);
      for (let k = 0; k < want; k++) {
        for (let tries = 0; tries < 100; tries++) { // :65904-65931 空位采样
          const tx = ptx + Math.floor(Math.random() * 41) - 20;
          const ty = pty + Math.floor(Math.random() * 41) - 20;
          const nearPlayer = Math.abs(ty - pty) <= 7 && Math.abs(tx - ptx) <= 7;
          const nearSelf = Math.abs(ty - ety) <= 3 && Math.abs(tx - etx) <= 3;
          if (nearPlayer || nearSelf || !st.inBounds(tx, ty) || st.isSolid(tx, ty)) continue;
          const n = spawnPart(game, e, 523);
          if (n) {
            n.x = tx * TILE + 8 - n.w / 2;
            n.y = ty * TILE + 8 - n.h / 2;
            n.vx = 0; n.vy = 0;
            n.ai0 = e.id; // :65930 ai[0] = 真身 whoAmI(本仓以运行时 id 代)
            n.bInit = true;
          }
          break;
        }
      }
    }
    e.ai1 += 1;
    if (e.ai1 >= 4 + 20 * 3) { e.ai0 = 0; e.ai1 = 0; if (isReal) e.ai3 += 1; e.vx = 0; e.vy = 0; }
    return;
  }

  // 未知状态:回选招
  e.ai0 = 0; e.ai1 = 0;
}

// ===================== AI_120 光之女皇 636(NPC.cs:46299-47302) =====================
// 状态机(ai0): 0 出生(180t) / 1 悬浮蓄力枢纽(DashTo 靠近 10t + 减速,45t(二阶段 20t)选招)/
//   2 彩虹射线 873 / 4 光枪墙 919 / 5 永恒彩虹 872 / 6 太阳舞 923 / 7 光枪回环 919(二阶段)/
//   8,9 刀阵冲刺(±50 速,6-40t 无敌蓄力,40-90t 伤害 ×1.5)/ 10 半血变身传送 /
//   11 预测光枪墙 919(expert 表专属拍) / 12 螺旋射线 873 / 13 淡出退场(目标失效/超 6400px)。
//   3(874 天降极光)为 expert 专属拍,跳过。
// 经典弹幕伤害(:46326-46345): 919 墙 50 / 919 回环 70 / 873 45 / 872 45 / 923 50 / 874 40。
// 选招表(:46460-46580 残差映射): 一阶段 10 拍 [2,8,6,8,5,2,8,4,8,5] 循环,血 ≤50% 强制 10(变身);
//   二阶段经典 9 拍 [7,2,8,5,2,6,4,8,12]——num37 槽位推进,flag2(expert/白天暴怒)时第 3 槽
//   (num51,:46528)插 11 → 10 拍 expert 表 [7,2,8,11,5,2,6,4,8,12](含 case 11 预测光枪墙);
//   表尾 num57=12(873 螺旋);反编译的 num54 双写 [..,6,6,..] 是同一 if 重复,
//   真表第 6 槽是 4、第 8 槽是 12。
const EMPRESS_CYCLE_P1 = [2, 8, 6, 8, 5, 2, 8, 4, 8, 5];
const EMPRESS_CYCLE_P2 = [7, 2, 8, 5, 2, 6, 4, 8, 12];
const EMPRESS_CYCLE_P2_EXPERT = [7, 2, 8, 11, 5, 2, 6, 4, 8, 12];

/** 原版 AI_120_HallowBoss_DashTo(:47304-47317):目标上移 300,>200 再回退 100,
 *  速度 = lerp(单位向量*min(len,18), vector/6, lerpValue(100,600,len)) */
function empressDashTo(e: Enemy, tx0: number, ty0: number): void {
  let tx = tx0, ty = ty0 - 300;
  const d0 = Math.hypot(tx - e.cx, ty - e.cy);
  if (d0 > 200) {
    const ux = (tx - e.cx) / (d0 || 1), uy = (ty - e.cy) / (d0 || 1);
    tx -= ux * 100; ty -= uy * 100;
  }
  const vx = tx - e.cx, vy = ty - e.cy;
  const len = Math.hypot(vx, vy) || 1;
  const lv = lerpValue(100, 600, len);
  const cap = Math.min(len, 18);
  e.vx = vLerp((vx / len) * cap, vx / 6, lv);
  e.vy = vLerp((vy / len) * cap, vy / 6, lv);
}

/** 悬浮趋近(:46502 系):距 (玩家+偏移) > 40 才以 SimpleFlyMovement(dir*12, 0.5) 靠近 */
function empressHover(e: Enemy, player: Player, ox: number, oy: number, spdMul = 1, accMul = 1): void {
  const tx = player.cx + ox, ty = player.cy + oy;
  if (Math.hypot(tx - e.cx, ty - e.cy) > 40) {
    const dx = tx - e.cx, dy = ty - e.cy;
    const d = Math.hypot(dx, dy) || 1;
    simpleFly(e, (dx / d) * 12 * spdMul, (dy / d) * 12 * spdMul, 0.5 * accMul);
  }
}

/** 实体化弹入桶(IceMistCloud/LightningOrb 同款 casts 的共口封装) */
function addProj(game: GameHooks, p: Entity): void {
  (game as unknown as { entities: { add: (en: Entity, b: string) => void } }).entities.add(p, 'projectiles');
}

// ---------------------------------------------------------------------------
// 光枪 919(AI_179_FairyQueenLance,Projectile.cs 两版本同段:1458 :45852-45872 /
// 1457 :45853-45873;SetDefaults :8716-8727)。原版 NewProjectile 以【零速】出生、
// ai[0]=出射角(rad)/ai[1]=发射点参(仅 GetColor 色相源,AI 不消费——旧注"ai1 延时
// 参"系误读);真实预告门是 localAI[0]<60:
//   · localAI[0]<60:速度恒零原地渐显(alpha=Lerp(255,0,lerpValue(0,20,la0)) 20t 显形),
//     rotation 锁定 ai[0](旋转锁定);
//   · ≥60:每 update 速度覆写为 ai[0].ToRotationVector2()×40,1/3 概率尘 267(
//     NewDustPerfect fadeIn=1/noGravity/alpha100/色=GetColor→White lerp,scale×1.5);
//   · ≥360 Kill;
//   · CanDamage 门 =(type==919 && localAI[0]<=60)(P.cs:12463 大表臂)→ 预告期不结算伤害。
// 命中判定(P.cs Colliding :15711-15727):300×300 粗筛盒(_lanceHitboxBounds,弹心
// 居中)∩目标后,沿 rotation 方向 center±40px 线段 × 宽 8(CheckAABBvLineCollision
// 线形判定盒——本仓 segHitsRect 胶囊近似,与 Dart/Betsy 同源)。
// 绘制(Main.cs DrawProj_FairyQueenLance :36492-36536)——2026-09-01 终清波逐 pass 直译:
//   color=AI_171_GetColor(P.cs:46399)=hslToRgb((ai[1]+0.5)%1,1,.5)·Opacity,
//   暴怒 → Color.Lerp(White,OurFavoriteColor(255,231,69),lerpValue(0,60,(int)Main.time))
//   ·Opacity(:46399-46406);color.A=0 的 pass 在预乘管线+AlphaBlend(One,InvSrcAlpha)
//   下=加性光叠(out.rgb+=tex·C.rgb),canvas 以 'lighter' 承载;A>0 的 pass 走 source-over。
//   结构:Extra_178 光带双画(num2=180×40/2=3600 全长/半长 × 高 2 帧·scaleY2,fade=
//   lerpValue(60,55)×lerpValue(0,10)) → 尾迹 num4=1..1/6 六步(-120·num4·|v|∈[0,1]
//   反向,color·lerpValue(10,60)·(1−num4)+白 0.15 第二画 scale×0.85) → 轨道环 4 点
//   ((n·2π+rot)×2·num3,color2=A/2) → 本体双画(num3=Lerp(.7,1,lerpValue(55,60)),先
//   ×1.1 大档再本体白画 White×lerpValue(0,20)(A/2))。色=hsl 真值乘色烘焙
//   (multiply+destination-in,键量化 8——hue-rotate 滤镜近似退役)。
// ---------------------------------------------------------------------------
export class FairyQueenLance extends Entity {
  readonly projId = 919;
  damage: number;
  w = 8; h = 8;                      // SetDefaults :8717-8718
  private la0 = 0;                   // localAI[0]
  private readonly ang: number;      // ai[0] 出射角
  private readonly ai1v: number;     // ai[1](绘制色相)
  private readonly enraged: boolean; // ShouldEmpressBeEnraged 出生档快照(逐帧读 Main.dayTime 差登记)
  private alpha = 255;
  dead = false;

  // ---- ★通用湿段（Projectile.cs:16903-17113,projWetSection.ts 共享体 1:1）----
  //  豁免核对：919 FairyQueenLance SetDefaults P.cs:8716-8728（8×8/aiStyle 179/
  //  alpha 255/penetrate −1/hostile/timeLeft 240/tileCollide=false【:8726】/
  //  ignoreWater=true【:8727】）→ 豁免 id,段门恒闭（:16903）= 原版零行为（字段照加、
  //  段照调,豁免分流由 ignoreWater 参数自动承载）。阻尼不适用（双证）：①豁免;
  //  ②tileCollide=false → 湿阻尼支 :17721-17764 不进（蓄射相速度 0,发射相当拍
  //  积分走 :16870 快照同值——AI 置速后同帧位移,快照=post-AI,quirk 无观察差）。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价） */
  presetDone = false;

  constructor(x: number, y: number, ang: number, ai1: number, damage: number,
    enraged = false) {
    super();
    this.enraged = enraged;
    this.x = x - this.w / 2;         // NewProjectile X/Y 为中心锚
    this.y = y - this.h / 2;
    this.ang = ang;
    this.ai1v = ai1;
    this.damage = damage;
  }

  /** Colliding :15711:粗筛盒 + ±40px 线段宽 8 */
  private hits(t: { x: number; y: number; w: number; h: number }): boolean {
    if (!projOverlap(this.cx - 150, this.cy - 150, 300, 300, t)) return false;
    const dirX = Math.cos(this.ang), dirY = Math.sin(this.ang);
    return segHitsRect(this.cx - dirX * 40, this.cy - dirY * 40, dirX * 80, dirY * 80, 8, t);
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    // ★通用湿段（:16903-17113）——919 豁免 id（P.cs:8727 ignoreWater=true）→ 段门
    //  恒闭零行为;插 tick 头与 AI/位移序无观察差（段内唯一可见面=溅花,豁免即恒无）
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      919, !!projectileData(919)?.ignoreWater);
    this.la0++;
    if (this.la0 >= 60) {                                    // :45855-45866 发射相
      this.vx = Math.cos(this.ang) * 40;
      this.vy = Math.sin(this.ang) * 40;
      if (Math.random() < 1 / 3) {                           // :45857-45866 尘 267
        const d = game.spawnDust?.(this.cx, this.cy, 0, 0, 267, 0, 0, 100, null, 1, false, true);
        if (d) {
          d.fadeIn = 1;                                      // fadeIn=1
          const [dr, dg, db] = this.colorRGB();
          const w = Math.random() * 0.4;                     // Color.Lerp(c,White,NextFloat×0.4)
          d.color = {
            r: Math.round(dr + (255 - dr) * w),
            g: Math.round(dg + (255 - dg) * w),
            b: Math.round(db + (255 - db) * w), a: 255,
          };
          d.noGravity = true;
          d.noLightEmittance = true;                         // (:45864)
          d.scale *= 1.5;                                    // scale ×1.5(:45865)
        }
      }
    }
    if (this.la0 >= 360) { this.dead = true; return; }       // :45863-45866
    // alpha = Lerp(255,0,lerpValue(0,20,la0))(:45868-45869)——渐显面
    this.alpha = Math.round(vLerp(255, 0, clamp(this.la0 / 20, 0, 1)));
    if (this.la0 >= 60) {
      // 发射相当拍积分(原版 AI 置速度后引擎同帧位移);伤害门另用 >60——
      // CanDamage 表臂 `localAI[0]<=60`(:12463)使首拍免伤 1:1
      this.x += this.vx;
      this.y += this.vy;
    }
    if (this.la0 > 60) {                                     // CanDamage 表 la0<=60 免伤门(:12463)
      // Damage_EVP 同式结算(hitPlayer 内嵌 immune 门/DamageVar/banner/cold/敌弹乘区)
      hitPlayer(this, game, this.damage, false, false, (p) => this.hits(p));
      hitTownNpcs(this, game, this.damage, 0, 'hostile', this.projId, (n) => this.hits(n));
    }
  }

  /** AI_171_GetColor(P.cs:46399-46406):非暴怒 = hslToRgb((ai[1]+0.5)%1,1,.5);
   *  暴怒 = White→OurFavoriteColor(255,231,69) Lerp(GetLerpValue(0,60,(int)Main.time))
   *  ——本仓取出生档快照(Main.time 渐变窗 ≤60t,稳态恒 OurFavoriteColor,快照语义
   *  落终值;昼→夜切换的活面差登记)。Opacity 与 A 分量由调用侧 globalAlpha 承载 */
  private colorRGB(): [number, number, number] {
    if (this.enraged) return [255, 231, 69];
    return hslToRgb255((this.ai1v + 0.5) % 1, 1, 0.5);
  }

  /** DrawProj_FairyQueenLance 直译(Main.cs :36492-36536)。XNA 预乘管线+AlphaBlend
   *  (One,InvSrcAlpha) 下:A=0 的 pass(C.a=0 ⇒ dst 权重恒 1)= 纯加性光叠,'lighter'
   *  承载;A>0 的 pass(color2=A/2·Opacity / color4=白·A/2)走 source-over。 */
  draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const la0 = this.la0;
    const opacity = 1 - this.alpha / 255;                   // P.Opacity(:45868 链)
    if (opacity <= 0) return;
    const [cr, cg, cb] = this.colorRGB();
    const img = projSprite(919);
    if (!img || !(img.width > 0)) {
      // 贴图缺失兜底：细长光条（色彩仍走真值）
      ctx.save();
      ctx.translate(this.cx, this.cy);
      ctx.rotate(this.ang);
      ctx.globalAlpha = Math.min(1, opacity);
      ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
      ctx.fillRect(-24, -4, 48, 8);
      ctx.restore();
      return;
    }
    const iw = img.width, ih = img.height;                  // 120×24 单帧
    // GetColor 乘色烘焙缓存(saturate 通道并给 color2 的 A/2 档复用同桶)
    const tinted = tintBake('p919', img, 0, 0, iw, ih, [cr, cg, cb]);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.ang);
    // ---- Extra_178 光带双画(:36505-36512):num=40,num2=180×40/2=3600 折半带宽;
    //      origin=(0,半高),scaleY 恒 2;color3=color×fade×GTLV(0,10)——A=0 加性 ----
    const band = r.atlas?.ensureVImage?.('vanilla/Extra_178.png') ?? null;
    if (band && band.width > 0) {
      const fade = lerpValue(60, 55, la0) * lerpValue(0, 10, la0);   // 出膛早段+临发尾削
      if (fade > 0) {
        const sxFull = 3600 / band.width;                    // XNA num2/Width
        const bw = band.width, bh = band.height;             // 512×2
        ctx.globalCompositeOperation = 'lighter';
        // 半长(scale2=(sxFull*0.5,2))
        const inner = tintBake('e178', band, 0, 0, bw, bh, [cr, cg, cb]);
        if (inner) {
          ctx.globalAlpha = Math.min(1, fade * opacity);
          ctx.drawImage(inner, 0, -bh, bw * sxFull * 0.5, bh * 2);
          ctx.globalAlpha = Math.min(1, fade * 0.3 * opacity);
          ctx.drawImage(inner, 0, -bh, bw * sxFull, bh * 2);
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    // ---- 弹体链:num3=Lerp(.7,1,GTLV(55,60));lerpValue=GTLV(10,60)(非 clamp 域,
    //      <10 为负整块跳过) → 尾迹六步 + 轨道环四点 + 本体双画 ----
    const num3 = vLerp(0.7, 1, lerpValue(55, 60, la0));
    const lv = lerpValue(10, 60, la0);
    const speedF = lerpValue(0, 1, Math.hypot(this.vx, this.vy));
    if (lv > 0 && tinted) {
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 6; k++) {                          // num4 = 1 - k/6（原文 -= 1/6）
        const n4 = 1 - k / 6;
        const ox = -(120 * n4 * speedF);
        ctx.globalAlpha = Math.min(1, lv * (1 - n4) * opacity);
        ctx.drawImage(tinted, ox - iw * num3 / 2, -ih * num3 / 2, iw * num3, ih * num3);
        // 白 0.15 第二画(白色温原画直接可绘)
        ctx.save();
        ctx.globalAlpha = Math.min(1, 0.15 * lv * (1 - n4) * opacity);
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(img, ox - iw * (num3 * 0.85) / 2, -ih * (num3 * 0.85) / 2,
          iw * num3 * 0.85, ih * num3 * 0.85);
        ctx.restore();
      }
      // 轨道环 4 点(offset 2·num3,color2=A/2·lv——alpha 档直承载;color2 半透明下
      // 在 straight 画布用 globalAlpha 等价承载预乘通道积)
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < 4; i++) {
        const a = (i * 0.25) * Math.PI * 2;
        const rx = Math.cos(a) * 2 * num3, ry = Math.sin(a) * 2 * num3;
        ctx.globalAlpha = Math.min(1, 0.5 * lv * opacity);
        ctx.drawImage(tinted, rx - iw * num3 / 2, ry - ih * num3 / 2, iw * num3, ih * num3);
      }
      ctx.globalAlpha = Math.min(1, 0.5 * lv * opacity);
      ctx.drawImage(tinted, -iw * num3 * 1.1 / 2, -ih * num3 * 1.1 / 2,
        iw * num3 * 1.1, ih * num3 * 1.1);
    }
    // 本体白画(color4=White×GTLV(0,20),A/2)
    const bodyA = lerpValue(0, 20, la0) * 0.5 * opacity;
    if (bodyA > 0) {
      ctx.globalAlpha = Math.min(1, bodyA);
      ctx.drawImage(img, -iw * num3 / 2, -ih * num3 / 2, iw * num3, ih * num3);
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// 太阳舞扫束 923(AI_180_FairyQueenSunDance,Projectile.cs 1458 :45791-45851 /
// 1457 :45804-45851 同段;SetDefaults :8759-8772 timeLeft=180——发射点曾误传 ttl240)。
// 原版 ai[0]=扫束起始角、ai[1]=女皇 whoAmI 锚:
//   · 本体 Center 每 update 锚回 type==636 的 NPC(ai[1] 反查),速度恒零(更新态位移只剩锚定);
//   · alpha −15/t 钳 0;scale = lerpValue(0,20)·lerpValue(180,120)(前 20t 张合到位、
//     ≥120t 收尾归零,全程 180t 后 Kill);
//   · rotation = ai[0] + π/9·lerpValue(50,180,la0)(50t 起转 20° 收拍);
//   · CanDamage 同上表臂(type==923 && localAI[0]<=60);命中(Colliding :15729-15753)
//     = 由心沿 rotation 三段锥形线束:scale·{510,660,800} 长 × scale·0.7·{100,60,10} 宽,
//     任一段相交即受理(近似=三次 segHitsRect);
//   · 束身光路(AI_180 :45818-45826 精确式):v3_ = hslToRgb((ai[0]/2π+la0/180)%1,
//     1,.85)·scale,num4=800·scale 上 13 点(num5=0..1 步 1/12)CastLightOpen——
//     DelegateMethods.cs:729-744 实心格豁免(本仓 store.isSolid 已含致动排除面)。
//     旧"六步采样+定值色因子"近似退役(2026-09-01 终清波);
//   · 首帧 Item_159 @base.Center(:45794)——移出调用点逐辐重复播,位置化 C 项收口。
// 绘制(Main.cs :28706-28741 四画直译):802×208 双帧行,num24 相位循环——
//   pass1/2 行2(value4/value5,hue+0.3/+0.15、lum lerp(0.3,.66/.5)、×白0.1、A/2,
//   外层 ×1.2/内层 ×1.1,暴怒→OurFavoriteColor 替换)、pass3 行1(color5·0.5)、
//   pass4 行2(color5·lerpValue(40,60));hslToRgb 真值乘色烘焙(hue-rotate 近似退役)。
// ---------------------------------------------------------------------------
export class SunDanceBeam extends Entity {
  readonly projId = 923;
  damage: number;
  w = 30; h = 30;                    // SetDefaults :8760-8761
  private la0 = 0;                   // localAI[0]
  private alpha = 255;
  private scaleV = 0;
  private rotation = 0;
  private readonly baseAng: number;  // ai[0]
  private readonly bossId: number;   // ai[1]
  private readonly enraged: boolean; // ShouldEmpressBeEnraged() 出生档快照(绘制配色)
  private sndPlayed = false;
  dead = false;

  // ---- ★通用湿段（Projectile.cs:16903-17113,projWetSection.ts 共享体 1:1）----
  //  豁免核对：923 FairyQueenSunDance SetDefaults P.cs:8759-8772（30×30/aiStyle 180/
  //  alpha 255/penetrate −1/hostile/timeLeft 180/tileCollide=false【:8769】/
  //  ignoreWater=true【:8770】/drawLayer 2）→ 豁免 id,段门恒闭（:16903）= 原版零行为
  //  （字段照加、段照调,豁免分流由 ignoreWater 参数自动承载）。阻尼不适用（双证）：
  //  ①豁免;②AI 锚本体（ai[1] 反查 636 → Center 吸附）+ 零速（:45815 velocity=0）,
  //  无 velocity 位移宿主。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价） */
  presetDone = false;

  constructor(x: number, y: number, ang: number, bossId: number, damage: number, enraged: boolean) {
    super();
    this.x = x - this.w / 2;
    this.y = y - this.h / 2;
    this.baseAng = ang;
    this.bossId = bossId;
    this.damage = damage;
    this.enraged = enraged;
  }

  private get scaleNow(): number {
    return lerpValue(0, 20, this.la0) * lerpValue(180, 120, this.la0);   // :45807
  }

  /** Colliding :15729-15753:三段锥形束(近似胶囊三次相交) */
  private hits(t: { x: number; y: number; w: number; h: number }): boolean {
    const dirX = Math.cos(this.rotation), dirY = Math.sin(this.rotation);
    const L = [510, 660, 800], W = [70, 42, 7];
    for (let i = 0; i < 3; i++) {
      if (segHitsRect(this.cx, this.cy,
        dirX * L[i] * this.scaleV, dirY * L[i] * this.scaleV,
        W[i] * this.scaleV, t)) return true;
    }
    return false;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    // ★通用湿段（:16903-17113）——923 豁免 id（P.cs:8770 ignoreWater=true）→ 段门
    //  恒闭零行为;插 tick 头与 AI/位移序无观察差（段内唯一可见面=溅花,豁免即恒无）
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      923, !!projectileData(923)?.ignoreWater);
    if (!this.sndPlayed) {
      this.sndPlayed = true;
      game.playSfxWav?.('Item_159', 1, this.cx, this.cy);      // :45794-45797 base.Center
    }
    this.la0++;
    if (this.la0 >= 180) { this.dead = true; return; }         // :45799-45802
    this.alpha = Math.max(0, this.alpha - 15);                 // :45803-45806
    this.scaleV = this.scaleNow;
    this.rotation = this.baseAng                               // :45808-45810
      + lerpValue(50, 180, this.la0) * (Math.PI / 9);
    // 锚本体(:45812-45816:ai[1] 反查 type==636 → Center 吸附;槽失活保持末位不灭)
    const boss = (game.enemies() as Enemy[])
      .find((n) => !n.dead && n.id === this.bossId && n.vanillaId === 636);
    if (boss) { this.x = boss.cx - this.w / 2; this.y = boss.cy - this.h / 2; }
    this.vx = 0; this.vy = 0;
    if (boss) {
      // ---- 束身光路(:45818-45826 精确式,仅本体锚存活时跑——原版该段包在
      //      Main.npc.IndexInRange(active&&type==636) 分支内):v3_ = hslToRgb
      //      ((ai[0]/2π+la0/180)%1,1,.85)·scale(每帧色相旋转的虹彩光);13 点全采样
      //      (num5=0..1 步 1/12),CastLightOpen 实心格豁免(DelegateMethods.cs:729-744:
      //      非 active∨inActive∨tileSolidTop∨非 tileSolid 才 AddLight——store.isSolid
      //      含致动排除面同构)。曾"六步+定值因子"近似退役 —— 终清波实装 ----
      const dirX = Math.cos(this.rotation), dirY = Math.sin(this.rotation);
      const hue = (this.baseAng / (Math.PI * 2) + this.la0 / 180) % 1;
      const [lr, lg, lb] = hslToRgb255(hue, 1, 0.85);
      const st = game.world?.store;
      for (let s = 0; s <= 12; s++) {
        const px = this.cx + dirX * 800 * this.scaleV * (s / 12);
        const py = this.cy + dirY * 800 * this.scaleV * (s / 12);
        const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
        // 界外格:原版 CastLightOpen 越界 return false 即无光;isSolid 对越界恒 false——
        // 显式 inBounds 门保持同语义(不外溢照亮边缘外)
        if (!st || !st.inBounds(tx, ty) || st.isSolid(tx, ty)) continue;
        game.addLightAt?.(px, py,
          (lr / 255) * this.scaleV, (lg / 255) * this.scaleV, (lb / 255) * this.scaleV);
      }
    }
    if (this.la0 > 60) {                                       // CanDamage la0<=60 免伤门(:12463)
      hitPlayer(this, game, this.damage, false, false, (p) => this.hits(p));
      hitTownNpcs(this, game, this.damage, 0, 'hostile', this.projId, (n) => this.hits(n));
      // 敌对弹对小动物零伤(Damage_PVE_Inner 受理式裁决,同 464/465 语义锚)
      hitCritters(this, game);
    }
  }

  /** DrawProj_FairyQueenSunDance 直译(Main.cs :28706-28741 四画):
   *  num24=ai[0]/2π+la0/180;num25=GTLV(0,30)×GTLV(180,150);lerpV=GTLV(40,60);
   *  原版 origin=(帧尺寸×(0.03,.5)),dest 纵向 = lerp(.25,.7)·proj.scale——
   *  曾 hue-rotate 滤镜+三层近似退役 —— 终清波实装(hslToRgb255 真值乘色)。 */
  private color5RGB(): [number, number, number] {
    return hslToRgb255(((this.baseAng / (Math.PI * 2) + this.la0 / 180) % 1), 1, 1);
  }

  /** value4/value5 的白混档:XNA Color.Lerp(color,White,0.1) 后 A/=2 */
  private enrageLerpPass(
    off: number, lumLo: number, lumHi: number, lerpV: number,
  ): [number, number, number] {
    if (this.enraged) return [255, 231, 69];          // OurFavoriteColor ×num25(A 面走 α)
    const base = hslToRgb255(
      ((this.baseAng / (Math.PI * 2) + this.la0 / 180 + off) % 1), 1,
      vLerp(lumLo, lumHi, lerpV),
    );
    return [
      base[0] + (255 - base[0]) * 0.1,                // Lerp(c, White, .1)
      base[1] + (255 - base[1]) * 0.1,
      base[2] + (255 - base[2]) * 0.1,
    ];
  }

  draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    if (this.scaleV <= 0.01) return;
    const img = projSprite(923);
    if (!img || !(img.width > 0)) return;
    const iw = img.width;
    const bandH = Math.floor(img.height / 2);         // Frame(1,2) 双帧行(:28708-28709)
    const la0 = this.la0;
    const num25 = lerpValue(0, 30, la0) * lerpValue(180, 150, la0);
    if (num25 <= 0) return;
    const lerpV = lerpValue(40, 60, la0);
    const sqY = vLerp(0.25, 0.7, lerpV);              // 纵向收敛(vector.Y·scale)
    const c5 = this.color5RGB();
    const v4 = this.enrageLerpPass(0.3, 0.3, 0.66, lerpV);
    const v5 = this.enrageLerpPass(0.15, 0.3, 0.5, lerpV);
    const t5 = tintBake('p923c5', img, 0, 0, iw, img.height, c5);
    const t4 = tintBake('p923v4', img, 0, 0, iw, img.height, v4);
    const tv5 = tintBake('p923v5', img, 0, 0, iw, img.height, v5);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.rotation);
    // dest=origin 抵消式:origin=(.03·iw, 半帧行高) → 左偏 .03·destW、上偏 .5·destH
    // ★修3（2026-10-05）原版两遍预乘习语（Main.cs:28702-28740 逐式核对）:
    //  XNA SpriteBatch 预乘管线（content 贴图预乘+AlphaBlend(One,InvSrcAlpha)）下
    //  Color 链 `×num25`/`A/=2`（:28721/:28729）= RGB 贡献 premult×C.rgb【不折 A】、
    //  dst 衰减 ×(1−texA·C.A)。旧 4×source-over 把 A 折进 ga → draw1/2/3 的 rgb
    //  贡献减半（弹幕偏暗根因之一;活机隔离画布实测对原版语义模型 mean|Δ|=18.1,
    //  旧模型自检 1.8=仪表正确）。canvas 等价两遍式 = destination-out×(A/255) 削底
    //  + lighter×(rgb 标量) 加亮（projGhostTrail cut+add 判例/drawEmpress twoPass
    //  同构）。四画角色（cut=dst 削底系数,add=rgb 加亮系数）:
    //  ① value4 行2 ×vector·1.2（:28727）——A/2 → cut=num25/2、rgb 全量 → add=num25
    //  ② value5 行2 ×vector·1.1（:28733）——同上
    //  ③ color5×0.5 行1（:28737）——XNA 标量四通道同乘 → cut=add=num25/2
    //  ④ color5×lerpV 行2（:28739）——同乘 → cut=add=num25×lerpV
    //  边界登记（既有近似延续）:Lerp(c,White,.1) 白项本仓折进 tint×ga（原版白项
    //  不随 num25 缩,±10%@num25=.5）;A 面 Lerp→White 的 +25.5 未建模（原版
    //  A=(255·num25·.9+25.5)/2 vs 本仓 num25/2,中包络 ±10%）。
    type Pass = {
      tint: HTMLCanvasElement | null; band: 0 | 1; mul: number; cutA: number; addA: number;
    };
    const passes: Pass[] = [
      { tint: t4, band: 1, mul: 1.2, cutA: num25 * 0.5, addA: num25 },          // value4 ×vector*1.2
      { tint: tv5, band: 1, mul: 1.1, cutA: num25 * 0.5, addA: num25 },         // value5 ×vector*1.1
      { tint: t5, band: 0, mul: 1, cutA: num25 * 0.5, addA: num25 * 0.5 },      // color5·0.5 行1
      { tint: t5, band: 1, mul: 1, cutA: num25 * lerpV, addA: num25 * lerpV },  // color5·lerpV 行2
    ];
    for (const p of passes) {
      if (!p.tint || p.addA <= 0) continue;
      const dw = iw * this.scaleV * p.mul;
      const dh = bandH * sqY * this.scaleV * p.mul;
      const dx = -0.03 * dw, dy = -dh / 2;
      if (p.cutA > 0.004) {                       // 削底（C.A 面;A=0 无衰减=原版同相）
        ctx.globalCompositeOperation = 'destination-out';
        ctx.globalAlpha = Math.min(1, p.cutA);
        ctx.drawImage(img, 0, p.band * bandH, iw, bandH, dx, dy, dw, dh);
      }
      ctx.globalCompositeOperation = 'lighter';   // 加亮（C.rgb 面,全量不折 A）
      ctx.globalAlpha = Math.min(1, p.addA);
      ctx.drawImage(p.tint, 0, p.band * bandH, iw, bandH, dx, dy, dw, dh);
    }
    ctx.restore();
  }
}

export function empressOfLightAI(e: Enemy, game: GameHooks, player: Player | null): void {
  if (!e.bInit) {
    e.bInit = true;
    e.ai0 = 0; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0;
    e.spawnAlpha = 254; // Opacity = ai1/180 渐显(:46410)
    game.spawnParticles(e.cx, e.cy - 80, '#FFE080', 20, 2.5);
  }
  const phase2 = e.ai3 === 1 || e.ai3 === 3; // AI_120_HallowBoss_IsInPhase2 :46179
  const dayEnrage = game.world.clock.isDay;  // flag4 = ShouldEmpressBeEnraged() = Main.dayTime（:46296）
  // flag2 = Main.expertMode（:46317）；白天暴怒 flag4 时强制置真（:46355）——
  // 全六处行为：num17+5（:46364）/选招起手环移（:46603）/case2 射速 2（:46632）/
  // case4 五枪+450 环（:46711-46731）/case6 八辐（:46859）/case7 六线 18 枪（:46888）
  const flag2 = game.world.isExpert || dayEnrage;
  // num17：二阶段 +15，flag2 再 +5（:46360-46367）——各态时长均减 num17
  const num17 = (phase2 ? 15 : 0) + (flag2 ? 5 : 0);
  const b = baseOf(e);
  // :47296-47301 二阶段防御 ×1.2;白天暴怒（flag4,:47296 段 damage=9999——wiki"白天必秒杀"）
  // ——2026-08-13 接通:白天召唤女皇不再无风险
  // :46319-46323 满血+白天且未暴怒 → ai3 += 2（白天召出即 Enraged 档 2;
  // 受过伤再转白天不补——原版"只在白天受过伤"语义）。NpcDrops 的
  // EmpressOfLightIsGenuinelyEnraged(:46169)读 ai3∈{2,3} → 夜光 5005 掉落门
  if (e.hp === e.maxHp && dayEnrage && e.ai3 !== 2 && e.ai3 !== 3) e.ai3 += 2;
  e.def.damage = dayEnrage ? 9999 : b.dmg;
  e.def.defense = Math.floor(phase2 ? b.def * 1.2 : b.def);

  // 目标失效/超 6400px → 淡出退场(:46437-46444/:46595 num36=13;此后只有 13 态不触 player)
  // flag12（:46584-46594）：真狂暴（ai3∈{2,3}）且（入夜 或 白天 Main.time≥53400——
  // 昼 54000t 的末 600t ≈ 19:20PM 后）→ 强制 13 态离场。Main.time 换算：
  // (timeOfDay − DAWN) × 86400（昼 0.625 天 ↔ 54000t）
  const genuinelyEnraged = e.ai3 === 2 || e.ai3 === 3;
  const mainTime = (game.world.clock.timeOfDay - 4.5 / 24) * 86400;
  const enragedLeave = genuinelyEnraged && (!dayEnrage || mainTime >= 53400);
  if ((!player || player.dead || Math.hypot(player.cx - e.cx, player.cy - e.cy) > 6400 || enragedLeave) && e.ai0 !== 13) {
    e.ai0 = 13; e.ai1 = 0; e.ai2 += 1;
    e.vx /= 4; e.vy /= 4;
  }
  if (player) e.facing = e.seekDirX(player);
  if (!player) {
    // 目标彻底失效:上方已强制 ai0=13,此处推进淡出自毁(:47236/:47264-47271)。
    // ★bossFled 同置——原版是静默 active=false,曾只写 dead 被 Game 记为"击败":
    // 假公告+误写 downed_636+误触 LanternNight 且零掉落(2026-08-19 终审修)
    // ★BJ385：本早退支=原版 13 态淡出相（flag6 缺省 true → :47431 置可伤）——
    // 早退跳过尾部重算,须在此补每拍缺省态（见 switch 尾 :47431 注）
    e.dontTakeDamage = false;
    e.spawnAlpha = Math.min(254, e.spawnAlpha + 5);
    e.vx *= 0.95; e.vy *= 0.95;
    e.ai1 += 1;
    flyIntegrate(e);
    if (e.ai1 >= 20 && e.spawnAlpha >= 254) { e.bossFled = true; e.dead = true; }
    return;
  }

  // 冲刺窗口伤害倍率(num16,:46352/:47006):8/9 态 40-90t 时 ×1.5
  // （白天 9999 基伤同样参与 ×1.5——原版 flag4 先把 num 全置 9999 再乘 num16;
  //  曾按 b.dmg 重算把 9999 整档覆盖掉,白天暴怒伤害从未生效）
  const dashBoost = (e.ai0 === 8 || e.ai0 === 9) && e.ai1 > 40 && e.ai1 <= 90;
  // :47294-47299 damage = def×num16 后 flag4 **直接覆写 9999**（不乘 1.5）——
  //  曾得 9999×1.5=14999（乘区序错，2026-08-18 审查勘误）
  e.def.damage = dayEnrage ? 9999 : Math.round(b.dmg * (dashBoost ? 1.5 : 1));

  // ---- 弹伤五元组 Remap(AI_120_HallowBoss NPC.cs(1458):46495-46499):
  //      num = GetAttackDamage_ForProjectiles(phase 内 normal 锚, expert 锚)
  //         = (int)Remap(difficulty, Classic(1), Expert(2), normal, expert)（NPC.cs:7079,
  //      Utils.Remap clamped 默认——大师/传奇压回 expert 档）。锚随二阶段翻转:
  //        num6 光枪墙 919 (:46909/:46940/:47260/:47291)  p1(50,30)→p2(60,35)
  //        num7 光枪回环 919 (:47122)                      p1(70,65)→p2(65,30)
  //        num8 彩虹射线/螺旋 873(:46798/:46807/:47331)     p1(45,30)→p2(50,35)
  //        num9 永恒彩虹 872 (:46982)                      p1(45,30)→p2(50,35)
  //        num10 太阳舞 923 (:47022)                       p1(50,35)→p2(60,40)
  //      flag4=白天暴怒 → 五元组整体覆写 9999（:46500-46507,后于 Remap,不参与乘区）。
  //      ★曾按经典值二元硬编码(dayEnrage?9999:phase2?a:b),专家档失配+大师被错钉
  //      经典值,C 档登记退役 —— 终清波实装。874 出生极光弹原版 damage=0(:46528),
  //      case3 的 874(num5=40) 属无表项不可达态,维持不接 ----
  const diff = e.difficulty;
  const empProjDmg = (
    nP1: number, nP2: number, eP1: number, eP2: number,
  ): number => getAttackDamageForProjectiles(
    phase2 ? nP2 : nP1, phase2 ? eP2 : eP1, diff,
  );
  const num6 = dayEnrage ? 9999 : empProjDmg(50, 60, 30, 35);   // :46332
  const num7 = dayEnrage ? 9999 : empProjDmg(70, 65, 65, 30);   // :46336
  const num8 = dayEnrage ? 9999 : empProjDmg(45, 50, 30, 35);   // :46333
  const num9 = dayEnrage ? 9999 : empProjDmg(45, 50, 30, 35);   // :46334
  const num10 = dayEnrage ? 9999 : empProjDmg(50, 60, 35, 40);  // :46335

  // ★BJ385（BJ347 登记债清偿,R23b-P1 同族反模式退场）：flag6 = 无敌相位旗
  //  （:46510 `bool flag6 = true` 缺省可伤;switch 内 0/8-9/10 三态置 false）——
  //  :47431 `dontTakeDamage = !flag6` 每拍重算=全通道真持续态。旧 iframes=2
  //  每 tick 刷新近似被 Enemy.hurt 免疫门 `pierce!==1 && iframes>0` 的单发弹
  //  （箭/枪弹/多数随从）豁免绕过,无敌相位可被单发弹磨血=反模式
  let flag6 = true;

  switch (e.ai0) {
    // ---- 0 出生(:46370-46422):velocity=(0,5) 后 0.95 阻尼,180t 渐显;全程无敌(flag6=false) ----
    case 0: {
      if (e.ai1 === 0) {
        e.vx = 0; e.vy = 5;
        // :46376 出生头顶 874 极光演出弹（0 速 0 伤）
        shoot(game, e.cx, e.cy - 80, 0, 0, 0, 874);
      }
      if (e.ai1 === 10) game.playSfxWav?.('Item_161', 1, e.cx, e.cy);   // :46381
      flag6 = false;                       // :46561 出生相位全程无敌（:46561 flag6=false）
      e.vx *= 0.95; e.vy *= 0.95;
      e.spawnAlpha = Math.max(0, 254 - Math.floor(clamp(e.ai1 / 180, 0, 1) * 254));
      e.ai1 += 1;
      if (e.ai1 >= 180) { e.ai0 = 1; e.ai1 = 0; }
      break;
    }
    // ---- 1 悬浮蓄力枢纽(:46418-46511):前 10t DashTo 冲近,之后阻尼;到时按表选招 ----
    case 1: {
      // num34 :46422(flag=二阶段 20/一阶段 45);getGoodWorld 折半(:46425-4628)
      let dur = phase2 ? 20 : 45;
      if (game.world.seedFlags?.getGoodWorld) dur /= 2;
      if (e.ai1 <= 10) empressDashTo(e, player.cx, player.cy);
      if (Math.hypot(e.vx, e.vy) > 16 && e.ai1 > 10) { e.vx /= 2; e.vy /= 2; }
      e.vx *= 0.92; e.vy *= 0.92;
      e.ai1 += 1;
      if (e.ai1 < dur) break;
      // :46520-46579 二阶段表:flag2(expert/白天暴怒)时 num51 第 3 槽插 11 → 10 拍 expert 表
      const table = phase2
        ? (flag2 ? EMPRESS_CYCLE_P2_EXPERT : EMPRESS_CYCLE_P2)
        : EMPRESS_CYCLE_P1;
      let next = table[Math.floor(e.ai2) % table.length];
      if (!phase2 && e.hp / e.maxHp <= 0.5) next = 10; // :46463 半血强制变身
      if (next === 8 && player.cx > e.cx) next = 9;     // :46493 冲刺方向
      // :46603-46606 flag2（expert/暴怒）且选招非 5/12：起手朝玩家向量旋 ±90° × 20 速
      if (flag2 && next !== 5 && next !== 12) {
        const side = (player.cx > e.cx ? 1 : -1);       // ToDirectionInt(目标在右)
        const [svx, svy] = rot(side, 0, (Math.PI / 2) * side);
        e.vx = svx * 20; e.vy = svy * 20;
      }
      e.ai0 = next; e.ai1 = 0; e.ai2 += 1;
      break;
    }
    // ---- 2 彩虹射线 873(:46613-46667):悬玩家左上(-150,-250),每 num91t 一发直飞,60t 止 ----
    case 2: {
      if (e.ai1 === 0) game.playSfxWav?.('Item_164', 1, e.cx, e.cy);   // :46617
      empressHover(e, player, -150, -250);
      const dur = 60 + (90 - num17);       // num90 = 90 - num17（:46619）
      const num91 = flag2 ? 2 : 3;          // :46631-46635 flag2 射速加密
      if (Math.floor(e.ai1) % num91 === 0 && e.ai1 < 60) {
        const [dvx, dvy] = rot(0, -6, (Math.PI / 2) * (Math.random() * 2 - 1));
        // ai3 = NPC.ai[1]/60（:46790）→ 弹 ai[1]（Kill 尘色相位,P.cs:46398;
        // ★尘站普查批 2026-09-16 补注入通道）
        shoot(game, e.cx - 55, e.cy - 30, dvx, dvy, num8, 873, 300,
          { empressHue: e.ai1 / 60 });   // num8 :46333（Remap 见上）
      }
      e.ai1 += 1;
      if (e.ai1 >= dur) { e.ai0 = 1; e.ai1 = 0; }
      break;
    }
    // ---- 4 光枪墙 919(:46691-46799):悬玩家上 (0,-350),每 4t 在玩家周围环上布枪 ----
    case 4: {
      if (e.ai1 === 0) game.playSfxWav?.('Item_162', 1, e.cx, e.cy);   // :46697
      empressHover(e, player, 0, -350);
      const dur = 100 + (20 - num17);
      // :46715 每 4t 布一杆;:46734 距玩家 >2400 跳过当拍(原版 continue,计时不断)
      if (Math.floor(e.ai1) % 4 === 0 && e.ai1 < 100 && Math.hypot(player.cx - e.cx, player.cy - e.cy) <= 2400) {
        const num82 = flag2 ? 5 : 4;       // :46710-46714 flag2 五枪
        const ringR = flag2 ? 450 : 300;   // :46728-46732 flag2 环径 450
        const num85 = Math.floor(e.ai1) / 4;
        let ux = Math.cos(Math.PI / (num82 * 2) + num85 * (Math.PI / num82));
        let uy = Math.sin(Math.PI / (num82 * 2) + num85 * (Math.PI / num82));
        if (!flag2) ux += ux > 0 ? 0.5 : -0.5; // 经典横向外扩(:46723-46726,flag2 关)
        const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
        if (player.vx * ux + player.vy * uy > 0) { ux = -ux; uy = -uy; } // 逆着玩家速度布枪(:46738)
        const leadX = player.cx + player.vx * 90, leadY = player.cy + player.vy * 90;
        let px = player.cx + ux * ringR - player.vx * 30;
        let py = player.cy + uy * ringR - player.vy * 30;
        const pd = Math.hypot(px - player.cx, py - player.cy);
        if (pd < ringR) { // 环距不足外推(:46745-46753)
          const ex = player.cx - px, ey = player.cy - py;
          const el = Math.hypot(ex, ey) || 1;
          px = player.cx - (ex / el) * ringR; py = player.cy - (ey / el) * ringR;
        }
        const ax = leadX - px, ay = leadY - py;
        const al = Math.hypot(ax, ay) || 1;
        // 原版 NewProjectile(Vector2.Zero 速度,919, ai[0]=v4.ToRotation() 出射角,
        // ai[1]=this.ai[1]/100)(:46909):AI_179 localAI[0]<60 零速预告渐显→60t 起
        // 沿锁定角 40 速发射(2026-08-31 台账批实体化;旧「Projectile.AI 收敛:12 速
        // 直飞/弹 ai1 延时参」说法系误读——ai[1] 仅作色相源,AI 不消费)
        addProj(game, new FairyQueenLance(px, py, Math.atan2(ay / al, ax / al), e.ai1 / 100,
          num6, dayEnrage));   // num6 :46332
      }
      e.ai1 += 1;
      if (e.ai1 >= dur) { e.ai0 = 1; e.ai1 = 0; }
      break;
    }
    // ---- 5 永恒彩虹 872(:46801-46841):悬玩家上,开场 13 发环形彩弹(8 速) ----
    case 5: {
      if (e.ai1 === 0) game.playSfxWav?.('Item_163', 1, e.cx, e.cy);   // :46805
      empressHover(e, player, 0, -350);
      const dur = 42 + (30 - num17);
      if (Math.floor(e.ai1) % 42 === 0 && e.ai1 < 42) {
        const base = Math.random() * Math.PI * 2;
        for (let k = 0; k < 13; k++) {
          const t = k / 13;
          const [ux, uy] = rot(0, 1, Math.PI / 2 + Math.PI * 2 * t + base);
          const [ox, oy] = rot(ux, uy, -Math.PI / 2);
          shoot(game, e.cx + 55 + ox * 30, e.cy - 30 + oy * 30, ux * 8, uy * 8,
            num9, 872, 300, { empressHue: t });   // num9 :46334;ai[1]=num65=t（:46982——AI_173_GetColor hue=(ai1+0)%1,★BJ235 残影染色同源通道）
        }
      }
      e.ai1 += 1;
      if (e.ai1 >= dur) { e.ai0 = 1; e.ai1 = 0; }
      break;
    }
    // ---- 6 太阳舞 923(:46843-46881):悬玩家上 (-80,-500) 低速,每 60t 一环,3 环 ----
    case 6: {
      empressHover(e, player, -80, -500, 0.3, 0.7);
      const dur = 180 + (120 - num17);
      const spokes = flag2 ? 8 : 6;        // num28（:46858-46862 flag2 八辐）
      if (Math.floor(e.ai1) % 60 === 0 && e.ai1 < 180) {
        const volley = Math.floor(e.ai1) / 60;
        const flip = player.cx > e.cx ? 1 : 0;
        for (let t = 0; t < 1; t += 1 / spokes) {
          const slot = (t + (1 / spokes) * 0.5 + volley * (1 / spokes) * 0.5) % 1;
          const a = Math.PI * 2 * (slot + flip);
          // 原版 NewProjectile(Vector2.Zero,923,ai[0]=扫束起始角,ai[1]=whoAmI 本体锚)
          // (:47022):AI_180 锚本体 Center 随拍旋转 +π/9·lerp(50..180),scale 三段梯度,
          // timeLeft=180(SetDefaults :8766——曾误传 ttl 240);首帧音 Item159 移入
          // SunDanceBeam 弹位播(C 光音位置化,2026-08-31)
          addProj(game, new SunDanceBeam(e.cx, e.cy - 100, a, e.id,
            num10, dayEnrage));   // num10 :46335（Remap 见上）
        }
      }
      e.ai1 += 1;
      if (e.ai1 >= dur) { e.ai0 = 1; e.ai1 = 0; }
      break;
    }
    // ---- 7 光枪回环 919(二阶段,:46883-46982):每 num71t 以玩家为中心布 num74 连枪线 ----
    case 7: {
      empressHover(e, player, 0, -350, 0.4, 1);
      // :46885-46894 flag2：间隔 40t、6 线、18 枪/线、跨距 ×0.5；经典：60t、4 线、13 枪
      const num71 = flag2 ? 40 : 60;
      const num72 = num71 * (flag2 ? 6 : 4);
      const num70 = (flag2 ? 40 : 20) - num17;
      const dur = num72 + num70;
      if (Math.floor(e.ai1) % num71 === 0 && e.ai1 < num72) {
        game.playSfxWav?.('Item_162', 1, e.cx, e.cy);   // :46903 每线发射（曾误 Item_160）
        const line = Math.floor(e.ai1) / num71;
        let cx0 = player.cx, cy0 = player.cy;
        let dirX = 0, dirY = 0, axX = 0, axY = 0, toPlayer = false;
        const num74 = flag2 ? 18 : 13;   // 枪数/线
        const num75 = flag2 ? 200 : 150; // 枪距
        const span = num74 * num75 * (flag2 ? 0.5 : 1);   // num76 :46908/:46922
        switch (line) { // :46924-46956 线几何（4/5 线仅 flag2 可达,朝玩家会聚）
          case 0: cx0 += -span / 2; dirX = 0; dirY = span; axX = 1; axY = 0; break;
          case 1: cx0 += span / 2; cy0 += num75 / 2; dirX = 0; dirY = span; axX = -1; axY = 0; break;
          case 2: cx0 += -span * 0.4; cy0 += -span * 0.4; dirX = span * 1.4; dirY = 0; axX = 1; axY = 1; break;
          case 3: cx0 += span * 0.4 + num75 / 2; cy0 += -span * 0.4; dirX = -span * 1.4; dirY = 0; axX = -1; axY = 1; break;
          default:
            // :46946-46955 第 4/5 线（flag2 专属）：偏移 ±(span·0.4, span·0.4)（第 5 线 X 再 +num75/2）
            toPlayer = true;
            if (line === 4) { cx0 += -span * 0.4; cy0 += span * 0.4; dirX = span * 1.4; }
            else { cx0 += span * 0.4 + num75 / 2; cy0 += span * 0.4; dirX = -span * 1.4; }
            dirY = 0;
            break;
        }
        const al = Math.hypot(axX, axY) || 1;
        for (let t = 0; t <= 1.0001; t += 1 / num74) {
          const ox = cx0 + dirX * (t - 0.5), oy = cy0 + dirY * (t - 0.5);
          let vx = (axX / al) * 12, vy = (axY / al) * 12;
          if (flag2 && toPlayer) {
            // :46961-46966 flag2 第 4/5 线：枪向 = 基向向"玩家预测位"Lerp 0.75
            const tx = player.cx + player.vx * 20 * t - ox, ty = player.cy - oy;
            const tl = Math.hypot(tx, ty) || 1;
            const lx = vLerp(1, tx / tl, 0.75), ly = vLerp(0, ty / tl, 0.75);
            const ll = Math.hypot(lx, ly) || 1;
            vx = (lx / ll) * 12; vy = (ly / ll) * 12;
          }
          // 原版 NewProjectile(Vector2.Zero,919,ai[0]=v3.ToRotation() 锁定角,
          // ai[1]=num80 线上分位)(:47122)——AI_179 60t 预告→40 速发射(实体化 FairyQueenLance)
          addProj(game, new FairyQueenLance(ox, oy, Math.atan2(vy, vx), t,
            num7, dayEnrage));   // num7 :46336
        }
      }
      e.ai1 += 1;
      if (e.ai1 >= dur) { e.ai0 = 1; e.ai1 = 0; }
      break;
    }
    // ---- 8/9 刀阵冲刺(:46984-47027):0-40t 冲到玩家侧后 550px(6-40t 无敌),
    //      40-90t 以 ±50 横速突进(伤害 ×1.5),其后 0.92 阻尼 ----
    case 8:
    case 9: {
      const side = e.ai0 === 8 ? -1 : 1; // num33 :46991
      if (e.ai1 === 20) game.playSfxWav?.('Item_160', 1, e.cx, e.cy);   // :46997
      if (e.ai1 <= 40) {
        if (e.ai1 >= 6) flag6 = false; // :47142 flag6=false（6..40t 无敌窗）→ :47431 dontTakeDamage
        const destX = player.cx + side * -550, destY = player.cy;
        const dx = destX - e.cx, dy = destY - e.cy;
        const d = Math.hypot(dx, dy) || 1;
        simpleFly(e, (dx / d) * 12, (dy / d) * 12, 1.0);
        if (e.ai1 === 40) { e.vx *= 0.3; e.vy *= 0.3; }
      } else if (e.ai1 <= 90) {
        // :46959-46962 Lerp(velocity, (±50,0)) 5%/t——从当前速向 ±50/0 渐进
        // (40t 爬坡;曾实参颠倒=一帧跳到 95% 目标速,终审修)
        e.vx = vLerp(e.vx, side * 50, 0.05);
        e.vy = vLerp(e.vy, 0, 0.05);
        if (e.ai1 === 90) { e.vx *= 0.7; e.vy *= 0.7; }
      } else {
        e.vx *= 0.92; e.vy *= 0.92;
      }
      e.ai1 += 1;
      if (e.ai1 >= 90 + (20 - num17)) { e.ai0 = 1; e.ai1 = 0; }
      break;
    }
    // ---- 10 半血变身(:47106-47135):90t 时传送玩家上 250 处并 ai3 0→1(进入二阶段) ----
    case 10: {
      if (e.ai1 >= 30 && e.ai1 <= 170) flag6 = false; // :47188 flag6=false（30..170t 无敌窗）
      if (e.ai1 === 0) game.playSfxFiles?.(['Item_161'], 1, e.cx, e.cy); // :47036 状态开始音（仅此一次）
      e.vx *= 0.95; e.vy *= 0.95;
      if (e.ai1 === 90) {
        if (e.ai3 === 0) e.ai3 = 1; // :47040-47043
        if (e.ai3 === 2) e.ai3 = 3; // :47044-47047 白天暴怒档同步进二阶段(3=暴怒+二阶段)
        e.x = player.cx - e.w / 2;
        e.y = player.cy - 250 - e.h / 2;
        // 原版此传送为纯 position 改写（:47039-47052）：无 dust 无传送音——
        // 曾错加 roar+黄尘（已移除对齐）
      }
      e.ai1 += 1;
      if (e.ai1 >= 180 + (20 - num17)) { e.ai0 = 1; e.ai1 = 0; e.ai2 = 0; }
      break;
    }
    // ---- 11 预测光枪墙 919(:47061-47151,expert 二阶段表第 3 槽专属拍):悬玩家上
    //      (0,-350),每 3t 在玩家速度反向 100px 处布一杆 919,瞄玩家 90t 预测位 ----
    case 11: {
      if (e.ai1 === 0) game.playSfxWav?.('Item_162', 1, e.cx, e.cy);   // :47065
      const dur = 100 + (20 - num17);                                  // num58 = 20 - num17（:47067/:47144）
      empressHover(e, player, 0, -350);                                // :47074-47079（vector3=(0,-350)/num3=40/num2=12/num=0.5）
      // :47080 每 3t 一杆(num59=1)、<100t;:47089 NPC 距玩家 >2400 跳过当拍(continue,计时不断)
      if (Math.floor(e.ai1) % 3 === 0 && e.ai1 < 100
        && Math.hypot(player.cx - e.cx, player.cy - e.cy) <= 2400) {
        // v = -玩家速度单位向量,零速兜底 (0,-1)（:47085-47086 SafeNormalize(-UnitY)）
        let ux = -player.vx, uy = -player.vy;
        const ul = Math.hypot(ux, uy);
        if (ul > 0) { ux /= ul; uy /= ul; } else { ux = 0; uy = -1; }
        // vector13 = 玩家 90t 预测位(num61=90,:47093-47094);vector14 = 玩家速度反向
        // 100px 布枪点(num60=100,:47095)
        const leadX = player.cx + player.vx * 90, leadY = player.cy + player.vy * 90;
        let px = player.cx + ux * 100, py = player.cy + uy * 100;
        // :47096-47104 布枪点距玩家 <100 时外推(v 已单位,防御性死代码 1:1)
        if (Math.hypot(px - player.cx, py - player.cy) < 100) {
          let ex = player.cx - px, ey = player.cy - py;
          const el = Math.hypot(ex, ey);
          if (el === 0) { ex = ux; ey = uy; } else { ex /= el; ey /= el; }
          px = player.cx - ex * 100; py = player.cy - ey * 100;
        }
        // v2 = 预测位 − 布枪点 → ai[0] 出射角（:47105-47108;实体化 FairyQueenLance——
        // AI_179 60t 零速预告→40 速发射,弹体侧 ai1 参仅色相源）;Boss_CanShootExtraAt
        // 多人补射(:47114-47140)恒跳主目标(:47324),单人无效,略
        const ax = leadX - px, ay = leadY - py;
        const al = Math.hypot(ax, ay) || 1;
        addProj(game, new FairyQueenLance(px, py, Math.atan2(ay / al, ax / al), e.ai1 / 100,
          num6, dayEnrage));   // num6 :46332（case11 预测光枪墙）
      }
      e.ai1 += 1;
      if (e.ai1 >= dur) { e.ai0 = 1; e.ai1 = 0; }
      break;
    }
    // ---- 12 螺旋射线 873(:47152-47200,二阶段表尾拍,经典可达——num57→12 无专家门,
    //      11 才是 expert 专属):起手 (0,-12) 上冲 + 0.95 阻尼;[10,60) 窗口内每 num22t
    //      一发 873（速向 = (0,-20) 旋 2π·进度,弹 ai[1]=num23 螺旋相位） ----
    case 12: {
      if (e.ai1 === 0) {
        game.playSfxWav?.('Item_165', 1, e.cx, e.cy);   // :47158
        e.vx = 0; e.vy = -12;                            // :47159
      }
      e.vx *= 0.95; e.vy *= 0.95;                        // :47161
      const dur = 60 + (90 - num17);                     // num21 = 90 - num17
      const num22 = flag2 ? 4 : 6;                       // :47167-47171 flag2 射速加密
      const flag11 = e.ai1 < 60 && e.ai1 >= 10;          // :47162
      const num23 = (e.ai1 - 10) / 50;                   // 螺旋相位
      if (Math.floor(e.ai1) % num22 === 0 && flag11) {
        const [svx, svy] = rot(0, -20, Math.PI * 2 * num23);   // :47176
        shoot(game, e.cx - 55, e.cy - 30, svx, svy,
          num8, 873);     // num8（:47179，Remap 见上）
      }
      e.ai1 += 1;
      if (e.ai1 >= dur) { e.ai0 = 1; e.ai1 = 0; }
      break;
    }
    // ---- 13 淡出退场(:47202-47276):alpha ±5 双向——flag7（狂暴末班/目标失效/超距）
    //      为真 +5 渐隐,回假 -5 复显;ai1≥20 且到达端点才结算:全隐 → 移除,
    //      全显 → 回 1 态续战（可回归,曾单向只出不回） ----
    case 13: {
      if (e.ai1 === 0) {
        game.playSfxWav?.('Item_165', 1, e.cx, e.cy);   // :47207
        e.vx = 0; e.vy = -7;                            // :47208
      }
      e.vx *= 0.95; e.vy *= 0.95;                        // :47210
      // flag7（:47216-47235）：真狂暴末班（入夜或白天 time≥53400）或目标失效/超 6400
      const flag7 = enragedLeave
        || !player || player.dead || Math.hypot(player.cx - e.cx, player.cy - e.cy) > 6400;
      e.spawnAlpha = clamp(e.spawnAlpha + (flag7 ? 5 : -5), 0, 254);
      e.ai1 += 1;
      if (e.ai1 >= 20 && (e.spawnAlpha <= 0 || e.spawnAlpha >= 254)) {
        // :47264-47271 全隐 → active=false(静默,非击杀——bossFled 同置,终审修)
        if (e.spawnAlpha >= 254) { e.bossFled = true; e.dead = true; return; }
        e.ai0 = 1; e.ai1 = 0;                            // :47273-47275 全显 → 回战斗
      }
      break;
    }
    default:
      e.ai0 = 1; e.ai1 = 0;
      break;
  }
  // ★BJ385 :47431 `dontTakeDamage = !flag6`——每拍重算真持续态（SetDefaults
  //  :17234 亦静态置 true,fromVanilla 手补表同源;AI 首拍起由本式接管）。
  //  旧 iframes=2 每 tick 刷新近似退役（见 switch 前 flag6 声明注）
  e.dontTakeDamage = !flag6;
  // :47292 alpha 渐隐回落(0/13 态各自管控 spawnAlpha,不参与)
  if (e.ai0 !== 0 && e.ai0 !== 13) e.spawnAlpha = Math.max(0, e.spawnAlpha - 5);
  flyIntegrate(e);

  // 点光(:47298-47302 AI_120 尾段)：白光 × Opacity（=1−alpha/255；本仓
  // spawnAlpha 254=全隐 → 0=全显，故 Opacity≈1−spawnAlpha/254）
  const o = 1 - e.spawnAlpha / 254;
  e.lightRGB = [o, o, o];
}

// ===================== AI_121 史莱姆皇后 657(NPC.cs:45543-46177) =====================
// 状态机(ai0): 0 待机(一阶段地面/二阶段 FlyMovement) / 1 传送后显形 / 2 传送消散 /
//   3 走路连跳(-8,-8,-6,-13 四连) / 4 升空砸地(ai2=0 升空 60t → ai2=1 重力坠,落地撒 922) /
//   5 凝胶环(ai2=0 蓄 50t → ai2=1 撒 926 环)。
// 半血(flag2)进二阶段:悬浮 FlyMovement + 攻速变化 + 暴怒(离开神圣之地)分支按任务跳过。
// 经典数值(:45546-45552): 砸地 922 40 伤 / 凝胶环 926 30 伤;砸地蓄力 30t(二阶段 10t);
//   凝胶环 6 发(二阶段 10 发);仆从按掉血 2%(二阶段 1.5%)撒 1-2 只 NPC 658/659/660。
const QUEEN_MINION_VANILLA = [658, 659, 660]; // vanilla :46134-46146 蓝/粉/紫仆从
// 数据核对(1.4.5.6):658/659/660 已在 public/sprites/vanilla-npcs.json,与 SetDefaults
//   :17261-17284 逐字段一致(658/659 QueenSlimeMinion 24×18 aiStyle1 伤40 防35 血150;
//   660 QueenSlimeMinionPurple 40×30 aiStyle14 伤50 防30 血120),贴图 NPC_658/659/660.png
//   亦在 sprites/vanilla —— 真身直连,aiStyle 1/14 均已接线。
// FALLBACK 仅作数据文件缺失时的防御(535 刺史莱姆/537 沙史莱姆/16 蓝史莱姆)。
const QUEEN_MINION_FALLBACK = [535, 537, 16];

/** TileID.Sets.Platforms（:43378 第二析取项）——平台四件套 sheet id（本仓 isPlatform
 *  还含可站家具（工作台/铁砧等不在 Sets.Platforms）,故按 sheet 精确过滤） */
const PLATFORM_SHEETS = new Set([19, 239, 380, 427]);
function isPlatformSheetTile(game: GameHooks, x: number, y: number): boolean {
  const st = game.world.store;
  const d = TILE_DEFS[st.type[st.idx(x, y)]];
  return !!d?.platform && PLATFORM_SHEETS.has(d.vanilla?.sheet ?? -1);
}

/** AddKingSlimeTeleportCacheTiles（NPC.cs:43371-43389）逐格验证：
 *  nactive 且（tileSolid && !tileSolidTop 或 Sets.Platforms）且上一格非实心
 *  （1 格净空,非 7 格）,落位 (x*16+8, y*16−height/2) 无岩浆且到玩家 CanHitLine。 */
function kingSlimeCacheTileOk(
  game: GameHooks, player: Player, e: Enemy, x: number, y: number,
): boolean {
  const st = game.world.store;
  if (!st.inBounds(x, y) || !st.isActive(x, y)) return false;
  const ground = (st.isSolid(x, y) && !st.isPlatform(x, y)) || isPlatformSheetTile(game, x, y);
  if (!ground) return false;
  if (!st.inBounds(x, y - 1) || st.isSolid(x, y - 1)) return false;   // 1 格净空（:43378）
  const li = st.idx(x, y);
  if (st.liquid[li] > 0 && st.liquidType[li] === 2) return false;     // tile.lava()
  const landX = x * TILE + 8, landY = y * TILE - e.h / 2;             // :43380 落位中心
  return losClear(game, landX, landY, player.cx, player.cy);          // :43381
}

/** BuildKingSlimeTeleportCache（:43392-43400）：外环四条带扫描（外距 outer,
 *  内距 inner 的环带）。返回全部合格格。 */
function buildKingSlimeCache(
  game: GameHooks, player: Player, e: Enemy, tx: number, ty: number, outer: number, inner: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const bands: Array<[number, number, number, number]> = [
    [tx - outer, tx - inner, ty - outer, ty + outer],
    [tx + inner, tx + outer, ty - outer, ty + outer],
    [tx - inner, tx + inner, ty - outer, ty - inner],
    [tx - inner, tx + inner, ty + inner, ty + outer],
  ];
  for (const [x0, x1, y0, y1] of bands) {
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        if (kingSlimeCacheTileOk(game, player, e, x, y)) out.push([x, y]);
      }
    }
  }
  return out;
}

/** AI_015_KingSlime_FindTeleportSpot（NPC.cs:43402-43434）1:1：
 *  anti → 玩家脚下（返回 false——调用方仍进传送态但蓄能清零,落点已写入）;
 *  环带 (10,7) 找随机格 → (x*16+8, y*16) Bottom 锚;
 *  空则缩环 (6,2) 重试;再空 → 最近玩家脚下兜底（返回 false）。 */
function queenTeleportSpot(game: GameHooks, player: Player, e: Enemy, anti: boolean): { x: number; y: number; found: boolean } {
  if (anti) return { x: player.x + player.w / 2, y: player.y + player.h, found: false }; // :43404-43409
  const ptx = Math.floor(player.cx / TILE), pty = Math.floor(player.cy / TILE);
  for (const [outer, inner] of [[10, 7], [6, 2]] as const) {   // :43412/:43421 双档环带
    const cands = buildKingSlimeCache(game, player, e, ptx, pty, outer, inner);
    if (cands.length > 0) {
      const [x, y] = cands[Math.floor(Math.random() * cands.length)];
      return { x: x * TILE + TILE / 2, y: y * TILE, found: true };   // :43417-43418
    }
  }
  return { x: player.x + player.w / 2, y: player.y + player.h, found: false }; // :43430-43433
}

/** AI_121_QueenSlime_FlyMovement(:45467-45542):12 速/0.085 加速度趋近玩家上方 250,
 *  反向且 >100px 时加速度 ×2;旋转 = vx*0.1 钳 ±0.5 */
function queenFlyMovement(e: Enemy, game: GameHooks, player: Player): void {
  e.onGround = false;
  const spd = 12, accBase = 0.085, hover = 250;
  let tx = player.cx, ty = player.cy - hover;
  if (losClear(game, e.cx, e.cy, player.cx, player.cy)) {
    tx = player.cx; ty = player.cy - hover;
  } else {
    // :45478-45496 无视线 → 逐级上探玩家上方第一个实心格下方(简化:玩家上方 16px 一档,探 16 档)
    const st = game.world.store;
    let found = false;
    for (let i = 0; i < 16; i++) {
      const py = player.cy - 16 * i;
      const ptx = Math.floor(player.cx / TILE), pty = Math.floor(py / TILE);
      if (st.inBounds(ptx, pty) && st.isSolid(ptx, pty)) {
        tx = player.cx; ty = py + 16;
        found = true;
        break;
      }
    }
    if (!found) { tx = player.cx; ty = player.cy; }
  }
  let dvx = tx - e.cx, dvy = ty - e.cy;
  const dist = Math.hypot(dvx, dvy);
  let acc = accBase;
  if (Math.abs(dvx) < 40) dvx = e.vx;                       // :45512-45514
  const lim = spd - 2;
  if (dist > 100 && ((e.vx < -lim && dvx > 0) || (e.vx > lim && dvx < 0))) acc *= 2; // :45516-45519
  if (dist < 40) { dvx = e.vx; dvy = e.vy; }                // :45521-45522
  else if (dist < 80) { dvx = (dvx / (dist || 1)) * spd * 0.65; dvy = (dvy / (dist || 1)) * spd * 0.65; }
  else { dvx = (dvx / (dist || 1)) * spd; dvy = (dvy / (dist || 1)) * spd; }
  simpleFly(e, dvx, dvy, acc);
  e.spin = clamp(e.vx * 0.1, -0.5, 0.5); // :45536-45541
}

export function queenSlimeAI(e: Enemy, game: GameHooks, player: Player | null): void {
  const la = laOf(e);
  if (!e.bInit) {
    // :45559-45566 localAI[0]==0:ai[1]=-100,localAI[0]=lifeMax
    e.bInit = true;
    e.ai0 = 0; e.ai1 = -100; e.ai2 = 0; e.ai3 = 0;
    la.la0 = e.maxHp;
  }
  // ★BJ385（BJ347 登记债清偿）：flag 缺省 false（:45701 `bool flag = false`）——
  //  :46240 `dontTakeDamage = (hide = flag)` 每拍重算 ⇒ 头置缺省可伤态（含下方
  //  despawn 早退支;657 SetDefaults :17342-17358 无 dontTakeDamage 行,无手补表项）
  e.dontTakeDamage = false;
  // 存活期环境音（NPC.cs:46255-46258 AI_121 头段,任何状态每 tick 掷）：
  // Next(360)==0 → PlaySound(65) = LSP.cs:1389-1408 case65 → Zombie_115/116/117
  // 均匀、Volume=num2×0.5 无 Pitch——×0.5 已在 Sfx.FILE_CASE_VOL 单点登记,
  // 此处传 vol=1（传 0.5 会与自动档叠乘成 ×0.25）。原版"三槽任一在播即静默"
  // 的独占忙检省略——WebAudio 短音叠加无碍（简化登记）。
  if (Math.floor(Math.random() * 360) === 0) {
    game.playSfxWav?.(`Zombie_${115 + Math.floor(Math.random() * 3)}`, 1, e.cx, e.cy);
  }
  const phase2 = e.hp <= e.maxHp / 2; // flag2 :45552
  // 点光(:45557-45558 AI_121 头段,恒亮无门)：Center (1,0.7,0.9) 粉光
  e.lightRGB = [1, 0.7, 0.9];
  // 掉血阈值撒仆从(:46147-46177):localAI[0] 记上次标记血量,差值超 2%(二阶段 1.5%)即撒
  if (la.la0 >= e.maxHp / 2 && e.hp < e.maxHp / 2) {
    la.la0 = e.hp;            // :46142-46148 进二阶段复位状态
    e.ai0 = 0; e.ai1 = 0; e.ai2 = 0;
  }
  const b = baseOf(e);
  e.def.damage = b.dmg;
  e.def.defense = b.def;
  // 玩家死/超 500 格 → 鼓励离场(EncourageDespawn:45576;简化为远距上浮,不清除)
  if (!player || player.dead || Math.abs(e.cx - player.cx) / 16 > 500) {
    e.encourageDespawn(10); // :45574 二次判定后仍失败 → EncourageDespawn(10)
    if (player) e.facing = player.cx < e.cx ? 1 : -1; // 背对玩家（:45576-45582）
    e.vy -= 0.06;
    e.y += e.vy; e.x += e.vx;
    e.spin = clamp(e.vx * 0.1, -0.5, 0.5);
    return;
  }
  const dirToPlayer = player.cx >= e.cx ? 1 : -1;
  e.facing = dirToPlayer;

  // 传送蓄能(ai3,一阶段专属 :45576-45618):无视线或高差 >320 时 +1.5/t,否则 -1/t;
  // 满 300 且落地待机 → **无条件**先置 ai0=2（:45578——搜索失败也照传送,
  // 落点兜底=最近玩家脚下）;FindTeleportSpot 失败仅清 ai3 重攒（:45596-45599）。
  // 反挂机(蓄满 360 或距玩家 >2000)→ anti 直落玩家脚下(:45587-45595)。
  if (!phase2) {
    const blocked = !losClear(game, e.cx, e.cy, player.cx, player.cy) || Math.abs(e.y - (player.y + player.h)) > 320;
    if (blocked) e.ai3 += 1.5;
    else e.ai3 = Math.max(0, e.ai3 - 1);
    if (e.ai3 >= 300 && e.ai0 === 0 && e.vy === 0) {
      e.ai0 = 2; e.ai1 = 0;                            // :45578 先进传送态（无门）
      const anti = e.ai3 >= 360 || Math.hypot(player.cx - e.cx, player.cy - e.cy) > 2000; // :45588
      if (e.ai3 >= 360) e.ai3 = 360;                   // :45590-45593
      const spot = queenTeleportSpot(game, player, e, anti);
      la.la1 = spot.x; la.la2 = spot.y;
      if (!spot.found) e.ai3 = 0;                      // :45596-45599 失败 → 蓄能清零（传送照走）
    }
  }

  // 帧驱动 localAI[3]（:45789-45802，本批补缺）：二阶段每 t +1 循环 24——翅膀
  // （Extra_185 4 帧 = lai3/6）与水晶核绘制层消费；砸地坠相(ai0=4,ai2=1)钉 6、
  // 凝胶环蓄相(ai0=5,ai2≠1)钉 7（钉值在 ++ 之后覆写,与原版同序）。此前缺失 =
  // 二阶段翅膀帧恒 0、水晶核 Y 偏移表虽按帧号走但翅拍不动。
  if (phase2) {
    e.lai3 = (e.lai3 + 1) % 24;
    if (e.ai0 === 4 && e.ai2 === 1) e.lai3 = 6;
    if (e.ai0 === 5 && e.ai2 !== 1) e.lai3 = 7;
  }

  // noGravity/noTileCollide 置位(:45634-45635 默认关;case 4/5 与二阶段飞行开启)——
  // 原版 case 4 整段(含 ai2=0 升空)置 noGravity,故一阶段升空同样免重力
  const flying = e.ai0 === 5 || (e.ai0 === 4 && e.ai2 === 0) || (phase2 && e.ai0 === 0);
  if (!flying) {
    // 通用重力(NPC.cs:91519-91524,!noGravity 时 +0.3 钳 maxFallSpeed 10;
    // 俯冲段(:45945)自身 +1 钳 14 与此叠加,实际仍受 10 上限——与原版一致)
    if (!e.onGround) e.vy += 0.3;
    if (e.vy > 10) e.vy = 10;
  } else {
    e.onGround = false;
  }

  switch (e.ai0) {
    // ---- 0 待机(:45628-45686):地面摩擦 / 二阶段飞行;ai1 过阈值(60/120)选下一招 ----
    case 0: {
      if (phase2) {
        queenFlyMovement(e, game, player);
      } else if (e.onGround) {
        e.vx *= 0.8;
        if (Math.abs(e.vx) < 0.1) e.vx = 0;
        e.spin = 0;
      }
      // :45673 一阶段空中(!flag2 && velocity.Y!=0)不计数,落地后才推进选拍
      if (!phase2 && !e.onGround && e.vy !== 0) break;
      e.ai1 += 1;
      const idle = phase2 ? 120 : 60; // num10 :45648-45652
      if (e.ai1 > idle) {
        e.ai1 = 0;
        if (phase2) {
          // :45660-45678 二阶段:默认砸地(ai2=1),玩家在上方或横距 >250 改凝胶环
          let next = Math.random() < 0.5 ? 4 : 5;
          let sub = next === 4 ? 1 : 0;
          if (next === 4 && (player.y + player.h < e.y + e.h || Math.abs(player.cx - e.cx) > 250)) {
            next = 5; sub = 0;
          }
          e.ai0 = next; e.ai2 = sub;
        } else {
          // :45680-45686 一阶段:随机 跳(3)/砸地(4)/凝胶环(5)
          const r = Math.floor(Math.random() * 3);
          e.ai0 = r === 0 ? 3 : r === 1 ? 4 : 5;
          e.ai2 = 0;
        }
      }
      break;
    }
    // ---- 1 传送后显形(:45689-45720):30t;缩放动画(num3)为纯视觉,跳过 ----
    case 1: {
      e.spin = 0;
      // 到达每帧 10 尘 4（:45747-45754）：GetDustColor=粉蓝 lerp（近似两色抽样）
      game.spawnParticles(e.cx, e.cy, Math.random() < 0.5 ? '#50A0FF' : '#E060E0', 10, 2.4, { life: 30 });
      e.ai1 += 1;
      if (e.ai1 >= 30) { e.ai0 = 0; e.ai1 = 0; }
      break;
    }
    // ---- 2 传送消散(:45721-45758):60t 后落位到 la1/la2(底部对齐) ----
    case 2: {
      e.spin = 0;
      // 离场每帧 10 尘 4 ×0.5（:45780-45787）
      game.spawnParticles(e.cx, e.cy, Math.random() < 0.5 ? '#50A0FF' : '#E060E0', 10, 1.2, { life: 30 });
      e.ai1 += 1;
      // ★BJ385：:45916 `if (ai[1] >= 60) flag = true`（不门落点搜索成功与否,逐字）
      //  → :46240 dontTakeDamage=(hide=flag)。单人传送当拍 ai0→1 ⇒ 次拍头置复位
      //  =原版一拍无敌窗同相。真持续态全通道闸,替换旧 iframes=2 每 tick 刷新
      //  近似（Enemy.hurt 免疫门 pierce===1 单发弹豁免绕过,R23b-P1 同族反模式）
      if (e.ai1 >= 60) e.dontTakeDamage = true;
      if (e.ai1 >= 60 && la.la1 !== 0) {
        e.x = la.la1 - e.w / 2;
        e.y = (la.la2 as number) - e.h;
        e.vx = 0; e.vy = 0;
        e.ai0 = 1; e.ai1 = 0;
        game.spawnParticles(e.cx, e.cy, '#7040A0', 16, 2.4);
      } else if (e.ai1 > 90) {
        e.ai0 = 1; e.ai1 = 0; // 找不到落点的兜底
      }
      break;
    }
    // ---- 3 走路连跳(:45759-45844):四连跳 vy=-8/-8/-6/-13,横速递增 4/4.5/4/3.5;
    //      落地重跳倒计时 ai1(血量 <66%/<33% 各 +4/t 加速) ----
    case 3: {
      e.spin = 0;
      if (e.onGround) {
        e.vx *= 0.8;
        if (Math.abs(e.vx) < 0.1) e.vx = 0;
        e.ai1 += 4;
        if (e.hp < e.maxHp * 0.66) e.ai1 += 4;
        if (e.hp < e.maxHp * 0.33) e.ai1 += 4;
        if (e.ai1 >= 0) {
          if (e.ai2 === 3) {
            e.vy = -13; e.vx += 3.5 * dirToPlayer;
            e.ai1 = 0; e.ai2 = 0;
            e.ai0 = 0; // 大跳结束回待机
            game.spawnParticles(e.cx, e.y + e.h, '#8060C0', 10, 2.2);
          } else if (e.ai2 === 2) {
            e.vy = -6; e.vx += 4.5 * dirToPlayer;
            e.ai1 = -40; e.ai2 += 1;
          } else {
            e.vy = -8; e.vx += 4 * dirToPlayer;
            e.ai1 = -40; e.ai2 += 1;
          }
          e.onGround = false;
        }
      } else {
        // 空中横移(:45819-45844):朝玩家 0.2/t,上限 3(FTW 7,:45853-45857;
        // 反向时 0.93 阻尼)
        const cap = game.world.seedFlags?.getGoodWorld ? 7 : 3;
        if ((dirToPlayer === 1 && e.vx < cap) || (dirToPlayer === -1 && e.vx > -cap)) {
          if ((dirToPlayer === -1 && e.vx < 0.1) || (dirToPlayer === 1 && e.vx > -0.1)) {
            e.vx += 0.2 * dirToPlayer;
          } else {
            e.vx *= 0.93;
          }
        }
      }
      break;
    }
    // ---- 4 升空砸地(:45845-46006):ai2=0 飞向玩家上 384(60t) → ai2=1 重力坠(蓄力 30/10t,
    //      FTW 0=无蓄力直接坠,:45885-45889;vy+1/t 钳 14,FTW 双倍加速钳 15.99,
    //      :45944-45953);落地撒 922 冲击波(40 伤)+ 尘暴,回待机 ----
    case 4: {
      e.spin *= 0.9;
      if (e.ai2 === 1) {
        const num13 = game.world.seedFlags?.getGoodWorld ? 0 : phase2 ? 10 : 30; // :45856-45860
        e.vx *= 0.8;
        if (!e.onGround) {
          // (首帧越过 num13 的原版蓄冲吼经对账证伪删除——:45856-45960 零 PlaySound)
          e.ai1 += 1;
          if (e.ai1 >= num13) {
            e.vy += 1;
            // FTW(:45947-45952):额外 +1/t、钳 15.99
            if (game.world.seedFlags?.getGoodWorld) {
              e.vy += 1;
              if (e.vy === 0) e.vy = 0.01;
              if (e.vy >= 15.99) e.vy = 15.99;
            } else {
              if (e.vy === 0) e.vy = 0.01;
              if (e.vy >= 14) e.vy = 14; // num17 = 14(经典)
            }
          } else {
            e.vy *= 0.8;
          }
          if (phase2 && e.ai1 > num13 + 120) { // 二阶段超时兜底(:45931-45938)
            e.ai0 = 0; e.ai1 = 0; e.ai2 = 0; e.vy *= 0.8;
          }
        } else {
          // 落地冲击(:45870-45890):922 冲击波 + 尘暴 + 回待机
          shoot(game, e.cx, e.y + e.h, 0, 0, 40, 922, 240);
          game.spawnParticles(e.cx, e.y + e.h, '#B090E0', 20, 3);
          game.playSfxWav?.('Item_167', 1, e.cx, e.cy);   // :45902 落地冲击(曾借 roar 0.7)
          e.ai0 = 0; e.ai1 = 0; e.ai2 = 0;
        }
      } else {
        // ai2=0 升空(:45967-46005):前 30t 原地蓄势(:45972-45974),之后 20 速冲向
        // 玩家上方 384(超 500 格用自身),满 60t 转 ai2=1 俯冲
        e.ai1 += 1;
        if (e.ai1 >= 30) {
          let tx = e.cx, ty = e.cy - 384;
          if (Math.abs(e.cx - player.cx) / 16 <= 500) { tx = player.cx; ty = player.cy - 384; }
          const dx = tx - e.cx, dy = ty - e.cy;
          const d = Math.hypot(dx, dy);
          if (Math.abs(e.vy) < 0.5) { // 原版判 velocity.Y == 0;浮点残留放宽半格
            const l = d || 1;
            e.vx = (dx / l) * 20; e.vy = (dy / l) * 20;
          } else {
            e.vy *= 0.95;
          }
          if (e.ai1 >= 60) {
            e.ai1 = 0; e.ai2 = 1;
            e.vy = -3; // :45982-45985（仅 vy=-3,无 vx 衰减——曾多乘 ×0.5）
          }
        }
      }
      break;
    }
    // ---- 5 凝胶环(:46007-46121):ai2=0 蓄 50t(二阶段兼飞)→ ai2=1 第 10t 撒 926 环
    //      (num6=10(FTW 15,:46026-46029)分度,num7 = 二阶段 num6 / 一阶段 6 发,
    //      30 伤,9 速,-i*2π/num6) ----
    case 5: {
      e.spin *= 0.9;
      if (e.ai2 === 1) {
        e.ai1 += 1;
        if (e.ai1 >= 10) {
          const num6 = game.world.seedFlags?.getGoodWorld ? 15 : 10;
          const count = phase2 ? num6 : 6;
          for (let i = 0; i < count; i++) {
            const a = (-i * Math.PI * 2) / num6;
            shoot(game, e.cx, e.cy, Math.cos(a) * 9, Math.sin(a) * 9, 30, 926);
            game.playSfxWav?.('Item_155', 1, e.cx, e.cy);   // 弹 926 首帧音(pcs:52218)
          }
          // 原版凝胶环发射零吼(:46105 的 65 号声是 QueenSlime 1/360 环境声,
          // 与发射时机无关)——曾借 roar 0.5,2026-08-18 对账删
          e.ai0 = 0; e.ai1 = 0; e.ai2 = 0;
        }
      } else {
        e.ai1 += 1;
        if (e.ai1 >= 50) { e.ai1 = 0; e.ai2 = 1; }
        if (phase2) queenFlyMovement(e, game, player);
      }
      break;
    }
    default:
      e.ai0 = 0; e.ai1 = 0; e.ai2 = 0;
      break;
  }

  // 积分 + 碰撞(飞行态无碰撞)
  e.x += e.vx;
  e.y += e.vy;
  if (!flying) collideGround(e, game);

  if (e.hp <= 0) return;

  // 掉血撒仆从(:46147-46177):差值超阈值 → 1-2 只,本体附近随机落点,ai0=-500*rand3
  const threshold = Math.floor(e.maxHp * (phase2 ? 0.015 : 0.02));
  if (e.hp + threshold < la.la0) {
    la.la0 = e.hp;
    const n = 1 + Math.floor(Math.random() * 2); // Next(1,3)
    for (let k = 0; k < n; k++) {
      const pick = Math.floor(Math.random() * 3);
      let minion = spawnPart(game, e, QUEEN_MINION_VANILLA[pick]);
      if (!minion) minion = spawnPart(game, e, QUEEN_MINION_FALLBACK[pick]); // 数据缺 658-660
      if (minion) {
        minion.x = e.x + Math.random() * Math.max(1, e.w - 32);
        minion.y = e.y + Math.random() * Math.max(1, e.h - 32);
        minion.vx = (Math.floor(Math.random() * 31) - 15) * 0.1;
        minion.vy = (-Math.floor(Math.random() * 31)) * 0.1;
        minion.ai0 = -500 * Math.floor(Math.random() * 3);
        minion.ai1 = 0;
      }
    }
  }
}

// ===================== 接线清单(Enemy.ts aiStyle case 表已接线) =====================
//   case 84:  lunaticCultistAI(this, game, p); break;   // 439 真身 + 440 克隆体共用(见文件头)
//   case 120: empressOfLightAI(this, game, p); break;   // 636 光之女皇(原版 AI_120 无 rotation,仅 facing)
//   case 121: queenSlimeAI(this, game, p); break;       // 657 史莱姆皇后(俯仰用 spin)
// 召唤 key: spawnPart(game, src, id)——史后仆从 658/659/660(数据/贴图齐,直连真身;
//   FALLBACK 仅防御);邪教徒仪式态生成 440 克隆体、ai0=7 态召 522 远古之光、ai0=8 态撒 523。
// 弹幕 key: shoot(game, x, y, vx, vy, dmg, projId)——468 光珠(克隆补射)/872 永恒彩虹/
//   873 虹迹/874 极光/922 砸地冲击/926 凝胶弹;实体化类——IceMistCloud 464/LightningOrb 465/
//   FairyQueenLance 919(AI_179 预告→40 速)/SunDanceBeam 923(AI_180 锚本体扫束);
//   467 火球走 Arrow 直飞桶 + projId===467 制导支(AngleLerp 0.008 保速转向)。
// 贴图:Projectile_464/465/467/468/872/873/874/919/922/923/926.png 均已在
//   public/sprites/vanilla/(Arrow 按 projId 懒加载自动生效)。

// ============================================================================
// AI_100 远古之光 522(NPC.cs:42064-42142):轨道投射物型 NPC(邪教徒 ai0=7 直召)。
// 初速 ai[2]/ai[3];ai[0]>60 后按 ai[1] 逐 t 弯转(小随机角 → 环绕/收敛弧线)、
// >120 阻尼 0.98;触地(ai0>=0 时)→ 停驻 5t 自灭。(尘 261 系为纯视觉,略)
// ============================================================================
export function ancientLightAI(e: Enemy, game: GameHooks, player: Player | null) {
  // bInit 原只复位 vx/vy——ai0 泄漏 -1120 时 `ai0>=0` 三门全假 = 计时不启动、
  // 落地不停 → 永不弯转/自灭的直飞弹(F6 可直接造出,2026-08-13 ai0 清查)
  if (!e.bInit) { e.bInit = true; if (e.ai0 < 0) e.ai0 = 0; e.vx = e.ai2; e.vy = e.ai3; }
  if (e.vy === 0 && e.ai0 >= 0) { e.ai0 = -1; e.ai1 = 0; return; }
  if (e.ai0 === -1) {
    e.vx = 0; e.vy = 0;
    e.ai1 += 1;
    if (e.ai1 >= 5) e.dead = true;
    return;
  }
  e.spin = Math.atan2(e.vy, e.vx) - Math.PI / 2;
  if (e.ai0 >= 0) {
    e.ai0 += 1;
    if (e.ai0 > 60) {
      const c = Math.cos(e.ai1), s = Math.sin(e.ai1);
      const nvx = e.vx * c - e.vy * s, nvy = e.vx * s + e.vy * c;
      e.vx = nvx; e.vy = nvy;
    }
    if (e.ai0 > 120) { e.vx *= 0.98; e.vy *= 0.98; }
    if (Math.hypot(e.vx, e.vy) < 0.2) { e.vx = 0; e.vy = 0; }
  }
  e.x += e.vx;
  e.y += e.vy;
  void game; void player;
}

// ============================================================================
// AI_101 远古末日 523(NPC.cs:42143-42221):锚定邪教徒(ai0=头 id)蓄能 420t 显形,
// 蓄满朝四方喷 593 弹(damage)后消散;头失效/蓄满 → 自灭。
// (经典模式邪教徒不可达,专家专属;专家档未开时仅作数据完整性)
// ============================================================================
export function ancientDoomAI(e: Enemy, game: GameHooks, player: Player | null) {
  const CHARGE_MAX = 420;
  const boss = (game.enemies() as Enemy[]).find((n) => !n.dead && n.id === e.ai0 && n.vanillaId === 439);
  // flag108 累加前快照（:42151）：只看锚失效（boss 亡/不在）——满 420 在累加后
  // 自置（:42206-42216），曾把 `>= 420` 提前并入快照 → 蓄满当拍不死、下一拍
  // 双份 593 齐射
  let gone = !boss || e.ai1 < 0;
  let rate = 1;
  if (boss && boss.hp < boss.maxHp / 2) rate = 2;
  if (boss && boss.hp < boss.maxHp / 4) rate = 3;
  e.ai1 += rate;
  const prog = Math.max(0, Math.min(1, e.ai1 / 120)); // :42168 显形进度(前 120t)
  e.vanillaScale = prog;                 // 原版 scale 0→1 显形
  e.spawnAlpha = Math.round(255 - prog * 255); // 原版 alpha 255→0
  if (e.ai1 >= CHARGE_MAX) {
    gone = true;                          // :42208 满能同拍置位 → 齐射一次即灭
    for (let k = 0; k < 4; k++) {
      const ang = -Math.PI / 2 + (Math.PI / 2) * k;
      shoot(game, e.cx, e.cy, Math.cos(ang) * 4, Math.sin(ang) * 4, e.def.damage, 593);
      // 弹 593 首拍音(Projectile.cs:56226-56230 ai[1]==0 → SoundID.Item11):
      // 原版逐弹首 tick 各播一次——四向齐射同帧四弹即四声(2026-08-26 工单⑨补)
      game.playSfxWav?.('Item_11', 1, e.cx, e.cy);
    }
  }
  if (gone) e.dead = true;
  void player;
}
