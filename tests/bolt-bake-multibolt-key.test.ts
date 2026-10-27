// ★I类 单槽复用重入（2026-09-27 定谳+修复锁）:bolt 烘焙面共享 boltScratch 同帧多次
//  烘焙（1 实体 ≤7 bolts、ArcSurge ≤13 bolts×3 发/帧）——旧链 flush 期逐 rec
//  texRefresh 全部读到【最后烘焙】的字节=先行 bolt quad 错拿末次内容（bgl/acc 态;
//  裸 2D 态逐 bolt 即画无此病）。修=bake 期立即上传（uploadScratchNow）到
//  帧界环形稳定键+rec.preTex 直取（resolveTex 绝不再重传共享 scratch）。
//  ★2026-09-28 锚重产（在途金标禁重冻判据——本文件锚曾停 R3b-2/R1b-6 前形态）:
//  接线三演进补锚（uploadScratchBake 帧界环形键/R1b-6 bake 字节快照 rec0 形态/
//  P1-B 子区分档）,行为面语义不变。
//  GL 行为面 node vitest 不可跑（b0 判例）——以结构锁+接线不变式固化。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SHIM = readFileSync(new URL('../src/render/glshim/GLShimExecutor.ts', import.meta.url), 'utf8');
const PROJ = readFileSync(new URL('../src/entities/proj1457.ts', import.meta.url), 'utf8');
const RDR = readFileSync(new URL('../src/render/Renderer.ts', import.meta.url), 'utf8');

describe('★I类 bolt 烘焙共享 scratch 多雷同帧修复', () => {
  it('uploadScratchNow:bake 期立即上传到调用方稳定键+挂 pending（无 GL no-op）', () => {
    // ★P1-B:可选子区参 (rw,rh)——p1bRegionGate 分档 texRefreshRegion/整幅
    //  ★P0 去画布化（2026-09-28 灾难链定谳）:签名扩可选 preBytes（烘焙点现成
    //  ImageData 直挂=零拷贝支）;快照=snapBakeRegion 区域字节（旧 snapBakeBytes
    //  每 bake createElement 一张=霜月 2441.7 canvas/秒出生风暴本体,已根治）
    expect(SHIM).toContain('uploadScratchNow(img: HTMLCanvasElement, key: string, rw?: number, rh?: number,\n    preBytes?: ImageData): void {');
    expect(SHIM).toContain('? this.glw.texRefreshRegion(key, img, rw, rh)');
    expect(SHIM).toContain(': this.glw.texRefresh(key, img);');
    // ★N类扩账（2026-09-27 变体①终扫）:pending 单槽（1:1 消费）+bakedTexMulti
    //  帧内粘滞账（1:N 消费——女皇剑一染十层/尘族逐尘烘焙）双写;
    //  ★R1b-6:rec0 携 bake 期字节快照（重放面直画共享 scratch=末次烘焙错画的兜底）
    expect(SHIM).toContain('const rec0 = { img, tex: e, snap: preBytes ?? this.snapBakeRegion(img, rw, rh) };');
    expect(SHIM).toContain('this.bakedTexPending = rec0;');
    expect(SHIM).toContain('this.bakedTexMulti.set(img, rec0);');
    expect(SHIM).toContain('if (!this.active || !this.glw || this.glw.unavailable) return;');
    // ★P0:快照路径零画布出生（getImageData 字节,重放经 preSnapScratch 中转）
    expect(SHIM).toContain('private snapBakeRegion(img: HTMLCanvasElement, rw?: number, rh?: number): ImageData | null {');
    expect(SHIM).toContain('return g.getImageData(0, 0, w, h);');
    expect(SHIM).not.toContain('this.snapBakeBytes(');
  });

  it('resolveTex:preTex 直取支在前（flush 期绝不再重传共享 scratch 末次字节）', () => {
    const rt = SHIM.indexOf('private resolveTex(');
    // ★X2 重锚（2026-10-01）:liqpolish（9545b31c,2026-09-29）把 texAlive 改
    //  texCheck/texAlive 双臂（代际戳批检;守卫=tests/liqpolish-guard.test.ts）
    const pre = SHIM.indexOf('if (p.preTex) return (liqpolish ? glw.texCheck(p.preTex) : glw.texAlive(p.preTex)) ? p.preTex : null;');
    const dyn = SHIM.indexOf("const key = this.dynKeys.get(p.img as object)", rt);
    expect(pre).toBeGreaterThan(rt);
    expect(pre).toBeLessThan(dyn);
    expect(SHIM).toContain('rec.preTex = preTex;');
  });

  it('接线:pending 由同 img 的 acc drawImage 消费并清位（防跨 rec 陈旧挂载）', () => {
    expect(SHIM).toContain('const pre = this.bakedTexPending && this.bakedTexPending.img === img');
    expect(SHIM).toContain('this.bakedTexPending = null;');
  });

  it('bakeBolt:帧界环形稳定键 uploadScratchBake（★R3b-2③;★P1-B 携 bbox 子区）', () => {
    expect(PROJ).toContain("r9.uploadScratchBake(sc, 'boltBake', 1024, sx, sy);");
    expect(PROJ.match(/this\.drawBolt\(ctx, r, b, inten, progress, opacity, anim, waveInP, waveOutP, /g)?.length).toBe(2);
    expect(PROJ).toContain('waveInP: number, waveOutP: number, bi = 0): void {');
    // blit 实采域=携带子区 (0,0,sx,sy)（P1-B 子区上传的采样域一致性锚）
    expect(PROJ).toContain('ctx.drawImage(sc, 0, 0, sx, sy, fx, fy, sx, sy);');
  });

  it('Renderer 中介:uploadScratchBake 透传子区参+preBytes;无 key markDynamic 旧语义保持', () => {
    // ★X2 重锚（2026-10-01）:shineslice（77163898,2026-09-28）签名扩第三形态
    //  (key,tint)→boolean;无 key markDynamic 旧语义保持（early-return 去裸 else）
    expect(RDR).toContain("markWorldDynamicScratch(img: HTMLCanvasElement, key?: string,\n    tint?: readonly [number, number, number]): boolean {");
    expect(RDR).toContain('if (key) { this.bglShimReg().uploadScratchNow(img, key); return false; }');
    expect(RDR).toContain('this.bglShimReg().markDynamic(img);');
    expect(RDR).toContain('uploadScratchBake(img: HTMLCanvasElement, fam: string, ring: number, rw?: number, rh?: number,\n    preBytes?: ImageData): string {');
    expect(RDR).toContain('const key = `${fam}:${n % ring}`;');   // ★BJ731 改判史(2026-10-27):R3b-1 环键回传(d0a1859d,2026-10-17 尘批)——键先存 const 回传,内联直呼形退役
    expect(RDR).toContain('sh.uploadScratchNow(img, key, rw, rh, preBytes);');
  });
});
