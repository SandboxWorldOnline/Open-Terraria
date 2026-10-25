// 纸娃娃合成：把灰度通道帧表（Player_{v}_{n}.png + Player_Hair_N.png）调色合成为一张
// 40×(20×56) 的完整帧表，缓存复用。通道映射实测自 PlayerDrawLayers.cs：
//   0 头/3,5,7,9 身体/10 腿 = skinColor；4,8 = undershirt；6,13,14 = shirt；
//   11 = pants；12 = shoes；1 = 眼白(白)；2 = 瞳孔(eyeColor)；发型表 14 帧对齐身体帧 6-19。
import { bitmapize, freeBaked, type Baked } from '../render/bitmapize';
import { type Appearance, backHairDraw, MALE_VARIANTS } from './Appearance';
import { UITextures } from '../vui/assets/UITextures';
import { noteVuiConsumer } from '../assets/SpriteAtlas';
import { texReady } from '../render/texId';
import { dyeApplyOf, applyDyePass } from '../data/vanillaDyes';
import { lunarConstPieceOf } from '../data/vanillaLunarArmor';   // ★BJ665b 恒色甲位判定
import { globalTimeWrappedHourly } from '../core/GameTime';   // ★BJ631:染料烘焙 uTime 单源钟

export const BODY_FRAMES = 20;     // 身体帧数
export const FRAME_W = 40;
export const FRAME_H = 56;
export const HAIR_FRAMES = 14;     // 发型表帧数（对齐身体帧 6..19）

/** 通道索引 → 外观颜色字段（竖条 20 帧布局：头/眼/腿/裤/鞋） */
const VERTICAL_CHANNELS: Array<{ sheet: number; color: keyof Appearance | 'white' }> = [
  { sheet: 10, color: 'skinColor' },   // 腿皮肤
  { sheet: 11, color: 'pantsColor' },
  { sheet: 12, color: 'shoeColor' },
  { sheet: 0, color: 'skinColor' },    // 头
  { sheet: 1, color: 'white' },        // 眼白
  { sheet: 2, color: 'eyeColor' },     // 瞳
];

/**
 * 复合帧网格映射（1.4.5.6 PlayerDrawSet.CreateCompositeData：躯干/手臂/肩为 9列×4行 网格，
 * CreateCompositeFrameRect = x*40 + y*56；男用 0-1 行，女 +2 行）。
 * ★ 臂部像素偏移勘误(2026-08-10,用户报"部件不够贴合"):原版 GetCompositeOffset
 * (:4189-4197 的后臂 +6/+2、前臂 -5/0)是 DrawData 的 position 与 origin **共用**偏移——
 * 两者相消,所有复合部件左上角一律对齐躯干锚点(headgear 微偏除外),偏移量只作旋转轴心
 * (将来做 use 手臂旋转时 pivot = bodyVect(20,28)+偏移)。此前误当烘焙位移,导致后臂整体
 * 偏右下 (6,2)、前臂偏左 (5,0)——已归零对齐。
 * 前臂帧表 frameIndex2（按 bodyFrame 行 0..19）：
 *   0→(2,0) 1→(3,0) 2→(4,0) 3→(5,0) 4→(6,0) 5→(2,1) 6→(3,1)
 *   7-10→(4,1) 11-13→(3,1) 14→(5,1) 15,16→(6,1) 17→(5,1) 18,19→(3,1)
 * 后臂 = 前臂 Y+2；躯干 (0,0)（行5=跳跃 (1,0)）；后肩 (1,1)；前肩 (0,1)。
 * ★SW-BJ11 2026-09-07 补遗:复合组件(躯干/双臂/双肩)另随 bodyFrame 行吃
 * OffsetsPlayerHeadgear 行偏移(Main.cs:530,行7-9/14-16 → −2px,行走 bob)——
 * 头/眼/发/腿不吃此表,见 COMPOSITE_BOB_ROWS。
 */
/** ★BJ597 导出：复合半幅 glow 逐部件计划与烘焙共用同一帧表单源（防副本漂移） */
export const ARM_FRAME: ReadonlyArray<readonly [number, number]> = [
  [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [2, 1], [3, 1],
  [4, 1], [4, 1], [4, 1], [4, 1], [3, 1], [3, 1], [3, 1],
  [5, 1], [6, 1], [6, 1], [5, 1], [3, 1], [3, 1],
];

/** 复合衣着通道集中【身甲整替后不再绘制】的表(4=底衫/5=臂肤B/6=衬衫/7=臂肤A/
 *  8=底衫臂/13=衬衫臂;3=皮肤躯干仍画在甲下,10=皮肤腿属腿侧)——SW-BJ11 2026-09-07 */
const BODY_UNDER_ARMOR_PRUNE = new Set([4, 5, 6, 7, 8, 13]);

/** ShouldOverrideLegs_CheckPants(PlayerDrawLayers.cs:1219-1240):这些腿甲(袍/裙族,
 *  摆长及地)整替皮肤腿;白名单外的腿甲下皮肤腿照画(12_Skin_Composite :1289
 *  IsBottomOverridden 门)。shoe 配饰==15 的覆写面未入(需配饰槽入参,登记) */
const LEGS_HIDE_SKIN = new Set([55, 63, 67, 106, 138, 140, 143, 217, 222, 226, 228]);

/** hidesTopSkin(PlayerDrawSet.cs:1789):这些身甲不画甲下皮肤躯干(21/22=狼人/人鱼
 *  全形态强制,82/83/93=无上装族) */
const HIDES_TOP_SKIN_BODIES = new Set([82, 83, 93, 21, 22]);

/** OffsetsPlayerHeadgear.Y==0 的 bodyFrame 行(Main.cs:530 表:行 7-9/14-16 为 (0,0),
 *  其余 (0,2))。复合网格组件(躯干/双臂/双肩)在这些行走行整体上移 2px(表值−2):
 *  PlayerDrawLayers.cs:1293-1295(Skin_Composite)/:1311-1314(BackArmShirt)/
 *  :1996-1999(TorsoComposite)/:3700-3703(ArmOverItemComposite)同一 vector。
 *  头/眼/发/腿各层不消费此表(SW-BJ11 2026-09-07 补齐) */
export const COMPOSITE_BOB_ROWS = new Set([7, 8, 9, 14, 15, 16]);

/** GetHairSettings（1456 Player.cs:16645-16760，switch(head) 精确提取）：
 *  fullHair 头盔露出完整发型 / hatHair 露出特制帽子发型(Player_HairAlt) / 其余完全隐藏 */
const FULL_HAIR_HEADS = new Set([10, 12, 28, 42, 62, 97, 106, 113, 116, 119, 133, 138, 139, 163, 178, 181, 191, 198, 217, 218, 220, 222, 224, 225, 228, 229, 230, 232, 235, 238, 242, 243, 244, 245, 272, 273, 274, 277, 284, 290]);
const HAT_HAIR_HEADS = new Set([13, 14, 15, 16, 18, 21, 24, 25, 26, 29, 40, 44, 51, 56, 59, 60, 63, 64, 65, 67, 68, 69, 81, 92, 94, 95, 100, 114, 121, 126, 130, 136, 140, 143, 145, 158, 159, 161, 182, 184, 190, 195, 215, 216, 219, 223, 226, 227, 231, 233, 234, 262, 263, 264, 265, 267, 275, 279, 280, 281, 286, 289, 292]);

/** 发型层信息（发色剂渲染拆层用）：mode=隐藏时 null */
export interface DollHairLayer {
  mode: 'full' | 'alt';
  /** 贴图名（Player_Hair_N / Player_HairAlt_N） */
  src: string;
  /** 后发层（backHairDraw :16771）——true 时全帧高先画、前发层只画顶部 26px */
  back: boolean;
}

/** 头盔下的发型档（GetHairSettings；compositePaperDoll 与发色剂叠层共用同一判定） */
export function dollHairLayer(a: Appearance, headIdx: number): DollHairLayer | null {
  const mode = headIdx === 0 || FULL_HAIR_HEADS.has(headIdx) ? 'full' as const
    : HAT_HAIR_HEADS.has(headIdx) ? 'alt' as const : null;
  if (!mode) return null;
  return {
    mode,
    src: mode === 'alt' ? `Player_HairAlt_${a.hair + 1}.png` : `Player_Hair_${a.hair + 1}.png`,
    back: backHairDraw(a.hair),
  };
}

/** 发色剂逐帧着色头发帧（40×56，动态染料每帧变色——不进 tintCache 防爆缓存）。
 *  复用 tint() 的 multiply+destination-in 模式，输出为共享 scratch（当帧即用勿存） */
export function hairFrameTinted(layer: DollHairLayer, row: number, color: { r: number; g: number; b: number }): Baked | null {
  const rect = UITextures.get(layer.src);
  if (!rect) return null;
  const hr = Math.max(0, Math.min(HAIR_FRAMES - 1, row - 6));
  const img = rect.img as HTMLImageElement;
  const sc = hairScratch ??= document.createElement('canvas');
  if (sc.width !== FRAME_W || sc.height !== FRAME_H) { sc.width = FRAME_W; sc.height = FRAME_H; }
  const sctx = sc.getContext('2d', { willReadFrequently: true })!;  // 发色 scratch 纯 CPU 合成,不占 IOSurface
  sctx.imageSmoothingEnabled = false;
  sctx.clearRect(0, 0, FRAME_W, FRAME_H);
  sctx.drawImage(img, 0, hr * FRAME_H, FRAME_W, FRAME_H, 0, 0, FRAME_W, FRAME_H);
  sctx.globalCompositeOperation = 'multiply';
  sctx.fillStyle = `rgb(${color.r},${color.g},${color.b})`;
  sctx.fillRect(0, 0, FRAME_W, FRAME_H);
  sctx.globalCompositeOperation = 'destination-in';
  sctx.drawImage(img, 0, hr * FRAME_H, FRAME_W, FRAME_H, 0, 0, FRAME_W, FRAME_H);
  sctx.globalCompositeOperation = 'source-over';
  return sc;
}

/** 发色剂 scratch（每帧重画，contextlost 后内容自动补齐——勿缓存其结果） */
let hairScratch: HTMLCanvasElement | null = null;

/** 头甲贴图（Armor_Head_N.png；发色剂叠层时画在发层之后，与 composite 内层序一致） */
export function headArmorImage(headIdx: number): ImageBitmap | HTMLImageElement | null {
  if (!headIdx) return null;
  const r = UITextures.get(`Armor_Head_${headIdx}.png`);
  return r ? (r.img as HTMLImageElement) : null;
}

const cache = new Map<string, Baked>();   // 写一次合成 → 异步升格 ImageBitmap(bitmapize)
/** 调色缓存上限(2026-08-13 泄露 review):键=贴图×外观色(用户可控,键空间近无限),
 *  值=整图尺寸 canvas——无闸时长会话/选人界面拖色条无界增长(同文件 cache 有
 *  LRU 64 而此表漏配)。
 *  ★2026-08-25 二次修(用户实报"骰子随机几次后样式全空"):原"满 256 整表清空"
 *  = 数百 MB canvas 瞬间弃置 → 内存压力下浏览器丢弃存活 canvas 的后备存储 →
 *  后续 drawImage 画空气 → 烘焙空白被外观键缓存定格 = 样式全空不恢复。
 *  改【字节预算 + LRU】:超预算逐出最旧条目(纯弃引用),存活条目永不被殃及 */
const TINT_CACHE_MAX_ENTRIES = 256;
const TINT_CACHE_MAX_BYTES = 48 * 1024 * 1024;
const tintCache = new Map<string, Baked>();
let tintCacheBytes = 0;
/** WeakMap(2026-08-13):外层原为强引用 Map——会把已被 cache LRU 淘汰的合成
 *  canvas 钉住永不释放;改弱引用后源 canvas 回收时条目随之消失 */
const stealthTintCache = new WeakMap<Baked, Map<string, Baked>>();

/** 清空全部合成/调色缓存。
 *  缓存 canvas 在 GPU contextlost 后内容归零且不会自动重画——不失效就
 *  "角色/装备/时装全部隐形"(选人界面与游戏内 alike)。退出世界与进世界时调用。 */
export function clearPaperDollCache(): void {
  for (const c of cache.values()) freeBaked(c);
  for (const c of tintCache.values()) freeBaked(c);
  cache.clear();
  tintCache.clear();
  tintCacheBytes = 0;
}

function colorKey(color: { r: number; g: number; b: number }): string {
  return `${color.r},${color.g},${color.b}`;
}

/** 灰度图调色：multiply 铺色 + destination-in 用原 alpha 裁回 */
/** 贴图实例稳定 id(ImageBitmap 化后无 .src 可拼键——用 WeakMap 自增 id 防跨表碰撞) */
const tintImgId = new WeakMap<object, number>();
let tintImgSeq = 0;
function tint(img: CanvasImageSource & { width: number; height: number }, color: { r: number; g: number; b: number }): Baked {
  let id = tintImgId.get(img as object);
  if (id === undefined) { id = ++tintImgSeq; tintImgId.set(img as object, id); }
  const key = `t${id}|` + colorKey(color);
  let c: Baked | undefined = tintCache.get(key);
  if (c) return c;
  if (tintCache.size >= TINT_CACHE_MAX_ENTRIES) {  // 满即逐出最旧(防无界)
    for (const old of tintCache.values()) freeBaked(old);
    tintCache.clear();
    tintCacheBytes = 0;
  }
  const bytes = img.width * img.height * 4;
  while (tintCacheBytes + bytes > TINT_CACHE_MAX_BYTES && tintCache.size) {
    const oldest = tintCache.keys().next().value as string;
    const oldEntry = tintCache.get(oldest);
    tintCacheBytes -= (oldEntry?.width ?? 0) * (oldEntry?.height ?? 0) * 4;
    freeBaked(oldEntry);
    tintCache.delete(oldest);
  }
  const cv = document.createElement('canvas');
  c = cv;
  cv.width = img.width; cv.height = img.height;
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = `rgb(${color.r},${color.g},${color.b})`;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(img, 0, 0);
  tintCacheBytes += bytes;
  tintCache.set(key, c);
  bitmapize(tintCache, key);
  return c;
}

function appearanceKey(a: Appearance): string {
  return [
    a.skinVariant, a.hair,
    colorKey(a.skinColor), colorKey(a.undershirtColor), colorKey(a.pantsColor),
    colorKey(a.shoeColor), colorKey(a.shirtColor), colorKey(a.eyeColor), colorKey(a.hairColor),
  ].join('|');
}

/** PlayerDataInitializer.Load 的 CopyVariant 变体→源表链（反编译逐值,1457 同名文件）:
 *  1/2/3/8←0;4←0 后覆盖 {3,4,5,6,7,8,9,10,11,12,13};5←4、6←4、7←4、9←4;
 *  10←0 后覆盖 {0,2,3,5,7,9,10}+眼白别名;11←10。⇒ 女性子变体（5/6/7/9）的
 *  设计缺省身体通道（3=躯干肤/5=臂肤B/7=臂肤A/9=臂手/10=腿肤）取【变体 4 女表】,
 *  只有变体 4 也没有的通道（0 头/1 眼白/2 瞳/15 眼睑）才落到变体 0。
 *  ★SW-BJ21 2026-09-07:旧 `v ?? 0` 直落男表——男表 (0,2) 复合格无女躯干
 *  （Player_0_3.png 逐像素实测 row2 全空;女躯干/女底衫仅 Player_4_3/4_4 有 (0,2)/(1,2) 格）
 *  ⇒ 女性子变体（含用户实报 v6 紫发角色）胸口/衣摆中缝镂空透背景。
 *  对照:变体 4 自带全套女表,BJ11 就绪门修后 diff=0（探针 _swbj21-truth-diff 实测） */
export const VARIANT_SHEET_SOURCE: Readonly<Record<number, number>> = {
  1: 0, 2: 0, 3: 0, 4: 0, 5: 4, 6: 4, 7: 4, 8: 0, 9: 4, 10: 0, 11: 10,
};

/** 变体链源表（Game.ts 预载清单与 PaperDoll 取表/就绪门同源消费） */
export function variantSheetSource(variant: number): number {
  return VARIANT_SHEET_SOURCE[variant] ?? 0;
}

/** DisplayDoll 别名面（LoadDisplayDollMale/Female 尾段重排,★SW-RB6c 2026-09-07）：
 *  `val = TextureAssets.Players[10,2]`（Player_10_2.png,逐像素实测 40×1120 全透明）
 *  把变体 10 的 {1 眼白,4 底衫,6 衫,8 臂底衫,11 裤,12 鞋,13 臂衫,15 眼睑} 与变体 11
 *  的 {1,2,4,6,8,11,12,13,15} 全部指向该【空表】（原版=这些通道画空气,假人观感全靠
 *  10_0 头 + 10_3/5/7/9/10 肤组）。旧链对 10/11 直落 0_* 男表 = 男式底衫/裤/鞋/
 *  眼白上身（vanilla 为空）。可达面：.plr 导入（原版 LoadPlayer_LastMinuteFixes
 *  Player.cs:56486 钳 0..11 放行 10/11）;创建期不可达（Click_RandomizePlayer
 *  :1571 只掷 _validClothStyles 0-9,SW-RB6c 已对齐 randomAppearance）。 */
const DISPLAY_DOLL_ALIAS: Readonly<Record<number, readonly number[]>> = {
  10: [1, 4, 6, 8, 11, 12, 13, 15],
  11: [1, 2, 4, 6, 8, 11, 12, 13, 15],
};

/** 变体通道源表解析（CopyVariant 语义,SW-BJ21 2026-09-07）:
 *  own → 别名面（10/11）→ 链源（4/10）→ 0,取第一个 exists 者。烘焙取表（sheetRect）
 *  与就绪门必须【同一个解析】——门等的就是实际会画的那张（BJ11「门=实际绘制面」
 *  语义的链化） */
export function variantSheetName(variant: number, sheet: number, exists: (name: string) => boolean): string {
  const own = `Player_${variant}_${sheet}.png`;
  if (exists(own)) return own;
  // ★SW-RB6c 2026-09-07：DisplayDoll 别名面先于 CopyVariant 链——原版重排块在
  //  CopyVariant 之后=最终表值（11 的 {2} 别名与链中段 10→10_2 同值,列此保序）
  if (DISPLAY_DOLL_ALIAS[variant]?.includes(sheet)) {
    const alias = 'Player_10_2.png';
    if (exists(alias)) return alias;
  }
  const mid = variantSheetSource(variant);
  if (mid !== 0 && mid !== variant) {
    const midName = `Player_${mid}_${sheet}.png`;
    if (exists(midName)) return midName;
  }
  return `Player_0_${sheet}.png`;
}

function sheetRect(variant: number, sheet: number): ImageBitmap | HTMLImageElement | null {
  // 女性变体缺的通道按 CopyVariant 链回退（5/6/7/9←4←0;见 VARIANT_SHEET_SOURCE 注）
  // 消费点埋点:回退 miss 时 vui 失配报告能给出"谁在查"
  noteVuiConsumer(`PaperDoll.sheetRect(v${variant},s${sheet})`);
  const r = UITextures.get(variantSheetName(variant, sheet, (n) => UITextures.has(n)));
  return r ? (r.img as HTMLImageElement) : null;
}

/** 合成完整帧表（含发型+装备）。equip 为原版物品 id（Armor_Head_/Armor_Legs_/Armor_Armor_ 贴图索引）。
 *  opts.skipHair = 发色剂激活时拆层：头发与头甲都不进烘焙（调用方 hairFrameTinted/
 *  headArmorImage 按 后发→本体→前发→头甲 层序叠画——动态染料逐帧变色，烘焙缓存无法承载）
 *  opts.layer = stealth 视觉分层（PlayerDrawSet.cs:1523-1660）：'skin' = 皮肤/发/衣着
 *   （×s'² 消费）；'armor' = 三件甲贴图（×s' 消费，3106/蘑菇矿 B 分量 ×settled；
 *   'armorNoHead' 发色剂激活时头甲归叠层路径）。原版腿甲/身甲整体替代对应皮肤衣着
 *   （DrawPlayer_02/13 else-if 链）→ skin 层在有甲的槽位同样留空（甲覆盖语义一致） */
export type DollLayer = 'skin' | 'armor' | 'armorNoHead';
/** 三件拆分（死亡散飞用）：'head'=头皮肤/眼/发/头甲；'body'=躯干手臂复合网格+身甲；
 *  'legs'=腿皮肤/裤/鞋+腿甲——对应原版 headPosition/bodyPosition/legPosition 三层组
 *  （PlayerDrawLayers 逐层 + drawPlayer.headPosition/bodyPosition/legPosition 偏移） */
export type DollPart = 'head' | 'body' | 'legs';
/** body/legs 双行（原版身体帧 bodyFrame 与腿帧 legFrame 是两条独立状态机：
 *  Player.cs 腿链 :35718-35855、身体链 :35874-36186——use 行/静持行只钉身体，
 *  腿照常走 legFrame 循环；行走时身体同步腿（:36184-36186 bodyFrame.Y=legFrame.Y））。
 *  rows 模式烘焙出 40×56 单帧（身体件取 body 行、腿件取 legs 行） */
export interface DollRows { body: number; legs: number }
/** 抚摸复合后臂（ItemCheck_ApplyHoldStyle :49499-49508 petting 分支）：
 *  stretch = UpdateCompositeArm（PlayerDrawSet.cs:2210-2237）拉伸档帧行——
 *  0=Full / 1=ThreeQuarters（petting 仅这两档，miscCounter%14/7 两相切换，
 *  源格 = 复合网格列 8 后臂拉伸档，替代动画行后臂格）；
 *  rot = SetCompositeArmBack 传入角 −2π·(小宠 0.2 / 大宠 0.3)（右向局部空间值
 *  恒定——朝向镜像/重力翻转由消费方外层变换承担：原版 gravDir 取反 + XNA 翻转
 *  与本仓 scale(facing,1)/scale(1,-1) 镜像合成等价，见渲染侧注释） */
export interface DollPetArm { stretch: 0 | 1; rot: number }

/** 抚摸后臂档位/角度解算（ItemCheck_ApplyHoldStyle :49499-49508）：
 *  phase = pettingArmPhase（miscCounter%14/7 两相）→ 拉伸档行（UpdateCompositeArm
 *  :49499 num3==1 才 Full → 行 0；反相映射），rot = −2π·(isPetSmall?0.2:0.3)。
 *  纯函数供渲染与单测共用。 */
export function petArmParams(phase: 0 | 1, isPetSmall: boolean): DollPetArm {
  return { stretch: (1 - phase) as 0 | 1, rot: -Math.PI * 2 * (isPetSmall ? 0.2 : 0.3) };
}

/** 坐姿腿切片参数（DrawSittingLegs PlayerDrawLayers.cs:1585-1735 照抄） */
export interface DollSitting {
  /** 腿甲槽位 id（特殊切片表按 legIndex 分档；0/-1=默认切片） */
  legIndex: number;
  /** seatYOffset = -4 + (int)offsetForSeat.Y（PlayerSittingHelper.cs:29-31）——
   *  149/169/238/223 族切片表内用 vector.Y -= seatYOffset 对冲，需逐座位传值 */
  seatYOffset: number;
  /** 身甲槽位 id（193/194 族只在 body==218 时改切片） */
  body: number;
}
/** ArmorIDs.Head.Sets.HidesHead（ArmorIDs.cs:18）：头甲自带全脸时跳过 base 头/眼/眼睑
 *  （DrawPlayer_21_Head_TheFace :2577 flag 门——狼人头 38 全脸、幽灵脸 135 等） */
export const HIDES_HEAD = new Set([38, 135, 269, 282, 288]);

/** DrawSittingLegs 切片计划（局部坐标 = 帧锚点左上、朝右空间；外层 translate 已含
 *  seatYOffset 的整体座位偏移，故 evY 中 -sY 的对冲项即恢复原版净偏移）。
 *  n 从 num3 降到 0：源条 = 帧 srcRow 起 y+2n+num2、高 (n==num3 ? 56-num2-2n : 2)；
 *  目标 = (xShift+num+num4·n+num6+(n?num7:0)+num8, evY+2+num2+num5+num9)。
 *  ★BJ597 导出：坐姿腿甲 glow 叠画（PlayerDrawLayers.cs:1478-1495 DrawSittingLegs
 *  同表切片）与烘焙共用本单源——另立副本必漂移 */
export function sittingSlicePlan(legIndex: number, skin: boolean, bodyIdx: number, sY: number, srcRow: number):
  Array<{ sx: number; sy: number; sw: number; sh: number; dx: number; dy: number }> {
  // 默认档（PlayerDrawLayers.cs:1594-1602）：num=2/num2=42/num3=2/num4=2/num5=2
  let num = 2, num2 = 42, num3 = 2, num4 = 2, num5 = 2;
  let num6 = 0, num7 = 0, num8 = 0, num9 = 0;
  let evY = 0, xShift = 0, row = srcRow, full = false;
  if (legIndex === 169 || !skin) {
    switch (legIndex) {
      case 217: num = 0; num4 = 0; num5 = 0; num3 = 1; num2 = 0; full = true; break;
      case 149: case 171: case 172:
        num = -6; num4 = 2; num5 = 2; num3 = 4; num2 = 6; evY = 6 - sY; break;
      case 169:
        if (skin) { num = -6; num4 = 2; num5 = 2; num3 = 4; num2 = 6; evY = 6 - sY; }
        else { num = 0; num4 = 0; num5 = 0; num3 = 1; num2 = 0; evY = -sY; }  // flag(长袍) 族忽略
        break;
      case 238: case 239: num = 2; num4 = 2; num5 = -2; num2 = 42; evY = -sY; break;
      case 214: case 215: case 216:
        num = -6; num4 = 2; num5 = 2; num3 = 4; num2 = 6; evY = 6; break;
      case 106: case 143: case 226:
        num = 0; num4 = 0; num2 = 6; num5 = 0; evY = 4; row = 5; break;
      case 222: xShift = -2; break;
      case 223: xShift = -2; evY = -sY; break;
      case 132: num = -2; num7 = 2; break;
      case 193: case 194: if (bodyIdx === 218) { num = -2; num7 = 2; evY = 2; } break;
      case 177: case 178: case 181: case 182: case 206:
        num = 0; num4 = 0; num5 = 0; num3 = 1; num2 = 0; num8 = 4; num9 = 6; break;
    }
  }
  const out: Array<{ sx: number; sy: number; sw: number; sh: number; dx: number; dy: number }> = [];
  // dest Y（sY 对冲后局部值）：vector.Y(−2+sY+evY) + 2(Vector2(num,2)) + num2 + num5 + num9
  // —— −2/+2 相消 → evY + num2 + num5 + num9（默认 44；177 族可达 8+56=64 超帧底）
  const dy = evY + num2 + num5 + num9;
  for (let n = num3; n >= 0; n--) {
    let sy: number, sh: number;
    if (full) { sy = row * FRAME_H; sh = FRAME_H; }
    else {
      sy = row * FRAME_H + n * 2 + num2;
      sh = n === num3 ? FRAME_H - num2 - n * 2 : 2;
    }
    if (sh <= 0) continue;
    out.push({
      sx: 0, sy, sw: FRAME_W, sh,
      dx: xShift + num + num4 * n + num6 + (n !== 0 ? num7 : 0) + num8,
      dy,
    });
  }
  return out;
}


/** ★五百七十:armor dye bake(composite 层;vanilla ApplyItemDye 面——
 *  染后 sprite 一次性生成在 composite 缓存 miss 时=非逐帧)。
 *  ★BJ631 件1:uTime=GTW 现值(uTime 缺省 0=动画族恒冻 t0 帧;烘焙时刻现值更贴原版
 *  逐帧活性——合成缓存冻结窗仍登记偏差,与 body/legs 既有冻结面同账);
 *  img 空守卫(BJ631 喂值链上线后 dye 只随甲槽喂出,此处兜底防御非空约定破面) */
function dyeBakeArmorSprite(img: any, dyeVid: number): HTMLCanvasElement {
  if (!img) return img;
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const c2 = cv.getContext('2d', { willReadFrequently: true })!;
  c2.drawImage(img, 0, 0);
  const emu = dyeApplyOf(dyeVid);
  if (emu) {
    emu.uniforms.uTime = globalTimeWrappedHourly();   // Main.GlobalTimeWrappedHourly 同源(★BJ330 单源)
    const id = c2.getImageData(0, 0, cv.width, cv.height);
    applyDyePass(id.data, cv.width, cv.height, emu);
    c2.putImageData(id, 0, 0);
  }
  return cv;
}

export function compositePaperDoll(
  a: Appearance,
  equip?: { head?: number | null; body?: number | null; legs?: number | null;
    /** ★五百六十九:armor dye slots(0=head/1=body/2=legs;vanilla ApplyItemDye;
     *  dyeVid=染料 vid 或 null=无染料——composite 缓存键含 dye=染色合成本体) */
    dyeHead?: number | null; dyeBody?: number | null; dyeLegs?: number | null },
  opts?: { skipHair?: boolean; skipFace?: boolean; layer?: DollLayer; part?: DollPart; rows?: DollRows; sitting?: DollSitting; petArm?: DollPetArm;
    /** ★C13-F2 socialGhost（PlayerDrawSet.cs:1489-1516）：皮肤族全 Transparent——
     *  甲合成层内两处皮肤垫（甲下皮肤躯干 3 / 甲下皮肤腿 10）同整隐 */
    ghostSkin?: boolean;
    /** ★BJ665b 四月套恒色甲件拆分（PlayerDrawSet.cs SetPassColors 恒色覆写面，
     *  见 ../data/vanillaLunarArmor.ts 头注）：true = 日耀/星尘恒色甲位（head 171/
     *  189、body 177/190、legs 112/130）从常规烘焙面【烘除】（skin-under 皮肤垫
     *  照画=原版 12_Skin 语义），由 lunarPart 面单独出件。lit 实体窗烘除→合成后
     *  逃逸重绘（armorGlowQueue 五族同判例域） */
    lunarSplit?: boolean;
    /** ★BJ665b 恒色件烘焙面：'upper'=恒色头甲+身甲复合件（都 250）、
     *  'legs'=恒色腿甲（日耀 250/星尘 252——值在消费侧与乘区链合成）。该模式下
     *  只烘恒色甲件本体（含染料），毛发/皮肤/竖条通道全跳 */
    lunarPart?: 'upper' | 'legs' },
): Baked | null {
  const key = appearanceKey(a) + (equip ? `|e${equip.head ?? 0},${equip.body ?? 0},${equip.legs ?? 0}` : '')
    + (equip?.dyeHead ? `|dh${equip.dyeHead}` : '') + (equip?.dyeBody ? `|db${equip.dyeBody}` : '') + (equip?.dyeLegs ? `|dl${equip.dyeLegs}` : '')
    + (opts?.skipHair ? '|nohair' : '') + (opts?.skipFace ? '|noface' : '') + (opts?.layer ? `|L${opts.layer}` : '')
    + (opts?.ghostSkin ? '|gh' : '')
    + (opts?.lunarSplit ? '|ls' : '') + (opts?.lunarPart ? `|lp${opts.lunarPart}` : '')
    + (opts?.part ? `|P${opts.part}` : '')
    + (opts?.rows ? `|R${opts.rows.body},${opts.rows.legs}` : '')
    + (opts?.sitting ? `|S${opts.sitting.legIndex},${opts.sitting.seatYOffset},${opts.sitting.body}` : '')
    + (opts?.petArm ? `|pA${opts.petArm.stretch},${opts.petArm.rot.toFixed(4)}` : '');
  const hit = cache.get(key);
  if (hit) return hit;

  // 发型模式（GetHairSettings）：无头盔=完整；fullHair 头盔=完整；hatHair=帽子发型；其余=隐藏
  const headIdx = equip?.head ?? 0;
  const hairLayer = opts?.skipHair ? null : dollHairLayer(a, headIdx);
  const hairMode: 'full' | 'alt' | 'none' = !hairLayer ? 'none' : hairLayer.mode;
  const hairSrc = hairLayer ? hairLayer.src : '';

  // ---- 懒加载就绪预检(vanilla-ui 按需加载后必需):任一必需贴图未就绪 → 返回 null
  // 且【不缓存】(查询本身触发后台加载,消费方下帧重试)。否则首帧的空纸娃娃会被
  // 永久缓存——角色选择界面人物贴图就再也出不来了
  // part 拆分时只预检该件所需通道（死亡散飞只走 head/body/legs 各自的层组）
  const part = opts?.part;
  const needSheets = part === 'head' ? new Set<number>([0, 1, 2])
    : part === 'body' ? new Set<number>([3, 4, 5, 6, 7, 8, 13])
    : part === 'legs' ? new Set<number>([10, 11, 12])
    : new Set<number>([...VERTICAL_CHANNELS.map((ch) => ch.sheet), 3, 4, 5, 6, 7, 8, 13]);
  // ★texReady 就绪守卫(2026-08-25 用户实报"骰子随机几次后样式全空"):atlas 半加载/
  //   解码驱逐窗口内 drawImage 画不出内容,而 tint() 的 multiply+destination-in 会把
  //   不透明调色色块铺满画布 → 空白/色块 doll 被 appearanceKey 缓存+bitmapize 定格
  //   =永久空槽(texId.ts texReady 注释同款坑)。改用 texReady 实测可绘,不就绪返回
  //   null 不缓存 → CharCreation retry 链在贴图就绪帧重烘,自愈
  const ready = (name: string): boolean => {
    const r = UITextures.get(name);
    return !!r && texReady(r.img as ImageBitmap | HTMLImageElement);
  };
  // 甲替代面(就绪门按【实际绘制面】收窄,与下方绘制分支同口径——SW-BJ11 2026-09-07):
  // 腿甲在位 → 裤/鞋(11/12)整替不画;皮肤腿(10)仍画在腿甲下(IsBottomOverridden 白名单
  //   外,12_Skin_Composite :1289;坐姿 hidesBottomSkin=1 → 不画,PlayerDrawSet.cs:1244);
  // 身甲在位 → 复合衣着(4-8/13)整替不画;皮肤躯干(3)仍画在身甲下(!hidesTopSkin,
  //   DrawPlayer_12_Skin_Composite :1279-1286 与甲无关地先画)
  const useLegsArmor = !!equip?.legs && (!part || part === 'legs');
  const useBodyArmor = !!equip?.body && (!part || part === 'body');
  const sitGate = !!opts?.sitting;
  for (const s of needSheets) {
    if (useLegsArmor && (s === 11 || s === 12)) continue;
    if (useLegsArmor && s === 10 && sitGate) continue;
    if (useBodyArmor && BODY_UNDER_ARMOR_PRUNE.has(s)) continue;
    // ★SW-BJ11 2026-09-07 变体通道就绪门 1:1 化(冷烘焙毒化根治):清单含变体表
    //   (uiFileExists=构建期磁盘真相)→ 必须等变体表本身就绪;仅原版设计缺省通道
    //   (4_0/1/2、1_3/5/7 等)才回退 Player_0_*。原 `!ready(v)&&!ready(0)` OR 门在
    //   变体表在途、男表已载时放行 → sheetRect 逐表回退=混烘(女角色身体取男表:
    //   男表 (0,2) 格为空 → 胸口/衣摆中缝缺失露背景、腿取男式加宽),且
    //   appearanceKey 不含实际用表 → 混合烘焙被缓存定格 = 「头部与身体分离/悬空、
    //   穿装备后更明显」用户实报(SW-BJ11)。探针实证 scripts/_swbj11-race.mjs:
    //   冷烘 80px 差 / 强制预载+清缓存后 0 差(算法本体逐像素 1:1)。
    //   ★SW-BJ21 2026-09-07 门改走 CopyVariant 链解析(variantSheetName,与 sheetRect
    //   同一函数):首个【清单存在】的源表必须就绪——女性子变体(5/6/7/9)设计缺省的
    //   身体通道(3/5/7/9/10)清单无 v 表、也无旧门认得的「6_3 缺→等 0_3」语义,
    //   旧门放行 0_3=男表 (0,2) 空格 = 镂空复发面;链化后等 Player_4_3 女表。
    if (!ready(variantSheetName(a.skinVariant, s, (n) => UITextures.has(n)))) return null;
  }
  if (hairMode !== 'none' && (!part || part === 'head') && !ready(hairSrc)) return null;
  if (equip?.legs && (!part || part === 'legs') && !ready(`Armor_Legs_${equip.legs}.png`)) return null;
  if (equip?.body && (!part || part === 'body') && !ready(`Armor_Armor_${equip.body}.png`)) return null;
  if (equip?.head && (!part || part === 'head') && !ready(`Armor_Head_${equip.head}.png`)) return null;

  // rows 模式：单帧 40×56（body 件取 rows.body、legs 件取 rows.legs）
  const rowsMode = opts?.rows ?? null;
  const sit = opts?.sitting ?? null;
  const nFrames = rowsMode ? 1 : BODY_FRAMES;
  const c = document.createElement('canvas');
  c.width = FRAME_W;
  // 坐姿切片族（177/106 等）dest 可伸到 y=64（超帧底 8px——原版 DrawData 无裁剪、
  // 站姿帧底本有 ~2px 透明边距，脚底锚由消费方 spriteBottomPad 自适应）——扩高防截
  c.height = nFrames * FRAME_H + (sit ? 8 : 0);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  const hasBackHair = hairMode !== 'none' && backHairDraw(a.hair);
  const hairRect = hairMode !== 'none' ? UITextures.get(hairSrc) : null;
  const hairTinted = hairRect ? tint(hairRect.img as HTMLImageElement, a.hairColor) : null;
  const onlyArmor = opts?.layer === 'armor' || opts?.layer === 'armorNoHead';
  const noArmor = opts?.layer === 'skin';
  // ★BJ665b 恒色甲位判定（原版 PlayerDrawSet.cs SetPassColors 恒色覆写面——日耀
  //  171/177/112=250³、星尘 189/190=250³/130=252³；漩涡/星云无覆写不入）。拆分时
  //  常规面烘除恒色件（皮肤垫照画）、lunarPart 面只烘恒色件。
  const lunarSplitOn = opts?.lunarSplit === true;
  const lunarPartOn = opts?.lunarPart != null;
  const lunarHeadC = lunarSplitOn ? lunarConstPieceOf(equip?.head ?? 0) : null;
  const lunarBodyC = lunarSplitOn ? lunarConstPieceOf(equip?.body ?? 0) : null;
  const lunarLegsC = lunarSplitOn ? lunarConstPieceOf(equip?.legs ?? 0) : null;
  // part 拆分门：head=发/头皮肤/眼白/瞳+头甲；body=复合网格+身甲；legs=腿皮肤/裤/鞋+腿甲
  const wantHead = !part || part === 'head';
  const wantBody = !part || part === 'body';
  const wantLegs = !part || part === 'legs';
  // HIDES_HEAD 头甲（ArmorIDs.Head.Sets.HidesHead）：狼人头 38 等全脸头甲跳过 base
  // 头皮肤/眼白/瞳（DrawPlayer_21_TheFace :2577-2580 flag 门；眼睑由渲染侧同门跳过）
  // skipFace = faceHead 路由在身（DrawPlayer_21_Head_TheFace :2592 分支二整支替代
  // 皮肤脸+眼白+瞳——渲染侧 faceLayerSplitPlan.skipFace 供给,2026-09-03 四层路由批）
  const hidesFace = HIDES_HEAD.has(equip?.head ?? 0) || opts?.skipFace === true;
  // 后发层（1.4.4+ PlayerDrawLayers:206-212：backHairDraw 时画在身体之后，即先画）
  if (!onlyArmor && wantHead && hairTinted && hasBackHair) {
    for (let i = 0; i < nFrames; i++) {
      const row = rowsMode ? rowsMode.body : i;
      const hr = Math.max(0, Math.min(HAIR_FRAMES - 1, row - 6));
      ctx.drawImage(hairTinted, 0, hr * FRAME_H, FRAME_W, FRAME_H, 0, i * FRAME_H, FRAME_W, FRAME_H);
    }
  }

  // ---- 竖条通道（腿/裤/鞋/头/眼：20 帧直排） ----
  const legsArmor = equip?.legs ? UITextures.get(`Armor_Legs_${equip.legs}.png`) : null;
  const bodyArmorImg: HTMLImageElement | ImageBitmap | null = equip?.body ? (UITextures.get(`Armor_Armor_${equip.body}.png`))?.img as HTMLImageElement | ImageBitmap ?? null : null;
  const dyedBodyImg = equip?.dyeBody ? dyeBakeArmorSprite(bodyArmorImg, equip.dyeBody) : bodyArmorImg;

  for (const ch of onlyArmor ? [] : VERTICAL_CHANNELS) {
    // part 拆分：竖条通道仅 10/11/12（腿组）与 0/1/2（头组）——body 件无竖条
    if (part && part !== (ch.sheet >= 10 && ch.sheet <= 12 ? 'legs' : 'head')) continue;
    if (legsArmor && (ch.sheet === 10 || ch.sheet === 11 || ch.sheet === 12)) continue; // 腿甲整体替代腿皮肤/裤/鞋（DrawPlayer_02 else-if）
    if (hidesFace && ch.sheet <= 2) continue;   // HidesHead：跳过头/眼白/瞳
    const img = sheetRect(a.skinVariant, ch.sheet);
    if (!img) continue;
    const color = ch.color === 'white' ? { r: 255, g: 255, b: 255 } : (a[ch.color] as { r: number; g: number; b: number });
    const tinted = tint(img, color);
    const isLegCh = ch.sheet >= 10 && ch.sheet <= 12;
    for (let i = 0; i < nFrames; i++) {
      const row = rowsMode ? (isLegCh ? rowsMode.legs : rowsMode.body) : i;
      if (sit && isLegCh) {
        // 坐姿腿切片（DrawPlayer_12_Skin_Composite :1289 / 13_Leggings :1497：皮肤族
        // legIndex==169 才走特殊表，其余默认切片）
        for (const s of sittingSlicePlan(equip?.legs ?? 0, true, equip?.body ?? 0, sit.seatYOffset, row)) {
          ctx.drawImage(tinted, s.sx, s.sy, s.sw, s.sh, s.dx, i * FRAME_H + s.dy, s.sw, s.sh);
        }
        continue;
      }
      ctx.drawImage(tinted, 0, row * FRAME_H, FRAME_W, FRAME_H, 0, i * FRAME_H, FRAME_W, FRAME_H);
    }
  }
  // 腿甲（竖条 20 帧，Armor_Legs_{id} 替代 pants+shoes；坐姿走切片表全档 :1473）。
  // ★SW-BJ11 2026-09-07 甲下皮肤腿:12_Skin_Composite :1289 皮肤腿(10)只被
  //  IsBottomOverridden(袍/裙族 LEGS_HIDE_SKIN ∪ shoe15[未入参,登记])压制,常规
  //  腿甲下先画皮肤腿再叠甲(满罩甲不可见,镂空甲族露肤=原版本相);坐姿
  //  hidesBottomSkin=1(PlayerDrawSet.cs:1244)不画,切片仅甲
  if (legsArmor && !noArmor && wantLegs
    // ★BJ665b：拆分时常规面烘除恒色腿甲（皮肤垫照画）;lunarPart='legs' 面只烘恒色腿甲
    && (lunarPartOn ? lunarLegsC != null : lunarLegsC == null)) {
    // ★C13-F2：ghostSkin → 甲下皮肤腿垫整隐（colorLegs Transparent 面,原版 :1498）
    //  ★BJ665b：lunarPart 面=恒色件本体（皮肤垫不入,门在取图处）
    const showSkinUnderLegs = !sit && !LEGS_HIDE_SKIN.has(equip?.legs ?? 0) && !opts?.ghostSkin;
    const skinLegsImg = showSkinUnderLegs && !lunarPartOn ? sheetRect(a.skinVariant, 10) : null;
    const skinLegsTinted = skinLegsImg ? tint(skinLegsImg, a.skinColor) : null;
    // ★BJ631 件1:染腿烘提出帧/切片循环（BJ625 喂值恒缺时不可达=冷码;喂值链上线后
    //  逐切片逐帧重烘=病理性,一次烘出 20 帧整表后循环直用——body 侧 dyedBodyImg 同式）
    const legsArmorImg = equip?.dyeLegs ? dyeBakeArmorSprite(legsArmor.img, equip.dyeLegs) : legsArmor.img;
    for (let i = 0; i < nFrames; i++) {
      const row = rowsMode ? rowsMode.legs : i;
      if (sit) {
        for (const s of sittingSlicePlan(equip?.legs ?? 0, false, equip?.body ?? 0, sit.seatYOffset, row)) {
          ctx.drawImage(legsArmorImg, s.sx, s.sy, s.sw, s.sh, s.dx, i * FRAME_H + s.dy, s.sw, s.sh);
        }
        continue;
      }
      if (skinLegsTinted) ctx.drawImage(skinLegsTinted, 0, row * FRAME_H, FRAME_W, FRAME_H, 0, i * FRAME_H, FRAME_W, FRAME_H);
      ctx.drawImage(legsArmorImg, 0, row * FRAME_H, FRAME_W, FRAME_H, 0, i * FRAME_H, FRAME_W, FRAME_H);
    }
  }

  // ---- 复合网格通道（躯干/手臂/肩：9×4 网格，按 CreateCompositeData 逐行映射） ----
  const female = !MALE_VARIANTS.includes(a.skinVariant);
  const dy = female ? 2 : 0;
  const under = a.undershirtColor, shirt = a.shirtColor;
  // 抚摸复合后臂（petting）：后臂换列 8 拉伸档格（Full=行0/ThreeQuarters=行1，
  // UpdateCompositeArm 帧覆写 PlayerDrawSet.cs:2210-2237）绕肩轴旋转——替代
  // 动画行后臂格（compBackArmFrame 同格语义，DrawPlayer_12_SkinComposite_
  // BackArmShirt :1317-1426 全层共用）。旋转轴 = bodyVect(20,28)+
  // GetCompositeOffset_BackArm(6,2) = (26,30)（:4189-4192；position/origin 共
  // 偏移相消 → 部件左上对齐帧锚，偏移仅是 pivot——见文件头勘误注）。
  const pet = opts?.petArm ?? null;
  const PET_ARM_PIVOT: readonly [number, number] = [26, 30];
  // 身甲（Armor/Armor_{id} 复合网格，与玩家复合通道同构；有身甲时替代全部衣着层）
  const gridRect = (sheet: number, x: number, y: number, color: { r: number; g: number; b: number }) => {
    return { sheet, x, y, color };
  };
  for (let i = 0; i < nFrames; i++) {
    const row = rowsMode ? rowsMode.body : i;    // 复合网格属 body 件（bodyFrame 行）
    if (!wantBody) break;                        // part 拆分：复合网格只属 body 件
    const torsoX = row === 5 ? 1 : 0;
    const arm = ARM_FRAME[row];
    // ★SW-BJ11 2026-09-07 行走 bob 行(OffsetsPlayerHeadgear.Y==0 行={7,8,9,14,15,16},
    //  Main.cs:530)复合组件整体 −2px(表值−2;四层出处见 COMPOSITE_BOB_ROWS 注)
    const hgY = COMPOSITE_BOB_ROWS.has(row) ? -2 : 0;
    const drawTinted = (img: ImageBitmap | HTMLImageElement, x: number, y: number, color: { r: number; g: number; b: number }, rot = 0) => {
      if (rot === 0) {
        // 全部部件左上角对齐帧锚点(原版 position-origin 相消;臂偏移仅是旋转 pivot,见文件头)
        ctx.drawImage(tint(img, color), x * FRAME_W, y * FRAME_H, FRAME_W, FRAME_H,
          0, i * FRAME_H + hgY, FRAME_W, FRAME_H);
        return;
      }
      // 帧内绕肩轴旋转（源格左上仍对齐帧锚点，pivot 处于格内 (26,30)；bob 行随
      //  position 整体 −2 而 origin(pivot) 相对贴图不变 → 平移量补 hgY）
      ctx.save();
      ctx.translate(PET_ARM_PIVOT[0], i * FRAME_H + PET_ARM_PIVOT[1] + hgY);
      ctx.rotate(rot);
      ctx.drawImage(tint(img, color), x * FRAME_W, y * FRAME_H, FRAME_W, FRAME_H,
        -PET_ARM_PIVOT[0], -PET_ARM_PIVOT[1], FRAME_W, FRAME_H);
      ctx.restore();
    };
    const drawArmorCell = (img: ImageBitmap | HTMLImageElement | HTMLCanvasElement, x: number, y: number, rot = 0) => {
      if (rot === 0) {
        ctx.drawImage(img, x * FRAME_W, y * FRAME_H, FRAME_W, FRAME_H,
          0, i * FRAME_H + hgY, FRAME_W, FRAME_H);
        return;
      }
      ctx.save();
      ctx.translate(PET_ARM_PIVOT[0], i * FRAME_H + PET_ARM_PIVOT[1] + hgY);
      ctx.rotate(rot);
      ctx.drawImage(img, x * FRAME_W, y * FRAME_H, FRAME_W, FRAME_H,
        -PET_ARM_PIVOT[0], -PET_ARM_PIVOT[1], FRAME_W, FRAME_H);
      ctx.restore();
    };
    if (onlyArmor && !bodyArmorImg) continue;    // armor 层无身甲槽则该层为空
    if (lunarPartOn && lunarBodyC == null) continue;   // ★BJ665b：lunarPart 面无恒色身甲=空件
    // ★BJ665b：拆分时常规面烘除恒色身甲复合件（皮肤躯干垫照画）;lunarPart 面只烘恒色件
    const bodyCellsOn = lunarPartOn ? lunarBodyC != null : lunarBodyC == null;
    if (noArmor && bodyArmorImg) {
      // skin 层（stealth ×s'² 消费）：身甲在位时衣着/臂仍留空（甲覆盖语义），但
      // ★SW-BJ11 2026-09-07 皮肤躯干照画（同 12_Skin_Composite !hidesTopSkin 门,
      // 原版 12_Skin 层与甲无关)—— stealth 拆层的甲下露肤面与整烘一致
      if (!HIDES_TOP_SKIN_BODIES.has(equip?.body ?? 0)) {
        const torsoSkin = sheetRect(a.skinVariant, 3);
        if (torsoSkin) drawTinted(torsoSkin, torsoX, dy, a.skinColor);
      }
      continue;
    }
    if (bodyArmorImg) {
      // ★SW-BJ11 2026-09-07 甲下皮肤躯干:12_Skin_Composite :1279-1286 皮肤躯干(3)
      //  在 !hidesTopSkin 时与甲无关地先画(17_TorsoComposite 甲再叠上)——女式胸甲
      //  镂空处露肤(女胸轮廓)=原版本相(女甲态 12px 残差实证,见 _swbj11-matrix)。
      //  hidesTopSkin={82,83,93,21,22}(21/22=狼人/人鱼全形态)不画
      //  ★C13-F2：ghostSkin → 皮肤躯干垫同整隐（colorBodySkin Transparent 面,:1494）
      //  ★BJ665b：lunarPart 面=恒色件本体（皮肤垫不入,门在取图处）
      if (!HIDES_TOP_SKIN_BODIES.has(equip?.body ?? 0) && !opts?.ghostSkin) {
        const torsoSkin = !lunarPartOn ? sheetRect(a.skinVariant, 3) : null;
        if (torsoSkin) drawTinted(torsoSkin, torsoX, dy, a.skinColor);
      }
      // 身甲复合绘制（PlayerDrawLayers:1345-1366 同构）：后肩→后臂→躯干→前肩→前臂，不再画衣着层
      //  ★BJ665b：恒色身甲在拆分常规面烘除（bodyCellsOn=false）、lunarPart 面单出
      if (bodyCellsOn) {
        drawArmorCell(dyedBodyImg ?? bodyArmorImg, 1, 1 + dy);                          // 后肩
        // 后臂：petting 换列 8 拉伸档 + 旋转（甲臂同格；甲下皮肤臂层为既有
        // 静态臂同款省略——missingArm/missingHand 语义沿本仓甲覆盖口径，登记）
        if (pet) drawArmorCell(dyedBodyImg ?? bodyArmorImg, 8, pet.stretch, pet.rot);   // 后臂（抚摸）
        else drawArmorCell(dyedBodyImg ?? bodyArmorImg, arm[0], arm[1] + 2);            // 后臂
        drawArmorCell(dyedBodyImg ?? bodyArmorImg, torsoX, dy);                         // 躯干
        drawArmorCell(dyedBodyImg ?? bodyArmorImg, 0, 1 + dy);                          // 前肩
        drawArmorCell(dyedBodyImg ?? bodyArmorImg, arm[0], arm[1]);                     // 前臂
      }
      continue;
    }
    // 无盔甲复合绘制（DrawPlayer_12_SkinComposite_BackArmShirt :1385-1403 /
    // DrawPlayer_28_ArmOverItemComposite :3796-3803）：
    //   后臂层序 = 皮肤7→皮肤5→底衫8→衬衫13（:1385-1403）；
    //   前臂层序 = 皮肤7→底衫8→衬衫13→衬衫6（:3796-3803,第4层是 6 不是 5）；
    //   肩/躯干按层序:底衫4(后肩→躯干→前肩) → 衬衫6(同序)——对应原版 13/14 两个 pass
    //   petting：后臂四层全换列 8 拉伸档格 + 同角旋转（z 位不变，层序照旧）
    const petRot = pet ? pet.rot : 0;
    const backArmX = pet ? 8 : arm[0];
    const backArmY = pet ? pet.stretch : arm[1] + 2;
    const draws: Array<{ d: ReturnType<typeof gridRect>; rot?: boolean }> = [
      { d: gridRect(3, torsoX, dy, a.skinColor) },                              // 躯干皮肤(:1280)
      { d: gridRect(7, backArmX, backArmY, a.skinColor), rot: !!pet },          // 后臂皮肤 A
      { d: gridRect(5, backArmX, backArmY, a.skinColor), rot: !!pet },          // 后臂皮肤 B
      { d: gridRect(8, backArmX, backArmY, under), rot: !!pet },                // 后臂底衫
      { d: gridRect(13, backArmX, backArmY, shirt), rot: !!pet },               // 后臂衬衫
      { d: gridRect(4, 1, 1 + dy, under) },                                     // 后肩·底衫
      { d: gridRect(4, torsoX, dy, under) },                                    // 躯干·底衫
      { d: gridRect(4, 0, 1 + dy, under) },                                     // 前肩·底衫
      { d: gridRect(6, 1, 1 + dy, shirt) },                                     // 后肩·衬衫
      { d: gridRect(6, torsoX, dy, shirt) },                                    // 躯干·衬衫
      { d: gridRect(6, 0, 1 + dy, shirt) },                                     // 前肩·衬衫
      { d: gridRect(7, arm[0], arm[1], a.skinColor) },                          // 前臂皮肤
      { d: gridRect(8, arm[0], arm[1], under) },                                // 前臂底衫
      { d: gridRect(13, arm[0], arm[1], shirt) },                               // 前臂衬衫
      { d: gridRect(6, arm[0], arm[1], shirt) },                                // 前臂衬衫 B(:3803)
    ];
    for (const e of draws) {
      const img = sheetRect(a.skinVariant, e.d.sheet);
      if (!img) continue;
      drawTinted(img, e.d.x, e.d.y, e.d.color, e.rot ? petRot : 0);
    }
  }

  // 前发层（1.4.4+ PlayerDrawSet:1751-1753：backHairDraw 时裁 26px 高，与后发层分离）
  if (!onlyArmor && wantHead && hairTinted) {
    const frontH = hasBackHair ? 26 : FRAME_H;
    for (let i = 0; i < nFrames; i++) {
      const row = rowsMode ? rowsMode.body : i;
      const hr = Math.max(0, Math.min(HAIR_FRAMES - 1, row - 6));
      ctx.drawImage(hairTinted, 0, hr * FRAME_H, FRAME_W, frontH, 0, i * FRAME_H, FRAME_W, frontH);
    }
  }

  // 头甲（Armor_Head_{id} 竖条 20 帧，画在头发之后——头盔覆盖发型）。
  // skipHair 时一并让出（发色剂叠层路径由调用方在发层之后补画，保层序）
  // ★BJ631 件1（BJ625 定谳收口）：头甲染料消费——dyeHead（armor dye 槽 0,vanilla
  //  UpdateDyes Player.cs:9679 cHead=GetEffectiveDye(0).dye;头甲层 shader=
  //  drawinfo.cHead,PlayerDrawLayers.cs:2173）。dyeBakeArmorSprite 同 body/legs
  //  烘焙面（composite 缓存键 `|dh` 段此前就是死键——形参在位、消费与喂值双缺）。
  if (equip?.head && !opts?.skipHair && !noArmor && opts?.layer !== 'armorNoHead' && wantHead
    // ★BJ665b：拆分时常规面烘除恒色头甲;lunarPart='upper' 面只烘恒色头甲
    && (lunarPartOn ? lunarHeadC != null : lunarHeadC == null)) {
    const headArmor = UITextures.get(`Armor_Head_${equip.head}.png`);
    if (headArmor) {
      const headArmorImg = equip?.dyeHead ? dyeBakeArmorSprite(headArmor.img, equip.dyeHead) : headArmor.img;
      for (let i = 0; i < nFrames; i++) {
        const row = rowsMode ? rowsMode.body : i;
        ctx.drawImage(headArmorImg, 0, row * FRAME_H, FRAME_W, FRAME_H, 0, i * FRAME_H, FRAME_W, FRAME_H);
      }
    }
  }

  cache.set(key, c);
  bitmapize(cache, key);
  if (cache.size > 64) {
    // 简单淘汰：清一半最旧条目
    let i = 0;
    for (const k of cache.keys()) {
      if (i++ > 32) break;
      cache.delete(k);
    }
  }
  return c;
}

/** 眼睑帧表（DrawPlayer_21_Head_TheFace_Eyelid PlayerDrawLayers.cs:2640-2683：
 *  TextureAssets.Players[skinVar,15] = Player_0_15.png 40×168 三帧竖排（变体 0-9
 *  经 CopyVariant/未重排全指向此一张——terraria-assets 解包实证无 Player_1_15），
 *  色通道 = colorHead → skinColor 调色（tint 缓存）。帧序 0 睁(空) 1 半闭 2 全闭
 *  （EyeFrameToShow）。★SW-RB6c 2026-09-07 取表改走 variantSheetName 单点解析：
 *  变体 10/11 的 [*,15] 经 DisplayDoll 重排指向 Player_10_2 空表（原版不画），
 *  硬编码 0_15 对该两变体=多画男眼睑 */
export function eyelidFrame(a: Appearance): Baked | null {
  const r = UITextures.get(variantSheetName(a.skinVariant, 15, (n) => UITextures.has(n)));
  if (!r) return null;
  noteVuiConsumer('PaperDoll.eyelidFrame');
  return tint(r.img as HTMLImageElement, a.skinColor);
}

/** ★BJ707-G31（G29 登记债③清偿）迅猛龙眼睑帧（PlayerDrawLayers.cs:2655-2658 raptor
 *  覆写面）:骑 54 时眼睑基色 = (158,92,67) 而非 skinColor（color =
 *  GetImmuneAlpha(GetColorClamped(MountedCenter 格,(158,92,67)),shadow)——采光乘面
 *  由实体窗 compositeLight 统一承载,本面只烘基色;immune 闪烁随 bodyAlpha 既有
 *  globalAlpha）+ shader = cMount（★眼睑唯一吃坐骑染料的绘制面——普通面
 *  skinDyePacked 在 vanilla 恒 0（Player.cs:9678 唯一写位清零,死字段）=零染料,
 *  仓内普通面维持无染正确）。染料烘焙 = dyeBakeArmorSprite 同径（dye 先烘后
 *  基色 tint,甲件族序）;head==288 支（:2660-2663）色改 Black=黑底全闭帧,染料
 *  保留（vanilla 仅覆写 color/frameY,shader 不动）——black=true 入参。
 *  dye 烘焙缓存键含 imgId（贴图重载安全）+dyeVid（小集合）。 */
const raptorEyelidDyeCache = new Map<string, HTMLCanvasElement>();
export function eyelidFrameRaptor(a: Appearance, dyeVid: number, black = false): Baked | null {
  const r = UITextures.get(variantSheetName(a.skinVariant, 15, (n) => UITextures.has(n)));
  if (!r) return null;
  noteVuiConsumer('PaperDoll.eyelidFrame');
  const raw = r.img as HTMLImageElement;
  const base = black ? { r: 0, g: 0, b: 0 } : { r: 158, g: 92, b: 67 };
  if (dyeVid <= 0) return tint(raw, base);
  let id = tintImgId.get(raw as object);
  if (id === undefined) { id = ++tintImgSeq; tintImgId.set(raw as object, id); }
  const key = `rd${id}|${dyeVid}`;
  let dyed = raptorEyelidDyeCache.get(key);
  if (!dyed) {
    dyed = dyeBakeArmorSprite(raw, dyeVid);
    raptorEyelidDyeCache.set(key, dyed);
  }
  return tint(dyed, base);
}

/** 取某一帧的绘制参数（供 UISpriteBatch.draw 直接使用） */
export function dollFrame(doll: Baked, frame: number): { img: Baked; sx: number; sy: number; sw: number; sh: number } {
  const idx = Math.max(0, Math.min(BODY_FRAMES - 1, frame));
  return { img: doll, sx: 0, sy: idx * FRAME_H, sw: FRAME_W, sh: FRAME_H };
}

/** 双行帧取帧：rows 模式产物是单帧（sy=0，坐姿可高至 64px），整表产物按 body 行取。
 *  rows.body===rows.legs 时调用方应优先走整表缓存路径（本函数也兼容） */
export function dollFrameRows(doll: Baked, rows: DollRows): { img: Baked; sx: number; sy: number; sw: number; sh: number } {
  if (doll.height < BODY_FRAMES * FRAME_H) {
    return { img: doll, sx: 0, sy: 0, sw: FRAME_W, sh: doll.height };
  }
  return dollFrame(doll, rows.body);
}

/** 行走动画帧号（UICharacter.UpdateAnim：(time/0.07 % 14 + 6)） */
export function walkFrame(timeSec: number): number {
  return (Math.floor(timeSec / 0.07) % 14 + 6);
}

/** 站立帧 */
export const IDLE_FRAME = 0;

/** 逐通道 RGB 缩调（stealth 分层消费：armor ×s'/B×settled、星璇 Lerp 通道）。
 *  multiply 铺 rgb(255·m) 逐通道乘 + destination-in 保原 alpha；mul 量化 1/128 防缓存爆 */
export function tintRGBA(src: Baked, mul: [number, number, number]): Baked {
  const q = mul.map((m) => Math.round(m * 128) / 128);
  const key = `${q[0]},${q[1]},${q[2]}`;
  let inner = stealthTintCache.get(src);
  if (!inner) { inner = new Map(); stealthTintCache.set(src, inner); }
  const hit = inner.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = `rgb(${Math.round(q[0] * 255)},${Math.round(q[1] * 255)},${Math.round(q[2] * 255)})`;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  inner.set(key, c);
  bitmapize(inner, key);
  if (inner.size > 48) {   // 量化档 ≤129；stealth 连续变化时留中段档位
    let i = 0;
    for (const k of inner.keys()) { if (i++ > 24) break; inner.delete(k); }
  }
  return c;
}
