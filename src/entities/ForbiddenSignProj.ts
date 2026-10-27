// ★Forbidden 禁戒符号整引擎（组C 终盘 2026-09-18）——弹 656 "Ancient Storm"（SetDefaults
// Projectile.cs:7049-7061 + aiStyle 127 :36656-36750 + 绘制 Main.cs:33023-33088）。
// 套装侧（Player.ts setForbidden 挂点/CommandForbiddenStorm :57476-57566）与本实体
// 构成整套：双击↓（KeyDoubleTap :57434-57457）→ MinionRestTargetAim 光标落地扫描
// （:57599-57670）→ 20 魔力 + 视线/空间门 → NewProjectile(656) 于 MinionRestTargetPoint。
//
// ★定谳（亲读 1457 全树 + wiki Forbidden_armor 交叉核）：
//   · 任务假设的「双形态（远程光束 vs 法术冲击波）」不存在——656 全树仅 4 处引用
//     （SetDefaults :7050 / Damage_PVE_Inner 命中计数 :14245 / AI :36664-36702 /
//     绘制 :33023），无持械判定、无远程/法术分支。双形态假说证伪，单形态=
//     垂直沙暴柱（CanSpawnSandstormFriendly 空间门 + ExpandVertically ±15t 撑柱）。
//   · localAI[0] = PVE 命中计数（Damage_PVE_Inner :14245 每次命中 ++）——非计时器。
//     命中数 ≥30 → damage=0 停伤 + ai[0] 前跳 780+ai[0]%60（≈1s 内消亡;wiki
//     "after hitting enemies up to 30 times... disappears roughly 1 second after"）。
//     时间面：ai[0]≥900 Kill（15s 寿命;wiki "disappears after 15 seconds"）。
//   · 视线门：AI 每 tick 柱身 20 采样点对玩家 Center/Top 任一 CanHitLine
//     （:36702-36716）——断视同拍前跳死亡相位（wiki "disappears roughly 1 second
//     after this line of sight is obstructed"）。
//   · 至多同时 2 根（UpdateForbiddenSetLock :57459-57471 list.Count>1 → 冷却闩;
//     CommandForbiddenStorm flag &= list.Count<=1 — spawn 门只放行 0/1 根在场）。
//   · wiki 行为面（Forbidden_armor.md :45/:136-146,1.4.4.9 源码注）三方互证一致。
import { Entity } from './Entity';
import type { GameHooks } from './types';
import type { Renderer } from '../render/Renderer';
import type { Camera } from '../render/Camera';
import { playerCanHitEnemy, applyBannerDamageDealt, noteVanillaProjImmune, hitCrittersAll } from './projTargets';
import { solidTileAt } from '../physics/LineOfSight';
import { projSprite } from './Arrow';
import { ghostHealProc, ghostHurtOnHit, playerHasGhostHurt } from './SpectreSoulProj';   // ★BJ382 沙暴柱 656 proc 单源（★BJ424-T3 补 ghostHurt 漏斗面）
import { nebulaBoosterOnHit } from './NebulaBooster';   // ★BJ424-T3 星云套装 on-hit 单源（自持命中环面收编）
import type { TileStore } from '../world/TileStore';

const TILE = 16;

// ---- Collision.ExpandVertically 1:1（Collision.cs:4403-4447）----
// SolidTile3 → 本仓 solidTileAt（=active∧solid∧¬platform∧¬half∧¬slope∧¬inActive 单源,
// LineOfSight.ts:312 锚注同式——SolidTile3 无 inActive 门,仓加幽灵保域为既有裁决面）。
export function expandVertically(st: TileStore, startX: number, startY: number,
  maxExpandUp = 100, maxExpandDown = 100): { topY: number; bottomY: number } {
  let topY = startY;
  let bottomY = startY;
  // WorldGen.InWorld(startX, startY, 10)（:4407）——10 格内沿;越界原样返回起点
  if (startX < 10 || startY < 10 || startX >= st.w - 10 || startY >= st.h - 10) {
    return { topY, bottomY };
  }
  for (let i = 0; i < maxExpandUp; i++) {
    if (topY <= 0 || topY < 10) break;
    if (solidTileAt(st, startX, topY)) break;
    topY--;
  }
  for (let j = 0; j < maxExpandDown; j++) {
    if (bottomY >= st.h - 10) break;
    if (solidTileAt(st, startX, bottomY)) break;
    bottomY++;
  }
  return { topY, bottomY };
}

// ---- StrayMethods.CanSpawnSandstormFriendly 1:1（StrayMethods.cs:65-81）----
// x±1 三柱各 ExpandVertically(30,30)，柱净空 <10t 任一 → false
export function canSpawnSandstormFriendly(st: TileStore, x: number, y: number,
  expandUp: number, expandDown: number): boolean {
  const px = Math.floor(x / TILE);
  const py = Math.floor(y / TILE);
  for (let i = -1; i <= 1; i++) {
    const { topY, bottomY } = expandVertically(st, px + i, py, expandUp, expandDown);
    if (bottomY - 1 - (topY + 1) < 10) return false;   // topY++/bottomY-- 后差值
  }
  return true;
}

// ---- Collision.LaserScan 1:1（Collision.cs:4599-4614）----
// 采样列 = samplingPoint ⊥ directionUnit × ((i/(n-1))-0.5)×samplingWidth；
// 距离 = 命中 → |起点格-命中格| 的 f32 长度 ×16（格粒度量化!），射线端格=命中格
// → maxDistance，未命中（出界）→ 端格距离同式。HitLine 语义用 1px 步进 DDA 等价
// （命令流单发调用,10 采样 × ≤1000px 量级,非热路径）。
export function laserScan(st: TileStore, samplingPoint: { x: number; y: number },
  directionUnit: { x: number; y: number }, samplingWidth: number, maxDistance: number,
  samples: number[]): void {
  const n = samples.length;
  const perpX = -directionUnit.y;
  const perpY = directionUnit.x;                 // RotatedBy(π/2)（:4606 1.5707964）
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0;
    const sx = samplingPoint.x + perpX * (t - 0.5) * samplingWidth;
    const sy = samplingPoint.y + perpY * (t - 0.5) * samplingWidth;
    const tx0 = Math.floor(sx / TILE);
    const ty0 = Math.floor(sy / TILE);
    const ex = sx + directionUnit.x * maxDistance;
    const ey = sy + directionUnit.y * maxDistance;
    const tx1 = Math.floor(ex / TILE);
    const ty1 = Math.floor(ey / TILE);
    let colX = tx1;
    let colY = ty1;
    let hit = false;
    // 1px 步进找首个实心格（HitLine tile DDA 等价——量化格距语义下步进误差 <16px）
    const len = Math.hypot(ex - sx, ey - sy);
    const step = 1;
    for (let d = step; d <= len; d += step) {
      const cx = Math.floor((sx + directionUnit.x * d) / TILE);
      const cy = Math.floor((sy + directionUnit.y * d) / TILE);
      if (cx === tx1 && cy === ty1) break;       // 抵达端格=未撞
      if (solidTileAt(st, cx, cy)) { colX = cx; colY = cy; hit = true; break; }
    }
    if (!hit && (tx0 !== tx1 || ty0 !== ty1)) {
      samples[i] = maxDistance;                  // 端格前无阻挡 → maxDistance（:4610 首支）
      continue;
    }
    samples[i] = Math.hypot(Math.abs(tx0 - colX), Math.abs(ty0 - colY)) * TILE;
  }
}

// ---- Collision.AimingLaserScan 1:1（Collision.cs:4616-4622）----
export function aimingLaserScan(st: TileStore, startPoint: { x: number; y: number },
  endPoint: { x: number; y: number }, samplingWidth: number, samplesToTake: number):
  { vectorTowardsTarget: { x: number; y: number }; samples: number[] } {
  const samples = new Array<number>(samplesToTake).fill(0);
  const dx = endPoint.x - startPoint.x;
  const dy = endPoint.y - startPoint.y;
  const len = Math.hypot(dx, dy);
  // SafeNormalize(Vector2.Zero)（:4620）——零长向量返回零向量
  const dir = len > 0 ? { x: dx / len, y: dy / len } : { x: 0, y: 0 };
  laserScan(st, startPoint, dir, samplingWidth, len, samples);
  return { vectorTowardsTarget: { x: dx, y: dy }, samples };
}

/**
 * 弹 656 Ancient Storm（aiStyle 127 :36656-36750）。10×10 出生盒 → 每 tick 由
 * ExpandVertically 重算柱身盒（width=高×0.13,height=柱高,Center=柱心 :36685-36691）。
 */
export class ForbiddenSignProj extends Entity {
  readonly projId = 656;
  w = 10; h = 10;
  friendly = true;
  magic = true;
  tileCollide = false;
  /** SetDefaults :7056 penetrate=-1 —— 弹体无穿透消亡面（寿命/命中帽管控） */
  penetrate = -1;
  /** SetDefaults :7059 timeLeft=1200（:17308 每拍 -1——寿命由 ai[0]≥900 先到先杀） */
  private timeLeft = 1200;
  /** ai[0]：寿命相位计数（≥900 Kill;≥780 死亡相位） */
  ai0 = 0;
  /** localAI[0]：PVE 命中计数（Damage_PVE_Inner :14245 每 settled 命中 ++;≥30 停伤） */
  hitCount = 0;
  /** ★BJ382：PVE 受理命中计数（原版 Projectile.numHits——SetDefaults :706 起始 0;
   *  :14263 受理后自增 ⇒ proc（:13877-79）读自增前值,首跳 0 档率 0.20;拒收不计数。
   *  独立于 ：14245 localAI[0]（本类 hitCount 命中帽）;PVP 读口 projPveNumHits 形状 */
  pveNumHits = 0;
  /** usesLocalNPCImmunity :7057 / localNPCHitCooldown=8 :7058 → 每敌 8t 局部免疫窗 */
  private localImmune = new Map<number, number>();
  private soundPlayed = false;
  /** 本拍已重算柱盒（draw/hit 共用——AI 内 ExpandVertically 出参） */
  colTopY = 0;
  colBottomY = 0;

  constructor(x: number, y: number, public damage: number) {
    super();
    // NewProjectile 顶左语义（:57564 实参 MinionRestTargetPoint 直入 position）
    this.x = x;
    this.y = y;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    const st = game.world.store;
    // ---- 声面（aiStyle 127 soundDelay 门 :36660-36664——SoundID.Item82 一次性）----
    if (!this.soundPlayed) {
      this.soundPlayed = true;
      game.playSfxWav?.('Item_82', 1, Math.trunc(this.cx), Math.trunc(this.cy));
    }
    // ---- AI（:36666-36749）----
    this.ai0++;
    if (this.ai0 >= 900) { this.dead = true; return; }          // :36667-36669
    if (this.hitCount >= 30) {                                   // :36671-36678（localAI[0]≥30）
      this.damage = 0;
      if (this.ai0 < 780) {
        this.ai0 = 780 + (this.ai0 % 60);                        // 前跳死亡相位（保留 %60 相位）
      }
    }
    // ---- 柱身几何（:36680-36691：ExpandVertically ±15t → width/height/Center 重算）----
    const px = Math.floor(this.cx / TILE);
    const py = Math.floor(this.cy / TILE);
    const ex = expandVertically(st, px, py, 15, 15);
    this.colTopY = ex.topY + 1;                                  // topY++（:36683）
    this.colBottomY = ex.bottomY - 1;                            // bottomY--（:36683）
    const v20x = px * TILE + 8;
    const v20y = this.colTopY * TILE + 8;                        // (point.X,topY)*16+(8,8)
    const v21y = this.colBottomY * TILE + 8;
    const colH = v21y - v20y;                                    // vector154.Y
    this.h = Math.trunc(colH);
    this.w = Math.trunc(colH * 0.2 * 0.65);                      // X=Y×0.2 → width=X×0.65
    this.x = v20x - this.w / 2;                                  // Center=lerp(v20,v21,.5)
    this.y = (v20y + v21y) / 2 - this.h / 2;
    // ---- 视线门（:36702-36716 owner==Main.myPlayer 单人恒真）----
    // 柱身 20 采样点（lerp t 步进 0.05）对玩家 Center/Top 任一 CanHitLine → 可见。
    // 断视且未到死亡相位 → 同拍前跳（≈1s 后消亡）。
    {
      const p = game.player;
      const pCx = p.cx;
      const pCy = p.cy;
      const pTopY = p.y;
      let visible = false;
      for (let t = 0; t < 1; t += 0.05) {
        const sx = v20x;
        const sy = v20y + (v21y - v20y) * t;
        const px0 = Math.floor(sx);
        const py0 = Math.floor(sy);
        const solidBlocked = (tx: number, ty: number): boolean => {
          // CanHitLine 点对 0×0 盒（:36707/:36709）——线扫挡墙即断
          //（★首测红修正：solidTileAt 吃【格】坐标,线扫像素须 ÷16 入格——
          //  曾直喂像素=净读越界格恒 false=永可见）
          const steps = Math.max(1, Math.ceil(Math.hypot(tx - px0, ty - py0)));
          for (let s = 1; s <= steps; s++) {
            const gx = Math.floor((px0 + (tx - px0) * (s / steps)) / TILE);
            const gy = Math.floor((py0 + (ty - py0) * (s / steps)) / TILE);
            if (solidTileAt(st, gx, gy)) return true;
          }
          return false;
        };
        if (!solidBlocked(pCx, pCy) || !solidBlocked(pCx, pTopY)) { visible = true; break; }
      }
      if (!visible && this.ai0 < 780) {
        this.ai0 = 780 + (this.ai0 % 60);                        // :36710-36715
      }
    }
    // ---- 尘面（:36723-36749 每拍 1 粒尘 269——柱侧出粒、customData 吸向柱心下锚;
    //      死亡相位 :36723-36725 return 仅跳本块——Damage(:17184)/timeLeft--(:17308)
    //      在主 Update 照跑,死亡相位非「无更新」）----
    if (this.ai0 < 780) {
      const amount3 = Math.random();
      let v155x = 0.1 + (1 - 0.1) * Math.random();               // Lerp(0.1,1,rand)
      const v155y = -0.5 + (0.9 - -0.5) * amount3;               // Lerp(-0.5,0.9,amount3)
      v155x *= 2.2 + (0.6 - 2.2) * amount3;                      // Lerp(2.2,0.6,amount3)
      v155x *= -1;
      const v156x = 6;
      const v156y = 10;
      const v157x = this.cx + colH * 0.2 * v155x * 0.5 + v156x;  // vector154.X(=Y×0.2)×v155×0.5
      const v157y = this.cy + colH * v155y * 0.5 + v156y;        // vector154.Y×v155×0.5
      const d = game.vanillaDust?.spawn(Math.floor(v157x), Math.floor(v157y), 0, 0, 269,
        0, 0, 0, null, 0.3);
      if (d) {
        d.x = v157x;
        d.y = v157y;
        d.fadeIn = 1;
        d.scale = 0.3;
        d.attractTo = { x: this.cx + v156x, y: this.cy + v156y };  // customData=vector153+vector156
        if (v155x > -1.2) d.vx = 1 + Math.random();               // :36744-36746
        d.vy = Math.random() * -0.5 - 1;                          // :36747
      }
    }
    // ---- PVE 接触（SetDefaults friendly∧magic∧usesLocalNPCImmunity cd8 :7052-7058；
    //      Damage 在 AI 后同拍跑 :17184——柱身盒整判,局部免疫 8t/敌,命中计数驱动停伤。
    //      ★红蓝-M ②：死亡相位内照结算——damage=0 唯一来源 = :36678 localAI[0]≥30
    //      命中帽,断视/刷新前跳不清伤;曾把 :36723 死亡相位整段提前 return =
    //      断视后 ~120t（2 秒窗）提前停伤,已修）----
    this.runContactHits(game);
    // ---- timeLeft--（:17308 每 tick 一次,死亡相位亦然;656 无 extraUpdates）----
    if (--this.timeLeft <= 0) this.dead = true;
  }

  /** Damage_PVE 接触面（aiStyle 127 无专有位移/无 tileCollide → 纯重叠判定）。
   *  伤害=出生基伤（CommandForbiddenStorm :57546 算式）;暴击=owner 魔法暴击
   *  （wiki 注 4"crit based on magic crit"——Damage() magic 位吃 player.magicCrit）。 */
  private runContactHits(game: GameHooks): void {
    if (this.damage <= 0) return;                                // damage=0 停伤（30 帽后）
    const es = game.player.equipStats;
    const crit = Math.random() < (es.critMagic ?? 0) / 100;   // ★BJ175 桩面 ?? 防御（缺省 0）
    // ★X2-D3（2026-09-29）critter 面：原版 Damage() victim 循环（:12618）critter 恒在
    //  内,本仓独立桶不被扫到=柱身对小动物零受击。656 penetrate=-1（SetDefaults
    //  :7050-7060）→ 不耗穿不亡;:14245 localAI[0]++（30 命中帽）与 :14263 numHits++
    //  对 critter 受理命中同达（同一 victim 循环）→ hitCount/pveNumHits 同步入账。
    //  critter 一击即死（life=5）→ localImmune 8t 窗对 critter 无观察面（单源 dead 门
    //  天然去重）;critter lifeMax≤5 → flag10 lifeMax>5 段（:13712）恒不吸血 → 不 proc
    //  （BJ383 判例）。单源 settleCritterHit 语义=hurt 调用即受理（BJ383/384 各站同面）。
    //  桶序先小动物（BJ383 桶序登记近似,原版 Main.npc 槽序交错）;帽沿敌怪面同款于
    //  逐受理检查（critter 先入账可致本拍提前达 30=敌面 break,与原版槽序交错的
    //  概率性等价,登记）。
    const critterHits = hitCrittersAll(this, game);
    this.hitCount += critterHits;
    this.pveNumHits += critterHits;
    for (const ent of game.enemies()) {
      const e = ent as unknown as {
        id: number; x: number; y: number; w: number; h: number; dead: boolean;
        iframes?: number; dontTakeDamage?: boolean;
        hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean,
          pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean;
      };
      if (!e || e.dead) continue;
      if (!playerCanHitEnemy(ent, game, this.projId)) continue;  // friendly 门（:11892——
      //   命中校验面不含 CanBeChasedBy（索敌门专用,projTargets.ts:398 锚注）——
      //   训练假人 488 可被打（wiki 画廊"Storm on Target Dummies"同相）
      const prevImmune = this.localImmune.get(e.id) ?? 0;
      if (prevImmune > 0) continue;                              // localNPCHitCooldown=8
      if (!(this.x < e.x + e.w && this.x + this.w > e.x
        && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
      const dmg = this.damage;     // ★S02(BJ723-B):crit ×2 移 Enemy.hurt 防后(NPC.cs:82067)
      // ★BJ382：幽灵兜帽吸血 proc（Projectile.cs:13877-79 Damage() 通用 on-hit 段;
      //  656 数据面 magic ⇒ 原版 Ancient Storm 本就吸血,本仓漏接）——受理位挂接,
      //  proc 先于 :14263 numHits++（读自增前值）;拒收不 proc 不计数。
      //  ★BJ385 修正（BJ382 登记债清偿）：localImmune 写（:14181-14182
      //  usesLocalNPCImmunity 支 immuneArray[victimIndex]=localNPCHitCooldown）与
      //  hitCount++（:14245 type==656 localAI[0]++）在原版都在 StrikeNPC（:13702）
      //  之后的受理面内——拒收跳（Damage_PVE_Inner :12634-12637 immune[owner]>0 残窗/
      //  外层 :12589 dontTakeDamage 门）整跳 return,三写全不达。旧码 hurt 返假仍照写
      //  =敌怪免疫残窗内虚增 30 命中帽+8t 局部窗提前拉闸,已并入受理位
      //  （原版序 proc :13877-79 → immune 写 :14181 → localAI[0]++ :14245 →
      //  numHits++ :14263）
      // ★BJ395（2026-09-28,BJ393 同族债五处清偿③）：受理面谓词 vanillaGated——BJ385
      //   定谳「三写在受理面」无误,但受理判据误用 hurt 布尔：Enemy.hurt 返真=「本拍
      //   击杀/假人」（Enemy.ts:15033/:14184）,普通未致命命中尾档 :15037 与血尽级联
      //   :14369 族（伤害已实扣=原版受理）均返假 → 旧闸下 ghostHeal/localImmune/
      //   hitCount/numHits 四写对非致死命中整面不达（30 命中帽只由击杀驱动+656 无
      //   8t 局部窗=under-fire）。门拒可及面=iframes>0（:13972,pierce=0 不豁免;656
      //   走 usesLocalNPCImmunity 但全局窗门 :12635-12638 照适用,本环无前置检）+
      //   dontTakeDamage（:13978,环内未前置过滤;dead 已 :272 前置）→ 谓词=
      //   !vanillaGated,hurt 返值不再消费。
      const vanillaGated = (e.iframes ?? 0) > 0 || e.dontTakeDamage === true;
      // ★BJ398（2026-09-29,BJ385 登记独立决策刀）：pierce=-3 = Enemy.hurt 编码族新槽
      //  =usesLocalNPCImmunity 族写档——免疫门照走（:12636 全局窗门,flag3=false 不豁免）
      //  但命中写=【清全局窗】immune[owner]=0（梯 :14175-14178 usesLocal 主支）。旧
      //  pierce=0 走通用档写 10t：localImmune 8t 表过期后仍被全局残窗 vanillaGated 拦
      //  2 拍 → 真敌有效再命中节拍 10t vs 原版 8t。跨弹语义：局部窗 per-owner（每柱
      //  独立 Map=原版每弹 localNPCImmunity 数组）;全局窗清零=后续他弹照达（单表同相）。
      e.hurt(applyBannerDamageDealt(game, e, dmg), 0, 0, game, 0, crit, -3, true);
      if (!vanillaGated) {
        ghostHealProc(game, this.projId, this.pveNumHits, e);
        // ★BJ424-T3 魔法命中漏斗面收编：ghostHurt :13881 / nebula :13885 与 ghostHeal
        //  :13877 同块同受理面（656 数据面 magic ⇒ 凡走本面两引擎都该触发）。
        if (playerHasGhostHurt(game.player)) {
          const v424 = e as never as { vanillaId?: number | null; lastStrikeDealt?: number;
            maxHp?: number; def?: { lifeMax?: number } };
          ghostHurtOnHit(game,
            { magic: true, projDamage: this.damage,
              projX: this.x, projY: this.y, projW: this.w, projH: this.h,
              ownerCx: game.player.cx, ownerCy: game.player.cy },
            { x: e.x, y: e.y, w: e.w, h: e.h,
              cx: e.x + e.w / 2, cy: e.y + e.h / 2,
              vanillaId: v424.vanillaId,
              lifeMax: v424.maxHp ?? v424.def?.lifeMax,
              dealt: v424.lastStrikeDealt ?? 0 });
        }
        nebulaBoosterOnHit(game,
          { projId: this.projId, projDirX: this.vx },
          { x: e.x, y: e.y, w: e.w, h: e.h,
            cx: e.x + e.w / 2, cy: e.y + e.h / 2,
            vanillaId: (e as never as { vanillaId?: number | null }).vanillaId,
            lifeMax: (e as never as { maxHp?: number; def?: { lifeMax?: number } }).maxHp
              ?? (e as never as { def?: { lifeMax?: number } }).def?.lifeMax,
            dealt: (e as never as { lastStrikeDealt?: number }).lastStrikeDealt ?? 0 });
        // GC1 桥（梯位 :14175-14178=proc :13877-79 后、localAI++ :14245 前;656 面
        // vanillaProjImmuneFaces.ts:135 usesLocal → 桥算清零档写 0）——近战域 immune
        // 表同拍清零（原版单表语义;Arrow.ts:9459 同式单源桥）
        noteVanillaProjImmune(game, this.projId, e.id,
          { penetrate: this.penetrate, localFace: true });
        this.localImmune.set(e.id, 8);                           //（:14181-14182）
        this.hitCount++;                                         // localAI[0]++（:14245）
        this.pveNumHits++;                                       //（:14263 numHits++）
        if (this.hitCount >= 30) break;                          // 命中帽达成本拍即停
      }
    }
    for (const [k, v] of this.localImmune) {
      if (v <= 1) this.localImmune.delete(k);
      else this.localImmune.set(k, v - 1);
    }
  }

  /** 绘制 = Main.cs:33023-33088 1:1——60×60 沙纹贴图沿柱身自下而上 5.1px 步进堆叠,
   *  每层旋转 -π/50·ai0 + 层内旋 num326、scale 1+(层高比-0.15)、alpha 柱中峰双线性
   *  ×0.5 ×（前 30t 淡入/后 60t 淡出 num319）。num318>840 段 Lerp(1,0,...) 消散。 */
  draw(r: Renderer, _cam: Camera): void {
    void _cam;
    const ctx = r.ctx;
    if (!ctx) return;
    const img = projSprite(this.projId);
    if (!img || img.width <= 0) return;
    const num315 = 900;
    const num318 = this.ai0;
    let num319 = Math.max(0, Math.min(1, num318 / 30));
    if (num318 > num315 - 60) {
      num319 = 1 + (0 - 1) * ((num318 - (num315 - 60)) / 60);    // Lerp(1,0,...)
    }
    if (num319 <= 0) return;
    const px = Math.floor(this.cx / TILE);
    const v89x = px * TILE + 8;
    const v89y = this.colTopY * TILE + 8;
    const v90y = this.colBottomY * TILE + 8;
    const colH = v90y - v89y;
    if (colH <= 0) return;
    const num321 = -(Math.PI / 50) * num318;
    const num323 = 5.1;
    let num322 = 0;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    // Color(212,192,100) × alpha×0.5 × num319（GetAlpha 白系 → 全局 α 承载）
    for (let num324 = Math.trunc(v90y); num324 > Math.trunc(v89y); num324 -= num323) {
      num322 += num323;
      const num325 = num322 / colH;
      const num326 = (num322 * Math.PI * 2) / -20;
      const num327 = num325 - 0.15;
      let a = num325 <= 0.5 ? num325 * 2 : 2 - num325 * 2;       // Lerp(Transparent,value92,...)
      a *= 0.5;
      a *= num319;
      if (a <= 0) continue;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, a));
      ctx.translate(v89x, num324);
      ctx.rotate(num321 + num326);
      const scale = 1 + num327;
      ctx.drawImage(img as CanvasImageSource,
        -img.width / 2 * scale, -img.height / 2 * scale,
        img.width * scale, img.height * scale);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}

/** CommandForbiddenStorm 预览尘面（Player.cs:57513-57523：list.Count<=1 时
 *  沿瞄准射线每 15px 一粒尘 269（fadeIn .5/scale .7/v×.4/noLight）+ 端点
 *  center+dir·maxSample 处 2π 步进 π/15 共 30 粒同点尘（fadeIn 1/scale .3/noLight;
 *  原版环循环变量无位移消费=同点重掷）。vanillaDust.spawn 的 alpha 参=NewDust
 *  alpha 位;noLight 走 spawn 后置覆写） */
export function spawnStormPreviewDust(game: GameHooks,
  center: { x: number; y: number }, vectorTowardsTarget: { x: number; y: number },
  maxSample: number): void {
  const vx = vectorTowardsTarget.x;
  const vy = vectorTowardsTarget.y;
  const len = Math.hypot(vx, vy);
  if (len > 0) {
    const dirX = vx / len;
    const dirY = vy / len;                                     // SafeNormalize（:57518）
    for (let d = 0; d < len; d += 15) {                        // num3 < vector2.Length()
      const px = center.x + vx * (d / len);
      const py = center.y + vy * (d / len);
      const dust = game.vanillaDust?.spawn(Math.floor(px), Math.floor(py), 0, 0, 269,
        0, 0, 0, null, 0.7);
      if (dust) {
        dust.x = px;
        dust.y = py;
        dust.fadeIn = 0.5;
        dust.scale = 0.7;
        dust.vx *= 0.4;
        dust.vy *= 0.4;
        dust.noLight = true;
      }
    }
    const ex = center.x + dirX * maxSample;                    // vector = center+dir·num2（:57515）
    const ey = center.y + dirY * maxSample;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 15) {      // 环变量无位移消费（:57519-57522）
      const dust = game.vanillaDust?.spawn(Math.floor(ex), Math.floor(ey), 0, 0, 269,
        0, 0, 0, null, 0.3);
      if (dust) {
        dust.x = ex;
        dust.y = ey;
        dust.fadeIn = 1;
        dust.scale = 0.3;
        dust.noLight = true;
      }
    }
  }
}
