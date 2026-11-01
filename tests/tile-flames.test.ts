// 火苗视觉三遗留回归（B/F 代理登记项收尾）：
//   ① 蜡烛/烛台/吊灯/壁灯/吊挂灯笼逐 style 火苗参数表（TileDrawing.cs:2895-3488
//      DrawSingleTile_Flames 的 num9 switch + :1949-2707 GetTileFlameData 双层）
//   ② 手持火苗（PlayerDrawLayers.cs:3519-3561 ItemFlame_{id} 触发表 + 逐物品参数）
//   ③ 全屏地图卷轴四档修正偏移（Main.cs:54860-54923 纯函数）
// 标杆 = ../Terarria1456。只读导出的纯函数/静态表 + 盘上素材，不依赖 DOM。
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';   // ★BJ743-A:require 读形收编 ESM(守卫域外素材,行为不变)
import { join } from 'node:path';
import {
  TORCH_FLAME_TILE, BRAZIER_FLAME_TILE,
  CANDLE_FLAME_STYLES, CANDELABRA_FLAME_STYLES, CHANDELIER_FLAME_STYLES,
  LAMP_FLAME_STYLES, LANTERN_FLAME_STYLES,
  FLAME_STD, flameStyleIndex, flameStyleSpec,
  wrappedLerp, furnitureFlameTint,
  FLAME_ITEMS, heldFlameSpec,
} from '../src/render/TileFlames';
import { Renderer } from '../src/render/Renderer';

const VANILLA = join(__dirname, '..', 'public', 'sprites', 'vanilla');
const VUI = join(__dirname, '..', 'public', 'sprites', 'vanilla-ui');

// ---------------------------------------------------------------------------
// ① 逐 style 参数表 —— ≥8 族断言
// ---------------------------------------------------------------------------
describe('① 蜡烛族逐 style 火苗参数（num9=1，TileDrawing.cs:2911-3013 + 数据表 :1962-2098）', () => {
  it('style 取值 = frameY/22（:2911）', () => {
    expect(flameStyleIndex(1, 0, 0)).toBe(0);
    expect(flameStyleIndex(1, 0, 22)).toBe(1);
    expect(flameStyleIndex(1, 0, 22 * 14)).toBe(14);   // 迪斯科蜡烛
    expect(flameStyleIndex(1, 0, 22 * 44)).toBe(44);   // 1.4.4 家具段
  });

  it('蜡烛微抖档：style 5/6/7/10 = 7 份 ±0.075（:2922-2923）', () => {
    for (const s of [5, 6, 7, 10]) {
      expect(CANDLE_FLAME_STYLES[s]).toEqual({
        count: 7, xRange: [-10, 11], yRange: [-10, 11], multX: 0.075, multY: 0.075,
        tint: [50, 50, 50],
      });
    }
  });

  it('蜡烛烈焰档：style 8 = 7 份 ×0.3（:2932-2933）', () => {
    expect(CANDLE_FLAME_STYLES[8]).toMatchObject({ count: 7, multX: 0.3, multY: 0.3, tint: [50, 50, 50] });
  });

  it('蜡烛上窜档：style 12 = 7 份 x×0.1 / y(-10,1)×0.15（:2942-2943）', () => {
    expect(CANDLE_FLAME_STYLES[12]).toEqual({
      count: 7, xRange: [-10, 11], yRange: [-10, 1], multX: 0.1, multY: 0.15, tint: [50, 50, 50],
    });
  });

  it('蜡烛 style 14 = 8 份 ×0.1 (75)；16 = 4 份 ×0.15 (75)（:2952-2953/:2962-2963）', () => {
    expect(CANDLE_FLAME_STYLES[14]).toMatchObject({ count: 8, multX: 0.1, multY: 0.1, tint: [75, 75, 75] });
    expect(CANDLE_FLAME_STYLES[16]).toMatchObject({ count: 4, multX: 0.15, multY: 0.15, tint: [75, 75, 75] });
  });

  it('蜡烛 style 27/28 = 单份静止 (75)（:2968-2971）', () => {
    for (const s of [27, 28]) {
      expect(CANDLE_FLAME_STYLES[s]).toMatchObject({ count: 1, multX: 0, multY: 0, tint: [75, 75, 75] });
    }
  });

  it('1.4.4 家具段：43 落星动态色 / 44 三份(200) / 47-49+51+52+54 不画（数据表 :2028-2098）', () => {
    expect(CANDLE_FLAME_STYLES[43]).toMatchObject({ count: 1, multX: 0, dynTint: 'fallenStar' });
    expect(CANDLE_FLAME_STYLES[44]).toMatchObject({ count: 3, tint: [200, 200, 200] });
    for (const s of [47, 48, 49, 51, 52, 54]) {
      expect(CANDLE_FLAME_STYLES[s].count, `蜡烛 style ${s} 应不画`).toBe(0);
    }
    expect(CANDLE_FLAME_STYLES[56].dynTint).toBe('cloud');
    expect(CANDLE_FLAME_STYLES[58].dynTint).toBe('librarian');
    expect(CANDLE_FLAME_STYLES[61].dynTint).toBe('forbidden');
    expect(CANDLE_FLAME_STYLES[63].dynTint).toBe('boulder');
  });

  it('未命中无条件回 default 7 份（★2026-08-31 反转定谳：阈值门只分流参数出处，无死区）', () => {
    // 内联 switch default = { if(flag) delegate; else → 7 份 (0.15,0.35)×(100) }
    // （蜡烛 :3011-3026 / 烛台 :3108-3117 / 壁灯 :3348-3358 / 吊灯 :3225-3234）
    expect(flameStyleSpec(1, 0)).toBe(FLAME_STD);     // 标注 Sandstone Candle(fy814/style37) 同理
    expect(flameStyleSpec(1, 37)).toBe(FLAME_STD);
    expect(flameStyleSpec(1, 46)).toBe(FLAME_STD);
    expect(flameStyleSpec(2, 7)).toBe(FLAME_STD);     // 标注 Rich Mahogany Candelabra(style7)
    expect(flameStyleSpec(2, 20)).toBe(FLAME_STD);
    expect(flameStyleSpec(4, 6)).toBe(FLAME_STD);     // 标注 Rich Mahogany Lamp(fy324)
    expect(flameStyleSpec(4, 18)).toBe(FLAME_STD);    // Palm Wood Lamp(fy972)
    expect(flameStyleSpec(4, 20)).toBe(FLAME_STD);    // Boreal Wood Lamp(fy1080)
    expect(flameStyleSpec(4, 38)).toBe(FLAME_STD);    // Sandstone Lamp(fy2052 折列带)→ rect 走 addFr 折列
    expect(flameStyleSpec(3, 44)).toBe(FLAME_STD);    // 吊灯摆动路径走数据表，default 直达
    // 灯笼双层 default 皆 0 份（不画），但 11 / 44 为数据表显式键
    expect(LANTERN_FLAME_STYLES[11]).toEqual({
      count: 7, xRange: [-10, 11], yRange: [-10, 11], multX: 0.075, multY: 0.075, tint: [50, 50, 50],
    });
    expect(flameStyleSpec(13, 44)).toBe(FLAME_STD);   // 上轮标注灯笼（fy=1602）样式
  });
});

describe('① 烛台族（num9=2，:3017-3120）：3 火苗档 = style 3 三份', () => {
  it('style 取值 = frameY/36（:3019）', () => {
    expect(flameStyleIndex(2, 0, 36 * 3)).toBe(3);
    expect(flameStyleIndex(2, 0, 36 * 13)).toBe(13);
  });
  it('style 3 = 3 份 x×0.05 / y×0.15 (50)（:3027-3028）', () => {
    expect(CANDELABRA_FLAME_STYLES[3]).toEqual({
      count: 3, xRange: [-10, 11], yRange: [-10, 11], multX: 0.05, multY: 0.15, tint: [50, 50, 50],
    });
  });
  it('style 6 = 5 份 ×0.15 (75)；9 = 7 份 ×0.3 (100)；13 = 8 份 ×0.1 (75)（:3037-3069）', () => {
    expect(CANDELABRA_FLAME_STYLES[6]).toMatchObject({ count: 5, multX: 0.15, tint: [75, 75, 75] });
    expect(CANDELABRA_FLAME_STYLES[9]).toMatchObject({ count: 7, multX: 0.3, tint: [100, 100, 100] });
    expect(CANDELABRA_FLAME_STYLES[13]).toMatchObject({ count: 8, multX: 0.1, tint: [75, 75, 75] });
  });
  it('28/29 单份静止；44 落星；45 三份(200)（:3073-3092 + 数据表 :2165-2180）', () => {
    expect(CANDELABRA_FLAME_STYLES[28]).toMatchObject({ count: 1, multX: 0, tint: [75, 75, 75] });
    expect(CANDELABRA_FLAME_STYLES[44].dynTint).toBe('fallenStar');
    expect(CANDELABRA_FLAME_STYLES[45]).toMatchObject({ count: 3, tint: [200, 200, 200] });
  });
});

describe('① 吊灯族（num9=3，:3122-3240）：style 含 frameX 列偏移', () => {
  it('style = frameY/54 + frameX≥108 时 +37*(frameX/108)（:3124-3128）', () => {
    expect(flameStyleIndex(3, 0, 54 * 8)).toBe(8);
    expect(flameStyleIndex(3, 108, 0)).toBe(37);        // 第二列首行
    expect(flameStyleIndex(3, 216, 54 * 8)).toBe(8 + 37 * 2);
  });
  it('style 8 = 7 份 ×0.075；9 = 3 份 ×0.05/0.15；17/20 = 7 份 ×0.075（:3136-3180）', () => {
    expect(CHANDELIER_FLAME_STYLES[8]).toMatchObject({ count: 7, multX: 0.075, multY: 0.075, tint: [50, 50, 50] });
    expect(CHANDELIER_FLAME_STYLES[9]).toMatchObject({ count: 3, multX: 0.05, multY: 0.15 });
    for (const s of [17, 20]) {
      expect(CHANDELIER_FLAME_STYLES[s]).toMatchObject({ count: 7, multX: 0.075, multY: 0.075 });
    }
  });
  it('style 18 = 8 份 ×0.1 (75)（:3187-3188）', () => {
    expect(CHANDELIER_FLAME_STYLES[18]).toMatchObject({ count: 8, multX: 0.1, tint: [75, 75, 75] });
  });
});

describe('① 壁灯/立灯族（num9=4，:3242-3363）', () => {
  it('style 取值 = frameY/54（:3244）', () => {
    expect(flameStyleIndex(4, 0, 54)).toBe(1);
  });
  it('style 1 = 3 份 ×0.15 (50)；2/4 = 7 份 ×0.075 (50)（:3252-3265）', () => {
    expect(LAMP_FLAME_STYLES[1]).toMatchObject({ count: 3, multX: 0.15, multY: 0.15, tint: [50, 50, 50] });
    for (const s of [2, 4]) {
      expect(LAMP_FLAME_STYLES[s]).toMatchObject({ count: 7, multX: 0.075, multY: 0.075, tint: [50, 50, 50] });
    }
  });
  it('悬挂焰档 style 3 = 7 份 x×0.2 / y(-20,1)×0.35 (100)（:3273-3274）', () => {
    expect(LAMP_FLAME_STYLES[3]).toEqual({
      count: 7, xRange: [-10, 11], yRange: [-20, 1], multX: 0.2, multY: 0.35, tint: [100, 100, 100],
    });
  });
  it('style 12 = 单份微抖 ×0.01 + 随机灰乘子（:3311-3313）', () => {
    expect(LAMP_FLAME_STYLES[12]).toMatchObject({
      count: 1, multX: 0.01, multY: 0.01, dynTint: 'randGray', tint: null,
    });
  });
  it('style 13 = 8 份 ×0.1 (75)（:3303-3304——Draw 内联分支为权威，数据表 :2447 的 50 不可达）', () => {
    expect(LAMP_FLAME_STYLES[13]).toMatchObject({ count: 8, multX: 0.1, multY: 0.1, tint: [75, 75, 75] });
  });
});

describe('① 南瓜灯（num9=7，:2897-2907）：4 份原位叠画（掷后清零）', () => {
  it('恒 4 份、零抖动、(50) 乘子——与 default 7 份不同', () => {
    const s = flameStyleSpec(7, -1);
    expect(s).toEqual({ count: 4, xRange: [0, 0], yRange: [0, 0], multX: 0, multY: 0, tint: [50, 50, 50] });
  });
});

describe('① 吊挂灯笼族（num9=13，:3365-3457）：未命中 = 不画（双层 default 0 份）', () => {
  it('style 取值 = frameY/36（:3367）', () => {
    expect(flameStyleIndex(13, 0, 36 * 2)).toBe(2);
  });
  it('default 7 份组：1/3/6/8/19/27/29/30/31/32/36/39 + 53/57/60/62/66/69（:3371-3390/:2566）', () => {
    for (const s of [1, 3, 6, 8, 19, 27, 29, 30, 31, 32, 36, 39, 53, 57, 60, 62, 66, 69]) {
      expect(flameStyleSpec(13, s), `灯笼 style ${s} 应为 default 7 份`).toBe(FLAME_STD);
    }
  });
  it('中国灯笼族 style 2/16/25 = 7 份 x×0.15 / y×0.1 (50)（:3392-3402）', () => {
    for (const s of [2, 16, 25]) {
      expect(LANTERN_FLAME_STYLES[s]).toEqual({
        count: 7, xRange: [-10, 11], yRange: [-10, 1], multX: 0.15, multY: 0.1, tint: [50, 50, 50],
      });
    }
  });
  it('未列 style 不画（:3437-3453 双层 default flameCount=0）', () => {
    expect(flameStyleSpec(13, 0).count).toBe(0);
    expect(flameStyleSpec(13, 5).count).toBe(0);
    expect(flameStyleSpec(13, 54).count).toBe(0);
  });
});

describe('① 族覆盖面 ≥8：主表 13 tileFlame 族 + 火盆族 4 + 篝火独占', () => {
  it('TORCH_FLAME_TILE 13 成员与 Main.tileFlame 表一致（Main.cs:9210-9222）', () => {
    expect(Object.keys(TORCH_FLAME_TILE)).toHaveLength(13);
    expect(TORCH_FLAME_TILE[4]).toBe(0);
    expect(TORCH_FLAME_TILE[93]).toBe(4);
    expect(TORCH_FLAME_TILE[42]).toBe(13);
  });
  it('火盆族 BRAZIER_FLAME_TILE = Flame_9-12（TileDrawing.cs:2835-2850）', () => {
    expect(BRAZIER_FLAME_TILE).toEqual({ 300: 9, 302: 10, 303: 11, 306: 12 });
    // 301/303-305/307/308 等其余制作台不在火盆 if 链（原版只这四个）
    expect(BRAZIER_FLAME_TILE[301]).toBeUndefined();
  });
  it('default 族（火把/水蜡烛/骷髅灯/和平蜡烛/暗影蜡烛）恒 7 份 (0.15,0.35)×(100)', () => {
    for (const idx of [0, 5, 6, 16, 17]) {
      expect(flameStyleSpec(idx, -1)).toBe(FLAME_STD);
    }
  });
  it('全部 Flame 贴图在盘（火苗族 + 火盆族引用的 0-17 全量）', () => {
    const idx = new Set<number>([...Object.values(TORCH_FLAME_TILE), ...Object.values(BRAZIER_FLAME_TILE), 15]);
    expect(idx.size).toBeGreaterThanOrEqual(14);
    for (const n of idx) {
      expect(existsSync(join(VANILLA, `Flame_${n}.png`)), `Flame_${n}.png 缺素材`).toBe(true);
    }
  });
  it('逐 style 表覆盖量：五族共 ≥45 个显式 style 键（含 0 份档）', () => {
    const total = [CANDLE_FLAME_STYLES, CANDELABRA_FLAME_STYLES, CHANDELIER_FLAME_STYLES,
      LAMP_FLAME_STYLES, LANTERN_FLAME_STYLES]
      .reduce((n, t) => n + Object.keys(t).length, 0);
    expect(total).toBeGreaterThanOrEqual(45);
  });
});

describe('① 家具动态焰色（TileDrawing.cs:1833-1871 + Utils.WrappedLerp :273-283）', () => {
  it('WrappedLerp 三角波：pct 0→v1、0.5→v2、1→v1', () => {
    expect(wrappedLerp(0.5, 1, 0)).toBeCloseTo(0.5, 9);
    expect(wrappedLerp(0.5, 1, 0.5)).toBeCloseTo(1, 9);
    expect(wrappedLerp(0.5, 1, 1)).toBeCloseTo(0.5, 9);
  });
  it('落星/神圣家具焰：R 恒定、GB 随 2s 呼吸（t=0 半幅 / t=1 满幅）', () => {
    expect(furnitureFlameTint('fallenStar', 0)).toEqual([150, 75, 75]);
    expect(furnitureFlameTint('fallenStar', 1)).toEqual([150, 150, 150]);
    expect(furnitureFlameTint('hallowed', 0)).toEqual([170, 85, 85]);
    expect(furnitureFlameTint('hallowed', 1)).toEqual([170, 170, 170]);
  });
  it('云/书吏/禁域/巨石家具焰：白×呼吸（cloud 0.75-1 / 其余 0.25-1）', () => {
    expect(furnitureFlameTint('cloud', 0)).toEqual([255 * 0.75, 255 * 0.75, 255 * 0.75]);
    expect(furnitureFlameTint('cloud', 1)).toBeNull();          // 高段 ≈ 白直用
    expect(furnitureFlameTint('librarian', 0)).toEqual([255 * 0.25, 255 * 0.25, 255 * 0.25]);
    expect(furnitureFlameTint('forbidden', 0)![0]).toBeCloseTo(255 * 0.25, 6);
    expect(furnitureFlameTint('boulder', 0)![0]).toBeCloseTo(255 * 0.25, 6);
  });
});

// ---------------------------------------------------------------------------
// ② 手持火苗
// ---------------------------------------------------------------------------
describe('② 手持火苗触发（PlayerDrawLayers.cs:3519-3561 + Item.cs flame=true）', () => {
  const sheetIds = readdirSync(VANILLA)
    .filter((f) => /^ItemFlame_\d+\.png$/.test(f))
    .map((f) => Number(f.slice(10, -4)));

  it('FLAME_ITEMS = 盘上 ItemFlame 全量 − 1866（Sparky 翅膀专用，非手持）', () => {
    expect(sheetIds).toHaveLength(32);
    expect([...FLAME_ITEMS]).toHaveLength(31);
    for (const id of sheetIds) {
      if (id === 1866) continue;
      expect(FLAME_ITEMS.has(id), `物品 ${id} 有素材但不在 FLAME_ITEMS`).toBe(true);
    }
    expect(FLAME_ITEMS.has(1866)).toBe(false);
  });

  it('火把族全员在列（8 + 彩色 427-433 + 群系 523..5353）', () => {
    for (const id of [8, 427, 428, 429, 430, 431, 432, 433, 523, 974, 1245, 1333, 2274,
      3004, 3045, 3114, 4383, 4384, 4385, 4386, 4387, 4388, 5293, 5353]) {
      expect(FLAME_ITEMS.has(id), `火把族 ${id} 缺触发`).toBe(true);
    }
    // 荧光棒族（holdStyle=1 但 flame=false）不得误触
    for (const id of [282, 286, 3112, 3002, 4776, 5643]) {
      expect(FLAME_ITEMS.has(id), `荧光棒 ${id} 不应有火苗`).toBe(false);
    }
  });

  it('逐物品参数（:3528-3552）：默认 7 份×1；(3045)迪斯科/(5293)恶魔/(5353)白；A 面逐件（BJ599 全式）', () => {
    expect(heldFlameSpec(8)).toEqual({ count: 7, scale: 1, dxDir: 0, tint: [100, 100, 100], a: 0 });
    expect(heldFlameSpec(3045)).toEqual({ count: 7, scale: 1, dxDir: 0, tint: null, a: 0, disco: true });
    expect(heldFlameSpec(5293).tint).toEqual([50, 50, 100]);
    expect(heldFlameSpec(5293).a).toBe(20);   // :3537-3539 Color(50,50,100,20)
    expect(heldFlameSpec(5353).tint).toBeNull();
    expect(heldFlameSpec(5353).a).toBe(200);  // :3540-3542 Color(255³,200)
    // 夜光 4952：3 份 × 0.6（:3543-3547）
    expect(heldFlameSpec(4952)).toEqual({ count: 3, scale: 0.6, dxDir: 0, tint: [50, 50, 50], a: 0 });
    // 暗影火把 5322：附加 X 偏移 -2*direction（:3548-3551）
    expect(heldFlameSpec(5322)).toEqual({ count: 7, scale: 1, dxDir: -2, tint: [100, 100, 100], a: 150 });
  });

  it('素材结构 = 单帧、与物品贴图同尺寸（非动画横条）——动画由 itemFlamePos 抖动承担', () => {
    // 火把 8：ItemFlame_8 14×16 单帧
    const b = (f: string) => {
      const fs = readFileSync(join(VANILLA, f));   // ★BJ743-A:require 形退役(顶部 ESM import)
      return [fs.readUInt32BE(16), fs.readUInt32BE(20)] as [number, number];
    };
    expect(b('ItemFlame_8.png')).toEqual([14, 16]);
    // 全部 31 张都不成横条（宽 ≤ 80 且非 4 帧横排的宽高比 4:1）
    for (const id of FLAME_ITEMS) {
      const [w, h] = b(`ItemFlame_${id}.png`);
      expect(Math.max(w, h) / Math.min(w, h), `ItemFlame_${id} 疑似横条`).toBeLessThan(4);
    }
  });
});

// ---------------------------------------------------------------------------
// ③ fullMap 卷轴四档修正偏移（Main.cs:54860-54923 纯函数）
// ---------------------------------------------------------------------------
describe('③ 全屏地图卷轴四档偏移（Map.png 928×248）', () => {
  const TEX_W = 928, TEX_H = 248;
  const rect = (worldW: number, zoom: number, x = 0, y = 0) =>
    Renderer.fullMapScrollRect(worldW, zoom, x, y, TEX_W, TEX_H);

  it('8400 大世界（:54866-54879）：k=10×0.999，左移 40.6k / 上移 5k，宽 -8.045 高 +0.12', () => {
    const k = (8400 / 840) * 1 * 0.999;
    const r = rect(8400, 1, 100, 50);
    expect(r.x).toBeCloseTo(100 - 40.6 * k, 6);
    expect(r.y).toBeCloseTo(50 - 5 * k, 6);
    expect(r.w).toBeCloseTo((928 - 8.045) * k, 6);
    expect(r.h).toBeCloseTo((248 + 0.12) * k, 6);   // k=9.99 ≥1.2 无 +1
  });

  it('6400 中大世界（:54880-54893）：k=×1.09，38.8k / 3.85k，宽 -13.6 高 -6.92', () => {
    const k = (6400 / 840) * 1.09;
    const r = rect(6400, 1, 0, 0);
    expect(r.x).toBeCloseTo(-38.8 * k, 6);
    expect(r.y).toBeCloseTo(-3.85 * k, 6);
    expect(r.w).toBeCloseTo((928 - 13.6) * k, 6);
    expect(r.h).toBeCloseTo((248 - 6.92) * k, 6);
  });

  it('6300 中世界（:54894-54907）：k=×1.09，39.8k / 4.08k，宽 -26.69 高 -6.92', () => {
    const k = (6300 / 840) * 1.09;
    const r = rect(6300, 1, 0, 0);
    expect(r.x).toBeCloseTo(-39.8 * k, 6);
    expect(r.y).toBeCloseTo(-4.08 * k, 6);
    expect(r.w).toBeCloseTo((928 - 26.69) * k, 6);
    expect(r.h).toBeCloseTo((248 - 6.92) * k, 6);
  });

  it('4200 小世界（:54908-54917）：k=5×0.998，37.3k / 1.7k，宽 -16 高 -8.31（无 <1.2 加高）', () => {
    const k = (4200 / 840) * 0.998;
    const r = rect(4200, 1, 0, 0);
    expect(r.x).toBeCloseTo(-37.3 * k, 6);
    expect(r.y).toBeCloseTo(-1.7 * k, 6);
    expect(r.w).toBeCloseTo((928 - 16) * k, 6);
    expect(r.h).toBeCloseTo((248 - 8.31) * k, 6);
  });

  it('k<1.2 的高档加成：8400 → +1 / 6400·6300 → +2（:54875-54878/:54889-54892）', () => {
    // zoom 0.1：8400 → k=0.999 <1.2 → h += 1；6400 → k≈0.83 → h += 2；4200 无此档
    const k84 = (8400 / 840) * 0.1 * 0.999;
    expect(rect(8400, 0.1).h).toBeCloseTo((248 + 0.12) * k84 + 1, 6);
    const k64 = (6400 / 840) * 0.1 * 1.09;
    expect(rect(6400, 0.1).h).toBeCloseTo((248 - 6.92) * k64 + 2, 6);
    const k42 = (4200 / 840) * 0.1 * 0.998;
    expect(rect(4200, 0.1).h).toBeCloseTo((248 - 8.31) * k42, 6);
  });

  it('卷轴相对地图内容外扩（非整幅同缩放）：原点在地图区外、尺寸大于缩放后的贴图基线', () => {
    // 此前 bug = dest 恒 (cx0, cy0, mapW, mapH) 整幅；修正后 8400@zoom1 原点必然左上偏移
    const r = rect(8400, 1, 0, 0);
    expect(r.x).toBeLessThan(0);
    expect(r.y).toBeLessThan(0);
    expect(r.w).toBeGreaterThan(0);
    // 四档同一 zoom 下外扩量单调：8400 的横向偏移绝对值最大（40.6k > 39.8k > 38.8k > 37.3k）
    const xs = [rect(8400, 1).x, rect(6300, 1).x, rect(6400, 1).x, rect(4200, 1).x].map(Math.abs);
    expect(xs[0]).toBeGreaterThan(xs[1]);
    expect(xs[1]).toBeGreaterThan(xs[2]);
    expect(xs[2]).toBeGreaterThan(xs[3]);
  });

  it('未匹配的世界宽（原版仅四档）：不调整，直绘 (mapX, mapY, texW, texH)', () => {
    const r = rect(8401, 1, 10, 20);
    expect(r).toEqual({ x: 10, y: 20, w: 928, h: 248 });
  });

  it('Map.png 素材在盘且为 928×248（TextureAssets.Map）', () => {
    const f = join(VUI, 'Map.png');
    expect(existsSync(f)).toBe(true);
    const b = readFileSync(f);   // ★BJ743-A:require 形退役(顶部 ESM import)
    expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([928, 248]);
  });
});
