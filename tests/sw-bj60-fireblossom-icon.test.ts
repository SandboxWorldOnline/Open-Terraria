// SW-BJ60 火焰花背包图标纯色案（2026-09-11 定谳+守卫）。
// 用户实报：火焰花世界掉落贴图正常,背包/物品栏图标=火焰花形状但整体纯色
// #8DC0BB(=141,192,187,恰为误染表值 (123,167,163)=#7BA7A3 的 ×1.147 三通道等比
// 显示色域偏移)。此前"修过没修好"的旧账=2026-08-19 凝胶批:把 1457 Item.cs
// case 319(鲨鱼鳍 :5180)的青色误扩成"316-319 四件套"(注释标 ":5161" 系 1456
// 行号——1456 中该行恰在 :5161),腐化草 316/水叶草 317/火焰花 318 从此被伪染。
// 1457 权威:草本 313-318 逐 case 均无 item.color(313@:5146/314@:5151/315@:5156/
// 316@:5161/317@:5166/318@:5171,各 width12/height14/value100/break);
// 1458 同域零变更(:5146-5181);1456 同。图标两遍绘制权威 = Terraria.UI/ItemSlot.cs
// :2879-2889(pass1 GetAlpha 底图 + pass2 `if (item.color != Color.Transparent)`
// GetColor 色图),Item.cs:49174 GetAlpha / :49348 GetColor。
// 三面守卫:①家族金标直读 ②icon 烘焙色参数(乘法语义/反纯色性质) ③两路一致性
// tripwire(UI.iconUrl 与 Renderer 掉落物共用同表同式) ④图标素材双锚。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// pngjs 无类型声明(同 tests/atlas-append-golden.test.ts 的既有用法)
// @ts-ignore
import { PNG } from 'pngjs';
import { VANILLA_ITEM_COLOR, blendItemColorTint } from '../src/data/vanillaItemColor';
import { ItemDrop } from '../src/entities/ItemDrop';
import { internalIdOfVanilla } from '../src/stats/Shimmer';
import { World } from '../src/world/World';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---- ① 1457 反编译直读金标（Item.cs `color = new Color(...)` 恰 10 处,SW-BJ60 全提） ----
const GOLD_1457: ReadonlyArray<readonly [number, readonly [number, number, number, number], string]> = [
  [22, [160, 145, 130, 110], 'SetDefaults1 :1640 铁锭(A=110 可见)'],
  [23, [0, 80, 255, 100], 'SetDefaults1 :1658 凝胶'],
  [65, [150, 150, 150, 0], 'SetDefaults1 :2154 星怒(A=0)'],
  [282, [255, 255, 255, 0], 'SetDefaults1 :4722 荧光棒(A=0)'],
  [286, [255, 255, 255, 0], 'SetDefaults1 :4770 黏性荧光棒(A=0)'],
  [319, [123, 167, 163, 255], 'SetDefaults1 :5180 鲨鱼鳍(A=255 乘色)'],
  [823, [255, 255, 255, 0], 'SetDefaults1 :11040 幽灵翼(A=0)'],
  [3002, [255, 255, 255, 0], 'SetDefaults4 :27688 洞穴探测荧光棒(A=0)'],
  [3112, [255, 255, 255, 0], 'SetDefaults4 :28811 弹跳荧光棒(A=0)'],
  [4776, [255, 255, 255, 0], 'SetDefaults5 :39283 仙灵荧光棒(A=0)'],
];

describe('SW-BJ60 ①:1457 Item.color 金标直读', () => {
  it('表键集 = 金标键集(多一件/少一件都红——防再次误扩"组")', () => {
    expect(Object.keys(VANILLA_ITEM_COLOR).map(Number).sort((a, b) => a - b))
      .toEqual(GOLD_1457.map(([id]) => id).sort((a, b) => a - b));
  });

  it('逐项色值逐位相等(色值改错应红)', () => {
    for (const [id, rgba, anchor] of GOLD_1457) {
      expect(VANILLA_ITEM_COLOR[id], anchor).toEqual(rgba);
    }
  });

  it('火焰花 318+全草本家族+种子族无表项(用户症状回归守卫)', () => {
    // 1457 :5146-5175(草本 313-318)/:23750-23754(沙漠 2358)+种子 307-312/:23737-23747
    for (const id of [313, 314, 315, 316, 317, 318, 2358, 307, 308, 309, 310, 311, 312, 2357]) {
      expect(VANILLA_ITEM_COLOR[id], `vid ${id}`).toBeUndefined();
    }
  });

  it('旧批伪造组位全部无表项(820-822/3001/3061/3109-3111/4773-4775)', () => {
    // 各 case 体均无 color:820@:11011/821@:11023/822@:11031/3001@:27664/3061@:27678/
    // 3109@:28788/3110@:28796/3111@:28804/4773@:39260/4774@:39267/4775@:39275
    for (const id of [820, 821, 822, 3001, 3061, 3109, 3110, 3111, 4773, 4774, 4775]) {
      expect(VANILLA_ITEM_COLOR[id], `vid ${id}`).toBeUndefined();
    }
  });
});

// ---- ② icon 烘焙色参数：乘法语义（ItemSlot.cs:2888 XNA 预乘等价）与反纯色性质 ----
describe('SW-BJ60 ②:icon 烘焙色参数(乘法语义,反纯色剪影)', () => {
  it('A=255 全遮 tint:每通道 = round(T×C/255)(比例乘法,非 alpha 混合填充)', () => {
    const src = [40, 200, 255, 255, 220, 60, 10, 255];
    const data = new Uint8ClampedArray(src);
    const C = VANILLA_ITEM_COLOR[319]!;
    blendItemColorTint(data, C);
    expect([...data.slice(0, 4)]).toEqual([
      Math.round(40 * C[0] / 255), Math.round(200 * C[1] / 255), Math.round(255 * C[2] / 255), 255,
    ]);
    expect([...data.slice(4, 8)]).toEqual([
      Math.round(220 * C[0] / 255), Math.round(60 * C[1] / 255), Math.round(10 * C[2] / 255), 255,
    ]);
  });

  it('反纯色性质:灰阶梯度经 tint 后方差保留(整帧填充式实现会红——即用户所见症状)', () => {
    const w = 6, h = 6;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let p = 0; p < w * h; p++) {
      data[p * 4] = data[p * 4 + 1] = data[p * 4 + 2] = 40 + p * 6;   // 灰阶梯度
      data[p * 4 + 3] = 255;
    }
    blendItemColorTint(data, VANILLA_ITEM_COLOR[319]!);
    const vals = Array.from({ length: w * h }, (_, p) => data[p * 4]);
    const spread = Math.max(...vals) - Math.min(...vals);
    expect(spread).toBeGreaterThan(0);
    // 填充式(旧 iconUrl 语义 out=C·a+T·(1−a) 在 a=1 时塌缩为常量 C)会把 spread 压 0
    const filled = new Uint8ClampedArray(w * h * 4);
    for (let p = 0; p < w * h; p++) {
      filled[p * 4] = 123; filled[p * 4 + 1] = 167; filled[p * 4 + 2] = 163; filled[p * 4 + 3] = 255;
    }
    expect(Math.max(...Array.from({ length: w * h }, (_, p) => filled[p * 4]))
      - Math.min(...Array.from({ length: w * h }, (_, p) => filled[p * 4]))).toBe(0);
  });

  it('A=255 tint 不改变 alpha 结构(图标轮廓/边缘半透不变)', () => {
    const data = new Uint8ClampedArray([100, 100, 100, 255, 100, 100, 100, 128, 100, 100, 100, 0]);
    const a0 = [data[3], data[7], data[11]];
    blendItemColorTint(data, VANILLA_ITEM_COLOR[319]!);
    // t=1:occ=1;t=128/255,kc=1:occ=1−(1−t)(1−t)=1−(1−t)²≈0.752;t=0:跳过
    expect(data[3]).toBe(255);
    expect(data[7]).toBe(Math.round((1 - (1 - 128 / 255) ** 2) * 255));
    expect(data[11]).toBe(0);
    void a0;
  });
});

// ---- ③ 两路一致性 tripwire：UI.iconUrl(图标)与 Renderer.drawDrop(掉落)共用同表同式 ----
describe('SW-BJ60 ③:两路一致性单源 tripwire', () => {
  const srcOf = (rel: string): string => readFileSync(join(HERE, '..', rel), 'utf8');

  it('UI.iconUrl 图标烘焙消费 VANILLA_ITEM_COLOR+blendItemColorTint(数据与公式单源)', () => {
    const ui = srcOf('src/ui/UI.ts');
    expect(ui).toContain("from '../data/vanillaItemColor'");
    expect(ui).toContain('blendItemColorTint(');
    expect(ui).toContain('VANILLA_ITEM_COLOR[');
  });

  it('Renderer 掉落物着色走 itemColorSprite→blendItemColorTint(旧两步组合已退役)', () => {
    const rd = srcOf('src/render/Renderer.ts');
    expect(rd).toContain("from '../data/vanillaItemColor'");
    expect(rd).toContain('private itemColorSprite(');
    // ★BJ730 改判史：窗口旧 2000——drawDrop 体合法增重（光罩/烘焙支扩面）,
    //  itemColorSprite 调用现偏移 5426;窗口随文本放宽（增重破窗判例）。
    const dd = rd.slice(rd.indexOf('private drawDrop('), rd.indexOf('private drawDrop(') + 6000);
    expect(dd).toContain('itemColorSprite(');
    // 旧两步组合(destination-out 挖底+lighter 叠乘色)在 A<255 时漏底图残量项,
    // 不等价于 XNA 两遍——代码面守卫(注释里的文字记述不匹配此带引号形态)
    expect(dd).not.toContain("globalCompositeOperation = 'destination-out'");
    expect(dd).not.toContain("globalCompositeOperation = 'lighter'");
  });

  it('ItemDrop 构造注入仍读 VANILLA_ITEM_COLOR(掉落路=图标路同表)', () => {
    const it0 = srcOf('src/entities/ItemDrop.ts');
    expect(it0).toContain('VANILLA_ITEM_COLOR[vid]');
  });

  it('两路数据源逐 vid 相等(掉落实体 color ≡ 图标 tint 输入)', () => {
    const w = new World(40, 100, 7, 'bj60-two-path');
    void w;
    for (const vid of [22, 23, 319]) {
      const d = new ItemDrop(100, 100, internalIdOfVanilla(vid), 1);
      expect(d.color, `vid ${vid}`).toEqual([...VANILLA_ITEM_COLOR[vid]!]);
    }
    for (const vid of [313, 316, 317, 318]) {
      const d = new ItemDrop(100, 100, internalIdOfVanilla(vid), 1);
      expect(d.color, `vid ${vid}`).toBeUndefined();
    }
  });
});

// ---- ④ 图标素材双锚：图集 rect 内容 = 橙色多彩火焰花(非纯色区/非错帧) ----
describe('SW-BJ60 ④:火焰花图标素材双锚(vanilla.json rect × Item_Atlas_1 像素)', () => {
  it('atlas rect (1846,410,12,20) 不透明像素橙主导(R>G>B)且量化色 ≥3——图标源无罪', () => {
    const meta = JSON.parse(readFileSync(join(HERE, '..', 'public/sprites/vanilla.json'), 'utf8')) as {
      items: Record<string, { name: string; icon: string; ix: number; iy: number; iw: number; ih: number }>;
    };
    const m = meta.items['318'];
    expect(m?.name).toBe('Fireblossom');
    expect([m.ix, m.iy, m.iw, m.ih]).toEqual([1846, 410, 12, 20]);
    const png = PNG.sync.read(readFileSync(join(HERE, '..', 'public/sprites/vanilla', m.icon.replace(/^vanilla\//, ''))));
    const seen = new Set<string>();
    let n = 0, r = 0, g = 0, b = 0;
    for (let yy = m.iy; yy < m.iy + m.ih; yy++) {
      for (let xx = m.ix; xx < m.ix + m.iw; xx++) {
        const i = (yy * png.width + xx) * 4;
        if (png.data[i + 3] < 128) continue;
        n++; r += png.data[i]; g += png.data[i + 1]; b += png.data[i + 2];
        seen.add(`${png.data[i] & ~7},${png.data[i + 1] & ~7},${png.data[i + 2] & ~7}`);
      }
    }
    n = n || 1;
    const avg = [r / n, g / n, b / n];
    expect(avg[0]).toBeGreaterThan(avg[1]);   // 橙主导:R>G>B(实测 avg≈187,68,22)
    expect(avg[1]).toBeGreaterThan(avg[2]);
    expect(seen.size).toBeGreaterThanOrEqual(3);   // 多彩(纯色区=1 会红)
  });
});
