// 下落沙族(原版 Projectile 31/56/67/71/179/241/411-414/812 SandBallFalling 系,
// aiStyle 10 = AI_010):
// 沙族图块失去下方支撑 → 转为下落投射物:初速 0.41、重力 0.41/tick、rot+0.1、
// vy 封顶 10(Projectile.cs:58999-59002 重力/:59075-59082 旋转+封顶,初速=
// SpawnFallingBlockProjectile WorldGen.cs:87355 NewProjectile 0.41+ai[0]=1 →
// 首拍 0.82),
// 命中实体按 GetSandfallProjData 档结算伤害(缺省 10,钱币堆 330-333 档 dmg=0;
// penetrate = -1,同敌冷却;friendly+hostile 双向——砸怪也砸玩家),
// 落到实心格上变回原 tile。见 Game.checkFallingSand(触发侧)。
import { Entity } from './Entity';
import { TILE } from '../core/constants';
import { TILE_BY_KEY, TILE_DEFS, VANILLA_TILE_ID, FALLING_SHEETS } from '../data/tiles';
import { VAN_TILE_SOLID_EXTRA } from '../world/gen/vanilla/GenSolid';
import { VANILLA_ITEM_KEY_BY_ID } from '../data/items';
import type { TileStore } from '../world/TileStore';
import type { GameHooks } from './types';
import type { Renderer } from '../render/Renderer';
import type { Camera } from '../render/Camera';
import { hitCritters, hitTownNpcs, playerCanHitEnemy } from './projTargets';
import { hostileProjectileDamage, mainDifficulty } from '../stats/ScaleStats';
import { projectileWetSection } from './projWetSection';
import { projectileData } from '../data/vanillaProjectiles';

// 落格门用原版 TileID → 本仓 id 换算（★本仓 tile id ≠ 原版 TileID,2026-08-25 修正）
const T_RAIL = VANILLA_TILE_ID.get(314);      // MinecartTrack
const T_CONV_L = VANILLA_TILE_ID.get(421);    // ConveyorBeltLeft
const T_CONV_R = VANILLA_TILE_ID.get(422);    // ConveyorBeltRight
const T_STALAC = VANILLA_TILE_ID.get(165);    // CaveDecos 钟乳石

// Main.tileSolid ∩ Main.tileSolidTop 九件套（Main.cs:8031-8032/9797-9800/10118-10119/
// 10126-10136——tileSolid 真值且 tileSolidTop 的全部成员;本仓 def.solid 对九件恒 false）
// ★BJ187 批四（2026-09-19）收编 GenSolid.VAN_TILE_SOLID_EXTRA 单源（九件套权威,sheet
// 域直别名;逐副本对拍与旧字面逐值全等,tests/bj187-batch4-*）——tileSolidOf 消费
// （def.solid ∪ platform∧九件套 = vanilla Main.tileSolid 代理,BBMSF :87884 arm2）
const TILE_SOLID_TOP_SHEETS = VAN_TILE_SOLID_EXTRA;
/** Main.tileSolid 代理：def.solid（tileSolid∧!tileSolidTop 域）∪ 九件套（tileSolid∧
 *  tileSolidTop）。家具（tileSolid=false∧tileSolidTop=true,如桌 18）不在此列——
 *  与 "def.solid||def.platform" 朴素代理的分野（BBMSF :87884 arm2 判据点）。 */
const tileSolidOf = (t: number): boolean => {
  const d = TILE_DEFS[t];
  if (!d) return false;
  if (d.solid === true) return true;
  return d.platform === true && TILE_SOLID_TOP_SHEETS.has(d.vanilla?.sheet ?? -1);
};

/** WorldGen.BlockBelowMakesSandFall（WorldGen.cs:87868-87893）1:1：判定 (bx,by) 下方格
 *  是否"会使沙再塌"（true=撑不住）。nactive()=active∧!inActive（Tile.cs:242-248
 *  `(sTileHeader&0x60)==32`——hasTile+!isActuated,与 liquid/checkingLiquid 无关）；
 *  越界=vanilla null/j≥maxTilesY-1 早退 false（:87871-87879）。
 *  ★终审④（2026-09-04）三消费位单源：FallingBlock 落地 flag2（Projectile.cs:79268）
 *  + Game 沙队支撑判定（SpawnFallingBlockProjectile :87328 同门）。 */
export function blockBelowMakesSandFall(st: TileStore, bx: number, by: number): boolean {
  if (!st.inBounds(bx, by + 1)) return false;                            // :87871-87879
  if (!st.hasTile(bx, by + 1) || st.isActuated(bx, by + 1)) return true; // :87880-87883 !tile.nactive()
  const below2Nact = by + 2 < st.h && st.hasTile(bx, by + 2) && !st.isActuated(bx, by + 2);
  const b1 = st.idx(bx, by + 1);
  // :87884-87887 `!tile[j+2].nactive() && (!tile.active() || !Main.tileSolid[tile.type])`
  if (!below2Nact && !(st.hasTile(bx, by + 1) && tileSolidOf(st.type[b1]))) return true;
  // :87888-87891 `tile.active() && tile.type == 165`（钟乳石）
  if (st.hasTile(bx, by + 1) && st.type[b1] === T_STALAC) return true;
  return false;
}

/** num18 兜底件表（Projectile.Kill aiStyle 10 :79122-79222 × GetSandfallProjData
 *  WorldGen.cs:87797-87837 复合换算：TileID.Sets.Falling 集（TileID.cs:395 =
 *  53/234/112/116/224/123/330-333/495,全部命中显式分支,default=53→31）→ 落块弹型 →
 *  Kill 表 num18）。SpawnFallingBlockProjectile 恒 ai[0]=1（WorldGen.cs:87352）→
 *  31 档 num18=169（:79133-79136 的 ai[0]==2 免掉落档=蚁狮敌弹档不适用;传送带重挂
 *  :79262-79265 仅 type==31 生效且同值 169=对本路径 no-op）。 */
const FALLING_TILE_DROP_ITEM = new Map<number, number>([
  [53, 169], [112, 370], [116, 408], [123, 424], [224, 1103], [234, 1246],
  [330, 71], [331, 72], [332, 73], [333, 74], [495, 4090],
]);

/** GetSandfallProjData（WorldGen.cs:87797-87840）tile sheet → 落沙弹型映射（default=53
 *  → 31）。湿段按真弹 id 传参（豁免分流=projectileData(id).ignoreWater 数据面）。 */
const SANDFALL_SHEET_PROJ = new Map<number, number>([
  [112, 56], [116, 67], [123, 71], [224, 179], [234, 241],
  [330, 411], [331, 412], [332, 413], [333, 414], [495, 812],
]);

/** TileID.Sets.Falling（TileID.cs:395 = 53/234/112/116/224/123/330-333/495）原版 sheet 集
 *  ——弹 411-414 专配第二重碰撞的判集（Projectile.cs:17707-17712）。与 Game.FALLING_TILES
 *  （本仓 id 域触发集）同源异域：彼按 tile id 入队,此按 sheet 判碰撞。 */
const FALLING_SHEET_SET = FALLING_SHEETS;   // ★BJ218 收编单源 data/tiles.ts:FALLING_SHEETS（TileID.cs:395,§6j）

// ============================================================
// ★死分支移植（2026-09-05 用户指令）：Collision.AnyCollisionWithSpecificTiles
//  （Collision.cs:2826-2925）四臂全量 1:1——含当前【不可达】的 X 侧/下方三臂。
//  不可达定谳：全仓落沙生成位（SpawnFallingBlockProjectile :87355 SpeedX=0f,
//  无任何 vx 写点）恒 vx≡0 → 水平位移分支结构性跳过；vy 恒 >0（重力 0.41 封顶
//  10 向下）→ 下方臂（cur.Y ≥ box 底向上顶头）亦不可达。移植备 future：将来
//  出现带 vx 的 411-414 生成位（接线点=Projectile.cs:17710 调用位）时本函数
//  即为权威碰撞面。运行时 coinBall 路径现役的 cross-row 自上方臂（pileLanding
//  段）与其臂 1 等价（红队 M13 核净+测试锁定），维持不动。
//  逐行对照：scan 窗 [pos/16-1, (pos+尺寸)/16+2) 钳 [0,max]（y 底钳 maxTilesY-40，
//  C# (int) 截断=trunc）；tile 盒 halfBrick 折半（Y+8/H-8）；相交门=【积分后盒】
//  （vector2=pos+vel）严格四不等式；四臂按【积分前盒】（vector3=pos）与盒的相对
//  位互斥分派，num5/6=水平臂记名 num7/8=垂直臂记名，跨臂记名相等校验防同格双钳
//  （num7==num5 → result.Y=原速回滚等）。SolidTop 排除=臂 2/3/4 各自带
//  （!Main.tileSolidTop——TILE_DEFS.platform ≡ 该表 85 成员,机械核对在案）；
//  evenActuated=true → 跳过 inActive 排除（弹 411-414 调用点字面）。
// ============================================================
export function anyCollisionWithSpecificTiles(
  st: TileStore, posX: number, posY: number, velX: number, velY: number,
  width: number, height: number, tileSheets: ReadonlySet<number>, evenActuated = false,
): { x: number; y: number } {
  const result = { x: velX, y: velY };
  const vector = { x: velX, y: velY };
  const nextX = posX + velX;                         // vector2 = Position + Velocity
  const nextY = posY + velY;
  const curX = posX;                                  // vector3 = Position
  const curY = posY;
  // scan 窗（:2832-2835，C# (int) 截断；窗界钳 [0,max] / y 底 maxTilesY-40）
  const num = Math.max(0, Math.trunc(posX / 16) - 1);
  const num2 = Math.min(st.w, Math.trunc((posX + width) / 16) + 2);
  const num3 = Math.max(0, Math.trunc(posY / 16) - 1);
  const num4 = Math.min(st.h - 40, Math.trunc((posY + height) / 16) + 2);
  let num5 = -1;                                      // 水平臂记名 X
  let num6 = -1;                                      // 水平臂记名 Y
  let num7 = -1;                                      // 垂直臂记名 X
  let num8 = -1;                                      // 垂直臂记名 Y
  for (let i = num; i < num2; i++) {
    for (let j = num3; j < num4; j++) {
      if (!st.hasTile(i, j)) continue;
      if (!evenActuated && st.isActuated(i, j)) continue;
      const tid = st.type[st.idx(i, j)];
      const sheet = TILE_DEFS[tid]?.vanilla?.sheet;
      if (sheet === undefined || !tileSheets.has(sheet)) continue;
      let boxY = j * 16;
      let boxH = 16;
      if (st.half[st.idx(i, j)] !== 0) { boxY += 8; boxH -= 8; }   // halfBrick 折半
      const boxX = i * 16;
      // 相交门（:2874-77 积分后盒 vector2 严格四不等式）
      if (!(nextX + width > boxX) || !(nextX < boxX + 16)
        || !(nextY + height > boxY) || !(nextY < boxY + boxH)) continue;
      const solidTop = !!TILE_DEFS[tid]?.platform;    // Main.tileSolidTop ≡ def.platform（85 成员）
      // 臂 1（:2878-86 自上方）：积分前盒底 ≤ 盒顶 → 垂直钳位（落堆/落沙面）
      if (curY + height <= boxY) {
        num7 = i; num8 = j;
        if (num7 !== num5) result.y = boxY - (curY + height);
      } else if (curX + width <= boxX && !solidTop) {
        // 臂 2（:2887-99 自左侧）：水平钳位到盒左；垂直臂记名同格 → result.Y 回滚原速
        num5 = i; num6 = j;
        if (num6 !== num8) result.x = boxX - (curX + width);
        if (num7 === num5) result.y = vector.y;
      } else if (curX >= boxX + 16 && !solidTop) {
        // 臂 3（:2900-12 自右侧）：水平钳位到盒右
        num5 = i; num6 = j;
        if (num6 !== num8) result.x = boxX + 16 - curX;
        if (num7 === num5) result.y = vector.y;
      } else if (curY >= boxY + boxH && !solidTop) {
        // 臂 4（:2913-22 自下方）：顶头 +0.01 微推；水平臂记名同格 → result.X 回滚原速+0.01
        num7 = i; num8 = j;
        result.y = boxY + boxH - curY + 0.01;
        if (num8 === num6) result.x = vector.x + 0.01;
      }
    }
  }
  return result;
}
/** 弹 411-414 四档 = 钱币堆落弹（GetSandfallProjData :87824-87831 → Kill num17=330-333）。
 *  ★唯一非实心的 Falling 成员：Main.tileSolid[330-333] 全表无赋值（Main.cs）=decor 格,
 *  TileCollision 不接 → 无第二重碰撞则落堆穿堆。495 贝壳堆 tileSolid=true（Main.cs:10291）
 *  /沙族全实心——对本表其余成员第二重碰撞与 TileCollision 合流=无增量。 */
const COIN_PILE_SHEETS = new Set([330, 331, 332, 333]);

/** WorldGen.AllowsSandfall（WorldGen.cs:87895-87907）1:1：沙格【上方】格拒支门——
 *  上方 active 且 ∈ 拒支集 → 沙不塌。拒支集 = TileID.Sets.BasicChest{21,467}
 *  （TileID.cs:315）/ BasicChestFake{441,468}（:317）+ 裸表 {26 恶魔祭坛,77 地狱熔炉,
 *  80 仙人掌,88 梳妆台,323 棕榈树,470 模特,475 帽架,597 传输晶塔}
 *  （TileID.cs:489/591/597/613/1083/1377/1387/1631）——TE/整件锚定件不被下方落沙掀飞。
 *  唯一消费点 = 触发侧 SpawnFallingBlockProjectile（WorldGen.cs:87335,在
 *  BlockBelowMakesSandFall :87332 之后）——Kill 侧 flag2 的 BBMSF（:79268）不带此门,
 *  故本助手只接触发侧（Game.drainSandQueue）,不入 blockBelowMakesSandFall 单源。 */
const SANDFALL_TOP_REJECT_SHEETS = new Set([21, 467, 441, 468, 26, 77, 80, 88, 323, 470, 475, 597]);
export function allowsSandfall(st: TileStore, x: number, y: number): boolean {
  if (!st.inBounds(x, y - 1)) return false;                // tileTopCache==null → false（:87898-87900）
  if (!st.hasTile(x, y - 1)) return true;                  // !active() → 不拒（:87902 result 初值 true）
  const sheet = TILE_DEFS[st.type[st.idx(x, y - 1)]]?.vanilla?.sheet ?? -1;
  return !SANDFALL_TOP_REJECT_SHEETS.has(sheet);           // :87903-87905
}

export class FallingBlock extends Entity {
  w = 10; h = 10; // 原版 width/height = 10(vanilla-projectiles.json 全沙族一致)
  tileKey: string;
  rot = 0;
  /** 本块是否已砸过玩家(每块只结算一次,防同帧多 hit) */
  private hitPlayer = false;
  /** 同敌冷却 tick(原版穿透弹 per-NPC 免疫帧语义) */
  private hitCd = new Map<number, number>();
  life = 3600;
  static readonly DAMAGE = 10; // GetSandfallProjData 缺省档（WorldGen.cs:87798 dmg=10）
  static readonly GRAV = 0.41; // AI_010 :58999-59002 ai[0]==1 → vy += 0.41/tick（B-2）
  /** vy 封顶（Projectile.cs:59075-59082 非 736-738 支恒达 else：vy>10 → 10） */
  static readonly VY_CAP = 10;
  /** 出生初速（SpawnFallingBlockProjectile WorldGen.cs:87355 NewProjectile 0f,0.41f
   *  + :87358 ai[0]=1f → 首拍 AI_010 再 +0.41 = 0.82;B-2 对齐） */
  static readonly SPAWN_VY = 0.41;
  /** GetSandfallProjData（WorldGen.cs:87797-87837）零伤档：钱币堆 330-333 → 弹
   *  411-414 dmg=0（:87824-87831,B-3）——砸实体不结算伤害（shell 堆 495→812 仍 10） */
  private static readonly ZERO_DMG_SHEETS = new Set([330, 331, 332, 333]);
  /** 本块弹的 NewProjectile damage 参数（GetSandfallProjData 按型档,缺省 10） */
  readonly dmg: number;
  /** 本块是否为钱币堆落弹（弹 411-414 四档=330-333,Projectile.cs:17707-17712
   *  第二重碰撞唯一受众） */
  private readonly coinBall: boolean;
  /** 原版落沙弹型（GetSandfallProjData :87797-87840 sheet→proj,default=31）——
   *  通用湿段按真 id 传参 */
  readonly projId: number;

  // ---- ★通用湿段（Projectile.cs:16895-17113 全体弹共用段;2026-09-06 杂项弹簇批）----
  //  逐 id 豁免核对（SetDefaults P.cs 逐块）：31(:1133-1142)/56/67/71/179/241/
  //  411-414(:4935-4943 共档)/812(:7955-7964)——【均无 ignoreWater 行】= 全受段
  //  （projectileData 数据面同向）。下沙入水=高频面（沙柱坠湖逐粒溅花）。
  //  阻尼不适用定谳：aiStyle 10 ∈ HandleMovement 专支（:17700-17720
  //  `if (aiStyle == 10) velocity = TileCollision(...)`,与 :17721 `else if (wet)`
  //  湿阻尼支【互斥】）→ 位移不折减（与 AshBallProj 40/DebrisProj 736-738 同谳）。
  //  插位=tick 头（AI_010 只写 velocity 不写 position,采样位=上拍位移后 ≡ 原版
  //  AI(:16880)后湿段(:16895)采样;杀拍口径：本类唯一头杀位=`--life` 头杀
  //  （vanilla timeLeft 杀在 Update 尾 :17307——湿段后）,湿段置于头杀【前】=
  //  杀拍照跑,双调用点/防双跑机不适用（单调用点天然覆盖）。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount :16984 置 10 / :17109-17112 逐拍 −1） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10893 等价;共享体首调自做） */
  presetDone = false;

  constructor(x: number, y: number, tileKey: string) {
    super();
    this.x = x; this.y = y;
    this.tileKey = tileKey;
    const tid0 = TILE_BY_KEY[tileKey];
    const sheet0 = tid0 !== undefined ? TILE_DEFS[tid0]?.vanilla?.sheet : undefined;
    this.dmg = sheet0 !== undefined && FallingBlock.ZERO_DMG_SHEETS.has(sheet0)
      ? 0 : FallingBlock.DAMAGE;
    this.coinBall = sheet0 !== undefined && COIN_PILE_SHEETS.has(sheet0);
    this.projId = sheet0 !== undefined ? (SANDFALL_SHEET_PROJ.get(sheet0) ?? 31) : 31;
    this.vy = FallingBlock.SPAWN_VY;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    // 联机傀儡（远端弹幕快照驱动）：纯位移外推，不跑命中/碰撞（伤害归拥有者客户端结算）
    if (this.netPuppet) { this.netPuppetStep(); return; }
    // ---- ★通用湿段（:16895-17113,共享体;溅花尘/音=wetSplashStepShared 弹面 10 粒）----
    //  tick 头插位（杀拍覆盖/采样位论证见字段块头注）;aiStyle 10 专支 → 阻尼不适用,
    //  位移行保持全速（下方 x/y 积分不乘档位）。
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater);
    if (--this.life <= 0) { this.dead = true; return; }
    // 上一帧中心格（落地放置格,见下方落地段注释）
    const prevTx = Math.floor((this.x + this.w / 2) / TILE);
    const prevTy = Math.floor((this.y + this.h / 2) / TILE);
    // AnyCollision 自上方接近门（Collision.cs:2866-2871 `vector3.Y + Height <=
    //  vector4.Y`）的积分前盒底——钱币堆第二重碰撞（下方 pileLanding 段）用
    const prevBottom = this.y + this.h;
    this.vy = Math.min(this.vy + FallingBlock.GRAV, FallingBlock.VY_CAP);
    this.x += this.vx;
    this.y += this.vy;
    this.rot += 0.1;                                   // :59077（非 736-738 支恒达 else）
    // 冷却推进
    for (const [k, v] of this.hitCd) {
      if (v <= 1) this.hitCd.delete(k); else this.hitCd.set(k, v - 1);
    }
    const st = game.world.store;
    const tx = Math.floor((this.x + this.w / 2) / TILE);
    const ty = Math.floor((this.y + this.h / 2) / TILE);
    if (!st.inBounds(tx, ty)) { this.dead = true; return; }

    // ---- 命中实体(先于落地判定:穿过实体继续坠,penetrate -1) ----
    // 玩家(hostile 方向;attacker 仅 Enemy 型,沙块不传)
    const p = game.player;
    if (!this.hitPlayer && p && !p.dead && this.aabbOverlaps(p)) {
      this.hitPlayer = true;
      // Damage_EVP：GetSandfallProjData 档伤害（缺省 10=P31 hostile 弹），命中再过乘区×2
      game.damagePlayer(hostileProjectileDamage(this.dmg, mainDifficulty(game.world)) * 2, this.cx, this.cy, undefined, undefined, undefined, undefined, { projDomain: true, projVid: this.projId });   // ★R-B-F10(第4=knockback 位,opts 第5)(2026-10-14):弹域双旗点亮(Game.ts damagePlayer :44480 门=projDomain&&projVid;★BJ704-R3 P1:旧单旗=静默 no-op)
    }
    // 敌人 + 小动物 + 城镇 NPC(friendly 方向;原版巨石碾压 NPC,hurt iframes 兜连击)
    hitTownNpcs(this, game, this.dmg, Math.sign(this.vx) * 2);
    for (const ent of game.enemies()) {
      if (!playerCanHitEnemy(ent, game)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
      const e = ent as unknown as { x: number; y: number; w: number; h: number; id: number; dead: boolean; hurt: (d: number, kx: number, ky: number, g: GameHooks) => boolean; def?: { hitSound?: string[] } };
      if (e.dead) continue;
      if (!(this.x < e.x + e.w && this.x + this.w > e.x && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
      const cd = this.hitCd.get(e.id) ?? 0;
      if (cd > 0) continue;
      this.hitCd.set(e.id, 20);
      e.hurt(this.dmg, 0, 0, game);
    }
    if (hitCritters(this, game)) { /* 小动物被砸即死,块继续坠 */ }

    // ---- 落地:变回 tile(原版 Projectile.Kill aiStyle==10 :79117-79310 等价)----
    // ★终审④（2026-09-04）落点几何对齐+被占/flag2 掉件面 1:1。死亡格=TileCollision
    //  钳位后弹心格（Projectile.cs:79120-79121 (int)((position.Y+height/2)/16)）。
    //  直落弹（SpawnFallingBlockProjectile vx=0、初速 0.41、vy 封顶 10 :87355/:59078-59081）
    //  钳位几何（Collision.cs:2299-2460）：全实心/平台/家具顶/底坡3-4=盒底钳到面顶
    //  （:2388-2404;底坡无 flag2 豁免:2361-2371）→ 钳位中心=面顶-5 → 死亡格=面格
    //  上一格=上一帧中心格（恒等）。★恒等论证锚（B-2 重推演 2026-09-04）=单拍位移
    //  <格宽 16px：vy 封顶 10（:59078-59081,本仓 VY_CAP=10）<16 ⇒ 上一帧中心格至多
    //  高出现帧中心格 1 格,而落地判定=中心格入面即死 ⇒ 上一帧中心必在死亡面上一格
    //  ——旧 GRAV0.3/cap16 时代"cap16 恰好=一格下限"的论证由 cap10<16 收紧为更稳
    //  同格恒等（恒等式对 [0,16) 内一切 vy 成立,与重力系数无关）;顶坡1-2 flag2 豁免
    //  竖钳（:2372-2383）→ 先被 AI_010 :59044-59052 SlopeTile 拍平+position.Y-=16 →
    //  等效钳在拍平方格顶（同上一格）;半砖=碰撞盒折半（:2350-2354 vector4.Y+=8）→
    //  钳位中心=面顶+3 ∈面格内 → 死亡格=半砖格本身（:79243 半砖上移支 velocity.Y
    //  已被 TileCollision 清 0=死支,R2' F2 同谳）→ 格 active 走 outer else :79298-79301。
    //  掉件面：被占=RequestNewItem(Center)（:79298-79301）;flag2/放置失败=
    //  Center+(0,-2)（:79293-79296）;flag2=:79250-79272 死亡格下方 active 且
    //  （rail 314 ∥ 传送带 421/422 ∥ BlockBelowMakesSandFall→blockBelowMakesSandFall）。
    //  ★修正史:初版"向上扫第一个空位"→沙抬到草/仙人掌上方悬空叠放(用户实报
    //  "蚁狮沙堆叠在草上/仙人掌断缝");二版把放置条件钉在碰撞格上→中心入实心恒被占
    //  =下落沙【永不落格】的隐性回归;2026-08-25 按上一帧中心格落格。
    // ★③（2026-09-04 幽灵战役掉落/碰撞族）：弹 411-414（钱币堆落弹）专配第二重碰撞
    //  ——Projectile.cs:17707-17712（aiStyle 10 碰撞链 `else if (type == 411 || 412 ||
    //  413 || 414)`：TileCollision 后再过 Collision.AnyCollisionWithSpecificTiles(
    //  TileID.Sets.Falling, evenActuated:true)）。钱币堆 330-333 tileSolid=false
    //  （Main.cs 全表无 tileSolid[330-333]）→ 无此门则落堆穿堆=堆叠面缺失；有此门：
    //  自上方接近臂（Collision.cs:2866-2871 `vector3.Y + Height <= vector4.Y` 且扫掠盒
    //  相交）在【盒底上穿堆格顶】当拍钳到堆顶（result.Y = 堆顶 − 盒底）→ 死亡格=
    //  堆面上一格 → Kill :79274-79277 PlaceTile(forced) 落在旧堆上=钱币堆逐格堆高。
    //  几何=原文式：穿越行 r=ceil(积分前盒底/16)（单拍步长 ≤10<16 → 至多一行）,
    //  触发条件 r*16 ≤ 积分后盒底（等号=原文 <= 贴面即钳）;积分前盒底已越过堆顶
    //  （嵌入态）→ 自上方臂不触发=穿堆续坠（原文同判）。evenActuated:true = 已致动格
    //  照接（本仓 hasTile 含致动=同判）;X 侧两臂（Collision.cs:2874-2882）对 vx≡0
    //  落沙弹（SpawnFallingBlockProjectile :87355 SpeedX=0f,本仓无 vx 写点）不可达=不建;
    //  Falling 集实心成员（沙/淤泥/贝壳堆 495）与 isSolid 判据合流=无增量。
    let pileLanding = false;
    let pileCrossRow = -1;
    if (this.coinBall) {
      const cross = Math.ceil(prevBottom / TILE);
      if (cross * TILE <= this.y + this.h && st.inBounds(tx, cross)) {
        const csheet = st.hasTile(tx, cross)
          ? TILE_DEFS[st.type[st.idx(tx, cross)]]?.vanilla?.sheet ?? -1 : -1;
        if (FALLING_SHEET_SET.has(csheet)) {
          pileLanding = true;
          pileCrossRow = cross;
        }
      }
    }
    if (pileLanding || st.isSolid(tx, ty) || st.isPlatform(tx, ty)) {
      const tid = TILE_BY_KEY[this.tileKey];
      // 死亡格与钳位中心（掉件锚）:半砖落面 → 死亡格=半砖格本身,钳位中心=面顶+8-5;
      // 钱币堆第二重碰撞落面 → 死亡格=堆面上一格（=积分前中心格,见上）,钳位中心=
      // 堆顶−5（Collision.cs:2866-2871 result.Y 钳位,DeathRow=穿越行）
      const surfHalf = st.half[st.idx(tx, ty)] !== 0;
      const dtx = surfHalf ? tx : prevTx;
      const dty = surfHalf ? ty : prevTy;
      const clampCy = surfHalf ? ty * TILE + 8 - this.h / 2
        : pileLanding ? pileCrossRow * TILE - this.h / 2
        : ty * TILE - this.h / 2;
      // num18（Falling 集 tile → 弹型 → num18,见 FALLING_TILE_DROP_ITEM 表注）;
      // 掉件键缺失=静默无掉（与 Game.onProjectileDeath AISTYLE10 支 dropKey 守卫同口径）
      const sheet = tid !== undefined ? TILE_DEFS[tid]?.vanilla?.sheet : undefined;
      const dropItem = sheet !== undefined ? (FALLING_TILE_DROP_ITEM.get(sheet) ?? 0) : 0;
      const drop = (py: number) => {
        const dropKey = dropItem > 0 ? VANILLA_ITEM_KEY_BY_ID[dropItem] : undefined;
        if (dropKey) game.spawnDrop(this.x + this.w / 2, py, dropKey);
      };
      // flag2（:79250-79273）：死亡格下方 active 且（rail ∥ 传送带 ∥ BBMSF;
      // 三支 vanilla 为并列 if,布尔并集同判）——★A-4（2026-09-04）外门=
      // :79255 `num16 < Main.maxTilesY - 2`（世界底部 2 行不进 flag2 扫描;
      // 旧 inBounds 只查 j+1<h,差一行。x 向越界=vanilla null→false,hasTile 同面）
      let flag2 = false;
      if (dty < st.h - 2 && st.inBounds(dtx, dty + 1) && st.hasTile(dtx, dty + 1)) {
        const bs = st.type[st.idx(dtx, dty + 1)];
        if (bs === T_RAIL || bs === T_CONV_L || bs === T_CONV_R) flag2 = true;
        if (blockBelowMakesSandFall(st, dtx, dty)) flag2 = true;
      }
      // :79247 `!Main.tile[num15,num16].active() && num17>=0`（落块弹 num17 恒≥0,
      //  109 过远档不经本实体）;幽灵格（flags=0,type≠0）=未激活=可落格（裸 active() 门）
      if (tid !== undefined && st.inBounds(dtx, dty) && !st.hasTile(dtx, dty)) {
        if (!flag2) {
          st.setTile(dtx, dty, tid, 0, 0);
          // :79278-79287 放置成功 → 下方半砖/坡面拍平（SlopeTile）——顶坡落面
          //  vanilla 由 AI_010 :59044-59052 先拍;此处为 Kill 尾统一面,两支同效
          //  ★G1谓词批(2026-09-04)：下格判定=裸 halfBrick()/slope()（:79280 无
          //  active 门）——曾加 flags 门与 DirtBallProj 无门副本矛盾,统一去门
          if (st.inBounds(dtx, dty + 1)) {
            const bi = st.idx(dtx, dty + 1);
            if (st.half[bi] !== 0 || st.slope[bi] !== 0) st.setSlope(dtx, dty + 1, 0);
          }
          // ★无声（2026-09-03 F5 音效录制定罪）：原版沙落回格【不播任何声音】——
          //  aiStyle 10 Kill 落格支(:79248-79310)无 PlaySound,WorldGen.PlaceTile
          //  (:59833-60450)全程零 PlaySound。曾播 'dig'×0.6 且不传坐标=距离衰减
          //  失效（F5 audio.sfx 环实锤:Dig_0/1/2 无坐标满响,计数与落沙潮吻合）
          // 沙堆到仙人掌旁 → 仙人掌支撑复查(原版 TileFrame case 80 → CheckCactus
          // 级联;沙坡/沙堆改变邻接后悬托仙人掌须断根——用户实报"仙人掌悬在沙坡上")
          const CAC = TILE_BY_KEY['v_80_cactus'];
          if (CAC !== undefined) {
            for (const [ax, ay] of [[dtx, dty - 1], [dtx - 1, dty], [dtx + 1, dty], [dtx - 1, dty - 1], [dtx + 1, dty - 1]] as const) {
              if (st.inBounds(ax, ay) && st.get(ax, ay) === CAC) {
                game.fellCactus?.(ax, ay);
                break;
              }
            }
          }
        } else if (dropItem > 0) {
          drop(clampCy - 2);                       // flag2 不放置仍掉件（:79293-79296 Center+(0,-2)）
        }
      } else if (dropItem > 0) {
        drop(clampCy);                             // 死亡格被占（含半砖落面）→ :79298-79301 Center
      }
      this.dead = true;   // 落地终局:放置/掉件/纯消失（num18=0 型被占,原版同 :79298 num18 门）
    }
  }

  draw(r: Renderer, _cam: Camera): void {
    // 世界坐标绘制(实体循环在世界变换内):取该 tile 的原版表首帧,随下落旋转
    const ctx = r.ctx;
    if (!ctx || !r.atlas) return;
    const tid = TILE_BY_KEY[this.tileKey];
    const sheet = tid !== undefined ? TILE_DEFS[tid]?.vanilla?.sheet : undefined;
    if (sheet === undefined) return;
    const fr = r.atlas.vframeAt(sheet, 0, 0);
    if (!fr) return;
    ctx.save();
    ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
    ctx.rotate(this.rot);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(fr.img, fr.sx, fr.sy, fr.sw, fr.sh, -8, -8, 16, 16);
    ctx.restore();
  }
}
