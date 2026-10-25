// 1457 批 C 新弹实体（Terarria1457 反编译为唯一标杆；行号均指该树）：
//   ChloroClaymoreBlade  1126  aiStyle 190  AI_190_NightsEdge 1126 支（:42734-43000）
//   ChloroSaberStab      1127  aiStyle 161  AI_161_RapierStabs 1127 支（:48483-48560）
//   ChloroSporeCloud     1128  aiStyle 92   aiStyle92 段 flag46 支（:33143-33340）
//   ChloroBladeSlam      1129  aiStyle 209  AI_209_ChlorophyteClaymoreBladeSlam（:42741-42748）
//   PetalstormShot       1116  aiStyle 196  AI_196_Petal 1116 支（:41192-41290）
//   StormLightning       1117/1122 aiStyle 203 AI_203_StormLightning（:40360-40560）
//   GlacierFangShot      1115  aiStyle 208  AI_208_GlacierFangShot（:37576-37750）
// 命中统一走 playerCanHitEnemy + applyProjStatus（StatusNPC :11176 表驱动——
// 1127→397 孢子侵染 300t / 1117→323+399 / 1122→400 已在 vanilla-projstatus.json）。
import { Entity } from './Entity';
import type { GameHooks } from './types';
import { BuffType } from '../stats/Buffs';
import type { Renderer } from '../render/Renderer';
import type { Camera } from '../render/Camera';
import { TILE } from '../core/constants';
// L5 长尾批：1091 浸液导通链 BlueLightningSmallLong（SpawnHitVisuals :14484-14492 收编;
//   ArcSurge 折线与双音已由 emitBoltFx+声段原生承担——不重复接线,消费派发面在 Game）)
import { blueLightningSmallLongFx } from '../fx/orchestraFx';
import { ParticleOrchestraType } from '../net/syncModules';
import { runModModifyHitNpcByProj } from '../mods/hooks';   // ★刀4-A:弹命中 NPC 修正链
import { projectileData } from '../data/vanillaProjectiles';
import { canHit, playerCanHitEntity } from '../physics/LineOfSight';
import { playerCanHitEnemy, applyBannerDamageDealt, expertEowFifthDmg, hitCritters, hitCrittersAll, statusPlayer } from './projTargets';   // ★BJ716-A：expertEowFifthDmg（R18-F1 EoW /5 臂）
// ★BJ383 幽灵兜帽吸血 proc 单源（BJ382 提升至 SpectreSoulProj 域导出;per-class 二窗）
// ★BJ420 幽灵伤害头 ghostHurt 同单源 + 受理面快照（清偿刀 T 族规）
import { ghostHealProc, ghostHurtOnHit, playerHasGhostHurt,
  snapshotVanillaGate, vanillaGateRejected } from './SpectreSoulProj';
import { nebulaBoosterOnHit } from './NebulaBooster';   // ★BJ424 星云套装 on-hit 单源
import { projectileSnapStrikeBonus } from '../stats/SnapStrike';
import { GorePiece } from './GorePiece';
import { damageVarRoll } from '../stats/DamageVar';
import { applyProjStatus } from './projStatus';
import { Lang } from '../i18n/Lang';   // ★BJ674 自伤死因弹型名（itemName 6155）
// ★通用湿段（Projectile.cs:16903-17113 全体弹共用段;2026-09-06 武器弹簇接入批）
import { projectileWetSection, projWaterDragFactor } from './projWetSection';
import { wetCollision } from './npcLiquid';
import { ZAPPING_JELLYFISH, jellyZapProjectile } from '../player/SwingPathMath';
import { mainDifficulty, sampleCurve, remap, GDL, f32, curveKey, type CurveKey } from '../stats/ScaleStats';
import { ITEM_BY_KEY, ITEM_DEFS } from '../data/items';
import { itemCombat } from '../data/vanillaItemCombat';
import { prefixStat } from '../data/vanillaPrefixes';
import { projSprite, projFrameImg } from './Arrow';
import { LCG32, arcSurgeWeaponGenerator, lightningStrikeWeaponGenerator,
  type Bolt, stormLightningGenerator } from '../fx/LightningGenerator';

// ---- ★通用湿段定谳表（2026-09-06 武器弹簇批;逐 id 反编译 P.cs SetDefaults 699-10676,
//  `ignoreWater = true` 行号逐块核对;缺行=不豁免=原版缺省 false=受湿段 :16903 整段门）----
//  受段（本文件内接 projectileWetSection）：
//    · 1127 ChloroSaberStab   — block :10561-10566 经 DefaultToShortsword(:10775-10788)
//      【无】ignoreWater 行（DefaultToSpray :10693-10704 才置位）→ 溅花;阻尼 N/A
//      （tileCollide=false :10563 → HandleMovement :17581 `if (tileCollide)` 阻尼块整跳,
//       wetVelocity≡velocity;且 AI_161 每拍从玩家锚直写 Center,AI 直写位）
//    · 1128 ChloroSporeCloud  — block :10567-10581 无 ignoreWater;tileCollide=false
//      :10569 → 阻尼 N/A（同上）;湿段在 AI 后/位移前逐拍
//    · 731  ThunderBoltShot   — block :7696-7706 无 ignoreWater;tileCollide 缺省 true
//      → 水中位移阻尼 ×0.5/蜂蜜 0.25/微光 0.375 生效（extraUpdates=1 → 2 子步,
//      湿段随子步逐跑 = 原版 Update 子步循环 :16781 内 :16895 同序）
//  豁免（N/A——SetDefaults 显式 ignoreWater=true,湿段不跑）：
//    1126 :10555 / 1129 :10589 / 1116 :10425 / 1117 :10433 / 1122 :10443 /
//    1091 :10184 / 1115 :10410 / 439 :5104 / 440 :5117 / 704 :7461 / 950 :8966 /
//    908 :8631
//  （数据面 vanillaProjectiles.PROJ_IGNORE_WATER 同集;运行时经
//   projectileData(id)?.ignoreWater 分流,新增 id 接入自动生效。）

/** 同敌命中去重/冷却表（WeaponProj.HitCooldown 同构——该类模块私有，此处独立一份） */
export class HitCdImpl {
  private map = new Map<number, number>();
  tick(): void {
    for (const [k, v] of this.map) {
      if (v <= 1) this.map.delete(k);
      else this.map.set(k, v - 1);
    }
  }
  /** ★S2 拆相（清偿刀 R1-C 落刀,2026-09-30）：peek=读门判定（原版外环 flag2 表读,
   *  Projectile.cs:12596——无副作用）/ commit=受理写（写梯 :14031-14038 usesIDStatic
   *  支/:14168-14173 usesLocal 支=受里面深位）。ready() 保留为组合式（peek+commit）,
   *  直调面（MinionProj/WeaponProj/SkyDragonFury/TownShot/MonkStaffFury/
   *  PhoenixBowProj/damageAlongBolt D2）零变化;dealContacts 拆两相后,水母块
   *  （:12673-12688 原文 return :12687 在写梯前=拒收零落账）不再消费冷却行。 */
  peek(id: number): boolean {
    return !this.map.has(id);
  }
  commit(id: number, cooldown: number): void {
    this.map.set(id, cooldown < 0 ? 2147483647 : cooldown);
  }
  /** cooldown<0 = localNPCHitCooldown −1（每敌一次） */
  ready(id: number, cooldown: number): boolean {
    if (!this.peek(id)) return false;
    this.commit(id, cooldown);
    return true;
  }
}

/** ★StormLightning shader 的 Extra_288 亮度 LUT（用户实拍"颜色不对且很暗"定罪）：
 *  原版 PixelShader.cso pass StormLightning（反汇编 /tmp/fx-dump-storm.txt :3181）：
 *    texld r0, (t0.x, t0.y/t0.z), s0 → r0.x ×8 ×uOpacity ×uSaturation ×vColor → oC0
 *  = 最终色=顶点色×(Extra_288.r×8×包络×强度)。Extra_288 为 256² 纵向梯度带
 *  （y=128 峰值 250→×8 过曝白热芯；上下暗→蓝辉光边）——条带横向 v 采样出
 *  "白芯蓝边"截面。曾平色 rgba 填充=无电纹不发亮。LUT 惰性构建（atlas 懒加载） */
let stormTexLut: Float32Array | null = null;
let stormTexTried = false;
function stormTexBrightness(r: import('../render/Renderer').Renderer, v: number): number {
  if (!stormTexTried) {
    stormTexTried = true;
    try {
      const img = r.atlas?.ensureVImage('vanilla/Extra_288.png');
      if (img && img.width > 0 && typeof document !== 'undefined') {
        const cv = document.createElement('canvas');
        cv.width = img.width; cv.height = img.height;
        const cx = cv.getContext('2d', { willReadFrequently: true });
        if (cx) {
          cx.drawImage(img as CanvasImageSource, 0, 0);
          const d = cx.getImageData(0, 0, img.width, img.height).data;
          const lut = new Float32Array(img.height);
          for (let y = 0; y < img.height; y++) {
            let acc = 0;
            for (let x = 0; x < img.width; x++) acc += d[(y * img.width + x) * 4];
            lut[y] = acc / img.width / 255;
          }
          stormTexLut = lut;
        }
      }
    } catch { /* 图集未就绪/CORS——回退平色 */ }
  }
  if (!stormTexLut) return 0.5;
  return stormTexLut[Math.min(stormTexLut.length - 1, Math.max(0, (v * stormTexLut.length) | 0))];
}

/** usesIDStaticNPCImmunity 型级共享免疫表：Projectile.perIDStaticNPCImmunity[
 *  immunityIdentity, npcIndex] 按 GameUpdateCount 到期（Projectile.cs:606-611 +
 *  :784 immunityIdentity 缺省=type）——全场【同型】一张表，衰减与「正在结算的弹数」
 *  无关。墙钟实现（Arrow.idStaticCheck 先例同构）：ready() 到期即写新窗。
 *  ★账 L2 配套：1128 曾用每弹一张 HitCd(30)=N 颗云同拍 N 连击且 N 倍加速衰减。 */
class IdStaticSharedTable {
  private m = new Map<number, number>();
  constructor(private readonly cooldownMs: number) {}
  /** dealContacts 循环头调用位——时间驱动衰减,无需逐弹递减 */
  tick(): void {}
  /** ★S2 拆相（R1-C,同 HitCdImpl 注）：peek 读门/commit 写行。ready 组合式保留。 */
  peek(id: number): boolean {
    return (this.m.get(id) ?? 0) <= Date.now();
  }
  commit(id: number, _cooldown?: number): void {
    const now = Date.now();
    this.m.set(id, now + this.cooldownMs);
    if (this.m.size > 512) {
      for (const [k, v] of this.m) if (v <= now) this.m.delete(k);
    }
  }
  ready(id: number, _cooldown?: number): boolean {
    if (!this.peek(id)) return false;
    this.commit(id);
    return true;
  }
}

/** 1 tick 的毫秒当量（vanilla 60fps——「cooldown 10t≈167ms」的换算基数） */
const TICK_MS = 1000 / 60;

/** 1122 ArcSurge（usesIDStaticNPCImmunity + idStaticNPCHitCooldown=10 :10567-10569
 *  段;Kill 帧 localAI[0]=2 :71924） */
const ID_STATIC_1122_TABLE = new IdStaticSharedTable(10 * TICK_MS);

/** 1128 孢子云（usesIDStaticNPCImmunity + idStaticNPCHitCooldown=30 :10574-10575）——
 *  全场同型一张 30t 窗：多颗云同拍扑同敌只结算一颗 */
const ID_STATIC_1128_TABLE = new IdStaticSharedTable(30 * TICK_MS);

/** ★BJ286 482 诅咒焰墙（爬藤怪法杖 3014：usesIDStaticNPCImmunity +
 *  idStaticNPCHitCooldown=10，Projectile.cs:5584-5585）——全场同型一张 10t 窗，
 *  ClingerStaffWallProj 消费 */
export const ID_STATIC_482_TABLE = new IdStaticSharedTable(10 * TICK_MS);

// ================= L1 GameMode 难度乘区正解（风暴家 EVP/PVE 双轴） =================

/** LightningPlayerDamageScaling（GameDifficultyData.cs:71；**曲线键在 Main.Difficulty
 *  浮点轴上**,非 GameMode int——Main.Difficulty getter Main.cs:2783-2809:
 *  Classic→GameDifficultyLevel.Classic(1)/Expert→Expert(2)/Master→Master(3)/
 *  Journey→【不进 Expert/Master 分支】=Classic 值 1.0,仅被旅程"给 NPC 强度"滑杆
 *  (_gameModeDifficultyOverride)+FTW 种子 +1 抬档）。1091 SetDefaults :10186
 *  `hostileDamageScaling = LightningPlayerDamageScaling` 接线本表 */
export const LIGHTNING_PLAYER_DAMAGE_SCALING: readonly CurveKey[] = [
  // ★②-F4 预折：Journey(0.5) 首键相等段 Sample 走 num===0 早退直出 key.output——
  //   折后 = fround(0.04)=0.03999999910593033，与 C# Key(float,float) 构造语义一致；
  //   消费链 lightningEvpFinalDamage 的中间 fround 吸收两形态样本差（dmg 1..100000
  //   全轴零截断翻档）。见 tests/scalestats-prefold.test.ts。
  curveKey(GDL.JOURNEY, 0.04),
  curveKey(GDL.CLASSIC, 0.08),
  curveKey(GDL.MASTER, 0.24),
  curveKey(GDL.LEGENDARY, 0.4),
];

/** 玩家侧终值 = DamageVar(base,-luck) × curve(Difficulty) ×2 ×死囚毛衣(trap ×0.5 帽300)
 *  ——Damage_EVP 全序（Terarria1458/Terraria/Projectile.cs:14905-14922；
 *  1457 同段 :14905-14922）：`(int)num3` 截断逐级,banner/resistCold 两步对 1091 无源
 *  （bannerIdToRespondTo=0 / coldDamage=false）跳过;1091 trap=true、reflected=false。
 *  所得 <1 由 Player.Hurt 丢弃,此处不强钳 */
export function lightningEvpFinalDamage(
  base: number,
  difficultyFloat: number,
  o: { luck?: number; sweater?: boolean; rnd?: () => number } = {},
): number {
  let dmg = damageVarRoll(base, -(o.luck ?? 0), o.rnd);            // :14905 幸运方差项(取负!)
  // (int)((float)num3 * Sample)——乘积按 float32 求值再截断（100×.08f=8.0f 而非双精度 7.9999→7）
  dmg = Math.trunc(f32(f32(dmg) * sampleCurve(LIGHTNING_PLAYER_DAMAGE_SCALING, difficultyFloat)));   // :14916 (int)
  dmg *= 2;                                                        // :14917-14918 num4=2
  if (o.sweater) {                                                 // :14919-14922 死囚毛衣:trap 减半+帽 300
    dmg = Math.trunc(f32(f32(dmg) * 0.5));
    dmg = Math.min(dmg, 300);
  }
  return dmg;
}

/** NPC 侧乘区（:14632 `if (type == 1091) num *= Utils.Remap(Main.Difficulty,
 *  GameDifficultyLevel.Classic, Master, 1f, 3f)`;1457 :14632 同值）——Remap 默认 clamp,
 *  D≥3 钉 3（ legendary 不外推） */
export function lightningNpcMultiplier(difficultyFloat: number): number {
  return remap(difficultyFloat, GDL.CLASSIC, GDL.MASTER, 1, 3);
}

// ================= 地形/液体/装备槽小工具（A① 导通链 + L1 连带消费位） =================

/** Main.tile[x,y].liquid != 0（StormLightningLiquidCollisionCheck 谓词 :16237-16242）
 *  ——tile 中心像素采样 World.liquidAt（0-255 原始液体量） */
function tileHasLiquid(game: GameHooks, tx: number, ty: number): boolean {
  const w = game.world as unknown as { liquidAt?: (px: number, py: number) => number };
  if (typeof w.liquidAt !== 'function') return false;
  return w.liquidAt((tx + 0.5) * TILE, (ty + 0.5) * TILE) > 0;
}

/** Utils.PlotLine int 重载 1:1（Utils.cs:2359-2415,Bresenham,jump=true 缺省;visit 返回
 *  false 即短路报 false）——A① 液体导通链与电化粒子两用 */
function plotTiles(
  x0: number, y0: number, x1: number, y1: number,
  visit: (x: number, y: number) => boolean,
): boolean {
  if (x0 === x1 && y0 === y1) return visit(x0, y0);
  const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
  let ax = x0, ay = y0, bx = x1, by = y1;
  if (steep) { [ax, ay] = [ay, ax]; [bx, by] = [by, bx]; }
  let acc = Math.abs(bx - ax) / 2;
  let cur = ay;
  const dxT = Math.abs(bx - ax), dyT = Math.abs(by - ay);
  const incX = ax < bx ? 1 : -1, incY = ay < by ? 1 : -1;
  for (let i = ax; i !== bx; i += incX) {
    if (!visit(steep ? cur : i, steep ? i : cur)) return false;
    acc -= dyT;
    if (acc >= 0) continue;
    cur += incY;
    acc += dxT;
  }
  return true;
}

/** Utils.PlotTileLine 的切格面实现（Utils.cs:283-320：中心线步进+法向厚度带全覆盖,
 *  局部 tile 内含外沿一格）——aiStyle190/191 旋转厚带与 1127 突刺共用。
 *  A⑤ 转正：旧"三采样窗(端+中)"近似退役——PlotTileLine 是【连续带】,三窗漏中段草。 */
function cutThickTileLine(
  game: GameHooks, x0: number, y0: number, x1: number, y1: number, width: number,
): void {
  const minTx = Math.floor(Math.min(x0, x1) / TILE), maxTx = Math.floor(Math.max(x0, x1) / TILE);
  const minTy = Math.floor(Math.min(y0, y1) / TILE), maxTy = Math.floor(Math.max(y0, y1) / TILE);
  const segLen = Math.hypot(x1 - x0, y1 - y0) || 1;
  const bandR = width / 2 + 8;          // 带半径 + 8px 窗沿(PlotTileLine 部分覆盖邻格同型)
  for (let tx = minTx; tx <= maxTx; tx++) {
    for (let ty = minTy; ty <= maxTy; ty++) {
      // 点(tile 中心)到线段距离 ≤ bandR → 在带内
      const px = (tx + 0.5) * TILE, py = (ty + 0.5) * TILE;
      const t = Math.min(1, Math.max(0, ((px - x0) * (x1 - x0) + (py - y0) * (y1 - y0)) / (segLen * segLen)));
      const qx = x0 + (x1 - x0) * t, qy = y0 + (y1 - y0) * t;
      if (Math.hypot(px - qx, py - qy) <= bandR) game.cutTile(tx, ty);
    }
  }
}

/** 死囚毛衣（Dead Man's Sweater 5007）佩戴态：Player.deadMansSweater(:2087,armorPiece
 *  switch :13226-13228 只扫功能槽 armor[0..9])。equipStats 未建此键（projTargets GAP 登记项),
 *  就近读装备槽 vid;vid 表查不到（注册缺失）按未戴处理 */
function playerDeadMansSweater(game: GameHooks): boolean {
  const p = game.player as unknown as { inv?: { armor?: Array<{ id?: number } | null> } };
  const armor = p?.inv?.armor;
  if (!Array.isArray(armor)) return false;
  const n = Math.min(10, armor.length);
  for (let i = 0; i < n; i++) {
    const slot = armor[i];
    if (!slot || slot.id == null) continue;
    if (slot.id === DEAD_MANS_SWEATER_ID) return true;
  }
  return false;
}

/** 死囚毛衣本仓 item id（vi_5007 → 内部 id;注册缺失时 NaN → 消费恒 false） */
const DEAD_MANS_SWEATER_ID = ITEM_BY_KEY['vi_5007_dead_man_s_sweater'] ?? NaN;

/** 充能水母接触反噬弹幕族（Damage_PVE_Inner :12682：aiStyle 19/161/75/140 ||
 *  ProjectileID.Sets.IsAWhip || AllowsContactDamageFromJellyfish——ProjectileID.cs:39
 *  = {972,982,984,997,1043}）。IsAWhip 面不在本函数域（鞭走 WhipProj 自有命中环） */
// 接触反噬资格判定共享化（JELLY_ZAP_AI_STYLES/PROJ_IDS/谓词移居 SwingPathMath——
// ZAPPING_JELLYFISH 同表;曾本地私有=Arrow/WhipProj 复用会造 Arrow⇄proj1457 环）

/** 敌怪最小命中面（Enemy/TownNPC 共用形状） */
interface HitTarget {
  x: number; y: number; w: number; h: number;
  id: number;
  dead: boolean;
  hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number, srcProjId?: number) => boolean;
}

/** CanHitWithMeleeWeapon LOS 段单源（Projectile.cs:12420-12425）：A 段整盒
 *  Collision.CanHit(Main.player[owner] ↔ ent) + B/C/D 手位三射线 CanHitLine——
 *  与 Player.CanHit(Entity)（Player.cs:42857-42865）字面同式（宿主换成 owner 玩家）
 *  ⇒ 整链复用 LineOfSight.playerCanHitEntity（int÷/f32 语义单源在彼处,勿重刻）。
 *  world.store 缺位（测试桩/工具面）退化放行——VolcanoBlastProj 既有可选钩约定。 */
function ownerMeleeWeaponLOS(
  game: GameHooks,
): (e: { x: number; y: number; w: number; h: number }) => boolean {
  const st = ((game.world as unknown as { store?: never } | undefined)?.store)
    ?? (game as unknown as { store?: never }).store;
  if (!st) return () => true;
  return (e) => playerCanHitEntity(st, game.player as never, e);
}

/** ★BJ488③④（2026-10-04）:25712-25714 持械折入算式单源——held={id,prefix}（InvItem
 *  形态,Inventory.heldItem() 载体）→ item.crit + 词缀 crt（Item.Prefix Item.cs:585
 *  `crit += crt` 重铸期已折进 item.crit 字段,原版 :25712-14 读字段即含词缀;本式按
 *  现值+词缀表动态合成=同值形）。消费面：rollVanillaHitCrit（BJ486③ 掷率）/
 *  WeaponProj.hitEnemies autoCritPct 兜底支（BJ488③）/ Game.netProjBroadcast crit
 *  快照（BJ488④——ownerMeleeCritBits 内 {vid,prefix} 形态同式,位段压缩前同源算术）。 */
export function heldItemCritBonus(held: { id: number; prefix?: number } | null | undefined): number {
  if (!held) return 0;
  return (itemCombat(ITEM_DEFS[held.id]?.vid ?? -1)?.crit ?? 0)
    + (held.prefix ? prefixStat(held.prefix).crt : 0);
}

/** ★BJ482②（2026-10-03）原版受理 crit 掷 owner 装配查询（Projectile.cs:12915-12927）：
 *  melee/ranged/magic 类旗 → `Main.rand.Next(1,101) <= owner.xxCrit + bonusCritChance`
 *  三连掷（本面单类单旗,单掷等价）;无类旗（908 钛金碎片/226 花瓣/221/227 叶弹族/
 *  567-568 孢子云/1091 世界雷——1091 且 trap=true → OwnedBySomeone=false :580-589
 *  整 crit 块跳过）→ 零掷。基 4=原版字段初值（Player.cs:2413-2417/:18458-18460）;
 *  owner 聚合=Player.critChance(kind)（装备/buff 面,不含基 4,基 4 调用侧补=
 *  Game.ts critTotal 同口径）。bonusCritChance=第三形参（:12912-12914 num13——
 *  ★BJ486④:698 武僧蓄爆 +25 通道已接线;2269 左轮/:11142 父继承=登记不接线,
 *  详见函数体内注）。持械武器 item.crit+crt 经 :25712-25714 逐帧链入三系 crit=弹面
 *  掷【含】之（命中拍动态折入,见体内 BJ486③ 注;静态冻结载体 critTotal/arcCrit 退役,
 *  死写已于 BJ486② 全普查摘除——13 旗标+4 新发现）。桩面防御（player.critChance 缺
 *  → 聚合 0,bj475 夹具同相=BJ175 ?? 习语）。 */
export function rollVanillaHitCrit(
  projId: number,
  game: GameHooks,
  bonusCritChance = 0,
  /** ★BJ496①（2026-10-04）spawn 位类别旗覆写通道：原版三连掷（:12915-12927）读的是
   *  弹体【实旗】=SetDefaults 数据面 ∪ spawn 位显式覆写（Player.cs:48805 蜂枪发蜂
   *  `magic=true`、:43976/:44478/:44872/:13758 `.melee=true`、:13959/:78077
   *  `.ranged=true`——仓内形态=Arrow.projClass 实例字段,projTargets Z-F1 槽）。
   *  数据面缺失族（181/566）此前经本函数 kind=null 捷径返假=掷面整缺（BJ493 主环
   *  路由化后 critChance>0 也只到本函数即断）。显式覆写优先于数据面（resolveProjClass
   *  同序）;传 'summon'/未知值=不掷（零 RNG）,undefined=纯数据面（既有调用零漂移）。 */
  classOverride?: 'melee' | 'ranged' | 'magic' | 'summon',
): boolean {
  const pd = projectileData(projId);
  const kind = classOverride === 'melee' ? 'melee' as const
    : classOverride === 'ranged' ? 'ranged' as const
      : classOverride === 'magic' ? 'magic' as const
        : pd?.melee ? 'melee' as const : pd?.ranged ? 'ranged' as const : pd?.magic ? 'magic' as const : null;
  if (kind !== 'melee' && kind !== 'ranged' && kind !== 'magic') return false;
  const player = game.player as unknown as
    { critChance?: (k: 'melee' | 'ranged' | 'magic') => number;
      inv?: { heldItem?: () => { id: number; prefix?: number } | null | undefined } } | null;
  const agg = player?.critChance?.(kind) ?? 0;
  // ★BJ486③ 定谳（2026-10-03,原版亲读翻转 BJ482 前提）：Player.cs:25712-25714 每帧
  //  `meleeCrit/magicCrit/rangedCrit += inventory[selectedItem].crit`（三系无条件,
  //  词缀 crt 已在重铸期折进 item.crit——Item.cs:585）→ GetWeaponCrit（:54009-54023
  //  纯读类字段）与弹面掷 :12915-12927 同源 ⇒ 弹面掷【含】持械武器 item.crit+crt
  //  （命中拍现值）。BJ482「弹面掷不含武器两档」前提就此证伪——但 spawn 位载体
  //  写位仍是死写（读面不读该值,本函数动态折入=原版逐帧链同相,静态冻结退役）。
  //  折入式=ownerMeleeCritBits（Game.ts GA4 ε#3）同款：itemCombat(vid).crit+词缀 crt。
  const heldBonus = heldItemCritBonus(player?.inv?.heldItem?.() ?? null);
  // ★BJ486④（2026-10-03）num13 形参化（:12912-12914——bonusCritChance>0 才入掷）：
  //  698 武僧蓄爆通道已接线（MonkSlam 面传 25,Game.ts:20748 旧 +0.25 载体建模退役）;
  //  2269 左轮 :11134（生产端 revolverCritChanceBonus 蓄转 ramp/decay/clamp Player.cs:
  //  43009-43029 未建模=登记不接线）与 :11142 父弹继承（原版无可观测消费面——现役
  //  带 bonus 生产者仅 698/2269 弹,均无子弹;仓内无 bonusCritChance 字段）=登记不接线。
  const num13 = bonusCritChance > 0 ? bonusCritChance : 0;
  return Math.random() < 0.04 + (agg + heldBonus + num13) / 100;
}

/** 通用命中结算：盒相交 → 暴击掷 → hurt + StatusNPC + 飘字。
 *  cooldown<0 = 每敌一次（localNPCHitCooldown −1）；返回是否命中过。
 *  gate：ownerHitCheck 门（CanHitWithMeleeWeapon :12415 距离段——基准=弹体自身
 *  Center（:12417 `Distance(ent.Center)`,R2-F1+F10 修正）+ :12420-12425
 *  LOS 四探针段（owner 玩家基准）,los 由调用侧经 ownerMeleeWeaponLOS 注入;
 *  noTileCollide 目标整门豁免——:12657 字面）+ usesOwnerMeleeHitCD 共享命中表
 *  （Damage_PVE :12596 门 + StrikeNPC :14343 写——与玩家挥击弧共用 per-enemy
 *  命中表，同一挥击内弧+弹不双结算）。
 *  ★迭代域缺口登记（R2-F2,2026-09-03 评估后不接线）：原版 Damage_PVE 遍历
 *  Main.npc 全域（:12592 `i < Main.maxNPCs`）——近战弹（1126/1129 等）可伤城镇
 *  NPC（巫毒窄门 :11970-11976）。本函数只扫敌桶;接城镇域需同链结算面（暴击掷/
 *  DamageVar/banner/共享命中表 + TownNPC.hurt 全形 crit/armorPen/pierce 参）——
 *  现有 hitTownNpcs 是整函数结算支（自带伤径,无暴击/DamageVar 面）,直接复用会
 *  落 invented 近似,故登记缺口不在本批接线。 */
export function dealContacts(
  self: { x: number; y: number; w: number; h: number; cx: number; cy: number; damage: number; knockback: number; armorPen: number; critChance: number; projId: number },
  game: GameHooks,
  cd: HitCdImpl | IdStaticSharedTable,
  cooldown: number,
  onHit?: (t: HitTarget) => void,
  gate?: { maxDist: number; sharedHits?: Set<number>;
    /** CanHitWithMeleeWeapon LOS 段（:12420-12425）——store/玩家盒在调用侧 */
    los?: (e: { x: number; y: number; w: number; h: number }) => boolean },
  /** Enemy.hurt pierce 形参透传（缺省 0 维持全既有调用面）：1 = maxPenetrate 单发
   *  flag3——无视免疫帧且命中不设帧（Projectile.cs:11903-11907）。叶弹 227 台账 L3
   *  清偿批同段引用（ChloroLeafCrystalProj.ts） */
  hitPierce = 0,
  /** ★δA bug②（2026-08-31 蓝队单条群）：maxPenetrate==1 首命中即截断——keepIterating
   *  语义映射（Damage_PVE_Inner :14186-14201：penetrate>0 逐击递减，减至 0 时
   *  keepIterating=false；Damage_PVE for 循环条件 `(i < maxNPCs) & keepIterating`
   *  :12592 ⇒ 同拍重叠多怪只结算【桶序首个】，随后弹亡再无第二目标）。叶弹 227
   *  调用侧启用（其一拍 181 子步全路径扫掠,每子步只允许一次命中结算面） */
  stopAfterFirstHit = false,
  /** ★BJ286：per-target 伤害调整（Projectile.Damage 段逐型算式挂点——DamageVar 后/
   *  banner 前调用，返回调整后 dmg）。首位消费者 = 482 蠕形 aiStyle6/37 减半 :12983 */
  damageAdj?: (ent: unknown, dmg: number) => number,
): void {
  cd.tick();
  for (const ent of game.enemies()) {
    const e = ent as unknown as HitTarget & { vanillaId?: number };
    if (!e || e.dead) continue;
    // ★dontTakeDamage 目标排除（Projectile.cs:12600 目标选择门——dontTakeDamage 连
    // Damage_PVE_Inner 都不进：StatusNPC/on-hit/TryConsumingTimerCrit 全不可达；
    // ★ZappingJellyfish 例外（2026-09-03 定谳）：集={63,64,103,242}（NPCID.cs:4460
    //  BlueJellyfish/PinkJellyfish/GreenJellyfish/BloodJelly；本仓 SwingPathMath
    //  .ZAPPING_JELLYFISH 同表）原版外环门与 dontTakeDamage 并列豁免——本仓 AI_018
    //  潜伏态（Enemy.jellyfishAI :8653,专家+水中 ai1==1 充能段）确实置 dontTakeDamage
    //  =true,旧注"例外集本仓暂无成员"不实。豁免的净效果见 cd.ready 后水母块（充能态
    //  仍不受伤,原版内层 :12683 二次拦截;外环豁免只开接触反噬电击口）。曾缺=70/72
    //  浸剂/DoT 把 hp 打穿 0 进永不死亡僵尸态（评审 C 定谳 2026-09-02 补;勿并入
    //  playerCanHitEnemy/immortal——488 训练假人靠 iframes=2 重打,键 immortal 是
    //  2026-08-25 已知回归案）
    const jellyVid = e.vanillaId;
    const zapJelly = jellyVid !== undefined && jellyVid > 0 && ZAPPING_JELLYFISH.has(jellyVid);
    const jellyDontTake = (e as unknown as { dontTakeDamage?: boolean }).dontTakeDamage === true;
    if (jellyDontTake && !zapJelly) continue;
    if (!playerCanHitEnemy(ent, game, self.projId)) continue;
    if (hitPierce !== 1 && ((e as unknown as { iframes?: number }).iframes ?? 0) > 0) continue;
    // ★红蓝-L1①（2026-09-18）内环免疫门（Projectile.cs:12635-12638 收编到结算点）：
    //  `if (!((owner < 0 || targetNPC.immune[owner] == 0) | flag3)) return;`——immune[owner]
    //  !=0（=仓内 e.iframes>0，Enemy.hurt 同字段承载）且非 flag3（hitPierce===1 单发豁免
    //  档）→ 原版内门早退先于 StatusNPC(:13634)/TryDoingOnHitEffects(:13642)/StrikeNPC
    //  (:13702)/免疫梯写行(:14033-14037,:14175-14183)/penetrate 递减+keepIterating
    //  (:14190-14205)/Kill——被拒命中【全静默】=零掷流（DamageVar :12970/TryConsuming
    //  TimerCrit :12928 亦在门后）+不写任何免疫行+弹存活续漂等窗清重试（孢子云 567/568
    //  空迸气案：曾 hurt 返 false 仍计数→云亡+气团带同伤迸出）。门置于 cd.ready【前】
    //  =被拒不落账（原版免疫梯全在 :13702 后,被拒不写行;无需 release 回滚支）。
    //  判别位选型备案：不消费 Enemy.hurt 布尔返——其语义=【击杀】非「命中」（死亡管线
    //  true :14857/存活受击 false :14866/已实扣转演出支亦 false：realLife 头死/月总
    //  396-398 :14289/猪鲨泡 371 :14296/石巨人头 246/四塔转 ai2）,原版这些返返 num41>0
    //  全数计击——布尔直读会把全体存活受击误判拒收（变异 M3 实证红:sw-fx1 4 测+
    //  batch-c 桩件族）;已实扣判别
    //  面由 Enemy.lastStrikeDealt（num41 等价 :1507/:14111）承载,见 tests/sw-fx1
    //  「hurt 已实扣 false 返仍计击」守卫锚。
    if (gate) {
      // ★ownerHitCheck 整门（Damage_PVE_Inner :12657 `flag4 || (!targetNPC.noTileCollide
      //  && ownerHitCheck && !CanHitWithMeleeWeapon(targetNPC))`）——noTileCollide 目标
      //  距离+LOS 两段【全豁免】;共享命中表门在外环（:12596）,不受此豁免
      if ((e as unknown as { noTileCollide?: boolean }).noTileCollide === true) {
        // usesOwnerMeleeHitCD：玩家近战命中表已记该敌 → 本弹跳过（:12596 flag2=false）
        if (gate.sharedHits?.has(e.id)) continue;
      } else {
        // 距离段（CanHitWithMeleeWeapon :12417-12419）：Distance(ent.Center) > N →
        // 不命中。★R2-F1+F10（2026-09-03）：原版 Distance 基准 = 【弹体自身】Center
        // （实例方法 `this.Distance(ent.Center)`= Center↔敌心；Projectile.cs:42781
        //  1126 Center=RRP−velocity / 1129 盒心=砸地位）——曾传玩家中心=基准错位,
        //  弹体远离玩家时本应照结算的近距敌被误拒。LOS 段保持 owner 玩家基准
        //  （:12420-12425 字面就是 Main.player[owner]↔ent,勿动）
        if (Math.hypot(e.x + e.w / 2 - self.cx, e.y + e.h / 2 - self.cy) > gate.maxDist) continue;
        // LOS 段（:12420-12425）：A 段整盒 Collision.CanHit + B/C/D 手位三射线
        // CanHitLine——四探针任一通过即放行（Player.CanHit(Entity) :42857-65 字面同式）
        if (gate.los && !gate.los(e)) continue;
        // usesOwnerMeleeHitCD：玩家近战命中表已记该敌 → 本弹跳过（:12596 flag2=false）
        if (gate.sharedHits?.has(e.id)) continue;
      }
    }
    if (!(self.x < e.x + e.w && self.x + self.w > e.x && self.y < e.y + e.h && self.y + self.h > e.y)) continue;
    // ★S2 拆相（R1-C 落刀,2026-09-30）：原档 cd.ready【读+写】融于本位——充能水母
    //  被电/被拒拍即消费冷却行（HitCdImpl/IdStaticSharedTable 皆读时写）,而原版表读
    //  在外环 flag2（:12596,无副作用）、写梯在 :14031-14038（水母块 return :12687
    //  之后的受里面深位）⇒ 充能水母接触路径原版零落账（zap 每拍可达,受玩家 Hurt
    //  免疫限频;解充能后无节流残留）。拆相：本位只 peek（≙外环 flag2 读面）,
    //  commit 移至命中收尾（下方 onHit 后=写梯原位）。
    if (!cd.peek(e.id)) continue;
    // ★水母块（Damage_PVE_Inner :12676-12688 内层 1:1）：充能态（dontTakeDamage）水母
    //  不受伤——外环 :12600 豁免只做两件事：①接触族弹幕（aiStyle 19/161/75/140 ||
    //  IsAWhip || AllowsContactDamageFromJellyfish{972,982,984,997,1043}）命中 →
    //  TakeDamageFromJellyfish 电玩家（近战 Player.cs:44620 / 弹幕 :12682 共用同一
    //  方法,本仓 Game.takeDamageFromJellyfish 单源）;②随后 `if (dontTakeDamage)
    //  return` 拦掉本次伤害。非充能水母（zapJelly && !jellyDontTake）不进本块,照常
    //  受伤。原版 immune 窗门（:12650）先于水母块 ⇒ 本块置 cd 读门后同拍。
    //  ★R1-C 已落刀（清偿刀 S2,2026-09-30）：cd 拆 peek/commit 两相——本块上方只
    //  peek（≙外环 flag2 读 :12596,无副作用）,commit 移至命中收尾（写梯 :14031 位）。
    //  充能水母接触路径（本块 continue）零落账=原版 return :12687 同构;zap 每拍可达
    //  （TakeDamageFromJellyfish 限频=玩家 Hurt 免疫+meleeNpcCd/attackCD 双面,原版
    //  Player.cs:44607-44612 同构）。现役可观测成员:1127（aiStyle 161∈{19,161,75,140}）
    //  ——1126 aiStyle 190 非接触族（旧登记「1126/1127 接触族」系误并,S2 勘）;482/
    //  567-571/227/花瓣/1128/1129 等非接触族本块不可达,拆相前后同值。
    //  GAP 登记：同款外环门+水母块在 Arrow 主命中环 / WhipProj.tryHit 环未接（两环
    //  现状=整靶跳过,伤害面与原版同值,仅缺接触族反噬电击——鞭 IsAWhip 属接触族）
    if (zapJelly && jellyDontTake) {
      const zapAi = projectileData(self.projId)?.aiStyle;
      if (jellyZapProjectile(self.projId, zapAi)) {
        game.takeDamageFromJellyfish?.(ent);
      }
      continue;
    }
    // ★F11：蓄能暴击强制面（TryConsumingTimerCrit，Damage_PVE :12928 同位）
    // ★BJ475③ 掷中照消费（原版序 :12915-12928 亲读）：三类掷在前 →
    //  TryConsumingTimerCrit 【无条件】消费——前掷已 crit 照消费（charge>0 置
    //  −15 :28568-71）;旧 `roll || consume` 短路=掷中拍【跳过】消费,
    //  charge 残留满蓄（原版前掷照吃,蓄能节拍=独立于掷流）。
    //  武僧掷 :12929-43 形位=本面弹族（1126-1129）非 688 族恒假,不设（proj1457
    //  不引 MinionProj 单源,零 RNG 零依赖=同值形）。
    // ★BJ482②（2026-10-03）掷率装配面落刀：rollCrit 由 `Math.random() <
    //  self.critChance`（类字段固定 4% 档,BJ467② 遗留"掷率面不在本刀"）改
    //  rollVanillaHitCrit=owner 装配查询（:12915-12927 三类掷,率=0.04+装备/buff
    //  聚合/100,动态装备面;无类旗 908/226/221/227 归零;1126-1129=melee 旗、
    //  482/704/731/439/440/950/1115/1116=magic 旗）。self.critChance≤0 关断语义
    //  保留（旧掷式对 ≤0 本就恒假=确定性关断钉,r1/s2/bj420 测试锚同相）——
    //  `>0` 门=既有语义显式化,非新发明;spawn 位 critTotal/arcCrit 组合载体
    //  退为死写（登记 BJ482② 报告,勿再消费）。
    const rollCrit = self.critChance > 0 && rollVanillaHitCrit(self.projId, game);
    const timerCritF11 = ((game.player as unknown as { tryConsumingTimerCrit?: (g: unknown, x: number, y: number, w: number, h: number) => boolean } | null)?.tryConsumingTimerCrit?.(game, e.x, e.y, e.w, e.h) ?? false);
    const crit = rollCrit || timerCritF11;
    // ★F1（2026-08-31 蓝队三批）：Damage_PVE :13388 攻端旗乘区 + ★F9 DamageVar 单源
    //   （原版序：DamageVar(:12970;★SW-AB1 2026-09-04 引注校准:旧 1456 锚 :12959) → …→ banner(:13388) → armorPen 弹侧 :13685
    //   `dmg += targetNPC.checkArmorPenetration(num6, armorPenetrationPercent)`（SW-AJ1 2026-09-05 校准,旧 :13679 系 type22 kb 向支）在
    //   banner 后 ⇒ 不吃旗乘——armorPen 独立参传，此处序一致）。
    //   crit 翻倍沿用仓内调用侧预倍惯例（与 Enemy.hurt 内 (int)Math.Max(1,×2)
    //   截断式同值）。
    let dmg = damageVarRoll(self.damage,
      ((game.player as unknown as { luck?: number } | null)?.luck) ?? 0);
    // ★BJ286：per-target 伤害调整尾参（Projectile.Damage 段内逐型算式的挂点——
    //  首位消费者 = 482 诅咒焰墙蠕形减半 :12983 `dmg /= 2`，序在 DamageVar(:12970)
    //  后、banner(:13388)/暴击翻倍前 = 原文序）。既有调用零传参零变化。
    if (damageAdj) dmg = damageAdj(e, dmg);
    // ★刀4-A(2026-10-13):玩家弹幕命中 NPC 伤害修正链(ModifyHitNPCWithProj 形;倍率连乘;
    //  位=damageAdj 后/banner 前=弹侧 ModifyHit 统一位;空 mod=size===0 恒等)
    dmg = runModModifyHitNpcByProj(game.player, game, self.projId,
      (e as unknown as { vanillaId?: number }).vanillaId ?? -1, dmg, crit);
    dmg = applyBannerDamageDealt(game, e, dmg);
    // ★BJ716-A（R18-F1，2026-10-25）：expert EoW 虫段 /5（Projectile.cs:13392-13398）
    //  ——banner(:13388-90) 后、crit 翻倍（StrikeNPC 内）前原位;20 弹型表×NPC 13-15
    //  （表=EXPERT_EOW_FIFTH_PROJS 弹域单源,与 Game.explodeNpcDamageChain 爆炸 face
    //  同源——旧仅爆炸 face 有此臂,281 兔爆/蜂族经 dealContacts 的直击面全 5× 超伤）
    dmg = expertEowFifthDmg(dmg, self.projId, (e as unknown as { vanillaId?: number }).vanillaId, game.world);
    dmg *= crit ? 2 : 1;
    // ★F3 接线（蓝队四轮）：焰爆石+拍击石弹幕双支（Projectile.cs:13439-13446）——
    // 本共享结算面承载 1126/1127/1128/1129 等 1457 近战系新弹（数据面 melee），
    // 类门+触发统一走 projectileSnapStrikeBonus 单源；返回 num14 加伤在 banner 采样
    // 之后并入（原版加伤 :14451 晚于 banner :13388-13390;SW-AJ1 2026-09-05 校准,旧 :14457/:13387）→ 不再吃旗乘区,随暴击已并 ×2。
    const snapBonus1457 = projectileSnapStrikeBonus(game, self,
      (e as unknown as { cx?: number }).cx ?? e.x + e.w / 2,
      (e as unknown as { cy?: number }).cy ?? e.y + e.h / 2,
      e.id, {
        victimBox: { w: e.w, h: e.h, cx: (e as unknown as { cx?: number }).cx ?? e.x + e.w / 2,
          cy: (e as unknown as { cy?: number }).cy ?? e.y + e.h / 2 },
        targeterBox: { x: self.x, y: self.y, w: self.w, h: self.h },
      });
    if (snapBonus1457 > 0) dmg += Math.trunc(snapBonus1457 * (crit ? 2 : 1));
    const kdir = Math.sign((e.x + e.w / 2) - self.cx) || 1;
    // srcProjId 尾参：on-hit 产出弹族经 TryDoingOnHitEffects 排除表断 OnHit 链
    //（免疫门已在上收编——被拒敌到不了此处;★勿改为消费 hurt 布尔返作拒收判别:
    //  其语义=击杀非命中,存活受击返 false 会把已结算面整段误杀,见上判别位选型备案）
    e.hurt(dmg, kdir * self.knockback, 0, game, self.armorPen, crit, hitPierce, true, 0, self.projId);   // 音/飘值=单点;fromPlayer=DPS 计(Projectile.cs:13709)
    // + 催化指环 6185（StatusNPC :11192-11196,玩家弹命中 398 300t;同 Arrow.ts:3260 先例）
    applyProjStatus(self.projId, ent as unknown as Record<string, number>,
      { catalystBand: ((game.player as unknown as { equipStats?: { catalystBand?: boolean } } | null)?.equipStats?.catalystBand) === true });
    // 命中回写共享表（StrikeNPC :14343 SetMeleeHitCooldown——玩家挥击弧同帧不再结算）
    gate?.sharedHits?.add(e.id);
    onHit?.(ent as unknown as HitTarget);
    // ★S2 拆相（R1-C）：受理写梯位（:14031-14038 usesIDStatic 支/:14168-14173
    //  usesLocal 支——原版写梯在 on-hit 效果 :13642 与 StrikeNPC :13701 之后=受里面
    //  深位,水母块 return :12687 使拒收/电击拍零落账）。stopAfterFirstHit 前置=首
    //  命中即亡弹照落账（penetrate 递减 :14186 在写梯后,同序）。
    cd.commit(e.id, cooldown);
    if (stopAfterFirstHit) return;       // keepIterating=false（:14200——首命中即止,同拍不再遍历后继敌怪）
  }
}

/** 弹体 CutTiles 助手已迁至 ProjCutTiles.ts（全仓单点——Monk/SkyDragon 族同用） */
import { cutTilesBox } from './ProjCutTiles';

// ================= 1126 叶绿巨剑刃（AI_190 旋刃,1226 重做本体） =================

/** 1226 出手链（Player.cs:49406-49426）：NewProjectile(MountedCenter, (dir, 0|1), 1126,
 *  Damage, KnockBack, ai0=dir×gravDir, ai1=itemAnimationMax, ai2=itemScale)。
 *  奖励击（chlorophyteBladeCounter 空）伤 ×1.5/击退 ×1.25 且水平出手 (dir,0)；
 *  普通击向下 (dir,1)。AI_190（:42734-43000）：
 *   - 首帧 localAI[2] = (velocity.Y==0)；velocity.Y 清零（:42741-42745）
 *   - num = localAI[0]/ai[1]；rotation = π·ai0·num + velocity.ToRotation() + ai0·π（:42748）
 *   - scale = (0.85 + num×0.6)×ai[2]（:42756 num6=0.85/num5=0.62 + :42995 ×ai[2]）
 *   - Center = player.RotatedRelativePoint(MountedCenter) − velocity（:42757）
 *   - 挥击尾孢子（:42924-42947，与 localAI[2] 无关）：num≤0.8 期间每帧掷
 *     Remap(meleeSpeed,1,1/3,4,2)==0 出一颗 1128（伤 ×0.75、ai1=90+rand(60)）；
 *     :42933-42938 两处 localAI[1] 保底分支为死代码（全函数无 localAI[1] 写，恒 0
 *     → localAI[0]==0 永假）——勿再读成保底帧（蓝队 R2-07 勘误）
 *   - 砸地孢子云（:42763-42820，仅 localAI[2]==1 水平击）：num≥0.8 首帧在刃尖前方
 *     FindChlorophyteSporeCloudSpawn（:42565）找 solid 台面 → onSlamCloud 回调
 *   - num≥1 Kill（:42997-43000） */
export class ChloroClaymoreBlade extends Entity {
  w = 16; h = 16;
  damage: number;
  knockback: number;
  critChance = 0.04;
  armorPen = 0;
  meleeProj = true;
  dead = false;
  readonly projId = 1126;
  /** ai[0] = 出手方向 ±1（rotation/孢子搜索侧向共用） */
  private readonly dir: number;
  /** ai[1] = itemAnimationMax（进度分母=寿命） */
  private readonly animMax: number;
  /** ai[2] = 物品 scale（终态乘区） */
  private readonly itemScale: number;
  /** localAI[2]：1=水平（奖励）击——砸地孢子云唯一门 */
  private readonly horizontal: boolean;
  private age = 0;              // localAI[0]
  private rot = 0;
  private scl = 0.85;
  private cloudFired = false;   // num≥0.8 单次门（num14<num11 比较）
  private hitCd = new HitCdImpl();  // usesLocalNPCImmunity + localNPCHitCooldown −1（:10550-10556）
  /** usesOwnerMeleeHitCD 共享命中表（:10556 → Game 注入玩家挥击 swingHitSet——
   *  同一挥击内弧+刃对同敌只结算一次；蓝队 R2-08） */
  sharedMeleeHits: Set<number> | null = null;
  /** 挥击尾孢子生成（Game 注入：NewProjectile 1128——伤 ×0.75 已在 Game 侧折算） */
  spawnSpore: (x: number, y: number, vx: number, vy: number, life: number) => void = () => {};
  /** 砸地孢子云生成（Game 注入：FindChlorophyteSporeCloudSpawn+SpawnChlorophyteSporeCloud） */
  spawnSlamCloud: (tipX: number, tipY: number) => void = () => {};

  constructor(cx: number, cy: number, dir: number, down: number, damage: number, knockback: number,
    animMax: number, itemScale: number) {
    super();
    this.dir = dir;
    this.animMax = Math.max(1, animMax);
    this.itemScale = itemScale || 1;
    this.horizontal = down === 0;      // :42741-42743 localAI[2]=(velocity.Y==0)
    this.vx = dir; this.vy = 0;        // :42745 velocity.Y=0（方向仅进 rotation/搜索侧向）
    this.damage = Math.max(1, Math.round(damage));
    this.knockback = knockback;
    this.x = cx - this.w / 2 - this.vx; // Center=RotatedRelativePoint(MountedCenter)−velocity（:42757）
    this.y = cy - this.h / 2 - this.vy;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    const p = game.player;
    this.age++;
    const num = this.age / this.animMax;                        // :42747
    // rotation = π·ai0·num + velocity.ToRotation() + ai0·π（:42748-42750；fullRotation 本仓恒 0）
    this.rot = Math.PI * this.dir * num + Math.atan2(this.vy, this.vx) + this.dir * Math.PI;
    this.scl = (0.85 + num * 0.6) * this.itemScale;             // :42756+:42995
    // Center 跟手（:42757 RotatedRelativePoint≈MountedCenter——本仓无全身旋转）
    this.x = p.cx - this.vx;
    this.y = p.cy - this.vy;
    // 刃尖方向（:42806-42807 同构）：rotation + Remap(0.8,0,1,0,π/4)×ai0
    const tipAng = this.rot + (Math.PI / 8) * this.dir * Math.min(1, Math.max(0, (num - 0.8) / 0.2 + 0.8));
    const tipDist = (170 * 0.5 - 4) * this.scl;                 // num15（:42770）
    const tipX = this.cx + Math.cos(this.rot + (Math.PI / 8) * this.dir) * tipDist;
    const tipY = this.cy + Math.sin(this.rot + (Math.PI / 8) * this.dir) * tipDist;
    void tipAng;
    // ---- 砸地孢子云（:42763-42820，仅水平击；num≥0.8 首帧） ----
    if (this.horizontal && !this.cloudFired && num >= 0.8) {
      this.cloudFired = true;
      this.spawnSlamCloud(tipX, tipY);
    }
    // ---- 挥击尾孢子（:42924-42947，两态都撒） ----
    if (num <= 0.8 && this.spawnSpore) {
      // ★R17-F2（2026-10-12）：Remap 实参 = meleeSpeed 字段 = CapAttackSpeeds 倒数档 M
      //  （Player.cs:42928 `Remap(player.meleeSpeed,1f,1/3f,4f,2f)` 直读字段——本仓
      //  attackSpeedMult 即 M,直取;Game.ts:21609 1127 同款先例。旧式 1/M=攻速和,
      //  正攻速加成下恒饱和 remap=4,掷率不随攻速升=双重还原）。(int) 截断取整。
      const ms = p.attackSpeedMult > 0 ? p.attackSpeedMult : 1;   // meleeSpeed=M 直取
      const remap = 4 + (2 - 4) * Math.min(1, Math.max(0, (ms - 1) / (1 / 3 - 1)));  // Remap(ms,1,1/3,4,2)
      // ★:42933-42938 的两处 `localAI[0]==localAI[1]/3` "保底帧"是死代码——AI_190
      //  （:42734-43002）全函数无 localAI[1] 赋值（恒 0 → 条件要求 localAI[0]==0，
      //  而首帧自增后 ≥1 永假）。原版孢子纯靠每帧 Next(Remap(meleeSpeed,1,1/3,4,2))==0
      //  掷。蓝队 R2-07：曾把死分支读成 animMax/3、2animMax/3 保底必出，孢子密度虚高
      if (Math.floor(Math.random() * Math.max(1, Math.trunc(remap))) === 0) {   // (int) 截断（R17-F2）
        // :42926 vector9 = player.velocity×0.77 + vector7×5（vector7=随机侧向单位向量）
        const side = this.rot + (Math.random() * 2 - 1) * (Math.PI / 2) * 0.7 + this.dir * Math.PI / 2;
        const svx = p.vx * 0.77 + Math.cos(side) * 5;
        const svy = p.vy * 0.77 + Math.sin(side) * 5;
        const posAng = this.rot + ((-Math.PI / 4) * (1 - Math.min(1, num / 0.8))
          + (Math.PI / 4) * Math.min(1, num / 0.8)) * this.dir;    // :42930 num26+Remap(num,0,1,0,π/4)
        const lerpDist = tipDist * (0.5 + 0.5 * Math.min(1, num / 0.8));  // :42928-42929 Lerp(半,全)
        this.spawnSpore(this.cx + Math.cos(posAng) * lerpDist, this.cy + Math.sin(posAng) * lerpDist,
          svx, svy, 90 + Math.floor(Math.random() * 60));
      }
    }
    // ---- 命中（usesLocalNPCImmunity + cooldown −1 :10550-10556）----
    // ownerHitCheck + ownerHitCheckDistance=300（:10554-10555）+ LOS 四探针段
    // （CanHitWithMeleeWeapon :12415-12425——距离+LOS 双段经 dealContacts gate,
    // 距离基准=弹体 Center（:42781 Center=RRP−velocity）,LOS 基准=owner 玩家,
    // noTileCollide 目标整门豁免 :12657）;usesOwnerMeleeHitCD（:10556）→ 与玩家
    // 挥击共享命中表。★观测面注：本弹伤害盒=玩家中心 16×16（Center=RRP−velocity
    // :42781）——敌怪须与玩家盒重叠才进结算,此时四探针几何上恒通（墙无法插入
    // 玩家自身盒内）,LOS 段对 1126 实际不可达,接线为 1:1 保真非观测差异
    // ★BJ383 小动物命中面（BJ381 登记债清偿）：1126 friendly penetrate=−1（:10552）
    //  → 原版 critter 照伤弹不亡（Damage_PVE_Inner :12618 flag=!friendly 恒真;
    //  :14184 penetrate>0 才递减）。桶序先小动物（MagicProj 形态同构）。
    //  ★登记：critter 面无 ownerHitCheck 门（hitCritters 单源无 gate 参）——对与
    //  刃盒重叠的小动物,距离300+LOS 几何上恒通（刃=玩家手持位,同上观测面注）,
    //  观测面等价。非 magic（SetDefaults :10545-10556 无 magic 行）→ 无幽灵兜帽
    //  吸血,不接 proc。
    hitCritters(this, game);
    dealContacts(this, game, this.hitCd, -1, undefined,
      { maxDist: 300, sharedHits: this.sharedMeleeHits ?? undefined,
        los: ownerMeleeWeaponLOS(game) });
    // CutTiles（aiStyle190||191 线支 :15341-15343）：PlotTileLine(Center+v(rot−π/4)*60*scale,
    // Center+v(rot+π/4)*60*scale, width=60×scale)——★A⑤ 转正：带状全扫（cutThickTileLine）
    // 替换旧"端+中三采样窗"近似,中段草再不漏砍
    {
      const r60 = 60 * this.itemScale;
      const a0 = this.rot - Math.PI / 4, a1 = this.rot + Math.PI / 4;
      cutThickTileLine(game,
        this.cx + Math.cos(a0) * r60, this.cy + Math.sin(a0) * r60,
        this.cx + Math.cos(a1) * r60, this.cy + Math.sin(a1) * r60,
        r60);
    }
    // ---- 绿光（:42944-42950）----
    // ★BJ206 2026-09-20 备案（定谳登记,未落刀）：原版 :42944 `Color value5 = new
    //  Color(0, 96, 0)`（=分量 0.376）且 :42945-42948 `localAI[2]==1` 时
    //  Lerp(value5, (34,128,0), num) 有第二变体,本仓恒 (0,0.42,0) 常量——绿通道
    //  偏亮 ~11.6% 且缺 localAI[2] 渐变支。观感面微偏差,故按批准则登记不落刀。
    game.addLightAt?.(this.cx, this.cy, 0, 0.42, 0);
    if (num >= 1) this.dead = true;                              // :42997-43000
  }

  draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    const img = projSprite(1126);
    if (!ctx) return;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.rot + Math.PI / 2);   // DrawProjDirect 旋刃贴图竖条（origin 中心）
    ctx.imageSmoothingEnabled = false;
    if (img && img.width > 0) {
      const dw = 170 * this.scl;          // 贴图原宽 170（Projectile_1126.png）×scale
      ctx.drawImage(img, -dw / 2, -dw * (img.height / img.width) / 2, dw, dw * (img.height / img.width));
    } else {
      ctx.fillStyle = '#3FA050';
      ctx.fillRect(-84 * this.scl, -4, 168 * this.scl, 8);
    }
    ctx.restore();
  }
}

// ================= 1127 叶绿军刃刺（AI_161 1127 支,1227 重做本体） =================

/** 1227 出手链（Player.cs:47745-47756 + 通用尾段 :49957）：velocity =
 *  aim单位向量.RotatedBy(0.65×Remap(meleeSpeed,1,1/3,1,0.25)×(rand−0.5))
 *  ×(aim长 − randDirection×0.5)；ai[1] = meleeSpeed（AI_161 :48492-48500 全部
 *  节奏参数 ×ai[1]——★反编译出生点 ai13=0 与 AI 语义矛盾,按 AI 侧读数取
 *  meleeSpeed：寿命 16ms+5 / 淡入 7ms / 淡出起 12ms / 位移钳 16ms,即官方
 *  "穿刺范围随攻速成长"）。AI_161（:48483-48560）：
 *   - rotation = velocity.ToRotation()+π/2；Center = MountedCenter + velocity×(ai0−1)
 *     + (rotation−π/2) 向 ×10（:48505-48508 1127 专属垂直偏移）
 *   - Opacity = GetLerpValue(0,7ms,ai0)×GetLerpValue(16ms+5,12ms,ai0)
 *   - ai0≥16ms+5 Kill；heldProj=本体；尘 157 + Item1 每 12t（:48522-48545）
 *   - 命中：usesLocalNPCImmunity + localNPCHitCooldown −1（:10563-10565）→ 每敌一次；
 *     StatusNPC 397 孢子侵染 300t（:11729-11732,projstatus 表已登记） */
export class ChloroSaberStab extends Entity {
  w = 18; h = 18;
  damage: number;
  knockback: number;
  critChance = 0.04;
  armorPen = 0;
  meleeProj = true;
  dead = false;
  readonly projId = 1127;
  // ---- ★通用湿段（:16903-17113;ProjWetFlags 共享体——1127 block :10561-10566 经
  //  DefaultToShortsword 无 ignoreWater 行 = 受段。溅花湿段逐拍跑;阻尼 N/A：
  //  tileCollide=false :10563 → HandleMovement :17581 阻尼块整跳（wetVelocity≡velocity），
  //  且 AI_161 :48503-48508 每拍自玩家锚【直写】Center（本仓 :610-611 同源）= AI 直写位,
  //  无 velocity 积分位移行可乘——留锚禁硬安）----
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984 置 10 / :17109-17112 逐拍 −1） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价——首拍 AI 后/位移前同位） */
  presetDone = false;
  /** 出手单位向量（原版 velocity 归一）与速度模长 */
  private readonly dx: number;
  private readonly dy: number;
  private readonly spd: number;
  private readonly ms: number;   // ai[1] = meleeSpeed
  private t = 0;
  private rot = 0;
  private hitCd = new HitCdImpl();

  constructor(dirX: number, dirY: number, speed: number, meleeSpeed: number,
    damage: number, knockback: number) {
    super();
    const n = Math.hypot(dirX, dirY) || 1;
    this.dx = dirX / n;
    this.dy = dirY / n;
    this.spd = speed;
    this.ms = meleeSpeed > 0 ? meleeSpeed : 1;
    this.damage = Math.max(1, Math.round(damage));
    this.knockback = knockback;
    this.rot = Math.atan2(this.dy, this.dx) + Math.PI / 2;   // :48486
    this.x = 0; this.y = 0;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    this.wetSectionRan = false;                        // ⑥杀拍配方:每拍头重置（Arrow.ts 同款）
    const p = game.player;
    this.t++;
    const life = Math.round(16 * this.ms) + 5;                 // num（:48492）
    const fadeOut = Math.round(12 * this.ms);                  // num2（:48495）
    const fadeIn = Math.max(1, Math.round(7 * this.ms));       // num3（:48494）
    const adv = Math.min(this.t, Math.round(16 * this.ms));    // num4（:48493 Min(ai0,16ms)）
    // Center = MountedCenter + velocity×(adv−1) + (rotation−π/2) 向 ×10（:48503-48508）
    const px = Math.cos(this.rot - Math.PI / 2) * 10;
    const py = Math.sin(this.rot - Math.PI / 2) * 10;
    this.x = p.cx + this.dx * this.spd * (adv - 1) + px - this.w / 2;
    this.y = p.cy + this.dy * this.spd * (adv - 1) + py - this.h / 2;
    // 朝向随出手向量（:48510-48512 spriteDirection；:48496-48499 1127 ChangeDir）
    if (this.dx !== 0) p.facing = this.dx > 0 ? 1 : -1;
    if (this.t >= life) {
      // ★⑥杀拍口径（2026-09-06,Arrow.ts wetSectionStep 配方推广到本类）：原版
      //  Update 对湿段【无 active 门】——AI(:16880 `if (active)`)内 Kill（active=false）
      //  当拍湿段(:16895 `if (!ignoreWater)`)照跑（旗刷新/溅花/wetCount 维护）,`!active`
      //  门在 HandleMovement(:17120) 之后 :17132 才生效、只拦 Damage 管线。本仓杀拍
      //  `dead=true; return` 曾整体跳过湿段=杀拍溅花缺口（寿命尽拍恰入水,原版溅、
      //  本仓不溅）。修法照 Arrow.ts 配方:wetSectionStep 双调用点（杀拍补跑此处 +
      //  活拍=subStepAI 等价尾原位）+ wetSectionRan 防同拍双跑;死亡拍 CutTiles/尘/
      //  命中仍跳过（Kill FX 已在杀位结死,本类无位移行,湿段采样位=锚位不变,登记
      //  与 Arrow 死拍同款"死拍位移零观感"口径）。1127 无 Kill FX/Kill 管线（消亡=
      //  dead 布尔置位）且不接湿段 kill 钩（非 IsDestroyedByWater 六型）→ Arrow 的
      //  killNow 头幂等门在此无对应面,dead 布尔即幂等门（登记）。
      this.dead = true;
      this.wetSectionStep(game);
      return;
    }
    // CutTiles（802/842/938-945/1127 线支 :15326-15331）：PlotTileLine(Center,
    // Center+SafeNormalize(velocity,−UnitY)×88f, width=10×scale)——★A⑤ 转正：
    // 全程带扫替换旧"单点刃尖"近似
    {
      const vl = Math.hypot(this.dx * this.spd, this.dy * this.spd) || 1;
      const cdx = vl > 0.001 ? (this.dx * this.spd) / vl : 0;   // SafeNormalize(−UnitY 回退)
      const cdy = vl > 0.001 ? (this.dy * this.spd) / vl : -1;
      cutThickTileLine(game, this.cx, this.cy, this.cx + cdx * 88, this.cy + cdy * 88, 10);
    }
    // 尘 157 + Item1 每 12t（:48522-48545；音效本仓 Item_1）
    if (this.t % 12 === 1) game.playSfxAt?.('hit', this.cx, this.cy);
    game.spawnParticles(this.cx, this.cy, '#4C8C3C', 2, 1.2, { life: 16, grav: 0, damp: 0.9 });
    // ---- ★通用湿段（:16895-17113）——原版 Update 位序 AI(:16880) → 湿段(:16895) →
    // HandleMovement(:17120) → Damage(:17184)。本类 AI 退化=锚位重算+尘（无湿旗消费者）,
    // 段插 AI 尾（cutTiles/尘后）/Damage 前 = 原版同位;采样位=AI 直写锚位（原版"AI 后
    // 未移动位"同构——本类不建模 HandleMovement 的 `position += velocity` 叠加,登记既有近似）。
    // 溅花尘/音由共享体 wetSplashStepShared 承载,不自写。ignoreWater 按数据面传（1127 缺行
    // =不豁免;数据驱动防未来 id 复用本类）。
    this.wetSectionStep(game);
    // ★BJ383 小动物命中面（BJ381 登记债清偿）：1127 经 DefaultToShortsword
    //  （:10775-10788）friendly penetrate=−1 → 原版 critter 照伤弹不亡（:12618/
    //  :14184 同 1126 判）。非 magic → 无幽灵兜帽吸血,不接 proc。
    hitCritters(this, game);
    dealContacts(this, game, this.hitCd, -1);
  }

  /** 通用湿段单点封装（⑥杀拍口径双调用点共用;wetSectionRan=同拍防双跑,Arrow.ts
   *  同名配方——本类杀位在段位【前】,活拍路径无补跑面,旗照配方挂全防未来杀位
   *  后移破防双跑）。 */
  private wetSectionRan = false;

  private wetSectionStep(game: GameHooks): void {
    this.wetSectionRan = true;
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater);
  }

  draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const img = projSprite(1127);
    const life = Math.round(16 * this.ms) + 5;
    const fadeOut = Math.round(12 * this.ms);
    const fadeIn = Math.max(1, Math.round(7 * this.ms));
    // Opacity = GetLerpValue(0,fadeIn,t)×GetLerpValue(life,fadeOut,t)（:48501-48502 clamped）
    const aIn = Math.min(1, this.t / fadeIn);
    const aOut = this.t <= fadeOut ? 1 : Math.max(0, (life - this.t) / (life - fadeOut));
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, aIn * aOut));
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.rot);
    const sd = this.dx >= 0 ? 1 : -1;                          // spriteDirection=sign(vx)（:48510）
    if (sd === -1) ctx.scale(-1, 1);
    ctx.imageSmoothingEnabled = false;
    if (img && img.width > 0) {
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
    } else {
      ctx.fillStyle = '#3FA050';
      ctx.fillRect(-9, -40, 18, 80);
    }
    ctx.restore();
  }
}

// ================= 1128 叶绿孢子云（aiStyle 92 flag46 支） =================

/** SpawnChlorophyteSporeCloud 撒下的漂浮孢子（Projectile.cs:33143-33405 flag46）：
 *  - ai[1] = 出生传入寿命：挥击尾孢子 90+rand(60)/砸地大云缺省 0 → num796=220（:33171）
 *  - ★L2 转正（三处,锚 Terarria1458 P.cs,1457 同值）：①`ai[0]++; if(ai[1]>=1f) ai[0]+=2f`
 *    （AI_92 :33167-33170）——尾孢子每拍老去 3 帧即【1/3 实效寿命】;②Damage_CanDealDamage
 *    :12463 `(type==1128 && ai[1]>=1f)` → 尾孢子纯视觉零伤,只有 ai[1]==0 的砸地大云结算;
 *    ③免疫面 usesIDStaticNPCImmunity + idStaticNPCHitCooldown=30（SetDefaults :10574-10575,
 *    immunityIdentity 缺省=型 :784）→ 全场 1128 一张表（ID_STATIC_1128_TABLE）
 *  - scale = Remap(t/T,0,0.1,0.25,1.1)；盒 = 30×scale/1.1 居中回写（:33182-33188）
 *  - Opacity = Remap(T,0,0.25,0,1)×Remap(T,0.5,1,1,0)×0.75；vy −= 0.01（上飘）、×0.97
 *  - 同型互斥（:33268-33300 互推 0.005）；撞实心点反弹（简化=停,登记） */
export class ChloroSporeCloud extends Entity {
  damage: number;
  knockback = 0;
  critChance = 0.04;
  armorPen = 0;
  meleeProj = true;
  dead = false;
  readonly projId = 1128;
  // ---- ★通用湿段（:16903-17113;ProjWetFlags 共享体——1128 block :10567-10581 无
  //  ignoreWater 行 = 受段。溅花湿段逐拍跑;阻尼 N/A：tileCollide=false :10569 →
  //  HandleMovement :17581 阻尼块整跳（wetVelocity≡velocity,UpdatePosition :20551
  //  `position += velocity` 无水减）——AI_92 flag46 支 :33182-33206 自算盒/速度衰减,
  //  湿段只吃旗不吃位移,留锚禁硬安）----
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984 置 10 / :17109-17112 逐拍 −1） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价——首拍 AI 后/位移前同位） */
  presetDone = false;
  /** num796（:33173-33177 ai[1]==0 → 220） */
  private readonly life: number;
  /** ai[1] 原值（>=1 → 纯视觉零伤 + 老化 ×3;==0 → 结算云） */
  private readonly ai1: number;
  /** ai[0]（老化计数,步长 1 或 3） */
  private t = 0;
  private readonly spawnFrame = Math.floor(Math.random() * 5);   // :33149 frame=rand(frames)
  private hitCd = ID_STATIC_1128_TABLE;

  constructor(cx: number, cy: number, vx: number, vy: number, damage: number, life: number) {
    super();
    this.w = 30; this.h = 30;
    this.x = cx - this.w / 2; this.y = cy - this.h / 2;
    this.vx = vx; this.vy = vy;
    this.damage = Math.max(1, Math.round(damage));
    this.ai1 = life;
    this.life = life > 0 ? life : 220;                          // :33168 ai[1]==0 → 220
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    this.t++;
    if (this.ai1 >= 1) this.t += 2;                             // :33168-33170 加速老化(尾孢子)
    if (this.t > this.life) { this.dead = true; return; }       // :33179-33183
    const T = this.t / this.life;
    const scl = 0.25 + (1.1 - 0.25) * Math.min(1, T / 0.1);     // :33182
    const side = 30 * scl / 1.1;                                // :33184-33186
    this.x += this.cx - side / 2 - this.x; this.y += this.cy - side / 2 - this.y;
    this.w = side; this.h = side;
    this.vy -= 0.01;                                            // :33189
    this.vx *= 0.97; this.vy *= 0.97;                           // :33206 flag46 档
    // ---- ★通用湿段（:16903-17113）——AI（盒重算+速度衰减）后/位移前 = 原版 Update
    // 同序;采样盒 = 当拍重算后 w/h（湿段逐拍读位与盒,原版同构）。溅花尘/音由共享体
    // wetSplashStepShared 承载;阻尼 N/A 见字段块注（tileCollide=false :10569）。
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater);
    this.x += this.vx; this.y += this.vy;
    // 撞实心点 → 静止（原版 :33306-33405 多向反弹,云体低速近似=贴壁悬停）
    const st = game.world.store;
    const tx = Math.floor((this.cx + Math.sign(this.vx) * 16) / TILE);
    const ty = Math.floor((this.cy + Math.sign(this.vy) * 16) / TILE);
    if (st.inBounds(tx, ty) && st.isSolid(tx, ty)) { this.vx = 0; this.vy = 0; }
    // ★L2②：ai[1]>=1 尾孢子 CanDealDamage=false → 不进 Damage()（零接触伤、零
    //   CritTimer 消费）;仅砸地大云（ai[1]==0）按 IDStatic 30t 共享窗结算
    // ★BJ383 小动物命中面（BJ381 登记债清偿）：1128 friendly penetrate=−1（:10576）
    //  → critter 照伤弹不亡;尾孢子 CanDealDamage 门同盖 critter 面（Damage() 整跳
    //  ⇒ 挂同支内）。critter 一击即死（life=5）⇒ IDStatic 窗语义无可观测差。
    //  非 magic → 无幽灵兜帽吸血,不接 proc。
    if (this.ai1 < 1) {
      hitCritters(this, game);
      dealContacts(this, game, this.hitCd, 30);
    }
    if (this.t % 3 === 0) {
      game.spawnParticles(this.cx, this.cy, '#32C864', 1, 0.6, { life: 24, grav: -0.02, damp: 0.94 });
    }
  }

  draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const T = this.t / this.life;
    const opacity = Math.max(0, Math.min(1, T / 0.25)) * Math.max(0, Math.min(1, (1 - T) / 0.5)) * 0.75;
    const img = projSprite(1128);
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.id * 0.4002029 + this.t * (Math.PI * 2) / 480);  // :33199-33200
    ctx.imageSmoothingEnabled = false;
    if (img && img.width > 0) {
      const dw = 30 * (0.25 + 0.85 * Math.min(1, T / 0.1)) * 1.1;
      // projFrames[1128]=5（Main.cs:8865）——竖条 5 帧按出生随机帧定格（:33149-33151
      // ai[0]==0 → frame=rand(frames),云体不播帧）
      const fh = img.height / 5;
      const fr = this.spawnFrame % 5;
      ctx.drawImage(img, 0, Math.round(fr * fh), img.width, Math.round(fh),
        -dw / 2, -dw / 2, dw, dw);
    } else {
      ctx.fillStyle = '#32C864';
      ctx.beginPath();
      ctx.arc(0, 0, this.w / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// ================= 1129 叶绿巨剑砸地爆（AI_209） =================

/** SpawnChlorophyteSporeCloud 尾段的砸地大爆炸伤害盒（SetDefaults :3346-3360 +
 *  AI_209 :70705-70715）：盒每拍回写 width=(int)ai[1]=128 / height=(int)ai[2]=96；
 *  timeLeft=5 → Update(:17308-17312) 5 拍即亡——ai[0]>20 的 Kill 是永不可达死代码
 *  （★A④ 勘误：曾按该死代码活到 21+ 拍=3 倍寿命窗）。usesLocalNPCImmunity + cooldown −1
 *  （每敌一次）;**ownerHitCheck=true（:3358）**→ Damage_PVE_Inner 走 CanHitWithMeleeWeapon
 *  :12415 整门 = 距离段（Distance(ent.Center) > ownerHitCheckDistance(缺省 1000f,
 *  :306/:701) 即不结算——★R2-F1+F10：基准=弹体自身 Center（盒心=砸地位）,非 owner
 *  玩家）+ LOS 四探针段（:12420-12425,owner 玩家基准,playerCanHitEntity 承载）——
 *  隔墙/远端敌不吃大爆盒（★A④ 主缺口+LOS 补齐批;noTileCollide 目标整门豁免 :12657）。 */
export class ChloroBladeSlam extends Entity {
  damage: number;
  knockback = 0;
  critChance = 0.04;
  armorPen = 0;
  meleeProj = true;
  dead = false;
  readonly projId = 1129;
  private t = 0;
  private hitCd = new HitCdImpl();

  constructor(cx: number, cy: number, w: number, h: number, damage: number) {
    super();
    this.w = w; this.h = h;
    this.x = cx - w / 2; this.y = cy - h / 2;
    this.damage = Math.max(1, Math.round(damage));
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    this.t++;
    // ownerHitCheck（:3358）整门 = 距离 1000 段（CanHitWithMeleeWeapon :12417-12419,
    // ★R2-F1+F10：基准=本弹盒心=砸地位——不依赖 owner,无主桩也照查）+ LOS 四探针段
    // （:12420-12425,基准=owner 玩家,playerCanHitEntity 承载;缺玩家桩时退化放行）;
    // usesOwnerMeleeHitCD 未开 → 不吃玩家挥击共享表,仅独立 local 免疫
    const p = game.player as unknown as { cx?: number; cy?: number };
    const gate: { maxDist: number; los?: (e: { x: number; y: number; w: number; h: number }) => boolean } =
      { maxDist: 1000 };
    if (p && p.cx != null && p.cy != null) gate.los = ownerMeleeWeaponLOS(game);
    cutTilesBox(game, this.x, this.y, this.w, this.h);         // CutTiles（Damage() 内旁路先于结算,:12519/:15276;排除表无 1129）
    // ★BJ383 小动物命中面（BJ381 登记债清偿）：1129 friendly penetrate=−1（:10595）
    //  → critter 照伤弹不亡。桶序先小动物。★登记：critter 面无 ownerHitCheck 门
    //  （hitCritters 单源无 gate 参）——爆盒可远至 1000px,LOS 遮挡格内小动物原版
    //  被距/LOS 门拒、本面照结（罕见边角,下窗随 ownerHitCheck 收口一并补）。
    //  非 magic → 无幽灵兜帽吸血,不接 proc。
    hitCritters(this, game);
    dealContacts(this, game, this.hitCd, -1, undefined, gate);
    if (this.t === 1) {
      game.spawnParticles(this.cx, this.cy, '#32C864', 16, 3.4, { life: 26, grav: -0.03, damp: 0.93 });
    }
    if (this.t >= 5) this.dead = true;                          // timeLeft=5（:3353）
  }

  draw(): void { /* alpha=255 原版本体不绘制（:3351） */ }
}

// ================= 1116 花瓣风暴弹（AI_196 1116 支） =================

/** 6154 Petalstorm 出手（Player.cs:48010-48026）每 use 3 瓣：
 *  v = NextVector2Circular(1,1)+NextVector2CircularEdge(3,2)（Y>0 取反）×2 + aim×2；
 *  ai0=−1 / ai1=(itemAnimation/itemAnimationMax×0.66+miscCounter)%1（相位）；
 *  出生点 = MountedCenter+(dir×15, gravDir×3)（挂墙则回 MountedCenter）。
 *  AI_196（:41192-41290）1116 支：光 (0,0.6,0.6)、alpha=Remap(timeLeft,30,0,0,255)、
 *  scale×0.75、索敌 400px【CanHit 视线门恒须——num4=0 时 !(dist>0) 恒假,:41257-41258,
 *  ★R34-① 勘误旧注「无 LOS 门」】、追踪 v=(v×30+dir×6)/31、无目标漂移
 *  vx→sin(ai0×0.1)×1.5 / vy→0.3；前 20t 减速 ×0.95（:41220-41227）;撞块软反弹 ×0.25
 *  （:18181-18191 单轴独立翻向——TileCollision 解算被挡轴置零后本支按轴重翻,
 *  另一轴照常推进;B1 转正）/penetrate=1 命中即亡/Kill 尘 306×4（:72202）。
 *  SetDefaults（:10415-10426）：18×18、timeLeft 120、penetrate 1、
 *  usesLocalNPCImmunity + cooldown −1（每敌一次）、magic、ignoreWater。 */
export class PetalstormShot extends Entity {
  damage: number;
  knockback: number;
  critChance = 0.04;
  armorPen = 0;
  dead = false;
  magicProj = true;
  readonly projId = 1116;
  private t = 0;
  private readonly phase: number;
  private readonly life = 120;
  private frame = 0;
  private frameCounter = 0;
  private rot = 0;
  private scl = 0.5;
  private hitCd = new HitCdImpl();
  /** ★BJ383：PVE 受理命中计数（原版 Projectile.numHits;:14263 每受理命中 ++,
   *  吸血 proc 读自增前值——ghostHeal ladder 0.20−numHits×0.05,Projectile.cs:12079） */
  pveNumHits = 0;

  constructor(x: number, y: number, vx: number, vy: number, damage: number, knockback: number, phase: number) {
    super();
    this.w = 18; this.h = 18;
    this.x = x - this.w / 2; this.y = y - this.h / 2;
    this.vx = vx; this.vy = vy;
    this.damage = Math.max(1, Math.round(damage));
    this.knockback = knockback;
    this.phase = phase;
    this.rot = Math.random() * Math.PI * 2;                     // :41212
    this.scl = (0.6 + 0.3 * Math.random()) * 0.75;              // :41213-41216
    this.frame = Math.floor(Math.random() * 8);                 // :41210
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    this.t++;
    if (this.t >= this.life) { this.die(game); return; }        // timeLeft 120 → 120t 消亡
    if (++this.frameCounter >= 4) {                             // :41218-41223
      this.frameCounter = 0;
      this.frame = (this.frame + 1) % 8;
    }
    this.rot += (this.vx + this.vy) * 0.1;                      // :41225
    if (this.t < 20) {
      // :41220-41227（ai0<20 减速段）;光照 ai[0]≥10 门(:41232-41236)
      this.vx *= 0.95; this.vy *= 0.95;
    } else {
      // 索敌 400px。★R34-① 勘误（原注释「无 LOS 门」系误读）：1116 num4=0 时
      //   条件 `!(dist>0)||CanHit` 的左支恒假 → CanHit 对一切目标必选（:41257-41258）。
      //   隔墙敌不追踪；候选命中即 num3 收缩=最近者胜（与下方 bd 收缩同构）
      let best: { cx: number; cy: number } | null = null;
      let bd = 400;
      const st = game.world.store;
      for (const q of game.enemies()) {
        const e = q as { x?: number; y?: number; w?: number; h?: number; cx: number; cy: number; dead: boolean; maxHp: number; def?: { friendly?: boolean; critter?: boolean } };
        if (e.dead || e.maxHp <= 5 || e.def?.friendly || e.def?.critter) continue;
        const d = Math.hypot(e.cx - this.cx, e.cy - this.cy);
        if (d >= bd) continue;
        // Collision.CanHit(this, npc)（弹盒→目标盒逐格视线,:388-480）
        const ex = e.x ?? e.cx, ey = e.y ?? e.cy, ew = e.w ?? 16, eh = e.h ?? 16;
        if (!canHit(st, this.x, this.y, this.w, this.h, ex, ey, ew, eh)) continue;
        bd = d; best = e as { cx: number; cy: number };
      }
      if (best) {
        // :41263-41270（1116：num6=6/num7=30）v = (v×30 + dir×6)/31
        const d = Math.hypot(best.cx - this.cx, best.cy - this.cy) || 1;
        const hx = (best.cx - this.cx) / d * 6;
        const hy = (best.cy - this.cy) / d * 6;
        this.vx = (this.vx * 30 + hx) / 31;
        this.vy = (this.vy * 30 + hy) / 31;
      } else {
        // :41274-41276（1116 漂移档：sin(ai0×0.1)×1.5 / 0.3）
        this.vx += (Math.sin((this.t + this.phase * 100) * 0.1) * 1.5 - this.vx) * 0.1;
        this.vy += (0.3 - this.vy) * 0.1;
      }
    }
    this.moveWithBounce(game);
    // CutTiles（:12517/:15276;CanCutTiles 排除表无 1116）——扫草/碎罐同 GlacierFangShot
    cutTilesBox(game, this.x, this.y, this.w, this.h);
    if (this.t >= 10) {
      const fade = Math.max(0, Math.min(1, (this.life - this.t) / 120));
      game.addLightAt?.(this.cx, this.cy, 0,
        0.6 * (this.t < 20 ? 1 : fade),                         // 相1 恒 (0,.6,.6)/相2 ×Remap(timeLeft)
        0.6 * (this.t < 20 ? 1 : fade));
    }
    // penetrate=1（:10422）——首次伤害结算即 Kill（原注释漏了总数帽）。
    // ★命中结算全周期有效（原版碰撞循环每拍跑,非仅相 2）
    // ★BJ383 小动物命中面（BJ381 登记债清偿）：penetrate=1 → critter 受击耗穿
    //  归零即亡（:14184 递减 → :17312 Kill;走 die()=Kill 尘面 :72202）。
    if (hitCritters(this, game)) { this.die(game); return; }
    dealContacts(this, game, this.hitCd, -1, (t) => {
      // ★BJ383 幽灵兜帽吸血 proc（:13877-79 Damage() 通用 on-hit 段;1116 magic
      //  :10425）——proc 先于 :14263 numHits++（读自增前值）;拒收不 proc 不计数
      //  （immune/cd 门 continue 在 onHit 前）。
      ghostHealProc(game, this.projId, this.pveNumHits,
        t as never as Parameters<typeof ghostHealProc>[3]);
      // ★BJ420 幽灵伤害头 ghostHurt（Projectile.cs:13881/:12021,SpectreSoulProj 单源）：
      //  1116 数据面 magic（:10419-10426）+ 幽灵面具套装 → 受害者 Center 放浮魂 356。
      //  受理面 = dealContacts 内环免疫门（红蓝-L1① 收编,:12635-12638/:12600 在
      //  onHit 前拒）⇒ 到达本位即原版 flag10 块可达面。
      if (playerHasGhostHurt(game.player)) {
        const v420 = t as never as { vanillaId?: number | null; lastStrikeDealt?: number;
          maxHp?: number; def?: { lifeMax?: number } };
        ghostHurtOnHit(game,
          { magic: true, projDamage: this.damage,
            projX: this.x, projY: this.y, projW: this.w, projH: this.h,
            ownerCx: game.player.cx, ownerCy: game.player.cy },
          { x: t.x, y: t.y, w: t.w, h: t.h,
            cx: t.x + t.w / 2, cy: t.y + t.h / 2,
            vanillaId: v420.vanillaId,
            lifeMax: v420.maxHp ?? v420.def?.lifeMax,
            dealt: v420.lastStrikeDealt ?? 0 });
      }
      // ★BJ424 星云套装 proc（:13885-13891,ghostHurt 同块同门面）——引擎自持全部门
      nebulaBoosterOnHit(game,
        { projId: this.projId, projDirX: this.vx },
        { x: t.x, y: t.y, w: t.w, h: t.h,
          cx: t.x + t.w / 2, cy: t.y + t.h / 2,
          vanillaId: (t as never as { vanillaId?: number | null }).vanillaId,
          lifeMax: (t as never as { maxHp?: number; def?: { lifeMax?: number } }).maxHp
            ?? (t as never as { def?: { lifeMax?: number } }).def?.lifeMax,
          dealt: (t as never as { lastStrikeDealt?: number }).lastStrikeDealt ?? 0 });
      this.pveNumHits++;
      this.dead = true;                                       // penetrate=1 → Kill
    });
  }

  /** HandleMovement tileCollide 段（:18181-18191 type==1116 支）：TileCollision 解算把被
   *  挡轴速度置零（velocity.X != lastVelocity.X 即该轴受阻）→ 本支按【单轴独立】翻向
   *  ×0.25 软反弹、另一轴照常推进、弹体不亡（★B1 转正：曾两轴同翻=斜角贴墙时竖直
   *  动量也归零成"粘墙",原版只翻被挡轴）。X/Y 探针按行进终点中心格分轴取。 */
  private moveWithBounce(game: GameHooks): void {
    const nx = this.x + this.vx, ny = this.y + this.vy;
    const st = game.world.store;
    const probeSolid = (px: number, py: number): boolean => {
      const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
      return !st.inBounds(tx, ty) || st.isSolid(tx, ty);
    };
    const blockedX = this.vx !== 0 && probeSolid(nx + this.w / 2, this.y + this.h / 2);
    const blockedY = this.vy !== 0 && probeSolid(this.x + this.w / 2, ny + this.h / 2);
    // 被挡轴翻向不推进（原版解算回卷位移）;自由轴照常走
    const vxNew = blockedX ? -this.vx * 0.25 : this.vx;         // :18183-18186 单轴 −×0.25
    const vyNew = blockedY ? -this.vy * 0.25 : this.vy;         // :18187-18189 同式
    this.vx = vxNew; this.vy = vyNew;
    if (!blockedX) this.x += this.vx;
    if (!blockedY) this.y += this.vy;
  }

  /** Kill() 1116 尘（:72202-72217）：306×4（Center±Circular(10,10)×scale,scale
   *  1.5+0.25rand,noGravity,color(50,170,255),vel=v×0.4)+白克隆 scale×0.3×alphaRemap。
   *  本仓 spawnParticles 近似（蓝白两组,alphaRemap 折入 size） */
  private die(game: GameHooks): void {
    if (this.dead) return;
    this.dead = true;
    const a = Math.max(0, Math.min(1, (30 - (this.life - this.t)) / 30));
    const remap = 1 - a;                                        // Remap(alpha,0,255,1,0)
    if (remap <= 0) return;                                     // 全透明期消亡不出尘
    for (let i = 0; i < 4; i++) {
      game.spawnParticles(this.cx, this.cy, '#32AAFF', 1, 1.5,
        { life: 18, grav: 0, damp: 0.94, size: (1.5 + Math.random() * 0.25) * remap });
      game.spawnParticles(this.cx, this.cy, '#FFFFFF', 1, 1.2,
        { life: 12, grav: 0, damp: 0.94, size: (1.5 + Math.random() * 0.25) * 0.3 * remap });
    }
  }

  draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const img = projSprite(1116);
    const T = this.t / this.life;
    const alpha = 1 - Math.max(0, Math.min(1, (30 - (this.life - this.t)) / 30));  // Remap(timeLeft,30,0,0,255)
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.rot);
    ctx.imageSmoothingEnabled = false;
    const dw = 18 * this.scl * (img && img.width > 0 ? img.width / 18 : 1);
    if (img && img.width > 0) {
      const fh = img.height / 8;
      ctx.drawImage(img, 0, Math.round(this.frame * fh), img.width, Math.round(fh),
        -dw / 2, -dw / 2, dw, dw);
    } else {
      ctx.fillStyle = '#E86FA8';
      ctx.beginPath();
      ctx.arc(0, 0, dw / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    void T;
  }
}

// ================= 1117/1122 天雷/红雷（AI_203_StormLightning） =================

/** 6155 LightningStrike（1117）出手（Player.cs:49686-49703）：落点 = 鼠标位钳可达区,
 *  出手沿 aim 步进至距鼠标 <20+|vx|+|vy| 吸附；再沿 aim 反向退出实心块（≤16 步）；
 *  ai0=−1 / ai2=rand 种子。6173 ArcSurge（1122）（:49670-49703）：鼠标位钳可达 + 距离
 *  <shootSpeed×20 外推 + ±20px 抖动,再向 GetSparkleGuitarTarget 前 2 个有效目标
 *  各补一颗（Game 侧实现）。AI_203（:40360-40560）：
 *  - 1117：寿命 30、索敌门 CanBeChasedBy、搜索半径 12、无目标跟鼠标（v=鼠标−中心
 *    钳 16,撞实心停）；1122：★寿命=1 拍（SetDefaults timeLeft=1 :10447 → Update
 *    :17308 Kill 先于 AI,出生首拍即落雷;ai[1] 帽 240 仅敌意 1091 消费）、半径 32、
 *    玩家侧 localAI[2] 5 次豁免计数后可选中玩家（自伤链,本仓玩家弹不伤主——登记）
 *  - 目标锁定（ai[0] Pack/Unpack :40508-40560）：锁定后每帧校验,失效即 Kill
 *  - 中心 MoveTowards(目标,32)；ai[1]++≥寿命 Kill；ai[1]==寿命×0.15 播 NPCHit34
 *  - ★命中模型（Colliding :15962 aiStyle 203 支 → StormLightningCollisionCheck
 *    :16205）：飞行期【无普通接触盒】——仅 Kill 帧 GenerateMainBoltPath 折线 +
 *    customHitbox=MultiPointHitbox(16×16, bolt.positions) → Damage() 沿整条闪电
 *    一次性结算（:71904-71930 1122 手→雷 / :71931-71975 1117 天降 bolt+64×64 爆
 *    炸域+液体链 localAI[0]=3）
 *  - Kill 帧编排（P57 Spawn_ArcLightning :1245-1345 / StormLightningParticle）：
 *    bolt 折线视觉（StormLightningDrawer 波前扫掠）+ 沿线 278/226 光尘
 *    （EmitSpawnDust :78-135）+ steadyLight 沿线点光 + Item15/ArcSurge(203) 双音
 *  - 1117 Damage() 伤 ×0.8（:13581-13586）——Game 侧出生伤已折算 */
export class StormLightning extends Entity {
  damage: number;
  knockback: number;
  critChance = 0.04;
  armorPen = 0;
  dead = false;
  magicProj = true;
  declare readonly projId: number;
  /** ai[2] 出手种子（Player.cs :49678/:49642 Main.rand.Next(MaxFloatInt+1)；Game 注入） */
  seed = 0;
  private readonly life: number;
  private readonly searchR: number;
  private t = 0;
  private hitCd = new HitCdImpl();
  private sharedCd: HitCdImpl | IdStaticSharedTable | null;
  /** ★BJ383：PVE 受理命中计数（原版 Projectile.numHits :14263;proc 读自增前值。
   *  现役弹型 1091/1117/1122 中仅 1117/1122 magic（ghostHealProc magic 门过滤 1091） */
  pveNumHits = 0;
  /** ai[0] 目标锁（≥0=NPC 桶序；1091 玩家目标=布尔,单玩家足够——原版 ai[0]=-2-idx） */
  private targetIdx = -1;
  /** 1091 玩家目标态（:40419-40438 num3=14 半径+localAI[2] 5 次豁免计数） */
  private targetPlayer = false;
  private playerGrace = 0;
  /** noLightning+moreLightning 双种子组合（:12795 伤害变治疗/绿雷;Game 注入） */
  comboSeed = false;
  /** Kill 帧 bolt 折线（视觉 + 命中域）；visualT>0 = 尸检期（弹已停 AI,仅画 bolt） */
  private bolt: Bolt | null = null;
  /** localAI[0] 组值（Kill 帧 :71944-71952）：0=飞行期 / 1=未撞块 / 2=撞块 / 3=落点浸液。
   *  消费面 = StormLightningCollisionCheck(:16205) 爆域(1)/液体导通(3) 双门 */
  private boltLocalAI0 = 0;
  /** ★BJ674 Kill 帧浸液落雷 + 1117 标记（:71960 `localAI[0]==3f && type==1117`）——
   *  Damage() 后消费（selfHurtPlayers）。netPuppet 弹早退 doKill 不可达 = 原版
   *  owner==Main.myPlayer 门同构（只在弹主本地自伤,远端弹由其 owner 端自结）。 */
  private liquidSelfHurt = false;
  /** 全 bolt 列表（主雷+分支叉——StormLightningParticle.Draw foreach bolts 全画,
   *  叉强度 0.5×0.8^(depth−1);曾 generateMainBoltPath 传 null 列表=叉生成即丢弃） */
  private bolts: Bolt[] = [];
  /** ★P0-B③ 绘制并发钳上界（防御位;正常生成恒不触发——vanilla 语义核对:
   *  LightningGenerator.cs StormLightning MaxForksPerBolt=2/MaxForkDepth=2
   *  → ≤1+2+4=7,ArcSurge GetArcSurgeWeaponGenerator 3/3 → ≤13=本值;
   *  本仓克隆 src/fx/LightningGenerator.ts 同参同界）。 */
  static readonly BOLT_DRAW_CAP = 13;
  /** ★P0-B① 烘焙通道逃生门（探针 A/B 面+回滚口;?boltbake=0 回原链逐切片直画） */
  static BOLT_BAKE_OFF = (() => {
    try {
      return typeof location !== 'undefined' && new URLSearchParams(location.search).get('boltbake') === '0';
    } catch { return false; }
  })();
  private boltColor: [number, number, number] = [1, 1, 1];
  private visualT = 0;
  /** 尸检寿命：1117=45（Spawn_StormLightning num=45;★R35 勘误:曾误用宽度 num2=12 当
   *  寿命=闪 4 倍快——num2 是 Prepare 的 width 参）/ 1122=16（Spawn_ArcLightning
   *  num2=16;owner.slowMagicUse → ×3=48 档在 Kill 帧实读,见 doKill） */
  private visualTotal = 16;
  /** 跟鼠标回调（1117 无目标态；Game 注入） */
  mouseWorld?: () => { x: number; y: number };

  constructor(projId: number, x: number, y: number, damage: number, knockback: number) {
    super();
    this.projId = projId;
    this.w = 16; this.h = 16;
    this.x = x - this.w / 2; this.y = y - this.h / 2;
    this.damage = Math.max(1, Math.round(damage));
    this.knockback = knockback;
    // :40363-40370（1117：num=30/num2=12；1091：缺省 240/32；1122：缺省 240/32）
    // ★R34-② 勘误：1122 SetDefaults `timeLeft = 1`（:10447）——Update 循环
    //   `timeLeft--; if(≤0) Kill()`（:17308-17312）先于 AI 派发 → 出生首拍即 Kill，
    //   AI_203 的 ai[1]≥240 帽全程死代码（仅敌意 1091 用到）。bolt 整线伤害在 Kill 帧
    //   （:71895-71921），故实体寿命=1 拍：本拍 fixedUpdate 走 doKill 落雷。
    // ★1091 世界落雷（2026-08-25 补全,1.4.5 新机制）：寿命=缺省 240（ai[1] 帽真实
    //   消费者）;标记期无害（Damage_CanDealDamage :12483 localAI[0]≤0→false——
    //   localAI[0] 在 Kill 帧才写 1/2/3）;玩家侧目标半径 num3=14(Legendary 32)+
    //   localAI[2] 5 次豁免计数（Legendary 0）;色=青 (80,220,220)（:40590,
    //   noLightning+moreLightning 组合种子 → 绿 (80,220,80) 且伤害变治疗）
    this.life = projId === 1117 ? 30 : (projId === 1091 ? 240 : 1);
    this.searchR = projId === 1117 ? 12 : 32;
    this.sharedCd = projId === 1122 ? ID_STATIC_1122_TABLE : null;   // 1122 IDStatic 10（全场同型一张表）
    this.boltColor = projId === 1117 ? [60 / 255, 120 / 255, 1]
      : projId === 1091 ? [80 / 255, 220 / 255, 220 / 255]
      : [1, 60 / 255, 60 / 255]; // GetLightningColor :40566
    // ★闪电之击专项 R35 再勘误：bolt 视觉余命=Prepare 的 lifeTimeTotal 参——
    //   1117=Spawn_StormLightning num=45(:1031)/1122=Spawn_ArcLightning num2=16(:1259,
    //   slowMagic ×3 档 Kill 帧实读)。曾误读宽度 num2=12 当寿命=闪 4 倍快
    this.visualTotal = projId === 1122 ? 16 : 45;   // 1091 世界落雷同 Spawn_StormLightning 档
  }

  /** TileCollision（LightningGenerator.cs:209-226）：实心/斜坡 或 液体浸没 */
  private tileProbe(game: GameHooks): (x: number, y: number) => boolean {
    return (x: number, y: number): boolean => {
      const tx = Math.trunc(x / 16), ty = Math.trunc(y / 16);
      const st = game.world.store;
      if (!st.inBounds(tx, ty)) return false;
      if (st.isSolid(tx, ty)) return true;
      const liq = typeof game.world.liquidAt === 'function' ? game.world.liquidAt(x, y) : 0;
      return liq > 0 && (Math.trunc(y) % 16) > (16 * (255 - liq)) / 255;
    };
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    // ---- Kill 帧后：bolt 视觉余命（弹本体已死,原版由 StormLightningParticle 承接）----
    if (this.visualT > 0) {
      this.visualT--;
      const vprog = 1 - this.visualT / this.visualTotal;
      // 天端 windup 电花（StormLightningParticle.Update num<0.5 段 :177-227）：
      // 主雷 positions[0]=1117 天上端点——3× rand(4)==0 顶升 d306(±90° 抖) +
      // k=±1 侧向 45° d306 + 白核克隆;本仓 spawnParticles 近似（d306 池无帧链）
      if (this.bolt && vprog < 0.5) {
        const skyEnd = this.bolt.positions[0];
        const col = this.projId === 1117 ? '#3C78FF' : '#FF3C3C';
        for (let j = 0; j < 3; j++) {
          if (Math.floor(Math.random() * 4) !== 0) continue;
          const a9 = -Math.PI / 2 + (Math.random() * 2 - 1) * Math.PI / 2;
          game.spawnParticles(skyEnd.x, skyEnd.y, col, 1, 1.8,
            { life: 16, grav: 0, vx: Math.cos(a9) * 4, vy: Math.sin(a9) * 4, damp: 0.95 });
          game.spawnParticles(skyEnd.x, skyEnd.y, '#FFFFFF', 1, 1.3,
            { life: 12, grav: 0, vx: Math.cos(a9) * 4, vy: Math.sin(a9) * 4, damp: 0.95 });
        }
        for (let k = -1; k <= 1; k += 2) {
          if (Math.floor(Math.random() * 4) !== 0) continue;
          const a9 = -Math.PI / 2 + k * Math.PI / 4;
          game.spawnParticles(skyEnd.x, skyEnd.y, col, 1, 1.8,
            { life: 16, grav: 0, vx: Math.cos(a9) * 4, vy: Math.sin(a9) * 4, damp: 0.95 });
        }
      }
      // steadyLight（StormLightningParticle.Update :157-165）：沿线每 20 点加光,
      // 强度 = Remap(progress,0,0.3,0,1)×Remap(progress,0.7,1,1,0)
      if (this.bolt && game.addLightAt) {
        const prog = vprog;
        const k = remapL(prog, 0, 0.3, 0, 1) * remapL(prog, 0.7, 1, 1, 0);
        const pos = this.bolt.positions;
        const [r, g, b] = this.boltColor;
        for (let i = 0; i < pos.length; i += 20) {
          game.addLightAt(pos[i].x, pos[i].y, r * k, g * k, b * k);
        }
      }
      if (this.visualT === 0) this.dead = true;
      return;
    }
    this.t++;
    // :40445-40448 ai[1]>=num → Kill（Kill 帧内结算 bolt 伤害,见 doKill）
    if (this.t >= this.life) { this.doKill(game); return; }
    // 目标锁校验（:40372-40392）：锁定后失效（死亡/超距 600）即 Kill
    if (this.targetIdx >= 0) {
      const e = this.enemyAt(game, this.targetIdx);
      if (!e || e.dead || Math.hypot(e.cx - this.cx, e.cy - this.cy) > 600) {
        this.doKill(game); return;
      }
    }
    if (this.targetPlayer) {
      const p = game.player;
      if (!p || p.dead || Math.hypot(p.cx - this.cx, p.cy - this.cy) > 600) {
        this.doKill(game); return;
      }
    }
    // 索敌（:40397-40421）：仅无目标时扫（1117 需 CanBeChasedBy 口径≈非 friendly/小动物）。
    // ★R25-②a 对齐两处：vanilla 按 NPC 槽序取【首个】入半径者（:40400-40403
    //   `if (entity != null) break`——非最近者）；距离口径 =
    //   Distance(npc.Hitbox.ClosestPointInRect(Center))（到目标【盒】最近点,:40405,
    //   大体型判定圈不缩水）。门 !dontTakeDamage 与 CanBeChasedBy 三近似维持登记
    if (this.targetIdx < 0) {
      const list = game.enemies();
      for (let i = 0; i < list.length; i++) {
        const e = list[i] as { cx: number; cy: number; x: number; y: number; w: number; h: number; dead: boolean; maxHp: number; def?: { friendly?: boolean; critter?: boolean } };
        if (e.dead || e.maxHp <= 5 || e.def?.friendly || e.def?.critter) continue;
        // ClosestPointInRect(Center)：Center 钳入目标盒后的最近点距离
        const px = Math.min(Math.max(this.cx, e.x), e.x + e.w);
        const py = Math.min(Math.max(this.cy, e.y), e.y + e.h);
        if (Math.hypot(px - this.cx, py - this.cy) <= this.searchR) {
          this.targetIdx = i;                                   // ai[0]=PackTargetIndex（槽序首中即定）
          break;                                                // :40401-40403 entity!=null → break
        }
      }
    }
    if (this.targetIdx >= 0) {
      // :40443 MoveTowards(center,32)
      const e = this.enemyAt(game, this.targetIdx)!;
      const d = Math.hypot(e.cx - this.cx, e.cy - this.cy) || 1;
      const step = Math.min(32, d);
      this.x += (e.cx - this.cx) / d * step;
      this.y += (e.cy - this.cy) / d * step;
    } else if (this.targetPlayer) {
      // :40453-40456 玩家目标 MoveTowards(center,32)
      const p = game.player;
      const d = Math.hypot(p.cx - this.cx, p.cy - this.cy) || 1;
      const step = Math.min(32, d);
      this.x += (p.cx - this.cx) / d * step;
      this.y += (p.cy - this.cy) / d * step;
    } else if (this.projId === 1091) {
      // :40419-40438 玩家侧捕获（NPC 扫描落空后）：num3=14（Legendary 32——本仓
      //   无 Legendary 档）;玩家在半径内时 localAI[2] 豁免计数 +1,计满 5 次才可
      //   被选中（Legendary 0 次=立即可选）——给玩家 5 tick 逃离窗
      const p = game.player;
      if (p && !p.dead) {
        const px = Math.min(Math.max(this.cx, p.x), p.x + p.w);
        const py = Math.min(Math.max(this.cy, p.y), p.y + p.h);
        if (Math.hypot(px - this.cx, py - this.cy) <= 14) {
          if (this.playerGrace < 5) this.playerGrace++;
          else this.targetPlayer = true;
        }
      }
    } else if (this.projId === 1117 && this.mouseWorld) {
      // :40423-40436（1117 无目标跟鼠标：v=鼠标−中心钳 16,撞实心停）
      const m = this.mouseWorld();
      let vx = m.x - this.cx, vy = m.y - this.cy;
      const l = Math.hypot(vx, vy);
      if (l > 16) { vx = vx / l * 16; vy = vy / l * 16; }
      const st = game.world.store;
      const tx = Math.floor((this.cx + vx) / TILE), ty = Math.floor((this.cy + vy) / TILE);
      if (st.inBounds(tx, ty) && st.isSolid(tx, ty)) { vx = 0; vy = 0; }
      this.x += vx; this.y += vy;
      game.spawnParticles(this.cx, this.cy, '#3C78FF', 1, 1.2, { life: 14, grav: 0, damp: 0.92 });
    }
    const prog = this.t / this.life;
    // ★回炉：风窗粒子连续撒（vanilla :40518-40526 每拍 P<=prog×0.2——曾仅 t=15%
    //   一发 6 粒=光球期 2/3 屏时几乎无粒子=用户"很暗"主源之一）
    if (this.t > 1 && Math.random() <= prog * 0.55) {
      const [wr, wg2, wb] = this.boltColor;
      game.spawnParticles(this.cx + (Math.random() * 2 - 1) * 10,
        this.cy + (Math.random() * 2 - 1) * 10,
        `rgb(${Math.round(wr * 255)},${Math.round(wg2 * 255)},${Math.round(wb * 255)})`,
        2, 1.4, { life: 14, grav: -0.01, damp: 0.92 });
    }
    if (this.t === Math.floor(this.life * 0.15)) {
      // ★闪电之击专项：windup 音=NPCHit34（Projectile.cs:40507 vol=Lerp(.4,1,
      //   Main.SceneState.outsideWeatherEffectIntensity)）——资产无 npchit_34.wav，
      //   取电花特征最近的 dd2_lightning_aura_zap_0-3（近似登记）。室外强度经
      //   world.weather.outsideWeatherEffect（Weather.ts:217,:338 钳 0-1,SceneState
      //   同源值;与本类 doKill Kill 帧音同通道,缺省 1 兜底同款）——曾固定 0.8
      //   （F2 2026-08-26 对齐 Lerp 原式）
      const zaps = ['dd2_lightning_aura_zap_0', 'dd2_lightning_aura_zap_1',
        'dd2_lightning_aura_zap_2', 'dd2_lightning_aura_zap_3'];
      const wx = (game.world as unknown as { weather?: { outsideWeatherEffect?: number } }).weather;
      const inten = Math.max(0, Math.min(1, wx?.outsideWeatherEffect ?? 1));
      game.playSfxWav?.(zaps[(Math.random() * 4) | 0], 0.4 + 0.6 * inten, this.cx, this.cy);
      game.spawnParticles(this.cx, this.cy, this.projId === 1117 ? '#3C78FF' : '#FF3C3C', 6, 2.2, { life: 18, grav: -0.02, damp: 0.93 });
    }
    // :40450-40455 num9=√(1−(num8−1)²)×0.3 光强包络（num8=Remap(prog,0,0.5,0,1)）
    const num8 = Math.min(1, Math.max(0, (prog - 0) / 0.5));
    const num9 = Math.sqrt(Math.max(0, 1 - (num8 - 1) * (num8 - 1))) * 0.3;
    const [cr, cg, cb] = this.boltColor;
    game.addLightAt?.(this.cx, this.cy, cr * num9, cg * num9, cb * num9);
  }

  private enemyAt(game: GameHooks, idx: number): { cx: number; cy: number; dead: boolean } | null {
    const e = game.enemies()[idx] as { cx: number; cy: number; dead: boolean } | undefined;
    return e ?? null;
  }

  // ---- Kill 帧（Projectile.Kill :71904-71975 type 1122 / 1091||1117 支） ----
  private doKill(game: GameHooks): void {
    const probe = this.tileProbe(game);
    const center = { x: this.cx, y: this.cy };
    // 生成器按型分流（Kill :71936-71940）：1122=ArcSurge 手→雷；1091=StormLightning
    // （世界落雷预设,与 TrySpawnLightningBolt CanHitTarget 同款）；1117=LightningStrikeWeapon
    const gen = this.projId === 1122
      ? arcSurgeWeaponGenerator(this.handAnchor(game), center, probe)
      : this.projId === 1091
        ? stormLightningGenerator(probe)
        : lightningStrikeWeaponGenerator(probe);
    // 1122：direction = center − hand（:71913-71914）；1117：direction 缺省 UnitY
    // （Generate(null,seed,target,direction??UnitY) → 天降 bolt,start=目标上方 750px）
    const dir = this.projId === 1122
      ? { x: center.x - this.handAnchor(game).x, y: center.y - this.handAnchor(game).y }
      : null;
    // ★R35 勘误：Generate 传 bolts 列表（StormLightningParticle._Prepare :74 同式）——
    //   分支叉收集进列表全画（曾 generateMainBoltPath 传 null=叉生成即丢弃=闪电无叉）;
    //   calcRotations=true（EmitSpawnDust 尘速=−rotations[i] 向量,:103-106）。
    //   direction null→UnitY 展开在调用方（generate 不收 null,GenerateMainBoltPath :295 同式）
    this.bolts = [];
    const bolt = gen.generate(this.bolts, this.seed >>> 0, center,
      dir ?? { x: 0, y: 1 }, true, true);
    this.bolt = bolt;
    // ---- 撞块吸附 + localAI[0] 组值（Kill :71933-71955）：flag8=!collided →
    //   未撞=1 / 撞块=2；两型【都】把中心吸附到 bolt 末点后取落点格液体；
    //   浸液覆写 localAI[0]=3 并触发整链电化粒子（A① 导通链门）。
    //   1122 例外：ArcSurge 分支在生成前显式 localAI[0]=2（:71924）＝无爆域/导通 ----
    if (bolt.collidedWithTile && this.projId !== 1122) {
      const last = bolt.positions[bolt.positions.length - 1];
      this.x = last.x - this.w / 2; this.y = last.y - this.h / 2;
    }
    if (this.projId === 1122) {
      this.boltLocalAI0 = 2;                                    // :71924 显式 2
    } else {
      this.boltLocalAI0 = bolt.collidedWithTile ? 2 : 1;         // :71944 flag8
      if (tileHasLiquid(game, Math.floor(this.cx / TILE), Math.floor(this.cy / TILE))) {
        this.boltLocalAI0 = 3;                                  // :71950-71952 浸液导通态
        this.spawnLiquidElectrification(game);                  // :14502-14520 电化粒子链
        // ★BJ674：浸液落雷 1117 自伤（原版 :71960-71961 `if (localAI[0] == 3f &&
        //   type == 1117 && owner == Main.myPlayer) SelfHurtPlayers();`）——旧登记债
        //   「本仓玩家弹不伤主」清偿（用户实报「水里不会被电击到」根因）。执行位
        //   在 Damage()（damageAlongBolt）之后 = 原版 :71959→:71961 序;1091 世界雷
        //   的导通玩家伤由下方 EVP 命中口径覆盖（StatusPlayer 1091 无表项=零 buff）。
        if (this.projId === 1117) this.liquidSelfHurt = true;
      }
    }
    // ---- 打屏/背景白闪（Spawn_StormLightning，ParticleOrchestrator.cs:1027-1053）：
    //   flag = IndexOfPlayerWhoInvokedThis != 255 → 1117(武器,value=owner)/1091(世界,value=255)。
    //   ★A⑦ 转正：PunchCameraModifier + Main.NewLightning(instant:true) 只在 !flag 支
    //   （:1044-1052）＝【1091 世界雷】专属演出,1117 从无打屏（曾错装）。强度=
    //   Lerp(2,10,outsideWeatherEffectIntensity)（"恒 6"近似随之退役）;frames=45;
    //   起源=bolt 落点。vibrationCyclesPerSecond=3/falloff=1500 本仓 punchCamera
    //   形参无该两通道（hook 内定 cps 6/falloff 1000）维持登记 */
    if (this.projId === 1091) {
      const weather = (game.world as unknown as {
        weather?: { outsideWeatherEffect?: number; newLightning?: (instant?: boolean) => void };
      }).weather;
      const inten = Math.max(0, Math.min(1, weather?.outsideWeatherEffect ?? 1));
      const th = Math.random() * Math.PI * 2;
      const end9 = bolt.positions[bolt.positions.length - 1];
      game.punchCamera?.(Math.cos(th) * 0.5, Math.sin(th), 45, 2 + 8 * inten, end9.x, end9.y);
      weather?.newLightning?.(true);                            // 背景白闪系统瞬发档
    }
    // ---- MultiPointHitbox 16×16 沿 bolt 折线一次性结算（:71918-71919/:71957-71962）----
    this.damageAlongBolt(game, bolt);
    // ---- ★BJ674 1117 浸液自伤（Kill :71960-71961 → SelfHurtPlayers :15104-15151）----
    //   原版序：Damage() 先行（:71959），自伤后置（:71961）——本仓 damage 稳定
    //   （×0.8 已在 Game 侧出生折算,:13581-13586），两序无值差,按原版序落位。
    if (this.liquidSelfHurt) this.selfHurtPlayers(game);
    // ---- 1091 玩家侧结算（friendly+hostile+trap 三态弹）:Damage_EVP 全口径 —---
    //   命中面走 Colliding 的 aiStyle203 分流（bolt 折线 ±8 / 64×64 爆域 / 液体导通,
    //   与 NPC 同源——曾仅按 bolt 路径判=浸液连锁近旁玩家漏劈）;缩放序见
    //   lightningEvpFinalDamage（curve 在 Main.Difficulty 浮点轴,{Journey .04/Classic .08/
    //   Master .24/Legendary .4} ×2 ×死囚毛衣）。noLightning+moreLightning 组合种子 →
    //   Heal(80) 免伤（Damage_EVP :14931-14935）
    if (this.projId === 1091) {
      const p = game.player as unknown as
        { x?: number; y?: number; w?: number; h?: number; cx?: number; cy?: number; dead?: boolean } | null | undefined;
      if (p && !p.dead && !(p as { iframes?: number }).iframes) {
        const pbox = {
          x: p.x ?? (p.cx ?? this.cx) - 10, y: p.y ?? (p.cy ?? this.cy) - 21,
          w: p.w ?? 20, h: p.h ?? 42,
        };
        // MultiPoint 点优先取实触点（击退源坐标），否则爆域/导通面命中用落点心
        let hitPt: { x: number; y: number } | null = null;
        for (const q of bolt.positions) {
          if (q.x >= pbox.x - 8 && q.x < pbox.x + pbox.w + 8
            && q.y >= pbox.y - 8 && q.y < pbox.y + pbox.h + 8) { hitPt = { x: q.x, y: q.y }; break; }
        }
        if (hitPt || this.stormBoltCollides(game, pbox.x, pbox.y, pbox.w, pbox.h)) {
          this.evpStormBolt(game, hitPt ?? { x: this.cx, y: this.cy });
          // ★L5 长尾批：浸液导通命中链电（Projectile.SpawnHitVisuals :14480-14492——
          // StormLightningLiquidCollisionCheck 门内 BroadcastOrRequest(
          // BlueLightningSmallLong,{Position=_lightningLastHitChainPos??Center,
          // Movement=新链点−旧点,UniqueInfo=bolt 色});仓内无链记忆字段 →
          // 位置=本次实触点、向量=以 bolt 心向 ±150 随机档近似（登记）。
          if (this.boltLocalAI0 === 3 && this.projId === 1091) {
            const pxL = hitPt ?? { x: this.cx, y: this.cy };
            const mvLx = (Math.random() * 2 - 1) * 150 + (this.cx - pxL.x);
            const mvLy = (Math.random() * 2 - 1) * 150 + (this.cy - pxL.y);
            blueLightningSmallLongFx(game, pxL.x, pxL.y, mvLx, mvLy);
            game.broadcastParticleOrchestra?.(ParticleOrchestraType.BlueLightningSmallLong,
              pxL.x, pxL.y, mvLx, mvLy);
          }
        }
      }
    }
    // ---- 编排视觉（Spawn_ArcLightning P57:1245-1345）----
    this.emitBoltFx(game, bolt);
    // 1122 ×3 档（Spawn_ArcLightning，ParticleOrchestrator.cs:1249-1256）：
    //   `bool num = settings.MovementVector.Y == 1f; int num2 = 16; if (num) num2 *= 3;`
    //   MovementVector.Y = Kill 帧 `player.slowMagicUse.ToInt()`（Projectile.cs:71908
    //   传入编排 settings;player = Main.player[owner]（:71897 声明））——1457 ManaV2
    //   空蓝慢施那一击（DoRunOutOfManaEffect :53258-53261 置位,CheckMana :53217
    //   入口清）bolt 余命 16→48。
    //   （Prepare 第 5 参=lifeTimeTotal=本表;916 光斑 Fading/RandomizedFrame 两粒子
    //   集的 SetTypeInfo(num2) 档走 emitBoltFx 定寿命近似,登记维持）
    //   ★R2-F9 owner 域口径（2026-09-03 评估后登记,勿发明）：原版读 owner 玩家档
    //   （Main.player[owner].slowMagicUse）;本仓弹体实体无 owner 通道（StormLightning
    //   及全 proj1457 类均不携 owner 槽,出生注入面亦无）→ 读 game.player。单机
    //   （owner≡本地玩家）严格等价;联机偏差：远端弹走 netPuppet（fixedUpdate 早退,
    //   本 Kill 段不可达,余命由发送端快照面承载）⇒ 本支只在弹主本地执行,读本地
    //   玩家=owner 同一人,现可达面无偏差;若未来引入「本地模拟他人弹」通道须先补
    //   owner 实体再回此读 owner。
    if (this.projId === 1122) {
      this.visualTotal = (game.player as unknown as { slowMagicUse?: boolean } | null)?.slowMagicUse === true
        ? 48
        : 16;
    }
    // 弹本体死,bolt 视觉余命 visualTotal（1117=45/1122=16 或 slowMagic 48）
    this.visualT = this.visualTotal;
  }

  /** StormLightningParticle.GetPlayerAnchorPos（:137-140）：RotatedRelativePoint
   *  (HandPosition ?? MountedCenter)——本仓无 HandPosition 缓存,取 RRP(MountedCenter)；
   *  mock/缺省回退玩家中心 */
  private handAnchor(game: GameHooks): { x: number; y: number } {
    const p = game.player as unknown as {
      mountedCenter?: { x: number; y: number };
      rotatedRelativePoint?: (x: number, y: number) => { x: number; y: number };
      cx: number; cy: number;
    };
    const mc = p.mountedCenter ?? { x: p.cx, y: p.cy };
    return p.rotatedRelativePoint ? p.rotatedRelativePoint(mc.x, mc.y) : mc;
  }

  /** aiStyle203 命中面全口径（Colliding aiStyle203 分流 :15954-15965 +
   *  StormLightningCollisionCheck :16205-16243；1457 :15954/:16205 同值序）：
   *   ①1117 先置支 —— localAI[0]==1 时本体盒 Inflate(60)（半沿 68）；
   *   ②通用·爆域 —— localAI[0]==1 → GetStormLightningExplosionRect=
   *     CenteredRectangle(Center,64)（半沿 32,:16232-16235。★A② 勘误：此域三型共有,
   *     主消费面是 1091 世界雷——曾只挂 1117 用 ±68 近似充数）；
   *   ③通用·液体导通 —— localAI[0]==3 且 Distance(center,targetCenter)<500px 且
   *     Utils.PlotLine 落点心→目标心【全程】liquid!=0（StormLightningLiquidCollisionCheck
   *     :16237-16242,A① 导通链）；④尾段 MultiPointHitbox ±8 含容。
   *  命中即真（原生 OR 语序与原版一致）。 */
  private stormBoltCollides(game: GameHooks, wx: number, wy: number, ww: number, wh: number): boolean {
    const ecx = wx + ww / 2, ecy = wy + wh / 2;
    const dxT = Math.abs(ecx - this.cx), dyT = Math.abs(ecy - this.cy);
    const halfW = ww / 2, halfH = wh / 2;
    if (this.boltLocalAI0 === 1) {
      if (this.projId === 1117 && dxT <= 68 + halfW && dyT <= 68 + halfH) return true;
      if (dxT <= 32 + halfW && dyT <= 32 + halfH) return true;
    }
    if (this.boltLocalAI0 === 3 && Math.hypot(ecx - this.cx, ecy - this.cy) < 500) {
      const allWet = plotTiles(
        Math.floor(this.cx / TILE), Math.floor(this.cy / TILE),
        Math.floor(ecx / TILE), Math.floor(ecy / TILE),
        (x, y): boolean => tileHasLiquid(game, x, y));
      if (allWet) return true;
    }
    const pts = this.bolt?.positions ?? [];
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i];
      if (q.x >= wx - 8 && q.x < wx + ww + 8 && q.y >= wy - 8 && q.y < wy + wh + 8) return true;
    }
    return false;
  }

  /** SpawnLightningLiquidElectrificationParticles（:14502-14520）：以落点为心 40 条放射
   *  PlotLine（半径 500px、只走液体格、遇干格即止）逐格 1/4 率 白光 AddLight+电花编排
   *  粒子。编排粒子形态池缺——spawnParticles 白火花近似 */
  private spawnLiquidElectrification(game: GameHooks): void {
    const sx9 = Math.floor(this.cx / TILE), sy9 = Math.floor(this.cy / TILE);
    for (let i = 1; i < 40; i++) {
      const ang = Math.PI * i / 20;
      const ex9 = Math.floor((this.cx + Math.cos(ang) * 500) / TILE);
      const ey9 = Math.floor((this.cy + Math.sin(ang) * 500) / TILE);
      plotTiles(sx9, sy9, ex9, ey9, (x, y): boolean => {
        if (!tileHasLiquid(game, x, y)) return false;
        if (Math.random() * 4 >= 1) return true;                  // Main.rand.Next(4)==0 才出
        game.spawnParticles((x + 0.5) * TILE, (y + 0.5) * TILE, '#FFFFFF', 1, 1.2,
          { life: 14, grav: 0, damp: 0.92 });
        game.addLightAt?.((x + 0.5) * TILE, (y + 0.5) * TILE, 1, 1, 1);
        return true;
      });
    }
  }

  /** ★BJ674 SelfHurtPlayers（Projectile.cs:15104-15151）——1117 浸液落雷自伤
   *  （Kill :71960-71961 唯一调用面;AI_184 坏火把 :43579 / aiStyle16 炸弹族 :71790
   *  非本型域）。逐门序：
   *   · active/dead/immune（:15106-15107）→ 本仓 p.dead / p.iframes>0;
   *   · ownerHitCheck&&!CanHitWithMeleeWeapon（:15108）——1117 SetDefaults
   *     （:10429-10437）无 ownerHitCheck 位=恒过跳过;
   *   · !Colliding(base.Hitbox, localPlayer.Hitbox)（:15109）——Colliding aiStyle203
   *     分流（:15954-15965）→ StormLightningCollisionCheck（:16205-16243）＝
   *     stormBoltCollides 全口径：localAI[0]==3 浸液导通（500px PlotLine 全液体链,
   *     :16237-16242）∪ MultiPointHitbox bolt 折线 ±8（浸液态下玩家贴折线也中）;
   *   · 伤值（:15110-15118）：FixedSelfDamageForPlayers[1117] 无条目
   *     （ProjectileID.cs:193 表=墓石族 133-143 等）→ value=this.damage（出生已 ×0.8）;
   *     num2=Main.DamageVar(value, −luck)（:15118,厄运→更重掷）;deadMansSweater&&trap
   *     （:15123-15126）——1117 trap=false 恒跳;
   *   · flag=!hostile && type!=949（:15124）=true（1117 friendly）→ 死因归 own 弹
   *     + Hurt pvp 参=true → 本仓 damagePlayer pvp=true（爆炸自伤同款,Game.ts
   *     SELF_HURT_NON_PVP_PROJS 表无 1117）;
   *   · Hurt>0 && !dead → StatusPlayer（:15133-15134）→ 1117→buff 399 BlueLightning
   *     60×Next(4,8)t（:12144-12146,SP_TABLE 表驱动）=「被电到」视觉/状态面。 */
  private selfHurtPlayers(game: GameHooks): void {
    const p = game.player as unknown as
      { x: number; y: number; w: number; h: number; dead?: boolean; iframes?: number;
        luck?: number; lastDamageCause?: unknown } | null | undefined;
    if (!p || p.dead || (p.iframes ?? 0) > 0) return;            // :15106-15107 immune 门
    if (!this.stormBoltCollides(game, p.x, p.y, p.w, p.h)) return; // :15109 Colliding 门
    const rolled = Math.max(1, damageVarRoll(this.damage, -(p.luck ?? 0)));  // :15118
    // 死因 ByProjectile(playerIndex=owner, whoAmI)（:15131）——弹型名 1117 本仓
    // Lang.projectileName 无映射（id-maps 1456 源缺 LightningStrikeShot 键）,
    // 取武器 6155 名（zh 文本与原版 ProjectileName.LightningStrikeShot 逐字同串）。
    (p as { lastDamageCause?: unknown }).lastDamageCause =
      { kind: 'projectile', name: Lang.itemName(6155) ?? '?' };
    const dealt = game.damagePlayer(rolled, this.cx, this.cy, undefined, false, true);
    if (dealt > 0 && !p.dead) statusPlayer(game, 1117, false);   // :15133-15134
  }

  /** Damage_EVP type==1091 终值序列（:14846-14949;1457 :14846-14949 同值序）：
   *  门禁(死亡/无敌 General 免疫槽) → CanParryAgainst(:31673 盾反击窗) /
   *  comboSeed Heal(80)(:14931-14935,置 flag2 吞伤害同效) → 终值链
   *  lightningEvpFinalDamage(DamageVar(-luck) → ×curve(Difficulty) → ×2 → 死囚毛衣)
   *  → Player.Hurt/Game.damagePlayer → trap 成就(WATCH_YOUR_STEP HandleSpecialEvent(4))。
   *  敌体 velocity 本仓未建模（天降雷按 UnitY 参与朝向判别,登记）；
   *  banner/resistCold 两步对 1091 无源跳过（bannerIdToRespondTo=0/coldDamage=false）。 */
  private evpStormBolt(game: GameHooks, hitPt: { x: number; y: number }): void {
    const p = game.player as unknown as {
      cx: number; cy: number; facing?: number; shieldParryTimeLeft?: number;
      luck?: number; hp: number; maxHp: number; dead?: boolean; maxMana?: number;
    };
    // CanParryAgainst（:31673-31679）：shieldParryTimeLeft>0 && sign(boltCenterX−playerCenterX)
    // ==direction && enemyVelocity!=Zero && !immune —— 格挡成功 = 零伤（EVP flag2 短路）
    const parried = ((p.shieldParryTimeLeft ?? 0) > 0)
      && Math.sign(this.cx - p.cx) === (p.facing ?? 1);
    if (this.comboSeed) {
      p.hp = Math.min(p.maxHp, p.hp + 80);                        // Heal(80)（:14933）
      return;
    }
    if (parried) return;
    const dmg = lightningEvpFinalDamage(this.damage, mainDifficulty(game.world), {
      luck: p.luck ?? 0,
      sweater: playerDeadMansSweater(game),
    });
    if (dmg < 1) return;                                          // Hurt <1 丢弃语义
    game.damagePlayer(dmg, hitPt.x, hitPt.y, undefined, false, false);
    // trap 尾段（:14942-14948）：trapDebuffSource 标记本仓无位；成就致死分支保留
    if ((game.player as unknown as { dead?: boolean }).dead) {
      game.achievements?.handleSpecialEvent(4, {
        statLifeMax: p.maxHp,
        statManaMax: (game.player as unknown as { maxMana?: number }).maxMana ?? 20,
      });
    }
  }

  /** 命中域逐敌结算（Damage_PVE_Inner 链——crit/击退/StatusNPC 同 dealContacts 管线;
   *  免疫窗：1117 local −1 / 1122 IDStatic 10 型级共享表 / 1091 local −1）
   *  ★F3 接线判定留档（蓝队四轮）：本面现役弹型 = 1091(无类旗)/1117/1122(magic)——
   *  焰爆石 kind1（melee|ranged）/拍击石 kind0（ranged）两类门对三型恒拒,
   *  原版同真值 ⇒ 无可加行为,不接 projectileSnapStrikeBonus（类门数据单源自证,
   *  未来分流进 melee/ranged 族时按 dealContacts 同款补接即可）。 */
  private damageAlongBolt(game: GameHooks, bolt: Bolt): void {
    const cd = this.sharedCd ?? this.hitCd;
    cd.tick();
    // ★BJ384 小动物命中面（BJ383 登记债清偿——bolt 命中面 critter 桶整缺）：原版
    //  Kill 帧 maxPenetrate=penetrate=-1 前置覆写（:71920-71921 1122 / :71957-71959
    //  1091/1117）→ Damage() 单趟 victim 循环（:12592）【无穿透消耗、无 keepIterating
    //  截断】,全部命中靶各结算一次（numHits++ :14263 无条件——proc ladder 消费;
    //  critter lifeMax≤5 经 flag10 lifeMax>5 段恒不吸血,hitCrittersAll 支只入账不
    //  proc）。几何 = Colliding aiStyle203 全口径（:15951-15965 →
    //  StormLightningCollisionCheck :16205-16243:爆域 64×64+液体导通+MultiPointHitbox
    //  16×16 逐点含容——critter 与敌怪同一条 Colliding 路径,逐靶谓词复用
    //  stormBoltCollides,面与敌怪逐字同源）;结算单源 hitCrittersAll（全结算+hitTest
    //  覆写变体,projTargets.ts）。1091 trap=true（SetDefaults :10179-10186）→ ctx.trap
    //  复位 dontHurtCritters 门（Player.cs:20676-20679——世界落雷照杀小动物）;
    //  critter 一击即死（life=5）⇒ 1122 IDStatic 10t 组窗跨弹无可观测差。桶序先小
    //  动物=BJ383 桶序登记近似（原版 Main.npc 槽序交错）。
    //  1091 comboSeed（noLightning+moreLightning 双种子）治疗支 :12795-12807 在
    //  victim 门后逐靶生效 → critter 照治不伤不入账（同敌面 continue 语义;trap 门
    //  :20676 复位恒放行,无饰品位差）。heal = (int)max(damage×难度乘区,lifeMax×0.1)
    //  （:12798——乘区同 :14630 Damage_GetProjectileSpecificDamageMultiplier）。
    if (this.projId === 1091 && this.comboSeed) {
      const mult = lightningNpcMultiplier(mainDifficulty(game.world));
      for (const cent of game.critters()) {
        const c = cent as unknown as
          { x: number; y: number; w: number; h: number; dead: boolean; hp: number; maxHp: number };
        if (!c || c.dead) continue;
        if (!this.stormBoltCollides(game, c.x, c.y, c.w, c.h)) continue;
        const heal = Math.min(Math.trunc(Math.max(this.damage * mult, c.maxHp * 0.1)),
          c.maxHp - c.hp);
        if (heal > 0) c.hp = Math.min(c.maxHp, c.hp + heal);
      }
    } else {
      this.pveNumHits += hitCrittersAll(this, game,
        this.projId === 1091 ? { trap: true } : undefined,
        (c) => this.stormBoltCollides(game, c.x, c.y, c.w, c.h));
    }
    for (const ent of game.enemies()) {
      const e = ent as unknown as HitTarget & { vanillaId?: number; hp: number; maxHp: number };
      if (!e || e.dead) continue;
      if (!playerCanHitEnemy(ent, game, this.projId)) continue;
      // aiStyle203 Colliding 全口径（bolt 折线 ±8 含容 / 爆域 / 液体导通——A①②）
      if (!this.stormBoltCollides(game, e.x, e.y, e.w, e.h)) continue;
      // ★清偿刀 R1（2026-09-30,D2+D3 收口）：原版序 = :12635 免疫门（拒收 return——
      //  StatusNPC :13634/StrikeNPC :13702/写梯 :14031-14038/numHits++ :14263 全不可达,
      //  零结算零写零耗）→ :12596 表读门 → 结算 → 写梯。旧档 cd.ready（1122=IDStatic
      //  共享表【读+写】）先于免疫门 = 拒收拍先消费 10t 表行（D2：原版写梯受理后才写,
      //  被拒不落表——本拍/下拍本应受理的同型弹反被表行拒）;1117/1091 的 per-bolt
      //  HitCdImpl 单趟循环恒不拒,门位前移零观测。快照仍取 hurt 前态（清偿刀 T 族规）。
      const gateSnap = snapshotVanillaGate(e);
      if (vanillaGateRejected(gateSnap)) continue;                    // :12635 门拒全静默（D3 面）
      if (!cd.ready(e.id, this.projId === 1122 ? 10 : -1)) continue;  // 表行随受理写（D2 面）
      // ★BJ482②（2026-10-03）掷率装配面（:12915-12927 三类掷 owner 装配,与
      //  dealContacts 同源 rollVanillaHitCrit）：1117/1122=magic 旗 → 率=0.04+
      //  magicCrit 聚合/100;1091 无类旗+trap=true（SetDefaults :10178-10186 →
      //  OwnedBySomeone=false :580-589 整 crit 块跳过）→ 零掷——旧固定 0.04 掷=
      //  无中生有（4% 概率世界雷 dmg ×2=伤害面膨胀）。critChance≤0 关断钉保留
      //  （旧掷式对 ≤0 恒假,同 dealContacts 语义显式化）。
      let crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
      // ★BJ486①（2026-10-03）TimerCrit :12928 受理位消费补位（BJ467②/475③ 自建直调面
      //  同族）：1117/1122 ownedBySomeone=true → 三类掷后【无条件】TryConsumingTimerCrit
      //  (targetNPC.Hitbox, ref crit)——6170 蓄能暴击满蓄/负窗照消费并强制 crit（掷率
      //  不达也消费,「零掷≠跳消费」BJ482-2e 同谳）;1091 trap=true → OwnedBySomeone=false
      //  （:580-589）整 crit 块（含本消费）不可达=正确缺位保持（亲读钉死,勿补）。
      //  双 ?. 桩面习语同 dealContacts :483。位次=掷后/尘埃前（:12928 原序）。
      if (this.projId !== 1091 &&
        ((game.player as unknown as
          { tryConsumingTimerCrit?: (g: GameHooks, x: number, y: number, w: number, h: number) => boolean }
          | null)?.tryConsumingTimerCrit?.(game, e.x, e.y, e.w, e.h) ?? false)) {
        crit = true;
      }
      let dmg = crit ? this.damage * 2 : this.damage;
      // 1091 NPC 伤难度乘区（Damage_GetProjectileSpecificDamageMultiplier :14630-14633,
      // 1457 :14632 同式）：×Remap(Main.Difficulty 浮点轴, Classic1, Master3, 1, 3)——
      // 经典 D=1→1 / 专家 D=2→2 / 大师 D=3→3 / 旅程滑杆缺省 D=0.5→clamp 1
      // （★L1 错键修正：曾按 GameMode int 直采 {0..3}）
      if (this.projId === 1091) {
        dmg = Math.round(dmg * lightningNpcMultiplier(mainDifficulty(game.world)));
        // noLightning+moreLightning 组合种子：NPC 伤害改治疗（:12795-12807）——
        // ★BJ389 双臂全式补齐（BJ384 登记下窗清偿）：heal = (int)max(damage×难度乘区,
        //  lifeMax×0.1)（:12803 verbatim——乘区同 :14630 Damage_GetProjectileSpecific
        //  DamageMultiplier 的 1091 臂 → lightningNpcMultiplier;(int) 截断=critter 面
        //  BJ384 同式 Math.trunc）;Min(num4, lifeMax−life) 封顶（:12804）+
        //  HealEffect(num4) 绿字（:12806,CombatText.HealLife='#64FF64'——医师治疗
        //  precedent TownNPC nurseHealUpdate 同通道;弹【未封顶】num4=原版字面）。
        //  realLife 重映射（:12799-12802）→ 仓内 realLifeHost（段 hp 镜像回写
        //  Enemy.hurt :14186-14189 同式）;comboSeed 早退在免疫梯写行/numHits++ 之前
        //  → 不 proc 不计数（BJ383 判例保持）。曾只实现 lifeMax×0.1 单臂
        //  （无 damage×乘区臂、无难度乘区、无 realLife 重映射）。
        if (this.comboSeed) {
          const seg = e as unknown as { realLifeHost?: { dead?: boolean; hp: number; maxHp: number } | null; hp: number; maxHp: number };
          const host = seg.realLifeHost && !seg.realLifeHost.dead ? seg.realLifeHost : seg;
          const num4 = Math.trunc(Math.max(
            this.damage * lightningNpcMultiplier(mainDifficulty(game.world)),
            host.maxHp * 0.1));
          host.hp += Math.min(num4, host.maxHp - host.hp);            // :12804 verbatim
          if (host !== seg) seg.hp = host.hp;                         // 段 hp 镜像（:14188 同式）
          game.addDamageNumber(e.x + e.w / 2, e.y, num4, false, '#64FF64');   // :12806 HealEffect
          continue;
        }
      }
      const kdir = Math.sign(e.x + e.w / 2 - this.cx) || 1;
      // ★D4 写面对齐（清偿刀 R1,2026-09-30）：1122 usesIDStatic 支（:14031-14038,
      //  Kill 覆写 maxPenetrate=penetrate=-1 :71920-71921 ⇒ 内层 :14033 真）真值 =
      //  `immune[owner]=0` 清窗（:14035）+ perIDStatic 静态表行（:14036）——节流归
      //  型级共享表,【非】新开全局窗 ⇒ Enemy.hurt pierce=-2（三不写档,SporeGasCloud
      //  567/568 与 482 判例同式）,静态表行由上方 cd.ready 受理支承载。1117/1091 无
      //  免疫旗 → 走尾档 :14180-14183（penetrate=-1≠1 → immune[owner]=10 新窗）=
      //  pierce=0 面正确不动（1091 hostile 排除同相:SetDefaults :10178-10186 无 magic
      //  行+flag10 !hostile 段,下方 proc 双 magic 门零行为过滤）。
      //  （门已在上方受理面收口——BJ420 旧后置快照+wrapper 退役:到达本位恒受理面,
      //  pveNumHits/proc 无条件达;门拒面 comboSeed 治疗支（:12795-12807 return）随
      //  门位前移一并收口——旧档 iframes>0 敌照治。）
      dmg = runModModifyHitNpcByProj(game.player, game, this.projId,
        (e as unknown as { vanillaId?: number }).vanillaId ?? -1, dmg, crit);   // ★D2:独立结算面补钩
            e.hurt(dmg, kdir * this.knockback, 0, game, this.armorPen, crit,
        this.projId === 1122 ? -2 : 0, true);   // fromPlayer=DPS 计（1122=-2 清窗档,D4）
      // + 催化指环 6185（StatusNPC :11192-11196,玩家弹命中 398 300t）
      //  ★D3 受理面化：StatusNPC :13634 在 :12635 门后 = 拒收不可达（Arrow BJ395
      //  受理面化同族）——门拒 continue 已在上方,此处恒受理面（旧档拒收拍照跑 =
      //  buff 400 照上,判别测试红）。
      applyProjStatus(this.projId, ent as unknown as Record<string, number>,
        { catalystBand: ((game.player as unknown as { equipStats?: { catalystBand?: boolean } } | null)?.equipStats?.catalystBand) === true });
      // ★BJ383 幽灵兜帽吸血 proc（:13877-79 Damage() 通用 on-hit 段;1117/1122 数据面
      //  magic ⇒ 原版本就吸血）——proc 先于 :14263 numHits++（读自增前值）;拒收不
      //  proc 不计数（免疫门 continue 已在上方受理面收口,R1 门位前移）。1091 hostile∧
      //  非 magic（SetDefaults :10178-10186 无 magic 行）经 ghostHealProc magic 门
      //  零行为过滤（flag10 的 !hostile 段同判）。comboSeed 治疗支 continue 在 hurt
      //  前 ⇒ 不达本位=不 proc 不计数（原版 StrikeNPC 不跑,同态）。
      //  ★BJ384：critter 桶已收口（上方小动物命中面——victim 循环同舱,桶序登记）。
      ghostHealProc(game, this.projId, this.pveNumHits,
        e as never as Parameters<typeof ghostHealProc>[3]);
      // ★BJ420 幽灵伤害头 ghostHurt（Projectile.cs:13881 调用点/:12021 方法体,
      //  SpectreSoulProj 单源复用——MagicProj/Arrow/MissileProj/Dart/WeaponProj 既站
      //  同构）：1117/1122 数据面 magic（SetDefaults :10433-10437/:10439-10446
      //  `magic = true`）+ 幽灵面具套装（player.ghostHurt）→ 受害者 Center 放追踪
      //  浮魂弹 356（伤=弹基伤,防后实扣 dealt 只做 >1 门）。用户实报「电弧涌动
      //  （6173→1122）不触发幽灵套」定谳=本缺面。1091 由数据面 magic 门过滤
      //  （SetDefaults :10178-10186 无 magic 行,flag10 !hostile 段同判）。
      if (projectileData(this.projId)?.magic && playerHasGhostHurt(game.player)) {
        ghostHurtOnHit(game,
          { magic: true, projDamage: this.damage,
            projX: this.x, projY: this.y, projW: this.w, projH: this.h,
            ownerCx: game.player.cx, ownerCy: game.player.cy },
          { x: e.x, y: e.y, w: e.w, h: e.h,
            cx: e.x + e.w / 2, cy: e.y + e.h / 2,
            vanillaId: e.vanillaId,
            lifeMax: e.maxHp,
            dealt: (e as unknown as { lastStrikeDealt?: number }).lastStrikeDealt ?? 0 });
      }
      // ★BJ424 星云套装 proc（:13885-13891,ghostHurt 同块同门面）——引擎自持全部门
      // （本类竖落闪电无 vx,projDirX=0 → num40 缺省向 +1）
      nebulaBoosterOnHit(game,
        { projId: this.projId, projDirX: 0 },
        { x: e.x, y: e.y, w: e.w, h: e.h,
          cx: e.x + e.w / 2, cy: e.y + e.h / 2,
          vanillaId: e.vanillaId,
          lifeMax: e.maxHp,
          dealt: (e as unknown as { lastStrikeDealt?: number }).lastStrikeDealt ?? 0 });
      this.pveNumHits++;
    }
  }

  /** Spawn_ArcLightning（P57:1245-1345）+ StormLightningParticle.EmitSpawnDust
   *  （:78-135）：沿线 278（1122 锚手档）/226（1117 天雷档）光尘双画 + 枪口/雷尾
   *  粒子 + Item15/ArcSurge(Item_203) 双音。bolt 折线本体由 draw() 波前扫掠呈现。 */
  private emitBoltFx(game: GameHooks, bolt: Bolt): void {
    const pts = bolt.positions;
    if (pts.length < 2) return;
    const [r, g, b] = this.boltColor;
    const color = { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255), a: 0 };
    // EmitSpawnDust（flag=AnchorToPlayerHand≥0 → 1122 档）：type 278、num4=Remap(
    // 线长,100,500,2,5)、num3=2、num=1.2、color×1.2；1117 档 type 226/num4=10/
    // num3=6/num=1。rotations=null → velocity=UnitY 回退（:103-106）
    const anchored = this.projId === 1122;
    const lineLen = Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y);
    const num4 = anchored ? Math.max(2, Math.min(5, 2 + (lineLen - 100) * (5 - 2) / (500 - 100))) : 10;
    const velMul = anchored ? 1.2 : 1;
    const baseScale = anchored ? 0.7 : 0.4;
    const back = anchored ? 2 : 6;
    const dustType = anchored ? 278 : 226;
    const maxValue = Math.ceil(pts.length / num4);
    // 种子 RNG（EmitSpawnDust :80 new LCG32Random(seed)——与折线同种子独立流）
    const rng = new LCG32(this.seed >>> 0);
    // ★R35：尘速=−rotations[i] 单位向量（:103-106——calcRotations 已开,曾恒 UnitY）
    const rots = bolt.rotations;
    for (let i = 5; i < pts.length - 5; i++) {
      if (rng.next(maxValue) !== 0) continue;
      const p = pts[i];
      const spd = (3 + rng.nextFloat() * 6.5) * velMul;
      const d = game.spawnDust?.(p.x, p.y, 0, 0, dustType, 0, spd, 0, color, baseScale + rng.nextFloat() * 0.5);
      if (d) {
        d.x = p.x; d.y = p.y;                    // NewDustPerfect（:107）
        if (rots) { d.vx = -Math.cos(rots[i]) * spd; d.vy = -Math.sin(rots[i]) * spd; }
        else { d.vx = 0; d.vy = spd; }           // rotations==null 回退 UnitY（:102）
        d.fadeIn = 0;
        d.noGravity = true;
        d.noLight = true; d.noLightEmittance = true;   // steadyLight（:115-118）
        d.x -= d.vx * back; d.y -= d.vy * back;        // position −= velocity×num3
        const d2 = game.vanillaDust?.clone(d);         // CloneDust 白核副画（:124-132）
        if (d2) {
          if (anchored) { d2.vx = d.vx; d2.scale = d.scale * 0.66; d2.color = { r: 255, g: 255, b: 255, a: 0 }; }
          else { d2.vx *= 0.5; d2.scale -= 0.3; }
        }
      }
    }
    // 枪口光斑 + 雷尾电弧（FadingParticle/RandomizedFrameParticle 916 帧近似——
    // 本仓粒子池无 916 贴图帧链,用加算火花近似形态）
    const hand = this.handAnchor(game);
    const end = pts[pts.length - 1];
    game.spawnParticles(hand.x, hand.y, this.projId === 1117 ? '#3C78FF' : '#FF3C3C', 6, 1.6,
      { life: 14, grav: 0, damp: 0.9 });
    game.spawnParticles(end.x, end.y, this.projId === 1117 ? '#3C78FF' : '#FF3C3C', 10, 2.4,
      { life: 20, grav: 0, damp: 0.92 });
    // ★闪电之击专项勘误：Kill 音按型分流——Item15+ArcSurge(Item_203) 双音属
    //   Spawn_ArcLightning（1122 ArcSurge 专支,ParticleOrchestrator.cs:1263-1268）;
    //   1117/1091 走 Spawn_StormLightning 声段（:1055-1060）：
    //   vol = Lerp(0.4,1,outsideWeatherEffectIntensity) 两型同式；
    //   flag=IndexOfPlayerWhoInvokedThis!=255 → 1117(=owner)=LightningStrikeHit
    //   （=style(2,204)=Item_204.wav,pitch 0）/ 1091(=255 自然雷)=InstantThunder
    //   （SoundID.cs:1126 三变体随机）。★声在 Kill 帧（原版编排由 Kill 触发,
    //   Game.spawnStormBolt1091 出手侧不播——2026-08-26 review 修双播+提前 4s）
    if (this.projId === 1122) {
      game.playSfxWav?.('Item_15', 1, hand.x, hand.y);
      game.playSfxWav?.('Item_203', 0.6, hand.x, hand.y, (Math.random() * 2 - 1) * 0.2 - 0.05);
    } else {
      const w = (game.world as unknown as { weather?: { outsideWeatherEffect?: number } }).weather;
      const inten = Math.max(0, Math.min(1, w?.outsideWeatherEffect ?? 1));
      const v = 0.4 + 0.6 * inten;
      if (this.projId === 1117) game.playSfxWav?.('Item_204', v, end.x, end.y);
      else {
        game.playSfxFiles?.(['instant_thunder_0', 'instant_thunder_1', 'instant_thunder_2'],
          v, end.x, end.y);
      }
    }
  }

  /** StormLightningDrawer（:69-115）Canvas 折线近似：逐段梯形带 + 波前扫掠 α。
   *  StripWidth：w×Remap(s,0.5,1,1,0.5)×Remap(progress,0.5,1,1,0.5)(+taperEnd)；
   *  StripColors：waveIn×waveOut 双波门。加算合成。
   *  ★R35 勘误：①anim 按型分流——1117=DefaultAnim(FadeStart.1/Mid.25/End.75/Final0/
   *  WaveLen.5/In.15/Out.75,:45-55),1122=ArcSurge(.1/.4/1/.3/.3/.3/.5,:57-67),曾两型
   *  同套 ArcSurge 参数;②foreach bolts 全画（StormLightningParticle.Draw :257-262）,
   *  叉强度 0.5×0.8^(depth−1)×Intensity;③天端 windup 电花（Update num<0.5 段 :177-227,
   *  d306 顶升/侧向+白核克隆,d226 HackFrame278——draw 侧每帧近似 spawn）。 */
  draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    ctx.save();
    if (this.bolt && this.visualT > 0 && this.bolts.length > 0) {
      const progress = 1 - this.visualT / this.visualTotal;
      const is1117 = this.projId === 1117;
      const anim = is1117
        ? { fadeStart: 0.1, fadeMid: 0.25, fadeEnd: 0.75, final: 0, waveLen: 0.5, waveIn: 0.15, waveOut: 0.75 }
        : { fadeStart: 0.1, fadeMid: 0.4, fadeEnd: 1, final: 0.3, waveLen: 0.3, waveIn: 0.3, waveOut: 0.5 };
      const opacity = remapL(progress, anim.fadeStart, anim.fadeMid, 0.5, 1)
        * remapL(progress, anim.fadeMid, anim.fadeEnd, 1, anim.final);
      const waveInP = remapL(progress, 0, anim.waveIn, 0, 1);
      const waveOutP = remapL(progress, 1 - anim.waveOut, 1, 0, 1);
      // ★P0-B③ 并发钳（vanilla 语义核对定谳 2026-09-25:LightningGenerator.cs
      //  StormLightning MaxForksPerBolt=2/MaxForkDepth=2 → bolts ≤1+2+4=7;
      //  ArcSurge 3/3 → ≤13。本仓克隆生成端同值已封顶——此钳=纯防御位,正常会话
      //  零截断;触发时保主雷(=bolts.Last(),vanilla MainBolt 同位)上屏。
      //  opacity≤ε 早退:全部切片 am≤ε 本就被逐 fill 剔除=逐位等价 no-op。
      if (opacity > 0.004) {
        const n = this.bolts.length;
        const end = Math.min(n, StormLightning.BOLT_DRAW_CAP);
        for (let bi = 0; bi < end; bi++) {
          const b = this.bolts[bi];
          const inten = (b.forkDepth === 0 ? 1 : 0.5 * Math.pow(0.8, b.forkDepth - 1));
          this.drawBolt(ctx, r, b, inten, progress, opacity, anim, waveInP, waveOutP, bi);
        }
        if (n > end) {
          const b = this.bolts[n - 1];   // 主雷恒最后（生成序:forks…主雷收尾）
          const inten = (b.forkDepth === 0 ? 1 : 0.5 * Math.pow(0.8, b.forkDepth - 1));
          this.drawBolt(ctx, r, b, inten, progress, opacity, anim, waveInP, waveOutP, n - 1);
        }
      }
    } else {
      // 飞行期本体贴图（:40450-40455 光强包络近似亮度）
      const img = projSprite(this.projId);
      const T = this.t / this.life;
      const glow = Math.sqrt(Math.max(0, 1 - Math.pow(2 * Math.min(1, T / 0.5) - 1, 2))) * 0.3 + 0.75;   // ★回炉:底亮 0.4→0.75(悬浮期光球可读性)
      // ★回炉:加算白芯辉光盘（vanilla 风窗粒子云的观感等价——贴图本体是暗蓝小纹,
      //   仅 source-over 叠画=用户实拍"很暗"的 orb 期主源）
      const [gcr, gcg, gcb] = this.boltColor;
      ctx.globalAlpha = Math.max(0.15, Math.min(1, glow));
      ctx.translate(this.cx, this.cy);
      // ★辉光盘必须在 translate 之后（曾画在世界原点=不可见）
      ctx.globalCompositeOperation = 'lighter';
      const grd = ctx.createRadialGradient(0, 0, 1, 0, 0, 16);
      grd.addColorStop(0, `rgba(255,255,255,${(0.85 * glow).toFixed(3)})`);
      grd.addColorStop(0.45, `rgba(${Math.round(gcr * 255)},${Math.round(gcg * 255)},${Math.round(gcb * 255)},${(0.5 * glow).toFixed(3)})`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(-16, -16, 32, 32);
      ctx.globalCompositeOperation = 'source-over';
      ctx.imageSmoothingEnabled = false;
      if (img && img.width > 0) {
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
      } else {
        ctx.fillStyle = this.projId === 1117 ? '#3C78FF' : '#FF3C3C';
        ctx.fillRect(-8, -24, 16, 48);
      }
    }
    ctx.restore();
  }

  private drawBolt(ctx: CanvasRenderingContext2D, r9: import('../render/Renderer').Renderer,
    bolt: Bolt,
    intensity: number, progress: number, opacity: number,
    anim: { waveLen: number; waveIn: number; waveOut: number },
    waveInP: number, waveOutP: number, bi = 0): void {
    const pts = bolt.positions;
    if (pts.length < 2) return;
    // Prepare 的 width 参（StormLightningParticle._Prepare → Spawn_StormLightning
    // :1048 `num2 = flag ? 12 : 16`——1117 武器雷 12 / 1091 世界雷 16）
    const W = this.projId === 1091 ? 16 : 12;
    // 波前双门（WaveTransition :88-91,anim 按型——R35 勘误:1117=DefaultAnim 曾误套 ArcSurge）
    const waveIn = Math.min(1, Math.max(0, waveInP));
    const waveOut = Math.min(1, Math.max(0, waveOutP));
    const taperEnd = bolt.progressRange.max < 1;
    const [cr, cg, cb] = this.boltColor;
    const range = bolt.progressRange;
    ctx.globalCompositeOperation = 'lighter';
    // ★P0-B① 专用化通道（2026-09-25 雷击风暴定谳续刀）：bolt 几何视觉期恒定
    //  （LightningGenerator.Generate 生成后 positions 冻结,变的只有波前 α/强度/
    //  宽度包络）→ 整 bolt K=6 切片烘进【一张】scratch(1 次栅格化+1 次上传+
    //  1 个 ADD quad),替代逐切片 fill——旧链在 acc shim 态=每 fill 走
    //  rasterizePathOp 隔离栅格化+即发即弃 texImage2D(2000-3500 次/雷帧≈11ms
    //  上传风暴,雷单独砍半帧率)。vanilla 同构锚:StormLightningDrawer.Draw 每
    //  bolt 一次 VertexStrip PrepareStrip+DrawTrail=一次 draw call。
    //  像素等价性:①切片几何/配色/α 逐参同源(emit 闭包单实现,烘焙与兜底共 consumption);
    //  ②'lighter' 纯加算+8bit 逐加钳=min 单调性⇒「先钳底再合加」与逐加逐位同;
    //  ③整数设备平移(-fx,-fy) 下栅格化覆盖率逐位不变(rasterizeOp 判例);
    //  ④α 烘入 scratch,blit 时 globalAlpha 钉 1 防二次乘。
    //  失败(退化 CTM/面超 4096 帽)→false 走下方兜底=原链逐切片直画(逐字节同参)。
    const emitSlices = (g: CanvasRenderingContext2D): void => {
      for (let i = 0; i < pts.length - 1; i++) {
        const s0 = range.min + (range.max - range.min) * (i / (pts.length - 1));
        const s1 = range.min + (range.max - range.min) * ((i + 1) / (pts.length - 1));
        // 波前双门（WaveTransition :88-91）
        const a0 = waveGate(s0, waveIn, anim.waveLen, 0, 1) * waveGate(s0, waveOut, anim.waveLen, 1, 0);
        const a1 = waveGate(s1, waveIn, anim.waveLen, 0, 1) * waveGate(s1, waveOut, anim.waveLen, 1, 0);
        if (a0 <= 0.004 && a1 <= 0.004) continue;
        const w0 = stripWidthAt(s0, W, progress, taperEnd, bolt) * intensity;
        const w1 = stripWidthAt(s1, W, progress, taperEnd, bolt) * intensity;
        const dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y;
        const l = Math.hypot(dx, dy) || 1;
        const px = -dy / l, py = dx / l;
        const am = (a0 + a1) / 2 * opacity;
        if (am <= 0.004) continue;
        // ★StormLightning shader 复刻（PixelShader.cso pass StormLightning）：
        //   片元色=vColor×(Extra_288.r×8×uOpacity×uSaturation)——条带横向 K 切片,
        //   每片按 v 采 LUT 亮度:中央亮带×8 过曝=白热芯,上下暗=蓝辉光边
        //   ('lighter' 加算,fill alpha=波门,rgb 折增益)
        const K = 6;
        for (let k9 = 0; k9 < K; k9++) {
          const v9 = (k9 + 0.5) / K;
          const lut = stormTexBrightness(r9, v9);
          // ★C2 勘误（字节码 :3207-3210 writemask）：×8×uOpacity×uSaturation 增益链
          //   只写 r0.x【红通道】——末指令 mul r0.xyzw,r0,v0 逐通道展开后 G/B=
          //   tex.g/b×vColor 不吃增益。曾三通道全乘 → 边带亮度比 2.77× 偏差
          const gainR = lut * 8 * opacity * intensity;
          // vColor=StormLightningDrawer 白顶点色（StripColors=White——蓝调由风窗粒子/
          //   光 tint 承担;曾用 GetLightningColor 蓝基 → C2 分通道后亮度重心崩塌）
          const wcr = 1 - (1 - cr) * 0.35, wcb = 1 - (1 - cb) * 0.35;
          const e9r = Math.min(255, wcr * 255 * gainR);
          const e9g = Math.min(255, 255 * lut * (1 - (1 - cg) * 0.35));
          const e9b = Math.min(255, wcb * 255 * lut);
          if (e9r + e9g + e9b < 6) continue;
          const sw0 = w0 / K, sw1 = w1 / K;
          const o0 = -w0 / 2 + k9 * sw0, o1 = -w1 / 2 + k9 * sw1;
          g.fillStyle = `rgba(${e9r | 0},${e9g | 0},${e9b | 0},${Math.min(1, am).toFixed(3)})`;
          g.beginPath();
          g.moveTo(pts[i].x + px * o0, pts[i].y + py * o0);
          g.lineTo(pts[i + 1].x + px * o1, pts[i + 1].y + py * o1);
          g.lineTo(pts[i + 1].x + px * (o1 + sw1), pts[i + 1].y + py * (o1 + sw1));
          g.lineTo(pts[i].x + px * (o0 + sw0), pts[i].y + py * (o0 + sw0));
          g.closePath();
          g.fill();
        }
      }
    };
    if (!StormLightning.BOLT_BAKE_OFF && intensity > 0 && this.bakeBolt(ctx, r9, pts, W, intensity, emitSlices, bi)) {
      ctx.globalCompositeOperation = 'source-over';
      return;
    }
    emitSlices(ctx);   // 兜底=原链逐切片直画(仅烘焙失败可达;正常会话零走)
    ctx.globalCompositeOperation = 'source-over';
  }

  /** ★P0-B① 整 bolt 一次烘焙（2026-09-25 雷击风暴定谳续刀——emit 闭包单源,
   *  本方法只管 scratch 几何+发射）：设备域保守 bbox→scratch 同 CTM 整数平移
   *  重放全部切片→markWorldDynamicScratch(1 次 texRefresh 上传)+1 个 ADD quad。
   *  返 false=走原链兜底(退化 CTM/面超 4096 帽/无 2D)。 */
  private bakeBolt(ctx: CanvasRenderingContext2D, r9: import('../render/Renderer').Renderer,
    pts: ReadonlyArray<{ x: number; y: number }>, W: number, intensity: number,
    emit: (g: CanvasRenderingContext2D) => void, bi = 0): boolean {
    if (typeof document === 'undefined') return false;
    const M = ctx.getTransform();
    const { a, b, c, d, e, f } = M;
    if (!(Math.abs(a * d - b * c) >= 1e-12)) return false;   // 退化 CTM→原链
    // 保守设备 bbox:角=pt±perp·o(|o|≤w/2,|perp|=1)——stripWidthAt 有 0.5 下限,
    // 半宽 ≤ max(W·intensity,0.5)/2;设备域半径 ≤ ‖M‖F·半宽(Frobenius 上界 superset)
    const scale = Math.sqrt(a * a + b * b + c * c + d * d);
    const halfW = Math.max(W * intensity, 0.5) / 2;
    const pad = scale * halfW + 1;
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const px = a * pts[i].x + c * pts[i].y + e;
      const py = b * pts[i].x + d * pts[i].y + f;
      if (px - pad < bx0) bx0 = px - pad;
      if (px + pad > bx1) bx1 = px + pad;
      if (py - pad < by0) by0 = py - pad;
      if (py + pad > by1) by1 = py + pad;
    }
    const fx = Math.floor(bx0), fy = Math.floor(by0);
    const sx = Math.ceil(bx1) - fx, sy = Math.ceil(by1) - fy;
    if (!(sx > 0 && sy > 0) || sx > 4096 || sy > 4096) return false;
    const sc = boltScratch(sx, sy);
    if (!sc) return false;
    const sctx = sc.getContext('2d', { willReadFrequently: true });
    if (!sctx) return false;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, sx, sy);
    // 整数设备平移 (−fx,−fy) 后同 CTM 重放=栅格化覆盖率与原位逐位同(rasterizeOp 判例);
    // 环境态(α/filter)取自 ctx 镜像——与原链逐 fill 的生效态同源
    sctx.setTransform(a, b, c, d, e - fx, f - fy);
    sctx.globalAlpha = ctx.globalAlpha;
    sctx.globalCompositeOperation = 'lighter';
    try { sctx.filter = ctx.filter; } catch { /* 非法值保缺省 */ }
    emit(sctx);
    // ★I类(2026-09-27):稳定键 bake 期立即上传——共享 boltScratch 同帧多雷烘焙
    //   （1 实体 ≤7 bolts/ArcSurge ≤13×3 发）时,flush 期 texRefresh 全读末次字节
    //   =先行 bolt quad 错拿内容（定谳机制链见 GLShimExecutor.uploadScratchNow）。
    //   ★R3b-2③（2026-09-27 红蓝批 β）：键改「帧界环形」uploadScratchBake
    //   （boltBake 族,帧内序号环 1024）——旧 (实体 id,bolt 序号) 键在实体死亡后
    //   永久驻留层 texs 表（LRU 兜底但顶替活纹理+键空间随弹体 id 无界）;帧界键
    //   保同帧唯一性（I类判据不变）,跨帧自然退休。
    //   ★P1-B(2026-09-28)：携带子区 (sx,sy)=烘焙 bbox（blit 下行 drawImage 实采
    //   域,见本函数尾部）——雷暴持续期 boltScratch 恒大（滞回回落不触发）时按
    //   p1bRegionGate 分档走 texRefreshRegion 子区增量（上传=子区而非整张面）;
    //   子区≥半幅时门内自动保整幅精确链（收益与风险同 accScratch 族判）。
    r9.uploadScratchBake(sc, 'boltBake', 1024, sx, sy);
    // blit:恒等 CTM+α 钉 1(α/滤镜均已烘入 scratch)——acc shim 态=1 个 ADD quad 入队
    // (flush 时一次 texRefresh),裸 2D 态=一次 drawImage。★滤镜钉 none:shim 对
    // filter≠none 的 drawImage 走 rawDrawImage 整帧降级,而滤镜语义已由 bake 面承担
    // (与 rasterizePathOp 同构——栅格化面施加滤镜,发射 quad 不再带)。
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    if (ctx.filter !== 'none') { try { ctx.filter = 'none'; } catch { /* 非法值忽略 */ } }
    ctx.drawImage(sc, 0, 0, sx, sy, fx, fy, sx, sy);
    ctx.restore();
    return true;
  }
}

/** ★P0-B bolt 烘焙 scratch（模块级复用;CanvasWatch churn 判例禁逐帧新建;
 *  willReadFrequently=R3-F8 判例——纯上传中转面,无 readPixels 读回需求）。
 *  ★R3b-2①（2026-09-27 红蓝批 β）回落支：旧「只增不减」让单次巨 bolt（离群
 *  bbox 4096² 帽）把面永久撑大——此后每 bolt 整幅上传 2.6-6.5MB/帧（峰值
 *  50MB/s）。现需求 ≤ 当前一半（滞回防抖）时缩回 max(基线 256,本次需求):
 *  离群帧后一次小 bake 即回归基线;resize 自动清屏,烘焙路径首行 clearRect
 *  语义不变（尺寸回落与 texRefresh 的换尺寸重建通道天然衔接）。 */
let _boltScratch: HTMLCanvasElement | null = null;
const BOLT_SCRATCH_BASE = 256;
function boltScratch(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  if (!_boltScratch) {
    _boltScratch = document.createElement('canvas');
    _boltScratch.width = BOLT_SCRATCH_BASE;
    _boltScratch.height = BOLT_SCRATCH_BASE;
  }
  const cw = _boltScratch.width, ch = _boltScratch.height;
  if (w > cw || h > ch) {
    if (w > cw) _boltScratch.width = w;      // 涨:直接扩到需求(尺寸变化自动清屏)
    if (h > ch) _boltScratch.height = h;
    return _boltScratch;
  }
  if (w * 2 <= cw && h * 2 <= ch) {          // 滞回:需求≤当前一半才缩
    const tw = Math.max(BOLT_SCRATCH_BASE, w), th = Math.max(BOLT_SCRATCH_BASE, h);
    if (tw < cw || th < ch) { _boltScratch.width = tw; _boltScratch.height = th; }
  }
  return _boltScratch;
}

/** StripWidth（:104-115）单点宽度 */
function stripWidthAt(s: number, width: number, progress: number,
  taperEnd: boolean, bolt: Bolt): number {
  let w = width;
  w *= remapL(s, 0.5, 1, 1, 0.5);
  w *= remapL(progress, 0.5, 1, 1, 0.5);
  if (taperEnd) {
    w *= remapL(bolt.progressRange.max - s, 0.1, 0, 1, bolt.isMainBolt ? 0.5 : 0);
  }
  return Math.max(0.5, w);
}

/** WaveTransition（:88-91）＝Remap(progressOnStrip, lerp(−len,1,waveProgress),
 *  lerp(0,1+len,waveProgress), to, from) */
function waveGate(s: number, waveProgress: number, len: number, from: number, to: number): number {
  const a = -len + (1 + len) * waveProgress;
  const b = 0 + (1 + len) * waveProgress;
  return remapL(s, a, b, to, from);
}

/** Utils.Remap（clamp 版,本文件局部用——LightningGenerator.remap 不导出重复） */
function remapL(fromValue: number, fromMin: number, fromMax: number,
  toMin: number, toMax: number): number {
  const t = Math.min(1, Math.max(0, (fromValue - fromMin) / ((fromMax - fromMin) || 1e-9)));
  return toMin + (toMax - toMin) * t;
}

// ================= 1115 冰川之牙蓄力弹（AI_208_GlacierFangShot） =================

/** 6153 GlacierFang（channel 蓄力,Item.cs:47423-47434 channel=true）出手即生成挂手弹,
 *  AI_208（:37576-37750）两态：
 *  - 蓄力态（ai1==0）：挂玩家 RotatedRelativePoint(MountedCenter)、每 3t 朝鼠标转向
 *    （速 Remap(ai0,0,60,4,15)）、每 20t 播 GlacierFang_Charging + CheckMana 扣蓝
 *    （ai0≤60）、ai0 += GetSlowMagicUseRate()（1.0 常态/0.4 空蓝,Player.cs:47434-47442）；ai0≥60 强制松手（:37628）
 *  - 释放态（ai1==1 首帧）：伤 ×Remap(charge,0,60,1,4)、kb ×4、penetrate 1→3、
 *    Muzzle 音 + 15 组尘；此后 extraUpdates 1-2、重力 Remap(charge,0,45,0.15,0.025)
 *    钳 vy 16、tileCollide=true
 *  - 帧 0/1/2 按 charge 20/40 分档；蓝光 (0.2,0.5,0.8)×Remap(charge,0,60,0.5,1)
 *  - SetDefaults（:10468-10480）：10×10、usesLocalNPCImmunity + cooldown −1 */
export interface GlacierFangCtl {
  /** Player.channel 电平（按住蓄力）+ 死亡/CC 门 */
  channel: () => boolean;
  /** 当前鼠标世界坐标 */
  aim: () => { x: number; y: number };
  /** CheckMana(pay:true)（每 20t 蓄力扣蓝；ManaV2 蓝不足照充） */
  payMana: () => void;
  /** GetSlowMagicUseRate()（1.0 正常 / 0.4 空蓝过载,Player.cs:47434-47442） */
  chargeRate: () => number;
}

/** ★BJ248 蓝光系数单源（Projectile.cs:37696 verbatim;BJ245 whiteK811 同款单源式）：
 *  AddLight 在蓄力/释放 if-else 之后的公共尾段【逐拍】跑：
 *  (0.2,0.5,0.8) × Remap(ai0,0,60,0.5,1)——蓄力期 0.5→1.0 爬升（ai0=0 端恰=旧钉死
 *  (0.1,0.25,0.4),即旧实现只画对了第 0 拍）；释放后 ai0 冻结在松手值（满蓄=1.0、
 *  半蓄=0.75,旧实现恒满亮=端点二值化双错）。Remap clamp 语义同 :1902 习语。 */
export function glacierFangLightK(charge: number): number {
  const c = Math.min(1, Math.max(0, charge / 60));
  return 0.5 + (1 - 0.5) * c;
}

export class GlacierFangShot extends Entity {
  w = 10; h = 10;
  damage: number;
  knockback: number;
  critChance = 0.04;
  armorPen = 0;
  dead = false;
  magicProj = true;
  readonly projId = 1115;
  private charge = 0;        // ai[0]
  private released = false;  // ai[1]==1
  private frame = 0;
  /** ★R34-③：penetrate=(int)Remap(charge/60,0,1,1,3)（:37651）命中总数帽（1..3 档） */
  private penTier = 1;
  private hits = 0;
  /** ★X2-D4（2026-09-29）：PVP 读口写位（projPveNumHits 单源读 pveNumHits,原读恒 0 档
   *  =计数域在 hits）。写位与 hits 同面同步自增（受理位 :14263 numHits++ 等位,critter
   *  受理命中亦入账）;hits 现语义（proc ladder 实参+penTier 帽判）不动。 */
  pveNumHits = 0;
  private hitCd = new HitCdImpl();
  /** Projectile.timeLeft 等价（蓄力期每拍重置 300 :37596；释放后 300 递减归零
   *  Kill=释放冰矛 5 秒寿命——曾无上限,开阔天空永不消亡=无限堆积,用户实报） */
  private life = 300;
  private ctl: GlacierFangCtl;

  constructor(x: number, y: number, dirX: number, dirY: number, damage: number, knockback: number, ctl: GlacierFangCtl) {
    super();
    this.x = x - this.w / 2; this.y = y - this.h / 2;
    const n = Math.hypot(dirX, dirY) || 1;
    this.vx = dirX / n * 4; this.vy = dirY / n * 4;
    this.damage = Math.max(1, Math.round(damage));
    this.knockback = knockback;
    this.ctl = ctl;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    const p = game.player;
    if (!this.released) {
      // ---- 蓄力态（:37579-37630）----
      if (!this.ctl.channel() || this.charge >= 60) {
        this.release(game, p);
        return;
      }
      // channel 蓄力期用魔动画续期（Player.cs:43143-43146 itemAnimation 持续>0 每帧
      // ItemCheck_ApplyManaRegenDelay → delay 钉 4 = 全程 5% 滴流回蓝；2026-08-22
      // 审计 ❌ 修复——蓄力最长 60 拍(慢施 ÷2.5=150t)远超 useTime,不续期则白嫖魔力）
      p.onChannelManaHold?.();
      // ★手持动画续期（channel 语义:蓄力期 itemAnimation 钉满,手持法杖全程举向
      //  鼠标不脱落——swing 窗 24t 远短于蓄力,不续则法杖中途消失,用户实报）。
      //  ★aim 同步续期（:50382 itemRotation 逐帧跟鼠标——曾冻结在出手瞬间,
      //  鼠标一动法杖与冰矛分离=冰矛"长在身上"不挂杖,用户实报）
      const mAim = this.ctl.aim();
      game.refreshChannelItem?.(Math.atan2(mAim.y - p.cy, mAim.x - p.cx));
      this.life = 300;                                       // :37596 timeLeft=300 每拍重置
      const m = this.ctl.aim();
      // 挂手：RotatedRelativePoint(MountedCenter) − Size/2（:37587）
      this.x = p.cx - this.w / 2;
      this.y = p.cy - this.h / 2;
      // 蓄力态同样每拍 CutTiles（Damage() 对 active 弹无条件跑,1115 不在
      // Damage_CanDealDamage :12461 排除表——挂手弹盒扫到瓦罐/草即碎,原版同态）
      cutTilesBox(game, this.x, this.y, this.w, this.h);
      if (Math.floor(this.charge) % 3 === 0) {
        const spd = 4 + (15 - 4) * Math.min(1, Math.max(0, this.charge / 60));   // Remap(ai0,0,60,4,15)
        const d = Math.hypot(m.x - p.cx, m.y - p.cy) || 1;
        this.vx = (m.x - p.cx) / d * spd;
        this.vy = (m.y - p.cy) / d * spd;
      }
      if (Math.floor(this.charge) % 20 === 0 && this.charge > 0) {
        // R4-37：GlacierFang_Charging=Item_210（Projectile.cs:37610-37613 soundDelay=20 节拍;
        // 文件级音量 ×0.35=LegacySoundPlayer.cs:579 case210,FILE_CASE_VOL 自动生效）
        game.playSfxWav?.('Item_210', 1, this.cx, this.cy);
        this.ctl.payMana();                                    // CheckMana(pay:true)（:37613）
      }
      this.charge += this.ctl.chargeRate();                    // ai[0] += GetSlowMagicUseRate()（:37626）
      // ★BJ248 :37696 公共尾段光=动态 Remap（蓄力 0.5→1.0 爬升）,glacierFangLightK 单源
      const lk = glacierFangLightK(this.charge);
      game.addLightAt?.(this.cx, this.cy, 0.2 * lk, 0.5 * lk, 0.8 * lk);
      if (Math.random() < 0.34) {
        game.spawnParticles(this.cx, this.cy, '#BFE8FF', 1, 1, { life: 16, grav: 0, damp: 0.92 });
      }
      return;
    }
    // ---- 释放态（:37632-37664）----
    this.x += this.vx;
    this.y += this.vy;
    this.vy += 0.15 + (0.025 - 0.15) * Math.min(1, Math.max(0, this.charge / 45));  // Remap(ai0,0,45,0.15,0.025)
    if (this.vy > 16) this.vy = 16;
    // CutTiles（Damage→CutTiles 每拍旁路,:12517/:15276;CanCutTiles 排除表无 1115）：
    // 瓦罐等非实心 tileCut 物弹盒扫到即碎——曾整缺=冰矛穿罐不碎（2026-08-26 用户报）
    cutTilesBox(game, this.x, this.y, this.w, this.h);
    // ★寿命帽（timeLeft=300 蓄力期每拍重置 :37596,释放后递减归零 Kill=5 秒寿命——
    //  此前无上限,开阔地释放的冰矛永不消亡=多次施法无限堆积,用户实报蓄力贴图异常）
    this.life = (this.life ?? 300) - 1;
    if (this.life <= 0) { this.dead = true; return; }
    // 撞实心 → 消亡（tileCollide=true :37644）
    const st = game.world.store;
    const tx = Math.floor(this.cx / TILE), ty = Math.floor(this.cy / TILE);
    if (st.inBounds(tx, ty) && st.isSolid(tx, ty)) {
      game.spawnParticles(this.cx, this.cy, '#BFE8FF', 8, 2.4, { life: 20, grav: 0.04, damp: 0.94 });
      this.dead = true;
      return;
    }
    // ★BJ248 :37696 同一公共尾段光——释放态 ai0 冻结在松手值（非恒满亮）
    const lk = glacierFangLightK(this.charge);
    game.addLightAt?.(this.cx, this.cy, 0.2 * lk, 0.5 * lk, 0.8 * lk);
    // ★R34-③：释放穿透档 penetrate=(int)Remap(num5,0,1,1,3)（:37651）——命中总数帽
    // ★BJ383 小动物命中面（BJ381 登记债清偿）：释放态 penetrate=1..3 档 → critter
    //  受击耗一档（:14184 递减,归零 :17312 Kill;未耗尽弹体续飞）。hits 即 numHits
    //  单计数（:14263 critter 受理命中亦入账——吸血 proc ladder 依赖同一计数）。
    if (hitCritters(this, game)) {
      this.hits++;
      this.pveNumHits++;                                     // ★X2-D4 写位（与 hits 同面）
      if (this.hits >= this.penTier) { this.dead = true; return; }   // keepIterating=false
    }
    dealContacts(this, game, this.hitCd, -1, (t) => {
      // ★BJ383 幽灵兜帽吸血 proc（:13877-79 Damage() 通用 on-hit 段;1115 magic
      //  :10469）——hits 读自增前值（:14263 numHits++ 在 proc 后 ⇒ 首跳 0 档率 0.20）。
      ghostHealProc(game, this.projId, this.hits,
        t as never as Parameters<typeof ghostHealProc>[3]);
      // ★BJ420 幽灵伤害头 ghostHurt（Projectile.cs:13881/:12021,SpectreSoulProj 单源）：
      //  1115 数据面 magic（:10464-10470）+ 幽灵面具套装 → 受害者 Center 放浮魂 356。
      //  受理面 = dealContacts 内环免疫门（红蓝-L1①,同 1116 站注）。
      if (playerHasGhostHurt(game.player)) {
        const v420 = t as never as { vanillaId?: number | null; lastStrikeDealt?: number;
          maxHp?: number; def?: { lifeMax?: number } };
        ghostHurtOnHit(game,
          { magic: true, projDamage: this.damage,
            projX: this.x, projY: this.y, projW: this.w, projH: this.h,
            ownerCx: game.player.cx, ownerCy: game.player.cy },
          { x: t.x, y: t.y, w: t.w, h: t.h,
            cx: t.x + t.w / 2, cy: t.y + t.h / 2,
            vanillaId: v420.vanillaId,
            lifeMax: v420.maxHp ?? v420.def?.lifeMax,
            dealt: v420.lastStrikeDealt ?? 0 });
      }
      // ★BJ424 星云套装 proc（:13885-13891,ghostHurt 同块同门面）——引擎自持全部门
      nebulaBoosterOnHit(game,
        { projId: this.projId, projDirX: this.vx },
        { x: t.x, y: t.y, w: t.w, h: t.h,
          cx: t.x + t.w / 2, cy: t.y + t.h / 2,
          vanillaId: (t as never as { vanillaId?: number | null }).vanillaId,
          lifeMax: (t as never as { maxHp?: number; def?: { lifeMax?: number } }).maxHp
            ?? (t as never as { def?: { lifeMax?: number } }).def?.lifeMax,
          dealt: (t as never as { lastStrikeDealt?: number }).lastStrikeDealt ?? 0 });
      this.hits++;
      this.pveNumHits++;                                     // ★X2-D4 写位（与 hits 同面）
      if (this.hits >= this.penTier) this.dead = true;          // penetrate 耗尽 → Kill
    });
  }

  /** 释放帧（:37632-37660）：伤 ×Remap(charge,0,60,1,4)/kb ×4/pen 1→3
   *  （★R34-③ 已接：penTier=hits 总帽,cooldown −1 维持每敌一次）+ 出膛抖动 */
  private release(game: GameHooks, p: { cx: number; cy: number }): void {
    this.released = true;
    const c = Math.min(1, Math.max(0, this.charge / 60));
    if (this.charge >= 10) {                                   // ai[0]<10 → num5=0（:37638-37640）
      this.damage = Math.max(1, Math.round(this.damage * (1 + 3 * c)));
      this.knockback *= 4;
      // num7=(int)Remap(charge/60,0,1,1,3)（:37648-37650）——C# 截断,1..3 档
      const n5 = Math.min(1, Math.max(0, this.charge / 60));
      this.penTier = Math.max(1, Math.trunc(1 + (3 - 1) * n5));
    } else {
      this.knockback *= 1;
      this.penTier = 1;                                        // ai[0]<10 → num5=0 → pen=1
    }
    // 出膛抖动（:37641）+ 无 LOS 门消亡（:37652-37654）
    const jx = (Math.random() * 2 - 1) * (1 - c);
    const jy = (Math.random() * 2 - 1) * (1 - c);
    this.vx += jx; this.vy += jy;
    const st = game.world.store;
    const tx = Math.floor(this.cx / TILE), ty = Math.floor(this.cy / TILE);
    if (st.inBounds(tx, ty) && st.isSolid(tx, ty)) { this.dead = true; return; }
    void p;
    // R4-37：GlacierFang_Muzzle=Item_201 pitch+0.2（Projectile.cs:37634 PlaySound(...,0.2f)）
    game.playSfxWav?.('Item_201', 1, this.cx, this.cy, 0.2);
    game.spawnParticles(this.cx, this.cy, '#BFE8FF', 10, 2.6, { life: 20, grav: 0, damp: 0.93 });
  }

  draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const img = projSprite(1115);
    this.frame = this.charge >= 40 ? 2 : this.charge >= 20 ? 1 : 0;   // :37666-37672
    const aim = Math.atan2(this.vy, this.vx);
    ctx.save();
    ctx.globalAlpha = this.released ? 1 : 0.9;
    // ★蓄力态锚=手持法杖位（MountedCenter+aim×staffReach 6,与 drawUseItem 杖支
    //  同锚）,矛【尾】贴锚、沿瞄准方向从杖上向外生长（原版观感:冰矛叠在法杖上
    //  从手伸出——曾居中玩家盒中心=半截长在角色身上,用户三次实报）。
    //  释放态=居中飞行体（原版 DrawProjectiles 居中同款）
    const staffAx = Math.cos(aim) * 6, staffAy = Math.sin(aim) * 6;
    if (!this.released) {
      ctx.translate(this.cx + staffAx, this.cy + staffAy);
      ctx.rotate(aim + Math.PI / 2);
      ctx.imageSmoothingEnabled = false;
      if (img && img.width > 0) {
        const fh = img.height / 3;
        // 矛尾钉锚:精灵【底边】(帧底=尾)在锚上,沿旋转后的"上"=瞄准方向伸出
        ctx.drawImage(img, 0, Math.round(this.frame * fh), img.width, Math.round(fh),
          -img.width / 2, -fh, img.width, fh);
      } else {
        ctx.fillStyle = '#8FD8FF';
        ctx.fillRect(-5, -28, 10, 28);
      }
      ctx.restore();
      return;
    }
    ctx.translate(this.cx, this.cy);
    ctx.rotate(aim + Math.PI / 2);
    ctx.imageSmoothingEnabled = false;
    if (img && img.width > 0) {
      const fh = img.height / 3;
      ctx.drawImage(img, 0, Math.round(this.frame * fh), img.width, Math.round(fh),
        -img.width / 2, -fh / 2, img.width, fh);
    } else {
      ctx.fillStyle = '#8FD8FF';
      ctx.fillRect(-5, -14, 10, 28);
    }
    ctx.restore();
  }
}

// ================= 1128/1129 生成器（SpawnChlorophyteSporeCloud :42616-42733 纯函数） =================

/** FindChlorophyteSporeCloudSpawn（:42565-42590；1457 :42565 同构）：
 *  扫描窗 = 刃尖列 num2/行 num3 ± 出手侧 5 格 ×竖 [−2..2]，筛"solid 且上格空"台面；
 *  距离度量 num6 = |原 spawnPosition(刃尖) − 候选格中心((num2+i)*16+8,(num3+j)*16−8)|
 *  **按候选自己那列**取近（★A③ 勘误：曾以返回位 sx=基准列横距代替——跨列候选全
 *  同距，行选择退化为"最左扫描命中"，最多偏一行）；返回值仍钉
 *  `spawnPosition.X = vector2.X`（基准列中心,:42587——winning 列只进度量不进返回!）
 *  与 `spawnPosition.Y = (num3+j)*16 − 8`（中奖行顶）。找不到返回 null。 */
export function findSporeCloudSpawn(
  st: { inBounds(x: number, y: number): boolean; isSolid(x: number, y: number): boolean },
  tipX: number, tipY: number, dirX: number,
): { x: number; y: number } | null {
  const tx0 = Math.floor(tipX / TILE);
  const ty0 = Math.floor(tipY / TILE);
  const iLo = dirX > 0 ? -5 : 0;
  const iHi = dirX > 0 ? 0 : 5;
  let bestSy: number | null = null;
  let bd = Number.POSITIVE_INFINITY;
  for (let i = iLo; i <= iHi; i++) {
    for (let j = -2; j <= 2; j++) {
      const tx = tx0 + i, ty = ty0 + j;
      if (!st.inBounds(tx, ty) || !st.inBounds(tx, ty - 1)) continue;
      if (st.isSolid(tx, ty) && !st.isSolid(tx, ty - 1)) {
        // 度量用【候选列】中心（:42583 num6 右操作数）;基准列 X 只决定返回值
        const cx9 = tx * TILE + 8;
        const cy9 = ty * TILE - 8;
        const d = Math.hypot(tipX - cx9, tipY - cy9);
        if (d < bd) { bd = d; bestSy = ty * TILE - 8; }
      }
    }
  }
  return bestSy == null ? null : { x: tx0 * TILE + 8, y: bestSy };
}

export interface SporeCloudSpawnCtx {
  /** NewProjectile 1128（Game 注入 entities.add） */
  spawnCloud: (x: number, y: number, vx: number, vy: number, dmg: number) => void;
  /** NewProjectile 1129（大爆炸盒 128×96,伤 ×1） */
  spawnSlam: (x: number, y: number, dmg: number) => void;
  /** 该玩家在场 1128 计数（ownedProjectileCounts[1128],衰减掷 :42633） */
  ownedClouds: () => number;
  /** SoundID.Item167（:42732） */
  playSlamSound: (x: number, y: number) => void;
  /** 尘（KillTile_GetTileDustAmount×6 近似——每台面 6 颗） */
  dust: (x: number, y: number) => void;
}

/** SpawnChlorophyteSporeCloud 1:1（:42616-42733）：以台面格为锚,横向扫 5 格（出手侧）
 *  ×竖 ±2 的"solid 且上空"台面;每列统计台面数 num3,每台面撒 num3==1?2:1 颗 1128,
 *  每颗掷 Remap(owned[1128],10,100,1,0.2) 通过率;速度 = (±0.25vx + dir×4×rand,
 *  rand(−45,0)×0.1×2.3);任一台面出孢子 → 刃尖前 1129 大爆炸（128×96,伤 ×1）+Item167。 */
export function spawnChlorophyteSporeCloud(
  st: { inBounds(x: number, y: number): boolean; isSolid(x: number, y: number): boolean },
  spawnX: number, spawnY: number, velX: number, playerDir: number,
  bladeDmg: number, ctx: SporeCloudSpawnCtx,
): void {
  const tx0 = Math.floor(spawnX / TILE);
  const ty0 = Math.floor(spawnY / TILE);
  const xLo = velX > 0 ? tx0 - 5 : tx0;
  const xHi = velX > 0 ? tx0 : tx0 + 5;
  const rate = 1 + (0.2 - 1) * Math.min(1, Math.max(0, (ctx.ownedClouds() - 10) / 90));  // Remap(owned,10,100,1,0.2)
  let any = false;
  for (let i = xLo; i <= xHi; i++) {
    let platforms = 0;
    for (let j = -2; j <= 2; j++) {
      if (st.inBounds(i, ty0 + j) && st.inBounds(i, ty0 + j - 1)
        && st.isSolid(i, ty0 + j) && !st.isSolid(i, ty0 + j - 1)) platforms++;
    }
    for (let j = -2; j <= 2; j++) {
      const ty = ty0 + j;
      if (!st.inBounds(i, ty) || !st.inBounds(i, ty - 1)) continue;
      if (!st.isSolid(i, ty) || st.isSolid(i, ty - 1)) continue;
      ctx.dust(i * TILE + 8, ty * TILE);
      const per = platforms !== 1 ? 1 : 2;                    // :42700 num6
      for (let n = 0; n < per; n++) {
        if (Math.random() > rate) continue;                   // :42703 掷
        const lo = -0.25 * velX;
        const hi = 0.25 * velX - lo;
        let vx = Math.random() * hi + lo;                     // :42706-42708
        vx += playerDir * 4 * Math.random();                  // :42709
        const vy = Math.random() * -45 * 0.1 * 2.3;           // :42710-42711（rand(−45,0)×0.1×2.3）
        ctx.spawnCloud(i * TILE + Math.random() * 12 + 4, ty * TILE - (4 * n - 4),
          vx, vy, bladeDmg * 0.75);
        any = true;
      }
    }
  }
  if (any) {
    // :42721-42731 大爆炸位 = 刃尖向 ×(81−16) −(112/±48 修正) −Y48——按台面锚近似
    const sx = spawnX + (velX > 0 ? -112 + 48 : -48);
    ctx.spawnSlam(sx, spawnY - 48, bladeDmg);
    ctx.playSlamSound(spawnX, spawnY);
  }
}

/** LOS 门（canHit 转发,供 Game 侧索敌复用） */
export { canHit };

// ================= R34 批:4062 雷杖 731 / 2795 激光机枪 439+440 / 3852 右键 704 / 5065 魔法阵 950 =================

/** 731 ThunderStaffShot（AI_029·731 支 Projectile.cs:38461-38509 + SetDefaults
 *  :7696-7705 + Kill :77055-77069 + 出手 Player.cs 通用尾 :49960）：
 *  - 10×10/ai29/alpha=255 起步 −15/t 渐显(≈17t 全显)/extraUpdates1/timeLeft90/magic
 *  - 垂直之字摆：ai0++(奇数拍 ¼ 概率再+1);@10 vy−5 @12 vy+5 @18 vy+5 @20 vy−5 归零
 *  - 帧 4t 进帧(projFrames[731]=4 Main.cs:8769);尘 226×⅓(scale0.4,vel=v×0.5 或 ×0.7)
 *  - 光 (0.2,0.5,0.7);Kill:SoundID 0(击块)+尘 226×15(oldV×0.5,⅔ noGravity scale×1.5) */
export class ThunderBoltShot extends Entity {
  w = 10; h = 10;
  damage: number;
  knockback: number;
  critChance = 0.04;
  armorPen = 0;
  dead = false;
  magicProj = true;
  readonly projId = 731;
  // ---- ★通用湿段（:16903-17113;ProjWetFlags 共享体——731 block :7696-7706 无
  //  ignoreWater 行 = 受段;tileCollide 缺省 true → 水中位移阻尼（HandleMovement
  //  :17721-17764 wetVelocity = velocity×档,速度场不减只削当拍位移）逐【子步】生效
  //  （extraUpdates=1 → 2 子步,湿段随子步逐跑 = 原版 Update 子步循环 :16781 内
  //  :16895 同序;wetCount 亦逐子步 −1 :17109-17112）----
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984 置 10 / :17109-17112 逐子步 −1） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价——首子步 AI 后/位移前同位） */
  presetDone = false;
  private t = 0;
  private readonly life = 90;      // timeLeft 90（SetDefaults）
  private ai0 = 0;                 // 摆相计数
  private frame = 0;
  private frameCounter = 0;
  private alpha = 255;             // SetDefaults alpha=255 → 渐显
  private hitCd = new HitCdImpl();
  /** ★BJ383：PVE 受理命中计数（原版 Projectile.numHits :14263;proc 读自增前值） */
  pveNumHits = 0;

  constructor(x: number, y: number, vx: number, vy: number, damage: number, knockback: number) {
    super();
    this.x = x - this.w / 2; this.y = y - this.h / 2;
    this.vx = vx; this.vy = vy;
    this.damage = Math.max(1, Math.round(damage));
    this.knockback = knockback;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    this.t++;
    if (this.t >= this.life || this.dead) { this.die(game); return; }
    if (++this.frameCounter >= 4) {                            // :38463-38470
      this.frameCounter = 0;
      this.frame = (this.frame + 1) % 4;                       // projFrames[731]=4
    }
    this.alpha = Math.max(0, this.alpha - 15);                 // :38471-38475 渐显
    // 之字摆（:38476-38497）
    this.ai0++;
    const oddTick = this.ai0 % 2 !== 0 && Math.random() < 0.25;
    if (oddTick) this.ai0++;
    switch (Math.trunc(this.ai0)) {
      case 10: this.vy -= 5; break;
      case 12: this.vy += 5; break;
      case 18: this.vy += 5; break;
      case 20: this.vy -= 5; this.ai0 = 0; break;
    }
    if (Math.random() < 1 / 3) {                               // 尘 226 ×⅓(:38498-38507)
      const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 226,
        this.vx, this.vy, 50, null, 0.4);
      if (d) {
        d.noGravity = true;
        d.vx = 0; d.vy = 0;
        d.vx = this.vx * 0.5 * (Math.random() < 2 / 3 ? 1.4 : 1);
        d.vy = this.vy * 0.5 * (Math.random() < 2 / 3 ? 1.4 : 1);
      }
    }
    game.addLightAt?.(this.cx, this.cy, 0.2, 0.5, 0.7);        // :38508
    // 位移（SetDefaults extraUpdates=1 :7702-7704 → Update 每帧双跑,射程/位移×2——
    // ★A⑥ 转正：曾折叠为单步全速=射程减半。双子步各带 tileCollide 判（440 先例）,
    // AI/音尘按拍单跑登记差异（原版连 AI 亦双跑,仓内惯例折只剩运动面））
    // ---- ★通用湿段（:16903-17113）随子步逐跑（原版湿段在子步循环内）+ 水中位移
    // 阻尼 ×0.5/蜂蜜 0.25/微光 0.375（:17721-17764,直积分宿主乘位移行,速度场不减;
    // 溅花尘/音由共享体 wetSplashStepShared 承载,不自写）----
    for (let s9 = 0; s9 < 2; s9++) {
      projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
        this.projId, !!projectileData(this.projId)?.ignoreWater);
      if (this.dead) return;                     // 水death/段内 Kill 早退（731 非 waterdeath,
      const drag = projWaterDragFactor(this);    // 此门=护栏,死码照抄防静默缺面）
      this.x += this.vx * drag; this.y += this.vy * drag;
      const st = game.world.store;
      const tx = Math.floor(this.cx / TILE), ty = Math.floor(this.cy / TILE);
      if (!st.inBounds(tx, ty) || st.isSolid(tx, ty)) { this.die(game); return; }
    }
    cutTilesBox(game, this.x, this.y, this.w, this.h);         // CutTiles（:12517/:15276;排除表无 731）
    // ★BJ383 小动物命中面（BJ381 登记债清偿）：penetrate 缺省 1（SetDefaults
    //  :7696-7706 无 penetrate 行=字段缺省 :366）→ critter 受击耗穿归零即亡
    //  （:14184 → :17312 Kill;走 die()=Kill 面 :77055 音+尘）。
    //  ★登记：敌面 hit-death（penetrate 归零 Kill）与 flag3 单发免疫豁免
    //  （maxPenetrate==1 :12635 免疫门旁路+不写窗）本仓未建模（缺省免疫窗 10t 近似,
    //  弹体命中后续航）——BJ381 债域仅 critter 面,敌面下窗独立定谳。
    if (hitCritters(this, game)) { this.die(game); return; }
    dealContacts(this, game, this.hitCd, 10, (t) => {
      // ★BJ383 幽灵兜帽吸血 proc（:13877-79;731 magic :7702）——proc 先于
      //  :14263 numHits++（读自增前值）;拒收不 proc 不计数。
      ghostHealProc(game, this.projId, this.pveNumHits,
        t as never as Parameters<typeof ghostHealProc>[3]);
      // ★清偿刀 R1 D1（2026-09-30）幽灵伤害头 ghostHurt（Projectile.cs:13881 调用点/
      //  :12021 方法体,SpectreSoulProj 单源零改动复用;BJ420 1115/1116 同构）——
      //  731 数据面 magic（SetDefaults :7696-7706 `magic = true` :7702）+ 幽灵面具
      //  套装 → 受害者 Center 放浮魂 356。受理面 = dealContacts 内环免疫门
      //  （:12635/:12600 收编,在 onHit 前拒）⇒ 到达本位即 flag10 块可达面。
      if (playerHasGhostHurt(game.player)) {
        const v420 = t as never as { vanillaId?: number | null; lastStrikeDealt?: number;
          maxHp?: number; def?: { lifeMax?: number } };
        ghostHurtOnHit(game,
          { magic: true, projDamage: this.damage,
            projX: this.x, projY: this.y, projW: this.w, projH: this.h,
            ownerCx: game.player.cx, ownerCy: game.player.cy },
          { x: t.x, y: t.y, w: t.w, h: t.h,
            cx: t.x + t.w / 2, cy: t.y + t.h / 2,
            vanillaId: v420.vanillaId,
            lifeMax: v420.maxHp ?? v420.def?.lifeMax,
            dealt: v420.lastStrikeDealt ?? 0 });
      }
      // ★BJ424 星云套装 proc（:13885-13891,ghostHurt 同块同门面）——引擎自持全部门
      nebulaBoosterOnHit(game,
        { projId: this.projId, projDirX: this.vx },
        { x: t.x, y: t.y, w: t.w, h: t.h,
          cx: t.x + t.w / 2, cy: t.y + t.h / 2,
          vanillaId: (t as never as { vanillaId?: number | null }).vanillaId,
          lifeMax: (t as never as { maxHp?: number; def?: { lifeMax?: number } }).maxHp
            ?? (t as never as { def?: { lifeMax?: number } }).def?.lifeMax,
          dealt: (t as never as { lastStrikeDealt?: number }).lastStrikeDealt ?? 0 });
      this.pveNumHits++;
    });                                                        // 缺省免疫窗（非 local 表族）
  }

  /** Kill（:77055-77069）：SoundID 0 + 尘 226×15(oldV×0.5,⅔ noGravity/scale×1.5/vel×0.5) */
  die(game: GameHooks): void {
    if (this.dead) return;
    this.dead = true;
    game.playSfxAt?.('hit', this.cx, this.cy);                 // SoundID 0 击块音（本仓近似轨）
    for (let i = 0; i < 15; i++) {
      const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 226,
        this.vx * 0.5, this.vy * 0.5, 50, null, 0.5);
      if (d && Math.random() < 2 / 3) {
        d.noGravity = true;
        d.scale *= 1.5;
        d.vx *= 0.5; d.vy *= 0.5;
      }
    }
  }

  draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const img = projSprite(731);
    // ★BJ668b 件1（2026-10-13,登记债①清偿）GetAlpha 承接（Projectile.cs:81133-81137,
    //  435/732/731 同支）：绘制色 = Color.Lerp(格光,White,0.8) 且 A=25 硬编码——
    //  :81133 不读 α,类内 alpha 渐显(:38471-38475)是绘制死面（DrawProj 标准路径
    //  Main.cs:31532 `color48 = proj.GetAlpha(projectileColor)` 直绘无 731 特判/
    //  Opacity :542 不消费/Update 体 16750-17400 零 α 读者=弹域审计,唯一读者是
    //  AI 自递减）。旧 draw ga=(255−α)/255 全显=双偏离（过显 ~10.2×=1/0.098+
    //  无白化,BJ667 ② 同病专类变体）。承接=BJ668 两遍制算子（Arrow.replayLerpLift
    //  同式直绘闭包变体——本体单笔无流内交错,与录制式逐位等值）：基底=实体层
    //  brightness(1−k)×ga（compositeLight 乘光同相）+ lift=projFullbrightQueue
    //  'lighter' ×k 光照后复绘 → base×light+lift ≡ tex×ga×[(1−k)light+k]
    //  （vanillaProjAlpha 头注 BJ668 恒等块）。无队列（mock/探针）=仅基底=暗场
    //  失真上界,251/465 判例同守卫域（登记）。
    const GA = 25 / 255;                                       // :81137 A=25 硬编码（mul≈0.098）
    const K = 0.8;                                             // :81134 Lerp(White,0.8)
    const drawBody = (c: CanvasRenderingContext2D): void => {
      c.save();
      c.translate(this.cx, this.cy);
      c.rotate(Math.atan2(this.vy, this.vx) + 0 /*ai29 弹体竖直贴图→随速度向*/);
      c.imageSmoothingEnabled = false;
      if (img && img.width > 0) {
        const fh = img.height / 4;
        c.drawImage(img, 0, Math.round(this.frame * fh), img.width, Math.round(fh),
          -(img.width * 0.7) / 2, -fh / 2, img.width * 0.7, fh);
      } else {
        c.fillStyle = '#66CCFF';
        c.fillRect(-3, -3, 6, 6);
      }
      c.restore();
    };
    ctx.save();
    ctx.globalAlpha = GA;
    ctx.filter = `brightness(${(1 - K).toFixed(3)})`;          // 基底 ×(1−k)（W3C 线性乘,乘光同相）
    drawBody(ctx);
    ctx.restore();
    (r as unknown as {
      queueProjFullbright?: (fn: (c: CanvasRenderingContext2D) => void) => void;
    }).queueProjFullbright?.((c) => {                          // lift:光照后 'lighter' ×k 复绘
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.filter = 'none';
      c.globalAlpha = GA * K;
      drawBody(c);
      c.restore();
    });
  }
}

// ---------------- 2795 激光机枪:439 持握体(AI_075·439 支 :67185-67284) ----------------

export interface LaserMgCtl {
  /** player.channel 电平（mouseHeld+持械+!CCED 由 Game 侧并入门） */
  channel: () => boolean;
  /** 当前鼠标世界坐标（实时转向基准） */
  aim: () => { x: number; y: number };
  /** CheckMana(held.mana, pay:true)——每发射拍扣蓝（ManaV2 空蓝照充语义） */
  payMana: () => void;
  /** GetSlowMagicUseRate()（1/0.4）★消费点①发射节拍 */
  rate: () => number;
  /** GetSlowMagicScalar()（1/2.5）★消费点②帧动画 ③循环音间隔 */
  scalar: () => number;
  /** 双发回调（Game 侧造 440×2） */
  fire: (x: number, y: number, vx: number, vy: number) => void;
  onKill?: () => void;
}

/** 439 LaserMachinegun 持握体（SetDefaults 22×22/ai75/penetrate−1/noTile + 公共尾
 *  :68381-68390 position=RRP(MountedCenter)−Size/2、rotation=vAngle+π/2、timeLeft=2 续命）。
 *  发射节拍 period=24−6×stage(stage=@40/80/120 → 24/18/12/6t 四档加速);
 *  slowMagic:ai1+=rate(节拍÷0.4)、frameCounter≥4×scalar、soundDelay=period×scalar。
 *  循环音 Item91(ai0≠1 首帧免);枪口尘 135×2(Center+aim 向×24,scale1.4,noGravity)。
 *  发射拍 gate 失败 → Kill(:67242-67282)。 */
export class LaserMachinegunHolder extends Entity {
  w = 22; h = 22;
  damage: number;
  knockback: number;
  critChance = 0.04;
  armorPen = 0;
  dead = false;
  magicProj = true;
  readonly projId = 439;
  private ai0 = 0;               // 充能计数（档位门 40/80/120）
  private ai1 = 0;               // 发射累加器
  private frame = 0;
  private frameCounter = 0;
  private soundDelay = 0;
  private velAng = 0;            // velocity 角（公共尾 rotation=vAngle+π/2）
  private ctl: LaserMgCtl;

  constructor(x: number, y: number, ang: number, damage: number, knockback: number, ctl: LaserMgCtl) {
    super();
    this.x = x - this.w / 2; this.y = y - this.h / 2;
    this.velAng = ang;
    this.damage = Math.max(1, Math.round(damage));
    this.knockback = knockback;
    this.ctl = ctl;
  }

  get aimAngle(): number { return this.velAng; }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    this.ai0++;
    const stage = (this.ai0 >= 40 ? 1 : 0) + (this.ai0 >= 80 ? 1 : 0) + (this.ai0 >= 120 ? 1 : 0);   // :67188-67200
    const period = 24 - 6 * stage;                                                                   // 24/18/12/6
    this.ai1 += this.ctl.rate();                                                                     // ★消费点①(:67204)
    let firing = false;
    if (this.ai1 >= period) { this.ai1 = 0; firing = true; }                                         // :67206-67210
    this.frameCounter += 1 + stage;                                                                  // 加速档带帧(:67211)
    if (this.frameCounter >= 4 * this.ctl.scalar()) {                                                // ★消费点②(:67212)
      this.frameCounter = 0;
      this.frame = (this.frame + 1) % 6;                                                             // projFrames[439]=6(Main.cs:8674)
    }
    if (--this.soundDelay <= 0) {
      this.soundDelay = Math.max(1, Math.round(period * this.ctl.scalar()));                         // ★消费点③(:67223)
      if (this.ai0 !== 1) game.playSfxWav?.('Item_91', 1, this.cx, this.cy);                         // 循环射击音(:67226)
    }
    if (this.ai1 === this.ctl.rate() && this.ai0 !== 1) {                                            // 枪口尘(:67229-67241)
      for (let i = 0; i < 2; i++) {
        const d = game.spawnDust?.(this.cx + Math.cos(this.velAng) * 24 - 8,
          this.cy + Math.sin(this.velAng) * 24 - 8, 16, 16, 135,
          Math.cos(this.velAng), Math.sin(this.velAng), 100, null, 1.4);
        if (d) { d.noGravity = true; d.vx *= 0.66; d.vy *= 0.66; }
      }
    }
    // 公共尾挂手（:68381-68389）：RRP(MountedCenter)≈玩家中心 − Size/2;timeLeft=2 续命
    const p = game.player as unknown as { cx: number; cy: number };
    this.x = p.cx - this.w / 2;
    this.y = p.cy - this.h / 2;
    if (firing) {
      const m = this.ctl.aim();
      if (!this.ctl.channel()) { this.kill(game); return; }                                        // gate 失败 → Kill(:67281)
      this.ctl.payMana();
      // 实时转向：v = normalize(mouse − hand) × shootSpeed(20)
      const dx = m.x - p.cx, dy = m.y - p.cy;
      const l = Math.hypot(dx, dy) || 1;
      this.velAng = Math.atan2(dy, dx);
      const spd = 14;                                                                              // num10=14(:67265)
      for (let i = 0; i < 2; i++) {                                                                // 双发 440(:67267-67277)
        const jx = (Math.random() * 15) | 0, jy = (Math.random() * 15) | 0;                        // rand(−7,±7)
        const a = this.velAng + (Math.random() * 0.19634954631328583 - 0.09817477315664291);       // RotatedBy ±0.0982rad
        this.ctl.fire(p.cx + jx - 7, p.cy + jy - 7, Math.cos(a) * spd, Math.sin(a) * spd);
      }
    }
  }

  kill(game: GameHooks): void {
    if (this.dead) return;
    this.dead = true;
    this.ctl.onKill?.();
  }

  draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const img = projSprite(439);
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.velAng + Math.PI / 2);                       // 公共尾 rotation=vAngle+π/2(:68382)
    ctx.imageSmoothingEnabled = false;
    if (img && img.width > 0) {
      const fh = img.height / 6;
      ctx.drawImage(img, 0, Math.round(this.frame * fh), img.width, Math.round(fh),
        -img.width / 2, -fh / 2, img.width, fh);
    } else {
      ctx.fillStyle = '#8899BB';
      ctx.fillRect(-11, -11, 22, 22);
    }
    ctx.restore();
  }
}

// ---------------- 440 LaserMachinegunLaser(SetDefaults :5106-5116 + AI :55738-55774) ----------------

/** 5×5/aiStyle1/alpha255 −25/t 渐显/extraUpdates2(3 子步全速)/timeLeft600/magic/noTile。
 *  光 (0.25,0.4,0.7)(:55748-55750);localAI[0]+3/t 至 100(纯视觉余量);
 *  Kill 尘 135×rand(3,7) scale2.1 noGravity(:74946-74956)。直线弹,缺省免疫窗。 */
export class LaserMachinegunLaser extends Entity {
  w = 5; h = 5;
  damage: number;
  knockback: number;
  critChance = 0.04;
  armorPen = 0;
  dead = false;
  magicProj = true;
  readonly projId = 440;
  private t = 0;
  private readonly life = 600;
  private alpha = 255;
  private localAI0 = 0;
  private hitCd = new HitCdImpl();
  /** ★BJ383：PVE 受理命中计数（原版 Projectile.numHits :14263;proc 读自增前值） */
  pveNumHits = 0;

  constructor(x: number, y: number, vx: number, vy: number, damage: number, knockback: number) {
    super();
    this.x = x - this.w / 2; this.y = y - this.h / 2;
    this.vx = vx; this.vy = vy;
    this.damage = Math.max(1, Math.round(damage));
    this.knockback = knockback;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    this.t++;
    if (this.t >= this.life) { this.die(game); return; }
    this.alpha = Math.max(0, this.alpha - 25);                  // :55740-55744
    this.localAI0 = Math.min(100, this.localAI0 + 3);           // :55754-55762（视觉余量）
    game.addLightAt?.(this.cx, this.cy, 0.25, 0.4, 0.7);        // :55748
    for (let s = 0; s < 3; s++) {                               // extraUpdates=2 → 3 子步全速
      this.x += this.vx; this.y += this.vy;
      cutTilesBox(game, this.x, this.y, this.w, this.h);        // CutTiles（:12517/:15276;两门排除表均无 440）
      const st = game.world.store;
      const tx = Math.floor(this.cx / TILE), ty = Math.floor(this.cy / TILE);
      if (!st.inBounds(tx, ty) || st.isSolid(tx, ty)) { this.die(game); return; }
    }
    // ★BJ383 小动物命中面（BJ381 登记债清偿）：penetrate 缺省 1（SetDefaults
    //  :5117-5127 无 penetrate 行=字段缺省 :366）→ critter 受击耗穿归零即亡
    //  （:14184 → :17312 Kill;走 die()=Kill 尘面 :74946）。
    //  ★登记：敌面 hit-death/flag3 单发免疫豁免未建模（同 731,缺省免疫窗近似）。
    if (hitCritters(this, game)) { this.die(game); return; }
    dealContacts(this, game, this.hitCd, 10, (t) => {
      // ★BJ383 幽灵兜帽吸血 proc（:13877-79;440 magic :5116）——proc 先于
      //  :14263 numHits++（读自增前值）;拒收不 proc 不计数。
      ghostHealProc(game, this.projId, this.pveNumHits,
        t as never as Parameters<typeof ghostHealProc>[3]);
      // ★清偿刀 R1 D1（2026-09-30）幽灵伤害头 ghostHurt（Projectile.cs:13881 调用点/
      //  :12021 方法体,SpectreSoulProj 单源零改动复用;BJ420 1115/1116 同构）——
      //  440 数据面 magic（SetDefaults :5106-5117 `magic = true` :5116）+ 幽灵面具
      //  套装 → 受害者 Center 放浮魂 356。受理面 = dealContacts 内环免疫门
      //  （:12635/:12600 收编,在 onHit 前拒）⇒ 到达本位即 flag10 块可达面。
      if (playerHasGhostHurt(game.player)) {
        const v420 = t as never as { vanillaId?: number | null; lastStrikeDealt?: number;
          maxHp?: number; def?: { lifeMax?: number } };
        ghostHurtOnHit(game,
          { magic: true, projDamage: this.damage,
            projX: this.x, projY: this.y, projW: this.w, projH: this.h,
            ownerCx: game.player.cx, ownerCy: game.player.cy },
          { x: t.x, y: t.y, w: t.w, h: t.h,
            cx: t.x + t.w / 2, cy: t.y + t.h / 2,
            vanillaId: v420.vanillaId,
            lifeMax: v420.maxHp ?? v420.def?.lifeMax,
            dealt: v420.lastStrikeDealt ?? 0 });
      }
      // ★BJ424 星云套装 proc（:13885-13891,ghostHurt 同块同门面）——引擎自持全部门
      nebulaBoosterOnHit(game,
        { projId: this.projId, projDirX: this.vx },
        { x: t.x, y: t.y, w: t.w, h: t.h,
          cx: t.x + t.w / 2, cy: t.y + t.h / 2,
          vanillaId: (t as never as { vanillaId?: number | null }).vanillaId,
          lifeMax: (t as never as { maxHp?: number; def?: { lifeMax?: number } }).maxHp
            ?? (t as never as { def?: { lifeMax?: number } }).def?.lifeMax,
          dealt: (t as never as { lastStrikeDealt?: number }).lastStrikeDealt ?? 0 });
      this.pveNumHits++;
    });
  }

  private die(game: GameHooks): void {
    if (this.dead) return;
    this.dead = true;
    const n = 3 + ((Math.random() * 4) | 0);                    // rand(3,7)
    for (let i = 0; i < n; i++) {
      const d = game.spawnDust?.(this.cx, this.cy, 0, 0, 135, 0, 0, 100, null, 2.1);
      if (d) { d.noGravity = true; d.vx *= 2; d.vy *= 2; }
    }
  }

  draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const img = projSprite(440);
    ctx.save();
    ctx.globalAlpha = 1 - this.alpha / 255;                     // GetAlpha=(255−alpha) 灰阶(:81088)
    ctx.translate(this.cx, this.cy);
    ctx.rotate(Math.atan2(this.vy, this.vx));
    ctx.imageSmoothingEnabled = false;
    if (img && img.width > 0) {
      const L = Math.hypot(this.vx, this.vy) * 3;               // 拉长光束段（子步行程）
      ctx.drawImage(img, -L / 2, -img.height / 2, L, img.height);
    } else {
      ctx.fillStyle = '#AABBEE';
      ctx.fillRect(-4, -1, 8, 2);
    }
    ctx.restore();
  }
}

// ---------------- 3852 右键风暴 704(AI_145_BookStaffStorm :71421-71560 + SetDefaults :7449) ----------------

/** 60×210/ai145/friendly magic/tileCollide=false/penetrate−1/local 免疫−1/timeLeft600。
 *  寿命帽 300t(localAI[0]≥16 → 提前至 285);vx 保持出手向(±speed)仅 vy 受控:
 *  身下 16×160 列撞固块/液体 → 升(vy −2/−4 至 −16,localAI[0]+=2),否则坠(+2/+4 至 +16)。
 *  尘 274 沿纵向椭圆(fadeIn1.3 scale0.87 alpha211 noGravity,vel.x+=v.x×2.1)+
 *  底部尘 31×4;彩带 gore 1007/1008 ×⅕(timeLeft60)。循环音 dd2_book_staff_twister_loop
 *  (末 15t 音量线性归零)。命中每敌一次(cooldown −1)。 */
export class BookStormTwister extends Entity {
  w = 60; h = 210;
  damage: number;
  knockback: number;
  critChance = 0.04;
  armorPen = 0;
  dead = false;
  magicProj = true;
  readonly projId = 704;
  private t = 0;
  private life = 300;            // ai[0] 帽 300（localAI[0]≥16 → 285,简化取 300 登记）
  private localAI0 = 0;
  private hitCd = new HitCdImpl();
  /** ★BJ383：PVE 受理命中计数（原版 Projectile.numHits :14263;proc 读自增前值;
   *  critter 受理命中亦入账——同 :14263 无条件递增） */
  pveNumHits = 0;
  /** 循环轨句柄(:71434-71447 soundDelay==0 首拍起播,localAI[1] 存 SlotId)——
   *  GameHooks.startLoopSfx 返回面的结构化类型(与 types.ts :169 同构) */
  private loop: { stop(): void; setVolume(v: number): void; readonly playing: boolean; readonly dead: boolean } | null = null;

  constructor(x: number, y: number, vx: number, damage: number, knockback: number) {
    super();
    this.x = x - this.w / 2; this.y = y - this.h / 2;
    this.vx = vx; this.vy = 0;
    this.damage = Math.max(1, Math.round(damage));
    this.knockback = knockback;
    // ★外部提前 kill 也必须拆循环轨（2026-08-26 review 补）：自然寿命终点的
    //   loop.stop() 在 fixedUpdate 尾段，外部置 dead（Entity.compact 剔除回调 destroy,
    //   Entity.ts:69-76）不走那里——漏注入则龙卷风循环音满音量长鸣至重载。
    //   GrenadeProj 引信音/dd2 传送门循环轨同款兜底通道
    (this as unknown as { destroy?: () => void }).destroy = () => { this.loop?.stop(); };
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    this.t++;
    // 循环音(:71434-71447)：首拍 PlayTrackedSound 起轨;每 tick Volume=
    // 1−max(ai[0]−(life−15),0)/15(末 15t 线性归零)。★位置跟身(activeSound.Position=
    // Center)本仓循环轨无此通道,龙卷横移慢+轨短,简化为定源登记。
    if (this.t === 1) {
      this.loop = game.startLoopSfx?.('dd2_book_staff_twister_loop', 1, 1) ?? null;
    } else {
      this.loop?.setVolume(Math.max(0, 1 - Math.max(this.t - (this.life - 15), 0) / 15));
    }
    // ★BJ374 被埋提前收口（:71445-71447 `localAI[0] >= 16 && ai[0] < num−15 →
    //  ai[0] = num−15`）：快升支（被固块/液体埋住连续快升）累积 localAI0 ≥16 →
    //  计数直接跳 285——300t 帽不变,仅提前 15t 收口（旧实现只累积不消费）
    if (this.localAI0 >= 16 && this.t < this.life - 15) this.t = this.life - 15;
    if (this.t >= this.life) {
      this.loop?.stop();
      this.dead = true;
      return;
    }                                                      // :71454-71457
    // 垂直物理（:71467-71510）：身下 16×160 探测柱——支撑谓词 = SolidCollision ||
    // WetCollision（:71467 逐字;红队 MED 2026-09-06:旧版漏湿支 → 龙卷过水柱照穿,
    // 原版水面悬停=湿柱也算支撑,入水即升）。WetCollision 的盒 = 与 SolidCollision
    // 同一探测柱 (vector3,16,160)（:71466-71467 同参——非实体盒 60×210;WetCollision
    // 内部再缩 10×h/2 底心盒,npcLiquid.wetCollision 同式实现,传探测柱即可）。
    // ★登记近似：固块支沿单列逐行采样（原版 SolidCollision=整盒任一固块,16 宽柱
    // 跨列界时原文可两列齐查）——既有实现,本批只补湿支不动固块支。
    const probeX = this.cx - 8, probeYTop = this.y + this.h - 160;
    let blocked = false;
    {
      const st = game.world.store;
      for (let yy = probeYTop; !blocked && yy < this.y + this.h; yy += 16) {
        const tx = Math.floor(probeX / TILE), ty = Math.floor(yy / TILE);
        if (st.inBounds(tx, ty) && (st.isSolid(tx, ty))) blocked = true;
      }
      if (!blocked && wetCollision(st, probeX, probeYTop, 16, 160).wet) blocked = true;   // :71467 `|| Collision.WetCollision`
    }
    if (blocked) {                                              // 支撑/浸液 → 升
      if (this.vy > 0) this.vy = 0;
      // ★BJ374 快升支判据勘误（:71477-71481）：原版 +2 步进在 else 支（递减【前】
      //  vy ≤ −4）——localAI0 += 2 与 −4 步进同支;旧实现按递减后 vy ≤ −4 判,
      //  过渡带 vy∈(−4,−2] 多累积（提前触发收口跳）
      const fast704 = this.vy <= -4;
      this.vy -= fast704 ? 4 : 2;
      if (this.vy < -16) this.vy = -16;
      if (fast704) this.localAI0 += 2;
    } else {                                                    // 悬空 → 坠
      this.localAI0 = Math.max(0, this.localAI0 - 1);
      if (this.vy < 0) this.vy = 0;
      this.vy += this.vy < 4 ? 2 : 4;
      if (this.vy > 16) this.vy = 16;
    }
    this.x += this.vx; this.y += this.vy;
    cutTilesBox(game, this.x, this.y, this.w, this.h);          // CutTiles（:12517/:15276;两门排除表均无 704）
    // 尘 274 ×1（:71511-71537,ai[0]<270 门略作恒真近似——末 30t 收尾停尘登记）
    // ★BJ374 几何逐值（:71515-71526）：vector2=(0.2×210,210)=(42,210) 纵向椭柱;
    //  vector4.X=−Lerp(0.1,1,r1)×Lerp(2.2,0.6,amt)∈[−2.2,−0.06]、vector4.Y=
    //  Lerp(−1,0.9,amt);位=Center+(42,210)×vector4×0.5+(6,10)=Center+(21·vx4+6,
    //  105·vy4+10)——尘柱偏中心左（左旋拖尾签名;旧 ±21 均匀分布形状不符）
    if (this.t < this.life - 30) {
      const amt = Math.random();
      const vx4 = -(0.1 + 0.9 * Math.random()) * (2.2 - 1.6 * amt);
      const vy4 = -1 + 1.9 * amt;
      const d = game.spawnDust?.(this.cx + 21 * vx4 + 6, this.cy + 105 * vy4 + 10,
        0, 0, 274, 0, 0, 211, null, 0.87);
      if (d) {
        d.fadeIn = 1.3;
        d.noGravity = true;
        d.noLight = true;
        if (vx4 > -1.2) d.vx = 1 + Math.random();   // 内圈尘基速覆写（:71528;外圈保留 NewDust 基速 rand±2.0）
        d.vy = Math.random() * -0.5 - 1.3;          // :71530 覆写
        d.vx += this.vx * 2.1;                      // :71532
      }
    }
    for (let k = 0; k < 4; k++) {                               // 底部尘 31×4(:71538-71544)
      const d = game.spawnDust?.(this.x + this.w / 2 - 25, this.y + this.h - 25, 50, 25, 31,
        this.vx, -2, 100, null, 1);
      if (d) { d.noGravity = true; d.fadeIn = 1.1; }            // fadeIn（:71542）
    }
    // ★BJ374 彩带 gore（:71545-71575 三独立掷,整缺补齐）：1/5（timeLeft 60/alpha 50/
    //  vx 再 += 风暴 vx=合计 2.5×）+ 1/7×2（timeLeft 0/alpha 80 走 alpha 渐隐支）;
    //  型 SelectRandom(1007,1008,1008)=1007 权 1/1008 权 2;位=TopLeft+
    //  NextVector2Square(0,1)×Size（Utils.cs:1286 [0,1) 方格）;初速=(vx×1.5,
    //  −rand×16)+NewGoreDirect 内置扰动（GorePiece.newGore 已建模 :1347-1348）
    {
      const gv704 = (): [number, number] => [this.vx * 1.5, -Math.random() * 16];
      const gp704 = (): [number, number] => [this.x + Math.random() * this.w, this.y + Math.random() * this.h];
      const gt704 = (): number => (Math.random() * 3 < 1 ? 1007 : 1008);
      if (Math.floor(Math.random() * 5) === 0) {
        const [gx, gy] = gp704(); const [gvx, gvy] = gv704();
        const g = GorePiece.newGore(gt704(), gx, gy, gvx, gvy);
        if (g) { g.timeLeft = 60; g.alpha = 50; g.vx += this.vx; }
      }
      for (let gn = 0; gn < 2; gn++) {
        if (Math.floor(Math.random() * 7) === 0) {
          const [gx, gy] = gp704(); const [gvx, gvy] = gv704();
          const g = GorePiece.newGore(gt704(), gx, gy, gvx, gvy);
          if (g) { g.timeLeft = 0; g.alpha = 80; }
        }
      }
    }
    // ★BJ381 小动物命中面（用户实报"龙卷风不伤小动物"定谳=整缺,非原版本相）：
    //  原版小动物 SetDefaults 无 friendly=true（兔 46/鸟 47 族 NPC.cs:9364-9373 仅
    //  width/aiStyle7/lifeMax5/catchItem）⇒ friendly 弹命中门 Damage_PVE_Inner
    //  :12618 `flag = !targetNPC.friendly` 对 critter 恒真;拒收唯
    //  CanNPCBeHitByPlayerOrPlayerProjectile（Player.cs:20673-20689）= dontHurtCritters
    //  ∪ minion/MinionShot/sentry/SentryShot——704 魔法弹全不沾（:7454-7463 SetDefaults
    //  无 minion 旗）⇒ 原版龙卷照伤小动物（实际弹伤,critter lifeMax=5 即死）。
    //  本仓双桶架构 critters 独立桶不入 game.enemies()（projTargets.playerCanHitEnemy
    //  头注）,dealContacts 只扫敌桶 → 漏;接仓内单源 hitCritters（穿透弹范式=
    //  WeaponProj.ts:309/Arrow.ts:10011 不杀不耗穿透;5 定伤=critter 全 lifeMax5 杀面
    //  等价,RB10d-D1 登记债）。非 minion/sentry/trap ⇒ 无 ctx。
    // ★BJ383：critter 受理命中亦入 numHits 账（:14263 无条件递增,proc ladder 依赖。
    //  critter lifeMax=5 经 flag10 lifeMax>5 段恒不吸血——hitCritters 支只入账不 proc）
    if (hitCritters(this, game)) this.pveNumHits++;
    dealContacts(this, game, this.hitCd, -1, (t) => {
      // ★BJ383 幽灵兜帽吸血 proc（:13877-79 Damage() 通用 on-hit 段;704 magic :7455）
      //  ——与 BJ381 hitCritters 命中面共存:critter 支不 proc（见上）,敌面受理位
      //  proc 先于 :14263 numHits++（读自增前值）;拒收不 proc 不计数。
      ghostHealProc(game, this.projId, this.pveNumHits,
        t as never as Parameters<typeof ghostHealProc>[3]);
      // ★清偿刀 R1 D1（2026-09-30）幽灵伤害头 ghostHurt（Projectile.cs:13881 调用点/
      //  :12021 方法体,SpectreSoulProj 单源零改动复用;BJ420 1115/1116 同构）——
      //  704 数据面 magic（SetDefaults :7449-7462 `magic = true` :7455）+ 幽灵面具
      //  套装 → 受害者 Center 放浮魂 356。受理面 = dealContacts 内环免疫门
      //  （:12635/:12600 收编,在 onHit 前拒）⇒ 到达本位即 flag10 块可达面。
      if (playerHasGhostHurt(game.player)) {
        const v420 = t as never as { vanillaId?: number | null; lastStrikeDealt?: number;
          maxHp?: number; def?: { lifeMax?: number } };
        ghostHurtOnHit(game,
          { magic: true, projDamage: this.damage,
            projX: this.x, projY: this.y, projW: this.w, projH: this.h,
            ownerCx: game.player.cx, ownerCy: game.player.cy },
          { x: t.x, y: t.y, w: t.w, h: t.h,
            cx: t.x + t.w / 2, cy: t.y + t.h / 2,
            vanillaId: v420.vanillaId,
            lifeMax: v420.maxHp ?? v420.def?.lifeMax,
            dealt: v420.lastStrikeDealt ?? 0 });
      }
      // ★BJ424 星云套装 proc（:13885-13891,ghostHurt 同块同门面）——引擎自持全部门
      nebulaBoosterOnHit(game,
        { projId: this.projId, projDirX: this.vx },
        { x: t.x, y: t.y, w: t.w, h: t.h,
          cx: t.x + t.w / 2, cy: t.y + t.h / 2,
          vanillaId: (t as never as { vanillaId?: number | null }).vanillaId,
          lifeMax: (t as never as { maxHp?: number; def?: { lifeMax?: number } }).maxHp
            ?? (t as never as { def?: { lifeMax?: number } }).def?.lifeMax,
          dealt: (t as never as { lastStrikeDealt?: number }).lastStrikeDealt ?? 0 });
      this.pveNumHits++;
    });                                                         // localNPCHitCooldown=−1
  }

  draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const img = projSprite(704);
    if (!img || img.width <= 0) return;
    // ★BJ374 程序化叠层螺旋（Main.cs:33081-33160 专支 1:1——旧实现=60×60 原图
    //  拉伸到 60×210=用户实报"完整动画帧贴图长条"）。原版把 60×60 贴图自 Bottom
    //  向 Top 以 ~4.11-5.01px 步距逐层叠画:全局自旋 −π/20×t×side + 每层扭转
    //  acc×2π/−20、scale=1+(n−0.35)(底 0.65→顶 1.65 喇叭形)、包络=前 30t 淡入/
    //  末 60t 线性淡出;棕层(160,140,100)+蓝脉冲层(140,160,255,t%60 梯形包络)。
    //  ★BJ376 三修（用户实报 vx>0 时龙卷"一整条"定谳=整柱镜像倒挂+α 2× 过浓）:
    //  ①SpriteEffects.FlipVertically=【逐层纹理】垂直翻转(EntitySpriteDraw 每调
    //    独立 effects :33096/:33152/:33157,层位置/层序不动)——旧实现整柱 y 镜像
    //    =层序倒挂+旋转方向镜像→喇叭形反成宽底窄顶 merged 条;修=每层
    //    scale(scl,∓scl)。
    //  ②蓝脉冲层缩放=(1+num339)×0.8 且画在棕层【下】(:33153-33157 先蓝后棕)
    //    ——旧版同缩放且后画。
    //  ③★BJ379 重修（用户实报"过于透明"定谳）:XNA Color*= rgb+a 全乘,预乘
    //    AlphaBlend 下 rgb 贡献=tex.rgb×tint×f 全幅、α=(127k×0.5)×env=0.249f 只进
    //    遮盖项 dst×(1−0.249f)（Main.cs:33135-33141）;canvas source-over 的
    //    globalAlpha 会把 rgb 再乘一遍 α → BJ376 单遍实现 rgb∝f²（f=1 时 0.249
    //    vs 原版 0.627,中低段 5×+ 暗）=过透根因;旧 0.5"折中"实为对该 f² 的补偿。
    //    修=尘系 add/erase 同范式两遍:destination-out(raw 贴图,α=0.249f)+lighter
    //    (预染色桶 rgb×f,α=1),与原版混合式逐项同构。
    const t = this.t;
    let env = Math.min(1, t / 30);                       // num330 淡入(:33086)
    if (t > this.life - 60) env = Math.max(0, 1 - (t - (this.life - 60)) / 60);   // :33088-33090
    if (env <= 0) return;
    const side = this.vx > 0 ? -1 : 1;                   // :33095 速度侧
    const spin = -(Math.PI / 20) * t * side;             // num332 全局自旋
    const flipV = this.vx > 0;                           // effects3(:33096)
    const step = Math.max(4.11, 5.01 + (t / 150) * -0.9);   // num334(:33100-33103)
    const iw = img.width, ih = img.height;
    const bx = this.x + this.w / 2;                      // bottom.X=Center.X(:33142)
    const by = this.y + this.h;                          // Bottom.Y
    const ty = this.y;
    const H = this.h;                                    // vector79.Y(:33093)
    const ph = t % 60;
    const glv = (a: number, b: number, x: number): number =>
      Math.max(0, Math.min(1, (x - a) / (b - a)));       // Utils.GetLerpValue clamped
    const blueK = ph < 30 ? glv(22, 30, ph) : glv(38, 30, ph);   // :33113-33120
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    let acc = 0;
    for (let yy = Math.floor(by); yy > Math.floor(ty); yy -= step) {
      acc += step;
      const n = acc / H;                                 // num337 归一高度
      const twist = acc * (Math.PI * 2) / -20 * (this.vx > 0 ? -1 : 1);   // num338
      const k = n <= 0.5 ? n * 2 : 2 - n * 2;            // 色包络三角(:33129-33133)
      const fB = k * env;                                // 棕层 rgb/α 公因子
      if (fB <= 0.004) continue;
      const scl = 1 + (n - 0.35);                        // 1+num339(:33128)
      ctx.save();
      ctx.translate(bx, yy);
      ctx.rotate(spin + twist);
      if (blueK > 0) {                                   // flag38 蓝脉冲层(:33153-33157)
        ctx.save();
        ctx.scale(scl * 0.8, flipV ? -scl * 0.8 : scl * 0.8);   // (1+num339)×0.8
        stormLayerDraw(ctx, img, 1, fB * blueK, iw, ih);
        ctx.restore();
      }
      ctx.scale(scl, flipV ? -scl : scl);                // ★逐层纹理翻转(非整柱镜像)
      stormLayerDraw(ctx, img, 0, fB, iw, ih);
      ctx.restore();
    }
    ctx.restore();
  }
}

/** 704 叠层预染色桶缓存（★BJ379:XNA 预乘 rgb 贡献=tex.rgb×tint×f 全幅——桶烘焙
 *  rgb×f+lighter α=1 全量加;遮盖项由 stormLayerDraw 的 destination-out 遍承担。
 *  旧"固定预染色+globalAlpha=0.249f"单遍把 rgb 折两遍∝f²=用户实报"过于透明"根因,已废。
 *  ★BJ403（用户实报"半透区黑斑"定谳）:BJ379 桶用 multiply+destination-in 烘焙,
 *  destination-in 把桶 α 还原成【raw tex.a】,lighter α=1 每层把 tex.a 全额累进
 *  dst.α——XNA 加算项 src.a=tex.a×STORM_A×f(≤0.249f,Main.cs:33135-33141 tint.A)。
 *  ~45 层叠加 ⇒ 半透区(texel a=26/77/102 占大头)α 饱和 1、rgb 仅 ΣP(小) = 黑斑。
 *  =尘系"add.A 恒 255"黑方块家族第三发(VanillaDust.ts dustPremulBake 2026-09-03
 *  黑方块/09-04 水花黑十字判例:"修=add.A 钉 e=texA×cA")。修=桶改 ImageData 字节级
 *  烘焙(stormAddBake 纯函数):rgb=预乘全幅 aR=tex.rgb×tex.a×tint×f、α=e=tex.a×
 *  STORM_A×f(与 erase 遍同源同值=混合式两项共用 tint.A 的结构语义)。
 *  存面约束:canvas 预乘面 rgb≤α ⇒ 亮 texel(aR>e,tint/63.5≈2.5×)不可表——存面
 *  α 取 max(e,aR,aG,aB)(尘系同款):rgb 恒逐字节精确,α 仅亮点位过冲到 rgb 本值
 *  (≤0.627f;暗 texel 恒 α=e 精确)。边界登记:龙卷亮臂比原版更实(α 过冲≤2.5×e),
 *  不黑不暗——本体暗 texel 占大头恒精确。桶距 1/48≈±1LSB 级;懒烘焙上限 2 色×48 桶
 *  60×60 小面（无 LRU 需求,帧内只触达 ~45 桶）。node(无 document)返回原图=测试替身
 *  （色彩面浏览器恒烘焙） */
const STORM_TINT_COLORS: ReadonlyArray<readonly [number, number, number]> =
  [[160, 140, 100], [140, 160, 255]];                  // value94(:33106)/color84(:33107)
const STORM_TINT_BUCKETS = 48;
const STORM_A = (127 * 0.5) / 255;                     // A=127k→×0.5(:33140)→/255
const stormTintBuckets = new Map<string, { src: CanvasImageSource; f: number }>();
/** ★BJ403 加算面字节级烘焙（尘系 dustPremulBake 同范式;tests/bj403-storm-addbake.test.ts
 *  直测）:入参 tex=straight RGBA 字节（raw 贴图 getImageData 产物）,mR/mG/mB=tint×fv
 *  （0..255 浮点）,mE=255×STORM_A×fv——出参 straight RGBA 存面字节:
 *  aR=tex.rgb×tex.a×mR/65025（预乘全幅=XNA 加算 src.rgb）、e=tex.a×mE/255（XNA 加算
 *  src.a=遮盖遍同源）。存面 α=max(e,aR,aG,aB):rgb 逐字节精确可表,α 亮点位过冲。 */
export function stormAddBake(
  tex: Uint8ClampedArray, mR: number, mG: number, mB: number, mE: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(tex.length);
  for (let i = 0; i < tex.length; i += 4) {
    const tA = tex[i + 3];
    if (tA === 0) continue;
    const aR = (tex[i] * tA * mR) / 65025;
    const aG = (tex[i + 1] * tA * mG) / 65025;
    const aB = (tex[i + 2] * tA * mB) / 65025;
    const e = (tA * mE) / 255;
    const m = Math.max(e, aR, aG, aB);
    if (m <= 0) continue;
    out[i] = (aR * 255) / m;
    out[i + 1] = (aG * 255) / m;
    out[i + 2] = (aB * 255) / m;
    out[i + 3] = m;
  }
  return out;
}
/** raw 贴图 straight ImageData 缓存（每 img 一次 getImageData;桶烘焙消费） */
const stormTexData = new WeakMap<object, Uint8ClampedArray>();
function stormTintBucket(img: ImageBitmap | HTMLImageElement, which: 0 | 1, f: number):
  { src: CanvasImageSource; f: number } | null {
  if (!(f > 0)) return null;
  if (typeof document === 'undefined') return { src: img as CanvasImageSource, f };
  const q = Math.max(1, Math.min(STORM_TINT_BUCKETS, Math.round(f * STORM_TINT_BUCKETS)));
  const key = `${which}:${q}`;
  const hit = stormTintBuckets.get(key);
  if (hit) return hit;
  const [r, g, b] = STORM_TINT_COLORS[which];
  const fv = q / STORM_TINT_BUCKETS;
  let tex = stormTexData.get(img);
  if (!tex) {
    const s = document.createElement('canvas');
    s.width = img.width; s.height = img.height;
    const sc = s.getContext('2d', { willReadFrequently: true })!;
    sc.imageSmoothingEnabled = false;
    sc.drawImage(img as CanvasImageSource, 0, 0);
    tex = sc.getImageData(0, 0, img.width, img.height).data;
    stormTexData.set(img, tex);
  }
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const cx = c.getContext('2d')!;
  const im = cx.createImageData(img.width, img.height);
  im.data.set(stormAddBake(tex, r * fv, g * fv, b * fv, 255 * STORM_A * fv));
  cx.putImageData(im, 0, 0);
  const entry = { src: c as CanvasImageSource, f: fv };
  stormTintBuckets.set(key, entry);
  return entry;
}

/** 704 单层两遍绘制（★BJ379:XNA 预乘 AlphaBlend 精确模拟——out=src.rgb+dst×(1−src.a),
 *  Main.cs:33135-33141:rgb=tex.rgb×tint×f 全幅、src.a=tex.a×0.249f）:
 *  ①destination-out(raw 贴图,α=STORM_A×f)=dst×(1−src.a) 遮盖衰减（raw 贴图自带
 *    tex.a 模板,省烘焙）;
 *  ②lighter(预染色桶,α=1)=+src.rgb（桶已携 f 全幅,不得再折 α——单遍
 *    source-over+globalAlpha 即 BJ376 rgb∝f² 过透根因）。
 *  与尘系 dustPremulPair add/erase 同范式;60×60 小面,每层 2 draw 可负担。
 *  ★BJ403:②的桶 α 曾=raw tex.a（destination-in 还原）未被 tint.A 折——lighter
 *  每层把 tex.a 全额累进 dst.α ⇒ 半透区 α 饱和=黑斑（尘系黑方块家族第三发）;
 *  桶已改 stormAddBake 字节级烘焙（α=e=texA×cA 与本遍 erase 同源同值）。 */
function stormLayerDraw(ctx: CanvasRenderingContext2D, img: ImageBitmap | HTMLImageElement,
  which: 0 | 1, f: number, iw: number, ih: number): void {
  if (!(f > 0.004)) return;
  ctx.globalCompositeOperation = 'destination-out';
  ctx.globalAlpha = Math.min(1, STORM_A * f);
  ctx.drawImage(img as CanvasImageSource, -iw / 2, -ih / 2);
  const bk = stormTintBucket(img, which, f);
  if (bk) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 1;
    ctx.drawImage(bk.src, -iw / 2, -ih / 2);
  }
}

// ---------------- 5065 公主之武魔法阵 950(AI_186_PrincessWeapon :43454-43573) ----------------

/** 104×104/ai186/alpha255(本体不可见全粒子)/timeLeft180 但 AI 自管 60t 即 Kill/
 *  tileCollide=false/penetrate=−1/ignoreWater。Damage() 伤 ×0.98（:13575-13577,出生伤折算）。
 *  包络：Opacity=Remap(t,0,60,1,0);scale=(0.4+0.6×easeOut²)×(1−Remap(t,45,60)²);
 *  尘 267(HSL(0.92,1,0.5)粉)双环反向 ×3×½掷(环缘半径 52×scale,法向±45°偏移 6px,
 *  fadeIn rand×1.2×scale,vel 法向∓2+v×0.5)+白克隆 scale/2 fade×0.85;
 *  PrincessWeapon 编排粒子 ×¾掷(u<0.95);t==50 四正交收束爆发 ×2 档速度(:43554-43572)。
 *  命中走通用接触（缺省免疫窗）;direction 朝目标为表现位（:13232,省略）。 */
export class PrincessMagicCircle extends Entity {
  w = 104; h = 104;
  damage: number;
  knockback: number;
  critChance = 0.04;
  armorPen = 0;
  dead = false;
  magicProj = true;
  readonly projId = 950;
  private t = 0;
  private readonly life = 60;
  opacity = 1;
  scl = 0.4;
  private hitCd = new HitCdImpl();
  /** ★BJ383：PVE 受理命中计数（原版 Projectile.numHits :14263;proc 读自增前值;
   *  critter 受理命中亦入账——同 :14263 无条件递增） */
  pveNumHits = 0;

  constructor(x: number, y: number, damage: number, knockback: number) {
    super();
    this.x = x - this.w / 2; this.y = y - this.h / 2;
    this.vx = 0; this.vy = 0;                                   // 零速定点放置（Player.cs:48183）
    this.damage = Math.max(1, Math.trunc(damage * 0.98));       // Damage() 折价 (int)(dmg×0.98)(:13575)
    this.knockback = knockback;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    this.t++;
    if (this.t >= this.life) { this.dead = true; return; }      // :43457-43461
    const u = this.t / this.life;
    this.opacity = 1 - u;                                       // Remap(ai0,0,num,1,0)
    const e1 = 1 - (1 - u) * (1 - u);
    const e2 = 1 - (1 - e1) * (1 - e1);
    const tailK = Math.pow(Math.max(0, Math.min(1, (this.t - 45) / 15)), 2);
    this.scl = (0.4 + 0.6 * e2) * (1 - tailK);                  // :43463-43470
    if (u < 0.9) {                                              // 双环尘（:43479-43537）
      const ringR = (this.w / 2) * this.scl;
      for (const dirSign of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          if (Math.random() >= 0.5) continue;
          const a = Math.random() * Math.PI * 2;
          const nx = Math.cos(a), ny = Math.sin(a);
          const px = this.cx + nx * ringR + ny * dirSign * 6;
          const py = this.cy + ny * ringR - nx * dirSign * 6;
          const d = game.spawnDust?.(px, py, 0, 0, 267, 0, 0, 0,
            { r: 255, g: 102, b: 178, a: Math.round(255 * this.opacity) },
            0.3 + Math.random() * 1.2 * this.scl, true);
          if (d) {
            d.scale *= this.scl;
            d.vx = ny * dirSign * -2 * this.scl + this.vx * 0.5;
            d.vy = -nx * dirSign * -2 * this.scl + this.vy * 0.5;
          }
        }
      }
      if (Math.random() < 0.75) {                               // 编排粒子近似(:43538-43552)
        const a = Math.random() * Math.PI * 2 + Math.PI / 2;
        const rr = (this.w / 2) * this.scl;
        game.spawnParticles(this.cx + Math.cos(a) * rr, this.cy + Math.sin(a) * rr, '#FF66B2',
          1, 1, { life: 20, grav: 0, damp: 0.93 });
      }
    }
    if (this.t === this.life - 10) {                            // 收束爆发(:43554-43572)
      for (let q = 0; q < 4; q += 1) {
        const a = Math.PI * 2 * q * 0.25;
        game.spawnParticles(this.cx, this.cy, '#FF66B2', 2, 6,
          { life: 22, grav: 0, damp: 0.92 });
        void a;
      }
    }
    cutTilesBox(game, this.x, this.y, this.w, this.h);          // CutTiles（:12517/:15276;两门排除表均无 950）
    // ★BJ383 小动物命中面（BJ381 登记债清偿）：950 friendly penetrate=−1（SetDefaults
    //  :8966-8975 显式行）→ critter 照伤弹不亡;受理命中入 numHits 账（:14263 无条件;
    //  critter lifeMax=5 恒不吸血,只入账）。
    if (hitCritters(this, game)) this.pveNumHits++;
    dealContacts(this, game, this.hitCd, 10, (t) => {
      // ★BJ383 幽灵兜帽吸血 proc（:13877-79;950 magic :8964）——proc 先于
      //  :14263 numHits++（读自增前值）;拒收不 proc 不计数。
      ghostHealProc(game, this.projId, this.pveNumHits,
        t as never as Parameters<typeof ghostHealProc>[3]);
      // ★清偿刀 R1 D1（2026-09-30）幽灵伤害头 ghostHurt（Projectile.cs:13881 调用点/
      //  :12021 方法体,SpectreSoulProj 单源零改动复用;BJ420 1115/1116 同构）——
      //  950 数据面 magic（SetDefaults :8958-8970 `magic = true` :8964）+ 幽灵面具
      //  套装 → 受害者 Center 放浮魂 356。受理面 = dealContacts 内环免疫门
      //  （:12635/:12600 收编,在 onHit 前拒）⇒ 到达本位即 flag10 块可达面。
      if (playerHasGhostHurt(game.player)) {
        const v420 = t as never as { vanillaId?: number | null; lastStrikeDealt?: number;
          maxHp?: number; def?: { lifeMax?: number } };
        ghostHurtOnHit(game,
          { magic: true, projDamage: this.damage,
            projX: this.x, projY: this.y, projW: this.w, projH: this.h,
            ownerCx: game.player.cx, ownerCy: game.player.cy },
          { x: t.x, y: t.y, w: t.w, h: t.h,
            cx: t.x + t.w / 2, cy: t.y + t.h / 2,
            vanillaId: v420.vanillaId,
            lifeMax: v420.maxHp ?? v420.def?.lifeMax,
            dealt: v420.lastStrikeDealt ?? 0 });
      }
      // ★BJ424 星云套装 proc（:13885-13891,ghostHurt 同块同门面）——引擎自持全部门
      nebulaBoosterOnHit(game,
        { projId: this.projId, projDirX: this.vx },
        { x: t.x, y: t.y, w: t.w, h: t.h,
          cx: t.x + t.w / 2, cy: t.y + t.h / 2,
          vanillaId: (t as never as { vanillaId?: number | null }).vanillaId,
          lifeMax: (t as never as { maxHp?: number; def?: { lifeMax?: number } }).maxHp
            ?? (t as never as { def?: { lifeMax?: number } }).def?.lifeMax,
          dealt: (t as never as { lastStrikeDealt?: number }).lastStrikeDealt ?? 0 });
      this.pveNumHits++;
    });                                                         // 缺省免疫窗
  }

  draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    // 本体 alpha=255 不可见——以半透明双环呈现粒子阵包络（原版观感近似）
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.opacity) * 0.28;
    ctx.strokeStyle = '#FF66B2';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, (this.w / 2) * this.scl, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = Math.max(0, this.opacity) * 0.16;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, (this.w / 2) * this.scl * (0.4 + 0.6 * this.scl), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}


// ---------------- 修齐批②：钛金屏障碎片 908（AI_175 :46151-46172） ----------------

/** TitaniumStormShard（Player.cs:6927-6936 on-hit 生成≤7;SetDefaults :8628-8638:
 *  14×14/ai175/friendly/penetrate1/timeLeft3600/drawLayer3）：
 *  - frame=rand12、rotation=rand2π 后每拍 +=π/200（:46160-46162）
 *  - 环绕：角=(index/total+miscCounterNormalized×6)×2π、半径=24+total×6,
 *    位=Lerp(位, player.Center+(cos,sin×0.05)×半径, 0.3)（水平扁椭圆,Y 压 0.05）
 *  - 存续门=hasTitaniumStormBuff(buff306)/玩家存活,失即 Kill（:46154-46157）
 *  - 接触伤 50/kb15/penetrate1（命中即亡） */
export class TitaniumStormShard extends Entity {
  w = 14; h = 14;
  damage: number;
  knockback: number;
  critChance = 0.04;
  armorPen = 0;
  dead = false;
  readonly projId = 908;
  private t = 0;
  private rot = Math.random() * Math.PI * 2;
  private frame = Math.floor(Math.random() * 12);
  private orbitAngle = 0;
  private hitCd = new HitCdImpl();

  constructor(x: number, y: number, damage: number, knockback: number) {
    super();
    this.x = x - this.w / 2; this.y = y - this.h / 2;
    this.damage = Math.max(1, Math.round(damage));
    this.knockback = knockback;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    const p = game.player as unknown as { cx: number; cy: number; dead: boolean;
      buffs: { has(t: BuffType): boolean } };
    if (!p || p.dead || !p.buffs.has(BuffType.TitaniumStorm)) { this.dead = true; return; }
    this.t++;
    this.rot += Math.PI / 200;                                 // :46162
    // 组序（AI_GetMyGroupIndexAndFillBlackList 同构近似：同 projId 存活序）
    const all = (game.projectiles?.() ?? []) as Array<{ projId?: number; dead?: boolean }>;
    const group = all.filter((q) => q && !q.dead && q.projId === 908);
    const index = Math.max(0, group.indexOf(this as unknown as { projId?: number; dead?: boolean }));
    const total = Math.max(1, group.length);
    this.orbitAngle = (index / total + this.t / 60 * 6) * Math.PI * 2;
    const radius = 24 + total * 6;                             // :46165
    const tx = p.cx + Math.cos(this.orbitAngle) * radius;
    const ty = p.cy + Math.sin(this.orbitAngle) * radius * 0.05;
    this.x += (tx - this.w / 2 - this.x) * 0.3;                // Lerp 0.3（:46170）
    this.y += (ty - this.h / 2 - this.y) * 0.3;
    // ★BJ383 小动物命中面（BJ381 登记债清偿）：908 friendly penetrate=1（:8636）→
    //  critter 受击耗穿归零即亡（:14184 → :17312 Kill）。非 magic（SetDefaults
    //  :8628-8638 无 magic 行）→ 无幽灵兜帽吸血,不接 proc。
    if (hitCritters(this, game)) { this.dead = true; return; }
    dealContacts(this, game, this.hitCd, -1, () => { this.dead = true; });   // penetrate=1
  }

  draw(r: Renderer, _cam: Camera): void {
    // ★S2/BJ415（2026-09-30）单源化：原手绘横切（img.width/12）轴向本就对（原文
    //  Main.cs:33918 `Frame(projFrames[908]=12, 1, frame)`;贴图 288×28=12×24×28 横条,
    //  原文贴图源=TitaniumStorm Buff RT :33911,本仓无 RT 系统=恒回退弹体贴图同位）,
    //  入 Arrow.PROJ_GRID[908] 后与染料 pass projFrameSrcRect（旧竖切 288×2.3 横条
    //  切片=错轴）双消费单源。
    const ctx = r.ctx;
    if (!ctx) return;
    const fr = projFrameImg(908, this.frame);
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.rot);
    ctx.imageSmoothingEnabled = false;
    if (fr) {
      ctx.drawImage(fr, -fr.width / 2, -fr.height / 2);
    } else {
      ctx.fillStyle = '#B8C4D8';
      ctx.fillRect(-5, -5, 10, 10);
    }
    ctx.restore();
  }
}
