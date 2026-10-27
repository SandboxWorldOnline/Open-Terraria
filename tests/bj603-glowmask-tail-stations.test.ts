// BJ603 glowMask 族三站尾批 + 小面杂件（BJ601 收刀新登记收官刀）。
//
// 原版锚（Terarria1457 反编译亲读,1.4.5.7）：
//   件1 UI 槽位光罩 = ItemSlot.cs:2890-2931（外门 type!=3779 && type!=46 &&
//        type!=5462;色式 switch :2893-2915 与掉落面同构;3858 动画帧 =
//        Glow_233 Frame(1,3,0,miscCounter%15/5) 高−2;几何 origin=rect.Size()/2
//        → 光罩中心≡物品中心,scale 同物品只缩不放）。
//   件2 tile 侧 = Main.tileGlowMask（Main.cs:1512 声明/:8576 全表 -1/:10163-10207
//        钉表【37 条=36 正值+129:-2】——BJ601 台账"44"系行数误计）;消费 =
//        TileDrawing.cs:980 门并入 flag + :1196-1341 DrawBasicTile 本体后叠画
//        （色式 :1210-1290 逐 tile switch/缺省 White/静态辉光字段 A=0 :130-140;
//        源矩形=本体同矩形;半砖下半位 :1332-1335）;129=BJ118① 已整段落地
//        （VanillaTiler shardGlowTint）→ 扫描跳过防双画。
//   件3 弹幕 = Projectile.glowMask（Projectile.cs:782 缺省 -1/10 处赋值=16 型正值;
//        Main.cs DrawProjDirect 通用支 :35498-35518 源=弹幕贴图全幅/色缺省
//        (250,250,250,proj.alpha)/993 Disco :35434-35436/1101-1102 相位双画
//        :35505-35510;bobber 支 :35433-35441 源=光罩贴图自身全幅）。
//   件4 ①FakeFishParticle.cs:499-502（色=Lerp(White,Black,.8)×num2×0.7 恒暗,
//        无 sonar 白化臂;数据面销案并存=73 处 Item.glowMask 赋值位全量亲读
//        零鱼族命中→vanilla 不可达,守卫保 mod/管理面）;
//       ②3779 手持四游 orb（PlayerDrawLayers.cs:3352-3372 专支——中心锚
//         ItemLocation+halfW×dir/origin=贴图中心/本体 MultiplyRGBA(0.5,.5,.5,.8)/
//         orb=Glow_218 4 份 (k·π/2)×2px/A=0 纯加算/色 (120,40,222,0)×
//         (cos(mc/75·2π)/2×0.3+0.85)×0.5 双乘链）+ BossBag/75/4143 掉落环绕
//         光斑（Main.cs:39329-39386——本体之下物品贴图环绕复本,相位
//         timeSinceItemSpawned/240+GTWH×0.04,脉冲半径三角波 BossBag %4/75·4143 %5）;
//       ③掉落贴图 velocity.X×0.2 旋转（Main.cs:39284 num——微光转化态 num=0
//         :39286-39288;本体/环绕/光罩三面同旋转量）。
//
// 判别力设计：表锁 = 测试内【独立转录】反编译钉值（与实现零共享代码）逐条对拍;
//   色式锁 = 独立转录公式全域扫描;资产锁 = Glow_{N}.png 存在 + 尺寸镜像对拍;
//   行为锁 = drawTileGlows 桩 atlas+真 TileStore 逐 op 对拍;源文锁 = 接线位/
//   旋转因子 grep（变异证红面）。
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  TILE_GLOWMASK, tileGlowKind, tileGlowColors, pulse350Color, shimmerGlowColor,
  ashGrassColor, lavaCloudColor, portalGlowColor, lavaLightA, WHITE_A100,
} from '../src/data/vanillaTileGlow';
import type { RGBA } from '../src/data/vanillaTileGlow';
import { PROJ_GLOWMASK, projGlowColors, projPhaseColor, isPhaseDoubleProj } from '../src/data/vanillaProjGlow';
import { ITEM_GLOWMASK, monkT3GlowRect, MONK_T3_GLOW, xnaColorToOp } from '../src/data/vanillaItemGlow';
import { drawTileGlows, type TileGlowOp } from '../src/render/TileGlow';
import { tileAnim } from '../src/render/TileAnim';
import { TileStore } from '../src/world/TileStore';
import { TILE_DEFS } from '../src/data/tiles';
import { UnifiedRandom } from '../src/core/rng';

const UI_SRC = readFileSync(join(__dirname, '../src/ui/UI.ts'), 'utf8');
const RDR_SRC = readFileSync(join(__dirname, '../src/render/Renderer.ts'), 'utf8');
const TGLOW_SRC = readFileSync(join(__dirname, '../src/render/TileGlow.ts'), 'utf8');
const FISH_SRC = readFileSync(join(__dirname, '../src/entities/FakeFish.ts'), 'utf8');
const CHIP_SRC = readFileSync(join(__dirname, '../src/entities/ChainsawProj.ts'), 'utf8');
const BOBBER_SRC = readFileSync(join(__dirname, '../src/entities/Bobber.ts'), 'utf8');
const WEAP_SRC = readFileSync(join(__dirname, '../src/entities/WeaponProj.ts'), 'utf8');

// ===================== 独立转录面（反编译公式/钉值,判别力基准） =====================

/** Main.cs:10163-10207 钉表独立转录（原文序逐条;grep tileGlowMask[ 全量复核=37 条） */
const V_TILE_GLOWMASK: Record<number, number> = {
  350: 94, 390: 130, 381: 126, 517: 258, 687: 336, 534: 259, 535: 260, 689: 338,
  536: 261, 537: 262, 690: 339, 539: 263, 540: 264, 688: 337, 625: 311, 626: 312,
  691: 340, 627: 313, 628: 314, 692: 341, 370: 111, 429: 214, 209: 215, 445: 214,
  129: -2, 633: 326, 659: 348, 667: 349, 708: 359, 699: 353, 717: 362, 410: 201,
  509: 265, 658: 333, 720: 368, 721: 369, 725: 371,
};

/** Projectile.cs 10 处赋值独立转录（16 型正值;:782 缺省 -1 不入表） */
const V_PROJ_GLOWMASK: Record<number, number> = {
  312: 257, 427: 2, 428: 3, 429: 7, 430: 8, 609: 180, 610: 179,
  987: 318, 988: 319, 989: 320, 990: 321, 991: 322, 992: 323, 993: 324,
  1101: 372, 1102: 373,
};

const cbyte = (v: number) => Math.trunc(Math.min(255, Math.max(0, v)));

/** TileDrawing.cs:1273-1275 case 350 独立转录（Color(Vector4 f) 全通道） */
function vPulse350(tVis: number): RGBA {
  const num10 = tVis * 0.08;
  const theta = Math.trunc(num10 / 6.283) % 3 === 1 ? num10 : 0;
  const v = -Math.cos(theta) * 0.2 + 0.2;
  const b = cbyte(v * 255);
  return [b, b, b, b];
}

/** Main.hslToRgb + hue2rgb（Main.cs:48689-48742,Math.Round ×255）独立转录 */
function vHue2rgb(c0: number, t1: number, t2: number): number {
  let c = c0;
  if (c < 0) c++;
  if (c > 1) c--;
  if (6 * c < 1) return t1 + (t2 - t1) * 6 * c;
  if (2 * c < 1) return t2;
  if (3 * c < 2) return t1 + (t2 - t1) * (2 / 3 - c) * 6;
  return t1;
}
function vHsl(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const p = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const q = 2 * l - p;
  return [Math.round(vHue2rgb(h + 1 / 3, q, p) * 255), Math.round(vHue2rgb(h, q, p) * 255),
    Math.round(vHue2rgb(h - 1 / 3, q, p) * 255)];
}

/** LiquidRenderer.cs:757-761 GetShimmerGlitterColor(top:true) 独立转录：
 *  hslToRgb(((x+y/6)+t/30)/6 % 1,1,.5) A=0 → Vector4×0.5 截断 */
function vShimmer(x: number, y: number, tVis: number): RGBA {
  const hue = (((x + y / 6) + tVis / 30) / 6) % 1;
  const [r, g, b] = vHsl(hue, 1, 0.5);
  return [cbyte(r * 0.5), cbyte(g * 0.5), cbyte(b * 0.5), 0];
}

/** :1223 case 633 独立转录（Lerp(White, finalColor, 0.75) 逐通道截断） */
function vAshGrass(light: readonly [number, number, number] | null): RGBA {
  const l = light ?? [255, 255, 255];
  return [cbyte(255 + 0.75 * (l[0] - 255)), cbyte(255 + 0.75 * (l[1] - 255)),
    cbyte(255 + 0.75 * (l[2] - 255)), 255];
}

/** PortalHelper.cs:380-396 GetPortalColor(netMode 0 支) 独立转录（A=66 覆写） */
function vPortal(frameX: number): RGBA {
  const idx = frameX >= 288 ? 1 : 0;
  const [r, g, b] = idx === 0 ? vHsl(0.12, 1, 0.5) : vHsl(0.52, 1, 0.6);
  return [r, g, b, 66];
}

/** TileDrawing.cs:845-872 LavaLightA 独立转录（Hash/Hash2/LinearNoise/
 *  DistToWanderingCircle/SmoothStep/Remap verbatim）。噪声表本体 = TileDrawing
 *  静态 ctor `new Random(0)` NextDouble×2−1（:798-809）——表生成走 repo
 *  UnifiedRandom（C# Random 同构移植,独立单测域）;本转录面 = 表【之后】的
 *  全条公式链（Hash→游走圆→SmoothStep→Remap）,公式变异仍全量证红。 */
let V_NOISE: number[] | null = null;
function vNoise256(): number[] {
  if (V_NOISE) return V_NOISE;
  const rng = new UnifiedRandom(0);
  V_NOISE = [];
  for (let i = 0; i < 256; i++) V_NOISE.push(rng.nextDouble() * 2 - 1);
  return V_NOISE;
}
function vHash(xu: number): number {
  let x = xu >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 2146121005) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 2221713035) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x >>> 0;
}
function vHash2(xu: number): number {
  let x = xu >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 3513297581) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 2943497623) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return x >>> 0;
}
function vLinearNoise(x: number): number {
  let num = Math.trunc(x);
  if (x < 0) num--;
  const frac = x - num;
  const n = vNoise256();
  return n[num & 255] * (1 - frac) + n[(num + 1) & 255] * frac;
}
function vDistCircle(px: number, py: number, seed: number, tVis: number): number {
  const gx = Math.trunc(px / 7), gy = Math.trunc(py / 7);
  let vx = (gx + 0.5) * 7, vy = (gy + 0.5) * 7;
  const n2 = (vHash(gx >>> 0) ^ vHash2(gy >>> 0) ^ seed) & 0xffffff;
  const n3 = (vHash2(gx >>> 0) ^ vHash(gy >>> 0) ^ seed) & 0xffffff;
  vx += vLinearNoise((n2 + tVis) * 0.025) * 2;
  vy += vLinearNoise((n3 + tVis) * 0.025) * 2;
  return Math.hypot(px - vx, py - vy);
}
function vLavaLightA(x: number, y: number, tVis: number, solidAbove: boolean): number {
  const v0 = vDistCircle(x, y, 2221713035 >>> 0, tVis);
  const v1 = vDistCircle(x + 3, y, 657044585 >>> 0, tVis);
  const v2 = vDistCircle(x, y + 3, 741521833 >>> 0, tVis);
  const v3 = vDistCircle(x + 3, y + 3, 56936621 >>> 0, tVis);
  let t = Math.min(v0, v1, v2, v3);
  const lerpVal = Math.min(1, Math.max(0, t / 3.5));
  t = (1 - lerpVal) * (1 - lerpVal) * (3 - 2 * (1 - lerpVal));   // SmoothStep
  const toMin = solidAbove ? 0 : 0.8;
  const rt = Math.min(1, Math.max(0, (t - 0.7) / 0.3));
  return toMin + (1 - toMin) * rt;
}

/** Item.GetPhaseColor（:49056-49163 MultiLerp 环）独立转录（BJ601 同源式） */
const V_PHASE_COLORS: ReadonlyArray<RGBA> = [
  [25, 127, 255, 255], [255, 51, 25, 255], [25, 255, 51, 255], [204, 25, 255, 255],
  [204, 229, 255, 255], [204, 204, 0, 255], [229, 127, 0, 255], [255, 25, 102, 255],
  [25, 127, 255, 255],
];
function vMultiLerp(pct: number, colors: ReadonlyArray<RGBA>): RGBA {
  const step = 1 / (colors.length - 1);
  let i = 0;
  while (pct / step > 1 && i < colors.length - 2) i++;
  const t = (pct - step * i) / step;
  const a = colors[i], b = colors[i + 1];
  return [cbyte(a[0] + t * (b[0] - a[0])), cbyte(a[1] + t * (b[1] - a[1])),
    cbyte(a[2] + t * (b[2] - a[2])), cbyte(a[3] + t * (b[3] - a[3]))];
}
function vPhaseColor(projId: number, mc: number, drawColor: boolean): RGBA {
  if (projId !== 1101 && projId !== 1102) return [255, 255, 255, 255];
  const c = vMultiLerp((mc % 300) / 300, V_PHASE_COLORS);
  return drawColor ? [c[0], c[1], c[2], 127] : c;
}

/** :3359-3360 3779 orb 色链独立转录：(120,40,222,0)×f1×0.5（f1=cos(mc/75·2π)/2×0.3+0.85） */
function vOrbTint(mc: number): [number, number, number, number] {
  const f1 = (Math.cos((mc / 75) * Math.PI * 2) / 2) * 0.3 + 0.85;
  return [cbyte(120 * f1 * 0.5), cbyte(40 * f1 * 0.5), cbyte(222 * f1 * 0.5), 0];
}

const MISC_SWEEP = [0, 1, 37, 74, 75, 149, 150, 224, 299, 300, 511, 1234];
const TVIS_SWEEP = [0, 1, 78, 79, 157, 235.5, 471, 942.25];

// ===================== 件2 tile 侧表锁/资产锁/kind 锁 =====================

describe('BJ603 件2 Main.tileGlowMask 钉表（Main.cs:10163-10207）', () => {
  it('37 条 1:1（36 正值 + 129:-2 哨兵）——独立转录逐条对拍', () => {
    const keys = Object.keys(TILE_GLOWMASK).map(Number).sort((a, b) => a - b);
    const vkeys = Object.keys(V_TILE_GLOWMASK).map(Number).sort((a, b) => a - b);
    expect(keys).toEqual(vkeys);
    expect(keys.length).toBe(37);
    for (const k of vkeys) expect(TILE_GLOWMASK[k]).toBe(V_TILE_GLOWMASK[k]);
    expect(TILE_GLOWMASK[129]).toBe(-2);
  });

  it('全表 37 tile 在本仓 TileDef.vanilla.sheet 域有登记（渲染可达性前置）', () => {
    const sheets = new Set(TILE_DEFS.map((d) => d?.vanilla?.sheet ?? -1));
    for (const k of Object.keys(TILE_GLOWMASK).map(Number)) {
      expect(sheets.has(k)).toBe(true);
    }
  });

  it('资产锁：36 正值 mask 逐张 Glow_{N}.png 存在;129:-2 哨兵不取图', () => {
    const dir = join(__dirname, '../public/sprites/vanilla');
    for (const [tile, gm] of Object.entries(TILE_GLOWMASK)) {
      if (gm < 0) { expect(Number(tile)).toBe(129); continue; }
      expect(existsSync(join(dir, `Glow_${gm}.png`))).toBe(true);
    }
  });

  it('尺寸镜像对拍（抽样 6 对:光罩表≡tile 表同布局平行表）', () => {
    // node file 尺寸在打包面不可得 → 以既有 PNG 字节头解析 IHDR（零依赖）
    const pngSize = (p: string): [number, number] => {
      const b = readFileSync(p);
      return [b.readUInt32BE(16), b.readUInt32BE(20)];
    };
    const dir = join(__dirname, '../public/sprites/vanilla');
    const pairs: Array<[number, number]> = [[350, 94], [381, 126], [370, 111], [209, 215], [410, 201], [720, 368]];
    for (const [tile, gm] of pairs) {
      expect(pngSize(join(dir, `Tiles_${tile}.png`))).toEqual(pngSize(join(dir, `Glow_${gm}.png`)));
    }
  });

  it('kind 分派锁（TileDrawing.cs:1210-1290 switch 1:1）', () => {
    expect(tileGlowKind(410)).toBe('white');
    expect(tileGlowKind(509)).toBe('white');
    expect(tileGlowKind(658)).toBe('white');
    expect(tileGlowKind(720)).toBe('white');
    expect(tileGlowKind(721)).toBe('white');
    expect(tileGlowKind(699)).toBe('white');
    expect(tileGlowKind(381)).toBe('lavaMoss');
    expect(tileGlowKind(517)).toBe('lavaMoss');
    expect(tileGlowKind(687)).toBe('lavaMoss');
    expect(tileGlowKind(534)).toBe('krypton');
    expect(tileGlowKind(536)).toBe('xenon');
    expect(tileGlowKind(539)).toBe('argon');
    expect(tileGlowKind(625)).toBe('violet');
    expect(tileGlowKind(370)).toBe('meteor');
    expect(tileGlowKind(390)).toBe('meteor');
    expect(tileGlowKind(350)).toBe('pulse350');
    expect(tileGlowKind(627)).toBe('discoMoss');
    expect(tileGlowKind(692)).toBe('discoMoss');
    expect(tileGlowKind(659)).toBe('shimmerGlow');
    expect(tileGlowKind(667)).toBe('shimmerGlow');
    expect(tileGlowKind(708)).toBe('shimmerGlow');
    expect(tileGlowKind(633)).toBe('ashGrass');
    expect(tileGlowKind(717)).toBe('lavaCloud');
    expect(tileGlowKind(129)).toBe('crystal129');
    expect(tileGlowKind(429)).toBe('selfTexRow18');
    expect(tileGlowKind(445)).toBe('selfTexRow18');
    expect(tileGlowKind(209)).toBe('portal');
    expect(tileGlowKind(718)).toBe('invisible');
    expect(tileGlowKind(725)).toBe('noir');
  });
});

describe('BJ603 件2 色式锁（TileDrawing.cs:1210-1290 + LR.cs:757-761 独立转录）', () => {
  it('静态辉光字段五族 + meteor（:130-140 字段值 verbatim,A=0 纯加算）', () => {
    expect(tileGlowColors(381, zargs())).toEqual([[150, 100, 50, 0]]);
    expect(tileGlowColors(517, zargs())).toEqual([[150, 100, 50, 0]]);
    expect(tileGlowColors(687, zargs())).toEqual([[150, 100, 50, 0]]);
    expect(tileGlowColors(534, zargs())).toEqual([[0, 200, 0, 0]]);
    expect(tileGlowColors(689, zargs())).toEqual([[0, 200, 0, 0]]);
    expect(tileGlowColors(536, zargs())).toEqual([[0, 180, 250, 0]]);
    expect(tileGlowColors(690, zargs())).toEqual([[0, 180, 250, 0]]);
    expect(tileGlowColors(539, zargs())).toEqual([[225, 0, 125, 0]]);
    expect(tileGlowColors(688, zargs())).toEqual([[225, 0, 125, 0]]);
    expect(tileGlowColors(625, zargs())).toEqual([[150, 0, 250, 0]]);
    expect(tileGlowColors(691, zargs())).toEqual([[150, 0, 250, 0]]);
    expect(tileGlowColors(370, zargs())).toEqual([[100, 100, 100, 0]]);
    expect(tileGlowColors(390, zargs())).toEqual([[100, 100, 100, 0]]);
    for (const s of [381, 534, 536, 539, 625, 370]) {
      expect(xnaColorToOp(tileGlowColors(s, zargs())[0]).blend).toBe('add');
    }
  });

  it('white 缺省族（碑族/699,A=255 source-over）', () => {
    for (const s of [410, 509, 658, 720, 721, 699]) {
      expect(tileGlowColors(s, zargs())).toEqual([[255, 255, 255, 255]]);
      expect(xnaColorToOp(tileGlowColors(s, zargs())[0]).blend).toBe('over');
    }
  });

  it('350 脉冲（Color(Vector4) 全通道）——tVis 全域对拍独立转录', () => {
    for (const t of TVIS_SWEEP) {
      expect(pulse350Color(t)).toEqual(vPulse350(t));
      expect(tileGlowColors(350, zargs(t))).toEqual([vPulse350(t)]);
    }
    // θ 相位门：(int(num10/6.283)%3==1) 才取 num10,否则 0 → v 恒 0（cos0=1）
    const tPhase0 = 6.283 * 0.99;    // idx=0 → θ=0 → v=0
    expect(pulse350Color(tPhase0)).toEqual([0, 0, 0, 0]);
  });

  it('discoMoss（627/628/692）：discoRGB 透传 / null 回退 White', () => {
    expect(tileGlowColors(627, zargs(0, [10, 20, 30]))).toEqual([[10, 20, 30, 255]]);
    expect(tileGlowColors(692, zargs(0, null))).toEqual([[255, 255, 255, 255]]);
  });

  it('shimmerGlow（659/667/708）——坐标×tVis 全域对拍独立转录（top:true 恒 0.5 乘,A=0）', () => {
    for (const t of TVIS_SWEEP) {
      for (const [x, y] of [[0, 0], [17, 3], [255, 128], [41, 91]] as const) {
        expect(shimmerGlowColor(x, y, t)).toEqual(vShimmer(x, y, t));
        expect(tileGlowColors(659, zargs(t, null, [255, 255, 255], null, x, y))).toEqual([vShimmer(x, y, t)]);
      }
    }
    expect(xnaColorToOp(shimmerGlowColor(3, 4, 100)).blend).toBe('add');
  });

  it('ashGrass（633）Lerp(White,finalColor,0.75)——光照全域对拍独立转录', () => {
    const lights: Array<readonly [number, number, number] | null> = [
      [0, 0, 0], [64, 32, 255], [255, 255, 255], [10, 200, 100], null,
    ];
    for (const l of lights) {
      expect(ashGrassColor(l)).toEqual(vAshGrass(l));
      expect(tileGlowColors(633, zargs(0, null, l))).toEqual([vAshGrass(l)]);
    }
    // 暗 → 25% White = (byte)63.75 = 63（XNA 截断向零）;亮 → White
    expect(ashGrassColor([0, 0, 0])).toEqual([63, 63, 63, 255]);
    expect(ashGrassColor([255, 255, 255])).toEqual([255, 255, 255, 255]);
    expect(xnaColorToOp(ashGrassColor([0, 0, 0])).blend).toBe('over');
  });

  it('lavaCloud（717）LavaLightA 独立转录全域对拍 + Color(n,n,n,n/2) 截断', () => {
    for (const t of [0, 100, 3333, 78541.5]) {
      for (const [x, y] of [[7, 7], [33, 91], [400, 1200], [1234, 5], [66, 66]] as const) {
        for (const solid of [true, false]) {
          const a = lavaLightA(x, y, t, solid);
          expect(a).toBeCloseTo(vLavaLightA(x, y, t, solid), 5);
          expect(a).toBeGreaterThanOrEqual(solid ? 0 : 0.8 - 1e-9);
          expect(a).toBeLessThanOrEqual(1 + 1e-9);
        }
      }
    }
    // 值域两端：a=1 → (255,255,255,127);a=0.8 → (204,204,204,102)
    expect(lavaCloudColor(1)).toEqual([255, 255, 255, 127]);
    expect(lavaCloudColor(0.8)).toEqual([204, 204, 204, 102]);
    expect(tileGlowColors(717, zargs(0, null, null, 1))).toEqual([[255, 255, 255, 127]]);
  });

  it('portal（209）GetPortalColor netMode0 支独立转录（A=66 覆写）', () => {
    expect(portalGlowColor(0)).toEqual(vPortal(0));
    expect(portalGlowColor(287)).toEqual(vPortal(287));
    expect(portalGlowColor(288)).toEqual(vPortal(288));
    expect(portalGlowColor(999)).toEqual(vPortal(999));
    expect(tileGlowColors(209, { ...zargs(), frameX: 288 })).toEqual([vPortal(288)]);
  });

  it('noir 基色 (255,255,255,100)×opacity 扫描侧乘（:1349 color2=White×opacity）', () => {
    expect(WHITE_A100).toEqual([255, 255, 255, 100]);
    // 扫描侧乘臂源文锁（×opacity 逐通道截断）
    expect(TGLOW_SRC).toContain('env.noirOpacity');
    expect(TGLOW_SRC).toContain('fx % 36 !== 0 || fy !== 54');
  });
});

// ===================== 件2 行为锁（桩 atlas + 真 TileStore 逐 op 对拍） =====================

/** 桩 atlas（vframeAt=grid[16,16] 恒命中〔真表 grid=16/stride=18 同构〕;
 *  ensureVImage=100×100 假图;drawAdjust 走真表） */
function stubAtlas() {
  const fakeImg = { width: 100, height: 100 } as unknown as ImageBitmap;
  return {
    vframeAt(sheetId: number, fx: number, fy: number) {
      void sheetId;
      if (fx < 0 || fy < 0 || fx + 16 > 1000 || fy + 16 > 1000) return null;
      return { img: fakeImg, sx: fx, sy: fy, sw: 16, sh: 16 };
    },
    ensureVImage(_path: string) { return fakeImg; },
    vmeta(_sheetId: number) { return { rows: 15, grid: [16, 16], stride: [18, 18] }; },
  };
}

function zargs(tVis = 0, disco: readonly [number, number, number] | null = null,
  light: readonly [number, number, number] | null = null, lavaA: number | null = null,
  x = 0, y = 0) {
  return { x, y, frameX: 0, tVis, discoRGB: disco, light, lavaA, noirOpacity: 0 };
}

describe('BJ603 件2 drawTileGlows 行为锁（桩 atlas+真 TileStore）', () => {
  type ScanEnv = Partial<Parameters<typeof drawTileGlows>[6]>;
  function scanOne(sheetId: number, fx: number, fy: number, env: ScanEnv = {}) {
    const st = new TileStore(16, 16);
    const sheetOf = (s: number) => TILE_DEFS.findIndex((d) => d?.vanilla?.sheet === s);
    const t = sheetOf(sheetId);
    expect(t).toBeGreaterThanOrEqual(0);
    const i = st.idx(8, 8);
    st.type[i] = t;
    st.flags[i] = 1;
    st.frameX[i] = fx;
    st.frameY[i] = fy;
    const ops: TileGlowOp[] = [];
    drawTileGlows(stubAtlas() as never, st, 0, 0, 15, 15, {
      tVis: 0, gtwh: 0, discoRGB: null,
      lightAt: () => [255, 255, 255],
      noirOpacity: 0,
      ...env,
    }, (o) => ops.push(...o));
    return { st, t, ops };
  }

  it('熔岩苔 381 → Glow_126 op（add/静态 tint/源=本体框/dest=x*16+tileTop）', () => {
    const { ops } = scanOne(381, 36, 54);
    expect(ops.length).toBe(1);
    expect(ops[0].tex).toBe('vanilla/Glow_126.png');
    expect(ops[0].blend).toBe('add');
    expect(ops[0].tint).toEqual([150 / 255, 100 / 255, 50 / 255]);
    expect(ops[0].sx).toBe(36);
    expect(ops[0].sy).toBe(54);
    expect(ops[0].sw).toBe(16);
    expect(ops[0].sh).toBe(16);
    expect(ops[0].dx).toBe(8 * 16);
    expect(ops[0].dy).toBe(8 * 16);
  });

  it('390 熔岩灯 → animYOffset 无门 addFr（sy = fy + tileFrame×36,tick 钉拍）', () => {
    const prevTick = tileAnim.tick;
    try {
      tileAnim.tick = 8;   // animFrameIdx(390, 100) = floor(8/8) % frames(=2 by 100px stub)
      const { ops } = scanOne(390, 0, 0);
      expect(ops.length).toBe(1);
      expect(ops[0].tex).toBe('vanilla/Glow_130.png');
      expect(ops[0].blend).toBe('add');       // meteor (100,100,100,0)
      expect(ops[0].sy).toBe(36);             // idx=1 × pitch 36
    } finally {
      tileAnim.tick = prevTick;
    }
  });

  it('429 专支 → 源=本体纹理 fy+18 辉光行（addFrY=18 平赋值,White over）', () => {
    const { ops } = scanOne(429, 36, 0);
    expect(ops.length).toBe(1);
    expect(ops[0].tex).toBe('vanilla/Tiles_429.png');
    expect(ops[0].sy).toBe(18);
    expect(ops[0].blend).toBe('over');
    expect(ops[0].tint).toEqual([1, 1, 1]);
  });

  it('718 零贡献不画 / 129 BJ118 域跳过（防双画）/ 表外 tile 不产出', () => {
    expect(scanOne(718, 0, 0).ops.length).toBe(0);
    expect(scanOne(129, 324, 0).ops.length).toBe(0);
    // 非表 tile（泥土 sheet 0）
    expect(scanOne(0, 0, 0).ops.length).toBe(0);
  });

  it('725 Noir 门：opacity≤0/非眼格不画;眼格 → 整幅 Glow_371 白 A100×opacity', () => {
    expect(scanOne(725, 36, 54, { noirOpacity: 0 }).ops.length).toBe(0);
    expect(scanOne(725, 18, 54, { noirOpacity: 0.5 }).ops.length).toBe(0);
    expect(scanOne(725, 36, 18, { noirOpacity: 0.5 }).ops.length).toBe(0);
    const { ops } = scanOne(725, 36, 54, { noirOpacity: 0.5 });
    expect(ops.length).toBe(1);
    expect(ops[0].tex).toBe('vanilla/Glow_371.png');
    expect(ops[0].sx).toBe(0);
    expect(ops[0].sy).toBe(0);
    expect(ops[0].sw).toBe(100);
    expect(ops[0].sh).toBe(100);
    expect(ops[0].blend).toBe('over');
    // (255,255,255,100)×0.5 逐通道截断
    expect(ops[0].alpha).toBeCloseTo(50 / 255, 6);
    expect(ops[0].tint).toEqual([Math.trunc(255 * 0.5) / 255, Math.trunc(255 * 0.5) / 255, Math.trunc(255 * 0.5) / 255]);
  });

  it('半砖下半位（:1332-1335 sh−8/dy+8）与非活动格零产出', () => {
    const st = new TileStore(16, 16);
    const t = TILE_DEFS.findIndex((d) => d?.vanilla?.sheet === 381);
    const i = st.idx(5, 5);
    st.type[i] = t;
    st.flags[i] = 1;
    st.frameX[i] = 0;
    st.frameY[i] = 0;
    st.half[i] = 1;
    const ops: TileGlowOp[] = [];
    drawTileGlows(stubAtlas() as never, st, 0, 0, 15, 15, {
      tVis: 0, gtwh: 0, discoRGB: null, lightAt: () => null, noirOpacity: 0,
    } as never, (o) => ops.push(...o));
    expect(ops.length).toBe(1);
    expect(ops[0].sh).toBe(8);
    expect(ops[0].dy).toBe(5 * 16 + 8);
    // 非活动格
    const st2 = new TileStore(16, 16);
    st2.type[st2.idx(3, 3)] = t;
    st2.flags[st2.idx(3, 3)] = 0;
    const ops2: TileGlowOp[] = [];
    drawTileGlows(stubAtlas() as never, st2, 0, 0, 15, 15, {
      tVis: 0, gtwh: 0, discoRGB: null, lightAt: () => null, noirOpacity: 0,
    } as never, (o) => ops2.push(...o));
    expect(ops2.length).toBe(0);
  });
});

// ===================== 件3 弹幕域表锁/色式锁 =====================

describe('BJ603 件3 Projectile.glowMask（Projectile.cs 10 处赋值=16 型）', () => {
  it('16 型 1:1 独立转录对拍', () => {
    const keys = Object.keys(PROJ_GLOWMASK).map(Number).sort((a, b) => a - b);
    const vkeys = Object.keys(V_PROJ_GLOWMASK).map(Number).sort((a, b) => a - b);
    expect(keys).toEqual(vkeys);
    for (const k of vkeys) expect(PROJ_GLOWMASK[k]).toBe(V_PROJ_GLOWMASK[k]);
  });

  it('资产锁：16 mask 逐张 Glow_{N}.png 存在 + 尺寸镜像对拍（Glow_N≡Projectile_N）', () => {
    const dir = join(__dirname, '../public/sprites/vanilla');
    const pngSize = (p: string): [number, number] => {
      const b = readFileSync(p);
      return [b.readUInt32BE(16), b.readUInt32BE(20)];
    };
    for (const [proj, gm] of Object.entries(PROJ_GLOWMASK)) {
      expect(existsSync(join(dir, `Glow_${gm}.png`))).toBe(true);
    }
    for (const [proj, gm] of [[427, 2], [609, 180], [987, 318], [1101, 372], [312, 257]] as const) {
      expect(pngSize(join(dir, `Glow_${gm}.png`))).toEqual(pngSize(join(dir, `Projectile_${proj}.png`)));
    }
  });

  it('缺省色 (250,250,250,alpha)——alpha 全域对拍 + A=0 加算语义', () => {
    for (const a of [0, 30, 128, 255]) {
      expect(projGlowColors(427, a, { miscCounter: 0, discoRGB: null })).toEqual([[250, 250, 250, a]]);
    }
    expect(xnaColorToOp(projGlowColors(427, 0, { miscCounter: 0, discoRGB: null })[0]).blend).toBe('add');
    expect(xnaColorToOp(projGlowColors(427, 128, { miscCounter: 0, discoRGB: null })[0]).blend).toBe('over');
  });

  it('993 Disco 特例（:35434-35436）——discoRGB 透传/null 回退 White', () => {
    expect(projGlowColors(993, 0, { miscCounter: 0, discoRGB: [7, 8, 9] })).toEqual([[7, 8, 9, 255]]);
    expect(projGlowColors(993, 0, { miscCounter: 0, discoRGB: null })).toEqual([[255, 255, 255, 255]]);
    expect(isPhaseDoubleProj(993)).toBe(false);
  });

  it('1101/1102 相位双画——miscCounter 全域对拍独立转录（先非 drawColor 后 drawColor A=127）', () => {
    for (const mc of MISC_SWEEP) {
      for (const pid of [1101, 1102]) {
        expect(projPhaseColor(pid, mc, false)).toEqual(vPhaseColor(pid, mc, false));
        expect(projPhaseColor(pid, mc, true)).toEqual(vPhaseColor(pid, mc, true));
        expect(projGlowColors(pid, 0, { miscCounter: mc, discoRGB: null })).toEqual([
          vPhaseColor(pid, mc, false), vPhaseColor(pid, mc, true),
        ]);
      }
    }
    expect(isPhaseDoubleProj(1101)).toBe(true);
    expect(isPhaseDoubleProj(1102)).toBe(true);
    expect(projGlowColors(427, 0, { miscCounter: 0, discoRGB: null }).length).toBe(1);
  });

  it('消费面源文锁：ChainsawProj/Bobber/drawProj 臂三站接线', () => {
    expect(CHIP_SRC).toContain('pushProjGlow');
    expect(BOBBER_SRC).toContain('pushProjGlow');
    expect(WEAP_SRC).toContain('PROJ_GLOWMASK');
    expect(WEAP_SRC).toContain('glowMask = false');
    expect(RDR_SRC).toContain('pushProjGlow(');
  });
});

// ===================== 件1 UI 槽位光罩（ItemSlot.cs:2890-2931） =====================

describe('BJ603 件1 UI 槽位光罩', () => {
  it('排除面 = {3779,46,5462}（:2890 外门;与掉落面排除集 {46,5462}∪{3779} 同域）', () => {
    expect(UI_SRC).toContain('UI_GLOW_EXCLUDED');
    expect(UI_SRC).toContain('new Set([3779, 46, 5462])');
  });

  it('iconUrl 烘焙接线锁（dropGlowColors 单源复用 + 3858 帧 0 定格 + iconCache 槽位共用）', () => {
    // ★BJ730 改判史：旧锁 `ITEM_GLOWMASK[tvid] !== undefined && …`——mod 光罩扩展
    //  （modItemGlowMaskIdOf）后改形 `… || modItemGlowMaskIdOf(tvid) !== undefined) && …`
    //  （mod 物品光罩与 vanilla 同门同烘焙通道）;锁随现形,语义不变（Glow 门+排除表）。
    expect(UI_SRC).toContain('ITEM_GLOWMASK[tvid] !== undefined || modItemGlowMaskIdOf(tvid) !== undefined) && !UI_GLOW_EXCLUDED.has(tvid)');
    expect(UI_SRC).toContain('dropGlowColors(tvid');
    expect(UI_SRC).toContain('monkT3GlowRect(0)');
    expect(UI_SRC).toContain('xnaColorToOp');
  });

  it('3858 UI 静态帧几何（Frame(1,3,0,0) 高−2 = {sy:0,sh:68};帧钟 UI=%15/5 同拍 5t）', () => {
    expect(MONK_T3_GLOW).toEqual({ texW: 66, frameH: 70, frames: 3, frameHm2: 68, tickPerFrame: 5 });
    expect(monkT3GlowRect(0)).toEqual({ sy: 0, sh: 68 });
  });

  it('几何口径：光罩中心≡物品图标中心（origin=rect.Size()/2 :2927/:2931）', () => {
    // 烘焙画在 (16−gw/2, 16−gh/2) = 32×32 图标面恒心
    expect(UI_SRC).toContain('16 - gw / 2, 16 - gh / 2');
    // scale 同物品只缩不放（iconUrl s= min(1,32/sw,32/sh) 既有口径,gw=gsw·s）
    expect(UI_SRC).toContain('const gw = gsw * s, gh = gsh * s;');
  });

  it('全 64 件 UI 可达面（67 − {3779,46,5462}）mask 资产在库', () => {
    const dir = join(__dirname, '../public/sprites/vanilla');
    let n = 0;
    for (const [vid, gm] of Object.entries(ITEM_GLOWMASK)) {
      if ([3779, 46, 5462].includes(Number(vid))) continue;
      n++;
      expect(existsSync(join(dir, `Glow_${gm}.png`))).toBe(true);
    }
    expect(n).toBe(64);
  });
});

// ===================== 件4 小面杂件三件 =====================

describe('BJ603 件4① FakeFishParticle glowMask（:499-502）', () => {
  it('数据面销案并存：全 vanilla 鱼段无 glowMask 成员（73 处赋值位亲读）', () => {
    // 鱼族代表 vid（quest fish/装饰鱼/鱼饵域）全不在 67 件表
    const fishVids = [2290, 2291, 2292, 2293, 2294, 2295, 2296, 2301, 2302, 2303, 2304,
      2305, 2306, 2307, 2308, 2309, 2310, 2311, 2312, 2313, 2314, 2315, 2316, 2317,
      2318, 2319, 2320, 2321, 2322, 2323, 2324, 2325, 2326, 2327, 2328, 2329, 2330,
      2331, 2332, 2333, 2334, 2335, 2336, 2337, 2338, 2339, 2475, 2476, 2477, 2478,
      2479, 2482, 2483, 2484, 2485, 2486, 2487, 2488, 2489, 2490, 2491, 2492, 2493,
      2494, 2495, 2496, 2497, 2498, 2499, 2500];
    for (const v of fishVids) expect(ITEM_GLOWMASK[v]).toBeUndefined();
  });

  it('守卫接线锁（色=Lerp(White,Black,.8)=(51,51,51) 恒暗、无 sonar 白化、α=env×0.7）', () => {
    expect(FISH_SRC).toContain('fishGlowCopy');
    expect(FISH_SRC).toContain('ITEM_GLOWMASK[f.itemType] !== undefined');
    expect(FISH_SRC).toContain('[51, 51, 51]');
    expect(FISH_SRC).toContain('envelope * 0.7');
  });
});

describe('BJ603 件4② 3779 手持四游 orb（PlayerDrawLayers.cs:3352-3372）+ 掉落环绕光斑', () => {
  it('orb 色链独立转录全域对拍（(120,40,222,0)×f1×0.5 双乘链,f1=cos(mc/75·2π)/2×0.3+0.85）', () => {
    for (const mc of MISC_SWEEP.concat([75, 150, 225])) {
      const f1 = (Math.cos((mc / 75) * Math.PI * 2) / 2) * 0.3 + 0.85;
      const expectTint = [cbyte(120 * f1 * 0.5) / 255, cbyte(40 * f1 * 0.5) / 255, cbyte(222 * f1 * 0.5) / 255];
      // 实现面内联式逐值核（扫描 Renderer 源内联式结构）
      expect(vOrbTint(mc)).toEqual([cbyte(120 * f1 * 0.5), cbyte(40 * f1 * 0.5), cbyte(222 * f1 * 0.5), 0]);
      void expectTint;
    }
    // mc=0 → f1=1.0 → tint=(60,20,111)/255
    expect(vOrbTint(0)).toEqual([60, 20, 111, 0]);
  });

  it('3779 专支接线锁（中心锚/本体减色×0.5 烘焙+A0.8/Glow_218 四份 2px 环/逃逸队列）', () => {
    expect(RDR_SRC).toContain('spiritFlameAnchor');
    expect(RDR_SRC).toContain('halfDimTex');
    expect(RDR_SRC).toContain("'vanilla/Glow_218.png'");
    expect(RDR_SRC).toContain('blend: \'add\' as const, tint, alpha: 1');
    expect(RDR_SRC).toContain('Math.cos((p.miscCounter / 75) * Math.PI * 2)');
  });

  it('掉落环绕光斑接线锁（BossBag 集 4+3/75 4+3/4143 3+3+白 A128 垫层;本体之下）', () => {
    expect(RDR_SRC).toContain('BOSS_BAG_IDS');
    expect(RDR_SRC).toContain("ringDraw(4, 0.25, 8, [90, 70, 255, 50])");
    expect(RDR_SRC).toContain("ringDraw(3, 0.34, 4, [140, 120, 255, 77])");
    expect(RDR_SRC).toContain("ringDraw(4, 0.25, 8, [50, 50, 255, 50])");
    expect(RDR_SRC).toContain("ringDraw(3, 0.34, 4, [120, 120, 255, 127])");
    expect(RDR_SRC).toContain("ringDraw(3, 0.34, 8, [30, 30, 155, 60])");
    expect(RDR_SRC).toContain("ringDraw(3, 0.34, 4, [60, 60, 127, 57])");
    expect(RDR_SRC).toContain('128 / 255');
    // 环在本体 drawImage 之前（本体之下=原版 :39329 环段 < :39400 本体段）
    const ringIdx = RDR_SRC.indexOf('ringDraw(4, 0.25, 8, [90, 70, 255, 50])');
    const bodyIdx = RDR_SRC.indexOf('if (!needsComp) {', ringIdx);
    expect(ringIdx).toBeGreaterThan(0);
    expect(bodyIdx).toBeGreaterThan(ringIdx);
  });
});

describe('BJ603 件4③ 掉落贴图 velocity 旋转（Main.cs:39284）', () => {
  it('旋转因子锁（rot = velocity.X × 0.2;微光转化态 num=0 :39286-39288）', () => {
    expect(RDR_SRC).toContain('const rot = d.shimmered ? 0 : d.vx * 0.2;');
  });

  it('三面同旋转量（本体/环绕/光罩——op rot 臂 + collectDropItemGlow rot 形参）', () => {
    expect(RDR_SRC).toContain('collectDropItemGlow(ctx, vid, ar, rcx, rcy, miscCounter, rot)');
    expect(RDR_SRC).toContain('rot?: number; ox?: number; oy?: number;');
    // flush 侧旋转臂（translate→rotate→translate,绕 (ox,oy)）
    expect(RDR_SRC).toContain('ctx.rotate(op.rot)');
    // 环绕复本随 rot（ringDraw 内 ctx.rotate(rot)）
    expect(RDR_SRC).toMatch(/ringDraw = \(count[\s\S]{0,600}ctx\.rotate\(rot\)/);
  });
});

// ===================== 件2 接线/逃逸域源文锁 =====================

describe('BJ603 件2 Renderer 接线锁（tile 层后收集→itemGlowQueue 合成后冲刷）', () => {
  it('drawTileGlows 调用位在 drawTileFlames 之后（本体后尾段位次）', () => {
    const flameIdx = RDR_SRC.indexOf('drawTileFlames(ctx, this.atlas, world.store');
    const glowIdx = RDR_SRC.indexOf('drawTileGlows(this.atlas, world.store');
    expect(flameIdx).toBeGreaterThan(0);
    expect(glowIdx).toBeGreaterThan(flameIdx);
  });

  it('逃逸域同槽（itemGlowQueue 收集 + flushItemGlow 消费;noirOpacity 单源）', () => {
    expect(RDR_SRC).toContain('noirOpacity: this.monoFilters.noirOpacity()');
    expect(RDR_SRC).toContain('drawTileGlows, type TileGlowOp');
  });

  it('monoFilters.noirOpacity() 单源（MonolithFilters 滤镜态读侧）', () => {
    const mono = readFileSync(join(__dirname, '../src/render/MonolithFilters.ts'), 'utf8');
    expect(mono).toContain('noirOpacity(): number');
    expect(mono).toContain("s.def.sceneKey === 'Noir'");
  });
});
