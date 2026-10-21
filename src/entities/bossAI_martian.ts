// 火星疯狂(Martian Madness) AI 家族 1:1 移植(Terarria1456, 1.4.5.6)：
//   aiStyle 80  火星探测器 399                NPC.cs:38129-38223（巡逻→受惊悬停 60t→
//                                              反向加速升空,出屏/180t → Main.StartInvasion(4)）
//   aiStyle 76  火星飞碟核心 395              NPC.cs:36322-36773（600t 攻击循环 六窗口巡航;
//                                              生成 393×2/394×2/392×1;SetDefaults dontTakeDamage
//                                              =true → 部件全灭前无敌,普通模式部件全灭→自毁）
//   aiStyle 75  飞碟部件 392/393/394 + 骑手 390  NPC.cs:35745-36321（锚主体零速跟随;
//                                              393 激光窗[280,420)/394 炮窗[440,580)/392
//                                              死光电报[20,260)+空巢发射器;390 骑 391 射 438）
//   aiStyle 74  火星无人机 388(+日耀 Corite 418) NPC.cs:35452-35744（悬浮瞄准→蓄力→
//                                              扑咬;388 贴身 64px/撞块自爆 192×192 伤 80）
//   aiStyle 73  特斯拉炮塔 387                 NPC.cs:35340-35451（120t 部署渐显→180t
//                                              循环电击 435;受击打断 -30t）
//   aiStyle 72  泡泡盾 384                     NPC.cs:35318-35339（锚军官 383,军官死→消散）
//   aiStyle  3  火星军官 383 / 工程师 386 尾段  NPC.cs:56614-56645 / 59384-59428（军官带盾
//                                              无敌+180t 补盾;工程师 ±5t 扫地放 387,上限 4×自身）
//   aiStyle 49  愤怒云 250(同批普查顺带)        NPC.cs:31742-31810（悬顶 200px,正下方淋雨 264）
// expert 分支(飞碟 ai0=1 旋转过渡/ai0=2 死光弹幕 3600t)按 world.isExpert 真难度开闭
// （World.get isExpert = difficulty >= EXPERT;曾硬编码 EXPERT=false 恒关）;netcode 跳过。
// 弹幕贴图 Projectile_{264,435,438,447-450}.png 已入 sprites/vanilla(见 shootM 注释)。
import type { Enemy } from './Enemy';
import { aiGlobalFiringDistanceCheck } from './Enemy';
import type { GameHooks } from './types';
import type { Player } from './Player';
import { TILE, ENEMY_GRAVITY, MAX_FALL_SPEED } from '../core/constants';
import { moveAndCollide } from '../physics/TileCollision';
import { spawnPart, losClear } from './bossAI';
import { getAttackDamageForProjectiles, hostileProjectileDamage, mainDifficulty } from '../stats/ScaleStats';
import { Arrow } from './Arrow';
import { canStartInvasion, startInvasion, INVASION_MARTIAN } from '../world/Invasion';
import { dutchmanCannonAI } from './bossAI_dd2';

/** 原版 localAI[0..3]（Enemy 的 ai0-ai3 对应 ai[],localAI 独立 → WeakMap 落盘） */
const localAI = new WeakMap<Enemy, number[]>();
const la = (e: Enemy): number[] => {
  let a = localAI.get(e);
  if (!a) { a = [0, 0, 0, 0]; localAI.set(e, a); }
  return a;
};
/** 主体 → 部件槽位（395 飞碟与 392 炮体共用 [炮塔0,炮塔1,火炮0,火炮1],cs:36327-36355） */
const slots = new WeakMap<Enemy, Enemy[]>();
/** 军官 383 → 泡泡盾 384 引用（原版 ai[2]=盾 index+1,cs:56618） */
const officerShield = new WeakMap<Enemy, Enemy>();

const rnd = (n: number): number => Math.floor(Math.random() * n);
const rndRange = (a: number, b: number): number => a + Math.floor(Math.random() * (b - a));
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const sign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);

// ---------------------------------------------------------------------------
// 弹幕:火星族弹体贴图 Projectile_{264,435,438,447,448,449,450}.png 已按 601/602
// 先例自 terraria-assets/Images 补入 public/sprites/vanilla/(Arrow 按 projId 懒加载),
// 此前的 RENDER_PROXY 代渲登记已退役。
// ProjectileID.cs 对照:264 RainCloud 雨滴 / 435 MartianTurretBlast(特斯拉电球) /
// 438 MuonBlast(骑手弹) / 447 MartianDeathray(死光电报——★终零波销核:AI_079 已
//   :929 起 MartianDeathray 实体类 1:1 实装(:36201/:36670 两生产位均走该类),
//   旧"自带 proj AI 未实装→直飞代"登记就此退役) /
// 448 MartianSaucerCannon(火炮弹) / 449 MartianSaucerLaser(激光) / 450 MartianMissile。
// ---------------------------------------------------------------------------
function shootM(
  game: GameHooks, x: number, y: number, vx: number, vy: number,
  dmg: number, projId: number, life = 300, pierce = 1,
  arrowOpts?: Partial<import('./Arrow').ArrowOpts>,
): void {
  (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(
    new Arrow(x, y, vx, vy, dmg, 0, projId, { grav: 0, life, pierce, hostile: true, ...arrowOpts }),
    'projectiles');
}

/** 脚下净空扫描（cs:36400-36421 同构）：返回到第一个实心面的像素距离。
 *  脚下即实心 → 16px（原版 num=1）；150t 内无面 → 150*16 */
function groundGapPx(game: GameHooks, e: Enemy): number {
  const st = game.world.store;
  const tx = Math.floor(e.cx / TILE);
  const ty = Math.floor((e.y + e.h) / TILE);
  const solidAt = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < st.w && y < st.h && st.isSolid(x, y) && !st.half[st.idx(x, y)];
  if (solidAt(tx, ty)) return TILE;
  let n = 0;
  while (n < 150 && ty + n < st.h) {
    if (solidAt(tx, ty + n)) { n--; break; }
    n++;
  }
  return n * TILE;
}

/** 原版 CS 直积分（noTileCollide 族） */
const fly = (e: Enemy): void => { e.x += e.vx; e.y += e.vy; };
/** 单格实心（世界边界外视为空,飞碟出界由本 AI 兜底） */
function solidTile(game: GameHooks, x: number, y: number): boolean {
  const st = game.world.store;
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  return tx >= 0 && ty >= 0 && tx < st.w && ty < st.h && st.isSolid(tx, ty);
}

// ---------------------------------------------------------------------------
// AI_080 火星探测器 399（NPC.cs:38129-38223）
// ai[0] 0=巡逻(3px/s 朝向走,贴地 15t 内上升) / 1=受惊悬停 60t(×0.95) /
//        2=逃逸(noTileCollide,vy-0.1→-10 / vx+0.05*ai[3]→4)
// 触发：352px 内且玩家在下方 → 1；逃逸出屏(y<-h)或 180t → StartInvasion(4) + 消散
// ---------------------------------------------------------------------------
export function martianProbeAI(e: Enemy, game: GameHooks, player: Player | null) {
  if (!e.bInit) { e.bInit = true; e.ai0 = 0; e.ai1 = 0; e.ai3 = 0; }
  // 撞墙转向（:38137-38140 collideX → direction 翻转;首帧 direction==0 先索敌）
  if (e.hitWall) e.facing = -e.facing;

  if (e.ai0 === 0) {
    // 方向固定（原版仅 direction==0 时 TargetClosest,:38133-38136;撞墙翻转）
    e.vx = 3 * e.facing;
    // 贴地升降（:38145-38163）：脚下 30t 内首个实心面 <15t 升 / <20t 平 / 其余缓降
    const st = game.world.store;
    const tx = clamp(Math.floor(e.cx / TILE), 1, st.w - 2);
    let ty = Math.floor(e.cy / TILE);
    let gap = 30;
    for (let i = 0; i < 30; i++) { if (solidTile(game, tx * TILE, (ty + i) * TILE)) { gap = i; break; } }
    if (gap < 15) e.vy = Math.max(e.vy - 0.05, -3.5);
    else if (gap < 20) e.vy *= 0.95;
    else e.vy = Math.min(e.vy + 0.05, 1.5);
    // 受惊门（:38165-38173）：352px 内且玩家中心在探测器下方
    if (!player || player.dead) return;
    const dist = Math.hypot(player.cx - e.cx, player.cy - e.cy);
    if (dist < 352 && player.cy > e.cy) { e.ai0 = 1; e.ai1 = 0; }
  } else if (e.ai0 === 1) {
    // 悬停报警（:38175-38192）：60t 减速 → 逃逸,ai[3] = 玩家反侧方向
    e.ai1 += 1;
    e.vx *= 0.95; e.vy *= 0.95;
    if (e.ai1 >= 60) {
      e.ai1 = 0; e.ai0 = 2;
      e.ai3 = player && !player.dead && player.cx > e.cx ? -1 : 1;
    }
  } else {
    // 逃逸（:38194-38208）：noTileCollide,向上加速+横向 4px;出屏/180t → 入侵
    e.ai1 += 1;
    e.vy = Math.max(e.vy - 0.1, -10);
    e.vx = Math.min(e.vx + e.ai3 * 0.05, 4);
    if (e.y < -e.h || e.ai1 >= 180) {
      // Main.StartInvasion(4)（:38202）：原版只查"≥200HP 玩家数>0"且无视 delay;
      // canStartInvasion(ignoreDelay=true) 同语义,invasionType!=0 时静默 no-op。
      // 走 startInvasionWithAnnounce 带逼近公告(Game.startInvasionAndAnnounce
      // 实体侧通道)——直通 startInvasion 会漏 misc 广播+invasionWarn
      if (player && canStartInvasion(game.world, player.maxHp, true)) {
        if (!game.startInvasionWithAnnounce?.(INVASION_MARTIAN, true)) {
          startInvasion(game.world, INVASION_MARTIAN);
        }
      }
      e.dead = true;   // 原版 active=false（不走掉落/击杀记账）
      return;
    }
  }
  // 点光（:38210-38217）：rgb = ai0==2 ? Color.Red : Color.SkyBlue，×0.65
  // ——SkyBlue(135,206,235)/255×0.65=(0.344,0.525,0.599)；Red×0.65=(0.65,0,0)
  e.lightRGB = e.ai0 === 2 ? [0.65, 0, 0] : [0.344, 0.525, 0.599];
  // 位移：0/1 态贴地碰撞（SetDefaults 无 noTileCollide）,2 态原版置 noTileCollide=true
  if (e.ai0 === 2) fly(e);
  else moveAndCollide(e, game.world, e.vx, e.vy);
}

// ---------------------------------------------------------------------------
// AI_076 火星飞碟核心 395（NPC.cs:36322-36773）
// ai[0] 0=巡航攻击循环(ai[3] 600t 六窗口) / -1/-2=目标失效爬升驱散 /
//        1=expert 部件全灭旋转过渡(150t,本工程不可达) / 2=expert 死光弹幕(3600t) /
//        3=自毁(普通模式部件全灭,由 392 炮体置位)
// 攻击窗口（cs:36379-36397）：[580,600)=0 远侧悬停 / [20,260)=1 横掠 / [260,280)=2
//   归位 / [280,420)=3 炮塔激光（393 发射）/ [420,440)=4 顶悬 / [440,580)=5 火炮（394 发射）
// ---------------------------------------------------------------------------
const WIN = (a3: number): number =>
  a3 >= 580 ? 0 : a3 >= 440 ? 5 : a3 >= 420 ? 4 : a3 >= 280 ? 3 : a3 >= 260 ? 2 : a3 >= 20 ? 1 : 0;

export function martianSaucerAI(e: Enemy, game: GameHooks, player: Player | null) {
  // ---- 首帧生成部件（:36324-36355）：炮塔 393×2(ai[1]=0/1) 火炮 394×2 + 炮体 392 ----
  if (!e.bInit) {
    e.bInit = true;
    e.ai0 = 0; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0;
    const parts: Enemy[] = [];
    for (let i = 0; i < 2; i++) {
      const t = spawnPart(game, e, 393);
      if (t) { t.ai1 = i; t.master = e; parts.push(t); }
    }
    for (let i = 0; i < 2; i++) {
      const c = spawnPart(game, e, 394);
      if (c) { c.ai1 = i; c.master = e; parts.push(c); }
    }
    const hull = spawnPart(game, e, 392);
    if (hull) {
      hull.master = e;
      slots.set(hull, parts);   // 原版 392.localAI[0..3] = 四槽（cs:36351-36354）
    }
    slots.set(e, parts);
  }
  // ---- FindFrame case 395 counter 副本（cs:72520-72541，蜂后 222 先例：AI 写
  //      e.lai0、Renderer vanillaFrameIdx 读）：每 tick +1、66 回卷；死光电报窗
  //      ai[3]∈[20,260) 内再 +1 且钳 [36,53]（帧 6-8 蓄能辉光带）。只在两个
  //      非死亡出口调用（-1/-2 爬升分支与函数尾）= AI 全部完成后同步，与原版
  //      FindFrame 时序一致 ----
  const frameTick395 = (): void => {
    e.lai0 += 1;
    if (e.lai0 >= 66) e.lai0 = 0;
    if (e.ai3 >= 20 && e.ai3 < 260) {
      e.lai0 += 1;
      if (e.lai0 >= 54 || e.lai0 < 36) e.lai0 = 36;
    }
  };
  // ---- 自毁态（:36457-36461,1457 行号——旧注 :36357-36360 系 1456 伪锚 BJ308 勘误;普通模式由 392 置 ai0=3）----
  if (e.ai0 === 3) {
    e.iframes = 0;
    // ★BJ302（2026-09-23 用户实报「飞碟打死不掉落+打死后过一会才消失」定谳）：
    //   先清无敌旗——原版 StrikeNPCNoInteraction(9999)(NPC.cs:36459) → StrikeNPC
    //   (:82017) → StrikeNPC_Inner(:82063) 全链【无 dontTakeDamage 门】（仅 immortal
    //   一门 :82197,395 未置 immortal）——dontTakeDamage 只属玩家受击面 NPC.hurt()。
    //   本仓 hurt() 合并两通道,门在函数头;395 经典模式全程 latch true（:14069
    //   SetDefaults + 下方 ai0===0 支逐拍回钉）→ 9999 被吞 → ai0 恒 3 自毁支空转
    //   （无掉落无记账）+ 机体冻结悬停直至离屏消散 = 用户双症状。与 bossAI_dd2.ts
    //   荷兰人自毁「先清无敌旗」同款范式（golem 批注:StrikeNPCNoInteraction 族绕
    //   dontTakeDamage）。iframes 同理（StrikeNPC 不查免疫帧）本支原有清零先例。
    e.dontTakeDamage = false;
    e.hp = 0;
    e.hurt(9999, 0, 0, game);   // StrikeNPCNoInteraction(9999) → 标准死亡管线(掉落/记账)
    return;
  }
  // ---- 无敌（SetDefaults dontTakeDamage=true,1458 :14069;唯一解除点 ai0==1
  //      （:36738）且**不置回**——经 1 进 2 后保持可击;0→-1/-2 与 -2→2 未经过 1
  //      则全程无敌。★R23b 系统性修:改真旗标(pierce===1 单发弹绕过 iframes 免疫门),
  //      顺带修正红队 martian §1.3 登记的「-2/2 态我方重新可击」轻偏差=闩锁语义）----
  if (e.ai0 === 1) e.dontTakeDamage = false;
  else if (e.ai0 === 0 || e.ai0 < 0) e.dontTakeDamage = true;

  const center = { x: e.cx, y: e.cy };
  const RANGE = 5600;   // :36363
  // 目标失效（:36362-36388）：>5600px 或死亡 → -1(自巡航态)/-2(自弹幕态)
  const targetInvalid = !player || player.dead
    || Math.hypot(player.cx - center.x, player.cy - center.y) > RANGE;
  if (targetInvalid && e.ai0 !== 1) {
    if (e.ai0 === 0) e.ai0 = -1;
    else if (e.ai0 === 2) e.ai0 = -2;
  }
  // ---- 出界钳制 + 消散（1458 :36844-36859，flag94 在 aiStyle 76 块【末尾】对全态生效：
  //      四向越界 → position=Clamp + active=false（零掉落零计分直消散））----
  const st = game.world.store;
  const outOfBoundsKill = (): boolean => {
    if (e.y < -100 || e.x < -100 || e.y > st.h * TILE + 100 || e.x > st.w * TILE + 100) {
      e.x = clamp(e.x, -100, st.w * TILE + 100);
      e.y = clamp(e.y, -100, st.h * TILE + 100);
      // ★BJ352（2026-09-25 全 boss 消散记账普查,用户实报"传送走=击败"家族）：
      //   原版越界 = position 钳 + active=false 直清（1458 :36844-36859 零掉落零计分,
      //   不经 checkDead→Kill→NPCLoot）= 非击杀消散。曾只写 dead → 玩家传送走后
      //   飞碟 -1 态爬升出界（despawnTimer=300 逐拍回填压住通用消散,原版唯一出口
      //   即本支）被 Game bossBlock 误记为击败（downed_395+击败公告）。
      //   BJ347 教主 439 同范式；对全态生效（含战斗中撞出界,原版同相均非击杀）。
      e.bossFled = true;
      e.dead = true;
      return true;
    }
    return false;
  };
  if (e.ai0 === -1 || e.ai0 === -2) {
    e.vy -= 0.4;
    e.encourageDespawn(10);
    if (player && !player.dead) {
      e.despawnTimer = 300;                       // timeLeft = 300（:36486）
      // ★-1 态恢复语义（证据链）：1456 反编译 NPC.cs:36392-36395 为
      //   `if (this.ai[0] == 0f) { this.ai[0] = 0f; }`——此处置身 -1/-2 分支内
      //   恒为 no-op;1405 反编译（NPC.145.cs:36392-36395）逐字相同 → 两代独立
      //   反编译一致,IL 即如此。结论：-1（巡航转场）飞碟玩家回场**不回巡航**,
      //   持续 vy−0.4/t 爬升到出界钳制消散（1458 :36844-36859）;仅 -2（expert 死光
      //   转场）按 :36488-36491 回 2 态。曾误按对称性把 -1 也回 0 态。
      if (e.ai0 === -2) e.ai0 = 2;
      e.ai1 = 0; e.ai2 = 0; e.ai3 = 0;
    }
    // ★R23b-T1 修：本分支早退曾跳过块末的出界钳制——despawnTimer=300 又逐帧回填
    // 废掉 encourageDespawn(10)，普通模式玩家跑出 5600px 即得永久无敌爬升体
    // （既不归位也不消散）。原版唯一出口就是这条对全态生效的越界杀。
    if (outOfBoundsKill()) return;
    frameTick395();
    fly(e);
    return;
  }

  if (e.ai0 === 0) {
    // ---- 巡航攻击循环（:36390-36634）----
    const w1 = WIN(e.ai3);
    e.ai3 += 1;
    if (e.ai3 >= 600) e.ai3 = 0;
    const w = WIN(e.ai3);
    if (w !== w1) {                                // 窗口切换初始化（:36414-36430）
      if (w === 0) e.ai2 = 0;
      if (w === 1) e.ai2 = player && player.cx > center.x ? 1 : -1;
      if (w === 2) e.ai2 = 0;
    }
    const pcx = player ? player.cx : center.x, pcy = player ? player.cy : center.y;
    switch (w) {
      case 0: {
        // 远侧 600px 悬停（:36432-36446）：到点(<50px)跳 [19] 直进横掠
        if (e.ai2 === 0) e.ai2 = -600 * sign(center.x - pcx);
        let dx = pcx + e.ai2 - center.x, dy = pcy - 250 - center.y;
        const d = Math.hypot(dx, dy);
        if (d < 50) { e.ai3 = 19; break; }
        dx /= d; dy /= d;
        e.vx = lerp(e.vx, dx * 16, 0.1); e.vy = lerp(e.vy, dy * 16, 0.1);
        break;
      }
      case 1: {
        // 横掠（:36448-36480）：vx=3.5*ai[2];脚下净空<250px 上浮补齐
        const gap = groundGapPx(game, e);
        if (gap < 250) {
          const t = 4 > gap ? -gap : -4;
          e.vy = lerp(e.vy, t, 0.05);
        } else e.vy *= 0.95;
        e.vx = 3.5 * e.ai2;
        break;
      }
      case 2: {
        // 归位（:36514-36553）：玩家上方 ±300px;净空<170 抬升;到点(<70px)跳 [279] 进激光窗
        if (e.ai2 === 0) e.ai2 = 300 * sign(center.x - pcx);
        let dx = pcx + e.ai2 - center.x, dy = pcy - 170 - center.y;
        const gap = groundGapPx(game, e);
        if (gap < 170) dy -= 170 - gap;
        const d = Math.hypot(dx, dy);
        if (d < 70) { e.ai3 = 279; break; }
        dx /= d; dy /= d;
        e.vx = lerp(e.vx, dx * 20, 0.1); e.vy = lerp(e.vy, dy * 20, 0.1);
        break;
      }
      case 3: {
        // 激光窗缓漂（:36557-36582）：×0.85 双轴 + 净空<170 上浮
        const gap = groundGapPx(game, e);
        if (gap < 170) {
          const t = 4 > gap ? -gap : -4;
          e.vy = lerp(e.vy, t, 0.05);
        } else e.vy *= 0.85;
        e.vx *= 0.85;
        break;
      }
      case 4: {
        // 顶悬（:36591-36602）：到点(<50px)跳 [439] 进火炮窗
        let dx = pcx - center.x, dy = pcy - 250 - center.y;
        const d = Math.hypot(dx, dy);
        if (d < 50) { e.ai3 = 439; break; }
        dx /= d; dy /= d;
        e.vx = lerp(e.vx, dx * 16, 0.1); e.vy = lerp(e.vy, dy * 16, 0.1);
        break;
      }
      default: {
        // 火炮窗静止（:36604-36605）：×0.85 双轴
        e.vx *= 0.85; e.vy *= 0.85;
        break;
      }
    }
  } else if (e.ai0 === 1) {
    // ---- expert 部件全灭旋转过渡（:36634-36663,150t）:dontTakeDamage 解除(:36636) ----
    e.vx *= 0.96; e.vy *= 0.96;
    e.ai1 += 1;
    if (e.ai1 >= 150) { e.ai0 = 2; e.ai1 = 0; e.visAngle = 0; }
    // ★UnitY.RotatedBy(θ).Y = 0·sinθ + 1·cosθ = **cosθ**（Utils.cs:1752-1761 实文;
    //  2026-08-23 V5 复核纠正——曾误写 sin=相位差 1/4 周期,进相位应 ~满倾 0.198 非 0 爬升）
    else if (e.ai1 < 40) e.visAngle = Math.cos((e.ai1 / 40) * Math.PI * 2) * 0.2;
    else if (e.ai1 < 80) e.visAngle = Math.cos((e.ai1 / 20) * Math.PI * 2) * 0.3;
    else if (e.ai1 < 120) e.visAngle = Math.cos((e.ai1 / 10) * Math.PI * 2) * 0.4;
    else e.visAngle = ((e.ai1 - 120) / 30) * Math.PI * 2;
  } else if (e.ai0 === 2) {
    // ---- expert 死光弹幕（:36670-36749,3600t 循环;每 120t 后 60t 为射线窗）----
    const wasWin = e.ai3 % 120 >= 60 ? 1 : 0;
    e.ai3 += 1;
    const inWin = e.ai3 % 120 >= 60 ? 1 : 0;
    if (inWin !== wasWin) {
      if (inWin === 1) {
        e.ai2 = player && player.cx > center.x ? 1 : -1;
        // :36210 死光生成音 Item12
        game.playSfxWav?.('Item_12', 1, e.cx, e.cy);
        const ray = new MartianDeathray(e, 80);   // 447 死光电报（AI_079 实体）
        (game as unknown as { entities: { add(el: unknown, b: string): void } }).entities.add(ray, 'projectiles');
      }
    }
    if (e.ai3 >= 3600) { e.ai1 = 0; e.ai2 = 0; e.ai3 = 0; }
    else if (inWin === 0 && player) {
      let dx = player.cx + e.ai2 * 350 - center.x, dy = player.cy - 250 - center.y;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d; dy /= d;
      e.vx = lerp(e.vx, dx * 16, 0.1); e.vy = lerp(e.vy, dy * 16, 0.1);
    } else {
      const gap = groundGapPx(game, e);
      if (gap < 250) {
        const t = 4 > gap ? -gap : -4;
        e.vy = lerp(e.vy, t, 0.05);
      } else e.vy *= 0.95;
      e.vx = 8 * e.ai2;
    }
    e.visAngle = 0;
  }
  // ---- 出界钳制 + 消散（1458 :36844-36859；helper 见函数头，-1/-2 分支同享）----
  if (outOfBoundsKill()) return;
  frameTick395();
  fly(e);
}

// ---------------------------------------------------------------------------
// AI_075 飞碟部件 392/393/394 + 骑手 390（NPC.cs:35745-36321;416/492 同构锚表一并接）
// 锚点偏移（cs:35766/35813/35820/35827）:390→391 (0,-14);392→395 (0,2) 旋转随体;
//   393→395 (±60,+29);394→395 (±49,-13),spriteDirection=±1;416→415 (-spriteDir*10,-30)
// 主体消亡（:36288-36299）:390→Transform(382) / 416→Transform(518) / 其余消散
// ---------------------------------------------------------------------------
export function martianSaucerPartAI(e: Enemy, game: GameHooks, player: Player | null) {
  const id = e.vanillaId ?? 0;
  // ---- 荷兰大炮 492（DD2 批 bossAI_dd2.ts：锚船体偏移 cs:35889 + 240t 装填炮击
  // cs:36008）——aiStyle 75 分发进本函数,转发后不走飞碟部件路径。
  // MINOR-4 第六挂载点（:35989）：锚船体 491 存活 → DiscourageDespawn(60)（校验门
  // 与 dutchmanCannonAI 内 `!ship || ship.dead || vanillaId!==491` 同式;492 在
  // DoesntDespawnToInactivity 名单=保真位）----
  if (id === 492) {
    if (e.master && !e.master.dead && e.master.vanillaId === 491) e.discourageDespawn(60);
    dutchmanCannonAI(e, game, player);
    return;
  }
  // ---- 骑手首帧生成坐骑（:35750-35762）----
  if ((id === 390 || id === 416) && !e.bInit) {
    e.bInit = true;
    const mount = spawnPart(game, e, id === 390 ? 391 : 415);
    if (mount) { e.master = mount; e.drawBehindMaster = true; }   // 坐骑槽序在后=画骑手前(与部件 master 锚反)
  }
  if (!e.bInit && (id === 392 || id === 393 || id === 394)) e.bInit = true;

  const mount = e.master;
  const mountOk = !!mount && !mount.dead;
  if (!mountOk) {
    // 主体消亡分支（:36288-36299）
    if (id === 390 || id === 416) {
      e.transformTo(id === 390 ? 382 : 518, game.world.store, false, game);   // Transform → 下车变步兵
    } else {
      e.dead = true;   // 部件随主体消散（life=0 + active=false,无掉落）
    }
    return;
  }
  const m = mount as Enemy;
  // ---- 挂载保活（MINOR-4,NPC.cs:35857/:35874/:35884/:35960/:35974/:35989）：原版
  //      六部件锚定支首行 DiscourageDespawn(60)=timeLeft 抬底 ≥60+清鼓励旗,锚主存活
  //      期间每 tick 重钉;锚主亡故（mountOk 假）不再调用 → 部件随消散系统退场。
  //      覆盖本函数五部件 390→391/416→415/392→395/393→395/394→395（492→491 在上方
  //      转发点单独补,见 :35989 注）;392/393/394 在 DoesntDespawnToInactivity 名单
  //      （永不倒数）=保真位,实际功能面=390/416 骑手离屏 60t 保命窗 ----
  e.discourageDespawn(60);
  // ---- 锚定跟随（:35764-35845 + 36200-36214）：零速贴主体 + 偏移 ----
  let ox = 0, oy = 0;
  // spriteDirection（:35908-35919）：394 按 ai[1] 固定侧（:35886 num1121）；392/393
  // 随主体 spriteDirection——主体(AI_076)全段从不写 → 恒默认 -1 不翻面。本仓
  // core.facing 默认 1 与原版默认 -1 不同源，直取会误翻，故 392/393 钉 -1。
  let spriteDir = -1;
  if (id === 390) { ox = 0; oy = -14; spriteDir = m.facing; }
  else if (id === 392) { ox = 0; oy = 2; }
  else if (id === 393) { ox = e.ai1 === 1 ? 60 : -60; oy = 29; }
  else if (id === 394) { ox = e.ai1 === 1 ? 49 : -49; oy = -13; spriteDir = e.ai1 === 1 ? 1 : -1; }
  else if (id === 416) { ox = -m.facing * 10; oy = -30; spriteDir = m.facing; }
  // ---- 部件旋转继承 + 锚偏移随主体旋转（cs:35813-35817/:35871-35872/:35883-35884，
  //      492 同构 :35893-35898）：vector133 ×= 主体 scale → RotatedBy(主体 rotation)，
  //      rotation = 主体 rotation。主体 rotation 恒 0 时（巡航/弹幕态）全部 no-op，
  //      仅 expert 死亡自旋态(ai0==1,cs:36644-36662 相位摆动→整周自旋)部件绕主体公转。
  //      渲染侧派发门 stR===75&&(392|393|394)（2026-08-20 旋转三件套台账遗留批）----
  e.visAngle = m.visAngle;
  {
    const mrot = m.visAngle, msc = m.vanillaScale || 1;
    const c = Math.cos(mrot), s = Math.sin(mrot);
    const rx = (ox * c - oy * s) * msc;
    const ry = (ox * s + oy * c) * msc;
    ox = rx; oy = ry;
  }
  e.vx = 0; e.vy = 0;
  e.x = m.cx - e.w / 2 + ox;
  e.y = m.cy - e.h / 2 + oy;
  e.facing = spriteDir === 1 ? 1 : -1;

  if (id === 390) {
    // ---- 骑手射击（:36216-36280）：ai[1] 冷却 60t(受击 -30),<700px+LOS 朝向对 → 438 弹 ----
    e.vx = m.vx;
    if (e.ai1 < 60) e.ai1 += 1;
    if (e.justHit) e.ai1 = -30;
    if (player && !player.dead) {
      const dx = player.cx - e.cx, dy = player.cy - e.cy;
      const canHit = losClear(game, e.x, e.y, player.x, player.y);
      if (canHit && Math.hypot(dx, dy) < 700) {
        if (e.ai1 === 60 && sign(dx) === e.facing) {
          e.ai1 = -60;
          const oxp = e.cx, oyp = e.cy - 4;
          let sx = player.cx - oxp, sy = player.cy - oyp;
          sx += rndRange(-50, 51); sy += rndRange(-50, 51);
          sx *= rndRange(80, 121) * 0.01; sy *= rndRange(80, 121) * 0.01;
          const d = Math.hypot(sx, sy);
          if (d > 0.001) { sx = (sx / d) * 7; sy = (sy / d) * 7; }
          else { sx = 0; sy = -7; }
          shootM(game, oxp, oyp, sx, sy, 30, 438);
          // NPC 侧 AI 无 PlaySound(NPC.cs:35921-35996)——但弹 438 是 aiStyle 1,
          // AI_001 出膛音链 ai[1]==0 首拍播 Item12(Projectile.cs:56221-56225)。
          // 发射位等价结算（弹先出生后补播,同 bossAI.ts 83=Item_33 先例;
          // 曾误挂 :36272 导弹段的 Item39,该音属空巢导弹,2026-08-19 终审删;
          // "原版无声"结论仅核了 NPC 侧,2026-09-03 dormant 族审计翻案补 Item_12）
          game.playSfxWav?.('Item_12', 1, oxp, oyp);
        }
      }
    }
    return;
  }
  if (id !== 392 && id !== 393 && id !== 394) return;

  // ---- 部件攻击窗（共享 saucer.ai[3] 计数,cs:36128/36171/36235）----
  const saucer = m;
  e.ai3 = saucer.ai3;
  if (id === 394) {
    // 火炮窗 [440,580)（:36124-36150）：每 20t 一发 448,朝向 ±22.5° 散布,速 8;
    // 出生 ai[1]=20 引信（:36099 NewProjectile 第 10 参）——20t 倒数后点火
    // +4 加速(8→12)+8 尘爆+锁定,30t 内 20%/t 转向玩家,180t 自毁/近身 42px 爆炸
    //（aiStyle 80 :29801-29890,Kill 爆炸 :70544-70580;life=原版默认 3600）
    if (e.ai3 >= 440 && e.ai3 < 580) {
      const n = e.ai3 - 440;
      if (n % 20 === 0) {
        const dirx = spriteDir;
        const delta = (Math.random() - 0.5) * 0.7853982;   // ±22.5° 散布（:36133-36136）
        // :36081 伤 = GetAttackDamage_ForProjectiles(50, 37)——expert 插值档
        shootM(game, e.cx + dirx * 36, e.cy + 8,
          Math.cos(delta) * 8 * dirx, Math.sin(delta) * 8 * dirx,
          getAttackDamageForProjectiles(50, 37, e.difficulty), 448, 3600, 1,
          { martianRocket: true });
        game.playSfxWav?.('Item_39', 1, e.cx, e.cy);   // :36098 火炮每发(终审补)
      }
    }
    return;
  }
  if (id === 393) {
    // 激光窗 [280,420)（:36152-36197）：窗内每 6t 一发 449 速 16;窗外只瞄准(ai[2] 角)
    const inWin = e.ai3 >= 280 && e.ai3 < 420;
    if (!inWin && player && !player.dead) {
      let dx = player.cx - e.cx, dy = player.cy - e.cy;
      if (dy < 0) dy = 0;
      const d = Math.hypot(dx, dy);
      if (d > 0.001) e.ai2 = Math.atan2(dy / d, dx / d);
      else e.ai2 = Math.PI / 2;
    }
    if (inWin) {
      const n = e.ai3 - 280;
      if (n % 6 === 0) {
        const ang = e.ai2 + (Math.random() - 0.5) * (0.7853982 / 3);
        // :36105 伤 = GetAttackDamage_ForProjectiles(35, 30)——expert 插值档
        shootM(game, e.cx, e.cy, Math.cos(ang) * 16, Math.sin(ang) * 16,
          getAttackDamageForProjectiles(35, 30, e.difficulty), 449);
        game.playSfxFiles?.(['Item_12'], 1, e.cx, e.cy);     // :36140 部件激光(392 段 Item12)
      }
    }
    return;
  }
  // ---- 392 炮体（:36199-36286）----
  // 部件全灭检测（:35791-35820）：炮塔/火炮全灭 → 普通模式飞碟 ai0=3 自毁(expert→1)
  {
    const list = slots.get(e);
    const turrets = list ? list.slice(0, 2).filter((p) => !p.dead && p.vanillaId === 393) : [];
    const cannons = list ? list.slice(2, 4).filter((p) => !p.dead && p.vanillaId === 394) : [];
    let allDead = saucer.ai0 >= 1 || saucer.ai0 < 0 ? false : true;
    if (allDead && (turrets.length > 0 || cannons.length > 0)) allDead = false;
    if (allDead && saucer.ai0 === 0) {
      // :36322 后部件全灭分支：expert → ai0=1 旋转过渡进死光;否则 ai0=3 自毁
      if (game.world.isExpert) { saucer.ai0 = 1; saucer.ai1 = 0; saucer.ai2 = 0; saucer.ai3 = 0; }
      else { saucer.ai0 = 3; saucer.ai1 = 0; saucer.ai2 = 0; saucer.ai3 = 0; }
    }
  }
  // 死光电报（:36201-36219）：巡航态 ai[3]∈[20,260) 首帧（n==0）→ Projectile 447
  if (e.ai3 >= 20 && e.ai3 < 260 && saucer.ai0 === 0) {
    if (e.ai3 - 20 === 0) {
      // 447 死光电报实体（AI_079）——束体独立类（锚定电报塔/母舰，束高逐tick重算）
      // :36701 专家死光生成音 Item12(终审补)
      game.playSfxWav?.('Item_12', 1, e.cx, e.cy);
      const ray = new MartianDeathray(e, 50);
      (game as unknown as { entities: { add(el: unknown, b: string): void } }).entities.add(ray, 'projectiles');
    }
  }
  // 空巢发射器（:36221-36279）：窗口内对已灭槽位按概率补射 450 导弹
  {
    const list = slots.get(e) ?? [];
    const t0 = list[0], t1 = list[1], c0 = list[2], c1 = list[3];
    const t0Dead = !t0 || t0.dead || t0.vanillaId !== 393;
    const t1Dead = !t1 || t1.dead || t1.vanillaId !== 393;
    const c0Dead = !c0 || c0.dead || c0.vanillaId !== 394;
    const c1Dead = !c1 || c1.dead || c1.vanillaId !== 394;
    let flag76 = false, mv4 = 1000, mv5 = 1000;
    if (saucer.ai0 === 2) { flag76 = true; mv4 = 120; mv5 = 120; }
    if (!flag76 && e.ai3 >= 280 && e.ai3 < 400) { flag76 = true; mv5 = 90; mv4 = 60; }
    if (!flag76 && e.ai3 >= 440 && e.ai3 < 580) { flag76 = true; mv5 = 60; mv4 = 90; }
    // :36168-36169 空巢导弹 450 伤 = GetAttackDamage_ForProjectiles(30, 25)——
    // expert 插值档,窗检前一次算定(四处发射共用)
    const dmg450 = getAttackDamageForProjectiles(30, 25, e.difficulty);
    if (flag76) {
      // 炮塔空巢（:36243-36258）:下方侧向抛射
      if (t0Dead && rnd(mv4) === 0) {
        // :36246-36250 速度 = (±rand3, ±1)×3 未归一(3~9.5 随机,曾归一恒 3)
        const mvx = -Math.random() * 3 * 3, mvy = 1 * 3;
        shootM(game, e.cx + rndRange(50, 70), e.cy + rndRange(30, 45), mvx, mvy, dmg450, 450, 300, 1,
          { bounce: true });  // aiStyle14 X 反跳(原版 ×-0.1,默认档 -0.5 近似)
        game.playSfxWav?.('Item_39', 1, e.cx, e.cy);   // :36254 空巢导弹每发(终审补)
      }
      if (t1Dead && rnd(mv4) === 0) {
        // :36246-36250 速度 = (±rand3, ±1)×3 未归一(3~9.5 随机,曾归一恒 3)
        const mvx = Math.random() * 3 * 3, mvy = 1 * 3;
        shootM(game, e.cx + rndRange(50, 70), e.cy + rndRange(30, 45), mvx, mvy, dmg450, 450, 300, 1,
          { bounce: true });  // aiStyle14 X 反跳(原版 ×-0.1,默认档 -0.5 近似)
        game.playSfxWav?.('Item_39', 1, e.cx, e.cy);   // :36254 空巢导弹每发(终审补)
      }
      // 火炮空巢（:36261-36276）:上方侧向抛射
      if (c0Dead && rnd(mv5) === 0) {
        // :36246-36250 速度 = (±rand3, ±1)×3 未归一(3~9.5 随机,曾归一恒 3)
        const mvx = -Math.random() * 3 * 3, mvy = -1 * 3;
        shootM(game, e.cx + rndRange(30, 60), e.cy + rndRange(-30, -10), mvx, mvy, dmg450, 450, 300, 1,
          { bounce: true });  // aiStyle14 X 反跳(原版 ×-0.1,默认档 -0.5 近似)
        game.playSfxWav?.('Item_39', 1, e.cx, e.cy);   // :36254 空巢导弹每发(终审补)
      }
      if (c1Dead && rnd(mv5) === 0) {
        // :36246-36250 速度 = (±rand3, ±1)×3 未归一(3~9.5 随机,曾归一恒 3)
        const mvx = Math.random() * 3 * 3, mvy = -1 * 3;
        shootM(game, e.cx + rndRange(30, 60), e.cy + rndRange(-30, -10), mvx, mvy, dmg450, 450, 300, 1,
          { bounce: true });  // aiStyle14 X 反跳(原版 ×-0.1,默认档 -0.5 近似)
        game.playSfxWav?.('Item_39', 1, e.cx, e.cy);   // :36254 空巢导弹每发(终审补)
      }
    }
  }
  // ---- FindFrame case 392 counter 副本（cs:72543-72560，393/394 已在上方各自
  //      return，函数尾仅 392 到达）：4 帧旋球 counter 每 tick +1、死光电报窗
  //      ai[3]∈[20,260) 内 ×2、12 回卷（Renderer 读 e.lai0 → 帧 = counter/3）----
  e.lai0 += e.ai3 >= 20 && e.ai3 < 260 ? 2 : 1;
  if (e.lai0 >= 12) e.lai0 = 0;
}

// ---------------------------------------------------------------------------
// AI_074 火星无人机 388 + 日耀 Corite 418（NPC.cs:35452-35744,参数表 :35477-35509）
// ai[0] 0=悬浮瞄准(LOS+俯角+距离带 → 锁方向) / 1=蓄力(×0.95,30t) / 2=扑咬(steer 追击) /
//        3=自爆(388 专属:64px 贴身或撞块;3t 后炸) / 4=418 扑后恢复
// ---------------------------------------------------------------------------
export function martianDroneAI(e: Enemy, game: GameHooks, player: Player | null) {
  const corite = e.vanillaId === 418;
  if (!e.bInit) { e.bInit = true; e.ai0 = 0; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0; }
  // 参数表（:35477-35509）：388 / 418
  const kbMult = corite ? 0.3 : 0.4;
  const spd = corite ? 8 : 10;
  const hover = corite ? 175 : 200;
  const near = corite ? 175 : 0;
  const far = corite ? 600 : 750;
  const minNear = corite ? 80 : 0;
  const accel = corite ? 60 : 30;
  const windup = corite ? 20 : 30;
  const decay = corite ? 0.75 : 0.95;
  const jitter = corite ? 0 : 50;
  const dashSpd = corite ? 9 : 14;
  const steerN = corite ? 60 : 20;
  const steerAcc = corite ? (4 / 15) * 60 : 0;
  const minSpd = 7;
  const canExplode = !corite;   // flag68（:35491）

  // 418 火尘拖尾（:35592-35610，位于态机之前每 tick 跑）：双掷、掷数 = 态2(冲刺) ? 2 : 1
  //  → 概率 2/3 或 1/3；锚盒 = 态2 ? ±30 : ±20；尘 6 noGravity α90 scale1.5、
  //  初速 = velocity×0.5 后 ×0.2、fadeIn=1。
  if (corite) {
    const rolls = e.ai0 === 2 ? 2 : 1;
    const box = e.ai0 === 2 ? 30 : 20;
    for (let k = 0; k < 4; k++) {
      if (Math.random() * 3 >= rolls) continue;
      const d = game.spawnDust?.(e.cx - box, e.cy - box, box * 2, box * 2, 6,
        e.vx * 0.5, e.vy * 0.5, 90, null, 1.5, true);
      if (d) { d.vx *= 0.2; d.vy *= 0.2; d.fadeIn = 1; }
    }
  }

  // 朝向（:35454-35469）——原版 spriteDirection 于拖尾①(:35605)之前按【本拍】速度
  //  求值（:35463-35469）;★BJ251 上移到拖尾①前（原置其后,拖尾镜像面会吃到上一拍
  //  朝向;函数内无其他 facing 读点,终值不变）
  if (sign(e.vx) !== 0) e.facing = corite ? sign(e.vx) : -sign(e.vx);

  // ★BJ244（2026-09-21）388 无人机蓝尘拖尾双面 1:1：
  //  ① :35605-35619 —— ai[0]!=3 每 tick 1× 尘 226（蓝火花）：本体盒、α100、
  //     scale0.5、noGravity，velocity 整体覆写为 velocity/5；位【非】盒内抖动——
  //     spinningpoint2=(-10,10)（模长≈14px 环绕偏移）、spriteDirection==1 翻 X
  //     （:35611-35615）、RotatedBy(rotation)（:35616）、position=Center+spin2
  //     （:35617;★BJ251 补位覆写面——旧注"盒抖动位保留"对原版建模错误）;
  //     rotation = 速度角钳 [-π/2,π/2]（:35456-35462,拖尾前已赋值）。
  //  ② :35715-35724 —— Next(4)==0 再 1× 尘 226：noGravity，velocity×2 后覆写为
  //     velocity/2 + normalize(尘位−本体中心)（= 抖速 + 向外漂移向量，三段赋值
  //     等价合并;②位仍是盒内抖动,原版不覆写）。两面均在态机前后原序执行
  //     （①在态机前、②在蓄力支尾）。
  //  （BJ244 普查定谳：此前 388 拖尾双面整缺——仅 418 拖尾已接。）
  if (!corite && e.ai0 !== 3) {
    const d = game.spawnDust?.(e.x, e.y, e.w, e.h, 226,
      0, 0, 100, null, 0.5, true);
    if (d) {
      d.vx = e.vx / 5; d.vy = e.vy / 5;
      // 位覆写（:35611-35617）：(-10,10) → spriteDirection==1 翻 X → RotatedBy(rotation)
      let rot = Math.atan2(e.vy, e.vx);              // velocity.ToRotation()（:35456）
      if (rot < -Math.PI / 2) rot += Math.PI;        // :35457-35462 钳 [-π/2,π/2]
      if (rot > Math.PI / 2) rot -= Math.PI;
      const sxp = e.facing === 1 ? 10 : -10;         // spin2.X（spriteDirection==1 → ×-1）
      d.x = e.cx + sxp * Math.cos(rot) - 10 * Math.sin(rot);   // RotatedBy 同习语(bossAI.ts mechQueenAnchor)
      d.y = e.cy + sxp * Math.sin(rot) + 10 * Math.cos(rot);
    }
  }

  if (e.ai0 === 0 && player && !player.dead) {
    // ---- 悬浮瞄准（:35540-35610）----
    e.def.knockbackResist = kbMult;    // GetKnockbackMultiplier_ScaledByDifficulty
    const dx0 = player.cx - e.cx, dy0 = player.cy - e.cy;
    const dist = Math.hypot(dx0, dy0);
    // 悬停航向（:35546-35552）：直连向量 - 上方 hover - 侧移 near,归一 × spd
    const hx = dx0 + (dx0 < 0 ? near : -near), hy = dy0 - hover;
    const hd = Math.hypot(hx, hy) || 1;
    const vxT = (hx / hd) * spd, vyT = (hy / hd) * spd;
    let canHit = losClear(game, e.cx, e.cy, player.cx, player.cy);
    if (e.ai3 >= 120) canHit = true;                     // :35556-35558
    const aimAng = Math.atan2(dy0, dx0);
    const angleOk = aimAng > Math.PI / 8 && aimAng < Math.PI - Math.PI / 8;
    const tooNear = dist < minNear, tooFar = dist > far;
    if (tooNear || tooFar || !canHit || !angleOk) {
      // 悬停逼近（:35564-35583）
      e.vx = (e.vx * (accel - 1) + vxT) / accel;
      e.vy = (e.vy * (accel - 1) + vyT) / accel;
      if (!canHit) {
        if (!tooNear && !tooFar) e.ai3 += 1;
      } else e.ai3 = 0;
    } else {
      // 锁定扑咬方向（:35585-35591）
      e.ai0 = 1; e.ai1 = 0;
      e.ai2 = (dx0 / (dist || 1)) * spd;
      e.ai3 = (dy0 / (dist || 1)) * spd;
    }
  } else if (e.ai0 === 1) {
    // ---- 蓄力（:35592-35617）----
    e.def.knockbackResist = 0;
    let keep = true;
    if (corite) {
      keep = Math.hypot(e.vx, e.vy) > 2;
      if (!keep && player && !player.dead) {
        const d = Math.hypot(player.cx - e.cx, player.cy - e.cy) || 1;
        e.vx = lerp(e.vx, ((player.cx - e.cx) / d) * 0.1, 0.25);
        e.vy = lerp(e.vy, ((player.cy - e.cy) / d) * 0.1, 0.25);
      }
    }
    if (keep) { e.vx *= decay; e.vy *= decay; }
    e.ai1 += 1;
    if (e.ai1 >= windup) {
      e.ai0 = 2; e.ai1 = 0;
      let dx = e.ai2 + rndRange(-jitter, jitter + 1) * 0.04;
      let dy = e.ai3 + rndRange(-jitter, jitter + 1) * 0.04;
      const d = Math.hypot(dx, dy);
      dx = (dx / (d || 1)) * dashSpd; dy = (dy / (d || 1)) * dashSpd;
      e.vx = dx; e.vy = dy;
    }
    // BJ244 388 拖尾②（:35716-35723，原版位于 ai[0]==1 蓄力支尾、风闸后仍本拍执行）：
    //   Next(4)==0 → 1× 尘 226（本体盒、α100、scale0.5、noGravity）；velocity ×2 后
    //   覆写为 /2 + normalize(尘位−中心) —— NewDust 抖速 + 向外漂移单位向量。
    if (!corite && Math.floor(Math.random() * 4) === 0) {
      const d = game.spawnDust?.(e.x, e.y, e.w, e.h, 226, 0, 0, 100, null, 0.5, true);
      if (d) {
        d.vx *= 2; d.vy *= 2;
        const ox = d.x - e.cx, oy = d.y - e.cy;
        const od = Math.hypot(ox, oy) || 1;
        d.vx = d.vx / 2 + ox / od;
        d.vy = d.vy / 2 + oy / od;
      }
    }
  } else if (e.ai0 === 2) {
    // ---- 扑咬（:35618-35659）----
    e.def.knockbackResist = 0;
    e.ai1 += 1;
    const farBelow = player && !player.dead
      && Math.hypot(player.cx - e.cx, player.cy - e.cy) > (corite ? 150 : 100)
      && e.cy > player.cy;
    if ((e.ai1 >= 30 && farBelow) || Math.hypot(e.vx, e.vy) < minSpd) {
      e.ai0 = corite ? 4 : 0; e.ai1 = corite ? 45 : 0;
      e.ai2 = 0; e.ai3 = 0;
      e.vx /= 2; e.vy /= 2;
    } else if (player) {
      const d = Math.hypot(player.cx - e.cx, player.cy - e.cy) || 1;
      const ux = (player.cx - e.cx) / d, uy = (player.cy - e.cy) / d;
      const spdNow = Math.hypot(e.vx, e.vy);
      e.vx = (e.vx * (steerN - 1) + ux * (spdNow + steerAcc)) / steerN;
      e.vy = (e.vy * (steerN - 1) + uy * (spdNow + steerAcc)) / steerN;
    }
    // 撞块自爆（:35650-35656,仅 388）
    if (canExplode) {
      const st = game.world.store;
      const x0 = Math.floor(e.x / TILE), x1 = Math.floor((e.x + e.w - 0.01) / TILE);
      const y0 = Math.floor(e.y / TILE), y1 = Math.floor((e.y + e.h - 0.01) / TILE);
      outer: for (let tx = x0; tx <= x1; tx++) {
        for (let ty = y0; ty <= y1; ty++) {
          if (tx >= 0 && ty >= 0 && tx < st.w && ty < st.h && st.isSolid(tx, ty)) {
            e.ai0 = 3; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0;
            break outer;
          }
        }
      }
    }
  } else if (e.ai0 === 4) {
    // ---- 418 扑后恢复（:35660-35668）----
    e.ai1 -= 3;
    if (e.ai1 <= 0) { e.ai0 = 0; e.ai1 = 0; }
    e.vx *= 0.95; e.vy *= 0.95;
  }
  // 贴身自爆（:35670-35678,仅 388:64px 内）
  if (canExplode && e.ai0 !== 3 && player && !player.dead
    && Math.hypot(player.cx - e.cx, player.cy - e.cy) < 64) {
    e.ai0 = 3; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0;
  }
  if (e.ai0 === 3) {
    // ---- 自爆演出（:35680-35735）：原地膨胀 192×192,3t 后爆炸消散 ----
    const cx = e.cx, cy = e.cy;
    e.x = cx - 96; e.y = cy - 96;
    e.w = 192; e.h = 192;
    e.vx = 0; e.vy = 0;
    e.def.damage = 80;                 // GetAttackDamage_ScaledByDifficulty(80)
    e.spawnAlpha = 255;
    e.lightRGB = [0.2, 0.7, 1.1];
    game.spawnParticles(cx, cy, '#6FD7FF', 6, 2.4, { life: 30 });
    e.ai1 += 1;
    if (e.ai1 >= 3) {
      game.playSfx('explosion', 1, cx, cy);   // SoundID.Item14
      e.iframes = 0;
      e.hp = 0;
      e.hurt(9999, 0, 0, game);
    }
    return;
  }
  // aiStyle 74 常态无 AddLight（:35452-35580 全块无点光——曾挂 [0.1,0.4,0.6] 造假常光）
  fly(e);
}

// ---------------------------------------------------------------------------
// AI_073 特斯拉炮塔 387（NPC.cs:35340-35451）
// ai[1] <120 = 部署（60-120t 渐显,alpha 255→0,部署期无敌）;ai[0] 电击计时:
//   <60 递增,受击 -30;==60 → 放电 435(伤 35,速 14,±100px 抖动) 并置 -120 → 180t 循环
// ---------------------------------------------------------------------------
export function teslaTurretAI(e: Enemy, game: GameHooks, player: Player | null) {
  if (!e.bInit) { e.bInit = true; e.ai0 = 0; e.ai1 = 0; }   // 原版 ai[0] 自 0 起 → 首射 60t
  if (player && !player.dead) e.facing = player.cx >= e.cx ? 1 : -1;
  // 地面摩擦（:35343-35349）
  e.vx *= 0.93;
  if (e.vx > -0.1 && e.vx < 0.1) e.vx = 0;

  if (e.ai1 < 120) {
    // ---- 部署（:35353-35401）：渐显 + 部署期无敌 + 环绕尘 ----
    e.ai1 += 1;
    e.spawnAlpha = e.ai1 > 60 ? Math.round((1 - (e.ai1 - 60) / 60) * 255) : 255;
    e.iframes = 2;                       // dontTakeDamage = true
    // ★BJ244（2026-09-21）部署环绕尘 1:1（:35416-35496）：num1085=ai[1]/60，
    //  spinningpoint=(0,-30) 旋 num1085×1.5×2π 后 ×(1,0.4)；k=0..3 四档
    //  vector125=UnitY×(-15/-5/5/20)、num1087=0.15/0.3/0.6/0.45——每档两粒
    //  （spinningpoint 先用后 ×-1 镜像）= 8 粒/tick；尘 226 scale0.5 α100、
    //  noGravity、velocity=0、position=Center+spinningpoint×num1087+vector125
    //  （旧实现 ai1%6 掷 1 粒近似=密度差 48 倍,用户普查刀 BJ244 升 1:1）。
    //  完美通道（perfect）取 position/velocity 精确覆写语义——原文本也是
    //  NewDust 后整字段赋值 position/velocity,盒抖动被覆写消解。
    {
      const n1085 = e.ai1 / 60;
      const a = n1085 * 1.5 * Math.PI * 2;
      // rot((0,-30),a)=(30sin a,-30cos a)，×(1,0.4)=(30sin a,-12cos a)；
      // spinningpoint 不随 k 复位——每档第一粒用当值、随后 ×-1 且取反跨档持续
      // （四档八粒的自旋序列 = [+,-,-,+,+,-,-,+]）
      let spX = 30 * Math.sin(a), spY = -12 * Math.cos(a);
      const V125Y = [-15, -5, 5, 20];
      const N1087 = [0.15, 0.3, 0.6, 0.45];
      for (let k = 0; k < 4; k++) {
        const d = game.spawnDust?.(e.cx + spX * N1087[k], e.cy + spY * N1087[k] + V125Y[k],
          0, 0, 226, 0, 0, 100, null, 0.5, true, true);
        void d;
        spX = -spX; spY = -spY;          // spinningpoint *= -1f（用后镜像）
        const d2 = game.spawnDust?.(e.cx + spX * N1087[k], e.cy + spY * N1087[k] + V125Y[k],
          0, 0, 226, 0, 0, 100, null, 0.5, true, true);
        void d2;
      }
    }
    e.lightRGB = [0.1 * (e.ai1 / 60), 0.5 * (e.ai1 / 60), 0.7 * (e.ai1 / 60)];
    e.lightRGBAt = { x: e.cx, y: e.cy - 10 };   // :35404 光源 = Center.Y−10
    e.vy = Math.min(e.vy + ENEMY_GRAVITY, MAX_FALL_SPEED);
    moveAndCollide(e, game.world, e.vx, e.vy);
    return;
  }
  if (e.ai1 === 120) e.ai1 += 1;         // :35403-35406 单帧过门
  e.lightRGB = [0.1, 0.5, 0.7];
  e.lightRGBAt = { x: e.cx, y: e.cy - 10 };   // :35411 光源 = Center.Y−10

  // ---- 电击循环（:35409-35450）----
  // 1457 :35504-35506 计数归零门加 flag75 = AI_GlobalFiringDistanceCheck——
  // 超视野时计数到 0 即回卷 -120（永不蓄满 = 不开火）
  const flag75 = !!player && !player.dead
    && aiGlobalFiringDistanceCheck(e.cx, e.cy, player.cx, player.cy);
  if (e.ai0 === 0 && !flag75) e.ai0 = -120;
  if (e.ai0 < 60) e.ai0 += 1;
  if (e.justHit) e.ai0 = -30;            // 受击打断充电
  if (e.ai0 === 60 && player && !player.dead) {
    e.ai0 = -120;
    const ox = e.cx, oy = e.cy - 10;
    let dx = player.cx - ox, dy = player.cy - oy;
    dx += rndRange(-100, 101); dy += rndRange(-100, 101);
    dx *= rndRange(70, 131) * 0.01; dy *= rndRange(70, 131) * 0.01;
    const d = Math.hypot(dx, dy);
    if (d > 0.001) { dx = (dx / d) * 14; dy = (dy / d) * 14; }
    else { dx = 0; dy = -14; }
    // :35442-35448 伤 = GetAttackDamage_ForProjectiles(35, 35×0.8)——type 387 ∈
    // [381,392] → num1090=0.8 → expert 档 28
    shootM(game, ox, oy, dx, dy, getAttackDamageForProjectiles(35, 28, e.difficulty), 435);
  }
  e.vy = Math.min(e.vy + ENEMY_GRAVITY, MAX_FALL_SPEED);
  moveAndCollide(e, game.world, e.vx, e.vy);
}

// ---------------------------------------------------------------------------
// AI_072 泡泡盾 384（NPC.cs:35318-35339）：零速钉在军官 383 中心;军官消亡 → 消散
// ---------------------------------------------------------------------------
export function bubbleShieldAI(e: Enemy, game: GameHooks, _player: Player | null) {
  void game; void _player;
  const owner = e.master;
  if (owner && !owner.dead && owner.vanillaId === 383) {
    e.vx = 0; e.vy = 0;
    e.x = owner.cx - e.w / 2;
    e.y = owner.cy - e.h / 2;
    e.lightRGB = [0.1, 0.5, 0.7];
  } else {
    e.dead = true;   // life=0 + active=false（无掉落）
  }
}

// ---------------------------------------------------------------------------
// AI_049 愤怒云 250（NPC.cs:31742-31810,普查同批顺带）
// 悬顶 200px 伺服（accel 0.25,过零双倍）;正下方+LOS → ai[0] 累计,>8 淋一发雨 264
// ---------------------------------------------------------------------------
export function angryNimbusAI(e: Enemy, game: GameHooks, player: Player | null) {
  if (!e.bInit) { e.bInit = true; e.ai0 = 0; }
  if (!player || player.dead) {
    e.vx *= 0.95; e.vy *= 0.95;
    moveAndCollide(e, game.world, e.vx, e.vy);
    return;
  }
  const ACC = 0.25;
  let tx = player.cx - e.cx, ty = player.cy - 200 - e.cy;
  const d = Math.hypot(tx, ty);
  if (d < 20) { tx = e.vx; ty = e.vy; }
  else { const s = 4 / d; tx *= s; ty *= s; }
  // 分轴伺服（:31758-31789,过零方向翻转时双倍加速）
  if (e.vx < tx) { e.vx += ACC; if (e.vx < 0 && tx > 0) e.vx += ACC * 2; }
  else if (e.vx > tx) { e.vx -= ACC; if (e.vx > 0 && tx < 0) e.vx -= ACC * 2; }
  if (e.vy < ty) { e.vy += ACC; if (e.vy < 0 && ty > 0) e.vy += ACC * 2; }
  else if (e.vy > ty) { e.vy -= ACC; if (e.vy > 0 && ty < 0) e.vy -= ACC * 2; }
  // 淋雨（:31791-31808）：水平重叠 + 云底在玩家上方 + LOS → 8t 一发
  if (e.x + e.w > player.x && e.x < player.x + player.w
    && e.y + e.h < player.y
    && losClear(game, e.x, e.y, player.x, player.y)) {
    e.ai0 += 1;
    if (e.ai0 > 8) {
      e.ai0 = 0;
      const ox = e.x + 10 + Math.random() * (e.w - 20);
      shootM(game, ox, e.y + e.h + 4, 0, 5, 20, 264);
    }
  }
  moveAndCollide(e, game.world, e.vx, e.vy);
}

// ---------------------------------------------------------------------------
// AI_003 火星尾段：军官 383（cs:56614-56645）/ 工程师 386（cs:59384-59428）
// 由分发表 case 3 在 fighterAI 之后调用（原版为 AI_003 内 type 尾段）
// ---------------------------------------------------------------------------
export function martianFighterExtras(e: Enemy, game: GameHooks, player: Player | null) {
  void player;
  const id = e.vanillaId;
  const enemies = game.enemies() as Enemy[];
  if (id === 383) {
    // ---- 军官：出生带盾,盾在 → 无敌;盾灭 180t 后补盾（:56614-56645）----
    const l0 = la(e);
    let shield = officerShield.get(e);
    const shieldOk = !!shield && !shield.dead && shield.vanillaId === 384;
    if (e.ai2 === 0 && l0[0] === 0 && !shieldOk) {
      const s = spawnPart(game, e, 384);
      if (s) {
        shield = s;
        officerShield.set(e, shield);
        shield.master = e;          // 原版盾 ai[0] = 军官 index（:56621）
        e.ai2 = 1;                  // 原版 ai[2] = 盾 index+1（>0 标记）
        l0[0] = -1;
      }
    }
    if (shieldOk) {
      e.iframes = 2;                // dontTakeDamage = true（:56629）
    } else {
      e.ai2 = 0;
      if (l0[0] === -1) l0[0] = 180;
      if (l0[0] > 0) l0[0] -= 1;
    }
    return;
  }
  if (id === 386) {
    // ---- FindFrame case 386 副本（cs:72369-72402，Renderer 直读 customFrameIdx）：
    //      ai[2]>0 放塔期 → 帧 9+(ai2/12)%2；地面行走带 2-8 counter += |vx|*2
    //      （无 +1）、>6 进帧（增量 >1 越限溢出随回卷丢弃 → 须步进副本）；
    //      站定=帧0（counter 保留）；腾空=帧1 且清 counter（e.lai0=counter/e.lai1=行）。
    //      置于块首保证 confused/放塔 return 路径也逐 tick 推进；ai2 取自增前值
    //      （9/10 带翻转边界差 1t，登记）----
    if (e.ai2 > 0) {
      e.customFrameIdx = 9 + (Math.floor(e.ai2 / 12) % 2);
    } else if (e.vy !== 0) {
      e.lai0 = 0;
      e.lai1 = 1;
      e.customFrameIdx = 1;
    } else {
      if (e.lai1 < 2) e.lai1 = 2;
      e.lai0 += Math.abs(e.vx) * 2;
      if (e.lai0 > 6) { e.lai0 = 0; e.lai1 += 1; }
      if (e.lai1 >= 9) e.lai1 = 2;
      if (e.vx === 0) e.lai1 = 0;
      e.customFrameIdx = e.lai1;
    }
    // ---- 工程师：放炮塔（:59384-59428）----
    if (e.confusedT > 0) { e.ai2 = -60; return; }
    if (e.ai2 < 60) e.ai2 += 1;
    const nT = enemies.filter((n) => !n.dead && n.vanillaId === 387).length;
    const nE = enemies.filter((n) => !n.dead && n.vanillaId === 386).length;
    if (e.ai2 > 0 && nT >= 4 * nE) e.ai2 = 0;      // 场上 387 ≥ 4×386（:59393-59396）
    if (e.justHit) e.ai2 = -30;                    // :59397-59400
    if (e.ai2 === 30) {
      // ±5t 随机扫位（:59402-59424）：非中心 2t 禁区 + 实心面 + 上方 4t 净空 + 无岩浆
      const st = game.world.store;
      const cx0 = Math.floor(e.cx / TILE), cy0 = Math.floor(e.y / TILE);
      for (let tries = 0; tries < 100; tries++) {
        const tx = rndRange(cx0 - 5, cx0 + 5);
        const tyTop = rndRange(cy0 - 5, cy0 + 5);
        for (let ty = tyTop; ty < cy0 + 5; ty++) {
          const inCore = Math.abs(ty - cy0) <= 2 && Math.abs(tx - cx0) <= 2;
          const inSpawn = Math.abs(ty - cy0) <= 0 && Math.abs(tx - cx0) <= 0;
          if (inCore || inSpawn) continue;
          if (tx < 1 || ty < 1 || tx >= st.w - 1 || ty >= st.h - 1) continue;
          if (!st.isSolid(tx, ty)) continue;
          if (st.liquid[st.idx(tx, ty - 1)] === 2) continue;   // 上面一格岩浆
          let clear = true;
          for (let k = 1; k <= 4; k++) if (st.isSolid(tx, ty - k)) { clear = false; break; }
          if (!clear) continue;
          const turret = spawnPart(game, e, 387);
          if (turret) {
            turret.x = tx * TILE + 8 - turret.w / 2;
            turret.y = ty * TILE - turret.h;   // 底边贴实心面顶（:59425-59426）
          }
          return;
        }
      }
    }
    if (e.ai2 === 60) e.ai2 = -120;                 // :59427-59429
  }
}

// ---------------------------------------------------------------------------
// 火星死光电报 447（Projectile.cs AI_079 :29714-29798 1:1）：垂直向下光束，
// 锚定母舰 UFO（ai[0]=npcIdx+1），束高 = 母舰 Y+46 到最近实心格（≤150 格），
// 每 tick 重算；母舰不在/电报窗关（395 ai[3]%120 窗）即 Kill。尘 228×2/t。
// ---------------------------------------------------------------------------
import { Entity } from './Entity';
import { projectileWetSection } from './projWetSection';
import { projectileData } from '../data/vanillaProjectiles';

export class MartianDeathray extends Entity {
  w = 30; h = 30;
  x = 0; y = 0; vx = 0; vy = 0;
  dead = false;
  private srcId: number;
  private dmg: number;
  private age = 0;

  // ---- ★通用湿段（Projectile.cs:16903-17113,projWetSection.ts 共享体 1:1）----
  //  豁免核对：447 SaucerDeathray SetDefaults P.cs:5190-5200（30×30/aiStyle 79/
  //  hostile/penetrate −1/tileCollide=false/ignoreWater=true【:5198】/timeLeft 240）
  //  → 豁免 id,段门恒闭（:16903）= 原版零行为（字段照加、段照调,豁免分流由
  //  ignoreWater 参数自动承载;projId 传字面 447——本类无 projId 字段,防
  //  Game.ts:3042 快照通判抢 kind1,同 DukeSharknadoBolt 注）。阻尼不适用（双证）：
  //  ①豁免;②AI 每 tick 重算锚定束盒（母舰 Y+46 → 束脚）,无 velocity 位移宿主。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价） */
  presetDone = false;
  // ★⑥杀拍口径核查（2026-09-06 湿段配方推广批,清白注不落刀）：本类杀位（锚失联/
  //  电报窗关/寿限 :996/:999/:1000）全在湿段调用位(:992)【之后】→ 湿段已先跑=
  //  原版同相位（Kill 位在 AI 域,湿段其后）;且 447 ignoreWater=true(:5198) →
  //  段门恒闭零行为,杀拍湿段缺口双清白。file 内 moveAndCollide/dutchmanCannonAI
  //  为 NPC 侧物理助手,非湿段弹宿主,不涉。

  constructor(src: Enemy, dmg: number) {
    super();
    this.srcId = src.id;
    this.dmg = dmg;
    this.x = src.cx - 15; this.y = src.cy + 46;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.dead) return;
    // ★通用湿段（:16903-17113）——447 豁免 id（P.cs:5198 ignoreWater=true）→ 段门
    //  恒闭零行为;插 tick 头与 AI/位移序无观察差（段内唯一可见面=溅花,豁免即恒无）
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      447, !!projectileData(447)?.ignoreWater);
    const src = (game.enemies() as Enemy[]).find((n) => n.id === this.srcId);
    // :29718-29722 门：锚不在场（或非 392/395 电报者/窗口关）→ Kill
    if (!src || src.dead || (src.vanillaId !== 392 && src.vanillaId !== 395)) {
      this.dead = true; return;
    }
    if (src.vanillaId === 395 && !(src.ai3 % 120 >= 60 && src.ai0 === 2)) { this.dead = true; return; }
    if (++this.age > 240) { this.dead = true; return; }
    // :29726-29758 束高：y = 锚 cy+46，向下扫 ≤150 格找首个实心格。
    // 束底 num652 = 目标玩家盒底（:29733-29740）：目标 = 锚 395 的索敌目标
    // （M11 链 anchor.targetRef；392 电报走母舰槽 target——本仓 392.master=母舰）。
    // 目标亡/缺 → 束底回落锚 Y+46（endY=startY；原版此处无 Kill 门——旧"玩家亡
    // 即杀"系已登记简化，随本索敌批一并退役，240t 寿限仍兜底）
    const st = game.world.store;
    const colX = Math.floor(src.cx / 16);
    const startY = Math.floor((src.cy + 46) / 16);
    const anchor = src.vanillaId === 392 && src.master && !src.master.dead ? src.master : src;
    const tp: Player | null = anchor.targetRef?.(game) ?? game.player;
    const endY = tp && !tp.dead ? Math.floor(tp.y + tp.h) : startY;   // num652 = 目标盒底
    let span = 0;
    if (startY >= endY && st.isSolid(colX, startY)) {
      span = 1;
    } else {
      for (; span < 150 && startY + span < st.h; span++) {
        const row = startY + span;
        if (row >= endY && st.isSolid(colX, row)) { span--; break; }
      }
    }
    this.x = src.cx - this.w / 2;
    this.y = src.cy + 46;
    this.h = (span + 1) * 16;
    // 尘 228×2（:29770-29778，束脚）
    if (this.age % 2 === 0) {
      game.spawnParticles(this.cx, this.y + this.h - 16, '#B048E0', 1, 2.8,
        { life: 18, grav: 0, size: 3 });
    }
    // 接触伤害（hostile 447 伤害链简化为玩家盒重叠每 6t 一跳）
    // ★victim-settles：恒查本地玩家（damagePlayer 只结算本地血）——与上方束底的
    // 索敌目标分离（Projectile.Damage :12330 逐玩家结算的本地半边）
    const p = game.player;
    if (this.age % 6 === 0 && p && !p.dead
      && p.x < this.x + this.w && p.x + p.w > this.x
      && p.y < this.y + this.h && p.y + p.h > this.y) {
      // ★第 4 参是 attacker(Enemy) 非 kx——曾按过时签名传 Math.sign(...)（±1 truthy
      //  数字）→ damagePlayer 内 attacker.def.name 读 Number.prototype.def=undefined
      //  崩帧停机（2026-08-21 火星飞碟光柱战报障）。击退方向由 damagePlayer 内部
      //  按 srcX/srcY 自算,此处无需传。
      // ★伤害过 Damage_EVP 链（Projectile.cs:13770-13781，与 projTargets.hitPlayer/
      //  Dart 同式）：难度乘区（旅程0.5/经典1/专家2/大师3）× 通用敌弹 ×2——
      //  生成侧 50/80 是基础值（:36148 GetAttackDamage_ForProjectiles(50,50)/
      //  :36666 num1195=80），曾裸传=经典半伤/专家四分之一伤
      game.damagePlayer(
        hostileProjectileDamage(this.dmg, mainDifficulty(game.world)) * 2,
        this.cx, this.cy, undefined, undefined, undefined, undefined, { projDomain: true, projVid: 447 });   // ★R-B-F10(第4=knockback 位,opts 第5)
    }
  }

  draw(r: import('../render/Renderer').Renderer): void {
    const ctx = r.ctx;
    if (!ctx) return;
    // 光柱近似（Projectile_447.png 30×4 帧条——竖束以原色半透明柱呈现）
    ctx.save();
    ctx.globalAlpha = 0.75;
    const grd = ctx.createLinearGradient(this.x, 0, this.x + this.w, 0);
    grd.addColorStop(0, 'rgba(196,84,255,0)');
    grd.addColorStop(0.5, 'rgba(230,160,255,0.9)');
    grd.addColorStop(1, 'rgba(196,84,255,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(this.x, this.y, this.w, this.h);
    ctx.restore();
  }
}
