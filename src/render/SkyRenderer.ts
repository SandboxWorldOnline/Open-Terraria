// 天空渲染：昼夜渐变、太阳/月亮、星星、云
// 注意:Clock 必须值导入——DAWN/DUSK 是运行时常量,import type 会被擦除
// (:528/:561 运行时取值 → "Clock is not defined" 每帧崩渲染循环)
import { upgradeToBitmap, loadBitmapOnly } from '../assets/SpriteAtlas';
import { Clock } from '../world/World';
import { Clock as ClockVal } from '../world/World';
import { liqpolish } from './perfFlags';   // ★liqpolish 微抛光刀总闸（星 cs/sn 更新侧缓存）

/** 天空实体染色缓存（GetColor RGB × 贴图 multiply 预染；键含 1/16 量化色档） */
const AMB_TINT_CACHE = new Map<string, HTMLCanvasElement>();
/** GPU contextlost 后天空实体染色缓存内容归零且不会自动重画——失效清空
 *  (Renderer.onLost 统一扫) */
export function clearAmbientTintCache(): void {
  for (const c of AMB_TINT_CACHE.values()) { c.width = 0; c.height = 0; }
  AMB_TINT_CACHE.clear();
  for (const c of EVENT_TINT_CACHE.values()) { c.width = 0; c.height = 0; }
  for (const c of eventTintFree) { c.width = 0; c.height = 0; }
  EVENT_TINT_CACHE.clear();
  eventTintFree.length = 0;
}
/** 事件天幕（史莱姆剪影/UFO）乘色缓存:键 = 纹理 id + 1/16 量化 rgb。工作集 =
 *  4 史莱姆贴图 × 5 深度档 × 慢变 cots 桶(≈20-40)+ UFO 2 张——真 LRU 命中重插,
 *  cap 64 + 复用池 8(cloudTint 同款防画布出生风暴) */
const EVENT_TINT_CACHE = new Map<string, HTMLCanvasElement>();
const eventTintFree: HTMLCanvasElement[] = [];
function eventTintedSprite(
  tex: ImageBitmap | HTMLImageElement, r: number, g: number, b: number, family: string,
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  if (!texReady(tex)) return null;   // ★半加载窗守卫（2026-08-24 方片竞态同洞加固）
  const key = `${family}:${texId(tex as object)}:${r >> 4},${g >> 4},${b >> 4}`;
  const hit = EVENT_TINT_CACHE.get(key);
  if (hit) {
    EVENT_TINT_CACHE.delete(key);
    EVENT_TINT_CACHE.set(key, hit);       // LRU 重插尾
    return hit;
  }
  let c = eventTintFree.pop();
  let pooledE = false;
  if (!c) c = document.createElement('canvas');
  else pooledE = true;
  if (c.width !== tex.width || c.height !== tex.height) { c.width = tex.width; c.height = tex.height; }
  const cx = c.getContext('2d', { willReadFrequently: true })!;
  cx.globalCompositeOperation = 'copy';
  cx.drawImage(tex as CanvasImageSource, 0, 0);
  cx.globalCompositeOperation = 'multiply';
  cx.fillStyle = `rgb(${r},${g},${b})`;
  cx.fillRect(0, 0, c.width, c.height);
  cx.globalCompositeOperation = 'destination-in';
  cx.drawImage(tex as CanvasImageSource, 0, 0);
  if (pooledE) bumpTexEpoch(c);   // ★池取重烘必换代（copy 只换像素,shim er: 键不动=陈旧纹理）
  EVENT_TINT_CACHE.set(key, c);
  if (EVENT_TINT_CACHE.size > 64) {
    const first = EVENT_TINT_CACHE.keys().next().value;
    if (first !== undefined) {
      const evicted = EVENT_TINT_CACHE.get(first);
      EVENT_TINT_CACHE.delete(first);
      if (evicted && eventTintFree.length < 8) eventTintFree.push(evicted);
    }
  }
  return c;
}
import { shade, mix } from '../assets/Palette';
import { LanternNight } from '../world/LanternNight';
import { UnifiedRandom } from '../core/rng';
import type { GLSpriteLayer, TexEntry } from './GLSpriteLayer';
import { texId, texReady, bumpTexEpoch } from './texId';
import { horizonPhaseOf, sunColorOf, moonDrawColor } from '../lighting/Horizon';
import { applyBiomeToSun, applyBiomeToMoon } from '../lighting/SkyColor';
import { AuroraSky } from './AuroraSky';
import { SlimeSky, slimeSilhouetteTint, slimeProject } from './SlimeSky';
import { MartianSky, ufoTintColor, ufoProject } from './MartianSky';
import { globalTimeWrappedHourly } from '../core/GameTime';   // ★BJ330 GTW 单源

// 天空关键色 [时刻, 顶色, 底色]（时刻 0-1）
const SKY_KEYS: Array<[number, string, string]> = [
  [0.0, '#050A1E', '#0E1630'],   // 午夜
  [0.22, '#050A1E', '#1A2440'],  // 黎明前
  [0.27, '#3A4A8A', '#E89A5A'],  // 日出
  [0.35, '#4A8AD4', '#A8D4F0'],  // 上午
  [0.5, '#4A90E0', '#B8DCF5'],   // 正午
  [0.65, '#4A8AD4', '#A8D0E8'],  // 下午
  [0.73, '#4A5A9A', '#E88A5A'],  // 日落
  [0.78, '#101838', '#2A2448'],  // 黄昏后
  [0.85, '#050A1E', '#0E1630'],  // 夜
  [1.0, '#050A1E', '#0E1630'],
];

function lerpColor(a: string, b: string, t: number): string {
  return mix(a, b, t);
}

/** 原版星结构(Star.cs 字段 1:1;position 为 1920×1200 天空空间)。
 *  ★liqpolish:cs/sn=cos/sin(rot) 更新侧缓存（★非原版字段——构造路径优化面）。
 *  csRot=缓存产出的 rot 值（读侧验证戳——paused 翻旗/漏更窗下 cs/sn 可能陈旧,
 *  csRot!==rot 即回退就地求值=任意时序下逐位安全） */
interface SkyStar {
  x: number; y: number;
  rot: number; scale: number; type: number;
  twinkle: number; twSpeed: number; rotSpeed: number;
  falling: boolean; hidden: boolean;
  fvx: number; fvy: number; fallTime: number;
  fadeIn: number;
  cs: number; sn: number; csRot: number;
}

/** 原版日月贴图(Main.cs:62279 DrawSunAndMoon):Sun.png 整图 114×114;
 *  Moon_N.png 50×400 竖条 = 8 个相位帧(moonType 0-8 选表,moonPhase 选帧) */
function loadTex(name: string): HTMLImageElement {
  const im = new Image();
  let attempts = 0;
  // ★失败重试(2026-08-25 同类扫描):日月/星/云为 PRUNED 路径,首访冷缓存窗口
  //   一次失败=天空恒缺(构造器字段持有坏 Image 无 onerror)。10s 起步退避重试
  //   直至命中暖缓存;upgradeToBitmap 链经 UPG 登记对持有方透明
  im.onerror = () => {
    attempts++;
    setTimeout(() => { im.src = `sprites/vanilla/${name}`; }, Math.min(10_000 * attempts, 30_000));
  };
  im.onload = () => upgradeToBitmap(im, (b) => { UPG.get(im)?.forEach((cb) => cb(b)); UPG.delete(im); });
  im.src = `sprites/vanilla/${name}`;
  return im;
}
/** loadTex 返回的 Image → bitmap 就绪回调登记(持有方替换自身引用) */
const UPG = new WeakMap<HTMLImageElement, Array<(b: ImageBitmap) => void>>();
function onBitmap(im: HTMLImageElement, cb: (b: ImageBitmap) => void): HTMLImageElement {
  const q = UPG.get(im) ?? []; q.push(cb); UPG.set(im, q); return im;
}

/** 原版云（Cloud.cs 语义）：贴图五族 Cloud_0-3 常态/4-8 高层薄云/9-13 远空灰云/
 *  14-17 低空白云/18-21 雨云·风暴云（addCloud 选型链 Cloud.cs:114-138）、
 *  scale 0.70-1.31、风驱动 ±9*parallax px/帧、旋转微摆 ±0.02、按 scale 三层深度
 *  （远景压暗 R 通道）、AABB 拒绝重叠生成、淡入淡出。 */
interface VanillaCloud {
  type: number;
  x: number; y: number;         // 像素（y 为屏幕上部带）
  scale: number;
  rot: number; rSpeed: number;
  alpha: number;
  flip: boolean;
  kill: boolean;
}

/** 云选型链结果（pickCloudType 返回） */
export interface CloudTypePick {
  type: number;
  /** 风暴云（18-21）大块上移量：scale≥1.15 → 150、scale≥1 → 150，两档叠加（Cloud.cs:118-125） */
  stormShift: number;
}

/** #rrggbb → [r,g,b]（atmo 相乘）——云色链的 ColorOfTheSkies 换算 */
function hexRGB(hex: string, atmo = 1): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) * atmo, ((v >> 8) & 255) * atmo, (v & 255) * atmo];
}

/** Utils.GetLerpValue（Utils.cs）钳位版本：from>to 时单调递减（淡出段用） */
function lerpValueClamped(from: number, to: number, t: number): number {
  if (from === to) return t < from ? 0 : 1;
  return Math.max(0, Math.min(1, (t - from) / (to - from)));
}

/**
 * 云贴图选型链（Cloud.cs addCloud :114-138 五族 1:1，纯函数供测试）：
 *  ① 雨云/风暴云：cloudAlpha>0 且 3/4 概率，或阴天（cloudBGActive≥1）且 1/2 概率
 *     → type 18-21（贴图 Cloud_18-21，530×218 级大块云，故整体上移腾位置）；
 *  ② 远空灰云 9-13：晴天无雨、scale<1、高位、云量≤80 时；
 *  ③ 高层薄云 4-8：高空或小 scale 高位，云量>70 或阴天；
 *  ④ 低空白云 14-17：低位 + 1/2 概率 + 云量>20；
 *  ⑤ 缺省 0-3 常态云。
 *  注意 9-13 在下雨/阴天转为 kill（Cloud.cs Update :449-452）——它们是"晴天远空灰云"，
 *  雨天出场的深色云是 18-21（任务描述里"Cloud_9-13 深雨云"系误记，以源码为准）。
 *  稀有云 22-40（:139-146 → RollRareCloud）见 rollRareCloud，已实装。
 */
export function pickCloudType(i: {
  scale: number; y: number; viewH: number;
  numClouds: number; cloudAlpha: number; cloudBGActive: number;
  rnd: () => number;
}): CloudTypePick {
  const r = i.rnd;
  let type = Math.floor(r() * 4);                                    // :114 Next(4)
  let stormShift = 0;
  if ((i.cloudAlpha > 0 && Math.floor(r() * 4) !== 0) || (i.cloudBGActive >= 1 && Math.floor(r() * 2) === 0)) {
    // :115-126 —— C# || 短路：第一支为真时第二支的 Next(2) 不掷（rnd 序列对齐）
    type = 18 + Math.floor(r() * 4);                                 // :117 Next(18,22)
    if (i.scale >= 1.15) stormShift += 150;                          // :118-120
    if (i.scale >= 1) stormShift += 150;                             // :122-124
  } else if (i.cloudBGActive <= 0 && i.cloudAlpha === 0 && i.scale < 1
    && i.y < -i.viewH * 0.15 && i.numClouds <= 80) {
    type = 9 + Math.floor(r() * 5);                                  // :129 Next(9,14)
  } else if (((i.scale < 1.15 && i.y < -i.viewH * 0.3) || (i.scale < 0.85 && i.y < i.viewH * 0.15))
    && (i.numClouds > 70 || i.cloudBGActive >= 1)) {
    type = 4 + Math.floor(r() * 5);                                  // :133 Next(4,9)
  } else if (i.y > -i.viewH * 0.15 && Math.floor(r() * 2) === 0 && i.numClouds > 20) {
    type = 14 + Math.floor(r() * 4);                                 // :137 Next(14,18)
  }
  return { type, stormShift };
}

/** 稀有云世界旗标门输入（Cloud.cs RollRareCloud :183-227）。 */
export interface RareCloudFlags {
  /** NPC.downedBoss1（克眼）→ 稀有云 25/26（克眼云） */
  downedBoss1: boolean;
  /** NPC.downedBoss2（世吞/克脑）且 WorldGen.crimson → 稀有云 36（克脑云） */
  downedBoss2: boolean;
  /** NPC.downedBoss3（骷髅王）→ 稀有云 31（骷髅云） */
  downedBoss3: boolean;
  /** Main.hardMode → 稀有云 30（南瓜王云）/35（飞龙云） */
  hardMode: boolean;
  /** WorldGen.crimson */
  crimson: boolean;
  /** Main.dontStarveWorld → 37-40 直通（+触发概率 1/25） */
  dontStarveWorld: boolean;
  /** Main.tenthAnniversaryWorld → 37-40 不掷（范围收窄 22-36）+触发概率 1/25 与 1/3 */
  tenthAnniversaryWorld: boolean;
}

/** CloudID.Sets.RareClouds_Normal（CloudID.cs:11-15，1457 新表）——普通世界稀有云池
 *  （22-40 全部 + 41 Rare_Pixie）。 */
export const RARE_CLOUDS_NORMAL: readonly number[] = [
  22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
  32, 33, 34, 35, 36, 37, 38, 39, 40, 41,
];

/** CloudID.Sets.RareClouds_Celebration（CloudID.cs:17-21，1457 新表）——十周年世界池
 *  （比 Normal 少 37-40 饥荒四角色）。 */
export const RARE_CLOUDS_CELEBRATION: readonly number[] = [
  22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
  32, 33, 34, 35, 36, 41,
];

/** RollRareCloud（1457 Cloud.cs:184-232 一比一，纯函数供测试）：掷点改走 CloudID.Sets
 *  稀有云池表（普通=22-41、十周年=22-36+41；1456 为 Next(22,41)/Next(22,37) 硬编码），
 *  旗标门未过的类型重掷。41 Rare_Pixie 为 1457 新类型，门=hardMode（:208-210）。
 *  稀有云贴图语义见 CloudID.cs:49-85（鸟/兔/世吞/克眼×2/金鱼/Redigit/心/南瓜王/
 *  骷髅/星/剑/树/飞龙/克脑/饥荒四角色/精灵）。 */
export function rollRareCloud(f: RareCloudFlags, rnd: () => number): number {
  let num = -1;
  let ok = false;
  let guard = 0;
  const pool = f.tenthAnniversaryWorld ? RARE_CLOUDS_CELEBRATION : RARE_CLOUDS_NORMAL;
  while (!ok && guard++ < 512) {
    num = pool[Math.floor(rnd() * pool.length)];                         // :189 rand.Next(pool.Count)
    switch (num) {
      case 31: ok = f.downedBoss3; break;                                  // :195-197
      case 36: ok = f.downedBoss2 && f.crimson; break;                     // :198-200
      case 25: case 26: ok = f.downedBoss1; break;                         // :201-204
      case 30: case 35: case 41: ok = f.hardMode; break;                   // :205-210（41 为 1457 新增）
      case 28: ok = Math.floor(rnd() * 10) === 0; break;                   // :211-216 1/10
      case 37: case 38: case 39: case 40:
        ok = f.dontStarveWorld || Math.floor(rnd() * 10) === 0; break;     // :217-225
      default: ok = true; break;
    }
  }
  return num;
}

// ================= AmbientSky 天空实体（AmbientSky.cs FadingSkyEntity 全族 17/19） =================
// 选族纯函数/类型已抽出共享模块（MP 氛围联机批：server/src/room.ts 的 AmbienceServer
// 复用同表——room 无法经本文件导入 SpriteAtlas 资产链）；此处 re-export 兼容既有消费方
export {
  type AmbientFamily, type AmbientSpawnInput, pickAmbientFamily,
  AMBIENT_FAMILY_SKY_TYPE, ambientFamilyOfSkyType,
} from './ambientFamilies';
import { type AmbientFamily, type AmbientSpawnInput, pickAmbientFamily, ambientFamilyOfSkyType } from './ambientFamilies';

/** 单体族参数表（AmbientSky.cs 各类构造器 1:1；纯数据供测试对账） */
export interface AmbientFamilyParams {
  /** SpriteFrame(1, rows)——帧行数（变体族由生成侧覆盖：butterflies 17/19、eos/crimera 3-4 档） */
  rows: number;
  /** FramingSpeed（0 = int.MaxValue 不推进） */
  framingSpeed: number;
  fadeIn: number; fadeOut: number;    // OpacityNormalizedTimeTo*
  /** BrightnessLerper（GetColor :165-168 向白 lerp 系数；gastropod 走专属色） */
  brightness: number;
  /** LifeTime = Next(a,b)*60 */
  life: [number, number];
  /** Depth = depthMin + rand*depthSpan */
  depthMin: number; depthSpan: number;
  /** 高度带 y = yOff + rand*(surfacePx - ySub - yOff)（airballoon/eoc 族为定位特例，生成侧自算） */
  yOff: number; ySub: number;
  /** 横速 |v| = speedA + |WindForVisuals|*speedB（Main.cs:2896 = windSpeedCurrent） */
  speedA: number; speedB: number;
  /** Draw 传 depthScale-adj（PixiePosse -0.1 :440 / Seagulls -1.5 :561） */
  depthScaleAdj?: number;
  /** spriteDir 与风无关（Airship :1087 / AirBalloon :1134 = random.Next(2)） */
  randomDir?: boolean;
  /** 固定纵向速度（SlimeBalloons -0.01 :751） */
  vy?: number;
  /** EOCSkyEntity 状态机（eyeball/eos/crimera：3/4 折线 1/4 追玩家 :1244-1251） */
  eoc?: boolean;
  /** 出生帧随机推进 Next(RowCount)（LostKite :257 / Seagulls :523 / Bats :954 / HellBats :842 / SlimeBalloons :736） */
  frameRandom?: boolean;
  /** FrameOffset 随机相位（Seagulls :522 / Bats :953 / HellBats :841） */
  frameOffset?: boolean;
  /** GetColor = Lerp(白, 灰, Depth/15)（HellBats :871——越远越灰） */
  grayDepthFade?: boolean;
  /** 地狱带族：y = UnderworldLayer*16 + rand*800（HellBats CreateGroup :890） */
  hellBand?: boolean;
}

export const AMBIENT_FAMILY_PARAMS: Record<AmbientFamily, AmbientFamilyParams> = {
  birds:         { rows: 4, framingSpeed: 5, fadeIn: 0.15, fadeOut: 0.85, brightness: 0.2, life: [60, 121], depthMin: 3, depthSpan: 3, yOff: 2400, ySub: 1600, speedA: 3, speedB: 0.8 },                       // BirdsPack :444-487
  wyvern:        { rows: 5, framingSpeed: 4, fadeIn: 0.15, fadeOut: 0.85, brightness: 0.2, life: [40, 71], depthMin: 3, depthSpan: 3, yOff: 2400, ySub: 1600, speedA: 3, speedB: 0.8 },                        // Wyvern :1026-1059
  airship:       { rows: 4, framingSpeed: 4, fadeIn: 0.05, fadeOut: 0.95, brightness: 0.2, life: [40, 71], depthMin: 3, depthSpan: 3, yOff: 2400, ySub: 1600, speedA: 6, speedB: 1.6, randomDir: true },        // Airship :1082-1124
  airballoon:    { rows: 5, framingSpeed: 0, fadeIn: 0.05, fadeOut: 0.95, brightness: 0.2, life: [20, 51], depthMin: 3, depthSpan: 3, yOff: 0, ySub: 0, speedA: 0, speedB: 4, randomDir: true },               // AirBalloon :1126-1176（vx=wind*4、vy 自算）
  eyeball:       { rows: 3, framingSpeed: 5, fadeIn: 0.1, fadeOut: 0.9, brightness: 0.2, life: [18, 31], depthMin: 4.5, depthSpan: 3, yOff: 0, ySub: 0, speedA: 3, speedB: 0, eoc: true },                     // EOC :1226-1314
  butterflies:   { rows: 17, framingSpeed: 5, fadeIn: 0.15, fadeOut: 0.85, brightness: 0.2, life: [60, 121], depthMin: 3, depthSpan: 3, yOff: 4000, ySub: 0, speedA: 0.1, speedB: 0.05 },                      // Butterflies :186-229（rows 变体 17/19）
  lostkite:      { rows: 42, framingSpeed: 6, fadeIn: 0.15, fadeOut: 0.85, brightness: 0.2, life: [60, 121], depthMin: 3, depthSpan: 3, yOff: 2400, ySub: 1600, speedA: 1.2, speedB: 3, frameRandom: true },    // LostKite :231-287（风暴 FramingSpeed 4 / 速度×1.5）
  vulture:       { rows: 10, framingSpeed: 5, fadeIn: 0.15, fadeOut: 0.85, brightness: 0.2, life: [60, 121], depthMin: 3, depthSpan: 3, yOff: 2400, ySub: 1600, speedA: 3, speedB: 0.8 },                      // Vulture :338-387
  bats:          { rows: 10, framingSpeed: 4, fadeIn: 0.1, fadeOut: 0.9, brightness: 0.2, life: [30, 61], depthMin: 3, depthSpan: 3, yOff: 2400, ySub: 1600, speedA: 3, speedB: 0.8, frameOffset: true, frameRandom: true }, // Bats :919-1024
  pixieposse:    { rows: 25, framingSpeed: 5, fadeIn: 0.15, fadeOut: 0.85, brightness: 0.6, life: [60, 121], depthMin: 2, depthSpan: 3, yOff: 4000, ySub: 0, speedA: 0.12, speedB: 0.08, depthScaleAdj: -0.1 }, // PixiePosse :389-442（y 带 :406 = 4000..surface*16）
  seagulls:      { rows: 9, framingSpeed: 4, fadeIn: 0.1, fadeOut: 0.9, brightness: 0.2, life: [30, 61], depthMin: 1, depthSpan: 2, yOff: 2400, ySub: 1600, speedA: 4, speedB: 0, depthScaleAdj: -1.5, frameOffset: true, frameRandom: true }, // Seagulls :488-599
  slimeBalloons: { rows: 7, framingSpeed: 0, fadeIn: 0.025, fadeOut: 0.975, brightness: 0.2, life: [80, 121], depthMin: 3, depthSpan: 3, yOff: 2400, ySub: 1600, speedA: 1, speedB: 1, vy: -0.01, frameRandom: true }, // SlimeBalloons :708-805
  gastropod:     { rows: 1, framingSpeed: 0, fadeIn: 0.1, fadeOut: 0.9, brightness: 0.75, life: [60, 121], depthMin: 2, depthSpan: 3, yOff: 3200, ySub: 1600, speedA: 1.5, speedB: 0.2, depthScaleAdj: -0.1 },  // Gastropod :601-708（BrightnessLerper .75 → 色 (102,0,63)）
  pegasus:       { rows: 11, framingSpeed: 5, fadeIn: 0.15, fadeOut: 0.85, brightness: 0.2, life: [60, 121], depthMin: 3, depthSpan: 3, yOff: 2400, ySub: 1600, speedA: 1.5, speedB: 0.6 },                    // Pegasus :289-336
  eos:           { rows: 4, framingSpeed: 5, fadeIn: 0.1, fadeOut: 0.9, brightness: 0.2, life: [18, 31], depthMin: 4.5, depthSpan: 3, yOff: 0, ySub: 0, speedA: 3, speedB: 0, eoc: true },                     // EOS :1202-1224（继承 EOC）
  crimera:       { rows: 3, framingSpeed: 5, fadeIn: 0.1, fadeOut: 0.9, brightness: 0.2, life: [18, 31], depthMin: 4.5, depthSpan: 3, yOff: 0, ySub: 0, speedA: 3, speedB: 0, eoc: true },                     // Crimera :1178-1200
  hellbats:      { rows: 10, framingSpeed: 4, fadeIn: 0.1, fadeOut: 0.9, brightness: 0.2, life: [30, 61], depthMin: 3, depthSpan: 5, yOff: 0, ySub: 0, speedA: 3, speedB: 0.8, frameOffset: true, frameRandom: true, grayDepthFade: true, hellBand: true }, // HellBats :807-917
};

/** 群体族参数（各族 CreateGroup 1:1；单体族不在此表） */
export interface AmbientGroupSpec {
  /** 群内数量 = Next(a,b) */
  count: [number, number];
  /** 磁吸加速度基 = a + rand*b（Gastropod :691 异于其余族的 0.5+rand*0.5） */
  accX: [number, number]; accY: [number, number];
  /** 加速度因子 = (rand*factorA + factorB) * 0.05（Gastropod :701 / 其余 :594/:903/:1019） */
  factorA: number; factorB: number;
  /** 磁吸目标偏移 ±target（Gastropod 120 / Slime 150 / 其余 100） */
  target: number;
  /** 群内散布乘子（(rand*20-10, rand*3) * spread :590/:697/:796/:899/:1015） */
  spread: number;
  /** 逐体 Depth 抖动（+ rand*depthJitter） */
  depthJitter: number;
  /** 逐体 LifeTime 抖动（+ Next(301)） */
  lifeJitter: number;
  /** 基础寿命 = Next(a,b)*60（群族统一在 spec.life 上，此字段保留对账） */
  baseLife: [number, number];
}

export const AMBIENT_GROUP_SPEC: Partial<Record<AmbientFamily, AmbientGroupSpec>> = {
  seagulls:      { count: [5, 9], accX: [0.5, 0.5], accY: [0.5, 0.5], factorA: 0.3, factorB: 0.85, target: 100, spread: 50, depthJitter: 0.5, lifeJitter: 301, baseLife: [30, 61] },      // :564-598
  gastropod:     { count: [3, 8], accX: [0.1, 0.1], accY: [0.3, 0.3], factorA: 0.5, factorB: 0, target: 120, spread: 60, depthJitter: 0.5, lifeJitter: 301, baseLife: [30, 61] },        // :672-705
  slimeBalloons: { count: [5, 10], accX: [0.1, 0.1], accY: [0.1, 0.1], factorA: 0.2, factorB: 0, target: 150, spread: 80, depthJitter: 0.5, lifeJitter: 301, baseLife: [80, 121] },       // :771-804
  bats:          { count: [20, 40], accX: [0.5, 0.5], accY: [0.5, 0.5], factorA: 0.3, factorB: 0.85, target: 100, spread: 50, depthJitter: 0.5, lifeJitter: 301, baseLife: [30, 61] },    // :990-1023
  hellbats:      { count: [20, 40], accX: [0.5, 0.5], accY: [0.5, 0.5], factorA: 0.3, factorB: 0.85, target: 100, spread: 50, depthJitter: 0.5, lifeJitter: 301, baseLife: [30, 61] },    // :874-907
};

/** 月塔天空激活门（SceneState.cs:105-115 + SceneMetrics.cs:276-282/921-928 一比一）：
 *  塔近距门 = 玩家中心与塔 NPC 距离² ≤ NPCEventZoneRadius²(4000²)；
 *  器件门 = 无任何塔近距 且 ActiveMonolithType 对应（:111-115 !flag4 && type==N）。 */
export function towerSkyActive(nearTower: boolean, monolithType: number, familyIndex: number,
  anyTowerNear: boolean): boolean {
  if (nearTower) return true;
  return !anyTowerNear && monolithType === familyIndex;             // :111-115
}

/** VirtualCamera（Terraria.Graphics/VirtualCamera.cs:5-14）：Center=Player.Center、
 *  Position=Center−Size/2、Size=(Main.maxScreenW, maxScreenH)。HiDef 档下
 *  maxScreenW/H = 4096（Main.cs:3753-3755）——即出生域是**以玩家为中心的 4096×4096
 *  虚拟视口**，与真实渲染视口尺寸无关（Reach 档才退回 MaxWorldViewSize）。
 *  消费点：各族构造器 `Position.X = vcam.Position.X ± …/ + Size.X + 100`（:195-199 等）
 *  与 EOC BeginZigZag/BeginChasingPlayer（:1266-1282）。 */
const VIRTUAL_CAM_SIZE = 4096;
const VIRTUAL_CAM_HALF = VIRTUAL_CAM_SIZE / 2;

/** FadingSkyEntity（AmbientSky.cs:88-184）本仓表示（全族） */
/** ★C10e 二期:单鸟绘制计划（2D 循环与 GL quad 发射共用单源,见 ambPlan/emitAmbienceGl 注——
 *  防「计算双份漂移」;星批 buildStarBatch 同范式） */
interface AmbDrawPlan {
  e: AmbientEnt;
  tinted: HTMLCanvasElement;        // AMB_TINT_CACHE 染色画布（key 稳定内容不变=GL 纹理可驻留）
  key8: string;                     // 染色缓存键（GL 纹理键前缀 ambt:）
  fw: number; fh: number; scale: number;
  sx: number; sy: number;           // 屏坐标（局部单位;GL 侧经 ctx 变换映设备像素）
  alpha: number;
  flip: boolean;                    // SpriteEffects.FlipHorizontally（eyeball/eos/crimera 恒 false）
}

/** ★A3 灯笼夜帧回收:单灯绘制计划（drawLanterns 2D 兜底/GL 发射/far stash 三路单源
 *  ——ambPlan/starCompute 同范式;alpha 表达式逐字同旧 2D 内联式,防双路漂移） */
interface LanternPlan {
  variant: number;                  // Extra_134 三变体列（0-2）
  rot: number;                      // l.rot（2D rotate=GL quadSprite rot 同源）
  scale: number;                    // (1/depth)×1.2（:225-234 视差 X 缩放;dest 尺寸=fw·scale·2）
  sx: number; sy: number;           // 屏坐标（X 已 4000 包裹;GL 侧经 ctx 变换映设备像素）
  alphaGlow: number;                // 光晕副本 α = 0.4·mul·opacity·flicker（:248-252）
  alphaMain: number;                // 主贴图 α = 0.47·mul·opacity（:194-253）
}

interface AmbientEnt {
  kind: AmbientFamily;
  x: number; y: number;             // SkyEntity.Position（世界 px）
  depth: number;
  dir: 1 | -1;
  life: number; bornAt: number;     // LifeTime / TimeEntitySpawnedIn（tick）
  fadeIn: number; fadeOut: number;
  frame: number; rows: number; framingSpeed: number; frameOffset: number;
  opacity: number; vx: number; vy: number; rotation: number;
  brightness: number;               // BrightnessLerper
  depthScaleAdj: number;
  grayDepthFade: boolean;
  texKey: string;
  /** PixiePosse 昼夜变体（1 日 / 2 夜 :409-413）——env 门按变体判 */
  variant: number;
  /** 磁吸弹簧四元组（群体族 :530-537/:639-644/:747-752） */
  magAccX: number; magAccY: number; magTX: number; magTY: number;
  magPX: number; magPY: number; magVX: number; magVY: number;
  /** EOCSkyEntity 状态机（:1232-1237：1 折线 / 2 追玩家） */
  state: number; waviness: number;
  dead: boolean;
}

/** Utils.Remap（Utils.cs）= Lerp(toMin, toMax, GetLerpValue(fromMin, fromMax, value, clamped)) */
function remap(value: number, fromMin: number, fromMax: number, toMin: number, toMax: number): number {
  return toMin + (toMax - toMin) * lerpValueClamped(fromMin, fromMax, value);
}

/** MoonLordSkyIntensity（SceneMetrics.cs:297-305）：1 − SmoothStep(3000,6000, 玩家距 398 核)。
 *  Utils.SmoothStep（Utils.cs:126-130）= 钳位线性（非 Hermite 平滑）。 */
export function moonLordSkyIntensity(distancePx: number): number {
  return 1 - Math.max(0, Math.min(1, (distancePx - 3000) / 3000));
}

// ================= 月塔天空族（Nebula/Solar/Stardust/Vortex Sky 1:1） =================

type TowerFamily = 'vortex' | 'nebula' | 'stardust' | 'solar';

/** 各族贴图文件（展平键）：Background/Planet 公共 + 族专属件 */
const TOWER_SKY_TEX: Record<TowerFamily, Record<string, string>> = {
  vortex: {
    Background: 'Misc_VortexSky_Background.png', Planet: 'Misc_VortexSky_Planet.png',
    Bolt: 'Misc_VortexSky_Bolt.png', Flash: 'Misc_VortexSky_Flash.png',
  },
  nebula: {
    Background: 'Misc_NebulaSky_Background.png', Planet: 'Misc_NebulaSky_Planet.png',
    Beam: 'Misc_NebulaSky_Beam.png', Rock0: 'Misc_NebulaSky_Rock_0.png',
    Rock1: 'Misc_NebulaSky_Rock_1.png', Rock2: 'Misc_NebulaSky_Rock_2.png',
  },
  solar: {
    Background: 'Misc_SolarSky_Background.png', Planet: 'Misc_SolarSky_Planet.png',
    Meteor: 'Misc_SolarSky_Meteor.png',
  },
  stardust: {
    Background: 'Misc_StarDustSky_Background.png', Planet: 'Misc_StarDustSky_Planet.png',
    Star0: 'Misc_StarDustSky_Star 0.png', Star1: 'Misc_StarDustSky_Star 1.png',
  },
};

/** 单族天空状态（对应一个 CustomSky 实例：SceneState 同族也供 Monolith* 复用） */
class TowerSkyState {
  /** _isActive */
  active = false;
  /** _fadeOpacity（Activate 置 0.002，±0.01/帧 1:1 Update :47-67） */
  fade = 0;
  /** Main.GlobalTimeWrappedHourly（秒，驱动星尘闪烁/星云落石——★BJ330 起由 GameTime 单源每帧覆写） */
  time = 0;
  private texs = new Map<string, ImageBitmap | HTMLImageElement>();
  // NebulaSky._pillars（Activate :121-133：40 根光柱，X 均布世界宽±20000、Y -2000..-1800、Depth 7-15）
  private pillars: Array<{ x: number; y: number; depth: number }> = [];
  // SolarSky._meteors（Activate :124-147：150 颗，2/3 近层 Depth 1.8-4.8、1/3 远层 4.8-9.8）
  private meteors: Array<{ x: number; y: number; depth: number; frame: number; scale: number; startX: number }> = [];
  // StardustSky._stars（Activate :121-146：200×10 颗，Depth 1.5-9.5）
  private stars: Array<{ x: number; y: number; depth: number; tex: number; off: number; amp: number; freq: number }> = [];
  // VortexSky._bolts（Activate :131-140：500 槽；Update :59-83 每 1-4t 一道，寿命 30）
  private bolts: Array<{ x: number; y: number; depth: number; life: number; alive: boolean }> = [];
  private boltTimer = 0;

  private tex(fam: TowerFamily, key: string): ImageBitmap | HTMLImageElement | null {
    const k = `${fam}|${key}`;
    let t = this.texs.get(k);
    if (!t) {
      t = loadTex(TOWER_SKY_TEX[fam][key]);
      this.texs.set(k, t);
    }
    return t;
  }

  /** ManageSpecialBiomeVisuals 翻转（Activate :121-147 / Deactivate :140-143） */
  setActive(on: boolean, fam: TowerFamily, maxTilesX: number, surfacePx: number): void {
    if (on && !this.active) this.generate(fam, maxTilesX, surfacePx);
    else if (!on) this.active = false;
  }

  reset(): void {
    this.active = false;
    this.fade = 0;
    this.pillars = [];
    this.meteors = [];
    this.stars = [];
    this.bolts = [];
  }

  /** Activate 实体生成（按族分发；调用方持有族名） */
  generate(fam: TowerFamily, maxTilesX: number, surfacePx: number): void {
    const r = Math.random;
    this.fade = 0.002;
    this.active = true;
    this.maxTilesX = maxTilesX;
    this.surfacePx = surfacePx;
    if (fam === 'nebula') {
      // NebulaSky.Activate :125-132
      const maxTilesX = this.maxTilesX, N = 40;
      this.pillars = new Array(N);
      for (let i = 0; i < N; i++) {
        this.pillars[i] = {
          x: (i / N) * (maxTilesX * 16 + 20000) + r() * 40 - 20 - 20000,
          y: r() * 200 - 2000,
          depth: r() * 8 + 7,
        };
      }
      this.pillars.sort((a, b) => b.depth - a.depth);   // Array.Sort(降 Depth)
    } else if (fam === 'solar') {
      // SolarSky.Activate :128-146
      const maxTilesX = this.maxTilesX, surfacePx = this.surfacePx, N = 150;
      this.meteors = new Array(N);
      for (let i = 0; i < N; i++) {
        const depth = Math.floor(r() * 3) !== 0 ? r() * 3 + 1.8 : r() * 5 + 4.8;  // :134-141
        const x = (i / N) * maxTilesX * 16 + r() * 40 - 20;
        this.meteors[i] = {
          x, y: -(r() * (surfacePx + 10000)) - 10000,
          depth, frame: Math.floor(r() * 12), scale: r() * 0.5 + 1, startX: x,
        };
      }
      this.meteors.sort((a, b) => b.depth - a.depth);
    } else if (fam === 'stardust') {
      // StardustSky.Activate :124-145
      const maxTilesX = this.maxTilesX, surfacePx = this.surfacePx;
      const N1 = 200, N2 = 10;
      this.stars = new Array(N1 * N2);
      for (let i = 0; i < N1; i++) {
        for (let j = 0; j < N2; j++) {
          this.stars[i * N2 + j] = {
            x: (i / N1) * maxTilesX * 16,
            y: (j / N2) * (surfacePx + 2000) - 1000,
            depth: r() * 8 + 1.5,
            tex: Math.floor(r() * 2),
            off: r() * 6.28, amp: r() * 5, freq: r() + 1,
          };
        }
      }
      this.stars.sort((a, b) => b.depth - a.depth);
    } else {
      // VortexSky.Activate :131-139
      this.bolts = new Array(500);
      for (let i = 0; i < 500; i++) this.bolts[i] = { x: 0, y: 0, depth: 0, life: 0, alive: false };
      this.boltTimer = 0;
    }
  }

  /** Activate 所需世界尺寸（generate 前由调用方注入） */
  maxTilesX = 4200;
  surfacePx = 4800;

  /** Update（各 Sky.Update :47-67 通用淡入淡出 + Solar 流星下坠/Vortex 落雷计时） */
  update(fam: TowerFamily, dtMs: number): void {
    const frames = dtMs / (1000 / 60);
    this.time = globalTimeWrappedHourly();   // ★BJ330：GTW 单源（原本地 dt 累计——绘制帧率依赖且暂停不冻结;今=Main.TotalGameTime 等价,星尘闪烁/星云落石相位与全局同钟）
    this.fade = this.active
      ? Math.min(1, 0.01 * frames + this.fade)
      : Math.max(0, this.fade - 0.01 * frames);
    if (fam === 'solar' && this.fade > 0.001) {
      // SolarSky.Update :56-66：1200px/s 斜向下坠，落过地表线回顶
      const dtSec = dtMs / 1000;
      for (const m of this.meteors) {
        m.x -= 1200 * dtSec;
        m.y += 1200 * dtSec;
        if (m.y > this.surfacePx) { m.x = m.startX; m.y = -10000; }
      }
    } else if (fam === 'vortex' && this.fade > 0.001) {
      // VortexSky.Update :59-83
      this.boltTimer -= frames;
      if (this.boltTimer <= 0) {
        this.boltTimer = 1 + Math.floor(Math.random() * 4);        // Next(1,5)
        let slot = this.bolts.findIndex((b) => !b.alive);
        if (slot < 0) slot = this.bolts.length - 1;
        this.bolts[slot] = {
          x: Math.random() * (this.maxTilesX * 16 + 4000) - 2000,
          y: Math.random() * 500,
          depth: Math.random() * 8 + 2,
          life: 30, alive: true,
        };
      }
      for (const b of this.bolts) {
        if (!b.alive) continue;
        if (--b.life <= 0) b.alive = false;
      }
    }
  }

  /** Draw（各 Sky.Draw 1:1）：黑幕 + 背景带 + 行星（远景段）→ 族专属实体（视差段） */
  draw(ctx: CanvasRenderingContext2D, fam: TowerFamily, viewW: number, viewH: number,
    screenX: number, screenY: number, maxTilesX: number, surfacePx: number): void {
    if (this.fade <= 0.001) return;                                  // IsActive 语义
    this.maxTilesX = maxTilesX;
    this.surfacePx = surfacePx;
    // ---- 远景段（maxDepth==MaxValue 分支，各族同构 :66-73/:76-83/:71-78/:93-100）----
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${this.fade.toFixed(4)})`;           // BlackTile × fade
    ctx.fillRect(0, 0, viewW, viewH);
    const bg = this.tex(fam, 'Background');
    if (bg && (bg.width > 0) && bg.width) {
      // :69 背景带竖向偏移 + :69 alpha = min(1,(screenY-800)/1000)×fade
      const y = Math.max(0, (surfacePx - screenY - 2400) * 0.1);
      ctx.globalAlpha = Math.max(0, Math.min(1, (screenY - 800) / 1000)) * this.fade;
      ctx.drawImage(bg, 0, y, viewW, viewH);
    }
    const planet = this.tex(fam, 'Planet');
    if (planet && (planet.width > 0) && planet.width) {
      // :70-72 屏中心 + (-200,-200) + 0.01×(maxTilesX*8 − screenX, worldSurface/2 − screenY)
      const px = viewW / 2 - 200 + 0.01 * (maxTilesX * 8 - screenX);
      const py = viewH / 2 - 200 + 0.01 * (surfacePx / 16 / 2 - screenY);
      ctx.globalAlpha = 0.9 * this.fade;
      ctx.drawImage(planet, px - planet.width / 2, py - planet.height / 2);
    }
    // ---- 族专属实体段（:74-113/:84-117/:79-114/:101-123）----
    const num3 = Math.max(0, Math.min(1, (screenY - 1000) / 1000)); // 高度门 alpha
    const camCX = screenX + viewW / 2, camCY = screenY + viewH / 2; // vector3
    const inRect = (x: number, y: number) =>
      x > -1000 && x < viewW + 1000 && y > -1000 && y < viewH + 1000;
    const project = (x: number, y: number, depth: number, sy: number): [number, number] => {
      const px = (x - camCX) / depth + camCX - screenX;
      const py = (y - camCY) * sy / depth + camCY - screenY;
      return [px, py];
    };
    ctx.imageSmoothingEnabled = true;
    if (fam === 'nebula') {
      for (let j = 0; j < this.pillars.length; j++) {
        const p = this.pillars[j];
        const [px, py] = project(p.x, p.y, p.depth, 0.9);
        if (!inRect(px, py)) continue;
        const num4 = (1 / p.depth) * 450;                            // :103
        const beam = this.tex(fam, 'Beam');
        if (beam && (beam.width > 0) && beam.width) {
          // :104 原点 (0,0)，scale=(num4/70, num4/45)，alpha 0.2×num3×fade
          ctx.globalAlpha = 0.2 * num3 * this.fade;
          ctx.drawImage(beam, px, py, num4, beam.height * (num4 / 45));
        }
        // :105-111 每 0.03 一颗落石（34 颗/柱），num7=1−(phase%1) 驱动纵落/旋转/亮度
        for (let k = 0, rockIdx = 0; k <= 1.0001; k += 0.03, rockIdx++) {
          const num6 = k;
          const num7 = 1 - ((num6 + this.time * 0.02 + Math.sin(j)) % 1);
          const rock = this.tex(fam, `Rock${rockIdx % 3}`);
          if (!rock || !(rock.width > 0) || !rock.width) continue;
          const rx = px + Math.sin(num6 * 1582) * (num4 * 0.5) + num4 * 0.5;
          const ry = py + num7 * 2000;
          ctx.save();
          ctx.globalAlpha = num7 * num3 * this.fade;
          ctx.translate(rx, ry);
          ctx.rotate(num7 * 20);
          ctx.drawImage(rock, -rock.width * 0.9 / 2, -rock.height * 0.9 / 2,
            rock.width * 0.9, rock.height * 0.9);
          ctx.restore();
        }
      }
    } else if (fam === 'solar') {
      for (const m of this.meteors) {
        const [px, py] = project(m.x, m.y, m.depth, 0.9);
        if (!inRect(px, py)) continue;
        const tex = this.tex(fam, 'Meteor');
        if (!tex || !(tex.width > 0) || !tex.width) continue;
        const frame = Math.floor(m.frame / 3);                        // :110
        m.frame = (m.frame + 1) % 12;                                 // :111（Draw 内推进）
        const fh = tex.height / 4;
        const s = (1 / m.depth) * 5 * m.scale;                        // :114
        ctx.globalAlpha = num3 * this.fade;
        ctx.drawImage(tex, 0, frame * fh, tex.width, fh, px, py,
          tex.width * s, fh * s);
      }
    } else if (fam === 'stardust') {
      for (const s of this.stars) {
        const [px, py] = project(s.x, s.y, s.depth, 1.1);             // :103 星尘垂直视差 1.1
        if (!inRect(px, py)) continue;
        const tex = this.tex(fam, s.tex === 0 ? 'Star0' : 'Star1');
        if (!tex || !(tex.width > 0) || !tex.width) continue;
        // :107-109 双正弦亮度
        let value = Math.sin(s.freq * this.time + s.off) * s.amp + s.amp;
        const num4 = Math.sin(s.freq * this.time * 5 + s.off) * 0.1 - 0.1;
        value = Math.max(0, Math.min(1, value));
        const a = num3 * value * 0.8 * (1 - num4) * this.fade;        // :111
        if (a <= 0.01) continue;
        const scale = ((1 / s.depth) * 0.5 + 0.5) * (value * 0.3 + 0.7);
        ctx.globalAlpha = a;
        ctx.drawImage(tex, px - tex.width * scale / 2, py - tex.height * scale / 2,
          tex.width * scale, tex.height * scale);
      }
    } else {
      for (const b of this.bolts) {
        if (!b.alive) continue;
        const [px, py] = project(b.x, b.y, b.depth, 0.9);
        if (!inRect(px, py)) continue;
        const flash = b.life > 26 && b.life % 2 === 0;                // :115-119
        const tex = this.tex(fam, flash ? 'Flash' : 'Bolt');
        if (!tex || !(tex.width > 0) || !tex.width) continue;
        const a = num3 * (b.life / 30) * this.fade;                   // :121
        const s = (1 / b.depth) * 5;                                  // :121
        ctx.globalAlpha = a;
        ctx.drawImage(tex, px, py, tex.width * s, tex.height * s);
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

// ================= 月总死亡戏剧件（MoonlordDeathDrama.cs :12-146） =================

type DramaPieceKind = 'spine' | 'shoulder' | 'torso' | 'head' | 'explosion';

const DRAMA_TEX_FILE: Record<DramaPieceKind, string> = {
  spine: 'Misc_MoonExplosion_Spine.png',
  shoulder: 'Misc_MoonExplosion_Shoulder.png',
  torso: 'Misc_MoonExplosion_Torso.png',
  head: 'Misc_MoonExplosion_Head.png',
  explosion: 'Misc_MoonExplosion_Explosion.png',
};

const dramaTexCache = new Map<DramaPieceKind, ImageBitmap | HTMLImageElement>();
function dramaTex(kind: DramaPieceKind): ImageBitmap | HTMLImageElement | null {
  if (typeof Image === 'undefined') return null;
  let t = dramaTexCache.get(kind);
  if (!t) {
    const im = new Image();
    im.onload = () => upgradeToBitmap(im, (b) => dramaTexCache.set(kind, b));  // bitmap-only(trace⑨ 窗口期)
    im.src = `sprites/vanilla/${DRAMA_TEX_FILE[kind]}`;
    return null;
  }
  return t;
}

/** MoonlordPiece（:12-87）：重力 0.3 + 角速度衰减 0.99 + 出界判死 */
class DramaPiece {
  rot = 0;
  dead = false;
  constructor(
    readonly kind: DramaPieceKind,
    public x: number, public y: number,
    public vx: number, public vy: number,
    readonly ox: number, readonly oy: number,   // 贴图 origin（:235-241 显式值）
    public rotV: number,
  ) {}
  update(maxTilesX: number, maxTilesY: number): void {
    this.vy += 0.3;                              // :50
    this.rot += this.rotV;                       // :51
    this.rotV *= 0.99;                           // :52
    this.x += this.vx; this.y += this.vy;        // :53
    if (this.y > maxTilesY * 16 - 480 || this.x < 480 || this.x >= maxTilesX * 16 - 480) {
      this.dead = true;                          // :26-36
    }
  }
}

/** MoonlordExplosion（:89-146）：7 帧竖条，帧速 2-4，恒 (255,255,255,127) */
class DramaExplosion {
  counter = 0;
  dead = false;
  constructor(public x: number, public y: number, readonly speed: number) {}
  update(): void {
    this.counter++;                              // :127
    if (this.counter >= this.speed * 7) this.dead = true;   // :103-113
  }
}

/** MoonlordDeathDrama.ThrowPieces（:231-242）的种子 RNG：原版 `new UnifiedRandom(DramaSeed)`
 *  + `r.NextFloat()`×8（每件散射角+角速度各一次，顺序 = spine/shoulder/torso/head）。
 *  NextFloat = (float)NextDouble()（Utils.cs:1201-1204）→ Math.fround 镜像 C# double→float
 *  收缩；后续 float 算术（×(π/2)−π/4+π / ×6..12 / ×0.1−0.05）逐运算 fround = 位级同源。
 *  （原近似实现非 .NET 位级，已退役——见 git 历史。） */
const F_PI_2 = Math.fround(Math.PI / 2);
const F_PI_4 = Math.fround(Math.PI / 4);
/** 单件散射参数（angle = UnitY.RotatedBy 的弧度、rotV = 角速度）——纯函数供测试对拍 */
export function moonlordThrowSeq(seed: number): Array<{ angle: number; rotV: number }> {
  const rng = new UnifiedRandom(seed);
  const nextFloat = () => Math.fround(rng.nextDouble());          // (float)NextDouble
  const out: Array<{ angle: number; rotV: number }> = [];
  for (let i = 0; i < 4; i++) {
    const angle = Math.fround(
      Math.fround(Math.fround(Math.fround(nextFloat()) * F_PI_2) - F_PI_4) + Math.PI);
    const rotV = Math.fround(Math.fround(Math.fround(nextFloat()) * 0.1) - 0.05);
    out.push({ angle, rotV });
  }
  return out;
}

// ================= 晨昏耀斑贴图（Misc/Sunflare/*） =================

type SunflareTex = 'flare1' | 'flare2' | 'bokeh' | 'spectra' | 'pointblurry' | 'pointsharp' | 'colorgradient' | 'colorgradientdither';

const SUNFLARE_TEX_FILE: Record<SunflareTex, string> = {
  flare1: 'Misc_Sunflare_flare1.png',
  flare2: 'Misc_Sunflare_flare2.png',
  bokeh: 'Misc_Sunflare_Lens_Flare1.png',
  spectra: 'Misc_Sunflare_Lens_Flare2.png',
  pointblurry: 'Misc_Sunflare_Lens_PointBlurry.png',
  pointsharp: 'Misc_Sunflare_Lens_PointSharp.png',
  colorgradient: 'Misc_Sunflare_colorgradient.png',
  colorgradientdither: 'Misc_Sunflare_colorgradientdither.png',
};

/** ★gladd 面④（2026-10-28,task#22）：镜头光斑元素四边形（2D/GL 双消费单源收集器
 *  collectLensFlare 的产物；GL 侧=Renderer.drawWorldFxGL quadBatchRgba 仿射角点）。 */
export interface FlareQuad {
  /** tintedFlareSprite 缓存画布（内容=tex×rgb×α-from-luminance；池化回收可重写） */
  sprite: HTMLCanvasElement;
  /** tint 缓存键（texId|rgb）——GL 纹理键纪律用（画布对象可被池回收重写） */
  tintKey: string;
  /** 设备坐标（2D translate 锚=元素中心） */
  x: number; y: number;
  /** 目标尺寸（tex.width×scale） */
  w: number; h: number;
  /** 旋转弧度（baseRot+行 Rotation） */
  rot: number;
  /** min(1,a)——2D globalAlpha；GL 侧进 vCol.rgb（α=0 纯加习语） */
  alpha: number;
}

/** 镜头元素乘色缓存（lighter 叠加前先 multiply 着色——LensFlareElement.Color :422 等） */
const flareTintCache = new Map<string, HTMLCanvasElement>();
/** ★flare 淘汰画布池（2026-10-12 同 tintTex 池判例）：晨昏 sunDim/occlusion 漂移
 *  → 精确色键连续 miss → createElement+bake（含 getImageData 读回=满载管线上
 *  ms 级,120440 判例）churn——淘汰画布按尺寸回收复用,杀分配杀 churn;烘焙频率
 *  (=miss 率)与视觉语义零改动。 */
const flareTintFree: HTMLCanvasElement[] = [];
function tintedFlareSprite(tex: ImageBitmap | HTMLImageElement, r: number, g: number, b: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  // ★半加载窗守卫（2026-08-24 方片竞态）：元数据已到（width>0）但主体未完时
  //  drawImage 画不出内容——不守卫会把平色矩形烘进下方缓存永久复用（用户实报
  //  "光斑变方片,刷新自愈"）。未就绪本帧跳过,就绪后自然重烘。
  if (!texReady(tex)) return null;
  const key = `${texId(tex)}|${r},${g},${b}`;
  const hit = flareTintCache.get(key);
  if (hit) return hit;
  let c = flareTintFree.pop();
  let pooledF = false;
  if (!c) c = document.createElement('canvas');
  else pooledF = true;
  if (c.width !== tex.width || c.height !== tex.height) { c.width = tex.width; c.height = tex.height; }
  c.getContext('2d')!.clearRect(0, 0, c.width, c.height);   // ★池取必清（混帧回归同判例）
  const cx = c.getContext('2d', { willReadFrequently: true })!;
  cx.imageSmoothingEnabled = true;
  cx.drawImage(tex, 0, 0);
  cx.globalCompositeOperation = 'multiply';
  cx.fillStyle = `rgb(${r},${g},${b})`;
  cx.fillRect(0, 0, c.width, c.height);
  cx.globalCompositeOperation = 'destination-in';
  cx.drawImage(tex, 0, 0);
  // ★α 从亮度推导（2026-08-21 方片终案）：Sunflare 贴图 α 全 255（像素实测）——
  // 原版是加性后处理 shader（final=texel.rgb×color×occlusion，【不采样 α】，
  // 黑背景加性=不可见）；canvas drawImage+lighter 下黑背景不透明=巨大"方片"
  // （用户三份报告）。加性语义的 canvas 等价：α=max(rgb)（黑=透明，亮=不透明），
  // lighter 只加 RGB 与原版逐位等价。逐像素一次烘焙进缓存，运行时零开销。
  // ★平色拒烘（2026-08-24 竞态第二道闸）：全图 max(rgb) 恒定 = 贴图根本没画上
  //  （半加载残余/解码失败）——真实光斑贴图全是径向渐变必有 0..255 方差,平色
  //  一律弃（不入缓存返回 null,下帧重试）
  const img = cx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  let mMin = 255, mMax = 0;
  for (let i = 0; i < d.length; i += 4) {
    const m = d[i] > d[i + 1] ? (d[i] > d[i + 2] ? d[i] : d[i + 2]) : (d[i + 1] > d[i + 2] ? d[i + 1] : d[i + 2]);
    d[i + 3] = m;
    if (m < mMin) mMin = m;
    if (m > mMax) mMax = m;
  }
  if (mMin === mMax) return null;
  cx.putImageData(img, 0, 0);
  if (pooledF) bumpTexEpoch(c);   // ★shim er: 键换代（池取重烘铁律）
  flareTintCache.set(key, c);
  if (flareTintCache.size > 24) {
    const first = flareTintCache.keys().next().value;
    if (first !== undefined) {
      const ev = flareTintCache.get(first);
      flareTintCache.delete(first);
      if (ev && ev.width > 0 && flareTintFree.length < 16) flareTintFree.push(ev);   // ★池化：淘汰入池
    }
  }
  return c;
}

/** 帧数据挂点（Renderer.render 每帧一行注入 sky.frameCtx；结构化类型避免反向依赖）。
 *  消费：月塔天空近距门 / 月总死亡戏剧 / 稀有云世界旗标 / AmbientSky zone 门 /
 *  涟漪水面采样。null = 未注入（菜单等），各子系统自静默。 */
export interface SkyFrameCtx {
  /** Game.paused（Main.gamePaused，:17144 CanPauseGame→return——云/星更新整体冻结门）。
   *  可选 = 菜单态 frameCtx 省略（undefined 视为未暂停,与原版菜单云照常漂一致） */
  paused?: boolean;
  /** 场上实体（月塔 493/422/507/517 与月总 398 扫描用；vanillaId/ai0/ai1 为 Enemy
   *  侧字段——可选以兼容 Entity 基类条目，消费侧以 !== 严格比对自然跳过缺省值） */
  entities: ReadonlyArray<{
    vanillaId?: number | null; cx: number; cy: number;
    ai0?: number; ai1?: number; dead: boolean;
  }>;
  world: {
    w: number; h: number;
    /** groundLevel（tile）——与 fx.surfaceY 同源（px = ×16） */
    groundLevel: number;
    /** 地狱顶（tile；= UnderworldLayer，0 缺省时以 h-200 回退） */
    lavaLine: number;
    crimson: boolean;
    /** 入侵类型（World.invasionType 结构透传；4 = 火星——MartianSky 激活门
     *  Main.cs:58757-58763 invasionType==4 轮询） */
    invasionType?: number;
    flags: Record<string, boolean>;
    /** Main.dayRate(星空 fadeIn/坠星推进用,缺省 1) */
    dayRate?: () => number;
    /** 彩蛋种子旗标（SeedEasterEggs.parseSeed；稀有云门 theConstant/tenthAnniversary,
     *  CloudsEnd 月色/背景云累积器门 drunkWorld；★IIIII224 remix=太阳短路/星星恒画） */
    seedFlags?: { theConstant?: boolean; tenthAnniversary?: boolean; drunkWorld?: boolean; remix?: boolean };
    store: {
      inBounds(x: number, y: number): boolean;
      isSolid(x: number, y: number): boolean;
      idx(x: number, y: number): number;
      liquid: ArrayLike<number>;
    };
  } | null;
  scene: {
    zoneDesert: boolean; zoneBeach: boolean; zoneJungle: boolean;
    zoneCorrupt: boolean; zoneCrimson: boolean; zoneHallow: boolean;
    /** SceneMetrics 派生位（结构透传）：ZoneRain = raining && SurfaceAtmospherics
     *  （SceneMetrics.cs:700）/ ZoneSnow（:682）——暴风雪色罩双门
     *  （SceneState.cs:102 flag = ZoneRain && ZoneSnow）与 AuroraSky 同源 */
    zoneRain?: boolean; zoneSnow?: boolean; zoneSandstorm?: boolean;
    /** 群系光照影响(Game 每 tick 平滑写入;日月绘制色 SetBackColor 群系块消费) */
    biomeLightInfluence?: {
      corrupt: number; crimson: number; jungle: number; mushroom: number; graveyard: number;
    };
  } | null;
  player: {
    cx: number; cy: number; vx?: number;
    /** 阳光炽灼蓄能（Player.cs:2228；0-300）——drawLensFlare AdjustIntensity 的
     *  sunScorchCounter 分支（NextHorizonRenderer.cs:398-406）消费 */
    sunScorchCounter?: number;
    /** player.head 语义头槽号（Player.cs:25336/:35315-35322 时装优先）——太阳分支
     *  head==12（物品 237 太阳镜）→ Sun2 骷髅头太阳（Main.cs:62365） */
    headArmorSlot?: number;
    /** AdvancedShadows 位置历史环（Player.cs:4123-4141；[len−1]=最新）——耀斑
     *  元素布点公式的玩家残影项（LensFlareElement.cs:34-37）消费 */
    advancedShadows?: ReadonlyArray<{ x: number; y: number }>;
  } | null;
  clock: { dayCount: number; timeOfDay: number; isDay: boolean } | null;
  camX: number; camY: number; z: number; viewW: number; viewH: number;
  /** Main.bgAlphaFrontLayer[4]（海洋群系前景层渐变，BiomeBackground.frontLayer()[4]
   *  注入）——Cloud.Update :401 海滩杀云门（==1 且 y>200 → 低云 5× 快速淡出） */
  oceanFrontAlpha?: number;
}

/** AdjustIntensity（NextHorizonRenderer.cs:393-408 一比一，纯函数供测试）：
 *  常态 intensity = (temporal×celestial)³；sunScorchCounter>0（吸血鬼种子阳光
 *  炽灼,Player.cs:2228）时**整体替换**为 lerp(0,300,counter) 的 1−(1−lerp)² 曲线
 *  （counter=300 → 1；150 → 0.75；1 → ≈0.0067），再 ×celestial ×5（正午耀斑
 *  放大 5 倍的"阳光灼眼"档）。counter 透传链：Player.updateSunScorchValues →
 *  Renderer.render frameCtx.player.sunScorchCounter → drawLensFlare。 */
export function adjustFlareIntensity(temporalIntensity: number, celestialVisibility: number,
  sunScorchCounter: number): number {
  let num = temporalIntensity;                          // :395
  num *= celestialVisibility;                           // :396
  num *= num * num;                                     // :397 → (t·c)³
  if (sunScorchCounter > 0) {                           // :399
    let lerpValue = lerpValueClamped(0, 300, sunScorchCounter);   // :401 GetLerpValue(clamped)
    lerpValue = 1 - lerpValue;                          // :402
    num = 1 - lerpValue * lerpValue;                    // :403
    num *= celestialVisibility;                         // :404
    num *= 5;                                           // :405
  }
  return num;
}

/** Main.cs:62415-62416：sunModY/moonModY = (short)(modY × 0.999)——double→short
 *  截断向零（C# 显式转换语义）+ int16 回卷；纯函数供测试。 */
export function decayCelestialModY(modY: number): number {
  const t = Math.trunc(modY * 0.999);
  return (t << 16) >> 16;       // 截断值取低 16 位按符号扩展（unchecked short 强转）
}

/** LensFlareElement.Draw :34-37 玩家残影项（纯函数供测试）：最近 0 帧 vs
 *  min(4, count−1) 帧前位置差 v（世界坐标），在"太阳→屏心"屏向单位轴上的投影 ×|v|。
 *  count≤1 → v=(0,0) → 恒 0（SafeNormalize(UnitX)·|v|=0）；本仓残影环
 *  Player.advancedShadows 尾插 ≤31 项（[len−1]=最新，对应原版 _advancedShadows
 *  环的 GetAdvancedShadow(0)，Player.cs:4123-4131），60/31 环深差不影响
 *  min(4,·) 取样。该系统 = 移动残影（Starboard 彩虹拖尾/鱼龙坐骑尾迹等
 *  PlayerDrawLayers :2711+ 消费），非 shadowDodge 躲闪。 */
export function flareShadowTerm(shadows: ReadonlyArray<{ x: number; y: number }> | undefined,
  sunX: number, sunY: number, cx: number, cy: number): number {
  const arr = shadows;
  const n = arr?.length ?? 0;
  if (!arr || n <= 1) return 0;
  const newest = arr[n - 1];
  const older = arr[n - 1 - Math.min(4, n - 1)];        // :36 GetAdvancedShadow(Math.Min(4, count−1))
  let vx = newest.x - older.x, vy = newest.y - older.y;
  const vLen = Math.hypot(vx, vy);
  if (vLen === 0) { vx = 1; vy = 0; }                   // :37 v.SafeNormalize(Vector2.UnitX)
  else { vx /= vLen; vy /= vLen; }
  let dx = sunX - cx, dy = sunY - cy;
  const dLen = Math.hypot(dx, dy);
  if (dLen === 0) { dx = 0; dy = -1; }                  // (sun−center).SafeNormalize(−UnitY)
  else { dx /= dLen; dy /= dLen; }
  return (vx * dx + vy * dy) * vLen;                    // :37 Dot(...) × v.Length()
}

// ================= HorizonClouds（PixelShader.cso obj62 逐指令;SM2 解释器核验） =================
// 1.4.5.6 云晨昏染色的【唯一活路径】= CloudsEnd(NextHorizonRenderer.cs:328-361)把三通道
// 全部云 DrawData 经 MiscShaderData["HorizonClouds"](DyeInitializer.cs:440)逐像素着色。
// C# 侧 BetterColorsForClouds(:270-312 的"按高度沿 SunGradients 渐变")是【私有死代码】
// (全工程零调用)——"云按高度沿梯度染色"在 1.4.5.6 不存在,真值以字节码为准。
//
// 公式（指令号 = fxPixel.txt obj62 反汇编序;SM2 解释器执行同探针逐值核对,锚见
// tests/fx-pixelshader-parity.test.ts）:
//   采样: up(0,−0.035) dn(0,+0.14) lf(−0.035,0) rt(+0.035,0) 中(t0)      #10-18
//   coverage  = 1 − 0.2·Σα₅                                             #19-23
//   thickness = 1 − 4·sat(C.r − 0.62)                                    #24-26(★#25 _sat)
//   A = max(thickness, coverage)                                         #27
//   n1 = normalize(frag−云中心) n2 = normalize(天体−frag) d=|天体−frag|  #28-36
//   B = max(dot(n1,n2), 1−(d/60)²)                                       #37-40
//   R = |t0·2−1|                                                          #41-44
//   distTerm = d≤50 ? d/50−1 : 0   ← #51 的第三源 = c3.x=0(非 c3.z=1!)    #48+51
//   inner = sat(B·R−0.05)·A + 0.6·A + B·R − 0.3 + distTerm               #45-53
//           (★#45 _sat 钳 BR−0.05;#52 乘 A 非 B)
//   D = max(0.3, 1.3 − d/1800)                                            #49-50
//   shade = sat(inner·intensity)·D³                                       #54-57(★#57 _sat)
//   r2 = tex·vColor; r1 = lerp(vColor, (uColor,1), 0.5)·tex.a             #58-62
//   out = r2 + shade·(r1·vColor.a − r2)                                   #63-65
//   (★三处 sat = 2026-08-24 r15 _sat 判据修复后字节码实证;此前镜像按无钳旧
//    解释器校准,密核 texR>0.87/BR>1.05/inner·intensity>1 三域偏差)

/** HorizonHelper.cs:28-36 MoonColors（moonType 0-8;夜 uColor = 表×GetMoonStrength） */
export const MOON_COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [230, 235, 255], [250, 235, 160], [230, 255, 230], [160, 240, 255], [180, 255, 255],
  [230, 255, 230], [255, 180, 255], [255, 200, 180], [225, 180, 255],
];

/** HorizonClouds 逐像素 shade（纯函数;GLSL CLOUD_FRAG_SRC 的 JS 镜像,测试金标源）。
 *  texSumA = 五采样 α 和(0-5);texR = 中心采样 R 通道(0-1);
 *  fragX/Y = 画布像素位;drawX/Y = 云中心;celX/Y = 天体位;intensity = CloudsEnd num。 */
export function horizonCloudShade(
  texSumA: number, texR: number,
  fragX: number, fragY: number, drawX: number, drawY: number,
  celX: number, celY: number, uvX: number, uvY: number, intensity: number,
): number {
  const sat01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
  const coverage = 1 - 0.2 * texSumA;
  const thickness = 1 - 4 * sat01(texR - 0.62);              // #25 mul r0.y_sat
  const A = Math.max(thickness, coverage);
  let d1x = fragX - drawX, d1y = fragY - drawY;
  const l1 = Math.hypot(d1x, d1y);
  if (l1 > 0) { d1x /= l1; d1y /= l1; } else { d1x = 0; d1y = 0; }
  const d2x = celX - fragX, d2y = celY - fragY;
  const dist = Math.hypot(d2x, d2y);
  const n2x = dist > 0 ? d2x / dist : 0, n2y = dist > 0 ? d2y / dist : 0;
  const B = Math.max(d1x * n2x + d1y * n2y, 1 - (dist / 60) ** 2);
  const R = Math.hypot(uvX * 2 - 1, uvY * 2 - 1);
  const distTerm = dist <= 50 ? dist / 50 - 1 : 0;
  const inner = sat01(B * R - 0.05) * A + 0.6 * A + B * R - 0.3 + distTerm;  // #45 mad r0.x_sat
  const D = Math.max(0.3, 1.3 - dist / 1800);
  return sat01(inner * intensity) * D * D * D;               // #57 mul r0.x_sat
}

/** 2D 兜底单探针近似（GL 主路径逐像素精确;此处 Canvas2D 无逐像素通道）:
 *  探针 = 云中心沿天体向 0.3·max(w,h)(几何上 shade 峰值区=云朝阳侧边缘),
 *  uv=(0.65,0.65) → R≈0.42;A 取 0.4(texSumA=3 → coverage 0.4,texR=1 → 密核
 *  thickness 负;密核 0/疏缘 1 的面积折中)。B/D/dist/强度精确。
 *  【取舍登记】B·R 与 A 的逐纹素耦合不可分解——GL 主路径逐像素精确,兜底只
 *  保证整朵染色量级/方向;shade 含正负,负值使整朵轻微偏离天体色(原语义)。 */
export function horizonCloudShadeApprox(
  cel: { posX: number; posY: number; intensity: number },
  cx: number, cy: number, w: number, h: number, probeDist: number,
): number {
  void w; void h;
  let n1x = cel.posX - cx, n1y = cel.posY - cy;
  const nl = Math.hypot(n1x, n1y);
  if (nl > 0) { n1x /= nl; n1y /= nl; } else { n1x = 1; n1y = 0; }
  const fragX = cx + n1x * probeDist, fragY = cy + n1y * probeDist;
  return horizonCloudShade(
    3, 1,                              // texSumA=3 → coverage 0.4(A 折中);texR=1
    fragX, fragY, cx, cy, cel.posX, cel.posY,
    0.65, 0.65,                        // uv → R = |0.3,0.3| ≈ 0.424
    cel.intensity,
  );
}

/** Main.atmo（海拔大气系数，SkyRenderer.atmoValue 的纯函数化——BiomeBackground
 *  cloudBG 大云图层（Main.cs:58787-58871 num5=ProcessCloudAlpha()×atmo）共用） */
export function atmoOf(camY: number, worldW: number, surfaceY: number): number {
  return Math.max(0, Math.min(1,
    (camY / 16 - (65 + 10 * (worldW / 4200) ** 2)) / Math.max(1, surfaceY / 16 / 5)));
}

// ================= 沙尘暴/暴风雪全屏色罩（SandstormSky.cs / BlizzardSky.cs 1:1） =================
// 原版是 SkyManager 自定义天空层（ScreenEffectInitializer.cs:71-72 注册）：Draw
// (SandstormSky.cs:49-60 / BlizzardSky.cs:48-60) 以 MagicPixel 全屏 alpha 混合一张
// 色罩,强度驱动与 SceneState.cs:177-181 的滤镜链同源（Severity / cloudAlpha）。
// 本仓载体 = GLScreenFilters 的 SkyWeatherTint pass（滤镜链头——天空层在 FilterManager
// EndCapture 之下）+ 2D fillRect 兜底（source-over = XNA AlphaBlend 同式）。

/** Blizzard 激活门（SceneState.cs:102/120 一比一,纯函数供测试）：
 *  flag = metrics.ZoneRain && metrics.ZoneSnow;ManageSpecialBiomeVisuals("Blizzard",
 *  Main.UseStormEffects && flag)——UseStormEffects（Main.cs:407 默认 true,设置项
 *  「风暴效果」）本仓未接设置面,恒 true。 */
export function blizzardSkyGate(zoneRain: boolean, zoneSnow: boolean): boolean {
  return zoneRain && zoneSnow;
}

/** Sandstorm 激活门（Sandstorm.ShowSandstormVisuals Sandstorm.cs:132-139 的本仓
 *  等价门,与 Game.weatherHooks.sandstormVisuals 同源）：
 *  Happening && 沙漠带 && bgDelay<50（背景样式切换缓冲 <50 帧 → 玩家在地表带内
 *  近似 = 玩家 tileY < groundLevel+30）。 */
export function sandstormSkyGate(
  happening: boolean, zoneDesert: boolean, playerTileY: number, groundLevel: number,
): boolean {
  return happening && zoneDesert && playerTileY < groundLevel + 30;
}

/** SandstormSky.Draw :53-55 色罩参数（纯函数,0-1 浮点供测试与 GL/2D 双路径）：
 *  num = min(1, Severity×1.5);color = Vector4(0.85,0.66,0.33,1)×0.8×cots ×opacity×num
 *  ——★XNA 此处四通道【全乘】opacity×num（rgb 与 α 同时缩放）,AlphaBlend 再以
 *  src.rgb×src.a 合成 → 有效叠加量 ∝ (opacity×num)²,逐字照抄。 */
export function sandstormSkyTint(
  severity: number, opacity: number, cots: readonly [number, number, number],
): { color: [number, number, number]; alpha: number } {
  const k = Math.min(1, severity * 1.5) * opacity;
  const cr = cots[0] / 255, cg = cots[1] / 255, cb = cots[2] / 255;
  return { color: [0.85 * 0.8 * cr * k, 0.66 * 0.8 * cg * k, 0.33 * 0.8 * cb * k], alpha: 1 * 0.8 * k };
}

/** BlizzardSky.Draw :52-54 色罩参数（纯函数）：num = min(1, cloudAlpha×2);
 *  color = Vector4(1)×cots ×opacity×0.7×num（同样四通道全乘）。 */
export function blizzardSkyTint(
  cloudAlpha: number, opacity: number, cots: readonly [number, number, number],
): { color: [number, number, number]; alpha: number } {
  const k = Math.min(1, cloudAlpha * 2) * opacity;
  const cr = cots[0] / 255, cg = cots[1] / 255, cb = cots[2] / 255;
  return { color: [cr * 0.7 * k, cg * 0.7 * k, cb * 0.7 * k], alpha: 1 * 0.7 * k };
}

export class SkyRenderer {
  // ---- 原版星空(Star.cs + Main.DrawStarsInBackground :62467-62606,2026-08-20
  //      全量 1:1 替换方块近似)----
  private stars: SkyStar[] = [];
  private numStars = 0;
  private starTexs: Array<ImageBitmap | HTMLImageElement | null> = new Array(4).fill(null);
  /** 星绘制矩阵折叠(2026-08-24):base × translate(x,y) × rotate(rot) × scale(sc)
   *  一次 setTransform 完成——替代 save/translate/rotate(/scale)/restore 状态机往返 */
  private starXform(
    ctx: CanvasRenderingContext2D, bt: DOMMatrix,
    cs: number, sn: number, sc: number, x: number, y: number,
  ): void {
    const a = cs * sc, b = sn * sc;
    ctx.setTransform(
      bt.a * a - bt.b * b, bt.a * b + bt.b * a,
      bt.c * a - bt.d * b, bt.c * b + bt.d * a,
      bt.e + bt.a * x + bt.c * y, bt.f + bt.b * x + bt.d * y,
    );
  }
  /** Star.SpawnStars(:86-135):数量 200-400(FastRandom 随机种子=每次进图重掷),
   *  位置 X Next(1921)/Y Next(1201)、type Next(0,4)、1/40 概率 scale×2+速度减半 */
  private spawnStar(s: number): void {
    const R = () => Math.random();
    const next = (min: number, max?: number) => max === undefined
      ? Math.floor(R() * min) : min + Math.floor(R() * (max - min));
    const rot = next(628) * 0.01;
    const star: SkyStar = {
      x: next(1921), y: next(1201),
      rot,
      scale: next(70, 130) * 0.006,
      type: next(0, 4),
      twinkle: next(60, 101) * 0.01,
      twSpeed: next(30, 110) * 0.0001,
      rotSpeed: next(5, 50) * 0.0001,
      falling: false, hidden: false, fvx: 0, fvy: 0, fallTime: 0, fadeIn: 0,
      // ★liqpolish:cs/sn 更新侧缓存（draw 侧 trig 外提;值=Math.cos/sin(rot) 逐位同,
      //  rot 全部写点同步重算——见 updateStar）
      cs: Math.cos(rot), sn: Math.sin(rot), csRot: rot,
    };
    if (next(2) === 0) star.twSpeed *= -1;
    if (next(2) === 0) star.rotSpeed *= -1;
    if (next(40) === 0) { star.scale *= 2; star.twSpeed /= 2; star.rotSpeed /= 2; }
    if (s >= 0) this.stars[s] = star; else this.stars.push(star);
  }
  /** SpawnStars(-1) 全量生成(单星重生走 spawnStar(i) 的 10 次探位版:
   *  取与既有星最小间距最大化的 X——SpawnStars :110-130) */
  private spawnStars(): void {
    this.stars = [];
    this.numStars = 200 + Math.floor(Math.random() * 200);   // Next(200,400)
    for (let i = 0; i < this.numStars; i++) this.spawnStar(-1);
  }
  /** Star.Update(:70-113):fadeIn 夜间渐显(6.1728395e-5·dayRate·10/tick)、
   *  twinkle 0.6-1.0 往返、rotation 环绕;falling 支三倍速+0.5/tick 自旋。
   *  ★liqpolish:rot 写点同步重算 cs/sn（draw 侧 trig 外提;值逐位同 draw 时
   *  Math.cos/sin(s.rot)——rot 在 update 与 draw 之间不变） */
  private updateStar(s: SkyStar, dayRate: number): void {
    if (s.falling && !s.hidden) {
      s.fallTime += dayRate;
      const k = (dayRate + 99) / 100;
      s.x += s.fvx * k; s.y += s.fvy * k;
      if (s.y > 1500) s.hidden = true;
      s.twinkle += s.twSpeed * 3;
      if (s.twinkle > 1) { s.twinkle = 1; s.twSpeed *= -1; }
      else if (s.twinkle < 0.6) { s.twinkle = 0.6; s.twSpeed *= -1; }
      s.rot += 0.5;
      if (s.rot > 6.28) s.rot -= 6.28;
      if (liqpolish) { s.cs = Math.cos(s.rot); s.sn = Math.sin(s.rot); s.csRot = s.rot; }
      return;
    }
    if (s.fadeIn > 0) {
      s.fadeIn = Math.max(0, s.fadeIn - 6.1728395e-5 * dayRate * 10);
    }
    s.twinkle += s.twSpeed;
    if (s.twinkle > 1) { s.twinkle = 1; s.twSpeed *= -1; }
    else if (s.twinkle < 0.6) { s.twinkle = 0.6; s.twSpeed *= -1; }
    s.rot += s.rotSpeed;
    if (s.rot > 6.28) s.rot -= 6.28;
    if (s.rot < 0) s.rot += 6.28;
    if (liqpolish) { s.cs = Math.cos(s.rot); s.sn = Math.sin(s.rot); s.csRot = s.rot; }
  }
  /** Star.UpdateStars(:137-163):昼 time≥27000 重生 hidden 星;逐星 Update */
  private updateStars(dayRate: number, isDay: boolean, dayTicks: number): void {
    if (!this.stars.length) this.spawnStars();
    if (isDay && dayTicks >= 27000) {
      for (let i = 0; i < this.numStars; i++) {
        if (this.stars[i].hidden) { this.spawnStar(i); this.stars[i].fadeIn = 1; }
      }
    }
    for (let i = 0; i < this.numStars; i++) this.updateStar(this.stars[i], dayRate);
  }
  /** Star.StarFall(:57-81):离 x 最近且未 falling/hidden 的星标 falling
   *  (AI_148 StarSpawner 出生时触发,Projectile.cs:50204——玩家在地表上方才调) */
  starFallAt(worldX: number, worldWidth: number): void {
    if (!this.stars.length) return;
    const num3 = worldX / worldWidth * 1920;
    let best = -1, bestD = -1;
    for (let i = 0; i < this.numStars; i++) {
      const s = this.stars[i];
      if (s.hidden || s.falling) continue;
      const d = Math.abs(s.x - num3);
      if (bestD === -1 || d < bestD) { best = i; bestD = d; }
    }
    if (best >= 0) {
      const s = this.stars[best];
      s.fallTime = 0;
      s.falling = true;
      s.fvy = (700 + Math.floor(Math.random() * 301)) * 0.01;
      s.fvx = (Math.floor(Math.random() * 801) - 400) * 0.01;
    }
  }
  private starTex(i: number): ImageBitmap | HTMLImageElement | null {
    let t = this.starTexs[i];
    if (t === null) {
      t = loadTex(`Star_${i}.png`);
      this.starTexs[i] = t;
    }
    return t.width > 0 ? t : null;
  }
  /** Main.DrawStar(:62481-62604)逐式:亮度=(255−bg.R−100)·twinkle·(1−fadeIn)
   *  三通道均值×1.4 钳 255;位置 (pos/1920,·/1200)×屏+(0,bgTopY),X/Y 环绕;
   *  坠星带 8 段尾迹(fallTime 钳 30,逐段 ×0.4 位移衰减)。shimmer 分支
   *  (:62521-62542→1457 :64032-64057)已随 SW-BJ41(2026-09-09)接线——shimmerAlpha
   *  由 Renderer 注入,旧注「本仓无微光天空态」误判作废(判定链 SceneMetrics
   *  zoneShimmer 本就健在,断点只在驱动 env 漏喂)
   *  ★变换走 setTransform(2026-08-24 trace 热点修复):夜空 ~300 星 ×
   *  save/translate/rotate/restore 每星 4 次状态机往返(trace:save 187ms+
   *  rotate 129+restore 91+translate 90 ≈ 0.5s/54s)——改为调用方(draw 星环)
   *  save/getTransform 一次,逐星 setTransform 折叠旋转+缩放+平移,尾迹同式;
   *  光栅结果逐像素一致(同一 CTM 语义),状态机往返全消。imageSmoothingEnabled
   *  同步提升到环外(原每星设一次) */
  /** ★C13 星批化（2026-09-30）:单星绘制数据纯计算——drawStar(2D 路径)与
   *  buildStarBatch(GL 批路径)共用,逐式同源(Star.cs + Main.DrawStar
   *  :62481-62604;改一处必改两处)。null=本星本帧不可见(隐没/亮度≤0/贴图未载)。 */
  private starCompute(
    i: number, starOpacity: number, viewW: number, viewH: number, bgTopY: number,
    shim: number, artificial: boolean, cots: readonly number[] | null,
  ): { s: SkyStar; tex: ImageBitmap | HTMLImageElement; alpha: number; px: number; py: number; cs: number; sn: number } | null {
    const s = this.stars[i];
    if (!s || s.hidden) return null;
    const bgR = cots ? cots[0] : 255, bgG = cots ? cots[1] : 255, bgB = cots ? cots[2] : 255;
    const num2 = 1 - s.fadeIn;
    const r0 = (255 - bgR - 100) * s.twinkle * num2;
    const g0 = (255 - bgG - 100) * s.twinkle * num2;
    const b0 = (255 - bgB - 100) * s.twinkle * num2;
    let lum = Math.floor((r0 + g0 + b0) / 3);
    if (lum <= 0) return null;
    lum = Math.min(255, Math.floor(lum * 1.4));
    let alpha = Math.max(0, Math.min(1, (lum / 255) * starOpacity));
    if (shim > 0) {
      // ★SW-BJ41：DrawStar 微光 tint（Main.cs:64032-64057）——通道均值因子
      // = 1 − num·(1−twinkle²)/3;canvas 单 alpha 管线以均值因子承载亮度,
      // 单通道色相偏移登记债（同 TileShine 顶点色域管线限制）
      const tw2 = s.twinkle * s.twinkle;
      const meanF = 1 - shim * (1 - tw2) / 3;
      alpha *= artificial ? shim * meanF : (1 - shim) * meanF;
    }
    // 位置映射(:62544-62549)
    let px = s.x / 1920 * viewW;
    let py = s.y / 1200 * viewH + bgTopY;
    if (!s.falling) {
      if (px < 0) px += viewW;
      if (px > viewW) px -= viewW;
      if (py < 0) py += viewH;
      if (py > viewH) py -= viewH;
    }
    const tex = this.starTex(s.type);
    if (!tex) return null;
    // ★liqpolish:cos/sin 读更新侧缓存（csRot 验证戳=缓存产出 rot——任意时序
    //  （paused 翻旗/漏更）下陈旧即回退就地求值,值逐位同 Math.cos/sin(s.rot)）
    const cs = liqpolish && s.csRot === s.rot ? s.cs : Math.cos(s.rot);
    const sn = liqpolish && s.csRot === s.rot ? s.sn : Math.sin(s.rot);
    return { s, tex, alpha, px, py, cs, sn };
  }

  private drawStar(
    ctx: CanvasRenderingContext2D, i: number, starOpacity: number,
    viewW: number, viewH: number, bgTopY: number,
    bt: DOMMatrix,
    shimmerAlpha = 0, artificial = false,
    cotsOverride?: readonly number[] | null,
  ): void {
    const cots = cotsOverride ?? this.cots;
    const d = this.starCompute(i, starOpacity, viewW, viewH, bgTopY, shimmerAlpha, artificial, cots);
    if (!d) return;
    const { s, tex, alpha, px, py, cs, sn } = d;
    if (s.falling) {
      // 尾迹(:62574-62595):fallTime 钳 30,逐段 fallSpeed·j·0.4 位移+scale/alpha
      // 衰减+rotation。★位移乘视口变换(×viewW/1920,×viewH/1200)——原版 1920×1200
      // 全屏 1:1 混用天/屏空间,窗口缩放下不乘则尾迹比头部运动拉长 1.5 倍显脱节
      const ft = Math.min(s.fallTime, 30);
      const sx = viewW / 1920, sy = viewH / 1200;
      for (let j = 1; j < ft; j++) {
        const tx = px - s.fvx * j * 0.4 * sx, ty = py - s.fvy * j * 0.4 * sy;
        const sc = s.scale * (1 - j / 30);
        ctx.globalAlpha = alpha * (1 - j / 30);
        this.starXform(ctx, bt, cs, sn, sc, tx, ty);
        ctx.drawImage(tex, -tex.width / 2, -tex.height / 2, tex.width, tex.height);
      }
    }
    // 主星尺寸 ×twinkle(:62600 theStar.scale * theStar.twinkle——脉动语义;
    // 原式 dest = 宽×scale×twinkle / 高×scale×twinkle = 均匀缩放,折叠进矩阵)
    ctx.globalAlpha = alpha;
    this.starXform(ctx, bt, cs, sn, s.scale * s.twinkle, px, py);
    ctx.drawImage(tex, -tex.width / 2, -tex.height / 2, tex.width, tex.height);
  }

  // ---- ★C13 星场批（2026-09-30 SHM 逐星 drawImage 洪峰根治）----
  // 【病灶】自然夜空/微光人工星空 = 每帧 200-400 星 × save/setTransform/drawImage
  //  逐星 2D op（Windows trace LPR/帧=337 实锤,健康 GPU 路径 ≈1）——SHM 机器上
  //  逐 op 主线程录制+光栅税把 render 打到 13-25ms=掉到 30-50fps 相位（"不稳"）。
  // 【正解】gore 批同款范式:每星 CPU 折算 4 角（starXform 复合矩阵逐式同源）+
  //  顶点色 alpha,按星贴图（Star_0..3）分段 quadBatchRgba（smooth 线性）——
  //  300 op → ≤4 draw call。降级=现有 2D 逐星循环原样保留（宁回退不丢内容）。
  // 【发射位】两个 mini-session,FBO 命名空间新增 'sstarn'/'sstars'（与
  //  clouds/bg/lit/warped/light2 防撞）:自然星在 sky.draw 星位原位（层序=星空
  //  在天空渐变上/日月塔幕下的既有位置由【原位 blit】保持）;人工星在微光 veil
  //  后原位。GL 层不可用帧走 2D 回退。
  private starTexIds = new WeakMap<object, number>();
  private starTexIdSeq = 0;

  private buildStarBatch(
    artificial: boolean, starOpacity: number, viewW: number, viewH: number,
    bgTopY: number, bt: DOMMatrix, shim: number, cots: readonly number[] | null,
  ): { segments: Array<{ texIdx: number; img: ImageBitmap | HTMLImageElement; key: string; data: Float32Array; quads: number }>; quads: number } | null {
    interface Slot { nums: number[]; qn: number; idxs: number[] }
    const byTex = new Map<number, Slot>();
    let any = false;
    for (let i = 0; i < this.numStars; i++) {
      const d = this.starCompute(i, starOpacity, viewW, viewH, bgTopY, shim, artificial, cots);
      if (!d || d.alpha <= 0) continue;
      const { s, tex, alpha, px, py, cs, sn } = d;
      let slot = byTex.get(s.type);
      if (!slot) { slot = { nums: [], qn: 0, idxs: [] }; byTex.set(s.type, slot); }
      const tw = tex.width, th = tex.height, hw = tw / 2, hh = th / 2;
      // UV=全跨度−tie-eps（quadSprite 同式;线性采样防边缘渗色）
      const u0 = -1 / 4096 / tw, u1 = (tw - 1 / 4096) / tw;
      const v0 = -1 / 4096 / th, v1 = (th - 1 / 4096) / th;
      const push = (sc: number, x: number, y: number, a: number): void => {
        // 角点 = starXform 复合矩阵（base × translate × rotate × scale）×(±hw,±hh)
        // 逐式同源 setTransform 六参（改一处必改 starXform）
        const ra = cs * sc, rb = sn * sc;
        const mA = bt.a * ra - bt.b * rb, mB = bt.a * rb + bt.b * ra;
        const mC = bt.c * ra - bt.d * rb, mD = bt.c * rb + bt.d * ra;
        const mE = bt.e + bt.a * x + bt.c * y, mF = bt.f + bt.b * x + bt.d * y;
        const cs2 = [
          [mE + mA * -hw + mC * -hh, mF + mB * -hw + mD * -hh, u0, v0],
          [mE + mA * hw + mC * -hh, mF + mB * hw + mD * -hh, u1, v0],
          [mE + mA * hw + mC * hh, mF + mB * hw + mD * hh, u1, v1],
          [mE + mA * -hw + mC * hh, mF + mB * -hw + mD * hh, u0, v1],
        ];
        // TRIANGLES 两三角 (v0,v1,v2)+(v0,v2,v3);顶点色 rgb=a（★2D globalAlpha
        // 语义精确式:预乘管线 out.rgb=texP.rgb×vCol.rgb——rgb 不携 alpha 时暗星
        // 只减覆盖不减亮度=黄昏星提前显形（用户实报 17:30 出星）;rgb=a 后
        // 贡献=白×shapeA×a ≙ 2D globalAlpha 逐位）
        for (const vi of [0, 1, 2, 0, 2, 3]) {
          const c = cs2[vi];
          slot.nums.push(c[0], c[1], c[2], c[3], a, a, a, a);
        }
        slot.qn++;
      };
      if (s.falling) {
        const ft = Math.min(s.fallTime, 30);
        const sxv = viewW / 1920, syv = viewH / 1200;
        for (let j = 1; j < ft; j++) {
          push(s.scale * (1 - j / 30), px - s.fvx * j * 0.4 * sxv, py - s.fvy * j * 0.4 * syv, alpha * (1 - j / 30));
        }
      }
      push(s.scale * s.twinkle, px, py, alpha);
      slot.idxs.push(i);
      any = true;
    }
    if (!any) return null;
    const segments = [];
    for (const [texIdx, slot] of byTex) {
      const tex = this.starTex(texIdx)!;
      segments.push({ texIdx, img: tex, key: this.starTexKey(texIdx) ?? `sbat:${texIdx}:0`, data: new Float32Array(slot.nums), quads: slot.qn });
    }
    return { segments, quads: segments.reduce((s2, x) => s2 + x.quads, 0) };
  }

  /** ★C13 星批纹理幂等键单源（2026-10-01 K3 预热刀抽出——buildStarBatch 与
   *  prewarmStarBatch 共用,键漂移=预热白做/批纹理 miss） */
  private starTexKey(texIdx: number): string | null {
    const t = this.starTexs[texIdx];
    if (!t || !(t.width > 0)) return null;
    let id = this.starTexIds.get(t);
    if (id === undefined) { id = ++this.starTexIdSeq; this.starTexIds.set(t, id); }
    return `sbat:${texIdx}:${id}`;
  }

  /** ★K3 星批 idle 预热（2026-10-01;首夜帧 ~132ms 尖峰定谳=sprite:precip 惰性
   *  编译+Star_0..3 texFromImage 首传）——世界载入完成后空闲期调用（mainFlow
   *  幕布掀除后 rIC 挂点）：
   *  ①starTex(0..3) 触发 loadTex 异步装载（与昼间并行,幂等）;
   *  ②就绪即 texFromImage 预传（键=starTexKey 单源,首夜帧零首传）;
   *  ③GL 层在场则 prewarmPrecip 编译（首夜帧零编译,雨/沙批同程序同收益）。
   *  失败/不可用静默（首夜照旧惰性路径=逐字节原语义）;worker/node 判死守卫
   *  （typeof document）。 */
  prewarmStarBatch(): void {
    if (typeof document === 'undefined') return;
    for (let i = 0; i < 4; i++) {
      this.starTex(i);                       // 触发异步装载（幂等;未就绪帧跳过自愈）
      const key = this.starTexKey(i);
      if (!key) continue;
      const t = this.starTexs[i]!;
      if (t.width > 0) this.cloudGlLayer?.texFromImage(key, t, false, true);
    }
    this.cloudGlLayer?.prewarmPrecip();
  }

  /** 星批 mini-session:begin→分段 quadBatchRgba(smooth)→end;调用方随即
   *  ctx.drawImage(layer.canvas) 原位 blit（层序由 blit 位保持）。
   *  ★C10e over=true=管线后端收口走屏 over present（glCanvas 直出,调用方跳过
   *  blit——层序=glCanvas 栈位保持）;非管线后端忽略 over 恒原路径。 */
  private emitStarBatchGL(layer: GLSpriteLayer, batch: NonNullable<ReturnType<SkyRenderer['buildStarBatch']>>, fboName: string, viewW: number, viewH: number, over = false): void {
    layer.resize(viewW, viewH);
    layer.begin(fboName);
    for (const seg of batch.segments) {
      const e = layer.texFromImage(seg.key, seg.img, false, true);
      if (e) layer.quadBatchRgba(e, seg.data, seg.quads, true);
    }
    layer.end(true, over);
  }

  /** ★SW-BJ41 2026-09-09：Main.shimmerAlpha（SceneState.UpdateShimmer :332-357
   *  逐帧推进值；Renderer 每帧自 monoFilters.shimmerAlpha 注入）。
   *  消费面：自然星衰减/停画门（Main.cs:63034/:64005/:64057）+ 人工星 pass 门
   *  （:63147 `if (shimmerAlpha > 0f)`） */
  shimmerAlpha = 0;
  /** draw() 暂存的本帧 SceneArea.bgTopY（人工星与自然星同一映射,Main.cs:63036/
   *  :63151 同传 sceneArea） */
  private _lastStarBgTopY = 0;

  /** 人工星空 pass（Main.DoDraw :63147-63153 `if (shimmerAlpha > 0f)
   *  DrawStarsInBackground(sceneArea, artificial: true)`——画在黑幕之后、地下
   *  分层背景/墙/tile 之前；同源 Star[] 重绘一遍,tint 与 alpha 走 DrawStar
   *  :64032-64057 微光支）。调用位 = Renderer.render 主画布段收尾（本仓管线中
   *  与原版「黑幕→背景水→人工星→地下背景」层序的对应,见 Renderer 侧注） */
  drawShimmerStars(ctx: CanvasRenderingContext2D, viewW: number, viewH: number, camY: number, shim: number): void {
    const gate = this.shimmerStarGate(camY, shim);
    if (!gate) return;
    const { starDim, cotsFaded } = gate;
    // ★C13 星批化:GL 层在场=批路径（begin('sstars')→原位 blit,层序=veil 后/
    // 世界前的既有位）;GL 不可用帧=2D 逐星回退（原路径逐位）
    const bt = ctx.getTransform();
    const batch = this.buildStarBatch(true, starDim, viewW, viewH, this._lastStarBgTopY, bt, shim, cotsFaded);
    const layer = this.cloudGlLayer;
    if (batch && layer && !layer.unavailable) {
      this.emitStarBatchGL(layer, batch, 'sstars', viewW, viewH);
      // ★blit 恒等变换（同 'sstarn' 位注）。★C10e：星必须落 HUD（veil 在 HUD 之上
      //  才能盖天空栈、星在 veil 后同层序;世界 present 在 glCanvas=HUD 之下——
      //  ★BJ740 勘注:此论域=路由帧（世界 blit 进 HUD）;GL 桥帧（BJ740）黑幕+星
      //  over-present 落 glCanvas 中栈=世界 present 后落其上=原版「墙/tile 盖星」
      //  同序（本注旧论按路由帧成立,GL 桥帧走 drawShimmerStarsGL 不经此臂）。
      //  管线后端 present 为 blend-off 直写=踩踏屏栈 → blit 后 restackScreen 恢复。
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(layer.canvas, 0, 0);
      ctx.restore();
      layer.pipeBackend?.restackScreen();
      return;
    }
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    for (let i = 0; i < this.numStars; i++) {
      this.drawStar(ctx, i, starDim, viewW, viewH, this._lastStarBgTopY, bt, shim, true, cotsFaded);
    }
    ctx.restore();
  }

  /** ★BJ740 人工星门单源（drawShimmerStars 2D 臂与 drawShimmerStarsGL GL 臂共用,
   *  表达式逐字同旧内联——漂移即两臂分叉红）。null=本帧不出星（墓地/云量门/零星）。 */
  private shimmerStarGate(camY: number, shim: number): { starDim: number; cotsFaded: readonly number[] } | null {
    if (shim <= 0 || this.numStars <= 0) return null;
    const gyIntensity = this.weatherRef?.graveyardVisual ?? 0;
    const starDim = Math.max(0, 1 - gyIntensity * 1.4);          // :62471-62479 同式
    if (starDim <= 0) return null;
    // 衰减天空色（:64003-64007 同式——人工/自然同源）+ 可见性门（:64015；
    // shim→1 时 cots→0 门恒开 = 地下/白昼均见星）
    const kShim = 1 - shim;
    const cotsFaded: readonly number[] = this.cots
      ? [this.cots[0] * kShim, this.cots[1] * kShim, this.cots[2] * kShim]
      : [255, 255, 255];
    const remixWorldForDraw = !!this.frameCtx?.world?.seedFlags?.remix;
    const visGate = 255 * (1 - (this.weatherRef?.cloudAlpha ?? 0) * this.atmoValue(camY)) - cotsFaded[0] - 25;
    if (!remixWorldForDraw && visGate <= 0) return null;
    return { starDim, cotsFaded };
  }

  /** ★BJ740 黑幕 1×1 白纹素（惰性;node 无 document=null=GL 臂让位） */
  private _shimVeilCv: HTMLCanvasElement | null = null;
  private shimVeilPixel(): HTMLCanvasElement | null {
    if (this._shimVeilCv) return this._shimVeilCv;
    if (typeof document === 'undefined') return null;
    const cv = document.createElement('canvas');
    cv.width = 1; cv.height = 1;
    const c2 = cv.getContext('2d');
    if (!c2) return null;
    c2.fillStyle = '#fff';
    c2.fillRect(0, 0, 1, 1);
    this._shimVeilCv = cv;
    return cv;
  }

  /** ★BJ740 恒等矩阵/黑幕 quad scratch（GL 臂 HUD 位变换恒等判例;免逐帧分配） */
  private _idM: DOMMatrix | null = null;
  private _shimVeilQuad = new Float32Array(48);

  /** ★BJ740（2026-10-30）：微光独石黑幕+人工星 GL 直出——'sstars' 会话 over-present
   *  落 glCanvas 中栈槽（bg present 后/世界 present 前=lantern/ambgl 桥同款;opresent
   *  defer 门 shimmer 帧本就禁=bg 已在画布,层序成立）。黑幕=1×1 白纹素全幅 quad
   *  premul (0,0,0,shim)（原版 MagicPixel Black*shimmerAlpha SO:out=dst×(1−shim)）;
   *  人工星=buildStarBatch 同源（bt=恒等——HUD 位变换恒等判例）。
   *  调用方（Renderer BJ740 臂）已预获取 pipe=同实例零失败窗;本方法内失败=该帧
   *  黑幕/星缺席（帧头预备使其≈不可达;自愈,登记口径）。 */
  drawShimmerStarsGL(gl: GLSpriteLayer, viewW: number, viewH: number, camY: number, shim: number): void {
    if (shim <= 0) return;
    const px = this.shimVeilPixel();
    if (!px) return;
    const a = Math.max(0, Math.min(1, shim));
    gl.resize(viewW, viewH);
    gl.begin('sstars');
    if (gl.unavailable) return;
    const e = gl.texFromImage('shimveil:px', px, false, true);
    if (e) {
      // 全幅 quad（TRIANGLES 两三角;stride 8×6=48——batQuad 布局同式,premul rgb=0）
      const d = this._shimVeilQuad;
      const W = viewW, H = viewH;
      const put = (o: number, x: number, y: number, u: number, v: number) => {
        d[o] = x; d[o + 1] = y; d[o + 2] = u; d[o + 3] = v;
        d[o + 4] = 0; d[o + 5] = 0; d[o + 6] = 0; d[o + 7] = a;
      };
      put(0, 0, 0, 0, 0); put(8, W, 0, 1, 0); put(16, W, H, 1, 1);
      put(24, 0, 0, 0, 0); put(32, W, H, 1, 1); put(40, 0, H, 0, 1);
      gl.quadBatchRgba(e, d, 1, true);
    }
    const gate = this.shimmerStarGate(camY, shim);
    if (gate) {
      this._idM ??= new DOMMatrix();
      const batch = this.buildStarBatch(true, gate.starDim, viewW, viewH, this._lastStarBgTopY,
        this._idM, shim, gate.cotsFaded);
      if (batch) {
        for (const seg of batch.segments) {
          const se = gl.texFromImage(seg.key, seg.img, false, true);
          if (se) gl.quadBatchRgba(se, seg.data, seg.quads, true);
        }
      }
    }
    gl.end(true, true);   // over-present 落屏栈（世界 present 在后=墙/tile 盖星同原版）
  }
  private cloudTexs: Array<ImageBitmap | HTMLImageElement | null> = new Array(41).fill(null);
  private vclouds: VanillaCloud[] = [];
  /** 风——原版风场模型(Main.cs:10800/58222-58310):
   *  windSpeedTarget 随机游走 ±0.001 步、钳 ±0.35;windSpeedCurrent 以
   *  0.0003+|diff|*0.0015 /帧 向目标缓动。旧实现是满幅正弦(±1),云速快 3~10 倍。 */
  private wind = 0;            // windSpeedCurrent
  private windTarget = 0;      // windSpeedTarget
  private windCounter = 0;     // 重掷计数(帧)
  private windRng: () => number = Math.random;
  /** 稀有云世界旗标（frameCtx 每帧刷新；缺省全 false = 只出无门稀有云） */
  private rareCloudFlags: RareCloudFlags = {
    downedBoss1: false, downedBoss2: false, downedBoss3: false,
    hardMode: false, crimson: false, dontStarveWorld: false, tenthAnniversaryWorld: false,
  };

  constructor() {
    this.spawnStars();
    // 云贴图五族(Cloud_0-21)首用懒加载:绘制/选型路径经 cloudTex(i) 触发,未就绪
    // 跳帧自愈(云淡入本身 >1s,无可见差异)。此前构造器全量装载 22 张——雨云/
    // 风暴云(18-21)无雨天气永不出现,白载;且 SkyRenderer 在菜单+进图各构造一次,
    // 急载翻倍
    this.sunTex = onBitmap(loadTex('Sun.png'), (b) => { this.sunTex = b; });
    // 月相竖条懒加载(2026-08-24 HAR 审计:菜单恒满月帧 0,Moon_1-8 菜单白载;
    // 与上方云贴图同款首用自愈——绘制分支 ensureMoonTex 未就绪跳帧)
    this.moonTexs[0] = onBitmap(loadTex('Moon_0.png'), (b) => { this.moonTexs[0] = b; });
    // 事件月亮(Main.cs:62400-62408):南瓜月 kind=2 / 霜月 kind=1,50×400 相位竖条
    // ——只在对应月亮事件进行时才画,改首用懒加载(月亮绘制分支内 ensure)
    // 风场初值(Main.cs:10800):current = ±0.8 随机,计数 7200-28800 帧
    this.wind = (Math.floor(Math.random() * 1601) - 800) * 0.001;
    this.windCounter = 7200 + Math.floor(Math.random() * 21601);
  }

  /** 云贴图首用懒加载(in-flight 去重:占位即标记;未就绪时调用方以 complete 守卫跳帧) */
  private cloudTex(i: number): ImageBitmap | HTMLImageElement | null {
    const t = this.cloudTexs[i];
    if (!t) loadBitmapOnly(`vanilla/Cloud_${i}.png`, () => !!this.cloudTexs[i], (x) => { this.cloudTexs[i] = x; });
    return t;
  }

  sunTex: ImageBitmap | HTMLImageElement;
  /** 日食太阳(Main.cs:62345-62348 eclipse → TextureAssets.Sun3) */
  private sun3Tex: ImageBitmap | HTMLImageElement | null = null;
  private sun3TexImg(): ImageBitmap | HTMLImageElement | null {
    if (!this.sun3Tex) this.sun3Tex = onBitmap(loadTex('Sun3.png'), (b) => { this.sun3Tex = b; });
    return this.sun3Tex.width > 0 ? this.sun3Tex : null;
  }
  /** 太阳本体横向光晕(DrawSun :171-185;★A=0 系反编译伪影,贴图满内容) */
  private flareT1: HTMLImageElement | null = null;
  private flareT2: HTMLImageElement | null = null;
  private flareTexImg(kind: 1 | 2): HTMLImageElement | null {
    if (kind === 1) {
      if (!this.flareT1) this.flareT1 = loadTex('Misc_Sunflare_flare1.png');
      return this.flareT1.width > 0 ? this.flareT1 : null;
    }
    if (!this.flareT2) this.flareT2 = loadTex('Misc_Sunflare_flare2.png');
    return this.flareT2.width > 0 ? this.flareT2 : null;
  }
  /** 骷髅头太阳 Sun2(Main.cs:62365-62369:!gameMenu && player.head==12 →
   *  TextureAssets.Sun2;头槽 12=物品 237 太阳镜,经 frameCtx.player.headArmorSlot
   *  注入——菜单态 frameCtx=null 即 !gameMenu 门同式) */
  private sun2Tex: ImageBitmap | HTMLImageElement | null = null;
  private sun2TexImg(): ImageBitmap | HTMLImageElement | null {
    if (!this.sun2Tex) this.sun2Tex = onBitmap(loadTex('Sun2.png'), (b) => { this.sun2Tex = b; });
    return this.sun2Tex.width > 0 ? this.sun2Tex : null;
  }
  /** Extra[280] 墨镜叠层(Main.cs:62380-62385:Sun2 档于太阳上再画一张,
   *  color3 = (color.R,color.G,color.B,100)——非日食 color 恒白) */
  private extra280Tex: ImageBitmap | HTMLImageElement | null = null;
  private extra280TexImg(): ImageBitmap | HTMLImageElement | null {
    if (!this.extra280Tex) this.extra280Tex = onBitmap(loadTex('Extra_280.png'), (b) => { this.extra280Tex = b; });
    return this.extra280Tex.width > 0 ? this.extra280Tex : null;
  }
  // ---- 2026-08-20 原版地平线系统(NextHorizonRenderer)----
  /** 本帧晨昏可见性(draw() 开头算好,日/月/渐变/光斑消费) */
  private horizonVisCache: { sunrise: number; sunset: number; celestial: number } | null = null;
  /** BackgroundDrawers 带表注入(Renderer 每帧注入 biomeBg.surfaceGradientBands;
   *  SunGradients.BackgroundDrawers 13 项的取数闭包) */
  biomeBgBands: (() => Array<{ rgb: readonly [number, number, number]; alpha: number }>) | null = null;
  /** 上一帧晨昏可见性(渲染器读去写 setFrameHorizon——帧序上 render 先画天空
   *  后写状态,光照引擎下一帧消费) */
  get horizonVis(): { sunrise: number; sunset: number; celestial: number } | null {
    return this.horizonVisCache;
  }
  /** 本帧晨昏调色板相位(Main.HorizonPhase) */
  horizonPhase = 0;
  /** 通用染色缓存(multiply+destination-in 三步,键=用途+纹理id+8 量化色) */
  private tintCache2 = new Map<string, HTMLCanvasElement>();
  /** ★晨昏色扫画布池（2026-10-12 canvas哨兵实报 396/s 定谳刀）：tintCache2 淘汰
   *  画布按尺寸键回收（同 qsWashFree 判例）。【根因】cots=Renderer 每帧从时钟重算
   *  （colorOfTheSkies），晨昏窗内 `b.rgb×cots/255` 连续扫过 4 量化桶 → 缓存键
   *  漂移 → 每帧每带 miss=createElement（3-4 band×120fps≈396/s，用户实报晨昏
   *  掉帧同源=画布后备 churn）。量化粒度不能再粗（4/255 已是既定视觉阈）→
   *  【杀分配不杀重绘】：miss 重烘照旧（≤3 op 小图，µs 级），createElement 换
   *  池取=稳态出生率→0，哨兵静默+晨昏 churn 消失。复用安全性：淘汰=容量帽，
   *  消费方（drawImage）同步消费早已结束，无持引用窗口。 */
  private tintFree = new Map<string, HTMLCanvasElement[]>();
  private tintTex(tex: ImageBitmap | HTMLImageElement, r: number, g: number, b: number, use: string): HTMLCanvasElement | HTMLImageElement | ImageBitmap {
    // ★键 = 4 单位量化（2026-08-24 canvas 哨兵实报雪崩：晨昏时间流动使 r/g/b
    //  每 tick 微变 → 精确键永不命中 → 每帧 createElement + 64 满清 clear-all
    //  = 32/s 分配率）。4/255≈1.6% 亮度差肉眼不可辨；64 上限 clear-all 改
    //  删最旧一半（保热键）；贴图仅 114²/50² 小图
    const key = `${use}:${texId(tex as object)}:${(r | 0) & ~3},${(g | 0) & ~3},${(b | 0) & ~3}`;
    let c = this.tintCache2.get(key);
    if (c) return c;
    // ★半加载窗守卫（2026-08-24 同洞加固）：未就绪本帧退回原贴图（调用方本就
    //  有原图快路径,一帧原色自愈），绝不把平色矩形烘进缓存
    if (!texReady(tex)) return tex;
    // ★晨昏色扫池化（2026-10-12）：同尺寸淘汰画布优先（createElement 换池取,
    //  稳态出生率→0）;尺寸失配才 resize(罕见——源贴图尺寸恒定)。
    //  ★★池取必 clearRect（wingTexSource 混帧回归同判例）：源贴图部分-α 像素
    //  透出残留旧色=边缘晕影;clear 前置=逐位等价新烘。
    //  ★★★池取重烘必 bumpTexEpoch（wingTexSource shim 陈旧纹理同判例）:
    //  天空 ctx 多态(2D/shim),同身份重烘 epoch 不动=er: 键陈旧纹理。
    let pooledT = false;
    {
      const fk = `${tex.width}x${tex.height}`;
      const fl = this.tintFree.get(fk);
      if (fl && fl.length) {
        c = fl.pop()!;
        pooledT = true;
        if (c.width !== tex.width || c.height !== tex.height) { c.width = tex.width; c.height = tex.height; }
        c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
      } else {
        c = document.createElement('canvas');
        c.width = tex.width; c.height = tex.height;
      }
    }
    const tc = c.getContext('2d')!;
    tc.drawImage(tex as CanvasImageSource, 0, 0);
    tc.globalCompositeOperation = 'multiply';
    tc.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
    tc.fillRect(0, 0, c.width, c.height);
    tc.globalCompositeOperation = 'destination-in';
    tc.drawImage(tex as CanvasImageSource, 0, 0);
    if (pooledT) bumpTexEpoch(c);   // ★shim er: 键换代（池取重烘铁律）
    this.tintCache2.set(key, c);
    // ★evict-on-insert（2026-10-14 tintTex 229/s 回潮定谳刀,wingTexSource 83/s 同病
    //   同款——池化三铁律第 0 条「供应率=消耗率」）:旧「size>256 批量删 128」窗口
    //   结构=128 miss 纯分配期+批量入池 cap 32/尺寸（128 淘汰同尺寸只留 32,96 个
    //   丢弃）=供应率 ~25%,稳态出生率≈miss 率（晨昏键 churn 3-4 带×量化桶穿越
    //   ≈229/s 实测吻合）。修=插入即上限执行:每插一张淘汰最旧一张入池 → 供应
    //   逐张锁定 miss 率 → 暖机后 births→0。LRU 语义等价（同容量 256,删最旧
    //   一半的旧律本就是防 clear-all 连热键,逐张删同保插入序）;重烘频率=桶
    //   语义不变,视觉零改动。
    while (this.tintCache2.size > 256) {
      const k0 = this.tintCache2.keys().next().value as string;
      const ev = this.tintCache2.get(k0);
      this.tintCache2.delete(k0);
      if (ev && ev.width > 0) {
        const ek = `${ev.width}x${ev.height}`;
        let ef = this.tintFree.get(ek);
        if (!ef) { ef = []; this.tintFree.set(ek, ef); }
        if (ef.length < 32) ef.push(ev);
      }
    }
    return c;
  }
  /** 晨昏渐变贴图——Sunrise/Sunset 各自只有 4 色（原版资产实际存在的子集）：
   *  Sunrise = Blue/Violet/Yellow/Aluminum；Sunset = Blue/Dark/Pink/Red。
   *  曾对两种 kind 都用同一 7 色表 → 3×2=6 个 404（2026-08-27 用户实报） */
  private static readonly GRAD_COLORS: Record<'Sunrise' | 'Sunset', string[]> = {
    Sunrise: ['Blue', 'Violet', 'Yellow', 'Aluminum'],
    Sunset: ['Blue', 'Dark', 'Pink', 'Red'],
  };
  private gradTexs = new Map<string, HTMLImageElement>();
  private horizonGradTex(kind: 'Sunrise' | 'Sunset', idx: number): HTMLImageElement | null {
    const key = `${kind}${idx}`;
    let t = this.gradTexs.get(key);
    if (t === undefined) {
      const colors = SkyRenderer.GRAD_COLORS[kind];
      t = loadTex(`Misc_${kind}_${kind}_${colors[idx % colors.length]}.png`);
      this.gradTexs.set(key, t);
    }
    return t.width > 0 ? t : null;
  }
  /** 地平线渐变绘制(DrawHorizon :81-105):晨昏窗内把渐变贴图盖到天空上;
   *  gradientRect(:68-75)随相机入地收缩到屏外。 */
  private drawHorizonGradients(
    ctx: CanvasRenderingContext2D, viewW: number, viewH: number, camY: number,
    vis: { sunrise: number; sunset: number }, phase: number,
  ): void {
    if (this.fx.surfaceY <= 0) return;
    const num = 400;
    // Main.screenPosition.Y/16(屏顶世界 Y÷16——须除 zoom 得真实屏顶;旧漏 /zoom)
    const camTopTiles = (camY - viewH / 2 / (this.frameCtx?.z ?? 1)) / 16;
    // GetLerpValue(40, worldSurface, camTopTiles):0(地表)→1(高空)
    const lerpV = Math.max(0, Math.min(1, (camTopTiles - 40) / Math.max(1, this.fx.surfaceY / 16 - 40)));
    const val = (1 - lerpV) * num;
    const gy = Math.max(0, val) - num;
    // BackgroundDrawers(SunGradients.cs:175-189):群系背景树顶渐隐带,画在
    // 晨昏渐变【之前】(DrawHorizon :99-102 序)。带色×ColorOfSurfaceBackgrounds
    // (=cots)×weight;gradientRect(BackgroundGradientDrawer.GetGradientRect :70-74:
    // y = max(0,(worldSurface·16−screenPos.Y−2400)·0.1)−400)
    const bands = this.biomeBgBands?.() ?? [];
    if (bands.length && this.cots) {
      const dither = this.sunflareTexLoad('colorgradientdither');
      if (dither && dither.width > 0) {
        const screenTopD = camY - viewH / 2 / (this.frameCtx?.z ?? 1);
        const gy2 = Math.max(0, (this.fx.surfaceY * 16 - screenTopD - 2400) * 0.10000000149011612) - num;
        for (const b of bands) {
          if (b.alpha <= 0) continue;
          const im = this.tintTex(dither,
            b.rgb[0] * this.cots[0] / 255, b.rgb[1] * this.cots[1] / 255, b.rgb[2] * this.cots[2] / 255,
            `band${b.rgb[0]}_${b.rgb[1]}`);
          ctx.save();
          ctx.globalAlpha = Math.min(1, b.alpha);
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(im, 0, 0, dither.width, dither.height, 0, gy2, viewW, viewH + num);
          ctx.restore();
        }
      }
    }
    const su = vis.sunrise, sd = vis.sunset;
    // ★XNA 语义(Color.White×vis 全通道乘):贡献 = tex.rgb·vis²+dst·(1−vis)
    //   ——rgb 与 α【都】乘 vis;仅 globalAlpha=vis 是 vis¹(渐隐边缘偏亮)。
    //   ctx.filter brightness 乘 rgb + globalAlpha 乘 α = 精确等价;不支持
    //   filter 的环境回落 vis¹ 近似(渐隐边缘略亮,渐变期短无感)
    const drawGrad = (im: HTMLImageElement, v: number) => {
      ctx.save();
      ctx.globalAlpha = Math.min(1, v);
      try { ctx.filter = `brightness(${Math.max(0, Math.min(1, v)).toFixed(3)})`; } catch { /* 老引擎无 filter */ }
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(im, 0, 0, im.width, im.height, 0, gy, viewW, viewH + num);
      ctx.filter = 'none';
      ctx.restore();
    };
    if (su > 0.003) {
      const im = this.horizonGradTex('Sunrise', phase % 4);
      if (im) drawGrad(im, su);
    }
    if (sd > 0.003) {
      const im = this.horizonGradTex('Sunset', phase % 4);
      if (im) drawGrad(im, sd);
    }
  }
  /** 天空底色贴图首用懒加载(构造器不预载:菜单/进图各一份 SkyRenderer,且
   *  测试环境无网络贴图) */
  private skyTexImg(): ImageBitmap | HTMLImageElement | null {
    if (!this.skyBgTex) {
      this.skyBgTex = onBitmap(loadTex('Background_0.png'), (b) => { this.skyBgTex = b; this.skyBgTinted = null; });
    }
    // ★texReady：width>0 挡不住半加载窗——该窗内 tintSkyTex 会把平色矩形烘进
    //  skyBgTinted 缓存（整幅天空底变平色）。未就绪回落渐变分支一帧自愈
    return texReady(this.skyBgTex) ? this.skyBgTex : null;
  }
  /** 贴图×cots 染色缓存(tint 8/255 量化——晨昏连续漂移期间缓存打爆教训同
   *  BiomeBackground.tintCache;贴图仅 48×1400,重烘成本可忽略)
   *  ★画布复用(2026-08-24 trace 热点修复):键 = 逐单位截断,晨昏漂移期逐帧
   *  换键 → 旧实现每帧 createElement('canvas') 一张 48×1400 = 漂移期每帧
   *  一次 IOSurface 出生+旧张弃 GC(GC 突发与漂移秒同相,trace 实测)。
   *  改单画布原位重烘(尺寸不变即零分配),键仍逐单位(无视觉台阶回归) */
  private tintSkyTex(tex: ImageBitmap | HTMLImageElement): HTMLCanvasElement {
    const c = this.cots!;
    // ★键 = 逐单位截断(曾 1/8 量化=32 档)——晨昏 cots 扫过数百单位时天空底色
    //  按 8 单位台阶跳变 = 用户实报"光照顿挫/肉眼可见亮度跌落"(2026-08-24)。
    //  bake 本体(贴图尺寸 multiply+destination-in,画布复用)≈1ms,逐帧可承受
    const key = `${c[0] | 0},${c[1] | 0},${c[2] | 0}`;
    if (this.skyBgTinted?.key === key) return this.skyBgTinted.canvas;
    let cv = this.skyBgTinted?.canvas;
    if (!cv) {
      cv = document.createElement('canvas');
      this.skyBgTinted = { key: '', canvas: cv };
    }
    if (cv.width !== tex.width || cv.height !== tex.height) { cv.width = tex.width; cv.height = tex.height; }
    const tc = cv.getContext('2d')!;
    tc.globalCompositeOperation = 'copy';   // 池化复用双坑同 cloudTint:清残留+归位状态
    tc.drawImage(tex as CanvasImageSource, 0, 0);
    tc.globalCompositeOperation = 'multiply';
    tc.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
    tc.fillRect(0, 0, cv.width, cv.height);
    tc.globalCompositeOperation = 'destination-in';
    tc.drawImage(tex as CanvasImageSource, 0, 0);
    this.skyBgTinted!.key = key;
    return cv;
  }
  moonTexs: Array<ImageBitmap | HTMLImageElement | null> = [null, null, null, null, null, null, null, null, null];
  /** 事件月亮（kind 1=霜月 Snow / 2=南瓜月 Pumpkin,Main.cs:62400-62408）——
   *  事件进行时才需要,首用懒加载(绘制分支 ensureEventMoonTex) */
  private eventMoonTexs: Array<ImageBitmap | HTMLImageElement | null> = [null, null]; // [1]=Snow [2]=Pumpkin
  /** 常规月相竖条首用懒加载（Moon_0 构造期即载=菜单恒满月帧；1-8 进游戏
   *  首用触发，未就绪调用方跳帧自愈——2026-08-24 HAR 审计菜单白载修复） */
  private ensureMoonTex(i: number): ImageBitmap | HTMLImageElement | null {
    const t = this.moonTexs[i];
    if (!t) this.moonTexs[i] = onBitmap(loadTex(`Moon_${i}.png`), (b) => { this.moonTexs[i] = b; });
    return this.moonTexs[i];
  }
  /** 事件月亮贴图(首用懒加载,未就绪调用方跳帧) */
  private ensureEventMoonTex(kind: 1 | 2): ImageBitmap | HTMLImageElement | null {
    const t = this.eventMoonTexs[kind];
    if (!t) loadBitmapOnly(`vanilla/Moon_${kind === 2 ? 'Pumpkin' : 'Snow'}.png`,
      () => !!this.eventMoonTexs[kind], (x) => { this.eventMoonTexs[kind] = x; });
    return this.eventMoonTexs[kind];
  }
  /** 世界月亮样式(原版 header moonType 0-8;默认 0 标准月) */
  moonType = 0;
  // ---- 天幕流星(AmbientSky.MeteorSkyEntity :1316-1341;spawnMeteor 期间夜 15000-16200
  //      窗口恰一颗划过,Main.HandleMeteorFall :64952-64967)----
  private meteorTex: ImageBitmap | HTMLImageElement | null = null;
  /** 活动实体:null = 无;spawn() 后按 vanilla 参数运动 */
  private meteor: {
    x: number; y: number; vx: number; vy: number; rot: number; t: number; life: number; flip: boolean;
    depth: number;
  } | null = null;
  /** 贴图 62×384 = 4 帧竖排(FramingSpeed 5 → 每 5 帧进一格) */
  private static readonly METEOR_FW = 62;
  private static readonly METEOR_FH = 96;

  /** 触发一颗(Game:夜间过 15000 线时恰调一次;原版 _canShowMeteorFall 门) */
  spawnSkyMeteor(playerCx: number, playerCy: number, worldSurfacePx: number) {
    if (this.meteor) return;   // 原版每窗口一颗(ForceEntitySpawn 一次)
    if (!this.meteorTex) {
      this.meteorTex = onBitmap(loadTex('Background_Meteor.png'), (b) => { this.meteorTex = b; });
    }
    // :1321-1325:flip 掷;角度 π/4 + rand(π/2) 的单位向量(向下)
    const ang = Math.PI / 4 + Math.random() * (Math.PI / 2);
    const vx = Math.cos(ang), vy = Math.sin(ang);
    // :1326-1333:速度 = 使行进 worldSurface*16 距离恰 1200 帧;出生 = 玩家中心 ±100
    //  减去 velocity*1200*0.5(前半程从屏外来)
    const spd = worldSurfacePx / vy / 1200;
    this.meteor = {
      vx: vx * spd, vy: vy * spd,
      x: playerCx + (Math.floor(Math.random() * 201) - 100) - vx * spd * 600,
      y: playerCy + (Math.floor(Math.random() * 201) - 100) - vy * spd * 600,
      rot: ang + Math.PI / 2,   // :1340 rotation = Velocity.ToRotation()+π/2
      t: 0, life: 1200,         // :1327/1334 LifeTime=1200
      flip: Math.random() >= 0.5,
      depth: 3 + Math.random() * 3,  // :1322 Depth = rand*3+3 ∈[3,6)
    };
  }

  /** 原版 GetParallax（Cloud.cs:324-343） */
  private cloudParallax(scale: number): number {
    let base: number, s: number;
    if (scale < 1) { base = 0.07; s = (scale + 0.15 + 1) / 2; }
    else if (scale <= 1.15) { base = 0.19; s = scale - 0.075; }
    else { base = 0.23; s = scale - 0.15 - 0.075; }
    return base * s * s;
  }

  /** 原版 SpawnCloud（Cloud.cs:60-170 一比一）：scale/rotation/flip/位置/五族选型/重叠拒绝 */
  private spawnCloud(viewW: number, viewH: number, initial: boolean): VanillaCloud | null {
    const r = Math.random;
    // scale = Next(70,131)*0.01（:81）；rot = Next(-10,11)*0.01（:82）
    const c: VanillaCloud = {
      type: 0,
      x: 0, y: 0,
      scale: Math.floor(70 + r() * 61) / 100,
      rot: (Math.floor(r() * 21) - 10) / 100,
      rSpeed: 0,
      alpha: initial ? 1 : 0,
      flip: r() < 0.5,               // :87-90 50% 水平翻转
      kill: false,
    };
    // Y 带（:109-113）：[-0.25H, 0.15H)，1/3 概率再上抬 rand*0.1H
    c.y = -viewH * 0.25 + r() * viewH * 0.4;
    if (Math.floor(r() * 3) === 0) c.y -= r() * viewH * 0.1;
    // 五族选型链（:114-138）：雨/阴天 → 18-21 风暴云（含大块上移量）
    const wr = this.weatherRef;
    const pick = pickCloudType({
      scale: c.scale, y: c.y, viewH,
      numClouds: wr ? wr.numClouds : 200,
      cloudAlpha: wr ? wr.cloudAlpha : 0,
      cloudBGActive: wr ? wr.cloudBGActive : 0,
      rnd: r,
    });
    c.type = pick.type;
    c.y -= pick.stormShift;          // :118-125 风暴云大块腾位
    // 稀有云（Cloud.cs:139-146）：1/150（饥荒/十周年世界 1/25）掷中 → RollRareCloud；
    //  十周年世界另 1/3 直通。掷点替换在五族选型之后（覆盖任意常规族）
    const rareDenom = this.rareCloudFlags.dontStarveWorld || this.rareCloudFlags.tenthAnniversaryWorld ? 25 : 150;
    if (Math.floor(r() * rareDenom) === 0) {
      c.type = rollRareCloud(this.rareCloudFlags, r);
    } else if (this.rareCloudFlags.tenthAnniversaryWorld && Math.floor(r() * 3) === 0) {
      c.type = rollRareCloud(this.rareCloudFlags, r);
    }
    // scale>1.2 下移 100（:147-149）；scale 钳 0.7/1.3（:151-158）
    if (c.scale > 1.2) c.y += 100;
    if (c.scale > 1.3) c.scale = 1.3;
    if (c.scale < 0.7) c.scale = 0.7;
    // X：顺风侧留屏外缓冲（:96-107）。num2 = wind − player.vx*0.1（:96-100，
    //  !gameMenu 才修正——frameCtx.player 在场 = 游戏内，菜单态缺省不修正）
    const num2 = this.wind - (this.frameCtx?.player?.vx ?? 0) * 0.1;
    const num3 = num2 > 0 ? -200 : 0;
    const num4 = num2 < 0 ? 200 : 0;
    const lo = num3 - 300, hi = viewW + num4 + 300;
    c.x = lo + r() * (hi - lo);      // :107 Next(num3-300, screenWidth+num4+300)
    // 远端屏外直接全显（:161-168：x>屏+400 或 x+宽<-400 → Alpha=1）
    const tw = (this.cloudTex(c.type)?.width ?? 200) * c.scale;
    if (c.x > viewW + 400 || c.x + tw < -400) c.alpha = 1;
    // AABB 重叠拒绝（:169-180）
    const tex = this.cloudTex(c.type);
    const w = (tex?.width ?? 200) * c.scale, h = (tex?.height ?? 80) * c.scale;
    for (const o of this.vclouds) {
      const ot = this.cloudTex(o.type);
      const ow = (ot?.width ?? 200) * o.scale, oh = (ot?.height ?? 80) * o.scale;
      if (c.x < o.x + ow && c.x + w > o.x && c.y < o.y + oh && c.y + h > o.y) return null;
    }
    return c;
  }

  /** 原版风场步进(Main.cs:58270-58310):每帧目标随机游走/重掷,钳 ±0.35;
   *  当前值以 0.0003+|diff|*0.0015 /帧缓动(L58222-58245)。
   *  天气系统接入后弃用（weather.update 每帧推进权威风场，此处只读） */
  private updateWind(frames: number): void {
    if (this.weatherRef) {
      this.wind = this.weatherRef.windSpeedCurrent;
      this.windTarget = this.weatherRef.windSpeedTarget;
      return;
    }
    for (let f = 0; f < Math.ceil(frames); f++) {
      // 目标随机游走(L58270-58276):1/4 ±0.025 / 1/2 ±0.05 / 其余 ±0.1(×0.001)
      if (this.windRng() < 0.25) this.windTarget += (Math.floor(this.windRng() * 51) - 25) * 0.001;
      else if (this.windRng() < 0.5) this.windTarget += (Math.floor(this.windRng() * 101) - 50) * 0.001;
      else this.windTarget += (Math.floor(this.windRng() * 201) - 100) * 0.001;
      this.windTarget = Math.max(-0.35, Math.min(0.35, this.windTarget));
      // 重掷计数(L58284-58310):多数落在 0/±0.2,少数 ±0.4,极端 ±0.85
      if (--this.windCounter <= 0) {
        this.windCounter = 7200 + Math.floor(this.windRng() * 21601); // 7200-28800 帧
        const r = this.windRng();
        if (r < 13 / 30) {
          this.windTarget = this.windRng() < 0.5 ? 0 : (Math.floor(this.windRng() * 401) - 200) * 0.001;
        } else if (r < 13 / 30 + 13 / 20 * 17 / 30) {
          this.windTarget = (Math.floor(this.windRng() * 801) - 400) * 0.001;
        } else {
          this.windTarget = (Math.floor(this.windRng() * 1701) - 850) * 0.001;
        }
        this.windTarget = Math.max(-0.35, Math.min(0.35, this.windTarget));
      }
      // 当前值缓动(L58228-58244)
      const step = 0.0003 + Math.abs(this.windTarget - this.wind) * 0.0015;
      this.wind += Math.max(-step, Math.min(step, this.windTarget - this.wind));
    }
  }

  /** 原版 Update（Cloud.cs:348-443）：风驱动位移 + 淡入淡出 + 旋转微摆 + 越界回收。
   *  速度随雨增强由 Weather.updateWind 承担（Main.cs:58221-58237：
   *  current 向 target×(1+5/9×maxRaining) 逼近——暴雨云速最高 +~56%） */
  private updateClouds(dtMs: number, viewW: number, camX = 0) {
    // 暂停冻结（Main.cs:17140-17146 CanPauseGame→DoUpdate_WhilePaused→return——
    // Cloud.UpdateClouds :17199 在门后,暂停时漂移/生成/消亡全停;画面仍从冻结态绘制）
    if (this.frameCtx?.paused) return;
    const frames = dtMs / (1000 / 60);
    this.updateWind(frames);
    // 相机视差（Cloud.cs UpdateCloudParallax :313-330）：云.x −= 相机位移 × GetParallax
    if (this.lastCloudCamX !== null) {
      const d = camX - this.lastCloudCamX;
      if (d !== 0) for (const c of this.vclouds) c.x -= d * this.cloudParallax(c.scale);
    }
    this.lastCloudCamX = camX;
    const wr = this.weatherRef;
    // 海洋群系前景层满档（Cloud.cs:401 bgAlphaFrontLayer[4]==1）
    const oceanFull = (this.frameCtx?.oceanFrontAlpha ?? 0) >= 1;
    for (const c of this.vclouds) {
      // ★IIIII218 云型强制（Cloud.cs:352-388 Update 首支逐位：每云每帧覆盖 type）——
      // 在恰界微移/位移/淡出全部之前（原版 Update 函数体首行序）
      if (this.menuCloudTypeForce) c.type = this.menuCloudTypeForce(c.scale);
      // 恰界 scale 微移（Cloud.cs:373-378：1.0→0.9999 / 1.15→1.1499）——防跨
      // pass 边界（1.0 应属远空 pass1、1.15 应属近距 pass2；每帧判、自限一次）
      if (c.scale === 1) c.scale -= 0.0001;
      if (c.scale === 1.15) c.scale -= 0.0001;
      c.x += this.wind * 9 * this.cloudParallax(c.scale) * frames;
      // 海滩低云快速淡出（:399-402：kill + 0.005/帧，与下方通用 0.001 叠加 = 0.006）
      if (oceanFull && c.y > 200) {
        c.kill = true;
        c.alpha -= 0.005 * frames;
      }
      // 远空灰云（9-13）在下雨/阴天转为 kill 淡出（Cloud.cs:449-452）——
      // 它们是晴天专属；雨天出场的深色云是新刷出的 18-21 风暴云
      if (c.type >= 9 && c.type <= 13 && wr && (wr.cloudAlpha > 0 || wr.cloudBGActive >= 1)) {
        c.kill = true;
      }
      if (!c.kill && c.alpha < 1) c.alpha = Math.min(1, c.alpha + 0.001 * frames);
      if (c.kill) {
        c.alpha -= 0.001 * frames;
        if (c.alpha <= 0) c.alpha = 0;
      }
      c.rSpeed += (Math.random() * 21 - 10) * 2e-5 * frames;
      c.rSpeed = Math.max(-0.0002, Math.min(0.0002, c.rSpeed));
      c.rot = Math.max(-0.02, Math.min(0.02, c.rot + c.rSpeed * frames));
    }
    const off = 600;
    this.vclouds = this.vclouds.filter((c) => {
      const tex = this.cloudTex(c.type);
      const w = (tex?.width ?? 200) * c.scale;
      return c.alpha > 0 && c.x + w > -off && c.x < viewW + off;
    });
  }

  /** 维持云量（Cloud.cs UpdateClouds :230-296 1:1）：目标 = Main.numClouds【直连】
   *  （0-200 朵——★曾视口公式映射 8-21 朵=云量严重偏少）。缺 → 每帧 addCloud 一朵；
   *  超 → 每帧随机 kill 一朵。首次进场按 resetClouds(:39-59)：恰 numClouds 次
   *  addCloud 尝试——AABB 重叠拒绝即少一朵（★曾用 while 重试凑满 guard400：
   *  离线模拟 1920×1080/目标100 档 77 朵 vs 原版 46 朵，云量约 1.7 倍——
   *  "云太多"实报根因）。下雨加密由 Weather.updateCloudCounts（numClouds 强制
   *  爬升 200×cloudAlpha）自动传导。★IIIII218：菜单生成期 drunk 云量强制优先 */
  private targetCloudCount(): number {
    if (this.menuNumCloudsOverride !== null) return this.menuNumCloudsOverride;
    return this.weatherRef ? Math.max(0, Math.round(this.weatherRef.numClouds)) : 200;
  }

  /** ★IIIII218 菜单生成期云量强制（Main.cs:20021-20026 UpdateMenu：drunkWorldGenText →
   *  numClouds = dontStarveWorldGen ? 50 : Next(100,200) 每帧重掷）——MenuBackground
   *  注入/清除；null = 无强制（游戏内天空不受扰） */
  menuNumCloudsOverride: number | null = null;

  /** ★IIIII218 菜单生成期云型强制（Cloud.cs:352-388 Update 首支：drunkWorldGenText &&
   *  gameMenu → 每云每帧按 scale 档强制 type：shimmer=29/dontstarve=37-40/
   *  getgood=25/26/缺省 28）——MenuBackground 注入/清除；null = 无强制 */
  menuCloudTypeForce: ((scale: number) => number) | null = null;
  private cloudsInitialized = false;
  private maintainClouds(viewW: number, viewH: number) {
    const target = this.targetCloudCount();
    if (!this.cloudsInitialized) {
      this.cloudsInitialized = true;                       // resetClouds 铺满段
      for (let j = 0; j < target; j++) {                   // :47-50 恰 numClouds 次
        const c = this.spawnCloud(viewW, viewH, true);
        if (c) this.vclouds.push(c);
      }
      return;
    }
    let alive = 0;
    for (const c of this.vclouds) if (!c.kill) alive++;
    if (alive < target) {                                  // :291 每帧补一朵
      const c = this.spawnCloud(viewW, viewH, false);
      if (c) this.vclouds.push(c);
    } else if (alive > target) {                           // :292-300 随机 kill 一朵
      const idx: number[] = [];
      for (let i = 0; i < this.vclouds.length; i++) if (!this.vclouds[i].kill) idx.push(i);
      if (idx.length) this.vclouds[idx[Math.floor(Math.random() * idx.length)]].kill = true;
    }
  }

  /** 天气联动（Game.afterWorldLoad 注入）：风场以 weather 为权威（弃用内部迷你模型），
   *  云染色在下雨时向灰过渡（原版 cloudAlpha 下云变暗），闪电读 weather.lightning */
  weatherRef: import('../world/weather/Weather').WeatherState | null = null;
  attachWeather(w: import('../world/weather/Weather').WeatherState) {
    this.weatherRef = w;
  }

  /** 极光天空（AuroraSky.cs 1:1；激活门由 Game.updateWeather 接线） */
  readonly aurora = new AuroraSky();

  // ---- 事件天幕（SlimeSky/MartianSky：史莱姆雨剪影族 + 火星 UFO）----
  /** SlimeSky（SlimeSky.cs 1:1；激活门 = weatherRef.slimeRain 边沿,StartSlimeRain/
   *  StopSlimeRain 的 Activate/Deactivate 语义,Main.cs:64221/:64261） */
  readonly slimeSky = new SlimeSky();
  /** MartianSky（MartianSky.cs 1:1；激活门 = invasionType==4 轮询,Main.cs:58757-58763） */
  readonly martianSky = new MartianSky();
  /** 上帧 slimeRain 门（StartSlimeRain 事件语义的沿检测） */
  private slimeWasOn = false;
  /** Images/Misc/Sky_Slime_1-4（四帧竖排;0/1 常规 2/3 稀有档） */
  private slimeTexs: Array<ImageBitmap | HTMLImageElement | null> = [null, null, null, null];
  /** [0]=Extra_5 近档 28×42 三帧 / [1]=Extra_6 远档 70×90 三帧 */
  private martianTexs: Array<ImageBitmap | HTMLImageElement | null> = [null, null];
  /** [0]=Glow_90 / [1]=Glow_91（与主贴图同尺寸,同源矩形辉光叠画） */
  private martianGlowTexs: Array<ImageBitmap | HTMLImageElement | null> = [null, null];

  // ---- 沙尘暴/暴风雪色罩状态（SandstormSky/BlizzardSky 的 _opacity 渐变对） ----
  /** ManageSpecialBiomeVisuals 边沿 + Update ±ElapsedGameTime 秒渐变（两罩同构
   *  SandstormSky.cs:24-47：leaving 减到 0 → isActive=false） */
  private sandTintState = { active: false, leaving: false, opacity: 0 };
  private blizzTintState = { active: false, leaving: false, opacity: 0 };

  /** 塔天空激活时的云量乘子（GetCloudAlpha()；sky.draw 每帧写，drawVanillaClouds 读） */
  private towerCloudMul = 1;

  // ---- 器件驱动的天空效果（SceneMetrics 器件态；Renderer 每帧写入）----
  fx: {
    monolith: number; party: boolean; surfaceY: number; worldW: number; worldH: number;
    moonEventKind: 0 | 1 | 2;
  } =
    { monolith: -1, party: false, surfaceY: 0, worldW: 0, worldH: 0, moonEventKind: 0 };

  /** 天塔柱全屏滤镜颜色/不透明度（ScreenEffectInitializer.cs:18-21 FilterMiniTower 1:1；
   *  类型映射 SceneState.cs:111-115：0 星璇/1 星云/2 星尘/3 耀斑/4 月总）。
   *  【依赖登记】柱背景天空贴图（VortexSky/NebulaSky/StardustSky/SolarSky/MoonLordSky）
   *  与 FilterMoonLord 专用 shader 未接入——此处只有滤镜层 */
  private static readonly MONOLITH_FILTER: Record<number, readonly [number, number, number, number]> = {
    0: [0, 0.7, 0.7, 0.5],        // MonolithVortex（ScreenEffectInitializer.cs:21）
    1: [1, 0, 0.9, 0.35],         // MonolithNebula（:18）
    2: [0, 0.5, 1, 0.5],          // MonolithStardust（:20）
    3: [1, 0.7, 0, 0.3],          // MonolithSolar（:19）
    4: [0.35, 0.3, 0.42, 0.35],   // MonolithMoonLord（:24 FilterMoonLord——深紫压暗近似）
  };

  /** 天塔柱滤镜：multiply 混合近似 shader 染色（result = screen × mix(白, 柱色, opacity)）。
   *  原版为全屏后处理（Filters.Scene）；此处只染天空+群系背景层，tile 前景不染——
   *  视觉近似点登记 */
  drawMonolithFilter(ctx: CanvasRenderingContext2D, viewW: number, viewH: number): void {
    const f = SkyRenderer.MONOLITH_FILTER[this.fx.monolith];
    if (!f) return;
    const [r, g, b, a] = f;
    const mixv = (c: number) => Math.round(255 * (1 - a + c * a));
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${mixv(r)},${mixv(g)},${mixv(b)})`;
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.restore();
  }

  // ---- 派对气球天空（PartySky.cs 精简核：BirthdayParty.PartyIsUp 时激活）----
  private partyBalloons: Array<{ tex: number; variant: number; x: number; y: number; depth: number; speed: number }> = [];
  private partyTexs: Array<ImageBitmap | HTMLImageElement | null> = [null, null, null];

  /** 生成气球（PartySky.ResetBalloon :109-122 + GenerateBalloons :88-107：
   *  贴图 Extra_69/70 二选一（1/30 换 Extra_71）、variant 0-2、speed -1.5..-4、
   *  depth 1.6..3.35；X 绘制时模 4000 包裹 :325-330） */
  private spawnBalloon(viewH: number, respawn = false): void {
    this.partyBalloons.push({
      tex: Math.random() < 1 / 30 ? 2 : Math.floor(Math.random() * 2),
      variant: Math.floor(Math.random() * 3),
      x: Math.random() * 4000 - 500,
      y: respawn ? this.fx.surfaceY + 1600 : -viewH + Math.random() * (viewH + 1600),
      depth: 1.6 + Math.random() * 1.75,
      speed: -1.5 - 2.5 * Math.random(),
    });
  }

  // ---- 灯笼夜天空（LanternSky.cs 1:1，贴图 Extra_134 三变体 20×20）----
  private lanternTex: ImageBitmap | HTMLImageElement | null = null;
  private lanternOpacity = 0;   // _opacity：±0.01/帧向 LanternsUp 逼近（Update :119;★A3 债收齐后单源=advanceLanternNight）

  /** ★A3 债收齐（2026-10-01）:灯笼夜推进唯一写点（sky.draw 头每帧一次;underground
   *  亦推进=原版 Update 全局语义）。旧双调用双推进（far+near=±0.02/帧）退役。 */
  private advanceLanternNight(dtMs: number): void {
    const up = LanternNight.lanternsUp;
    this.lanternOpacity = Math.max(0, Math.min(1, this.lanternOpacity + (up ? 0.01 : -0.01) * (dtMs / (1000 / 60))));
  }

  /** ★A3 债收齐:GL 夹层会话发射标记（'lantern' near 会话/'ambgl' 鸟会话本帧成功
   *  over present 置位;Renderer 帧头清零）。消费=Renderer 世界段后 GL 增量合成
   *  （P1 合成先于 GL 会话的夹层路由帧,自拷源补全——c10eCompositeGlDelta 注）。 */
  glInterlayerEmitted = false;
  private lanterns: Array<{
    x: number; y: number; depth: number; speed: number; variant: number;
    time: number; timeMax: number; rot: number; active: boolean;
  }> = [];
  private lanternsLeaving = false;

  /** ResetLantern（LanternSky.cs:103-111）：depth = (1-i/N)×4.4+1.6、
   *  speed = -1.5-2.5×rand、变体 0-2、漂浮倒计时 (2000+rand1200)×2 */
  private resetLantern(l: { depth: number; speed: number; variant: number; time: number; timeMax: number }, i: number): void {
    l.depth = (1 - i / this.lanterns.length) * 4.4 + 1.6;
    l.speed = -1.5 - 2.5 * Math.random();
    l.variant = Math.floor(Math.random() * 3);
    l.time = (2000 + Math.floor(Math.random() * 1200)) * 2;
    l.timeMax = l.time;
  }

  /** GenerateLanterns（:83-101）：N = maxTilesY/4，Y 带在世界地表上方（视口高度的
   *  0.7 视差源 → num..num-screenHeight 对应世界 px 带） */
  private generateLanterns(): void {
    const N = Math.max(24, Math.floor(this.fx.worldH / 4));
    this.lanterns = new Array(N);
    const surfacePx = this.fx.surfaceY * 1; // tile → px（fx.surfaceY 已是 px）
    for (let i = 0; i < N; i++) {
      const l = {
        x: Math.random() * this.fx.worldW * 16, y: 0,
        depth: 0, speed: 0, variant: 0, time: 0, timeMax: 1, rot: 0, active: true,
      };
      // 原版 y 带 = rand(minValue..num)，num = screenY×0.7 - 屏高、min = num - 地表px
      l.y = surfacePx - 900 + Math.random() * 900;
      this.resetLantern(l, i);
      l.active = true;
      this.lanterns[i] = l;
    }
  }

  /** 灯笼夜夜空绘制（LanternSky.Update/Draw 1:1：浮升 + 风漂移 + 深度视差 + X 4000 包裹）。
   *  载体注明：原版为 SkyManager「Lantern」自定义天空层（spritebatch），此处 canvas 2D
   *  以同参数直接绘制（视差 (1/depth, 0.9/depth)×1.2、深度 alpha 分档 0.3-1.0、
   *  三份旋转光晕副本 + 主贴图 :243-254） */
  /** band: far=深度>5（远山之后,原版 DrawToDepth(5) 前带）/ near=深度≤5（全部山层
   *  之前,:59310 后带——LanternSky 深度 1.6..6.0 按带插入山层,曾全画山后） */
  private drawLanterns(ctx: CanvasRenderingContext2D, viewW: number, viewH: number, camX: number, camY: number, dtMs: number, band: 'far' | 'near' = 'far', gl?: GLSpriteLayer | null): void {
    // ★A3 债收齐:推进已上移 sky.draw 头 advanceLanternNight（单源 ±0.01/帧）——
    //  本方法只读 lanternOpacity（清理门保留）。
    const up = LanternNight.lanternsUp;
    // ★A3 灯笼夜帧回收（2026-10-01）:far 带每帧入口清残留 stash（未消费帧=本帧重产,
    //  同 farDeferred 入口清语义;sky.draw 深度门早退帧不清=与远云同款地下遮蔽语义）
    if (band === 'far') this.farLanternDeferred = null;
    if (this.lanternOpacity <= 0.001) {
      if (!up) { this.lanterns.length = 0; this.lanternsLeaving = false; }
      return;
    }
    // 相机在地表以下不画（Draw :165：screenPosition.Y > worldSurface×16 直接返回）
    if (camY > this.fx.surfaceY) return;
    if (!this.lanternTex) loadBitmapOnly('vanilla/Extra_134.png',
      () => !!this.lanternTex, (x) => { this.lanternTex = x; });
    if (this.lanterns.length === 0 || (up && this.lanternsLeaving)) {
      this.generateLanterns();
      this.lanternsLeaving = false;
    }
    if (!up && !this.lanternsLeaving) this.lanternsLeaving = true; // Deactivate：升顶后逐个熄灭
    const tex = this.lanternTex;
    const frames = dtMs / (1000 / 60);
    const wind = this.weatherRef ? this.weatherRef.windSpeedCurrent : this.wind;
    const w0 = wind === 0 ? 0.1 : wind;   // Update :126-130
    const N = this.lanterns.length;
    let drawing = 0;
    for (let i = 0; i < N; i++) {
      const l = this.lanterns[i];
      if (!l.active) continue;
      if (band === 'far' ? l.depth <= 5 : l.depth > 5) continue;   // 深度带分流
      // Update :131-149
      const num2 = Math.sin(l.x / 120) * 0.5;
      l.y += num2 * 0.5 * frames;
      l.y += (l.speed * (l.time / l.timeMax)) * 0.5 * frames;   // FloatAdjustedSpeed
      l.x += (0.1 + w0) * (3 - l.speed) * 0.5 * ((i / N) + 1.5) / 2.5 * frames;
      l.rot = num2 * (w0 < 0 ? -1 : 1) * 0.5;
      l.time = Math.max(0, l.time - frames);
      if (l.y < 300) {
        if (!this.lanternsLeaving) {
          this.resetLantern(l, i);
          l.y = this.fx.surfaceY + 1600;
          l.x = Math.random() * this.fx.worldW * 16;
        } else {
          l.active = false;
          continue;
        }
      }
      drawing++;
    }
    if (drawing === 0 || !tex || !(tex.width > 0) || tex.width === 0) return;
    const fw = tex.width / 3, fh = tex.height;
    const cx = camX + viewW / 2, cy = camY + viewH / 2; // 屏中心（世界 px）
    // ★BJ343 件 6：GTW 漏收编站收编——原版 LanternSky.cs:245 `(GlobalTimeWrappedHourly
    //  % 6f / 6f * 2π).ToRotationVector2().Y`（Y 分量=sin）。GTW 单源=暂停/失焦随世界
    //  冻结（BJ330 语义,原 performance.now 墙钟相位照走=漂移）
    const hourY = Math.sin((globalTimeWrappedHourly() % 6) / 6 * Math.PI * 2);
    const flicker = hourY * 0.2 + 0.8;                  // DrawLantern :245-246
    // ★A3 dispatch 前置（bird 'ambgl' 桥同款 all-or-nothing）:
    //  near+gl → 'lantern' mini-session:纹理预解析【先于】begin（B2b 判例——半截
    //  quads 不可回退）;任一失败=整支回 2D（宁回退不丢内容）。
    //  far+farDeferGate → 选集 stash（flushFarLanternGL 于 bg 会话首段发射=远云后/
    //  biomeBg 前原 2D 位 4741;bg 会话未开成=replayFarLantern2D 原位 2D 重放）。
    let glEntry: TexEntry | null = null;
    let glM: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
    let glK = 1;
    if (band === 'near' && gl && !gl.unavailable && gl.canvas.width > 0 && gl.canvas.height > 0) {
      const bt = ctx.getTransform();
      const k = Math.sqrt(Math.abs(bt.a * bt.d - bt.b * bt.c));   // 均匀标量（emitAmbienceGl 同式）
      if (Number.isFinite(k) && k > 0) {
        glEntry = gl.texFromImage('lantern:Extra_134', tex);
        if (glEntry) {
          gl.begin('lantern');
          if (gl.unavailable) glEntry = null;   // begin 失败:未发射未 present,2D 兜底
          else { glK = k; glM = [bt.a, bt.b, bt.c, bt.d, bt.e, bt.f]; }
        }
      }
    }
    const stash: Array<LanternPlan> | null = band === 'far' && this.farDeferGate ? [] : null;
    let stashM: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
    let stashK = 1;
    if (stash) {
      const bt = ctx.getTransform();
      const k = Math.sqrt(Math.abs(bt.a * bt.d - bt.b * bt.c));
      if (Number.isFinite(k) && k > 0) { stashK = k; stashM = [bt.a, bt.b, bt.c, bt.d, bt.e, bt.f]; }
    }
    for (let i = 0; i < N; i++) {
      const l = this.lanterns[i];
      if (!l.active) continue;
      // 深度 alpha 分档（:196-224）
      let mul = 1;
      if (l.depth > 5) mul = 0.3;
      else if (l.depth > 4.5) mul = 0.4;
      else if (l.depth > 4) mul = 0.5;
      else if (l.depth > 3.5) mul = 0.6;
      else if (l.depth > 3) mul = 0.7;
      else if (l.depth > 2.5) mul = 0.8;
      else if (l.depth > 2) mul = 0.9;
      const scale = (1 / l.depth) * 1.2, scaleY = (0.9 / l.depth) * 1.2;
      // 视差（:225-234）：(pos-屏中心)×(scale, scaleY)+屏中心，X 模 4000 包裹
      let sx = (l.x - cx) * scale + cx - camX;
      const sy = (l.y - cy) * scaleY + cy - camY;
      sx = (((sx + 500) % 4000) + 4000) % 4000 - 500;
      if (sx < -100 || sx > viewW + 100 || sy < -100 || sy > viewH + 100) continue;
      // ★A3 单灯计划（2D/GL/stash 三路单源——表达式逐字同旧 2D 内联式,防双路漂移）
      const plan: LanternPlan = {
        variant: l.variant, rot: l.rot, scale, sx, sy,
        alphaGlow: 0.4 * mul * this.lanternOpacity * flicker,
        alphaMain: 0.47 * mul * this.lanternOpacity,
      };
      if (glEntry) {
        this.emitLanternQuads(gl!, glEntry, { fw, fh, hourY, m: glM, k: glK }, plan);
        continue;
      }
      if (stash) { stash.push(plan); continue; }
      this.drawLanternPlan2D(ctx, tex, fw, fh, hourY, plan);
    }
    if (glEntry) { gl!.end(true, true); this.glInterlayerEmitted = true; return; }   // over present 入屏栈（bg 后/世界前）
    if (stash) {
      if (stash.length) this.farLanternDeferred = { plans: stash, tex, fw, fh, hourY, m: stashM, k: stashK };
      return;   // stash 帧:2D 落笔由 bg 会话 flush（GL）/原位 replay（回退）承担
    }
    ctx.globalAlpha = 1;
  }

  /** 极光绘制(AuroraSky.cs Draw/DrawAuroraSky):帧参数组装 + 地表门输入。
   *  月锚 = Main.LastCelestialBodyPosition(Main.cs:62458-62459 月屏位/ScreenSize;
   *  AuroraSky.cs:129-130 Y 侧再乘 (1920/1080)/(屏宽/屏高) 纵横比较正)——
   *  moonScreen 由本帧月亮分支写入(满月分支带 1/2 磁吸月位 :356-358 消费)。 */
  private drawAurora(ctx: CanvasRenderingContext2D, viewW: number, viewH: number,
    camY: number, dtMs: number, nightTicks: number, isDay: boolean, moonPhase: number): void {
    const zQ = this.frameCtx?.z ?? 1;
    const camTopTiles = (camY - viewH / 2 / zQ) / 16;   // Main.screenPosition.Y/16
    const ms = this.moonScreen;
    const moonFrac = ms
      ? { x: ms.x / viewW, y: (ms.y / viewH) * (1920 / 1080) / (viewW / viewH) }
      : null;
    this.aurora.draw(ctx, viewW, viewH, {
      nightTicks, isDay, moonPhase,
      camTopTiles,
      surfaceTiles: this.fx.surfaceY / 16,
      moonFrac,
      dtSec: dtMs / 1000,
    });
  }

  /** ★opresent 夹层谓词（2026-09-25,单 present 合并刀）：主画布在「天空栈 blit
   *  之后、世界 present 之前」是否有 2D 绘制内容夹层——true=本帧必回退双 blit
   *  （C10b 夹层判例同族:合并须无夹层）。覆盖面=本类四个夹层绘制位的早退条件
   *  析取,取保守超集（宁可不合并,不可漏判——谓词假阴=层序破坏）：
   *  · drawLanternsNear：lanternOpacity>0.001（首门,灯夜激活/衰减全程）;
   *  · drawPartyBalloonsNear：fx.party（派对气球整程）;
   *  · drawAmbience：事件天幕激活（史莱姆雨/火星人）/月总死亡戏剧（核心在场或
   *    碎块·爆炎滞留窗——终死后 dramaCore 已空但碎块仍画数秒,双查）/环境实体
   *    在场或本帧 tick 窗内可能到期掷族（Next(600,7200)=10-120s 一次,余量≤2
   *    tick 时本帧可能掷中;60fps ticks≤2）。shimmer 黑幕+人工星空（shimAlpha>0）
   *    的门在 Renderer 侧同源判定,此处不重复。 */
  opresentInterlayerPending(): boolean {
    if (this.lanternOpacity > 0.001) return true;
    if (this.fx.party && this.fx.surfaceY > 0) return true;
    if (this.slimeSky.isActive || this.martianSky.isActive) return true;
    if (this.dramaCore !== null || this.dramaPieces.length > 0 || this.dramaExplosions.length > 0) return true;
    if (this.ambEntities.length > 0 || this.pendingAmbientSpawns.length > 0) return true;
    if (!this.ambientRemoteDriven && this.ambNextAttempt <= 2) return true;
    return false;
  }

  /** ★C10e 二期（2026-10-01 F-inter 收刀）：世界路由谓词——opresentInterlayerPending
   *  去【鸟群三项】（ambEntities/pendingAmbientSpawns/ambNextAttempt≤2）。★A3
   *  （2026-10-01 灯笼夜帧回收）再去【lantern 项】:far/near 灯笼带已全 GL 桥化
   *  （far=bg 会话首段 stash、near='lantern' mini-session 落屏栈 bg 侧槽）,灯夜帧
   *  世界回归 over present 叠其上（纯帧零全幅 blit）。其余项（party/slime/martin/
   *  drama）未桥化=保持路由 F-inter 2D（层序正确性:未桥化内容只能画 HUD,其帧世界
   *  必须 blit 过去叠它）。★opresent 延迟门与合并门继续用【旧】谓词（鸟帧/灯帧禁
   *  pass3 合并/云并会——合并 present 是天空+世界单 quad,鸟 quads/灯 quads 无法
   *  插入其间=会被天空云盖住;分回合 bg present → 夹层 quads → 世界 present 才是
   *  正确层序）。 */
  worldRouteInterlayerPending(): boolean {
    if (this.fx.party && this.fx.surfaceY > 0) return true;
    if (this.slimeSky.isActive || this.martianSky.isActive) return true;
    if (this.dramaCore !== null || this.dramaPieces.length > 0 || this.dramaExplosions.length > 0) return true;
    return false;
  }

  /** 灯笼夜 near 带（深度≤5 的近灯 = 全部群系背景层之前,原版 :59310 后带）——
   *  Renderer 在 biomeBg.draw('surface') 之后调用。状态推进（opacity/本带运动环）
   *  在本调用内照跑（far 带调用点在 sky.draw 4741 位——两带各自推进一次,与桥化
   *  前逐位同）。★A3:gl 在场（纯帧+屏栈开）→ 'lantern' mini-session 直出 glCanvas
   *  （bg over-present 之后/世界 present 之前=原 2D 位）;任一环节失败=2D 原路径。 */
  drawLanternsNear(ctx: CanvasRenderingContext2D, viewW: number, viewH: number, camX: number, camY: number, dtMs: number, gl?: GLSpriteLayer | null): void {
    this.drawLanterns(ctx, viewW, viewH, camX, camY, dtMs, 'near', gl);
  }

  // ---- ★A3 灯笼夜帧回收（2026-10-01,C10e F-inter 收刀——bird 'ambgl' 桥同族） ----
  // 灯夜帧原由 farInterlayerActive lantern 项在帧头整帧打回 F-inter（每帧全幅 blit）。
  // 回收=两带全桥化:far 带 stash→bg 会话首段（flushFarLanternGL,C10d flushFarDeferredGL
  // 同款）;near 带 'lantern' mini-session over present（drawLanternsNear 调用点原位）。
  // 层序:远云 < far 灯 < biomeBg < 近云 < near 灯 < 世界,与 2D 序逐位同（far 灯在
  // bg FBO 内=sky2D 远云之上 ✓;near 灯会话在近云所在 bg present 之后 ✓）。

  /** ★A3 far 带选集 stash（drawLanterns far 帧内产,farDeferGate 门;Renderer bg 会话
   *  begin 后 flushFarLanternGL 消费;未消费帧=下一帧 far 带入口清——同 farDeferred
   *  「菜单帧单帧缺=不可见级」语义）。m/k=stash 时刻 ctx 变换（本仓天空段恒恒等
   *  ——相机在计划式内;留档防未来变换位）。 */
  private farLanternDeferred: {
    plans: LanternPlan[];
    tex: ImageBitmap | HTMLImageElement;
    fw: number; fh: number; hourY: number;
    m: [number, number, number, number, number, number]; k: number;
  } | null = null;

  /** ★A3:far 灯笼选集向已开启的 bg 会话发射（C10d flushFarDeferredGL 同款批令牌形态
   *  ——不 begin 不 end,quads 落 FBO('bg') 段=远云 stash 之后、biomeBg 之前=原 2D 位
   *  4741）。纹理解析失败=本帧弃（far 云同款 2830 语义——跳过不落 2D,防同帧混路径
   *  叠画）。plans 空=零提交。 */
  flushFarLanternGL(layer: GLSpriteLayer): void {
    const d = this.farLanternDeferred;
    this.farLanternDeferred = null;
    if (!d || !d.plans.length || layer.unavailable) return;
    const entry = layer.texFromImage('lantern:Extra_134', d.tex);
    if (!entry) return;
    for (const p of d.plans) this.emitLanternQuads(layer, entry, d, p);
  }

  /** ★A3 2D 回退:bg 会话未开成（acquire 退避/GL 死）时 far 灯笼 stash 原位 2D 重放
   *  （调用点=Renderer biomeBg 2D 之前、replayFarDeferred2D 之后=灯在云上/山层下
   *  =原层序）。 */
  replayFarLantern2D(ctx: CanvasRenderingContext2D): void {
    const d = this.farLanternDeferred;
    this.farLanternDeferred = null;
    if (!d) return;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (const p of d.plans) this.drawLanternPlan2D(ctx, d.tex, d.fw, d.fh, d.hourY, p);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** ★A3:单灯 2D 绘制（drawLanterns 2D 兜底与 far stash 2D replay 单源——逐位同旧
   *  内联式:translate·rotate + 光晕三副本(120° 均布×hourY 微摆,globalAlpha=glowA)
   *  + 主贴图(0.47·mul·opacity),source-over 最近邻（imageSmoothingEnabled=false）） */
  private drawLanternPlan2D(ctx: CanvasRenderingContext2D,
    tex: ImageBitmap | HTMLImageElement, fw: number, fh: number, hourY: number,
    p: { variant: number; rot: number; scale: number; sx: number; sy: number; alphaGlow: number; alphaMain: number }): void {
    ctx.save();
    ctx.translate(p.sx, p.sy);
    ctx.rotate(p.rot);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = p.alphaGlow;
    for (let k = 0; k < 3; k++) {
      const a = (Math.PI * 2 * k) / 3 + p.rot;
      ctx.drawImage(tex, fw * p.variant, 0, fw, fh,
        Math.cos(a) * 2 * hourY - (fw * p.scale * 2) / 2,
        Math.sin(a) * 2 * hourY - (fh * p.scale * 2) / 2, fw * p.scale * 2, fh * p.scale * 2);
    }
    // 主贴图：Color(250,120,60,120) × 分档 × 不透明度（:194-253）
    ctx.globalAlpha = p.alphaMain;
    ctx.drawImage(tex, fw * p.variant, 0, fw, fh,
      -(fw * p.scale * 2) / 2, -(fh * p.scale * 2) / 2, fw * p.scale * 2, fh * p.scale * 2);
    ctx.restore();
  }

  /** ★A3:单灯 GL 发射（near 'lantern' 会话与 far bg-FBO flush 共用）——光晕三副本
   *  在前、主贴图在后,序同 2D（save/rotate 内三 drawImage+主 drawImage=source-over
   *  叠序保序）。quadSprite(rot) 绕 dst 中心旋转 ≙ 2D translate(sx,sy)·rotate(rot)·
   *  drawImage 中心锚:副本中心 = 灯心 + R(rot)·wobble（2D 局部偏移 a=2πk/3+rot
   *  经 rotate(rot) 再旋=R(rot)·wobble,同构）;尺寸×k（ctx 均匀标量→设备像素）;
   *  smooth:false=2D imageSmoothingEnabled=false 同档。 */
  private emitLanternQuads(gl: GLSpriteLayer, entry: TexEntry,
    s: { fw: number; fh: number; hourY: number; m: [number, number, number, number, number, number]; k: number },
    p: { variant: number; rot: number; scale: number; sx: number; sy: number; alphaGlow: number; alphaMain: number }): void {
    const [ma, mb, mc, md, me, mf] = s.m;
    const dw = s.fw * p.scale * 2 * s.k, dh = s.fh * p.scale * 2 * s.k;
    const cx0 = ma * p.sx + mc * p.sy + me, cy0 = mb * p.sx + md * p.sy + mf;
    const cr = Math.cos(p.rot), sr = Math.sin(p.rot);
    for (let g = 0; g < 3; g++) {
      const a = (Math.PI * 2 * g) / 3 + p.rot;
      const ox = Math.cos(a) * 2 * s.hourY, oy = Math.sin(a) * 2 * s.hourY;
      gl.quadSprite(entry, p.variant * s.fw, 0, s.fw, s.fh,
        cx0 + cr * ox - sr * oy - dw / 2, cy0 + sr * ox + cr * oy - dh / 2, dw, dh,
        { alpha: p.alphaGlow, rot: p.rot, smooth: false });
    }
    gl.quadSprite(entry, p.variant * s.fw, 0, s.fw, s.fh,
      cx0 - dw / 2, cy0 - dh / 2, dw, dh,
      { alpha: p.alphaMain, rot: p.rot, smooth: false });
  }

  /** 派对气球 near 入口（PartySky 深 1.6..3.35 全 <5 = 全部背景层之前）——
   *  Renderer 在 biomeBg.draw('surface') 之后调用（原版 DrawToDepth(1) 带 :59621） */
  drawPartyBalloonsNear(ctx: CanvasRenderingContext2D, viewW: number, viewH: number, camX: number, dtMs: number): void {
    this.drawPartyBalloons(ctx, viewW, viewH, camX, dtMs);
  }

  // ================= 事件天幕（SlimeSky/MartianSky 1:1） =================

  /** 事件天幕激活动轮询 + 60Hz 推进（激活边沿 = 原版 Activate/Deactivate 调用点） */
  private stepEventSkies(frames: number, camX: number, camY: number, viewW: number, viewH: number): void {
    const fc = this.frameCtx;
    const zQ = fc?.z ?? 1;
    const maxTilesX = fc?.world?.w ?? Math.max(1, Math.round(this.fx.worldW));
    const maxTilesY = fc?.world?.h ?? Math.max(1, Math.round(this.fx.worldH));
    // Slime：StartSlimeRain/StopSlimeRain 的 Activate("Slime")/Deactivate（:64221/:64261）
    // ——事件驱动语义:雨再开时无条件 Activate(重生成+!isLeaving,即便上次还在
    // 排空;StartSlimeRain 对已在下的雨 return),故以 wasOn 沿驱动激活半边
    const slimeOn = !!this.weatherRef?.slimeRain;
    if (slimeOn && (!this.slimeSky.isActive || (this.slimeSky.isLeaving && !this.slimeWasOn))) {
      this.slimeSky.activate({
        maxTilesX, maxTilesY, surfacePx: this.fx.surfaceY,
        screenTopY: camY - viewH / 2 / zQ, screenHeight: viewH,
      });
    } else if (!slimeOn && this.slimeSky.isActive && !this.slimeSky.isLeaving) {
      this.slimeSky.deactivate();
    }
    this.slimeWasOn = slimeOn;
    // Martian：invasionType==4 轮询（Main.cs:58757-58763 同式）
    const martianOn = (fc?.world?.invasionType ?? 0) === 4;
    if (martianOn && !this.martianSky.isActive) {
      this.martianSky.activate(maxTilesX);
    } else if (!martianOn && this.martianSky.isActive && !this.martianSky.isLeaving) {
      this.martianSky.deactivate();
    }
    for (let f = 0; f < frames; f++) {      // SkyManager.Update 逐 tick（dayRate=1）
      this.slimeSky.update();
      this.martianSky.update();
    }
  }

  /** SlimeSky.Draw（:162-228）：深度档着色 + 视差投影 + X 4000 环绕 + ±1000 剔除。
   *  原版按 SkyManager 深度窗分段画（DrawToDepth 各段并集 = 全量）;本仓单段全画,
   *  远→近序（数组天然按 i 升序 = Depth 升序）等价。 */
  private drawSlimeSky(
    ctx: CanvasRenderingContext2D, viewW: number, viewH: number, camX: number, camY: number,
  ): void {
    const sky = this.slimeSky;
    if (!sky.isActive) return;
    const zQ = this.frameCtx?.z ?? 1;
    if (camY - viewH / 2 / zQ > 10000) return;                     // :164 screenPosition.Y>10000
    const cots = this.cots;
    if (!cots) return;
    for (const s of sky.entities) {
      if (!s.active) continue;                                     // :191
      const tex = this.slimeTex(s.tex);
      if (!tex || !(tex.width > 0) || tex.width === 0) continue;
      const p = slimeProject(s.x, s.y, s.depth, camX, camY, viewW, viewH);
      if (p.x < -1000 || p.x > viewW + 1000 || p.y < -1000 || p.y > viewH + 1000) continue;  // :222
      const col = slimeSilhouetteTint(cots, s.depth);              // :193-212
      const sprite = eventTintedSprite(tex,
        Math.round(col.r * 255), Math.round(col.g * 255), Math.round(col.b * 255), `slime${s.tex}`);
      if (!sprite) continue;
      const fh = tex.height / 4;                                   // :43 FrameHeight = 高/4
      const scale = (1 / s.depth) * 2;                             // :224 vector2.X×2
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, col.a));
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(sprite, 0, Math.floor(s.frame / 6) * fh, tex.width, fh,   // :61 帧行 = frame/6
        p.x, p.y, tex.width * scale, fh * scale);                  // origin (0,0)
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /** MartianSky.Draw（:258-300）：主贴图 ×(cots×0.9+0.1)×Opacity + 辉光白 ×Opacity,
   *  同变换同源帧叠画;origin (0,0) 绕左上旋。 */
  private drawMartianSky(
    ctx: CanvasRenderingContext2D, viewW: number, viewH: number, camX: number, camY: number,
  ): void {
    const sky = this.martianSky;
    if (!sky.isActive) return;
    const zQ = this.frameCtx?.z ?? 1;
    if (camY - viewH / 2 / zQ > 10000) return;                     // :260
    const cots = this.cots;
    if (!cots) return;
    const tint = ufoTintColor(cots);                               // :283
    const tr = Math.round(tint.r * 255), tg = Math.round(tint.g * 255), tb = Math.round(tint.b * 255);
    for (const u of sky.ufos) {
      if (!u.active) continue;                                     // :291
      const p = ufoProject(u.x, u.y, u.depth, camX, camY, viewW, viewH);
      if (p.x < -1000 || p.x > viewW + 1000 || p.y < -1000 || p.y > viewH + 1000) continue;
      const tex = this.martianTex(u.tex);
      if (!tex || !(tex.width > 0) || tex.width === 0) continue;
      const fh = tex.height / 3;                                   // :152 FrameHeight = 高/3
      const scale = (1 / u.depth) * 5 * u.scale;                   // :293 vector2.X×5×Scale
      const alpha = Math.max(0, Math.min(1, u.opacity));
      const row = Math.floor(u.frame / 4) * fh;                    // :187 源帧行 = frame/4
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(u.rotation);
      ctx.imageSmoothingEnabled = true;
      const sprite = eventTintedSprite(tex, tr, tg, tb, `martian${u.tex}`);
      if (sprite) {
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprite, 0, row, tex.width, fh, 0, 0, tex.width * scale, fh * scale);
      }
      const glow = this.martianGlowTex(u.glow);
      if (glow && glow.width > 0) {                                // :294-297 Color.White×Opacity
        ctx.globalAlpha = alpha;
        ctx.drawImage(glow as CanvasImageSource, 0, row, tex.width, fh, 0, 0, tex.width * scale, fh * scale);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  private slimeTex(i: number): ImageBitmap | HTMLImageElement | null {
    const t = this.slimeTexs[i];
    if (!t) loadBitmapOnly(`vanilla/Misc_Sky_Slime_${i + 1}.png`,
      () => !!this.slimeTexs[i], (x) => { this.slimeTexs[i] = x; });
    return t;
  }

  private martianTex(i: number): ImageBitmap | HTMLImageElement | null {
    const t = this.martianTexs[i];
    if (!t) loadBitmapOnly(`vanilla/Extra_${i === 0 ? 5 : 6}.png`,
      () => !!this.martianTexs[i], (x) => { this.martianTexs[i] = x; });
    return t;
  }

  private martianGlowTex(i: number): ImageBitmap | HTMLImageElement | null {
    const t = this.martianGlowTexs[i];
    if (!t) loadBitmapOnly(`vanilla/Glow_${i === 0 ? 90 : 91}.png`,
      () => !!this.martianGlowTexs[i], (x) => { this.martianGlowTexs[i] = x; });
    return t;
  }

  // ================= 沙尘暴/暴风雪色罩状态机（ManageSpecialBiomeVisuals + Update） =================

  /** 单罩状态推进（SandstormSky/BlizzardSky.Update :24-47 同构,纯边沿+渐变） */
  private static stepTintState(st: { active: boolean; leaving: boolean; opacity: number },
    gate: boolean, dtSec: number): void {
    if (gate !== st.active) {                                      // ManageSpecialBiomeVisuals :123-133
      if (gate) { st.active = true; st.leaving = false; }          // Activate(:59-63)
      else st.leaving = true;                                      // Deactivate(:65-68)
    }
    if (!st.active) return;
    if (st.leaving) {                                              // :30-37
      st.opacity -= dtSec;
      if (st.opacity < 0) { st.active = false; st.opacity = 0; }
    } else {                                                       // :39-46
      st.opacity += dtSec;
      if (st.opacity > 1) st.opacity = 1;
    }
  }

  /** 每帧驱动（sky.draw 头部调用;门输入与粒子系统/SceneState 同源） */
  stepWeatherTints(dtSec: number): void {
    const fc = this.frameCtx;
    const wr = this.weatherRef;
    const scene = fc?.scene;
    const player = fc?.player;
    // SceneState.cs:120:ManageSpecialBiomeVisuals("Blizzard", UseStormEffects && ZoneRain && ZoneSnow)
    const blizzOn = blizzardSkyGate(!!scene?.zoneRain, !!scene?.zoneSnow);
    // Sandstorm:ShowSandstormVisuals 本仓等价门（Game.weatherHooks.sandstormVisuals 同源）
    const sandOn = sandstormSkyGate(
      !!wr?.sandstorm.happening, !!scene?.zoneDesert,
      player ? player.cy / 16 : Infinity, fc?.world?.groundLevel ?? 0);
    SkyRenderer.stepTintState(this.sandTintState, sandOn, dtSec);
    SkyRenderer.stepTintState(this.blizzTintState, blizzOn, dtSec);
  }

  /** ★C10b 合并判定面（零分配）:天气色罩是否在场——与 weatherTintPasses 非空
   *  同判（cots 空=passes 恒空一并同判;判窄不判宽方向安全:误判在场只多走
   *  分回合回退,绝不误合并）。Renderer bg+云合并会话以此定谳有无 2D 夹层 */
  hasSkyWeatherTint(): boolean {
    if (!this.cots) return false;
    return this.sandTintState.opacity > 0.001 || this.blizzTintState.opacity > 0.001;
  }

  /** 色罩 pass 输出（Renderer.drawScreenFilterChain 头插;无 cots/零强度 → 空） */
  weatherTintPasses(): import('./GLScreenFilters').ScreenFxPass[] {
    const out: import('./GLScreenFilters').ScreenFxPass[] = [];
    const cots = this.cots;
    if (!cots) return out;
    const wr = this.weatherRef;
    if (this.sandTintState.opacity > 0.001) {
      const t = sandstormSkyTint(wr?.sandstorm.severity ?? 0, this.sandTintState.opacity, cots);
      out.push({ kind: 'SkyWeatherTint', color: t.color, alpha: t.alpha });
    }
    if (this.blizzTintState.opacity > 0.001) {
      const t = blizzardSkyTint(wr?.cloudAlpha ?? 0, this.blizzTintState.opacity, cots);
      out.push({ kind: 'SkyWeatherTint', color: t.color, alpha: t.alpha });
    }
    return out;
  }

  /** 2D 兜底（GL 不可用路径;source-over = XNA AlphaBlend 同式,精确非近似） */
  drawWeatherTint2D(ctx: CanvasRenderingContext2D, viewW: number, viewH: number): void {
    for (const p of this.weatherTintPasses()) {
      if (p.kind !== 'SkyWeatherTint') continue;
      // ★C10e（2026-10-01）：管线后端在场=色罩走 GL mini-session over present
      //  （glCanvas 栈位=bg 会话之后、近云会话之前——原 2D fillRect 的层序位;
        //  2D 画布侧无法落在两次 GL present 之间,fillQuad(白 tex×tint×α,premul
      //  over) ≙ fillRect(rgb,globalAlpha) 逐式）。旗关/GL 缺=ctx.fillRect 原路径
      //  （ctx 由调用方路由:c10e 帧传 sky2D——色罩位在 biomeBg(2D 回退)上）。
      const glLayer = this.c10eOver ? this.cloudGlLayer : null;
      if (glLayer && glLayer.pipeBackend && !glLayer.unavailable) {
        const a = Math.max(0, Math.min(1, p.alpha));
        if (a <= 0) continue;
        glLayer.resize(viewW, viewH);
        glLayer.begin('wtint');
        glLayer.fillQuad(0, 0, viewW, viewH,
          Math.max(0, Math.min(1, p.color[0])), Math.max(0, Math.min(1, p.color[1])),
          Math.max(0, Math.min(1, p.color[2])), a);
        glLayer.end(true, true);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));
      ctx.fillStyle = `rgb(${Math.round(p.color[0] * 255)},${Math.round(p.color[1] * 255)},${Math.round(p.color[2] * 255)})`;
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.restore();
    }
  }

  /** 派对气球绘制（PartySky.Update/Draw :130-198 精简核：上升 + 风漂移 + 视差 1/depth） */
  private drawPartyBalloons(ctx: CanvasRenderingContext2D, viewW: number, viewH: number, camX: number, dtMs: number): void {
    if (!this.fx.party || this.fx.surfaceY <= 0) {
      this.partyBalloons.length = 0;
      return;
    }
    // 相机在地表以下不画（PartySky.Draw :172：screenPosition.Y > worldSurface*16 直接返回）
    if (this.partyTexs[0] === null) {
      for (let i = 0; i < 3; i++) {
        loadBitmapOnly(`vanilla/Extra_${69 + i}.png`,
          () => !!this.partyTexs[i], (x) => { this.partyTexs[i] = x; });
      }
    }
    while (this.partyBalloons.length < 48) this.spawnBalloon(viewH);
    const frames = dtMs / (1000 / 60);
    const wind = this.wind;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (const b of this.partyBalloons) {
      b.y += b.speed * frames;
      b.x += wind * (3 - b.speed) * frames;
      if (b.y < -viewH) {  // 升出屏顶：重掷（PartySky.Update :151-158）
        b.y = this.fx.surfaceY + 1600;
        b.x = Math.random() * 4000 - 500;
        b.tex = Math.random() < 1 / 30 ? 2 : Math.floor(Math.random() * 2);
        b.variant = Math.floor(Math.random() * 3);
        b.speed = -1.5 - 2.5 * Math.random();
        b.depth = 1.6 + Math.random() * 1.75;
      }
      const tex = this.partyTexs[b.tex];
      if (!tex || !(tex.width > 0) || tex.width === 0) continue;
      // 视差（:320-322：(pos - 屏中心) × (1/depth, 0.9/depth) + 屏中心）+ X 4000 包裹（:325-330）
      const par = 1 / b.depth;
      const sx = (((b.x - camX) * par + camX + 500) % 4000 + 4000) % 4000 - 500;
      const sy = (b.y - viewH / 2) * (0.9 * par) + viewH / 2;
      const fw = tex.width / 3, fh = tex.height / 3;
      const scale = par * 2 * 0.9;  // :337 vector2.X * 2 × 天色亮度 0.9 近似
      ctx.globalAlpha = 0.8;
      ctx.drawImage(tex, fw * b.variant, 0, fw, fh, sx, sy, fw * scale, fh * scale);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** 原版三层绘制（DrawClouds_Distant/Closer/Closest + NextHorizonRenderer.DrawCloud）：
   *  按视口宽缩放（cloud.position.Y*(H/600) 语义近似为 y 带），远景(scale<1)压暗 R/G 通道。 */
  private lastCloudCamX: number | null = null;
  /** ★BJ103-A1b（2026-09-16）：传送黑幕面云视差锚清零（Cloud.lastCameraCenter=null,
   *  Main.cs:63518）——updateClouds 视差支（Cloud.cs:307-311 UpdateCloudParallax）对
   *  null 锚按位移 0 处理,远距跳镜不把传送距离当云层视差位移。调用方=Game.
   *  blackFadeCameraTeleport。 */
  resetCloudCamAnchor(): void {
    this.lastCloudCamX = null;
  }
  /** 垂直视差因子与 bgTopY（DrawSurfaceBG :58743-58744）：num3 = (300−camTop)/(worldSurface×16)、
   *  bgTopY = num3×1200+1190（scAdj=0）——云三通道 Y 变换的锚（fx.surfaceY=groundLevel×16） */
  private cloudBgTop(camY: number, viewH: number): { num3: number; bgTopY: number } {
    const camTop = camY - viewH / 2;
    const num3 = (300 - camTop) / Math.max(1, this.fx.surfaceY);
    return { num3, bgTopY: num3 * 1200 + 1190 };
  }
  /** 云三通道（Main.cs DrawClouds_Distant :59112 / _Closer :59093 / _Closest :59073）：
   *  distant（scale<1）画在群系背景【后】= sky 层内（DrawSurfaceBG 层间 :58755-58758）；
   *  closer/closest 画在背景【前】（drawCloudsNear，Renderer 于 biomeBg.draw 后调）。
   *  地表上门 = camTop < worldSurface×16+16（:59119） */
  /** drawCloudPass 实参 scratch(2026-08-24:替代每帧 filter()+[...spread] 双分配;
   *  drawCloudPass 契约 = 可原地 sort 的副本,同步消费完即弃) */
  private cloudScratch: VanillaCloud[] = [];

  private drawVanillaClouds(ctx: CanvasRenderingContext2D, viewW: number, viewH: number, isNight: boolean, dtMs: number, camX = 0, camY = 0) {
    this.updateClouds(dtMs, viewW, camX);
    if (!this.frameCtx?.paused) this.maintainClouds(viewW, viewH);   // 暂停冻结（UpdateClouds 同门 :17199）
    const camTop = camY - viewH / 2;
    // ★A3 债收齐（2026-10-01）:深度门早退帧【先】清残留 stash（旧=清位在门后,
    //  地下帧上一帧未消费 stash 存活到下个 bg 会话=单帧陈旧 flush;地下不透明 bg
    //  遮蔽虽备案良性,错帧内容仍不正——farLanternDeferred 入口清语义对齐）
    if (camTop >= this.fx.surfaceY + 16) { this.farDeferred = null; return; }
    this.updateCloudCelestial(camY - viewH / 2);
    const { num3 } = this.cloudBgTop(camY, viewH);
    const distY = num3 * 750 + 830;                          // :59115（scAdj/pushBGTopHack=0）
    const scratch = this.cloudScratch;
    scratch.length = 0;
    for (const c of this.vclouds) if (c.scale < 1) scratch.push(c);
    // ★C10d 远云并入 bg 会话（2026-09-30）:门=Renderer 前置（bg 会话将开+无色罩/
    //  黑闪）×夹层判定（极光 tileColorState 非空/far 灯笼夜活跃——同帧状态法,无
    //  prev 帧陈旧）。命中=pass1 选集 stash,section 1.5 的 bg 会话首段发射
    //  （batch 令牌既有机制,层序=远云在 biomeBg 前=原位）;夹层在场=独立会话+blit
    //  原路径（极光/far 灯笼画其上=原版序 :58829/:59310）。每帧入口清残留 stash。
    //  ★A3（2026-10-01）lantern 项保留 rationale 更新:far 灯笼带已 GL 桥化
    //  （stash→bg FBO 首段/2D 回退 replay）,恒落 sky2D 远云【之上】——若本处摘项
    //  把远云 stash 进 FBO,2D 回退帧（bg 会话未开成）远云 replay 与灯 replay 虽保序,
    //  但 GL 帧远云 quads 与灯 quads 的相对层序依赖 flush 调用序,且灯夜帧远云将
    //  离开「同帧状态法」保守面。维持灯夜帧远云 2D 直画=灯恒在云上（原版序）,
    //  farInterlayerActive（帧分类用）已摘 lantern 项,两谓词自此分工不同（方法注）。
    this.farDeferred = null;
    const farInterlayer = this.aurora.tileColorState() !== null
      || (this.lanternOpacity > 0.001 && camY <= this.fx.surfaceY);
    if (this.farDeferGate && !farInterlayer && scratch.length) {
      this.farDeferred = { clouds: scratch.slice(), distY, camY };
      void isNight;
      return;
    }
    this.drawCloudPass(ctx, scratch, 1, camY,
      (c) => c.y + distY);
    void isNight;
  }

  /** ★C10d:远云选集向已开启的 bg 会话发射（batch 令牌=无 session/blit,收口归
   *  drawCloudsNear/compose pass3——远云 quads 落 FBO('bg') 首段=biomeBg 前=原层序）。
   *  ctx=主画布（drawCloudPass 的视口裁剪读 canvas 尺寸用）。 */
  flushFarDeferredGL(layer: GLSpriteLayer, ctx: CanvasRenderingContext2D): void {
    const d = this.farDeferred;
    this.farDeferred = null;
    if (!d) return;
    this.drawCloudPass(ctx, d.clouds, 1, d.camY, (c) => c.y + d.distY,
      { openGl: () => layer });
  }

  /** ★C10d 2D 回退:glbg 未开成（acquire 退避窗）时原位 2D 直画（force2D 绕过
   *  GL 获取,cloudTint 路径与独立会话帧逐位同）。 */
  replayFarDeferred2D(ctx: CanvasRenderingContext2D): void {
    const d = this.farDeferred;
    this.farDeferred = null;
    if (!d) return;
    this.drawCloudPass(ctx, d.clouds, 1, d.camY, (c) => c.y + d.distY, undefined, true);
  }
  /** 上帧昼夜/月相（sky.draw 头部写入;CloudsEnd 天体色/强度输入） */
  private lastMoonPhase = 0;
  private lastIsDay = true;
  /** Main.cloudBGAlpha（:58782-58792 漂移累积器：背景云活跃 +0.0005·dayRate/帧
   *  钳 1,否则 − 同步钳 0;门 = !drunkWorld && ShouldDrawSurfaceBackground &&
   *  camTop ≤ worldSurface+10 tile）。CloudsEnd 强度 ×clamp(1−值) */
  private cloudBGAlpha = 0;
  /** CloudsEnd 每帧天体态（HorizonClouds shader 输入;drawCloudPass 消费） */
  private cloudCelestial: {
    posX: number; posY: number; intensity: number;
    r: number; g: number; b: number;
  } | null = null;

  /** CloudsEnd 天体态计算（NextHorizonRenderer.cs:328-361 逐式）：
   *  uColor = dayTime ? (255,246,204) : GetMoonColor()×GetMoonStrength()（AuroraSky.
   *  ModifyTileColor :410-418 极光活跃且月相≠QuarterAtLeft(3) 时向 _lastSkyColor
   *  lerp opacity）;强度 = max(sunset,sunrise)×celestial,夜 max(·,celestial×0.15),
   *  ×clamp(1−cloudBGAlpha);位置 = GetCelestialBodyPosition = sunScreen/moonScreen。 */
  private updateCloudCelestial(camTop: number): void {
    // cloudBGAlpha 累积器（:58781-58792;ShouldDrawSurfaceBackground ≈ 本方法调用门）
    const dayRate = this.frameCtx?.world?.dayRate?.() ?? 1;
    const camTopTiles = camTop / 16;
    if (!this.frameCtx?.world?.seedFlags?.drunkWorld && camTopTiles <= this.fx.surfaceY / 16 + 10) {
      const d = 0.0005 * dayRate;
      this.cloudBGAlpha = this.weatherRef && this.weatherRef.cloudBGActive > 0
        ? Math.min(1, this.cloudBGAlpha + d)
        : Math.max(0, this.cloudBGAlpha - d);
    }
    const v = this.horizonVisCache;
    const body = this.lastIsDay ? this.sunScreen : this.moonScreen;
    if (!v || !body) { this.cloudCelestial = null; return; }
    let num = Math.max(v.sunset, v.sunrise) * v.celestial;
    if (!this.lastIsDay) num = Math.max(num, v.celestial * 0.15);   // :348-349
    num *= Math.max(0, Math.min(1, 1 - this.cloudBGAlpha));         // :350
    if (num <= 0.0015) { this.cloudCelestial = null; return; }
    // uColor（GetCelestialBodyColors HorizonHelper.cs:109-113 + MoonColors 表 :28-36）
    let r: number, g: number, b: number;
    if (this.lastIsDay) {
      r = 255; g = 246; b = 204;
    } else {
      const moonType = Math.max(0, Math.min(8, this.moonType));
      const mc = MOON_COLORS[moonType];
      r = mc[0]; g = mc[1]; b = mc[2];
      if (this.fx.moonEventKind === 2) { r = 255; g = 225; b = 180; }        // pumpkinMoon(MOON_KIND_PUMPKIN=2)
      else if (this.fx.moonEventKind === 1) { r = 220; g = 220; b = 255; }   // snowMoon(MOON_KIND_FROST=1)
      if (this.frameCtx?.world?.seedFlags?.drunkWorld) { r = 255; g = 255; b = 255; }
      // GetMoonStrength = Remap(|4−phase|, 0,4, 0,1) = |4−phase|/4
      const ms = Math.abs(4 - this.lastMoonPhase) / 4;
      r *= ms; g *= ms; b *= ms;
    }
    // AuroraSky.ModifyTileColor(ref tileColor, 1)（:410-418:极光活跃 && 月相≠3
    // → lerp(tileColor, _lastSkyColor(A=255), opacity)）
    const aur = this.aurora.tileColorState();
    if (aur && this.lastMoonPhase !== 3) {
      const t = Math.min(1, Math.max(0, aur.opacity));
      r = r + (aur.rgb[0] - r) * t;
      g = g + (aur.rgb[1] - g) * t;
      b = b + (aur.rgb[2] - b) * t;
    }
    this.cloudCelestial = { posX: body.x, posY: body.y, intensity: num, r: r / 255, g: g / 255, b: b / 255 };
  }
  /** DrawClouds_Closer + _Closest（:58871/:58942——群系背景层之后）：
   *  pass2 scale∈[1,1.15)：cY = y×(H/600)+bgTopY+150；pass3 ≥1.15：cY = y×(H/600)−100+bgTopY×1.01−150。
   *  which 分 pass 选择（2026-08-24 菜单插层：原版 DrawSurfaceBG 层序 cs:60386/:60457
   *  把两 pass 夹在远山 Step1/Step2 与树层之间——菜单经 BiomeBackground.drawMenu 的
   *  near 回调分次调用；游戏内 Renderer 缺省 'both' 行为零改动 */
  /** ★C10b mergedSession:Renderer 在 bg GL 会话无 2D 夹层内容时预开的「bg+云合并
   *  会话」（begin('bg') 已清屏+已交 bg quads,本方法必须收口——含早退路径,否则
   *  bg 永不回贴）。收口=单次 present+单次【全幅】blit（bg 覆盖面不以云 bbox 为界,
   *  cloudBlitRect 的 bbox 收口不适用）。会话中途死亡(unavailable)照旧 blit——
   *  present 对死管线 no-op,画布为陈旧帧=既有 GL 死亡窗同族语义,下帧 acquire 自愈 */
  drawCloudsNear(ctx: CanvasRenderingContext2D, viewW: number, viewH: number, camY: number,
    which: 'both' | 'closer' | 'closest' = 'both',
    mergedSession?: GLSpriteLayer | null,
    /** ★opresent（2026-09-25）:true=合并会话收口不 present 不 blit——FBO('bg')
     *  内容挂起在管线,由 worldCompose compose 尾 pass3 over(warped, sky) 直采后
     *  单 present 消费（单 present 合并刀:天空栈+世界合成两次全屏回贴并成一次）。
     *  仅 mergedSession 在场且 Renderer 已锁定全部门（opresentWanted）时传 true;
     *  消费端任一环失败由 Renderer.presentPendingSky 补贴 present+blit（回退双
     *  blit 基线）。 */
    deferBlit = false) {
    // ★C10b:合并会话先收权(所有路径必收口——早退含,防 bg 丢;★opresent defer=
    //  收口不 present/blit,FBO 挂起给 pass3,消费失败 Renderer 补贴)
    const merged = mergedSession ?? null;
    const camTop = camY - viewH / 2;
    if (camTop >= this.fx.surfaceY + 16) {
      if (merged) {
        merged.end(!deferBlit, !deferBlit && this.c10eOver);
        // ★C10e:管线后端 over present=glCanvas 直出（早退支同样叠合进屏栈）,
        //  跳过 2D blit;非管线/旗关=原路径
        if (!deferBlit) {
          SkyRenderer.cloudBlitStats.mergedFull++;
          if (!(this.c10eOver && merged.pipeBackend)) { ctx.drawImage(merged.canvas, 0, 0); }
          ctx.globalAlpha = 1;
        }
        else SkyRenderer.cloudBlitStats.mergedDefer++;
      }
      return;
    }
    const { bgTopY } = this.cloudBgTop(camY, viewH);
    const sH = viewH / 600;
    const scratch = this.cloudScratch;   // 两 pass 同步消费,单 scratch 顺序复用
    // #perf2026-08-26(trace 热点:云近双通道各一次全屏 blit):'both' 下 pass2/pass3
    // 同处一个层序位(biomeBg 之后、树层之前——Renderer.ts 唯一调用点),共享一个
    // GL 会话(单 resize+单 clear+单次全屏合成)。gl.quad/cloudQuad 经 uniform+
    // drawArrays 同步消费几何、无惰性引用 → 单 scratch 在两通道间重填安全。
    // 菜单侧 MenuBackground 分 'closer'/'closest' 注入调用 = 两通道夹不同层,
    // 必须各自独立会话(不传批令牌,走原路径)。
    // ★舍入界(实机探针 scripts/_perf-parity-probe.mjs 实证):porter-duff over 可
    // 结合,但两条路径的 8bit 中间量化分组不同 → 云贴图半透明重叠像素 ±1~2 LSB
    // (实测 988×862 全屏 67 像素差,maxΔ=2;无重叠即逐位同)。方向中性且更贴近
    // 原版 SpriteBatch 单背板流式语义。?cloudbatch=0 一键回退独立会话。
    // ★C10b:合并会话优先(已由 Renderer begin,绕过 batchBoth/cloudcache 语义——
    //  会话本体已是 bg+云单背板,±1~2LSB 备案口径同 cloudbatch 判例)。
    let shared: GLSpriteLayer | null = null;
    let mergedMode = false;
    if (merged) {
      shared = merged;
      mergedMode = true;
    } else if (which === 'both' && SkyRenderer.batchBoth) {
      const g = this.useGLClouds ? this.cloudGlLayer : null;
      shared = g && !g.unavailable ? g : null;
    }
    if (shared && !mergedMode && SkyRenderer.cloudRegionBlit) this.cloudBlitBoxReset();   // 'both' 批会话 bbox 跨两通道累积,会话头清零(合并会话全幅 blit 不消费 bbox,免重置)
    let batchBegun = mergedMode;   // ★合并会话已由 Renderer begin——禁再 begin(begin=清屏会抹掉已交 bg quads)
    /** 懒开启共享会话(首个非空通道触发;两通道全空则零工作=旧 early-return 语义) */
    const openBatch = (): GLSpriteLayer | null => {
      if (!shared) return null;
      if (!batchBegun) {
        shared.resize(ctx.canvas.width, ctx.canvas.height);
        shared.begin();
        batchBegun = true;
      }
      return shared;
    };
    const finishBatch = () => {
      if (shared && batchBegun) {
        // ★C10e:管线后端 over=屏直出（glCanvas 栈式叠合,defer 语义不变——defer 帧
        //  FBO 挂起给 pass3,消费端补贴走 over 同栈）;跳过 2D blit
        shared.end(!deferBlit, !deferBlit && this.c10eOver);
        const directOut = this.c10eOver && !!shared.pipeBackend;
        if (mergedMode) {
          // ★C10b 合并收口:bg+云单背板【全幅】blit(单次 drawImage 替代旧
          //  「bg 全幅+云 bbox」两次;bg 层平铺全宽,bbox 收口不适用)
          //  ★opresent:deferBlit=跳过 blit——FBO('bg') 挂起,世界合成 pass3 消费
          if (!deferBlit) { SkyRenderer.cloudBlitStats.mergedFull++; if (!directOut) ctx.drawImage(shared.canvas, 0, 0); }
          else SkyRenderer.cloudBlitStats.mergedDefer++;
        } else if (!directOut) {
          SkyRenderer.cloudBlitStats.bboxBoth++;
          this.cloudBlitRect(ctx, shared);      // ★perf3:全幅→当帧 bbox 子矩形(?cloudcache=0 退全幅;空 bbox=零提交,跳过=旧全透明 blit 同效)
        } else {
          SkyRenderer.cloudBlitStats.bboxBoth++;   // C10e 直出帧同位记账（无 blit）
        }
        ctx.globalAlpha = 1;
      }
    };
    const batch = shared ? { openGl: openBatch } : undefined;
    if (which !== 'closest') {
      scratch.length = 0;
      for (const c of this.vclouds) if (c.scale >= 1 && c.scale < 1.15) scratch.push(c);
      if (scratch.length || !batch) {          // 空选集在批模式下不再单独 begin+blit
        this.drawCloudPass(ctx, scratch, 2, camY,
          (c) => c.y * sH + bgTopY + 150, batch);
      }
    }
    if (which !== 'closer') {
      scratch.length = 0;
      for (const c of this.vclouds) if (c.scale >= 1.15) scratch.push(c);
      if (scratch.length || !batch) {
        this.drawCloudPass(ctx, scratch, 3, camY,
          (c) => c.y * sH - 100 + bgTopY * 1.01 - 150, batch);
      }
    }
    finishBatch();
    void viewW;
  }
  /** 单通道绘制（云色链 NextHorizonRenderer.DrawCloud :246-268 1:1）：
   *  cloudColor = ColorOfTheSkies×(scale×Alpha) → pass1 压暗 → ×atmo（二次）→ α×globalCloudAlpha
   *  （:58752 = max(cloudAlpha,墓园×.92)×atmo；ColorOfTheSkies 源 = 本帧天空色,存储侧已×atmo）
   *  ★clouds 实参契约(2026-08-24 热点修复):调用方必须传可复用 scratch 副本
   *  (cloudScratch)——本函数原地 sort,不再 [...clouds] 每帧双分配;
   *  ★屏外裁剪(2026-08-24):视口外云(含旋转余量)跳过染色+绘制——原版 XNA
   *  SpriteBatch 照画但 GPU 裁剪零成本,Canvas2D 每朵是真实 drawImage+烘焙,
   *  菜单 200 云实测 ~1/3 完全屏外(trace:云合成 2.4s+重烘 2.0s/54s 里的
   *  白耗部分)。视口内渲染结果逐像素不变 */
  private drawCloudPass(
    ctx: CanvasRenderingContext2D, clouds: VanillaCloud[], pass: 1 | 2 | 3,
    camY: number, yOf: (c: VanillaCloud) => number,
    /** 共享批令牌(#perf2026-08-26,'both' 双通道合并专用):传入时本函数只向调用方
     *  已开启的 GL 层提交四边形,跳过 begin 与尾blit(统一由 drawCloudsNear 收口);
     *  返回 null=GL 不可用 → 本 pass 走 2D 兜底直画(与独立路径一致)。
     *  ★C10d:force2D=true=绕过 GL 获取直走 2D cloudTint（远云 stash 的 no-GL
     *  回放专用;批令牌在场时 force2D 优先）。 */
    batch?: { openGl: () => GLSpriteLayer | null },
    force2D = false,
  ) {
    if (!clouds.length) return;
    const atmo = this.atmoValue(camY);
    // ProcessCloudAlpha(SkyManager.cs)1:1:num5 = ProcessCloudAlpha() × atmo,
    // 其中 ProcessCloudAlpha = 1 × Π(激活 CustomSky.GetCloudAlpha())——原版仅
    // 月总/四塔天空 override 为 1-fade(MoonLordSky.cs:72),默认恒 1,墓园不压云。
    // ★wr.cloudAlpha 是【雨云浓度】(IsItRaining 门;雨天 UpdateClouds 换风暴云族
    // 18-21 用),不进此门——曾误接 max(cloudAlpha,墓园×.92) → 晴天云全透明
    // (2026-08-18 用户实报"好多云不渲染";本仓暂无塔/月总天空 fade,乘积恒 1)
    const globalCloudAlpha = atmo;
    void this.weatherRef;
    // ColorOfTheSkies 单源(2026-08-20 原版化):云色直接吃 SetBackColor 曲线
    // (月相地板/血月/晨昏全对齐,原版 Cloud.cloudColor(Main.ColorOfTheSkies));
    // 首帧前回落渐变近似
    const sky = this.cots
      ? [this.cots[0] * atmo, this.cots[1] * atmo, this.cots[2] * atmo]
      : hexRGB(this.lastSkyTop, atmo);
    clouds.sort((a, b) => b.scale - a.scale);   // scale 交换序等价(原地,scratch 契约)
    const viewW = ctx.canvas.width, viewH = ctx.canvas.height;
    const cullM = 64;   // 旋转(≤0.1rad)+半屏外渐入余量;超出即完全不可见
    // GL 主路径(2026-08-18):逐精灵顶点色 = 原版 Draw(Color) 语义,精确色零副本;
    // 不可用(WebGL2 缺失/上下文死亡退避/cpuRender/?cloudgl=0)→ 2D cloudTint 兜底
    // #A 合并(2026-08-19):云不再持有独立 WebGL 上下文——与背景层共用
    // Renderer.glfx(每帧注入;不可用/退避/cpuRender/?cloudgl=0 → 2D cloudTint 兜底)
    let gl: GLSpriteLayer | null;
    if (batch && !force2D) {
      gl = batch.openGl();
    } else {
      const glRaw = this.useGLClouds ? this.cloudGlLayer : null;
      gl = glRaw && !glRaw.unavailable ? glRaw : null;
      // 独立会话(pass1 远景/菜单 'closer'/'closest'):bbox 会话头清零(批模式由
      // drawCloudsNear 头清零后跨通道累积)
      if (gl) { gl.resize(ctx.canvas.width, ctx.canvas.height); if (SkyRenderer.cloudRegionBlit) this.cloudBlitBoxReset(); gl.begin(); }
    }
    ctx.save();
    ctx.imageSmoothingEnabled = true; // 原版云为软边贴图，平滑缩放(2D 兜底路径)
    for (const c of clouds) {
      const tex = this.cloudTex(c.type);
      if (!tex || !(tex.width > 0) || tex.width === 0) continue;
      const w = tex.width * c.scale, h = tex.height * c.scale;
      const cx = c.x + w / 2, cyPx = yOf(c) + h / 2;         // uDrawPosition = 云中心(DrawData.position,origin=半尺寸)
      // ★屏外裁剪(先于染色/GL 提交;旋转 ≤0.1rad 的 bbox 膨胀 < 64px 余量)
      if (cx + w / 2 < -cullM || cx - w / 2 > viewW + cullM ||
          cyPx + h / 2 < -cullM || cyPx - h / 2 > viewH + cullM) continue;
      const k = Math.min(1, c.scale * c.alpha);              // cloudColor num（:203-215）
      let r = sky[0] * k, g = sky[1] * k, b = sky[2] * k;
      if (pass === 1) {                                      // OriginalColorsForCloud（:259-268）
        r *= c.scale * 0.8;
        g *= ((c.scale + 1) / 2) * 0.9;
      }
      r *= atmo; g *= atmo; b *= atmo;                       // DrawCloud :252-255
      const alpha = Math.min(1, Math.min(1, c.alpha * this.towerCloudMul) * globalCloudAlpha);
      // ---- HorizonClouds（obj62 逐指令;CloudsEnd 对三通道全部 _drawData 施加）----
      // GL 主路径 = 逐像素字节码公式(GLSpriteLayer.cloudQuad);2D 兜底 = 同公式
      // 单探针标量近似(horizonCloudShadeApprox:几何/强度/衰减精确,A/R 固定)
      const cel = this.cloudCelestial;
      if (gl) {
        const gtex = gl.texFromImage(`cloud:${c.type}`, tex);
        if (gtex) {
          if (SkyRenderer.cloudRegionBlit) this.cloudBlitBoxAdd(cx, cyPx, w, h, c.rot);
          if (cel && gl.cloudFxOK) {
            gl.cloudQuad(gtex, 0, 0, gtex.w, gtex.h, c.x, yOf(c), w, h, c.rot, !!c.flip, {
              drawPos: [cx, cyPx],
              celestial: [cel.posX, cel.posY, cel.intensity],
              color: [cel.r, cel.g, cel.b],
              vertColor: [r / 255, g / 255, b / 255, alpha],
            });
          } else {
            gl.quad(gtex, 0, 0, gtex.w, gtex.h, c.x, yOf(c), w, h,
              { alpha, tint: [r / 255, g / 255, b / 255], rot: c.rot, smooth: true, flipX: !!c.flip });
          }
          continue;
        }
        // 纹理上传失败(极端):跳过本朵,不落 2D(避免同帧混路径叠画)
        continue;
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(cx, cyPx);
      ctx.rotate(c.rot);
      if (c.flip) ctx.scale(-1, 1);
      let tR = r, tG = g, tB = b, tA = alpha;
      if (cel) {
        // 2D 兜底:shade 单探针标量 + 字节码尾式 final = v + shade·(lerp(v,u,0.5)·v.a − v)
        // (tex.rgb=1/tex.a=1 整朵近似;登记取舍见函数头)
        const shade = horizonCloudShadeApprox(cel, cx, cyPx, w, h, Math.max(w, h) * 0.3);
        const v0c = r / 255, v1c = g / 255, v2c = b / 255;
        const lc = [v0c + (cel.r - v0c) * 0.5, v1c + (cel.g - v1c) * 0.5, v2c + (cel.b - v2c) * 0.5];
        tR = Math.max(0, Math.min(255, 255 * (v0c + shade * (lc[0] * alpha - v0c))));
        tG = Math.max(0, Math.min(255, 255 * (v1c + shade * (lc[1] * alpha - v1c))));
        tB = Math.max(0, Math.min(255, 255 * (v2c + shade * (lc[2] * alpha - v2c))));
        tA = Math.max(0, Math.min(1, alpha + shade * ((alpha + 1) * 0.5 * alpha - alpha)));
      }
      const tinted = this.cloudTint(tex, Math.round(tR), Math.round(tG), Math.round(tB));
      ctx.globalAlpha = tA;
      ctx.drawImage(tinted, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    // 批模式('both' 双通道共享会话)的 end+全屏 blit 由 drawCloudsNear 统一收口
    // ★C10e:管线后端 over=屏直出跳过 bbox blit（非管线/旗关原路径）
    if (gl && !batch) {
      gl.end(true, this.c10eOver);
      SkyRenderer.cloudBlitStats.bboxNoBatch++;
      if (!(this.c10eOver && gl.pipeBackend)) this.cloudBlitRect(ctx, gl);   // 合成进主画布(三 pass 间 clear 复用;★perf3:全幅→bbox 子矩形)
    }
  }

  // ---- 云 GL 共享层(#A 2026-08-19 合并:云与背景层共用 Renderer.glfx 一个
  //      WebGL 上下文,每窗少一个上下文+全屏背板;生命周期(死亡退避/重建/
  //      释放)全归 Renderer.acquireGL,本类只持当帧注入的引用) ----
  cloudGlLayer: GLSpriteLayer | null = null;
  /** ★C10d 远云并入 bg 会话门（Renderer 在 sky.draw 前置位=bg 会话将开+无色罩/
   *  黑闪;每帧重置——菜单/非世界帧不置位=不延迟）。夹层判定（极光/far 灯笼）
   *  在 drawVanillaClouds 同帧状态法。 */
  farDeferGate = false;
  // ---- ★C10e 分体画布呈现旗（2026-10-01;Renderer.render 帧头逐帧重置——
  //      菜单/旗关/回退帧恒 false=全部走原 blit 路径,零行为变化） ----
  /** 管线后端会话收口走屏 over present（glCanvas 栈式叠合），跳过 2D blit。
   *  仅当会话 layer.pipeBackend 在场才生效（菜单自持层不受影响）。 */
  c10eOver = false;
  /** 自然星 'sstarn' mini-session 直出（=c10eOver 且远云同走 GL stash——farDeferGate
   *  假帧远云 2D 直画落 sky2D,星若 GL 直出会压到 sky2D 远云之上=层序倒挂,故同门） */
  c10eStarDirect = false;
  /** ★C10e 远云夹层谓词（★A3 2026-10-01 摘 lantern 项:far/near 灯笼带已全 GL 桥化
   *  ——far 带 stash→bg 会话首段、near 带 'lantern' mini-session,灯夜帧回归 F-pure;
   *  剩【极光 tileColor 态】一项=唯一未桥化 far 夹层。camY 形参保留（调用点/锚
   *  稳定;lantern 项摘除后暂无消费）。注意与 drawVanillaClouds 局部 farInterlayer
   *  的分工:后者保留 lantern 项=远云「灯在云上」层序卫（far 灯 2D 回退帧若远云
   *  stash 进 FBO 会层序倒挂——见 drawVanillaClouds 注） */
  farInterlayerActive(camY: number): boolean {
    void camY;
    return this.aurora.tileColorState() !== null;
  }
  /** ★C10d 远云 pass1 延迟选集（drawVanillaClouds stash→section 1.5 bg 会话首段
   *  消费;未消费帧=下一帧入口清+菜单帧单帧远云缺=不可见级） */
  private farDeferred: { clouds: VanillaCloud[]; distY: number; camY: number } | null = null;
  /** GL 云总门(?cloudgl=0 逃生门;cpuRender 由 Renderer 注入 null 实现) */
  useGLClouds = typeof location !== 'undefined'
    ? new URLSearchParams(location.search).get('cloudgl') !== '0' : true;
  /** 'both' 双通道共享批总门(?cloudbatch=0 回退每通道独立会话——2026-08-26 前语义) */
  static readonly batchBoth = typeof location !== 'undefined'
    ? new URLSearchParams(location.search).get('cloudbatch') !== '0' : true;
  /** ★C10c（2026-09-30）云尾 blit 归因分账计数器（探针/trace 复核面;静态对象=页内
   *  直改复位口,P1B_REGION_OFF 判例同款）。【为什么存在】Windows SHM trace
   *  （Trace-20260930T144504）曾把 1530ms 全屏 blit 记到 cloudBlitRect 名下,而同
   *  trace merge=merged 占 99.6%——merged 收口恒走 finishBatch 全幅 ctx.drawImage
   *  支,bbox 支（cloudBlitRect）只应 'both' 独立批会话帧到达 ⇒ 疑 minified 内联/
   *  sourcemap 段邻接归因错位。本分账把两支实跑分布钉死:
   *   mergedFull       = merged 收口全幅 drawImage（含早退支;defer 帧不计=不落画）
   *   mergedDefer      = opresent defer 帧（FBO 挂起,本帧零 blit）
   *   bbox             = cloudBlitRect bbox 子矩形 blit 实绘
   *   bboxNoBatch      = ↑中来自无 batch 令牌支（远云 pass1/菜单单通道——游戏内
   *                      每帧必达面;C10c 定谳的 trace 热点主体）
   *   bboxBoth         = ↑中来自 'both' 独立批会话支（非 merged 合并门外的近云帧）
   *   bboxSkipEmpty    = bbox 空/零面积跳过（零提交帧）
   *   bboxFullFallback = ?cloudcache=0 全幅回退支
   *   bboxAreaPx       = bbox 实绘面积累计（px²;÷bbox=均单帧 blit 面积,
   *                      ÷(W×H×帧数)=面积占比——远云 pass 每帧独立会话走此支）
   *  判读:★C10c 实跑定谳（scripts/_c10c-blit-attribution.mjs）——merged 帧
   *  mergedFull 与 bbox 【双双 1:1 帧到达】:bbox 支每帧必达的真实 caller=远云
   *  pass（drawVanillaClouds → drawCloudPass(pass1,无 batch 令牌) → 末尾
   *  gl.end()+cloudBlitRect,独立会话）,与近云 merged 收口无关。trace 的
   *  cloudBlitRect 1530ms 归因【非错位】,热点主体=远云 bbox blit（面积占比见
   *  bboxAreaPx 面）。 */
  static cloudBlitStats = { mergedFull: 0, mergedDefer: 0, bbox: 0, bboxNoBatch: 0, bboxBoth: 0, bboxSkipEmpty: 0, bboxFullFallback: 0, bboxAreaPx: 0 };
  /** ★perf3(2026-09-19 trace 三批:drawCloudsNear 3.3s,其中 finishBatch 全屏 blit
   *  3.2s native blit;DPR=2 全屏层 blit 面积 4×):尾blit 区域收口——只合成当帧
   *  已提交云 quad 的旋转 bbox 并集子矩形。逐位等价论证:GL 会话 begin() 每帧全幅
   *  清 (0,0,0,0),本帧未提交像素恒 α=0;source-over 合成 α=0 → dst 恒等(8bit 精确,
   *  out = src·0 + dst·(1−0) = dst),跳过该区域 = 与全幅 blit 逐位同;子矩形为
   *  src=dst 同尺寸同位 1:1 拷贝,无缩放无滤波。只改「合成多大区域」,云形/色链/
   *  随机流零触碰(?cloudcache=0 一键回退全幅旧路径,逃生门保留至用户验收)。 */
  static readonly cloudRegionBlit = typeof location !== 'undefined'
    ? new URLSearchParams(location.search).get('cloudcache') !== '0' : true;
  /** 云 GL 会话当帧 quad 旋转 bbox 并集(设备 px;'both' 批会话跨 pass2/3 累积,
   *  独立会话(pass1/菜单 closer/closest)在开会话处清零)。旋转 bbox 精确式:
   *  halfW=(w·|cos|+h·|sin|)/2、halfH=(w·|sin|+h·|cos|)/2 ⊇ quad 光栅覆盖。 */
  private cloudBlitBox = { x0: 0, y0: 0, x1: 0, y1: 0, any: false };
  /** bbox 外扩(像素):四边各 pad——旋转 bbox 已是覆盖上界,pad 只兜亚像素栅格化边界 */
  private static readonly CLOUD_BLIT_PAD = 2;
  private cloudBlitBoxReset(): void {
    this.cloudBlitBox.any = false;
  }
  private cloudBlitBoxAdd(cx: number, cy: number, w: number, h: number, rot: number): void {
    const cs = Math.abs(Math.cos(rot)), sn = Math.abs(Math.sin(rot));
    const hw = (w * cs + h * sn) / 2, hh = (w * sn + h * cs) / 2;
    const b = this.cloudBlitBox;
    if (!b.any) {
      b.x0 = cx - hw; b.y0 = cy - hh; b.x1 = cx + hw; b.y1 = cy + hh; b.any = true;
    } else {
      if (cx - hw < b.x0) b.x0 = cx - hw;
      if (cy - hh < b.y0) b.y0 = cy - hh;
      if (cx + hw > b.x1) b.x1 = cx + hw;
      if (cy + hh > b.y1) b.y1 = cy + hh;
    }
  }
  /** 云层尾blit:全幅 → 当帧 bbox 子矩形(hatch off / 空 bbox 退旧语义:
   *  空 bbox = 本帧零提交,旧路径 blit 全透明画布 = source-over 恒等,跳过同效)。 */
  private cloudBlitRect(ctx: CanvasRenderingContext2D, layer: GLSpriteLayer): void {
    if (!SkyRenderer.cloudRegionBlit) { SkyRenderer.cloudBlitStats.bboxFullFallback++; ctx.drawImage(layer.canvas, 0, 0); return; }
    const W = layer.canvas.width, H = layer.canvas.height;
    const b = this.cloudBlitBox;
    if (!b.any || W === 0 || H === 0) { SkyRenderer.cloudBlitStats.bboxSkipEmpty++; return; }
    const PAD = SkyRenderer.CLOUD_BLIT_PAD;
    const sx = Math.max(0, Math.floor(b.x0) - PAD);
    const sy = Math.max(0, Math.floor(b.y0) - PAD);
    const ex = Math.min(W, Math.ceil(b.x1) + PAD);
    const ey = Math.min(H, Math.ceil(b.y1) + PAD);
    const sw = ex - sx, sh = ey - sy;
    if (sw <= 0 || sh <= 0) { SkyRenderer.cloudBlitStats.bboxSkipEmpty++; return; }
    SkyRenderer.cloudBlitStats.bbox++;
    SkyRenderer.cloudBlitStats.bboxAreaPx += sw * sh;
    ctx.drawImage(layer.canvas, sx, sy, sw, sh, sx, sy, sw, sh);
  }
  disposeCloudGL(): void {
    // 上下文本体归 Renderer.glfx 管;这里只摘引用(调用方:cpu 切换/销毁)
    this.cloudGlLayer = null;
  }

  private cloudTintCache = new Map<number, HTMLCanvasElement>();
  /** GPU contextlost 后云染缓存内容归零且不会自动重画——失效清空
   *  (Renderer.onLost 统一扫;GL 云路径下通常为空,零成本) */
  clearCloudTintCache(): void {
    for (const c of this.cloudTintCache.values()) { c.width = 0; c.height = 0; }
    for (const c of this.cloudTintFree) { c.width = 0; c.height = 0; }
    this.cloudTintCache.clear();
    this.cloudTintFree.length = 0;
  }
  /** 纹理实例 id(ImageBitmap 无 .src,裸读恒 undefined → 跨云纹理键碰撞;
   *  bitmap 迁移时代 WeakMap 方案同款) */
  private cloudTexIds = new WeakMap<object, number>();
  private cloudTexIdSeq = 0;
  /** 云朵着色缓存（multiply + destination-in 保形）。
   *  为什么存在:原版画云 = spritebatch.Draw(tex, …, new Color(r*i,g*i,b*i))
   *  ——绘制调用自带颜色乘法(shader 一条指令);Canvas 2D 的 drawImage 没有
   *  颜色参数,等价实现只能预烘焙"贴图×天色"副本。天色因子 = 天空渐变 ×
   *  (scale×alpha×pass 系数) × 大气态,每朵云不同且随时间连续漂移 → 按
   *  (纹理,量化色) 键缓存复用。
   *  ★色键量化步进 8(2026-08-18 canvas 出生栈普查:旧键含逐帧漂移的
   *  Math.round(r,g,b) → 每帧每云 miss → ~340 张/秒 createElement('canvas'),
   *  是移动期 IOSurface churn 主源;量化后键只在天色跨桶时换,churn 趋零。
   *  步进 8 = 通道 3% 内误差,软边低对比云上不可感知)
   *  ★数字键(2026-08-24 trace 热点修复):旧键 = 每次调用模板字符串 `${tid}|${r},${g},${b}`
   *  新建串 → 主菜单 200 云 × 60/120fps 的持续小分配,MinorGC 暂停全记在
   *  cloudTint self 上(trace 实测 2.8s/54s,漂移期 40-70ms/s)。改 15bit 定点
   *  数字键(r/g/b 各 5bit 桶号)零分配,Map 数字键哈希也快于串。
   *  ★cap 24→64 + 淘汰改插入序(2026-08-24):大窗口(用户 trace)可见云
   *  ~80-120,量化色工作集 > 24 → LRU 抖动 = 几乎每调用必 miss(重烘
   *  3 次 drawImage,trace 实测重烘路径 2.0s/54s)。64 覆盖可见云工作集;
   *  命中不再 delete+set 重插(2 次 Map 操作 × 每云每帧纯浪费)——淘汰按
   *  插入序取最旧 = 最陈旧烘焙色,漂移期正是该被换掉的桶。总画布上限
   *  = cap 64 + free 池 8 = 72 */
  private cloudTint(tex: ImageBitmap | HTMLImageElement, r: number, g: number, b: number): HTMLCanvasElement {
    let tid = this.cloudTexIds.get(tex);
    if (tid === undefined) { tid = ++this.cloudTexIdSeq; this.cloudTexIds.set(tex, tid); }
    const key = ((tid * 32 + ((r & ~7) >> 3)) * 32 + ((g & ~7) >> 3)) * 32 + ((b & ~7) >> 3);
    const hit = this.cloudTintCache.get(key);
    if (hit) return hit;
    // ★画布池复用(2026-08-18):同屏多云色桶并存,纯量化仍 ~55 张/秒;
    // 逐桶弃旧新建 = createElement churn(曾 340 张/秒)。改为 LRU 淘汰的画布
    // 进 free 池,miss 时原位重画——零画布出生,活集恒 ≤64(与 chunk atlas 同哲学)
    let c = this.cloudTintFree.pop();
    if (!c) c = document.createElement('canvas');
    if (c.width !== tex.width || c.height !== tex.height) { c.width = tex.width; c.height = tex.height; }
    const cx = c.getContext('2d', { willReadFrequently: true })!;
    cx.imageSmoothingEnabled = true;
    // ★copy 整体替换(review 修,池化复用双坑):①上一轮遗留 globalCompositeOperation
    //  =destination-in 会让首绘变擦除;②残留旧云像素会透过新贴图透明区串色。
    //  copy 连状态带像素一次归零;后续 multiply/destination-in 各自显式设定
    cx.globalCompositeOperation = 'copy';
    cx.drawImage(tex, 0, 0);
    cx.globalCompositeOperation = 'multiply';
    cx.fillStyle = `rgb(${r},${g},${b})`;
    cx.fillRect(0, 0, c.width, c.height);
    cx.globalCompositeOperation = 'destination-in';
    cx.drawImage(tex, 0, 0);
    this.cloudTintCache.set(key, c);
    if (this.cloudTintCache.size > 64) {
      const first = this.cloudTintCache.keys().next().value;   // Map 头 = 最久未用(LRU)
      if (first !== undefined) {
        const evicted = this.cloudTintCache.get(first);
        this.cloudTintCache.delete(first);
        // 归池复用,不弃;封顶 8——总画布上限 = 64 cap + 8 池 = 72
        if (evicted && this.cloudTintFree.length < 8) this.cloudTintFree.push(evicted);
      }
    }
    return c;
  }
  /** cloudTint 淘汰画布的复用池(封顶 8:miss 优先取池;工作集收缩时 surplus 弃) */
  private cloudTintFree: HTMLCanvasElement[] = [];

  // ================= AmbientSky 天空实体（渲染层：群系背景之上、实体之下） =================

  /** 天空实体驱动输入（AmbienceServer 判定语义；Renderer 每帧注入到 fx.amb） */
  amb: {
    dayTime: boolean; raining: boolean; eclipse: boolean; bloodMoon: boolean;
    moonEventKind: 0 | 1 | 2; zoneHallow: boolean;
    playerX: number; playerY: number;
  } = { dayTime: true, raining: false, eclipse: false, bloodMoon: false, moonEventKind: 0, zoneHallow: false, playerX: 0, playerY: 0 };

  /** FadingSkyEntity（AmbientSky.cs:88-184）表示（模块级，见 AmbientEnt） */
  private ambEntities: AmbientEnt[] = [];
  /** AmbientSky._frameCounter（每 60Hz tick +1） */
  private ambFrame = 0;
  /** AmbienceServer._updatesUntilNextAttempt */
  private ambNextAttempt = 0;
  /** 族贴图缓存（texKey → Image，首用懒加载） */
  private ambTexCache = new Map<string, ImageBitmap | HTMLImageElement>();
  /** NPC.butterflyChance（NPC.cs:94583-94599 每日黎明掷）——按 dayCount 重掷 */
  private butterflyDay = -1;
  private butterflyChance = 999999;
  /** MP 氛围联机（module100）：true = 服务器 AmbienceServer 驱动（原版客户端无本地
   *  调度器——本地掷族关闭,只消费广播 + 本地推进既有实体）；Game 进联机时置位 */
  ambientRemoteDriven = false;
  /** module100 到达的待生成族（onAmbienceSpawn 随时入队；drawAmbience 帧首消费——
   *  生成需要当帧相机位做屏幕空间→世界投影,与本地路径同源） */
  private pendingAmbientSpawns: Array<{ family: AmbientFamily; seed: number; anchorX: number; anchorY: number }> = [];
  /** 最近天空色（GetColor 的 bgColor = Main.ColorOfTheSkies；sky.draw 每帧写入） */
  private lastSkyTop = '#4A90E0';
  private lastSkyBottom = '#B8DCF5';
  /** ColorOfTheSkies(0-255;Renderer 每帧写入,Main.cs:63361)——云 cloudColor/
   *  环境天空实体 GetColor 的 bg 单源。null=首帧前,消费方回落 lastSky* 近似 */
  cots: readonly [number, number, number] | null = null;
  /** 天空底色贴图(Background_0.png 48×1400 竖条,Main.cs:61516 ×ColorOfTheSkies;
   *  首用懒加载,未就绪回落 SKY_KEYS 渐变) */
  private skyBgTex: ImageBitmap | HTMLImageElement | null = null;
  private skyBgTinted: { key: string; canvas: HTMLCanvasElement } | null = null;

  /** 清空（退世界/换图时由 Game.destroy 调用，防跨世界残留） */
  clearAmbience(): void {
    this.ambEntities = [];
    this.ambFrame = 0;
    this.ambNextAttempt = 0;
    this.butterflyDay = -1;
    this.clearTowerSky();
    this.clearMoonlordDrama();
    this.aurora.reset();   // SkyManager.Reset(AuroraSky.cs:435-439)
    this.slimeSky.reset();         // SkyManager.Reset 同批(SlimeSky.Reset :242-245)
    this.martianSky.reset();       // (MartianSky.Reset :342-345)
    this.slimeWasOn = false;
    this.sandTintState = { active: false, leaving: false, opacity: 0 };
    this.blizzTintState = { active: false, leaving: false, opacity: 0 };
  }

  /** SetPositionInWorldBasedOnScreenSpace（AmbientSky.cs:47-51）：
   *  屏幕空间提议位 → 世界位（相对相机中心的偏移 × depth/3） */
  private ambientWorldPos(sx: number, sy: number, depth: number, camX: number, camY: number): [number, number] {
    return [camX + (sx - camX) * (depth / 3), camY + (sy - camY) * (depth / 3)];
  }

  /** 族贴图键（各族 Texture 请求 1:1；变体族按掷点/深度/昼夜选表） */
  private ambientTexKey(kind: AmbientFamily, r: () => number, depth: number): { key: string; rows: number; variant: number } {
    switch (kind) {
      case 'birds': return { key: 'Ambience_BirdsVShape', rows: 4, variant: 0 };                    // :462
      case 'wyvern': return { key: 'Ambience_Wyvern', rows: 5, variant: 0 };                        // :1044
      case 'airship': return { key: 'Ambience_FlyingShip', rows: 4, variant: 0 };                   // :1100
      case 'airballoon':                                                                            // :1138
        return { key: Math.floor(r() * 2) === 0 ? 'Ambience_AirBalloons_Large' : 'Ambience_AirBalloons_Small', rows: 5, variant: 0 };
      case 'eyeball': return { key: 'Ambience_EOC', rows: 3, variant: 0 };                          // :1241
      case 'butterflies': {                                                                         // :204-206
        const n = Math.floor(r() * 2) + 1;
        return { key: `Ambience_ButterflySwarm${n}`, rows: n === 2 ? 19 : 17, variant: n };
      }
      case 'lostkite': return { key: 'Ambience_LostKite', rows: 42, variant: 0 };                   // :249-250
      case 'vulture': return { key: 'Ambience_Vulture', rows: 10, variant: 0 };                     // :356
      case 'bats': { const n = 1 + Math.floor(r() * 3); return { key: `Ambience_Bat${n}`, rows: 10, variant: n }; }   // :945
      case 'pixieposse': {                                                                          // :409-413
        const n = this.amb.dayTime ? 1 : 2;
        return { key: `Ambience_PixiePosse${n}`, rows: 25, variant: n };
      }
      case 'seagulls': return { key: 'Ambience_Seagull', rows: 9, variant: 0 };                     // :514
      case 'slimeBalloons': return { key: 'Ambience_SlimeBalloons', rows: 7, variant: 0 };          // :734
      case 'gastropod': return { key: 'Ambience_Gastropod', rows: 1, variant: 0 };                  // :627
      case 'pegasus': return { key: 'Ambience_Pegasus', rows: 11, variant: 0 };                     // :307
      case 'eos': case 'crimera': {                                                                 // :1183-1193/:1207-1217
        let n = 3;
        if (depth <= 6) n = 2;
        if (depth <= 5) n = 1;
        return { key: `${kind === 'eos' ? 'Ambience_EOS' : 'Ambience_Crimera'}${n}`, rows: kind === 'eos' ? 4 : 3, variant: n };
      }
      case 'hellbats': { const n = 1 + Math.floor(r() * 2); return { key: `Ambience_HellBat${n}`, rows: 10, variant: n }; }  // :833
    }
  }

  private mkAmbient(kind: AmbientFamily, sx: number, sy: number, depth: number, dir: 1 | -1,
    life: number, camX: number, camY: number, texKey: string, rows: number, variant: number,
    r: () => number = Math.random): AmbientEnt {
    const spec = AMBIENT_FAMILY_PARAMS[kind];
    const [x, y] = this.ambientWorldPos(sx, sy, depth, camX, camY);
    return {
      kind, x, y, depth, dir, life, bornAt: this.ambFrame,
      fadeIn: spec.fadeIn, fadeOut: spec.fadeOut,
      frame: spec.frameRandom ? Math.floor(r() * rows) : 0,
      rows, framingSpeed: spec.framingSpeed || 0x7fffffff,
      frameOffset: spec.frameOffset ? Math.floor(r() * rows) : 0,
      opacity: 0, vx: 0, vy: 0, rotation: 0,
      brightness: spec.brightness, depthScaleAdj: spec.depthScaleAdj ?? 0,
      grayDepthFade: !!spec.grayDepthFade, texKey, variant,
      magAccX: 0, magAccY: 0, magTX: 0, magTY: 0, magPX: 0, magPY: 0, magVX: 0, magVY: 0,
      state: 0, waviness: 0, dead: false,
    };
  }

  /** 生成一族（AmbientSky.Spawn :1425-1537 分发 → 各类构造器/CreateGroup 1:1）。
   *  r = 随机源（本地路径 Math.random；module100 广播路径 = seed 确定性 PRNG——
   *  全端同 seed 同实体,FastRandom(seed) 同义）。anchor = 出生域锚玩家位
   *  （缺省本地玩家；远端锚玩家 = msg13 镜像位,Player.Center 语义） */
  private spawnAmbientFamily(kind: AmbientFamily, camX: number, camY: number,
    r: () => number = Math.random, anchor?: { x: number; y: number }): void {
    const spec = AMBIENT_FAMILY_PARAMS[kind];
    const group = AMBIENT_GROUP_SPEC[kind];
    const wind = this.weatherRef ? this.weatherRef.windSpeedCurrent : this.wind;
    // spriteDir（各族 :191 等：WindForVisuals≤0 → Flip；Airship :1087/AirBalloon :1134 = random.Next(2)）
    const dir: 1 | -1 = spec.randomDir
      ? (Math.floor(r() * 2) !== 0 ? -1 : 1)
      : (wind > 0 ? 1 : -1);
    // VirtualCamera（VirtualCamera.cs:5-14）：Position = 玩家中心 − 2048、Size = 4096²
    // （Main.cs:3753-3755 HiDef 档）——出生域以玩家为锚，与渲染视口无关
    const px = anchor?.x ?? this.amb.playerX;
    const vcamX = px - VIRTUAL_CAM_HALF;                       // vcam.Position.X
    const vcamY = (anchor?.y ?? this.amb.playerY) - VIRTUAL_CAM_HALF;   // vcam.Position.Y
    // :452-459（各族同构）：Effects==None（顺风）→ 左沿外 100；Flip → 右沿(Position.X+Size.X)外 100
    const edgeX = dir > 0 ? vcamX - 100 : vcamX + VIRTUAL_CAM_SIZE + 100;
    const mk = (sx: number, sy: number, d: number, l: number, key: string, rows: number, variant: number) =>
      this.mkAmbient(kind, sx, sy, d, dir, l, camX, camY, key, rows, variant, r);
    const randLife = () => (spec.life[0] + Math.floor(r() * (spec.life[1] - spec.life[0]))) * 60;

    // EOCSkyEntity 族（eyeball/eos/crimera :1238-1258）：3/4 折线 / 1/4 追玩家；不走常规 y 带
    if (spec.eoc) {
      const depth = spec.depthMin + r() * spec.depthSpan;           // :1243
      const t = this.ambientTexKey(kind, r, depth);
      const life = randLife();                                      // :1263/:1281 Next(18,31)*60
      let e: AmbientEnt;
      if (Math.floor(r() * 4) !== 0) {
        // BeginZigZag :1260-1276：方向掷（1 = 左侧入屏右飞）；y=虚拟相机顶、x 对侧域外
        const d: 1 | -1 = Math.floor(r() * 2) === 1 ? 1 : -1;
        e = mk(d === 1 ? vcamX - 100 : vcamX + VIRTUAL_CAM_SIZE + 100, vcamY, depth, life, t.key, t.rows, t.variant);
        e.state = 1; e.dir = d; e.waviness = 1 + r();               // :1265
      } else {
        // BeginChasingPlayer :1278-1283：虚拟相机 4096² 域内均匀随机点
        e = mk(vcamX + r() * VIRTUAL_CAM_SIZE, vcamY + r() * VIRTUAL_CAM_SIZE, depth, life, t.key, t.rows, t.variant);
        e.state = 2;
      }
      this.ambEntities.push(e);
      return;
    }
    // AirBalloon（:1130-1147）：锚玩家列 ±100 格、地表上 50-80 格（不走常规 y 带）
    if (kind === 'airballoon') {
      const depth = spec.depthMin + r() * spec.depthSpan;
      const t = this.ambientTexKey(kind, r, depth);
      const sx = (Math.floor(px / 16) + 100 * (r() * 2 - 1)) * 16;  // :1133-1135
      const sy = this.fx.surfaceY - (50 + Math.floor(r() * 31)) * 16;  // :1136 Next(50,81)
      this.ambEntities.push(mk(sx, sy, depth, randLife(), t.key, t.rows, t.variant));
      return;
    }
    // 常规高度带 y = yOff + rand*(surfacePx - ySub - yOff)（各族 :201/:246/:304/:353/:411/
    // :459/:511/:624/:731/:942/:1041/:1097）；HellBats = 地狱层 + rand*800（:890）
    const bandY = () => spec.hellBand
      ? this.underworldLayerPx() + r() * 800
      : r() * Math.max(0, this.fx.surfaceY - spec.ySub - spec.yOff) + spec.yOff;
    const depth = () => spec.depthMin + r() * spec.depthSpan;
    if (group) {
      // CreateGroup（:564-598/:672-705/:771-804/:874-907/:990-1023）
      const count = group.count[0] + Math.floor(r() * (group.count[1] - group.count[0]));
      const baseY = bandY();
      const baseDepth = depth();
      // 群族基础寿命 = Next(a,b)*60（与单体 spec.life 不同：Gastropod/Seagulls/Bats/HellBats 30-60s）
      const baseLife = (group.baseLife[0] + Math.floor(r() * (group.baseLife[1] - group.baseLife[0]))) * 60;
      const accX = group.accX[0] + r() * group.accX[1];             // :584/:691/:790/:893/:1009
      const accY = group.accY[0] + r() * group.accY[1];
      const tX = (r() * 2 - 1) * group.target, tY = (r() * 2 - 1) * group.target;  // :585/:692/:791/:894/:1010
      for (let i = 0; i < count; i++) {
        const d = baseDepth + r() * group.depthJitter;              // :589/:696/:795/:898/:1014
        const tex = this.ambientTexKey(kind, r, d);
        const ox = (r() * 20 - 10) * group.spread, oy = r() * 3 * group.spread;    // :590/:697/:796/:899/:1015
        const e = mk(edgeX + ox, baseY + oy, d, baseLife + Math.floor(r() * group.lifeJitter), tex.key, tex.rows, tex.variant);
        const k = (r() * group.factorA + group.factorB) * 0.05;     // :594/:701/:800/:903/:1019
        e.magAccX = accX * k; e.magAccY = accY * k;
        e.magTX = tX; e.magTY = tY;
        this.ambEntities.push(e);
      }
      return;
    }
    // 单体族
    const d = depth();
    const tex = this.ambientTexKey(kind, r, d);
    this.ambEntities.push(mk(edgeX, bandY(), d, randLife(), tex.key, tex.rows, tex.variant));
  }

  /** module100 广播路径入口（NetAmbienceModule → AmbientSky.Spawn :1425 1:1）：
   *  type = SkyEntityType 注册序；seed = 服务器 Main.rand.Next() 掷（FastRandom
   *  位级不需复刻——全端只需同 seed 同实体,仓库 mulberry32 确定性等价）；
   *  anchorX/Y = 锚玩家中心（Game 从 msg13 镜像解析）。入队下一帧 drawAmbience
   *  消费（生成需当帧相机投影）。未知型（Meteor/BoneSerpent/未来型）静默忽略 */
  queueAmbientNet(type: number, seed: number, anchorX: number, anchorY: number): void {
    const family = ambientFamilyOfSkyType(type);
    if (!family) return;
    if (this.pendingAmbientSpawns.length > 16) this.pendingAmbientSpawns.shift();   // 防积压
    this.pendingAmbientSpawns.push({ family, seed, anchorX, anchorY });
  }

  /** seed → [0,1) 确定性随机源（mulberry32；module100 广播重放专用——本地路径
   *  仍走 Math.random 保持原分布） */
  private static seededFloat(seed: number): () => number {
    let s = (seed | 0) || 1;
    return () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** StartFadingOut（AmbientSky.cs:170-176）：把出生点前推到"淡出已开始"的时刻 */
  private ambientStartFadingOut(e: AmbientEnt, frame: number): void {
    const n = Math.floor(e.life * e.fadeOut);
    const t = frame - n;
    if (t < e.bornAt) e.bornAt = t;
  }

  /** FadingSkyEntity.Update（AmbientSky.cs:103-121）+ 各族 UpdateVelocity/Update */
  private stepAmbientEntity(e: AmbientEnt, frame: number, wind: number): void {
    const spec = AMBIENT_FAMILY_PARAMS[e.kind];
    const age = frame - e.bornAt;
    if (age >= e.life) { e.dead = true; return; }                  // IsMovementDone :128-140
    // UpdateOpacity :151-165：淡出段（age≥life×fadeOut）反向 1→0
    e.opacity = age >= e.life * e.fadeOut
      ? lerpValueClamped(e.life, e.life * e.fadeOut, age)
      : lerpValueClamped(0, e.life * e.fadeIn, age);
    // 帧推进 :110-113（(frame+FrameOffset)%FramingSpeed==0 → 下一行）；
    // LostKite 风暴时 FramingSpeed=4（:276-279）
    const fs = e.kind === 'lostkite' && this.storming() ? 4 : e.framingSpeed;
    if (fs < 0x7fffffff && ((frame + e.frameOffset) % fs) === 0) {
      e.frame = (e.frame + 1) % e.rows;
    }
    // SlimeBalloons :758 / LostKite :280：每帧按风重估朝向
    if (e.kind === 'slimeBalloons' || e.kind === 'lostkite') e.dir = wind > 0 ? 1 : -1;
    const group = AMBIENT_GROUP_SPEC[e.kind];
    if (spec.eoc) {
      // EOCSkyEntity.UpdateVelocity :1285-1297
      if (e.state === 1) {
        // ZigzagMove :1299-1302：dir*3 横速 + cos(frame/1200×2π)×waviness 纵摆
        e.vx = e.dir * 3;
        e.vy = Math.cos((frame / 1200) * Math.PI * 2) * e.waviness;
      } else {
        // ChasePlayerTop :1304-1313：朝玩家上方 500px 以 0.1/tick 加速，钳 ±18
        const p = this.frameCtx?.player;
        if (p) {
          const dx = p.cx - e.x, dy = (p.cy - 500) - e.y;
          if (Math.hypot(dx, dy) >= 100) {
            e.vx = Math.max(-18, Math.min(18, e.vx + 0.1 * Math.sign(dx)));
            e.vy = Math.max(-18, Math.min(18, e.vy + 0.1 * Math.sign(dy)));
          }
        }
      }
      e.rotation = Math.atan2(e.vy, e.vx);                         // :1296
    } else if (group) {
      // 磁吸弹簧（Seagulls :530-537 / Gastropod :637-644 / Slime :745-752 /
      // Bats :961-967 / HellBats :849-855 同构）
      e.magVX += e.magAccX * Math.sign(e.magTX - e.magPX);
      e.magVY += e.magAccY * Math.sign(e.magTY - e.magPY);
      e.magPX += e.magVX; e.magPY += e.magVY;
      e.vx = (spec.speedA + Math.abs(wind) * spec.speedB) * e.dir + e.magVX;
      e.vy = (spec.vy ?? 0) + e.magVY;
      if (e.kind === 'gastropod' || e.kind === 'slimeBalloons') e.rotation = e.vx * 0.1;  // :644/:752
    } else if (e.kind === 'airballoon') {
      // :1149-1165：vx = wind*4；vy = -(3+|wind|)，y<worldSurface×12/8/4 三档各减半
      e.vx = wind * 4;
      let rise = 3 + Math.abs(wind);
      const surfTiles = this.fx.surfaceY / 16;
      if (e.y < surfTiles * 12) rise *= 0.5;
      if (e.y < surfTiles * 8) rise *= 0.5;
      if (e.y < surfTiles * 4) rise *= 0.5;
      e.vy = -rise;
    } else if (e.kind === 'lostkite') {
      // :264-272：1.2+|wind|×3，风暴 ×1.5
      let v = spec.speedA + Math.abs(wind) * spec.speedB;
      if (this.storming()) v *= 1.5;
      e.vx = v * e.dir; e.vy = 0;
    } else {
      // 常规单体族（Birds :472-474 / Wyvern :1054-1057 / Airship :1110-1113 / Butterflies
      // :215-218 / Vulture :366-369 / PixiePosse :423-426 / Pegasus :317-320）
      e.vx = (spec.speedA + Math.abs(wind) * spec.speedB) * e.dir;
      e.vy = 0;
    }
    e.x += e.vx; e.y += e.vy;                                      // :115 Position += Velocity
  }

  /** 各族 Update 尾部的环境门（StartFadingOut 触发条件 1:1） */
  private ambientEnvGate(e: AmbientEnt, frame: number): void {
    const a = this.amb;
    const rainDayEclipse = a.raining || !a.dayTime || a.eclipse;   // Birds :481 等 8 族同构
    let out = false;
    switch (e.kind) {
      case 'gastropod':   // :650
        out = a.raining || a.dayTime || a.bloodMoon || a.moonEventKind === 2 || a.moonEventKind === 1;
        break;
      case 'pixieposse':  // :432：昼夜变体错位即淡出 + 雨/日食/血月/南瓜霜月
        out = (e.variant === 1 && !a.dayTime) || (e.variant === 2 && a.dayTime) || a.raining
          || a.eclipse || a.bloodMoon || a.moonEventKind === 2 || a.moonEventKind === 1;
        break;
      case 'slimeBalloons':  // :759
        out = !this.windyDay() || a.raining || !a.dayTime || a.eclipse;
        break;
      case 'lostkite':    // :282（无雨门）
        out = !a.dayTime || a.eclipse;
        break;
      case 'birds': case 'vulture': case 'pegasus': case 'seagulls':
      case 'airship': case 'airballoon': case 'butterflies': case 'bats':
        out = rainDayEclipse;
        break;
      default:
        // Wyvern/Eyeball/EOS/Crimera/HellBats 无 Update 覆盖 = 无环境门
        out = false;
        break;
    }
    if (out) this.ambientStartFadingOut(e, frame);
  }

  /**
   * 天空实体推进 + 绘制。由 Renderer 在群系背景（biomeBg）之后、世界实体变换之前调用
   * （原版 SkyManager「Ambience」天空层叠在 DrawBG 之上、tile 之前）。
   * 调度 1:1 AmbienceServer.Update :96-129：到期一次尝试（间隔 Next(600,7200)=10-120s），
   * 选族走 pickAmbientFamily（全 17 族）；Main.rand.Next(5)<3（60%）放宽次级条件。
   * MP（module100）：服务器 AmbienceServer 独占掷族（原版 dedServ 侧同构）——本地
   * 调度门关（ambientRemoteDriven），帧首消费广播队列（同 seed 重放）。
   */
  drawAmbience(ctx: CanvasRenderingContext2D, viewW: number, viewH: number,
    camX: number, camY: number, dtMs = 16.7, gl?: GLSpriteLayer | null): void {
    if (this.fx.surfaceY <= 0) return;   // 未进世界（fx 未注入）
    const ticks = Math.max(1, Math.round(dtMs / (1000 / 60)));
    const wind = this.weatherRef ? this.weatherRef.windSpeedCurrent : this.wind;
    const moonlord = this.moonLordPresent();   // :1362-1369 月总天空冲突 → Ambience 禁出
    // module100 广播重放（NetAmbienceModule → Spawn：不查本地条件/月总门——服务器
    // 已掷过,客户端照生（原版 Deserialize 同样直生））
    if (this.pendingAmbientSpawns.length) {
      for (const p of this.pendingAmbientSpawns) {
        this.spawnAmbientFamily(p.family, camX, camY,
          SkyRenderer.seededFloat(p.seed), { x: p.anchorX, y: p.anchorY });
      }
      this.pendingAmbientSpawns.length = 0;
    }
    for (let f = 0; f < ticks; f++) {
      this.ambFrame++;
      if (this.ambNextAttempt > 0) {
        this.ambNextAttempt -= 1;                                   // :100-104
      } else if (!moonlord && !this.ambientRemoteDriven) {
        this.ambNextAttempt = 600 + Math.floor(Math.random() * 6600);  // :133 Next(600,7200)
        const a = this.amb;
        const fam = pickAmbientFamily({
          dayTime: a.dayTime, raining: a.raining, eclipse: a.eclipse, bloodMoon: a.bloodMoon,
          pumpkinMoon: a.moonEventKind === 2, snowMoon: a.moonEventKind === 1,
          zoneHallow: a.zoneHallow,
          zoneDesert: !!this.frameCtx?.scene?.zoneDesert,           // :77
          zoneBeach: !!this.frameCtx?.scene?.zoneBeach,             // :79
          zoneJungle: !!this.frameCtx?.scene?.zoneJungle,           // :84
          zoneCorrupt: !!this.frameCtx?.scene?.zoneCorrupt,         // :82
          zoneCrimson: !!this.frameCtx?.scene?.zoneCrimson,         // :83
          hardMode: this.hardMode(),                                // :61
          windyDay: this.windyDay(),                                // Main.cs:2976
          sunset: this.isSunset(),                                  // :39-46
          tooWindyForButterflies: Math.abs(this.weatherRef?.windSpeedTarget ?? 0) >= 0.4,  // NPC.cs:6801
          butterflyChanceLow: this.butterflyChanceLow(),            // :65
          playerAtSkyHeight: a.playerY <= this.fx.surfaceY + 1600,  // :190-193
          playerAtHellHeight: a.playerY >= (this.underworldLayerPx() - 100) * 16,  // :195-198
          moonLordActive: moonlord,                                 // :1362-1369
          roll5: Math.floor(Math.random() * 5),
          pick: Math.random(),
        });
        if (fam) this.spawnAmbientFamily(fam, camX, camY);
      }
      for (const e of this.ambEntities) {
        if (moonlord) this.ambientStartFadingOut(e, this.ambFrame); // :1383-1385 冲突即整体淡出
        this.stepAmbientEntity(e, this.ambFrame, wind);
        this.ambientEnvGate(e, this.ambFrame);
      }
      this.ambEntities = this.ambEntities.filter((e) => !e.dead);
    }
    // 月总死亡戏剧（DrawPieces/DrawExplosions Main.cs:62711-62712：WoF/背景碎块之后、
    // NPC 缓存之前 = tile 之前——本仓 pre-world 变换段等价；白闪走帧尾
    // drawMoonlordWhiteFlash（Renderer 7c' 段））
    this.drawMoonlordDrama(ctx, camX, camY, viewW, viewH, this.frameCtx?.z ?? 1);
    // 事件天幕（SlimeSky/MartianSky）：激活轮询 + 60Hz 推进 + 绘制——SkyManager
    // DrawToDepth 深度交错段的本仓等价槽（群系背景之上、tile 之下,与 Ambience 同层）
    this.stepEventSkies(ticks, camX, camY, viewW, viewH);
    this.drawSlimeSky(ctx, viewW, viewH, camX, camY);
    this.drawMartianSky(ctx, viewW, viewH, camX, camY);
    if (!this.ambEntities.length) return;
    // atmo（Game.updateWeather 同公式，Main.cs:62622）——CommonDraw :76 color × atmo
    const atmo = Math.max(0, Math.min(1,
      (camY / 16 - (65 + 10 * (this.fx.worldW / 4200) ** 2)) / Math.max(1, this.fx.surfaceY / 16 / 5)));
    // GetColor 的 bgColor = Main.ColorOfTheSkies(2026-08-20 原版化:单源直取;
    // 首帧前回落渐变底色近似)
    const cbg = this.cots ?? (() => {
      const sv = parseInt(this.lastSkyBottom.slice(1), 16);
      return [(sv >> 16) & 255, (sv >> 8) & 255, sv & 255] as [number, number, number];
    })();
    const sr = cbg[0], sg = cbg[1], sb = cbg[2];
    // ★C10e 二期鸟群 GL 桥（2026-10-01,F-inter 收刀普查 scripts/_c10e-inter-census.mjs
    //  定谳:常态 F-inter 100% 由鸟群驻留触发,1-2 只小精灵逼全帧 blit+restack）：
    //  gl 在场（纯帧+屏栈开）→ 'ambgl' mini-session 逐鸟 quadSprite 直出 glCanvas
    //  （bg over-present 之后、世界 over-present 之前=屏栈 bg 侧槽位,层序逐位同
    //  2D）；任一环节失败=整支回退下方 2D 循环（宁回退不丢内容）。drama/slime/
    //  martin 绘制在上方分支外照旧 2D（其帧由路由谓词保持 F-inter）。
    if (gl && this.emitAmbienceGl(gl, ctx, viewW, viewH, camX, camY, atmo, sr, sg, sb)) return;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (const e of this.ambEntities) {
      const p = this.ambPlan(e, viewW, viewH, camX, camY, atmo, sr, sg, sb);
      if (!p) continue;
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.translate(p.sx, p.sy);
      ctx.rotate(e.rotation);
      // EOCSkyEntity（eyeball/eos/crimera）原版不写 Effects=恒 None——朝向完全由
      // Rotation=Velocity.ToRotation() 承担（:1296，贴图原生朝右）；曾叠 dir 翻转
      // =左飞时 rotate π 已转头再镜像回反→虹膜拖在身后（"眼球在屁股后面走",
      // 2026-08-25 用户实报）。其余族 Effects=风向翻转（:191 等全族同式）≈dir 翻转
      if (p.flip) {
        ctx.scale(-1, 1);   // SpriteEffects.FlipHorizontally
      }
      ctx.drawImage(p.tinted, -p.fw * p.scale / 2, -p.fh * p.scale / 2, p.fw * p.scale, p.fh * p.scale);
      ctx.restore();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** ★C10e 二期:单鸟绘制计划（2D 循环与 GL 发射【单源】——位置/染色/α/翻转计算
   *  只此一份,防双路漂移;星批 starCompute 同范式）。返回 null=本实体本帧跳过
   *  （贴图半加载窗/屏外/α≤0.01,与旧 2D 逐项 continue 同门）。 */
  private ambPlan(e: AmbientEnt, viewW: number, viewH: number, camX: number, camY: number,
    atmo: number, sr: number, sg: number, sb: number): AmbDrawPlan | null {
    const tex = this.ambTex(e.texKey);
    // ★texReady 半加载窗守卫（2026-08-25 用户实报鸟群白闪循环）：元数据已到
    //  （width>0）但主体未完时下方 AMB_TINT_CACHE 烘焙 = 平色矩形入缓存——
    //  鸟动画循环 4 帧反复重访毒化帧键（白闪）、cots 漂移换色桶后新键烘出
    //  正常 → "一会正常一会白"循环往复。未就绪本帧跳过，就绪后自然恢复
    if (!tex || !texReady(tex)) return null;
    // GetDrawPositionByDepth :85-88：(Position-相机中心)×(1/depth, 0.9/depth)+相机中心
    const wx = (e.x - camX) / e.depth + camX;
    const wy = (e.y - camY) * 0.9 / e.depth + camY;
    const sx = wx - camX + viewW / 2;
    const sy = wy - camY + viewH / 2;
    if (sx < -400 || sx > viewW + 400 || sy < -400 || sy > viewH + 400) return null;
    const fw = tex.width, fh = tex.height / e.rows;
    const scale = (3 + e.depthScaleAdj) / e.depth;   // CommonDraw :79 + 各族 Draw depthScale 偏移
    // GetColor（各族覆盖）：
    //  常规 = Lerp(bg, 白, BrightnessLerper)（:165-168）；
    //  gastropod = Lerp(bg, (102,0,63), 0.75)（:658 + Colors.cs:39）；
    //  hellbats = Lerp(白, 灰, Depth/15)（:871，无 atmo 乘）
    let cr: number, cg: number, cb: number;
    if (e.kind === 'gastropod') {
      cr = sr + (102 - sr) * 0.75; cg = sg * 0.25; cb = sb + (63 - sb) * 0.75;
    } else if (e.grayDepthFade) {
      const k = Math.min(1, e.depth / 15);
      cr = 255 + (128 - 255) * k; cg = cr; cb = cr;
    } else {
      const b = e.brightness;
      cr = sr + (255 - sr) * b; cg = sg + (255 - sg) * b; cb = sb + (255 - sb) * b;
    }
    // GetColor 染色落贴图 RGB（XNA SourceBlend.One 预乘语义：out = texel.RGB × color.RGB）：
    //  multiply 预染缓存（量化 1/16 限幅防缓存打爆——同火把 Disco 16 档先例）
    const key8 = `${e.texKey}:${e.frame}:${cr >> 4},${cg >> 4},${cb >> 4}`;
    let tinted = AMB_TINT_CACHE.get(key8);
    if (!tinted) {
      tinted = document.createElement('canvas');
      tinted.width = fw; tinted.height = fh;
      const tc = tinted.getContext('2d')!;
      tc.drawImage(tex, 0, e.frame * fh, fw, fh, 0, 0, fw, fh);
      tc.globalCompositeOperation = 'multiply';
      tc.fillStyle = `rgb(${cr | 0},${cg | 0},${cb | 0})`;
      tc.fillRect(0, 0, fw, fh);
      tc.globalCompositeOperation = 'destination-in';
      tc.drawImage(tex, 0, e.frame * fh, fw, fh, 0, 0, fw, fh);
      if (AMB_TINT_CACHE.size > 96) AMB_TINT_CACHE.clear();   // 简易容量闸
      AMB_TINT_CACHE.set(key8, tinted);
    }
    // 群系前景背景层 alpha 乘子（各族 GetColor 覆盖 ×Main.bgAlphaFrontLayer[i]，索引语义
    //  = Main.cs:58951-59030 的 bgStyle 槽：0/10-12 森林系 1 腐化 2 沙漠 3 丛林 4 海洋
    //  5/13/14 善恶沙漠 6 神圣 7 雪原 8 猩红 9 蘑菇——与 BiomeBackground.bgStyle 同表）
    const alpha = Math.min(1, e.opacity * (e.grayDepthFade ? 1 : atmo)
      * this.familyBiomeAlphaMul(e.kind));
    if (alpha <= 0.01) return null;
    // EOCSkyEntity（eyeball/eos/crimera）原版不写 Effects=恒 None——朝向完全由
    // Rotation=Velocity.ToRotation() 承担（:1296，贴图原生朝右）；曾叠 dir 翻转
    // =左飞时 rotate π 已转头再镜像回反→虹膜拖在身后（"眼球在屁股后面走",
    // 2026-08-25 用户实报）。其余族 Effects=风向翻转（:191 等全族同式）≈dir 翻转
    const flip = e.dir < 0 && e.kind !== 'eyeball' && e.kind !== 'eos' && e.kind !== 'crimera';
    return { e, tinted, key8, fw, fh, scale, sx, sy, alpha, flip };
  }

  /** ★C10e 二期:鸟群 GL 发射（'ambgl' FBO,命名空间防撞 clouds/bg/lit/warped/
   *  light2/sstarn/sstars）。quadSprite(rot+flipX)=2D translate·rotate·[scale(-1,1)]
   *  ·drawImage(中心锚 −fw·scale/2) 逐式对位（中心锚=quadSprite 绕 dst 中心旋转
     同构;flipX=UV 反向 ≙ scale(-1,1) 中心镜像,R·F 复合序两路同）;尺寸×k（ctx
   *  变换均匀标量=zoom×DPR,2D 局部尺寸→设备像素）。★all-or-nothing:全实体
   *  纹理预解析【先于】begin（B2b 判例——半截 quads 不可回退,任一失败即整体
   *  走 2D,无半成品泄漏）。染色缓存画布 key 稳定内容不变 → texFromImage 一次
   *  上传驻留（LRU 压力 KB 级）。返回 false=调用方 2D 兜底。 */
  private emitAmbienceGl(gl: GLSpriteLayer, ctx: CanvasRenderingContext2D, viewW: number,
    viewH: number, camX: number, camY: number,
    atmo: number, sr: number, sg: number, sb: number): boolean {
    if (gl.unavailable || gl.canvas.width === 0 || gl.canvas.height === 0) return false;
    const bt = ctx.getTransform();
    const k = Math.sqrt(Math.abs(bt.a * bt.d - bt.b * bt.c));   // 均匀标量（相机=uniform scale+平移）
    if (!Number.isFinite(k) || k <= 0) return false;
    const resolved: Array<{ pl: AmbDrawPlan; entry: TexEntry }> = [];
    for (const e of this.ambEntities) {
      const pl = this.ambPlan(e, viewW, viewH, camX, camY, atmo, sr, sg, sb);
      if (!pl) continue;
      const entry = gl.texFromImage(`ambt:${pl.key8}`, pl.tinted);
      if (!entry) return false;   // 预解析失败:未开会话=零半成品,整体 2D
      resolved.push({ pl, entry });
    }
    gl.begin('ambgl');
    if (gl.unavailable) return false;   // begin 失败:未发射未 present,2D 兜底
    for (const { pl, entry } of resolved) {
      const dw = pl.fw * pl.scale * k, dh = pl.fh * pl.scale * k;
      const cx = bt.a * pl.sx + bt.c * pl.sy + bt.e, cy = bt.b * pl.sx + bt.d * pl.sy + bt.f;
      gl.quadSprite(entry, 0, 0, pl.fw, pl.fh, cx - dw / 2, cy - dh / 2, dw, dh,
        { alpha: pl.alpha, rot: pl.e.rotation, flipX: pl.flip, smooth: false });
    }
    gl.end(true, true);   // over present → glCanvas 屏栈（bg 之后/世界之前,over=true 入栈）
    this.glInterlayerEmitted = true;   // ★A3 债收齐:GL 夹层增量合成标记
    return true;
  }

  // ================= 帧数据挂点 + 各子系统共用的小读数 =================

  /** Renderer.render 每帧一行注入；null = 未进世界（各子系统自静默） */
  frameCtx: SkyFrameCtx | null = null;

  /** Main.bgAlphaFrontLayer 等价源（BiomeBackground.alphaFront，逐 bgStyle 槽的渐变 alpha；
   *  Renderer 初始化时 attachBiomeBg 注入）。null = 未注入（菜单等），乘子按 1。 */
  private bgAlphaFront: ArrayLike<number> | null = null;
  attachBiomeBgAlpha(front: ArrayLike<number>): void {
    this.bgAlphaFront = front;
  }
  private bgFront(i: number): number {
    const a = this.bgAlphaFront;
    return a ? (a[i] ?? 0) : 1;
  }

  /** 各族 GetColor 的群系前景层乘子（AmbientSky.cs 六族覆盖 1:1；其余族无覆盖 = 1）：
   *  Pegasus×[6]（:334 神圣）/ Vulture×max([2],[5],[13],[14])（:383-385 沙漠系）/
   *  Seagulls×[4]（:556 海洋）/ Bats×Utils.Max([3],[0],[10],[11],[12])（:987 丛林+森林系）/
   *  Crimera×[8]（:1198 猩红）/ EOS×[1]（:1222 腐化）。索引槽语义见 Main.cs:58951-59030。 */
  private familyBiomeAlphaMul(kind: AmbientFamily): number {
    switch (kind) {
      case 'pegasus': return this.bgFront(6);
      case 'vulture': return Math.max(this.bgFront(2), this.bgFront(5), this.bgFront(13), this.bgFront(14));
      case 'seagulls': return this.bgFront(4);
      case 'bats': return Math.max(this.bgFront(3), this.bgFront(0), this.bgFront(10), this.bgFront(11), this.bgFront(12));
      case 'crimera': return this.bgFront(8);
      case 'eos': return this.bgFront(1);
      default: return 1;
    }
  }

  /** 族贴图首用懒加载（texKey → Image；未就绪调用方跳帧自愈） */
  private ambTex(key: string): ImageBitmap | HTMLImageElement | null {
    let t = this.ambTexCache.get(key);
    if (!t) {
      t = loadTex(`${key}.png`);
      this.ambTexCache.set(key, t);
    }
    return t;
  }

  /** Main.IsItStorming（Main.cs:2978 = _shouldUseStormMusic） */
  private storming(): boolean { return !!this.weatherRef?.shouldUseStormMusic; }
  /** Main.IsItAHappyWindyDay（Main.cs:2976 = _shouldUseWindyDayMusic） */
  private windyDay(): boolean { return !!this.weatherRef?.shouldUseWindyDayMusic; }
  private hardMode(): boolean { return !!this.frameCtx?.world?.flags?.hardMode; }

  /** 地狱顶 px（Main.UnderworldLayer = maxTilesY-200；lavaLine 缺省回退） */
  underworldLayerPx(): number {
    const fc = this.frameCtx;
    if (!fc?.world) return 0;
    return (fc.world.lavaLine || (fc.world.h - 200)) * 16;
  }

  /** IsSunset（AmbienceServer.cs:39-46：白天且 Main.time>40500）。
   *  ★40500 是分段昼内 ticks → 钟面 = DAWN + 40500/86400 = 0.65625（15:45）——
   *  曾写 0.625（=40500/64800,分母无语义）提前 45 分钟进 sunset 氛围
   *  （2026-08-31 手表行口径审查顺带定谳） */
  private isSunset(): boolean {
    const c = this.frameCtx?.clock;
    return !!c && c.isDay && c.timeOfDay > ClockVal.DAWN + 40500 / 86400;
  }

  /** NPC.butterflyChance<6（AmbienceServer.cs:65）。NPC.cs:94583-94599 每日黎明掷：
   *  1/3 无蝶；否则 Next(1,21) 且 1/5 无蝶 → <6 仅约 13% 的日子有天空蝶群 */
  private butterflyChanceLow(): boolean {
    const day = this.frameCtx?.clock?.dayCount ?? -1;
    if (day !== this.butterflyDay) {
      this.butterflyDay = day;
      if (Math.random() < 1 / 3) this.butterflyChance = 999999;
      else {
        this.butterflyChance = 1 + Math.floor(Math.random() * 20);
        if (Math.random() < 1 / 5) this.butterflyChance = 999999;
      }
    }
    return this.butterflyChance < 6;
  }

  /** 月总在场（SceneState.cs:109 ClosestNPCPosition[398] != Zero → MoonLord 天空激活，
   *  同时 :1362-1369 与 Ambience 冲突） */
  private moonLordPresent(): boolean { return this.dramaCore !== null; }

  // ================= 月塔天空装饰层（Nebula/Solar/Stardust/Vortex Sky 1:1） =================

  /** 四塔族索引（SceneState.cs:111-115 MonolithType 映射：0 星璇/1 星云/2 星尘/3 耀斑） */
  private static readonly TOWER_FAMILY = ['vortex', 'nebula', 'stardust', 'solar'] as const;
  /** 塔族 → 塔 NPC id（NPCID：422 星璇 / 507 星云 / 493 星尘 / 517 耀斑） */
  private static readonly TOWER_NPC: Record<TowerFamily, number> =
    { vortex: 422, nebula: 507, stardust: 493, solar: 517 };

  private towerSky: Record<TowerFamily, TowerSkyState> = {
    vortex: new TowerSkyState(), nebula: new TowerSkyState(),
    stardust: new TowerSkyState(), solar: new TowerSkyState(),
  };

  clearTowerSky(): void {
    for (const k of SkyRenderer.TOWER_FAMILY) this.towerSky[k].reset();
  }

  /** SceneState.ApplyVisuals :105-115 每帧扫描：近距门（SceneMetrics.cs:276-282/921-928
   *  距离²≤4000²）+ 器件门（!flag4 && ActiveMonolithType==N）→ Activate/Deactivate */
  private updateTowerSky(): void {
    const fc = this.frameCtx;
    const player = fc?.player;
    const monolith = this.fx.monolith;
    const maxTilesX = fc?.world?.w ?? Math.max(1, Math.round(this.fx.worldW));
    const surfacePx = this.fx.surfaceY;
    const near: Partial<Record<TowerFamily, boolean>> = {};
    let anyTowerNear = false;
    if (fc && player) {
      for (const fam of SkyRenderer.TOWER_FAMILY) {
        const npcId = SkyRenderer.TOWER_NPC[fam];
        let found = false;
        for (const e of fc.entities) {
          if (e.vanillaId !== npcId || e.dead) continue;
          const d2 = (e.cx - player.cx) ** 2 + (e.cy - player.cy) ** 2;
          if (d2 <= 4000 * 4000) { found = true; break; }   // NPCEventZoneRadius（SceneMetrics.cs:130）
        }
        near[fam] = found;
        if (found) anyTowerNear = true;
      }
    }
    for (let idx = 0; idx < SkyRenderer.TOWER_FAMILY.length; idx++) {
      const fam = SkyRenderer.TOWER_FAMILY[idx];
      const active = towerSkyActive(!!near[fam], monolith, idx, anyTowerNear);
      this.towerSky[fam].setActive(active, fam, maxTilesX, surfacePx);
    }
  }

  /** 绘制四塔天空层（sky.draw 星星之后、日月之前——原版 SkyManager 远景层在星星后） */
  private drawTowerSky(ctx: CanvasRenderingContext2D, viewW: number, viewH: number,
    camX: number, camY: number, dtMs: number): void {
    this.updateTowerSky();
    const fc = this.frameCtx;
    const maxTilesX = fc?.world?.w ?? Math.max(1, Math.round(this.fx.worldW));
    const surfacePx = this.fx.surfaceY;
    const screenX = camX - viewW / 2, screenY = camY - viewH / 2;
    for (const fam of SkyRenderer.TOWER_FAMILY) {
      this.towerSky[fam].update(fam, dtMs);
      this.towerSky[fam].draw(ctx, fam, viewW, viewH, screenX, screenY, maxTilesX, surfacePx);
    }
  }

  /** 当前塔天空云量乘子（GetCloudAlpha 四族同式；任一激活即取最小） */
  towerCloudAlphaMul(): number {
    let mul = 1;
    for (const fam of SkyRenderer.TOWER_FAMILY) {
      if (this.towerSky[fam].fade > 0.001) {
        mul = Math.min(mul, (1 - this.towerSky[fam].fade) * 0.3 + 0.7);
      }
    }
    return mul;
  }

  // ================= 月总死亡戏剧（MoonlordDeathDrama.cs 1:1） =================
  // 消费锚点（NPC.cs 1456/1457 双标,BJ298 2026-09-23 亲核）：
  // ThrowPieces = 1456:83496 / 1457:83567（398 终死 HitEffect(0,1337)）；
  // AddExplosion = 1456:36982 / 1457:41794（死亡态 ai0==2，ai1%3==0 且 60<ai1<580）；
  // RequestLight = 1456:36796/:36820（出生态 -1/-2 闪白 ai1/30；1457:41609/:41633）
  // 与 1456:37055 / 1457:41867（死亡态 ≥480 段）。
  // 任务描述"登场爆炸"系推测有误：Misc/MoonExplosion 五件贴图全部挂在**死亡**戏剧。

  private dramaCore: { cx: number; cy: number; ai0: number; ai1: number } | null = null;
  private dramaPieces: DramaPiece[] = [];
  private dramaExplosions: DramaExplosion[] = [];
  /** whitening/requestedLight（:154-156）——MoveTowards 0.02/帧 */
  private dramaWhitening = 0;
  private dramaRequestedLight = 0;
  private dramaLightRequestedThisFrame = false;

  clearMoonlordDrama(): void {
    this.dramaCore = null;
    this.dramaPieces = [];
    this.dramaExplosions = [];
    this.dramaWhitening = 0;
    this.dramaRequestedLight = 0;
  }

  /** 每帧扫描 398（Renderer frameCtx.entities）→ 死亡戏剧触发/爆炸/白光请求 */
  private updateMoonlordDrama(dtFrames: number): void {
    const fc = this.frameCtx;
    const world = fc?.world ?? null;
    let core: { cx: number; cy: number; ai0: number; ai1: number } | null = null;
    if (fc) {
      for (const e of fc.entities) {
        if (e.vanillaId !== 398 || e.dead) continue;
        core = { cx: e.cx, cy: e.cy, ai0: e.ai0 ?? 0, ai1: e.ai1 ?? 0 };
        break;
      }
    }
    const prev = this.dramaCore;
    this.dramaCore = core;
    this.dramaLightRequestedThisFrame = false;

    // DD2 永恒水晶胜利尾段白光请求(NPC.cs(1458):41201-41205):ai[1]==2 演出期
    // lerpValue = GetLerpValue(480,570,ai[0]) ≠ 0 → MoonlordDeathDrama.RequestLight
    // ——与月总死亡共享 whitening 面(:194 MoveTowards 0.02)。渲染帧扫描实体即取
    // 同一活体状态(本文件 drama 系既有模式),无 AI→renderer 直连通道
    if (fc) {
      for (const en of fc.entities) {
        const ai0 = en.ai0 ?? 0, ai1 = en.ai1 ?? 0;
        if ((en.vanillaId ?? 0) !== 548 || en.dead || ai1 !== 2 || ai0 <= 480) continue;
        this.requestDramaLight(lerpValueClamped(480, 570, ai0), en.cx, en.cy);
      }
    }

    if (core) {
      // 死亡演出段（ai0==2）：每 3t 一簇爆炎（:36981-36998，落点须界内非实心）
      if (core.ai0 === 2 && core.ai1 % 3 === 0 && core.ai1 > 60 && core.ai1 < 580) {
        const ang = Math.random() * Math.PI * 2;
        const rad = 20 + Math.random() * 400;
        const ex = core.cx + Math.cos(ang) * rad, ey = core.cy + Math.sin(ang) * rad;
        const tx = Math.floor(ex / 16), ty = Math.floor(ey / 16);
        const ok = world ? (world.store.inBounds(tx, ty) && !world.store.isSolid(tx, ty)) : true;
        if (ok) this.addMoonlordExplosion(ex, ey);
      }
      // 白光请求：出生态 -1/-2（ai1<60 → ai1/30）与死亡态尾段（≥480 → (ai1-480)/120）
      if ((core.ai0 === -1 || core.ai0 === -2) && core.ai1 < 60) {
        this.requestDramaLight(core.ai1 / 30, core.cx, core.cy);   // :36796/:36820
      } else if (core.ai0 === 2 && core.ai1 >= 480) {
        this.requestDramaLight((core.ai1 - 480) / 120, core.cx, core.cy);  // :37055
      }
      // 终死（ai1≥600 → life=0 + HitEffect(0,1337) → ThrowPieces）：掷点跨线或实体消失兜底
      const diedNow = prev !== null && prev.ai1 < 600 && core.ai1 >= 600 && core.ai0 === 2;
      const vanished = prev !== null && prev.ai0 === 2 && prev.ai1 >= 590;
      if (diedNow || vanished) {
        this.throwMoonlordPieces(vanished && !diedNow ? prev.cx : core.cx,
          vanished && !diedNow ? prev.cy : core.cy, Math.floor(Math.random() * 100));
      }
    }
    // Update :158-196：碎片/爆炸推进 + 白光 0.02/帧 逼近（无光源请求 → 目标 0）
    for (const p of this.dramaPieces) p.update(world?.w ?? 0, world?.h ?? 0);
    this.dramaPieces = this.dramaPieces.filter((p) => !p.dead);
    for (const ex of this.dramaExplosions) ex.update();
    this.dramaExplosions = this.dramaExplosions.filter((ex) => !ex.dead);
    if (!this.dramaLightRequestedThisFrame) this.dramaRequestedLight = 0;   // :190-193
    const target = this.dramaRequestedLight;
    this.dramaWhitening += Math.max(-0.02, Math.min(0.02, target - this.dramaWhitening)) * dtFrames;
    this.dramaWhitening = Math.max(0, Math.min(1, this.dramaWhitening));
  }

  /** ThrowPieces（:231-242）：四件骨骼碎块自核心飞散（UnitY 旋 NextFloat()×π/2−π/4+π
   *  的 6/10/8/12 速；角速度 ±0.05）。种子 = Main.rand.Next(100)（NPC.cs:83496 调用点） */
  private throwMoonlordPieces(cx: number, cy: number, seed: number): void {
    if (this.dramaPieces.length > 0) return;   // 一次死亡一组
    // 位级同源序列（moonlordThrowSeq）：UnifiedRandom(DramaSeed) 的 NextFloat×8。
    // 速度 = UnitY.RotatedBy(angle) × spd——RotatedBy 内部 (float)Math.Cos/Sin（C# double
    // 三角后收缩 float），此处以 fround(cos(angle))×spd 镜像。
    const defs: Array<[DramaPieceKind, number, number, number, number, number]> = [
      // [件, originX, originY, 距核心偏移x, 偏移y, 速度]
      ['spine', 64, 150, 0, 50, 6],        // :235
      ['shoulder', 40, 120, 50, -120, 10], // :237
      ['torso', 192, 252, 0, 0, 8],        // :239
      ['head', 138, 185, 0, -200, 12],     // :241
    ];
    const seq = moonlordThrowSeq(seed);
    defs.forEach(([kind, ox, oy, dx, dy, spd], i) => {
      const { angle, rotV } = seq[i];
      const dirX = Math.fround(Math.cos(angle));
      const dirY = Math.fround(Math.sin(angle));
      this.dramaPieces.push(new DramaPiece(kind, cx + dx, cy + dy,
        Math.fround(dirX * spd), Math.fround(dirY * spd), ox, oy, rotV));
    });
  }

  /** AddExplosion（:244-247）：7 帧爆炎，帧速 Next(2,4) */
  addMoonlordExplosion(x: number, y: number): void {
    this.dramaExplosions.push(new DramaExplosion(x, y, 2 + Math.floor(Math.random() * 2)));
  }

  /** RequestLight（:249-260）：本帧光源 + 目标取 max（钳 1） */
  private requestDramaLight(light: number, x: number, y: number): void {
    const player = this.frameCtx?.player;
    // :181-188 光源须距 metrics.Center <2000 才生效
    if (player && Math.hypot(player.cx - x, player.cy - y) >= 2000) return;
    this.dramaLightRequestedThisFrame = true;
    const v = Math.max(0, Math.min(1, light));
    if (v > this.dramaRequestedLight) this.dramaRequestedLight = v;
  }

  /** DrawPieces/DrawExplosions（:198-220）：世界位 - screenPosition；原版画在 tile 层
   *  之前（Main.cs:62711-62712，WoF/背景碎块之后）——本仓在 pre-world 变换段调用 */
  private drawMoonlordDrama(ctx: CanvasRenderingContext2D, camX: number, camY: number,
    viewW: number, viewH: number, z: number): void {
    this.updateMoonlordDrama(1);
    if (!this.dramaPieces.length && !this.dramaExplosions.length) return;
    const screenX = camX - viewW / 2, screenY = camY - viewH / 2;
    const sx = (wx: number) => (wx - screenX) * z;
    const sy = (wy: number) => (wy - screenY) * z;
    // 屏中心 ±(视口+1000) 剔除（:200/:212）
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (const p of this.dramaPieces) {
      const px = sx(p.x), py = sy(p.y);
      if (px < -1000 || px > viewW + 1000 || py < -1000 || py > viewH + 1000) continue;
      const tex = dramaTex(p.kind);
      if (!tex || !(tex.width > 0) || !tex.width) continue;
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.translate(px, py);
      ctx.rotate(p.rot);
      ctx.drawImage(tex, -p.ox, -p.oy);
      ctx.restore();
    }
    for (const ex of this.dramaExplosions) {
      const px = sx(ex.x), py = sy(ex.y);
      if (px < -1000 || px > viewW + 1000 || py < -1000 || py > viewH + 1000) continue;
      const tex = dramaTex('explosion');
      if (!tex || !(tex.width > 0) || !tex.width) continue;
      const fw = tex.width, fh = tex.height / 7;   // Frame(1,7)（:121）
      ctx.save();
      ctx.globalAlpha = 127 / 255;                                // GetLight :142-145 恒 (255,255,255,127)
      ctx.drawImage(tex, 0, Math.min(6, Math.floor(ex.counter / ex.speed)) * fh, fw, fh,
        px - fw / 2, py - fh / 2, fw, fh);
      ctx.restore();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** DrawWhite（:222-229）：全屏白 × whitening。原版画在 ScreenDarkness.DrawFront 之后
   *  （Main.cs:61763，几乎最末）；本仓在世界变换段以恒等变换近似（登记：位置偏早） */
  private drawMoonlordWhitening(ctx: CanvasRenderingContext2D, viewW: number, viewH: number): void {
    if (this.dramaWhitening <= 0.001) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = Math.min(1, this.dramaWhitening);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.restore();
  }

  // ================= 晨昏耀斑（NextHorizonRenderer Sunflare 族 1:1） =================
  // 消费锚点勘误：Sunflare 与日耀塔**无关**——全部挂在晨昏地平线系统
  // （DrawSun :171-184 / DrawLensFlare :368-541 / DrawSurfaceLayer(3) :141-147）。

  /** 本帧太阳屏幕位（sky.draw 写入；镜头光斑轴用） */
  sunScreen: { x: number; y: number } | null = null;   // Renderer 墓地丁达尔光柱读屏位(2026-08-25)
  /** 夜月屏位(月亮分支每帧写入,r=月盘半径;Renderer.compositeLight 消费——
   *  光照图注入月盘满光,月区乘法≈恒等=原版"月亮不吃乘光"语义) */
  moonScreen: { x: number; y: number; r: number } | null = null;
  /** sunModY/moonModY（Main.cs:1244/:1246 static short）：日月垂直抓取偏移——
   *  绘制位 = 基准 y + modY（:62376/:62395），LastCelestialBodyPosition（:62458,
   *  即 sunScreen/moonScreen）与命中盒（:62413）同源。游戏内无写点（拖拽彩蛋仅
   *  gameMenu,:62417）→ 恒 0；标题屏写点 = setCelestialModY（TitleMenu 拖拽 →
   *  mainFlow.onSunMoonGrab → MenuBackground.setCelestialModY）。每帧 ×0.999 衰减
   *  （:62415-62416，见 sky.draw 日月段尾） */
  private sunModY = 0;
  private moonModY = 0;
  /** 标题屏拖拽写点（Main.cs:62430 sunModY=(short)(mouseY−num4) / :62440
   *  moonModY=(short)(mouseY−num7)）——本方法 short 截断同式 */
  setCelestialModY(dayTime: boolean, modY: number): void {
    const t = Math.trunc(modY);
    const s = (t << 16) >> 16;
    if (dayTime) this.sunModY = s; else this.moonModY = s;
  }
  private sunflareTex: Partial<Record<SunflareTex, HTMLImageElement>> = {};

  /** GetVisibilities（NextHorizonRenderer.cs:199-239 一比一）：
   *  atmo ×(1-cloudAlpha)² ×(1-蘑菇光影响[无→1])；日出窗 = time∈(0,2700)↑·(3600,10800)↓；
   *  日落窗 = 54000−10800..−3600 ↑ 与 −3600..54000 ↓²；夜/日食清零。
   *  nightTicks = 夜段独立计数（Main.time 夜间 dusk→dawn 走 0..32400） */
  private sunVisibilities(dayTimeTicks: number, isDay: boolean, eclipse: boolean, atmo: number,
    cloudAlpha: number, mushroom = 0, nightTicks = 0): { sunset: number; sunrise: number; celestial: number } {
    const celestial = this.celestialEffectPower(dayTimeTicks, isDay, nightTicks);   // :315-325
    let vis = atmo * (1 - cloudAlpha) * (1 - cloudAlpha);               // :205-209
    vis *= 1 - mushroom;                                                // :210(蘑菇影响)
    let sunrise = vis, sunset = vis;
    if (isDay) {
      // :215-223（Remap 单调钳位插值）
      sunrise *= remap(dayTimeTicks, 0, 2700, 0, 1) * remap(dayTimeTicks, 3600, 10800, 1, 0);
      sunset *= remap(dayTimeTicks, 54000 - 10800, 54000 - 3600, 0, 1)
        * remap(dayTimeTicks, 54000 - 3600, 54000, 1, 0) ** 2;
      if (eclipse) { sunrise = 0; sunset = 0; }                          // :224-228
    } else {
      sunrise = 0; sunset = 0;                                           // :230-234
    }
    void celestial;
    return { sunset, sunrise, celestial };
  }

  /** GetCelestialEffectPower（NextHorizonRenderer.cs:315-325）：天体高度驱动的整体强度。
   *  ★夜支的 Main.time 是夜段独立计数（dusk→dawn 0..32400,cs:324）——曾误传昼 ticks
   *  （夜间恒 0 → remap(0,0,3600)=0）→ 夜间天体强度恒 0,月亮照云
   *  （CloudsEnd :342 uColor=moonColor / :350 intensity≥celestial×0.15）整链失效,
   *  云天体光照只剩白天支（2026-08-24 用户实报"月亮没有照云"探针定谳） */
  private celestialEffectPower(dayTimeTicks: number, isDay: boolean, nightTicks = 0): number {
    if (isDay) {
      return remap(dayTimeTicks, 0, 3600, 0, 1) * remap(dayTimeTicks, 54000 - 1800, 54000, 1, 0);
    }
    return remap(nightTicks, 0, 3600, 0, 1) * remap(nightTicks, 32400 - 1800, 32400, 1, 0);
  }

  private sunflareTexLoad(key: SunflareTex): ImageBitmap | HTMLImageElement | null {
    let t = this.sunflareTex[key];
    if (!t) {
      t = loadTex(SUNFLARE_TEX_FILE[key]);
      this.sunflareTex[key] = t;
    }
    return t;
  }

  /** 【未接·原版死代码】DrawSun（:171-184）的 flare1/flare2 两张贴图在原版以
   *  Color(255,255,255,0)×vis 绘制（A 恒 0，Main.cs:62379 普通 AlphaBlend 批次）→
   *  1.4.5.6 实测不可见；可见的晨昏耀斑全部走 DrawLensFlare（shader 路径）。 */

  /** DrawSurfaceLayer(3)（:141-147）：colorgradient 晨昏渐变带（日出水平翻转） */
  private drawSunflareGradientBand(ctx: CanvasRenderingContext2D, viewW: number, viewH: number,
    screenY: number, sunset: number, sunrise: number): void {
    if (sunset <= 0.01 && sunrise <= 0.01) return;
    const tex = this.sunflareTexLoad('colorgradient');
    if (!tex || !(tex.width > 0) || !tex.width) return;
    // GetGradientRect（:66-72）：val=(1-Lerp(40,worldSurface,screenY/16))×400，y=max(0,val)−400
    const surfaceTiles = this.fx.surfaceY / 16;
    const val = (1 - lerpValueClamped(40, surfaceTiles, screenY / 16)) * 400;
    const y = Math.max(0, val) - 400;
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.imageSmoothingEnabled = true;
    if (sunrise > 0.01) {
      ctx.globalAlpha = Math.min(1, sunrise * 0.6);                  // ×num2=0.6（:145）
      ctx.save();
      ctx.translate(viewW, 0);
      ctx.scale(-1, 1);                                             // FlipHorizontally
      ctx.drawImage(tex, 0, y, viewW, viewH + 400);
      ctx.restore();
    }
    if (sunset > 0.01) {
      ctx.globalAlpha = Math.min(1, sunset * 0.6);                  // :146
      ctx.drawImage(tex, 0, y, viewW, viewH + 400);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** DrawLensFlare（:368-541）：太阳↔屏心轴上的镜头光斑串。
   *  原版为 Immediate 模式 shader（Main.cs:61760 末段后处理），强度经
   *  SunVisibilityPixel（HorizonHelper.UpdateSunVisibility 产出的 1×1 遮挡 alpha，
   *  miscShaderData.UseImage1 → shader 内乘光斑色）调制；本仓在世界变换段恒等变换
   *  绘制，遮挡调制以 sunVisibility 乘 intensity（登记：层级偏早）。
   *  ★遮挡语义定谳（2026-08-20 PixelShader.cso obj69 逐指令,SM2 解释器执行核验）:
   *  全 pass 共 6 条——texld r0 = 光斑贴图 t0;mul r0 × v0(元素顶点色);mov r1.xy=(0.5,0)
   *  + texld r1 = s1(1×1 遮挡纹理 @ (0.5,0) 恒定采样);mul r0 × r1.w;输出。
   *  即 final = 贴图.rgba × 元素色.rgba × occlusion.α ——【标量×每元素色】,
   *  与本实现"intensity 预乘 occ → tintedSprite×globalAlpha"数学等价(乘法结合律;
   *  解释器金标 tests/fx-pixelshader-parity.test.ts LensFlare 锚)。无渐变重采样
   *  或其他项——现标量近似即字节码精确等价,非近似。 */
  private drawLensFlare(ctx: CanvasRenderingContext2D, viewW: number, viewH: number,
    sunset: number, sunrise: number, celestial: number): void {
    const quads = this.collectLensFlare(viewW, viewH, sunset, sunrise, celestial);
    if (quads) this.drawLensFlareQuads(ctx, quads);
  }

  /** ★gladd 面④：元素四边形 2D 直绘（原 drawLensFlare 尾段逐字：外层 save+恒等
   *  变换+'lighter'+平滑开，逐元素 save/α/translate/rotate/drawImage/restore——
   *  像素序与原实现逐位同）。 */
  private drawLensFlareQuads(ctx: CanvasRenderingContext2D, quads: FlareQuad[]): void {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    for (const q of quads) {
      ctx.save();
      ctx.globalAlpha = q.alpha;
      ctx.translate(q.x, q.y);
      ctx.rotate(q.rot);
      ctx.drawImage(q.sprite, -q.w / 2, -q.h / 2, q.w, q.h);
      ctx.restore();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** ★gladd 面④：镜头光斑元素收集（原 drawLensFlare 头段数学逐字单源化；2D/GL
   *  双消费——门/强度门/轴角/残影项与原实现逐字同源）。null=本帧无光斑。 */
  private collectLensFlare(viewW: number, viewH: number,
    sunset: number, sunrise: number, celestial: number): FlareQuad[] | null {
    const sun = this.sunScreen;
    if (!sun) return null;
    // SunVisibilityEnabled 门（HorizonHelper.cs:42 = _targetUpToDate）：首帧采样未就绪
    // 时不画光斑（原版同）——进世界后第二帧起生效
    if (!this.sunVisSampled) return null;
    // AdjustIntensity（:393-408，纯函数 adjustFlareIntensity）：常态
    //  intensity = (temporal×celestial)³；sunScorchCounter>0 分支整体替换为
    //  1−(1−lerp(0,300,counter))² 曲线 ×celestial ×5（吸血鬼种子阳光炽灼档）——
    //  再 × 遮挡可见度（原版在 shader 采样 SunVisibilityPixel alpha）。
    //  ★2026-08-20 校勘：旧实现多乘一次 celestial（(t·c)³·c ≠ (t·c)³,晨昏耀斑
    //  整体过暗——"以前有移植不代表准确"的实证件）
    const occ = this.sunVisibility;
    const scorch = this.frameCtx?.player?.sunScorchCounter ?? 0;
    const num = adjustFlareIntensity(sunrise, celestial, scorch) * occ;
    const num2 = adjustFlareIntensity(sunset, celestial, scorch) * occ;
    if (num <= 0.01 && num2 <= 0.01) return null;
    const cx = viewW / 2, cy = viewH / 2;
    // :46-49 轴角 + Main.screenPosition.Y·0.001(世界屏顶 Y——旧误用 sun.y 屏幕坐标)
    const baseRot = Math.atan2(cy - sun.y, cx - sun.x) + this.lastScreenTopY * 0.001;
    // 玩家残影项（LensFlareElement.cs:34-37）：本仓等价 = Player.advancedShadows
    // 位置历史环（翅膀 45 彩虹拖尾同源数据）；无残影（环 ≤1 项）恒 0
    const shadowD = flareShadowTerm(this.frameCtx?.player?.advancedShadows, sun.x, sun.y, cx, cy) * -0.0002;
    const out: FlareQuad[] = [];
    if (num2 > 0.01) this.collectLensFlareSet(out, sun.x, sun.y, cx, cy, baseRot, num2, 'sunset', shadowD);
    if (num > 0.01) this.collectLensFlareSet(out, sun.x, sun.y, cx, cy, baseRot, num, 'sunrise', shadowD);
    return out.length ? out : null;
  }

  /** DrawSunsetFlare / DrawSunriseFlare 元素表（:410-541 逐元素 1:1）。
   *  元素定位（LensFlareElement.Draw :28-52）：i ∈ [0,RepeatTimes)——
   *  scale = ScaleStart+ScaleOverIndex·i；alpha = Color×(1+IntensityOverIndex·i)×intensity；
   *  d = (DistanceStart+DistanceAlongIndex·i+玩家残影项)%1（:43 num2 += num·−0.0002；
   *  %1 保号=C# 语义,残影项可为负→元素沿轴外推）；pos = Lerp(sun,center,d*2)；rot = 轴角+Rotation */
  private collectLensFlareSet(out: FlareQuad[], sunX: number, sunY: number,
    cx: number, cy: number, baseRot: number, intensity: number, which: 'sunset' | 'sunrise',
    shadowD = 0): void {
    type Row = [SunflareTex, number, number, number, number, number, [number, number, number], number, number, number];
    // [贴图, Repeat, ScaleStart, ScaleOver, DistStart, DistStep, RGB, 强度乘, IntensityOverIndex, Rotation]
    const sets: Row[] = which === 'sunset' ? [
      ['pointblurry', 3, 0.3, -0.04, 0.33, 0.05, [43, 32, 0], 0.47058824, -0.125, 0],    // :415-424
      ['pointsharp', 3, 0.3, 0.04, 0.03, 0.05, [43, 32, 0], 0.47058824, -0.125, 0],      // :425-434
      ['pointblurry', 1, 0.3, 0, 0.41, 0, [255, 0, 65], 0.11764706, 0, 0],               // :435-441
      ['bokeh', 1, 0.3, 0, 0.475, 0, [255, 255, 255], 8 / 51, 0, 0],                     // :442-448
      ['bokeh', 6, 0.24, -0.04, 0.225, 0.04, [255, 255, 255], 4 / 51, 0, 0],             // :449-457
      ['pointblurry', 1, 1, 0, 0.6, 0, [255, 157, 0], 8 / 51, 0, 0],                     // :458-464
      ['spectra', 1, 0.4, 0, 0.65, 0, [255, 255, 255], 2 / 51, 0, Math.PI],              // :465-472
    ] : [
      ['pointsharp', 3, 0.3, -0.04, 0.33, 0.05, [0, 32, 43], 0.47058824, -0.125, 0],     // :480-490
      ['pointsharp', 3, 0.3, 0.04, 0.03, 0.05, [0, 32, 43], 0.47058824, -0.125, 0],      // :491-500
      ['pointblurry', 1, 0.3, 0, 0.41, 0, [65, 0, 255], 0.11764706, 0, 0],               // :501-507
      ['bokeh', 1, 0.3, 0, 0.525, 0, [255, 255, 255], 8 / 51, 0, 0],                     // :508-515
      ['bokeh', 6, 0.24, -0.04, 0.225, 0.04, [255, 255, 255], 4 / 51, 0, 0],             // :516-524
      ['pointblurry', 1, 1, 0, 0.6, 0, [0, 157, 255], 8 / 51, 0, 0],                     // :525-531
      ['spectra', 1, 0.38, 0, 0.65, 0, [255, 255, 255], 2 / 51, 0, Math.PI],             // :532-539
    ];
    for (const [key, repeat, scaleStart, scaleOver, distStart, distStep, rgb, mul, ioi, rot] of sets) {
      const tex = this.sunflareTexLoad(key);
      if (!tex || !texReady(tex)) continue;   // ★texReady：width>0 挡不住半加载窗（方片竞态）
      const sprite = tintedFlareSprite(tex, rgb[0], rgb[1], rgb[2]);   // Color 乘子（lighter 下呈色相）
      if (!sprite) continue;
      // ★gladd 面④：tintKey 随行——tintedFlareSprite 是【池化画布】（回收可重写），
      //  GL 纹理键纪律同③：键=tint 缓存键（texId|rgb）非画布对象，src 身份比对+
      //  换代 texRefresh 重传（池回收重烘=新画布对象→src 失配自愈）。
      const tintKey = `${texId(tex)}|${rgb[0]},${rgb[1]},${rgb[2]}`;
      for (let i = 0; i < repeat; i++) {
        const scale = scaleStart + scaleOver * i;                       // :40
        const a = mul * (1 + ioi * i) * intensity;                      // :41
        if (a <= 0.01) continue;
        let d = distStart + distStep * i + shadowD;                     // :42-43 num2 += num·−0.0002
        d %= 1;                                                         // :44 %1 保号（残影项可负）
        const px = sunX + (cx - sunX) * (d * 2);                        // :45
        const py = sunY + (cy - sunY) * (d * 2);
        out.push({
          sprite, tintKey, x: px, y: py,
          w: tex.width * scale, h: tex.height * scale,                   // :46-50
          rot: baseRot + rot, alpha: Math.min(1, a),
        });
      }
    }
  }

  // =================（雨点落水涟漪已退役 2026-08-14） =================
  // 自创"水面扩散椭圆环"近似（随机列采样,与雨滴落点无关 = 涟漪位置漂移的根因）,
  // 且与 WeatherRenderer 的原版 splash 尘(Rain.cs:120-133)双画。原版无环状涟漪
  // 系统——Ripples.png 是水体扭曲 shader 掩码(WaterShaderData :108),canvas 2D
  // 无扭曲通道不做。雨落水视觉 = splash 尘一处(WeatherRenderer.update)。

  /** 世界变换段绘制（Renderer.render 2d' 区一行调用）：晨昏镜头光斑（恒等变换全屏）。
   *  月总死亡白闪已挪帧尾（见 drawMoonlordWhiteFlash） */
  drawWorldFx(ctx: CanvasRenderingContext2D, camX: number, camY: number,
    z: number, viewW: number, viewH: number): void {
    const quads = this.worldFxFrame(camX, camY, z, viewW, viewH);
    if (!quads) return;
    this.drawLensFlareQuads(ctx, quads);
  }

  /** ★gladd 面④（2026-10-28,task#22）：本帧镜头光斑帧计算——采样副作用+元素
   *  收集（2D/GL 双消费单源；与原 drawWorldFx 逐字同门：frameCtx/sunScreen/
   *  sampleSunVisibility/sunVisibilities/lastScreenTopY）。返回 null=本帧无光斑
   *  （门关/强度零/全纹理未就位）；采样等副作用照跑=两路径恒等（GL 失败回落
   *  2D 重放 worldFxFrame 幂等——采样读 store 不读画布，重复调用同值）。
   *  GL 侧消费=Renderer.drawWorldFxGL（quadBatchRgba 仿射角点）。 */
  worldFxFrame(camX: number, camY: number, z: number, viewW: number, viewH: number):
    FlareQuad[] | null {
    if (!this.frameCtx) return null;
    if (this.sunScreen) {
      // SunVisibilityPixel 采样（HorizonHelper.UpdateSunVisibility Main.cs:61769 帧末语义：
      // 本帧采样值下一帧生效——故先画后采，drawLensFlare 读的是上一帧值）
      this.sampleSunVisibility(camX, camY, z, viewW, viewH);
      const dayTimeTicks = this.lastDayTimeTicks;
      const v = this.sunVisibilities(dayTimeTicks, dayTimeTicks > 0, this.lastEclipse,
        this.atmoValue(camY), this.weatherRef?.cloudAlpha ?? 0);
      // Main.screenPosition.Y(=屏顶世界 Y,LensFlareElement :49 轴角微扰项)
      this.lastScreenTopY = camY - viewH / 2 / z;
      return this.collectLensFlare(viewW, viewH, v.sunset, v.sunrise, v.celestial);
    }
    return null;
  }
  /** 上帧屏顶世界 Y(LensFlareElement :49 baseRot 微扰用) */
  private lastScreenTopY = 0;

  /** 菜单晨昏镜头光斑（DoDraw 菜单路径 :61550 DrawLensFlare——原版菜单也画）：
   *  无 frameCtx/无世界瓦片 → 无遮挡采样（sunVisibility=1）、无残影项；
   *  horizonVisCache 由 sky.draw 本帧算好，sunScreen 同 */
  drawMenuFlare(ctx: CanvasRenderingContext2D, viewW: number, viewH: number,
    camY: number): void {
    if (!this.sunScreen) return;
    const v = this.horizonVisCache;
    if (!v) return;
    this.sunVisSampled = true;
    this.sunVisibility = 1;
    this.lastScreenTopY = camY - viewH / 2;
    this.drawLensFlare(ctx, viewW, viewH, v.sunset, v.sunrise, v.celestial);
  }

  /** 月总死亡白闪帧尾出口（MoonlordDeathDrama.DrawWhite Main.cs:61763：ScreenDarkness
   *  .DrawFront 之后、ScreenObstruction.Draw 之前 = 几乎帧末）。2026-08-13 挪正：此前
   *  挂在 drawWorldFx（Renderer 2d' 世界变换段 = tile 上实体下），白闪被实体/光照合成
   *  压掉。Renderer 7c/7c-bis 之间调用（drawMoonLordShake 后、ScreenObstruction 前） */
  drawMoonlordWhiteFlash(ctx: CanvasRenderingContext2D, viewW: number, viewH: number): void {
    this.drawMoonlordWhitening(ctx, viewW, viewH);
  }

  /** atmo（Game.updateWeather 同公式，Main.cs:62622） */
  /** 大气层衰减(Main.cs:62622 UpdateAtmosphereTransparencyToSkyColor 的 atmo 值;
   *  2026-08-20 起 Renderer 也消费——云量压暗 cots 用) */
  atmoValue(camY: number): number {
    return atmoOf(camY, this.fx.worldW, this.fx.surfaceY);
  }

  /** 菜单相机 Y（Main.cs:47620 DrawMenu：screenPosition.Y = worldSurface·16 −
   *  screenHeight）——云三通道 num3 视差/大气系数按此归位（曾传 0 → num3 把
   *  云推到屏外树后、atmo 钳 0 染色全暗） */
  vanillaMenuCamY(viewH: number): number {
    return this.fx.surfaceY - viewH;
  }

  // ================= SunVisibilityPixel 遮挡采样（HorizonHelper.cs:42-80） =================

  /** 上一帧采样值（DrawLensFlare 消费；= 原版 _pixelTarget 1×1 alpha） */
  private sunVisibility = 1;
  /** 最近一次太阳遮挡采样值（= 原版 HorizonHelper._pixelTarget 1×1 alpha 的
   *  可见度语义；镜头光斑与 LitNature 晨昏光晕共用同一采样——原版两 shader
   *  同吃 UseImage1(SunVisibilityPixel)，NextNatureRenderer.cs:135） */
  get sunOcclusion(): number { return this.sunVisibility; }
  /** 采样是否就绪（= _targetUpToDate / HorizonHelper.SunVisibilityEnabled :42；
   *  太阳不在场景/首帧 false → 消费方按原版语义整体门关） */
  get sunOcclusionReady(): boolean { return this.sunVisSampled; }
  /** 采样就绪标记（= 原版 _targetUpToDate / SunVisibilityEnabled；首帧 false → 不画光斑） */
  private sunVisSampled = false;

  /**
   * UpdateSunVisibility（HorizonHelper.cs:46-80）：以太阳屏位为中心、边长
   * 128×RenderZoom 的方域从上一帧渲染目标降采样到 1×1 alpha（blend = dest×(1−srcA)
   * 累乘 ⇒ 值 = 域内前景覆盖率的取反），供 LensFlare shader 调制光斑强度——
   * 太阳被地形/前景内容遮挡时镜头光斑随之衰减。
   * 载体差异：原版 screenTarget 的天空画在独立 skyTarget（采样域开空处 alpha≈0）；
   * 本仓主画布天空不透明、无独立前景 alpha 通道，无法直接读 alpha——以采样域内
   * **实心 tile 覆盖率**代位（语义等价：地形遮阳 → 衰减；NPC/水面/背景层不采，
   * 它们在原版 alpha 通道中占比亦小，且光斑只在晨昏地表可见时段活跃）。
   * 屏幕域 128px → 世界域 128/z px（RenderZoom 以主缩放代位）。
   */
  private sampleSunVisibility(camX: number, camY: number, z: number,
    viewW: number, viewH: number): void {
    const sun = this.sunScreen;
    const world = this.frameCtx?.world;
    if (!sun || !world) { this.sunVisSampled = false; return; }
    // ★2026-09-03 地下遮挡门(与天空层绘制门 Main.cs:61492 同条件):屏顶低于
    //  地表线+16 → 天空层整帧被跳过,上一帧渲染目标在太阳屏位处=地下背景/实心格
    //  (不透明) → 原版遮挡纹理 alpha 满 → 光斑衰减到 0。曾按太阳【世界坐标】采样
    //  tile(地表线上=空气)→ 地下遮挡恒 0 = "1050 英尺深仍见落日光晕"(用户实报)。
    const screenTopWorld = camY - viewH / 2 / z;
    if (screenTopWorld >= (this.fx.surfaceY + 16)) {
      this.sunVisibility = 0;
      this.sunVisSampled = true;
      return;
    }
    const half = 64 / z;
    const wx = camX + (sun.x - viewW / 2) / z;
    const wy = camY + (sun.y - viewH / 2) / z;
    const st = world.store;
    const x0 = Math.floor((wx - half) / 16), x1 = Math.floor((wx + half) / 16);
    const y0 = Math.floor((wy - half) / 16), y1 = Math.floor((wy + half) / 16);
    let solid = 0, total = 0;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        total++;                                    // 界外格按"未遮挡"计（原版采样透明区）
        if (st.inBounds(tx, ty) && st.isSolid(tx, ty)) solid++;
      }
    }
    this.sunVisibility = total > 0 ? Math.max(0, Math.min(1, 1 - solid / total)) : 1;
    this.sunVisSampled = true;
  }

  /** 最近一帧白天 tick / 日食（sky.draw 写入；镜头光斑复用可见性） */
  private lastDayTimeTicks = 0;
  private lastEclipse = false;

  skyColors(t: number): [string, string] {
    for (let i = 0; i < SKY_KEYS.length - 1; i++) {
      const [t0, a0, b0] = SKY_KEYS[i];
      const [t1, a1, b1] = SKY_KEYS[i + 1];
      if (t >= t0 && t <= t1) {
        const f = (t - t0) / (t1 - t0);
        return [lerpColor(a0, a1, f), lerpColor(b0, b1, f)];
      }
    }
    return [SKY_KEYS[0][1], SKY_KEYS[0][2]];
  }

  draw(ctx: CanvasRenderingContext2D, clock: Clock, viewW: number, viewH: number, camX: number, dtMs = 16.7, camY = 0) {
    // ★A3 债收齐（2026-10-01）:灯笼夜推进单源——原版 Update ±0.01/帧（LanternNight
    //  全局,与相机/带位无关）。旧实现 far（sky.draw）+near（Renderer 群系背景后）
    //  双调用各推一次=±0.02/帧（2× 原版速率,灯夜起落整体快一倍,登记债本刀兑现）。
    //  drawLanterns 从此只读（清理门保留）。
    this.advanceLanternNight(dtMs);
    // ---- 帧数据消化：稀有云世界旗标（Cloud.cs RollRareCloud 门）----
    {
      const wf = this.frameCtx?.world?.flags;
      if (wf) {
        this.rareCloudFlags = {
          // 击杀链通用键 downed_<vanillaId>（4 克眼 / 13 世吞 / 266 克脑 / 35 骷髅王）+ 具名键兜底
          downedBoss1: !!(wf['downed_4'] || wf['downedEyeOfCthulhu']),
          downedBoss2: !!(wf['downed_13'] || wf['downed_266']),
          downedBoss3: !!(wf['downed_35'] || wf['downedSkeletron']),
          hardMode: !!wf['hardMode'],
          crimson: !!this.frameCtx?.world?.crimson,
          // 饥荒/十周年世界（SeedEasterEggs.parseSeed 文本种子：the constant 系 /
          //  celebrationmk10 及哈希值 5162021/5162011，WorldGenerationOptions.cs:66-90
          //  + WorldSeedOption_DontStarve/Anniversary.cs）——旗标经 world.seedFlags 落地
          dontStarveWorld: !!this.frameCtx?.world?.seedFlags?.theConstant,
          tenthAnniversaryWorld: !!this.frameCtx?.world?.seedFlags?.tenthAnniversary,
        };
      }
    }
    // 沙尘暴/暴风雪色罩状态机（SandstormSky/BlizzardSky 的门轮询+_opacity 渐变;
    // pass 由 Renderer.drawScreenFilterChain 于帧尾(7d)头插消费——此处先更新状态,
    // 帧内序正确)
    this.stepWeatherTints(dtMs / 1000);
    const t = clock.timeOfDay;
    const isDay = t > ClockVal.DAWN && t < ClockVal.DUSK;
    // ★IIIII224：Main.remixWorld（don't dig up）——太阳短路 :63873 / 星星恒画 :64015
    const remixWorldForDraw = !!this.frameCtx?.world?.seedFlags?.remix;
    // ★0.1875 基(=Clock.DAWN,原版 Main.time 0=4:30AM)——曾用 0.25 基差 1.5h,
    //  日/月位与晨昏窗整体偏移(2026-08-23 校正,菜单调度对拍抓出)
    const dayTimeTicks = isDay ? ((t - ClockVal.DAWN) / 0.625) * 54000 : 0;
    // 晨昏可见性(GetVisibilities :217-256,复用既有 sunVisibilities 单实现)
    // +调色板相位(Main.HorizonPhase)——日/月绘制、晨昏渐变与 Renderer.
    // setFrameHorizon(光种渗入)共用;镜头光斑走 drawWorldFx 链不变。
    // nightTicks = 夜段独立计数(Main.time 夜间语义,celestialEffectPower 夜支吃这个)
    const nightTicks = isDay ? 0 : ((((t - ClockVal.DUSK) + 1) % 1) / 0.375) * 32400;
    this.horizonVisCache = this.sunVisibilities(dayTimeTicks, isDay, !!clock.eclipse,
      this.atmoValue(camY), this.weatherRef?.cloudAlpha ?? 0,
      this.frameCtx?.scene?.biomeLightInfluence?.mushroom ?? 0, nightTicks);
    this.horizonPhase = horizonPhaseOf(Math.max(0, Math.min(7, clock.moonPhase ?? 0)), isDay, dayTimeTicks);
    // CloudsEnd(HorizonClouds shader)输入态缓存:月相/昼夜(SkyRenderer.drawCloudPass 区消费)
    this.lastMoonPhase = Math.max(0, Math.min(7, clock.moonPhase ?? 0));
    this.lastIsDay = isDay;
    // Main.screenPosition.Y(屏顶世界 Y)与 zoom——天空贴图 bgTopY/日月轨迹/
    // 镜头光斑轴角微扰共用
    const zQ = this.frameCtx?.z ?? 1;
    const screenTopWorld = camY - viewH / 2 / zQ;
    // bgTopY(Main.cs:61483:−screenPosition.Y/(worldSurface·16−600)·200;worldSurface≤30 → 0)
    // ★gameMenu 门(:61481-82 gameMenu||netMode==2 → bgTopY=0)——菜单传原版
    //  screenPosition.Y(=surface−屏高)后此门必须生效,否则日月/云整体偏移
    const skyBgTopY = !this.frameCtx ? 0
      : this.fx.surfaceY > 30
        ? -screenTopWorld / Math.max(1, this.fx.surfaceY - 600) * 200 : 0;
    // ★SW-BJ41 2026-09-09：人工星空 pass（drawShimmerStars,Renderer 在黑幕后调）
    // 与自然星共用同一 SceneArea.bgTopY 映射（原版两 pass 同传 sceneArea,
    // Main.cs:63036/:63151）——本帧值暂存复用
    this._lastStarBgTopY = skyBgTopY;
    // 镜头光斑可见性复用（drawWorldFx）
    this.lastDayTimeTicks = isDay ? dayTimeTicks : 0;
    this.lastEclipse = !!clock.eclipse;
    // ---- 天幕流星推进(绘制在天空底色之后,见 drawSkyMeteor;原版 SkyManager 天空层序) ----
    if (this.meteor) {
      const m = this.meteor;
      m.t++;
      m.x += m.vx; m.y += m.vy;
      if (m.t >= m.life) this.meteor = null;
      void dtMs;
    }
    // 原版天空贴图深度门（Main.cs:61492 `screenPosition.Y < worldSurface*16+16`）：
    // 相机【顶】低于地表线+16px 时天空整层不画——由（受光的）地下分层背景全覆盖,
    // 无墙/透明区露出的是暗色洞穴背景。曾无门=地底透出未衰减亮蓝天(用户实报:
    // "地底下没有背景墙体的远景没有光衰减")。状态更新(晨昏/极光/天气罩)仍照跑
    // 供光种/帧状态消费,只跳过绘制并以黑打底(原版 skyTarget Clear(Transparent)
    // 合成底=黑同效;地下带层缝隙兜底)。
    // ★SW-微光星空闪烁修复（2026-09-29 用户实报"微光环境背景星光原版会闪烁,
    //  本仓疑似静态"定谳）：vanilla Star.UpdateStars 的钟在【update 相】
    //  （Main.cs:17429-17449）——地上 `if (screenPosition.Y < worldSurface*16+16)`
    //  支恒跑;地下走 `else if (shimmerAlpha > 0f)` 支【同样恒跑】(+1/90·tick
    //  坠星掷+hidden 星重生)。本仓曾把逐星 Update 挂在 sky.draw 自然星段
    //  （:4125 updateStars）=深度门 early-return 整体跳过 → 微光域（地下）
    //  twinkle 冻结=人工星空静态（判别器:活帧 0/8 星 twinkle 160 tick 恒值;
    //  手动 updateStars 可推进=钟源活、调用点死）。修=地下支按 vanilla 语义
    //  补 updateStars（shimmerAlpha>0 门+坠星掷）;地上支照旧（:4125 不动,
    //  无双更新——地下臂 return 不落自然星段）。
    if (screenTopWorld >= this.fx.surfaceY + 16) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, viewW, viewH);
      if (!this.frameCtx?.paused && this.shimmerAlpha > 0) {
        this.updateStars(this.frameCtx?.world?.dayRate?.() ?? 1, isDay, dayTimeTicks);
        // vanilla :17439-17448:1/90·tick 随机坠星+hidden 星重生（SpawnStars(j)
        // 的 10 次探位版,fadeIn=1 渐显）——本仓 starFallAt(AI_148 路径)之外的
        // 环境坠星源;随机取星=vanilla rand.Next(numStars) 同式
        if (Math.random() * 90 < 1) {
          const stars = this.stars;
          if (stars.length) {
            const num5 = Math.floor(Math.random() * this.numStars);
            const s5 = stars[num5];
            if (s5 && !s5.hidden && !s5.falling) {
              s5.fallTime = 0;
              s5.falling = true;
              s5.fvy = (700 + Math.floor(Math.random() * 301)) * 0.01;
              s5.fvx = (Math.floor(Math.random() * 801) - 400) * 0.01;
            }
            for (let j = 0; j < this.numStars; j++) {
              if (stars[j]?.hidden) { this.spawnStar(j); stars[j].fadeIn = 1; }
            }
          }
        }
      }
      return;
    }
    const [top, bottom] = this.skyColors(t);
    // 天空实体 GetColor 的 bgColor（Main.ColorOfTheSkies）近似源——本帧色缓存
    this.lastSkyTop = top;
    this.lastSkyBottom = bottom;
    // ★天空底色 = Background_0 × ColorOfTheSkies(Main.cs:61508-61516 唯一绘制式,
    //  2026-08-20 原版化):昼夜/月相地板/血月/日食/晨昏渗入全由 cots 乘法驱动,
    //  天空贴图恒同一张(原版不换昼夜贴图)。夜 = 亮贴图×~0.075 ≈ 暗蓝。
    //  几何 1:1(:61506-61512):dest = (bgStartX, bgTopY, 贴图宽, max(屏高,贴图高))
    //  ——横向逐 48px 平铺(实测横向完全均匀,整幅拉伸等价);竖向 1:1 顶锚
    //  bgTopY(曾整幅拉伸满屏 = 渐变竖向位置漂移,校勘 2026-08-20 末轮)。
    //  贴图未就绪/cots 缺(首帧/测试环境)回落旧渐变
    const skyTex = this.skyTexImg();
    if (skyTex && skyTex.width > 0 && this.cots) {
      const tinted = this.tintSkyTex(skyTex);
      ctx.imageSmoothingEnabled = true;
      const dh0 = Math.max(viewH, skyTex.height);
      ctx.drawImage(tinted, 0, 0, skyTex.width, skyTex.height, 0, skyBgTopY, viewW, dh0);
    } else {
      const grad = ctx.createLinearGradient(0, 0, 0, viewH);
      grad.addColorStop(0, top);
      grad.addColorStop(1, bottom);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, viewW, viewH);
      // 回落分支的日食压暗(主分支已含于 cots)
      if (clock.eclipse && t > ClockVal.DAWN && t < ClockVal.DUSK) {
        const dayTime = ((t - ClockVal.DAWN) / 0.625) * 54000;
        const L = Math.min(1, dayTime / 1242);
        if (L > 0) {
          ctx.save();
          ctx.globalCompositeOperation = 'multiply';
          ctx.fillStyle = `rgb(${Math.round(255 * (1 - 0.925 * L))},${Math.round(255 * (1 - 0.96 * L))},${Math.round(255 * (1 - L))})`;
          ctx.fillRect(0, 0, viewW, viewH);
          ctx.restore();
        }
      }
    }
    // 晨昏地平线渐变(DrawHorizon :81-105,画在天空底色后、星星前)
    if (this.horizonVisCache && (this.horizonVisCache.sunrise > 0.003 || this.horizonVisCache.sunset > 0.003)) {
      this.drawHorizonGradients(ctx, viewW, viewH, camY, this.horizonVisCache, this.horizonPhase);
    }
    // 闪电白已改走 ColorOfTheSkies 链(Main.cs:63346-63355:bgColor 三通道向 1
    // lerp lightning,天空/远景/光种子同步闪亮)——旧全屏白闪 overlay 退役
    // 墓地天空压暗（Main.cs:62990-62996 SetBackColor GraveyardInfluence）：bgColor
    // 三通道 ×(1 − 0.6×intensity)——晴空/夜空整体转灰暗；强度为 Game 平滑后的
    // GraveyardVisualIntensity（weather.graveyardVisual），>0 即生效（remix 分支不适用）
    const gyIntensity = this.weatherRef?.graveyardVisual ?? 0;
    if (gyIntensity > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      const dv = Math.round(255 * (1 - 0.6 * Math.min(1, gyIntensity)));
      ctx.fillStyle = `rgb(${dv},${dv},${dv})`;
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.restore();
    }

    // ---- 晨昏耀斑渐变带（NextHorizonRenderer.DrawSurfaceLayer(3) :141-147；
    //      DrawHorizon 在 DrawBG 头段 = 星星/日月之前）----
    {
      const v = this.sunVisibilities(dayTimeTicks, isDay, clock.eclipse, this.atmoValue(camY),
        this.weatherRef?.cloudAlpha ?? 0);
      this.drawSunflareGradientBand(ctx, viewW, viewH, camY - viewH / 2, v.sunset, v.sunrise);
    }

    // ---- 月总天空渐暗（MoonLordSky.cs:63-70 + SceneState.cs:109 + SceneMetrics.cs:286-302）：
    //      398 在场即激活（ClosestNPCPosition[398] != Zero），强度 = 1 − SmoothStep(3000,6000,距核)。
    //      距核取上一帧戏剧扫描缓存（drawAmbience 段更新，1 帧滞后无感） ----
    {
      const ml = this.dramaCore;
      const pl = this.frameCtx?.player;
      if (ml && pl) {
        const inten = moonLordSkyIntensity(Math.hypot(pl.cx - ml.cx, pl.cy - ml.cy));
        if (inten > 0.001) {
          ctx.save();
          ctx.fillStyle = `rgba(0,0,0,${inten.toFixed(4)})`;
          ctx.fillRect(0, 0, viewW, viewH);
          ctx.restore();
        }
      }
    }

    // ---- 天幕流星绘制（AmbientSky 天空实体层：画在天空底色之后=原版 SkyManager 层序；
    //      曾画在 fillRect 之前被底色整个盖掉不可见）----
    if (this.meteor && this.meteorTex && this.meteorTex.width) {
      const m = this.meteor;
      // SkyEntity.CommonDraw GetDrawPositionByDepth :71-74：水平视差 1/Depth、垂直 0.9/Depth
      // （camX/camY = 相机中心；depthScale=3 → 缩放 3/Depth）
      const px = (m.x - camX) / m.depth + camX - (camX - viewW / 2);
      const py = (m.y - camY) * 0.9 / m.depth + camY - (camY - viewH / 2);
      const sc = 3 / m.depth;
      // FadingSkyEntity 淡入淡出（前/后 5% = 60 tick）+ BrightnessLerper=0.5
      // （GetColor :165-168 = Lerp(天空色,白,0.5)——深夜天空近黑 ≈ 半亮，此处以 alpha×0.5 近似）
      const k = m.t / m.life;
      const alpha = (k < 0.05 ? k / 0.05 : k > 0.95 ? Math.max(0, (1 - k) / 0.05) : 1) * 0.5;
      const frame = Math.floor(m.t / 5) % 4;   // FramingSpeed 5（:1339）
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(px, py);
      ctx.rotate(m.rot);
      if (m.flip) ctx.scale(-1, 1);             // :1321 FlipHorizontally 50%
      ctx.imageSmoothingEnabled = false;
      const dw = SkyRenderer.METEOR_FW * sc, dh = SkyRenderer.METEOR_FH * sc;
      ctx.drawImage(this.meteorTex, 0, frame * SkyRenderer.METEOR_FH,
        SkyRenderer.METEOR_FW, SkyRenderer.METEOR_FH, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    }

    const isNight = t < 0.27 || t > 0.78;
    // 星星(DrawStarsInBackground :62467-62606 + DrawStar :62481-62604,2026-08-20
    // 全量 1:1——贴图/亮度公式/位置映射/坠星尾迹;旧方块近似退役)。
    // ★无昼夜门(2026-08-24 修正):原版调用点 :61527 无条件(仅 shimmerAlpha 门),
    //   唯一可见性门 = 暗度门 visGate>0(读 atmo 暗化后的 ColorOfTheSkies.R)——
    //   白天地表 cots.R 高 → 门关;相机升入太空 atmo→0 → cots.R→0 → 门开
    //   = 白天太空见星(本仓 isNight 门曾挡死该链)
    {
      // 墓园雾吞(:62471-62479):×(1−1.4·I),≤0 整群跳过
      const starDim = Math.max(0, 1 - gyIntensity * 1.4);
      // ★SW-BJ41 2026-09-09：微光域天空色衰减（Main.DrawStarsInBackground
      //  :64003-64007 `colorOfTheSkies *= 1f - shimmerAlpha`）——自然星亮度基与
      //  可见性门同吃衰减色；:63034 调用门 `if (shimmerAlpha != 1f)` = 全衰时
      //  自然星整批停画（人工星接管,:63147）
      const shim = this.shimmerAlpha;
      const kShim = 1 - shim;
      const cotsFaded: readonly number[] | null = shim > 0
        ? (this.cots ? [this.cots[0] * kShim, this.cots[1] * kShim, this.cots[2] * kShim] : [255, 255, 255])
        : this.cots;
      // 可见性门(:62491-62493):天空够暗才画——
      // 255·(1−cloudAlpha·atmo) − ColorOfTheSkies.R − 25 > 0
      // ★IIIII224：remix 世界恒画（:64015 `if (remixWorld || !(…))`）
      const cotsR = cotsFaded ? cotsFaded[0] : 255;
      const visGate = 255 * (1 - (this.weatherRef?.cloudAlpha ?? 0) * this.atmoValue(camY)) - cotsR - 25;
      const dayRate = this.frameCtx?.world?.dayRate?.() ?? 1;
      if (!this.frameCtx?.paused) this.updateStars(dayRate, isDay, dayTimeTicks);   // Star.UpdateStars 同门(:17198)——暂停冻结
      if (starDim > 0 && shim < 1 && (remixWorldForDraw || visGate > 0)) {
        // ★C13 星批化:GL 层在场=批路径（begin('sstarn')→分段 quadBatchRgba→end→
        //   原位 blit——blit 位=原 2D 星位,层序保持:星在天空渐变上/日月塔幕下）;
        //   GL 不可用帧=2D 逐星回退（原路径逐位）
        const bt = ctx.getTransform();
        const batch = this.buildStarBatch(false, starDim, viewW, viewH, skyBgTopY, bt, shim, cotsFaded);
        const layer = this.cloudGlLayer;
        if (batch && layer && !layer.unavailable) {
          // ★C10e:管线后端+直出门 → end(over) 屏直出（glCanvas 栈底=biomeBg 前,
          //  层序原位保持）,零 2D blit;否则 mini-session+原位 blit（原路径逐位）
          if (this.c10eStarDirect && layer.pipeBackend) {
            this.emitStarBatchGL(layer, batch, 'sstarn', viewW, viewH, true);
          } else {
            this.emitStarBatchGL(layer, batch, 'sstarn', viewW, viewH);
            // ★blit 恒等变换:角点已含 bt(setTransform 替换语义=设备空间),原位 CTM
            //  若非恒等会二次应用（回归判据:星空随天幕变换漂移）
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.drawImage(layer.canvas, 0, 0);
            ctx.restore();
          }
        } else {
          // ★环外一次性状态(2026-08-24):save/getTransform/smoothing 各一次,
          //   逐星 setTransform(见 drawStar 注)——restore 收尾还原全部
          ctx.save();
          ctx.imageSmoothingEnabled = true;   // 星为软边贴图
          for (let i = 0; i < this.numStars; i++) {
            this.drawStar(ctx, i, starDim, viewW, viewH, skyBgTopY, bt, shim, false, cotsFaded);
          }
          ctx.restore();
        }
      }
    }

    // ---- 月塔天空装饰层（Nebula/Solar/Stardust/Vortex Sky：远景段黑幕盖星，
    //      日月/云画其上；云量 ×GetCloudAlpha()=0.7 起）----
    this.drawTowerSky(ctx, viewW, viewH, camX, camY, dtMs);

    // ---- 原版太阳/月亮(Main.cs:62279 DrawSunAndMoon 一比一,2026-08-20 补全
    //      双通道日光色/云遮蔽/光斑——此前单通道裸绘,用户实报"太阳渲染差
    //      十万八千里")----
    // 昼夜时间(Clock.DAWN 0.1875/DUSK 0.8125 边界 → 原版 day 0-54000 / night
    //  0-32400;★曾用 0.25/0.75 基=差 1.5h,月位/晨昏窗整体偏移 2026-08-23 校正)
    const nightTime = !isDay ? ((((t - ClockVal.DUSK) + 1) % 1) / 0.375) * 32400 : 0;
    // 云遮蔽系数(DrawSunAndMoon :62352-62360/:62378-62383:num12/num13 =
    // 1-蘑菇影响-cloudAlpha×1.5×atmo,钳 0;蘑菇影响 Game 平滑值经 scene 注入)
    const cloudAlpha = this.weatherRef?.cloudAlpha ?? 0;
    const atmoD = this.atmoValue(camY);
    const bio = this.frameCtx?.scene?.biomeLightInfluence;
    const mushI = bio?.mushroom ?? 0;
    const sunDim = Math.max(0, 1 - mushI - cloudAlpha * 1.5 * atmoD);
    // 日/月轨迹 y = bgTopY + dip·250 + 180(:62290/:62301);★旧移植漏 bgTopY,
    // 日月整体偏低 ~200px(校勘 2026-08-20)——skyBgTopY 在 draw() 头部算好共用
    const bgTopY = skyBgTopY;
    // LastCelestialBodyPosition（:62458）基准暂存：绘制用衰减前 modY（:62376），
    // 帧尾 decay 后以衰减值写 sunScreen/moonScreen（:62458-62459 逐帧序）
    let sunBase: { x: number; y: number } | null = null;
    let moonBase: { x: number; y: number; r: number } | null = null;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    // ★IIIII224（:63873）：remix 世界游戏内白天不画日/月——原版 DrawSunAndMoon 在
    //  dayTime && remix 时整个 return（夜晚月照常）；实现=太阳块绘制门前短路
    //  （remix 恒 isDay 分支,月亮 else 支不可达,无需另加门）
    const remixDayNoCelestial = isDay && remixWorldForDraw;
    if (isDay) {
      this.moonScreen = null;
      // 日食换贴图(:62354-62364:eclipse → Sun3;else if !gameMenu && player.head==12 →
      // Sun2 骷髅头太阳——头槽 12=物品 237 太阳镜;frameCtx.player 存在即游戏内
      // (菜单不注入 frameCtx = !gameMenu 门),headArmorSlot=时装优先的 player.head 语义)
      let tex: ImageBitmap | HTMLImageElement = this.sunTex;
      const s3 = this.sun3TexImg();
      let flag2 = false;              // Sun2 档（Extra[280] 墨镜叠层门,:62380）
      if (clock.eclipse && s3 && s3.width > 0) tex = s3;
      else {
        const s2 = this.sun2TexImg();                              // :62365-62370
        if (this.frameCtx?.player?.headArmorSlot === 12 && s2) { tex = s2; flag2 = true; }
      }
      if (!remixDayNoCelestial && (tex.width > 0) && tex.width > 0) {
        // 原版:x = time/54000*(屏宽+图宽*2)-图宽(横穿);y = bgTopY + |t*2-1|²*250+180(正午最高);
        // scale = (1.2-|t*2-1|²*0.4)*1.1;rotation = t*2-7.3(t=time/54000)
        // ★:62289 num3 恒用基础 Sun 宽度算——换皮(Sun3/Sun2 64×64)只换绘制贴图,
        //   x 在 value 重指前已定;曾误用换皮贴图宽 → 日食/墨镜太阳横穿轨迹漂移
        //   (基础贴图未就绪兜底 114 = Sun.png 原生宽)
        const ft = dayTimeTicks / 54000;
        const dip = Math.pow(Math.abs(ft * 2 - 1), 2);
        const sw = this.sunTex.width || 114;
        const x = ft * (viewW + sw * 2) - sw;
        const y = bgTopY + dip * 250 + 180;
        const yD = y + this.sunModY;  // :62376 绘制位 = 基准 y + sunModY
        const scale = (1.2 - dip * 0.4) * 1.1;
        sunBase = { x, y };           // 镜头光斑轴锚基准（:62458 衰减后 +sunModY 再写 sunScreen）
        // 双通道(:62352-62374):①本体 = 非日食恒纯白全 α;日食 = 暗紫
        //   (255·n12, sunG·n12, sunB·n12, 255·n12);②叠层 = sunColor×n12 染色、
        //   α = sunColor.B×n12;flag 档(日食 Sun3 :62362-62364 / 太阳镜 Sun2 :62371-62373)
        //   为 (B−60)·n12
        // sunColor 群系修正(:63060-63213 腐化/猩红/丛林/蘑菇四块)
        const sunCol: [number, number, number] = sunColorOf(dayTimeTicks);
        if (bio) applyBiomeToSun(sunCol, bio);
        const scr = sunCol[0], scg = sunCol[1], scb = sunCol[2];
        const ecl = !!clock.eclipse;
        const flag = ecl || flag2;    // :62371(换皮档 → color2 α=(B−60)·n12)
        const pass2 = () => {
          const p2a = (flag ? scb - 60 : scb) * sunDim / 255;
          if (p2a <= 0) return;
          ctx.save();
          ctx.globalAlpha = Math.max(0, Math.min(1, p2a));
          ctx.translate(x, yD);
          ctx.rotate(ft * 2 - 7.3);
          // color2.RGB = sunColor×n12(:62368-62371/:62373)——染色值本身也乘 n12
          const im = (scr > 250 && scg > 250 && scb > 250) ? tex
            : this.tintTex(tex, scr * sunDim, scg * sunDim, scb * sunDim, 'sun');
          ctx.drawImage(im, -tex.width / 2 * scale, -tex.height / 2 * scale, tex.width * scale, tex.height * scale);
          ctx.restore();
        };
        // 通道①:本体
        ctx.save();
        if (ecl) {
          ctx.globalAlpha = Math.max(0, Math.min(1, sunDim));
          // 暗紫乘染(255·n12, sunG·n12, sunB·n12)
          const p1 = this.tintTex(tex, 255 * sunDim, scg * sunDim, scb * sunDim, 'sun3');
          ctx.translate(x, yD);
          ctx.rotate(ft * 2 - 7.3);
          ctx.drawImage(p1, -tex.width / 2 * scale, -tex.height / 2 * scale, tex.width * scale, tex.height * scale);
        } else {
          ctx.translate(x, yD);
          ctx.rotate(ft * 2 - 7.3);
          ctx.drawImage(tex, -tex.width / 2 * scale, -tex.height / 2 * scale, tex.width * scale, tex.height * scale);
        }
        ctx.restore();
        pass2();
        // 晨昏径向耀斑(NextHorizonRenderer.DrawSun :170-186):本体两通道之后、
        // Extra[280] 之前,画在太阳位(vector 同本体位,无旋转、中心锚)。
        // ★原版 color=(255,255,255,0) 不是反编译伪影——XNA 预乘 AlphaBlend 下
        //   A=0 → 目标混合因子 1−0=1 → 纹理 RGB 直接加亮(纯加法绘制惯用法,
        //   ×vis×系数 全部作用在 RGB 强度上)。曾误判"1.4.5.6 实测不可见,可见的
        //   晨昏耀斑全走 DrawLensFlare"整段跳绘(2026-08-26 用户对拍原版:
        //   太阳周围晨昏径向畸变光晕缺失定谳)。canvas 等价 = 'lighter' 合成 +
        //   globalAlpha=vis×系数。强度:flare1×2(sunset 0.75/0.35, scale 3/2)、
        //   flare2×3(sunrise 0.35/0.15/0.10, scale 2/1.5/1),全部 ×celestial
        //   (DrawSun 头 sunsetVisibility *= celestialVisibility 同式)。
        const hvs = this.horizonVisCache;
        if (hvs && (hvs.sunset > 0 || hvs.sunrise > 0)) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.imageSmoothingEnabled = true;   // 渐变贴图线性采样(原版 sampler=linear)
          ctx.translate(x, yD);
          const flareDraw = (tex: ImageBitmap | HTMLImageElement | null, a: number, sc: number) => {
            if (!tex || tex.width <= 0 || a <= 0) return;
            ctx.globalAlpha = Math.min(1, a);
            ctx.drawImage(tex, -tex.width / 2 * sc, -tex.height / 2 * sc, tex.width * sc, tex.height * sc);
          };
          flareDraw(this.sunflareTexLoad('flare1'), hvs.sunset * hvs.celestial * 0.75, 3);
          flareDraw(this.sunflareTexLoad('flare1'), hvs.sunset * hvs.celestial * 0.35, 2);
          flareDraw(this.sunflareTexLoad('flare2'), hvs.sunrise * hvs.celestial * 0.7 * 0.5, 2);
          flareDraw(this.sunflareTexLoad('flare2'), hvs.sunrise * hvs.celestial * 0.3 * 0.5, 1.5);
          flareDraw(this.sunflareTexLoad('flare2'), hvs.sunrise * hvs.celestial * 0.2 * 0.5, 1);
          ctx.restore();
        }
        // Extra[280] 墨镜叠层(:62380-62385):Sun2 档(color=通道①,非日食恒白 →
        // color3=(255,255,255,100)),同 vector/rotation/origin/scale 再画一张
        if (flag2) {
          const e280 = this.extra280TexImg();
          if (e280) {
            ctx.save();
            ctx.globalAlpha = 100 / 255;
            ctx.translate(x, yD);
            ctx.rotate(ft * 2 - 7.3);
            ctx.drawImage(e280, -e280.width / 2 * scale, -e280.height / 2 * scale, e280.width * scale, e280.height * scale);
            ctx.restore();
          }
        }
        // DrawSun 的 flare1/flare2:贴图是满 alpha 矩形(532×215/1166×254,无软边)
        // → 直接画=方片框(用户实报)。反编译 A=0 可能非伪影而是有意屏蔽——
        // 这两张图是 LensFlare shader 的输入素材,不经 shader 处理不该直画。
        // 太阳旁的横向光效由 drawLensFlare 链的 pointblurry 元素(scale 1.0,
        // 距离 0.6)承担,该链已修好并正常工作。
      }
    } else {
      this.sunScreen = null;
      const tex = this.fx.moonEventKind === 2 ? this.ensureEventMoonTex(2)
        : this.fx.moonEventKind === 1 ? this.ensureEventMoonTex(1)
          : this.ensureMoonTex(Math.max(0, Math.min(8, this.moonType)));
      if (tex && (tex.width > 0) && tex.width > 0) {
        const mw = tex.width; // 相位帧宽(50)
        const ft = nightTime / 32400;
        const dip = Math.pow(Math.abs(ft * 2 - 1), 2);
        const x = ft * (viewW + mw * 2) - mw;
        const y = bgTopY + dip * 250 + 180;
        const yD = y + this.moonModY;   // :62395 position = (num6, num7 + moonModY)
        const scale = 1.2 - dip * 0.4;
        const phase = Math.max(0, Math.min(7, clock.moonPhase)); // MoonPhase.cs:3-13(0=满…4=空;旧 dayCount%8 致首夜亏凸月+导入脱钩)
        // 月绘制色(:62378-62383 + SetBackColor:63354-63359):非血月恒白,
        // 血月红移;云遮蔽 ×(1-cloudAlpha·1.5·atmo)。★XNA moonColor*=num13 是
        // 全通道乘:贡献 = tex.rgb·mr·num13²(rgb 与 α 都乘)——染色值也乘 sunDim
        const moonCol: [number, number, number] = moonDrawColor(nightTime,
          !!(clock as { bloodMoon?: boolean }).bloodMoon);
        // 月色群系修正(蘑菇跨通道块 :63200-63228;★原文快照语义逐字保留)
        if (bio) applyBiomeToMoon(moonCol, bio);
        const mr = moonCol[0], mg = moonCol[1], mb = moonCol[2];
        const moonA = sunDim;
        const moonPlain = sunDim >= 0.999 && mr > 250 && mg > 250 && mb > 250;
        // ★夜月屏位登记(2026-08-20):compositeLight 在光照图注入月盘满光
        //   ——原版月亮直绘 backbuffer 不吃乘光,全屏乘光链曾把月亮压到
        //   月光地板(~0.075,"夜里的月亮不亮");月盘区乘法≈恒等即恢复原色
        //   (:62458 语义:基准 y + 帧尾衰减后 moonModY——见下方 decay 段)
        moonBase = { x, y, r: (mw / 2) * scale };
        ctx.save();
        ctx.globalAlpha = moonA;
        ctx.translate(x, yD);
        ctx.rotate(ft * 2 - 7.3);
        // 原版:竖条第 moonPhase 帧(0,MW*moonPhase,MW,MW),原点为中心;
        // 染色 = 月色×sunDim(全通道乘语义),晴夜白月直绘快速路径
        const mIm = moonPlain ? tex
          : this.tintTex(tex, mr * sunDim, mg * sunDim, mb * sunDim, `moon${this.fx.moonEventKind}`);
        ctx.drawImage(mIm, 0, mw * phase, mw, mw,
          -mw / 2 * scale, -mw / 2 * scale, mw * scale, mw * scale);
        ctx.restore();
      } else {
        this.moonScreen = null;
      }
    }
    ctx.restore();
    // sunModY/moonModY 每帧 ×0.999 衰减（Main.cs:62415-62416，short 截断——
    // 游戏内无写点恒 0 为 no-op；标题屏拖拽残留在切进世界后同式缓回 0）。
    // ★帧序对齐原版：绘制用衰减前值（:62376/:62395），LastCelestialBodyPosition
    // （:62458 = sunScreen/moonScreen 语义）用衰减后值
    this.sunModY = decayCelestialModY(this.sunModY);
    this.moonModY = decayCelestialModY(this.moonModY);
    if (sunBase) this.sunScreen = { x: sunBase.x, y: sunBase.y + this.sunModY };
    if (moonBase) this.moonScreen = { x: moonBase.x, y: moonBase.y + this.moonModY, r: moonBase.r };

    // 云：原版素材与规则（Cloud.cs / NextHorizonRenderer.DrawCloud）；
    // 塔天空激活时云量乘 GetCloudAlpha() = (1-fade)*0.3+0.7（各 Sky 同式 :116-119）
    this.towerCloudMul = this.towerCloudAlphaMul();
    this.drawVanillaClouds(ctx, viewW, viewH, isNight, dtMs, camX, camY);

    // ---- 极光（AuroraSky.cs：SkyManager maxDepth==MaxValue 层 = DrawSurfaceBG 内
    //      首个 DrawToDepth(1/0.09)，Main.cs:58829——即远距云(DrawClouds_Distant
    //      :58757)之后、云背景层之前；日月 :56310 画于其前【以反编译序为准】）----
    this.drawAurora(ctx, viewW, viewH, camY, dtMs, nightTime, isDay,
      Math.max(0, Math.min(7, clock.moonPhase ?? 0)));

    // 派对气球（PartySky 深 1.6..3.35 全 <5 = 全部背景层之前）——由 Renderer 在
    // 群系背景后调 drawPartyBalloonsNear（原版 DrawToDepth(1) 带 :59621；曾画山后）
    // 灯笼夜夜空（LanternSky：灯笼浮升层，需相机 Y 判地表门）——far 带（深度>5,
    // 远山之后）；near 带（深度≤5,山层之前）由 Renderer 在群系背景之后调
    // drawLanternsNear（原版 DrawToDepth(5) 前后带插入 :59310/:59322）
    this.drawLanterns(ctx, viewW, viewH, camX, camY, dtMs, 'far');

  }

}
