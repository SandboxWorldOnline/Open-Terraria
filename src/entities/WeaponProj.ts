// 数据驱动近战/爆炸武器投射物（1456 aiStyle 家族行为，Game.useCombatWeapon 派发）：
//   Boomerang  aiStyle 3   —— 飞出减速后返回主角（AI_003）
//   SpearProj  aiStyle 19/161 —— AI_019 伸缩包络（GetSpearOffsetRelativeToPlayer
//     per-type 伴生弹/延伸命中盒 :43417-43571 逐参移植）/ AI_161 短剑刺直刺模型
//   YoyoProj   aiStyle 99  —— 按住鼠标滞留追光标，松手收回（AI_099 channel 语义）
//   FlailProj  aiStyle 15  —— AI_015_Flails 全状态机（旋转/掷出/回拉/坠落/悬荡/回收）
//   GrenadeProj aiStyle 16 —— 弹跳 + 引信爆炸（手雷 180/炸弹 150/炸药 135 tick）
// 贴图统一 Projectile_N.png 懒加载（Arrow.projSprite 共享缓存）。
import { Entity } from './Entity';
import { moveAndCollide } from '../physics/TileCollision';
import { LIQUID_TYPE, TileStore } from '../world/TileStore';
import { TILE_DEFS } from '../data/tiles';
import { PROJ_GLOWMASK } from '../data/vanillaProjGlow';   // ★BJ603 弹幕 glowMask（1101/1102 相位双画）
import { TtlSpriteMap } from '../assets/ttlSprite';
import { TILE } from '../core/constants';
import type { GameHooks } from './types';
import type { Renderer } from '../render/Renderer';
import type { Camera } from '../render/Camera';
import { Arrow, projFrameCount, projSprite } from './Arrow';
import { projectileWetSection, projWaterDragFactor, projShimmerStep,
  type ProjShimmerFace } from './projWetSection';
import { canBeChasedBy, hitCritters, hitTownNpcs, playerCanHitEnemy, tryReflectProjectile,
  tryReflectShimmerSlimeHit, resolveProjClass, IS_A_WHIP_PROJS, DONT_APPLY_PARRY_DAMAGE_BUFF_PROJS,
  applyBannerDamageDealt } from './projTargets';
import { ConfettiBurstProj } from './meleeOnHitProjs';
import { GorePiece } from './GorePiece';   // AI_189 壳 gore 61-63 生成通道（GorePiece 引擎池）
import { ProjGhostRing, projTrailingMode, drawRainbowChain, drawHslMidpointTrail } from './projGhostTrail';   // ★BJ235 1089/563 残影
import { applyProjStatus, applyMeleeImbue, applyFrostBurn, applyMagmaStoneProj } from './projStatus';
import { ghostHurtOnHit, playerHasGhostHurt, ghostHealProc } from './SpectreSoulProj';   // ★BJ382 雨滴 239/245 proc 单源（★清偿刀 U2 2026-10-01：proc 上收共享环受理位,雨滴回调退纯 penetrate 记账）
import { ZAPPING_JELLYFISH, jellyZapProjectile } from '../player/SwingPathMath';   // ★清偿刀 U2（2026-10-01）：水母块 Arrow/WhipProj/proj1457 形态复用（S2-债2 同表单源）
import { nebulaBoosterOnHit } from './NebulaBooster';   // ★BJ424 星云套装 on-hit 单源
// Spawn_PaladinsHammerShockwave 编排本体（收编池;L5 批 2026-08-31——301 撞墙本地
// 直生 + broadcast 上行同用此函数）
import { paladinsHammerShockwaveFx } from '../fx/orchestraFx';
import { ParticleOrchestraType } from '../net/syncModules';
import { noteVanillaProjImmune } from './projTargets';
import { cutTilesBox } from './ProjCutTiles';   // ★BJ285 死亡段割面（BJ260 同款前置习语）
import { projectileSnapStrikeBonus } from '../stats/SnapStrike';
import { projectileData } from '../data/vanillaProjectiles';
import { heldItemCritBonus, rollVanillaHitCrit } from './proj1457';   // ★BJ488③ :25712 持械折入算式单源（rollVanillaHitCrit 同源;函数声明环=运行时调用安全）;★BJ489 def-3 注入支掷率单源
import { canHit } from '../physics/LineOfSight';
import { wetCollision, lavaCollision } from './npcLiquid';
import { hostileProjectileDamage, mainDifficulty } from '../stats/ScaleStats';
import { damageVarRoll } from '../stats/DamageVar';
import { runModModifyHitNpcByProj } from '../mods/hooks';   // ★刀4-A:弹命中 NPC 修正链
import { drawYoyoStringLine, stringColorOpts } from '../render/StringLine';
import { BuffType } from '../stats/Buffs';
import { TORCH_DUST_BY_STYLE } from '../world/Torch';

/** 原版投射物绘制偏移表（Main.cs:30077-30528 num151/num152 表,96 条静态项——★BJ665 勘正 1456 伪锚 :29375-29826/1456 伪名 num143/num144）。
 *  语义:贴图左上角落于 (盒左 + num144, 盒上 − num143)——num143 为"上移"量。
 *  典型:炸弹 28=上移 8(22×30 贴图,引线 y=0-7 全在盒外,弹体 y=8-29 恰填 22×22 盒,
 *  Main.cs:30262);雷管 29=上移 11(10×32)（★BJ665 勘正 1456 伪锚 :29560）。
 *  方向/高度依赖项已入 PROJ_DRAW_OFFSET_DYN(959/1095/1096/1003/1004/112/
 *  191-194/390-392/313/397——待对应弹型接入时传 dirX 生效);
 *  浮标 proj.bobber=8 项不经本表——Bobber 实体自持绘制(AI_061 全语义移植)。 */
const PROJ_DRAW_OFFSET: Record<number, readonly [number, number]> = {
  // ★SW-BJ13 2026-09-07：1022/1036 项退役（+423 见下行）——原版 Main.cs:34788 专绘支
  //   家族（393-395/398/423/450/1022/1036/1093/1112/1118）draw 锚=帧心@盒心+(0,−num467)、
  //   origin=(图宽/2,帧高/2+num151),不走通用尾绘盒左上锚;:30077 switch 的 num151/num152
  //   值由 MinionProj.draw 专绘支直读（1022 num151=1/1036 num151=−4;423 num152=−5 原版本
  //   支不消费）。MinionProj 消费端经通用路吃表值=错锚（1118 同族曾偏 (+12,+22)=用户 F3 实报）
  175: [10, 0], 1025: [22, 0],   // 392 移 DYN 表
  // ★BJ669c（2026-10-13 用户四连报拍板「贴图归位」明令分歧）：864 刃杖同心锚——
  //   [num143=11, num152=−4] ⇒ 帧顶=盒顶−11、帧左=盒左−4、帧心=盒心（rot 任意值
  //   帧心恒在盒心=旋转绕帧心不动）。本体与辉光/残影（帧心对盒心 :31395/:31351）
  //   同心=影子只在贴图外露一圈（用户原版目击图 118 三连+本仓 F3 观察「影子正对
  //   盒心、贴图偏移」）。★反编译矛盾登记 [bj669-864-anchor-conflict]：多帧支缺省
  //   公式（:35052 position+(num153, h/2) − origin(num153, h/2+num151)、偏移表
  //   :30077 无 864 条目）推得「帧左上锚盒左上」＝rot=π 时帧心在盒心上方 11px
  //   ——与用户原版目击（同心）冲突,四轮反编译穷尽（aiStyle169 无专绘支/
  //   :30609-35330 无 864 特支/num151 表无条目）未能闭合,按用户观察优先落同心。
  //   待原版 F3 碰撞盒截图或更深层证据翻案。
  864: [11, -4],
  499: [12, 0], 765: [22, -16], 966: [-26, -6], 519: [6, -6], 520: [12, 0],
  492: [5, -4], 498: [6, 0], 489: [-2, 0], 486: [-6, 0], 525: [5, 0],
  488: [0, -8], 373: [6, -10], 375: [12, -11], 346: [4, 0],   // 423 移 34788 专绘支(★SW-BJ13)
  331: [0, -4], 254: [3, 0], 273: [0, 2], 335: [6, 0], 162: [1, 1],
  377: [-6, 0], 353: [36, -12], 324: [22, -6], 266: [6, -13], 319: [10, -12],
  315: [-13, -6], 314: [0, -8], 269: [18, -14], 268: [22, -2], 18: [3, 3],
  16: [6, 0], 17: [2, 0], 31: [2, 0], 25: [6, -6], 26: [6, -6], 35: [6, -6],
  63: [6, -6], 154: [6, -6], 947: [4, -4], 948: [4, -4],
  28: [8, 0], 37: [8, 0], 75: [8, 0], 1077: [8, 0],          // 炸弹族(含引线)
  29: [11, 0], 470: [11, 0], 637: [11, 0],                    // 雷管族(长引线)
  43: [4, 0], 208: [2, -12], 209: [4, -8], 210: [2, -22], 251: [18, -10],
  163: [10, 0], 310: [10, 0], 1008: [10, 0], 1009: [10, 0], 1010: [10, 0], 1011: [10, 0],
  69: [4, 4], 70: [4, 4], 50: [0, -8], 53: [0, -8], 515: [0, -8], 870: [0, -8],
  473: [2, -6], 72: [8, -16], 86: [8, -16], 87: [8, -16], 74: [0, -6],
  99: [1, 0], 727: [1, 0], 1013: [1, 0], 1014: [1, 0], 1047: [1, 0], 1048: [1, 0],
  1053: [1, 0], 1054: [1, 0], 1055: [1, 0], 1057: [1, 0], 655: [1, 0],
  111: [18, -16], 875: [16, -16], 881: [14, -8], 934: [14, -20], 884: [16, -12],
  890: [26, -9], 891: [30, -12], 897: [38, -13], 899: [28, -12], 900: [54, -30],
  334: [8, -18], 816: [6, -19], 821: [6, -10], 825: [14, -19], 854: [10, -14],
  858: [16, -8], 859: [8, -8], 860: [34, -8], 958: [48, -20], 960: [24, -14],
  956: [16, -12], 994: [18, -10], 998: [14, -10], 1027: [4, -6],
  200: [12, -12], 211: [14, 0], 236: [30, -14],
  517: [6, 0], 681: [6, 0], 516: [6, 0], 127: [8, 0], 155: [3, 3],   // 397 移 DYN 表(num145−1)
};

/** 方向/高度依赖偏移项（Main.cs:30077-30528 表内 spriteDirection/direction/height——★BJ665 勘正 1456 伪锚 :29375-29826
 *  条目,2026-08-19 补齐机制）。dirX = 弹体朝向（spriteDirection 语义:+1 右/-1 左,
 *  调用方传实体 facing）；dir = 原版 proj.direction（AI 移动朝向,缺省=dirX——
 *  ★F5b：191-194/390-392 三族原文读 direction 非 spriteDirection
 *  （Main.cs:30490-30498），MinionProj 消费端经第三参传真值）。397 的 num145-=1
 *  以第三元素表达（0/−1）。
 *  ★当前消费端（本仓 aiStyle 族的 drawProj 调用方）尚未覆盖这些型号——表先行就位,
 *  对应弹型接入时传 dirX 即生效;浮标 bobber=8 项由 Bobber 实体自持绘制,不入本表 */
const PROJ_DRAW_OFFSET_DYN: Record<number, (dirX: number, h: number, dir: number) => readonly [number, number, number]> = {
  // ★T9（2026-09-01）：弩车三档 677/678/679 表项退役——F5① 折算（2026-08-31）把
  //   Main.cs:34097-34137 支的锚误读为 Bottom 系（该支【不】重置 vector99,继承
  //   :33695 的 Center 缺省;663/691 支 :34082/:34091 才显式 Bottom）,折算结果整体
  //   偏低 27px 且漏塔座 Extra_83/84/85,连带「dir^=FlipH|FlipV 双轴镜像背面朝向」
  //   无法在单轴 num143/144 公式内表达。已由 MinionProj.draw 弩车专绘 1:1 替代
  //   （锚/origin/dir 组合逐项照录,含 AI_134 rotation 状态机接入）,本表不再承载。
  959: (d) => [40, -14 + (d === -1 ? -8 : 0), 0],
  1095: (d) => [40, -14 + (d === -1 ? -8 : 0), 0],
  1096: (d) => [40, -14 + (d === -1 ? -8 : 0), 0],
  1003: (d) => [22, -18 + (d === 1 ? 8 : 0), 0],
  1004: (d) => [26, -18 + (d === 1 ? 6 : 0), 0],
  112: (d) => [14, -8 + 4 * d, 0],
  191: (_d, _h, dir) => [26, dir !== 1 ? -22 : -10, 0],   // Main.cs:30490-30493 direction
  192: (_d, _h, dir) => [26, dir !== 1 ? -22 : -10, 0],
  193: (_d, _h, dir) => [26, dir !== 1 ? -22 : -10, 0],
  194: (_d, _h, dir) => [26, dir !== 1 ? -22 : -10, 0],
  390: (_d, _h, dir) => [0, 4 * dir, 0],                  // Main.cs:30495-30498 num152=4*direction
  391: (_d, _h, dir) => [0, 4 * dir, 0],
  392: (_d, _h, dir) => [-2, 4 * dir, 0],
  313: (_d, h) => (h !== 54 ? [20, -12, 0] : [0, 0, 0]),
  397: () => [-2, -2, -1],   // num145−1（cs:29821-29823）
  // 火绒狐 1094/1113（2026-08-23 网格贴图批；非 num143/144 表系,1457 Main.cs:33742
  // vector99.Y -= 11 专支折算：帧 62×44 心 = (cx, cy−11)、盒 18×18 →
  // 贴图左上 = (盒左−22, 盒上−24)。翻转侧 −8 原点修正不走本表（MinionProj
  // 消费端传真 facing,F5b 前恒传 −1）,由 MinionProj.draw foxFlipAdj 直补）
  1094: () => [24, -22, 0],
  1113: () => [24, -22, 0],
};

/** num143/num144(含 397 的 num145−1)偏移求值——静态+动态两表共用,
 *  供 MinionProj 等非 drawProj 消费端接入。返回 null = 两表均未登记。
 *  dirX = spriteDirection 语义(+1 右/−1 左);boxH = 碰撞盒高(313 高度门用);
 *  dir = 原版 proj.direction(AI 移动朝向;缺省回退 dirX——仅 191-194/390-392
 *  三族原文读 direction,Main.cs:30490-30498,F5b)。 */
export function projDrawOffsetFor(projId: number, dirX: number, boxH: number,
  dir = dirX): readonly [number, number, number] | null {
  const dyn = PROJ_DRAW_OFFSET_DYN[projId];
  if (dyn) return dyn(dirX, boxH, dir);
  const st = PROJ_DRAW_OFFSET[projId];
  return st ? [st[0], st[1], 0] : null;
}

/** 共用绘制：投射物贴图按角度旋转。
 *  锚点 1:1 原版通用绘制公式（Main.cs:35047;origin38=:35032——★BJ665 勘正 1456 伪锚 :34040）:
 *    anchor = (盒左 + num153 + num152, 盒上 + 盒高/2),origin = (num153, 盒高/2 + num151)（1456 伪名 num145/num144/num143）
 *    num145 = (贴图宽 + 盒宽)/2 → 展开后贴图左上角落于 (盒左 + num144, 盒上 − num143),
 *    旋转绕 anchor 进行。非方贴图(W≠盒宽)按此公式为"盒左对齐"而非居中。
 *  世界坐标绘制(Renderer 实体循环运行在世界变换内,勿再自算屏幕坐标) */
function drawProj(r: Renderer, _cam: Camera, e: { x: number; y: number; w: number; h: number }, projId: number, ang: number, fallbackColor: string, alpha = 1, drawSize = 0, mirror = false, centerAnchor = false, scale = 1,
  // SW-I1 2026-09-03：帧通道（Main.cs:34923 projFrames>1 通支）——source=(0,帧高×frame,
  // 贴图宽,帧高−1)（SW-L1 2026-09-03 I-4：:35047 Rectangle num482−1 底行 shave）、
  // dest 高=帧高−1 保纵横、origin/锚点公式不变。frames=Main.projFrames[id]。
  frame = -1, frames = 0,
  // ★BJ-C1 F2（2026-10-06）：capture 槽（270/45 BJ529/530 判例同构）——提供时本函数
  // 不落实体层,把同一绘制序列打包成闭包交调用方（projFullbrightQueue 光照合成后
  // source-over 复绘=常量色弹面;单源=变换数学仍在本函数,零复制）。19 Flamarang/
  // 35 Sunfury 恒白面（Projectile.cs:81465-81468 Color.White）经此收编。
  capture?: (fn: (ctx: CanvasRenderingContext2D) => void) => void,
  // ★BJ603：glowMask 臂（Main.cs DrawProjDirect 通用支 :35498-35518——1101:372/
  //   1102:373 相位双画,Projectile.cs:10021/:10037）——true 且 PROJ_GLOWMASK 命中
  //   时,本体绘制后以同矩阵收 projGlow op（源=弹幕贴图全幅、dest=本体同框;
  //   色自发光 → itemGlowQueue 合成后冲刷）。
  glowMask = false): void {
  // drawSize=绘制尺寸(0/-1=贴图原生尺寸×scale——F1/RB28 前缺省 0 曾取碰撞盒 w;
  // -1 为历史显式写法,与缺省 0 同义——原版投射物绘制语义,爆炸族雷管 10×32 竖条
  // 等非方贴图必须走原生尺寸否则被拉方)
  // mirror=旋转坐标系内水平镜像（XNA dir=FlipHorizontally 等价，绕 origin 翻转）
  // centerAnchor=Main.cs:33161 专属组（802/842/938-945 短剑刺族等,★BJ665 勘正 1456 伪锚 :32360）：锚=盒中心、
  // origin=贴图中心、无 num143/144 偏置——曾误走通用 num145 偏置锚（枢轴≈剑尖），
  // 右刺角度巧合正常、左刺 −π/4×sd 与镜像叠加后枢轴错位=剑柄朝前（2026-08-17 用户报）
  const img0 = projSprite(projId);
  // ★F1/RB28 2026-09-14：通支 dest=贴图原生尺寸×scale——原版 DrawProjDirect 通支
  //  Main.cs:35475 source=(0,0,texW,texH)、scale=proj.scale（origin40.x=num153=
  //  (texW−proj.width)×0.5+proj.width×0.5=:30130 化简 texW/2,与本函数 num145 同式,
  //  锚点不动）。drawSize=0 缺省曾取碰撞盒宽 e.w → 盒宽≠贴图宽的投射物被拉伸到
  //  命中盒（雨云雨滴 239=2×40 误绘 4×80、245=2×30 误绘 4×60 实锤）；drawSize>0
  //  保留为调用点显式覆盖、无图 fallback=e.w 不变。
  const dw = drawSize > 0 ? drawSize
    : img0 && img0.width > 0 ? img0.width
      : e.w;
  const ctx = r.ctx;
  if (!ctx) return;
  // ★BJ-C1 F2：绘制序列封包（形参 ctx 遮蔽外层 const——绘制数学逐字原位,零复制）;
  // 无 capture 时行为与旧版逐位同相（直接 paint(ctx)）。
  const paint = (ctx: CanvasRenderingContext2D): void => {
  const img = img0;
  const hasImg = !!(img && (img.width > 0) && img.width > 0);
  const W = hasImg ? img!.width : dw;
  // num153 = (贴图宽−盒宽)/2 + 盒宽/2 = 贴图宽/2（Main.cs:30303 原式化简——★BJ665 勘正 1456 伪锚 :29601/伪名 num145）——
  // 旋转枢=贴图水平中点;曾误写 (贴图宽+盒宽)/2 → 悠悠球/回旋镖绕偏心点公转
  const num145 = W / 2;
  // 偏移取值：方向/高度依赖项优先（弹体朝向取实体 facing——spriteDirection 语义），
  // 其余走静态表（共享求值——MinionProj 等消费端同源）
  const off3 = projDrawOffsetFor(projId, (e as { facing?: number }).facing ?? 0, e.h);
  const [off143, off144, num145Adj] = off3 ?? [0, 0, 0];
  const num145f = num145 + num145Adj;
  const dwS = dw * scale;                             // 绘制缩放（Main.cs:33161 Vector2.One×proj.scale——★BJ665 勘正 1456 伪锚 :32360）
  const s = dwS / W;                                  // 绘制缩放(原生尺寸=1)
  ctx.save();
  ctx.globalAlpha = alpha; // AI_161 细剑淡入淡出(:44993-44994)
  if (centerAnchor) {
    // :32361-32367：vector75=盒中心+gfxOffY、origin=贴图中心、scale=proj.scale(1)
    ctx.translate(e.x + e.w / 2, e.y + e.h / 2);
    ctx.rotate(ang);
    if (mirror) ctx.scale(-1, 1);
    ctx.imageSmoothingEnabled = false;
    if (hasImg) {
      // ★中心锚组绘制尺寸=贴图原生×scale（Main.cs:33161 vector76=Vector2.One×proj.scale——★BJ665 勘正 1456 伪锚 :32360,
      // origin=贴图中心）——勿用 dw（drawSize=0 时 dw=盒宽,会把球缩到命中盒大小）
      const sw = W * scale, sh = img!.height * scale;
      ctx.drawImage(img!, -sw / 2, -sh / 2, sw, sh);
    } else {
      ctx.fillStyle = fallbackColor;
      ctx.fillRect(-dwS / 2, -dwS / 2, dwS, dwS);
    }
    ctx.restore();
    return;
  }
  ctx.translate(e.x + num145f + off144, e.y + e.h / 2);
  ctx.rotate(ang);
  if (mirror) ctx.scale(-1, 1);
  ctx.imageSmoothingEnabled = false;
  if (hasImg) {
    // SW-I1 2026-09-03：帧支（Main.cs:34942-34944 num481=贴图宽/num482=贴图高÷
    // projFrames/y25=帧高×frame;通支 draw :35047 source=Rectangle(x15,y25,num481,
    // num482−1)、origin=(num153,h/2+num151)——dest 高由整贴图纵横比改为帧高纵横比,
    // 锚点不动。SW-L1 2026-09-03 I-4：源高补 −1 shave（曾用满帧高 fh——519/773 底行
    // 多渗 1px;:35002 衬色子支才用满 num482 且先 return,非通支））
    if (frames > 1 && frame >= 0) {
      const fh = img!.height / frames;
      const sh = fh - 1;                        // Main.cs:35047 num482 - 1
      ctx.drawImage(img!, 0, fh * frame, W, sh,
        -num145f * s, -(e.h / 2 + off143) * s, dwS, dwS * (sh / W));
    } else {
      ctx.drawImage(img!, -num145f * s, -(e.h / 2 + off143) * s, dwS, dwS * (img!.height / img!.width));
    }
    // ★BJ603 glowMask 臂（:35498-35518 通用支——本体后同矩阵同框叠画;源=弹幕
    //   贴图全幅=光罩平行表同框。alpha 恒 0（1101/1102 SetDefaults 无 alpha 覆写）
    //   ——相位双画色序由 pushProjGlow 内 projGlowColors 承担）
    if (glowMask && PROJ_GLOWMASK[projId] !== undefined) {
      const m = ctx.getTransform();
      (r as unknown as {
        pushProjGlow?: (id: number, mm: DOMMatrix, dx: number, dy: number, sw: number, sh: number, alpha: number) => void;
      }).pushProjGlow?.(projId, m,
        -num145f * s, -(e.h / 2 + off143) * s, dwS, dwS * (img!.height / img!.width), 0);
    }
  } else {
    ctx.fillStyle = fallbackColor;
    ctx.fillRect(-dwS / 2, -dwS / 2, dwS, dwS);
  }
  ctx.restore();
  };
  if (capture) { capture(paint); return; }
  paint(ctx);
}

/** 同敌命中去重 + 冷却的通用伤害结算。
 *  hitCd 记录每敌剩余冷却 tick，每 fixedUpdate 调用方先 tickCd() 递减；
 *  cooldown >= 9999 视作单次结算（突刺类：一击每敌只中一次） */
export class HitCooldown {   // exported：combat-stitch-final 确定性测试用
  private map = new Map<number, number>();
  tick(): void {
    for (const [k, v] of this.map) {
      if (v <= 1) this.map.delete(k);
      else this.map.set(k, v - 1);
    }
  }
  ready(id: number, cooldown: number): boolean {
    if (this.map.has(id)) return false;
    if (cooldown < 9999) this.map.set(id, cooldown);
    else this.map.set(id, 2147483647); // 永不再中
    return true;
  }
  /** ★清偿刀 U2（2026-10-01）：读面/写面拆相（proj1457 R1-C cd.peek 同款）——
   *  只查行不落账（≙原版外环 flag2 读 :12595 无副作用）。写面（ready）由调用方
   *  在水母块之后补（:14036 写梯位）——充能水母接触路径（:12686 return）零落账。 */
  peek(id: number): boolean {
    return !this.map.has(id);
  }
  clear(): void { this.map.clear(); }
}

type ReflectableWeaponProj = {
  x: number; y: number; w: number; h: number;
  vx: number; vy: number;
  damage: number; knockback: number;
  projId?: number;
  hostile?: boolean;
  reflected?: boolean;
  /** 暴击率（GetWeaponCrit：4 基础+武器 item.crit+装备/buff,Game 侧算好传入） */
  critChance?: number;
  /** 近战系投射物（吃武器浸剂 meleeEnchant,StatusNPC:10559 门 (melee||whip)） */
  meleeProj?: boolean;
};

export function hitEnemies(   // exported：tests/combat-stitch-final（A3①③④/A5 弹幕侧确定性对拍面）
  self: { x: number; y: number; w: number; h: number; vx: number; damage: number; knockback: number; projId?: number },
  game: GameHooks,
  hitCd: HitCooldown,
  cooldown: number,
  dirX: number,
  pen = 0,
  /** 每次命中敌结算后的回调（Boomerang 的 Projectile.Damage 回收门用；
   *  悠悠球/配重球的命中链也在此语义点触发——入参=命中敌）。
   *  ★BJ388 件1（2026-09-28）：本回调在【受理位】求值（原版 Damage_PVE_Inner 全部
   *  命中段在免疫门 :12634-12637 之后,门拒整段静默;见函数内 vanillaGated 注） */
  onHit?: (e: unknown) => void,
  /** 型号段伤害乘区（★BJ388 件2 改约,2026-09-28）：入参 = mul 乘区截断后的 dmg int,
   *  返回经逐段 (int) 截断的终值——原版 dmg 在 :12970 DamageVar 已是 int,型号段
   *  （383 宽盒 ×0.6 :13088-13089/悠悠球无视线 ×0.75 :13318/555·546 里程碑 ×2
   *  :13428-13437）各自乘完再 (int) = 先截后乘;段序在 parry(:13627)/nano(:13688) 前 */
  dmgScale?: (e: unknown, dmg: number) => number,
  /** 玩家级共享免疫门（NPC.immune[owner]>0 语义 = Enemy.iframes）：true 时不建
   *  逐弹私账、改按敌方全局免疫帧去重——悠悠球/配重球走此档（DefaultToYoyo
   *  不设 usesLocalNPCImmunity/localNPCHitCooldown,Projectile.cs:10155-10161;
   *  Damage_PVE 前置门 npc.immune[owner]==0 :12603/:12635-12637（★BJ340 表面勘误:
   *  旧锚 :11905 漂,1457 该行为命中敌方 buff 施加支,非免疫门）,hurt 落地置 10t :13152 缺省档）。
   *  同玩家全部 aiStyle 99 弹共享:手套二号球/配重球 10t 内不能重复命中同敌 */
  playerImmune = false,
  /** 前向延伸命中盒（AI_019 长矛 105/46/153 伸出相,Projectile.cs:47034-47073;1456 伪锚 :43530-43571 勘正）：
   *  Colliding（:15420,aiStyle 19 步进支 :15902-15927;1456 伪锚 :14554-14576 勘正）语义 = 弹心→盒心按 max(w,h)(min12) 步进连续方盒
   *  + 延伸盒本体,与弹体 AABB 并集判定 */
  extBox?: { x: number; y: number; w: number; h: number } | null,
  /** ★BJ339（2026-09-25）：hurt pierce 位实参（Enemy.hurt 第 7 参,Projectile.cs
   *  :13702 StrikeNPC 链）。0 = 缺省档（pen≠1 弹命中写敌免疫 10t,:14176-14182
   *  `penetrate != 1` 分支——回旋镖/悠悠球/404 等共享窗弹同款）；1 = 单发弹
   *  flag3（:12635 `maxPenetrate == 1` 门）→ 命中【不写】immune[owner]（:14176
   *  else-if 分支不达）——405 泡泡 penetrate=1 即此档,命中后 404/悠悠球等共享
   *  窗弹【不被自己挡】。缺省 0 = 既有调用方行为零漂移 */
  hurtPierce = 0,
  /** ★BJ339：击退方向覆写（num40,Projectile.cs:13652）。原版缺省 = 弹 direction
   *  字段（每拍由 AI 重写的弹,如 404 :30742-30751 球侧）——仅 697/699/707/708/759、
   *  aiStyle 188-191/15、type 22 覆写为「玩家相对敌位」（:13654-13678）。缺省
   *  undefined = 既有承载（敌相对弹位 Math.sign）零漂移；404 传球侧 direction
   *  1:1（69 族不在覆写表,回收途中命中击退仍朝玩家面朝向,不随敌位翻转）。
   *  ★BJ340 §0.1 勘正+BJ344 落：405 伤害时原版=sign(vx,0→1)——aiStyle 70 不在
   *  AutomaticallyChangesDirection 排除表（:17387-17398）,自动向（:17121-17131）
   *  同子步先于 Damage（:17184）；旧注「弹池槽残留,无稳定语义」作废。405 调用点
   *  现仍走敌相对弹位承载（登记缺口,随家族 W3b 405 用例联测另案）。
   *  ★BJ344：升格 number | (e) => number 逐敌回调——301/383（:13056-13099）与
   *  aiStyle 15（:13667-13678）的原版写位逐敌比对 targetNPC.Center.X↔玩家心,
   *  同拍多敌两侧并存时各有各的向,静态数表达不了。 */
  dirOverride?: number | ((e: unknown) => number),
  /** ★BJ344：num5 击退缩放乘区（num5=knockBack :12849 → 逐型修饰链 → StrikeNPC）。
   *  链锤 aiStyle15 态门：ai0==0（出程蓄旋）×0.35 / ai0==6（悬荡）×0.5（:13670-13677,
   *  两 if 独立非 else-if）;回旋镖宽盒拍（projRectangle.Width > width 判据 :13058/
   *  :13086,本仓=boomBox 冲击盒非空拍）：301 ×1.75（:13060）/383 ×1.5（:13088）。
   *  缺省 1 = 既有调用方零漂移 */
  kbScale = 1,
  /** ★BJ382（2026-09-28）受理回调（原版 ghostHeal proc（:13877-79）/penetrate--
   *  （:14189-14196）/numHits++（:14263）所在段=免疫门 :12634-12637 后受理面）。
   *  ★BJ393 件2 判据勘正：旧「hurt 返真」实为击杀位（Enemy.hurt 布尔=死亡管线跑完
   *  才返真,普通命中/血尽级联返假 Enemy.ts:15037/:14369 族）——现改 !vanillaGated
   *  （非门拒即受理,与 onHit/applyProjStatus 同平面）。239/245 雨滴在此挂
   *  ghostHealProc+dropHits++（penetrate--）+pveNumHits++（numHits++）。
   *  缺省 undefined = 既有调用方零漂移 */
  onAccepted?: (e: unknown) => void,
): void {
  // 小动物:一击致死(原版小动物是 NPC;近战挥砍同语义)。回旋镖/悠悠球等穿透型
  // 命中小动物不消耗穿透语义——hurt 自带 iframes 防同帧连击
  hitCritters(self, game);
  // 城镇 NPC 受击(原版 Projectile.Damage 对 friendly NPC 同样生效,杀裁缝师即此链);
  // 穿透型不消耗穿透语义(NPC.hurt 8t iframes 自去重)
  hitTownNpcs(self, game, self.damage, Math.sign(self.vx) * 2, 'playerProj', self.projId ?? 0);
  const me = self as ReflectableWeaponProj;
  // 反射后的弹体 friendly 已翻——不再入敌怪判定（原版 Damage NPC 需 friendly 门禁）
  if (me.reflected) return;
  // 延伸盒步进盒组（Colliding :14560-14572：num18 = max(W,H) 且 ≥12，从弹心到
  // 盒心每 num18 一个同尺寸方盒,末盒=延伸盒本体——弹体 AABB 之外的走廊补判）
  const extRects: Array<{ x: number; y: number; w: number; h: number }> = [];
  if (extBox) {
    const scx = self.x + self.w / 2, scy = self.y + self.h / 2;
    const ccx = extBox.x + extBox.w / 2, ccy = extBox.y + extBox.h / 2;
    const dist = Math.hypot(ccx - scx, ccy - scy);
    const step = Math.max(12, Math.max(extBox.w, extBox.h));   // :14564-14566
    for (let d = step; d < dist; d += step) {
      const t = d / dist;
      extRects.push({ x: scx + (ccx - scx) * t - extBox.w / 2, y: scy + (ccy - scy) * t - extBox.h / 2, w: extBox.w, h: extBox.h });
    }
    extRects.push(extBox);                                     // :14573-14575
  }
  // ★α-H1/H3（终局扫尾批 A3）：类别通道解析（弹级一次）+ 玩家侧旗快照。
  //   projClass 解析序 = 实体显式字段 → 弹 id 数据面（vanilla SetDefaults 类旗投影）
  //   → 旧 meleeProj 旗兜底；cls=null = 无类弹（原版 crit 掷/浸剂门都轮不到）。
  const cls = resolveProjClass(me);
  const pl = game.player as unknown as {
    buffs: { has: (b: BuffType) => boolean };
    equipStats: { frostBurn: boolean; magmaStone: boolean };
    critChance: (k: 'melee' | 'ranged' | 'magic') => number;
    parryDamageBuff?: boolean;
    parryDamageBuffT?: number;
  };
  const playerPct = (k: 'melee' | 'ranged' | 'magic'): number => pl.critChance(k);
  const imbuNano = pl.buffs.has(BuffType.ImbueNano);
  const imbuParty = pl.buffs.has(BuffType.ImbueParty);
  for (const ent of game.enemies()) {
    // ★dontTakeDamage 目标排除（Projectile.cs:12600 外环门 `!nPC.dontTakeDamage ||
    // ZappingJellyfish[nPC.type]`——浸剂/冰霜/岩浆石/confetti 全在其后,曾绕过 hurt 门
    // 照施加,评审 C 定谳 2026-09-02 补）
    // ★清偿刀 U2（2026-10-01,§B）：ZappingJellyfish{63,64,103,242} 与 dontTakeDamage
    // 并列豁免（proj1457/Arrow/WhipProj 同款）——充能水母放行到下方水母块做接触反噬
    // 判定;非水母 dontTakeDamage 靶照旧整跳。
    const jellyVid = (ent as unknown as { vanillaId?: number }).vanillaId;
    const zapJelly = jellyVid !== undefined && jellyVid > 0 && ZAPPING_JELLYFISH.has(jellyVid);
    const jellyDontTake = (ent as unknown as { dontTakeDamage?: boolean }).dontTakeDamage === true;
    if (jellyDontTake && !zapJelly) continue;
    if (!playerCanHitEnemy(ent, game, self.projId ?? 0)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
    const e = ent as unknown as { x: number; y: number; w: number; h: number; id: number; dead: boolean; hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean; def?: { hitSound?: string[] }; reflectsProjectiles?: boolean };
    if (e.dead) continue;
    const bodyHit = self.x < e.x + e.w && self.x + self.w > e.x && self.y < e.y + e.h && self.y + self.h > e.y;
    const extHit = !bodyHit && extRects.some((r) =>
      r.x < e.x + e.w && r.x + r.w > e.x && r.y < e.y + e.h && r.y + r.h > e.y);
    if (!bodyHit && !extHit) continue;
    // 反射源命中（Projectile.cs:12781-12791——★BJ665 勘正 1456 伪锚 :12050-12060）：按 projId 查 CanBeReflected 白名单——
    // 回旋镖 aiStyle3/长矛 19/161/悠悠球 99/15 均不在表内不反射，白名单内新弹型自动生效
    if (me.projId !== undefined && tryReflectProjectile(me, me.projId, e, game)) return;
    if (playerImmune) {
      // 玩家级共享免疫门（:12603/:12635-12637 npc.immune[owner]==0 前置;本仓 = Enemy.iframes,
      // hurt 落地置 10t）——替代逐弹 hitCd 私账（mock 敌无 iframes 字段 = 恒放行）
      if (((e as { iframes?: number }).iframes ?? 0) > 0) continue;
    } else if (!hitCd.peek(e.id)) continue;
    // ★清偿刀 U2（2026-10-01,§B）水母块（Damage_PVE_Inner :12680-12689 1:1;S2-债2
    //  Arrow/WhipProj/proj1457 形态复用）：充能态（dontTakeDamage）水母不受伤——接触族
    //  （aiStyle 19/161/75/140 || AllowsContactDamageFromJellyfish{972,982,984,997,1043};
    //  IsAWhip 面由 WhipProj 自环承载不入本环）→ TakeDamageFromJellyfish 电玩家（1.3×,
    //  Game.takeDamageFromJellyfish 单源;限频=玩家 Hurt 免疫,原版 Player.cs:44607 同构）
    //  → :12686 `if (dontTakeDamage) return` 拦本次伤害（写梯 :14031-14183/proc :13877
    //  /numHits++ :14263 全不达=零落账）。门位=免疫窗后、命中面前（原版 :12635→:12677
    //  Colliding→:12680 序;本环 Colliding 等价=bodyHit/extHit 已在上）。hitCd 写面拆相：
    //  peek 在上（外环 flag2 读 :12595 无副作用）、ready 补在块后（:14036 写梯位）——
    //  充能拍零白写（旧档 ready 融合写=解冻后 cooldown 内漏命中,S2-债2 判别面同病）。
    if (zapJelly && jellyDontTake) {
      if (jellyZapProjectile(self.projId ?? 0, projectileData(self.projId ?? 0)?.aiStyle)) {
        game.takeDamageFromJellyfish?.(ent);
      }
      continue;
    }
    if (!playerImmune) hitCd.ready(e.id, cooldown);   //（:14036 局部免疫表写面=受理拍落账）
    // ★BJ388 件1（BJ385 登记债清偿,2026-09-28）受理位定谳：原版 Damage_PVE_Inner 的
    //   全部命中段——特例链 :13056-13134/aiStyle99 链 :13290-13330/555·546 里程碑
    //   :13424-13436/StatusNPC :13637/676 反射 :13721-13725/悠悠球 per-hit 族
    //   :13752-13870/免疫写链 :14031-14182/penetrate-- :14189-14196——全部在免疫门
    //   :12634-12637（+外层 localNPCImmunity 门 :12596）之后 = 严格受理位,门拒整段静默。
    //   ★BJ393 件2 勘正（hurt 返假全路径亲读+实机探针复核,三分非两分）：hurt() 布尔
    //   返真 =「本拍击杀/假人」（Enemy.ts:15033/:14184）——返假三族：①头部三早退
    //   （dead :13971/iframes :13972/dontTakeDamage :13978）=门拒等价;②血尽级联转换
    //   （realLifeHost 段 :14369/月总 :14377/猪鲨泡 :14383/石巨人头 :14393/四塔
    //   :14398——伤害已实扣,原版 StrikeNPC 照跑=受理）;③普通未致命命中尾档
    //   Enemy.ts:15037（BJ388 二分漏掉的支配族——vid15 hp150→144 实扣返 false,
    //   旧 acceptedHere 谓词恒假）非门拒。②③原版均受理（proc/penetrate--/numHits++
    //   无死亡·active 复查,flag10 锚 num41>0）。本环可及面：dead/dontTakeDamage 已被
    //   上方 :352/:355 前置 continue,hurtPierce==1 = flag3（:12634）免疫门豁免 →
    //   门拒可及面仅 iframes>0（pierce!=1）。受理面谓词 = !vanillaGated（非门拒即
    //   受理）——onHit/dirOverride 持久副面/676 反射/applyProjStatus/onAccepted
    //   （★BJ393 判据改,BJ382「hurt 返真」契约退役=其与原版受理面的差单已落）
    //   统一在此平面求值。
    const vanillaGated = hurtPierce !== 1 && (((e as { iframes?: number }).iframes ?? 0) > 0);
    // 暴击 = GetWeaponCrit 语义:4 基础 + 武器 item.crit + 装备/buff（Game 侧合并传入；
    // 此前全族写死 4%——Sunfury 原版 crit=7 应为 11%）。
    // ★α-H1/A3①：缺省阈值改按 projClass 投影（Projectile.Damage :12898-12912 三连掷
    // 只列 melee/ranged/magic 三类各对 owner 侧统计；**无类弹与 summon 不掷**——此前
    // `?? 0.04` 把 4% 兜给了所有无类弹=登记偏差）。发射端显式注入仍最优先。
    // ★BJ488③（2026-10-04）兜底支补 :25712-25714 持械折入（BJ486③ 定谳口径——原版每帧
    // `meleeCrit/magicCrit/rangedCrit += inventory[selectedItem].crit` 三系无条件链入,
    // 弹面掷阈值含持械 item.crit+词缀 crt;命中拍动态读 heldItem 现值=逐帧链同相）。
    // heldItemCritBonus 单源=rollVanillaHitCrit 同款算式（proj1457 BJ488③④ 注）;
    // 桩面 player 无 inv/critChance 时 heldItem 可选链+空持返 0=阈值与旧档同值。
    const heldBonus = heldItemCritBonus((pl as unknown as
      { inv?: { heldItem?: () => { id: number; prefix?: number } | null } }).inv?.heldItem?.() ?? null);
    const autoCritPct = me.critChance !== undefined ? undefined
      : cls === 'melee' ? (4 + playerPct('melee') + heldBonus) / 100
        : cls === 'ranged' ? (4 + playerPct('ranged') + heldBonus) / 100
          : cls === 'magic' ? (4 + playerPct('magic') + heldBonus) / 100
            : 0;
    // ★F11（2026-08-31 蓝队三批）：TryConsumingTimerCrit（Damage_PVE :12928——
    //   蓄能暴击 6170 对一切玩家弹结算的强制 crit 面，食 target Hitbox）。
    // ★BJ489 def-3（2026-10-04）注入支掷率迁移：spawn 拍冻结载体（X.critChance=
    //   critTotal,:18542 GetWeaponCrit 三件=基4+owner 聚合+持械 item.crit/词缀 crt）
    //   退役 → 掷率=rollVanillaHitCrit（:12915-12927 owner 装配 + :25712-25714 持械
    //   折入,命中拍动态;projId 类旗定谳=vanilla SetDefaults 数据面）;critChance≤0
    //   关断钉保留（r1/s2/bj420/bj388/bj393 测试置 0 习语,旧掷式 ≤0 恒假同相）。
    //   无注入载体（undefined）走 autoCritPct 动态投影（α-H1/BJ488③ 口径,零漂移）。
    // ★BJ493④（2026-10-04）掷中照消费（BJ475③ F11 拆形接入,proj1457 dealContacts
    //   :512 同形）：原版序=三类掷(:12915-27)→TryConsumingTimerCrit(:12928)【无条件】
    //   消费——前掷已 crit 照吃（charge>0 置 −15 :28568-71）。旧 `roll || consume`
    //   短路=掷中拍跳过消费,charge 残留满蓄（掷中照消费判别=tests/bj493 §4a）。
    //   分立求值后 ||；tryConsumingTimerCrit 内含 20×尘 RNG,消费拍 RNG 流变化=
    //   原版 TryConsumingTimerCrit 尘掷同相。
    const rollCrit = (me.critChance !== undefined
      ? me.critChance > 0 && rollVanillaHitCrit(me.projId ?? 0, game)
      : Math.random() < (autoCritPct ?? 0));
    const timerCritF11 = ((game.player as unknown as { tryConsumingTimerCrit?: (g: unknown, x: number, y: number, w: number, h: number) => boolean } | null)?.tryConsumingTimerCrit?.(game, e.x, e.y, e.w, e.h) ?? false);
    const crit = rollCrit || timerCritF11;
    // ★W01（BJ723-B 2026-10-26）：DamageVar 首掷（Damage_PVE_Inner :12970,逐靶掷
    //  ——Inner 为逐 victim 结算;owner luck 正向=Projectile.cs:12970
    //  `Main.DamageVar(num15, Main.player[owner].luck)`）。原版序=crit 掷(:12915-27)
    //  →TimerCrit(:12928)→DV(:12970)→型号段(:13088+)/banner(:13388)——回旋镖/长矛/
    //  链锤/悠悠球四消费族(1221/2015/3134/3724)此前恒平值(±15% 档整缺,与 BJ716-A
    //  已修的 Arrow 主环同病)。桩面 player 无 luck=??0 零掷差;RNG 位次=掷后即 DV
    //  =原版同序(型号段/banner/snap 全零掷)。
    const dmgVarW01 = damageVarRoll(self.damage,
      ((game.player as unknown as { luck?: number } | null)?.luck) ?? 0);
    // ★α-H3③④（A3 弹幕侧消费面）：parryDamageBuff ×5 与 Nano ×1.05——原位
    // Projectile.cs:13631-36（门 melee && !DontApplyParryDamageBuff[type]，apply 在
    // DamageVar 之后、StrikeNPC 前逐敌生效）/:13688-96（门 melee||IsAWhip——nano 乘
    // dmg、confetti NewProjectile(289)。此前仅玩家侧已有=R2-07(b)，弹幕侧漏接）。
    const meleeGateHere = cls === 'melee' || IS_A_WHIP_PROJS.has(self.projId ?? 0);   // :13688 门
    let mul = 1;
    if (pl.parryDamageBuff === true && cls === 'melee'
      && !DONT_APPLY_PARRY_DAMAGE_BUFF_PROJS.has(self.projId ?? 0)) {
      mul *= 5;
      pl.parryDamageBuff = false;                       // parryDamageBuff=false（:13633）
      pl.parryDamageBuffT = 0;                          // ClearBuff(198)（倒计时承载清零）
    }
    if (meleeGateHere && imbuNano) mul *= 1.05;   // GetNanoFlaskDamageBoost()=1.05f（Player.cs:44790-44792）
    // (int) 截断 + 命中乘区。★BJ388 件2（BJ344 债清偿,2026-09-28）：dmgScale 改约
    //   【DV 后逐段先截后乘】——原版 dmg 在 :12970 DamageVar 已是 int,型号段乘完
    //   再各自 (int)（383 宽盒 ×0.6 :13088-13089/悠悠球无视线 ×0.75 :13318/555·546
    //   里程碑 ×2 :13428-13437,段序在 parry :13627/nano :13688 之前）;旧单截式
    //   trunc(base×scale×mul) 与 trunc(trunc(base×mul)×scale) 段间进位面 ±1 微差
    //   （例 base×mul=13、scale=0.6：新 trunc(trunc(13.65)×0.6)=trunc(13×0.6)=7,
    //   旧 trunc(13×0.63)=8）。crit×2 = 精确整数倍乘不涉截断位;dmgScale 未传时
    //   与旧式逐位同值（零漂移）。
    //   ★S02（BJ723-B 2026-10-26）：crit ×2 摘除——原版单布尔单翻倍在
    //   StrikeNPC_Inner 防后（NPC.cs:82067,Enemy.hurt 承载）,调用侧传未翻倍
    //   DV 值（dmgVarW01）+crit 参。
    const dmgBase = Math.trunc(dmgVarW01 * mul);
    // ★刀4-A(2026-10-13):玩家弹幕命中 NPC 伤害修正链(ModifyHitNPCWithProj 形;倍率连乘;
    //  位=dmgScale 段后/banner(内联于 hurt 首参)前=弹侧 ModifyHit 统一位;空 mod=恒等)。
    //  ★红队复查修正:按 !vanillaGated 受理位求值(对齐 onHit 族 BJ393 判据——门拒靶
    //  (iframes>0,hurt 内部拒)不发钩,防 mod 侧副作用误发)
    const dmgScaled = dmgScale ? dmgScale(e, dmgBase) : dmgBase;
    const dmg = vanillaGated ? dmgScaled : runModModifyHitNpcByProj(pl, game, self.projId ?? -1,
      (e as unknown as { vanillaId?: number }).vanillaId ?? -1, dmgScaled, crit);
    // ★BJ339：num40 = direction 缺省语义（:13652）——dirOverride 在传时强占
    //（404 球侧 direction 每拍重写 :30742-30751;未传弹保持敌相对弹位既有承载）
    // ★BJ344：回调档逐敌求值 = 原版写位在 Damage_PVE_Inner 逐敌段（:13056-13098/
    //  :13667-13678 先于 num40 读出）的同构承载
    // ★BJ388 件1：dirOverride 函数档含持久副面（902 direction 翻转 :13124-13130 受理位）
    //   ——门拒拍不求值（kdir 亦无消费面,hurt 同条件必拒 :13970）
    const kdir = vanillaGated ? 0
      : (typeof dirOverride === 'function' ? dirOverride(e) : dirOverride)
        ?? (Math.sign((e.x + e.w / 2) - (self.x + self.w / 2)) || dirX);
    // ★α-H6/A5 弹幕侧：浸剂/debuff 施加搬前到【StrikeNPC 前】（原版 StatusNPC(victimIndex)
    // :13640 → armorPen add :13686 → nano :13688 → StrikeNPC :13716。ichor 池反例与
    // 挥砍侧同一案，见 Game.ts 敌怪循环 A5 注）。
    if (meleeGateHere) {
      applyMeleeImbue(pl.buffs, e as unknown as Record<string, number>,
        () => game.spawnParticles(e.x + e.w / 2, e.y + e.h / 2,
          ['#FF6090', '#60FF90', '#6090FF', '#FFD040'][Math.floor(Math.random() * 4)], 6, 2.4, { life: 40, damp: 0.96 }));
      // 冰霜盔甲引擎(melee 门,:93712)
      applyFrostBurn(pl.equipStats.frostBurn, e as unknown as Record<string, number>);
      // 岩浆石/火焰护手（melee 门,:10866 1/7 → OnFire3 6s）
      applyMagmaStoneProj(pl.equipStats.magmaStone, e as unknown as Record<string, number>);
      // ★α-H3④ confetti 真弹 289（vanilla 就在 nano 同支、StrikeNPC 前——
      // Projectile.cs:13693-96 NewProjectile(GetProjectileSource_FromThis(), targetNPC
      // .Center.X/.Y, targetNPC.velocity.X/.Y, 289)）——弹幕侧独占位，无双发风险。
      // 289 实体 = meleeOnHitProjs.ConfettiBurstProj（挥砍侧同款）
      if (imbuParty) {
        // ★Z-F4：netSync——NewProjectile 内联 SendData(27) 语义（短命弹即时上线）
        game.spawnFriendlyProj?.(new ConfettiBurstProj(
          (e as unknown as { cx?: number }).cx ?? e.x + e.w / 2,
          (e as unknown as { cy?: number }).cy ?? e.y + e.h / 2,
          (e as unknown as { vx?: number }).vx ?? 0,
          (e as unknown as { vy?: number }).vy ?? 0), { netSync: true });
      }
    }
    // ★焰爆石 kind1+拍击石 kind0 弹幕侧（Projectile.cs:13439-13446 双支同序；F3/F1
    //  收编升级,2026-08-31 蓝队四轮）：回旋镖/长矛/悠悠球/飞刀等投射在 Damage() 的
    // 结算位。门+触发走 projectileSnapStrikeBonus 单源（pyroclastProjectileGate /
    // snappingStoneProjectileGate 类位单源;360t 共用冷却去重）; F2 = FindTargetWith
    // LineOfSight 原文扫描面；返回 num14 加伤【不吃攻端旗乘区】、随暴击并入实伤参
    // （banner 采样在 :13387 先于加伤 :14457 ⇒ 加伤不进 applyBannerDamageDealt 面）。
    const snapBonusHitEnemies = projectileSnapStrikeBonus(game, self,
      (e as { cx?: number }).cx ?? e.x + e.w / 2, (e as { cy?: number }).cy ?? e.y + e.h / 2,
      e.id, { victimBox: { w: e.w, h: e.h, cx: (e as { cx?: number }).cx ?? e.x + e.w / 2,
        cy: (e as { cy?: number }).cy ?? e.y + e.h / 2 } });
    // （结构锚 tests/blue-batch3-combat-parity「F1 弹侧旗乘区」钉本站 hurt 首参字面——
    //   加伤并入写成同行表达式,勿再折行拆散 applyBannerDamageDealt 前缀）
    // ★BJ339：pierce 位 = hurtPierce（0 缺省档写敌免疫 10t / 1 flag3 单发不写窗——
    //  :14176-14182 `penetrate != 1` 分支的门,405 泡泡=1）
    //  ★BJ393 件2（2026-09-28 级联差定谳后落刀）：hurt 布尔返真 =「本拍击杀」（死亡管线
    //   跑完 Enemy.ts:15033/假人 488 :14184）非「受理」——返假三族：①头部门拒（dead
    //   :13971/iframes :13972/dontTakeDamage :13978）②血尽级联转换（realLifeHost 段
    //   :14369/月总 :14377/猪鲨泡 :14383/石巨人头 :14393/四塔 :14398）③【普通未致命命中
    //   尾档 :15037】（BJ388 二分漏掉的支配族——实机探针:vid15 hp150→144 实扣返 false）。
    //   ②③原版均=受理（StrikeNPC :13702 照跑,proc/penetrate--/numHits++ :13875-13880/
    //   :14189-14196/:14263 无死亡·active 复查,flag10 锚 num41>0=伤害已实扣）。
    //   故受理面谓词 = !vanillaGated（非门拒即受理）;hurt 返值不再消费（回调判据唯一化）。
    e.hurt(applyBannerDamageDealt(game, e, dmg) + (snapBonusHitEnemies ? snapBonusHitEnemies : 0), kdir * self.knockback * kbScale, 0, game, pen, crit, hurtPierce, true); // 裸 kb（0.65 自造已摘;★BJ344 ×kbScale=num5 相位/宽盒缩放;★S02 crit ×2=Enemy.hurt 防后,snap 加伤随整体吃防后 ×2）——hurt 内原版管线;音/飘值=单点
    // ★SW-BJ62 微光史莱姆 676 命中后反射（Damage_PVE_Inner :13721-13725——StrikeNPC
    // 后弹回玩家+penetrate++；676 不置 reflectsProjectiles 故 :320 事前支恒不触发）。
    // 本环弹型（回旋镖 3/长矛 19,161/悠悠球 99,15）全不在 CanBeReflected 白名单,
    // 天然不触发；白名单内弹型 hurt 后即刻弹回,穿透补偿由弹型 onHit 记账面承担
    // （reflected 后敌怪环整体短路=不再消耗穿透）。
    if (!vanillaGated && (e as { vanillaId?: number | null }).vanillaId === 676) {
      tryReflectShimmerSlimeHit(me as unknown as Parameters<typeof tryReflectShimmerSlimeHit>[0],
        me.projId ?? 0, e as unknown as { vanillaId?: number | null; immortal?: boolean }, game, (me as { life?: number }).life);
    }
    // ★BJ382：受理回调在 676 反射支后 / onHit 前（原版序：StrikeNPC :13712 → 反射支
    //  :13716-19 → canGhostHeal proc 段 :13875 → numHits++ :14263）
    //  ★BJ393 件2：判据 acceptedHere→!vanillaGated——原版 proc/penetrate--/numHits++
    //  全在受理面（免疫门后无死亡复查）,旧「hurt 返真」实为击杀位=普通命中/级联返假
    //  两族不 proc 不耗穿（唯一接线 239/245 雨滴实害:吸血近零+穿透数永不消耗）,见上注
    //  ★清偿刀 U2（2026-10-01）：ghostHeal proc 上收共享环受理位（meleeOnHitProjs.ts
    //  :542-560 S2 台账家族债清偿）——:13877-79 调用点在 Damage() 通用 on-hit 段【无类别
    //  白名单】,本环全调用方（回旋镖/长矛/悠悠球/连枷/破晓/水晶蛇/雨滴…）原版同走该段;
    //  旧档只 239/245 回调挂=近战族白耗面整缺。isMagic 由 ghostHealProc 数据面
    //  （projectileData(projId).magic）忠实直传——逐弹 magic 真值分流（magic 弹=治疗面,
    //  非 magic=白耗面）;!hostile/aiStyle≠59/lifeMax>5/victim 门单源内自证。
    //  numHits++（:14263）同步上收（弹字段 pveNumHits,缺则建——:14263 对 Damage() 全
    //  受理命中自增,ghostHeal 率 0.2−0.05n 衰减的计数源;Arrow 自环另有同位对）。
    //  onAccepted 语义收窄为纯 penetrate--/回收门（雨滴 dropHits++）——旧内嵌
    //  ghostHealProc+pveNumHits++ 撤除防双计。
    if (!vanillaGated) {
      const hitSelf = self as { pveNumHits?: number };
      ghostHealProc(game, self.projId ?? 0, hitSelf.pveNumHits ?? 0,
        e as unknown as Parameters<typeof ghostHealProc>[3]);
      onAccepted?.(e);
      hitSelf.pveNumHits = (hitSelf.pveNumHits ?? 0) + 1;   //（:14263 受理后自增）
    }
    // ★BJ388 件1：onHit 移入受理位（原版命中段全景在免疫门 :12634-12637 后,门拒整段
    //  静默;逐调用方定谳=回旋镖回收门/悠悠球链/配重球链/锚定鱼 23 三击门/262 族回收/
    //  481 链枷回摆/405·523 首中即亡/404 回收翻转——锚全在受理面,无一"拒收跑"同相;
    //  血尽级联返假仍受理——vanillaGated 已排除该族,见上方定谳注）
    if (!vanillaGated) onHit?.(e);
    // 命中 debuff(StatusNPC:10555——阳炎之怒 50% OnFire 300t / 粉恒星之锤 OnFire 等,按型号查表)
    // + 催化指环 6185（StatusNPC :11192-11196 `!npcProj && catalystBand` → 398 300t 任意命中;
    //   本环仅玩家弹路径可达=天然 !npcProj,同 Arrow.ts:3260 先例）
    //   ★BJ388 件1 同平面：StatusNPC(victimIndex) :13637 在免疫门后,门拒不施加
    if (!vanillaGated) {
      applyProjStatus(me.projId, e as unknown as Record<string, number>,
        { catalystBand: ((game.player as unknown as { equipStats?: { catalystBand?: boolean } } | null)?.equipStats?.catalystBand) === true });
    }
    // ★BJ340 F-B（2026-09-25）penetrate 耗尽断环：原版 Damage_PVE 环头
    // `for (i…; i < maxNPCs & keepIterating; i++)`（:12589-12603）+ 尾档
    // `penetrate-- → 0 → keepIterating=false`（:14189-14196）——穿透计数耗尽后
    // 【止于首个被命中 NPC】（耗尽受害者的本环尾段照跑,仅中断后续迭代）。
    // 单发弹（hurtPierce=1,maxPenetrate==1 如 405 泡泡）首中即耗尽 = 单拍只结算
    // 首个重叠敌；旧环对同拍全部重叠敌各结算一次=多打。置尾=耗尽受害者的
    // onHit/applyProjStatus 仍完成（405 的 hitAny 记账→killExplode 不受影响）。
    // hurtPierce=0/-2 调用方不受影响（穿透计数由逐弹 hitCd 私账/共享窗承载,零漂移）
    if (hurtPierce === 1) break;
  }
}

// ================= 回旋镖（aiStyle 3，AI_003_Boomerang，Projectile.cs:39572-40359——★BJ665 勘正 1456 伪锚 :36623-37352） =================
// 原版四段（Update 的 numUpdates 循环内【先 AI(:15434) 后移动/碰撞(:15674)】——step() 同序）：
//   ① 出程 ai[0]==0（:36783-37087）：无摩擦直线——AI 内无任何通用摩擦/减速项,
//      速度只被特例族（下垂/追踪/双门）改写;
//   ② 回收门（三处独立）：
//      命中敌 → Projectile.Damage :12278-12291（出程速度反转 + ai[0]=1;
//              豁免 301/866/902/光刃族）;
//      撞墙  → HandleMovement :18103-18161（33/106/866 分轴反弹不回收;光刃转悬停
//              ai[0]=2(:17975-17990);其余 ai[0]=1 + 速度=-lastVelocity,383 豁免取反）;
//      计数门 → per-type 见下表;
//   ③ 返回段 ai[0]==1（:37111-37288）：tileCollide=false 穿墙（:37145）;目标速度制
//      逼近（朝玩家 num28 px/t,每轴步进 num29,异号加倍 :37249-37282;383 专属
//      沿差向量加速 :37237-37247）;距玩家 >3000px Kill（301 6000,:37223-37232）;
//   ④ 回收：与玩家 AABB 相交即 Kill（:37272-37288）。
//
// ★特例族计数门/出程行为小表（ai[1] 每 AI 次自增 :36790-36793;866 计数在 localAI[0]
//   :36985/:36999;extraUpdates 型号（182/866/301,SetDefaults）按 AI 次计数,
//   折合实际 tick = 计数 ÷ (1+extraUpdates)）：
//   6/19/52/113/272/333/867/902/1000/1052 → ai[1]≥30 回收（:37082-37086）
//   106 光碟     → 同 30 回收——独立 45 门（:36794-36799）在其后的类型链尾
//                  else if(ai[1]≥30)（:37082-37087,未豁免 106）之前永不可达
//                  =1456 影子死代码,实测回收点就是 30;撞墙反弹不回收（:18142-18151）
//   320 冰回旋镖 → ai[1]≥10 起下垂 vy+0.5/vx×0.95（:36868-36886）
//   383 附魔飞刀 → 同 320（上升再+0.35）;距玩家>800 回收（:36868-36888）
//   182 圣骑士锤 → 出程态头段 rand(2)==0 d57 锤光尘(α255/s0.75/vel×0.1 后 noGravity
//                  :39906-39912)+ spriteDirection=sign(vx);追踪窗 ai[1]∈(10,360) 取
//                  800px 最近敌(CanHit 视线门),无目标且 ≥30 回收(:36889-36973 对位
//                  1456 行号;目标速度 12/轴步进 0.25)
//   866 飞刀     → localAI[0] 同窗(FindTargetWithLineOfSight 缺省 800);无目标 ≥30 回收;
//                  尾段(全状态) rand(2)==0 d212 尘 vel×0.1 noGravity(:40277-40284)
//   301 弹跳盾   → 掷出呼啸在出程(ai[0]==0)全程静默——回程才每 soundDelay=10×(extra+1)
//                  一声 Item_7 且 -0.33f 变调(:39578-39595,-1000=展示偶人语态);
//                  出程 = scale=1.75/tick + ai[1]==1 帧定角 -π/4-π/2、==20 帧 Item_1、
//                  <30 绕手悬停(rotation+=dir×π/30 且 Center 钉 MountedCenter−velocity)、
//                  否则 atan2(v)+π/4,≥60 转回收速度归零(:451-477 提取件行锚;★1456 为
//                  "按住≥20/松手≥100 双门"旧式,1457 起改此式,本仓随 1457/1458 真值);
//                  尾段出程态另有 d57/d43 旋喷尘团(:40710-40764 区段)
//   光刃族 19 型 → ai[1]≥30 起垂落 vy+1/vx×0.96（:36800-36832）;撞墙转悬停 ai[0]=2
//                  （vy<0 减半/rotation=2.335/vx=0/vy+1,:37089-37109）

/** 返回段型号参数表（:37146-37206）：[num28 目标速率, num29 轴步进加速度]。
 *  未列型号 = 缺省 9/0.4（:37146-37147）;光刃族整族 40/3（:37148-37151） */
const BOOMERANG_RETURN: Record<number, [number, number]> = {
  19: [20, 1.5], 33: [18, 1.2], 106: [16, 1.2], 182: [16, 1.2],
  272: [20, 1.5], 866: [16, 1.2], 333: [12, 0.6], 301: [15, 3],
  320: [15, 3], 383: [16, 4], 1000: [9.5, 0.4],
};

/** Phaseblade 族（ProjectileID.cs:33 IsAPhaseblade,19 型——★BJ665 勘正 1456 伪锚 :27）：
 *  出程 30t 后垂落;返回 40/3 高速穿墙归位 + extraUpdates 随距离增长（:37211-37221）。
 *  exported：Game 发射侧接线再掷召回门（recallGate）/回归测试共面 */
export const PHASEBLADE_PROJ = new Set([1059, 1060, 1061, 1062, 1063, 1064, 1065, 1066, 1067,
  1068, 1069, 1070, 1071, 1072, 1074, 1075, 1076, 1101, 1102]);

/** 使用起点【同型在场门】（ItemCheck_CheckCanUse_Inner,Player.cs:52801-52856）：弹型在
 *  列表内时,同 owner 已存在同型 active 弹 ⇒ 该物品本次使用被【静默拒绝】——原版
 *  ItemCheck_TryStartUse 失败即不进 StartActualUse：无挥动动画/无 UseSound/不耗
 *  itemTime（"必须回到手中才能再掷"的本体实现）。单发组 {6,19,33,52,113,320,333,
 *  383,491,867,1052,902,866}∪IsAPhaseblade∪{301} 恒 1;光碟 106 上限 6、272 上限 10、
 *  无头回旋镖 1000 上限 3。未列表型号不限。exported：Game 发射侧调用 */
export const BOOMERANG_OWN_LIMIT: Record<number, number> = {};
for (const id of [6, 19, 33, 52, 113, 320, 333, 383, 491, 867, 1052, 902, 866]) BOOMERANG_OWN_LIMIT[id] = 1;
for (const id of PHASEBLADE_PROJ) BOOMERANG_OWN_LIMIT[id] = 1;
BOOMERANG_OWN_LIMIT[301] = 1;
BOOMERANG_OWN_LIMIT[106] = 6;
BOOMERANG_OWN_LIMIT[272] = 10;
BOOMERANG_OWN_LIMIT[1000] = 3;

/** 发射侧同型在场判定（boomerangBlockedByOwned）：与原版扫描同口径——只数本机弹
 *  （netPuppet 为远端傀儡,非 owner==whoAmI 域）;dead 未及清桶的剔除。
 *  projectiles = entities.projectiles 桶（unknown 收口,instanceof 缩窄同 anchoredActive） */
export function boomerangBlockedByOwned(projectiles: readonly unknown[], shoot: number): boolean {
  const lim = BOOMERANG_OWN_LIMIT[shoot];
  if (lim === undefined) return false;
  let n = 0;
  for (const e of projectiles) {
    if (!(e instanceof Boomerang) || e.dead || e.netPuppet || e.projId !== shoot) continue;
    if (++n >= lim) return true;
  }
  return false;
}

/** 撞墙反弹族（:18142-18151）：33 荆棘轮/106 光碟/866 飞刀——撞墙不回收,
 *  命中轴速度取反（lastVelocity 语义）续飞 */
const WALL_BOUNCE_PROJ = new Set([33, 106, 866]);

/** 命中敌不触回收的型号（Damage :12278 豁免列;902 另走"返回段命中 direction 翻转"
 *  :12292-12297,301/383 命中时 direction 朝敌改写 :12249-12263） */
const NO_HIT_RETURN_PROJ = new Set([301, 866, 902]);

/** 出程头段逐型真值尘（1458 AI_003_Boomerang 头段 :39599-39702;1456 同段 :36652-36738。
 *  台账 C 批清偿：原 BOOMERANG_DUST 手调色值近似退役——真值 = 粒型/alpha/scale/
 *  noGravity/vel 系数逐参。★未列型号勘误：182 的 d57 光尘居【出程分支内】(:39906-39912,
 *  aiOut 处直挂)、383 无尘、866 的 d212 居【尾段全状态】(aiVisual 处直挂)——头段确实
 *  只有下表七型（终清波复核）。
 *  ctx.v = 弹速向量。spawnDust 宿主缺省 = null 静默跳过（测试 mock 兼容）。 */
type BoomerangDustCtx = { projId: number; x: number; y: number; w: number; h: number; vx: number; vy: number };
const BOOMERANG_DUST_TRUTH: Record<number, (s: BoomerangDustCtx, game: GameHooks) => void> = {
  // 19 荆棘轮回旋镖（:39623-39632）：恒发 2× d6,vel×0.2 后 XY 再 ×0.3,noGravity,scale2
  19: (s, game) => {
    for (let i = 0; i < 2; i++) {
      const d = game.spawnDust?.(s.x, s.y, s.w, s.h, 6, s.vx * 0.2, s.vy * 0.2, 100, null, 2);
      if (d) { d.noGravity = true; d.vx *= 0.3; d.vy *= 0.3; }
    }
  },
  // 1000 无头回旋镖（:39633-39657）：rand3==0 → 三分档——default 档再 rand3 选
  // {15/57/58} vel×0.25 alpha150 scale0.7 后 ×0.5 / d267(色50,50,200,alpha50,scale1.1,
  // fadeIn0.1,v×0.5,noGravity) / d76(v×0.15,noGravity,scale1.1)+d15(v×0.05,alpha150,scale0.6)
  1000: (s, game) => {
    if (Math.floor(Math.random() * 3) !== 0) return;
    const r = Math.floor(Math.random() * 3);
    if (r === 0) {
      const rr = Math.floor(Math.random() * 3);
      const type = rr === 1 ? 57 : rr === 2 ? 58 : 15;
      const d = game.spawnDust?.(s.x, s.y, s.w, s.h, type, s.vx * 0.25, s.vy * 0.25, 150, null, 0.7);
      if (d) { d.vx *= 0.5; d.vy *= 0.5; }
    } else if (r === 1) {
      const d = game.spawnDust?.(s.x, s.y, s.w, s.h, 267, s.vx, s.vy, 50,
        { r: 50, g: 50, b: 200, a: 255 }, 1.1);
      if (d) { d.fadeIn = 0.1; d.vx = s.vx * 0.5; d.vy = s.vy * 0.5; d.noGravity = true; }
    } else {
      const d = game.spawnDust?.(s.x, s.y, s.w, s.h, 76, s.vx * 0.15, s.vy * 0.15, 0, null, 1.1);
      if (d) d.noGravity = true;
      game.spawnDust?.(s.x, s.y, s.w, s.h, 15, s.vx * 0.05, s.vy * 0.05, 150, null, 0.6);
    }
  },
  // 867 鲜血之杯（:39658-39665）：rand3==0 → d165（velocity 原样,alpha50,scale 缺省1）
  // 后 ×0.5,noGravity
  867: (s, game) => {
    if (Math.floor(Math.random() * 3) !== 0) return;
    const d = game.spawnDust?.(s.x, s.y, s.w, s.h, 165, s.vx, s.vy, 50);
    if (d) { d.vx *= 0.5; d.vy *= 0.5; d.noGravity = true; }
  },
  // 33 荆棘轮（:39666-39671）：rand.Next(1)==0 恒发 → d40,vel×0.25,scale1.4,noGravity
  33: (s, game) => {
    const d = game.spawnDust?.(s.x, s.y, s.w, s.h, 40, s.vx * 0.25, s.vy * 0.25, 0, null, 1.4);
    if (d) d.noGravity = true;
  },
  // 320 冰霜回旋镖（:39672-39687）：rand3==0 → d5 vel×0.25 scale1.1;
  // 再 rand2==0 → scale=0.9+vel×0.2，否则 noGravity
  320: (s, game) => {
    if (Math.floor(Math.random() * 3) !== 0) return;
    const d = game.spawnDust?.(s.x, s.y, s.w, s.h, 5, s.vx * 0.25, s.vy * 0.25, 0, null, 1.1);
    if (!d) return;
    if (Math.floor(Math.random() * 2) === 0) { d.scale = 0.9; d.vx *= 0.2; d.vy *= 0.2; }
    else d.noGravity = true;
  },
  // 6 木回旋镖（:39688-39695）：rand5==0 → rand3 选 {15/57/_:58},vel×0.25,alpha150,scale0.7
  6: (s, game) => {
    if (Math.floor(Math.random() * 5) !== 0) return;
    const r = Math.floor(Math.random() * 3);
    game.spawnDust?.(s.x, s.y, s.w, s.h, r === 0 ? 15 : r === 1 ? 57 : 58,
      s.vx * 0.25, s.vy * 0.25, 150, null, 0.7);
  },
  // 113 血腥回旋镖（:39696-39701）：Next(1)==0 恒发 → d76(v×0.15,noGravity,scale1.1)
  // + d15(v×0.05,alpha150,scale0.6)
  113: (s, game) => {
    const d = game.spawnDust?.(s.x, s.y, s.w, s.h, 76, s.vx * 0.15, s.vy * 0.15, 0, null, 1.1);
    if (d) d.noGravity = true;
    game.spawnDust?.(s.x, s.y, s.w, s.h, 15, s.vx * 0.05, s.vy * 0.05, 150, null, 0.6);
  },
};

/** melee 投掷初速（ItemCheck_Shoot :47466-47468）：`speed /= meleeSpeed`——
 *  原版此处 meleeSpeed 字段已是 CapAttackSpeeds 倒数档 M（Player.cs:26176 每拍
 *  Update 先翻转,:28495 ItemCheck 在后）,正加成 → M<1 → 速度/=M=×攻速和变快。
 *  本仓 attackSpeedMult = M（Player.ts:3762 CapAttackSpeeds 镜像）——
 *  ★BJ640（2026-10-11）：旧式 ×M = 方向反（+70% 回旋镖初速 ×0.588 变慢）,改 ÷M
 *  （与 Game.ts :16151 天降星/星怒等已正确的 ÷M 面同向）。NoMeleeSpeedVelocityScaling
 *  排除表 {699,707,877-879,985,973}（ProjectileID.cs:429 NoMeleeSpeedVelocityScaling——★BJ665 勘正 1456 伪锚 :337）的弹型不缩放,调用方自查 */
export function meleeThrowSpeed(shootSpeed: number, attackSpeedMult: number): number {
  return shootSpeed / (attackSpeedMult || 1);
}

/** 挥掷系 shoot 出生落点核（ItemCheck_Shoot 通用尾支）：pointPosition =
 *  RotatedRelativePoint(MountedCenter)（1457 Player.cs:47605——★BJ665 勘正 伪锚 :47588;无旋转/坐骑/睡坐
 *  = 玩家中心）→ NewProjectile 盒心落点（Projectile.cs:10878-10879
 *  落点（Projectile.cs:10878-10879）。链锤/悠悠球绝大多数无 per-weapon 出生偏移
 *  （2026-08-23 备案；★2026-09-02 纠错:唯二例外 = 2611 Flairon/5526 FlaironFlail 出生前移 +1px 沿瞄准向（1457 Player.cs:47648-47657/1456 :46603-46612），当年审计只查 Projectile.cs 侧漏了 Player.cs，经 flaironSpawnNudge 接线）
 *  Player.cs/Projectile.cs 核对均无此式,2026-08-23）。e = 已构造弹体（读其
 *  SetDefaults 盒宽高）,(cx,cy) = 玩家中心;原地写回盒左上并返回。 */
export function placeAtShootSpawn<T extends { x: number; y: number; w: number; h: number }>(
  e: T, cx: number, cy: number): T {
  e.x = cx - e.w / 2;
  e.y = cy - e.h / 2;
  return e;
}

/** 猪龙鱼链球族出生前移受惠件（1457 Player.cs:47648-47657；1456 :46603-46612 同文）。
 *  仅 2611 Flairon / 5526 FlaironFlail 两件在册；其余链锤（25/26/35/63/154/247/757/
 *  947/948）与悠悠球均无 per-weapon 出生偏移。 */
export const FLAIRON_NUDGE_VIDS = new Set([2611, 5526]);

/** 2611/5526 出生前移支（1457 Player.cs:47648-47657 1:1）：
 *  pointPosition += normalize(MouseWorld − pointPosition) = 沿瞄准单位向 **+1px**
 *  （非 1 格 16px；:47619-47622 vector 已归一，:47653 重归一为防御性重复）。
 *  零向量（鼠标=中心）不偏移（:47651 `!= Vector2.Zero` 门字面）。
 *  仅改出生点、无 return——穿透 ItemCheck_Shoot 通用尾支（速度向量 num4/num5
 *  亦自偏移后点起算 :47687-47716，故调用侧应把偏移后中心同时喂给构造与
 *  placeAtShootSpawn）。非受惠件原样返回（供 case 'flail' 单点接线）。 */
export function flaironSpawnNudge(
  vid: number, cx: number, cy: number, mx: number, my: number,
): { x: number; y: number } {
  if (!FLAIRON_NUDGE_VIDS.has(vid)) return { x: cx, y: cy };
  const dx = mx - cx, dy = my - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };      // :47651 Zero 门
  const len = Math.sqrt(dx * dx + dy * dy);               // Vector2.Normalize = x/length
  return { x: cx + dx / len, y: cy + dy / len };          // += 单位向量 = +1px
}

/** 回旋镖命中盒型号表（SetDefaults aiStyle=3 全 36 型提取：type→size;
 *  光刃族 1065-1070/1072/1074/1076/1102=46,其余 38）。
 *  exported：湿段豁免审计（tests/proj-wet-boomerang-yoyo）以本表键集=域 id 全集 */
export const BOOMERANG_SIZE: Record<number, number> = {
  6: 22, 19: 22, 33: 38, 52: 22, 106: 32, 113: 22, 182: 30, 272: 32,
  301: 38, 320: 34, 333: 38, 383: 34, 866: 30, 867: 22, 902: 20, 1000: 22,
  1052: 22, 1074: 46,
  1059: 38, 1060: 38, 1061: 38, 1062: 38, 1063: 38, 1064: 38, 1071: 38,
  1075: 38, 1101: 38,
  1065: 46, 1066: 46, 1067: 46, 1068: 46, 1069: 46, 1070: 46, 1072: 46,
  1076: 46, 1102: 46,
};

/** Main.hslToRgb 等价（Color.cs 标准 HSL→RGB,h∈[0,1) s/l∈[0,1]）——
 *  FlaironSpike Kill 尘 212 的逐粒色相掷（P.cs:74202） */
function hslToRgbColor(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const chan = (t0: number): number => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: chan(h + 1 / 3) * 255, g: chan(h) * 255, b: chan(h - 1 / 3) * 255 };
}

/** Collision.HitTilesInACircle（1458 Collision.cs:3029-3086,1457 同段同值——终清波几何
 *  1:1 化）：Position=方盒左上(px)、Velocity=单次偏移向量、Width/Height=盒边长 boxSize。
 *  vector = Position+Velocity;扫窗 [X/16−1 .. (X+W)/16+2)×[Y/16−1 ..) 开区间,
 *  下界钳 0、x 上界钳 maxTilesX、y 上界钳 maxTilesY−40;候选格矩阵 = nactive &&
 *  (tileSolid ∨ tileSolidTop&&frameY==0)——本仓以 isActive/isSolid 承载,其中
 *  solidTop∧frameY==0 家具族与【逐格块色尘】同属 WorldGen.KillTile_MakeTileDust
 *  per-tile 尘型表系统待移植（登记面）;halfBrick → 格顶下移 8、探测高 16→8;
 *  命中盒〔vector,vector+W×H〕与格纵列相交且圆心距 <(W+H)/4 → effect-only
 *  KillTile 出块色尘。消费端：Boomerang 383 撞墙圈(Position−150 边 300)/
 *  AnchoredProj 262 回收冲击。
 *  ★合成占位：每合格格出 1 粒通用块尘 d14——无人工上限（Main.dust[6000] 池满即原版
 *  饱和门），逐格数量/粒型面随尘型表批补齐 */
function hitTilesInACircleFx(game: GameHooks, px: number, py: number, vx0: number, vy0: number, boxSize: number): void {
  const st = game.world.store;
  const vecX = px + vx0, vecY = py + vy0;                        // vector = Position + Velocity(:3034)
  let tx0 = Math.floor(px / TILE) - 1;
  let tx1 = Math.floor((px + boxSize) / TILE) + 2;
  let ty0 = Math.floor(py / TILE) - 1;
  let ty1 = Math.floor((py + boxSize) / TILE) + 2;
  if (tx0 < 0) tx0 = 0;
  if (tx1 > st.w) tx1 = st.w;                                    // Main.maxTilesX 钳(:3044)
  if (ty0 < 0) ty0 = 0;
  if (ty1 > st.h - 40) ty1 = st.h - 40;                          // maxTilesY − 40 钳(:3055)
  for (let i = tx0; i < tx1; i++) {
    for (let j = ty0; j < ty1; j++) {
      if (!st.isActive(i, j) || !st.isSolid(i, j)) continue;
      let gx = i * TILE, gy = j * TILE, gh = TILE;
      if (st.half[st.idx(i, j)] !== 0) { gy += 8; gh -= 8; }     // halfBrick(:3066-3069)
      if (vecX + boxSize >= gx && vecX <= gx + TILE && vecY + boxSize >= gy && vecY <= gy + gh
        && Math.hypot(vecX + boxSize / 2 - (gx + 8), vecY + boxSize / 2 - (gy + 8)) < (boxSize + boxSize) / 4) {
        game.spawnDust?.(i * TILE, j * TILE, TILE, TILE, 14, 0, 0, 150, null, 1);
      }
    }
  }
}

/** ParticleOrchestrator.Spawn_PaladinsHammerShockwave 粒本体已收编至
 *  fx/orchestraFx.paladinsHammerShockwaveFx（顶部 import;2026-08-31 L5 批——本地/
 *  远端 netApply 两面共用同一 rng 注入函数,Item180 音并入 Spawn_ 本体:822,C 批
 *  曾误注"调用侧已播"实缺） */

export class Boomerang extends Entity {
  w = 22; h = 22; // 默认（型号表覆盖）
  damage: number;
  knockback: number;
  projId: number;
  /** GetWeaponCrit 合并值（Game 侧传入；缺省 4 基础） */
  critChance = 0.04;
  /** ⑥ 护甲穿透（Game 注入，命中传 hurt 减防） */
  armorPen = 0;
  /** 近战系（吃武器浸剂） */
  meleeProj = true;
  /** channel 电平（★301 的"按住/松手双门"出程语义已按 1457 真值退役——原版 AI_003
   *  无 controlUseItem 门;字段保留承接 Game 发射侧既有注入接线,当前无消费面） */
  channel: (() => boolean) | null = null;
  /** 光刃再掷召回电平（Projectile.cs:39716-39720 IsAPhaseblade[HeldItem.shoot]&&controlUseItem——★BJ665 勘正 伪锚 :39717-39722；
   *  Game 发射侧仅对 PHASEBLADE_PROJ 注入——mouseHeld+手持同物品,flail channel 同管线） */
  recallGate?: () => boolean;
  /** ★ai[0]（:36783 起）：0 飞出 / 1 返回 / 2 光刃撞墙悬停（:17975-17990 置 2） */
  ai0 = 0;
  /** ★债刀-4 ②（2026-09-17）：CutTilesAt :15384-86（1458 :15386-88 同文）1052 出程
   *  加砍旗——`type==1052 && ai[0]==0` 时 flag 再并 TileID.Sets.IsATreeTrunk∪{323 棕榈}。
   *  中央 CutTiles 收口（Entity.ts）读本 getter → cutTilesBox 第 7 参 → Game.cutTile
   *  收口（vid==1052 重验）。1052=Axearang（1.4.5 新回旋斧,物品 5519,Axearang 砍树
   *  面的弹载体）;其余型号/返回段（ai0≠0）恒 false=与原版逐位同相。 */
  get cutExtraTreeCactus(): boolean { return this.projId === 1052 && this.ai0 === 0; }
  /** 探针 _weapons-family-probe 读 returning——ai[0]==1 即返回段（保留旧名兼容） */
  get returning(): boolean { return this.ai0 === 1; }
  /** direction：掷出瞬间玩家 facing（NewProjectile 语义;旋转自旋符号 :37294 起） */
  private dir: number;
  /** ai[1]：飞出段计数（866 占用为目标索引,计数走 localT） */
  private outT = 0;
  /** localAI[0]：866 目标窗计数（:36985/:36999）;1074 悬停后置 -1 供返回音选择（:37102） */
  private localT = 0;
  /** localAI[1]：光刃悬停音一次性门（:37098-37109） */
  private hoverSfxDone = false;
  /** localAI[0] 冲击盒档（:15050-15076 Damage_GetHitbox）：383 撞墙≥10 置 300 /
   *  301 撞墙置 200,下次 Damage 查询消费中心±half 一帧冲击盒后置 -1;0=无 */
  private boomBox = 0;
  /** rotation（尾段 per-type :37294-37352 + 光刃出程/悬停/返回专属段） */
  private rot = 0;
  /** 绘制 scale（301 出程态 scale=1.75/tick,Projectile.cs :40011——getRect 不乘,
   *  仅视觉;无复位点=回程保持直至消亡,原版同态。其余型号恒 1 */
  private visScale = 1;
  /** soundDelay（掷出呼啸 8t/301 10t,:36626-36651;每 tick 自减 :15427-15429） */
  private soundDelay = 0;
  /** SetDefaults penetrate（命中自减 :13175-13182;==0 Kill :15866-15868;866 特例 :13124-13137） */
  private penetrate: number;
  /** SetDefaults extraUpdates（AI 每 tick 跑 1+extra 次,Update :15336-15339 while 循环） */
  private extra: number;
  private hitCd = new HitCooldown();
  /** timeLeft 缺省 3600（SetDefaults :526,aiStyle 3 族无型号覆写——旧值 900 是自造） */
  life = 3600;
  dead = false;

  // ---- ★通用湿段（Projectile.cs:16903-17113 全体弹共用段;2026-09-04 溅花缺口清偿批,
  //  projWetSection.ts 共享体 1:1;本域 id 集 = BOOMERANG_SIZE 全 36 型 aiStyle3）----
  //  豁免核对（1457 SetDefaults :699-10676 逐块脚本化扫描,块界=2 缩进 if/else-if 链）：
  //  6(:866-875)/19(:1010-1019)/33(:1154-1163)/52(:1347-1355)/106(:1938-1947)/
  //  113(:2014-2024)/182(:2688-2698)/272(:3580-3589)/301(:3918-3929)/320(:4132-4140)/
  //  333(:4260-4269)/383(:4657-4665)/866(:8314-8326)/867(:8327-8336)/902(:8601-8610)/
  //  1000(:9493-9502)/1052(:9980-9988)/光刃族三区间块 :10008-10023((1059-1064)||1071||
  //  1075||1101)/:10024-10039((1065-1070)||1072||1076||1102)/:10049-10060(1074)——
  //  全 36 型均无 ignoreWater=true 行（缺省 false @:763）→ 全员受段;与
  //  PROJ_IGNORE_WATER（vanillaProjectiles.ts）亦零交集。四特支（34/80/155/2）与
  //  IsDestroyedByWater 六型 {85,15,188,34,1097,1106} 域内无成员（死码在共享体内照抄）。
  //  位序 = 原版 Update 逐子步:AI(:16880) → 本湿段(:16895 门,step() 内 AI 后/移动前)
  //  → HandleMovement(:17120,湿阻尼 :17721-17764 只进位移)。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112,逐 AI 子步 −1） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10887-10893 等价——首子步 AI 后同位测值。
   *  ★301 例外:悬停支（outT<30,:40029 钉 Center=玩家中心−velocity）首子步即写位,
   *  湿段首测位=钉位而非出生盒（懒预置结构债,仅影响出生即刻落液首拍溅花判定面,登记） */
  presetDone = false;   // ProjWetFlags.presetDone（共享湿段旗持有者）

  /** ★⑥杀拍推广（2026-09-06）：湿段双调用点防同拍双跑闩——活拍（step() AI 后/移动前）
   *  置位,杀拍（fixedUpdate 头 life 尽支）借 Arrow.ts 同名配方补跑。本类活拍每【子步】
   *  各跑一次（EU 型）,闩在 fixedUpdate 头逐拍复位（杀拍位先于全部子步,恒逢 false） */
  private wetSectionRan = false;

  /** 通用湿段步进（projWetSection 共享体穿参壳——活拍/杀拍两调用点共用）。
   *  ★⑧Shimmer() 接面（2026-09-07 缺面清单清偿）：本类 aiStyle 3 域不命中任何
   *  aiStyle 支（:22719 缺省支无动作）,唯【相刃族】19 型（PHASEBLADE_PROJ=
   *  ProjectileID.Sets.IsAPhaseblade,ProjectileID.cs:33）→ 相刃支（Projectile.cs:22587-22604）
   *  ——ai[0]==1（返回态）早退;否则 ai[1]=ai[0]=0（出程计数/状态复位=微光中重启
   *  出程）+ vy>-11 浮升（>16 先 ×0.9）+ vx×1.1 钳 ±14。面适配：ai0≡ai0（0 飞出/
   *  1 返回/2 悬停,本类同名字段）;ai1≡outT（飞出段计数——ai[1] 写面只此一支,
   *  回写私有字段）;hostile=false（域全 friendly）;kill/timeLeft 面零消费（相刃支
   *  无 Kill/无 timeLeft 面;域无 502/469/箭族 id——缺省不接=登记）。 */
  private wetSectionStep(game: GameHooks): void {
    this.wetSectionRan = true;
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater, {
        shimmer: (st, x, y, _w, _h) => {
          const sf: ProjShimmerFace = {
            projId: this.projId,
            aiStyle: projectileData(this.projId)?.aiStyle ?? -1,
            hostile: false,
            vx: this.vx, vy: this.vy,
            timeLeft: this.life,
            ai0: this.ai0, ai1: this.outT,
            wet: this.wet, shimmerWet: this.shimmerWet,
            rainbowSlimeUnlocked: false,
          };
          projShimmerStep(sf, st, x, y, this.cx);
          this.vx = sf.vx; this.vy = sf.vy;
          this.ai0 = sf.ai0;
          this.outT = sf.ai1;
          this.wet = sf.wet; this.shimmerWet = sf.shimmerWet;
        },
      });
  }

  constructor(x: number, y: number, vx: number, vy: number, damage: number, knockback: number,
    projId: number, dir = 1) {
    super();
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.knockback = knockback;
    this.projId = projId;
    this.dir = dir >= 0 ? 1 : -1;
    const def = projectileData(projId);
    this.penetrate = def?.penetrate ?? -1;
    this.extra = def?.extraUpdates ?? 0;
    const sz = BOOMERANG_SIZE[projId]; // ⑬-2 命中盒按型号（曾统一 22×22）
    if (sz) { this.w = sz; this.h = sz; }
  }

  draw(r: Renderer, cam: Camera): void {
    // ★BJ-C1 F2（2026-10-06,BJ529/530 同族普查收编）：19 火焰回旋镖 Flamarang——
    //  GetAlpha :81465-81468 `34||35||15||19||44||45 → Color.White` 恒满亮【不读
    //  alpha/光照色】（本仓 alpha 恒传 1=α 面本已同相;光照面=画进实体层被
    //  compositeLight 全屏乘光压暗,BJ529 探针 _bj529-skull-ab 暗腔 k=0.325 同病）。
    //  承接=BJ530 判例同构：capture→本体不进实体层,projFullbrightQueue 光照合成
    //  后 source-over 复绘=原版逐字（drawProj capture 槽=变换数学单源）。层序=
    //  玩家/NPC 之上（270/45/BJ504 同槽惯例,登记）。
    if (this.projId === 19) {
      drawProj(r, cam, this, this.projId, this.rot, '#C0A060', 1, 0, false, false, this.visScale,
        -1, 0, (fn) => {
          (r as unknown as {
            queueProjFullbright?: (fn: (c: CanvasRenderingContext2D) => void) => void;
          }).queueProjFullbright?.(fn);
        });
      return;
    }
    // ★BJ603：1101/1102 相刃 glowMask 双画（Main.cs :35498-35518）——drawProj
    //   glowMask 臂承载（源=弹幕贴图全幅/dest=本体同框/相位双画色序）
    drawProj(r, cam, this, this.projId, this.rot, '#C0A060', 1, 0, false, false, this.visScale,
      -1, 0, undefined, this.projId === 1101 || this.projId === 1102);
  }

  /** 轴向目标速度逼近（AI_003 追踪/返回共用式 :36937-36973/:37249-37282）：
   *  每轴朝目标速度步进 acc,当前速度与目标异号再加倍 */
  private steerTo(tvx: number, tvy: number, acc: number): void {
    if (this.vx < tvx) { this.vx += acc; if (this.vx < 0 && tvx > 0) this.vx += acc; }
    else if (this.vx > tvx) { this.vx -= acc; if (this.vx > 0 && tvx < 0) this.vx -= acc; }
    if (this.vy < tvy) { this.vy += acc; if (this.vy < 0 && tvy > 0) this.vy += acc; }
    else if (this.vy > tvy) { this.vy -= acc; if (this.vy > 0 && tvy < 0) this.vy -= acc; }
  }

  fixedUpdate(_dt: number, game: GameHooks) {
    // 联机傀儡（远端弹幕快照驱动）：纯位移外推，不跑命中/碰撞（伤害归拥有者客户端结算）
    if (this.netPuppet) { this.netPuppetStep(); return; }
    this.wetSectionRan = false;
    if (--this.life <= 0) {
      // ★⑥杀拍推广（2026-09-06,R3 配方=Arrow.ts wetSectionStep 双调用点+防双跑同款）：
      //  原版 timeLeft--/Kill 在子步【末尾】(:17307-17311)——寿命尽拍湿段(:16903)照跑
      //  （杀拍溅花/wetCount 维护）。本仓 life 判在 tick 头曾整体跳过湿段=杀拍溅花缺口。
      //  此位 wetSectionRan 恒 false（子步未起），守卫为防调用点位次重排双跑；Kill 幂等
      //  =本域 36 型均非 IsDestroyedByWater 六型（字段块注）且消亡走 dead 布尔（无
      //  killNow 二次杀面），湿段 kill 钩缺省不接=结构幂等。
      this.wetSectionStep(game);
      this.dead = true;
      return;
    }
    if (this.soundDelay > 0) this.soundDelay--; // :15427-15429 每 tick 一次（AI 循环外）
    this.hitCd.tick();
    // extraUpdates（Update :15336-15339）：AI+移动每 tick 跑 1+extra 次;
    // 光刃返回段动态加速 = dist/3000（+1(1074),上限 20,:37211-37221）
    let runs = this.extra + 1;
    if (PHASEBLADE_PROJ.has(this.projId) && this.ai0 === 1) {
      const p0 = game.player;
      runs = Math.min(20, Math.floor(Math.hypot(p0.cx - this.cx, p0.cy - this.cy) / 3000)
        + (this.projId === 1074 ? 1 : 0)) + 1;
    }
    for (let i = 0; i < runs && !this.dead; i++) this.step(game);
  }

  /** 单次 AI 迭代（等价原版 numUpdates 循环体一次：AI → 移动/碰撞 → 尾段 → 命中） */
  private step(game: GameHooks): void {
    const p = game.player;
    const isPhase = PHASEBLADE_PROJ.has(this.projId);
    // :16870 `Vector2 wetVelocity = velocity`（逐子步 AI 前 velocity 快照——湿态返回段
    // 位移面消费,见 moveStep 返回段;逐子步重拍 = 原版 numUpdates 循环内同位）
    const preVx = this.vx, preVy = this.vy;
    // ---- AI 段 ----
    // 掷出呼啸（1458 AI_003_Boomerang 头段 :39574-39597,1457 同段同值——终清波实装）：
    //   383/光刃族豁免。缺省族 = soundDelay 8×(extra+1)、Item_7 直播（三参无 pitch 档,
    //   SoundEngine.PlaySound(SoundID.Item7, position)）。301 = 门 ai[0]!=-1000f &&
    //   !=0f 才响(:39578,-1000 展示偶人语态常规局不可达、出程 ai[0]==0 全程静默,
    //   只有回程每 soundDelay=10×(extra+1) 一声)且带 -0.33f 变调(:39586)。
    //   ★-0.33 经 playSfxWav 第 5 参落地(Sfx 链 XNA Pitch 直传 2^pitch 变调)——
    //   此前"恒播且无变调"= 登记缺口清偿。
    if (this.projId !== 383 && !isPhase && this.soundDelay === 0) {
      if (this.projId === 301) {
        if (this.ai0 !== -1000 && this.ai0 !== 0) {
          this.soundDelay = 10 * (this.extra + 1);
          game.playSfxWav?.('Item_7', 1, this.cx, this.cy, -0.33);
        }
      } else {
        this.soundDelay = 8 * (this.extra + 1);
        game.playSfxFiles(['Item_7'], 1, this.cx, this.cy);
      }
    }
    if (isPhase) {
      // :36745-36748 中心出界（InWorld 外扩 10 格）→ 直接进返回
      const st = game.world.store;
      const tx = Math.floor(this.cx / TILE), ty = Math.floor(this.cy / TILE);
      if (tx < 10 || ty < 10 || tx >= st.w - 10 || ty >= st.h - 10) this.ai0 = 1;
      // :36750-36756 timeLeft<5 且玩家存活 → 续命 5t 并回收（悬停/垂落态的唯一出路）
      else if (this.life < 5 && !(p as { dead?: boolean }).dead) {
        this.life = 5;
        if (this.ai0 !== 1) this.ai0 = 1;
      }
      // :39717-39722 再掷召回门（1458 行号;1456 同段 :36758-36764）：
      //   IsAPhaseblade[HeldItem.shoot] && owner==myPlayer && ai[0]!=1 && 玩家存活
      //   && controlUseItem → ai0=1 提前召回。recallGate 由 Game 发射侧接线
      //   （mouseHeld=controlUseItem 电平 + 手持同物品核对——flail channel 同管线;
      //    ★登记偏差:原版按 IsAPhaseblade[HeldItem.shoot] 判,换持另一柄光刃也触发,
      //    本仓按同 itemId 绑定（存档的 itemId 字段缺省 undefined 时退化为纯电平门））
      if (this.ai0 !== 1 && !(p as { dead?: boolean }).dead
        && (this.recallGate ? this.recallGate() : false)) {
        this.ai0 = 1;
      }
    }
    if (this.ai0 === 0) this.aiOut(game, isPhase);
    else if (isPhase && this.ai0 === 2) this.aiHover(game); // 光刃撞墙悬停
    else this.aiReturn(game, isPhase);
    // ---- 通用湿段（:16903-17113;projWetSection 共享体——四液旗/出入水溅花/wetCount;
    //      位序 = 原版 Update 逐子步 AI(:16880) → 湿段(:16895) → HandleMovement(:17120),
    //      恰插本位;湿段只读 position 不读 velocity,故置于 AI 写位（301 悬停钉位）之后
    //      = 原版 post-AI 同位。域 id 全不豁免（字段块注）,ignoreWater 仍按数据面传
    //      （数据驱动防未来 id 入域））——★⑥杀拍推广抽 wetSectionStep（双调用点：
    //      活拍=本位/杀拍=fixedUpdate 头 life 尽支,wetSectionRan 防同拍双跑）----
    this.wetSectionStep(game);
    // ---- 移动段（HandleMovement;ai[0]==1 时 tileCollide=false 穿墙 :37145/:40108） ----
    this.moveStep(game, isPhase, preVx, preVy);
    // ---- 尾段 rotation/尘（:37294-37352,全部状态运行） ----
    this.aiVisual(game, isPhase);
    // ---- direction 自动更新（★BJ344 勘正:旧注 :15674-15682/:15434 系 1456 世代漂移,
    //      1457 = AutomaticallyChangesDirection :17387-17394 + 自动向 :17121-17131:
    //      aiStyle 3 且 ai[0]!=1 → direction = vx<0 ? -1 : 1（vx==0 → 1）——出程每子步
    //      跟随速度 X 符号,撞墙反弹后自旋反向;返回段（ai[0]==1）排除冻结。置于 rotation
    //      段后 = 本 tick 自旋仍用上一 tick 符号,与原版"AI(:16880)先于移动/转向(:17120)"
    //      的节拍一致;曾恒用出生 facing → 反弹后自旋不反向）----
    if (this.ai0 !== 1) this.dir = this.vx < 0 ? -1 : 1;
    // ---- 命中结算（同敌冷却 10t = NPC immune[owner]=10,:13172-13174;★BJ388 件3：
    //      902 免疫写 =7t（:14104-14112 immune[owner]=7 专支,先于通用 10t 档）→
    //      hitCd 窗口随型 7t）----
    // 383/301 撞墙 localAI[0]>0 → Damage_GetHitbox(:15050-15076)：命中盒先
    // Inflate(−w/2,−h/2) 收点再 Inflate(localAI/2)——末盒 = 弹体中心 ± localAI/2 的
    // 一帧冲击盒（301=200/383=300 边长）,消费即置 −1。
    let boomExt: { x: number; y: number; w: number; h: number } | null = null;
    if (this.boomBox > 0 && (this.projId === 301 || this.projId === 383)) {
      const half = this.boomBox / 2;
      boomExt = { x: this.cx - half, y: this.cy - half, w: this.boomBox, h: this.boomBox };
      this.boomBox = -1;
    }
    // ★BJ285（BJ232 死亡段割面族,2026-09-22）：CutTiles（Projectile.cs:12517 调用点/方法 :15276）先于 Damage_PVE
    //  （:12523）——有限穿透回旋镖（如 866 penetrate=5,:13124-13182 自减面）计数耗尽
    //  即亡拍【照割】;中央割 !e.dead 门=死亡拍整缺 → BJ260 前置习语。vid+1052 出程旗
    //  随盒穿线（CutTilesAt :15384-86 树面逐拍适用,与中央收口同参）。
    cutTilesBox(game, this.x, this.y, this.w, this.h, this.projId, this.cutExtraTreeCactus === true);
    // ★BJ344 F1（kdir 家族,BJ340 台账 §2）：num40 = 弹 direction 字段（:13652）——
    //  字段面 = 上方 :968/:1127 承载（出程自动向 sign(vx,0→1)/回收冻结/光刃回收态
    //  AI 写位玩家相对存续 :40077-40086——回收态自动向排除 :17389 首句）。
    //  命中特例族（Damage_PVE_Inner :13056-13134,先于 num40 读出;repo 流经本调用点
    //  仅 301/383/902）：301/383 = 玩家相对敌位（逐敌 :13062-13070/:13091-13099,
    //  式 (p<e)?1:-1 等号→-1 与 :13669 同形）+ 宽盒拍 num5 缩放（301×1.75 :13060/
    //  383×1.5+dmg×0.6 :13088-13089——dmgScale 单次截断与原版 (int)(dmg×0.6) 先截
    //  后乘的微差=登记债,悠悠球 dmgScale 同款既有）；902 = 回收态字段翻转
    //  （:13124-13130 ai0!=0——翻转在 num40 读出【前】,回调内翻转并持久,与旧
    //  onHitEnemy 位差半拍=本刀修;582 同支但 aiStyle 109 非本载体）。
    //  1116/612/953/978 命中写位属其它 AI 载体（proj1457 等）不流经此处（§5 备案）。
    const boomDirOverride: number | ((e: unknown) => number) =
      this.projId === 301 || this.projId === 383
        ? (e: unknown) => {
            const t = e as { cx?: number; x: number; w: number };
            return p.cx < (t.cx ?? t.x + t.w / 2) ? 1 : -1;
          }
        : this.projId === 902 && this.ai0 !== 0
          ? (e: unknown) => { this.dir *= -1; return this.dir; }
          : this.dir;
    hitEnemies(this, game, this.hitCd, this.projId === 902 ? 7 : 10,
      Math.sign(this.vx) || this.dir, this.armorPen,
      () => this.onHitEnemy(),
      this.projId === 383 && boomExt ? (_e, d) => Math.trunc(d * 0.6) : undefined, false, boomExt,
      0, boomDirOverride,
      boomExt && (this.projId === 301 || this.projId === 383)
        ? (this.projId === 301 ? 1.75 : 1.5) : 1);
  }

  /** ① 出程段（ai[0]==0,:36783-37087）——分支序与源码一致 */
  private aiOut(game: GameHooks, isPhase: boolean): void {
    const p = game.player;
    if (this.projId !== 866) this.outT++; // :36786-36793（866 不计 ai[1],计数在 localT）
    // :36794-36799 独立 106/45 门——按源码原样保留,但 ai[1] 先被类型链尾的
    // else if(ai[1]≥30)（:37082-37087,106 未豁免）截住 → 1456 中此门不可达
    // （影子死代码）。实测 106 回收点=30,勿按 45 调参
    if (this.projId === 106 && this.outT >= 45) { this.ai0 = 1; this.outT = 0; return; }
    if (isPhase) {
      // 光刃族（:36800-36866）：前 30 AI 次自旋,之后 vy+1/vx×0.96 垂落（vy 钳 16）
      if (this.outT >= 30) {
        this.vy += 1;
        this.vx *= 0.96;
        if (this.vy > 16) this.vy = 16;
        if (this.vy > 0) {
          // :36811-36832 垂落姿态:rotation 逼近 dir>0→2.335 / dir<0→-3.948（差值绕 2π 取近路）
          const tgt = this.dir > 0 ? 2.335 : -3.948;
          this.rot = this.dir > 0
            ? (this.rot <= tgt ? (this.rot * 4 + tgt) / 5 : (this.rot * 9 + tgt + Math.PI * 2) / 10)
            : (this.rot >= tgt ? (this.rot * 4 + tgt) / 5 : (this.rot * 9 + tgt - Math.PI * 2) / 10);
        } else {
          this.rot += 0.4 * this.dir; // :36834-36844（音门 1074 9t/其余 14t）
          if (this.soundDelay === 0) {
            game.playSfxFiles([this.projId === 1074 ? 'Item_7' : 'Item_15'], 1, this.cx, this.cy);
            this.soundDelay = this.projId === 1074 ? 9 : 14;
          }
        }
      } else {
        // 前 30 AI 次自旋段：1074 的 Item_7 带 -0.3f 变调(:39800-39808),其余 Item_15
        // 无变调(:39810-39814)——"-0.3 变调略"登记缺口随 playSfxWav pitch 参清偿
        this.rot += 0.4 * this.dir; // :36836-36847 对位行号(1456)
        if (this.soundDelay === 0) {
          if (this.projId === 1074) {
            game.playSfxWav?.('Item_7', 1, this.cx, this.cy, -0.3);
            this.soundDelay = 11;
          } else {
            game.playSfxFiles(['Item_15'], 1, this.cx, this.cy);
            this.soundDelay = 14;
          }
        }
      }
      return;
    }
    if (this.projId === 320 || this.projId === 383) {
      // 320 冰回旋镖 / 383 附魔飞刀（:36868-36888）：≥10 起下垂 vy+0.5（383 上升再+0.35）/
      // vx×0.95/vy 钳 16;383 距玩家>800 回收
      if (this.outT >= 10) {
        this.vy += 0.5;
        if (this.projId === 383 && this.vy < 0) this.vy += 0.35;
        this.vx *= 0.95;
        if (this.vy > 16) this.vy = 16;
        if (this.projId === 383 && Math.hypot(p.cx - this.cx, p.cy - this.cy) > 800) {
          this.ai0 = 1; this.outT = 0;
        }
      }
      return;
    }
    if (this.projId === 182 || this.projId === 866) {
      // 182 圣骑锤锤头光尘（1458 :39906-39912,出程段内 1456 对位 :36889 起）：出程态
      // rand(2)==0 → d57 α255 s0.75、vel×0.1 后 noGravity。★C1 批曾按"原版头段本就
      // 无尘"把 182 从尘表删除——该块实居出程分支内而非方法头段,登记勘误+补接
      if (this.projId === 182 && Math.floor(Math.random() * 2) === 0) {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 57, 0, 0, 255, null, 0.75);
        if (d) { d.vx *= 0.1; d.vy *= 0.1; d.noGravity = true; }
      }
      // 182 圣骑士锤（:36889-36973）/ 866 飞刀（:36980-37057）:800px 内最近敌追踪
      // （CanHit 视线门）,目标速度=(目标-球心)norm×12,轴步进 0.25;无目标 ≥30 回收。
      // ★计数源不同:182=ai[1]（:36790-36793,顶部已自增）/ 866=localAI[0]（:36999,
      //   ai[1] 被 866 占用为目标索引）——数值门一致,这里统一取 cnt
      const cnt = this.projId === 866 ? ++this.localT : this.outT;
      let tx = this.cx + this.vx * 100, ty = this.cy + this.vy * 100; // :36944-36946 无目标前瞻点
      let found = false;
      if (cnt > 10 && cnt < 360) { // :36909-36938 / :36985-36997
        let best = 800; // :36907 / FindTargetWithLineOfSight 缺省 800 :42972
        for (const ent of game.enemies()) {
          const e = ent as { x: number; y: number; w: number; h: number; dead: boolean };
          if (!canBeChasedBy(ent)) continue;   // CanBeChasedBy :91070——友好 NPC 不入索敌（防追踪睡渔夫）
          if (e.dead) continue;
          if (!canHit(game.world.store, this.x, this.y, this.w, this.h, e.x, e.y, e.w, e.h)) continue;
          const d = Math.hypot(e.x + e.w / 2 - this.cx, e.y + e.h / 2 - this.cy);
          if (d < best) { best = d; tx = e.x + e.w / 2; ty = e.y + e.h / 2; found = true; }
        }
      }
      if (!found && cnt >= 30) { this.ai0 = 1; this.outT = 0; return; } // :36932-36938 / :37009-37017
      const dd = Math.hypot(tx - this.cx, ty - this.cy) || 1;
      this.steerTo(((tx - this.cx) / dd) * 12, ((ty - this.cy) / dd) * 12, 0.25); // :36937-36973
      return;
    }
    if (this.projId === 301) {
      // 301 弹跳盾出程态（1457 AI_003 `else if (type == 301)` 提取件行锚 :459-477;
      // ★1456 曾为"按住≥20/松手≥100 双门"旧式(:37058-37082),1457 起重构为此式——
      // 本仓沿 1456 写法属版本域漂移,终清波按 1457/1458 真值重写）：
      //   · scale=1.75/tick（仅绘制层——getRect 不乘 scale,Projectile.cs:16760-16763;
      //     无任何复位点 → 回程保持放大直至消亡,原版同态）
      //   · ai[1]==1 帧 rotation=atan2(v)−π/4−π/2;ai[1]==20 帧 Item_1 音(:40017-40022)
      //   · ai[0]!=-1000f 守护(展示偶人语态,常规局恒真):ai[1]<30 期绕手悬停自旋
      //     （rotation += direction×π/30、Center 钉在 MountedCenter−velocity）,
      //     否则 rotation=atan2(v)+π/4
      //   · player active&&!dead 才运行整段;ai[1]>=60 → 转回收且速度归零
      const pl = p as unknown as { dead?: boolean };
      this.visScale = 1.75;
      if (!pl.dead) {
        if (this.outT === 1) {
          this.rot = Math.atan2(this.vy, this.vx) - Math.PI / 4 - Math.PI / 2;
        }
        if (this.outT === 20) game.playSfxFiles(['Item_1'], 1, this.cx, this.cy);
        if (this.outT < 30) {
          this.rot += this.dir * (Math.PI / 30);
          this.x = p.cx - this.vx - this.w / 2;   // Center=MountedCenter−velocity
          this.y = p.cy - this.vy - this.h / 2;
        } else {
          this.rot = Math.atan2(this.vy, this.vx) + Math.PI / 4;
        }
        if (this.outT >= 60) { this.ai0 = 1; this.outT = 0; this.vx = 0; this.vy = 0; }
      }
      return;
    }
    // 缺省族（:37082-37086）：无摩擦直线,ai[1]≥30 回收
    if (this.outT >= 30) { this.ai0 = 1; this.outT = 0; }
  }

  /** 光刃撞墙悬停态（ai[0]==2,:37089-37109;由撞墙分支 :17975-17990 进入） */
  private aiHover(game: GameHooks): void {
    if (this.vy < 0) this.vy *= 0.5; // :37091-37093
    this.rot = 2.335;                // :37095
    this.vx = 0;                     // :37096
    this.vy += 1;                    // :37097
    if (!this.hoverSfxDone) {        // localAI[1] 一次性门 :37098-37109
      if (this.projId === 1074) { this.localT = -1; game.playSfxFiles(['Item_182'], 1, this.cx, this.cy); }
      else game.playSfxFiles(['Item_15'], 1, this.cx, this.cy);
      this.hoverSfxDone = true;
    }
  }

  /** ③ 返回段（ai[0]==1,:37111-37288） */
  private aiReturn(game: GameHooks, isPhase: boolean): void {
    const p = game.player;
    if (isPhase) {
      // :37114-37124 direction 朝玩家侧;rotation = 飞行向 - 2.335
      this.dir = this.cx < p.cx ? -1 : 1;
      this.rot = Math.atan2(this.vy, this.vx) - 2.335;
      if (this.localT <= 0) { // :40315-40334 localAI[0]<=0 门（悬停过<0 / 常规回程==0）
        // 悬停过=Item_182 -0.2f(:40321) / 否则 Item_7 -0.5f(:40324)/其余 Item_15 无变调
        // ——三档 pitch 随 playSfxWav 第 5 参落地（"返回音无变调"登记缺口清偿）
        if (this.projId === 1074) {
          if (this.localT < 0) game.playSfxWav?.('Item_182', 1, this.cx, this.cy, -0.2);
          else game.playSfxWav?.('Item_7', 1, this.cx, this.cy, -0.5);
        } else {
          game.playSfxFiles(['Item_15'], 1, this.cx, this.cy);
        }
        this.localT = 1;
      }
    }
    // tileCollide=false（:37145）——moveStep 直接积分
    const [spd0, acc0] = BOOMERANG_RETURN[this.projId] ?? (isPhase ? [40, 3] : [9, 0.4]); // :37146-37206
    // 1457 :40172-40186（1456 无）:回程参数接攻速缩放——toMax = 1f/meleeSpeed（:40175）
    // = 1/M = 攻速和 A（meleeSpeed 字段=M 倒数档）;num30 = Remap(1.5,0,1,1,toMax)
    // = 1.5×A − 0.5 钳 1..10。★BJ640（2026-10-11）：旧式直用 attackSpeedMult（=M）
    // =方向反——攻速加成档（A=1.7）原版 num30=2.05 回程更快,旧式 0.55 钳 1 恒中性;
    // 减速档（A=0.8）原版 0.7 钳 1 中性,旧式 1.08 反而更快。光刃族豁免（flag3=false）。
    let spd = spd0, acc = acc0;
    if (!isPhase) {
      const asm = 1 / (game.player.attackSpeedMult || 1);
      let num30 = 1.5 * asm - 0.5;
      if (num30 > 10) num30 = 10;
      if (num30 < 1) num30 = 1;
      spd *= num30;
      acc *= num30;
    }
    let dx = p.cx - this.cx, dy = p.cy - this.cy;
    const d = Math.hypot(dx, dy) || 1;
    // :37223-37232 距离 Kill 门（301 6000/其余 3000）
    if (d > (this.projId === 301 ? 6000 : 3000)) { this.dead = true; return; }
    dx = (dx / d) * spd; dy = (dy / d) * spd; // :37234-37236 目标速度 = 朝向 × num28
    if (this.projId === 383) {
      // :37237-37247 383 专属:沿 (目标速度-当前速度) 方向加速 min(num29, 差距长)
      const ddx = dx - this.vx, ddy = dy - this.vy;
      const dl = Math.hypot(ddx, ddy);
      if (dl > 0) {
        const s = Math.min(acc, dl);
        this.vx += (ddx / dl) * s; this.vy += (ddy / dl) * s;
      }
    } else {
      this.steerTo(dx, dy, acc); // :37249-37282 轴步进,异号加倍
    }
    // ④ 回收:与玩家 AABB 相交即 Kill（:37272-37288,仅本机投射物）
    if (this.x < p.x + p.w && this.x + this.w > p.x && this.y < p.y + p.h && this.y + this.h > p.y) {
      this.dead = true;
    }
  }

  /** 移动/撞墙段（HandleMovement 撞墙分支 :18103-18161;分轴探测 = lastVelocity 语义）。
   *  preVx/preVy = 本子步 AI 前 velocity 快照（:16870 wetVelocity 源,湿态返回段消费） */
  private moveStep(game: GameHooks, isPhase: boolean, preVx: number, preVy: number): void {
    if (this.ai0 === 1) {
      // 返回段位移（ai[0]==1 → tileCollide=false :40108 → HandleMovement 湿阻尼分支
      //  :17721 整体在 if(tileCollide) :17585 内【不跑】）。UpdatePosition :20555-20562
      //  分叉照抄：wet → position += wetVelocity（= :16870 本子步 AI 前快照,无阻尼——
      //  湿态返回位移滞后一子步 = 原版 quirk 本体）;dry → position += velocity（post-AI）。
      if (this.wet) { this.x += preVx; this.y += preVy; }
      else { this.x += this.vx; this.y += this.vy; }
      return;
    } // 穿墙（:37145/:40108 tileCollide=false）
    // ★嵌入态裸位移(2026-09-01 用户实录定罪):中心格在实体内 = 弹体出生嵌在斜坡/
    //  阶梯立体几何中。处置 = 无管线/无碰撞响应/无声的裸位移——以投掷动量自然滑出,
    //  进入自由空间后正常差分门接管。修复两个症状:
    //   ①反复弹射音效(嵌入状态下每帧触撞→playSfx('dig') 连发)
    //   ②穿墙(embedGrace 相位穿越已移除,此方案限定穿透范围=出生时覆盖的格数)
    {
      const stE = game.world.store;
      const _cx = Math.floor(this.cx / TILE), _cy = Math.floor(this.cy / TILE);
      if (stE.inBounds(_cx, _cy) && stE.isSolid(_cx, _cy)) {
        // tileCollide=true（ai[0]==0）位移模拟 → 湿阻尼同吃（GrenadeProj sticky 直积分
        //  `x += vx*dragS` 同款先例;原版本体=TileCollision 拦截,此处取"水中位移减半"面）
        const dragE = projWaterDragFactor(this);
        this.x += this.vx * dragE; this.y += this.vy * dragE;
        return;
      }
    }
    // ★正典碰撞管线（2026-09-01 定罪「站斜砖旋刃原地打转」,终结本族第三次近似迭代：
    //  ①出生盒心偏移→②半砖全格布尔→③坡面全格布尔）：bespoke solidBox 的
    //  坡面全格近似与玩家站坡的脚线沉降(格内中段)天然互斥,帧0 即判撞双轴互锁。
    //  改走 moveAndCollide（=玩家/NPC 同一 Collision.TileCollision/SlopeCollision
    //  移植管线,半砖下半/坡面对角贴合/平台单向全覆盖;同文件 Molotov/Grenade 族
    //  先例同款 body 视图）。弹体侧口径:
    //   · tileCollide = ai[0]!==1（返程穿墙 :37145,管线直写通道）
    //   · dropThrough = true（原版弹体 flag6 fallThrough 缺省 true,P.cs:17587 系
    //     ——平台/家具顶全域穿透）
    //   · stepUp 缺省 false（弹幕不调 StepUp）
    //  hitX/hitY 取 hitWall/collideY 旗标（slopeCollide 贴合推离不置 collideY,
    //  纯 tile 拦截才计撞=AI_003 逐轴翻转语义不变）;速度恒以 lvx/lvy 复位,
    //  保留「出程无摩擦直线」（管线内斜面粘滞辅助等速度编辑不复写回弹体）
    const lvx = this.vx, lvy = this.vy;
    const body = {
      x: this.x, y: this.y, w: this.w, h: this.h,
      vx: this.vx, vy: this.vy,
      onGround: false, hitWall: false, hitHead: false, collideY: false,
      hoik: true,   // ★FX34c 弹幕域 hoik=true（Body.hoik 注:原版 Projectile 全路径）
      tileCollide: this.ai0 !== 1,
      dropThrough: true,
    };
    // ★水中位移阻尼（HandleMovement :17721-17764,湿段批）——速度【场】不减只削当拍
    //  位移（原版 wetVelocity = post-TileCollision velocity×0.5/0.25/0.375,仅进
    //  UpdatePosition :20557 `if (wet) position += wetVelocity`;dry 走 :20561
    //  `position += velocity`）。阻尼只乘进 dx/dy 位移入参,body.vx/vy=碰撞调整字段
    //  采纳处原样回读——下方撞墙响应 chX/chY 判与反弹式（-lvx/-lvy=未阻尼
    //  lastVelocity :17696,原版同构）全不受阻尼影响。逐轴 passthrough 差
    //  （原版 TileCollision 改速轴不阻尼 :17728-17733 等）= moveAndCollide 共享契约
    //  外（GrenadeProj 同批同口径,登记）。
    const drag = projWaterDragFactor(this);
    moveAndCollide(body, game.world, lvx * drag, lvy * drag);
    // ★接触路径恢复 lastV——反射公式(-lvx/-lvy)与 383 豁免、301 盾钳定均以
    // 【入撞前速度】为基准。slope 粘滞编辑的持久化问题(右下弹射)归管线层修。
    this.x = body.x; this.y = body.y;
    const chX = body.vx !== lvx, chY = body.vy !== lvy;
    const stB = game.world.store;
    // ★世界边缘特判(P.cs:18009-18011,仅 aiStyle3 有):出界格线即使速度未被改也计接触
    const offWorldEdge = this.x <= 0 || this.x + this.w >= stB.w * TILE
      || this.y <= 0 || this.y + this.h >= stB.h * TILE;
    const hitX = chX, hitY = chY;
    if (!hitX && !hitY && !offWorldEdge) return;
    // 原版此点 velocity 已被 Collision 按碰撞轴清零（TileCollision 后写语义）——下游
    // 反射读数/LightDisc_Bounce 的 reflect 源都基于这份"轴零化视图"。管线以差分折叠
    // 出等价投影（未碰轴保留 lastV、碰轴置 0）。
    const pvx = hitX ? 0 : lvx, pvy = hitY ? 0 : lvy;
    // ---- aiStyle3/13 撞墙响应链 ----
    if (isPhase) {
      this.ai0 = 2; this.outT = 0;
      return;
    }
    if (this.projId === 106) {
      this.lightDiscBounceFx(game, pvx, pvy, lvx, lvy);
    }
    if (this.projId === 383) {
      if (this.outT >= 10) {
        hitTilesInACircleFx(game, this.x - 150, this.y - 150, lvx, lvy, 300);
        game.playSfxFile?.('Item_14', 1, this.cx, this.cy);
        this.boomBox = 300;
      }
    } else if (this.projId === 301) {
      paladinsHammerShockwaveFx(game, this.x, this.y, this.w, this.h);
      game.broadcastParticleOrchestra?.(ParticleOrchestraType.PaladinsHammerShockwave,
        this.x, this.y, this.w, this.h);
      this.boomBox = 200;
    } else {
      game.spawnParticles(this.cx, this.cy, '#A09080', 3, 1.5, { life: 14, size: 2 });
    }
    // {33,106,866} 命中轴反弹不回收 / 其余 ai[0]=1 回收 + 双轴从 lastVelocity 全反
    if (WALL_BOUNCE_PROJ.has(this.projId)) {
      if (hitX) this.vx = -lvx;
      if (hitY) this.vy = -lvy;
    } else {
      this.ai0 = 1; this.outT = 0;
      if (this.projId !== 383) { this.vx = -lvx; this.vy = -lvy; }
    }
    game.playSfx('dig', 1, this.cx, this.cy);
  }

  /** LightDisc_Bounce（Projectile.cs:13101-13112,106 光碟撞墙溅射——★BJ665 勘正 伪锚 :28787-28801;C1 批"视觉略"
   *  登记的终清波实装）：NewDustPerfect 306 ×4 主粒（α200/scale1.6/color=
   *  Color.Lerp(new Color(219,253,0), Cyan, rand)）+ CloneDust 白档副本（白,s1,α50）。
   *  spinningpoint = Vector2.Reflect(velocity, normal)（XNA 原式 v−2(v·n)n,n 可为
   *  非单位轴向：碰撞轴取 −sign(lastVelocity)、未碰轴 0）；散布 =
   *  RotatedBy(π/4 × NextFloatDirection([-1,1))) × 0.6 × NextFloat()。
   *  hitPoint = Center + velocity.SafeNormalize(UnitX)×8×scale（velocity 此点为轴零化
   *  投影,零向量 SafeNormalize(UnitX) 兜底）。spawnDust perfect 变体承载定点落位 */
  private lightDiscBounceFx(game: GameHooks, pvx: number, pvy: number, lvx: number, lvy: number): void {
    const nx = pvx !== lvx ? -Math.sign(lvx) : 0;
    const ny = pvy !== lvy ? -Math.sign(lvy) : 0;
    const dot = pvx * nx + pvy * ny;
    const rx = pvx - 2 * dot * nx, ry = pvy - 2 * dot * ny;     // Vector2.Reflect
    const vmag = Math.hypot(pvx, pvy);
    const hxOff = vmag > 0 ? pvx / vmag : 1, hyOff = vmag > 0 ? pvy / vmag : 0; // SafeNormalize(UnitX)
    for (let i = 0; i < 4; i++) {
      const spread = (Math.random() * 2 - 1) * (Math.PI / 4);   // NextFloatDirection×π/4
      const ca = Math.cos(spread), sa = Math.sin(spread);
      const mag = 0.6 * Math.random();
      const bvx = (rx * ca - ry * sa) * mag, bvy = (rx * sa + ry * ca) * mag;
      const t = Math.random();                                  // Lerp 主色
      const col = { r: Math.round(219 + (0 - 219) * t), g: Math.round(253 + (255 - 253) * t), b: Math.round(0 + 255 * t), a: 255 };
      for (let clone = 0; clone < 2; clone++) {
        game.spawnDust?.(this.cx + hxOff * 8, this.cy + hyOff * 8,
          this.w, this.h, 306, bvx, bvy, clone === 0 ? 200 : 50, clone === 0 ? col : null,
          clone === 0 ? 1.6 : 1, false, true);
      }
    }
  }

  /** 尾段 rotation/尘（:37294-37352,出程/悬停/返回全状态运行;光刃走专属段不进此链） */
  private aiVisual(game: GameHooks, isPhase: boolean): void {
    const p = game.player;
    if (this.projId === 106) {
      this.rot += 0.3 * this.dir; // :40277-40280 光碟自旋 0.3×direction(全状态)
    } else if (this.projId === 866) {
      // 飞刀:rotation=velocity.ToRotation + 尾段尘 rand(2)==0 → d212、vel×0.1、noGravity
      // (:40281-40289 全状态运行——"飞刀无尾尘"登记缺口清偿)
      this.rot = Math.atan2(this.vy, this.vx);
      if (Math.floor(Math.random() * 2) === 0) {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 212, 0, 0);
        if (d) { d.vx *= 0.1; d.vy *= 0.1; d.noGravity = true; }
      }
    } else if (this.projId === 383) {
      // :37310-37325 出程对准飞行向 / 返回段对准 (球心-玩家) 向量,+π/2
      this.rot = (this.ai0 === 0
        ? Math.atan2(this.vy, this.vx)
        : Math.atan2(this.cy - p.cy, this.cx - p.cx)) + Math.PI / 2;
    } else if (this.projId === 301) {
      // 301 尾段（1457 AI_003 提取件 :707-761,全状态;出程 rotation 已由 aiOut 承担）：
      //   · ai[0]==0 出程态 → d57/d43 旋转喷洒:循环 k<num35(ai[1]>=30 时 10 否则 0)、
      //     num36 = >=30 ?1.76:0.3、num37=16×scale(28);d57 掷 rand(2)==0(NewDust
      //     α200/scale1.2/base v×0.2)+vel += velocity×num36×NextFloat 后 ×0.2,d43 掷
      //     rand(3)==0(α254/scale0.3/v 0 起)+vel 同上后 ×0.5;两者 noGravity 且
      //     position = Center + velocity.SafeNormalize(UnitX).RotatedBy(π/2)
      //     × num37×(rand(2)×2−1),rand(3)==0 再 ×NextFloat——"出程尘略"登记清偿。
      //     ★本仓 spawnDust 完美落位变体承载 position 覆写(vanilla NewDust 后覆写)
      //   · 其余态（回收段）→ 自旋 0.4×direction(:40760-40763)
      if (this.ai0 === 0) {
        // 尾段独立于玩家存活门（提取件 :707 起无 gate）;ai[1]>=30 才有喷洒量(num35=10)
        if (this.outT >= 30) {
          const vmag = Math.hypot(this.vx, this.vy);
          const ux = vmag > 0 ? this.vx / vmag : 1, uy = vmag > 0 ? this.vy / vmag : 0;
          const pxv = -uy, pyv = ux;                                 // SafeNormalize(UnitX).RotatedBy(π/2)
          for (let k = 0; k < 10; k++) {
            if (Math.floor(Math.random() * 2) === 0) {               // d57 掷(rand(2)==0)
              let rad = 16 * this.visScale;
              if (Math.floor(Math.random() * 3) === 0) rad *= Math.random();
              const sgn = Math.floor(Math.random() * 2) * 2 - 1;     // 单掷共用于 XY(:40748)
              const rf = Math.random();                              // velocity×num36×NextFloat() 单标量
              const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 57,
                this.vx * 0.2, this.vy * 0.2, 200, null, 1.2);
              if (d) {
                d.vx = (this.vx * 0.2 + this.vx * 1.76 * rf) * 0.2;
                d.vy = (this.vy * 0.2 + this.vy * 1.76 * rf) * 0.2;
                d.noGravity = true;
                d.x = this.cx + pxv * rad * sgn;                     // NewDust 后定点覆写
                d.y = this.cy + pyv * rad * sgn;
              }
            }
            if (Math.floor(Math.random() * 3) === 0) {               // d43 掷(rand(3)==0)
              let rad = 16 * this.visScale;
              if (Math.floor(Math.random() * 3) === 0) rad *= Math.random();
              const sgn = Math.floor(Math.random() * 2) * 2 - 1;
              const rf = Math.random();
              const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 43,
                0, 0, 254, null, 0.3);
              if (d) {
                d.vx = this.vx * 1.76 * rf * 0.5;
                d.vy = this.vy * 1.76 * rf * 0.5;
                d.noGravity = true;
                d.x = this.cx + pxv * rad * sgn;
                d.y = this.cy + pyv * rad * sgn;
              }
            }
          }
        }
      } else {
        this.rot += 0.4 * this.dir;
      }
    } else if (!isPhase) {
      this.rot += 0.4 * this.dir; // :37351-37352 缺省族两段自旋 0.4（非定角!）
    }
    // per-type 真值尘（1458 AI_003 头段 :39619-39686——粒型/alpha/scale/noGravity 逐参,
    // 原 BOOMERANG_DUST 手调色值近似退役）
    const dustFn = BOOMERANG_DUST_TRUTH[this.projId];
    if (dustFn) {
      dustFn({ projId: this.projId, x: this.x, y: this.y, w: this.w, h: this.h,
        vx: this.vx, vy: this.vy }, game);
    }
  }

  /** 命中敌回调 = Projectile.Damage 回收门 + 穿透自减（:13101-13114/:14104-14112/
   *  :14189-14196）★BJ388 件1：本回调在受理位求值（hitEnemies vanillaGated 平面） */
  private onHitEnemy(): void {
    // ★BJ344 勘正（旧锚 :12278-12291/:12292-12297 系 1456 世代,1457 该域=命中玩家
    //  buff 段）：出程命中敌 → 速度反转 + ai[0]=1 = Damage_PVE_Inner :13101-13114
    // （豁免 301/866/902/光刃族;106 的 LightDisc_Bounce 溅射 :13105-13108 视觉略）
    if (this.ai0 === 0 && !NO_HIT_RETURN_PROJ.has(this.projId)
      && !PHASEBLADE_PROJ.has(this.projId)) {
      this.vx = -this.vx; this.vy = -this.vy;
      this.ai0 = 1; this.outT = 0;
    }
    // ★BJ388 件3（BJ344 登记缺口清偿,2026-09-28）：902 命中转回收（:14104-14112
    //  免疫写链专支 `type==582||type==902 → targetNPC.immune[owner]=7; if (ai[0]!=1f)
    //  { ai[0]=1f; netUpdate=true }`）——任意态命中（出程/返回）都翻 ai[0]=1 即刻转
    //  回收,自设 7t 免疫窗（窗口面随 :1027 hitCd 7t 承载）。582 同支但 aiStyle 109
    //  非本载体（proj1457 域）。位于通用翻转块后 = 原版序（:13101 特例链 → StrikeNPC
    //  :13712 → :14104 免疫写链）；902 在上块被 NO_HIT_RETURN_PROJ 豁免（速度反转
    //  不跑——返回段转向由 AI 制速承担,与原版 AI_003 同相）
    if (this.projId === 902 && this.ai0 !== 1) this.ai0 = 1;
    // 902 返回段命中 direction 翻转已随 BJ344 F1 挪入 :984 dirOverride 回调（原版
    // 翻转 :13124-13130 在 num40 :13652 读出【前】=首中即取翻转值;旧位在 hurt 后
    // =首中未翻错半拍,两处并存会双翻故摘除;★件1：门拒拍 dirOverride 不求值=翻转
    // 亦静默,与 :13124 受理位同相）
    // penetrate 自减（:14189-14196）;==0 → Kill（:15866-15868）;
    // 866 特例（:13124-13137):五击后 penetrate 复位 1、伤害归零不消失
    if (this.penetrate > 0) {
      this.penetrate--;
      if (this.penetrate === 0) {
        if (this.projId === 866) { this.penetrate = 1; this.damage = 0; }
        else this.dead = true;
      }
    }
  }
}

// ================= 长矛（aiStyle 19，AI_019_Spears，Projectile.cs:46702——★BJ665 勘正 1456 伪锚 :43198） =================

/** 每型号伸缩参数（AI_019_Spears_GetSpearOffsetRelativeToPlayer :43417-43540 switch）：
 *  [初始偏移 num6, 伸出速 num7, 缩回速 num8]——位移 = dir × shootSpeed × offset。
 *  aiStyle 161（短剑刺 802/842/938-945）不走此表——见 RAPIER_PROJ 独立 AI_161 模型 */
const SPEAR_PARAMS: Record<number, [number, number, number]> = {
  46: [3, 1.4, 1.6], 105: [3, 2.1, 2.4], 367: [3, 1.5, 1.6], 368: [3, 1.4, 1.5],
  222: [3, 2.1, 2.4], 342: [3, 2.1, 2.4], 47: [4, 0.9, 1.2], 153: [4, 1.3, 1.5],
  49: [4, 0.85, 1.1], 730: [8, 1.2, 1.5], 877: [28, 0.4, 0.4], 878: [28, 0.4, 0.4],
  879: [28, 0.4, 0.4], 64: [3, 1.7, 1.9], 215: [3, 1.7, 1.9],
  66: [3, 1.9, 2.1], 97: [3, 1.9, 2.1], 212: [3, 1.9, 2.1], 218: [3, 1.9, 2.1],
  130: [3, 1.0, 1.3], 1103: [4, 0.85, 1.1],
};

/** aiStyle 161 短剑刺族（DefaultToShortsword :10775-10789 全集合——★BJ665 勘正 伪锚 :10158-10172：802 GladiusStab /
 *  842 RulerStab / 938-945 七金属短剑+铁短剑刺）。AI_161_RapierStabs（:48483-48517——★BJ665 勘正 伪锚 :44987-45004）
 *  独立直刺模型：Center = 玩家MountedCenter + velocity×(ai[0]−1),ai[0]≥16 Kill;
 *  ★extraUpdates = 1（:10786）——每帧跑 2 个 AI 子步（Projectile.cs:16780-16783——★BJ665 勘正 伪锚 :10165/:15331-15336
 *  numUpdates 循环）,整刺 16 步在 8 帧内完成、每帧推进 2×shootSpeed（1.4.4 短剑
 *  重做的"快刺"节奏本体）。考古备注：1.4.5.6 的 aiStyle 161 无"掷出"独立态——
 *  短剑重做的可投掷性体现在物品侧（useStyle 13 + noUseGraphic + shoot=刺弹）,
 *  Projectile.AI case 161 仅持握刺击单态（无 ai[1] 分支/无 throw 站点,
 *  938-945 唯一生成点 = ItemCheck_Shoot 通用尾段 :47823——★BJ665 勘正 1456 伪锚 :48637） */
const RAPIER_PROJ = new Set([802, 842, 938, 939, 940, 941, 942, 943, 944, 945]);
/** 802/842（Gladius/Ruler）出膛抖动族（ItemCheck_Shoot :46700-46707）：
 *  角 ±π/8、速 ±0.7——Ruler/Gladius 的"尺子不准"机制本体 */
const RAPIER_JITTER_PROJ = new Set([802, 842]);

/** 长矛/细剑绘制角与镜像(纯函数,供 draw 与回归测试共用)。
 *  AI_019 = DrawProj_Spear 专支(Main.cs:35161-35164 按 aiStyle==19 派发——★BJ665 勘正 伪锚 :34153-34157,
 *  :35806-35816——★BJ665 勘正 伪锚 :34659-34668):num = atan2(vy,vx)+2.355(=3π/4);theOwner.direction>0(玩家朝右)
 *  → dir=FlipHorizontally 且 num -= π/2、origin.X=贴图宽。AI 侧 rotation 赋值同值
 *  (:46789-46793,:46715 spriteDirection=-direction——★BJ665 勘正 伪锚 :43271-43276/:43214)。
 *  AI_161 = :48486 rotation=atan2+π/2(★BJ665 勘正 伪锚 :44990);DrawProjDirect(:33161 族——★BJ665 勘正 伪锚 :32360)里【仅 938-945】
 *  再 num327 -= π/4×sd（:32443-32446）——802/842 无此偏置,只 atan2+π/2;
 *  dir=spriteDirection==-1 → FlipHorizontally（:29825-29829,DrawProj 层级全局位,
 *  AI_161 :44995 设 spriteDirection=sign(vx)）。
 *  ★朝向陷阱(2026-08-13 终审):AI_019 的翻转条件是"玩家朝右",曾写反成 dx<0 且丢
 *  mirror——右刺纯数值巧合仍指正右,左刺矛头指 φ-π/2(正下)偏 90°。 */
export function spearDrawAngle(
  dx: number, dy: number, isRapier: boolean, rapierNoQuarter = false,
): { ang: number; mirror: boolean } {
  const sd = dx >= 0 ? 1 : -1;
  if (isRapier) {
    // rapierNoQuarter = 802/842（Main.cs:33255 列 938-945+1127——★BJ665 勘正 1456 伪锚 :32443）
    return { ang: Math.atan2(dy, dx) + Math.PI / 2 - (rapierNoQuarter ? 0 : Math.PI / 4 * sd), mirror: sd === -1 };
  }
  let ang = Math.atan2(dy, dx) + 2.355; // :34659
  let mirror = false;
  if (sd > 0) { ang -= Math.PI / 2; mirror = true; } // :34664-34668 朝右翻转
  return { ang, mirror };
}

/** 命中盒型号表（SetDefaults 逐 type width/height,Projectile.cs:1036/1924/4045 等;
 *  其余型号均 18×18,46=20、130=22、877-879=25;342 是 22×2 薄刃——原版真值勿当
 *  提取器错值修掉）。161 细剑族全 18×18。此前恒 20×20 → 14 型号命中盒失真(2026-08-13 终审) */
const SPEAR_SIZE: Record<number, [number, number]> = {
  46: [20, 20], 130: [22, 22], 342: [22, 2],
  877: [25, 25], 878: [25, 25], 879: [25, 25],
  481: [22, 22],   // Chain Guillotines（:5563-5572 width=height=22）
};

/** AI_019_Spears_GetExtensionHitbox（Projectile.cs:47034-47073——1456 伪锚 :43530-43571
 *  勘正 R17-F4）纯函数：
 *  105 昆恩枪/46 暗黑长枪/153 腐叉（default return false——其余长矛无延伸盒）在
 *  【伸出相】（itemAnimation ≥ itemAnimationMax/3，:47037-47040 缩回相不生成）沿速度向
 *  生成前向延伸方盒：
 *    num2 = Remap(itemAnimation, max, ⌊max/3⌋, 0,1) = t/(max−⌊max/3⌋)（出生 0 →
 *           伸出相末 1，钳 [0,1]）
 *    距离 num7 = 10 + len·num2（len：105/46=50、153=40；default 30）、
 *    边长 num8 = 10 + size·num2（size：105=20、46=15、153=10；default 10）
 *    len ×= 1/meleeSpeed（:47066——实参 spdMul = 1/attackSpeedMult = 攻速和 1/M）
 *    盒 = CenteredRectangle(Center + velocity向·num7, (num8,num8))
 *  消费：伤害 Colliding 步进盒（:14554-14576，hitEnemies extBox 参）+ CutTiles
 *  （:14176-14179 CutTilesAt(extensionBox)）。t/dur 与 SpearProj 的 itemAnimation
 *  同源（itemAnim = dur − t） */
export function spearExtensionHitbox(
  projId: number, t: number, dur: number,
  cx: number, cy: number, dx: number, dy: number,
  attackSpeedMult = 1,
): { x: number; y: number; w: number; h: number } | null {
  if (projId !== 105 && projId !== 46 && projId !== 153) return null;   // :47051-47052 default
  if (dur - t < dur / 3) return null;                    // :47037-47040 缩回相（浮点 max/3）
  const num3 = Math.floor(dur / 3);                                     // :47043 int 除法
  let num4 = 50, num6 = 15;
  if (projId === 105) { num4 = 50; num6 = 20; }
  else if (projId === 153) { num4 = 40; num6 = 10; }
  num4 *= attackSpeedMult;                                              // :47066（R17-F4 勘正）
  const num2 = Math.min(1, Math.max(0, t / (dur - num3)));              // :47044 Remap
  const num7 = 10 + num4 * num2;                                        // :47067
  const num8 = 10 + num6 * num2;                                        // :47068
  const ccx = cx + dx * num7, ccy = cy + dy * num7;                     // :47070
  return { x: ccx - num8 / 2, y: ccy - num8 / 2, w: num8, h: num8 };    // :47071
}

export class SpearProj extends Entity {
  w = 18; h = 18;
  damage: number;
  knockback: number;
  projId: number;
  /** GetWeaponCrit 合并值（Game 侧传入；缺省 4 基础） */
  critChance = 0.04;
  /** ⑥ 护甲穿透（Game 注入，命中传 hurt 减防） */
  armorPen = 0;
  /** 近战系（吃武器浸剂） */
  meleeProj = true;
  /** AI_019 伴生弹回调（Game 注入 entities.add——GameHooks 不暴露实体桶）：
   *  130 蘑菇矛→131 孢子云七连 / 730 风暴矛→732 首拍气旋 / 342 北极→343 雪花镖 /
   *  222 叶绿→228 孢子云 / 367 黑曜鱼叉→1-3×1107-1109 碎刃
   *  （1458 Projectile.cs:46749-46802）。参数 = 弹心坐标 + 初速 + 弹型/伤/kb
   *  （NewProjectile 中心坐标语义）;extra = NewProjectile 后置覆写档（timeLeft——
   *  367 支逐枚掷 :46800） */
  spawnProj: ((x: number, y: number, vx: number, vy: number, projId: number, dmg: number,
    kb: number, extra?: { timeLeft?: number }) => void) | null = null;
  /** localAI[0]（AI_019 per-type 计数：130 七连拍 / 730 首拍一次性门） */
  private localAI0 = 0;
  /** 刺出方向（单位向量，原版出手时定死）——public 供 SpearDustCtx 结构化消费
   *  （spearPerTypeDust 模块级直读,曾 private 致 tsc TS2345/TS2341） */
  dx: number;
  dy: number;
  /** 原版 item.shootSpeed（velocity 模长——位移=offset×此值,勿当单位向量用） */
  spd: number;
  /** 出生帧乘上的 meleeSpeed 缩放——延伸盒 len ×= 1/meleeSpeed（Projectile.cs:47066
   *  `num4 ×= 1f/master.meleeSpeed`,meleeSpeed=M 倒数档 → 本仓存 1/attackSpeedMult=攻速和
   *  ★BJ640 旧式存 attackSpeedMult 本身=方向反;缺省 1 = 无缩放） */
  private spdMul = 1;
  t = 0;   // 已存活 tick（public 同 SpearDustCtx 消费口径）
  private dur: number;
  /** 型号伸缩参数 */
  private prm: [number, number, number];
  private hitCd = new HitCooldown();
  dead = false;
  // ---- Chain Guillotines 481（AI_013 锚定族专支,R30 §1/§8.4——3012 断头台链刀）----
  /** ai[0]：-1 未初始化 / 0 出程 / 1 返回（Projectile.cs:24957-25120） */
  private gA0 = -1;
  /** ai[1] 出程计数（>5 → alpha=255→0 显形;>8 钳 8=永不触发坠速支,:25014-25026） */
  private gA1 = 0;
  /** 显形门（原版 alpha 字段 255 起步,ai[1]>5 置 0——本仓布尔镜像供 draw 消费） */
  private gShown = false;
  // ---- ★通用湿段（Projectile.cs:16903-17113;2026-09-06 R3 漏网类批 11 类之一）----
  //  域 id 集 = SPEAR_PARAMS 全 21 型（46/47/49/64/66/97/105/130/153/212/215/218/222/
  //  342/367/368/730/877-879/1103）∪ RAPIER_PROJ 10 型（802/842/938-945）∪ 481。
  //  豁免核对（1457 SetDefaults 逐块脚本扫描+Range 块直读）：46(:1299)/49(:1322)/
  //  66(:1463)/130(:2194)/222(:3082) 均无 ignoreWater 行;877-879(:8432 Range 块
  //  DefaultToSpear)无;802(:7924)/938-945(:8919 Range 块 DefaultToShortsword)无;
  //  481(:5564)无;余 12 型同无（与 PROJ_IGNORE_WATER 270 id 零交集）→ 全员受段。
  //  ★阻尼 N/A 留锚：AI_019/161 全程 position 由 AI 直写（包络/短剑刺）,tileCollide=
  //  false（DefaultToSpear :10737/DefaultToShortsword :10158 关）→ HandleMovement 湿
  //  阻尼块 :17721 整体在 if(tileCollide) :17578 内不跑;UpdatePosition :20549 早退表
  //  虽不含 19/161,但 AI 每拍重写 position=玩家心+offset,积分位移零存活位 → 无阻尼/
  //  无湿位移消费面（ WetCollision 测位=AI 写位,溅花面照跑）。481 出膛 tileCollide=
  //  true（:5564 未关）→ 湿阻尼适用（guillotineStep 内接线）;返程 :25084 才关。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价——首子步 AI 写位后同位测值） */
  presetDone = false;   // ProjWetFlags.presetDone（共享湿段旗持有者）

  /** 通用湿段步进（projWetSection 共享体穿参壳——AI_019/161/481 三调用点共用;
   *  位序 = 原版 Update AI(:16880) → 湿段(:16903) → HandleMovement(:17120)） */
  private wetSectionStep(game: GameHooks): void {
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater);
  }

  constructor(dirX: number, dirY: number, spd: number, dur: number, damage: number, knockback: number, projId: number) {
    super();
    const n = Math.hypot(dirX, dirY) || 1;
    this.dx = dirX / n;
    this.dy = dirY / n;
    this.spd = spd || 2.4; // 兜底:提取表 shootSpeed 缺失(七金属短剑模板坑)时按短剑族 2.1-2.4 档
    this.dur = dur;
    this.damage = damage;
    this.knockback = knockback;
    this.projId = projId;
    this.prm = SPEAR_PARAMS[projId] ?? [3, 1.9, 2.1];
    const sz = SPEAR_SIZE[projId];
    if (sz) { this.w = sz[0]; this.h = sz[1]; } // 342 薄刃 22×2 等按型号
    // 802/842 出膛抖动（ItemCheck_Shoot :46700-46707）：向 ±π/8 旋转 + 速 ±0.7
    //（num8=π/4、NextFloat()−0.5 → [−π/8,+π/8];NextFloatDirection()×0.7 减速）
    if (RAPIER_JITTER_PROJ.has(projId)) {
      const ang = Math.atan2(this.dy, this.dx) + Math.PI / 4 * (Math.random() - 0.5);
      this.spd = Math.max(0, this.spd - (Math.random() * 2 - 1) * 0.7);
      this.dx = Math.cos(ang);
      this.dy = Math.sin(ang);
    }
  }

  draw(r: Renderer, cam: Camera): void {
    if (this.projId === 481 && this.gA0 >= 0) {
      // Chain Guillotines：链条在刀身下层（Main.cs DrawProjDirect 链先于弹体绘制）
      const ctx = r.ctx;
      if (ctx) this.drawChainGuillotine(r);
      drawProj(r, cam, this, this.projId, this.guillotineAngle(),
        '#A0A0B0', this.gShown ? 1 : 0, -1, false, true);
      return;
    }
    const isRap = RAPIER_PROJ.has(this.projId);
    const noQuarter = RAPIER_JITTER_PROJ.has(this.projId);
    const { ang, mirror } = spearDrawAngle(this.dx, this.dy, isRap, noQuarter);
    // Utils.GetLerpValue clamped(:44992):淡入 t/7(t≤7),淡出 (16-t)/4(t≥12)
    const aIn = Math.min(1, this.t / 7);
    const aOut = this.t <= 12 ? 1 : Math.max(0, (16 - this.t) / 4);
    // 绘制尺寸：投射物一律贴图原生尺寸（原版 SpriteBatch scale=1 语义）。
    // ★非细剑族曾 drawSize=0 → 取碰撞盒 w=18px,而三叉戟 47=70×70、圣骑矛 153=84×84、
    //   暗黑长枪 222=116×116 全被缩到 18px = "特别小"根因（2026-08-17 用户抓到）。
    //   细剑族 938-945 恰 32×32 沿用固定 32（等值无差）;jitter 族仍 -1 原生
    drawProj(r, cam, this, this.projId, ang,
      '#A0A0B0', isRap ? aIn * aOut : 1, isRap ? (noQuarter ? -1 : 32) : -1, mirror, isRap);
  }

  fixedUpdate(_dt: number, game: GameHooks) {
    if (this.dead) return;   // 已消亡不再推进（EntityManager compact 之外的直调防护）
    // 联机傀儡（远端弹幕快照驱动）：纯位移外推，不跑命中/碰撞（伤害归拥有者客户端结算）
    if (this.netPuppet) { this.netPuppetStep(); return; }
    const p = game.player;
    // melee 弹速 /meleeSpeed（ItemCheck_Shoot :47466-47468——长矛与短剑刺都不在
    // NoMeleeSpeedVelocityScaling 排除表 {699,707,877-879,985,973} 内,ProjectileID.cs:429——★BJ665 勘正 1456 伪锚 :337;
    // ★BJ640（2026-10-11）：原版此处 meleeSpeed 字段=CapAttackSpeeds 倒数档 M
    // （:26176 在 Update 每拍先翻转）——speed/=M=×攻速和。本仓 attackSpeedMult=M,
    // 旧式 ×am 方向反（+25% 矛速 ×0.8 变慢）,改 ÷am；延伸盒 spdMul 同源改存
    // 1/am（=原版 1/meleeSpeed 和,AI_019_Spears_GetExtensionHitbox :47066
    // `num4 ×= 1f/master.meleeSpeed` 消费 A=攻速和））。出生帧一次定型
    if (this.t === 0) {
      const am = (p as { attackSpeedMult?: number }).attackSpeedMult;
      if (am && am > 0 && am !== 1) { this.spd /= am; this.spdMul = 1 / am; }
    }
    if (RAPIER_PROJ.has(this.projId)) {
      // AI_161_RapierStabs(:44987-45004) + extraUpdates=1(DefaultToShortsword :10165;
      // Projectile.cs:16780-16783 numUpdates 循环——★BJ665 勘正 伪锚 :15331-15336)：每帧 2 个 AI 子步,16 步 8 帧跑完
      this.rapierStep(game);
      if (!this.dead) this.rapierStep(game);
      return;
    }
    if (this.projId === 481) {
      // Chain Guillotines（AI_013 锚定族,Projectile.cs:24957-25120 type==481 支）：
      // 自由飞行+链条回收,不走 AI_019 包络。extraUpdates 出程 1/返回 2
      // （:24958-24964）→ 每帧 2/3 个 AI 子步（Update :15336-15339 numUpdates 循环）
      this.guillotineStep(game);
      if (!this.dead) this.guillotineStep(game);
      if (!this.dead && this.gA0 === 1) this.guillotineStep(game); // 返回相第 3 子步
      return;
    }
    this.t++;
    if (this.t >= this.dur) { this.dead = true; return; }
    // AI_019 伸缩包络 1:1（:43441-43540）：
    //   itemAnimation 从 max 递减；伸出相占前 2/3（num5 增长），缩回相占后 1/3（num10 增长）
    const max = this.dur;
    const num3 = Math.floor(max / 3);
    const itemAnim = Math.max(0, max - this.t);
    const num4 = Math.min(itemAnim, num3);
    const num5 = itemAnim - num4;
    const num9 = (max - num3) - num5;
    const num10 = num3 - num4;
    const [n6, n7, n8] = this.prm;
    const offset = n6 + n7 * num9 - n8 * num10;
    this.x = p.cx - this.w / 2 + this.dx * offset * this.spd;
    this.y = p.cy - this.h / 2 + this.dy * offset * this.spd;
    // ---- AI_019 per-type 伴生弹（1458 Projectile.cs:46749-46802,R30 §3.2 落点清单 #8;
    //   本块曾只接 130/730——342/222/367 三类未申报缺口,2026-08-31 台账清偿）----
    //   原版 switch(type) 紧随 position += velocity×offset 之后、旋转/命中之前；
    //   弹心坐标 + 本弹当前速度（velocity=朝向×shootSpeed[÷meleeSpeed]，本仓 dx/dy×spd）
    //   flag = itemAnimation < itemAnimationMax/3（int 除法,:46720——缩回相才掷,单发闩
    //   localAI[0]=1 先于条件执行:CanHit 不成立也吞掉唯一掷次,1:1）
    const retractPhase = itemAnim < Math.floor(max / 3);
    if (this.spawnProj && (this.projId === 130 || this.projId === 730
      || this.projId === 342 || this.projId === 222 || this.projId === 367)) {
      if (this.projId === 130) {
        // 130 蘑菇矛：localAI[0]∈{0,4,…,24} 七连掷 131 孢子云（damage/3 整除,kb=0），
        // localAI[0] 每 tick 自增（:46750-46759）
        if (this.localAI0 % 4 === 0 && this.localAI0 <= 24) {
          this.spawnProj(this.cx, this.cy, this.dx * this.spd, this.dy * this.spd,
            131, Math.trunc(this.damage / 3), 0);
        }
        this.localAI0++;
      } else if (this.projId === 730 && this.localAI0 === 0) {
        // 730 风暴矛：首拍一次性掷 732 气旋——v×4、(int)(damage×1.6)、kb×0.5
        // （:46760-46768 localAI[0]==0 → 置 1 单发门）
        this.localAI0 = 1;
        this.spawnProj(this.cx, this.cy, this.dx * this.spd * 4, this.dy * this.spd * 4,
          732, Math.trunc(this.damage * 1.6), this.knockback * 0.5);
      } else if (this.projId === 342 && retractPhase && this.localAI0 === 0) {
        // 342 北极（:46769-46780）：缩回相一次性掷 343 雪花镖——v×2.4、伤满额、kb×0.85、
        // CanHit(玩家盒→弹体盒) 视线门;laned(localAI[0]=1) 在门判定前,失线即弃
        this.localAI0 = 1;
        const pl = p as unknown as { x: number; y: number; w: number; h: number };
        if (canHit(game.world.store, pl.x, pl.y, pl.w, pl.h, this.x, this.y, this.w, this.h)) {
          this.spawnProj(this.cx, this.cy, this.dx * this.spd * 2.4, this.dy * this.spd * 2.4,
            343, this.damage, this.knockback * 0.85);
        }
      } else if (this.projId === 222 && retractPhase && this.localAI0 === 0) {
        // 222 叶绿partisan（:46781-46789）：缩回相一次性掷 228 孢子云——速度原样（v 不乘）、
        // 伤/kb 满额（弹本体 tileCollide=false 缓浮毒云,vanilla-projectiles.json :228 档）
        this.localAI0 = 1;
        this.spawnProj(this.cx, this.cy, this.dx * this.spd, this.dy * this.spd,
          228, this.damage, this.knockback);
      } else if (this.projId === 367 && this.localAI0 === 0) {
        // 367 黑曜鱼叉（:46790-46801，无缩回相门）：Next(1,4)=1..3 枚 1107+rand(3)
        // 黑曜碎刃——vector=v;X×(0.7+r×0.6)/Y×(0.7+r×0.6)独立掷、整体×(0.8+r×0.4)、
        // 再 ×2 出手;(int)(damage×0.5)、kb=0、timeLeft=Next(30,150)（逐枚独立）
        this.localAI0 = 1;
        const nDarts = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < nDarts; i++) {
          const fX = 0.7 + Math.random() * 0.6;
          const fY = 0.7 + Math.random() * 0.6;
          const fG = 0.8 + Math.random() * 0.4;
          this.spawnProj(this.cx, this.cy,
            this.dx * this.spd * fX * fG * 2, this.dy * this.spd * fY * fG * 2,
            1107 + Math.floor(Math.random() * 3),
            Math.trunc(this.damage * 0.5), 0,
            { timeLeft: 30 + Math.floor(Math.random() * 120) });
        }
      }
    }
    // 前向延伸盒（AI_019_Spears_GetExtensionHitbox :47034-47073，仅 105/46/153 伸出相）
    const extBox = spearExtensionHitbox(this.projId, this.t, this.dur,
      this.cx, this.cy, this.dx, this.dy, this.spdMul);
    // CutTiles（Projectile.CutTiles aiStyle 19 支 :14176-14179）：CutTilesAt(extensionBox)
    // ——伸出相延伸盒扫杂草/瓦罐（弹体本体格在下方 hitCritters/命中管线外另行处理）
    if (extBox) {
      for (let ty = Math.floor(extBox.y / 16); ty <= Math.floor((extBox.y + extBox.h) / 16); ty++) {
        for (let tx = Math.floor(extBox.x / 16); tx <= Math.floor((extBox.x + extBox.w) / 16); tx++) {
          game.cutTile(tx, ty);
        }
      }
    }
    // 命中冷却 = 原版全局免疫档（R30 §3.1 P1）：AI_019/DefaultToSpear 不设
    // usesLocalNPCImmunity/localNPCHitCooldown → Damage_PVE 前置门
    // targetNPC.immune[owner]==0（Projectile.cs:12636）、命中落地缺省 immune[owner]=10
    // （:14183-14185）——刺出+缩回全程贴着敌盒（重叠窗可达 15-20t），免疫 10t 过期后
    // 同一矛对同一敌可再中（Dark Lance 一刺两跳是其对大体型目标的 DPS 身份）。
    // 此前 cooldown=9999 进 HitCooldown 即"永不再中"= 复击窗整体缺失。
    // ★161 细剑族同式（DefaultToShortsword 同样不设私账,:10158-10172）
    spearPerTypeDust(this, game);   // AI_019 尾段 per-type 拖尾尘（:46796-46920,R30 §3.2）
    // ---- 通用湿段（:16903-17113,AI 后/命中前——原版 Damage 管线 :17132 在湿段/
    //      HandleMovement 之后;AI_019 无位移面 → 湿段即 AI 后正位）----
    this.wetSectionStep(game);
    hitEnemies(this, game, this.hitCd, 10, this.dx > 0 ? 1 : -1, this.armorPen,
      undefined, undefined, true, extBox); // playerImmune 全局档（Enemy.iframes 10t）+延伸盒并入判定
  }

  /** AI_161 单个 AI 子步（:44989-45003）：ai[0]++ → Center=玩家心+velocity×(ai[0]−1)
   *  → ai[0]≥16 Kill（原版 Kill 步仍先落位再消亡——:44994 落位在 :44996 判死之前） */
  private rapierStep(game: GameHooks): void {
    this.t++;
    const p = game.player;
    this.x = p.cx - this.w / 2 + this.dx * this.spd * (this.t - 1);
    this.y = p.cy - this.h / 2 + this.dy * this.spd * (this.t - 1);
    if (this.t >= 16) { this.dead = true; return; }
    // CutTiles（Projectile.cs:15312-15319：Center 起 10px×scale 线段扫杂草/瓦罐——★BJ665 勘正 1456 伪锚 :14151-14155
    // ——细剑戳击可清障的机制本体，曾整段漏接 2026-08-13 报障修复）
    game.cutTile(Math.floor((this.cx + this.dx * 10) / 16), Math.floor((this.cy + this.dy * 10) / 16));
    // 通用湿段（:16903-17113,每【子步】各一次——extraUpdates=1 :10165 → numUpdates
    // 循环 :16781-17345 湿段在环内;AI 写位后=原版 post-AI 同位）
    this.wetSectionStep(game);
    hitEnemies(this, game, this.hitCd, 10, this.dx > 0 ? 1 : -1, this.armorPen,
      undefined, undefined, true); // 全局免疫档同 AI_019（见 fixedUpdate 注）——细剑刺 8 帧内重叠窗同样可复中
  }

  /** Chain Guillotines 481 单个 AI 子步（AI_013 type==481 支,1458 Projectile.cs:24957-25121;
   *  1456 同段 :24957-25120 行号锚）：
   *  出程（ai[0]==0）：距玩家 >525 → 转返回（:25004-25006）;ai[1]++、>5 显形、>8 钳 8
   *  （:25017-25029——钳 8 使共享 `ai[1]>=10 → vy+0.3` 坠速支结构性不可达,登记）。
   *  ★出程 tileCollide=true（SetDefaults :5563-5572 未关,真值仅返程置 false :25084）
   *  ——撞块走 AI_003/013 共享 HandleMovement 响应链 :19632-19665：
   *  Collision.HitTiles 尘 + SoundID 0 + ai[0]=1 转【回收】,且无速度反转（反转仅
   *  aiStyle 3/109）——2026-08-31 台账清偿:出程撞块截停进回收,不再全程穿墙。
   *  返回（ai[0]==1）：tileCollide=false 穿墙（:25084）;距玩家 <50 Kill（:25090-25092）;
   *  velocity = 朝玩家 ×20（:25095-25099）。命中敌 → Damage aiStyle13 支 ai[0]=1
   *  （:14226-14231）。位移 = 每子步 position += velocity（Update 积分序）。 */
  private guillotineStep(game: GameHooks): void {
    const p = game.player;
    this.owner481 = p;   // 绘制期玩家中心快照（链条锚）
    // :16870 wetVelocity 快照（逐子步 AI 前——返程湿位移消费,见下返程积分支）
    const preVx = this.vx, preVy = this.vy;
    if (this.gA0 < 0) {
      // 首子步出生：盒心=玩家中心（ItemCheck_Shoot 通用尾支 pointPosition）、初速=朝鼠标×shootSpeed
      this.gA0 = 0;
      this.x = p.cx - this.w / 2;
      this.y = p.cy - this.h / 2;
      this.vx = this.dx * this.spd;
      this.vy = this.dy * this.spd;
    }
    const pdx = p.cx - this.cx, pdy = p.cy - this.cy;
    const dist = Math.hypot(pdx, pdy);
    if (this.gA0 === 0) {
      if (dist > 525) this.gA0 = 1;              // :25004-25006 出程门
      this.gA1++;
      if (this.gA1 > 5) this.gShown = true;      // :25019-25021 alpha=255→0 显形
      if (this.gA1 > 8) this.gA1 = 8;            // :25026-25028 钳 8
    } else {
      if (dist < 50) { this.dead = true; return; }   // :25090-25092 近手 Kill
      this.vx = pdx / (dist || 1) * 20;              // :25095-25099 回收速度制
      this.vy = pdy / (dist || 1) * 20;
    }
    // 通用湿段（:16903-17113,每【子步】AI 后/位移前——出膛 EU=1(:24958-24964) →
    // 湿段在 numUpdates 环内逐子步跑;域注见类字段块）
    this.wetSectionStep(game);
    if (this.gA0 === 0) {
      // 出程实体碰撞通道（SetDefaults 未关 tileCollide→ 撞块即截停收刀;返程才关 :25084）
      // moveAndCollide 全 AABB 四缘+步进;stepUp 不参与（原版弹幕不调 StepUp）
      // ★水中位移阻尼（HandleMovement :17721-17764——出膛 tileCollide=true 适用）：
      //  速度场不减只削当拍位移（湿段批共享口径,Boomerang/Yoyo 同款）
      const dragG = projWaterDragFactor(this);
      const body = {
        x: this.x, y: this.y, w: this.w, h: this.h, vx: this.vx, vy: this.vy,
        onGround: false, hitWall: false, hitHead: false, collideY: false,
        hoik: true,   // ★FX34c 弹幕域 hoik=true（Body.hoik 注:原版 Projectile 全路径）
      };
      moveAndCollide(body, game.world, this.vx * dragG, this.vy * dragG);
      this.x = body.x; this.y = body.y;
      if (body.hitWall || body.hitHead || body.onGround || body.collideY) {
        // :19652-19654 默认档 HitTiles 尘 + :19664 SoundID 0 挖掘音（音尘一次）
        game.spawnParticles(this.cx, this.cy, '#A09080', 3, 1.5, { life: 14, size: 2 });
        game.playSfx('dig', 1, this.cx, this.cy);
        this.gA0 = 1;                            // :19658-19660 ai[0]=1——速度不反转
      }
    } else if (this.wet) {
      // 返程 tileCollide=false（:25084）→ 湿阻尼块不跑;UpdatePosition :20555-20562：
      // wet → position += wetVelocity（=本子步 AI 前快照,无阻尼——湿态返程位移滞后
      // 一子步 = 原版 quirk 本体,Boomerang/Yoyo 返程同款）
      this.x += preVx; this.y += preVy;
    } else {
      this.x += this.vx;
      this.y += this.vy;
    }
    // 命中结算（全局免疫 10t 同族;命中即转返回态）
    hitEnemies(this, game, this.hitCd, 10, this.dx > 0 ? 1 : -1, this.armorPen,
      () => { this.gA0 = 1; }, undefined, true);   // Damage aiStyle13 支 :14226-14231
  }

  /** 绘制角（AI_013 :24999/:25082）：出程 rotation=atan2(v)+1.57;返回=atan2(向玩家)−1.57 */
  private guillotineAngle(): number {
    if (this.gA0 === 1) {
      const p = this.owner481;
      const ang = p ? Math.atan2(p.cy - this.cy, p.cx - this.cx) : Math.atan2(this.vy, this.vx);
      return ang - Math.PI / 2;
    }
    return Math.atan2(this.vy, this.vx) + Math.PI / 2;
  }
  /** 玩家引用快照（绘制期取玩家中心用;fixedUpdate 每帧续约） */
  private owner481: { cx: number; cy: number } | null = null;

  /** Chain40 两段式链条（Main.cs:29795-29875 DrawProjDirect proj.type==481 支）：
   *  链起点 origin = 弹心 ∓ velocity×(4/|v|)（出程向速度反向偏 4px/返回相正向,:29804-29813）;
   *  逐节朝玩家中心步进 Chain40 高×0.85、旋转恒 atan2(臂−节)−1.57（:29819）;上限 999 节
   *  （num133,mannequin 展示档才限 3）。逐节 Lighting.GetColor 着色同链枷链条口径。
   *  终清波 1:1（Main.cs:29795-29920 全支）：链节【scale=0.85 绘制】+ 距离≤999 节
   *  主停门(num133 档)——无 d<stepLen 早退(正常局允许过冲叠节,原版同态);
   *  rotation20 单次定型(:29818-29822,步进共线故与逐节重算等价,保留单式防弯折漂移);
   *  玩家速度弯折调制(:29856-29875):当前距 > H×2 时按玩家 vx/vy 方向把步进向量对应
   *  分量 ×(1−num138)(num138=0.75×min(|playerV|,10)/10×clamp(dist/80,≤1)) ——链条随
   *  移动垂坠/拖尾的本体（曾整缺）。dist 基准恒 mountedCenter。 */
  private drawChainGuillotine(r: Renderer): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const img = chainImg('Chain40');
    if (!img || !(img.width > 0)) return;
    const pX = (this.owner481 as { cx?: number } | null)?.cx ?? this.cx;
    const pY = (this.owner481 as { cy?: number } | null)?.cy ?? this.cy;
    const pvx = (this.owner481 as { vx?: number } | null)?.vx ?? 0;   // player.velocity 弯折源
    const pvy = (this.owner481 as { vy?: number } | null)?.vy ?? 0;
    const vmag = Math.hypot(this.vx, this.vy) || 1;
    const off = 4 / vmag;
    const sgn = this.gA0 === 0 ? -1 : 1;             // :29804-29812 出程 −/返回 +
    let ox = this.cx + this.vx * off * sgn;
    let oy = this.cy + this.vy * off * sgn;
    const lighting = (r as unknown as { lighting?: { lightAt: (tx: number, ty: number) => [number, number, number] } | null }).lighting;
    const lightAt = (wx: number, wy: number): number => {
      if (!lighting) return 1;
      const [lr, lg, lb] = lighting.lightAt(Math.floor(wx / TILE), Math.floor(wy / TILE));
      return Math.min(1, (lr * 0.3 + lg * 0.5 + lb * 0.2) / 255);
    };
    let dx = pX - ox, dy = pY - oy;                  // :29813-29816 x7/y7 初值
    const rot20 = Math.atan2(dy, dx) - 1.57;         // 循环外一次定型(:29817)
    const linkH = img.height;                        // TextureAssets.Chain40.Height()
    for (let n134 = 1; n134 <= 999; n134++) {        // num133>0 && num134>num133 → break
      const num136raw = Math.hypot(pX - ox, pY - oy);// origin6.Distance(mountedCenter)(:29830)
      const num137 = num136raw;                      // 预步距离（弯折门用）
      if (!Number.isFinite(num136raw) || (dx === 0 && dy === 0)) break;  // NaN/零向量门(:29838)
      const f = (linkH * 0.85) / num136raw;          // 步长 = H×0.85 的比例推进(:29840)
      ox += dx * f;
      oy += dy * f;
      dx = pX - ox;                                  // 重算臂向(:29843-29844)
      dy = pY - oy;
      if (num137 > linkH * 2) {                      // 玩家速度弯折调制(:29856-29874)
        for (let b = 0; b < 2; b++) {
          let num138 = 0.75;
          let vel = b === 0 ? Math.abs(pvx) : Math.abs(pvy);
          if (vel > 10) vel = 10;
          num138 *= vel / 10;
          let distF = num137 / 80;
          if (distF > 1) distF = 1;
          num138 *= distF;
          if (b === 0) {
            if ((pvx < 0 && this.cx < pX) || (pvx > 0 && this.cx > pX)) dy *= 1 - num138;
          } else {
            if ((pvy < 0 && this.cy < pY) || (pvy > 0 && this.cy > pY)) dx *= 1 - num138;
          }
        }
      }
      ctx.save();
      ctx.translate(ox, oy);
      ctx.rotate(rot20);                             // EntitySpriteDraw(rotation20)(:29907)
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = lightAt(ox, oy);
      const s = 0.85;                                // num135 恒 0.85(:29828)——绘制缩放
      ctx.drawImage(img, -(img.width * s) / 2, -(linkH * s) / 2, img.width * s, linkH * s);
      ctx.restore();
    }
  }
}

// ================= 锚定族（aiStyle 13,AI_013,1458 Projectile.cs:24928-25121） =================
// 四件:23 鱼叉(物品160)/262 石巨人之拳(1297)/271 KO加农(1314)/273 链刀(1325)。
// 481 断头台链刃(3012)不走本类——已在 SpearProj 内专支(R30 §1,行为已对拍锁定)。
// 状态机(每型号差异入 ANCHORED_PROJ 表):
//   出膛 ai0=0:恒速直线;超射程门(:24987-25005)→转返回;ai[1]>5 显形(alpha255→0);
//     23 无 ai[1] 钳→ai[1]>=17 重力弧 vy+=0.6/vx*=0.995(:25027-25033);
//     262/271/273 ai[1] 钳 8=永不坠速(:25011-25026)
//   返回 ai0=1:tileCollide=false 穿墙(:25081);速度=朝玩家×retSpeed(262=30,:25076-25079);
//     距玩家<50 Kill(:25087);262 spriteDirection 反相(:25096-25101)
//   三触发:撞块(:19627-19663 aiStyle13 支→HitTiles 尘+Sound0+ai0=1)/
//     命中 NPC(Damage_PVE_Inner :14223-14229→ai0=1;23 特支 penetrate3 次才回收 :14213-14224)/
//     玩家死亡或距>2000 Kill(:24929-24940)
export interface AnchoredParams {
  w: number; h: number;
  maxDist: number;          // 出膛回收距离门(:24989-25004)
  retSpeed: number;         // 回收制速(:25077-25079)
  cap8: boolean;            // ai[1] 钳 8(禁坠速支)
  chainTex: string;         // 链索贴图(Main.cs DrawProjDirect 各型支)
  drawScale?: number;       // 弹体贴图 scale(271 SetDefaults scale=1.2)
  boom?: boolean;           // 262 返回起手 200×200 一帧冲击盒+Item14(:25064-25074/:15057)
}
const ANCHORED_PROJ: Record<number, AnchoredParams> = {
  // Projectile.cs:1059-1067(4×4,penetrate=3,ranged,usesLocalNPCImmunity cd12)
  23: { w: 4, h: 4, maxDist: 1000, retSpeed: 20, cap8: false, chainTex: 'Chain' },
  // :3465-3474(30×30,extraUpdates=1,melee)
  262: { w: 30, h: 30, maxDist: 500, retSpeed: 30, cap8: true, chainTex: 'Chain22', boom: true },
  // :3569-3576(20×20,scale1.2,melee)
  271: { w: 20, h: 20, maxDist: 200, retSpeed: 20, cap8: true, chainTex: 'Chain18', drawScale: 1.2 },
  // :3590-3597(26×26,melee);maxDist remix 世界 300(:25005 Main.remixWorld 门)
  273: { w: 26, h: 26, maxDist: 150, retSpeed: 20, cap8: true, chainTex: 'Chain23' },
};
/** 同型在场门（SetDummyItemTime(5) 每 tick 续期 :24942-24947——itemTime>0 阻再用,
 *  效果 = 拳未回手不能再次开火;481 不设此门故不在本类）。Game 发射前查 */
export function anchoredActive(projectiles: readonly unknown[], projId: number): boolean {
  return projectiles.some((e) => e instanceof AnchoredProj && e.projId === projId && !e.dead);
}

export class AnchoredProj extends Entity {
  w: number;
  h: number;
  damage: number;
  knockback: number;
  projId: number;
  /** GetWeaponCrit 合并值（Game 侧传入） */
  critChance = 0.04;
  /** ⑥ 护甲穿透（Game 注入） */
  armorPen = 0;
  /** 近战系（吃武器浸剂）——23 鱼叉原版 ranged=true 不吃近战浸剂 */
  meleeProj: boolean;
  tileCollide = true;
  /** ★FX34c 弹幕域 hoik=true（Body.hoik 注:原版 Projectile 全路径 true） */
  hoik = true;
  private prm: AnchoredParams;
  /** ai[0]:-1 未出生 / 0 出膛 / 1 返回 */
  a0 = -1;
  /** ai[1] 出膛计数 */
  private a1 = 0;
  /** 显形镜像（alpha 255→0,a1>5） */
  shown = false;
  /** localAI[0]:0 未爆 / 200 冲击盒待消费 / -1 已消费或豁免(:15057 Damage_GetHitbox) */
  private localA0 = 0;
  /** 23 鱼叉穿透计数(penetrate=3,Damage_PVE_Inner :14199-14210 泛式自减) */
  private hits = 0;
  /** 23 出膛重力弧计数(ai[1]>=17 起 vy+=0.6/vx*=0.995) */
  private gravT = 0;
  private hitCd = new HitCooldown();
  /** 绘制期玩家中心快照（链条锚,fixedUpdate 续约） */
  private owner: { cx: number; cy: number } | null = null;
  /** 23 鱼叉链摆荡记忆（proj.localAI[1]/[2]——Main.cs 绘制层每帧更新,
   *  :30002-30009 出膛 lerp(−v)/2 / 回收 (v+prev×4)/5;仅 drawChain 消费) */
  private localA1 = 0;
  private localA2 = 0;
  // ---- ★通用湿段（Projectile.cs:16903-17113;2026-09-06 R3 漏网类批 11 类之一）----
  //  域 id 集 = {23 鱼叉(:1060)/262 石巨人之拳(:3466)/271 KO加农(:3570)/273 链刀(:3591)}
  //  ——SetDefaults 四块均无 ignoreWater 行（缺省 false :763;与 PROJ_IGNORE_WATER 零
  //  交集）→ 全员受段。
  //  ★位序定谳：AI_013（:24928-25121）全程只写 velocity/ai 不写 position → 湿段
  //  WetCollision 测位 = 上拍位移后位 = tick 头位,两插位（AI 后/tick 头）同位等价;
  //  本仓 AI 与位移在 fixedUpdate 内连排（类结构无法拆）→ 置 tick 头（出生块后）,
  //  AI 内 Kill 位（p.dead/超远/近手）湿段已跑 = 原版"AI-Kill 拍湿段照跑"（:16903
  //  无 active 门）等价覆盖。类注记：本类 AI 无湿旗消费者（收编后成立）→ tick 头
  //  插位无同拍旗读问题（projWetSection.ts 文件头"tick 头调用"豁免条款）。
  //  ★阻尼：出膛 tileCollide=true 缺省（四块均未关）→ 湿阻尼适用（moveAndCollide
  //  位移入参）;返程 :25084 置 false → 阻尼块不跑,湿位移 = UpdatePosition :20555
  //  wet → position += wetVelocity（AI 前快照,滞后一子步 quirk——返程积分支实现）。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价——首拍出生块写位后同位测值） */
  presetDone = false;   // ProjWetFlags.presetDone（共享湿段旗持有者）

  constructor(dirX: number, dirY: number, spd: number, damage: number, knockback: number, projId: number) {
    super();
    const n = Math.hypot(dirX, dirY) || 1;
    this.prm = ANCHORED_PROJ[projId] ?? ANCHORED_PROJ[262];
    this.w = this.prm.w; this.h = this.prm.h;
    this.projId = projId;
    this.damage = damage;
    this.knockback = knockback;
    this.meleeProj = projId !== 23;
    // 初速 = 朝鼠标单位向 × shootSpeed(出膛恒速,首子步落位玩家中心)
    this.vx = dirX / n * spd;
    this.vy = dirY / n * spd;
    this.spawnSpd = spd;
    // 出生态 ai[0]=-1 → 首子步置 0 并落位(与 481 模板同构)
    this.a0 = -1;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.dead) return;
    if (this.netPuppet) { this.netPuppetStep(); return; }
    this.hitCd.tick();   // 逐敌私账冷却递减(23 localNPCHitCooldown=12 到期可复中)
    const p = game.player;
    const prm = this.prm;
    if (!prm) { this.dead = true; return; }
    // :16870 wetVelocity 快照（AI 前——返程湿位移消费,见下返程积分支）
    const preVx = this.vx, preVy = this.vy;
    if (this.a0 < 0) {
      this.a0 = 0;
      this.x = p.cx - this.w / 2;
      this.y = p.cy - this.h / 2;
    }
    this.owner = p;
    // ---- 通用湿段（:16903-17113,projWetSection 共享体 1:1——四液旗/出入水溅花/
    //      wetCount;tick 头插位定谳见字段块注。出生块后=首拍测出生位 ✓）----
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater);
    // 玩家死亡/超远Kill(:24929-24940)
    const pdx = p.cx - this.cx, pdy = p.cy - this.cy;
    let dist = Math.hypot(pdx, pdy);
    if (p.dead || dist > 2000) { this.dead = true; return; }
    // 显形后玩家面向弹体(:24949-24958 alpha==0 → ChangeDir)
    if (this.shown) p.facing = this.cx >= p.cx ? 1 : -1;
    if (this.a0 === 0) {
      // 超程回收门(:24987-25005;273 remix 世界 300——:25005 Main.remixWorld 门)
      const remix = !!(game.world as unknown as { seedFlags?: { remix?: boolean } } | undefined)?.seedFlags?.remix;
      const maxDist = this.projId === 273 && remix ? 300 : prm.maxDist;
      if (dist > maxDist) this.a0 = 1;
      this.a1++;
      if (this.a1 > 5) this.shown = true;               // :25016-25018 alpha=0 显形
      if (prm.cap8 && this.a1 > 8) this.a1 = 8;         // :25023-25026 钳 8
      if (!prm.cap8) {
        // 23 重力弧(:25027-25033):ai[1]>=17 → vy+=0.6,vx*=0.995
        this.gravT++;
        if (this.gravT >= 17) { this.vy += 0.6; this.vx *= 0.995; }
      }
      // 位移+撞块(HandleMovement :19627-19663):HitTiles 尘+Sound0+ai0=1;23 先 velocity*=0
      // ★水中位移阻尼（HandleMovement :17721-17764——出膛 tileCollide=true 适用）：
      //  速度场不减只削当拍位移（湿段批共享口径）
      if (this.tileCollide) {
        const dragA = projWaterDragFactor(this);
        moveAndCollide(this, game.world, this.vx * dragA, this.vy * dragA);
        if (this.hitWall || this.hitHead || this.onGround) {
          if (this.projId === 23) { this.vx = 0; this.vy = 0; }
          this.tileCollide = false;
          this.a0 = 1;
          game.spawnParticles(this.cx, this.cy, '#A09080', 3, 1.5, { life: 14, size: 2 });
          game.playSfx('dig', 1, this.cx, this.cy);
        }
      } else {
        this.x += this.vx; this.y += this.vy;
      }
      dist = Math.hypot(p.cx - this.cx, p.cy - this.cy);
      // 旋转(:25006-25008 rotation=atan2(v)+1.57 在 draw 侧求值)
    }
    if (this.a0 === 1) {
      // 返回相当帧重算玩家向量(出膛末位移后落位为准)
      const rdx = p.cx - this.cx, rdy = p.cy - this.cy;
      const rdist = Math.hypot(rdx, rdy);
      // 262 返回起手冲击(:25064-25074):localAI[0]==0 → dist<150 豁免(-1),
      // 否则 localAI[0]=200 + HitTilesInACircle + Item14;下一伤害查询消费 200×200 盒(:15057)
      if (this.localA0 === 0) {
        if (prm.boom) {
          if (rdist < 150) {
            this.localA0 = -1;
          } else {
            // 1458 P.cs:25054-25071:num117=200、vector13=position−num117/2(盒左上)、
            // HitTilesInACircle(vector13,velocity,200,200)+SoundID.Item14(:25068——
            // 曾误播合成 'explosion',音频 B 类修正)
            const num117 = 200;
            this.localA0 = num117;
            this.hitTilesInCircle(game, this.x - num117 / 2, this.y - num117 / 2,
              this.vx, this.vy, num117);
            game.playSfxFile?.('Item_14', 1, this.cx, this.cy);
            // 一帧 200×200 冲击盒(Damage_GetHitbox :15057-15061 缩点 Inflate(localAI0/2))
            hitEnemies(this, game, this.hitCd, 9999, this.vx > 0 ? 1 : -1, this.armorPen,
              undefined, undefined, true,
              { x: this.cx - 100, y: this.cy - 100, w: 200, h: 200 });
            this.localA0 = -1;
          }
        } else {
          this.localA0 = -1;
        }
      }
      // 穿墙回收(:25081 tileCollide=false)+制速朝玩家(:25082-25096)
      this.tileCollide = false;
      const sp = prm.retSpeed;
      const n = rdist || 1;
      this.vx = rdx / n * sp;
      this.vy = rdy / n * sp;
      // 返程湿位移（UpdatePosition :20555-20562）：tileCollide=false → 湿阻尼块不跑,
      // wet → position += wetVelocity（tick 头快照 preVx/preVy,无阻尼——滞后一子步
      // quirk 本体,Boomerang/Yoyo 返程同款）;dry → position += velocity（post-AI）
      if (this.wet) { this.x += preVx; this.y += preVy; }
      else { this.x += this.vx; this.y += this.vy; }
      if (rdist < 50) { this.dead = true; return; }      // :25087-25089 近手 Kill
    }
    // 命中结算:
    //   23 = 私账 12t(usesLocalNPCImmunity/localNPCHitCooldown=12,:1066-1067)+
    //     penetrate=3 次后才回收(:14213-14224)
    //   262/271/273 = 全局免疫档(playerImmune,DefaultTo 族无私账)+命中即回收(:14226-14229)
    if (this.projId === 23) {
      hitEnemies(this, game, this.hitCd, 12, this.vx > 0 ? 1 : -1, this.armorPen,
        () => {
          this.hits++;
          if (this.hits >= 3) this.a0 = 1;   // 第 3 击 velocity*=0+penetrate=-1+ai0=1(等价)
        }, undefined, false);
    } else {
      hitEnemies(this, game, this.hitCd, 10, this.vx > 0 ? 1 : -1, this.armorPen,
        () => { this.a0 = 1; }, undefined, true);
    }
  }

  /** Collision.HitTilesInACircle 薄壳（几何 1:1 已收敛进模块级 hitTilesInACircleFx——
   *  Position=盒左上/Velocity 偏移/boxSize=边长;262 回收冲击与 Boomerang 383 撞墙圈共用） */
  private hitTilesInCircle(game: GameHooks, px: number, py: number, vx0: number, vy0: number, boxSize: number): void {
    hitTilesInACircleFx(game, px, py, vx0, vy0, boxSize);
  }

  draw(r: Renderer, cam: Camera): void {
    if (this.a0 < 0) return;   // 未出生不画
    // 链条在弹体下层(Main.cs DrawProjDirect 链先于本体)
    this.drawChain(r);
    // 本体角(:25006-25007 出膛 atan2(v)+1.57 / :25082 返回 atan2(向玩家)-1.57);
    // spriteDirection:262 出膛 vx<0?-1:+1(:25041-25046)/返回反相(:25096-25101);
    // 271 同式;23/273 无 sd 支(贴图对称)。alpha:a1>5 前 255(隐形)
    const p = this.owner;
    const out = this.a0 === 0;
    const ang = out
      ? Math.atan2(this.vy, this.vx) + Math.PI / 2
      : Math.atan2((p?.cy ?? this.cy) - this.cy, (p?.cx ?? this.cx) - this.cx) - Math.PI / 2;
    const sdFlip = (this.projId === 262 || this.projId === 271)
      ? ((out ? this.vx < 0 : this.vx > 0) ? -1 : 1)
      : 0;
    const e = this as unknown as { facing?: number };
    e.facing = sdFlip;
    drawProj(r, cam, this, this.projId, ang, '#B0B0C0', this.shown ? 1 : 0, -1, sdFlip < 0, false,
      this.prm.drawScale ?? 1);
  }

  /** 玩家→拳链索(Main.cs DrawProjDirect 各型支,1458 行号锚):
   *  262 :29688-29735 Chain22 / 273 :29736-29794 Chain23 / 271 :29924-29960 Chain18 /
   *  aiStyle13 兜底组 :29961-30175 TextureAssets.Chain（在 1458 内覆盖 type==23,
   *  因 262/273/271/481 已被前方专支截流）。各型起锚/系数:
   *   · 262/273/271 = 弹心 ∓ v×(4/|v|)、步长 12、停 <25、rot 单次定型 atan2−1.57
   *     （循环内仅位置推进——与单次定角逐数值等价：臂点固定+步进共线）
   *   · 23 兜底支专有几何（终清波从"统一 4/|v| 中心式"近似转正）：
   *     起锚 = position+(8,2)；出膛系数 40/|v|（其余型 20/|v|）；符号按 ai[0];
   *     localAI[1..2] 摆荡记忆（每渲染帧更新：出膛 lerp(−v)/(2)、回收 (v+prev×4)/5）；
     *     臂端向链首回拉钳 20px；rot 计算前链首回退半步(dist/2)；环内 dist>12 时
   *     rotation 与摆荡向量按 num149=clamp(dist/1000≤0.5) 插值(:30049-30062)
   */
  private drawChain(r: Renderer): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const img = chainImg(this.prm.chainTex);
    if (!img || !(img.width > 0)) return;
    const vmagRaw = Math.hypot(this.vx, this.vy);
    const lighting = (r as unknown as { lighting?: { lightAt: (tx: number, ty: number) => [number, number, number] } | null }).lighting;
    const lightAt = (wx: number, wy: number): number => {
      if (!lighting) return 1;
      const [lr, lg, lb] = lighting.lightAt(Math.floor(wx / TILE), Math.floor(wy / TILE));
      return Math.min(1, (lr * 0.3 + lg * 0.5 + lb * 0.2) / 255);
    };
    if (this.projId === 23) {
      // ---- 23 鱼叉兜底支 1:1（:29961-30175）----
      if (!this.netPuppet && !Number.isNaN(this.vx) && !Number.isNaN(this.vy)) {
        if (this.a0 === 0) {
          this.localA1 = (-this.vx + this.localA1) / 2;       // 出膛：lerp −velocity(:30002-30004)
          this.localA2 = (-this.vy + this.localA2) / 2;
        } else {
          this.localA1 = (this.vx + this.localA1 * 4) / 5;    // 回收：(v + prev×4)/5(:30006-30009)
          this.localA2 = (this.vy + this.localA2 * 4) / 5;
        }
      }
      const vmag = vmagRaw || 0.0001;                         // 双零速度 → 0.0001f 兜底(:29980-29984)
      const sgn = this.a0 === 0 ? -1 : 1;
      let ox = this.x + 8 + this.vx * (sgn * 40 / vmag);      // 起锚=position+(8,2)、type23 系数 40/|v|
      let oy = this.y + 2 + this.vy * (sgn * 40 / vmag);      // (:29987-29994 出膛−/回收+)
      let armX = this.owner?.cx ?? this.cx;
      let armY = this.owner?.cy ?? this.cy;
      // 臂端回拉：vector32 = vector31 − mountedCenter，|·|>20 → 单位向 ×20 并入臂端(:29998-30003)
      {
        const vx32 = ox - armX, vy32 = oy - armY;
        const len32 = Math.hypot(vx32, vy32);
        if (len32 > 20) {
          armX += vx32 / len32 * 20;
          armY += vy32 / len32 * 20;
        }
      }
      // 半步退（:30014-30021）：x10=臂−链首、12/|·| 后 vector31 -= 半步——链首【远离】臂 6px
      let bx = armX - ox, by = armY - oy;
      {
        const k0 = 12 / (Math.hypot(bx, by) || 1e-9);
        ox -= bx * k0 * 0.5;
        oy -= by * k0 * 0.5;
        bx = armX - ox; by = armY - oy;
      }
      let rot = Math.atan2(by, bx) - Math.PI / 2;             // :30024-30026 初次定型
      for (;;) {
        const dist = Math.hypot(bx, by);
        if (!Number.isFinite(dist) || dist < 25) break;       // :30034-30042 停门/NaN 门
        const prevDist = dist;                                // num148（插值用的预步距）
        const k = 12 / prevDist;
        ox += bx * k; oy += by * k;                           // 步进 12px(:30043-30044)
        bx = armX - ox; by = armY - oy;
        if (prevDist > 12) {
          // 摆荡插值(:30047-30062)：向量 = 臂向×(1−n) + 摆荡向×(n)，两者归一后统一缩放
          // 到臂向长度；覆写后的 (bx,by) 会作为下一拍的步进方向 → 链条 whip 弯曲本体
          let n149 = prevDist / 1000;
          if (n149 > 0.5) n149 = 0.5;
          const vx33 = armX - ox, vy33 = armY - oy;
          const l33 = Math.hypot(vx33, vy33) || 1;
          const swl = Math.hypot(this.localA1, this.localA2) || 1;
          const nx = ((vx33 / l33) * l33) * (1 - n149) + ((this.localA1 / swl) * l33) * n149;
          const ny = ((vy33 / l33) * l33) * (1 - n149) + ((this.localA2 / swl) * l33) * n149;
          bx = nx; by = ny;
          rot = Math.atan2(ny, nx) - Math.PI / 2;
        }
        ctx.save();
        ctx.translate(ox, oy);
        ctx.rotate(rot);                                      // 非插值拍沿用上次 rot(:30064-30067)
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = lightAt(ox, oy);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        ctx.restore();
      }
      return;
    }
    // ---- 262/271/273 专支共同几何（中心起锚 4/|v|,停 <25,步 12,rot 定型等价）----
    const vmag = vmagRaw || 1;
    const off = 4 / vmag;
    const sgn = this.a0 === 0 ? -1 : 1;
    let ox = this.cx + this.vx * off * sgn;
    let oy = this.cy + this.vy * off * sgn;
    const armX = this.owner?.cx ?? this.cx;
    const armY = this.owner?.cy ?? this.cy;
    for (let i = 0; i < 999; i++) {
      const dx = armX - ox, dy = armY - oy;
      const d = Math.hypot(dx, dy);
      if (!Number.isFinite(d) || d < 25) break;               // :29722/:29759 停门
      const k = 12 / d;
      ox += dx * k; oy += dy * k;
      ctx.save();
      ctx.translate(ox, oy);
      ctx.rotate(Math.atan2(armY - oy, armX - ox) - Math.PI / 2);
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = lightAt(ox, oy);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore();
    }
  }

  /** 出生速度模长(Game 注入——构造后写,首子步消费) */
  spawnSpd = 14;
}

// ---- AI_019 尾段 per-type 拖尾尘（1458 Projectile.cs:46796-46920,R30 §3.2 P1）----
// 真值表（每 AI tick 一次;v = (dx,dy)×spd 弹速向量;dir = direction=玩家朝向）：
//  46 Dark Lance:Next(5)==0 → d14(alpha150,scale1.4) + d27(v×0.2+dir×3,alpha100,
//    scale1.2,noGravity,v÷2) + d27@(pos−v×2,alpha150,scale1.4,v÷5)——紫黑焰拖尾本体
//  105 Gungnir:  Next(3)==0 → d57(v×0.2,alpha200,scale1.2,+v×0.3 再 ×0.2)
//                Next(4)==0 → d43(alpha254,scale0.3,+v×0.5 再 ×0.5)
//  153 Rotted Fork:每 tick d115@(pos−v×3,v×0.4,alpha140,noGravity,fadeIn1.25,×0.25)
//  342 North Pole:AddLight(0.65,0.9,1) 属 R18 光照域不接;timeLeft%2==0 →
//                d135@(pos−v×3 外扩10盒,v×0.4,alpha50,scale1.2,×0.5 再 +v×0.25)
//  1103:         Next(3)==0 → d4@(pos−v×8,v,alpha84,color(78,136,255,127),
//                scale1+r×0.3,+v×0.5;3/4→×0.7,noGravity,scale+0.2 / 否则 ×0.3,−0.5)
//  730 Thunder Spear:Next(5)==0 → d226(alpha150,scale0.7,noGravity,×1.4)
//                Next(5)==0 → d226(alpha150,scale0.5,vy−0.5)
// ★防过度实现备案（红队修法要点表勘误）：130 蘑菇/222 叶绿/367 黑曜三型在原版该段
// 是【伴生弹生成支】（131 孢子弹七连/228 孢子云/1107+rand3 飞刀,:46737-46790）,
// 【无拖尾尘】——勿按"补齐全族尘"造行为。877-879 的玩家速度门尘随物品
// （4788-4790）注册批再接。47 三叉戟的湿身尘在弹头 switch 段且以【玩家盒】为掷域
// （:46731-46738 player.wet 门）,一并收进本表。
type SpearDustCtx = {
  projId: number; x: number; y: number; w: number; h: number;
  dx: number; dy: number; spd: number; t: number;
};
const SPEAR_DUST: Record<number, (s: SpearDustCtx, game: GameHooks, dir: number) => void> = {
  46: (s, game, dir) => {
    const vx = s.dx * s.spd, vy = s.dy * s.spd;
    if (Math.floor(Math.random() * 5) === 0) {
      game.spawnDust?.(s.x, s.y, s.w, s.h, 14, 0, 0, 150, null, 1.4);
    }
    const a = game.spawnDust?.(s.x, s.y, s.w, s.h, 27,
      vx * 0.2 + dir * 3, vy * 0.2, 100, null, 1.2);
    if (a) { a.noGravity = true; a.vx /= 2; a.vy /= 2; }
    const b = game.spawnDust?.(s.x - vx * 2, s.y - vy * 2, s.w, s.h, 27, 0, 0, 150, null, 1.4);
    if (b) { b.vx /= 5; b.vy /= 5; }
  },
  105: (s, game) => {
    const vx = s.dx * s.spd, vy = s.dy * s.spd;
    if (Math.floor(Math.random() * 3) === 0) {
      const d = game.spawnDust?.(s.x, s.y, s.w, s.h, 57, vx * 0.2, vy * 0.2, 200, null, 1.2);
      if (d) { d.vx += vx * 0.3; d.vy += vy * 0.3; d.vx *= 0.2; d.vy *= 0.2; }
    }
    if (Math.floor(Math.random() * 4) === 0) {
      const d = game.spawnDust?.(s.x, s.y, s.w, s.h, 43, 0, 0, 254, null, 0.3);
      if (d) { d.vx += vx * 0.5; d.vy += vy * 0.5; d.vx *= 0.5; d.vy *= 0.5; }
    }
  },
  153: (s, game) => {
    const vx = s.dx * s.spd, vy = s.dy * s.spd;
    const d = game.spawnDust?.(s.x - vx * 3, s.y - vy * 3, s.w, s.h, 115,
      vx * 0.4, vy * 0.4, 140);
    if (d) { d.noGravity = true; d.fadeIn = 1.25; d.vx *= 0.25; d.vy *= 0.25; }
  },
  342: (s, game) => {
    if (s.t % 2 !== 0) return;              // timeLeft%2==0 门（:46879,节拍等价）
    const vx = s.dx * s.spd, vy = s.dy * s.spd;
    const d = game.spawnDust?.(s.x - vx * 3 - 10, s.y - vy * 3 - 10, s.w + 20, s.h + 20, 135,
      vx * 0.4, vy * 0.4, 50, null, 1.2);
    if (d) { d.vx *= 0.5; d.vy *= 0.5; d.vx += vx * 0.25; d.vy += vy * 0.25; }
  },
  1103: (s, game) => {
    if (Math.floor(Math.random() * 3) !== 0) return;
    const vx = s.dx * s.spd, vy = s.dy * s.spd;
    const d = game.spawnDust?.(s.x - vx * 8, s.y - vy * 8, s.w, s.h, 4,
      vx, vy, 84, { r: 78, g: 136, b: 255, a: 127 }, 1 + Math.random() * 0.3);
    if (!d) return;
    d.vx += vx * 0.5; d.vy += vy * 0.5;
    if (Math.floor(Math.random() * 4) !== 0) { d.vx *= 0.7; d.vy *= 0.7; d.noGravity = true; d.scale += 0.2; }
    else { d.vx *= 0.3; d.vy *= 0.3; d.scale -= 0.5; }
  },
  730: (s, game) => {
    if (Math.floor(Math.random() * 5) === 0) {
      const d = game.spawnDust?.(s.x, s.y, s.w, s.h, 226, 0, 0, 150, null, 0.7);
      if (d) { d.noGravity = true; d.vx *= 1.4; d.vy *= 1.4; }
    }
    if (Math.floor(Math.random() * 5) === 0) {
      const d = game.spawnDust?.(s.x, s.y, s.w, s.h, 226, 0, 0, 150, null, 0.5);
      if (d) d.vy -= 0.5;
    }
  },
  47: (s, game) => {
    // 三叉戟湿身水花（:46731-46738）：player.wet && Next(2)==0 → d15 @【玩家盒】,
    // alpha100、scale0.8、v×0.1——掷域是玩家不是弹体（玩家冲浪刺鱼的可视签名;
    // 本仓 Player 湿身旗 = inWater）
    const p = game.player as unknown as { x: number; y: number; w: number; h: number; inWater?: boolean };
    if (!p.inWater || Math.floor(Math.random() * 2) !== 0) return;
    const d = game.spawnDust?.(p.x, p.y, p.w, p.h, 15, 0, 0, 100, null, 0.8);
    if (d) { d.vx *= 0.1; d.vy *= 0.1; }
  },
};

/** SPEAR_DUST 消费入口（fixedUpdate 每 tick 调一次；表外型号原版无尘=正确不作为） */
function spearPerTypeDust(s: SpearProj, game: GameHooks): void {
  const fn = SPEAR_DUST[s.projId];
  if (!fn) return;
  fn(s, game, (game.player.facing ?? (s.dx > 0 ? 1 : -1)) >= 0 ? 1 : -1); // direction=玩家朝向(:46712)
}

// ================= 燃烧瓶（proj 399 aiStyle 68；Molotov 2590→399，Kill 链 :75347-75383） =================
// 弹跳物理（★MAJOR-3 2026-09-02 J′：ai[0]>=15 才起重力 0.2/t + 摩擦 0.99——
// :30672-30676 同支内两式,15 拍前【零改速】;旧码 15 拍前自造 0.1 重力+无条件摩擦
// = 出生即下坠打滑,与本注自相矛盾处一并更正）;死亡（撞块/命中/入水/期满）→
// 6 朵火云 400+rand3（:75370-75382：散布 ±8/上抛，伤 ×0.5，火云=aiStyle 14 弹跳穿透 3、
// 360t、命中 OnFire 3-6s :10850-10852）
// ★T2 清偿（2026-09-02,原"登记不修"升格）:飞行火焰尾迹——原版 AI_068 :30655-30692,
// alpha==0 门（ai[0]>=3 起 −40/t → 第 9 拍归零）后每拍 1×d6 火尘:锚=Center+
// spinningpoint2(±4,−8)−One×5、4×4 盒,scale1.5/noGravity,velocity=抖动×0.25+
// 单位(spinningpoint2) 再整体 RotatedBy(−π/2×direction)。spinningpoint2 随原版
// rotation（每拍 +=0.25×direction）旋转——本类补 rotation/direction 镜像字段供尘锚
// （direction=原版 AutomaticallyChangesDirection 每拍 HandleMovement 后按
// velocity.X 定号 :17121-17127,<0 取 −1 否则 1）。
// ★MINOR-3/4（2026-09-02 J′）：draw 改 rotation 绘制+alpha 淡入
// （Main.cs:35135-35140 rotation+GetAlpha=(255−alpha)/255）;入液链 :30704-30722——
// wet→timeLeft 钳 3,timeLeft<=3 → tileCollide=false/alpha=255/盒 80×80 中心重排/
// kb=8,期满 Kill=火云出口。
export class MolotovProj extends Entity {
  w = 14; h = 14;
  projId = 399;
  vx: number;
  vy: number;
  damage: number;
  critChance = 0.04;
  armorPen = 0;
  private t = 0;
  /** 原版 timeLeft（SetDefaults 缺省 3600 :789;AI :30720-30722 wet → 钳 3——
   *  入水 3 拍后 Kill=火云出口;旧 `t>600` 静默消失退役） */
  private timeLeft = 3600;
  /** 原版 knockBack（SetDefaults 缺省 0;:30717 timeLeft<=3 涨盒支置 8） */
  knockback = 0;
  /** 原版 rotation（:30655 每拍 +=0.25×direction——尘锚 spinningpoint2 旋转基准） */
  private rot = 0;
  /** 原版 direction（:17121 自动朝向;出生按初速 X 定号） */
  private dir = 1;
  /** 原版 alpha（SetDefaults 255 起;:30657-30664 ai[0]>=3 后 −40/t 钳 0——==0 开尘门） */
  private alpha = 255;
  private hitSet = new Set<number>();
  dead = false;
  // ---- ★通用湿段（Projectile.cs:16903-17113;2026-09-06 R3 漏网类批 11 类之一）----
  //  域 id = {399 Molotov}（SetDefaults :4804 块无 ignoreWater 行,缺省 false :763 → 受段）。
  //  ★勿双轨（R3）：类内原有 wet→timeLeft 钳（:30720-30722）曾走内联 WetCollision 直测
  //  ——原版读【湿段维护旗】（AI :30720 在湿段 :16903 之前 = 上拍旗）,现收编字段读
  //  （fixedUpdate 内钳位移到湿段前=原版 AI 位）;湿段本体接管四旗/溅花/wetCount 维护。
  //  ★位序：AI_068 全程只写 velocity/rotation/alpha 不写 position → 湿段测位 = 上拍
  //  位移后位 = 本拍位移前位,与原版 post-AI 同位;位移阻尼在 moveAndCollide 位移入参
  //  （tileCollide 缺省 true,:4804 块未关 → :17721 湿阻尼块适用）。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价——首拍 AI 写位前同位测值） */
  presetDone = false;   // ProjWetFlags.presetDone（共享湿段旗持有者）
  /** 火云生成回调（Game 注入——避免实体循环依赖） */
  spawnFires: (x: number, y: number, dmg: number, vx: number, vy: number) => void;

  constructor(x: number, y: number, vx: number, vy: number, damage: number,
    spawnFires: (x: number, y: number, dmg: number, vx: number, vy: number) => void) {
    super();
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.dir = vx < 0 ? -1 : 1;   // NewProjectile 出生朝向（初速 X 定号）
    this.spawnFires = spawnFires;
  }

  private breakOpen(game: GameHooks): void {
    this.dead = true;
    // :70918-70927 六朵火云：x 散布 -vx×rand(20,50)%±8、y -|vy|×rand(30,50)%-8..+2
    for (let i = 0; i < 6; i++) {
      const fx = -this.vx * (20 + Math.floor(Math.random() * 30)) * 0.01 + (Math.random() * 40 - 20) * 0.4;
      const fy = -Math.abs(this.vy) * (30 + Math.floor(Math.random() * 20)) * 0.01 + (Math.random() * 24 - 20) * 0.4;
      this.spawnFires(this.cx + fx, this.cy + fy, Math.max(1, Math.round(this.damage * 0.5)), fx, fy);
    }
    game.spawnParticles(this.cx, this.cy, '#FF9A3C', 20, 5, { life: 30, grav: -0.06, damp: 0.94 });
  }

  fixedUpdate(_dt: number, game: GameHooks) {
    if (++this.t >= 3) this.alpha = Math.max(0, this.alpha - 40);   // :30657-30664
    // ★MAJOR-3（:30672-30676）：`if (ai[0] >= 15f) { velocity.Y += 0.2f; cap16;
    // velocity.X *= 0.99f; }` —— 重力与摩擦同支、15 拍前【零改速】。旧 else 支
    // （0.1 重力）与无条件 ×0.99 摩擦均无原文出处,退役
    if (this.t >= 15) {
      this.vy = Math.min(this.vy + 0.2, 16);
      this.vx *= 0.99;
    }
    // ---- 飞行火焰尾迹（T2 清偿 2026-09-02;AI_068 :30655-30692,尘在 AI 段=位移前）----
    this.rot += 0.25 * this.dir;                                    // :30655
    if (this.alpha === 0) {
      // spinningpoint2=(4,−8);direction==−1 时 X=−4（:30681-30685）,随 rotation 旋转
      let sx = 4, sy = -8;
      if (this.dir === -1) sx = -4;
      const c = Math.cos(this.rot), s = Math.sin(this.rot);
      const ax = sx * c - sy * s, ay = sx * s + sy * c;             // RotatedBy(rotation)
      // NewDust(Center+spinningpoint2−One×5, 4,4, 6)（:30688）——初速抖动由引擎承担
      const d = game.spawnDust?.(this.cx + ax - 5, this.cy + ay - 5, 4, 4, 6, 0, 0, 0, null);
      if (d) {
        d.scale = 1.5;                                              // :30689（覆写消抖动）
        d.noGravity = true;                                         // :30690
        const nl = Math.hypot(ax, ay) || 1;                         // Normalize(spinningpoint2)
        d.vx = d.vx * 0.25 + ax / nl;                               // :30691
        d.vy = d.vy * 0.25 + ay / nl;
        const va = -Math.PI / 2 * this.dir;                         // :30692 RotatedBy(−π/2×dir)
        const vx0 = d.vx, vy0 = d.vy;
        d.vx = vx0 * Math.cos(va) - vy0 * Math.sin(va);
        d.vy = vx0 * Math.sin(va) + vy0 * Math.cos(va);
      }
    }
    // ★MINOR-4（:30720-30722 入液钳,原版位=AI 内/涨盒支后,读【上拍】湿段旗）——
    // R3 收编：内联 WetCollision 直测（双轨）退役,改读湿段维护旗;钳位移到湿段前=
    // 原版 AI 位（湿段在下方位移前刷新旗,此处读到的是上一拍旗,拍位 1:1）
    if (this.wet && this.timeLeft > 3) this.timeLeft = 3;
    // ---- 通用湿段（:16903-17113,projWetSection 共享体——AI 后/位移前,原版位序
    //      AI(:16880) → 湿段(:16903) → HandleMovement(:17120);域注见字段块）----
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater);
    // ★残余债清偿(2026-09-01):点采样撞块(中心+底部)在斜砖/半砖上要么漏检(斜面空区)
    // 要么误检(全格上半),改走正典管线——原版 Molotov 即标准 TileCollision 撞击即裂,
    // 任一轴接触或落面即 breakOpen。dropThrough=true 对齐弹体 fallThrough 缺省。
    // ★MINOR-4:timeLeft<=3（入水倒计时档）tileCollide=false——穿墙直落待爆(:30706)
    // ★水中位移阻尼（HandleMovement :17721-17764）——阻尼块整体在 if(tileCollide)
    //  内:涨盒支（timeLeft<=3 → tileCollide=false）不跑 = 阻尼恒 1;正常飞行档适用
    const lvx = this.vx, lvy = this.vy;
    const drag68 = this.timeLeft > 3 ? projWaterDragFactor(this) : 1;
    const body = {
      x: this.x, y: this.y, w: this.w, h: this.h,
      vx: this.vx, vy: this.vy,
      onGround: false, hitWall: false, hitHead: false, collideY: false,
      hoik: true,   // ★FX34c 弹幕域 hoik=true（Body.hoik 注:原版 Projectile 全路径）
      tileCollide: this.timeLeft > 3, dropThrough: true,
    };
    moveAndCollide(body, game.world, lvx * drag68, lvy * drag68);
    this.x = body.x; this.y = body.y;
    this.vx = lvx; this.vy = lvy;
    if (body.hitWall || body.collideY || body.onGround || body.hitHead) {
      this.breakOpen(game); return;   // 撞块即裂(:29052 系)
    }
    this.dir = this.vx < 0 ? -1 : 1;   // :17121-17127 自动朝向（<0 取 −1,否则恒 1）
    // ★MINOR-4（:30713-30719 涨盒支,原版顺序=AI 尾涨盒 → Update 尾 timeLeft--/Kill
    // → 次拍 AI 复涨盒;本仓涨盒/递减同拍连排,涨盒早一拍——该拍起 alpha=255 已隐身,
    // 无观感差,登记维持）：期满 Kill = 火云出口 breakOpen（:75347 Kill 链）。
    // 旧 `t>600` 静默消失（无爆裂）退役
    // ★BJ290 件1 定谳修订注（2026-09-23）：U1 判语「期满死=:17132 !active 门原版本
    //  就不割」与反编译相悖——:17132 门只拦 HandleMovement 内杀位;原版 timeLeft--
    //  Kill 在 :17308-17313=Damage()【:17184 之后】同一子步体内,故期满拍 CutTiles
    //  （:12517）先照跑再 Kill（盒=前拍涨盒支 80×80、位=本拍位移后,与本仓此处
    //  全同）。按「反编译唯一标杆」补前置割;红队若推翻此修订,摘本支即可单点回退。
    if (--this.timeLeft <= 0) {
      cutTilesBox(game, this.x, this.y, this.w, this.h);
      this.breakOpen(game);
      return;
    }
    if (this.timeLeft <= 3) {
      // 涨盒支（:30704-30717）：tileCollide=false（上支已读）/alpha=255（隐身）/
      // 盒 80×80 中心重排（position±width/2 重排原文）/knockBack=8
      this.alpha = 255;
      const pcx = this.cx, pcy = this.cy;
      this.w = 80; this.h = 80;
      this.x = pcx - 40; this.y = pcy - 40;
      this.knockback = 8;
    }
    // 命中敌即裂（penetrate 1）
    for (const ent of game.enemies()) {
      const e = ent as unknown as { x: number; y: number; w: number; h: number; id: number; dead: boolean };
      if (e.dead || this.hitSet.has(e.id)) continue;
      if (this.x < e.x + e.w && this.x + this.w > e.x && this.y < e.y + e.h && this.y + this.h > e.y) {
        // ★BJ290 件1（死亡段割面族 BJ260/285 同款前置习语,2026-09-23）：CutTiles
        //  （P.cs:12517）在 Damage() 内先于 Damage_PVE（:12523）——399 penetrate 1
        //  命中敌即裂拍【照割】（CanCutTiles :15407 / CanDealDamage :12461 两排除表
        //  均无 399;中央割 !e.dead 门=死亡拍整缺 → 前置弹盒上报,幂等双报同惯例）。
        cutTilesBox(game, this.x, this.y, this.w, this.h);
        this.hitSet.add(e.id);
        this.breakOpen(game);
        return;
      }
    }
  }

  draw(r: Renderer, cam: Camera): void {
    // ★MINOR-3（Main.cs:35135-35140,type 399/383 支）：`EntitySpriteDraw(tex,
    // proj.Center, null, proj.GetAlpha(color), proj.rotation, tex.Size()/2, scale, dir)`
    // —— 绘制角 = 原版自旋 rotation（:30655 +=0.25×direction,本类 this.rot 镜像）、
    // 中心锚/中心 origin（centerAnchor 档）;透明度 = GetAlpha=(255−alpha)/255
    // （:30657-30664 出生 alpha=255 → 约 7 拍淡入;涨盒支 alpha=255 → 隐身待爆）。
    // 旧码用速度角 atan2(vy,vx)+π/2 且无淡入 = 朝向+出生两处失真
    drawProj(r, cam, this, 399, this.rot, '#804020',
      Math.max(0, (255 - this.alpha) / 255), 0, false, true);
  }
}

// ================= 配重球（aiStyle 99 type 556-561/1079，AI_099_1 :64472-64824） =================
// SetDefaults（:5805-5813）：10×10 命中盒、extraUpdates=1（AI/移动/命中每 tick 跑 2 次）、
// DefaultToYoyo、counterweight=true、drawLayer=0。
// ai[0] 状态机：0 主球 / 1 副球（Counterweight() 已有在场时掷,轨道半径 ×0.75,:64532）/
//   -1 回收（松手 :64643-64646 或场上无悠悠球 :64491-64506）→ 飞回玩家 40px 内消亡
//   （:64777-64824:num13=num3×1.5=18 速/惯性 12/>2000 亦亡;tileCollide=false 穿墙）/
//   -3 魔法线幽灵（-1+magicString → 隐身零伤,:64727-64737）/ -2 脱离坠落（克隆,
//   penetrate=1、撞墙即亡、重力 0.3 缓落漂移,:64738-64776 + :16988-17006）。
// 环绕段：半径 num=250×0.5=125（yoyoString +25%+10,:64486-64488）；超径钳回轨道 +
//   切向增速 vector2=(vy,vx) 翻转带象限符号（:64540-64608,仅超径时运行）；鼠标位移
//   反推（vector5×-1×0.1,:64614-64642）；800px 内最近敌追踪 v3×6 lerp 1/8
//   （:64643-64717,敌须距玩家 <num×0.9 且有视线）；速度钳 [num4=9,num3=12]
//   （:64718-64726）。撞墙全轴反转 + 朝玩家 0.25 合成 + 钳 6（:17005-17028）。
/** 配重球运行上下文（Game 注入闭包——实体不持 EntityManager 引用） */
export interface CounterweightCtx {
  /** 拥有者（玩家中心/装备/绳锚链；null 或 dead → Kill,:64490-64493）。
   *  yoyoStringAnchor = Main.cs:28366-28373 悠悠球/配重球线起点全链——★BJ665 勘正 伪锚 :27794-27803
   *  （mountedCenter → mount52 → +gfxOffY → ApplyItemPositionOffsetFromMount），
   *  Player 实装——Game 闭包返回完整 Player 实例，结构满足 */
  owner: () => {
    cx: number; cy: number; dead?: boolean;
    equipStats?: { stringColor?: number; yoyoString?: boolean; magicString?: boolean };
    yoyoStringAnchor(target?: { x: number; y: number }, channelActive?: boolean): { x: number; y: number };
  } | null;
  /** Main.player[owner].channel 语义（按住使用中）——false → 回收（:64643-64646） */
  channel: () => boolean;
  /** 场上还有悠悠球（AI_099_1 :64488-64500 扫描门:aiStyle99 非配重球且 ai0>=-1） */
  yoyoInPlay: () => boolean;
  /** 光标世界坐标（线起点 mount54 行档 aim 用——原版读 player.itemRotation，
   *  其原料 = 鼠标世界位对 RotatedRelativePoint(MountedCenter) 参照点，Player 侧
   *  itemAimRotDir 复算；缺省 = 无 aim 走行 3 中档带） */
  aimTarget?: () => { x: number; y: number };
  /** 本帧鼠标屏幕位移（Main.mouseX-lastMouseX,:64614） */
  mouseDelta: () => { dx: number; dy: number };
  /** 魔法线克隆回调（:64727-64733:-1 回收 + magicString → 掷 75% 伤/击退脱离克隆） */
  spawnClone?: (x: number, y: number, vx: number, vy: number, dmg: number, kb: number, projId: number, crit?: number, armorPen?: number) => void;
  /** 悠悠球命中链回调（Projectile.cs:13306 Player.Counterweight——★BJ665 勘正 1456 伪锚 :12482）——配重球命中同样触发 */
  counterweight?: (hitX: number, hitY: number, dmg: number, kb: number) => void;
}

export class CounterweightProj extends Entity {
  /** SetDefaults :5808-5809 */
  w = 10; h = 10;
  damage: number;
  knockback: number;
  projId: number;
  critChance = 0.04;
  armorPen = 0;
  meleeProj = true;
  /** ai[0] 状态（0/1 环绕、-1 回收、-3 幽灵、-2 脱离） */
  ai0: number;
  private rot = 0;
  private ctx: CounterweightCtx;
  private hitCd = new HitCooldown();
  /** 方向（-2 漂移/rotation 定号） */
  private dir = 1;
  dead = false;
  /** 手部坐标 + 线色快照（线段链起点/染色，每 AI 次刷新） */
  handX = 0;
  handY = 0;
  stringColor = 0;
  /** -3 幽灵隐身（alpha=255,:68696-68700;1456 伪锚 :64734-64736 勘正）——绘制侧消费 */
  ghost = false;
  // ---- ★通用湿段（Projectile.cs:16903-17113;2026-09-06 R3 漏网类批 11 类之一）----
  //  域 id 集 = {556-561 彩色配重球(:6086 Range 块 DefaultToYoyo)/1079 黑配重(同块)}
  //  ——块内无 ignoreWater 行（缺省 false :763;DefaultToYoyo :10766-10773 亦不置位;
  //  与 PROJ_IGNORE_WATER 零交集）→ 全员受段。
  //  ★位序：AI_099_1（:64472-64824）全程只写 velocity/ai 不写 position → 湿段测位 =
  //  上拍位移后位;本仓 AI 与位移在 aiStep 内连排（类结构无法拆）→ 插 AI 链尾/位移前
  //  = 原版 post-AI 同位。extraUpdates=1（:5807）→ 湿段逐【子步】各跑一次（原版湿段
  //  在 numUpdates 环内 :16781-17345）。
  //  ★阻尼：环绕/脱离态 tileCollide=true（DefaultToYoyo 不改,:771 缺省）→ 湿阻尼适用
  //  （moveAndCollide 位移入参）;回收态 ai0<0 置 tileCollide=false（:64803）→ 阻尼块
  //  不跑,湿位移 = UpdatePosition :20555 wet → position += wetVelocity（AI 前快照,
  //  滞后一子步 quirk——回收积分支实现,YoyoProj 同款）。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价——首子步 AI 写位前同位测值） */
  presetDone = false;   // ProjWetFlags.presetDone（共享湿段旗持有者）

  constructor(x: number, y: number, damage: number, knockback: number, projId: number,
    ai0: number, ctx: CounterweightCtx) {
    super();
    this.x = x; this.y = y;
    this.damage = damage; this.knockback = knockback; this.projId = projId;
    this.ai0 = ai0;
    this.ctx = ctx;
    this.handX = x; this.handY = y;
  }

  fixedUpdate(_dt: number, game: GameHooks) {
    // 联机傀儡：纯位移外推
    if (this.netPuppet) { this.netPuppetStep(); return; }
    // extraUpdates=1（SetDefaults :5807）:AI/移动/命中每 tick 跑 2 次;-2 脱离态
    // extraUpdates=0（:64739,克隆出生即脱离 → 单跑）
    const iters = this.ai0 === -2 ? 1 : 2;
    for (let i = 0; i < iters && !this.dead; i++) this.aiStep(game);
  }

  private aiStep(game: GameHooks) {
    const p = this.ctx.owner();
    // :16870 wetVelocity 快照（子步 AI 前——回收态湿位移消费,见下回收积分支）
    const preVx = this.vx, preVy = this.vy;
    if (!p || p.dead) { this.dead = true; return; }   // player.dead → Kill（:64490-64493）
    // 线起点（Main.cs:28368-28370 悠悠球/配重球共用段——★BJ665 勘正 伪锚 :27794-27803）：mountedCenter → mount52
    // 修正 → +gfxOffY → ApplyItemPositionOffsetFromMount（Player.yoyoStringAnchor
    // 全链；aimTarget = 光标世界坐标，channel = itemAnimation>0 代理——原版
    // 悠悠球 channel 期 itemAnimation 持续刷新）
    const t = this.ctx.aimTarget?.();
    const hand = p.yoyoStringAnchor(t, this.ctx.channel());
    this.handX = hand.x; this.handY = hand.y;
    const eq = p.equipStats;   // 装备快照（accessor 每次全量重算,单次捕获）
    this.stringColor = eq?.stringColor ?? 0;
    // num=250×0.5=125 轨道半径（:64477/:64482）;num3=15×0.8=12 速度上限;
    // num4=12×1.5×0.5=9 速度下限（:64478-64483/:64531）;num5=num3=12 漂移钳
    let num = 125;
    const num3 = 12, num4 = 9, num5 = 12;
    // 场上无悠悠球 → 回收（:64491-64506,owner 本机 && ai0>=0 门）
    if (this.ai0 >= 0 && !this.ctx.yoyoInPlay()) this.ai0 = -1;
    if (eq?.yoyoString) num += num * 0.25 + 10;   // :64486-64488
    this.rot += 0.5;   // :64489
    if (Number.isNaN(this.vx) || Number.isNaN(this.vy)) { this.dead = true; return; }
    if (this.ai0 === 0 || this.ai0 === 1) {
      if (this.ai0 === 1) num *= 0.75;   // 副球收紧轨道（:64532-64535）
      let flag3 = false;
      let dx = p.cx - this.cx, dy = p.cy - this.cy;
      const d = Math.hypot(dx, dy);
      // :64536-64540 flag3 = 距玩家超 0.9×轨道（原版同位还有 ai[0] != -2f 恒真死检查,
      // 本分支已在 ai0∈{0,1} 内,省略不改变语义）
      if (d > num * 0.9) flag3 = true;
      if (d > num) {
        // 超径钳回（:64541-64550）：钳到轨道 + 速度径向衰减（去超出的 num6,至少留 1）
        const over = d - num;
        dx /= d || 1; dy /= d || 1;
        this.x = p.cx - dx * num - this.w / 2;
        this.y = p.cy - dy * num - this.h / 2;
        const sp = Math.hypot(this.vx, this.vy);
        const cut = Math.min(over, Math.max(0, sp - 1));   // num6 钳（:64556）
        if (sp > 0) { this.vx *= (sp - cut) / sp; this.vy *= (sp - cut) / sp; }
        // 切向增速（:64552-64608）：vector2=(vy,vx) 按象限定号后并入速度方向
        const sp0 = Math.hypot(this.vx, this.vy);
        if (sp0 > 0) {
          let tx = this.vy, ty = this.vx;   // vector2 翻转
          if (this.cy < p.cy) ty = Math.abs(ty); else if (this.cy > p.cy) ty = -Math.abs(ty);
          if (this.cx < p.cx) tx = Math.abs(tx); else if (this.cx > p.cx) tx = -Math.abs(tx);
          const tl = Math.hypot(tx, ty) || 1;
          tx = tx / tl * sp0; ty = ty / tl * sp0;   // vector2 *= velocity.Length()
          if (Math.abs(this.vx) > Math.abs(this.vy)) {
            let nvx = this.vx, nvy = this.vy + ty;
            const nl = Math.hypot(nvx, nvy) || 1;
            nvx = nvx / nl * sp0; nvy = nvy / nl * sp0;
            if (Math.abs(tx) < 0.1 || Math.abs(ty) < 0.1) { this.vx = nvx; this.vy = nvy; }
            else { this.vx = (nvx + this.vx * 2) / 3; this.vy = (nvy + this.vy * 2) / 3; }
          } else {
            let nvx = this.vx + tx, nvy = this.vy;
            const nl = Math.hypot(nvx, nvy) || 1;
            nvx = nvx / nl * sp0; nvy = nvy / nl * sp0;
            if (Math.abs(tx) < 0.2 || Math.abs(ty) < 0.2) { this.vx = nvx; this.vy = nvy; }
            else { this.vx = (nvx + this.vx * 2) / 3; this.vy = (nvy + this.vy * 2) / 3; }
          }
        }
      }
      // 鼠标位移反推（:64614-64642）：vector5=-(mouseDelta)×num2(0.1);velocity 非零才
      // 生效;flag3 时清掉继续远离玩家的分量
      if (this.ctx.channel()) {
        const md = this.ctx.mouseDelta();
        if (this.vx !== 0 || this.vy !== 0) {
          let mx = -md.dx, my = -md.dy;   // flag 恒 true → ×-1（:64623-64626）
          if (flag3) {
            if (this.cx < p.cx && mx < 0) mx = 0;
            if (this.cx > p.cx && mx > 0) mx = 0;
            if (this.cy < p.cy && my < 0) my = 0;
            if (this.cy > p.cy && my > 0) my = 0;
          }
          this.vx += mx * 0.1;
          this.vy += my * 0.1;
        }
      } else {
        this.ai0 = -1;   // 松手回收（:64643-64646）
      }
      // 800px 内最近敌追踪（:68598-68658;1456 :64643-64717 同构;flag 恒真——配重球
      //  全走 num8=800 档;num11=|dx|+|dy| 曼哈顿距;敌距玩家 <num×0.9 且对球有视线）。
      //  ★蓝队 R7-29 勘误（误报）：1457 此段内的逐型半径/力度分支（549→200/554→400/
      //  553→250/603→320、563 ×4/(14,15)/553 ×5/(12,13)/603 ×16/(9,10)/554 ×8/(6,7)、
      //  563 贴身 200 排除）全部是【死代码】——本方法只被 `(aiStyle==99 && type>=556 &&
      //  type<=561) || type==1079` 分派（:33767-33769）,549/553/554/563/603 是悠悠球
      //  本体型（走 AI_099_2_Yoyos）,永不进入本 AI;活分支只有缺省 ×6/(7,8)/800,
      //  与本仓单档 1:1。勿据死分支加表
      {
        let best = 800, tx = 0, ty = 0, found = false;
        for (const ent of game.enemies()) {
          if (!canBeChasedBy(ent)) continue;   // CanBeChasedBy :91070
          const e = ent as { x: number; y: number; w: number; h: number; dead: boolean };
          if (e.dead) continue;
          const ecx = e.x + e.w / 2, ecy = e.y + e.h / 2;
          const dist = Math.abs(this.cx - ecx) + Math.abs(this.cy - ecy);
          if (dist >= best) continue;
          if (!canHit(game.world.store, this.x, this.y, this.w, this.h, e.x, e.y, e.w, e.h)) continue;
          if (Math.hypot(ecx - p.cx, ecy - p.cy) >= num * 0.9) continue;
          best = dist; tx = ecx; ty = ecy; found = true;
        }
        if (found) {
          let cdx = tx - this.cx, cdy = ty - this.cy;
          const cd = Math.hypot(cdx, cdy) || 1;
          cdx = cdx / cd * 6; cdy = cdy / cd * 6;   // v3 *= 6（:68652-68662 缺省档=唯一活档）
          this.vx = (this.vx * 7 + cdx) / 8;
          this.vy = (this.vy * 7 + cdy) / 8;
        }
      }
      // 速度钳 [num4=9, num3=12]（:64718-64726;零速保持零——SafeNormalize(Zero) 语义）
      const sp = Math.hypot(this.vx, this.vy);
      if (sp > num3) { this.vx = this.vx / sp * num3; this.vy = this.vy / sp * num3; }
      else if (sp > 0 && sp < num4) { this.vx = this.vx / sp * num4; this.vy = this.vy / sp * num4; }
    }
    // 魔法线（:64727-64733）：-1 回收态 + magicString → -3 幽灵 + 掷 75% 伤/击退脱离克隆
    if (this.ai0 === -1 && eq?.magicString) {
      this.ai0 = -3;
      this.ctx.spawnClone?.(this.cx, this.cy, this.vx, this.vy,
        Math.trunc(this.damage * 0.75), Math.trunc(this.knockback * 0.75), this.projId,
        this.critChance, this.armorPen);
    }
    if (this.ai0 === -3) { this.ghost = true; this.damage = 0; }   // alpha=255 + damage=0（:64734-64737）
    // ---- 通用湿段（:16903-17113,projWetSection 共享体——AI 后/位移前,原版位序
    //      AI(:16880) → 湿段(:16903) → HandleMovement(:17120);三态全受段（原版湿段
    //      门只有 !ignoreWater,与 ai[0] 无关）;域注/阻尼定谳见字段块）----
    //  ★⑧Shimmer() 接面（2026-09-07 缺面清单清偿·99 支补遗）：域 {556-561,1079}
    //  全 aiStyle 99（DefaultToYoyo :6086 Range 块）→ 悠悠球支（P.cs:22656-22668）—
    //  —vy>0 弹反+shimmerWet/wet 双清 + vy>-8 → -8 强制上收;头门 :22566
    //  ai[0]==-1（回收态）早退,-2 脱离/-3 幽灵照跑。面适配：ai0≡ai0（环绕/回收/
    //  脱离/幽灵同名字段）;ai1=0 恒传（本类不承载 ai[1] 活面,99 支亦零消费）;
    //  hostile=false（域全 friendly）;kill/timeLeft 面零消费（99 支无 Kill、无
    //  timeLeft 面——缺省不接=登记）。
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater, {
        shimmer: (st, x, y, _w, _h) => {
          const sf: ProjShimmerFace = {
            projId: this.projId,
            aiStyle: projectileData(this.projId)?.aiStyle ?? -1,
            hostile: false,
            vx: this.vx, vy: this.vy,
            timeLeft: 0,
            ai0: this.ai0, ai1: 0,
            wet: this.wet, shimmerWet: this.shimmerWet,
            rainbowSlimeUnlocked: false,
          };
          projShimmerStep(sf, st, x, y, this.cx);
          this.vx = sf.vx; this.vy = sf.vy;
          this.wet = sf.wet; this.shimmerWet = sf.shimmerWet;
        },
      });
    if (this.ai0 === -2) {
      // 脱离坠落（:64738-64776）：penetrate=1（克隆一次命中即亡）;重力 0.3、速度上限
      // 16、vy≤3 缓落水平漂移 ±0.1（num5 钳）
      this.vy += 0.3;
      const sp = Math.hypot(this.vx, this.vy);
      if (sp > 16) { this.vx = this.vx / sp * 16; this.vy = this.vy / sp * 16; }
      else if (this.vy <= 3) {
        if (Math.abs(this.vx) < 0.1) {
          if (this.cx < p.cx) { this.vx -= 0.1; this.dir = -1; }
          else { this.vx += 0.1; this.dir = 1; }
        } else if (this.vx > 0 && this.vx < num5) this.vx += 0.1;
        else if (this.vx < 0 && this.vx > -num5) this.vx -= 0.1;
      }
    } else if (this.ai0 < 0) {
      // 回收（:64777-64824）：num13=num3×1.5=18 速、惯性 num14=12;
      // 距玩家 <40 / NaN / >2000 → Kill;tileCollide=false 穿墙直积分
      const dx = p.cx - this.cx, dy = p.cy - this.cy;
      const d = Math.hypot(dx, dy);
      if (d < 40 || Number.isNaN(d) || d > 2000) { this.dead = true; return; }
      // 回收速 num13 = num3×1.5 = 18、惯性 num14 = 12（:68762-68776）。★蓝队 R7-33
      //  勘误（误报）：同段 546 ×1.5/554 ×1.25/555 ×1.35/562 ×1.25 逐型乘子全在
      //  AI_099_1_Counterweights 内（type 只可能 556-561/1079）= 死代码,活路径恒 18
      this.vx = (this.vx * 11 + (dx / (d || 1)) * 18) / 12;
      this.vy = (this.vy * 11 + (dy / (d || 1)) * 18) / 12;
      // 回收态湿位移（UpdatePosition :20555-20562）：tileCollide=false（:64803）→
      // 湿阻尼块不跑,wet → position += wetVelocity（子步 AI 前快照 preVx/preVy,无阻尼
      // ——滞后一子步 quirk 本体）;dry → position += velocity（post-lerp,原版同构）
      if (this.wet) { this.x += preVx; this.y += preVy; }
      else { this.x += this.vx; this.y += this.vy; }
      // ★BJ344 F2：dirOverride = 自动向 sign(vx,0→1)（同 YoyoProj 注;本位 vx=回收
      //  lerp 后值,:2863 直积分消费同源）——原 dirX 位降级零兜底不再消费
      hitEnemies(this, game, this.hitCd, 10, Math.sign(this.vx) || 1, this.armorPen,
        (e) => this.onHit(e), undefined, true,   // 玩家级共享免疫（aiStyle 99 同族）
        undefined, 0, this.vx < 0 ? -1 : 1);
      return;
    }
    // 移动/碰撞（环绕与脱离态;回收态上方已直积分返回）。
    // ★1:1 决策落地(2026-09-01):aiStyle99 反射链(P.cs:18509-18552)以【速度被改】
    // 差分判轴——此前旗标口径撤销。body 视图取差分;dropThrough 按 :17661 原文 =
    // 仅脱离态(ai[0]==-2)FALSE(下坠撞平台),环绕/其余恒 TRUE(弹体 fallThrough 缺省)。
    const lvx = this.vx, lvy = this.vy;
    const cwBody = {
      x: this.x, y: this.y, w: this.w, h: this.h,
      vx: this.vx, vy: this.vy,
      onGround: false, hitWall: false, hitHead: false, collideY: false,
      hoik: true,   // ★FX34c 弹幕域 hoik=true（Body.hoik 注:原版 Projectile 全路径）
      tileCollide: true, dropThrough: !(this.ai0 === -2),
    };
    // ★水中位移阻尼（HandleMovement :17721-17764,环绕/脱离态 tileCollide=true 适用）
    //  ——速度场不减只削当拍位移;回收态已在上分支直积分返回（湿位移走快照 quirk）
    const dragCW = projWaterDragFactor(this);
    moveAndCollide(cwBody, game.world, lvx * dragCW, lvy * dragCW);
    const chX = cwBody.vx !== lvx, chY = cwBody.vy !== lvy;
    this.x = cwBody.x; this.y = cwBody.y; this.vx = cwBody.vx; this.vy = cwBody.vy;
    if (this.ai0 === -2) {
      // 脱离态（:18513-18525）：竖撞 lastVy>4 → 弹起 ×-0.6;横撞差分 → HitTiles 尘 +
      // SoundID 0 + Kill
      if (chY && lvy > 4) this.vy = -lvy * 0.6;
      if (chX) {
        game.spawnParticles(this.cx, this.cy, '#A09080', 3, 1.5, { life: 14, size: 2 });   // HitTiles 尘
        game.playSfx('dig', 1, this.cx, this.cy);   // SoundID 0
        this.dead = true;
        return;
      }
    } else if (chX || chY) {
      // 环绕态（:18527-18547）：逐轴全反射(-lastV) + 任一轴反射后向玩家合成
      // v2=norm(p-c)*|v|×0.25、velocity×0.75+v2、|v|>6 再 ×0.5
      if (chX) this.vx = -lvx;
      if (chY) this.vy = -lvy;
      let hx = p.cx - this.cx, hy = p.cy - this.cy;
      const hd = Math.hypot(hx, hy) || 1;
      const spd = Math.hypot(this.vx, this.vy);
      hx = hx / hd * spd * 0.25;   // v2 *= velocity.Length() × 0.25(SafeNormalize(UnitY) 兜底)
      hy = hy / hd * spd * 0.25;
      this.vx = this.vx * 0.75 + hx;
      this.vy = this.vy * 0.75 + hy;
      const ns = Math.hypot(this.vx, this.vy);
      if (ns > 6) { this.vx *= 0.5; this.vy *= 0.5; }
    }
    // ★BJ290 件1（死亡段割面族 BJ260/285 同款前置习语,2026-09-23）：CutTiles
    //  （P.cs:12517）先于 Damage_PVE（:12523）aiStyle 99 段——-2 脱离克隆 penetrate 1
    //  （:68701-68707 ai0=-2 支头 penetrate<0→1;1456 伪锚 :64741-64744 勘正）一次命中即亡拍【照割】（556-561/1079 过 CanCutTiles :15407 /
    //  CanDealDamage :12461 两表;中央割 !e.dead 门=死亡拍整缺 → 前置弹盒上报,hurt
    //  (:403)/onHit(:413) 前序=原版序）。撞墙亡（上方 chX 支）=原版 HandleMovement
    //  杀位 → :17132 !active 门,原版本就不割勿扩;环绕态 0/1 命中只弹不亡无死亡拍。
    if (this.ai0 === -2) cutTilesBox(game, this.x, this.y, this.w, this.h);
    // ★BJ344 F2：dirOverride = 自动向 sign(vx,0→1)（同 YoyoProj 注;本位 vx=碰撞
    //  反射/合成写回后值 = 原版 HandleMovement 后自动向读数同相）
    hitEnemies(this, game, this.hitCd, 10, Math.sign(this.vx) || 1, this.armorPen,
      (e) => this.onHit(e), undefined, true,   // 玩家级共享免疫（DefaultToYoyo :5809-5813）
      undefined, 0, this.vx < 0 ? -1 : 1);
  }

  /** 命中链（Projectile.cs:13290-13335 aiStyle 99 段;1456 伪锚 :12467-12508 勘正;-2 只被弹开,其余走
   *  Counterweight 调用 + 方向定号 + ai0>=0 活跃反弹（localAI[0] += 20 段对配重球
   *  无寿命语义,天然无效）） */
  private onHit(e: unknown) {
    const ecx = (e as { x: number; w: number }).x + (e as { x: number; w: number }).w / 2;
    const ecy = (e as { y: number; h: number }).y + (e as { y: number; h: number }).h / 2;
    if (this.ai0 === -2) {
      // 脱离态被弹开（:13292-13303;1456 伪锚 :12469-12477 勘正）：速度 ÷5 + 上抛 Next(50,81)×0.1 钳 -16
      this.vx /= 5; this.vy /= 5;
      this.vy -= (50 + Math.floor(Math.random() * 31)) * 0.1;
      if (this.vy < -16) this.vy = -16;
      this.dead = true;   // penetrate=1（:68701-68707 ai0=-2 支头 penetrate<0→1;1456 伪锚 :64741-64744 勘正）一次命中即亡
      return;
    }
    const p = this.ctx.owner();
    if (!p) return;
    this.ctx.counterweight?.(ecx, ecy, this.damage, this.knockback);   // :13306（1456 伪锚 :12482 勘正）
    this.dir = ecx < p.cx ? -1 : 1;   // :13307-13314（1456 伪锚 :12484-12489 勘正）
    if (this.ai0 >= 0) {
      // 活跃态命中反弹（:13315-13333;1456 伪锚 :12490-12500 勘正）：v×-0.5 + 离敌向 ×16
      let bx = this.cx - ecx, by = this.cy - ecy;
      const bd = Math.hypot(bx, by) || 1;
      this.vx = this.vx * -0.5 + (bx / bd) * 16;
      this.vy = this.vy * -0.5 + (by / bd) * 16;
    }
  }

  draw(r: Renderer, cam: Camera): void {
    // 线（配重球同走 aiStyle 99 段链,Main.cs:28366-28482——ai[0] != -2 命中 :28366;-3 幽灵仍画线——★BJ665 勘正 伪锚 :27799-27908）
    if (this.ai0 !== -2) {
      const c = r.ctx;
      const tex = r.atlas?.ensureVImage?.('vanilla/FishingLine.png');
      if (c && tex) {
        drawYoyoStringLine(c, tex, this.handX, this.handY, this,
          this.stringColor, stringColorOpts(r.lighting?.clock));
      }
    }
    // -3 幽灵 alpha=255（全透明,:68696-68700;1456 伪锚 :64734-64736 勘正）;贴图原生尺寸（SetDefaults 盒 10×10 而贴
    // 图 16×16,drawSize=-1 防缩）。旋转 = proj.rotation 原样（1457 通用尾支
    // Main.cs:35047 rotation=proj.rotation、origin38=(num153,盒高/2+num151)=:35032,配重球 556-561/1079（★BJ665 勘正 伪锚 :35040）
    // 无 num151/152 特支亦无 +π/2——自转增量在 AI（AI_099_1 :68463 rotation+=0.5f,本仓
    // rot+=0.5 同源）;曾 +π/2 = 球体朝向恒偏 90°。悠悠球同族直绘 this.rot（YoyoProj.draw）
    drawProj(r, cam, this, this.projId, this.rot, '#B09060', this.ghost ? 0 : 1, -1);
  }
}

/** Player.Counterweight 决策核（Player.cs:12445-12504 纯逻辑——★BJ665 勘正 伪锚 :11946-12004;Game 侧执行掷出）：
 *  数场上悠悠球（非配重球旗标、ai0 != -2）与配重球（旗标、ai0 != -2）→
 *  ① yoyoGlove 且悠悠球数 <2 且 ≥1 → 掷同型二号悠悠球（ai0=1）
 *  ② else if counterWeight >0 且配重球数 <悠悠球数 → 掷配重球（vanity 优先;
 *     kb=(kb+6)/2;已有在场 ai0=1 否则 0——两支速度同为朝命中点 16）
 *  入参 play = 该玩家全部 aiStyle 99 投射物视图（含本球）,按数组序（num=最后一个悠悠球） */
export interface CounterweightPlayView { isWeight: boolean; ai0: number; }
export type CounterweightSpawn =
  | { kind: 'none' }
  | { kind: 'second-yoyo' }
  | { kind: 'counterweight'; type: number; kb: number; secondary: boolean };

/** 悠悠球袋配重球颜色掷骰（Player.cs:14824/:14848——1/7→黑配重 1079,★BJ665 勘正 伪锚 :14176/:14200,
 *  否则 556+Next(6) 彩色族）。2026-08-19 从 equipStats getter 迁出：原版
 *  ResetEffects 每帧清零后 UpdateEquips 重掷 = 使用期随机；getter 每访问掷
 *  会随记忆化冻结成"每套装备一次"，消费端掷 = 每次命中独立（与原采样等价）。 */
export function rollYoyoCounterweight(): number {
  return Math.floor(Math.random() * 7) === 0 ? 1079 : 556 + Math.floor(Math.random() * 6);
}

export function counterweightDecision(
  eq: { yoyoGlove: boolean; counterWeight: number; vanityCounterWeight: number; yoyoBag?: boolean },
  play: readonly CounterweightPlayView[],
  kb: number,
): CounterweightSpawn {
  if (!eq.yoyoGlove && eq.counterWeight <= 0) return { kind: 'none' };   // :11947-11950
  let yoyos = 0, weights = 0;
  for (const p of play) {
    if (p.isWeight) {
      if (p.ai0 !== -2) weights++;   // num3
    } else if (p.ai0 !== -2) {
      yoyos++;   // num2（num=最后一个悠悠球索引——计数即 ≥1 判据）
    }
  }
  if (eq.yoyoGlove && yoyos < 2) {
    if (yoyos >= 1) return { kind: 'second-yoyo' };   // num >= 0（:11973-11985）
    return { kind: 'none' };   // 手套分支已占用 else-if（:11986）——无球在场不掷配重
  }
  if ((eq.counterWeight > 0 || eq.yoyoBag) && weights < yoyos) {
    return {
      kind: 'counterweight',
      // :11990-11994 vanity 优先 → 功能槽直置(5547 黑/3309-14 彩) → 悠悠球袋
      // 现场掷(原版每帧 UpdateEquips 掷,消费端掷=每次命中独立)
      type: eq.vanityCounterWeight !== 0 ? eq.vanityCounterWeight
        : eq.counterWeight !== 0 ? eq.counterWeight
        : rollYoyoCounterweight(),
      kb: (kb + 6) / 2,   // :11987
      secondary: weights > 0,   // :11995-12003 已有在场 → ai0=1
    };
  }
  return { kind: 'none' };
}

// ================= 悠悠球 / 连枷（aiStyle 99 / 15，channel 语义） =================

/** 悠悠球型号三表（ProjectileID.cs:279/281/283 全量 1:1——★BJ665 勘正 1456 伪锚 :185/187/189；键=projId，缺省=表默认） */
export const YOYO_RANGE: Record<number, number> = { // 最大射程 px（默认 200）
  541: 130, 548: 170, 542: 195, 543: 207, 544: 215, 534: 220, 564: 225, 999: 225,
  545: 235, 562: 320, 563: 250, 546: 275, 552: 270, 553: 330, 547: 280, 549: 290,
  554: 380, 550: 370, 551: 370, 555: 360, 603: 400, // 1457: 562 FormatC 235→320 / 554 Kraken 340→380（ProjectileID.cs:281）
};
export const YOYO_TOP: Record<number, number> = {  // 顶速（默认 10）
  541: 9, 548: 11, 542: 12.5, 543: 12, 544: 13, 534: 13, 564: 14, 999: 14,
  545: 14, 562: 17, 563: 16, 546: 15, 552: 14, 553: 15, 547: 17, 549: 16,
  554: 22, 550: 16, 551: 16, 555: 16.5, 603: 17.5, // 1457: 563 Gradient 12→16 / 554 Kraken 16→22（ProjectileID.cs:283）
};
export const YOYO_LIFE: Record<number, number> = {  // 寿命倍率（默认 -1=无限）
  541: 3, 548: 5, 542: 7, 543: 6, 544: 8, 534: 9, 564: 11, 999: 11,
  545: 13, 563: 30, 562: 16, 553: 12, 546: 16, 552: 15, 549: 14,
};
/** SetDefaults scale 绘制缩放（Projectile.cs:6052-6062 aiStyle99 段：缺省 scale=1、
 *  563 Gradient=1.05 / 564 Valor=1.075（:6056-6061）/ 603 Terrarian=1.15（:6067）） */
const YOYO_DRAW_SCALE: Record<number, number> = { 563: 1.05, 564: 1.075, 603: 1.15 };

export class YoyoProj extends Entity {
  w = 16; h = 16;
  damage: number;
  knockback: number;
  projId: number;
  /** GetWeaponCrit 合并值（Game 侧传入；缺省 4 基础） */
  critChance = 0.04;
  /** ⑥ 护甲穿透（Game 注入，命中传 hurt 减防） */
  armorPen = 0;
  /** 近战系（吃武器浸剂） */
  meleeProj = true;
  /** ★FX34c 弹幕域 hoik=true（Body.hoik 注:原版 Projectile 全路径 true） */
  hoik = true;
  /** 持续按住判定（原版 channel：按住时悠悠球滞留追光标） */
  private channel: () => boolean;
  /** 光标世界坐标 getter */
  private target: () => { x: number; y: number };
  /** ★废弃死参数（Game 侧传 0）:射程唯一源 = Sets.YoyosMaximumRange 表
   *  （ProjectileID.cs:281,21 型号缺省 200——★BJ665 勘正 伪锚 :187）+ yoyoString×1.25+30（:68937-68939——★BJ665 勘正 伪锚 :64968-64970）+
   *  ÷(1+meleeSpeed×3)/4（:64974）——旧"220+spd×10"自造公式已废,勿再启用 */
  private stringLen: number;
  private hitCd = new HitCooldown();
  private rot = 0;
  /** 手部坐标（线起点，fixedUpdate 每帧刷新为主角中心） */
  handX = 0;
  handY = 0;
  /** 线饰品线色快照（Player.stringColor，fixedUpdate 每帧从 equipStats 刷新；
   *  绘制侧消费——线段链染色/29 号闪烁免取光，Main.cs:27901） */
  stringColor = 0;
  /** localAI[0] 累积寿命（秒，÷(1+meleeSpeed)/2 折算；超 YOYO_LIFE → 回收态） */
  private lifeT = 0;
  /** 603 孢子伴生计数（localAI[1],:68830——≥6 掷 604 并清零;蓝队 R7-30） */
  private sporeT = 0;
  /** ai[0] 状态机（AI_099_2_Yoyos 全量）：
   *  >=0 = 目标 X 缓存（活跃追标，ai[1]=目标 Y）；
   *  -1  = 回收（松手/石化冰冻/超寿命/1.3×超程 → 飞回玩家 <top+10 消亡）；
   *  -2  = 脱离坠落（魔法线克隆专属出生态：重力 0.3、penetrate=Next(3,7)、撞墙即亡、
   *        免画线 Main.cs:28366（★BJ665 勘正 伪锚 :27799）；:65118-65151）；
   *  -3  = 魔法线幽灵（-1+magicString → 隐身零伤飞回，:65110-65120）。 */
  ai0 = 0;
  /** ai[1] 目标 Y 缓存（回收转移时清 0，:65005） */
  private ai1 = 0;
  /** 旧"回收锁"语义兼容读口（= ai0 ∈ {-1,-3}） */
  get recalled(): boolean { return this.ai0 === -1 || this.ai0 === -3; }
  /** projectile.direction（AI_099 ChangeDir 段 :64925-64935：球在玩家右侧 >2px → 1、
   *  左侧 → -1,±2 死区内保持原值；flag/脱离态不更新——:68883-68902 门;1456 伪锚 :64907-64934 勘正）——
   *  击退方向以此为准（曾误用 sign(vx)） */
  private dir = 1;
  /** -2 脱离态穿透计数（penetrate 懒置 Next(3,7)=3-6，:65122-65125；-1=未置） */
  private pierceLeft = -1;
  /** -3 幽灵隐身（alpha=255，:65117-65119）——绘制侧消费 */
  ghost = false;
  /** ★BJ235 563 Gradient 残影环（TrailingMode[563]=2/cap 60 表驱动）——余型 mode -1
   *  → null 短路。mode2 记 oldRot 但 563 轨读【本体当前角】（:35293 proj.rotation），
   *  oldRot 环槽仅作记录面完整性。绘制面=drawHslMidpointTrail（本体后）。 */
  private ghostRing?: ProjGhostRing | null;
  /** 存活 tick 上限:有限寿命型号 7200 防泄漏;无限寿命（YOYO_LIFE 缺省 -1）无上限——
   *  原版 timeLeft=6 每帧刷新（:64942）,无限寿命悠悠球可永久滞留直至松手回收。
   *  脱离态（-2）寿命无限（:68809-68812 num2=-1;1456 伪锚 :64850-64852 勘正）——撞墙/穿透尽才亡 */
  life = 7200;
  /** 型号顶速（YOYO_TOP 注入，缺省 10——ProjectileID.cs:283,★BJ665 勘正 伪锚 :189） */
  topSpeed = 10;
  dead = false;

  // ---- ★通用湿段（Projectile.cs:16903-17113 全体弹共用段;2026-09-04 溅花缺口清偿批,
  //  projWetSection.ts 共享体 1:1;本域 id 集 = YOYO_RANGE 全 21 型 aiStyle99）----
  //  豁免核对（1457 SetDefaults :699-10676 逐块脚本化扫描）:534(:6015-6022)/
  //  541-555 区间块(:6023-6046,DefaultToYoyo :6028)/562-564(:6047-6062)/
  //  603(:6063-6072)/999(:9485-9492)——全 21 型均无 ignoreWater=true 行（缺省 false
  //  @:763;DefaultToYoyo :10766-10773 亦不置位）→ 全员受段;与 PROJ_IGNORE_WATER
  //  零交集。★位移方式定谳:AI_099_2_Yoyos（:68785-69161）全程只写 velocity/rotation、
  //  无任何 position 直写 → 位移 = HandleMovement position += wetVelocity/velocity
  //  （UpdatePosition :20549-20562）。活跃/脱离态 tileCollide=true 缺省（:771,
  //  DefaultToYoyo 不改）→ 湿阻尼分支 :17721-17764 适用（仅削位移）;回收态 ai[0]<0
  //  在 AI 内 tileCollide=false（:69138）→ 阻尼分支不跑,wet 位移走 :16870 AI 前快照
  //  （无阻尼、滞后一子步 quirk）/dry 走 post-AI velocity——fixedUpdate 三处分叉照抄。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10887-10893 等价——首拍同位测值;
   *  AI_099_2 无 position 写面 → 首拍位=出生盒,与原版 NewProjectile 时点同位） */
  presetDone = false;   // ProjWetFlags.presetDone（共享湿段旗持有者）
  /** 同型前球在场（AI_099_2 flag :68787-68794;1456 伪锚 :64827-64835 勘正：手套二号球寿命加速烧 rand(10,31)×0.1、
   *  死区 +20（:68949-68952）、免持械转向（:68883-68902;1456 伪锚 :64976-64978/:64907-64934 勘正）——Game 注入闭包扫描） */
  secondInPlay?: () => boolean;
  /** 寿命尽全量回收广播（:64852-64866：该玩家所有 aiStyle99 且 ai0>=0 → -1——含
   *  配重球；Game 注入闭包扫描） */
  recallFamily?: () => void;
  /** 魔法线克隆回调（:65110-65116：-1+magicString → 掷 75% 伤/击退的 -2 脱离克隆） */
  spawnClone?: (x: number, y: number, vx: number, vy: number, dmg: number, kb: number) => void;
  /** 悠悠球命中链回调（Projectile.cs:13306 Player.Counterweight——★BJ665 勘正 1456 伪锚 :12482；-2 免调） */
  counterweight?: (hitX: number, hitY: number, dmg: number, kb: number) => void;
  /** 1457 EverySomeYoyoHits per-hit 族伴生弹生成回调（:13761-13870 NewProjectile——
   *  entities.add 不在 GameHooks,Game 侧 wireYoyoCallbacks 注入） */
  spawnShot?: (spec: YoyoShotSpec) => void;
  /** 999 HiveFive 每击 1/3 放蜂生成回调（Projectile.cs:13752-13760 NewProjectile——
   *  蜂弹 = Player.beeType()/beeDamage()/beeKB() 三链 + spawn 位 .melee=true 覆写;
   *  入参 (x,y,vx,vy,dmg,kb),x/y=源球中心（Game 侧按 NewProjectile 居中语义落桶）） */
  spawnBee?: (x: number, y: number, vx: number, vy: number, dmg: number, kb: number) => void;
  /** 出生物品内部 id（Game 注入——channel 闭包的手持核对/族成员遗传：手套二号球、
   *  魔法线克隆、配重球 ctx 共用同物品 channel 判定） */
  itemId?: number;

  constructor(x: number, y: number, damage: number, knockback: number, projId: number,
    stringLen: number, channel: () => boolean, target: () => { x: number; y: number },
    /** 出生初速（=16×attackSpeedMult = 16/meleeSpeed,Game 侧初掷传入;缺省 0 =
     *  魔法线克隆/手套二号球等自带速度的生成点不注入——原版走各自 NewProjectile
     *  显式速度 :65110-65116/:11977-11992） */
    initSpeed = 0) {
    super();
    this.x = x; this.y = y;
    this.handX = x; this.handY = y;
    this.damage = damage;
    this.knockback = knockback;
    this.projId = projId;
    this.stringLen = stringLen;
    this.channel = channel;
    this.target = target;
    // 出生初速（ItemCheck_Shoot :47466 弹速声明 + :47468-47470 melee 弹速 = shootSpeed/meleeSpeed;1456 伪锚 :46430-46434 勘正——
    // 悠悠球 shootSpeed=16 且不在 NoMeleeSpeedVelocityScaling 排除表;:47687-47718 num4/5（1456 伪锚 :46642-46680 勘正）
    // num4/5 = (光标−手心)归一×speed → 16/meleeSpeed 朝光标。此前零速起步,
    // 首帧全靠 AI 逼近段加速=出速迟钝）
    if (initSpeed > 0) {
      const t0 = target();
      const ddx = t0.x - (x + this.w / 2), ddy = t0.y - (y + this.h / 2);
      const dl = Math.hypot(ddx, ddy);
      if (dl > 0) { this.vx = (ddx / dl) * initSpeed; this.vy = (ddy / dl) * initSpeed; }
      else { this.vx = initSpeed; this.vy = 0; }   // num4==0&&num5==0 → (direction,0) 档
    }
    // 无限寿命型号（Sets.YoyosLifeTimeMultiplier 缺省 -1,ProjectileID.cs:279——★BJ665 勘正 伪锚 :185）不上限
    if ((YOYO_LIFE[projId] ?? -1) === -1) this.life = Number.POSITIVE_INFINITY;
  }

  draw(r: Renderer, cam: Camera): void {
    // 线（Main.cs:28366-28482 DrawProjDirect aiStyle99 段 1:1——★BJ665 勘正 伪锚 :27799-27908）：手部→球体 12px 段链，
    // FishingLine.png 竖条逐段旋贴、摆垂、线饰品染色（StringLine 共享模块——曾灰直线近似）。
    // ★ai[0] != -2 免画线门（Main.cs:28366——★BJ665 勘正 伪锚 :27799;脱离态无线；-3 幽灵仍画线）
    if (this.ai0 !== -2) {
      const c = r.ctx;
      const tex = r.atlas?.ensureVImage?.('vanilla/FishingLine.png');
      if (c && tex) {
        drawYoyoStringLine(c, tex, this.handX, this.handY, this,
          this.stringColor, stringColorOpts(r.lighting?.clock));
      }
    }
    // :65180-65186 rotation：-2 档 += 0.45×direction（漂移向），其余 +0.45
    // 1457 :69152-69160:定向自转门 ai[0]==-2 并入 554 Kraken（0.45×direction 同款）
    this.rot += (this.ai0 === -2 || this.projId === 554) ? 0.45 * this.dir : 0.45;
    // -3 幽灵 alpha=255 全透明（:65117-65119）
    // SetDefaults scale（Projectile.cs:6052-6062）：563 Gradient=1.05 / 564 Valor=1.075 /
    // 603 Terrarian=1.15,其余缺省 1（R30 §6.1 P3——贴图 5-15% 差,随手修）
    drawProj(r, cam, this, this.projId, this.rot, '#E04040', this.ghost ? 0 : 1,
      0, false, false, YOYO_DRAW_SCALE[this.projId] ?? 1);
    // ---- ★BJ235 563 Gradient 残影轨（Main.cs:35283-35299;原版本体段【后】画）——
    //      10 槽 hsl((1−i/10)²/5) 双笔（槽位+中点）、A=127×(1−i/10)²×0.65、rot=本体角、
    //      scale=1.05;逐槽格光乘由 repo compositeLight 全屏承载（projGhostTrail 头注②）。
    //      ghostRing 仅 563 非空（余型 mode -1 → null 短路）。 ----
    if (this.projId === 563 && this.ghostRing && this.ghostRing.filled > 1 && r.ctx) {
      const tex563 = projSprite(563);
      if (tex563 && tex563.width > 0) {
        drawHslMidpointTrail(r.ctx, this.ghostRing, tex563, this.rot,
          YOYO_DRAW_SCALE[563] ?? 1.05, 1, 0, tex563.width, tex563.height);
      }
    }
  }

  fixedUpdate(_dt: number, game: GameHooks) {
    // 联机傀儡（远端弹幕快照驱动）：纯位移外推，不跑命中/碰撞（伤害归拥有者客户端结算）
    if (this.netPuppet) { this.netPuppetStep(); return; }
    if (--this.life <= 0) { this.dead = true; return; }
    // :16870 `Vector2 wetVelocity = velocity`（本拍 AI 前 velocity 快照——回收态湿位移
    //  消费,见下方回收段;AI_099_2 首个 velocity 写面在活跃块 ×0.98,此前捕获=同位）
    const preVx = this.vx, preVy = this.vy;
    const p = game.player;
    const eq = p.equipStats;
    // 线起点（Main.cs:28368-28370——★BJ665 勘正 伪锚 :27794-27803）：mountedCenter → mount52 修正 → +gfxOffY →
    // ApplyItemPositionOffsetFromMount（Player.yoyoStringAnchor 全链；target =
    // 光标世界坐标（mount54 行档 aim），channel = itemAnimation>0 代理——原版
    // 悠悠球 channel 期 itemAnimation 持续刷新恒>0）
    {
      const h = p.yoyoStringAnchor(this.target(), this.channel());
      this.handX = h.x;
      this.handY = h.y;
    }
    this.stringColor = eq.stringColor;
    // flag：同型前球在场（:68787-68794;1456 伪锚 :64827-64835 勘正——手套二号球标记）
    const flag = !!this.secondInPlay?.();
    // ChangeDir 段（:68883-68902;1456 伪锚 :64907-64934 勘正）：!flag && ai0 != -2 才持械转向（±2px 死区保原值）
    if (!flag && this.ai0 !== -2) {
      if (this.cx > p.cx + 2) this.dir = 1;
      else if (this.cx < p.cx - 2) this.dir = -1;
    }
    this.hitCd.tick();
    // ---- AI_099_2_Yoyos 参数链（:68802-68808 寿命——★BJ665 精确化 / :68941-68942 射程顶速）----
    // ★BJ640（2026-10-11）方向翻案：原版 meleeSpeed 字段 = CapAttackSpeeds 倒数档 M
    //   （Player.cs:26176 每拍 Update 先翻转,弹 AI 读到的恒为 M<1 档）——正加成
    //   M<1 → (1+M×3)/4<1 → range/=小数=射程【变长】、(1+M)/2<1 → 寿命烧得更快
    //   =原版「攻速越快悠悠球射程越长/滞留越短」。旧注「越快射程越长=方向反」系
    //   把 meleeSpeed 误当攻速和（1/M）——旧式 vms=1/attackSpeedMult=攻速和恰反。
    //   本仓 attackSpeedMult=M（Player.ts:3762 镜像）,vms 直取即原版字段值。
    const vms = p.attackSpeedMult || 1;
    const msRange = (1 + vms * 3) / 4;          // 射程/顶速缩放(:68941)
    let range = YOYO_RANGE[this.projId] ?? 200;
    if (eq.yoyoString) range = range * 1.25 + 30;  // 线圈 yoyoString(:68937-68940;1456 伪锚 :64971 勘正)
    range /= msRange;
    let top = YOYO_TOP[this.projId] ?? 10;
    // 554 双球在场顶速 ×0.75（:68918-68922 `(type == 554) & flag`;1456 伪锚 :68944-68947 勘正——手套二号球防重叠;
    //  蓝队 R7-31：曾缺,双 Kraken 顶速偏高 25%）
    if (this.projId === 554 && flag) top *= 0.75;
    top /= msRange;
    let inertia = Math.max(1, 14 - top / 2);   // num7(:68943-68947;1456 伪锚 :64968-64971 勘正)
    const deadZone = 5 + top / 2 + (flag ? 20 : 0);  // num9 光标死区半径(:68948 + flag:68949-68952;1456 伪锚 :64972/:64976-64978 勘正)
    // 寿命（:68795-68827;1456 伪锚 :64827-64854 勘正）：localAI[0] += 1（flag 另加 rand(10,31)×0.1）→ 秒数
    // ÷(1+meleeSpeed)/2,超 YoyosLifeTimeMultiplier → 回收（并广播全量回收）
    this.lifeT += (1 + (flag ? (10 + Math.floor(Math.random() * 21)) * 0.1 : 0)) / 60 / ((1 + vms) / 2);
    let lifeMul = YOYO_LIFE[this.projId] ?? -1;
    if (eq.yoyoString && lifeMul > 0) lifeMul *= 1.5;
    if (this.ai0 <= -2) lifeMul = -1;   // 脱离/幽灵态寿命无限（:68809-68812;1456 伪锚 :64850-64852 勘正）
    if (lifeMul !== -1 && this.lifeT > lifeMul) {
      this.recallFamily?.();   // :68813-68827（1456 伪锚 :64853-64865 勘正）该玩家所有 aiStyle99 ai0>=0 → -1（含配重球）
      this.ai0 = -1;
    }
    // ---- 603 孢子伴生（:68829-68868,蓝队 R7-30 整缺）——每 6t 反向掷一枚 604 孢子云：
    //  v = velocity×0.25 + 随机向（归一 ×Next(10,41)×0.1,1/3 概率 ×2）;400px 曼哈顿内
    //  有视线敌 → 改朝敌 ×8;×0.8 后 NewProjectile(Center−v, v, 604, damage, knockBack)。
    //  ai[0]!=3 门对悠悠球恒真（ai[0] 存光标 X）;ai0=-1 回收期照掷（原版同门）----
    if (this.projId === 603 && this.ai0 !== 3) {
      this.sporeT++;
      if (this.sporeT >= 6) {
        this.sporeT = 0;
        let svx = this.vx * 0.25, svy = this.vy * 0.25;
        let rx = 0, ry = 0;
        do {
          rx = Math.floor(Math.random() * 201) - 100;
          ry = Math.floor(Math.random() * 201) - 100;
        } while (rx === 0 && ry === 0);
        const rl = Math.hypot(rx, ry) || 1;
        const rm = (10 + Math.floor(Math.random() * 31)) * 0.1 * (Math.floor(Math.random() * 3) === 0 ? 2 : 1);
        svx += (rx / rl) * rm;
        svy += (ry / rl) * rm;
        let best = 400;
        for (const ent of game.enemies()) {
          if (!canBeChasedBy(ent)) continue;          // CanBeChasedBy :91070
          const e2 = ent as { x: number; y: number; w: number; h: number; dead: boolean };
          if (e2.dead) continue;
          const ecx = e2.x + e2.w / 2, ecy = e2.y + e2.h / 2;
          const md = Math.abs(this.cx - ecx) + Math.abs(this.cy - ecy);
          if (md >= best) continue;
          if (!canHit(game.world.store, this.x, this.y, this.w, this.h, e2.x, e2.y, e2.w, e2.h)) continue;
          best = md;
          const dl = Math.hypot(ecx - this.cx, ecy - this.cy) || 1;
          svx = (ecx - this.cx) / dl * 8; svy = (ecy - this.cy) / dl * 8;   // 朝敌 ×8（:68857-68861）
        }
        svx *= 0.8; svy *= 0.8;
        const shot = new Arrow(this.cx - svx, this.cy - svy, svx, svy,
          Math.max(1, Math.round(this.damage)), this.knockback, 604,
          { grav: 0, life: 120, noTileCollide: false });
        (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(shot, 'projectiles');
      }
    }
    // ---- 活跃态（ai0 >= 0,:64983-65148）----
    if (this.ai0 >= 0) {
      if (Math.hypot(this.vx, this.vy) > top) { this.vx *= 0.98; this.vy *= 0.98; }
      const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
      const dPlayer = Math.hypot(p.cx - cx, p.cy - cy);
      const overRange = dPlayer > range;          // flag3:超程减速
      const wayOut = dPlayer > range * 1.3;       // flag4:1.3×超程强制回收
      // channel 门（:65001-65035）：松手/石化/冰冻 → ai0=-1, ai1=0
      const pb = (p as unknown as { buffs?: { has: (b: number) => boolean } }).buffs;
      if (!this.channel() || pb?.has(BuffType.Stoned) || pb?.has(BuffType.Frozen)) {
        this.ai0 = -1;
        this.ai1 = 0;
      } else {
        // 光标目标钳在射程内（:65010-65034）
        const t = this.target();
        let tx = t.x, ty = t.y;
        let tdx = tx - p.cx, tdy = ty - p.cy;
        const td = Math.hypot(tdx, tdy);
        if (td > range) { tdx = (tdx / td) * range; tdy = (tdy / td) * range; tx = p.cx + tdx; ty = p.cy + tdy; }
        // :65038-65050:目标点变化时（ai[0]/ai[1] 存量比对）再钳 range-1——防球贴射程边缘抖动
        if (this.ai0 !== tx || this.ai1 !== ty) {
          let vx2 = tx - p.cx, vy2 = ty - p.cy;
          const vd = Math.hypot(vx2, vy2);
          if (vd > range - 1) { vx2 = (vx2 / vd) * (range - 1); vy2 = (vy2 / vd) * (range - 1); tx = p.cx + vx2; ty = p.cy + vy2; }
          this.ai0 = tx; this.ai1 = ty;
        }
      }
      if (wayOut) this.ai0 = -1;   // flag4（:65059-65063）
      if (this.ai0 >= 0) {
        // 逼近段（:65066-65148）——用 ai0/ai1 存量目标（非实时光标）
        if (overRange) {
          inertia /= 2; top *= 2;
          if (cx > p.cx && this.vx > 0) this.vx *= 0.5;
          if (cy > p.cy && this.vy > 0) this.vy *= 0.5;
          if (cx < p.cx && this.vx < 0) this.vx *= 0.5;
          if (cy < p.cy && this.vy < 0) this.vy *= 0.5;
        }
        if (overRange) inertia = 1;   // flag3 时 num7=1（:65066-65067——velocity 直接取目标向）
        const dx2 = this.ai0 - this.cx, dy2 = this.ai1 - this.cy;
        const d2 = Math.hypot(dx2, dy2);
        if (d2 > deadZone) {
          // lerp 逼近（:65071-65083）：velocity=(v×(num7-1)+dir×min(d/2,top))/num7
          const step = overRange ? Math.min(d2 / 2, top / 2) : Math.min(d2 / 2, top);
          this.vx = (this.vx * (inertia - 1) + (dx2 / d2) * step) / inertia;
          this.vy = (this.vy * (inertia - 1) + (dy2 / d2) * step) / inertia;
        } else if (flag) {
          // 同型前球在场（:65108-65127）：死区内维持 num8×0.6 巡航速（lerp 惯性）
          const sp = Math.hypot(this.vx, this.vy);
          if (sp < top * 0.6) {
            const nvx = sp > 0 ? this.vx / sp * top * 0.6 : 0;
            const nvy = sp > 0 ? this.vy / sp * top * 0.6 : 0;
            this.vx = (this.vx * (inertia - 1) + nvx) / inertia;
            this.vy = (this.vy * (inertia - 1) + nvy) / inertia;
          }
        } else {
          this.vx *= 0.8; this.vy *= 0.8;  // 死区内衰减(:65144)
        }
        if (flag && !overRange && Math.hypot(this.vx, this.vy) < top * 0.6) {
          // :65129-65137 尾段：直接归一到 num8×0.6（零速保持零——SafeNormalize(Zero)）
          const sp = Math.hypot(this.vx, this.vy);
          if (sp > 0) { this.vx = this.vx / sp * top * 0.6; this.vy = this.vy / sp * top * 0.6; }
        }
      }
    }
    // ---- 魔法线（:65110-65116）：-1 回收态 + magicString → -3 幽灵 + 掷 75% 伤/击退
    //      脱离克隆（本球速度/中心,ai0=-2 出生;伤害 (int) 截断）----
    if (this.ai0 === -1 && eq.magicString) {
      this.ai0 = -3;
      this.spawnClone?.(this.cx, this.cy, this.vx, this.vy,
        Math.trunc(this.damage * 0.75), Math.trunc(this.knockback * 0.75));
    }
    if (this.ai0 === -3) { this.ghost = true; this.damage = 0; }   // :65117-65119
    // ---- ★通用湿段（:16903-17113;projWetSection 共享体——四液旗/出入水溅花/
    //      wetCount。位序 = 原版 Update AI(:16880) → 湿段(:16895) → HandleMovement
    //      (:17120):本仓 AI_099_2 全部 velocity 编辑（活跃逼近/-2 重力/回收 lerp）
    //      到此跑完,位移在下方（回收直积分/活跃·脱离 moveAndCollide）——恰插本位。
    //      湿段只读 position 不读 velocity;AI 无 position 写面 → 测位=上拍位移后同位,
    //      与原版 post-AI 位一致。三态全受段（原版湿段门只有 !ignoreWater :16895,
    //      与 ai[0] 无关）;域 id 全不豁免（字段块注）,ignoreWater 仍按数据面传）----
    //  ★⑧Shimmer() 接面（2026-09-07 缺面清单清偿）：域全 aiStyle 99 → 悠悠球支
    //  （P.cs:22656-22668）——vy>0 弹反+shimmerWet/wet 双清 + vy>-8 → -8 强制上收;
    //  头门 :22566 ai[0]==-1（回收态）早退,-2 脱离/-3 幽灵照跑（原版只拦 -1）。
    //  面适配：ai0≡ai0/ai1≡ai1（AI_099 状态机同名字段）;hostile=false（域全
    //  friendly）;99 支无 timeLeft/ai 写面（原版 timeLeft 每帧重置 :64942,本仓 life
    //  不回写）+无 Kill（深浸 Kill 属弹反族 A/B）→ 各面零消费。双清旗即出微光域,
    //  下拍湿段重采样重置——弹反当拍位移走干态阻尼（:17721 段后原版同位）。
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater, {
        shimmer: (st, x, y, _w, _h) => {
          const sf: ProjShimmerFace = {
            projId: this.projId,
            aiStyle: projectileData(this.projId)?.aiStyle ?? -1,
            hostile: false,
            vx: this.vx, vy: this.vy,
            timeLeft: this.life,
            ai0: this.ai0, ai1: this.ai1,
            wet: this.wet, shimmerWet: this.shimmerWet,
            rainbowSlimeUnlocked: false,
          };
          projShimmerStep(sf, st, x, y, this.cx);
          this.vx = sf.vx; this.vy = sf.vy;
          this.wet = sf.wet; this.shimmerWet = sf.shimmerWet;
        },
      });
    // ---- 状态尾段（:65118-65177）----
    if (this.ai0 === -2) {
      // 脱离坠落（:65118-65151）：penetrate 懒置 Next(3,7)、重力 0.3、速度上限 16、
      // vy≤3 缓落水平漂移 ±0.1（num8 钳 16）
      if (this.pierceLeft < 0) this.pierceLeft = 3 + Math.floor(Math.random() * 4);
      this.vy += 0.3;
      const sp = Math.hypot(this.vx, this.vy);
      if (sp > 16) { this.vx = this.vx / sp * 16; this.vy = this.vy / sp * 16; }
      else if (this.vy <= 3) {
        const cap = Math.min(top, 16);
        if (Math.abs(this.vx) < 0.1) {
          if (this.cx < p.cx) { this.vx -= 0.1; this.dir = -1; }
          else { this.vx += 0.1; this.dir = 1; }
        } else if (this.vx > 0 && this.vx < cap) this.vx += 0.1;
        else if (this.vx < 0 && this.vx > -cap) this.vx -= 0.1;
      }
    } else if (this.ai0 < 0) {
      // 回收态（ai0=-1/-3;1457 :69131-69150）：惯性 ×0.8 浮点（1456 为
      // (int)(n*0.8) 整截断,回收力度曲线阶梯化——浮点后连续衰减）、顶速 ×1.5、穿墙,
      // lerp 朝玩家;距手 <num8+10 或 >2000 → Kill
      inertia *= 0.8;
      top *= 1.5;
      const dx = p.cx - this.cx;
      const dy = p.cy - this.cy;
      const d = Math.hypot(dx, dy);
      if (d < top + 10 || d === 0 || d > 2000) { this.dead = true; return; }
      this.vx = (this.vx * (inertia - 1) + (dx / d) * top) / inertia;
      this.vy = (this.vy * (inertia - 1) + (dy / d) * top) / inertia;
      // 位移分叉（原版回收态 tileCollide=false :69138 → HandleMovement 湿阻尼分支
      //  :17721 整体在 if(tileCollide) :17585 内【不跑】;UpdatePosition :20555-20562：
      //  wet → position += wetVelocity（:16870 AI 前快照=本拍入速 preVx/preVy,无阻尼
      //  ——湿态回收位移滞后一子步 = 原版 quirk 本体）;dry → position += velocity
      //  （post-lerp,原版同构））
      if (this.wet) { this.x += preVx; this.y += preVy; }
      else { this.x += this.vx; this.y += this.vy; }
      // ★BJ285（BJ232 死亡段割面族,2026-09-22）：回收态命中照结算 → CutTiles（:12517）
      //  先于 Damage_PVE（:12523）前置习语（活跃态同款见下方主结算位）。
      cutTilesBox(game, this.x, this.y, this.w, this.h);
      // ★BJ344 F2：dirOverride = 自动向 sign(vx,0→1)（:17121-17131 同子步先于 :17184
      //  Damage;aiStyle 99 不在 :17389 排除表——AI 期玩家相对写 :68892-68902/:69111-69122
      //  被同子步覆写,存活效应只有玩家 ChangeDir/绘制;this.dir 保留给绘制/命中链）
      hitEnemies(this, game, this.hitCd, 10, this.dir, this.armorPen,
        (e) => this.onYoyoHit(e, game), undefined, true,
        undefined, 0, this.vx < 0 ? -1 : 1);
      return;
    }
    // ---- 活跃/脱离态移动+碰撞（原版 yoyo tileCollide=true 撞墙滑动;
    //      回收态上方已穿墙直积分返回）----
    const lvy = this.vy;
    // ★水中位移阻尼（HandleMovement :17721-17764,湿段批）——速度【场】不减只削当拍
    //  位移（原版 wetVelocity = post-TileCollision velocity×0.5/0.25/0.375,仅进
    //  UpdatePosition :20557 `if (wet) position += wetVelocity`;dry 走 :20561
    //  `position += velocity`）。阻尼只乘进 dx/dy 位移入参,velocity 字段不动——
    //  -2 反弹式（-lvy×0.6=未阻尼 lastVelocity :17696/:18517,原版同构）与命中链
    //  反弹（this.vx 读数=velocity 域）全不受阻尼影响。逐轴 passthrough 差
    //  （TileCollision 改速轴不阻尼 :17728-17733）= moveAndCollide 共享契约外登记
    //  （GrenadeProj/Boomerang 同批同口径）。
    const drag = projWaterDragFactor(this);
    moveAndCollide(this, game.world, this.vx * drag, this.vy * drag);
    if (this.ai0 === -2) {
      // 脱离态撞块（:16988-17006）：竖撞 lastVy>4 → 弹起 ×-0.6;横撞 → HitTiles 尘 +
      // SoundID 0 + Kill
      if ((this.onGround || this.hitHead) && lvy > 4) this.vy = -lvy * 0.6;
      if (this.hitWall) {
        game.spawnParticles(this.cx, this.cy, '#A09080', 3, 1.5, { life: 14, size: 2 });   // HitTiles 尘
        game.playSfx('dig', 1, this.cx, this.cy);   // SoundID 0
        this.dead = true;
        return;
      }
    }
    // 命中免疫 = 玩家级共享 10t（DefaultToYoyo 无 usesLocalNPCImmunity/
    // localNPCHitCooldown,Projectile.cs:10155-10161 → Damage_PVE 走 npc.immune[owner]
    // 全局档 :12603/:12635-12637/:13152（★BJ340 表面勘误:旧锚 :11905 漂）——同玩家所有悠悠球/配重球共享,不再逐弹私账）
    // ★BJ285（BJ232 死亡段割面族,2026-09-22）：CutTiles（Projectile.cs:12517 调用点/方法 :15276）先于 Damage_PVE
    //  （:12523）——回收态命中照结算（onYoyoHit 弹开段）;aiStyle 99/悠悠球族均过两道门
    //  （CanCutTiles :15407 两表均无;CanDealDamage :12461 无）。死亡拍（脱离态
    //  penetrate 3-6 耗尽 :13290 段）照割,中央割 !e.dead 门=死亡拍整缺。
    cutTilesBox(game, this.x, this.y, this.w, this.h);
    // ★BJ344 F2：dirOverride = 自动向 sign(vx,0→1)（同上注;本位 this.vx = moveAndCollide
    //  写回后值 = 原版 HandleMovement 后自动向读数同相）
    hitEnemies(this, game, this.hitCd, 10, this.dir, this.armorPen,
      (e) => this.onYoyoHit(e, game),
      (e, d) => {
        // ★BJ388 件2（BJ344 债清偿,2026-09-28）：dmgScale 改约 = DV int 上的逐段
        // 先截后乘——活跃态对玩家无视线 → (int)(dmg×0.75)（:13318,ai[0]>=0 支内
        // localAI[0]+=40 同拍;寿命快捷烧面在 onYoyoHit）;随后 555/546 里程碑
        // (int)(dmg×2)（:13428-13437,flag8=!immortal 假人豁免）——原版两段可同时
        // 命中（旧单返式 0.75/2 互斥=合成缺口,同刀修）
        let v = d;
        if (this.ai0 >= 0
          && !canHit(game.world.store, this.x, this.y, this.w, this.h, p.x, p.y, p.w, p.h)) {
          v = Math.trunc(v * 0.75);
        }
        // 1457 per-hit 族伤害乘区（countUp:false 只读不加,:13424-13436）：
        // 555 Yelets 每 7 击 ×2、546 Artery 每 3 击 ×2——里程碑判定与 onYoyoHit
        // 的生成掷（countUp:true 自增）同 tick 先后求值,共享计数器读数一致
        if ((this.projId === 555 && p.yoyoHitCounter % 7 === 0
          || this.projId === 546 && p.yoyoHitCounter % 3 === 0)
          && (e as { immortal?: boolean }).immortal !== true) {
          v = Math.trunc(v * 2);
        }
        return v;
      }, true, undefined, 0, this.vx < 0 ? -1 : 1);
    // ★BJ235 残影记录（UpdateTrails :17198=Damage 后同序;563 之外 mode -1 → null 短路。
    //  -2 脱离撞块杀在上方早退=原版 :17132 同相不记录）
    if (this.ghostRing === undefined) {
      this.ghostRing = projTrailingMode(this.projId) >= 0 ? new ProjGhostRing(this.projId) : null;
    }
    this.ghostRing?.record(this.x, this.y, this.rot, this.dir, true);
  }

  /** 命中链（Projectile.cs:13290-13335 aiStyle 99 段——1456 伪锚 :12467-12508 勘正（BJ661 复核 :13290-13335）
   *  R17-F4;活跃反弹+烧段 :13315-13333（烧段 :13327-13333——★BJ665 精确化,旧区间 :13323-13333）):-2 只被弹开（不触发
   *  Counterweight）;其余调 Counterweight + 方向定号;ai0>=0 活跃反弹 +
   *  localAI[0] += 20（无视线 +40,寿命快捷烧） */
  private onYoyoHit(e: unknown, game: GameHooks) {
    const p = game.player;
    const ecx = (e as { x: number; w: number }).x + (e as { x: number; w: number }).w / 2;
    const ecy = (e as { y: number; h: number }).y + (e as { y: number; h: number }).h / 2;
    if (this.ai0 === -2) {
      // 脱离态被弹开（:13292-13303;1456 伪锚 :12469-12477 勘正）：速度 ÷5 + 上抛 Next(50,81)×0.1 钳 -16;
      // 穿透自减（penetrate 3-6 尽 → Kill）——★不 return：原版 Damage() 内弹开段
      // (:13292;1456 伪锚 :12469 勘正)与 per-hit 族段(:13761+)同函数先后执行,554/546/555 无 ai[0]!=-2 门
      this.vx /= 5; this.vy /= 5;
      this.vy -= (50 + Math.floor(Math.random() * 31)) * 0.1;
      if (this.vy < -16) this.vy = -16;
      if (--this.pierceLeft <= 0) this.dead = true;
    } else {
      this.counterweight?.(ecx, ecy, this.damage, this.knockback);   // :13306（1456 伪锚 :12482 勘正）
      this.dir = ecx < p.cx ? -1 : 1;   // :13307-13314（1456 伪锚 :12484-12489 勘正）
      if (this.ai0 >= 0) {
        // 活跃态命中反弹（:13315-13333;1456 伪锚 :12490-12500 勘正）：v×-0.5 + 离敌向 ×num25（缺省 16;554 Kraken
        //  =4 :13300-13302——命中后贴敌续磨,连击率;蓝队 R7-32：曾恒 16,Kraken 命中即弹远）
        const push = this.projId === 554 ? 4 : 16;
        let bx = this.cx - ecx, by = this.cy - ecy;
        const bd = Math.hypot(bx, by) || 1;
        this.vx = this.vx * -0.5 + (bx / bd) * push;
        this.vy = this.vy * -0.5 + (by / bd) * push;
        // 寿命快捷烧（:13327-13333——★BJ665 精确化,旧区间 :13323-13333;1456 伪锚 :12501-12505 勘正 R17-F1/F4）：vanilla
        // localAI[0] += 20f（:13327）;无视线再 +40f（:13330）【无除式】,除式只在寿命换算
        // :68803 num /= (1f+meleeSpeed)/2——本仓预除模型两站同 M（与 :3500 同款直取）
        const noLos = !canHit(game.world.store, this.x, this.y, this.w, this.h, p.x, p.y, p.w, p.h);
        const vms = p.attackSpeedMult || 1;   // ★R17-F1 直取 M;旧式 1/(attackSpeedMult||1)=攻速和,命中烧方向反
        this.lifeT += (noLos ? 60 : 20) / 60 / ((1 + vms) / 2);
      }
    }
    // ---- 999 HiveFive 每击 1/3 放蜂（★M3 2026-09-02 补,P4 遗留；Projectile.cs:13752-13760）----
    // 原式：type==999 && owner==Main.myPlayer && Next(3)==0 →
    //   NewProjectile(Center.X, Center.Y, (Center−target.Center).SafeNormalize(Zero)×0.25,
    //   player.beeType(), player.beeDamage(damage/2), player.beeKB(knockBack), owner)
    //   + 落桶后 `.melee = true` 覆写（Z-F1 槽语义,Arrow.projClass='melee'）。
    // ★无 ai[0] 门（同函数 545 支的 ai[0]!=-2 门在下一块）——回收(-1)/脱离(-2)态命中同享
    //   放蜂;SafeNormalize(Zero)=零向量档（球心与敌心重合）→ 零速出蜂。
    // 伤基口径同 per-hit 族（545 ×2/554 ×0.5 用 this.damage 源值）：dmg2=trunc(damage/2)
    //   ——vanilla 此处 damage 为结算局地值,族内既定 this.damage 直取（登记在先勿重复登记）
    if (this.projId === 999 && Math.floor(Math.random() * 3) === 0) {
      const bgx = this.cx - ecx, bgy = this.cy - ecy;
      const bgd = Math.hypot(bgx, bgy);
      this.spawnBee?.(this.cx, this.cy,
        bgd > 0 ? (bgx / bgd) * 0.25 : 0,
        bgd > 0 ? (bgy / bgd) * 0.25 : 0,
        Math.trunc(this.damage / 2), this.knockback);
    }
    // ---- 1457 EverySomeYoyoHits per-hit 族（Projectile.cs:13761-13870,批 D 落地）----
    // 545 Cascade 每 2 击 → 1125 CascadeExplosion ×200%（208px 最近敌向,scale=
    //   max(0.22+0.22r, dist/200) 钳 1.5,触发敌 localImmunity -1;ai[0]!=-2 门）
    // 554 Kraken 每 4 击 → 3× 1135 KrakenWave ×50%（触发向 ±0.2π 扇,速 18+8r,
    //   IDStatic 免疫 10t 三波共享）
    // 546 Artery 每 3 击 → 5× 1134 CrystalShardMelee ×100%（矩形随机速 ±4,
    //   IDStatic 免疫 20t 共享,首颗 ai[0]=0 其余 1）
    // 555 Yelets 每 7 击 → 1130 TheEyeOfCthulhuDash ×200%（80px 最近敌向 ×14,
    //   触发敌 localImmunity -1）
    // 计数器 = Player.yoyoHitCounter（:1203 初始 -1 → 首击 -1%N≠0 不触发,原版同款）;
    // 546/555 的伤害 ×2 乘区（:13428/:13434 countUp:false 只读）在本 tick dmgScale 侧
    if (this.spawnShot) {
      const victimId = (e as { id: number }).id;
      // 最近敌搜索（:13765-13781 同构：CanBeChasedBy 口径 + LOS/noTileCollide + 排除触发敌;
      // 距离 = Hitbox.ClosestPointInRect(Center)）
      const closest = (b: { x: number; y: number; w: number; h: number }): [number, number, number] => {
        const px = Math.max(b.x, Math.min(this.cx, b.x + b.w));
        const py = Math.max(b.y, Math.min(this.cy, b.y + b.h));
        return [px, py, Math.hypot(px - this.cx, py - this.cy)];
      };
      const findNearest = (maxD: number): { x: number; y: number; w: number; h: number; d: number } | null => {
        let best: { x: number; y: number; w: number; h: number; d: number } | null = null;
        for (const q of game.enemies()) {
          const n = q as { x: number; y: number; w: number; h: number; id: number; dead: boolean;
            maxHp: number; def?: { friendly?: boolean; critter?: boolean; noTileCollide?: boolean } };
          if (n.dead || n.id === victimId || n.maxHp <= 5 || n.def?.friendly || n.def?.critter) continue;
          if (!n.def?.noTileCollide
            && !canHit(game.world.store, this.x, this.y, this.w, this.h, n.x, n.y, n.w, n.h)) continue;
          const [, , d] = closest(n);
          if (d < maxD) { maxD = d; best = { ...n, d }; }
        }
        return best;
      };
      const jit = () => (Math.random() * 2 - 1) * Math.PI * 2 * 0.025;   // NextFloatDirection×2π×0.025
      if (this.projId === 545 && this.ai0 !== -2 && p.everySomeYoyoHits(2, true)) {
        const t = findNearest(208);
        let ang = Math.PI * 2 * Math.random();
        let dist = 0;
        if (t) { const [px, py, d] = closest(t); ang = Math.atan2(py - this.cy, px - this.cx); dist = d; }
        let scale = 0.22 + 0.22 * Math.random();       // :13787 num46
        if (scale < dist / 200) scale = dist / 200;    // :13789-13791
        if (scale > 1.5) scale = 1.5;
        const a = ang + jit();
        this.spawnShot({ x: this.cx, y: this.cy, vx: Math.cos(a) * 1.1, vy: Math.sin(a) * 1.1,
          projId: 1125, dmg: this.damage * 2, kb: this.knockback, scale, excludeId: victimId });
      } else if (this.projId === 554 && p.everySomeYoyoHits(4, true)) {
        const base = Math.atan2(ecy - this.cy, ecx - this.cx);   // :13805 spinningpoint2
        const waveCd = new HitCooldown();                        // IDStatic 10（:10667）三波共享
        for (const l of [-2, 0, 2]) {
          const a = base + l * Math.PI * 2 * 0.05 + jit();
          const spd = 18 + 8 * Math.random();                    // :13808（×(1-0×|l|)=1）
          this.spawnShot({ x: this.cx, y: this.cy, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
            projId: 1135, dmg: this.damage * 0.5, kb: this.knockback, sharedCd: waveCd });
        }
      } else if (this.projId === 546 && p.everySomeYoyoHits(3, true)) {
        const shardCd = new HitCooldown();                       // IDStatic 20（:10653）五片共享
        for (let m = 0; m < 5; m++) {
          const vx0 = Math.random() * 8 - 4;                     // NextVector2Circular(8,8) 矩形均匀
          const vy0 = Math.random() * 8 - 4;
          const ja = jit();                                      // .RotatedBy(NextFloatDirection×2π×0.025)
          this.spawnShot({ x: this.cx, y: this.cy,
            vx: vx0 * Math.cos(ja) - vy0 * Math.sin(ja), vy: vx0 * Math.sin(ja) + vy0 * Math.cos(ja),
            projId: 1134, dmg: this.damage, kb: this.knockback, sharedCd: shardCd,
            ai0: m === 0 ? 0 : 1 });   // ★SW-BJ17：NewProjectile 第 9 参 (m != 0)?1:0
                                       // （:13834）——1134 出生音门 ai[0]==0 唯首颗出声
        }
      } else if (this.projId === 555 && p.everySomeYoyoHits(7, true)) {
        const t = findNearest(80);
        let ang = Math.PI * 2 * Math.random();
        if (t) { const [px, py] = closest(t); ang = Math.atan2(py - this.cy, px - this.cx); }
        const a = ang + jit();
        this.spawnShot({ x: this.cx, y: this.cy, vx: Math.cos(a) * 14, vy: Math.sin(a) * 14,
          projId: 1130, dmg: this.damage * 2, kb: this.knockback, excludeId: victimId });
      }
    }
  }
}

// ================= 悠悠球 per-hit 族伴生弹（1457 EverySomeYoyoHits 家族） =================

/** YoyoShotProj——1457 新弹 1125/1130/1134/1135（Projectile.cs:10530-10670 SetDefaults +
 *  AI_189 1125 支 :43034+ / AI_210 :37480-37570）。共同:SetDefaults tileCollide=false、
 *  friendly/melee、无重力。逐型：
 *   1125 CascadeExplosion（aiStyle 189）:32×32、alpha 255、hide=true（原版不画本体,
 *    视觉=AI_189 首帧尘/软木爆炸）、5 帧 ×2t=10t 存活、scale=ai[1]、
 *    usesLocalNPCImmunity+cooldown -1（每弹每敌一次;出生时对触发敌 localNPCImmunity=-1）
 *   1130 TheEyeOfCthulhuDash（aiStyle 210,SetDefaults :10599-10610）:100×100、penetrate -1、
 *    scale=1、AI 20t 存活（velocity ×0.92/t、α=MultiLerp 渐显 :37517-37518、frame 3-5 @6t
 *    :37504-37512、出生音 :37485-37502）、local 免疫 -1。
 *    ★红队 B#4 勘误（2026-09-03 逐行核 1457 原文）：「damage/kb 按 Remap 递增(:37648-37651)/
 *    penetrate=num7 重置/scale=Remap(:37694)/成长尾尘(:37743)」全属 AI_208_GlacierFangShot
 *    = 1115（aiStyle 208 :10407;proj1457.ts GlacierFangShot 已实装 damage×4/kb×4/pen1-3 曲线）,
 *    非 1130——AI_210(:37480-37526)对 1130 无任何 damage/kb/penetrate/scale 写面,不移植防假对齐。
 *    （数据层台账"1130 出生路径=蜜雷锋爆裂 WeaponProj.ts:3022"同系张冠李戴:蜜雷锋=物品 1130
 *    Beenade,爆裂=Arrow.ts beenadeBurst 放蜂 181/566;弹 1130 唯一出生路径=555 Yelets 每 7 击
 *    →×200% 冲撞,本文件 onYoyoHit spawnShot 支。）
 *   1134 CrystalShardMelee（aiStyle 24）:6×6、penetrate 1、light 0.5、alpha 50、
 *    scale 1.2、timeLeft 600、usesIDStaticNPCImmunity+cooldown 20（同型共享 20t 静态免疫）
 *   1135 KrakenWave（aiStyle 210）:100×100、penetrate -1、AI 同 1130（无帧动画,
 *    rotation=速度向;首 6-7t 尘尾）、IDStatic 免疫 10（三波共享） */
/** Utils.MultiLerp（Utils.cs:279-288）——等宽分段线性锚点插值（AI_210 α 曲线 :37517-37518） */
function utilMultiLerp(percent: number, floats: readonly number[]): number {
  const seg = 1 / (floats.length - 1);
  let lo = 0;
  let hi = seg;
  while (percent / hi > 1 && lo < floats.length - 2) {
    hi += seg;
    lo++;
  }
  return floats[lo] + (floats[lo + 1] - floats[lo]) * ((percent - seg * lo) / seg);
}
/** AI_210 α 插值锚（:37517/:37532）：MultiLerp(localAI[0]/20, 0,1,1,1,0.5,0) */
const YOYO_SHOT_ALPHA_ANCHORS: readonly number[] = [0, 1, 1, 1, 0.5, 0];

export interface YoyoShotSpec {
  x: number; y: number;          // 出生中心（NewProjectile 居中语义,构造内换算盒左上）
  vx: number; vy: number;
  projId: number;
  dmg: number; kb: number;
  scale?: number;                // 1125/1130 的 ai[1]（缩放）
  excludeId?: number;            // localNPCImmunity[victimIndex]=-1（触发敌免中本弹）
  sharedCd?: HitCooldown;        // IDStatic 免疫共享（1134/1135 同型各弹共用一张表）
  ai0?: number;                  // NewProjectile 第 9 参 ai[0]（1134:546 出膛首颗 0 余四颗 1,:13834）
}
export class YoyoShotProj extends Entity {
  damage: number;
  knockback: number;
  projId: number;
  critChance = 0.04;
  armorPen = 0;
  meleeProj = true;
  dead = false;
  lightRGB: [number, number, number] | null = null;
  life = 10;
  private scale: number;
  private excludeId: number;
  private sharedCd: HitCooldown | null;
  private ownCd = new HitCooldown();     // local 免疫（1125/1130 每弹一张）
  private age = 0;                       // localAI[0]（AI_210 20t 寿命 / 1125 帧计数）
  private ai0 = 0;                       // NewProjectile 第 9 参 ai[0]（:13834 1134 首颗 0 余 1）
  private rotation = 0;                  // 1134 累计旋转（AI_024 :26293 rotation += vx×0.2）
  private alphaVal = 0;                  // 原版 alpha（SetDefaults 缺省 0;AI_210 每拍覆写 :37518/:37533）
  private frame = 0;
  private frameCounter = 0;
  // ---- ★通用湿段（Projectile.cs:16903-17113;2026-09-06 R3 漏网类批 11 类之一）----
  //  域 id 分流（R3 定谳）：1125 CascadeExplosion 受【豁免】——SetDefaults :10530-10541
  //  显式 ignoreWater=true（:10530 块）→ 数据面分流自动跳段（传入 ignoreWater 即可,
  //  段门 :16903 恒闭）;1130(:10600 块)/1134(:10639 块)/1135(:10656 块) 均无 ignoreWater
  //  行 → 受段。★阻尼不适用定谳（蓝队 K 2026-09-07 位移缺面批核）：四型 tileCollide=
  //  false（:10537/:10599/:10640/:10657）→ HandleMovement 湿阻尼块 :17721 在
  //  if(tileCollide) 内不跑——【无档位湿阻尼】,湿态位移消费 = wetVelocity 快照本体。
  //  ★位移积分（同批定谳+补）:原版位移在 HandleMovement 尾 UpdatePosition（:19973 →
  //  :20549-20562）——早退表（:20551-20553）【含 1125】= 零位移积分（爆炸尘原地,
  //  原版同）;【不含 1130/1134/1135】= position += velocity（dry）/ wetVelocity（wet）。
  //  旧注「本仓亦无位移积分位」系 R3 批误账（把缺面当等价留锚）——1130/1134/1135
  //  出生即静止=移动域功能缺面,同批补整条位移链（AI 速度阻尼 + UpdatePosition 积分,
  //  见 fixedUpdate）。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价——出生盒同位测值） */
  presetDone = false;   // ProjWetFlags.presetDone（共享湿段旗持有者）

  constructor(spec: YoyoShotSpec) {
    super();
    const pd = projectileData(spec.projId);
    this.w = pd?.width ?? 16; this.h = pd?.height ?? 16;
    this.x = spec.x - this.w / 2; this.y = spec.y - this.h / 2;   // NewProjectile 居中(:10238)
    this.vx = spec.vx; this.vy = spec.vy;
    this.projId = spec.projId;
    this.damage = Math.max(1, Math.trunc(spec.dmg));
    this.knockback = spec.kb;
    this.scale = spec.scale ?? 1;
    this.ai0 = spec.ai0 ?? 0;
    this.excludeId = spec.excludeId ?? -1;
    this.sharedCd = spec.sharedCd ?? null;
    if (spec.projId === 1125) {
      // AI_189 :43034-43041 首帧 SoundID.DD2_ExplosiveTrapExplode——WAV_MAP dd2Explosive
      // 三变体在盘（public/sounds/dd2_explosive_trap_explode_{0..2}.wav）,原 'explosion'
      // 合成兜底近似退役（终清波）
      this.life = 10;                      // 5 帧 ×2t（:43056-43063 frame>=5 → Kill）
    } else if (spec.projId === 1130 || spec.projId === 1135) {
      this.life = 20;                      // AI_210 :37516/:37540 localAI[0]>=20 → Kill
    } else {
      this.life = pd?.timeLeft ?? 600;     // 1134 timeLeft 600（:10650）
      this.scale = pd?.scale ?? 1;         // 1134 scale=1.2（:10648）——AI_024 收缩起点(:26347)
    }
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    this.age++;
    if (--this.life <= 0) { this.dead = true; return; }
    // ★wetVelocity 快照（:16870 `Vector2 wetVelocity = velocity` 在 AI【前】捕获——
    //  AI_210/AI_024 的 ×0.92/×0.96 都发生在捕获后;四型 tileCollide=false → 湿阻尼块
    //  不改写快照 → 湿态位移=AI 前 undamped 快照,滞后一子步 quirk（GrenadeProj 37 /
    //  YoyoProj 回收段同款））
    const preVx = this.vx, preVy = this.vy;
    if (this.projId === 1125) {
      // AI_189_Volcano 1125 档（1458 :43031-43110——终清波逐参实装,合成两粒退役）：
      //   num=num2=8 → 圆形抖动域 Circular(8,8);num4=0.3;num3(RotatedBy)=0;
      //   scale=ai[1]（视觉）;ai[0]==1 帧一次性:
      //     d6 ×20(NPD α200 s1+r, vel=v.RotBy(±π/4×0.3)×(2+5r)) +
      //     烟 d31 ×(rand(3,7)/3)*5(α50 s1+r noGravity vel 同上后 ×3) +
      //     gore 61-63 ×(rand(3,7)/3)(NPD vel×4r 后 ×1.7,GorePiece.newGore 承载);
      //   每 AI 帧 rand(3)<2 → d6 烟团(NPD α90 s2.5 noGravity fadeIn1)
      //   首帧 soundDelay==0 → DD2_ExplosiveTrapExplode 三变体随机(:43034-43041,
      //   public/sounds/dd2_explosive_trap_explode_{0..2}.wav 在盘资产)
      const circ = (): { dx: number; dy: number } => {
        const a = Math.random() * Math.PI * 2;
        const m = Math.random() * 8;
        return { dx: Math.cos(a) * m, dy: Math.sin(a) * m };
      };
      const rotVel = (mul: number, num4 = 0.3): { x: number; y: number } => {
        const a = (Math.random() * 2 - 1) * (Math.PI / 4) * num4;   // NextFloatDirection×π/4×num4
        const ca = Math.cos(a), sa = Math.sin(a);
        return { x: (this.vx * ca - this.vy * sa) * mul, y: (this.vx * sa + this.vy * ca) * mul };
      };
      const d6Puff = (): void => {
        const o = circ(), v = rotVel(1.5 + 2 * Math.random(), 1);   // 烟团无 num4 缩放(:43098)
        game.spawnDust?.(this.cx + o.dx - 8, this.cy + o.dy - 8, 16, 16, 6,
          v.x, v.y, 90, null, 2.5, true, true);
      };
      if (this.age === 1) {
        game.playSfxFiles(['dd2_explosive_trap_explode_0', 'dd2_explosive_trap_explode_1',
          'dd2_explosive_trap_explode_2'], 1, this.cx, this.cy);
        for (let i = 0; i < 20; i++) {                              // d6 火尘×20
          const o = circ(), v = rotVel(2 + 5 * Math.random());
          game.spawnDust?.(this.cx + o.dx - 8, this.cy + o.dy - 8, 16, 16, 6,
            v.x, v.y, 200, null, 1 + Math.random(), false, true);
        }
        const num7 = Math.floor((3 + Math.floor(Math.random() * 4)) / 3);   // rand(3,7)/3 int 除
        for (let j = 0; j < num7 * 5; j++) {                        // 烟 d31（vel 后置 ×3）
          const o = circ(), v = rotVel(2 + 5 * Math.random());
          const d = game.spawnDust?.(this.cx + o.dx - 8, this.cy + o.dy - 8, 16, 16, 31,
            v.x * 3, v.y * 3, 50, null, 1 + Math.random());
          if (d) d.noGravity = true;
        }
        for (let k = 0; k < num7; k++) {                            // 壳 gore 61-63（vel ×1.7）
          const o = circ(), v = rotVel(4 * Math.random());
          GorePiece.newGore(61 + Math.floor(Math.random() * 3),
            this.cx + o.dx, this.cy + o.dy, v.x * 1.7, v.y * 1.7);
        }
      }
      if (Math.floor(Math.random() * 3) < 2) d6Puff();              // 每 AI 帧 rand(3)<2 烟团
    } else if (this.projId === 1130 || this.projId === 1135) {
      // AI_210（:37480-37570）：velocity ×0.92/t;1130 rotation=速度向−π/2、
      // frame 3-5 @6t;1135 rotation=速度向 + 首 20/3 t 每帧 8 尘（33 号,1/3 换 302）
      this.vx *= 0.92; this.vy *= 0.92;
      if (this.projId === 1130) {
        // 出生音（localAI[0]==0 门 = 首拍,:37485-37502）：Next(100)==0 → Roar_0 彩蛋吼
        // （legacy 15/LegacySoundPlayer.cs:829 与 36/:1316 皆 SoundRoar[0]）×0.3、
        // pitch 0.1−rand×0.2;否则 Item_20 ×0.08（盘上 Item_20.wav/Roar_0.wav 在库）
        if (this.age === 1) {
          if (Math.floor(Math.random() * 100) === 0) {
            game.playSfxWav?.('Roar_0', 0.3, this.cx, this.cy, 0.1 - Math.random() * 0.2);
          } else {
            game.playSfxWav?.('Item_20', 0.08, this.cx, this.cy);
          }
        }
        this.frameCounter++;
        if (this.frameCounter >= 6) { this.frameCounter = 0; this.frame++; }
        if (this.frame < 3 || this.frame >= 6) this.frame = 3;   // :37510-37512（projFrames=6）
      } else if (this.age <= 6) {
        // AI_210 1135 尘尾（Projectile.cs:37548-37580）：首 num2/3=20/3≈6.667 拍
        //  （localAI[0] 自增后 ∈{1..6} ⟺ this.age≤6）每帧 8×尘——
        //  Dust.NewDustPerfect(Center+NextVector2Circular(8,8), Next(3)==0?302:33,
        //  velocity)（位/速完整覆写,烟雾族/33 族 NewDust 速度特例被消解;33 族的
        //  NewDust :232-237 alpha=170 不在覆写面=入池即 ⅓ 亮度,见 VanillaDust.spawn）,
        //  随后 scale=1+1.5×NextFloat（:37555,覆写池值）、velocity=RotatedBy(
        //  NextFloatDirection×τ×0.15)×0.7（:37556-37557）;302 支（:37558-37565）:
        //  scale=1.2、fadeIn=0、vel×0.63、noGravity/noLight/noLightEmittance 全 true;
        //  33 支（:37566-37575）:vel×(0.5+0.5×NextFloat)×0.65、noGravity=Next(4)!=0、
        //  noGravity 时 vel×2。掷序=Next(3)→Circular(8,8)×2→scale→旋→(33 支)幅→Next(4)。
        for (let i = 0; i < 8; i++) {
          const as302 = Math.floor(Math.random() * 3) === 0;        // :37551 Next(3)==0（掷①）
          const a0 = Math.random() * Math.PI * 2;                   // :37554 Circular(8,8) 掷②③（角均匀+半径线性盘）
          const r0 = Math.random();
          const scl = 1 + 1.5 * Math.random();                      // :37555 掷④（302 支被 :37558 覆写=原版同掷）
          const ja = (Math.random() * 2 - 1) * Math.PI * 2 * 0.15;  // :37556 掷⑤ NextFloatDirection×τ×0.15
          const cj = Math.cos(ja), sj = Math.sin(ja);
          const rvx = (this.vx * cj - this.vy * sj) * 0.7;          // :37556 RotatedBy → :37557 ×0.7
          const rvy = (this.vx * sj + this.vy * cj) * 0.7;
          let vx = rvx, vy = rvy, sclF = scl, ng = false;
          let noLightF = false, noEmF = false;
          if (as302) {                                              // :37558-37565 302 支
            sclF = 1.2;
            vx *= 0.63; vy *= 0.63;
            ng = true; noLightF = true; noEmF = true;
          } else {                                                  // :37566-37575 33 支
            const kf = 0.5 + 0.5 * Math.random();                   // :37567 掷⑥
            vx *= kf; vy *= kf;
            vx *= 0.65; vy *= 0.65;                                 // :37568
            ng = Math.floor(Math.random() * 4) !== 0;               // :37569 掷⑦ Next(4)!=0
            if (ng) { vx *= 2; vy *= 2; }                           // :37571-37574
          }
          // NewDustPerfect（:37554）：位/速完整覆写——终值速度经 perfect 通道直入池
          //  （33 族 NewDust :232-237 速度特例 ×0.5/Y++ 与烟雾族 vy 重掷被消解;
          //  33 族 alpha=170 在覆写面之外=入池即 ⅓ 亮度;302 烟雾 ×0.7 scale 被
          //  终值 scl 覆写）。掷序全在 spawn 前耗尽 → 池满哑元拍流也对齐（原版
          //  哑元照样掷,orchestraFx ★F-13 同款纪律）。
          const d = game.spawnDust?.(this.cx + Math.cos(a0) * r0 * 8,
            this.cy + Math.sin(a0) * r0 * 8, 0, 0,
            as302 ? 302 : 33, vx, vy, 0, null, 1, false, true);
          if (!d) continue;
          d.scale = sclF;                                           // :37555/:37558 终值
          if (as302) d.fadeIn = 0;                                  // :37559
          if (ng) d.noGravity = true;                               // :37563/:37569
          if (noLightF) d.noLight = true;                           // :37564
          if (noEmF) d.noLightEmittance = true;                     // :37565
        }
      }
      // α 渐显（:37517-37518/:37533）：value=MultiLerp(localAI[0]/20,0,1,1,1,0.5,0)
      // → alpha=(int)Lerp(255,0,clamp(value,0,1))——首 4 拍 255→0 淡入、中段全显、
      // 16-20 拍 0→255 淡出（Op=(255−α)/255 由 draw 消费,与 GetAlpha A 通道相乘）
      const mv = utilMultiLerp(this.age / 20, YOYO_SHOT_ALPHA_ANCHORS);
      this.alphaVal = Math.trunc(255 + (0 - 255) * Math.min(1, Math.max(0, mv)));
    } else if (this.projId === 1134) {
      // ★SW-BJ17 2026-09-07：AI_024 1134 全支 1:1（P.cs:26275-26354;蓝队 K 位移批已接
      //  ×0.96,本批补齐演出/寿命面——K 移交件②）。逐句：
      //  ①出生门（:26275-26291 localAI[0]==0 → 1,即首拍）：ai[0]==0 才播
      //    PlaySound(13,x,y,0,0.35)——legacy 13=Shatter（LegacySoundPlayer.cs:786,
      //    盘上 Shatter.opus/mp3 在库;Game.ts:20800 同判例）。546 出膛 NewProjectile
      //    (:13834) 首颗 ai0=0 余四颗 1 → 唯首颗出声,五颗全出尘。
      //    d70×6 = NewDust(盒,70)+noGravity+velocity×2.5+scale×0.9（NewDust 本体
      //    掷序/缺省随机速 ±2.0/scale ±0.2 由 VanillaDust.spawn 对齐）。
      //    尘盒 = 原版活盒 width×height = SetDefaults 尾 width×scale :10674-10675
      //    = int(6×1.2)=7（本仓 this.w 系 SetDefaults 字面 6,数据面全库口径;
      //    尘盒按 7 折算=原版活盒）。
      //  ②light=scale×0.5（:26292）→ ProjLight()（:16246 num=light 起;:16636-16640
      //    1134 支乘区 (0.5,0.2,0.9)）= AddLight(0.25·s,0.1·s,0.45·s)。走实体光通道
      //    lightRGB（数据路径 static 0.5 表值停用——AI 每拍覆写 light=scale×0.5）。
      //  ③rotation += velocity.X×0.2（:26293 累计式——旧 draw 走速度向系误引
      //    AI_210 :37536(1135 行),本批正轨）。
      //  ④ai[1]++（:26294）= this.age（fixedUpdate 顶部每拍 +1,首拍=1,同序同值）。
      //  ⑤velocity×0.96（:26343-26345,K 批已接,保留）。
      //  ⑥ai[1]>15 起每拍 scale−0.05,≤0.2 钉 0.2 → Kill（:26346-26354）——scale 初值
      //    1.2 → 恰 35t 即亡（首 15t 门 + 第 16..35t 收缩 20 次;JS double 第 20 次累减落
      //    0.19999999999999946≤0.2,tick35 定谳;C# float 同点有 ±1t 漂移窗,登记）。
      //    life=600（:10650）保留为保底上限。Kill 面定谳：Projectile.Kill 通用段仅
      //    aiStyle16 炸弹族（:71770 flag2 起）,1134 支 :76811-76815=空循环 for(3){}
      //    零死亡效果 → 本仓 dead 置位即 1:1,无需 Game.onProjectileDeath 接线
      //    （1088 橡弹先例核毕=Kill :71784 爆炸支改写,1134 无对应面）。
      if (this.age === 1) {
        if (this.ai0 === 0) game.playSfxWav?.('Shatter', 0.35, this.cx, this.cy);
        const bw = Math.trunc(this.w * (projectileData(1134)?.scale ?? 1));
        const bh = Math.trunc(this.h * (projectileData(1134)?.scale ?? 1));
        for (let i = 0; i < 6; i++) {
          const d = game.spawnDust?.(this.x, this.y, bw, bh, 70);
          if (!d) continue;
          d.noGravity = true;
          d.vx *= 2.5; d.vy *= 2.5;
          d.scale *= 0.9;
        }
      }
      this.lightRGB = [this.scale * 0.25, this.scale * 0.1, this.scale * 0.45];
      this.rotation += this.vx * 0.2;
      this.vx *= 0.96; this.vy *= 0.96;
      if (this.age > 15) {
        this.scale -= 0.05;
        if (this.scale <= 0.2) {
          this.scale = 0.2;
          this.dead = true;                    // Kill（:26353）——死亡面空循环,见上⑥
          return;                              // 原版 Kill 即刻 !active → 湿段/命中本拍不达
        }
      }
    }
    // ---- 通用湿段（:16903-17113,projWetSection 共享体——AI 后/命中前;原版 Damage
    //      管线 :17132 在湿段之后。1125 ignoreWater=true 自动分流跳段,域注见字段块）----
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater);
    // ---- 位移（HandleMovement :17578 → UpdatePosition :19973/:20549-20562;原版位序
    //      = 湿段后/Damage 前,本仓插湿段与命中之间同位）----
    //  tileCollide=false（:10537/:10599/:10640/:10657）→ HandleMovement 的 TileCollision/
    //  湿阻尼块整块跳过（:17721 在 if(tileCollide) 内）→ wetVelocity 恒 = :16870 AI 前
    //  快照（preVx/preVy）;UpdatePosition 早退表（:20551-20553）【含 1125】不含 1130/
    //  1134/1135 → wet ? position+=快照 : position+=velocity（dry=post-AI 阻尼场:
    //  AI_210 ×0.92 / AI_024 ×0.96 后）。无 tile 碰撞（穿块,原版同）。
    if (this.projId !== 1125) {
      if (this.wet) { this.x += preVx; this.y += preVy; }
      else { this.x += this.vx; this.y += this.vy; }
    }
    // ---- 命中（Damage 通用管线：盒相交 → hurt;免疫表按型）----
    const cd = this.sharedCd ?? this.ownCd;
    cd.tick();
    this.ownCd.tick();
    for (const ent of game.enemies()) {
      // ★dontTakeDamage 目标排除（:12600 同款——焰爆石 kind1 直写 onFire3T/snapStrike
      //   proc 在 hurt 前,曾复现 DoT 僵尸态,最终清零补）
      if ((ent as unknown as { dontTakeDamage?: boolean }).dontTakeDamage === true) continue;
      if (!playerCanHitEnemy(ent, game, this.projId)) continue;
      const e = ent as unknown as { x: number; y: number; w: number; h: number; id: number; dead: boolean;
        hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean };
      if (e.dead) continue;
      if (e.id === this.excludeId) continue;                 // localNPCImmunity[victim]=-1
      if (!(this.x < e.x + e.w && this.x + this.w > e.x && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
      const effCd = this.sharedCd ? cd : this.ownCd;         // IDStatic 型走共享表
      if (!effCd.ready(e.id, this.sharedCd ? (this.projId === 1134 ? 20 : 10) : 9999)) continue;
      // ★BJ494（2026-10-04）掷率收编 rollVanillaHitCrit 单源（旧 `Math.random()<critChance`
      //  静态掷退役）：1125/1130/1134/1135 SetDefaults（P.cs:10530-10545/:10599-10612/
      //  :10638-10670 melee=true 亲读）→ 三类掷 :12916 melee 臂达=owner.meleeCrit（:25712-14
      //  逐帧折入持械 item.crit+crt,命中拍动态;YoyoShotSpec 无 crit 载体,类缺省 0.04=路由门）。
      //  ownedBySomeone=非 trap=true → TimerCrit :12928 无条件消费照达。武僧 688-690 强制掷
      //  :12929-43 形位=悠悠球伴生非 688 族恒假,不设。
      const rollCrit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
      const timerCrit = (game.player as unknown as
        { tryConsumingTimerCrit?: (g: GameHooks, x: number, y: number, w: number, h: number) => boolean }
        | null)?.tryConsumingTimerCrit?.(game, e.x, e.y, e.w, e.h) ?? false;
      const crit = rollCrit || timerCrit;
      const dmg = this.damage;   // ★S02:crit ×2 移 Enemy.hurt 防后（NPC.cs:82067）
      const kdir = Math.sign((e.x + e.w / 2) - this.cx) || 1;
      // ★焰爆石 kind1+拍击石 kind0 弹幕侧（Projectile.cs:13439-13446 双支同序,
      // F3/F1 收编升级）——悠悠球伴生弹（1125 Cascade 爆裂/1130 EoC 冲撞/1134 晶簇/
      // 1135 Kraken 波，SetDefaults friendly/melee 数据面）结算位；门+触发 =
      // projectileSnapStrikeBonus 单源，加伤随暴击并入实伤参（不吃旗乘区）
      const snapBonusYoyoSib = projectileSnapStrikeBonus(game, this, e.x + e.w / 2, e.y + e.h / 2, e.id,
        { victimBox: { w: e.w, h: e.h, cx: e.x + e.w / 2, cy: e.y + e.h / 2 } });
      e.hurt(applyBannerDamageDealt(game, e, dmg)
        + (snapBonusYoyoSib ? snapBonusYoyoSib : 0),
        kdir * this.knockback, 0, game, this.armorPen, crit, 0, true);   // 音/飘值=单点;★S02 crit ×2=Enemy.hurt 防后;fromPlayer=DPS 计
      // ★GC1 写方桥（Projectile.Damage :14031-14183 命中尾梯,StrikeNPC 后原位）：
      // 蓝队二轮 F1/F5 裁决：四型 face 不再依赖调用点硬编码——
      //   1125/1130 usesLocalNPCImmunity(cd=-1) → 写 0 清全局窗（:10541/:10610）；
      //   1134 idStatic + appliesImmunityTimeOnSingleHits(pen1) → 写 0（:10645/:10652）；
      //   1135 idStatic(pen -1) → 写 0（:10666）。face 源 = data/vanillaProjImmuneFaces.ts
      //   （SetDefaults :10530-10668 逐型抓取），bridge 自动解析；旧「全走末档 10t」
      //   会反向压制近战循环门（meleeNpcImmuneGateOf immune 分量）。
      noteVanillaProjImmune(game, this.projId, e.id);
      // ★GB1（GC 契约，2026-08-31）：幽灵伤害头 ghostHurt（Projectile.cs:13881 →
      //  :12021）——StrikeNPC(:13712) 后调用位。武器族弹按弹 id 的 magic 归属面
      //  数据门挂接（与 Arrow/MagicProj/MissileProj 同构；现役表内非 magic 弹恒
      //  空掷零行为变化，未来 magic 类武器弹自动生效）。dealt=Enemy.lastStrikeDealt
      if (this.projId > 0 && projectileData(this.projId)?.magic === true
        && playerHasGhostHurt(game.player)) {
        const v156 = e as unknown as { lastStrikeDealt?: number };
        // dealt 合同 = 本拍 Enemy.hurt 结算面（无结算=0；蓝队 F2② 修订后 ??dmg
        // 陈值兜底撤除——虚增幽灵预算头的路径封死）
        ghostHurtOnHit(game,
          { magic: true, projDamage: this.damage,
            projX: this.x, projY: this.y, projW: this.w, projH: this.h,
            ownerCx: game.player.cx, ownerCy: game.player.cy },
          { x: e.x, y: e.y, w: e.w, h: e.h, cx: (e as unknown as { cx?: number }).cx ?? e.x + e.w / 2,
            cy: (e as unknown as { cy?: number }).cy ?? e.y + e.h / 2,
            vanillaId: (e as unknown as { vanillaId?: number | null }).vanillaId,
            dealt: v156.lastStrikeDealt ?? 0 });
      }
      // ★BJ424 星云套装 proc（:13885-13891,ghostHurt 同块同门面）——引擎自持 magic 门
      if (this.projId > 0) {
        nebulaBoosterOnHit(game,
          { projId: this.projId, projDirX: this.vx },
          { x: e.x, y: e.y, w: e.w, h: e.h, cx: (e as unknown as { cx?: number }).cx ?? e.x + e.w / 2,
            cy: (e as unknown as { cy?: number }).cy ?? e.y + e.h / 2,
            vanillaId: (e as unknown as { vanillaId?: number | null }).vanillaId,
            dealt: (e as unknown as { lastStrikeDealt?: number }).lastStrikeDealt ?? 0 });
      }
      if (this.projId === 1134) break;                       // penetrate 1（:10643）
    }
  }

  draw(r: Renderer, cam: Camera): void {
    // 1125 hide=true（:10540）原版本体不绘制（视觉=尘爆）——跳过
    if (this.projId === 1125) return;
    const rot = this.projId === 1130
      ? Math.atan2(this.vy, this.vx) - Math.PI / 2           // :37484 rotation=vel−π/2
      : this.projId === 1134
        ? this.rotation                                      // ★SW-BJ17：AI_024 :26293
                                                             //  累计式（旧 vel 向系误引
                                                             //  AI_210 :37536=1135 行）
      : Math.atan2(this.vy, this.vx);                        // 1135 =vel（:37536）
    if (this.projId === 1130) {
      // 6 帧竖条（projFrames[1130]=6,Main.cs:8866）——drawProj 无帧参,手绘
      const ctx = r.ctx;
      const img = projSprite(1130);
      if (!ctx || !img || !(img.width > 0)) return;
      const fh = img.height / 6;
      ctx.save();
      ctx.translate(this.cx, this.cy);
      ctx.rotate(rot);
      // GetAlpha(:80595-80602) A 通道 = Lerp(0,255,localAI[0]/19)×Opacity((255−α)/255)
      // ——出膛淡入 × α 曲线淡出双段;RGB 侧 max(50,光照)底亮乘色由全局光照 pass 承载,
      // 暗处 50/255 自发光底亮通道未建模（登记）;netPuppet 不跑 AI（age/α 冻结）→ 恒显
      ctx.globalAlpha = (this.netPuppet ? 1 : Math.min(1, this.age / 19))
        * (255 - this.alphaVal) / 255;
      ctx.drawImage(img, 0, Math.round(this.frame * fh), img.width, Math.round(fh),
        -img.width / 2, -fh / 2, img.width, fh);
      ctx.restore();
      return;
    }
    drawProj(r, cam, this, this.projId, rot, this.projId === 1134 ? '#E0C0FF' : '#8090E0',
      this.projId === 1134 ? 0.8                                  // α=50 → (255−50)/255（:10645）
        : (this.netPuppet ? 1 : Math.min(1, this.age / 19))       // 1135 同 GetAlpha 支（:80595）
          * (255 - this.alphaVal) / 255,
      0, false, false,
      // ★SW-BJ17：1134 收缩绘制（DrawProj dest=贴图×proj.scale）——AI_024 scale
      //  1.2→0.2 每拍 −0.05（:26346-26354）;1135 SetDefaults scale=1（:10658）不变
      this.projId === 1134 ? this.scale : 1);
  }
}

// ================= 连枷/链球（aiStyle 15，AI_015_Flails，Projectile.cs:44529-45018;1456 伪锚 :41051-41506 勘正） =================

/** 每型号参数（Projectile.cs:44551-44565 默认值 + :44566-44628 switch 各 case;1456 伪锚 :41073-41087/:41088-41148 勘正；单位 px/tick/tick）。
 *  meleeSpeed 缩放链（:44629-44637;1456 伪锚 :41151-41159 勘正）：throwSpd/farPull/pullAccel/retractKill/returnAccel/
 *  returnKill ×(1/meleeSpeed)——orbitRadius(num15)不缩放 */
interface FlailParams {
  flightTicks: number;  // num:掷出态飞行上限 tick（超时 → 回拉）
  throwSpeed: number;   // num2:松手掷出初速
  pullAccel: number;    // num4:回拉态 MoveTowards 步长
  retractKill: number;  // num5:回拉态距手 ≤ 此值即消失
  returnAccel: number;  // num6:回收态 MoveTowards 步长
  returnKill: number;   // num7:回收态距手 ≤ 此值即消失
  farPullSpeed: number; // num9:远端回拉目标速率
  orbitRadius: number;  // num15:旋转态绕体半径
  spinHitCd: number;    // num12:旋转态每敌命中冷却
  thrownHitCd: number;  // num13:掷出/回拉/坠落态冷却
}
const FLAIL_DEFAULT: FlailParams = {
  flightTicks: 10, throwSpeed: 24, pullAccel: 3, retractKill: 16,
  returnAccel: 6, returnKill: 48, farPullSpeed: 14, orbitRadius: 30,
  spinHitCd: 15, thrownHitCd: 10,
};
const FLAIL_PARAMS: Record<number, Partial<FlailParams>> = {
  25:  { flightTicks: 15, throwSpeed: 14, retractKill: 10, returnKill: 15 },
  26:  { flightTicks: 15, throwSpeed: 16, retractKill: 13, returnKill: 17, orbitRadius: 32 },
  35:  { flightTicks: 15, throwSpeed: 17, retractKill: 14, returnKill: 18, orbitRadius: 37 },
  63:  { flightTicks: 13, throwSpeed: 21, retractKill: 20, returnKill: 24, spinHitCd: 12 },
  154: { flightTicks: 15, throwSpeed: 15, retractKill: 11, returnKill: 16 },
  247: { flightTicks: 13, throwSpeed: 23, spinHitCd: 12, orbitRadius: 40 },   // FlowerPow 花粉锤（R30 §8.2 勘误:曾误标 Flairon——伴生弹 FlowerPowPetal=248 在表;真 Flairon=item 2611→proj 404 aiStyle69/新件 5526→proj 1058）
  757: { flightTicks: 13, throwSpeed: 22, retractKill: 22, returnKill: 26, spinHitCd: 12, orbitRadius: 35 },
  947: { flightTicks: 13, throwSpeed: 12, retractKill: 8, returnKill: 13 },
  948: { flightTicks: 13, throwSpeed: 12, retractKill: 8, returnKill: 13 },
  1058: { flightTicks: 16, throwSpeed: 23, spinHitCd: 10, orbitRadius: 45 },
};

/** 中心锚组成员（★BJ388 件4 定谳表,M.cs:33161 大表逐项亲读）：链球族仅此 7 型在
 *  「vector81=盒中心+gfxOffY、origin24=贴图中心」组——404/1058/947/948 不在表,
 *  走 :35492 通用通支锚（num153/num151/num152 式）。FlailProj.draw 按此分档 */
const FLAIL_CENTER_ANCHOR = new Set([25, 26, 35, 63, 154, 247, 757]);

/** 链贴图（DrawProj_FlailChains 1457 Main.cs:35907-35938 switch;1456 :34757-34781）：型号 → Chain_N；
 *  948 三段混排（前 4 节 Chain43 全亮 → 2 节 Chain42 → 其余 Chain41）；
 *  757 = Extra_99 六帧竖条动画链。★1058 不走本表——独立支用 Chain37
 *  （M.cs:28831-28977,见 FlailProj.drawChain1058） */
function flailChainTex(projId: number): string {
  switch (projId) {
    case 25: return 'Chain2';
    case 35: return 'Chain6';
    case 63: return 'Chain7';
    case 154: return 'Chain13';
    case 247: return 'Chain19';
    case 947: case 948: return 'Chain41';
    case 757: return 'Extra_99';
    default: return 'Chain3';
  }
}
const chainSprites = new TtlSpriteMap((name) => `sprites/vanilla/${name}.png`);
function chainImg(name: string): ImageBitmap | HTMLImageElement | null {
  return chainSprites.get(name);   // TTL 自愈装载(2026-08-25 同类扫描:原锁存坏元素永久隐形)
}

/** 404/1058 链条共享件（1457 Main.cs:29501-29640 链条分支——proj.type==404 与 1058
 *  同支同贴图 Chain37 :29518-29521;1456 同段 :28831-28977）：链节高=贴图整高;从球心
 *  向玩家步进【先步进后绘制】（首节在球心前方一节距,1457 :29607-29609）;while
 *  (dist ≥ 链节高+1) 终止（:29593-29596——通用表的 remain 起步式会多画 2 节戳进玩家）;
 *  rotation 恒=atan2(球心→玩家)−π/2（:29582-29583,循环外一次定型）;逐节
 *  Lighting.GetColor 着色（无 948 亮度下限/无 alpha 门,:29614-29616）。★本支起点=
 *  mountedCenter 直取（:29581 vector21=mountedCenter−center2,无通用支的
 *  MoveTowards(−4)）→ handX/handY=玩家中心即对齐,勿套通用支的 −4。
 *  （原 FlailProj.drawChain1058 主体参数化抽出,404 FlaironHeadProj 同走——R4） */
function drawChain37Link(ctx: CanvasRenderingContext2D, r: Renderer,
  ballCx: number, ballCy: number, handX: number, handY: number): void {
  const img = chainImg('Chain37');
  if (!img || !(img.width > 0) || img.width === 0) {
    // 贴图未就绪兜底：细线（通用支同款）
    ctx.strokeStyle = '#605848';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(handX, handY);
    ctx.lineTo(ballCx, ballCy);
    ctx.stroke();
    return;
  }
  const linkH = img.height;
  const lighting = (r as unknown as { lighting?: { lightAt: (tx: number, ty: number) => [number, number, number] } | null }).lighting;
  const lightAt = (wx: number, wy: number): number => {
    if (!lighting) return 1;
    const [lr, lg, lb] = lighting.lightAt(Math.floor(wx / TILE), Math.floor(wy / TILE));
    return Math.min(1, (lr * 0.3 + lg * 0.5 + lb * 0.2) / 255);
  };
  let cx = ballCx, cy = ballCy;
  let dx = handX - cx, dy = handY - cy;
  const d0 = Math.hypot(dx, dy);
  if (!Number.isFinite(d0) || d0 === 0) return;   // NaN/零向量门（:28920-28926 flag20）
  const rotation = Math.atan2(dy, dx) - Math.PI / 2;   // :28917-28918（循环外定型）
  ctx.imageSmoothingEnabled = false;
  for (;;) {
    dx = handX - cx; dy = handY - cy;
    const d = Math.hypot(dx, dy);
    if (d < linkH + 1) break;                      // :28931-28934 终止门
    const ul = d || 1;
    cx += (dx / ul) * linkH;                       // 先步进（:28966-28968）
    cy += (dy / ul) * linkH;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);
    ctx.globalAlpha = Math.min(1, Math.max(0, lightAt(cx, cy)));
    ctx.drawImage(img, -img.width / 2, -linkH / 2);
    ctx.restore();
  }
}

export class FlailProj extends Entity {
  /** 原版碰撞盒按型号(Projectile.SetDefaults):247/757=34 / 947/948=20 /
   *  1058=26 / 其余 22——写死 22 会让 5 个型号命中盒失真,2026-08-13 review */
  w: number;
  h: number;
  damage: number;
  knockback: number;
  projId: number;
  /** GetWeaponCrit 合并值（Game 侧传入；缺省 4 基础） */
  critChance = 0.04;
  /** ⑥ 护甲穿透（Game 注入，命中传 hurt 减防） */
  armorPen = 0;
  /** 近战系（吃武器浸剂） */
  meleeProj = true;
  /** channel 电平（mouseHeld && 手持原物品 && !uiBlocking）——Game 注入 */
  private channel: () => boolean;
  /** 鼠标世界坐标 getter（松手掷出方向） */
  private target: () => { x: number; y: number };
  private prm: FlailParams;
  /** 子弹生成回调(Game 侧注入 entities.add——GameHooks 不暴露实体桶)。
   *  AI_015 特例:247 Flairon 飞行中自机弹 248 / 757 Drippler 掷出回收气泡 928 /
   *  1058 轨道刺 405 */
  spawnProj: ((x: number, y: number, vx: number, vy: number, projId: number, dmg: number, kb: number) => void) | null = null;
  /** 247/1058 周期计数(247=localAI[0] :41451 / 1058=localAI[2] :41424) */
  private subT = 0;
  /** 1058 出场淡入:原版 alpha 语义(255=隐形,SetDefaults :9719;每 tick -50 至 0,
   *  :41386-41394)——其余型号恒 0(不透明) */
  private alpha = 0;
  /** ai[0] 状态：0 旋转 / 1 掷出 / 2 回拉 / 5 坠落 / 6 垂地悬荡 / 4 回收 */
  private st = 0;
  /** ai[1] 状态内计数 */
  private stT = 0;
  /** localAI[1] 旋转态累计 tick */
  private spinT = 0;
  /** localAI[0] 弹墙累计（AI_015_HandleMovementCollision:41006） */
  private bounces = 0;
  /** 当拍伤害冷却覆写（localNPCHitCooldown=num 转坠落覆写 :44505——原版字段直接
   *  改写,下一 Damage() 生效;本仓经单拍覆盖位承载,消费即清零） */
  private cdOverride: number | null = null;
  /** spriteDirection（=direction,:44885/:44960 每 tick=sign(vx)——★BJ665 勘正 伪锚 :41479-41483,1058 豁免保持出生向;
   *  绘制侧 -1 水平翻转 Main.cs:30529-30532——★BJ665 勘正 伪锚 :29827-29831） */
  private spriteDir = 1;
  /** SetDefaults scale（Projectile.cs:10673-10674 命中盒缩放 + Main.cs:33161 绘制缩放共用——★BJ665 勘正 伪锚 :10075-10076/:32360） */
  private texScale: number;
  private rotation = 0;
  private hitCd = new HitCooldown();
  /** 手部坐标（链条起点，每 tick 刷新） */
  handX = 0;
  handY = 0;
  life = 7200;
  dead = false;
  // ---- ★通用湿段（Projectile.cs:16903-17113;2026-09-06 R3 漏网类批 11 类之一）----
  //  域 id 集 = FLAIL_PARAMS 全 10 型（25/26/35/63/154/247/757/947/948/1058,
  //  DefaultToFlail :10591 系——SetDefaults 各块均无 ignoreWater 行,缺省 false :763;
  //  与 PROJ_IGNORE_WATER 零交集）→ 全员受段。
  //  ★湿 AI 消费者收编（R3"湿段放其读取位后"）：三类内联液测（inLiquid 双轨）改读
  //  湿段维护旗——①948→947 入水变型（:44542 wet && !lavaWet,检查位移到湿段后=原文
  //  :44542 读【当拍】旗同拍等价）;②948 拖尾尘 !wet 门（:45263-45267）;③case6 悬荡
  //  微光重力豁免（:41374-41376 !shimmerWet）。
  //  ★位序：湿段插 AI 链尾（switch+dust 后）/位移前 = 原版 post-AI 同位——AI（switch/
  //  dust）读【上一拍】旗（原版 AI :16880 在湿段 :16903 前,同序）;948 变型检查在湿段
  //  【后】（原文 :44542 在 AI_015_HandleMovementCollision = 位移后读【当拍】旗,本仓
  //  湿段后同拍等价——变型拍 = 湿段首测湿拍）。
  //  ★杀拍注：AI 内 Kill 位（life 尽/头门 p.dead·CCed·超程/mapFullscreen/case2 回拉
  //  近手/case4 回收近手·越手）均在湿段插位前 → 杀拍湿段未跑（原版 AI-Kill 拍湿段
  //  照跑 :16903 无 active 门）。链球域贴身玩家运转,湿态早于杀拍建立 → 入水溅花
  //  wetCount==0 门结构性不可达,观察面零差（登记不补）。
  //  ★阻尼：tileCollide=true（DefaultToFlail 未关）→ 湿阻尼适用（moveAndCollide 位移
  //  入参,仅 st 1/2/3/5/6 位移支;st0 旋转态 AI 直写位、st4 回收态无位移支 = 无消费位）。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价——首拍 AI 写位前同位测值） */
  presetDone = false;   // ProjWetFlags.presetDone（共享湿段旗持有者）

  constructor(x: number, y: number, damage: number, knockback: number, projId: number,
    channel: () => boolean, target: () => { x: number; y: number }) {
    super();
    this.x = x; this.y = y;
    this.handX = x; this.handY = y;
    this.damage = damage;
    this.knockback = knockback;
    this.projId = projId;
    this.channel = channel;
    this.target = target;
    this.prm = { ...FLAIL_DEFAULT, ...FLAIL_PARAMS[projId] };
    const pd = projectileData(projId);
    // 命中盒 = (int)(SetDefaults 宽高 × scale)（Projectile.cs:10673-10674 SetDefaults——★BJ665 勘正 伪锚 :10075-10076
    // 尾段统一缩放,JSON 宽高为缩放前原值）——25=0.9→19、26/35/154=0.8→17;
    // 曾取裸型号宽 → 带 scale 的 4 型号命中盒偏大
    this.texScale = pd?.scale ?? 1;
    this.w = Math.trunc((pd?.width ?? 22) * this.texScale);
    this.h = Math.trunc((pd?.height ?? 22) * this.texScale);
    if (projId === 1058) this.alpha = 255; // SetDefaults :9719(出场淡入起点)
    // spriteDirection 初值 = 出手向（NewProjectile direction 语义;1058 无 per-tick
    // 更新 :41479 门——保持出生向,其余型号首 tick 起被 sign(vx) 覆写）
    this.spriteDir = this.target().x >= this.x + this.w / 2 ? 1 : -1;
  }

  /** ai[0] 状态只读视图(0 旋转/1 掷出/2 回拉/3 垂链/4 回收/5 坠落/6 垂地悬荡)——测试对账用 */
  get aiState(): number { return this.st; }

  draw(r: Renderer, cam: Camera): void {
    const ctx = r.ctx;
    if (ctx) this.drawChain(ctx, r);
    // alpha 原版语义(Main.cs:29635 color *= (255-alpha)/255——★BJ665 勘正 伪锚 :28965;越大越透明)
    // ★BJ388 件4（BJ367/344 登记债,2026-09-28 独立复核）：中心锚组 = M.cs:33161 大表
    //  （旧注 ":32360" 系行号漂移;404/1058/947/948 均不在表）——链球族仅
    //  {25,26,35,63,154,247,757} 在表走【盒中心+贴图中心 origin】;
    //  1058 走 :35492 通用通支锚（404 同款,BJ367 范式;全表亲读仅 :29501 链支/:29518
    //  Chain37/:40343 图鉴三处涉 1058,无球体专支）：num153=(30−26)/2+26/2=15、
    //  num151=num152=0 → 贴图左上=盒左上、球体中心=盒心+(+2,+3)px（30×32 贴图对
    //  26×26 盒）;曾按中心锚绘制=整球偏 (−2,−3)px+枢轴偏 2px（与 BJ367 404 同案）。
    //  ★947/948 姊妹债定谳+勘正（BJ393 件1,2026-09-28 亲读收案）：:33161 大表确无
    //  947/948 → :35492 通用通支锚,且 :30257 有同款特例 num151=4/num152=−4（与
    //  :30252 的 25/26/35/63/154 族同式）→ 贴图左上=盒左上+(−4,−4)、球心=盒心
    //  +(−1,−1)px（26×26 贴图对 20×20 盒,num153=13;Main.cs 全文 947/948 仅此一处,
    //  DrawProjDirect :33161→:35492 无 aiStyle15 早退支=通用尾绘可达）。本仓刀面=
    //  件4 集合门（947/948 不在 FLAIL_CENTER_ANCHOR → 已走通用支）+ PROJ_DRAW_OFFSET
    //  [4,−4]（off143=4/off144=−4,066d742b 2026-08-17 入表）→ 现行绘制已=原版锚
    //  （translate=(盒左+9,盒上+10)、origin=(13,14)）,旧注「本仓现同样误走中心锚」
    //  系件4 落刀前状态,判别面锁 tests/bj393-weaponproj-anchor-accept.test.ts。
    // spriteDirection=-1 → 水平翻转（Main.cs:30529-30532 FlipHorizontally——★BJ665 勘正 伪锚 :29827-29831;:44885/:44960
    // 每 tick=sign(vx),1058 豁免保持出生向）;绘制 ×scale
    // ★BJ-C1 F2（2026-10-06,BJ529/530 同族普查收编）：35 太阳怒 Sunfury——
    //  GetAlpha :81465-81468 `34||35||15||19||44||45 → Color.White` 恒满亮【不读
    //  alpha】（SetDefaults α=100 :1285 死值——旧式 ga=(255−100)/255≈0.61 半透=病）,
    //  【不读光照色】=光照无关弹面（实体层乘光同病,BJ529 探针 _bj529-skull-ab）。
    //  承接=BJ530 判例同构：capture→球体不进实体层,projFullbrightQueue 光照合成
    //  后 source-over 复绘 ga=1（Color.White A=255 恒定）=原版逐字;链节面
    //  （drawChain）原版逐节取光（:35901-35990）维持实体层不动。层序=玩家/NPC
    //  之上（270/45/BJ504 同槽惯例,登记）。
    if (this.projId === 35) {
      drawProj(r, cam, this, this.projId, this.rotation, '#E04040',
        1, 0, this.spriteDir === -1,
        FLAIL_CENTER_ANCHOR.has(this.projId), this.texScale,
        -1, 0, (fn) => {
          (r as unknown as {
            queueProjFullbright?: (fn: (c: CanvasRenderingContext2D) => void) => void;
          }).queueProjFullbright?.(fn);
        });
      return;
    }
    drawProj(r, cam, this, this.projId, this.rotation, '#E04040',
      Math.max(0, (255 - this.alpha) / 255), 0, this.spriteDir === -1,
      FLAIL_CENTER_ANCHOR.has(this.projId), this.texScale);
  }

  /** 链条（DrawProj_FlailChains 1457 Main.cs:35901-35990 1:1;1456 同段 :34752-34842）：
   *  球心 → 手臂方向逐节步长=链节高，每节按所在格光照着色；948 三段混排 /
   *  757 六帧动画链。★1058 Flairon 走独立支（1457 M.cs:29479-29640,非本通用表）
   *  ——见 drawChain1058 */
  private drawChain(ctx: CanvasRenderingContext2D, r: Renderer): void {
    if (this.projId === 1058) { this.drawChain1058(ctx, r); return; }
    const img = chainImg(flailChainTex(this.projId));
    if (!img || !(img.width > 0) || img.width === 0) {
      // 贴图未就绪兜底：细线（旧实现形态）
      ctx.strokeStyle = '#605848';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(this.handX, this.handY);
      ctx.lineTo(this.x + this.w / 2, this.y + this.h / 2);
      ctx.stroke();
      return;
    }
    // 光照采样（Lighting.GetColor 每节一次；拿不到则全亮。
    // ★lightAt 返回 0..255(Renderer 同源 /255 消费)——不除即恒满亮的静默 bug,2026-08-13 review)
    const lighting = (r as unknown as { lighting?: { lightAt: (tx: number, ty: number) => [number, number, number] } | null }).lighting;
    const lightAt = (wx: number, wy: number): number => {
      if (!lighting) return 1;
      const [lr, lg, lb] = lighting.lightAt(Math.floor(wx / TILE), Math.floor(wy / TILE));
      return Math.min(1, (lr * 0.3 + lg * 0.5 + lb * 0.2) / 255);
    };
    // 球心 → 臂方向。链向量起点 = armPosition.MoveTowards(center, 4f)（1457 M.cs:35941,
    // DrawProj_FlailChains :35901-35990;1456 同式 :34792）——臂位向球心先收 4px 再取
    // (起点−球心) 向量 → 链长 = 臂球距 − 4（MoveTowards 不越界:距 ≤4 落在球心=零向量,
    // SafeNormalize(Zero) 归零 → num4=链节高/2 恰画一节,本仓 d<1 门近似同态）。
    // 曾直接以手部坐标全距起步 → 链多出 4px 戳进手臂
    const cx0 = this.x + this.w / 2, cy0 = this.y + this.h / 2;
    let dx = this.handX - cx0, dy = this.handY - cy0;
    const dHand = Math.hypot(dx, dy);
    if (dHand < 1) return;
    dx /= dHand; dy /= dHand;
    const d = Math.max(0, dHand - 4);   // MoveTowards(center,4) 后的链向量长（:35941/:35946 num4=d+链节高/2）
    const frames = this.projId === 757 ? 6 : 1;
    const linkH = img.height / frames + (this.projId === 757 ? -2 : 0);
    const rotation = Math.atan2(dy, dx) + Math.PI / 2;
    let px = cx0, py = cy0;
    let i = 0;
    for (let remain = d + linkH / 2; remain > 0; remain -= linkH, i++) {
      let tex = img;
      let sy = 0, sh = img.height;
      if (this.projId === 757) { sy = (i % 6) * (img.height / 6); sh = img.height / 6; }
      else if (this.projId === 948) {
        // 三段：前 4 节 Chain43（全亮）→ 2 节 Chain42（最低亮度 140）→ 其余 Chain41
        if (i < 4) { tex = chainImg('Chain43') ?? img; }
        else if (i < 6) { tex = chainImg('Chain42') ?? img; }
      }
      if (!(tex.width > 0) || tex.width === 0) tex = img;
      const alpha = this.projId === 948 && i < 4 ? 1
        : this.projId === 948 && i < 6 ? Math.max(lightAt(px, py), 140 / 255)
          : lightAt(px, py);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rotation);
      ctx.imageSmoothingEnabled = false;
      // 逐节取光即原版语义（:35950 color=Lighting.GetColor(节所在格)——黑暗中链全黑
      // 不可见;曾设 0.15 globalAlpha 下限=黑暗里链仍隐约可见,原版无此下限。
      // 948 中段 140/255 是原版【色阶】下限（:35963-35976 R/G/B≥140）非 alpha 下限）
      ctx.globalAlpha = alpha;
      ctx.drawImage(tex, 0, sy, tex.width, sh, -tex.width / 2, -sh / 2, tex.width, sh);
      ctx.restore();
      px += dx * linkH;
      py += dy * linkH;
    }
  }

  /** 1058 Flairon 链独立支（1457 Main.cs:29479-29640,与通用 DrawProj_FlailChains
   *  分流;1456 同段 :28831-28977）：贴图 Chain37（缺省 Chain3 是通用表兜底,1058 不在
   *  表内）;链节高=贴图整高;从球心向玩家步进【先步进后绘制】（首节在球心前方一节距,
   *  1457 :29607-29609）;while(dist ≥ 链节高+1) 终止（:29593-29596——通用表的 remain
   *  起步式会多画 2 节戳进玩家）;rotation 恒=atan2(球心→玩家)−π/2（:29582-29583,
   *  循环外一次定型）;逐节 Lighting.GetColor 着色（无 948 亮度下限/无 alpha 门,
   *  :29614-29616）。★本支起点=mountedCenter 直取（:29581 vector21=mountedCenter−center2,
   *  无通用支的 MoveTowards(−4)）→ handX/handY=玩家中心即对齐,勿套 ① 的 −4 */
  private drawChain1058(ctx: CanvasRenderingContext2D, r: Renderer): void {
    // 主体已参数化抽出为模块级 drawChain37Link（404/1058 同支同贴图,Main.cs:29501-29640
    // 的 proj.type==404||1058 分支）——本壳仅传球心/手位,行为零变化
    drawChain37Link(ctx, r, this.x + this.w / 2, this.y + this.h / 2, this.handX, this.handY);
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (--this.life <= 0) { this.dead = true; return; }
    // 火焰重锤 948 入水(非岩浆)→ 变型 948→947（1457 :44542-44546,1456 :41064-41067
    // `type == 948 && wet && !lavaWet` → type = 947）——★R3 收编（2026-09-06）：原版
    // 读湿段维护旗 wet/lavaWet（内联 inLiquid 直测双轨退役）。检查位 = 通用湿段【后】
    // （见下方湿段调用位）= 原文 :44542 在 AI_015_HandleMovementCollision 内读【当拍】
    // 旗（湿段 :16903 先行刷新）的同拍等价位——变型拍 = 湿段首测湿拍,1:1。
    // "湿且非岩浆"即水/蜂蜜/微光都触发（lavaWet 粘滞面保护同原版）。变型无独立观感面
    // （两型参数/绘制全同,switch 参数提取已先行=948 参数,原文变型在位移后同构）
    const p = game.player;
    this.handX = p.cx;
    this.handY = p.cy;
    this.hitCd.tick();
    // meleeSpeed 缩放链（:44629-44637 meleeSpeed→num16 七连乘（BJ661 复核补 :44636-44637 num6/num7 两乘）——1456 伪锚 :41151-41159 勘正
    //  R17-F4）——inv = 1/M = 原版 num16（攻速和,>1 更快）
    const inv = 1 / (p.attackSpeedMult || 1);
    const throwSpd = this.prm.throwSpeed * inv;
    const pullAccel = this.prm.pullAccel * inv;
    const retractKill = this.prm.retractKill * inv;
    const returnAccel = this.prm.returnAccel * inv;
    const returnKill = this.prm.returnKill * inv;
    const farPull = this.prm.farPullSpeed * inv;
    const maxRange = 800;
    // 击杀门（:41053-41056）：主角死亡 / noItems（诅咒 23 :11326-11330,本仓=Cursed buff）/
    // CCed（冰冻·蛛网·石化三件套,Player.cced）/ 离手 900×(1/meleeSpeed)
    const distHand = () => Math.hypot(this.x + this.w / 2 - p.cx, this.y + this.h / 2 - p.cy);
    if (p.dead || p.buffs.has(BuffType.Cursed) || p.cced || distHand() > 900 * inv) {
      this.dead = true; return;
    }
    // :41057-41059 全屏地图打开 → Kill（原版 Main.myPlayer==owner 门,单机恒真）
    if (game.mapFullscreen?.()) { this.dead = true; return; }
    const held = this.channel();
    // num17/num18(:41164-41165):链长上限=掷速×飞行tick;垂地悬荡放行 +160
    const num17 = throwSpd * this.prm.flightTicks;
    const num18 = num17 + 160;
    // doFastThrowDust（:41232,case 1 入口置位——尘率分档用,取 switch 前状态）
    const fastThrow = this.st === 1;
    let cd = 10; // num11 默认每敌冷却
    switch (this.st) {
      case 0: { // 旋转态（:41168-41228）：绕体公转,松手朝鼠标掷出
        // ChangeDir（:41195-41201,channel 判定【之前】）:vector5 = mountedCenter→鼠标
        // 方向,X>0 → 1 / 否则 -1——角色朝鼠标侧转面(GAP#8 ①)。
        // ★26/35 双球在场时原版取反(:41174-41191 flag5,且掷出速度 X 翻转 :41207-41209)——
        // 本仓 channel 绑定手持物品 id(换手即掷出),双球并存结构性不可达,登记偏差
        const t0 = this.target();
        const spinDir = t0.x > p.cx ? 1 : -1;
        this.changeDir(p, spinDir);
        if (!held) {
          this.st = 1; this.stT = 0;
          const dx = t0.x - p.cx, dy = t0.y - p.cy;
          const dd = Math.hypot(dx, dy) || 1;
          this.vx = (dx / dd) * throwSpd + p.vx;
          this.vy = (dy / dd) * throwSpd + p.vy;
          this.x = p.cx - this.w / 2;
          this.y = p.cy - this.h / 2;
          this.hitCd.clear(); // ResetLocalNPCHitImmunity
          cd = this.prm.thrownHitCd;
          break;
        }
        this.spinT++;
        // :41218-41227 vector6 = (direction,0).RotatedBy(π×10×(t/60)×direction);
        // Y×0.8;向下(gravDir>0)再减半——扁椭圆轨迹,上快下慢。
        // direction = 上面 ChangeDir 的结果(原版同 tick 先转面后取 player.direction)
        const a = Math.PI * 10 * (this.spinT / 60) * spinDir;
        let ox = Math.cos(a) * spinDir, oy = Math.sin(a) * spinDir;
        oy *= 0.8;
        if (oy > 0) oy *= 0.5;
        this.x = p.cx + ox * this.prm.orbitRadius - this.w / 2;
        this.y = p.cy + oy * this.prm.orbitRadius - this.h / 2;
        this.vx = 0; this.vy = 0;
        cd = this.prm.spinHitCd;
        break;
      }
      case 1: { // 掷出态（:41230-41263）：直线无重力;再按 → 垂地悬荡(6)
        this.stT++;
        // ★再按目标态 = 6(:41238),非 3——1456 的 case 3 在 AI_015 内无任何入口
        //   (ai[0] 全部赋值点 :41204/:41238/:41251/:41275/:41292/:41355/:41370 无 3),
        //   是死状态;此前误接 3(垂链) = 飞行中再按球悬链不落地,行为偏差
        if (held) {
          this.vx *= 0.2; this.vy *= 0.2; // :41241
          // 757 气泡:速度×0.2 后×1.3,当场生成(:41242-41246)——
          // 此前缓存到帧尾=迟 1t 且位置已积分,1:1 改当场
          this.bubble757(this.vx * 1.3, this.vy * 1.3);
          this.st = 6; this.stT = 0;
          break; // break 在 ChangeDir 之前(:41247)——本 tick 不转面
        }
        if (this.stT >= this.prm.flightTicks || distHand() >= maxRange) {
          this.vx *= 0.3; this.vy *= 0.3; // :41254
          this.bubble757(this.vx * 1.3, this.vy * 1.3); // :41255-41259
          this.st = 2; this.stT = 0;
        }
        this.changeDir(p, p.cx < this.cx ? 1 : -1); // :41261 面朝球
        cd = this.prm.thrownHitCd;
        break;
      }
      case 2: { // 回拉态（:41265-41286）：向手回拉,近手消失;再按 → 垂地
        if (distHand() <= retractKill) { this.dead = true; return; }
        if (held) { this.st = 6; this.stT = 0; this.vx *= 0.2; this.vy *= 0.2; break; }
        this.vx *= 0.98; this.vy *= 0.98;
        this.moveTowardsHand(p, retractKill, pullAccel);
        this.changeDir(p, p.cx < this.cx ? 1 : -1); // :41284 面朝球(仅未再按支)
        cd = this.prm.thrownHitCd;
        break;
      }
      case 3: { // 垂链态（:41288-41330 1:1）：持按悬垂摆动;松手 → 回收;
        //  超链长段 ×0.98 朝手 MoveTowards(num9=14, num8=1)；链内近停段 X×0.96/Y+0.2
        //  （玩家静止再 X×0.96）；tileCollide 按是否超 num17 切换；玩家面朝球(:41328)
        if (!held) { this.st = 4; this.stT = 0; break; }
        {
          const dHand3 = Math.hypot(p.cx - this.cx, this.cy - p.cy);
          if (dHand3 > num17) {
            this.vx *= 0.98; this.vy *= 0.98;
            this.moveTowardsHand(p, 14, 1); // velocity ×0.98 后朝手 MoveTowards(14, 1)（num9/num8）
          } else {
            if (Math.hypot(this.vx, this.vy) < 6) {
              this.vx *= 0.96;
              this.vy += 0.2;
            }
            if (p.vx === 0) this.vx *= 0.96;
          }
          this.changeDir(p, p.cx < this.cx ? 1 : -1); // :41328 面朝球
          cd = this.prm.thrownHitCd;
        }
        break;
      }
      case 5: { // 坠落态（:41352-41367,撞墙入口见下方 tile 碰撞）：重力坠地
        this.stT++;
        if (this.stT >= this.prm.flightTicks + 5) { this.st = 6; this.stT = 0; break; }
        cd = this.prm.thrownHitCd;
        this.vy += 0.6;
        this.vx *= 0.95;
        this.changeDir(p, p.cx < this.cx ? 1 : -1); // :41364 面朝球(else 支)
        break;
      }
      case 6: { // 垂地悬荡态（:41367-41382）：持按垂链;松手/超程 → 回收
        if (!held || distHand() > num18) { this.st = 4; this.stT = 0; break; }
        if (!this.shimmerWet) this.vy += 0.8; // :41374-41376 微光中不受重力（读湿段旗,R3 收编）
        this.vx *= 0.95;
        this.changeDir(p, p.cx < this.cx ? 1 : -1); // :41380 面朝球
        break;
      }
      case 4: { // 回收态（:41331-41351）：无视碰撞回手
        if (distHand() <= returnKill) { this.dead = true; return; }
        this.vx *= 0.98; this.vy *= 0.98;
        this.moveTowardsHand(p, returnKill, returnAccel);
        // 越手击杀（:41337-41343 Dot(dirToHand, dirFrom(目标点))<0 → Kill）
        const tx2 = this.x + this.w / 2 + this.vx, ty2 = this.y + this.h / 2 + this.vy;
        const hx = p.cx - tx2, hy = p.cy - ty2;
        const hd = Math.hypot(hx, hy) || 1;
        const sx = (p.cx - (this.x + this.w / 2)) / (distHand() || 1);
        const sy = (p.cy - (this.y + this.h / 2)) / (distHand() || 1);
        if (sx * (hx / hd) + sy * (hy / hd) < 0) { this.dead = true; return; }
        this.changeDir(p, p.cx < this.cx ? 1 : -1); // :41349 面朝球
        break;
      }
      default: break;
    }
    // ---- AI_015_Flails_Dust（1457 :45218-45294,调用挂 AI_015_Flails 尾 :44983;
    // doFastThrowDust=掷出态 :41232）----
    // ★挪序修正(2026-09-02 红队 #4):原版该调用在 AI_015_Flails 尾部（AI() 分派器
    // :25630 内）=【移前位】——此前本块落在 moveAndCollide(:44460 系)之后读移后位,
    // 掷出态 14-16px/t 偏移比 949 更大;现整块上移到位移之前,与原版 AI 先行序对齐
    // （六型 26/35/948/25/154/757 共用同一尘块一处改）。上游触发条件核实:原版每 tick
    // 无条件调用（AI 尾,无 ai[0]/态门）,本块同形（态机 case 内 return 的 Kill 拍
    // 早退无尘,两侧一致）。
    // R30 §5.3 P2：26=每 tick d172（v×0.4,alpha100,scale1.5,noGravity,v÷2,:45268-45274）/
    // 35=每 tick d6 火（v×0.4,alpha100,scale3,noGravity,v×2,:45285-45292）/
    // 948=!wet 门 d6（v×0.4,alpha100,scale1.2,noGravity,v×4 再与弹速取均值,:45275-45284）
    // ——此前 35/948 无条件 spawnParticles 橙粒、26 走 20% 自绘,粒型/概率/scale 三元组全错。
    if (this.projId === 26) {
      const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 172,
        this.vx * 0.4, this.vy * 0.4, 100, null, 1.5);
      if (d) { d.noGravity = true; d.vx /= 2; d.vy /= 2; }
    } else if (this.projId === 948) {
      // !wet 门（1458 :45263-45267 wet=湿段维护旗——R3 收编字段读,内联直测退役）
      if (!this.wet) {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 6,
          this.vx * 0.4, this.vy * 0.4, 100, null, 1.2);
        if (d) { d.noGravity = true; d.vx = (d.vx * 4 + this.vx) / 2; d.vy = (d.vy * 4 + this.vy) / 2; }
      }
    } else if (this.projId === 35) {
      const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 6,
        this.vx * 0.4, this.vy * 0.4, 100, null, 3);
      if (d) { d.noGravity = true; d.vx *= 2; d.vy *= 2; }
    } else if (this.projId === 25) {
      // 25（:41742-41751）：尘 14,Next(掷出态?1:15)==0——掷出态每 tick,其余 1/15
      if (Math.floor(Math.random() * (fastThrow ? 1 : 15)) === 0) {
        game.spawnDust?.(this.x, this.y, this.w, this.h, 14, 0, 0, 150, null, 1.3);
      }
    } else if (this.projId === 154) {
      // 154（:41800-41805）：尘 115,noGravity,初速 v×0.4 后 ×0.25（净 ×0.1）
      const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 115,
        this.vx * 0.4, this.vy * 0.4, 140, null, 1.5);
      if (d) { d.noGravity = true; d.vx *= 0.25; d.vy *= 0.25; }
    } else if (this.projId === 757) {
      // 757（:41753-41770）双段：①弹体处 2 掷 Next(|v|<8?10:4)==0 尘 5（scale 0.8、
      //   fadeIn 1.3、velocity+=v/4;掷出态 num 减半）②链上 lerp 段 10 掷 Next(40)==0,
      //   位置=Lerp(玩家心,球心,rand)+(−8,0) 落 16×16 盒,scale 1.3、velocity+=v/4
      const fastDiv = fastThrow ? 2 : 1;
      const num1 = (Math.hypot(this.vx, this.vy) < 8 ? 10 : 4) / fastDiv;
      for (let i = 0; i < 2; i++) {
        if (Math.floor(Math.random() * num1) === 0) {
          const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 5, 0, 0, 0, null, 0.8);
          if (d) { d.vx += this.vx / 4; d.vy += this.vy / 4; d.fadeIn = 1.3; }
        }
      }
      const num2 = 40 / fastDiv;
      for (let i = 0; i < 10; i++) {
        if (Math.floor(Math.random() * num2) === 0) {
          const lx = p.cx + (this.cx - p.cx) * Math.random() - 8;
          const ly = p.cy + (this.cy - p.cy) * Math.random();
          const d = game.spawnDust?.(lx, ly, 16, 16, 5, 0, 0, 0, null, 1.3);
          if (d) { d.vx += this.vx / 4; d.vy += this.vy / 4; }
        }
      }
    }
    // ---- 通用湿段（:16903-17113,projWetSection 共享体——AI 链尾（switch+dust 后）/
    //      位移前 = 原版 post-AI 同位;湿 AI 消费者读取位在上方（R3"湿段放其读取位后"）,
    //      域注/收编/杀拍注见字段块）----
    //  ★⑧Shimmer() 接面（2026-09-07 缺面清单清偿）：域全 aiStyle 15 → 链球支
    //  （P.cs:22643-22654）——vy>0 弹反 + vy-=0.4 钳 ≥-8,【旗不清】无 timeLeft 面;
    //  头门 :22566 ai[0]∈{2,4}（回拉/回收态）早退。面适配：ai0≡st/ai1≡stT
    //  （AI_015 状态机同名字段既案）;hostile=false（域全 friendly）;timeLeft 面传出
    //  但 15 支不写（本仓 life 不回写=零消费）;kill 缺省=15 支无 Kill（深浸 Kill 属
    //  弹反族 A/B;头门已拦回拉/回收）。
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater, {
        shimmer: (st, x, y, _w, _h) => {
          const sf: ProjShimmerFace = {
            projId: this.projId,
            aiStyle: projectileData(this.projId)?.aiStyle ?? -1,
            hostile: false,
            vx: this.vx, vy: this.vy,
            timeLeft: this.life,
            ai0: this.st, ai1: this.stT,
            wet: this.wet, shimmerWet: this.shimmerWet,
            rainbowSlimeUnlocked: false,
          };
          projShimmerStep(sf, st, x, y, this.cx);
          this.vx = sf.vx; this.vy = sf.vy;
          this.wet = sf.wet; this.shimmerWet = sf.shimmerWet;
        },
      });
    // 948→947 变型检查（原文本位 = AI_015_HandleMovementCollision :44542 位移后读
    // 【当拍】旗——湿段已在本拍刷新旗,此处同拍等价;头注见上。★微光弹反对 948 不
    // 触发变型误判：弹反双清湿旗仅 famA/B/99 支,15 支旗不动,wet 字段=本拍湿段终值,
    // 与原文 :44542 同相）
    if (this.projId === 948 && this.wet && !this.lavaWet) this.projId = 947;
    // 位移 + tile 碰撞（AI_015_HandleMovementCollision :44460-44527）：
    // ★原版链球本体不扫格——lastVelocity 差分读数来自【标准弹体 Collision.TileCollision】
    // （Update 序:AI 先行/TileCollision 随后,AI_015_HandleMovementCollision 于 :19437
    // 后置调用）。此前 bespoke 全格扫描在斜砖/半砖上重演「几何空区被判实心」的帧0互锁
    // （Boomerang 三批同病）;2026-09-01 改走 moveAndCollide 正典管线:
    //   · 命中轴判定 =【速度被改】差分(1:1 决策落地,与 :44471/:44477 同构,
    //     slopeCollide 贴附速度编辑同样计入——曾旗标保守口径,决策后撤销)
    //   · 命中轴覆写为 -lastV×rest(:44478/:44484 反射式),bounces++ 每次 tick 全计
    //   · dropThrough=true(弹体 fallThrough 缺省 true)/旋转态由 AI 钉位不进本支/
    //     回收态 st==4 由外层 continue 跳过 → tileCollide 恒 true 进管线
    if (this.st !== 0 && this.st !== 4) {
      const rest = this.st === 1 || this.st === 5 ? 0.4 : this.st === 6 ? 0 : 0.2;
      const world = game.world;
      const lvx = this.vx, lvy = this.vy;
      // ★水中位移阻尼（HandleMovement :17721-17764,tileCollide=true 适用）——速度场
      //  不减只削当拍位移;反射式 (-lvx×rest) 读未阻尼 lastVelocity（原版同构）
      const dragF = projWaterDragFactor(this);
      let dustN = 0;
      const body = {
        x: this.x, y: this.y, w: this.w, h: this.h,
        vx: this.vx, vy: this.vy,
        onGround: false, hitWall: false, hitHead: false, collideY: false,
        hoik: true,   // ★FX34c 弹幕域 hoik=true（Body.hoik 注:原版 Projectile 全路径）
        tileCollide: true, dropThrough: true,
      };
      moveAndCollide(body, world, lvx * dragF, lvy * dragF);
      // ★1:1 决策落地(2026-09-01):命中轴判定与原版完全同构 = 【速度被改】差分
      //   (:44471 velocity.X != lastVelocity.X)——slopeCollide 贴附等速度编辑同样计入。
      //   ★二修:采纳管线后速度而非恢复 lvx/lvy——贴坡粘滞/落面钳制等编辑持久化,
      //   否则阶梯场景每帧同初速重触撞永动锁死(用户实录右下弹射)。
      const chX = body.vx !== lvx, chY = body.vy !== lvy;
      this.x = body.x; this.y = body.y;
      this.vx = body.vx; this.vy = body.vy;
      if (chX) {
        this.vx = -lvx * rest;
        this.bounces++; // localAI[0]:每次接触都计(:44476/:44482)——只计 >4 会让缓磨墙永不触发逃生
        if (Math.abs(lvx) > 4) dustN = 1; // num2>0 门(:44470-44472)
      }
      if (chY) {
        this.vy = -lvy * rest;
        this.bounces++;
        if (Math.abs(lvy) > 4) dustN = 1; // (:44477-44479)
      }
      // 掷出态撞墙 → 坠落态（:44505-44520）:转态 + localNPCHitCooldown=10 覆写
      // （:44506——当拍 Damage 冷却改全局档,经 cdOverride 消费）+ 冲击波两连（窗口=
      // 撞后落位 TopLeft..BottomRight）+ 位置回卷(position -= vector,:44518)+ num2=2
      if (this.st === 1 && (chX || chY)) {
        this.st = 5; this.stT = 0;
        this.cdOverride = 10;         // localNPCHitCooldown = num(:44505)——本拍/次拍伤害冷却
        this.impactExplosion(game, lvx, lvy);   // 窗口须读回卷前落位(:44510-44513 原序)
        this.x -= lvx; this.y -= lvy; // position -= vector(:44518)——撞墙 tick 不陷墙
        dustN = 2;                    // 无视 |lastV|>4 门,音尘双份(HitTiles×2 :44524-44528)
      }
      if (dustN > 0) this.hitTileFx(game, this.x, this.y, dustN);
      // 卡死逃生（:44529-44533）：弹墙≥10 次且非 3/0/5/6 态 → 强制回收
      if (this.st !== 3 && this.st !== 0 && this.st !== 5 && this.st !== 6 && this.bounces >= 10) {
        this.st = 4; this.stT = 0;
      }
    }
    // 旋转:247/1058 的 switch(type) 段内置 flag=false(:41437/:41395)——通用段
    // (:41485-41493 速度>1 对齐速度向,否则按 vx 缓转)被跳过,走各自专属式
    if (this.projId === 247) {
      // :41438-41442:rotation ±=(|vx|+|vy|)×0.01(按 vx 符号);旋转态再 +2π/15×direction
      const n22 = (Math.abs(this.vx) + Math.abs(this.vy)) * 0.01;
      this.rotation += this.vx > 0 ? n22 : -n22;
      if (this.st === 0) this.rotation += (Math.PI * 2 / 15) * p.facing;
    } else if (this.projId === 1058) {
      // :41396-41398:rotation 恒指玩家(-π/2 补偿),不随飞行向
      this.rotation = Math.atan2(p.cy - this.cy, p.cx - this.cx) - Math.PI / 2;
    } else {
      const spd = Math.hypot(this.vx, this.vy);
      if (spd > 1) this.rotation = Math.atan2(this.vy, this.vx) + this.vx * 0.1;
      else this.rotation += this.vx * 0.1;
    }
    // 1058 出场淡入(:41386-41394,SetDefaults alpha=255 :9719;全状态无门)
    if (this.alpha > 0) this.alpha = Math.max(0, this.alpha - 50);
    // ---- AI_015 特例子弹(:41383-41478 switch(type) 尾段) ----
    // ★原版该 switch(type) 特例段在【全部状态】运行(:41383-41478,无 ai[0] 门)——
    // 此前 st!==4 把回收态排除,1:1 对齐移除(2026-08-13)
    if (this.spawnProj) {
      if (this.projId === 247) {
        // Flairon:每 20t(脱靶续 17)600px 内最近敌(距离+CanHit)→ 自机弹 248
        // (:41435-41478)damage/1.5、kb/2、速 14
        this.subT++;
        if (this.subT >= 20) {
          this.subT = 17;
          const cx0 = this.x + this.w / 2, cy0 = this.y + this.h / 2;
          let best = 600, bx = 0, by = 0, found = false;
          for (const ent of game.enemies()) {
            const e = ent as { x: number; y: number; w: number; h: number; dead: boolean };
            if (!canBeChasedBy(ent)) continue;   // CanBeChasedBy :91070——友好 NPC 不入索敌（防追踪睡渔夫）
            if (e.dead) continue;
            if (!canHit(game.world.store, this.x, this.y, this.w, this.h, e.x, e.y, e.w, e.h)) continue;
            const d = Math.hypot(e.x + e.w / 2 - cx0, e.y + e.h / 2 - cy0);
            if (d < best) { best = d; bx = e.x + e.w / 2; by = e.y + e.h / 2; found = true; }
          }
          if (found) {
            this.subT = 0;
            const dd = Math.hypot(bx - cx0, by - cy0) || 1;
            this.spawnProj(cx0, cy0, ((bx - cx0) / dd) * 14, ((by - cy0) / dd) * 14,
              248, Math.round(this.damage / 1.5), this.knockback / 2);
          }
        }
      } else if (this.projId === 1058) {
        // 轨道刺(:41409-41430):旋转态每 3-6t/其余态每 6t,朝【玩家反向】掷 405
        // (:41425-41429 v=(ball-player)norm×(4.5-6.5)±π/4);damage 满额/旋转态 kb×0.5
        this.subT++;
        // :41412-41421 num28:默认 4;垂链/悬荡态(vanilla 6/3)→ 6;旋转态 Next(3,6)=3-5
        const need = this.st === 0 ? 3 + Math.floor(Math.random() * 3)
          : this.st === 3 || this.st === 6 ? 6 : 4;
        if (this.subT >= need) {
          this.subT = 0;
          const dxp = this.x + this.w / 2 - p.cx, dyp = this.y + this.h / 2 - p.cy;
          const dp = Math.hypot(dxp, dyp) || 1;
          const base = Math.atan2(dyp / dp, dxp / dp);
          const ang = base + (Math.random() - 0.5) * Math.PI / 2;
          const spd = (4.5 + Math.random() * 2);
          flaironSpikePenPending = this.armorPen;        // ④ 泡泡继承父弹穿甲（:44908 同链
          //   EntitySource_Parent → ApplyStatsFromSource :11141;Game 侧折入态见载体注）
          this.spawnProj(this.x + this.w / 2, this.y + this.h / 2,
            Math.cos(ang) * spd, Math.sin(ang) * spd, 405, this.damage,
            this.st === 0 ? this.knockback * 0.5 : this.knockback);
        }
      }
    }
    // direction/spriteDirection = sign(vx)（★BJ344 勘正:旧注 :41479-41483 系 1456 世代,
    // 1457 = :44957-44961 每 tick 重写,vx==0 → -1;1058 豁免=专属式 :44876-44885 离玩家向
    // （player−ball X<0 → 1）每拍连 spriteDirection 覆写 :44885——本仓 1058 spriteDir 曾
    // 出生冻结=绘制面缺口,本刀补齐）——绘制侧 -1 水平翻转（Main.cs:30529-30532——★BJ665 勘正 伪锚 :29827-29831）,曾恒 false
    if (this.projId !== 1058) this.spriteDir = this.vx > 0 ? 1 : -1;
    else this.spriteDir = p.cx < this.cx ? 1 : -1;
    // ★BJ344 F3（kdir 家族,BJ340 台账 §4 三面亲审定谳）：aiStyle 15 全族伤害期覆写
    //  （:13667-13678）：num40 = 玩家相对敌位（逐敌,与 AI 期 direction 字段无关——
    //  1058 AI 写 :44876-44883 离玩家向只活到 ChangeDir/spriteDirection,伤害层被覆写表
    //  盖掉;旧注「:41398-41405 球侧专属式」系 1456 锚误读,本刀摘 1058 分叉全族统一,
    //  式 (p<e)?1:-1 与 :13669 逐字同形）+ num5 相位缩放 ai0==0×0.35/ai0==6×0.5
    //  （:13670-13677 两 if 独立;态门=repo st 直映 ai[0],state3 1457 仍无入口死态
    //  :44645-44860 赋值面无 3）
    hitEnemies(this, game, this.hitCd, this.cdOverride ?? cd, 0, this.armorPen,
      undefined, undefined, false, undefined, 0,
      (e) => {
        const t = e as { cx?: number; x: number; w: number };
        return p.cx < (t.cx ?? t.x + t.w / 2) ? 1 : -1;
      },
      this.st === 0 ? 0.35 : this.st === 6 ? 0.5 : 1);
    this.cdOverride = null;   // 单拍覆盖位消费即清（下一 tick 回 case5 常规档 thrownHitCd）
  }

  /** velocity MoveTowards(手方向×targetSpd, accel)（case2 :41283 / case3 :41311-41315 同式） */
  private moveTowardsHand(p: { cx: number; cy: number }, targetSpd: number, accel: number): void {
    const d = Math.hypot(p.cx - (this.x + this.w / 2), p.cy - (this.y + this.h / 2)) || 1;
    const tx = ((p.cx - (this.x + this.w / 2)) / d) * targetSpd;
    const ty = ((p.cy - (this.y + this.h / 2)) / d) * targetSpd;
    const ddx = tx - this.vx, ddy = ty - this.vy;
    const dd = Math.hypot(ddx, ddy);
    if (dd <= accel) { this.vx = tx; this.vy = ty; }
    else { this.vx += (ddx / dd) * accel; this.vy += (ddy / dd) * accel; }
  }

  /** Player.ChangeDir（Player.cs:42412-42437——★BJ665 勘正 伪锚 :41440-41460）:同向早退只写 direction;原版还镜像
   *  手臂合成旋转/itemRotation/itemLocation——本仓无手臂/持物朝向系统,仅落 facing */
  private changeDir(p: { facing: number }, dir: number): void {
    if (p.facing !== dir) p.facing = dir;
  }

  /** 液体接触探测（2026-08-31 台账 B⑥ 清偿——原"中心格+liquid>64"近似退役）:
   *  type 省略 = Collision.WetCollision（1458 Collision.cs:1575-1652,1456 同段 :1575 起）:
   *    探针盒 = 弹体盒心 min(10,W) × min(H/2,H)（:1582-1593 num=10/num2=H÷2）;
   *    扫描窗 = pos/16−1 .. (pos+W)/16+2 双轴;液体格表面带 y = j*16+(256−liq)/16
   *    （:1610-1613 num5=(256−liq)/32×2）、可见深 = 16−trunc((256−liq)/32×2),
   *    探针盒与之矩形相交即湿——任意液体>0 含岩浆（阈值不再 64,浅层/边缘浸没亦判湿,
   *    消费点自动继承:948 入水转态/拖尾尘 !wet 门/case6 微光重力豁免）。
   *  type==2 岩浆 = LavaCollision（:1657-1691）:【全弹盒】与同一表面带交叠（形状两分!）。
   *  其余型（3 蜂蜜/4 微光）按 liquidType 细分沿用 Wet 探针形——vanilla 以 honey()/shimmer()
   *  旗标在 Wet 扫描内附带判定(:1627-1646),本仓参数化等价承载。
   *  坡面支已建模（终清波）：active+slope!=0+上方格液体 → 整深 16px 相交判湿
   *  （:1631-1654,store.slope 数据面承载;lava 全盒档无此支,原版即两分）。 */
  private inLiquid(game: GameHooks, type?: number): boolean {
    const st = game.world.store;
    const fullBox = type === 2;                       // LavaCollision 全盒档
    const pw = fullBox ? this.w : Math.min(10, this.w);          // num:int 除
    const ph = fullBox ? this.h : Math.trunc(this.h / 2);        // num2:min(H/2,H)=H/2
    // ★F2①（2026-09-01）：中心两项 = C# `(float)(Width/2)` 式【整数除】
    // （Collision.cs:1580/:1583/:1593/:1596 五连整除族,WetCollision;LavaCollision
    // 全盒档不经此路）——奇数尺寸弹浮点除即偏 0.5px（同族坑清单见 npcLiquid.ts:44-52）
    const px = fullBox ? this.x : this.x + Math.trunc(this.w / 2) - Math.trunc(pw / 2);
    const py = fullBox ? this.y : this.y + Math.trunc(this.h / 2) - Math.trunc(ph / 2);
    // ★F2②：扫描窗钳制对齐 Wet/Lava 两原文（Collision.cs:1595-1598/:1663-1666
    // Utils.Clamp 0..maxTilesX−1 / 0..maxTilesY−40）与两兄弟副本
    // （TouchDamage.liquidCollision/drownCollision、npcLiquid.wetCollision 同式）
    // ——世界右缘末列/狱底 40 行带原版不扫（钳后上界 exclusive 循环）。
    const t0x = Math.max(0, Math.floor(this.x / TILE) - 1);
    const t1x = Math.min(st.w - 1, Math.floor((this.x + this.w) / TILE) + 2);   // 循环 < 上界(原版同构)
    const t0y = Math.max(0, Math.floor(this.y / TILE) - 1);
    const t1y = Math.min(st.h - 40, Math.floor((this.y + this.h) / TILE) + 2);
    for (let tx = t0x; tx < t1x; tx++) {
      for (let ty = t0y; ty < t1y; ty++) {
        if (!st.inBounds(tx, ty)) continue;
        const idx = st.idx(tx, ty);
        const liq = st.liquid[idx];
        if (liq > 0) {
          // 液体型过滤：LavaCollision(:1675 tile.lava())同样按型筛——仅形状(全盒)与 Wet 分家
          if (type !== undefined && st.liquidType[idx] !== type) continue;
          // 表面带（ Wet :1609-1616 / Lava :1672-1680 同式）
          const surfY = ty * TILE + ((256 - liq) / 32) * 2;
          const depth = 16 - Math.trunc(((256 - liq) / 32) * 2);
          if (px + pw > tx * TILE && px < tx * TILE + TILE
            && py + ph > surfY && py < surfY + depth) return true;
        } else if (!fullBox) {
          // 坡面支（Collision.cs:1631-1654，仅 Wet 探针形档——LavaCollision 无此支）：
          // active+slope!=0+j>0 且上方格液体>0 → 【整深 16px】矩形相交即湿。
          // type 参数过滤同样作用于上方格液体型。★store.slope 数据面已就位
          // （TileStore.ts:29）——"坡面支未建模(store 无斜度旗)"登记缺口清偿（终清波）
          // ★L1（2026-09-01 NX3 遗留清偿）：active = 原版 tile.active()【纯在场位】
          //   （Tile.cs active()=HasTile，无 inActive 检查）⇒ 致动斜坡同样判湿；
          //   旧 isActive=nactive() 口径漏判——与 npcLiquid/SmartSelect 三副本
          //   同步改纯在场 type!==0。
          //   ★红蓝对抗 A-F3（2026-09-03）：幽灵保域后 type!==0 亦非纯在场位——
          //   残型格 flags=0,type≠0 须判干，三副本同步改读 flags bit0（=active() 位本体）。
          if (ty <= 0 || st.flags[idx] === 0 || st.slope[idx] === 0) continue;
          const upIdx = st.idx(tx, ty - 1);
          if (st.liquid[upIdx] <= 0) continue;
          if (type !== undefined && st.liquidType[upIdx] !== type) continue;
          if (px + pw > tx * TILE && px < tx * TILE + TILE
            && py + ph > ty * TILE && py < ty * TILE + TILE) return true;
        }
      }
    }
    return false;
  }

  /** 757 Drippler 气泡 928(:41243-41246/:41256-41259):两过渡点当场掷出,
   *  速度 = (衰减后 velocity)×1.3,damage/knockBack 满额——实际生成走 spawnProj 回调 */
  private bubble757(vx: number, vy: number): void {
    if (this.projId === 757 && this.spawnProj) {
      this.spawnProj(this.cx, this.cy, vx, vy, 928, this.damage, this.knockback);
    }
  }

  /** 撞墙反馈(num2 次 Collision.HitTiles 尘 + 一次 SoundID 0 挖掘音,:41026-41033) */
  private hitTileFx(game: GameHooks, hx: number, hy: number, n = 1): void {
    game.spawnParticles(hx + this.w / 2, hy + this.h / 2, '#A09080', 3 * n, 1.5, { life: 14, size: 2 });
    game.playSfx('dig', 1, hx + this.w / 2, hy + this.h / 2);
  }

  /** 掷出态撞墙冲击波（GAP#8 ④ 终清波两连实装,AI_015_HandleMovementCollision
   *  :44499-44502 + CreateImpactExplosion :70716-70761 + CreateImpactExplosion2_
   *  FlailTileCollision :70857-70905；**本方法在位移回卷前调用——窗口=撞后落位**）：
   *  ① CreateImpactExplosion(multiplier=2, Center, 扫窗=TopLeft..BottomRight tile 坐标
   *     【含端】, explosionRange=width px)：窗内与圆心距 ≤range 的 active·tileSolid·
   *     非 solidTop·非 frameImportant 且上方无「active+solid+非 solidTop」块的格,
   *     按 KillTile_GetTileDustAmount(fail:true)×multiplier 出【块色】尘(vy −= 3+num×1.5
   *     后×NextFloat、scale += num×0.03,num=4 内部常量),amount≥2 补 amount−1 颗
   *     vy−=1+4 的上抛;任一粒成功 → causedShockwaves=true。
   *     ★per-tile 尘型/数量表 = WorldGen.KillTile_MakeTileDust 系统待移植——合格格以
   *     合成 d14 占位承载【筛选几何 + shockwave 判定】,frameImportant/solidTop 精确
   *     家具族随表批并入；
   *  ② 白尘椭圆环精确值：d31 ×8 主档(α=shock?0:50、color White×0.5、scale0.4、
   *     fadeIn .3+.4r、pos=origin+RotatedBy(k·2π/8)(7,0)×(1,0.7)、vy−=0.8/vx×0.8 后
   *     += 撞前速度单位向×2、noLight);!shock 补 8 颗 α100(vy=−1/vx×0.4/+= 单位向×1.5)
   *     ——spawnDust perfect 变体承载定点落位 */
  private impactExplosion(game: GameHooks, lvx: number, lvy: number): void {
    const st = game.world.store;
    const ox = this.x + this.w / 2, oy = this.y + this.h / 2;
    // ---- ① 块尘扫窗（:70725-70754）----
    const i0 = Math.floor(this.x / TILE), i1 = Math.floor((this.x + this.w) / TILE);
    const j0 = Math.floor(this.y / TILE), j1 = Math.floor((this.y + this.h) / TILE);
    let causedShockwaves = false;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        if (Math.hypot(ox - i * TILE, oy - j * TILE) > this.w) continue;      // 圆距 ≤ range(width)
        if (!st.isActive(i, j) || !st.isSolid(i, j)) continue;
        if (st.isPlatform(i, j)) continue;                                    // !solidTop 近似载体(登记见头注)
        if (st.isActive(i, j - 1) && st.isSolid(i, j - 1) && !st.isPlatform(i, j - 1)) continue; // 上方遮挡
        // fail:true 档常见缺省 3（TrackPass 表注），× multiplier=2 —— 粒型/逐型数量待尘型表批
        const num2 = 3 * 2;
        for (let k = 0; k < num2; k++) {
          const d = game.spawnDust?.(i * TILE, j * TILE, TILE, TILE, 14, 0, 0, 0, null, 1);
          if (!d) break;                                                      // Main.dust 池满即原版哑槽路径
          d.vy -= 3 + 4 * 1.5;
          d.vy *= Math.random();
          d.scale += 4 * 0.03;
          causedShockwaves = true;
        }
        {
          const extra = num2 - 1;
          for (let l = 0; l < extra; l++) {
            const d2 = game.spawnDust?.(i * TILE, j * TILE, TILE, TILE, 14, 0, 0, 0, null, 1);
            if (!d2) break;
            d2.vy -= 1 + 4;
            d2.vy *= Math.random();
          }
        }
      }
    }
    // ---- ② d31 椭圆环（:70857-70905）----
    const vmag = Math.hypot(lvx, lvy);
    const ux = vmag > 0 ? lvx / vmag : 0, uy = vmag > 0 ? lvy / vmag : 0;      // SafeNormalize(Zero)=零向量兜底
    const spin = (a: number): { x: number; y: number } => {                    // RotatedBy(a)×(1,0.7)
      const rx = Math.cos(a) * 7, ry = Math.sin(a) * 7;
      return { x: rx * 1 - ry * 0.7, y: rx * 0.7 + ry * 1 };
    };
    for (let n = 0; n < 8; n++) {
      const pt = spin(n * (Math.PI * 2) / 8);
      const d = game.spawnDust?.(ox, oy, this.w, this.h, 31, 0, 0,
        causedShockwaves ? 0 : 50, { r: 128, g: 128, b: 128, a: 128 }, 0.4, false, true);
      if (!d) continue;
      d.x = ox + pt.x; d.y = oy + pt.y;
      d.vy -= 0.8;
      d.vx *= 0.8;
      d.fadeIn = 0.3 + Math.random() * 0.4;
      d.vx += ux * 2; d.vy += uy * 2;
      (d as unknown as { noLight?: boolean }).noLight = true;
    }
    if (!causedShockwaves) {
      for (let n = 0; n < 8; n++) {
        const pt = spin(n * (Math.PI * 2) / 8);
        const d = game.spawnDust?.(ox, oy, this.w, this.h, 31, 0, 0,
          100, { r: 128, g: 128, b: 128, a: 128 }, 0.4, false, true);
        if (!d) continue;
        d.x = ox + pt.x; d.y = oy + pt.y;
        d.vy -= 1;
        d.vx *= 0.4;
        d.fadeIn = 0.3 + Math.random() * 0.4;
        d.vx += ux * 1.5; d.vy += uy * 1.5;
        (d as unknown as { noLight?: boolean }).noLight = true;
      }
    }
  }
}

// ================= 弗莱龙刺（proj 405，aiStyle 70 全语义 1:1，:29188-29239） =================

/** 1058 掷出的轨道刺 405（AI_015 :41425-41430 传 ai0=-10）：
 *  -10→0 漂入段(:29224-29231)：每 tick ai0++、α-25(下限 50)、vel×0.95;
 *  ai0==0 首寻(:29191-29215)：650px 内最近敌(CanHit 视线门)→ ai0=idx+1 并
 *  初次转向 (v×20+dir×Next(35,75)/30)/21；无目标 → ai0=-15(再漂 15t);
 *  ai0>0 追踪段(:29217-29219)：(v×40+dir×12)/41;
 *  撞块(:16905-16921 → 接触响应链 :18428-18446)：第 1 次接触反弹、第 2 次接触 Kill
 *  （localAI[0] 前增,<2 反射/否则 Kill——★MAJOR-1 2026-09-02 J′）;Kill 爆 20 颗火尘(:69686)。
 *  scale=ai1=Next(80,121)/100(:29233-29239);timeLeft 120/penetrate 1(SetDefaults :4584)
 *  ★T3 清偿（2026-09-02,原"登记不修"升格）:杀尘/音基准位改用碰撞后心 this.cx/cy
 *  （原版 Kill 自接触响应段 :18443 调用,position 已被 TileCollision 夹贴墙;
 *   旧帧首 cx0/cy0 差半格~一格）——详见 fixedUpdate Kill 块内注 */
/** ④ 泡泡穿甲出生载体（Projectile.armorPenetration 家族继承的引擎承载,2026-09-03 定谳）：
 *  原版两出射位(:30794 404/:44908 1058)均 NewProjectile(GetProjectileSource_FromThis(),…)
 *  = EntitySource_Parent → ApplyStatsFromSource(NewProjectile :10894 直调)继承父弹
 *  armorPenetration（P.cs:11141 `armorPenetration += entity.armorPenetration`）;父弹自
 *  item 2611/5526 的 EntitySource_ItemUse 继承(:11130),而两件 SetDefaults 均无
 *  armorPenetration 写（Item.cs:25519-25535）→ 弹体字段终值 0,真穿透来源 = 命中段
 *  :12852 `GetArmorPenetration(melee) + armorPenetration` 的玩家近战项（Player.cs:4350-4357,
 *  405 melee=true :4863 同吃）→ 405【有】穿甲可接（非证伪项）。本仓把该玩家项折入弹体
 *  armorPen 字段（Game 侧注入 404/1058）;405 实体经 Game.spawnProj 回调构造（签名无
 *  穿甲位）→ 出射前置位/ctor 消费清零（同步窗恒正确;未设位直接构造=缺省 0=原版弹体
 *  字段缺省）。命中链 = hitEnemies pen → Enemy.hurt checkArmorPenetration（:13684-13686） */
let flaironSpikePenPending = 0;
export class FlaironSpike extends Entity {
  w = 14; h = 14;
  damage: number;
  knockback: number;
  projId = 405;
  critChance = 0.04;
  meleeProj = true;
  /** ④ 穿甲（ctor 消费 flaironSpikePenPending 出生窗——机制见其注;原版字段终值 0,
   *  本仓承载 :12852 玩家近战项的折入态） */
  armorPen = 0;
  private ai0: number;   // -10 起步(1058 传参语义)
  private ai1: number;   // scale
  private alpha = 255;
  private bounces = 0;
  private hitCd = new HitCooldown();
  life = 120;
  dead = false;
  // ---- ★通用湿段（Projectile.cs:16903-17113;2026-09-06 R3 漏网类批 11 类之一）----
  //  域 id = {405 FlaironSpike}（SetDefaults :4860 块无 ignoreWater 行,缺省 false :763
  //  → 受段;与 PROJ_IGNORE_WATER 零交集）。位序：AI（漂入/索敌追踪,只写 velocity）
  //  → 湿段 → 位移（moveAndCollide）;湿段测位 = 上拍位移后位 = 本拍位移前位 ✓。
  //  阻尼：tileCollide 缺省 true（:4860 未关）→ 湿阻尼适用（位移入参）。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价——出生盒同位测值） */
  presetDone = false;   // ProjWetFlags.presetDone（共享湿段旗持有者）

  constructor(x: number, y: number, vx: number, vy: number, damage: number, knockback: number) {
    super();
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.knockback = knockback;
    this.armorPen = flaironSpikePenPending;   // ④ 出生窗消费即清零（防陈值泄漏他路构造）
    flaironSpikePenPending = 0;
    this.ai0 = -10;
    this.ai1 = (80 + Math.random() * 41) / 100; // Next(80,121)/100
  }

  draw(r: Renderer, cam: Camera): void {
    // α 原版语义(Main.cs:29635 color *= (255-alpha)/255——★BJ665 勘正 伪锚 :28965,越大越透明):SetDefaults 255
    // (:4590)出生隐形,漂入段每 tick -25 至 50(:29225-29229)→ 淡入。
    // 此前直接 alpha/255 当不透明度 = 方向写反(出生全显、越漂越透明)。
    // ★BJ367 尺寸修正：绘制=贴图原生 20×proj.scale（M.cs:35492 通支 source 全贴图+
    //   proj.scale,aiStyle70 无专支;scale=ai1 :29237）——旧 drawSize=14×ai1 按盒宽
    //   基准=整泡缩 30%（尾迹泡偏小,用户可见面）。锚定同通支:origin=(10, 盒高/2)=
    //   (10,7)→贴图左上=盒左上,与 drawProj num145 路径零参差。
    drawProj(r, cam, this, this.projId,
      Math.atan2(this.vy, this.vx) + Math.PI / 2, '#FFB060',
      Math.max(0, (255 - this.alpha) / 255), 0, false, false, this.ai1);
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    // ★BJ339-T1：寿命尽【不再头部静默退场】——原版 timeLeft-- 与 Kill 在 Update 尾
    //  （:17307-17312）,当拍 AI/湿段/位移/割面/伤害段全跑完后才 Kill（Kill 走 :74183
    //  type==405 支 = Item54 音 + 20×d212 爆尘）。旧头部判 = 提前一拍死且无尘无音,
    //  2 秒飘满的泡泡无声消失（用户可见面）。生命判断移至 fixedUpdate 尾（hit 段后,
    //  与 :17307 位序同——命中致灭 hitAny 出口先 return,与原版单次 Kill 幂等同构）
    this.hitCd.tick();
    const cx0 = this.x + this.w / 2, cy0 = this.y + this.h / 2;
    if (this.ai0 === 0) {
      // 首寻:650px 内最近敌(距离+CanHit)
      let best = 650, bx = 0, by = 0, found = false;
      for (const ent of game.enemies()) {
        const e = ent as { x: number; y: number; w: number; h: number; dead: boolean };
        if (!canBeChasedBy(ent)) continue;   // CanBeChasedBy :91070——友好 NPC 不入索敌（防追踪睡渔夫）
        if (e.dead) continue;
        if (!canHit(game.world.store, this.x, this.y, this.w, this.h, e.x, e.y, e.w, e.h)) continue;
        const d = Math.hypot(e.x + e.w / 2 - cx0, e.y + e.h / 2 - cy0);
        if (d < best) { best = d; bx = e.x + e.w / 2; by = e.y + e.h / 2; found = true; }
      }
      // 锚定语义：原版 ai[0]=idx+1 恒指【首个锁定目标】（NPC 索引引用,Projectile.cs
      // :29202-29215）;本仓实体模型无 NPC 索引域——以"逐拍取当前最近敌"承载追踪,
      // 实体身份/索敌表示层结构差沿用登记（引擎表示层批处理面）
      this.ai0 = found ? 1 : -15;
      if (found) {
        const num605 = (35 + Math.random() * 40) / 30; // Next(35,75)/30
        const jx = bx - cx0 + (Math.random() * 200 - 100);
        const jy = by - cy0 + (Math.random() * 200 - 100);
        const jd = Math.hypot(jx, jy) || 1;
        this.vx = (this.vx * 20 + (jx / jd) * num605) / 21;
        this.vy = (this.vy * 20 + (jy / jd) * num605) / 21;
      }
    } else if (this.ai0 > 0) {
      // 追踪:(v×40+dir×12)/41——原版恒指 ai[0] 锚定索引（表示层差,见首寻段注）,
      // 本仓以逐拍最近敌(650 内)承载
      let best = 650, bx = 0, by = 0, found = false;
      for (const ent of game.enemies()) {
        const e = ent as { x: number; y: number; w: number; h: number; dead: boolean };
        if (!canBeChasedBy(ent)) continue;   // CanBeChasedBy :91070——友好 NPC 不入索敌（防追踪睡渔夫）
        if (e.dead) continue;
        const d = Math.hypot(e.x + e.w / 2 - cx0, e.y + e.h / 2 - cy0);
        if (d < best) { best = d; bx = e.x + e.w / 2; by = e.y + e.h / 2; found = true; }
      }
      if (found) {
        const dd = Math.hypot(bx - cx0, by - cy0) || 1;
        this.vx = (this.vx * 40 + ((bx - cx0) / dd) * 12) / 41;
        this.vy = (this.vy * 40 + ((by - cy0) / dd) * 12) / 41;
      }
    } else {
      // 漂入/无目标:ai0++、α-25(下限 50)、vel×0.95
      this.ai0++;
      this.alpha = Math.max(50, this.alpha - 25);
      this.vx *= 0.95; this.vy *= 0.95;
    }
    // 反弹计数（1458 P.cs:18429-18445 type==405 支，位于 if(flag)=【lastVelocity !=
    // velocity】接触响应链内——localAI[0]++ 只在真接触时执行；旧注"无条件每 tick 计数"
    // 系对该行位上下文的误读，本仓事件计数口径即 parity）。反射改轴级差分判定。
    // ★MAJOR-1（2026-09-02 红队 J′）：原版 `localAI[0]++; if (localAI[0] < 2f) 反射
    // else Kill()` 是【前增】（0 起）——第 1 次接触 localAI=1 反射、第 2 次接触
    // localAI=2 → Kill(:18443 else)。旧码 `bounces<2 反射`+`>=3 Kill` = 反弹两次多飞
    // 一轮;等价式 = `bounces<1 反射` + `bounces>=2 Kill`（本仓 bounces 后增语义核对后）
    // ---- 通用湿段（:16903-17113,projWetSection 共享体——AI 后/位移前,原版位序）----
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater);
    {
      const lvx0 = this.vx, lvy0 = this.vy;
      const body = {
        x: this.x, y: this.y, w: this.w, h: this.h,
        vx: lvx0, vy: lvy0,
        onGround: false, hitWall: false, hitHead: false, collideY: false,
        hoik: true,   // ★FX34c 弹幕域 hoik=true（Body.hoik 注:原版 Projectile 全路径）
        tileCollide: true, dropThrough: true,
      };
      // ★水中位移阻尼（HandleMovement :17721-17764,tileCollide=true 适用）——速度场
      //  不减只削当拍位移;反射式 (−lvx0) 读未阻尼 lastVelocity（原版同构）
      const drag405 = projWaterDragFactor(this);
      moveAndCollide(body, game.world, lvx0 * drag405, lvy0 * drag405);
      const collided = body.hitWall || body.collideY || body.onGround || body.hitHead;
      this.x = body.x; this.y = body.y;
      if (collided) {
        if (this.bounces < 1) {
          // 第 1 次接触：命中轴取 −lastVelocity 续飞（:18431-18442,轴独立判定）
          if (body.vx !== lvx0) this.vx = -lvx0;
          if (body.vy !== lvy0) this.vy = -lvy0;
        }
        this.bounces++;
      }
    }
    if (this.bounces >= 2) { this.killExplode(game); return; }   // :18443 else→Kill
    // ★MAJOR-2（2026-09-02 红队 J′）：penetrate=1 命中敌 → Damage() 内 :14189
    // penetrate-- → 0（keepIterating=false）→ Update :17312 `if (penetrate == 0) Kill()`
    // 同拍消亡——旧码命中后继续飞 = 无限穿透。onHit 回调记账后走既有爆尘出口
    // ★BJ285（BJ232 死亡段割面族,2026-09-22）：CutTiles（Projectile.cs:12517 调用点/方法 :15276）先于 Damage_PVE
    //  （:12523）——405 penetrate=1 首中即亡拍【照割】（SetDefaults :4859-4868,aiStyle 70/
    //  friendly/melee）;中央割 !e.dead 门=死亡拍整缺 → BJ260 前置习语。405 过两道门
    //  （CanCutTiles :15407 两表均无;Damage_CanDealDamage :12461 无）。
    cutTilesBox(game, this.x, this.y, this.w, this.h);
    let hitAny = false;
    // ④ pen = armorPen（:12852 num6 命中段合并玩家近战项——旧码硬 0 = 泡泡不掉防）
    //  ★BJ339-T3：hurtPierce=1（flag3 单发弹 :12635 maxPenetrate==1——命中门无视共享
    //  免疫窗已由逐弹私账承载,此处对齐 hurt 侧 :14176 `penetrate != 1` 分支不达 =
    //  命中【不写】敌免疫帧——405 命中后 404/悠悠球等共享窗弹不被自己挡）
    hitEnemies(this, game, this.hitCd, 10, Math.sign(this.vx) || 1, this.armorPen,
      () => { hitAny = true; }, undefined, false, undefined, 1);
    if (hitAny) { this.killExplode(game); return; }
    // ★BJ339-T1：寿命尽 = timeLeft 到期（:17307-17312 → Kill → :74183 尘+音）
    if (--this.life <= 0) { this.killExplode(game); return; }
  }

  /** Kill 出口（:18443 else→Kill → P.cs:74184-74208 爆尘;MAJOR-2 命中致灭同走此件）。
   *  Kill 爆尘（台账 C 批清偿——旧合成橙粒近似退役）:
   *  Item54 音 + 20× d212 真值尘——NewDust(20×20 盒)后落点归位到半径
   *  10*scale 圆上、velocity=径向 × 原抖动长,num297<30 恒真分支;
   *  color = hslToRgb(hue 0.4+rand×0.2, sat0.9, lum0.5) 再 lerp 白 30%、
   *  scale0.7、noGravity。spawnDust 宿主缺省退回合成粒子（测试 mock 兼容）
   *  ★T3 清偿（2026-09-02,红队 H′）:基准位 = 碰撞后心 this.cx/cy——原版 Kill 自
   *  接触响应段调用（:18443 else→Kill）,此时 position 已被 TileCollision 夹到
   *  贴墙位,尘/音取 Kill 时 Center（:74185-74188）;旧 cx0/cy0 为帧首心（一步之前）,
   *  贴墙场景差半格~一格。AI 段索敌仍用帧首 cx0/cy0（AI 先于位移,原版同序）不动 */
  private killExplode(game: GameHooks): void {
    this.dead = true;
    game.playSfxFiles(['Item_54'], 1, this.cx, this.cy);
    if (game.spawnDust) {
      for (let i = 0; i < 20; i++) {
        const d = game.spawnDust(this.cx - 10, this.cy - 10, 20, 20, 212, 0, 0, 0, null, this.ai1);
        if (!d) break;
        const len = Math.hypot(d.x - this.cx, d.y - this.cy) || 1;
        const ux = (d.x - this.cx) / len, uy = (d.y - this.cy) / len;
        const spdLen = Math.hypot(d.vx, d.vy);
        d.x = this.cx + ux * 10 * this.ai1;
        d.y = this.cy + uy * 10 * this.ai1;   // ★此前误写 cx0（y 坐标用了 x 心）= 终清波 typo 回归钉死
        d.vx = ux * spdLen; d.vy = uy * spdLen;
        const hue = 0.4 + Math.random() * 0.2;
        const col = hslToRgbColor(hue, 0.9, 0.5);
        d.color = { r: Math.round(col.r + (255 - col.r) * 0.3),
          g: Math.round(col.g + (255 - col.g) * 0.3),
          b: Math.round(col.b + (255 - col.b) * 0.3), a: 255 };
        d.noGravity = true;
        d.scale = 0.7;
      }
    } else {
      game.spawnParticles(this.cx, this.cy, '#FF9A3C', 20, 2.5, { life: 30, grav: -0.05 });
    }
  }
}

// ================= 404 猪龙鱼链球本体（2611 Flairon,aiStyle 69 = AI_069 内联支） =================

/** 404 Flairon 掷出本体（2611 猪龙鱼链球右键互换的掷球形态,1457 Projectile.cs:30730-30829
 *  AI_069 内联于 AI() 分派器;1456 同段 :29314-29412）：
 *  · 出程（ai[0]==0）：AI 分支内【不修改 velocity】= 初速直线飞行（无重力无摩擦,
 *    速度缩放/出生点在发射侧 :47466-47471/:47648-47657）;dist>400 → ai[0]=1（:30754-30757）。
 *  · 回收（ai[0]==1/2）：tileCollide=false（:30770,穿墙回收）;速 20（1）/40（2,>600 升档
 *    :30766-30769）;dist>1500 → Kill、dist<速度 → Kill（回手消失,:30758-30782）。
 *  · 撞块（:19626 aiStyle3/13/69/109 共享支 → :19661/:19676-19684）：Collision.HitTiles
 *    + ai[0]=1 转【回收】+ SoundID 0（:19686）——【不反射】（反射门 aiStyle==3||109,69 不在）。
 *  · 命中敌（:14230-14233/:14778-14781）：ai[0]=1 命中即回收（同回旋镖族）。
 *  · ai[1] 淡入：>5 → alpha=0（SetDefaults alpha=255 :4856,:30783-30787）;ai[1]%4==0 →
 *    伴生泡泡 405（v=vector46×−1 归一×Next(45,65)×0.1,RotatedBy(±45° 扇形),ai0=-10,
 *    :30788-30795——实体走已 1:1 实装的 FlaironSpike,经 spawnProj 回调出射）。
 *  · SetDummyItemTime(10) 每 tick（:30739 → Player.cs:4417-4426）= 单实例门：球在场期间
 *    itemTime 恒 ≥10 → TryStartUse 钉死。★404【不在】Player.cs:52801-52858 同型在场门
 *    列表（可多只不被列表挡）,约束全靠本钉持——Game 侧经 pinUse 注入,勿另加在场扫描门。
 *  · player.dead → Kill（:30734-30738）;ChangeDir 由球反推（:30742-30751 球在玩家左侧 →
 *    玩家朝右）;spriteDirection = vector46.X>0 ? −1 : 1（:30753）;itemRotation（:30752）
 *    本仓无手臂合成旋转消费面,登记不接（noUseGraphic 件无持物贴图可转）。
 *  链条 = Main.cs:29501 分支（404/1058 同支 Chain37）→ drawChain37Link 共享件。 */
export class FlaironHeadProj extends Entity {
  /** 命中盒 26×26（SetDefaults :4849-4857;vanilla-projectiles.json 404 同值） */
  w = 26; h = 26;
  damage: number;
  knockback: number;
  projId = 404;
  /** GetWeaponCrit 合并值（Game 侧传入；缺省 4 基础） */
  critChance = 0.04;
  /** ⑥ 护甲穿透（Game 注入，命中传 hurt 减防） */
  armorPen = 0;
  /** 近战系（吃武器浸剂 meleeEnchant,StatusNPC :10559 门 (melee||whip)） */
  meleeProj = true;
  /** SetDummyItemTime(10) 钉持回调（Game 侧注入 = player.useTime=max(useTime,10)）——
   *  单实例门唯一承载（见类注）;死球即停钉,复用窗自然回落 10t（原版 itemAnimation 余量衰减） */
  pinUse: (t: number) => void = () => {};
  /** 伴生泡泡 405 出射回调（Game 侧注入 entities.add——GameHooks 不暴露实体桶）。
   *  入参 = 球心（NewProjectile 中心语义 :10878-10879）,盒左上换算由回调侧承担 */
  spawnProj: ((x: number, y: number, vx: number, vy: number, projId: number, dmg: number, kb: number) => void) | null = null;
  /** ai[0] 状态只读视图（0 出程/1 回收速 20/2 回收速 40）——测试对账用 */
  get aiState(): number { return this.st; }
  /** ai[1] 计数只读视图（淡入+泡泡节拍源,:30783）——测试对账用 */
  get aiTick(): number { return this.ai1; }
  /** alpha 只读视图（原版语义 255=隐形→0=全显）——测试对账用 */
  get alphaView(): number { return this.alpha; }
  private st = 0;
  private ai1 = 0;
  private alpha = 255;
  private rotation = 0;
  /** spriteDirection（:30753 vector46=玩家−球,vector46.X>0=球在玩家左侧→−1;
   *  右侧→+1。绘制侧 −1=FlipHorizontally（M.cs:30534-30537 dir 支）——★BJ367 勘误:
   *  旧注「球在玩家右侧=−1」系左右写反,代码本正确） */
  private spriteDir = 1;
  private hitCd = new HitCooldown();
  /** 手部坐标（链条起点，每 tick 自玩家中心刷新） */
  handX = 0;
  handY = 0;
  /** timeLeft 缺省 3600（SetDefaults :526,aiStyle69 族无型号覆写;正常局三段回收门先到期） */
  life = 3600;
  dead = false;
  // ---- ★通用湿段（Projectile.cs:16903-17113;2026-09-06 R3 漏网类批 11 类之一）----
  //  域 id = {404 Flairon 本体}（SetDefaults :4850 块无 ignoreWater 行,缺省 false :763
  //  → 受段;与 PROJ_IGNORE_WATER 零交集）。位序：AI_069（:30730-30829,只写 velocity/
  //  rotation/ai 不写 position）→ 湿段 → 位移,湿段测位 = 上拍位移后位 = 本拍位移前位 ✓。
  //  阻尼：出程 tileCollide 缺省 true（:4850 未关）→ 湿阻尼适用（位移入参）;回收态
  //  :30770 置 tileCollide=false → 阻尼块不跑,湿位移 = UpdatePosition :20555 wet →
  //  position += wetVelocity（AI 前快照,滞后一子步 quirk——回收积分支实现）。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价——出生盒同位测值） */
  presetDone = false;   // ProjWetFlags.presetDone（共享湿段旗持有者）

  constructor(x: number, y: number, vx: number, vy: number, damage: number, knockback: number) {
    super();
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.knockback = knockback;
    this.handX = x; this.handY = y;
  }

  draw(r: Renderer, cam: Camera): void {
    const ctx = r.ctx;
    if (ctx) drawChain37Link(ctx, r, this.x + this.w / 2, this.y + this.h / 2, this.handX, this.handY);
    // 球体贴图与 1058 全同（Projectile_404.png=Projectile_1058.png 均 30×32,盒 26×26,md5 同）。
    // ★BJ367 锚定修正：404 走原版【通用通支】锚（M.cs:35492——非 :32360/:30621 专支,
    //   404 不在两表;：30606/:34920/:35429 系 221/帧残影/浮标专支同样不辖）：
    //   position=(盒左+num153+num152, 盒上+盒高/2)、origin=(num153, 盒高/2+num151),
    //   num153=(texW−盒宽)/2+盒宽/2=15、num151=num152=0 → 贴图左上=盒左上、
    //   旋转枢=(盒左+15, 盒上+13)（原版球体中心本就比盒心低 3px/右 2px——曾按
    //   中心锚绘制=整球偏 (−2,−3)px+枢轴偏 2px,经实机像素对拍定谳）。链条起点
    //   =proj.Center（M.cs:29578 center2,盒心）不变——原版链即自盒心出。
    // α 原版语义（GetAlpha 缺省 :81523 color×(255−α)/255,越大越透明）
    drawProj(r, cam, this, this.projId, this.rotation, '#E04040',
      Math.max(0, (255 - this.alpha) / 255), 0, this.spriteDir === -1, false);
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    if (--this.life <= 0) { this.dead = true; return; }
    // :16870 wetVelocity 快照（AI 前——回收态湿位移消费,见下回收积分支）
    const preVx = this.vx, preVy = this.vy;
    this.hitCd.tick();
    const p = game.player;
    this.handX = p.cx;
    this.handY = p.cy;
    // ---- AI_069（:30730-30829,序与源码一致）----
    const vcx = p.cx - this.cx, vcy = p.cy - this.cy;    // vector46 = player.Center − Center(:30732)
    this.rotation = Math.atan2(vcy, vcx) - Math.PI / 2;  // :30733 球体贴图朝玩家
    if (p.dead) { this.dead = true; return; }            // :30734-30738 Kill（先于钉持）
    this.pinUse(10);                                     // SetDummyItemTime(10)（:30739）
    const dir = vcx < 0 ? 1 : -1;                        // :30742-30751 ChangeDir/direction
    if (p.facing !== dir) p.facing = dir;                // （ChangeDir 落 facing,同 FlailProj.changeDir 口）
    this.spriteDir = vcx > 0 ? -1 : 1;                   // :30753
    // 状态机（:30754-30782）
    const dist = Math.hypot(vcx, vcy);
    if (this.st === 0 && dist > 400) this.st = 1;        // :30754-30757 超 400px 转回收
    if (this.st === 1 || this.st === 2) {
      if (dist > 1500) { this.dead = true; return; }     // :30761-30765
      if (dist > 600) this.st = 2;                       // :30766-30769 加速档
      const spd = this.st === 2 ? 40 : 20;               // :30771-30775
      const dl = dist || 1;
      this.vx = vcx / dl * spd;                          // :30776 velocity = normalize(vector46)×spd
      this.vy = vcy / dl * spd;
      if (dist < spd) { this.dead = true; return; }      // :30777-30781 回手消失（Kill）
    }
    this.ai1++;                                          // :30783
    if (this.ai1 > 5) this.alpha = 0;                    // :30784-30787 淡入完成
    // 伴生泡泡（:30788-30795）：ai[1]%4==0（首枚第 4 拍,含回收段）;owner==myPlayer 门在
    // 本地实体恒真（MP 傀儡走 netPuppet 早退不达此处）
    if (this.spawnProj && this.ai1 % 4 === 0) {
      let bx = -vcx, by = -vcy;                          // v4 = vector46×−1（背向玩家外抛）
      const bl = Math.hypot(bx, by);
      if (bl > 0) { bx /= bl; by /= bl; }                // SafeNormalize(Zero) 零向量兜底（:30791）
      const bs = (45 + Math.random() * 20) * 0.1;        // Next(45,65)×0.1（:30792,速 4.5-6.4）
      bx *= bs; by *= bs;
      const ra = (Math.random() - 0.5) * (Math.PI / 2);  // RotatedBy(±45° 扇形)（:30793,1.5707963…）
      const cs = Math.cos(ra), sn = Math.sin(ra);
      flaironSpikePenPending = this.armorPen;            // ④ 泡泡继承父弹穿甲（NewProjectile
      //   EntitySource_Parent → ApplyStatsFromSource :11141 的引擎承载,回调侧 ctor 消费）
      this.spawnProj(this.cx, this.cy, bx * cs - by * sn, bx * sn + by * cs, 405,
        this.damage, this.knockback);
    }
    // ---- 通用湿段（:16903-17113,projWetSection 共享体——AI 后/位移前,原版位序;
    //      域注见字段块）----
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater);
    // ---- 位移（:19626 aiStyle3/13/69/109 共享支——出程 tileCollide=true;
    //      回收段 :30770 置 false 穿墙;序同原版 AI 先行/位移后行）----
    if (this.st === 0) {
      const lvx = this.vx, lvy = this.vy;
      const body = {
        x: this.x, y: this.y, w: this.w, h: this.h, vx: this.vx, vy: this.vy,
        onGround: false, hitWall: false, hitHead: false, collideY: false,
        hoik: true,   // ★FX34c 弹幕域 hoik=true（Body.hoik 注:原版 Projectile 全路径）
        tileCollide: true, dropThrough: true,
      };
      // ★水中位移阻尼（HandleMovement :17721-17764,出程 tileCollide=true 适用）
      const drag404 = projWaterDragFactor(this);
      moveAndCollide(body, game.world, lvx * drag404, lvy * drag404);
      this.x = body.x; this.y = body.y;
      // velocity = 碰撞解析后向量（HandleMovement :17705 `velocity = Collision.
      // TileCollision(…)` 受阻轴清零——非反弹式翻转;翻转只属 :19679 aiStyle3/109,69 不在）
      this.vx = body.hitWall ? 0 : body.vx;
      this.vy = (body.collideY || body.onGround || body.hitHead) ? 0 : body.vy;
      if (body.hitWall || body.collideY || body.onGround || body.hitHead) {
        // :19661-19686 else 支：Collision.HitTiles + :19676-19684 ai[0]=1【不反射】
        // （反射门 aiStyle==3||109,69 不在——曾按回旋镖式反弹即错）+ :19686 SoundID 0。
        // ⑥ 尘面精确化（2026-09-03）：:19663 HitTiles(position,velocity,width,height) =
        // 逐格 KillTile(fail:true,effectOnly:true) 块色尘（Collision.cs:3076-3113 外扩窗/
        // vector=position+velocity;尘量=GetTileDustAmount(fail:true) 分型档）——旧固定 3 粒
        // #A09080 弹心近似退役,真值单口 = Game.hitTilesFx（Collision.cs 1:1 几何,箭族 OPD
        // 同件;实参向量已受阻清零=原版 TileCollision :17705 先行同口径）。缺省宿主退旧合成
        // 档（测试 mock 兼容）。★Kill 面定谳：type==404 全文仅 :4849 SetDefaults,Kill
        // （:71752-78995）无 404 支 → 寿命尽/超 1500/回手消亡原版无尘无音,本仓各
        // this.dead=true 出口静默即 1:1（近旁 :76031 type==237 是腐蚀球唤 238,非本族）
        const host = game as unknown as {
          hitTilesFx?: (x: number, y: number, w: number, h: number, vx: number, vy: number) => void;
        };
        if (host.hitTilesFx) host.hitTilesFx(this.x, this.y, this.w, this.h, this.vx, this.vy);
        else game.spawnParticles(this.cx, this.cy, '#A09080', 3, 1.5, { life: 14, size: 2 });
        game.playSfx('dig', 1, this.cx, this.cy);   // :19686 SoundID 0 一响（原版无尘照播,无条件）
        this.st = 1;
      }
    } else if (this.wet) {
      // 回收态湿位移（UpdatePosition :20555-20562）：tileCollide=false（:30770）→
      // 湿阻尼块不跑,wet → position += wetVelocity（AI 前快照 preVx/preVy,无阻尼——
      // 滞后一子步 quirk 本体,Boomerang/Yoyo 返程同款）
      this.x += preVx; this.y += preVy;
    } else {
      this.x += this.vx; this.y += this.vy;              // tileCollide=false 段（Update 积分序）
    }
    // ---- 割面（★BJ339-T4 补：CutTiles :12516-12517 门 friendly && owner==myPlayer
    //      && !npcProj && !minion && type!=1054 → 404 friendly 全过;CanCutTiles :15407
    //      两表均无 404;Damage_CanDealDamage :12461 排除表无 404）——盒=Damage_GetHitbox
    //      弹盒,位序=位移后/伤害前（CutTiles :12517 先于 Damage_PVE :12523,同 405 BJ285 口径）----
    cutTilesBox(game, this.x, this.y, this.w, this.h);
    // ---- 命中结算（:14230-14233/:14778-14781 aiStyle69 支：命中即转回收,同回旋镖族）----
    // ★BJ339-T2：命中门走【玩家级共享免疫档】——原版 :12636 flag3=false（maxPenetrate
    //  =-1 ≠1）→ 门 = npc.immune[owner]==0（受所有共享窗弹命中写下的 10t 挡,含悠悠球/
    //  链锤掷弹/404 自身）;命中后 :14176-14182 `penetrate != 1` 分支写 immune[owner]=10
    //  （本仓承载 = hurt pierce 位 0 → Enemy.hurt 置 iframes 10t,等价）。旧逐弹私账
    //  不读共享窗 = 悠悠球刚打中的敌 404 立即再中（原版相:被共享窗挡 10t）
    //  ★BJ339-T5：dirOverride = direction 球侧（:13652 num40=direction 缺省,69 族不在
    //  :13654-13678 玩家相对敌位覆写表;:30742-30751 direction 每拍按球侧重写——回收途中
    //  命中击退仍朝玩家面朝向,不随敌相对弹位翻转）
    // 击退方向 = direction（:30742-30751 球在玩家哪侧;★BJ344 勘正:旧注「1058 同式
    //  先例 FlailProj kdir」失效——1058 伤害向=aiStyle15 覆写表玩家相对敌位
    //  :13667-13678,非 AI 字段式）
    hitEnemies(this, game, this.hitCd, 10, p.cx < this.cx ? 1 : -1, this.armorPen,
      () => { this.st = 1; }, undefined, true, undefined, 0, p.cx < this.cx ? 1 : -1);
  }
}

// ================= 手雷/炸弹/炸药（aiStyle 16，AI_016 引信爆炸） =================

/** AI_016 全族分类表（Projectile.cs 权威行号） */
/** 粘性族（SetDefaults tileCollide=false + AI_016 :44325 贴附扫描）。
 *  911 黏性土制炸弹同族（:8371-8379 tileCollide=false + :44325 列表）。
 *  ★1458 锚同值（:47821 扫描列表）：{37,397,470,519,773,911,1087}——773 甲虫炸弹
 *  B2 波接入（tileCollide=false 出膛自管物理 + 重叠贴附,扫描盒/内缩语义与族共享）。
 *  ★SW-E1 2026-09-03：1087 Sticky Power Bomb 接入（P.cs:10142-10144 SetDefaults
 *  tileCollide=false + :47821 扫描列表成员）——与 1086（tileCollide 缺省 true=普通
 *  反弹弹）的 ai 差异即粘性语义。导出供回归测试断言族成员。
 *  ★SW-H1 2026-09-03：519 炸弹鱼补入（P.cs:5891-5897 SetDefaults 24×24/aiStyle16/
 *  tileCollide=false + :47821 扫描列表成员;玩家侧经 item 3196 → grenade 分派走
 *  GrenadeProj 投掷路——旧注"519 走专属实体不入此路"与实况不符,退役）。 */
export const STICKY_PROJ = new Set([37, 397, 470, 519, 911, 773, 1087]);

/** SW-H1 2026-09-03：引信烟尘纯函数（AI_016 :48048-48055 1:1——仅 1086/1087,每 tick
 *  恰 1 粒无节拍门,调用点见 GrenadeProj.fuseSmoke307）。vector3 = Center +
 *  (0,−h/2).RotatedBy(rotation)×1.1（引信尖,随滚转自转）;vector4 =
 *  normalize(vector3−Center)×5。返回尘位弹心偏移 dx/dy 与尘速增量 dvx/dvy
 *  （尘终速 = 弹速 + 增量,原版整体覆写）。非 1086/1087 返 null。 */
export function fuseSmoke307Of(projId: number, rot: number, halfH: number):
  { dx: number; dy: number; dvx: number; dvy: number } | null {
  if (projId !== 1086 && projId !== 1087) return null;
  const dx = Math.sin(rot) * halfH * 1.1;      // (0,−halfH) 旋 rot 后 x 分量
  const dy = -Math.cos(rot) * halfH * 1.1;     // y 分量
  const len = Math.hypot(dx, dy) || 1;
  return { dx, dy, dvx: (dx / len) * 5, dvy: (dy / len) * 5 };
}

/** SW-I1 2026-09-03：AI_016 重力门（P.cs:48332 ai[0]++ → :48377 门）：ai[0] 未越
 *  门值前零重力（出手直飞 gate 拍,第 gate+1 拍起 vy+0.2）。分型依据=原文双析取支
 *  显式 id 名单（非 tag 表）：
 *  · 手雷族（第一析取支,ai[0]>10）：30 Grenade / 397 StickyGrenade / 517
 *    BouncyGrenade / 588 PartyGirlGrenade / 779·783 ClusterFragments /
 *    862·863 ClusterSnowmanFragments / 1088 AcornSlingshotAcorn；
 *  · 其余全 AI_016（炸弹 28/37/516/519、炸药棍 29/470/637、甲虫 773、液体泥土
 *    903-906/910/911、超级 1086/1087、102/75/108…）落第二析取支 ai[0]>5；
 *  · ★原文本相：681 DD2GoblinBomb 列于第一析取支名单,但第二析取支排除表
 *    （type!=30&&…&&type!=1088,P.cs:48377）漏列 681 → OR 语义下 681 实际
 *    ai[0]>5 即开门（按反编译逐字保留,勿"修"）。
 *  655 蜂巢=AI_025 非 AI_016,无此门（恒重力）→ 返 null。 */
const BOMB_GATE10 = new Set([30, 397, 517, 588, 779, 783, 862, 863, 1088]);
export function bombGravityGateOf(projId: number): number | null {
  if (projId === 655) return null;
  return BOMB_GATE10.has(projId) ? 10 : 5;
}

/** SW-AD1 2026-09-04：655 蜂巢墙推支纯函数（Projectile.cs:26595-26678 逐式）。
 *  调用侧门（:26595 `ai[0] != 0f && velocity.Y <= 0f && !flag9 && velocity.X == 0f`）
 *  本函数不重复判定——flag9 仅 1047（:26471）/1055（:26527）置位,655 恒 false。
 *  方向判定三档扫墙（num213=0.5f）：
 *  · 每档取左右缘外 8px±档距的 tile 列（(int) 除法=C# 朝零截断 → Math.trunc,
 *    近 x=0 负商 floor/trunc 分叉）;查 (y/16, y/16+1) 两行 WorldGen.SolidTile;
 *  · 左墙在 → vx=+0.5 推离（flag11）,右墙在 → vx=−0.5（flag12）,档内左优先;
 *  · 0/16/32px 三档全空 → Center 格 X 偶数推右、奇数推左（:26669-26674）。
 *  SolidTile 摄取（W.cs:70642-70655）= active() && !inActive() && tileSolid &&
 *  !tileSolidTop && !halfBrick && slope==0 —— active/!inActive ≡ st.isActive
 *  （nactive）,tileSolidTop 以 d.platform 代理（tileSolid∩tileSolidTop 九件套
 *  即平台行为族,同 Game.ts:17423 solidFull/LineOfSight fullSolid 惯用法）。
 *  ★OOB 语义（SW-AL1 2026-09-05 定谳,纠正 SW-AD1 旧备案"OOB=null→true"）：
 *  vanilla Main.tile 是裸 Tile[,]（Main.cs:1690）——OOB 下标抛 IndexOutOfRange,
 *  被 SolidTile try/catch 吞掉【返 false】（W.cs:70642-70655 catch 尾）;null→true
 *  分支仅【界内】null 格可达（单人 clearWorld W.cs:7088-7121 全量 new Tile(),
 *  仅 MP 客户端未流送段持 null）。本仓 OOB=false（store"世界外视为空"）≡ 原版
 *  OOB 异常路径,非差项。世界缘实体面：玩家位置钳制（Player.cs:24243-24314）、
 *  弹幕触界 active=false 消散（P.cs:16789-16802;655 已接=GrenadeProj 出界杀）。 */
export function beeWallPushDir(
  st: Pick<TileStore, 'inBounds' | 'isActive' | 'get' | 'idx' | 'half' | 'slope'>,
  x: number, y: number, w: number, cx: number,
): 0.5 | -0.5 {
  const solidTile = (tx: number, ty: number): boolean => {
    if (!st.inBounds(tx, ty) || !st.isActive(tx, ty)) return false;
    const d = TILE_DEFS[st.get(tx, ty)];
    const i = st.idx(tx, ty);
    return !!d && d.solid && !d.platform && !st.half[i] && st.slope[i] === 0;
  };
  const cint = (v: number): number => Math.trunc(v);   // C# (int) cast
  const row = cint(y / 16);
  for (const off of [0, 16, 32]) {                     // 三档：8px 外缘、+16、+32
    const li = cint((x - 8 - off) / 16);
    const ri = cint((x + w + 8 + off) / 16);
    const fl = solidTile(li, row) || solidTile(li, row + 1);
    const fr = solidTile(ri, row) || solidTile(ri, row + 1);
    if (fl) return 0.5;
    if (fr) return -0.5;
  }
  return cint(cx / 16) % 2 === 0 ? 0.5 : -0.5;         // 三档全空：Center 格奇偶定向
}

/** SW-I1 2026-09-03：AI_016 每 tick `damage=0` 豁免表（P.cs:48030-48047 逐字，
 *  1456 同支 ：44255 系）。表内型保留发射伤 → Damage_PVE（`if (damage <= 0)
 *  return` P.cs:12576）飞行接触可结算（伤=物品伤 + aiStyle16 钳 timeLeft=3
 *  :13153）。表外型（炸弹/炸药棍/粘性/弹跳炸弹/炸弹鱼/甲虫/液体泥土/超级族）
 *  每拍伤被清 0 → Damage_PVE 整段早退：【无接触结算、无引信钳、不杀小动物】,
 *  伤害只在 Kill→PrepareBombToBlow（P.cs:71785,aiStyle16 Kill 支）置值后走
 *  爆炸圈——飞行接触零伤是原版本相,勿把爆炸伤当接触伤双重结算。
 *  发射支（fired）成员 133-144/303/338-341/776-810/930/1088 全在豁免表内,
 *  发射支接触结算维持本相。 */
export const BOMB_DAMAGE_KEEP_16 = new Set([
  30, 397, 517, 588, 681, 75, 108, 1002, 1088, 164, 303, 930, 862, 863,
  133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144,
  338, 339, 340, 341,
  776, 777, 778, 779, 780, 781, 782, 783, 784, 785, 786, 787, 788, 789, 790,
  791, 792, 793, 794, 795, 796, 797, 798, 799, 800, 801,
  803, 804, 805, 806, 807, 808, 809, 810,
]);

/** SW-I1 2026-09-03：投掷族通用引信烟尘主尘型号（P.cs:48285-48322 通支 num30——
 *  缺省 6；773→59 / 903→Dust.dustWater() / 904→35 / 905→152 / 1077→135 /
 *  910·911→0）。返 null = 不出此尘：排除表 {30,517,681,397,519,588,779,783,
 *  862,863}（:48285 逐字）+ 前序专支（1086/1087 尘 307 :48048-48055、1088 帧
 *  支 :48057、发射族 133-144/303/338-341/776-810/930 各专支）+ 655（AI_025）。
 *  waterStyle = dustWater() 档（GrenadeProj.waterStyleDust 同源）。 */
export function bombFuseSmokeTypeOf(projId: number, waterStyle: number): number | null {
  if (projId === 30 || projId === 397 || projId === 517 || projId === 519 || projId === 588
    || projId === 681 || projId === 779 || projId === 783 || projId === 862 || projId === 863) return null;
  if (projId === 1086 || projId === 1087 || projId === 1088 || projId === 655) return null;
  if ((projId >= 133 && projId <= 144) || projId === 303 || (projId >= 338 && projId <= 341)
    || (projId >= 776 && projId <= 801) || (projId >= 803 && projId <= 810) || projId === 930) return null;
  switch (projId) {
    case 773: return 59;
    case 903: return waterStyle;
    case 904: return 35;
    case 905: return 152;
    case 1077: return 135;
    case 910: case 911: return 0;
    default: return 6;
  }
}

/** SW-I1 2026-09-03：519 炸弹鱼帧动画纯函数（P.cs:47951-47970 逐字——引信末端
 *  加速视觉）。fuseAge=localAI[1]（每 tick +1）；num12=180−fuseAge 钳 0（引信
 *  余量视觉轴）；counter 每 tick +1、num12<15 再 +1（末 15t 双速）；
 *  counter ≥ (num12/10+6)/2 → frame++ 回绕 4（Main.cs:8619 projFrames[519]=4）。
 *  不可变返回,便于回归对拍。 */
export function bombFishFrameTick(st: { fuseAge: number; counter: number; frame: number }):
  { fuseAge: number; counter: number; frame: number } {
  const fuseAge = st.fuseAge + 1;
  const num12 = Math.max(0, 180 - fuseAge);
  let counter = st.counter + 1;
  if (num12 < 15) counter += 1;
  let frame = st.frame;
  if (counter >= (num12 / 10 + 6) / 2) {
    frame++;
    counter = 0;
    if (frame >= 4) frame = 0;              // Main.projFrames[519]=4
  }
  return { fuseAge, counter, frame };
}
/** SW-I1 2026-09-03：519 炸弹鱼帧数（Main.cs:8619 `projFrames[519] = 4`——贴图
 *  38×152 竖条 4 帧,帧 38×38 与 24×24 碰撞盒解耦） */
const BOMB_FISH_FRAMES = 4;
/** SW-L1 2026-09-03 F2：773 甲虫炸弹帧数（Main.cs:8777 `projFrames[773] = 4`——
 *  贴图 22×168 竖条 4 帧 42px,与 22×22 碰撞盒解耦） */
const BEETLE_BOMB_FRAMES = 4;
/** SW-P1 2026-09-03：1088 橡实种弹帧初始化纯函数（P.cs:48058-48063 逐字——首 AI 拍
 *  frameCounter==0 → frameCounter=1、frame=Main.rand.Next(2);此后 counter 恒 ≥1 =
 *  【一次性随机选帧、无逐帧推进】）。roll = Main.rand.Next(2) 注入值（0/1）。
 *  projFrames[1088]=2（Main.cs:8594;贴图 Projectile_1088.png 18×42 竖条 2 帧 21px,
 *  与 20×20 碰撞盒解耦——盘上实测）。counter≠0 返 frame=-1 = 不覆写现帧。
 *  ★Kill 路径（acornSeedDeath,J 批）与飞行绘制路径分开:本函数只服务绘制帧态。 */
export function acornSeedFrameInit(counter: number, roll: number): { counter: number; frame: number } {
  if (counter !== 0) return { counter, frame: -1 };
  return { counter: 1, frame: roll === 1 ? 1 : 0 };
}
/** SW-P1 2026-09-03：1088 帧数（Main.cs:8594 `projFrames[1088] = 2`） */
const ACORN_SEED_FRAMES = 2;

/** 液体炸弹族（903 水/904 岩浆/905 蜂蜜/906 干燥）——构造器命中盒 22×22 分档用
 *  （湿段引信门见 WET_FUSE_PROJ,R3 收编后此表不再承载行为） */
const LIQUID_BOMB_PROJ = new Set([903, 904, 905, 906]);
/** ★液体炸弹/火箭入液引信族（AI_016 头 :47771 逐字成员表——wet 旗 → timeLeft=1;
 *  R3 收编：原 LIQUID_ROCKET_PROJ/LIQUID_BOMB_PROJ 两内联扫盒（直测当前液态）退役,
 *  改读【上子步湿段】维护旗,成员按原文全列补齐——湿 784-786/805、熔岩 787-789/806、
 *  蜂蜜 790-792/807、干 799-801/810、液体炸弹 903-906;1077 走过渡臂
 *  （:47771 `(type == 1077 && localAI[0] == 1f)` + :47775 维护式,见 rocketDryLatch）。
 *  原文门在 `if (owner == Main.myPlayer)` 内——单机恒真,省略） */
const WET_FUSE_PROJ = new Set([784, 785, 786, 805, 787, 788, 789, 806,
  790, 791, 792, 807, 799, 800, 801, 810, 903, 904, 905, 906]);
/** 炸药棍族（Kill :74943 视觉/PrepareBombToBlow 250×250/半径 7/反弹 ×0.8/摩擦追加 ×0.99） */
const DYN_PROJ = new Set([29, 470, 637]);
/** 炸弹族（Kill :74881 视觉/PrepareBombToBlow 128×128 dmg100/半径 4） */
const BOMB_PROJ = new Set([28, 37, 516]);
/** 手雷族（不破坏地形；PrepareBombToBlow 128×128 用物品伤害） */
const NADE_PROJ = new Set([30, 397, 517]);
/** IsABombWithFuse（ProjectileID.cs:277（1458 同值）——引信嘶声循环族；手雷族不在内！）。
 *  原版全集含 519/75/102/681/773/1077/1086/1087——除 773/1086/1087 外在本仓走各自
 *  专属实体（681 DD2GoblinBomb=bossAI_dd2 等），不经过 GrenadeProj,故表内只收
 *  本实体承接的成员 + 湿/干/土制弹族 903-906/910/911（§7 销核批落地，
 *  2026-08-13 主会话补入嘶声资格）+ 773 甲虫炸弹（B2 波 2026-08-30）
 *  + 1086/1087 超级炸弹（SW-E1 2026-09-03 接线）。 */
const FUSE_SOUND_PROJ = new Set([28, 37, 516, 29, 470, 637, 903, 904, 905, 906, 910, 911, 773, 1086, 1087]);

/** ★⑧Shimmer 头门 hostile 位（P.cs:22566 `hostile && aiStyle != 25 && aiStyle != 17`）
 *  ——本类域内原版 SetDefaults `hostile = true` id（1457 Projectile.cs 逐块核对）：
 *  75 快乐炸弹(:1557)/303 骷髅爆破火箭(:3951)/681 哥布林炸弹(:7272)/655 蜂巢(:7046
 *  friendly+hostile 双标)。本类无 hostile 字段（域=玩家投掷/发射族,75 系摇树
 *  tenthAnniversaryWorld 特例 WorldGen.cs:63677）,面按原版数据位携带——75/303/681
 *  （aiStyle 16）被头门拦下=原版无微光行为;655 aiStyle 25 头门豁免照走召唤浮升支。
 *  303/681 现役不经本类（303=Enemy Dart 通道/681=bossAI_dd2）,死码成员照抄防缺面。 */
const GRENADE_SHIMMER_HOSTILE = new Set([75, 303, 681, 655]);

/** ★BJ252 弹力族表（HandleMovement :18591 型别支成员全 4 型——(515..517)||637,
 *  先于 aiStyle 14（:19741）/16（:19862）通用反弹截走 ×−0.9）：活载体 =
 *  3112 弹力荧光棒→515（GlowstickProj）/3115 弹力炸弹→516、3116 弹力炸药→
 *  517、3547 弹力粘珠→637（GrenadeProj;itemcombat shoot 列已核）。vanilla
 *  恒 tileCollide 缺省 true、penetrate=-1、无引信杀口 → 弹反面无计数无消亡。 */
export const BOUNCY_PROJS: ReadonlySet<number> = new Set([515, 516, 517, 637]);

export class GrenadeProj extends Entity {
  // 碰撞盒 1:1（Projectile.SetDefaults :846-869/:938/:4508/:5173/:5584/:5592/:6571）：
  // 28/37/516=22×22 / 29/470/637=10×10 / 30/397/517=14×14——此前统一 14×14
  w = 14; h = 14;
  vx: number;
  vy: number;
  damage: number;
  projId: number;
  /** 接触伤害穿甲+暴击率（发射侧注入——Damage_PVE 接触结算与爆炸同源；
   *  曾接触只钳引信不结算伤害=火箭穿体 3t 后才在身后爆,目标零伤
   *  (2026-08-23 用户报"火箭打不了假人/蝙蝠身边爆了没伤害") */
  contactPen = 0;
  contactKb = 0;
  /** ★BJ489 def-3：值不作掷率消费（掷率=接触环 rollVanillaHitCrit 动态掷——
   *  30/397/517/588/681 手雷族 ranged 旗;28/29/37 等炸弹族 SetDefaults 无类旗
   *  :1108-1131=原版零掷）,本字段仅作 >0 路由门+关断钉载体（测试置 0 习语） */
  critChance = 0.04;
  /** 引信 timeLeft 1:1（SetDefaults :10348-10408）：炸弹/手雷族 180、炸药棍族
   *  {29,470,637}=300——此前误写 150/135/180 */
  fuse: number;
  onExplode!: (x: number, y: number, damage: number, oldVx?: number, oldVy?: number) => void;
  /** 1088 橡实种弹撞块种树检查（AI_016 撞块响应段 :18342-18346：CanAcornPlant →
   *  Kill——Kill 内再判一次决定种植/掉落）。Game 侧注入（placeAcornSapling 域）；
   *  返回 true = 本弹立即按 Kill 消亡走 onExplode（种植路径），false = 正常反弹 */
  bouncePlantCheck?: (cx: number, cy: number) => boolean;
  private rot = 0;
  /** SW-I1 2026-09-03：投掷支 ai[0]（P.cs:48332 每 tick +1）——重力门节拍轴
   *  （bombGravityStep；原支开门拍把 ai[0] 钳 10 :48379,投掷支内无后续消费者,
   *  本仓不钳仅注） */
  private ai0 = 0;
  /** SW-I1：519 炸弹鱼帧态（localAI[1]/frameCounter/frame 对应,P.cs:47951-47970;
   *  bombFishFrameTick 纯函数驱动,渲染侧 drawProj 帧参消费） */
  private bombFishAge = 0;
  private bombFishCounter = 0;
  bombFishFrame = 0;
  /** SW-L1 2026-09-03 F2：773 甲虫炸弹帧态（frameCounter/frame 对应;贴附拍
   *  ++frameCounter≥3 → frame++ 回绕 4,P.cs:47944-47949——与 519 的
   *  bombFishFrameTick 双规则并存,帧数 Main.cs:8777 projFrames[773]=4,贴图
   *  22×168 竖条 4 帧 42px。渲染侧 drawProj 帧参消费） */
  frame773 = 0;
  private frame773Counter = 0;
  /** SW-P1 2026-09-03：1088 橡实种弹帧态（frameCounter/frame 对应,P.cs:48058-48063
   *  首拍一次性 Main.rand.Next(2) 选帧,无逐帧推进;acornSeedFrameInit 纯函数驱动,
   *  帧数 Main.cs:8594 projFrames[1088]=2。渲染侧 drawProj 帧参消费——曾整条
   *  18×42 直绘 = 2 帧叠画成 42px 长条（同 519 旧 bug 形态）） */
  frame1088 = 0;
  private frame1088Counter = 0;
  dead = false;
  /** 引信嘶声循环句柄（AI_016 :44276-44281 PlayTrackedLoopedSound；Kill :67373 Stop） */
  private fuseSnd: { stop(): void; setPos(px: number, py: number): void } | null | undefined;
  /** 911 首贴标记（原版 localAI[0]，:44364/:44372） */
  private stuckOnce = false;
  /** 655 摇树蜂巢（AI_025 :19379-19391 落地反弹/撞墙裂——旧注 :17856 系 Update
   *  位移段误标,SW-W1 已勘误）：落地 vy>5 反弹×0.2（且只弹不杀）;水平撞墙/入水
   *  即 Kill → wet 落蜂巢块 1124×Next(2,6)（:76626-76628）/干裂 2+Next(3)³ 蜂
   *  （Kill :76611-76660——旧注 :72110-72155 系他支误锚）。裂蜂回调由 Game 注入
   *  （出怪上限门 GetAvailableAmountOfNPCsToSpawnUpToSlot 在 Game 侧） */
  onBeehiveKill?: (wet: boolean, px: number, py: number, vx: number, vy: number) => void;
  // （SW-X1 2026-09-04 的 wet655 私有快照字段已退役——R2 P2-4：原版 :26752/:76626
  //  读的都是湿段维护旗 this.wet 一个字段,本仓共享湿段旗同名承载,不再双轨）

  // ---- ★通用湿段（Projectile.cs:16903-17113 全体弹共用段;2026-09-04 火箭水花缺
  //  口批;2026-09-06 R3 拍序口径重排）----
  //  原版本段对【所有】非 ignoreWater 弹逐 update 维护：四液旗置位/三清
  //  （:16906-16918/:17103-17108）、入水/出水溅花（:16935-17102,wetCount==0 门）、
  //  wetCount 出水冷却窗（:16984 置 10/:17109-17112 逐 update −1）。本域 id 集
  //  （AI_016 炸弹/手雷/炸药棍/粘性族/发射族 133-144/303/338-341/776-810/930/
  //  903-911/1086-1088 + AI_025 蜂巢 655）SetDefaults 均无 ignoreWater 行 → 全员
  //  受段;四特支（34 火鞭/80 冰块/155 沙滩球/2 燃烧箭变型）与 IsDestroyedByWater
  //  六型 {85,15,188,34,1097,1106}（:16921-16931）域内均无成员 → 不移植（Arrow.ts
  //  侧已移植）。溅花面 = wetSplashStepShared（Arrow.ts 共享体,逐值注在彼处）。
  //  ★R3 拍序口径（2026-09-06）：原版位序 = AI(:16880) → 湿段(:16903) →
  //  HandleMovement(:17120)。曾挂 fixedUpdate 头（AI 前）——AI 湿旗消费者（入液
  //  引信门 :47771 wet → timeLeft=1 族,原版读【上子步】旗）变同拍读 = 入液爆早 1 拍。
  //  现挪至各路位移位前（活拍 wetSectionStep）+ AI 内 Kill 早退位补跑（杀拍
  //  wetSectionKillStep,wetSectionRan 防同拍双跑——Arrow.ts 杀拍配方同款）。旧行为
  //  上的内联 wetScan 双轨（LIQUID_ROCKET_PROJ/LIQUID_BOMB_PROJ 直测当前液态）同步
  //  收编为字段读（:47771 原文语义,成员表照抄原文全列）。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10893 等价——★2026-09-08 起首拍在
   *  fixedUpdate 头「AI 前例外位」跑（①′,首拍 AI 湿旗消费者读预置值,见彼注）,
   *  兼首拍湿段闩;presetDone 语义与共享体 ProjWetFlags 同名） */
  presetDone = false;   // ProjWetFlags.presetDone（共享湿段旗持有者）
  /** ★同拍防双跑闩（wetSectionStep 头自检+置位;①′ 预置拍/杀拍补跑/各路位移位前
   *  调用位共用——Arrow.ts 配方） */
  private wetSectionRan = false;
  /** 1077 入液过渡闩（localAI[0] 镜像：!wet→1/wet→0,:47775-47778——入液【首拍】才
   *  引爆的过渡门;本仓 1077 现无出生路径,死码照抄防缺面） */
  private rocketDryLatch = 0;

  // ---- 发射器弹药族（AI_016 else 发射支 :44542-44911，2026-08-14 对账新增）----
  /** fired = 发射族（无 PrepareBombToBlow 投掷臂路径；无重力直线/加速/追踪） */
  fired = false;
  /** 撞块语义表（:18365-18370）：火箭族撞块 vel=0 + 隐形 + timeLeft=3（贴墙 3t 后爆） */
  private static readonly FIRED_STICK = new Set([134, 137, 140, 143, 303,
    338, 339, 340, 341, 776, 780, 784, 787, 790, 793, 796, 799,
    803, 804, 805, 806, 807, 808, 809, 810, 930]);
  /** 火箭族（:48181-48240）：|vx|<15&&|vy|<15 → v×1.1 飞行加速；|vx|≥8 或 |vy|≥8
   *  每 update 2×尘 num13 + 2×尘 31 烟尾 */
  private static readonly FIRED_ROCKET = new Set([134, 137, 140, 143, 303,
    776, 780, 784, 787, 790, 793, 796, 799]);
  /** Dust.dustWater() 水样分档（1458 Dust.cs:405-418,台账 C 批清偿——旧恒 33）：
   *  Main.waterStyle {2→98,3→99,4→100,5→101,6→102,7→103,8→104,9→105,10→123,12→288,
   *  其余→33}。waterStyle 读 renderer.waterStyle（GameHooks 无此面,探测缺省=33 缺省水） */
  static waterStyleDust(game: GameHooks): number {
    const ws = (game as unknown as { renderer?: { waterStyle?: number } }).renderer?.waterStyle ?? 0;
    switch (ws) {
      case 2: return 98;
      case 3: return 99;
      case 4: return 100;
      case 5: return 101;
      case 6: return 102;
      case 7: return 103;
      case 8: return 104;
      case 9: return 105;
      case 10: return 123;
      case 12: return 288;
      default: return 33;
    }
  }
  /** 烟尾尘型号表（1458 :47974-47990 num13;1456 同段 :44255 起）：普通火箭 6 烟雾 /
   *  776·780 228 / 784·805 1/3 水(=dustWater() 分档) / 787·806 1/3 尘 35 /
   *  790·807 1/3 尘 152 */
  private static rocketTrailDust(game: GameHooks, projId: number): number {
    if (projId === 776 || projId === 780) return 228;
    if (projId === 784 || projId === 805) return Math.random() < 1 / 3 ? 6 : GrenadeProj.waterStyleDust(game);
    if (projId === 787 || projId === 806) return Math.random() < 1 / 3 ? 6 : 35;
    if (projId === 790 || projId === 807) return Math.random() < 1 / 3 ? 6 : 152;
    return 6;
  }
  /** 雪人/集束追踪（:44570-44684）：ai0>30 搜敌 600(930:650)+视线 → lerp 1/12 → dir×16(930:12) */
  private static readonly FIRED_HOME = new Set([338, 339, 340, 341,
    803, 804, 805, 806, 807, 808, 809, 810, 930]);
  /** 发射榴弹尾尘（:44743-44749） */
  private static readonly FIRED_GRENADE = new Set([133, 136, 139, 142,
    777, 781, 785, 788, 791, 794, 797, 800]);
  /** 感应雷（:44750-44768）：|v|<0.2 → alpha+2 钳 200 布防半隐 */
  private static readonly FIRED_MINE = new Set([135, 138, 141, 144,
    778, 782, 786, 789, 792, 795, 798, 801]);
  /** 延迟重力弧（:44881-44901）：ai[0]>10 后 vy+0.2/update（vy==0&&vx≠0 时另
   *  vx×0.97 摩擦）——1088 橡实种弹（5629 橡实弹弓）与其同支 9 型（30/397/517/
   *  681/588/779/783/862/863——发射源现状（SW-P1/Q1 2026-09-03 接线后）：588=3548
   *  抛掷（走投掷支非 FIRED）；779/783/862/863=集束裂片走 ClusterFragmentProj 专属
   *  实体；681=DD2GoblinBomb 走 bossAI_dd2——四者均不经本 FIRED 支（集内成员对本集
   *  惰性,但发射源已在仓,非"无源"）；ai[0] 在原支内被
   *  钳回 10（:44885）→ 此后每拍恒触发。SW-I1 2026-09-03：门值逐型走
   *  bombGravityGateOf（手雷族名单 10；★681 第二析取支排除表漏列 → 实际 5,
   *  惰性成员照原文编码） */
  private static readonly FIRED_ARC = new Set([30, 397, 517, 681, 588,
    779, 783, 862, 863, 1088]);
  /** 发射支 ai[0]（追踪 ramp 用） */
  private firedAi0 = 0;

  /** 655 蜂巢落地/撞墙/入水 Kill（:76611-76660）：音 4 = legacy NPCKilled
   *  （SoundID.cs:30,:76613,仓键 'killed',Game.breakHive 同款）+ 尘 147×30
   *  （Next(2)==0 → scale×1.4,视觉近似 #B8D878 粒）+ 回调（wet → 蜂巢块
   *  1124×Next(2,6) :76626-76628;干 → 裂 2+Next(3)³ 蜂,数量/出怪上限门在
   *  Game 侧）。引信耗尽走 onExplode 不入此路。 */
  private killBeehive(game: GameHooks, lastVx: number, lastVy: number): void {
    if (this.dead) return;
    this.dead = true;
    game.onProjectileDeath?.(this.projId, this.x, this.y, this.w, this.h);
    game.playSfx?.('killed', 1, this.cx, this.cy);          // :76613 PlaySound(4, position)
    game.spawnParticles(this.cx, this.cy, '#B8D878', 30, 1.8, { life: 20 });
    // wet 位 = 湿段维护旗（原版 Kill :76626 读同一 wet 字段）：入液 Kill 位在湿段前
    //  → 上拍采样（原版 AI 读上子步旗同相）;撞墙 Kill 位在湿段后 → 本子步采样
    //  （原版 HandleMovement 内 Kill 同相）——R2 P2-4 收编（旧 wet655 当拍直探退役）
    this.onBeehiveKill?.(this.wet, this.cx, this.cy, lastVx * 1.9, lastVy * 1.9);
    // ★杀拍补跑（AI-Kill 拍湿段照跑,原版 :16903 无 active 门;wetSectionRan 防双跑
    //  ——入液 Kill 位在湿段前需补跑,位移后撞墙 Kill 位湿段已跑即跳过）
    this.wetSectionKillStep(game);
  }
  /** 火箭贴墙待爆标记（vel=0 后停物理） */
  private stickPending = false;
  /** 感应雷布防 alpha（0 常态 → 200 布防） */
  private armedAlpha = 0;

  /** SW-H1 2026-09-03：引信烟尘（AI_016 :48048-48055——1086/1087 专属）。
   *  节拍 = 每 tick 恰 1 粒（无计数器/概率门;timeLeft≤3 先行 Kill → 末 3t 不出尘
   *  ——SW-L1 2026-09-03 F4 落实:爆点前移（--fuse≤2 判,原版 :48031-48035 AI Kill
   *  序）后尘段在 fuse≤3 拍不可达,头注语义自此成立;曾 --fuse<=0 爆点在尘段后,
   *  末 3 拍仍出尘）。
   *  几何/参数推导见 fuseSmoke307Of 纯函数（回归测试锚）。dust 307 =
   *  NewDust(Center,6,6,307,velocity.X,velocity.Y,100,default(Color),1.6) 后
   *  position=vector3 / noGravity / velocity=velocity+vector4——终速整体覆写吃掉
   *  spawn 抖动（含池 307 烟雾族 vx×0.3/scale×0.7 特例后的覆写,原版同构）;
   *  scale 终值=1.6×抖动×0.7 两版一致。 */
  private fuseSmoke307(game: GameHooks): void {
    const f = fuseSmoke307Of(this.projId, this.rot, this.h / 2);
    if (!f) return;
    const d = game.spawnDust?.(this.cx - 3, this.cy - 3, 6, 6, 307, this.vx, this.vy, 100, null, 1.6);
    if (d) {
      d.x = this.cx + f.dx;
      d.y = this.cy + f.dy;
      d.noGravity = true;
      d.vx = this.vx + f.dvx;
      d.vy = this.vy + f.dvy;
    }
  }

  /** SW-I1 2026-09-03：投掷族通用引信烟尘（AI_016 :48285-48322 通支）。节拍=每
   *  tick 掷 Main.rand.Next(2)==0（:48285）→【双尘齐出】,各尘期望 1 粒/2 tick：
   *  · 尘 31 小烟（:48289-48292）：NewDust(position,w,h,31,0,0,100) 后 scale=
   *    0.1+Next(5)×0.1 / fadeIn=1.5+Next(5)×0.1 / noGravity / position 整体
   *    覆写 = Center+(0,−h/2).RotBy(rot)×1.1（引信尖,随滚转自转）；
   *  · 主尘 num30（:48294-48321）：NewDustDirect(position,w,h,num30,0,0,100) 后
   *    scale=1+Next(5)×0.1 / noGravity / position 覆写 = Center+(0,−h/2−6).
   *    RotBy(rot)×1.1；num30 分型见 bombFuseSmokeTypeOf。
   *  位置覆写吃掉 spawn 抖动（与 fuseSmoke307 同构,scale 亦按原版绝对赋值）。
   *  出生点在主角盒内不做排烟门——原版无此门（同 firedStep 头注口径,尘层
   *  画在玩家之后不被压住）。 */
  private fuseSmokeGeneral(game: GameHooks): void {
    const t = bombFuseSmokeTypeOf(this.projId, GrenadeProj.waterStyleDust(game));
    if (t === null || Math.random() >= 0.5) return;
    const sin = Math.sin(this.rot), cos = Math.cos(this.rot);
    const d31 = game.spawnDust?.(this.x, this.y, this.w, this.h, 31, 0, 0, 100, null, 1);
    if (d31) {
      d31.scale = 0.1 + Math.floor(Math.random() * 5) * 0.1;
      d31.fadeIn = 1.5 + Math.floor(Math.random() * 5) * 0.1;
      d31.noGravity = true;
      d31.x = this.cx + sin * (this.h / 2) * 1.1;
      d31.y = this.cy - cos * (this.h / 2) * 1.1;
    }
    const d30 = game.spawnDust?.(this.x, this.y, this.w, this.h, t, 0, 0, 100, null, 1);
    if (d30) {
      d30.scale = 1 + Math.floor(Math.random() * 5) * 0.1;
      d30.noGravity = true;
      d30.x = this.cx + sin * (this.h / 2 + 6) * 1.1;
      d30.y = this.cy - cos * (this.h / 2 + 6) * 1.1;
    }
  }

  /** SW-I1 2026-09-03：引信烟尘总入口（AI_016 尘段：1086/1087 尘 307 专支
   *  :48048-48055 → 通支尘 31+num30 :48285-48322——两支互斥,节拍/排除/几何
   *  见 fuseSmoke307Of / bombFuseSmokeTypeOf）。调用点=尘段在 ai[0]++/重力门
   *  之前（:48048/:48285 → :48332/:48377）,粘性与普通两路各自对齐同序。 */
  private fuseSmoke(game: GameHooks): void {
    this.fuseSmoke307(game);
    this.fuseSmokeGeneral(game);
  }

  /** SW-P1 2026-09-03：1088 橡实种弹帧支（AI_016 尘段 else-if 链 1088 档
   *  P.cs:48058-48063——原版在 Kill 判 else 内每拍跑,frameCounter==0 门使之
   *  只在首 AI 拍生效;粘性/发射两路均置于爆点判后=原文 Kill 判 else 位）。
   *  1088 本仓仅发射支可达。 */
  private acornSeedFrame(): void {
    if (this.projId !== 1088) return;
    const r = acornSeedFrameInit(this.frame1088Counter, Math.floor(Math.random() * 2));
    this.frame1088Counter = r.counter;
    if (r.frame >= 0) this.frame1088 = r.frame;
  }

  /** SW-I1 2026-09-03：AI_016 重力门步进（:48332 ai[0]++ → :48377 门）。开门拍起
   *  vy+=0.2；落地（vy==0&&vx≠0）另 vx×0.97、炸药棍族再 ×0.99、|vx|<0.01 归零
   *  ——★此处是原版唯一摩擦点（:48377-48385 在门支内;碰撞响应 :19855-19868 无
   *  摩擦,SW-L1 I-1 已删落地支复乘）。返回值（门是否已开）现无消费面,保留兼容;
   *  911 速度钳 ±8（:48393-48396）。
   *  SW-N1 2026-09-03：vy 终端钳 16 移除——:48332-48430 全段自查,原版门支恒
   *  `velocity.Y += 0.2f` 无钳;Update 内 AI(:16880)→HandleMovement(:17120) 之间
   *  也无全局终速钳（唯一风阻 X 钳 :16885 且风控门）。旧 16 封顶=本仓近似,
   *  高抛长弧末速被削（180t 引信理论峰值 vy≈36,原版同值）。★连带面：反弹阈值
   *  lastVy>0.7 语义不变（lastVy 取门后值,原版 lastVelocity 亦 AI 后捕获
   *  :17696）;655 分支钳保留=原版 aiStyle25 自带（:26679-26686,与 AI_016 无关）。 */
  private bombGravityStep(): boolean {
    this.ai0 += 1;
    const gate = bombGravityGateOf(this.projId);
    if (gate === null) {                       // 655 蜂巢（AI_025）：无门恒重力
      // ★655 钳是原版本相（aiStyle25 :26684-26687 `if (velocity.Y > 16f) velocity.Y = 16f`
      //   先于重力加),勿随 AI_016 去钳一并移除。
      // SW-W1 2026-09-04：增量 0.2→0.3（:26738-26741 else 支逐字,SW-N1 备案清偿）
      //   ——序对齐原文「先钳后加」:终端速度=每拍钳 16 再 +0.3=16.3,非旧
      //   「先加后钳」的恒 16（0.3 也已由 sw-w1 微物理回归钉面）。
      if (this.vy > 16) this.vy = 16;
      // SW-X1 2026-09-04（L-1①）：X 自加速（:26694-26710 第三析取支 `else if
      //   (velocity.Y <= 6f)`——1055/1021 专属支之后,655 落此）:vx 朝原方向
      //   ±0.05,开区间门 |vx|<7（原文字面 `> 0f && < 7f`）;门读钳后 vy
      //   （vanilla 序 = 钳 16 :26684 → 自加速 :26694 → 重力 +0.3 :26738）。
      //   bombGravityGateOf 仅 655 返 null → 本支即 655 独占。
      if (this.vy <= 6) {
        if (this.vx > 0 && this.vx < 7) this.vx += 0.05;
        if (this.vx < 0 && this.vx > -7) this.vx -= 0.05;
      }
      this.vy += 0.3;
      return true;
    }
    if (this.ai0 <= gate) return false;        // 门未开：出手直飞 N tick 零重力
    if (this.vy === 0 && this.vx !== 0) {
      this.vx *= 0.97;
      if (DYN_PROJ.has(this.projId)) this.vx *= 0.99;
      if (this.vx > -0.01 && this.vx < 0.01) this.vx = 0;
    }
    this.vy += 0.2;                            // SW-N1：:48394 逐字（16 钳移除）
    if (this.projId === 911) {
      this.vx = Math.max(-8, Math.min(8, this.vx));
      this.vy = Math.max(-8, Math.min(8, this.vy));
    }
    return true;
  }

  constructor(x: number, y: number, vx: number, vy: number, damage: number, fuse: number,
    projId: number, onExplode: (x: number, y: number, damage: number, oldVx?: number, oldVy?: number) => void) {
    super();
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.fuse = fuse;
    this.projId = projId;
    this.onExplode = onExplode;
    // 液体炸弹/土制炸弹族碰撞盒 22×22（SetDefaults :8325-8332/:8363-8379 同炸弹族）；
    // 773 甲虫炸弹同值（:7904-7912 1457/1458 同行号）
    const hb =
      // SW-H1 2026-09-03：519 炸弹鱼 24×24（P.cs:5891-5897 SetDefaults 独立档——
      // 非炸弹族 22 盒,曾误落缺省 14）
      projId === 519 ? 24 :
      // SW-P1 2026-09-03：1088 橡实种弹 20×20（P.cs:10147-10153 SetDefaults 独立档
      // width=height=20——vanilla-projectiles.json '1088' 同值;曾误落缺省 14）
      projId === 1088 ? 20 :
      BOMB_PROJ.has(projId) || LIQUID_BOMB_PROJ.has(projId) || projId === 910 || projId === 911
      || projId === 773
      // SW-E1 2026-09-03：超级炸弹 22×22（P.cs:10135-10145 SetDefaults——1086 普通
      // /1087 粘性,同 28/37 族 22 盒）
      || projId === 1086 || projId === 1087
      ? 22 : DYN_PROJ.has(projId) ? 10 : 14;
    this.w = hb; this.h = hb;
  }

  /** 发射支（AI_016 else :44542-44911）：无重力直线 + 家族行为 + 撞块语义表 */
  private firedStep(game: GameHooks): void {
    const st = game.world.store;
    // ★v8 排烟门补落（2026-09-01 终案「渲染层角色盒内不渲染弹体/烟尾」——当日只
    //   落了弹体门（GrenadeProj.draw/Arrow.draw）,尘支被同日 noGravity 修复重写时
    //   丢失;2026-09-02 用户实报"垂直向上发射火箭,弹出生后尾焰堆在武器贴图上"）。
    //   原版无此门（烟尾尘在玩家上层照画——DrawDust Main.cs:63241 在玩家 :63204
    //   之后,出生窗被压住的只有弹体层非尘层）——按 v8 渲染层可见性惯用法收口:
    //   烟尾出生点落在主角碰撞盒内不出尘,盒外（枪口带）照常,观感=尾焰从枪口冒出。
    //   门=pure 观测（不掷 RNG 不改物理）,mock game.player 缺省=门常开。
    const mp = game.player as { x: number; y: number; w: number; h: number } | undefined;
    const inBodyBox = mp
      ? (px: number, py: number): boolean =>
          px > mp.x && px < mp.x + mp.w && py > mp.y && py < mp.y + mp.h
      : () => false;
    // （液体火箭入液即爆门已收编至 fixedUpdate 头 :47771 字段读门——R3 拍序批,
    //   内联扫盒退役）
    // SW-L1 2026-09-03 I-2：爆点前移对齐原版——AI 头 timeLeft<=3 → Kill（P.cs
    //   :48031-48035,先于尘段/重力/位移）→ Update 尾 timeLeft--（:17307）。本仓
    //   倒数在 AI 位（--fuse 后判）:post-dec ≤ 2 ≡ 原版 pre-tail-dec ≤ 3（180 引信
    //   =第 178 拍爆;曾 --fuse<=0 =第 180 拍,+2）。接触钳 3 的拍 dec 不爆、次拍
    //   2≤2 爆 = 原版 Damage(:17184) 钳后次拍 AI Kill（接触段已移至本判后）。
    //   ★R3：入液门（fixedUpdate 头）在 Kill 判前同拍 → timeLeft=1 当拍即爆 = 原文
    //   :47771→:48031 同拍序
    // IIII225：FTW×noTraps 双种子引信加速（P.cs:48040-48045：AI_016 :48031 Kill 判
    //   else 支内 `if (getGoodWorld && noTrapsWorld && !tenthAnniversaryWorld)
    //   timeLeft--`——存活拍再减 1，180 引信实际 90 拍爆）。本仓 Kill 判与 Update 尾
    //   timeLeft-- 合并为 `--fuse<=2`（post-dec≤2 ≡ pre-dec≤3），门换算 = 仅
    //   `fuse>4` 的拍预减（F=4 拍：cs 存活→门减→尾减至 2→次拍爆；若按 fuse>3 预减
    //   则本仓当拍即爆=早 1 拍。F>4 预减后 --fuse 终值与 cs 每拍终态逐拍相等）。
    //   仅发射支/投掷支 AI 头两处衰减点之一（同 :6204 投掷支）。
    if (game.world.seedFlags?.getGoodWorld && game.world.seedFlags?.noTraps
      && !game.world.seedFlags?.tenthAnniversary && this.fuse > 4) this.fuse--;
    if (--this.fuse <= 2) {
      this.dead = true;
      this.destroy();
      this.onExplode(this.x + this.w / 2, this.y + this.h / 2, this.damage, this.vx, this.vy);
      // ★杀拍补跑（AI-Kill 拍湿段照跑,原版 :16903 无 active 门;wetSectionRan 防双跑）
      this.wetSectionKillStep(game);
      return;
    }
    // SW-P1 2026-09-03：1088 静止即 Kill（P.cs:48030 `owner==Main.myPlayer &&
    //   type == 1088 && (timeLeft <= 3 || velocity.Length() <= 0.01f) → Kill()`——
    //   timeLeft 臂已由上方 fuse 承载,此为 velocity 析取臂）。发射支原版序=
    //   Kill 判先于帧支/重力/位移 → 置于 fuse 判后。Kill → onExplode →
    //   Game.acornSeedDeath（种植/掉落,J 批专属早退支,非爆炸）——曾缺=橡实弹
    //   滚行静止后悬停至 3600t 兜底引信才结算。本仓 1088 仅发射源 5629 弹弓,
    //   投掷支（fired=false）不可达,不另加
    if (this.projId === 1088 && Math.hypot(this.vx, this.vy) <= 0.01) {
      this.dead = true;
      this.destroy();
      this.onExplode(this.cx, this.cy, this.damage, this.vx, this.vy);
      // ★杀拍补跑（同上——AI-Kill 拍湿段照跑）
      this.wetSectionKillStep(game);
      return;
    }
    this.acornSeedFrame();
    // 接触引爆（Damage_PVE_Inner :12330-12340 碰 NPC → timeLeft 钳 3；发射族
    // friendly 不炸玩家）。★Damage() 每 tick 跑（Update :15738）→ 遍历 Main.npc
    // 全表 = enemies+critters 两桶（碰小动物同样钳引信+弹体盒结算伤害——小动物
    // 一击死）。曾只扫 enemies 桶（2026-08-21 补 critters）
    // SW-L1 2026-09-03 I-2：本段移至爆点判后（原版 Damage :17184 晚于 AI 的
    //   timeLeft<=3 Kill 判 :48031——曾判前钳 3 + 旧爆点同拍再倒数,拍位错 2）
    if (this.fuse > 3) {
      for (const ent of game.enemies()) {
        const e = ent as unknown as { x: number; y: number; w: number; h: number; dead?: boolean;
          hurt?: (d: number, kx: number, ky: number, g: unknown, pen?: number, crit?: boolean, pierce?: number, fp?: boolean) => boolean };
        if (e.dead) continue;
        if (this.x < e.x + e.w && this.x + this.w > e.x
          && this.y < e.y + e.h && this.y + this.h > e.y) {
          // Damage_PVE_Inner aiStyle16 分支（:12330-12340）只钳 timeLeft=3——接触伤害
          // 已在标准 Damage_PVE 流程结算（StrikeNPC 全管线：飘值/音/免疫帧由单点给，
          // 3t 后的爆炸被免疫帧挡住不双击）。曾只钳引信不结算 = 火箭以 ~10-15px/t
          // 再飞 3t（30-45px）穿过目标才爆,接触目标零伤（假人/蝙蝠双症状根因）
          const dir = (e.x + e.w / 2) < this.x + this.w / 2 ? -1 : 1;
          // ★BJ489 def-3：掷率=rollVanillaHitCrit（:12915-12927 owner 装配+:25712 持械
          // 折入,命中拍动态）——手雷族 30/397/517/588/681 ranged 旗;28/29/37 等炸弹族
          // SetDefaults 无类旗（:1108-1131）=原版零掷;critTotal 出生拍冻结载体退役
          const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
          // ★R02（BJ723-B 2026-10-26）：接触伤害补全标准 Damage_PVE 管线三件——
          //  ①DamageVar（:12970 逐靶掷,owner luck 正向;掷位=crit 掷后、snap 触发前
          //  =原版 :12970<:13439 同序）②攻端旗乘区（:13388 GetBannerBuffEffect→
          //  effect.DamageDealt.Sample,手雷族 30/397/517/588/681 ranged 旗照吃）
          //  ③crit ×2 由 Enemy.hurt 防后承载（S02）——旧=掷暴击但传原始 damage
          //  （零翻倍+零浮动+零旗）。snap 加伤不进旗乘区（F1 迁移注 stats/SnapStrike）。
          const dmgVGrenade = damageVarRoll(this.damage,
            ((game.player as unknown as { luck?: number } | null)?.luck) ?? 0);
          const snapBonusGrenade = projectileSnapStrikeBonus(game, this, e.x + e.w / 2, e.y + e.h / 2,
            (e as unknown as { id?: number }).id ?? -1,
            { victimBox: { w: e.w, h: e.h, cx: e.x + e.w / 2, cy: e.y + e.h / 2 } });
          e.hurt?.(applyBannerDamageDealt(game, e, dmgVGrenade)
            + (snapBonusGrenade ? snapBonusGrenade : 0),
            dir * this.contactKb, 0, game, this.contactPen, crit, 0, true);
          this.fuse = 3;
          break;
        }
      }
      if (this.fuse > 3) {
        for (const cent of game.critters?.() ?? []) {
          const c = cent as unknown as { x: number; y: number; w: number; h: number; dead?: boolean; hurt?: (g: unknown) => boolean };
          if (!c || c.dead) continue;
          if (this.x < c.x + c.w && this.x + this.w > c.x
            && this.y < c.y + c.h && this.y + c.h > c.y) {
            c.hurt?.(game);   // 弹体盒结算（小动物一击死）
            this.fuse = 3;
            break;
          }
        }
      }
    }
    // ---- 家族行为（发射支通用 ai[0] += 1 :44836——榴弹 15u 重力门/追踪 ramp 都吃它）----
    this.firedAi0 += 1;
    if (GrenadeProj.FIRED_HOME.has(this.projId) && this.firedAi0 > 30) {
      let tx = this.cx + this.vx * 100, ty = this.cy + this.vy * 100;   // 无目标 → 前方 100px
      let bd = this.projId === 930 ? 650 : 600;
      for (const ent of game.enemies()) {
        const e = ent as unknown as { x: number; y: number; w: number; h: number; cx: number; cy: number; dead?: boolean };
        if (e.dead) continue;
        const d = Math.abs(e.cx - this.cx) + Math.abs(e.cy - this.cy);
        if (d < bd && canHit(st, this.cx, this.cy, 0, 0, e.x + e.w / 2, e.y + e.h / 2, 0, 0)) {
          bd = d; tx = e.x + e.w / 2; ty = e.y + e.h / 2;
        }
      }
      const spd = this.projId === 930 ? 12 : 16;
      const dl = Math.hypot(tx - this.cx, ty - this.cy) || 1;
      const gx = (tx - this.cx) / dl * spd, gy = (ty - this.cy) / dl * spd;
      this.vx += (gx - this.vx) / 12;                                   // Lerp 1/12（:44683）
      this.vy += (gy - this.vy) / 12;
    }
    if (GrenadeProj.FIRED_ROCKET.has(this.projId)) {
      if (Math.abs(this.vx) < 15 && Math.abs(this.vy) < 15) {             // 飞行加速 ×1.1（:48236-48238）
        this.vx *= 1.1; this.vy *= 1.1;
      }
      // 烟尾（AI_016 :48183-48234）：|vx|≥8 或 |vy|≥8 每 update 2 拍循环（n=0/1）——
      // 每拍烟尘 num13（scale×2+Next(10)×0.1、v×0.2、noGravity）+ 火尘 31（scale 0.5、
      // fadeIn 1+Next(5)×0.1、v×0.05）；出生点 = (x+3+n·v/2)−v/2、盒 (w−8,h−8)。
      // 曾 60% 掷 1 粒合成粒子 = 烟尾密度/形态与原版不符（备案遗留③）
      if (Math.abs(this.vx) >= 8 || Math.abs(this.vy) >= 8) {
        const dust13 = GrenadeProj.rocketTrailDust(game, this.projId);
        for (let n = 0; n < 2; n++) {
          const ox = n === 1 ? this.vx * 0.5 : 0;
          const oy = n === 1 ? this.vy * 0.5 : 0;
          const px = this.x + 3 + ox - this.vx * 0.5;
          const py = this.y + 3 + oy - this.vy * 0.5;
          if (inBodyBox(px, py)) continue;   // ★排烟门：出生点在角色盒内不出尘（firedStep 头注）
          const bw = Math.max(5, this.w - 8), bh = Math.max(5, this.h - 8);
          const d13 = game.spawnDust?.(px, py, bw, bh, dust13, 0, 0, 100, null,
            2 + Math.floor(Math.random() * 10) * 0.1);
          if (d13) {
            d13.vx *= 0.2; d13.vy *= 0.2;
            d13.noGravity = true;   // :48204 ★曾漏——火焰(尘 6=Torch)每拍 +0.05 下坠,
          }                         // 链 B ×0.92 衰减也失配,尾焰读成"只有烟"(2026-09-01)
          const d31 = game.spawnDust?.(px, py, bw, bh, 31, 0, 0, 100, null, 0.5);
          if (d31) { d31.fadeIn = 1 + Math.floor(Math.random() * 5) * 0.1; d31.vx *= 0.05; d31.vy *= 0.05; }
        }
      }
    }
    if (GrenadeProj.FIRED_GRENADE.has(this.projId)) {
      // 排烟门：出生点（=弹心）在主角盒内不出尘（同 firedStep 头注；RNG 掷序不变）
      if (Math.random() < 0.5 && !inBodyBox(this.cx, this.cy)) game.spawnParticles(this.cx, this.cy, '#B8B8A8', 1, 1.2, { life: 18 });  // 尾尘 31（:44745-44748）
      if (this.firedAi0 > 15) {                                           // 15u 后重力 + 落地摩擦（:44870-44879）
        if (this.vy === 0 && this.vx !== 0) this.vx *= 0.95;
        // SW-N1 2026-09-03：16 钳移除——发射支尾链无钳（:48371-48379 逐字
        //   `if (velocity.Y == 0f) velocity.X *= 0.95f; velocity.Y += 0.2f;`）
        this.vy += 0.2;
      }
    }
    if (GrenadeProj.FIRED_ARC.has(this.projId) && this.firedAi0 > (bombGravityGateOf(this.projId) ?? 10)) {
      // 延迟重力弧（:44881-44901）：ai[0]>10 起 vy+0.2/update；落地滚行摩擦
      // （vy==0&&vx≠0 → vx×0.97，|vx|<0.01 归零——:44886-44893）
      if (this.vy === 0 && this.vx !== 0) {
        this.vx *= 0.97;
        if (this.vx > -0.01 && this.vx < 0.01) this.vx = 0;
      }
      this.vy += 0.2;
    }
    if (GrenadeProj.FIRED_MINE.has(this.projId)) {
      // 恒重力 + 减速布防（:44857-44868）：vy+=0.2、v×0.97、|v|<0.1 归零
      // SW-N1 2026-09-03：16 钳移除——:48364-48370 逐字无钳（该支收敛 vy≈6.47,
      //   钳移除不改变Mine弹道,纯精确化）
      this.vy += 0.2;
      this.vx *= 0.97; this.vy *= 0.97;
      if (Math.abs(this.vx) < 0.1) this.vx = 0;
      if (Math.abs(this.vy) < 0.1) this.vy = 0;
      if (Math.abs(this.vx) < 0.2 && Math.abs(this.vy) < 0.2) {
        this.armedAlpha = Math.min(200, this.armedAlpha + 2);             // 布防半隐（:44752-44758）
      } else {
        this.armedAlpha = 0;
        if (Math.random() < 0.5 && !inBodyBox(this.cx, this.cy)) game.spawnParticles(this.cx, this.cy, '#C0C0B0', 1, 1.4, { life: 16 });
      }
    }
    // ★通用湿段·活拍（:16903-17113——发射支 AI 链尾/位移前 = 原版 post-AI 同位;
    //  贴墙待爆拍位不移,湿段照跑（原版 HandleMovement 对 vel=0 照走一步=零位移,
    //  湿段在其前无差）;域注见字段块/杀拍补跑见两 explode 支）
    this.wetSectionStep(game);
    // SW-AQ1 2026-09-05：oldPosition 上报（Update :17118 AI 后/位移前置位）——
    //  中央压板扫描新旧位判定消费（Collision.cs:3346-3353/:3356 + :19974 门）。
    //  ★置位在 stickPending 早退【前】：贴墙待爆拍位不移（position==oldPosition
    //  ≡ 原版 :19974 门不达同相),旧位必须逐拍刷新防 stale 值重触发。
    //  ★R3 位序：湿段(:16903) → oldPosition(:17117) → HandleMovement(:17120) ✓
    this.oldX = this.x; this.oldY = this.y;
    if (this.stickPending) return;                                        // 贴墙待爆：vel=0 静止
    // ---- 位移（无重力）+ 撞块（AI_016 响应表）----
    // ★残余债清偿(2026-09-01):三点半采样撞块在斜砖/半砖上漏检(几何空区)+误检并存,
    // 改走 moveAndCollide 正典管线——hitWall/collideY/onGround 旗标驱动原响应分支
    // 分毫不变(stick 待爆/×−0.4 反弹/lastVy>0.7 门槛/1088 橡实种植)。火箭"像素方块
    // 地形脚下必爆"(2026-08-23 用户报)这类出生盒重叠病灶由管线嵌入自愈一并终结。
    const lastVx = this.vx, lastVy = this.vy;
    const bodyY0 = this.y;   // SW-N1：本拍积分前 y（软着陆钳速残差 = body.y − bodyY0）
    // ★水中位移阻尼（HandleMovement :17721-17764,2026-09-04 湿段批）——速度【场】
    //  不减只削位移（原版 wetVelocity = velocity×drag 后仅进 UpdatePosition,velocity
    //  字段本身不被水阻改写）。moveAndCollide 契约：dx/dy=本拍位移、b.vx/vy=碰撞调整
    //  字段（采纳处原样回读）——阻尼只进位移入参,采纳行不动
    const drag = this.wetDragFactor();
    const body = {
      x: this.x, y: this.y, w: this.w, h: this.h,
      vx: this.vx, vy: this.vy,
      onGround: false, hitWall: false, hitHead: false, collideY: false,
      hoik: true,   // ★FX34c 弹幕域 hoik=true（Body.hoik 注:原版 Projectile 全路径）
      tileCollide: true, dropThrough: true,
    };
    moveAndCollide(body, game.world, this.vx * drag, this.vy * drag);
    this.x = body.x; this.y = body.y;
    // ★1:1 同批:采纳管线后速度(lastVx/lastVy 已存档供反弹式引用)——贴坡等编辑持久化
    this.vx = body.vx; this.vy = body.vy;
    const hitX = body.hitWall, hitY = body.collideY || body.onGround || body.hitHead;
    // 1088 橡实种弹：撞块先查种树点（CanAcornPlant → Kill——Kill 内种植/掉落，
    // oldVelocity = 入撞前速度）。管线版接触面含坡面落面(onGround)
    if (this.projId === 1088 && this.bouncePlantCheck
      && (hitX || hitY)
      && this.bouncePlantCheck(this.cx, this.cy)) {
      this.dead = true;
      this.destroy();
      this.onExplode(this.cx, this.cy, this.damage, lastVx, lastVy);
      return;
    }
    if (hitX) {
      // ★BJ252 弹力族（516 弹力炸弹/517 弹力炸药/637 弹力粘珠——HandleMovement
      //  :18591-18600 型别支先于 aiStyle 16 通用反弹（:19872-19887 ×−0.4）截走,
      //  曾误走 ×−0.4 档=弹性错档）：|last|>1 → ×−0.9;门内不写=保持管线采纳
      //  钳后值（GrenadeProj 采纳面 :5997-5998 已回读 body 速度=原版截断语义）。
      if (BOUNCY_PROJS.has(this.projId)) {
        if (Math.abs(lastVx) > 1) this.vx = lastVx * -0.9;                // :18593-18595
      } else if (GrenadeProj.FIRED_STICK.has(this.projId)) {
        this.vx = 0; this.vy = 0; this.stickPending = true; this.fuse = Math.min(this.fuse, 3);
      } else {
        this.vx = lastVx * -0.4;                                          // 榴弹/雷反弹 ×−0.4（:18349-18356 系）
      }
    }
    if (hitY) {
      if (BOUNCY_PROJS.has(this.projId)) {
        if (Math.abs(lastVy) > 1) this.vy = lastVy * -0.9;                // :18597-18600
      } else if (GrenadeProj.FIRED_STICK.has(this.projId)) {
        this.vx = 0; this.vy = 0; this.stickPending = true; this.fuse = Math.min(this.fuse, 3);
      } else if (lastVy > 0.7) {
        this.vy = lastVy * -0.4;
      } else {
        // SW-N1 2026-09-03：软着陆保留钳速残差（=本拍实际位移）——原版
        //   TileCollision 只回钳速度、响应支（:19877-19886）lastVy≤0.7 不写 vy →
        //   残差存活到下拍 → 下拍 AI vy==0 门假（settle 拍无摩擦,与投掷支同相）。
        //   旧 `vy=0` 吞残差 → 摩擦提前 1 拍。贴墙待爆支（FIRED_STICK）原版
        //   `velocity *= 0`（:19888-19891）恒零,不在本支。
        this.vy = this.y - bodyY0;
      }
    }
    if (!st.inBounds(Math.floor(this.cx / TILE), Math.floor(this.cy / TILE))) {
      this.dead = true;
      this.destroy();
      return;
    }
    // CutTiles（Projectile.cs:11824/:16575：friendly/hostile 且 damage>0 每 update
    // 沿速度线切割草/藤/罐——火箭直飞穿藤即断。曾缺=火箭无法打掉丛林藤蔓(用户报,
    // 枪械走 Arrow.subStep cutTile 正常)）
    game.cutTile(Math.floor(this.cx / TILE), Math.floor(this.cy / TILE));
    // 滚转：火箭族不滚（:44908 排除）→ 朝向速度；榴弹/雷滚转
    if (GrenadeProj.FIRED_STICK.has(this.projId)) {
      this.rot = Math.atan2(this.vy, this.vx) + Math.PI / 2;   // 贴图纵向（同箭族）
    } else {
      this.rot += this.vx * 0.1;
    }
  }

  draw(r: Renderer, cam: Camera): void {
    // ★HOUSE(2026-08-31):角色盒内不渲染弹体(age<30 门)——与 Arrow.draw 同款,
    //  GrenadeProj 此前漏加 = 火箭从身体中心可见("弹没从炮筒出"的火箭侧根因)
    const mp = r.mainPlayer;
    if (mp && this.fired) {
      if (this.cx > mp.x && this.cx < mp.x + mp.w &&
          this.cy > mp.y && this.cy < mp.y + mp.h) {
        return;
      }
    }
    // 原版投射物绘制 = 贴图原生尺寸 × scale 1（与碰撞盒解耦）——雷管 29 贴图 10×32
    // 此前按碰撞盒宽 14 拉方成 14×44.8（"雷管贴图这么大个"根因）
    // 发射族：贴墙待爆 alpha=255 隐形 / 感应雷布防 alpha=200 半隐（:18368/:44754）
    const firedA = this.fired ? 1 - Math.max(this.stickPending ? 255 : this.armedAlpha, 0) / 255 : 1;
    // SW-I1 2026-09-03：519 帧通道（projFrames[519]=4,Main.cs:8619——贴图 38×152
    //   竖条 4 帧,曾整条直绘=4 帧叠画成 152px 长条）
    // SW-L1 2026-09-03 F2：773 甲虫炸弹并入帧通道（projFrames[773]=4,Main.cs:8777;
    //   贴图 22×168 竖条 4 帧——帧态来自贴附支自有 counter 规则 :47944-47949,非
    //   519 的 bombFishFrameTick,两规则并存）
    // SW-P1 2026-09-03：1088 橡实种弹并入帧通道（projFrames[1088]=2,Main.cs:8594;
    //   贴图 Projectile_1088.png 18×42 竖条 2 帧 21px——帧态=首 AI 拍一次性
    //   Main.rand.Next(2) 选帧（P.cs:48058-48063）,无逐帧推进。曾整条直绘=
    //   2 帧叠画成 42px 长条（同 519 旧 bug 形态）。588 不入本通道:projFrames
    //   表无 588 行,贴图 14×20 单帧竖幅走通支整幅直绘=原版本相）
    const drawFrame = this.projId === 519 ? this.bombFishFrame
      : this.projId === 773 ? this.frame773
      : this.projId === 1088 ? this.frame1088 : -1;
    const drawFrames = this.projId === 519 ? BOMB_FISH_FRAMES
      : this.projId === 773 ? BEETLE_BOMB_FRAMES
      : this.projId === 1088 ? ACORN_SEED_FRAMES : 0;
    // ★SW-BJ16 2026-09-07：773 甲虫炸弹 = Main.cs:33693 中心锚支成员（origin.Y =
    //  帧高−12 :33951-33953）——不走通用尾绘盒左上锚。旧通用路（drawProj 帧通道）
    //  精灵顶 = 盒顶（22×42 帧/22×22 盒）⇒ 整体偏低 19px（原版精灵顶 = 盒心−30 =
    //  盒顶−19）。源矩形用全帧高：本支无 :35047 的 num482−1 shave（SW-L1 I-4 的
    //  「519/773」并提中 773 半项随之退役——该 shave 系通用路语义,773 本就不在
    //  通用路内；519 真·通用路成员不受影响）
    if (this.projId === 773) {
      const sheet = projSprite(773);
      const ctx = r.ctx;
      if (sheet && ctx) {
        const fh = sheet.height / BEETLE_BOMB_FRAMES;
        ctx.save();
        ctx.globalAlpha *= firedA;
        ctx.translate(this.cx, this.cy);
        ctx.rotate(this.rot);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(sheet as CanvasImageSource, 0, Math.round(drawFrame * fh),
          sheet.width, fh, -sheet.width / 2, -(fh - 12), sheet.width, fh);
        ctx.restore();
        return;
      }
    }
    drawProj(r, cam, this, this.projId, this.rot, '#408040', firedA, -1, false, false, 1,
      drawFrame, drawFrames);
  }

  /** 死亡清理：停引信嘶声（Kill :67373-67377 GetActiveSound?.Stop()） */
  destroy(): void {
    this.fuseSnd?.stop();
    this.fuseSnd = null;
  }

  /** 水中位移阻尼档（HandleMovement :17721-17764：wetVelocity = velocity×0.5 水 /
   *  ×0.25 蜂蜜 / ×0.375 微光——速度【场】不减、只削当拍位移；读【本拍刷新后】
   *  旗（原版湿段 :16903 在 HandleMovement :17120 前）） */
  /** 水中位移阻尼档（HandleMovement :17721-17764——projWaterDragFactor 共享体） */
  private wetDragFactor(): number {
    return projWaterDragFactor(this);
  }

  /** ★通用湿段·活拍（:16903-17113 全体弹共用段——projWetSection.ts 共享体 1:1,域注/
   *  位序/特支注见共享体文件头与本类字段块头）。调用位 = 各路【位移位前】
   *  （fired/粘性/655·普通三路;原版 AI(:16880) → 湿段(:16903) → HandleMovement(:17120)）
   *  + AI 内 Kill 早退位补跑（杀拍）+ 首拍 AI 前例外位（①′ 出生预置,fixedUpdate 头
   *  ——同拍多响由 wetSectionRan 头闩收敛,只跑首响）。
   *  ★⑧Shimmer() 接面（2026-09-07 缺面清单清偿；Update :17114-17117
   *  `if (shimmerWet) Shimmer()`——位在 `if (!ignoreWater)` 整段门【外】,共享体两
   *  支路（豁免早退支+段尾）已收口,本类只组装面）。域分派：aiStyle16 全域 →
   *  弹反族 A 支（P.cs:22606-22625）——深浸双格 Kill/vy>0 弹反+timeLeft 600 钳+−60
   *  （≡fuse 缩短=提前起爆,原版同字段）/shimmerWet·wet 双清;655 蜂巢（aiStyle 25）
   *  → 召唤浮升支（:22707-22718）;907(30)/908(175) 链外无动作=缺省支。
   *  面适配：hostile=GRENADE_SHIMMER_HOSTILE（域缺省 friendly,原版 hostile=true
   *  四 id 见常量注——头门 :22566 消费,aiStyle 25 的 655 照走）;ai0/ai1=0 恒传（AI_016 的 ai[0]=投掷节拍轴/ai[1] 无通用活面,本支
   *  只读 velocity/timeLeft/湿旗与深浸格,ai 面=零消费死码）;timeLeft≡fuse（引信=
   *  原版 timeLeft 同名字段,SW-L1 既案）;kill=弹体 Kill 配方（dead+destroy+onExplode
   *  +杀拍补跑——本类引信杀位 :5588-5594 同式;deep 浸 Kill 支 :22608-22610 消费;
   *  wetSectionKillStep 在湿段调用位恒 no-op（wetSectionRan 已置）,照抄配方防漂移）;
   *  936 解锁面域内无成员=缺省不接（登记死码）。
   *  ★同拍防双跑头闩（Arrow.ts wetSectionStep 头同配方）：调用位除上列外还有首拍
   *  AI 前例外位（①′ 出生预置,fixedUpdate 头,见彼注）——同拍第二响一律跳过。 */
  private wetSectionStep(game: GameHooks): void {
    if (this.wetSectionRan) return;   // ①′ 预置拍/杀拍补跑已跑过 → 位移位前调用位跳过
    this.wetSectionRan = true;
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater, {
        shimmer: (st, x, y, _w, _h) => {
          const sf: ProjShimmerFace = {
            projId: this.projId,
            aiStyle: projectileData(this.projId)?.aiStyle ?? -1,
            hostile: GRENADE_SHIMMER_HOSTILE.has(this.projId),
            vx: this.vx, vy: this.vy,
            timeLeft: this.fuse,
            ai0: 0, ai1: 0,
            wet: this.wet, shimmerWet: this.shimmerWet,
            rainbowSlimeUnlocked: false,
            kill: () => {
              if (this.dead) return;
              this.dead = true;
              this.destroy();
              this.onExplode(this.x + this.w / 2, this.y + this.h / 2, this.damage, this.vx, this.vy);
              this.wetSectionKillStep(game);
            },
          };
          projShimmerStep(sf, st, x, y, this.cx);
          this.vx = sf.vx; this.vy = sf.vy; this.fuse = sf.timeLeft;
          this.wet = sf.wet; this.shimmerWet = sf.shimmerWet;
        },
      });
  }

  /** ★通用湿段·杀拍补跑（AI 内 Kill 早退位——原版湿段【无 active 门】,AI-Kill 拍
   *  照跑：溅花/旗维护/wetCount 照走;wetSectionRan 防同拍双跑——位移位前已跑过的
   *  路径（贴墙待爆/出界杀等）直接跳过。Arrow.ts 杀拍配方同款） */
  private wetSectionKillStep(game: GameHooks): void {
    if (!this.wetSectionRan) this.wetSectionStep(game);
  }

  fixedUpdate(_dt: number, game: GameHooks) {
    if (this.dead) return;   // ★Projectile.Update :16780 `!active → return` 结构等价
                             // （原版 Kill 后 active=false 跳过 Update；本仓实体虽被
                             // 回收,直接泵 fixedUpdate（测试/wiring）不得重入——曾爆后
                             // 重启嘶声循环+重复 onExplode（红蓝二轮 orphan-b2 实锤））
    const st = game.world.store;
    // ★出界杀（Projectile.cs:16793-16802：非 minion 弹中心出世界边界 →
    //   active=false 静默消亡,无爆尘无 onExplode）——发射族（fired 火箭）fuse=3600
    //   (60s),缺此支时出屏火箭【永生飞行+持续撒尾焰】(4 尘/t),连发 7-9 颗后
    //   出屏老弹尘生成率逼近池容量 → 新弹尾焰被挤掉（用户实报"第 7-9 颗无尾焰",
    //   2026-09-02 尘池 6000 扩容后仍现=池压力源非容量本身）。
    if (!st.inBounds(Math.floor(this.cx / TILE), Math.floor(this.cy / TILE))) {
      this.dead = true;
      this.destroy();
      return;
    }
    this.wetSectionRan = false;
    // :16870 wetVelocity 快照（AI 前——粘性族湿位移消费,见粘性路积分支;
    //  粘性族 tileCollide=false → 无阻尼,湿位移 = AI 前快照原版 quirk）
    const preVx = this.vx, preVy = this.vy;
    // ★①′ 出生预置首拍面（NewProjectile :10886-10893;CrystalSerpentProj 523 同款范本,
    //  2026-09-08）：原版在【生成时点】采样写旗（:10887 wet=WetCollision 采样 /
    //  :10888-10891 ignoreWater 反清 / :10892-10893 honey·shimmer 无条件赋值）,首拍 AI
    //  湿旗消费者（:47771 入液引信门 / :26752 蜂巢 Kill / :47775 1077 闩）读预置值。
    //  旧结构预置随首拍湿段落在本仓 AI 后位（各路位移位前）→ 水中出生弹首拍 AI 读
    //  字段缺省 false、次拍才 Kill/爆 = 晚一拍（x1-round4 ② 金标 tick-1 Kill 实证;
    //  液体炸弹 903 出生水中同族）。首拍以「AI 前例外位」跑一次预置+段体（首拍盒未
    //  移动 P_1≡P_0,同位等价;presetDone 闩防后续重跑）;本拍 wetSectionRan 随之置位 →
    //  各路位移位前湿段与杀拍补跑同拍全部跳过（①′ 与杀拍闩互斥 = Arrow.ts 头闩同
    //  配方）。快照位注:preVx/preVy（:16870 wetVelocity）须先于本块——段体尾 shimmer
    //  钩可能改写速度,原版湿位移快照不含首拍 Shimmer 改写。残差登记:该钩（弹反族 A）
    //  首拍先于 AI 跑,原版 Shimmer() 在 AI 后（:17114）→ 微光出生拍 AI 读弹反后
    //  速度/旗,1 子步序差（523 范本同口径;523 无 shimmer 面=零差,本类有面,登记不扩）。
    if (!this.presetDone) {
      this.wetSectionStep(game);
      // 深浸微光出生拍 Kill（弹反族 A 深浸支 :22608-22610）——原版 Kill :71756-71758
      // `if (!active) return` 同款:亡弹不再续跑本拍管线,防门/引信面对亡弹二次结算。
      if (this.dead) return;
    }
    // ★液体炸弹/火箭入液引信门（AI_016 头 :47771 逐字——wet 旗 → timeLeft=1）。
    //  R3 收编（2026-09-06）：原 LIQUID_ROCKET/LIQUID_BOMB 两路内联扫盒（直测当前
    //  液态）退役,改读【上子步湿段】维护旗——原版 AI 在湿段(:16903)之前,读到的是
    //  上一 update 的旗;湿段现挂在各路位移位前,旗刷新拍位与原文 1:1（入液爆不再
    //  早 1 拍）。门在此位 = 原文 AI 头,先于各路 Kill 判（:48031 在 :47771 后同拍,
    //  timeLeft=1 当拍即爆 ✓）。1077 过渡臂照抄（:47775 维护式在门后）。
    if (this.wet && (WET_FUSE_PROJ.has(this.projId)
      || (this.projId === 1077 && this.rocketDryLatch === 1))) {
      this.fuse = 1;
    }
    if (this.projId === 1077) this.rocketDryLatch = this.wet ? 0 : 1;
    if (this.fired) { this.firedStep(game); return; }
    // ---- 引信嘶声循环（AI_016 :44276：IsABombWithFuse 且 timeLeft>1；0.2 音量跟踪弹体）----
    if (FUSE_SOUND_PROJ.has(this.projId) && this.fuse > 1) {
      // 首播可能缓冲未就绪返回 null → 每 tick 重试直至挂上（原版同帧不保证）
      if (!this.fuseSnd) {
        this.fuseSnd = game.startTrackedLoop?.('bombFuse', 0.2, this.cx, this.cy) ?? null;
      } else {
        this.fuseSnd.setPos(this.cx, this.cy);
      }
    }
    // SW-I1 2026-09-03：519 炸弹鱼帧动画（P.cs:47951-47970——粘性扫描后/Kill 判定
    //   前,每 tick 恒跑;引信末端 15t 双速）。帧态经 drawProj 帧参消费
    //   （Main.cs:34923 projFrames>1 通支,贴图 38×152 竖条 4 帧）。
    // SW-N1 2026-09-03 定谳：SW-L1 备案「原版帧段在 else 支内、爆拍跳过」前提
    //   【证伪】——:47951 `if (type == 519)` 在 AI_016_Bombs 函数体深度 1（括号
    //   深度实测),位 Kill 判（:48030-48037 `else if (timeLeft <= 3) Kill()`）
    //   【之前】→ 爆拍照跑;else 支内是尘段/damage=0（:48039-48330）,帧段不在内。
    //   本仓调用点（爆点判 `--fuse<=2` 之前）已是原版位——帧驱动【不移】,以
    //   tests/sw-n1-ai016-timing 钉「爆拍帧推进含入」防回退。
    if (this.projId === 519) {
      const fs = bombFishFrameTick(
        { fuseAge: this.bombFishAge, counter: this.bombFishCounter, frame: this.bombFishFrame });
      this.bombFishAge = fs.fuseAge;
      this.bombFishCounter = fs.counter;
      this.bombFishFrame = fs.frame;
    }
    // ---- 接触引爆（Projectile.Damage :12330-12340 仅碰 NPC；玩家不引爆）----
    // ★原版 BombsHurtPlayers(:13944-13959) 对玩家【只伤害不置 timeLeft】——曾把
    //   玩家也当引爆条件:炸弹出生点在玩家盒内 → 首帧 fuse=3 → 0.05s 即爆
    //   = "炸弹没引信"根因（2026-08-16 用户实抓）。PvP 敌对玩家接触(:13533)
    //   才写 timeLeft=3,本仓单机无此场景。
    // SW-I1 2026-09-03：★飞行接触分型（P.cs:48030-48047 每 tick `damage=0` 豁免
    //   表 + Damage_PVE `if (damage <= 0) return` :12576 + Kill 先于 Damage 的
    //   Update 序 :48034→:16880→:17184）：豁免表外型（炸弹 28/37/516/519、炸药棍
    //   29/470/637、甲虫 773、液体/泥土 903-906/910/911、超级 1086/1087）飞行中
    //   伤恒 0 → 【无接触结算、无引信钳 3、不杀小动物】,伤害只在 Kill→
    //   PrepareBombToBlow（:71785）置值后走爆炸圈=单一结算面。曾把爆炸伤当接触
    //   伤双重结算+穿体提前引爆。豁免表内型（手雷 30/397/517/588 等=投掷武器,
    //   接触伤=爆炸伤同源物品伤）照旧。fuse>3 门=引信≤3 的拍弹体已在 AI 内
    //   Kill（:48034）,Damage 不再跑。
    // SW-L1 2026-09-03 I-2：爆点前移对齐原版（同发射支）——AI 头 timeLeft<=3 →
    //   Kill（P.cs :48031-48035,先于尘段/重力/位移）→ Update 尾 timeLeft--
    //   （:17307）。post-dec ≤ 2 ≡ 原版 pre-tail-dec ≤ 3（180 引信=第 178 拍爆;
    //   曾 --fuse<=0=第 180 拍,+2）。接触段已移至本判后（原版 Damage :17184 晚于
    //   AI Kill 判——钳 3 的拍不爆、次拍爆 = 原版同拍）
    // IIII225：FTW×noTraps 引信加速（同 :5749 发射支——P.cs:48040-48045,门换算
    //   fuse>4 预减;cs AI_016 单函数对投掷/发射弹共用,本仓两衰减点同门）
    if (game.world.seedFlags?.getGoodWorld && game.world.seedFlags?.noTraps
      && !game.world.seedFlags?.tenthAnniversary && this.fuse > 4) this.fuse--;
    if (--this.fuse <= 2) {
      this.dead = true;
      this.destroy();
      this.onExplode(this.x + this.w / 2, this.y + this.h / 2, this.damage, this.vx, this.vy);
      // ★杀拍补跑（AI-Kill 拍湿段照跑,原版 :16903 无 active 门;wetSectionRan 防双跑）
      this.wetSectionKillStep(game);
      return;
    }
    // SW-P1 2026-09-03：1088 帧支（P.cs:48058-48063——【在】Kill 判（:48030-48037）
    //   的 else 链内（与 519 帧支 :47951 在 Kill 判之前的深度 1 位不同,见 SW-N1
    //   定谳注）→ 爆拍不跑帧支,故置于爆点判后;1088 首拍一次性选帧规则见
    //   acornSeedFrameInit。投掷支本仓无 1088 发生源（5629 弹弓走发射支）,支挂
    //   此处=原文位结构对齐）
    this.acornSeedFrame();
    if (BOMB_DAMAGE_KEEP_16.has(this.projId) && this.fuse > 3) {
      for (const ent of game.enemies()) {
        const e = ent as unknown as { x: number; y: number; w: number; h: number; dead?: boolean;
          hurt?: (d: number, kx: number, ky: number, g: unknown, pen?: number, crit?: boolean, pierce?: number, fp?: boolean) => boolean };
        if (e.dead) continue;
        if (this.x < e.x + e.w && this.x + this.w > e.x
          && this.y < e.y + e.h && this.y + this.h > e.y) {
          // 接触伤害同发射支（Damage_PVE 标准流程先于 aiStyle16 钳引信——曾只钳不结算
          // = 投掷炸弹穿体后爆,接触目标零伤,同火箭双症状）
          const dir = (e.x + e.w / 2) < this.x + this.w / 2 ? -1 : 1;
          // ★BJ489 def-3：投掷支接触环掷率同发射支——rollVanillaHitCrit 命中拍动态
          const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
          // ★R02（BJ723-B）：投掷支接触环同发射支接全管线（DV+旗+crit 防后 ×2）——
          // 焰爆石/拍击石双支（Projectile.cs:13439-13446）随标准 Damage_PVE 生效,
          // snap 加伤不进旗乘区
          const dmgVGrenadeThrow = damageVarRoll(this.damage,
            ((game.player as unknown as { luck?: number } | null)?.luck) ?? 0);
          const snapBonusGrenadeThrow = projectileSnapStrikeBonus(game, this,
            e.x + e.w / 2, e.y + e.h / 2, (e as unknown as { id?: number }).id ?? -1,
            { victimBox: { w: e.w, h: e.h, cx: e.x + e.w / 2, cy: e.y + e.h / 2 } });
          e.hurt?.(applyBannerDamageDealt(game, e, dmgVGrenadeThrow)
            + (snapBonusGrenadeThrow ? snapBonusGrenadeThrow : 0),
            dir * this.contactKb, 0, game, this.contactPen, crit, 0, true);
          this.fuse = Math.min(this.fuse, 3);
          break;
        }
      }
      // critters 桶同钳（Damage_PVE 全表遍历——碰小动物=弹体盒一击死+钳引信;
      // 与上方发射支接触段同语义,曾漏）
      if (this.fuse > 3) {
        for (const cent of game.critters?.() ?? []) {
          const c = cent as unknown as { x: number; y: number; w: number; h: number; dead?: boolean; hurt?: (g: unknown) => boolean };
          if (!c || c.dead) continue;
          if (this.x < c.x + c.w && this.x + this.w > c.x
            && this.y < c.y + c.h && this.y + c.h > c.y) {
            c.hurt?.(game);
            this.fuse = Math.min(this.fuse, 3);
            break;
          }
        }
      }
    }
    // SW-W1 2026-09-04：滚转自此处迁至重力门【后】（原版 :48400-48407 位,AI_016
    //   函数尾）——旧位在粘性扫描（:47821）前,两宗时序差:滚行拍读摩擦（:48382
    //   ×0.97）前的 vx 快 ~3%;贴附拍 scan 已清 vx（:47871）原版增量恰 0 而旧位
    //   仍吃扫描前 vx 多一次增量。粘性路/普通路各自 bombGravityStep 后重挂（同
    //   SW-W1 标记）;655=AI_025 走 ×0.06 专支（普通路重力门前,原位序不同）。
    // ---- 粘性族（AI_016 :44325-44390）：tileCollide=false 不碰块反弹；
    //      盒外扩 ±1..+2 格扫实心（跳过平台），4px 内缩重叠 → velocity=(0,-0.2) 贴附 ----
    if (STICKY_PROJ.has(this.projId)) {
      const x0 = Math.max(0, Math.floor(this.x / TILE) - 1);
      const x1 = Math.min(st.w, Math.floor((this.x + this.w) / TILE) + 2);
      const y0 = Math.max(0, Math.floor(this.y / TILE) - 1);
      const y1 = Math.min(st.h, Math.floor((this.y + this.h) / TILE) + 2);
      let stuck = false;
      for (let i = x0; i < x1 && !stuck; i++) {
        for (let j = y0; j < y1 && !stuck; j++) {
          // ★2026-09-01 取证对拍(vanilla AI_016_Bombs 粘性段 P.cs:47850-47873):
        //   条件矩阵 nactive+tileSolid+非solidTop、外扩左上-1右下+2、内缩4px 完全一致;
        //   原版不看 slope/halfBrick ⇒ 斜砖整格可粘 = 本实现已是 parity
        if (!st.inBounds(i, j) || !st.isActive(i, j) || !st.isSolid(i, j) || st.isPlatform(i, j)) continue;
          if (this.x + this.w - 4 > i * TILE && this.x + 4 < i * TILE + TILE
            && this.y + this.h - 4 > j * TILE && this.y + 4 < j * TILE + TILE) {
            stuck = true;
            // 911 首贴回退（:44364-44374）：与块中心距离 <12px → 沿速度反方向退 4px，
            // 随后 localAI[0]=1 不再触发（防止反复推挤穿墙）
            if (this.projId === 911 && !this.stuckOnce) {
              const tcx = i * TILE + 8, tcy = j * TILE + 8;
              if (Math.hypot(this.cx - tcx, this.cy - tcy) < 12) {
                const vl = Math.hypot(this.vx, this.vy);
                if (vl > 0) {
                  this.x -= (this.vx / vl) * 4;
                  this.y -= (this.vy / vl) * 4;
                }
              }
              this.stuckOnce = true;
            }
          }
        }
      }
      if (stuck) {
        this.vx = 0; this.vy = -0.2;                  // 贴附：抵消重力悬停（:44376-44377）
        // 773 甲虫炸弹贴附段（1458 P.cs:47869-47956;台账 C 批清偿——三段式真值尘 +
        // AngleLerp(0.2)/AngleTowards(0.05) 双档姿态）。num9 = DirectionTo(player)
        // .SafeNormalize(UnitX*direction).ToRotation()+π/2;vector2=(rot−π/2) 向量
        if (this.projId === 773) {
          const pc = game.player as unknown as { cx?: number; cy?: number };
          const dxp = (pc.cx ?? this.cx + 1) - this.cx, dyp = (pc.cy ?? this.cy) - this.cy;
          const dl = Math.hypot(dxp, dyp);
          const num9 = dl > 0 ? Math.atan2(dyp / dl, dxp / dl) + Math.PI / 2 : Math.PI / 2;
          const rotPrev = this.rot;
          {   // rotation.AngleLerp(num9,0.2) → AngleTowards(num9,0.05) 双连(:47883-47886;
              // Utils.cs:2174-2188——AngleTowards 按圆周最短路钳步快进收尾)
            let diff = ((num9 - this.rot) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
            this.rot += diff * 0.2;
            const wrapDiff = ((num9 - this.rot) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
            const stepN = Math.max(-0.05, Math.min(0.05, wrapDiff));
            this.rot += stepN;
          }
          const vecX = Math.cos(this.rot - Math.PI / 2), vecY = Math.sin(this.rot - Math.PI / 2);
          const circ25 = () => ({ x: (Math.random() * 2 - 1) * 0.25, y: (Math.random() * 2 - 1) * 0.25 });
          const placeAt = (d0: { x: number; y: number } | null | undefined,
            px: number, py: number): void => {           // NewDustPerfect ≈ spawn 后定点覆写
            if (!d0) return;
            d0.x = px; d0.y = py;
          };
          if (dl > 0 && Math.floor(Math.random() * 3) === 0) {
            const px = this.cx + vecX * 10, py = this.cy + vecY * 10;
            const d = game.spawnDust?.(px, py, 5, 5, 59, vecX * 2, vecY * 2, 0, null, 2);
            if (d) {
              placeAt(d, px, py);
              d.noGravity = true;
              if (Math.floor(Math.random() * 3) === 0) {
                const jx = circ25(), jy = circ25();
                d.vx = (vecX * 2 + jx.x) * 1.5; d.vy = (vecY * 2 + jy.y) * 1.5;
                d.noGravity = false; d.scale /= 2;
              } else {
                const jx = circ25(), jy = circ25();
                d.vx = vecX * 2 + jx.x; d.vy = vecY * 2 + jy.y;
              }
            }
          }
          if (dl > 0 && Math.floor(Math.random() * 3) === 0) {
            // 反侧贴附尘朝 GetScarabBombDigDirectionSnap8 八向(P.cs:71607-71621):
            // DirTo(player) 先行,X²倍幅大于 Y → Y=0 反之亦然,其余 ±1 组合
            const sxr = dxp > 0 ? -1 : 1, syr = dyp > 0 ? -1 : 1;   // (vector.X>0)?-1:+1——背向玩家
            let snapX = sxr, snapY = syr;
            if (Math.abs(dxp / (dl || 1)) > Math.abs(dyp / (dl || 1)) * 2) snapY = 0;
            else if (Math.abs(dyp / (dl || 1)) > Math.abs(dxp / (dl || 1)) * 2) snapX = 0;
            const px = this.cx - vecX * 10, py = this.cy - vecY * 10;
            const d = game.spawnDust?.(px, py, 5, 5, 59, snapX * 1.5, snapY * 1.5, 0, null, 2);
            if (d) { placeAt(d, px, py); d.noGravity = true; }
          }
          if (Math.floor(Math.random() * 15) === 0) {
            const px = this.cx + vecX * 10, py = this.cy + vecY * 10;
            const j = circ25();
            const d = game.spawnDust?.(px, py, 5, 5, 88, vecX * 3 + j.x, vecY * 3 + j.y, 0, null, 2);
            if (d) { placeAt(d, px, py); d.noGravity = true; }
          }
          {   // 七点椭圆环（:47936-47950）:rand30==0 或(转了向且 rand40==0)
            const changed = rotPrev !== this.rot;
            const flag2 = Math.floor(Math.random() * 30) === 0
              || (changed && Math.floor(Math.random() * 40) === 0);
            if (flag2) {
              const base = Math.random() * Math.PI * 2;
              for (let t = 0; t < 1; t += 1 / 7) {
                const a0 = t * Math.PI * 2 + base;
                let spX = Math.cos(a0), spY = Math.sin(a0) * 0.3;       // ×(1,0.3)
                const ca = Math.cos(num9), sa = Math.sin(num9);         // RotatedBy(num9)
                const rx = spX * ca - spY * sa, ry = spX * sa + spY * ca;
                const px = this.cx + rx + vecX * 8, py = this.cy + ry + vecY * 8;
                const d = game.spawnDust?.(px, py, 5, 5, 59, vecX * 3 + rx, vecY * 3 + ry);
                if (d) { placeAt(d, px, py); d.noGravity = true; d.fadeIn = 1.6; }
              }
            }
          }
          // SW-L1 2026-09-03 F2：773 帧推进（P.cs:47944-47949——贴附块尘段后,
          //   ++frameCounter≥3 → frameCounter=0、++frame 回绕 4（Main.cs:8777
          //   projFrames[773]=4）。与 519 的 bombFishFrameTick 双规则并存;仅贴附拍
          //   推进=原文本相（块在 if (flag && type==773) 支内,flag=粘性扫描命中））
          if (++this.frame773Counter >= 3) {
            this.frame773Counter = 0;
            this.frame773++;
            if (this.frame773 >= 4) this.frame773 = 0;
          }
        }
        // 911 推出（P.cs:47860-47888）：弹心所在格实心 → 沿（块心−弹心）反向退 4px。
        // ★取证对拍:WorldGen.SolidOrSlopedTile(W.cs:70515)=active+tileSolid+非solidTop+
        //   非致动,slope/halfBrick 不参与判定矩阵 ⇒ 本处 isSolid 即等价(parity)
        if (this.projId === 911) {
          const ptx = Math.floor(this.cx / TILE), pty = Math.floor(this.cy / TILE);
          if (st.inBounds(ptx, pty) && st.isSolid(ptx, pty)) {
            const dx = ptx * TILE + 8 - this.cx, dy = pty * TILE + 8 - this.cy;
            const dl = Math.hypot(dx, dy);
            if (dl > 0) {
              this.x -= (dx / dl) * 4;
              this.y -= (dy / dl) * 4;
            }
          }
        }
      }
      // SW-I1 2026-09-03：未贴住时的恒重力已移入下方 bombGravityStep（重力门
      //   :48377——粘性族同吃门：397 手雷族 >10、37/470/519/773/911/1087 >5;
      //   911 速度钳 ±8 亦在门支内 :48393-48396）。
      // SW-H1 2026-09-03：引信烟尘（:48048-48055/:48285-48322 在贴附扫描之后/
      //   重力门之前取速度——粘性路径贴附点=本 tick 速度终值,与原版尘段先于
      //   ai[0]++/重力门的序一致）
      this.fuseSmoke(game);
      // SW-I1 2026-09-03：重力门（贴附/未贴附两路同吃——原版门支在尘段后恒评估：
      //   贴附拍 scan 置 vy=−0.2 → 门开拍 +0.2 净 0 悬停;门未开拍保持 −0.2 上漂
      //   =原文本相）
      this.bombGravityStep();
      // SW-W1 2026-09-04：AI_016 尾段滚转（:48400-48407,粘性路）——门【后】:
      //   贴附拍 scan 置 vx=0 → 增量恰 0;滚行/飞行拍读门后 vx（门未开拍原版
      //   rotation 同样恒跑,故置 bombGravityStep 早退之外）。STICKY_PROJ 全员
      //   AI_016 滚转档（134/303/338-341/776-810/930 atan2 族不入粘性集）。
      this.rot += this.vx * (this.projId === 519 ? 0.06 : 0.1);
      // ★通用湿段·活拍（:16903-17113——粘性路 AI 链尾/位移前 = 原版 post-AI 同位;
      //  域注见字段块）
      this.wetSectionStep(game);
      // ★粘性族湿位移（R3 拍序批更正）：粘性族 tileCollide=false（37 :845/397 :1359/
      //  470 :5439/519 :5892/911 :8367 系/773 :7908/1087 :10142）→ HandleMovement 湿
      //  阻尼块 :17721 整体在 if(tileCollide) 内【不跑】——旧 ×dragS 直积=阻尼误植。
      //  原文本相 = UpdatePosition :20555-20562：wet → position += wetVelocity（AI 前
      //  快照 preVx/preVy,无阻尼——贴附拍 scan 置 (0,−0.2),湿位移仍走快照 = 滞后一
      //  子步 quirk 本体）;dry → position += velocity（post-AI）
      if (this.wet) { this.x += preVx; this.y += preVy; }
      else { this.x += this.vx; this.y += this.vy; }
      if (!st.inBounds(Math.floor(this.cx / TILE), Math.floor(this.cy / TILE))) { this.dead = true; this.destroy(); }
      return;
    }
    // ---- 普通族物理：重力 0.2（:44897）+ AABB 碰撞 + 反弹 ----
    // ★2026-08-17 重写:旧版只查中心右/底两个点(nx+w/2)——朝左飞可整弹嵌墙
    // (左缘永远不检测)、落地判定也只在下半格命中时才生效。改用 moveAndCollide
    // 全 AABB 碰撞(四缘+步进),碰后按原版 :18339-18357 反弹/摩擦。
    // SW-H1 2026-09-03：引信烟尘（:48048-48055/:48285-48322 在 AI 段重力门
    //   （:48377）之前取速度——普通路径（1086 非 STICKY 落此）插在门步进前=原版同序）
    this.fuseSmoke(game);
    // SW-W1 2026-09-04：655 蜂巢 AI_025 滚转（:26679-26682 `if (type != 1055)
    //   rotation += velocity.X * 0.06f`,位=墙推支后/clamp+重力前——与 AI_016 的
    //   门后位相反）——曾混入 AI_016 通支读 ×0.1（系数错+位序错,见上方迁址注）。
    // SW-AD1 2026-09-04：655 蜂巢墙推支（AI_025 :26595-26678,SW-W1 备案清偿）——
    //   贴地/上升（vy<=0,=上拍碰撞后残差/反弹终值,与原版 AI 读上拍碰撞后 velocity
    //   同相）且 vx==0 且非首 AI 拍（ai[0]!=0:首拍 ai[0]==0 跳过、:26682 尾写 1,
    //   本仓 ai0 计数同相 SW-I1）→ 三档扫墙 ±0.5 推离 / 全空按 Center 格奇偶定向
    //   （beeWallPushDir）。★此支同时是 vx==0 蜂巢落地起滚的唯一起因：无它则直上
    //   直落的蜂巢永驻原地（X 自加速开区间门 `vx>0&&vx<7` 对 0 不可达,SW-X1 注）；
    //   起滚后 |vx|≥0.5 → 门不再开 → 原文恒等价（每拍重定向仅 vx==0 时发生）。
    //   位序=原文:墙推(:26595)→滚转(:26679)→ai[0]=1(:26682)→钳16(:26683)→
    //   X 自加速(:26694)→重力(:26738)——本支置滚转前即原位。
    if (this.projId === 655 && this.ai0 !== 0 && this.vy <= 0 && this.vx === 0) {
      this.vx = beeWallPushDir(st, this.x, this.y, this.w, this.cx);
    }
    if (this.projId === 655) this.rot += this.vx * 0.06;
    // SW-I1 2026-09-03：重力门（:48332 ai[0]++ → :48377）——炸弹族 ai[0]>5、
    //   手雷族 >10 前零重力（出手直飞）;门值/摩擦/911 钳在 bombGravityStep。
    //   655 蜂巢（AI_025）无门恒重力（函数返 null 分支）
    //   SW-L1 2026-09-03 I-1：摩擦【只在】此步进内（原版唯一摩擦点 :48377-48385），
    //   下方落地支不再复乘——返回值（门是否已开）无消费面,不再接
    this.bombGravityStep();
    // SW-W1 2026-09-04：AI_016 尾段滚转（:48400-48407,普通路）——重力门【后】,
    //   滚行拍吃 ×0.97 后 vx（:48382 摩擦→:48406 滚转）;519 专属 ×0.06（:48402）。
    //   655=AI_025 不入此支（上方 ×0.06 专支）。
    if (this.projId !== 655) this.rot += this.vx * (this.projId === 519 ? 0.06 : 0.1);
    // SW-X1 2026-09-04（L-1②）：AI_025 入水 Kill（:26752-26760 `if (AnyWet &&
    //   netMode != 1) { ... else if (wet && type == 655) Kill(); }`,位 = 重力段后/
    //   位移前;单机 netMode 0 恒过门,AnyWet∧wet ≡ wet）。wet = WetCollision 真值
    //   （任一液体含岩浆/蜂蜜,Projectile.cs:16902/:16906 赋值）——Kill wet 分支落
    //   蜂巢块 1124×Next(2,6)（:76626-76628）,干侧裂蜂。曾整缺 → 水中蜂巢不裂。
    if (this.projId === 655) {
      // ★R2 P2-4（2026-09-07）：原文本读【湿段维护旗】非当拍直探——AI(:16880) 在子步
      //  内先于湿段(:16903)跑,读到的是上一子步采样 wet(P_{k-1})（NewProjectile
      //  :10886-10892 出生预置为初值）。本仓湿段在各路位移位前（下方 wetSectionStep,
      //  同原版 post-AI 位）→ 此位读 this.wet = 上拍湿段采样 ≙ 原版同相。旧
      //  wetCollision 当拍直探（先行批实现,登记双轨）读当拍位=较原版早 1 拍入水爆,
      //  且绕过湿段旗维护（出生预置/ignoreWater 反清/!wet 三清链）——退役收编。
      if (this.wet) { this.killBeehive(game, this.vx, this.vy); return; }
    }
    // ★通用湿段·活拍（:16903-17113——普通/蜂巢路 AI 链尾/位移前 = 原版 post-AI
    //  同位;域注见字段块。655 入液 Kill 在此位之前读上拍湿段旗 = 原版 AI 读上子步
    //  旗同相,R2 P2-4 收编）
    this.wetSectionStep(game);
    const lastVx = this.vx, lastVy = this.vy;
    const bodyY0 = this.y;   // SW-N1：本拍积分前 y（软着陆钳速残差 = body.y − bodyY0）
    // SW-AQ1 2026-09-05：oldPosition 上报（Update :17118 同位序,655 蜂巢支）——
    //  655 ∈ OBJTYPE3 白名单（:17195）,objType 3 扫描同消费新旧位判定
    this.oldX = this.x; this.oldY = this.y;
    // ★水中位移阻尼（HandleMovement :17721-17764,湿段批）——同 firedStep 位注：
    //  阻尼只进位移入参,b.vx/vy=碰撞调整字段采纳处不动
    const drag = this.wetDragFactor();
    const body = {
      x: this.x, y: this.y, w: this.w, h: this.h,
      vx: this.vx, vy: this.vy,
      onGround: false, hitWall: false, hitHead: false,
      hoik: true,   // ★FX34c 弹幕域 hoik=true（Body.hoik 注:原版 Projectile 全路径）
      stepUp: false, dropThrough: false, stepDownGate: 'gravity' as const,
    };
    moveAndCollide(body, game.world, this.vx * drag, this.vy * drag);
    // 655 蜂巢专属（:19379-19391,旧注 :17856 系 Update 位移段误标）：Y 反弹门
    //   `velocity.Y != lastVelocity.Y && lastVelocity.Y > 5f` → HitTiles+音 0+
    //   vy=lastVy×-0.2（只弹不杀）;X 变化（撞墙）→ Kill 裂蜂。
    //   SW-W1 2026-09-04 两修:① Y 钳未达反弹门时原版不写 vy=TileCollision 终值
    //   （钳速残差存活,与 SW-N1 软着陆/AI_016 通支同构）——旧软着陆支 vy=0、顶撞
    //   支整缺（vy 保持反弹负值 → 贴顶悬挂数拍）,均改残差回写 body.y-bodyY0
    //   （ε 间隙效应由贴面吸附吸收,论证见下方 hitHead 支）;② 软着陆支旧 early-
    //   return 跳过 hitWall 判 → 落地同拍蹭墙漏 Kill,归并后序对齐原文（先 Y 后 X）。
    if (this.projId === 655) {
      if (body.onGround && lastVy > 5) {
        // SW-X1 2026-09-04（L-1③）：反弹同拍 Collision.HitTiles + 音 0（:19382-19385,
        //  vanilla 序 = HitTiles/音先于 vy 覆写,velocity = 覆写前值;音 0 = legacy Dig
        //  家族 → 'dig'）——曾缺 = 反弹无砖屑无声。
        game.hitTilesFx?.(body.x, body.y, this.w, this.h, this.vx, this.vy);
        game.playSfx?.('dig', 1, body.x + this.w / 2, body.y + this.h / 2);
        this.vy = -lastVy * 0.2;
      }
      else if (body.hitHead || body.onGround) this.vy = body.y - bodyY0;
      this.x = body.x;
      this.y = body.y;
      if (body.hitWall) this.killBeehive(game, lastVx, lastVy);
      return;
    }
    // 碰墙反弹（:19870-19876）：vx = lastVx × -0.4；
    // SW-N1 2026-09-03：×0.8 衰减族收窄——原版仅 type 29（:19872-19875;1456
    //   :18351-18356 同),470/637 无此档（旧 DYN_PROJ 整族 ×0.8=近似）。470
    //   tileCollide=false（:5448-5456）不进本支;637 tileCollide=true 原版不衰减
    if (body.hitWall) {
      // ★BJ252 弹力族（516/517/637——:18591-18600 型别支先于 aiStyle 16 ×−0.4
      //  截走;投掷路=3115/3116/3547 消耗品唯一通路）：|lastX|>1 → ×−0.9。
      if (BOUNCY_PROJS.has(this.projId)) {
        if (Math.abs(lastVx) > 1) this.vx = lastVx * -0.9;            // :18593-18595
        else this.vx = body.vx;   // 门内不写=保持管线钳后值（截停轴零速）
      } else {
        this.vx = lastVx * -0.4;
        if (this.projId === 29) this.vx *= 0.8;
      }
    } else {
      this.vx = body.vx;   // 碰撞调整字段原样回读（阻尼只进位移入参,湿段批位注）
    }
    // 落地反弹/贴地滚动（:19877-19886 + :44888-44895）：
    // lastVy>0.7（且 type≠102）→ vy = lastVy × -0.4（仅 29 再 ×0.8）；
    // ★SW-L1 2026-09-03 I-1：此处【无摩擦】——原版唯一摩擦点在 AI 重力门支
    //   （:48377-48385 vy==0&&vx!=0 → ×0.97/炸药棍 ×0.99,已在 bombGravityStep），
    //   碰撞响应支（:19855-19868）只反不磨。曾在此再乘一次 → 休止拍 0.97²（炸药棍
    //   0.97²·0.99²）双重叠加,滚行距离近半（红队二轮 I-1 实锤）
    // SW-N1 2026-09-03：① Y 反弹补 type≠102 排除（:19878 逐字;102 走专属实体,
    //   本支纯守面）;② ×0.8 收窄至 29（同上,X 支注）;③ 软着陆（lastVy≤0.7）保留
    //   钳速残差 = body.y−bodyY0（本拍实际位移）：原版 TileCollision 只回钳速度
    //   （:2306-2452 返回值即新速度,不写位）,响应支 lastVy≤0.7 不写 vy → 残差
    //   存活到下拍 → 下拍 AI vy==0 门【假】（settle 拍无摩擦,摩擦序列晚 1 拍启动,
    //   再下拍起休止态每拍恰一次 ×0.97）。旧 `vy=0` 强制吞残差 → 摩擦提前 1 拍
    //   （本 debt 相位差本体）。残差=0（休止稳态/贴面出生）时两版同值。
    if (body.hitHead) {
      // SW-W1 2026-09-04：撞顶残差回写（=本拍位移,负值）——原版 TileCollision 撞顶
      //   返「到贴面距+ε0.01」（Collision.cs:2451 gravDir==1 支）,残差存活到下拍:
      //   下拍 AI 门 vy≠0 无摩擦、贴面复读归零 → 摩擦第 3 拍起（vanilla 相位）。
      //   旧 vy=0 → 次拍门假 vy==0 摩擦提前 1 拍（SW-N1 备案复核翻案）。
      //   ★ε 本体仍不字面接入,且理由升级:本仓 moveAndCollide 贴面吸附
      //   （physics/TileCollision.ts:307 b.y=bestTop 零间隙+b.vy=0）已把 ε 的
      //   间隙效应结构化吸收——原版 ε 造 0.01px 间隙恰是为了让下拍复读返回
      //   恰 0（-(0.01)+0.01=0,vanilla 摩擦第 3 拍恢复）,本仓贴面起拍位移恒 0
      //   同值;若在此字面 +0.01,下拍残差=0+0.01≠0 → 门恒假,飞行期摩擦整段
      //   缺失直到下次落地（破坏相位,非 1 拍瞬态）。位置差 ≤0.01px 无消费面。
      this.vy = body.y - bodyY0;
    } else if (body.onGround) {
      // ★BJ252 弹力族 Y 臂（:18597-18600,|lastY|>1 → ×−0.9 先于 aiStyle 16 ×−0.4）；
      //  门内不写=落地软档保持管线钳后残差（与下方 lastVy≤0.7 残差回写同语义）
      if (BOUNCY_PROJS.has(this.projId)) {
        if (Math.abs(lastVy) > 1) this.vy = lastVy * -0.9;
        else this.vy = body.y - bodyY0;
      } else if (lastVy > 0.7 && this.projId !== 102) {
        this.vy = lastVy * -0.4;
        if (this.projId === 29) this.vy *= 0.8;
      } else {
        this.vy = body.y - bodyY0;
      }
    } else {
      this.vy = body.vy;   // 碰撞调整字段原样回读（阻尼只进位移入参,湿段批位注）
    }
    this.x = body.x;
    this.y = body.y;
    if (!st.inBounds(Math.floor(this.cx / TILE), Math.floor(this.cy / TILE))) { this.dead = true; this.destroy(); return; }
    // CutTiles 同发射支（friendly+damage>0 沿路径切割——投掷炸弹滚过草/藤同样断）
    game.cutTile(Math.floor(this.cx / TILE), Math.floor(this.cy / TILE));
  }
}

// ================= 荧光棒族（aiStyle 14，AI_014 + 碰撞反弹表 Projectile.cs:23482-23500/18261-18333） =================

/** 荧光棒物理 1:1：
 *  AI_014 主体（cs:23482-23500）：ai0++ >5 钳位；着地（本帧 vy 未变且 vx≠0）滚动摩擦
 *  vx×0.97（<0.01 归零）；重力 vy+=0.2；rotation += vx×0.1
 *  粘性（proj 53，tileCollide=false，cs:23245-23296）：与实心块重叠 → velocity=(0,-0.2)
 *  抵消重力 → 停在原位粘住
 *  妖精（proj 870）：首次碰墙全反射 → aiStyle 170（cs:42997-43053）：半径 10 实心排斥
 *  场（速度>1 时每 10 tick 重算）+ 速度 ×0.95 衰减、<1 归零
 *  碰撞反弹表（cs:18261-18333，碰墙后）：
 *    50      X→-0.2×；Y（lastV>1.5）→-0.2×
 *    ≥1089   彩虹：X→-0.99×（|Δ|<1 → ±1）；Y→-0.99×（0<lastV<1 → -1）——近似永动
 *    其余    473/515：X→-0.5×；Y（lastV>1）→-0.5×
 *  寿命：timeLeft×5（=9000，cs:1075）；矿工 473 ×2（=3600）。到期消失无掉落 */
/** ★BJ236：1089 Disco 乘色离屏缓存（键=rgb 8bit 三元组;行为契约见
 *  GlowstickProj.discoTint 方法注） */
const discoTintCache = new Map<string, CanvasImageSource | null>();

export class GlowstickProj extends Entity {
  w: number; h: number;
  vx: number;
  vy: number;
  projId: number;
  dead = false;
  /** 原版 timeLeft（proj 50/53/515/870/1089 = 9000；473 = 3600） */
  timeLeft: number;
  private ai0 = 0;
  private rot = 0;
  /** 妖精阶段（870 反弹后） */
  private fairy = false;
  private fairyT = 0;
  // ---- ★通用湿段（Projectile.cs:16903-17113;2026-09-06 R3 漏网类批 11 类之一）----
  //  域 id 集 = {50(:1329)/53(:1357)/515(:5854)/870(:8346)/1089(:10156)/473(:5488)}
  //  ——SetDefaults 各块均无 ignoreWater 行（缺省 false :763;与 PROJ_IGNORE_WATER
  //  零交集）→ 全员受段。
  //  ★位序定谳：AI_014（:23482-23500）/AI_170（:42997-43053）/53 粘性扫描全程只写
  //  velocity/rotation 不写 position → 湿段测位 = 上拍位移后位 = 本拍位移前位;本仓
  //  AI 与位移连排（类结构无法拆）→ 插 fixedUpdate 头（timeLeft Kill 判前——原版
  //  timeLeft Kill 在子步【尾】 :17307,寿命尽拍湿段照跑,头插位等价覆盖杀拍）。
  //  类注记：本类 AI 无湿旗消费者 → tick 头插位无同拍旗读问题（projWetSection.ts
  //  文件头"tick 头调用"豁免条款）。
  //  ★阻尼：主移动支 tileCollide=true（除 53 外均缺省 true）→ 湿阻尼适用（位移入参）;
  //  53 tileCollide=false（:1357 显式）→ 阻尼块不跑,湿位移 = UpdatePosition :20555
  //  wet → position += wetVelocity（AI 前快照,滞后一子步 quirk——53 粘性积分支实现）;
  //  870 妖精态本仓为裸直积近似（无 TileCollision,先行批形态）→ 阻尼因子乘入位移
  //  承载湿面（TileCollision 缺席为登记既有形态,不在本批范围）。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价——首拍 AI 写位前同位测值） */
  presetDone = false;   // ProjWetFlags.presetDone（共享湿段旗持有者）
  /** ★BJ235 1089 彩虹荧光棒 oldPos 环（TrailingMode[1089]=0/cap 25 表驱动）——
   *  家族余型（50/53/515/870/473）mode=-1 → null 短路。绘制面=Main.cs:33270-33306
   *  MagicPixel 段带链（drawRainbowChain,本体后）。 */
  private ghostRing?: ProjGhostRing | null;

  constructor(x: number, y: number, vx: number, vy: number, projId: number) {
    super();
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.projId = projId;
    this.w = projId === 473 ? 8 : 6;
    this.h = this.w;
    this.timeLeft = projId === 473 ? 3600 : 9000;
  }

  /** ★BJ236：1089 灰阶贴图 × Disco 基色乘色缓存（multiply 上色 + destination-in
   *  回贴 α 蒙版,键=基色 rgb 8bit 三元组）——Disco 一循环 222 态,缓存峰值
   *  222 张 22×6 帧可忽略,超 512 全清防 exotic 基色源膨胀。null=创建失败缓存
   *  （无 DOM 环境恒 null → draw 走 'lighter' 回退档）。测试可经 discoTintOverride
   *  注入假乘面（node 环境无 document,默认实现不可直测）。 */
  static discoTintOverride:
    | ((img: CanvasImageSource, rgb: readonly [number, number, number]) => CanvasImageSource | null)
    | null = null;

  private static discoTint(
    img: CanvasImageSource, rgb: readonly [number, number, number],
  ): CanvasImageSource | null {
    if (GlowstickProj.discoTintOverride) return GlowstickProj.discoTintOverride(img, rgb);
    const r8 = Math.round(rgb[0] * 255), g8 = Math.round(rgb[1] * 255), b8 = Math.round(rgb[2] * 255);
    const key = `${r8},${g8},${b8}`;
    if (discoTintCache.has(key)) return discoTintCache.get(key) ?? null;
    let out: CanvasImageSource | null = null;
    try {
      if (typeof document === 'undefined') return null;
      const srcW = (img as { width: number }).width;
      const srcH = (img as { height: number }).height;
      if (!(srcW > 0 && srcH > 0)) return null;
      const c = document.createElement('canvas');
      c.width = srcW;
      c.height = srcH;
      const cc = c.getContext('2d');
      if (!cc) return null;
      cc.drawImage(img, 0, 0);
      cc.globalCompositeOperation = 'multiply';
      cc.fillStyle = `rgb(${r8},${g8},${b8})`;
      cc.fillRect(0, 0, srcW, srcH);
      cc.globalCompositeOperation = 'destination-in';
      cc.drawImage(img, 0, 0);
      out = c;
    } catch {
      out = null;
    }
    if (discoTintCache.size > 512) discoTintCache.clear();
    discoTintCache.set(key, out);
    return out;
  }

  draw(r: Renderer, _cam: Camera): void {
    // 原版投射物绘制尺寸 = 贴图原生尺寸 × scale（碰撞盒 6×6 与绘制解耦）——
    // 50/53/515/1089 贴图是 22×6 横条（此前按碰撞盒 6px 画成 1.6px 细丝）；
    // 870 妖精 = 18×96 纵条 6 帧（帧进 5t）；473 = 18×18 单帧
    const ctx = r.ctx;
    if (!ctx) return;
    const img = projSprite(this.projId);
    ctx.save();
    ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
    ctx.rotate(this.rot);
    ctx.imageSmoothingEnabled = false;
    // ★BJ228 普查批（2026-09-21）：GetAlpha 加算白接线——
    //  50/53/515/870：GetAlpha :81020-81022 恒 (255,255,255,0)=A=0 预乘纯加算白
    //  （荧光棒原版观感=发光体,暗轮廓像素加算贡献 0）——'lighter' 直译;
    //  473 不动：:81168-81170 Color.White=常规合成满亮（与缺省 α≡0 同值,零差）。
    //  ★BJ236（2026-09-21）1089 基色相位 1:1 化：GetAlpha :80987-80989
    //  (DiscoR,DiscoG,DiscoB,70)——基色=Main.Disco（DoUpdate_AnimateDiscoRGB
    //  :19774-19822,6 相 ×步 7/update 起步 R255/B0/G0）。本仓同源钟 =
    //  FlickerClock.discoColor()（lighting/SkyColor.ts 6 相 switch 逐值 1:1,
    //  torch disco/拾取名 −12 档同钟消费）,经 r.lighting.clock 直读——
    //  替换 BJ228 旧 hue-rotate 周期近似（灰阶贴图上 hue-rotate/saturate 恒恒等
    //  =旧近似实际零观感,色相循环从未上屏）。乘色 = 离屏 multiply+destination-in
    //  （贴图 Projectile_1089.png 全灰阶 82/97/214/255 → 逐通道×Disco 即原版
    //  GetAlpha 调制;destination-in 回贴 α 蒙版）,按基色 rgb 缓存（Disco 一循环
    //  222 态）。合成 = AlphaBlend source-over ×(70/255)=BlendState.AlphaBlend
    //  （Main.cs DrawProjectiles 批头）直译,替换旧 'lighter'（1089 是 A=70 非
    //  A=0 族,加算是偏离）;无钟/无 DOM 环境回退旧 'lighter' 档（登记等价面）。
    let drawSrc: CanvasImageSource | null = img;
    if (this.projId === 50 || this.projId === 53 || this.projId === 515 || this.projId === 870) {
      ctx.globalCompositeOperation = 'lighter';
    } else if (this.projId === 1089) {
      ctx.globalAlpha = 70 / 255;
      const d = r.lighting?.clock?.discoColor();
      const tinted = d && img && img.width > 0 ? GlowstickProj.discoTint(img, d) : null;
      if (tinted) {
        drawSrc = tinted;
      } else {
        ctx.globalCompositeOperation = 'lighter';   // 回退=BJ228 旧档（无基色乘面）
      }
    }
    if (img && (img.width > 0) && img.width > 0) {
      if (this.projId === 870) {
        const fr = Math.floor(this.fairyT / 5) % 6;
        ctx.drawImage(img, 0, fr * 16, 18, 16, -9, -8, 18, 16);
      } else if (drawSrc) {
        ctx.drawImage(drawSrc, -img.width / 2, -img.height / 2);
      }
    } else {
      // 无贴图兜底矩形（1089 有钟时随基色——原版无贴图不存在,纯容错面）
      const d1089 = this.projId === 1089 ? r.lighting?.clock?.discoColor() : null;
      ctx.fillStyle = d1089
        ? `rgb(${Math.round(d1089[0] * 255)},${Math.round(d1089[1] * 255)},${Math.round(d1089[2] * 255)})`
        : '#7FE8A8';
      ctx.fillRect(-3, -3, 6, 6);
    }
    ctx.restore();
    // ---- ★BJ235 1089 彩虹荧光棒链（Main.cs:33270-33306;原版本体段【后】画=压顶）——
    //      MagicPixel 段带 ×4.4 宽、色=(DiscoR,DiscoG,DiscoB) A=127、新端 i≤10 逐槽
    //      −0.1 + 老端 13 槽 1/13 爬坡。Disco 基色与 BJ236 本体乘色同钟（discoColor
    //      0-1 → ×255 转 8bit 域）;无钟回退黑=原版 Disco 未动档。 ----
    if (this.projId === 1089 && this.ghostRing && this.ghostRing.filled > 1) {
      const d = r.lighting?.clock?.discoColor();
      const rgb: [number, number, number] = d
        ? [Math.round(d[0] * 255), Math.round(d[1] * 255), Math.round(d[2] * 255)]
        : [0, 0, 0];
      drawRainbowChain(ctx, this.ghostRing, rgb, this.w, this.h);
    }
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    // :16870 wetVelocity 快照（AI 前——53 粘性湿位移消费,见下 53 积分支）
    const preVx = this.vx, preVy = this.vy;
    // ---- 通用湿段（:16903-17113,projWetSection 共享体——tick 头插位定谳见字段块;
    //      置于 timeLeft Kill 判前 = 寿命尽杀拍湿段照跑,原版同效）----
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater);
    if (--this.timeLeft <= 0) { this.dead = true; return; }
    const st = game.world.store;
    // (旧 solidAt 点采样助手已随管线化退役——53 粘性/主移动/妖精斥力各自改走
    //  正典管线或显式 nactive 扫描)
    if (this.fairy) {
      // AI_170_FairyGlowstick（cs:42997-43053）：排斥场 + 衰减
      this.fairyT++;
      if (this.fairyT % 10 === 0 && Math.hypot(this.vx, this.vy) > 1) {
        const ptx = Math.floor((this.x + this.w / 2) / TILE), pty = Math.floor((this.y + this.h / 2) / TILE);
        let zx = 0, zy = 0, n = 0;
        for (let i = ptx - 10; i <= ptx + 10; i++) {
          for (let j = pty - 10; j <= pty + 10; j++) {
            if (!st.inBounds(i, j) || !st.isSolid(i, j)) continue;
            const dx = ptx - i, dy = pty - j;
            const len = Math.hypot(dx, dy) || 1;
            const f = Math.max(10 - len, 0) / len * 3;
            zx += dx * f; zy += dy * f; n++;
          }
        }
        if (n > 0) { zx /= n; zy /= n; }
        if (Math.hypot(zx, zy) > 1) { this.vx = zx; this.vy = zy; }
      }
      this.vx *= 0.95; this.vy *= 0.95;
      if (Math.hypot(this.vx, this.vy) < 1) { this.vx = 0; this.vy = 0; }
      // ★水中位移阻尼（HandleMovement :17721-17764——湿阻尼因子乘入位移;TileCollision
      //  缺席为妖精态裸直积既有形态,登记）
      const dragFa = projWaterDragFactor(this);
      this.x += this.vx * dragFa; this.y += this.vy * dragFa;
      return;
    }
    // AI_014 主体
    this.ai0++;
    if (this.ai0 > 5) {
      this.ai0 = 5;
      // 着地判定用上一帧 vy 是否未变（原版 velocity.Y == 0 即已落地）——落地格 vy 被置 0
      if (this.vy === 0 && this.vx !== 0) {
        this.vx *= 0.97;
        if (Math.abs(this.vx) < 0.01) this.vx = 0;
      }
      this.vy += 0.2;
    }
    this.rot += this.vx * 0.1;
    // 粘性（53）：tileCollide=false，盒外扩(−1/+2)扫实心、【无内缩】完整包围盒重叠
    // → 粘住（vanilla StickyGlowstick 段 @25215-25250 同款:条件 nactive+tileSolid+
    //   非 solidTop;斜砖/半砖整格计——残余债清偿对齐原版矩阵）。黏后速度 (0,-0.2)
    if (this.projId === 53) {
      const x0s = Math.max(0, Math.floor(this.x / TILE) - 1);
      const x1s = Math.min(st.w - 1, Math.floor((this.x + this.w) / TILE) + 2);
      const y0s = Math.max(0, Math.floor(this.y / TILE) - 1);
      const y1s = Math.min(st.h - 1, Math.floor((this.y + this.h) / TILE) + 2);
      let stuck = false;
      for (let i = x0s; i <= x1s && !stuck; i++) {
        for (let j = y0s; j <= y1s && !stuck; j++) {
          if (!st.isActive(i, j) || !st.isSolid(i, j)) continue;   // isActive=nactive 口径
          if (this.x + this.w > i * TILE && this.x < i * TILE + TILE
            && this.y + this.h > j * TILE && this.y < j * TILE + TILE) stuck = true;
        }
      }
      if (stuck) { this.vx = 0; this.vy = -0.2; return; }
      // 53 湿位移（UpdatePosition :20555-20562）：tileCollide=false（:1357）→ 湿阻尼
      // 块不跑,wet → position += wetVelocity（AI 前快照 preVx/preVy,无阻尼——粘附拍
      // scan 置 (0,−0.2),湿位移仍走快照 = 滞后一子步 quirk 本体）;dry → post-AI 速度
      if (this.wet) { this.x += preVx; this.y += preVy; }
      else { this.x += this.vx; this.y += this.vy; }
      return;
    }
    // 移动 + 碰撞反弹（反弹表 cs:18261-18333）
    // ★残余债清偿(2026-09-01):点采样改正典管线(half 下半/坡面对角/平台 fallThrough),
    // 反射表逐型数值不变;hitX/hitY 由管线旗标驱动
    // ★水中位移阻尼（HandleMovement :17721-17764,tileCollide=true 适用）——速度场
    //  不减只削当拍位移;反射式读未阻尼 lastV（原版同构）
    const lastVx = this.vx, lastVy = this.vy;
    const dragGl = projWaterDragFactor(this);
    const body = {
      x: this.x, y: this.y, w: this.w, h: this.h,
      vx: this.vx, vy: this.vy,
      onGround: false, hitWall: false, hitHead: false, collideY: false,
      hoik: true,   // ★FX34c 弹幕域 hoik=true（Body.hoik 注:原版 Projectile 全路径）
      tileCollide: true, dropThrough: true,
    };
    moveAndCollide(body, game.world, this.vx * dragGl, this.vy * dragGl);
    const hitX = body.hitWall, hitY = body.collideY || body.onGround || body.hitHead;
    const nx = body.x, ny = body.y;
    if (hitX || hitY) {
      if (this.projId === 870) {
        // 妖精首次反弹：全反射进入 170 阶段（cs:18270-18276）
        this.vx = -lastVx; this.vy = -lastVy;
        this.fairy = true;
        this.fairyT = 0;
        this.rot = 0;
        return;
      }
      if (this.projId === 50) {
        if (hitX) this.vx = lastVx * -0.2;
        if (hitY) this.vy = lastVy > 1.5 ? lastVy * -0.2 : 0;
      } else if (this.projId >= 1089) {
        // 彩虹（1458 P.cs:19798-19821;1456 同段 :18279-18299,台账 B⑤ 清偿）：
        //   X:v = −lastV×0.99;引擎拦轴先置 0 → |Δv|=|lastV|,<1（缓移贴墙）时改定速
        //   ±1——符号按【翻转后的新速度】取(旧实现用翻转前符号=推回墙内);
        //   Y:v = −lastV×0.99;特档 lastVy∈(0,1) 缓降触撞 → 定值 −1 上弹（防贴底蠕动,
        //   旧实现缺该档）。
        //   本仓 hitX/hitY 为旗标探测语义,v 拦轴尚未置零 → |Δv| 以 |lastV| 等价承载
        if (hitX) {
          const nvx = -lastVx * 0.99;
          this.vx = Math.abs(lastVx) < 1 ? (nvx < 0 ? -1 : 1) : nvx;
        }
        if (hitY) {
          const nvy = -lastVy * 0.99;
          this.vy = (lastVy > 0 && lastVy < 1) ? -1
            : Math.abs(lastVy) < 1 ? (nvy < 0 ? -1 : 1) : nvy;
        }
      } else if (BOUNCY_PROJS.has(this.projId)) {
        // ★BJ252 515 弹力荧光棒（HandleMovement :18591-18600 型别支——先于 aiStyle 14
        //  通用反弹（:19851-19858 ×−0.5）截走,曾误走默认档=×−0.5 弹性错档）：
        //  X 撞 |lastX|>1 → ×−0.9;Y 撞 |lastY|>1 → ×−0.9;门内不写=截停轴保持
        //  钳后零速（原版 velocity 已被 TileCollision 截断,支内不再写——本类无
        //  采纳面 → 显式置 0 同语义）。无计数/无消亡（寿命=5×timeLeft 承载）。
        if (hitX) this.vx = Math.abs(lastVx) > 1 ? lastVx * -0.9 : 0;
        if (hitY) this.vy = Math.abs(lastVy) > 1 ? lastVy * -0.9 : 0;
      } else {
        // 473 矿工（默认档，1457 :19851-19858）
        if (hitX) this.vx = lastVx * -0.5;
        if (hitY) this.vy = lastVy > 1 ? lastVy * -0.5 : 0;
      }
    }
    if (this.vy > 16) this.vy = 16;   // 原版落端钳制（P.cs:25623-25626 终速 16f）
    this.x = nx; this.y = ny;
    // ★BJ235 残影记录（UpdateTrails :17198 位移/Damage 后同序;无记录式 id 环=null 短路——
    //  妖精/53 粘性早退支不入=该两 id mode -1 本就短路,1089 恒走主路径到尾）
    if (this.ghostRing === undefined) {
      this.ghostRing = projTrailingMode(this.projId) >= 0 ? new ProjGhostRing(this.projId) : null;
    }
    this.ghostRing?.record(this.x, this.y, this.rot, this.vx < 0 ? -1 : 1, true);
  }
}

// ================= 净化粉/邪恶粉云（proj 10/11/463，aiStyle 6，cs:22399-22533） =================

/** 粉末云 1:1（SetDefaults cs:637-662：64×64 命中盒、tileCollide=false、penetrate=-1、
 *  alpha=255 本体不可见——视觉全靠尘粒；AI_006 cs:22399-22533：速度 ×0.95 衰减、
 *  寿命 180 tick、首 tick 30 粒尘、每 tick 命中盒内逐格 Convert + Damage_TryUsingPowders
 *  （:13646）NPC 转化。tile/NPC 实效经 GameHooks.applyPowder 回调——实体层不触
 *  World/实体桶，与 cutTile/breakTile 同构） */
export class PowderProj extends Entity {
  w = 64; h = 64;
  projId: number;
  dead = false;
  private t = 0;
  private dusted = false;

  constructor(x: number, y: number, vx: number, vy: number, projId: number) {
    super();
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.projId = projId;
  }

  draw(): void { /* 原版 alpha=255：本体不绘制（cs:643），尘粒即全部视觉 */ }

  fixedUpdate(_dt: number, game: GameHooks): void {
    this.t++;
    if (this.t >= 180) { this.dead = true; return; } // ai[0]==180 → Kill（cs:22406）
    this.vx *= 0.95; this.vy *= 0.95;                // cs:22403
    this.x += this.vx;
    this.y += this.vy;
    if (!this.dusted) {
      // 首帧尘团（cs:22411-22452：30 粒，dust = 10+type → 净化 20 / 邪恶 21 / 猩红 231）
      this.dusted = true;
      const color = this.projId === 10 ? '#DCE8E2' : this.projId === 11 ? '#B070D0' : '#D06070';
      game.spawnParticles(this.cx, this.cy, color, 30, 1.6, { life: 45, damp: 0.94, size: 2 });
    }
    game.applyPowder?.(this.projId, this.x, this.y, this.w, this.h);
  }
}

// ================= 肥料云（proj 1019 肥料 / 1051 富集肥料，aiStyle 6） =================

/** item vid → proj id（Item.cs case 5438 :42954-42967 shoot1019 speed3 /
 *  case 5518 :43433-43446 同构段,差异仅 shoot=1051——1457 终值;extractor json 已收
 *  useTime15/useAnim15/consumable/noMelee,本表只补 vid→弹映射）。 */
export const FERTILIZER_PROJ_BY_ITEM: Record<number, number> = { 5438: 1019, 5518: 1051 };

/** AI_006 肥料支 1:1（Projectile.cs:24367-24505,1457 与 1458 同行号锚；PowderProj 同族同构）：
 *   · SetDefaults（:9646-9658 / :9965-9977）：64×64 命中盒、aiStyle6、friendly、
 *     tileCollide=false、penetrate=-1、alpha=255 本体不绘制、ignoreWater；
 *   · 每拍 velocity×0.95 初速漂移（:24369）、ai[0]==180 兜底自灭（:24371）、
 *     velocity.Length()<0.5 即散（:24504）——shootSpeed 3 出手约 36 拍后飘停散云；
 *   · 首 tick 尘爆（ai[1] 门 :24375-24420）：flag2 数量 40 型号 0 尘、flag(富集)
 *     数量 50 且逐粒 rand(3)==0 换抽 309；每粒再走 flag2 后置覆写
 *     noGravity=i%3!=0 + 重力档 s×1.25/vel÷2/vy−2.2 vs 浮空档 s×1.75/+弹速×0.65
 *     （P.cs:24379-24418）——spawnDust 第8参=Alpha 非数量（B2-F1 曾塌缩成 1 粒）；
 *     本仓 spawnDust 缺省宿主回落合成粒子;
 *   · 覆盖窗苗格成树（owner==myPlayer && flag2 门 :24430-24435 单人恒真；窗=
 *     floor(pos/16)-1 .. floor((pos+size)/16)+2 双轴,盒-格矩形相交再筛;
 *     CommonSapling[type] 才调 AttemptToGrowTreeFromSapling(:24501-24505)——
 *     富集档 treeHeightAddon=15、remixWorld 地下带先 underground:false 补试一次。
 *     窗扫+苗筛+派发由 Game 注入回调承载（与 PowderProj.applyPowder 同构,
 *     实体层不持世界引用）。 */
export class FertilizerCloud extends Entity {
  w = 64; h = 64;
  vx: number;
  vy: number;
  projId: number;
  dead = false;
  private t = 0;
  private burst = false;
  /** (盒左x, 盒上y, 盒宽w, 盒高h, treeHeightAddon)——Game.growFertilizedSapling 承载 */
  private growScan: (gx: number, gy: number, gw: number, gh: number, addon: number) => void;

  constructor(x: number, y: number, vx: number, vy: number, projId: number,
    growScan: (gx: number, gy: number, gw: number, gh: number, addon: number) => void) {
    super();
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.projId = projId;
    this.growScan = growScan;
  }

  /** alpha=255 本体不可见（SetDefaults :9655/:9974），视觉全靠首 tick 尘团 */
  draw(): void { /* no-op */ }

  fixedUpdate(_dt: number, game: GameHooks): void {
    // cs:24370-24372：ai[0]++ 与 ==180 慢杀兜底（先于扫描——Kill 当拍剩余段跳过）
    this.t++;
    if (this.t === 180) { this.dead = true; return; }
    this.vx *= 0.95; this.vy *= 0.95;                      // cs:24369
    if (!this.burst) {
      // P.cs:24378-24392 数量/尘型定档：num52=30（本族肥料两型不走）→ flag2 抬
      // num52=40 且 num51=0 → 富集(flag=1051) 再抬 num52=50。B2-F1 修复：
      // spawnDust 第 8 参是 Alpha=50（P.cs:24399 NewDust 签名第 7 参——
      // Dust.cs:75 `int Alpha`），原实现把它当数量只发 1-2 粒 → 塌缩；
      // 本仓签名 GameHooks.spawnDust(x,y,w,h,type,sx,sy,alpha,color,scale,noGravity)
      // 单粒语义与原版逐参对齐,数量必须由调用侧循环承载。
      this.burst = true;
      const enriched = this.projId === 1051;
      for (let i = 0; i < (enriched ? 50 : 40); i++) {           // P.cs:24393
        // P.cs:24395-24398 富集档逐粒重掷尘型 rand(3)==0 ? 309 : 0；普通档恒型 0
        const dustType = enriched && Math.floor(Math.random() * 3) === 0 ? 309 : 0;
        // P.cs:24399 NewDust(position,w,h,type,SX,SY,Alpha:50)：速度基线=弹速,
        // 框内随机落点/±2 速度抖动/scale 抖动在 fx/VanillaDust.spawn(:75-285) 内完成;
        // 返回 null ≈ Main.dust[6000] 失败哑槽(Main.cs:1692 new Dust[6001])——
        // 原版 flag2 覆写对哑槽同样空转,此处跳过即可不破坏其余粒的循环节奏
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, dustType,
          this.vx, this.vy, 50);
        if (!d) continue;
        // P.cs:24400-24418 flag2 后置覆写：noGravity = i%3!=0 逐粒轮替——
        //   重力档(!noGravity,:24405-24409)s×1.25+vel÷2+vy−2.2（沉降下沿团）
        //   浮空档(noGravity,:24413-24416)s×1.75+vel+弹速×0.65（随云拖尾团）
        d.noGravity = i % 3 !== 0;
        if (!d.noGravity) {
          d.scale *= 1.25;
          d.vx /= 2; d.vy /= 2;
          d.vy -= 2.2;
        } else {
          d.scale *= 1.75;
          d.vx += this.vx * 0.65; d.vy += this.vy * 0.65;
        }
      }
      if (!game.spawnDust) {                                     // 无尘宿主回落合成粒子
        game.spawnParticles?.(this.cx, this.cy, enriched ? '#CCE87A' : '#C8A85A',
          enriched ? 50 : 40, 1.5, { life: 46, damp: 0.95, size: 2 });
      }
    }
    // 位移在扫描前完成一拍（原版 AI 后 Update 位移同帧序）
    this.x += this.vx;
    this.y += this.vy;
    this.growScan(this.x, this.y, this.w, this.h, this.projId === 1051 ? 15 : 0);  // cs:24501-24505
    // cs:24504：velocity.Length() < 0.5 → Kill（肥料云的真实寿命门,~36 拍）
    if (Math.hypot(this.vx, this.vy) < 0.5) { this.dead = true; return; }
  }
}

// ================= Torch God 火把弹幕（proj 949，AI_184 cs:40100） =================

/** 直线飞行火把：射程(rangePx)耗尽前穿墙，之后撞块即毁；命中玩家 40×难度曲线伤。
 *  ai0=尘色/ai1=射程——尾迹(每 AI 4 粒)与 Kill 爆尘已经 Game.torchGodDust 钩子
 *  接通（原"尘迹省略/粒子钩子未接"注已陈旧,终清波复核修订）,伤害/碰撞 1:1 */
export class TorchGodProj extends Entity {
  private sndT = 0;   // localAI[0] 首帧音哨兵
  w = 4; h = 4;
  vx: number; vy: number;
  projId = 949;
  dead = false;
  private rangeLeft: number;
  private tileCollide = false;
  /** ai[0]：TorchID.Dust[被熄火把样式]（:17757/:40104 尾迹+爆尘取色） */
  dustType = 6;
  /** 尘回调（Game.torchGodDust——尾迹/Kill 爆尘共用,velMul 由调用方给） */
  private readonly dust?: (x: number, y: number, type: number, velMul: number) => void;

  // ---- ★通用湿段（Projectile.cs:16895-17113 共享体;2026-09-08 红队接入面 F4 清偿;
  //      范本=同文件 TorchGodHelperProj 1084）----
  //  域 id = {949}（SetDefaults :8950-8956：4×4 aiStyle184 penetrate−1
  //  tileCollide=false,无 ignoreWater 行=缺省 false（:763）→ 受段）。
  //  插位=AI 后/位移前（原版 Update 位序 :16880→:16895→:17120;与 1084 同款子步位）。
  //  AI_184_BadTorchLuck（:43575-43610 逐行核对）零湿旗消费零位移写 → 采样位等价;
  //  杀拍覆盖：moveAndCollide 撞块 kill 在位移【后】=湿段已跑,出界杀（:16790 通用门,
  //  本仓 fixedUpdate 头）在湿段【前】=原版同序（出界拍原版本就 return 不跑湿段）。
  //  命中玩家支（SelfHurtPlayers :43575-43579 移前盒）不杀弹（R3-16 定谳穿透续飞）
  //  → 无杀拍湿段豁免面。
  //  阻尼（HandleMovement :17721-17764 湿支只在 tileCollide 支,:17594）：数据面
  //  tileCollide=false（:8955）→ 预置期档位不消费（wetVelocity≡velocity 快照
  //  :16870,位移全速）;但 AI_184 射程耗尽支（:43591-43598 else）置 tileCollide=true
  //  （本仓 this.tileCollide 运行时镜像）→ 超程后湿支生效——闸=【运行时旗】非数据面,
  //  乘进 moveAndCollide dx/dy 位移入参（body.tileCollide 同旗,关碰路径直写亦同闸）。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount :16984 置 10 / :17109-17112 逐拍 −1） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10893 等价;共享体首调自做） */
  presetDone = false;

  constructor(x: number, y: number, vx: number, vy: number, rangePx: number,
    dustType = 6,
    dust?: (x: number, y: number, type: number, velMul: number) => void) {
    super();
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.rangeLeft = rangePx;
    this.dustType = dustType;
    this.dust = dust;
  }

  draw(r: Renderer, cam: Camera): void {
    drawProj(r, cam, this, 949, Math.atan2(this.vy, this.vx) + Math.PI / 2, '#FFB060');
  }

  /** Kill（:67632-67652）：Item10 音 + 20 粒 ai[0] 尘（vel×0.8、Next(3)!=0→noGravity） */
  private kill(game: GameHooks): void {
    game.playSfxWav?.('Item_10', 1, this.cx, this.cy);
    for (let k = 0; k < 20; k++) this.dust?.(this.x, this.y, this.dustType, 0.8);
    this.dead = true;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    const st = game.world.store;
    // 出界杀（Update 通用门 1457 :16793-16802,aiStyle≠3——出界 active=false 静默隐灭,
    // 无音无尘;置于 AI 前同原版序:出界检查先于 AI() :16880）。中心格 inBounds 口径
    // 与 GrenadeProj 出界杀先例（本文件 :4824）对齐;登记微差:原版=整弹盒四缘越界
    // （position.X ≤ leftWorld ∨ X+w ≥ rightWorld ∨ Y… ∨ NaN）,本仓=中心格——
    // 世界缘 16px 带内多飞 ≤1 拍,观感不可辨。
    if (!st.inBounds(Math.floor(this.cx / TILE), Math.floor(this.cy / TILE))) {
      this.dead = true; return;
    }
    // 命中玩家（★T2 挪前位,红队 H′ 清偿 2026-09-02:原版 SelfHurtPlayers
    // （Projectile.cs:15104-15152）由 AI_184 头部调用（:43575-43579）——判定发生在
    // UpdatePosition（:19973）之前 = 移前盒;旧形在 moveAndCollide 之后读移后位 =
    // ≤1 tick 相位差 + 居中穿越拍击退符号翻转。门集对齐（:15106-15107
    // !active||dead||immune||!Colliding）:dead/immune 由 Player.damage 内部门承接
    // （Player.ts :7114 dead 早退 / :7141 General iframes 位）,!Colliding = 下 AABB。
    // 击退方向原版 direction = (!(playerCX < base.Center.X)) ? 1 : -1 = 远离弹心
    // ——srcX 直传弹【移前】中心 cx（旧形 Math.sign(p.cx−this.cx) 被当坐标传,
    // damage 侧 dir=cx<srcX?−1:1 恒 +1,一并清偿）。命中后【不 return】——原版 AI
    // 命中后继续音/射程/尾迹/位移（SelfHurtPlayers 不冻结弹,穿透续飞;无敌帧内由
    // damage 侧 immune 门静默）。死亡归因 = ByProjectile（Projectile.Damage→Hurt
    // 同源弹型名;此前漏设→死因残留旧值）。1457 :43575-43578（1456 :40100-40107
    // owner=255/damage=0 假伤）:改 owner==myPlayer && !unlockedBiomeTorches →
    // SelfHurtPlayers() 真伤;SetDefaults 去 hostile（:8950）。本仓
    // unlockedBiomeTorches（火把神图腾解锁位）未登记 → 恒未解锁 = 恒真伤
    // （与 1456 假伤 0 的差异即本批修正点）
    const p = game.player;
    if (!game.world.flags.unlockedBiomeTorches
      && this.x < p.x + p.w && this.x + this.w > p.x && this.y < p.y + p.h && this.y + this.h > p.y) {
      // ★M′-MAJOR-1（2026-09-02 红蓝对抗定谳）：1457 :15113-15117 `value=damage;
      //  num2=Main.DamageVar(value, 0f - localPlayer.luck)`——949 不在
      //  ProjectileID.Sets.FixedSelfDamageForPlayers 表（Terraria.ID/ProjectileID.cs:193
      //  CreateCustomSet 78 项全 134-801 族+1117）→ 命中时按弹 damage 面 ±15% 离散档
      //  掷骰 + −luck 重掷取低带（同族先例 Player.ts applyTouchDamage :7371
      //  `damageVarRoll(touchBase, -this.luck)`;单源 stats/DamageVar）。难度乘区维持
      //  1457 :18000 生成式 `damage=(int)(40f×HostileProjectileDamageMultiplier.Sample(
      //  Main.Difficulty))`——经典 40/专家 80(×2)/大师 120(×3)（GameDifficultyData.cs:67
      //  曲线斜率 1;D-❌④ 2026-08-21 接线,曾恒 20。★V5 复核勘误:旧注释"×1.5/×2"系
      //  乘区口径错,Sample 曲线 Journey0.5→Master3）。原版在生成掷处算定,命中时算等价
      //  （949 飞行期 damage 字段不变,roll 时点仅记账面差异）。
      const rolled = damageVarRoll(hostileProjectileDamage(40, mainDifficulty(game.world)),
        -(p.luck ?? 0));
      // ★M′-MINOR-3：lastDamageCause 受理后才写——p.damage 返回 reduction（实扣 HP,
      // Player.ts:7100 契约「0=完全未受伤」）>0 才置位：闪避族（mysticSash/黑带/
      // 混乱脑/幻影闪避）/无敌帧/debugGod/shimmering/dead 早退族全 return 0 → 不覆写
      // 残留旧值。原版位次：:15106 早退族（!active||dead||immune||!Colliding）先于
      // DeathReason 构造（:15128 ByProjectile），Hurt 返回 0 不产生受理语义同构。
      if (p.damage(rolled, this.cx, 0, true) > 0) {
        p.lastDamageCause = {
          kind: 'projectile',
          name: game.projectileName?.(this.projId) ?? '弹幕',
        };
      }
      // ★M′-MINOR-4/5 登记（备案不修,红队仲裁登记项）：
      //  ④ MP 镜像位——原版 AI_184 :43575-43576 门 = `owner == Main.myPlayer &&`：
      //     SelfHurtPlayers 只在弹主端判定+扣血,非主端镜像弹整段跳过;本仓
      //     game.player 恒本地权威（单 authority 漏斗）,联机镜像弹各端都进 hit 支,
      //     伤害裁决归 host——owner 校验位差异登记不修。
      //  ⑤ 闪避语义差——原版 :15106 早退族（immune/dead/Colliding）在 DeathReason
      //     构造【前】整段跳过;本仓 Player.damage 的早退位次（闪避族在 immune 门
      //     之后）与原版两段式不逐一对应。MINOR-3 已覆盖一半（不受理不置位）,
      //     余下位次差（原版 pre-DeathReason 早退 vs 本仓 damage 内部早退）登记不修。
      // ★R3-16（1457 P57:43575-43579 AI_184_BadTorchLuck → SelfHurtPlayers
      //  :15104-15152）：原版命中后**不杀弹**——949 继续飞，玩家无敌帧内由
      //  immune 门静默、无敌帧结束再判（SelfHurtPlayers 每 AI 帧调用）。本仓曾
      //  this.kill → 火把神之焰碰玩家即消失（原版穿透续飞反复判定）。
    }
    // 首帧 Item8 音（AI_184 :40109-40111 localAI[0]==0——事件全程连射的本族主声,终审补）
    if (!this.sndT) { this.sndT = 1; game.playSfxWav?.('Item_8', 1, this.cx, this.cy); }
    // ai[1] 射程（1457 :43591-43598 if/else:ai[1]>0 拍才递减——穿零拍【不置】
    // tileCollide,下一拍 else 支才置位;旧 `-= 后判 ≤0` 穿零当拍开撞=提前 1 拍,m-1 修正）
    if (this.rangeLeft > 0) this.rangeLeft -= Math.hypot(this.vx, this.vy);
    else this.tileCollide = true;
    // 尾迹（AI_184 :40120-40130;1457 :43596-43609）：每 AI 4 粒,沿 velocity/4×k 段布点,
    // vel×0.3——★基准 = 此刻 this.x/this.y。原版 Update 序 = AI()（1457 :16880）先于
    // UpdatePosition（:19973;aiStyle 184 不在 :20549-20552 跳过表）,AI_184 尾迹以
    // 【移前位】为基准（尾迹从旧位置拖出）。红队 #3(2026-09-02):尾迹循环整体上移到
    // moveAndCollide 之前——该点即移前位,快照层 preMoveX/preMoveY 删除（冗余间接层）;
    // Kill 帧早退前尾迹已出 = 原版杀帧 4 尾迹+20 爆尘 24 粒语义达成。
    for (let k = 0; k < 4; k++) {
      this.dust?.(this.x + (this.vx / 4) * k, this.y + (this.vy / 4) * k, this.dustType, 0.3);
    }
    // ★通用湿段（:16895-17113 共享体,AI 后/位移前=原版位序——域/阻尼闸注见字段块）
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater);
    // ★残余债清偿(2026-09-01):中心点采样在斜砖/半砖上漏检(空区)/误检并存——
    // 射程内 tileCollide=false 直写、超程后任一轴接触即 Kill(AI_184 :40112 系)
    {
      const body = {
        x: this.x, y: this.y, w: this.w, h: this.h,
        vx: this.vx, vy: this.vy,
        onGround: false, hitWall: false, hitHead: false, collideY: false,
        hoik: true,   // ★FX34c 弹幕域 hoik=true（Body.hoik 注:原版 Projectile 全路径）
        tileCollide: !!this.tileCollide, dropThrough: true,
      };
      // 水中位移阻尼（HandleMovement :17721-17764 湿支只在 tileCollide 时进）——
      // 闸=运行时 this.tileCollide（AI_184 超程支 :43595-43598 置 true,数据面恒 false）
      const df = this.tileCollide ? projWaterDragFactor(this) : 1;
      moveAndCollide(body, game.world, this.vx * df, this.vy * df);
      this.x = body.x; this.y = body.y;
      if (this.tileCollide && (body.hitWall || body.collideY || body.onGround || body.hitHead)) {
        this.kill(game); return;
      }
    }
  }
}

// ================= 火把神祝福转换弹 1084（aiStyle 202，AI_202_TorchGodHelper :37557-37596） =================

/**
 * proj 1084 TorchGodHelper（SetDefaults Projectile.cs:9831-9839：4×4 aiStyle202
 * penetrate−1 tileCollide=false extraUpdates=2 timeLeft=300）——火把神药水 5573 的
 * buff 376 效果端（Player.TorchGodsFlavor :39529 每 tick 1/10 扫屏）发射的转换弹：
 * 飞向异群系群系炬（ai[1]=tx/ai[2]=ty，ai[0]=目标样式），抵达 16px 内 → tile 4 的
 * frameY = style×22（:37566-37571）+ Kill。首帧 Item8 音（:37573-37576）、尾迹每
 * AI 次 4 粒 TorchID.Dust[style]（:37578-37594）、Kill 时 Item10 + 40 粒同尘
 * （:67610-67630）。extraUpdates=2 = 每 tick 移动+AI 3 次（属性定义 :338-348）。
 */
export class TorchGodHelperProj extends Entity {
  readonly projId = 1084;
  dead = false;
  w = 4; h = 4;                                   // :9834-9835
  vx: number; vy: number;
  x: number; y: number;
  private sndT = 0;                               // localAI[0] 首帧音哨兵（:37573）
  private static readonly RUNS = 3;               // extraUpdates=2 → 1+2 次/tick
  // ---- ★通用湿段（Projectile.cs:16903-17113;2026-09-06 R3 漏网类批 11 类之一）----
  //  域 id = {1084}（SetDefaults :9831-9839 块无 ignoreWater 行,缺省 false :763 → 受段）。
  //  位序：AI_202（抵达转换 Kill/尾迹尘,无 velocity 写面）→ 湿段 → 位移,逐【子步】
  //  各跑一次（extraUpdates=2 :9838 → numUpdates 环内湿段 :16781-17345 逐子步）。
  //  ★阻尼 N/A 留锚：tileCollide=false（:9837）→ HandleMovement 湿阻尼块 :17721 不跑;
  //  且 AI 无 velocity 写面 → wetVelocity≡velocity（:16870 快照恒等）,湿位移与干位移
  //  同值无消费面——湿段可见面 = 溅花（穿越液面拍）/旗维护。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价——出生盒同位测值） */
  presetDone = false;   // ProjWetFlags.presetDone（共享湿段旗持有者）
  /** 杀拍防双跑闩（抵达 Kill 补跑用——逐【子步】复位） */
  private wetSectionRan = false;
  constructor(
    x: number, y: number, vx: number, vy: number,
    /** ai[0]：目标火把样式（frameY = style×22，:37568） */
    readonly style: number,
    /** ai[1]/ai[2]：目标 tile 坐标（:37558-37559） */
    readonly tx: number, readonly ty: number,
    /** 转换回调（Game 侧：tile 4 校验 + frameY 直写 + 脏标记） */
    private readonly convert: (tx: number, ty: number, style: number) => void,
    /** 尘回调（Game 侧：NewDust(4×4,alpha100) 后 velocity×velMul/scale×1.1/
     *  noLightEmittance——尾迹 0.3（:37586-37590）、Kill 爆 2.5（:67619）。
     *  fullBright 位本仓 VDust 无,登记视觉微差） */
    private readonly dust: (x: number, y: number, type: number, velMul: number) => void,
  ) {
    super();
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
  }

  draw(r: Renderer, cam: Camera): void {
    drawProj(r, cam, this, 1084, Math.atan2(this.vy, this.vx), '#FFD890');
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    const dustId = TORCH_DUST_BY_STYLE[this.style] ?? 6;
    for (let run = 0; run < TorchGodHelperProj.RUNS; run++) {
      this.wetSectionRan = false;                 // 杀拍闩逐【子步】复位
      const tpx = this.tx * 16 + 8, tpy = this.ty * 16 + 8;   // ToWorldCoordinates（:37560）
      // 抵达 16px 内 → 吸附 + 转换 + Kill（:37562-37572）
      if (Math.hypot(tpx - (this.x + this.w / 2), tpy - (this.y + this.h / 2)) < 16) {
        this.x = tpx - this.w / 2; this.y = tpy - this.h / 2;
        this.vx = 0; this.vy = 0;
        this.convert(this.tx, this.ty, this.style);
        this.dead = true;
        game.playSfxWav?.('Item_10', 1, this.cx, this.cy);   // Kill 音（:67611）
        for (let i = 0; i < 40; i++) {                        // :67613-67630 num14=40
          this.dust(this.x, this.y, dustId, 2.5);
        }
        // ★杀拍补跑（AI-Kill 拍湿段照跑,原版 :16903 无 active 门——测位=吸附后位,
        //  与原文 Kill 时点 position 同值;wetSectionRan 防双跑）
        if (!this.wetSectionRan) {
          this.wetSectionRan = true;
          projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
            this.projId, !!projectileData(this.projId)?.ignoreWater);
        }
        return;
      }
      // 尾迹：每 AI 次 4 粒沿速度路径采样（:37578-37594 num4=4，position+velocity/4×num5；
      // 尘速 = NewDust 抖动 ×0.3——非弹速,原版 NewDust 传 0 速）
      for (let d = 0; d < 4; d++) {
        this.dust(this.x + (this.vx / 4) * d, this.y + (this.vy / 4) * d, dustId, 0.3);
      }
      // 通用湿段（:16903-17113——AI 后/位移前,原版位序;域注见字段块）
      this.wetSectionRan = true;
      projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
        this.projId, !!projectileData(this.projId)?.ignoreWater);
      this.x += this.vx; this.y += this.vy;   // tileCollide=false 直线（:9837）
    }
    // 首帧 Item8 音（:37573-37576 localAI[0]==0）
    if (!this.sndT) { this.sndT = 1; game.playSfxWav?.('Item_8', 1, this.cx, this.cy); }
  }
}

// ================= 太阳耀斑 636（aiStyle 113，AI_113_TargetSticker :38138-38477） =================

/**
 * proj 636（SetDefaults :6559-6570：16×16 aiStyle113 friendly melee penetrate−1
 * alpha255 MaxUpdates=2）——Daybreak 长矛 3543 直射（Item.cs:31847-31860 shoot=636）。
 * 标枪族双相：飞行（ai[0]==0，:38166-38248：45 AI 次后缓坠 636 档 vx×0.995/vy+0.15，
 * rotation=atan2+π/2）→ 命中即附着（:12421-12428 ai[0]=1、ai[1]=victim、
 * velocity=(敌心−弹心)×0.75 冻结为悬挂偏移）→ 附着段（:38242-38367：Center=
 * 敌心−velocity×2 跟随，60×num11=600 AI 次（num11=5×MaxUpdates=10,:38249-38253）
 * = 300t/5s 后消亡，目标失效同灭）。Daybreak(189) 层数 = 场上附着数（NPC.cs
 * :92807-92830 num8×100 HP/s，零层兜底 1），上限 8/敌（KillOldestJavelin
 * :13019-13030/:13995-14020，_javelinsMax8）。
 *
 * ★AI_113_TargetSticker 蓄力（附着）支全族账（1457 亲读 Projectile.cs:41289-41660，
 * 2026-09-03 Solar 移植批复核）——【哪些弹进此支】：命中结算 :13244-13250
 * `if (aiStyle == 113 && ai[0] < 2f) { ai[0]=1; ai[1]=victimIndex; velocity=
 * (victim.Center−Center)×0.75 }`，受理集 = aiStyle 113 全族六型：
 * 598 BoneJavelin / 614 StardustCellMinionShot / 636 Daybreak / 971 TentacleSpike /
 * 975 BloodButcherer / 1024 DeadCellsKillingDeckCard（ProjectileID.cs 逐名核对）。
 * 附着寿命 per-id num11（:41400-41415）：636=5×MaxUpdates(2)=10 → 60×10=600 AI 次
 * （本弹 2 EU/t ⇒ 300t/5s）；971/975=9×MaxUpdates；1024=5×MaxUpdates；598/614 走
 * 缺省 15。分支内动态置位（:41396-41399）`ignoreWater=true; tileCollide=false;`
 * ——vanillaProjectiles.ts 数据面唯一动态例外（附着态不改弹体质地,数据列静止）；
 * 本仓附着相零位移零湿缓存 ⇒ 两置位语义天然成立,无需实体字段。
 * 分相差异：614 飞行相即追踪 ai[1] 目标（:41321-41351 CanBeChasedBy 拒门即自灭）
 * 非 45 拍缓坠族；1024 专属 ai[0]==2 回手相（:41578-41607,flag3 → Kill 改写
 * ai[0]=2+ResetLocalNPCHit
 * Immunity+Damage()）——636 两支均不可达。目标受理门 :41488 active∧!dontTakeDamage。
 */
const STUCK_FLARES = new Map<number, DaybreakFlare[]>();

/** Daybreak(189) 层数查询（NPC.cs:92813-92825 的 active&&type==636&&ai[0]==1&&
 *  ai[1]==whoAmI 扫描等价）。键 = Enemy.id（EntityManager 槽位，与 hitCd 同空间）；
 *  零层兜底 num8==0→1（:92822-92825）由消费方 max(1,·) 承担 */
export function daybreakStacks(enemyId: number): number {
  const arr = STUCK_FLARES.get(enemyId);
  if (!arr) return 0;
  // 惰性清尸：EntityManager.clear()（world unload）不走 destroy()，死弹残条目
  // 不计层——防跨世界 id 复用时的幽灵层数
  let n = 0;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i].dead) arr.splice(i, 1);
    else n++;
  }
  if (!arr.length) STUCK_FLARES.delete(enemyId);
  return n;
}

export class DaybreakFlare extends Entity {
  // ★T4 清偿（2026-09-02,原"半拍差登记不修"升格修复）:oldPos 改按 EU 子步逐条记录
  // （TrailingMode[636]=0,ProjectileID.cs:385;每子步 AI+位移后 oldPos[0]=position,
  //  P.cs:17199-17204）——旧实现每 tick 一条且取 tick 起点（= 原版 oldPos[2] 位）,
  //  Kill 双环尘（num174∈{0,3},:73384-73396）落点整体落后一拍、第二条环取到原版
  //  oldPos[6] 位;现 [0]=死亡子步前一子步位（死亡子步不入带,:17135 if(!active)return
  //  先于记录段——碰撞 Kill 时尘环贴在半途位,非帧首位）、[3]=上上 tick 末位,与原版
  //  逐位对齐。容量同步 TrailCacheLength[636]=20（ProjectileID.cs:387,旧 10）。
  //  唯一残差：repo 的 timeLeft Kill 在 step 头（原版在记录段后 :17304-17310）——
  //  该相位 636 实际不可达（timeLeft 3600,先到期的是 localT 600/碰撞/失靶）。
  readonly projId = 636;
  damage: number;
  knockback: number;
  /** 暴击总概率（Game 侧注入，同挥砍弧口径） */
  critChance = 0.04;
  /** 护甲穿透（Game 注入，命中传 hurt 减防） */
  armorPen = 0;
  /** 近战系标记（SetDefaults melee=true :6565——浸剂/霜燃/岩浆石/parry/nano 链已随
   *  终清波并入 hitStep,Damage_PVE 同段镜像） */
  meleeProj = true;
  dead = false;
  w = 16; h = 16;                        // :6561-6562
  /** 弹体点光（:38472-38474 恒亮 0.8/0.7/0.4，飞行/附着两相都加） */
  lightRGB: [number, number, number] | null = [0.8, 0.7, 0.4];
  /** MaxUpdates=2（:6569 → extraUpdates=1，属性定义 :338-348）= 每 tick AI+移动 2 次。
   *  vanilla-projectiles.json 未提取该字段，按源码常量 */
  private static readonly RUNS = 2;
  /** ai[0]：0 飞行 / 1 附着（:38242 分相 / :12423 置 1） */
  private ai0 = 0;
  /** ai[1]：飞行 = AI 次计数（:38170）/ 附着 = 目标 Enemy.id（:12424/:38287） */
  private ai1 = 0;
  /** localAI[0]：附着段 AI 次计数（:38278） */
  private localT = 0;
  /** alpha 淡入（:38139-38146，636 档 25/AI 次 → 约 5t 全显） */
  private alphaI = 255;
  private rot = 0;
  /** timeLeft（SetDefaults 缺省 3600，:526；KillOldestJavelin 的"最老"序据） */
  private timeLeft = 3600;
  /** oldPos 环（Kill 双环尘落点用:P.cs:73385-73396 num174∈{0,3}——unshift 语义
   *  与原版 _oldPos 一致,[0]=最新记录;TrailingMode[636]=0 → 每 EU 子步 AI+位移后
   *  记一条,P.cs:17199-17204;容量 TrailCacheLength[636]=20） */
  private oldPos: Array<{ x: number; y: number }> = [];
  /** direction（尘速度 2.5×direction 用;每子步跟随 vx 符号——:17122-17128
   *  AutomaticallyChangesDirection=HandleMovement 后无条件段,飞行/附着两相都跑
   *  （附着相 vx=悬挂偏移,方向随其重定号——MINOR-6 2026-09-02） */
  private killDir = 1;
  // ---- ★通用湿段（Projectile.cs:16903-17113;2026-09-06 R3 漏网类批,P1 项）----
  //  域 id = {636 Daybreak}（SetDefaults :6841 块无 ignoreWater 行,缺省 false :763 →
  //  飞行相受段;与 PROJ_IGNORE_WATER 零交集）。
  //  ★P1 定谳（R3）：飞行相（ai[0]==0）【非豁免】——湿段照跑（溅花/四旗/wetCount）;
  //  钉扎态（ai[0]==1）【豁免】——AI_113_TargetSticker 钉扎支逐拍显式
  //  `ignoreWater = true; tileCollide = false;`（:41396-41399,1457 行号）= 动态豁免
  //  （vanillaProjectiles 数据面外唯一例外,数据列静止）。本仓照 JavelinSticker
  //  971/975 的 ai0 门范式（meleeOnHitProjs.ts 同款）传参分流：ignoreWater 参 =
  //  `ai0 === 1 || 数据面`——钉扎态段门恒闭（旗冻结在钉扎前值,零行为面=原版）。
  //  位序：飞行 AI（:38166-38248,只写 velocity/rotation）→ 湿段 → HandleMovement
  //  （moveStep）;湿段测位 = 上子步位移后位 = 本子步位移前位 ✓（EU=1 逐子步）。
  //  阻尼：飞行相 tileCollide=true（:6841 未关）→ 湿阻尼适用（moveStep 位移入参）;
  //  钉扎态 tileCollide=false（:41399 动态）→ 阻尼块不跑（本仓钉扎支亦无位移位）。
  //  Kill 幂等 = killNow 头 `if (this.dead) return;` 已有;636 非 IsDestroyedByWater
  //  六型 → 湿段 kill 钩缺省不接。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价——首子步 AI 写位前同位测值） */
  presetDone = false;   // ProjWetFlags.presetDone（共享湿段旗持有者）

  /** 钉扎态动态豁免门（ai[0]==1 → ignoreWater=true 的本仓承载,:41396-41399;
   *  方法体读取规避 step() 内 ai0 字面窄化的 TS2367——飞行支后 ai0 窄化为 0,
   *  直写 `ai0 === 1` 比较被 flagged;钉扎支提前 return,此门为防御性双保险） */
  private stuckGate(): boolean { return this.ai0 === 1; }

  constructor(x: number, y: number, vx: number, vy: number, damage: number, knockback: number) {
    super();
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.damage = damage; this.knockback = knockback;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    // extraUpdates=1：AI+移动每 tick 跑 2 次（Update :15336-15339 while 语义同 Boomerang）；
    // oldPos 每【子步】AI+位移后记一条（TrailingMode 0,P.cs:17199-17204）——★T4 清偿
    // 见类头注。死亡子步不入带（原版 :17135 `if(!active) return` 先于记录段）
    for (let i = 0; i < DaybreakFlare.RUNS && !this.dead; i++) {
      this.step(game);
      if (!this.dead) {
        this.oldPos.unshift({ x: this.x, y: this.y });
        if (this.oldPos.length > 20) this.oldPos.length = 20;   // TrailCacheLength[636]=20
      }
    }
  }

  /** 单次 AI 迭代（AI_113_TargetSticker 一次） */
  private step(game: GameHooks): void {
    if (--this.timeLeft <= 0) { this.killNow(game); return; }
    if (this.alphaI > 0) this.alphaI = Math.max(0, this.alphaI - 25);   // :38139-38146
    if (this.ai0 === 0) {
      // ---- 飞行相（:38166-38248）----
      this.ai1 += 1;                       // :38170
      if (this.ai1 >= 45) {                // :38173-38174 起 45 AI 次门
        this.vx *= 0.995;                  // :38196-38202（636 档 0.995/0.15）
        this.vy += 0.15;
      }
      this.rot = Math.atan2(this.vy, this.vx) + Math.PI / 2;            // :38244-38248
      this.killDir = Math.sign(this.vx) || this.killDir;
    } else {
      // ---- 附着相（:38242-38367）----
      this.localT += 1;                    // :38278
      if (this.localT >= 600) { this.killNow(game); return; }  // :38329-38332（60×num11）
      const t = this.findTarget(game);     // :38287 num12 = (int)ai[1]
      if (!t) { this.killNow(game); return; }  // :38333-38336/:38346-38349 目标失效
      this.x = (t as { cx: number }).cx - this.vx * 2 - this.w / 2;     // :38338-38339
      this.y = (t as { cy: number }).cy - this.vy * 2 - this.h / 2;
      // ★MINOR-6（2026-09-02 J′）：direction 每拍按 velocity.X 定号（:17122-17128
      // AutomaticallyChangesDirection=HandleMovement 后无条件段,附着相不豁免——
      // 附着拍 vx 已被改写为悬挂偏移（首击结算 :38287 前）,方向随冻结 vx 重定号,
      // Kill 尘 2.5×direction（:73395）取该值;旧码只在飞行相定号 = 附着后 Kill 尘
      // 用首击前的飞行朝向,向左附着时尘向反转
      this.killDir = Math.sign(this.vx) || this.killDir;
      if (this.localT % 30 === 0) {        // :41443-41450 flag2 = localAI[0]%30==0
        // flag2 → targetNPC.HitEffect(0, 1.0)(:41453)——【NPC.HitEffect 敌怪自体受击尘族】
        // (按敌型出血液/尘埃/gore)系统待移植;合成两粒火花为观感占位（C 类登记,
        // 原"HitEffect 近似"表述升级为精确系统缺口)
        game.spawnParticles(this.cx, this.cy, '#FFB040', 2, 1.2, { life: 14 });
      }
      return;                              // tileCollide=false（:38248）且不再位移/命中
    }
    // ---- 通用湿段（:16903-17113,projWetSection 共享体——飞行 AI 后/位移前,原版
    //      位序 AI(:16880) → 湿段(:16903) → HandleMovement(:17120);逐【子步】各跑
    //      一次。★P1：ignoreWater 参 = ai0===1（钉扎态动态豁免,:41396-41399）∪ 数据面
    //      ——钉扎支提前 return 不达此位,门为防御性双保险;域注见字段块）----
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, this.stuckGate() || !!projectileData(this.projId)?.ignoreWater);
    this.moveStep(game);
    if (this.dead) return;
    this.hitStep(game);                    // 附着后 Damage_CanDealDamage=false（:11782）
  }

  /** 飞行位移 + 撞块即毁（标枪族无反弹分支，Arrow 同口径）。
   *  ★残余债清偿(2026-09-01):中心点采样改走正典管线——斜砖/半砖按真实几何判定,
   *  dropThrough=true 对齐弹体 fallThrough 缺省 true。 */
  private moveStep(game: GameHooks): void {
    const body = {
      x: this.x, y: this.y, w: this.w, h: this.h,
      vx: this.vx, vy: this.vy,
      onGround: false, hitWall: false, hitHead: false, collideY: false,
      hoik: true,   // ★FX34c 弹幕域 hoik=true（Body.hoik 注:原版 Projectile 全路径）
      tileCollide: true, dropThrough: true,
    };
    // ★水中位移阻尼（HandleMovement :17721-17764,飞行相 tileCollide=true 适用）——
    //  速度场不减只削当拍位移（湿段批共享口径）
    const drag636 = projWaterDragFactor(this);
    moveAndCollide(body, game.world, this.vx * drag636, this.vy * drag636);
    this.x = body.x; this.y = body.y;
    const st = game.world.store;
    const tx = Math.floor(this.cx / TILE);
    const ty = Math.floor(this.cy / TILE);
    if (!st.inBounds(tx, ty)) { this.killNow(game); return; }
    game.cutTile(tx, ty);
    if (body.hitWall || body.collideY || body.onGround || body.hitHead) this.killNow(game);
  }

  /** 首击结算：伤害 + AddBuff(189,300) + 附着 + 上限 8 淘汰（单目标即止） */
  private hitStep(game: GameHooks): void {
    for (const ent of game.enemies()) {
      // ★dontTakeDamage 目标排除（:12600 同款——附着/格挡×5 消费/snapStrike/confetti
      //   伴发全在 hurt 前,曾绕门落账,最终清零补）
      if ((ent as unknown as { dontTakeDamage?: boolean }).dontTakeDamage === true) continue;
      if (!playerCanHitEnemy(ent, game, this.projId)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
      const e = ent as unknown as { x: number; y: number; w: number; h: number; id: number; dead: boolean; cx?: number; cy?: number; hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean };
      if (e.dead) continue;
      // :14520-14523 大型目标命中盒各边内缩 1/8（636 专属——大 Boss 须命中内圈才附着）
      const sx = e.w > 8 && e.h > 8 ? Math.floor(e.w / 8) : 0;
      const sy = e.w > 8 && e.h > 8 ? Math.floor(e.h / 8) : 0;
      const rx = e.x + sx, rw = e.w - sx * 2, ry = e.y + sy, rh = e.h - sy * 2;
      if (!(this.x < rx + rw && this.x + this.w > rx && this.y < ry + rh && this.y + this.h > ry)) continue;
      // ★BJ489 def-3：掷率=rollVanillaHitCrit（636 melee 旗 :6565;命中拍 owner 装配+
      // 持械折入动态,critTotal 出生拍冻结载体退役）;critChance≤0 关断钉保留
      const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
      // ★近战乘区+浸剂链镜像（Damage_PVE :13631-36 parry×5 / :13688-96 nano×1.05；
      //   StatusNPC 段 applyMeleeImbue(:10559 melee 门)/霜燃(:93712)/岩浆石(:10866)
      //   /party confetti(:13693-96)——与 hitEnemies 同序,"浸剂链未接"登记偏差清偿）
      const plFlare = game.player as unknown as {
        buffs?: { has: (b: BuffType) => boolean };
        equipStats?: { frostBurn?: boolean; magmaStone?: boolean };
        parryDamageBuff?: boolean;
        parryDamageBuffT?: number;
      };
      let mulFlare = 1;
      if (plFlare.parryDamageBuff === true) {
        mulFlare *= 5;
        plFlare.parryDamageBuff = false;                       // :13633
        plFlare.parryDamageBuffT = 0;                          // ClearBuff(198)
      }
      if (plFlare.buffs?.has(BuffType.ImbueNano)) mulFlare *= 1.05;  // :44790-44792（buffs 缺省=测试 mock 兼容,与 hitEnemies 同法）
      const dmg = Math.trunc(this.damage * mulFlare);   // ★S02:crit ×2 移 Enemy.hurt 防后
      // ★焰爆石 kind1+拍击石 kind0 弹幕侧（Projectile.cs:13439-13446 双支同序，
      // F3/F1 收编升级）——镖/标枪附着族首击结算位；门+触发 = projectileSnapStrikeBonus
      // 单源，加伤随暴击并入实伤参（不吃旗乘区）
      const snapBonusFlare = projectileSnapStrikeBonus(game, this,
        (e as { cx?: number }).cx ?? e.x + e.w / 2,
        (e as { cy?: number }).cy ?? e.y + e.h / 2, e.id,
        { victimBox: { w: e.w, h: e.h, cx: (e as { cx?: number }).cx ?? e.x + e.w / 2,
          cy: (e as { cy?: number }).cy ?? e.y + e.h / 2 } });
      // ---- 浸剂三件套 + party 真弹（hitEnemies 同序,StrikeNPC 前原位;
      //      buffs/equipStats 缺省守卫 = 测试 mock 兼容）----
      if (plFlare.buffs) {
        applyMeleeImbue(plFlare.buffs, e as unknown as Record<string, number>,
          () => game.spawnParticles(e.x + e.w / 2, e.y + e.h / 2,
            ['#FF6090', '#60FF90', '#6090FF', '#FFD040'][Math.floor(Math.random() * 4)], 6, 2.4, { life: 40, damp: 0.96 }));
      }
      applyFrostBurn(plFlare.equipStats?.frostBurn === true, e as unknown as Record<string, number>);
      applyMagmaStoneProj(plFlare.equipStats?.magmaStone === true, e as unknown as Record<string, number>);
      if (plFlare.buffs?.has(BuffType.ImbueParty)) {
        game.spawnFriendlyProj?.(new ConfettiBurstProj(
          (e as unknown as { cx?: number }).cx ?? e.x + e.w / 2,
          (e as unknown as { cy?: number }).cy ?? e.y + e.h / 2,
          (e as unknown as { vx?: number }).vx ?? 0,
          (e as unknown as { vy?: number }).vy ?? 0), { netSync: true });
      }
      e.hurt(applyBannerDamageDealt(game, e, dmg)
        + (snapBonusFlare ? snapBonusFlare : 0),
        (Math.sign(this.vx) || 1) * this.knockback, 0, game, this.armorPen, crit, 0, true);   // ★S02 crit ×2=Enemy.hurt 防后;fromPlayer=DPS 计
      // ★GC1 写方桥：镖/标枪附着族（598/636/614）走 Projectile.cs:14039-14051 顶层
      //  分派旁路——纯表返回无写档（附着节流全靠 per-javelin 表与上限管理），其余
      //  id（未来扩种）自动落缺省档。
      noteVanillaProjImmune(game, this.projId, e.id);
      // ★GB1（GC 契约，2026-08-31）：幽灵伤害头 ghostHurt（Projectile.cs:13881 →
      //  :12021）——StrikeNPC 后调用位，magic 归属面按弹 id 数据门（同上）。
      if (this.projId > 0 && projectileData(this.projId)?.magic === true
        && playerHasGhostHurt(game.player)) {
        const v156 = e as unknown as { lastStrikeDealt?: number };
        // dealt 合同 = 本拍 Enemy.hurt 结算面（无结算=0；蓝队 F2② 修订）
        ghostHurtOnHit(game,
          { magic: true, projDamage: this.damage,
            projX: this.x, projY: this.y, projW: this.w, projH: this.h,
            ownerCx: game.player.cx, ownerCy: game.player.cy },
          { x: e.x, y: e.y, w: e.w, h: e.h,
            cx: ((e as unknown as { cx?: number }).cx ?? e.x + e.w / 2),
            cy: ((e as unknown as { cy?: number }).cy ?? e.y + e.h / 2),
            vanillaId: (e as unknown as { vanillaId?: number | null }).vanillaId,
            dealt: v156.lastStrikeDealt ?? 0 });
      }
      // ★BJ424 星云套装 proc（:13885-13891,ghostHurt 同块同门面）——引擎自持 magic 门
      if (this.projId > 0) {
        nebulaBoosterOnHit(game,
          { projId: this.projId, projDirX: this.vx },
          { x: e.x, y: e.y, w: e.w, h: e.h,
            cx: ((e as unknown as { cx?: number }).cx ?? e.x + e.w / 2),
            cy: ((e as unknown as { cy?: number }).cy ?? e.y + e.h / 2),
            vanillaId: (e as unknown as { vanillaId?: number | null }).vanillaId,
            dealt: (e as unknown as { lastStrikeDealt?: number }).lastStrikeDealt ?? 0 });
      }
      // :10691-10693 + 催化指环 6185（StatusNPC :11192-11196,玩家弹命中 398 300t）
      applyProjStatus(this.projId, e as unknown as Record<string, number>,
        { catalystBand: ((game.player as unknown as { equipStats?: { catalystBand?: boolean } } | null)?.equipStats?.catalystBand) === true });
      // ---- 附着（:12421-12428）----
      this.ai0 = 1;
      this.ai1 = e.id;
      const ecx = e.cx ?? e.x + e.w / 2, ecy = e.cy ?? e.y + e.h / 2;
      this.vx = (ecx - this.cx) * 0.75;    // 冻结为悬挂偏移（附着段 Center=敌心−v×2）
      this.vy = (ecy - this.cy) * 0.75;
      const arr = STUCK_FLARES.get(e.id);
      if (arr) arr.push(this); else STUCK_FLARES.set(e.id, [this]);
      this.killOldest(game);               // :13019-13030（上限 8,_javelinsMax8 :272）
      return;
    }
  }

  /** 附着目标受理门（AI_113_TargetSticker :41488 else 支 1457 行号）：目标 active
   *  （dead 反义）∧ !dontTakeDamage 才跟随——dontTakeDamage 翻位（克脑一阶/石巨人
   *  缩头等免伤态）即 flag→Kill（弹随目标免伤消亡,与 active 失效同语义） */
  private findTarget(game: GameHooks): unknown | null {
    for (const ent of game.enemies()) {
      const e = ent as unknown as { id: number; dead: boolean; dontTakeDamage?: boolean };
      if (!e.dead && e.dontTakeDamage !== true && e.id === this.ai1) return ent;
    }
    return null;
  }

  /** KillOldestJavelin（:13995-14020）：除自己外凑满 8 枚附着 → 灭 timeLeft 最老者 */
  private killOldest(game: GameHooks): void {
    const arr = STUCK_FLARES.get(this.ai1);
    if (!arr) return;
    let oldest: DaybreakFlare | null = null;
    let n = 0;
    for (const f of arr) {
      if (f === this || f.dead) continue;
      n++;
      if (!oldest || f.timeLeft < oldest.timeLeft) oldest = f;
    }
    if (n >= 8 && oldest) oldest.killNow(game);
  }

  private killNow(game: GameHooks): void {
    if (this.dead) return;
    this.detach();
    this.dead = true;
    game.onProjectileDeath?.(this.projId, this.x, this.y, this.w, this.h);
    // ---- Kill 双环尘 + 953 爆炸（1458 P.cs:73384-73406;1456 同段 :68886-68912。
    //      台账 A① 清偿:旧合成粒子近似退役;953 DaybreakExplosion 实装）----
    const hasDust = typeof game.spawnDust === 'function';
    for (let num174 = 0; num174 < 6; num174 += 3) {
      const origin = this.oldPos[num174] ?? { x: this.x, y: this.y };
      for (let num175 = 0; num175 < 5; num175++) {
        const type = [6, 259, 158][Math.floor(Math.random() * 3)];
        const d = game.spawnDust?.(origin.x, origin.y, this.w, this.h, type,
          2.5 * this.killDir, -2.5, 200);
        if (d) { d.vx *= 2.4; d.vy *= 2.4; d.scale += Math.random(); }
        else if (!hasDust && num175 === 0) break;
      }
    }
    if (!hasDust) {
      // 合成宿主回落（tests/mock 无 spawnDust——观感层近似）
      game.spawnParticles(this.cx, this.cy, '#FFB040', 4, 1.6, { life: 16 });
    }
    // owner==Main.myPlayer 门（:73401-73405）——本机恒真（netPuppet 在 fixedUpdate 头早退）
    game.spawnFriendlyProj?.(new DaybreakExplosionProj(
      this.cx, this.cy,
      0.85 + Math.random() * 1.15,          // ai[1]（:73405 NextFloat 系数）
      this.damage));                        // damage 满额/kb=10f/:AI_117 内 Item14+光
  }

  /** EntityManager 剔除兜底（world unload/测试直弃时摘层数） */
  destroy(): void { this.detach(); }

  private detach(): void {
    if (this.ai0 !== 1) return;
    const arr = STUCK_FLARES.get(this.ai1);
    if (!arr) return;
    const i = arr.indexOf(this);
    if (i >= 0) arr.splice(i, 1);
    if (!arr.length) STUCK_FLARES.delete(this.ai1);
  }

  draw(r: Renderer, cam: Camera): void {
    // alpha 淡入（:38139-38146，SetDefaults alpha=255 起步）
    drawProj(r, cam, this, 636, this.rot, '#FFB040', 1 - this.alphaI / 255);
  }
}

// ================= DaybreakExplosion 953（aiStyle 117,SetDefaults :8990-9001 +
//  AI_117 扩盒 Damage :35095-35212;1456 :35090 区段。台账 A① 清偿:整缺→实装） =================

/** 爆炸盒边长（AI_117 ai[0]==1 档:num879=52 × scale——scale = 出生 ai[1]+0.01;
 *  出生系数 ∈ [0.85,2.0] → 盒边 [44..104]px 中心对称。导出供回归测试对拍）
 *  projFrames[953]=5（Main.cs:8648）→ 存活 = 3×5 = 15 AI tick */
export function daybreakExplosionSide(ai1: number): number {
  return Math.trunc(52 * (ai1 + 0.01));
}

export class DaybreakExplosionProj extends Entity {
  readonly projId = 953;
  damage: number;
  /** NewProjectile 第 7 参（P.cs:73405） */
  knockback = 10;
  dead = false;
  w = 8; h = 8;                          // SetDefaults(:8991-8992)
  /** flag58 光（:35125-35127 Lighting.AddLight(0.9,0.8,0.6) 每 AI 拍恒加） */
  lightRGB: [number, number, number] | null = [0.9, 0.8, 0.6];
  private ai0 = 0;                       // this.ai[0]++(:35102)
  private ai1: number;                   // 缩放驱动(:35100 += 0.01)
  private alphaI = 255;                  // alpha -= 63/AI 拍(:35118-35123)
  private frame = 0;
  private frameCounter = 0;
  hidden = false;                        // frame≥5 → hide=true(:35113-35115)
  private hitCd = new HitCooldown();
  /** SetDefaults 无 melee/ranged/magic 类旗（:8990-9001）→ Damage() 不掷暴击、
   *  不吃近战浸剂/parry——resolveProjClass 走 null 档,hitEnemies 内天然成立,
   *  勿给本类补 critChance 字段 */

  constructor(cx: number, cy: number, initAi1: number, damage: number) {
    super();
    this.x = cx - this.w / 2;            // NewProjectile 居中语义
    this.y = cy - this.h / 2;
    this.ai1 = initAi1;
    this.damage = damage;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    this.ai1 += 0.01;                    // :35100
    this.ai0++;                          // :35102
    if (this.ai0 >= 3 * 5) { this.dead = true; return; }   // :35104-35106 Kill 门
    if (++this.frameCounter >= 3) {      // :35107-35117
      this.frameCounter = 0;
      if (++this.frame >= 5) this.hidden = true;
    }
    this.alphaI = Math.max(0, this.alphaI - 63);           // :35118-35123
    if (this.ai0 !== 1) return;          // :35129 扩盒/Damage/音/尘仅首拍
    // ---- 首拍：扩盒 → Damage() → 音/尘 ----
    const side = daybreakExplosionSide(this.ai1);
    const cx0 = this.x + this.w / 2, cy0 = this.y + this.h / 2;
    this.w = side; this.h = side;        // width=(height=(int)(52×scale)) :35134-35139
    this.x = cx0 - side / 2; this.y = cy0 - side / 2;
    // usesLocalNPCImmunity + localNPCHitCooldown=80（:9000-9001）;Damage() 本拍单发
    hitEnemies(this, game, this.hitCd, 80, 1);
    game.playSfxFiles(['Item_14'], 1, cx0, cy0);           // SoundID.Item14(:35144)
    // 尘群（:35146-35193）：Y 环 4×d31 + 10 组(d6 α200/d6 α100 fadeIn2.5)、X 环
    // 5×d6 + 10×d31——原版 NewDust 后 position 定点覆写,本仓 spawn 后覆写 x/y 等价
    const hasDust = typeof game.spawnDust === 'function';
    const yRing = (): { x: number; y: number } => {
      const th = Math.random() * Math.PI * 2 - Math.PI;    // RotatedByRandom(π)
      const m = Math.random() * (side / 2);
      return { x: cx0 - Math.sin(th) * m, y: cy0 + Math.cos(th) * m };   // UnitY.RotatedBy(th)×m
    };
    const xRing = (): { x: number; y: number } => {
      const th = Math.random() * Math.PI * 2 - Math.PI;
      const m = Math.random() * (side / 2);                // velocity.ToRotation()==0(v=0)
      return { x: cx0 + Math.cos(th) * m, y: cy0 + Math.sin(th) * m };
    };
    for (let i = 0; i < 4 && hasDust; i++) {
      const p = yRing();
      const d = game.spawnDust?.(p.x, p.y, 0, 0, 31, 0, 0, 100, null, 1.5);
      if (d) { d.x = p.x; d.y = p.y; }
    }
    for (let i = 0; i < 10 && hasDust; i++) {
      const pa = yRing(), pb = yRing();
      const da = game.spawnDust?.(pa.x, pa.y, 0, 0, 6, 0, 0, 200, null, 2.7);
      if (da) { da.noGravity = true; da.vx *= 3; da.vy *= 3; }
      const db = game.spawnDust?.(pb.x, pb.y, 0, 0, 6, 0, 0, 100, null, 1.5);
      if (db) { db.noGravity = true; db.fadeIn = 2.5; db.vx *= 2; db.vy *= 2; }
    }
    for (let i = 0; i < 5 && hasDust; i++) {
      const p = xRing();
      const d = game.spawnDust?.(p.x, p.y, 0, 0, 6, 0, 0, 0, null, 2.7);
      if (d) { d.noGravity = true; d.vx *= 3; d.vy *= 3; }
    }
    for (let i = 0; i < 10 && hasDust; i++) {
      const p = xRing();
      const d = game.spawnDust?.(p.x, p.y, 0, 0, 31, 0, 0, 0, null, 1.5);
      if (d) { d.noGravity = true; d.vx *= 3; d.vy *= 3; }
    }
    if (!hasDust) {
      game.spawnParticles(cx0, cy0, '#FFB040', 14, 2.4, { life: 18 });
    }
  }

  draw(r: Renderer, cam: Camera): void {
    if (this.hidden) return;             // hide=true 后本体不画,光/存活照常
    // 5 帧竖条动画（projFrames=5;drawProj 无帧参,手绘——YoyoShotProj 1130 同法）
    const ctx = r.ctx;
    const img = projSprite(953);
    if (!ctx || !img || !(img.width > 0)) {
      drawProj(r, cam, this, 953, 0, '#FFB040', Math.max(0, 1 - this.alphaI / 255), this.w);
      return;
    }
    const fh = img.height / 5;
    ctx.save();
    ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = Math.max(0, 1 - this.alphaI / 255);
    const sw = img.width, sh = fh;
    const ds = this.w / sw;
    ctx.drawImage(img, 0, Math.round(this.frame * fh), sw, Math.round(fh),
      -(sw * ds) / 2, -(fh * ds) / 2, sw * ds, fh * ds);
    ctx.restore();
  }
}


// ==================== 雨云魔杖 1244 / 猩红魔杖 1256 云弹家族(aiStyle 45 1:1) ====================
// 机制(Projectile.cs:28351-28520 + Player.cs:48745-48752 + Kill 钩 :76032-76037):
//  ①施法:杖尖生成 237/243 移动云,速度=瞄准×shootSpeed(16),ai[0]/ai[1]=光标世界坐标(锚)。
//  ②移动云:直线飞行,过锚逐轴【置零该轴速度】(:28361-28371),双轴齐停 → Kill;
//    Kill 钩(:76032-76037)按死亡点 Center 生成 238/244 降雨云。
//  ③降雨云:54×28 tileCollide=false,ai[1]=生存计数,≥18000 起 alpha+5/t 至 >255 亡
//    (5min 寿命);受阻探针=云底中缝 2px×向下 20px 像素盒(Collision.SolidTiles,云底
//    贴地才算受阻,帧 0-2);
//    开阔每 >8t(238)/>10t(244) 从云底 ±14px 落 friendly 雨滴 239/245(vy 5,承 damage);
//    每 10t 同主同型存活计数:238 活>2 / 244 活>1 → 最老者 ai[1]=18000 起淡出
//    (雨云魔杖可并存 2 朵、猩红魔杖 1 朵)。
//  ④雨滴 239/245:4×40,vy=5/子步 恒速下落(EU=1 → 一 tick 两子步=10px/t),tileCollide
//    即亡,penetrate 239=5/245=2;微光液满液 vy 反转(:28503-28508);alpha 50/100;
//    timeLeft=300 每子步递减(:17307)=150 实 tick;全场同型共享免疫 10t(:3211);
//    Kill 尘 154/114(:75964-75993)。
//  多人:本地权威实体,MP spawn-kind 序列化未接(登记——v3 协议 4=MagicProj 族外)。
const RAIN_CLOUD_MOVE = new Set([237, 243]);
const RAIN_CLOUD_RAIN = new Set([238, 244]);

/** 全场同型共享静态免疫表——雨滴 239/245 `usesIDStaticNPCImmunity=true +
 *  idStaticNPCHitCooldown=10`(SetDefaults :3211-3212/:3277-3278)= 同型所有雨滴共用
 *  一张免疫账(非每弹一张);proj1457.IdStaticSharedTable 同构,时间驱动免逐弹 tick。
 *  ★2026-09-03 红蓝定谳:曾用每弹私有 HitCooldown → 同一敌 10t 内可被多滴各中一次
 *  = 雨云 DPS 虚高。结构兼容 HitCooldown(extends)可直接喂 hitEnemies */
class RainDropSharedImmunity extends HitCooldown {
  private sm = new Map<number, number>();
  private readonly cdMs = Math.round(10 * 1000 / 60);    // 10t ≈ 167ms(60fps 基数)
  override tick(): void { /* 时间驱动,无逐拍衰减 */ }
  override ready(id: number, _cooldown: number): boolean {
    const now = Date.now();
    if ((this.sm.get(id) ?? 0) > now) return false;
    this.sm.set(id, now + this.cdMs);
    if (this.sm.size > 512) {
      for (const [k, v] of this.sm) if (v <= now) this.sm.delete(k);
    }
    return true;
  }
  /** ★清偿刀 U2（2026-10-01）：hitEnemies 读/写拆相（peek/ready）后本类须同拆——
   *  旧只覆写 ready 时,基类 peek 读私有空 map 恒真=行存在拒收面整失明,而
   *  hitEnemies 的 ready 调用已不承担拒收（写位后移）⇒ 双重结算。读面=sm 行在窗内
   *  即拒（与 ready 拒支同判）。 */
  override peek(id: number): boolean {
    return !((this.sm.get(id) ?? 0) > Date.now());
  }
  override clear(): void { this.sm.clear(); }
}
const RAIN_DROP_IMMUNE_239 = new RainDropSharedImmunity();
const RAIN_DROP_IMMUNE_245 = new RainDropSharedImmunity();

export class RainCloudProj extends Entity {
  w = 28; h = 28;
  damage: number;
  knockback: number;
  projId: number;
  critChance = 0.04;
  armorPen = 0;
  life = 3600;
  dead = false;
  /** 移动云=光标锚(ai[0]/ai[1]);降雨云/雨滴侧复用为生存计数(18000 起淡出) */
  private anchorX: number;
  private anchorY: number;
  private age = 0;
  private beat = 0;      // 雨滴节拍(ai[0])
  private fade = 0;      // 淡出量(alpha 累加)
  private rot = 0;
  private frameT = 0; private frame = 0;
  private sweepT = 0;    // localAI[0](10t 同型计数)
  private hitCd = new HitCooldown();
  private dropHits = 0;  // 雨滴 penetrate 5 计数
  /** ★BJ382：PVE 受理命中计数（原版 Projectile.numHits——SetDefaults :706 起始 0;
   *  :14263 受理后自增 ⇒ proc（:13877-79）读自增前值,首跳 0 档率 0.20;拒收不计数。
   *  字段名对齐 SpectreSoulProj.projPveNumHits 读口（PVP 反馈 BJ157-④ 单源） */
  pveNumHits = 0;

  // ---- ★通用湿段（Projectile.cs:16895-17113 共享体;2026-09-08 红队接入面 F5 清偿）----
  //  域 id = {237,243}（SetDefaults :3187-3194/:3257-3264：28×28 aiStyle45
  //  penetrate−1 netImportant,无 ignoreWater 行=缺省 false（:763）→ 受段;
  //  tileCollide 缺省 true）。★同族豁免四型走【预置面】（2026-09-08 残差五件批④）：
  //  238/244 降雨云（:3195-3205/:3265-3275 ignoreWater=true+tileCollide=false →
  //  湿段整段门恒闭）、雨滴 239/245（:3206-3218/:3276-3289 ignoreWater=true）——
  //  aiRain/aiDrop 头亦调共享体,豁免早退下只落出生预置（NewProjectile :10887-10893
  //  无条件跑:wet 采样+ignoreWater 反清+honey/shimmer 无条件写,原文无豁免支）+
  //  :17114-17117 shimmerWet 门（aiStyle45 ∉ Shimmer 任何支=:22719 缺省支无动作,
  //  不接 shimmer 钩=零开销;AI_045 雨滴微光反弹走【直读 tile】 :28503-28508,
  //  四型 AI 全程零湿旗消费=惰性面,补预置为 1:1 完整性）。
  //  插位=aiMove 头（fixedUpdate 237/243 支首调=tick 头）：AI_045 移动云支
  //  （:28351-28379 逐行核对）零湿旗消费 → 采样位等价;杀拍（过锚双轴齐停 → Kill 钩
  //  变 238/244 :28373/:76032）在本调用点之后=杀拍湿段照跑。
  //  阻尼：tileCollide=true → HandleMovement :17721-17764 湿支生效,乘进
  //  moveAndCollide dx/dy 位移入参（body.vx/vy=碰撞调整字段原样回读——过锚轴零化
  //  判定 :28361-28371 读【碰撞后速度】,不受阻尼污染;速度场不减）。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount :16984 置 10 / :17109-17112 逐拍 −1） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10893 等价;共享体首调自做=出生盒——
   *  237/243=杖尖、238/244=移动云死亡点、239/245=降雨云云底,生成拍均未位移同位） */
  presetDone = false;

  constructor(x: number, y: number, vx: number, vy: number, damage: number, knockback: number,
    projId: number, anchorX = 0, anchorY = 0) {
    super();
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.damage = damage; this.knockback = knockback;
    this.projId = projId;
    this.anchorX = anchorX; this.anchorY = anchorY;
    if (RAIN_CLOUD_RAIN.has(projId)) { this.w = 54; this.h = 28; }
    if (projId === 239 || projId === 245) {
      this.w = 4; this.h = 40;
      this.life = projectileData(projId)?.timeLeft ?? 300;   // timeLeft=300(:3210/:3292)
      this.hitCd = projId === 239 ? RAIN_DROP_IMMUNE_239 : RAIN_DROP_IMMUNE_245;
    }
  }

  // ---- MP spawn-kind 10 打包面（Game.netProjBroadcast kind10 支 ↔ netMakeProj case 10）----
  /** 过网面=仅施法移动云 237/243——死亡变体 238/244 与雨滴 239/245 各端本地 AI 衍生
   *  （过网=双生成，见 Game.netProjBroadcast kind10 支注） */
  static mpNetSyncable(projId: number): boolean { return RAIN_CLOUD_MOVE.has(projId); }
  /** tag=`projId,anchorX,anchorY`（锚=ai[0]/ai[1]，亚像素取整——判向门 cx<anchor 不可见差）；
   *  aux=击退×100（i16，收端 /100 还原）。与 fromNet 互为逆 */
  get netTag(): string {
    return `${this.projId},${Math.round(this.anchorX)},${Math.round(this.anchorY)}`;
  }
  get netAux(): number { return Math.round(this.knockback * 100); }
  /** kind10 反序列化（netMakeProj case 10 唯一入口；tag 畸形=锚 0 → 类内 `!=0` 门跳过） */
  static fromNet(x: number, y: number, vx: number, vy: number, dmg: number, aux: number,
    tag: string): RainCloudProj {
    const [pid, ax, ay] = tag.split(',').map(Number);
    return new RainCloudProj(x, y, vx, vy, dmg, aux / 100, pid || 237, ax || 0, ay || 0);
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (RAIN_CLOUD_MOVE.has(this.projId)) this.aiMove(game);
    else if (RAIN_CLOUD_RAIN.has(this.projId)) this.aiRain(game);
    else this.aiDrop(game);
  }

  draw(r: Renderer, cam: Camera): void {
    const a = this.fade > 0 ? Math.max(0, 1 - this.fade / 255)
      : this.projId === 239 ? 50 / 255 : this.projId === 245 ? 100 / 255 : 1;
    // ★SW-I1 帧通道(Main.cs:34923 projFrames>1 通支,:35047 source 高 num482−1):
    //  237/243=4 帧(Projectile_237 28×112)、238/244=6 帧(Projectile_238 54×168 /
    //  244 54×156)——缺 frames 实参走整图通支=帧高 28/26 未除帧数,四帧/六帧云
    //  竖排胶片条整体画出(用户实报);通支单帧源=(0,fh×frame,W,fh−1),锚点公式
    //  不变。239/245 雨滴 projFrames 表无项=1 → 帧支不触发,行为零变。
    //  帧推进序在 aiMove/aiRain(:28375-28379 >4t 循环 0-3 / :28397-28405 >8t
    //  开阔 0-5·受阻 0-2),与本处帧数表一致。
    drawProj(r, cam, this, this.projId, this.rot, '#B8CCE8', a, 0, false, false, 1,
      this.frame, projFrameCount(this.projId));
  }

  /** ①移动云(:28353-28379):直线飞行,过锚逐轴清速,双轴齐停 → 亡(Kill 钩原位变降雨云)。
   *  ★237/243 未关 tileCollide(SetDefaults 无该行)——撞墙/撞地同走 Kill → 钩子照样
   *  在受撞点变雨云(vanilla「云卡墙边也开始下雨」实况);管线轴零化视图先写回,
   *  到锚判定按【碰撞后速度】读(velocity==0 即该轴完成,与原版 AI 读数序一致)。
   *  ★2026-09-03 红蓝定谳(:28361-28371):过锚轴须【置零该轴速度】——原版判定门本身
   *  就是 `velocity=0` 赋值臂,漏置零=过锚轴继续全速漂移,另一轴到位时雨云落点已
   *  越过光标(斜射最早差 1 tick 起步,最远漂出数格)。
   *  ★R5(2026-09-03 登记确认,不改行为):原版 timeLeft 缺省 3600(:789)逐子步递减
   *  (:17307-17311 → 0 Kill → 同 Kill 钩 :76032 变 238/244),本仓移动云无递减。
   *  不可达论证:锚=光标世界坐标(screenToWorld 连续浮点,视口 800×600/zoom)距杖尖
   *  ≤~1000px、初速=shootSpeed 16px/t → ≤~63t 过锚 ≪ 3600t;受阻撞墙轴逐拍置零 →
   *  门内过锚臂双旗齐 → Kill 同达。唯一绕过 = 锚恰为 0.0(:28355 `!=0` 双门跳过,
   *  浮点测度零,负锚走比较臂照停)——维持现状=红蓝台账确认登记 */
  private aiMove(game: GameHooks): void {
    // ---- ★通用湿段（:16895-17113 共享体,tick 头插位——域/阻尼注见字段块）----
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater);
    const body = { x: this.x, y: this.y, w: this.w, h: this.h, vx: this.vx, vy: this.vy,
      onGround: false, hitWall: false, hitHead: false, collideY: false,
      hoik: true,   // ★FX34c 弹幕域 hoik=true（Body.hoik 注:原版 Projectile 全路径）
      tileCollide: true, dropThrough: false };
    // 水中位移阻尼（HandleMovement :17721-17764 湿支,tileCollide=true 消费）——
    // 乘进 dx/dy 位移入参,body.vx/vy 碰撞调整字段原样回读（勿在采纳处除回）
    const df = projWaterDragFactor(this);
    moveAndCollide(body, game.world, this.vx * df, this.vy * df);
    this.x = body.x; this.y = body.y;
    this.vx = body.vx; this.vy = body.vy;   // TileCollision 后写:受阻轴置 0(原版同)
    if (this.anchorX !== 0 && this.anchorY !== 0) {        // :28356 num333/334 != 0 门
      let flagX = false;
      let flagY = false;
      if (this.vx === 0 || (this.vx < 0 && this.cx < this.anchorX) || (this.vx > 0 && this.cx > this.anchorX)) {
        this.vx = 0;                                       // :28362-28364
        flagX = true;
      }
      if (this.vy === 0 || (this.vy < 0 && this.cy < this.anchorY) || (this.vy > 0 && this.cy > this.anchorY)) {
        this.vy = 0;                                       // :28367-28369
        flagY = true;
      }
      if (flagX && flagY) {
        this.dead = true;                                  // Kill(:28373)
        // Kill 钩(:76032-76037):死亡点 Center 生成 238/244(0 速驻留)
        const rain = new RainCloudProj(this.cx - 27, this.cy - 14, 0, 0, this.damage,
          this.knockback, this.projId === 237 ? 238 : 244);
        (game as unknown as { entities: { add: (e: unknown, b: string) => void } })
          .entities.add(rain, 'projectiles');
        return;
      }
    }
    this.rot += this.vx * 0.02;                            // :28374
    this.frameT++;
    if (this.frameT > 4) { this.frameT = 0; this.frame = (this.frame + 1) % 4; }
  }

  /** ②降雨云(:28388-28477) */
  private aiRain(game: GameHooks): void {
    // ---- ★出生预置（:10887-10893;豁免四型亦跑,域/惰性面注见字段块）——驻留弹零速
    //      tileCollide=false → 首调位=死亡点出生盒≡原版 NewProjectile 同位;其后逐拍
    //      调用走 :16895 豁免早退零开销（不入 lava/wet 碰撞扫描）。
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater);
    this.age++;
    if (this.age >= 18000) {                               // 5min 寿终 → 淡出
      this.fade += 5;
      if (this.fade > 255) { this.fade = 255; this.dead = true; }   // :28411-28416 alpha>255 才 Kill
      return;                                              // 淡出期不降雨(:28417 else-if 链)
    }
    const st = game.world.store;
    // flag21(:28391-28396):Collision.SolidTiles(new Vector2(Center.X, bottomY), 2, 20)
    // =【像素盒】非 tile 带——Collision.cs:3463-3465 (int)(pos/16)..(int)((pos+size)/16)
    // 转格、:3468-3493 逐格 INCLUSIVE 判 → 实际= 云底中缝 2px 宽 × 向下 20px 深的小探针
    // (1-2 列 × 2-3 行)。出界(:3472-3485 startX<0 / endX>=maxTilesX / startY<0 /
    // endY>=maxTilesY-40)=受阻。★曾按「2 格宽×20 格深」误译=云下 20 格内有任意实心
    // 即判受阻不降雨(户外近地施法整段哑弹,与原版「只挡云底贴地」语义完全两回事)
    const cxPix = Math.trunc(this.cx);                     // num335 = (int)Center.X
    const byPix = Math.trunc(this.y + this.h);             // num336 = (int)(position.Y + height)
    const sx = Math.floor(cxPix / 16), ex = Math.floor((cxPix + 2) / 16);
    const sy = Math.floor(byPix / 16), ey = Math.floor((byPix + 20) / 16);
    let open = true;
    if (sx < 0 || ex >= st.w || sy < 0 || ey >= st.h - 40) {
      open = false;                                        // :3472-3485 出界=受阻
    } else {
      for (let yy = sy; yy <= ey && open; yy++) {
        for (let xx = sx; xx <= ex; xx++) {
          if (RainCloudProj.probeSolid(st, xx, yy)) { open = false; break; }
        }
      }
    }
    this.frameT++;
    if (this.frameT > 8) {
      this.frameT = 0;
      this.frame = open ? (this.frame >= 5 ? 0 : this.frame + 1) : (this.frame >= 2 ? 0 : this.frame + 1);
    }
    if (open) {
      this.beat++;                                         // ai[0]++
      if (this.beat > (this.projId === 244 ? 10 : 8)) {    // :28428 >10 / :28436 >8
        this.beat = 0;
        // NewProjectile(num335±14, num336=云底, 0, 5)——Center 语义 → 左上回写。
        // ★2026-09-03 红队纠偏:Next(-14, 15) = [-14,14](29 值),曾写 rand*30-15
        //  = [-15,14] 低端多 1px
        const drop = new RainCloudProj(
          this.cx + (Math.floor(Math.random() * 29) - 14) - 2,
          this.y + this.h - 20, 0, 5, this.damage, 0,
          this.projId === 238 ? 239 : 245);
        (game as unknown as { entities: { add: (e: unknown, b: string) => void } })
          .entities.add(drop, 'projectiles');
      }
    }
    // 同主同型存活计数(:28457-28477):10t 一扫;238 活>2 / 244 活>1 → 最老者起淡出
    this.sweepT++;
    if (this.sweepT >= 10) {
      this.sweepT = 0;
      let count = 0, oldest: RainCloudProj | null = null, oldestAge = -1;
      for (const e of (game as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles) {
        if (e instanceof RainCloudProj && e.projId === this.projId && !e.dead && e.age < 18000) {
          count++;
          if (e.age > oldestAge) { oldestAge = e.age; oldest = e; }
        }
      }
      if (count > (this.projId === 244 ? 1 : 2) && oldest) oldest.age = 18000;
    }
  }

  /** ③雨滴(:28478-28510):vy=5 恒速下落,撞格亡,微光液满液 vy 反转。
   *  ★2026-09-03 红蓝定谳:239/245 extraUpdates=1(SetDefaults :3211/:3293,数据表已载)
   *  → 原版 Update 子步环(:16781-17345)一 tick 跑【两次】AI+位移+Damage+timeLeft--
   *  (:17307 递减也在环内)——落速 10px/t、timeLeft=300 ÷ 2 = 150 实 tick 寿命。
   *  曾单步 5px/t + life 3600 = 落速减半且永超时。AI 先于位移(AI():16880 →
   *  HandleMovement:17120)——微光反转当子步即生效 */
  private aiDrop(game: GameHooks): void {
    // ---- ★出生预置（:10887-10893;豁免四型亦跑,注见 aiRain 头/字段块）——首调位=
    //      云底出生盒（首拍 AI/位移前=原版 NewProjectile 同位）;其后调用全走豁免
    //      早退（段体整跳）,逐子步/逐拍调用等价,取逐拍一次省扫。
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater);
    const st = game.world.store;
    const substeps = (projectileData(this.projId)?.extraUpdates ?? 0) + 1;   // MaxUpdates(:556-565)
    for (let sub = 0; sub < substeps && !this.dead; sub++) {
      const tx = Math.floor(this.cx / 16), ty = Math.floor((this.y + this.h) / 16);
      if (st.inBounds(tx, ty) && st.liquid[st.idx(tx, ty)] === 255
        && st.liquidType[st.idx(tx, ty)] === LIQUID_TYPE.SHIMMER && this.vy > 0) {
        this.vy *= -1;                                   // :28503-28508
      }
      const body = { x: this.x, y: this.y, w: this.w, h: this.h, vx: this.vx, vy: this.vy,
        onGround: false, hitWall: false, hitHead: false, collideY: false,
        hoik: true,   // ★FX34c 弹幕域 hoik=true（Body.hoik 注:原版 Projectile 全路径）
        tileCollide: true, dropThrough: false };
      moveAndCollide(body, game.world, this.vx, this.vy);
      this.x = body.x; this.y = body.y;
      if (body.hitWall || body.collideY || body.hitHead) { this.killDrop(game); return; }
      // ★BJ382（2026-09-28）：雨滴 239/245 幽灵兜帽吸血 proc（Projectile.cs:13877-79
      //  Damage() 通用 on-hit 段,数据面 magic=true ⇒ 原版雨云雨滴本就吸血）。
      //  ★清偿刀 U2（2026-10-01）：ghostHealProc+pveNumHits++ 上收 hitEnemies 受理位
      //  单源（本回调旧内嵌两行撤除=防双计）——本环全调用方同走 :13877-79,雨滴数据面
      //  magic=true 由单源数据门自动分流治疗面,行为零漂移（bj382 基线锁保形）。
      //  ★BJ385 修正（BJ382 登记债清偿）：dropHits++（penetrate--）从 onHit（命中即调
      //  拒收亦跑=非受理位）移入 onAccepted——原版 penetrate--（:14189-14196）在
      //  Damage_PVE_Inner 受理面内,拒收跳（:12634-12637 immune 残窗 return）不耗穿透;
      //  旧码敌怪免疫残窗内拒收跳照虚耗穿透数=雨滴提前消亡。原版序 proc(:13877-79)
      //  → penetrate--(:14189) → numHits++(:14263)
      //  ★BJ393 件2（2026-09-28 级联差单刀落）：onAccepted 判据 acceptedHere→!vanillaGated
      //  ——旧「hurt 返真」实为击杀位（Enemy.hurt 布尔返真=死亡管线跑完,普通未致命
      //  命中尾档 :15037/血尽级联 :14369 族返假）→ 实机雨滴吸血近零、穿透数除击杀外
      //  永不消耗。现=受理面（非门拒即 proc/耗穿/计数,与原版 :13875-13880/:14189/
      //  :14263 无死亡复查同相;门拒 iframes 残窗跳仍静默=BJ385 判别面保形;
      //  血尽级联（毁灭者体节致命拍）proc/耗穿/回收照跑=判别面 bj393 锁）。
      hitEnemies(this, game, this.hitCd, 10, 0, this.armorPen, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined,
        (ent) => {
          this.dropHits++;                                      //（:14189 penetrate-- 受理位）
        });
      if (this.dropHits >= (projectileData(this.projId)?.penetrate ?? 5)) {   // 239=5(:3213)/245=2(:3280)
        this.killDrop(game);                             // penetrate==0 → Kill(:17313) → 尘
        return;
      }
      this.life--;                                       // timeLeft-- 每子步(:17307)
      if (this.life <= 0) { this.killDrop(game); return; }
    }
  }

  /** Kill 钩(:75964-75993):下落态(vy>0)溅花尘——239=154(带重力)/245=114(noGravity),
   *  盒 (x, y+h-2, 2, 2) + position.X-=2 + alpha 38 + vel×0.1 + vel-=oldVel×0.25 + scale 0.95 */
  private killDrop(game: GameHooks): void {
    this.dead = true;
    if (this.vy <= 0) return;                            // :75965/:75979 仅下落态
    const d = game.spawnDust?.(this.x, this.y + this.h - 2, 2, 2, this.projId === 239 ? 154 : 114);
    if (d) {
      d.x -= 2;
      d.alpha = 38;
      d.vx = d.vx * 0.1 - this.vx * 0.25;
      d.vy = d.vy * 0.1 - this.vy * 0.25;
      d.scale = 0.95;
      if (this.projId === 245) d.noGravity = true;
    }
  }

  /** Collision.SolidTiles 逐格判定(Collision.cs:3488-3491):active && !inActive &&
   *  tileSolid && !tileSolidTop(平台/家具顶豁免;坡/半砖不豁免——SolidTiles 不查,
   *  LineOfSight.plainSolid 同串);Main.tile null(:3487)与本仓 flags==0 幽灵格同义 */
  private static probeSolid(st: GameHooks['world']['store'], x: number, y: number): boolean {
    if (!st.inBounds(x, y)) return false;
    const i = st.idx(x, y);
    if (st.flags[i] === 0) return false;
    if (st.wire[i] & TileStore.WIRE_ACTUATED) return false;   // inActive()
    const d = TILE_DEFS[st.type[i]];
    return !!d && d.solid && !d.platform;                // tileSolid && !tileSolidTop
  }
}

// ================= 水晶蛇 3210 → 523（aiStyle 95 独占族,Projectile.cs:33572-33597） =================
// 1457 定谳:非蛇形追踪弹——直飞 → 相位闸到点上浮+横向阻尼;详见本文件头台账。

export const CRYSTAL_SERPENT_PROJ = 523;

/** 出手速度掷（Player.cs:48892-48902 逐行 1:1,掷序 = X,Y,速度,X,Y,相位 = 原版语句序）:
 *  ①方向向量(=杖尖→光标 raw 差向量 :47687-47688,不乘 shootSpeed)X ±Next(31)×0.04=±1.2 /
 *    Y ±Next(31)×0.03=±0.9 → Normalize(:48896)——归一化在前 ⇒ shootSpeed 8.5 只进方向
 *  ②×Next(70,91)×0.1 = 7.0..9.0(:48897)
 *  ③再来一轮同幅抖动(:48898-48900)→ 终速域 ≈ [7−1.5, 9+1.5] = 5.5..10.5
 *    (抖动向量模长上界 √(1.2²+0.9²)=1.5)
 *  相位 = Next(20)(:48902 第 10 参 = ai[0],自由段 = 31−相位 拍)。
 *  rand 可注入（测试钉值）;缺省 Math.random。零向量方向保持 (0,0) 防 NaN（原版
 *  Normalize 除零行为,仅在光标=杖尖时可达,实际不可触）。 */
export function rollCrystalSerpentVelocity(aimX: number, aimY: number,
  rand: () => number = Math.random): { vx: number; vy: number; phase: number } {
  const jx = () => (Math.floor(rand() * 61) - 30) * 0.04;   // Main.rand.Next(-30,31)*0.04f
  const jy = () => (Math.floor(rand() * 61) - 30) * 0.03;   // Main.rand.Next(-30,31)*0.03f
  let x = aimX + jx();                                       // :48893-48894
  let y = aimY + jy();
  const len = Math.hypot(x, y);                              // :48895-48896 Normalize
  if (len > 0) { x /= len; y /= len; }
  const spd = (70 + Math.floor(rand() * 21)) * 0.1;          // :48897 Next(70,91)*0.1 = 7.0..9.0
  x *= spd; y *= spd;
  x += jx();                                                 // :48898-48900 二轮抖动
  y += jy();
  return { vx: x, vy: y, phase: Math.floor(rand() * 20) };   // :48902 Next(20)
}

export class CrystalSerpentProj extends Entity {
  w = 32; h = 32;                                  // SetDefaults :5931-5932(贴图+NPC 命中盒)
  damage: number;
  knockback: number;
  projId = CRYSTAL_SERPENT_PROJ;
  critChance = 0.04;
  armorPen = 0;
  /** timeLeft 全局缺省 3600(:789)——实际上浮必先出世界界(:16790),本值仅兜底 */
  life = 3600;
  dead = false;
  /** 冰霜引擎资格（ranged=true :5935 → melee||ranged 门 :11512-11515;onHit 自补,
   *  绕开 hitEnemies 只挂 melee 门的引擎级偏差） */
  frostEligible = true;
  /** ai[0] 相位(出手 rand(20) 传入):<=30 期间每拍自增不转向——自由段 = 31−相位 拍 */
  private phase: number;
  /** alpha 淡入(XNA 语义:255=全透;SetDefaults :5935 → AI −20/拍 下钳 100 :33573-33582) */
  private alpha = 255;
  private localAI0 = 0;
  private rot = 0;                                 // rotation = vx×0.1(:33592)
  // ---- ★通用湿段（Projectile.cs:16895-17113 共享体;2026-09-08 红队接入面 F6 清偿
  //      ——旧内联 WetCollision 三旗探针（原 :8005-8007）退役迁共享体）----
  //  域 id = {523}（SetDefaults :5931-5940：32×32 aiStyle95 ranged penetrate1
  //  friendly alpha255,无 ignoreWater 行=缺省 false（:763）→ 受段）。
  //  位序（红队 F6 口径「AI 读上拍/位移消费当拍」）：⑤ AI 浮升支读【上拍】样本 →
  //  ⑥ 共享体（AI 后/位移前=原版 Update 位序 :16880→:16895→:17578）→ ⑦ 位移经
  //  liqFactor 通道消费【当拍】旗（=原版 HandleMovement :17721 湿支读当拍子步湿段旗）。
  //  ★出生预置（NewProjectile :10886-10893）原版在【生成时点】写旗、首拍 AI 浮升支
  //  :33593 即读预置值——本类段位在 AI 后,故首拍以「AI 前例外位」跑一次预置+段体
  //  （首拍盒未移动 P_1≡P_0,同位等价;presetDone 兼首拍闩防双跑）,此后各拍走 ⑥ 位。
  //  补齐面：lavaWet 粘滞（:16906-16911 只置不清）/出入水溅花+音（wetSplashStepShared,
  //  wetCount==0 ∧ !wet 门 :16948/:17029-17031）/wetCount 冷却窗（:16984/:17109-17112）/
  //  出生预置。523 ∉ IsDestroyedByWater → 无 kill 钩;aiStyle95 ∉ Shimmer() 任何支
  //  （:22564-22719）→ 缺省支无动作。阻尼：tileCollide 缺省 true（SetDefaults 无该行）
  //  → 湿支生效;档位取 projWaterDragFactor（wet 前置门 :17721 `else if (wet)` 支——
  //  旧内联 liqFactor 三元缺该门,wet=false+honey/shimmer 残留态会误吃档,随共享体校正）。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount :16984 置 10 / :17109-17112 逐拍 −1） */
  wetCount = 0;
  /** 出生预置已做（一次;兼首拍「AI 前例外位」闩,见上注） */
  presetDone = false;
  private hitCd = new HitCooldown();

  constructor(x: number, y: number, vx: number, vy: number, damage: number,
    knockback: number, phase = 0) {
    super();
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.damage = damage; this.knockback = knockback;
    this.phase = phase;
  }

  /** 绘制不透明度 = (255−alpha)/255（XNA alpha 语义;终值 100 → 0.6078,非全不透明） */
  get drawAlpha(): number { return Math.max(0, (255 - this.alpha) / 255); }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.dead) return;
    // ① 世界边界出界 = active=false 无 Kill 特效（Update :16790 aiStyle!=3 支——
    //    上浮必出顶界,Item_54/尘花只属 Kill 路径,此处静默消散）
    const st0 = game.world.store;
    if (this.x <= 0 || this.y <= 0
      || this.x + this.w >= st0.w * TILE || this.y + this.h >= st0.h * TILE) {
      this.dead = true;
      return;
    }
    // ①′ 首拍例外位：出生预置（:10886-10893）+段体在 AI 前跑一次——原版预置在
    //    NewProjectile 生成时点,首拍 AI 浮升支 :33593 读预置值（首拍盒未移动=同位;
    //    presetDone 兼首拍闩,该拍 ⑥ 位跳过防双跑,论证见字段块注）
    const wetFirstTick = !this.presetDone;
    if (wetFirstTick) {
      projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
        this.projId, !!projectileData(this.projId)?.ignoreWater);
    }
    // ② 淡入(:33573-33582):localAI[0] 先数 3 拍,其后 alpha −20/拍,下钳 100
    if (this.localAI0 > 2) {
      this.alpha -= 20;
      if (this.alpha < 100) this.alpha = 100;
    } else {
      this.localAI0++;
    }
    // ③ 相位闸上浮(:33583-33591):自由段 = 31−相位 拍;其后 vy −0.05/拍(软帽 −8)+vx ×0.98
    if (this.phase > 30) {
      if (this.vy > -8) this.vy -= 0.05;
      this.vx *= 0.98;
    } else {
      this.phase++;
    }
    // ④ 旋转 = vx × 0.1(:33592;"蛇"的全部摆动感 = 贴图随横速微倾)
    this.rot = this.vx * 0.1;
    // ⑤ 液体浮升【无视相位闸】(:33593-33596;wet 位 = 上一拍湿判,首拍=出生预置值
    //    ——原版序 AI(:15434) 先于湿判(:16901),1 拍滞后照抄)
    if (this.wet) {
      if (this.vy > 0) this.vy *= 0.98;
      if (this.vy > -8) this.vy -= 0.2;
      this.vx *= 0.94;
    }
    // ⑥ 通用湿段（:16895-17113 共享体,AI 后/位移前=原版位序;首拍已在 ①′ 跑）
    if (!wetFirstTick) {
      projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
        this.projId, !!projectileData(this.projId)?.ignoreWater);
    }
    // ⑦ 位移+tile 碰撞:tile 盒 = 中心 10×10 缩盒(:20072-20075,锚 0.5,0.5 :19982-19984,
    //    32×32 盒左上回写差 11px);湿态位移折减 = Body.liqFactor 通道——档位=
    //    projWaterDragFactor（水 .5/蜂蜜 .25/微光 .375 = wetVelocity 派生 :17721-17764,
    //    wet 前置门=:17721 `else if (wet)` 支语义）;fallThrough 缺省 true(:17587) →
    //    dropThrough=true 穿平台;受阻 = 通用默认支 HitTiles+Kill(:18160-18166)
    const body = { x: this.x + 11, y: this.y + 11, w: 10, h: 10, vx: this.vx, vy: this.vy,
      onGround: false, hitWall: false, hitHead: false, collideY: false,
      hoik: true,   // ★FX34c 弹幕域 hoik=true（Body.hoik 注:原版 Projectile 全路径）
      tileCollide: true, dropThrough: true,
      liqFactor: projWaterDragFactor(this) };
    moveAndCollide(body, game.world, this.vx, this.vy);
    this.x = body.x - 11; this.y = body.y - 11;
    if (body.hitWall || body.collideY || body.hitHead) { this.killFx(game); return; }
    // ⑧ 命中敌(Damage_GetHitbox :15037 = 全 32×32 盒,523 无特例;penetrate=1 首中耗尽 →
    //    Damage() 尾 Kill;Poisoned 600..1740t 由 hitEnemies 尾 applyProjStatus(523) 表驱动)
    // ★BJ285（BJ232 死亡段割面族,2026-09-22）：CutTiles（Projectile.cs:12517 调用点/方法 :15276）先于 Damage_PVE
    //  （:12523）——523 水晶蛇弹 penetrate=1 首中即亡拍【照割】（SetDefaults :5931-5940,
    //  aiStyle 95/friendly/ranged）;中央割 !e.dead 门=死亡拍整缺 → BJ260 前置习语。
    //  523 过两道门（CanCutTiles :15407 两表均无;Damage_CanDealDamage :12461 无）。
    cutTilesBox(game, this.x, this.y, this.w, this.h);
    // ★BJ388 件1 联动：523 = flag3 单发弹（penetrate=1 且无 usesLocalNPCImmunity/
    //    usesIDStaticNPCImmunity,:12634 定义）→ 原版免疫门整体豁免（:12636 flag3 支,
    //    对免疫残窗敌照结算照杀）;hurtPierce 位补 1（BJ339 轴,与 405 泡泡同档）——
    //    否则件1 受理面门（iframes>0 静默）会让 523 穿过残窗敌不炸=偏离原版
    hitEnemies(this, game, this.hitCd, 9999, 0, this.armorPen, (ent) => {
      if (this.frostEligible) {
        // 冰霜盔甲引擎(melee||ranged 门 :11512-11515,ranged 弹在门内)
        applyFrostBurn((game.player as unknown as { equipStats: { frostBurn: boolean } })
          .equipStats.frostBurn, ent as unknown as Record<string, number>);
      }
      this.killFx(game);                           // penetrate 1 → 首中即亡(Kill 钩)
    }, undefined, false, undefined, 1);
    if (this.dead) return;
    // ⑨ 寿终(timeLeft 3600 :789 → Kill 同钩)
    this.life--;
    if (this.life <= 0) this.killFx(game);
  }

  draw(r: Renderer, cam: Camera): void {
    drawProj(r, cam, this, this.projId, this.rot, '#E58CFF', this.drawAlpha);
  }

  /** Kill 钩(:74622-74633):Item_54 + 25×dust256(盒内随机径向 Next(1,30)×0.1,noGravity,
   *  dust.alpha=弹 alpha——视觉近似:统一取盒中心/径向 1.5/粉晶色,尘花域全盒 32×32) */
  private killFx(game: GameHooks): void {
    if (this.dead) return;
    this.dead = true;
    game.playSfxFiles(['Item_54'], 1, this.cx, this.cy);
    game.spawnParticles(this.cx, this.cy, '#E58CFF', 25, 1.5, { life: 60, grav: 0, size: 4 });
  }
}

// ============================================================================
