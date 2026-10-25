// 石巨人 Boss 族 AI 1:1 移植(Terarria1456,1.4.5.6):
//   本体 245  aiStyle 45  AI_045_Golem        NPC.cs:19447-19722(地面蓄力→跳跃循环/断臂尘/离场)
//   挂载头 246 aiStyle 46                       NPC.cs:31273-31499(锚本体;嘴部火焰弹/眼激光)
//   拳 247/248 aiStyle 47  AI_047_GolemFist    NPC.cs:19171-19446(肩锚归位→蓄力→直线冲拳→回位)
//   自由头 249 aiStyle 48  GolemHeadFree       NPC.cs:31500-31741(自主悬浮+火焰弹/眼激光)
//   SetDefaults:NPC.cs:12095-12149(245-249 属性);:17942-17962 = getGoodAdjustments
//   (FTW 专属:245-249 scale×0.5、245-248 canDisplayBuffs=false——普通世界无此调整)。
// 经典模式主链 1:1;getGoodWorld 分支已实装(balance +2/+3/蓄力 +100/本体+拳落体砸
// 火把/FTW 断臂尘由砸火把取代);expert 分支保留注释;netcode 跳过。
// 尘真值面已全量实装(2026-09-01 终清波):断臂 Dust31×双臂流+1/10 火星(:19626-19663)/
// 拳聚能向心收敛 228 圆盘(:19374-19390)/冲拳焰尾 306 OurFavoriteColor scale2(:19455-19460)/
// 自由头排焰双流 228(:31796-31812);仅 Gore 族(netcode 关联)维持不接。
//
// 死亡链(任务约定,原版 checkDead 语义的对齐版):
//   · 挂载头在场时本体无敌(NPC.cs:19513 dontTakeDamage = flag)——一阶段打头/拳;
//   · 本体血尽 → 死亡演出 60t 后真死(ai3=1 标记),挂载头转自由态续战(本体死透后头继续);
//   · 挂载头血尽 → 原地转自由态(原版 HitEffect :85842-85847 在原地 NewNPC 249;
//     此处头原体变身,满血+属性对齐 249 SetDefaults),本体解除无敌;
//   · 自由头血尽 → 全族自毁(战斗结束;原版由 245 死亡置 downedGolemBoss,:80146)。
//   以上转换全部在各自 AI 首行处理,不依赖外部钩子。
import type { Enemy } from './Enemy';
import type { GameHooks } from './types';
import type { Player } from './Player';
import { TILE } from '../core/constants';
import { TILE_DEFS } from '../data/tiles';
import { vanillaNpc } from '../data/vanillaNpcs';
import { scaleStats, type ScalingStats } from '../stats/ScaleStats';   // BJ712-A:自由头兜底 249 档缩放终值
import { spawnPart, spawnVanillaEnemy, shoot, accelTo, losClear } from './bossAI';

// ---- Main.rand 掷面工具（本文件石巨人尘块专用）----
/** NextFloat() ∈ [0,1) */
const rf = (): number => Math.random();
/** NextFloatDirection() ∈ [-1,1)（Utils 语义：2×NextFloat−1） */
const rfDir = (): number => Math.random() * 2 - 1;
/** NextVector2Circular(hw,hh)=NextVector2Unit()×(hw,hh)×NextFloat()
 *  （Utils.cs:1296-1304：单位圆角 θ=2π·rand → 半径 rand 各向异性缩放=圆盘抽样,
 *  ★非逐轴矩形均匀——本仓 fx/orchestraFx 的同名词件是矩形近似,勿混用） */
const circular = (hw: number, hh = hw): { x: number; y: number } => {
  const a = Math.random() * Math.PI * 2, f = Math.random();
  return { x: Math.cos(a) * hw * f, y: Math.sin(a) * hh * f };
};
/** OurFavoriteColor(255,231,69,255)（Main.cs:886——尘 306 焰尾色源） */
const FAVORITE_RGB = { r: 255, g: 231, b: 69, a: 255 };
// 台账批 2026-08-31:私有三列采样 collideGround 退役 → 本仓 physics 基建 moveAndCollide
// 1:1(Collision.cs:2299 TileCollision + SlopeCollision + StepUp/StepDown 全语义——
// 140px 体宽的旧采样点 [x+2,cx,x+w−2] 间各有 ~68px 盲带,四列实心可悬空/坡面不贴合)
import { moveAndCollide } from '../physics/TileCollision';

/** 原版 NPC 通用重力/maxFall(NPC.UpdateNPC 非 noGravity 族:0.3/2t、maxFall 10) */
const GRAV = 0.3;
const MAX_FALL = 10;
/** 运行时 scale(npc.scale 实例字段:普通世界 1 / FTW getGoodAdjustments :17942-17962 ×0.5)。
 *  ★曾误读 :17943 为无条件 SetDefaults 段写成恒 0.5——普通世界头/拳锚点全缩半=部件嵌错位(2026-08-19 修) */
const sc = (n: { vanillaScale?: number | null }): number => n.vanillaScale ?? 1;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Boss 伤害/防御基值缓存(自由头切换 249 属性时从基值派生,防重复写膨胀) */
const baseStats = new WeakMap<Enemy, { dmg: number; def: number }>();
const baseOf = (e: Enemy) => {
  let b = baseStats.get(e);
  if (!b) { b = { dmg: e.def.damage, def: e.def.defense ?? 0 }; baseStats.set(e, b); }
  return b;
};

/** 每实例附加槽位(原版 alpha/noTileCollide/localAI 等无对应 Enemy 字段) */
interface BodyX { alpha: number; noTC: boolean; dying: boolean; deadT: number }
interface HeadX { alpha: number; free: boolean; l0: number; l1: number }
interface FistX { alpha: number; noTC: boolean; state: number }
const bodyX = new WeakMap<Enemy, BodyX>();
const headX = new WeakMap<Enemy, HeadX>();
const fistX = new WeakMap<Enemy, FistX>();
const bodyXOf = (e: Enemy): BodyX => {
  let x = bodyX.get(e);
  if (!x) { x = { alpha: 255, noTC: false, dying: false, deadT: 0 }; bodyX.set(e, x); }
  return x;
};
const headXOf = (e: Enemy): HeadX => {
  let x = headX.get(e);
  if (!x) { x = { alpha: 255, free: false, l0: 0, l1: 0 }; headX.set(e, x); }
  return x;
};
const fistXOf = (e: Enemy): FistX => {
  let x = fistX.get(e);
  if (!x) { x = { alpha: 255, noTC: true, state: 0 }; fistX.set(e, x); }
  return x;
};

// ---------------------------------------------------------------------------
// 族内查找(原版静态 golemBoss 索引的等价物:NPC.cs:6052 声明、:19449 每帧回填)
// ---------------------------------------------------------------------------

const findBody = (game: GameHooks): Enemy | null =>
  (game.enemies() as Enemy[]).find((n) => !n.dead && n.vanillaId === 245) ?? null;
const findHead = (game: GameHooks): Enemy | null =>
  (game.enemies() as Enemy[]).find((n) => !n.dead && (n.vanillaId === 246 || n.vanillaId === 249)) ?? null;

/** GetMyBalance + getGoodWorld/脱离神庙/丛林加成(NPC.cs:19450-19457 / :19173-19180 /
 *  :31274-31282 / :31506-31512):
 *  经典单人 = 1;getGoodWorld 本体 +2、拳/挂载头/自由头 +3(先加再乘);
 *  (!ZoneLihzhardTemple && !ZoneJungle) || 玩家 Center.Y < worldSurface*16 → ×2(expert 档略)。
 *  Zone 判定接 Game.scene(SceneMetrics):zoneTemple = 中心格墙 87(SceneMetrics.cs:688,
 *  神庙砖 226 不构成独立 Zone,只计入 JungleTileCount——SceneMetrics.cs:613,阈值 140)。 */
const balanceNum = (game: GameHooks, player: Player | null, ftwBonus = 0): number => {
  let num = 1;
  if (ftwBonus > 0 && game.world.seedFlags?.getGoodWorld) num += ftwBonus;
  const s = game.scene;
  const inTempleOrJungle = !!s?.zoneTemple || !!s?.zoneJungle;
  if (!inTempleOrJungle || (player != null && player.cy < game.world.groundLevel * TILE)) num *= 2;
  return num;
};

/** getGoodWorld 落体砸火把(TileID.Sets.Torches = tile 4;NPC.cs:19510-19532 本体 /
 *  :19335-19366 拳冲拳段):像素带内激活的火把格直接置非激活(无掉落/无音效)。
 *  火把判定同 TorchGod:sheet===4(仓内 tile id 空间非原版号)。
 *  ★ 调用方照原版传带界——本体 Y 上界用 width(非 height)是原版笔误,1:1 保留 */
const smashTorches = (
  st: GameHooks['world']['store'],
  x0: number, x1: number, y0: number, y1: number,
): void => {
  for (let j = Math.floor(x0 / TILE); j < x1 / TILE; j++) {
    for (let k = Math.floor(y0 / TILE); k < y1 / TILE; k++) {
      if (!st.inBounds(j, k)) continue;
      const i = st.idx(j, k);
      if (st.flags[i] && TILE_DEFS[st.type[i]]?.vanilla?.sheet === 4) st.setTile(j, k, 0);
    }
  }
};

/** 出生渐显(SetDefaults alpha=255;AI 内 alpha -= 10/2t,NPC.cs:19477-19485 / :31310-31317 / :19187-19194)。
 *  返回剩余 alpha;期间 ai[1] 由调用方冻结(本体/拳 0、挂载头 30)——蓄力计时不起跑 */
const fadeAlpha = (e: Enemy, x: { alpha: number }): number => {
  if (x.alpha <= 0) return 0;
  x.alpha = Math.max(0, x.alpha - 10);
  e.spawnAlpha = Math.min(254, x.alpha);
  return x.alpha;
};

// ---------------------------------------------------------------------------
// 碰撞:私有三列采样 collideGround 已退役(台账批 2026-08-31)。石巨人族走
// physics/TileCollision.moveAndCollide —— Collision.cs:2299 TileCollision 全语义
// (整盒逐 tile 扫描/半砖 carve/坡面整块+对角线贴合 SlopeCollision/平台单向),
// 修正旧采样器 [x+2,cx,x+w−2] 三点间 ~68px×2 盲带导致的悬空站立与坡面漂移。
// 原版 NPC 族物理(Collision_MoveNormal :93866)= velocity = TileCollision(...) 后
// position += velocity;moveAndCollide 的分轴实现同样在碰撞时清零对应轴速度并置
// collideX/collideY/onGround(消费点见拳态机冲拳撞停分支)。
// ---------------------------------------------------------------------------

/** AABB 与实心块相交(原版 Collision.SolidTiles 近似):拳冲拳段关闭穿墙后的撞停判定 */
function hitSolid(game: GameHooks, e: Enemy): boolean {
  const st = game.world.store;
  const x0 = Math.floor(e.x / TILE), x1 = Math.floor((e.x + e.w - 0.01) / TILE);
  const y0 = Math.floor(e.y / TILE), y1 = Math.floor((e.y + e.h - 0.01) / TILE);
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      if (st.inBounds(tx, ty) && st.isSolid(tx, ty)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// 弹幕(原版 NewProjectile 调用点:id 258 火焰弹 / 259 眼激光)
// ---------------------------------------------------------------------------

/** 嘴部/额前火焰弹(:31329-31347 / :31430-31447 / :31596-31617):
 *  从 (e.center + (ox,oy)) 朝玩家中心 proj 258。
 *  出生音 Item20 = 弹幕 258 自身首 tick 播(Projectile.cs:22540-22541,
 *  localAI[0]==0)——Arrow 无 per-弹出生音钩子,在发射点等效播(仅石巨人用 258) */
function golemSpit(
  game: GameHooks, e: Enemy, player: Player, ox: number, oy: number,
  spd: number, dmg: number, projId: number,
): void {
  const sx = e.cx + ox, sy = e.cy + oy;
  const dx = player.cx - sx, dy = player.cy - sy;
  const d = Math.hypot(dx, dy) || 1;
  shoot(game, sx, sy, (dx / d) * spd, (dy / d) * spd, dmg, projId);
  game.playSfxWav?.('Item_20', 1, sx, sy);
}

/** 挂载头眼激光(:31459-31484):双侧眼(±18*scale,-22*scale)各一发 11 速;
 *  玩家在头正上/下方(localAI[1]==0)→ 双眼齐射,否则朝向侧单眼(±30*scale)12 速;伤 28,proj 259。
 *  出生音 Item33 = 弹 259 自身播(pcs:52356-52364;发射点等效) */
function golemEyeLasers(game: GameHooks, e: Enemy, player: Player, side: number): void {
  const fire = (ox: number, spd: number) => {
    const sx = e.cx + ox, sy = e.cy - 22 * sc(e);
    const dx = player.cx - sx, dy = player.cy - sy;
    const d = Math.hypot(dx, dy) || 1;
    const vx = (dx / d) * spd, vy = (dy / d) * spd;
    shoot(game, sx + vx * 3, sy + vy * 3, vx, vy, 28, 259, 300);
    game.playSfxWav?.('Item_33', 1, sx, sy);
  };
  if (side === 0) { fire(-18 * sc(e), 11); fire(18 * sc(e), 11); }
  else fire(side * 30 * sc(e), 12);
}

/** 自由头眼激光(:31659-31717):双眼(±14*scale,-50*scale)各一发 proj 259;
 *  伤 24/速 11,本体(245)残血每降一档 +1 伤/+0.25 速(调用方传本体血量比值 r);
 *  无视线(flag49)→ 伤 ×1.5、速 ×2.5、按玩家速度随机提前量瞄准 */
function golemEyeLasersFree(
  game: GameHooks, e: Enemy, player: Player, noLos: boolean, r: number,
): void {
  for (let i = 0; i < 2; i++) {
    const sx = e.cx + (i === 0 ? -14 : 14) * sc(e);
    const sy = e.cy - 50 * sc(e);
    let dmg = 24, spd = 11;
    if (r < 0.5) { dmg += 1; spd += 0.25; }
    if (r < 0.4) { dmg += 1; spd += 0.25; }
    if (r < 0.3) { dmg += 1; spd += 0.25; }
    if (r < 0.2) { dmg += 1; spd += 0.25; }
    if (r < 0.1) { dmg += 1; spd += 0.25; }
    let tx = player.cx, ty = player.cy;
    if (noLos) {
      dmg = Math.floor(dmg * 1.5);
      spd *= 2.5;
      const pvx = (player as unknown as { vx: number }).vx ?? 0;
      const pvy = (player as unknown as { vy: number }).vy ?? 0;
      tx += pvx * Math.random() * 50;
      ty += pvy * Math.random() * 50;
    }
    const dx = tx - sx, dy = ty - sy;
    const d = Math.hypot(dx, dy) || 1;
    const vx = (dx / d) * spd, vy = (dy / d) * spd;
    shoot(game, sx + vx * 3, sy + vy * 3, vx, vy, dmg, 259, 300);
    game.playSfxWav?.('Item_33', 1, sx, sy);   // 弹 259 出生音(pcs:52356-52364)
  }
}

// ---------------------------------------------------------------------------
// AI_045 石巨人本体 245(NPC.cs:19447-19722)
// ---------------------------------------------------------------------------

/** 挂载头 → 自由态(原版 HitEffect NPC.cs(1458):85904-85919:246 血尽且无任何尘/gore,
 *  仅 `NewNPC(GetSpawnSource_NPCHurt(), (int)Center.X, position.Y+height, 249, whoAmI)`
 *  ——NewNPC 内 `nPC.Bottom = (X,Y)`(:81594)⇒ 底边锚=原头底边;246/249 同为 70×70
 *  (:12207-12251)⇒ 盒逐位重合,fresh 249 走完整 ScaleStats(lifeMax 16000 档)。
 *  2026-09-01 终清波实装:fresh 直生对齐真值;ctor 缺失环境(纯单测 mock 的 spawnVanillaEnemy
 *  空转/failed)退化为在位转换兜底。曾附 '#C04030'×16 演出爆 = 原版全段无此物,删除)
 *  转换音:原版全程无声(HitEffect 仅 NewNPC 249;曾加 roar 系对账行号 :32587 误引——
 *  该行属幻影龙 266 段,石巨人无此吼,2026-08-19 终审删) */
function golemHeadGoFree(e: Enemy, game: GameHooks): void {
  const x = headXOf(e);
  if (x.free) return;
  const fresh = spawnVanillaEnemy(game, 249, Math.round(e.cx), Math.round(e.y + e.h));
  if (fresh) {
    fresh.vx = fresh.vy = 0;
    e.dead = true;          // 原位实体让位(246 死亡零演出,直接 active 移除语义)
    return;
  }
  // ---- 兜底在位转换(仅 mock 无 ctor 环境;语义面同上) ----
  x.free = true;
  e.ai3 = 1;          // 自由态标记(探针/部件锚定可观测)
  e.ai0 = 0; e.ai1 = 0; e.ai2 = 0;
  // ★BJ712-A(转报件5):249 档属性一次性落位 = NewNPC 249 的 ScaleStats 终值
  //  (难度乘区+245-249 族 tweak 0.8)——旧 golemHeadAI 每拍写未缩放基值 80/32
  //  已退场,兜底自带缩放面;血量同档重置,旧「lifeMax 与 fresh 16000 档差 =
  //  本兜底唯一漂移」备案同步闭合
  const fb = freeHead249Stats();
  e.def.damage = fb.damage;
  e.def.defense = fb.defense;
  e.maxHp = fb.lifeMax; e.hp = fb.lifeMax;   // 原版 249 满血登场
  e.spin = 0;         // 新 249 rotation=0——远锚态变身残留 vx*0.1 旋转=永久歪头(终审修)
}

/** 249 自由头 ScaleStats 终值(NewNPC 249 → SetDefaults+ScaleStats :17791 等价;
 *  BJ712-A 兜底在位转换用,fresh 主路径出生自带同值)。boss 位传 false 同果
 * (ForExpertHardmode 豁免门 lifeMax≥1000 先命中)。 */
function freeHead249Stats(): { damage: number; defense: number; lifeMax: number } {
  const v = vanillaNpc(249);
  if (!v) return { damage: 80, defense: 32, lifeMax: 16000 };
  const s: ScalingStats = {
    type: 249, lifeMax: v.lifeMax, damage: v.damage, value: 0,
    defense: v.defense, knockBackResist: v.knockBackResist,
    boss: false, friendly: false, townNPC: false, scale: v.scale, difficulty: 0,
  };
  scaleStats(s);
  return { damage: s.damage, defense: s.defense, lifeMax: s.lifeMax };
}

export function golemAI(e: Enemy, game: GameHooks, player: Player | null) {
  const x = bodyXOf(e);

  // ---- 血尽:主路径在 Enemy.hurt(标准死亡管线;部件随终战消亡由各 AI 锚主
  //      检测自杀——原版同构的下一 tick 时序)。此处仅存量自愈兜底:旧版 hurt
  //      放行年代留下的负血实体(不再受击则 hurt 不触发)——AI 分发只跳 dead
  //      不跳 hp≤0,须在此收口,否则负血条永挂(2026-08-19) ----
  if (e.hp <= 0) {
    // 存量负血本体若 hasHead=true(dont=true)会挡 die→hurt 管线=同自由头挂空险
    // (复审顺手对齐:原版 StrikeNPCNoInteraction 族绕 dontTakeDamage)
    e.dontTakeDamage = false;
    e.die(game);
    return;
  }

  // ---- FindFrame case 245(:73581-73609)状态帧(非循环动画):待机按 ai1 蓄力
  //      倒计分 5 档(-20 蹲伏起步);跳跃 ai0==1 → 原版 frame.Y=1(1 像素笔误值
  //      ≈帧0 微移,取 0)。customFrameIdx 渲染端直读(vanillaFrameIdx)——
  //      曾无特例走通用循环 = 7 帧乱闪(用户报"动画贴图错误",2026-08-19) ----
  e.customFrameIdx = e.ai0 === 1 ? 0
    : e.ai1 < -16 ? 0 : e.ai1 < -12 ? 1 : e.ai1 < -8 ? 2 : e.ai1 < -4 ? 3 : e.ai1 < 0 ? 4 : 0;

  // ---- 首帧:localAI[0]==0 生成部件(NPC.cs:19458-19467) ----
  //  原版 NewNPC 传左上角坐标:拳 247=(Center-84,-9)、248=(+78,-9)、头 246=(-3,-57)
  if (!e.bInit) {
    e.bInit = true;
    e.ai0 = 0; e.ai1 = 0; e.ai3 = 0;
    e.alphaFade = false;           // 接管渐显(原版 AI 内 alpha -= 10)
    const spawn = (id: number, ox: number, oy: number, side: number) => {
      const p = spawnPart(game, e, id);
      if (!p) return;
      p.x = e.cx + ox; p.y = e.cy + oy;
      p.ai0 = side;                // 拳 ai0=侧别(-1 左/1 右;头不使用)
    };
    spawn(247, -84, -9, -1);
    spawn(248, 78, -9, 1);
    spawn(246, -3, -57, 0);
  }

  // ---- 出生渐显(NPC.cs:19477-19485):期间 ai[1]=0,蓄力冻结 ----
  if (fadeAlpha(e, x) > 0) e.ai1 = 0;

  // ---- 死亡演出(★当前无置位点=不可达保留:boss#19 定案即时终战后 dying
  //      置位已删;若恢复演出在 hurt 245 分支置 x.dying=true 并回退标准死) ----
  if (x.dying) {
    e.iframes = 2;
    e.vx *= 0.9;
    e.vy = Math.min(e.vy + GRAV, MAX_FALL);
    moveAndCollide(e, game.world, e.vx, e.vy);
    x.deadT++;
    if (x.deadT % 6 === 0) {
      game.spawnParticles(
        e.cx + (Math.random() - 0.5) * e.w, e.cy + (Math.random() - 0.5) * e.h,
        '#B04030', 6, 2.4, { life: 36 });
    }
    if (x.deadT >= 60) { e.dead = true; return; }
    return;
  }

  const num = balanceNum(game, player, 2);   // 本体 getGoodWorld +2(:19451-19454)

  // ---- 部件存活扫描(NPC.cs:19487-19512):flag=头/flag2=左拳/flag3=右拳 ----
  //  注意头原体变身自由态后(ai3=1)视为"挂载头已失"——本体解除无敌且蓄力提速,
  //  对齐原版"246 死亡 → NewNPC 249"后 flag 为假的语义
  let hasHead = false, hasL = false, hasR = false;
  for (const n of game.enemies() as Enemy[]) {
    if (n.dead) continue;
    if (n.vanillaId === 246 && n.ai3 !== 1) hasHead = true;
    else if (n.vanillaId === 247) hasL = true;
    else if (n.vanillaId === 248) hasR = true;
  }
  // dontTakeDamage = 挂载头在场(NPC.cs:19509/19513):一阶段本体无敌,先打头/拳。
  // ★须用 dontTakeDamage 而非 iframes——Enemy.hurt 的 iframes 门有 pierce!==1
  // 豁免(单发弹=箭/枪弹/多数随从绕过无敌帧),原版是挡全通道的
  // dontTakeDamage(Enemy.hurt :10289 同门);曾用 iframes=2 = 一阶段可被
  // 单发弹直杀本体跳阶段(2026-08-19 终审修)
  e.dontTakeDamage = hasHead;
  // getGoodWorld 落体砸火把(:19510-19532):下落中(vy>0)扫过 AABB 的火把全部熄灭。
  // Y 上界用 width 是原版笔误,1:1 照抄
  if (game.world.seedFlags?.getGoodWorld && e.vy > 0) {
    smashTorches(game.world.store, e.x, e.x + e.w, e.y, e.y + e.w);
  }

  // ---- 断臂尘(NPC.cs(1458):19626-19663,!getGoodWorld 包住——FTW 下由砸火把取代):
  //      每 tick 双臂流:缺侧各一粒 Dust.NewDust(臂点 8×8 盒,31 号灰,alpha100 后
  //      +=Next(100)、v×0.2、vy−=0.5+Next(10)/10、fadeIn=0.5+Next(10)/10);再掷
  //      Next(10)==0 → 臂点一粒 Dust6 火星(Next(20)!=0 门:noGravity/scale×(1+Next(10)/10)/
  //      vy−−)。旧"每 10t 一簇 spawnParticles 近似"退役 —— 终清波实装 ----
  if (!game.world.seedFlags?.getGoodWorld) {
    const armDust = (ox: number): void => {
      const px = e.cx + ox * sc(e) - 4, py = e.cy - 9 - 4;   // NewDust 8×8 盒的左上
      const d = game.spawnDust?.(px, py, 8, 8, 31, 0, 0, 100);
      if (!d) return;
      d.alpha = Math.min(255, d.alpha + Math.floor(rf() * 100));  // alpha += Next(100)
      d.vx *= 0.2;
      d.vy *= 0.2;
      d.vy -= 0.5 + rf() * 10 * 0.1;                              // velocity.Y -= .5+Next(10)*.1
      d.fadeIn = 0.5 + rf() * 10 * 0.1;
      if (rf() < 1 / 10) {                                        // Next(10)==0
        const s = game.spawnDust?.(px, py, 8, 8, 6);
        if (s && rf() >= 1 / 20) {                                // Next(20)!=0
          s.noGravity = true;
          s.scale *= 1 + rf() * 10 * 0.1;
          s.vy -= 1;                                              // velocity.Y--
        }
      }
    };
    if (!hasL) armDust(-80);
    if (!hasR) armDust(62);
  }

  // ---- 跳跃穿墙解除(NPC.cs:19569-19578):下落低于玩家顶 / 有视线且自身不在块内 ----
  if (x.noTC && player && !player.dead) {
    if (e.vy > 0 && e.y + e.h > player.y) x.noTC = false;
    else if (losClear(game, e.cx, e.cy, player.cx, player.cy) && !hitSolid(game, e)) x.noTC = false;
  }

  // TargetClosest 的 direction 近似:朝玩家符号,同侧回退 facing
  const dir = player ? (Math.sign(player.cx - e.cx) || e.facing || 1) : 1;
  if (player) e.facing = dir;

  if (player && e.ai0 === 0) {
    // ---- 地面蓄力(NPC.cs:19580-19645):ai[1] 攒 300 → -20 蹲伏 20t → ==-1 起跳 ----
    //  蹲伏段(负值)num4 固定 1;蓄力段按断臂/残血提速,再乘脱庙狂暴系数
    if (e.vy === 0) {
      e.vx *= 0.8;
      let num4 = 1;
      if (e.ai1 > 0) {
        if (!hasL) num4 += 2;
        if (!hasR) num4 += 2;
        if (!hasHead) num4 += 2;
        if (e.hp < e.maxHp) num4 += 1;
        if (e.hp < e.maxHp / 2) num4 += 4;
        if (e.hp < e.maxHp / 3) num4 += 8;
        num4 *= num;
        if (game.world.seedFlags?.getGoodWorld) num4 += 100;   // :19613-19616(乘后再加)
      }
      e.ai1 += num4;
      if (e.ai1 >= 300) e.ai1 = -20;
      else if (e.ai1 === -1) {
        // 起跳(:19624-19643):穿墙跳,vx=4*dir;残血跳更高 -12.1*(num+9)/10 钳 -19.1
        x.noTC = true;
        e.vx = 4 * dir;
        e.vy = e.hp < e.maxHp ? Math.max(-19.1, (-12.1 * (num + 9)) / 10) : -12.1;
        e.ai0 = 1; e.ai1 = 0;
      }
    }
  } else if (player && e.ai0 === 1) {
    // ---- 跳跃段(NPC.cs:19646-19708) ----
    if (e.vy === 0) {
      // 落地(:19648-19661):Item14 音效 + 落地尘/Gore(曾借 roar 0.35,2026-08-18 对账修)
      game.playSfxWav?.('Item_14', 1, e.cx, e.cy);
      game.spawnParticles(e.cx, e.y + e.h, '#9A8FA0', 12, 2.2, { life: 40 });
      e.ai0 = 0;
    } else {
      // 玩家被【整段包含】于本体水平跨度 → 收横向速度夹住下压(:19666
      // position.X < p.X && position.X+width > p.X+p.width——含玩家全宽,
      // 曾写任意重叠门=过早减速,跳跃压制变味,2026-08-19 终审修)
      if (e.x < player.x && e.x + e.w > player.x + player.w) {
        e.vx *= 0.9;
        if (e.y + e.h < player.y) e.vy += (0.2 * (num + 1)) / 2;
      } else {
        e.vx += 0.2 * dir;
        let num7 = 3;
        if (e.hp < e.maxHp) num7 += 1;
        if (e.hp < e.maxHp / 2) num7 += 1;
        if (e.hp < e.maxHp / 4) num7 += 1;
        num7 *= (num + 1) / 2;
        e.vx = clamp(e.vx, -num7, num7);
      }
    }
  }

  // ---- 玩家死亡 vs 远离（NPC.cs:19469-19475 / 19709-19721）----
  // 玩家死：仅 noTileCollide=true（无 despawn 无状态切换，AI 继续跑）；
  // 活人曼哈顿 >3000：瞬消（二次判定 TargetClosest 后）
  if (!player || player.dead) {
    x.noTC = true;   // :19469-19475 玩家死→穿墙(曾漏 player.dead 态)
  } else if (Math.abs(e.cx - player.cx) + Math.abs(e.cy - player.cy) > 3000) {
    e.dead = true; e.bossFled = true;
    return;
  }

  // ---- 重力+位移+落地(原版共享物理:noGravity=false → 0.3/2t、maxFall 10):
  //      TileCollision(velocity)→position+=velocity 全语义(moveAndCollide 承载,
  //      落地清 vy 置 onGround——蓄力段 `e.vy === 0` 门依赖此语义;穿墙跳态直积分) ----
  e.vy = Math.min(e.vy + GRAV, MAX_FALL);
  if (!x.noTC) moveAndCollide(e, game.world, e.vx, e.vy);
  else { e.x += e.vx; e.y += e.vy; e.onGround = false; }
}

// ---------------------------------------------------------------------------
// aiStyle 46 挂载头 246(NPC.cs:31273-31499)+ aiStyle 48 自由头 249(NPC.cs:31500-31741)
// ---------------------------------------------------------------------------

export function golemHeadAI(e: Enemy, game: GameHooks, player: Player | null) {
  const x = headXOf(e);
  if (e.vanillaId === 249) x.free = true;   // 直接生成的自由头(原版 NewNPC 249)
  if (!e.bInit) {
    e.bInit = true;
    e.ai0 = 0; e.ai1 = 0; e.ai2 = 0;
    e.ai3 = x.free ? 1 : 0;
    e.alphaFade = false;
    x.alpha = x.free ? 0 : 255;             // 249 SetDefaults 无 alpha(:12139-12149)
  }

  // ---- 血尽(首行):挂载头死且【本体活】→ 转自由态(hurt 246 放行同门——
  //      玩家先打头场景本体必活);本体已死 → 不转,落到下方锚主段标准死
  //      (:31287-31290)。自由头恒无敌（249 SetDefaults NPC.cs:12151
  //      dontTakeDamage=true——原版自由头不可击杀,胜利条件只有杀本体。
  //      曾"杀自由头=全族自毁终战"= 倒置,审计 boss#19,2026-08-19）----
  if (e.hp <= 0 && !x.free) {
    const bodyNow = findBody(game);
    if (!bodyNow || bodyNow.dead || bodyNow.hp <= 0) {
      e.die(game);
      return;
    }
    golemHeadGoFree(e, game);
  } else if (e.hp <= 0 && x.free) {
    e.hp = e.maxHp;   // 防御性复原（dontTakeDamage 已挡伤害路径）
  }

  // ---- 属性:自由头 = 249 出生即 ScaleStats 终值(原版 AI_048【零】damage/defense
  //      写位——NewNPC 249 走完整缩放:难度乘区×245-249 族 tweak 0.8,经典 80/
  //      专家 128/大师 192;★BJ712-A 转报件5:曾每拍重写未缩放基值 80/32 =
  //      抹平难度缩放 80/80/80,覆写退场;在位转换兜底的 249 档属性切换由
  //      golemHeadGoFree 落位时一次性写入) ----
  if (x.free) {
    e.dontTakeDamage = true;   // :12151 自由头无敌
  } else {
    e.dontTakeDamage = false;
    const b = baseOf(e);
    e.def.damage = b.dmg;
    e.def.defense = b.def;
  }

  // 本体死亡/缺失 → 头标准死(golemBoss<0 → StrikeNPCNoInteraction(9999) 即
  // NPC.cs:31287-31290,走碎块/音效死亡管线;终战=部件随本体消亡 boss#19 定案。
  // 曾写"转自由态继续战"——偏离原版且与定案矛盾,2026-08-19 对齐;
  // 血尽转自由态只在【本体活】时发生(hurt 246 放行有本体活门)——玩家先打头
  // 转自由,本体死后头自灭,两条路径与原版全场景吻合)
  const body = findBody(game);
  // 本体亡 → 全头自灭(:31521-31525 自由头同样查 golemBoss——曾 !x.free 豁免
  // 自由头 = 先破头再杀本体留下无敌自由头永不退场=战斗软锁,2026-08-19 终审修)
  if (!body || body.ai3 === 1 || body.hp <= 0) {
    // ★自由头 dontTakeDamage=true(:461)会挡 die→hurt 标准管线(hp=0+dead=false
    //   挂空,下一帧 :458 hp=maxHp 复原=满血悬空+血条永挂——2026-08-21 用户报
    //   "本体死头悬空血条还在")。原版 StrikeNPCNoInteraction(9999)(:31287-31290)
    //   本就绕 dontTakeDamage 强制杀,对齐:先清旗标再走标准死管线
    e.dontTakeDamage = false;
    e.die(game);
    return;
  }
  // 挂载头锚本体（渲染层序用:实体 y 排序下头 y<本体 → 头先画=垫到身后,
  // 原版 NPC 按 whoAmI 槽序=部件恒在本体【前】——用户报"头跑到背后"根因,
  // 2026-08-19 修;与拳 e.master 同款链路）
  if (!x.free) e.master = body;

  const num = balanceNum(game, player, 3);   // 挂载/自由头 getGoodWorld +3(:31277-31280/:31505-31508)

  if (!x.free && body) {
    // ================= 挂载态 aiStyle 46(NPC.cs:31273-31499) =================
    // noTileCollide = true(:31284);锚点 = 本体.Center + (-3*scale,-57*scale)(:31290-31308)
    const dx = body.cx - 3 * sc(e) - e.cx;
    const dy = body.cy - 57 * sc(e) - e.cy;
    const dist = Math.hypot(dx, dy);
    if (dist < 100) { e.spin = 0; e.vx = dx; e.vy = dy; }        // 100 内整帧贴锚
    else { e.vx = (dx / dist) * 100; e.vy = (dy / dist) * 100; e.spin = e.vx * 0.1; }
    // 渐显(:31310-31317):期间 ai[1]=30
    if (fadeAlpha(e, x) > 0) e.ai1 = 30;

    if (player) {
      if (e.ai0 === 0) {
        // ---- 嘴部火焰弹循环(:31319-31347):300t 一发 proj 258(伤 18 速 8) ----
        e.ai1 += 1;
        if (e.ai1 < 20 || e.ai1 > 280) { e.ai1 += (2 * (num - 1)) / 3; x.l0 = 1; }  // 张嘴帧
        else { e.ai1 += (1 * (num - 1)) / 2; x.l0 = 0; }
        if (e.ai1 >= 300) {
          e.ai1 = 0;
          golemSpit(game, e, player, 0, 10 * sc(e), 8, 18, 258);
        }
      } else if (e.ai0 === 1) {
        // ---- 眼部阶段(:31353-31486):嘴弹伤 24 + 眼激光 259(伤 28) ----
        x.l1 = player.cx < e.cx - e.w ? -1 : player.cx > e.cx + e.w ? 1 : 0;        // localAI[1]
        const num733 = (num + 3) / 4;
        e.ai1 += num733;
        if (e.hp < e.maxHp * 0.4) e.ai1 += num733;
        if (e.hp < e.maxHp * 0.2) e.ai1 += num733;
        x.l0 = e.ai1 < 20 || e.ai1 > 280 ? 1 : 0;
        if (e.ai1 >= 300) {
          e.ai1 = 0;
          golemSpit(game, e, player, x.l1 * 40 * sc(e), 10 * sc(e), 8, 24, 258);
        }
        e.ai2 += num733;
        if (e.hp < e.maxHp / 3) e.ai2 += num733;
        if (e.hp < e.maxHp / 4) e.ai2 += num733;
        if (e.hp < e.maxHp / 5) e.ai2 += num733;
        if (!losClear(game, e.cx, e.cy, player.cx, player.cy)) e.ai2 += 4;          // :31456 无视线催速
        if (e.ai2 > 60 + Math.random() * 600) {
          e.ai2 = 0;
          golemEyeLasers(game, e, player, x.l1);
        }
      }
      // 阶段派生(:31487-31491):血 < 半 → 眼部阶段
      e.ai0 = e.hp < e.maxHp / 2 ? 1 : 0;
      // FindFrame case 246(:73610-73633)状态帧:基础=l0(张嘴)1:0;眼部阶段(ai0==1)
      // 按激光侧加帧——l1==-1(左)→+4 / l1==1(右)→+2 / 0(正上/下双眼)→基础帧
      e.customFrameIdx = (x.l0 ? 1 : 0)
        + (e.ai0 === 1 ? (x.l1 === -1 ? 4 : x.l1 === 1 ? 2 : 0) : 0);
    }
  } else {
    // ================= 自由态 aiStyle 48 GolemHeadFree(NPC.cs:31500-31741) =================
    // flag48(:31503-31515):头自身看不到玩家 → 穿墙 + 火焰弹不蓄满(头↔玩家视线)
    const rBody = findBody(game);
    const noLos = !player || !losClear(game, e.cx, e.cy, player.cx, player.cy);
    // flag49(:31646-31651):本体↔玩家无视线 → 激光催速 + 弹道预判;
    // 本体已亡(本移植死亡链)→ 退化为头↔玩家视线
    const noLosBody = rBody
      ? !player || !losClear(game, rBody.cx, rBody.cy, player.cx, player.cy)
      : noLos;
    if (player) {
      // 悬浮(:31521-31564):目标 = 玩家 + (0,-300),7 速/0.05 步进(符号翻转双步进)
      const dx = player.cx - e.cx, dy = player.cy - 300 - e.cy;
      const d = Math.hypot(dx, dy) || 1;
      e.vx = accelTo(e.vx, (dx / d) * 7, 0.05);
      e.vy = accelTo(e.vy, (dy / d) * 7, 0.05);
      // 火焰弹节奏(:31566-31595):num761=(num+4)/5,分档读本体(golemBoss=245)残血(:31574-31594)。
      // 本体已亡(本移植死亡链,原版无此态)→ 比值 0 = 全档,等价原版读尸体槽 life<=0 恒真
      const num761 = (num + 4) / 5;
      e.ai1 += num761;
      const r = rBody ? rBody.hp / rBody.maxHp : 0;
      if (r < 0.8) e.ai1 += num761;
      if (r < 0.6) e.ai1 += num761;
      if (r < 0.2) e.ai1 += num761;
      if (r < 0.1) e.ai1 += num761;
      x.l0 = e.ai1 < 20 || e.ai1 > 280 ? 1 : 0;   // 张嘴帧(:31584-31592)
      // FindFrame case 249(:73635-73650):帧 = l0(张嘴)1:0(frameCounter 16 循环
      // 无帧推进消费,不移植)
      e.customFrameIdx = x.l0 ? 1 : 0;
      if (noLos) e.ai1 = 20;                       // :31593-31595 无视线时不蓄满
      if (e.ai1 >= 300) {                          // :31596-31617 嘴弹 proj 258(伤 20 速 8)
        e.ai1 = 0;
        golemSpit(game, e, player, 0, -10 * sc(e), 8, 20, 258);
      }
      // 眼激光节奏(:31618-31658):基数 num,分档读本体残血(:31626-31645;r 与上方火焰弹
      // 同源);激光伤/速分档(:31683-31705,阈值 0.5/0.4/0.3/0.2/0.1)经 golemEyeLasersFree 传 r
      e.ai2 += num;
      if (r < 1 / 1.25) e.ai2 += num;
      if (r < 1 / 1.5) e.ai2 += num;
      if (r < 1 / 2) e.ai2 += num;
      if (r < 1 / 3) e.ai2 += num;
      if (r < 1 / 4) e.ai2 += num;
      if (r < 1 / 5) e.ai2 += num;
      if (r < 1 / 6) e.ai2 += num;
      if (noLosBody) e.ai2 += num * 10;            // :31646-31651 flag49 催速
      if (e.ai2 > 100 + Math.random() * 4800) {
        e.ai2 = 0;
        golemEyeLasersFree(game, e, player, noLosBody, r);
      }
    }
  }

  // ---- 排焰双流真实尘(NPC.cs(1458):31796-31812,aiStyle48 自由头专属+!getGoodWorld 门):
  //      每 tick 两粒 Dust228/NewDustPerfect,均 +=velocity、noGravity——
  //      流① Bottom+(±22·scale,−22·scale)(侧别 num779=Next(2)×2−1),速=
  //      Rot(π/2−π/2·侧+NextFloatDirection·π/4)×(2+NextFloat);
  //      流② Bottom+(NextFloatDirection·6·scale,(NextFloat·−4−8)·scale),速=UnitY×
  //      (2+NextFloat),fadeIn=0/scale=0.7+NextFloat·0.5。(原注 ":31721-31740 纯视觉略"
  //      整段缺失 —— 终清波实装;Perfect 通道经 VanillaDust spawn 内烟雾族特例后
  //      position/velocity 双覆写,与原版 NewDustPerfect 仅覆写两字段语义一致)
  //      原版位于 aiStyle48 尾段、player 门之外 —— 置于此处同位 ----
  if (x.free && !game.world.seedFlags?.getGoodWorld) {
    const scc = sc(e);
    const side = (Math.random() < 0.5 ? -1 : 1);          // Next(2)*2-1
    const angA = Math.PI / 2 + (-Math.PI / 2) * side + rfDir() * (Math.PI / 4);
    const spdA = 2 + rf();
    const dA = game.spawnDust?.(
      e.cx + side * 22 * scc, e.y + e.h - 22 * scc, 0, 0,
      228, Math.cos(angA) * spdA, Math.sin(angA) * spdA, 0, null, 1, false, true);
    if (dA) {
      dA.vx += e.vx; dA.vy += e.vy;
      dA.noGravity = true;
    }
    const dB = game.spawnDust?.(
      e.cx + rfDir() * 6 * scc, e.y + e.h + (rf() * -4 - 8) * scc, 0, 0,
      228, 0, 2 + rf(), 0, null, 1, false, true);
    if (dB) {
      dB.fadeIn = 0;
      dB.scale = 0.7 + rf() * 0.5;
      dB.vx += e.vx; dB.vy += e.vy;
      dB.noGravity = true;
    }
  }

  // 穿墙开关(:31581-31597 两版本同段):看不到玩家 → noTileCollide=true 直飞;
  // 有视线且【已嵌实心】(SolidTiles 整盒重叠=hitSolid)→ 关穿墙本拍起走 TileCollision
  // 撤出(moveAndCollide 分轴解析替代旧 collideGround 半吊抬升);有视线未嵌块保持
  // 穿墙直飞。挂载头(246)恒穿墙直飞(:31284)
  const freeNoLos = !player || !losClear(game, e.cx, e.cy, player.cx, player.cy);
  if (!x.free || freeNoLos || !hitSolid(game, e)) {
    e.x += e.vx;
    e.y += e.vy;
    e.onGround = false;
  } else {
    moveAndCollide(e, game.world, e.vx, e.vy);
  }
}

// ---------------------------------------------------------------------------
// AI_047 石巨人拳 247/248(NPC.cs:19171-19446)
// ---------------------------------------------------------------------------
// 原版 ai[0] 是状态机(0 归位/1 蓄力/2 冲拳/3 直飞);任务约定 ai0=侧别,
// 状态机落在本文件 WeakMap(fistX.state),计时仍用 ai[1]。

export function golemFistAI(e: Enemy, game: GameHooks, player: Player | null) {
  const x = fistXOf(e);
  // 存量负血自愈兜底(主路径=hurt 标准死;旧放行年代留下的负血拳在此收口)
  if (e.hp <= 0) { e.die(game); return; }
  if (!e.bInit) {
    e.bInit = true;
    e.ai0 = e.vanillaId === 247 ? -1 : 1;   // ai0=侧别(-1 左拳/1 右拳;由本体生成时预置)
    e.ai1 = 0;
    e.alphaFade = false;
    x.alpha = 255;
  }
  const isLeft = e.vanillaId === 247;

  // ---- 锚主:golemBoss 缺失 → 自毁(NPC.cs:19182-19186) ----
  //  本体存活(含死亡演出)→ 锚本体;本体死透 → 锚自由头(任务约定"锚定本体(或头)")
  const body = findBody(game);
  // 锚主=本体(原版 golemBoss 单锚,:19182-19186 找不到即自灭;曾回退锚自由头
  // = 本体死后拳不死=软锁一环,2026-08-19 终审修)
  const anchor = body && !body.dead ? body : null;
  // 锚主全无 → 标准死(:19182-19186 原版 StrikeNPCNoInteraction 自杀——碎块/
  // 音效管线;曾直写 dead 静默,2026-08-19 对齐)
  if (!anchor) { e.die(game); return; }
  e.master = anchor; // 拳链渲染用（Renderer.drawGolemFistChain，Main.cs:22593-22632）

  const num = balanceNum(game, player, 3);   // 拳 getGoodWorld +3(:19173-19176)
  // 渐显(:19187-19194):期间 ai[1]=0
  if (fadeAlpha(e, x) > 0) e.ai1 = 0;

  // ---- 肩锚点(:19197-19199):锚主.Center + 锚主.velocity + (±84/78*scale, -9*scale) ----
  const offX = isLeft ? -84 : 78;
  const tx = anchor.cx + anchor.vx + offX * sc(e);
  const ty = anchor.cy + anchor.vy - 9 * sc(e);
  const dx = tx - e.cx, dy = ty - e.cy;
  const dist = Math.hypot(dx, dy);
  e.facing = isLeft ? 1 : -1;               // 镜像朝向(原版贴图方向)

  if (!player) { e.x += e.vx; e.y += e.vy; return; }

  if (x.state === 0) {
    // ---- 归位/待机蓄力(:19202-19270) ----
    x.noTC = true;
    let num3 = 14;
    if (e.hp < e.maxHp / 2) num3 += 3;
    if (e.hp < e.maxHp / 4) num3 += 3;
    if (anchor.hp < anchor.maxHp) num3 += 8;
    num3 *= (num + 3) / 4;
    if (num3 > 32) num3 = 32;
    if (dist < 12 + num3) {
      // 贴肩:整帧速度 = 偏移量(原版 velocity = delta),蓄力计时(:19216-19259)
      e.spin = 0;
      e.vx = dx; e.vy = dy;
      e.ai1 += num;
      if (e.hp < e.maxHp / 2) e.ai1 += num;
      if (e.hp < e.maxHp / 4) e.ai1 += num;
      if (anchor.hp < anchor.maxHp) e.ai1 += 10 * num;
      if (e.ai1 >= 60) {
        // 出拳侧别门(:19244-19256):左拳只在玩家偏左时出、右拳对称
        const sideOk = isLeft ? e.cx + 100 > player.cx : e.cx - 100 < player.cx;
        e.ai1 = 0;
        if (sideOk) x.state = 1;
      }
    } else {
      e.vx = (dx / dist) * num3;
      e.vy = (dy / dist) * num3;
      // 归位朝向(:19260-19262):默认 atan2(-vy,-vx),247 镜像为 atan2(vy,vx)
      e.spin = isLeft ? Math.atan2(e.vy, e.vx) : Math.atan2(-e.vy, -e.vx);
    }
  } else if (x.state === 1) {
    // ---- 蓄力:贴肩 30t(:19271-19332) ----
    e.ai1 += 1;
    e.x = tx - e.w / 2;                     // 原版 base.Center = vector(整帧钉在肩锚)
    e.y = ty - e.h / 2;
    e.spin = 0; e.vx = 0; e.vy = 0;
    if (e.ai1 <= 15) {                      // NPC.cs(1458):19374-19390 聚能向心收敛尘
      // vector3=Circular(80,80)/vector4=vector3×−0.05(vector5=Circular(20,20) 抖动):
      // 出生位 = Center+vector3·0.95+vector5、速度 = vector4（指向本体的向心汇流）;
      // Dust228 fadeIn=1.5 / scale=0.5 / noGravity,getGoodWorld 再 noLight。
      // 原"每拍 '#C8A040' spawnParticles 近似"退役 —— 终清波实装
      const v3 = circular(80), j = circular(20);
      const d = game.spawnDust?.(
        e.cx + v3.x * 0.95 + j.x, e.cy + v3.y * 0.95 + j.y, 0, 0,
        228, v3.x * -0.05, v3.y * -0.05, 0, null, 1, false, true);
      if (d) {
        d.fadeIn = 1.5;
        d.scale = 0.5;
        if (game.world.seedFlags?.getGoodWorld) d.noLight = true;
        d.noGravity = true;
      }
    }
    if (e.ai1 >= 30) {
      x.noTC = true;
      x.state = 2; e.ai1 = 0;
      // 冲拳速度(:19302-19321):12 + 残血/本体受损加成,×(num+3)/4 钳 48
      let num6 = 12;
      if (e.hp < e.maxHp / 2) num6 += 4;
      if (e.hp < e.maxHp / 4) num6 += 4;
      if (anchor.hp < anchor.maxHp) num6 += 10;
      num6 *= (num + 3) / 4;
      if (num6 > 48) num6 = 48;
      const pdx = player.cx - e.cx, pdy = player.cy - e.cy;
      const pd = Math.hypot(pdx, pdy) || 1;
      e.vx = (pdx / pd) * num6; e.vy = (pdy / pd) * num6;
      // 冲拳朝向(:19325-19328):默认 atan2(vy,vx),247 镜像为 atan2(-vy,-vx)(与归位相反)
      e.spin = isLeft ? Math.atan2(-e.vy, -e.vx) : Math.atan2(e.vy, e.vx);
    }
  } else if (x.state === 2) {
    // ---- 冲拳飞行(:19333-19393) ----
    // getGoodWorld 冲拳沿途砸火把(:19335-19362):AABB 外扩 1 格扫过即熄
    // (Y 上界同样用 width,原版笔误 1:1)
    if (game.world.seedFlags?.getGoodWorld) {
      smashTorches(game.world.store, e.x - TILE, e.x + e.w + TILE, e.y - TILE, e.y + e.w + TILE);
    }
    e.ai1 += 1;
    if (e.ai1 === 1) game.playSfxWav?.('Item_14', 1, e.cx, e.cy);   // SoundID.Item14(:19344-19346;曾借 roar 0.4)
    if (rf() < 1 / 2) {                           // NPC.cs(1458):19455-19460 焰尾尘
      // 1/2 拍:vector7=velocity×0.5 + Circular(20,20) 抖动 → Dust306(NewDustPerfect,
      // 同速 vector7, OurFavoriteColor(255,231,69)).scale=2f——
      // 原"每 2t '#E08040' spawnParticles 近似"退役;306 纹理/2 倍缩放/黄橙真值色齐备
      const v7x = e.vx * 0.5, v7y = e.vy * 0.5;
      const j = circular(20);
      const d = game.spawnDust?.(
        e.cx + v7x + j.x, e.cy + v7y + j.y, 0, 0,
        306, v7x, v7y, 0, FAVORITE_RGB, 1, false, true);
      if (d) d.scale = 2;
    }
    // 过轴判定(:19363-19388):主轴冲过玩家 → 关穿墙(开始撞墙)
    if (Math.abs(e.vx) > Math.abs(e.vy)) {
      if (e.vx > 0 && e.cx > player.cx) x.noTC = false;
      if (e.vx < 0 && e.cx < player.cx) x.noTC = false;
    } else {
      if (e.vy > 0 && e.cy > player.cy) x.noTC = false;
      if (e.vy < 0 && e.cy < player.cy) x.noTC = false;
    }
    // 离锚 700 → 回位(:19389-19392;撞墙分支在位移后判定)
    if (dist > 700) { x.noTC = true; x.state = 0; }
  } else if (x.state === 3) {
    // ---- 直飞追击(:19394-19446;原版无处置 ai[0]=3 的代码,保留 1:1) ----
    x.noTC = true;
    const pdx = player.cx - e.cx, pdy = player.cy - e.cy;
    const pd = Math.hypot(pdx, pdy) || 1;
    e.vx = accelTo(e.vx, (pdx / pd) * 12, 0.4);
    e.vy = accelTo(e.vy, (pdy / pd) * 12, 0.4);
    e.spin = isLeft ? Math.atan2(-e.vy, -e.vx) : Math.atan2(e.vy, e.vx);
  }

  // ---- 位移(蓄力态已整帧钉锚;冲拳非穿墙段撞墙即回位):
  //      TileCollision 分轴解析(moveAndCollide)——碰撞轴速度被改写即 collideX/Y
  //      (Collision_MoveWhileDry :93734-93747 oldVelocity≠velocity 语义),替代旧
  //      "先嵌进墙体再整盒重叠"的 hitSolid 近似,冲拳贴地滑行/半砖不再误停 ----
  if (x.state !== 1) {
    if (!x.noTC) {
      // Collision_MoveWhileDry 语义:碰撞即 oldVelocity≠velocity(轴速度被改写),
      // 以速度差分判定替代旧 hitSolid 整盒重叠
      const ovx = e.vx, ovy = e.vy;
      moveAndCollide(e, game.world, e.vx, e.vy);
      if (x.state === 2 && (e.vx !== ovx || e.vy !== ovy)) {
        x.noTC = true;
        x.state = 0;                          // :19449-19453 collideX||collideY → 回位
      }
    } else {
      e.x += e.vx;
      e.y += e.vy;
    }
  }
}
