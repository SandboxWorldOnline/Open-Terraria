// SW-FX49 Item.alpha 染色维度（2026-09-12 定谳+守卫）。
// BJ60 登记债清偿：物品渲染只有 item.color 两遍（ka=1），缺 GetAlpha 默认支的
// pass1 alpha 维度。1457 金标（全文件 python 扫描逐行亲读，1458 同域零变更）：
//   SetDefaults 全部 `alpha = N` 赋值 = 21 行（Item.cs），其中 75 坠星（:2305）
//   与 120 熔岩之弓（:2833）被 GetAlpha 特例中和（case 75 :49191 / case 119-122
//   :49197 → (255,255,255,255) 不透明）不入表；3002 显式 0（:27687）对账保留。
//   消费面：GetAlpha 默认支（Item.cs:49328-49347）f=(255−alpha)/255 ——
//   UI 图标（ItemSlot.cs:2879 DrawItemIcon pass1）与世界掉落（Main.cs:39284
//   DrawItem pass1）两路同构；pass2 GetColor（:2888 / Main.cs:39408）只吃
//   item.color 不吃 alpha（A=0 的 color 在 GetColor 数学上恒零贡献，BJ60 已建）。
// ★BJ60 锚值勘误：旧登记"22 A=110/23 A=100/65 A=0"系 item.color 的 A 通道串域。
//   1457 实值：22 铁锭无 alpha 赋值=0、23 凝胶=175（:1656）、65 星怒=100（:2153）、
//   319 鲨鱼鳍无赋值=0、823 幽灵翼=255（:11041）→ f=0 图标+掉落全透明
//   （tooltip"I am right here."即隐形本相；1456 :11022/1458 :11041 同值，
//   GetAlpha 四版本 switch 均无 823 特例——维基只展示贴图原件不载游戏内渲染）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VANILLA_ITEM_ALPHA, VANILLA_ITEM_COLOR, blendItemColorTint } from '../src/data/vanillaItemColor';
import { ItemDrop } from '../src/entities/ItemDrop';
import { internalIdOfVanilla } from '../src/stats/Shimmer';
import { World } from '../src/world/World';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---- ① 1457 Item.cs SetDefaults alpha 金标直读（全部赋值位,GetAlpha 特例中和件除名） ----
const GOLD_ALPHA_1457: ReadonlyArray<readonly [number, number, string]> = [
  [23, 175, 'SetDefaults1 :1656 凝胶'],
  [44, 30, 'SetDefaults1 :1907 恶魔弓'],
  [47, 30, 'SetDefaults1 :1954 邪恶箭'],
  [65, 100, 'SetDefaults1 :2153 星怒'],
  [150, 100, 'SetDefaults1 :3185 蛛网'],
  [177, 50, 'SetDefaults1 :3558 蓝玉'],
  [178, 50, 'SetDefaults1 :3572 红玉'],
  [179, 50, 'SetDefaults1 :3586 绿玉'],
  [180, 50, 'SetDefaults1 :3600 黄玉'],
  [181, 50, 'SetDefaults1 :3614 紫晶'],
  [182, 50, 'SetDefaults1 :3628 钻石'],
  [725, 30, 'SetDefaults1 :9871 冰雪弓'],
  [796, 30, 'SetDefaults1 :10702 猩红弓'],
  [823, 255, 'SetDefaults1 :11041 幽灵翼(Ghostar\'s Infinity Eight)→全透明'],
  [999, 50, 'SetDefaults1 :12909 琥珀'],
  [3002, 0, 'SetDefaults4 :27687 洞穴探测荧光棒(显式 0,对账保留)'],
  [3111, 100, 'SetDefaults4 :28807 粉凝胶'],
  [5471, 100, 'SetDefaults5 :43154 蛛网复制品'],
];

describe('SW-FX49 ①:1457 Item.alpha 金标直读', () => {
  it('表键集 = 金标键集(多一件/少一件都红——alpha 赋值位全量闭环)', () => {
    expect(Object.keys(VANILLA_ITEM_ALPHA).map(Number).sort((a, b) => a - b))
      .toEqual(GOLD_ALPHA_1457.map(([id]) => id).sort((a, b) => a - b));
  });

  it('逐项 alpha 逐位相等(改错应红)', () => {
    for (const [id, alpha, anchor] of GOLD_ALPHA_1457) {
      expect(VANILLA_ITEM_ALPHA[id], anchor).toBe(alpha);
    }
  });

  it('★GetAlpha 特例中和件不入表(75 坠星 :49191/120 熔岩之弓 :49197 → 不透明)', () => {
    // 两件 SetDefaults 有 alpha(75@:2305/30@:2833)但 GetAlpha switch 覆写
    // (255,255,255,255)——入表会把坠星/熔岩弓错误变暗(坠星=ItemIconPulse 明星件)
    expect(VANILLA_ITEM_ALPHA[75]).toBeUndefined();
    expect(VANILLA_ITEM_ALPHA[120]).toBeUndefined();
  });

  it('★BJ60 锚值勘误位:22 铁锭/319 鲨鱼鳍无 alpha 赋值(旧注"A=110"系 color.A 串域)', () => {
    expect(VANILLA_ITEM_ALPHA[22]).toBeUndefined();   // case 22 :1633-1639 全体无 alpha
    expect(VANILLA_ITEM_ALPHA[319]).toBeUndefined();  // case 319 :5180 无 alpha
    // 发光棒族仅 3002 显式 0;282/286/3112/4776 无赋值(仅 color 通道)
    for (const id of [282, 286, 3112, 4776]) {
      expect(VANILLA_ITEM_ALPHA[id], `vid ${id}`).toBeUndefined();
    }
  });

  it('与 VANILLA_ITEM_COLOR 域无耦合(星怒/幽灵翼 color A=0 但 alpha 维度独立存在)', () => {
    // 65/823 在 color 表 A=0(pass2 零贡献)——alpha 表照常持有值
    expect(VANILLA_ITEM_COLOR[65]![3]).toBe(0);
    expect(VANILLA_ITEM_COLOR[823]![3]).toBe(0);
    expect(VANILLA_ITEM_ALPHA[65]).toBe(100);
    expect(VANILLA_ITEM_ALPHA[823]).toBe(255);
    // 反向:粉凝胶 3111 有 alpha=100 但无 item.color(1457 case 3111 :28804 无 color)
    expect(VANILLA_ITEM_COLOR[3111]).toBeUndefined();
    expect(VANILLA_ITEM_ALPHA[3111]).toBe(100);
  });
});

// ---- ② blendItemColorTint alpha 维度：两遍合成数学（独立仿真,不抄实现公式） ----
/** 原版两遍的独立逐步仿真（straight-alpha source-over,与 vanillaItemColor.ts
 *  实现式不同构——仿真按 XNA 绘制序逐遍复合,作实现的对拍 oracle）：
 *  pass1 = T 以 GetAlpha(White)=(255f,255f,255f,255−alpha) 绘制 → 预乘域
 *          (T·t·f, T·t·f, T·t·f, t·f) ≡ straight (T.rgb, t·f)；
 *  pass2 = T 以 GetColor(White)≈C 绘制（预乘域 (T·cr·t, …, t·kc)）叠在 pass1 上。 */
function twoPassSim(
  T: readonly number[], t: number, alpha: number,
  c: readonly [number, number, number, number] | null,
): number[] {
  const f = (255 - alpha) / 255;
  const a1 = t * f;                                   // pass1 straight α
  if (!c || c[3] <= 0) return [T[0], T[1], T[2], Math.round(a1 * 255)];
  const kc = c[3] / 255;
  const s2a = t * kc;                                 // pass2 α（用原 t,非 a1）
  const outA = s2a + a1 * (1 - s2a);
  const rgb = [0, 1, 2].map((ch) =>
    (T[ch] * (c![ch] / 255) * t + T[ch] * a1 * (1 - s2a)) / outA);
  return [Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2]), Math.round(outA * 255)];
}

describe('SW-FX49 ②:blendItemColorTint alpha 维度(两遍合成,pass1=(255−alpha)/255)', () => {
  it('f=1 恒等性:不传 alpha = BJ60 原式逐位(鲨鱼鳍金标不回退)', () => {
    const a = new Uint8ClampedArray([255, 255, 255, 255, 200, 100, 50, 255, 106, 106, 108, 128]);
    const b = new Uint8ClampedArray(a);
    blendItemColorTint(a, VANILLA_ITEM_COLOR[319]!);
    blendItemColorTint(b, VANILLA_ITEM_COLOR[319]!, 0);
    expect([...b]).toEqual([...a]);   // alpha=0 显式传参与缺省逐位一致
    expect(a[0]).toBe(123);           // BJ60 基线向量抽查
  });

  it('★纯 pass1(c=null):仅 alpha 通道乘 f,RGB 逐位不动(星怒 100)', () => {
    const data = new Uint8ClampedArray([200, 200, 210, 255, 100, 150, 90, 128]);
    blendItemColorTint(data, null, VANILLA_ITEM_ALPHA[65]!);
    expect(data[0]).toBe(200);        // ★变暗发生在 alpha 通道——RGB 不乘暗
    expect(data[1]).toBe(200);
    expect(data[2]).toBe(210);
    expect(data[3]).toBe(155);        // 255×(255−100)/255 = 155 整
    expect(data[7]).toBe(Math.round(128 * (255 - 100) / 255));   // 78
  });

  it('★凝胶 23 全两遍金标向量:灰 (106,106,108) → (35,92,221)@α149', () => {
    // BJ60 旧值 (64,98,174)@α255 = "半档透明度"缺口:pass1 f=80/255 缺失。
    // 独立仿真 oracle 与硬编码向量双断言(二者冲突即红)
    const data = new Uint8ClampedArray([106, 106, 108, 255]);
    blendItemColorTint(data, VANILLA_ITEM_COLOR[23]!, VANILLA_ITEM_ALPHA[23]!);
    const sim = twoPassSim([106, 106, 108], 1, 175, VANILLA_ITEM_COLOR[23]!);
    expect([...data]).toEqual(sim);
    expect([...data]).toEqual([35, 92, 221, 149]);
  });

  it('★幽灵翼 823:alpha=255 → f=0 → 有色 texel 全透明(图标/掉落隐形本相)', () => {
    const data = new Uint8ClampedArray([255, 250, 240, 255, 10, 20, 30, 200]);
    blendItemColorTint(data, VANILLA_ITEM_COLOR[823]!, VANILLA_ITEM_ALPHA[823]!);
    expect(data[3]).toBe(0);
    expect(data[7]).toBe(0);          // 半透明 texel 同样归零
    // color A=0(255,255,255,0) → kc=0 → 纯 pass1 支;RGB 保留(α=0 不可见)
    expect(data[0]).toBe(255);
  });

  it('★判别位:pass2 α 用原 t 而非 pass1 折减 a1(错模=先折减再叠,α 167→132 爆红)', () => {
    // 半透明 texel t=128/255,alpha=100,白全遮 color:两遍 source-over 合成 α
    // = t·kc + t·f·(1−t·kc) = 0.654→167;"先折减底图再叠色图"错模
    // = a1(2−a1) = 0.517→132(同族错:pass2 吃了 pass1 的折减)
    const t = 128 / 255, f = (255 - 100) / 255, kc = 1;
    const okA = t * kc + t * f * (1 - t * kc);
    const wrongA = t * f * kc + t * f * (1 - t * f * kc);
    expect(Math.round(okA * 255)).toBe(167);
    expect(Math.round(wrongA * 255)).toBe(132);   // 判别余量 35 字节
    const data = new Uint8ClampedArray([150, 150, 150, 128]);
    blendItemColorTint(data, [255, 255, 255, 255], 100);
    expect(data[3]).toBe(Math.round(okA * 255));
    expect(data[0]).toBe(150);        // 白全遮+白底图:rgb 恒等(两遍同贴图同色)
  });

  it('机制删除变异:若 f 恒 1(BJ60 现状),凝胶向量=(64,98,174)@255——与金标可区分', () => {
    const legacy = new Uint8ClampedArray([106, 106, 108, 255]);
    blendItemColorTint(legacy, VANILLA_ITEM_COLOR[23]!);          // 无 alpha 维(BJ60)
    expect([...legacy]).toEqual([64, 98, 174, 255]);              // 旧债复现
    const fixed = new Uint8ClampedArray([106, 106, 108, 255]);
    blendItemColorTint(fixed, VANILLA_ITEM_COLOR[23]!, VANILLA_ITEM_ALPHA[23]!);
    expect(fixed[3]).toBeLessThan(legacy[3]);                     // 半档透明度差
    expect(fixed[0]).not.toBe(legacy[0]);
  });

  it('A=0 color + alpha=0 双零(荧光棒族)恒等跳过——BJ60 基线不回退', () => {
    const data = new Uint8ClampedArray([200, 100, 50, 255]);
    blendItemColorTint(data, VANILLA_ITEM_COLOR[282]!, VANILLA_ITEM_ALPHA[3002] ?? 0);
    expect(data).toEqual(new Uint8ClampedArray([200, 100, 50, 255]));
  });
});

// ---- ③ BJ60 十项 alpha 矩阵（登记债逐项终值） ----
describe('SW-FX49 ③:BJ60 十项 alpha 矩阵(登记债逐项终值)', () => {
  const fOf = (alpha: number | undefined): number => (255 - (alpha ?? 0)) / 255;
  const ROWS: ReadonlyArray<readonly [number, string, number | undefined, number, string]> = [
    [22, '铁锭', undefined, 1, '无 alpha;仅 color A=110 可见染(BJ60 已建)'],
    [23, '凝胶', 175, 80 / 255, 'α 255→80,合成后 ≈58% 不透明度'],
    [65, '星怒', 100, 155 / 255, 'α 255→155;color A=0 无色图'],
    [282, '荧光棒', undefined, 1, '无 alpha 无可见 color=原样'],
    [286, '黏性荧光棒', undefined, 1, '同上'],
    [3002, '洞穴探测荧光棒', 0, 1, '显式 0=无操作'],
    [3112, '弹跳荧光棒', undefined, 1, '同上'],
    [4776, '仙灵荧光棒', undefined, 1, '同上'],
    [319, '鲨鱼鳍', undefined, 1, '无 alpha;color A=255 乘色(BJ60 已建)'],
    [823, '幽灵翼', 255, 0, 'f=0 全透明(icon+drop 隐形,tooltip 自白)'],
  ];
  it('逐项:表值 / pass1 因子 / 合成行为三面一致', () => {
    for (const [vid, name, alpha, f, note] of ROWS) {
      expect(VANILLA_ITEM_ALPHA[vid], `${vid} ${name}(${note})`).toBe(alpha);
      const data = new Uint8ClampedArray([120, 130, 140, 255]);
      blendItemColorTint(data, null, alpha ?? 0);
      expect(data[3], `${vid} ${name} pass1 α`).toBe(Math.round(255 * f));
      expect([data[0], data[1], data[2]], `${vid} ${name} RGB 不动`).toEqual([120, 130, 140]);
      void note;
    }
  });
});

// ---- ④ ItemDrop 构造注入（掉落路数据源,与 UI 图标路同表单源） ----
describe('SW-FX49 ④:ItemDrop.alpha 构造注入(掉落路=图标路同表)', () => {
  const w = new World(40, 100, 7, 'sw-fx49-alpha');
  void w;
  const drop = (vid: number): ItemDrop => new ItemDrop(100, 100, internalIdOfVanilla(vid), 1);

  it('十项矩阵注入位:凝胶 175/星怒 100/幽灵翼 255;铁锭/鲨鱼鳍不注入', () => {
    expect(drop(23).alpha).toBe(175);
    expect(drop(65).alpha).toBe(100);
    expect(drop(823).alpha).toBe(255);
    for (const vid of [22, 319, 282, 286, 3112, 4776]) {
      expect(drop(vid).alpha, `vid ${vid}`).toBeUndefined();
    }
    expect(drop(3002).alpha).toBeUndefined();   // 0 不注入(无操作)
  });

  it('扩展位:恶魔弓 30/蛛网 100/粉凝胶 100/蓝玉 50 注入;坠星 75 中和不注入', () => {
    expect(drop(44).alpha).toBe(30);
    expect(drop(150).alpha).toBe(100);
    expect(drop(3111).alpha).toBe(100);
    expect(drop(177).alpha).toBe(50);
    expect(drop(75).alpha).toBeUndefined();     // GetAlpha case 75 :49191 → 不透明
    expect(drop(120).alpha).toBeUndefined();    // case 119-122 :49197 → 不透明
    expect(drop(3).alpha).toBeUndefined();      // 无表项
  });

  it('color 与 alpha 双域并存(凝胶两遍都吃;星怒仅 pass1)', () => {
    const gel = drop(23);
    expect(gel.color).toEqual([0, 80, 255, 100]);
    expect(gel.alpha).toBe(175);
    const star = drop(65);
    expect(star.color).toBeUndefined();          // color A=0 不注入(BJ60 语义)
    expect(star.alpha).toBe(100);                // alpha 照常注入
  });
});

// ---- ⑤ 两路一致性/范围 tripwire（源码面:icon 与 drop 消费同一 alpha 表同式） ----
describe('SW-FX49 ⑤:两路一致性+范围纪律 tripwire', () => {
  const srcOf = (rel: string): string => readFileSync(join(HERE, '..', rel), 'utf8');

  it('UI.iconUrl 消费 VANILLA_ITEM_ALPHA+三元进支(仅 alpha>0 件也烘焙)', () => {
    const ui = srcOf('src/ui/UI.ts');
    expect(ui).toContain('VANILLA_ITEM_ALPHA[');
    expect(ui).toContain('blendItemColorTint(id32.data, tint ?? null, itemAlpha ?? 0)');
  });

  it('Renderer.drawDrop 消费 d.alpha 且合成命中只画烘焙件(禁裸底图叠画双计)', () => {
    const rd = srcOf('src/render/Renderer.ts');
    // ★BJ730 改判史：窗口旧 2600——drawDrop 体合法增重（光罩/烘焙支扩面）,
    //  itemColorSprite 调用/`d.color ?? null, d.alpha ?? 0` 现偏移 5426/5465;
    //  窗口随文本放宽（增重破窗判例）。
    const dd = rd.slice(rd.indexOf('private drawDrop('), rd.indexOf('private drawDrop(') + 6000);
    expect(dd).toContain('itemColorSprite(');
    expect(dd).toContain('d.alpha');
    // ★双计守卫:烘焙命中后不得再无条件画裸底图(半透明 texel 会被叠成过浓)
    expect(dd).toContain('needsComp');
    expect(dd).toContain('d.color ?? null, d.alpha ?? 0');
  });

  it('Renderer.itemColorSprite 带 itemAlpha 参并入缓存键(α 不同的件不串缓存)', () => {
    const rd = srcOf('src/render/Renderer.ts');
    const fn = rd.slice(rd.indexOf('private itemColorSprite('),
      rd.indexOf('private itemColorSprite(') + 1200);
    expect(fn).toContain('itemAlpha = 0');
    expect(fn).toContain('|al${itemAlpha}');
  });

  it('ItemDrop 注入读 VANILLA_ITEM_ALPHA(掉落路=图标路同表)', () => {
    const it0 = srcOf('src/entities/ItemDrop.ts');
    expect(it0).toContain('VANILLA_ITEM_ALPHA[vid]');
  });
});
