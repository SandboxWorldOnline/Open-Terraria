// 月系批 AI 家族 1:1 移植(Terarria1456, 1.4.5.6)：
//   ★BJ220 2026-09-20 本文件 aiStyle 8X 族注释行号全量重锚 1457(与 1458 三方一致;
//   1456→1457 本区恒 -1675 行,已逐块 diff 归零验证 1:1;81/84 缩为 4 行 stub 委托
//   命名方法)——只动注释零物码。9X 星璇塔族/AI_003 弓手段未在本刀范围。
//   aiStyle 81  月总游离眼 400            NPC.cs:36982-36985→AI_081_TrueEyeOfCthulhu
//                                              :42900-43373（攻击表 MoonLordAttacksArray2
//                                              :6992-7035 十槽循环:悬停/幻影矢 462/幻影球 454
//                                              六角螺旋/幻影眼 452 洒射/死亡之光 455;锚核心 398
//                                              ai[3],核心亡→静默消散;SetDefaults dontTakeDamage
//                                              =true → 恒无敌）
//   aiStyle 82  月总水蛭块 401            NPC.cs aiStyle82 :36986-37116（ai[2] 90t 从
//                                              源弹456当帧位插值飞向头额(0,+216);到位把
//                                              1000 点治疗按 头396→核心398→手397(ai2=0)
//                                              →手(ai2=1) 亏血序回灌）——台账批:插值起点
//                                              由出生点近似改接真源弹(bInit 配对认领)
//   aiStyle 83  神秘石碑 437/忠实信徒 438  NPC.cs:37118-37287（石碑 CheckFloor 落地校验后召
//                                              4 教徒(379×2 外侧/438×2 内侧,ai[3]=-(碑id+1));
//                                              信徒受击→石碑 localAI[0]=1→弓手激活;四教徒全灭
//                                              →侧面落点召 439 邪教徒 + 300t 仪式倒计时消散）
//   aiStyle 86  暗焰幻影 472/远古幻影 521  NPC.cs:37586-37844（穿墙横掠→越过 660/500px 掉头
//                                              →回摆循环;521 全参数强化(0.7/14/500/6/3)+
//                                              228 号紫雾拖尾;出生 120t 显形爆发音 Item8）
//   aiStyle 87  珍稀四宝箱怪 473-476       NPC.cs:37845-38200（ai[0] 0 伪装箱→1 蓄力 36t→
//                                              2 贴地跳扑(每 210t 随机 3 蓄能无敌 180t/
//                                              4 飞天俯冲/6 三连扑,每第 3 跳双倍高度);
//                                              7 玩家死→零伤满血渐隐;8 十周年世界炮连发不可达）
//   aiStyle 88  飞蛾魔 477                NPC.cs:38201-38731（日食限定;-1 无日食爬升无敌/
//                                              0 悬顶伺服 180t 轮换 2 追击(×0.5 伤)/3 侧掠
//                                              冲刺(3.2 ×1.3 伤)/4 扫地产卵 478(上限 7 只)）
//   aiStyle 89  蛾卵 478                  NPC.cs:38732-38774（900t(专家 600)→Transform 479;
//                                              受击 -10..20×2 孵化加速;末期 75% 抽搐跳）
//   aiStyle 90  幼蛾 479                  NPC.cs:38775-39010（日食限定;-1 爬升/0 悬停 90t→
//                                              2 贴脸 10t 瞄准→2.1 冲刺;无日食→上浮消散）
//   aiStyle 91  花岗岩元素 483            NPC.cs:39011-39195（AI 自置 noGravity=true;穿墙追击/
//                                              侧移锚点/漂移弹壁,与 AI_085 同构五态寻路）
// 去重核实(任务卡勘误):aiStyle 84 ≠ 月总死光——84 = 拜月教邪教徒 439/克隆体 440
//   (NPC.cs:37288-37291 → AI_084_LunaticCultist :65124,Enemy.ts case 84 已落位);
//   "月总死光"是投射物 455 PhantasmalDeathray(本批 aiStyle 81 状态 4 发射,复用
//   bossAI_duke_moonlord 导出的 MLDeathray 类 'core' 档)。星璇塔四组专属怪
//   aiStyle 85/95/96/97/99（405/421/406/407(/408)/420/519）已在本文件 1:1 落位
//   （文件尾段），Enemy.ts 一期近似档（swarmerAI/casterAI）退役；421 头顶吸附的
//   Obstructed(buff 163)已实装（每 tick AddBuff 续期 + Renderer 遮屏滤镜）。
// 弹幕贴图 Projectile_{452,454,462}.png 已入 sprites/vanilla(原 RENDER_PROXY 代渲退役,
//   见 shootL 注释);455 走 MLDeathray 类自绘;526 仪式余烬已升回真弹 TabletShardProj
//   （台账批,归巢 AI 1:1 + d228 尾迹,降级粒子退役）。
import type { Enemy } from './Enemy';
import type { GameHooks } from './types';
import type { Player } from './Player';
import { TILE, ENEMY_GRAVITY, MAX_FALL_SPEED } from '../core/constants';
import { BuffType } from '../stats/Buffs';
import { moveAndCollide } from '../physics/TileCollision';
import { spawnPart, spawnVanillaEnemy, losClear, enemySpawnChain, addEnemy, shootBolt462 } from './bossAI';
import { Arrow } from './Arrow';
import { projFrameImg, projSprite, volleyPhantomOrbs, nudgePhantomOrbs } from './Arrow';
import { Entity } from './Entity';
import { canHitLine } from '../physics/LineOfSight';
import { MLDeathray, MoonLeechProj, type NetProjMeta } from './bossAI_duke_moonlord';
import { tryReflectProjectile, type ReflectableProj } from './projTargets';
import { spawnNpcDeathDust } from './NpcHitDust';   // ★BJ503:519 自爆 HitEffect 查表尘
import { LightningBoltProj } from './LightningBoltProj';
import { TtlSprite } from '../assets/ttlSprite';
import type { Renderer } from '../render/Renderer';
import type { Camera } from '../render/Camera';
import { hostileProjectileDamage, mainDifficulty, getKnockbackMultiplierScaledByDifficulty } from '../stats/ScaleStats';
import { projectileWetSection, projWaterDragFactor } from './projWetSection';
import { projectileData } from '../data/vanillaProjectiles';

/** 原版 localAI[0..3](Enemy 只有 ai0-ai3,localAI 独立 → WeakMap 落盘) */
const localAI = new WeakMap<Enemy, number[]>();
export const lunarLocalAI = (e: Enemy): number[] => {
  let a = localAI.get(e);
  if (!a) { a = [0, 0, 0, 0]; localAI.set(e, a); }
  return a;
};
const TAU = Math.PI * 2;
const rnd = (n: number): number => Math.floor(Math.random() * n);
const rndRange = (a: number, b: number): number => a + Math.floor(Math.random() * (b - a));
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** 最短弧插值(原版 MathHelper 曲线角度语义) */
const angleLerp = (a: number, b: number, t: number): number => {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return a + d * t;
};
/** 朝目标角按最大步长逼近(原版 AngleTowards) */
const angleTowards = (a: number, b: number, maxStep: number): number => {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return Math.abs(d) <= maxStep ? b : a + Math.sign(d) * maxStep;
};
/** expert 门（Main.expertMode → world.isExpert 真难度；曾硬编码 false 恒关——
 *  飞蛾族三处专家档 :38435/:38692/:38745(★BJ220 重锚,原 :40110/:40367/:40420 系 1456)在专家世界应生效） */
const expertMode = (game: GameHooks): boolean => game.world.isExpert;
/** 直积分(原版 noTileCollide 族;NPC.cs UpdateNPC :91400 段共享位移的穿墙分支) */
const fly = (e: Enemy): void => { e.x += e.vx; e.y += e.vy; };

const enemies = (game: GameHooks): Enemy[] => game.enemies() as Enemy[];
const countNpc = (game: GameHooks, id: number): number =>
  enemies(game).filter((n) => !n.dead && n.vanillaId === id).length;

// ---------------------------------------------------------------------------
// 神秘石碑仪式余烬弹 526（Projectile.cs SetDefaults :5964-5972 + AI_098 :33746-
// 33766；出生参数 NPC.cs :37219-37248）——台账批 A 档清偿：降级纯粒子升回真弹。
//   SetDefaults：8×8 / aiStyle98 / tileCollide=false / timeLeft=120 / alpha=255
//   （alpha 满格=不可见本体，可见性全靠尾迹尘 d228）/ damage=0 非敌非友 → 无伤害
//   判定面（原版即纯视觉实体,归巢+尾迹）。AI：
//     目标位 (ai[0],ai[1])；vel.Length() > 距目标 → Kill（抵靶消散 :33750-33753）；
//     否则 normalize(Δ)×15、velocity=Lerp(velocity,val,0.1)（:33755-33757）；
//     每 tick 2×d228 于 Center+(4,4)、noGravity、scale+=rand（:33758-33765）。
//   本体渲染 alpha255 → 不画。★终清波批勘误："磁尘 customData 吸附支未接"登记
//   系误植——1458 原文 AI_098（:33745-33766）两粒 d228 仅设 noGravity+位置偏移
//   (+4,+4)+scale 自增，【从不写 customData】（原样本仓实现已等价,登记撤销）；
//   customData 吸附面在本文件属月总水蛭 aiStyle82 的 d229 环（NPC.cs:37102-37116,
//   终清波批经 VanillaDust.followEnt 承载实装）。
// ---------------------------------------------------------------------------
export class TabletShardProj extends Entity {
  w = 8;
  h = 8;
  dead = false;
  /** ★BJ294 敌射侧拒割位：526 CultistBossParticle SetDefaults 无 friendly 行
   *  （P.cs:5964-72,friendly 缺省 false）+ 敌侧仪式生成 owner=255 → 原版 CutTiles
   *  调用点 friendly 门（:12515）整支不进。详 Entity.ts 中央门 BJ294 注。 */
  noVanillaCut = true;
  private age = 0;

  // ---- ★通用湿段（Projectile.cs:16903-17113,projWetSection.ts 共享体 1:1）----
  //  豁免核对：526 CultistBossParticle SetDefaults P.cs:5964-5972（8×8/aiStyle 98/
  //  tileCollide=false【:5969】/timeLeft 120/alpha 255）【无】ignoreWater 行 →
  //  受段（数据面 PROJ_IGNORE_WATER 亦无 526）。526 ∉ IsDestroyedByWater 六型、
  //  非 2/34/80/155 → 各特支钩缺省（本类无 projId 字段,段参传字面 526——防
  //  Game.ts:3042 快照通判抢 kind1,同 DukeSharknadoBolt 注）。
  //  阻尼不适用（原版形态锚）：tileCollide=false【:5969】→ HandleMovement 湿阻尼支
  //  :17721-17764 整支不进,wetVelocity 保持 :16870 的 AI 前 velocity 快照（无阻尼、
  //  滞后一子步 quirk,YoyoProj 回收态同款三分叉先例）→ wet 位移 = AI 前快照 /
  //  dry 位移 = post-AI velocity（UpdatePosition :20557-20562 分叉,aiStyle 98 不在
  //  早退表 :20551）。本类 AI 每拍 Lerp 重算速度 → 快照 = 上拍末速,湿态即一拍滞后。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价——首拍同位测值） */
  presetDone = false;

  constructor(x: number, y: number, vx: number, vy: number,
    private tgtX: number, private tgtY: number) {
    super();
    this.x = x - this.w / 2;
    this.y = y - this.h / 2;
    this.vx = vx;
    this.vy = vy;
  }
  fixedUpdate(_dt: number, game: GameHooks): void {
    if (++this.age > 120) { this.dead = true; return; }          // timeLeft=120(:5970)
    // :16870 `Vector2 wetVelocity = velocity`（逐子步 AI 前 velocity 快照——526
    //  tileCollide=false,湿态位移消费这份快照,见字段块头注）
    const preVx = this.vx, preVy = this.vy;
    const dx = this.tgtX - this.cx, dy = this.tgtY - this.cy;
    const dist = Math.hypot(dx, dy);
    const vel = Math.hypot(this.vx, this.vy);
    if (dist < vel) {                                            // 抵靶 Kill(:33750)
      // ★⑥杀拍口径（2026-09-06 湿段配方推广）：原版 AI_098 抵靶 Kill+return
      //  （:33749-33753 `if (value13.Length() < velocity.Length()) { Kill(); return; }`）
      //  早退跳过尾迹尘支,但 Update 湿段(:16895)【无 active 门】照跑（`!active` 门
      //  :17132 只拦 Damage/尾尘）→ 杀拍溅花照走。本仓杀位曾整体跳过湿段;现补跑,
      //  测位=存储位（AI_098 不写 position,原版死拍湿段同位,逐值等价）。杀支与
      //  AI 尾活拍调用点同拍互斥（早退）→ 无需 wetSectionRan 旗;526 ∉
      //  IsDestroyedByWater 六型/非 80 → 段内无补 Kill 面。
      projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
        526, !!projectileData(526)?.ignoreWater);
      this.spawnTrail(game);
      this.dead = true;
      return;
    }
    let ux = dx / dist, uy = dy / dist;                          // Normalize×15(:33755)
    ux *= 15; uy *= 15;
    this.vx += (ux - this.vx) * 0.1;                             // Lerp(velocity,val,.1)(:33757)
    this.vy += (uy - this.vy) * 0.1;
    // ---- ★通用湿段（:16903-17113,projWetSection 共享体 1:1）----
    // 位序 = 原版 Update:AI_098（Lerp 追踪完）→ 本段 → HandleMovement/UpdatePosition。
    // 溅花尘/音由共享体调 wetSplashStepShared,本类不自写。
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      526, !!projectileData(526)?.ignoreWater);
    // 位移（tileCollide=false :5969 → 湿阻尼支不进）：wet → position += AI 前快照
    // （:16870,无阻尼滞后一子步 quirk）/ dry → post-AI velocity（:20557-20562 分叉）
    if (this.wet) { this.x += preVx; this.y += preVy; }
    else { this.x += this.vx; this.y += this.vy; }
    this.spawnTrail(game);
  }
  /** 2×d228 尾迹（:33758-33765）：NewDust(Center,0,0,228)→position+=(4,4)、
   *  noGravity、scale+=rand*1 */
  private spawnTrail(game: GameHooks): void {
    for (let i = 0; i < 2; i++) {
      const d = game.spawnDust?.(this.cx, this.cy, 0, 0, 228, 0, 0, 100, null, 1);
      if (!d) continue;
      d.x += 4; d.y += 4;
      d.noGravity = true;
      d.scale += Math.random();
    }
  }
  draw(): void { /* alpha=255（:5971）——本体不画 */ }
}

/** 入投射物桶（同 MLDeathray 经 entities.add(obj,'projectiles) 通道） */
function addShardProj(game: GameHooks, x: number, y: number,
  vx: number, vy: number, tgtX: number, tgtY: number): void {
  (game as unknown as { entities: { add: (en: unknown, b: string) => void } }).entities
    .add(new TabletShardProj(x, y, vx, vy, tgtX, tgtY), 'projectiles');
}

// ---------------------------------------------------------------------------
// 宝箱怪态3 全弹反射扫描（NPC.ReflectProjectiles :67156-67165 + CanReflectProjectile
// :67167-67176 = 命中盒相交门）：遍历玩家投射物桶,凡 projCanBeReflected 且与宿主盒
// 相交者执行 ReflectProjectile（:67189-67212 反向归属——projTargets.reflectProjectile
// 同构移植负责音/尘/速度/伤÷4/penetrate 归一）。速查无 projId/裸枚举对象跳过。
// ---------------------------------------------------------------------------
export function reflectPlayerProjsInHitbox(game: GameHooks, e: Enemy): void {
  for (const q of game.projectiles?.() ?? []) {
    const pr = q as unknown as {
      x?: number; y?: number; w?: number; h?: number; dead?: boolean;
      damage?: number; hostile?: boolean; reflected?: boolean; projId?: number;
    };
    if (!pr || pr.dead || pr.projId === undefined || typeof pr.damage !== 'number') continue;
    if (pr.x === undefined || pr.w === undefined || pr.y === undefined || pr.h === undefined) continue;
    if (pr.x >= e.x + e.w || pr.x + pr.w <= e.x || pr.y >= e.y + e.h || pr.y + pr.h <= e.y) continue;
    tryReflectProjectile(pr as unknown as ReflectableProj, pr.projId, e, game);
  }
}

/** 矩形区域含实心——签名 1:1 对齐 C# `Collision.SolidTiles(x0, x1, y0, y1)`
 *  的【区间序】(xMin,xMax,yMin,yMax)。★R23b-L1 修:曾用角点序 (x0,y0,x1,y1),
 *  而 :429-432/:491 按 C# 区间序传参 → 被解释成对角巨域(左侧地牢世界巨域必含
 *  实心 → 石碑出生首帧自毁、自然邪教徒链断;右侧地牢恒"净空"校验失效)。
 *  同仓 RuntimeEvents.ts 另有一份同名区间序实现,语义一致(未合并=避免跨层依赖) */
function solidRect(game: GameHooks, x0: number, x1: number, y0: number, y1: number): boolean {
  const st = game.world.store;
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      if (x < 0 || y < 0 || x >= st.w || y >= st.h) continue;
      if (st.isSolid(x, y)) return true;
    }
  }
  return false;
}
function solidTileAt(game: GameHooks, x: number, y: number): boolean {
  const st = game.world.store;
  return x >= 0 && y >= 0 && x < st.w && y < st.h && st.isSolid(x, y);
}

// ---------------------------------------------------------------------------
// 弹幕出口:452 PhantasmalEye / 454 PhantasmalSphere / 462 PhantasmalBolt 贴图
// Projectile_{452,454,462}.png 已按 601/602 先例补入 sprites/vanilla(Arrow 按 projId
// 懒加载真图),原 EnchantedBeam 173 代渲登记退役。454/452 的原版归巢弹道
// 已实装(2026-08-19 弹道批):452 走 Arrow phantasm 三段弹道(aiStyle 82,
// Projectile.cs:30119-30195)、454 走 phantomOrb 归巢(随行→列队→齐射,
// aiStyle 83,齐射指令见 Arrow.volleyPhantomOrbs)。
// ---------------------------------------------------------------------------
function shootL(
  game: GameHooks, x: number, y: number, vx: number, vy: number,
  dmg: number, projId: number, life = 300,
  arrowOpts?: Partial<import('./Arrow').ArrowOpts>,
): void {
  (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(
    new Arrow(x, y, vx, vy, dmg, 0, projId, { grav: 0, life, pierce: 1, hostile: true, ...arrowOpts }),
    'projectiles');
}

// ---------------------------------------------------------------------------
// AI_081 月总游离眼 400(1457 AI_081_TrueEyeOfCthulhu :42900-43340)
// 攻击表 MoonLordAttacksArray2(InitializeMoonLordAttacks2 :6992-7035)十槽循环,
// ai[1] 为全局计时逐槽累计。1457 起五个悬停槽 90→53(num=935/num2=1200-935=265/
// num3=5 → num4=53,与头部攻击循环 1200t 相位对齐——真眼由部件 checkDead 按头部
// ai[1] 相位召出,见 bossAI_duke_moonlord.spawnTrueEye):
//   [悬停53, 矢90, 悬停53, 球135, 悬停53, 眼200, 悬停53, 光375, 悬停53, 球135]
// localAI[0]=瞳孔角 [1]=睁眼度 [2]=缩放;ai[2]=球的扫射编码角/眼的螺旋角。
// 注意:原版 ai[0]==-1 分支(:43030)在表驱动下不可达(表值仅 0..4),不移植。
// ai[0]==-2(出生残肢态,spawnTrueEye 置):悬停同款移动,表驱动只在悬停槽(atk==0)
// 才接管(:43017-43022 `(!flag || num4 == 0)`)——攻击槽期间保持 -2 悬浮。
// ---------------------------------------------------------------------------
/** 真眼攻击表(MoonLordAttacksArray2)——Renderer SmolBullet 预警(蓝队 R1-03)共用 */
export const ML_EYE_ATTACKS: ReadonlyArray<readonly [number, number]> = [
  [0, 53], [1, 90], [0, 53], [2, 135], [0, 53], [3, 200], [0, 53], [4, 375], [0, 53], [2, 135],
];

export function moonLordFreeEyeAI(e: Enemy, game: GameHooks, player: Player | null) {
  // :38227 PlaySound(29,…,Next(100,101))——含头不含尾=恒 100 → Zombie_100,
  // case29 style100 ×0.25 由 FILE_CASE_VOL 自动乘(曾借 roar 轨 0.15,2026-08-18 对账修)
  if (rnd(420) === 0) game.playSfxWav?.('Zombie_100', 1, e.cx, e.cy);
  // ---- 核心锚定(:42907-42912):ai[3]=核心 id,核心亡/失效 → life=0 + HitEffect +
  //      active=false。★HitEffect 对 400 是空操作(HitEffect 82492-90939 全链无
  //      type==400 分支,末位 else 对 type!=156 直接 return;★BJ591 勘误:AI_077
  //      :41915-41931 是 ai[0]==3 残肢段的 gore 619-622【清除】面(deactivate 循环
  //      +清眼直清),非喷发面——喷发在 FindFrame case 398 :72721-72729,已由
  //      bossAI_duke_moonlord 核心帧引擎承接;本判语维持:眼 400 死亡=直清,
  //      勿加 gore/死亡声(蓝队 R1-09 驳回) ----
  const core = enemies(game).find((n) => n.id === e.ai3 && n.vanillaId === 398);
  if (!core || core.dead) { e.dead = true; return; }
  e.iframes = 2;                        // SetDefaults dontTakeDamage=true(1457:14183,400 块 14169-14186)

  // ---- 攻击表推进(:38240-38264) ----
  const x = lunarLocalAI(e);
  e.ai1 += 1;
  let slot = 0, consumed = 0, dur = 0;
  for (; slot < 10; slot++) {
    dur = ML_EYE_ATTACKS[slot][1];
    if (!(dur + consumed <= e.ai1)) break;
    consumed += dur;
  }
  if (slot === 10) { slot = 0; e.ai1 = 0; consumed = 0; dur = ML_EYE_ATTACKS[0][1]; }
  // 1457 :43017-43022 表驱动接管门：ai[0] 与表值不同才写;出生残肢态(ai[0]==-2)
  // 只在悬停槽(atk==0)被接管——攻击槽期间保持 -2(下方与悬停态同分支移动)
  const atk = ML_EYE_ATTACKS[slot][0];
  if (e.ai0 !== atk && (e.ai0 !== -2 || atk === 0)) e.ai0 = atk;
  const t = e.ai1 - consumed;           // num1294 槽内已历时
  const pcx = player ? player.cx : e.cx, pcy = player ? player.cy : e.cy;

  if (e.ai0 === 0 || e.ai0 === -2) {
    // ---- 悬停(:38309-38345;1457 :43025 ai[0]==0||ai[0]==-2 同分支——出生残肢
    //      态在表驱动接管前按悬停移动):玩家上方 200px 伺服(24 速/30 步进) + 同族 150px 排斥 ----
    if (player) e.facing = e.seekDirX(player);
    const dx = pcx + (player ? player.vx : 0) * 20 - e.cx;
    const dy = pcy + (player ? player.vy : 0) * 20 - e.cy;
    x[0] = angleLerp(x[0], Math.atan2(dy, dx), 0.5);
    x[1] = Math.min(0.7, x[1] + 0.05);
    x[2] = lerp(x[2], 1, 0.2);
    let tx = pcx - e.cx, ty = pcy - 200 - e.cy;
    const d = Math.hypot(tx, ty) || 1;
    tx = (tx / d) * 24; ty = (ty / d) * 24;
    e.vx = (e.vx * 29 + tx) / 30;
    e.vy = (e.vy * 29 + ty) / 30;
    for (const n of enemies(game)) {                      // :43000-43020（1457 重校：
      // num8=1.25/距离门 <100——曾按 1456 :38323-38345 的 0.25/150 移植后未随
      // AI_081 重做复核,分离力弱 5 倍+半径偏大,真眼群在玩家头顶叠团）
      if (n !== e && !n.dead && n.vanillaId === 400
        && Math.hypot(n.cx - e.cx, n.cy - e.cy) < 100) {
        if (e.x < n.x) e.vx -= 1.25; else e.vx += 1.25;
        if (e.y < n.y) e.vy -= 1.25; else e.vy += 1.25;
      }
    }
  } else if (e.ai0 === 1) {
    // ---- 幻影矢 462(:43025-43068):减速瞄准,dur-14/-7/dur 三连(35 伤,速 8) ----
    if (t === 0 && player) e.facing = e.seekDirX(player);
    e.vx *= 0.95; e.vy *= 0.95;
    if (Math.hypot(e.vx, e.vy) < 1) { e.vx = 0; e.vy = 0; }
    const dx = pcx + (player ? player.vx : 0) * 20 - e.cx;
    const dy = pcy + (player ? player.vy : 0) * 20 - e.cy;
    // :43033-43040 瞳角/睁眼度只在槽时 < num-14-5(=dur-19) 推进——末 19t 冻结,
    // 弹道指向锁定(齐射可预读)。曾每 tick 无门执行=出手向不可预读
    if (t < dur - 19) {
      x[0] = angleLerp(x[0], Math.atan2(dy, dx), 0.5);
      x[1] = Math.min(1, x[1] + 0.05);
    }
    x[2] = lerp(x[2], t < 20 ? 1.1 : 0.4, 0.2);
    // :38389 PlaySound(4,…,6)=case4 死音库 → NPC_Killed_6(曾错 NPC_Hit_6,终审修)
    if (t === dur - 35) game.playSfxWav?.('NPC_Killed_6', 1, e.cx, e.cy);
    if (t === dur - 14 || t === dur - 7 || t === dur) {          // :38392-38398
      const ox = Math.cos(x[0]) * 30 * x[1], oy = Math.sin(x[0]) * 30 * x[1];
      const d = Math.hypot(dx, dy) || 1;
      // 出膛口走 shootBolt462(首拍二选一音 Item_124/125 + 尘 229,Projectile.cs
      // :56236-56257,工单⑦——与月总手/头/核心折叠链四处发射点统一)
      shootBolt462(game, e.cx + ox, e.cy + oy, (dx / d) * 8, (dy / d) * 8, 35);
    }
  } else if (e.ai0 === 2) {
    // ---- 幻影球 454 六角螺旋(:38397-38491) ----
    if (t < 15) {                                            // :38398-38406 收瞳减速
      x[1] = Math.max(0, x[1] - 0.07);
      x[2] = lerp(x[2], 0.4, 0.2);
      e.vx *= 0.8; e.vy *= 0.8;
      if (Math.hypot(e.vx, e.vy) < 1) { e.vx = 0; e.vy = 0; }
    } else if (t < 75) {
      // :38408-38460 六顶点两两插值轨道(0→2→5→3→1→4→0),每 10t 沿轨道外发 454(40 伤,速 4)
      const k = Math.floor((t - 15) / 10);
      const PAIRS: ReadonlyArray<readonly [number, number]> = [[0, 2], [2, 5], [5, 3], [3, 1], [1, 4], [4, 0]];
      const [p0, p1] = PAIRS[k] ?? [0, 2];
      const hex = (i: number): [number, number] => {
        const a = -Math.PI / 2 + (i * TAU) / 6;             // Vector2.UnitY*-30 旋转 i·π/3
        return [Math.cos(a) * 30, Math.sin(a) * 30];
      };
      const f = (t - 15) / 10 - k;
      const [ax, ay] = hex(p0), [bx, by] = hex(p1);
      const px = lerp(ax, bx, f), py = lerp(ay, by, f);
      x[0] = Math.atan2(py, px);
      x[1] = lerp(x[1], Math.hypot(px, py) / 30, 0.5);
      game.spawnParticles(e.cx + px, e.cy + py, '#C040D0', 2, 0.8, { life: 20 });  // :38455-38459
      if ((t - 15) % 10 === 0) {
        const d = Math.hypot(px, py);
        const ux = d > 0.001 ? px / d : 0, uy = d > 0.001 ? py / d : -1;
        // 出生 ai0=30(:38452-38457 NewProjectile 第 9 参)——跳过随行直接列队;
        // ai[1]=whoAmI → ownerId(齐射指令圈定)
        shootL(game, e.cx + px, e.cy + py, ux * 4, uy * 4, 40, 454, 600,
          { phantomOrb: { ownerId: e.id, ai0: 30 } });
      }
    } else if (t < 105) {
      // :38462-38485 瞄准升空(75t 起跳 vy=-7 并给己方 454 叠加同一速度把它们带起)
      x[0] = angleLerp(x[0], e.ai2 - Math.PI / 2, 0.2);
      x[2] = lerp(x[2], 0.75, 0.2);
      if (t === 75) {
        e.vx = 0; e.vy = -7;
        nudgePhantomOrbs(game, e.id, 0, -7);                 // :38475-38483
      }
      e.vy *= 0.96;
      if (player) e.ai2 = Math.atan2(pcy - e.cy, pcx - e.cx) + Math.PI / 2;
      e.spin = angleTowards(e.spin, e.ai2, Math.PI / 30);
    } else if (t < 120) {
      // :38487-38505 发射:沿瞄准向 24 速冲出;己方全部 454 置 -1 以瞄准向
      // (ai2−π/2)·12 同矢量齐射
      game.playSfxWav?.('Zombie_102', 1, e.cx, e.cy);        // :38487 PlaySound(29,…,102)——case29 style102 ×0.4 自动档(曾借 roar 0.4 恰同值)
      e.vx = Math.cos(e.ai2 - Math.PI / 2) * 24;
      e.vy = Math.sin(e.ai2 - Math.PI / 2) * 24;
      if (t === 105) {
        volleyPhantomOrbs(game, e.id,
          Math.cos(e.ai2 - Math.PI / 2) * 12, Math.sin(e.ai2 - Math.PI / 2) * 12);   // :38494-38505
      }
    } else {
      e.vx *= 0.92; e.vy *= 0.92;                            // :38507-38510
      e.spin = angleLerp(e.spin, 0, 0.2);
    }
  } else if (e.ai0 === 3) {
    // ---- 幻影眼 452 洒射(:38512-38583) ----
    if (t < 15) {
      x[1] = Math.max(0, x[1] - 0.07);
      x[2] = lerp(x[2], 0.4, 0.2);
      e.vx *= 0.9; e.vy *= 0.9;
      if (Math.hypot(e.vx, e.vy) < 1) { e.vx = 0; e.vy = 0; }
    } else if (t < 45) {
      // :38530-38538 瞳孔摆正
      x[0] = 0;
      x[1] = Math.sin((t - 15) * TAU / 15) * 0.5;
      if (x[1] < 0) x[0] = Math.PI;
    } else if (t < 185) {
      // :38540-38568 螺旋外扩洒射(8→20 速,每 10t 一发 452,35 伤,速 8)
      if (t === 45) e.ai2 = (Math.random() < 0.5 ? 1 : -1) * TAU / 40;
      if ((t - 45) % 40 === 0) e.ai2 *= 0.95;
      x[0] += e.ai2;
      x[1] = Math.min(1, x[1] + 0.05);
      const ox = Math.cos(x[0]) * 30 * x[1], oy = Math.sin(x[0]) * 30 * x[1];
      const spd = lerp(8, 20, (t - 45) / 140);
      const d = Math.hypot(ox, oy) || 1;
      e.vx = (ox / d) * spd; e.vy = (oy / d) * spd;
      e.spin = angleLerp(e.spin, Math.atan2(e.vy, e.vx) + Math.PI / 2, 0.2);
      if ((t - 45) % 10 === 0) {
        // :38557-38563 ai[1] 弧线弯转角 = (2π·rand−π)/30 + π/180·ai[2]
        // (ai[2]=螺旋角速度 e.ai2)——452 三段弹道(45/90t 弧线上升→14 速追踪)
        shootL(game, e.cx + (ox / d) * 12, e.cy + (oy / d) * 12,
          (ox / d) * 8, (oy / d) * 8, 35, 452, 600,
          { phantasm: { spin: (TAU * Math.random() - Math.PI) / 30 + (Math.PI / 180) * e.ai2 } });
      }
    } else {
      // :38570-38583 收势
      e.vx *= 0.88; e.vy *= 0.88;
      e.spin = angleLerp(e.spin, 0, 0.2);
      x[1] = Math.max(0, x[1] - 0.07);
      x[2] = lerp(x[2], 1, 0.2);
    }
  } else if (e.ai0 === 4) {
    // ---- 死亡之光 455(:38585-38665):180t 吸能 → MLDeathray('core' 档,50 伤×2) ----
    if (t === 0 && player) e.facing = e.seekDirX(player);
    if (t < 180) {
      x[2] = lerp(x[2], 1, 0.2);
      x[1] = Math.max(0, x[1] - 0.05);
      e.vx *= 0.95; e.vy *= 0.95;
      if (Math.hypot(e.vx, e.vy) < 1) { e.vx = 0; e.vy = 0; }
      if (t >= 60) {                                          // :38616-38632 吸能粒子
        game.spawnParticles(e.cx + (Math.random() - 0.5) * 30, e.cy + (Math.random() - 0.5) * 30,
          '#B040D0', t >= 120 ? 2 : 1, 1.2, { life: 24 });
      }
    } else if (t < dur - 15) {
      if (t === 180 && player) {
        // :38634-38650 起角 = 朝玩家 ∓ 60°,角速度 = ±2π/540(MLDeathray 'core' 档 1:1)
        const dx = pcx - e.cx, dy = pcy - e.cy;
        const dd = Math.hypot(dx, dy) || 1;
        const n = dx / dd < 0 ? 1 : -1;                       // num1318
        const ang = Math.atan2(dy, dx) - n * TAU / 6;
        (game as unknown as { entities: { add: (en: unknown, b: string) => void } }).entities.add(
          new MLDeathray(e, 'core', ang, n * TAU / 540, 50 * 2), 'projectiles');
        e.ai2 = (ang + Math.PI * 3) * n;                      // :38649 扫射编码角
      }
      x[1] = Math.min(1, x[1] + 0.05);
      // ★R23b-F5 修:扫射窗口原版每 tick velocity×0.93 渐停(1458 :43329-43331
      // `else if (num3 < num-15f) { velocity *= 0.93f; ...}`)——曾全程匀速直线漂移
      e.vx *= 0.93; e.vy *= 0.93;
      // :43336-43343 编码角逐 t 解码步进(瞳角跟踪扫射束)
      const s = e.ai2 >= 0 ? 1 : -1;
      const a = Math.abs(e.ai2) - Math.PI * 3 + (s * TAU) / 540;
      x[0] = a;
      e.ai2 = (a + Math.PI * 3) * s;
    } else {
      x[1] = Math.max(0, x[1] - 0.07);                        // :38664-38666
    }
  }
  // ---- 渲染镜像(Main.cs case 400 :24492-24504,Renderer.drawMoonLordFreeEye 直读)----
  // 瞳孔角/睁眼度/瞳孔缩放 → lai0/lai1/lai2(原版 localAI[0..2]:瞳孔椭圆
  // (30,30)×localAI[1]、瞳孔整体 scale localAI[2](0.4-1.15 脉动));本体 rotation
  // 由上方攻击态写 e.spin(原版仅攻击 2/3 写 npc.rotation,余态保值)。
  e.lai0 = x[0];
  e.lai1 = x[1];
  e.lai2 = x[2];
  fly(e);
}

// ---------------------------------------------------------------------------
// AI_082 月总水蛭块 401（1458 NPC.cs aiStyle82 :36986-37116）
// ai[0]=头 396 id+1 / ai[1]=源弹 456 ProjectileKey / ai[2] 90t 计数。
// ★台账批：插值起点由“出生点近似”改接真弹——Center = Lerp(proj.Center,
// 头心+(0,216), ai2/90)（:37091-37093 式,proj=Main.projectile[(int)ai[1]]）。
// 本仓 MoonLeechProj 由 bossAI_duke_moonlord 出膛、srcId 标识源 NPC；本模块在
// bInit 时按 srcId+“回程未认领”配对一枚源弹并 WeakMap 落存，插值全程取其当帧
// 实时位置（多弹同拍认领顺序±1 对微差登记）；无候选回退出生点（原实现语义）。
// 到位 1000 点治疗按 头→核心→手0→手1 亏血序回灌后消散（:37026-37083,序已对齐）。
// ---------------------------------------------------------------------------
const leechSrcProj = new WeakMap<Enemy, MoonLeechProj | null>();
/** 水蛭 d229 环随行差（终清波批）：Dust.Update :896-917 228/229/279 档
 *  customData=NPC → dust.position += npc.position − npc.oldPos[1]。本仓以
 *  【本拍位移】承载（oldPos[1] 滞后一拍语义,≤1t 相位差登记口径同前批）——
 *  共享可变 state 对象由 followEnt 闭包逐尘引用,每拍覆盖 → 已在场老尘持续跟随 */
const leechRide = new WeakMap<Enemy, { dx: number; dy: number }>();

function claimSourceLeechProj(game: GameHooks, head: Enemy): MoonLeechProj | null {
  for (const q of game.projectiles?.() ?? []) {
    if (!(q instanceof MoonLeechProj)) continue;
    const p = q as unknown as MoonLeechProj & { claimed?: boolean };
    if ((p as unknown as { srcId?: number }).srcId !== head.id) continue;
    if (p.claimed || p.dead) continue;
    p.claimed = true;
    return p;
  }
  return null;
}

export function moonLeechAI(e: Enemy, game: GameHooks, _player: Player | null) {
  const x = lunarLocalAI(e);
  // ---- 头锚定(:36992-36998：头 396 消失即消散——bInit 前置校验对齐) ----
  const head = enemies(game).find((n) => n.id === Math.floor(e.ai0) - 1 && n.vanillaId === 396);
  if (!head || head.dead) { e.dead = true; return; }
  if (!e.bInit) {
    e.bInit = true;
    e.ai2 = 0;
    x[0] = e.cx; x[1] = e.cy;    // 回退锚（无活源弹时的出生点近似）
    leechSrcProj.set(e, claimSourceLeechProj(game, head));
  }
  e.ai2 += 1;
  const LEECH_T = 90;                                       // :36988 num1212
  if (e.ai2 >= LEECH_T) {
    // ---- 治疗回灌(:37026-37083):池 1000,按 头→核心→手0→手1 亏血序 ----
    const core = enemies(game).find((n) => n.id === head.ai3 && n.vanillaId === 398);
    const hands = enemies(game).filter((n) => !n.dead && n.vanillaId === 397 && n.ai3 === head.ai3);
    const hand0 = hands.find((n) => n.ai2 === 0);
    const hand1 = hands.find((n) => n.ai2 === 1);
    let pool = 1000;                                        // :37026 num1219
    for (const tgt of [head, core, hand0, hand1]) {
      if (!tgt || tgt.dead || pool <= 0) continue;
      const deficit = tgt.maxHp - tgt.hp;
      if (deficit <= 0) continue;
      const amt = Math.min(pool, deficit);                  // num1224 = min(deficit,pool)
      tgt.hp += amt;
      pool -= amt;
      game.spawnParticles(tgt.cx, tgt.cy, '#5AE86A',
        Math.min(8, 2 + Math.floor(amt / 100)), 1.6, { life: 30 });   // HealEffect 近似
    }
    e.dead = true;                                          // HitEffect+active=false(:37084)
    return;
  }
  // ---- 插值飞行(:37090-37093)：Lerp(proj.Center, 头心+(0,216), ai2/90) ----
  e.vx = 0; e.vy = 0;
  const k = e.ai2 / LEECH_T;
  const pxPrev = e.cx, pyPrev = e.cy;                       // 本拍位移采样基点（prev-center）
  const src = leechSrcProj.get(e) ?? undefined;
  if (src && !src.dead) {
    x[0] = src.x + src.w / 2;                               // proj.Center 当帧实位
    x[1] = src.y + src.h / 2;
  } else if (src) {
    leechSrcProj.set(e, null);                              // 源弹亡 → 冻结最后坐标
  }
  e.x = lerp(x[0], head.cx, k) - e.w / 2;
  e.y = lerp(x[1], head.cy + 216, k) - e.h / 2;
  // ★终清波批：d229 双环精确化（原 spawnParticles 近似退役）——NPC.cs:37102-37116：
  //   · 外环 6 粒 NewDust(Center − One*4 + UnitY*(−h/2).RotatedBy(i·τ/6))，vel=−UnitY、
  //     noGravity、scale 0.7；内环 3 粒 NewDust(… UnitY*(−h/6) …, 0,−2)，scale 1.5；
  //   · 两环均 customData=this → Dust.Update 228/229/279 档 dust.position +=
  //     npc.position − npc.oldPos[1]（followEnt 承载,共享 ride 态）
  const ride = (() => {
    let r = leechRide.get(e);
    if (!r) { r = { dx: 0, dy: 0 }; leechRide.set(e, r); }
    r.dx = e.cx - pxPrev; r.dy = e.cy - pyPrev;             // 本拍位移（含设置段首拍 0 面）
    return r;
  })();
  const emitRing = (count: number, halfH: number, svx: number, svy: number, scale: number): void => {
    for (let i = 0; i < count; i++) {
      const th = i * (Math.PI * 2) / count;
      // RotatedBy 标准矩阵：x' = x·cos − y·sin、y' = x·sin + y·cos；x=0,y=−halfH
      const ox = Math.sin(th) * halfH;
      const oy = -Math.cos(th) * halfH;
      const d = game.spawnDust?.(e.cx + ox - 4, e.cy + oy - 4, 0, 0,
        229, svx, svy, 0, null, 1, false, true);            // perfect:true = 原文后置定值链
      if (!d) continue;
      d.x = e.cx + ox - 4; d.y = e.cy + oy - 4;             // NewDust 0 盒抖动窗消解（−One*4 保真）
      d.vx = svx; d.vy = svy;
      d.noGravity = true;
      d.scale = scale;
      d.followEnt = () => ({ dx: ride.dx, dy: ride.dy });
    }
  };
  emitRing(6, e.h / 2, 0, -1, 0.7);                          // :37103-37111
  emitRing(3, e.h / 6, 0, -2, 1.5);                          // :37112-37116
}

// ---------------------------------------------------------------------------
// AI_083a 神秘石碑 437(NPC.cs:37120-37250 + CultistRitual.cs CheckFloor)
// 落地校验(CheckFloor:±6/±10 格四点 3 格净空)→ 召 4 教徒;信徒受击→弓手激活;
// 四教徒全灭 → 侧面召 439 + 300t 仪式倒计时(120t 起每 10t 仪式粒子)消散。
// 槽位:弓手 id+1 存 ai[0..1](原版同),信徒 id+1 存 localAI[1..2];ai[0]=-1 标记
// 邪教徒已召(此后 ai[3] 为倒计时)。
// ---------------------------------------------------------------------------
/** CultistRitual.CheckFloor(CultistRitual.cs:88-124 1:1):i∈{-5,-3,3,5} → x=tileX+i*2,
 *  y 自 tileY-5 向下扫至 +11,取首个"实心/平台 且上方 3 格净空"的点;不足 4 点 → null */
export function ritualCheckFloor(game: GameHooks, cx: number, cy: number): Array<{ x: number; y: number }> | null {
  const pts: Array<{ x: number; y: number }> = [];
  const tx = Math.floor(cx / TILE), ty = Math.floor(cy / TILE);
  for (const i of [-5, -3, 3, 5]) {
    const x = tx + i * 2;
    for (let j = -5; j < 12; j++) {
      const y = ty + j;
      if (y < 1 || y >= game.world.store.h - 1) break;
      const floor = solidTileAt(game, x, y) || game.world.store.isPlatform(x, y);
      if (!floor) continue;
      // 净空:本柱 3 格全空,或(本柱空 且 左右柱上两行空)——原版双条件或语义
      const clearMid = !solidRect(game, x - 1, x + 1, y - 3, y - 1);
      const clearSide = !solidRect(game, x, x, y - 3, y - 1)
        && !solidRect(game, x + 1, x + 1, y - 3, y - 2)
        && !solidRect(game, x - 1, x - 1, y - 3, y - 2);
      if (clearMid || clearSide) { pts.push({ x, y }); break; }
    }
  }
  return pts.length === 4 ? pts : null;
}

export function cultistTabletAI(e: Enemy, game: GameHooks, _player: Player | null) {
  const x = lunarLocalAI(e);
  // ★BJ347-②：真 dontTakeDamage 持续态（SetDefaults :14219 437 块,fromVanilla 手补表
  //  同位；AI_083a 全程无解除点=恒不可击）。旧 iframes=2 每 tick 刷新近似被 hurt
  //  免疫门 pierce===1 豁免绕过（`pierce!==1 && iframes>0`,R23b-P1 同族反模式）→
  //  箭/枪弹/多数随从可磨死 400 血石碑=用户实报「跪拜魔法阵有时可被攻击、
  //  打掉后不出教主」（碑亡→四守卫 owner 检查连坐消散、召唤门随碑灭）
  e.dontTakeDamage = true;
  e.lightRGB = [0.8, 0.75, 0.55];      // :37285 Lighting.AddLight
  if (!e.bInit) {
    // ---- 落地校验 + 召四教徒(:37123-37149) ----
    e.bInit = true;
    e.ai0 = 0; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0;
    const pts = ritualCheckFloor(game, e.cx, e.cy);
    if (!pts) { e.dead = true; return; }               // 站不住 → 静默消散
    let arcN = 0, devN = 0;
    for (let k = 0; k < 4; k++) {
      const isDevotee = k === 1 || k === 2;            // 内侧两点信徒,外侧两点弓手
      const child = spawnPart(game, e, isDevotee ? 438 : 379);
      if (!child) continue;
      child.x = pts[k].x * TILE + 8 - child.w / 2;
      child.y = pts[k].y * TILE - child.h;             // 站上落点面(原版顶锚 y-48)
      child.ai3 = -(e.id + 1);                          // ai[3]=-(碑id+1) 待机锚
      child.bInit = true;
      if (isDevotee) x[1 + devN++] = child.id + 1;      // localAI[1..2]=信徒 id+1
      else if (arcN === 0) { e.ai0 = child.id + 1; arcN = 1; }   // ai[0]=弓手0 id+1
      else { e.ai1 = child.id + 1; arcN = 2; }                   // ai[1]=弓手1 id+1
    }
    if (arcN < 2 || devN < 2) { e.dead = true; return; }   // 生成不足 → 消散
    return;
  }
  // ---- 信徒受击 → 弓手激活(:37151-37164 localAI[0]==1) ----
  if (x[0] === 1) {
    x[0] = 2;
    for (let k = 0; k < 2; k++) {
      const dev = enemies(game).find((n) => n.id === x[k + 1] - 1 && n.vanillaId === 438);
      if (dev) dev.ai1 = 1;   // :37156 信徒 ai[1]=1(1.4.5.6 无消费方,存档语义保留)
      const arcId = k === 0 ? e.ai0 : e.ai1;
      const arc = enemies(game).find((n) => n.id === Math.floor(arcId) - 1 && n.vanillaId === 379);
      if (arc) arc.ai3 = 0;   // :37159 弓手解除待机(零伤恢复见 cultistArcherWake)
    }
  }
  // ---- 四教徒全灭 → 召 439(:37166-37204) ----
  if (e.ai0 !== -1) {
    const gone = [0, 1].every((k) => {
      const dev = enemies(game).find((n) => n.id === x[k + 1] - 1);
      const arc = enemies(game).find((n) => n.id === Math.floor(k === 0 ? e.ai0 : e.ai1) - 1);
      return (!dev || dev.dead || dev.vanillaId !== 438)
        && (!arc || arc.dead || arc.vanillaId !== 379);
    });
    if (gone) {
      // :37178-37193 侧面 11 格找落地列(±随机向),自碑心向下扫首个实心面
      const side = Math.random() < 0.5 ? 1 : -1;
      const tx = Math.floor(e.cx / TILE) + 11 * side;
      let ty = Math.floor(e.cy / TILE);
      for (let j = -5; j < 12; j++) {
        const y = Math.floor(e.cy / TILE) + j;
        if (solidTileAt(game, tx, y) && !solidRect(game, tx - 1, tx + 1, y - 3, y - 1)) { ty = y; break; }
        if (j === 11) ty = y;
      }
      const cultist = spawnPart(game, e, 439);
      // TabletDestroyed(delay=43200 重置)由 Game 侧 ai0==-1 边沿捕获记账
      // （_cultistTabletDone WeakSet 去重）——勿在此再调,避免双路径
      if (cultist) {
        cultist.x = tx * TILE + 10 - cultist.w / 2;
        cultist.y = ty * TILE - cultist.h;              // 原版顶锚 y=tileY*16-2,本仓落底对齐
        cultist.facing = Math.sign(e.cx - (tx * TILE + 10)) || 1;
        // ★自然石碑链 439 占 boss 槽(F6/召唤链同款)——曾缺:杀教徒后 downed_439/
        // 击败公告/TriggerLunarApocalypse 四塔/月总整链不发=主进度断链(终审 P0 修)。
        // bInit 留 false:localAI[0]==0 出生 420t 渐显+无敌窗+Zombie_89(:65296-65337,
        // 曾 bInit=true 跳过=无入场演出,终审修)
        (game as unknown as { boss?: unknown }).boss = cultist;
        e.ai2 = cultist.id;                             // :37200 ai[2]=邪教徒 id
      }
      e.ai0 = -1; e.ai1 = 0; e.ai3 = 0;
      // CultistRitual.TabletDestroyed()(复活延迟账)——事件延迟系统未引入,略
    }
  }
  // ---- 仪式倒计时(:37209-37249):300t 满 → 爆散;120t 起每 10t 一枚 526 ----
  // ★台账批：526 从“纯粒子代”升回真弹实体（A 档清偿）——弹本体归巢 AI 在
  // Projectile.cs:33746-33766，出生参数在 NPC.cs:37217-37248，见 spawnTabletShard。
  if (e.ai0 === -1) {
    e.ai3 += 1;
    if (e.ai3 > 300) {
      e.dead = true;
      const cultist = enemies(game).find((n) => n.id === Math.floor(e.ai2));
      const tgtX = cultist ? cultist.cx : e.cx, tgtY = cultist ? cultist.cy : e.cy;
      for (let k = 0; k < 6; k++) {                     // :37219-37226 六枚直飞
        const spd = 3 + Math.random() * 6;
        const ang = Math.PI / 2 * 2 * Math.random();    // UnitY.RotatedByRandom(2π)
        const dxs = -Math.sin(ang), dys = Math.cos(ang);
        addShardProj(game, e.cx + dxs * 30, e.cy + dys * 30, dxs * spd, dys * spd, tgtX, tgtY);
      }
      for (let k = 0; k < 20; k++) {                    // :37227-37239 二十枚(1/2 保留)
        if (Math.floor(Math.random() * 2) !== 0) continue;
        const spd = 3 + Math.random() * 6;
        const ang = Math.PI / 2 * 2 * Math.random();
        const dxs = -Math.sin(ang), dys = Math.cos(ang);
        const off = Math.random() * 45 + 45;
        addShardProj(game, e.cx + dxs * 30, e.cy + dys * 30, dxs * spd, -20,
          e.cx + dxs * off, e.cy + dys * off + 20);     // 目标位 += UnitY*20
      }
    } else if (e.ai3 % 10 === 1 && e.ai3 > 120) {       // :37241-37248 仪式期间余烬
      const cultist = enemies(game).find((n) => n.id === Math.floor(e.ai2));
      if (!cultist || cultist.dead) return;             // 原版 ai[2] 取空会越界——缺省跳过
      const spd = 3 + Math.random() * 6;
      const ang = Math.PI / 2 * 2 * Math.random();
      const dxs = -Math.sin(ang), dys = Math.cos(ang);
      addShardProj(game, e.cx + dxs * 25, e.cy + dys * 25, dxs * spd, dys * spd,
        cultist.cx, cultist.cy);
    }
  }
  // 石碑静止(noGravity,noTileCollide;SetDefaults 437 块 1457:14204-14222)
}

// ---------------------------------------------------------------------------
// AI_083b 拜月忠实信徒 438(NPC.cs:37251-37279)
// 站立面碑:横向摩擦 ±0.1 清零、朝碑翻转清 vx;受击 → 碑 localAI[0]=1(弓手激活链);
// ai[0] 300t 循环(站立摆动帧驱动)。重力/落地走共享块(NPC.cs UpdateNPC :91400 段)。
// ---------------------------------------------------------------------------
export function lunaticDevoteeAI(e: Enemy, game: GameHooks, _player: Player | null) {
  e.vx *= 0.93;
  if (e.vx > -0.1 && e.vx < 0.1) e.vx = 0;
  const owner = enemies(game).find((n) => n.id === -e.ai3 - 1 && n.vanillaId === 437);
  if (!owner || owner.dead) { e.dead = true; return; }   // :37259-37263 碑亡→消散
  const dir = Math.sign(owner.cx - e.cx);
  if (dir !== 0 && dir !== e.facing) { e.vx = 0; e.facing = dir; }   // :37265-37272
  if (e.justHit) {                                       // :37274-37277 → 碑 localAI[0]=1
    const ox = lunarLocalAI(owner);
    if (ox[0] === 0) ox[0] = 1;
  }
  if (e.ai0 < 0 || e.ai0 >= 300) e.ai0 = 0;              // 原版 ai[0] 出生 0
  e.ai0 += 1;
  if (e.ai0 >= 300) e.ai0 = 0;                           // :37278-37281
  e.vy = Math.min(e.vy + ENEMY_GRAVITY, MAX_FALL_SPEED);
  moveAndCollide(e, game.world, e.vx, e.vy);
}

// ---------------------------------------------------------------------------
// AI_003 待机尾段:拜月教弓手 379/380(NPC.cs:56756-56795)
// ai[3]<0 仪式待机:零接触伤、静立面碑(同信徒摩擦/翻转)、ai[0] 卡 1000..1300 站立帧
// 循环;受击 → 碑 localAI[0]=1。碑置 ai[3]=0 后:ai[0]≥1000 清零 + damage 恢复
// (:56791-56795),回 AI_003 战士核(射击参数见 Enemy.RANGED_TABLE 379/380 条目)。
// ---------------------------------------------------------------------------
export function cultistArcherStandbyAI(e: Enemy, game: GameHooks) {
  e.def.damage = 0;                                      // :56762 damage=0(待机零伤)
  const owner = enemies(game).find((n) => n.id === -e.ai3 - 1 && n.vanillaId === 437);
  if (!owner || owner.dead) { e.dead = true; return; }
  e.vx *= 0.93;
  if (e.vx > -0.1 && e.vx < 0.1) e.vx = 0;
  const dir = Math.sign(owner.cx - e.cx);
  if (dir !== 0 && dir !== e.facing) { e.vx = 0; e.facing = dir; }
  if (e.justHit) {                                       // :56776-56779 → 碑 localAI[0]=1
    const ox = lunarLocalAI(owner);
    if (ox[0] === 0) ox[0] = 1;
  }
  if (e.ai0 < 1000) e.ai0 = 1000;                        // :56780-56782 站立帧段
  e.ai0 += 1;
  if (e.ai0 >= 1300) e.ai0 = 1000;
  e.vy = Math.min(e.vy + ENEMY_GRAVITY, MAX_FALL_SPEED);
  moveAndCollide(e, game.world, e.vx, e.vy);
}

/** 弓手激活复位(:56791-56795):ai[0]≥1000 清零、damage 恢复 defDamage(待机段置 0) */
export function cultistArcherWake(e: Enemy) {
  if (e.ai0 >= 1000) e.ai0 = 0;
  e.def.damage = e.vanilla?.damage ?? e.def.damage;
}

// ---------------------------------------------------------------------------
// AI_086 暗焰幻影 472 / 远古幻影 521(NPC.cs:37586-37844)
// 穿墙飞行族:0 定向 → 1 横掠(越玩家 660/500px 掉头)→ 2 竖摆 → 3 回掠 循环;
// 521 参数强化(0.7/14/500/6/3)+ 228 号紫雾拖尾;出生 120t 显形(Item8 音+尘爆)。
// ---------------------------------------------------------------------------
export function phantomAI(e: Enemy, game: GameHooks, player: Player | null) {
  const x = lunarLocalAI(e);
  const big = e.vanillaId === 521;
  if (e.spawnAlpha > 0) e.spawnAlpha = Math.max(0, e.spawnAlpha - 30);   // :37590-37596
  // ---- 同族 50px 排斥(:37602-37624) ----
  for (const n of enemies(game)) {
    if (n === e || n.dead || n.vanillaId !== e.vanillaId) continue;
    let dx = n.cx - e.cx, dy = n.cy - e.cy;
    const d = Math.hypot(dx, dy);
    if (d >= 50) continue;
    if (d > 0.001) { dx /= d; dy /= d; } else { dx = n.id > e.id ? 1 : -1; dy = 0; }
    e.vx -= dx * 0.4; e.vy -= dy * 0.4;
    n.vx += dx * 0.4; n.vy += dy * 0.4;
  }
  // ---- 出生显形(:37627-37660 472 / :37662-37685 521) ----
  if (x[3] < 120) {
    if (x[3] === 0) {
      game.playSfxFiles?.(['Item_8'], 0.5, e.cx, e.cy); // :37632 SoundID.Item8（原 roar 为错键）
      if (player) e.facing = e.seekDirX(player);
      e.vx += e.facing * 2;
      if (!big) game.spawnParticles(e.cx, e.cy - 18, '#7A4BD0', 20, 4, { life: 30 });
    }
    x[3] += 1;
    if (big) game.spawnParticles(e.cx, e.cy, '#5A2BA0', 2, 1.5, { life: 20 });
  }
  // ---- 状态机(:37687-37834);原版 ai[0] 出生 0,Enemy 哨兵 -1120 归一 ----
  if (e.ai0 < 0 || e.ai0 > 3) e.ai0 = 0;
  if (e.ai0 === 0) {
    if (player) e.facing = e.seekDirX(player);
    e.ai0 = 1; e.ai1 = e.facing;
  } else if (e.ai0 === 1) {
    // 横掠:加速 0.3/0.7 封顶 7/14,纵轴 4/6 伺服;越玩家 660/500px → 2
    const acc = big ? 0.7 : 0.3, max = big ? 14 : 7;
    const yClamp = big ? 6 : 4, range = big ? 500 : 660, yStep = big ? 3 : 4;
    if (player) e.facing = e.seekDirX(player);
    e.vx = clamp(e.vx + e.ai1 * acc, -max, max);
    let dy = player ? player.cy - e.cy : 0;
    let step = yStep;
    if (Math.abs(dy) > yClamp) { step = 15; dy = clamp(dy, -yClamp, yClamp); }
    e.vy = (e.vy * (step - 1) + dy) / step;
    const dpx = player ? player.cx - e.cx : 0;
    if ((e.ai1 > 0 && dpx < -range) || (e.ai1 < 0 && dpx > range)) {
      e.ai0 = 2;
      e.ai1 = player && e.cy + 20 > player.cy ? -1 : 1;  // :37725-37729
    }
  } else if (e.ai0 === 2) {
    // 竖摆:vy += ai[1]*0.4/0.3,超速 5/7 ×0.95/0.9;|vx|<1 → 3
    const acc = big ? 0.3 : 0.4, cap = big ? 7 : 5, damp = big ? 0.9 : 0.95;
    e.vy += e.ai1 * acc;
    if (Math.hypot(e.vx, e.vy) > cap) { e.vx *= damp; e.vy *= damp; }
    if (e.vx > -1 && e.vx < 1) {
      if (player) e.facing = e.seekDirX(player);
      e.ai0 = 3; e.ai1 = e.facing;
    }
  } else if (e.ai0 === 3) {
    // 回掠:vx += ai[1]*0.4/0.6,纵轴追玩家 ±0.2/0.3,超速 ×0.95/0.9;|vy|<1 → 0
    const acc = big ? 0.6 : 0.4, vyAcc = big ? 0.3 : 0.2;
    const cap = big ? 7 : 5, damp = big ? 0.9 : 0.95;
    e.vx += e.ai1 * acc;
    if (player) e.vy += e.cy > player.cy ? -vyAcc : vyAcc;
    if (Math.hypot(e.vx, e.vy) > cap) { e.vx *= damp; e.vy *= damp; }
    if (e.vy > -1 && e.vy < 1) {
      if (player) e.facing = e.seekDirX(player);
      e.ai0 = 0; e.ai1 = e.facing;
    }
  }
  if (big) game.spawnParticles(e.cx, e.cy, '#5A2BA0', 1, 0.6, { life: 16 });   // :37832-37843（1457）
  fly(e);
}

// ---------------------------------------------------------------------------
// AI_087 珍稀四宝箱怪 473-476(NPC.cs:37845-38200——★BJ206 2026-09-20 行号重锚:
//   旧注 :39520-39875 系 1456 代际,态锚全部 +Δ 后逐条随修复重锚)
// 0 伪装箱(唤醒:有速度/受击/玩家 80px)→ 1 蓄力 36t → 2 贴地跳扑主循环;
// 2 每 210t 随机 3 蓄能无敌 180t(弹反 expert 门,态3 本体全难度可达=R23b-F3)/
//   4 飞天俯冲/6 三连扑;
// 跳扑参数按血量:等待 15+30×HP比、横速 3+4×(1-HP比)、跳力 4(+2 无视线),
// 每 3 跳(ai[3])双倍跳力/半横速;7 玩家死→零伤满血渐隐+defense=9999;
// 8 十周年炮连发不可达。
// ---------------------------------------------------------------------------
export function bigMimicAI(e: Enemy, game: GameHooks, player: Player | null) {
  if (e.ai0 < 0 || e.ai0 > 8) { e.ai0 = 0; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0; }
  // reflectsProjectiles 每 tick 复位（1457 :37851——aiStyle87 头段恒写 false,
  // 态3 专家支再置真；旧注"原版闩锁不清=离态后仍置位"系对 1456 行段的误读,
  // 台账批按 1458 真值改为逐拍复位+全弹扫描,见下方态3 段）
  e.reflectsProjectiles = false;
  // ★BJ175（2026-09-20 用户实报"宝箱怪武器无伤,子弹穿透而过"）：头段缺两行
  //   复位——vanilla aiStyle87 头 :37848 `dontTakeDamage = false;` / :37849
  //   `noTileCollide = false;` 每 tick 重写（旗标只在态3 体 :37967 置真,出态即
  //   被头段清掉）。曾缺 → 首次蓄能态（ai0==3,210t 后 1/3 掷入）置真后永挂：
  //   dealContacts/Arrow 主命中环 dontTakeDamage 排除门 + Enemy.hurt 早退三面
  //   全拒 = 真实弹幕穿透、无飘值、不唤醒（探针 _mimic-hitchring-probe S3 实证：
  //   出态后木箭 hpDelta=0 且 hurt 直驱返 false）。noTileCollide 本仓 AI 不置真,
  //   纯头段对齐零行为差,一并补。
  e.dontTakeDamage = false;
  e.noTileCollide = false;
  // noGravity 运行时位（1457 :37850 恒写 false；4/4.1 俯冲分支/5 空中态置 true——
  // 4.1 仅"未过玩家 Y 且 ai[2]==0 的真俯冲段"(:38056-38061,★BJ206 重锚)，过顶回落段 false）。
  // StrikeNPC :82217 受击档（def.flying=false 覆盖不到，2026-08-17 补）
  e.noGravity = false;
  // knockBackResist 运行时位（★BJ206 2026-09-20 [F-C]+[F-A]）：原版头段 :37847 每拍
  //   写 knockBackResist = GetKnockbackMultiplier_ScaledByDifficulty(0.2f)（NPC.cs:7058
  //   = 0.2×难度系数）——每拍覆写 SetDefaults 0.1f（:14547,ScaleStats :687 已按难度
  //   缩放的 def 档）。旧实现非零态落 null→def(0.1×K) 恰为原版半额。4/4.1/5 三态
  //   体（:37987/:38035+:38060/:38081）与态 6 体（:38101 ★[F-A] 补）头写后恒置 0；
  //   态 2 空中支（:37925 ★[F-B] 补）同置 0（写点在下方态 2 分支内）。
  e.kbResistOverride = (e.ai0 === 4 || e.ai0 === 4.1 || e.ai0 === 5 || e.ai0 === 6)
    ? 0 : getKnockbackMultiplierScaledByDifficulty(0.2, e.difficulty);
  const p = player && !player.dead ? player : null;
  const los = !!p && losClear(game, e.cx, e.cy, p.cx, p.cy);
  // ---- 玩家全灭 → 7 隐身僵坐(:37853-37861) ----
  if (e.ai0 !== 7 && !p) { e.ai0 = 7; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0; }
  const grounded = () => {
    e.vy = Math.min(e.vy + ENEMY_GRAVITY, MAX_FALL_SPEED);
    moveAndCollide(e, game.world, e.vx, e.vy);
  };

  if (e.ai0 === 0) {
    // ---- 伪装(:37864-37874) ----
    if (p) e.facing = e.seekDirX(p);
    const near = !!p && Math.hypot(p.cx - e.cx, p.cy - e.cy) < 80;
    if (e.vx !== 0 || e.vy > 100 || e.justHit || near) { e.ai0 = 1; e.ai1 = 0; }
    grounded();
  } else if (e.ai0 === 1) {
    // ---- 蓄力 36t(:37875-37884) ----
    e.ai1 += 1;
    if (e.ai1 > 36) { e.ai0 = 2; e.ai1 = 0; }
    grounded();
  } else if (e.ai0 === 2) {
    // ---- 贴地跳扑主循环(:37885-37965) ----
    if (p && Math.hypot(p.cx - e.cx, p.cy - e.cy) > 600) { e.ai0 = 5; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0; }
    if (e.onGround && e.vy === 0) {
      if (p) e.facing = e.seekDirX(p);
      e.vx *= 0.85;
      e.ai1 += 1;
      const hpFrac = e.hp / e.maxHp;
      const wait = 15 + 30 * hpFrac;                       // num1409
      let jumpV = 3 + 4 * (1 - hpFrac);                    // num1410
      let jumpPow = los ? 4 : 6;                           // num1411(+2 无视线)
      if (e.ai1 > wait) {
        e.ai3 += 1;
        if (e.ai3 >= 3) { e.ai3 = 0; jumpPow *= 2; jumpV /= 2; }   // :37908-37916 每 3 跳大跳
        e.ai1 = 0;
        e.vy -= jumpPow;
        e.vx = jumpV * e.facing;
      }
    } else {
      e.kbResistOverride = 0;                              // ★BJ206 [F-B] 空中支 knockBackResist=0f（:37925）
      e.vx *= 0.99;                                        // :37926-37933 空中保底 ±1
      if (e.facing === -1 && e.vx > -1) e.vx = -1;
      else if (e.facing === 1 && e.vx < 1) e.vx = 1;
    }
    e.ai2 += 1;                                            // :37935-37956 210t 随机换招
    if (e.ai2 > 210 && e.onGround && e.vy === 0) {
      const pick = rnd(3);
      e.ai0 = pick === 0 ? 3 : pick === 1 ? 4 : 6;
      if (pick === 1) e.vy = -8;                           // 4 号态起跳穿墙
      e.ai1 = 0; e.ai2 = 0; e.ai3 = 0;
    }
    grounded();
  } else if (e.ai0 === 3) {
    // ---- 蓄能无敌 180t（1457 :37966-37982）。★R23b-F3 修：态 3 由 roll pick==0
    //      全难度进入（:37941），「expert 弹反不可达」注释系误读——只有弹反是 expert 门；
    //      且 dontTakeDamage 改真旗标（iframes 近似被 pierce===1 单发弹绕过）——
    //      ★BJ175：旗标仅态3 体内有效,出态由函数头 :37848 复位（曾缺=离态永挂无敌,
    //      真实弹幕整面穿透,见头段 BJ175 注）。
    // ★台账批：反射管线两路接全——①每 tick ReflectProjectiles(Hitbox) 全弹扫描
    //   （:37979 NPC.ReflectProjectiles :67156-67165 → ReflectProjectile :67189-67212
    //   反向归属：reflected/hostile=true、速度=随机向×原速+朝主×20 归一×原速、
    //   damage÷2÷2、penetrate=1——projTargets.reflectProjectile 已是同构移植），
    //   覆盖玩家投射物桶内一切 CanBeReflected 命中盒相交弹（旧实现仅 Arrow 类
    //   弹幕命中沿触发）；②reflectsProjectiles 置真供 Damage() 管道侧命中即反
    //   （:12781-12791 flag6 分支），复位见函数头（:37851 逐拍 false，闩锁不清登记作废）----
    e.vx *= 0.85;
    e.dontTakeDamage = true;
    e.ai1 += 1;
    if (e.ai1 >= 180) { e.ai0 = 2; e.ai1 = 0; }
    if (expertMode(game)) {
      reflectPlayerProjsInHitbox(game, e);                // :37979
      e.reflectsProjectiles = true;                       // :37980
    }
    grounded();
  } else if (e.ai0 === 4) {
    // ---- 飞天(:37983-38032):悬玩家上方 350px → ai[2]=1 短瞄 6t → 4.1 俯冲 ----
    e.noGravity = true;                                    // :37986 整态置位（noTileCollide :37985/kbResist :37987）
    if (p) e.facing = e.vx < 0 ? -1 : 1;
    const dx = p ? p.cx - e.cx : e.facing * 100;
    const dy = (p ? p.cy : e.cy) - 350 - e.cy;
    if (e.ai2 === 1) {
      // :38001-38014 短瞄段【重算】目标 = 玩家中心（不带 -350 抬升——曾复用上方
      // 偏移向量，短瞄/俯冲全打向玩家头顶 350px 处）
      e.ai1 += 1;
      const adx = p ? p.cx - e.cx : dx, ady = p ? p.cy - e.cy : dy;
      const d = Math.hypot(adx, ady) || 1;
      const tx = (adx / d) * 8, ty = (ady / d) * 8;
      e.vx = (e.vx * 4 + tx) / 5; e.vy = (e.vy * 4 + ty) / 5;
      if (e.ai1 > 6) { e.ai0 = 4.1; e.ai1 = 0; e.ai2 = 0; e.vx = tx; e.vy = ty; }
    } else if (p && Math.abs(e.cx - p.cx) < 40 && e.cy < p.cy - 300) {
      e.ai1 = 0; e.ai2 = 1;
    } else {
      const d = Math.hypot(dx, dy) || 1;
      e.vx = (e.vx * 5 + (dx / d) * 12) / 6;
      e.vy = (e.vy * 5 + (dy / d) * 12) / 6;
    }
    fly(e);
  } else if (e.ai0 === 4.1) {
    // ---- 俯冲下坠(:38033-38067):过玩家 Y 或弹起 → 10t 后回 2(埋块则 5) ----
    // ★R23b-F4 修:原版三处均 Collision.SolidCollision(包围盒与任一实心重叠=ANY),
    // 曾用 inSolidBody(全格实心=ALL)= 部分嵌墙时该走态5 穿墙归位却回态2 贴地跳扑可卡地形
    if (e.ai2 === 0 && p && losClear(game, e.cx, e.cy, p.cx, p.cy) && !touchesSolid(game, e)) e.ai2 = 1;
    if (!p || e.y + e.h >= p.y || e.vy <= 0) {
      e.ai1 += 1;
      if (e.ai1 > 10) {
        e.ai0 = touchesSolid(game, e) ? 5 : 2;
        e.ai1 = 0; e.ai2 = 0; e.ai3 = 0;
      }
    } else if (e.ai2 === 0) {
      e.noGravity = true;                                 // :38056-38061 真俯冲段（穿墙;noTileCollide :38058/kbResist :38060）
    }
    e.vy = Math.min(e.vy + 0.2, 16);                      // :38062-38066 重力在分支后恒施
    // 位移：真俯冲段（noGravity）穿墙直积分；其余（含 ai2==1 下落段）走碰撞——
    // 曾漏 ai2==1 且未过玩家 Y 的分支积分，该态整帧冻结 = 空中僵死
    if (e.noGravity) fly(e);
    else moveAndCollide(e, game.world, e.vx, e.vy);
  } else if (e.ai0 === 5) {
    // ---- 穿墙归位(:38068-38098):追玩家,近 200px 且不埋块 → 回 2 ----
    e.noGravity = true;                                    // :38080 整态置位（noTileCollide :38079/kbResist :38081）
    if (p) e.facing = e.vx > 0 ? 1 : -1;
    let dx = p ? p.cx - e.cx : 0, dy = (p ? p.cy : e.cy) - 4 - e.cy;
    if (p && Math.hypot(dx, dy) < 200 && !touchesSolid(game, e)) {   // SolidCollision(:38083)
      e.ai0 = 2; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0;
    }
    const d = Math.hypot(dx, dy);
    if (d > 10) { dx = (dx / d) * 10; dy = (dy / d) * 10; }
    e.vx = (e.vx * 4 + dx) / 5; e.vy = (e.vy * 4 + dy) / 5;
    fly(e);
  } else if (e.ai0 === 6) {
    // ---- 三连扑(:38099-38164):每 5t 起跳(玩家越高/无视线 跳力越高),vx=12×dir ----
    if (e.onGround && e.vy === 0) {
      if (p) e.facing = e.seekDirX(p);
      e.vx *= 0.8;
      e.ai1 += 1;
      if (e.ai1 > 5) {
        e.ai1 = 0;
        e.vy -= 4;
        if (p && p.y + p.h < e.cy) e.vy -= 1.25;
        if (p && p.y + p.h < e.cy - 40) e.vy -= 1.5;
        if (p && p.y + p.h < e.cy - 80) e.vy -= 1.75;
        if (p && p.y + p.h < e.cy - 120) e.vy -= 2;
        if (p && p.y + p.h < e.cy - 160) e.vy -= 2.25;
        if (p && p.y + p.h < e.cy - 200) e.vy -= 2.5;
        if (p && !losClear(game, e.cx, e.cy, p.cx, p.cy)) e.vy -= 2;
        e.vx = 12 * e.facing;
        e.ai2 += 1;
      }
    } else {
      e.vx *= 0.98;                                       // :38144-38153 空中保底 ±8
      if (e.facing === -1 && e.vx > -8) e.vx = -8;
      else if (e.facing === 1 && e.vx < 8) e.vx = 8;
    }
    if (e.ai2 >= 3 && e.onGround && e.vy === 0) {         // :38156-38163
      e.ai0 = 2; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0;
    }
    grounded();
  } else if (e.ai0 === 7) {
    // ---- 玩家死隐身僵坐(:38165-38174):零伤/满血/防9999/渐隐,离屏由 despawn 清 ----
    e.def.damage = 0;
    e.hp = e.maxHp;
    e.def.defense = 9999;   // ★BJ206 [F-D]：defense=9999（:38169,全玩家死亡才达态,微阶）
    e.spawnAlpha = Math.min(255, e.spawnAlpha + 7);
    e.vx *= 0.98;
    grounded();
  } else if (e.ai0 === 8) {
    // ---- 十周年世界炮连发(:38175-38196,getGoodWorld 不可达) ----
    e.vx *= 0.85;
    e.ai1 += 1;
    if (e.ai1 >= 180) { e.ai0 = 2; e.ai1 = 0; }
    grounded();
  }
}

// ---------------------------------------------------------------------------
// AI_088 飞蛾魔 477(NPC.cs:38201-38731)——日食限定
// -1 无日食/玩家失效爬升无敌 / 0 悬顶 200px 伺服(180t 轮换,受击加速) /
// 1 穿墙追击 / 2 近距缠斗(×0.5 伤,LOS 断→0) / 3+3.1+3.2 侧掠冲刺(×1.3 伤) /
// 4+4.1+4.2 扫地产卵 478(478+479<7 时;专家孵化 70→52t,不可达)
// ---------------------------------------------------------------------------
export function mothronAI(e: Enemy, game: GameHooks, player: Player | null) {
  const p = player && !player.dead ? player : null;
  const baseDmg = e.vanilla?.damage ?? e.def.damage;
  e.def.damage = baseDmg;                                 // :38206 damage=defDamage
  const eggCap = 7;                                       // num1412

  // 原版 ai[0] 出生 0,Enemy 哨兵 -1120 归一
  if (e.ai0 < -1 || e.ai0 > 4.2) e.ai0 = 0;
  // ---- 日食/目标门(:38207-38240) ----
  if (!game.world.clock.eclipse) {
    if (e.ai0 !== -1) e.ai0 = -1;
  } else if (!p) {
    e.ai0 = -1;                                           // :38220 目标死亡 → 爬升脱战
  } else if (Math.hypot(p.cx - e.cx, p.cy - e.cy) > 3000) {
    e.ai0 = -1;                                           // :38220 vector247.Length() > 3000 → 爬升脱战
  } else if (e.ai0 > 1 && Math.hypot(p.cx - e.cx, p.cy - e.cy) > 1000) {
    e.ai0 = 1;                                            // :38231-38238 远距穿墙贴近
  }

  if (e.ai0 === -1) {
    // ---- 爬升离场(:38242-38246) ----
    e.vx = (e.vx * 9) / 10; e.vy = (e.vy * 9 - 8) / 10;
    e.iframes = 2;
    fly(e);
    return;
  }
  if (!p) { fly(e); return; }

  if (e.ai0 === 0) {
    // ---- 悬顶伺服(:38248-38313):目标=玩家上方 200px;>800px→1,>80px 追,近距微调 ----
    e.facing = e.cx < p.cx - 2 ? 1 : e.cx > p.cx + 2 ? -1 : e.facing;
    e.spin = (e.spin * 9 + e.vx * 0.1) / 10;
    const preVx = e.vx, preVy = e.vy;
    moveAndCollide(e, game.world, e.vx, e.vy);
    bounceAxis(e, preVx, preVy);
    let dx = p.cx - e.cx, dy = p.cy - 200 - e.cy;
    const d = Math.hypot(dx, dy);
    if (d > 800) { e.ai0 = 1; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0; }
    else if (d > 80) {
      e.vx = (e.vx * 29 + (dx / d) * 6) / 30;
      e.vy = (e.vy * 29 + (dy / d) * 6) / 30;
    } else if (Math.hypot(e.vx, e.vy) > 2) { e.vx *= 0.95; e.vy *= 0.95; }
    else if (Math.hypot(e.vx, e.vy) < 1) { e.vx *= 1.05; e.vy *= 1.05; }
    // ---- 180t 轮换(:38328-38348):受击 +10..30;同 tick 重摇选招 ----
    // ★台账批：原版为 `while (ai[0]==0f)` 重摇循环——掷 0 无视线/掷 2 卵满时不落招,
    // 同 tick 反复重掷直至得招；曾"单帧一次近似"会把无效轮空成整轮 180t 再选。
    e.ai1 += 1;
    if (e.justHit) e.ai1 += rndRange(10, 30);
    if (e.ai1 < 180) return;
    e.ai1 = 0; e.ai2 = 0; e.ai3 = 0;
    let guard = 0;
    while (e.ai0 === 0 && guard++ < 100) {                // :38328（护栏防掷序病态长转）
      const pick = rnd(3);
      if (pick === 0) {
        // num1305==0 支：CanHitLine 命中才落态2；未命中落空（switch case0 无
        // 赋值）——不得串入卵量支，否则"无视线"被误转扫地产卵（本轮实测钉出）
        if (losClear(game, e.cx, e.cy, p.cx, p.cy)) e.ai0 = 2;
        continue;                                         // :38334
      }
      if (pick === 1) e.ai0 = 3;                          // case1 直落侧掠
      else if (countNpc(game, 478) + countNpc(game, 479) < eggCap) e.ai0 = 4;  // case2 卵量门
    }
    return;
  }
  if (e.ai0 === 1) {
    // ---- 穿墙追击(:38319-38353):7+距/100 速,近 300px 且不埋块 → 0 ----
    let dx = p.cx - e.cx, dy = p.cy - e.cy;
    const d = Math.hypot(dx, dy);
    if (d < 300 && !touchesSolid(game, e)) { e.ai0 = 0; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0; }
    const spd = 7 + d / 100;
    e.vx = (e.vx * 24 + (dx / (d || 1)) * spd) / 25;
    e.vy = (e.vy * 24 + (dy / (d || 1)) * spd) / 25;
    e.facing = e.vx < 0 ? -1 : 1;
    e.spin = (e.spin * 9 + e.vx * 0.08) / 10;
    fly(e);
    return;
  }
  if (e.ai0 === 2) {
    // ---- 近距缠斗(:38355-38416):×0.5 伤;4+ai[2]+距/120 速递增;240t 或断视线 → 0 ----
    e.def.damage = Math.round(baseDmg * 0.5);
    if (p.cx - 10 < e.cx) e.facing = -1;
    else if (p.cx + 10 > e.cx) e.facing = 1;
    e.spin = (e.spin * 4 + e.vx * 0.1) / 5;
    const preVx = e.vx, preVy = e.vy;
    moveAndCollide(e, game.world, e.vx, e.vy);
    bounceAxis(e, preVx, preVy);
    const dx = p.cx - e.cx, dy = p.cy - 20 - e.cy;
    e.ai2 += 1 / 45;
    if (expertMode(game)) e.ai2 += 1 / 60;   // :38435-38438
    const d = Math.hypot(dx, dy);
    const spd = 4 + e.ai2 + d / 120;
    e.vx = (e.vx * 19 + (dx / (d || 1)) * spd) / 20;
    e.vy = (e.vy * 19 + (dy / (d || 1)) * spd) / 20;
    e.ai1 += 1;
    if (e.ai1 > 240 || !losClear(game, e.cx, e.cy, p.cx, p.cy)) {
      e.ai0 = 0; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0;
    }
    return;
  }
  if (e.ai0 === 3 || e.ai0 === 3.1 || e.ai0 === 3.2) {
    // ---- 侧掠冲刺(:38418-38541) ----
    if (e.ai0 === 3) {
      // 拉开 400px 侧位(8+ai[1] 速),横距>350 且纵差<20 → 3.1
      let dx = p.cx - e.cx, dy = p.cy - 12 - e.cy;
      if (e.cx > p.cx) dx += 400; else dx -= 400;
      if (Math.abs(e.cx - p.cx) > 350 && Math.abs(e.cy - p.cy) < 20) { e.ai0 = 3.1; e.ai1 = 0; }
      e.ai1 += 1 / 30;
      const d = Math.hypot(dx, dy);
      const spd = 8 + e.ai1;
      e.vx = (e.vx * 3 + (dx / (d || 1)) * spd) / 4;
      e.vy = (e.vy * 3 + (dy / (d || 1)) * spd) / 4;
    } else if (e.ai0 === 3.1) {
      // 10t 瞄准(16 速贴脸) → 3.2 定向冲
      const dx = p.cx - e.cx, dy = p.cy - 12 - e.cy;
      const d = Math.hypot(dx, dy);
      e.vx = (e.vx * 7 + (dx / (d || 1)) * 16) / 8;
      e.vy = (e.vy * 7 + (dy / (d || 1)) * 16) / 8;
      e.facing = e.vx < 0 ? -1 : 1;
      e.spin = (e.spin * 4 + e.vx * 0.07) / 5;
      e.ai1 += 1;
      if (e.ai1 > 10) {
        e.ai0 = 3.2; e.ai1 = e.facing;
        e.vx = (dx / (d || 1)) * 16; e.vy = (dy / (d || 1)) * 16;
      }
    } else {
      // 直冲(16+ai[2] 速 ×1.3 伤),过玩家 260px 且不埋块 → 0;埋块且 >800px → 1
      e.def.damage = Math.round(baseDmg * 1.3);
      e.ai2 += 1 / 30;
      e.vx = (16 + e.ai2) * e.ai1;
      if ((e.ai1 > 0 && e.cx > p.cx + 260) || (e.ai1 < 0 && e.cx < p.cx - 260)) {
        if (!touchesSolid(game, e)) { e.ai0 = 0; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0; }
        else if (Math.abs(e.cx - p.cx) > 800) { e.ai0 = 1; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0; }
      }
      e.spin = (e.spin * 4 + e.vx * 0.07) / 5;
    }
    fly(e);
    return;
  }
  // ---- 扫地产卵(:38543-38729) ----
  if (e.ai0 === 4) {
    // 玩家周身 ±30/±20 格随机落点(越扫越宽),下潜 50 格找实心面,600px 内 → 4.1
    e.ai0 = 0; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0;
    const aboveGround = e.cy / TILE < game.world.groundLevel;
    const ptx = Math.floor(p.cx / TILE), pty = Math.floor(p.cy / TILE);
    const st = game.world.store;
    for (let k = 0; k < 1000; k++) {
      const rx = 30 + Math.floor(k / 50), ry = 20 + Math.floor(k / 75);
      let tx = ptx + rndRange(-rx, rx + 1);
      let ty = pty + rndRange(-ry, ry + 1);
      if (solidTileAt(game, tx, ty)) continue;
      let bad = false;
      let n = 50;
      while (n > 0) {
        n--;
        if (tx < 5 || ty < 5 || tx >= st.w - 5 || ty >= st.h - 5) { bad = true; break; }
        const ii = st.idx(tx, ty);
        if (st.liquid[ii] > 0 && st.liquidType[ii] === 2) { bad = true; break; }   // 岩浆
        const iiA = st.idx(tx, ty - 1);
        if (st.liquid[iiA] > 0 && st.liquidType[iiA] === 2) { bad = true; break; }
        if (solidTileAt(game, tx, ty) || (aboveGround && ty > game.world.groundLevel)) break;
        ty++;
      }
      if (n <= 0 || bad) continue;
      if (Math.hypot(tx * TILE + 8 - p.cx, ty * TILE + 8 - p.cy) >= 600) continue;
      e.ai0 = 4.1; e.ai1 = tx; e.ai2 = ty;
      break;
    }
    return;
  }
  if (e.ai0 === 4.1) {
    // 飞向落点(6+距/150 封顶 10 速),<10px → 4.2
    e.facing = e.vx < -2 ? -1 : e.vx > 2 ? 1 : e.facing;
    e.spin = (e.spin * 9 + e.vx * 0.1) / 10;
    const gx = e.ai1 * TILE + 8, gy = e.ai2 * TILE - 20;
    const dx = gx - e.cx, dy = gy - e.cy;
    const d = Math.hypot(dx, dy);
    const spd = Math.min(6 + d / 150, 10);
    if (d < 10) { e.ai0 = 4.2; e.ai3 = 0; }
    e.vx = (e.vx * 9 + (dx / (d || 1)) * spd) / 10;
    e.vy = (e.vy * 9 + (dy / (d || 1)) * spd) / 10;
    const vl = Math.hypot(e.vx, e.vy);
    if (vl > spd) { e.vx = (e.vx / vl) * spd; e.vy = (e.vy / vl) * spd; }
    fly(e);
    return;
  }
  // 4.2 悬停产卵(:38682-38729):70t(专家 52)产 478,140t 收工(2/3 概率续扫)
  e.spin = (e.spin * 9 + e.vx * 0.1) / 10;
  const gx = e.ai1 * TILE + 8, gy = e.ai2 * TILE - 20;
  let dx = gx - e.cx, dy = gy - e.cy;
  const d = Math.hypot(dx, dy);
  if (d < 4) {
    // (int) 截断 =52(R23b-F6:Math.round 曾得 53)
    const hatchT = expertMode(game) ? Math.trunc(70 * 0.75) : 70;   // :38692-38695 ×0.75
    e.ai3 += 1;
    if (e.ai3 === hatchT) {
      const egg = spawnPart(game, e, 478);
      if (egg) { egg.x = e.ai1 * TILE + 8 - egg.w / 2; egg.y = e.ai2 * TILE - egg.h; egg.bInit = true; }
    } else if (e.ai3 === hatchT * 2) {
      e.ai0 = 0; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0;
      if (countNpc(game, 478) + countNpc(game, 479) < eggCap && rnd(3) !== 0) e.ai0 = 4;
      else if (touchesSolid(game, e)) e.ai0 = 1;
    }
  }
  if (d > 4) { dx = (dx / d) * 4; dy = (dy / d) * 4; }
  e.vx = (e.vx + dx) / 2;
  e.vy = (e.vy + dy) / 2;
  const vl = Math.hypot(e.vx, e.vy);
  if (vl > 4) { e.vx = (e.vx / vl) * 4; e.vy = (e.vy / vl) * 4; }
  fly(e);
}

// ---------------------------------------------------------------------------
// AI_089 蛾卵 478(NPC.cs:38732-38774)
// 900t(专家 600)孵化 → Transform 479;受击 -10..20(普通双扣);末期 75% 起抽搐跳。
// ---------------------------------------------------------------------------
export function mothronEggAI(e: Enemy, game: GameHooks, _player: Player | null) {
  const hatchT = expertMode(game) ? 600 : 900;             // num1330（:38745）
  // 仅归一哨兵 -1120（原版 ai[0] 出生 0）——受击扣减（:38751-38754，普通双扣
  // 10..20×2）可把进度推入负值推迟孵化，负值必须跨帧保留；
  // 曾用 `ai0<0 → 0` 把负进度每帧清零 = 受击扣减永不生效
  if (e.ai0 === -1120) e.ai0 = 0;
  if (e.vy === 0) {
    e.vx *= 0.9;
    e.spin += e.vx * 0.02;
  } else {
    e.vx *= 0.99;
    e.spin += e.vx * 0.04;
  }
  if (e.justHit) {                                        // :38744-38750
    e.ai0 -= rndRange(10, 21);
    if (!expertMode(game)) e.ai0 -= rndRange(10, 21);      // :38752
  }
  e.ai0 += 1;
  if (e.ai0 >= hatchT) {
    e.transformTo(479, game.world.store, false, game);   // :38753 Transform(479)
    return;
  }
  if (e.vy === 0 && Math.abs(e.vx) < 0.2 && e.ai0 >= hatchT * 0.75) {
    // :38756-38770 末期抽搐:越接近孵化越频繁的随机跳
    const k = (e.ai0 - hatchT * 0.75) / (hatchT * 0.25);
    if (rndRange(-10, 120) < k * 100) {
      e.vy -= rndRange(20, 40) * 0.025;
      e.vx += rndRange(-20, 20) * 0.025;
      e.vx *= 1 + k * 2; e.vy *= 1 + k * 2;
    }
  }
  e.vy = Math.min(e.vy + ENEMY_GRAVITY, MAX_FALL_SPEED);
  moveAndCollide(e, game.world, e.vx, e.vy);
}

// ---------------------------------------------------------------------------
// AI_090 幼蛾 479(NPC.cs:38775-39010)——日食限定
// 无日食 → EncourageDespawn(5)+上浮;-1 爬升无敌 / 0 悬停(90t→2,同族排斥)/
// 1 穿墙追击(近 300px → 0)/ 2+2.1 贴脸冲撞(9 速,45t 后埋块判 0/1)
// ---------------------------------------------------------------------------
export function babyMothronAI(e: Enemy, game: GameHooks, player: Player | null) {
  const p = player && !player.dead ? player : null;
  e.spin = (e.spin * 9 + e.vx * 0.1) / 10;                // :38781
  // 原版 ai[0] 出生 0,Enemy 哨兵 -1120 归一
  if (e.ai0 < -1 || e.ai0 > 2.1) e.ai0 = 0;
  if (!game.world.clock.eclipse) {                              // :38783-38792
    e.encourageDespawn(5);
    e.vy = Math.max(e.vy - 0.2, -8);
    fly(e);
    return;
  }
  // ---- 同族排斥(状态 0/1,:38794-38816) ----
  if (e.ai0 === 0 || e.ai0 === 1) {
    for (const n of enemies(game)) {
      if (n === e || n.dead || n.vanillaId !== e.vanillaId) continue;
      let dx = n.cx - e.cx, dy = n.cy - e.cy;
      const d = Math.hypot(dx, dy);
      if (d >= e.w + e.h || d === 0) continue;
      dx = (dx / d) * -0.1; dy = (dy / d) * -0.1;
      e.vx += dx; e.vy += dy;
      n.vx -= dx; n.vy -= dy;
    }
  }
  // ---- 目标门(:38810-38826) ----
  if (!p) e.ai0 = -1;                                     // :38814 目标死亡 → 爬升
  else if (Math.hypot(p.cx - e.cx, p.cy - e.cy) > 3000) e.ai0 = -1;   // :38814 >3000px → 爬升脱战
  else if (e.ai0 > 1 && Math.hypot(p.cx - e.cx, p.cy - e.cy) > 1000) e.ai0 = 1;

  if (e.ai0 === -1) {
    // ---- 爬升(:38836-38840) ----
    e.vx = (e.vx * 9) / 10; e.vy = (e.vy * 9 - 8) / 10;
    e.iframes = 2;
    fly(e);
    return;
  }
  if (!p) { fly(e); return; }

  if (e.ai0 === 0) {
    // ---- 悬停(:38842-38902):>800px→1 / >200px 追(5.5+距/100+ai[1]/15)/ 近距微调;90t→2 ----
    const preVx = e.vx, preVy = e.vy;
    moveAndCollide(e, game.world, e.vx, e.vy);
    bounceAxis(e, preVx, preVy);
    const dx = p.cx - e.cx, dy = p.cy - e.cy;
    const d = Math.hypot(dx, dy);
    if (d > 800) { e.ai0 = 1; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0; }
    else if (d > 200) {
      const spd = 5.5 + d / 100 + e.ai1 / 15;
      e.vx = (e.vx * 39 + (dx / d) * spd) / 40;
      e.vy = (e.vy * 39 + (dy / d) * spd) / 40;
    } else if (Math.hypot(e.vx, e.vy) > 2) { e.vx *= 0.95; e.vy *= 0.95; }
    else if (Math.hypot(e.vx, e.vy) < 1) { e.vx *= 1.05; e.vy *= 1.05; }
    e.ai1 += 1;
    if (e.ai1 >= 90) { e.ai1 = 0; e.ai0 = 2; }
    return;
  }
  if (e.ai0 === 1) {
    // ---- 穿墙追击(:38904-38938):5.5+ai[2]+距/150 速;近 300px 且不埋块 → 0 ----
    const dx = p.cx - e.cx, dy = p.cy - e.cy;
    const d = Math.hypot(dx, dy);
    if (d < 300 && !touchesSolid(game, e)) { e.ai0 = 0; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0; }
    e.ai2 += 1 / 60;
    const spd = 5.5 + e.ai2 + d / 150;
    e.vx = (e.vx * 34 + (dx / (d || 1)) * spd) / 35;
    e.vy = (e.vy * 34 + (dy / (d || 1)) * spd) / 35;
    e.facing = e.vx < 0 ? -1 : 1;
    e.spin = (e.spin * 9 + e.vx * 0.08) / 10;
    fly(e);
    return;
  }
  if (e.ai0 === 2) {
    // ---- 贴脸瞄准 10t(9 速,:38940-38977) → 2.1 定向冲 ----
    const dx = p.cx - e.cx, dy = p.cy - 8 - e.cy;
    const d = Math.hypot(dx, dy);
    e.facing = e.vx < 0 ? -1 : 1;
    e.spin = (e.spin * 7 + e.vx * 0.1) / 8;
    e.vx = (e.vx * 7 + (dx / (d || 1)) * 9) / 8;
    e.vy = (e.vy * 7 + (dy / (d || 1)) * 9) / 8;
    e.ai1 += 1;
    if (e.ai1 > 10) {
      e.ai0 = 2.1; e.ai1 = 0;
      e.vx = (dx / (d || 1)) * 9; e.vy = (dy / (d || 1)) * 9;
    }
    fly(e);
    return;
  }
  // ---- 2.1 冲刺(:38979-39007):×1.01/t 增速;45t 后不埋块→0,埋块且 90t→1 ----
  e.facing = e.vx < 0 ? -1 : 1;
  e.vx *= 1.01; e.vy *= 1.01;
  e.ai1 += 1;
  if (e.ai1 > 45) {
    if (!touchesSolid(game, e)) { e.ai0 = 0; e.ai1 = 0; e.ai2 = 0; }
    else if (e.ai1 > 90) { e.ai0 = 1; e.ai1 = 0; e.ai2 = 0; }
  }
  fly(e);
}

/** 撞轴 ×(-旧速·0.5) 封顶 ±4(NPC.cs Mothron 族 collide 语义,:38258-38264) */
function bounceAxis(e: Enemy, preVx: number, preVy: number) {
  if (e.hitWall) { e.vx *= -preVx * 0.5; e.vx = clamp(e.vx, -4, 4); }
  if (e.hitHead || (e.onGround && preVy > 0)) { e.vy *= -preVy * 0.5; e.vy = clamp(e.vy, -4, 4); }
}

// ---------------------------------------------------------------------------
// AI_091 花岗岩元素 483(NPC.cs:39011-39195)
// AI 自置 noGravity=true(:39013)——全程无重力,碰撞按态开合:
// -1 受击石化 120t(专家限定,不可达)/ 0 视线判别→1 直追(2+距/200 速)/
// 2 穿墙冲刺(近 600px 且不埋块→0)/ 3 锚点侧移(1 速,撞轴/到点/通视线→0)/
// 4 漂移弹壁(1.5 速,180t 或通视线→0;每 5t 重试锚点)。
// 与 AI_085(星细胞族)同构五态寻路——aiStyle 85 的 1:1 内核在此。
// ---------------------------------------------------------------------------
export function graniteElementalAI(e: Enemy, game: GameHooks, player: Player | null) {
  const p = player && !player.dead ? player : null;
  const x = lunarLocalAI(e);
  // 原版 ai[0] 出生 0,Enemy 哨兵 -1120 归一(-1 石化态合法保留)
  if (e.ai0 !== -1 && (e.ai0 < 0 || e.ai0 > 4)) e.ai0 = 0;
  // noGravity 运行时位（:39013 起始 true / -1 石化态 :39024 置 false）——
  // StrikeNPC :82217 受击档（def.flying=false 覆盖不到，2026-08-17 补）
  // ---- 专家受击石化(:39017-39022) ----
  if (e.justHit && expertMode(game) && rnd(6) === 0) { e.ai0 = -1; e.ai1 = 0; }
  e.noGravity = e.ai0 !== -1;   // 转移 tick 即置 false（原版 -1 分支同 tick 生效）

  if (e.ai0 === -1) {
    // ---- 石化(:39024-39033) ----
    e.iframes = 2;
    e.vx *= 0.98;
    e.ai1 += 1;
    moveAndCollide(e, game.world, e.vx, e.vy);
    if (e.ai1 >= 120) { e.ai0 = 0; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0; }
    return;
  }
  if (!p) { moveAndCollide(e, game.world, e.vx, e.vy); return; }
  const los = losClear(game, e.cx, e.cy, p.cx, p.cy);

  if (e.ai0 === 0) {
    // ---- 视线判别(:39035-39077):通视线→1;否则找中转锚(玩家正上/正下列)→3;无→4 ----
    if (los) { e.ai0 = 1; return; }
    // 锚 1:玩家正上/正下列 (px, selfY)(:39047-39057)
    if (Math.abs(p.cx - e.cx) > 8 && losClear(game, e.cx, e.cy, p.cx, e.cy)) {
      e.ai0 = 3; e.ai1 = p.cx; e.ai2 = e.cy;
      // 命中再升级为 (selfX, playerY) 双段锚(:39059-39067)。★门用 vector264.Length()
      // 即列锚距 |ΔX|（原版字面复检 vector264 而非 center48−Center=|ΔY|——"行锚
      // 距离门拿列锚距"的层级笔误 1:1 保留，先例：石巨人砸火把 Y 上界用 width；
      // G11 定谳 2026-08-19：1405 无 aiStyle91（1.4.4+ 新增）无对读，按 1456 字面）
      if (Math.abs(p.cx - e.cx) > 8 && losClear(game, e.cx, e.cy, e.cx, p.cy)
        && losClear(game, e.cx, p.cy, p.x, p.y)) {
        e.ai1 = e.cx; e.ai2 = p.cy;
      }
    } else if (Math.abs(p.cy - e.cy) > 8 && losClear(game, e.cx, e.cy, e.cx, p.cy)) {
      e.ai0 = 3; e.ai1 = e.cx; e.ai2 = p.cy;              // :39069-39075 行锚
    }
    if (e.ai0 === 0) {
      // 无锚:直朝玩家轻推 0.5 → 4 漂移(:39069-39077)
      x[0] = 0;
      const dx = p.cx - e.cx, dy = p.cy - p.h / 4 - e.cy;
      const d = Math.hypot(dx, dy) || 1;
      e.vx += (dx / d) * 0.5; e.vy += (dy / d) * 0.5;
      e.ai0 = 4; e.ai1 = 0;
    }
  } else if (e.ai0 === 1) {
    // ---- 直追(:39079-39093):2+距/200 速(50 步进);断视线 → 0 ----
    const dx = p.cx - e.cx, dy = p.cy - e.cy;
    const d = Math.hypot(dx, dy);
    const spd = 2 + d / 200;
    e.vx = (e.vx * 49 + (dx / (d || 1)) * spd) / 50;
    e.vy = (e.vy * 49 + (dy / (d || 1)) * spd) / 50;
    moveAndCollide(e, game.world, e.vx, e.vy);
    if (!los) { e.ai0 = 0; e.ai1 = 0; }
    return;
  } else if (e.ai0 === 2) {
    // ---- 穿墙冲刺(:39095-39108):2 速;近 600px 且不埋块 → 0 ----
    const dx = p.cx - e.cx, dy = p.cy - e.cy;
    const d = Math.hypot(dx, dy);
    e.vx = (e.vx * 3 + (dx / (d || 1)) * 2) / 4;
    e.vy = (e.vy * 3 + (dy / (d || 1)) * 2) / 4;
    fly(e);
    if (d < 600 && !touchesSolid(game, e)) e.ai0 = 0;
    return;
  } else if (e.ai0 === 3) {
    // ---- 锚点侧移(:39110-39126):1 速(3 步进);撞轴→4;到点/超 800px/通视线→0 ----
    const dx = e.ai1 - e.cx, dy = e.ai2 - e.cy;
    const d = Math.hypot(dx, dy);
    e.vx = (e.vx * 2 + (dx / (d || 1)) * 1) / 3;
    e.vy = (e.vy * 2 + (dy / (d || 1)) * 1) / 3;
    const preVy = e.vy;
    moveAndCollide(e, game.world, e.vx, e.vy);
    if (e.hitWall || e.hitHead || (e.onGround && preVy > 0)) { e.ai0 = 4; e.ai1 = 0; }
    if (d < 1 || d > 800 || los) { e.ai0 = 0; }
    return;
  } else if (e.ai0 === 4) {
    // ---- 漂移弹壁(:39128-39179):1.5 速(20 步进);180t 或通视线 → 0 ----
    if (e.hitWall) e.vx *= -0.8;
    if (e.hitHead || e.onGround) e.vy *= -0.8;
    if (e.vx === 0 && e.vy === 0) {
      const dx = p.cx - e.cx, dy = p.cy - p.h / 4 - e.cy;
      const d = Math.hypot(dx, dy) || 1;
      e.vx = (dx / d) * 0.1; e.vy = (dy / d) * 0.1;
    }
    const v = Math.hypot(e.vx, e.vy) || 1;
    e.vx = (e.vx * 19 + (e.vx / v) * 1.5) / 20;
    e.vy = (e.vy * 19 + (e.vy / v) * 1.5) / 20;
    e.ai1 += 1;
    if (e.ai1 > 180 || los) { e.ai0 = 0; e.ai1 = 0; }
    moveAndCollide(e, game.world, e.vx, e.vy);
    // ---- 每 5t 重试中转锚(:39183-39195) ----
    x[0] += 1;
    if (x[0] >= 5 && !touchesSolid(game, e)) {
      x[0] = 0;
      // 先试列锚 (px, selfY)(需三方视线),再试行锚 (selfX, py)
      if (losClear(game, e.cx, e.cy, p.cx, e.cy) && losClear(game, p.cx, p.cy, p.cx, e.cy)) {
        e.ai0 = 3; e.ai1 = p.cx; e.ai2 = e.cy;
      } else if (losClear(game, e.cx, e.cy, e.cx, p.cy) && losClear(game, p.cx, p.cy, e.cx, p.cy)) {
        e.ai0 = 3; e.ai1 = e.cx; e.ai2 = p.cy;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 星璇塔四组专属怪批(aiStyle 85/95/96/97/99)——替换 Enemy.ts 一期近似档
// (swarmerAI/casterAI)。锚点:
//   aiStyle 85  星细胞 405 / 星云头蟹 421   NPC.cs:37292-37585(六态寻路+421 头顶吸附)
//   aiStyle 95  小星细胞 406                NPC.cs:39772-39819(300t 长大 → Transform 405)
//   aiStyle 96  水流入侵者 407(/408)        NPC.cs:39820-39862(悬顶伺服 + 投射物 539)
//   aiStyle 97  星云悬浮脑 420              NPC.cs:39863-40012(瞬移 + 环绕球 574 → 弹 576)
//   aiStyle 99  日耀黏液 519                NPC.cs:40324-40390(重力坠落 → 落地 5t 自爆)
// 勘误(1.4.5.6 全树核对):NPC 408 无任何 NewNPC/Transform 调用源——docs/
//   event-lunar-pillars.md §4"408 由投射物 539 生成"不成立;539 自身只绕 407 盘旋
//   210t 后以 16 速冲玩家、亡时 80×80 范围伤害(Projectile.cs:32040-32280/:69366-69405),
//   不生怪。407/408 共用 aiStyle 96,本实现对其一视同仁。
// ---------------------------------------------------------------------------

/** Collision.SolidCollision 近似(矩形内 ANY 实心)——收口到 solidRect 单一实现
 *  (R23b-L1 同批:同文件曾并存两套实心扫描) */
function touchesSolid(game: GameHooks, e: Enemy, inflate = 0): boolean {
  return solidRect(game,
    Math.floor((e.x - inflate) / TILE), Math.floor((e.x + e.w - 0.01 + inflate) / TILE),
    Math.floor((e.y - inflate) / TILE), Math.floor((e.y + e.h - 0.01 + inflate) / TILE));
}

/** 星细胞族尾段:405 旋转清零 / 421 旋转=vx×0.1(:37429-37444) + 同族排斥(:37431-37456) */
function starCellTail(e: Enemy, game: GameHooks, is405: boolean): void {
  if (is405) e.visAngle = 0;
  else e.visAngle = e.vx * 0.1;
  for (const n of enemies(game)) {
    if (n === e || n.dead || n.vanillaId !== e.vanillaId) continue;
    if (Math.abs(e.x - n.x) + Math.abs(e.y - n.y) < e.w) {
      e.vx += e.x < n.x ? -0.05 : 0.05;
      e.vy += e.y < n.y ? -0.05 : 0.05;
    }
  }
}

/** AI_085 星细胞 405 / 星云头蟹 421(NPC.cs:37292-37585)六态:
 *  0 视线判别(通→1;远 800→2;找中转锚→3;无→轻推入 4)/ 1 直追(5.5|8+距/100,50 步进)/
 *  2 穿墙(3|6 速,noTileCollide;近 600 且离实心→0)/ 3 锚点侧移(2|3 速,撞→4)/
 *  4 漂移弹壁(2|3 速,180t;每 5t 重试锚)/ 5(仅 421)钉玩家头顶 Obstructed。 */
export function starCellAI(e: Enemy, game: GameHooks, player: Player | null) {
  const p = player && !player.dead ? player : null;
  const is405 = e.vanillaId === 405;
  const lai = lunarLocalAI(e);
  if (e.ai0 < 0 || e.ai0 > 5) e.ai0 = 0;            // Enemy 哨兵 -1120 归一,原版出生 0
  if (e.ai0 === 5) {
    // ---- 421 头顶吸附(:37508-37527):Center=player.Top+(direction*4,0);失活→脱落 ----
    if (!p) { e.ai0 = 0; e.ai1 = 0; }
    else {
      const dir = p.facing ?? 1;
      e.x = p.cx + dir * 4 - e.w / 2;
      e.y = p.y - e.h / 2;
      e.vx = 0; e.vy = 0;
      // AddBuff(163 Obstructed,59) 每 tick 续期(:37522-37526)——BuffState.apply 取
      // max 合并,吸附期间恒 ≤1s 存量,脱落后自然消退。遮屏视觉在 Renderer
      // drawScreenObstruction（ScreenObstruction.cs 1:1）。
      // （原版另以 hide=ai[0]==5 隐藏本体——保持可见为已登记偏差,否则吸附期完全不可见）
      p.buffs.apply(BuffType.Obstructed, 59 / 60);
    }
    starCellTail(e, game, is405);
    return;
  }
  if (!p) { moveAndCollide(e, game.world, e.vx, e.vy); starCellTail(e, game, is405); return; }
  const los = losClear(game, e.cx, e.cy, p.cx, p.cy); // CanHit(Center,1,1,…)
  let flyPhase = false;

  if (e.ai0 === 0) {
    // ---- 视线判别(:37299-37355)；态尾自旋 rotation += direction×0.3（:37355）----
    e.visAngle += e.facing * 0.3;
    if (los) { e.ai0 = 1; }
    else {
      const dx = p.cx - e.cx, dy = p.cy - p.h / 4 - e.cy;
      if (Math.hypot(dx, dy) > 800) { e.ai0 = 2; }
      else {
        // 列锚 (px, selfY)(:37312-37322);命中升级双段锚 (selfX, py)(:37324-37333,
        // 原文复用列距 >8 判据——按原文照抄)
        if (Math.abs(p.cx - e.cx) > 8 && losClear(game, e.cx, e.cy, p.cx, e.cy)) {
          e.ai0 = 3; e.ai1 = p.cx; e.ai2 = e.cy;
          if (Math.abs(p.cx - e.cx) > 8 && losClear(game, e.cx, e.cy, e.cx, p.cy)
            && losClear(game, e.cx, p.cy, p.x, p.y)) {
            e.ai0 = 3; e.ai1 = e.cx; e.ai2 = p.cy;
          }
        } else if (Math.abs(p.cy - e.cy) > 8 && losClear(game, e.cx, e.cy, e.cx, p.cy)) {
          e.ai0 = 3; e.ai1 = e.cx; e.ai2 = p.cy;      // 行锚(:37340-37347)
        }
        if (e.ai0 === 0) {
          // 无锚:朝玩家(Y 抬高 h/4)轻推 0.5 → 4 漂移(:37348-37355)
          lai[0] = 0;
          const d = Math.hypot(dx, dy) || 1;
          e.vx += (dx / d) * 0.5; e.vy += (dy / d) * 0.5;
          e.ai0 = 4; e.ai1 = 0;
        }
      }
    }
  } else if (e.ai0 === 1) {
    // ---- 直追(:37356-37394):(5.5|8)+距/100 速,50 步进;断视线→0 ----
    // 421 瞄 player.Top（:37357-37360 if type==421 → vector = player.Top - center）；
    // 405/467 瞄 player.Center
    const is421 = e.vanillaId === 421;
    const tx = p.cx - e.cx, ty = (is421 ? p.y : p.cy) - e.cy;
    const d = Math.hypot(tx, ty);
    const spd = (is405 ? 8 : 5.5) + d / 100;
    const n = d || 1;
    e.vx = (e.vx * 49 + (tx / n) * spd) / 50;
    e.vy = (e.vy * 49 + (ty / n) * spd) / 50;
    if (!los) { e.ai0 = 0; e.ai1 = 0; }
    // 421 专属吸附门（:37377-37393 if type==421 && num<40）：近 40px 且场上无同族
    // 吸附中才钉上。467 致命球（日食怪，同 aiStyle 85）**不**吸附——此前误写成
    // !is405 导致致命球钉头 + 每 tick 灌 Obstructed(163)
    if (is421 && d < 40
      && !enemies(game).some((o) => o !== e && !o.dead && o.vanillaId === 421 && o.ai0 === 5)) {
      e.x = p.cx - e.w / 2; e.y = p.y - e.h;        // Center=player.Top
      e.vx = 0; e.vy = 0;
      e.ai0 = 5; e.ai1 = 0;
    }
  } else if (e.ai0 === 2) {
    e.visAngle = e.vx * 0.1;   // rotation（:37401）
    // ---- 穿墙(:37396-37419):noTileCollide=true;3|6 速 3 步进;近 600 且离实心→0 ----
    flyPhase = true;
    const tx = p.cx - e.cx, ty = p.cy - e.cy;
    const d = Math.hypot(tx, ty) || 1;
    const spd = is405 ? 6 : 3;
    e.vx = (e.vx * 2 + (tx / d) * spd) / 3;
    e.vy = (e.vy * 2 + (ty / d) * spd) / 3;
    if (d < 600 && !touchesSolid(game, e)) e.ai0 = 0;
  } else if (e.ai0 === 3) {
    e.visAngle = e.vx * 0.1;   // rotation（:37421）
    // ---- 锚点侧移(:37421-37440):2|3 速 3 步进;撞轴→4;到点/超 800/通视线→0 ----
    const tx = e.ai1 - e.cx, ty = e.ai2 - e.cy;
    const d = Math.hypot(tx, ty) || 1;
    const spd = is405 ? 3 : 2;
    e.vx = (e.vx * 2 + (tx / d) * spd) / 3;
    e.vy = (e.vy * 2 + (ty / d) * spd) / 3;
    if (e.hitWall || e.hitHead || e.onGround) { e.ai0 = 4; e.ai1 = 0; }
    if (d < spd || d > 800 || los) e.ai0 = 0;
  } else if (e.ai0 === 4) {
    e.visAngle = e.vx * 0.1;   // rotation（:37446）
    // ---- 漂移弹壁(:37442-37500):弹壁 ×-0.8;2|3 速 20 步进;180t 或通视线→0 ----
    if (e.hitWall) e.vx *= -0.8;
    if (e.hitHead || e.onGround) e.vy *= -0.8;
    if (e.vx === 0 && e.vy === 0) {
      const dx = p.cx - e.cx, dy = p.cy - p.h / 4 - e.cy;
      const d = Math.hypot(dx, dy) || 1;
      e.vx = (dx / d) * 0.1; e.vy = (dy / d) * 0.1;
    }
    const spd = is405 ? 3 : 2;
    const v = Math.hypot(e.vx, e.vy) || 1;
    e.vx = (e.vx * 19 + (e.vx / v) * spd) / 20;
    e.vy = (e.vy * 19 + (e.vy / v) * spd) / 20;
    e.ai1 += 1;
    if (e.ai1 > 180) { e.ai0 = 0; e.ai1 = 0; }
    if (los) e.ai0 = 0;
    // 每 5t 重试中转锚(:37485-37500):列锚需三方视线(原文 CanHit 重复两次照抄)
    lai[0] += 1;
    if (lai[0] >= 5 && !touchesSolid(game, e, 10)) {
      lai[0] = 0;
      if (losClear(game, e.cx, e.cy, p.cx, e.cy) && losClear(game, e.cx, e.cy, p.cx, e.cy)
        && losClear(game, p.cx, p.cy, p.cx, e.cy)) {
        e.ai0 = 3; e.ai1 = p.cx; e.ai2 = e.cy;
      } else if (losClear(game, e.cx, e.cy, e.cx, p.cy) && losClear(game, p.cx, p.cy, e.cx, p.cy)) {
        e.ai0 = 3; e.ai1 = e.cx; e.ai2 = p.cy;
      }
    }
  }

  if (flyPhase) fly(e);
  else moveAndCollide(e, game.world, e.vx, e.vy);
  starCellTail(e, game, is405);
}

/** AI_095 小星细胞 406(NPC.cs:39772-39819):无重力漂移减速,300t 线性长大
 *  (scale 1→1.3)→ Transform 405;20t 起喷 226 号尘环(圈层随龄收窄)。 */
export function smallStarCellAI(e: Enemy, game: GameHooks, _player: Player | null) {
  const MAX = 300;
  if (e.ai0 < 0) e.ai0 = 0;
  if (Math.hypot(e.vx, e.vy) > 4) { e.vx *= 0.95; e.vy *= 0.95; }
  e.vx *= 0.99; e.vy *= 0.99;
  e.ai0 += 1;
  e.vanillaScale = 1 + 0.3 * clamp(e.ai0 / MAX, 0, 1);   // :39782 scale
  if (e.ai0 >= MAX) {
    // Transform(405)(:39784-39788)——transformTo 埋块时会失败,下 tick 原地重试
    e.transformTo(405, game.world.store, false, game);
    return;
  }
  e.visAngle += e.vx * 0.1;
  if (e.ai0 > 20) {
    // 尘环(:39793-39817):tier=龄/150,半径 12-tier*2,半数概率
    const tier = Math.floor(e.ai0 / (MAX / 2));
    for (let k = 0; k < tier + 1; k++) {
      if (rnd(2) === 0) continue;
      const a = Math.random() * TAU;
      const r = 12 - tier * 2;
      game.spawnParticles(e.cx + Math.cos(a) * r, e.cy + Math.sin(a) * r,
        k % 2 === 1 ? '#7FD8FF' : '#4FB8E8', 1, 1.5 * ((10 - tier * 2) / 10),
        { life: 40, damp: 0.96 });
    }
  }
  moveAndCollide(e, game.world, e.vx, e.vy);
}

/** AI_096 水流入侵者 407/408(NPC.cs:39820-39862):SimpleFlyMovement 悬顶伺服
 *  (目标=玩家上方 250px,5 速 0.15 步进,近距减速档 0.35/0.65);每 70t 甩投射物 539
 *  (近水平随机向,|vx|≥1.5,60 伤)。 */
export function flowInvaderAI(e: Enemy, game: GameHooks, player: Player | null) {
  const SPD = 5, ACC = 0.15;
  if (e.ai0 < 0) e.ai0 = 0;
  const p = player && !player.dead ? player : null;
  if (p) {
    const dx = p.cx - e.cx, dy = p.cy - 250 - e.cy;
    const d = Math.hypot(dx, dy);
    let dvx = e.vx, dvy = e.vy;                        // <20px:期望=现速(:39828-39830)
    if (d >= 20 && d < 40) { dvx = (dx / d) * SPD * 0.35; dvy = (dy / d) * SPD * 0.35; }
    else if (d >= 40 && d < 80) { dvx = (dx / d) * SPD * 0.65; dvy = (dy / d) * SPD * 0.65; }
    else if (d >= 80) { dvx = (dx / d) * SPD; dvy = (dy / d) * SPD; }
    e.vx += clamp(dvx - e.vx, -ACC, ACC);              // SimpleFlyMovement(:39846)
    e.vy += clamp(dvy - e.vy, -ACC, ACC);
  }
  e.visAngle = e.vx * 0.1;
  e.ai0 += 1;
  if (e.ai0 < 70) { moveAndCollide(e, game.world, e.vx, e.vy); return; }
  e.ai0 = 0;
  // 甩 539(:39855-39862):UnitY.RotatedByRandom(π/2)×(5,3),重掷至 |vx|≥1.5
  let ox = 0, oy = 0;
  do {
    const a = Math.PI / 2 + (Math.random() * 2 - 1) * (Math.PI / 2);
    ox = Math.cos(a) * 5; oy = Math.sin(a) * 3;
  } while (Math.abs(ox) < 1.5);
  (game as unknown as { entities: { add: (x: unknown, b: string) => void } }).entities.add(
    new LunarOrb(e, 539, ox, oy, 60), 'projectiles');
  moveAndCollide(e, game.world, e.vx, e.vy);
}

/** AI_AttemptToFindTeleportSpot(NPC.cs:18973-19043)收敛:AI_097 传参
 *  (20,12,1,solidTileCheckCentered,teleportInAir)。原文 for 体尾 break → 每 attempt
 *  只验一个候选格;距目标 2000px 以上直接放弃;落点 3×3 须净空、岩浆格排除、
 *  落点外扩 12 tile 不得扫到玩家(telefrag 防护)。 */
function findTeleportSpot(game: GameHooks, e: Enemy, p: Player): { x: number; y: number } | null {
  const selfTx = Math.floor(e.cx / 16), selfTy = Math.floor(e.cy / 16);
  const ptx = Math.floor(p.cx / 16), pty = Math.floor(p.cy / 16);
  if (Math.abs(selfTx * 16 - ptx * 16) + Math.abs(selfTy * 16 - pty * 16) > 2000) return null;
  const st = game.world.store;
  for (let attempt = 0; attempt < 100; attempt++) {
    const tx = ptx - 20 + rnd(41);
    const ty = pty - 20 + rnd(41);
    if (ty >= selfTy - 1 && ty <= selfTy + 1 && tx >= selfTx - 1 && tx <= selfTx + 1) continue;
    if (st.inBounds(tx, ty - 1)) {                    // (tx,ty-1) 岩浆 → 弃
      const li = st.idx(tx, ty - 1);
      if (st.liquid[li] > 0 && st.liquidType[li] === 2) continue;
    }
    if (solidRect(game, tx - 1, tx + 1, ty - 1, ty + 1)) continue;   // 3×3 净空(区间序)
    // telefrag:落点 tile 外扩 12 tile vs 玩家 hitbox∪(hitbox+vel*20)
    const inf = 12 * 16;
    const rx0 = tx * 16 - inf, ry0 = ty * 16 - inf;
    const rx1 = tx * 16 + 16 + inf, ry1 = ty * 16 + 16 + inf;
    const px0 = p.x + Math.min(0, p.vx * 20), py0 = p.y + Math.min(0, p.vy * 20);
    const px1 = p.x + p.w + Math.max(0, p.vx * 20), py1 = p.y + p.h + Math.max(0, p.vy * 20);
    if (px0 < rx1 && px1 > rx0 && py0 < ry1 && py1 > ry0) continue;
    return { x: tx, y: ty };
  }
  return null;
}

/** AI_097 星云悬浮脑 420(NPC.cs:39863-40012):noTileCollide 穿墙。开场 180t 每 60t
 *  放环绕球 574(球每 180t 朝玩家线发 576 弹,8 速 65 伤);受击 1/6 概率瞬移
 *  (StrikeNPC :82176 置 localAI[1]);480t 周期 AI_AttemptToFindTeleportSpot 落点
 *  瞬移(起终双段尘爆 + 全场 574 球计时 -30);>400px 或断视线追击(7 速 30 步进),
 *  否则滞空缓降。玩家失活 → ai[1]=1 渐隐消散(3t)。 */
export function nebulaFloaterAI(e: Enemy, game: GameHooks, player: Player | null) {
  const SPD = 7, TP_T = 480, ORB_DELAY = 30;
  const lai = lunarLocalAI(e);
  if (e.ai0 < 0) e.ai0 = 0;
  const p = player && !player.dead ? player : null;
  // ---- 开场环绕球(:39869-39881) ----
  if (lai[2] < 180) {
    lai[2] += 1;
    if (lai[2] % 60 === 0) {
      let ox = 0, oy = 0;
      do {
        const a = Math.PI / 2 + (Math.random() * 2 - 1) * (Math.PI / 2);
        ox = Math.cos(a) * 4; oy = Math.sin(a) * 2.5;
      } while (Math.abs(ox) < 1.5);
      (game as unknown as { entities: { add: (x: unknown, b: string) => void } }).entities.add(
        new LunarOrb(e, 574, ox, oy, 0), 'projectiles');
    }
  }
  if (e.justHit) lai[1] = 1;                          // StrikeNPC(:82176)受击触发
  if (lai[1] === 1) {
    lai[1] = 0;
    if (rnd(6) === 0) e.ai0 = TP_T;                   // :39883-39888 受击 1/6 立即瞬移
  }
  const dir = p ? e.seekDirX(p) : e.facing;           // TargetClosest(confused 反向)
  if (!p) {                                           // 玩家失活 → 渐隐消散(:39891-39898)
    e.ai0 = 0; e.ai1 = 1; e.ai2 = 0; e.ai3 = 0;
  }
  e.visAngle = Math.abs(e.vx) * dir * 0.1;            // rotation(:39899)
  e.facing = -dir;                                    // spriteDirection=-direction
  if (e.ai1 === 1) {
    // ---- 消散段(:39905-39928):3t 倒数后 active=false ----
    if (lai[3] === 0) {
      lai[3] = 1; e.ai3 = 3;
      // 消散音 = Item8（:39911 原文 PlaySound(SoundID.Item8)，与传送同款）。
      // ★曾播 menuOpen(UI 菜单声)——"原键名拼错"的修补方向反了，应改真轨（审计 #22）
      game.playSfxFiles(['Item_8'], 1, e.cx, e.cy);
      game.spawnParticles(e.cx, e.cy, '#C060FF', 20, 3, { life: 40 });
    }
    e.ai3 -= 1;
    if (e.ai3 <= 0) e.dead = true;
    return;
  }
  if (!p) return;
  const los = losClear(game, e.cx, e.cy, p.cx, p.cy); // flag106(:39903)
  // 瞄点 = Center+(direction*20,6)(:39901-39902)
  const ax = e.cx + dir * 20, ay = e.cy + 6;
  const tdx = p.cx - ax, tdy = p.cy - ay;
  const td = Math.hypot(tdx, tdy);
  let hover = false;
  if (td > 400 || !los) {
    // 追击(:39930-39940):7 速钳制,30 步进
    let mx = tdx, my = tdy;
    const m = Math.hypot(mx, my);
    if (m > SPD) { mx = (mx / m) * SPD; my = (my / m) * SPD; }
    e.vx = (e.vx * 29 + mx) / 30;
    e.vy = (e.vy * 29 + my) / 30;
  } else {
    e.vx *= 0.98; e.vy *= 0.98;                       // 视线内滞空缓降(:39942-39945)
    hover = true;
  }
  // ---- 瞬移执行段(:39945-39969)：起终双端 Item8 + 尘 242 各 20（scale2.5 初速 ×3）----
  if (e.ai2 !== 0 && e.ai3 !== 0) {
    game.playSfxFiles?.(['Item_8'], 1, e.cx, e.cy);   // :39947 旧位置
    game.spawnParticles(e.cx, e.cy, '#C060FF', 20, 3, { life: 40 });
    e.x = e.ai2 * 16 - e.w / 2;                       // Center=(ai[2]*16, ai[3]*16)
    e.y = e.ai3 * 16 - e.h / 2;
    e.vx = 0; e.vy = 0;
    e.ai2 = 0; e.ai3 = 0;
    game.playSfxFiles?.(['Item_8'], 1, e.cx, e.cy);   // :39960 新位置
    game.spawnParticles(e.cx, e.cy, '#C060FF', 20, 3, { life: 40 });
  }
  // ---- 瞬移周期(:39970-40005) ----
  e.ai0 += 1;
  if (e.ai0 >= TP_T) {
    e.ai0 = 0;
    const spot = findTeleportSpot(game, e, p);
    if (spot) {
      e.ai1 = 20;                                     // :39979(除 ==1 外无读者,照抄)
      e.ai2 = spot.x; e.ai3 = spot.y;
      // :39982-40001 flag108 门：若已有任一自有 574 球计时为负（上一轮 -30 未走完）
      // → 跳过本轮 -30（曾误读成"门恒假恒全量"——!(ai[0]>=0) 即 ai[0]<0，常态为假
      // 仅在已加速球上为真，门=防叠加）
      const orbs = (game as unknown as { entities: { projectiles?: LunarOrb[] } })
        .entities.projectiles;
      if (Array.isArray(orbs)) {
        const anyNeg = orbs.some((o) => !o.dead && o instanceof LunarOrb
          && o.kind === 574 && o.parentId === e.id && o.timer() < 0);
        if (!anyNeg) {
          for (const o of orbs) {
            if (!o.dead && o instanceof LunarOrb && o.kind === 574 && o.parentId === e.id) {
              o.delay(ORB_DELAY);
            }
          }
        }
      }
    }
  }
  if (hover && Math.hypot(e.vx, e.vy) < 2) lai[0] += 1;   // :40006-40011(无消费者,照抄)
  fly(e);                                             // noTileCollide=true
}

/** AI_099 日耀黏液 519(NPC.cs:40324-40390):自身重力 0.2(钳 12)坠落,贴图随速度
 *  转向;落地(vy==0)→ 5t 定格(每 tick 回退到 oldPosition)→ HitEffect(0,9999) 自爆
 *  消亡(active=false,不走掉落/扣盾)。★BJ503:运行火尘与自爆尘全参 1:1——拖尾走
 *  spawnDust 原版尘池(6 号尘 NewDust 全参+post 修型),自爆走 vanilla-npcdust.json
 *  查表 death 相(oldPos 轨迹环×7 组×5 粒 idPick{6,259,158},hd=0);旧 spawnParticles
 *  自造色块(26+18 粒 #FFB060/#FFE080+拖尾 #FF9A3C 近似)=实报「弹幕效果不对」面。 */
export function solarSlimeAI(e: Enemy, game: GameHooks, _player: Player | null) {
  if (e.ai0 < 0) e.ai0 = 0;                           // Enemy 哨兵 -1120 归一,原版出生 0
  if (e.vy === 0 && e.ai0 === 0) {                    // :40326-40332 落地门
    e.ai0 = 1; e.ai1 = 0;
    return;
  }
  if (e.ai0 === 1) {
    // ---- 自爆定格(:40334-40341) ----
    e.vx = 0; e.vy = 0;
    e.x = e.prevX; e.y = e.prevY;                     // position=oldPosition
    e.ai1 += 1;
    if (e.ai1 >= 5) {
      // HitEffect(0, 9999.0)(:40339)→ 519 特例轨迹爆散尘(NPC.cs:83908-83929,vanilla-npcdust
      //  表 519 death 相,hitDirection=0 → sx=2.5×0=0 尘竖直上抛);无 gore/DeathSound(SetDefaults null)。
      spawnNpcDeathDust(e, game, 0);
      e.dead = true;                                  // HitEffect(0,9999)+active=false
    }
    return;
  }
  e.vy = Math.min(e.vy + 0.2, 12);                    // :40345-40349
  e.visAngle = Math.atan2(e.vy, e.vx) - Math.PI / 2;  // rotation(:40350)
  // 519 火尘(:40355-40389)1:1:首帧 13 粒爆发 + 每帧 3 掷 2/3 概率——NewDust(position,w,h,6,
  //  vel×0.5, α90, scale2.5) 后置修型照抄:
  //  · 首帧组(:40357-40367):noGravity+fadeIn=1+velocity×4+noLight(高速无重力爆裂开场);
  //  · 每帧组(:40369-40388):velocity×0.2+fadeIn=1;1/6 → velocity×30+noGravity=false+noLight
  //    (快速受重力飞散),否则 velocity = DirectionFrom(dust.position)×|v|——Entity.cs:210
  //    DirectionFrom(Source)=Normalize(Center−Source)=【从尘位指向 NPC 中心】→ 尘向火球
  //    回吸(原版火焰聚拢观感),非径向外抛。
  if (lai0Of(e) === 0) {
    setLai0(e, 1);
    for (let i = 0; i < 13; i++) {
      const d = game.spawnDust?.(e.x, e.y, e.w, e.h, 6, e.vx * 0.5, e.vy * 0.5, 90, null, 2.5);
      if (!d) break;
      d.noGravity = true;
      d.fadeIn = 1;
      d.vx *= 4; d.vy *= 4;
      d.noLight = true;
    }
  }
  for (let i = 0; i < 3; i++) {
    if (Math.floor(Math.random() * 3) >= 2) continue;   // Main.rand.Next(3) < 2
    const d = game.spawnDust?.(e.x, e.y, e.w, e.h, 6, e.vx * 0.5, e.vy * 0.5, 90, null, 2.5);
    if (!d) break;
    d.noGravity = true;
    d.vx *= 0.2; d.vy *= 0.2;
    d.fadeIn = 1;
    if (Math.floor(Math.random() * 6) === 0) {
      d.vx *= 30; d.vy *= 30;
      d.noGravity = false;
      d.noLight = true;
    } else {
      const len = Math.hypot(d.vx, d.vy);
      const dx = e.cx - d.x, dy = e.cy - d.y;           // DirectionFrom：指向 NPC 中心
      const norm = Math.hypot(dx, dy);
      if (norm > 0) { d.vx = (dx / norm) * len; d.vy = (dy / norm) * len; }
    }
  }
  moveAndCollide(e, game.world, e.vx, e.vy);
}

/** 519 火尘首帧门(localAI[0] 复用) */
function lai0Of(e: Enemy): number { return lunarLocalAI(e)[0]; }
function setLai0(e: Enemy, v: number): void { lunarLocalAI(e)[0] = v; }

// ---------------------------------------------------------------------------
// ★BJ112-④ 三角分布单源（Utils.cs:1785-1788 RotatedByRandom = NextDouble×max −
//  NextDouble×max = 对称【三角分布】，orchestraFx F6/FX24 判例同式）。本仓
//  Enemy.towerRotSpread（塔尘族,2026-09 F6 清偿）已按此实现；415 喷火尘 /
//  516 出膛角 / 428 分裂初速三处消费此同源（旧 uniform 掷已全部收编）。
/** Utils.cs:1785-1788 角度源：(NextDouble − NextDouble) × maxRadians —— 对称三角
 *  分布（密度峰在 0、±max 处为 0），非 uniform。 */
export function rotSpreadAngle(maxRadians: number): number {
  return (Math.random() - Math.random()) * maxRadians;
}
/** Vector2.UnitY.RotatedByRandom(maxRadians)（Utils.cs:1785-1788 掷角 + Vector2.
 *  RotatedBy 矩阵 [x·c−y·s, x·s+y·c] 作用于 (0,1) → (−sin a, cos a)）。 */
export function unitYRotatedByRandom(maxRadians: number): [number, number] {
  const a = rotSpreadAngle(maxRadians);
  return [-Math.sin(a), Math.cos(a)];
}

// ---------------------------------------------------------------------------
// AI_003 火蜥蜴 415 喷火段（NPC.cs:57362-57430，ai[2] 三态：冷却>0 / 触发 ==0 /
//   喷吐 -1..-42）。触发门 = 同向 + Center 视线；场上 516 太阳耀斑 >6 → 冷却 90。
//   ★justHit 重置臂（:57366-57370）：受击当拍 ai[2]=120——打断喷吐（负段归正）
//   且推迟/压制触发（冷却重排）。
//   喷吐期每 tick vx×0.8 且 return 跳过行走链；ai[2]==-18/-26/-34 三拍各撒尘 259
//   ×20（Center + UnitX×spriteDirection×40，UnitY 掷向×2 + 水平偏置）并在权威端
//   NewNPC(Bottom=(Center.X+spriteDirection*45, Center.Y+8), 516)（:57420-57428）。
//   返回 true = 本 tick 原版已 return（喷吐风停段），调用方跳过行走/跳跃/远程链。
// ---------------------------------------------------------------------------
export function drakomireBreathAI(e: Enemy, game: GameHooks, player: Player | null): boolean {
  if (e.justHit) e.ai2 = 120;                     // :57366-57370 justHit 重置臂（受击打断/推迟喷火；netUpdate 位本仓无此链,Enemy.ts:1793 同案）
  if (e.ai2 > 0) e.ai2 -= 1;
  if (e.ai2 === 0) {
    // 场上 516 计数（:57376-57382）>6 → 冷却 90
    let alive516 = 0;
    for (const o of enemies(game)) if (!o.dead && o.vanillaId === 516) alive516 += 1;
    if (alive516 > 6) {
      e.ai2 = 90;
    } else if (player && !player.dead
      && ((player.cx < e.cx && e.facing < 0) || (player.cx > e.cx && e.facing > 0))
      && losClear(game, e.cx, e.cy, player.cx, player.cy)) {
      e.ai2 = -1;                                   // :57383-57387 进喷吐
      e.facing = player.cx >= e.cx ? 1 : -1;        // TargetClosest
    }
    return false;                                   // 待机段不拦截行走
  }
  if (e.ai2 < 0 && e.ai2 > -42) {
    e.ai2 -= 1;
    if (e.ai2 === -42) e.ai2 = 180 + 30 * Math.floor(Math.random() * 10);   // :57401
    e.vx *= 0.8;                                    // :57402
    if (e.ai2 === -18 || e.ai2 === -26 || e.ai2 === -34) {
      // 尘 259 ×20（:57403-57416）：锚 Center+UnitX×spriteDirection×40，
      // vector18 = UnitY.RotatedByRandom(2π)（三角分布,BJ112-④）；速度 =
      // vector18×2 + UnitX×NextFloat×spriteDirection×3（:57413）；position =
      // vector17+vector18×4（:57412）、scale = 0.3+vector18.X×(−spriteDirection)
      //（:57414）、fadeIn = 0.7（:57415）（BJ112-⑤ 三参补齐）。掷序=原版：角 2 掷→
      // NextFloat 1 掷。
      for (let k = 0; k < 20; k++) {
        const [rx, ry] = unitYRotatedByRandom(Math.PI * 2);   // vector18（:57411）
        const dvx = rx * 2 + Math.random() * e.facing * 3;    // :57413
        const dvy = ry * 2;
        const d = game.spawnDust?.(e.cx + e.facing * 40, e.cy, 0, 0, 259, dvx, dvy, 0, null, 1, true);
        if (d) {
          d.x = e.cx + e.facing * 40 + rx * 4;                // position = vector17 + vector18×4（:57412）
          d.y = e.cy + ry * 4;
          d.scale = 0.3 + rx * (-e.facing);                   // 0.3 + vector18.X×(−spriteDirection)（:57414）
          d.fadeIn = 0.7;                                     // :57415
        }
      }
      if (e.vx > -0.5 && e.vx < 0.5) e.vx = 0;      // :57417-57421
      if (!e.netPuppet) {
        // NewNPC Bottom 锚（NPC.cs:81594 nPC.Bottom=(X,Y)）→ 左上 = (bx−w/2, by−h)
        const f = spawnVanillaEnemy(game, 516, e.cx + e.facing * 45, e.cy + 8);
        if (f) { f.x -= f.w / 2; f.y -= f.h; }
      }
    }
    return true;                                    // :57429 喷吐段 return
  }
  return false;
}

// ---------------------------------------------------------------------------
// 太阳耀斑 516（aiStyle 9 type==516 专属支，NPC.cs:21463-21481 + :21582-21600）：
//   出膛渐隐 alpha 0→220（+40/t）；首拍朝玩家单位向量 RotatedByRandom(π/2)×
//   RotatedBy(−π/4)（净 ±3π/4 三角分布,Utils.cs:1785-88——BJ112-④ 勘误）钳 Y 分量
//   ≤0.2 后 ×(6+rand×4)；
//   擦墙/近玩家 20px → StrikeNPCNoInteraction(9999) 自爆（走标准死亡管线）；
//   EncourageDespawn(100)；追踪 = 15 步进朝玩家 + 1/12 加速 + 速 <6 时 ×1.05，
//   rotation += 0.1×direction。noTileCollide=false（撞墙即爆）、noGravity=true。
// ---------------------------------------------------------------------------
export function solarFlareAI(e: Enemy, game: GameHooks, player: Player | null): void {
  if (e.spawnAlpha < 220) e.spawnAlpha = Math.min(220, e.spawnAlpha + 40);   // :21465-21469
  // ★BJ510：rotation += 0.1×direction（NPC.cs:21584）——direction 字段默认 +1
  // （Entity.cs:20）且 AI_009 516 段无 direction 写面 → 恒 +0.1/tick 自旋；
  // spriteDirection 字段默认 -1 恒不翻（NPC.cs:6522）= 本仓 rotationDriven
  // （aiStyle 9 ∈ Renderer 旋转族）已禁 facing 镜像同相。visAngle 承载本体旋转
  // （render 侧 ctx.rotate）+ 残影 gRot + BJ510 队列 rot 三面单源。
  e.visAngle += 0.1;
  const p = player && !player.dead ? player : null;
  if (e.ai0 === 0) {
    e.ai0 = 1;                                      // :21470-21472
    let dx = p ? p.cx - e.cx : 0, dy = p ? p.cy - e.cy : 0;
    let d = Math.hypot(dx, dy);
    if (d < 0.001) { dx = 0; dy = -1; d = 1; }      // NaN → -UnitY（:21475-21478）
    const ux = dx / d, uy = dy / d;
    // RotatedByRandom(1.5708).RotatedBy(-0.7854)：净角 = 三角掷(±π/2) − π/4
    //（:21479-21480 + Utils.cs:1785-88；★BJ112-④ 勘误：旧注释"均匀"与 uniform
    //  实现均误——RotatedByRandom 是 (r−r)×max 三角分布）
    const ang = rotSpreadAngle(Math.PI / 2) - Math.PI / 4;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const rx = ux * ca - uy * sa, ry = ux * sa + uy * ca;
    const spd = 6 + Math.random() * 4;              // :21482 (6f + NextFloat * 4f)
    e.vx = rx * spd;
    e.vy = Math.min(ry, 0.2) * spd;                 // :21481 Y 分量钳 0.2（单位向量段）
  }
  e.encourageDespawn(100);                          // :21581 EncourageDespawn(100)
  // 追踪舵（1457 :21586-21599）：rotation += 0.1×direction；15 步进 + num132=1/12 加速。
  // ★NaN 回退对齐（2026-09-17 清债⑥）：原版 Normalize 后 HasNaNs() → (direction, 0)
  // （:21589-21592,零距玩家退化支）——旧 d‖1 回退成 (0,0) 舵=原地滞留,非原版
  if (p) {
    const dx = p.cx - e.cx, dy = p.cy - e.cy;
    const len = Math.hypot(dx, dy);
    const ux = len > 0 ? dx / len : (e.facing || 1);
    const uy = len > 0 ? dy / len : 0;
    const spdNow = Math.hypot(e.vx, e.vy);
    e.vx = (e.vx * 14 + ux * (spdNow + 1 / 12)) / 15;
    e.vy = (e.vy * 14 + uy * (spdNow + 1 / 12)) / 15;
    if (spdNow < 6) { e.vx *= 1.05; e.vy *= 1.05; }   // :21597-21599
  }
  moveAndCollide(e, game.world, e.vx, e.vy);        // noTileCollide=false：撞块写碰撞位
  // 自爆（:21478-21481 擦墙 / 近身 20px）→ StrikeNPCNoInteraction(9999) 标准死
  if (e.hitWall || e.hitHead || e.collideY
    || (p && Math.hypot(p.cx - e.cx, p.cy - e.cy) < 20)) {
    e.iframes = 0;
    e.hp = 0;
    e.hurt(9999, 0, 0, game);
  }
}

// ---------------------------------------------------------------------------
// AI_006 爬尾虫族 412/413/414（NPC.cs:51357-52671 的 412 专属段，1.4.5.6 1:1）
//   头 412 首帧自建 30 段链（29×413 身 + 1×414 尾，:51764-51785 num35=30），
//   全链 realLife=头（:51770/:51782——受击传导扣头 10000 总血，段不可单杀）；
//   空泳追击环（flag3 恒 true :51955-51957）：玩家下方 15 格内有地面 → 目标改为
//   地面上方 800px 悬停线，|dx|<500 时再沿速度向外推 ±600px 环绕（:52198-52208）；
//   玩家悬空（下方无地）→ 直追且提速 10/0.3 → 14/0.5（:52211-52214）；
//   速度带钳 [0.7n,1.3n]（:52216-52230）；同族头分离（:52232-52254，60/200 或
//   400/1000）；段链收缩 linkDist = width+6（:52292-52294）；头火尘双粒（:52050-52067）。
//   段完整性 + 414 红闪原版由各段独立跑 AI_006 承担；本仓段（wormBody）跳过 AI
//   分发 → 头循环代行（:51807-51819 身/尾查前段 / :51850-51862 头/身查下段）。
// ---------------------------------------------------------------------------

/** 414 尾受击红闪一步（NPC.cs:52026-52047 纯函数化，仅 type 414）：
 *  受击 → localAI[3]=3；localAI[2]>0 每 tick −16、过零翻 −128；负段 +16 回 0；
 *  归零且 localAI[3]>0 → 重发 128 并消耗一发。渲染侧
 *  Renderer.npcGlowCrawltipedeFlash 消费 e.lai2（n=trunc，负段 n=128+trunc，
 *  RGB=(255-n,n,n)、A=255-n）——AI 侧必须按本节奏写 lai2，否则 Glow_159 红闪
 *  永不触发。 */
export function crawltipedeFlashStep(
  lai2: number, lai3: number, justHit: boolean,
): { lai2: number; lai3: number } {
  if (justHit) lai3 = 3;                                              // :52027-52029 受击装填 3 发
  if (lai2 > 0) {
    lai2 -= 16;                                                       // :52030-52033 正段衰减
    if (lai2 === 0) lai2 = -128;                                      // :52033-52035 过零翻转
  } else if (lai2 < 0) {
    lai2 += 16;                                                       // :52038-52040 负段回升
  } else if (lai3 > 0) {
    lai2 = 128;                                                       // :52041-52045 归零且有存货 → 重发
    lai3 -= 1;
  }
  return { lai2, lai3 };
}

export function crawltipedeAI(e: Enemy, game: GameHooks, player: Player | null): void {
  if (!e.bInit) {
    e.bInit = true;
    // :51764-51785 头首帧建链：num35=30 段（末段 414，其余 413）
    const segs = enemySpawnChain(e, 30);
    e.realLifeHost = e;
    for (const s of segs) { s.realLifeHost = e; addEnemy(game, s); }
  }
  const st = game.world.store;
  // ---- 段完整性与 414 红闪（原版各段独立自查，头循环代行）----
  if (!e.wormNext || e.wormNext.dead) { e.die(game); return; }        // :51850-51862 头下段失效自灭
  for (let s = e.wormNext; s; s = s.wormNext!) {
    if (s.dead) continue;
    const prevDead = !s.wormFollow || s.wormFollow.dead;              // :51807-51819（413/414 查前段）
    const nextDead = s.vanillaId === 413 && (!s.wormNext || s.wormNext.dead); // :51850-51862（413 查下段）
    if (prevDead || nextDead) { s.die(game); continue; }              // 同 tick 逐段级联
    if (s.vanillaId === 414) {                                        // :52026-52047 尾段红闪
      const f = crawltipedeFlashStep(s.lai2, s.lai3, s.justHit);
      s.lai2 = f.lai2; s.lai3 = f.lai3;
    }
  }
  // 无目标：缓漂（与 Enemy.wormAI 同近似，原版 TargetClosest 指向死亡槽位照飞）
  if (!player) {
    e.vx *= 0.97; e.vy *= 0.97;
    e.x += e.vx; e.y += e.vy;
    e.visAngle = Math.atan2(e.vy, e.vx) + Math.PI * 0.5;
    return;
  }
  // ---- 头火尘双粒（:52050-52067：Center + (rotation−π/2)±8 ± rotation 向量×16，
  //      位居舵机/rotation 赋值之前 → 读上一 tick 的 rotation，与本处取值一致）----
  // ★BJ244（2026-09-21）升级为原版尘通道 1:1（:52201-52213 实为双粒锚点源码段）：
  //   尘 6（火）、scale=1+NextFloat×3、α100、Color.Transparent（=null）、
  //   noGravity+noLight、fadeIn=1、velocity=Vector2.Zero（覆写）、position−=(4,4)。
  //   旧实现 spawnParticles '#FF9A3C' 近似（固 scale/无 fadeIn/noLight 面）→ 换
  //   spawnDust 逐字段对齐；锚点算式原样保留。
  {
    const fw = e.visAngle - Math.PI * 0.5;                            // (rotation − π/2).ToRotationVector2()
    const mv = e.visAngle;                                            // rotation.ToRotationVector2()
    for (const sgn of [1, -1]) {
      // 原文 NewDust(0 盒) 后 position -= (4,4)——本仓 spawn +4 钳位抖动，先 −4 入参
      //  → 落点 = 锚点 −4（vanilla 为锚点 −4 − [0,4) 抖，亚 4px 差,备案）
      const d = game.spawnDust?.(
        e.cx + Math.cos(fw) * 8 + Math.cos(mv) * 16 * sgn - 4,
        e.cy + Math.sin(fw) * 8 + Math.sin(mv) * 16 * sgn - 4,
        0, 0, 6, e.vx, e.vy, 100, null, 1 + Math.random() * 3, true, true);
      if (d) {
        d.noLight = true;
        d.fadeIn = 1;
        d.vx = 0; d.vy = 0;                       // obj.velocity = Vector2.Zero（覆写）
      }
    }
  }
  // ---- 412 目标覆写（:52176-52254）----
  let num46 = 10, num47 = 0.3;                                        // :52178-52179 基础速/加速
  let tx = player.cx, ty = player.cy;                                 // num49/num50 初值 = 玩家中心（:52173-52175）
  const ptx = Math.floor(player.cx / TILE), pty = Math.floor(player.cy / TILE);
  let groundRow = -1;                                                 // num51：玩家下方首个实心行（:52180）
  for (let dx = -2; dx <= 2; dx++) {                                  // :52183-52191 列 ±2 × 下 15 格
    for (let dy = 0; dy <= 15; dy++) {
      // WorldGen.SolidTile2（WorldGen.cs:70178——null tile 视为实心）→ 世界外按实心
      if (!st.inBounds(ptx + dx, pty + dy) || st.isSolid(ptx + dx, pty + dy)) {
        groundRow = pty + dy;
        break;
      }
    }
    if (groundRow > 0) break;                                         // :52193-52196 仅正行号中断外层
  }
  let sepDist = 60, sepPush = 200;                                    // num60/num61（:52232-52233）
  if (groundRow > 0) {
    const hoverY = groundRow * TILE - 800;                            // :52200-52201 num56 = num51×16 − 800
    if (player.y > hoverY) {                                          // :52202 玩家顶低于悬停线
      ty = hoverY;                                                    // :52204 目标改悬停线
      if (Math.abs(e.cx - player.cx) < 500) {                         // :52205
        tx = e.vx > 0 ? player.cx + 600 : player.cx - 600;            // :52207 沿速度向外推 600px 环绕
      }
    }
    sepDist = 400; sepPush = 1000;                                    // :52234-52237 有地 → 分离加强
  } else {
    num46 = 14; num47 = 0.5;                                          // :52211-52214 玩家悬空 → 直追提速
  }
  // ---- 速度带钳 [0.7n, 1.3n]（:52216-52230，舵机前的存量速度）----
  const spd = Math.hypot(e.vx, e.vy);
  if (spd > 0) {
    if (spd > num46 * 1.3) { e.vx = (e.vx / spd) * num46 * 1.3; e.vy = (e.vy / spd) * num46 * 1.3; }
    else if (spd < num46 * 0.7) { e.vx = (e.vx / spd) * num46 * 0.7; e.vy = (e.vy / spd) * num46 * 0.7; }
  }
  // ---- 同族头分离（:52239-52254）：目标点沿远离方向推 sepPush ----
  for (const o of enemies(game)) {
    if (o === e || o.dead || o.vanillaId !== 412) continue;
    const d = Math.hypot(o.cx - e.cx, o.cy - e.cy);
    if (d > 0.01 && d < sepDist) {
      tx -= ((o.cx - e.cx) / d) * sepPush;
      ty -= ((o.cy - e.cy) / d) * sepPush;
    }
  }
  // ---- 16px 量化（:52254-52259）----
  const dxq = Math.floor(tx / TILE) * TILE - Math.floor(e.cx / TILE) * TILE;
  const dyq = Math.floor(ty / TILE) * TILE - Math.floor(e.cy / TILE) * TILE;
  // ---- 期望速度向量（:52396-52401 num68 = num46/num63）----
  const dist = Math.hypot(dxq, dyq) || 1;
  const ax = Math.abs(dxq), ay = Math.abs(dyq);                       // num66/num67（:52397-52398，均匀缩放下比较不变）
  const wantX = (dxq / dist) * num46, wantY = (dyq / dist) * num46;
  const step = num47;
  // ---- 舵机（:52511-52583 的 !flag8 分支；flag8 仅 87/454/621 置位，412 恒 false）----
  if ((e.vx > 0 && wantX > 0) || (e.vx < 0 && wantX < 0)
    || (e.vy > 0 && wantY > 0) || (e.vy < 0 && wantY < 0)) {
    if (e.vx < wantX) e.vx += step; else if (e.vx > wantX) e.vx -= step;
    if (e.vy < wantY) e.vy += step; else if (e.vy > wantY) e.vy -= step;
    if (Math.abs(wantY) < num46 * 0.2 && ((e.vx > 0 && wantX < 0) || (e.vx < 0 && wantX > 0))) {
      if (e.vy > 0) e.vy += step * 2; else e.vy -= step * 2;
    }
    if (Math.abs(wantX) < num46 * 0.2 && ((e.vy > 0 && wantY < 0) || (e.vy < 0 && wantY > 0))) {
      if (e.vx > 0) e.vx += step * 2; else e.vx -= step * 2;
    }
  } else if (ax > ay) {
    if (e.vx < wantX) e.vx += step * 1.1; else if (e.vx > wantX) e.vx -= step * 1.1;
    if (Math.abs(e.vx) + Math.abs(e.vy) < num46 * 0.5) {
      if (e.vy > 0) e.vy += step; else e.vy -= step;
    }
  } else {
    if (e.vy < wantY) e.vy += step * 1.1; else if (e.vy > wantY) e.vy -= step * 1.1;
    if (Math.abs(e.vx) + Math.abs(e.vy) < num46 * 0.5) {
      if (e.vx > 0) e.vx += step; else e.vx -= step;
    }
  }
  e.facing = e.vx > 0 ? 1 : -1;
  e.visAngle = Math.atan2(e.vy, e.vx) + Math.PI * 0.5;                // :52600 头 rotation
  // ---- 位移（noTileCollide 直积分）----
  e.x += e.vx; e.y += e.vy;
  // ---- 段链收缩跟随（:52266-52323：rotation :52277 / num64=width+6 :52292-52294 /
  for (let s = e.wormNext; s && !s.dead; s = s.wormNext!) {
    const fx = s.wormFollow!;
    const dxC = fx.cx - s.cx, dyC = fx.cy - s.cy;
    const d = Math.hypot(dxC, dyC);
    if (d > 0.01) {
      const shrink = (d - (s.w + 6)) / d;                             // :52304 收缩比 = (dist−num64)/dist
      s.x += dxC * shrink;
      s.y += dyC * shrink;
      s.visAngle = Math.atan2(dyC, dxC) + Math.PI * 0.5;              // :52277
    }
    s.facing = dxC < 0 ? 1 : -1;
    s.vx = 0; s.vy = 0;                                               // :52307 velocity = Vector2.Zero
  }
}

// ---------------------------------------------------------------------------
// 环绕球投射物 539/574(Projectile.cs:5864-5878 SetDefaults + AI_102 :32040-32280)
//  539(水流入侵者 407 甩出):绕父 407 盘旋 210t(0.15/0.075 符号步进钳 6,随父位移),
//    到点取最近玩家方向(±50px 抖动 ×0.8-1.2)以 16 速直冲;亡时(撞块/到期)80×80
//    范围 60 伤(:69366-69405)。
//  574(悬浮脑 420 环绕):随 420 存活;每 180t 且对玩家 CanHitLine → 线发 576 弹
//    (8 速 65 伤)后重置计时继续盘旋;悬浮脑瞬移时全量计时 -30(accelerate)。
// ---------------------------------------------------------------------------
/** Player.FindClosest（Player.cs:4733-4758）：中心曼哈顿距（原式 position+width/2
 *  两心距同构），active&&!dead 取最小、严格 < 平距取先扫描槽（候选序 [本地槽 0,
 *  ...代理] 对齐原版槽序）；全灭回退首候选（原版首活跃槽兜底）。
 *  弹体侧消费点：LunarOrb 539 冲刺（:32191）/574 父亡兜底（:32193）、传送门 578
 *  首帧定向（:32530）——M11 索敌链 */
function findClosestPlayer(game: GameHooks, cx: number, cy: number): Player | null {
  const cands = game.candidatePlayers?.() ?? [game.player];
  let base: Player | null = null;
  for (const p of cands) { if (p) { base = p; break; } }
  let best = base;
  let dist = -1;
  for (const p of cands) {
    if (!p || p.dead) continue;
    const d = Math.abs(p.cx - cx) + Math.abs(p.cy - cy);
    if (dist === -1 || d < dist) { dist = d; best = p; }
  }
  return best;
}
// ★BJ109-B（2026-09-16）：GlowMask 加色外发光贴图懒加载——原版 DrawProjDirect
//  539 支 DrawProjectionGlowMask[140]（Main.cs:34491-34496）/ 574 支 GlowMask[148]
//  （:34503-34508），色 Color(255,255,255,0)=XNA 预乘 A=0 纯加算白、源矩形=本体帧
//  矩形（Glow_140 24×136=4×34 与 Projectile_539 同排版 / Glow_148 24×48=2×24 同 574）。
//  TtlSprite 直载（LightningBoltProj Extra_33 同款通道,public/sprites/vanilla 已在库）。
const orbGlow140Ttl = new TtlSprite('sprites/vanilla/Glow_140.png');
const orbGlow148Ttl = new TtlSprite('sprites/vanilla/Glow_148.png');

export class LunarOrb extends Entity {
  w = 18; h = 18;
  vx: number; vy: number;
  readonly kind: 539 | 574;
  readonly parentId: number;
  /** v6 联机：父体 netId（访客端父=msg23 傀儡；0=本端真身走 parentId 查找） */
  parentNetId = 0;
  private ai0 = 0;
  private dmg: number;
  private life = 600;
  private frame = 0;
  private frameT = 0;
  dead = false;
  /** ★BJ294 敌射侧拒割位：539/574 SetDefaults hostile（P.cs:6144-52/:6241-49）→ 原版
   *  CutTiles 调用点 friendly 门（:12515）整支不进。详 Entity.ts 中央门 BJ294 注。 */
  noVanillaCut = true;

  // ---- ★通用湿段（Projectile.cs:16903-17113,projWetSection.ts 共享体 1:1;溅花
  //  尘/音由共享体 wetSplashStepShared 承载,本类不自写）----
  //  豁免核对（双 kind）：539 SetDefaults P.cs:6144-6152（18×30/aiStyle 102/hostile/
  //  penetrate −1/timeLeft 600,tileCollide 缺省 true【无覆写行】）【无】ignoreWater
  //  行 → 受段;574 P.cs:6241-6249（18×18/aiStyle 102/hostile/timeLeft 600/
  //  tileCollide=false【:6248】）【无】ignoreWater 行 → 受段（数据面
  //  PROJ_IGNORE_WATER 两者皆无）。两 id ∉ IsDestroyedByWater 六型、非 2/34/80/155。
  //  阻尼（按 kind 分叉,aiStyle 102 不在 UpdatePosition 早退表 :20551）：
  //  · 539 tileCollide=true → 湿阻尼支 :17721-17764 跑,速度积分行乘档（速度场
  //    不减只削当拍位移）;盘旋段 AI 直写的父体跟随位移（position += npc 位差
  //    :33884-33887）非 velocity 积分宿主,不受阻尼——与原版同构。
  //  · 574 tileCollide=false【:6248】→ 湿阻尼支整支不进,wetVelocity 保持 :16870
  //    的 AI 前 velocity 快照（无阻尼、滞后一子步 quirk）→ wet 位移 = AI 前快照 /
  //    dry 位移 = post-AI velocity（:20557-20562 分叉,YoyoProj 回收态先例）。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价——首拍同位测值） */
  presetDone = false;

  constructor(parent: Enemy | null, kind: 539 | 574, vx: number, vy: number, dmg: number, x?: number, y?: number) {
    super();
    this.kind = kind;
    this.parentId = parent?.id ?? 0;
    this.vx = vx; this.vy = vy;
    this.dmg = dmg;
    if (kind === 539) { this.w = 18; this.h = 30; }
    // v6 傀儡重建：parent=null 时由调用方传显式坐标
    this.x = (x ?? parent!.cx) - this.w / 2;
    this.y = (y ?? parent!.cy) - this.h / 2;
  }

  /** v6 联机打包：kind=8，tag=`${539|574},${parentId}`。
   *  访客重建后本地跑盘旋/冲刺/爆炸（确定性自包含，父=傀儡）；
   *  574 的线发 576 弹经 !netPuppet 门禁排除（房主侧已发） */
  netProjMeta(): NetProjMeta {
    return { kind: 8, tag: `${this.kind},${this.parentId}`, aux: 0, dmg: this.dmg };
  }

  /** 悬浮脑瞬移同步:全场计时 -30(:39994-40001) */
  delay(t: number): void { this.ai0 -= t; }

  /** 当前 ai[0] 计时（悬浮脑瞬移的负计时球门读,:39986） */
  timer(): number { return this.ai0; }

  fixedUpdate(_dt: number, game: GameHooks): void {
    // v6 联机：傀儡端按 netId 找父（msg23 傀儡）；本端真身按本地 id
    const parent = this.parentNetId
      ? (game.enemies() as Enemy[]).find((n) => n.netId === this.parentNetId)
      : (game.enemies() as Enemy[]).find((n) => n.id === this.parentId);
    // :16870 `Vector2 wetVelocity = velocity`（逐子步 AI 前 velocity 快照——574
    //  tileCollide=false 湿态位移消费这份快照,见字段块头注）
    const preVx = this.vx, preVy = this.vy;
    const orbitT = this.kind === 539 ? 210 : 180;
    const alive = !!parent && !parent.dead;
    if (this.kind === 574 && !alive) {
      // ★⑥杀拍口径（2026-09-06 湿段配方推广）：原版 AI_102 574 父失联 Kill+return
      //  （flag50 门 :33880-33887 `if (!Main.npc[num826].active || type != num821)
      //  { Kill(); return; }`）先于盘旋跟随位写 → 死拍 position=上拍位,Update 湿段
      //  (:16895)无 active 门照跑（`!active` 门 :17132 只拦 Damage/尾尘）→ 杀拍溅花
      //  照走。杀支与 AI 尾活拍调用点同拍互斥（早退）→ 无需 wetSectionRan 旗;
      //  574 ∉ IsDestroyedByWater 六型/非 80 → 段内无补 Kill 面。
      projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
        this.kind, !!projectileData(this.kind)?.ignoreWater);
      this.dead = true;
      return;
    }
    this.ai0 += 1;
    // 574 随父存续（:32092 每 tick timeLeft=2 刷新,自身永不过期——父亡已在上行 Kill）
    if (this.kind === 574) this.life = 2;
    if (this.life-- <= 0) {
      // ★⑥杀拍口径（2026-09-06）：539 寿命尽——原版 timeLeft--/Kill 在子步【末尾】
      //  （:17307-17311,AI(:16880)→湿段(:16895)→位移→Damage 之后）→ 寿命尽当拍湿段
      //  照跑。本仓递减杀在拍头曾跳过湿段;现补跑。测位=存储位：539 寿命期(600t)
      //  已入冲刺相（ai0>210）,AI 只写 velocity/帧/尘不写 position（:34023+）,
      //  原版杀拍湿段测位=上拍位移末位=存储位,逐值等价。539 ∉ IsDestroyedByWater
      //  六型/非 80 → 段内无补 Kill 面;与 AI 尾活拍调用点同拍互斥（早退）。
      projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
        this.kind, !!projectileData(this.kind)?.ignoreWater);
      this.explode(game);
      return;
    }
    if (this.ai0 < orbitT) {
      if (alive) {
        // 盘旋:随父位移 + 符号步进逼近父心(钳 6)(:32100-32118)
        this.x += parent!.x - parent!.prevX;
        this.y += parent!.y - parent!.prevY;
        this.vx += Math.sign(parent!.cx - this.cx) * 0.15;
        this.vy += Math.sign(parent!.cy - this.cy) * 0.075;
        const v = Math.hypot(this.vx, this.vy);
        if (v > 6) { this.vx = (this.vx / v) * 6; this.vy = (this.vy / v) * 6; }
        if (this.kind === 539 && ++this.frameT >= 4) { this.frameT = 0; this.frame++; }
      } else {
        // :32106-32110 父亡（仅 539）→ 计时直接置满 → 同 tick 落入下方冲刺分支立即开冲
        this.ai0 = orbitT;
      }
    }
    if (this.ai0 === orbitT) {
      // 目标（:32175-32196）：539（flag47=true）→ Player.FindClosest 最近玩家；
      // 574（flag47=false）→ 父 420 的索敌目标 Main.npc[ai[1]].target（父在生时，
      // 父亡/失效 → FindClosest 兜底——574 父亡已在上行 Kill，兜底仅为类型安全）
      // ——M11 索敌链（原版 Main.player[num861]）
      const p: Player | null = this.kind === 539
        ? findClosestPlayer(game, this.cx, this.cy)
        : (parent!.targetRef?.(game) ?? findClosestPlayer(game, this.cx, this.cy));
      if (p) {
        if (this.kind === 539) {
          // 直冲最近玩家(:32185-32212):方向 ±50px 抖动 ×0.8-1.2,16 速
          const tx = p.cx + (Math.random() * 100 - 50), ty = p.cy + (Math.random() * 100 - 50);
          const kx = 0.8 + Math.random() * 0.4, ky = 0.8 + Math.random() * 0.4;
          const dx = (tx - this.cx) * kx, dy = (ty - this.cy) * ky;
          const d = Math.hypot(dx, dy) || 1;
          this.vx = (dx / d) * 16; this.vy = (dy / d) * 16;
        } else {
          // 线发 576 弹(:32204-32211):CanHitLine 门,8 速 65 伤;发射后重置计时。
          // v6 傀儡不本地线发——房主的 576 弹经 msg27 同步,双端各发会翻倍
          if (!this.netPuppet && !p.dead && canHitLine(game.world.store, this.cx, this.cy, 0, 0, p.cx, p.cy, 0, 0)) {
            const dx = p.cx - this.cx, dy = p.cy - this.cy;
            const d = Math.hypot(dx, dy) || 1;
            (game as unknown as { entities: { add: (x: unknown, b: string) => void } }).entities.add(
              new Arrow(this.cx, this.cy, (dx / d) * 8, (dy / d) * 8, 65, 0, 576,
                { grav: 0, life: 600, pierce: 1, hostile: true }), 'projectiles');
            // 弹 576 出生音:Projectile.cs:56327-56331 ai[1]==0 首拍 SoundID.Item12（R8 勘误:
            //  56443-56447 为 numUpdates==1 的 α 面尘 229,非播音行）——
            // 本仓 576 走 Arrow 直飞桶无 ai[1] 态,于发射点等价结算(同 462/259 先例)
            game.playSfxWav?.('Item_12', 1, this.cx, this.cy);
          }
          this.ai0 = 0;
        }
      }
    }
    if (this.kind === 539 && this.ai0 > orbitT && ++this.frameT >= 2) {
      this.frameT = 0; this.frame++;                  // 冲刺段帧率加倍(:32227-32235)
    }
    // ---- ★通用湿段（:16903-17113,projWetSection 共享体 1:1）----
    // 位序 = 原版 Update:AI_102（盘旋/冲刺态机完,父体跟随直写位已发生）→ 本段 →
    // HandleMovement/UpdatePosition（测位 = post-AI 盘旋跟随位,原版同位）。
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.kind, !!projectileData(this.kind)?.ignoreWater);
    // 位移（按 kind 阻尼分叉,见字段块头注）：539 tileCollide=true → 速度积分乘档
    // （速度场不减只削当拍位移）;574 tileCollide=false → wet 走 AI 前快照（无阻尼
    // 滞后一子步 quirk）/ dry 走 post-AI velocity。父体跟随直写位移两档均不受阻尼。
    if (this.kind === 539) {
      const df539 = projWaterDragFactor(this);
      this.x += this.vx * df539; this.y += this.vy * df539;   // 539 tileCollide
    } else if (this.wet) {
      this.x += preVx; this.y += preVy;                       // 574 湿态=:16870 快照
    } else {
      this.x += this.vx; this.y += this.vy;                   // 574 dry=post-AI 速度
    }
    if (this.kind === 539) {
      const st = game.world.store;
      const tx = Math.floor(this.cx / TILE), ty = Math.floor(this.cy / TILE);
      if (st.inBounds(tx, ty) && st.isSolid(tx, ty)) { this.explode(game); return; }
    }
  }

  /** 539 亡时 80×80 范围伤害 + 尘爆(:69366-69405) */
  private explode(game: GameHooks): void {
    this.dead = true;
    game.spawnParticles(this.cx, this.cy, '#8FE8FF', 20, 3.4, { life: 40, damp: 0.94 });
    game.spawnParticles(this.cx, this.cy, '#4FB8E8', 10, 2.2, { life: 36, damp: 0.94 });
    // ★victim-settles：范围伤害盒恒查本地玩家（damagePlayer 只结算本地血；kind8
    //  傀儡在访客端本地重建各查各的 game.player）——非索敌残留,勿改 targetRef
    const p = game.player;
    if (p && !p.dead && this.dmg > 0) {
      const half = 40;                                // 80×80 居中
      if (p.x < this.cx + half && p.x + p.w > this.cx - half
        && p.y < this.cy + half && p.y + p.h > this.cy - half) {
        // Damage_EVP：539/574 生成基础 60，命中再过乘区×2
        // SW-BL1 2026-09-06：attacker 位显式 null（运行时等价 undefined,falsy 同面）
        // 改缺省——GameHooks.damagePlayer 类型闸收窄（SW-BI1 两起 attacker 槽事故后）
        // 后 null 不再入域,语义零变化
        game.damagePlayer(hostileProjectileDamage(this.dmg, mainDifficulty(game.world)) * 2, this.cx, this.cy, undefined, undefined, undefined, undefined, { projDomain: true, projVid: this.kind });   // ★R-B-F10(第4=knockback 位,opts 第5)(2026-10-14):弹域双旗点亮(Game.ts damagePlayer :44480 门=projDomain&&projVid;★BJ704-R3 P1:旧单旗=静默 no-op)
      }
    }
  }

  draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const img = projFrameImg(this.kind, this.kind === 574 ? 1 : this.frame);
    ctx.save();
    ctx.translate(this.cx, this.cy);
    // 539 旋转分两段（AI_102）：盘旋期 vx*0.1（:32135）/冲刺期向 ToRotation+π/2 收敛
    // （:32230 AngleLerp 0.4）;574 向瞄准向 ToRotation+π/2 收敛（:32167）。此处 539 恒用
    // 盘旋档（冲刺段姿态差登记偏差）
    ctx.rotate(this.kind === 539 ? this.vx * 0.1 : Math.atan2(this.vy, this.vx) + Math.PI / 2);
    ctx.imageSmoothingEnabled = false;
    if (img) {
      // 原生帧 × scale=1（SetDefaults 539/574 无 scale;origin = 帧格 Size/2,Main.cs:32812
      // 列表族 :32889）。曾归一到判定盒 18×30/18×18 → 539 纵横比失真（G11）
      ctx.drawImage(img, -img.width / 2, -img.height / 2, img.width, img.height);
      // ★BJ109-B：GlowMask 加色外发光 pass（Main.cs:34491-34496 539=GlowMask[140]/
      //  :34503-34508 574=GlowMask[148]）——色 Color(255,255,255,0)=A=0 纯加算白满强
      //  （不读 α/不取格光，原版自发光），源矩形=本体当前帧矩形、同 rotation 同 origin。
      //  本仓 world 层直绘 lighter 后仍吃 compositeLight 乘光（黑暗处弱于原版）——
      //  与 537/540/455/580 加算族同批登记偏差；Self-luminous 地板面归 Renderer
      //  SELF_LUMINOUS_PROJS（交接单另列）。
      const glowTtl = this.kind === 539 ? orbGlow140Ttl : orbGlow148Ttl;
      const glow = glowTtl.get();
      if (glow && glow.width > 0) {
        const frames = this.kind === 539 ? 4 : 2;
        const fIdx = this.kind === 574 ? 1 : this.frame;
        const fh = Math.floor(glow.height / frames);
        const sy = Math.min(frames - 1, Math.max(0, fIdx)) * fh;
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(glow, 0, sy, glow.width, fh,
          -img.width / 2, -img.height / 2, img.width, img.height);
        ctx.globalCompositeOperation = 'source-over';
      }
    } else {
      ctx.fillStyle = this.kind === 539 ? '#8FE8FF' : '#C060FF';
      ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
    }
    ctx.restore();
  }
}

// ===================== 星旋塔传送门弹 578/579（aiStyle 108，Projectile.cs:32505-32805） =====================
// 塔侧生成（Enemy.towerAI 422 段，NPC.cs:39663-39733）：支线 a = 玩家头顶门
// （579 生 2× Alien Hornet 427 / 578 放 580 电击）；支线 b = 玩家 ±20 格随机
// 空中点 579 门。SetDefaults（:6002-6012）：32×32 / tileCollide=false / alpha 255 /
// ignoreWater（friendly+hostile 同置——damage=0 无结算面）。
// 生命周期（ai0，1:1）：开门爆尘（ai1==1 → 25 颗 229/161 尘 ×3.5 速，:32508-32523，
// 579 开门当帧置 ai1=1、次帧爆）→ 首帧 Item_117（:32524-32528）→ 578 首帧定朝向
// （ai1 = 门→最近玩家角，:32529-32538）→ ≤50t 隐形聚尘（579 双环尘 229/240、578 沿
// 朝向喷流，:32541-32599）→ 51-90t 显形（scale=(ai0−50)/40、alpha=255×(1−scale)、
// rotation−π/20/t；恰 90t 播 Item_113（578/579）并【开门】：578 → 生成 580 电击弹
// （50 伤，速度=朝向×8，出生点=门心−速度向量，ai0=朝向角、ai1=Next(80) 种子，
// :32650-32660）；579 → 生 2× NPC427（门心 Bottom 锚，速度=−UnitY.RotatedByRandom
// (2π)×Next(4,9)−UnitY×2，:32661-32676）→ 91-120t 满显（scale 1/alpha 0/
// rotation−π/60，环尘 customData=门心，:32677-32712）→ 121-180t 收缩淡出
// （scale=1−(ai0−120)/60、alpha 递增、rotation−π/30；alpha≥255 Kill，:32713-32755）。
// 绘制（Main.cs:32622-32650）：Extra_50 涡旋三层（−rot+0.35 暗色 ×(0.6+scale×0.6×
// num347) / −rot ×scale / rot×0.5 ×scale×0.9）+ Projectile_578/579.png（−rot×0.7，
// α×0.4），num347=0.95+sin(rotation×0.75)×0.1。
/** Extra_50（60×60 星旋涡旋）懒加载 */
const portalSwirlTtl = new TtlSprite('sprites/vanilla/Extra_50.png');
function extra50(): ImageBitmap | HTMLImageElement | null {
  return portalSwirlTtl.get();   // TTL 自愈装载(2026-08-25 同类扫描)
}

export class VortexPortalProj extends Entity {
  readonly projId: number;         // 578 / 579
  w = 32; h = 32;                  // SetDefaults :6003-6004
  private ai0 = 0;
  /** 578：门朝向角（首帧定）；579：开门爆尘标记（1=待爆） */
  private ai1 = 0;
  private lai0 = 0;                // localAI[0]：578 朝向初始化门
  private alpha = 255;
  private scale = 1;
  private rot = 0;
  private sndPlayed = false;       // localAI[1]

  // ---- ★通用湿段（Projectile.cs:16903-17113,projWetSection.ts 共享体 1:1）----
  //  豁免核对（双 id 合块）：578 VortexVortexLightning / 579 VortexVortexPortal
  //  SetDefaults P.cs:6284-6294（32×32/aiStyle 108/friendly/alpha 255/
  //  tileCollide=false/ignoreWater=true【:6291】/hostile/drawLayer 1）→ 两 id 全豁免
  //  （数据面 PROJ_IGNORE_WATER 亦含 578/579）→ 段门恒闭（:16903）= 原版零行为
  //  （字段照加、段照调,豁免分流由 ignoreWater 参数自动承载）。阻尼不适用（双证）：
  //  ①豁免;②零速定点门体（AI 全程不积分 velocity,位置仅出生锚定）。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价） */
  presetDone = false;

  /** x/y = NewProjectile 的 X/Y（中心锚，:10258）；type ∈ {578, 579} */
  constructor(x: number, y: number, projId: 578 | 579) {
    super();
    this.x = x - this.w / 2;
    this.y = y - this.h / 2;
    this.projId = projId;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    // ★通用湿段（:16903-17113）——578/579 豁免 id（P.cs:6291 ignoreWater=true）→
    //  段门恒闭零行为;插 tick 头与 AI/位移序无观察差（段内唯一可见面=溅花,豁免即恒无）
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater);
    // 开门爆尘（:32508-32523）：ai1==1 → 25 颗尘（229/229/161 掷、×3.5..4 速、scale
    // 1.75+1.25r、fadeIn 0.25、noLight）
    if (this.ai1 === 1) {
      this.ai1 = 0;
      for (let i = 0; i < 25; i++) {
        const type = [229, 229, 161][(Math.random() * 3) | 0];   // SelectRandom
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, type, 0, 0, 0, null,
          1.75 + Math.random() * 1.25);
        if (d) {
          d.vx *= 3.5 + Math.random() * 0.5;
          d.vy *= 3.5 + Math.random() * 0.5;
          d.fadeIn = 0.25;
          d.noLight = true;
        }
      }
    }
    if (!this.sndPlayed) {                                       // :32524-32528
      this.sndPlayed = true;
      game.playSfxWav?.('Item_117', 1, this.x, this.y);
    }
    // 578 首帧定朝向（:32529-32538）：门心→最近玩家角（零向量兜底 UnitY）。
    // 最近玩家 = Player.FindClosest(Center,0,0)（M11 索敌链：联机含访客代理）
    if (this.projId === 578 && this.lai0 === 0) {
      this.lai0 = 1;
      const p = findClosestPlayer(game, this.cx, this.cy);
      let dx = 0, dy = 1;
      if (p) { dx = p.cx - this.cx; dy = p.cy - this.cy; }
      if (dx === 0 && dy === 0) { dx = 0; dy = 1; }
      this.ai1 = Math.atan2(dy, dx);
    }
    this.ai0++;
    const em = (game as unknown as { entities: { add: (e: Entity, b: string) => void } }).entities;
    if (this.ai0 <= 50) {
      // ---- 聚尘段（:32541-32599；全隐形 alpha 255）----
      if (this.projId === 579) {
        for (let k = 0; k < 2; k++) {           // :32541-32562 双环尘（各 1/4 掷）
          if (Math.floor(Math.random() * 4) === 0) {
            const a = Math.random() * TAU;
            const [ux, uy] = [Math.sin(a), Math.cos(a)];          // UnitY.RotatedByRandom(2π) 近似
            const d = game.spawnDust?.(this.cx - ux * 30, this.cy - uy * 30, 0, 0, 229, 0, 0, 0, null, 1, true);
            if (d) {
              d.x = this.cx - ux * (10 + Math.floor(Math.random() * 11));   // Next(10,21)
              d.y = this.cy - uy * (10 + Math.floor(Math.random() * 11));
              d.vx = -uy * 4; d.vy = ux * 4;      // RotatedBy(+π/2)×4
              d.scale = 0.5 + Math.random();
              d.fadeIn = 0.5;
              d.attractTo = { x: this.cx, y: this.cy };   // customData=base.Center 快照（:34443）
            }
          }
          if (Math.floor(Math.random() * 4) === 0) {
            const a = Math.random() * TAU;
            const [ux, uy] = [Math.sin(a), Math.cos(a)];
            const d = game.spawnDust?.(this.cx - ux * 30, this.cy - uy * 30, 0, 0, 240, 0, 0, 0, null, 1, true);
            if (d) {
              d.x = this.cx - ux * 30; d.y = this.cy - uy * 30;
              d.vx = uy * 2; d.vy = -ux * 2;       // RotatedBy(−π/2)×2
              d.scale = 0.5 + Math.random();
              d.fadeIn = 0.5;
            }
          }
        }
      } else if (Math.floor(Math.random() * 2) === 0) {
        // 578 沿朝向喷流（:32564-32594）
        const ang = this.ai1;
        const fx = Math.cos(ang), fy = Math.sin(ang);             // ai1.ToRotationVector2()
        const side = Math.random() < 0.5 ? -1 : 1;
        const off = 10 + Math.floor(Math.random() * 11);          // Next(10,21)
        const px = -fy * side * off, py = fx * side * off;        // 旋 π/2 ×±
        const along1 = Math.floor(Math.random() * 161) - 80;      // Next(-80,81)
        const d1 = game.spawnDust?.(this.cx + px, this.cy + py, 0, 0, 229, 0, 0, 0, null, 1, true);
        if (d1) {
          d1.x = this.cx + px; d1.y = this.cy + py;
          d1.vx = (along1 * fx - px) / 10; d1.vy = (along1 * fy - py) / 10;
          d1.scale = 0.5 + Math.random();
          d1.fadeIn = 0.5;
        }
        const along2 = 40 + Math.floor(Math.random() * 81);       // Next(40,121)
        const d2 = game.spawnDust?.(this.cx + px / 2, this.cy + py / 2, 0, 0, 229, 0, 0, 0, null, 1, true);
        if (d2) {
          d2.x = this.cx + px / 2; d2.y = this.cy + py / 2;
          d2.vx = (along2 * fx - px / 2) / 10; d2.vy = (along2 * fy - py / 2) / 10;
          d2.scale = 1 + Math.random();
        }
      }
    } else if (this.ai0 <= 90) {
      // ---- 显形段（:32600-32676）：50→90t 张开 ----
      if (this.ai0 === 90) game.playSfxWav?.('Item_113', 1, this.x, this.y);   // :32604-32612
      this.scale = (this.ai0 - 50) / 40;
      this.alpha = 255 - Math.round(255 * this.scale);
      this.rot -= Math.PI / 20;
      if (this.projId === 579) {
        // :32624-32649 开门段尘（1/2 掷、速度 ×6/×3、customData=门心）
        if (Math.random() < 0.5) {
          const a = Math.random() * TAU;
          const [ux, uy] = [Math.sin(a), Math.cos(a)];
          const d = game.spawnDust?.(this.cx - ux * 30, this.cy - uy * 30, 0, 0, 229, 0, 0, 0, null, 1, true);
          if (d) {
            d.x = this.cx - ux * (10 + Math.floor(Math.random() * 11));
            d.y = this.cy - uy * (10 + Math.floor(Math.random() * 11));
            d.vx = -uy * 6; d.vy = ux * 6;        // RotatedBy(+π/2)×6
            d.scale = 0.5 + Math.random();
            d.fadeIn = 0.5;
            d.attractTo = { x: this.cx, y: this.cy };   // customData=门心快照（终清波批接 :906-912 吸向档）
          }
        }
        if (Math.random() < 0.5) {
          const a = Math.random() * TAU;
          const [ux, uy] = [Math.sin(a), Math.cos(a)];
          const d = game.spawnDust?.(this.cx - ux * 30, this.cy - uy * 30, 0, 0, 240, 0, 0, 0, null, 1, true);
          if (d) {
            d.x = this.cx - ux * 30; d.y = this.cy - uy * 30;
            d.vx = uy * 3; d.vy = -ux * 3;        // RotatedBy(−π/2)×3
            d.scale = 0.5 + Math.random();
            d.fadeIn = 0.5;
          }
        }
      } else {
        // 578 喷流尘（每 tick 恒 1 颗，:32652-32663）
        const ang = this.ai1;
        const fx = Math.cos(ang), fy = Math.sin(ang);
        const side = Math.random() < 0.5 ? -1 : 1;
        const off = 10 + Math.floor(Math.random() * 11);
        const px = -fy * side * off, py = fx * side * off;
        const along = Math.floor(Math.random() * 161) - 80;
        const d = game.spawnDust?.(this.cx + px, this.cy + py, 0, 0, 229, 0, 0, 0, null, 1, true);
        if (d) {
          d.x = this.cx + px; d.y = this.cy + py;
          d.vx = (along * fx - px) / 10; d.vy = (along * fy - py) / 10;
          d.scale = 0.5 + Math.random();
          d.fadeIn = 0.5;
        }
      }
      // ---- 恰 90t 开门（:32650-32676）----
      if (this.ai0 === 90) {
        if (this.projId === 578) {
          // 580 电击弹（:32650-32660）：出生点=门心−朝向×8、速度=朝向×8、50 伤、
          // ai0=朝向角、ai1=Next(80) 种子
          const fx = Math.cos(this.ai1) * 8, fy = Math.sin(this.ai1) * 8;
          em.add(new LightningBoltProj(this.cx - fx, this.cy - fy, fx, fy, 580, 50,
            this.ai1, Math.floor(Math.random() * 80)), 'projectiles');
        } else {
          // 2× Alien Hornet 427（:32661-32676）：门心 Bottom 锚（NewNPC :81594），
          // 速度=−UnitY.RotatedByRandom(2π)×Next(4,9)−UnitY×2
          this.ai1 = 1;                       // 次帧开门爆尘
          for (let i = 0; i < 2; i++) {
            const hornet = spawnVanillaEnemy(game, 427, this.cx, this.cy);
            if (!hornet) continue;
            hornet.y -= hornet.h / 2;         // 中心锚 → Bottom 锚换算
            const a = Math.random() * TAU;
            const sp = 4 + Math.random() * 5;  // Next(4,9)
            hornet.vx = Math.sin(a) * sp;      // −UnitY 旋转 a：(sin a, −cos a)
            hornet.vy = -Math.cos(a) * sp - 2;
          }
        }
      }
    } else if (this.ai0 <= 120) {
      // ---- 满显段（:32677-32712）----
      this.scale = 1;
      this.alpha = 0;
      this.rot -= Math.PI / 60;
      if (Math.random() < 0.5) {
        const a = Math.random() * TAU;
        const [ux, uy] = [Math.sin(a), Math.cos(a)];
        const type = Math.random() < 0.5 ? 229 : 240;
        const d = game.spawnDust?.(this.cx - ux * 30, this.cy - uy * 30, 0, 0, type, 0, 0, 0, null, 1, true);
        if (d) {
          if (type === 229) {
            d.x = this.cx - ux * (10 + Math.floor(Math.random() * 11));
            d.y = this.cy - uy * (10 + Math.floor(Math.random() * 11));
            d.vx = -uy * 6; d.vy = ux * 6;        // RotatedBy(+π/2)×6
          } else {
            d.x = this.cx - ux * 30; d.y = this.cy - uy * 30;
            d.vx = uy * 3; d.vy = -ux * 3;        // RotatedBy(−π/2)×3
          }
          d.scale = 0.5 + Math.random();
          d.fadeIn = 0.5;
        }
      }
    } else {
      // ---- 收缩淡出段（:32713-32755）----
      this.scale = 1 - (this.ai0 - 120) / 60;
      this.alpha = 255 - Math.round(255 * this.scale);
      this.rot -= Math.PI / 30;
      if (this.alpha >= 255) { this.dead = true; return; }
      if (Math.random() < 0.5) {
        const a = Math.random() * TAU;
        const [ux, uy] = [Math.sin(a) * this.scale, Math.cos(a) * this.scale];
        const type = Math.random() < 0.5 ? 229 : 240;
        const d = game.spawnDust?.(this.cx - ux * 30, this.cy - uy * 30, 0, 0, type, 0, 0, 0, null, 1, true);
        if (d) {
          if (type === 229) {
            d.x = this.cx - ux * (10 + Math.floor(Math.random() * 11));
            d.y = this.cy - uy * (10 + Math.floor(Math.random() * 11));
            d.vx = -uy * 6; d.vy = ux * 6;        // RotatedBy(+π/2)×6
          } else {
            d.x = this.cx - ux * 30; d.y = this.cy - uy * 30;
            d.vx = uy * 3; d.vy = -ux * 3;        // RotatedBy(−π/2)×3
          }
          d.scale = 0.5 + Math.random();
          d.fadeIn = 0.5;
        }
      }
    }
  }

  draw(r: Renderer, _cam: Camera): void {
    // Main.cs:32622-32650：Extra_50 涡旋三层 + 本体贴图（−rot×0.7、α×0.4）
    const ctx = r.ctx;
    if (!ctx) return;
    const opacity = (255 - this.alpha) / 255;
    if (opacity <= 0) return;
    const swirl = extra50();
    const img = projSprite(this.projId);
    const num347 = 0.95 + Math.sin(this.rot * 0.75) * 0.1;   // (rot*0.75).ToRotationVector2().Y
    const scale11 = 0.6 + this.scale * 0.6 * num347;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = opacity;
    ctx.translate(this.cx, this.cy);
    const drawSwirl = (rotA: number, s: number, dim: number) => {
      if (!swirl || !(swirl.width > 0)) return;
      if (dim < 1) ctx.globalAlpha = opacity * dim;
      const sz = 60 * s;
      ctx.save();
      ctx.rotate(rotA);
      ctx.drawImage(swirl, -sz / 2, -sz / 2, sz, sz);
      ctx.restore();
      ctx.globalAlpha = opacity;
    };
    drawSwirl(-this.rot + 0.35, scale11, 0.5);   // 暗层（Lerp(色,黑,0.5) 近似）
    drawSwirl(-this.rot, this.scale, 1);
    if (img && img.width > 0) {
      ctx.save();
      ctx.rotate(-this.rot * 0.7);
      ctx.globalAlpha = opacity * 0.4;           // color90：×0.8 且 A/2
      const sz = Math.max(img.width, img.height) * this.scale;
      ctx.drawImage(img, -sz / 2, -sz / 2, sz, sz);
      ctx.restore();
      ctx.globalAlpha = opacity;
    }
    drawSwirl(this.rot * 0.5, this.scale * 0.9, 0.8);   // ×0.8 尾层
    ctx.restore();
  }
}
