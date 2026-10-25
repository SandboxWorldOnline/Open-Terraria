// 月事件(南瓜月/霜月)+ 雪人入侵 + 弹跳球族 AI 1:1 移植(Terarria1456, 1.4.5.6)：
//   aiStyle 57  悲木 325 / 常世吼 344        NPC.cs:32937-33245（悬浮树怪，弹幕分阶段）
//   aiStyle 58  南瓜王 327                    NPC.cs:33246-33404（悬浮/俯冲，ai[3] 换招）
//   aiStyle 59  南瓜王之刃 328                NPC.cs:33405-33587（锚主环绕→升空俯冲/横扫）
//   aiStyle 60  冰雪女王 345                  NPC.cs:33588-33901（滑翔/落冰/旋射三态随机）
//   aiStyle 61  圣诞坦克 346                  NPC.cs:33902-34154（悬浮树怪同构+链炮/火箭/礼盒）
//   aiStyle 62  玩具直升机 347                NPC.cs:34155-34207（600px 内悬停点射）
//   aiStyle 63  弗洛科 352                    NPC.cs:34208-34255（追踪+200px 内旋冲）
//   aiStyle 38  雪人三兄弟 143/144/145        NPC.cs:29115-29256（跳扑/停顿/雪球机枪）
//   aiStyle  9  弹跳球族 25/30/33/112/516(/665/666)
//                                             NPC.cs:21349-21548（直飞球/毒唾/日耀耀斑）
// 经典模式主链 1:1；getGoodWorld 分支已实装（弹跳球族 33 骷髅王在场无敌 / 25 血肉墙
// 在场无敌 / 666 地表无敌 / RedHatSkeletronAdjustments+FTW 速度档）；expert 分支仅注释
// 保留；netcode 跳过。
// 弹幕贴图 Projectile_{109,110,180,325..329,345..352}.png 已入 sprites/vanilla(原 RENDER_PROXY
// 代渲退役,Arrow 按 projId 懒加载真图)。
import type { Enemy } from './Enemy';
import { aiGlobalFiringDistanceCheck } from './Enemy';
import type { GameHooks } from './types';
import type { Player } from './Player';
import { TILE } from '../core/constants';
import { ENEMY_GRAVITY, MAX_FALL_SPEED } from '../core/constants';
import { moveAndCollide } from '../physics/TileCollision';
import { spawnPart, losClear } from './bossAI';
import { bannerNpcKeyOf } from './projTargets';   // ★BJ710-G35 D1：发射者旗键（BannerID() 投影）
import { Arrow } from './Arrow';
import { getAttackDamageCappedAtMaster } from '../stats/ScaleStats';

/** 原版 localAI[0..3]（Enemy 的 ai0-ai3 对应 ai[]，localAI 是独立数组 → WeakMap 落盘） */
const localAI = new WeakMap<Enemy, number[]>();
const la = (e: Enemy): number[] => {
  let a = localAI.get(e);
  if (!a) { a = [0, 0, 0, 0]; localAI.set(e, a); }
  return a;
};
/** 渲染侧只读出口（南瓜王 327 披风帧 = localAI[1]，Main.cs:22501） */
export const localAIOf = la;
/** Main.rand.Next(n) → [0,n) */
const rnd = (n: number): number => Math.floor(Math.random() * n);
/** Main.rand.Next(a, b) → [a,b) */
const rndRange = (a: number, b: number): number => a + Math.floor(Math.random() * (b - a));
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Collision.SolidCollision 近似：AABB 与任意实心块相交 */
function solidRect(game: GameHooks, x: number, y: number, w: number, h: number): boolean {
  const st = game.world.store;
  const x0 = Math.floor(x / TILE), x1 = Math.floor((x + w - 0.01) / TILE);
  const y0 = Math.floor(y / TILE), y1 = Math.floor((y + h - 0.01) / TILE);
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      if (st.inBounds(tx, ty) && st.isSolid(tx, ty)) return true;
    }
  }
  return false;
}
/** WorldGen.SolidTile：单格实心判定（弹幕出膛点门） */
function solidTileAt(game: GameHooks, x: number, y: number): boolean {
  const st = game.world.store;
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  return st.inBounds(tx, ty) && st.isSolid(tx, ty);
}
/** NPC.AnyNPCs(type)：指定 vanillaId 的存活 NPC 是否在场（弹跳球族 FTW 门用） */
function anyNpcs(game: GameHooks, id: number): boolean {
  return (game.enemies() as Enemy[]).some((n) => !n.dead && n.vanillaId === id);
}

// ---------------------------------------------------------------------------
// 弹幕：月事件族弹体贴图 Projectile_{109,110,180,325..329,345..352}.png 已按 601/602
// 先例自 terraria-assets/Images 补入 public/sprites/vanilla/（Arrow 按 projId 懒加载
// 真图），此前的 RENDER_PROXY 代渲登记退役。ProjectileID.cs 对照：325 FlamingWood /
// 326-328 GreekFire1-3 / 329 FlamingScythe / 345 PineNeedleHostile / 346 OrnamentHostile /
// 348 FrostWave / 349 FrostShard / 350 Missile / 351 Present / 352 Spike /
// 180 BulletDeadeye / 109 SnowBallHostile / 110 BulletSnowman。
// ---------------------------------------------------------------------------
/** 弹体行为登记（Projectile.cs SetDefaults 逐条）：
 *  重力：349 FrostShard 原版 vy+=0.2/t 即坠（:53360）；aiStyle 14 弹跳族
 *  （希腊火 326-328 :3937 / 装饰球 346 :4092 / 尖刺 352 :4152）重力 0.2 且
 *  **延迟 5 子步**（AI_014 默认档 :23482-23498：ai[0]>5 才 vy+=0.2）；345 针叶
 *  50t 后 +0.5（AI_001 type 段 :54237-54249）；351 礼盒走 Arrow 两段重力档。
 *  弹跳：aiStyle 14 族撞块法向反弹 ×-0.5（碰撞反弹表 :18314-18327 默认档），
 *  此前近似直飞/直坠消亡；352 尖刺同族补齐（曾漏 = 恒速直飞）。
 *  tileCollide=false 族（325 :3917 / 329 :3950 / 348 :4112 / 350 :4135 / 351 :4146）
 *  由 Arrow 按 projectileData 自动置 noTileCollide（曾漏 = 扎进地里被地形吞噬）。
 *  寿命表（SetDefaults，缺省 3600 :789）：325=420 / 326-328=360 / 329=420 /
 *  345=3600（默认）/ 346=300 / 348=900 / 349=900 / 350=**300**（1458 :4411;
 *  ★R23b-M2 修：曾写 1800——头注「timeLeft/=2」是 1456 type27 旧账误植,
 *  火箭滞空曾 6×）/ 351=3600（默认）/ 352=1200（/=3）/ 180=**180**（1458 :2672;
 *  ★R23b-M1 修：曾写 600=3.3×,链炮弹/直升机子弹满屏残留）/ 109=**300**·110=**300**
 *  （★R23b-M3：SetDefaults 109=默认3600/110=600,但雪人 NPC 侧出膛时覆写
 *  timeLeft=300——NPC.cs:29216-29219(110)/:29284-29287(109);本表按覆写终值收口） */
const PROJ_GRAV: Record<number, number> = { 349: 0.2, 326: 0.2, 327: 0.2, 328: 0.2, 346: 0.2, 352: 0.2, 345: 0.5 };
/** AI_014 重力延迟 5 子步（:23484-23498）；345 针叶 50t（:54244） */
// aiStyle14 族原版门为严格 `ai[0] > 5f`（Projectile.cs:23486-23498）——Arrow 门已统一
// `age >= gravDelay`（AI_001 默认档 :54686 `>= 15` 语义），存 6 等价（345 为 `>= 50` :54242 原值）
const PROJ_GRAV_DELAY: Record<number, number> = { 326: 6, 327: 6, 328: 6, 346: 6, 352: 6, 345: 50 };
const PROJ_BOUNCE = new Set([326, 327, 328, 346, 352]);
const PROJ_LIFE: Record<number, number> = {
  325: 420, 326: 360, 327: 360, 328: 360, 329: 420,
  345: 3600, 346: 300, 348: 900, 349: 900, 350: 300,
  351: 3600, 352: 1200, 180: 180, 109: 300, 110: 300,
};

function shootE(
  game: GameHooks, x: number, y: number, vx: number, vy: number,
  dmg: number, projId: number, life?: number,
  arrowOpts?: Partial<import('./Arrow').ArrowOpts>,
): void {
  (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(
    new Arrow(x, y, vx, vy, dmg, 0, projId, {
      grav: PROJ_GRAV[projId] ?? 0,
      gravDelay: PROJ_GRAV_DELAY[projId] ?? -1,
      life: life ?? PROJ_LIFE[projId] ?? 3600,
      pierce: 1, hostile: true,
      bounce: PROJ_BOUNCE.has(projId),
      present: projId === 351,               // aiStyle 58 两段重力（Arrow 内实现）
      ...arrowOpts,
    }),
    'projectiles');
}

// ---------------------------------------------------------------------------
// 共享悬浮巡航（aiStyle 57/61 同构尾段，NPC.cs:33186-33245 / :34105-34154）：
//  攻击态或玩家在正下方 50px 内 → 水平减速停步；否则按 direction 以 num 巡航速
//  (v*20±num)/21 逼近。垂直三态：玩家正下方 → 下压 vy+=0.5；底部 80x20 探测盒
//  撞实心 → 悬浮上推（钳 -4）；否则下落（钳 10）。
// ---------------------------------------------------------------------------
function hoverCruise(
  e: Enemy, game: GameHooks, player: Player | null, stop: boolean, speed: number,
): void {
  if (stop) {
    e.vx *= 0.9;
    if (e.vx > -0.1 && e.vx < 0.1) e.vx = 0;
  } else {
    if (e.facing > 0) e.vx = (e.vx * 20 + speed) / 21;
    if (e.facing < 0) e.vx = (e.vx * 20 - speed) / 21;
  }
  const above = !!player && e.x < player.x && e.x + e.w > player.x + player.w
    && e.y + e.h < player.y + player.h - 16;
  if (above) {
    e.vy += 0.5;
  } else if (solidRect(game, e.cx - 40, e.y + e.h - 20, 80, 20)) {
    if (e.vy > 0) e.vy = 0;
    if (e.vy > -0.2) e.vy -= 0.025;
    else e.vy -= 0.2;
    if (e.vy < -4) e.vy = -4;
  } else {
    if (e.vy < 0) e.vy = 0;
    if (e.vy < 0.1) e.vy += 0.025;
    else e.vy += 0.5;
  }
  if (e.vy > 10) e.vy = 10;
  e.x += e.vx;   // 运行时 noTileCollide=true（:32941-32942 / :33906-33907）→ 直积分
  e.y += e.vy;
}

// ---------------------------------------------------------------------------
// AI_057 悲木 325 / 常世吼 344（NPC.cs:32937-33245）
// ai[0] 0=巡航蓄招 / 1=喷火(325 焰木弹 325｜344 针叶 345) / 2=抛射(325 希腊火
//        326-328｜344 装饰球 346) / 3=325 专属速射焰木 / 4=325 专属希腊火连泼。
// ai[1]=状态内计时。巡航速 2→3(<75%)→4(<50%)；白天 EncourageDespawn+8 速离场。
// ---------------------------------------------------------------------------

export function mourningWoodAI(e: Enemy, game: GameHooks, player: Player | null) {
  if (!e.bInit) { e.bInit = true; e.ai0 = 0; e.ai1 = 0; }
  const ever = e.vanillaId === 344;
  const isDay = game.world.clock.isDay;
  let num891 = 2;                                   // 巡航速(:32940)
  if (e.hp < e.maxHp * 0.75) num891 = 3;
  if (e.hp < e.maxHp * 0.5) num891 = 4;
  // 点光(:32958-32965)：底部 -30px——344 常世吼 (0.3,0.16,0.125) / 325 哀木
  // (0.3,0.125,0.06)；光源位 = Bottom+(0,-30)（曾漏 lightRGBAt 落在中心格）
  e.lightRGB = ever ? [0.3, 0.16, 0.125] : [0.3, 0.125, 0.06];
  e.lightRGBAt = { x: e.cx, y: e.y + e.h - 30 };
  // TargetClosest 仅夜间(:32943-32946)——白天保留上一朝向
  if (!isDay && player && !player.dead) e.facing = e.seekDirX(player);
  let flag56 = false;

  if (isDay) {
    e.encourageDespawn(10);                          // :32966-32970
    num891 = 8;
  } else if (e.ai0 === 0) {
    // 蓄招(:32971-32988)：300t（残血加速）→ 换攻击态；<25% 且非 344 可 roll 3/4
    e.ai1 += 1;
    if (e.hp < e.maxHp * 0.5) e.ai1 += 1;
    if (e.hp < e.maxHp * 0.25) e.ai1 += 1;
    if (e.ai1 >= 300) {
      e.ai1 = 0;
      e.ai0 = (e.hp < e.maxHp * 0.25 && !ever) ? rndRange(3, 5) : rndRange(1, 3);
    }
  } else if (e.ai0 === 1 && player) {
    // 喷火(:32989-33051)：344 每 5t 一发针叶 345（伤 43 速 12.5，体内随机点出膛）；
    // 325 每 15t 一发焰木 325（伤 50 速 10，底部中心出膛）
    flag56 = true;
    e.ai1 += 1;
    if (ever) {
      if (e.ai1 % 5 === 0) {
        const ox = e.x + 20 + Math.random() * (e.w - 40);
        const oy = e.y + 20 + Math.random() * (e.h - 40);
        let dx = player.cx - ox, dy = player.y - oy;
        dx += rndRange(-50, 51); dy += rndRange(-50, 51);
        dy -= Math.abs(dx) * (rnd(21) * 0.01);
        const d = Math.hypot(dx, dy) || 1;
        const s = 12.5 / d;
        dx *= s * (1 + rndRange(-20, 21) * 0.02);
        dy *= s * (1 + rndRange(-20, 21) * 0.02);
        shootE(game, ox, oy, dx, dy, 43, 345);
      }
      if (e.ai1 >= 180) { e.ai1 = 0; e.ai0 = 0; }
    } else {
      if (e.ai1 % 15 === 0) {
        const ox = e.cx, oy = e.cy + 30;
        let dx = player.cx - ox, dy = player.y - oy;
        const d = Math.hypot(dx, dy) || 1;
        const s = 10 / d;
        // ★R23b-D4 修:325 支散布系数原版为 0.01(:33121-33122),曾误抄 344 针叶支的 0.02
        dx *= s * (1 + rndRange(-20, 21) * 0.01);
        dy *= s * (1 + rndRange(-20, 21) * 0.01);
        shootE(game, ox, oy, dx, dy, 50, 325);
        // 燃木出生音（Projectile.cs:56158-56161 type==325 AI:ai[1]==0→置 1 播
        // SoundID.Item42 = 每弹首发一次；本仓 shootE 恰生成一枚 → 发射点直播等价。
        // 敌源两发射点 NPC.cs:33123 伤50 / :33211 伤75）
        game.playSfxWav?.('Item_42', 1, ox, oy);
      }
      if (e.ai1 >= 120) { e.ai1 = 0; e.ai0 = 0; }
    }
  } else if (e.ai0 === 2 && player) {
    // 抛射(:33052-33118)：60-240t 窗口内 344 每 15t 装饰球 346（伤 57）/
    // 325 每 8t 希腊火 326-328（伤 40）；弹道带 |dx|*0.3 上抛 + 50-200px 抬升
    flag56 = true;
    e.ai1 += 1;
    if (e.ai1 > 60 && e.ai1 < 240) {
      if (ever) {
        if (e.ai1 % 15 === 0) {
          let spd = 4.5;
          const ox = e.x + 20 + Math.random() * (e.w - 40);
          const oy = e.y + 60 + Math.random() * (e.h - 80);
          let dx = player.cx - ox, dy = player.y - oy;
          dy -= Math.abs(dx) * 0.3;
          spd += Math.abs(dx) * 0.004;
          dx += rndRange(-50, 51); dy -= rndRange(50, 201);
          const d = Math.hypot(dx, dy) || 1;
          const s = spd / d;
          dx *= s * (1 + rndRange(-30, 31) * 0.01);
          dy *= s * (1 + rndRange(-30, 31) * 0.01);
          shootE(game, ox, oy, dx, dy, 57, 346);
        }
      } else if (e.ai1 % 8 === 0) {
        let spd = 10;
        const ox = e.cx, oy = e.cy + 30;
        let dx = player.cx - ox, dy = player.y - oy;
        dy -= Math.abs(dx) * 0.3;
        spd += Math.abs(dx) * 0.004;
        if (spd > 14) spd = 14;
        dx += rndRange(-50, 51); dy -= rndRange(50, 201);
        const d = Math.hypot(dx, dy) || 1;
        const s = spd / d;
        dx *= s * (1 + rndRange(-30, 31) * 0.01);
        dy *= s * (1 + rndRange(-30, 31) * 0.01);
        shootE(game, ox, oy, dx, dy, 40, rndRange(326, 329));
      }
    }
    if (e.ai1 >= 300) { e.ai1 = 0; e.ai0 = 0; }
  } else if (e.ai0 === 3 && player) {
    // 325 专属速射焰木(:33119-33145)：每 30t 一发 325（伤 75 速 16），120t 收招
    num891 = 4;
    e.ai1 += 1;
    if (e.ai1 % 30 === 0) {
      const ox = e.cx, oy = e.cy + 30;
      let dx = player.cx - ox, dy = player.y - oy;
      const d = Math.hypot(dx, dy) || 1;
      const s = 16 / d;
      dx *= s * (1 + rndRange(-20, 21) * 0.001);
      dy *= s * (1 + rndRange(-20, 21) * 0.001);
      shootE(game, ox, oy, dx, dy, 75, 325);
      game.playSfxWav?.('Item_42', 1, ox, oy);   // 燃木出生音（Projectile.cs:56158-56161，同上）
    }
    if (e.ai1 >= 120) { e.ai1 = 0; e.ai0 = 0; }
  } else if (e.ai0 === 4 && player) {
    // 325 专属希腊火连泼(:33146-33179)：每 10t 一发 326-328（伤 50 速 12→16），240t 收招
    num891 = 4;
    e.ai1 += 1;
    if (e.ai1 % 10 === 0) {
      let spd = 12;
      const ox = e.cx, oy = e.cy + 30;
      let dx = player.cx - ox, dy = player.y - oy;
      dy -= Math.abs(dx) * 0.2;
      spd += Math.abs(dx) * 0.002;
      if (spd > 16) spd = 16;
      dx += rndRange(-50, 51); dy -= rndRange(50, 201);
      const d = Math.hypot(dx, dy) || 1;
      const s = spd / d;
      dx *= s * (1 + rndRange(-30, 31) * 0.005);
      dy *= s * (1 + rndRange(-30, 31) * 0.005);
      shootE(game, ox, oy, dx, dy, 50, rndRange(326, 329));
    }
    if (e.ai1 >= 240) { e.ai1 = 0; e.ai0 = 0; }
  }
  // 玩家在正下方 50px 内 → 停步(:33180-33185)
  if (player && Math.abs(e.cx - player.cx) < 50) flag56 = true;
  hoverCruise(e, game, player, flag56, num891);
  // ---- FindFrame case 344 副本（cs:73144-73170）：counter += max(1,|vx|*0.75)/t
  //      （站定 vx==0 分支 +1/t）、>5 进帧（越限溢出随回卷丢弃 → 须步进副本）；
  //      e.lai0=counter / e.lai1=帧行（全带 0-9 回卷）。325 同函数但两分支
  //      counter 恒 +1/t ≡ animT，Renderer 用 t 直推无需副本 ----
  if (ever) {
    e.lai0 += e.vx === 0 ? 1 : Math.max(1, Math.abs(e.vx) * 0.75);
    if (e.lai0 > 5) {
      e.lai0 = 0;
      e.lai1 += 1;
      if (e.lai1 > 9) e.lai1 = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// AI_058 南瓜王 327（NPC.cs:33246-33404）
// localAI[0/1]=表情帧节拍；localAI[2]=300t 换招计时 → ai[3] = rand(3)
//   （0 希腊火散射 / 1 悬浮→俯冲 / 2 交由双刃放焰镰）。
// ai[0]=0 首帧生双刃 328（ai0=-1/1 侧别）；ai[1] 0=悬浮(300t) 1=俯冲(16 速) 2=离场。
// ---------------------------------------------------------------------------

/** 刃 → 南瓜王（原版 npc[ai[1]]；先走 master 引用，断链回退 id 查找） */
function findPumpking(game: GameHooks, e: Enemy): Enemy | null {
  if (e.master && !e.master.dead && e.master.vanilla?.aiStyle === 58) return e.master;
  return (game.enemies() as Enemy[]).find(
    (n) => !n.dead && n.id === e.ai1 && n.vanilla?.aiStyle === 58) ?? null;
}

export function pumpkingAI(e: Enemy, game: GameHooks, player: Player | null) {
  const L = la(e);
  if (!e.bInit) { e.bInit = true; e.ai0 = 0; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0; L[2] = 0; }
  // 表情帧节拍(:33247-33256)：6t 一拍，5 拍一循环（渲染帧端消费）
  L[0]++;
  if (L[0] > 6) { L[0] = 0; L[1]++; if (L[1] > 4) L[1] = 0; }
  if (e.vanillaId === 327) e.lightRGB = [0.4, 0.4, 0.2];   // :33262-33264
  // 换招(:33266-33272)
  L[2]++;
  if (L[2] > 300) {
    L[2] = 0;
    e.ai3 = rnd(3);
  } else if (e.ai3 === 0 && L[2] % 30 === 0 && L[2] > 30 && player) {
    // 希腊火散射(:33273-33298)：每 30t 从 (cx, cy+30) 一发 326-328（伤 40 速 5，
    // 出膛点须非实心格）；dy*0.2 = 近乎水平的扇面散射
    const ox = e.cx, oy = e.cy + 30;
    if (!solidTileAt(game, ox, oy)) {
      let dx = player.cx - ox, dy = player.y - oy;
      dx += rndRange(-50, 51);
      dy += rndRange(50, 201);
      dy *= 0.2;
      const d = Math.hypot(dx, dy) || 1;
      const s = 5 / d;
      dx *= s * (1 + rndRange(-30, 31) * 0.01);
      dy *= s * (1 + rndRange(-30, 31) * 0.01);
      shootE(game, ox, oy, dx, dy, 40, rndRange(326, 329));
    }
  }
  // 首帧生双刃(:33300-33316)：ai0=-1 左 / +1 右（右刃 ai3=150 预蓄）
  if (e.ai0 === 0) {
    if (player) e.facing = e.seekDirX(player);
    e.ai0 = 1;
    for (const side of [-1, 1]) {
      const b = spawnPart(game, e, 328);
      if (!b) continue;
      b.ai0 = side;
      b.ai1 = e.id;
      b.ai2 = 0;
      b.ai3 = side === 1 ? 150 : 0;
      b.master = e;
    }
  }
  // 玩家死/2000px 外 → 离场态(:33318-33331)
  const gone = !player || player.dead
    || Math.abs(e.x - player.x) > 2000 || Math.abs(e.y - player.y) > 2000;
  if (gone && e.ai1 !== 2) e.ai1 = 2;

  if (game.world.clock.isDay) {
    // 白天坠离(:33333-33336)
    e.vy += 0.3;
    e.vx *= 0.9;
  } else if (e.ai1 === 0) {
    // 悬浮(:33337-33385)：伺服玩家上方 200px；选了俯冲招(ai3==1)且蓄满 300t → 转俯冲
    e.ai2++;
    if (e.ai2 >= 300) {
      if (e.ai3 !== 1) { e.ai1 = 0; e.ai2 = 0; }
      else {
        e.ai1 = 1; e.ai2 = 0;
        if (player) e.facing = e.seekDirX(player);
      }
    }
    if (player) {
      const dx = player.cx - e.cx, dy = player.cy - 200 - e.cy;
      let dist = Math.hypot(dx, dy);
      let spd = 6;
      if (e.ai3 === 1) {           // 俯冲招蓄力期赶路提速(:33358-33370)
        if (dist > 900) spd = 12;
        else if (dist > 600) spd = 10;
        else if (dist > 300) spd = 8;
      }
      if (dist > 50) {
        const k = spd / dist;
        e.vx = (e.vx * 14 + dx * k) / 15;
        e.vy = (e.vy * 14 + dy * k) / 15;
      }
    }
  } else if (e.ai1 === 1) {
    // 俯冲(:33386-33400)：16 速直扑玩家中心；600t 或换招后回悬浮
    e.ai2 += 1;
    if (e.ai2 >= 600 || e.ai3 !== 1) { e.ai1 = 0; e.ai2 = 0; }
    if (player) {
      const dx = player.cx - e.cx, dy = player.cy - e.cy;
      const d = Math.hypot(dx, dy) || 1;
      const k = 16 / d;
      e.vx = (e.vx * 49 + dx * k) / 50;
      e.vy = (e.vy * 49 + dy * k) / 50;
    }
  } else if (e.ai1 === 2) {
    // 离场(:33401-33404... 原行号 :33386 段内)
    e.vy += 0.1;
    if (e.vy < 0) e.vy *= 0.95;
    e.vx *= 0.95;
    e.encourageDespawn(500);
  }
  e.visAngle = e.vx * -0.02;       // rotation(:33402)
  e.x += e.vx;                     // noTileCollide（SetDefaults 327）直积分
  e.y += e.vy;
  // ---- FindFrame case 327 姿态机副本（cs:72977-73037，Renderer 直读 customFrameIdx）：
  //      ai[3] 姿态 0→行0带 / 1→行4带 / 2→行8带；counter ±1/t（越 ±6 进一帧行，
  //      7t/步）、12 帧双向回卷——表情滑变到位后定格（e.lai0=counter/e.lai1=行） ----
  let step327 = 0;
  if (e.ai3 === 0) {
    if (e.lai1 > 5) step327 = 1;
    else if (e.lai1 > 0) step327 = -1;
  } else if (e.ai3 === 1) {
    if (e.lai1 > 10) step327 = 1;
    else if (e.lai1 > 4) step327 = -1;
    else if (e.lai1 < 4) step327 = 1;
  } else if (e.ai3 === 2) {
    if (e.lai1 < 2) step327 = -1;
    else if (e.lai1 > 8) step327 = -1;
    else if (e.lai1 < 8) step327 = 1;
  }
  e.lai0 += step327;
  if (e.lai0 > 6) { e.lai0 = 0; e.lai1 += 1; if (e.lai1 > 11) e.lai1 = 0; }
  if (e.lai0 < 0) { e.lai0 = 6; e.lai1 -= 1; if (e.lai1 < 0) e.lai1 = 11; }
  e.customFrameIdx = e.lai1;
}

// ---------------------------------------------------------------------------
// AI_059 南瓜王之刃 328（NPC.cs:33405-33587）
// ai[0]=侧别(-1/1)；ai[1]=主 id；ai[2] 0/3=环绕 →1=升空 →2=俯冲 →(回 3) /
//        →4=横摆 →5=横扫回环；ai[3]=环绕计时。主选焰镰招(ai[3]==2)时 90t 一发 329。
// ---------------------------------------------------------------------------

export function pumpkingBladeAI(e: Enemy, game: GameHooks, player: Player | null) {
  const L = la(e);
  const side = e.ai0 < 0 ? -1 : 1;                 // num937(:33407)
  e.facing = -side;                                 // spriteDirection(:33410)
  // 主缺失/非 aiStyle 58 → 自毁(:33412-33427)
  const master = findPumpking(game, e);
  if (!master) {
    e.vx *= 0.9; e.vy *= 0.9;
    e.dead = true;
    return;
  }
  e.master = master;
  // 主选焰镰招(:33429-33447)：90t 一发焰镰 329（伤 60，0.01/距离 的极慢初速——
  // 弹体 aiStyle 56 自加速 ×1.05/t 至 |v|=16，Projectile.cs:27666-27687；
  // NewProjectile 传 ai[0]=刃当前 rotation / ai[1]=spriteDirection，首步继承）
  if (master.ai3 === 2 && player) {
    L[1]++;
    if (L[1] > 90) {
      L[1] = 0;
      const ox = e.cx, oy = e.cy + 30;
      const dx = player.cx - ox, dy = player.y - oy;
      const d = Math.max(1, Math.hypot(dx, dy));
      const k = 0.01 / d;
      (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(
        new Arrow(e.cx, e.cy, dx * k, dy * k, 60, 0, 329, {
          grav: 0, life: 420, pierce: 1, hostile: true,
          scythe: { rot0: e.visAngle, flipDir: -e.facing },   // :33440 ai0=rotation/ai1=spriteDirection
        }), 'projectiles');
    }
  }

  if (game.world.clock.isDay) {
    // 白天坠离(:33449-33452)
    e.vy += 0.3;
    e.vx *= 0.9;
  } else if (e.ai2 === 0 || e.ai2 === 3) {
    // 环绕(:33454-33506)：目标=玩家/主中点偏 (-170*side, +90)；玩家主相距 >700
    // 则退回主旁；按距离 6/9/12/15/18/21 速伺服；180t → 升下一态
    if (master.ai1 === 2) e.encourageDespawn(10);
    e.ai3++;
    if (e.ai3 >= 180) { e.ai2 += 1; e.ai3 = 0; }
    let tx: number, ty: number;
    if (player) {
      tx = (player.cx + master.cx) / 2 - 170 * side - e.cx;
      ty = (player.cy + master.cy) / 2 + 90 - e.cy;
      const manh = Math.abs(player.cx - master.cx) + Math.abs(player.cy - master.cy);
      if (manh > 700) { tx = master.cx - 170 * side - e.cx; ty = master.cy + 90 - e.cy; }
    } else {
      tx = master.cx - 170 * side - e.cx;
      ty = master.cy + 90 - e.cy;
    }
    let dist = Math.max(1, Math.hypot(tx, ty));
    let spd = 6;
    if (dist > 1000) spd = 21;
    else if (dist > 800) spd = 18;
    else if (dist > 600) spd = 15;
    else if (dist > 400) spd = 12;
    else if (dist > 200) spd = 9;
    // 侧别推离：把刃往主外侧推 4px/t(:33492-33497)
    if (side < 0 && e.cx > master.cx) tx -= 4;
    if (side > 0 && e.cx < master.cx) tx += 4;
    const k = spd / dist;
    e.vx = (e.vx * 14 + tx * k) / 15;
    e.vy = (e.vy * 14 + ty * k) / 15;
    dist = Math.max(1, Math.hypot(tx, ty));
    if (dist > 20) e.visAngle = Math.atan2(ty, tx) + Math.PI / 2;   // :33502-33505
  } else if (e.ai2 === 1) {
    // 升空(:33508-33534)：退到主外侧 200px、上方 230px；升过主顶 200px →
    // 18 速直扑玩家转俯冲
    const tx = master.cx - 200 * side - e.cx;
    const ty = master.y + 230 - e.cy;
    e.visAngle = Math.atan2(ty, tx) + Math.PI / 2;
    e.vx *= 0.95;
    e.vy -= 0.3;
    if (e.vy < -14) e.vy = -14;
    if (e.y < master.y - 200) {
      e.ai2 = 2;
      if (player) {
        const dx = player.cx - e.cx, dy = player.cy - e.cy;
        const d = Math.max(1, Math.hypot(dx, dy));
        const k = 18 / d;
        e.vx = dx * k;
        e.vy = dy * k;
      }
    }
  } else if (e.ai2 === 2) {
    // 俯冲(:33536-33546)：越过玩家高度/开始上飘/离主 800px → 回环绕
    const manh = Math.abs(e.cx - master.cx) + Math.abs(e.cy - master.cy);
    if (!player || e.y > player.y || e.vy < 0 || manh > 800) e.ai2 = 3;
  } else if (e.ai2 === 4) {
    // 横摆(:33548-33574)：钉主外侧 200px/上 230px，横速朝主对侧 ±14；
    // 离主 500px → 17 速直扑玩家转横扫
    const tx = master.cx - 200 * side - e.cx;
    const ty = master.y + 230 - e.cy;
    e.visAngle = Math.atan2(ty, tx) + Math.PI / 2;
    e.vy *= 0.95;
    e.vx += 0.3 * -side;
    if (e.vx < -14) e.vx = -14;
    if (e.vx > 14) e.vx = 14;
    if (e.cx < master.cx - 500 || e.cx > master.cx + 500) {
      e.ai2 = 5;
      if (player) {
        const dx = player.cx - e.cx, dy = player.cy - e.cy;
        const d = Math.max(1, Math.hypot(dx, dy));
        const k = 17 / d;
        e.vx = dx * k;
        e.vy = dy * k;
      }
    }
  } else if (e.ai2 === 5) {
    // 横扫回环(:33576-33586)：越过玩家水平轴/离主 800px → 回环绕
    const manh = Math.abs(e.cx - master.cx) + Math.abs(e.cy - master.cy);
    if (!player || (e.vx > 0 && e.cx > player.cx) || (e.vx < 0 && e.cx < player.cx) || manh > 800) {
      e.ai2 = 0;
    }
  }
  e.x += e.vx;                     // noTileCollide（SetDefaults 328）直积分
  e.y += e.vy;
}

// ---------------------------------------------------------------------------
// AI_060 冰雪女王 345（NPC.cs:33588-33901）
// ai[0] -1=重选 / 0=滑翔+FrostWave 348 / 1=压制+FrostShard 349 落冰 /
//        2=自旋+FrostShard 349 环射。ai[1]=rand(1,4)/t 蓄招；ai[2]=滑翔朝向；
// ai[3]=弹幕节拍（0/负计数半周期）。残血四档全面提速（75/50/25/10%）。
// ---------------------------------------------------------------------------

export function iceQueenAI(e: Enemy, game: GameHooks, player: Player | null) {
  if (!e.bInit) { e.bInit = true; e.ai0 = 0; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0; }
  if (game.world.clock.isDay) {
    // 白天飞离(:33590-33599)：沿当前水平向加速 + 缓升
    e.vx += e.vx > 0 ? 0.25 : -0.25;
    e.vy -= 0.1;
    e.visAngle = e.vx * 0.05;
    e.x += e.vx; e.y += e.vy;
    return;
  }
  const r = e.hp / e.maxHp;
  if (!player) {
    e.x += e.vx; e.y += e.vy;
    return;
  }
  e.facing = e.seekDirX(player);             // TargetClosest（各态首行）

  if (e.ai0 === 0) {
    // 滑翔(:33601-33686)：固定水平朝向 ai[2]（与玩家同侧），越过 800px 才回摆
    if (e.ai2 === 0) e.ai2 = e.cx < player.cx ? 1 : -1;
    const dxAbs = Math.abs(e.cx - player.cx);
    if (e.cx < player.cx && e.ai2 < 0 && dxAbs > 800) e.ai2 = 0;
    if (e.cx > player.cx && e.ai2 > 0 && dxAbs > 800) e.ai2 = 0;
    let acc = 0.45, spd = 7;
    if (r < 0.75) { acc = 0.55; spd = 8; }
    if (r < 0.5) { acc = 0.7; spd = 10; }
    if (r < 0.25) { acc = 0.8; spd = 11; }
    e.vx += e.ai2 * acc;
    e.vx = clamp(e.vx, -spd, spd);
    // 垂直：保持悬在玩家上方 150-200px（:33628-33641）
    const gap = player.y - (e.y + e.h);
    if (gap < 150) e.vy -= 0.2;
    if (gap > 200) e.vy += 0.2;
    e.vy = clamp(e.vy, -8, 8);
    e.visAngle = e.vx * 0.05;
    // FrostWave(:33644-33685)：近距(<500)或节拍后半程且自身在玩家上方 →
    // 13..10+1 拍循环，过零拍从 (cx+vx*7, cy) 一发 348（伤 42，速 6..9）
    if ((dxAbs < 500 || e.ai3 < 0) && e.y < player.y) {
      e.ai3 += 1;
      let beat = 13;
      if (r < 0.75) beat = 12;
      if (r < 0.5) beat = 11;
      if (r < 0.25) beat = 10;
      beat++;
      if (e.ai3 > beat) e.ai3 = -beat;
      if (e.ai3 === 0) {
        const ox = e.cx + e.vx * 7, oy = e.cy;
        let dx = player.cx - ox, dy = player.cy - oy;
        let pspd = 6;
        if (r < 0.75) pspd = 7;
        if (r < 0.5) pspd = 8;
        if (r < 0.25) pspd = 9;
        const d = Math.hypot(dx, dy) || 1;
        const k = pspd / d;
        shootE(game, ox, oy, dx * k, dy * k, 42, 348);
      }
    } else if (e.ai3 < 0) {
      e.ai3 += 1;
    }
    // 蓄招(:33688-33694)：>800 且近距 → 重选
    e.ai1 += rndRange(1, 4);
    if (e.ai1 > 800 && dxAbs < 600) e.ai0 = -1;
  } else if (e.ai0 === 1) {
    // 压制落冰(:33696-33775)：水平弱追踪（速 6..9），节拍 18..8+3 一发
    // FrostShard 349（伤 37，vy=max(vy,0)+3 下坠）
    let acc = 0.15, spd = 7;
    if (r < 0.75) { acc = 0.17; spd = 8; }
    if (r < 0.5) { acc = 0.2; spd = 9; }
    if (r < 0.25) { acc = 0.25; spd = 10; }
    acc -= 0.05;
    spd -= 1;
    if (e.cx < player.cx) {
      e.vx += acc;
      if (e.vx < 0) e.vx *= 0.98;
    }
    if (e.cx > player.cx) {
      e.vx -= acc;
      if (e.vx > 0) e.vx *= 0.98;
    }
    if (e.vx > spd || e.vx < -spd) e.vx *= 0.95;
    const gap = player.y - (e.y + e.h);
    if (gap < 180) e.vy -= 0.1;
    if (gap > 200) e.vy += 0.1;
    e.vy = clamp(e.vy, -6, 6);
    e.visAngle = e.vx * 0.01;
    e.ai3 += 1;
    let beat = 15;
    if (r < 0.75) beat = 14;
    if (r < 0.5) beat = 12;
    if (r < 0.25) beat = 10;
    if (r < 0.1) beat = 8;
    beat += 3;
    if (e.ai3 >= beat) {
      e.ai3 = 0;
      const ox = e.cx, oy = e.y + e.h - 14;
      if (!solidTileAt(game, ox, oy)) {
        const vy = Math.max(e.vy, 0) + 3;
        shootE(game, ox, oy, e.vx * 0.25, vy, 37, 349);
      }
    }
    e.ai1 += rndRange(1, 4);
    if (e.ai1 > 600) e.ai0 = -1;
  } else if (e.ai0 === 2) {
    // 自旋环射(:33777-33834)：原速 0.95 衰减 + rotation+=0.2；随机方向 15 速，
    // 出膛点 (cx,cy-20)+方向*4；节拍 7/6/4/1/-3（<10% 血时 ai[3]>负数恒真 → 每 tick 一发）
    // 349（伤 35）
    let dx = rndRange(-1000, 1001), dy = rndRange(-1000, 1001);
    const d = Math.hypot(dx, dy) || 1;
    const k = 15 / d;
    dx *= k; dy *= k;
    e.vx *= 0.95; e.vy *= 0.95;
    e.visAngle += 0.2;
    const ox = e.cx + dx * 4, oy = e.cy - 20 + dy * 4;
    e.ai3 += 1;
    let beat = 7;
    if (r < 0.75) beat--;
    if (r < 0.5) beat -= 2;
    if (r < 0.25) beat -= 3;
    if (r < 0.1) beat -= 4;
    if (e.ai3 > beat) {
      e.ai3 = 0;
      shootE(game, ox, oy, dx, dy, 35, 349);
    }
    e.ai1 += rndRange(1, 4);
    if (e.ai1 > 500) e.ai0 = -1;
  }
  if (e.ai0 === -1) {
    // 重选(:33836-33847)：rand(3)，>1000px 强制滑翔
    let pick = rnd(3);
    if (Math.abs(e.cx - player.cx) > 1000) pick = 0;
    e.ai0 = pick;
    e.ai1 = 0; e.ai2 = 0; e.ai3 = 0;
  }
  e.x += e.vx;                     // noTileCollide（SetDefaults 345）直积分
  e.y += e.vy;
}

// ---------------------------------------------------------------------------
// AI_061 圣诞坦克 346（NPC.cs:33902-34154）——与 aiStyle 57 同构的悬浮树怪 +
// ai[0] 0=蓄招(300t) 1=链炮弹幕(240t，proj 180 每 16/14/11/8t)；
// localAI[1]=火箭 350 连发（100t 突发，12t 一发）；localAI[2]=礼盒 351 突发
// （100t，9t 一发）；随机 352 尖刺（1/600 触发，残血缩到 1/300）。
// ---------------------------------------------------------------------------

export function santaNK1AI(e: Enemy, game: GameHooks, player: Player | null) {
  const L = la(e);
  if (!e.bInit) { e.bInit = true; e.ai0 = 0; e.ai1 = 0; L[1] = 0; L[2] = 0; }
  const isDay = game.world.clock.isDay;
  let num980 = 2;                                   // 巡航速(:33905)
  if (e.hp < e.maxHp * 0.75) num980 = 3;
  if (e.hp < e.maxHp * 0.5) num980 = 4;
  if (e.hp < e.maxHp * 0.25) num980 = 5;
  // 点光(:33918-33923)：中心格非实心时
  if (!solidTileAt(game, e.cx, e.cy)) e.lightRGB = [0.3, 0.26, 0.05];
  if (!isDay && player && !player.dead) e.facing = e.seekDirX(player);   // :33909-33912
  let flag58 = false;

  if (isDay) {
    e.encourageDespawn(10);                          // :33925-33931
    num980 = 8;
    if (e.vx === 0) e.vx = 0.1;
  } else {
    if (e.ai0 === 0) {
      // 蓄招(:33932-33941)
      e.ai1 += 1;
      if (e.ai1 >= 300 && player) {
        e.facing = e.seekDirX(player);        // TargetClosest
        e.ai1 = 0;
        e.ai0 = 1;
      }
    } else if (e.ai0 === 1 && player) {
      // 链炮(:33942-33975)： muzzle=(cx+dir*50, cy+rand(15,36))，每 num981 一发
      // BulletDeadeye 180（伤 36 速 15）
      e.ai1 += 1;
      flag58 = true;
      let num981 = 16;
      if (e.hp < e.maxHp * 0.25) num981 = 8;
      else if (e.hp < e.maxHp * 0.5) num981 = 11;
      else if (e.hp < e.maxHp * 0.75) num981 = 14;
      if (e.ai1 % num981 === 0) {
        const ox = e.cx + e.facing * 50, oy = e.cy + rndRange(15, 36);
        let dx = player.cx - ox, dy = player.cy - oy;
        dx += rndRange(-40, 41); dy += rndRange(-40, 41);
        const d = Math.hypot(dx, dy) || 1;
        const k = 15 / d;
        dx *= k * (1 + rndRange(-20, 21) * 0.015);
        dy *= k * (1 + rndRange(-20, 21) * 0.015);
        shootE(game, ox, oy, dx, dy, 36, 180);
      }
      if (e.ai1 > 240) { e.ai0 = 0; e.ai1 = 0; }
    }
  }
  // 三种随机武器(:33977-34103)：独立于 ai[0]/昼夜（原版仅 netMode 门）——
  // 阈值 600/1200/2700（残血 0.9/0.75/0.5 缩）
  if (player) {
    const r = e.hp / e.maxHp;
    let nBurst = 600, nRocket = 1200, nPresent = 2700;
    if (r < 0.25) { nBurst *= 0.5; nRocket *= 0.5; nPresent *= 0.5; }
    else if (r < 0.5) { nBurst *= 0.75; nRocket *= 0.75; nPresent *= 0.75; }
    else if (r < 0.75) { nBurst *= 0.9; nRocket *= 0.9; nPresent *= 0.9; }
    const gunX = e.cx - e.facing * 24, gunY = e.cy - 64;   // 炮口(:33985/34005/34140)
    // 尖刺 352（伤 80，近乎垂直上抛的慢速弹）
    if (rnd(nBurst) === 0) {
      let dx = rndRange(1, 100) * e.facing, dy = 1;
      const d = Math.hypot(dx, dy) || 1;
      const k = 1 / d;
      shootE(game, gunX, gunY, dx * k, dy * k, 80, 352);
    }
    // 火箭 350 突发（:34000-34031）：触发置 localAI[1]=1，100t 内每 12t 一发（伤 42 速 12.5）
    if (rnd(nRocket) === 0) L[1] = 1;
    if (L[1] >= 1) {
      L[1] += 1;
      if (L[1] % 12 === 0) {
        let dx = player.cx - gunX, dy = player.cy - gunY;
        dx += rndRange(-50, 51); dy += rndRange(-50, 51);
        const d = Math.hypot(dx, dy) || 1;
        const k = 12.5 / d;
        dx *= k * (1 + rndRange(-20, 21) * 0.015);
        dy *= k * (1 + rndRange(-20, 21) * 0.015);
        shootE(game, gunX, gunY, dx, dy, 42, 350);
      }
      if (L[1] >= 100) L[1] = 0;
    }
    // 礼盒 351 突发（:34033-34064）：触发置 localAI[2]=2，100t 内每 9t 一发
    // （伤 50 速 11，-300 垂直分量 = 高抛）
    if (rnd(nPresent) === 0) L[2] = 2;
    if (L[2] > 0) {
      L[2] += 1;
      if (L[2] % 9 === 0) {
        let dx = rndRange(-100, 101), dy = -300;
        const d = Math.hypot(dx, dy) || 1;
        const k = 11 / d;
        dx *= k * (1 + rndRange(-20, 21) * 0.01);
        dy *= k * (1 + rndRange(-20, 21) * 0.01);
        shootE(game, gunX, gunY, dx, dy, 50, 351);
      }
      if (L[2] >= 100) L[2] = 0;
    }
  }
  if (player && Math.abs(e.cx - player.cx) < 50) flag58 = true;   // :34105-34107
  hoverCruise(e, game, player, flag58, num980);
  // ---- FindFrame case 346 副本（cs:73050-73093，Renderer 直读 customFrameIdx）：
  //      ai0==1 链炮开火带 6-8 每 3t 循环；vx==0 定格（帧不动、仅清计数——开火/
  //      玩家头顶停步期不迈腿）；行走带 1-5 counter += 1+|vx|/2、>4 进帧
  //      （L[0]=counter / L[3]=帧行，定格记忆无法无状态重建 → AI 侧副本）----
  if (e.ai0 === 1) {
    L[0] += 1;
    if (L[0] > 2) { L[0] = 0; L[3] += 1; }
    if (L[3] > 8) L[3] = 6;
    if (L[3] < 6) L[3] = 6;
  } else if (e.vx === 0) {
    L[0] = 0;
  } else {
    L[0] += 1;
    L[0] += Math.abs(e.vx) / 2;      // 原版两条自增语句分开写（浮点求和序 1:1）
    if (L[0] > 4) { L[0] = 0; L[3] += 1; }
    if (L[3] > 5) L[3] = 1;
    if (L[3] < 1) L[3] = 1;
  }
  e.customFrameIdx = L[3];
}

// ---------------------------------------------------------------------------
// AI_062 玩具直升机 347（NPC.cs:34155-34207）
// 7 速追 (cx+dir*20, cy+6)→玩家；>600px 或无视线 → 全速追；否则原速 0.98 衰减
// 悬停，几乎静止后每 15t 一发 BulletDeadeye 180（伤 32 速 10）。白天倒飞离场。
// ---------------------------------------------------------------------------

export function elfCopterAI(e: Enemy, game: GameHooks, player: Player | null) {
  const L = la(e);
  if (!e.bInit) { e.bInit = true; L[0] = 0; }
  if (!player) { e.x += e.vx; e.y += e.vy; return; }
  e.facing = e.seekDirX(player);             // TargetClosest(:34157)
  e.visAngle = Math.abs(e.vx) * e.facing * 0.1;      // rotation(:34158)
  const ox = e.cx + e.facing * 20, oy = e.cy + 6;    // vector121(:34160)
  let dx = player.cx - ox, dy = player.y - oy;
  const dist = Math.hypot(dx, dy) || 1;
  const k = 7 / dist;
  dx *= k; dy *= k;
  const canHit = losClear(game, e.cx, e.cy, player.cx, player.cy);   // Collision.CanHit(:34169)
  if (game.world.clock.isDay) {
    // 白天倒飞离场(:34171-34178)：目标速度取反
    e.vx = (e.vx * 59 - dx) / 60;
    e.vy = (e.vy * 59 - dy) / 60;
    e.encourageDespawn(10);
    e.x += e.vx; e.y += e.vy;
    return;
  }
  if (dist > 600 || !canHit) {
    // 远距/隔墙：全速追(:34180-34186)
    e.vx = (e.vx * 59 + dx) / 60;
    e.vy = (e.vy * 59 + dy) / 60;
    e.x += e.vx; e.y += e.vy;
    return;
  }
  // 近距悬停点射(:34188-34206)
  e.vx *= 0.98;
  e.vy *= 0.98;
  if (Math.abs(e.vx) < 1 && Math.abs(e.vy) < 1) {
    L[0] += 1;
    if (L[0] >= 15) {
      L[0] = 0;
      let sx = player.cx - ox, sy = player.cy - oy;
      sx += rndRange(-35, 36); sy += rndRange(-35, 36);
      sx *= 1 + rndRange(-20, 21) * 0.015;
      sy *= 1 + rndRange(-20, 21) * 0.015;
      const d = Math.hypot(sx, sy) || 1;
      const sk = 10 / d;
      sx *= sk * (1 + rndRange(-20, 21) * 0.0125);
      sy *= sk * (1 + rndRange(-20, 21) * 0.0125);
      // ★BJ710-G35 D1：347 ElfCopter（banner 110）发射者旗冻结（FindBannerToAssociateTo
      //  P.cs:11106-11119——NPC 发弹恒 EntitySource_Parent,旗减伤对 180 链炮弹生效）
      shootE(game, ox, oy, sx, sy, 32, 180, undefined, { bannerNpcId: bannerNpcKeyOf(e) });
    }
  }
  e.x += e.vx;                     // noTileCollide（SetDefaults 347）直积分
  e.y += e.vy;
}

// ---------------------------------------------------------------------------
// AI_063 弗洛科 352（NPC.cs:34208-34255）
// 11 速追 (cx+dir*20, cy+6)→玩家中心；<200px 进入旋冲（ai[0]=20 拍冷却，
// rotation+=0.3*dir 保持原速度俯冲），拉开后回追踪（<350/<300 双重加速收敛）。
// ---------------------------------------------------------------------------

export function flockoAI(e: Enemy, game: GameHooks, player: Player | null) {
  if (!e.bInit) { e.bInit = true; e.ai0 = 0; }
  if (!player) { e.x += e.vx; e.y += e.vy; return; }
  e.facing = e.seekDirX(player);             // TargetClosest(:34210)
  const ox = e.cx + e.facing * 20, oy = e.cy + 6;    // vector122(:34212)
  let dx = player.cx - ox, dy = player.cy - oy;
  const dist = Math.hypot(dx, dy) || 1;
  const k = 11 / dist;
  dx *= k; dy *= k;
  if (game.world.clock.isDay) {
    // 白天反向逃逸(:34220-34223)
    dx = -dx; dy = -dy;
  }
  e.ai0 -= 1;                                       // :34225
  if (dist < 200 || e.ai0 > 0) {
    // 旋冲(:34227-34239)：贴近置 20 拍；方向取速度符号（原版改写 direction，
    // 不动 spriteDirection），原地自旋不改变速度
    if (dist < 200) e.ai0 = 20;
    const diveDir = e.vx < 0 ? -1 : 1;
    e.visAngle += diveDir * 0.3;
    e.x += e.vx; e.y += e.vy;
    return;
  }
  // 追踪(:34241-34254)：(v*50+n)/51，<350/<300 再叠两重收敛
  e.vx = (e.vx * 50 + dx) / 51;
  e.vy = (e.vy * 50 + dy) / 51;
  if (dist < 350) {
    e.vx = (e.vx * 10 + dx) / 11;
    e.vy = (e.vy * 10 + dy) / 11;
  }
  if (dist < 300) {
    e.vx = (e.vx * 7 + dx) / 8;
    e.vy = (e.vy * 7 + dy) / 8;
  }
  e.visAngle = e.vx * 0.15;
  e.x += e.vx;                      // noTileCollide（SetDefaults 352）直积分
  e.y += e.vy;
}

// ---------------------------------------------------------------------------
// AI_038 雪人三兄弟（NPC.cs:29115-29256）
// 143 SnowmanGangsta：每 120t 一发 BulletSnowman 110（伤 25 速 12*dir 水平）。
// 144 MisterStabby / 145 SnowBalla：ai[1]>=3 落地停顿（144 200t / 145 16t，
//   145 在第 8 拍投 SnowBallHostile 109，伤 35 速 10）；停顿结束 ai[1] 清零回跳扑。
// 其余：三连跳循环（ai[0] 0/1/2 小跳 vy=-6，过 2 大跳 vy=-8.2 + ai[1]+1）；
//   原地白跳（localAI[2]==x）→ 转向 + ai[3]=60 冷却。
// ---------------------------------------------------------------------------

export function snowmanAI(e: Enemy, game: GameHooks, player: Player | null) {
  const L = la(e);
  if (!e.bInit) { e.bInit = true; e.ai0 = 0; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0; }
  const vid = e.vanillaId ?? 143;
  let num586 = 4, num587 = 1;                        // 限速/加速(:29118-29127)
  if (vid === 143) { num586 = 3; num587 = 0.7; }
  if (vid === 145) { num586 = 3.5; num587 = 0.8; }
  // 重力+位移先积分（原版 AI 读上一帧 velocity.Y==0 判落地，等价移动后判定）
  e.vy = Math.min(e.vy + ENEMY_GRAVITY, MAX_FALL_SPEED);
  moveAndCollide(e, game.world, e.vx, e.vy);
  const onG = e.onGround;   // moveAndCollide 落地即 vy=0（原版 velocity.Y==0 门）

  if (vid === 143) {
    // 机枪雪球(:29129-29151)。1457 :29199-29201 加 confused 清零 + flag43 =
    // AI_GlobalFiringDistanceCheck——超视野不消耗计数（ai2 照加但不射击）
    e.ai2 += 1;
    if (e.confused) e.ai2 = 0;
    if (e.ai2 >= 120) {
      e.ai2 = 0;
      if (player && !player.dead
        && aiGlobalFiringDistanceCheck(e.cx, e.cy, player.cx, player.cy)) {
        const ox = e.cx - e.facing * 12, oy = e.cy;
        // ★BJ710-G35 D1：143 Snowman Gangsta（banner 141 族）发射者旗冻结
        shootE(game, ox, oy, 12 * e.facing, 0, 25, 110, undefined, { bannerNpcId: bannerNpcKeyOf(e) });
        // 出膛音（Projectile.cs:56211-56215 ai[1]==0 首拍）:弹 110 → Item11——
        // 发射位等价结算（弹先出生后补播,同 bossAI.ts 83=Item_33 先例）
        game.playSfxWav?.('Item_11', 1, ox, oy);
      }
    }
  }
  if (vid === 144 && e.ai1 >= 3) {
    // Stabby 停顿(:29153-29170)
    e.facing = player ? e.seekDirX(player) : -1;   // TargetClosest
    if (onG) {
      e.vx *= 0.9;
      if (e.vx > -0.3 && e.vx < 0.3) e.vx = 0;
      e.ai2 += 1;
      if (e.ai2 >= 200) { e.ai2 = 0; e.ai1 = 0; }
    }
  } else if (vid === 145 && e.ai1 >= 3) {
    // SnowBalla 投掷停顿(:29172-29206)：第 8 拍投雪球 109。
    // 1457 :29243-29246 flag44 = AI_GlobalFiringDistanceCheck——落地且未蓄力且
    // 超视野 → ai1 归零（回跳扑态,不进入投掷停顿）
    if (onG && e.ai2 === 0 && (!player || player.dead
      || !aiGlobalFiringDistanceCheck(e.cx, e.cy, player.cx, player.cy))) {
      e.ai1 = 0;
    }
    e.facing = player ? e.seekDirX(player) : -1;
    if (onG) {
      e.vx *= 0.9;
      if (e.vx > -0.3 && e.vx < 0.3) e.vx = 0;
      e.ai2 += 1;
      if (e.ai2 >= 16) { e.ai2 = 0; e.ai1 = 0; }
    }
    if (e.vx === 0 && e.vy === 0 && e.ai2 === 8 && player) {
      const ox = e.cx - e.facing * 12, oy = e.y + e.h * 0.25;
      let dx = player.cx - ox, dy = player.y - oy;
      const d = Math.hypot(dx, dy) || 1;
      const k = 10 / d;
      // ★BJ710-G35 D1：145 Snow Balla（banner 143 族）发射者旗冻结
      shootE(game, ox, oy, dx * k, dy * k, 35, 109, undefined, { bannerNpcId: bannerNpcKeyOf(e) });
    }
  } else {
    // 跳扑循环(:29208-29234)
    if (onG) {
      if (L[2] === e.x) { e.facing *= -1; e.ai3 = 60; }   // 原地白跳转向
      L[2] = e.x;
      if (e.ai3 === 0 && player) e.facing = e.seekDirX(player);   // TargetClosest
      e.ai0 += 1;
      if (e.ai0 > 2) {
        e.ai0 = 0;
        e.ai1 += 1;
        e.vy = -8.2;
        e.vx += e.facing * num587 * 1.1;
      } else {
        e.vy = -6;
        e.vx += e.facing * num587 * 0.9;
      }
    }
    e.vx += e.facing * num587 * 0.01;
  }
  if (e.ai3 > 0) e.ai3 -= 1;                         // :29236-29238
  if (e.vx > num586 && e.facing > 0) e.vx = num586;
  if (e.vx < -num586 && e.facing < 0) e.vx = -num586;
}

// ---------------------------------------------------------------------------
// AI_009 弹跳球族（NPC.cs:21349-21548）
// 25 FireBall(速5) / 30+665 ChaosBall(速6) / 33 WaterSphere(速6) / 112+666 VileSpit
// (速7，ai[0]==2 双倍位移+进墙自爆) / 516 SolarFlare(渐显+随机出膛+微追踪，
// 撞墙/贴脸 20px 自爆)。全员每 tick EncourageDespawn(100)、rotation 累进。
// ---------------------------------------------------------------------------

/** 原版精灵恒隐形的弹体系：33 水球（SetDefaults alpha=255）；30/665 混沌球
 *  （AI :21496 每帧强置 alpha=255）——视觉全靠尘迹，本仓改为显形精灵+补尘迹 */
function invisibleSpriteBall(e: Enemy): boolean {
  const id = e.vanillaId ?? -1;
  return id === 33 || id === 30 || id === 665;
}

export function bouncingBallAI(e: Enemy, game: GameHooks, player: Player | null) {
  const L = la(e);
  if (!e.bInit) {
    e.bInit = true; e.ai0 = 0;   // 原版 ai[0] 从 0 起步（Enemy 默认 -1120 是史莱姆族约定）
    e.visAngle = 0;              // npc.rotation 默认 0（类字段默认 π 是 EoC 语境）
    // 弹体可见性：原版 33 SetDefaults alpha=255、30/665 AI 每帧强置 alpha=255
    // （cs:21494-21496）——精灵恒隐形，弹体视觉【全部】由尘迹承担（33=尘172×6/t
    // 蓝尘、30/665=尘27×4/t 阴影焰紫、25=尘6 火尘）。fromVanilla 对 alpha>=255 走
    // 254 起步 -1/t 渐显 → 球前 ~200t 不透明度 <80%（玩家间距内全程近乎不可见）且
    // 无尘迹补偿 = "看不到任何弹幕"（2026-08-17 用户报告 32 不发射）。本仓粒子密度/
    // 发光弱于原版尘系，保隐形会退化成隐形弹：故三系直接全显精灵 + 补尘迹/补光
    // （偏差登记：原版精灵隐形、仅尘迹+尘光）
    if (invisibleSpriteBall(e)) { e.alphaFade = false; e.spawnAlpha = 0; }
  }
  const vid = e.vanillaId ?? 25;
  // 日耀耀斑(:21354-21378 + GetAlpha :94729-94733)：alpha 字段被 GetAlpha 特判
  // 反用——tint = Color(α,α,α,α)（α 兼亮度与不透明度，两版反编译同文），故
  // SetDefaults α=0 出生 + AI +40/t 钳 220 = 【渐显】到 86% 亮度/不透明度
  // （非默认 α 语义的渐隐——G10 定谳 2026-08-19：曾按默认语义反写=出生全显后
  // 渐隐，方向反了）。本仓 spawnAlpha 反向（0=全显/255=全隐）→ 镜像实现：
  // 出生 255，-40/t 落到 35（=255−220，即 86% 不透明度驻留）。
  // 出膛方向 = 朝玩家 ±90° 随机（再固定回转 -45°），Y 分量钳 0.2，速 6+rand*4
  if (vid === 516) {
    if (e.spawnAlpha === 0) e.spawnAlpha = 255;      // 出生隐形（GetAlpha (0,0,0,0)）
    if (e.spawnAlpha > 35) e.spawnAlpha = Math.max(35, e.spawnAlpha - 40);
    if (e.ai0 === 0) {
      e.ai0 = 1;
      if (player) {
        let dx = player.cx - e.cx, dy = player.cy - e.cy;
        const d = Math.hypot(dx, dy) || 1;
        dx /= d; dy /= d;
        const ang = Math.atan2(dy, dx) + (Math.random() * 2 - 1) * 1.5707963705062866
          - 0.7853981852531433;
        let ux = Math.cos(ang), uy = Math.sin(ang);
        if (uy > 0.2) uy = 0.2;
        const spd = 6 + Math.random() * 4;
        e.vx = ux * spd; e.vy = uy * spd;
      }
    }
    // 撞墙/距玩家 <20px → 自爆（原版 StrikeNPCNoInteraction(9999)）
    const hitWall = solidRect(game, e.x, e.y, e.w, e.h);
    if (hitWall || (player && Math.hypot(player.cx - e.cx, player.cy - e.cy) < 20)) {
      e.hurt(9999, 0, 0, game);
      return;
    }
  }
  // 首帧定速直飞(:21380-21406)：num125 = 6（25→5、112/666→7）；
  // FTW 抬档(:21391-21407)：33 且骷髅王在场 → 10（RedHat 8）/ 25 且血肉墙在场 → 14 /
  // 666 → 10（flag8 = RedHatSkeletronAdjustmentsEnabled：33 判 ai[3]==1，NPC.cs:67282）
  if (!L[3] && player) {
    L[3] = 1;
    let num125 = 6;
    if (vid === 25) num125 = 5;
    if (vid === 112 || vid === 666) num125 = 7;
    if (game.world.seedFlags?.getGoodWorld) {
      if (vid === 33 && anyNpcs(game, 35)) {
        num125 = 10;
        if (e.ai3 === 1) num125 = 8;
      }
      if (vid === 25 && anyNpcs(game, 113)) num125 = 14;
      if (vid === 666) num125 = 10;
    }
    const dx = player.cx - e.cx, dy = player.cy - e.cy;
    const d = Math.hypot(dx, dy) || 1;
    e.vx = (dx / d) * num125;
    e.vy = (dy / d) * num125;
  }
  // getGoodWorld 专属无敌分支(:21422-21435，expert 略)：
  //   33 且骷髅王在场 / 25 且血肉墙在场 / 666 地表（Center.Y/16 < worldSurface）→
  //   dontTakeDamage。原版门为 !dontTakeDamage（只置不清——条件失效后已置位的球
  //   仍无敌，原版怪癖 1:1）
  if (game.world.seedFlags?.getGoodWorld && !e.dontTakeDamage) {
    if (vid === 33 && anyNpcs(game, 35)) e.dontTakeDamage = true;
    else if (vid === 25 && anyNpcs(game, 113)) e.dontTakeDamage = true;
    else if (vid === 666 && e.cy / TILE < game.world.groundLevel) e.dontTakeDamage = true;
  }
  // 毒唾(:21425-21451)：ai[0] 1→3 渐进；==2 时双倍位移 + 爆裂尘
  if (vid === 112 || vid === 666) {
    // ★RB30b-F3（2026-09-16）：每 tick 伤害档覆写（:21548-21555 `damage=defDamage;
    //  type==666 → damage=GetAttackDamage_CappedAtMaster(32)`）——666 恒 32×难度乘区
    // （经典 32/专家 64/大师 96，journey 16；SetDefaults 65 只是静态基线,活体每拍被
    // AI 覆写）。曾缺=接触伤恒走 def.damage 快照。112 的 `damage=defDamage` 在本仓
    // 等价恒等（无他处覆写）不重复写。fromVanilla def 已实例私有,直写安全（同族惯例）
    if (vid === 666) e.def.damage = getAttackDamageCappedAtMaster(32, e.difficulty);
    e.ai0 += 1;
    if (e.ai0 > 3) e.ai0 = 3;
    if (e.ai0 === 2) {
      e.x += e.vx;
      e.y += e.vy;
      // FX45（2026-09-16,用户实报"弹幕只有球体没粒子"）：出生相原版站 1:1 化——
      // 原版 :21563 PlaySound(4,x,y,9)（case4=NPC_Killed 库 → NPC_Killed_9）+
      // :21564-21571 出膛爆裂 20× 尘 18 CorruptGibs（盒 pos.X/pos.Y+2/w/h、
      // sp0/0、α100、scale1.8、尘速 ×1.3 后 += 弹速、noGravity）。曾是 3 粒
      // '#7A4FB0' 泛色 spawnParticles 伪造（尘型/频数/速度三差）
      game.playSfxFiles?.(['NPC_Killed_9'], 1, e.x, e.y);
      for (let k = 0; k < 20; k++) {
        const d = game.spawnDust?.(e.x, e.y + 2, e.w, e.h,
          18, 0, 0, 100, null, 1.8, true);
        if (!d) continue;
        d.vx = d.vx * 1.3 + e.vx;
        d.vy = d.vy * 1.3 + e.vy;
      }
    }
    // 进实心块自爆(:21463-21468)——noTileCollide 穿墙飞行途中入墙即碎
    if (solidRect(game, e.x, e.y, e.w, e.h)) {
      e.hurt(9999, 0, 0, game);
      return;
    }
  }
  e.encourageDespawn(100);                           // :21470（离屏 ~100t 即消）
  if (vid === 516) {
    // 耀斑微追踪(:21472-21488)：(v*14 + dir*(|v|+1/12))/15，<6 速时 ×1.05 回升
    e.visAngle += 0.1 * e.facing;
    if (player) {
      let dx = player.cx - e.cx, dy = player.cy - e.cy;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d; dy /= d;
      const spd = Math.hypot(e.vx, e.vy);
      e.vx = (e.vx * 14 + dx * (spd + 1 / 12)) / 15;
      e.vy = (e.vy * 14 + dy * (spd + 1 / 12)) / 15;
      if (Math.hypot(e.vx, e.vy) < 6) { e.vx *= 1.05; e.vy *= 1.05; }
    }
  } else {
    // 火球点光(:21540-21542，默认分支 = FireBall）
    if (vid === 25) e.lightRGB = [1, 0.3, 0.1];
    // 尘迹补偿（原版 :21488-21540 每 tick 尘 2×{3-4} 颗，隐形系弹体的全部视觉）：
    //   33=尘172 淡蓝（wiki：与水矢雷同/发光） / 30·665=尘27 阴影焰紫 / 25=尘6 火尘
    // 33 补点光（原版光源=尘 172 自发光，本仓粒子不发光——wiki"emits a fair amount
    // of light"）；25 的 AddLight(1,0.3,0.1) 已在上方原样接
    if (vid === 33) {
      e.lightRGB = [0.55, 0.75, 1];
      // 尘迹升级为原版真尘（NPC.cs:21618-21639，双循环每 tick 6 粒 d172 + 1/5 掷
      // 第 7 粒 scale0.6）：尘速 ×0.1+vel×0.5、位置沿 −vel/3×循环序 递推拖影、
      // noGravity、α100——曾是 2 粒泛色近似（密度/材质双差，用户报"法师弹幕效果"）
      for (let loop = 0; loop < 2; loop++) {
        for (let i = 0; i < 3; i++) {
          const d = game.spawnDust?.(e.x + 2, e.y + 2, e.w - 4, e.h - 4,
            172, 0, 0, 100, null, 1.2, true);
          if (!d) continue;
          d.vx = d.vx * 0.1 + e.vx * 0.5;
          d.vy = d.vy * 0.1 + e.vy * 0.5;
          d.x -= (e.vx / 3) * loop;
          d.y -= (e.vy / 3) * loop;
        }
        if (Math.random() < 0.2) {
          const d2 = game.spawnDust?.(e.x + 2, e.y + 2, e.w - 4, e.h - 4,
            172, 0, 0, 100, null, 0.6);
          if (d2) { d2.vx = d2.vx * 0.25 + e.vx * 0.5; d2.vy = d2.vy * 0.25 + e.vy * 0.5; }   // ★R1:此粒无 noGravity(:21635-21639)
        }
      }
    } else if (vid === 30 || vid === 665) {
      // 原版真尘(NPC.cs:21601-21616,alpha=255 强置隐形,可视面全在尘):双循环每
      // tick 4 粒 d27 阴影焰紫(sp=v×0.2、尘速×0.3−vel×0.2、noGravity、scale1.3)。
      // ★R1 盒修正:原版 (pos.X, pos.Y+2, w, h)——X 不内缩(Y+2 是取尘锚)
      for (let loop = 0; loop < 2; loop++) {
        for (let i = 0; i < 2; i++) {
          const d = game.spawnDust?.(e.x, e.y + 2, e.w, e.h,
            27, e.vx * 0.2, e.vy * 0.2, 100, null, 1.3, true);
          if (!d) continue;
          d.vx = d.vx * 0.3 - e.vx * 0.2;
          d.vy = d.vy * 0.3 - e.vy * 0.2;
        }
      }
    } else if (vid === 25) {
      // ★R1 桶勘误:type 25=aiStyle 9(NPC.cs:9121)→ aiStyle9 尾 else 桶
      // (:21651-21661,在 num133<2 循环内):每 tick 2 粒 d6(sp=v×0.2 入参、
      // 尘速 ×0.3→终 v×0.06、noGravity、scale2)、盒 (pos.X, pos.Y+2, w, h)——
      // 此前误用 aiStyle8 尾的 1/6+scale1.65 档
      for (let loop = 0; loop < 2; loop++) {
        const d = game.spawnDust?.(e.x, e.y + 2, e.w, e.h,
          6, e.vx * 0.2, e.vy * 0.2, 100, null, 2, true);
        if (!d) continue;
        d.vx *= 0.3; d.vy *= 0.3;
      }
    } else if (vid === 112 || vid === 666) {
      // FX45（2026-09-16）：飞行尾迹原版真尘（NPC.cs:21644-21650,在 num133<2 双
      // 循环内=每 tick 2 粒）：尘 18 CorruptGibs、盒 (pos.X, pos.Y+2, w, h)、
      // sp=v×0.1、α80（≠同族其余支的 100）、scale1.3、尘速 ×0.3、noGravity——
      // 此前整支缺失（弹体飞行时零粒子,用户实报根因）
      for (let loop = 0; loop < 2; loop++) {
        const d = game.spawnDust?.(e.x, e.y + 2, e.w, e.h,
          18, e.vx * 0.1, e.vy * 0.1, 80, null, 1.3, true);
        if (!d) continue;
        d.vx *= 0.3; d.vy *= 0.3;
      }
    }
    e.visAngle += 0.4 * e.facing;                    // :21547
  }
  // 位移：noTileCollide 族穿墙直积分；516（tileCollide）走碰撞
  if (e.vanilla?.noTileCollide) {
    e.x += e.vx;
    e.y += e.vy;
  } else {
    moveAndCollide(e, game.world, e.vx, e.vy);
    // 516 的 collideX/collideY（:21370 上一帧碰撞旗标）→ 撞墙/落地即自爆
    if (vid === 516 && (e.hitWall || e.hitHead || e.onGround)) {
      e.hurt(9999, 0, 0, game);
    }
  }
}
