// 敌怪液体交互 1:1（1.4.5.6 NPC.cs UpdateCollision :93712-93805 + Collision_MoveWhileWet :93986
// + Collision.cs WetCollision :1575 / LavaCollision :1657 + TryRemovingWaterPerishableEffects :94537）。
//
// 原版全量语义（本模块逐条实现）：
//  1. wet 判定 = Collision.WetCollision：**中心小盒**（宽 min(10,w) × 高 min(h/2,h)，居中），
//     而非整包围盒；液体格按液面高度收缩（(256-liquid)/32 ×2px 下探、有效高 16-该值）；
//     坡面格（slope≠0 且上方格有液体）按整格 16px 计。岩浆格同样令 wet=true。
//  2. 永不沾水族（:94252）：(690 且 ai[0]==0) | 72 | aiStyle21 | aiStyle67 | 376 | 579 | 541
//     | (aiStyle7 且 ai[0]==25) → wet 恒 false、wetCount=0；且随后 `if(!wet)` 会把本 tick
//     岩浆判定留下的 lavaWet 一并清掉 → 这族在岩浆里照常受伤但移动不受任何液体减速。
//  3. 出入水 transition（wetCount 10t 去抖，:94280/:94386）：入水/出水瞬间各播一次溅落
//     （PlaySound(19,style) 分液体+逐分支静音名单：水 0/蜜与岩浆 1/微光入 4 出 5，
//     见 splashDecision——★岩浆出入水原版有声,红队 R22 第 7 条"静默"系漏读 else 支）；
//     出水瞬间 velocity.X *= 0.5（:94381）；620 火把僵尸出水朝上玩家补 vy-=8（:94384）。
//  4. 移动积分（Collision_MoveWhileWet :93986）：wet 时位移 ×factor —— **velocity 本身不变**，
//     只缩位移（TileCollision.moveAndCollide 入口按 liqFactor 缩 dx/dy 同语义）。
//     factor 默认表（NPC.cs:5946-5952）：水 .5 / 岩浆 .5 / 蜂蜜 .25 / 微光 .375；
//     优先级 微光 > 蜂蜜 > 岩浆 > 水（:93748-93762）。例外 = 1f：DD2 族
//     （LazySetLiquidMovementDD2 :18031，类型 548/549/551-578/620）与 612/613（:16810）。
//  5. 入水熄火（TryRemovingWaterPerishableEffects :94537）：wet 且非岩浆 → DelBuff 24(OnFire)
//     与 323(OnFire3)。蜂蜜/微光同样熄火（门只查 lavaWet）。
//  6. 岩浆（Collision_LavaCollision :94513）：lavaWet=true；非 lavaImmune 族 30t 独立冷却
//     （immune[255]）→ AddBuff(24,420) + 50 直伤。
//
// 本仓差异说明：原版 AI() 先跑、UpdateCollision 后跑（AI 读的是上一 tick 的 wet）；
// 本仓 AI 内部自带移动积分，故液体状态在 AI 之后更新，liqFactor 生效于下一 tick——
// 入水首帧差 1 帧全速，量级 <4px，不可感知。AI 分支读 wet 的时序与原版一致。
import { TILE } from '../core/constants';
import type { TileStore } from '../world/TileStore';
import type { GameHooks } from './types';
import type { Player } from './Player';
import { liquidCollision } from '../stats/TouchDamage';
import { NPC_LAVA_IMMUNE } from '../data/npcLavaImmune';
// BJ677：岩浆 AddBuff(24) 免疫门单源（无循环——projStatus 只依赖 data/stats 层）
import { debuffWriteAllowed } from './projStatus';

/** Collision.WetCollision（Collision.cs:1575-1656）1:1：中心小盒 + 液面收缩 + 坡上液体。 */
export function wetCollision(
  st: TileStore, px: number, py: number, pw: number, ph: number,
): { wet: boolean; honey: boolean; shimmer: boolean } {
  const TS = TILE;
  let num = 10;                       // 盒宽（>Width 时取 Width）
  let num2 = Math.floor(ph / 2);      // 盒高（>Height 时取 Height）
  if (num > pw) num = pw;
  if (num2 > ph) num2 = ph;
  // ★C# 整除陷阱×5（Collision.cs:1578-1592）：Width/2·Height/2(中心两项)、
  //   num2=Height/2(推导)、num/2·num2/2(偏移两项)全部是 int/int 截断。
  //   仅修偏移不足以 parity：奇数宽/高体（鸟虫类比比皆是）中心项浮点除即偏差 ≤0.5px。
  //   实锤病灶（2026-08-31 定罪）：鸭 22 半高时 num2=11→11/2=5，盒跨 [cy−5, cy+6]；
  //   浮点错版整体上移 0.5px → 贴液面钉浮的鸭心盒底恰差 0.25px 触不到部分深度水带
  //   （l<255 表层行）→ wet 逐帧抖 → AI 离水起飞分支与渲染飞/游选帧同频跳变 =
  //   用户实报"水面上飞行/游水态疯狂跳切"
  const vx = px + Math.floor(pw / 2) - Math.floor(num / 2);
  const vy = py + Math.floor(ph / 2) - Math.floor(num2 / 2);
  const i0 = Math.max(0, Math.floor(px / TS) - 1);
  const i1 = Math.min(st.w - 1, Math.floor((px + pw) / TS) + 2);
  const j0 = Math.max(0, Math.floor(py / TS) - 1);
  const j1 = Math.min(st.h - 40, Math.floor((py + ph) / TS) + 2);
  let honey = false;
  let shimmer = false;
  for (let i = i0; i < i1; i++) {
    for (let j = j0; j < j1; j++) {
      if (!st.inBounds(i, j)) continue;
      const idx = st.idx(i, j);
      if (st.liquid[idx] > 0) {
        // 液面高度：liquid 255 → 几乎满格；不足时表面下探、有效高收缩（:1609-1616）
        const drop = (256 - st.liquid[idx]) / 32;
        const surfY = j * TS + drop * 2;
        const effH = TS - Math.trunc(drop * 2);
        if (vx + num > i * TS && vx < i * TS + TS && vy + num2 > surfY && vy < surfY + effH) {
          if (st.liquidType[idx] === 3) honey = true;
          if (st.liquidType[idx] === 4) shimmer = true;
          return { wet: true, honey, shimmer };
        }
      } else {
        // 坡面格 + 上方格有液体 → 整格按满高 16 计（:1635-1654）
        // ★L1（2026-09-01 NX3 遗留清偿）：:1632 门 = tile.active()【纯在场位】
        //   （Tile.cs active()=HasTile，无 inActive 检查）⇒ 接线致动斜坡同样判湿。
        //   本仓 isActive 是 nactive()（active && !inActive）口径，曾致致动斜坡
        //   漏判湿——三副本（npcLiquid/SmartSelect/WeaponProj.inLiquid）同步改
        //   纯在场 type!==0；DrownCollision 豁免行同位同步核正（stats/TouchDamage）。
        //   ★红蓝对抗 A-F3（2026-09-03）：幽灵保域后 type!==0 亦非纯在场位——
        //   残型格 flags=0,type≠0（wld 导入/生成期 active(false)）须判干，改读
        //   flags bit0（=原版 active() 位本体）。三副本同步。
        if (st.flags[idx] === 0 || st.slope[idx] === 0 || j <= 0) continue;
        const above = st.idx(i, j - 1);
        if (st.liquid[above] <= 0) continue;
        if (vx + num > i * TS && vx < i * TS + TS && vy + num2 > j * TS && vy < j * TS + TS) {
          if (st.liquidType[above] === 3) honey = true;
          else if (st.liquidType[above] === 4) shimmer = true;
          return { wet: true, honey, shimmer };
        }
      }
    }
  }
  return { wet: false, honey, shimmer };
}

/** Collision.LavaCollision（Collision.cs:1657-1692）1:1：【全盒】与岩浆格表面带相交。
 *  与 WetCollision 形状两分（:1656 起）：无中心探针盒（整包围盒直测）、无坡面支;
 *  扫描窗同式钳制 0..maxTilesX−1 / 0..maxTilesY−40（:1663-1666）。
 *  消费：Projectile.lavaWet 粘滞位维护（Projectile.cs:16906-16911 只置 true 不清,
 *  清位在主循环 `if (!wet)` 段 :17103-17108——弹体湿缓存生命周期见 Arrow.ts）。 */
export function lavaCollision(st: TileStore, px: number, py: number, pw: number, ph: number): boolean {
  const TS = TILE;
  const i0 = Math.max(0, Math.floor(px / TS) - 1);
  const i1 = Math.min(st.w - 1, Math.floor((px + pw) / TS) + 2);
  const j0 = Math.max(0, Math.floor(py / TS) - 1);
  const j1 = Math.min(st.h - 40, Math.floor((py + ph) / TS) + 2);
  for (let i = i0; i < i1; i++) {
    for (let j = j0; j < j1; j++) {
      if (!st.inBounds(i, j)) continue;
      const idx = st.idx(i, j);
      if (st.liquid[idx] <= 0 || st.liquidType[idx] !== 2) continue;   // tile.lava()
      // 表面带（:1673-1680 num3=(256−liquid)/32、Y+=num3×2、高 16−(int)(num3×2)）
      const drop = (256 - st.liquid[idx]) / 32;
      const surfY = j * TS + drop * 2;
      const effH = TS - Math.trunc(drop * 2);
      if (px + pw > i * TS && px < i * TS + TS && py + ph > surfY && py < surfY + effH) return true;
    }
  }
  return false;
}

/** Collision.GetWaterLine（Collision.cs:1501-1547）1:1：给定锚格 (X,Y)，向上找最近液面。
 *  规则（liquid/16 是 C# byte÷int 整除——液面取被截断值）：
 *   - 越界（InWorld margin 10）或 (X,Y-2) 有液体（已在深处）→ false；
 *   - (Y-1)/(Y)/(Y+1) 任一行有液体 → 线 = 行号×16 − trunc(liquid/16)。
 *  消费：龟/蛙钉水面（NPC.cs:55586 flag12&&wet）、游鸭/鸥 aiStyle 68
 *  （:34922-34971 内联同公式，num1069 再 −6）。 */
export function getWaterLine(
  st: TileStore, tx: number, ty: number,
): { found: boolean; line: number } {
  if (!st.inBounds(tx, ty) || tx < 10 || ty < 10 || tx >= st.w - 10 || ty >= st.h - 10) {
    return { found: false, line: 0 };
  }
  const liq = (x: number, y: number) => (st.inBounds(x, y) ? st.liquid[st.idx(x, y)] : 0);
  if (liq(tx, ty - 2) > 0) return { found: false, line: 0 };
  for (const dy of [-1, 0, 1]) {
    const l = liq(tx, ty + dy);
    // 三档同式：线 = (液体所在行 + 1)×16 − trunc(liquid/16)（:1524/:1530/:1536）
    if (l > 0) return { found: true, line: (ty + dy + 1) * TILE - Math.trunc(l / 16) };
  }
  return { found: false, line: 0 };
}

/** DD2 族液体全速表（LazySetLiquidMovementDD2 调用点反查 SetDefaults：31 处） */
const DD2_FULL_SPEED = new Set<number>([
  548, 549, 620, ...Array.from({ length: 578 - 551 + 1 }, (_, k) => 551 + k),
]);

/** 本 tick 移动积分用液体减速因子（Collision_MoveWhileWet 的 Slowdown 参数）。
 *  dry / 永不沾水族 = 1（走 Collision_MoveWhileDry 不缩位移） */
export function liquidMoveFactor(b: NpcLiquidHost): number {
  if (!b.wet) return 1;
  if (DD2_FULL_SPEED.has(b.vanillaId ?? -1) || b.vanillaId === 612 || b.vanillaId === 613) return 1;
  if (b.shimmerWet) return 0.375;
  if (b.honeyWet) return 0.25;
  if (b.lavaWet) return 0.5;
  return 0.5; // waterMovementSpeed 默认（NPC.cs:5946）
}

/** 永不沾水族（NPC.cs:94252）：wet 恒 false（连带本 tick lavaWet 被清） */
export function skipsWet(b: NpcLiquidHost): boolean {
  const id = b.vanillaId;
  const aiStyle = b.vanilla?.aiStyle ?? -1;
  return (id === 690 && b.ai0 === 0) || id === 72 || aiStyle === 21 || aiStyle === 67
    || id === 376 || id === 579 || id === 541 || (aiStyle === 7 && b.ai0 === 25);
}

/** Enemy 侧液体宿主（结构化窄接口，避免与 Enemy 形成循环依赖） */
export interface NpcLiquidHost {
  x: number; y: number; w: number; h: number; vx: number; vy: number;
  cx: number; cy: number;
  vanillaId: number | null;
  vanilla: { aiStyle: number; noGravity?: boolean; friendly?: boolean } | null;
  ai0: number;
  ai1?: number;
  wet: boolean;
  wetCount: number;
  honeyWet: boolean;
  shimmerWet: boolean;
  lavaWet: boolean;
  lavaCd: number;
  /** SetDefaults dontTakeDamage 位（岩浆接触门 NPC.cs:94468 消费——70/72 机关体入浆无伤不上火） */
  dontTakeDamage?: boolean;
  onFireT: number;
  onFire3T: number;
  /** stinky(120) 存量秒——液体即除（TryRemovingWaterPerishableEffects :94433） */
  stinkyT?: number;
  inWater: boolean;
  liqFactor: number;
  def: { boss?: boolean };
  hurt(dmg: number, kx: number, ky: number, game: GameHooks): void;
}

/** 溅落声决策（NPC.Collision_WaterCollision :94195-94418 全量对拍,R22 重写）。
 *  ★翻案（红队 R22 第 7 条）：岩浆出入水原版【并非】静默——if(!lava)/if(!lavaWet)
 *  只门住 微光/蜂蜜/水 三分支的溅声，else 的岩浆支照样播 PlaySound(19)=Splash_1
 *  （入 :94301-94311 / 出 :94399-94414 两处 else,1456/1457/1458 同构）。本仓旧实现
 *  「岩浆→Splash_1」本来就对,不按红队原案改。
 *  本次真正修的两点偏差：
 *  ① 静音名单逐分支不同（旧实现把水/微光的长名单套到所有分支）——
 *     长(:94262/:94295/:94360/:94393 水+微光,615 海豚豁免)：376/579/aiStyle1/1/16/
 *       147/59/300/aiStyle39/aiStyle68/鸭362·364/蛙361·445/noGravity；
 *     中(:94279/:94377 蜂蜜、:94308 岩浆入)：aiStyle1/1/16/147/59/300/aiStyle39/noGravity；
 *     短(:94410 岩浆出)：中名单去 147；
 *  ② 音量恒 1（:94297 volumeScale 缺省,旧 boss×1.2 与基础 ×0.9 无原版依据）。
 *  返回 null = 该分支静音名单命中；否则返回要播的 wav 名。（导出供回归对拍） */
export function splashDecision(b: NpcLiquidHost, entry: boolean, lava: boolean): string | null {
  const id = b.vanillaId ?? -1;
  const aiStyle = b.vanilla?.aiStyle ?? -1;
  const ng = b.vanilla?.noGravity ?? false;
  const longQuiet = (id === 376 || id === 579 || aiStyle === 1 || id === 1 || id === 16
    || id === 147 || id === 59 || id === 300 || aiStyle === 39 || aiStyle === 68
    || id === 362 || id === 364 || id === 361 || id === 445) && id !== 615;
  const midQuiet = aiStyle === 1 || id === 1 || id === 16 || id === 147 || id === 59
    || id === 300 || aiStyle === 39;
  const shortQuiet = aiStyle === 1 || id === 1 || id === 16 || id === 59 || id === 300
    || aiStyle === 39;
  let quiet: boolean;
  let file: string;
  if (entry ? lava : b.lavaWet) {          // 岩浆支（else 分支,非 !lava 门内）
    file = 'Splash_1';
    quiet = entry ? midQuiet : shortQuiet;
  } else if (b.shimmerWet) {
    file = entry ? 'Splash_4' : 'Splash_5';
    quiet = longQuiet;
  } else if (b.honeyWet) {
    file = 'Splash_1';
    quiet = midQuiet;
  } else {
    file = 'Splash_0';
    quiet = longQuiet;
  }
  return quiet || ng ? null : file;
}

/** NPC.TryRemovingWaterPerishableEffects 1:1（NPC.cs:94420-94444）：
 *  `(onFire||onFire3) && !isInLava` → DelBuff 24/323；`stinky` 无液体门一律 DelBuff 120。
 *  两个消费面：①UpdateCollision 内（本文件 updateNpcLiquid 步骤 4/尾段）②**穿墙支**
 *  （NPC.cs:91614-91617 直积分后 WetCollision → 本函数(isInLava:false)）。 */
export function tryRemovingWaterPerishableEffects(b: NpcLiquidHost, isInLava: boolean): void {
  if ((b.onFireT > 0 || b.onFire3T > 0) && !isInLava) {
    b.onFireT = 0;
    b.onFire3T = 0;
  }
  if ((b.stinkyT ?? 0) > 0) b.stinkyT = 0;
}

/** NPC.UpdateCollision 液体段 1:1（:93712-93805 + :94513-94560）。
 *  顺序照原版：岩浆判定（受伤）→ 水湿判定（wet/蜂蜜/微光/去抖溅落）→ !wet 清岩浆态 →
 *  熄火 → wetCount 递减 → liqFactor 供本帧之后的移动积分消费
 *
 *  ★issue#46 N04（2026-11-03）：**穿墙分支分流**。原版 UpdateNPC :91605-91618
 *  `if (!noTileCollide) UpdateCollision(); else { position += velocity;
 *  if (Collision.WetCollision(...)) TryRemovingWaterPerishableEffects(false); }`
 *  —— UpdateCollision 整块（岩浆直伤/湿身/去抖溅落/wetCount/liqFactor/wet 落速帽）
 *  对 noTileCollide 族【一次都不跑】，穿墙支只做可水灭效果清除。旧实现无条件全跑 =
 *  穿墙族被湿身限速 + 岩浆直伤（猪鲨 370 水中冲刺 vy 16→7、岩浆掉血，实报）。
 *  注意：原版直积分本身正确，**不是**把直积分改成液体减速，而是让它根本不进液体逻辑。
 *  同族 `:91580-91587` 重力/落速帽只受 !noGravity 限定（与 noTileCollide 无关）——
 *  故本函数不承担重力，重力侧仍由 applyGravity 统一（穿墙族照样吃重力）。 */
export function updateNpcLiquid(
  b: NpcLiquidHost, game: GameHooks, st: TileStore, noTileCollide = false,
): void {
  const player = (game as unknown as { player: Player }).player;
  // ---- 0. 穿墙支（NPC.cs:91609-91618）----
  // ①不跑 UpdateCollision：wet/lavaWet/honeyWet/shimmerWet/wetCount 一律不更新
  //   （vanilla 该支不写 wet 字段；AI 侧需要时自清，如 AI_126 :43902-43905）。
  // ②WetCollision 命中（原版静态 Collision.WetCollision，**不走**永不沾水族豁免）
  //   → 可水灭效果（OnFire/OnFire3/stinky），isInLava 恒 false（原版字面）。
  // ③liqFactor=1：没有 Collision_MoveWhileWet 就没有位移缩放——AIs 里走
  //   moveAndCollide 的穿墙分支据此全速直积分。
  if (noTileCollide) {
    if (wetCollision(st, b.x, b.y, b.w, b.h).wet) {
      tryRemovingWaterPerishableEffects(b, false);
    }
    b.liqFactor = 1;
    b.inWater = b.wet;
    return;
  }
  // ---- 1. 岩浆（Collision_LavaCollision :94513）----
  if (b.lavaCd > 0) b.lavaCd--;
  let lava = liquidCollision(st, b.x, b.y, b.w, b.h, 2);
  if (b.vanillaId === 441) lava = false;                  // :94515 type 441 强制豁免
  if (lava) {
    // lavaImmune 只免伤不免 lavaWet（:94524 置位在 !lavaImmune 门之外）——
    // 免疫族入浆同样走岩浆减速档且不熄火
    b.lavaWet = true;
    // 金属矿史莱姆状态位（NPC.cs:61109：type 1 携 364/1104/365/1105/366/1106 矿 →
    // lavaImmune=true，非 SetDefaults 表内——按 ai[1] 状态求值）
    const metalOre = b.vanillaId === 1
      && (b.ai1 === 364 || b.ai1 === 1104 || b.ai1 === 365
        || b.ai1 === 1105 || b.ai1 === 366 || b.ai1 === 1106);
    const lavaImmune = metalOre || (b.vanillaId !== null && NPC_LAVA_IMMUNE.has(b.vanillaId));
    // ★!dontTakeDamage 门（NPC.cs:94468 整块前置——AddBuff(24,420)+StrikeNPC(50)
    // 都在其内）:70 刺球/72 火轮等 dontTakeDamage 机关体入岩浆毫发无伤不上火;
    // 曾缺门=onFireT 直写(绕免疫表)+hurt(50) 被 hurt 入口静默吞 → DoT 把 hp 打穿
    // 0 进永不死亡的僵尸态（评审 C 定谳 2026-09-02 补）
    if (!lavaImmune && !b.dontTakeDamage && b.lavaCd <= 0) {
      b.lavaCd = 30;                                      // immune[255] = 30（:94527）
      // ★remix 分支（:94529-94537）：Main.remixWorld && !friendly → 只上火
      //   AddBuff(24,180)=3s、**不打 50 直伤**；常规 = AddBuff(24,420)=7s +
      //   StrikeNPCNoInteraction(50)。The Hungry 115/116 无 lavaImmune=会烧
      //   （SetDefaults :10406-10426 无此位——wiki"唯一不禁 On Fire 的地狱敌怪"）
      // ★BJ677（2026-10-14）：两支 AddBuff(24) 均过 NPC.AddBuff buffImmune 拒绝门
      //  （NPC.cs:91037 `if (buffImmune[type]) return;` + NPCID.Sets.DebuffImmunitySets
      //  @NPCID.cs:395 表——本仓静态表 = data/vanillaNpcImmunity.ts）。骨蛇 39/40/41
      //  SpecificallyImmuneTo [20,24,31,323]（@:641/:648/:655）——入浆【照吃 50 直伤
      //  +岩浆减速】但不上火 DoT（wiki"免疫 On Fire"真身）；同族=陨石怪 23/地狱装甲
      //  骨 277-280/无头骑士 315 等全部 84 个 OnFire 免疫 NPC（含 ImmuneToAll 37 键档，
      //  24 非鞭 debuff）。直伤 hurt(50) 与 lavaCd=30 不在 buffImmune 门内（原版
      //  同拍照常）——只闸 onFireT 写位。闸走 projStatus.debuffWriteAllowed 单源
      //  （debuffImmuneOverride 运行时豁免位同序同语义：AI_001 熔岩史莱姆 :61312-61316
      //  运行时复位 buffImmune[20] 等照常放行）。
      const fireOk = debuffWriteAllowed(b, 24);
      if (game.world.seedFlags?.remix && !b.vanilla?.friendly) {
        if (fireOk) b.onFireT = Math.max(b.onFireT, 3);   // AddBuff(24, 180)
      } else {
        if (fireOk) b.onFireT = Math.max(b.onFireT, 7);   // AddBuff(24, 420)
        b.hurt(50, 0, 0, game);                           // StrikeNPCNoInteraction(50)
      }
      game.spawnParticles(b.cx, b.cy, '#FF9A3C', 10, 1.6, { life: 30, grav: -0.05 });
    }
  }

  // ---- 2. 水湿（Collision_WaterCollision :94250）----
  const skip = skipsWet(b);
  let flag = false;
  if (skip) {
    b.wetCount = 0;
  } else {
    const r = wetCollision(st, b.x, b.y, b.w, b.h);
    flag = r.wet;
    // 原版只置 true 不清零（:94265-94272），清位统一在 !wet 段（:93729-93732，
    // 在本函数步骤 3）——出水 tick 的湿型残留旗（Splash_5 出水微光档）依赖此序
    if (r.honey) b.honeyWet = true;
    if (r.shimmer) b.shimmerWet = true;
  }
  const wasWet = b.wet;
  if (flag && !wasWet && b.wetCount === 0) {
    b.wetCount = 10;                                      // 入水去抖（:94290）
    if (player && !player.dead) {
      // 按分支选 wav+静音名单（:94233-94311）；音量恒 1（:94297 volumeScale 缺省）
      const f = splashDecision(b, true, lava);
      if (f) game.playSfxWav?.(f, 1, b.cx, b.cy);   // Sfx.atten 统一 2500px 衰减+pan
    }
  } else if (!flag && wasWet) {
    b.vx *= 0.5;                                          // 出水横向衰减（:94381）
    if (b.vanillaId === 620 && player && player.cy < b.cy) b.vy -= 8; // :94384
    if (b.wetCount === 0) {
      b.wetCount = 10;                                    // 出水去抖（:94388）
      if (player && !player.dead) {
        // 出水判 lavaWet 残留旗、微光档 = style 5（:94331-94414）——与入水不对称,原版如此
        const f = splashDecision(b, false, lava);
        if (f) game.playSfxWav?.(f, 1, b.cx, b.cy);
      }
    }
  }
  b.wet = flag;
  // ---- 3. !wet 清液体类型态（:93729-93733）----
  if (!b.wet) {
    b.lavaWet = false;
    b.honeyWet = false;
    b.shimmerWet = false;
  }
  // ---- 4. 入水熄火（TryRemovingWaterPerishableEffects :94420-94444，门 = flag）----
  // ★issue#46 N04：与穿墙支共用单源（onFire/onFire3 受 !isInLava 门、stinky 无门）。
  if (flag) tryRemovingWaterPerishableEffects(b, lava);
  if (b.wetCount > 0) b.wetCount--;                       // :93734
  b.inWater = b.wet;                                      // 兼容旧字段
  // ---- 5. 移动积分因子（:93748-93762 优先级链）----
  b.liqFactor = liquidMoveFactor(b);
  // ---- 6. wet 落速帽（UpdateNPC_UpdateGravity :91936-91944）----
  // 原版 wet 时重力 0.3→0.2 且 maxFallSpeed 10→7（蜂蜜 0.1/4、微光 0.15/5.5；
  // 岩浆走水档 else 分支）。ENEMY_GRAVITY 已换 0.3（2026-08-20 对齐批），重力侧
  // 由 applyGravity wet 档直替；此处落速帽保留（与 applyGravity 的 fallCap 同值幂等，
  // 供自管重力的 AI 路径兜底）——配合 liqFactor ×0.5 位移后有效下沉 ≤3.5px/t
  if (b.wet) {
    const cap = b.shimmerWet ? 5.5 : b.honeyWet ? 4 : 7;
    if (b.vy > cap) b.vy = cap;
  }
}
