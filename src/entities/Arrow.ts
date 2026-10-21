// 箭矢/通用直飞·抛物线投射物（原版 Projectile type 1/2、aiStyle 1/2 主干，Projectile.cs:546-566 + AI_001/AI_002）：
// 重力 0.3/tick（aiStyle1/2 通用常量；直飞弹传 0）、timeLeft 1200、旋转 atan2(vy,vx)+π/2（AI_001 尾部 L54877）、
// 原版贴图 Projectile_N.png；命中敌人伤害/击退/暴击（穿透>1 时同敌免疫防连击）；
// 命中 tileCut 砍草/碎罐（Projectile.CutTiles）；命中实心块 1/3 概率回收掉落。
import { Entity } from './Entity';
import { drawStripTrail, type TrailPt } from '../fx/TrailShader';
// L5 长尾批：弧线引矢家族/银箭/微光箭编排收编（fx/orchestraFx 池）
import { harpyCharmFamilyFx, silverBulletSparkleFx, shimmerArrowFx,
  deadCellsBarnacleShotFiringFx, deadCellsBarrelExplosionFx } from '../fx/orchestraFx';
import { ParticleOrchestraType } from '../net/syncModules';
import { SpriteAtlas, upgradeToBitmap } from '../assets/SpriteAtlas';
import { applyProjStatus, applyFrostBurn, debuffWriteAllowed } from './projStatus';
import { applyThrownKillFx } from './ThrowKillFx';
import { canBeChasedBy, hitCritters, hitPlayer, hitTownNpcs, playerCanHitEnemy, statusPlayer, noteVanillaProjImmune, tryReflectProjectile, tryReflectShimmerSlimeHit, applyBannerDamageDealt, rollGolemSentryCrit } from './projTargets';
import { spawnNpcHitDust } from './NpcHitDust';   // ★BJ704-G10（R2-F5）：614 stuck 每 30t HitEffect(0,1.0) 血尘脉冲（type-only Enemy 依赖,无运行时环）
import type { Enemy } from './Enemy';
import { projImmuneFaceOf } from '../data/vanillaProjImmuneFaces';   // ★BJ467⑦ flag3 usesIDStatic 排除面（SetDefaults 三旗提取表）
import { resolveWhipTagHit, SUMMON_TAG_MUL, darkHarvestChain } from './WhipTag';
import { ghostHurtOnHit, playerHasGhostHurt, spectreVictimEligible, vanillaFlag10LifeMaxOk, ghostHealProc } from './SpectreSoulProj';
import { nebulaBoosterOnHit } from './NebulaBooster';   // ★BJ424 星云套装 on-hit 单源
import { projectileSnapStrikeBonus } from '../stats/SnapStrike';
import { canHit, canHitLine } from '../physics/LineOfSight';
import { wetCollision } from './npcLiquid';   // lavaCollision 随湿段收口迁 projWetSection 共享体（2026-09-08）
import { projectileWetSection, projShimmerStep, projWaterDragFactor, type ProjShimmerFace } from './projWetSection';

import { LIQUID_TYPE } from '../world/TileStore';
import { LCG32 } from '../fx/LightningGenerator';
import { f32 } from '../stats/ScaleStats';
import { TILE } from '../core/constants';
import { gameTickCount } from '../core/GameTime';   // ★BJ704-G10：idStaticCheck 墙钟→GTW tick 钟（G1 债②,MinionProj.IdStaticBucket 同源）
import { TILE_DEFS, TILE_BY_KEY } from '../data/tiles';
import { PROJ_ALPHA_MOD, projConstFullbright, projConstTint, projLerpLiftK, type ProjAlphaMod } from '../data/vanillaProjAlpha';
import { tintedTex } from '../render/StringLine';   // ★BJ-C9 F4：tint 档 add 面烘焙（flatten=false 保形,BJ700-C）
// ★BJ219 弹幕域 oldPos 残影族（Main.cs:30609-31360 通用表+专用帧残影四弹）——
// 记录面 ProjGhostRing（Projectile.cs:17197-17300 逐式）+ 绘制面 drawProjGhosts
// （参数/色/帧锚全表在 projGhostTrail.ts 头注;排除面=本仓已有独立实现的 id 集）
import { ProjGhostRing, drawProjGhosts, drawGreenBandTrail, projTrailingMode, notifyProjSpriteOverride, onProjSpriteOverride } from './projGhostTrail';
import type { GameHooks } from './types';
import type { Renderer } from '../render/Renderer';
import type { Camera } from '../render/Camera';


/** 原版投射物贴图懒加载（Projectile_1.png = 木箭、Projectile_2.png = 燃烧箭，泛用所有 id） */
const spriteCache = new Map<number, ImageBitmap | HTMLImageElement>();
/** 绳索线圈弹→绳 tile key（aiStyle35 撞块铺绳,AI_035 :27655-27662 num274 映射:
 *  475→353 藤/506→366 蛛网/505→365 丝/default→213——171/3005 等线圈件共用。
 *  ★1458 AI_035 默认支 num274=213 对任意 aiStyle35 弹生效(:27619 Projectile.cs),
 *  985 普通绳圈 shoot 171(SetDefaults :2572 同族 14×14/tileCollide=false/t400)此前
 *  未登记=纯扔箭撞块无效果(2026-08-30 孤儿武器 A 波工单1) */
const ROPE_COIL_TILE: Record<number, string> = {
  // ★476 非绳圈(=aiStyle185 魔法弹 200×200,P.cs:5502-5509,无物品 shoot 它),
    // A 簇审计防御性移除——曾有误员会让假想 476 弹也能铺绳
  171: 'v_213_rope', 475: 'v_353_vine_rope', 505: 'v_365_silk_rope', 506: 'v_366_web_rope',
};
/** 绳圈弹→余料返还件 { coil: 原圈件, loose: 散绳件 }（Projectile.cs:79303-79316，
 *  Kill→Kill_ExplodeTiles(:78995) 四型同构段：ai[1]==0 → 原圈 ×1；1≤ai[1]<10 →
 *  散绳 ×(10−ai[1])；满 10 无返还。圈/散对配自 Item.cs SetDefaults：
 *  case 985 shoot=171(:12699)/case 3005→475(:27734)/case 3079→505(:28549)/
 *  case 3080→506(:28534)；散绳 = 铺下 tile 的 drop 件（tiles.ts D-6）） */
const ROPE_COIL_RETURN: Record<number, { coil: number; loose: number }> = {
  171: { coil: 985, loose: 965 },
  475: { coil: 3005, loose: 2996 },
  505: { coil: 3079, loose: 3077 },
  506: { coil: 3080, loose: 3078 },
};
/** 晶洞弹 772 尾迹/爆裂宝石尘（Projectile.cs:56499 randFromList(86-91,138) 尾迹、
 *  :76569/:76580 Kill 爆两段 randFromList(86-90)） */
const GEODE_GEM_DUST = [86, 87, 88, 89, 90];
/** DropGeodeGems 池（Projectile.cs:80305——181 红宝石/182 钻石/180 绿宝石/
 *  178 黄玉/179 蓝晶/177 紫晶/999 琥珀，顺序=源码字面序,RNG 序敏感勿重排） */
const GEODE_GEM_POOL = [181, 182, 180, 178, 179, 177, 999];
/** 在飞去重 + 失败 10s 冷却(2026-08-19 前把未加载完的 Image 先塞缓存:一次失败
 *  = 坏 Image(width 0)永久驻缓存,该弹幕本会话隐形且无重试——与 ensureVImage
 *  的 TTL 语义对齐;失败顺带驱逐 SW 缓存同路径条目防重吃坏字节) */
const spritePending = new Set<number>();
const spriteFailTtl = new Map<number, number>();
export function projSprite(projId: number): ImageBitmap | HTMLImageElement | null {
  const hit = spriteCache.get(projId);
  if (hit !== undefined) return hit;
  if (typeof Image === 'undefined') return null;
  const at = spriteFailTtl.get(projId);
  if (at !== undefined) {
    if (performance.now() - at > 10_000) spriteFailTtl.delete(projId);
    else return null;
  }
  if (spritePending.has(projId)) return null;
  spritePending.add(projId);
  const im = new Image();
  // SW-AA1 2026-09-04：land 提升到 projSprite 作用域——并行会话 onerror 重试块
  // （retry.onload→land(retry)）跨闭包引用 onload 局部 const=TS2304+运行时
  // ReferenceError（FakeFish 处置范例：最小修复保其重试特性）。语义恒等：
  // land 只闭包 projId。
  const land = (x: ImageBitmap | HTMLImageElement) => { if (!spriteCache.has(projId)) spriteCache.set(projId, x); };
  im.onload = () => {
    spritePending.delete(projId);
    spriteFailTtl.delete(projId);
    // has 门(双重):setProjSpriteOverride(素材包)可能已在飞行期间同步写入——
    // 晚到的原版图/bitmap 不得覆盖包注入图。非 bitmap 环境(node 测试/逃生门)
    // 直接落 Image——upgradeToBitmap 在 USE_BITMAP=false 时两个回调都不调
    if (!SpriteAtlas.USE_BITMAP) { land(im); return; }
    upgradeToBitmap(im, land, () => land(im));   // bitmap 失败退 Image
  };
  im.onerror = () => {
    spritePending.delete(projId);
    // ★瞬态失败不驱逐(2026-09-04 线上实锤"Tiles_123/NPC_357 命中即删"=
    //  驱逐了完好条目,累计 94 条天空族被自删):一次 onerror 可能是 SW 控制权
    //  空窗/网络瞬态——重试一次,成功=缓存完好。★evict 调用整体移除:发布形态
    //  缓存内容全部来自自家 zip(CRC 校验),不存在"投毒来源",驱逐只有误伤;
    //  持续性失败由 15s TTL 重试+对账补下自愈。
    const retry = new Image();
    retry.onload = () => { land(retry); };
    retry.onerror = () => {
      spriteFailTtl.set(projId, performance.now());
    };
    retry.src = im.src;
  };
  im.src = `sprites/vanilla/Projectile_${projId}.png`;
  // 同步装载替身(node 测试的 src setter 即触发 onload)当次调用即可用;
  // 浏览器真实 onload 异步,这里仍 null,消费方下帧重查自愈
  const synced = spriteCache.get(projId);
  return synced ?? null;
}

/** 调试报告用:在场弹幕的贴图健康采样(id → 缓存命中/尺寸;cached=false 且
 *  弹幕早已在场=加载链断了,F5 报告一眼定位) */
export function projSpriteHealth(ids: Iterable<number>): Array<{ id: number; cached: boolean; w: number; h: number }> {
  const out: Array<{ id: number; cached: boolean; w: number; h: number }> = [];
  const seen = new Set<number>();
  for (const id of ids) {
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    const s = spriteCache.get(id);
    out.push({ id, cached: !!s, w: s?.width ?? 0, h: s?.height ?? 0 });
    if (out.length >= 12) break;
  }
  return out;
}

/** 预热弹幕贴图(2026-08-13,用户报"发射阶段回退兜底,过一会才正确"):
 *  懒加载下首发射击时表未就绪弹体短暂隐形(★P0-B 2026-09-27:旧短线兜底已摘,
 *  acc 态逐帧路径 op=高频上传病——见 draw 体注)。进图/背包变化时把武器/弹药的
 *  shoot 链先 kick 掉(占位即触发加载,缓存 Map 去重),发射时已就绪 */
export function prefetchProjectiles(ids: Iterable<number>): void {
  if (typeof Image === 'undefined') return;
  for (const id of ids) {
    if (!Number.isInteger(id) || id <= 0) continue;
    projSprite(id);
  }
}

/** Main.projFrames（Main.cs:8392 起全 275 条非 1 帧赋值，tools 内联提取）：
 *  未列入的恒 1 帧。投射物贴图是【竖向多帧行】——帧高 = 图高/帧数，
 *  整图绘制会把多帧压成胶片条（史莱姆随从 266 曾 12 帧压成一坨） */
import projFramesJson from '../data/vanilla-projframes.json';
import { projectileData } from '../data/vanillaProjectiles';
import { ZAPPING_JELLYFISH, jellyZapProjectile } from '../player/SwingPathMath';
import { isGemBolt, type GemStaffFlags, gemDamageMultiplier } from '../data/vanillaGemStaff';
import { projGravSpec, itemCombat } from '../data/vanillaItemCombat';   // ★G11 件5a：itemCombat=630 stealth 档手持远程活查
import { VANILLA_ITEM_KEY_BY_ID, ITEM_DEFS } from '../data/items';   // ★G11 件5a：ITEM_DEFS=heldVid 解析（630 stealth 档）
import { GorePiece } from './GorePiece';
import { cutTilesBox } from './ProjCutTiles';   // ★BJ290 件1 死亡段割面（BJ260/285 同款前置习语）
import { createTownNpcByShellKey } from './townNpcFactory';   // ★环切：原 `import { TownNPC }`（TownNPC→TownShot→Arrow 三节环）
import { MedusaHeadProj } from './MedusaHeadProj';
import { globalTimeWrappedHourly } from '../core/GameTime';   // ★BJ330 GTW 单源
import { rollVanillaHitCrit, dealContacts } from './proj1457';   // ★BJ489 def-3 掷率单源（函数声明环=运行时调用安全）;★BJ693 dealContacts=喵刀弹跳 AOE 结算单源
const PROJ_FRAMES = projFramesJson as Record<string, number>;

/** 网格切片表（Main.cs 逐型特判——竖条 projFrames 模型装不下的多列网格图；
 *  2026-08-23 火绒狐批）。frame 索引【列主序】：col = ⌊frame/rows⌋、row = frame%rows
 *  （两型同式）。cw/ch = 格步距、fw/fh = 帧矩形（可小于步距 = 格内留边）：
 *  · 1094/1113 火绒狐（1457 Main.cs:33734-33737 / 1456 :32844-32848 仅 1094）：
 *    手写矩形 X=(frame/9)*64、Y=(frame%9)*46、62×44——54 帧 = 6 列×9 行。
 *    图 384×1242 仅上部 414px 为本体帧；中带白剪影/下带焰团是喷火粒子特效
 *    （DrawProj_Flamethrower_Foxsparks :35719 Frame(1,7,0,3..5)）采样区,非本体帧。
 *    ★Main.projFrames 无此二型赋值（恒 1）——帧数由本表 cols*rows 供出,勿补 json。
 *  · 1092 图书管理员书（1457 Main.cs:33719-33726 / 1456 :32834-32838）：
 *    Frame(6,9,frame/9,frame%9) = 240×360 整格 40×40（projFrames[1092]=54 与格积一致,
 *    BookProj 帧语义本就是列主序：出生 Next(6)*9+Next(3)）。
 *  · 660 天界碎裂剑（2026-09-17 用户实报「一排剑」定谳）：贴图 Projectile_660.png
 *    = 532×38 横条 14 帧 38×38，Main.DrawProj 专支【横切】Rectangle(38*proj.frame,
 *    0,38,38)（1457 Main.cs:30974-30980），frame=出生 Next(14) 掷定恒定（AI_001
 *    :56651 写入——旧注「死写入」系误判,本表即其消费端）。Main.projFrames[660]
 *    无赋值（恒 1）→ 帧数 14 由本表供出。rows=1 → col=⌊frame/1⌋=frame、row=0,
 *    恰为原版横切式。伤害判定盒独立于贴图（SetDefaults 10×10,Projectile.cs:7099）。 */
interface ProjGrid { cols: number; rows: number; cw: number; ch: number; fw: number; fh: number }
const PROJ_GRID: Record<string, ProjGrid> = {
  1094: { cols: 6, rows: 9, cw: 64, ch: 46, fw: 62, fh: 44 },
  1113: { cols: 6, rows: 9, cw: 64, ch: 46, fw: 62, fh: 44 },
  1092: { cols: 6, rows: 9, cw: 40, ch: 40, fw: 40, fh: 40 },
  660: { cols: 14, rows: 1, cw: 38, ch: 38, fw: 38, fh: 38 },
  // ★BJ415 2026-09-30「猪龙风筝天上飞三只猪龙」定谳：风筝族本体帧是【横切】网格——
  //    Main.DrawKite（1457 Main.cs:37972）`value.Frame(projFrames[type], 1, proj.frame)`
  //    横参=列数/竖参=1 → 帧矩形 = W/列 × H 全高（Utils.Frame :1389 num*tex.Width/横参）,
  //    与通用弹幕竖条切片 Frame(1,frames,0,frame) 轴向相反。旧竖切把 826 猪龙
  //    336×80 三变体横排表（粉/紫/红 各 112×80）切成 336×27 全宽横带 = 三只"猪龙"
  //    同屏、线拴中间只（用户实报三只之谜=单只单draw,非连放三只;frame=ai[1]
  //    AI 无写入恒 0=粉变体,P.cs:49544）。12 多帧型全表（帧数锚=Main.projFrames
  //    Main.cs:8771-8797;其余 12 单帧型 771/822/823/827/830/838/843/844/845/846/
  //    850/852 两轴同形不列,缺省整图即帧）：
  //    766-770 五色 272×68·4 帧 68×68 / 824·839·840 兔兔 456×78·4 帧 114×78 /
  //    826 猪龙 336×80·3 帧 112×80 / 828·829 水母 116×44·2 帧 58×44 /
  //    853 独角兽 512×132·4 帧 128×132。rows=1 → col=⌊frame/1⌋=frame、row=0（660 同式）。
  766: { cols: 4, rows: 1, cw: 68, ch: 68, fw: 68, fh: 68 },
  767: { cols: 4, rows: 1, cw: 68, ch: 68, fw: 68, fh: 68 },
  768: { cols: 4, rows: 1, cw: 68, ch: 68, fw: 68, fh: 68 },
  769: { cols: 4, rows: 1, cw: 68, ch: 68, fw: 68, fh: 68 },
  770: { cols: 4, rows: 1, cw: 68, ch: 68, fw: 68, fh: 68 },
  824: { cols: 4, rows: 1, cw: 114, ch: 78, fw: 114, fh: 78 },
  826: { cols: 3, rows: 1, cw: 112, ch: 80, fw: 112, fh: 80 },
  828: { cols: 2, rows: 1, cw: 58, ch: 44, fw: 58, fh: 44 },
  829: { cols: 2, rows: 1, cw: 58, ch: 44, fw: 58, fh: 44 },
  839: { cols: 4, rows: 1, cw: 114, ch: 78, fw: 114, fh: 78 },
  840: { cols: 4, rows: 1, cw: 114, ch: 78, fw: 114, fh: 78 },
  853: { cols: 4, rows: 1, cw: 128, ch: 132, fw: 128, fh: 132 },
  // ★S2/BJ415 观察项收口（2026-09-30）：DrawProj 专支（非 DrawKite 域）横切二型——
  //  · 857 初代分形（Main.cs:33934 `rectangle23 = texture2D4.Frame(15, 1, proj.frame)`,
  //    帧数无 Main.projFrames 赋值（恒 1）由 AI_168 :43897 出生 Next(15) 掷定恒定;
  //    贴图 1350×84 = 15×90×84 横条。旧 FirstFractal.draw 以 height/width 推帧数
  //    =0→钳 1 整幅画出（15 剑一排,660 同病）。
  //  · 908 钛金风暴碎片（Main.cs:33918 `texture2D4.Frame(projFrames[908]=12, 1,
  //    proj.frame)`;AI_175 :46150 frame=rand(12) 掷定恒定;贴图 288×28=12×24×28 横条。
  //    原文贴图源=TitaniumStorm Buff 渲染目标（:33911 RT 未就绪回退弹体贴图,本仓
  //    无 RT 系统=恒回退面）。实体手绘横切已对轴,入表=染料 pass projFrameSrcRect
  //    （旧竖切 288×2.3 横条切片）与实体 draw 双消费单源化。
  857: { cols: 15, rows: 1, cw: 90, ch: 84, fw: 90, fh: 84 },
  908: { cols: 12, rows: 1, cw: 24, ch: 28, fw: 24, fh: 28 },
};

export function projFrameCount(projId: number): number {
  const g = PROJ_GRID[String(projId)];
  if (g) return g.cols * g.rows;
  return PROJ_FRAMES[String(projId)] ?? 1;
}

/** 网格帧源矩形（列主序,越界钳末帧;非网格型返回 null）——projFrameImg /
 *  whiteSpriteOf 共用,帧矩形单测亦断言本式 */
export function projGridRect(
  projId: number, frameIdx: number,
): { sx: number; sy: number; sw: number; sh: number; count: number } | null {
  const g = PROJ_GRID[String(projId)];
  if (!g) return null;
  const count = g.cols * g.rows;
  const idx = Math.max(0, Math.min(count - 1, Math.floor(frameIdx)));
  return {
    sx: Math.floor(idx / g.rows) * g.cw,
    sy: (idx % g.rows) * g.ch,
    sw: g.fw, sh: g.fh, count,
  };
}

/** 单帧裁切缓存（id+帧号 → canvas），多帧行按帧高切片 */
const frameCache = new Map<string, HTMLCanvasElement>();
/** 热补丁替换弹幕贴图(2026-08-19 素材重制):写 spriteCache + 清该 id 的
 *  frameCache 条目(键 `id|idx` 不含 texId,不自动失效)。RemasterRuntime 调用。
 *  ★清偿 C2/R5-F2（2026-10-14）：增派模块级失效通知（projGhostTrail 注册表,
 *  Arrow↔MinionProj 已互 import 成环,通知面挂共同依赖零新边）——素材包覆盖
 *  Projectile_864 后 MinionProj GLOW864_CACHE 旧剪影永驻,RemasterRuntime 就地
 *  生效无 reload 场景辉光吃旧模。 */
export function setProjSpriteOverride(projId: number, img: ImageBitmap | HTMLImageElement): void {
  spriteCache.set(projId, img);
  const prefix = `${projId}|`;
  for (const k of frameCache.keys()) if (k.startsWith(prefix)) frameCache.delete(k);
  notifyProjSpriteOverride(projId);
}
/** 帧源矩形（projFrameImg 切片式照录,清偿刀 N 2026-09-30）——弹幕染料 pass 的
 *  t0Rect/uSourceRect 语义用（渐变族 T0 坐标须与原片源矩形同源）;非网格型=竖条
 *  帧高切片、网格型=列主序。纯函数,不改 projFrameImg 行为。 */
export function projFrameSrcRect(projId: number, frameIdx: number): { sx: number; sy: number; sw: number; sh: number } | null {
  const img = projSprite(projId);
  if (!img || !(img.width > 0)) return null;
  const grid = projGridRect(projId, frameIdx);
  if (grid) return { sx: grid.sx, sy: grid.sy, sw: grid.sw, sh: grid.sh };
  const frames = projFrameCount(projId);
  const idx = Math.max(0, Math.min(frames - 1, frameIdx));
  const fh = img.height / frames;
  if (!Number.isFinite(fh) || fh < 1) return null;
  return { sx: 0, sy: Math.round(idx * fh), sw: img.width, sh: Math.round(fh) };
}

export function projFrameImg(projId: number, frameIdx: number): HTMLCanvasElement | null {
  const img = projSprite(projId);
  if (!img || !(img.width > 0) || img.width === 0) return null;
  // 网格型（PROJ_GRID）走列主序源矩形；竖条型维持帧高切片
  const grid = projGridRect(projId, frameIdx);
  let sx: number, sy: number, sw: number, sh: number, idx: number;
  if (grid) {
    sx = grid.sx; sy = grid.sy; sw = grid.sw; sh = grid.sh;
    idx = Math.max(0, Math.min(grid.count - 1, Math.floor(frameIdx)));
  } else {
    const frames = projFrameCount(projId);
    idx = Math.max(0, Math.min(frames - 1, frameIdx));
    const fh = img.height / frames;
    if (!Number.isFinite(fh) || fh < 1) return null;
    sx = 0; sy = Math.round(idx * fh); sw = img.width; sh = Math.round(fh);
  }
  const key = `${projId}|${idx}`;
  let c = frameCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = sw;
  c.height = sh;
  const cx = c.getContext('2d')!;
  cx.imageSmoothingEnabled = false;
  cx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  if (frameCache.size > 2048) frameCache.clear();
  frameCache.set(key, c);
  return c;
}

/** ★BJ642 喷火器 85/1106 火舌双层调色（DrawProj_Flamethrower Main.cs:35647-35716 /
 *  DrawProj_Flamethrower_Foxsparks :35719-35832 1:1 数学面——纯函数导出供判别锁）。
 *  变体：'flame'=85 ai[0]==0（火焰喷射器 506,橙）/ 'elf'=85 ai[0]==1（精灵熔炉
 *  1910 注入,蓝 Frostburn2）/ 'fox'=1106（焰狐通道火,蓝→橙灰链+上浮面）。
 *  XNA 字节面约定 = 逐通道截断（repo 习语 emberPulseColor truncByte 同式）。 */
export type FlameVariant = 'flame' | 'elf' | 'fox';
const FLAME_TRUNC = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.trunc(v));
/** Color.Lerp 逐通道（:35663/:35737 Lerp((255,80,20,100),(255,255,20,70),0.25) 同式） */
const flameLerpC = (
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
  t: number,
): [number, number, number, number] => [
  FLAME_TRUNC(a[0] + (b[0] - a[0]) * t),
  FLAME_TRUNC(a[1] + (b[1] - a[1]) * t),
  FLAME_TRUNC(a[2] + (b[2] - a[2]) * t),
  FLAME_TRUNC(a[3] + (b[3] - a[3]) * t),
];
const FLAME_REMAP = (v: number, a: number, b: number, c: number, d: number): number =>
  c + (d - c) * Math.min(1, Math.max(0, (v - a) / (b - a)));   // Utils.Remap（clamp 缺省）
/** FLAME_C3 = Lerp((255,80,20,100),(255,255,20,70),0.25) = (255,123,32,92)（截断字节面） */
const FLAME_C3: readonly [number, number, number, number] = flameLerpC([255, 80, 20, 100], [255, 255, 20, 70], 0.25);
/** 调色链六段（:35662-35666 flame/elf / :35736-35745 fox——断点 0.1/0.2/0.35/0.7/0.85/1；
 *  链 = [色0,色1,色1,色2,色3]，fox 的色2=(255,123,32,92)=flame 色3、色3=(80,80,80,100)=
 *  flame 色4、色0/1=(95,120,255,200)/(50,180,255,70)=elf 色顶两元） */
export function flameTongueEnv(t: number, variant: FlameVariant): [number, number, number, number] {
  const TRANSPARENT: readonly [number, number, number, number] = [0, 0, 0, 0];
  const C_FLAME: readonly [number, number, number, number] = [255, 80, 20, 200];
  const C_FLAME2: readonly [number, number, number, number] = [255, 255, 20, 70];
  const C_FLAME4: readonly [number, number, number, number] = [80, 80, 80, 100];
  const C_ELF: readonly [number, number, number, number] = [95, 120, 255, 200];
  const C_ELF2: readonly [number, number, number, number] = [50, 180, 255, 70];
  const C_ELF3: readonly [number, number, number, number] = [95, 160, 255, 100];
  const C_ELF4: readonly [number, number, number, number] = [33, 125, 202, 100];
  const [c0, c1, c2, c3, c4] = variant === 'fox'
    ? [C_ELF, C_ELF2, C_ELF2, FLAME_C3, C_FLAME4]
    : variant === 'elf'
      ? [C_ELF, C_ELF2, C_ELF2, C_ELF3, C_ELF4]
      : [C_FLAME, C_FLAME2, C_FLAME2, FLAME_C3, C_FLAME4];
  if (t < 0.1) return flameLerpC(TRANSPARENT, c0, t / 0.1);        // GetLerpValue(0,0.1,t)
  if (t < 0.2) return flameLerpC(c0, c1, (t - 0.1) / 0.1);
  if (t < 0.35) return [c2[0], c2[1], c2[2], c2[3]];
  if (t < 0.7) return flameLerpC(c2, c3, (t - 0.35) / 0.35);
  if (t < 0.85) return flameLerpC(c3, c4, (t - 0.7) / 0.15);
  return flameLerpC(c4, TRANSPARENT, (t - 0.85) / 0.15);
}
/** 帧选择（:35670 rectangle = flag ? Frame(1,7,0,(int)Remap(t,0.5,1,3,5)) : Frame(1,7,0,3)） */
export function flameTongueFrame(t: number, flag: boolean): number {
  if (!flag) return 3;
  return Math.trunc(FLAME_REMAP(t, 0.5, 1, 3, 5));
}
/** 火舌绘制计划（DrawProj_Flamethrower :35647-35716 / _Foxsparks :35719-35832
 *  逐 draw 1:1 展开为纯函数——双层×步进循环的几何/调色/α 全在 plan 内,渲染层
 *  （染缸+drawImage）与数学面分离供判别锁。每 op = 一次 EntitySpriteDraw：
 *  · px/py：85 = 弹心 + velocity×(−num10)×num13（:35673）；1106 = 弹心 +
 *    尾随基向×(−num10)×num13×num15 + (0,−46)×Remap(l0,20,72,0,1)³（:35782/:35798）
 *  · ang：85 直式 rotation(=0) ± num13×π/2 ∓ GTW×(1/num6×(num13+1))×2（:35684-85）；
 *    i=1 层 ±π/2 相位（:35692-35693）
 *  · scale：num12（1106 ×0.5、flag2 ×1.5）;i=1 层 ×0.75
 *  · rgb/ga：color5=env×num14（字节截断）;color6=非 flag 支 G/2、B/2 整除 +
 *    A=min(A5+80×num14,255)（:35676-35681/:35790-35797）→ draw 色 ×num9×{0.25,1}
 *    （i=0 偏位层 ×0.25/主层 ×1;i=1 用 color5）;ga=XNA A 通道/255
 *  · frame：恒 3（elf 档 (int)Remap(t,0.5,1,3,5)→3..5）
 *  · 尾随基向（1106 :35779-35781）：DirectionTo(owner.Center+v×(flag2?3:6))
 *    .SafeNormalize(0)×(−|v|)（owner=持狐玩家;缺 owner ≈速向档登记） */
export interface FlameTongueOp {
  layer: 0 | 1;
  main: boolean;
  px: number;
  py: number;
  ang: number;
  scale: number;
  rgb: [number, number, number];
  /** XNA 绘制色 A 通道（0-255）——ga=A/255;0 = 原版照画（黑纱 α 面,染缸同精度承载） */
  aByte: number;
  frame: number;
}
export function flameTongueOps(inp: {
  projId: 85 | 1106;
  /** localAI[0]（子步龄） */
  l0: number;
  vx: number;
  vy: number;
  cx: number;
  cy: number;
  /** GlobalTimeWrappedHourly */
  gtw: number;
  /** ai[0]（85：1910 精灵熔炉=1 蓝档;1106 恒 0） */
  ai0?: number;
  ownerCx?: number;
  ownerCy?: number;
}): FlameTongueOp[] {
  const isFox = inp.projId === 1106;
  const variant: FlameVariant = isFox ? 'fox' : (inp.ai0 === 1 ? 'elf' : 'flame');
  const flagV = variant === 'elf';
  const t = Math.min(1, Math.max(0, inp.l0 / 72));            // num11
  if (t >= 1) return [];                                      // :35672-35673 不画
  const frame = flameTongueFrame(t, flagV);
  const spd = Math.hypot(inp.vx, inp.vy);
  const step0 = inp.l0 > 50 ? 0.175 : 0.2;                    // :35659 num6（num=60−10）
  const foxFast = isFox && spd > 10;                          // :35747 flag2
  const num6eff = isFox ? step0 * 0.7 * (foxFast ? 0.5 : 1) : step0;   // :35746/:35749
  let scl = FLAME_REMAP(t, 0.2, 0.5, 0.25, 1);                // :35670 num12
  if (isFox) scl = scl * 0.5 * (foxFast ? 1.5 : 1);           // :35760/:35762-35764
  const num10 = Math.min(inp.l0, 20);                         // :35660
  const num9 = FLAME_REMAP(inp.l0, 60, 72, 1, 0);             // :35658
  const env = flameTongueEnv(t, variant);
  const fadeIn = FLAME_REMAP(t, 0, 0.2, 0, 1);                // :35671 num14 因子
  // 1106 尾随基向 + 距离档（:35772-35781）
  let fvx = 0, fvy = 0, own15 = 1;
  if (isFox) {
    if (inp.ownerCx !== undefined && inp.ownerCy !== undefined) {
      const tx = inp.ownerCx + inp.vx * (foxFast ? 3 : 6);
      const ty = inp.ownerCy + inp.vy * (foxFast ? 3 : 6);
      const dxo = tx - inp.cx, dyo = ty - inp.cy;
      const dlo = Math.hypot(dxo, dyo);
      const ndx = dlo > 0 ? dxo / dlo : 0, ndy = dlo > 0 ? dyo / dlo : 0;
      fvx = -ndx * spd; fvy = -ndy * spd;
      own15 = Math.min(1, Math.hypot(inp.cx - inp.ownerCx, inp.cy - inp.ownerCy) / 120);
    } else {
      fvx = -inp.vx; fvy = -inp.vy;                           // mock 无主玩家 ≈速向档（登记）
    }
  }
  const lift = isFox ? -46 * Math.pow(FLAME_REMAP(inp.l0, 20, 72, 0, 1), 3) : 0;
  const ops: FlameTongueOp[] = [];
  for (let i = 0; i < 2; i++) {
    if (i === 1 && flagV) break;                              // :35708-35710 flag 档整层跳过
    for (let k = 0; ; k++) {
      const num13 = 1 - k * num6eff;                          // float 累退（JS double,迭代数同 float32）
      if (num13 < 0) break;
      const num14 = (1 - num13) * fadeIn;
      let px: number, py: number;
      if (isFox) {
        px = inp.cx + fvx * (-num10) * num13 * own15;
        py = inp.cy + fvy * (-num10) * num13 * own15 + lift;
      } else {
        px = inp.cx + inp.vx * (-num10) * num13;
        py = inp.cy + inp.vy * (-num10) * num13;
      }
      const r5 = FLAME_TRUNC(env[0] * num14), g5 = FLAME_TRUNC(env[1] * num14);
      const b5 = FLAME_TRUNC(env[2] * num14), a5 = FLAME_TRUNC(env[3] * num14);
      const halve = !flagV;
      const r6 = r5, g6 = halve ? Math.trunc(g5 / 2) : g5;
      const b6 = halve ? Math.trunc(b5 / 2) : b5;
      const a6 = halve ? Math.min(255, Math.trunc(a5 + 80 * num14)) : a5;
      const spin = (1 / num6eff) * (num13 + 1);
      const rotA = num13 * (Math.PI / 2) + inp.gtw * spin * 2;
      const rotB = -(num13 * (Math.PI / 2)) - inp.gtw * spin * 2;
      const layer = i as 0 | 1;
      // XNA Color×float = 逐通道截断、左结合双乘（color6 × num9 × 0.25 = 两次截断）
      const mul2 = (v: number, f1: number, f2?: number): number =>
        f2 === undefined ? FLAME_TRUNC(v * f1) : FLAME_TRUNC(FLAME_TRUNC(v * f1) * f2);
      if (i === 0) {
        // :35686-35689（color6 ×num9×0.25 偏位层 + ×num9 主层）
        ops.push({ layer, main: false, px: px + inp.vx * (-num10) * num6eff * 0.5,
          py: py + inp.vy * (-num10) * num6eff * 0.5, ang: rotA + Math.PI / 4, scale: scl,
          rgb: [mul2(r6, num9, 0.25), mul2(g6, num9, 0.25), mul2(b6, num9, 0.25)],
          aByte: mul2(a6, num9, 0.25), frame });
        ops.push({ layer, main: true, px, py, ang: rotB, scale: scl,
          rgb: [mul2(r6, num9), mul2(g6, num9), mul2(b6, num9)],
          aByte: mul2(a6, num9), frame });
      } else {
        // :35690-35694（color5 ×0.75 缩放档,±π/2 相位）
        ops.push({ layer, main: false, px: px + inp.vx * (-num10) * num6eff * 0.2,
          py: py + inp.vy * (-num10) * num6eff * 0.2, ang: rotA + Math.PI / 2,
          scale: scl * 0.75, rgb: [mul2(r5, num9, 0.25), mul2(g5, num9, 0.25), mul2(b5, num9, 0.25)],
          aByte: mul2(a5, num9, 0.25), frame });
        ops.push({ layer, main: true, px, py, ang: rotB + Math.PI / 2,
          scale: scl * 0.75, rgb: [mul2(r5, num9), mul2(g5, num9), mul2(b5, num9)],
          aByte: mul2(a5, num9), frame });
      }
    }
  }
  return ops;
}

/** 火舌染缸（fqwTintBake 同构：multiply 染色 + destination-in 还原轮廓；键含贴图 id，
 *  cap 256——flame 每帧 2 色角色 × num14 六步连续值量化 &~7 后多弹共享,64 档会
 *  抖动刷缓存（E51 追新税判例），扩容 + 首进先出） */
const flameTintCache = new Map<string, HTMLCanvasElement>();
function flameTongueTint(
  projId: number,
  src: HTMLImageElement | ImageBitmap | HTMLCanvasElement,
  rgb: readonly [number, number, number],
): HTMLCanvasElement | null {
  const w = (src as HTMLImageElement).width ?? (src as ImageBitmap).width;
  const h = (src as HTMLImageElement).height ?? (src as ImageBitmap).height;
  if (!w || !h || typeof document === 'undefined') return null;
  const q = (v: number) => Math.round(v) & ~7;
  const key = `${projId}|${q(rgb[0])},${q(rgb[1])},${q(rgb[2])}`;
  const hit = flameTintCache.get(key);
  if (hit) return hit;
  if (flameTintCache.size > 256) {
    const k0 = flameTintCache.keys().next().value;
    if (k0 !== undefined) flameTintCache.delete(k0);
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cx = c.getContext('2d');
  if (!cx) return null;
  cx.imageSmoothingEnabled = false;
  cx.drawImage(src as CanvasImageSource, 0, 0);
  cx.globalCompositeOperation = 'multiply';
  cx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  cx.fillRect(0, 0, w, h);
  cx.globalCompositeOperation = 'destination-in';
  cx.drawImage(src as CanvasImageSource, 0, 0);
  cx.globalCompositeOperation = 'source-over';
  flameTintCache.set(key, c);
  return c;
}

/** ★EoL2 修5：932 彩虹乘色烘焙（GetFairyQueenWeaponsColor hsl 真值染色;
 *  multiply+destination-in 两步染形,bossAI_lategame tintBake 同构本地副本——
 *  entities 域无共享助手,Portal/FakeFish 本地烘焙先例同款）。键按 RGB 步进 8
 *  量化防漂移刷缓存;半载图(width 0)拒烘不缓存。 */
const fqwTintCache = new Map<string, HTMLCanvasElement>();
function fqwTintBake(
  src: HTMLImageElement | ImageBitmap | HTMLCanvasElement,
  rgb: readonly [number, number, number],
): HTMLCanvasElement | null {
  const w = (src as HTMLImageElement).width ?? (src as ImageBitmap).width;
  const h = (src as HTMLImageElement).height ?? (src as ImageBitmap).height;
  if (!w || !h || typeof document === 'undefined') return null;
  const q = (v: number) => Math.round(v) & ~7;
  const key = `${q(rgb[0])},${q(rgb[1])},${q(rgb[2])}`;
  const hit = fqwTintCache.get(key);
  if (hit) return hit;
  if (fqwTintCache.size > 64) {
    const k0 = fqwTintCache.keys().next().value;
    if (k0 !== undefined) fqwTintCache.delete(k0);
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cx = c.getContext('2d');
  if (!cx) return null;
  cx.imageSmoothingEnabled = false;
  cx.drawImage(src as CanvasImageSource, 0, 0);
  cx.globalCompositeOperation = 'multiply';             // RGB 乘目标色
  cx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  cx.fillRect(0, 0, w, h);
  cx.globalCompositeOperation = 'destination-in';       // 轮廓还原
  cx.drawImage(src as CanvasImageSource, 0, 0);
  cx.globalCompositeOperation = 'source-over';
  fqwTintCache.set(key, c);
  return c;
}

/** R4-32：全白帧缓存（GetAlpha `Color.White*Opacity`,Projectile.cs:80604-80613——
 *  PhoenixQuivered/SeraphNecklaced 箭体纯白绘制）。key = `projId|frame`（-1=整图） */
const whiteSpriteCache = new Map<string, HTMLCanvasElement>();
function whiteSpriteOf(
  projId: number, frameIdx: number,
  src: HTMLImageElement | ImageBitmap | HTMLCanvasElement,
): HTMLCanvasElement | null {
  const w = (src as HTMLImageElement).width ?? (src as ImageBitmap).width;
  const h = (src as HTMLImageElement).height ?? (src as ImageBitmap).height;
  if (!w || !h) return null;
  const key = `${projId}|${frameIdx}`;
  let c = whiteSpriteCache.get(key);
  if (c) return c;
  // 网格型先定切片矩形（帧尺寸 ≠ 整图尺寸,画布须按帧开）;竖条型整图宽 × 帧高
  const grid = frameIdx >= 0 ? projGridRect(projId, frameIdx) : null;
  c = document.createElement('canvas');
  c.width = grid ? grid.sw : w;
  c.height = grid ? grid.sh : h;
  const cx = c.getContext('2d')!;
  cx.imageSmoothingEnabled = false;
  if (grid) {
    cx.drawImage(src as CanvasImageSource, grid.sx, grid.sy, grid.sw, grid.sh, 0, 0, grid.sw, grid.sh);
  } else if (frameIdx >= 0) {
    const fh = h / projFrameCount(projId);
    cx.drawImage(src as CanvasImageSource, 0, Math.round(frameIdx * fh), w, Math.round(fh), 0, 0, w, Math.round(fh));
  } else {
    cx.drawImage(src as CanvasImageSource, 0, 0);
  }
  cx.globalCompositeOperation = 'source-in';
  cx.fillStyle = '#fff';
  cx.fillRect(0, 0, w, h);
  if (whiteSpriteCache.size > 512) whiteSpriteCache.clear();
  whiteSpriteCache.set(key, c);
  return c;
}

// ★BJ704-G10（R2-F3,清偿 C2/R5-F2 半修遗留）：Arrow 侧三模块级烘焙缓存接
//  setProjSpriteOverride 失效通知（MinionProj GLOW864_CACHE :11527 接线式同款——
//  注册表习语零新边）——素材包热换后旧白模/旧染色永驻三病同根：
//  · whiteSpriteCache（键 `projId|frame`,phoenixQuiver/seraph 白箭）——按 id 前缀
//    精确失效;
//  · flameTintCache（键 `projId|rgb`,85/1106 火舌双层调色）——同前缀式;
//  · fqwTintCache（键=纯 rgb 无 projId,唯一消费面 932 彩虹乘色）——无法按 id
//    选择性失效,任意覆盖即整体清（过清无害:确定性烘焙,下次按需重烘）。
onProjSpriteOverride((projId) => {
  const prefix = `${projId}|`;
  for (const k of whiteSpriteCache.keys()) if (k.startsWith(prefix)) whiteSpriteCache.delete(k);
  for (const k of flameTintCache.keys()) if (k.startsWith(prefix)) flameTintCache.delete(k);
  fqwTintCache.clear();
});

export interface ArrowOpts {
  /** 重力/tick（aiStyle1/2 = 0.3；直飞魔法弹传 0）。默认 0.3 */
  grav?: number;
  /** 原版 timeLeft（Projectile.cs:526 默认 3600）。缺省读 vanilla-projectiles.json
   *  timeLeft 列（SetDefaults 逐型覆写：小丑箭 5=120 :599 / 诅咒镖 478=300 :5264 /
   *  月总箭 639=90 :6603），再缺省 3600 */
  life?: number;
  /** 穿透次数（原版 penetrate）。缺省读 vanilla-projectiles.json penetrate 列
   *  （SetDefaults 逐型：小丑箭 5=−1 无限 :594 / 邪箭 4=5 :585 / 水晶镖 477=5 :5252 /
   *  月总箭 639=4 :6609），再缺省 1。−1 = 无限穿透（同敌按全局 immune 帧冷却再命中） */
  pierce?: number;
  /** 敌对弹（原版 Projectile.hostile，Damage_EVP :13708 门禁）：
   *  Boss/敌怪发射的弹传 true → 命中玩家结算伤害；玩家武器弹默认 false 不伤玩家。 */
  /** 法力斗篷星(723,Projectile.cs:13914 ai2=1):落地掉 4143 法力斗篷之星 */
  manaStar?: boolean;
  hostile?: boolean;
  /** aiStyle 14 弹跳弹（希腊火/装饰球等月事件弹幕，Projectile.cs 碰撞反弹
   *  cs:18314-18327 档）：撞实心块法向反弹 ×0.5 衰减而非消亡。 */
  bounce?: boolean;
  /** 1457 宝石法珠特性（GemStaffFeatures，vanillaGemStaff.ts）——Game 侧
   *  PackGemStaffFeatures 打包传入；穿透/穿甲/timeLeft 终值化在 ctor 内做 */
  gem?: GemStaffFlags;
  /** SwirlTwins 孪生弹反相相位（Game 侧第二颗传 1，Player.cs:49924-49926 ai[1]=1；
   *  2026-08-22 补接线——曾 Game 传参但本表未声明、ctor 未消费，孪生弹恒同相） */
  gemPhase?: number;
  /** aiStyle 14 荆棘球档（世纪之花 277，Projectile.cs:18306-18314）：
   *  vx 恒反 ×0.9；仅入撞 |vy|>3 才竖弹 ×0.9（地面滚动语义）。 */
  thornBounce?: boolean;
  /** 延迟重力（AI_001 重力链语义，2026-08-14 对账）：ai[0] 达 gravDelay 的那拍
   *  开始下坠（原版 `ai[0] >= 15f` :54686 ≥ 门，2026-08-22 修 off-by-one——曾
   *  `age > gravDelay` 晚一拍）。默认档 = 15（箭缓坠 +0.1，:54686-54696）；275/276
   *  世纪之花种子 35（g 0.025，:54318-54329）。计数与施加都在 subStep 内 =
   *  per-update（extraUpdates 弹同原版） */
  gravDelay?: number;
  /** 二段重力（686/711 :54640-54659：ai0≥10 后 +0.1，≥20 再 +0.1） */
  grav2?: number;
  grav2At?: number;
  /** 恒定 vx 衰减/update（686/711 ×0.99——与 drag 不同：不挂重力门） */
  dragAlways?: number;
  /** 专家追踪（275/276/277 共用模式，Projectile.cs:54330-54345/:23307-23316）：
   *  每 tick v=(v*(weight-1)+dirToPlayer*speed)/weight，速度 <floor 归一到 floor
   *  （277 用 cap：>cap 归一到 cap）。spawn 侧仅在专家模式注入。 */
  homing?: { speed: number; weight: number; floor?: number; cap?: number; axis?: 'x' | 'y' };
  /** 电圈发射器导弹 442（aiStyle 1 + AI_001 type 段 :55689-55740）：锁定格
   *  （原版 ai[0]/[1] = tileTargetX/Y = 发射时刻鼠标格，Player.cs:49905-49908 写入、
   *  :25586-25604 钳 [5, maxTiles−5]）。★直线飞向锁定点（无逐帧转向——AI 段无
   *  velocity 修正式，"追踪"观感 = ≤16px 到点即 Kill :55704-55710），非朝点 homing。 */
  aimPoint?: { tx: number; ty: number };
  /** 原版 Projectile.extraUpdates（Projectile.cs:15331-15336 numUpdates 循环）：
   *  每逻辑帧把整段 AI/位移/碰撞/命中多跑 N 次——弹速视觉上 ×(N+1)，timeLeft
   *  同步按子步消耗（:15861 在循环内）。83 眼激光 SetDefaults=2（:1369）。 */
  extraUpdates?: number;
  /** 敌方生成侧 ai[0] 注入（原版 NewProjectile ai[0] 实参）。现消费面：88 激光
   *  步枪弹 AI 支头 extraUpdates=(int)ai[0]（Projectile.cs:54979-54982）——玩家侧
   *  NewProjectile ai[0]=0 缺省恒空转,敌方弹幕生成（未来）经此注入自动对齐。
   *  ★R2（2026-09-03）：496 暗影炎箭的摆动 X 加速（NewProjectile 尾参 ai0）同槽
   *  注入——88 支对它的消费在 projId===88 门内,非 88 弹经此槽纯数据零影响 */
  ai0?: number;
  /** 496 暗影炎箭 ai[1]（aiStyle 91 摆动 Y 加速,NewProjectile 尾参 Projectile.cs:
   *  47989;Game 3053 施法支按原版掷序注入 ±Next(10,80)×0.001,精确发恒 0——
   *  Arrow.ts 496 AI 支每子步 v+=ai1×1.5、ai1×1.05 消费）。
   *  ★BJ704-G10（件10）双槽复用：459 充能爆破炮弹 ai[1] 蓄压档（NewProjectile
   *  尾参 num35=0.7+num20×0.3 ∈{0.7,1.0,1.3} :67574——PrismProj ChargedBlaster
   *  注入,subStepAI 459 支 Clamp(0.7,1.6) 消费;两消费面各在 projId 门内零互扰） */
  ai1?: number;
  /** X 轴空气阻力/tick（aiStyle 2 投掷族默认档 ×0.97，Projectile.cs:21969） */
  drag?: number;
  /** 终端下落速度（框架默认 16；aiStyle 2 投掷档 32，Projectile.cs:21973-21977） */
  maxFall?: number;
  /** 翻滚旋转（aiStyle 2 刀族：重力期内 rotation += (|vx|+|vy|)*0.03*dir，
   *  Projectile.cs:21508；前 gravDelay tick 保持 atan2 姿态 :21971-21972） */
  tumble?: boolean;
  /** 平飞期姿态锁定（48/54/93/520/599 前 20t atan2 姿态） */
  tumblePoseLock?: boolean;
  /** 泰拉刃光束 985（aiStyle 191，Player.cs:48316 出生注入）：
   *  ai[0]=朝向±1 / ai[1]=18（寿命=ai1+25=43t）/ ai[2]=物品 scale。
   *  淡入 ai1×0.5=9t、末 12t 淡出；34t 后 damage=0（纯视觉尾段）；减速 >8 档
   *  仅初速 >8 时激活（正牌出生速=瞄准向×5 恒不触发——973 甩剑才用） */
  terra?: { ai0: number; ai1: number; ai2: number };
  /** 星怒剑 503（aiStyle 5 :22139-22157）：targetY=目标线（鼠标 Y 与玩家
   *  cy−200 取小）；线上方穿墙/alpha 渐显钳 150，线下开始撞块 */
  star?: { targetY: number };
  /** 食人鱼 190（aiStyle 39，1156 食人鱼枪，GAP G3 行为层）：非空 = 走
   *  piranhaStep 独占状态机（直飞咬敌 → 咬住周期撕咬 → 松手返回回收），
   *  通用 subStep 的重力/撞块消亡/穿透递减语义不适用 */
  piranha?: PiranhaCtl;
  /** 原版 Projectile.tileCollide=false（SetDefaults 逐型；月事件 325/329/348/350/351
   *  等）：跳过撞块消亡/反弹与 CutTiles——HandleMovement 整段不跑（Projectile.cs:15331
   *  位移段门）。缺省按 projectileData(projId).tileCollide === false 自动置位。 */
  noTileCollide?: boolean;
  /** 329 焰镰（aiStyle 56，Projectile.cs:27666-27687）：出生继承发射者 rotation（ai[0]）
   *  与 spriteDirection（-ai[1]）；|vx|+|vy|<16 时速度 ×1.05/t 自加速（曾丢 = 低速
   *  慢速弹报废），rotation += (|vx|+|vy|)*0.025*direction 恒旋。 */
  scythe?: { rot0: number; flipDir: number };
  /** 270 骷髅王髅骨（Projectile.cs:53192-53213）：ai1 30-110 窗口向最近玩家
   *  转向（(v*24+dir*spd)/25 保速）；速 <18 ×1.02/t 自加速；每帧 5 号尘尾迹。 */
  skullBone?: boolean;
  /** 873 光鞭 Kill 尘色相位（NPC.ai[1]/60,P.cs:46790 发射点注入——AI_171_GetColor
   *  :46398 hue=(ai[1]+0.5)%1;缺省 0=hue 0.5。★尘站普查批 2026-09-16） */
  empressHue?: number;
  /** 351 礼盒（aiStyle 58，Projectile.cs:27727-27757）：两段重力——前 30t 平飞，
   *  之后 vy+0.1；一旦 vy>=0 转二段（恒 +0.1 钳 3、vx×0.99）；帧 0/1 随段切换。 */
  present?: boolean;
  /** 452 月总幻影矢（aiStyle 82，Projectile.cs:30119-30195）：三段弹道独占速度链——
   *  0 段 45t 弧线上升 + 1 段 90t 反向弧线（vx = velocity.RotatedBy(ai1).X 钳 ±6、
   *  vy−0.08/下坠再 −0.2、钳 −7）→ 2 段 14 速追踪玩家（Lerp(v,dir·14,0.6) 后目标
   *  vy 钳 ≥6、逐轴 0.4 步进；距玩家 <30 消亡触发 Game 爆炸钩）；alpha 255−40/t
   *  渐显、<40 出尘 229。spin = 出生 ai[1] 弧线弯转角（发射点 :37332/:38558 掷
   *  随机 ±π/30 + π/180·side，1 段末取反）。grav 须传 0。 */
  phantasm?: { spin: number };
  /** 454 月总幻影能量球（aiStyle 83，Projectile.cs:30236-30282）：ai0<30 附
   *  ownerId（手/真眼）随行（位置=主心−尺寸/2−v）→ ≥30 减速 ×0.96 列队（帧
   *  0/1 每 6t 切）→ 外部齐射指令置 ai0=−1（帧 1+extraUpdates 1，velocity 由
   *  发射点统一给定 12 速，见 volleyPhantomOrbs）。tileCollide=false（数据表）。 */
  phantomOrb?: { ownerId: number; ai0?: number };
  /** 92 坠星（aiStyle 5 :22152-22156 + Kill 91/92 共段 :72260-72283，圣箭 516
   *  Kill 链）：lineY = ai[1] 命中线（弹顶越过该线才恢复撞块——出生在命中点上空
   *  600-900px，先穿墙直飞再落地）；gen = ai[0]（1 = 圣箭直系，消亡时可再链一代，
   *  孙代 ai[0]=0 恒不再链）。grav 须 0（aiStyle 5 无重力，速度由 Kill 给定 22）。 */
  starFall?: { lineY: number; gen?: number };
  /** 1021 月总巨砾（aiStyle 25，Projectile.cs:24685-24712 物理段 + 弹地
   *  :17578-17600）：重力 0.06/终端 16、|vy|≤1 地面滚动加速 vx ±0.025 至 ±3.5、
   *  rotation += vx·0.06；Y 撞 vy>4 反弹 ×−0.9 + Dig 音/尘，轻落（0<vy≤4）置
   *  rest 标；X 撞反弹 ×−0.75 计 3 次，超次消亡。grav 须传 0.06。 */
  mlBoulder?: boolean;
  /** 448 火星飞碟火炮弹（aiStyle 80，Projectile.cs:29801-29890）：ai1 引信 20t
   *  倒数 → 点火加速 +4（8→12）+ 8 尘爆 + 锁定最近玩家 + tileCollide=true →
   *  点火后 [0,30) 逐 t 20% 角度转向玩家 → 180t 自毁；距玩家 ≤42 或撞块 =
   *  Kill 爆炸（判定盒外扩 112×112 重结算 + Item14，:70544-70580）。 */
  martianRocket?: boolean;
  /** 出生预置同敌局部免疫（Projectile.localNPCImmunity[npc]=N 出生直写——花瓣
   *  1038 SpawnFlowerExplosionOn 1456 :23 预置 30t：花瓣自被 proc 目标体内出生,
   *  30t 内不得命中目标本体,飞出后才可伤及；1457 重制版 :32 同款保留）。与
   *  localNPCHitCooldown（命中后写档,数据列驱动）独立：本表项只在出生时写入 */
  localImmuneSeed?: { npcId: number; t: number };
  /** 荆棘链段 ai[1]（Vilethorn 7/8、Nettle Burst 150/151/152、魔晶碎块 494 杆——aiStyle 4）：
   *  武器首发不传（=0），链生子段传父段递增后的 ai[1]。消费见 THORN_CHAIN_PROJS 支 */
  thornChainAi1?: number;
}

/** 食人鱼控制面（Game 注入，同 PrismProj channelCb/aimCb 模式） */
export interface PiranhaCtl {
  /** Player.channel 电平（按住=持续咬；松手 → ai[0]=1 返回 + ai[1]=−1 禁再咬，
   *  Projectile.cs:26093-26096）。附带 heldItem/死亡门（同 FlailProj 回调先例） */
  channel: () => boolean;
  /** 当前瞄准点（世界坐标）——回收补弹的出生方向（ItemCheck_Shoot num4/num5） */
  aim: () => { x: number; y: number };
}

/** 食人鱼常量（SetDefaults Projectile.cs:2509-2520：22×22 aiStyle 39 /
 *  penetrate −1 / ranged / timeLeft 走通用默认 3600 :526 /
 *  usesLocalNPCImmunity + localNPCHitCooldown = 14 :2520-2521） */
export const PIRANHA_PROJ = 190;
export const PIRANHA_LIFE = 3600;
export const PIRANHA_HIT_CD = 14;

/** 食人鱼咬住/搜敌目标最小面（Enemy 满足） */
interface PiranhaTarget {
  x: number; y: number; w: number; h: number;
  cx: number; cy: number;
  vx: number; vy: number;
  id: number;
  hp: number;
  dead: boolean;
  dontTakeDamage?: boolean;
  iframes?: number;
  hurt: (d: number, kx: number, ky: number, g: GameHooks,
    pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean;
  def?: { hitSound?: string[] };
  hemorrhageT?: number;
}

/** extraUpdates：已并入 vanilla-projectiles.json（tools/extract-projectiles.mjs
 *  NUM_FIELDS 提取，249 款非 0；83 眼激光=2 等原先手工条目同源于 SetDefaults） */

/** 旋转模式（scripts/_projrot-audit.mjs 对 AI_001 type 链逐分支提取 + 非 aiStyle1
 *  特例）：默认 'up' = 贴图朝上（AI_001 尾部默认 atan2+π/2，:54877——箭/子弹）；
 *  下表 = 贴图【朝右】的弹型（rotation=atan2(vy,vx)，向左运动时按原版
 *  spriteDirection 水平镜像，食人鱼 AI 即 :26122-26140 模式）：
 *  16 魔法飞弹头（113 Magic Missile，AI_009 :54039 ToRotation；54×54 方图头朝右）、
 *  34 Flamelash 火鞭（218，AI_020 族 ToRotation；48×384 八帧行按帧行切片）、
 *  190 食人鱼（aiStyle 39，1156 食人鱼枪；曾恒 +π/2 → 鱼 90° 侧翻）、
 *  837（AI_001 显式 MIRROR 分支 :54715，1313 骷髅头法书 shoot）、
 *  1023（AI_001 仅 wiggle :54743，基姿态 0 朝右，5460 发射器）、
 *  1026 藤堡弹（★BJ582②：AI_028 :26943-26944 rotation=velocity 角+左移−π、
 *    spriteDirection=sign(vx)——右向贴图镜像语义同族;旧缺省支 atan2+π/2=弹头恒偏 90°） */
//  1001 无头骑士南瓜弹（★BJ643①：AI_194 :42055-42056 rotation=velocity.ToRotation()+
//    spriteDirection=(!(vx<0))?1:-1——同族逐帧速度角+左飞镜像;旧 Dart 直飞桶无姿态面）
const PROJ_ROT_RIGHT = new Set([16, 34, 190, 837, 1023, 485, 1026, 1001, 408,
  // ★BJ703-B D2（2026-10-21）435/682 入族——AI_001 尾分派 :58622-58627
  //  `type==435||459||682||709 → rotation=ToRotation()+(direction==-1?π:0)`
  //  + 专属块 spriteDirection=direction（435 :55886/682 :55922）→ 与 408 同式
  //  朝右贴图+左飞水平镜像（贴图物证:34×16/帧 横向闪电锯齿带,61-90% 非对称）。
  //  曾落缺省支 ang+π/2 = 恒 90° 横转且永不镜像。
  //  ★BJ704-G2（2026-10-21,债① 459 员）：459 载体勘误——充能爆破炮小弹在仓内
  //  即【Arrow 载体】（PrismProj.ts ChargedBlaster fire → new Arrow(...,459,...),
  //  非「专属实体」）,ghost 环本就在记录/绘制面（不在 GHOST_RECORD_EXCLUDE）;
  //  缺面=姿态——AI_001 459 专属块 :55621 同写 spriteDirection=direction +
  //  尾分派 RIGHT 族 → 本体/ghost 双面随族（D2 同刀式）。★BJ704-G2 登记债已随
  //  ★BJ704-G10（2026-10-21）清偿：AI_001 459 块余面落模（scale=ai[1] 三档蓄压
  //  :55632-55635 + 判定盒 (int)(22×scale) + ghost 环 end=(int)(scale×8)/step
  //  端 + 3 帧循环 :55622-55631（ghost 帧锚恒 0=登记② 维持）+ 尘 226/点光/
  //  ≥0.85 档 penetrate=−1 :55640-55648——发射侧 PrismProj 注入 ai1 三档;
  //  α−30 无视觉面（GetAlpha 恒 (255,255,255,200) 不读,保持 α=0——ghost
  //  bodyAlpha=(255−α)/255 通道依赖 α≡0 勿建模）,见 subStepAI 459 支。
  435, 682, 459]);
/** ★BJ703-B D2：mode0 ghost 姿态随 RIGHT 族的成员集（bodyRot=ang+(vx<0?π:0)+
 *  mirror=vx<0——ghost 调用位单点消费;mode2/3/4 成员不入:其 ghost 角走槽 rot、
 *  翻转走 dir 基底互不掺混）。408 BJ700-A 首例,435/682 本刀扩员。
 *  ★BJ704-G2：459 扩员（ghost 环既有,姿态随族点亮）。
 *  ★BJ704-G10（2026-10-21,R2-F2）：1026 扩员——藤堡弹 mode0 ghost
 *  （GHOST_PARAMS P(8,0,-2,0.5)）+ AI_028 :26943-26944 `spriteDirection=
 *  sign(vx); rotation=ToRotation()+(spriteDirection==−1?−π:0)` 与 408/435/682
 *  同式（BJ582② 已入 PROJ_ROT_RIGHT,本刀补 ghost 面）。★旧注「GHOST_PARAMS
 *  全族∩特判旋转集=空（BJ375 普查）」自 BJ582②（1026）起即为假——交集即本集
 *  {408,435,459,682,1026},随迁勘正（见 draw ghost 调用位同款注）。 */
const PROJ_GHOST_MIRROR0 = new Set([408, 435, 682, 459, 1026]);
export { PROJ_GHOST_MIRROR0 };
// ★BJ700-A 2026-10-20「暴风雨法杖迷你鲨鱼龙贴图方向不对」：408 入族——
//   AI_001 尾 rotation 分派 Projectile.cs:58616-58621 `ToRotation() +
//   (direction == -1 ? π : 0)` + :55962-55967（408 专属块尾 spriteDirection =
//   direction）；direction 由 Update :17122-17130（AutomaticallyChangesDirection
//   :17387——aiStyle 1 不在排除表）每拍 `vx<0 ? -1 : 1` 维护 → 朝右贴图+左飞
//   水平镜像（837/270 族 :58574-58581 同型;DrawProjDirect Main.cs:30530-30534
//   FlipHorizontally+通用绘制 :30606 R(rotation)∘M）。曾落缺省支 ang+π/2
//   恒不镜像 = 左飞上下颠倒/右飞横转 90°（用户实报）。

/** aiStyle 27 剑气族（AI_027 尾部 :26909-26911：rotation = atan2(vy,vx) + 0.785f
 *  = 速度角 + 45°，斜向剑气贴图）——曾走默认 +π/2 恒偏 45°（用户报"附魔剑
 *  光束角度偏"）。成员：114 邪恶三叉戟弹(683)/115 敌侧/116 光束剑波(723)/
 *  132 泰拉刃波/156 光束/173 附魔剑波(989)。例外 157 夜波=direction×0.4 旋转体
 *  （1.4.5 已无武器射出，未移植登记）。
 * ★BJ704-G11（件4,G10 字面卫生登记债清偿）：原 PROJ_ROT_DIAG 混集按【原文字面】
 *  拆二——本集字面 0.785f（f32 ≈0.78500003,对 π/4=0.78539816 残差 0.0004rad,
 *  视觉无感但字面纪律逐位对齐;Dart 'a45' 同锚已 1:1）。 */
const PROJ_ROT_DIAG_0P785 = new Set([114, 115, 116, 132, 156, 173]);
/** +45° 族 π/4 字面支：660 天界碎裂 = AI_001 尾分派 :58632-58634
 *  `ToRotation()+MathF.PI/4f`;451 涌流剑 = AI_081 :31582/:31633 同字面
 *  （AI_081 族 aiStyle 81,锚=Projectile.cs 非 Main.cs——旧注 :31594/:31636 系
 *  Main.cs 残号勘误）。660 残影拖尾同字面（draw 660 支 ang+π/4 直书,本表不消费）。 */
const PROJ_ROT_DIAG_PI4 = new Set([660, 451]);
/** 兼容并集（tests/proj-rotation 旧锚消费;新消费位一律用上方二集按字面分派） */
const PROJ_ROT_DIAG = new Set([...PROJ_ROT_DIAG_0P785, ...PROJ_ROT_DIAG_PI4]);
export { PROJ_ROT_DIAG, PROJ_ROT_DIAG_0P785, PROJ_ROT_DIAG_PI4 };

/** 贴图【朝下】族（AI 尾显式 rotation = velocity.ToRotation() − π/2——减号对齐
 *  下向贴图；曾走默认 +π/2 = 整差 180°,左飞弹视觉朝右=用户实报"幻影弓影子箭
 *  方向反了,应该镜像翻转"）。成员：631 幻象矢（AI_122 尾 :35613——命中侧补刀
 *  弹,Projectile_631.png 尖端朝下叉口朝上,已验 PNG）。629 同支同式（:35613 同
 *  行覆盖 629/631 两型）但本仓 0 消费面且贴图空,登记不入集。 */
const PROJ_ROT_DOWN = new Set([631]);
export { PROJ_ROT_DOWN };

/** ★BJ700-A 2026-10-20「撒旦军队标枪方向不对」：662/685 DD2 敌对标枪（T1/T3）——
 *  AI_001 尾分派 Projectile.cs:58626-58629 `rotation = velocity.ToRotation() −
 *  π − π/4`（662||685 同支；AI 全程无 spriteDirection 写=永不翻转——507/508/662/
 *  680/685 家族块 :58453-58460 只做 ai[0]>60 后 vx×0.98+vy+0.3）。贴图固有朝向
 *  225°（左上矛头,Projectile_662.png 像素物证：42×42 对角条,宽刃尖在 TL）→
 *  绘出恒 = 速度向。曾落缺省支 ang+π/2 恒偏 45°（用户实报）。685=同支 T3 随刀。 */
const PROJ_ROT_NW = new Set([662, 685]);
export { PROJ_ROT_NW };

/** ★BJ700-A：恒帧 0 族——projFrames>1 但 AI 全程无 frameCounter/frame 推进支
 *  （原版 frame 恒 0,第二帧行闲置）。408：Main.projFrames[408]=2（Main.cs:8662）
 *  而 AI_001 的 408 专属块 :55960-55967 只写 alpha/spriteDirection,帧推进支
 *  （:55978-55988）属 275/276——通用 age/5 翻帧档对其=伪影（每 5t 在双鲨帧间
 *  闪跳）。注意 ghost 面 frameRow 'n408'（projGhostTrail.ts,:30655-30657 行+1
 *  专属）不读本帧号,与本钉互不影响。 */
const PROJ_FRAME_STATIC0 = new Set([408,
  // ★BJ704-G10（2026-10-21,R2-F4）614 扩员——星尘细胞弹 AI_113（TargetSticker
  //  :41289-41518）全程无帧推进：帧支仅 type 1024（:41307-41318 frameCounter>3
  //  推帧）;stuck 态（ai[0]==1）显式 frame=0（:41395）。Main.projFrames[614]=4
  //  （Main.cs:8634）→ 通用 age/5 翻帧档=伪影（飞行期 4 帧闪跳,原版恒帧 0）。
  614]);
export { PROJ_FRAME_STATIC0 };

/** ★BJ489 def-3（2026-10-04）通用环掷率路由集：Game.ts spawn 位 `X.critChance =
 *  critTotal` 冻结载体退役的 Arrow 载体（190 食人鱼枪/304 吸血鬼飞刀/424-426 异星
 *  探针/459 充能爆破炮小弹）→ 命中拍 rollVanillaHitCrit（:12915-12927 owner 装配 +
 *  :25712 持械折入动态;类旗=190 ranged/304·459 magic 定谳见 vanilla-projectiles.json;
 *  spawn 位仅置 0.04 路由门）。★BJ493②③（2026-10-04）扩面：ranged critBonus 族
 *  （弓/枪/投掷 13 spawn 位）同式迁移——路由信号=spawn 位 `critChance = 0.04` 门
 *  （中支 critChance>0),本集仅保留 def-3 支零 RNG 关断钉形（critChance≤0 零掷零
 *  RNG）。未迁移族（magic/melee critBonus 写位与 :20980 兜底面）走旧 `??` 路径
 *  =登记债（BJ493 报告 §新债;★BJ496①②/BJ497① 已清偿,BJ498① 传播写位 13 位全摘）。 */
const DEF3_VANILLA_ROLL_PROJS = new Set([190, 304, 424, 425, 426, 459]);

/** 恒旋族（AI_001 尾链 :54741-54749/:54822-54825：rotation 每帧累加、不对齐速度）：
 *  312 南瓜灯 += vx*0.02；772 晶洞 += sign(vx)·(|vx|+|vy|)·0.05；
 *  94 水晶风暴 += vx*0.2（AI_024 :24305）/ 95 诅咒之焰 += 0.3×direction
 *  （AI_008 :22659-22662，aiStyle8 自动换向 :15675→direction=sign(vx)）/
 *  424 流星弹 += vx*2（AI_001 type 段 :54159）/
 *  90 水晶碎块 += vx*0.2（AI_024 同款 :24305，515 水晶子弹 Kill 碎片）/
 *  92 坠星 += sign(vx)·(|vx|+|vy|)·0.01（aiStyle5 尾链 :22241-22245，direction=sign(vx)）。
 *  R27：27 水矢/45 恶魔镰刀 += 0.3/0.8×direction（AI_008 尾 :24636 / AI_018 :25781，
 *  direction=AutomaticallyChangesDirection 按 sign(vx) 每 update 刷新 :17122-17132/
 *  :17388——aiStyle18 不在豁免表；v.x==0 时 direction 保持原值，本仓取 ||1 兜底）。
 *  同链其余（248 花瓣/483 种子/532 骨手套/675 黑法师弹/921·926·937）无武器可达。 */
const PROJ_SPIN: Record<number, (a: Arrow) => number> = {
  312: a => a.vx * 0.02,
  772: a => Math.sign(a.vx) * (Math.abs(a.vx) + Math.abs(a.vy)) * 0.05,
  94: a => a.vx * 0.2,
  95: a => 0.3 * (a.vx < 0 ? -1 : 1),
  27: a => 0.3 * Math.sign(a.vx || 1),          // 水矢自旋（AI_008 :24636）
  45: a => 0.8 * Math.sign(a.vx || 1),          // 恶魔镰刀快自旋（AI_018 :25781）
  1114: a => a.vx * 0.2,                                             // 日耀花弹（AI_024 :26285 rotation += vx×0.2 全族）
  424: a => a.vx * 2,
  90: a => a.vx * 0.2,
  92: a => Math.sign(a.vx || 1) * (Math.abs(a.vx) + Math.abs(a.vy)) * 0.01,
  // 617 星璇秘术（aiStyle 118 :35295/:35301/:35350/:35358）：恒 rotation −= π/30，
  // 快速段 ai[0]≥30 追加 −= π/180（慢速段无追加）
  617: a => -(Math.PI / 30) - (Math.hypot(a.vx, a.vy) > 4 && a.na617Ai0 >= 30 ? Math.PI / 180 : 0),
  // 沙球族（AI_010 尾链 :55149-55154 非 736-738 支）：rotation += 0.1/update 恒滚
  42: () => 0.1, 65: () => 0.1, 68: () => 0.1, 354: () => 0.1,
  // ★R28：aiStyle8 火之花 15 / 冰之花 253（AI_008 尾 :24640-24642 `rotation +=
  //   0.3f*direction`，direction=AutomaticallyChangesDirection 按 sign(vx) 刷新
  //   :17122/:17388——aiStyle8 不在豁免表）；510 毒液瓶（aiStyle2 type 支
  //   :23465-23467 `rotation += |vx|*0.04*direction`——翻滚投掷姿态）
  15: a => 0.3 * Math.sign(a.vx || 1),
  253: a => 0.3 * Math.sign(a.vx || 1),
  510: a => Math.abs(a.vx) * 0.04 * Math.sign(a.vx || 1),
  // 511-513 毒云：rotation 由 AI 分支全权维护（相位+t×2π/480）,表项仅接通 spinRot 消费
  511: () => 0,
  512: () => 0,
  513: () => 0,
  // ★R29 星星炮族自旋（AI_005 通用尾 :24216-24221 `rotation += (|vx|+|vy|)×0.01×
  // direction`——direction=sign(vx);AI_151_SuperStar :22346 同式 ×0.005。
  // ★红队 §8"rotation+=0.3×direction"系数系误记,按源码 (|vx|+|vy|) 式落表）
  955: a => (Math.abs(a.vx) + Math.abs(a.vy)) * 0.01 * Math.sign(a.vx || 1),
  728: a => (Math.abs(a.vx) + Math.abs(a.vy)) * 0.005 * Math.sign(a.vx || 1),
  // 131 蘑菇孢子云（AI_030 default 支 :27152 rotation += 0.2 恒旋——伴生弹支 AI 侧
  //  只管速度/alpha,旋转走本表）
  131: () => 0.2,
};

/** 沙球族（aiStyle 10，沙枪 266 弹）：42 沙 / 65 黑檀 / 68 猩红 / 354 化石
 *  （PickAmmo :52666-52678 换弹产物；物理档 AI_010 :54890-55160，见 subStep
 *  sandBall 支；Kill 落地放块走 Game.onProjectileDeath 42/65/68/354 分支） */
const SAND_BALL_PROJ = new Set([42, 65, 68, 354]);
/** ★BJ229 aiStyle 8 撞块反射族（HandleMovement aiStyle8 支 Projectile.cs:19688
 *  `aiStyle == 8 && type != 96`——96 诅咒焰(敌)被显式排除=撞块消亡;502 喵刀有更早
 *  专支(:16794-16812,本仓 :8101 meowBounceOff)先命中不走本表）。SetDefaults 全表:
 *  15 火球(item 112 火花之杖)/27 水矢(165)/95 诅咒焰(519)/253 冰球(1264 霜花之杖)
 *  /258 火焰弹(敌 Imp 火球,NPC 发射)。 */
const AI8_BOUNCE_PROJS = new Set([15, 27, 95, 253, 258]);
/** AI_010 途经破坏表（:55114-55120）：草族/装饰/雕像/宝石——KillTile 全语义 */
const SAND_BALL_CUT_SHEETS = new Set([185, 186, 187, 165, 12, 665, 639, 105, 178]);

/** 信号枪族（aiStyle 33，AI_033 Projectile.cs:27425-27498）：163 信号弹（信号枪
 *  930）/310（5378 前身彩蛋弹）/1008（探矿信号弹）/1009 诅咒信号弹（5378 诅咒
 *  信号弹，PickAmmo 弹药 931 同槽换弹）/1010/1011。SetDefaults 同构：6×6 盒、
 *  penetrate −1、alpha 255（渐显）、timeLeft 36000（163 :2517-2526 / 1009 :9592-9601） */
export const FLARE_PROJS = new Set([163, 310, 1008, 1009, 1010, 1011]);
/** AI_033 尘尾型号表（:27446-27464 switch(type)）：alpha<70 期每 update 一枚 */
const FLARE_DUST: Record<number, number> = { 163: 127, 310: 187, 1008: 169, 1009: 75, 1010: 66, 1011: 310 };

/** SetDefaults alpha 初值（Projectile.alpha，逐型直写；GetAlpha :75940 消费）。
 *  仅接本批消费 id（提取器 NUM_FIELDS 未含 alpha，登记）：未列 = 0 全显。
 *  5 小丑箭 100(:851-863，GetAlpha :81239-81241 固定 (255,255,255,0) 纯加算白不读 α
 *  ——★F3：drawGlobalAlpha case 5 显式豁免,兜底禁止消费本值;旧注":76579"系 Kill
 *  尘段错行)/
 *  94 水晶风暴 50(:1516，GetAlpha :76322 固定 (200,200,200,25) 同不消费)/
 *  95 诅咒之焰 100(:1527，同 94)/280 黄金雨 255(:3402)/477 水晶镖 255(:5250)/
 *  478 诅咒镖 255(:5260)/521 水晶脉冲 255(:5637)/639 月总箭 255(:6608)/
 *  932 仙王射弹 0(:8571)/
 *  207 叶绿弹 255(:2680-2691，AI −25/t 渐显 :53937-53943)/837 骷髅头法书弹
 *  255(:7842-7851，同段消费)/92 坠星无键（★T6 勘误,2026-09-02：SetDefaults
 *  :1755-1764 alpha=50 非旧注"0 起";GetAlpha :80999 恒 (255,255,255,0) 不读 α,
 *  键面维持无列=GA case 92 恒值承接;AI_005 闪烁档 :24181-24194 ±25/t 只写
 *  alpha 字段=GetAlpha 侧死存储,观察面零影响） */
/** GetAlpha=(200,200,200,25) 加算族（Projectile.cs:81007——15 火球/93 魔法
 *  匕首/94 水晶风暴/95 诅咒之焰/96 敌诅咒火/1114 日耀花/253 霜球/258 火球/102 Prime
 *  炸弹）：XNA AlphaBlend=预乘语义,RGB 全额加算 A 只衰背景=发光观感。canvas 'lighter'
 *  复刻（2026-08-24 清零批,source-over 直译=半透灰）。
 *  ★T2/R 类清账（2026-09-02 用户拍板,按原版真值对齐）：34 火焰鞭【出组】——34 在
 *  GetAlpha 更早的 :80753 `873||872||931||913||34||1039 → Color.White * Opacity`
 *  支已被截走（:81007 里 34 是死入口,:81465 White 支亦不可达,控制流模拟核实）,
 *  原版本体=不透明白贴图常规合成（White 为恒等染色、Opacity 系数缺失=既有 E2 债）,
 *  误入 lighter 曾加算白闪;GA case 34 return 1 承接。同批入组：5 小丑箭（:81240）
 *  与 92 坠星（:80999,并行批 R1 已落） */
// ProjectileID.Sets.IsDestroyedByWater 消亡表（ProjectileID.cs:287 {85,15,188,34,1097,1106}）
// 2026-09-08 湿段收口批退役本文件本地副本——唯一权威=projWetSection.PROJ_DESTROYED_BY_WATER
// （共享湿段体 hooks.kill 消费;Arrow 域成员=34/1097 等经 hooks 接线,见 wetSectionStep）。

/** LegacySoundPlayer case19 溅水音 pitch 档（LegacySoundPlayer.cs:879-887）：style 4/5
 *  → Main.rand.Next(−20,1)×0.01、其余（含缺省 Style=1）→ Next(−10,11)×0.01——
 *  XNA SoundEffectInstance.Pitch（±1 域,2^pitch 变速） */
function splashPitch(style: number): number {
  return (style === 4 || style === 5
    ? Math.floor(Math.random() * 21) - 20
    : Math.floor(Math.random() * 21) - 10) * 0.01;
}

// ---- ★BJ-C1 F3（2026-10-06）常量色族通用全亮通道——recording-ctx 助手 ----
/** 绘制序列记录器（bj529② recording-ctx 闭包重放锁体裁的生产化）：本体段逐位
 *  执行但落笔进记录器——方法调用全量记序、状态写面（globalAlpha/filter/合成域/
 *  平滑/填色）记序+取值面读记录态（xeno 支 baseGa=ctx.globalAlpha 读回同相）。
 *  commit=按序重放到目标 ctx（7f flushTrailShade 相机系内执行）=单源零复制——
 *  专支/帧选/镜像/滤链全部原位运行,只换落笔目标。 */
type RecOp = { op: string; args: unknown[] };
const REC_STATE_PROPS = new Set(['globalAlpha', 'globalCompositeOperation', 'filter',
  'imageSmoothingEnabled', 'fillStyle', 'strokeStyle', 'lineWidth']);
function createRecBodyCtx(rec: RecOp[]): { proxy: CanvasRenderingContext2D; commit: (c: CanvasRenderingContext2D) => void } {
  const state: Record<string, unknown> = {
    globalAlpha: 1, globalCompositeOperation: 'source-over', filter: 'none',
    imageSmoothingEnabled: true, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
  };
  const proxy = new Proxy({} as unknown as CanvasRenderingContext2D, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      if (REC_STATE_PROPS.has(prop)) return state[prop];
      return (...args: unknown[]) => { rec.push({ op: prop, args }); };
    },
    set(_t, prop, v) {
      if (typeof prop === 'string') {
        state[prop] = v;
        rec.push({ op: `set:${prop}`, args: [v] });
      }
      return true;
    },
  });
  return {
    proxy,
    commit(c: CanvasRenderingContext2D): void {
      for (const r0 of rec) {
        if (r0.op.startsWith('set:')) {
          (c as unknown as Record<string, unknown>)[r0.op.slice(4)] = r0.args[0];
        } else {
          (c as unknown as Record<string, (...a: unknown[]) => void>)[r0.op]?.(...r0.args);
        }
      }
    },
  };
}

/** ★BJ-C9 F4（2026-10-08）常量色族 tint 档双通道 replay（recording-ctx 消费侧;
 *  export=测试面直调体裁,生产消费=draw finally 段闭包）：
 *  XNA AlphaBlend(One/InvSrcAlpha) 两因子分离——src.rgb=tex.rgb·tex.a·cR（cA 不缩
 *  RGB,BJ556 鞭标记判例）/src.a=tex.a·cA。canvas 单笔强制 src.rgb×ga=A 双乘 RGB
 *  =BJ551 289 旧案病灶 → 录制流双放：
 *   pass1（erase 面）：逐 drawImage 前强制 comp='destination-out'——ga 取流内值
 *     （drawTableAlpha 已把 GetAlpha A 通道折进 globalAlpha:fixed=cA/fixedfade=cA·fade/
 *     afade=A 值）→ dst×(1−tex.a·A/255) 精确;
 *   pass2（add 面）：逐 drawImage 前强制 comp='lighter'+ga=addGa、img 替换
 *     tintedTex(img, cRGB, flatten=false)（★BJ700-C 勘误：保 alpha 形状——flatten=true
 *     的 multiply 摊平把透明域填成不透明【染色底】非黑（canvas multiply αb=0 域
 *     Co=Cs,αo=1,BJ371 判例）,'lighter' 全幅加 cRGB=白底大方块;保形后透明域
 *     贡献 0、不透明域 → += tex.rgb·cR·tex.a·addGa 精确）。
 *  addGa（rgb 侧衰减因子,与 A 侧分离）：fixed/afade=1（rgb 恒定）;fixedfade=
 *  (1−α/255)（518 n 双折/969 Opacity——rgb=A 同折,erase ga 已含,add 面补 rgb 侧）。
 *  两放共同变换：set:globalCompositeOperation/set:filter 流内写面剔除（comp 强制/
 *  亮度近似滤镜废除——bake 已承 rgb 面,双乘即错）,其余状态（save/rotate/globalAlpha/
 *  imageSmoothing）逐位重放=专支/帧选/镜像单源零复制（createRecBodyCtx 同契）。
 *  node 单测无 DOM：tintedTex 返 null → add 面跳笔（erase 面仍落=半透残影,与
 *  whipFullbright 同守卫域登记）。 */
export function replayTintedFullbright(
  rec: RecOp[], c: CanvasRenderingContext2D,
  tint: readonly [number, number, number, number], addGa: number,
): void {
  const rgb: [number, number, number] = [tint[0], tint[1], tint[2]];
  const addImg = new Map<unknown, HTMLCanvasElement | null>();
  const replayPass = (mode: 'erase' | 'add'): void => {
    for (const r0 of rec) {
      if (r0.op === 'set:globalCompositeOperation' || r0.op === 'set:filter') continue;
      if (r0.op === 'drawImage') {
        const args = [...r0.args];
        if (mode === 'add') {
          let baked = addImg.get(args[0]);
          if (baked === undefined) {
            // ★BJ700-C：flatten=false 保 alpha 形状（BJ371 判例同刀）——flatten=true 的
            //  multiply 摊平把透明域填成【不透明染色底】（canvas multiply αb=0 域
            //  Co=Cs,αo=1,非黑 rgb 即整幅染色）,'lighter' 全幅加 cRGB = 白底大方块
            //  （329 焰镰用户实报;8 站全透明域精灵,二值 α 语义保形精确）
            baked = tintedTex(args[0] as Parameters<typeof tintedTex>[0], rgb, false);
            addImg.set(args[0], baked);
          }
          if (!baked) continue;                 // node 无 DOM=烘焙缺,add 面跳笔
          args[0] = baked;
          c.globalCompositeOperation = 'lighter';
          c.globalAlpha = addGa;
        } else {
          c.globalCompositeOperation = 'destination-out';
        }
        (c as unknown as Record<string, (...a: unknown[]) => void>).drawImage?.(...args);
        continue;
      }
      if (r0.op.startsWith('set:')) {
        (c as unknown as Record<string, unknown>)[r0.op.slice(4)] = r0.args[0];
      } else {
        (c as unknown as Record<string, (...a: unknown[]) => void>)[r0.op]?.(...r0.args);
      }
    }
  };
  replayPass('erase');
  replayPass('add');
}

/** ★BJ668（2026-10-12）Lerp 族光感算子 lift 面重放（recording-ctx 消费侧;
 *  export=测试面直调体裁,生产消费=draw finally 段闭包）：
 *  代数恒等式白抬升半边——base（实体层,流内 filter=brightness(1−k),被 compositeLight
 *  乘光）+ lift（本函数,flushTrailShade 7f 光照合成后主画布重放）:
 *    base·light + lift = tex·tex.a·ga·[(1−k)·light + k] ≡ vanilla tex×ga×Lerp(light,White,k)。
 *  变换规则（replayTintedFullbright 同契）：
 *   · set:filter 流内剔除 + 强制 'none'（基底 brightness(1−k) 不得压 lift 面——
 *     lift 权重全在 globalAlpha ×k 里）;
 *   · set:globalCompositeOperation 流内剔除 + 强制 'lighter'（整个 lift 面预乘加算,
 *     XNA One/One——dst 因子缺失恒等:vanilla C 项像素贡献=tex·ga·k 纯加法;
 *     流内 lighter↔source-over 舞蹈（xeno 叠画族）逐笔归一加算=权重面同构）;
 *   · set:globalAlpha 逐值 ×k（体贡献 tex·tex.a·ga·k 精确;写面在流内交错——
 *     xeno baseGa 读回-覆写-恢复链同倍缩放,权重比例零漂）;
 *   · 其余状态/几何（save/translate/rotate/scale/平滑）逐位重放=专支/帧选/镜像
 *     单源零复制（createRecBodyCtx 同契）。 */
export function replayLerpLift(
  rec: RecOp[], c: CanvasRenderingContext2D, k: number,
): void {
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.filter = 'none';
  for (const r0 of rec) {
    if (r0.op === 'set:globalCompositeOperation' || r0.op === 'set:filter') continue;
    if (r0.op === 'set:globalAlpha') {
      const g = (r0.args[0] as number) * k;
      c.globalAlpha = Math.max(0, Math.min(1, g));
      continue;
    }
    if (r0.op.startsWith('set:')) {
      (c as unknown as Record<string, unknown>)[r0.op.slice(4)] = r0.args[0];
    } else {
      (c as unknown as Record<string, (...a: unknown[]) => void>)[r0.op]?.(...(r0.args ?? []));
    }
  }
  c.restore();
}

/** ★V3 溅花段共享体（Projectile.cs:16935-17102 producer 站=湿缓存刷新位,2026-09-03；
 *  2026-09-04 火箭水花缺口批抽出为自由函数——Arrow.wetSplashStep 与 GrenadeProj
 *  通用湿段（WeaponProj.ts）共用,参数化实体位 (x,y,w,h) 与三粘滞旗）：
 *  入水（flag2 支 :16935-16976）与出水（else-if wet 支 :16977-17102）共用的
 *  四液溅花面——每拍 10 粒、矩形 (x−6, y+h/2−8, w+12, 24)（★唯一例外 = 出水
 *  【水】支 :17059 `position.Y + height/2` 无 −8 逐字保留）、字段覆写/音效逐值：
 *   · 微光 d308：型内预处理（Dust.cs:227-231 v×0.5+Y++,2026-09-06 残差批补链——
 *     VanillaDust.spawn 未植该支,调用侧先行再上覆写;净初速=桩 0×0.5+1−4=−3,与
 *     Player.ts 发射器同式）→ vy−4 / vx×2.5 / scale=1.3 / noGravity / 六掷三色
 *     （:204-218 Next(6)：0=(255,255,210) 1=(190,245,255) 2=(255,150,255)
 *     default×3=(190,175,255)）+ PlaySound(19,…,4|5)【循环内】×10——原版
 *     LegacySoundPlayer case19 头 `SoundInstanceSplash[num] 未停 → break`（:874-878）
 *     同拍去重 ⟹ 有效 1 次（:893-901 style4/5 互斥对,音量 ×0.75、pitch Next(−20,1)×0.01）
 *     → 本仓播 1 次；Splash_4（入）/Splash_5（出）。
 *   · 蜂蜜 d152：型内预处理（Dust.cs:246-254 v×0.1+vy=−0.5,同批补链）→ vy−1 /
 *     vx×2.5 / scale=1.3 / α100 / noGravity + Splash_1（循环外）。
 *   · 水 dustWater()（Dust.cs:405 waterStyle 分档,缺省 33）：33/98-105 族型内预处理
 *     池内已植（α170/v×0.5/Y++,α 后被调用侧 100 绝对覆写=原版行序）→ vy−4 / vx×2.5 /
 *     scale=1.3 / α100 / noGravity + Splash_1（循环外）。
 *   · 岩浆 d35：型内预处理（Dust.cs:246-254 同 152）→ vy−1.5 / vx×2.5 / scale=1.3 /
 *     α100 / noGravity + Splash_1（循环外）。
 *  档位选择：入水看 !flag（当拍 LavaCollision）出蜂蜜/微光/水、flag=岩浆
 *  （:16942/:16966）；出水看 !lavaWet（粘滞旗,:16988/:17047）——岩浆粘滞弹出水
 *  溅岩浆花。Splash_1 音 = PlaySound(19) Style 缺省 1 → SoundSplash[1]（:874 直取
 *  num=1,音量 1、pitch Next(−10,11)×0.01 :879-887）。
 *  尘池契约：spawnDust 缺省 5px 盒/±2 随机初速（NewDust :122-151 同式）,
 *  scale=1.3 为【绝对覆写】（抹平 NewDust ±0.2 抖动,原版 :16953 等同款）。 */
export function wetSplashStepShared(
  game: GameHooks, x: number, y: number, w: number, h: number,
  lavaFlag: boolean, leaving: boolean, lavaWet: boolean, shimmerWet: boolean, honeyWet: boolean,
): void {
  const useLava = leaving ? lavaWet : lavaFlag;
  const shimmer = !useLava && shimmerWet;
  const honey = !useLava && !shimmer && honeyWet;
  const dustType = useLava ? 35
    : shimmer ? 308
    : honey ? 152
    : dustWaterFor((game as unknown as { renderer?: { waterStyle?: number } }).renderer?.waterStyle ?? 0);
  const dy = leaving && !useLava && !shimmer && !honey ? 0 : -8;   // 出水【水】支无 −8（:17059）
  const boxX = x - 6, boxY = y + h / 2 + dy;
  const shimmerStyle = leaving ? 5 : 4;                           // PlaySound(19,…,4) 入 / (19,…,5) 出
  for (let n = 0; n < 10; n++) {
    const d = game.spawnDust?.(boxX, boxY, w + 12, 24, dustType);
    if (d) {
      if (shimmer) {
        // NewDust 308 型内初速预处理（Dust.cs:227-231 v×0.5+Y++,VanillaDust.spawn 未植
        // → 调用侧按原版链补齐,Player.ts 溅花发射器同式）先行,再上调用侧覆写
        d.vx *= 0.5; d.vy = d.vy * 0.5 + 1;
        d.vy -= 4; d.vx *= 2.5; d.scale = 1.3; d.noGravity = true;
        const c = Math.floor(Math.random() * 6);            // Next(6) 六掷三色+缺省×3
        d.color = c === 0 ? { r: 255, g: 255, b: 210, a: 255 }
          : c === 1 ? { r: 190, g: 245, b: 255, a: 255 }
          : c === 2 ? { r: 255, g: 150, b: 255, a: 255 }
          : { r: 190, g: 175, b: 255, a: 255 };
      } else if (honey) {
        d.vx *= 0.1; d.vy = -0.5;                           // NewDust 152 支补链（Dust.cs:246-254）
        d.vy -= 1; d.vx *= 2.5; d.scale = 1.3; d.alpha = 100; d.noGravity = true;
      } else if (useLava) {
        d.vx *= 0.1; d.vy = -0.5;                           // NewDust 35 支补链（Dust.cs:246-254）
        d.vy -= 1.5; d.vx *= 2.5; d.scale = 1.3; d.alpha = 100; d.noGravity = true;
      } else {
        // 水支：dustWater()=33/98-105 族型内预处理（α170/v×0.5/Y++）VanillaDust.spawn
        // 已植 → 此处无需补链;α100 为绝对覆写（消解 170）与原版调用侧行序一致
        d.vy -= 4; d.vx *= 2.5; d.scale = 1.3; d.alpha = 100; d.noGravity = true;
      }
    }
    // :16966/:16996 PlaySound(19,…,4|5) 在原版位于循环【内】×10——case19 头
    // `SoundInstanceSplash[num] 未停 → break`（LegacySoundPlayer.cs:874-878）同拍
    // 去重 ⟹ 有效恰 1 次（style4/5 互斥对 :893-901,音量 ×0.75）→ 本仓循环外播 1 次
  }
  if (shimmer) {
    game.playSfxWav?.(`Splash_${shimmerStyle}`, 0.75, x + w / 2, y + h / 2, splashPitch(shimmerStyle));
  } else {
    game.playSfxWav?.('Splash_1', 1, x + w / 2, y + h / 2, splashPitch(1));   // :16970/:16975/:16991 等循环外
  }
}
const ADDITIVE_GLOW_PROJS = new Set([15, 93, 94, 95, 96, 1114, 253, 258, 102,
  // ★T2/R 类清账（2026-09-02 用户拍板）：34 火焰鞭出组——活分支 :80753
  //  `White*Opacity`（:81007 里 34 是死入口）= 不透明白常规合成,理由详组头注;
  //  GA case 34 return 1 兜底承接（本体绘制面在 MissileProj 16/34/79 导弹族）。
  // ★T3/R 类清账（同批）：5 小丑箭入组——GetAlpha :81240-81242 恒 (255,255,255,0)
  //  纯加算白亮体（F3 长期正解落定,'lighter' 下 ga=1=满强加算;实机观感=普通
  //  贴图→白亮发光体,原版相）。
  5,
  876,
  // ★2026-09-01 激光步枪批：GetAlpha :81457 支全名单（(255−α,255−α,255−α,0) 纯加算白）
  //  88 PurpleLaser（激光步枪 514）/83/89/90/100/104/279/283-287 zapinator 系/1134。
  //  XNA 预乘语义 A=0 → dst+=tex.rgb 全强度叠加；source-over 直译=暗紫细线不可见
  //  （用户报「激光好细看不清」定罪：贴图本体 Projectile_88.png 仅 2×60，
  //  scale 0.65 起步 ≈1.3px 细线 + 缺加算发光层双重不可见）
  83, 88, 89, 90, 100, 104, 279, 283, 284, 285, 286, 287, 1134,
  // ★BJ228 普查批（2026-09-21）：20 绿激光（:81390 常量加算白,SetDefaults α≡0）
  //  /76/77/78 琴音弹（:81020 恒加算白不读 α）——GA case 20/76-78 return 1 配对,
  //  出生面=太空枪 127/魔法竖琴 494。
  20, 76, 77, 78,
  // ★BJ236（2026-09-21）：254 磁球（GetAlpha :81278-81287 (255−α,…,0) A=0 加算白,
  //  强度 min(1,life/30) 由 GA case 254 承载）——出生面=磁球 1266 magic shoot
  //  （kind 'magic' 通用 Arrow,Game magic 支）。
  254,
  // ★R5 终验批：723-726/1133 斗篷星族(:80992-80995 (255,255,255,0)×Opacity——
  // 加算白×透明度;ga=1−starAlpha/255 渐变由 drawGlobalAlpha case 承载,此处只
  // 切 lighter。728/9 走 StarfuryStar 专载体不在 Arrow draw 路径)
  723, 724, 725, 726, 1133, 728,
  // ★2026-09-01 审计补：131 蘑菇孢子(:81325) A=0 加算白——真值起步 α≡0
  //  （SetDefaults 无显式行）→ 满(255−α)/255 加算=与原版一致 ✓
  // ★F5（红队 A 仲裁定罪,2026-09-02）：631 幻象矢入组——GetAlpha :80818
  //  `type==604||type==631 → (255−α,255−α,255−α,0)` 纯加算白。批五撤回理由
  //  "631 无键"已被批六键值覆盖：PROJ_ALPHA0[631]=255 在账、AI_122 渐显
  //  （有效态 −15/subStep :35592-35594、失效态 +10 至 255 Kill :35579-35583）
  //  已在 subStepAI 631 支、vanillaProjAlpha[631] off=1 放行 → 通用兜底
  //  (255−α)/255 活读——此前只差合成方式（source-over 直译=灰白半透,
  //  lighter=预乘真值 RGB 全额加算）。出生面=幻象弓 630 命中侧补刀三连
  //  （本文件 spawnIllusionBolts :3017 区）。
  //  604 孢子云仍不入组（本仓无出生面=dormant,不接合成方式零观感差）——
  //  ★真值勘误：SetDefaults :6073-6085 【无 alpha 行 α≡0 起】,旧注":6525
  //  α=255"系错锚（该行是 602 的）；GetAlpha 同支 (255−α,…,0) 加算白、
  //  aiStyle115 :35062-35076 ai[1]>30 后 α+=10 至 255 Kill = 先满亮后淡出自灭。
  //  若未来接出生面须连 AI_115 fade 段一并移植再评估入组。
  //  ★T6 闭疑（2026-09-02 蓝队）：631【无 charm 面】——弧线引矢重定向门 Player.cs
  //  :28680（HarpyCharmEffect）要求 `!projectile.arrow || owner!=me || aiStyle != 1 ||
  //  HarpyCharmed` 即 aiStyle==1 才可引;631 SetDefaults（:6781-6792）aiStyle=122
  //  （arrow=true 但 aiStyle 门直接排除）→ ADDITIVE_GLOW ∩ charm 重定向交集为空,
  //  本仓 harpyCharmEffect 的 `(projectileData(631)?.aiStyle ?? -1) !== 1` 同判
  //  （vanilla-projectiles.json 631.aiStyle=122 与原版一致）——疑点关闭零代码面。
  131, 631,
  // ★R1(T1,2026-09-02)：92 坠星入组——GetAlpha :80999 恒 (255,255,255,0) 纯加算白
  //  （GA case 92 return 1 配对;aiStyle5 通用闪烁档 0..200 不进 GetAlpha=振而不闪）。
  //  可见面=本体加算 + light0.9 + 尘58@1/10 + gore 16-17（Next(16,18) 右开）@1/20
  //  （subStepAI 92 支）。
  92,
  // ★T1（2026-09-02）：91 圣箭波入组——GetAlpha :81003 (200,200,200,0) A=0 加算灰
  //  （"5 小丑箭"隐形先例反转后定谳:XNA 预乘 dst+=tex.rgb×(200/255),非隐形）;
  //  GA case 91 return 200/255 配对,'lighter' 下 ga=200/255 = 同强度加算直译。
  //  出生面核实=圣箭 516（vanilla-itemcombat.json shoot:91/shootSpeed 3.5,非红队
  //  标注的"Starfury 星怒"——星怒剑星=503/星怒弹=9）;AI 尘（:56553-56560 d58|d15）
  //  与 Kill 星雨（Game.onProjectileDeath 91/92 支）均已在,唯合成方式缺。
  91,
  // ★2026-09-02 遗留批：265 剧毒法杖弹/355 毒液法杖弹入组——GetAlpha :81286-81293
  //  （1457）`α>0→Transparent / α==0→(255,255,255,0)` A=0 满强加算白（fade 期全隐,
  //  可见面=AI d163/d205 毒泡;落通用兜底渐显 ramp 曾错画本体淡入+普通合成白贴）。
  //  PROJ_ALPHA_MOD alpha0additive 档配对（GA α==0?1:0）；charm 态（aiStyle=1）
  //  被 :80605-80611 White*Opacity 截走=常规合成——draw 侧 M-2 分流同 5/91。
  265, 355,
  // ★2026-09-17 用户实报「一排剑」批：660 天界碎裂剑入组——GetAlpha :81373
  //  `(150,255,255,0)*Opacity`（Opacity=1−α/255 :542-552）——A=0 彩色加算青白;
  //  SetDefaults α=255 出生首拍 Opacity=0 全隐,AI 首子步白闪门 α→0 后恒满强。
  //  PROJ_ALPHA_MOD[660] alpha0additive 档配对（GA α==0?1:0,同表登记残留清偿）;
  //  彩色色相未建模=亮度近似债（vanillaProjAlpha 表头注约定）。
  660]);
/** GetAlpha :81457 支里走共享 −15/update 渐显的成员（Projectile.cs:56570-56592
 *  case 组 14/20/36/83/84/89/100/104/110/158-161/180/279/283-287/389 的本族子集，
 *  组体在 AI_001() 内(:54950 起)，全部 aiStyle=1 型每 AI update 恰一消费）。
 *  本仓接 GetAlpha 支与批二扩员者；14/20 不入（SetDefaults 无 alpha 行≡0 起步,
 *  fade 恒不触发——批二审计维持）；90/1134 不减（AI 无衰减档）α 恒 50=恒 205/255；
 *  88 α 初值即 0 且专属 −10/t 段(:56910)恒空转。
 *  ★2026-09-01 批二扩员九枚：36 陨石弹/84 粉激光/110 雪人子弹/158-161 钱币枪四币/
 *  180 神射手子弹/389 小视网膜激光——共享 case 组全成员核验(P.cs:56573-56591),
 *  SetDefaults α=255(:1192/:1656/:1988/:2467/:2479/:2491/:2503/:2670/:4739),
 *  无 Arrow.ts 专属 alpha 竞争支、无 drawGlobalAlpha case；唯 180 有 GetAlpha 专属
 *  Lerp 白支(P.cs:80734→PROJ_ALPHA_MOD lerp 档承接,fade 动态乘子不压渐显) */
const LASER_FADE15_PROJS = new Set([
  // zapinator 系激光组（批一）
  83, 89, 100, 104, 279, 283, 284, 285, 286, 287,
  // 批二扩员（P.cs 共享 −15 case 组成员）
  36, 84, 110, 158, 159, 160, 161, 180, 389]);
export const PROJ_ALPHA0: Record<number, number> = {
  5: 100, 94: 50, 95: 100, 280: 255, 477: 255, 478: 255, 521: 255, 639: 255, 932: 0,
  // ★登记债3 清偿（2026-10-06,光女发暗刀）：874 DeathAurora 天降极光 SetDefaults
  //  alpha=255（Projectile.cs:8369-8380 :8374,1458 同值）——★休眠键（同 188/631
  //  先例）:本仓现无 874 载体（光女 AI_120 攻击 3「天降极光」= expert 专属拍,
  //  bossAI_lategame.ts 台账明记跳过;全仓无 spawn/draw 面,Renderer 仅
  //  SELF_LUMINOUS_PROJS[874] floor1+whiten 预注册,eol2-empress-bright.test 锁）。
  //  ★原版 α 语义定谳:874 绘制 = DrawMurderAurora 专属支（Main.cs:28764→:36619）
  //  【不读 proj.alpha】——15 层极光带色 = hslToRgb(num12%1,1,0.5)×num3×amount,
  //  A/=4（:36652）,num3=timeLeft 双 GetLerpValue 包络;SetDefaults α=255 在原版
  //  通用绘制路径永不可达（专属支先 return）。本键作用 = 未来接发射面时防缺省
  //  α≡0 兜底把整张 aurora 底图全亮画出（原版本相=无通用弹体）。
  874: 255,
  640: 255,                                    // 月总箭衍生体（SetDefaults :6902 alpha=255；
                                                //  AI −25/substep 渐显并入 639 支,Kill 批 2026-09-02）
  207: 255, 837: 255,
  // ★BJ375：664/666/668 爆炸烈焰塔弹（SetDefaults :7155-7163 alpha=255）——
  //  AI_131 −25/t 渐显（:69543-69549,约 11 拍全显）,消费=vanillaProjAlpha lerp 档
  //  fade 乘子;逐 tick 衰减支见 subStep 段 BJ375 块
  664: 255, 666: 255, 668: 255,
  // R27：22 水花权杖 alpha=255(:1048)/27 水矢 alpha=255(:1103)+timeLeft/=2=1800(:1104)/
  // 45 恶魔镰刀 alpha=100(:1288，GetAlpha :81465-81468 恒 White 不读 α)——★F2 升格：
  // 显式 GA 豁免（drawGlobalAlpha case 44/45 return 1）,通用兜底禁止消费本值
  // （此前 (255−100)/255≈0.61 压暗=违原版恒满亮;44 同支同 alpha=100 :1277,无键
  // α≡0 兜底碰巧=1,现一并显式豁免）/
  // 7/8/150/151/152 荆棘链 alpha=255(:884/:2408，aiStyle4 渐显期 −50[/−75]/update 消费)
  22: 255, 27: 255, 45: 100,
  // ★BJ643①：1001 无头骑士南瓜弹（SetDefaults :9520 alpha=255——AI_194 Opacity 链
  //  :42057-42064 驱动渐显/淡出;消费=vanillaProjAlpha fade2 档（GetAlpha :80718-80720
  //  White*Opacity 后落缺省尾）——出生隐形,30t 渐显 1/30/t、末 6t −0.1/t 淡出）
  1001: 255,
  410: 255,                                                          // 泡泡枪泡体（:4926 alpha=255,ai72 −25/t 渐显钳 50）
  // ★BJ371：409 剃刀台风（SetDefaults :4911 alpha=255——AI −5/触发 钳 50 :30872-30877;
  //  ★绘制面 inert：GetAlpha 409 专属支 :81148-81151 恒 (250,250,250,200) 不读 α,
  //  vanillaProjAlpha[409] fixed 档承载——本键=AI α 场台账初值,勿按 (255−α)/255 兜底消费）
  409: 255,
  7: 255, 8: 255, 150: 255, 151: 255, 152: 255,
  // BJ353：魔晶碎块链 493 头/494 杆（SetDefaults :5669-5681 alpha=255——aiStyle4 渐显
  //  −100/t 消费;曾缺列 = 首发段出生即全显,渐显链无起点且淡出面全缺）
  493: 255, 494: 255,
  876: 255,                                                          // 灰/橙 zapinator（:8426）
  // ★R28：294 暗影束（SetDefaults :3840-3849 alpha 无显式行——aiStyle48 AI 支
  // :28640-28644 `alpha = 255` 每 update 直写）/ 295 地狱火叉弹（aiStyle50
  // SetDefaults alpha=255 :3851-3870 区段）/ 296 火柱爆区（同段）/
  // 535 美杜莎之首（SetDefaults :6096-6108 无 alpha 行但本体常驻玩家头部,
  // GetAlpha 缺省路径不消费——本仓转换成专用类前的一帧兜底）
  294: 255, 295: 255, 296: 255, 535: 255,
  // ★BJ164 登记债②（2026-09-18）：101 魔眼/斯帕兹喷火（SetDefaults :1887-1895
  //  alpha=255 :1893,1458 同值;GetAlpha :80595-81530 无 101 支 → 缺省路径
  //  num14=(255−α)/255=0 → 弹体贴图【恒隐】,视觉=d75 火流拖尾——aiStyle23 AI
  //  :26213-26262 尘站已在 subStepAI 101 支（普查批②）+ 寿命帽 60 子步 :26201）。
  //  静态键无 fade 配对=合法：原版 AI 全程不写 α,兜底 (255−255)/255=0 恒隐正是
  //  原版本相（同 294-296 族"视觉=尘流"语义）;缺键=α≡0 → 兜底 ×1 全亮本体穿帮。
  //  出生面=bossAI 魔眼 shoot 口（:1405,Spazmatism NPC.cs:27632 唯一发射者）
  101: 255,

  // ★R29：631 幻象矢（SetDefaults :6783-6792 alpha=255 渐显,AI_122 −15/t 消费）/
  // 661 黑爆弹（:7110-7122 alpha=255,AI −55/t 渐显+scale1.3）/ 819 血箭（:7997-8006
  // alpha=255+hide 隐形弹体,DrawProj −20/t 渐显,视觉=血迹拖尾）/ 955 星星炮星
  // （:9015-9024 alpha=50 起 AI_005 通用闪烁档 0↔200 ±25/t）/ 728 超级星星炮星
  //（:7661-7672 alpha=255,AI_151 −10/t 钳 100）
  631: 255, 661: 255, 819: 255, 955: 50, 728: 255,
  // ★R29：469 蜂箭（SetDefaults :5437-5446 alpha=255——AI :56164 localAI>2 后
  // −50/update 渐显;此前缺列 = 蜂箭出生即全显,渐显链无起点）
  469: 255,

  114: 255,                                                          // 邪恶三叉戟（:2031；AI 侧按速度 Remap 改写 :26794）
  // ★BJ236 剑气族（2026-09-21）：SetDefaults alpha=255 直读——116 :2040/:2045 区、
  //  132 :2219-2222、156 :2455-2457、157 :2448-2451(scale1.2)、173 :2597-2600。
  //  AI aiStyle27 脉动（:26846-26858）以此 255 为起点 ±30/步 0↔255 折返（GA ≥15 段
  //  (255,255,255,α) 的 A 通道=本值,梯期不读）
  116: 255, 132: 255, 156: 255, 157: 255, 173: 255,
  163: 255, 310: 255, 1008: 255, 1009: 255, 1010: 255, 1011: 255,   // 信号枪族（163 :2523 等）
  514: 255,                                                          // 钉（aiStyle 93 −25/t 渐显 :33427-33434）
  246: 255,                                                          // 刺炮弹（−20/t 渐显 :58106-58110）
  311: 255,                                                          // 糖果玉米（−50/t 渐显 :58117-58123）
  442: 255,                                                          // 电圈导弹（−90/4t 渐显 :55691-55703，AI 段消费）
  451: 255,                                                          // 涌流剑（SetDefaults alpha=255 :5237；飞行期 0↔75 脉动 :31620-31640）
  617: 255,                                                          // 星璇秘术（SetDefaults alpha=255 :7106-7116；−15/t 渐显 :35290-35295）
  181: 255, 189: 255, 307: 255, 316: 255, 566: 255,                  // aiStyle 36 蜂族（−50/update 渐显 :27690-27697）
  188: 255,                                                          // ★BJ206 2026-09-20：帽族（SetDefaults :2754-2764 alpha=255 :2761,aiStyle 23,
                                                                     //  friendly+hostile+penetrate −1）——本仓现无发射面=休眠键,防未来接
                                                                     //  发射面时缺省 α≡0 兜底全亮穿帮（同 631 先例）
  616: 255,                                                          // 星旋涡旋弹（−25/t 渐显 :58378-58384）
  // ★F1 注释更正（红队 A 仲裁）：297 幽灵法杖弹 SetDefaults :3872-3882 alpha=255
  //  （旧注":5685-5695"错行、"AI 不消费恒全显"已被 draw 兜底推翻——缺省 GetAlpha
  //  路径 (255−255)/255=0 → 弹体贴图【恒隐】）；可视本体 = AI_051 的 d175 尘雾
  //  （:28827-28838 localAI[0]>4 后每 update 5 枚，noGravity/scale2/vel=0），
  //  subStepAI 297 支承载
  297: 255,
  659: 255,                                                          // 灵魂之焰（SetDefaults :8571-8580 alpha=255，−12/t 渐显 :36901-36903）
  467: 255,                                                          // 教徒火球制导支（AI 支 α−40/update 渐显 :55194-55200）
  // ★2026-09-01 GetAlpha :81457 加算白支的 α 初值记账（SetDefaults 直读；缺省=0 的
  //  88 不入表——:1704-1716 无 alpha 行）。83=255(:1642)/89=255(:1725)/90=50(:1739)/
  //  100=255(:1881)/104=255(:1924)/279=255(:3660)/283-287=255(:3707-3767)/1134=50(:10648)。
  //  255 组由共享 −15/子步渐显(cs:56570-56592,LASER_FADE15_PROJS)拉亮;EU 弹每游戏帧
  //  实减 ×(EU+1)（本组 89 EU=1 其余 EU=2 → ×2~×3）≈ 一闪即亮（原版太空枪系激光观感；
  //  ★批二勘误：旧注「EU=4×5」与 SetDefaults 不符——279 即 EU=2(:3661)，全组无 EU=4）
  83: 255, 89: 255, 90: 50, 100: 255, 104: 255, 279: 255,
  283: 255, 284: 255, 285: 255, 286: 255, 287: 255, 1134: 50,
  // ★2026-09-01 批二：共享渐显组扩员九枚初值（SetDefaults 直读，行号已逐一 sed
  //  校验;AI_001 共享 case 组 −15/子步拉亮 P.cs:56569-56599）——36 陨石弹(:1192)/
  //  84 粉激光(:1656)/110 雪人子弹(:1988)/158 铜币(:2467)/159 银币(:2479)/
  //  160 金币(:2491)/161 白金币(:2503)钱币枪四币/180 神射手子弹(:2670)/
  //  389 小视网膜激光(:4739)。GetAlpha 全走缺省路径 :81507-81520(num14=(255−α)/255)
  //  → 兜底式承接;唯 180 走 Lerp 白支(:80734)由 PROJ_ALPHA_MOD lerp 档消费 fade
  36: 255, 84: 255, 110: 255, 158: 255, 159: 255, 160: 255, 161: 255,
  180: 255, 389: 255,

  // ★2026-09-01 批三（a/b/c 三分法，α 初值账本收尾批）——
  // [c 类·须连 AI 减段一起移（subStepAI 同名分支已配套）]
  //  576/577 星晕/漩涡激光（NebulaLaser/VortexLaser）SetDefaults :6267/:6279
  //   alpha=255；AI_001 共享 fade 开关第二组 P.cs:56601-56613：localAI[1]++ >2 后
  //   每子步 −15 至 0（EU=2 → ×3 子步/帧）。承载=576 bossAI_lunar_misc 星晕环绕球
  //   线发(Arrow 直构)；577 实际出生端=风暴潜水员(fighterFamilies.ts spawnHostileProj→Dart,
  //   DART_STYLE 无表项) —— Dart 载体不读本表,Arrow 路径 dormant 备案
  //  1037/1049 星陨落星（MeteorWhipMeteor/MeteorStormMeteor）SetDefaults :9792/:9950
  //   alpha=254（罕见非 255）；aiStyle5 分支 P.cs:24137-24150 每子步 −10 钳 0。
  //   承载=1037 WhipTag.ts 星陨 proc 首跳(活跃)；1049 原版唯一出生=DST+FTW+风暴天
  //   WorldGen.cs:72292 陨雨(本仓无此世界事件组合,dormant)
  576: 255, 577: 255, 1037: 254, 1049: 254,
  // ★2026-09-01 批四（T2/H7）：968 气喇叭弹 PewMaticHornShot（SetDefaults :9169-9176
  //  alpha=255、aiStyle2）——AI() aiStyle2 顶层 type 段 α=Math.Max(0,α−50)/拍
  //  （P.cs:23429），subStepAI 968 支配套（c 类·表键+AI 减段成对）。GetAlpha 无
  //  专属支 → 缺省路径（:81507-81521）由 draw 侧通用兜底 (255−α)/255 消费。
  //  出生面=气喇叭 5117 枪链 Arrow 直构（Player.cs:48057-48064 唯一射手）
  968: 255,
  // [b 类·AI 写段已移植，补键即完成配对]
  //  12 落星 FallingStar（:937 alpha=50）：aiStyle5 共享振荡档 ±25/t 0..200 已在
  //   subStepAI 955||12 支（:3551 起,twinkleDir=1 起步与原版 localAI[0] 置 1 同相）、
  //   PROJ_ALPHA_MOD[12] fade 档现役消费 → 补键修正起步相位（此前 α≡0 少 50 起点）。
  //   出生面备案：1457 星炮族改射 955(Item 197 useAmmo75),弹幕 12 本仓现无出生路径
  12: 50,
  // ★2026-09-03 斗篷星 alpha 渐减批：723-726/1133 星光/蜂蜜/魔力/蛇斗篷反击星
  //  （SetDefaults :7655 alpha=50 起）。AI_005 :24165-24176 −15/t + 条件下限
  //  num44=100（Center.Y>=ai[1] 越线后 0）——带越线条件门,不入 AI001_FADE_RATE
  //  （那是 AI_001 无门恒率表）,消费点=starY 通道（starCollide 旁,起步差经构造器
  //  本表注入）。907 不入:aiStyle30（:8619-8626）SetDefaults 无 alpha 行,GetAlpha
  //  :76102 fixed (255,255,255,150) 恒,已由 PROJ_ALPHA_MOD[907] 承载
  723: 50, 724: 50, 725: 50, 726: 50, 1133: 50,
  // [a 类·静态半透死存储惰性补键]——SetDefaults 有值、AI 全程不写、原版渲染面
  //  不消费（GetAlpha 常量/固定 tint 支）；本仓承载均为专用类不读本表 = 视觉零影响,
  //  纯台账真值。禁止把消费回填到 Arrow.draw 兜底（会被 (255−α)/255 折算出幽灵半显）
  //  18 阴影球(:1003=150;GetAlpha :81484 恒 (255,255,255,130);载体 PetFollower 光宠)
  //  50/53/515 荧光棒三型(:1335/:1363/:5860 唯一锚点=75;GetAlpha :80983 白 A=0;
  //   aiStyle14 的 alpha 写支仅 352/538/480 自有(:25149/:25428-25442/:25541);
  //   载体 GlowstickProj)
  //  396 史莱姆钩爪(:4781=100;AI_007_GrapplingHooks 全程无 alpha 写;钩面绘制
  //   GrappleProj spec.alphaFactor 已自钉 ×155/255=(255−100)/255)
  //  1103 史莱姆长枪(:10290=90,DefaultToSpear aiStyle19;AI_019_Spears 的 −40 渐显
  //   仅 877-879:P.cs:46717 (uint)(num2−877)<=2 门;载体 WeaponProj 矛族)
  //  ★F3 顺带排查（红队 A 点名 396/1103/174/176/302/635,2026-09-02 载体逐个复核）：
  //  六枚全为专用类载体（396→GrappleProj spec.alphaFactor :343 / 1103→WeaponProj
  //  矛族表 :1212 / 174/176/302→Dart DART_STYLE alpha0+fade :1866-1899 /
  //  635→LunarNebula 专用类）,均不经 Arrow.draw 的 (255−α)/255 兜底 → 新兜底
  //  不波及,dormant 备案语义维持（仅注释标注,零行为差）
  18: 150, 50: 75, 53: 75, 515: 75, 396: 100, 1103: 90,

  // ★2026-09-01 批五（AI_001 顶层 per-type fade 段收官批）——fade 支配套键，与
  //  AI001_FADE_RATE/AI001_FADE_SPEEDK/AI001_FADE_AGE2 三表成对（缺一即禁补：
  //  有键无 fade = 兜底活读 (255−255)/255 恒隐）。R6 判定全部亲核 1457 GetAlpha
  //  （Projectile.cs:80595-81521）：下列 id 均走缺省路径(:81507 num14=(255−α)/255)
  //  或读 α 的动态支，fade 有意义——
  //  323 :55101 α−50 / 468 :55351 α−40 / 408 :55962 α−40 / 937 :56057 α−50
  //  （GetAlpha :80657 A×0.75 后落缺省 → PROJ_ALPHA_MOD afade 档消费）/
  //  710 :56350 α−25（:80838 (255−α,255−α,255−α,255−α)）/ 671 :57324 α−20
  //  （:81034 White×Opacity）/ 675 :57448 α−20（:81099 (255,255,255,128)×(1−α/255)）/
  //  676 :57461 α−20（:81103 newColor×Opacity）/ 357 :57751 α−25 / 344 :58053 α−50
  //  （localAI[1]>5 门；:81181 num7=1−α/255）/ 275/276 :58182 α−30（速度链段内）/
  //  593 :56884 α−10 / 242/438/462/592 :56631 α−=(byte)(|v|×0.9)（积分式）/
  //  638 :56849 α−=(byte)(|v|×0.3) / 684 :55937 α−40（原 dragonAlpha 死镜像迁入）/
  //  711 :57591 α−25（ai[0]≥2 门；原共享 dragonFade −40 恒减率错，双修正）
  323: 255, 468: 255, 408: 255, 937: 255, 710: 255, 671: 255,
  675: 255, 676: 255, 357: 255, 344: 255, 275: 255, 276: 255,
  593: 255, 242: 255, 438: 255, 462: 255, 592: 255, 638: 255,
  684: 255, 711: 255,
  926: 255,                                           // :56057（605/920/926/937 共段 α−50 恒率;普查批 2026-09-16 补键——缺键=α≡0,α==0 门尘相位与本体渐显面双失真）
  //  440/449/606 :55741 α−25——GetAlpha :81087 r/g=b=255−α 三写为死存储（后落 :81507
  //  缺省路径被 num14 重算覆写）→ 有效读 α ✓。★R4(T3,2026-09-02)：有效面=纯缺省,
  //  专属 GA 档/drawXenoFilter 白剪影/XENO_GLOW 叠画已摘（原版无滤镜无 glow）,
  //  fade 期 (255−α)/255 由 :2337-2341 通用兜底消费（数值同旧档）
  440: 255, 449: 255, 606: 255,
  // [专用类承载 dormant 备案键（规则③只补键不接 fade——载体不读本表，Arrow 路径
  //  现无出生面；若未来接 Arrow 出生须连 AI001_FADE_* 配对，否则兜底恒隐）]
  //  174/176（Dart DART_STYLE alpha0:255 fade:50，:56007/:56085）/
  //  302（Dart fade:'speed'=|v|×0.9，:56626 同式，EU=7）/
  //  635（NebulaBlazeBolt alphaI −40/子步 :55518；GetAlpha :81030 White×Opacity 读 α）/
  //  686（DD2BetsyFireball 专用类自绘,无 alpha 面）——★F6 勘误：旧注"联机傀儡重建
  //   Arrow 档由 AI001_FADE_AGE2 接"已被证伪（Game.ts netMakeProj case1 实为
  //   new Boomerang,傀儡弹重建走 Boomerang 载体）,686 的 AI001_FADE_AGE2 死键已删;
  //   本键维持纯台账 dormant 备案
  174: 255, 176: 255, 302: 255, 635: 255, 686: 255,

  // ★2026-09-02 观感面缺口批（AI_001 出膛/尾迹 FX 清偿,subStepAI 逐型块配套）——
  //  265 剧毒法杖弹/:3505-3516 α=255、355 毒液法杖弹/:4453-4464 α=255——AI_001
  //   per-type 段 :57690-57724 每子步 −50（AI001_FADE_RATE 键成对）；GetAlpha
  //   :81286-81293 α>0→Transparent / α==0→(255,255,255,0) 满强加算白（★遗留批
  //   2026-09-02 已接线:PROJ_ALPHA_MOD[265/355] alpha0additive 档 + ADDITIVE_GLOW
  //   'lighter',本键只供 AI fade 门控起点）
  //  1097 火绒狐火球【无键=维持】：SetDefaults :10234-10242 无 alpha 行 → α≡0,
  //   AI 减段恒空转不入 AI001_FADE_AGE2（该表头注已钉）;tileCollide 动态翻转
  //   (:58255-58269)与 alpha 面无关,1097 GetAlpha :81099 (255,255,255,128)×(1−α/255)
  //   已由 PROJ_ALPHA_MOD[1097] fixedfade 档承载——无补键需求
  //  660 天界碎裂/:7098-7109 α=255、712 书杖弹/:7551-7562 α=255——AI_001 :56638/
  //   :56662 首拍白闪门 `if (alpha > 0)` 恒真一次 → 当拍 α=0（无持续 fade 段）
  //  376 随从鬼火/:4602-4614 α=255——AI_001 :56524-56551 全程无 α 减段（α 恒 255）,
  //   GetAlpha 缺省路径 :81507 读 α → 弹体原版即全隐,可见面全在 d6 尘羽
  //   （本仓此前 α≡0 = 弹体贴图恒满显,违原版）
  //  496 暗影炎箭/:5695 α=255（AI_091 全程无 α 写支,GetAlpha 无 496 专属支 → 缺省
  //   路径 :81507 读 α）→ 弹体贴图【恒隐】（同 376 案;此前 α≡0 = 精灵恒满显,违原版
  //   ——可见面只有 AI 影焰尘 27 拖尾,496 AI 支已接）。usesLocalNPCImmunity/
  //   localNPCHitCooldown=-1 数据面 = vanillaProjectiles.ts DATA_PATCH（登记项①）
  265: 255, 355: 255, 376: 255, 660: 255, 712: 255, 496: 255,
  // ★BJ431（2026-10-01,用户实报「火花魔棒弹幕不对」）：火花族 504/954/979（SetDefaults
  //  :5759-5769/:9004-9014/:9227-9237 alpha=255 + noEnchantmentVisuals=true；AI :23766
  //  每子步钉 255——GetAlpha 缺省路径 :81507 num14=(255−α)/255=0 → 弹体贴图【恒隐】,
  //  同 376 案）。可见面=AI 尘尾迹（504/954 尘 6 火、979 尘 135 霜;:23785-23796 掷率梯
  //  10%→100%→衰减,noGravity/scale×1.6/vel×2+弹速）。原版 Projectile_954.png 本体=
  //  魔杖形占位图,原版从未出画（★Z4/D6 像素对拍勘误 2026-10-02:旧注「与 Item_3069
  //  同图,md5 6ec57d61 双库核等」不实——954 = 40×40 md5 6ec57d61;Item_3069 =
  //  28×28 md5 33e14b58,尺寸/md5 互异,仅题材同族【木杖+绿焰头】;6ec57d61 的「双库核等」仅指
  //  terraria-assets 与 public 拷贝互等）。承重结论不变:「从未出画」锚在 α 恒隐链
  //  （SetDefaults α=255+AI 钉 255+GetAlpha (255−α)/255=0）,与贴图内容无涉;本仓
  //  此前 α≡0=40×40 魔杖贴图满显飞行=实报主病灶。GA case 共组 return 0 配对
  //  （dust-visual 族同 294-296/376 式）
  504: 255, 954: 255, 979: 255,
};

/** AI_001 顶层 per-type fade 恒率表（★2026-09-01 批五收官批；表驱动单支替代按率
 *  分档 Set——率值本身即分档信息，Record 一张 + 键注释即可表达，实现最小）。
 *  语义 = 每 AI 子步 `alpha = max(0, alpha − rate)`（vanilla AI_001 per update 一减；
 *  EU 型由子步循环自然 ×(EU+1)，与原版 numUpdates 循环同拍）。vanilla 各块写法
 *  （无条件减 / `if (alpha > 0)` 门）在钳 0 语义下等价，统一收口。键 = 减量，值出处：
 *  323:50(:55101) 468:40(:55351) 684:40(:55937) 408:40(:55962) 937:50(:56057)
 *  710:25(:56350) 671:20(:57324) 675:20(:57448) 676:20(:57461) 357:25(:57751)
 *  275/276:30(:58182) 593:10(:56884)——★163 族 AI_001 段(:56562 −25)对其为死代码
 *  （SetDefaults aiStyle=33 → 实走 AI_033 −50，本仓 flare 支已接），不入表防双减。 */
const AI001_FADE_RATE: Record<number, number> = {
  323: 50, 468: 40, 684: 40, 408: 40, 937: 50,
  926: 50,                                            // :56057 同支（605/920/926/937 共段 α−50;926 补键配套 α==0 门尘,普查批 2026-09-16）
  710: 25, 671: 20, 675: 20, 676: 20, 357: 25,
  275: 30, 276: 30, 593: 10,
  440: 25, 449: 25, 606: 25,                          // :55741（Xenopopper 弹,EU=2/1/2；白剪影档已摘=T3）
  // ★2026-09-02 观感面缺口批：265/355 毒系法杖弹（:57690-57706/:57708-57724）
  //  `if (alpha > 0) alpha -= 50` 钳 0——同块 α==0 门接 d163/d205 毒尘（subStepAI
  //  fade 支内配套,见该支注释）;EU=0 → 每 tick 一减,255 起步 6 子步归零
  265: 50, 355: 50,
};

/** AI_001 fade 带龄门档：[每子步减量, 门=localAI/ai 计数 > 门值]。344 :58053
 *  `localAI[1]++ > 5` 门（localAI[1] 每 update 自增 = 子步计数 ≡ this.age，1 基）。 */
const AI001_FADE_DELAYED: Record<number, readonly [number, number]> = {
  344: [50, 5],
};

/** AI_001 速度积分式 fade 系数表：`alpha −= (byte)(|velocity| × k)`（:56631 242 族
 *  ×0.9 / :56849 638 ×0.3）——(byte) 截断 → Math.trunc 直译；|v|×k>255 的环绕分支
 *  在原版速度域（≤~70）不可达，不建模。302 不入（Dart 载体 fade:'speed' 已承载）。 */
const AI001_FADE_SPEEDK: Record<number, number> = {
  242: 0.9, 438: 0.9, 462: 0.9, 592: 0.9, 638: 0.3,
};

/** AI_001 fade 的 ai[0]≥2 延迟门族（686 :57489 / 711 :57589 / 1097 :57533 同门）——
 *  686/711/1097 不在 AI_001 flag3 排除表（:56929-:57012）→ 通用 ai[0]++（:57020）
 *  每子步 +1 ≡ this.age（1 基，subStepAI 头自增）。1097 SetDefaults 无 alpha 行
 *  （:10234，α≡0）→ 减段恒空转不入。★F6（红队 A 仲裁定罪,2026-09-02）：686 死键
 *  已删——MP kind1 傀儡弹重建实为 new Boomerang（Game.ts netMakeProj case1 :2735,
 *  非 Arrow 载体），686 真身=DD2BetsyFireball 专用类自绘（无 alpha 面）；
 *  711 为本表唯一活键。 */
const AI001_FADE_AGE2: Record<number, number> = {
  711: 25,
};

/** AI_036 追踪内核逐型参数表（[speed, acc]，终零波单核收编导出面；tests/finalzero-game-domain
 *  金标直测）。全家族 {181 蜜蜂 / 189 巨蜜蜂 / 307 小吞噬者(friendly) / 316 蝙蝠杖 /
 *  566 巨蜂} 共用同一条索敌+逐轴步进管线（fixedUpdate 内唯一分支——三处生产端：
 *  蜂蜜斗篷受击反击 Game.ts、蜂箭 469 Kill 放蜂 spawnBeeSwarm、beenadeBurst 大爆
 *  弹幕拨发全部落表）。真值推导 Projectile.cs AI() 派发 case36 段：speed=各弹
 *  `num`（181:6.0/:27700 区、189:9.0、307:13.0、566:6.8），acc=num×0.025 族系数
 *  （181:0.1→×?/189:0.2/307:0.35）——以既有对账值为准；316 双档（锁定 [13,0.325]/
 *  无目标 [10,0.25]）在消费位按 bee36AimLocked 动态并表。 */
export const AI_STYLE36_TRACK_PARAMS: Readonly<Record<number, readonly [number, number]>> = {
  181: [6, 0.1], 189: [9, 0.2], 307: [13, 0.35], 566: [6.8, 0.14],
};

/** MathHelper.WrapAngle(XNA)：IEEE remainder 2π 后钳回 (−π,π]。AngleLerp 消费 */
function wrapAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  let a = angle - twoPi * Math.round(angle / twoPi);   // IEEEERemainder(fmod 取最近整周)
  if (a <= -Math.PI) a += twoPi;
  else if (a > Math.PI) a -= twoPi;
  return a;
}

/** Utils.AngleLerp(cur,target,amount)（Utils.cs 两版本同段 :2154-2172）——最短弧
 *  插值：目标差 <π 走直插、>π 经 ±2π 绕行；结果 WrapAngle。467 保速转向消费 */
function angleLerp(cur: number, target: number, amount: number): number {
  let angle: number;
  const lerp = (a: number, b: number): number => a + (b - a) * amount;
  if (target < cur) {
    const num = target + Math.PI * 2;
    angle = (num - cur > cur - target) ? lerp(cur, target) : lerp(cur, num);
  } else if (!(target > cur)) {
    return cur;
  } else {
    const num = target - Math.PI * 2;
    angle = (target - cur > cur - num) ? lerp(cur, target) : lerp(cur, num);
  }
  return wrapAngle(angle);
}

/** usesIDStaticNPCImmunity 共享免疫表（全场同型一张表,非每弹一张）：
 *  376 小鬼火球 cooldown 6t（SetDefaults :4612-4615）/ 604 孢子云 cooldown 10t
 *  （:6081-6082）——蓝队 R7-24：376 曾走逐弹 hitSet（N 只同拍对同敌 N 连击）。
 *  ★BJ704-G10（G1 债②清偿,2026-10-21）：墙钟 Date.now 版（暂停期墙钟照走=已
 *  登记近似）统一到 MinionProj.IdStaticBucket 同款 GTW tick 钟——gameTickCount()
 *  （core/GameTime,Main.GameUpdateCount 等价,BJ330）绝对到期：写 count+cd /
 *  门 ≤count（原版 perIDStaticNPCImmunity :14035-14037/:606-608 逐位同式）,
 *  零驱动惰性过期;cd 单位=tick（376=6/余=10,原 100/167ms 换算基数退役）;
 *  >512 项惰性清扫（先例沿用）。 */
const ID_STATIC_TABLES = new Map<number, Map<number, number>>();   // projType → (enemyId → 到期 tick)
/** ★BJ704-G14（件2①导出）：281 全场共享桶消费面扩到 TrapShot（Dart.ts 直接命中
 *  环 + blastKill）——与 Arrow 281 爆弹（:5493 aoeCd281）共用同一张表 = 原版
 *  perIDStaticNPCImmunity[281] 单表跨载体同相。
 *  ★BJ704-G21 R8-F5（S2 拆相纪律补齐,proj1457.HitCdImpl R1-C 同构）：原版两相
 *  =外环 flag2 表读 :12596（IsNPCIndexImmuneToProjectileType,无副作用）+ 受里面
 *  写梯 :14031-14037——aoeCd281 duck 桥旧 peek=idStaticCheck 融合形（读时写）会让
 *  充能水母（外环 zap 豁免过、内层 :12687 return 前的拒收拍）白写 10t 窗。拆出
 *  纯读 idStaticReady / 写位 idStaticWrite;idStaticCheck 保持融合形（直击环/
 *  blastDamage 消费面过门即结算,写前置≡写后置,零变化）。 */
export function idStaticReady(projId: number, enemyId: number): boolean {
  const m = ID_STATIC_TABLES.get(projId);
  if (!m) return true;
  return (m.get(enemyId) ?? 0) <= gameTickCount();
}

/** 写梯（:14031-14037 usesIDStatic 支——命中受理尾,拒收路径零落账;>512 惰性清扫同守） */
export function idStaticWrite(projId: number, enemyId: number, cooldownTicks: number): void {
  let m = ID_STATIC_TABLES.get(projId);
  if (!m) { m = new Map(); ID_STATIC_TABLES.set(projId, m); }
  const now = gameTickCount();
  m.set(enemyId, now + cooldownTicks);
  if (m.size > 512) {
    for (const [k, v] of m) if (v <= now) m.delete(k);
  }
}

export function idStaticCheck(projId: number, enemyId: number, cooldownTicks: number): boolean {
  if (!idStaticReady(projId, enemyId)) return false;
  idStaticWrite(projId, enemyId, cooldownTicks);
  return true;
}

/** ★BJ704-G14（件3 [g11-family-body-stealth-dim]）：八型族本体绘色减光共享求值器
 *  （Main.cs:32623-32640——439/460/600/615/630/633/705/714 八型族 DrawProj 专属块）。
 *  门 = 拥有者套装（shroomiteStealth=ArmorSetBonuses.cs:374 置位/equipStats.shroomiteSet
 *  ∥ setVortex/equipStats.vortexSet）∧ 手持 item.ranged（draw 期活查）。两支（非互斥,
 *  原文顺序串联）：
 *   · shroomite :32625-32630 → projectileColor *= num282（max(stealth,0.03) 全通道乘）
 *   · vortex    :32631-32640 → MultiplyRGBA(Lerp(One,(0,0.12,0.16,0),1−num283))
 *  返回 { rgb: RGB 乘子(0..1), ga: A 乘子 }——α=255 起经 ×n / MultiplyRGBA(A=n) →
 *  A=255n,默认 GetAlpha（A=newColor.A−α,α=0 族）保 A 乘子=n（G11 件5a overlay 同源
 *  判例:Color×float 双因子）。null=门关（无套装/手持非远程）恒等不画。
 *  逐员定谳（亲读族表）:439/460（2795/2882 magic 武器,手持 ranged 恒假）/600（3384
 *  PortalGun 无 ranged 旗 + 仓内无 600 载体）/633（Last Prism magic + GetAlpha :80834
 *  常量白整弃 projectileColor RGB）四员门死=销案;615/630/705/714 四员 ranged 可达=
 *  消费本求值器（Celeb2Muzzle/Arrow 630/PhoenixBowProj）。 */
export interface FamilyStealthDim { rgb: [number, number, number]; ga: number }
export function familyBodyStealthDim(
  p: unknown,
): FamilyStealthDim | null {
  if (!p) return null;
  const pp = p as {
    stealth?: number;
    equipStats?: { shroomiteSet?: boolean; vortexSet?: boolean };
    inv?: { heldItem?: () => { id?: number } | null };
  };
  const shroom = pp.equipStats?.shroomiteSet === true;
  const vortex = pp.equipStats?.vortexSet === true;
  if (!shroom && !vortex) return null;
  // 手持远程活查（player.inventory[selectedItem].ranged :32624/:32631）
  const held = pp.inv?.heldItem?.();
  const heldDef = held != null && (held.id ?? -1) >= 0 ? ITEM_DEFS[held.id!] : undefined;
  const vid = heldDef ? (heldDef.vid ?? -1) : -1;
  if (vid < 0 || itemCombat(vid)?.ranged !== true) return null;
  let rgb: [number, number, number] = [1, 1, 1];
  let ga = 1;
  if (shroom) {                                    // :32625-32630（×=num282）
    const num282 = Math.max(0.03, pp.stealth ?? 1);
    rgb = [num282, num282, num282];
    ga = num282;
  }
  if (vortex) {                                    // :32631-32640（MultiplyRGBA lerp 色调）
    const num283 = Math.max(0.03, pp.stealth ?? 1);
    const t = 1 - num283;                          // Lerp(One, target, 1−n) 逐通道
    rgb = [rgb[0] * (1 + (0 - 1) * t), rgb[1] * (1 + (0.12 - 1) * t), rgb[2] * (1 + (0.16 - 1) * t)];
    ga = num283;
  }
  // 恒等变换（stealth=1 满档——原版乘 no-op）折 null：消费侧零烘焙零 globalAlpha 写
  if (rgb[0] >= 1 && rgb[1] >= 1 && rgb[2] >= 1 && ga >= 1) return null;
  return { rgb, ga };
}

/** 直立族：521 水晶脉冲/79 彩虹光弹。★R27 勘误：宝石法杖弹 121-126/597 曾被误入本表——
 *  原注释引"aiStyle 29 全链零 rotation 赋值"与源码不符，AI_029_GemStaffs_ActuallyGemStaffs
 *  尾部显式 **rotation = velocity.ToRotation()**（1457:38644 / 1458:38691）——宝石珠顺
 *  速度向摆放，已移出（红队 R27 §1 P1）。521 同为 aiStyle 29 也应旋转（同函数尾行），
 *  但其贴图/消费面未在本批核对面，暂留原状登记；79 由 MissileProj 独立绘制不经本表 */
const PROJ_NO_ROT = new Set([521, 79]);
export { PROJ_NO_ROT };
export { PROJ_ROT_RIGHT };

/** 速度向直置族（R27）：宝石法珠弹 121-126/597——AI_029 尾 rotation =
 *  velocity.ToRotation()（1457:38644/1458:38691）且无 spriteDirection 翻转
 *  （DrawProj :33667-33678 只消费 num341=rotation + dir 缺省）→ 绘制角 = 速度角本身,
 *  无 ±π/2 偏移、无水平镜像 */
const PROJ_ROT_ASIS = new Set([121, 122, 123, 124, 125, 126, 597, 732]);   // 732 风暴气旋 rotation=velocity.ToRotation()（AI_044 :28317）
export { PROJ_ROT_ASIS };

/** 宝石法珠弹 AddLight 配色（2026-08-26 用户实报批）：AI_029_GemStaffs_ActuallyGemStaffs
 *  尾段 Lighting.AddLight(center, R,G,B)（1458 Projectile.cs:38645-38692）——
 *  num25 = type−120 切换乘区：121(0.9,0,0.9)紫晶 /122(0.9,0.9,0)黄玉 /123(0,0.1,1.3)
 *  蓝晶 /124(0,1,0.1)翡翠 /125(1,0.1,0.1)红晶 /126(1.3,1.3,1.3)钻石;597 default+262
 *  支(0.9,0.6,0.2)琥珀；1120 num=170 落 default 全白。SetDefaults 无 projectile.light
 *  （子代理 A 复核）→ 动态点光是唯一光面 */
const GEM_BOLT_LIGHT: Readonly<Record<number, [number, number, number]>> = {
  121: [0.9, 0, 0.9],
  122: [0.9, 0.9, 0],
  123: [0, 0.1, 1.3],
  124: [0, 1, 0.1],
  125: [1, 0.1, 0.1],
  126: [1.3, 1.3, 1.3],
  597: [0.9, 0.6, 0.2],
  1120: [1, 1, 1],
};

/** 宝石法珠弹 GemStaffShotDrawer 三色表（Main.cs:28623-28663——121/124/597/125/126
 *  用 Violet/Purple、LimeGreen/Green、OrangeRed/DarkOrange、Red/Red、Silver/Silver
 *  默认对;123 蓝晶专属色且三色 A/=2;1120 琥珀弹 Orange 双色;数组序=[c1,c2,c3]
 *  =[trailColor1, trailColor2, trailColor3]）。★BJ675（2026-10-14 用户实报「紫晶法杖
 *  弹幕效果不对」定谳）：旧表 121 c1=(0.58,0,0.83) 系误写——XNA Color.Violet=
 *  (238,130,238)，紫晶弹主色被压成深紫红观感;且旧实现三色消费序/包络反（见
 *  gemTrailPts 注）。 */
export const GEM_TRAIL_COLORS: Readonly<Record<number, readonly (readonly number[])[]>> = {
  121: [[238 / 255, 130 / 255, 238 / 255], [128 / 255, 0, 128 / 255], [1, 1, 1]],  // Violet/Purple/White
  122: [[1, 165 / 255, 0], [1, 165 / 255, 0], [1, 1, 1]],                          // Orange/Orange/White
  1120: [[1, 165 / 255, 0], [1, 165 / 255, 0], [1, 1, 1]],                         // 同 122（Main.cs:28632-28636）
  123: [[60 / 255, 90 / 255, 1], [60 / 255, 90 / 255, 1], [60 / 255, 90 / 255, 1]], // 蓝晶三色同源（A 减半在 gemTrailPts 内乘）
  124: [[50 / 255, 205 / 255, 50 / 255], [0, 128 / 255, 0], [1, 1, 1]],            // LimeGreen/Green/White
  597: [[1, 69 / 255, 0], [1, 140 / 255, 0], [1, 1, 1]],                           // OrangeRed/DarkOrange/White
  125: [[1, 0, 0], [1, 0, 0], [1, 1, 1]],                                          // Red/Red/White
  126: [[192 / 255, 192 / 255, 192 / 255], [192 / 255, 192 / 255, 192 / 255], [1, 1, 1]], // Silver/Silver/White
};

/** 宝石法珠弹拖尾顶点色/带宽 1:1（★BJ675）：GemStaffShotDrawer.cs:16-39 ——
 *  StripColors(progress)：value=Lerp(c1,c2,p) → Lerp(c3,value,GetLerpValue(-0.2,0.5,p))
 *  后整体 ×(1−GetLerpValue(0,0.98,p))（XNA Color*float 四通道全乘→rgb 同乘淡出）;
 *  StripWidth 恒 16。progress=0=oldPos[0]=弹头（TrailingMode 2 每压栈 1 位）,1=尾。
 *  旧实现的观感病根（本仓 2026-08 批近似）:①色序 Lerp(c2,c0)反（尾=亮紫 Violet,
 *  原版尾=深紫 Purple）②a=min(1,v*1.7) 包络反（弹头透明、尾端恒亮不熄;原版头
 *  满亮白心、尾线性熄灭）③hw 9 vs 原版 16。123 蓝晶 Main.cs:28637-28645 三色
 *  A/=2 → 顶点 alpha 整体 ×0.5。 */
export function gemTrailPts(raw: number[], projId: number): TrailPt[] {
  const cols = GEM_TRAIL_COLORS[projId] ?? GEM_TRAIL_COLORS[121];
  const [c1, c2, c3] = cols;
  const n2 = raw.length / 2;
  const out: TrailPt[] = [];
  const aMul = projId === 123 ? 127 / 255 : 1;   // Main.cs:28641-28643 三色 A/=2（byte 截断 255/2=127）
  for (let i = 0; i < n2; i++) {
    const v = n2 > 1 ? i / (n2 - 1) : 1;               // 0=头(新) 1=尾(旧)
    const val = [c1[0] + (c2[0] - c1[0]) * v, c1[1] + (c2[1] - c1[1]) * v, c1[2] + (c2[2] - c1[2]) * v];
    const gate = Math.max(0, Math.min(1, (v + 0.2) / 0.7));   // GetLerpValue(-0.2, 0.5, v)
    const fade = 1 - Math.max(0, Math.min(1, v / 0.98));      // 1-GetLerpValue(0, 0.98, v)
    out.push({
      x: raw[i * 2], y: raw[i * 2 + 1],
      hw: 16,                                          // StripWidth(GemStaffShotDrawer.cs:36-39)
      r: (c3[0] + (val[0] - c3[0]) * gate) * fade,
      g: (c3[1] + (val[1] - c3[1]) * gate) * fade,
      b: (c3[2] + (val[2] - c3[2]) * gate) * fade,
      a: fade * aMul,
    });
  }
  return out;
}

/** 子弹消亡火花音族（★R29：Projectile.Kill :77624-77625 列表直抄——Collision.HitTiles
 *  +SoundID.Item10；1458 列表含 389。消费面：Arrow 实心块路径 HitTiles 近似尘 +
 *  Game.onProjectileDeath Item_10 音）。放 Arrow.ts 供两侧共用（Game 反向 import） */
export const BULLET_KILL_SFX = new Set([14, 20, 88, 36, 83, 84, 389, 104, 279, 100, 110,
  180, 207, 357, 242, 302, 257, 259, 285, 287, 576, 577, 876, 968]);

/** Main.hslToRgb(h,1,0.5) 的本地副本（873 Kill 尘色 AI_171_GetColor :46398 消费；
 *  l=0.5/s=1 固定 → c=1、m=0,标准 HSL→RGB 解析式）。不引 AuroraSky/Appearance 的
 *  现成实现=避免 entities → render/player 反向依赖 */
export function empressHslRgb(hue: number): [number, number, number] {
  const h = ((hue % 1) + 1) % 1 * 6;
  const x = 1 - Math.abs((h % 2) - 1);
  const seg = Math.floor(h) % 6;
  const rgb: [number, number, number] = seg === 0 ? [1, x, 0]
    : seg === 1 ? [x, 1, 0]
      : seg === 2 ? [0, 1, x]
        : seg === 3 ? [0, x, 1]
          : seg === 4 ? [x, 0, 1] : [1, 0, x];
  return [Math.round(rgb[0] * 255), Math.round(rgb[1] * 255), Math.round(rgb[2] * 255)];
}

/** 荆棘链族（Vilethorn 7/8 + Nettle Burst 150/151/152 + 魔晶碎块 493/494，aiStyle 4，
 *  红队 R27 §10/§11；493/494 批=BJ353 2026-09-25）：
 *  UpdatePosition 对 aiStyle==4 整体早退（Projectile.cs:20552）= 链段【全程静止】；
 *  AI_004 :23943-24080 状态机：alpha −50(/−75 nettle/−100 493|494)/update 渐显期不动 →
 *  归零转 ai[0]=1 并链生子段（position+velocity+(w/2,h/2) 处、同速度、damage 同值、
 *  ai[1]+1；type7 在 ai[1]≥6 后升 type8 尾刺 / 150↔151 每节翻转、ai[1]≥10 且 type151 →
 *  152 尾端 / 494 链生 494、ai[1]≥7+rand(2) 升 493 头且伤/击退 ×1.25）；淡出期
 *  alpha += 5(nettle 3/493|494 4) 至 ≥255 Kill（493|494 淡出穿 170 时 8× d68-70 尘爆）。
 *  出生音 Item8 于 localAI[0]==0 门播一次（type494 → Item101 :23949-23951——BJ353 前
 *  "无武器可达不接"系台账陈旧：物品 3051 魔晶碎块 Item.cs:28200 shoot=494）。
 *  ctor 按 THORN_CHAIN_PROJS 自动置位（同 sandBall/flare 先例），thornChainAi1 注入段号 */
const THORN_CHAIN_PROJS = new Set([7, 8, 150, 151, 152, 493, 494]);

/** ★R29 幻象弓 630 载体控制面（Game 注入,同 PiranhaCtl 模式）：
 *  volley() = Game.phantasmPickAmmo 等价（每轮现解析弹药:弹型/伤/kb/速终值+耗弹掷;
 *  null = 无弹药 → 载体 Kill）;channel() = player.channel 电平近似（按住+未阻挡+
 *  仍持本武器）;aim() = Main.MouseWorld 等价（世界坐标瞄准点） */
export interface Phantasm630Ctl {
  channel(): boolean;
  aim(): { x: number; y: number };
  volley(): { pid: number; dmg: number; kb: number; speed: number } | null;
}

/** 雨滴溅花水档（Dust.dustWater :405 纯映射,1:1 复制自 render/WeatherRenderer.ts:92——
 *  ★2026-09-03 分层修复:entities 禁止 import render 层(该 import 曾闭合
 *  Entity→GorePiece 求值环 = "Class extends value undefined" 全链炸),
 *  FakeFish.ts:551 同款本地副本先例。源表变更时两处需同步。 */
function dustWaterFor(waterStyle: number): number {
  switch (waterStyle) {
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
export class Arrow extends Entity {
  w = 10; h = 10; // 原版 SetDefaults type 1：width/height = 10；构造器按弹型覆写
  vx: number;
  vy: number;
  damage: number;
  knockback: number;
  /** ★SW-FX34c 2026-09-18（用户实报"玩家能过单向墙、弹幕过不了"）：Collision.
   *  TileCollision 第 10 参 hoik——原版 Projectile.HandleMovement(:17578) 全路径
   *  为 true：高速子步进显式 bool hoik=true(:17822-23→:17852 传参),慢速干路
   *  (:17960)/湿路三支(:17726/:17740/:17754)/aiStyle10 四支(:17705-18)不传参吃
   *  缺省 true（Collision.cs:2299）。无 owner 豁免（friendly/hostile 同相）；
   *  1456/1457/1458 三树同相。消费面=:2412/:2432 身后格坡邻配对 + 跨格态无推离
   *  （:2437-2456）。本类单点中心碰撞模型的对应门=subStep 撞块杀链口（hoikAdmit
   *  包裹层）；moveAndCollide 域弹幕由 Body.hoik 承载（WeaponProj 等同类字段）。 */
  hoik = true;
  /** 原版投射物类型（1=木箭 2=燃烧箭，PickAmmo projToShoot = ammo.shoot） */
  projId: number;
  /** 绘制 scale（SetDefaults scale 字段；绘制尺寸 = 贴图原生 × scale，
   *  与判定盒 w/h 无关——子弹 14 是 2×20 曳光条 × 1.2，曾误画成 10×100） */
  drawScale = 1;
  /** 原版 Projectile.noDropItem（Projectile.cs:316；630 volley 逐矢 :68277 置位、
   *  705 凤凰弓 volley :68371 置位）：消亡不掉弹药。原版唯一消费位 = Projectile.Kill
   *  的 !noDropItem 放块族段（TileDrawing 系 985/965 砂球等,FallingBlock 链自承载）
   *  ——箭族 Kill 无回收,本旗随数据面保留（SW-FX9 摘除本仓自加 1/3 落地回收后
   *  暂无运行时消费,勿再接自创回收链） */
  noDropItem = false;
  manaStar: boolean;
  grav: number;
  life: number;
  pierce: number;
  /** 发射时 maxPenetrate（穿透判定用——剩 1 的穿透弹仍是穿透语义,Projectile.cs:11904） */
  pierceInit: number;
  /** 敌对弹（原版 Projectile.hostile）：命中玩家结算（Damage_EVP 语义） */
  hostile: boolean;
  /** 随从/哨兵射出的弹（ProjectileID.Sets.MinionShot/SentryShot 语义：吃鞭 tag） */
  whipTagShot = false;
  /** ★Z-F1（2026-08-31 蓝队三批）运行时类别旗覆写槽（原版 spawn 位
   *  `Main.projectile[i].melee = true` 显式赋值的仓内形态——蜂 181/566 家族：
   *  Player.cs:43977/:44479/:44873 + Projectile.cs:13759）。SetDefaults 数据面
   * （projClassOfProjId 查表）保持零旗真值不变；显式字段经 resolveProjClass()
   * 优先于数据面。null/缺省 = 无类弹。 */
  projClass?: import('./projTargets').ProjClass;
  /** 命中施加 OnFire 300t（1106 火舌 :11002-11004） */
  ignite = false;
  /** 命中施加地狱火 OnFire3(323) 300-600t（1097 生成侧 ai[1]>0 档 :11315-11318——
   *  1113 可靠的火绒狐射弹 ai[1]=3/1 全地狱火，与 1094 的 OnFire(24) 档区分） */
  igniteHellfire = false;
  /** 命中施加火系 buff 直译档（AddBuff(buff, minT+Next(max−min+1))，2026-09-02
   *  buff 表审计批）——1106 焰狐速度门(:11665-11668:vel>10→323 else 24,300t 定值)
   *  与 1097 火球(:11315-11319:ai[1]>0→323 else 24,Next(300,600))共用;设置时优先
   *  于 ignite/igniteHellfire 消费 */
  onFireHit?: { buff: 24 | 323; minT: number; maxT: number };
  /** 暴击加成（百分点，spawn 侧注入：player.critChance(kind)+item.crit；基 4% 另计。
   *  审计 §6：此前硬编码 4% 导致远程/魔法/投掷吃不到装备/套装/词缀/item.crit。
   *  ★BJ493②③（2026-10-04）：主环旧 `??` 兜底对本字段【零读者】（类缺省 0,?? 不认
   *  0 为未设——旧注「未设=按 critBonus+4%」自BJ489 路由化起即不可达形）——ranged
   *  族 spawn 位已改写 critChance=0.04 路由门+rollVanillaHitCrit 动态。
   *  ★BJ496①（2026-10-04）magic 域收编后：617/659 爆面亦迁移（旧 `||` 面退役）。
   *  ★BJ497①（2026-10-04）五遗留面全数收编（:1848 1023 barrel[休眠销案锚]/:5372 631/
   *  :7337+:9309 514 双面/:10424 190）→ 本字段读者=零（主环 `??` 兜底不可达形不变）。
   *  ★BJ498①（2026-10-04）传播链写位全摘销案：普查=13 位（BJ497 定谳 14 位含
   *  MagnetSphereProj bolt 位,该位 BJ497② 已摘）——各写位抄 this.critBonus=恒类缺省 0
   *  （spawn 写位 BJ493②③/BJ496①② 全退役）,唯一读面（主环 `??` 兜底）不可达
   *  ⇒ 链上零读者死值,摘除零漂移。字段保留=hellwing-cast 契约测试写位（存续读写面）。 */
  critBonus = 0;
  /** 暴击总概率阈值（0-1，spawn 侧一次性算好;★BJ493 起 0.04=通用环动态掷路由门
   *  （非掷率）,≤0=关断钉（零 RNG）;旧「未设=按 critBonus+4%」兜底仅对 undefined
   *  可达=实际不可达形,见 critBonus 注） */
  critChance = 0;
  /** 护甲穿透（玩家侧：spawn 注入 equipStats.armorPen+词缀 arpen，=原版
   *  GetArmorPenetration(melee)（Player.cs:4170-4177）；弹幕自带份见 settlePen） */
  armorPen = 0;
  /** 结算穿甲 = 玩家侧 armorPen + 本型号 armorPenetration（Projectile.cs SetDefaults
   *  逐型直写,25 款非 0——StrikeNPC :12068 num3 两源相加后再入
   *  NPC.checkArmorPenetration :81913 单池；独立字段,不与 Ichor 混算） */
  private get settlePen(): number {
    return this.armorPen + (projectileData(this.projId)?.armorPenetration ?? 0);
  }
  /** aiStyle 14 弹跳：撞块反弹不消亡 */
  bounce: boolean;
  /** 冰霜盔甲引擎资格（ranged 弹 true;魔法/召唤弹 false——原版 melee||ranged 门） */
  frostEligible = false;
  /** aiStyle 14 荆棘球档（277）：撞块按 Projectile.cs:18306-18314 反弹 */
  thornBounce: boolean;
  skullBoneT = 0;   // ai[1] 计数（270 转向窗口）
  /** 873 光鞭 Kill 尘色相位（发射点注入,见 opts 注） */
  empressHue = 0;
  /** 延迟重力（AI_001 链）：age（update 计）超过此值才施加 grav；-1=不延迟 */
  gravDelay: number;
  /** 二段重力（686/711）：age 超过 grav2At 再加 grav2；0=无 */
  grav2: number;
  grav2At: number;
  /** 恒定 vx 衰减/update（0=无；686/711 0.99——不挂重力门） */
  dragAlways: number;
  /** 410 泡体 scale（ai[1]=rand(60,121)/100,首拍掷定——AI_072 :30954 盒 14×14×scale） */
  bubbleScale = 0;
  /** 167-170 烟花 ai[1]=1=发射器档（AI_034 :30xxx 出膛尘花+尾迹;0=无） */
  launcherFirework = 0;
  /** 发射者玩家引用（5451/5738 机件单实例替换圈定用;一般弹不设） */
  ownerPlayer?: object;
  /** 5461 杀意牌 ai[2]=±0.4 自旋档（:49716 NewProjectile 尾参,draw 侧累积） */
  cardSpin = 0;
  /** 5461 杀意牌 ai[0]==2 定身标记（:49752-49754 phase3 全场 v=0） */
  cardFreeze = 0;
  /** 烟花 ai[0]（AI_034 发射器档计数） */
  private fwAi0 = 0;
  /** 专家追踪参数（null=无） */
  homing: { speed: number; weight: number; floor?: number; cap?: number; axis?: 'x' | 'y' } | null;
  /** 电圈导弹 442 锁定格（ai[0]/[1]，tile 坐标；null=非锁定弹）——subStepAI 442 段消费 */
  aimPt: { tx: number; ty: number } | null = null;
  /** localAI[0]（:55691-55703 渐显计数 + alpha==0 后 :55716 尘环节拍复用同槽） */
  private aimCnt = 0;
  /** localAI[1]（:55708-55712 alpha==0 后 120t 超时计数） */
  private aimLife = 0;
  /** 原版 Projectile.extraUpdates：每帧额外子步数（0=普通 1 步） */
  extraUpdates: number;
  /** 敌方生成侧 ai[0]（ArrowOpts.ai0 承接）。现消费面=88 支 AI 支头
   *  extraUpdates=(int)ai[0]（P.cs:54979-54982,F7 接装）——本仓现无敌侧 88 出生面
   *  恒 0 空转（备案）,未来生成端经 opts.ai0 注入即自动对齐 */
  hostileAi0 = 0;
  /** X 轴空气阻力/tick（1=无；投掷族 0.97） */
  drag: number;
  /** 终端下落速度（缺省 16） */
  maxFall: number;
  /** 翻滚旋转（aiStyle 2 刀族重力期） */
  tumble: boolean;
  /** 平飞期姿态锁定（48/54/93/520/599 前 20t atan2 姿态，Projectile.cs:21971-21972） */
  tumblePoseLock: boolean;
  /** 翻滚累积角（tumble 专用，勿与 Enemy.spin 混） */
  tumbleRot = 0;
  /** 恒旋累积角（PROJ_SPIN 族：312 南瓜灯/772 晶洞，AI_001 :54741/:54824） */
  spinRot = 0;
  /** 已存活 tick（延迟重力/追踪门用） */
  age = 0;
  /** 原版 Projectile.alpha（SetDefaults 逐型初值 PROJ_ALPHA0；AI 侧逐型衰减、
   *  draw 侧 GetAlpha 近似消费——修复4 alpha 通道） */
  alpha = 0;
  /** aiStyle 专属计数（94 水晶风暴 ai[1] 缩径倒计时 / 95 诅咒之焰 ai[1] 重力门 /
   *  280 黄金雨 ai[0] 重力门——每弹仅一个 aiStyle，恒不复用） */
  private aiCnt = 0;
  // ---- 22 水花权杖（aiStyle 12 type 22 支，Projectile.cs:24835-24926）专属态 ----
  /** 22 熔岩反弹 LCG32 种子 = 原版 ai[2]：出手位 `Main.rand.Next(0, 20000)`
   *  （Player.cs:49929-49931 ItemCheck_Shoot 通用尾支 projToShoot==22 专行）；
   *  每次熔岩反弹 `new LCG32Random((uint)ai[2])`（Projectile.cs:24851）从同一种子
   *  重放两掷 → 反弹向量对【单弹】恒定、跨弹随出手掷变化。发射点未注入 ai →
   *  ctor 同分布自掷（424 流星弹/485 狱翼箭先例）。 */
  waterStreamSeed = 0;
  /** 22 ai[1]：0=水支（默认） / 1=熔岩反弹支（进档后恒驻——:24842/:24855）。
   *  与水支互斥：反弹受理门要求 `velocity.Y > 0 && ai[1] == 0`（:24841）。 */
  private waterLavaMode = 0;
  /** 22 进档后 extraUpdates=0（:24846）的挂起旗——本仓子步循环逐迭代读
   *  extraUpdates（原版 numUpdates 在 Update 头一次取定,当拍子步数不变）⇒
   *  写入挂起到下一 tick 头生效（bee36EU0 同款,:27693-27695 先例）。 */
  private waterEU0 = false;
  // ---- 大地法杖巨石 261（AI_014 type 段 :18235/:12745）专属态 ----
  /** 慢速死亡门：|v|<1.5 消亡 */
  boulder = false;
  // ---- 飞龙剑气 684（AI_001 type 段 :55935-55960）专属态 ----
  /** SetDefaults alpha=255（:7303）→ AI 每子步 −40 渐显（AI001_FADE_RATE[684] 承载;
   *  本字段=旧实现的死镜像（draw 从不消费），仅 ctor 台账值 + ranged-catalog 断言面） */
  dragonFade = false;
  dragonAlpha = 255;
  /** 711 双足翼龙弹：命中 Betsy's Curse(203) 600t（:10719-10721） */
  betsyCurse = false;
  // ---- 冰霜月寒潮波 348 / 万圣夜魔魂 349 双向脉冲对（AI_001 :57226/:57201）----
  /** 相位槽：0/2=显相（scale+0.01 & α−50 至 0）/ 1=隐相（scale−0.01 & α+50 至 255）。
   *  348 槽=ai[0]、349 槽=localAI[0]（348/349 均在 AI_001 flag3 排除表 :56929-57012，
   *  ai[0] 无通用自增，专属使用无竞争）。SetDefaults 无 alpha 行（:4380/:4392）→
   *  α≡0 起步：首子步显相即翻相 = 原版「从全隐开始一次隐相脉冲」同相。 */
  private f348Phase = 0;
  private f349Phase = 0;
  // ---- 泰拉刃光束 985（aiStyle 191）专属态 ----
  terra = false;
  // ---- 星怒剑 503 / 斗篷星 723-726/1133 共享态（starY 目标线通道）----
  /** 目标线 Y（null=非星弹）；cy>targetY 后 tileCollide 生效（:24105-24108 503/723 族同支） */
  starY: number | null = null;
  /** alpha（503:255 起 −15/t,线上钳 150/线下钳 0——:24149-24158 num43。斗篷星
   *  723-726/1133:SetDefaults 50 起（:7655）−15/t,线上钳 100/越线钳 0——:24165-24176
   *  num44,起步差由构造器按 PROJ_ALPHA0 注入。★两门口径不同:tileCollide=严格 >
   *  （:24106）,α 下限=>=（:24152/:24169）——边界格上 α 已开钳而碰块未开,按原文保留 */
  starAlpha = 255;
  /** 周期音（Item9 :22177-22180，20-60t 掷一次） */
  private starSndT = 20;
  /** tileCollide 已生效（越目标线后） */
  private starCollide = false;
  /** localAI[0] 计时 */
  terraT = 0;
  /** ai[0] 朝向（±1）/ ai[1] 生命基准 18 / ai[2] 物品 scale（出生注入） */
  terraAi0 = 1;
  terraAi1 = 18;
  terraAi2 = 1;
  /** 尾段清伤（t ≥ Lerp(ai1, ai1+25, 0.65) → damage=0，:39337-39340） */
  terraNoHit = false;
  /** localAI[1] 近墙减速标记 */
  terraWall = false;
  /** 已反射（原版 Projectile.reflected：反射源命中后置位，防重复反射；
   *  反射后弹体转 hostile——不再入下方敌怪判定，改走 hitPlayer 伤玩家） */
  reflected = false;
  /** 穿透投射物的同敌免疫表（敌人 id 集合） */
  private hitSet = new Set<number>();
  /** ★BJ157-②③：PVE 受理命中计数（vanilla Projectile.numHits 1:1——每次受理命中尾
   *  numHits++（Damage_PVE_Inner :14263,在吸血链/ghostHurt proc 块 :13877-83 之后）；
   *  ghostHeal 率 = 0.2−numHits×0.05（:12080）读的是自增前值 ⇒ 首跳 0 档率 0.20。
   *  与 hitSet（同敌永久免支,仅有限穿透入表）解耦：无限穿透弹每跳都计数（修复③：
   *  hitSet 恒空曾致治疗率恒 0.20 不衰减）;502/idStatic 同敌冷却再命中亦每跳计入
   *  （原版 numHits 同相）。PVP 面 netPvpProjFeedback 经 SpectreSoulProj.projPveNumHits 读 */
  pveNumHits = 0;
  /** 1457 宝石法珠特性（null = 非宝石弹/未启用） */
  gem: GemStaffFlags | null = null;
  /** SwirlTwins 正弦摆相位计数（localAI[0]，:38615 每步 +1） */
  private gemSwirlT = 0;
  /** SwirlTwins 反相相位(1457 ai[1]:0=首弹,1=孪生弹,:49924-49926) */
  gemPhase = 0;
  /** 114 邪恶三叉戟减速计时（ai[0]，:26781 每步 +1） */
  private gem114T = 0;
  /** 114/剑气族 116/132/156/157/173 localAI[1] 出生渐显梯（aiStyle27 族级
   *  :26840-26844 每 AI 步 ++ 钳 15）——GetAlpha :81445-81458/:81373-81385 梯门消费
   *  （<5 Transparent / 5..15 灰梯 / ≥15 全亮）。★BJ236 起族级复用（同梯同配方） */
  private gem114Ramp = 0;
  /** 剑气族 116/132/156/157/173 脉动方向闩（原版 localAI[0]，:26846-26858——
   *  0=升臂 α+=30 钳 255 翻 1 / 1=降臂 α−=30 钳 0 翻 0；114 的 localAI[0] 是初速
   *  快照语义不同,分字段承载）。伴随 scale ±0.02/步呼吸（drawScale 消费） */
  private beam27PulseDir = 0;
  // ---- 特殊箭特效批（2026-08-22，weapon-audit-2026-08-22 类别六）----
  /** 225 叶绿箭撞块弹反计数（ai[1]，:17130：首跳伤 ×0.66 / 第 4 撞 Kill） */
  private arrow225Ai1 = 0;
  /** 285 纳米弹撞块弹反计数（ai[1]，:18677：首跳伤 ×0.66 / 第 2 撞 Kill） */
  private proj285Ai1 = 0;
  /** 710 空中祸害裂片标（原版出生参 ai[1]=-1——裂片命中不再撒裂片，BetsySharpnel
   *  :51077 `ai[1] != -1f` 门） */
  abShard = false;
  /** 485 狱翼箭 ai[0]/ai[1] 游移向量（ctor 掷定，Pl.cs:46934-46943） */
  private hwAiX = 0;
  private hwAiY = 0;
  /** 496 暗影炎箭摆动 ai[0]/ai[1]（aiStyle 91 每子步 v+=ai×1.5、ai×1.05/子步——
   *  ctor 挂账自 opts.ai0/ai1,Game 3053 施法支掷序注入;subStepAI 496 支消费） */
  private sf496Ai0 = 0;
  private sf496Ai1 = 0;
  /** 496 缩径计数（原版 localAI[0]:<0.1 档 +0.01/子步,否则 +0.025——scale=1−值、
   *  width=height=20×scale Center 锚定;≥0.95 Kill=11×0.01+34×0.025=45 子步
   *  （float32/float64 累加同相,10 拍 0.01 和恒 <0.1 故 +0.01 实跑 11 拍）,
   *  MaxUpdates 3≈15t=真寿命） */
  private sf496Local = 0;
  /** 485 扇翅帧（frameCounter≥2 推帧 5 帧循环，:54834-54843——draw 消费） */
  hwFrame = 0;
  private hwFrameT = 0;
  // ---- ★BJ704-G10（件10,G2 登记债清偿）：459 充能爆破炮弹 AI_001 专属块
  //      （:55615-55656）三档蓄压面——发射侧 PrismProj 注入 ai[1]（0.7/1.0/1.3,
  //      NewProjectile 尾参 num35 :67574）;AI 每子步 Clamp(0.7,1.6) 后
  //      scale=ai[1]、判定盒 (int)(22×scale) Center 锚定（:55632-55635）----
  /** 459 ai[1] 蓄压档（AI 块消费;0=未注入档（外源直构）——首子步按 1 起步等价
   *  原版 ai[1] 缺省 0 经 Clamp(0.7,1.6) 落 0.7——发射位恒注入,防御性兜底） */
  ai1Scale459 = 0;
  /** 459 帧机（frameCounter≥3 推帧 3 帧回卷 :55622-55631——draw/ghost 帧锚消费） */
  f459Frame = 0;
  private f459FrameT = 0;
  /** 477 水晶镖平滑姿态角（前 5 拍对齐速度角+π/2、之后 (rot×2+aim)/3，
   *  :58666-58676——draw 消费；null = 未初始化走默认档） */
  dartRot: number | null = null;
  // ---- 1457 弧线引矢（AI_001_Features 位标 Projectile.cs:243-289——ai[2] 的
  //      FloatIntUnion 位 0..3；本仓展开为四布尔。写入端 = Player 侧
  //      Update_HarpyCharm/HarpyCharmEffect :28648-28704 扫描 → applyHarpyCharm
  //      （ApplyHarpyCharm :58779-58807）；消费端 = subStep 尾 homing 段（AI_001
  //      尾 :58752-58777）+ 命中侧 phoenixQuivered（StatusNPC :11178-11182）----
  /** bit0 HarpyCharmed（:245-251）：已被引矢锁定——homing 激活 + 玩家扫描跳过 */
  harpyCharmed = false;
  /** bit1 HarpyCharmConsumed（:257-263）：homing 中目标丢失 → 置位停引（:58772-58776），
   *  弹体回普通弹道（原版位不复位） */
  harpyCharmConsumed = false;
  /** bit2 PhoenixQuivered（:269-275，6181 凤凰箭袋标记）：命中 → Hellfire(323) 300t
   *  （StatusNPC :11178-11182 `nPC.AddBuff(323, 300)`） */
  phoenixQuivered = false;
  /** bit3 SeraphNecklaced（:281-287，6180 炽天使标记）：命中仅视觉
   *  （SilverBulletSparkle :71881-71893 + GetAlpha 白 :80608-80613），无结算面 */
  seraphNecklaced = false;
  /** R4-38：宝石法珠首帧音已播闸（AI_029 soundDelay 0→-1 单发语义） */
  gemShotSounded = false;
  // ---- 荆棘链族（7/8/150/151/152 + 魔晶碎块 493/494，aiStyle4，红队 R27 §10/§11 + BJ353）----
  /** 族激活（ctor 按 THORN_CHAIN_PROJS 自动置位）——subStep 独占状态机 */
  thornChain = false;
  /** ai[0]：0=渐显期（不动）/ 1=淡出期（alpha 回升） */
  private thornAi0 = 0;
  /** ai[1] 段号（武器首发 0；链生子段 = 父递增值，opts 注入） */
  thornAi1 = 0;
  /** 出生音 Item8 已播闸（localAI[0]==0 单发门 :23945-23954） */
  private thornBornSounded = false;

  /** FindTargetWithLineOfSight 等价：视距内最近且有视线的敌怪（:38571 FindTargetWithLineOfSight）。
   *  h = 目标命中盒高（225 叶绿箭归巢瞄准点上偏移 nPC.height×0.1..0.5 消费，:17147）。
   *  公开：1457 弧线引矢玩家侧扫描（harpyCharmEffect）对在场箭逐支调同款视距索敌 */
  nearestEnemyWithLos(game: GameHooks, range: number): { cx: number; cy: number; h: number } | null {
    let best: { cx: number; cy: number; h: number } | null = null;
    let bestD = range;
    for (const ent of game.enemies()) {
      const e = ent as unknown as { cx?: number; cy?: number; x: number; y: number; w: number; h: number; dead?: boolean; id: number };
      if (e.dead) continue;
      const cx = e.cx ?? e.x + e.w / 2;
      const cy = e.cy ?? e.y + e.h / 2;
      const d = Math.hypot(cx - this.cx, cy - this.cy);
      if (d >= bestD) continue;
      // 局部免疫期目标不入池（FindTargetWithLineOfSight :46483-46485
      // `projectile.localNPCImmunity[i] != 0 → flag=false`——宝石弹 60t 命中冷却窗内
      // 不再锁回刚打过的敌;出生预置窗（spawnImmuneCd）与命中冷却（localImmuneCd）
      // 本仓拆两表,同源 vanilla localNPCImmunity 数组,一并跳过）——蓝队 R7-4
      if ((this.localImmuneCd.get(e.id) ?? 0) > 0 || (this.spawnImmuneCd.get(e.id) ?? 0) > 0) continue;
      // CanHit 全盒→全盒（:46488 targeter.position/width/height → npc.position/width/
      // height——曾两端 0×0 盒心,薄障碍/斜角视线判定边缘差）
      if (!canHitLine(game.world.store, this.x, this.y, this.w, this.h, e.x, e.y, e.w, e.h)) continue;
      best = { cx, cy, h: e.h };
      bestD = d;
    }
    return best;
  }

  /** 477 水晶镖归巢候选收集（Projectile.cs 两处同构收集：Damage() :13597-13611
   *  NPC 命中侧 / HandleMovement type477 支 :18778-18795 撞块侧——(20,700) 严格
   *  双门 + CanBeChasedBy + CanHitLine(弹心 1×1→敌心 1×1,本仓 0 尺寸点近似) +
   *  ≤9 收集帽;随机取样与全速转向由调用方执行）。excludeId = NPC 命中侧的
   *  victimIndex 豁免（:13600 `j == victimIndex` skip）;撞块侧原版无豁免传 null。
   *  ★T4（R 类清账,2026-09-02）：撞块侧原内联收集与本支合一（行为零变）,
   *  NPC 命中侧补段复用同函数——原版 Damage() 侧半边此前整缺。 */
  private collectHomingTargets477(game: GameHooks, excludeId: number | null): Array<{ x: number; y: number }> {
    const cands: Array<{ x: number; y: number }> = [];
    for (const ent of game.enemies()) {
      const e = ent as unknown as { x: number; y: number; w: number; h: number; id: number; dead?: boolean };
      if (e.dead) continue;
      if (excludeId !== null && e.id === excludeId) continue;   // :13600 victimIndex 豁免
      if (!canBeChasedBy(ent)) continue;                        // CanBeChasedBy（:13603/:18780）
      const d = Math.hypot(e.x + e.w / 2 - this.cx, e.y + e.h / 2 - this.cy);
      if (d <= 20 || d >= 700) continue;                        //（:13606 num37=20/num36=700 严格双门）
      if (!canHitLine(game.world.store, this.cx, this.cy, 0, 0,
        e.x + e.w / 2, e.y + e.h / 2, 0, 0)) continue;          // CanHitLine(Center,1,1→Center,1,1)
      cands.push({ x: e.x + e.w / 2, y: e.y + e.h / 2 });
      if (cands.length >= 9) break;                             //（:13608-13610 num35>=9 帽）
    }
    return cands;
  }

  /** AoeExplosion 爆段（Kill :77011-77058）：Resize(160)=80px 半径 AoE——
   *  伤害 ×0.35/GetDamageMultiplier、kb ×0.35、penetrate -1（一击全杀段）。
   *  ★2026-08-26 尘面按原版补齐（:77014-77029）：30 枚同色尘,noGravity=rand(5)!=0、
   *  scale×(1+rand)、v×4.2（无重力档再 scale×0.6/fadeIn=0/noLight）+ 全体 v×rand
   *  ——曾以 '#C080FF' 引擎粒子近似（不进尘池无光照语义） */
  private gemAoeBurst(game: GameHooks): void {
    if (!this.gem?.aoeExplosion) return;
    const mult = gemDamageMultiplier(this.gem);
    const dmg = Math.max(1, Math.trunc(this.damage * (0.35 / mult)));
    const R = 80;
    for (const ent of game.enemies()) {
      const e = ent as unknown as { cx?: number; cy?: number; x: number; y: number; w: number; h: number; dead?: boolean; hurt?: (...a: unknown[]) => boolean };
      if (e.dead || !e.hurt) continue;
      const cx = e.cx ?? e.x + e.w / 2;
      const cy = e.cy ?? e.y + e.h / 2;
      if (Math.abs(cx - this.cx) < R + e.w / 2 && Math.abs(cy - this.cy) < R + e.h / 2) {
        // ★F3 对账收口（蓝队四轮）：Kill 爆箱重结算 = 原 Damage() 面（resize 后
        //   二次结算）→ 双支单源站位；宝石弹族数据面 magic ⇒ 门内恒拒=原版同真值,
        //   未来分流翻旗自动生效。
        const snapBonusGemAoe = projectileSnapStrikeBonus(game,
          { projId: this.projId }, cx, cy, (e as unknown as { id?: number }).id ?? -1,
          { victimBox: { w: e.w, h: e.h, cx, cy } });
        e.hurt(applyBannerDamageDealt(game, e, dmg) + (snapBonusGemAoe ? Math.trunc(snapBonusGemAoe * 1) : 0), Math.sign(cx - this.cx) * this.knockback * 0.35, 0, game, this.settlePen, false, this.pierceInit, true);
      }
    }
    // vector67 = velocity.SafeNormalize（<1 归零,:76993-77000 同公共段）
    const aSpd = Math.hypot(this.vx, this.vy);
    const adx = aSpd < 1 ? 0 : this.vx / aSpd;
    const ady = aSpd < 1 ? 0 : this.vy / aSpd;
    const adust = this.projId === 597 ? 262 : this.projId - 35;
    for (let i = 0; i < 30; i++) {
      const ng = Math.floor(Math.random() * 5) !== 0;          // noGravity = rand(5)!=0
      const da = game.spawnDust?.(this.x, this.y, this.w, this.h, adust,
        adx, ady, 50, null, 1.2);
      if (!da) break;
      da.noGravity = ng;
      da.scale *= 1 + Math.random();
      const rv = Math.random();
      da.vx = (da.vx * 4.2) * rv;
      da.vy = (da.vy * 4.2) * rv;
      if (!ng) {
        da.scale *= 0.6;
        da.fadeIn = 0;
        da.noLight = true;
      }
    }
  }

  /** ★R28 §6 星璇秘术死亡爆（Kill :73553-73612）：176×176 居中 Damage() AoE +
   *  Item14 + 4×d240 + 30 循环×(d62 scale3.7 + d90 Crimson fadeIn1) + 10×d62 +
   *  10×d240 + 2 烟 gore(61-63)（自属 618 火花由 naParent 分支父亡即杀承载）+
   *  ★BJ348 爆裂碎片 620×(5..8)+(5..8)（:73622-73658,伤×0.65/击退×0.8/尘色键 86|90） */
  private arcanumDeathBurst(game: GameHooks): void {
    const R = 88;                                       // Resize(176) → 半径 88
    for (const ent of game.enemies()) {
      const e = ent as unknown as { x: number; y: number; w: number; h: number; dead?: boolean; hurt?: (...a: unknown[]) => boolean };
      if (e.dead || !e.hurt) continue;
      const ecx = e.x + e.w / 2, ecy = e.y + e.h / 2;
      if (Math.abs(ecx - this.cx) < R + e.w / 2 && Math.abs(ecy - this.cy) < R + e.h / 2) {
        // ★爆箱局部免疫门（:12586 Damage_PVE flag2 = usesLocalNPCImmunity && array[i]==0）：
        //   3 击终结目标在命中侧已写 immuneArray=localNPCHitCooldown=8（:14178）→ 爆箱
        //   二次结算跳过该目标（否则第 3 击+爆箱=同目标双吃）；localNPCImmunity 每 tick
        //   递减（:17380-17384）= 本仓 localImmuneCd（:8371 同拍递减）
        if (this.localImmune > 0
          && (this.localImmuneCd.get((e as unknown as { id?: number }).id ?? -1) ?? 0) > 0) continue;
        // ★BJ496①（2026-10-04）爆面掷率收编（BJ493③ 661 先例）：旧 `||` 面把 spawn 位
        //  0.04 路由门误当 4% 平率消费（shotArrow 兜底迁移后 617 经该路出生）——暴击掷
        //  =Damage() 面 :12915-12927 magic 臂（617 数据面 magic）owner 装配+:25712 持械
        //  折入,命中拍动态;critChance≤0 关断钉保留。
        const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
        const snapBonusDeath = projectileSnapStrikeBonus(game,
          { projId: this.projId }, ecx, ecy, (e as unknown as { id?: number }).id ?? -1,
          { victimBox: { w: e.w, h: e.h, cx: ecx, cy: ecy } });   // ★F3 对账收口:爆箱=原 Damage() 面
        e.hurt(applyBannerDamageDealt(game, e, crit ? this.damage * 2 : this.damage)
          + (snapBonusDeath ? Math.trunc(snapBonusDeath * (crit ? 2 : 1)) : 0),
          Math.sign(ecx - this.cx) * this.knockback, 0, game, this.armorPen, crit, 0, true);   // ★F1 旗乘区;fromPlayer=DPS 计
      }
    }
    game.playSfxFiles?.(['Item_14'], 1, this.cx, this.cy);
    // 爆尘散布（:73561-73594 逐尘 position = Center + 半盘向×rand×88 覆写）：UnitY 盘 =
    //   UnitY.RotatedByRandom(π)（θ∈±π/2 → (−sinθ,cosθ) 下半盘）；速度轴盘 = UnitX.
    //   RotatedByRandom(π).RotBy(velocity.ToRotation())（→ 角 θ+φ 全向）
    const discY617 = (): [number, number] => {
      const th = (Math.random() - 0.5) * Math.PI;       // RotatedByRandom(π)
      const r = Math.random() * R;                      // NextDouble()×width/2
      return [-Math.sin(th) * r, Math.cos(th) * r];
    };
    const velA617 = Math.atan2(this.vy, this.vx);       // velocity.ToRotation()
    const discX617 = (): [number, number] => {
      const th = (Math.random() - 0.5) * Math.PI + velA617;
      const r = Math.random() * R;
      return [Math.cos(th) * r, Math.sin(th) * r];
    };
    for (let i = 0; i < 4; i++) {                       // 4×d240（原版无 noGravity 写行 → 重力开）
      const d240 = game.spawnDust?.(this.cx - 4, this.cy - 4, 8, 8, 240, 0, 0, 100, null, 1.5);
      if (d240) { const [ox, oy] = discY617(); d240.x = this.cx + ox; d240.y = this.cy + oy; }
    }
    for (let i = 0; i < 30; i++) {                      // 30 循环×(d62+d90 Crimson)
      const d62 = game.spawnDust?.(this.cx - 4, this.cy - 4, 8, 8, 62, 0, 0, 200, null, 3.7, true);
      if (d62) { const [ox, oy] = discY617(); d62.x = this.cx + ox; d62.y = this.cy + oy; d62.vx *= 3; d62.vy *= 3; }
      const d90 = game.spawnDust?.(this.cx - 4, this.cy - 4, 8, 8, 90, 0, 0, 100,
        { r: 110, g: 10, b: 30, a: 255 }, 1.5, true);   // Color.Crimson×0.5（:73579；661 同值先例）
      if (d90) {
        const [ox, oy] = discY617(); d90.x = this.cx + ox; d90.y = this.cy + oy;
        d90.vx *= 2; d90.vy *= 2; d90.fadeIn = 1;
      }
    }
    for (let i = 0; i < 10; i++) {
      const dc = game.spawnDust?.(this.cx - 4, this.cy - 4, 8, 8, 62, 0, 0, 0, null, 2.7, true);
      if (dc) { const [ox, oy] = discX617(); dc.x = this.cx + ox; dc.y = this.cy + oy; dc.vx *= 3; dc.vy *= 3; }
      const dd = game.spawnDust?.(this.cx - 4, this.cy - 4, 8, 8, 240, 0, 0, 0, null, 1.5, true);
      if (dd) { const [ox, oy] = discX617(); dd.x = this.cx + ox; dd.y = this.cy + oy; dd.vx *= 3; dd.vy *= 3; }
    }
    for (let i = 0; i < 2; i++) {                       // 烟 gore 61-63（:73604-73610）
      const g = GorePiece.newGore(61 + Math.floor(Math.random() * 3), this.cx, this.cy, 0, 0);
      if (g) {
        g.vx *= 0.3; g.vy *= 0.3;
        g.vx += (Math.floor(Math.random() * 21) - 10) * 0.05;
        g.vy += (Math.floor(Math.random() * 21) - 10) * 0.05;
      }
    }
    // ★BJ348 爆裂碎片 620（:73622-73658，myPlayer==owner 单机恒真；自属 618 清场由
    //   naParent 父亡链承载=Next tick 自杀）。num213/num214 = Next(5,9) 各 5..8 枚、
    //   尾迹尘色 num215=SelectRandom(86,90) / num216=互补——掷序：先二数量后色键，
    //   逐枚掷散布向（Next(-100,101) 双轴、零向重掷、归一、Y>0.2|0.4 反折上抛）
    //   × Next(70,101)|Next(40,81)×0.1。伤 = damage×0.65（C# double→int 截断）、
    //   击退 ×0.8、ai[0]=尘色键。出生 = 心 + RandomVector2(±30)（NewProjectile 盒心
    //   语义 → ctor 左上 −w/2 回正）。本体全隐（α≡255），视觉 = 尾迹尘（620 AI 支）。
    {
      const ents620 = (game as unknown as { entities?: { add?: (e: unknown, b: string) => void } }).entities;
      if (ents620?.add) {
        const nA620 = 5 + Math.floor(Math.random() * 4);            // Next(5,9)
        const nB620 = 5 + Math.floor(Math.random() * 4);            // Next(5,9)
        const tA620 = Math.random() < 0.5 ? 86 : 90;                // SelectRandom
        const tB620 = tA620 === 86 ? 90 : 86;
        const shardVel620 = (yFlip: number, spdMul: { lo: number; n: number }): [number, number] => {
          let vx620 = Math.floor(Math.random() * 201) - 100;        // Next(-100,101)
          let vy620 = Math.floor(Math.random() * 201) - 100;
          while (vx620 === 0 && vy620 === 0) {                      // 零向重掷（:73627-73629）
            vx620 = Math.floor(Math.random() * 201) - 100;
            vy620 = Math.floor(Math.random() * 201) - 100;
          }
          const l620 = Math.hypot(vx620, vy620);
          vx620 /= l620; vy620 /= l620;                             // Normalize（:73631）
          if (vy620 > yFlip) vy620 = -vy620;                        // 上抛反折（:73632-73634）
          const s620 = (Math.floor(Math.random() * spdMul.n) + spdMul.lo) * 0.1;
          return [vx620 * s620, vy620 * s620];
        };
        for (let i620 = 0; i620 < nA620; i620++) {                  // A 环：Y>0.2 反折、速 7..10
          const ox620 = (30 - -30) * Math.random() + -30;           // RandomVector2(±30)
          const oy620 = (30 - -30) * Math.random() + -30;
          const [svx620, svy620] = shardVel620(0.2, { lo: 70, n: 31 });
          const sh620 = new Arrow(this.cx + ox620 - 4, this.cy + oy620 - 4,
            svx620, svy620, Math.max(1, Math.trunc(this.damage * 0.65)),
            this.knockback * 0.8, 620, { grav: 0, life: 3600, pierce: 1 });
          sh620.na620Dust = tA620;
          sh620.critChance = this.critChance;
          sh620.armorPen = this.armorPen;
          ents620.add(sh620, 'projectiles');
        }
        for (let i620 = 0; i620 < nB620; i620++) {                  // B 环：Y>0.4 反折、速 4..8
          const ox620 = (30 - -30) * Math.random() + -30;
          const oy620 = (30 - -30) * Math.random() + -30;
          const [svx620, svy620] = shardVel620(0.4, { lo: 40, n: 41 });
          const sh620 = new Arrow(this.cx + ox620 - 4, this.cy + oy620 - 4,
            svx620, svy620, Math.max(1, Math.trunc(this.damage * 0.65)),
            this.knockback * 0.8, 620, { grav: 0, life: 3600, pierce: 1 });
          sh620.na620Dust = tB620;
          sh620.critChance = this.critChance;
          sh620.armorPen = this.armorPen;
          ents620.add(sh620, 'projectiles');
        }
      }
    }
  }

  /** ★R28 §4 灵魂之焰死亡爆（Kill :73798-73837,ai[0]≥0 已锁过敌才爆）：
   *  80×80 居中 Damage() AoE + Item14 + 前 15 枚 d27 正 Y 环形 RotatedBy(2π(i+1)/15)
   *  ×(5+rand×1.5) fadeIn1.5+、后 15 枚随机盘内散布 ×2 + 10×d31 烟 */
  private flame659DeathBurst(game: GameHooks): void {
    const R = 40;
    for (const ent of game.enemies()) {
      const e = ent as unknown as { x: number; y: number; w: number; h: number; dead?: boolean; hurt?: (...a: unknown[]) => boolean };
      if (e.dead || !e.hurt) continue;
      const ecx = e.x + e.w / 2, ecy = e.y + e.h / 2;
      if (Math.abs(ecx - this.cx) < R + e.w / 2 && Math.abs(ecy - this.cy) < R + e.h / 2) {
        // ★BJ496①（2026-10-04）爆面掷率收编（同 arcanumDeathBurst 锚）：旧 `||` 面
        //  把 0.04 路由门误当 4% 平率（659 经 shotArrow 兜底出生）→ rollVanillaHitCrit
        //  命中拍动态（659 数据面 magic,:12915-12927 magic 臂）。
        const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
        const snapBonusDeath = projectileSnapStrikeBonus(game,
          { projId: this.projId }, ecx, ecy, (e as unknown as { id?: number }).id ?? -1,
          { victimBox: { w: e.w, h: e.h, cx: ecx, cy: ecy } });   // ★F3 对账收口:爆箱=原 Damage() 面
        e.hurt(applyBannerDamageDealt(game, e, crit ? this.damage * 2 : this.damage)
          + (snapBonusDeath ? Math.trunc(snapBonusDeath * (crit ? 2 : 1)) : 0),
          Math.sign(ecx - this.cx) * this.knockback, 0, game, this.armorPen, crit, 0, true);   // ★F1 旗乘区;fromPlayer=DPS 计
      }
    }
    game.playSfxFiles?.(['Item_14'], 1, this.cx, this.cy);
    for (let i = 0; i < 30; i++) {
      const sc = 2 + Math.random() * 0.5;
      let vx = 0, vy = 0;
      if (i < 15) {
        const th = ((i + 1) / 15) * Math.PI * 2;        // UnitY.RotatedBy(2π(i+1)/15)
        vx = -Math.sin(th) * (5 + Math.random() * 1.5);
        vy = Math.cos(th) * (5 + Math.random() * 1.5);
      }
      const d = game.spawnDust?.(i < 15 ? this.cx - 1 : this.cx - Math.sin(Math.random() * Math.PI * 2) * R * Math.random(),
        i < 15 ? this.cy - 1 : this.cy + Math.cos(Math.random() * Math.PI * 2) * R * Math.random(),
        2, 2, 27, vx, vy, 0, null, sc, true);
      if (d) { d.fadeIn = i < 15 ? 1.5 + Math.random() * 0.5 : 0.5 + Math.random() * 0.5; if (i >= 15) { d.vx *= 2; d.vy *= 2; } }
    }
    for (let i = 0; i < 10; i++) {                      // 10×d31 烟
      const th = Math.random() * Math.PI * 2;
      game.spawnDust?.(this.cx - 1 + Math.cos(th) * R / 1.5, this.cy - 1 + Math.sin(th) * R / 1.5,
        2, 2, 31, 0, 0, 0, null, 1.5, true);
    }
  }

  /** ★R29 玛瑙爆破枪 661 黑爆二段（Kill :73493-73540）：position 归心后 Resize(160×160)
   *  → Damage() AoE 二次结算（伤=弹体全额、kb 同弹）+ Item14 + 4×d240(scale1.5) +
   *  20 循环×{d62 scale3.7 v×3+径向(2..6) / d62 scale1.5 Crimson×0.5 fadeIn1 v×2+径向8} +
   *  20×d62 scale2.7 沿速度轴环 + 70×d240 沿速度轴环 */
  private blackBolt661Burst(game: GameHooks): void {
    const R661 = 80;                                       // Resize(160) 半宽
    for (const ent of game.enemies()) {
      const e = ent as unknown as { x: number; y: number; w: number; h: number; dead?: boolean; hurt?: (...a: unknown[]) => boolean };
      if (e.dead || !e.hurt) continue;
      const ecx = e.x + e.w / 2, ecy = e.y + e.h / 2;
      if (Math.abs(ecx - this.cx) < R661 + e.w / 2 && Math.abs(ecy - this.cy) < R661 + e.h / 2) {
        // ★BJ493③（2026-10-04）：spawnFanArrow critBonus 冻结写位摘除后本爆面失 readers
        //  → 掷率迁移 rollVanillaHitCrit（661 ranged 旗,:12915-12927 命中拍动态——
        //  爆=Damage() AoE 同面;critChance>0 门=0.04 路由门/测试 -1 钳同相,旧 `||`
        //  面把 critChance 当全率读、0.04 门值会被误当 4% 平率消费）。
        const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
        const snapBonusBurst = projectileSnapStrikeBonus(game,
          { projId: this.projId }, ecx, ecy, (e as unknown as { id?: number }).id ?? -1,
          { victimBox: { w: e.w, h: e.h, cx: ecx, cy: ecy } });   // ★F3 对账收口:爆箱=原 Damage() 面
        e.hurt(applyBannerDamageDealt(game, e, crit ? this.damage * 2 : this.damage)
          + (snapBonusBurst ? Math.trunc(snapBonusBurst * (crit ? 2 : 1)) : 0),
          Math.sign(ecx - this.cx) * this.knockback, 0, game, this.settlePen, crit, 0, true);   // ★F1 旗乘区;fromPlayer=DPS 计
      }
    }
    game.playSfxFiles?.(['Item_14'], 1, this.cx, this.cy);
    for (let i = 0; i < 4; i++) {                          // 4×d240（UnitY.RotByRandom 盘内）
      const th = Math.random() * Math.PI * 2, rr = Math.random() * R661 / 2;
      game.spawnDust?.(this.cx + Math.sin(th) * rr - 4, this.cy + Math.cos(th) * rr - 4,
        8, 8, 240, 0, 0, 100, null, 1.5);
    }
    for (let i = 0; i < 20; i++) {                         // 20 循环×双 d62
      const th = Math.random() * Math.PI * 2, rr = Math.random() * R661 / 2;
      const px = this.cx + Math.sin(th) * rr, py = this.cy + Math.cos(th) * rr;
      const dA = game.spawnDust?.(px - 4, py - 4, 8, 8, 62, 0, 0, 200, null, 3.7, true);
      if (dA) {
        dA.vx *= 3; dA.vy *= 3;
        dA.vx += Math.sign(px - this.cx) * (2 + Math.random() * 4);   // DirectionTo(pos) 径向
        dA.vy += Math.sign(py - this.cy) * (2 + Math.random() * 4);
      }
      const dB = game.spawnDust?.(px - 4, py - 4, 8, 8, 62, 0, 0, 100,
        { r: 110, g: 10, b: 30, a: 255 }, 1.5, true);      // Color.Crimson*0.5 tint
      if (dB) { dB.fadeIn = 1; dB.vx *= 2; dB.vy *= 2; dB.vx += Math.sign(px - this.cx) * 8; dB.vy += Math.sign(py - this.cy) * 8; }
    }
    const va661k = Math.atan2(this.vy, this.vx);
    const ca661k = Math.cos(va661k), sa661k = Math.sin(va661k);
    for (let i = 0; i < 20; i++) {                         // 20×d62 scale2.7 沿速度轴
      const th = Math.random() * Math.PI * 2;
      const ox = Math.sin(th) * R661 / 2, oy = -Math.cos(th) * R661 / 2;
      game.spawnDust?.(this.cx + ox * ca661k - oy * sa661k - 4,
        this.cy + ox * sa661k + oy * ca661k - 4, 8, 8, 62, 0, 0, 0, null, 2.7, true);
    }
    for (let i = 0; i < 70; i++) {                         // 70×d240 沿速度轴
      const th = Math.random() * Math.PI * 2;
      const ox = Math.sin(th) * R661 / 2, oy = -Math.cos(th) * R661 / 2;
      game.spawnDust?.(this.cx + ox * ca661k - oy * sa661k - 4,
        this.cy + ox * sa661k + oy * ca661k - 4, 8, 8, 240, 0, 0, 0, null, 1.5);
    }
  }

  /** ★B1 接线批：死亡细胞桶发射器弹 1023 Kill 爆（Projectile.cs:78560-78585）：
   *  音 DeadCellsBarrelLauncherExplode（SoundID.cs:1104 WithVolume 0.6）→ 判定盒
   *  归心扩至 192×192 结算 Damage() → DeadCellsBarrelExplosion 编排粒子
   *  （ParticleOrchestrator.cs:1710-1785——★2026-09-01 由"spawnParticles 青色近似"
   *  升格为忠实本体 deadCellsBarrelExplosionFx + module8 上行；原版
   *  RequestParticleSpawn(clientOnly:true) :78567-78572 → 本仓 owner 权威模拟广播
   *  补远端，同 34 型偏差口径）+ 8 枚烟 gore 61-63 八向环抛
   *  （出生位=Center±24 盘内、速=2π·i/8 向 ×rand·8）+ 40× d31 从盒内向心位
   *  DirectionTo(dust) 径向 ×rand·8。 */
  private barrel1023Burst(game: GameHooks): void {
    game.playSfxFile?.('deadcells_barrel_launcher_explode', 0.6, this.cx, this.cy);
    const R23 = 96;                                    // Resize(192) 半宽
    // 原版盒重叠结算（Resize 后 Damage()）；本仓 AoE 族统一中心距近似（gemAoeBurst 同）
    for (const ent of game.enemies()) {
      const e = ent as unknown as { x: number; y: number; w: number; h: number; dead?: boolean; hurt?: (...a: unknown[]) => boolean };
      if (e.dead || !e.hurt) continue;
      const ecx = e.x + e.w / 2, ecy = e.y + e.h / 2;
      if (Math.abs(ecx - this.cx) < R23 + e.w / 2 && Math.abs(ecy - this.cy) < R23 + e.h / 2) {
        // ★BJ497①（2026-10-04）掷率收编（BJ493② 主环改形先例）：旧 `||` 面把 critChance
        //  当全率读（0.04 路由门误作 4% 平率）+丢 owner 聚合/:25712 持械折入。1023 数据面
        //  ranged（SetDefaults :9690）。★销案锚：本弹现无出生面=休眠（发射器 5460 仅存
        //  数据面 vanilla-itemfunc/vanilla-itemcombat,items.ts 未注册 vi_5460,
        //  legacyItemIndex 5460→vi_4286_Cherry 非发射器,全库无 1023 spawn 支）——面随族
        //  收编;未来建模发射器时 spawn 位须置 critChance=0.04 路由门（族约定）。
        const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
        const snapBonusBurst = projectileSnapStrikeBonus(game,
          { projId: this.projId }, ecx, ecy, (e as unknown as { id?: number }).id ?? -1,
          { victimBox: { w: e.w, h: e.h, cx: ecx, cy: ecy } });   // ★F3 对账收口:爆箱=原 Damage() 面
        e.hurt(applyBannerDamageDealt(game, e, crit ? this.damage * 2 : this.damage)
          + (snapBonusBurst ? Math.trunc(snapBonusBurst * (crit ? 2 : 1)) : 0),
          Math.sign(ecx - this.cx) * this.knockback, 0, game, this.settlePen, crit, 0, true);   // ★F1 旗乘区;fromPlayer=DPS 计
      }
    }
    deadCellsBarrelExplosionFx(game, this.cx, this.cy);
    game.broadcastParticleOrchestra?.(ParticleOrchestraType.DeadCellsBarrelExplosion,
      this.cx, this.cy);
    for (let i = 0; i < 8; i++) {                      // 烟 gore 环抛（:78570-78573）
      const th = (Math.PI * 2 * i) / 8;
      GorePiece.newGore(61 + Math.floor(Math.random() * 3),
        this.cx + (Math.random() * 48 - 24), this.cy + (Math.random() * 48 - 24),
        Math.cos(th) * Math.random() * 8, Math.sin(th) * Math.random() * 8);
    }
    for (let i = 0; i < 40; i++) {                     // 40×d31 径向烟（:78575-78578）
      const d = game.spawnDust?.(this.cx - R23, this.cy - R23, R23 * 2, R23 * 2, 31);
      if (!d) continue;
      const dx = d.x - this.cx, dy = d.y - this.cy;
      const l = Math.hypot(dx, dy) || 1;
      const spd = Math.random() * 8;
      d.vx = (dx / l) * spd; d.vy = (dy / l) * spd;
    }
  }

  // ---- 喵刀弹 502（Meowmere Cat）专属态 ----
  /** 614 星尘细胞弹 ai[1]（AI_113_TargetSticker :41289-41330）：目标敌 id（发射侧
   *  MinionProj 注入,原版 NewProjectile 第 11 参 = num13 目标索引）——硬追踪/失的即杀/
   *  命中匹配目标上 buff 183×900t（StatusNPC :11381-11383 `type==614 && ai[1]==i`）。
   *  ★BJ703-D3：命中拍由 :13244-13251 转刺入时覆写为【实际 victim】（先于 StatusNPC
   *  :13634 ⇒ 183 gate ai1==i 读新靶——途中撞非目标敌同上 183） */
  stickerTgt = 0;
  /** ★BJ703-D3（BJ698 登记债③）：614 ai[0] 镜像（0=追踪 / 1=stuck 刺入贴附）。
   *  原版转刺入 = Damage_PVE_Inner :13244-13251 `aiStyle==113 ∧ ai[0]<2`（首受理
   *  命中拍）;stuck 态贴附敌身零接触伤（Damage_CanDealDamage :12463 首行
   *  `type==614∧ai[0]==1` 拒——本仓 AI 支早退承载）至 localAI[0]≥900
   *  （60×num11=15,:41400/:41480）或靶亡/dontTakeDamage → Kill。 */
  stickerA0 = 0;
  /** ★BJ703-D3：614 localAI[0]（stuck 态驻留计数,:41429 逐拍 ++） */
  stuckT614 = 0;
  /** ai[0]：弹跳+命中共享计数（0..5，≥5 消亡）——弹跳 :18169 递增/命中 :16794
   *  递增同槽（先到 5 者杀弹，喵叫音高 style=5+ai0 随之爬升） */
  meowCount = 0;
  /** ★BJ229 aiStyle 8 反射族弹跳计数（vanilla ai[0]，HandleMovement :19692
   *  `ai[0]++`——与 NPC 穿透 penetrate 独立,达帽（15=6/253=8/余 5:19699-19703;
   *  27 熔岩态 ai[1]==1→7 :19696-19698,熔岩支未接线 P2 登记恒走 5）即
   *  position+=velocity+Kill。仅 AI8_BOUNCE_PROJS 五型消费。 */
  ai8Bounces = 0;
  /** ★BJ252 116 光束剑波撞块计数（vanilla ai[2]，HandleMovement :19920 `ai[2]++`
   *  ——<4 弹反（Item_10+30×d64+双轴全速反）/≥4 Kill。116 AI_027 不用 ai[2]
   *  （AI_027 只消费 ai[0]/ai[1]/localAI[0..1],:26768-26916）=专位空闲。 */
  beam116Bounces = 0;
  /** localNPCHitCooldown 同敌再命中冷却（SetDefaults :5466-5468 = 10t） */
  private meowHitCd = new Map<number, number>();
  /** 1457: 通用局部 NPC 无敌帧（usesLocalNPCImmunity + localNPCHitCooldown=N，
   *  Projectile.cs:10688-10689 等）——同弹对同敌 N t 冷却后再命中（数据列驱动，
   *  121-126/597 宝石法珠 60t / 77-78 音符 30t / 309 FrostBlast 10t / 502 喵刀 10t 同型） */
  private localImmuneCd = new Map<number, number>();
  /** 出生预置局部免疫表（localNPCImmunity[target]=N——localImmuneSeed opts 写入,
   *  每 tick 递减（DecrementLocalImmuneTimeCounters :15919-15936,Update :15330
   *  在子步循环前每 tick 一次）,命中环独立消费。与命中后写档 localImmuneCd
   *  分离：本表项不参与命中后冷却语义） */
  private spawnImmuneCd = new Map<number, number>();
  /** 本弹的 localNPCHitCooldown（>0 = 启用局部免疫冷却语义） */
  private localImmune = 0;
  /** 宝石弹 oldPos 环（扁平 [x0,y0,x1,y1,…]，[0]=本 tick 出生位、[2i/2i+1]=i tick 前
   *  ——Projectile.cs:15452-15466 FastThenSlow 拖尾扫掠 oldPos[1..5] 消费） */
  private gemTrail: number[] = [];
  /** ★shader 审计战役：34/16/106 拖尾点环（x,y 对，旧→新）——drawStripTrail 消费 */
  private stripTrailPts: number[] = [];
  /** oldPos 拖尾环（彩虹拖尾 Main.cs:32495-32513 沿 oldPos 逐段绘制，N=10） */
  private meowTrail: number[] = [];
  /** aiStyle 24 书族 oldPos 环（94 水晶风暴/95 诅咒之焰/1114 日耀花——Main.cs:35251/
   *  :35299 十份渐隐拷贝沿 oldPos 绘制,缩放/色各 ×(9−i)/9,N=10） */
  private starTrail: number[] = [];
  /** 迪斯科 RGB（DoUpdate_AnimateDiscoRGB Main.cs:19441 六段 ±7/帧；初值 R=255） */
  private discoR = 255;
  private discoG = 0;
  private discoB = 0;
  private discoStyle = 0;
  /** 弹体点光（Game 实体光扫读 lightRGB——同 Enemy 约定） */
  lightRGB: [number, number, number] | null = null;
  /** 点光源像素覆盖（缺省=实体中心；985 泰拉刃 :39382 光心=弹心+朝向 85×scale） */
  lightRGBAt: { x: number; y: number } | null = null;
  // ---- 叶绿弹 207 / 骷髅头法书弹 837（AI_001 顶层段 :53906-54010）----
  /** ai[1] 锁敌标记（原版 = npc 索引+1；本仓存 Enemy.id，0 = 未锁） */
  chloAi1 = 0;
  /** localAI[0] 初速（首次 AI 取 |v|，此后恒为转向基准速度——转向不清速） */
  chloSpeed = 0;
  // ---- ★BJ431 火花族 504/954/979（aiStyle 2 type 共支,Projectile.cs:23764-23803）----
  /** vanilla ai[0] 计寿钟（AI 每子步 ++；命中快进 = Damage_PVE_Inner :13051-13055
   *  `ai[0] += (60−ai[0])/2` 同槽消费——float 域,首中即 ≈30） */
  sparkAi0 = 0;
  // ---- aiStyle 36 蜂族（AI() 派发器 :27683-27862）----
  /** ai[0] 索敌延迟计数（>30 后每 update 重搜最近敌，:27762-27764 钳 30） */
  private bee36Delay = 0;
  /** 本拍锁定目标（每拍重搜，不持久锁——原版无 ai 锁存） */
  private bee36Aim: { cx: number; cy: number } | null = null;
  /** 本拍是否锁到真实敌（false = 无目标前瞻点；316 速度档/307 friendly 消费） */
  private bee36AimLocked = false;
  /** 307 小吞噬者 friendly 旗（SetDefaults 无 friendly :3986-3995；锁定瞬间置位
   *  :27789-27792——锁定前穿敌不结算，命中环按此门禁） */
  friendly307 = false;
  /** frameCounter（316 6 拍/帧 2 帧循环 :27699-27706 / 其余 3 拍/帧 3 帧 :27720-27727）*/
  bee36Frame = 0;
  private bee36FrameT = 0;
  /** 蜂族姿态角（draw 消费；null = 非蜂族）：307 = atan2(vy,vx)−π/2（:27698）/
   *  其余 = velocity.X×0.1（:27716）——每 AI 步刷新 */
  bee36Tilt: number | null = null;
  /** 蜂族 alpha 归零后 extraUpdates→0 挂起（:27693-27695——原版 numUpdates 每 tick
   *  头读取,当拍已入循环的子步数不变,下一 tick 起 1 子步/tick） */
  private bee36EU0 = false;
  // ---- ★L2 湿缓存（Projectile.wet/lavaWet/honeyWet/shimmerWet 同名字段,2026-09-01
  //  NX3 遗留2）----原版四字段 = 出生预置（NewProjectile :10886-10892 WetCollision
  //  首测;lavaWet 原版预置不设,恒 false 起步）+ 每子步液段刷新（:16906-16918 置位 /
  //  :17103-17108 !wet 三清）;AI 头读的是【缓存】,即上一子步液段值（出生拍 = 预置
  //  值）。本仓消费族（wetCacheConsumer）按此时序维护,蜂族/469/入水消亡块判湿位改
  //  读缓存——详见 fixedUpdate 出生预置块注。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984 置 10 / :17109-17112 每子步 −1；
   *  入水/出水溅花门 `wetCount == 0` 共用——快速贴面往返只在窗尽后再溅一次） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-92 等价）——2026-09-08 湿段收口批改名
   *  presetDone=ProjWetFlags.presetDone 同名旗（共享湿段体首调预置支经此短路;预置位次
   *  仍在 fixedUpdate 头,先于首子步 AI——湿缓存消费者 469/蜂族首读预置值,见预置块注） */
  presetDone = false;
  /** 湿缓存消费族：aiStyle 36 蜂族（181/189/307/316/566,AI_036 :27685 读 wet 三旗）
   *  + 469 蜂箭（AI_001 头 :54969 同三旗）+ AI_001 共享 wet 段消亡/变型族
   *  （★F3 2026-09-01 入表：IsDestroyedByWater 六型 ProjectileID.cs:287 + 2 燃烧箭
   *  变型 :16921-16931——旧写「弹心格内联探测」退役后这些 id 的消亡块改读缓存,
   *  必须入消费面才有人维护）。原版全体弹都维护此缓存;本仓其余弹族不为无消费者
   *  付每子步重测成本——消费面扩族时同步入表 */
  // ★2026-09-04 旧 wetCacheConsumer id 集（蜂族 181/189/307/316/566 + 469 + 2 +
  //  376/710 + IsDestroyedByWater 六型）已随湿段全面开闸退役（见 subStepAI 湿段门注
  //  ——溅花面本身就是全体弹的消费者,id 限域=其余弹入水永不溅花）。AI 湿敏消费位
  //  （469 蜂箭/蜂族三旗/376 鬼火/710 空中祸害/IsDestroyedByWater 消亡/2 变型）读的
  //  this.wet* 四旗如今对全体非 ignoreWater 弹逐子步维护,无需入表。376/710 勘误
  //  （2026-09-02）保留有效：AI 消亡门读缓存(现全体刷新)。

  // ---- 616 星旋机枪涡旋弹（AI_001 重力链 616 支 :58383-58465）----
  /** ai[0] 索敌延迟（>20 后激活，:58403-58405 自减钳 20） */
  private vx616Delay = 0;
  /** ai[1] 锁敌（npc 索引+1；本仓存 Enemy.id；0=未锁；失效不复锁 :58421-58437） */
  private vx616Ai1 = 0;
  /** localAI[0] 初速快照（转向基准，:58371-58377） */
  private vx616Speed = 0;
  // ---- 297 幽灵法杖弹（aiStyle 51 :28825-28927）----
  // （无持久态——每拍全量重搜）
  // ---- 659 灵魂之焰（aiStyle 129 :36861-36970）----
  /** ai[0] 锁定目标（vanilla npc 索引，负数 = 无/失效态；本仓存 Enemy.id，−1 无） */
  private sf659Ai0 = -1;
  /** localAI[0] 重索敌节拍（每 5 update 一搜，:36878-36882） */
  private sf659Cd = 0;
  // ---- ★R28 中期魔法族（红队 R28 §1-§15）专属态 ----
  /** 出生自校正挂起旗（首个子步按 Player.Shoot 公式重构自身/兄弟弹几何——
   *  发射链挂点在 Game.ts（R26 蓝队分区），本仓以"出生弹=原版 i=0 弹"为锚
   *  在实体侧补齐多发散布/天降几何/悬浮出生态） */
  rp30Pending = false;       // 336 松针手枪梯次扇（Player.cs:48067-48086）
  blz337Pending = false;     // 337 暴雪法杖天顶双锥（:48089-48117）
  bat316Pending = false;     // 316 蝙蝠杖 2-3 只散布（:48820-48830）
  sf659Birth = false;        // 659 灵魂之焰悬浮出生态（:49297-49310）
  /** 659 出生基准向（ctor 快照 normalize(初速)——CanHit 试向的旋转基准） */
  private sf659DirX = 0;
  private sf659DirY = -1;
  /** 659 三臂旋尘相位 ai[1]（每 update 自增 :36916） */
  private sf659Phase = 0;
  // ---- 教徒火球 467 真制导（AI_001 type==467 支,1458 P.cs:55133-55253 /
  //      1457 :55132-55252 两版本同段;2026-08-31 台账批实体化支）----
  /** ai[1] 态机：0 首拍 →1 扫描窗 →21..199 锁定转向（≥200 停止=直飞到寿终/撞块） */
  private f467Ai1 = 0;
  /** 锁定玩家引用（ai[0]=whoAmI 的对象化；null=未锁。dead 可选=fakeHooks 兼容） */
  private f467Target: { cx: number; cy: number; dead?: boolean } | null = null;
  /** localAI[0]：尾尘环节拍（==12 重置并撒 12 粒,:55204-55230） */
  private f467Local = 0;
  /** 帧：frameCounter≥3 推帧 4 帧循环（:55208-55218；draw fIdx 选择器消费） */
  f467Frame = 0;
  private f467FrameT = 0;
  /** 522 子蛇 ai[1] 计数（>40 Kill + 尘 scale 衰减 num7=(60−ai1)/60 :38428-38433） */
  private sn522Ai1 = 0;
  /** 316 蝙蝠杖出生基准速（ctor 快照——兄弟弹散布叠加基准,原版 num4/num5） */
  private batBaseVx = 0;
  private batBaseVy = 0;
  /** 294 暗影束：localAI[0] 子步龄 / localAI[1]/[2] 束段锚点（:28609-28613 +
  *  HandleMovement :18976-19013 编排束消费） */
  private sbL0 = 0;
  private sbAx = 0;
  private sbAy = 0;
  /** 296 地狱火叉爆区：ai[0]（+4/update,>540 Kill ≈135t 存续 :28776-28790）+
  *  Item74 点火吼单次门（localAI[0]==0 :28772-28775） */
  private if296Ai0 = 0;
  private if296Sounded = false;
  /** 511-513 毒云：ai[0] 存续计数（>260 Kill :33168-33177）/ 自旋相位
  *  （rotation = 相位 + t×2π/480 :33192-33194） */
  private cloudT = 0;
  private cloudPhase = 0;
  /** ★2026-08-31 云间互斥推挤用 whoAmI 序（ctor 自增,Main.projectile 槽位等价物）：
   *  原版 P.cs:33237-33245 重合零向量按 num797<whoAmI 定向——实例序仅作稳定性断向,
   *  非数值面 */
  cloudWho = 0;
  /** 337 固定起始帧（发射侧 ai[1]=rand.Next(5)，AI 不推进 :57927） */
  pinFrame: number | null = null;
  /** usesIDStaticNPCImmunity 组共享免疫键（非 null = 启用；511-513 毒云
   *  UseGroupStaticImmunity(511) :10678-10687——三型共用一张表,重叠不叠伤） */
  idStaticGroup: number | null = null;
  /** 组共享免疫冷却 tick（idStaticNPCHitCooldown；毒云/蜂族/黄蜂 10t——★BJ704-G10
   *  墙钟 ms 基数退役,GTW tick 钟,MinionProj.IdStaticBucket 同语义姊妹字段） */
  idStaticCdTicks = 10;
  // ---- ★R29 幻象弓载体 630 / 追踪矢 631（红队 §1）----
  /** 630 载体控制面（Game 注入：channel 电平/瞄准点/volley 弹药解析;null = 非 630
   *  或敌侧来源）。行为块 = AI_001 type==630 支 Projectile.cs:68194-68295 */
  ph630Ctl: Phantasm630Ctl | null = null;
  /** 630 ai[0] 计龄（加速窗档位 40/80/120 → interval 24/22/20/18） */
  private ph630Age = 0;
  /** 630 ai[1] volley 倒计时（出生 0 → 首拍即触发一轮） */
  private ph630VolleyCd = 0;
  /** 630 soundDelay 音效节拍器（首拍 ai0==1 豁免,Item_5 每 interval 拍） */
  private ph630SndCd = 0;
  /** ★BJ704-G2（债③）：630 localAI[0] 枪口闪光计数（:68236 音拍置 12、:68225-68228
   *  逐 update −1;可见窗 (0,6] → Extra_65 帧行 6−c∈[0,5],>6 钳顶行全透不可见） */
  private ph630Flash = 0;
  /** 631 ai[0] 受害者（Enemy.id;−1 = 目标失效态） */
  ph631Tgt = -1;
  /** 631 ai[1] 错峰延迟（命中侧补刀三连 0/15/30——延迟期 velocity=Zero 定身） */
  ph631Delay = 0;
  /** 819 血箭 localAI[0] 首拍尘爆闸（DrawProj :57371-57381 出生 8×d5 单次） */
  private bArrow819Born = false;
  /** 469 蜂箭渐显计数（localAI[1],>2 后 alpha−=50/update :56164-56174） */
  private ph469T = 0;
  // ---- ★2026-09-02 观感面缺口批（AI_001 出膛/尾迹 FX 清偿）配套态 ----
  /** 374 随从蜂刺 localAI[0] 出生音闸（:56511-56515 首拍 Item_17 后置 1）。
   *  ★与 MinionProj.MINION_SHOT_SFX[374] 出膛音原版同拍双播（AI_062 射出站点 +
   *  AI_001 首子步各一次）——非重复登记,原版即两响叠声 */
  private hornetSndL0 = 0;
  /** 376 随从鬼火 localAI[0] 计数（:56525-56531 首拍音不置位、逐子步自增;
   *  >3 起每子步 1 枚 d6、>5 起 2 枚;同上与 MINION_SHOT_SFX[376] 同拍双播） */
  private impFlameL0 = 0;
  /** 1097 火绒狐火球 localAI[0] 出生门（:57514-57534——首子步 Item_20 +
   *  DD2_BetsyFireballShot + 10×(d6 双尘) 一次性;ai[1]==2 拆分子弹不复播,本仓
   *  生成面 ai[1]≡0 恒过门） */
  private foxL0 = 0;
  /** 1097 oldPos 环（TrailingMode 0 每 tick 后移 :17202-17206,10 槽=20 数）——
   *  :57558 d55 尾迹读 oldPos[9]（=10 tick 前出生位）,环未满（前 9 tick）不撒 */
  private foxTrail: number[] = [];
  /** ★BJ219 通用 oldPos 残影环（ProjectileID.Sets.TrailingMode 表驱动——
   *  Projectile.cs:17197-17300 记录面;Main.cs:30609-31360 绘制面）。undefined=未
   *  初始化,null=该 id 无记录式或缺省排除面（projGhostTrail.ts 头注排除集——本仓
   *  已有独立记录/绘制实现的 id 不双画）。 */
  private ghostRing?: ProjGhostRing | null;
  /** 本子步是否 tick 首（mode 4 玩家位移补偿只在 numUpdates==0 施加 :17283） */
  private subIsHead = false;
  /** ★BJ219 记录排除集：本仓已有独立 oldPos 记录/绘制实现,通用环不双记不双画
   *  （普查定谳见 projGhostTrail.ts 头注「排除面」）。★BJ235：1020/1024 出排
   *  （绿带绘制面 drawGreenBandTrail 已落地,记录面走通用环;1026 本就不在排）——
   *  79 记录面在原版有消费面（:33234 辉光门）但本仓未实装对应绘制,维持不白记。 */
  private static GHOST_RECORD_EXCLUDE = new Set<number>([
    660, 94, 1114, 502,                    // Arrow 内联残影（starTrail/meowTrail）
    121, 122, 123, 124, 125, 126, 597, 1120, 34, 16, 79, 106,   // 弦带 shader 族
    933, 1100, 973,                        // SwingArc 斩弧剑族（mode4 环已落）
    1047, 1090,                            // RollingBoulder trailX 环
    466, 580,                              // LightningBoltProj 闪电链
    715, 716, 717, 718,                    // Celeb2 烟花链（Celeb2.ts 自管环+链面,BJ235 落地）
    946,                                   // MinionProj 自带 mode2 环（SW-BJ56）
  ]);
  /** 712 书杖弹帧（frame/frameCounter :56664-56678——draw fIdx 链消费;
   *  两带各 4 帧:出生 α==255 拍 frame=rand(2)*4 选带,每 4 子步 +1,带内回绕） */
  private f712Frame = 0;
  private f712FrameT = 0;
  /** ★R29 幻象弓 phantasmTime 窗口（静态时间戳,ms）：630 载体每子步续窗
   *  （player.phantasmTime=2 :68239）;命中侧补刀链消费（:13935）。33ms ≈ 2t */
  static phantasmWindowUntil = 0;
  /** 命中侧补刀窗口判活（Date/perf 时钟;载体在场即真） */
  static phantasmWindowActive(): boolean {
    return typeof performance !== 'undefined' && performance.now() < Arrow.phantasmWindowUntil;
  }
  // ---- 409 剃刀台风（aiStyle 71 :30848-30951，2622 剃刀台风）----
  /** ai[0] 一次性锁敌（npc 索引+1；0 = 未锁；本仓存 Enemy.id，0 未锁） */
  private ty409Ai0 = 0;
  /** localAI[0] 锁敌冷却（未锁时 30 update 一搜，:30907-30910） */
  private ty409Cd = 0;
  /** ★BJ371 localAI[1] 节拍计数（每 AI 子步 +1 :30849；>10 且 1/3 掷开出旋/尘/
   *  α/帧/光块 :30850-30882） */
  private ty409L1 = 0;
  /** ★BJ371 绘制帧 = (int)(localAI[1]/3f)%3（:30879——触发位写入;draw fIdx 链+
   *  残影 frame 消费;触发前恒 0=原版 proj.frame 初值） */
  private ty409Frame = 0;
  // （★BJ371 自报点光复用既有 lightRGB 字段（:30881 AddLight(0.1,0.4,0.6)——
  //  触发位置位后常驻=稳态等价原版 ~1 触发/帧 连续加光））
  // ---- 451 涌流剑（aiStyle 81 :31541-31760，2880 涌流剑）----
  /** ai[0] 状态机：0=飞行（0↔75 alpha 脉动）/[1,1+pen)=命中后淡出+寻的瞬移/
   *  [1+pen,1+2pen)=末段淡出可伤（ai[1]<5 期豁免）。命中钩：0→+pen，否则 −(pen+1) */
  iwAi0 = 0;
  /** localAI[0]：飞行期节拍（>7 起脉动）/淡出期清零 */
  private iwL0 = 0;
  /** localAI[1]：飞行期脉动相（0=渐隐 1=渐显） */
  private iwL1 = 0;
  /** ai[1]：末段 15 update 计数（命中/撞块钩清零，:14121/:18225） */
  private iwAi1 = 0;
  /** 451 淡出期骑乘目标（≤250 无视线最近敌，position += npc.velocity :31682） */
  private iwRide: { id: number; vx: number; vy: number } | null = null;
  /** 451 骑乘目标中心（瞬移重射用） */
  private iwRideTarget: { cx: number; cy: number } | null = null;
  // ---- 617 星璇秘术（aiStyle 118 :35283-35455，3476 星璇秘术）----
  /** ai[0] 相位计数（减速段 ≥30 起 ×0.98；速度 <4.1 归一 4 并清零重计；
   *  慢速段 %30==0 且 <241 掷 618、≥600 Kill） */
  na617Ai0 = 0;
  /** ai[1] 锁敌（本仓存 Enemy.id，0 未锁；失效清锁重搜 :35417-35427） */
  private na617Ai1 = 0;
  // ---- 618 星璇火花（aiStyle 119 :35458-35540，617 伴生隐形伤弹）----
  /** 父 617 引用（null = 非 618 路径）；父亡即 Kill（:35475-35478） */
  naParent: Arrow | null = null;
  /** 父中心 1/2 update 前快照（骑乘 = 父【2 拍】位移 :35483-35486 `position −
   *  oldPos[1]`，oldPos[1] = 父 TrailingMode 0 缺省环滚 2 拍前位 :17199-17203） */
  private naLastPX = 0;
  private naLastPY = 0;
  private naPrevPX = 0;
  private naPrevPY = 0;
  /** ai[0]（≥420 停止骑乘，:35479-35481） */
  private naAi0 = 0;
  // ---- 620 星云奥秘爆裂碎片（aiStyle 29 GemStaffs type 支 :38357-38387）----
  /** ai[0] = 尾迹/Kill 尘色键（父球 Kill 掷定 86|90 二选一,双子环互补 :73631-73633） */
  na620Dust = 86;
  /** ai[1] 计龄（>40t Kill :38361-38363） */
  private na620Ai1 = 0;

  /** 451 ≤250 寻的 + 骑乘（:31649-31661/:31707-31725）：无视线门最近 CanBeChasedBy，
   *  命中即 position += npc.velocity（随敌漂移）；存中心供瞬移重射 */
  private iwSeek451(game: GameHooks, range: number): void {
    let best = range;
    let found: { id: number; cx: number; cy: number; vx: number; vy: number } | null = null;
    for (const ent of game.enemies()) {
      const e = ent as unknown as { id: number; x: number; y: number; w: number; h: number; dead?: boolean; vx?: number; vy?: number };
      if (e.dead) continue;
      if (!canBeChasedBy(ent)) continue;
      const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
      const d = Math.hypot(cx - this.cx, cy - this.cy);
      if (d >= best) continue;
      best = d;
      found = { id: e.id, cx, cy, vx: e.vx ?? 0, vy: e.vy ?? 0 };
    }
    if (found) {
      this.iwRide = { id: found.id, vx: found.vx, vy: found.vy };
      this.iwRideTarget = { cx: found.cx, cy: found.cy };
      this.x += found.vx;                                  //（:31682/:31722 position += npc.velocity）
      this.y += found.vy;
    } else {
      this.iwRide = null;
      this.iwRideTarget = null;
    }
  }

  /** 451 命中钩（Damage :14115-14121）：ai[0]==0 → += pen，否则 −= pen+1；ai[1]=0 */
  private iwOnHit(): void {
    const pen451 = Math.max(1, this.pierceInit);
    if (this.iwAi0 === 0) this.iwAi0 += pen451;
    else this.iwAi0 -= pen451 + 1;
    this.iwAi1 = 0;
  }

  /** 451 可伤门（Damage_CanDealDamage :12463 `451 && ((ai[0]-1)/pen==0 || ai[1]<5)
   *  && ai[0]!=0` → 豁免）：飞行态恒可伤；淡出态 [1,1+pen) 恒豁免；末段前 5 拍豁免 */
  private iwCanDamage(): boolean {
    if (this.iwAi0 === 0) return true;
    const pen451 = Math.max(1, this.pierceInit);
    if (this.iwAi0 >= 1 && this.iwAi0 < 1 + pen451) return false;
    if (this.iwAi0 >= 1 + pen451 && this.iwAi0 < 1 + 2 * pen451) return this.iwAi1 >= 5;
    return true;
  }
  // ---- 92 坠星（aiStyle 5 + Kill 91/92 共段）----
  /** ai[1] 命中线 Y（弹顶越过才恢复撞块；-Infinity = 非坠星路径） */
  starFallLine = -Infinity;
  /** ai[0] 代际（1 = 圣箭直系可再链一代；孙代 0 不链） */
  starFallGen = 0;
  /** aiStyle5 通用闪烁档相位（localAI[0]：1=升 0→200 / -1=降 200→0，:22222-22238） */
  private twinkleDir = 1;
  /** aiStyle5 Item_9 星啸节拍器（soundDelay = 20+rand(40)，:22166-22172） */
  private starSndCd = 0;
  // ---- 食人鱼 190（aiStyle 39，Projectile.cs:27907-28173）专属态 ----（★BJ386 2026-09-28 全块行号按 1457 勘误，旧值系 1456 世代）
  /** 非空 = 食人鱼状态机激活（fixedUpdate 直入 piranhaStep） */
  piranha: PiranhaCtl | null = null;
  /** alpha（SetDefaults :2788 = 255；AI :27909 每 tick −50，6t 淡入归零） */
  pAlpha = 255;
  /** ai[0]：0=直飞（:28103 分支）/ 1=返回玩家（:28121 分支） */
  pAi0 = 0;
  /** ai[1]：0=未咬（命中即咬 :13270-13274）/ >0=咬住目标 / −1=松手禁再咬（:27951-27954） */
  pAi1 = 0;
  /** 咬住目标（vanilla 存 npc index+1，此处直接持引用 + 每 tick 校验存活） */
  pTarget: PiranhaTarget | null = null;
  /** localNPCImmunity 同敌冷却表（SetDefaults :2791 = 14t，:14175-14178 命中写入） */
  private pHitCd = new Map<number, number>();
  /** 帧推进计数 / 当前帧（:28159-28168：4t/帧 4 帧循环——draw 侧消费） */
  pFrameCounter = 0;
  pFrame = 0;
  /** 姿态角（未镜像系 atan2(vy,vx)）与翻转位（spriteDirection<0）——咬住时
   *  velocity 已清零，atan2(0,0) 会把鱼掰回 0°，故由 AI 侧在清速前记录（:27976-28015） */
  pRot = 0;
  pFlip = false;
  /** 出生弹速（ItemCheck_Shoot num4/num5 模长 = item.shootSpeed 14）——补弹复用 */
  pShootSpeed = 0;
  // ---- 329 焰镰（aiStyle 56）/ 351 礼盒（aiStyle 58）专属态 ----
  /** tileCollide=false（跳过撞块/CutTiles） */
  noTileCollide = false;
  /** 焰镰恒旋累积角（出生 = 发射者 rotation） */
  scytheRot: number | null = null;
  /** 焰镰 spriteDirection（<0 时贴图水平镜像） */
  scytheFlip = 1;
  private scytheInit = false;
  /** 礼盒两段重力状态机（0=前段平飞/1=下落段）+ ai[1] 计时 + 淡入 alpha */
  present = false;
  presentStage = 0;
  private presentT = 0;
  private presentAlpha = 255;
  // ---- 452 幻影矢（aiStyle 82）/ 454 幻影能量球（83）/ 1021 巨砾（25）/
  //      448 火箭（80）专属态（2026-08-19 月总/火星/Betsy 弹道批）----
  /** 452 弹道激活 */
  phantasm = false;
  /** 452 ai[1] 弧线弯转角（进 2 段 = FindClosest 玩家索引，单人恒 0 = 旋转恒等） */
  private phSpin = 0;
  /** 452 ai[0] 段号（0/1 上升弧线、2 追踪） */
  private phStage = 0;
  /** 452 localAI[0] 段内计数（0 段 45t / 1 段 90t） */
  private phT = 0;
  /** 452 alpha（255 起 −40/t 渐显；draw 消费） */
  phAlpha = 255;
  /** 454 归巢球激活 */
  phantomOrb = false;
  /** 454 ai[0]：≥0 计数（0..29 随行 / ≥30 列队）、−1 齐射态（帧 1+双步） */
  orbAi0 = 0;
  /** 454 归属 NPC id（ai[1]=whoAmI 语义——齐射指令按 ownerId 圈定己方球） */
  orbOwnerId = 0;
  /** 454 帧（0/1：列队每 6t 切换 / 齐射恒 1） */
  orbFrame = 0;
  private orbFrameT = 0;
  /** 454 alpha（255 钳 200 −5/t；scale = 1−alpha/255 随之伸展） */
  private orbAlpha = 255;
  /** 454 父体消失后的冻结锚（原版 npc 槽位数据残留语义——不消亡只停驻） */
  private orbAnchor: { x: number; y: number } | null = null;
  /** 1021 月总巨砾激活 */
  mlBoulder = false;
  /** 1021 localAI[1]：X 反弹计数（>3 消亡；轻落置 999 = rest 标） */
  private boulderBounces = 0;
  /** localAI[1] 镜像（镖族 267/477/478/479 的分裂计数/放火节拍 :58273-58345、
   *  1023 首拍旗 :56175——各弹互斥使用,479 分裂子镖注入 -1000 = 已分裂不再分） */
  ai1Mirror = 0;
  /** 639 月总箭 Kill 衍生初态四槽（P.cs:56381-56386 localAI[0]/[1]=出生 Center 快照、
   *  ai[0]/[1]=初速快照,零零门首拍写入）——Kill :74825 owner 侧 NewProjectile(640)
   *  的出生位/初速数据源（Kill 消亡面批 2026-09-02） */
  moonArrowL0 = 0;
  moonArrowL1 = 0;
  moonArrowA0 = 0;
  moonArrowA1 = 0;
  /** 640 ai[1] 延迟计数镜像（Projectile.Update :16784-16787 子步循环顶
   *  `type==640 && ai[1] > 0` → ai[1]-- + continue = 整【子步】冻结；值 = 639 Kill
   *  num391 = timeLeft+1（:74826）+ 同轮更新补偿（:74828-74830）。消费闸在
   *  fixedUpdate 子步循环（Kill 消亡面批 2 2026-09-02 实装） */
  ai1Delay = 0;
  /** 1097 ai[1] 镜像：1113 生成端 ai[1]=3/1（Projectile.cs:62750-62757——num159=3、
   *  localAI[2]<=-3 回卷掷 1）→ ai[1]==1 拆弹（AI 提前 Kill :58266 + Kill 8 分裂
   *  :75784）、==2 = 拆出子弹（免首拍音尘 :57515 + scale 钳 0.7 :57566）。
   *  MinionProj 生成面暂不注入（dormant 备案）——字段已备，注入即活 */
  foxAi1 = 0;
  /** 448 火箭激活 */
  martianRocket = false;
  /** ★BJ704-R3 P1②b 爆炸兔 281 ai[0] 镜像：-2=NPC 614 死亡爆弹形态（AI_049 头
   *  :28651-28656 hostile+Kill 即灭,载荷全在 Kill case 281=bunnyBlastExplode）;
   *  ≥0=物品投掷活兔跳跃态（兔炮 1338 弹药/物品面未实装=另刀）;−3=落定静默 Kill
   *  （:18945-18960 ReleaseNPC 后,无爆无 FX） */
  bunnyBlastForm = 0;
  /** 281 ai[1] 镜像 = releaseOwner+1（NPC 出生来源）：1=玩家释放（爆炸可炸释放者
   *  本人 :14873-77 ai[1]-1==myPlayer）;256=野兔（releaseOwner 255+1,不可炸玩家） */
  bunnyOwner = 0;
  /** 沙球族（aiStyle 10，42/65/68/354）激活——ctor 按 SAND_BALL_PROJ 自动置位 */
  sandBall = false;
  // ---- 信号枪族（aiStyle 33，AI_033 :27425-27498 + 撞块贴壁 :18731-18745）----
  /** 族激活——ctor 按 FLARE_PROJS 自动置位（163 信号枪 930 / 1009 诅咒信号弹 5378） */
  flare = false;
  /** ai[0]/ai[1] 姿态向量（非贴壁期每拍取当前速度；贴壁后冻结——draw 侧
   *  rotation = atan2(ai1, ai0)+π/2 :27497 消费，贴壁时 velocity 已清零） */
  private flareAi0 = 0;
  private flareAi1 = 0;
  /** localAI[0]：1 = 已贴壁停驻（撞块置 1 :18744；脱块回 0 + localAI[1]=30 :27480-27483） */
  private flareStuck = 0;
  /** localAI[1]：≥30 后每拍 vy+0.09（:27477-27482 自增后钳回 30 = 恒触发档） */
  private flareGravT = 0;
  // ---- 绳圈余料返还计数（aiStyle35 族，Projectile.cs:79303-79316 按 ai[1] 结算）----
  /** 已铺绳格数 ≡ 原版 ai[1]（AI_035 铺绳循环逐格 ++ :27699）；killNow 余料
   *  返还口消费——铺绳尾(:27720)与 timeLeft=400 到期(:17307-17311)在原版同达
   *  Kill() 单口，本仓对应 killNow 全路径 */
  private ropeAi1 = 0;
  // ---- 钉 514（aiStyle 93，钉枪 3107 弹，AI_093 Projectile.cs:33425-33487）----
  /** ai[0]：0 飞行（20t 后下垂）/ 1 撞块弹开（×0.6/t 衰减）/ <0 刺入敌体
   *  （= −(敌 id+1)，跟随敌心偏移 velocity） */
  nail93 = false;
  nailAi0 = 0;
  /** ai[1] 计时（飞行 20t 下垂门 / 刺入·弹开 90t 消亡门） */
  private nailAi1 = 0;
  /** 刺入 DoT 节拍（immune[owner]=1 档 :14060-14062 → 隔拍再刺） */
  private nailDotT = 0;
  /** 448 ai[0]（0 引信 / 1 点火追踪） */
  private rkAi0 = 0;
  /** 448 ai[1] 引信倒数（出生 20，:36099 NewProjectile 第 10 参） */
  private rkFuse = 20;
  /** 448 localAI[1] 点火后计时（==180 自毁） */
  private rkT = 0;
  /** 448 帧（3t/帧 3 帧循环）+ 帧计数 */
  rkFrame = 0;
  private rkFrameT = 0;
  /** AI_001 家族旗（ctor 按 SetDefaults aiStyle==1 置位）——尾 ±16 钳消费（R7-8） */
  aiStyleOne = false;
  dead = false;

  constructor(x: number, y: number, vx: number, vy: number, damage: number,
    knockback: number, projId = 1, opts?: ArrowOpts) {
    super();
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.knockback = knockback;
    this.projId = projId;
    this.manaStar = opts?.manaStar ?? false;
    // 判定盒/绘制 scale 按弹型取 SetDefaults（子弹 14 = 4×4 hitbox；箭 1 = 10×10）
    const pd0 = projectileData(projId);
    if (pd0?.width) this.w = pd0.width;
    if (pd0?.height) this.h = pd0.height;
    this.drawScale = pd0?.scale ?? 1;
    // 重力缺省 = AI_001 规格链（projGravSpec：箭 0.1@15 缓坠 / 子弹 flag3 直线 /
    // 686/711 两段式…）——未显式传 grav 的调用面（敌方箭/塔弹/同步复体）自动对齐；
    // 显式传 grav 的走调用方档（gravDelay 缺省回到 -1 无延迟，旧语义不回退）
    const spec0 = projGravSpec(projId);
    const gravExplicit = opts?.grav !== undefined;
    this.grav = gravExplicit ? opts!.grav! : spec0.grav;
    this.gravDelay = opts?.gravDelay ?? (gravExplicit ? -1 : spec0.delay);
    this.grav2 = opts?.grav2 ?? (gravExplicit ? 0 : spec0.grav2 ?? 0);
    this.grav2At = opts?.grav2At ?? (gravExplicit ? 0 : spec0.grav2At ?? 0);
    this.dragAlways = opts?.dragAlways ?? (gravExplicit ? 0 : spec0.drag ?? 0);
    // 1097 火绒狐火球（★2026-09-02 观感批顺带修复）：MinionProj 生成端
    // `grav: shooter.grav ?? 0` 对无 grav 键的 shooter 恒显式传 0 → 绕过规格链,
    // AI1_GRAV[1097]=[0.15,40]（:58255-58269 ai[0]≥40 后 vy+=0.15）在唯一生产路径
    // （Foxparks 1094/1113 射出）恒死键——显式 0 时回落规格链（显式非 0 的调用面不动）
    // ★BJ700-A（2026-10-20）同型扩员 408：MINION_SHOOT[407] 无 grav 键 →
    //   shootMinionShot 显式 0 → AI1_GRAV[408]=[0.05,45]（:58346-58351 ai[0]≥45 后
    //   vy+=0.05 缓坠）恒死键=鲨鱼龙直线飞不坠弧;回落规格链同式（407→408 唯一生产路径）。
    if ((projId === 1097 || projId === 408) && gravExplicit && this.grav === 0) {
      this.grav = spec0.grav;
      this.gravDelay = opts?.gravDelay ?? spec0.delay;
    }
    // ★BJ431：火花族 504/954/979（aiStyle 2 非投掷族——Projectile.cs:23764-23803 的
    //  type==504||954||979 支无通用重力,下坠只由 ai[0]≥20 后 AI 支内 vy+0.1 自管）。
    //  projGravSpec 的 aiStyle2 兜底档 0.3 是手里剑投掷族语义（AI_THROWN）,对魔法弹
    //  错位=出膛即 0.3/t 抛物坠弧（实报探针:954 age3 vy=0.69）；出生覆写 0,原版重力档
    //  在 subStepAI 火花族支内 1:1 重建
    if (projId === 504 || projId === 954 || projId === 979) {
      this.grav = 0;
      this.gravDelay = -1;
    }
    // 寿命表（修复2）：opts 显式优先 → SetDefaults timeLeft（vanilla-projectiles.json
    // 提取自 Projectile.cs SetDefaults）→ 缺省 3600（P.cs:789 复位;★R5 锚纠 1456→1457:
    // 5=120(:851)/478=300(:1779)/94=600(:5531)/639=90(:6884)）。逐型覆写：小丑箭
    // ★★★方法论（发射点覆写审计批 2026-09-03）：SetDefaults≠终值——原版 NewProjectile
    // 出膛链在 SetDefaults 之【后】还有三层覆写，任何按 json timeLeft 直取的弹都要对表：
    // ① NewProjectile 内联 per-Type 表（Projectile.cs:10971-11090，仅 Owner==Main.myPlayer
    //   生效=NPC 弹幕大多 owner=myPlayer 也吃表）：timeLeft——180:28/1077/516/519/30/517/
    //   37/773/75/133/136/139/142/397/588/777/781/785/788/791/794/797/800/903-906/910/911；
    //   300:29/470/637/1086/1087/443/1110；600:419-422/681；60:779/783/862/863/684；
    //   120:706；penetrate:680(侍从T2套装=7,:11083)；ai 掷:206(ai0/1 随机)·335/358/406
    //   (ai1 随机,实参丢弃)·434(ai=出生位);249 frame=rand5 在 owner 门【外】(:11095-11098
    //   无条件,★R5 归属纠：①表内条目均 owner=myPlayer 门内)；
    // ② NewProjectileModifiers 三权威（NewProjectileModifiers.cs,:11097 FinalizeProjectile 后
    //   调用=全链最后一写）：HardmodeDungeonSkeletonShot(290/291/293 timeLeft=300,发射点
    //   NPC.cs:21294/21298)/RainHazard(99/1013/1049 netImportant,WorldGen.cs:72263/72267/
    //   72292,单机无差已登记 Game.ts FTW 巨石雨)/IchorDartUpdatePenetrate(479 分裂子镖
    //   penetrate 钳 1,Arrow 479 支 pierce=1 承载)；
    // ③ 发射点直写 `Main.projectile[idx].x=`（NPC.cs 20 处 timeLeft=300 钉 + Player.cs/
    //   Projectile.cs damage/penetrate/maxPenetrate/ai/localAI/melee·ranged·magic 重标 +
    //   1110 30×Next(2,6) 等）——后写者胜,压过①②。
    // 本仓承载：GrenadeProj 引信(Game.ts grenade 支)/Dart 表 129·55/PROJ_LIFE 109·110/
    // PhoenixBowProj 706=120/ElectroSphereProj 443=300/SkyDragonFury 1110=30×Next(2,6)/
    // MinionProj 680 侍从T2 pierce=7/Dart fireworkFountain=600；金标=
    // tests/spawn-side-override-golden.test.ts（新增弹/重跑提取器前先对这张表）。
    this.life = opts?.life ?? pd0?.timeLeft ?? 3600;
    // 27 水矢 SetDefaults `timeLeft /= 2`（:1104）→ 3600/2=1800（提取器不建模表达式列,
    // 常量补——红队 R27 §6：曾 3600 寿命翻倍）。min 而非覆写：发射链显式传缺省
    // 3600（fireGemStaffBolts 表缺列兜底）时同样收敛到原版终值
    if (projId === 27) this.life = Math.min(this.life, 1800);
    // 22 水花权杖熔岩反弹种子（ai[2]，见字段注——Projectile.cs:24851 消费）
    if (projId === 22) this.waterStreamSeed = Math.floor(Math.random() * 20000);
    // 穿透表（修复1）：opts 显式优先 → SetDefaults penetrate → 缺省 1。−1 = 无限
    // （小丑箭 5(:594)/地狱火箭 41(:982)；命中侧按全局 immune 帧冷却再命中）
    this.pierce = opts?.pierce ?? pd0?.penetrate ?? 1;
    // alpha 初值（修复4，SetDefaults 逐型 PROJ_ALPHA0）
    this.alpha = PROJ_ALPHA0[projId] ?? 0;
    // 424-426 流星弹 scale = ai[1]（AI_001 type≥424&&≤426 支 :58019，1458 同值 :58020
    // `scale = ai[1]`）。发射侧流星法杖 2750 = Player.cs:48153【11 参调用】→
    // NewProjectile(:10864) 第 10/11 参 = ai0=0f、ai1=0.5+rand×0.3，ai2 缺省 0。
    // ★R3 翻案(2026-09-03)：台账「2750 施法尾参 ai2=0.5+rand×0.3 → 随机 PhoenixQuivered
    // 位」系参数位误读——AI_001_Features(Projectile.cs:241-289) 只解 ai[2]（bit0
    // HarpyCharmed/bit1 Consumed/bit2 PhoenixQuivered/bit3 Seraph），ai[2]=0 →
    // StatusNPC 323 300t(:11179-11182，在 Projectile.cs 非 NPC.cs)/凤凰尘(:54961-54969)/
    // GetAlpha 白(:80607-80613) 对 424-426 恒不可达；凤凰位唯一置位端 = ApplyHarpyCharm
    // item 6181(:58788-58791)，本仓 applyHarpyCharm(6181)+命中消费(phoenixQuivered →
    // onFire3T=5s) 已接。本仓发射点未注入 ai1 → ctor 同分布掷定；族三型全覆盖
    // (曾只 424 → 425/426 scale 恒 1，视觉偏大 25-100%)
    if (projId >= 424 && projId <= 426) this.drawScale = 0.5 + Math.random() * 0.3;
    // 374 黄蜂毒刺 scale ×0.9（SetDefaults :4586 `scale *= 0.9f`——提取器漏 scale 列,
    // 常量补;蓝队 R7-27：曾 drawScale 恒 1,毒刺视觉大 11%）
    if (projId === 374) this.drawScale = 0.9;
    // ★BJ643①：1001 南瓜弹（SetDefaults :9518 `scale = 1f + Main.rand.Next(51)*0.01f`
    //  ∈ {1.00..1.50} 离散档——Projectile.scale 纯绘制字段不缩判定盒（P.cs:322 直写字段）,
    //  drawScale 通道同语义;提取器表达式列未提取,发射位同分布掷定）
    if (projId === 1001) this.drawScale = 1 + Math.floor(Math.random() * 51) * 0.01;
    // NewProjectile 出生速钳（Projectile.cs:10259-10267）：aiStyle 1 弹逐轴 |v|≥16
    // → 双轴 ×0.97 收敛（注意原版负 vy 侧无等号：vy < −16 才收）
    if ((pd0?.aiStyle ?? -1) === 1) {
      this.aiStyleOne = true;
      let guard = 0;
      while (guard++ < 512 && (this.vx >= 16 || this.vx <= -16 || this.vy >= 16 || this.vy < -16)) {
        this.vx *= 0.97;
        this.vy *= 0.97;
      }
    }
    // 485 狱翼箭出生游移（Player.cs:47992-48000 炼狱天弓 3019 专支；旧注 :46934 失真）：
    // ai[0]/ai[1] = num4/num5(已 ×num6 归速 :47716) RotatedByRandom(0.39269909262657166)
    // （±π/8）、实际初速 = 同基向 RotatedByRandom(0.19634954631328583)（±π/16）——
    // AI 侧 v=(v×39+ai)/40 即朝游移向量渐转（:54828-54829）。Game 发射点
    // 未注入 ai，ctor 内同分布自掷（424 流星弹 scale 同先例）
    if (projId === 485) {
      // ★B1(2026-09-02 对齐 Utils.RotatedByRandom,Utils.cs:1785-1788):角度 =
      // 两次独立 U(0,max) 之差 = 【三角分布】(峰在 0),非均匀(曾用 (rand×2−1)×max
      // 均匀,方差 ×1.414 发散)。全仓首个 RotatedByRandom 对齐点。
      // ★R1(2026-09-03):字面量对齐反编译终值 0.39269909262657166/0.19634954631328583
      // (Player.cs:47993/47996 RotatedByRandom 实参;曾用 π/8·π/16 截断值,差 ~1.1e-8
      // rad 无观察差,hellwing-cast 测试 AI_MAX/SPAWN_MAX 已同步)
      const a485 = (Math.random() - Math.random()) * 0.39269909262657166;
      const c485 = Math.cos(a485), s485 = Math.sin(a485);
      this.hwAiX = this.vx * c485 - this.vy * s485;
      this.hwAiY = this.vx * s485 + this.vy * c485;
      const b485 = (Math.random() - Math.random()) * 0.19634954631328583;
      const c2b = Math.cos(b485), s2b = Math.sin(b485);
      const rvx = this.vx * c2b - this.vy * s2b;
      const rvy = this.vx * s2b + this.vy * c2b;
      this.vx = rvx;
      this.vy = rvy;
    }
    // 496 暗影炎箭摆动参挂账（Player.cs:47989 NewProjectile 尾参 ai0=X 加速/ai1=Y
    // 加速——Game 3053 施法支按原版掷序传入,精确发清零）。X 走既有 opts.ai0 槽
    // （88 激光支的 extraUpdates 消费在其 projId===88 门内,496 写入的 hostileAi0
    // 同值只作台账零消费）;Y=本批新增 opts.ai1 槽（R2 批 2026-09-03）
    if (projId === 496) {
      this.sf496Ai0 = opts?.ai0 ?? 0;
      this.sf496Ai1 = opts?.ai1 ?? 0;
    }
    // ★BJ704-G10（件10）：459 充能爆破炮弹 ai[1] 蓄压档注入（NewProjectile 尾参
    //  num35 :67574;PrismProj ChargedBlaster fire 按 stage 传 0.7/1.0/1.3——
    //  subStepAI 459 支每子步 Clamp(0.7,1.6) 消费;缺省 0=外源直构防御档）
    if (projId === 459) this.ai1Scale459 = opts?.ai1 ?? 0;
    // 1457 FinalizeProjectile_GemStaves（:22259-22296）：特性穿透/穿甲/timeLeft 终值化
    if (opts?.gem) {
      this.gem = opts.gem;
      if (opts.gemPhase) this.gemPhase = opts.gemPhase;   // 孪生弹反相（:49924-49926）
      let addPen = 0;
      let addArpen = 0;
      if (opts.gem.fastThenSlow) { addPen = Math.max(addPen, 1); this.life *= 2; }
      if (opts.gem.canBounce) addPen = Math.max(addPen, 2);
      if (opts.gem.biggerHitbox) addPen = Math.max(addPen, 1);
      if (opts.gem.arPenSpread) addArpen += 4;
      if (opts.gem.allGems) { addPen = 2; addArpen = 4; this.life = 90; }
      this.pierce += addPen;
      this.armorPen += addArpen;
    }
    this.pierceInit = this.pierce;
    this.hostile = opts?.hostile ?? false;
    this.bounce = opts?.bounce ?? false;
    this.thornBounce = opts?.thornBounce ?? false;
    this.skullBoneT = opts?.skullBone ? 1 : 0;
    this.homing = opts?.homing ?? null;
    if (opts?.aimPoint) this.aimPt = opts.aimPoint;
    // 442 缺省 ai[0]/[1] = 0（NewProjectile 缺省实参）→ 锁定点 (8,8)——原版语义
    // （发射侧 2796 恒显式传 tileTarget，此兜底仅覆盖非常规来源）
    if (projId === 442 && !this.aimPt) this.aimPt = { tx: 0, ty: 0 };
    this.extraUpdates = opts?.extraUpdates ?? pd0?.extraUpdates ?? 0;   // 子弹 14=1(2 步/tick)、高速弹 207=2
    this.hostileAi0 = opts?.ai0 ?? 0;                                   // F7：敌方生成侧 ai[0]（88 支直写消费,缺省 0 空转）
    this.localImmune = pd0?.localNPCHitCooldown ?? 0;
    // 311 糖果玉米 usesLocalNPCImmunity+localNPCHitCooldown=10（SetDefaults
    // :4047-4048，提取器漏提两列 → 常量补；同敌 10t 冷却再命中）
    if (projId === 311) this.localImmune = 10;
    // 出生预置局部免疫（localNPCImmunity[target]=N——花瓣 1038 = 30t,见 opts 注）
    if (opts?.localImmuneSeed) this.spawnImmuneCd.set(opts.localImmuneSeed.npcId, opts.localImmuneSeed.t);
    this.drag = opts?.drag ?? 1;
    this.maxFall = opts?.maxFall ?? 16;
    this.tumble = opts?.tumble ?? false;
    this.tumblePoseLock = opts?.tumblePoseLock ?? false;
    this.terra = !!opts?.terra;
    if (projId === 684) { this.dragonFade = true; this.dragonAlpha = 255; }
    if (projId === 711) { this.dragonFade = true; this.dragonAlpha = 255; this.betsyCurse = true; }
    if (projId === 261) this.boulder = true;
    if (opts?.terra) {
      this.terraAi0 = opts.terra.ai0;
      this.terraAi1 = opts.terra.ai1;
      this.terraAi2 = opts.terra.ai2;
    }
    if (opts?.star) {
      this.starY = opts.star.targetY;
      // 斗篷星族起步 α=50（SetDefaults :7655,PROJ_ALPHA0 表注入）;503 星怒星无键 →
      //  保持缺省 255（SetDefaults :5750 alpha=255）
      this.starAlpha = PROJ_ALPHA0[this.projId] ?? this.starAlpha;
    }
    // tileCollide=false：显式优先，缺省按 SetDefaults 数据表（325/329/348/350/351…）
    if (opts?.noTileCollide !== undefined) this.noTileCollide = opts.noTileCollide;
    else if (pd0?.tileCollide === false) this.noTileCollide = true;
    if (opts?.scythe) { this.scytheRot = opts.scythe.rot0; this.scytheFlip = opts.scythe.flipDir; }
    this.present = !!opts?.present;
    // 452/454/1021/448 per-proj 档（skullBone 同模式：opts 激活 + subStep 消费）
    if (opts?.phantasm) { this.phantasm = true; this.phSpin = opts.phantasm.spin; }
    // ★尘站普查批（2026-09-16）：873 光鞭 Kill 尘色的 ai[1] 通道（发射点注入
    //  NPC.ai[1]/60,P.cs:46790——AI_171_GetColor :46398 hue=(ai[1]+0.5)%1）
    if (opts?.empressHue !== undefined) this.empressHue = opts.empressHue;
    if (opts?.phantomOrb) {
      this.phantomOrb = true;
      this.orbOwnerId = opts.phantomOrb.ownerId;
      this.orbAi0 = opts.phantomOrb.ai0 ?? 0;
    }
    this.mlBoulder = !!opts?.mlBoulder;
    this.martianRocket = !!opts?.martianRocket;
    // 沙球族自动激活（SetDefaults aiStyle 10 表驱动，无需 opts 注入）
    this.sandBall = SAND_BALL_PROJ.has(projId);
    // 信号枪族自动激活（SetDefaults aiStyle 33 表驱动：163 :2517-2526 等）
    this.flare = FLARE_PROJS.has(projId);
    // 钉自动激活（SetDefaults aiStyle 93 :5843-5852，钉枪 3107 / 钉弹 3108 shoot）
    this.nail93 = projId === 514;
    // ---- 绳圈弹出生自校正（aiStyle35 族 171/475/505/506，2026-08-30 工单1）----
    // ① 通用投掷出口按 aiStyle2 抛物档传参(grav0.4@20/terminal32/tumble)——对
    //   aiStyle35 弹逐项覆写原版档(AI_035 :27581-27590：ai0>30 后 vy+0.2、vx×0.985、
    //   vy 终端 14；无翻滚)。AI1_GRAV 表已有同值四条目,但发射链显式 grav 覆盖了它。
    // ② SetDefaults tileCollide=false(:2572-2579)仅指【通用位移】,AI 自带
    //   Collision.TileCollision 撞块检测(:27602 flag14)=可撞块——本仓铺绳支挂在
    //   实心命中块内,数据表置 noTileCollide=true 会把整段变死代码(实测 171/475/
    //   505/506 全被排除零铺绳),此处恢复碰撞参与
    if (ROPE_COIL_TILE[projId] !== undefined) {
      this.noTileCollide = false;
      this.grav = 0.2;
      this.gravDelay = 31;             // ★A 簇审计:原版门严格 >30(P.cs:27581),本仓消费面 >= → 等价存 31
      this.drag = 0.985;             // :27585 velocity.X *= 0.985f（与重力同一门内生效）
      this.maxFall = 14;
      this.tumble = false;
    }
    if (opts?.starFall) {
      this.starFallLine = opts.starFall.lineY;
      this.starFallGen = opts.starFall.gen ?? 0;
    }
    if (opts?.piranha) {
      this.piranha = opts.piranha;
      this.pShootSpeed = Math.hypot(vx, vy);   // Game 侧可覆写为精确 shootSpeed
    }
    // 荆棘链族自动激活（SetDefaults aiStyle 4：7/8 :876-887 / 150-152 :2400-2412——
    // alpha=255 渐显起点 + tileCollide=false 穿墙 + penetrate=-1 已由数据表承载）
    this.thornChain = THORN_CHAIN_PROJS.has(projId);
    if (opts?.thornChainAi1) this.thornAi1 = opts.thornChainAi1;
    // ---- ★R28 中期魔法族激活（发射链挂点在 Game.ts,实体侧出生自校正/专属 AI）----
    // ★birthLock：兄弟弹生成期间不再自挂 pending（否则每枚兄弟弹首子步再次
    // 展开 = 指数弹幕爆炸,探针实证过的坑）
    // 336 松针弹：梯次扇自校正挂起（仅玩家弹——敌侧 336 无此几何）
    if (projId === 336 && !this.hostile && !Arrow.birthLock) {
      this.rp30Pending = true;
      // 发射侧 ai[0] 初值 rand(0,10(i+1))（Player.cs:48085 aiArgs1）→ 重力门
      // 50−init 子步前移；本弹 = i=0 档 rand(0,10)
      this.gravDelay = Math.max(1, 50 - Math.floor(Math.random() * 10));
    }
    // 337 暴雪雪片：天顶双锥几何自校正 + 固定起始帧（ai[1]=rand.Next(5) :48115）
    if (projId === 337 && !this.hostile && !Arrow.birthLock) {
      this.blz337Pending = true;
      this.pinFrame = Math.floor(Math.random() * 5);
    }
    // ★2026-09-01 批四（T2）：968 气喇叭弹静态随机帧——生成侧 ai[1]=
    //  Main.rand.Next(Main.projFrames[968]=24)（Player.cs:48064，NewProjectile 第 9 参
    //  aiArgs[1]），AI 全程只读（frame=(int)ai[1] P.cs:23430，无人递增）= 整生命周期
    //  恒定随机帧（24 变体抽签，非逐帧动画；Main.cs:8845 projFrames[968]=24 是帧总数）。
    //  渲染链 pinFrame!==null 早于 age 档（337 同款模式）——Game.ts 旧
    //  `age=rand*24*5` 相位注入自此退役为冗余（库外文件不删；对 968 残余效应仅
    //  mp 拖尾 age<30 可视窗）
    if (projId === 968) {
      this.pinFrame = Math.floor(Math.random() * 24);
    }
    // 316 蝙蝠杖蝠：2-3 只散布自校正（:48820-48830 num124=rand.Next(2,4)）
    if (projId === 316 && !this.hostile && !Arrow.birthLock) {
      this.bat316Pending = true;
      this.batBaseVx = vx;
      this.batBaseVy = vy;
    }
    // 659 灵魂之焰：悬浮出生态自校正（ctor 快照基准向——Game 以 aim×3 直射出膛,
    // 原版方向=全圆随机 CanHit 试选、速度归零 :49297-49310）
    if (projId === 659 && !Arrow.birthLock) {
      const l659 = Math.hypot(vx, vy);
      if (l659 > 0.01) { this.sf659DirX = vx / l659; this.sf659DirY = vy / l659; }
      this.sf659Birth = !this.hostile;
    }
    // 511-513 毒云泡：aiStyle92 AI 头 tileCollide=false 每 update 直写（1458
    // P.cs:33159）+ UseGroupStaticImmunity(511)=IDStatic 共享免疫 10t（三型调用处
    // :5816/:5828/:5840,方法体 :10678-10683——提取器未建模该两列,常量补）。
    // whoAmI 序（全场唯一自增）供云间互斥推挤重合零向量断向 :33237-33245
    if (projId >= 511 && projId <= 513) {
      this.noTileCollide = true;
      this.idStaticGroup = 511;   // 组共享免疫键（命中环 idStaticCheck(511,…) 消费）
      this.idStaticCdTicks = 10;  // idStaticNPCHitCooldown=10t（★G10 tick 基数）
      this.cloudPhase = Math.random() * Math.PI * 2;
      this.cloudWho = ++Arrow.cloudWhoSeq;
    }
    // 181/566 蜂族：UseGroupStaticImmunity(181)（SetDefaults type==181 两版同段
    // :2680-2688 / type==566 两版同段 :6177-6186,方法体 :10678-10683）——与毒云同
    // 机制：usesIDStaticNPCImmunity + idStaticNPCHitCooldown=10、组键共用 181 ⇒
    // 蜂群齐扑同敌只结算一颗（2026-08-31 台账无标记缺口,idStaticGroup 表级共享接线,
    // proj1457 IdStaticSharedTable 先例;idStaticCdTicks=10t,★G10 tick 基数）
    if (projId === 181 || projId === 566) {
      this.idStaticGroup = 181;
      this.idStaticCdTicks = 10;
    }
    // 189 黄蜂枪蜂（★T1 批 2026-09-01）：SetDefaults（:2777-2778）裸写
    // usesIDStaticNPCImmunity=true + idStaticNPCHitCooldown=10，【不】走
    // UseGroupStaticImmunity ⇒ immunityIdentity 保持 spawn 期直写值 = type = 189
    // （P.cs:784 `immunityIdentity = type`）——同 10t 静态窗但组键独立（蜂枪蜂群
    // 不与黄蜂蜂群互斥结算）。组键 189、cd 同 10t（★G10 tick 基数）
    else if (projId === 189) {
      this.idStaticGroup = 189;
      this.idStaticCdTicks = 10;
    }
  }

  /** GetAlpha 渲染近似（修复4；Projectile.cs:75940 GetAlpha → canvas globalAlpha）。
   *  缺省路径（:76837-76850）= RGB×(1−alpha/255)/A=255−alpha → 不透明度 (255−α)/255；
   *  特例型按 GetAlpha 固定返回色折算。null = 无覆写（保持 1）。
   *  280 黄金雨：SetDefaults alpha=255（:3402）+ 缺省路径 → 全程隐形（视觉=尘流，
   *  AI 侧每子步 3×尘 170）/ 477/478 镖：:76303-76308 alpha==0 → (255,255,255,200)
   *  否则 (0,0,0,0) → 前 3 拍隐形后 200/255 / 94/95：:76322-76326 固定
   *  (200,200,200,25) → 200/255 近似（近加算微透）/ 521/639：缺省路径淡入 */
  private drawGlobalAlpha(): number | null {
    switch (this.projId) {
      case 280: return 0;
      case 477: case 478: return this.alpha === 0 ? 200 / 255 : 0;
      case 94: case 95: case 1114: return 200 / 255;   // 1114 日耀花弹同支（:81007 GetAlpha (200,200,200,25)）
      case 521: case 639: return (255 - this.alpha) / 255;
      // 723-726/1133/728/9 斗篷星族（:80992-80995 GetAlpha (255,255,255,0)×Opacity——
      // 预乘加算白×透明度,starAlpha 为唯一渐变面:起步 50、线上钳 100、越线 −15/子步
      // 至 0 → ga=1−α/255;728/9 同句但走 StarfuryStar 专载体由 OPD/自身承载）
      case 723: case 724: case 725: case 726: case 1133:
        return 1 - this.starAlpha / 255;
      // 207/837（GetAlpha :76682-76687：r=g=b=255−alpha → 缺省路径同式）/
      // 163 族信号弹（SetDefaults alpha=255 :2523，AI_033 −50/t 渐显 :27428-27435
      // → 缺省路径同式，5 拍淡入）
      // 207 死存储→纯缺省★(:81353 赋值后被 :81507 覆写=通用式同义)。
      // ★R1(T1,2026-09-02)：92 自本支拆出——原"同缺省 (255−α)/255"系误读（把 aiStyle5
      //   闪烁档当成了 sprite 调制）;GetAlpha :80999 恒 (255,255,255,0) 不读 α,
      //   拆至 :2044 case 92 return 1 + ADDITIVE_GLOW_PROJS 加算白。
      // ★837 拆出二态门(:80726 与 :57636 270||837 同支)：α>0 → Transparent 全隐
      //   （SetDefaults 255 起 −50/t 至零,AI fade 见 subStepAI 837 分支）、
      //   α==0 → 瞬显 (255,255,255,200)=78% 白常驻——线性 fade 是错译
      case 207: return (255 - this.alpha) / 255;
      case 837: return this.alpha === 0 ? 200 / 255 : 0;
      case 442: return (255 - this.alpha) / 255;   // 电圈导弹渐显（缺省 GetAlpha 路径同式 :76837-76850）
      // ★BJ228 翻案（2026-09-21 用户实报）：邪恶三叉戟——旧档 (255−α)/255 系 R7-6
      //  按【缺省 GetAlpha 路径】误判（α=255 高速段 ga=0=隐形、减速 ga→1 显形,
      //  方向整体反了）。原版 114 有专属支 :81445-81458（114||115 首中即返,先于
      //  缺省尾 :81507）:localAI[1]<5→Transparent / 5..15→灰梯 (l−5)/10×255 /
      //  ≥15→(255,255,255,alpha)——RGB 恒白不读光照,A=α 场直通。绘制段
      //  Main.cs:33187-33189 再乘 (1−Opacity)=α/255 → 合成乘子 = ramp×α/255。
      //  AI α=Remap(速度,2,0,1,0)×255（:26794）→ 高速 α=255=不透明实体、减速线性
      //  淡出、消亡前 ~半亮（R7-6"隐身加速段+减速显形"就此推翻）。
      //  登记残差：≥15 段 A 侧=α²/255²（遮蔽比 rgb 侧浅）——本仓单乘子 ga 折 rgb 侧,
      //  减速半透期背景保留略少,单 pass 不可分,不展开。
      case 114: {
        const ramp114 = this.gem114Ramp < 5 ? 0
          : this.gem114Ramp < 15 ? (this.gem114Ramp - 5) / 10 : 1;
        return ramp114 * (this.alpha / 255);
      }
      // ★BJ236 剑气族（2026-09-21）：GetAlpha :81264-81277（1457 实锚;1458 同文）
      //  （116||132||156||157||173 与 114/115 :81445 同构梯）——<5 Transparent /
      //  5..15 灰梯 (l−5)/10 / ≥15 (255,255,255,alpha)。★与 114 的两处差异：
      //  ① 绘制段无 114 专支 ×(1−Opacity) 乘区（157/378 :35141 专支与 aiStyle27
      //    通支 :35152-35157 都直接 GetAlpha(projectileColor) 出画）→ ≥15 段合成
      //    乘子 = α/255（脉动值直通 A 通道）,梯段 = 灰梯值,不再乘 alpha 场;
      //  ② α 场语义不同：剑气 α=SetDefaults 255 起的 ±30/步脉动（AI 侧写,
      //    subStepAI 剑气支）,非 114 的速度 Remap。灰梯段 rgb×k²/A×k 的
      //    单乘子残差与 114 梯段同案登记。
      //  157 无发射面（1.4.5 已无武器射出,PROJ_ROT_DIAG 注登记）=防御性档,
      //  普查承载面;116=光束剑 723/173=附魔剑 989 通用近战 shoot 出膛（Game
      //  melee 支 :14138 通用 Arrow）,132/156 同表 dormant。
      case 116: case 132: case 156: case 157: case 173:
        return this.gem114Ramp < 5 ? 0
          : this.gem114Ramp < 15 ? (this.gem114Ramp - 5) / 10
            : this.alpha / 255;
      // ★BJ236 磁球 254（2026-09-21）：GetAlpha :81278-81287（1457 实锚;1458 同文）
      //  ——timeLeft<30 门内 α=255−255·(tL/30) 后返 (255−α,255−α,255−α,0)；
      //  A=0 → 纯加算白（配 ADDITIVE_GLOW_PROJS 'lighter'），强度 (255−α)/255
      //  代数化简 = min(1, tL/30)：满强白恒亮至寿命尾 30t 线性淡出（SetDefaults
      //  α 无行 ≡0 恒,aiStyle47 AI 不写 α——原版 α 写面仅在 GetAlpha 门内）
      case 254:
        return Math.min(1, this.life / 30);
      case 604: return (255 - this.alpha) / 255;   // 孢子云（aiStyle 115 alpha+10/t 淡出 :35062-35068）
      case 131: case 732: return (255 - this.alpha) / 255;   // 蘑菇孢子/风暴气旋渐隐（AI_030 :27154/AI_044 :28307 alpha 累加,GetAlpha 缺省路径同式）
      case 163: case 310: case 1008: case 1009: case 1010: case 1011:
        return (255 - this.alpha) / 255;
      case 514: return (255 - this.alpha) / 255;   // 钉 aiStyle 93 渐显（:33427-33434）
      case 246: case 311: return (255 - this.alpha) / 255;   // 刺炮弹/糖果玉米渐显
      // aiStyle 36 蜂族（SetDefaults alpha=255，AI −50/update 渐显 :27690-27697——
      // GetAlpha 缺省路径 r=g=b=255−alpha 同式）/ 616 涡旋弹（−25/t :58378-58384）/
      // 659 灵魂之焰（−12/t :36901-36903）
      case 181: case 189: case 307: case 316: case 566:
      case 616: case 659: return (255 - this.alpha) / 255;
      case 617: return (255 - this.alpha) / 255;   // 星璇秘术渐显（:35290-35295）
      case 618: return 0;                          // 星璇火花恒隐身（alpha 恒 255 :35533）
      // ---- R27 ----
      // 22 水花权杖 / 27 水矢：SetDefaults alpha=255（:1048/:1103）+ GetAlpha 缺省路径
      // num14=(255−alpha)/255=0 → 弹体贴图全程隐形，视觉本体=AI 尘水流（红队 R27 §2/§6
      // 补强：尘载体已接,原'防整弹消失'豁免解除）
      case 22: case 27: return 0;
      // ★R28：294 暗影束/295 地狱火叉弹/296 火柱爆区（aiStyle48/50 SetDefaults
      //   alpha=255 → GetAlpha 缺省路径 A=255−alpha=0 全程隐形,视觉本体=编排尘焰,
      //   红队 R28 §1/§2）/ 535 美杜莎之首（挂首模型由 MedusaHeadProj 承载,
      //   转换前的通用 Arrow 帧不显示）
      case 294: case 295: case 296: case 535: return 0;
      // ★BJ431 火花族 504/954/979（SetDefaults alpha=255 :5764/:9011/:9234 + AI
      //  :23766 每子步钉 255 → GetAlpha 缺省路径 (255−α)/255=0 恒隐;可视本体=AI
      //  火尘 6 / 霜尘 135 尾迹,同 294-296/376 dust-visual 族式——本仓曾 40×40
      //  魔杖占位贴图满显飞行=实报病灶）
      case 504: case 954: case 979: return 0;
      // ★2026-08-26（用户实报蓝晶/宝石法珠弹观感批）：宝石法珠 121-126/597 与 1120
      // SetDefaults alpha=255（Projectile.cs:2107-2160/:6466-6471/:10485-10491,
      // 1458），AI 不衰减——GetAlpha 缺省路径（:81503-81519）num14=(255−255)/255=0、
      // A=newColor.A−alpha≤0 → 像素弹芯【全程不可见】。可见本体 =
      // GemStaffShotDrawer("RainbowRod") 拖尾条（本仓 drawStripTrail 已接）+
      // AI 尘迹 + Main.cs:33667-33690 四层灰脉冲芯（drawGemCoreGlow 承载）
      case 121: case 122: case 123: case 124: case 125: case 126:
      case 597: case 1120: return 0;
      // ★R29：630 幻象弓载体（aiStyle75,DrawProj :33xxx 画的是持弓姿态非弹体贴图,
      // 本仓未建模载体绘制 → 隐形,P2 登记）/ 631 幻象矢（alpha255 渐显 :6786,AI_122
      // −15/t——★F5：无本表档,强度由通用兜底 (255−α)/255 活读,合成方式在
      // ADDITIVE_GLOW_PROJS） / 661 黑爆弹（alpha255 渐显 :7117,AI −55/t + scale1.3）/
      // 819 血箭（alpha255+hide :8001,DrawProj −20/t 渐显——本体近乎全隐,视觉=拖尾）/
      // 955 星星炮星（AI_005 通用闪烁档 :24200-24213 alpha 0↔200 ±25/t）/
      // 728 超级星（AI_151 −10/t 钳 100 :22340-22343）
      case 630: return 0;
      case 410: return (255 - this.alpha) / 255;   // 泡泡枪泡体（ai72 alpha 255→50,缺省 GetAlpha 路径同式）
      case 467: return (255 - this.alpha) / 255;   // 教徒火球（AI_001 467 支 α−40/update 渐显 :55194-55200,同式）
      // ★631（F5 统一注,2026-09-02）：已入加算组——GetAlpha :80818 (255−a,…,A=0)
      //   纯加算白,合成方式由 ADDITIVE_GLOW_PROJS 承载（lighter）,强度不走本表
      //   （本表无 631 档）而由通用兜底 (255−α)/255 活读 AI_122 渐显终值;
      //   728 同理另有恒隐改判
      //   ★T5 注释债已清（E′ M-4 表侧批次勘误,2026-09-02）：vanillaProjAlpha.ts:237
      //   的 631 条目注释原书 "A=0 隐形/原版视觉载体=AI 尘/粒,防整弹消失"（与 F5
      //   定罪真值=加算白本体相悖）,已改"恒 (255−a,…,A=0) 加算白箭体渐显…"。
      case 661: case 819: case 955: return (255 - this.alpha) / 255;
      // 728 超级星星炮星：GetAlpha :80995 恒 (255,255,255,0)*Opacity 隐体
      // （:80995 支成员 9/723-726/1133 待后续批核实 vanillaProjAlpha off 档承接面）
      case 728: return (255 - this.alpha) / 255;   // ★L 批纠:A=0 隐形错案同族(:80995 (255,255,255,0)xOpacity=加算白渐入;91/631/5 先例)。★P2 批销核:发射链已通(item 4060 SuperStarCannon,EXTRACT_PATCH['4060'] 落库,实拍出生验证)
      // ★T1（2026-09-02）：91 圣箭波——GetAlpha :81003 (200,200,200,0) 同 92 式 A=0
      //  加算灰（旧 case return 0 系"A=0 隐形"错案=源叠隐）。XNA 预乘 out=tex×(200/255)
      //  加算 → lighter + ga=200/255（配 ADDITIVE_GLOW_PROJS 入组）。charm 态同 5：
      //  aiStyle1 的 :80604-80615 White*Opacity 支先于 :81003 截走 = 常规合成乘子
      //  ga=(255−α)/255 分流（M-2 同案;91 SetDefaults aiStyle=1/arrow=true）。
      case 91:
        return this.phoenixQuivered || this.seraphNecklaced ? (255 - this.alpha) / 255 : 200 / 255;
      // ★T1（R 类清账,2026-09-02 用户拍板）：79 彩虹魔杖弹——GetAlpha :81469-81474
      //  `if (type == 79) { r/g/b = Main.Disco*; return default(Color); }`：
      //  Disco 三写系死存储（随后即 default(Color)=(0,0,0,0) 恒隐）——红队 D 早期
      //  表格"⚰ 死支恒隐"逐行复核成立。本体=任何合成式下均不可见。本仓 79 由
      //  MissileProj 承载（MagicMissileProj 彩虹拖尾条,本体本就不画）,Arrow 侧无
      //  消费面——此档为防御性兜底,防未来改道重落本体（MissileProj 不动,另登记）。
      case 79: return 0;
      // 337 暴雪法杖雪片（GetAlpha :81157 = (250,250,250,150) 半透白——恒定档,
      // 不随 alpha 字段变化）
      case 337: return 150 / 255;
      // aiStyle4 荆棘链（7/8 :876 / 150-152 :2408 alpha=255 起）：GetAlpha 缺省路径
      // （150 族固定支 :81311 同式）→ 不透明度=(255−alpha)/255——渐显(−50[/−75]/update
      // 至 0)后淡出(+5[nettle+3] 至 ≥255 Kill)全程可见度随 alpha 反相
      case 7: case 8: case 150: case 151: case 152: return (255 - this.alpha) / 255;
      // 876 zapinator（GetAlpha :81458-81464 与 88/89/100 等同支）：alpha<200 →
      // (255−alpha)白加算、≥200 Transparent——出生 25.5 update 渐显白光
      case 876: return this.alpha >= 200 ? 0 : (255 - this.alpha) / 255;
      // ★2026-09-01 GetAlpha :81457 支其余成员（与 876 同式 (255−α) 白 A=0 加算）：
      //  88 α≡0（SetDefaults 无 alpha 行，AI −10/t 段恒空转）→ 恒满强白加算=激光亮体；
      //  90/1134 α 恒 50 → 恒 205/255；83/89/100/104/279/283-287 随共享 −15/子步
      //  渐显（LASER_FADE15_PROJS）从隐到亮爬升——本式与 876 同门 <200
      case 83: case 89: case 90: case 100: case 104: case 279:
      case 283: case 284: case 285: case 286: case 287: case 1134:
        return this.alpha >= 200 ? 0 : (255 - this.alpha) / 255;
      case 88: return 1;
      // ★BJ228 普查批（2026-09-21）：A=0 加算白常量支接线——
      //  20 绿激光（:81390-81394 α≤150→(255,255,255,0)/α>150 真零；SetDefaults
      //   :1020-1031 无 alpha 行≡0 恒走前支=恒满强加算白；AI 共享 fade 组
      //   :56569-56592 只减不增→α 恒 0；出生面=太空枪 127 :19142 专支）/
      //  76/77/78 琴音弹（:81020-81023 恒 (255,255,255,0) 不读 α——SetDefaults
      //   :1558-1580 alpha=100 系死值,常量支先于缺省尾；出生面=魔法竖琴 494）
      //  ——均配 ADDITIVE_GLOW_PROJS 'lighter'（MOD 表 20/76/77/78 off 档就此接线,
      //  GA 先于表消费）。
      case 20: return 1;
      case 76: case 77: case 78: return 1;
      // ★F2（红队 A 仲裁定罪,2026-09-02）：恶魔镰刀族 44/45——GetAlpha :81465-81468
      //  `type==34||35||15||19||44||45 → Color.White` 恒满亮且【不读 alpha】（15 在
      //  更早的 :81007 (200,200,200,25) 支截走、34 在更早的 :80753 White*Opacity
      //  支截走——★T2 勘误：旧注"15/34 均被 :81007 截走"对 34 不成立,本支实际
      //  生效面=35/19/44/45）。
      //  45 的 PROJ_ALPHA0[45]=100 系死值,此前落通用兜底 (255−100)/255≈0.61 被压暗;
      //  44 无键 α≡0 兜底碰巧=1——同支语义应显式豁免,GA return 1 = 兜底禁入
      //  （PROJ_ALPHA0[45] 死值保留台账,注释已升格"显式 GA 豁免,兜底禁止消费"）。
      //  ★BJ-C1 F2 注勘误（2026-10-06,BJ529 定谳推翻旧判）：旧注隐含"GA return 1
      //  即同支语义承接完畢"——BJ529 定谳 Color.White 常量弹面=【光照无关】
      //  （Main.cs:30068 格光被 GetAlpha 整体替换）,GA=1 只修 α 面,乘光面仍病
      //  （实体层 compositeLight 压暗,暗腔实测 k=0.325）。44/45 已由 BJ529/530
      //  capture→return+projFullbrightQueue 复绘承接;同支 19 Flamarang
      //  （Boomerang 载体）/35 Sunfury（FlailProj 载体,α 面 ga=(255−100)/255≈0.61
      //  同病）由 BJ-C1 F2 收编（drawProj capture 槽,WeaponProj.ts）。
      case 44: case 45: return 1;
      // ★T2（R 类清账,2026-09-02 用户拍板）：34 火焰鞭——GetAlpha 活分支是 :80753
      //  `873||872||931||913||34||1039 → Color.White * Opacity`（:81007 里的 34 是
      //  死入口,:81465 白支亦不可达）→ 本体=不透明白贴图常规合成,ADDITIVE_GLOW_PROJS
      //  已出组、ga=1。Opacity 系数缺失=既有 E2 债（Opacity<1 潜行/淡出面未建模,
      //  44/45 同债,登记）。本体绘制面=MissileProj 专属类（34 系 16/34/79 新导弹族
      //  成员,MagicMissileProj 源叠常规绘已是此语义）——本档为 Arrow 侧兜底防改道。
      //  ★债登记（E′ M-1,2026-09-02 仲裁,只登记不修）：34/16 拖尾真身=FlameLashDrawer/
      //  MagicMissileDrawer 着色器 VertexStrip 管线（Main.cs:28616-28690）,实机绘制面
      //  在 MissileProj 专属类（简 polyline 拖尾）——1:1 管线残差超出 Arrow.ts 域,挂账另批。
      case 34: return 1;
      // ★T3（F3 长期正解落定,2026-09-02 用户拍板,R 类挂账按原版真值清零）：
      //  5 小丑箭——GetAlpha :81240-81242 恒 (255,255,255,0) 纯加算白（XNA 预乘
      //  A=0 → dst+=tex.rgb 全强度发光）。常态已入 ADDITIVE_GLOW_PROJS 走 lighter,
      //  'lighter' 下 ga=1=满强加算=预乘真值（实机观感=普通贴图→白亮发光体,原版相）。
      //  ★E′ M-2（2026-09-02 仲裁成立）：charm 态（PhoenixQuivered||SeraphNecklaced）
      //  在原版先于 :81240 被 :80609-80615 `aiStyle==1 → Color.White*Opacity` 截走
      //  （Opacity=1−α/255,P.cs:542-547）= 乘子 (155,155,155,155)≈61%【常规合成非加算】
      //  → ga=(255−α)/255 分流,合成方式出组走 source-over（draw 侧 ADDITIVE_GLOW
      //  消费分支按 id5+charm 分流,组内其余 id 零改动）;R4-32 白帧路径（whiteSpriteOf）
      //  不变——全白帧+常规合成即原版 White*Opacity 观感。
      //  旧"防整弹消失"登记偏离就此解除（PROJ_ALPHA0[5]=100 死值保留台账,兜底禁入）。
      case 5: return this.phoenixQuivered || this.seraphNecklaced ? (255 - this.alpha) / 255 : 1;
      // ---- Xenopopper 子弹族（GetAlpha :81040-81100 区段）——白化档走 drawXenoFilter ----
      case 445: return (128 / 255) * (1 - this.alpha / 255);   // (255,255,255,128)×(1-α/255)
      case 446: return 1 - this.alpha / 255;                   // Lerp(白,0.8)×(1-α/255)
      case 447: return 200 / 255;                              // (255,255,255,200) 恒
      case 450: return (255 - this.alpha) / 255;               // (200,200,200,255-α)
      case 451: case 684: return (255 - this.alpha) / 255;     // 白×((255-α)/255)
      case 452: case 454: return 1 - this.alpha / 255;         // 白×(1-α/255)
      // ★R1(T1,2026-09-02)：92 坠星本体面——GetAlpha :80999-81001 恒
      //  (255,255,255,0) 不读 alpha/光照（aiStyle5 闪烁档 0..200 振荡不进 GetAlpha）
      //  ——XNA 预乘语义 A=0 → dst+=tex.rgb 全强度 = 纯加算白星体（配
      //  ADDITIVE_GLOW_PROJS lighter 合成,见 :2490）；91 同族 (200,200,200,0) 加算灰
      //  已接线（★T1 2026-09-02:GA case 91 200/255+lighter;出生面=圣箭 516,旧注
      //  "Starfury 星"系错锚——星怒剑星=503/星怒弹=9）。可见面=本体加算 +
      //  light 0.9(:24310) + 尘 58@1/10(:24313-24315) + gore 16-17（Next(16,18) 右开）
      //  @1/20(:24316-24318) + Kill 共段(Game 侧)。
      case 92: return 1;
      // ★R2(T2,2026-09-02)：229 叶绿球（ChlorophyteOrb,叶绿党旗枪 222 链,
      //  PROJECTILE_NAME_BY_ID+SetDefaults P.cs:3153-3163）——Main.cs:28340-28343
      //  DrawProjDirect `if (proj.type == 229) return;` 整弹不画（弹体面=0;
      //  AI aiStyle44 :28323-28340 / Kill :75934-75950 逻辑面保留）。
      //  GetAlpha :81333-81335 (255,255,255,50) 因上游 return 成死值,
      //  PROJ_ALPHA_MOD[229] fixed a=50 档自本位起不再可达（防御位:本仓现无
      //  229 出生面,若未来接入也走 0 不画）。
      case 229: return 0;
      // ★R4(T3,2026-09-02)：440/449/606 死存储族退档——GetAlpha :81087-81091
      //  `r=g=b=255−α` 三写被 :81507-81510 缺省尾（num14=(255−α)/255 重算 r/g/b）
      //  整体覆写 = 死存储,有效面=纯缺省。GA 案位撤除后落 :2337-2341 通用兜底
      //  (255−α)/255 = 同值;XENO_GLOW 白光叠画/drawXenoFilter 白剪影滤镜同步摘除
      //  （原版无此观感——曾以"白剪影+glow"双重偏离锚定死存储）。
      default: return null;
    }
  }

  /** Xenopopper 子弹族加算发光（原版 GlowMask 214 族 + 泡泡残余光观感——
   *  442 等破裂弹在原版带青紫光晕，缺层=弹体暗淡偏色）。
   *  ★R4(T3,2026-09-02)：440/449 摘除——GetAlpha :81087 系死存储（:81507 覆写）,
   *  原版无白光 glow 叠画观感（606 本就不在组内）。
   *  ★G′ 摘除（2026-09-03 红队定罪→蓝队落码）：445/446/447/450/451 摘除——五弹
   *  不在 DrawProjDirect 残像门 :30609 名单（xeno 域成员仅 435/436/438/452/454）,
   *  专属绘制位亦无任何加算/白光叠画（445 :34702 锁链 Extra+本体 GetAlpha 单画/
   *  446 :33161 单画(origin.Y=4)+:29501 链 33 画/447 :32720 Extra[4]+本体/450
   *  :34788 单画(同段 GlowMask 仅 423/1022)/451 :35166 单画）——"+0.45 lighter
   *  叠画"无原版依据。五弹的向白观感由 GetAlpha 白化档（:81043 451/:81054 452,454/
   *  :81060 450/:81068 447/:81072 446/:81084 445）经 drawXenoFilter 承载,不在本组。
   *  保留组逐枚复核（原版观感位）：435/436/452/454=残像门 :30609 名单内;437=
   *  :32559-32578 White 基画+GetAlpha(White) 同位叠画;439=:32653 GlowMask[35]
   *  Color(255,255,255,0) 叠画;442=:32710 GlowMask[37] 同式叠画。 */
  private static readonly XENO_GLOW = new Set([435, 436, 437, 439, 442, 452, 454]);

  /** Xenopopper 子弹族白化滤镜（GetAlpha Lerp(白,k) 的 Canvas 近似——
   *  446 向白混 0.8 / 447-454 全白化。
   *  brightness 提亮 + saturate 去色近似 Lerp 白；返回 null = 无调制）。
   *  ★R4(T3,2026-09-02)：440/449/606 纯白剪影案位摘除——同上死存储,纯缺省无滤镜 */
  private drawXenoFilter(): string | null {
    switch (this.projId) {
      case 446: return 'brightness(1.8) saturate(0.35)';
      case 447: case 451: case 684: case 452: case 454: return 'brightness(1.6) saturate(0.3)';
      case 445: return 'brightness(1.5) saturate(0.4)';
      case 450: return 'brightness(1.25) saturate(0.5)';
      default: return null;
    }
  }

  /** GetAlpha 全量表调制（vanillaProjAlpha.ts ← Projectile.cs:75940-76850 全分支 307 id）。
   *  在 drawGlobalAlpha（现有专属档）之后消费——返回 null = 无覆写。
   *  语义约定（表头注释详述）：RGB 乘子折进 globalAlpha；Lerp(白,k) 用
   *  brightness/saturate 滤镜近似（复用 drawXenoFilter 模式）；off=1 的登记项不消费。 */
  private drawTableAlpha(): { ga: number; filter: string | null } | null {
    const m: ProjAlphaMod | undefined = PROJ_ALPHA_MOD[this.projId];
    if (!m || m.off) return null;
    const a = this.alpha;
    const fade = 1 - a / 255;
    // 固定色 rgb 滤镜：纯白=无；灰阶=brightness(r/255)；彩色=亮度近似（色相偏移未建模）
    const rgbFilter = (rgb: readonly number[] | undefined): string | null => {
      if (!rgb) return null;
      const [r, g, b] = rgb;
      if (r === 255 && g === 255 && b === 255) return null;
      if (r === g && g === b) return `brightness(${(r / 255).toFixed(3)})`;
      return `brightness(${(((r + g + b) / 3) / 255).toFixed(3)})`;
    };
    // ★BJ668（2026-10-12）Lerp(light,White,k) 两遍制基底滤镜：brightness(1−k)=W3C
    //  纯线性乘（逐通道精确,旧「中灰 128 归一 + saturate」近似退役——旧式抬升项被
    //  compositeLight 乘光=暗场抬升归零 BJ529 病根 + 亮场中灰归一过亮 f=1+0.992k
    //  双偏离）。白抬升项 ×k 不乘光 → 由 lerpLiftGate capture + replayLerpLift
    //  （projFullbrightQueue 'lighter' 光照后复绘）承接:base×light + lift ≡
    //  tex×ga×[(1−k)light+k] 恒等（vanillaProjAlpha.ts 头注 BJ668 块）。
    //  drawXenoFilter 440/449/606 档已摘=T3 死存储（与本滤镜无关）。
    const lerpFilter = (k: number): string => `brightness(${Math.max(0, 1 - k).toFixed(3)})`;
    switch (m.kind) {
      case 'invisible': return { ga: 0, filter: null };
      case 'fade':
        return { ga: fade * (m.mul ?? 1), filter: m.bright ? `brightness(${m.bright})` : null };
      case 'fade2': return { ga: fade * fade * (m.mul ?? 1), filter: null };
      case 'fixed': return { ga: ((m.rgba?.[3] ?? 255) / 255) * (m.mul ?? 1), filter: rgbFilter(m.rgba) };
      case 'fixedfade':
        return { ga: ((m.rgba?.[3] ?? 255) / 255) * fade * (m.mul ?? 1), filter: rgbFilter(m.rgba) };
      case 'afade': {
        // tail 门（575/596/659）：life<tail → α=255−255·life/tail（GetAlpha :76233-76238）
        let ae = a;
        if (m.tail && this.life < m.tail) ae = 255 - (255 * this.life) / m.tail;
        let ga = Math.max(0, ((m.rgba?.[3] ?? 255) - ae * (m.slope ?? 1)) / 255) * (m.mul ?? 1);
        if (m.inv) ga *= fade;                       // rgb 侧 (255−α) 衰减折进 ga
        return { ga, filter: rgbFilter(m.rgba) };
      }
      // ★BJ668 charm 分流（:80605-80611 先于全 lerp 支截走,aiStyle1∧charm 态）:
      //  White×Opacity = RGB 恒等×Opacity（无 k 语义无 mul——A=255×Opacity 非 25/200
      //  折面）→ plain fade 无滤镜（白帧路径 whiteSpriteOf 已在 draw 本体段承接）。
      //  非 charm 态:ga=A 侧（fade/mul 折面,与 1457 各支 A 语义逐值同构）,
      //  filter=两遍制基底 brightness(1−k),抬升面 ×k 走 lerpLiftGate 通道。
      case 'lerp':
        return this.phoenixQuivered || this.seraphNecklaced
          ? { ga: fade, filter: null }
          : { ga: fade * (m.mul ?? 1), filter: lerpFilter(m.k ?? 1) };
      case 'lerpkeep':
        return this.phoenixQuivered || this.seraphNecklaced
          ? { ga: fade, filter: null }
          : { ga: m.mul ?? 1, filter: lerpFilter(m.k ?? 1) };
      case 'lerpblack': return { ga: 1, filter: `brightness(${1 - (m.k ?? 0.25)})` };
      case 'lerpcolor':
        // Lerp(newColor,(255,200,60),0.5) 橙化：亮度近似（色相偏移未建模）
        return {
          ga: fade,
          filter: `brightness(${((((m.rgba?.[0] ?? 255) + (m.rgba?.[1] ?? 200) + (m.rgba?.[2] ?? 60)) / 3 / 128) * 0.5 + 0.5).toFixed(2)}) saturate(1.2)`,
        };
      case 'lerpalphain':
        // 352（:81126-81131）：A=lerp(light.A,255,k)×(α/255)=α/255（α 越大越显,
        // 与 lerp 的 fade 反相——alpha 面差异定谳;两遍制分解对 A 侧无感,只切 RGB 侧）
        return this.phoenixQuivered || this.seraphNecklaced
          ? { ga: fade, filter: null }
          : { ga: (a / 255) * (m.mul ?? 1), filter: lerpFilter(m.k ?? 1) };
      case 'alpha0': return { ga: a === 0 ? (m.rgba?.[3] ?? 200) / 255 : 0, filter: null };
      case 'alpha0additive':
        // 265/355（GetAlpha :81286-81293）：α>0→Transparent 全隐（fade 期可见面=AI
        // 毒泡）/ α==0→(255,255,255,0) A=0 满强加算白 → ga=1 配 ADDITIVE_GLOW_PROJS
        // 'lighter'（合成切换在 draw 本体支）。★charm 分流（M-2 同案,5/91 先例）：
        // aiStyle=1 被 :80605-80611 White*Opacity 先截走 → 常规合成 ga=(255−α)/255。
        return this.phoenixQuivered || this.seraphNecklaced
          ? { ga: fade, filter: null }
          : { ga: a === 0 ? 1 : 0, filter: null };
      case 'alphaLt': return { ga: a < (m.lt ?? 140) ? (m.rgba?.[3] ?? 100) / 255 : 0, filter: rgbFilter(m.rgba) };
      case 'alpha255hide': return { ga: a >= 255 ? 0 : 1, filter: null };
      case 'random': return { ga: a > 0 ? 0 : 200 / 255, filter: null };
      case 'disco': return { ga: 70 / 255, filter: null };
      case 'pulse40': {
        // WrappedLerp(0,255,t)=三角波（Utils.cs:273-281：num=2t,>1 折返）——40t 周期 0→255→0
        const t40 = (((this.life % 40) + 40) % 40) / 40;
        return { ga: t40 <= 0.5 ? t40 * 2 : 2 - t40 * 2, filter: null };
      }
      case 'life': return { ga: Math.min(1, this.life / 255), filter: null };
      case 'life2': return { ga: (100 / 255) * Math.min(1, (3 * this.life) / 255), filter: null };
      default: return null;
    }
  }

  /** ★BJ-C1 F3 常量色族通用全亮门（id/运行态谓词）：GA 专属档（44/45/34/20/76-78/
   *  5/91/265/355…,drawGlobalAlpha case 集）与 A=0 加算族（ADDITIVE_GLOW_PROJS,
   *  合成域自理）、charm 分流（:80609 White×Opacity=常规合成非常量族）不入门;
   *  270 脉冲/45 镰刀等专属支在段前早退不达本门。其余按 projConstFullbright
   *  表驱动判定（kind∈fixed/fixedfade/afade/fade2/pulse40 ∧ 白 rgb ∧ 非 off）。
   *  ★BJ-C9 F4（2026-10-08）：白 rgb 门外彩色/灰阶常量族由 projConstTint 判定
   *  （8 站:308/329/348/349/498/518/553/969）,同门捕获、消费侧双通道 replay
   *  （replayTintedFullbright）——本谓词保持白 rgb 门单源（消费侧分流,tint 门
   *  在 draw 捕获段并判定,防两谓词漂移）。 */
  private constFullbrightGate(): boolean {
    if (this.phoenixQuivered || this.seraphNecklaced) return false;
    if (ADDITIVE_GLOW_PROJS.has(this.projId)) return false;
    if (this.drawGlobalAlpha() !== null) return false;
    return projConstFullbright(this.projId);
  }

  /** ★BJ668（2026-10-12）Lerp 族光感算子门（表驱动 kind 面,零 id 专支——活跃 11 站
   *  与休眠 21 站同走本门,vanillaProjAlpha 头注 BJ668 普查块）：kind∈lerp/lerpkeep/
   *  lerpalphain ∧ 非 off ∧ k>0（projLerpLiftK 单源）∧ GA 未截走（732 类:GA 档优先
   *  于表,双消费禁止）∧ 非 charm 分流（:80605 White×Opacity 先于全 lerp 支截走,
   *  无 k 语义）。返回 k=白抬升权重（replayLerpLift lift 面）;null=不进通道。
   *  与 constFullbrightGate/projConstTint 互斥（kind 集不相交:lerp 族不进常量色族,
   *  draw 捕获段仍显式守卫防漂移）。 */
  private lerpLiftGate(): number | null {
    if (this.phoenixQuivered || this.seraphNecklaced) return null;
    if (this.drawGlobalAlpha() !== null) return null;
    return projLerpLiftK(this.projId);
  }

  draw(r: Renderer, _cam: Camera): void {
    let ctx = r.ctx;
    if (!ctx) return;
    // ---- ★2026-09-02 幻象弓载体 630 姿态独占支（AI_075 尾 :68401-68403）：
    //      rotation = velocity.ToRotation() + num（num=0；spriteDirection==−1 → π）
    //      + spriteDirection 镜像——贴图为持弓直立像,按速度角纯旋（无 +π/2 档）,
    //      朝左旋转 π 再水平镜像（PhoenixChannel.draw 同式先例）。此前走通用路径
    //      rotate(ang+π/2) 无镜像 = 弓体侧倾 90° 且朝左不翻 = 用户实报"贴图反"。
    //      置于 HOUSE 角色盒隐身门前:载体钉在挂点（盒内）,原版 heldProj 语义
    //      = 手持层恒可见,不吃新生弹隐身窗。联机傀儡 630 同支（姿态纯速度推导）----
    if (this.projId === 630) {
      const img630 = projSprite(630);
      if (img630 && img630.width > 0) {
        const mp630 = r.mainPlayer as { facing?: number; cx?: number; y?: number; h?: number } | undefined;
        const face630 = Math.sign(this.vx) || mp630?.facing || 1;
        const rot630 = Math.atan2(this.vy, this.vx);
        // ---- ★BJ704-G2（2026-10-21,债③ 亲读补齐）：GlowMask[200] 柔光叠画 +
        //      Extra[65] 枪口闪光（Main.cs:32668-32676,本体段后同层）。
        //  · 柔光（:32670）：GlowMask[200]（=Images/Glow_200.png,32×54 单帧）白
        //    (255,255,255,127)×num281 同帧矩形/旋转/锚/比例叠画;XNA A=127 source-over
        //    单笔=globalAlpha 127/255 逐项相等（Glow 域 23.6% 非零 α,预乘贡献=rgb×a×0.498）。
        //  · 闪光（:32671-32676）：localAI[0]>0 → Extra_65（36×276=1×6 行,行高 46）
        //    帧行 frameY=6−(int)localAI[0];可见窗 c∈(0,6] → 行 [0,5],c>6 → 负行
        //    PointClamp 顶行全透（资产实测顶 4 行 α=0）=不可见【跳画】。位=本体位+
        //    Normalize(velocity)×2,origin=(flip?36:0, 54/2−2=25)（num280=本体帧高）,
        //    色=白 127×num281。两 overlay 均【恒色不读 projectileColor】=原版 unlit
        //    glow 面——与本体同队列层随 BJ682 口径（预染 tint 已承担光照,overlay
        //    不再预染=原版恒亮同相）。
        //  · ★BJ704-G11（件5a,G10 债③清偿——前提勘误）：num281 stealth 档【可达】
        //    ——shroom/vortex stealth 仓内已建模（Player.stealth :2120 + equipStats.
        //    shroomiteSet/vortexSet + 伤害/暴击/仇恨消费 :3903-4167;「未建模恒 1」
        //    系 G10 登记误判）。Main.cs:32623-32640：shroomiteStealth∨setVortex ∧
        //    手持远程（draw 期活查 inventory[selectedItem].ranged）→ num281=max(
        //    stealth,0.03)（双支同钳）。overlay 色=(255,255,255,127)×n → XNA 预乘
        //    rgb×trunc(255n)/255 与 a×trunc(127n)/255 【双因子】——rgb 面经
        //    tintedTex 烘焙（BJ348b-3 entry-owned bake,零 ctx.filter）、a 面走
        //    globalAlpha=trunc(127n)/255。本体 projectileColor×=stealth 面
        //    （:32629/:32639——439/460/600/615/630/633/705/714 八型族绘色减光）
        //    ★BJ704-G14 件3 已清偿（615/630/705/714 四可达员——familyBodyStealthDim
        //    单源 + queue/直画两路径 rgb 烘焙 + ga;439/460/600/633 四员门死销案,
        //    逐员判语见 helper 头注）。 ----
        let n281 = 1;
        // ★BJ704-G14（件3 [g11-family-body-stealth-dim] 清偿——G11 件5a 登记域外刀）：
        //  n281 单源化到 familyBodyStealthDim（双支同钳 max(stealth,0.03)——overlay 面
        //  消费 ga（shroom/vortex 两支同值）;本体面消费 rgb（两支异形:shroom 均匀 ×n /
        //  vortex 青蓝 MultiplyRGBA lerp）,下方 queue/直画两路径并接)
        const dim630 = familyBodyStealthDim(r.mainPlayer);
        if (dim630) n281 = dim630.ga;
        const glowTex630 = r.atlas?.ensureVImage?.('vanilla/Glow_200.png') ?? null;
        const flashTex630 = r.atlas?.ensureVImage?.('vanilla/Extra_65.png') ?? null;
        const flashRow630 = this.ph630Flash > 0 && this.ph630Flash <= 6 ? 6 - this.ph630Flash : -1;
        const vl630 = Math.hypot(this.vx, this.vy) || 1;
        // stealth 档双因子预烘焙（n<1 才 bake;tintedTex flatten=false 保 α 形状）
        const tintN630 = n281 >= 1 ? null
          : [Math.trunc(255 * n281), Math.trunc(255 * n281), Math.trunc(255 * n281)] as [number, number, number];
        const glowSrc630 = tintN630 && glowTex630
          ? (tintedTex(glowTex630 as unknown as Parameters<typeof tintedTex>[0], tintN630, false) ?? glowTex630)
          : glowTex630;
        const flashSrc630 = tintN630 && flashTex630
          ? (tintedTex(flashTex630 as unknown as Parameters<typeof tintedTex>[0], tintN630, false) ?? flashTex630)
          : flashTex630;
        const ga630 = n281 >= 1 ? 127 / 255 : Math.trunc(127 * n281) / 255;
        const draw630Overlays = (c: CanvasRenderingContext2D, ccx: number, ccy: number): void => {
          if (glowSrc630 && glowSrc630.width > 0) {
            c.save();
            c.imageSmoothingEnabled = false;
            c.globalAlpha = ga630;
            c.translate(ccx, ccy);
            c.rotate(rot630);
            if (face630 < 0) { c.rotate(Math.PI); c.scale(-1, 1); }
            c.drawImage(glowSrc630 as CanvasImageSource, -glowSrc630.width / 2, -glowSrc630.height / 2);
            c.restore();
          }
          if (flashSrc630 && flashSrc630.width > 0 && flashRow630 >= 0) {
            c.save();
            c.imageSmoothingEnabled = false;
            c.globalAlpha = ga630;
            c.translate(ccx + (this.vx / vl630) * 2, ccy + (this.vy / vl630) * 2);
            c.rotate(rot630);
            if (face630 < 0) { c.rotate(Math.PI); c.scale(-1, 1); }
            c.drawImage(flashSrc630 as CanvasImageSource, 0, flashRow630 * 46, 36, 46,
              face630 < 0 ? -36 : 0, -25, 36, 46);
            c.restore();
          }
        };
        // ★BJ682（2026-10-14 用户实报「弓还是被盔甲遮住,脱掉盔甲才正常」=BJ681
        //  复诊）heldProj 载体层位随玩家层组走：原版 630 drawLayer=7 经 heldProj
        //  在玩家绘制层组 27_HeldItem 开头位插入（Projectile.cs :6769-6780
        //  drawLayer=7 + AI_075 尾 :68385 heldProj=whoAmI 钉手;PlayerDrawLayers.cs
        //  :3154 记插入位 → PlayDrawData :4310-4330 DrawHeldProj）=甲+甲glow
        //  (13-21)/盾(26) 之上、手持物(27)/臂glow(28) 之下。旧位=实体弹层
        //  postPlayerDraws（7e 恒色甲重绘/甲位 glow 冲刷【前】）=载体被星尘/
        //  日耀 250³/252³ 不透明恒色甲硬覆盖+glow 加色洗白（探针
        //  _bj682i-carrier.mjs 定点 48²：stardust dark=456/wash=544）。改道
        //  Renderer.heldProjCarrierQueue（7e⁴ 前冲刷=盾后武器前）。usesOwnerLight
        //  =true（:6776;Main.cs :30069-30072 GetColor(mountedCenter)=玩家中心光）
        //  ——收集时快照 16 级量化（eyebrella A4 同式）,满光直画原帧;fullbright
        //  跳过烘焙。无队列环境（测试/mock）回退直画原路径。
        const sink682 = r as unknown as {
          heldProjCarrierQueue?: Array<(c: CanvasRenderingContext2D) => void>;
          lighting?: { lightAt(tx: number, ty: number): [number, number, number] } | null;
          fullbright?: boolean;
          tintSliceRGB?: (img: ImageBitmap | HTMLImageElement, sx: number, sy: number, sw: number, sh: number,
            rgb: [number, number, number], alphaMul: number) => HTMLCanvasElement | null;
        };
        const q682 = sink682.heldProjCarrierQueue;
        if (q682) {
          const cx630 = this.cx, cy630 = this.cy;
          let lq630: [number, number, number] | null = null;
          if (!sink682.fullbright && sink682.lighting
            && mp630?.cx !== undefined && mp630?.y !== undefined) {
            const lc630 = sink682.lighting.lightAt(
              Math.floor(mp630.cx / 16), Math.floor((mp630.y + (mp630.h ?? 42) / 2) / 16));
            const q16 = (v: number) => Math.round(Math.min(255, v ?? 255) / 255 * 15) / 15;
            lq630 = [q16(lc630[0]), q16(lc630[1]), q16(lc630[2])];
            if (lq630[0] >= 0.999 && lq630[1] >= 0.999 && lq630[2] >= 0.999) lq630 = null;
          }
          q682.push((c: CanvasRenderingContext2D) => {
            let src630: ImageBitmap | HTMLImageElement | HTMLCanvasElement = img630;
            // ★BJ704-G14 件3：本体减光 tint 合成（光×stealth 乘子逐通道相乘=可交换,
            //  无光档(满光)单用 stealth tint）——A 面=ga（GetAlpha 默认档 A=255×n）
            const effTint630: [number, number, number] | null = dim630
              ? (lq630
                ? [lq630[0] * dim630.rgb[0], lq630[1] * dim630.rgb[1], lq630[2] * dim630.rgb[2]]
                : [...dim630.rgb] as [number, number, number])
              : lq630;
            if (effTint630 && sink682.tintSliceRGB) {
              src630 = sink682.tintSliceRGB(img630, 0, 0, img630.width, img630.height, effTint630, 1) ?? img630;
            }
            c.save();
            c.imageSmoothingEnabled = false;
            if (dim630) c.globalAlpha = dim630.ga;
            c.translate(cx630, cy630);
            c.rotate(rot630);
            if (face630 < 0) { c.rotate(Math.PI); c.scale(-1, 1); }
            c.drawImage(src630 as CanvasImageSource, -img630.width / 2, -img630.height / 2);
            c.restore();
            draw630Overlays(c, cx630, cy630);   // ★BJ704-G2 债③：柔光+枪口闪光（本体后）
          });
          return;
        }
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        // ★BJ704-G14 件3：直画回退路径本体减光（tintedTex 烘焙 rgb×n/vortex 青
        //  蓝 + globalAlpha=ga;flatten=false 保 α 形状——BJ700-C 同款）
        let src630F: ImageBitmap | HTMLImageElement | HTMLCanvasElement = img630;
        if (dim630) {
          const t630F: [number, number, number] = [
            Math.trunc(255 * dim630.rgb[0]), Math.trunc(255 * dim630.rgb[1]), Math.trunc(255 * dim630.rgb[2])];
          src630F = tintedTex(img630, t630F, false) ?? img630;
          ctx.globalAlpha = dim630.ga;
        }
        ctx.translate(this.cx, this.cy);
        ctx.rotate(rot630);
        if (face630 < 0) { ctx.rotate(Math.PI); ctx.scale(-1, 1); }
        ctx.drawImage(src630F as CanvasImageSource, -img630.width / 2, -img630.height / 2);
        ctx.restore();
        draw630Overlays(ctx, this.cx, this.cy);   // ★BJ704-G2 债③（直画回退路径同面）
        return;
      }
    }
    // ---- ★BJ642 喷火器 85/1106 火舌独占支（DrawProj_Flamethrower Main.cs:35647-35716
    //      / DrawProj_Flamethrower_Foxsparks :35719-35832 1:1；DrawProj 分派
    //      :32069-32078 `if (proj.type == 85) { DrawProj_Flamethrower(proj); return; }`
    //      / 1106 同构）。此前整缺落通用路径：98×686 七帧竖条【整幅】画出（projFrames
    //      无 85/1106 赋值=帧数 1,frag 整图直绘）+ 无调色渐变 + 无双层——BJ639 判
    //      「演出面整缺」本刀补齐。要点：
    //      · 七帧竖条 Frame(1,7,0,frame)：frame 恒 3（flag 档 (int)Remap(t,0.5,1,3,5)）
    //      · 双层×六步：num13 从 1 以 num6 步退（0.2/0.175——localAI[0]>50 切档）,
    //        i=0 层 color6（非 flag 支 G/2,B/2 整除 + A+80×num14）双 draw、
    //        i=1 层 color5 原×0.75 缩放双 draw（flag 档整层跳过）
    //      · 调色链六段（0.1/0.2/0.35/0.7/0.85/1 断点,flameTongueEnv 导出锁值）,
    //        ×num14 渐入 ×num9 寿命衰减（Remap(localAI[0],60,72,1,0)）
    //      · 几何：尾随位 = 弹心 + velocity×(−min(localAI[0],20))×num13（85 直式 /
    //        1106 经玩家向折算 ×num15 距离档）+ fox −46 上浮（Remap(l0,20,72,0,1)³）
    //      · 旋转 = proj.rotation(=0,AI_193 不写) ± num13×π/2 ∓ GTW×(num13+1)/num6×2
    //      · 恒自发光（调色常量不读格光,GetAlpha 不经手）→ queueProjFullbright
    //        光照合成后复绘（270/45 判例）；mock 无队列回退直绘（测试/探针链）
    //      · 染缸 flameTongueTint（multiply+dest-in,fqwTintBake 同构 cap 256）
    if (this.projId === 85 || this.projId === 1106) {
      const imgF = projSprite(this.projId);
      if (imgF && imgF.width > 0 && this.age < 72) {          // :35672 num11>=1 → 不画
        const fh7 = imgF.height / 7;                          // Frame(1,7) 帧高（98）
        const mpF = r.mainPlayer;
        const ops = flameTongueOps({
          projId: this.projId as 85 | 1106,
          l0: this.age, vx: this.vx, vy: this.vy, cx: this.cx, cy: this.cy,
          gtw: globalTimeWrappedHourly(),
          ai0: this.hostileAi0,
          ownerCx: mpF?.cx, ownerCy: mpF?.cy,
        });
        const drawInto = (c: CanvasRenderingContext2D) => {
          c.save();
          c.imageSmoothingEnabled = false;
          for (const op of ops) {
            const tint = flameTongueTint(this.projId, imgF, op.rgb);
            if (!tint || op.aByte <= 0) continue;             // A=0 XNA 恒等 no-op（黑纱档 aByte>0 照画）
            c.save();
            c.globalAlpha = Math.max(0, Math.min(1, op.aByte / 255));
            c.translate(op.px, op.py);
            c.rotate(op.ang);
            c.drawImage(tint, 0, op.frame * fh7, imgF.width, fh7,
              -imgF.width * op.scale / 2, -fh7 * op.scale / 2, imgF.width * op.scale, fh7 * op.scale);
            c.restore();
          }
          c.restore();
        };
        const qFb = (r as unknown as {
          queueProjFullbright?: (fn: (c: CanvasRenderingContext2D) => void) => void;
        }).queueProjFullbright;
        if (typeof qFb === 'function') qFb.call(r, drawInto);
        else drawInto(ctx);
      }
      return;
    }
    // ★HOUSE(2026-08-31 终案):原版出生=盒中心,弹穿出身体后可见——
    //  角色盒内不渲染弹体,替代全部几何出生点近似(用户拍板禁对齐回去)。
    //  仅限 age<30 的新生弹,不影响环绕/驻留类投射物
    const mp = r.mainPlayer;
    if (mp && this.age < 30) {
      if (this.cx > mp.x && this.cx < mp.x + mp.w &&
          this.cy > mp.y && this.cy < mp.y + mp.h) {
        return;
      }
    }
    // ★BJ529（2026-10-06 用户实报"骷髅王手被打掉后二阶段发射的骷髅头非常暗"定谳+落刀）：
    //  270 髅骨（专家骷髅王 :21961-21999 发射,Arrow skullBone 载体）GetAlpha
    //  :80722-80725 `type==270 → new Color(255,255,255,WrappedLerp(0,255,
    //  (timeLeft%40)/40))`【RGB 恒白不读光照色=光照无关弹面】——Main.cs:30068
    //  projectileColor=Lighting.GetColor → :31532 GetAlpha(projectileColor) 光色被
    //  整体替换。本仓弹体原走通用路径画进实体层 → compositeLight 全屏乘光把白脉冲
    //  压暗（探针 scripts/_bj529-skull-ab.mjs 暗腔实测弹体像素乘光系数 k=0.325,
    //  深暗≈0.1 = 实报病灶;vanillaProjAlpha 头注"本仓弹幕 projectileColor 恒白"只对
    //  GetAlpha 近似层成立,合成层乘光面=BJ504/509/510/7d' 同域定谳）。
    //  承接 = 79 头部 projFullbrightQueue 判例（BJ278,7f flushTrailShade 光照合成后
    //  主画布复绘）：本体不进实体层（capture→return,下省通用绘制段）,此处捕获当帧
    //  绘制参数闭包入队,复绘 source-over s·t+bg·(1−s·t)=原版逐字（ga=GetAlpha A 通道
    //  脉冲,pulse40 三角波单源自 drawTableAlpha）。层序登记：本槽在玩家/NPC 之上
    //  （BJ504 npcWhiteLift/677 既有偏差惯例同槽）。
    //  姿态两面同批对齐（原通用路径 270 落缺省支）：
    //  · rotation：:58579-58590 `270||585||601||706||837` 同支 rotation=atan2(v),
    //    spriteDirection=direction（AutomaticallyChangesDirection :17121/:17387 aiStyle1
    //    不豁免 → direction=sign(vx) :17123-17129）→ vx<0 镜像+atan2(−v),镜像合成
    //    R(π−ang)∘M（同支 837 已在 PROJ_ROT_RIGHT,270 漏员）;通用路径旧缺省支
    //    ang+π/2 = 整差 90°。
    //  · frame 拍速：:57651-57655 frame++ 逐 tick 循环 3 帧——通用路径 age/5 档
    //    5 倍慢,本支 age%3 承载。
    if (this.projId === 270) {
      const img270 = projSprite(270);
      if (img270 && img270.width > 0) {
        const gaGA = this.drawGlobalAlpha();
        let ga270: number;
        if (gaGA !== null) ga270 = gaGA;
        else {
          const mod = this.drawTableAlpha();
          ga270 = mod ? mod.ga : Math.max(0, Math.min(1, (255 - this.alpha) / 255));
        }
        const ang270 = Math.atan2(this.vy, this.vx);
        const flip270 = this.vx < 0;
        const f270 = ((this.age % 3) + 3) % 3;
        // 帧源矩形走 projFrameSrcRect（纯函数=无 document 依赖,闭包推迟到 flush 段
        // 执行,不持 frameCache canvas——9 参 drawImage 直切原图=同像素）
        const rect270 = projFrameSrcRect(270, f270);
        if (rect270) {
          const cx270 = this.x + this.w / 2, cy270 = this.y + this.h / 2;
          const sc270 = this.drawScale;
          (r as unknown as {
            queueProjFullbright?: (fn: (c: CanvasRenderingContext2D) => void) => void;
          }).queueProjFullbright?.((c) => {
            c.save();
            c.translate(cx270, cy270);
            if (flip270) c.scale(-1, 1);
            c.rotate(flip270 ? Math.PI - ang270 : ang270);
            c.imageSmoothingEnabled = false;
            c.globalAlpha = Math.max(0, Math.min(1, ga270));
            c.drawImage(img270, rect270.sx, rect270.sy, rect270.sw, rect270.sh,
              -rect270.sw * sc270 / 2, -rect270.sh * sc270 / 2,
              rect270.sw * sc270, rect270.sh * sc270);
            c.restore();
          });
        }
      }
      return;
    }
    // ★BJ530（2026-10-06,BJ529 同族普查收编第二刀）：45 恶魔镰刀 friendly 型
    //  （item 272 恶魔镰书法典 Item.cs:4560-4575 mana14/damage35/shoot=45/shootSpeed
    //  0.2,Game case 'magic' 通用尾 Arrow 载体）GetAlpha :81465-81468
    //  `34||35||15||19||44||45 → Color.White`——A=255 恒定（无 270 式脉冲/无 fade,
    //  SetDefaults α=100 :1285 死值不读）,RGB 恒白【不读光照色】=Main.cs:30068
    //  projectileColor=格光被 GetAlpha 整体替换。α 面已修（drawGlobalAlpha case
    //  44/45 return 1,F2 批硬档——vanillaProjAlpha 表不加项=300 census 锁不动）;
    //  光照面=弹体画进实体层被
    //  compositeLight 全屏乘光压暗（BJ529 探针 _bj529-skull-ab 暗腔实测 k=0.325
    //  同病）→ 承接=本文件 270 专属支同构：本体不进实体层（capture→return）,当帧
    //  绘制参数闭包入队,flushTrailShade 光照合成后主画布 source-over 复绘=原版
    //  EntitySpriteDraw color48=Color.White（:31532 取色/:31578 出画）逐字。层序=
    //  玩家/NPC 之上（270/BJ504 同槽惯例）。姿态面零改：自旋已接 PROJ_SPIN[45]
    //  （AI_018 :25781 rotation+=0.8×direction,update 尾 spinRot 累积）、scale=
    //  pd 0.9（SetDefaults :1285-1292,drawScale ctor 消费）、单帧（Main.projFrames
    //  无 44/45 赋值=1 帧=整图,frame 恒 0）。
    if (this.projId === 45) {
      const img45 = projSprite(45);
      if (img45 && img45.width > 0) {
        const gaGA45 = this.drawGlobalAlpha();
        let ga45: number;
        if (gaGA45 !== null) ga45 = gaGA45;
        else {
          const mod45 = this.drawTableAlpha();
          ga45 = mod45 ? mod45.ga : Math.max(0, Math.min(1, (255 - this.alpha) / 255));
        }
        const rot45 = this.spinRot;                       // PROJ_SPIN[45] 累积自旋
        const cx45 = this.x + this.w / 2, cy45 = this.y + this.h / 2;
        const sc45 = this.drawScale;
        // 单帧整图 9 参直切原图（270 同式:闭包只持 img 引用+矩形数,不持 frameCache）
        const rect45 = projFrameSrcRect(45, 0);
        if (rect45) {
          (r as unknown as {
            queueProjFullbright?: (fn: (c: CanvasRenderingContext2D) => void) => void;
          }).queueProjFullbright?.((c) => {
            c.save();
            c.translate(cx45, cy45);
            c.rotate(rot45);
            c.imageSmoothingEnabled = false;
            c.globalAlpha = Math.max(0, Math.min(1, ga45));
            c.drawImage(img45, rect45.sx, rect45.sy, rect45.sw, rect45.sh,
              -rect45.sw * sc45 / 2, -rect45.sh * sc45 / 2,
              rect45.sw * sc45, rect45.sh * sc45);
            c.restore();
          });
        }
      }
      return;
    }
    // 泰拉刃光束 985 独占（DrawProj_TerraBlade2Shot Main.cs:27670-27712）：
    // Frame(1,4) 四帧 170×170（帧 0 主体/帧 3 白芯）；多层镜像叠画：
    // 蓝(45,124,205)×2 对称 ±π/8 张开 + 绿白内芯 ×2 + 绿(34,177,76) ×2
    // ±0.25 收拢 + 黄绿(181,230,29) + 帧 3 白芯三层递缩——ai[0]=0（未传参）
    // 时各 ±ai0 项归零对称；旋转角=velocity 角（无 +π/2，贴图正交）。
    // 淡出 = Remap(localAI[0],0,25,1,0)
    if (this.terra) {
      const img = projSprite(985);
      if (!img || !(img.width > 0) || img.width === 0) return;
      const fw = img.width, fh = img.height / 4;
      // 淡入淡出（:39344 985 专属）：Remap(t,0,ai1/2,0,1)×Remap(t,ai1+13,ai1+25,1,0)
      const aIn = Math.min(1, this.terraT / (this.terraAi1 * 0.5));
      const aOut = this.terraT <= this.terraAi1 + 13 ? 1
        : Math.max(0, (this.terraAi1 + 25 - this.terraT) / 12);
      const fade = aIn * aOut;
      // num6 双段（:39273 主段 Remap(t,ai1*0.4,ai1+25,0,1)——绘制张合的推进分母）
      const num = Math.min(1, Math.max(0, (this.terraT - this.terraAi1 * 0.4) / (this.terraAi1 + 25 - this.terraAi1 * 0.4)));
      const spread = 1 - num;
      // 绘制 scale（:39341）：Remap(1−(1−num6)²,0,1,1.5,1)×ai2
      const fv = 1 - (1 - num) * (1 - num);
      const terraScale = (1.5 - 0.5 * Math.min(1, Math.max(0, fv))) * this.terraAi2;
      const rot = Math.atan2(this.vy, this.vx);
      const layer = (sy: number, a: number, angOff: number, frame: number, flipV: boolean) => {
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, a * fade));
        ctx.translate(this.cx, this.cy);
        ctx.rotate(rot + angOff * this.terraAi0);   // ±ai[0] 方向项（:27694 ai0=±1）
        if (flipV) ctx.scale(1, -1);
        const dw = fw * sy * terraScale;
        ctx.drawImage(img, 0, frame * fh, fw, fh, -dw / 2, -fh * sy * terraScale / 2, dw, fh * sy * terraScale);
        ctx.restore();
        ctx.globalAlpha = 1;
      };
      ctx.imageSmoothingEnabled = false;
      layer(0.95, 0.5, Math.PI / 8 * spread, 0, false);            // 蓝镜像对（±π/8×spread）
      layer(0.95, 0.5, -Math.PI / 8 * spread, 0, true);
      layer(1, 0.12, 0, 0, false);                                 // 绿白内芯（color5 近似）
      layer(1, 0.3, Math.PI / 4 * 0.25 * spread, 0, false);        // 绿 ±0.25 收拢
      layer(1, 0.3, -Math.PI / 4 * 0.25 * spread, 0, true);
      layer(0.975, 0.5, Math.PI / 4 * 0.15 * spread, 0, false);    // 黄绿主芯
      layer(1, 0.6, Math.PI / 4 * 0.05 * spread, 3, false);        // 帧 3 白芯三层
      layer(0.8, 0.5, -0.05, 3, false);
      layer(0.6, 0.4, -0.1, 3, false);
      return;
    }
    // 星怒剑 503 独占：rotation=vel−π/2（:22236-22239），origin (w/2, 70)
    // （Main.cs:29898-29901——34×90 贴图锚点近底部，剑尖前伸 70px）；
    // Opacity = 1−alpha/255 渐显
    if (this.starY !== null && this.projId === 503) {
      const img = projSprite(503);
      if (!img || !(img.width > 0) || img.width === 0) return;
      // ★BJ219：503 星怒残影（通用表 1,9,3,0.5 档+originY=70——Main.cs:30787-30790/
      //   :30643-30645;ghostRing 在 GHOST_RECORD_EXCLUDE 之外,503 有记录式 mode 0）
      if (this.ghostRing !== undefined && this.ghostRing !== null) {
        drawProjGhosts(ctx, {
          ring: this.ghostRing,
          id: 503,
          tex: img,
          frames: projFrameCount(503),
          frame: 0,
          bodyW: this.w, bodyH: this.h,
          bodyRot: Math.atan2(this.vy, this.vx) - Math.PI / 2,
          bodyScale: 1,
          bodyAlpha: Math.max(0, Math.min(1, 1 - this.starAlpha / 255)),
          ai0: 0, ai1: 0,
          timeLeft: this.life,
          opacity: Math.max(0, Math.min(1, 1 - this.starAlpha / 255)),
          vxLen: Math.hypot(this.vx, this.vy),
          spriteDirection: this.vx < 0 ? -1 : 1,
        });
      }
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, 1 - this.starAlpha / 255));
      ctx.translate(this.cx, this.cy);
      ctx.rotate(Math.atan2(this.vy, this.vx) - Math.PI / 2);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, -img.width / 2, -70, img.width, img.height);
      ctx.restore();
      ctx.globalAlpha = 1;
      return;
    }
    // 932 月总矢独占（★EoL2 修5,2026-10-05;DrawProj_FairyQueenRangedItemShot
    // Main.cs:36528-36553,alpha/rotation 生命周期=AI_181 :43979-43991,见 subStepAI
    // 932 支）：白核 White×Opacity(A/2) + 彩虹尾迹 6 步（GetFairyQueenWeaponsColor(0)
    // ——GetColor 内部已 ×Opacity,P.cs:22057,调用侧再 ×opacity → Opacity² 档;
    // A=0 纯加法 = 'lighter' 直画精确承载）+ 轨道晕 4 点（color(0.5)×opacity,
    // A/2 → source-over g=Opacity²×0.5——straight 画布 A 档直承载,919 轨道环同款
    // 近似档）;num = Lerp(.7,1,GTLV(0,5,ai0≡age))（:36537）;rotation =
    // velocity.ToRotation()（无 +π/2、无 spriteDirection 镜像 :36550-36552）;
    // hue=empressHue 通道（★2026-10-06 登记债已接：发射端 Game.ts 4953 支
    //  fairyQueenShotHue(this.player.miscCounter) 注入——未接弹缺省 0 档）。
    // 全层自发光不读格光——格光抬亮见 SELF_LUMINOUS_PROJS[932]（暗处白核/彩虹恒亮）。
    if (this.projId === 932) {
      const img932 = projSprite(932);
      if (img932 && img932.width > 0) {
        const gl932 = (from: number, to: number, t: number): number => {
          if (from < to) { if (t < from) return 0; if (t > to) return 1; }
          else { if (t < to) return 1; if (t > from) return 0; }
          return (t - from) / (to - from);
        };                                                // Utils.GetLerpValue 1:1（Utils.cs:283）
        const opacity = Math.max(0, Math.min(1, 1 - this.alpha / 255));   // P.Opacity
        const num932 = 0.7 + 0.3 * gl932(0, 5, this.age);                 // :36537
        const spd932 = gl932(0, 1, Math.hypot(this.vx, this.vy));         // :36540 尾长门
        const ang932 = Math.atan2(this.vy, this.vx);                      // AI_181 rotation
        const tinted932 = fqwTintBake(img932, empressHslRgb(((this.empressHue ?? 0) + 0.5) % 1));
        const iw932 = img932.width, ih932 = img932.height;
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        const put932 = (dx: number, dy: number, g: number,
          source: CanvasImageSource, comp: GlobalCompositeOperation) => {
          ctx.save();
          ctx.globalCompositeOperation = comp;
          ctx.globalAlpha = Math.max(0, Math.min(1, g));
          ctx.translate(dx, dy);
          ctx.rotate(ang932);
          ctx.drawImage(source, -iw932 * num932 / 2, -ih932 * num932 / 2,
            iw932 * num932, ih932 * num932);
          ctx.restore();
        };
        if (tinted932) {
          for (let k = 0; k < 6; k++) {                     // num2 = 0..5/6（:36541-36544）
            const n2 = k / 6;
            put932(this.cx + Math.cos(ang932) * -120 * n2 * spd932,
              this.cy + Math.sin(ang932) * -120 * n2 * spd932,
              opacity * opacity * (1 - n2), tinted932, 'lighter');
          }
          for (let k = 0; k < 4; k++) {                     // num3 = 0..0.75（:36545-36548）
            const a = k * 0.25 * Math.PI * 2 + ang932;
            put932(this.cx + Math.cos(a) * 4 * num932,
              this.cy + Math.sin(a) * 4 * num932,
              opacity * opacity * 0.5, tinted932, 'source-over');
          }
        }
        put932(this.cx, this.cy, opacity * 0.5, img932, 'source-over');   // 本体 A/2（:36537/:36552）
        ctx.restore();
        ctx.globalAlpha = 1;
      }
      return;
    }
    // 翻滚态用累积角（aiStyle 2）；48/54/93/520/599 平飞期姿态锁定 atan2
    const tumbling = this.tumble && !(this.tumblePoseLock && this.age <= this.gravDelay);
    // 食人鱼姿态由 AI 侧维护（pRot/pFlip）：咬住时 velocity 清零（:26126-26129），
    // 现算 atan2(0,0)=0 会把鱼掰回正右——原版 rotation 在清速前取目标向（:27976-28015）
    // 信号弹同型：rotation = atan2(ai[1], ai[0])+π/2（:27497），贴壁 velocity 清零后
    // ai 向量冻结在末速——现算 atan2(0,0)=0 会把弹头掰回正上
    const ang = this.piranha ? this.pRot
      : this.flare ? Math.atan2(this.flareAi1, this.flareAi0)
        : (tumbling ? this.tumbleRot : Math.atan2(this.vy, this.vx));
    const img = projSprite(this.projId);
    // 喵刀弹 502 彩虹拖尾（Main.cs:32495-32513）：Projectile_250.png（14×32）沿
    // oldPos 逐段——旋转=段向-π/2、纵向拉伸=段长/32、alpha=127/255×(1-i/N)，
    // 画在【本体之前】（原版在本体绘制后叠画，此处先画拖尾再本体等效）
    if (this.projId === 502 && this.meowTrail.length >= 4) {
      const streak = projSprite(250);
      if (streak && (streak.width > 0) && streak.width > 0) {
        const N = this.meowTrail.length / 2;
        for (let i = N - 1; i > 0; i--) {
          const x1 = this.meowTrail[i * 2], y1 = this.meowTrail[i * 2 + 1];
          const x2 = this.meowTrail[(i - 1) * 2], y2 = this.meowTrail[(i - 1) * 2 + 1];
          const segLen = Math.hypot(x2 - x1, y2 - y1);
          if (segLen < 0.01) continue;
          const segAng = Math.atan2(y2 - y1, x2 - x1) - Math.PI / 2;
          ctx.save();
          ctx.translate(x1 + this.w / 2, y1 + this.h / 2);
          ctx.rotate(segAng);
          ctx.imageSmoothingEnabled = false;
          ctx.globalAlpha = (127 / 255) * (1 - i / N);
          // origin (w/2, 0)：段起点为锚、沿段向拉伸到段长（scaleY=段长/贴图高）
          ctx.drawImage(streak, -streak.width / 2, 0,
            streak.width, Math.max(1, segLen));
          ctx.restore();
          ctx.globalAlpha = 1;
        }
      }
    }
    // ★shader 审计战役：MagicMissile 族拖尾 shader 直连（Main.cs:28616-28690 分发表——
    //   34 火鞭=FlameLashDrawer/16 魔导弹=MagicMissileDrawer/121-126+597+1120=
    //   GemStaffShotDrawer("RainbowRod")/106 光棱剑=LightDiscDrawer）。原版走
    //   VertexStrip+GameShaders.Misc[pass]（Extra_N LUT 采样），此前我方无拖尾渲染。
    //   fx/TrailShader.ts 逐像素复刻 pass 公式（噪声门×边缘包络×顶点色），加算叠画
    {
      const nowS = performance.now() / 1000;
      const lerpC = (a: number[], b: number[], t: number): number[] =>
        [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      const buildPts = (raw: number[], hw: number, colFn: (pv: number) => number[]): TrailPt[] => {
        const n2 = raw.length / 2;
        const out: TrailPt[] = [];
        for (let i = 0; i < n2; i++) {
          const v = n2 > 1 ? i / (n2 - 1) : 1;                     // 0=尾(旧) 1=头(新)
          const c = colFn(v);
          out.push({ x: raw[i * 2], y: raw[i * 2 + 1], hw,
            r: c[0], g: c[1], b: c[2],
            a: Math.min(1, v * 1.7) });
        }
        return out;
      };
      if ((isGemBolt(this.projId) || this.projId === 1120) && this.gemTrail.length >= 4) {
        const intensity = this.projId === 123 ? 3 : 2;
        // ★BJ675（2026-10-14）：顶点色/带宽改走 gemTrailPts（GemStaffShotDrawer
        //  .StripColors/StripWidth 1:1）——旧 buildPts 近似色序/包络双反+hw9 偏窄,
        //  紫晶弹观感=「短暗尾」,原版=「长白紫光带」。
        // ★2026-09-03 黑椭圆止血：拖尾入全亮队列（flushTrailShade 合成后直绘主画布
        //  'lighter'）;mock 无队列方法回退直绘（探针/测试链保持）
        const spec = {
          set: 'RainbowRod' as const,
          pts: gemTrailPts(this.gemTrail, this.projId),
          // ★红队 F3（2026-09-03）：SM2 face 的 uOpacity=独立乘子（instr#16 mul c0），
          //  原版值 = GemStaffShotDrawer.cs:23 UseOpacity(intensity)——旧 ×0.5 是给
          //  废弃近似公式的亮度校准，字节码面下恒 2× 偏暗
          opacity: intensity,
          time: nowS,
        };
        const q = (r as unknown as { queueTrailShade?: (sp: typeof spec) => void }).queueTrailShade;
        if (typeof q === 'function') q.call(r, spec);
        else drawStripTrail(ctx, r, spec);
      } else if (this.stripTrailPts.length >= 4 &&
        (this.projId === 34 || this.projId === 16 || this.projId === 106)) {
        // 顶点色=vanilla 各 Drawer.StripColors（pv: 0=头新→1=尾旧）
        const colFn = this.projId === 34
          ? (pv: number) => {                                       // White→Red（FlameLashDrawer）
            const lv = Math.max(0, Math.min(1, (pv + 0.1) / 0.8));
            return lerpC([1, 1, 1], [1, 0, 0], lv);
          }
          : this.projId === 16
            ? (pv: number) => lerpC([1, 1, 1], [0.58, 0, 0.83], Math.max(0, Math.min(1, pv / 0.7)))
            : (pv: number) => {                                     // LightDisc：(48,63,150) 加算余辉
              const k = Math.pow(1 - pv, 4) * 0.5;
              return [48 / 255 * k / 0.5, 63 / 255 * k / 0.5, 150 / 255 * k / 0.5];
            };
        const hw = this.projId === 34 ? 18 : this.projId === 16 ? 15 : 10;
        // ★红队 F3：op=2 = MagicMissileDrawer.cs:16/LightDiscDrawer.cs:16 UseOpacity(2f)
        //  原值（106 旧 1 系近似档归位;106 实际出生走 Boomerang、本支准死代码）。34 原版
        //  =Lerp(4,8,t2d)（FlameLashDrawer.cs:17）——本支无 redT 通道,维持 2（死分支）
        const op = 2;
        const spec2 = {
          set: (this.projId === 34 ? 'FlameLash' : this.projId === 106 ? 'LightDisc' : 'MagicMissile') as 'FlameLash' | 'LightDisc' | 'MagicMissile',
          pts: buildPts(this.stripTrailPts, hw, colFn),
          opacity: op,
          time: nowS,
        };
        const q2 = (r as unknown as { queueTrailShade?: (sp: typeof spec2) => void }).queueTrailShade;
        if (typeof q2 === 'function') q2.call(r, spec2);
        else drawStripTrail(ctx, r, spec2);
      }
    }
    // ---- aiStyle 24 书族十份 oldPos 渐隐拖尾（Main.cs:35251 94/:35299 1114——
    //      ai[1]>6 起沿 oldPos[0..9] 绘制,缩放/RGBA 各 ×(9−i)/9,GetAlpha=(200,200,200,25)
    //      ★XNA AlphaBlend=预乘语义（飞灵终审同款）：RGB 全额加算、A=25 只衰背景
    //      10%=加算发光观感——canvas 'lighter' 复刻,source-over 直译=半透灰（用户实报）----
    if ((this.projId === 94 || this.projId === 1114) && this.age > 6
      && this.starTrail.length >= 4) {
      const imgT = projSprite(this.projId);
      if (imgT && (imgT.width > 0)) {
        const baseA = this.drawGlobalAlpha() ?? 1;
        const pts = this.starTrail;
        const m = pts.length / 2;
        const sc = this.projId === 1114 ? 1.2 : 1;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < Math.min(10, m - 1); i++) {
          const k = 1 - i / 10;                      // newest 1.0 → oldest 0.1
          const px = pts[(m - 1 - i) * 2], py = pts[(m - 1 - i) * 2 + 1];
          ctx.save();
          ctx.globalAlpha = Math.max(0, Math.min(1, baseA * k));
          ctx.translate(px + this.w / 2, py + this.h / 2);
          ctx.rotate(this.spinRot);
          ctx.drawImage(imgT, -imgT.width * sc * k / 2, -imgT.height * sc * k / 2,
            imgT.width * sc * k, imgT.height * sc * k);
          ctx.restore();
        }
        ctx.restore();
      }
    }
    // ---- 660 天界碎裂残影（Main.cs:30609 入 trail 块;:30974-30980 num164=3/
    //      num165=1/num167=8f + 帧矩形同本体;循环 num170=1,2——oldPos[1]/[2] 两帧
    //      残影,α=GetAlpha×(3−k)/(TrailCacheLength[660]=10×1.5),scale=Lerp(proj.
    //      scale=1.1, 8, k/num168=15)——'lighter' 加算淡青拖尾;TrailingMode[660]=0
    //      → 旋转用当前 proj.rotation（=速度角+π/4,PROJ_ROT_DIAG 同本体）----
    if (this.projId === 660 && this.starTrail.length >= 6) {
      const imgT660 = projFrameImg(660, this.f712Frame);
      if (imgT660 && imgT660.width > 0) {
        const pts660 = this.starTrail;
        const m660 = pts660.length / 2;
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.globalCompositeOperation = 'lighter';
        for (let k = 1; k <= 2 && k <= m660 - 1; k++) {
          const px = pts660[(m660 - k) * 2], py = pts660[(m660 - k) * 2 + 1];
          const ga660 = Math.max(0, (3 - k) / 15);            // num176/(CacheLen×1.5)
          const sc660 = 1.1 + (8 - 1.1) * (k / 15);           // Lerp(1.1, num167, k/15)
          ctx.save();
          ctx.globalAlpha = ga660;
          ctx.translate(px + this.w / 2, py + this.h / 2);
          ctx.rotate(ang + Math.PI / 4);                      // :58632 rotation 同本体
          ctx.drawImage(imgT660, -imgT660.width * sc660 / 2, -imgT660.height * sc660 / 2,
            imgT660.width * sc660, imgT660.height * sc660);
          ctx.restore();
        }
        ctx.restore();
      }
    }
    // ---- ★BJ219 通用 oldPos 残影族（Main.cs:30609-31360 通用表+专用帧残影四弹
    //      409/437/385/388）——原版残影块先于本体绘制段,挂本体 save 之前。排除集
    //      内 id（660/94/1114/502/弦带族/剑族…）走各自内联实现,ghostRing=null 短路;
    //      503 星怒在上方独占支内补挂（rot=vel−π/2 本体角语义）。
    //      ★BJ235：绿带 1020/1024/1026 = DrawProjDirect 头 DrawTrail 面（:28508-28561
    //      原版在最前,先于一切——此处挂通用残影前同序）,与通用表 1026 条目并存
    //      （原版 1026 两面都画）;1020/1024 无通用表条目（仅绿带）。
    //      ★清偿刀 N（2026-09-30）：1020 支退役——1020/1105 载体已随刀 A 改挂
    //      DroneProjs 实体（JimsDroneProj.draw 自带尾迹+本体,染色版在彼处）,
    //      Arrow 不再携带 1020=本条件死支摘除;1024/1026 仍为 Arrow 载体维持。
    //      原版 1024/1026 DrawTrail 无 cPet 门（仅 1020 DrawContinuousTrail 有,
    //      Main.cs:28301-28303）=本函数固定色 1:1 不涉染料。 ----
    if (this.ghostRing !== undefined && this.ghostRing !== null
      && (this.projId === 1024 || this.projId === 1026)) {
      drawGreenBandTrail(ctx, this.ghostRing, this.projId, this.w, this.h);
    }
    if (this.ghostRing !== undefined && this.ghostRing !== null) {
      const ghostA = this.drawGlobalAlpha() ?? Math.max(0, Math.min(1, (255 - this.alpha) / 255));
      // ★BJ371：409 剃刀台风专用帧残影块（Main.cs:32539-32560）——残影 5 槽同用
      //  proj.rotation（自旋角,非速度角）、帧锚=当前帧 y13、色 A=200×(10−i)/15
      //  （GetAlpha 恒 (250,250,250,200) :81148,RGB 侧 250 走 GHOST_TINT[409]）
      const isTy409 = this.projId === 409;
      drawProjGhosts(ctx, {
        ring: this.ghostRing,
        id: this.projId,
        tex: (img && img.width > 0) ? img : null,
        frames: projFrameCount(this.projId),
        frame: isTy409 ? this.ty409Frame : 0,  // 通用表帧锚基准行（repo 无通用逐帧字段,登记②）;409=当前帧（:32543 y13=num271×frame）
        bodyW: this.w, bodyH: this.h,
        // ★BJ375：mode0 残影角 = 本体有效旋转（vanilla num177=proj.rotation,
        //  Main.cs:31333-31335——AI_001 系弹 rotation=atan2+1.57f :58733）。
        //  此前传裸 ang → 缺省支（ang+1.57）弹族残影整体落后 π/2：664/666/668
        //  爆炸烈焰弹残影画成「未旋转直立彗星」散落速度向轨迹 = 用户实报
        //  「弯月/钩状缺半贴图」。★旧注「GHOST_PARAMS 全族∩特判旋转集=空（BJ375
        //  普查）」自 BJ582②（1026 入 PROJ_ROT_RIGHT）起即为假——交集=PROJ_GHOST_
        //  MIRROR0 全集 {408,435,459,682,1026}（随 BJ704-G10 勘正;除 409 自旋特例
        //  与 503/660 独占支外,其余 mode0 族仍恒=缺省支;mode2/3/4 rotMul=0 不消费）。
        //  ★BJ700-A：408 入 PROJ_ROT_RIGHT 后 ghost 角随本体分派族走——原版 ghost
        //  num177 = proj.rotation（Main.cs:31333）= ToRotation + (direction==−1 ? π : 0)
        //  （:58616-58621）;且 :31334 `SpriteEffects spriteEffects = dir` = mode0 ghost
        //  恒吃本体当前翻转（本仓 mode0 原无翻转通道,mirror 选项本刀补——其余 mode0
        //  成员维持现状,flip 缺面另案登记）。662/685 无 ghost（TrailingMode=-1）。
        bodyRot: isTy409 ? this.spinRot
          : PROJ_GHOST_MIRROR0.has(this.projId) ? ang + (this.vx < 0 ? Math.PI : 0)   // ★BJ700-A 408/★BJ703-B D2 435·682/★G10 1026：随本体 RIGHT 族（含左飞 +π）
          : ang + 1.57,              // ★G10（R2-F13）：原版字面 1.57f（:58733,非 π/2=1.5708;残差 0.0008rad 纪律归位）。409=自旋角（:32555）;余 mode0 族=缺省支
        bodyScale: this.projId === 459 ? this.ai1Scale459 : 1,   // ★G10（件10）：459 AI 块 scale=ai[1] 三档（:55633,ghost 环 end=(int)(scale×8)/step 端消费）;余=缺省 1（660=1.1 已排除集）
        bodyAlpha: isTy409 ? 200 / 255 : ghostA, // 409=GetAlpha A 侧恒值（fade=(10−i)/15 环内通用式相乘）
        // ★BJ235 ai1 喂入（登记④清偿——AI_171/172/173 族 hue=(ai[1]+0.5)%1 不随时间
        //  cycle,值=发射点注入静态档）：873 已有 empressHue 通道（bossAI_lategame
        //  :1747 NPC.ai[1]/60）;872 同注（:46982 num65=k/13）;931/1039 未实现载体
        //  （FQW 弹/星座弹）——通道就绪,注入日自动点亮。1097 ai1==1 分支仅 1113
        //  宿主弹（:62744 num159）,本仓 1097 生成面 ai[1]≡0（fox 注）=恒 0 档 1:1。
        ai0: 0,
        ai1: this.empressHue ?? 0,
        timeLeft: this.life,
        opacity: Math.max(0, Math.min(1, 1 - this.alpha / 255)),
        vxLen: Math.hypot(this.vx, this.vy),
        spriteDirection: this.vx < 0 ? -1 : 1,
        // ★BJ700-A mode0 本体翻转（:31334 spriteEffects=dir）;★BJ703-B D1/D2：
        //  mirror=dir 基底单源——mode0 RIGHT 族（408/435/682,左飞镜像）+ mode3 豁免员
        //  1001（AI_194 :42056 每拍 spriteDirection=sign(vx)≥0?1:-1,豁免档=基底直取
        //  :31336-31344——旧豁免=恒不翻,南瓜弹左飞残影缺镜像=本刀补）;mode2/3/4
        //  其余成员原版零 spriteDirection 写（基底恒 None）不传。
        mirror: (PROJ_GHOST_MIRROR0.has(this.projId) || this.projId === 1001) && this.vx < 0,
      });
    }
    // ★BJ-C1 F3（2026-10-06）常量色族通用全亮通道（BJ529 270/BJ530 44·45 判例通用化,
    //  vanillaProjAlpha kind 驱动+白 rgb 门,活体普查=R1 报 ≥52 站实体层乘光）：常量色
    //  弹面 GetAlpha 不读格光色（Main.cs:30068 光色被整体替换）=光照无关——本体画进
    //  实体层被 compositeLight 全屏乘光压暗（暗腔实测 k=0.325,BJ529 探针）。承接=
    //  通用 capture：本段（本体 save→restore,含全部专支/帧选/镜像/滤链——逐位执行
    //  只换落笔目标）经 recording-ctx 全量记录,flushTrailShade 7f 光照合成后
    //  source-over 重放=原版逐字。ghost/trail 面（本段之前）不收编=原版残影逐位
    //  取光同相;GA 专属档/加算族/charm 分流自理者不入门（constFullbrightGate）。
    //  判别代表站=502 Meowmere（本门）/633 Prism（PrismProj）/933 Zenith
    //  （ZenithSword）;其余=表驱动分类器结构锁（bj-c1 套件）。
    let fbRec: RecOp[] | null = null;
    let fbCommit: ((c: CanvasRenderingContext2D) => void) | null = null;
    // ★BJ-C9 F4（2026-10-08）：白 rgb 门（既有单笔通道）之外的彩色/灰阶常量族走
    //  tint 档（projConstTint 表驱动,8 站=R8 红队普查面:308/329/348/349/498/518/
    //  553/969）——同一 recording-ctx 捕获,消费侧双通道 replay（replayTintedFullbright）。
    const gateFullbright = this.constFullbrightGate();
    const tintRgba = gateFullbright ? null : projConstTint(this.projId);
    // addGa（add 面 rgb 侧衰减）：fixed/afade rgb 恒定=1;fixedfade rgb=A 同折
    // (1−α/255)（518/969）——erase 面 ga 已含流内 A 折,add 面补 rgb 侧折（分离式）。
    const tintAddGa = tintRgba
      ? (PROJ_ALPHA_MOD[this.projId]?.kind === 'fixedfade'
        ? Math.max(0, 1 - this.alpha / 255) : 1)
      : 1;
    // ★BJ668（2026-10-12）Lerp 族光感算子通道（与常量色族两门互斥显式守卫——kind 集
    //  不相交,防谓词漂移双入队）：capture 本体段（逐位执行只换落笔目标,BJ-C1 F3 同契）,
    //  finally 段【基底立即重放】回实体 ctx（流内含 tableFilter=brightness(1−k) 与
    //  ga——与直绘逐位等值,z-order 同拍保持）+【lift 闭包】入 projFullbrightQueue
    //  （replayLerpLift:光照后 'lighter' ×k 复绘）→ base×light + lift ≡ 原版
    //  Lerp(light,White,k)（vanillaProjAlpha 头注 BJ668 恒等块;活跃 11 站=342/435/
    //  595/664/666/668/712/735/920/921/926,休眠站同门待出生面点亮）。
    let liftRec: RecOp[] | null = null;
    let liftCommit: ((c: CanvasRenderingContext2D) => void) | null = null;
    const liftK = (gateFullbright || tintRgba) ? null : this.lerpLiftGate();
    if (gateFullbright || tintRgba) {
      fbRec = [];
      const rc = createRecBodyCtx(fbRec);
      fbCommit = rc.commit;
      ctx = rc.proxy;
    } else if (liftK !== null) {
      liftRec = [];
      const rcL = createRecBodyCtx(liftRec);
      liftCommit = rcL.commit;
      ctx = rcL.proxy;
    }
    try {
    ctx.save();
    ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
    // alpha 通道（修复4）：GetAlpha 近似 → globalAlpha（present/phantasm/piranha 等
    // 专属档在下方各自覆写，id 集不相交）；drawGlobalAlpha 未接的 id 落全量表
    // （vanillaProjAlpha.ts ← Projectile.cs:75940-76850，off=1 登记项不消费）
    const ga = this.drawGlobalAlpha();
    let tableFilter: string | null = null;
    if (ga !== null) ctx.globalAlpha = Math.max(0, Math.min(1, ga));
    else {
      const mod = this.drawTableAlpha();
      if (mod) {
        ctx.globalAlpha = Math.max(0, Math.min(1, mod.ga));
        tableFilter = mod.filter;
      } else {
        // ★GetAlpha 缺省路径全局兜底（2026-09-01 全弹域审计补；Projectile.cs:81507-81521）：
        //   num14=(255−alpha)/255、r/g/b×num14、A=clamp(newColor.A−alpha,0,255) ——
        //   两表均未接的 id 此前残留满显(globalAlpha 保持外部值);α≡0 未动的绝大多数
        //   弹型此式恒 ×1 零观感差,AI 会改写 alpha 的未来型自动正确
        ctx.globalAlpha = Math.max(0, Math.min(1, (255 - this.alpha) / 255));
      }
    }
    const xenoFilter = this.drawXenoFilter();
    if (xenoFilter) ctx.filter = xenoFilter;
    else if (tableFilter) ctx.filter = tableFilter;
    // ---- 宝石法珠弹芯脉冲（2026-08-26 用户实报批,1458 Main.cs:33667-33690）----
    // 像素贴图本体 alpha=255 隐身（drawGlobalAlpha 侧已归零）;可见"芯"= 同心四层
    // Color(80,80,80,0) 叠画（XNA 预乘 A=0 → src.rgb 全额加算 ≈ 每层 +31.4% 灰,
    // canvas 'lighter'+grayscale(1)×α0.314 复刻），scale = 弹速向姿态
    // base(X×1.25 早期通支 :33201-33203) × (1+cos(GlobalTime·2π)·0.2) × 0.6 慢脉冲;
    // BiggerHitbox（126/钻/全特性臂）：再叠 (80,80,80,0)×0.5 的 (1,f)/(f,1)
    // 双正交拉伸层（rot+π/4,4Hz 快脉冲 f=1+cos(GTW·8π)·0.2,:33681-33689）
    if (isGemBolt(this.projId) || this.projId === 1120) {
      const imgG = img;
      // （注：已处于外层 save+translate(弹心) 坐标系内——此处只转姿态不再平移）
      // ★2026-09-02 旋转提出贴图卫门:姿态变换独立于贴图在否(无贴图=空旋转,vanilla
      //   同语义)——卫门内曾令 node 单测/无图环境 rotate 缺失(proj-rotation 121 例红)
      ctx.rotate(ang);                                       // num341 = velocity.ToRotation()
      if (imgG && (imgG.width > 0)) {
        const gtS = globalTimeWrappedHourly();                // GlobalTimeWrappedHourly——★BJ330 GTW 单源（原 performance.now 墙钟）
        const slowPulse = 1 + Math.cos(gtS * Math.PI * 2) * 0.2;
        const sBase = this.drawScale;
        const iw0 = imgG.width * sBase, ih0 = imgG.height * sBase;
        ctx.globalCompositeOperation = 'lighter';
        ctx.filter = 'grayscale(1)';
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = 1;
        for (let i = 0; i < 4; i++) {                          // 四层同心灰芯
          ctx.globalAlpha = 0.314;                             // +80/255 每层
          const sw = iw0 * 1.25 * slowPulse * 0.6, sh = ih0 * slowPulse * 0.6;
          ctx.drawImage(imgG as CanvasImageSource, -sw / 2, -sh / 2, sw, sh);
        }
        ctx.filter = 'none';
        if (this.gem?.biggerHitbox) {
          const fb = 1 + Math.cos(gtS * Math.PI * 2 * 4) * 0.2;   // 4Hz
          ctx.globalAlpha = 0.157;                             // color104 × 0.5
          const iwC = iw0, ihC = ih0;
          ctx.save();
          ctx.rotate(Math.PI / 4);
          let swx = iwC * fb, shy = ihC * fb * 2;
          ctx.drawImage(imgG as CanvasImageSource, -swx / 2, -shy / 2, swx, shy);
          ctx.restore();                                       // （vanilla: base(1,f)/(f,1) 双层）
          ctx.save();
          ctx.rotate(Math.PI / 4);
          swx = iwC * fb * 2; shy = ihC * fb;
          ctx.drawImage(imgG as CanvasImageSource, -swx / 2, -shy / 2, swx, shy);
          ctx.restore();
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.filter = 'none';
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      return;
    }
    // 329 焰镰（aiStyle 56）：rotation 恒自旋（不对齐速度）；spriteDirection<0 水平镜像
    if (this.scytheRot !== null) {
      ctx.rotate(this.spinRot);
      if (this.scytheFlip < 0) ctx.scale(-1, 1);
      const scyImg = projSprite(this.projId);
      ctx.imageSmoothingEnabled = false;
      if (scyImg && (scyImg as HTMLImageElement).complete !== false && scyImg.width > 0) {
        ctx.drawImage(scyImg, -scyImg.width / 2, -scyImg.height / 2, scyImg.width, scyImg.height);
      }
      ctx.restore();
      return;
    }
    // 351 礼盒（aiStyle 58）：帧 0/1 随两段重力态；淡入 alpha
    if (this.present) {
      ctx.globalAlpha = Math.max(0, Math.min(1, 1 - this.presentAlpha / 255));
    }
    // 452 幻影矢（aiStyle 82 :30121-30125 alpha 255−40/t 渐显）/
    // 454 幻影球（aiStyle 83 :30238-30245 alpha 钳 200 后 −5/t，GetAlpha 语义）
    if (this.phantasm) {
      ctx.globalAlpha = Math.max(0, Math.min(1, 1 - this.phAlpha / 255));
    } else if (this.phantomOrb) {
      ctx.globalAlpha = Math.max(0, Math.min(1, 1 - this.orbAlpha / 255));
    }
    // 朝右贴图族（PROJ_ROT_RIGHT）：rotation=atan2(vy,vx)（vanilla :26122-26140 模式），
    // 向左运动水平镜像（spriteDirection 语义）；其余默认朝上 atan2+π/2（AI_001 L54877）
    const rightArt = PROJ_ROT_RIGHT.has(this.projId);
    const flipLeft = this.piranha ? this.pFlip : this.vx < 0;
    if (rightArt && flipLeft) {
      ctx.scale(-1, 1);              // 先镜像再旋转（R(π−ang)∘M ≡ 原版 flip+atan2(−vy,−vx)）
      ctx.rotate(Math.PI - ang);
    } else if (PROJ_SPIN[this.projId]) {
      ctx.rotate(this.spinRot);      // 恒旋族（:54741/:54824 累加不对齐速度）
    } else if (this.mlBoulder) {
      ctx.rotate(this.spinRot);      // 1021 巨砾滚动旋转（:24666 rotation += vx·0.06 累积）
    } else if (this.projId === 1024) {
      ctx.rotate(this.spinRot);       // 杀意牌 ai[2] 自旋（R35 清单⑥）
    } else if (this.projId === 409) {
      ctx.rotate(this.spinRot);       // ★BJ371 剃刀台风自旋（:30878 rotation += velocity.X×0.1f 触发位累积;非速度角对齐）
    } else if (this.projId >= 167 && this.projId <= 170) {
      ctx.rotate(ang + Math.PI / 2);  // 烟花（AI_034 :30xxx rotation=velocity+π/2）
    } else if (PROJ_NO_ROT.has(this.projId)) {
      /* 直立族（aiStyle 29 零 rotation）：恒不旋转 */
    } else if (PROJ_ROT_ASIS.has(this.projId)) {
      ctx.rotate(ang);               // R27：宝石珠 rotation=velocity.ToRotation()（:38691）
    } else if (PROJ_ROT_DOWN.has(this.projId)) {
      ctx.rotate(ang - Math.PI / 2); // 631 幻象矢（AI_122 尾 :35613 减号——贴图朝下族,见 PROJ_ROT_DOWN 注）
    } else if (PROJ_ROT_NW.has(this.projId)) {
      ctx.rotate(ang - Math.PI - Math.PI / 4); // ★BJ700-A 662/685 DD2 标枪（AI_001 尾 :58626-58629 ToRotation−π−π/4,贴图固有 225°,恒不翻转）
    } else if (this.projId === 477 && this.dartRot !== null) {
      ctx.rotate(this.dartRot);      // 477 水晶镖平滑姿态（:58666-58676，AI 侧维护）
    } else if (this.bee36Tilt !== null) {
      ctx.rotate(this.bee36Tilt);    // aiStyle 36 蜂族（:27716 rotation = velocity.X*0.1f
    } else {                         //   ——微倾不振转；307 小吞噬者 = atan2−π/2（:27698）
      ctx.rotate(rightArt ? ang
        : PROJ_ROT_DIAG_0P785.has(this.projId) ? ang + 0.785   // ★G11（件4）：aiStyle 27 剑气 原文字面 0.785f（:26910-26911,非 π/4——残差 0.0004rad 字面纪律对齐）
        : PROJ_ROT_DIAG_PI4.has(this.projId) ? ang + Math.PI / 4   // 660/451 π/4 字面支（:58632/:31582）
          : ang + 1.57);             // ★G10（R2-F13 字面纪律）：AI_001 缺省 up 族原版字面 1.57f（:58733,非 π/2≈1.5708;旧 π/2 残差 0.0008rad）
    }
    // 469 蜂箭（:54789-54798）：vx>0 → spriteDirection=-1（贴图朝左，源翻转语义）
    if (this.projId === 469 && this.vx > 0) ctx.scale(-1, 1);
    // 114 邪恶三叉戟绘制原点 = (width−12,12)=(4,12)（Main.cs:33187-33189）非盒心,
    // scale 1.5 → 旋转系内自中心原点平移 ((8−4)×1.5, (8−12)×1.5)=(6,−6)
    if (this.projId === 114) ctx.translate(6, -6);
    // 316 蝙蝠杖蝠（:27704-27710）：vx>0 → spriteDirection=-1（蝠贴图朝左）——
    // 其余蜂族 spriteDirection=sign(vx) 与贴图原生朝向一致不翻转（:27699-27715）
    if (this.projId === 316 && this.vx > 0) ctx.scale(-1, 1);
    // 502 朝向（:22659-22665）：spriteDirection=sign(vx)——贴图在旋转坐标系内水平镜像
    if (this.projId === 502 && this.vx < 0) ctx.scale(-1, 1);
    ctx.imageSmoothingEnabled = false;
    // 食人鱼淡入（aiStyle 39 :27909-27913：alpha 255 起 −50/t，6t 归零）
    if (this.piranha) ctx.globalAlpha = Math.max(0, Math.min(1, 1 - this.pAlpha / 255));
    // 多帧行（190 食人鱼 4 帧/837 3 帧）按帧行切片防胶片压扁；单帧走整图。
    // 食人鱼帧号由 AI 推进（:28159-28168 frameCounter≥4 推帧 4 帧循环），
    // 其余型号沿用 age/5 档
    const frames = projFrameCount(this.projId);
    const fIdx = this.piranha ? this.pFrame
      : this.phantomOrb ? this.orbFrame      // 454 帧：列队 6t 切 0/1 / 齐射恒 1（:30250/:30261-30266）
        : this.martianRocket ? this.rkFrame   // 448 帧：3t/帧 3 帧循环（:29862-29868）
          : this.present ? this.presentStage    // 351 礼盒帧 0/1 随两段重力态（:27736/:27749）
            : this.projId === 485 ? this.hwFrame   // 485 狱翼扇翅帧：2 拍/帧 5 帧循环（:54834-54843）
              : this.bee36Tilt !== null ? this.bee36Frame   // aiStyle 36 蜂族：3/6 拍/帧（:27699/:27720）
                : this.pinFrame !== null ? this.pinFrame    // ★R28 337 帧恒 ai[1]（发射掷,AI 不推进 :57927）
                  : this.projId === 467 ? this.f467Frame    // 教徒火球：3 拍/帧 4 帧循环（:55208-55218）
                    : this.projId === 409 ? this.ty409Frame // ★BJ371 剃刀台风：触发位写帧 (int)(localAI[1]/3f)%3（:30879）
                      : this.projId === 459 ? this.f459Frame // ★G10（件10）：充能爆破炮弹 3t/帧 3 帧循环（:55622-55631 frameCounter≥3 推帧 ≥3 回卷;AI 块维护）
                      : (this.projId === 435 || this.projId === 682) ? Math.floor(this.age / 3) % frames   // ★G10（R2-F11）：435/682 AI_001 专属块 frameCounter≥3 推帧 4 帧回卷（:55887-55896/:55923-55932）=3t/帧（EU=0 age=update 数;旧通用 age/5=5t/帧）
                      : PROJ_FRAME_STATIC0.has(this.projId) ? 0   // ★BJ700-A 408/★G10 614：原版无帧推进支恒帧 0（见 PROJ_FRAME_STATIC0 注）
                    : (this.projId === 660 || this.projId === 712) ? this.f712Frame
                      // 660 天界碎裂：出生 Next(14) 掷定恒定帧（AI_001 :56651 写入,
                      //   DrawProj 手切 38×frame 横切 :30974-30980——本表 PROJ_GRID[660]
                      //   消费;无逐帧动画）/ 712 书杖弹：AI 推帧 4 拍/帧两带各 4 帧
                      //   （:56664-56678,projFrames=8 :8596）
                      : Math.floor(this.age / 5) % frames;
    const frameImg = frames > 1 ? projFrameImg(this.projId, fIdx) : null;
    let drawImg: CanvasImageSource | null = frameImg ?? img;
    // R4-32（GetAlpha,Projectile.cs:80604-80613）：aiStyle1 且 PhoenixQuivered||
    // SeraphNecklaced → 箭体画 Color.White*Opacity（全亮）——白帧缓存逐 id 烘焙
    if (this.phoenixQuivered || this.seraphNecklaced) {
      const src = frameImg ?? img;
      if (src) drawImg = whiteSpriteOf(this.projId, frames > 1 ? fIdx : -1, src) ?? drawImg;
    }
    if (drawImg && (drawImg as HTMLImageElement).complete !== false
      && (drawImg.width > 0 || (drawImg as HTMLImageElement).width > 0)) {
      const isXeno = Arrow.XENO_GLOW.has(this.projId);
      // 原生尺寸 × SetDefaults scale（与判定盒 w/h 解耦）：子弹 14 = 2×20×1.2
      // 曳光条；箭 1 = 14×32 贴图 × 1。曾统一拉成 w×w 宽 → 100px 巨型子弹/箭偏小
      // 454 随 alpha 伸展（:30244-30245 scale = 1−alpha/255）
      const s = this.drawScale * (this.phantomOrb ? 1 - this.orbAlpha / 255 : 1);
      const iw = drawImg.width || (drawImg as HTMLImageElement).width;
      const ih = drawImg.height || (drawImg as HTMLImageElement).height;
      // GetAlpha=(200,200,200,25) 加算族（Projectile.cs:81007：15 火球/34 火焰鞭/
      // 93 魔法匕首/94 水晶风暴/95 诅咒之焰/96 敌诅咒火/1114 日耀花/253 霜球/258 火球
      // /102 Prime 炸弹(alpha<255)）——XNA 预乘语义 RGB 全额加算（2026-08-24 清零批
      // 扩族；source-over 直译=半透灰/死板不透明两态皆非）。
      // ★E′ M-2（2026-09-02）：5 charm 态出组走常规合成（GetAlpha :80609-80615
      // `aiStyle1 → White*Opacity` 先于 :81240 加算支截走,乘子非加算）——仅
      // id5+charm 分流,组内其余 id 恒留组零改动（组∩箭族={5,631},631 charm 面
      // 本批未裁决不动,登记）。★T1（同日）：91 圣箭波同属 aiStyle1,charm 截走
      // 同案成立（SetDefaults aiStyle=1 :1745-1754）——分流同式扩展到 91。
      // ★遗留批（同日）：265/355 同属 aiStyle1（vanilla-projectiles.json aiStyle=1）
      // → charm 分流同式扩员（GA alpha0additive 档内已回 fade,此处同步摘 lighter）。
      if (ADDITIVE_GLOW_PROJS.has(this.projId)
        && !((this.projId === 5 || this.projId === 91
          || this.projId === 265 || this.projId === 355)
          && (this.phoenixQuivered || this.seraphNecklaced))) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(drawImg as CanvasImageSource, -iw * s / 2, -ih * s / 2, iw * s, ih * s);
        ctx.globalCompositeOperation = 'source-over';
      } else {
        ctx.drawImage(drawImg as CanvasImageSource, -iw * s / 2, -ih * s / 2, iw * s, ih * s);
      }
      if (isXeno) {
        // 加算发光叠画（同矩形 lighter α0.45）——原版 GlowMask 214 族观感；
        // ★基线 alpha 捕获-恢复（2026-09-01 review）：曾回写 `ga ?? 1`，
        //   在 GA null+mod null 时会把缺省兜底 (255−α)/255 抹成满显
        const baseGa = ctx.globalAlpha;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha *= 0.45;
        ctx.drawImage(drawImg as CanvasImageSource, -iw * s / 2, -ih * s / 2, iw * s, ih * s);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = baseGa;
      }
    }
    // ★P0-B（2026-09-27）贴图未就绪帧不画（旧「短线兜底」已摘）：该支在 acc 态
    //  =每弹每帧 beginPath/stroke 路径 op→rasterizePathOp 隔离栅格化+共享 scratch
    //  整幅上传——违 proj1457.ts:1780「本通道只可承载低频落笔」判例;发布面贴图
    //  404（如 Projectile_618 小写案,见 P0-A）时=永久逐帧全幅上传病。原版贴图
    //  加载期亦短暂隐形（XNA 内容管线同步装载,本仓懒加载 1-2 帧到位自愈,持续
    //  失败由 projSprite 10s TTL 对账自愈）;缺图诊断走 projSpriteHealth（F5 报告）,
    //  不再以逐帧路径 op 为代价。
    ctx.restore();
    } finally {
      // ★BJ-C1 F3：段内专支（gem/329）早退也照常提交（finally 兜底）——记录面
      //  为空（如贴图未就绪整段零落笔）则不入队零开销。
      //  ★BJ-C9 F4：tint 档（彩色/灰阶常量族）走双通道 replay（erase+add,XNA
      //  One/InvSrcAlpha 两因子分离精确）,白 rgb 门内维持单笔 commit。
      if (fbCommit && fbRec && fbRec.length) {
        const commit = fbCommit;
        const tint = tintRgba;
        const addGa = tintAddGa;
        (r as unknown as {
          queueProjFullbright?: (fn: (c: CanvasRenderingContext2D) => void) => void;
        }).queueProjFullbright?.((c) => {
          if (tint) replayTintedFullbright(fbRec!, c, tint, addGa);
          else commit(c);
        });
      } else if (liftCommit && liftRec && liftRec.length && liftK !== null) {
        // ★BJ668 两遍制：基底立即重放回实体 ctx（流内 filter=brightness(1−k)+ga
        //  与直绘逐位等值——本体重进乘光实体层,×(1−k) 项被 compositeLight 乘光同相）;
        //  lift 闭包=光照后 'lighter' ×k 复绘（白抬升项不乘光）。基底先于入队=实体层
        //  z-order 与直绘同拍保持;无队列回退（mock/探针）=基底直绘+lift 缺席=旧暗场
        //  失真上界,与 251/465 判例同守卫域（登记）。
        const baseCommit = liftCommit;
        const recL = liftRec;
        const kL = liftK;
        baseCommit(r.ctx!);
        (r as unknown as {
          queueProjFullbright?: (fn: (c: CanvasRenderingContext2D) => void) => void;
        }).queueProjFullbright?.((c) => {
          replayLerpLift(recL!, c, kL);
        });
      }
    }
  }

  /** 统一消亡出口（Projectile.Kill 语义钩子）：碎镜 1085 近身 150px 坏运等
   *  按弹型分发由 Game 侧 onProjectileDeath 消费 */
  private killNow(game: GameHooks): void {
    // ★⑥杀拍口径（2026-09-06）幂等门：Projectile.Kill 头 :71763-71766
    //  `if (!active) { return; }`——原版本就防重入（杀拍湿段的水death :16923/80
    //  :16941 在 active=false 弹上再调 Kill=原版同位 no-op）。本仓此前靠调用侧
    //  `!this.dead` 内门防重入,湿段杀拍补跑（subStep dead 支）引入"已死弹再进
    //  段内 Kill 位"的合法路径 → 门上收到口（各 `!this.dead` 内门变冗余,保留无害）
    if (this.dead) return;
    const ovx485 = this.vx, ovy485 = this.vy;   // 485 oldVelocity 快照(:74499,清零前取)
    // ---- 485 狱翼蝠 Kill(Projectile.cs:74493-74501):15×尘6,noGravity,
    //      v -= oldVelocity×Next(20,60)×0.01(=0.2..0.6 倍逆冲)〔B2,2026-09-02 补〕----
    if (this.projId === 485) {
      for (let i = 0; i < 15; i++) {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 6);
        if (d) {
          d.noGravity = true;
          d.vx -= ovx485 * (Math.floor(Math.random() * 40) + 20) * 0.01;
          d.vy -= ovy485 * (Math.floor(Math.random() * 40) + 20) * 0.01;
        }
      }
    }
    // 448 火箭：Kill 全路径 = 爆炸（Projectile.Kill :70544-70580——Item14 音 +
    // 判定盒外扩 112×112 重结算 Damage() + 尘 31×4/228×80；近身 42/撞块/180t
    // 自毁全部走此口）
    if (this.martianRocket) this.rocketExplode(game);
    // ---- ★BJ704-G21 R8-F3：502 喵刀 Kill 消散尘（Projectile.Kill :75080-75094）
    //      ——一切 502 死亡路径共段（死亡跳 meowBounceOff→killNow / 寿命尽 / 出界
    //      :10181 均达此口）：oldPos 逐点（零位=未踩点跳过）尘 66（随机 hsl(h,1,0.5)
    //      彩色,α150,scale0.7,noGravity;出生位=历史位+半盒=历史心）。meowTrail=
    //      oldPos 10 点仓内承载（G2/G9 既有,subStepAI 逐子步 push,706 extraUpdates=0
    //      同步）。旧仓 killNow/onProjectileDeath 均无 502 支=整缺（红队 R8-F3;
    //      meowTrail 唯一消费者曾是飞行拖尾绘制 :4184）。 ----
    if (this.projId === 502) {
      for (let i = 0; i < this.meowTrail.length; i += 2) {
        const px = this.meowTrail[i]!, py = this.meowTrail[i + 1]!;
        if (px === 0 && py === 0) continue;               // :75084 oldPos 零位跳过
        const rgb = empressHslRgb(Math.random());         // hslToRgb(NextFloat,1,0.5)——A=255（Main.cs:48689 默认参）
        const d = game.spawnDust?.(px + this.w / 2, py + this.h / 2, 0, 0, 66,
          0, 0, 150, null, 0.7, true);
        if (d) d.color = { r: rgb[0], g: rgb[1], b: rgb[2], a: 255 };
      }
    }
    // ★BJ348 618/620 Kill 尘爆（Projectile.Kill :73671-73740 共段）：10× 尘
    //   （618→86 / 620→ai[0]=na620Dust,vel×0.1 种,α0,scale 0.5）——1/3 升档
    //   （type+1、fadeIn 0.75±0.10、scale 0.25±0.05）/ else scale 1.0±0.10；
    //   noGravity + vel×1.25 + vel−=oldVelocity/10 逆冲（oldVelocity 取杀拍速度快照,
    //   485 同款先例）。618=父亡/420t 自然亡的可见消散,620=碎片落地/命中的可见消散。
    if (this.projId === 618 || this.projId === 620) {
      const dustBase618 = this.projId === 618 ? 86 : this.na620Dust;
      for (let i = 0; i < 10; i++) {
        const bump = Math.random() < 1 / 3;
        const tKill = bump ? dustBase618 + 1 : dustBase618;
        const dK = game.spawnDust?.(this.x, this.y, this.w, this.h, tKill,
          this.vx * 0.1, this.vy * 0.1, 0, null, 0.5, true);
        if (dK) {
          if (bump) {
            dK.fadeIn = 0.75 + (Math.floor(Math.random() * 21) - 10) * 0.01;
            dK.scale = 0.25 + (Math.floor(Math.random() * 21) - 10) * 0.005;
          } else {
            dK.scale = 1 + (Math.floor(Math.random() * 21) - 10) * 0.01;
          }
          dK.vx = dK.vx * 1.25 - this.vx / 10;
          dK.vy = dK.vy * 1.25 - this.vy / 10;
        }
      }
    }
    // 斗篷星落地(Kill :76692-76748)——★R1 红队逐参修正:723=NewDustDirect(88,
    // v×0.1,150,s1.2)+noGravity+仅 X ×2(终值 vx×0.2/vy×0.1);else 桶(724/725/726/
    // 1133→d57/907→d58)无 noGravity 无 ×2(907 尘 vel×0.75);音 723/724/725/726/
    // 1133=Item10、907=Item27;碎砾 723=SelectRandom(16,17,17) 后 ×2、else=
    // rand(16,18) 不乘(907 ×0.5);法力档(ai2=1 ≙ manaStar)→ RequestNewItem(4143)
    if ([723, 724, 725, 726, 907, 1133].includes(this.projId) && !this.dead) {
      const is723 = this.projId === 723;
      const dustT = is723 ? 88 : this.projId === 1133 ? 57 : 58;
      game.playSfxFile?.(this.projId === 907 ? 'Item_27' : 'Item_10', 1, this.cx, this.cy);
      for (let i = 0; i < 10; i++) {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, dustT,
          this.vx * 0.1, this.vy * 0.1, 150, null, 1.2);
        if (d) {
          if (is723) { d.noGravity = true; d.vx *= 2; }
          else if (this.projId === 907) { d.vx *= 0.75; d.vy *= 0.75; }
        }
      }
      for (let i = 0; i < 3; i++) {
        const g = is723
          ? GorePiece.newGore([16, 17, 17][Math.floor(Math.random() * 3)], this.cx, this.cy,
            this.vx * 0.05, this.vy * 0.05)
          : GorePiece.newGore(16 + Math.floor(Math.random() * 2), this.cx, this.cy,
            this.vx * 0.05, this.vy * 0.05);
        if (g) {
          if (is723) { g.vx *= 2; g.vy *= 2; }
          else if (this.projId === 907) { g.vx *= 0.5; g.vy *= 0.5; }
        }
      }
      if (this.manaStar) game.spawnDrop?.(this.x, this.y, 'vi_4143_manacloakstar', 1);
    }
    // ---- 绳圈余料返还（Projectile.cs:79303-79316，2026-08-30 孤儿武器 A 波工单2）：
    //      Kill→Kill_ExplodeTiles(:78990/:78995) 尾段按 ai[1] 结算——0 铺绳 →
    //      原圈件 ×1；1≤ai[1]<10 → 散绳 ×(10−ai[1])；满 10 无返还。锚点=
    //      RequestNewItem(base.Center)：弹体【消亡点】(撞面贴面位/绳列顶端,
    //      AI_035 position+=vector27 后 Center :27638)——非投掷者位置;
    //      ReserveForLocalPlayer 仅限拾取归属不改落点(:49644)。挂在 killNow
    //      单口而非铺绳支：原版铺绳尾 Kill(:27720)与 timeLeft=400 空中到期
    //      Kill(:17307-17311)同达此口——曾缺 = 投一整圈全吞（蓝队 finding A-1）
    if (ROPE_COIL_RETURN[this.projId] !== undefined && !this.dead && this.ropeAi1 < 10) {
      const rc = ROPE_COIL_RETURN[this.projId];
      if (this.ropeAi1 === 0) {
        const ck = VANILLA_ITEM_KEY_BY_ID[rc.coil];
        if (ck) game.spawnDrop?.(this.cx, this.cy, ck, 1);
      } else {
        const lk = VANILLA_ITEM_KEY_BY_ID[rc.loose];
        if (lk) game.spawnDrop?.(this.cx, this.cy, lk, 10 - this.ropeAi1);
      }
    }
    // ---- 晶洞弹 772 Kill（Projectile.cs:76566-76608，2026-08-30 孤儿武器 A 波工单5；
    // 蓝队 A-7 复核修正）：dig 音 + 尘 1×6 + 宝石尘 86-90 ×20（noGravity、v×2.9、
    // vy×0.8、fadeIn 1.1）+ ×7 同款再 noLight——owner==myPlayer 再 DropGeodeGems。
    // ★A-7：循环里对【弹体】的 velocity×1.9 六连写是反编译字面残留（Kill 内宝石尘
    // NewDustDirect 显式 SpeedX=SpeedY=0、本仓 onProjectileDeath 无 772 分支 → 无下游
    // 读者）——原样保留但绝不作尘种速：宝石尘初速 = Dust.NewDust 内建抖动
    // Next(-20,21)×0.1=±2.0px/t（本仓 VanillaDust.spawn 已同式实现），经 v×2.9/Y×0.8
    // 终值 ±5.8/±4.64；曾错把乘过 ~47× 的弹速当种速再乘 2.9 ⇒ 数百 px/t 一帧暴闪。
    if (this.projId === 772 && !this.dead) {
      game.playSfx?.('dig', 1, this.cx, this.cy);            // PlaySound(0,...)（:76567）
      for (let i = 0; i < 6; i++) {
        game.spawnDust?.(this.x, this.y, this.w, this.h, 1);
        this.vx *= 1.9;
        this.vy *= 1.9;                                       // :76571 velocity *= 1.9f（死码，见头注）
      }
      for (let i = 0; i < 27; i++) {                          // 20(:76573)+7(:76582)
        const dd = GEODE_GEM_DUST[(Math.random() * 5) | 0];   // rand.NextFromList(86..90)
        const d2 = game.spawnDust?.(this.x, this.y, this.w, this.h, dd,
          0, 0, 0, null, 0.7);                                // ★A-7：SpeedX=Y=0（:76575/:76584）
        if (d2) {
          d2.noGravity = true;
          d2.vx *= 2.9;
          d2.vy = (d2.vy * 2.9) * 0.8;                        // 先 ×2.9 后 Y×0.8（:76578/:76588）
          d2.fadeIn = 1.1;                                    // 生长目标语义（:76580 red 备注补项）
          if (i >= 20) d2.noLight = true;                     // :76590 第二段尘 noLight
        }
      }
      // DropGeodeGems（:80304-80316）：池 [181,182,180,178,179,177,999] 无放回抽 2 种,
      // 各 Next(3,7)=3-6 个——RequestNewItem(Center) 本仓落点取弹心
      const pool = [...GEODE_GEM_POOL];
      for (let g = 0; g < 2; g++) {
        const vid = pool.splice((Math.random() * pool.length) | 0, 1)[0];
        const key = VANILLA_ITEM_KEY_BY_ID[vid];
        if (key) game.spawnDrop?.(this.cx, this.cy, key, 3 + ((Math.random() * 4) | 0));
      }
    }
    // ★2026-08-26 宝石法珠 Kill 公共段（Projectile.cs:76985-77010,1458；用户实报批）：
    // SoundEngine.PlaySound(0)=Dig 音 + 15 枚同色尘（noGravity、scale×1.25、
    // v=dir:(v<1 归零向) → ×2.2 +dir×1.5 → ×randFloat——六连式与原版逐式对齐）。
    // ★2026-09-02 审计：121-126/597 的同款在 Game.onProjectileDeath:30068 已有单口
    // （killNow 尾统一回调）——本支曾条件重复=双音双尘；收窄为仅 1120（其 Kill 面
    // d170×15+30 OPD 无对应）
    if (this.projId === 1120 && !this.dead) {
      game.playSfx?.('dig', 1, this.cx, this.cy);            // PlaySound(0,...)（:76987）
      const kSpd = Math.hypot(this.vx, this.vy);
      const kdx = kSpd < 1 ? 0 : this.vx / kSpd;             // vector67（<1 取 Zero,:76995）
      const kdy = kSpd < 1 ? 0 : this.vy / kSpd;
      // ★蓝队批（2026-09-02）：上方门已收窄为仅 1120（同日审计注）——597/−35 两支
      //  不可达（TS2367 死比较）,kdust 恒 170,死支摘除（门语义零改动）
      const kdust = 170;
      for (let i = 0; i < 15; i++) {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, kdust,
          kdx, kdy, 50, null, 1.2);
        if (d) {
          d.noGravity = true;
          d.scale *= 1.25;
          const rr = Math.random();                          // Main.rand.NextFloat()
          d.vx = (d.vx * 2.2 + kdx * 1.5) * rr;
          d.vy = (d.vy * 2.2 + kdy * 1.5) * rr;
        }
      }
    }
    // 1457 宝石法珠 AoeExplosion 爆段（Kill :77011-77058，黄玉法珠/长袍臂）：
    // Resize(160) 80px 半径 AoE + 伤 ×0.35/GetDamageMultiplier + kb ×0.35
    if (this.gem?.aoeExplosion && !this.dead) this.gemAoeBurst(game);
    // ---- Kill 按弹型音/尘分档（2026-08-22 特殊箭特效批；撞块/寿命/穿透耗尽全
    //      路径同 vanilla Kill() 一处结算）----
    // 1/81 木箭/敌木箭（98/980/1073 同档非本批域）：legacy PlaySound(0)=SoundID.Dig
    // + 尘 7×10（Projectile.cs:70989-70996）
    if (this.projId === 1 || this.projId === 81) {
      game.playSfx?.('dig', 1, this.cx, this.cy);
      for (let i = 0; i < 10; i++) game.spawnDust?.(this.x, this.y, this.w, this.h, 7);
    } else if (this.projId === 2 || this.projId === 82) {
      // 2/82 燃烧箭/敌燃烧箭：legacy PlaySound(0) + 火尘 6×10（:72542-72549）
      game.playSfx?.('dig', 1, this.cx, this.cy);
      for (let i = 0; i < 10; i++) game.spawnDust?.(this.x, this.y, this.w, this.h, 6, 0, 0, 100);
    } else if (this.projId === 474) {
      // 474 骨箭：legacy PlaySound(0) + 骨尘 26×20（scale 0.9，:72550-72557）
      game.playSfx?.('dig', 1, this.cx, this.cy);
      for (let i = 0; i < 20; i++) game.spawnDust?.(this.x, this.y, this.w, this.h, 26, 0, 0, 0, null, 0.9);
    } else if (this.projId === 172) {
      // 172 毒镖：legacy PlaySound(0) + 毒尘 135×20 α100（:77202-77208）
      game.playSfx?.('dig', 1, this.cx, this.cy);
      for (let i = 0; i < 20; i++) game.spawnDust?.(this.x, this.y, this.w, this.h, 135, 0, 0, 100);
    } else if (this.projId === 103) {
      // 103 流星弹：legacy PlaySound(0) + d75×20 α100，1/2 掷 {scale×2.5,noGravity,v×5}（:77209-77222）
      game.playSfx?.('dig', 1, this.cx, this.cy);
      for (let i = 0; i < 20; i++) {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 75, 0, 0, 100);
        if (d && Math.random() < 0.5) { d.scale *= 2.5; d.noGravity = true; d.vx *= 5; d.vy *= 5; }
      }
    } else if (this.projId === 278) {
      // 278 绿藻弹：legacy PlaySound(0) + d169×20 α100，1/2 掷 {scale×1.5,noGravity,v×5}（:77223-77236）
      game.playSfx?.('dig', 1, this.cx, this.cy);
      for (let i = 0; i < 20; i++) {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 169, 0, 0, 100);
        if (d && Math.random() < 0.5) { d.scale *= 1.5; d.noGravity = true; d.vx *= 5; d.vy *= 5; }
      }
    } else if (this.projId === 4) {
      // 4 星星：legacy PlaySound(0) + d14×10 α150 scale1.1（:77237-77243）
      game.playSfx?.('dig', 1, this.cx, this.cy);
      for (let i = 0; i < 10; i++) game.spawnDust?.(this.x, this.y, this.w, this.h, 14, 0, 0, 150, null, 1.1);
    } else if (this.projId === 5) {
      // 5 猎鹰刃：Item10 音 + rand(15,57,58)×60 v×0.5 α150 scale1.5（:77244-77257，Next(3) 单次采样）
      game.playSfxFile?.('Item_10', 1, this.cx, this.cy);
      for (let i = 0; i < 60; i++) {
        const r5 = (Math.random() * 3) | 0;
        game.spawnDust?.(this.x, this.y, this.w, this.h,
          r5 === 0 ? 15 : r5 === 1 ? 57 : 58, this.vx * 0.5, this.vy * 0.5, 150, null, 1.5);
      }
    } else if (this.projId === 309) {
      // 309 冰九头蛇冰弹：Item27 音 + d185×10，1/2 掷 {v×2,noGravity,scale×1.75}（:76894-76908）
      game.playSfxFile?.('Item_27', 1, this.cx, this.cy);
      for (let i = 0; i < 10; i++) {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 185);
        if (d && Math.random() < 0.5) { d.vx *= 2; d.vy *= 2; d.noGravity = true; d.scale *= 1.75; }
      }
    } else if (this.projId === 478 && !this.hostile) {
      // 478 诅咒镖消亡再放一轮 480 诅咒火(Kill :77151-77157,owner 门→!hostile;
      // dmg×0.8、kb×0.5——与 AI 侧周期放火 :58332 并行,原版两处都有)
      const ents478 = (game as unknown as { entities?: { add?: (e: unknown, b: string) => void } }).entities;
      if (ents478?.add) {
        ents478.add(new Arrow(this.cx, this.cy, 0, 0,
          Math.max(1, Math.trunc(this.damage * 0.8)), this.knockback * 0.5, 480,
          { grav: 0 }), 'projectiles');
      }
    } else if (this.projId === 503) {
      // 503 天顶剑星亡面(Kill :77259-77318 else 支):Item10 + vel/2 + d58×40 +
      // gore16×2(vel×0.05)
      game.playSfxFile?.('Item_10', 1, this.cx, this.cy);
      this.vx /= 2; this.vy /= 2;
      for (let i = 0; i < 40; i++) {
        game.spawnDust?.(this.x, this.y, this.w, this.h, 58, this.vx * 0.1, this.vy * 0.1, 150, null, 1.2);
      }
      for (let i = 0; i < 2; i++) {
        const g = GorePiece.newGore(16, this.cx, this.cy, this.vx * 0.05, this.vy * 0.05);
        void g;
      }
    } else if (this.projId === 469 && !this.hostile) {
      // 469 蜂箭 Kill 放蜂（:73369-73390，owner==myPlayer 门 → !hostile 近似）
      this.spawnBeeSwarm(game);
    }
    // ---- ★R28 Kill 爆族分档（音+尘配比逐把照抄行号；撞块/寿命/穿透/命中全路径
    //      同 vanilla Kill() 一处结算）----
    else if (this.projId === 15 || this.projId === 253) {
      // §13/§14 火之花/冰之花（:77763-77783）：Item10 + 20 循环×2 枚 d6(253→d135)
      // （首枚 scale2 noGravity、次枚缺省;初速 −弹速×0.2,后 ×2）
      game.playSfxFiles?.(['Item_10'], 1, this.cx, this.cy);
      const kd = this.projId === 253 ? 135 : 6;
      for (let i = 0; i < 20; i++) {
        const d1 = game.spawnDust?.(this.x, this.y, this.w, this.h, kd,
          -this.vx * 0.2, -this.vy * 0.2, 100, null, 2, true);
        if (d1) { d1.vx *= 2; d1.vy *= 2; }
        const d2 = game.spawnDust?.(this.x, this.y, this.w, this.h, kd,
          -this.vx * 0.2, -this.vy * 0.2, 100);
        if (d2) { d2.vx *= 2; d2.vy *= 2; }
      }
    } else if (this.projId === 510 && !this.hostile) {
      // §10 毒液瓶死亡毒云爆（Kill :75094-75109）：Item107 玻璃碎 + gore 704/705
      // （瓶碎片,−oldVel×0.2）+ owner 本机掷 rand.Next(20,31)=20..30 枚 511-513
      // 毒云泡（随机单位向 ×rand(10,201)×0.01、伤=瓶全额、kb1）——持续悬浮伤害云
      // 是本武器核心输出（区域封锁）;aiStyle92 行为在 subStepAI 511-513 分支
      game.playSfxFiles?.(['Item_107'], 1, this.cx, this.cy);
      GorePiece.newGore(704, this.cx, this.cy, -this.vx * 0.2, -this.vy * 0.2);
      GorePiece.newGore(705, this.cx, this.cy, -this.vx * 0.2, -this.vy * 0.2);
      const nCloud = 20 + Math.floor(Math.random() * 11);          // Next(20,31)
      const entsC = (game as unknown as { entities?: { add?: (e: unknown, b: string) => void } }).entities;
      for (let i = 0; i < nCloud && entsC?.add; i++) {
        let ux = Math.floor(Math.random() * 201) - 100;
        let uy = Math.floor(Math.random() * 201) - 100;
        if (ux === 0 && uy === 0) uy = 1;
        const ul = Math.hypot(ux, uy) || 1;
        const spd = (10 + Math.floor(Math.random() * 191)) * 0.01; // ×rand(10,201)×0.01 = 0.10..2.00
        const cloud = new Arrow(this.cx, this.cy, ux / ul * spd, uy / ul * spd,
          this.damage, 1, 511 + Math.floor(Math.random() * 3),
          { grav: 0, life: 3600, pierce: -1 });
        cloud.critChance = this.critChance;
        // ★BJ498①：critBonus 传播写位摘除（链上死值零读者——源恒类缺省 0,锚=字段注 BJ498①）
        cloud.armorPen = this.armorPen;
        entsC.add(cloud, 'projectiles');
      }
    } else if (this.projId === 316) {
      // §3 蝙蝠杖蝠（:75761-75770）：5×d195（scale0.85,noGravity,v+=弹速×0.5）——无音效
      for (let i = 0; i < 5; i++) {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 195,
          0, 0, 0, null, 0.85, true);
        if (d) { d.vx += this.vx * 0.5; d.vy += this.vy * 0.5; }
      }
    } else if (this.projId === 337) {
      // §9 暴雪雪片（:77089-77096）：Item27 音 + 10×d197 noGravity
      game.playSfxFiles?.(['Item_27'], 1, this.cx, this.cy);
      for (let i = 0; i < 10; i++) {
        game.spawnDust?.(this.x, this.y, this.w, this.h, 197, 0, 0, 0, null, 1, true);
      }
    } else if (this.projId === 114 && !this.hostile) {
      // §12 邪恶三叉戟沿弹道迸散（:78793-78807）：Item10 + for i∈4..30 若 rand(128)
      // ≥alpha(隐身期不撒)：position−oldV×(30/i) 处 2 枚 d27（scale1.4/0.9,noGravity,
      // v×0.5）——本仓以消亡时速度代 oldVelocity（衰减型死亡两者近同,登记）
      game.playSfxFiles?.(['Item_10'], 1, this.cx, this.cy);
      for (let i = 4; i <= 30; i++) {
        if (Math.floor(Math.random() * 128) < this.alpha) continue;   //（隐身期不撒）
        const bx = this.x - this.vx * (30 / i);
        const by = this.y - this.vy * (30 / i);
        const da = game.spawnDust?.(bx, by, 8, 8, 27, this.vx, this.vy, 100, null, 1.4, true);
        if (da) { da.vx *= 0.5; da.vy *= 0.5; }
        const db = game.spawnDust?.(bx, by, 8, 8, 27, this.vx, this.vy, 100, null, 0.9, true);
        if (db) { db.vx *= 0.5; db.vy *= 0.5; }
      }
    } else if (this.projId === 295 && !this.hostile) {
      // §2 地狱火叉死亡火柱（Kill :75810-75815,owner 本机门）：Center 生成 296 爆区,
      // damage×0.75(int 截断)、kb 继承——150×150 盒驻留 ~135t 对盒内敌持续结算
      if (!this.dead) {
        const pillar = new Arrow(this.cx - 75, this.cy - 75, 0, 0,
          Math.max(1, Math.trunc(this.damage * 0.75)), this.knockback, 296,
          { grav: 0, pierce: -1 });
        pillar.critChance = this.critChance;
        // ★BJ498①：critBonus 传播写位摘除（链上死值零读者——源恒类缺省 0,锚=字段注 BJ498①）
        pillar.armorPen = this.armorPen;
        const ents = (game as unknown as { entities?: { add?: (e: unknown, b: string) => void } }).entities;
        ents?.add?.(pillar, 'projectiles');
      }
    } else if (this.projId === 521 && !this.hostile) {
      // §11 水晶蛇死亡链（:74663-74700）：Item110 + 20×d254（1/3 type++→255、
      // fadeIn/scale 抖动、v×2.5−oldVel/10）+ owner 本机 3..5 枚 522 小蛇
      //（随机单位向 ×rand(70,101)×0.1、伤 ×0.8 int 截断、kb ×0.8）
      game.playSfxFiles?.(['Item_110'], 1, this.cx, this.cy);
      for (let i = 0; i < 20; i++) {
        let t = 254;
        let fadeIn: number | null = null;
        let sc = 1.2 + (Math.floor(Math.random() * 21) - 10) * 0.01;
        if (Math.floor(Math.random() * 3) === 0) {
          t = 255;
          fadeIn = 1.1 + (Math.floor(Math.random() * 21) - 10) * 0.01;
          sc = 0.35 + (Math.floor(Math.random() * 21) - 10) * 0.01;
        }
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, t,
          this.vx * 0.1, this.vy * 0.1, 0, null, sc, true);
        if (d) {
          if (fadeIn !== null) d.fadeIn = fadeIn;
          d.vx *= 2.5; d.vy *= 2.5;
          d.vx -= this.vx / 10; d.vy -= this.vy / 10;
        }
      }
      const nSnake = 3 + Math.floor(Math.random() * 3);
      const entsS = (game as unknown as { entities?: { add?: (e: unknown, b: string) => void } }).entities;
      for (let k = 0; k < nSnake && entsS?.add; k++) {
        let ux = Math.floor(Math.random() * 201) - 100;
        let uy = Math.floor(Math.random() * 201) - 100;
        if (ux === 0 && uy === 0) uy = 1;
        const ul = Math.hypot(ux, uy) || 1;
        const spd = (70 + Math.floor(Math.random() * 31)) * 0.1;   // rand(70,101)×0.1 = 7.0..10.0
        const snake = new Arrow(this.x + this.w / 2, this.y + this.h / 2,
          ux / ul * spd, uy / ul * spd,
          Math.max(1, Math.trunc(this.damage * 0.8)), this.knockback * 0.8, 522,
          { grav: 0, life: 40, pierce: 1 });
        snake.critChance = this.critChance;
        // ★BJ498①：critBonus 传播写位摘除（链上死值零读者——源恒类缺省 0,锚=字段注 BJ498①）
        snake.armorPen = this.armorPen;
        entsS.add(snake, 'projectiles');
      }
    } else if (this.projId === 981 && !this.hostile) {
      // ★L5 长尾批：981 银弹贴块火花（Projectile.Kill :77659-77666——Collision.HitTiles+
      // SoundID.Item10 后 RequestParticleSpawn(clientOnly:true, SilverBulletSparkle,
      // Center,mv=Zero);音已由 onProjectileDeath Item_10 面承担,此处补 spark 本体）
      silverBulletSparkleFx(game, this.cx, this.cy, 0, 0);
    } else if (this.projId === 1006 && !this.hostile) {
      // ★L5 长尾批：1006 微光箭贴块十字虹彩（Kill :77676-77686——Item10 后 per-call 一轮
      // RequestParticleSpawn(clientOnly:true, ShimmerArrow, Center、mv=UnitX.RotatedBy(
      // rand×τ)×0.4）;clientOnly:true=本地直驱不广播）
      shimmerArrowFx(game, this.cx, this.cy);
    }
    // ---- ★R28 死亡 AoE 二次结算两件（Resize+Damage() 模式,NebulaBlazeBurst/
    //      LunarFlareStar 同构第三/四例）----
    // ★R35 清单①：410 泡泡破裂（Kill :74257-74280）——Item54 爆泡音+10× d212 环状尘
    //（尘位=Center+normalize(尘−Center)×10×ai[1]×scale,速度向外;num306=10×ai[1]）
    if (this.projId === 410 && !this.dead) {
      game.playSfxFiles?.(['Item_54'], 1, this.cx, this.cy);
      const bsc = this.bubbleScale || 1;
      const br = 10 * bsc;
      for (let bp = 0; bp < 10; bp++) {
        const bd = game.spawnDust?.(this.cx - br, this.cy - br, br * 2, br * 2, 212,
          0, 0, 0, null, bsc, true);
        if (bd) {
          const bl = Math.hypot(bd.vx, bd.vy) || 1;
          bd.vx = (bd.vx / bl) * (45 + Math.floor(Math.random() * 46)) / 10;
          bd.vy = (bd.vy / bl) * (45 + Math.floor(Math.random() * 46)) / 10;
        }
      }
    }
    // ★R35 清单③：烟花四式爆花（Kill :74257 起,各 400 尘 noGravity scale1.3——
    // 167=d130 四环速 4/8/12/16;168=d131 速 2×(i/100)→10→13;169=d132 旋臂花
    // （rand 5-8 臂×Lerp 弧,本仓简化环阵登记）;170=d133/134 交替速 16/11/8/5）
    if (this.projId >= 167 && this.projId <= 170 && !this.dead) {
      const fwVel = (dt: number, dType: number, i: number): void => {
        const bd = game.spawnDust?.(this.cx - 3, this.cy - 3, 6, 6, dType, 0, 0, 100, null, 1.3, true);
        if (!bd) return;
        bd.noGravity = true; bd.scale = 1.3;
        let dvx = bd.vx, dvy = bd.vy;
        if (dvx === 0 && dvy === 0) { dvx = 1; }
        const dl = Math.hypot(dvx, dvy) || 1;
        const k = dt / dl;
        bd.vx = dvx * 0.5 + dvx * k; bd.vy = dvy * 0.5 + dvy * k;
        void i;
      };
      if (this.projId === 167) {
        for (let i = 0; i < 400; i++) fwVel(i < 100 ? 4 : i < 200 ? 8 : i < 300 ? 12 : 16, 130, i);
      } else if (this.projId === 168) {
        for (let i = 0; i < 400; i++) fwVel(i > 250 ? 13 : i > 100 ? 10 : 2 * (i / 100), 131, i);
      } else if (this.projId === 169) {
        // 旋臂花简化:rand(5,9) 臂均布环阵,速 rand(12,17)（原式 Lerp 弧线登记备案）
        const arms = 5 + Math.floor(Math.random() * 4);
        for (let ai9 = 0; ai9 < arms; ai9++) {
          const aa = (ai9 / arms) * Math.PI * 2;
          for (let k9 = 0; k9 < 20; k9++) {
            const spd9 = (12 + Math.random() * 5);
            const bd9 = game.spawnDust?.(this.cx - 3, this.cy - 3, 6, 6, 132,
              Math.cos(aa) * spd9, Math.sin(aa) * spd9, 100, null, 1.3, true);
            if (bd9) { bd9.noGravity = true; bd9.scale = 1.3; }
          }
        }
      } else {
        for (let i = 0; i < 400; i++) {
          const tier = i > 300 ? 5 : i > 200 ? 8 : i > 100 ? 11 : 16;
          fwVel(tier, i > 100 ? (i > 300 ? 134 : 133) : 133, i);
        }
      }
    }
    if (this.projId === 617 && !this.dead) this.arcanumDeathBurst(game);
    else if (this.projId === 659 && !this.dead && this.sf659Ai0 >= 0) this.flame659DeathBurst(game);
    // ★R29 玛瑙爆破枪黑爆二段（Kill :73493-73540）：Resize(160)→Damage() AoE
    else if (this.projId === 661 && !this.dead && !this.hostile) this.blackBolt661Burst(game);
    // ★B1 死亡细胞桶发射器 1023（Kill :78560-78585）：音+192 盒 Damage()+编排本体
    // deadCellsBarrelExplosionFx+gore/尘（hostile 门同 661——被反射后不回打敌侧）
    else if (this.projId === 1023 && !this.dead && !this.hostile) this.barrel1023Burst(game);
    // ★2026-09-01 藤壶哨站弹 1026 Kill（:76827-76836）：Item_167 音 + 20×d2
    // （vel=circular(5,5)、α50/fadeIn .5/noGravity、scale 1.2+Next(-20,40)×0.01——
    //  ★F5 2026-09-01 ×60=Next(a,b) 上界开区间 {-20..39},旧 ×61 多掷 +40 档）
    if (this.projId === 1026 && !this.dead) {
      game.playSfxFile?.('Item_167', 1, this.cx, this.cy);
      for (let i = 0; i < 20; i++) {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 2, this.vx, this.vy, 0, null,
          1.2 + (Math.floor(Math.random() * 60) - 20) * 0.01);
        if (d) {
          d.alpha = 50; d.fadeIn = 0.5; d.noGravity = true;
          d.vx = (Math.random() * 2 - 1) * 5; d.vy = (Math.random() * 2 - 1) * 5;
        }
      }
    }
    // ---- ★Kill 消亡面清偿批（2026-09-02，Projectile.cs 分档链缺口，高优先两件）----
    // 639/640 月总箭 Kill（:74813-74842）：d220×Next(5,9) 粒（scale0.5、vel×1.6、Y−1、
    // noGravity、位置=Lerp(pos,Center,0.5)——0 尺寸盒下 NewDust +4 偏移经 Lerp 半程=+2,
    // 本仓 0 尺寸盒直生同式）;owner 本机且 639 → 衍生 640（出生位=localAI[0]/[1] 出生心
    // 快照、初速=ai[0]/[1] 快照、伤/kb 继承——★NewProjectile 传位即 top-left,原文本就
    // 是 Center 值=半盒偏移怪癖,按原文保留）。★批 2 实装：aiArg1=timeLeft+1 的 640
    // ai[1] 延迟计数（消费闸=Update 环 :16784 子步冻结,fixedUpdate 子步循环同构承接）
    if ((this.projId === 639 || this.projId === 640) && !this.dead) {
      const n639 = 5 + Math.floor(Math.random() * 5);            // Next(5,10) = 5..9
      for (let i = 0; i < n639; i++) {
        const d = game.spawnDust?.(this.cx, this.cy, 0, 0, 220, 0, 0, 100, null, 0.5, true);
        if (!d) break;
        d.vx *= 1.6; d.vy *= 1.6;
        d.vy -= 1;
        d.x += (this.cx - d.x) * 0.5;                            // Lerp(pos, Center, 0.5)
        d.y += (this.cy - d.y) * 0.5;
      }
      if (this.projId === 639 && !this.hostile) {                // owner == Main.myPlayer 门
        const ents639 = (game as unknown as { entities?: { add?: (e: unknown, b: string) => void } }).entities;
        if (ents639?.add) {
          // num391 = timeLeft+1（:74826）+ ProjectileUpdateLoopIndex<nextSlot 补偿 +1
          //（:74828-74830——本仓 EntityManager 活数组追加,子体当拍必入同轮 update,
          //  补偿恒成立;原版 GetNextSlot 低序复用槽可免补偿,本仓无此路径）。寿命尽
          // 杀口 this.life 已减至 0 ≙ 原版 Kill 入口 timeLeft（:71763 num 取已减值）。
          // extraUpdates 已由 vanilla-projectiles.json 640 行承载（2026-09-03 提取器
          //  MaxUpdates 别名修复后手补）。★MaxUpdates=3 ≙ extraUpdates=2——P.cs:556-565
          //  setter `extraUpdates = value - 1`，子步循环 :16780 numUpdates=extraUpdates
          //  → 3 子步/拍（旧 opts 显式 3 系直读 SetDefaults 字面量的 off-by-one
          //  =4 子步/拍,且 ai1Delay 每子步 −1 会被多扣,治标随 json 补列一并撤）
          const c640 = new Arrow(this.moonArrowL0, this.moonArrowL1,
            this.moonArrowA0, this.moonArrowA1, this.damage, this.knockback, 640);
          c640.ai1Delay = Math.max(0, this.life) + 2;
          ents639.add(c640, 'projectiles');
        }
      }
    }
    // 1097 火绒狐火球 Kill 消亡面（:75779-75791）：Item_20 音 + 6×d6（缺省档,无附加
    // 字段）;owner 本机且 ai[1]==1 → 拆 8 枚【同型 1097】：伤/2（int 除）、kb/2、
    // ai[0]=0/ai[1]=2、速 = v.RotatedBy(NextFloatDirection()×2π×0.03)(±34°) +
    // NextVector2Circular(3,3)（Utils.cs:1301 线性盘）。ai[1]==1 唯一注入面 = 1113
    // 4 连发循环（:62750-62757）→ AI ai[0]>=30 提前 Kill（:58266）入本口;本仓
    // MinionProj 生成面暂不注 ai[1] → 分裂支 dormant（foxAi1 字段已备）,音+尘面立即
    // 生效。子弹 foxL0 预置 1 = ai[1]==2 免首拍音尘（:57515 `ai[1] != 2f` 门）、
    // drawScale 0.7 = ai[1]==2 scale 钳（:57566-57568,钳后与本仓 AI −0.01/子步衔接）
    if (this.projId === 1097 && !this.dead) {
      game.playSfxFile?.('Item_20', 1, this.cx, this.cy);
      for (let i = 0; i < 6; i++) game.spawnDust?.(this.x, this.y, this.w, this.h, 6);
      if (this.foxAi1 === 1 && !this.hostile) {
        const entsFox = (game as unknown as { entities?: { add?: (e: unknown, b: string) => void } }).entities;
        if (entsFox?.add) {
          for (let i = 0; i < 8; i++) {
            const rf = (Math.random() * 2 - 1) * Math.PI;        // NextFloatDirection ∈ [-π,π)
            const rot = rf * (Math.PI * 2) * 0.03;
            const cr = Math.cos(rot), sr = Math.sin(rot);
            const ca = Math.random() * Math.PI * 2;
            const rr = Math.sqrt(Math.random()) * 3;             // 线性盘（NextVector2Circular）
            const sub = new Arrow(this.cx, this.cy,
              this.vx * cr - this.vy * sr + Math.cos(ca) * rr,
              this.vx * sr + this.vy * cr + Math.sin(ca) * rr,
              Math.trunc(this.damage / 2), this.knockback / 2, 1097, {});
            sub.foxAi1 = 2;
            sub.foxL0 = 1;
            sub.drawScale = 0.7;
            entsFox.add(sub, 'projectiles');
          }
        }
      }
    }
    // 283 VenomBullet Kill（:77513-77580）：Item10 + 30×d171 三组各 10（scale=
    // Next(1,10)×0.1 直赋、noGravity、fadeIn1.5;组1 v×0.75;组2 +oldV×0.5×rand;
    // 组3 v×1.5+oldV×1.5×rand）;owner 本机 → penetrate=1 + 判定盒归心 Resize(80×80)
    // 后沿 oldV 单位向步进 width×0.75=60px 三次 Damage() 重结算。
    // ★等价口径（本仓无 Damage() 重入原语,rocketExplode 重结算先例同族）：一次敌集
    // 扫描、三段 80×80 盒独立命中判定（283 SetDefaults 未启用 local/ID-static 免疫表
    // → 原版三连 Damage 对同敌可三跳;per-strike 免疫写 idStaticNPCHitCooldown=5 与
    // ResetStaticImmunityMatching 对未启用静态免疫的 283 为无消费死配置,不复刻;
    // active=false 防 Kill 级联由 !this.dead 门承担）。pierce=1 → Enemy.hurt 豁免
    // 免疫帧同构（单发弹 flag3）;critter 全参同构（★BJ-C6/F2,旧单参 shim 退役）
    if (this.projId === 283 && !this.dead) {
      game.playSfxFile?.('Item_10', 1, this.cx, this.cy);
      for (let g283 = 0; g283 < 3; g283++) {
        for (let i = 0; i < 10; i++) {
          const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 171, 0, 0, 100);
          if (!d) break;
          d.scale = (1 + Math.floor(Math.random() * 9)) * 0.1;   // Next(1,10) 右开 = 1..9
          d.noGravity = true;
          d.fadeIn = 1.5;
          d.vx *= g283 === 2 ? 1.5 : 0.75;
          d.vy *= g283 === 2 ? 1.5 : 0.75;
          if (g283 >= 1) {
            const r283 = Math.random();                          // Main.rand.NextFloat()
            d.vx += this.vx * (g283 === 2 ? 1.5 : 0.5) * r283;
            d.vy += this.vy * (g283 === 2 ? 1.5 : 0.5) * r283;
          }
        }
      }
      if (!this.hostile) {                                       // owner == Main.myPlayer 门
        const vl283 = Math.hypot(this.vx, this.vy);
        const nx283 = vl283 > 0 ? this.vx / vl283 : 0;           // oldVelocity 归一（:77571）
        const ny283 = vl283 > 0 ? this.vy / vl283 : 0;
        const R283 = 40;                                         // Resize(80,80) 半宽
        const segs283 = [0, 1, 2].map((k) => ({
          cx: this.cx + nx283 * 60 * k,                          // width×0.75 = 60px/段
          cy: this.cy + ny283 * 60 * k,
        }));
        for (const ent of game.enemies()) {
          const e = ent as unknown as { x: number; y: number; w: number; h: number;
            dead?: boolean; hurt?: (...a: unknown[]) => boolean; id?: number };
          if (e.dead || !e.hurt) continue;
          const ecx = e.x + e.w / 2, ecy = e.y + e.h / 2;
          for (const seg of segs283) {                           // 每段独立命中判定
            if (Math.abs(ecx - seg.cx) < R283 + e.w / 2 && Math.abs(ecy - seg.cy) < R283 + e.h / 2) {
              e.hurt(applyBannerDamageDealt(game, ent, Math.max(1, Math.trunc(this.damage))),
                Math.sign(ecx - seg.cx) * this.knockback, 0, game, this.settlePen, false, 1, true);
            }
          }
        }
        for (const cent of game.critters()) {
          const c = cent as unknown as { x: number; y: number; w: number; h: number;
            dead?: boolean; hurt?: (...a: unknown[]) => boolean };
          if (c.dead || !c.hurt) continue;
          const ccx = c.x + c.w / 2, ccy = c.y + c.h / 2;
          for (const seg of segs283) {
            if (Math.abs(ccx - seg.cx) < R283 + c.w / 2 && Math.abs(ccy - seg.cy) < R283 + c.h / 2) {
              // ★BJ-C6/F2（2026-10-06）：小动物支补全参——原版三连 Damage() 单趟
              //  victim 循环对小动物（=NPC）与敌怪【同链同参】（:13702 banner/穿甲/
              //  fromPlayer DPS 计/Pierce=1 免疫窗豁免全同面）;旧单参 shim 漏
              //  fromPlayer=true 与敌怪支(:4320 全参 true)不一致,一并同构。
              c.hurt(applyBannerDamageDealt(game, cent, Math.max(1, Math.trunc(this.damage))),
                Math.sign(ccx - seg.cx) * this.knockback, 0, game, this.settlePen, false, 1, true);
            }
          }
        }
      }
    }
    // §1 暗影束消亡：补铺末段（Kill :71840-71870 从最后锚点到死亡位广播）
    if (this.projId === 294 && !this.hostile && this.sbL0 >= 9
      && (this.sbAx > 0 && this.sbAy > 0)) {
      // ★2026-09-03 门修正：原版 Kill 铺撒门 = localAI[0] >= delay（:71839 >= num3）
      //  ∧ num40 > 0f && num41 > 0f（:71864 锚点双正）——曾 sbL0 > 9（晚 1 子步）+
      //  ||（单正即过），角弹前 9 子步内已反弹锚定、第 9 子步再撞时原版播本仓漏
      this.shadowbeamSegment(game);
      game.broadcastParticleOrchestra?.(Arrow.SHADOWBEAM_ORCHESTRA_IDX, this.cx, this.cy,
        this.sbAx, this.sbAy, Math.round(Math.hypot(this.vx, this.vy) * 1000));
    }
    // ★91/92 圣箭星雨（:72250-72287）/ 41 狱炎箭 64×64 爆炸（:73256-73293）/
    // 89 水晶碎裂（:72289+）已由尾部 onProjectileDeath 分发到 Game 侧实现
    // （Game.onProjectileDeath projId 分支），此处不内结防双触发
    // R4-32（Projectile.cs:71881-71893）：SeraphNecklaced 弹死亡 → SilverBulletSparkle
    // ×(4+Next(2))——银白火花（编排器粒子本仓无池,spawnParticles 近似）
    if (this.seraphNecklaced) {
      game.spawnParticles(this.cx, this.cy, '#E8E8FF', 4 + (Math.random() < 0.5 ? 1 : 0), 2.2,
        { life: 18, grav: 0.05, damp: 0.94 });
    }
    // ---- ★B1 孤儿武器投掷物 Kill 挂点（2026-08-30）----
    // 183 蜜雷锋爆裂（Projectile.cs:78086-78122——音/尘/壳无门，蜂群 owner 门在方法内）；
    if (this.projId === 183) this.beenadeBurst(game);
    // 370 爱情/371 恶臭/936 微光气球三药水共表（弹型→Kill 追加效果见
    // entities/ThrowKillFx.ts 头注——1085 镜在 Game.onProjectileDeath 不重复挂）
    if (this.projId === 370 || this.projId === 371 || this.projId === 936) {
      applyThrownKillFx(this, game);
    }
    // ---- ★NPC 弹幕尘站普查批③（2026-09-16,docs/npc-proj-dust-census.md §6）：
    //      Arrow 载体敌弹 Kill 站补齐（Projectile.Kill() 分档链,行号锚 1457）。
    //      同 id 玩家武器版如另有 Game.onProjectileDeath 面（452/454 泛色已被本真值
    //      替代）不重复撒 ----
    // · 719 蜂刺（:77139-77144,55/719 共组;55 的 Dart 载体版在 Dart.killShooterDust）
    if (this.projId === 719) {
      for (let i = 0; i < 5; i++) {
        game.spawnDust?.(this.x, this.y, this.w, this.h, 18, 0, 0, 0, null, 1.5, true);
      }
    }
    // · 462 幻影矢（:74905-74914）：Next(5,10)×d229（NewDust(Center,0,0),α100,
    //   scale0.5）→ vel×1.6、vel.Y--、position −= One×4、position=Lerp(position,
    //   Center,0.5)
    if (this.projId === 462) {
      const n462 = 5 + Math.floor(Math.random() * 5);
      for (let i = 0; i < n462; i++) {
        const d = game.spawnDust?.(this.cx, this.cy, 0, 0, 229, 0, 0, 100, null, 0.5);
        if (!d) break;
        d.vx *= 1.6; d.vy = d.vy * 1.6 - 1;
        d.x -= 4; d.y -= 4;
        d.x = (d.x + this.cx) / 2; d.y = (d.y + this.cy) / 2;
      }
    }
    // · 926 凝胶弹（:72773-72781）：22×d31（NewDust(position−(8,8),w+16,h+16),α40,
    //   QueenSlime 色,scale1.5）→ noGravity,vel = UnitY.RotatedBy(i·2π+rand·π)×
    //   (3+rand·0.5)
    if (this.projId === 926) {
      for (let i = 0; i < 22; i++) {
        const ang = i * Math.PI * 2 + Math.random() * Math.PI;
        const spd = 3 + Math.random() * 0.5;
        const r1 = Math.random(), r2 = Math.random();
        const l1 = 200 + (255 - 200) * r1, g1 = 200 + (80 - 200) * r1, b1 = 200 + (255 - 200) * r1;
        const d = game.spawnDust?.(this.x - 8, this.y - 8, this.w + 16, this.h + 16, 31,
          -Math.sin(ang) * spd, Math.cos(ang) * spd, 40,
          { r: Math.round(0 + (l1 - 0) * r2), g: Math.round(160 + (g1 - 160) * r2),
            b: Math.round(255 + (b1 - 255) * r2), a: 255 }, 1.5);
        if (d) d.noGravity = true;
      }
    }
    // · 1021 月总巨砾（:76364-76467,99/1013/727/1014/1021/1048/1053/1054/1055/1057
    //   共组——1021 走尾支 num623=323）：PlaySound(0)=dig + 30×d323（1/2 scale×1.4;
    //   环内 `velocity *= 1.9f` 在弹已死面=死写不移植,见 RollingBoulder.ts:82 同判）
    if (this.projId === 1021) {
      game.playSfx?.('dig', 1, this.cx, this.cy);
      for (let i = 0; i < 30; i++) {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 323);
        if (!d) break;
        if (Math.floor(Math.random() * 2) === 0) d.scale *= 1.4;
      }
    }
    // · 873 光鞭（:72691-72721）：20×NewDustPerfect(Center,267)——fadeIn1、noGravity、
    //   α100、color=Lerp(AI_171_GetColor(),White,rand·0.4)（AI_171_GetColor :46398=
    //   hslToRgb((ai[1]+0.5)%1,1,0.5),ai[1]=发射点 NPC.ai[1]/60 → 本仓发射点注入
    //   empressHue）、角向均布 num87=velocity 角 + i·2π/20：i%4==0 → vel=角向×3.2
    //   scale2.3 / i%2==0 → ×1.8 scale1.9 / else ×1 scale1.6,尾段 vel+=弹速×rand·0.5
    if (this.projId === 873) {
      const hue = (((this.empressHue ?? 0) + 0.5) % 1 + 1) % 1;
      const [cr, cg, cb] = empressHslRgb(hue);
      for (let i = 0; i < 20; i++) {
        const d = game.spawnDust?.(0, 0, 0, 0, 267, 0, 0, 100, null, 1, false, true);
        if (!d) break;
        d.x = this.cx; d.y = this.cy;
        d.fadeIn = 1; d.noGravity = true; d.alpha = 100;
        const wl = Math.random() * 0.4;
        d.color = {
          r: Math.round(cr + (255 - cr) * wl),
          g: Math.round(cg + (255 - cg) * wl),
          b: Math.round(cb + (255 - cb) * wl),
          a: 255,
        };
        const ang = Math.atan2(this.vy, this.vx) + i * (Math.PI * 2 / 20);
        if (i % 4 === 0) { d.vx = Math.cos(ang) * 3.2; d.vy = Math.sin(ang) * 3.2; d.scale = 2.3; }
        else if (i % 2 === 0) { d.vx = Math.cos(ang) * 1.8; d.vy = Math.sin(ang) * 1.8; d.scale = 1.9; }
        else { d.vx = Math.cos(ang); d.vy = Math.sin(ang); d.scale = 1.6; }
        d.vx += this.vx * Math.random() * 0.5;
        d.vy += this.vy * Math.random() * 0.5;
      }
    }
    // · 270 骷髅髅骨（:75816-75856,type 270 支）：PlaySound(0)=dig（legacy case0 无
    //   style=随机 Dig_0/1/2）+ 20 循环 ×{d26（α100,noGravity,vel×1.2,scale=1.3,
    //   vel −= oldVel×0.3）+ d5（盒=position+(4,4) 缩 8,scale1.5,noGravity,vel×3）}
    if (this.projId === 270) {
      game.playSfx?.('dig', 1, this.cx, this.cy);
      for (let i = 0; i < 20; i++) {
        const dA = game.spawnDust?.(this.x, this.y, this.w, this.h, 26, 0, 0, 100);
        if (dA) {
          dA.noGravity = true; dA.scale = 1.3;
          dA.vx = dA.vx * 1.2 - this.vx * 0.3;
          dA.vy = dA.vy * 1.2 - this.vy * 0.3;
        }
        const dB = game.spawnDust?.(this.x + 4, this.y + 4, this.w - 8, this.h - 8, 5,
          0, 0, 100, null, 1.5);
        if (dB) { dB.noGravity = true; dB.vx *= 3; dB.vy *= 3; }
      }
    }
    // · 452/454 月总幻影矢/球爆（:74329-74395）：真尘站接于 killNow（原 Game.
    //   onProjectileDeath 泛色 spawnParticles 已退役防双撒,音/判定盒面仍在 Game 侧）
    //   452：4×d31（scale1.5,α100）+ 40×{d229(α0,scale2.5,noGravity,vel×3) +
    //   d229(α100,scale1.5,noGravity,vel×2)}——盒=Resize(144) 后 ±72;
    //   454：7×d31+60×{d229(α0,scale2.5,noGravity)+d229(α100,scale1.5,noGravity)}——
    //   盒=Resize(208) 后 ±104,尘位=Center+(104,0).RotatedBy(2π·rand)·rand 径向
    if (this.projId === 452 || this.projId === 454) {
      const R = this.projId === 452 ? 72 : 104;
      const nD = this.projId === 452 ? 4 : 7;
      const nL = this.projId === 452 ? 40 : 60;
      for (let i = 0; i < nD; i++) {
        game.spawnDust?.(this.cx - R, this.cy - R, R * 2, R * 2, 31, 0, 0, 100, null, 1.5);
      }
      for (let i = 0; i < nL; i++) {
        // 454 每粒各自掷径向角/半径：(w/2,0).RotatedBy(2π·rand)·rand + Center
        const radOf = (): [number, number] => {
          const th = Math.random() * Math.PI * 2, rr = Math.random();
          return [this.cx + Math.cos(th) * R * rr, this.cy + Math.sin(th) * R * rr];
        };
        const dA = game.spawnDust?.(this.cx - R, this.cy - R, R * 2, R * 2, 229, 0, 0, 0, null, 2.5);
        if (dA) {
          dA.noGravity = true;
          if (this.projId === 452) { dA.vx *= 3; dA.vy *= 3; }
          if (this.projId === 454) { const [px, py] = radOf(); dA.x = px; dA.y = py; }
        }
        const dB = game.spawnDust?.(this.cx - R, this.cy - R, R * 2, R * 2, 229, 0, 0, 100, null, 1.5);
        if (dB) {
          dB.noGravity = true;
          if (this.projId === 452) { dB.vx *= 2; dB.vy *= 2; }
          if (this.projId === 454) { const [px, py] = radOf(); dB.x = px; dB.y = py; }
        }
      }
    }
    this.dead = true;
    game.onProjectileDeath?.(this.projId, this.x, this.y, this.w, this.h, this.vx, this.vy,
      this.damage, { hostile: this.hostile, ai0: this.starFallGen, kb: this.knockback,
        arpen: this.settlePen, sc: this.drawScale });
  }

  /** 弹心格浸微光液（shimmerWet 本仓以中心格 liquidType===SHIMMER 近似——原版是
   *  WetCollision 包围盒级 Collision.shimmer 采样，粒度差异既案）。2026-09-07 起
   *  浮升/衰变两支随 Shimmer() 泛化并入通用调用位（shimmerWet 盒级旗驱动），
   *  本谓词仅存于解锁半边 shimmerUnlock 内=防漂移双保险（B1-X3 既案）。 */
  private shimmerImmersed(game: GameHooks): boolean {
    const st = game.world.store;
    if (!st) return false;
    const tx = Math.floor((this.x + this.w / 2) / TILE), ty = Math.floor((this.y + this.h / 2) / TILE);
    return st.inBounds(tx, ty) && st.liquid[st.idx(tx, ty)] > 0
      && st.liquidType[st.idx(tx, ty)] === LIQUID_TYPE.SHIMMER;
  }

  /** 微光气球 936 巨星解锁支（Shimmer() aiStyle==2 分支的解锁半边，
   *  Projectile.cs:22676-22697；projId/hostile 门与浸液域在 subStepAI 调用侧）。
   *  触发域 = Shimmer() 分支门 :22679（velocity.Y−=0.7【后】<0,上升期触达——face 值）
   *  && 浸微光液（shimmerImmersed 中心格重查,盒级旗→中心格粒度差异既案）
   *  && !unlockedSlimeRainbowSpawn。
   *  ★2026-09-08 续刀（arrow-ledger-aug31 936 解锁支定谳）：旧谓词 vy 臂
   *  `this.vy >= 0` 退役——回调在 projShimmerStep 返回【前】触发,this.vy 尚是
   *  face 回写前的【减速前】值,分支实判的是减 0.7 后的 face.vy → 0≤vy<0.7 窗口
   *  （含静止出生）分支触发而回调误拒=彩虹史莱姆解锁漏。原文 :22683-22692
   *  无二次 vy 判 → 摘臂（最小刀;非"先回写再调回调"案——那会重排全部分支的
   *  回调/回写序,无原版对应面）。旗重查+中心格浸液重查保留（防漂移双保险,
   *  值在回调时点恒正确）。
   *  动作：timeLeft>5 钳 5（延迟爆，当拍【不】走 timeLeft-=20 else 支）→ 置世界旗
   *  （WorldFile 随存档，WldParser 读回）→ NewNPC 681（town_slime_diva）。非微光环境
   *  的任何消亡不触发——消亡路径（killNow/寿命尽/命中/撞块）已无此段。 */
  private shimmerUnlock(game: GameHooks): void {
    if (game.world.flags['unlockedSlimeRainbowSpawn'] === true) return;
    if (!this.shimmerImmersed(game)) return;   // 域重查（调用侧已判,防漂移双保险）
    if (this.life > 5) this.life = 5;                       // timeLeft=5 cap（:22680-22682）
    game.world.flags['unlockedSlimeRainbowSpawn'] = true;   // :22685（netMode!=1 段,本仓单模式）
    // :22686 Center.X+4 —— 经注册表取构造器（环切见 townNpcFactory.ts 头注；
    // 生产链恒注册,未装配=弹幕域孤立调用面静默跳过）
    const ms = createTownNpcByShellKey('town_slime_diva', this.cx + 4, this.cy);
    if (!ms) return;
    const entsS = (game as unknown as { entities?: { add?: (e: unknown, b: string) => void } }).entities;
    entsS?.add?.(ms, 'npcs');
    // 彩虹尘近似（WorldItem.cs:1704-1723 四色档；弹侧原版解锁支无尘,视觉补位已登记）
    game.spawnParticles(this.cx, this.cy, '#FFF3D2', 12, 2.2, { life: 26 });
    game.spawnParticles(this.cx, this.cy, '#BEF5FF', 8, 1.6, { life: 22 });
    game.spawnParticles(this.cx, this.cy, '#FF96FF', 8, 1.6, { life: 22 });
  }

  /** 448 Kill 爆炸（1458 P.cs:75003-75033 / 1456 :70544-70580）：position 归心后
   *  width=height=112 重开判定盒结算 Damage_EVP（爆炸即是本弹的伤害投递方式——
   *  接触路径在 42px 近爆门前恒先消亡），尘近似 31×4 + 228×80。★2026-08-31 C 档
   *  清偿：壳 gore rand.Next(61,64)×1 经 GorePiece.newGore 通道接入——出生点 =
   *  盒内随机位 −(10,10)、速度链 = NewGore 内部扰动（Gore.cs:1347-1348）→ ×0.3 →
   *  X/Y += Next(-10,11)×0.05（:75030-75033 时序,beenadeBurst 同构） */
  private rocketExplode(game: GameHooks): void {
    const cx = this.cx, cy = this.cy;
    this.x = cx - 56;
    this.y = cy - 56;
    this.w = 112;
    this.h = 112;
    game.playSfxFiles?.(['Item_14'], 1, cx, cy);
    game.spawnParticles(cx, cy, '#FFC860', 22, 4, { life: 26, damp: 0.93 });
    game.spawnParticles(cx, cy, '#907858', 4, 2, { life: 24 });
    // :75029 gore 单枚（同 beenade/183 壳族;NewGore 传入 default(Vector2),扰动落实例）
    const gRk = GorePiece.newGore(61 + Math.floor(Math.random() * 3),
      this.x + Math.random() * this.w - 10, this.y + Math.random() * this.h - 10, 0, 0);
    if (gRk) {
      gRk.vx *= 0.3; gRk.vy *= 0.3;
      gRk.vx += (Math.floor(Math.random() * 21) - 10) * 0.05;   // Next(-10,11) 右开
      gRk.vy += (Math.floor(Math.random() * 21) - 10) * 0.05;
    }
    hitPlayer(this, game, this.damage);   // :70580(:75033) Kill 内 Damage() 二次结算
  }

  /** ★BJ704-R3 P1②b 爆炸兔 Kill 爆炸（Projectile.Kill case 281,:77327-77384;
   *  448 rocketExplode/喵刀死亡跳 :11564 同族=心锚盒扩+dealContacts）。ai[0]!=-3 →
   *  FX（Sound4 兔死库缺省+Item14+gore76/77 兔尸+61-63 四向壳块+20 尘31+10×2 尘6）
   *  ∧ damage>0 → 盒扩 128×128 心保持 → CutTiles（Damage() :12515-12518
   *  friendly∧myPlayer∧!npcProj∧!minion 先于结算）→ dealContacts（idStatic 10,
   *  SetDefaults :6007）→ 还原;玩家可炸面=ai[1]-1==myPlayer（=释放者本人
   *  :14873-77）或 getGoodWorld 强开（野兔/他释恒不可炸玩家）。 */
  private bunnyBlastExplode(game: GameHooks): void {
    // ---- FX（:77330-77372,原 28×28 盒上,先于扩盒）----
    game.playSfx?.('killed', 1, this.cx, this.cy);          // :77330 PlaySound(4,x,y)（WeaponProj :76613 同款缺省形态）
    const gvel = () => (Math.floor(Math.random() * 41) - 20) * 0.2;   // Next(-20,21)×0.2 右开
    const g76 = GorePiece.newGore(76, this.x, this.y, gvel(), gvel());
    if (g76) { g76.vx -= this.vx * 0.5; g76.vy -= this.vy * 0.5; }    // :77333-77334 −velocity×0.5（死亡爆弹速 0）
    const g77 = GorePiece.newGore(77, this.x, this.y, gvel(), gvel());
    if (g77) { g77.vx -= this.vx * 0.5; g77.vy -= this.vy * 0.5; }
    game.playSfxFiles?.(['Item_14'], 1, this.cx, this.cy);  // :77337
    for (let i = 0; i < 20; i++) {                          // :77338-77342 尘 31×20（α100 s1.5 vel×1.4）
      const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 31, 0, 0, 100, null, 1.5);
      if (d) { d.vx *= 1.4; d.vy *= 1.4; }
    }
    for (let i = 0; i < 10; i++) {                          // :77343-77354 尘 6 双掷（s2.5 noGravity ×5 / s1.5 ×3）
      const dA = game.spawnDust?.(this.x, this.y, this.w, this.h, 6, 0, 0, 100, null, 2.5, true);
      if (dA) { dA.vx *= 5; dA.vy *= 5; }
      const dB = game.spawnDust?.(this.x, this.y, this.w, this.h, 6, 0, 0, 100, null, 1.5);
      if (dB) { dB.vx *= 3; dB.vy *= 3; }
    }
    for (const [kx, ky] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {   // :77355-77374 gore 61-63 四向（×0.4+角向 ±1）
      const g = GorePiece.newGore(61 + Math.floor(Math.random() * 3), this.x, this.y, 0, 0);
      if (g) { g.vx = g.vx * 0.4 + kx; g.vy = g.vy * 0.4 + ky; }
    }
    // ---- 伤害块（:77374-77384）----
    if (this.damage <= 0) return;                           // 雕像出生 dmg=0 → 纯 FX（:77374 门）
    const cX = this.cx, cY = this.cy;
    const oldW = this.w, oldH = this.h, oldX = this.x, oldY = this.y;
    this.w = 128; this.h = 128;                             // :77376-77379 心保持盒扩 128×128
    this.x = cX - 64; this.y = cY - 64;
    // ai[0]==-2 原版置 hostile=true——仓内敌/我两面由 dealContacts/hitPlayer 分治,
    // 玩家门下方显式承载（勿置 this.hostile:dealContacts 敌面按敌对弹改道 :12631）
    cutTilesBox(game, this.x, this.y, this.w, this.h, 281); // Damage() 内建割草/碎罐（先于结算）
    // ★G21 R8-F5：duck 桥拆 peek（纯读,≙外环 flag2 表读 :12596）/ commit（写梯
    //  :14031 受里面深位）——旧 peek=idStaticCheck 读时写,充能水母在爆盒内会白写
    //  10t 窗（原版拒收/电击拍零落账,dealContacts 水母块 return :12687 先于写梯）。
    const aoeCd281 = {
      tick: () => {},                                       // GTW tick 钟绝对到期,无独立 tick 面
      peek: (id: number) => idStaticReady(281, id),
      commit: (id: number, cdv: number) => { idStaticWrite(281, id, cdv || 10); },
    } as unknown as Parameters<typeof dealContacts>[2];
    dealContacts(this, game, aoeCd281, 10);                 // idStaticNPCHitCooldown=10
    if (this.bunnyOwner === 1 || game.world.seedFlags?.getGoodWorld) {
      hitPlayer(this, game, this.damage);                   // :14873-77 ai[1]-1==myPlayer ∨ getGoodWorld
    }
    this.w = oldW; this.h = oldH; this.x = oldX; this.y = oldY;
  }

  /** 469 蜂箭 Kill 放蜂（1458 Projectile.cs:78058-78081 / 1456 :73369-73390）：6 拍
   *  循环、奇数拍（1/3/5）再掷 Next(3)==0 才放（期望 4 只、3-6 只区间）；出生点 =
   *  position − oldVelocity 归一×8×i；速度 = Next(-35,36)×0.01 + oldVelocity/6
   *  （出生弹即 aiStyle 36 家族本体——projId∈{181,566} 走下方 bee36 追踪内核,
   *  索敌/转向与蜂蜜斗篷反击蜂同核;旧「直线漂移近似」登记随追踪批销核）；
   *  蜂型 = beeType()（1458 Player.cs:12505-12513：Hive Pack strongBees 半数掷 566 巨蜂
   *  ——★2026-08-31 台账清偿：原经 equipStats 恒 181,现接 beenadeBurst 同源通道;
   *  每只独立重掷 makeStrongBee 态）/ 伤 = beeDamage(damage/3)（:12517-12524 强蜂
   *  +Next(1,4)、弱蜂 +Next(2)）/ kb = beeKB(0)=强蜂 0.5（:12526-12532 0.5+KB×1.1）；
   *  penetrate=2、magic=false/ranged=true（:78076-78079——ranged 走冰霜引擎门
   *  frostEligible） */
  private spawnBeeSwarm(game: GameHooks): void {
    const ents = (game as unknown as { entities?: { add?: (e: unknown, b: string) => void } }).entities;
    if (!ents?.add) return;
    const stBee = game.player?.equipStats?.strongBees === true;
    const ol = Math.hypot(this.vx, this.vy);
    const nx = ol > 0 ? (this.vx / ol) * 8 : 0;   // vector65 = oldVelocity 归一 ×8
    const ny = ol > 0 ? (this.vy / ol) * 8 : 0;
    for (let i = 0; i < 6; i++) {
      if (i % 2 === 1 && Math.floor(Math.random() * 3) !== 0) continue;   // :78064 奇数拍 1/3
      // 每只独立掷 beeType()（strongBees 半数巨蜂;makeStrongBee 态同拍直通 beeDamage/
      // beeKB——Player.cs:12505-12527 三链顺序）
      const strong = stBee && Math.floor(Math.random() * 2) === 0;
      const dmgBee = Math.trunc(this.damage / 3)
        + (strong ? 1 + Math.floor(Math.random() * 3)          // Next(1,4) 强蜂
                  : Math.floor(Math.random() * 2));            // Next(2) 弱蜂
      const bee = new Arrow(this.x - nx * i, this.y - ny * i,
        (Math.floor(Math.random() * 71) - 35) * 0.01 + this.vx / 6,
        (Math.floor(Math.random() * 71) - 35) * 0.01 + this.vy / 6,
        dmgBee, strong ? 0.5 : 0, strong ? 566 : 181, {});
      bee.pierce = 2;                       // :78079 覆盖 181/566 表值 penetrate 3/4
      bee.pierceInit = 2;
      bee.frostEligible = true;             // ranged = true（:78078-78079）
      // ★F5（蓝队四轮）：消亡蜂群原版 `magic=false / ranged=true`（1458 P.cs:78075-79 /
      // 1456 :73387-90）——SetDefaults 零旗但本发蜂位显式覆写运行时旗 → 远程 crit 掷臂
      // (:12920)/焰爆石·拍击石类门全按 ranged 生效。仓内形态 = projClass 显式字段
      // （数据面 vanilla-projectiles.json 保持 SetDefaults 直写真值,combat-stitch-final
      // 金标断言 projClassOfProjId(181)=null 不动）。
      // ★同族发蜂位双式对账（grep 防第三处,2026-08-31）：①`.melee=true` 式——
      //   蜂巢剑挥动蜂 Player.cs:43976-77、蜂王双路 :44478-79/:44872-73、
      //   HiveFive 悠悠球弹 Projectile.cs:13758-59——仓内 Game.ts 挥动站已置
      //   bee.projClass='melee';②`.ranged=true` 式——蜂蜜徽章箭 Player.cs:13959-61 与
      //   本站;③唯一【无】旗位 = 蜂蜜斗篷受击反击 Player.cs:38810-13（仓内 Game.ts
      //   反击链不置 projClass,与原文一致）。
      //   ★999 陷阱拆除（2026-09-01 T1 批勘误）：上条 13758-59 支的受理门是
      //   `type == 999` =【HiveFive 悠悠球弹 999】（物品 5294 Hive Five）——旧注
      //   "黄蜂枪 999/黄蜂枪弹命中伴生"系型号误挂（原版物品 999=Amber 琥珀、
      //   WaspGun=1155、黄蜂弹=189）。黄蜂枪全部行为都在【出手侧】2-4 连发
      //   （Player.cs:48809-48820），189 弹命中侧【无】放蜂——已实装见 Game.ts
      //   case 'magic' 1155 支，无坑位遗留。
      bee.projClass = 'ranged';             // 运行时旗覆写（:78077-79 本站）
      bee.critChance = this.critChance;
      // ★BJ498①：critBonus 传播写位摘除（链上死值零读者——源恒类缺省 0,锚=字段注 BJ498①）
      bee.armorPen = this.armorPen;
      ents.add(bee, 'projectiles');
    }
  }

  /** 1130 蜜雷锋 Kill 爆裂（Projectile.cs:78085-78124；2026-08-30 孤儿武器 B1 波）：
   *  Item14 音 + 尘 31×20(scale1.5/alpha100)（:78088-78092）+ 壳 gore rand.Next(61,64)
   *  四象限×4（:78094-78113）——速度链严格按原版时序：NewGore(position, default(Vector2))
   *  内部先自加扰动（Gore.cs:1347-1348 vy-=Next(10,31)*0.1∈[1..3] /
   *  vx+=Next(-20,21)*0.1∈[-2,2]），出实例后 X/Y ±=1，最后整体 *=0.3——扰动与象限拍
   *  一并落入缩放，终速域 vx∈[-0.9,0.9]/vy∈[-1.2,0]（曾把 ±0.3 当初速直传 newGore、
   *  扰动其后全额叠加=散布 ~3×，2026-08-30 B1-2 修）
   *  ——以上无门。蜂群 owner==myPlayer 门 → !hostile 近似：N = rand.Next(15,25)=
   *  15..24 只（:78116-78124），弹型/伤/kb = Player.beeType()/beeDamage(damage)/
   *  beeKB(0f)（Player.cs:12505-12531：strongBees=蜂巢背包 3333 半数 566 巨蜂、强蜂伤
   *  +Next(1,4)、kb 0.5+KB×1.1），初速 = Next(-35,36)×0.02、出生点 = position 直传。
   *  蜂体走 SetDefaults 面值（本分支【不】写 magic/ranged/penetrate——那是上一分支
   *  honeyed 手雷段 :78086 前的写法）；追踪/淡入/入水消亡 = subStepAI aiStyle36 蜂族支 */
  private beenadeBurst(game: GameHooks): void {
    game.playSfxFiles?.(['Item_14'], 1, this.cx, this.cy);
    for (let i = 0; i < 20; i++) {
      game.spawnDust?.(this.x, this.y, this.w, this.h, 31, 0, 0, 100, null, 1.5);
    }
    const quad: ReadonlyArray<readonly [number, number]> = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
    for (const [sx, sy] of quad) {
      // :78094-78113 时序复刻：初速传 default(0,0)，NewGore 内部扰动（Gore.cs:1347-1348）
      // 落在实例上，出实例再 X/Y ±=1 → 整体 ×0.3（等效于把扰动与象限拍包含进缩放）
      const g = GorePiece.newGore(61 + Math.floor(Math.random() * 3), this.x, this.y, 0, 0);
      if (!g) continue;
      g.vx = (g.vx + sx) * 0.3;
      g.vy = (g.vy + sy) * 0.3;
    }
    const ents = (game as unknown as { entities?: { add?: (e: unknown, b: string) => void } }).entities;
    if (!ents?.add) return;
    if (this.hostile) return;                              // owner == Main.myPlayer 门（:78113）
    const st = game.player?.equipStats?.strongBees === true;
    const count = 15 + Math.floor(Math.random() * 10);           // Next(15,25)
    for (let i = 0; i < count; i++) {
      // 每只独立掷 beeType()（makeStrongBee 态同拍直通 beeDamage/beeKB——:12505 顺序）
      const strong = st && Math.floor(Math.random() * 2) === 0;
      const dmg = this.damage + (strong ? 1 + Math.floor(Math.random() * 3)  // Next(1,4)
                                        : Math.floor(Math.random() * 2));   // Next(2)
      const kb = strong ? 0.5 : 0;                              // beeKB(0f) 两档
      const bee = new Arrow(this.x, this.y,
        (Math.floor(Math.random() * 71) - 35) * 0.02,
        (Math.floor(Math.random() * 71) - 35) * 0.02,
        dmg, kb, strong ? 566 : 181, {});
      bee.critChance = this.critChance;
      // ★BJ498①：critBonus 传播写位摘除（链上死值零读者——源恒类缺省 0,锚=字段注 BJ498①）
      bee.armorPen = this.armorPen;
      ents.add(bee, 'projectiles');
    }
  }

  /** 710 空中祸害命中撒裂片（Damage() :13165-13168 → BetsySharpnel :51075-51091）：
   *  5 枚 710 = (0,6).RotatedBy(π/4 − i·π/6)（num3 = −2×(π/4)/(5−1)），同伤/kb、
   *  出生 ai[1]=-1（abShard 标——裂片不再撒裂片 :51077 门）；CopyLocalNPCImmunityTo
   *  对 710 为空表（无 usesLocalNPCImmunity）不接 */
  private spawnBetsyShards(game: GameHooks): void {
    const ents = (game as unknown as { entities?: { add?: (e: unknown, b: string) => void } }).entities;
    if (!ents?.add) return;
    for (let i = 0; i < 5; i++) {
      const ang = Math.PI / 4 - (Math.PI / 6) * i;          // num + num3×i
      const s = new Arrow(this.cx, this.cy, -6 * Math.sin(ang), 6 * Math.cos(ang),
        this.damage, this.knockback, 710, {});
      s.abShard = true;                                     // ai[1] = -1（:51086 尾参）
      s.frostEligible = true;
      s.critChance = this.critChance;
      // ★BJ498①：critBonus 传播写位摘除（链上死值零读者——源恒类缺省 0,锚=字段注 BJ498①）
      s.armorPen = this.armorPen;
      ents.add(s, 'projectiles');
    }
  }

  /** ★R29 幻象弓命中侧补刀链（Projectile.cs:13935-13943）：phantasmTime>0（630 载体
   *  在场续窗）时任何 arrow 弹（arrow=true 且 type≠631）命中 NPC → 从玩家身体随机点
   *  （position+Size×RandomVector2(0,1)）朝目标补 3 枚 631 幻象矢——方向=归一(目标−
   *  源点)×6、伤=damage×30%（int 截断）、kb=0、ai[0]=受害者 / ai[1]=0/15/30 错峰延迟 */
  private spawnPhantasmChase(game: GameHooks, target: { id: number; cx: number; cy: number }): void {
    const ents = (game as unknown as { entities?: { add?: (e: unknown, b: string) => void } }).entities;
    if (!ents?.add || !Arrow.phantasmWindowActive()) return;
    const p = game.player;
    const sxp = p.x + p.w * Math.random();
    const syp = p.y + p.h * Math.random();
    const dxp = target.cx - sxp, dyp = target.cy - syp;
    const dlp = Math.hypot(dxp, dyp) || 1;
    const vx631 = dxp / dlp * 6, vy631 = dyp / dlp * 6;
    const dmg631 = Math.max(1, Math.trunc(this.damage * 0.3));
    for (const delay of [0, 15, 30]) {
      const c = new Arrow(sxp, syp, vx631, vy631, dmg631, 0, 631,
        { grav: 0, life: 1200 });
      c.ph631Tgt = target.id;
      c.ph631Delay = delay;
      c.critChance = this.critChance;
      // ★BJ498①：critBonus 传播写位摘除（链上死值零读者——源恒类缺省 0,锚=字段注 BJ498①）
      c.armorPen = this.armorPen;
      ents.add(c, 'projectiles');
    }
  }

  /** 710 空旷判定（Damage() :12236-12239）：WorldUtils.Find(Center, Down(12)+notNull
   *  +solid) 未找到实心 = 空旷 → 命中伤 ×1.5。Down(12) 自锚点格起向下探 12 格
   *  （Searches.Down :44-55 含 i=0） */
  /** 876 命中侧随机化的 ai[1] 态（tileCollide 关断窗——AI 拍据此恢复,见 subStep 876 支） */
  private zapAi1 = 0;
  /** 876 zapinator 命中侧随机化（Damage_PVE type 876 支 Projectile.cs:12691-12777 逐行，
   *  掷序敏感）。rand(N)==0 语义 = 1/N 概率（Terraria Next(N) 右开）；±256 瞬移后
   *  tileCollide=false 由 AI :56892-56901 按 ai[1] 态恢复。Collision.SolidTiles 回退门
   *  以"命中点格实心"近似（弹盒 4×4 单格覆盖）。 */
  private zapinatorHitChaos(game: GameHooks): void {
    const ri = (n: number): number => Math.floor(Math.random() * n);   // [0,n)
    const solidAt = (px: number, py: number): boolean => {
      const st = game.world.store;
      const bx = Math.floor(px / TILE), by = Math.floor(py / TILE);
      return st.inBounds(bx, by) && st.isSolid(bx, by);
    };
    let tc = !this.noTileCollide;                        // 当前 tileCollide 态（AI 拍已恢复）
    if (ri(20) === 0) { tc = false; this.x += ri(513) - 256; }          // X 瞬移 ±256
    if (ri(20) === 0) { tc = false; this.y += ri(513) - 256; }          // Y 瞬移 ±256
    if (ri(2) === 0) tc = false;
    if (ri(3) !== 0) {                                   // 2/3：残像回退 −velocity×[0,39]
      const vx0 = this.x, vy0 = this.y;
      let back = ri(40);
      this.x -= this.vx * back; this.y -= this.vy * back;
      if (tc && solidAt(this.cx, this.cy)) {
        this.x = vx0; this.y = vy0;
        back = ri(40);
        this.x -= this.vx * back; this.y -= this.vy * back;
        if (tc && solidAt(this.cx, this.cy)) { this.x = vx0; this.y = vy0; }
      }
    }
    this.vx *= 0.6;                                      // (:12722)
    this.vy *= 0.6;
    if (ri(7) === 0) this.vx += 0.3;                     // rand(30,31)*0.01（:12723-12726）
    if (ri(7) === 0) this.vy += 0.3;
    this.damage = Math.max(1, Math.trunc(this.damage * 0.9));   // (int)((double)*0.9)
    this.knockback *= 0.9;
    if (ri(20) === 0) this.knockback *= 10;
    if (ri(50) === 0) this.damage *= 10;
    if (ri(7) === 0) {                                   // ±64 抖位 X（SolidTiles 回退）
      const x0 = this.x;
      this.x += ri(129) - 64;
      if (tc && solidAt(this.cx, this.cy)) this.x = x0;
    }
    if (ri(7) === 0) {                                   // ±64 抖位 Y
      const y0 = this.y;
      this.y += ri(129) - 64;
      if (tc && solidAt(this.cx, this.cy)) this.y = y0;
    }
    if (ri(14) === 0) this.vx *= -1;                     // (:12763-12768)
    if (ri(14) === 0) this.vy *= -1;
    if (ri(10) === 0) {                                  // ×rand(1,201)*0.0005（:12769-12772）
      const k = (1 + ri(200)) * 0.0005;
      this.vx *= k; this.vy *= k;
    }
    this.zapAi1 = tc ? 0 : 1;                            // (:12775-12777 ai[1] = tileCollide?0:1)
  }

  private skyOpen12(game: GameHooks): boolean {
    const st = game.world.store;
    const tx = Math.floor(this.cx / TILE), ty = Math.floor(this.cy / TILE);
    for (let k = 0; k < 12; k++) {
      const y = ty + k;
      if (!st.inBounds(tx, y)) break;
      if (st.isSolid(tx, y)) return false;
    }
    return true;
  }

  /** ApplyHarpyCharm（Projectile.cs:58779-58807）：引矢落标——rotateTowards
   *  (maxChange=π :58781/:58784) 一步全转保速 + 置 HarpyCharmed 位（:58787）+
   *  6181→PhoenixQuivered（:58788-58791）/ 6180→SeraphNecklaced（:58792-58795）+
   *  timeLeft 钳 ≤300（:58797-58800）。粒子（:58802 HarpyCharm/PhoenixQuiver/
   *  SeraphNecklace 三型）视觉面省略。 */
  applyHarpyCharm(tcx: number, tcy: number, itemVid: number, game?: GameHooks | null): void {
    const sp = Math.hypot(this.vx, this.vy);
    const want = Math.atan2(tcy - this.cy, tcx - this.cx);
    this.vx = Math.cos(want) * sp;                       // rotateTowards π = 全角一步到位
    this.vy = Math.sin(want) * sp;
    this.harpyCharmed = true;                            // :58787
    if (itemVid === 6181) this.phoenixQuivered = true;   // :58788-58791
    if (itemVid === 6180) this.seraphNecklaced = true;   // :58792-58795
    if (this.life > 300) this.life = 300;                // :58797-58800 timeLeft 钳 300
    // 弧线引矢三型编排（ApplyHarpyCharm 尾 :58802 RequestParticleSpawn(clientOnly:false,
    // SeraphNecklace|PhoenixQuiver|HarpyCharm, PositionInWorld=Center、MovementVector=velocity)
    // ——L5 长尾批收编真值本体 harpyCharmFamilyFx（FadingParticle 外抛/内环两组+十字
    // PrettySparkle+Item39/Item20 音）+ module8 上行。旧注「粒子视觉面省略」退役。
    const gA: GameHooks | null = game
      ?? (globalThis as unknown as { __swGameHook?: GameHooks }).__swGameHook ?? null;
    if (!gA) return;                                       // 无 Hook（测试桩面）静默——视觉缺通道登记
    const tType = itemVid === 6180 ? ParticleOrchestraType.SeraphNecklace
      : itemVid === 6181 ? ParticleOrchestraType.PhoenixQuiver : ParticleOrchestraType.HarpyCharm;
    harpyCharmFamilyFx(gA, itemVid, this.cx, this.cy, this.vx, this.vy);
    gA.broadcastParticleOrchestra?.(tType, this.cx, this.cy, this.vx, this.vy);
  }

  /** Collision.SolidCollision 等价（aiStyle 33 贴壁判定 :27480/:27487）：弹体
   *  6×6 盒覆盖到的格任一实心即 true（SolidCollision 逐格扫盒语义） */
  private flareSolidOverlap(game: GameHooks): boolean {
    const st = game.world.store;
    const x0 = Math.floor(this.x / TILE), x1 = Math.floor((this.x + this.w - 1) / TILE);
    const y0 = Math.floor(this.y / TILE), y1 = Math.floor((this.y + this.h - 1) / TILE);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        if (!st.inBounds(ix, iy)) continue;
        if (st.isSolid(ix, iy)) return true;
      }
    }
    return false;
  }

  /** ★R28 出生自校正（首个子步恰一次）：发射链挂点在 Game.ts case 'magic'
   *  （R26 蓝队文件分区，通用链以"单发直射出膛"为唯一形态），原版 Player.Shoot
   *  的多发梯次扇/天顶双锥/悬浮出生态几何在此按公式重构。
   *  锚定约定：本弹 = 原版发射循环的某一发（Game 出膛参数 = 未散布基准向量 +
   *  枪口点，与原版 i 循环首项同形）；兄弟弹经 entities 桶补齐。 */
  private birthSelfCorrect(game: GameHooks): void {
    const ents = (game as unknown as { entities?: { add?: (e: unknown, b: string) => void } }).entities;
    // ---- §8 336 松针手枪梯次扇（Player.cs:48067-48086）----
    // num30 = 2+rand.Next(3) 发；第 i 发 speed += rand(±35)×0.025×i 后重归一
    // ×shootSpeed(12)；出生点 = muzzle + baseV×(count−i)×1.75（沿弹道梯次排布）；
    // ai[0] 初值 rand(0,10(i+1))（重力门 50−init 子步,ctor/i=0 与此处兄弟弹同式）
    if (this.rp30Pending) {
      this.rp30Pending = false;
      Arrow.birthLock = true;
      try {
      const n30 = 2 + Math.floor(Math.random() * 3);
      const mzx = this.x, mzy = this.y;                     // 枪口（本弹原始出生位）
      const bvx = this.vx, bvy = this.vy;                   // 未散布基准向量（×12）
      const spd336 = Math.hypot(bvx, bvy) || 12;
      this.x += bvx * (n30 - 0) * 1.75;                     // i=0：前移最远、无散布
      this.y += bvy * (n30 - 0) * 1.75;
      for (let i = 1; i < n30 && ents?.add; i++) {
        let sx = bvx + (Math.floor(Math.random() * 71) - 35) * 0.025 * i;
        let sy = bvy + (Math.floor(Math.random() * 71) - 35) * 0.025 * i;
        const l = Math.hypot(sx, sy) || 1;                  // 重归一到 shootSpeed（:48077-48080）
        const pin = new Arrow(mzx + bvx * (n30 - i) * 1.75, mzy + bvy * (n30 - i) * 1.75,
          sx / l * spd336, sy / l * spd336,
          this.damage, this.knockback, 336,
          { grav: 0.5, gravDelay: Math.max(1, 50 - Math.floor(Math.random() * 10 * (i + 1))) });
        pin.critChance = this.critChance;
        // ★BJ498①：critBonus 传播写位摘除（链上死值零读者——源恒类缺省 0,锚=字段注 BJ498①）
        pin.armorPen = this.armorPen;
        ents.add(pin, 'projectiles');
      }
      } finally { Arrow.birthLock = false; }
    }
    // ---- §9 337 暴雪法杖天顶双锥（1458 Player.cs:48092-48119/1456 :48045-48072）----
    // ★2026-08-31 台账清偿：原版 for(num36<2) 同【拍】两掷——i=0 锥 Y−600、i=1 锥
    // Y−700,各自独立掷 X 散布 rand(201)(−dir)+rand(-200,201)、双轴抖动
    // rand(±40)×0.02【各掷一次均加号】、ai[1]=rand.Next(5)。旧实现静态奇偶轮替 +
    // multishot 两拍相隔 useTime=5 子步窗 → 退役：本弹按首发槽实现并【同拍】补生
    // 次锥(独立全参重掷);同挥第二发 shell 到达时经 blz337LatchAt 时间锁静默退役。
    // X 折叠式: pointPosition.X=(枪口+rand(201)(−dir)+鼠标世界X+Center.X)/2+rand(-200,201)
    if (this.blz337Pending) {
      this.blz337Pending = false;
      const now337 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const isFollower337 = now337 - Arrow.blz337LatchAt < 350;   // 补发窗(见 latch 注)
      Arrow.blz337LatchAt = isFollower337 ? -Infinity : now337;
      const p = game.player;
      const facing = (p.facing ?? 1);
      const pcx = p.x + p.w * 0.5;
      // 原式逐参发射器（slot=0 首发本弹直写 / slot=1 补生兄弟）——每锥全参独立重掷
      const coneGeom337 = (slot: number): { x: number; y: number; vx: number; vy: number } => {
        let sxc = pcx + Math.floor(Math.random() * 201) * -facing + (p.aimWX - p.x);
        sxc = (sxc + p.cx) / 2 + Math.floor(Math.random() * 401) - 200;
        const syc = p.cy - 600 - 100 * slot;                // Y −600 / −700（:48100-48101）
        let dxc = p.aimWX - sxc;
        let dyc = p.aimWY - syc;
        if (dyc < 0) dyc *= -1;                             //（:48104-48107 翻负）
        if (dyc < 20) dyc = 20;                             //（:48108-48110 钳 ≥20）
        const lenc = Math.hypot(dxc, dyc) || 1;
        const jx = (Math.floor(Math.random() * 81) - 40) * 0.02;   // :48116 两轴各掷一码,
        const jy = (Math.floor(Math.random() * 81) - 40) * 0.02;   // 均【加】号（曾共用
        return { x: sxc, y: syc,                            // 一码且 Y 反号=B 档漂移,修）
          vx: dxc / lenc * 10 + jx, vy: dyc / lenc * 10 + jy };
      };
      if (isFollower337) {                                  // 同挥第二发——原版已无此弹
        this.dead = true;                                   // 静默让位（无尘无声,535 先例）
        return;
      }
      Arrow.birthLock = true;                               // 兄弟构造期抑制 ctor 自挂
      try {
        const cone0 = coneGeom337(0);
        this.x = cone0.x; this.y = cone0.y;
        this.vx = cone0.vx; this.vy = cone0.vy;
        //（本弹 pinFrame 由 ctor 掷定=原版 spawn 侧 rand.Next(5);次锥 birthLock 下
        // ctor 未掷,下方显式补）
        const g1 = coneGeom337(1);                          // i=1 次锥 Y−700
        const cone1 = new Arrow(g1.x, g1.y, g1.vx, g1.vy,
          this.damage, this.knockback, 337, {});
        cone1.pinFrame = Math.floor(Math.random() * 5);     // ai[1]=rand.Next(5) :48118
        cone1.critChance = this.critChance;
        // ★BJ498①：critBonus 传播写位摘除（链上死值零读者——源恒类缺省 0,锚=字段注 BJ498①）
        cone1.armorPen = this.armorPen;
        ents?.add?.(cone1, 'projectiles');                  // 桶缺 add 口=静默跳过
      } finally { Arrow.birthLock = false; }
    }
    // ---- §3 316 蝙蝠杖 2-3 只散布（Player.cs:48820-48830）----
    // num124 = rand.Next(2,4)；每只 num4/num5 += rand(±35)×0.05 双轴散布
    // （含 i=0——本弹散布在此补掷,与兄弟弹同分布）。无出生点位偏移
    if (this.bat316Pending) {
      this.bat316Pending = false;
      Arrow.birthLock = true;
      try {
      const n124 = 2 + Math.floor(Math.random() * 2);
      const jx = (Math.floor(Math.random() * 71) - 35) * 0.05;
      const jy = (Math.floor(Math.random() * 71) - 35) * 0.05;
      this.vx += jx; this.vy += jy;
      for (let i = 1; i < n124 && ents?.add; i++) {
        const b = new Arrow(this.x, this.y,
          this.batBaseVx + (Math.floor(Math.random() * 71) - 35) * 0.05,
          this.batBaseVy + (Math.floor(Math.random() * 71) - 35) * 0.05,
          this.damage, this.knockback, 316,
          { grav: 0, life: 600, pierce: 1 });
        b.critChance = this.critChance;
        // ★BJ498①：critBonus 传播写位摘除（链上死值零读者——源恒类缺省 0,锚=字段注 BJ498①）
        b.armorPen = this.armorPen;
        ents.add(b, 'projectiles');
      }
      } finally { Arrow.birthLock = false; }
    }
    // ---- §4 659 灵魂之焰悬浮出生态（Player.cs:49297-49310）----
    // 方向 = 全圆随机（CanHit 试 ≤10 次）RotatedBy ×(0.95+rand×0.3)；
    // 出生点 = pointPosition + 该向×30；velocity = Zero；ai[0]=−2
    if (this.sf659Birth) {
      this.sf659Birth = false;
      let ang = Math.random() * Math.PI * 2;
      for (let t = 0; t < 10; t++) {
        if (canHitLine(game.world.store, this.cx, this.cy, 0, 0,
          this.cx + Math.cos(ang) * 100, this.cy + Math.sin(ang) * 100, 0, 0)) break;
        ang = Math.random() * Math.PI * 2;                  //（:49299-49304 重掷）
      }
      const mag = 0.95 + Math.random() * 0.3;
      const ux = (this.sf659DirX * Math.cos(ang) - this.sf659DirY * Math.sin(ang)) * mag;
      const uy = (this.sf659DirX * Math.sin(ang) + this.sf659DirY * Math.cos(ang)) * mag;
      this.x += ux * 30;                                    // vector57×30 偏移（:49308）
      this.y += uy * 30;
      this.vx = 0; this.vy = 0;                             // velocity = Zero
      this.sf659Ai0 = -1;                                   // ai[0]=−2 → 无锁态
    }
    // ---- §15 535 美杜莎之首转换（AI_100 :45296-45454 整套挂件模型）----
    // Game 通用链把 3269 当普通魔法杖扣蓝发一枚漂移 Arrow——首子步换成
    // MedusaHeadProj 专用实体并退还本次误扣魔（ShouldSkipManaUse :53329-53331
    // 语义,R26 落地分流后随 MEDUSA_REFUND_LEGACY_CHARGE 关闭）
    if (this.projId === 535) {
      // ★BJ497③（2026-10-04）：MedusaHeadProj ctor critBonus 死形参摘除（BJ494⑥ 钉死
      //  面、BJ496① 登记清偿）——调用形同步摘实参（critBonus 本字段零读者,BJ497① 后同）。
      const m = new MedusaHeadProj(game.player, this.damage, this.knockback,
        this.critChance, this.armorPen);
      if (ents?.add) ents.add(m, 'projectiles');
      this.dead = true;                                     // 静默让位（无尘无声）
    }
  }

  /** ★R28：3269 上游扣魔退还开关——R26 蓝队在 Game.ts case 'magic' 落地
   *  ItemCheck_PayMana_ShouldSkipManaUse(3269) 分流后置 false（见落点清单 #1）
   *  （实际消费在 MedusaHeadProj 同名静态字段,此处注释锚点） */
  static readonly MEDUSA_REFUND_LEGACY_CHARGE = true;

  /** ★2026-08-31 云间互斥 whoAmI 序发生器（见 cloudWho 字段注） */
  private static cloudWhoSeq = 0;
  /** ★2026-08-31 天顶双锥同拍锁：首发实现拍盖时间戳,同挥第二发（multishot 补发,
   *  最迟 useTime×2.5 空蓝慢施≈217ms 后到达）消费退役——替代旧静态奇偶轮替。
   *  残留风险登记：若补发 shell 因任何分支缺失未到,下一挥首发的判定窗内(350ms)
   *  会被误认作补发而让位一次,几何分布不变、随后自愈（当前泛化注册与 1931
   *  同源 useTime 恒伴生,实际不可达）。 */
  private static blz337LatchAt = -Infinity;
  /** ★R28 出生自校正互斥锁：兄弟弹构造期抑制 ctor 的 pending 自挂（防递归展开） */
  private static birthLock = false;

  /** ParticleOrchestraType.ShadowbeamFriendly 枚举序（ParticleOrchestraType.cs:64,
   *  Keybrand=0 起 → 59）;broadcast 钩子只送联机中继,本地视觉由 shadowbeamSegment 承载 */
  private static readonly SHADOWBEAM_ORCHESTRA_IDX = 59;

  /** §1 束段铺撒（Spawn_Shadowbeam :1987-2005 + SpawnHelper_SpawnInLine :2012-2031）：
   *  从锚点(sbAx/sbAy)到当前心按步距 max(4,|v|) 铺点,每步 3×d173（本位/−dir·0.25|v|/
   *  −dir·0.5|v|）、scale rand(70..110)×0.013、尘速 ×0.2 */
  private shadowbeamSegment(game: GameHooks): void {
    const dxs = this.cx - this.sbAx, dys = this.cy - this.sbAy;
    const dist = Math.hypot(dxs, dys);
    if (dist <= 0) return;
    const spd = Math.hypot(this.vx, this.vy);
    const step = Math.max(4, spd);
    const ux = dxs / dist, uy = dys / dist;
    for (let s = 0; s < dist; s += step) {
      const px = this.sbAx + ux * s;
      const py = this.sbAy + uy * s;
      for (let k = 0; k < 3; k++) {
        const off = k * 0.25 * spd;
        game.spawnDust?.(px - ux * off, py - uy * off, 1, 1, 173,
          0, 0, 0, null, (70 + Math.random() * 40) * 0.013, true);
      }
    }
  }

  fixedUpdate(_dt: number, game: GameHooks) {
    // ★R2-F3（2026-09-03）：22 水花权杖 remix 支（SetDefaults :1052-1057
    //  `if (Main.remixWorld) { usesLocalNPCImmunity = true; localNPCHitCooldown = 12; }`）
    //  ——条件档数据列不可静态求值（148 armorPenetration=20 同款登记先例）,ctor 的
    //  数据驱动 localImmune 无从携带世界态 → 在 tick 头按 world.seedFlags.remix 补齐
    //  （命中环在本 tick AI/移动之后,首拍命中不落时序差;非 remix 世界无此旗,ctor
    //  数据列缺 22 档 → localImmune 保持 0=全局 immune 窗,同原版缺省）。幂等重写无副作用
    if (this.projId === 22 && game.world.seedFlags?.remix) this.localImmune = 12;
    // 联机傀儡（远端弹幕快照驱动）：对敌判定归拥有者客户端；对玩家（hostile）由访客本地结算 Damage_EVP（netPuppetProjContact）
    if (this.netPuppet) { this.netPuppetStep(); return; }
    // ★L2 出生预置（NX3 遗留2 清偿,NewProjectile :10887-10893 1:1）：
    //   `wet = WetCollision(position,width,height); if (ignoreWater) wet = false;
    //   honeyWet = Collision.honey; shimmerWet = Collision.shimmer;`——原版弹体
    //   出生即带 wet 缓存,AI 首子步读【出生拍值】而非"当场重测"。
    //   时序书面化（出生即时测 ≡ 首子步头测,逐值等价）：①本仓位移积分在 AI 尾,
    //   首个 fixedUpdate 时位置仍=出生盒;②液体步进在实体轮【后】(Game tick :
    //   entities.update → 液体段),出生与首子步之间液体态不可变;③生成路径
    //   （玩家 updateUse/敌怪/NPC/前序弹幕）全部落在实体轮内,for-of 活数组
    //   当拍即更——仅 props/critters 桶生成体晚一拍,与原版 Main.projectile
    //   freed-index 回槽错过当拍的延迟同构（原版亦非零延迟面）。
    //   ⇒ 出生预置=首子步头同位同液态测值;消费位（subStepAI 头）读缓存与原版
    //   读字段同源,时序差归零。消费者=wetCacheConsumer（蜂族+469）。
    if (!this.presetDone) {   // ★2026-09-06 预置逐字面化（:10886-10893,红队 R1+R2）:豁免弹也跑预置——
      //   honeyWet/shimmerWet 原文【无条件】赋值（:10892-10893 无豁免支）,只有 wet 被
      //   :10888-10891 反清;旧"豁免弹整段跳过"漏写两旗（原版豁免弹出生在蜂蜜/微光
      //   honeyWet/shimmerWet=true 且终身不更新不清=段门 :16895 整跳）。
      this.presetDone = true;
      const rWet = wetCollision(game.world.store, this.x, this.y, this.w, this.h);
      this.wet = rWet.wet;                                              // :10887
      if (projectileData(this.projId)?.ignoreWater) this.wet = false;   // :10888-10891（豁免只反清 wet）
      this.honeyWet = rWet.honey;                                       // :10892 无条件赋值（原文字面）
      this.shimmerWet = rWet.shimmer;                                   // :10893 无条件赋值（原文字面）
      // ★lavaWet 预置写退役（2026-09-06,与 projWetSection 共享体批同步）——原版
      //   NewProjectile 确实不设 lavaWet（:10886-10893 无此行）;F3（2026-09-01）补的
      //   "预置携带 tick1 档 lavaWet"前提已随湿段时序重排失效:消亡判定现跑在本子步
      //   湿段 wetSectionStep 段内、位于 :16906-16911 lavaWet 并入【之后】（=原版
      //   Update1 同序）,出生即在浆里的 IsDestroyedByWater 弹仍被粘滞面保护,
      //   预置补写反而令 AI 首子步读到原版读不到的 lavaWet=true（原版 NewProjectile
      //   后 lavaWet 恒 false）。行为回归钉=proj-wet-cache F3①沾浆渡水（零改全绿）。
    }
    // R4-38：宝石法珠首帧音（1457 AI_029_GemStaffs_ActuallyGemStaffs :38543-38551
    // soundDelay==0→-1 闸,统一 Item_205=StackableItem8ForRubyStaff;1120→Item72）——
    // 傀儡侧不播（快照可晚到多拍,迟响比不响更怪;原版客户端全量模拟本 AI,此处
    // 仅拥有端=发声主体）
    if (!this.gemShotSounded && (isGemBolt(this.projId) || this.projId === 1120)) {
      this.gemShotSounded = true;
      game.playSfxFiles?.([this.projId === 1120 ? 'Item_72' : 'Item_205'], 1, this.cx, this.cy);
    }
    // 宝石弹 oldPos 环（Projectile.cs:17236-17245 TrailingMode=2 每 tick 逐位后移，
    // oldPos[0]=本 tick 出生位）——Colliding :15452-15466 FastThenSlow 拖尾扫掠消费
    //（蓝队 R2-02：本仓 Arrow 原无位置历史，补 5 帧环形缓冲）★1120 同 aiStyle29
    // 也吃 GemStaffShotDrawer 拖尾（Main.cs:28623 分发表含 1120）→ 记录条件扩同集
    // ★BJ675：容量对齐 TrailCacheLength（ProjectileID.cs:387——宝石七弹=30 点、
    //  1120 琥珀弹=20 点）。旧 12=6 点把 180px 光带截成 ~30px「短暗尾」。
    if (this.gem || isGemBolt(this.projId) || this.projId === 1120) {
      this.gemTrail.unshift(this.x, this.y);
      const cap = this.projId === 1120 ? 40 : 60;      // ×2=点数（x,y 交错存储）
      if (this.gemTrail.length > cap) this.gemTrail.length = cap;
    }
    // ★shader 审计战役：34 火鞭/16 魔导弹/106 光棱剑拖尾记录（原版 Main.cs:28616-28622
    //   /28664-28666 FlameLashDrawer/MagicMissileDrawer/LightDiscDrawer 的 oldPos 环）
    if (this.projId === 34 || this.projId === 16 || this.projId === 106) {
      this.stripTrailPts.unshift(this.x, this.y);
      if (this.stripTrailPts.length > 24) this.stripTrailPts.length = 24;
    }
    // 1097 火绒狐火球 oldPos 环（TrailingMode 0 每 tick 后移 :17202-17206——tick 头
    // 位后移 10 槽;AI 侧 :57558 d55 尾迹读 oldPos[9],前 9 tick 环未满=全 Zero 不撒,
    // 与原版 `oldPos[9] != Vector2.Zero` 门同相）
    if (this.projId === 1097) {
      this.foxTrail.unshift(this.x, this.y);
      if (this.foxTrail.length > 20) this.foxTrail.length = 20;
    }
    // 食人鱼 190 独占状态机（aiStyle 39）——重力/穿透递减/撞块消亡等通用语义不适用
    if (this.piranha) { this.piranhaStep(game); return; }
    // 出生预置局部免疫逐帧递减（DecrementLocalImmuneTimeCounters :15919-15936——
    // Update :15330 在 numUpdates 子步循环【前】每 tick 恰一次，非每子步）
    for (const [k, v] of this.spawnImmuneCd) {
      if (v <= 1) this.spawnImmuneCd.delete(k); else this.spawnImmuneCd.set(k, v - 1);
    }
    // ★碎片链收口刃（2026-09-28）：命中侧写档同表（:14178 immuneArray[victim]=
    //   localNPCHitCooldown → :17365-17384 同函数逐拍衰减）——localImmuneCd 此前只在
    //   502 专支内衰减,其余 usesLocalNPCImmunity 全族（617=8t/618=20t/宝石法珠
    //   121-126=60t/音符 77-78=30t/309=10t…）写档后恒不衰减 = 驻场/穿行弹对同敌
    //   至多 1 击（617 三击爆炸链整段死路,只能等 600t 计时爆）。与 spawnImmuneCd
    //   同位每 tick 恰一次（原版单数组,本仓双表拆分同衰减节拍）
    for (const [k, v] of this.localImmuneCd) {
      if (v <= 1) this.localImmuneCd.delete(k); else this.localImmuneCd.set(k, v - 1);
    }
    // extraUpdates 子步循环（Projectile.cs:15331-15336）：numUpdates = extraUpdates，
    // while(numUpdates>=0) 跑完整 AI/位移/命中体——timeLeft 也在循环内逐子步消耗
    //（:15861），故弹体寿命同步缩短为 1/(N+1)。
    // aiStyle 36 蜂族：alpha 归零拍 extraUpdates=0（:27693-27695）——挂起到 tick 头
    // 生效（原版 numUpdates 每 tick 读取一次，当拍子步数不变）
    if (this.bee36EU0) { this.bee36EU0 = false; this.extraUpdates = 0; }
    // 22 水花权杖熔岩反弹档 extraUpdates=0（:24846）——同 bee36EU0 挂起到 tick 头
    //（原版 numUpdates 每 tick 读取一次,当拍子步数不变）
    if (this.waterEU0) { this.waterEU0 = false; this.extraUpdates = 0; }
    for (let u = 0; u <= this.extraUpdates; u++) {
      // 640 ai[1] 延迟计数（Projectile.Update :16784-16787 1:1——numUpdates 子步循环
      // 顶 `type==640 && ai[1] > 0` → ai[1]-- + continue：整【子步】冻结,AI/位移/命中/
      // timeLeft 递减/渐显全跳。EU=3(:6900 MaxUpdates=3) → 每 tick 消 4 计数;计数源=
      // 639 Kill num391（killNow 生成面注）。Kill 消亡面批 2 2026-09-02 实装）
      if (this.ai1Delay > 0) { this.ai1Delay--; continue; }
      this.subIsHead = u === 0;
      this.subStep(game);
      if (this.dead) return;
    }

  }

  /** ★BJ219 通用 oldPos 记录（Projectile.cs:17197-17300——UpdateTrails 在 Update
   *  子步循环【内】:17198,每【子步】位移后一段=extraUpdates 弹逐子步后移）。
   *  调用位=subStep 尾（位移/尘段后、寿命杀位前——原版 Damage 之后 :17198 同序;
   *  撞块杀位 dead 早退不记录=:17132 `!active` return 同相）。rot=速度角（原版
   *  rotation 的速度向语义子集,登记①）;dir=1 恒值（★BJ703-B D1 收编:Arrow 载体
   *  mode2/3/4 全员——671/680/686/710/711/729/811/814/872/873/931/976/977/
   *  1001/1039/1045/1097——1457 AI 函数逐支核【全程无 spriteDirection 写】
   *  （唯一写位 :22750 属 AI_DisplayDoll_ItemDisplay 展示人偶非活面）→ 原版
   *  oldSpriteDirection 恒 1;旧 sign(vx) 记录=左飞幽灵假镜像（872 贴图 95%
   *  非对称=可见）,本刀归位。翻转员 1001 虽每拍写 spriteDirection 但属豁免档
   *  （基底直取,XOR 臂不消费 slot.dir）→ 记录面死值,1 同相）。 */
  private recordGhostTrail(): void {
    if (this.ghostRing === undefined) {
      this.ghostRing = !Arrow.GHOST_RECORD_EXCLUDE.has(this.projId) && projTrailingMode(this.projId) >= 0
        ? new ProjGhostRing(this.projId)
        : null;
    }
    this.ghostRing?.record(this.x, this.y, Math.atan2(this.vy, this.vx),
      1, this.subIsHead);   // dir=1（BJ703-B D1:spriteDirection 语义原位恒值）
  }

  /** ★BJ252 872 永恒彩虹 oldPos 命中面（Projectile.cs:15761-15775 Colliding 特支）：
   *  命中判定 = 以 oldPos[l]（l∈[0,50) 步 2 = 25 槽）为锚的【本盒平移】,任一与
   *  目标盒相交即命中;Zero 槽跳过（:15769）=本仓 NaN 未填槽跳过。槽 0=上子步末
   *  位（UpdateTrails :17198 在 Damage 后一拍）——本仓环槽 0 同位序（首拍环空→
   *  全跳过=原版首拍 oldPos 全 Zero 同相,首拍不可命中）。872 无 extraUpdates →
   *  1 子步/t = 环槽 i ≙ i tick 前;cap=TrailCacheLength[872]=120 ≥ 50 上限。
   *  消费面 = hitPlayer/hitTownNpcs 的 Colliding 自定义判定通道（919/923 同习语,
   *  projTargets.ts :551/:52）——hostile 弹只吃玩家/镇民两面,敌怪面不可达。 */
  private empress872TrailCollide():
    (r: { x: number; y: number; w: number; h: number }) => boolean {
    return (r) => {
      const ring = this.ghostRing;
      if (!ring) return false;
      for (let l = 0; l < 50 && l < ring.cap; l += 2) {
        const px = ring.px[l], py = ring.py[l];
        if (Number.isNaN(px) || Number.isNaN(py)) continue;       // Zero 哨兵跳过(:15769)
        if (px < r.x + r.w && px + this.w > r.x
          && py < r.y + r.h && py + this.h > r.y) return true;
      }
      return false;
    };
  }

  /** ★⑥杀拍口径（2026-09-06）：原版 Update 对湿段【无 active 门】——AI(:16880
   *  `if (active)`)内 Kill（active=false）当拍湿段(:16903 `if (!ignoreWater)`)照跑
   *  （旗刷新/水death 判定/溅花/wetCount 维护），`!active` 门在 HandleMovement(:17120)
   *  之后 :17132 才生效、只拦 Damage 管线。本仓 AI 杀位（killNow+return）曾整体跳过
   *  湿段=杀拍溅花缺口（469 出水杀拍/计时·α 渐隐族入水杀拍…原版都溅）。
   *  抽成本方法双调用点：①活拍=subStepAI 尾原位（AI→湿段→位移序不变）；
   *  ②杀拍=subStep dead 支补跑（wetSectionRan 防同子步双跑——AI 链【后】的撞块/
   *  出界杀位在活拍已跑过湿段）。死亡拍位移仍跳过：原版死拍 HandleMovement 照走
   *  一步,但 Kill 尘/gore 已在杀位结死、弹体随即移除,死拍位移零观感（证毕登记非债）。
   *  杀拍段内水death/80 的补 Kill 借 killNow 头幂等门（:71755-71758 `if (!active)
   *  return;`）免双爆。 */
  private wetSectionRan = false;

  /** 段内 kill 钩触发闩（水death :16923-16925 / 80 :16941）——活拍调用位（subStepAI
   *  尾）据此跳过段后位移/撞块链：退役自移植副本旧「段内 killNow+return」早退语义
   *  收口后由本闩承载（死亡拍位移跳过既案不因共享体收口漂移;亦免本仓 cutTile 在
   *  active 门【外】于死拍多跑——原版 CutTiles 位 Damage() :11824 内,受 :17131
   *  `if (!active) return` 门拦）。杀拍 dead 支补跑路径不经活拍调用位,本闩只服务
   *  subStepAI 尾调用点。 */
  private wetSectionKilled = false;

  /** ★L2 通用湿段（Projectile.cs:16903-17113）——2026-09-08 平行副本收口：段体整体
   *  切 projWetSection.projectileWetSection 共享体（全体弹同源,逐值 1:1 注在彼处）,
   *  退役本类自移植段体与 wetSplashStep 穿参壳（收口前逐行对拍=报告对照表,行为锁=
   *  tests/arrow-wet-consolidation.test.ts）。本方法仅剩杀拍闩 + 实体面 hooks 组装
   *  （WeaponProj.wetSectionStep 同配方）。
   *  位序（原版 Update 内）:AI(:16880)→本湿段(:16903)→HandleMovement(:17120)——活拍
   *  调用位=subStepAI 尾/通用位移行前（2026-09-04 时序重排既案:段内 WetCollision 测位
   *  /溅花出生位=位移前;AI 头湿旗消费者 469/376/蜂族/710 读上一子步段值,位移行消费
   *  当拍旗做阻尼）。豁免核对与段内特支（水death/2 变型/34/80/155/242/302/638 前置
   *  清位）随共享体承载——Arrow 域 242/302/638 数据面 ignoreWater=true（前置清位对其
   *  双重死码）,收口后该行随共享体补齐（退役副本缺行=登记漏,行为零差）。
   *  hooks 适配（与退役副本逐值同相）：
   *    · kill=killNow + wetSectionKilled 闩（幂等门既案;★段尾续跑语义=原版 :16921
   *      Kill() 不中断湿段——退役副本「杀即 return 跳段尾」系偏离,收口改归原版;
   *      段后位移/撞块仍由闩跳过=死亡拍位移跳过既案保持）;
   *    · transformFlamingArrow=projId=1 内联变型（:16929 TransformType(1),light=0 由
   *      projId=1 数据缺 light 行承载——退役副本同式）;
   *    · iceBlockAi0=hostileAi0（80 支 ai[0]>=0f 判定;80 无出生面=死码照抄）;
   *    · onBeachBallExit=vy×0.5（155 出水特支 :16980-16981）;
   *    · shimmer=⑧Shimmer() 全步回调（:17114-17117 湿段后/HandleMovement 前;位在
   *      `if (!ignoreWater)` 整段门【外】=豁免弹出生预置写下的 shimmerWet 亦驱动,
   *      共享体豁免支+段尾双调用位同式收口）。face 组装/写回与退役副本同式：
   *      life≡timeLeft/vx·vy/wet 旗直读写;★ai0/ai1=0 恒传（本类无原版 ai[0]/ai[1]
   *      通用活面——opts.ai0/ai1 为逐型注入面,实例字段各型私名;承载域亦无 aiStyle
   *      15/99/相刃 id → 头门 99·15 支与相刃支对 Arrow 域零消费=缺面死码登记,0=原版
   *      float[] 缺省非猜值）;kill=killNow（幂等门既案）;936 解锁半边接 B1-X3 既有
   *      shimmerUnlock（原 mid-AI 特支块 2026-09-07 随本泛化收口,见 AI 链原位注——
   *      触发域 center-cell shimmerImmersed → 原版 shimmerWet 盒级旗,粒度差异既案;
   *      解锁回调内部保留同谓词早退=防漂移双保险）。
   *  出生预置不走共享体首调路径：fixedUpdate 头预置块（:10886-10893 1:1）先行落账
   *  presetDone——首子步 AI 头湿缓存消费者（469/蜂族）须读到出生预置值（共享体预置
   *  在首调=首子步 AI 后,晚一拍）,故预置位次保留 fixedUpdate 头,共享体 presetDone
   *  门对 Arrow 恒短路。 */
  private wetSectionStep(game: GameHooks): void {
    if (this.wetSectionRan) return;   // ★同子步防双跑(红队R2/F 移交):活拍段后撞块/出界杀位已跑过,dead 支补跑须跳过——否则 wetCount 窗双折减
    this.wetSectionRan = true;
    this.wetSectionKilled = false;
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater, {
        kill: () => { this.wetSectionKilled = true; this.killNow(game); },
        transformFlamingArrow: () => { this.projId = 1; },   // :16929 TransformType(1)
        iceBlockAi0: this.hostileAi0,                        // :16941 ai[0]>=0f（80 无出生面=死码照抄）
        onBeachBallExit: () => { this.vy *= 0.5; },          // :16980-16981
        shimmer: (st, x, y, _w, _h) => {
          const sf: ProjShimmerFace = {
            projId: this.projId,
            aiStyle: projectileData(this.projId)?.aiStyle ?? -1,
            hostile: this.hostile,
            vx: this.vx, vy: this.vy,
            timeLeft: this.life,
            ai0: 0, ai1: 0,
            wet: this.wet, shimmerWet: this.shimmerWet,
            // 惰性 getter：分派仅 936 支读此旗（短路）——非 936 弹零读 world.flags
            // （湿缓存测试桩 world 无 flags 字段不炸;真世界 flags 恒在=WldParser 既案）
            get rainbowSlimeUnlocked() { return game.world.flags?.['unlockedSlimeRainbowSpawn'] === true; },
            kill: () => this.killNow(game),
            unlockRainbowSlime: () => this.shimmerUnlock(game),
          };
          projShimmerStep(sf, st, x, y, this.cx);
          this.vx = sf.vx; this.vy = sf.vy; this.life = sf.timeLeft;
          this.wet = sf.wet; this.shimmerWet = sf.shimmerWet;
        },
      });
  }

  /** ★BJ431 火花 954 命中快进（Damage_PVE_Inner :13051-13055 type 504||954||979 共支,
   *  本类承载域只 954）：`ai[0] += (60f − ai[0]) / 2f` float 直加——计寿钟向 60 折半
   *  逼近（首中 ≈30）,尾迹衰减段提前+约 0.5s 内自灭。主环调用位=免疫门后/Strike 前
   *  （vanilla :12636→:13051→:13702 位序同相）。 */
  private sparkHitFastForward(): void {
    this.sparkAi0 += (60 - this.sparkAi0) / 2;
  }

  /** ★BJ703-D3：KillOldestJavelin（Projectile.cs:15156-15183,614 档 buffer=
   *  _javelinsMax10 :14050-14053）：同玩家同型 stuck（ai[0]==1）∧ 同靶
   *  ai[1]==victimIndex 的【其他】活弹 ≥10 → Kill 剩余 timeLeft 最小者（受保护弹
   *  =本弹自身不入选,`i != protectedProjectileIndex`）。owner==Main.myPlayer 在
   *  Damage 路径恒真 ⇒ 单机全 614 域。timeLeft 面=本仓 life。 */
  private killOldestJavelin614(game: GameHooks, victimId: number): void {
    // ?. 防御：测试桩 hooks 可无 entities（真游戏恒在——R7-19 夹具判例）
    const projs = (game as unknown as { entities?: { projectiles?: unknown[] } }).entities?.projectiles ?? [];
    const found: { p: Arrow; life: number }[] = [];
    for (const q of projs) {
      if (q === this || !(q instanceof Arrow)) continue;
      const a = q as Arrow;
      if (a.dead || a.projId !== 614 || a.stickerA0 !== 1 || a.stickerTgt !== victimId) continue;
      found.push({ p: a, life: a.life });
      if (found.length >= 10) break;                 // buffer 扫满即止（:15164-15167）
    }
    if (found.length < 10) return;                   // :15170-15173
    let oldest = found[0];
    for (let j = 1; j < found.length; j++) {
      if (found[j].life < oldest.life) oldest = found[j];   // 最低 timeLeft（:15174-15181）
    }
    oldest.p.killNow(game);                          // :15182
  }

  /** 单次子步（无 extraUpdates 时即整帧本体）——timeLeft 递减在 AI/位移/命中之后。
   *  蓝队 R7-5：原版 `timeLeft--; if (timeLeft <= 0) Kill()` 位于子步循环【末尾】
   *  （Update :17307-17311，AI/位移/Damage 之后）——AI 恰好跑 timeLeft 次,且寿命尽
   *  当拍即杀（Kill 链如 AoeExplosion 同拍触发）。曾在子步头递减：全体 Arrow 系
   *  寿命恒少 1 个 AI update（timeLeft 门控型 837 −33 速消/639 重力门级联偏移一拍） */
  private subStep(game: GameHooks): void {
    if (this.life <= 0) { this.killNow(game); return; }   // 防御（正常由尾部递减杀）
    this.wetSectionRan = false;
    this.subStepAI(game);
    if (this.dead) {
      // ★⑥杀拍口径（2026-09-06）：原版 Update 对湿段【无 active 门】（:16880
      //  `if (active) AI()` → :16903 `if (!ignoreWater)` 湿段 → :17120 HandleMovement
      //  之后 :17132 才 `!active` 门）——AI 内 Kill（active=false）当拍湿段照跑
      //  （杀拍溅花/水death 判定/wetCount 维护）。本仓 AI 杀位 killNow+return 曾整体
      //  跳过湿段=杀拍溅花缺口;wetSectionRan 防同子步双跑（AI 链后段的撞块/出界杀位
      //  活拍湿段已跑）。死亡拍位移仍跳过=零观感（Kill 尘/gore 已在杀位结死,
      //  见 wetSectionStep 头注）。
      this.wetSectionStep(game);
      return;
    }
    // ★2026-09-04 湿段时序重排：通用湿段（:16903-17113 旗刷新+水death/2 变型+34/80
    //   +溅花+三清+wetCount）已整体挪入 subStepAI 尾、通用位移行【之前】——原挂
    //   本处（子步尾=位移后）,段内 WetCollision 测位/溅花出生位晚一步、位移消费的
    //   是上拍旗,与原文 Update 内 AI(:16880)→湿段(:16903)→HandleMovement(:17120)
    //   位序差一拍。挪后 AI 头湿旗消费者（469/376/蜂族/710）读到的仍是上一子步段值
    //   （字段语义逐值同）,段注/段体见 subStepAI 尾湿段块。本子步余段=原版段后：
    //   位移（subStepAI 尾已跑）→ Update 尾通用尘（:17141-17182,下方 switch）→
    //   timeLeft（:17307）——序不变。
    // ---- Update 尾尘通用段（Projectile.cs:17141-17182;★R1 红队勘误:段在
    //      numUpdates 子步循环【内】(:16781 while 体延伸至 :17345)——每【子步】1 粒,
    //      278/5 EU=1 → ×2/帧,余型 EU=0 ×1):2/82 燃烧箭 d6 α100 /
    //      172 毒镖 d135 / 103 流星弹 d75（1/2 noGravity+scale×2）/ 278 绿藻弹
    //      d169（1/2 noGravity+scale×1.5）/ 4 星星 1/5 掷 d14（α150 scale1.1）/
    //      5 猎鹰刃 rand(15,57,58)+v×0.5（α150 scale1.2）——speedX/Y 走 NewDust
    //      "随机±2.0+speedX" 合成式（spawn 通道同式），后置字段逐字覆写
    switch (this.projId) {
      case 2: case 82:
        game.spawnDust?.(this.x, this.y, this.w, this.h, 6, 0, 0, 100);
        break;
      case 172:
        game.spawnDust?.(this.x, this.y, this.w, this.h, 135, 0, 0, 100);
        break;
      case 103: {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 75, 0, 0, 100);
        if (d && Math.random() < 0.5) { d.noGravity = true; d.scale *= 2; }
        break;
      }
      case 278: {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 169, 0, 0, 100);
        if (d && Math.random() < 0.5) { d.noGravity = true; d.scale *= 1.5; }
        break;
      }
      case 4:
        if (Math.random() < 0.2) game.spawnDust?.(this.x, this.y, this.w, this.h, 14, 0, 0, 150, null, 1.1);
        break;
      case 5: {
        const r5 = (Math.random() * 3) | 0;              // Main.rand.Next(3) 单次采样
        game.spawnDust?.(this.x, this.y, this.w, this.h,
          r5 === 0 ? 15 : r5 === 1 ? 57 : 58,
          this.vx * 0.5, this.vy * 0.5, 150, null, 1.2);
        break;
      }
    }
    // ---- 309 冰九头蛇冰弹尘尾（AI_028 :26996-27004,每子步;EU=3 → ×4/帧）:
    //      3×d185（spd=弹速、尘速×0.3、scale1.2、noGravity、α50）——309 本体贴图
    //      1×1 官方空桩,可见面全在此尘（1×1 族审计真缺口①）
    if (this.projId === 309) {
      for (let i = 0; i < 3; i++) {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 185,
          this.vx, this.vy, 50, null, 1.2, true);
        if (d) { d.vx *= 0.3; d.vy *= 0.3; }
      }
    }
    // ★BJ219 通用 oldPos 记录（原版 UpdateTrails :17198 位序=Damage 之后/寿命杀前,
    //   每子步一段——撞块杀位已在上方 dead 早退=原版 :17132 !active return 同相）
    this.recordGhostTrail();
    if (--this.life <= 0) this.killNow(game);
  }

  /** 子步 AI 本体（subStep 包装——life 递减/判死收口在包装层） */
  private subStepAI(game: GameHooks): void {
    const world = game.world;
    this.age++;
    // ★R28 出生自校正（首子步一次）——见方法注
    if ((this.rp30Pending || this.blz337Pending || this.bat316Pending
      || this.sf659Birth || this.projId === 535) && !this.hostile) {
      this.birthSelfCorrect(game);
      if (this.dead) return;
    }
    // ---- 荆棘链族（7/8/150-152 + 魔晶碎块 493/494）独占状态机：UpdatePosition 对 aiStyle4 早退
    //      （Projectile.cs:20552）= 无通用位移（下方位移行按 thornChain 跳过）、
    //      重力恒 0（aiStyle≠1）；命中管线照常（接触伤害在 Damage() 独立结算）。
    //      击杀由 thornStep 内 killNow 收口 ----
    if (this.thornChain) {
      this.thornStep(game);
      if (this.dead) return;
    }
    // 469 蜂箭入水即消亡（AI_001 头 Projectile.cs:54969 `type == 469 && wet &&
    // !honeyWet && !shimmerWet` → Kill()——水/岩浆档，蜂蜜/微光豁免）。
    // ★L2（2026-09-01 NX3 遗留2 清偿）：读【湿缓存】（出生预置+逐子步刷新,
    // WetCollision 全几何）——旧写「弹心格 liquid>0 + 液型∈{WATER,LAVA}」为
    // 中心格几何近似（浅缘半浸/邻格液面两向偏差）,登记近似退役
    if (this.projId === 469) {
      if (this.wet && !this.honeyWet && !this.shimmerWet) { this.killNow(game); return; }
    }
    // ★BJ704-R3 P1②b：爆炸兔死亡爆弹（NPC 614 任意死因 → checkDead case 614
    //   NPC.cs:80182-80191 NewProjectile 281/ai[0]=-2/速度 0）——AI_049 头
    //   :28651-28656 `ai[0]==-2 → hostile=true; Kill(); return` 即灭,爆炸载荷
    //   全在 Kill() case 281（bunnyBlastExplode）。雕像出生 dmg=0 → 纯 FX。
    if (this.projId === 281 && this.bunnyBlastForm === -2) {
      this.bunnyBlastExplode(game);
      this.killNow(game);
      return;
    }
    // ---- ★BJ642 喷火器 85/1106 AI_193 尘链+寿命面（Projectile.cs:42075-42142 1:1，
    //      2026-10-11——BJ639 判「演出面整缺」本刀补齐；age=localAI[0] 子步语义，
    //      extraUpdates=2（vanilla-projectiles.json）→ 本类子步环逐子步驱动同原版）：
    //      · 寿命 :42084 localAI[0]>=72 → Kill；阻尼 :42087 >=60 → velocity×0.95/子步
    //      · 尘链 A（:42098-42115）：rate num8=0.25（1106 ×0.5=0.125）∧ age<num5
    //        （num5=50 基档 / ai0==1 flag 档 60）；尘 id=flag?135:6，出生位=Center+
    //        Circular(num6,num6)×Remap(age,0,72,0.5,1)（num6=60 基档 / 1106 15）4×4 盒，
    //        初速=v×0.2（+NewDust 内在 ±2 合成，spawnDust 通道同式），α100；
    //        1/4 掷：noGravity+scale×3+v×2 / else scale×1.5；两支共用 scale×1.5、
    //        v×1.2、v+=弹速×Remap(age,0,45,1,0.1)×Remap(age,0,6,0.1,1)、customData=1
    //        （int=1 档逐子步 scale×0.98/vy×0.98+嵌入收缩=Dust.cs:604-627，本仓
    //        VanillaDust 未建模该 customData 档——BJ642 债①登记，出生面已 1:1）
    //      · 尘链 B 烟（:42116-42131）：age>=num4（50；flag 档 num4=0 恒不掷）∧ 1/2 掷；
    //        d31 烟，位=Center+Circular(num7,num7)−向×2，vel=（Center−玩家心）
    //        .SafeNormalize(0).RotatedByRandom(0.19634954631328583)×7（三角掷=F6 判例
    //        (rng−rng)×max），α150 色(80,80,80)、noGravity、scale×(1.1+rand×0.2)、
    //        customData=−0.3−0.15×rand（float 档 vy+=customData/子步 Dust.cs:1342-1346
    //        同债①，出生面已 1:1）
    //      · 1106 音面 :42101-42106（soundDelay==0∧whoAmI%3==0 三发一门）=MinionProj
    //        发射侧 1/3 播 Item_34 近似已承载（:9269 注），AI 侧不重复播（登记）
    //      · Kill 在 vanilla 先于尘链执行但【不中断】AI 体（C# 无 return）——杀拍尘
    //        B 照出生；本仓按尘链→Kill 收口序等价（尘 A 门 age<50 对 72 恒假，
    //        尘 B 唯一杀拍可达面；寿命杀取本仓杀拍口径 killNow+return）
    if (this.projId === 85 || this.projId === 1106) {
      const l0 = this.age;                                   // localAI[0]（子步龄）
      const flag = this.hostileAi0 === 1;                    // ai[0]==1（Elf Melter 1910 发射位注入）
      if (l0 >= 60) { this.vx *= 0.95; this.vy *= 0.95; }    // :42087-42089
      const is1106 = this.projId === 1106;
      const num6 = is1106 ? 15 : 60;                         // :42093-42096（1106 15/15）
      const num7 = is1106 ? 15 : 50;
      const num8 = is1106 ? 0.125 : 0.25;                    // num8 0.25;1106 ×0.5
      const num5 = flag ? 60 : 50;                           // :42091-42096
      const num4 = flag ? 0 : 50;
      const remap = (v: number, a: number, b: number, c: number, d: number): number =>
        c + (d - c) * Math.min(1, Math.max(0, (v - a) / (b - a)));   // Utils.Remap（clamp 缺省）
      // 尘链 A（:42098-42115）
      if (l0 < num5 && Math.random() < num8) {
        const grow = remap(l0, 0, 72, 0.5, 1);               // :42104 Remap(localAI[0],0,72,0.5,1)
        const ca = Math.random() * Math.PI * 2, cr = Math.random();   // NextVector2Circular（角均匀×线性半径盘,F6 判例）
        const d = game.spawnDust?.(
          this.cx + Math.cos(ca) * cr * num6 * grow,
          this.cy + Math.sin(ca) * cr * num6 * grow,
          4, 4, flag ? 135 : 6, this.vx * 0.2, this.vy * 0.2, 100);
        if (d) {
          if (Math.floor(Math.random() * 4) === 0) {         // Main.rand.Next(4)==0（:42106-42110）
            d.noGravity = true;
            d.scale *= 3;
            d.vx *= 2; d.vy *= 2;
          } else {
            d.scale *= 1.5;
          }
          d.scale *= 1.5;                                    // :42112 两支共用
          d.vx *= 1.2; d.vy *= 1.2;                          // :42113
          const k45 = remap(l0, 0, 45, 1, 0.1);              // :42114 Remap(…,num*0.75=45,1,0.1)
          const k6 = remap(l0, 0, 6, 0.1, 1);                // :42114 Remap(…,num*0.1=6,0.1,1)
          d.vx += this.vx * k45 * k6;
          d.vy += this.vy * k45 * k6;
          // d.customData=1（:42115）——int=1 档 VanillaDust 未建模（债①）
        }
      }
      // 尘链 B（:42116-42131）
      if (num4 > 0 && l0 >= num4 && Math.random() < 0.5) {   // num9=0.5（:42097）
        const pcx = game.player.cx, pcy = game.player.cy;
        let dxv = this.cx - pcx, dyv = this.cy - pcy;
        const dl = Math.hypot(dxv, dyv);
        if (dl > 0) { dxv /= dl; dyv /= dl; } else { dxv = 0; dyv = 0; }   // SafeNormalize(Vector2.Zero)
        const tri = (Math.random() - Math.random()) * 0.19634954631328583;   // RotatedByRandom 三角掷（F6 判例）
        const ct = Math.cos(tri), stt = Math.sin(tri);
        const rx = (dxv * ct - dyv * stt) * 7, ry = (dxv * stt + dyv * ct) * 7;   // :42121 ×7f
        const ba = Math.random() * Math.PI * 2, br = Math.random();
        const d = game.spawnDust?.(
          this.cx + Math.cos(ba) * br * num7 - rx * 2,
          this.cy + Math.sin(ba) * br * num7 - ry * 2,
          4, 4, 31, 0, 0, 150, { r: 80, g: 80, b: 80, a: 255 }, undefined, true);
        if (d) {
          d.vx = rx; d.vy = ry;                              // :42123 velocity=vector（NewDust 内速全覆写）
          d.scale *= 1.1 + Math.random() * 0.2;              // :42125
          // d.customData=−0.3−0.15×rand（:42131）——float 档 VanillaDust 未建模（债①）
        }
      }
      if (l0 >= 72) { this.killNow(game); return; }          // :42082-42084（尘链后收口，见上序注）
    }
    // ---- ★BJ643① 无头骑士南瓜弹 1001 AI_194_HorsemanPumpkin（Projectile.cs:42031-42073，
    //      2026-10-11——BJ639 判「本仓落 Dart 通用直线」本刀补齐追踪/透明/尘面）：
    //      原版 ai[0]=发射时 NPC.target（NPC.cs:63065 第 8 参;315 发射位注入,本仓单机
    //      =本地玩家）——目标 active&&!dead → 朝玩家,否则 center 停本体（:42033-42042
    //      向量零,Sign(0)=0 无加速;tileCollide=false/ignoreWater/timeLeft 360 由数据表
    //      +发射位承载）。逐 tick（extraUpdates=0）：
    //      · X 加速 :42054 sign(dx)×0.4（num5）钳 ±4（num3）——无死区恒调
    //      · Y 加速 :42049-42053 仅 |dy|≥30（±30 死区 num2 外）sign(dy)×0.4（num6）
    //        钳 ±5（num4）
    //      · rotation=velocity.ToRotation()+spriteDirection 按 vx（:42055-42056）——
    //        绘制面走 PROJ_ROT_RIGHT 速度角族（1001 已入集,左飞水平镜像）
    //      · Opacity 链 :42057-42064：timeLeft<6 → Opacity−=0.1,否则 +=1/30——
    //        getter/setter 对（P.cs:542-548）以 int alpha 落地（trunc 钳 0..255）;
    //        α 初值 255（PROJ_ALPHA0）→ 出生隐形 30t 渐显、寿命末 timeLeft=5..1 共
    //        5 步 −0.1/t 淡出（Opac 1→0.5,淡出不打满——vanilla 同相）
    //      · 尘 :42065-42072：2/3 掷 NewDustDirect(position,26,26,6,vx,vy)——d6 火,
    //        初速=弹速（+NewDust ±2 内在抖动,spawnDust 通道同式）,scale 0.6/
    //        fadeIn 1.1（生长目标档,Dust.cs:2148-2171 语义）/noGravity/noLight
    if (this.projId === 1001) {
      const p194 = game.player as { dead?: boolean; cx: number; cy: number } | undefined;
      const live194 = !!p194 && !p194.dead;                       // :42038 player.active&&!dead（单机恒 active）
      const dx194 = live194 ? (p194 as { cx: number }).cx - this.cx : 0;   // :42043 目标失效=零向量
      const dy194 = live194 ? (p194 as { cy: number }).cy - this.cy : 0;
      if (Math.abs(dy194) >= 30) {   // :42049 |dy|≥30 才调 Y（±30 死区）
        this.vy = Math.min(5, Math.max(-5, this.vy + Math.sign(dy194) * 0.4));   // :42052 钳 ±5
      }
      this.vx = Math.min(4, Math.max(-4, this.vx + Math.sign(dx194) * 0.4));     // :42054 钳 ±4
      const o194 = 1 - this.alpha / 255;                          // Opacity getter（P.cs:542-545）
      const n194 = this.life < 6 ? o194 - 0.1 : o194 + 1 / 30;    // :42057-42064
      this.alpha = Math.trunc(Math.min(255, Math.max(0, (1 - n194) * 255)));     // setter（P.cs:546-548）
      if (Math.floor(Math.random() * 3) !== 0) {                  // Main.rand.Next(3)!=0（:42065,2/3 掷）
        const d194 = game.spawnDust?.(this.x, this.y, this.w, this.h, 6, this.vx, this.vy);
        if (d194) {
          d194.scale = 0.6;                                       // :42068
          d194.fadeIn = 1.1;                                      // :42069
          d194.noGravity = true;                                  // :42070
          d194.noLight = true;                                    // :42071
        }
      }
    }
    // ---- 教徒火球 467 真制导（AI_001 type==467 支；1458 P.cs:55133-55253 /
    //      1457 :55132-55252 两版本逐字同段。2026-08-31 台账批——此前 Arrow 直飞桶
    //      未建模制导，直线弹道系登记近似）。ai[1] 态机逐 update：
    //      ==0 首拍置 1（出膛音 Item34 由 bossAI_lategame 发射点代播）;==1 扫描锁定
    //      ——CanHit(1×1 点对) 玩家里取最近（上限 2000px;次序同原文:先距门后 or
    //      num2==-1 兜底首收),<20px 即 Kill 自爆;紧随其后的 [1,20) 计数器令扫描节拍
    //      化为【每 19 个 AI 更新一回】(extraUpdates=1 → ≈10 tick 一查)——
    //      ★旧注"每 tick 重试锁定"系转述失真,原文循环即此节奏。
    //      锁定态 ai[1]∈(20,200)：保速转向 AngleLerp(targetAngle,0.008)/update
    //      (Utils.cs :2154;speed=|velocity| 恒定),目标失效回扫描态,<20px 自爆;
    //      ≥200 停止转向 = 直飞至撞块/寿终。alpha −40/update 渐显、AddLight(1.1,.9,.4)、
    //      localAI[0]==12 尾尘环 ×12 + 随机尾尘三式、帧 3 拍推进(:55201-55330)。 ----
    if (this.projId === 467) {
      this.f467Local++;
      if (this.f467Ai1 === 0) {
        this.f467Ai1 = 1;
      } else if (this.f467Ai1 === 1) {
        let bestP: { cx: number; cy: number } | null = null;
        let num3 = 2000;
        for (const cand of (game.candidatePlayers?.() ?? [game.player])) {
          if (!cand || cand.dead) continue;
          const dist = Math.hypot(cand.cx - this.cx, cand.cy - this.cy);
          const los = canHit(world.store, this.cx, this.cy, 1, 1, cand.cx, cand.cy, 1, 1);
          if ((dist < num3 || !bestP) && los) { num3 = dist; bestP = cand; }
        }
        if (num3 < 20) { this.killNow(game); return; }          // :55158-55160 最近可锁定者贴脸自爆
        if (bestP) { this.f467Ai1 = 21; this.f467Target = bestP; }   // :55165-55168 锁定
      } else if (this.f467Ai1 > 20 && this.f467Ai1 < 200) {
        this.f467Ai1++;
        const t = this.f467Target;
        if (!t || t.dead) {                                       // :55176-55180 失效重扫
          this.f467Ai1 = 1; this.f467Target = null;
        } else {
          const dx = t.cx - this.cx, dy = t.cy - this.cy;
          const dl = Math.hypot(dx, dy);
          if (dl < 20) { this.killNow(game); return; }            // :55185-55187 贴脸自爆
          const cur = Math.atan2(this.vy, this.vx);
          const tgtA = Math.atan2(dy, dx);
          const ang = angleLerp(cur, tgtA, 0.008);                // :55192-55194
          const spd = Math.hypot(this.vx, this.vy);               // :55195 保速
          this.vx = Math.cos(ang) * spd;
          this.vy = Math.sin(ang) * spd;
        }
      }
      if (this.f467Ai1 >= 1 && this.f467Ai1 < 20) {               // :55199-55205 扫描节拍环
        this.f467Ai1++;
        if (this.f467Ai1 === 20) this.f467Ai1 = 1;
      }
      this.alpha = Math.max(0, this.alpha - 40);                  // :55194-55200(SetDefaults α=255)
      game.addLightAt?.(this.cx, this.cy, 1.1, 0.9, 0.4);         // :55201 AddLight
      // 帧推进(:55208-55218 frameCounter≥3 → 4 帧循环)
      if (++this.f467FrameT >= 3) {
        this.f467FrameT = 0;
        this.f467Frame = (this.f467Frame + 1) % 4;
      }
      // 尾尘环节拍(localAI[0]==12 → 重置+12 粒 d6 环,:55204-55230)
      if (this.f467Local >= 12) {
        this.f467Local = 0;
        const rotA = Math.atan2(this.vy, this.vx) + Math.PI / 2;   // AI_001 缺省姿态角
        for (let l = 0; l < 12; l++) {
          const th = -(l * Math.PI) / 6;                            // −UnitY.RotatedBy(lπ/6)
          // spinningpoint=(−w/2+8·sinθ,−16·cosθ) 再 RotatedBy(rotation−π/2)(:55209-55217)
          const px = -this.w / 2 + 8 * Math.sin(th);
          const py = -16 * Math.cos(th);
          const ca = Math.cos(rotA - Math.PI / 2), sa = Math.sin(rotA - Math.PI / 2);
          const ox = px * ca - py * sa, oy = px * sa + py * ca;
          const d = game.spawnDust?.(this.cx + ox, this.cy + oy, 0, 0, 6, 0, 0, 160, null, 1.1, true);
          if (d) {
            const nvx = this.cx - this.vx * 3 - d.x, nvy = this.cy - this.vy * 3 - d.y;
            const nl = Math.hypot(nvx, nvy) || 1;
            d.vx = (nvx / nl) * 1.25; d.vy = (nvy / nl) * 1.25;     // :55221-55222
          }
        }
      }
      // 随机尾尘三式(:55235-55325 简并移植):d31×1/4(fadeIn .9)/d31×1/32(scale .8,
      // 1/2 带 fadeIn1.4)/d6×1/2 双粒(noGravity)
      if (Math.random() * 4 < 1) {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 31, 0, 0, 100);
        if (d) { d.vx *= 0.1; d.fadeIn = 0.9; }
      }
      if (Math.random() * 32 < 1) {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 31, 0, 0, 155, null, 0.8);
        if (d) { d.vx *= 0.3; if (Math.random() < 0.5) d.fadeIn = 1.4; }
      }
      if (Math.random() * 2 < 1) {
        for (let m = 0; m < 2; m++) {
          const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 6, 0, 0, 0, null, 1.2, true);
          if (d) { d.vx *= 0.3; if (Math.random() < 0.5) d.fadeIn = 1.4; }
        }
      }
    }
    // ---- 932 月总矢 AI_181（★EoL2 修5,2026-10-05;Projectile.cs:43979-43991）：
    //      ai[0]++ → alpha = (int)Lerp(255,0,GTLV(0,10,ai0))（10t 渐显——SetDefaults
    //      α=0 :8571 台账 PROJ_ALPHA0[932]=0 被首拍覆写 255 起步）;rotation=
    //      velocity.ToRotation()（draw 侧 932 独占支同锚,通用 +π/2 缺省不适用）;
    //      尘 267 1/6 拍（NewDustPerfect+fadeIn1/noGravity/α100/noLightEmittance/
    //      scale×1.5,color=GetFairyQueenWeaponsColor(1,NextFloat×0.4) :43984-43990
    //      =hsl((ai1+.5)%1,1,.5)×Opacity 再 Lerp(White,w)）。ai[0] ≡ age（EU=1 每子步
    //      恰一增,SELF_LUMINOUS_PROJS 811 whiteK811(age) 判例同款）;hue=empressHue
    //      通道（★2026-10-06 登记债已接:发射点 ai3=miscCounterNormalized×12%1,
    //      Player.cs:48391-48396 → Game.ts 4953 支 fairyQueenShotHue 注入;
    //      未接弹缺省 0 → (0+.5)%1=青蓝档）
    if (this.projId === 932) {
      const t181 = Math.min(1, Math.max(0, this.age / 10));
      this.alpha = Math.max(0, Math.floor(255 - 255 * t181));
      if (Math.random() < 1 / 6) {
        const d = game.spawnDust?.(this.cx, this.cy, 0, 0, 267, 0, 0, 100, null, 1, false, true);
        if (d) {
          d.fadeIn = 1;
          d.noGravity = true;
          d.noLightEmittance = true;
          d.scale *= 1.5;
          const [hr, hg, hb] = empressHslRgb((this.empressHue + 0.5) % 1);
          const wk = Math.random() * 0.4;                    // Lerp(c,White,NextFloat×0.4)
          const op = 1 - this.alpha / 255;                   // GetColor 内部 ×Opacity
          d.color = {
            r: Math.round((hr * op) + (255 - hr * op) * wk),
            g: Math.round((hg * op) + (255 - hg * op) * wk),
            b: Math.round((hb * op) + (255 - hb * op) * wk), a: 255,
          };
        }
      }
    }
    // 入水消亡/2 变型支（AI_001 共享 wet 段 Projectile.cs:16921-16931：wet && !lavaWet
    //  → ① IsDestroyedByWater{85,15,188,34,1097,1106}（ProjectileID.cs:287）Kill;
    //  ② type 2 燃烧箭 → TransformType(1) 变木箭 + light = 0）★2026-09-04 湿段时序
    //  重排并回段内原位——原文本支在 AI()【之后】的通用湿段内执行（:16903 段 →
    //  HandleMovement :17120），旧 AI 链中段落位（本处）虽读同值（上拍段缓存）,却使
    //  消亡/变型先于 376/蜂族/710 等 AI 消费位与 AI 尾段执行,与原文相反;现随湿段
    //  （subStepAI 尾、位移行前）按段内子序收口：旗(:16906)→水death/变型(:16921)→
    //  34/80(:16933)→溅花(:16935)→三清(:17103)→wetCount--(:17109),逐值未动。
    //  ★F3（2026-09-01 NX3 遗留3 清偿）语义注随支迁移,见下方湿段块注（lavaWet
    //  粘滞面/沾浆渡水豁免;★2026-09-06 预置逐字面化后 lavaWet 首档由本子步段内
    //  :16906-16911 并入,预置不再携带——见 fixedUpdate 头预置块注）。
    // ---- ★B1-X3 微光气球 936 巨星解锁段（2026-08-30 触发域修正：killNow → Shimmer()；
    //      2026-09-07 随 Shimmer() 泛化收口——本特支块退役,并入通用调用位）----
    // 原版唯一出处 = Shimmer()（P.cs:22564 方法头）aiStyle==2 分支 :22674-22697，
    // 调用域 Update :17114-17117 `if (shimmerWet) Shimmer();`——浸微光液才跑，与
    // Kill 无关。曾错挂 killNow 且仅查 vy<0 → 任何上升期消亡（空中寿命尽/命中即爆）
    // 永久置位世界旗+强制入住 Diva（红队 B1-1 实锤,2026-08-30 修正;2026-08-31 台账
    // 清偿浮升/衰变两支逐拍化）。泛化收口要点：
    //   · 本块旧位在 AI 链中段=湿段【前】,泛化后随 wetSectionStep 尾调用位（原版位序
    //     :17114=湿段 :16903-17113 之后/HandleMovement :17122 之前）;
    //   · aiStyle2 分支逐值在 projShimmerStep（浮升 vy-=0.7 恒算/解锁 timeLeft>5→5 +
    //     unlockRainbowSlime 回调/else timeLeft-=20 衰变）;★特支块退役=防分派+特支
    //     双跑（vy-=0.7 每子步双扣、timeLeft 双折）;
    //   · 触发域=center-cell shimmerImmersed → 原版 shimmerWet 盒级旗（NewProjectile
    //     :10893 出生预置+湿段 :16915-16918 维护;中心格/盒级采样粒度差异既案）;
    //   · 解锁半边=wetSectionStep 尾调用位 unlockRainbowSlime 回调接 shimmerUnlock
    //     （内部保留同谓词早退=防漂移双保险;TownNPC 出生静止近似/TownNPC 入住由
    //     Main.cs:66913 townNPCCanSpawn[681] 等价 flags 门承载,B1-X3 既案）;
    //   · hostile 门由 Shimmer() 头门承载（:22566 hostile && aiStyle!=25/17 → 早退,
    //     936 数据面 friendly 本就不拦）。
    // ---- ★R29 幻象弓载体 630（AI_001 type==630 支 Projectile.cs:68194-68295）----
    // ai[0]++ 计龄;加速窗 num67=(age≥40)+(≥80)+(≥120),interval=24−2×num67（四档
    // 24/22/20/18）;ai[1]-- 归零触发 volley（重置 interval）+ soundDelay 节拍器
    //（canShoot 门内 Item_5,首拍 ai[0]==1 豁免）;每拍 player.phantasmTime=2 续窗
    // （本仓静态时间戳 Arrow.phantasmWindowUntil）。volley：canShoot=false → Kill;
    // 成立 → ctl.volley() 现解析弹药（null=无弹药 → Kill）、本体 velocity 重瞄
    // =归一(鼠标−position)×shootSpeed×scale×0.55、一次生成 4 枚真箭
    //（出生点=弹心±Next(−15,15)、速度=归一(velocity)×speed3×(0.6+rand×0.8)、
    // noDropItem、伤/kb/弹型全取弹药终值）
    // ★2026-09-02 AI_075 尾公共段补齐（Projectile.cs:68401-68407,2026-09-01 用户实报
    //   "手持贴图不显示/影子箭方向反"根因）：载体每拍钉回玩家挂点
    //   position = RotatedRelativePoint(MountedCenter) − Size/2（本仓 PhoenixChannel
    //   同式 ≈ 玩家中心）——原版"手持弓"视觉 = 弹体 630 本尊跟手（物品侧
    //   noUseGraphic=true（Item.cs:31747）+ DrawPlayer_27_HeldItem noUseGraphic 门
    //   （PlayerDrawLayers.cs:3194）双隐藏物品贴图,弹体即弓）；此前缺失 = 载体以初速
    //   飞离玩家,volley 出膛点/重瞄向随漂移跑飞（弹从场外反向飞回=观感"贴图反了"）。
    //   SetDummyItemTime(2)（:68405）= refreshChannelItem 钉手持姿势不脱落
    //   （PrismProj/PhoenixChannel 同钩子）。velocity 只作姿态/重瞄向量不积分位移
    //   （钉位覆写,tileCollide false 本就穿墙）。
    if (this.projId === 630 && this.ph630Ctl) {
      const ctl = this.ph630Ctl;
      const p630 = game.player as { cx: number; cy: number; dead: boolean; facing: number } | undefined;
      if (p630 && !p630.dead) {
        this.x = p630.cx - this.w / 2;
        this.y = p630.cy - this.h / 2;
        game.refreshChannelItem?.(Math.atan2(this.vy, this.vx));
      }
      this.ph630Age++;
      let tier630 = 0;
      if (this.ph630Age >= 40) tier630++;
      if (this.ph630Age >= 80) tier630++;
      if (this.ph630Age >= 120) tier630++;
      const interval630 = 24 - 2 * tier630;
      this.ph630VolleyCd--;
      let volley630 = false;
      if (this.ph630VolleyCd <= 0) {
        this.ph630VolleyCd = interval630;
        volley630 = true;
      }
      const canShoot630 = ctl.channel();
      // ★BJ704-G2（债③）：localAI[0] 逐拍递减（:68225-68228,先于音拍块——同拍旧值
      //  先减后置 12 = 原版顺序）
      if (this.ph630Flash > 0) this.ph630Flash--;
      if (--this.ph630SndCd <= 0 && canShoot630) {
        this.ph630SndCd = interval630;
        if (this.ph630Age !== 1) game.playSfxFile?.('Item_5', 1, this.cx, this.cy);
        this.ph630Flash = 12;                            // :68236（音拍同块置 12）
      }
      Arrow.phantasmWindowUntil = performance.now() + 33;   // phantasmTime=2（每拍续窗）
      if (volley630) {
        const res630 = canShoot630 ? ctl.volley() : null;
        if (!res630) { this.killNow(game); return; }
        const aim630 = ctl.aim();
        // ★2026-09-02 出膛锚/重瞄基点改弹心（vector30 = vector = 挂点=Carrier Center,
        //   :68235/:68253——此前读 position 左上角,钉位后带 (−w/2,−h/2) 系统偏移）
        let dirX630 = aim630.x - this.cx, dirY630 = aim630.y - this.cy;
        const dl630 = Math.hypot(dirX630, dirY630);
        if (dl630 > 0) { dirX630 /= dl630; dirY630 /= dl630; }
        else { dirX630 = 0; dirY630 = -1; }                 // NaN 兜 −UnitY（:68252-68255）
        // 重瞄速度 = 归一(鼠标−position) × weapon.shootSpeed × scale(1) × 0.55
        //（:68256-68262 num70 = player.HeldItem.shootSpeed × scale——3540 表值
        // shootSpeed=20,与弹药 speed3 无关）
        this.vx = dirX630 * (20 * 0.55);
        this.vy = dirY630 * (20 * 0.55);
        const ents630 = (game as unknown as { entities?: { add?: (e: unknown, b: string) => void } }).entities;
        for (let k630 = 0; k630 < 4 && ents630?.add; k630++) {
          const vl630 = Math.hypot(this.vx, this.vy) || 1;
          const sp630 = res630.speed * (0.6 + Math.random() * 0.8);
          const a630 = new Arrow(
            this.cx + Math.random() * 30 - 15, this.cy + Math.random() * 30 - 15,
            (this.vx / vl630) * sp630, (this.vy / vl630) * sp630,
            res630.dmg, res630.kb, res630.pid, {});
          a630.frostEligible = true;
          a630.critChance = this.critChance;
          // ★BJ498①：critBonus 传播写位摘除（链上死值零读者——源恒类缺省 0,锚=字段注 BJ498①）
          a630.armorPen = this.armorPen;
          a630.noDropItem = true;               // :68277（volley 逐矢原版置位;箭族无回收语义,见类字段注）
          ents630.add(a630, 'projectiles');
        }
      }
    }
    // ---- 矛伴生弹 AI 支（AI_019 伴生,R30 §3.2 落点清单 #8,2026-08-25 接通）----
    if (this.projId === 131) {
      // 131 孢子云 = AI_030 default 支（Projectile.cs:27148-27155）：v×0.8 减速悬浮 +
      // rotation += 0.2 自旋（PROJ_SPIN 表消费）+ alpha+4 渐隐,alpha≥255 → Kill(~64t)
      this.vx *= 0.8;
      this.vy *= 0.8;
      this.alpha += 4;
      if (this.alpha >= 255) { this.killNow(game); return; }
    } else if (this.projId === 732) {
      // 732 气旋 = AI_044 type==732 支（:28305-28320）：alpha+12 渐隐 Kill(>255 ~22t)+
      // 1/5 d226 尘(noGravity,v×1.2)+rotation=velocity 向（PROJ_ROT_ASIS 消费）
      this.alpha += 12;
      if (Math.floor(Math.random() * 5) === 0) {
        const d732 = game.spawnDust?.(this.x, this.y, this.w, this.h, 226, 0, 0, 150, undefined, 0.8);
        if (d732) { d732.noGravity = true; d732.vx *= 1.2; d732.vy *= 1.2; }
      }
      if (this.alpha > 255) { this.killNow(game); return; }
    }
    // ---- ★R29 幻象矢 631（aiStyle122 AI_122 :35543-35596）：ai[0]=受害者
    //（命中侧补刀写入 Enemy.id）/ ai[1]=错峰延迟（0/15/30——延迟期 velocity=Zero
    // 定身 return）;目标有效且盒交叠 → Kill+直伤结算;失效态（flag64）velocity==Zero
    // 即 Kill、恢复撞块、alpha+=10 淡出 >255 Kill;有效态 homing v=归一(目标心−弹心)
    // ×12、alpha−=15 钳 0 渐显 ----
    if (this.projId === 631 && !this.hostile) {
      const ents631l = game.enemies();
      let tgt631: { id: number; x: number; y: number; w: number; h: number; dead?: boolean } | null = null;
      for (const ent of ents631l) {
        const e = ent as unknown as { id: number; x: number; y: number; w: number; h: number; dead?: boolean };
        if (e.id === this.ph631Tgt && !e.dead) { tgt631 = e; break; }
      }
      const valid631 = this.ph631Tgt >= 0 && !!tgt631;
      if (!valid631) this.ph631Tgt = -1;
      if (tgt631
        && this.x < tgt631.x + tgt631.w && this.x + this.w > tgt631.x
        && this.y < tgt631.y + tgt631.h && this.y + this.h > tgt631.y) {
        // 盒交叠 → Kill()+Damage()（:35564-35569——直伤 kb 0,暴击按弹体阈值）
        // ★BJ497①（2026-10-04）掷率收编（BJ493② 改形先例）：旧 `||` 面把父弹传播的
        //  0.04 路由门误当 4% 平率+丢 owner 聚合/:25712 持械折入——spawnPhantasmChase
        //  :4493 继承父弹 critChance,父代全族已 BJ493③ 迁 0.04 门（spawn 侧逐位亲读:
        //  :17212/:17362/:17382/:17446/:17556/:17589/:21039）。631 数据面 ranged
        //  （SetDefaults :6788）→ 命中拍 rollVanillaHitCrit 动态。
        const crit631 = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
        const rec631 = tgt631 as unknown as { hurt?: (...a: unknown[]) => boolean };
        rec631.hurt?.(Math.max(1, Math.trunc(this.damage)) * (crit631 ? 2 : 1),
          0, 0, game, this.settlePen, crit631, this.pierceInit, true);
        this.killNow(game);
        return;
      }
      if (this.ph631Delay > 0) {
        this.ph631Delay--;
        this.vx = 0; this.vy = 0;
        return;                                   //（:35575-35579 提前 return,不转姿态不位移）
      }
      if (!valid631 || !tgt631) {
        if (this.vx === 0 && this.vy === 0) { this.killNow(game); return; }
        this.noTileCollide = false;               //（:35584 tileCollide=true）
        this.alpha += 10;
        if (this.alpha > 255) { this.killNow(game); return; }
      } else {
        const dx631 = tgt631.x + tgt631.w / 2 - this.cx, dy631 = tgt631.y + tgt631.h / 2 - this.cy;
        const dl631 = Math.hypot(dx631, dy631) || 1;
        this.vx = dx631 / dl631 * 12;
        this.vy = dy631 / dl631 * 12;
        this.alpha = Math.max(0, this.alpha - 15);
      }
    }
    // ---- ★R29 弹药飞行拖尾族（AI_001 逐型尘块,行号照抄;素箭素弹 → 分型视觉）----
    // 41 地狱火箭（:56450-56456）：每 update d31(smoke,alpha100,scale1.6,noGravity)+
    // d6(fire,scale2,noGravity)——火尾是弹的可视主体
    if (this.projId === 41) {
      game.spawnDust?.(this.x, this.y, this.w, this.h, 31, 0, 0, 100, null, 1.6, true);
      game.spawnDust?.(this.x, this.y, this.w, this.h, 6, 0, 0, 100, null, 2, true);
    } else if (this.projId === 374) {
      // 374 随从蜂刺（:56510-56522）：localAI[0]==0 首拍 Item_17 后置 1（出膛音,
      // 与 MinionProj 射出站点原版同拍双播,见字段注）;1/2 概率 d18 毒雾
      // （α0,scale0.9,noGravity,尘速×0.5——NewDust 未传速=纯内建抖动）
      if (this.hornetSndL0 === 0) {
        this.hornetSndL0 = 1;
        game.playSfxFiles?.(['Item_17'], 1, this.cx, this.cy);
      }
      if (Math.floor(Math.random() * 2) === 0) {
        const d374 = game.spawnDust?.(this.x, this.y, this.w, this.h, 18, 0, 0, 0, null, 0.9, true);
        if (d374) { d374.vx *= 0.5; d374.vy *= 0.5; }
      }
    } else if (this.projId === 376) {
      // 376 随从鬼火（:56524-56551）：localAI[0]==0 首拍 Item_20（不置位,计数控尘）
      // → 逐子步自增;>3 起每子步 1 枚（>5 起 2 枚）d6 火羽（出生位=(x, y+2)、
      // 速=弹速×0.2 继承后再 ×0.3、scale2、noGravity、noLight）;wet && !lavaWet
      // → Kill 入水灭（:56548-56550）。弹体 α 恒 255=原版即隐身（PROJ_ALPHA0 注）
      if (this.impFlameL0 === 0) game.playSfxFiles?.(['Item_20'], 1, this.cx, this.cy);
      this.impFlameL0++;
      if (this.impFlameL0 > 3) {
        const n376 = this.impFlameL0 > 5 ? 2 : 1;
        for (let i = 0; i < n376; i++) {
          const d376 = game.spawnDust?.(this.x, this.y + 2, this.w, this.h, 6,
            this.vx * 0.2, this.vy * 0.2, 100, null, 2, true);
          if (d376) { d376.vx *= 0.3; d376.vy *= 0.3; d376.noLight = true; }
        }
        if (this.wet && !this.lavaWet) { this.killNow(game); return; }
      }
    } else if (this.projId === 91) {
      // 91 圣箭（:56554-56560）：1/2 概率 d58|d15（v×0.25 后再 ×0.25,alpha150,scale0.9）
      if (Math.floor(Math.random() * 2) === 0) {
        const t91 = Math.floor(Math.random() * 2) !== 0 ? 58 : 15;
        const d91 = game.spawnDust?.(this.x, this.y, this.w, this.h, t91,
          this.vx * 0.25, this.vy * 0.25, 150, null, 0.9);
        if (d91) { d91.vx *= 0.25; d91.vy *= 0.25; }
      }
    } else if (this.projId === 120) {
      // 120 冰雪弓箭（:58231-58238）：每 update d67 出生点=position−velocity、
      // v 继承后 ×0.3,noGravity,scale1.2 雪雾拖尾
      const d120 = game.spawnDust?.(this.x - this.vx, this.y - this.vy, this.w, this.h, 67,
        this.vx, this.vy, 100, null, 1.2, true);
      if (d120) { d120.vx *= 0.3; d120.vy *= 0.3; }
    } else if (this.projId === 225) {
      // 225 叶绿箭（:55992-55995）：1/2 概率 d40 绿色荧光（noGravity,scale1.3,v×0.5）
      if (Math.floor(Math.random() * 2) === 0) {
        const d225 = game.spawnDust?.(this.x, this.y, this.w, this.h, 40, 0, 0, 0, null, 1.3, true);
        if (d225) { d225.vx *= 0.5; d225.vy *= 0.5; }
      }
    } else if (this.projId === 282) {
      // 282 毒液箭（:55970-55973）：每 update d171 毒泡（scale=rand(1..9)×0.1,
      // noGravity,fadeIn1.5,v×0.25 后 +=v×0.25）
      const d282 = game.spawnDust?.(this.x, this.y, this.w, this.h, 171, 0, 0, 100, null,
        (1 + Math.floor(Math.random() * 9)) * 0.1, true);
      if (d282) { d282.fadeIn = 1.5; d282.vx = d282.vx * 0.25 + this.vx * 0.25; d282.vy = d282.vy * 0.25 + this.vy * 0.25; }
    } else if (this.projId === 495) {
      // 495 暗影焰弓箭（:58461-58465，AI_001 速度链内同块）：每 update d27 暗焰
      // （出生位=position−velocity 反向偏置、速=弹速继承后 ×0.3、α100、scale1.2、
      // noGravity）——本体为暗影焰可视主体;ai[0]≥30 后 vy+0.04 重力段已在
      // AI1_GRAV[495]=[0.04,30] 承载（vanillaItemCombat.ts :54597）
      const d495 = game.spawnDust?.(this.x - this.vx, this.y - this.vy, this.w, this.h, 27,
        this.vx, this.vy, 100, null, 1.2, true);
      if (d495) { d495.vx *= 0.3; d495.vy *= 0.3; }
    } else if (this.projId === 469) {
      // 469 蜂箭渐显（:56164-56174）：localAI>2 后 alpha−=50 钳 0（镜像已有）
      this.ph469T++;
      if (this.ph469T > 2) this.alpha = Math.max(0, this.alpha - 50);
    } else if (this.projId === 819) {
      // 819 血箭（DrawProj :57369-57400）：首拍 8×d5 尘爆（随机向×2+v 单位向×2,
      // scale0.9,fadeIn1.3）;alpha−=20 渐显;每拍 5×d5 血迹（v×0.5 后 ×0.25,
      // 位置=弹心−velocity×i/5 沿路径回铺）;1/2 d267 红雾（NewDustPerfect 弹心−v×3）
      if (!this.bArrow819Born) {
        this.bArrow819Born = true;
        for (let i = 0; i < 8; i++) {
          const th819 = (Math.random() * 2 - 1) * Math.PI;
          const ul819 = Math.hypot(this.vx, this.vy) || 1;
          const d819b = game.spawnDust?.(this.x, this.y, this.w, this.h, 5,
            Math.cos(th819) * 2 + this.vx / ul819 * 2, Math.sin(th819) * 2 + this.vy / ul819 * 2, 100);
          if (d819b) { d819b.scale = 0.9; d819b.fadeIn = 1.3; d819b.x = this.cx; d819b.y = this.cy; }
        }
      }
      this.alpha = Math.max(0, this.alpha - 20);
      for (let i = 1; i < 6; i++) {
        const d819t = game.spawnDust?.(this.cx - this.vx * i / 5 - 4, this.cy - this.vy * i / 5 - 4, 8, 8, 5, 0, 0, 100);
        if (d819t) { d819t.scale = 0.9; d819t.vx = d819t.vx * 0.5 + this.vx * 0.5; d819t.vy = d819t.vy * 0.5 + this.vy * 0.5; d819t.vx *= 0.25; d819t.vy *= 0.25; }
      }
      if (Math.floor(Math.random() * 2) === 0) {
        const d267 = game.spawnDust?.(this.cx - this.vx * 3 - 4, this.cy - this.vy * 3 - 4, 8, 8, 267,
          this.vx * 0.5, this.vy * 0.5, 0, { r: 255, g: 0, b: 0, a: 26 }, 0.7, true);
        if (d267) { d267.vx *= 2; d267.vy *= 2; }
      }
    }
    // ---- ★R29 星星炮星 955（aiStyle5,AI_005 通用支 :24133-24240）----
    // 通用闪烁档 alpha 0↔200 ±25/t + Item_9 星啸 20-59t + 1/20 尘 58（v×0.5,
    // alpha150,scale1.2)+屏内 1/6 gore16/17（自旋在 PROJ_SPIN 表;light R18 禁入区）
    if (this.projId === 955 || this.projId === 12) {
      // 12/955 同支(:24223-24240):light = 0.9(AI 侧覆盖 SetDefaults 1.0,备案项已处理)
      // × ProjLight MUL [0.9,0.8,0.1] = [0.81,0.72,0.09]
      this.lightRGB = [0.81, 0.72, 0.09];
      this.alpha += 25 * this.twinkleDir;
      if (this.alpha >= 200) { this.alpha = 200; this.twinkleDir = -1; }
      if (this.alpha <= 0) { this.alpha = 0; this.twinkleDir = 1; }
      if (--this.starSndCd <= 0) {
        this.starSndCd = 20 + Math.floor(Math.random() * 40);
        game.playSfxFiles?.(['Item_9'], 1, this.cx, this.cy);   // ★T4：原版 PlaySound 无音量参=缺省 1.0（:24133/AI_151 :22345）
      }
      if (Math.floor(Math.random() * 20) === 0) {
        game.spawnDust?.(this.x, this.y, this.w, this.h, 58, this.vx * 0.5, this.vy * 0.5, 150, null, 1.2);
      }
    } else if (this.projId === 728) {
      // ---- ★R29 超级星星炮星 728（aiStyle151 AI_151_SuperStar :22338-22376）----
      // alpha−=10 钳 100 半透 + Item_9 循环音同档 + 自旋 ×0.005（PROJ_SPIN）+
      // 2 臂各 1/8 d228 星尘（NewDustDirect 初速 (0,0)=纯内建抖动 :22361,后置
      // scale1.3/noGravity/×0.25 只乘抖动 +RotatedBy(±π/8)×0.2 :22362-22365）+
      // 屏内 1/6 gore16/17
      // ★红队 P3（2026-09-03）：曾传 vx×0.25 作 SpeedX 再被后置 ×0.25 →
      //   多出 proj_v×0.0625×0.3 轴向漂移（视觉);按原文 SpeedX/Y=0 直传——728
      //   现 dormant 无出生路径,零行为风险
      this.alpha = Math.max(100, this.alpha - 10);
      if (--this.starSndCd <= 0) {
        this.starSndCd = 20 + Math.floor(Math.random() * 40);
        game.playSfxFiles?.(['Item_9'], 1, this.cx, this.cy);   // ★T4：原版 PlaySound 无音量参=缺省 1.0（:24133/AI_151 :22345）
      }
      for (let i = 0; i < 2; i++) {
        if (Math.floor(Math.random() * 8) === 0) {
          const ra728 = (Math.PI / 8) * (1 - 2 * i);
          const c728 = Math.cos(ra728), s728 = Math.sin(ra728);
          const d728 = game.spawnDust?.(this.x, this.y, this.w, this.h, 228,
            0, 0, 127, null, 1.3, true);
          if (d728) {
            d728.vx *= 0.25; d728.vy *= 0.25;
            d728.vx += (this.vx * c728 - this.vy * s728) * 0.2;
            d728.vy += (this.vx * s728 + this.vy * c728) * 0.2;
          }
        }
      }
    } else if (this.projId === 1037 || this.projId === 1049) {
      // ---- ★2026-09-01 批三（T2）：星陨落星缓速渐显（AI() aiStyle5 分支
      //  P.cs:24137-24150 直抄）：alpha −= 10/子步、钳 0——门内 num42 恒赋 0 的
      //  死条件（:24140-24144）语义即 max(alpha−10, 0)。SetDefaults alpha=254
      //  (:9792/:9950)、EU=1（:9791/:9949）→ AI ×2 子步/帧 ≈ 13 帧渐显完。
      //  门内余项【不移植】：localAI[0] += |vx|+|vy| 求和×0.01×direction 仅 503 的
      //  GetAlpha :81015 相位消费（1037/1049 无读者）;同门外 :24132 Item_9 音为
      //  非本型（type != 1037 && type != 1049）;rotation = velocity.ToRotation()−π/2
      //  （:24197-24199）属绘制姿态面,专用视觉锚定另行登记。
      //  出生端：1037=WhipTag 星陨 proc 首跳（活跃）/1049=DST+FTW+风暴天陨雨
      //  （WorldGen.cs:72292,本仓无此世界事件,dormant） ----
      this.alpha -= 10;
      if (this.alpha < 0) this.alpha = 0;
    }
    // ---- ★2026-09-02 观感面缺口批：660 天界碎裂 / 712 书杖弹（AI_001 顶层独立块
    //      :56638-56660 / :56662-56702）——EU=1 → ×2 子步/帧,白闪门首子步即关 ----
    // 共同骨架：Utils.PlotTileLine(Center → Center+v×10,带宽 8,CastLightOpen) 逐格
    // 线光带每子步发光——本仓以弹心点光 lightRGB 通道近似（ChainsawProj 弹心点光
    // 同先例,线带未建模登记）;出膛白闪门 `if (alpha > 0)`：SetDefaults α=255
    // （PROJ_ALPHA0 批注）→ 首子步恒真一次,当拍 α=0、scale=1.1。
    if (this.projId === 660 || this.projId === 712) {
      // 光色 v3_1：660 (0.6,1,1)×0.2（:56639）/ 712 (0.4,0.4,0.4)×0.7（:56663）
      this.lightRGB = this.projId === 660 ? [0.12, 0.2, 0.2] : [0.28, 0.28, 0.28];
      const vl660 = Math.hypot(this.vx, this.vy);
      // SafeNormalize(Zero) 语义：|v|=0 → (0,0)；旋转角 cosA/sinA 取速度向（v=0 → 1,0）
      const nv660x = vl660 > 0 ? this.vx / vl660 : 0, nv660y = vl660 > 0 ? this.vy / vl660 : 0;
      const ca660 = vl660 > 0 ? this.vx / vl660 : 1, sa660 = vl660 > 0 ? this.vy / vl660 : 0;
      if (this.projId === 712) {
        // 帧链（:56664-56678）：α==255 拍 frame=rand(2)*4 选带 → 每 4 子步 +1,
        // ==4 回 0 / ≥8 回 4（两带各 4 帧,projFrames[712]=8 :8596——draw fIdx 链消费）
        if (this.alpha === 255) this.f712Frame = Math.floor(Math.random() * 2) * 4;
        if (++this.f712FrameT >= 4) {
          this.f712FrameT = 0;
          this.f712Frame++;
          if (this.f712Frame === 4) this.f712Frame = 0;
          if (this.f712Frame >= 8) this.f712Frame = 4;
        }
      }
      if (this.alpha > 0) {
        if (this.projId === 660) game.playSfxFiles?.(['Item_9'], 1, this.cx, this.cy);
        this.alpha = 0;
        this.drawScale = 1.1;
        this.f712Frame = Math.floor(Math.random() * 14);   // frame=rand.Next(14)（:56651/:56684）——660 帧由 DrawProj 手切横条 Rectangle(38*frame,0,38,38) 消费（Main.cs:30974-30980,PROJ_GRID[660] 承载=非死写入,旧注误判已勘）;712 8 帧表越界值由 projFrameImg 钳末帧（XNA 无钳=原版采样越界瑕疵,登记）
        // 环形白闪：n=16（660）/ 4（712）,偏移=−UnitY.Rot(θ)×(1,4) 再 Rot(速度角)
        const n660 = this.projId === 660 ? 16 : 4;
        for (let i = 0; i < n660; i++) {
          const th660 = i * (Math.PI * 2 / n660);
          const ox660 = Math.sin(th660) * 1, oy660 = -Math.cos(th660) * 4;
          const oxr = ox660 * ca660 - oy660 * sa660;
          const oyr = ox660 * sa660 + oy660 * ca660;
          const ol660 = Math.hypot(oxr, oyr);
          const dux = ol660 > 0 ? oxr / ol660 : 0;         // SafeNormalize(UnitY) 回退 (0,1)
          const duy = ol660 > 0 ? oyr / ol660 : 1;
          if (this.projId === 660) {
            // d180 玻屑环：scale1.5、noGravity、位=Center+偏移、速=偏移单位向×1（:56654-56659）
            const d660 = game.spawnDust?.(this.cx, this.cy, 0, 0, 180, 0, 0, 0, null, 1.5, true);
            if (d660) {
              d660.x = this.cx + oxr;
              d660.y = this.cy + oyr;
              d660.vx = dux;
              d660.vy = duy;
            }
          } else {
            // d15 书页环 ×4：scale1.7、noGravity、位=Center+偏移+速度单位向×50、
            // 速=(尘速×2+偏移单位向×0.3+速度单位向×3)×0.7、位再 += 速×5（:56689-56696）
            const d712 = game.spawnDust?.(this.cx, this.cy, 0, 0, 15, 0, 0, 0, null, 1.7, true);
            if (d712) {
              d712.vx = (d712.vx * 2 + dux * 0.3 + nv660x * 3) * 0.7;
              d712.vy = (d712.vy * 2 + duy * 0.3 + nv660y * 3) * 0.7;
              d712.x = this.cx + oxr + nv660x * 50 + d712.vx * 5;
              d712.y = this.cy + oyr + nv660y * 50 + d712.vy * 5;
            }
          }
        }
      }
    }
    // ★661 黑爆显形链（AI_001 type==661 支 :56705-56745）：alpha−=55/t 渐显 +
    // scale=1.3；归零瞬间沿速度向排布 16×d62 暗环（scale1.5,noLight,noGravity,
    // v×4+velocity×0.3）；alpha≤0 期每子步 3×d240 暗尘（noGravity,v×0.3）
    if (this.projId === 661) {
      if (this.alpha <= 0) {
        for (let i = 0; i < 3; i++) {
          const d240c = game.spawnDust?.(this.x, this.y, this.w, this.h, 240, 0, 0, 100, null, 1, true);
          if (d240c) { d240c.vx *= 0.3; d240c.vy *= 0.3; }
        }
      } else {
        this.alpha -= 55;
        this.drawScale = 1.3;
        if (this.alpha <= 0) {
          this.alpha = 0;
          const va661 = Math.atan2(this.vy, this.vx);
          const ca661 = Math.cos(va661), sa661 = Math.sin(va661);
          for (let i = 0; i < 16; i++) {
            const th661 = i * (Math.PI * 2 / 16);
            const ox661 = Math.sin(th661) * 1, oy661 = -Math.cos(th661) * 4;   // −UnitY.Rot(th)×(1,4)
            const d661r = game.spawnDust?.(this.cx, this.cy, 0, 0, 62, 0, 0, 0, null, 1.5, true);
            if (d661r) {
              d661r.x = this.cx + ox661 * ca661 - oy661 * sa661;
              d661r.y = this.cy + ox661 * sa661 + oy661 * ca661;
              d661r.vx = d661r.vx * 4 + this.vx * 0.3;
              d661r.vy = d661r.vy * 4 + this.vy * 0.3;
            }
          }
        }
      }
    }
    // ---- ★2026-09-02 观感面缺口批：1097 火绒狐火球（AI_001 type==1097 支
    //      :57513-57573；AI_001 速度链嵌套段 :58255-58269）----
    // 出生（localAI[0]==0 一次性门,ai[1]!=2 恒真——本仓生成面 ai[1]≡0）：
    // Item_20 + DD2_BetsyFireballShot（PlayTrackedSound, tracked 语义=随弹移动衰减,
    // 本仓单点近似）+ 10×(d6 α200 scale×0.7 速×0.5+=v×rand·0.6 noLightEmittance /
    // d6 α50 scale×1.25 +=v×0.45×rand noLightEmittance) 双尘组。
    // 尾迹：1/4 d6(α200,scale×1.3,+=v×0.4,noLightEmittance) + 1/2 d30(α100,scale×0.7,
    // +=v×1) + 1/3 d55@oldPos[9](α50,scale×0.85,+=v×0.85,color(255,60,20),
    // 环未满不撒——foxTrail 见 fixedUpdate 注)。
    // 寿命语义（:57569-57572）：scale −= 0.01/子步、<0.3 → Kill 自爆——出生 scale=1
    // （SetDefaults 无 scale 行）→ 第 71 子步自爆（EU=1 ≈ 36 帧）,先于 timeLeft=300；
    // ai[1]==2 子弹 scale 钳 0.7 / ai[1]==1 且 ai[0]≥30 拆弹提前 Kill（:58265）——
    // ai[1] 两档仅 1113 地狱火拆分子弹使用,本仓生成面不注入 ai[1]（dormant 登记）。
    // α 减段（:57535-57541 ai[0]≥2 门 −25）对 α≡0 起步为空转（AI001_FADE_AGE2 注）。
    if (this.projId === 1097) {
      if (this.foxL0 === 0) {
        this.foxL0 = 1;
        if (game.playSfxFiles) game.playSfxFiles(['Item_20'], 1, this.cx, this.cy);
        game.playSfxFile?.('dd2_betsy_fireball_shot', 1, this.cx, this.cy);
        for (let i = 0; i < 10; i++) {
          const dA = game.spawnDust?.(this.x, this.y, this.w, this.h, 6, 0, 0, 200, null, 1);
          if (dA) {
            dA.scale *= 0.7;
            dA.vx *= 0.5; dA.vy *= 0.5;
            dA.vx += this.vx * Math.random() * 0.6;
            dA.vy += this.vy * Math.random() * 0.6;
            dA.noLightEmittance = true;
          }
          const dB = game.spawnDust?.(this.x, this.y, this.w, this.h, 6, 0, 0, 50, null, 1);
          if (dB) {
            dB.scale *= 1.25;
            dB.vx += this.vx * 0.45 * Math.random();
            dB.vy += this.vy * 0.45 * Math.random();
            dB.noLightEmittance = true;
          }
        }
      }
      if (Math.floor(Math.random() * 4) === 0) {
        const dT = game.spawnDust?.(this.x, this.y, this.w, this.h, 6, 0, 0, 200, null, 1);
        if (dT) { dT.scale *= 1.3; dT.vx += this.vx * 0.4; dT.vy += this.vy * 0.4; dT.noLightEmittance = true; }
      }
      if (Math.floor(Math.random() * 2) === 0) {
        const dT2 = game.spawnDust?.(this.x, this.y, this.w, this.h, 30, 0, 0, 100, null, 1);
        if (dT2) { dT2.scale *= 0.7; dT2.vx += this.vx; dT2.vy += this.vy; }
      }
      if (Math.floor(Math.random() * 3) === 0 && this.foxTrail.length >= 20) {
        // oldPos[9] = 环第 10 槽（扁平 [x0,y0,x1,y1,…] → 下标 18/19）
        const dT3 = game.spawnDust?.(this.foxTrail[18], this.foxTrail[19], this.w, this.h, 55,
          0, 0, 50, { r: 255, g: 60, b: 20, a: 255 }, 1);
        if (dT3) { dT3.scale *= 0.85; dT3.vx += this.vx * 0.85; dT3.vy += this.vy * 0.85; }
      }
      this.drawScale -= 0.01;
      if (this.drawScale < 0.3) { this.killNow(game); return; }
      // ★tileCollide 动态翻转（AI_001 速度链嵌套段 :58255-58269,2026-09-02 遗留批补）：
      //  `ai[0]>=40 → { ai[0]=40; velocity.Y+=0.15; tileCollide=true } else
      //  tileCollide = velocity.Y > 0`。SetDefaults tileCollide=false（:10236）只是
      //  【起始值】——下坠期（vy>0）即撞块、上升/平飞期穿墙,40 子步后恒撞块。
      //  本仓:①重力 +0.15@40 已由 AI1_GRAV[1097]=[0.15,40]（vanillaItemCombat.ts）
      //  经下方共享重力链承载（原版同块先加 g 后置 true,与 vy 无关故拆分等价）;
      //  ②翻转每子步重算（EU=1 → 2 次/tick,末拍值供位移消费——876 zapAi1 同式;
      //  vy 读点在共享重力块前 = 原版速度链内序,else 支 vy 未被当拍重力改写）;
      //  ③age≡ai[0]（subStepAI 头自增）。翻转开后落 HandleMovement 通用实心消亡口
      //  （原版 :19964-19968 端支 position+=velocity;Kill）→ Kill 面 :75779 已接。
      //  液门不受影响（IsDestroyedByWater 走湿缓存段,非 tileCollide 面）。
      this.noTileCollide = !(this.age >= 40 || this.vy > 0);
      // ★R4 F4 补:ai[0]=40 钳(:58257——通用老化改读 age 钳后恒 ≥40 分支稳定)+
      // 拆弹自爆门(ai[1]==1 && ai[0]>=30 → Kill 入 :75779 拆弹口;1113 第 4 发注入
      // foxAi1=1 后此门活化,与 :3234 拆弹支成对)
      if (this.age > 40) this.age = 40;
      if (this.foxAi1 === 1 && this.age >= 30) { this.killNow(game); return; }
    }
    // AI_001 重力链（2026-08-14 对账，:53083-54698 全链规格走 projGravSpec）：
    //   默认 = ai0≥15 update 后 +0.1/update、终端 16（:54686-54696/:54871-54887）
    //   ——箭族 15t 平飞缓坠；子弹/光束 flag3 表豁免（grav=0）；
    //   275/276 延迟档（35t 后 g=0.025，:54318-54329）；
    //   686/711 两段式（≥10 +0.1、≥20 再 +0.1、vx×0.99 恒定，:54640-54659）；
    //   aiStyle 2 投掷族（:21955-21977 默认档）：20t 平飞后 vy+=0.4、vx×=0.97、终端 32
    //   门 = ai[0] >= N（≥ 含等号；2026-08-22 修 off-by-one，曾 age > N 晚一拍）。
    //   终端速度（AI_001 尾 :54878-54890 flag7）：下坠钳 +16；flag4 上飘弹（1006）
    //   对称钳 −16 → grav<0 档取 −maxFall
    if (this.grav !== 0 && (this.gravDelay < 0 || this.age >= this.gravDelay)) {
      this.vy = this.grav < 0 ? Math.max(this.vy + this.grav, -this.maxFall)
        : Math.min(this.vy + this.grav, this.maxFall);
      if (this.drag !== 1) this.vx *= this.drag;
    }
    if (this.grav2 !== 0 && this.age >= this.grav2At) {
      this.vy = Math.min(this.vy + this.grav2, this.maxFall);
    }
    if (this.dragAlways !== 0) this.vx *= this.dragAlways;
    // ---- aiStyle 24 书族（94/1114）oldPos 环推进（Main.cs:35251/:35299 消费）----
    // ★95 诅咒之焰无 oldPos 拖尾块（其绿尘即尾,Main.cs 只画 94/1114 两支）——曾误入
    // ★660 天界碎裂同推（DrawProj 残影 oldPos[1]/[2] 消费,Main.cs:31363/:31385;
    //   1457 Main.cs:30974-30980 入 trail 块）——每 tick 一点,残影取尾 1/2 点
    if (this.projId === 94 || this.projId === 1114 || this.projId === 660) {
      this.starTrail.push(this.x, this.y);
      if (this.starTrail.length > 20) this.starTrail.splice(0, this.starTrail.length - 20);   // oldPos 10 点
    }
    // 1114 尘迹（AI_024 :26322-26330）：1/4 tick 尘 57 noGravity 速度×0.5 缩×0.9
    //（金色星光=日耀花视觉主体；noLight 尘不进光照,spawnParticles 近似）
    if (this.projId === 1114 && this.age % 4 === 0) {
      game.spawnParticles(this.cx, this.cy, '#FFD966', 1, 0.5, { life: 18, grav: 0 });
    }
    // ---- 烟雾弹 196 烟尾（AI_014 type==196 支 Projectile.cs:25196-25210）：每 tick
    //      1-2×d31 烟尘——alpha100+Next(100)、初速 0（×0.3 不变）、vx+=Next(-10,11)
    //      ×0.025、vy−=0.4+Next(-3,14)×0.15 上飘、fadeIn=1.25+Next(20)×0.15=
    //      生长目标（d31 无重力支在链 A 自管速度,此尘不置 noGravity——原版 NewDust
    //      未传 noGravity,scale 恒 1 靠 fadeIn 长大）。★必须在逐 tick AI 段：曾有
    //      版本整串塞在撞块支里=飞行全程零烟（2026-08-28 用户报"没看到烟雾"）----
    if (this.projId === 196 && game.spawnDust) {
      const nSmk = 1 + (Math.random() < 0.5 ? 1 : 0);
      for (let i = 0; i < nSmk; i++) {
        const dvx = (Math.floor(Math.random() * 21) - 10) * 0.025;
        const dvy = -(0.4 + (Math.floor(Math.random() * 17) - 3) * 0.15);
        const d = game.spawnDust(this.x, this.y, this.w, this.h, 31, dvx, dvy, 100, null, 1);
        if (d) {
          d.alpha += Math.floor(Math.random() * 100);
          d.fadeIn = 1.25 + Math.floor(Math.random() * 20) * 0.15;
        }
      }
    }
    // ---- R35 清单①：410 泡泡枪泡体（AI_072,Projectile.cs:30954-30977）----
    // localAI0++ >3 后 alpha −25/t 钳 ≥50（GetAlpha 缺省路径 → 半透渐显）;
    // velocity ×0.96 全向量减速;ai[1] 首拍掷 rand(60,121)/100=scale,盒 14×14×scale 居中
    if (this.projId === 410) {
      if (this.bubbleScale === 0) {
        this.bubbleScale = (60 + Math.floor(Math.random() * 61)) / 100;
        const bw = Math.trunc(14 * this.bubbleScale);
        this.x += (this.w - bw) / 2; this.y += (this.h - bw) / 2;   // position=Center−盒/2（:30971-30976）
        this.w = bw; this.h = bw;
      }
      if (this.age > 3) this.alpha = Math.max(50, this.alpha - 25);
      this.vx *= 0.96; this.vy *= 0.96;
    }
    // ---- ★BJ375：664/666/668 爆炸烈焰塔弹 AI_131 头段（Projectile.cs:69519-69559,
    //  aiStyle 131 直译；此前仅生成侧 grav=0+音效,渐显/尘链整缺）----
    //  ①alpha −25/t 钳 0（:69543-69549,SetDefaults 255 起步=PROJ_ALPHA0 注入,
    //    消费=vanillaProjAlpha[664/666/668] lerp 档 fade 乘子+残影 bodyAlpha）；
    //  ②逐拍尘 6 Fire：attempts=1/2/3（664/666/668,num 档 :69551-69558）,每掷
    //    50% 门（:69557 Next(2)!=0）；尘速=弹速×0.2（:69561-69562）×0.3（:69567）
    //    → ×0.06,vy += Sign(dvy)×1.2、fadeIn += 0.5（:69568-69571——原文
    //    Main.rand.Next(1)==0 恒真 quirk 照抄=恒入支）；noGravity、scale 2、α100。
    //    弹首拍音效 dd2_flameburst_tower_shot 已在塔生成侧（MinionProj F5 随收）,
    //    localAI 声轨跟踪面不另建（登记：原版 ActiveSound.Position 每拍追位）。
    if (this.projId === 664 || this.projId === 666 || this.projId === 668) {
      if (this.alpha > 0) this.alpha = Math.max(0, this.alpha - 25);
      const attempts = this.projId === 664 ? 1 : this.projId === 666 ? 2 : 3;
      for (let ai = 0; ai < attempts; ai++) {
        if (Math.floor(Math.random() * 2) !== 0) continue;   // Next(2)!=0 → 50% 跳过
        const d131 = game.spawnDust?.(this.x, this.y, this.w, this.h, 6,
          this.vx * 0.2, this.vy * 0.2, 100, null, 2, true);
        if (d131) {
          d131.noGravity = true;
          d131.vx *= 0.3; d131.vy *= 0.3;
          d131.vy += Math.sign(d131.vy || 0) * 1.2;
          d131.fadeIn += 0.5;
        }
      }
    }
    // ---- R35 清单③：烟花 167-170（AI_034,Projectile.cs aiStyle34 支）----
    // rotation=velocity+π/2（draw 侧）;发射器档(ai1==1):ai0++,==1 拍 8×d6 尘花
    // （noGravity ×3 vel,fadeIn0.5,pos+=v/2,vel+=v/4+player.v×0.1 近似略玩家项）,
    // ai0>2 每拍尾迹 d6(x+2,y+20)8×8 vel=v scale1.2 noGravity
    if (this.projId >= 167 && this.projId <= 170 && this.launcherFirework === 1) {
      this.fwAi0++;
      if (this.fwAi0 === 1) {
        for (let fn = 0; fn < 8; fn++) {
          const fd = game.spawnDust?.(this.x, this.y, this.w, this.h, 6,
            this.vx * 3, this.vy * 3, 100, null, 1.8, true);
          if (fd) { fd.noGravity = true; fd.fadeIn = 0.5; fd.vx += this.vx / 4; fd.vy += this.vy / 4; }
        }
      }
      if (this.fwAi0 > 2) {
        game.spawnDust?.(this.x + 2, this.y + 20, 8, 8, 6,
          this.vx, this.vy, 100, null, 1.2, true);
      }
    }
    // ---- R35 清单⑥：5461 杀意牌（ai113 牌 1024）——ai[2]=±0.4 自旋累积;
    // ai[0]==2 定身态（velocity 已零,保持不坠不减速）
    if (this.projId === 1024) {
      if (this.cardSpin !== 0) this.spinRot += this.cardSpin;
    }
    // ---- R27：宝石法珠飞行彩尘（AI_029_GemStaffs_ActuallyGemStaffs :38534-38541）----
    //  两臂各 1/5 掷：d(type−121+86 / 597→262) 于弹盒内、初速=弹速全额(NewDust 叠加
    //  ±2 抖动)、alpha50、scale1.2、noGravity、速度再 ×0.3——彩色闪烁拖尾是本族视觉主体
    if (isGemBolt(this.projId)) {
      const gdType = this.projId === 597 ? 262 : this.projId - 121 + 86;
      for (let g = 0; g < 2; g++) {
        if (Math.floor(Math.random() * 5) !== 0) continue;
        const gd = game.spawnDust?.(this.x, this.y, this.w, this.h, gdType,
          this.vx, this.vy, 50, null, 1.2, true);
        if (gd) { gd.vx *= 0.3; gd.vy *= 0.3; }
      }
    }
    // ---- 沙球族（aiStyle 10，AI_010 :54890-55160）：沙枪 266 无 channel 旗
    //      （Item.cs:4486-4502 case 266 全段无 channel）→ 出生即 ai[0]=1 直飞档，
    //      ai[1]≥60 update 后 vy+0.2/update（:55066-55075，42/65/68/354 专属——
    //      其余 aiStyle10 型走 0.41 通用档）；终端 vy 10（:55151-55154 非 736-738 支）。
    //      途经草族/装饰/雕像/宝石 KillTile（:55114-55120 表）+ 顶坡铲平上浮
    //      （:55121-55127 SlopeTile+position.Y−16）。旋转在 PROJ_SPIN 表。
    //      Kill 落地放块（42→53/65→112/68→116/354→234）在 Game.onProjectileDeath ----
    if (this.sandBall) {
      this.aiCnt++;                                              // ai[1] += 1（:55069）
      if (this.aiCnt >= 60) this.vy = Math.min(this.vy + 0.2, 10);
      // ---- AI_010 per-type 飞行尘链（:58821-58928,每子步 1/2 掷;2026-09-02 补——
      //      此前整链缺失=沙枪弹哑飞）:42→d32 / 65→d14 / 68→d51 / 354→d36,
      //      尘速 X×0.4;其余 aiStyle10 型另有 else 兜底(≠109 且 1/20 → d0)未建模
      //      ——现役 sandBall 四型全入表,兜底无消费方 ----
      const sdT = this.projId === 42 ? 32 : this.projId === 65 ? 14
        : this.projId === 68 ? 51 : 36;                          // 354(:58896-58901)
      if (Math.random() < 0.5) {
        const sd = game.spawnDust?.(this.x, this.y, this.w, this.h, sdT);
        if (sd) sd.vx *= 0.4;
      }
      const stS = world.store;
      const sx0 = Math.floor(this.x / TILE), sx1 = Math.floor((this.x + this.w) / TILE);
      const sy0 = Math.floor(this.y / TILE), sy1 = Math.floor((this.y + this.h) / TILE);
      for (let si = sx0; si <= sx1; si++) {
        for (let sj = sy0; sj <= sy1; sj++) {
          if (!stS.inBounds(si, sj)) continue;
          const ti = stS.idx(si, sj);
          if (!stS.flags[ti]) continue;
          const sheet = TILE_DEFS[stS.type[ti]]?.vanilla?.sheet ?? -1;
          if (SAND_BALL_CUT_SHEETS.has(sheet)) {
            game.breakTile?.(si, sj);                            // WorldGen.KillTile 全语义
          } else if ((stS.slope[ti] === 1 || stS.slope[ti] === 2)) {
            stS.setSlope(si, sj, 0);                             // topSlope 且非平台 → 铲平
            this.y -= TILE;                                      // position.Y -= 16（:55127）
          }
        }
      }
    }
    // ---- aiStyle 专属物理（修复3：94/95/280/424 此前走通用直线兜底）----
    // 94 水晶风暴（aiStyle 24，Projectile.cs:24302-24326）：light=scale×0.5、
    // rotation+=vx×0.2（PROJ_SPIN 表）、1/4 尘 70、velocity×0.985 阻力、
    // ai[1]>130 后 scale −0.05/t 至 0.2 消亡
    if (this.projId === 94) {
      this.aiCnt++;                                              // ai[1] += 1（:24306）
      const l94 = this.drawScale * 0.5;
      this.lightRGB = [l94 * 0.5, 0, l94];                        // ProjLight :16380-16382 R×0.5/G×0/B=light(紫)——曾发白光
      if (Math.random() < 0.25) {                                // 1/4 尘 70（:24308-24315）
        game.spawnParticles(this.cx, this.cy, '#A0C8F0', 1, 0.5, { life: 20, grav: 0 });
      }
      this.vx *= 0.985; this.vy *= 0.985;                        // velocity *= 0.985（:24317）
      if (this.aiCnt > 130) {                                    //（:24318-24325）
        this.drawScale -= 0.05;
        if (this.drawScale <= 0.2) {
          this.drawScale = 0.2;
          this.killNow(game);
          return;
        }
      }
    } else if (this.projId === 1114) {
      // 1114 日耀花弹（aiStyle 24，Projectile.cs:26292/:26310-26340）：light=scale×0.5
      // （:26292 族首,ProjLight :16383-16388 乘 R×0.6/G×0.45/B×0.2=暖橙——夜间照明,
      // Update :17136 无昼夜门）、velocity×0.985 阻力、ai[1]>130 后 scale −0.05/t 至
      // 0.2 消亡（光随缩径衰减至 0.1）、wet 即 Kill（:26311-26313）。此前无物理分支
      // =无光+永续飞行（2026-08-25 用户报"夜间无照明"）
      this.aiCnt++;                                              // ai[1] += 1（:26333）
      const l1114 = this.drawScale * 0.5;
      this.lightRGB = [l1114 * 0.6, l1114 * 0.45, l1114 * 0.2];  // :26292 + ProjLight :16383-16388
      this.vx *= 0.985; this.vy *= 0.985;                        // velocity *= 0.985（:26334）
      const stW = (game as unknown as { world?: { store?: { wet?: Uint8Array; idx(x: number, y: number): number } } }).world?.store;
      if (stW?.wet) {
        const wx0 = Math.floor(this.x / TILE), wx1 = Math.floor((this.x + this.w - 1) / TILE);
        const wy0 = Math.floor(this.y / TILE), wy1 = Math.floor((this.y + this.h - 1) / TILE);
        for (let wi = wx0; wi <= wx1 && !this.dead; wi++) {
          for (let wj = wy0; wj <= wy1; wj++) {
            if (stW.wet[stW.idx(wi, wj)] > 0) { this.killNow(game); break; }   // wet → Kill（:26311-26313）
          }
        }
      }
      if (this.aiCnt > 130) {                                    //（:26335-26340）
        this.drawScale -= 0.05;
        if (this.drawScale <= 0.2) {
          this.drawScale = 0.2;
          this.killNow(game);
          return;
        }
      }
    } else if (this.projId === 95) {
      // 95 诅咒之焰（aiStyle 8，Projectile.cs:22624-22655）：每拍尘 75 绿焰
      // （:22624-22631，1 枚 scale 3×speed 继承）、ai[1]≥20 后 vy+=0.2
      // （:22651-22653）、rotation+=0.3×dir 翻滚（PROJ_SPIN 表）、vy 钳 16（:22664）
      this.aiCnt++;                                              // ai[1] += 1（:22647-22649）
      game.spawnParticles(this.cx + this.vx, this.cy + this.vy, '#40C040', 1, 1, { life: 18, grav: 0 });
      if (this.aiCnt >= 20) this.vy += 0.2;
      if (this.vy > 16) this.vy = 16;
    } else if (this.projId === 280) {
      // 280 黄金雨（aiStyle 12，Projectile.cs:22815-22862）：scale−0.002/子步至 0
      // 消亡（:22824-22827）；ai[0]>3 后重力 0.075 + 3×尘 170 + 1/8 追加
      // （:22831-22858），否则 ai[0]++（:22860-22862）。extraUpdates 2 → 3 子步/帧
      this.drawScale -= 0.002;
      if (this.drawScale <= 0) { this.killNow(game); return; }
      if (this.aiCnt > 3) {
        this.vy += 0.075;
        game.spawnParticles(this.cx, this.cy, '#D8B840', 3, 0.5, { life: 16, grav: 0 });
        if (Math.random() < 0.125) {
          game.spawnParticles(this.cx, this.cy, '#D8B840', 1, 0.3, { life: 14, grav: 0 });
        }
      } else {
        this.aiCnt++;
      }
    } else if (this.projId === 88) {
      // ★F7：extraUpdates=(int)ai[0] 直写（Projectile.cs:54979-54982,位于 scale<4 门
      //  之外=AI 支头）——hostileAi0 恒 0 空转（本仓无敌侧 88 出生面）,未来敌方弹幕
      //  生成端经 opts.ai0 注入即自动对齐
      if (this.hostileAi0 !== 0) this.extraUpdates = this.hostileAi0;
      // ---- ★2026-09-01 激光步枪 88 PurpleLaser 成长段（Projectile.cs:54978-55002，
      //  AI_001 type 专属段）----
      //  scale += 0.053/子步至帽 4（EU=4 → 每游戏帧实增 ≈0.265，出生 0.65 约
      //  13 帧满径 = 2px 细线 → 8px×~240px 粗光柱的「越飞越粗」签名）；击退随行
      //  ×1.0045；localAI[0](aiCnt) 满 8 重置并 damage+Next(1,4)、penetrate
      //  +Next(0,2)（pierce/pierceInit 同步抬=maxPenetrate 上移）。整块受
      //  scale<4 门包束——到帽即停止一切成长(:54981 字面)。extraUpdates=ai[0]
      //  直写分支已接装（上方 F7 行,hostileAi0 槽承载）。
      if (this.drawScale < 4) {
        this.drawScale = Math.min(4, this.drawScale + 0.053);
        this.knockback *= 1.0045;
        if (++this.aiCnt >= 8) {
          this.aiCnt = 0;
          this.damage += Math.floor(Math.random() * 3) + 1;   // Next(1,4)=1..3
          const penUp = Math.floor(Math.random() * 2);        // Next(0,2)=0..1
          this.pierce += penUp;
          this.pierceInit += penUp;
        }
      }
    } else if (this.projId === 20) {
      // ---- ★2026-09-01 全弹域审计：Space Gun 绿激光 20 成长段（Projectile.cs
      //  :55004-55021，AI_001 type 段，与 88 同款结构；发射者=Item.cs:2918 case 127
      //  SpaceGun shoot=20——与 514 LaserRifle→88 姐妹武器；曾误注"二代木弹"）----
      //  scale<3 帽包整块（到帽即停止一切成长）；scale+=0.0189 至 cap3、owner 门内
      //  knockback×1.0025、localAI[0](aiCnt) 满 25 重置并 damage+Next(1,3)=1..2、
      //  penetrate++（pierce/pierceInit 同步抬=maxPenetrate 上移）；EU=2 → AI 每
      //  游戏帧 ×3 子步（ProjectileID.GreenLaser，4×4 盒）。
      //  α 面：SetDefaults 20 无 alpha 行≡0 → 共享 fade 组(:56569)恒不触发=全程
      //  可见 ✓ 与现渲染一致,不入 LASER_FADE15。
      if (this.drawScale < 3) {
        this.drawScale = Math.min(3, this.drawScale + 0.0189);
        this.knockback *= 1.0025;
        if (++this.aiCnt >= 25) {
          this.aiCnt = 0;
          this.damage += Math.floor(Math.random() * 2) + 1;   // Next(1,3)=1..2
          this.pierce += 1;
          this.pierceInit += 1;
        }
      }
    } else if (LASER_FADE15_PROJS.has(this.projId)) {
      // ---- GetAlpha :81457 白加算支的共享渐显（Projectile.cs:56570-56592 case 组
      //  本族子集直抄：alpha −15/子步至 0;EU 弹每游戏帧 ×(EU+1) ≈ 出生一闪即亮）
      //  ★批二扩员后含非加算支成员：36/84/110/158-161/180/389 GetAlpha 各走缺省
      //  路径(:81507-81520)/180 走 Lerp 白支(:80734),色彩解释在 draw 侧各自完成 ----
      if (this.alpha > 0) this.alpha -= 15;
      if (this.alpha < 0) this.alpha = 0;
    } else if (this.projId === 576 || this.projId === 577) {
      // ---- ★2026-09-01 批三（T1）：星晕/漩涡激光 576/577 延迟渐显——AI_001 共享
      //  fade 开关第二组（P.cs:56601-56613，与上支同 switch 的相邻 case 组直抄）：
      //  localAI[1]++ 每子步无条件；>2 后 alpha −= 15 至 0。SetDefaults alpha=255
      //  (:6267/:6279)、EU=2（:6269/:6281）→ AI ×3 子步/帧（Update :16780-16880
      //  numUpdates 循环），首帧第 3 子步起拉亮。计数槽 aiCnt 专项独占——grep 两 id
      //  在本文件无其它 localAI[1] 消费者。出生端：576=星晕悬浮脑环绕球 574 线发
      //  （bossAI_lunar_misc,Arrow 直构=本支活跃）；577=风暴潜水员 425 满蓄四连发
      //  （fighterFamilies→Enemy.spawnHostileProj→Dart,DART_STYLE 无表项）——Dart
      //  载体不进本支,本分支对 577 为 dormant 备案（键已在 PROJ_ALPHA0 批三注） ----
      this.aiCnt++;
      if (this.aiCnt > 2) {
        if (this.alpha > 0) this.alpha -= 15;
        if (this.alpha < 0) this.alpha = 0;
      }
    } else if (this.projId === 575) {
      // ---- ★BJ109-B（2026-09-16）：星云兽蓄能球 575 AI 侧点光——aiStyle 107
      //  type==575 支 Lighting.AddLight(Center, 0.5, 0.1, 0.3)（P.cs:34200，AI 每
      //  拍无条件直发；★vanilla ProjLight()（P.cs:16246-17140 全表）不含 575，
      //  四柱系弹的光照全部散在 AI 侧——本支是其中唯一漏接的世界光面）。
      //  本仓通用光路（Game.ts ProjLight 转写段）按数据 light 列驱动，575 无
      //  light 行 → 走实体自报通道 lightRGB（94/1114 同款先例），Game 侧 projectile
      //  桶结算（实体 lightRGB 存在即跳过通用表，防双重注入）。AI 另面（α 255 起
      //  −25/子步渐显 + 实心盒钳 128 + 4 帧/5t 动画，:34181-34199）不在本刀，登记。
      this.lightRGB = [0.5, 0.1, 0.3];
    } else if (this.projId === 968) {
      // ---- ★2026-09-01 批四（T2/H7）：968 渐显——AI() aiStyle2 顶层 type 段
      //  （Projectile.cs:23413-23431）：alpha = Math.Max(0, alpha − 50) 每拍
      //  （:23429；SetDefaults α=255 :9169-9176 → 6 拍淡入；aiStyle2 无 EU=1 拍/帧）。
      //  同块 frame=(int)ai[1] 静态随机帧由 ctor pinFrame 掷签承载（见 ctor 注），
      //  不在本支。 ----
      //  ★批五：出生尘爆接装（localAI[0]==0 一次性门 → age===1 首子步等价，
      //  P.cs:23414-23428）：8×d31 @ 弹心前 SafeNormalize(v)×25 + (−8,−8) 处，
      //  尘速 = v×(0.2+Remap(玩家速,0..3→0..0.5)).RotatedByRandom(±0.7)
      //  + 玩家速×0.25 再 ×rand(0..1]，fadeIn 0.1、无重力、scale 0.75+rand×0.3。
      //  position −= velocity 的反向偏置不建模（一拍内消解，登记）。
      if (this.age === 1) {
        const pl968 = game.player as { vx: number; vy: number } | null;
        const pvx = pl968?.vx ?? 0, pvy = pl968?.vy ?? 0;
        const pvL = Math.hypot(pvx, pvy);
        const gain = (pvL / 3) * 0.5;                        // Remap(|pv|,0..3 → 0..0.5)
        const sp = Math.hypot(this.vx, this.vy) || 1;
        const ox = this.cx + (this.vx / sp) * 25 - 8;        // Center + norm(v)×25 + (−8,−8)
        const oy = this.cy + (this.vy / sp) * 25 - 8;
        for (let i = 0; i < 8; i++) {
          const d968 = game.spawnDust?.(ox, oy, 16, 16, 31, this.vx, this.vy, 50, null,
            0.75 + Math.random() * 0.3, true);
          if (!d968) break;
          const ra = (Math.random() * 2 - 1) * 0.7;          // RotatedByRandom(0.7) ∈ ±0.7
          const ca = Math.cos(ra), sa = Math.sin(ra);
          const base = sp * (0.2 + gain);
          const vxr = this.vx / sp, vyr = this.vy / sp;
          const dr = Math.random();                          // velocity ×= rand(0..1]
          d968.vx = ((vxr * ca - vyr * sa) * base) * dr + pvx * 0.25;
          d968.vy = ((vyr * ca + vxr * sa) * base) * dr + pvy * 0.25;
          d968.fadeIn = 0.1;
        }
      }
      if (this.alpha > 0) this.alpha -= 50;
      if (this.alpha < 0) this.alpha = 0;
    } else if (this.projId === 876) {
      // ---- R27：876 zapinator AI 尾段（Projectile.cs:56892-56908，aiStyle1 type 段）----
      //  tileCollide 按 ai[1] 态逐拍恢复（命中侧随机化把撞块关掉后,下一次 Damage 结算
      //  的末态写回 ai[1],AI 拍再据此恢复——穿墙窗恰一拍）;alpha −10/update 渐显至 0
      this.noTileCollide = this.zapAi1 === 1;
      if (this.alpha > 0) this.alpha -= 10;
      if (this.alpha < 0) this.alpha = 0;
    } else if (this.projId === 45) {
      // ---- R27：45 恶魔镰刀（aiStyle 18，Projectile.cs:25772-25798）----
      //  shootSpeed 0.2 是【指数加速起点】：ai[0]∈[30,100) 每 update velocity×=1.06、
      //  ai[0]≥100 置 200 冻结（:25782-25793）——"慢启动高音速镰刀"；快自旋在 PROJ_SPIN
      //  表（rotation += direction×0.8 :25781）；每 update 2×d27(alpha100,noGravity)
      //  （:25794-25798）。熔岩反弹无此型档；Kill 爆见 Game.onProjectileDeath
      this.aiCnt++;                                              // ai[0]++（:25782）
      if (this.aiCnt >= 30) {
        if (this.aiCnt < 100) {
          this.vx *= 1.06;                                       // (:25785-25788)
          this.vy *= 1.06;
        } else {
          this.aiCnt = 200;                                      // 冻结（:25789-25792）
        }
      }
      for (let i = 0; i < 2; i++) {
        game.spawnDust?.(this.x, this.y, this.w, this.h, 27, 0, 0, 100, null, 1, true);
      }
    } else if (this.projId === 27) {
      // ---- R27：27 水矢拖尾（aiStyle 8 type 支，Projectile.cs:24515-24577）----
      //  五点错位 d172 连续水痕 = 该弹可视本体（SetDefaults alpha=255 + GetAlpha 缺省
      //  路径 → 弹体贴图全程隐形，drawGlobalAlpha 已置 0）。门 `ai[1]==0 || rand(5)==0`
      //  中 ai[1] 是熔岩反弹旗（本支不接,P2 登记）恒走前半。后段重力不存在：
      //  :24618 `type != 27 && ...` 不自增 ai[1] → `ai[1]>=20 重力门恒假`（红队 P2 项驳）
      for (let i = 0; i < 5; i++) {                              // (:24554-24567)
        const d = game.spawnDust?.(this.x + 4, this.y + 4, this.w - 8, this.h - 8,
          172, 0, 0, 100, null, 1.2, true);
        if (d) {
          d.vx = d.vx * 0.1 + this.vx * 0.1;
          d.vy = d.vy * 0.1 + this.vy * 0.1;
          d.x -= (this.vx / 3) * i;
          d.y -= (this.vy / 3) * i;
        }
      }
      if (Math.floor(Math.random() * 5) === 0) {                 // 1/5 追加小尘(:24568-24576)
        const ds = game.spawnDust?.(this.x + 4, this.y + 4, this.w - 8, this.h - 8,
          172, 0, 0, 100, null, 0.6);
        if (ds) {
          ds.vx = ds.vx * 0.25 + this.vx * 0.5;
          ds.vy = ds.vy * 0.25 + this.vy * 0.5;
        }
      }
    } else if (this.projId === 22) {
      // ---- R27：22 水花权杖（aiStyle 12 type 22 支，Projectile.cs:24835-24926）----
      //  水支：num97=0.01 收缩/update 至 ≤0 Kill（≈100 个 AI update；extraUpdates=2 →
      //  ~34 帧寿命——"短程喷泉"）；num98=0.15 重力弧线（ai[0]>3 门）；3×d172 六px
      //  内缩盒错位拖尾 + 1/8 小尘。弹体贴图同 27 全程隐形（alpha=255 缺省 GetAlpha）。
      //  ★熔岩反弹支（ai[1]=1 档，:24841-24876，2026-09-03 接线）：进档即
      //  num98/=2(0.075)/num97=0（停收缩=浆中不死）/extraUpdates=0/penetrate=-1
      //  （:24842-24847）；下落态（vy>0 且 ai[1]==0——与水支的互斥门）心格 lava()
      //  → LCG32Random((uint)ai[2]) 两掷（:24851-24854，f32 逐算子）：
      //    velocity.Y = NextFloat()×-4f−4f ∈(-8,-4]；velocity.X = (NextFloat()−0.5f)×5f
      //    ∈(-2.5,2.5)；ai[1]=1 + 4×d31(vel×0.6,vy−2)（:24861-24865）+ 1/3 烟 gore
      //  61-63(x−6,vel×0.4,vy−1)（:24866-24871）。种子 = 出手位 ai[2]
      //  =Main.rand.Next(0,20000)（Player.cs:49929-49931,ctor 掷）→ 同弹恒向量。
      //  浆中段（ai[1]!=0）：1/2 掷 d31 小尘（:24899-24903）+ 1/2 概率跳过水拖尾
      //  （:24905-24907——浆里不再拉水痕）。
      const inLavaMode = this.waterLavaMode === 1;
      let num97 = 0.01;
      let num98 = 0.15;
      if (inLavaMode) {
        num98 = f32(num98 / 2);                    // num98 /= 2f（:24844）
        num97 = 0;                                 // 停收缩（:24845）
        this.waterEU0 = true;                      // :24846 extraUpdates=0——挂起 tick 头生效
        this.pierce = -1;                          // (:24847)
      }
      if (this.vy > 0 && !inLavaMode) {
        // 心格 lava()（:24848-24855：(int)Center/16 双 int 整除朝零 + WorldGen.InWorld
        // + Main.tile.lava()=液型旗位（Tile.cs:347,不查液量）——本仓 liquidType 同旗位域）
        const cx22 = Math.fround(Math.fround(Math.fround(this.x) + Math.fround(this.w / 2)));
        const cy22 = Math.fround(Math.fround(Math.fround(this.y) + Math.fround(this.h / 2)));
        const tx22 = Math.trunc(Math.trunc(cx22) / 16);
        const ty22 = Math.trunc(Math.trunc(cy22) / 16);
        const st22 = world.store;
        if (st22.inBounds(tx22, ty22)
          && st22.liquidType[st22.idx(tx22, ty22)] === LIQUID_TYPE.LAVA) {
          // LCG32Random((uint)ai[2]) 两掷：先 Y 后 X（:24852-24854 掷序敏感）
          const rng22 = new LCG32(this.waterStreamSeed >>> 0);
          this.vy = f32(f32(f32(rng22.nextDouble()) * -4) - 4);
          this.vx = f32(f32(f32(rng22.nextDouble()) - 0.5) * 5);
          this.waterLavaMode = 1;                  // ai[1] = 1f（:24855）
          for (let i = 0; i < 4; i++) {            // 4×d31（:24861-24865）
            const d31 = game.spawnDust?.(this.x, this.y, this.w, this.h, 31, 0, 0, 100, null, 1.5);
            if (d31) { d31.vx *= 0.6; d31.vy -= 2; }
          }
          if (Math.floor(Math.random() * 3) === 0) {          // 1/3 烟 gore（:24866-24871）
            const g22 = GorePiece.newGore(61 + Math.floor(Math.random() * 3), this.x, this.y, 0, 0);
            if (g22) { g22.x -= 6; g22.vx *= 0.4; g22.vy -= 1; }
          }
        }
      }
      this.drawScale -= num97;
      if (this.drawScale <= 0) { this.killNow(game); return; }
      if (this.aiCnt > 3) {
        this.vy += num98;
        if (this.waterLavaMode === 1 && Math.floor(Math.random() * 2) === 0) {   // (:24899-24903)
          const dm = game.spawnDust?.(this.cx, this.cy, 0, 0, 31, 0, 0, 100, null, 0.8);
          if (dm) { dm.vx *= 0.1; dm.vy *= 0.1; }
        }
        if (this.waterLavaMode !== 0 && Math.floor(Math.random() * 2) !== 0) return;   // (:24905-24907)
        for (let i = 0; i < 3; i++) {                            // (:24908-24921)
          const d = game.spawnDust?.(this.x + 6, this.y + 6, this.w - 12, this.h - 12,
            172, 0, 0, 100, null, 1.2, true);
          if (d) {
            d.vx = d.vx * 0.3 + this.vx * 0.5;
            d.vy = d.vy * 0.3 + this.vy * 0.5;
            d.x -= (this.vx / 3) * i;
            d.y -= (this.vy / 3) * i;
          }
        }
        if (Math.floor(Math.random() * 8) === 0) {               // (:24912-24920)
          const ds = game.spawnDust?.(this.x + 6, this.y + 6, this.w - 12, this.h - 12,
            172, 0, 0, 100, null, 0.75);
          if (ds) {
            ds.vx = ds.vx * 0.5 + this.vx * 0.5;
            ds.vy = ds.vy * 0.5 + this.vy * 0.5;
          }
        }
      } else {
        this.aiCnt++;
      }
    } else if (this.projId >= 424 && this.projId <= 426) {
      // 424-426 流星法杖弹（AI_001 type≥424&&≤426 支，Projectile.cs:58009-58040，
      // 1458 :58010；★R3(2026-09-03) 扩族：原写 424 单型，而 Game 侧 2750 支掷
      // 424+rand(3) → 425/426 永不恢复撞块=全寿穿墙活弹）：tileCollide 动态门——
      // 低于玩家 300px 或高于地表线（worldSurface×16）恢复撞块（:58011-58017，
      // SetDefaults tileCollide=false → 高空穿墙坠落）；scale=ai[1]（ctor 掷定）；
      // rotation+=vx×2（PROJ_SPIN 表）；每子步 3×尘 6 火焰尾（:58019-58040——
      // 几何近似登记:原版=±90°旋转双尘(位置=心+vel向×10px,vel=vel.rot(±π/2)×0.33
      // +vel/4,fadeIn 0.5)+中尘(vel×0.5,scale×1.3,fadeIn 1);本仓通用粒子）
      // immune[owner]=5 档已由 data/vanillaProjImmuneTiers.ts:79 承载（:14076-14078）
      const mp = game.player as { y?: number } | null;
      if (mp && typeof mp.y === 'number' && this.y > mp.y - 300) this.noTileCollide = false;
      // ★SW-FX46（2026-09-12）NaN 守卫：地表线读改 `(groundLevel || 0)`（同文件 :6012
      // 337 支 FX20/R28 同款先例）——原版量=Main.worldSurface×16.0（Projectile.cs
      // :58014-58016，仓内 world.groundLevel 即 worldSurface 消费位,Game.ts:5402
      // `worldSurface: w.groundLevel` 映射）。旧裸读在缺 groundLevel 的宿主
      // （测试桩/远端镜像）下 undefined×16=NaN → `y<NaN` 恒 false,高空恢复撞块
      // 支静默失效（424-426 SetDefaults tileCollide=false → 全寿穿墙）。
      if (this.y < (game.world.groundLevel || 0) * 16) this.noTileCollide = false;
      game.spawnParticles(this.cx, this.cy, '#E08030', 3, 0.8, { life: 16, grav: 0 });
    } else if (this.projId === 90) {
      // 90 水晶碎块（aiStyle 24，Projectile.cs:24302-24326 非 94 支，515 水晶子弹
      // Kill 碎片）：light=scale×0.5、rotation+=vx×0.2（PROJ_SPIN 表）、velocity×0.96
      // 阻力、ai[1]>15 后 scale −0.05/t 至 0.2 消亡（94 支的 130t 长寿命档不适用）
      this.aiCnt++;                                              // ai[1] += 1（:24306）
      const l90 = this.drawScale * 0.5;
      this.lightRGB = [l90 * 0.05, l90 * 0.2, l90];               // light=scale×0.5（:24304）+ ProjLight :16630-16635 R×0.05/G×0.2/B=light(深蓝)——曾发白光覆盖静态表
      this.vx *= 0.96; this.vy *= 0.96;                          // velocity *= 0.96（:24320）
      if (this.aiCnt > 15) {                                     //（:24321-24326）
        this.drawScale -= 0.05;
        if (this.drawScale <= 0.2) {
          this.drawScale = 0.2;
          this.killNow(game);
          return;
        }
      }
    } else if (this.projId === 604) {
      // ---- 604 孢子云（aiStyle 115 :35047-35069,603 悠悠球伴生弹——蓝队 R7-30）----
      //  SetDefaults :6073-6083：14×14/friendly/penetrate −1/melee/scale 1.2/
      //  IDStatic 10t。AI：光 0.075/0.3/0.15、速度 ×0.985 阻尼、旋转 +=vx×0.2
      //  ±0.08、ai[1]>30 后 alpha +10/t 至 255 消亡（约 57t 寿命）
      this.lightRGB = [0.075, 0.3, 0.15];
      this.vx *= 0.985; this.vy *= 0.985;
      this.spinRot += this.vx * 0.2 + (this.vx > 0 ? 0.08 : -0.08);
      this.aiCnt++;
      if (this.aiCnt > 30) {
        this.alpha = Math.min(255, this.alpha + 10);
        if (this.alpha >= 255) { this.killNow(game); return; }
      }
    } else if (this.projId === 614) {
      // ---- 614 星尘细胞弹 = aiStyle 113 TargetSticker（:41289-41330）----
      //  蓝队 R7-19：曾当直飞 Arrow 生成（不追踪/不失的即杀/无 183 buff——末地召唤
      //  核心输出弹哑弹）。① alpha −63/t 淡入（num=63 :41293-41299,SetDefaults 255 :6619）；
      //  ② ai[1]=发射侧注入的目标索引,目标 !CanBeChasedBy → 立即 Kill（:41317-41320）；
      //  ③ 硬追踪 v = (v×4 + 归一(目标−心)×14)/5（:41321-41330,速度向 14 收敛）。
      //  命中侧：目标盒收缩 + buff 183 门见命中环（stickerTgt 消费）。
      //  ★BJ703-D3（BJ698 登记债③）stuck 态（ai[0]==1,:41393-41518——命中转刺入
      //  :13244-13251 建模）：贴附敌身【零接触伤】（Damage_CanDealDamage :12463 首行
      //  `type==614∧ai[0]==1` 拒——本支早退于命中环=整拍 Damage 跳过同相）;窗拒
      //  900t（localAI[0]≥60×num11(15) :41400/:41480——timeLeft=300 首达,900 为
      //  Player.cs:6958 出生面 3600 档兜底）/靶亡/失锁/dontTakeDamage → Kill
      //  （:41480-41487/:41497-41517,614 非 1024 无 ai0=2 返航态）;贴附净位 =
      //  敌心 − velocity（:41490 Center=敌心−vel×2 + UpdatePosition +vel 原文合成）。
      //  ★BJ704-G10（R2-F5）stuck 两视觉面补齐：①每 30t 血尘脉冲（localAI[0]%30
      //  ==0 → flag2 → `Main.npc[ai[1]].HitEffect(0,1.0)` :41430-41433/:41488-41491
      //  ——spawnNpcHitDust(hit 相,dmg=1.0) 查表承载,BJ254 单源;门位=target 有效支
      //  内=杀门之后）;②gfxOffY 随载（:41489 `gfxOffY=npc.gfxOffY`）——【判语销案,
      //  域外恒 0】：NPC.gfxOffY 仅骑乘/挂载 NPC 有非零值（:35417 挂 383 座椅/
      //  :36006 挂他 NPC/:37520 挂玩家 + :91512-91529 逐拍衰减瞬态）,本仓 Enemy
      //  无 gfxOffY 字段（npcExtraParts.ts:21 判例「蚁狮系不写=0」）⇒ 载具恒 0=
      //  贴附位随敌心逐拍跟随已全覆盖,零可观测差。帧面：stuck 显式 frame=0
      //  （:41395）由 PROJ_FRAME_STATIC0（G10 件3）全域承载。
      if (this.alpha > 0) this.alpha = Math.max(0, this.alpha - 63);
      if (this.stickerA0 === 1) {
        this.noTileCollide = true;                    // tileCollide=false/ignoreWater=true（:41398-41399）
        this.stuckT614++;                             // localAI[0]++（:41429）
        const tS614 = this.stickerTgt
          ? (game.enemies() as Array<{ id: number; dead?: boolean; dontTakeDamage?: boolean; cx: number; cy: number }>)
            .find((q) => q.id === this.stickerTgt)
          : null;
        if (this.stuckT614 >= 900 || !tS614 || tS614.dead || tS614.dontTakeDamage === true) {
          this.killNow(game);                         // :41480-41487/:41497-41517
          return;
        }
        this.x = tS614.cx - this.vx - this.w / 2;     // :41490 净位（敌心−vel;gfxOffY 域外恒 0 见上注）
        this.y = tS614.cy - this.vy - this.h / 2;
        if (this.stuckT614 % 30 === 0) {
          spawnNpcHitDust(tS614 as Enemy, game, 0, 1);   // :41488-41491 flag2 → HitEffect(0,1.0)——原版序=Center/gfxOffY 写位之后（净位/零伤/窗 900t 不动）
        }
        return;                                       // 零接触伤（:12463 首行拒）
      }
      const tgt614 = this.stickerTgt
        ? (game.enemies() as Array<{ id: number; dead?: boolean }>).find((q) => q.id === this.stickerTgt)
        : null;
      if (!tgt614 || tgt614.dead || !canBeChasedBy(tgt614 as never)) {
        this.killNow(game);                                    // :41318-41320 失的即杀
        return;
      }
      const te614 = tgt614 as unknown as { x: number; y: number; w: number; h: number };
      let vx614 = te614.x + te614.w / 2 - this.cx;
      let vy614 = te614.y + te614.h / 2 - this.cy;
      const dl614 = Math.hypot(vx614, vy614);
      if (dl614 > 0) { vx614 = (vx614 / dl614) * 14; vy614 = (vy614 / dl614) * 14; }
      else { vx614 = 0; vy614 = 0; }                           // vector==Zero 保持零（:41326）
      this.vx = (this.vx * 4 + vx614) / 5;                     // num3=5（:41328-41330）
      this.vy = (this.vy * 4 + vy614) / 5;
    } else if (this.projId === 207 || this.projId === 837) {
      // 叶绿弹 207 / 骷髅头法书弹 837（AI_001 顶层段 :53906-54010，1179 叶绿弹追踪）：
      // ① alpha 255 起 −25/t 渐显（:53937-53943），<170 期沿弹道后向拖 75 号尘迹
      //   （:53911-53920，10 点排布 −v/10·i，本仓取 2 点近似）；
      // ② localAI[0] = 初速（==0 时取 |v|，此后恒为基准——转向不清速）；
      // ③ 锁敌（ai[1]==0，:53947-53969）：300px 曼哈顿视距内 CanBeChasedBy+CanHit
      //   最近者，锁 ai[1]=目标（锁后 flag5 复位，但同拍随即进 ④ 保持段再置位 →
      //   锁敌当帧即开始转向）；
      // ④ 保持（ai[1]>0，:53971-53990）：目标 active+CanBeChasedBy(ignoreDontTakeDamage)
      //   +!dontTakeDamage 且 1000px 内 → 追踪；失效/超距 → ai[1]=0 下帧重锁；
      // ⑤ !friendly 不追踪（敌方同型弹直飞）；转向 v=(v×(N−1)+dir×speed)/N
      //   （207 N=8 :57868-57872；★837 N=20——1457 :57861-57864 把 1456 的 32 改 20
      //   （1456 :54001-54005），转向响应 ×1.6，蓝队 R7-1 曾照抄 1456 旧值）
      // α 步进按型拆分：207 在 :53937-53943（−25/t 渐显,随 <170 尘迹窗口）；
      // ★837 实际在 :57636-57645 与 270 同支（共享 −50/t clamp0）——曾并入
      //   −25 档=不可见窗过长;GetAlpha 二态门(:80726)下全程隐形至归零瞬白
      if (this.alpha > 0) {
        this.alpha = Math.max(0, this.alpha - (this.projId === 837 ? 50 : 25));
      }
      // 207 光走静态表(数据 light=0.5 × MUL [0.4,1,0.4]=原版绿)——曾实体白光覆盖
      // ★1457 新增（:57774-57779，1456 无此块）：837 弹心埋进实心格时每 update 额外
      //   烧 33t 寿命（timeLeft>33 门）——防骷髅头穿墙滞留（480t → 最快 ~15 拍耗尽），
      //   蓝队 R7-2：曾整缺，射入方块后按自然寿命慢消且穿透期内持续可命中贴墙敌
      if (this.projId === 837 && this.life > 33) {
        const bx837 = Math.floor(this.cx / TILE), by837 = Math.floor(this.cy / TILE);
        if (world.store.inBounds(bx837, by837) && world.store.isSolid(bx837, by837)) this.life -= 33;
      }
      // 尘拖尾仅 207（:57760 `type == 207 && alpha < 170`；837 alpha 恒 255 隐身无尘段
      //   ——蓝队 R7-3：曾 207||837 合并支无型别门，837 多一路可见尘迹泄露弹道）
      if (this.projId === 207 && this.alpha < 170) {
        for (const k of [0, 5]) {
          const d = game.spawnDust?.(this.x - (this.vx / 10) * k, this.y - (this.vy / 10) * k,
            1, 1, 75, 0, 0, this.alpha, null, 1, true);
          if (d) { d.vx = 0; d.vy = 0; }
        }
      }
      if (this.chloSpeed === 0) this.chloSpeed = Math.hypot(this.vx, this.vy);
      {
        let steer = false;
        let tx = this.cx, ty = this.cy;
        const enemies = game.enemies() as Array<{
          id: number; x: number; y: number; w: number; h: number; dead: boolean;
          dontTakeDamage?: boolean;
        }>;
        const manh = (e: { x: number; y: number; w: number; h: number }) =>
          Math.abs(this.cx - (e.x + e.w / 2)) + Math.abs(this.cy - (e.y + e.h / 2));
        if (this.chloAi1 === 0) {
          let best = 300;
          let bestId = 0;
          for (const e of enemies) {
            if (e.dead) continue;
            if (!canBeChasedBy(e)) continue;   // CanBeChasedBy（:53950）
            const d = manh(e);
            if (d >= best) continue;
            // Collision.CanHit（:53956 弹心 1×1 → 敌盒）
            if (!canHitLine(world.store, this.cx, this.cy, 0, 0, e.x, e.y, e.w, e.h)) continue;
            best = d; tx = e.x + e.w / 2; ty = e.y + e.h / 2; bestId = e.id;
          }
          if (bestId !== 0) this.chloAi1 = bestId;   // :53963-53966（当帧 flag5 复位不转）
        }
        if (this.chloAi1 !== 0) {
          const tgt = enemies.find((e) => e.id === this.chloAi1);
          // :53973-53976 active + CanBeChasedBy(ignoreDontTakeDamage) + !dontTakeDamage
          if (tgt && !tgt.dead && !tgt.dontTakeDamage && canBeChasedBy(tgt)) {
            if (manh(tgt) < 1000) {                       // :53981 1000px 保持圈
              steer = true;
              tx = tgt.x + tgt.w / 2; ty = tgt.y + tgt.h / 2;
            }
          } else {
            this.chloAi1 = 0;                             // :53984-53986 失效清锁
          }
        }
        if (this.hostile) steer = false;                  // :53992-53994 !friendly 不追踪
        if (steer) {
          const sp = this.chloSpeed;
          let dx = tx - this.cx, dy = ty - this.cy;
          const dl = Math.hypot(dx, dy) || 1;
          const w = this.projId === 837 ? 20 : 8;         // num204（:57861-57864，★1457 32→20）
          this.vx = (this.vx * (w - 1) + (dx / dl) * sp) / w;
          this.vy = (this.vy * (w - 1) + (dy / dl) * sp) / w;
        }
      }
    } else if (this.projId === 181 || this.projId === 189 || this.projId === 307
      || this.projId === 316 || this.projId === 566) {
      // ---- aiStyle 36 蜂族（AI() 派发器 Projectile.cs:27683-27862）----
      // ★批⑤（2026-08-31）覆盖实证收口——「已实证对齐行号表」（1457 逐段对读）：
      //   :27685-27688 入水消亡(wet && !honeyWet && !shimmerWet;307 豁免)
      //     = 本处 liquidType∈{WATER,LAVA} 才 kill ——蜂蜜(3)/微光(4) 天然豁免,等价式成立;
      //   :27690-27697 alpha −50 / 归零后 extraUpdates=0 → 本处 + :2904 tick 头生效位 ✓
      //   :27698-27701 307 rotation=atan2−π/2、6 拍 2 帧 → bee36Tilt/bee36Frame(draw 消费) ✓
      //   :27702-27716 307 尘 184 ×3(position=Center−v/3×i,v=0,scale .5) ✓
      //   :27717-27727 其余 spriteDirection±/rotation=vX×.1、3 拍 3 帧 ✓(同上字段)
      //   :27761-27764 ai[0]++ >30 后【每 update】重搜 → bee36Delay 钳 30 ✓
      //   :27766-27776 候选 = CanBeChasedBy && (!wet||type370||307) ；曼哈顿 CENTER 对
      //     CENTER <800（注意此段是正常中心距!与 ghostHurt/AI_059 的怪癖式不同源）
      //     视线 = Collision.CanHit(position,width,height → npc.position,width,height)
      //     （:27776 步行族整盒对整盒——F5/F6 归位后：vanillaId!==370 湿拒 + canHit
      //     盒形调用，非 canHitLine；可复核=physics/LineOfSight.ts canHit 契约注）；
      //   :27784-27788 无标瞄心 = center+v×100 ✓
      //   :27789-27792 仅 307 锁定帧 friendly=true → friendly307 位 ✓
      //   :27793-27822 speed/accel 逐型：181 6/.1、189 9/.2、307 13/.35、
      //     316 锁13/.325 自由10/.25、566 6.8/.14 → P36 表逐值核对 ✓
      //   :27823-27862 逐轴步进 + 变号双步(+/-2×accel)转向 ✓
      // 上述各值另有 tests/spectre-stellar-procs.test.ts 兄弟批面；数据面
      // vanilla-projectiles.json 181/189/307/316/566 行由 recon-item 双闸门守护。
      // 181 蜂枪蜂(1121)/566 巨蜂(beeType 强蜂 20%)/189 黄蜂枪蜂(1155)/
      // 316 蝙蝠杖蝠(1801)/307 腐化者天罚小吞噬者(1571 命中 Kill 链 :78052-78062 掷)：
      // ① 入水消亡（307 豁免——:27685 `type != 307 && wet && !honeyWet && !shimmerWet`）；
      // ② alpha −50/update 渐显，归零后 extraUpdates=0（:27690-27697，SetDefaults 3 →
      //    淡入期 4 子步/帧、全显后 1——速度观感先快后常）；
      // ③ 30 update 索敌延迟（:27762-27764 ai[0]++ 钳 30）后【每 update 重搜】最近敌
      //   （800 曼哈顿 + CanHit 步行族全盒视线 :27776；湿敌豁免：NPC.type==370 Duke
      //    Fishron 或 307 自身，:27769——本仓比较 vanillaId（F5 归位））——
      //   无持久锁，每拍重选最近；
      // ④ 无目标 → 瞄准点 = 弹心 + v×100（保持直飞，:27784-27788）；307 锁到目标瞬间
      //    friendly = true（:27789-27792——出生非 friendly，锁定才可伤敌）；
      // ⑤ 逐轴步进转向（:27823-27862）：目标速度向量 = 归一(目标−弹心)×speed，
      //    v.x < 目标 → +accel（变号再 +2×accel），反之 −accel——蜂群"振翅折线"观感。
      //    逐型 speed/accel：181 6/0.1、189 9/0.2、307 13/0.35、316 13/0.325(锁定)
      //    或 10/0.25(自由)、566 6.8/0.14（:27793-27822）。
      {
        // ★三轮蓝队 F7：判死几何升级（Collision.cs:1575-1656 全式,复用 npcLiquid
        //   1:1 移植）——单「弹心格 liquid>0」近似曾有两类真差异：
        //   a) 贴水面掠飞：弹心格 liquid>0 但液面下探((256-liquid)/32×2px)后探针盒
        //      （min(10,W)×min(H/2,H) 居中）与液体体积不相交 ⇒ 原版不死、我们误杀;
        //   b) 邻格液体 + 弹心格干燥：中心格判漏 ⇒ 原版 W≤10 蜂全宽探针可触邻格
        //      液体而致死被漏;坡面格+上方液体(slope≠0 支 :1630-1647,★L1 纯在场位
        //      致动斜坡同判)同前一类。
        // ★L2（2026-09-01 NX3 遗留2）：原版 :27685 读【字段】wet/honeyWet/shimmerWet
        //   （出生预置 NewProjectile :10887-93 + 每子步液段 :16900-16908/三清
        //   :17104-17108），非当场重测——本仓同源缓存见 fixedUpdate 出生预置块/
        //   subStepAI 段前刷新块（湿段在位移前=原版 :16903 位序,2026-09-04 重排）；
        //   AI 头读缓存=读上子步液段值（出生拍=预置值），时序
        //   与原版同构（旧"内联即时读差 1 子步"登记作废）。蜂蜜/微光旗随缓存
        //   附带（置位只增不清——蜜→水直渡豁免语义同原版 !wet 三清位）。
        if (this.wet && !this.honeyWet && !this.shimmerWet && this.projId !== 307) {
          this.killNow(game); return;                    //（:27685-27688）
        }
      }
      if (this.alpha > 0) {
        this.alpha = Math.max(0, this.alpha - 50);         //（:27690-27692）
        if (this.alpha === 0) this.bee36EU0 = true;        //（:27693-27695，下一 tick 生效
      }                                                    //   ——原版 numUpdates 每 tick
                                                           //   头读取,当拍子步数不变）
      // 姿态/帧（:27697-27727）：307 rotation=atan2(vy,vx)−π/2、6 拍/帧 2 帧；
      // 其余 rotation=vx×0.1、3 拍/帧 3 帧（draw 侧消费 bee36Frame/bee36Tilt）
      this.bee36Tilt = this.projId === 307
        ? Math.atan2(this.vy, this.vx) - Math.PI / 2
        : this.vx * 0.1;
      // 307 尘尾（:27707-27716）：每 update 3×184 尘（scale 0.5、速度 0、
      // 位置 = 弹心 − v/3×i 沿弹道后向排布）
      if (this.projId === 307) {
        for (let i = 0; i < 3; i++) {
          const d307 = game.spawnDust?.(this.cx - (this.vx / 3) * i - 2,
            this.cy - (this.vy / 3) * i - 2, 4, 4, 184, 0, 0, 0, null, 0.5);
          if (d307) { d307.vx = 0; d307.vy = 0; }
        }
      }
      if (++this.bee36FrameT >= (this.projId === 307 ? 6 : 3)) {
        this.bee36FrameT = 0;
        const maxF = this.projId === 307 ? 2 : 3;
        this.bee36Frame = (this.bee36Frame + 1) % maxF;
      }
      // 索敌（:27762-27792）
      this.bee36Aim = null;
      this.bee36AimLocked = false;
      if (++this.bee36Delay > 30) {
        this.bee36Delay = 30;                              //（:27763-27764 钳）
        let best36 = 800;
        for (const ent of game.enemies()) {
          const e = ent as unknown as {
            id: number; x: number; y: number; w: number; h: number; dead?: boolean;
            wet?: boolean; vanillaId?: number | null;
          };
          if (e.dead) continue;
          if (!canBeChasedBy(ent)) continue;      // CanBeChasedBy
          // 湿敌豁免（:27769）：`Main.npc[i].type == 370`（Duke Fishron）或 307 自身可追
          //   湿敌——★F5 归位（2026-08-31 二轮蓝队）：比较面是【原版 NPC 型号】
          //   vanillaId，非运行时槽 id（旧 `e.id !== 370` 对 Duke 恒真 ⇒ 豁免永不命中）。
          //   Bobber.ts 松露虫 370 同口径先例。
          if (e.wet && this.projId !== 307 && e.vanillaId !== 370) continue;
          const d36 = Math.abs(this.cx - (e.x + e.w / 2)) + Math.abs(this.cy - (e.y + e.h / 2));
          if (d36 >= best36) continue;
          // CanHit 全盒步行族（★F6 归位：原版 :27776 字面
          //   Collision.CanHit(base.position,width,height → npc.position,width,height)，
          //   非积分步进 CanHitLine——两族在斜坡/半砖/夹缝与三 tile 判定组上互异）
          if (!canHit(world.store, this.x, this.y, this.w, this.h, e.x, e.y, e.w, e.h)) continue;
          best36 = d36;
          this.bee36Aim = { cx: e.x + e.w / 2, cy: e.y + e.h / 2 };
          this.bee36AimLocked = true;
        }
        if (this.bee36AimLocked && this.projId === 307) this.friendly307 = true;  //（:27789-27792）
      }
      if (!this.bee36Aim) {
        this.bee36Aim = { cx: this.cx + this.vx * 100, cy: this.cy + this.vy * 100 };  //（:27784-27788）
      }
      // 逐轴步进转向（:27823-27862）——★终零波·AI_036 内核单核收编：本分支是
      // aiStyle36 全家族唯一追踪核，三处生产端（蜂蜜斗篷受击反击 Game.ts / 蜂箭
      // 469 Kill 放蜂 spawnBeeSwarm / beenade 大爆拨发）的弹体 projId 命中表后
      // 走同一索敌+转向管线；参数真值抽 AI_STYLE36_TRACK_PARAMS 导出（金标直测）
      const P36: Record<number, [number, number]> = {
        ...AI_STYLE36_TRACK_PARAMS,
        316: this.bee36AimLocked ? [13, 0.325] : [10, 0.25],   // 双档在消费位按锁存并表
      };
      const [spd36, acc36] = P36[this.projId];
      {
        const dx36 = this.bee36Aim.cx - this.cx, dy36 = this.bee36Aim.cy - this.cy;
        const dl36 = Math.hypot(dx36, dy36) || 1;
        const wantX = (dx36 / dl36) * spd36, wantY = (dy36 / dl36) * spd36;
        if (this.vx < wantX) { this.vx += acc36; if (this.vx < 0 && wantX > 0) this.vx += acc36 * 2; }
        else if (this.vx > wantX) { this.vx -= acc36; if (this.vx > 0 && wantX < 0) this.vx -= acc36 * 2; }
        if (this.vy < wantY) { this.vy += acc36; if (this.vy < 0 && wantY > 0) this.vy += acc36 * 2; }
        else if (this.vy > wantY) { this.vy -= acc36; if (this.vy > 0 && wantY < 0) this.vy -= acc36 * 2; }
      }
    } else if (this.projId === 616) {
      // ---- 616 星旋机枪涡旋弹（AI_001 重力链 616 支，Projectile.cs:58383-58465）----
      // 3475 星旋机枪(615 持械弹)每 7 轮附赠（Game 侧已接 :68011-68025 伤+20/kb×1.25/
      // 速 8）：① alpha −25/update 渐显（:58378-58384）；② <170 期 3×229 尘尾迹
      // （:58385-58394）；③ localAI[0]=初速快照（:58371-58377，转向不清速）；
      // ④ 20 update 延迟（:58403-58405 ai[0]++ >20 自减钳 20）后锁敌：800 曼哈顿
      //   + CanHit（:58407-58420）锁 ai[1]=敌+1——【失效不复锁】（:58421-58437 无
      //   清锁支，与 207/837 的失效重锁不同）；⑤ 1000px 保持圈（:58438-58441）；
      // ⑥ 转向 v=(v×7+dir×初速)/8（:58448-58452 num249=8）；!friendly 不追踪
      //   （:58442-58444）。
      if (this.alpha > 0) this.alpha = Math.max(0, this.alpha - 25);
      if (this.alpha < 170) {
        for (let k = 0; k < 3; k++) {
          const d616 = game.spawnDust?.(
            this.cx - (this.vx / 3) * k, this.cy - (this.vy / 3) * k,
            1, 1, 229, 0, 0, 200, null, 0.5, true);
          if (d616) { d616.vx = 0; d616.vy = 0; }
        }
      }
      if (this.vx616Speed === 0) this.vx616Speed = Math.hypot(this.vx, this.vy);
      if (++this.vx616Delay > 20) {
        this.vx616Delay = 20;                              //（:58403-58405 钳）
        if (this.vx616Ai1 === 0) {
          let best616 = 800;
          let bestId616 = 0;
          for (const ent of game.enemies()) {
            const e = ent as unknown as { id: number; x: number; y: number; w: number; h: number; dead?: boolean };
            if (e.dead) continue;
            if (!canBeChasedBy(ent)) continue;
            const d616 = Math.abs(this.cx - (e.x + e.w / 2)) + Math.abs(this.cy - (e.y + e.h / 2));
            if (d616 >= best616) continue;
            if (!canHitLine(world.store, this.cx, this.cy, 0, 0, e.x, e.y, e.w, e.h)) continue;
            best616 = d616;
            bestId616 = e.id;
          }
          if (bestId616 !== 0) this.vx616Ai1 = bestId616;  //（:58418-58420）
        }
        if (this.vx616Ai1 !== 0) {
          const t616 = (game.enemies() as Array<{ id: number; x: number; y: number; w: number; h: number; dead?: boolean }>)
            .find((e) => e.id === this.vx616Ai1);
          //（:58423-58437）active + CanBeChasedBy(ignoreDontTakeDamage) + 1000px 内
          if (t616 && !t616.dead && canBeChasedBy(t616)
            && Math.abs(this.cx - (t616.x + t616.w / 2)) + Math.abs(this.cy - (t616.y + t616.h / 2)) < 1000) {
            const dx616 = t616.x + t616.w / 2 - this.cx, dy616 = t616.y + t616.h / 2 - this.cy;
            const dl616 = Math.hypot(dx616, dy616) || 1;
            this.vx = (this.vx * 7 + (dx616 / dl616) * this.vx616Speed) / 8;   //（:58448-58452）
            this.vy = (this.vy * 7 + (dy616 / dl616) * this.vx616Speed) / 8;
          }
        }
      }
    } else if (this.projId === 297) {
      // ---- 297 幽灵法杖弹（aiStyle 51，Projectile.cs:28825-28927，1446 幽灵法杖）----
      // ★F1（红队 A 仲裁 CRITICAL,2026-09-02）：AI 尘载体补齐（:28827-28838）——
      //  弹体贴图因 alpha=255 + GetAlpha 缺省路径 (255−α)/255=0 【恒隐】（见
      //  PROJ_ALPHA0[297] 注）,可视本体=本尘雾。原版 localAI[0]++（自 0 起先增后
      //  判）>4 门后每 update 5×d175（NewDust α100/scale2 + noGravity + velocity
      //  ×=0）——首子步 localAI[0]=1 → 第 5 子步起撒尘;本仓 age 同为子步头自增
      //  （1 基,968 支 age===1=首子步同基准）→ age≥5 等价。EU=1（SetDefaults
      //  :3880）→ 每游戏帧 2 子步 ≈ 出生第 3 帧起持续雾化。
      if (this.age >= 5) {
        for (let i297 = 0; i297 < 5; i297++) {
          const d297 = game.spawnDust?.(this.x, this.y, this.w, this.h, 175, 0, 0, 100, null, 2, true);
          if (d297) { d297.vx = 0; d297.vy = 0; }   //（:28837 velocity *= 0f——清 NewDust 掷速）
        }
      }
      // 每拍重搜最近敌（400 曼哈顿 + Distance<400 欧氏双门 + CanHit 盒心 1×1→敌心，
      // :28861-28880）→ 转向 v=(v×20+dir×6)/21（:28913-28916 num384=6/num=21）；
      // 无目标保持直飞。293 敌对失魂同支追玩家（:28881-28901，speed 3/权重 101）——
      // 敌对弹由 NPC AI 侧生成，本仓走 Enemy 弹幕路径不在此接（登记）。
      let b297 = 400;
      let ax297 = 0, ay297 = 0, got297 = false;
      for (const ent of game.enemies()) {
        const e = ent as unknown as { x: number; y: number; w: number; h: number; dead?: boolean };
        if (e.dead) continue;
        if (!canBeChasedBy(ent)) continue;
        const dE = Math.hypot(e.x + e.w / 2 - this.cx, e.y + e.h / 2 - this.cy);
        if (dE >= b297) continue;                          // Distance < 400（:28865）
        if (!canHitLine(world.store, this.cx, this.cy, 0, 0, e.x + e.w / 2, e.y + e.h / 2, 0, 0)) continue;
        const dM = Math.abs(this.cx - (e.x + e.w / 2)) + Math.abs(this.cy - (e.y + e.h / 2));
        if (dM >= b297) continue;                          // 曼哈顿 < 400（:28879）
        b297 = dM;
        ax297 = e.x + e.w / 2; ay297 = e.y + e.h / 2; got297 = true;
      }
      if (got297) {
        const dx297 = ax297 - this.cx, dy297 = ay297 - this.cy;
        const dl297 = Math.hypot(dx297, dy297) || 1;
        this.vx = (this.vx * 20 + (dx297 / dl297) * 6) / 21;   //（:28913-28916）
        this.vy = (this.vy * 20 + (dy297 / dl297) * 6) / 21;
      }
    } else if (this.projId === 659) {
      // ---- 659 灵魂之焰（aiStyle 129，Projectile.cs:36861-36970，3779 灵魂之焰）----
      // ① 每 5 update 重索敌（:36878-36882 localAI[0] 节拍）：400 欧氏 +
      //   CanHitLine(弹心→敌心 或 敌顶)（:36888-36893）取最近锁 ai[0]，锁到即
      //   timeLeft=420（:36896-36899）；② 追踪 v=(v×2+dir×7.5)/3（:36954-36959，
      //   距离 >1 才转）；③ 目标失效 → ai[0]=−1 且 timeLeft 钳 5（:36963-36966）；
      // ④ 埋入实心格 → timeLeft 钳 2（:36945-36948）；⑤ alpha −12/t 渐显
      //   （:36901-36903）、timeLeft<30 停渐显。
      if (this.sf659Cd > 0) this.sf659Cd--;
      if (this.sf659Cd === 0 && this.sf659Ai0 < 0) {
        this.sf659Cd = 5;                                  //（:36881 localAI[0]=5f）
        let best659 = 400;
        let bestId659 = -1;
        for (const ent of game.enemies()) {
          const e = ent as unknown as { id: number; x: number; y: number; w: number; h: number; dead?: boolean };
          if (e.dead) continue;
          if (!canBeChasedBy(ent)) continue;      // CanBeChasedBy
          const d659 = Math.hypot(e.x + e.w / 2 - this.cx, e.y + e.h / 2 - this.cy);
          if (d659 >= best659) continue;                   //（:36890 < 400f）
          const hitC = canHitLine(world.store, this.cx, this.cy, 0, 0, e.x + e.w / 2, e.y + e.h / 2, 0, 0);
          const hitT = canHitLine(world.store, this.cx, this.cy, 0, 0, e.x + e.w / 2, e.y, 0, 0);
          if (!hitC && !hitT) continue;                    //（:36892-36893 心|顶双门）
          best659 = d659;
          bestId659 = e.id;
        }
        if (bestId659 >= 0) {
          this.sf659Ai0 = bestId659;
          this.life = 420;                                 //（:36896-36898 timeLeft = 420 直写）
        }
      }
      if (this.sf659Ai0 >= 0) {
        const t659 = (game.enemies() as Array<{ id: number; x: number; y: number; w: number; h: number; dead?: boolean }>)
          .find((e) => e.id === this.sf659Ai0);
        if (t659 && !t659.dead) {
          const dx659 = t659.x + t659.w / 2 - this.cx, dy659 = t659.y + t659.h / 2 - this.cy;
          if (Math.hypot(dx659, dy659) > 1) {              //（:36952 Distance > num1008=1）
            const dl659 = Math.hypot(dx659, dy659);
            this.vx = (this.vx * 2 + (dx659 / dl659) * 7.5) / 3;   //（:36954-36959）
            this.vy = (this.vy * 2 + (dy659 / dl659) * 7.5) / 3;
          }
        } else {
          this.sf659Ai0 = -1;
          this.life = Math.min(this.life, 5);              //（:36963-36966）
        }
      }
      if (this.life > 2) {
        const bx659 = Math.floor(this.cx / TILE), by659 = Math.floor(this.cy / TILE);
        if (world.store.inBounds(bx659, by659) && world.store.isSolid(bx659, by659)) {
          this.life = 2;                                   //（:36945-36948）
        }
      }
      if (this.life > 30 && this.alpha > 0) this.alpha = Math.max(0, this.alpha - 12);  //（:36901-36903）
      // ★R28 三臂旋尘（:36916-36927）：ai[1]++ 相位,3 臂各 1/3 掷 d27——位置 =
      //   心+UnitY.RotatedBy(臂×2π/3+相位)×10、速度 = DirectionFrom(尘位) =
      //   归一(心−尘位)【向心】(Entity.DirectionFrom :210-213 归一(Center−Source),
      //   红队"径向外向"系误读)、scale 按 timeLeft 三档(<120→1.1/<60→1.6)、
      //   fadeIn .5、alpha200——三臂螺旋暗焰是该弹可视主体
      {
        this.sf659Phase++;
        const sc659 = this.life < 60 ? 1.6 : this.life < 120 ? 1.1 : 0.5;   //（:36910-36915）
        for (let arm = 0; arm < 3; arm++) {
          if (Math.floor(Math.random() * 3) !== 0) continue;
          const th = arm * (Math.PI * 2 / 3) + this.sf659Phase;
          const px659 = this.cx - Math.sin(th) * 10;
          const py659 = this.cy + Math.cos(th) * 10;
          const dl659b = Math.hypot(this.cx - px659, this.cy - py659) || 1;
          const d659c = game.spawnDust?.(px659 - 1, py659 - 1, 2, 2, 27,
            (this.cx - px659) / dl659b, (this.cy - py659) / dl659b, 200, null, sc659, true);
          if (d659c) d659c.fadeIn = 0.5;
        }
      }
    } else if (this.projId === 522) {
      // ---- ★R28 §11 水晶蛇子蛇（aiStyle29 522 支 :38427-38455,521 Kill 链生）----
      // ai[1]>40 Kill;vy+0.2/update 钳 18、vx×0.98;每 update 2×d254（pos=(pos+心)/2,
      // v×0.3,scale1.1×衰减(num7=(60−ai1)/60)）+ 1×d255（pos=(pos+心×5)/6,v×0.1,
      // fadeIn=0.9×num7,scale0.6×衰减）——本体 alpha=255 恒隐,视觉即尘蛇
      this.sn522Ai1++;
      const num7 = (60 - this.sn522Ai1) / 60;
      if (this.sn522Ai1 > 40) { this.killNow(game); return; }
      this.vy = Math.min(this.vy + 0.2, 18);
      this.vx *= 0.98;
      for (let i = 0; i < 2; i++) {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 254,
          this.vx, this.vy, 50, null, 1.1 * num7, true);
        if (d) { d.x = (d.x + this.cx) / 2; d.y = (d.y + this.cy) / 2; d.vx *= 0.3; d.vy *= 0.3; }
      }
      const d255 = game.spawnDust?.(this.x, this.y, this.w, this.h, 255,
        this.vx, this.vy, 50, null, 0.6 * num7, true);
      if (d255) { d255.x = (d255.x + this.cx * 5) / 6; d255.y = (d255.y + this.cy * 5) / 6; d255.fadeIn = 0.9 * num7; }
    } else if (this.projId === 15 || this.projId === 253) {
      // ---- ★R28 §13/§14 火之花 15（112）/冰之花 253（1264）（aiStyle8 else 支
      //      :24604-24646 / 253 支 :24587-24599）----
      // 每 update 2×d6(253→d135)：初速=弹速×0.2、alpha100、scale2、noGravity，
      // 再 ×0.3（净值 ×0.06）；ai[1]++ ≥20 → vy+=0.2（20t 后坠弧）；vy 钳 16。
      // 自旋 rotation+=0.3×sign(vx) 走 PROJ_SPIN；加算辉光已接（ADDITIVE_GLOW）
      const fdType = this.projId === 253 ? 135 : 6;
      for (let i = 0; i < 2; i++) {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, fdType,
          this.vx * 0.2, this.vy * 0.2, 100, null, 2, true);
        if (d) { d.vx *= 0.3; d.vy *= 0.3; }
      }
      this.aiCnt++;
      if (this.aiCnt >= 20) this.vy += 0.2;              //（:24633-24635）
      if (this.vy > 16) this.vy = 16;                    //（:24643-24645）
    } else if (this.projId === 294) {
      // ---- ★R28 §1 暗影束（aiStyle48 AI 支 :28609-28631 + HandleMovement 编排束
      //      :18976-19013 + Spawn_Shadowbeam ParticleOrchestrator :1987-2010）----
      // 本体恒隐（alpha=255→GetAlpha A=0,PROJ_ALPHA0/drawGlobalAlpha 承载）;可视面
      // =束段尘:【撞块时】从锚点(localAI[1]/[2])到当前心铺 d173 线束(步距 max(4,|v|),
      // 每步 3 枚 scale rand(70..110)×0.013、v×0.2)后重锚——红队"逐拍铺束"系误读,
      // 广播块在 HandleMovement 碰撞处理链内(:18008 lastVelocity!=velocity → flag →
      // 各 type 分支);Kill 补铺末段(:71840-71870)。首 delay=9 子步静默(:28612/:54941)
      this.sbL0++;
      if (this.sbL0 - 1 === 9) { this.sbAx = this.cx; this.sbAy = this.cy; }   // localAI==delay 锚定
      // ★2026-09-03 寿命/EU 一致性推演定谳（294 友版,无病登记）：SetDefaults
      //  timeLeft=300 + extraUpdates=100（Projectile.cs:3840-3849,发射点 Player.cs
      //  无 Modifier 覆写 → 终值 300）。原版 timeLeft-- 在子步循环【内】(Update
      //  :17307-17311) → EU=100 每帧 101 子步、timeLeft 每帧耗 101 → 真寿命
      //  ⌈300/101⌉=3 帧、AI 恰跑 300 子步;本仓 subStep 循环 u≤extraUpdates
      //  (Arrow.ts:4053)+尾部递减(:4125 R7-5)同式,life=Game 魔法域 pd?.timeLeft
      //  (json 294=300)、extraUpdates=json 100(:2035) → 同拍同寿零偏。delay=9 为
      //  【子步】拍(本支每子步 ++,非每帧);锚定序=第 10 次 AI 调(localAI[0]==9
      //  先判后 ++ ≙ sbL0-1==9);渐显无分支(294 恒 alpha=255 本体隐,:28629,可视
      //  面全在 d173 束尘——AI_047 式淡入淡出段不属于本型)。290 敌版同 EU=100、
      //  timeLeft SetDefaults 100 发射点 Modifier 直写 300(290 案定谳),本 294 无
      //  覆写位,json 即终值。
    } else if (this.projId === 295) {
      // ---- ★R28 §2 地狱火叉弹体（aiStyle50 295 支 :28760-28769）----
      // 本体隐形(alpha255);视觉 = 每 update 8×d174 尘焰包裹(noGravity,alpha100,
      // scale1.2,v×0.5+弹速×0.1)——滚动火团观感
      for (let i = 0; i < 8; i++) {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 174,
          0, 0, 100, null, 1.2, true);
        if (d) { d.vx *= 0.5; d.vy *= 0.5; d.vx += this.vx * 0.1; d.vy += this.vy * 0.1; }
      }
    } else if (this.projId === 296) {
      // ---- ★R28 §2 地狱火叉爆区（aiStyle50 296 支 :28772-28800）----
      // Item74 点火吼一次(localAI[0]==0 门);ai[0]+=4/update（自增 1+type 加成 3）,
      // >540 Kill ≈135t 存续;每 update ~18×d174 火焰柱（中心±10 出生、随机向速度
      // 3..8 归一外发、scale1.5,noGravity,alpha100）。150×150 盒对盒内敌持续结算
      // 由通用命中环承载(pierce −1 全局 immune 冷却再命中)
      if (!this.if296Sounded) {
        this.if296Sounded = true;
        game.playSfxFiles?.(['Item_74'], 1, this.cx, this.cy);
      }
      this.if296Ai0 += 4;
      if (this.if296Ai0 > 540) { this.killNow(game); return; }   //（:28778-28791）
      for (let i = 0; i < 17.5; i++) {                            // num361=25×0.7=17.5 → 18 圈
        const ax = Math.floor(Math.random() * 21) - 10;
        const ay = Math.floor(Math.random() * 21) - 10;
        const al = Math.sqrt(ax * ax + ay * ay);
        if (al <= 0) continue;
        const ratio = (3 + Math.floor(Math.random() * 6)) / al;   // Next(3,9)=3..8 归一外发
        const px = this.cx + Math.floor(Math.random() * 21) - 10;
        const py = this.cy + Math.floor(Math.random() * 21) - 10;
        game.spawnDust?.(px - 1, py - 1, 2, 2, 174, ax * ratio, ay * ratio, 100, null, 1.5, true);
      }
    } else if (this.projId >= 511 && this.projId <= 513) {
      // ---- ★R28 §10 毒云泡（aiStyle92 flag45 支 :33144-33245,3105 毒液瓶 Kill 链）----
      // ai[0]>260 Kill;不透明度包络 Remap(t,0,.3,0,1)×Remap(t,.3,1,1,0)×0.7
      // （:33196-33198——涌出后消散）;rotation=出生相位+t×2π/480（whoAmI 相位项以
      // 出生掷近似 :33192-33194）;velocity ×0.96/update。伤害面 = 组共享 IDStatic
      // 免疫（ctor idStaticGroup=511,10t 同敌再结算）
      this.cloudT++;
      if (this.cloudT > 260) { this.killNow(game); return; }     //（:33168-33177）
      const t260 = this.cloudT / 260;
      const opacity = Math.min(1, t260 / 0.3)
        * Math.max(0, Math.min(1, (1 - t260) / 0.7)) * 0.7;
      this.alpha = Math.round(255 - opacity * 255);              // 引擎 alpha 反相语义
      this.spinRot = this.cloudPhase + this.cloudT * (Math.PI * 2) / 480;
      this.vx *= 0.96; this.vy *= 0.96;
      // ★2026-08-31 台账清偿：云间互斥推挤（flag45 群体运动学,P.cs:33225-33257——
      //   两版同段）对桶内其它活跃 511-513 且盒相交的云逐对结算：push =
      //   SafeNormalize(他心−我心)×0.005;我方 velocity=Lerp(v,v−push,.6)=v−.6·push、
      //   对方 Lerp(v,v+push,.6)=v+.6·push【本扫描内直写对方】——原版每云独立循环,
      //   同拍两向各算一次=每弹净推 ×2,照原文承载。重合零向量按 num797<whoAmI 定向
      //   （:33237-33243）;原版扫 Main.projectile[1000],本仓桶扫描等价。旋转相位项仍以
      //   出生掷近似（whoAmI×0.4002029f 与实例序分布等价,保持不动）
      const bucketC = (game as unknown as { projectiles?: () => unknown[] }).projectiles?.();
      if (bucketC) {
        for (const rawC of bucketC) {
          if (rawC === this || !(rawC instanceof Arrow)) continue;
          const oC = rawC;
          if (oC.dead || oC.projId < 511 || oC.projId > 513) continue;
          if (oC.x >= this.x + this.w || oC.x + oC.w <= this.x
            || oC.y >= this.y + this.h || oC.y + oC.h <= this.y) continue;   // 盒不相交(XNA Intersects 同严格界)
          let dxc = oC.cx - this.cx;
          let dyc = oC.cy - this.cy;
          if (dxc === 0 && dyc === 0) {                       // 重合：按 whoAmI 序断向
            if (oC.cloudWho < this.cloudWho) { dxc = -1; dyc = 1; }
            else { dxc = 1; dyc = -1; }
          }
          const dlC = Math.hypot(dxc, dyc) || 1;              // SafeNormalize(UnitX) 兜底
          const pxC = (dxc / dlC) * 0.005, pyC = (dyc / dlC) * 0.005;
          this.vx -= pxC * 0.6; this.vy -= pyC * 0.6;
          oC.vx += pxC * 0.6; oC.vy += pyC * 0.6;
        }
      }
    } else if (this.projId === 337) {
      // ---- ★R28 §9 暴雪雪片（AI_001 337 支 :57920-57933,1931 暴雪法杖）----
      // 动态穿墙门:低于玩家(y>player.y−300)或高于地表线(<worldSurface×16)才开
      // tileCollide（高空穿墙、接近目标高度恢复撞墙）;帧恒 ai[1]（ctor 掷 pinFrame,
      // draw fIdx 链消费）;1/2 掷 d197 雪尘(v×0.5,noGravity)
      const p337 = game.player;
      if (this.y > p337.y - 300 || this.y < (game.world.groundLevel || 0) * TILE) {
        this.noTileCollide = false;
      }
      if (Math.random() < 0.5) {
        const d337 = game.spawnDust?.(this.x, this.y, this.w, this.h, 197,
          0, 0, 0, null, 1, true);
        if (d337) { d337.vx *= 0.5; d337.vy *= 0.5; }
      }
    } else if (this.projId === 409) {
      // ---- 409 剃刀台风（aiStyle 71，Projectile.cs:30848-30951，2622 剃刀台风）----
      // ⓪ ★BJ371 节拍块（:30849-30882——本段先于锁敌,每 AI 子步 1 拍;
      //    extraUpdates=2 → 3 子步/帧,1/3 掷 ≈ 1 触发/帧）：
      //    localAI[1]>10 且 rand(3)==0 →
      //    a. 6× d217 缘尘（:30853-30871——spinningpoint=normalize(v)×(w,h)/2
      //      【Vector2×Vector2 分量乘】RotatedBy((i−2)×π/6)+Center;vector49=
      //      角(−π/2..π/2)×rand(3,8);NewDust(pos+vector49,0,0,217,v×2,100,
      //      scale1.4)+noGravity+noLight+velocity=v/4−proj.v）;
      //    b. alpha −5 钳 50（:30872-30877——GetAlpha 409 恒 (250,250,250,200)
      //      :81148-81151 不读 α,此面=台账值非绘制面）;
      //    c. rotation += velocity.X×0.1f（:30878——自旋,draw 侧 spinRot 消费）;
      //    d. frame=(int)(localAI[1]/3f)%3（:30879——3 帧 68×68 竖条带,projFrames
      //      [409]=3 Main.cs:8663）;
      //    e. Lighting.AddLight(0.1,0.4,0.6)（:30881——lightRGB 自报通道）。
      this.ty409L1++;
      if (this.ty409L1 > 10 && Math.floor(Math.random() * 3) === 0) {
        const nrm409 = Math.hypot(this.vx, this.vy) || 1;
        for (let i = 0; i < 6; i++) {
          const bx409 = (this.vx / nrm409) * (this.w / 2);        // 分量乘（w,h)/2
          const by409 = (this.vy / nrm409) * (this.h / 2);
          const ra409 = (i - 2) * Math.PI / 6;                    // (i−(6/2−1))×π/6
          const rx409 = bx409 * Math.cos(ra409) - by409 * Math.sin(ra409);
          const ry409 = bx409 * Math.sin(ra409) + by409 * Math.cos(ra409);
          const va409 = Math.random() * Math.PI - Math.PI / 2;    // NextDouble×π−π/2
          const vl409 = 3 + Math.floor(Math.random() * 5);        // Next(3,8)=3..7
          const wx409 = Math.cos(va409) * vl409;
          const wy409 = Math.sin(va409) * vl409;
          const d409 = game.spawnDust?.(this.cx + rx409 + wx409, this.cy + ry409 + wy409,
            0, 0, 217, wx409 * 2, wy409 * 2, 100, null, 1.4, true);
          if (d409) {
            d409.noLight = true;
            d409.vx = d409.vx / 4 - this.vx;                      // velocity /=4 −= proj.v
            d409.vy = d409.vy / 4 - this.vy;
          }
        }
        this.alpha = Math.max(50, this.alpha - 5);                // :30872-30877
        this.spinRot += this.vx * 0.1;                            // :30878
        this.ty409Frame = Math.floor(this.ty409L1 / 3) % 3;       // :30879
        this.lightRGB = [0.1, 0.4, 0.6];                          // :30881
      }
      // ① 一次性锁敌（ai[0]==0 且 localAI[0]==0，:30883-30906）：500 欧氏 +
      //   CanHit 全盒最近敌 → ai[0]=敌+1；无目标 → localAI[0]=30（30 update 后再掷）；
      // ② 保持（:30912-30931）：目标 active+!dontTakeDamage+immune[owner]==0 且
      //   1000 曼哈顿内 → 追踪；失效/超距 → ai[0]=0（等冷却重锁）；
      // ③ 转向（:30933-30947）：角差 wrap 后 ×0.1 旋转（rotateTowards 档）；
      // ④ 速度 +0.0025/update 无帽（:30949-30951）。
      if (this.ty409Cd > 0) this.ty409Cd--;
      if (this.ty409Ai0 === 0 && this.ty409Cd === 0) {
        let best409 = 500;
        let bestId409 = 0;
        for (const ent of game.enemies()) {
          const e = ent as unknown as { id: number; x: number; y: number; w: number; h: number; dead?: boolean; iframes?: number };
          if (e.dead) continue;
          if (!canBeChasedBy(ent)) continue;      // CanBeChasedBy
          const d409 = Math.hypot(e.x + e.w / 2 - this.cx, e.y + e.h / 2 - this.cy);
          if (d409 >= best409) continue;
          if (!canHitLine(world.store, this.x, this.y, this.w, this.h, e.x, e.y, e.w, e.h)) continue;
          best409 = d409;
          bestId409 = e.id;
        }
        if (bestId409 !== 0) this.ty409Ai0 = bestId409;
        else this.ty409Cd = 30;                    //（:30907-30910）
      }
      let steer409 = false;
      let tx409 = 0, ty409 = 0;
      if (this.ty409Ai0 !== 0) {
        const t409 = (game.enemies() as Array<{ id: number; x: number; y: number; w: number; h: number; dead?: boolean; iframes?: number; dontTakeDamage?: boolean }>)
          .find((e) => e.id === this.ty409Ai0);
        //（:30912-30931）active + !dontTakeDamage + immune[owner]==0 + 1000px 曼哈顿
        if (t409 && !t409.dead && !t409.dontTakeDamage && !((t409.iframes ?? 0) > 0)
          && Math.abs(this.cx - (t409.x + t409.w / 2)) + Math.abs(this.cy - (t409.y + t409.h / 2)) < 1000) {
          steer409 = true;
          tx409 = t409.x + t409.w / 2; ty409 = t409.y + t409.h / 2;
        } else {
          this.ty409Ai0 = 0;                       //（:30925-30929 失效清锁等冷却）
        }
      }
      if (steer409) {
        const want409 = Math.atan2(ty409 - this.cy, tx409 - this.cx);
        const cur409 = Math.atan2(this.vy, this.vx);
        let diff409 = want409 - cur409;
        while (diff409 > Math.PI) diff409 -= Math.PI * 2;   //（:30937-30941 wrap）
        while (diff409 < -Math.PI) diff409 += Math.PI * 2;
        const na409 = cur409 + diff409 * 0.1;               //（:30947 RotatedBy(diff×0.1)）
        const sp409 = Math.hypot(this.vx, this.vy);
        this.vx = Math.cos(na409) * sp409;
        this.vy = Math.sin(na409) * sp409;
      }
      {
        const sp409b = Math.hypot(this.vx, this.vy);        //（:30949-30951 速度爬升无帽）
        if (sp409b > 0) {
          this.vx = (this.vx / sp409b) * (sp409b + 0.0025);
          this.vy = (this.vy / sp409b) * (sp409b + 0.0025);
        }
      }
    } else if (this.projId === 451) {
      // ---- 451 涌流剑（aiStyle 81，Projectile.cs:31541-31760，2880 涌流剑）----
      // num645=penetrate(3)、num647=max(1,|v|/11)。三态：
      // ① ai[0]==0 飞行（:31574-31640）：7 update 后 alpha 0↔75 脉动（scale ±0.01
      //   同步）；② [1,1+pen) 命中/撞块淡出（:31642-31690）：tileCollide=false、
      //   alpha += 15×num647、v ×= 0.98/num647、≤250 无视线最近敌骑乘
      //   （position += npc.velocity :31682）；alpha≥255 → ai[0]==1 Kill /
      //   有目标 → 瞬移至目标周围 100px 随机点 + v=归一(目标−新位)×15 +
      //   ai[0] += pen（:31661-31681）/ 无目标 Kill；③ [1+pen,1+2pen) 末段
      //   （:31691-31725）：scale 0.9、前 15 update alpha −125 + v×0.98（可伤门
      //   :12463 ai[1]<5 豁免）、之后 alpha += 51 + v×0.8 至 255 Kill。
      // 命中钩（Damage :14115-14121）：ai[0]==0 → += pen，否则 −= pen+1；ai[1]=0。
      // 撞块钩（:18222-18227）：ai[0]=1、ai[1]=0、v = lastVelocity/2。
      const sp451 = Math.hypot(this.vx, this.vy);
      const num647 = Math.max(1, sp451 / 11);
      const pen451 = Math.max(1, this.pierceInit);
      if (this.iwAi0 === 0) {
        this.iwL0++;
        if (this.iwL0 > Math.min(7, 7 * num647)) {          //（:31616 num664）
          if (this.iwL1 === 0) {
            this.drawScale -= 0.01;                          //（:31621 num660）
            this.alpha += 5;                                 //（:31622 num661）
            if (this.alpha > 75) { this.alpha = 75; this.iwL1 = 1; }   //（:31623-31626）
          } else {
            this.drawScale += 0.01;                          //（:31631）
            this.alpha -= 5;
            if (this.alpha <= 0) { this.alpha = 0; this.iwL1 = 0; }    //（:31633-31636）
          }
        }
      } else if (this.iwAi0 >= 1 && this.iwAi0 < 1 + pen451) {
        this.noTileCollide = true;                           //（:31643）
        this.alpha += 15 * num647;                           //（:31645 num665）
        this.vx *= 0.98 / num647;                            //（:31646 num666）
        this.vy *= 0.98 / num647;
        this.iwL0 = 0;                                       //（:31647）
        this.iwSeek451(game, 250);
        if (this.alpha >= 255) {
          this.alpha = 255;
          if (this.iwAi0 === 1) { this.killNow(game); return; }        //（:31667-31669）
          if (this.iwRide) {
            // 瞬移至目标周围 100px 随机点 + 重射（:31671-31679）
            const t451 = this.iwRideTarget;
            if (t451) {
              const a451 = Math.random() * Math.PI * 2;
              this.x = t451.cx + Math.cos(a451) * 100 - this.w / 2;
              this.y = t451.cy + Math.sin(a451) * 100 - this.h / 2;
              const dx451 = t451.cx - this.cx, dy451 = t451.cy - this.cy;
              const dl451 = Math.hypot(dx451, dy451) || 1;
              this.vx = (dx451 / dl451) * 15;
              this.vy = (dy451 / dl451) * 15;
              this.iwAi0 += pen451;                          //（:31678）
              this.iwRide = null;
            } else {
              this.killNow(game); return;
            }
          } else {
            this.killNow(game); return;                      //（:31682-31684 无目标）
          }
        }
      } else if (this.iwAi0 >= 1 + pen451 && this.iwAi0 < 1 + 2 * pen451) {
        this.drawScale = 0.9;                                //（:31693）
        this.noTileCollide = true;                           //（:31694）
        this.iwAi1++;                                        //（:31696）
        if (this.iwAi1 >= 15) {                              //（:31697）
          this.alpha += 51;                                  //（:31698）
          this.vx *= 0.8; this.vy *= 0.8;                    //（:31699）
          if (this.alpha >= 255) { this.killNow(game); return; }       //（:31700-31702）
        } else {
          this.alpha -= 125;                                 //（:31704）
          if (this.alpha < 0) this.alpha = 0;
          this.vx *= 0.98; this.vy *= 0.98;                  //（:31706）
        }
        this.iwSeek451(game, 250);                           //（:31707-31725 骑乘）
      }
    } else if (this.naParent) {
      // ---- 618 星璇火花（aiStyle 119，Projectile.cs:35458-35540，617 伴生）----
      // 隐形伤弹（alpha 恒 255 :35533）：①父亡即 Kill（:35475-35478 proj4==null →
      // ai[0]=420 + Kill）；②骑乘（:35483-35486 position += proj4.position −
      // proj4.oldPos[1]——★oldPos[1] = 父 2 update 前位（TrailingMode[617]==0 缺省
      // 环滚 :17199-17203 每拍写）→ 骑乘 delta = 父【2 拍】位移,非 1 拍;守卫
      // `oldPos[1] != Zero`（:35482）对已年长父弹恒真 → 子弹首拍即骑）；③速度向父
      // 符号步进 ±0.15/轴、|v|>6 归一 6（:35490-35495）；④ai[0] ≥ 420 停骑乘
      // （:35479-35481 直飞到 timeLeft 420 自然亡）；⑤★BJ348 尾迹尘 d86 1/2 掷
      // （:35517-35528，vel=弹速/noGravity/scale 1.5——可见面全靠此尘）。
      this.naAi0++;
      const parent = this.naParent;
      if (parent.dead) { this.killNow(game); return; }       //（:35475-35478）
      if (this.naAi0 < 420) {
        this.x += parent.cx - this.naPrevPX;                 //（:35483-35486 骑乘,2 拍 delta）
        this.y += parent.cy - this.naPrevPY;
        this.vx += Math.sign(parent.cx - this.cx) * 0.15;    //（:35490-35492）
        this.vy += Math.sign(parent.cy - this.cy) * 0.15;
        const s618 = Math.hypot(this.vx, this.vy);
        if (s618 > 6) { this.vx *= 6 / s618; this.vy *= 6 / s618; }   //（:35493-35495）
      }
      this.naPrevPX = this.naLastPX; this.naPrevPY = this.naLastPY;
      this.naLastPX = parent.cx;
      this.naLastPY = parent.cy;
      // ★BJ348 尘尾（:35517-35528）：1/2 掷 → d86 弹心（NewDust 后 position=Center 钉心、
      //   velocity=弹速、noGravity、scale 1.5、customData=父球）——原版本体 α≡255 全隐
      //   （GetAlpha 缺省路径 A=0），**可见面全靠此尘尾**（用户实报"射弹从球体中生成"的
      //   视觉承载）。★2026-09-28 随动补式：customData=父球 → d86 骑父球本拍位移
      //   （Dust.cs:571-581 customData=Projectile → position+=父位移,active 门）,
      //   followEnt 闭包承载（父死 → 零位移）。
      // ★★2026-09-28 streak 成形修复（本刃定谳）：原版在 NewDust 后【整体覆写】
      //   dust.velocity = 弹速（:35521）与 dust.scale = 1.5f（:35524）——NewDust 自带的
      //   ±0.2/轴速度抖动与 ×0.8..1.2 scale 抖动被原版逐字抹除;本仓旧版把弹速经
      //   spawn 形参传入（NewDust 语义 speed+jitter）→ 尘速 = 弹速±2/轴、scale 1.2..1.8。
      //   弹速 ~6 时 ±2/轴 = ±26° 方向弥散 ×~65px 尘程 → 相邻拖尾链横向散开 ~40px,
      //   12px 间距链断成弥散射斑 = 用户实报"粉色小射弹不成形"的第一因。修复 = 落尘后
      //   精确覆写 velocity/scale（对齐原版覆写序）——streak 判据（拖尾链）自此成立。
      if (Math.random() < 0.5) {
        const d618 = game.spawnDust?.(this.cx - 4, this.cy - 4, 8, 8, 86,
          this.vx, this.vy, 0, null, 1.5, true);
        if (d618) {
          d618.x = this.cx; d618.y = this.cy;                //（:35520 position=Center 覆写）
          d618.vx = this.vx; d618.vy = this.vy;              //（:35521 velocity=弹速 覆写,杀 ±2 抖动）
          d618.scale = 1.5;                                  //（:35524 scale=1.5 覆写,杀 ×0.8..1.2）
          d618.followEnt = () => parent.dead
            ? { dx: 0, dy: 0 }
            : { dx: parent.x - (parent.oldX ?? parent.x), dy: parent.y - (parent.oldY ?? parent.y) };
        }
      }
      this.alpha = 255;                                      //（:35533 恒隐身）
    } else if (this.projId === 617) {
      // ---- 617 星璇秘术（aiStyle 118，Projectile.cs:35283-35455，3476 星璇秘术）----
      // 两段：①快速段（|v|>4）：ai[0]≥30 起 v×0.98 + scale→1.3，|v|<4.1 归一 4 并
      //   ai[0] 清零（:35345-35352）；②慢速段（|v|≤4）：每 30 update（<241）掷一枚
      //   618 隐形火花（随机向×12、伤 = 本弹/2 int 截断 :35379-35383）+ 锁敌追踪
      //   （800 欧氏 + CanHit 盒心锁 ai[1]、<1000 保持、v=(v×7+dir×4)/8
      //   :35386-35441）+ ai[0]≥600 Kill（:35453-35455）。alpha −15/t 渐显。
      this.na617Ai0++;
      if (this.alpha > 0) this.alpha = Math.max(0, this.alpha - 15);
      // ★R28 环绕尘带（:35293-35342 快速段 1/3 掷 / :35345-35372 慢速段每拍一组）：
      //   半数 d86|d90 Crimson 切向环绕（pos=心−UnitY.rot 随机×10~21、v=切向×6）、
      //   半数 d240 外环 ×30（v=反切向×3）。★2026-09-28 随动补式：customData=本体
      //   （:35310/:35322/:35368-35377）→ followEnt 骑本拍位移（Dust.cs:571-581）,
      //   尘晕贴球飞行（原版 halo 语义,曾"未接"致光晕沿径拖尾=用户实报观感差）。
      {
        const unit617 = (): [number, number] => {
          const a = Math.random() * Math.PI * 2;             // UnitY.RotatedByRandom(2π)
          return [-Math.sin(a), Math.cos(a)];
        };
        const ride617 = (): { dx: number; dy: number } => this.dead
          ? { dx: 0, dy: 0 }                                 //（:573 `if (projectile.active)` 门）
          : {
              dx: this.x - (this.oldX ?? this.x),
              dy: this.y - (this.oldY ?? this.y),
            };
        if (Math.hypot(this.vx, this.vy) > 4) {
          if (Math.floor(Math.random() * 3) === 0) {
            const [ux, uy] = unit617();
            // ★2026-09-28 streak 成形修复（同 618 尾尘）：原版 NewDust 后逐字段覆写
            //   position（=心−向×10..21/×30,精确无 NewDust 的 +4 系统偏移）、velocity
            //   （切向/反切向×6|3,杀 ±2/轴抖动）、scale（0.5+rand,杀 ×0.8..1.2）
            //   （:35304-35312 / :35313-35321）——旧版经 spawn 形参传入 = 三抖动全保
            //   留 → 环绕晕链散焦。修复 = 落尘后精确覆写（对齐原版覆写序）。
            if (Math.random() < 0.5) {
              const r617a = 10 + Math.random() * 11;           // rand(10..21)
              const d617a = game.spawnDust?.(this.cx - ux * r617a - 4,
                this.cy - uy * r617a - 4, 1, 1,
                Math.random() < 0.5 ? 86 : 90,
                -uy * 6, ux * 6, 0, null, 0.5 + Math.random(), true);   // 切向 = rot(+π/2)
              if (d617a) {
                d617a.x = this.cx - ux * r617a; d617a.y = this.cy - uy * r617a;   //（:35307 覆写）
                d617a.vx = -uy * 6; d617a.vy = ux * 6;         //（:35308 velocity 覆写,杀 ±2 抖动）
                d617a.scale = 0.5 + Math.random();             //（:35309 scale 覆写,杀 ×0.8..1.2）
                d617a.fadeIn = 0.5; d617a.followEnt = ride617;
              }
            } else {
              const d617b = game.spawnDust?.(this.cx - ux * 30 - 4, this.cy - uy * 30 - 4,
                1, 1, 240, uy * 3, -ux * 3, 0, null, 0.5 + Math.random(), true);
              if (d617b) {
                d617b.x = this.cx - ux * 30; d617b.y = this.cy - uy * 30;   //（:35318 覆写）
                d617b.vx = uy * 3; d617b.vy = -ux * 3;         //（:35319 反切向覆写）
                d617b.scale = 0.5 + Math.random();             //（:35320 覆写）
                d617b.fadeIn = 0.5; d617b.followEnt = ride617;
              }
            }
          }
        } else {
          // 慢速段（:35363-35372）★BJ348b 修正：每拍必发、单次 Next(2) 二选一——
          // if 支 = d86+d90(Crimson) 切向环绕一组（×10..21、切向×6）、else 支 =
          // d240 外环（×20..31、反切向×5）。旧版双重病：①240 并进 if 支三枚齐发、
          // ②外层再套 1/2 发尘门（50% 拍全无尘）——原版 for(1) 循环体每拍执行
          const s617s = 0.9 + Math.random();
          if (Math.floor(Math.random() * 2) === 0) {
            {
              const [uxa, uya] = unit617();
              const ra617s = 10 + Math.random() * 11;
              const da = game.spawnDust?.(this.cx - uxa * ra617s - 4,
                this.cy - uya * ra617s - 4, 1, 1, 86,
                -uya * 6, uxa * 6, 0, null, s617s, true);
              if (da) {
                da.x = this.cx - uxa * ra617s; da.y = this.cy - uya * ra617s;   //（:35368 覆写）
                da.vx = -uya * 6; da.vy = uxa * 6;         //（:35369 velocity 覆写,杀 ±2 抖动）
                da.scale = s617s;                          //（:35370 scale 覆写,杀 ×0.8..1.2）
                da.fadeIn = 0.5; da.followEnt = ride617;
              }
            }
            {
              const [uxb, uyb] = unit617();
              const rb617s = 10 + Math.random() * 11;
              const db = game.spawnDust?.(this.cx - uxb * rb617s - 4,
                this.cy - uyb * rb617s - 4, 1, 1, 90,
                -uyb * 6, uxb * 6, 0, { r: 220, g: 20, b: 60, a: 255 }, s617s, true);
              if (db) {
                db.x = this.cx - uxb * rb617s; db.y = this.cy - uyb * rb617s;   //（:35373 覆写）
                db.vx = -uyb * 6; db.vy = uxb * 6;         //（:35374 覆写）
                db.scale = s617s;                          //（:35375 覆写）
                db.fadeIn = 0.5; db.followEnt = ride617;
              }
            }
          } else {
            const [uxc, uyc] = unit617();
            const rc617s = 20 + Math.random() * 11;
            const dc = game.spawnDust?.(this.cx - uxc * rc617s - 4,
              this.cy - uyc * rc617s - 4, 1, 1, 240,
              uyc * 5, -uxc * 5, 0, null, s617s, true);
            if (dc) {
              dc.x = this.cx - uxc * rc617s; dc.y = this.cy - uyc * rc617s;   //（:35377 覆写）
              dc.vx = uyc * 5; dc.vy = -uxc * 5;           //（:35378 反切向覆写）
              dc.scale = s617s;                            //（覆写）
              dc.fadeIn = 0.5; dc.followEnt = ride617;
            }
          }
        }
      }
      if (Math.hypot(this.vx, this.vy) > 4) {
        if (this.na617Ai0 >= 30) {
          this.vx *= 0.98; this.vy *= 0.98;                  //（:35347-35348）
          this.drawScale = Math.min(1.3, this.drawScale + 0.0074468083);   //（:35349-35352）
        }
        const sp617 = Math.hypot(this.vx, this.vy);
        if (sp617 > 0 && sp617 < 4.1) {                      //（:35353-35357）
          this.vx = (this.vx / sp617) * 4;
          this.vy = (this.vy / sp617) * 4;
          this.na617Ai0 = 0;
        }
      } else {
        // 慢速段：618 掷骰（:35379-35383）
        if (this.na617Ai0 % 30 === 0 && this.na617Ai0 < 241) {
          const ents617 = (game as unknown as { entities?: { add?: (e: unknown, b: string) => void } }).entities;
          if (ents617?.add) {
            const a618 = Math.random() * Math.PI * 2;        // UnitY.RotatedByRandom(2π)
            const spark = new Arrow(this.cx, this.cy,
              -Math.sin(a618) * 12, Math.cos(a618) * 12,
              Math.max(1, Math.trunc(this.damage / 2)), 0, 618,
              { grav: 0, life: 420, pierce: -1 });
            // NewProjectile(Center.X,Center.Y) 居中语义（:10238-10239 position=(X−w/2,Y−h/2)）
            // → 618 盒(18×30)中心 = 父球心；旧码直传父心作左上 = +9/+15 恒偏
            spark.x -= spark.w / 2;
            spark.y -= spark.h / 2;
            spark.naParent = this;                           // ai[1] = ProjectileKey
            spark.naLastPX = this.cx;
            spark.naLastPY = this.cy;
            spark.naPrevPX = this.cx;                        // 骑乘 2 拍 delta 基准（oldPos[1] 语义）
            spark.naPrevPY = this.cy;
            spark.critChance = this.critChance;
            spark.armorPen = this.armorPen;
            ents617.add(spark, 'projectiles');
          }
        }
        // 锁敌追踪（:35386-35441）
        if (this.na617Ai1 === 0) {
          let best617 = 800;
          let bestId617 = 0;
          for (const ent of game.enemies()) {
            const e = ent as unknown as { id: number; x: number; y: number; w: number; h: number; dead?: boolean };
            if (e.dead) continue;
            if (!canBeChasedBy(ent)) continue;
            const d617 = Math.hypot(e.x + e.w / 2 - this.cx, e.y + e.h / 2 - this.cy);
            if (d617 >= best617) continue;
            if (!canHitLine(world.store, this.cx, this.cy, 0, 0, e.x + e.w / 2, e.y + e.h / 2, 0, 0)) continue;
            best617 = d617;
            bestId617 = e.id;
          }
          if (bestId617 !== 0) this.na617Ai1 = bestId617;    //（:35417-35427）
        }
        let steer617 = false;
        let tx617 = 0, ty617 = 0;
        if (this.na617Ai1 !== 0) {
          const t617 = (game.enemies() as Array<{ id: number; x: number; y: number; w: number; h: number; dead?: boolean }>)
            .find((e) => e.id === this.na617Ai1);
          //（:35429-35436）active + CanBeChasedBy(ignoreDontTakeDamage) + <1000 欧氏
          if (t617 && !t617.dead
            && Math.hypot(t617.x + t617.w / 2 - this.cx, t617.y + t617.h / 2 - this.cy) < 1000) {
            steer617 = true;
            tx617 = t617.x + t617.w / 2; ty617 = t617.y + t617.h / 2;
          } else {
            this.na617Ai1 = 0;                               // 失效清锁重搜
          }
        }
        if (steer617) {                                      //（:35443-35441 v=(v×7+dir×4)/8）
          const dx617 = tx617 - this.cx, dy617 = ty617 - this.cy;
          const dl617 = Math.hypot(dx617, dy617) || 1;
          this.vx = (this.vx * 7 + (dx617 / dl617) * 4) / 8;
          this.vy = (this.vy * 7 + (dy617 / dl617) * 4) / 8;
        }
        if (this.na617Ai0 >= 600) { this.killNow(game); return; }   //（:35453-35455）
      }
      // ★BJ348 粉色光晕点光（:35449-35451 `alpha<150 → AddLight(Center,0.7,0.2,0.6)`，
      //   switch 后/Kill 前序位）：α 渐显 17t 后恒亮——此前整缺 = 球体夜间/洞穴无光环
      this.lightRGB = this.alpha < 150 ? [0.7, 0.2, 0.6] : null;
    } else if (this.projId === 620) {
      // ---- 620 星云奥秘爆裂碎片（aiStyle 29 GemStaffs type 支 :38357-38387）----
      // 父球 Kill 掷出（:73622-73658）：ai[0]=尾迹尘色 86|90（ctor 侧 na620Dust 注入）、
      // ai[1] 计龄 >40t Kill（:38361-38363）；重力 0.2 钳 18 + X 阻力 ×0.98（:38364-38367）；
      // 尾迹 2+1 枚 ai[0] 色尘（:38368-38384，pos=(尘+心)/2 与 (尘+心×5)/6 双混）。本体
      // α≡255 → GetAlpha 缺省路径全隐（视觉=尘尾,618 同律）；Kill 尘爆在 killNow 618/620 支。
      this.na620Ai1++;
      if (this.na620Ai1 > 40) { this.killNow(game); return; }    //（:38361-38363）
      this.vy += 0.2;                                            //（:38364）
      if (this.vy > 18) this.vy = 18;                            //（:38365-38366）
      this.vx *= 0.98;                                           //（:38367）
      const fade620 = (60 - this.na620Ai1) / 60;                 // num4（:38360）
      for (let k620 = 0; k620 < 2; k620++) {
        const d620a = game.spawnDust?.(this.x, this.y, this.w, this.h, this.na620Dust,
          this.vx, this.vy, 50, null, 1.1, true);
        if (d620a) {                                             //（:38370-38374）
          d620a.x = (d620a.x + this.cx) / 2;
          d620a.y = (d620a.y + this.cy) / 2;
          d620a.vx *= 0.3; d620a.vy *= 0.3;
          d620a.scale *= fade620;
        }
      }
      {
        const d620b = game.spawnDust?.(this.x, this.y, this.w, this.h, this.na620Dust,
          this.vx, this.vy, 50, null, 0.6, true);
        if (d620b) {                                             //（:38375-38384）
          d620b.x = (d620b.x + this.cx * 5) / 6;
          d620b.y = (d620b.y + this.cy * 5) / 6;
          d620b.vx *= 0.1; d620b.vy *= 0.1;
          d620b.fadeIn = 0.9 * fade620;
          d620b.scale *= fade620;
        }
      }
    } else if (this.projId === 92) {
      // 92 坠星（aiStyle 5，Projectile.cs:24108-24112 命中线 + :24308-24318 可见面，圣箭
      // Kill 链）：无重力直飞（aiStyle5 无重力段）；弹顶越过 ai[1] 命中线才恢复撞块
      // （:24108-24112，SetDefaults tileCollide=false → 线上方穿墙）；
      // ★R1(T1,2026-09-02) 可见面全录（aiStyle5 `ai[1]==1||type==92` 支 :24308-24318）：
      // light 0.9（:24310）+ 1/10 尘 58 星屑尾（:24311-24315）+ 1/20 gore 16-17
      // （Next(16,18) 右开={16,17},v×0.2,
      // :24316-24318——本批补）；本体=GetAlpha :80999 恒 (255,255,255,0) 纯加算白
      // （GA case 92 + ADDITIVE_GLOW_PROJS 配对）；alpha 通用闪烁档 0↔200（:24182-24196）
      // 振而不入 GetAlpha=观感无闪烁；Item_9 星啸每 20-59t（:24133-24136）；
      // rotation += sign(vx)·(|vx|+|vy|)·0.01（PROJ_SPIN 表）
      if (this.y > this.starFallLine) this.noTileCollide = false;
      this.lightRGB = [0.72, 0.54, 0.9];   // light 0.9（:24310）× ProjLight :16416-16419 R×0.8/G×0.6/B=1(紫)——曾发白光
      if (Math.random() < 0.1) {
        game.spawnDust?.(this.x, this.y, this.w, this.h, 58,
          this.vx * 0.5, this.vy * 0.5, 150, null, 1.2);
      }
      if (Math.random() < 0.05) {
        // Gore.NewGore(position, velocity×0.2, Next(16,18)={16,17})（:24316-24318）
        GorePiece.newGore(16 + Math.floor(Math.random() * 2), this.cx, this.cy, this.vx * 0.2, this.vy * 0.2);
      }
      this.alpha += 25 * this.twinkleDir;
      if (this.alpha >= 200) { this.alpha = 200; this.twinkleDir = -1; }
      if (this.alpha <= 0) { this.alpha = 0; this.twinkleDir = 1; }
      if (--this.starSndCd <= 0) {
        this.starSndCd = 20 + Math.floor(Math.random() * 40);
        game.playSfxFiles?.(['Item_9'], 1, this.cx, this.cy);   // ★T4：原版 PlaySound 无音量参=缺省 1.0（:24133/AI_151 :22345）
      }
    } else if (this.projId === 485) {
      // 485 狱翼箭（AI_001 type 段，Projectile.cs:54826-54850）：v=(v×39+ai)/40
      // 逐拍向游移向量（ctor 掷定的 ai[0]/ai[1]）渐转（蝙蝠扇翅漂移感）；每拍
      // 火尘 6（noGravity、v×0.2、位置=(dust+Center)/2，:54830-54833）；帧推进
      // frameCounter≥2 推帧 5 帧循环（:54834-54843，2 拍/帧——曾走 age/5 恒 5 拍/帧）；
      // vx<0 镜像 + rotation=atan2(−vy,−vx)（:54844-54850）= PROJ_ROT_RIGHT draw 档
      this.vx = (this.vx * 39 + this.hwAiX) / 40;
      this.vy = (this.vy * 39 + this.hwAiY) / 40;
      const d485 = game.spawnDust?.(this.x, this.y, this.w, this.h, 6);
      if (d485) {
        d485.noGravity = true;
        d485.vx *= 0.2;
        d485.vy *= 0.2;
        d485.x = (d485.x + this.cx) / 2;
        d485.y = (d485.y + this.cy) / 2;
      }
      if (++this.hwFrameT >= 2) {
        this.hwFrameT = 0;
        this.hwFrame = (this.hwFrame + 1) % 5;
      }
    } else if (this.projId === 459) {
      // ---- ★BJ704-G10（件10,G2 登记债清偿）459 充能爆破炮弹 AI_001 专属块
      //      （Projectile.cs:55615-55656）——G2 判例「债单载体前提必须逐员亲读」
      //      后的余面落模。逐面：
      //  ① 帧机 frameCounter≥3 推帧 3 帧回卷（:55622-55631,projFrames=3 :8681;
      //    draw fIdx 459 支消费;ghost 帧锚恒 0=登记② 维持——repo 无通用逐帧字段）;
      //  ② scale=ai[1]（发射侧注入 0.7/1.0/1.3 三档蓄压 :67574,AI 侧 Clamp(0.7,1.6)
      //    :55632）+ 判定盒 width=height=(int)(22×scale) Center 锚定（:55634-55635
      //    ——draw drawScale/ghost bodyScale（环 end=(int)(scale×8)/step 端 :31068-
      //    31073）随档）;
      //  ③ ≥0.85 档 penetrate=maxPenetrate=−1（:55642-55646——1.0/1.3 档无限穿透;
      //    <0.85 档（0.7）不动 1）;
      //  ④ 尘 226（:55647-55655）：<0.85 档 Next(3)==0 才 1 粒、≥0.85 恒 1 粒——
      //    NewDust(盒,226,SpeedX=vx) 后置 position−=(3,3)/scale0.5/noGravity/
      //    velocity=v/3（覆写非除抖）/alpha=255−(int)(255×scale)（1.3 档=−76 原样
      //    直录,下游钳属 VDust 域）;
      //  ⑤ 点光 AddLight(0.4,0.85,0.9)（:55636——lightRGB 自报通道,94/1114 先例）。
      //  α−30（:55616-55620）【不建模】：GetAlpha 恒 (255,255,255,200) 不读 α
      //  （vanillaProjAlpha fixed 档）=零视觉面;且 ghost bodyAlpha=(255−α)/255
      //  通道依赖 α≡0（建模反引入残影误折）。spriteDirection=direction（:55621）
      //  已由 PROJ_ROT_RIGHT+PROJ_GHOST_MIRROR0 draw 档承载（G2 落）。
      this.ai1Scale459 = Math.min(1.6, Math.max(0.7, this.ai1Scale459));
      this.drawScale = this.ai1Scale459;                       // scale=ai[1]（:55633）
      const sz459 = Math.trunc(22 * this.ai1Scale459);         // (int)(22×scale)（:55634）
      const cx459 = this.cx, cy459 = this.cy;                  // Center 锚定（:55632/:55635）
      this.w = sz459; this.h = sz459;
      this.x = cx459 - this.w / 2; this.y = cy459 - this.h / 2;
      this.lightRGB = [0.4, 0.85, 0.9];                        // :55636
      if (this.ai1Scale459 >= 0.85) {
        this.pierce = -1; this.pierceInit = -1;                // :55642-55646（幂等直写）
      }
      if (++this.f459FrameT >= 3) {                            // :55622-55631
        this.f459FrameT = 0;
        this.f459Frame = (this.f459Frame + 1) % 3;
      }
      const n459 = this.ai1Scale459 < 0.85
        ? (Math.floor(Math.random() * 3) === 0 ? 1 : 0) : 1;   // num51（:55638-55646）
      for (let i459 = 0; i459 < n459; i459++) {
        const d459 = game.spawnDust?.(this.x, this.y, this.w, this.h, 226, this.vx, 0, 0);
        if (!d459) break;
        d459.x -= 3; d459.y -= 3;                              // position−=One×3（:55649）
        d459.scale = 0.5;                                      // :55650
        d459.noGravity = true;                                 // :55651
        d459.vx = this.vx / 3; d459.vy = this.vy / 3;          // velocity=v/3 覆写（:55652）
        d459.alpha = 255 - Math.trunc(255 * this.ai1Scale459); // :55653
      }
    } else if (this.flare) {
      // ---- 信号枪族（aiStyle 33，AI_033 Projectile.cs:27425-27498）----
      // ① alpha −50/t 渐显（:27428-27435，SetDefaults 255 :2523 → 5 拍全显）
      if (this.alpha > 0) this.alpha = Math.max(0, this.alpha - 50);
      // ② 尘尾（alpha<70 期每 update 一枚 :27444-27472）：型号按 FLARE_DUST 表
      //   （163→127 火花/1009→75 诅咒焰…），出生点 (x, y−2) 6×6、scale 1.6、
      //   noGravity、速度 = 弹速、位置/速度再沿姿态向量回退 1（拖在弹后）
      if (this.alpha < 70) {
        const n260 = 4;                                        // num260 = 4f（:27437）
        let fx = this.flareAi0, fy = this.flareAi1;
        if (fx === 0 && fy === 0) { fx = 1; fy = 0; }          // :27439-27441 零向量取 (1,0)
        const fl = Math.hypot(fx, fy) || 1;
        const ux = (fx / fl) * n260, uy = (fy / fl) * n260;    // 归一 ×4（:27442-27445）
        const dF = game.spawnDust?.(this.x, this.y - 2, 6, 6, FLARE_DUST[this.projId] ?? 127,
          this.vx, this.vy, 100, null, 1.6, true);
        if (dF) {
          dF.x -= ux; dF.y -= uy;
          dF.vx -= ux; dF.vy -= uy;
        }
      }
      // ③ 停驻/重力（:27474-27493）：localAI[0]==0 飞行档——ai 向量跟速度、
      //   localAI[1]≥30 后每拍 vy+0.09（自增后钳回 30 = 恒触发）；贴壁档——
      //   脱块回飞行（localAI[1]=30 立即续坠）+ damage=0（停驻弹不伤人）
      if (this.flareStuck === 0) {
        this.flareAi0 = this.vx;
        this.flareAi1 = this.vy;
        this.flareGravT++;
        if (this.flareGravT >= 30) {
          this.vy += 0.09;
          this.flareGravT = 30;
        }
      } else {
        if (!this.flareSolidOverlap(game)) {
          this.flareStuck = 0;
          this.flareGravT = 30;
        }
        this.damage = 0;
      }
      // ④ vy 钳 16（:27494-27496）
      if (this.vy > 16) this.vy = 16;
      // ⑤ rotation = atan2(ai1, ai0)+π/2（:27497，draw 侧消费 flareAi 向量）
    } else if (this.nail93) {
      // ---- 钉 514（aiStyle 93，AI_093 Projectile.cs:33425-33487）----
      // ① alpha −25/t 渐显（:33427-33434）+ vy 钳 18（:33435-33438）
      if (this.alpha > 0) this.alpha = Math.max(0, this.alpha - 25);
      if (this.vy > 18) this.vy = 18;
      if (this.nailAi0 === 0) {
        // ② 飞行档：ai[1]>20 后下垂（vy+0.1、vx×0.992，:33439-33448）；rotation
        //    恒跟速度（默认 atan2+π/2 draw 档即 :33447）
        this.nailAi1++;
        if (this.nailAi1 > 20) { this.vy += 0.1; this.vx *= 0.992; }
      } else if (this.nailAi0 === 1) {
        // ③ 撞块弹开档：tileCollide=false + 速度 ×0.6/t 衰减（:33450-33455），
        //    ai[1]>90 消亡（:33479-33486）
        this.noTileCollide = true;
        this.vx *= 0.6; this.vy *= 0.6;
        if (++this.nailAi1 > 90) { this.killNow(game); return; }
      } else {
        // ④ 刺入档（ai[0]<0）：钉心 = 敌心 − velocity（velocity 即刺入偏移向量，
        //    :33459-33463）；敌亡 → 脱刺随机 6 速弹出（:33464-33473）；偏移过长
        //    ×0.99 收敛（:33474-33477）；ai[1]>90 消亡（:33479-33486）
        this.noTileCollide = true;
        const eid = -this.nailAi0 - 1;
        const tgt = (game.enemies() as Array<{ id: number; dead: boolean; cx: number; cy: number; w: number; h: number }>)
          .find((e2) => e2.id === eid);
        if (!tgt || tgt.dead) {
          this.nailAi0 = 0;
          this.nailAi1 = 20;
          const aN = Math.random() * Math.PI * 2;   // Next(-100,101)² 归一 ×6 等价
          this.vx = Math.cos(aN) * 6;
          this.vy = Math.sin(aN) * 6;
        } else {
          if (Math.hypot(this.vx, this.vy) > (tgt.w + tgt.h) / 3) { this.vx *= 0.99; this.vy *= 0.99; }
          this.x = tgt.cx - this.vx - this.w / 2;
          this.y = tgt.cy - this.vy - this.h / 2;
          if (++this.nailAi1 > 90) { this.killNow(game); return; }
          // 刺入 DoT（Damage aiStyle93 段 :13368-13376 dmg×0.15 + :14060-14062
          // immune[owner]=1 隔拍再刺）；暴击链同通用弹
          if (++this.nailDotT >= 2) {
            this.nailDotT = 0;
            const rec = tgt as unknown as { hurt?: (...a: unknown[]) => boolean; iframes?: number };
            // 敌形窄化只声明了 cx/cy;x/y 兜底位可选读（运行期敌实体恒有 x/y）
            const tXY = tgt as unknown as { x?: number; y?: number };
            if (rec.hurt && !(tgt as unknown as { dead?: boolean }).dead) {
              // ★BJ497①（2026-10-04）掷率收编（514 双读者单源刀②）：DoT=Damage() 整段
              //  重入（aiStyle93 :13368-13376）,每 tick 独立掷=原版同构——旧 `||` 面把
              //  0.04 路由门误当 4% 平率+丢 owner 聚合。514 数据面 ranged（SetDefaults
              //  :5850;spawn 位=通用 ranged :17556 0.04 门,亲读）→ 命中拍动态。
              const critN = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
              const dN = Math.max(1, Math.trunc(this.damage * 0.15)) * (critN ? 2 : 1);
              // ★F3 接线（蓝队四轮）：刺入 DoT 每隔拍一击 = Damage() 整段重入
              // （aiStyle93 :13368-13376 + immune 写 1 档 :14060-14062 → 隔拍再刺面，
              // ★aiStyle93 双触面陷阱：这里每拍都是独立 Damage() pass ⇒ 焰爆石/
              // 拍击石双支（:13439-13446）随拍生效而非仅首击；360t 冷却天然节流）
              const snapBonusDot = projectileSnapStrikeBonus(game, this,
                tgt.cx ?? ((tXY.x ?? 0) + tgt.w / 2),
                tgt.cy ?? ((tXY.y ?? 0) + tgt.h / 2), tgt.id, {
                  victimBox: { w: tgt.w, h: tgt.h,
                    cx: tgt.cx ?? ((tXY.x ?? 0) + tgt.w / 2), cy: tgt.cy ?? ((tXY.y ?? 0) + tgt.h / 2) },
                  targeterBox: { x: this.x, y: this.y, w: this.w, h: this.h },
                });
              rec.hurt(applyBannerDamageDealt(game, rec, dN)
                + (snapBonusDot ? Math.trunc(snapBonusDot * (critN ? 2 : 1)) : 0),
                0, 0, game, this.settlePen, critN, 1, true);   // 音/飘值=StrikeNPC 单点
            }
          }
        }
      }
    } else if (this.projId === 246) {
      // 刺炮弹 246（AI_001 type 段 :58105-58114，刺炮发射器 1258）：alpha −20/t
      // 渐显（SetDefaults 255 :3296）+ ai[0]≥60 后 vy+0.15/t 下坠（age=ai[0]，
      // extraUpdates 1 → 2 子步/t 同 vanilla ai[0] 节奏）；Kill 爆炸+249 破片在
      // Game.onProjectileDeath 246 分支
      if (this.alpha > 0) this.alpha = Math.max(0, this.alpha - 20);
      if (this.age >= 60) this.vy += 0.15;
    } else if (this.projId === 311) {
      // 糖果玉米 311（AI_001 type 段 :58116-58132，糖果玉米步枪 1782）：alpha
      // −50/t 渐显（SetDefaults 255 :4041）+ ai[0]≥30 后 vy+0.5/t 下坠
      if (this.alpha > 0) this.alpha = Math.max(0, this.alpha - 50);
      if (this.age >= 30) this.vy += 0.5;
    } else if (this.projId === 1023) {
      // 1023 死亡细胞木桶（AI_001 :58143-58152，5460 链）：ai[0]>=6 → alpha=0；
      // ai[0]>=20 → ai[0]=30 钳 + vy+=0.25/子步（钳后 >=20 恒真=持续）。
      // 首拍 25×d31 出生尘爆（:56175-56194，爆心=Center+vel向×54（+y −4×Directions
      // 略），速度=vel 旋扰 ±0.195 ×(0.2+Remap(|v|,0..3→0..0.5))×3×rand，noGravity）
      if (this.age >= 6) this.alpha = 0;
      if (this.age >= 20) this.vy += 0.25;
      if (this.ai1Mirror === 0) {
        this.ai1Mirror = 1;
        // ★R1 逐参修正(:56178-56191):Remap 取【玩家速度】非弹速;尘速=vel×(0.2+
        // num81) 旋扰 ±0.195 + 玩家速度×0.25 再 ×3×rand;抖动=速度向【垂直】±10 线段;
        // fadeIn=0.1
        const p = game.player;
        const pvx = p?.vx ?? 0, pvy = p?.vy ?? 0;
        const pvl = Math.hypot(pvx, pvy);
        const remap = Math.min(0.5, (pvl / 3) * 0.5);          // Remap(|v|,0,3,0,0.5)
        const vl = Math.hypot(this.vx, this.vy);
        const ux = vl > 0 ? this.vx / vl : 0, uy = vl > 0 ? this.vy / vl : 0;
        const bx = this.cx + ux * 54, by = this.cy + uy * 54;
        const baseAng = Math.atan2(this.vy, this.vx);
        for (let i = 0; i < 25; i++) {
          const d = game.spawnDust?.(bx, by, 16, 8, 31, this.vx, this.vy, 50,
            null, 1 + Math.random() * 0.3, true);
          if (!d) continue;
          const ang = baseAng + (Math.random() - 0.5) * 0.39;  // RotatedByRandom(0.196)
          const sp = vl * (0.2 + remap) * Math.random() * 3;
          d.vx = Math.cos(ang) * sp + pvx * 0.25;
          d.vy = Math.sin(ang) * sp + pvy * 0.25;
          const off = (Math.random() - 0.5) * 20;              // NextFloatDirection ×10 线段
          d.x = bx + -uy * off; d.y = by + ux * off;           // 垂直于速度向
          d.fadeIn = 0.1;
        }
      }
    } else if (this.projId === 312) {
      // 312 南瓜灯（AI_001 :58153-58166，南瓜月 1784/1785）：ai[0]>=5 → alpha=0；
      // ai[0]>=20 → ai[0]=30 钳 + vy+=0.5/子步；恒光 AddLight(0.6,0.4,0.3)
      if (this.age >= 5) this.alpha = 0;
      if (this.age >= 20) this.vy += 0.5;
      game.addLightAt?.(this.cx, this.cy, 0.6, 0.4, 0.3);
    } else if (this.projId === 504 || this.projId === 954 || this.projId === 979) {
      // ---- ★BJ431 火花族（aiStyle 2 type==504||954||979 共支,Projectile.cs:23764-23803;
      //      1458 对该支零变更）——954 火花魔棒 3069 / 979 结霜魔棒 5147（3069+99 冰火把
      //      合成,Recipe.cs:6765-6770）/ 504 Spark（屠夫链锯 509 命中喷溅 :13219-13231,
      //      本仓发射面未接线=随支 dormant）。三型 SetDefaults 同构（10×10 aiStyle2
      //      α255 penetrate2 noEnchantmentVisuals;979 +coldDamage;504 melee+IDStatic
      //      免疫 10t）→ 弹体恒隐（AI :23766 每子步钉 255,GA case 共组=0）→ 可视本体
      //      =尘尾迹：
      //  ① alpha 每子步钉 255（:23766 原版 AI 直写）；
      //  ② sparkAi0++（vanilla ai[0]）>3 起掷尘（α150,NewDust 内建掷速）——504/954
      //    尘 6 火、979 尘 135 霜（:23787 三元式）。掷率梯（:23768-23785）：ai0≤10 →
      //    ai0×10% 线性爬升;11..20 → 100% 平台;>20 → trunc(100×(1−(ai0−20)/40)) 衰减,
      //    ai0−20≥40（=ai0≥60）Kill。
      //    尘后处理（:23788-23795）：position=(尘位+弹心)/2 向心聚拢 + noGravity +
      //    velocity×2 + scale×1.6 + velocity+=弹速（尘随弹前飞成尾迹）；
      //  ③ ai0≥20：vx×0.99 + vy+0.1 拖坠（:23798-23802）+ aiStyle2 尾 vy 钳 32
      //    （:23929-23932）。重力在本类 ctor 出生覆写 0（projGravSpec aiStyle2
      //    0.3 兜底=投掷族语义,见 ctor 注）。
      //  命中面：debuff 走 projStatus 表（954→OnFire24/979→Frostburn44/504→OnFire3(323)
      //  各 50% 双档 mut 因式分解）;ai[0] 快进在主环 504||954||979 支。
      //  未移植：windPhysics 风档（:23420-23423,本仓弹幕域全族未建模=登记债）与
      //  rotation 翻滚（:23470 ±(|vx|+|vy|)×0.03×dir——本体恒隐零消费面,不移植）。
      this.alpha = 255;
      this.sparkAi0++;
      if (this.sparkAi0 > 3) {
        let dustP = 100;                                        // num19（:23770）
        if (this.sparkAi0 > 20) {
          dustP = Math.trunc(100 * (1 - (this.sparkAi0 - 20) / 40));
          if (this.sparkAi0 - 20 >= 40) { this.killNow(game); return; }   //（:23776-23779）
        }
        if (this.sparkAi0 <= 10) dustP = Math.trunc(this.sparkAi0) * 10;  //（:23781-23784）
        if (Math.floor(Math.random() * 100) < dustP) {          //（:23785 Next(100)<num19）
          const dustT = this.projId === 979 ? 135 : 6;          //（:23787 三元式）
          const d954 = game.spawnDust?.(this.x, this.y, this.w, this.h, dustT, 0, 0, 150);
          if (d954) {
            d954.x = (d954.x + this.cx) / 2;                    //（:23788）
            d954.y = (d954.y + this.cy) / 2;
            d954.noGravity = true;                              //（:23789）
            d954.vx *= 2; d954.vy *= 2;                         //（:23790-91）
            d954.scale *= 1.6;                                  //（:23793）
            d954.vx += this.vx; d954.vy += this.vy;             //（:23795）
          }
        }
      }
      if (this.sparkAi0 >= 20) {                                //（:23798-23802）
        this.vx *= 0.99;
        this.vy += 0.1;
      }
      if (this.vy > 32) this.vy = 32;                           //（:23929-23932）
    }
    // ---- alpha 通道 AI 侧（修复4：Projectile.alpha 逐型衰减）----
    if (this.projId === 521) {
      // 521 水晶脉冲（aiStyle 29，Projectile.cs:25086-25100）：alpha −50/t 淡入；
      // 归零后每拍星尘 254×3 + 255×2（:25063-25085）
      if (this.alpha > 0) this.alpha = Math.max(0, this.alpha - 50);
      else {
        game.spawnParticles(this.cx, this.cy, '#B878E8', 3, 0.6, { life: 16, grav: 0 });
        game.spawnParticles(this.cx, this.cy, '#F0C8F8', 2, 0.2, { life: 14, grav: 0 });
      }
    } else if (this.projId === 639 || this.projId === 640) {
      // 639/640 月总箭（AI_001，Projectile.cs:56381-56401；1456 :52537-52550 同值）：
      // alpha −25/substep 淡入（SetDefaults α=255 :6881/:6902、639 MaxUpdates=2 → EU=2
      // → ×3 子步/帧）。★批五勘误：旧注 ":52999-53003 −55" 引到 Shimmer() 方法体（该处
      // 无 alpha 写），−55 系行号错锚伪值——1456/1457 两代均为 −25，按 1457 修。
      // （640 的 velocity==Zero 星芒支 :56403-56453 未移植——衍生体恒带母箭初速,登记）
      // ★Kill 消亡面批（2026-09-02）：640 并入本支渐显（否则衍生体 α=255 恒隐）；
      // 639 专属初态四槽快照（:56381-56386 localAI[0]/[1] 出生心、ai[0]/[1] 初速，
      // 零零门首拍写）→ Kill :74825 owner 侧 NewProjectile(640) 数据源
      if (this.alpha > 0) this.alpha = Math.max(0, this.alpha - 25);
      if (this.projId === 639 && this.moonArrowL0 === 0 && this.moonArrowL1 === 0) {
        this.moonArrowL0 = this.cx;
        this.moonArrowL1 = this.cy;
        this.moonArrowA0 = this.vx;
        this.moonArrowA1 = this.vy;
      }
    } else if (this.projId === 267 || this.projId === 477 || this.projId === 478 || this.projId === 479) {
      // ---- 267/477/478/479 镖族（AI_001 :58273-58345;477 alpha 门原引 :54412-54415
      //  已并入本支）:localAI[0]>3 → alpha=0（前 3 拍隐形——GetAlpha :76303-76308
      //  alpha≠0 返回 (0,0,0,0)）;ai[0]>=20 → ai[0]=20 钳 +（477 除外）vy+=0.075/子步
      //  微重力;479（owner 门→!hostile）ai[1]>=0 → penetrate=-1 母镖无限穿、ai[1]++
      //  >Next(5,30) → ai[1]=-1000 分裂 2-4 枚（dmg×0.9、向=norm(rand±100 向)+vel向×2
      //  再归一×速、子镖 ai[1]<0 → penetrate=1,NewProjectileModifiers.IchorDartUpdate
      //  Penetrate 由 pierce=1 承载）+每枚 5×d170 noGravity;478 ai[1]++>Next(5,20) →
      //  归零 + timeLeft>40 扣 20 + 放 480 诅咒火（dmg×0.8、kb×0.5,:58332-58343）
      if (this.age > 3) this.alpha = 0;
      // 微重力 vy+=0.075@20(:58281-58284,267/478/479)由 AI1_GRAV 表承载(projGravSpec
      // 访问,通用重力段消费)——本支曾手写一份=双份(arrow-gravity-parity 红);
      // 477 原版无此重力(表亦无键),普通箭亦无——勿在本支补写
      const ents4x = (game as unknown as { entities?: { add?: (e: unknown, b: string) => void } }).entities;
      if (this.projId === 479 && !this.hostile) {
        if (this.ai1Mirror >= 0) {
          this.pierce = -1;
          this.ai1Mirror++;
        } else if (this.pierce < 0) {
          this.pierce = 1;                                 // ★R1:分裂后母镖每拍回落 1(:58291-58294 else 支)
        }
        if (this.ai1Mirror > 5 + Math.floor(Math.random() * 25)) {          // Next(5,30)=[5,29]
          this.ai1Mirror = -1000;
          const v0 = Math.hypot(this.vx, this.vy);
          const nx0 = v0 > 0 ? this.vx / v0 : 0, ny0 = v0 > 0 ? this.vy / v0 : 0;
          let cnt = 2 + Math.floor(Math.random() * 2);                      // Next(2,4)=[2,3]
          if (Math.floor(Math.random() * 4) === 0) cnt++;                   // 1/4 → +1
          for (let i = 0; i < cnt && ents4x?.add; i++) {
            let dx = Math.floor(Math.random() * 201) - 100;
            let dy = Math.floor(Math.random() * 201) - 100;
            const dl = Math.hypot(dx, dy) || 1;
            dx = dx / dl + nx0 * 2; dy = dy / dl + ny0 * 2;
            const dl2 = Math.hypot(dx, dy) || 1;
            const sx = (dx / dl2) * v0, sy = (dy / dl2) * v0;
            const sub = new Arrow(this.cx, this.cy, sx, sy,
              Math.max(1, Math.trunc(this.damage * 0.9)), this.knockback, 479,
              { pierce: 1, grav: 0 });
            sub.ai1Mirror = -1000;                                          // 子镖不再分裂
            ents4x.add(sub, 'projectiles');
            for (let k = 0; k < 4; k++) {
              const zz = 0.4 + k * 0.075;
              game.spawnDust?.(this.cx + sx * zz * 1.5 - 1, this.cy + sy * zz * 1.5 - 1,
                2, 2, 170, sx * zz, sy * zz, 0, null, 1, true);
            }
            game.spawnDust?.(this.cx - 1, this.cy - 1, 2, 2, 170,
              -sx * 0.2, -sy * 0.2, 0, null, 1, true);
          }
        }
      }
      if (this.projId === 478 && !this.hostile) {
        this.ai1Mirror++;
        if (this.ai1Mirror > 5 + Math.floor(Math.random() * 15)) {          // Next(5,20)=[5,19]
          this.ai1Mirror = 0;
          if (this.life > 40) this.life -= 20;
          if (ents4x?.add) {
            ents4x.add(new Arrow(this.cx, this.cy, 0, 0,
              Math.max(1, Math.trunc(this.damage * 0.8)), this.knockback * 0.5, 480,
              { grav: 0 }), 'projectiles');
          }
        }
      }
    } else if (AI001_FADE_SPEEDK[this.projId] !== undefined) {
      // ---- ★2026-09-01 批五：AI_001 顶层 per-type fade（速度积分式族）----
      //  alpha −= (byte)(|velocity| × k)（:56631 242/438/462/592 ×0.9、:56849 638
      //  ×0.3）——(byte) 截断 → Math.trunc 直译。EU 型每帧 ×(EU+1) 子步（242/438/
      //  462/592 EU=7 → ×8；638 EU=5 → ×6）。R6：242 GetAlpha :81361 α<140 门
      //  （PROJ_ALPHA_MOD alphaLt 档消费）/ 438/462/592 :81107-:81123 (255,255,255,
      //  128)×(1−α/255)（fixedfade 档）/ 638 :81369 (255,255,255,100)×Opacity
      //  （fixedfade 档）——全读 α。302 同式 ×0.9 不入本支（Dart 载体已承载）。
      const k = AI001_FADE_SPEEDK[this.projId];
      if (this.alpha > 0) {
        this.alpha = Math.max(0, this.alpha - Math.trunc(Math.hypot(this.vx, this.vy) * k));
      }
    } else if (AI001_FADE_DELAYED[this.projId] !== undefined) {
      // 344 寒潮炮弹（:58043-58094）：localAI[1]>5 门后 α−50（本仓 age=子步计数
      // 1 基 ≡ localAI[1]）。GetAlpha :81181 num7=1−α/255（fixedfade 档消费）。
      const [rd, gate] = AI001_FADE_DELAYED[this.projId];
      if (this.age > gate) this.alpha = Math.max(0, this.alpha - rd);
    } else if (AI001_FADE_AGE2[this.projId] !== undefined) {
      // 711（:57591）：ai[0]≥2 门后 α−25（出生 2 update 起渐显）。
      // ★F6：686 死键已删（联机傀儡弹重建实为 Boomerang 载体 Game.ts netMakeProj
      // case1;686 真身=DD2BetsyFireball 专用类自绘,Arrow 路径无出生面）。
      const r2 = AI001_FADE_AGE2[this.projId];
      if (this.age >= 2) this.alpha = Math.max(0, this.alpha - r2);
    } else if (AI001_FADE_RATE[this.projId] !== undefined) {
      // ---- ★2026-09-01 批五：AI_001 顶层 per-type fade（恒率族，AI001_FADE_RATE
      //  键注释逐 id 标 P.cs 行号；R6 判定见 PROJ_ALPHA0 批五段）----
      // 357 脉冲矢拖尾（P.cs:57733-57748 同段先尘后 fade）：α<170 期每子步沿速度
      //  反向排 10 粒尘 206（间距 −v/10×i、尘 α=弹体 α、velocity×0、noGravity，
      //  后置钉位/清速=逐字覆写）。可见面全在尘——本体贴图原版即 1×1 全透明
      //  （Steam 1.4.5 Content Projectile_357.xnb 实解为 1×1 空图），尘 206 走
      //  GetAlpha (255,255,255,0) 预乘加法白光（Renderer A=0 加性通道消费）
      if (this.projId === 357 && this.alpha < 170) {
        for (let i = 0; i < 10; i++) {
          const tx = this.x - (this.vx / 10) * i, ty = this.y - (this.vy / 10) * i;
          const d = game.spawnDust?.(tx, ty, 1, 1, 206, 0, 0, this.alpha, null, 1, true);
          if (d) { d.x = tx; d.y = ty; d.vx = 0; d.vy = 0; }
        }
      }
      // ★SW-FX1 937 挥发凝胶尾尘（AI_001 per-type 段 :56018-56052）：α==0（渐显完成）
      //  后 1/3 子步掷尘 4（QueenSlime 凝胶色 lerp((0,160,255), lerp((200,200,200),
      //  (255,80,255),r1),r2) A=150、α50、scale1.2、vel×0.3 后 += 弹速×0.3、noGravity
      //  ——原文 noGravity 缺省 true,num72=0 盒不加宽）
      if (this.projId === 937 && this.alpha === 0 && Math.floor(Math.random() * 3) === 0) {
        const r1 = Math.random(), r2 = Math.random();
        const l1 = 200 + (255 - 200) * r1, g1 = 200 + (80 - 200) * r1, b1 = 200 + (255 - 200) * r1;
        const c937 = {
          r: Math.round(0 + (l1 - 0) * r2),
          g: Math.round(160 + (g1 - 160) * r2),
          b: Math.round(255 + (b1 - 255) * r2),
          a: 150,
        };
        const d937 = game.spawnDust?.(this.x, this.y, this.w, this.h, 4, 0, 0, 50, c937, 1.2, true);
        if (d937) {
          d937.vx = d937.vx * 0.3 + this.vx * 0.3;
          d937.vy = d937.vy * 0.3 + this.vy * 0.3;
        }
      }
      // ★NPC 弹幕尘站普查批（2026-09-16）：926 凝胶弹（AI_001 :56018-56045 与 937
      //  同支,fade 同段 −50——补 PROJ_ALPHA0/AI001_FADE_RATE 键后接同款 α==0 门尘）：
      //  1/3 掷 ×1×d4（史莱姆胶尘,QueenSlime 色 A=150,scale1.2,盒=position−(8,8)+
      //  弹速 加宽 16——num72=8）,vel×0.3 后 += 弹速×0.3,noGravity = 1/2 掷
      if (this.projId === 926 && this.alpha === 0 && Math.floor(Math.random() * 3) === 0) {
        const r1 = Math.random(), r2 = Math.random();
        const l1 = 200 + (255 - 200) * r1, g1 = 200 + (80 - 200) * r1, b1 = 200 + (255 - 200) * r1;
        const c926 = {
          r: Math.round(0 + (l1 - 0) * r2),
          g: Math.round(160 + (g1 - 160) * r2),
          b: Math.round(255 + (b1 - 255) * r2),
          a: 150,
        };
        const d926 = game.spawnDust?.(this.x - 8 + this.vx, this.y - 8 + this.vy,
          this.w + 16, this.h + 16, 4, 0, 0, 50, c926, 1.2, Math.floor(Math.random() * 2) === 0);
        if (d926) {
          d926.vx = d926.vx * 0.3 + this.vx * 0.3;
          d926.vy = d926.vy * 0.3 + this.vy * 0.3;
        }
      }
      this.alpha = Math.max(0, this.alpha - AI001_FADE_RATE[this.projId]);
      // ---- ★2026-09-02 观感面缺口批（同表键的配套尘/消亡段,原位次=fade 后）----
      // 710 空中祸害（:56348-56380）：1/4 子步掷——1/2 再掷 d31 烟（α100,scale1.6,
      // noGravity）+ 恒 d6 火（α100,scale1.2,noGravity,尘速×2 后 += 弹速、
      // fadeIn=ai[1]==-1 ? 1.5 : 1.22——ai[1]=-1 即 BetsySharpnel 裂片=abShard 标）;
      // 掷中且 wet → Kill 入水灭（:56375-56378 原文即嵌在尘块内,无 return——本仓
      // 消亡即 return 为架构等价翻译：命中/位移链在 subStepAI 内,死体不再结算）
      if (this.projId === 710 && Math.floor(Math.random() * 4) === 0) {
        if (Math.floor(Math.random() * 2) === 0) {
          game.spawnDust?.(this.x, this.y, this.w, this.h, 31, 0, 0, 100, null, 1.6, true);
        }
        const d710 = game.spawnDust?.(this.x, this.y, this.w, this.h, 6, 0, 0, 100, null, 1.2, true);
        if (d710) {
          d710.vx = d710.vx * 2 + this.vx;
          d710.vy = d710.vy * 2 + this.vy;
          d710.fadeIn = this.abShard ? 1.5 : 1.22;
        }
        if (this.wet) { this.killNow(game); return; }
      }
      // 265 剧毒法杖 / 355 毒液法杖（:57690-57706 / :57708-57724）：α 归零后每子步
      // 1 粒 d163/d205 毒泡（速=弹速继承后 ×0.3 再 −= 弹速×0.4、α100、scale1.2、
      // noGravity）——弹体可见面由 GetAlpha :81286 门控（α>0 全隐/α==0 满强加算白,
      // ★遗留批已接线=PROJ_ALPHA_MOD alpha0additive 档 + ADDITIVE_GLOW 'lighter'）,
      // fade 期即"无形尘先行"
      if (this.projId === 265 || this.projId === 355) {
        if (this.alpha === 0) {
          const d265 = game.spawnDust?.(this.x, this.y, this.w, this.h,
            this.projId === 265 ? 163 : 205, this.vx, this.vy, 100, null, 1.2);
          if (d265) {
            d265.noGravity = true;
            d265.vx = d265.vx * 0.3 - this.vx * 0.4;
            d265.vy = d265.vy * 0.3 - this.vy * 0.4;
          }
        }
      }
    } else if (this.projId === 348 || this.projId === 349) {
      // ---- ★2026-09-01 批五：双向脉冲对（AI_001 :57226-57245 348 / :57201-57220
      //  349）——scale ±0.01 与 α ∓50 相位耦合：显相(0/2) scale+0.01 & α−50（≤0 翻
      //  隐相 1，α 钉 0）；隐相(1) scale−0.01 & α+50（≥255 翻显相 2，α 钉 255）。
      //  SetDefaults 无 alpha 行（:4380/:4392）→ α≡0 起步 = 出生即翻隐相，与原版
      //  同相（周期 10 子步：隐 5 拍 + 显 5 拍；348 EU=1 → ×2/帧）。GetAlpha
      //  :81152 (200,200,200,α)——A 即 α（PROJ_ALPHA_MOD afade slope:−1 档消费）。
      //  348 的 ai[1]==0 首拍 Item8 音与 349 的 frame=(int)ai[0]（发射侧注入帧）
      //  不在本支（音面/帧面另行登记）。----
      const ph = this.projId === 348 ? this.f348Phase : this.f349Phase;
      if (ph === 0 || ph === 2) {
        this.drawScale += 0.01;
        this.alpha -= 50;
        if (this.alpha <= 0) {
          this.alpha = 0;
          if (this.projId === 348) this.f348Phase = 1; else this.f349Phase = 1;
        }
      } else {
        this.drawScale -= 0.01;
        this.alpha += 50;
        if (this.alpha >= 255) {
          this.alpha = 255;
          if (this.projId === 348) this.f348Phase = 2; else this.f349Phase = 2;
        }
      }
    }
    // 477 水晶镖旋转平滑（AI_001 type 段，Projectile.cs:58666-58676）：localAI[1]<5
    // 前 rotation = atan2(vy,vx)+π/2（对齐速度角），之后 (rot×2+aim)/3 渐近平滑
    //（镖体翻滚滞后感）——draw 侧消费 dartRot。localAI[1] 每 AI 步 +1（extraUpdates
    // 1 → 2 子步/帧，age 即子步龄，前 5 子步对齐）
    //（★E′ M-3 锚勘误 2026-09-02：旧锚 :54802-54812 系 AI_061_FishingBobber_GetWaterLine
    // 错行，真身 :58666-58676）
    if (this.projId === 477) {
      const aim477 = Math.atan2(this.vy, this.vx) + Math.PI / 2;
      if (this.age <= 5) this.dartRot = aim477;
      else this.dartRot = ((this.dartRot ?? aim477) * 2 + aim477) / 3;
    }
    // 1457 邪恶三叉戟弹 114 重做（AI aiStyle27 头 :26778-26812,1456 无此块）：
    // scale 1.5、ai[0] 计时、localAI[0]=初速;20t 后速度 ×0.98 减速淡出,<1 Kill;
    // alpha = Remap(localAI[0],2,0,1,0)×255（速度衰减即淡出）
    if (this.projId === 114) {
      if (this.drawScale !== 1.5) this.drawScale = 1.5;
      // localAI[1] 出生梯（:26840-26844 族级支每 AI 步 ++ 钳 15；≥15 后原版转
      // 114/115 专属小尘 d27@0.6——尘面归 Kill §12 大迸散族,小尘登记续批）
      if (this.gem114Ramp < 15) this.gem114Ramp++;
      this.gem114T++;
      if (this.gem114T >= 20) {
        this.vx *= 0.98;
        this.vy *= 0.98;
        // Kill 门原版 = localAI[0] < 1（初速快照,与 velocity 同步 ×0.98 衰减 :26789-26793）
        // ——读实时速度等价（仅外力改写 velocity 时分叉,登记）
        if (Math.hypot(this.vx, this.vy) < 1) { this.killNow(game); return; }
      }
      // alpha = Remap(localAI[0],2,0,1,0)×255（:26794-26796）——高速段恒 255 隐身
      //（SetDefaults alpha=255 :2031 + 27 号尘迹标记弹道）,减速穿 2 后线性显形至停,
      // 消亡前完全实体（蓝队 R7-6：曾 alpha 恒 0 全程不透明——方向反了,原版是
      // "隐身加速段+减速显形",非"减速渐隐"）
      const sp114 = Math.hypot(this.vx, this.vy);
      const a114 = Math.max(0, Math.min(1, sp114 / 2));
      this.alpha = Math.round(a114 * 255);
      // 1/2 掷 27 号尘（:26797-26807）：rand+0.2 < 显形度 才掷,位置=弹心+随机 16
      // −速度×2.5、速度=+v×0.5（原版 oldVelocity 链 ×−0.5→位移×5→×−1 净效果）
      if (Math.random() < 0.5 && Math.random() + 0.2 < a114) {
        const d114 = game.spawnDust?.(
          this.cx + (Math.random() * 2 - 1) * 16 - this.vx * 2.5,
          this.cy + 4 + (Math.random() * 2 - 1) * 16 - this.vy * 2.5,
          8, 8, 27, this.vx * 0.5, this.vy * 0.5, 100, null, 1 + Math.random() * 0.6);
        void d114;
      }
    }
    // ★BJ236 剑气族 116/132/156/157/173（aiStyle27 本体 :26767-26911,1458 同段）：
    //  ① localAI[1] 出生梯（:26840-26842 族级支,每 AI 步 ++ 钳 15,与 114 同梯）；
    //  ② 梯满后脉动（:26846-26858 `if (type != 114)` 支,梯完首拍即跑）：
    //    localAI[0]==0 → scale−0.02、α+=30（≥250 → α=255、localAI[0]=1）/
    //    localAI[0]==1 → scale+0.02、α−=30（≤0 → α=0、localAI[0]=0）——
    //    α 0↔255 周期 18 步、scale ±0.18 呼吸,GA ≥15 段 (255,255,255,α) 直读本值。
    //  载体：116/173=光束剑 723/附魔剑 989 通用近战 shoot（Item.cs:9836/:12763）、
    //  132/156/157 无发射面=dormant 档。**登记残差**：aiStyle27 活体迹尘未建模
    //  ——173 :26830-26838 localAI[1]>7 单枚 d15/57/58（scale1.25 ×0.1 noGravity）、
    //  132 :26838-26848 双枚 d107（×−0.25）、116 :26863-26869 梯满期 d64
    //  （×−0.25 noGravity）,Kill 迹尘面已在 Game.ts:40484 区（116/173）承载。
    if (this.projId === 116 || this.projId === 132 || this.projId === 156
      || this.projId === 157 || this.projId === 173) {
      if (this.gem114Ramp < 15) this.gem114Ramp++;          // :26840-26842
      else if (this.beam27PulseDir === 0) {                 // :26849-26854
        this.drawScale -= 0.02;
        this.alpha += 30;
        if (this.alpha >= 250) { this.alpha = 255; this.beam27PulseDir = 1; }
      } else {                                              // :26855-26858（else-if 档）
        this.drawScale += 0.02;
        this.alpha -= 30;
        if (this.alpha <= 0) { this.alpha = 0; this.beam27PulseDir = 0; }
      }
    }
    // 1457 宝石法珠行为（AI_029_GemStaffs :38561-38640 + HandleMovement :18106-18160）：
    //   Homing 视距 500（FastThenSlow/CanBounce ×2=1000）、转向率随距离/速度;
    //   FastThenSlow 恒 ×0.97 减速（缩到 0.1 以下 Kill）;
    //   SwirlTwins 垂直向正弦摆（幅 6、0.05Hz×π 相位）
    if (this.gem || isGemBolt(this.projId) || this.projId === 1120) {
      const g: GemStaffFlags | null | undefined = this.gem;
      // ---- AI 轨迹尘 + 点光（AI_029_GemStaffs_ActuallyGemStaffs :38516-38693,
      //      2026-08-26 用户实报批补齐）----
      // 尘型 num = type−121+86（121→86…126→91）;597→262 琥珀;1120→170。
      // NewDust(...,num,velocity.X,velocity.Y,50,default,1.2f) 后 noGravity+velocity
      // ×0.3：1120 每拍恒 1 枚（flag=false 门 :38527）,宝石珠 2 槽各 rand(5)==0 才出
      // （期望 0.4 枚/t）。★近似：NewDust 内在随机扰动分量未随 ×0.3 缩放（登记）
      const gemDustId = this.projId === 597 ? 262 : this.projId === 1120 ? 170 : this.projId - 35;
      if (this.projId === 1120) {
        game.spawnDust?.(this.x, this.y, this.w, this.h, gemDustId,
          this.vx * 0.3, this.vy * 0.3, 50, null, 1.2, true);
      } else {
        for (let slot = 0; slot < 2; slot++) {
          if (Math.floor(Math.random() * 5) === 0) {
            game.spawnDust?.(this.x, this.y, this.w, this.h, gemDustId,
              this.vx * 0.3, this.vy * 0.3, 50, null, 1.2, true);
          }
        }
      }
      // AddLight（:38692 Lighting.AddLight(center,R·G·B),按弹配色——87 号黄玉橙/
      // 123 蓝晶深蓝(0,0.1,1.3)/126 钻白 1.3 等;1120 default 支=全白）
      this.lightRGB = GEM_BOLT_LIGHT[this.projId] ?? null;

      if (g?.swirlTwins) {
        // :38618-38630 num18=ai[1]×π(孪生弹反相);本仓 gemPhase 0/1
        const num18 = this.gemPhase * Math.PI;
        const n19 = Math.sin((this.gemSwirlT) * (Math.PI * 2) * 0.05 + num18);
        const n20 = Math.sin((this.gemSwirlT + 1) * (Math.PI * 2) * 0.05 + num18);
        this.gemSwirlT++;
        const d = n20 - n19;
        const sp = Math.hypot(this.vx, this.vy) || 1;
        this.x += (-this.vy / sp) * d * 6;
        this.y += (this.vx / sp) * d * 6;
      }
      if (g?.fastThenSlow) {
        // :38633-38641 减速段：速度 >0.1 恒 ×0.97；≤0.1 后逐帧 scale −0.005 收缩、
        // <0.1 Kill（不是悬停到 timeLeft 自然消亡——蓝队 R2-13 补；scale 仅视觉，
        // 原版 Colliding 用 width/height 不随 scale 缩）
        if (Math.hypot(this.vx, this.vy) > 0.1) { this.vx *= 0.97; this.vy *= 0.97; }
        else {
          this.drawScale -= 0.005;
          if (this.drawScale < 0.1) { this.killNow(game); return; }
        }
      }
      if (g?.homing) {
        // :38563-38624 视距 500（FastThenSlow/CanBounce ×2）;FindTargetWithLineOfSight
        // 取最近有视线目标;速度 <num9(8,FastThenSlow×2) 时 +0.1 提速并 ×1.1;
        // rotateTowards 转向率 = Remap(距离,视距,0,0,1)×0.1+0.01（近距 +0.05 并
        // Remap(速度,1,3,10,1) 放大）;近距 150px 内再向目标速度 lerp 0.2
        const range = 500 * ((g.fastThenSlow || g.canBounce) ? 2 : 1);
        const tgt = this.nearestEnemyWithLos(game, range);
        if (tgt) {
          let sp = Math.hypot(this.vx, this.vy);
          const maxSp = 8 * (g.fastThenSlow ? 2 : 1);
          if (sp < maxSp) {
            // :38580-38584 先双轴 +0.1×单位向、再双轴 ×1.1（蓝队 R7-10：曾 0.1 项只加
            // 在 vx、vy 直接 ×1.1——低速近距竖直飞行的法向收敛不对称）
            const inv = 1 / (sp || 1);
            this.vx += this.vx * inv * 0.1;
            this.vy += this.vy * inv * 0.1;
            this.vx *= 1.1;
            this.vy *= 1.1;
            sp = Math.hypot(this.vx, this.vy);
          }
          const dist = Math.hypot(tgt.cx - this.cx, tgt.cy - this.cy) || 1;
          // :38591-38601 转向率 = Remap(dist,range,0,0,1)×0.1 + 0.01；低速(<maxSp)
          //  再 +0.05 后【整项】×Remap(sp,1,3,10,1)（蓝队 R7-11：曾乘子只作用于 0.05
          //  加法项且线性近似——speed=1 时我方 0.61 vs 原版 1.6，2.6 倍偏弱）
          let turn = Math.max(0, 1 - dist / range) * 0.1 + 0.01;
          if (sp < maxSp) {
            turn = (turn + 0.05) * Math.max(1, Math.min(10, 10 - (sp - 1) * 4.5));   // Remap(sp,1,3,10,1)
          }
          // :38598-38601 FastThenSlow 高速段转向衰减 num14 *= Remap(speed,30,40,1,0)
          // ——×5 出速(40)起步完全不拐弯，减速穿 30 后线性恢复满转向（蓝队 R2-12 补）
          if (g.fastThenSlow) turn *= Math.max(0, Math.min(1, 1 - (sp - 30) / 10));
          const want = Math.atan2(tgt.cy - this.cy, tgt.cx - this.cx);
          const cur = Math.atan2(this.vy, this.vx);
          let diff = want - cur;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const nv = cur + Math.max(-turn, Math.min(turn, diff));
          this.vx = Math.cos(nv) * sp;
          this.vy = Math.sin(nv) * sp;
          if (dist < 150) {           // :38622-38623 近距收敛 lerp（目标向量 = Zero.MoveTowards
            //  (敌偏移, maxSp)——偏移长 <maxSp 时返回原偏移向量本身不越界;曾恒取
            //  单位向×maxSp，dist<8 时目标长 8 > 实际偏移造成过冲振荡。蓝队 R7-12）
            const k = Math.max(0, 1 - dist / 150) * 0.2;
            const capped = dist > maxSp;
            const txv = capped ? ((tgt.cx - this.cx) / dist) * maxSp : (tgt.cx - this.cx);
            const tyv = capped ? ((tgt.cy - this.cy) / dist) * maxSp : (tgt.cy - this.cy);
            this.vx = this.vx * (1 - k) + txv * k;
            this.vy = this.vy * (1 - k) + tyv * k;
          }
        }
      }
    }
    // 329 焰镰（aiStyle 56，:27666-27687）：首步继承发射者 rotation；此后
    // |vx|+|vy|<16 → 速度 ×1.05 自加速（子步粒度——原版 AI 每 update 一跑）；恒旋
    if (this.scytheRot !== null) {
      if (!this.scytheInit) {
        this.scytheInit = true;
        this.spinRot = this.scytheRot;      // localAI[0]==0 → rotation = ai[0]（:27668-27672）
      }
      const mag = Math.abs(this.vx) + Math.abs(this.vy);
      if (mag < 16) { this.vx *= 1.05; this.vy *= 1.05; }
      this.spinRot += (Math.abs(this.vx) + Math.abs(this.vy)) * 0.025 * (this.vx < 0 ? -1 : 1);   // :27686
    }
    // 351 礼盒（aiStyle 58，:27727-27757）：两段重力 + 淡入 + 帧 0/1
    if (this.present) {
      this.presentT += 1;
      this.presentAlpha = Math.max(0, this.presentAlpha - 50);   // :27729-27733
      if (this.presentStage === 0) {
        if (this.presentT > 30) this.vy += 0.1;                  // :27737-27741
        if (this.vy >= 0) this.presentStage = 1;                 // :27742-27745
      } else {
        this.vy = Math.min(this.vy + 0.1, 3);                    // :27750-27754
        this.vx *= 0.99;
      }
    }
    // 翻滚（aiStyle 2 刀族 :21508，自出生每 tick 累加）；48/54/93/520/599 在
    // 平飞期由 draw 侧姿态锁定覆盖（:21971-21972）
    if (this.tumble) {
      this.tumbleRot += (Math.abs(this.vx) + Math.abs(this.vy)) * 0.03 * (this.vx >= 0 ? 1 : -1);
    }
    // 恒旋族（AI_001 :54741-54749/:54822-54825）：rotation 逐 update 累加
    const spinFn = PROJ_SPIN[this.projId];
    if (spinFn) this.spinRot += spinFn(this);
    // 大地巨石 261：慢速消亡（|v|<1.5）+ 墙撞爆岩视觉（:18235-18244）
    if (this.boulder) {
      const spd261 = Math.hypot(this.vx, this.vy);
      if (spd261 < 1.5) { this.killNow(game); return; }
      if (this.hitWall && spd261 > 3) {
        game.playSfx('dig', 1, this.cx, this.cy);
        game.spawnParticles(this.cx, this.cy, '#8C6A4A', 10, 3, { life: 30 });
      }
    }
    // 飞龙剑气 684（AI_001 type 段 :55935-55960）：尘 60 拖尾（1/2 概率 20×80 椭域
    // 随机偏移 RotatedBy(速度角) 的近似）。alpha 通道迁入 AI001_FADE_RATE[684]（−40/
    // 子步，684）与 AI001_FADE_AGE2[711]（−25，ai[0]≥2 门）——旧实现写 dragonAlpha
    // 从无 draw 消费者（死存储），且 711 曾被同槽 −40 错率携带（vanilla −25）
    if (this.dragonFade) {
      if (Math.random() < 0.5) {
        game.spawnParticles(this.cx + (Math.random() - 0.5) * 20, this.cy + (Math.random() - 0.5) * 80,
          '#C0E8FF', 1, 0.8, { life: 16 });
      }
    }
    // 泰拉刃光束 985（AI_191 :39248-39266 + 985 专属尾段 :39333-39377）：
    // 寿命 = ai[1]+25（出生 18 → 43t）；淡入 ai[1]/2=9t、末 12t 淡出（:39344）；
    // t≥Lerp(ai1,ai1+25,0.65)≈34 清伤（纯视觉尾段）；>8 速才减速/探墙（:39362
    // velocity.Length()>8 → ×0.94/t + 探墙 localAI[1] → ×0.8/×0.88 阻尼——正牌
    // 出生速=瞄准向×shootSpeed×5=60（Player.cs:48316，Game 侧已修正漏乘），
    // 分支全程激活至衰减速降 ≤8；973 甩剑共用段）
    if (this.terra) {
      this.terraT++;
      const terraLife = this.terraAi1 + 25;
      if (this.terraT >= terraLife) { this.killNow(game); return; }
      if (!this.terraNoHit && this.terraT >= Math.round(this.terraAi1 + 25 * 0.65)) {
        this.terraNoHit = true;
        this.damage = 0;                                  // :39337-39340 damage=0
      }
      const stT = world.store;
      this.lightRGB = [0.25, 0.86, 0.38];    // Color(64,220,96)（:39382）
      // 光心 = 弹心 + 朝向 ×85×scale（:39382 Center+rotation.ToRotationVector2()*85*scale）
      {
        const sp = Math.hypot(this.vx, this.vy) || 1;
        this.lightRGBAt = { x: this.cx + (this.vx / sp) * 85, y: this.cy + (this.vy / sp) * 85 };
      }
      if (Math.hypot(this.vx, this.vy) > 0.5 && Math.random() < 0.6) {
        game.spawnParticles(this.cx, this.cy, '#7CE81E', 1, 1.2, { life: 18 });
      }
      if (Math.hypot(this.vx, this.vy) > 8) {
        this.vx *= 0.94; this.vy *= 0.94;
        if (!this.terraWall) {
          const rot = Math.atan2(this.vy, this.vx);
          let clear = false;
          for (let k = -1; k <= 1 && !clear; k += 0.5) {
            const a = rot + k * (Math.PI / 4) * 0.25;
            clear = canHit(stT, this.cx, this.cy, 0, 0,
              this.cx + Math.cos(a) * 110, this.cy + Math.sin(a) * 110, 0, 0);
          }
          if (!clear) this.terraWall = true;
        }
        if (this.terraWall && Math.hypot(this.vx, this.vy) > 8) { this.vx *= 0.8; this.vy *= 0.8; }
        if (this.terraWall) { this.vx *= 0.88; this.vy *= 0.88; }
      }
    }
    // 星怒剑 503（aiStyle 5 :22139-22157 + 503 段 :22197-22266）：无重力恒速；
    // 线上方穿墙（tileCollide=false）→ 越线后撞块；alpha 255−15/t 渐显（线上
    // 钳 150 / 线下钳 0）；周期 Item9 星啸；尘 58 星尘尾；rotation=vel−π/2（draw 侧）
    if (this.starY !== null) {
      // :24105-24108 tileCollide=true 仅当 Center.Y > ai[1]（严格大于——边界对齐）
      this.starCollide = this.cy > this.starY;
      // α 渐减 −15/t：503/9 下限 150（:24151-24158 num43）；★2026-09-03 接斗篷星
      //  723-726/1133 alpha 面（:24165-24176 num44=100,此前族内无减段=星体全程全亮）
      //  越线门=Center.Y >= ai[1]（:24152/:24169）——与 tileCollide 的严格 > 差一拍,
      //  边界格上 α 已开钳、碰块未开,按原文保留
      const cloakStar = this.projId === 723 || this.projId === 724
        || this.projId === 725 || this.projId === 726 || this.projId === 1133;
      const floorA = this.cy < this.starY ? (cloakStar ? 100 : 150) : 0;
      this.starAlpha = Math.max(floorA, this.starAlpha - 15);
      if (--this.starSndT <= 0) {
        this.starSndT = 20 + Math.floor(Math.random() * 40);
        game.playSfxFiles(['Item_9'], 1, this.cx, this.cy);   // ★T4：原版 PlaySound 无音量参=缺省 1.0（:24133）
      }
      if (Math.random() < 0.3) {
        game.spawnParticles(this.cx, this.cy, '#FFF8C8', 1, 0.9, { life: 20 });
      }
    }
    // 专家追踪（Projectile.cs:54330-54345 275/276 / :23307-23316 277：
    // v=(v*(weight-1)+dirToPlayer*speed)/weight；<floor 或 >cap 归一）
    // 270 骷髅髅骨（:53192-53213）：ai1 30-110 窗口转向（保速混合）+ <18 速
    // ×1.02/t 自加速
    if (this.skullBoneT > 0) {
      this.skullBoneT += 1;
      const p = game.player;
      if (p && !p.dead && this.skullBoneT > 30 && this.skullBoneT < 110) {
        const spd = Math.hypot(this.vx, this.vy) || 0.001;
        const ddx = p.cx - this.cx, ddy = p.cy - this.cy;
        const dl = Math.hypot(ddx, ddy) || 1;
        let nvx = (this.vx * 24 + (ddx / dl) * spd) / 25;
        let nvy = (this.vy * 24 + (ddy / dl) * spd) / 25;
        const nl = Math.hypot(nvx, nvy) || 1;
        this.vx = nvx / nl * spd; this.vy = nvy / nl * spd;
      }
      if (Math.hypot(this.vx, this.vy) < 18) { this.vx *= 1.02; this.vy *= 1.02; }
    }
    // ---- 452 月总幻影矢（aiStyle 82，Projectile.cs:30119-30195）三段弹道 ----
    if (this.phantasm) {
      this.phAlpha = Math.max(0, this.phAlpha - 40);            // :30121-30125 渐显
      const riseArc = () => {
        // :30135-30144 / :30172-30181：vx = velocity.RotatedBy(ai1).X 钳 ±6；
        // vy −0.08（vy>0 再 −0.2）、钳 −7
        const c = Math.cos(this.phSpin), s = Math.sin(this.phSpin);
        this.vx = Math.max(-6, Math.min(6, this.vx * c - this.vy * s));
        this.vy -= 0.08;
        if (this.vy > 0) this.vy -= 0.2;
        if (this.vy < -7) this.vy = -7;
      };
      if (this.phStage === 0) {
        this.phT++;
        if (this.phT >= 45) { this.phT = 0; this.phStage = 1; this.phSpin = -this.phSpin; }  // :30128-30134
        riseArc();
      } else if (this.phStage === 1) {
        this.phT++;
        // :30163-30171：90t 末 ai[1] = FindClosest 索引（单人恒 0 = 旋转恒等）
        if (this.phT >= 90) { this.phT = 0; this.phStage = 2; this.phSpin = 0; }
        riseArc();
      } else {
        // :30176-30196 14 速追踪：距玩家 <30 消亡（触发 Game 452 爆炸钩）
        const p = game.player;
        if (p && !p.dead) {
          let ddx = p.cx - this.cx, ddy = p.cy - this.cy;
          const dist = Math.hypot(ddx, ddy);
          if (dist < 30) { this.killNow(game); return; }
          ddx = ddx / dist * 14;
          ddy = ddy / dist * 14;
          const tx2 = this.vx + (ddx - this.vx) * 0.6;          // Lerp(v, dir·14, 0.6)
          let ty2 = this.vy + (ddy - this.vy) * 0.6;
          if (ty2 < 6) ty2 = 6;                                 // :30186-30188 目标 vy 钳 ≥6
          const st = 0.4;
          if (this.vx < tx2) { this.vx += st; if (this.vx < 0 && tx2 > 0) this.vx += st; }
          else if (this.vx > tx2) { this.vx -= st; if (this.vx > 0 && tx2 < 0) this.vx -= st; }
          if (this.vy < ty2) { this.vy += st; if (this.vy < 0 && ty2 > 0) this.vy += st; }
          else if (this.vy > ty2) { this.vy -= st; if (this.vy > 0 && ty2 < 0) this.vy -= st; }
        }
      }
      // :30197-30199 alpha<40 尘 229（速度 −v/3）
      if (this.phAlpha < 40) {
        game.spawnParticles(this.cx, this.cy, '#C060E8', 1, 0.8, { life: 20 });
      }
    }
    // ---- 454 月总幻影能量球（aiStyle 83，Projectile.cs:30236-30282）----
    if (this.phantomOrb) {
      // :30238-30245 alpha 255 → 钳 200 → −5/t（scale 随之伸展，draw 消费）
      this.orbAlpha = Math.min(this.orbAlpha, 200);
      this.orbAlpha = Math.max(0, this.orbAlpha - 5);
      if (this.orbAi0 >= 0) this.orbAi0++;                      // :30246-30248
      if (this.orbAi0 === -1) {
        // :30249-30253 齐射态：帧 1 + extraUpdates=1（速度由发射点统一给定）
        this.orbFrame = 1;
        this.extraUpdates = 1;
      } else {
        const src = (game.enemies() as Array<{ id: number; dead: boolean; cx: number; cy: number }>)
          .find((n) => n.id === this.orbOwnerId);
        const ax = src && !src.dead ? src.cx : (this.orbAnchor?.x ?? this.cx);
        const ay = src && !src.dead ? src.cy : (this.orbAnchor?.y ?? this.cy);
        if (src && !src.dead) this.orbAnchor = { x: ax, y: ay };
        if (this.orbAi0 < 30) {
          // :30254-30257 附主随行：position = 主心 − 尺寸/2 − v（下方位移段 +v
          // 落回主心——原版 AI 直写 + HandleMovement 加 v 的合成语义）
          this.x = ax - this.w / 2 - this.vx;
          this.y = ay - this.h / 2 - this.vy;
        } else {
          // :30258-30267 列队：×0.96 减速 + 帧 0/1 每 6t 切换
          this.vx *= 0.96;
          this.vy *= 0.96;
          if (++this.orbFrameT >= 6) {
            this.orbFrameT = 0;
            this.orbFrame = this.orbFrame === 0 ? 1 : 0;
          }
        }
      }
      // :30280-30281 alpha<40 每步尘 229 ×2
      if (this.orbAlpha < 40) {
        game.spawnParticles(this.cx, this.cy, '#C060E8', 2, 0.5, { life: 18 });
      }
    }
    // ---- 1021 月总巨砾（aiStyle 25，Projectile.cs:24666-24712 物理段）----
    // 重力 0.06/终端 16 走 grav 链（spawn 侧传 grav 0.06）；此处滚动旋转 +
    // 地面滚动加速
    if (this.mlBoulder) {
      this.spinRot += this.vx * 0.06;                           // :24666 rotation += vx·0.06
      if (Math.abs(this.vy) <= 1) {                             // :24685-24693 |vy|≤1 滚动加速
        if (this.vx > 0 && this.vx < 3.5) this.vx += 0.025;
        else if (this.vx < 0 && this.vx > -3.5) this.vx -= 0.025;
      }
    }
    // ---- 448 火箭（aiStyle 80，Projectile.cs:29801-29890）----
    if (this.martianRocket) {
      if (this.rkAi0 === 0 && this.rkFuse > 0) {
        this.rkFuse--;                                          // :29804-29806 引信倒数（20t）
      } else if (this.rkAi0 === 0) {
        // :29807-29827 点火：+4 加速 + 8 尘爆 + 锁定 + tileCollide=true
        this.rkAi0 = 1;
        const spd = Math.hypot(this.vx, this.vy);
        if (spd > 0) {
          const k = (spd + 4) / spd;
          this.vx *= k; this.vy *= k;
        }
        this.noTileCollide = false;                             // :29833 tileCollide = true
        const rot = Math.atan2(this.vy, this.vx) + Math.PI / 2;
        const cr = Math.cos(rot - Math.PI / 2), sr = Math.sin(rot - Math.PI / 2);
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4;
          const ox = -8 - Math.cos(a) * 2, oy = -Math.sin(a) * 8;   // :29815-29817 UnitX·−8 + −UnitY.Rot(i·π/4)·(2,8)
          game.spawnParticles(this.cx + ox * cr - oy * sr, this.cy + ox * sr + oy * cr,
            '#FFD070', 1, 0, { life: 16 });
        }
      } else {
        // :29832-29860 点火后：180t 自毁；[0,30) 逐 t 20% 角度转向玩家
        this.rkT++;
        if (this.rkT === 180) { this.killNow(game); return; }
        const p = game.player;
        if (this.rkT < 30 && p && !p.dead) {
          const cur = Math.atan2(this.vy, this.vx);
          let diff = Math.atan2(p.cy - this.cy, p.cx - this.cx) - cur;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const ca = Math.cos(diff * 0.2), sa = Math.sin(diff * 0.2);
          const nvx = this.vx * ca - this.vy * sa;
          const nvy = this.vx * sa + this.vy * ca;
          this.vx = nvx; this.vy = nvy;
        }
      }
      // :29862-29868 帧 3t/帧 3 帧循环；:29869-29877 每 t 尾焰尘 1+ai0 枚
      // （喷口 = Center + UnitY.RotatedBy(rotation)·8·(i+1)，rotation = 速度角+π/2）
      if (++this.rkFrameT >= 3) { this.rkFrameT = 0; this.rkFrame = (this.rkFrame + 1) % 3; }
      const rkRot = Math.atan2(this.vy, this.vx) + Math.PI / 2;
      game.spawnParticles(this.cx + Math.cos(rkRot) * 8, this.cy + Math.sin(rkRot) * 8,
        '#FFB040', 1 + this.rkAi0, 0, { life: 14 });
      // :29878-29889 距玩家 ≤42 → Kill 爆炸（伤害由爆炸盒投递）
      const pr = game.player;
      if (pr && !pr.dead && Math.hypot(pr.cx - this.cx, pr.cy - this.cy) <= 42) {
        this.killNow(game);
        return;
      }
    }
    if (this.homing) {
      const p = game.player;
      if (p && !p.dead) {
        let dx = p.cx - (this.x + this.w / 2), dy = p.cy - (this.y + this.h / 2);
        const d = Math.hypot(dx, dy) || 1;
        dx = dx / d * this.homing.speed;
        dy = dy / d * this.homing.speed;
        // axis：原版单轴混入档（刺球 277 专家只混 X,:23307-23316）
        this.vx = (this.vx * (this.homing.weight - 1) + dx) / this.homing.weight;
        if (this.homing.axis !== 'x') this.vy = (this.vy * (this.homing.weight - 1) + dy) / this.homing.weight;
        const sp = Math.hypot(this.vx, this.vy);
        if (this.homing.floor !== undefined && sp < this.homing.floor && sp > 0) {
          this.vx = this.vx / sp * this.homing.floor;
          this.vy = this.vy / sp * this.homing.floor;
        }
        if (this.homing.cap !== undefined && sp > this.homing.cap) {
          this.vx = this.vx / sp * this.homing.cap;
          this.vy = this.vy / sp * this.homing.cap;
        }
      }
    }
    // ---- 电圈发射器导弹 442（AI_001 type 段 Projectile.cs:55689-55740，1:1）----
    // ① 渐显（:55691-55703）：alpha 255 起，localAI[0] 计数 ≥4 后每拍 −90（计数
    //    复位仅发生在钳 0 拍 → 实际 4/5/6 三拍归零，非每 4 拍一步）；② 到点杀
    //    （:55704-55710）：弹心与锁定格心 (ai×16+8) 距 ≤16 → Kill（Kill 特效/电球
    //    443 生成在 Game.onProjectileDeath 442 分支——全消亡路径同 vanilla Kill()
    //    单口）；③ alpha==0 期（:55708-55730）：localAI[1] ≥120 超时 Kill +
    //    Lighting(0.3,0.45,0.8) 青蓝光 + localAI[0]==3 拍（每 3t）8 粒 135 尘旋转环
    //    （scale 1.5/noGravity/绕 rotation−π/2=速度角，速度 = v×0.66）。
    //    ★本段无 velocity 修正式——导弹直线飞行，"飞向锁定点"由初速方向 + 到点杀
    //    组成（发射侧 Game 2796 分支传 aimPoint）。
    if (this.projId === 442 && this.aimPt) {
      if (this.alpha !== 0) {
        this.aimCnt++;
        if (this.aimCnt >= 4) {
          this.alpha -= 90;
          if (this.alpha < 0) { this.alpha = 0; this.aimCnt = 2; }
        }
      }
      const px = this.aimPt.tx * 16 + 8, py = this.aimPt.ty * 16 + 8;
      if (Math.hypot(this.cx - px, this.cy - py) <= 16) { this.killNow(game); return; }
      if (this.alpha === 0) {
        if (++this.aimLife >= 120) { this.killNow(game); return; }
        this.lightRGB = [0.3, 0.45, 0.8];                    //（:55713）
        if (++this.aimCnt >= 3) {                            //（:55714-55730）
          this.aimCnt = 0;
          const ang = Math.atan2(this.vy, this.vx);          // rotation − π/2（aiStyle1 通用姿态）
          const ca = Math.cos(ang), sa = Math.sin(ang);
          for (let i = 0; i < 8; i++) {
            const a = i * Math.PI / 4;
            const ox = -8 + Math.sin(a) * 2, oy = -Math.cos(a) * 4;   // UnitX·−8 + −UnitY.Rot(a)·(2,4)
            const d = game.spawnDust?.(this.cx, this.cy, 0, 0, 135, 0, 0, 0, null, 1.5, true);
            if (d) {
              d.x = this.cx + ox * ca - oy * sa;
              d.y = this.cy + ox * sa + oy * ca;
              d.vx = this.vx * 0.66;
              d.vy = this.vy * 0.66;
            }
          }
        }
      }
    }
    // AI_001 尾 ±16 钳（:58736-58752）：flag7 = type != 577，全体 aiStyle 1 弹每
    // update 无条件 vy ≤ 16（vy < −16 仅 flag4=1006，重力分支已对称钳 −maxFall）。
    // 蓝队 R7-8：曾钳在重力门内——grav=0 型（flag3 免重力子弹族等）全程不钳；
    // 出生钳保证 |vy|≤16 且现接 grav=0 型无自增速，实际不可达，但 616 等自带增速型
    // 接入即漏钳，提出门外收口（577 豁免）
    if (this.aiStyleOne && this.projId !== 577 && this.vy > 16) this.vy = 16;
    // ---- 1457 弧线引矢消费（AI_001 尾 :58752-58777——本段在 AI_001 最末，重力/
    //      姿态/±16 钳之后、位移之前；命中侧 phoenixQuivered 见下方命中环）----
    if (this.harpyCharmed && !this.harpyCharmConsumed) {
      // :58756-58758 num253=视距 1600、maxChange=π（一步全转）→
      // FindTargetWithLineOfSight(1600)
      const tgt = this.nearestEnemyWithLos(game, 1600);
      if (tgt) {
        const spH = Math.hypot(this.vx, this.vy);
        const wantH = Math.atan2(tgt.cy - this.cy, tgt.cx - this.cx);
        this.vx = Math.cos(wantH) * spH;                   // :58761 rotateTowards(π) 保速
        this.vy = Math.sin(wantH) * spH;
        if (spH < 1) { this.vx = 0; this.vy = 1; }         // :58762-58765 SafeNormalize(UnitY)
        if (spH < 12) { this.vx *= 1.05; this.vy *= 1.05; }   // :58766-58769 低速自加速
      } else {
        this.harpyCharmConsumed = true;                    // :58772-58776 无目标 → 位停引
      }
    }
    // ---- 藤壶哨站弹 1026（aiStyle 28 1026 支 :26920-26944 + 出膛编排 :27033-27038；
    //      ★2026-09-01 producer 锚补齐批——原 AI_28 全链未建模,
    //      哨站 1025 悬浮但零开火）:extraUpdates=2（SetDefaults :9719-9725）→ 本仓
    //      spawn 侧传 extraUpdates:2,本支逐【子步】执行：
    //      ①首子步 ai[1]==0 门 → DeadCellsBarnacleShotFiring 编排（:27033-27038,
    //        clientOnly:true → 本仓 owner 权威广播补远端,同 34 型口径）;
    //      ②拖尾：localAI[0]≥8（钳值）且 timeLeft%2==0 → d2 尾尘（位=position−
    //        vel 归一×5、vel×0.25、α50/fadeIn .5/noGravity、scale .7±.05）;
    //      ③★BJ582①（2026-10-09）恒速直飞（:26918-27045 全支零 velocity/alpha 写位
    //        亲读）——旧「×0.8 衰减+α≥255 Kill」系 aiStyle 30 else 支（:27149-27158）
    //        误套,射程被压到 ≈60px,见支尾 BJ582 注。消亡=命中/撞块 Kill 链。
    //      （顺序=原版 AI 先于 UpdatePosition）
    if (this.projId === 1026) {
      if (this.age === 1) {
        deadCellsBarnacleShotFiringFx(game, this.cx, this.cy, this.vx, this.vy);
        game.broadcastParticleOrchestra?.(ParticleOrchestraType.DeadCellsBarnacleShotFiring,
          this.cx, this.cy, this.vx, this.vy);
      }
      if (this.age >= 8 && this.life % 2 === 0) {
        const sl = Math.hypot(this.vx, this.vy) || 1;
        const d26 = game.spawnDust?.(this.x - (this.vx / sl) * 5, this.y - (this.vy / sl) * 5,
          this.w, this.h, 2, this.vx, this.vy, 0, null,
          // 0.7+Next(-5,5)×.01（:26926）——★F5 2026-09-01 ×10 上界开区间,旧 ×11 多掷 +5 档
          0.7 + (Math.floor(Math.random() * 10) - 5) * 0.01);
        if (d26) {
          d26.alpha = 50; d26.fadeIn = 0.5; d26.noGravity = true;
          d26.vx = this.vx * 0.25; d26.vy = this.vy * 0.25;
        }
      }
      // ★BJ582①（2026-10-09,用户实报「藤壶法杖攻击距离只有这么一点」定谳落刀）：
      //  旧「velocity ×0.8/子步 + alpha += 4 → ≥255 Kill」系【aiStyle 30 的 else 支
      //  语义】（Projectile.cs:27149-27158——907 光球族衰减消隐）误套到 aiStyle 28
      //  的 1026 上。1457 AI_028 全支（:26918-27045）亲读零 velocity 写位/零 alpha
      //  写位——1026 恒速 12/子步（EU2=36px/拍）直飞至命中/撞块/timeLeft 3600 尽,
      //  索敌域 1240px（MinionProj AI_197 出弹站）全程可达;旧形 64 子步衰减射程
      //  ≈60px =「攻击距离只有这么一点」的实害根因。弹的消亡面=命中/撞块 Kill 链
      //  （:76827-76836 Item_167+20×d2,本文件 1026 Kill 支已接）。
    }
    // ---- 496 暗影炎弓箭（aiStyle 91,Projectile.cs:33097-33148;3053 暗影炎弓载荷,
    //      红蓝台账 R2 批 2026-09-03）——逐【子步】（extraUpdates=2,MaxUpdates=3
    //      别名式,Game 3053 支注入）：
    //      ①缩径:scale=1−localAI[0]、width=height=(int)(20×scale)、Center 锚定
    //        （:33101-33105,int 除）;localAI[0] += (<0.1 档 0.01/否则 0.025)
    //        （:33106-33109）;≥0.95 Kill（:33110-33113——11×0.01+34×0.025=45 子步,
    //        EU3≈15t=缩径即寿命;Game 3053 支的 life:15 占位已撤,timeLeft 回
    //        SetDefaults 缺省 3600（:526,496 无覆写行）恒不先亡）
    //      ②摆动:v += ai×1.5（:33118-33119）;|v|>16 归一×16（:33120-33122）;
    //        ai ×1.05/子步（:33123-33124）
    //      ③影焰尘:scale<1 → i<scale×10 循环 d27（NewDust(position,w,h,27,v弹,
    //        α100,scale1.1) 后置:pos=(pos+Center)/2、noGravity、v×0.1−v弹×
    //        (1.3−scale)、fadeIn=100+owner、scale+=scale×0.75）（:33125-33147,
    //        owner 单机恒 0）
    //      ④数据面（2026-09-03 登记项①补齐）：vanilla-projectiles.json 496 三键缺口
    //        alpha=255/usesLocalNPCImmunity/localNPCHitCooldown=-1（recon 双闸门流程外
    //        禁直改 json;extraUpdates=2 已由 1457 提取器并表,与 Game 3053 支 opts 显式
    //        传 2 同值互证）已由 vanillaProjectiles.ts DATA_PATCH['496'] 注入——
    //        localNPCHitCooldown=-1 → ctor localImmune,命中环 `localImmune > 0` 门
    //        不吃负值 → 落 hitSet 永久同敌免支 ≡ vanilla -1「localNPCImmunity=-1 恒
    //        不衰减 :14175-14178/:17380」语义（行为零变,tests/496-wobble ⑥b 守）;
    //        alpha=255 运行时面 = PROJ_ALPHA0[496]（本批补键）→ draw 通用兜底
    //        (255−255)/255=0 = 精灵本体恒隐（GetAlpha 无 496 专属支,缺省路径 :81507
    //        读 α;可见面=本支 ③ 影焰尘 27 拖尾）。NPC 命中盒=本缩径盒 20×scale
    //        （Damage_GetHitbox :15037 读 width/height——GetCollisionParams :20072
    //        的 10×10 是【撞块】盒,本仓撞块=中心点单点判定同口径;SetDefaults 40×40
    //        仅贴图面）。
    //      ⑤半像素注:width/height 为奇数拍 (int)(w/2) 整除使 Center 每子步 +0.5px
    //        漂移（position=Center−trunc(w/2) 而 Center=pos+w/2）——vanilla 同源
    //        逐字（:33104-33105 C# int 除）,非本仓近似
    if (this.projId === 496) {
      const scale496 = 1 - this.sf496Local;                    // :33101
      const w496 = Math.trunc(20 * scale496);                  // :33102-33103 (int)(20f*scale)
      const cx496 = this.cx, cy496 = this.cy;                  // :33100 center16（改宽前读）
      this.w = w496; this.h = w496;
      this.x = cx496 - Math.trunc(w496 / 2);                   // :33104-33105（int 除）
      this.y = cy496 - Math.trunc(w496 / 2);
      this.drawScale = scale496;                               // 绘制=贴图×scale（Main.cs 通用式）
      if (this.sf496Local < 0.1) this.sf496Local += 0.01;      // :33106-33109
      else this.sf496Local += 0.025;
      if (this.sf496Local >= 0.95) { this.killNow(game); return; }   // :33110-33113
      this.vx += this.sf496Ai0 * 1.5;                          // :33118
      this.vy += this.sf496Ai1 * 1.5;                          // :33119
      const vl496 = Math.hypot(this.vx, this.vy);
      if (vl496 > 16) {                                        // :33120-33122 Normalize×16
        this.vx = this.vx / vl496 * 16;
        this.vy = this.vy / vl496 * 16;
      }
      this.sf496Ai0 *= 1.05;                                   // :33123-33124
      this.sf496Ai1 *= 1.05;
      if (scale496 < 1) {                                      // :33125-33147
        for (let i = 0; i < scale496 * 10; i++) {
          const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 27,
            this.vx, this.vy, 100, null, 1.1, true);           // NewDust(noGravity 后置同式)
          if (d) {
            d.x = (d.x + cx496) / 2;                           // :33128（position+Center 折半）
            d.y = (d.y + cy496) / 2;
            d.vx = d.vx * 0.1 - this.vx * (1.3 - scale496);    // :33131-33135
            d.vy = d.vy * 0.1 - this.vy * (1.3 - scale496);
            d.fadeIn = 100;                                    // :33136 =100+owner
            d.scale += scale496 * 0.75;                        // :33138-33139
          }
        }
      }
    }
    // ---- aiStyle 23 寿命帽（魔眼二阶段喷火 101 / 腐化者诅焰 188,Projectile.cs
    //      :26191-26203;1458 :26192-26203 零变更）——原版 AI 头每子步
    //      `if (timeLeft > 60) timeLeft = 60;`(:26201-26203)：出生 3600 首子步即钳
    //      60;timeLeft-- 在子步尾 numUpdates 循环【内】(Update :17307-17311)→ EU=3
    //      每 tick 消 4 ⇒ 弹寿 60 子步 = 15 tick,射程 = 60 子步 × (6+0.5×自身速)px
    //      ≈ 360-560px(约半屏内)。本仓直飞桶曾缺此帽 → shoot 缺省 life=300 撑
    //      75t ≈ 1800px 屏幕外,即实报"Spazmatism 二阶段喷火过远"根因。位序 =
    //      原版 AI 头(帽 :26201 先于尘站 :26205)。188 本仓尚无发射面,随族并接。
    //      ★read：va 判定用 projId 键(101/188=json aiStyle23 全集),非通用 aiStyle
    //      判定——Arrow 实例不落 json def 字段,逐型键即原版 aiStyle 分派终面。----
    if (this.projId === 101 || this.projId === 188) {
      if (this.life > 60) this.life = 60;                    // :26201-26203
    }
    // ---- ★NPC 弹幕尘站普查批②（2026-09-16,docs/npc-proj-dust-census.md §4）：
    //      Arrow 载体敌弹（bossAI.shoot 直飞桶）的 AI 段尘站补齐。全部为 AI_001
    //      per-type 块（原版 AI 在 UpdatePosition 前 → 本位在通用位移行前=pre-move
    //      盒;EU 型每子步一跑与原版 numUpdates 循环同拍）----
    //  · 101 魔眼诅焰（aiStyle23 :26213-26262——非石巨人火球, projectile id 101 =
    //    Spazmatism 喷火 NPC.cs:27632;ai[0]>7 门——ai[0] 出生 0,每 update
    //    ++,>7 即第 9 update 起掷）：1/2 掷 ×1×d75（速=v×0.2,α100）;掷中后
    //    2/3+1/9 → noGravity+scale×3+vel×2;scale×1.5×num193（num193=ai[0]∈{8,9,10}
    //    时 0.25/0.5/0.75 起步爬升）;num194==75 尾段 vel+=弹速,!noGravity → vel×0.5
    if (this.projId === 101 && this.age > 8 && Math.floor(Math.random() * 2) === 0) {
      const num193 = this.age === 9 ? 0.25 : this.age === 10 ? 0.5 : this.age === 11 ? 0.75 : 1;
      const d101 = game.spawnDust?.(this.x, this.y, this.w, this.h, 75,
        this.vx * 0.2, this.vy * 0.2, 100);
      if (d101) {
        const noG = Math.floor(Math.random() * 3) !== 0
          || Math.floor(Math.random() * 3) === 0;              // Next(3)!=0 || (75∧Next(3)==0)
        if (noG) { d101.vx *= 2; d101.vy *= 2; d101.scale *= 3; }
        d101.vx *= 1.2; d101.vy *= 1.2;                        // :26250-26251 恒 ×1.2
        d101.scale = d101.scale * 1.5 * num193;                // :26254-26257 非 188 → ×1.5×num193
        d101.vx += this.vx; d101.vy += this.vy;                // :26254-26262 num194==75 → += 弹速
        if (!noG) { d101.vx *= 0.5; d101.vy *= 0.5; }
        d101.noGravity = noG;
      }
    }
    //  · 462 月总幻影矢（AI_001 :55826-55836,每 update）：1×d229（NewDust(Center,0,0),
    //    α100）→ noLight+noGravity、velocity=弹速、position −= One×4、scale=0.8
    if (this.projId === 462) {
      const d = game.spawnDust?.(this.cx, this.cy, 0, 0, 229, 0, 0, 100);
      if (d) {
        d.noLight = true; d.noGravity = true;
        d.vx = this.vx; d.vy = this.vy;
        d.x -= 4; d.y -= 4;
        d.scale = 0.8;
      }
    }
    //  · 622 猪鲨水弹（AI_001 :57145-57158,每 update 2/3 掷）：1×d229（盒=position+
    //    (4,4) 缩 (w−8,h−8),速=v×0.2,α0,scale1.2）→ position −= 弹速×2、noLight+
    //    noGravity、vel×0.3
    if (this.projId === 622 && Math.floor(Math.random() * 3) !== 0) {
      const d = game.spawnDust?.(this.x + 4, this.y + 4, this.w - 8, this.h - 8, 229,
        this.vx * 0.2, this.vy * 0.2, 0, null, 1.2);
      if (d) {
        d.x -= this.vx * 2; d.y -= this.vy * 2;
        d.noLight = true; d.noGravity = true;
        d.vx *= 0.3; d.vy *= 0.3;
      }
    }
    //  · 719 蜂王蜂刺（AI_001 :56460-56481,每 update）：1/2 掷 ×1×d147
    //    （NewDustDirect 盒=position−弹速,α0,scale0.9）→ noGravity;首拍
    //    （localAI[0]==0）20×d147（scale1.3,noGravity,vel+=弹速×0.75）+
    //    10×d147（scale1.3,noGravity,vel×2）
    if (this.projId === 719) {
      if (Math.floor(Math.random() * 2) === 0) {
        const d = game.spawnDust?.(this.x - this.vx, this.y - this.vy, this.w, this.h,
          147, 0, 0, 0, null, 0.9);
        if (d) d.noGravity = true;
      }
      if (this.age === 1) {
        for (let i = 0; i < 20; i++) {
          const d = game.spawnDust?.(this.x - this.vx, this.y - this.vy, this.w, this.h,
            147, 0, 0, 0, null, 1.3);
          if (!d) break;
          d.noGravity = true;
          d.vx += this.vx * 0.75; d.vy += this.vy * 0.75;
        }
        for (let i = 0; i < 10; i++) {
          const d = game.spawnDust?.(this.x - this.vx, this.y - this.vy, this.w, this.h,
            147, 0, 0, 0, null, 1.3);
          if (!d) break;
          d.noGravity = true;
          d.vx *= 2; d.vy *= 2;
        }
      }
    }
    //  · 468 远古教徒光珠（AI_001 :55360-55421,每 update;localAI[0]==12 节拍环——
    //    本仓以 age%12==0 承载）：环 12×d27（α160,scale1.1,noGravity,位=Center+
    //    spinningpoint2 RotatedBy(rot−π/2)、vel=norm(Center−弹速×3−尘位)×1.25）+
    //    1/4 掷 ×1×d31（α100,vel×0.1,位=Center+侧偏×w/2,fadeIn0.9）+ 1/32 掷 ×1×d31
    //    （α155,scale0.8,vel×0.3,1/2 fadeIn1.4）+ 1/2 掷 ×2×d27（α0,scale1.2,vel×0.3,
    //    noGravity,1/2 fadeIn1.4）——侧偏 = −UnitX.RotatedByRandom(σ).RotatedBy(弹向角)
    if (this.projId === 468) {
      if (this.age % 12 === 0) {
        const rotA = Math.atan2(this.vy, this.vx) + Math.PI / 2;   // AI_001 缺省姿态角
        for (let l = 0; l < 12; l++) {
          const th = (l * Math.PI) / 6;
          const px = -this.w / 2 + 8 * Math.sin(th);               // UnitX·(−w/2) − UnitY.Rot(θ)·(8,16)
          const py = -16 * Math.cos(th);
          const ca = Math.cos(rotA - Math.PI / 2), sa = Math.sin(rotA - Math.PI / 2);
          const ox = px * ca - py * sa, oy = px * sa + py * ca;
          const d = game.spawnDust?.(this.cx + ox, this.cy + oy, 0, 0, 27, 0, 0, 160);
          if (d) {
            d.scale = 1.1; d.noGravity = true;
            d.vx = this.vx * 0.1; d.vy = this.vy * 0.1;            // 原文先 ×0.1 再被覆写
            const nvx = this.cx - this.vx * 3 - d.x, nvy = this.cy - this.vy * 3 - d.y;
            const nl = Math.hypot(nvx, nvy) || 1;
            d.vx = (nvx / nl) * 1.25; d.vy = (nvy / nl) * 1.25;
          }
        }
      }
      const velA = Math.atan2(this.vy, this.vx);
      const sideOf = (sig: number): [number, number] => {
        const th = velA + (Math.random() * 2 - 1) * sig;      // RotatedByRandom(σ)=(r·2−1)·σ
        return [-Math.cos(th), -Math.sin(th)];                 // −(UnitX.Rot(θ))
      };
      if (Math.floor(Math.random() * 4) === 0) {
        const [ox, oy] = sideOf(0.19634954631328583);
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 31, 0, 0, 100);
        if (d) {
          d.vx *= 0.1; d.vy *= 0.1;
          d.x = this.cx + ox * this.w / 2; d.y = this.cy + oy * this.w / 2;
          d.fadeIn = 0.9;
        }
      }
      if (Math.floor(Math.random() * 32) === 0) {
        const [ox, oy] = sideOf(0.39269909262657166);
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 31, 0, 0, 155, null, 0.8);
        if (d) {
          d.vx *= 0.3; d.vy *= 0.3;
          d.x = this.cx + ox * this.w / 2; d.y = this.cy + oy * this.w / 2;
          if (Math.floor(Math.random() * 2) === 0) d.fadeIn = 1.4;
        }
      }
      if (Math.floor(Math.random() * 2) === 0) {
        for (let m = 0; m < 2; m++) {
          const [ox, oy] = sideOf(0.7853981852531433);
          const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 27, 0, 0, 0, null, 1.2);
          if (!d) break;
          d.vx *= 0.3; d.vy *= 0.3;
          d.noGravity = true;
          d.x = this.cx + ox * this.w / 2; d.y = this.cy + oy * this.w / 2;
          if (Math.floor(Math.random() * 2) === 0) d.fadeIn = 1.4;
        }
      }
    }
    //  · 270 骷髅髅骨（AI_001 :57061-57076 首拍 + :57658-57689 每拍）——首拍
    //    （localAI[0]==0）10×d5（scale2,α0,noGravity,vel=norm(Center−尘位)×−5+
    //    弹速/2,出生音 Item8 由发射点 bossAI.ts:138 承载）;每拍 2×d5（盒=position+
    //    (4,4) 缩 8,速=v×0.2,α100,scale1.5,position −= 弹速,noGravity,vel×0.3）
    if (this.projId === 270) {
      if (this.age === 1) {
        for (let i = 0; i < 10; i++) {
          const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 5,
            this.vx, this.vy, 0, null, 2);
          if (!d) break;
          d.noGravity = true;
          const nx = this.cx - d.x, ny = this.cy - d.y;
          const nl = Math.hypot(nx, ny) || 1;
          d.vx = (nx / nl) * -5 + this.vx / 2;
          d.vy = (ny / nl) * -5 + this.vy / 2;
        }
      }
      for (let k = 0; k < 2; k++) {
        const d = game.spawnDust?.(this.x + 4, this.y + 4, this.w - 8, this.h - 8, 5,
          this.vx * 0.2, this.vy * 0.2, 100, null, 1.5);
        if (d) {
          d.x -= this.vx; d.y -= this.vy;
          d.noGravity = true;
          d.vx *= 0.3; d.vy *= 0.3;
        }
      }
    }
    //  · 576 星旋弹（AI_001 :57278-57287,每 update）：5×d242（速=v 后清零,位 −= 弹速/
    //    5×i,noGravity,scale0.8,noLight）——本体 α=255+fadeDelay 门=尾尘即主要观感
    if (this.projId === 576) {
      for (let i = 0; i < 5; i++) {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 242,
          this.vx, this.vy, 100);
        if (!d) break;
        d.vx = 0; d.vy = 0;
        d.x -= (this.vx / 5) * i; d.y -= (this.vy / 5) * i;
        d.noGravity = true; d.scale = 0.8; d.noLight = true;
      }
    }
    //  · 538 加农弹上升期尾尘（aiStyle14 :25477-25492,vy<0 且 ai[0]<60 门）：
    //    1/4 掷 ×1×d180（位=Center 整覆写,scale+=rand(0..50)×0.01,noGravity,vel.Y−=2）+
    //    1/6 掷 ×1×d176（位=Center 整覆写,scale+=0.3+rand(0..50)×0.01,noGravity,vel×0.1）
    if (this.projId === 538 && this.vy < 0 && this.age < 60) {
      if (Math.floor(Math.random() * 4) === 0) {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 180);
        if (d) {
          d.x = this.cx; d.y = this.cy;
          d.scale += Math.floor(Math.random() * 50) * 0.01;
          d.noGravity = true;
          d.vy -= 2;
        }
      }
      if (Math.floor(Math.random() * 6) === 0) {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 176);
        if (d) {
          d.x = this.cx; d.y = this.cy;
          d.scale += 0.3 + Math.floor(Math.random() * 50) * 0.01;
          d.noGravity = true;
          d.vx *= 0.1; d.vy *= 0.1;
        }
      }
    }
    //  · 922 食人魔砸地冲击（AI_135_OgreStomp :69740-69855 尘面——★尘站普查批
    //    2026-09-16）。原文本支 = 扩张盒内逐格 KillTile+尘;本仓 922 无毁块面
    //    （行为债另账）,此处 1:1 移植尘站几何：ai[0]>9 Kill 不移植（本仓 life 240
    //    承载存量命面）,尘窗=ai[0]∈{3,6,9} 三波（num4=ai[0]/3）。
    //    盒 Size=16×Lerp(5,30,ai[0]/9)(num=30)→半宽 num3=Size/2;实心非框架格
    //    距心 ≤num3 内逐格：num5=KillTile_GetTileDustAmount(fail:true)——缺省 3
    //    （零尘/异型档为 Game.killTileHitDustAmount 单源,本载体不可反向 import,
    //    砸地目标=地面实心块恒走缺省档,登记近似）;d4 站 num4≥2 起（num5−1 粒）、
    //    d31 站 1/3 掷跳（3 粒,scale=2−num4×0.15+num7×0.5,num7=|心格−格|/(30/2)）
    if (this.projId === 922 && this.age <= 9 && this.age % 3 === 0) {
      const st922 = game.world.store;
      const num4 = Math.floor(this.age / 3);                      // 环号 1..3
      const half922 = 8 * (5 + (30 - 5) * Math.min(1, Math.max(0, this.age / 9)));
      const num3 = half922;                                       // width/2 = Size/2
      const num = 30;
      const tx0 = Math.floor((this.cx - half922) / 16), tx1 = Math.floor((this.cx + half922) / 16);
      const ty0 = Math.floor((this.cy - half922) / 16), ty1 = Math.floor((this.cy + half922) / 16);
      const ctX = Math.floor(this.cx / 16);                       // num2 = 心格 X
      for (let i = tx0; i <= tx1; i++) {
        for (let j = ty0; j <= ty1; j++) {
          if (!st922.inBounds(i, j)) continue;
          if (Math.hypot(this.cx - i * 16, this.cy - j * 16) > num3) continue;
          const ti = st922.idx(i, j);
          if (!st922.hasTile(i, j)) continue;
          const def = TILE_DEFS[st922.type[ti]];
          if (!def || !def.solid || def.platform || def.framed) continue;
          const num5 = 3;                                          // fail:true 缺省档（见注）
          if (num4 >= 2) {
            for (let l = 0; l < num5 - 1; l++) {
              const d = game.spawnDust?.(this.cx, this.cy, 12, 12, 4, 0, 0, 50,
                { r: 0, g: 160, b: 255, a: 150 }, 1.5);            // QueenSlime 色 A=150
              if (!d) break;
              d.vy -= 0.1 + num4 * 0.5;
              d.vy *= Math.random();
              d.vx *= (Math.random() * 2 - 1) * 3;                 // NextFloatDirection×3
              d.x = i * 16 + Math.floor(Math.random() * 16);
              d.y = j * 16 + Math.floor(Math.random() * 16);
              if (Math.floor(Math.random() * 3) !== 0) {
                d.vx *= 0.5; d.vy *= 0.5; d.noGravity = true;
              }
            }
          }
          if (Math.floor(Math.random() * 3) === 0) continue;       // num5<=0∨Next(3)==0 → skip
          const num7 = Math.abs(ctX - i) / (num / 2);
          for (let n = 0; n < 3; n++) {
            const d = game.spawnDust?.(this.cx, this.cy, this.w, this.h, 31, 0, 0, 50,
              { r: 0, g: 160, b: 255, a: 150 }, 2 - num4 * 0.15 + num7 * 0.5);
            if (!d) break;
            d.vy -= 0.1 + num4 * 0.5 + num7 * num4;
            d.vy *= Math.random();
            d.vx *= (Math.random() * 2 - 1) * 3;
            d.x = i * 16 + 20; d.y = j * 16 + 20;
            if (Math.floor(Math.random() * 3) !== 0) {
              d.vx *= 0.5; d.vy *= 0.5; d.noGravity = true;
            }
          }
        }
      }
    }
    // ---- ★BJ704-G11（件3,G10 登记债①清偿）AI_001 专属块 435/436/682 未扫面
    //      （Projectile.cs:55874-55898 435 火星炮塔弹 / :55107-55131 436 脑洗器弹 /
    //      :55900-55934 682 荧光虫电弧——逐员亲读补面;帧率 3t/4f（G10 件7）/
    //      spriteDirection=direction+尾分派旋转（G2/G10 件5）既有,此处余面）----
    //  · 435：首拍（ai1==0→1,本仓 age===1 单发门）Item12 + 点光(0.3,0.8,1.1)
    //    （:55876-55880/:55896——lightRGB 自报通道,459/94/1114 同款）;
    //  · 436：同构首拍 Item12 + 点光(0.3,1.1,0.5)（:55108-55112/:55130）;
    //  · 682：首拍 DD2_LightningBugZap 已由发射位 shootD2 PROJ_SHOT_SFX 承载（等
    //    价销案）;首拍 8×d272（vel×1 恒等+v×0.65 覆写、scale0.6、fadeIn0.8、
    //    noGravity+noLight、position+=尘速×3,:55903-55915）+ 点光(0.5,0.2,1.1)
    //    （:55933）。
    //  alpha−40/t 三员均【死码销案】：SetDefaults 无 α 行=0 起（:5058-5071/:7274-
    //  7285,vanilla-projectiles.json 同）,−40 钳 0 恒等;且 GetAlpha 435/436=A25/
    //  682=A127 fixed 档（:81133-81146）不读 α,ghost bodyAlpha=(255−α)/255 通道
    //  依赖 α≡0（459 判例同谳,G10 件10 注）。----
    if (this.projId === 435) {
      if (this.age === 1) game.playSfxFiles?.(['Item_12'], 1, this.x, this.y);   // :55876-55880
      this.lightRGB = [0.3, 0.8, 1.1];                                           // :55896
    } else if (this.projId === 436) {
      if (this.age === 1) game.playSfxFiles?.(['Item_12'], 1, this.x, this.y);   // :55108-55112
      this.lightRGB = [0.3, 1.1, 0.5];                                           // :55130
    } else if (this.projId === 682) {
      if (this.age === 1) {                                                      // :55902-55915
        for (let i = 0; i < 8; i++) {
          const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 272, 0, 0, 0);
          if (!d) break;
          d.vx += this.vx * 0.65; d.vy += this.vy * 0.65;    // vel×1 恒等（:55907）+v×0.65
          d.scale = 0.6; d.fadeIn = 0.8;                     // :55908-55909
          d.noGravity = true; d.noLight = true;              // :55910-55911
          d.x += d.vx * 3; d.y += d.vy * 3;                  // :55912 position += 尘速×3
        }
      }
      this.lightRGB = [0.5, 0.2, 1.1];                                           // :55933
    }
    // ---- ★L2 通用湿段（:16903-17113）——2026-09-06 ⑥杀拍口径抽为 wetSectionStep
    //      双调用点：本位=活拍原位（AI 链末/通用位移行前,位序注随方法）;
    //      AI 杀位早退时由 subStep dead 支补跑（wetSectionRan 防同子步双跑）。
    //      ★2026-09-08 平行副本收口:段体=projWetSection.projectileWetSection 共享体
    //      （自移植段体退役,逐值对拍/行为锁见 tests/arrow-wet-consolidation.test.ts）。
    this.wetSectionStep(game);
    // ★段内杀闩（收口批）:水death/80 补 Kill 当拍跳过段后位移/撞块链=退役副本
    //  「段内 killNow+return」早退语义（死亡拍位移跳过既案;本仓 cutTile 在 active
    //  门【外】,死拍放行会多砍——原版 CutTiles 受 :17131 `if (!active) return` 门拦）。
    if (this.wetSectionKilled) return;
    // aiStyle4 荆棘链：UpdatePosition 早退（Projectile.cs:20552）——链段全程静止，
    // 不消费速度位移（"接力推进"= 子段出生在父段前方一格速度处）
    // ★630 幻象弓载体同款早退（2026-09-02）：aiStyle75 无通用位移积分——velocity
    //   是纯姿态/重瞄向量,position 每拍由 AI_075 尾钉在玩家挂点（:68401）。若照常
    //   积分,钉位后被速度再推 11px = 载体沿瞄准向恒偏一格（2026-09-02 用户实报批）
    // ★水中位移阻尼（HandleMovement :17721-17764 → UpdatePosition :20555-20562
    //   `if (wet) position += wetVelocity;`）——wetVelocity = velocity×{微光 0.375/
    //   蜂蜜 0.25/水(含岩浆) 0.5},档位读湿段刚写下的【当拍】旗（projWaterDragFactor,
    //   档序 shimmer>honey>wet 与原文 if/else 链同构）;干态因子=1 恒等。直积分契约：
    //   因子乘进位移行——速度【场】vx/vy 任何情况下不被水阻改写（原版 wetVelocity
    //   是局部量,velocity 字段本身不动）;本类无 moveAndCollide body,"采纳处除回=
    //   速度场指数爆炸"债不涉（见 projWaterDragFactor 注）。aiStyle4/75 早退位原版
    //   即不进 UpdatePosition → 同样不吃阻尼;aiStyle 38/84/148 等其余 UpdatePosition
    //   早退型不在本类承载域。原版 HandleMovement 型别特支（flare 贴壁 lastVelocity、
    //   nail93 position+=velocity 等）为独立 position 写,不走 UpdatePosition→不阻尼,
    //   本仓对应位同样保持全速（★flare 原文 wet 时 lastVelocity/2 已于 2026-09-06
    //   随残差批落至贴壁支——型别特支与通用阻尼异构,该处不乘档位）。
    // SW-AQ1 2026-09-05：oldPosition 上报（Update :17118 `oldPosition = position`
    //  位序 = AI 后/HandleMovement 前——本行即 UpdatePosition 等效积分位,每子步刷新;
    //  thornChain/630 载体早退支 old≡新位 = 原版零位移拍 :19974 门不达同相）——
    //  中央压板扫描新旧位判定消费（Collision.cs:3346-3353/:3356）
    this.oldX = this.x; this.oldY = this.y;
    if (!this.thornChain && !(this.projId === 630 && this.ph630Ctl)) {
      const dragF = projWaterDragFactor(this);
      this.x += this.vx * dragF;
      this.y += this.vy * dragF;
    }
    // 喵刀弹 502：迪斯科点光（Projectile.cs:22613-22621 (Disco+0.5)/2）+ 拖尾采样
    if (this.projId === 502) {
      const n = 7;   // DoUpdate_AnimateDiscoRGB（Main.cs:19441-19496 六段 ±7/帧）
      switch (this.discoStyle) {
        case 0: this.discoG = Math.min(255, this.discoG + n); if (this.discoG >= 255) this.discoStyle++; break;
        case 1: this.discoR = Math.max(0, this.discoR - n); if (this.discoR <= 0) this.discoStyle++; break;
        case 2: this.discoB = Math.min(255, this.discoB + n); if (this.discoB >= 255) this.discoStyle++; break;
        case 3: this.discoG = Math.max(0, this.discoG - n); if (this.discoG <= 0) this.discoStyle++; break;
        case 4: this.discoR = Math.min(255, this.discoR + n); if (this.discoR >= 255) this.discoStyle++; break;
        default: this.discoB = Math.max(0, this.discoB - n); if (this.discoB <= 0) this.discoStyle = 0; break;
      }
      this.lightRGB = [(0.5 + this.discoR / 255) / 2, (0.5 + this.discoG / 255) / 2, (0.5 + this.discoB / 255) / 2];
      this.meowTrail.push(this.x, this.y);
      if (this.meowTrail.length > 20) this.meowTrail.splice(0, this.meowTrail.length - 20);   // oldPos 10 点
      for (const [k, v] of this.meowHitCd) {
        if (v <= 1) this.meowHitCd.delete(k); else this.meowHitCd.set(k, v - 1);
      }
      // ★碎片链收口刃（2026-09-28）：localImmuneCd 递减上收到 fixedUpdate 头（与
      //   spawnImmuneCd 同位,原版单数组公共面）——此处原 502 独占衰减删除防双衰减
    }
    const tx = Math.floor((this.x + this.w / 2) / TILE);
    const ty = Math.floor((this.y + this.h / 2) / TILE);
    if (!world.store.inBounds(tx, ty)) { this.killNow(game); return; }
    const tileType = world.store.get(tx, ty);
    // 星怒剑线上方穿墙（:22139-22143 越线前 tileCollide=false）与
    // noTileCollide 族（SetDefaults 逐型 325/329/348/350/351…，HandleMovement
    // 整段不跑）——撞块/砍草整段跳过（曾漏 = 月事件弹幕扎进地里被地形吞噬）
    // ★斗篷星 723 家族:SetDefaults tileCollide=false,原版 AI 越 ai1 线动态置
    //  tileCollide=true(:24101)——目标线之下必须碰块。starY 弹的碰块门只看
    //  starCollide(线上恒穿透/线下恒碰块);非 starY 弹维持 noTileCollide 原判
    const starNoHit = this.starY !== null ? !this.starCollide : this.noTileCollide;
    if (tileType !== 0 && !starNoHit) {
      // 可砍物（杂草/瓦罐）：Projectile.CutTiles 语义——原版 CutTiles 是 Damage()
      // 内的旁路副作用（Projectile.cs:11824，在 :15738 Damage 调用链内），不拦截命中
      game.cutTile(tx, ty);
      // 阻挡/消亡判定只看【实心】(Main.tileSolid 语义):树干/火把/平台等非实心格
      // 箭直接穿过,且【继续走下方命中管线】——曾对非实心格整体 return,把该 tick
      // 的 NPC/玩家命中全部跳过:训练假人(378 贴图格与 18×40 命中盒同位,穿过全程
      // 弹心都在 378 格内)子弹零命中穿体而过;草丛/树冠内的弹幕同样漏判。
      // 原版 HandleMovement 只在实心格 Kill(:16132),Damage 在其后独立运行(:15738)
      if (world.store.isSolid(tx, ty)) {
        // ★SW-FX34c 2026-09-18 弹幕 hoik 单向墙放行（用户实报"玩家能过、弹幕被挡"）：
        //  原版 Projectile.HandleMovement(:17578) 全路径 TileCollision 第 10 参 hoik=true
        //  （本类 hoik 字段注——显式 :17822-23/:17852 与缺省 :2299 两半）。消费面
        //  Collision.cs:2412(右行查身后格 (i-1,j) slope 2/4)/:2432(左行,(i+1,j)
        //  slope 1/3)——「实心墙格+配套坡邻」不拦;跨格态(:2437-2456)各支前提以
        //  移前盒判定全假=无推离 → 弹自由横穿 1 厚墙,velocity 不变 → flag 不置位
        //  （:18008 `lastVelocity != velocity`）→ 通用杀口（:19969-19973
        //  `else { position += velocity; Kill(); }`）不可达=原版弹幕能过单向墙。
        //  本类单点中心碰撞模型：中心格=弹心所在格,身后格判据与 moveAndCollide
        //  X 面(fx34b 玩家/fx34c 弹幕)/DirtBallProj(SW-AL2 F-3)同构;原版 hoik 豁免
        //  仅存在于 X 支 → 只在 X 主轴臂放行（|vx|>=|vy|,与 294/532 反射臂同约定）,
        //  Y 轴原版无 hoik 门照旧杀。放行=跳过整段撞块杀/反弹链（原版无碰撞事件,
        //  type 特支反弹全不达）,命中管线照跑（Damage 独立运行 :17184）。反向进入
        //  （身后格非齿）照杀=单向性保留;界外身后格=坡 0 不豁免（:2412 `i<1` 短路）。
        let hoikAdmit = false;
        if (this.hoik && this.vx !== 0 && Math.abs(this.vx) >= Math.abs(this.vy)) {
          const dirH = this.vx > 0 ? 1 : -1;
          const biH = tx - dirH;
          const bsH = biH >= 0 && biH < world.store.w ? world.store.slope[world.store.idx(biH, ty)] : 0;
          hoikAdmit = dirH > 0 ? (bsH === 2 || bsH === 4) : (bsH === 1 || bsH === 3);
        }
        if (!hoikAdmit) {
        // 钉 514 撞块（HandleMovement aiStyle 93 支 :18931-18941）：不消亡——
        // ai[1]=0/ai[0]=1 + tileCollide=false + position+=velocity + 速度 =
        // lastVelocity 归一×3 弹开（AI 侧 ×0.6/t 衰减、90t 消亡）
        if (this.nail93 && this.nailAi0 === 0) {
          this.nailAi1 = 0;
          this.nailAi0 = 1;
          this.noTileCollide = true;
          this.x += this.vx;
          this.y += this.vy;
          const nl = Math.hypot(this.vx, this.vy) || 1;
          this.vx = (this.vx / nl) * 3;
          this.vy = (this.vy / nl) * 3;
          return;
        }
        // 信号枪族贴壁（HandleMovement aiStyle 33 支 :18731-18745）：不消亡不反弹
        // ——position += lastVelocity（★2026-09-06 残差清偿：湿态 /2——:18733-18739
        // `if (wet) position += lastVelocity / 2f`,湿段(:16903)在 HandleMovement(:17120)
        // 前已刷新本拍旗,本仓 L2 湿段(:7185)同位先行 → this.wet 同构可用）再嵌入
        // 一步 + velocity 归零 + localAI[0]=1；此后 AI 侧 damage=0 停驻、块被挖/
        // 脱块即恢复下坠（localAI[1]=30 立即续坠 :27480-27483）
        if (this.flare) {
          if (this.flareStuck === 0) {
            const stickAdv = this.wet ? 0.5 : 1;      // :18733-18739
            this.x += this.vx * stickAdv;
            this.y += this.vy * stickAdv;
            this.vx = 0;
            this.vy = 0;
            this.flareStuck = 1;
          }
          return;
        }
        // aiStyle 14 弹跳弹（希腊火 326-328 / 装饰球 346）：撞块法向反弹不消亡
        if (this.bounce && this.bounceOff(game)) return;
        // 1457 宝石法珠 CanBounce（HandleMovement :18112-18150）：撞块法向反弹 ×0.8 +
        // penetrate--（归零消亡）——琥珀法珠/琥珀长袍臂。hitWall 族旗是 moveAndCollide
        // 分轴碰撞语义、本类裸位移不置位（曾据此判死=分支永假,反弹死代码）——
        // 到达本分支即已撞实心,按速度主轴定反射面:|vx|>|vy| 水平撞壁反 vx,否则反 vy
        if (this.gem?.canBounce) {
          if (Math.abs(this.vx) > Math.abs(this.vy)) this.vx = -this.vx * 0.8;
          else this.vy = -this.vy * 0.8;
          if (this.pierce > 0 && --this.pierce <= 0) { this.killNow(game); return; }
          return;
        }
        // 喵刀弹 502（AI_008 弹跳档 :18165-18206）：tink 音 + ai[0] 计数 ≥5 消亡；
        // 全速翻面（无 ×0.9 衰减——type 15 才有 ×0.8），同 hitSet 语义无
        if (this.projId === 502 && this.meowBounceOff(game)) return;
        // ---- ★BJ229 aiStyle 24 水晶风暴 94 撞块反射（HandleMovement type 段
        //      Projectile.cs:18811-18819）：无限次逐轴全速反 lastVelocity（vanilla
        //      `velocity.X != lastVelocity.X → −lastVelocity.X` 两轴独立,角撞双反),
        //      无音/无尘/无计数,penetrate 不因撞块消耗（反弹面与 NPC 穿透独立）。
        //      同 aiStyle 24 的 90/1134 无此支（落通用消亡口=原版同款;1114 走上方
        //      AI 专支湿杀,反射面同样无=原版同款）。
        if (this.projId === 94) {
          const st94 = game.world.store;
          const free94 = (px: number, py: number) => {
            const t0 = Math.floor(px / TILE), t1 = Math.floor(py / TILE);
            return st94.inBounds(t0, t1) && !st94.isSolid(t0, t1);
          };
          let hit94 = false;
          if (free94(this.x + this.w / 2 - this.vx, this.y + this.h / 2)) {
            this.x -= this.vx; this.vx = -this.vx; hit94 = true;      // X 撞臂(:18812-18815)
          }
          if (free94(this.x + this.w / 2, this.y + this.h / 2 - this.vy)) {
            this.y -= this.vy; this.vy = -this.vy; hit94 = true;      // Y 撞臂(:18816-18819)
          }
          if (hit94) return;
          // 双轴回退皆失败=嵌入过深 → 交还通用消亡口（532 档同契约）
        }
        // ---- ★BJ348b 星璇秘术球 617 撞块弱反弹（HandleMovement type 段
        //      Projectile.cs:18378-18388）：velocity.X!=lastVelocity.X →
        //      velocity.X = −lastVelocity.X×0.35（Y 轴同式独立）——不消亡、不耗
        //      penetrate、无音/无尘/无计数。撞墙衰减后 |v|<4 落 AI 慢速段（球体
        //      就地悬停+掷 618）=原版"球体弹墙驻场"链的入口。本仓单点碰撞无轴
        //      信息 → 逐轴回退探针反射（AI8/532 档同法）；双轴皆嵌=嵌入过深 →
        //      交还通用消亡口（532 档同契约）----
        if (this.projId === 617) {
          const st617b = game.world.store;
          const free617b = (px: number, py: number) => {
            const t0 = Math.floor(px / TILE), t1 = Math.floor(py / TILE);
            return st617b.inBounds(t0, t1) && !st617b.isSolid(t0, t1);
          };
          const freeX617 = free617b(this.x + this.w / 2 - this.vx, this.y + this.h / 2);
          const freeY617 = free617b(this.x + this.w / 2, this.y + this.h / 2 - this.vy);
          if (freeX617 || freeY617) {
            // 回退步=脱离嵌入（94/AI8 档同契约），反弹取入撞速度 ×0.35
            if (freeX617) { this.x -= this.vx; this.vx = -this.vx * 0.35; }   //（:18380-18382）
            if (freeY617) { this.y -= this.vy; this.vy = -this.vy * 0.35; }   //（:18383-18385）
            return;
          }
        }
        // ---- ★BJ229 aiStyle 8 魔法弹撞块反射族（HandleMovement aiStyle8 支
        //      Projectile.cs:19688-19725,1458:19689-19726 同值）：AI8_BOUNCE_PROJS
        //      五型,每撞 Item_10 音(:19689 无音量参=1.0)+ai[0]++ 计数;达帽 →
        //      position += velocity + Kill(:19704-19708);未达 → 逐轴全速反
        //      lastVelocity(:19716-19724,分轴独立角撞双反)。帽 num73:15=6/253=8/
        //      余 5(:19699-19703);27 熔岩态 ai[1]==1→7(:19696-19698)——熔岩支未接线
        //      （P2 债,水矢拖尾支同注）恒走 5。15 的 Y×0.8 衰减臂(:19710-19715)以
        //      截后残余 vy>4 为门,单点碰撞模型截后恒 0 → 不可达,登记同 496 Kill 臂。
        //      vanilla 按 velocity!=lastVelocity 分轴反射;本仓单点碰撞无轴信息 →
        //      逐轴回退探针反射（meowBounceOff 同法）;双轴皆嵌=嵌入过深 → 交还
        //      通用消亡口（532 档同契约,音/计不耗）----
        if (AI8_BOUNCE_PROJS.has(this.projId)) {
          const st8 = game.world.store;
          const free8 = (px: number, py: number) => {
            const t0 = Math.floor(px / TILE), t1 = Math.floor(py / TILE);
            return st8.inBounds(t0, t1) && !st8.isSolid(t0, t1);
          };
          const freeX8 = free8(this.x + this.w / 2 - this.vx, this.y + this.h / 2);
          const freeY8 = free8(this.x + this.w / 2, this.y + this.h / 2 - this.vy);
          if (freeX8 || freeY8) {
            this.ai8Bounces++;                                        // ai[0]++(:19692)
            game.playSfxFiles(['Item_10'], 1, this.cx, this.cy);      // (:19689 缺省音量 1.0)
            const cap8 = this.projId === 15 ? 6 : this.projId === 253 ? 8 : 5;   // (:19699-19703)
            if (this.ai8Bounces >= cap8) {
              this.x += this.vx; this.y += this.vy;                   // position += velocity(:19706)
              this.killNow(game);
              return;
            }
            if (freeX8) { this.x -= this.vx; this.vx = -this.vx; }
            if (freeY8) { this.y -= this.vy; this.vy = -this.vy; }
            return;
          }
        }
        // 荆棘球 277 专属档（Projectile.cs:18306-18314）：vx 恒反 ×0.9；
        // 仅入撞 |vy|>3 竖弹 ×0.9（贴地滚动）
        if (this.thornBounce && this.thornBounceOff(game)) return;
        // 1021 月总巨砾弹地档（Projectile.cs:17578-17600）：Y 撞 Dig 音+×−0.9
        // 反弹 / X 撞 ×−0.75 计 3 次超次消亡（false 交还下方消亡口）
        if (this.mlBoulder && this.boulderBounceOff(game)) return;
        // 225 叶绿箭撞块弹反（HandleMovement type 段 Projectile.cs:17128-17150）：
        // ai[1] 计数（首跳伤 ×0.66 :17131-17134）、第 4 撞 Kill（:17135-17139）、
        // 全速反 lastVelocity + FindTargetWithLineOfSight 归巢（:17140-17150）
        if (this.projId === 225 && this.chloroBounceOff(game)) return;
        // 451 涌流剑撞块（HandleMovement type 段 :18222-18227）：ai[0]=1、ai[1]=0、
        // v = lastVelocity/2 → 走命中后淡出支（ai[0]==1 → alpha 满即 Kill）
        if (this.projId === 451) {
          this.iwAi0 = 1;
          this.iwAi1 = 0;
          this.vx *= 0.5;
          this.vy *= 0.5;
          return;
        }
        // ★R28 §1 294 暗影束无限墙反弹（HandleMovement :18976-18984：速度分量
        // 全速反号、penetrate −1 不因撞块死）+ 编排束铺撒（上一锚点→当前位置,
        // Spawn_Shadowbeam :1987-2005 步距 max(4,|v|)×3 枚 d173）后重锚。
        // ★原版按 TileCollision 分轴反射;本仓单点碰撞无轴信息,按速度主轴反射（登记）
        if (this.projId === 294) {
          if (Math.abs(this.vx) > Math.abs(this.vy)) this.vx = -this.vx;
          else this.vy = -this.vy;
          // 门=localAI[0] >= delay(:19000) ∧ 锚点双正(:19009 num40>0f && num41>0f)
          if (this.sbL0 >= 9 && (this.sbAx > 0 && this.sbAy > 0)) {
            this.shadowbeamSegment(game);
            game.broadcastParticleOrchestra?.(Arrow.SHADOWBEAM_ORCHESTRA_IDX, this.cx, this.cy,
              this.sbAx, this.sbAy, Math.round(Math.hypot(this.vx, this.vy) * 1000));
          }
          this.sbAx = this.cx; this.sbAy = this.cy;
          return;
        }
        // ---- ★SW-FX1 532 骨手套骨弹撞块弹反（HandleMovement type 段
        //      Projectile.cs:18259-18278）：X 撞 velocity.X = lastX×−0.75;Y 撞
        //      （lastY>2f ∨ 截后 Y==0——「轴被截停」语境下后项恒真）velocity.Y =
        //      lastY×−0.75;任一命中 → num18=|last|/|v|（0 守卫 1,vel=0 时 C#
        //      float=Inf→v 归零同语义）velocity /= num18 + HitTiles + penetrate--。
        //      原版按 velocity!=lastVelocity 分轴反射;本仓单点碰撞无轴信息 →
        //      按速度主轴反射（294/蜂族档同法,登记）。回退步=脱离嵌入（bounceOff
        //      契约:回退失败=嵌入过深 → 交还通用消亡口）。pierce 归零消亡
        //      （蜂族档同语义;穿透 3 = 最多 3 次弹反）----
        if (this.projId === 532 && this.pierce > 0) {
          const lastVx532 = this.vx, lastVy532 = this.vy;   // 本仓无截断回写 → 入撞速≙lastVelocity
          const solidCenter = () => {
            const t0 = Math.floor((this.x + this.w / 2) / TILE), t1 = Math.floor((this.y + this.h / 2) / TILE);
            return world.store.inBounds(t0, t1) && world.store.isSolid(t0, t1);
          };
          let nvx = lastVx532, nvy = lastVy532, flag10 = false;
          if (Math.abs(lastVx532) >= Math.abs(lastVy532)) {       // X 撞臂（:18262-18265 无速门）
            this.x -= lastVx532;                                  // 回退脱离（单点碰撞模型位置已入撞）
            if (!solidCenter()) { nvx = lastVx532 * -0.75; flag10 = true; }
            else this.x += lastVx532;                             // 回退无效=嵌入过深 → 通用消亡
          } else {                                                // Y 撞臂（:18266-18269）
            this.y -= lastVy532;
            if (!solidCenter()) { nvy = lastVy532 * -0.75; flag10 = true; }
            else this.y += lastVy532;
          }
          if (flag10) {
            const lastLen = Math.hypot(lastVx532, lastVy532);
            const velLen = Math.hypot(nvx, nvy);
            const num18 = lastLen === 0 ? 1 : lastLen / velLen;     // :18271-18276（vel=0→Inf→v/Inf=0 同 C# float）
            this.vx = nvx / num18;
            this.vy = nvy / num18;
            this.pierce--;
            game.hitTilesFx?.(this.x, this.y, this.w, this.h, lastVx532, lastVy532);   // :18277 HitTiles(position,lastVelocity,…)
            if (this.pierce <= 0) { this.killNow(game); return; }
            return;
          }
        }
        // ---- ★SW-FX1 937 挥发凝胶撞块弹反（HandleMovement type 段 :18602-18613,
        //      921||926||937 共支）:X 撞 |lastX|>1 → ×−0.4;Y 撞 |lastY|>1 → ×−0.95;
        //      penetrate--（归零落通用消亡口=穿透 3 → 最多 3 次弹反）。分轴反射按
        //      速度主轴近似 + 回退脱离（532 档同法,登记）----
        if (this.projId === 937 && this.pierce > 0) {
          const lastVx937 = this.vx, lastVy937 = this.vy;
          const solidCenter937 = () => {
            const t0 = Math.floor((this.x + this.w / 2) / TILE), t1 = Math.floor((this.y + this.h / 2) / TILE);
            return world.store.inBounds(t0, t1) && world.store.isSolid(t0, t1);
          };
          let bounced937 = false;
          if (Math.abs(lastVx937) >= Math.abs(lastVy937)) {
            this.x -= lastVx937;
            if (!solidCenter937()) {
              if (Math.abs(lastVx937) > 1) this.vx = -lastVx937 * 0.4;    // |lastX|>1 门
              bounced937 = true;
            } else this.x += lastVx937;
          } else {
            this.y -= lastVy937;
            if (!solidCenter937()) {
              if (Math.abs(lastVy937) > 1) this.vy = -lastVy937 * 0.95;   // |lastY|>1 门
              bounced937 = true;
            } else this.y += lastVy937;
          }
          if (bounced937) {
            this.pierce--;
            if (this.pierce <= 0) { this.killNow(game); return; }
            return;
          }
        }
        // ---- ★BJ252 HandleMovement 碰撞反应面清债批（全方法 :17578-19980 亲读
        //      普查,1458 同段逐字节全等=零增量）——四支同形反射刀。逐轴回退探针
        //      反射（94 档同法：单点碰撞模型无被撞轴信息,探针步退格空=该轴被撞;
        //      双轴皆嵌=嵌入过深 → 交还通用消亡口,94/532 档同契约登记）----
        // ① 604 泰拉悠悠球孢子云（:18554-18564;603 命中侧衍生=活载体 WeaponProj
        //    yoyo 603 孢子支）：被撞轴全速反 lastVelocity,两轴独立;无计数/音尘/
        //    penetrate 消耗（原版无限弹反）。
        if (this.projId === 604) {
          const st604 = game.world.store;
          const free604 = (px: number, py: number) => {
            const t0 = Math.floor(px / TILE), t1 = Math.floor(py / TILE);
            return st604.inBounds(t0, t1) && !st604.isSolid(t0, t1);
          };
          let hit604 = false;
          if (free604(this.x + this.w / 2 - this.vx, this.y + this.h / 2)) {
            this.x -= this.vx; this.vx = -this.vx; hit604 = true;      // X 撞臂(:18556-18559)
          }
          if (free604(this.x + this.w / 2, this.y + this.h / 2 - this.vy)) {
            this.y -= this.vy; this.vy = -this.vy; hit604 = true;      // Y 撞臂(:18560-18563)
          }
          if (hit604) return;
        }
        // ② 926 史莱姆皇后凝胶弹（:18602-18613 的 921||926||937 共支;926=皇后史
        //    莱姆 AI shoot() 活载体,921 载体 NPC 659 未移植=dormant）：X 撞
        //    |lastX|>1 → ×−0.4;Y 撞 |lastY|>1 → ×−0.95。★vanilla 支尾 penetrate--
        //    对 926 不可观测（恒 hostile,penetrate 仅被弹反消费=写不读,死亡面=
        //    timeLeft）→ 本仓不耗 pierce 不消亡（弹反无限）——与 937 友方支的
        //    pierce 共享计数语义异构,勿合并。
        if (this.projId === 926) {
          const st926 = game.world.store;
          const free926 = (px: number, py: number) => {
            const t0 = Math.floor(px / TILE), t1 = Math.floor(py / TILE);
            return st926.inBounds(t0, t1) && !st926.isSolid(t0, t1);
          };
          let hit926 = false;
          if (free926(this.x + this.w / 2 - this.vx, this.y + this.h / 2)) {
            this.x -= this.vx;
            if (Math.abs(this.vx) > 1) this.vx = -this.vx * 0.4;       // :18604-18606 门内写
            else this.vx = 0;                                          // 门内不写=截停轴零速
            hit926 = true;
          }
          if (free926(this.x + this.w / 2, this.y + this.h / 2 - this.vy)) {
            this.y -= this.vy;
            if (Math.abs(this.vy) > 1) this.vy = -this.vy * 0.95;      // :18607-18610 门内写
            else this.vy = 0;
            hit926 = true;
          }
          if (hit926) return;
        }
        // ③ 969 天气之痛弹（:18614-18624;WeatherPain 5118 通用魔法兜底=活载体）：
        //    被撞轴 |last|>1 → ×−0.75（全速档 0.75）;门内不写=截停轴保持钳后
        //    零速（本类无截断回写 → 显式置 0 同语义）;无计数/无消亡。
        if (this.projId === 969) {
          const st969 = game.world.store;
          const free969 = (px: number, py: number) => {
            const t0 = Math.floor(px / TILE), t1 = Math.floor(py / TILE);
            return st969.inBounds(t0, t1) && !st969.isSolid(t0, t1);
          };
          let hit969 = false;
          if (free969(this.x + this.w / 2 - this.vx, this.y + this.h / 2)) {
            this.x -= this.vx;
            this.vx = Math.abs(this.vx) > 1 ? -this.vx * 0.75 : 0;     // :18616-18619
            hit969 = true;
          }
          if (free969(this.x + this.w / 2, this.y + this.h / 2 - this.vy)) {
            this.y -= this.vy;
            this.vy = Math.abs(this.vy) > 1 ? -this.vy * 0.75 : 0;     // :18620-18623
            hit969 = true;
          }
          if (hit969) return;
        }
        // ③b 617 星璇秘术弹（:18378-18388;星璇秘术 3476 通用魔法兜底=活载体）：
        //    被撞轴 ×−0.35（无条件,双轴独立）,无计数/无消亡。
        if (this.projId === 617) {
          const st617 = game.world.store;
          const free617 = (px: number, py: number) => {
            const t0 = Math.floor(px / TILE), t1 = Math.floor(py / TILE);
            return st617.inBounds(t0, t1) && !st617.isSolid(t0, t1);
          };
          let hit617 = false;
          if (free617(this.x + this.w / 2 - this.vx, this.y + this.h / 2)) {
            this.x -= this.vx; this.vx = -this.vx * 0.35; hit617 = true;   // :18380-18383
          }
          if (free617(this.x + this.w / 2, this.y + this.h / 2 - this.vy)) {
            this.y -= this.vy; this.vy = -this.vy * 0.35; hit617 = true;   // :18384-18387
          }
          if (hit617) return;
        }
        // ④ 931/1039 光女魔弹/星座弹（:18704-18714;931=夜光 4952 通用魔法兜底=
        //    活载体,1039 由 931 命中 proc 衍生（P.cs:15033）=衍生面未移植 dormant
        //    同支免费承接）：被撞轴全速反,两轴独立,无计数/无消亡。
        if (this.projId === 931 || this.projId === 1039) {
          const st931 = game.world.store;
          const free931 = (px: number, py: number) => {
            const t0 = Math.floor(px / TILE), t1 = Math.floor(py / TILE);
            return st931.inBounds(t0, t1) && !st931.isSolid(t0, t1);
          };
          let hit931 = false;
          if (free931(this.x + this.w / 2 - this.vx, this.y + this.h / 2)) {
            this.x -= this.vx; this.vx = -this.vx; hit931 = true;      // :18706-18709
          }
          if (free931(this.x + this.w / 2, this.y + this.h / 2 - this.vy)) {
            this.y -= this.vy; this.vy = -this.vy; hit931 = true;      // :18710-18713
          }
          if (hit931) return;
        }
        // ⑤ 116 光束剑波（真圣剑 723 shoot=116 itemcombat 已核;:19918-19943）：
        //    ai[2]++ 计数;<4 → Item_10 音（缺省音量）+ 30×d64（Color.White/α100/
        //    scale1.8/noGravity/velocity×=rand(1,7)=1..6——×rand 乘在 NewDust 内在
        //    扰动上,本仓 spawnDust 已含 64 号 :207-213 特例族）+ 被撞轴全速反;
        //    ≥4 → 不 return 落通用消亡口（Kill 面 Item_10+迹尘由
        //    Game.onProjectileDeath 116 支 :78804-78815 承载,勿双补）。
        if (this.projId === 116) {
          this.beam116Bounces++;
          if (this.beam116Bounces < 4) {
            game.playSfxFiles(['Item_10'], 1, this.cx, this.cy);       // :19923
            for (let i = 0; i < 30; i++) {
              const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 64, 0, 0, 100,
                { r: 255, g: 255, b: 255, a: 255 }, 1.8);
              if (!d) break;
              d.noGravity = true;                                      // :19927
              const m116 = 1 + Math.floor(Math.random() * 6);          // Next(1,7)=1..6
              d.vx *= m116; d.vy *= m116;                              // :19928
            }
            const st116 = game.world.store;
            const free116 = (px: number, py: number) => {
              const t0 = Math.floor(px / TILE), t1 = Math.floor(py / TILE);
              return st116.inBounds(t0, t1) && !st116.isSolid(t0, t1);
            };
            let hit116 = false;
            if (free116(this.x + this.w / 2 - this.vx, this.y + this.h / 2)) {
              this.x -= this.vx; this.vx = -this.vx; hit116 = true;    // :19930-19933
            }
            if (free116(this.x + this.w / 2, this.y + this.h / 2 - this.vy)) {
              this.y -= this.vy; this.vy = -this.vy; hit116 = true;    // :19934-19937
            }
            if (hit116) return;
            // 双轴皆嵌=嵌入过深 → 交还通用消亡口（94 档同契约,登记）
          }
          // ai[2]>=4（第 4 撞）→ Kill(:19939-19942),不 return=落下方通用口
        }
        // ⑥ 409 剃刀台风（★BJ260 S1 漏修#1；HandleMovement type 段 :18629-18638,
        //    1458 同段逐字节全等）：被撞轴全速反 lastVelocity——无 |last|>1 门、
        //    无计数、无消亡、不耗穿透（SetDefaults :4905-4917 penetrate=−1/
        //    tileCollide=true/aiStyle71/extraUpdates=2,活载体=剃刀台风 2622,
        //    猪鲨 370 掉落链）。原版写 `velocity.X = lastVelocity.X * -1f`——
        //    反的是 HandleMovement 入口速度,本仓无截断回写 → −this.vx 同值
        //    （94/931 档同式）;两轴独立,角撞双反。曾缺=首撞即落通用消亡口。
        if (this.projId === 409) {
          const st409 = game.world.store;
          const free409 = (px: number, py: number) => {
            const t0 = Math.floor(px / TILE), t1 = Math.floor(py / TILE);
            return st409.inBounds(t0, t1) && !st409.isSolid(t0, t1);
          };
          let hit409 = false;
          if (free409(this.x + this.w / 2 - this.vx, this.y + this.h / 2)) {
            this.x -= this.vx; this.vx = -this.vx; hit409 = true;    // :18631-18634
          }
          if (free409(this.x + this.w / 2, this.y + this.h / 2 - this.vy)) {
            this.y -= this.vy; this.vy = -this.vy; hit409 = true;    // :18635-18638
          }
          if (hit409) return;
          // 双轴皆嵌=嵌入过深 → 交还通用消亡口（94 档同契约,登记）
        }
        // ---- 496 暗影炎箭撞块（HandleMovement type 段 :18822-18843）——★R2-01 翻案
        //      （2026-09-03 蓝队）：原版以 `velocity != lastVelocity` 检被撞轴
        //      （lastVelocity=HandleMovement 入口速度 :17696,即 AI 后/截断前），
        //      门内 |截后轴速|<1 → velocity = −lastVelocity（全速反弹），else Kill()
        //      （:18824-18830 / :18831-18841）。实心正撞时 TileCollision 把该轴截为
        //      0 → 残余恒 0 → 恒落 <1 反射支：快弹撞墙=反弹而非碎裂（同段 94 水矢/
        //      311/312/522/620/524 无门槛全速反同构）；≥1 Kill 支只被斜坡/半砖等
        //      部分截断（残余≥1）触发。★本仓位移先于撞块判定（无截断回写）→ 到达
        //      本支即等价残余 0，Kill 支在单点碰撞模型下不可达——照 294/285/蜂族档
        //      全速反【速度主轴】、不消亡（分轴近似同前档登记；原版 Kill() 无爆炸/
        //      音特支，本仓通用消亡口亦不受此改影响）----
        if (this.projId === 496) {
          if (Math.abs(this.vx) >= Math.abs(this.vy)) this.vx = -this.vx;   // :18824-18827
          else this.vy = -this.vy;                                          // :18831-18837
          return;
        }
        // ---- ★BJ642 喷火器 85/1106 撞块滑移（HandleMovement type 段
        //      Projectile.cs:18414-18417；1458 同段逐字）：碰撞事件拍不消亡——
        //      velocity = lastVelocity×0.95 + position -= velocity（退步脱壁）。
        //      火舌贴壁驻留继续阻尼至 72 子步寿终（AI_193 寿命面收口）——此前落
        //      通用消亡口=首撞即碎。本仓单点碰撞无截断回写 → 入撞速≙lastVelocity
        //      （94/496 档同约定）：v=v×0.95 后 position -= v（vanilla 先赋值后退步,
        //      退步量=新速度）----
        if (this.projId === 85 || this.projId === 1106) {
          this.vx *= 0.95; this.vy *= 0.95;                                 // velocity = lastVelocity*0.95f
          this.x -= this.vx; this.y -= this.vy;                             // position -= velocity
          return;
        }
        // ---- 蜂族撞块弹反（HandleMovement type 段 :19019-19030，★T1 批 2026-09-01
        //      补齐——181/189/357/566 四型 penetrate>0 时撞实心块不消亡）：
        //      penetrate--（与命中敌共用同一穿透计数）+ 速度全速反号。357 每弹反
        //      伤 ×0.9（(int) 截断，181/189/566 无折价）。原版按 `velocity !=
        //      lastVelocity` 分轴反射（被撞轴反号）；本仓单点碰撞无轴信息——
        //      与上方 294 暗影束臂同法按速度主轴反射（登记）；pierce 归零后不再入
        //      本支 → 落下方通用消亡口（原版 `penetrate > 0` 门同语义）----
        if ((this.projId === 181 || this.projId === 189 || this.projId === 357 || this.projId === 566)
          && this.pierce > 0) {
          if (this.projId === 357) this.damage = Math.max(1, Math.trunc(this.damage * 0.9));
          this.pierce--;
          if (Math.abs(this.vx) > Math.abs(this.vy)) this.vx = -this.vx;
          else this.vy = -this.vy;
          return;
        }
        // ---- ★批五：285 纳米弹/477 水晶飞镖撞块弹反（HandleMovement type 段
        //      Projectile.cs:18675-18701 / :18756-18774，2026-09-01 全弹域审计批）----
        //  285 NanoBullet：ai[1] 计数、首撞伤 ×0.66（(int) 截断）、第 2 撞 Kill；
        //      全速反 lastVelocity + FindTargetWithLineOfSight 归巢（默认 800px
        //      LOS 门 :46466，直瞄中心 :18697-18701——与 225 的高度偏移归巢不同式；
        //      本仓 nearestEnemyWithLos 直线可视近似同 chloroBounceOff 口径）。
        //  477 CrystalDart：★F4 重写（下方独立支）——Kill 序修正 + 撞块归巢补段
        //      （:18776-18813 随机取样 9 收集枚之一全速转向）;rotation 速度角重锚
        //      =下方支尾 dartRot 重锚（★E′ M-3 补,:18773,见独立支注）。
        //      两型原版按 velocity!=lastVelocity 分轴反射；本仓单点碰撞按速度
        //      主轴反射（294/蜂族档同法，登记）----
        if (this.projId === 285) {
          this.proj285Ai1++;
          if (this.proj285Ai1 === 1) this.damage = Math.max(1, Math.trunc(this.damage * 0.66));
          if (this.proj285Ai1 >= 2) { this.killNow(game); return; }
          if (Math.abs(this.vx) > Math.abs(this.vy)) this.vx = -this.vx;
          else this.vy = -this.vy;
          const tgt285 = this.nearestEnemyWithLos(game, 800);
          if (tgt285) {
            const dx285 = tgt285.cx - this.cx, dy285 = tgt285.cy - this.cy;
            const dl285 = Math.hypot(dx285, dy285);
            const sp285 = Math.hypot(this.vx, this.vy);
            if (dl285 > 0) { this.vx = (dx285 / dl285) * sp285; this.vy = (dy285 / dl285) * sp285; }
            else { this.vx = 0; this.vy = -sp285; }
          }
          return;
        }
        // ★F4（红队 A 仲裁定罪,2026-09-02）①Kill 序（:18758-18764）：原版
        //      penetrate-- 后 ≤0 即 Kill,且 damage ×0.85 在同一拍【无条件】执行
        //      （Kill 分支内仍继续跑反弹/rotation/归巢,对死体零观感）——旧实现
        //      `pierce > 0` 前置门把归零拍整个跳过支（落通用消亡口,少一次 ×0.85
        //      折价+弹反不执行）;JS 惯例先杀先 return,登记 ±0 观感。
        //      ②归巢补段（:18776-18813,原版在 HandleMovement type477 支内=每次
        //      撞块事件触发;`owner == Main.myPlayer` 门=本仓单机语义恒真）——
        //      收集 (20,700) 距离内 CanHitLine(弹心 1×1→敌心) 敌怪 ≤9 个
        //      （严格 >20 且 <700）→ Main.rand.Next(n) 随机取一枚全速转向
        //      v=归一(目标心−弹心)×|v|;rotation 速度角重锚=支尾 dartRot 重锚
        //      （★E′ M-3 补,:18773——477 不在 PROJ_ROT_RIGHT,旧注"由通用绘制式
        //      覆盖"系误记;实际消费位=draw 侧 :2525 dartRot 档）。
        //      ★归巢实现选型：nearestEnemyWithLos「取最近」不合原版（随机取样）,
        //      复用本文件 297/659 支同式 canHitLine 物理工具+canBeChasedBy 门,
        //      Center 1×1 盒以 0 尺寸点近似（本文件既有口径）。
        if (this.projId === 477) {
          this.damage = Math.max(1, Math.trunc(this.damage * 0.85));
          this.pierce--;
          if (this.pierce <= 0) { this.killNow(game); return; }   //（:18761-18764）
          if (Math.abs(this.vx) > Math.abs(this.vy)) this.vx = -this.vx;
          else this.vy = -this.vy;
          // ★T4：收集改走共用函数 collectHomingTargets477（excludeId=null=撞块侧
          //  原版无 victimIndex 豁免;行为与原内联收集零变）
          const cands477 = this.collectHomingTargets477(game, null);
          if (cands477.length > 0) {
            const pick477 = cands477[Math.floor(Math.random() * cands477.length)];   // Main.rand.Next(num30)
            const dx477 = pick477.x - this.cx, dy477 = pick477.y - this.cy;
            const dl477 = Math.hypot(dx477, dy477) || 1;
            const sp477 = Math.hypot(this.vx, this.vy);
            this.vx = (dx477 / dl477) * sp477;
            this.vy = (dy477 / dl477) * sp477;
          }
          // ★E′ M-3（2026-09-02 仲裁成立）：撞块支 rotation 重锚——原版 :18773
          //  `rotation = velocity.ToRotation() + MathF.PI/2`（支体 :18756-18775,
          //  仲裁锚 :18771 系同支上一行 bounce 轴写,勘误至此）,置于转向/归巢【后】
          //  =新速度角,补 dartRot 在反弹/归巢拍残留旧角度的滞后;下一 AI 步 :58666
          //  平滑链以 (rot×2+aim)/3 续承。
          this.dartRot = Math.atan2(this.vy, this.vx) + Math.PI / 2;
          return;
        }
        // ---- 绳索线圈弹 171/475/505/506（aiStyle35 :27581-27720，2026-08-30 工单1
        //      扩 171=普通绳圈,AI_035 默认支 num274=213 :27619 对任意 aiStyle35 生效）：
        //      撞块 → 自撞点列向下先滑过既有绳(WorldGen.IsRope),再向空格铺 ≤10 格
        //      绳(num274 映射 475→353/506→366/505→365/default213;平台翻门 flag15/
        //      斩草 KillTile 分支未建模登记),铺完 Kill。飞行物理=AI_035 原版档
        //      (0.2@30/vx×0.985,ctor 绳圈自校正块)。
        //      ★锚点=碰撞格沿速度主轴回退一格——原版 position+=vector27 后 Center
        //      落在【贴近撞面的空气格】(:27637-27641 从钳制后位取格),本仓检测位是
        //      实心格本身,不回退则起铺格 isActive 直接 break(零铺绳,实测坑)----
        if (ROPE_COIL_TILE[this.projId] !== undefined) {
          const stRc = game.world.store;
          const rtKey = ROPE_COIL_TILE[this.projId];
          const rtId = TILE_BY_KEY[rtKey];
          let rcx = Math.floor(this.cx / TILE);
          let rcy = Math.floor(this.cy / TILE);
          // 撞面回退（见上注）：沿速度主轴向反方向退一格取空气邻格作起铺锚
          if (Math.abs(this.vx) >= Math.abs(this.vy)) {
            const bx2 = rcx - Math.sign(this.vx);
            if (stRc.inBounds(bx2, rcy) && !stRc.isActive(bx2, rcy)) rcx = bx2;
          } else {
            const by2 = rcy - Math.sign(this.vy);
            if (stRc.inBounds(rcx, by2) && !stRc.isActive(rcx, by2)) rcy = by2;
          }
          while (stRc.inBounds(rcx, rcy) && TILE_DEFS[stRc.get(rcx, rcy)]?.rope) rcy++;   // IsRope 下滑
          let placedRc = 0;
          for (let n = 0; n < 10; n++, rcy++) {
            if (!stRc.inBounds(rcx, rcy) || stRc.isActive(rcx, rcy)) break;
            stRc.setTile(rcx, rcy, rtId, 0, 0);
            placedRc++;
          }
          this.ropeAi1 += placedRc;      // ≡ ai[1]++（:27699，killNow 返还口消费）
          if (placedRc > 0) {
            game.recLog?.('tile', { x: rcx, y: rcy, from: 0, to: TILE_DEFS[rtId]?.key ?? rtKey, cause: 'ropeCoil', n: placedRc });
          }
          this.killNow(game);
          return;
        }
        // 实心块：消亡,无回收。★SW-FX9（2026-09-10,裁决执行）：本仓旧 1/3 落地回收
        // （rand<1/3 spawnDrop(dropKey)）整链摘除——原版 Projectile.Kill 全文对账:
        // 箭族支 type==1/81/98/980/1073 仅 Sound 0+10×d7（P.cs:75447-75454）、
        // 投掷支 3/48/54/599/909 仅 Sound 0+10×d1（P.cs:77221-77230）,均无任何
        // Item.NewItem/RequestNewItem;!noDropItem 段（P.cs:79099-79360）只含
        // aiStyle10 放块族（num18 兜底件）/985·965 砂球/3005·2996·3077-3080/
        // 75 陨星/859/4743,Player.cs 全文件 RequestNewItem 清单亦无落地拾取链
        // ——原版弹药【恒消耗】。旧 2026-09-01"维持不删"注退役,tests/orphan-b1
        // "机制在位"对照钉同步退役（新钉=零回收,tests/sw-fx9-arrow-recovery）。
        // ★批 3 摘除(K 代理 HitTiles 全量化):撞块砖屑已由 Game.onProjectileDeath 的
        // hitTilesFx 真值单口承载（BULLET_KILL_SFX 支,几何 1:1+mapColor 尘）——此处
        // 4×d7 通用碎屑近似与真值双撒,退役（音面仍由 OPD BULLET_KILL_SFX 播,不变）
        this.killNow(game);
        return;
        } // ★SW-FX34c hoikAdmit 包裹层闭合——放行弹跳过整段撞块杀/反弹链,直落命中管线
      }
    }
    // ★BJ290 件1（死亡段割面族 BJ260/285 同款前置习语,2026-09-23）：CutTiles
    //  （P.cs:12517）在 Damage() 内先于 Damage_PVE（:12523）——木箭等 aiStyle1/2
    //  有限穿透弹（1/2/3/48/54…penetrate 1）命中即亡拍（穿透耗尽 killNow,下敌环
    //  与城镇 NPC 支）【照割】;本仓中央割（Entity.ts）!e.dead 门=死亡拍整缺 →
    //  前置弹盒上报（=原版 Damage() 头位,下环 hurt 前序 1:1）。门 = 原版 :12516
    //  friendly&&owner&&!npcProj&&!minion（本位=!hostile&&!reflected——反射弹原版
    //  已翻转敌对无割面）;幂等双报（活拍与中央割同 Arrow 惯例）。★:8139 撞块割草
    //  面（HandleMovement 域,弹在=活拍）分域勿混。盖 318 臭蛋（:8704 死亡位）/
    //  小动物（:8719）/敌怪穿透（:9183）/城镇 NPC（:9192）四个死亡位。
    if (!this.hostile && !this.reflected) cutTilesBox(game, this.x, this.y, this.w, this.h);
    // 敌对弹命中玩家（原版 Projectile.Damage_EVP :13706-13830）：不消耗弹体，
    // Player.damage 自带 iframes 去重（= 原版 player.immune 门禁）；
    // 实际造成伤害才走 StatusPlayer 的 debuff 授予（:13798-13800；
    // 276 毒种子的中毒授予在 statusPlayer case 276）
    // ★BJ252 872 永恒彩虹：Colliding 特支（:15761-15775）以 oldPos 步 2 的 25 槽
    //   锚定盒替换默认盒判定——player/镇民两面同源（原版 Colliding 为一切受领面
    //   的统一受理门）
    const trailCollide872 = this.projId === 872 ? this.empress872TrailCollide() : undefined;
    if (this.hostile && hitPlayer(this, game, this.damage, false, false, trailCollide872)) statusPlayer(game, this.projId);
    // 敌对弹命中城镇 NPC(原版 flag2 分支:hostile && victim.friendly,Projectile.cs:11975-11976);
    // 不消耗弹体(原版该分支不动 keepIterating)
    if (this.hostile) hitTownNpcs(this, game, this.damage, 0, 'hostile', 0, trailCollide872);
    // ★红队 A-2 收口①：damage<=0 的友方弹不入城镇 NPC 窄门——原版 Damage_PVE 头
    //   `if (damage <= 0) return`（P.cs:12576）先于【一切】NPC 命中面,窄门也在段内
    // ★BJ452 N4：局部免疫族城镇面补档（usesLocalNPCImmunity+localNPCHitCooldown 数据
    //   驱动,642 月门弹 cd10 P.cs:6906-6916）——vanilla 单 localNPCImmunity 数组敌/城
    //   两面共用:①skip=flag2 私表门（:12595,敌环 :9414 同源 localImmuneCd+出生预置表）；
    //   ②受理拍写梯 usesLocal 主支（:14175-14179）immune[owner]=0【清窗】+写表——
    //   TownNPC.hurt 通用档写的 10t（TownNPC.ts:1495）须清还原（MinionProj
    //   .townAcceptLadder 同构）。窗查由 TownNPC.hurt :1422 内部门+受理 gated onAccept
    //   承载（拒收拍不写表=表保持 0,原版同相）。非局部族两面不挂（零行为变）。
    else if (!this.reflected && this.damage > 0
      && hitTownNpcs(this, game, this.damage, 0, 'playerProj', this.projId, undefined, undefined,
        this.localImmune > 0
          ? (n) => (this.spawnImmuneCd.get(n.id) ?? 0) > 0
            || (this.localImmuneCd.get(n.id) ?? 0) > 0
          : undefined,
        this.localImmune > 0
          ? (n) => {
            this.localImmuneCd.set(n.id, this.localImmune);   // immuneArray[victim]=cd（:14179）
            (n as { iframes?: number }).iframes = 0;          // immune[owner]=0 清窗（:14177）
          }
          : undefined)) {
      if (this.projId === 318) { this.killNow(game); return; }   // 臭蛋砸 NPC 即碎（penetrate 1）
      // ★BJ467⑧（2026-10-03）城镇受理照耗 pierce（:14189-14196 penetrate-- 在写梯后
      //  无条件段,对城镇受害靶同达）——本 face1=城镇受理面（唯一能受理的面,hurt 后
      //  TownNPC.hurt iframes=10/localImmuneCd 写行使尾面恒拒/跳过）。旧档消费位在
      //  尾面=窗拒/跳过拍 pierce 悬空不递减（BJ455④ 只修双调未动消费位）——箭族
      //  pierce 1 砸巫毒靶不销毁=原版无的行为。318 臭蛋既有 killNow 分支保留其先。
      if (this.pierce > 0 && --this.pierce <= 0) { this.killNow(game); return; }
    }
    // 反射后的弹体 friendly 已翻（原版 Damage NPC 需 friendly 门禁，小动物也是 NPC）
    // ——不再伤小动物/敌怪，只走上方 hitPlayer 回打发射者
    if (this.reflected) return;
    // ★红队 A-2 收口②：零伤友方弹不再一击致死路遇小动物——原版 Damage_PVE 头门
    //   先于小动物所在的全 NPC 迭代（P.cs:12576）。本仓小动物是独立桶且 hurt 无
    //   damage 门（固定 5 伤一击致死）——此前晶洞 772 滚石/绳圈族（出口直传 0 后）
    //   均会误杀。敌对弹不受影响（上方 hostile 分支已 return/continue）
    if (!this.hostile && this.damage <= 0) return;
    if (hitCritters(this, game)) { this.killNow(game); return; }
    // 敌对弹不入敌怪判定（原版 Damage_PVE_Inner :12626/:12631-12634 `hostile && flag2`
    // 门：hostile 弹对非 friendly NPC 整段 return;★BJ344 勘误:旧锚 :11902-11905 系 1456 世代——Boss 自射弹幕不会误伤/消耗在
    // 自家部件上（月总 454 附手随行 30t 若走此环会在手心爆掉）；城镇 NPC 侧已在
    // 上方 hitTownNpcs('hostile') 走"敌方弹恒命中"档，反射弹也已在上方拦截）
    if (this.hostile) return;
    // 307 腐化者小吞噬者 friendly 门（SetDefaults 无 friendly :3986-3995；锁定敌怪
    // 瞬间 friendly=true :27789-27792）——锁定前穿过敌怪不结算（原版非 friendly
    // 弹 Damage_PVE 整段不进）
    if (this.projId === 307 && !this.friendly307) return;
    // 451 涌流剑可伤门（Damage_CanDealDamage :12463）：淡出态 [1,1+pen) 恒豁免、
    // 末段前 5 拍（ai[1]<5）豁免——淡出/瞬移期穿过敌怪不结算
    if (this.projId === 451 && !this.iwCanDamage()) return;
    // ★BJ642 喷火器 85/1106 可伤门（Damage_CanDealDamage :12475-12480）：
    //  localAI[0]>=54（=18 tick）后纯视觉尾焰——穿过敌怪不再结算伤害。
    //  此前整缺=寿命面缺失掩盖（弹 3600 子步不灭）;AI_193 寿命刀后尾段照门收紧
    if ((this.projId === 85 || this.projId === 1106) && this.age >= 54) return;
    // 命中敌人（原版 penetrate：箭 1 射中即停；手里剑 4 穿 4 敌，同敌免疫防连击）
    // 飞龙剑气 684 命中盒 = 垂直线 ±40px 厚 16（CanHitWithOwnBody :14693-14701，
    // 非通用 16×16 盒——巨剑气横扫判定）
    const dragonLine = this.projId === 684;
    const dSpd = Math.hypot(this.vx, this.vy) || 1;
    const dPerpX = dragonLine ? -this.vy / dSpd : 0;
    const dPerpY = dragonLine ? this.vx / dSpd : 0;
    // ---- 钉 514（aiStyle 93）命中专管：刺入/弹开态不入通用管线（DoT 已在 AI 侧
    //      隔拍直投）；飞行态首中即刺入（Damage aiStyle93 段 :13368-13376——
    //      ai[1]=0、ai[0]=-敌-1、velocity=敌心-弹心；伤全额、immune[owner]=1 档
    //      :14060-14062 不耗穿透不入 hitSet）----
    if (this.nail93 && this.nailAi0 !== 0) return;
    if (this.nail93 && this.nailAi0 === 0) {
      for (const ent of game.enemies()) {
        const e = ent as unknown as { x: number; y: number; w: number; h: number; id: number; dead: boolean; cx: number; cy: number; hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean };
        if (e.dead) continue;
        // ★dontTakeDamage 目标排除（Projectile.cs:12600 同款——onFireHit/ignite/毒刺/
        //   信号枪/betsy 状态直写与蓄能暴击消耗都在 hurt 前,曾绕门落账,终审补）
        if ((ent as unknown as { dontTakeDamage?: boolean }).dontTakeDamage === true) continue;
        if (!playerCanHitEnemy(e, game, this.projId)) continue;
        if (!(this.x < e.x + e.w && this.x + this.w > e.x
          && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
        if (((e as unknown as { iframes?: number }).iframes ?? 0) > 0) continue;   // immune[owner] 门
        // ★BJ497①（2026-10-04）掷率收编（514 双读者单源刀①）：首击面与刺入 DoT 面
        //  （AI 侧 :7337 位）同 rollVanillaHitCrit 单源——旧 `||` 面把 0.04 路由门误当
        //  4% 平率+丢 owner 聚合/:25712 持械折入。514 数据面 ranged（SetDefaults :5850）。
        const critN = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
        const dN = Math.max(1, Math.trunc(this.damage)) * (critN ? 2 : 1);
        // ★F3 接线（蓝队四轮）：钉首击走 Damage() 全管线（aiStyle93 :13368-13376 段同
        //  在 Damage_PVE_Inner 内）→ 焰爆石/拍击石双支（:13439-13446）一并生效；
        //  弹 514 数据面 ranged；加伤随暴击并入实伤参（F1 迁移注见 stats/SnapStrike.ts）
        const snapBonusNail = projectileSnapStrikeBonus(game, this, e.cx ?? e.x + e.w / 2,
          e.cy ?? e.y + e.h / 2, e.id, {
            victimBox: { w: e.w, h: e.h, cx: e.cx ?? e.x + e.w / 2, cy: e.cy ?? e.y + e.h / 2 },
            targeterBox: { x: this.x, y: this.y, w: this.w, h: this.h },
          });
        e.hurt(applyBannerDamageDealt(game, e, dN)
          + (snapBonusNail ? Math.trunc(snapBonusNail * (critN ? 2 : 1)) : 0),
          0, 0, game, this.settlePen, critN, 1, true);   // 音/飘值=StrikeNPC 单点
        // ★清偿刀 U2（2026-10-01）：钉 514 首击 ghostHeal 白耗面（:13877-79 通用 on-hit
        //  段,StrikeNPC :13716 后=本位;命中专管不入主环 → 主环白耗臂对刺入首击不可达,
        //  S2 台账「Arrow 主环第三臂」残差站）。514 数据面 ranged 非 magic（SetDefaults
        //  :5843-5852 无 magic 行）→ isMagic=false 直传=白耗同相（幽灵兜帽在身时白扣治疗
        //  预算不出治疗球,:12090 lifeSteal -= num2 先于 :12091-93 !magic return）。
        //  numHits=自增前值（:14263 位 ++ 在下;pierce=1 flag3 刺入不耗穿但 numHits 照
        //  自增——原版 numHits++ 无 pierce 门）;刺入态 DoT 走 AI 侧隔拍直投不入 Damage()
        //  ⇒ 无后续 proc/计数面（原版同构）。ghostHurt 不接=非 magic 死码（S2/R1-B 定谳）。
        ghostHealProc(game, this.projId, this.pveNumHits,
          e as unknown as Parameters<typeof ghostHealProc>[3]);
        this.pveNumHits++;                     //（:14263 受理后自增）
        this.nailAi0 = -(e.id + 1);            // :13372-13373 ai[0] = -victimIndex-1
        this.nailAi1 = 0;                      // :13370 ai[1] = 0
        this.vx = e.cx - this.cx;              // :13374 velocity = targetNPC.Center - Center
        this.vy = e.cy - this.cy;
        this.noTileCollide = true;             // :33450 刺入态 tileCollide=false
        return;
      }
    } else {
    // 原版零伤害弹不进 PVE 管线（Damage_PVE :12572 头 `if (damage <= 0) return;`
    // ——水枪/微光枪/晶洞等 damage0 玩具件曾漏 = 命中侧把 0 伤硬结成实伤）
    if (this.damage <= 0) return;
    for (const ent of game.enemies()) {
      const e = ent as unknown as { x: number; y: number; w: number; h: number; id: number; dead: boolean; hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean; def?: { hitSound?: string[] }; reflectsProjectiles?: boolean };
      if (e.dead) continue;
      // ★dontTakeDamage 目标排除（Projectile.cs:12600 同款——主环状态直写群/蓄能暴击/
      //   鞭 tag proc/吸血链全在 hurt 前,曾绕门落账,最终清零补）
      // ★ZappingJellyfish 豁免（:12600 与 dontTakeDamage 并列——充能水母放行到下方
      //   水母块做接触反噬判定;最终清零补）
      const jellyVid = (ent as unknown as { vanillaId?: number }).vanillaId;
      const zapJelly = jellyVid !== undefined && jellyVid > 0 && ZAPPING_JELLYFISH.has(jellyVid);
      const jellyDontTake = (ent as unknown as { dontTakeDamage?: boolean }).dontTakeDamage === true;
      if (jellyDontTake && !zapJelly) continue;
      if (!playerCanHitEnemy(e, game, this.projId)) continue;   // friendly 门（Damage_PVE_Inner :12622/CanBeChasedBy NPC.cs :91139——睡渔夫 376 等友好 NPC 玩家武器无效/不追踪）
      const foxInf = dragonLine ? 0 : this.foxHitInflate();
      // 1457 宝石法珠 Colliding 重载（Projectile.cs:15443-15476，type 121/122/123/
      // 124/597/125/126 专属）三段（蓝队 R2-02 补）：
      //  ② BiggerHitbox：主命中盒 Inflate(30)
      //  ③ 末尾 return Collision.CanHit(Center→targetRect.Center)——视线门对全部
      //     宝石弹生效（隔墙不可命中）
      //  ① FastThenSlow：oldPos[1..5] 逐帧拖尾盒各测相交+CanHit(旧盒→敌盒)
      //    （宝石弹 TrailingMode=2 有 oldPos 记录——×5 出速 40px/t 单帧位移大，
      //    无拖尾盒会从薄目标两帧之间漏过）
      const gem = !dragonLine ? this.gem : undefined;
      const gemInf = gem?.biggerHitbox ? 30 : 0;
      const hitInf = foxInf + gemInf;
      // 614 星尘细胞弹目标盒收缩（Colliding :15823-15826）：targetRect.Inflate(−w/8,−h/8)
      //（>8×8 才缩——细胞弹只咬目标核心,贴大敌盒边缘擦过不算;蓝队 R7-19 顺带项）
      const tShrink614 = this.projId === 614 && e.w > 8 && e.h > 8;
      const ex614 = tShrink614 ? e.x + e.w / 8 : e.x;
      const ey614 = tShrink614 ? e.y + e.h / 8 : e.y;
      const ew614 = tShrink614 ? e.w - (e.w / 8) * 2 : e.w;
      const eh614 = tShrink614 ? e.h - (e.h / 8) * 2 : e.h;
      let hitBox = !dragonLine
        ? (this.x - hitInf < ex614 + ew614 && this.x + this.w + hitInf > ex614
          && this.y - hitInf < ey614 + eh614 && this.y + this.h + hitInf > ey614)
        : (() => {
          for (let k2 = -40; k2 <= 40; k2 += 16) {
            const bx = this.cx + dPerpX * k2 - 8, by = this.cy + dPerpY * k2 - 8;
            if (bx < e.x + e.w && bx + 16 > e.x && by < e.y + e.h && by + 16 > e.y) return true;
          }
          return false;
        })();
      if (gem && hitBox) {
        // ③ 视线门：CanHit(弹心,0,0, 敌盒心,0,0)
        if (!canHitLine(game.world.store, this.cx, this.cy, 0, 0,
          e.x + e.w / 2, e.y + e.h / 2, 0, 0)) hitBox = false;
      }
      // ★批③（2026-08-31）弹 661 黑爆 Colliding 重载（Projectile.cs:15877-15883,★F8 校准）：
      // dist(myRect.Center→targetRect.Center) > 500f 或 !CanHitLine(双盒心点对 0×0)
      // ⇒ 本拍不命中（原版 Colliding 直接 return false——掷出去的玛瑙爆破弹
      // 越过 500px 或被墙隔断后连擦身都不结算）。顺序=先距离后视线,1:1。
      else if (this.projId === 661 && hitBox) {
        const ec661X = e.x + e.w / 2, ec661Y = e.y + e.h / 2;
        if (Math.hypot(ec661X - this.cx, ec661Y - this.cy) > 500) hitBox = false;
        else if (!canHitLine(game.world.store, this.cx, this.cy, 0, 0,
          ec661X, ec661Y, 0, 0)) hitBox = false;
      }
      if (gem && !hitBox && gem.fastThenSlow) {
        // ① 拖尾扫掠：oldPos[1..5]（本仓 gemTrail 每 tick 记录出生位置，1=上一 tick）
        const stG = game.world.store;
        for (let ti = 1; ti <= 5; ti++) {
          const ox = this.gemTrail[ti * 2], oy = this.gemTrail[ti * 2 + 1];
          if (ox === undefined) break;                      // oldPos==Zero → break（:15457）
          const tx = ox - hitInf, ty = oy - hitInf;
          const tw = this.w + hitInf * 2, th = this.h + hitInf * 2;
          if (tx < e.x + e.w && tx + tw > e.x && ty < e.y + e.h && ty + th > e.y
            && canHitLine(stG, tx, ty, tw, th, e.x, e.y, e.w, e.h)) {
            hitBox = true;
            break;
          }
        }
      }
      if (hitBox) {
        // 反射源（419 旋刃冲刺等 reflectsProjectiles 置标）：命中前先走反射
        // （原版 Projectile.cs:12050-12060，反射即终止本帧命中迭代 keepIterating=false）
        if (tryReflectProjectile(this, this.projId, e, game)) {
          this.pierce = 1;            // 原版 penetrate=1（NPC.cs:67058）
          this.pierceInit = 1;        // 反射后按单发弹语义（命中不设敌方帧）
          this.hitSet.clear();        // 转敌对后命中表作废
          return;
        }
        // 出生预置局部免疫（localNPCImmunity[target]=N 窗口内不得命中该敌——
        // Damage_PVE flag2 `usesLocalNPCImmunity && array[i] == 0` :12595 同式；
        // 花瓣 1038 = 30t，过期后照常走下方分支）
        if ((this.spawnImmuneCd.get(e.id) ?? 0) > 0) continue;
        // 376 小鬼火球 / 604 孢子云 IDStatic 共享免疫（usesIDStaticNPCImmunity——
        // 全场同型一张表,多弹齐射不叠伤;蓝队 R7-24 曾走逐弹 hitSet）。
        // ★R28：511-513 毒云 UseGroupStaticImmunity(511) 同机制——三型共用键 511
        // （immunityIdentity :10686,idStaticNPCHitCooldown=10t）
        // ★BJ455⑥ :12636 三族共门（原版 :12635-12637 `immune[owner]==0` 在写梯
        //  :14031-14179 之前对 usesLocal/usesIDStatic 弹同样生效——flag3 只豁免单发
        //  非局部弹 :12634,局部/idStatic 族【无】豁免,故本门只挂三支私表位内、
        //  不挂 -2 缺省族共位;BJ436 敌怪环同判例。旧三支不查窗=窗拒拍白吃私表 cd,
        //  节拍漂移;门读 hurt 前状态=快照纪律,原版门位先于水母块 :12676-12688
        //  → 窗内水母不电同相）
        if (this.projId === 376 || this.projId === 604) {
          if (((e as { iframes?: number }).iframes ?? 0) > 0) continue;   // ★BJ455⑥
          // cd 单位=tick（★G10）：376=6t（:4612-4615）/ 604=10t（:6081-6082）
          if (!idStaticCheck(this.projId, e.id, this.projId === 376 ? 6 : 10)) continue;
        }
        let immFaceIdStatic = false;
        if (this.idStaticGroup !== null) {
          immFaceIdStatic = true;   // ★GC1 写方桥 face 记录（命中尾统一写用）
          if (((e as { iframes?: number }).iframes ?? 0) > 0) continue;   // ★BJ455⑥
          if (!idStaticCheck(this.idStaticGroup, e.id, this.idStaticCdTicks)) continue;
        }
        if ((this.projId === 376 || this.projId === 604)) immFaceIdStatic = true;
        // 502 喵刀弹：localNPCHitCooldown=10t 同敌再命中（穿透弹 hitSet 是永久免疫，
        // 502 是"同一敌 10t 冷却后可再咬"——SetDefaults :5466-5468）
        let immFaceLocal = false;
        if (this.projId === 502) {
          immFaceLocal = true;      // ★GC1 face 记录（同 usesLocalNPCImmunity 形）
          if (((e as { iframes?: number }).iframes ?? 0) > 0) continue;   // ★BJ455⑥
          // ★BJ467⑨（2026-10-03）cd 检查前置——原版 flag2 私表门（:12585-12592
          //  Damage_PVE 循环头 `usesLocalNPCImmunity && array[i]==0`）先于 Inner 全链
          //  ⇒ cd 活跃靶连水母块（:12680）都不可达;旧序先 zap 后查 cd → 充能+cd 叠态
          //  （先受击写表、后进充能态）多电一次。写位仍在水母块后（充能拍不落账=
          //  S2-债2 判别保持,tests/s2-ghostheal-whitedrain-jellyzap §C）。
          const cd = this.meowHitCd.get(e.id) ?? 0;
          if (cd > 0) continue;
          // ★水母块（★S2-债2 清偿刀,2026-10-01——原 else 支 :9304 同面展开到 502/
          //  局部免疫支）：Damage_PVE_Inner :12686 `if (dontTakeDamage) return` 在写梯
          //  :14031-14183【之前】⇒ 充能水母重叠拍不落局部免疫账（旧档先写
          //  meowHitCd=充能期白写,水母解冻后 10t 内漏命中）;读门后写前位=原版
          //  flag2 表行门（:12595）对 zap 的同构面。非接触族（502 aiStyle 8）不电。
          if (zapJelly && jellyDontTake) {
            if (jellyZapProjectile(this.projId, projectileData(this.projId)?.aiStyle)) {
              game.takeDamageFromJellyfish?.(ent);
            }
            continue;
          }
          this.meowHitCd.set(e.id, 10);
        } else if (this.localImmune > 0) {
          // 1457: 通用局部免疫（usesLocalNPCImmunity+localNPCHitCooldown=N，数据列驱动）
          immFaceLocal = true;      // ★GC1 face 记录
          if (((e as { iframes?: number }).iframes ?? 0) > 0) continue;   // ★BJ455⑥
          // ★BJ467⑨ cd 检查前置（同 502 支——flag2 :12585-92 先于水母块 :12680,
          //  充能+cd 叠态不多电）
          const cd = this.localImmuneCd.get(e.id) ?? 0;
          if (cd > 0) continue;
          // ★水母块（★S2-债2,同 502 支——本支接触族成员 611(aiStyle75)/697·707
          //  (aiStyle140) 充能水母重叠拍照电玩家;旧档先写 localImmuneCd=白写+漏电）
          if (zapJelly && jellyDontTake) {
            if (jellyZapProjectile(this.projId, projectileData(this.projId)?.aiStyle)) {
              game.takeDamageFromJellyfish?.(ent);
            }
            continue;
          }
          this.localImmuneCd.set(e.id, this.localImmune);
        } else {
          // 全局 immune[owner] 门（Damage_PVE_Inner :12635-12637;★BJ344 勘误:旧锚 :11905 系 1456 世代,1457 该行为命中玩家 buff 支,非免疫门）：敌怪 iframes 内不命中、
          // 不耗穿透（曾缺 = 穿透弹穿过刚被别弹打中的敌白耗穿透数；piranhaStep
          // :1744 同门先例）。pierceInit 1 = 单发弹 flag3 豁免（Enemy.hurt :11457 同门）
          // ★BJ467⑦（2026-10-03）flag3 豁免收窄——原版 :12636 `flag3 = maxPenetrate == 1
          //  && !usesLocalNPCImmunity && !usesIDStaticNPCImmunity`（usesLocal 已由本 else
          //  支前两分支承载）——usesIDStatic 族【不】豁免（immune[owner]!=0 照拦）。
          //  旧 pierceInit===1 无条件豁免=aiStyle 1 实弹 286（penetrate 1+usesIDStatic
          //  +cd 60,SetDefaults :3743 区;vanillaProjImmuneFaces 表 idStatic 位）窗内照
          //  命中=原版无的行为。usesIDStatic 判据=projImmuneFaceOf 单源（idStaticGroup
          //  显式建模族 181/189/511-513/376/604 已在上方分支 continue,本位只兜数据面）。
          if ((this.pierceInit !== 1 || projImmuneFaceOf(this.projId)?.idStatic === true)
            && ((e as { iframes?: number }).iframes ?? 0) > 0) continue;
          // ★水母块（Damage_PVE_Inner :12676-12688 1:1,免疫窗后同位）：充能态
          //  （dontTakeDamage）水母不受伤——接触族弹幕命中 → TakeDamageFromJellyfish
          //  电玩家 → `if (dontTakeDamage) return` 拦本次伤害（最终清零补,GAP 销账）
          if (zapJelly && jellyDontTake) {
            if (jellyZapProjectile(this.projId, projectileData(this.projId)?.aiStyle)) {
              game.takeDamageFromJellyfish?.(ent);
            }
            continue;
          }
          // 穿透弹同敌不重复命中；无限穿透（penetrate −1：小丑箭 5/地狱火箭 41，
          // 无 usesLocalNPCImmunity）不入 hitSet——iframes 过期即可再命中（修复1）
          // ★B6D 刀①读侧（2026-09-01）：IDStatic 族（idStaticGroup!==null：189 缺省组键
          //   =type/181·566 显式共用 181/511-513 共用 511,键空间=immunityIdentity 零新增）
          //   豁免 hitSet 永久去同敌重——同敌再命中门=上方组表 idStaticCheck（组键+敌id、
          //   10t 过期）,节拍=原版同敌 10t 一跳（usesIDStaticNPCImmunity 支 :14031-14037,
          //   penetrate=3 → 单敌至多 3 跳）；非 IDStatic 弹行为零变。
          if (this.pierceInit >= 0 && this.idStaticGroup === null && this.hitSet.has(e.id)) continue;
        }
        // ★鞭 tag（WhipTagEffect.CanRunHitEffects :73-84：MinionShot/SentryShot 弹幕吃
        //   tag——随从/哨兵射出的箭 whipTagShot 置标时走 resolveWhipTagHit 统一结算：
        //   ModifyTaggedHit tag 加伤+TagCrit 暴击（WhipTagEffect.cs:58-70）、OnTaggedHit
        //   （黑收成 916）、proc 窗口首跳（TagEffectState.cs:216-243）。随从弹无基础
        //   暴击（原版 summon 系 crit 仅来自 TagCrit）——4% 基础暴击只留给玩家远程弹）
        let dmg = this.damage;
        // ★R27：876 zapinator 命中侧随机化（Damage_PVE :12691-12777，每次命中掷一遍、
        //  掷序敏感——瞬移→回退→变速→改伤）。"打出去发生什么谁也不知道"即本武器全部卖点
        if (this.projId === 876) this.zapinatorHitChaos(game);
        // 985 泰拉刃光束（Damage_PVE_Inner :12700-12703 `case 985: damage *= 0.75`）：
        // 每次命中伤害 ×0.75（(int) 截断；在暴击翻倍前——原版 switch 先于 StrikeNPC）
        if (this.projId === 985) dmg = Math.max(1, Math.trunc(dmg * 0.75));
        // 710 空中祸害空旷加伤（Damage() :12236-12239）：命中点下方 12 格内无实心
        // → num12 ×1.5（(int) 截断；暴击翻倍前——原版在 DamageVar 之后、crit 倍率之前）
        if (this.projId === 710 && this.skyOpen12(game)) dmg = Math.trunc(dmg * 1.5);
        // 981 银弹对狼人 ×3（Damage_PVE_Inner :12594-12597 `type==981 &&
        // targetNPC.type==104 → num12 *= 3`；NPCID 104 = Werewolf 狼人（满月夜
        // hard 地表怪，本仓 VanillaSpawner L4533 已生成）——暴击翻倍前同槽位。
        // ★审计原文"蚀地怪 Eater of Segments"系误记：1456 反编译 NPCID.cs:11273
        //   `public const short Werewolf = 104`，银弹克狼人是 1.4.5 主题机制）
        if (this.projId === 981 && (e as { vanillaId?: number | null }).vanillaId === 104) dmg *= 3;
        // ★BJ431 火花族 504/954/979 命中快进（Damage_PVE_Inner :13051-13055 三型共支）：
        //  每次受理命中 `ai[0] += (60f − ai[0]) / 2f`（float 直加）——计寿钟向 60 折半
        //  逼近（首中 ≈30）,尾迹衰减段提前+约 0.5s 内自灭;penetrate=2 仍可再跳（窗口
        //  ~30t）。原版位序=免疫门 :12636 之后/StrikeNPC :13702 之前=本仓主环受理段同相
        if (this.projId === 504 || this.projId === 954 || this.projId === 979) {
          this.sparkHitFastForward();
        }
        let crit: boolean;
        // ★BJ496③（2026-10-04）whipTagShot 支 BJ475③ 处方落位（BJ453 注勘误:本支旧
        //  注自称「TimerCrit 既有接位」但实现【零】TimerCrit 面=注释与实现不符）——
        //  原版序亲读（Projectile.cs :12909 ownedBySomeone 块单函数单遍历,对 MinionShot/
        //  SentryShot 弹【同链同达】）:三类掷(:12915-12927)→TryConsumingTimerCrit
        //  (:12928 无条件)→武僧 688-690(:12929-43)→tag ModifyHit(:12947)→golem 掷
        //  (:12962-65 独立无条件)。本支旧形 `res.crit || golem` 双病:①TimerCrit 整缺
        //  （6170 蓄能暴击对随从弹永不消费/不强制）;②golem 掷被 res.crit 短路——原版
        //  独立无条件掷,短路即漏抽 Next(10) 掷流（反伪影:掷流纪律）。
        //  拆形（F11/BJ493④ 先例）:roll/timerCrit/res/golem 各自独立求值后 ||；
        //  roll=rollVanillaHitCrit（MinionShot/SentryShot 全系 SetDefaults 无三类旗——
        //  逐 id 数据面亲读,kind=null 捷径返假【零 RNG】零行为漂移;未来带旗成员自动
        //  生效,classOverride=projClass 显式覆写通道）;武僧掷 688-690 非 MinionShot/
        //  SentryShot 族恒假不设（dealContacts :502 同惯例）;golem 掷中∧res.crit 假时
        //  补一次 ×2（tag crit ×2 已嵌 res.dmg,原版 crit=单布尔单翻倍——旧形 golem
        //  单独掷中只染 crit 色【零翻倍】=同刀补齐,MinionProj contact :4983 同式）。
        // ★清偿刀 W5（2026-10-02）黑收成 916 链电汇出（:13711 OnHit 形态对齐）：
        //  旧形 hurtFx【同步直调】伤落被命中敌且先于主 hurt=反序反噬主命中;且 916
        //  出膛即对被命中敌 localNPCImmunity=-1 永免（_DarkHarvest.cs:18,原版词条
        //  "Dark energy jumps from enemies hit by summons" 同证）——直调源敌=目标面
        //  反记+tag 伤双记（主命中 ModifyHit :12954 已并 TagDamage 一次）。现形态=
        //  汇出收集,主命中受理（!vanillaGated,:12636 门拒整跳 return :13711 不可达）
        //  +写梯后经 darkHarvestChain 落地链电（伤落其他敌,源敌永免）。
        let pendingDirect916: number[] | null = null;
        if (this.whipTagShot) {
          const en2 = e as unknown as import('./WhipTag').WhipTagged;
          const direct: number[] = [];   // :13711 汇出位（收集,受理后落地）
          en2.hurtFx = (d: number) => { direct.push(d); };
          // ★BJ496③ 原版序:三类掷(:12915-12927)→TimerCrit(:12928)【无条件消费,掷中
          //  照吃】→(武僧不设)→tag ModifyHit(:12947)→golem(:12962-65)——分立求值后 ||。
          const rollCritTag = rollVanillaHitCrit(this.projId, game, 0, this.projClass);
          const timerCritTag = ((game.player as unknown as
            { tryConsumingTimerCrit?: (g: unknown, x: number, y: number, w: number, h: number) => boolean }
            | null)?.tryConsumingTimerCrit?.(game, e.x, e.y, e.w, e.h) ?? false);
          const res = resolveWhipTagHit(en2, dmg, game,
            (el) => (game as unknown as { entities: { add: (x: unknown, b: string) => void } }).entities.add(el, 'projectiles'),
            SUMMON_TAG_MUL[this.projId] ?? 1, e.x + e.w / 2, e.y + e.h / 2);
          pendingDirect916 = direct;
          dmg = res.dmg;
          // ★6176 圣殿骑士背包（Projectile.cs:12962-12965,2026-09-03 哨兵携带批收口）：
          //   强制暴击掷在 tag 修正【之后】（原版序：changes.Crit.HasValue 覆写在前,
          //   golem 掷在后仍可强制）——塔射弹全走本 tag 支（whipTagShot 置标）,掷面
          //   与 else 支互补。★BJ496③:golem 掷改【无条件】独立求值（Next(10) 掷流
          //   恢复;门闭时零 RNG 与原版整段跳过同相）
          const golemCritTag = rollGolemSentryCrit(game, this.projId, false);
          crit = res.crit || rollCritTag || timerCritTag || golemCritTag;
          // ★BJ496③ 翻倍归位：tag crit ×2 已嵌 res.dmg——roll/TimerCrit/golem 源强制
          //  时补一次 ×2（原版 crit 单布尔单翻倍,MinionProj contact :4983 同式;旧形
          //  golem 单独掷中=染 crit 色【零翻倍】缺口随刀闭合）
          if (crit && !res.crit) dmg *= 2;
        } else {
          // 暴击：基 4% + spawn 注入的系暴击/item.crit（P:2300-2304/P:25230-25232）
          // ★Notes（蓝队四轮，2026-08-31）：TryConsumingTimerCrit 并入（Projectile.cs
          //  :12928——Damage_PVE 每次命中在类三连掷后统一调用,对一切玩家弹生效;
          //  蓄能暴击 6170 满蓄/负窗 → 强制 crit。脉冲弹 1121/1131/1132 出射后同样
          //  在本环结算 ⇒ 注入面即此处；与 WeaponProj.hitEnemies :303 先例同式）。
          //  仓内已有先例：VolcanoBlastProj/MountCombat/meleeOnHitProjs(977/524)。
          //  ★BJ489 def-3：路由集成员（190/304/424-426/459）掷率=rollVanillaHitCrit
          //  （命中拍 owner 装配+:25712 持械折入动态,critTotal 冻结载体退役;0.04=
          //  路由门非掷率,置 0 关断钉保留）;非成员旧路径零漂移。
          //  ★BJ493②③（2026-10-04）ranged critBonus 族收编：Game.ts spawn 拍
          //  `X.critBonus = <rangedCrit 冻结>`（弓/枪主弹/扇/泡/暮夕/投掷/434 续发
          //  13 位）→ spawn 位 `critChance = 0.04` 路由门 + 命中拍 rollVanillaHitCrit
          //  动态（路由信号=spawn 位 `critChance=0.04` 门,critChance>0 即入动态支）。
          //  定谳（原版亲读）：①旧 `??` 兜底对类缺省
          //  critChance=0 恒不可达（?? 不认 0 为未设）⇒ critBonus 族经主环【永不暴击】
          //  =字段注释「未设=按 critBonus+4%」矛盾即病根;②弹药无一带 crit（1457
          //  Item.SetDefaults 34 处 crit 赋值全为武器,弹药 crit 恒 0）⇒ 原版掷面=
          //  基 4+:2417 owner 聚合+:25712 持械折入（bow/gun item.crit+词缀 crt,
          //  逐帧链入）,rollVanillaHitCrit 单源同算式;③无类旗成员（196 烟雾/370/371
          //  /936/996/868/869/171/475/505/506）原版零掷——rollVanillaHitCrit kind=null
          //  捷径返假零 RNG 同相。裸实例（critChance=0 直构,测试 -1 钳同相）走旧
          //  `??` 路径零漂移;DEF3 支保留=critChance≤0 零 RNG 钉形不变（单调用点,
          //  BJ489 1d 计数锁 2=主面+661 爆面）。
          //  ★BJ496③（2026-10-04）主面拆形（BJ475③ 处方,F11/BJ493④ 先例）：旧
          //  `roll || timerCrit || golem` 懒惰链双病——①掷中拍 TryConsumingTimerCrit
          //  被短路跳过（原版 :12928 无条件消费,前掷已 crit 照吃 charge 置 −15
          //  :28568-71）;②golem 掷 :12962-65 原版=独立无条件 if（gates 闭=零 RNG,
          //  gates 开=Next(10) 必抽）,短路漏抽 Next(10) 掷流。拆形=三源分立求值后
          //  ||（RNG 流与原版同序同量）。★BJ496①:classOverride=this.projClass——
          //  181/566 蜂族数据面零旗、spawn 位显式覆写（Player.cs:48805 magic=true/
          //  :43976 族 melee=true/:78077 ranged=true）,原版三连掷读【实旗】;
          //  覆写缺省 undefined=纯数据面（既有路由族零漂移）。
          const rollCritMain = (DEF3_VANILLA_ROLL_PROJS.has(this.projId) || this.critChance > 0)
            ? this.critChance > 0 && rollVanillaHitCrit(this.projId, game, 0, this.projClass)
            : Math.random() < (this.critChance ?? (4 + this.critBonus) / 100);
          const timerCritMain = ((game.player as unknown as
            { tryConsumingTimerCrit?: (g: unknown, x: number, y: number, w: number, h: number) => boolean }
            | null)?.tryConsumingTimerCrit?.(game, e.x, e.y, e.w, e.h) ?? false);
          // ★6176 圣殿骑士背包（Projectile.cs:12962-12965,2026-09-03 哨兵携带批收口）：
          //   SentryShot 飞弹命中 10% 强制暴击（非哨兵弹掷恒 false,零扰面）——
          //   此前仅 MinionProj 塔接触面掷,塔射弹（664/666/668/680/642/309/378/967/1026）
          //   全漏。★BJ496③:独立无条件求值（掷流恢复）
          const golemCritMain = rollGolemSentryCrit(game, this.projId, false);
          crit = rollCritMain || timerCritMain || golemCritMain;
          if (crit) dmg *= 2;
        }
        if (this.onFireHit) {
          // AddBuff(buff, minT + Next(max−min+1)) 直译（1106/1097 共用,见字段注）
          // ★ImmuneToAll 直写闸（2026-09-03,projStatus.debuffWriteAllowed）：主环状态
          //  直写群各支对应原版逐支 AddBuff——须过 NPC.AddBuff buffImmune 门
          //  （NPC.cs:90968,37 键 ImmuneToAll 名单 68 守卫/72 火轮/134-136… 对非鞭
          //  debuff 全免疫,曾绕闸照写）。闸在掷后零掷耗=掷流不变;per-buff 传参
          //  （同敌可免 24 不免 323）。环头 :7413 已排 dontTakeDamage 靶,此处补免疫位
          const t = this.onFireHit.minT
            + Math.floor(Math.random() * (this.onFireHit.maxT - this.onFireHit.minT + 1));
          const sec = t / 60;
          if (debuffWriteAllowed(e, this.onFireHit.buff)) {
            if (this.onFireHit.buff === 323) {
              const enF = e as unknown as { onFire3T?: number };
              enF.onFire3T = Math.max(enF.onFire3T ?? 0, sec);
            } else {
              const enF = e as unknown as { onFireT?: number };
              enF.onFireT = Math.max(enF.onFireT ?? 0, sec);
            }
          }
        } else if (this.ignite && debuffWriteAllowed(e, 24)) {
          const en3 = e as unknown as { onFireT?: number };
          en3.onFireT = Math.max(en3.onFireT ?? 0, 5); // AddBuff(24,300)=5s
        }
        if (this.igniteHellfire) {
          // AddBuff(323,Next(300,600))=5-10s——掷后过 AddBuff 门（ImmuneToAll 闸,同上）
          const sec4 = 5 + Math.random() * 5;
          if (debuffWriteAllowed(e, 323)) {
            const en4 = e as unknown as { onFire3T?: number };
            en4.onFire3T = Math.max(en4.onFire3T ?? 0, sec4);
          }
        }
        // 1457 凤凰箭袋 6181 引矢标记（StatusNPC :11178-11182：aiStyle1 +
        // PhoenixQuivered 位 → AddBuff(323, 300) = Hellfire 定值 5s，无掷幅）
        if (this.phoenixQuivered && debuffWriteAllowed(e, 323)) {
          const en4b = e as unknown as { onFire3T?: number };
          en4b.onFire3T = Math.max(en4b.onFire3T ?? 0, 5);
        }
        // ★BJ703-D3（BJ698 登记债③）：614 命中转刺入（Damage_PVE_Inner :13244-13251
        //  `aiStyle==113 ∧ ai[0]<2`）：ai[0]=1/ai[1]=victimIndex/velocity=(敌心−弹心)×0.75
        //  ——先于 StatusNPC（:13634）⇒ 183 gate ai1==i 读的就是【实际 victim】（途中
        //  撞非目标敌=转贴该敌+183 同上,原版同相）;KillOldestJavelin（:14043-14054,
        //  _javelinsMax10）同玩家同靶 stuck≥10 → Kill 剩余 timeLeft 最小者（本弹受
        //  保护不入选）。位序=免疫门后（:12636 → :13244,本环 continue 已过门）。
        if (this.projId === 614 && this.stickerA0 < 2) {
          this.stickerA0 = 1;
          this.stickerTgt = e.id;                     // ai[1]=victimIndex（:13247）
          this.stuckT614 = 0;                         // localAI[0] 清零（AI_113 入口快照）
          this.vx = (e.x + e.w / 2 - this.cx) * 0.75; // velocity=(敌心−弹心)×0.75（:13248）
          this.vy = (e.y + e.h / 2 - this.cy) * 0.75;
          this.killOldestJavelin614(game, e.id);
        }
        // 命中 debuff（StatusNPC:10555 表驱动——火枪弹 2 33% OnFire 180t 等,按型号掷骰）
        // 614 传 ai1TargetId：表内 183 条目带 gate 'ai1==i'（:11381-11383 只上绑定目标）
        // ★1458：催化指环 ctx 接通（StatusNPC :11192-11196 `!npcProj && catalystBand`
        //  → 398 300t 任意命中）——本仓 1457 箭命中路径漏传 ctx（旗聚合零消费）,
        //  借 1458 门补齐；!npcProj=仅玩家弹（敌箭不走本敌伤路径,天然满足）
        applyProjStatus(this.projId, e as unknown as Record<string, number>,
          this.projId === 614 ? { ai1TargetId: this.stickerTgt }
            : this.projId === 85
              ? { catalystBand: ((game.player as unknown as { equipStats?: { catalystBand?: boolean } } | null)?.equipStats?.catalystBand) === true,
                  ai0: this.hostileAi0 }   // ★BJ642：85 ai[0] 门（1910=1 → 324 Frostburn2 :11660-11663）
              : { catalystBand: ((game.player as unknown as { equipStats?: { catalystBand?: boolean } } | null)?.equipStats?.catalystBand) === true });
        // ★1458 毒刺 6165/6184/6185（StatusNPC :11182-11191,1458 加 !npcProj 门）：
        // 玩家箭体命中 100% Poisoned(20) 90t=1.5s——本仓 1457 漏接（equipStats 旗
        // 聚合于 Player.ts:1234-1259 但零消费）,借 1458 修复补齐
        if (VANILLA_ARROW_PROJS.has(this.projId)
          && ((game.player as unknown as { equipStats?: { accPoisonBarb?: boolean } } | null)?.equipStats?.accPoisonBarb)
          && debuffWriteAllowed(e, 20)) {
          (e as unknown as { poisonT?: number }).poisonT =
            Math.max((e as unknown as { poisonT?: number }).poisonT ?? 0, 1.5);
        }
        // 信号枪族点燃（StatusNPC :11687-11696：163/310/1008/1010/1011 →
        //   OnFire(24) Next(3)==0?600:300t = 10s/5s；1009 诅咒信号弹 →
        //   Cursed Inferno(39) 600t=10s（:11702-11705））——ImmuneToAll 直写闸同上
        //   （掷后零掷耗:FLARE 的 1/3 掷先于闸,与原版 Next(3)→AddBuff 拒 同拍）
        if (this.projId === 1009 && debuffWriteAllowed(e, 39)) {
          (e as unknown as { cursedT?: number }).cursedT =
            Math.max((e as unknown as { cursedT?: number }).cursedT ?? 0, 10);
        } else if (FLARE_PROJS.has(this.projId)) {
          const flareSec = Math.random() < 1 / 3 ? 10 : 5;
          if (debuffWriteAllowed(e, 24)) {
            const en5 = e as unknown as { onFireT?: number };
            en5.onFireT = Math.max(en5.onFireT ?? 0, flareSec);
          }
        }
        if (this.betsyCurse && debuffWriteAllowed(e, 203)) {
          // Betsy's Curse 203（type 711 命中 AddBuff(203,600) :10719-10721）——
          // 原版无"每层 -10 防"堆叠档：betsysCurse flag（NPC.cs:93287-93289）只是
          // checkArmorPenetration 池内 +40（:81922-81924），Enemy.hurt buffPen 直读
          // betsysCurseT 即 1:1（2026-08-14 考古销项，旧注释的"层"描述非原版）
          const rec = e as unknown as Record<string, number>;
          rec.betsysCurseT = Math.max(rec.betsysCurseT ?? 0, 600);
        }
        // 冰霜盔甲引擎(ranged 门,:93712;魔法/召唤弹 frostEligible=false)
        if (this.frostEligible) {
          applyFrostBurn((game.player as unknown as { equipStats: { frostBurn: boolean } }).equipStats.frostBurn,
            e as unknown as Record<string, number>);
        }
        // ★BJ424：旧 nebulaCb 回调退役——星云触发单源 nebulaBoosterOnHit（下方
        // ghostHurt 同位,Damage_PVE_Inner :13885-13891 全 magic 弹面）
        // ★焰爆石 kind1 + 拍击石 kind0 弹幕侧双支（Damage_PVE_Inner :13439-13446，
        // 书写序 = k1 先 k0 后）。★F3/F1 收编（2026-08-31 蓝队四轮）：类门+触发走
        // projectileSnapStrikeBonus 单源（pyroclastProjectileGate /
        // snappingStoneProjectileGate——原 kind0 内联 projectileData.ranged 手搓口径撤销）；
        // F2 扫描面 = FindTargetWithLineOfSight 原文语义；返回值 = num14 加伤并
        // 【不吃攻端旗乘区】（原版 banner :13388-13390 在加伤 :14451 前），随暴击并入本次实伤。
        // 排除面 = 本弹局部免疫窗投影（vanilla localNPCImmunity[i]!=0 :46487-89 的仓内读面）。
        const snapBonusArrow = projectileSnapStrikeBonus(game, this, e.x + e.w / 2, e.y + e.h / 2, e.id, {
          victimBox: { w: e.w, h: e.h, cx: e.x + e.w / 2, cy: e.y + e.h / 2 },       // R4-33 victim 自脉冲
          targeterBox: { x: this.x, y: this.y, w: this.w, h: this.h },
          exclude: (id: number): boolean => (this.pierceInit >= 0 && this.hitSet.has(id))
            || (this.localImmuneCd.get(id) ?? 0) > 0 || (this.meowHitCd.get(id) ?? 0) > 0
            || (this.spawnImmuneCd.get(id) ?? 0) > 0,
        });
        // ★1457 GetDamageMultiplier 乘区已上移到发射侧（Player.cs:49813-49814
        //   `(int)((float)Damage * damageMultiplier)` C# 截断，Game.fireGemStaffBolts
        //   消费）——弹幕 damage 字段即终值，命中侧不再乘（蓝队 R2-06：命中侧
        //   Math.round 曾致 SwirlTwins 0.6/ArPenSpread 0.5 档在 x.5 处系统性 +1）
        // ★F1：snapBonus 并在 banner 采样之外、crit 随本次翻倍、防御前（Enemy.hurt 内）。
        // ★BJ395（2026-09-28,BJ393 同族债五处清偿①）：受理面谓词 vanillaGated（读
        //   hurt【前】iframes=门拒分类单源,WeaponProj.hitEnemies :393 同范式）。
        //   Enemy.hurt 布尔返真=「本拍击杀/假人」（Enemy.ts:15033/:14184）非「受理」;
        //   返假三族=①头部门拒（dead :13971 已 :9146 前置 continue/iframes :13972/
        //   dontTakeDamage :13978——后两族经 502·localImmune 免疫支与充能水母豁免
        //   :9154 可达 hurt 内）②血尽级联（:14369 族,伤害已实扣=原版受理）③普通
        //   未致命命中尾档 :15037（主导族）——②③原版写梯 :14031-14183/penetrate--
        //   :14189-14196/numHits++ :14263 照跑（免疫门 :12635-12638 后无死亡复查）。
        //   → 受理谓词=!vanillaGated,hurt 返值不再消费（旧 hurtOk=击杀位,普通命中
        //   下 IDStatic 清窗整面不达=under-fire）。
        const vanillaGated = (this.pierceInit !== 1
          && ((e as { iframes?: number }).iframes ?? 0) > 0)
          || jellyDontTake;   // 充能水母豁免残留的 dontTakeDamage 门拒（:12600/:12686 同面）
        e.hurt(applyBannerDamageDealt(game, e, dmg)
          + (snapBonusArrow ? Math.trunc(snapBonusArrow * (crit ? 2 : 1)) : 0),
          Math.sign(this.vx) * this.knockback, 0, game, this.settlePen, crit, this.pierceInit, true);   // 音/飘值=StrikeNPC 单点
        // ★B6D 刀②写侧（2026-09-01）：IDStatic 族结算成功即清本跳 iframes（=原版
        //   usesIDStaticNPCImmunity 支 `targetNPC.immune[owner] = 0` :14033-14036）——
        //   自己这跳设的 10t 帧不拦自己 10t 节拍再命中（节拍只由组表管）；外源 iframes
        //   照旧被上方读门（:12635-12637 同式,本族不豁免）拦。★BJ395 判据勘正：旧
        //   「hurt 返回 false（已死/dontTakeDamage/免疫拒收）不写」漏了返假②③族——
        //   原版 IDStatic 支对每个过门命中（含普通/级联）都写 0,判据=!vanillaGated。
        //   穿透经济学不变：被拒跳不落此支、受理跳下方照常 pierce--。与 GC1 桥
        //   （noteVanillaProjImmune→registry）双域同相：桥管近战域表,此处清弹幕域读面。
        if (!vanillaGated && this.idStaticGroup !== null) (e as unknown as { iframes?: number }).iframes = 0;
        // ★GC1 写方桥（清零批二波，2026-08-31；蓝队二轮 F4 校准行号 F5 补表面）：
        //  命中尾 npc.immune[owner] 统一写（Projectile.Damage :14031-14183 梯子,
        //  StrikeNPC 后原位）。face 由上方去重支记录：idStatic/local 面 = 原版写 0
        //  （全局窗显式清零,节流归弹内局部表）；全局面 = 纯表档位（缺省
        //  `penetrate!=1→10`；单发弹 flag3 族无写——与 :12636 绕门语义同源）。
        //  ★F5：bridge 未显式传 true 时自动读 data/vanillaProjImmuneFaces.ts 三旗补表,
        //  本处显参仍恒覆盖（防 Arrow 自家局部表时序与原版 SetDefaults 静态面漂移）。
        //  写前现存穿透数 = this.pierce（本行之后才递减，与原版"判定用未减值"同拍）。
        //  消费面 = Game.meleeNpcImmuneGateOf（Player.cs:44598 近战三重门 immune 分量)
        //  与后续新读域。
        //  ★BJ395：受理面化——原版梯子 :14031-14183 在免疫门 :12635-12638 后（门拒
        //  整跳 return 不达梯=不写）;旧无条件写=被拒跳（502/局部免疫支外源窗、水母
        //  豁免残留 dontTakeDamage）也登记近战域表=over-fire。
        if (!vanillaGated) {
          noteVanillaProjImmune(game, this.projId, e.id,
            { penetrate: this.pierce, localFace: immFaceLocal, idStaticFace: immFaceIdStatic });
        }
        // ★W5 :13711 位落地（主命中受理+写梯后）——916 链电伤落其他敌（源敌永免,
        //  _DarkHarvest.cs:18）;门拒跳（vanillaGated）原版 :13711 不可达=不落地
        if (!vanillaGated && pendingDirect916) {
          for (const d of pendingDirect916) {
            darkHarvestChain(game, d, e.x + e.w / 2, e.y + e.h / 2, e.id);
          }
          pendingDirect916 = null;
        }
        // ★R29 幻象弓命中侧补刀（Projectile.cs:13935）：arrow 弹（type≠631）命中且
        // 630 载体在场（phantasmTime>0）→ 从玩家身体随机点补 3 枚 631 追踪矢。
        // 原版门 = projectile.arrow && type != 631 && phantasmTime > 0（本仓以
        // VANILLA_ARROW_PROJS 全集承载 arrow 位）。
        // ★BJ398 受理面化（尾段八站清扫①,:13934 在免疫门 :12636-12639 return 后=
        // 拒收不可达;旧无条件补矢=外源残窗/水母豁免拒收跳也出 631=over-fire）
        if (!vanillaGated && !this.hostile && this.projId !== 631 && VANILLA_ARROW_PROJS.has(this.projId)) {
          this.spawnPhantasmChase(game, { id: e.id, cx: e.x + e.w / 2, cy: e.y + e.h / 2 });
        }
        // ★BJ398 受理面化（尾段八站清扫②——拒收跳不落表：502/localImmune/idStatic 支
        // （:9233/:9238/:9225）不查全局读门,外源残窗拒收曾照 add → :9265 永久去同敌重
        // =窗过期后永不再命中 under-fire;snapBonus exclude :9412 同面）
        if (!vanillaGated && this.pierceInit >= 0) this.hitSet.add(e.id);   // 无限穿透不入表（iframes 门冷却再命中）
        // 502 喵刀弹命中：无特效音/无计数消亡（全库唯一 PlaySound(37) 在撞块
        // HandleMovement :16797——2026-08-13 实测复核修正：曾误接在命中链）。
        // 命中只消费 penetrate（5 NPC 上限）+ localNPCHitCooldown 同敌冷却
        // ---- 吸血链（Projectile.cs:12877-12892 on-hit 段）----
        // 吸血鬼飞刀 304 → vampireHeal（:12879-12882，!moonLeech 门）；
        // 魔法弹 + 幽灵套 ghostHeal → ghostHeal（:13877-79）。
        // numHits = 此前已受理命中数（★BJ157-② 勘误：原版 numHits++（:14263）在 proc
        //  块【之后】，旧注「原版 StrikeNPC 先自增」系误记——StrikeNPC(:13702)≠numHits++;
        //  首跳读 0 ⇒ 率 0.20,旧 hitSet.size 含本敌 = 首跳 0.15 off-by-one）
        // ★BJ398 受理面化（尾段八站清扫③,:13869-13884 flag10 块在免疫门后——旧无条件
        // proc=拒收跳也白吃吸血/ghostHurt 出弹）
        if (!vanillaGated && this.projId === 304) {
          // ★BJ385 flag10 lifeMax>5 段补门（:13712）——304 vampireHeal 在 flag10 块内
          //  （:13876-13878,1456 旧注 :12879-12882 行号漂移）,BJ167 老站缺段;
          //  门单源 vanillaFlag10LifeMaxOk（critter 一击致死族原版不 proc）
          if (vanillaFlag10LifeMaxOk(e as unknown as { maxHp?: number; def?: { lifeMax?: number } })) {
            game.applyLifeSteal?.('vampire', Math.round(dmg), this.pveNumHits, this.x, this.y);
          }
        } else if (!vanillaGated && projectileData(this.projId)?.magic) {
          // ★BJ167-②③④（2026-09-19）spectre 域三小件对齐（MagicProj BJ157-① 同款习语）：
          //  ②victim 门 spectreVictimEligible——原版 Projectile.cs:13875
          //    `if (targetNPC.canGhostHeal | flag9)` 对 ghostHeal(:13877-79) 与
          //    ghostHurt(:13881-83) 【同块】设门（旧注「canGhostHeal 全 true 近似」
          //    作废）;false 族 384/387/388/523（NPC.cs:13921/:13961/:13978/:15839
          //    写点,字段缺省 true :6270）——旧码命中该族仍治疗
          //  ③dmg = num41 等位（:13712 `int num41 = targetNPC.StrikeNPC(...)` 返回值,
          //    :13879 实参）=防后实扣（Enemy.lastStrikeDealt 单源;旧传
          //    Math.round(dmg)=防前伤,治疗量按防御/旗乘差值虚高）
          //  ④出生点 = 受害者 Center（:13879 `new Vector2(targetNPC.Center.X,.Y)`;旧传
          //    弹体左上 this.x,y——治疗弹 298 起飞原点差几像素）
          const v661 = e as unknown as { vanillaId?: number | null; lastStrikeDealt?: number;
            maxHp?: number; def?: { lifeMax?: number } };
          // ★BJ385 flag10 lifeMax>5 段补门（:13712）——BJ167 老站缺段,门单源
          if (vanillaFlag10LifeMaxOk(v661) && spectreVictimEligible(v661.vanillaId)) {
            game.applyLifeSteal?.('ghost', v661.lastStrikeDealt ?? 0, this.pveNumHits,
              e.x + e.w / 2, e.y + e.h / 2, true);
          }
          // ★批⑥（2026-08-31）幽灵伤害头 ghostHurt（Projectile.cs:13881 调用点 /
          // :12021 方法体,SpectreSoulProj.ts 承载全套）：magic 弹命中且防后实扣
          // （Enemy.lastStrikeDealt≈StrikeNPC 返回值 num41）>1 → 预算池闸门后从
          // 受害者 Center 放追踪浮魂弹 356（伤=弹基伤）
          if (!this.hostile && playerHasGhostHurt(game.player)) {
            ghostHurtOnHit(game,
              { magic: true, projDamage: this.damage,
                projX: this.x, projY: this.y, projW: this.w, projH: this.h,
                ownerCx: game.player.cx, ownerCy: game.player.cy },
              { x: e.x, y: e.y, w: e.w, h: e.h,
                cx: e.x + e.w / 2, cy: e.y + e.h / 2,
                vanillaId: v661.vanillaId,
                lifeMax: v661.maxHp ?? v661.def?.lifeMax,
                dealt: v661.lastStrikeDealt ?? 0 });   // 本拍结算面（蓝队 F2② 修订）
          }
          // ★BJ424 星云套装 proc（:13885-13891,原版 ghostHurt 同块同门面）——引擎
          // 自持 magic/CD/1/3/受害者门,全 magic 弹面生效（旧 nebulaCb 仅 4 专支）
          nebulaBoosterOnHit(game,
            { projId: this.projId, projDirX: this.vx },
            { x: e.x, y: e.y, w: e.w, h: e.h,
              cx: e.x + e.w / 2, cy: e.y + e.h / 2,
              vanillaId: v661.vanillaId,
              lifeMax: v661.maxHp ?? v661.def?.lifeMax,
              dealt: v661.lastStrikeDealt ?? 0 });
        } else if (!vanillaGated) {
          // ★S2-债1 白耗面（2026-10-01,R1-B 定谳存档 meleeOnHitProjs.ts:552-570 台账
          //  兑现——本通用环=箭/回旋镖/召唤弹等非 magic PVE 命中最大族,旧档 magic 门
          //  把白耗整面挡死）。原版 :13877-79 调用点无类别门,:12090 `lifeSteal -= num2`
          //  先于 :12091-93 `if (!magic) return` ⇒ 幽灵兜帽在身时非 magic 命中【白扣
          //  治疗预算不出治疗球】=原版本相。isMagic=false 忠实直传（本臂仅数据面非
          //  magic 可达;真扣不回复由 applyLifeSteal :43432-33 承载,套装/月噬门在扣前
          //  =原版 :13877 调用点同位）;victim 门+flag10 lifeMax>5 段与 magic 臂同源;
          //  numHits = 自增前受理数（下方 :14263 位 ++ 在后,magic 臂同面）;
          //  !hostile/aiStyle≠59 段由环路径承载（:9134 hostile 早退/reflected 上拦;
          //  356 浮魂不流本环）。
          const v661 = e as unknown as { vanillaId?: number | null; lastStrikeDealt?: number;
            maxHp?: number; def?: { lifeMax?: number } };
          if (vanillaFlag10LifeMaxOk(v661) && spectreVictimEligible(v661.vanillaId)) {
            game.applyLifeSteal?.('ghost', v661.lastStrikeDealt ?? 0, this.pveNumHits,
              e.x + e.w / 2, e.y + e.h / 2, false);
          }
        }
        // ★BJ157-②③：numHits++（:14263——吸血链/ghostHurt on-hit 段之后的命中尾位,
        //  与原版递增点同相;读点（上方吸血链）取自增前值）
        //  ★BJ395：受理面化（:14263 在免疫门 :12635-12638 后,门拒跳整段不达;旧无条件
        //  自增=被拒跳虚增后续 proc 率档）
        if (!vanillaGated) this.pveNumHits++;
        // 710 空中祸害命中撒裂片（Damage() :13165-13168 → BetsySharpnel :51075-51091，
        // 在 penetrate-- 前）：本体（ai[1]≠-1）每跳撒 5 枚 710 裂片（abShard 标不再链）
        // ★BJ398 受理面化（尾段八站清扫④,:14185-14186 BetsySharpnel 在写梯后=拒收
        // 不可达;旧拒收跳也撒裂片=裂片弹幕 over-fire）
        if (!vanillaGated && this.projId === 710 && !this.abShard) this.spawnBetsyShards(game);
        // 638/639/640 月总箭每跳衰减（Damage() :13221-13224 `damage = (int)(damage×0.96)`）
        // ——原版在 num12 结算后改写 damage 字段 = 本跳全额、下一跳 ×0.96（穿透 4 跳
        // 递弱）；(int) 截断、钳 ≥1
        // ★BJ398 受理面化（尾段八站清扫⑤,1457 写梯环 :14241-14243——拒收跳不衰减,
        // 旧拒收也 ×0.96=后续受理跳伤值被白扣）
        if (!vanillaGated && (this.projId === 638 || this.projId === 639 || this.projId === 640)) {
          this.damage = Math.max(1, Math.trunc(this.damage * 0.96));
        }
        // ★T4（R 类清账,2026-09-02）：477 水晶镖 NPC 命中侧归巢（Projectile.Damage
        //  :13588-13614——`penetrate > 1` 门[判定用未减值,穿透递减在本行下方=同拍];
        //  (20,700)+CanHitLine 收集 ≤9 随机取样、victimIndex 豁免、全速转向,
        //  :13609 rotation 直写速度角+π/2）。撞块侧同构收集（HandleMovement
        //  :18776-18813,F4 已落地）已抽 collectHomingTargets477 共用——本支补齐
        //  Damage() 侧另一半。插位=伤害/状态结算后、穿透递减前（原版在
        //  SpawnHitVisuals/StatusNPC/StrikeNPC 之前——均不读 velocity;唯一速度
        //  消费方 knockback 已在上方 e.hurt 按【转向前】速度取号,与原版 position
        //  基方向等价不漂移;netUpdate=原版网络旗,本仓快照通道自动携带,不另写）。
        // ★BJ398 受理面化（尾段八站清扫⑥,:13588-13614 在免疫门后=拒收不可达;旧拒收
        // 跳也转向=弹道被白改）
        if (!vanillaGated && this.projId === 477 && this.pierce > 1) {
          const cands477h = this.collectHomingTargets477(game, e.id);
          if (cands477h.length > 0) {
            const pick477h = cands477h[Math.floor(Math.random() * cands477h.length)];   // Main.rand.Next(num35)
            const dx477h = pick477h.x - this.cx, dy477h = pick477h.y - this.cy;
            const dl477h = Math.hypot(dx477h, dy477h) || 1;
            const sp477h = Math.hypot(this.vx, this.vy);
            this.vx = (dx477h / dl477h) * sp477h;
            this.vy = (dy477h / dl477h) * sp477h;
            this.dartRot = Math.atan2(this.vy, this.vx) + Math.PI / 2;   // :13609 rotation 直写（AI 侧平滑自此角续算）
          }
        }
        // ★SW-BJ62 微光史莱姆 676 命中后反射（Damage_PVE_Inner :13721-13725——
        // StrikeNPC(:13706) 后、穿透外层递减前：伤害照常落账【同时】弹体被反射回玩家
        // （伤÷4/hostile 翻转/速度=|原速|），penetrate++ 补偿本次穿透消耗。676 不置
        // reflectsProjectiles（1457 全量核）故 :7835 事前支对 676 恒不触发——此前整支
        // 缺 = 射微光史莱姆无反射直死（用户实报 2026-09-06））
        // ★BJ398 受理面化（尾段八站清扫⑦,:13721-13725 在 StrikeNPC 后=拒收不可达;
        // 旧拒收跳也反射翻转弹体）
        if (!vanillaGated && (e as { vanillaId?: number | null }).vanillaId === 676
          && tryReflectShimmerSlimeHit(this, this.projId,
            e as unknown as { vanillaId?: number | null; immortal?: boolean }, game, this.life)) {
          this.pierce = 1;        // ReflectProjectile penetrate=1（NPC.cs:67212）
          this.pierceInit = 1;    // flag3 单发弹语义（同 :7837 事前支先例）
          this.pierce++;          // penetrate++（:13724）——下方递减后剩 1（原版同拍存续）
          this.hitSet.clear();    // 转敌对后本帧命中表作废（同 :7840 事前支先例）
        }
        // 穿透递减（−1 = 无限穿透不递减不消亡，修复1）
        // ★BJ395：受理面化（penetrate-- :14189-14196 在免疫门 :12635-12638 后;门拒跳
        //  原版不达=不耗穿透——旧无条件递减=502/局部免疫支被拒跳白耗穿透数）
        if (!vanillaGated && this.pierce > 0 && --this.pierce <= 0) { this.killNow(game); return; }
        // 451 涌流剑命中钩（Damage :14115-14121）：状态机推进（淡出→瞬移重射）
        // ★BJ398 受理面化（尾段八站清扫⑧,:14115-14128 特化支在梯内=拒收不可达,
        // PROJ_IMMUNE_NO_WRITE_TYPES 同锚;旧拒收跳也推进状态机）
        if (!vanillaGated && this.projId === 451) this.iwOnHit();
      }
    }
    }   // 钉 514 命中专管 else 收口
    // ★BJ467⑧（2026-10-03）尾段第二城镇面退役——原版 Damage() 单 Main.npc 数组单趟
    //  victim 循环（:12592）=每靶每拍至多一次受理,无第二城镇面。BJ455④ 定谳后本面
    //  已恒拒/跳过（face1 受理拍写 iframes=10/localImmuneCd → 本面 TownNPC.hurt
    //  帧窗门/skip 必拒,无受理路径）,穿透消费悬空=BJ467⑧ 判谳的「城镇受理 pierce
    //  缺位」根因。修=pierce 消费移位 face1 受理面（:9228）,本面整体摘除（与其留一个
    //  零受理死探针,不如对齐原版单面）;双调门语义由 face1 单面天然承载。
  }

  /** 1457 :15079-15086（Damage_GetHitbox 1106 狐火分支,仅此 type 挂高速门）:
   *  num2 = (int)Remap(localAI[0],0,72,0,20)（localAI[0]=出膛子步龄）;velocity.Length()>10
   *  → num2×2+10。★BJ642：×3 刻度补偿退役——Arrow 已消费 extraUpdates=2（本类
   *  子步环=age 逐子步自增,=localAI[0] 原生刻度）+ MinionProj 出生速度已回原版
   *  字面（5/10.5）,×3 反成三倍膨胀（age 36→108 钳 72→n 恒 20 满档）。速度门
   *  读原生 |v|（10.5 狐 1113 恒真、5 狐 1094 恒假,:60072-60074） */
  private foxHitInflate(): number {
    if (this.projId !== 1106) return 0;
    const age = Math.min(this.age, 72);
    let n = Math.floor((age / 72) * 20);
    if (Math.hypot(this.vx, this.vy) > 10) n = n * 2 + 10;
    return n;
  }

  /** 225 叶绿箭撞块弹反（HandleMovement type 段 Projectile.cs:17128-17150）：
   *  ai[1] += 1、首跳（==1）伤 ×0.66（:17131-17134）、第 4 撞 Kill（:17135-17139）、
   *  velocity = −lastVelocity（:17140-17141——原版按 TileCollision 改变的轴反，此处
   *  逐轴回退探测等价）+ FindTargetWithLineOfSight()（缺省 800）归巢：瞄准点 =
   *  目标中心上方 nPC.height×Lerp(0.1,0.5,GetLerpValue(0,300,t))（:17146-17148），
   *  保速转向。恒返回 true（消亡走内部 killNow，不落下方通用掉落/消亡口）。 */
  private chloroBounceOff(game: GameHooks): boolean {
    this.arrow225Ai1++;
    if (this.arrow225Ai1 === 1) this.damage = Math.max(1, Math.trunc(this.damage * 0.66));   // :17133
    if (this.arrow225Ai1 >= 4) { this.killNow(game); return true; }                          // :17135-17139
    const st = game.world.store;
    const solidAt = (px: number, py: number) => {
      const t0 = Math.floor(px / TILE), t1 = Math.floor(py / TILE);
      return st.inBounds(t0, t1) && st.isSolid(t0, t1);
    };
    if (this.vx !== 0 && !solidAt(this.x + this.w / 2 - this.vx, this.y + this.h / 2)) this.vx = -this.vx;
    if (this.vy !== 0 && !solidAt(this.x + this.w / 2, this.y + this.h / 2 - this.vy)) this.vy = -this.vy;
    const tgt = this.nearestEnemyWithLos(game, 800);
    if (tgt) {
      const t = Math.hypot(tgt.cx - this.cx, tgt.cy - this.cy);
      const lerp = Math.min(1, Math.max(0, t / 300));                 // GetLerpValue(0,300,t)
      const off = tgt.h * (0.1 + 0.4 * lerp);                         // Lerp(h*0.1, h*0.5, ·)
      const dx = tgt.cx - this.cx, dy = (tgt.cy - off) - this.cy;
      const dl = Math.hypot(dx, dy);
      const sp = Math.hypot(this.vx, this.vy);
      if (dl > 0) { this.vx = (dx / dl) * sp; this.vy = (dy / dl) * sp; }
      else { this.vx = 0; this.vy = -sp; }                            // SafeNormalize(-UnitY)
    }
    return true;
  }

  /** 1021 巨砾弹地（Projectile.cs:17578-17600）：Y 被挡 lastVy>4 → HitTiles 尘 +
   *  Dig 音（PlaySound 0）+ vy ×−0.9；缓落（0<lastVy≤4）置 rest 标（localAI[1]=999
   *  → 后续 X 撞直接消亡）；X 被挡 ×−0.75 反弹计 3 次（:17592-17595），超次
   *  Kill（false 交还调用方消亡）。顶棚（lastVy≤0）原版不显式反弹（碰撞解算
   *  归零）——此处对齐 ×−0.9 近似。 */
  private boulderBounceOff(game: GameHooks): boolean {
    const st = game.world.store;
    const solidAt = (px: number, py: number) => {
      const t0 = Math.floor(px / TILE), t1 = Math.floor(py / TILE);
      return st.inBounds(t0, t1) && st.isSolid(t0, t1);
    };
    // Y 轴被挡：回退一步（−vy）脱离实心即成立
    if (this.vy !== 0 && !solidAt(this.x + this.w / 2, this.y + this.h / 2 - this.vy)) {
      if (this.vy > 4) {
        game.playSfx('dig', 1, this.cx, this.cy);            // :17583-17584
        game.spawnParticles(this.cx, this.cy + this.h / 2, '#B8A890', 4, 2, { life: 20 });
        this.y -= this.vy;
        this.vy = -this.vy * 0.9;                            // :17585
      } else if (this.vy > 0) {
        this.y -= this.vy;
        this.vy = 0;                                         // 贴地（后续 |vy|≤1 滚动加速段接管）
        this.boulderBounces = 999;                           // :17586-17588 rest 标
      } else {
        this.y -= this.vy;
        this.vy = -this.vy * 0.9;                            // 顶棚近似
      }
    }
    // X 轴被挡：×−0.75 反弹计次，>3 消亡
    if (this.vx !== 0 && !solidAt(this.x + this.w / 2 - this.vx, this.y + this.h / 2)) {
      if (this.boulderBounces <= 3) {
        this.x -= this.vx;
        this.vx = -this.vx * 0.75;                           // :17592-17595
        this.boulderBounces += 1;
      } else {
        return false;                                        // :17596-17599
      }
    }
    // 回退后仍嵌实心（嵌入过深）→ false 消亡
    return !solidAt(this.x + this.w / 2, this.y + this.h / 2);
  }

  /** 荆棘球 277 撞块反弹（HandleMovement type==277 支：1458 P.cs:19838-19845 /
   *  1457 :19829-19836 两版一致）：vx 恒反 ×0.9；竖向仅入撞 lastVelocity.Y>3f 才
   *  ×-0.9——1<vy≤3 轻着陆落定滚动而非弹起（2026-08-31 台账 B 档清偿：旧门 vy>1
   *  系与 type185 的 >1f 门混串,回滚修正）。本仓碰撞解算进本函数前未改写速度,
   *  velocity ≙ lastVelocity（原式判 `velocity.Y != lastVelocity.Y` 后取后值）。
   *  缓落地(vy≤3 的下落撞地)才滚动 = vy 归零 + 摩擦 ×0.97 + |vx|≤0.01 静止自灭
   *  （滚动衰减为本仓承载件,原文无显式支;空中侧撞勿砍 vy——曾 `bounced||` 门
   *  误伤,review 修）。逐轴回退探测，脱困失败 false。 */
  private thornBounceOff(game: GameHooks): boolean {
    const st = game.world.store;
    const solidAt = (px: number, py: number) => {
      const t0 = Math.floor(px / TILE), t1 = Math.floor(py / TILE);
      return st.inBounds(t0, t1) && st.isSolid(t0, t1);
    };
    let bounced = false;
    if (!solidAt(this.x + this.w / 2 - this.vx, this.y + this.h / 2)) {
      this.x -= this.vx;
      this.vx *= -0.9;
      bounced = true;
    }
    // :19841-19845 Y 反弹门 lastVelocity.Y>3（1458）/ :19832-19836（1457）;
    // 原注释引 ":23389-23399 vy>1" 系 aiStyle14 默认档误锚
    if (this.vy > 3 && !solidAt(this.x + this.w / 2, this.y + this.h / 2 - this.vy)) {
      this.y -= this.vy;
      this.vy *= -0.9;
      bounced = true;
    } else if (this.vy > 0) {
      this.vy = 0;
      this.vx *= 0.97;
      if (Math.abs(this.vx) <= 0.01) { this.dead = true; }
    }
    return bounced;
  }

  /** aiStyle 14 撞块反弹（Projectile.cs:18314-18327 默认档：法向 ×-0.5，低速归零）。
   *  逐轴回退探测穿透轴并反弹；两轴均无法脱困（嵌入过深）则返回 false 交还消亡。 */
  private bounceOff(game: GameHooks): boolean {
    const st = game.world.store;
    const solidAt = (px: number, py: number) => {
      const t0 = Math.floor(px / TILE), t1 = Math.floor(py / TILE);
      return st.inBounds(t0, t1) && st.isSolid(t0, t1);
    };
    let bounced = false;
    // X 轴：回退一步脱离实心 → 穿透轴是 X，反弹并退回
    if (!solidAt(this.x + this.w / 2 - this.vx, this.y + this.h / 2)) {
      this.x -= this.vx;
      this.vx *= -0.5;
      bounced = true;
    }
    if (!solidAt(this.x + this.w / 2, this.y + this.h / 2 - this.vy)) {
      this.y -= this.vy;
      this.vy = this.vy > 1 ? -this.vy * 0.5 : 0;
      bounced = true;
    }
    return bounced;
  }

  /** 喵刀弹 502 撞块档（HandleMovement :16794-16812——type 502 专支，先于
   *  通用 aiStyle-8 tink 链（:18165）命中，故弹跳只喵叫不 tink）：
   *  ai[0]=Clamp(+1,1,5) + PlaySound(37=Meowmere, style 5+ai0)（Item_57/58
   *  随机、音高扰动 ±0.4 由双素材近似）；≥5 消亡；全速翻面（与 lastVelocity
   *  逐轴对比后取负）。
   *  ★BJ693 登记债①②③清偿（2026-10-17 BJ692 普查登记债开刀）：
   *  ①音量系数勘误——旧 0.5×style×0.05（0.15-0.25）=原版一半；LSP case37 :1338
   *    `num2 × Style×0.05` 无 ×0.5（旧式疑误并 case2 库内 style37 的 ×0.5 音量
   *    微调面——那是 PlaySound(2,…,37) 的 Item_37 档,与喵刀 case37 不同物）。
   *    修=style×0.05（style 6-10 → 0.30-0.50）。
   *  ②彩虹尘环（:18337-18348）：dust66 ×(10+ai0×4) 环形爆发，色=hsl(i/n,1,0.5)
   *    彩虹序（empressHslRgb=Main.hslToRgb 同式），速度=（0,−(3+ai0)) 绕随机基角
   *    +环角×(1.05,1)×(0.8+rand×0.4)，noGravity，scale=1+ai0/3，NewDustPerfect
   *    语义（perfect 通道——原版 NewDust(Center,0,0)+position/velocity 全覆写同构）。
   *  ③弹跳扩大盒 AOE（:18349-18364）：盒临时扩 40+8×ai0（心锚定）+penetrate=-1
   *    （dealContacts 纯结算无穿透消耗面=−1 语义免设）→Damage() 等价；cd 适配器
   *    桥到 meowHitCd——与主命中环【同表】=原版 localNPCImmunity 同表同构（弹跳
   *    AOE 与常规命中共享 10t 局部免疫）。owner 本机门（:18349）单机恒真免设。
   *  ★BJ704-G9（2026-10-21，R2-F1+F10 清偿）：
   *  a)死亡跳三面补齐——原版 HandleMovement type502 块（:18317-18365）中尘环
   *    （:18337-18348）与扩盒 Damage()（:18349-18364）位于 kill/else【两分支之外】：
   *    第 5 跳（kill 跳）仍 position+=velocity 前移（:18323）→30 尘最大彩虹环+
   *    40+8×5=80px 最大 AOE（Kill() 置 active=false 不拦本块直线码;Damage() 无
   *    active 门 :12502、Damage_CanDealDamage 无 502 拒收 :12463）。旧
   *    `if(meowCount>=5){killNow;return true;}` 早退=前移/尘环/AOE 三面全缺。
   *  b)③盒交换心锚定修正——原版 `position=Center; w=h=box; Center=position`
   *    （:18354-18356）=心保持;旧仓 `this.w=box 后 this.x=this.cx-box/2` 读的
   *    cx 已含【新 w】⇒ 盒顶左钉死原位=向 +x/+y 偏 (box−16)/2（死亡跳 32px）。
   *    修=扩盒【前】先取心。
   *  c)R2-F10 扩盒割草——原版 Damage() 对 friendly+myPlayer 弹先 CutTiles()
   *    （:12515-12518;CutTilesAt 吃当前【已扩】盒 :15349,CanCutTiles :15407 尾支
   *    对 502=true）→ 每次弹跳（含死亡跳）扩盒面积割草/碎罐。常盒逐拍割面由
   *    EntityManager 中央收口承载（Entity.ts,活拍）——本位只补弹跳拍扩盒差量;
   *    死亡跳 killNow 后中央收口跳过（!dead 门,BJ232）⇒ 本位即死亡跳唯一割面。 */
  private meowBounceOff(game: GameHooks): boolean {
    const st = game.world.store;
    const solidAt = (px: number, py: number) => {
      const t0 = Math.floor(px / TILE), t1 = Math.floor(py / TILE);
      return st.inBounds(t0, t1) && st.isSolid(t0, t1);
    };
    this.meowCount = Math.max(1, Math.min(5, this.meowCount + 1));   // Clamp(:16796)
    const style = 5 + this.meowCount;
    // ①喵叫音（case37）：音量 style×0.05（勘误——原版无 ×0.5）
    game.playSfxFiles([Math.random() < 0.5 ? 'Item_57' : 'Item_58'],
      style * 0.05, this.cx, this.cy);
    // kill/else 两分支（:18321-18336）：死亡跳=前移+Kill（反射只在 else 支）
    if (this.meowCount >= 5) {
      this.x += this.vx;   // :18323 position += velocity（前移后再环/AOE）
      this.y += this.vy;
      this.killNow(game);
    } else {
      if (!solidAt(this.x + this.w / 2 - this.vx, this.y + this.h / 2)) {
        this.x -= this.vx;
        this.vx = -this.vx;
      }
      if (!solidAt(this.x + this.w / 2, this.y + this.h / 2 - this.vy)) {
        this.y -= this.vy;
        this.vy = -this.vy;
      }
    }
    // ②彩虹尘环（:18337-18348）——kill/else 分支外,死亡跳（ai0=5：30 尘/r=8/
    //    scale=1+5/3）照跑;心=前移后 Center（this.cx 于 16px 原盒读=同构）
    {
      const base = Math.random() * Math.PI * 2;          // RotatedByRandom(π)=任意基角
      const r = 3 + this.meowCount;                       // (0,−(3+ai0)) 长度
      const n = 10 + this.meowCount * 4;                  // num21 = 10+ai0×4
      for (let i = 0; i < n; i++) {
        const ang = base + Math.PI * 2 * i / n;
        const jit = 0.8 + Math.random() * 0.4;            // 0.8+NextFloat×0.4
        const rgb = empressHslRgb(i / n);                 // hsl(i/n,1,0.5) 彩虹序
        const d = game.spawnDust?.(this.cx, this.cy, 0, 0, 66,
          Math.cos(ang) * r * 1.05 * jit, Math.sin(ang) * r * jit,
          0, { r: rgb[0], g: rgb[1], b: rgb[2], a: 255 }, 1, true, true);
        if (d) d.scale = 1 + this.meowCount / 3;          // scale=1+ai0/3（后置赋值）
      }
    }
    // ③弹跳扩大盒 AOE（:18349-18364）——kill/else 分支外,死亡跳（80px）照跑：
    //    心锚定盒交换→CutTiles（R2-F10,先于结算 :12517→:12523 同序）→dealContacts→还原
    {
      const aoeCd = {
        tick: () => {},   // 主拍 tick 在 subStepAI meowHitCd 段同表已做,此处不双扣
        peek: (id: number) => (this.meowHitCd.get(id) ?? 0) <= 0,
        commit: (id: number, cdv: number) => { this.meowHitCd.set(id, cdv); },
      } as unknown as Parameters<typeof dealContacts>[2];   // cd 参（第 3 位）duck 桥
      const oldW = this.w, oldH = this.h, oldX = this.x, oldY = this.y;
      const box = 40 + 8 * this.meowCount;
      const cX = this.cx, cY = this.cy;                   // 扩盒前取心（:18354 先于尺寸交换）
      this.w = box; this.h = box;
      this.x = cX - box / 2; this.y = cY - box / 2;       // 心保持（旧式顶左钉死=+偏(box−16)/2）
      if (!this.hostile && !this.reflected) {             // :12516 friendly&&myPlayer&&!npcProj&&!minion
        cutTilesBox(game, this.x, this.y, this.w, this.h, 502);   // R2-F10 扩盒割草
      }
      dealContacts(this, game, aoeCd, 10);                // localNPCHitCooldown=10 同表
      this.w = oldW; this.h = oldH; this.x = oldX; this.y = oldY;
    }
    return true;
  }

  // ================= 食人鱼 190（aiStyle 39，Projectile.cs:27907-28173）=================
  // 状态机 1:1：ai[0]=0 直飞咬敌（:28103）/ 1 返回玩家（:28121）；ai[1]=0 未咬可咬 /
  // >0 咬住（Damage_PVE :13270 首咬写入 index+1）/ −1 松手禁再咬（:27951-27954）。
  // 咬住伤害 = 普通 hitbox 接触走 Damage_PVE（:12595 localNPCImmunity 门 +
  // :12635-12637 全局 immune 门），localNPCHitCooldown=14t 同敌周期撕咬（:14175-14179）。
  // ★BJ344 勘误:旧锚 :11868-11871/:11905/:13157 系 1456 世代,1457 对应上行三新锚。

  /** 姿态记录（:27976-27993/:27995-28015/:28103-28142 三处 rotation 赋值：
   *  vx<0 → spriteDirection=−1 + rotation=atan2(−vy,−vx)，等效 draw 的
   *  scale(−1)+rotate(π−ang) 变换——此处只存未镜像角 + 翻转位） */
  private pFace(vx: number, vy: number): void {
    this.pRot = Math.atan2(vy, vx);
    this.pFlip = vx < 0;
  }

  /** 统一消亡出口 + 回收补弹（Kill 语义；在场数 <3 且仍按住 → 补满 3，
   *  Player.cs:42856-42868 ItemCheck num∈(0,3) 置 flag4 → :47768-47786 生成 3−num 条） */
  private piranhaKill(game: GameHooks): void {
    this.dead = true;
    game.onProjectileDeath?.(this.projId, this.x, this.y, this.w, this.h);
    if (this.piranha?.channel()) this.pTopUp(game);
  }

  /** 回收补弹（ItemCheck_Shoot 1156 专支 1457 Player.cs:48846-48862〔1456 世代
   *  :47768-47786〕：生成 3−在场数 条；速度分量各 +Next(−40,41)×0.05 扰动。
   *  ★BJ499（2026-10-04）出生点定谳=pointPosition=玩家中心（:47588 RotatedRelativePoint(
   *  MountedCenter) + NewProjectile 传位=盒心 Projectile.cs:10878-10879）——补射门
   *  :43878-43892 与首发同走专支,补射与首发【同点】,原版无"枪口偏移";曾用中心前
   *  14px/y−4 自创枪口（Game.ts :18554 批注已拆族的 px/py 残留）,现出生/瞄准均回
   *  玩家中心,盒心回正内联（WeaponProj 反向 import Arrow 禁回环,同式
   *  placeAtShootSpawn 语义）。
   *  无重播 UseSound——原版 channel 期 itemTime 恒被 SetDummyItemTime(5) 顶住，
   *  无第二次 use 起手声） */
  private pTopUp(game: GameHooks): void {
    const p = game.player as { cx: number; cy: number } | null;
    const ents = (game as unknown as {
      entities?: { projectiles?: unknown[]; add?: (e: unknown, b: string) => void };
    }).entities;
    if (!p || !ents?.add) return;
    const alive = (ents.projectiles ?? []).filter(
      (o) => (o as { projId?: number }).projId === PIRANHA_PROJ && !(o as { dead?: boolean }).dead).length;
    const aim = this.piranha!.aim();
    const a = Math.atan2(aim.y - p.cy, aim.x - p.cx);   // 瞄准原点=玩家中心（:47743-47744 num4/num5 起算=pointPosition）
    for (let i = 0; i < 3 - alive; i++) {
      // ★BJ499 出生点=玩家中心（ctor 收盒左上 → 下方盒心回正,同首发位 Game.ts :20757
      //  placeAtShootSpawn 同式;曾用 中心前14px/y−4 自创枪口=非原版）
      const np = new Arrow(p.cx, p.cy,
        Math.cos(a) * this.pShootSpeed + (Math.floor(Math.random() * 81) - 40) * 0.05,
        Math.sin(a) * this.pShootSpeed + (Math.floor(Math.random() * 81) - 40) * 0.05,
        this.damage, this.knockback, PIRANHA_PROJ,
        { grav: 0, life: PIRANHA_LIFE, piranha: this.piranha! });
      np.x = p.cx - np.w / 2;   // ★BJ499 盒心回正（placeAtShootSpawn 同式,盒心=玩家中心）
      np.y = p.cy - np.h / 2;
      np.critChance = this.critChance;
      // ★BJ498①：critBonus 传播写位摘除（链上死值零读者——源恒类缺省 0,锚=字段注 BJ498①）
      np.armorPen = this.armorPen;
      np.frostEligible = this.frostEligible;
      np.pShootSpeed = this.pShootSpeed;
      ents.add(np, 'projectiles');
    }
  }

  /** 荆棘链段状态机（aiStyle 4，Projectile.cs:23943-24080 逐行；红队 R27 §10/§11）。
   *  ★UpdatePosition 对 aiStyle==4 整体早退（:20552）= 链段全程【静止】——"逐节接力"
   *  是每段出生在父段前方一格速度处（position+velocity+halfSize）的视觉推进，
   *  非弹体位移。返回前已置 dead 时由调用方收口。 */
  private thornStep(game: GameHooks): void {
    const nettle = this.projId >= 150 && this.projId <= 152;
    // ★BJ353：魔晶碎块链（494 杆→493 头,aiStyle 4 同族;Item.cs:28200 shoot=494）
    const crystalVile = this.projId === 493 || this.projId === 494;
    // 出生音（localAI[0]==0 && ai[1]==0 门 :23945-23954——仅武器首发段播,
    // 链生段 ai[1]>=1 静默；type494 → Item101 :23949-23951,余型 Item8）
    if (!this.thornBornSounded) {
      this.thornBornSounded = true;
      if (this.thornAi1 === 0) {
        game.playSfxFiles?.([this.projId === 494 ? 'Item_101' : 'Item_8'], 1, this.cx, this.cy);
      }
    }
    if (this.thornAi0 === 0) {
      // 渐显期（:23956-24032）
      // 150 族出生翻转（ai[1]==0 && alpha==255 && rand(2)==0 → type++ :23958-23962）
      if (nettle && this.thornAi1 === 0 && this.alpha === 255 && Math.floor(Math.random() * 2) === 0) {
        this.projId++;
      }
      this.alpha -= 50;                    // :23963
      if (nettle) this.alpha -= 25;        // :23964-23967（净步长 −75）
      else if (crystalVile) this.alpha -= 50;   // :23968-23970（BJ353：493|494 净步长 −100 → 3 拍渐显）
      if (this.alpha > 0) return;          // 渐显期不动（UpdatePosition 早退）
      this.alpha = 0;
      this.thornAi0 = 1;
      if (this.thornAi1 === 0) {           // :23978-23982（仅首发段补一步位移）
        this.thornAi1++;
        this.x += this.vx;
        this.y += this.vy;
      }
      // 链生子段（owner==myPlayer 门 :23983/:24012——本仓以 !hostile 近似,敌侧不生成）
      if (this.hostile) return;
      const ents = (game as unknown as {
        entities?: { add?: (e: unknown, b: string) => void };
      }).entities;
      if (!ents?.add) return;
      let childType = this.projId;
      let childDmg = this.damage;
      let childKb = this.knockback;
      if (this.projId === 7) {                       // :23985-23989（ai[1]>=6 升尾刺 8）
        if (this.thornAi1 >= 6) childType = 8;
      } else if (this.projId === 150 || this.projId === 151) {   // :23990-24008
        childType = this.projId === 150 ? 151 : 150;            // 150↔151 每节翻转
        if (this.thornAi1 >= 10 && this.projId === 151) childType = 152;   // 尾端
      } else if (this.projId === 494) {
        // ★BJ353 魔晶碎块链（:24012-24029）：494 链生 494,ai[1]≥7+rand(2) 该节升
        //  493 头;升头时伤/击退 ×1.25（:24016-24021,(int)((double)damage*1.25) C# 截断;
        //  rand(2) 掷在父段渐显归零拍=本位,掷序与原版同位）
        if (this.thornAi1 >= 7 + Math.floor(Math.random() * 2)) childType = 493;
      } else {
        return;                                   // 8/152/493 头尾端不再链生
      }
      if (childType === 493) {                     // :24018-24021（num32==493 门）
        childDmg = Math.trunc(this.damage * 1.25);
        childKb = this.knockback * 1.25;
      }
      // ★BJ353 出生位勘误（全族）：原版调用式 `position+v+(w/2,h/2)` 是喂给
      //  NewProjectile 的【中心】,:10878-10879 内部再减 (w/2,h/2) 居中 —— 净效果 =
      //  子段左上 = 父段左上 + v（无半盒项）。R27 旧式把调用式当左上直传 = 每代
      //  右下漂移半盒、沿链累积（7/8 28px 盒 14px/代、150 族 12px/代、494 族 16px/代）
      const child = new Arrow(this.x + this.vx, this.y + this.vy,
        this.vx, this.vy, childDmg, childKb, childType,
        { thornChainAi1: this.thornAi1 + 1 });
      child.critChance = this.critChance;
      // ★BJ498①：critBonus 传播写位摘除（链上死值零读者——源恒类缺省 0,锚=字段注 BJ498①）
      child.armorPen = this.armorPen;
      ents.add(child, 'projectiles');
      return;
    }
    // 淡出期（:24034-24080）
    // 穿 170 尘爆（门字面 = alpha < 170 && alpha+5 >= 170 :24034——nettle/494 步长 3/4 但门仍 +5）
    if (this.alpha < 170 && this.alpha + 5 >= 170) {
      if (nettle) {
        for (let i = 0; i < 8; i++) {            // :24038-24044 d7 ×8
          const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 7,
            this.vx * 0.025, this.vy * 0.025, 200, null, 1.3, true);
          if (d) { d.vx *= 0.5; d.vy *= 0.5; }
        }
      } else if (crystalVile) {
        // ★BJ353：493|494 穿 170 尘爆（:24046-24053 d=rand(68,71) 晶尘 ×8,
        //  noGravity scale1.3 α200,v×0.025 起 + ×0.5 收——同 nettle 形,异尘号）
        for (let i = 0; i < 8; i++) {
          const d = game.spawnDust?.(this.x, this.y, this.w, this.h,
            68 + Math.floor(Math.random() * 3),
            this.vx * 0.025, this.vy * 0.025, 200, null, 1.3, true);
          if (d) { d.vx *= 0.5; d.vy *= 0.5; }
        }
      } else {
        for (let i = 0; i < 3; i++) {            // :24058-24061 d18 ×3 + d14 ×1
          game.spawnDust?.(this.x, this.y, this.w, this.h, 18,
            this.vx * 0.025, this.vy * 0.025, 170);
        }
        game.spawnDust?.(this.x, this.y, this.w, this.h, 14, 0, 0, 170, null, 1.1);
      }
    }
    this.alpha += crystalVile ? 4 : nettle ? 3 : 5;   // :24066-24074（493|494 步长 4）
    if (this.alpha >= 255) this.killNow(game);   // :24077-24080（无声无尘自然消亡）
  }

  private piranhaStep(game: GameHooks): void {
    // Update :15329 DecrementLocalImmuneTimeCounters——localNPCImmunity 逐帧递减
    for (const [k, v] of this.pHitCd) {
      if (v <= 1) this.pHitCd.delete(k); else this.pHitCd.set(k, v - 1);
    }
    if (--this.life < 0) { this.piranhaKill(game); return; }   // R7-5：AI 恰跑 timeLeft 次（食人鱼无 Kill 链,杀拍差一子步无观察面,备案）
    this.age++;
    // 淡入（:27909-27913）
    this.pAlpha = Math.max(0, this.pAlpha - 50);
    const p = game.player as { cx: number; cy: number; vx?: number; vy?: number; dead?: boolean; facing?: number } | null;
    // :26072-26077 玩家失活/死亡/离主 >2000 → Kill
    if (!p || p.dead) { this.piranhaKill(game); return; }
    const dxp = p.cx - this.cx, dyp = p.cy - this.cy;
    const dp = Math.hypot(dxp, dyp);
    if (dp > 2000) { this.piranhaKill(game); return; }
    // :26078-26087 淡入完成后每帧面向食人鱼（SetDummyItemTime 持物锁未接，登记 GAP）
    if (this.pAlpha === 0 && p.facing !== undefined) p.facing = this.cx > p.cx ? 1 : -1;
    // :26093-26096 松手（淡入完成后才生效）：返回 + ai[1]=−1 禁再咬
    if (this.pAlpha === 0 && !this.piranha!.channel()) {
      this.pAi0 = 1; this.pAi1 = -1; this.pTarget = null;
    }
    // :26098-26102 咬住超距（离主 >1500）脱咬转返回（ai[1]=0 仍可再咬）
    if (this.pAi1 > 0 && dp > 1500) { this.pAi1 = 0; this.pAi0 = 1; this.pTarget = null; }
    let tileCollide = true;
    if (this.pAi1 > 0) {
      tileCollide = false;                                   // :26105
      const t = this.pTarget;
      if (t && !t.dead && t.hp > 0) {                        // :26107 目标存活
        const speed = 16;                                    // :26109 num313 咬敌速
        const dx = t.cx - this.cx, dy = t.cy - this.cy;
        const d = Math.hypot(dx, dy);
        if (d < speed) {
          this.vx = dx; this.vy = dy;                        // :26116-26117 残差直抵
          if (d > speed / 3) {
            this.pFace(this.vx, this.vy);                    // :27976-27987 朝目标
            this.vx = 0; this.vy = 0;                        // :26126-26129 type 190 咬定
          }
        } else {
          const dd = d === 0 ? 0.0001 : d;                   // :26132-26136
          this.vx = dx / dd * speed; this.vy = dy / dd * speed;
          this.pFace(this.vx, this.vy);                      // :27995-28015（★BJ386 勘误,旧值系 1456 世代）
        }
        this.x += t.vx; this.y += t.vy;                      // :26159-26161 跟随目标速度
        // :26162-26178 同主多弹排斥（<8px 逐轴 ∓4——多鱼咬同一大体型怪时散开）
        const sibs = (game as unknown as {
          entities?: { projectiles?: Array<{ projId?: number; dead?: boolean; x?: number; y?: number; cx?: number; cy?: number }> };
        }).entities?.projectiles;
        if (sibs) {
          for (const o of sibs) {
            if (o === this || o.projId !== PIRANHA_PROJ || o.dead) continue;
            if (Math.hypot((o.cx ?? 0) - this.cx, (o.cy ?? 0) - this.cy) >= 8) continue;
            if (this.x < (o.x ?? 0)) this.vx -= 4; else this.vx += 4;
            if (this.y < (o.y ?? 0)) this.vy -= 4; else this.vy += 4;
          }
        }
        this.pAi0 = 1;                                       // :26184-26188 咬住期恒置 1
      } else {
        // :26190-26196 目标死亡 → 清咬
        this.pAi1 = 0; this.pTarget = null;
        // :28055-28081 半径 3000 内视线可达最近敌（CanBeChasedBy NPC.cs :91139 近似 =
        //  存活/未无敌/可受伤；Manhattan 度量 num322）
        let best: PiranhaTarget | null = null;
        let bestScore = 3000;                                // :26205 num319
        let bx = 0, by = 0;
        for (const ent of game.enemies()) {
          const e = ent as unknown as PiranhaTarget;
          if (e.dead || e.hp <= 0 || e.dontTakeDamage) continue;
          if (!canBeChasedBy(e)) continue;   // friendly 门（CanBeChasedBy NPC.cs :91139——睡渔夫 376 等友好 NPC 不入索敌）
          const score = Math.abs(this.cx - e.cx) + Math.abs(this.cy - e.cy);
          if (score >= bestScore) continue;
          if (!canHit(game.world.store, this.x, this.y, this.w, this.h, e.x, e.y, e.w, e.h)) continue;
          bestScore = score; best = e; bx = e.cx; by = e.cy;
        }
        if (best) {
          // :28081-28099 转咬新目标（立即入咬住态，速度 16 直指）
          const dd = Math.hypot(bx - this.cx, by - this.cy) || 0.0001;
          this.vx = (bx - this.cx) / dd * 16;
          this.vy = (by - this.cy) / dd * 16;
          this.pFace(this.vx, this.vy);
          this.pAi0 = 0; this.pAi1 = 1; this.pTarget = best;
        }
        // 未找到新目标 → pAi0 已被 :26188 段置 1 → 返回（即便仍按住）
      }
    } else if (this.pAi0 === 0) {
      // :28103-28120 直飞：无追踪（首咬靠接触），离主 >700 → 返回
      if (dp > 700) this.pAi0 = 1;                           // :26247-26251
      this.pFace(this.vx, this.vy);                          // :28110-28119
    } else {
      // :28121-28157 返回：穿墙、速度 20 直指玩家、<70px 回收
      tileCollide = false;
      this.pFace(this.vx, this.vy);                          // :28124-28143（保留来向姿态）
      if (dp < 70) { this.piranhaKill(game); return; }       // :26276-26279
      const dd = dp === 0 ? 0.0001 : dp;                     // :26273 num324=20
      this.vx = dxp / dd * 20;
      this.vy = dyp / dd * 20;
      this.x += p.vx ?? 0; this.y += p.vy ?? 0;              // :28154-28157 type 190
    }
    // :28159-28168 帧推进（4t/帧 4 帧循环；AI 侧真源，draw 消费 pFrame）
    if (++this.pFrameCounter >= 4) {
      this.pFrameCounter = 0;
      this.pFrame = (this.pFrame + 1) % 4;
    }
    // 位移积分（Update 运动段在 AI 后）
    this.x += this.vx;
    this.y += this.vy;
    const tx = Math.floor((this.x + this.w / 2) / TILE);
    const ty = Math.floor((this.y + this.h / 2) / TILE);
    if (!game.world.store.inBounds(tx, ty)) { this.piranhaKill(game); return; }
    // 撞块（HandleMovement :17940-17964 aiStyle 39 档：HitTiles 尘 + dig 声 +
    //  ai[0]=1 返回，弹体不消亡；咬住/返回期 tileCollide=false 整段跳过）
    const tileType = game.world.store.get(tx, ty);
    if (tileCollide && tileType !== 0) {
      game.cutTile(tx, ty);
      if (game.world.store.isSolid(tx, ty)) {
        this.x -= this.vx; this.y -= this.vy;                // 碰撞回退（停在墙前）
        this.vx = 0; this.vy = 0;
        this.pAi0 = 1;                                       // :17958 返回
        game.spawnParticles(this.cx, this.cy, '#B0A080', 4, 1.5, { life: 18 });
        game.playSfx('dig', 1, this.cx, this.cy);            // :17962 SoundID.Dig(0)
      }
    }
    // 小动物接触（Damage_PVE 对 NPC 通用：小动物 friendly=false 亦受击；
    //  penetrate=−1 弹体不消耗；非 CanBeChasedBy 目标不会成为咬住对象）
    hitCritters(this, game);
    // 命中结算（Damage_PVE :12572 迭代 + Damage_PVE_Inner :12615）
    for (const ent of game.enemies()) {
      const e = ent as unknown as PiranhaTarget;
      if (e.dead) continue;
      // ★dontTakeDamage 目标排除（:12600 同款——拒收命中不得耗 snapStrike/咬击冷却，最终清零补）
      if ((ent as unknown as { dontTakeDamage?: boolean }).dontTakeDamage === true) continue;
      if (!playerCanHitEnemy(e, game, this.projId)) continue;   // friendly 门（Damage_PVE_Inner :12622/CanBeChasedBy NPC.cs :91139——睡渔夫 376 等友好 NPC 玩家武器无效/不追踪）
      if (!(this.x < e.x + e.w && this.x + this.w > e.x
        && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
      if (this.pHitCd.has(e.id)) continue;                   // :12595 localNPCImmunity 门
      if ((e.iframes ?? 0) > 0) continue;                    // :12635-12637 npc.immune[owner] 门（★BJ344 勘误:旧锚 :11905 系 1456 世代）
      // StrikeNPC :12811——★BJ497①（2026-10-04）掷率收编（BJ493② 改形先例）：旧 `||`
      //  面把 BJ489 路由门 0.04 误当 4% 平率（190 spawn 双位 :20760 首发/:29359 补射
      //  spawn 侧逐位亲读）+丢 owner 聚合/:25712 持械折入=BJ489 路由化时本环漏迁的
      //  现役退化。190 数据面 ranged（SetDefaults :2789）→ 命中拍 rollVanillaHitCrit 动态。
      const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
      const dmg = crit ? this.damage * 2 : this.damage;
      // StatusNPC :10622-10625：命中必挂 Hemorrhage(375) 240-360t（表驱动）
      applyProjStatus(PIRANHA_PROJ, e as unknown as Record<string, number>);
      if (this.frostEligible) {
        applyFrostBurn((game.player as unknown as { equipStats?: { frostBurn?: boolean } })
          .equipStats?.frostBurn ?? false, e as unknown as Record<string, number>);
      }
      // ★焰爆石 kind1 + 拍击石 kind0 弹幕侧（Damage_PVE_Inner :13439-13446 同序双支
      //  + F4 补支,2026-08-31 蓝队四轮）——食人鱼弹 190 数据面 ranged：原主环
      //  Arrow.dealContacts 两 kind 双接、本环此前只接 kind1 = 漏网；统一走
      //  projectileSnapStrikeBonus 单源（k1→k0 门序;360t 共用冷却），加伤并入本次实伤。
      const snapBonusPiranha = projectileSnapStrikeBonus(game, this,
        (e as { cx?: number }).cx ?? e.x + e.w / 2, (e as { cy?: number }).cy ?? e.y + e.h / 2,
        e.id, {
          victimBox: { w: e.w, h: e.h, cx: (e as { cx?: number }).cx ?? e.x + e.w / 2,
            cy: (e as { cy?: number }).cy ?? e.y + e.h / 2 },
          targeterBox: { x: this.x, y: this.y, w: this.w, h: this.h },
          exclude: (id: number): boolean => this.pHitCd.has(id),   // localNPCImmunity 门同源表(:12595)
        });
      // pierce=1 档：命中不设敌方免疫帧（:13154-13158 immune[owner]=0 语义），
      // fromPlayer=true 走 DPS/掉落门链；音/飘值=StrikeNPC 单点；★F1 加伤随暴击并入
      e.hurt(applyBannerDamageDealt(game, e, dmg)
        + (snapBonusPiranha ? Math.trunc(snapBonusPiranha * (crit ? 2 : 1)) : 0),
        Math.sign(e.cx - this.cx) * this.knockback, 0, game, this.settlePen, crit, 1, true);
      this.pHitCd.set(e.id, PIRANHA_HIT_CD);                 // :14175-14178 localNPCHitCooldown=14
      if (this.pAi1 === 0) { this.pAi1 = 1; this.pTarget = e; }   // :13270-13274 首咬 latch
    }
  }
}

// ---------------------------------------------------------------------------
// 454 幻影能量球齐射指令（发射点侧遍历场上本波球——LunarOrb.parentId 圈定模式）
// ---------------------------------------------------------------------------
/** 把场上全部 ownerId 的 454（ai0≠−1）置齐射态并统一赋速（NPC.cs:37407-37427
 *  手攻击 2 num1232==292 / :38487-38505 真眼攻击 2 t==105）：原版逐弹覆写同一个
 *  vector175/vector224（手：normalize(玩家−(手心+(0,−350)))·12；真眼：瞄准向·12）
 *  ——全部球以【同一速度矢量】平行齐射，非逐球独立寻的。 */
export function volleyPhantomOrbs(game: GameHooks, ownerId: number, vx: number, vy: number): void {
  const list = (game as unknown as { entities?: { projectiles?: unknown[] } }).entities?.projectiles ?? [];
  for (const o of list) {
    const p = o as Arrow;
    if (p.dead || p.projId !== 454 || !p.phantomOrb) continue;
    if (p.orbOwnerId !== ownerId || p.orbAi0 === -1) continue;
    p.orbAi0 = -1;
    p.vx = vx;
    p.vy = vy;
  }
}

/** 给场上全部 ownerId 的 454（ai0≠−1）叠加速度（NPC.cs:38471-38483 真眼攻击 2
 *  t==75 升空：velocity += 眼速度 (0,−7)——列队球整体被带起）。 */
export function nudgePhantomOrbs(game: GameHooks, ownerId: number, dvx: number, dvy: number): void {
  const list = (game as unknown as { entities?: { projectiles?: unknown[] } }).entities?.projectiles ?? [];
  for (const o of list) {
    const p = o as Arrow;
    if (p.dead || p.projId !== 454 || !p.phantomOrb) continue;
    if (p.orbOwnerId !== ownerId || p.orbAi0 === -1) continue;
    p.vx += dvx;
    p.vy += dvy;
  }
}

// ---------------------------------------------------------------------------
// 1457 弧线引矢（鹰妖护符 6166 / 炽天使项链 6180 / 凤凰箭袋 6181）玩家侧扫描
// ---------------------------------------------------------------------------

/** 原版 Projectile.arrow = true 弹型全集（SetDefaults 23 处直写 :811/:821/:841/:853/
 *  :1241/:1747/:1908/:2062/:2097/:2583/:3104/:3642/:3692/:5440/:5478/:5608/:5685/
 *  :6783/:6877/:7525/:7997/:8847/:9574——1 木箭/2 燃烧箭/4 邪箭/5 小丑箭/41 狱炎箭/
 *  91 圣箭/225 叶绿箭/469 蜂箭/474 骨箭/485 狱翼箭/639 月总箭/710 空中祸害裂片/
 *  932 仙王射弹等）。弧线引矢扫描门 = `projectile.arrow && aiStyle == 1`
 *  （Player.cs:28682） */
export const VANILLA_ARROW_PROJS = new Set([
  1, 2, 4, 5, 41, 91, 103, 117, 120, 172, 225, 278, 282, 469, 474, 485, 495,
  631, 639, 710, 819, 932, 1006,
]);

/** HarpyCharmEffect 玩家参数面（结构化类型——Player 实体直传，避免实体环） */
export interface HarpyCharmPlayer {
  cx: number;
  cy: number;
  equipStats: { accHarpyCharm: boolean; accSeraphNecklace: boolean; hasPhoenixQuiver: boolean };
  /** Player.accHarpyCharmCooldown（:1219）——命中引矢时直写（:28702） */
  accHarpyCharmCooldown: number;
}

/** HarpyCharmEffect（Player.cs:28661-28704，由 Update_HarpyCharm :28648-28659 在
 *  冷却归零拍调用）：扫描在场玩家箭——距玩家 [400,1200)（:28667-28687 三非门：
 *  <400 太近不引 / ≥当前最近跳过 / >1200 太远不引）、arrow+aiStyle1+未引（:28682），
 *  取最近一支且其 FindTargetWithLineOfSight(1600) 有视线目标 → ApplyHarpyCharm。
 *  冷却 90t、6180 炽天使 ×0.8=72（:28670-28674）；标记件优先级
 *  hasPhoenixQuiver→6181 > accSeraphNecklace→6180 > 6166（:28700）。 */
export function harpyCharmEffect(game: GameHooks, player: HarpyCharmPlayer): void {
  if (!player.equipStats.accHarpyCharm || player.accHarpyCharmCooldown > 0) return;   // :28663-28666
  const NEAR = 400;      // num :28667
  const FAR = 1200;      // num2 :28668
  const LOS = 1600;      // num3 :28669
  let cd = 90;           // num4 :28670
  if (player.equipStats.accSeraphNecklace) cd = Math.trunc(cd * 0.8);   // :28671-28674 →72
  let best: Arrow | null = null;             // num6 :28676
  let bestD = Number.POSITIVE_INFINITY;      // num7 :28678 float.MaxValue
  let target: { cx: number; cy: number } | null = null;   // npcTargetIndex
  const list = (game as unknown as { entities?: { projectiles?: unknown[] } }).entities?.projectiles ?? [];
  for (const o of list) {
    const p = o as Arrow;
    // :28682 门：active/arrow/owner==whoAmI/aiStyle==1/未 HarpyCharmed——本仓
    // owner 等价 = 非敌方弹（!hostile；玩家弹恒 owner 本地）
    if (p.dead || p.hostile) continue;
    if (!VANILLA_ARROW_PROJS.has(p.projId)) continue;
    if ((projectileData(p.projId)?.aiStyle ?? -1) !== 1) continue;
    if (p.harpyCharmed) continue;
    const d = Math.hypot(p.cx - player.cx, p.cy - player.cy);   // num8 :28686
    // :28687 原式 `!(d<400) && !(d>=best) && !(d>1200)` = [400,1200] 内比最近
    if (!(d < NEAR) && !(d >= bestD) && !(d > FAR)) {
      const tgt = p.nearestEnemyWithLos(game, LOS);             // :28689
      if (tgt) {
        bestD = d;
        best = p;
        target = tgt;
      }
    }
  }
  if (best && target) {
    // :28700 标记件 id 三档 → :28701 ApplyHarpyCharm → :28702 冷却写入
    const itemVid = player.equipStats.hasPhoenixQuiver ? 6181
      : player.equipStats.accSeraphNecklace ? 6180 : 6166;
    best.applyHarpyCharm(target.cx, target.cy, itemVid, game);
    player.accHarpyCharmCooldown = cd;
    // ★O2 双音仲裁（2026-09-02 清账批）：原版节拍=【单点】——Player.HarpyCharmEffect
    //   （1457 Player.cs:28661-28702）全段零 PlaySound；声在 ApplyHarpyCharm→
    //   RequestParticleSpawn(clientOnly:false)（Projectile.cs:58802-58809）→
    //   Spawn_HarpyCharm（ParticleOrchestrator.cs:472-512，PlaySound 唯一一处 :512，
    //   Item39 默认 / flag=6181 凤凰箭袋→Item20，pitch 0/vol 1，位=弹体 Center）。
    //   本仓单点=applyHarpyCharm→harpyCharmFamilyFx（orchestraFx.ts:1983-1984，随
    //   粒子族同落）；此处原 R25-⑦「音效段先行」桩与 familyFx 对同一引矢各播一声
    //   （双音）——删除桩，保留 familyFx 单点（redblue-r25 判长=1 复验）。
  }
}
