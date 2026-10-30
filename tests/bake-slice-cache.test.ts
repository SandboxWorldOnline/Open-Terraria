// ★任务#27 烘焙帧内缓存(2026-10-27)——翼/甲辉 overlay 逐帧 CPU 重烘收口三面锁:
//  ①恒等数学锚:Uint8Clamped x*1.0===x 全值域——恒等快路径(免 getImageData/逐
//    texel 乘/putImageData,仅 drawImage 拷贝)逐位等价的数学事实;
//  ②bakeKeyOf 纯函数锚:键维度完备(img 身份/源矩形/rgb 逐位/alphaMul/染料 vid/
//    lit 态)——同参同键、异维异键;rgb 逐位入键=浮点 tint 相位每帧新键(精确零近似),
//    同帧重复(翼主绘/水罩镜像)命中;
//  ③源锚:三 baker(addScratch/dyeScratch/tintSlice/tintSliceRGB)统一路由
//    bakeSliceCached;逃生门 ?bakecache=0;池上限;帧戳 _diagFrame;dispose 清池。
// 实证:bj719 水罩探针全绿(mask 保形/零摊平回归)+活体计数 A/B 逃生门 214.8
// getImageData/s → 缓存开 2.0/s(-99%)——scripts/_bake-cache-count-probe.mjs。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bakeKeyOf } from '../src/render/Renderer';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'src/render/Renderer.ts'), 'utf8');

describe('任务#27 烘焙缓存·恒等数学锚', () => {
  it('Uint8Clamped x*1.0===x 全值域(0..255)——恒等快路径逐位等价(×1 恒等、×1.0 浮点亦恒等)', () => {
    const arr = new Uint8ClampedArray(256);
    for (let x = 0; x <= 255; x++) arr[x] = x * 1.0;   // 与 baker 恒等支跳过的乘法同式
    for (let x = 0; x <= 255; x++) expect(arr[x]).toBe(x);
    // alphaMul 同式(baker 恒等门含 alphaMul≥0.999)
    for (let x = 0; x <= 255; x++) arr[x] = x * 1;
    for (let x = 0; x <= 255; x++) expect(arr[x]).toBe(x);
  });
});

describe('任务#27 烘焙缓存·bakeKeyOf 纯函数锚', () => {
  const imgA = {} as unknown as ImageBitmap;
  const imgB = {} as unknown as ImageBitmap;
  const rgb = (r: number, g: number, b: number) => [r, g, b] as [number, number, number];
  it('同参同键(确定性);img 身份区分(WeakMap 序号)', () => {
    const k1 = bakeKeyOf(imgA, 0, 62, 86, 62, rgb(1, 1, 1), 1, null, null);
    expect(bakeKeyOf(imgA, 0, 62, 86, 62, rgb(1, 1, 1), 1, null, null)).toBe(k1);
    expect(bakeKeyOf(imgB, 0, 62, 86, 62, rgb(1, 1, 1), 1, null, null)).not.toBe(k1);
  });
  it('源矩形/rgb 逐位/alphaMul/染料 vid/lit 态各维异键(漏一维=跨输入误命中=陈旧烘焙)', () => {
    const base = bakeKeyOf(imgA, 0, 62, 86, 62, rgb(0.5, 0.5, 0.5), 1, null, null);
    expect(bakeKeyOf(imgA, 0, 124, 86, 62, rgb(0.5, 0.5, 0.5), 1, null, null)).not.toBe(base);   // sy(翼帧)
    expect(bakeKeyOf(imgA, 0, 62, 84, 62, rgb(0.5, 0.5, 0.5), 1, null, null)).not.toBe(base);   // sw
    expect(bakeKeyOf(imgA, 0, 62, 86, 62, rgb(0.500001, 0.5, 0.5), 1, null, null)).not.toBe(base); // rgb 逐位(mtPulse 相位)
    expect(bakeKeyOf(imgA, 0, 62, 86, 62, rgb(0.5, 0.5, 0.5), 0.99, null, null)).not.toBe(base); // alphaMul
    expect(bakeKeyOf(imgA, 0, 62, 86, 62, rgb(0.5, 0.5, 0.5), 1, { vid: 7 }, null)).not.toBe(base); // 染料
    expect(bakeKeyOf(imgA, 0, 62, 86, 62, rgb(0.5, 0.5, 0.5), 1, { vid: 7 }, rgb(1, 1, 1))).not.toBe(base); // lit 态
  });
  it('染料 vid 区分(不同染料同位异键);lit tint 不入键值面仅入布尔位(lit tint 随 rgb 维度入键)', () => {
    const k7 = bakeKeyOf(imgA, 0, 62, 86, 62, rgb(0.5, 0.5, 0.5), 1, { vid: 7 }, null);
    expect(bakeKeyOf(imgA, 0, 62, 86, 62, rgb(0.5, 0.5, 0.5), 1, { vid: 8 }, null)).not.toBe(k7);
  });
});

describe('任务#27 烘焙缓存·源锚(路由/逃生门/池/帧戳/收刀)', () => {
  it('三 baker 统一路由 bakeSliceCached(addScratch/dyeScratch/tintSlice/tintSliceRGB/extra38)', () => {
    expect(SRC).toContain('this.bakeSliceCached(img, sx, sy, sw, sh, rgb, 1, dye, null)');
    expect(SRC).toContain('this.bakeSliceCached(img, sx, sy, sw, sh, [tint, tint, tint], 1, dye, null)');
    expect(SRC).toContain('this.bakeSliceCached(img, sx, sy, sw, sh, [tint, tint, tint], alphaMul, null, null)');
    expect(SRC).toContain('this.bakeSliceCached(img, sx, sy, sw, sh, rgb, alphaMul, null, null)');
    expect(SRC).toContain('litDye ? tint : null');   // extra38 lit 型染料 tint 入参
  });
  it('恒等门条件(逐位数学等价面):!dye ∧ rgb 三通道 ≥0.999 ∧ alphaMul ≥0.999', () => {
    expect(SRC).toContain('const identity = !dye && rgb[0] >= 0.999 && rgb[1] >= 0.999 && rgb[2] >= 0.999 && alphaMul >= 0.999;');
  });
  it('逃生门 ?bakecache=0(缓存/池受门;恒等支为数学事实不受门)+池上限 8+帧戳 _diagFrame+dispose 清池', () => {
    expect(SRC).toContain("get('bakecache') !== '0'");
    expect(SRC).toContain('this._bakePool.length > 8');
    expect(SRC).toContain('this._bakeFrame !== this._diagFrame');
    expect(SRC).toContain('this._bakeCache.clear();');
  });
});
