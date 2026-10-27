// ★P1-B 子区上传修复锁（2026-09-28 栅格化族上传风暴根治;GLShimExecutor 2026-09-27
//  登记债注设计落地）。
// 定谳:栅格化族（rasterizeDrawImage/rasterizePathOp/rasterizeFillRect/rasterizeOp）
//  与 bolt bake 的 quad 只实采 scratch 左上 (0,0,sw,sh),texRefresh 却整幅上传——
//  面被「需求∈(半幅,全幅] 的 op 流」顶住 P1-A 滞回不回落时逐 op 全幅重传
//  （霜月 1650²=10.9MB/op,42.4% 墙钟）。修=texRefreshRegion(key,img,sw,sh)
//  同尺寸 texSubImage2D 增量（上传=sw×sh;首建/换尺寸保整幅精确链=注①;
//  ±1LSB premul 往返登记=注②;glStatUpload 记子区/驻留账恒全幅=注③）。
// node 可跑面:p1bRegionGate 纯函数锁+document 桩行为锁（accScratch 身份分档+
//  bake 链子区分档+逃生门）;像素对拍=scripts/_p1b-region-upload-ab.mjs 探针。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GLShimExecutor, p1bRegionGate } from '../src/render/glshim/GLShimExecutor';

const LAYER_SRC = readFileSync(join(__dirname, '../src/render/GLSpriteLayer.ts'), 'utf8');
const PROJ = readFileSync(join(__dirname, '../src/entities/proj1457.ts'), 'utf8');

afterEach(() => {
  GLShimExecutor.P1B_REGION_OFF = false;
  delete (globalThis as { document?: unknown }).document;
});

/** document 桩（TintAtlas 测试判例同式）:createElement('canvas') 返回带最小 2D
 *  桩的面——accScratch 单例与栅格化 op 的 getContext/绘制链可走（行为锁需要
 *  _accScratch 身份在场,纯源码锚锁不住分档行为）。 */
function installDocStub(): void {
  const ctxStub = () => ({
    setTransform() { /* no-op */ }, clearRect() { /* no-op */ }, strokeRect() { /* no-op */ },
    fillRect() { /* no-op */ }, beginPath() { /* no-op */ }, stroke() { /* no-op */ },
    fill() { /* no-op */ }, drawImage() { /* no-op */ }, moveTo() { /* no-op */ }, lineTo() { /* no-op */ },
    save() { /* no-op */ }, restore() { /* no-op */ },
  });
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctxStub() }),
  };
}

interface SpyRec { key: string; img: unknown; w?: number; h?: number }

/** acc 态 host 桩 + texRefresh/texRefreshRegion 记账 spy 层 */
function mkAccHost() {
  const full: SpyRec[] = [];
  const region: SpyRec[] = [];
  const quads: Array<{ key: string }> = [];
  const entries = new Map<string, { key: string }>();
  let open = false;
  const entryOf = (key: string) => {
    let e = entries.get(key);
    if (!e) { e = { key }; entries.set(key, e); }
    return e;
  };
  const layer = {
    unavailable: false,
    isAccumOpen(name: string) { return name === 'world' && open; },
    begin() { open = true; },
    resize() { /* no-op */ },
    endAccumulate() { open = false; },
    blendAdditive() { /* no-op */ }, blendErase() { /* no-op */ }, blendMult() { /* no-op */ },
    quadSprite(e: { key: string }) { quads.push({ key: e.key }); },
    texRefresh(key: string, img: unknown) { full.push({ key, img }); return entryOf(key); },
    texRefreshRegion(key: string, img: unknown, w: number, h: number) { region.push({ key, img, w, h }); return entryOf(key); },
    texFromRegion() { return null; },
    texFromData() { return null; },
    texFromImage() { return null; },
    texAlive() { return true; },
  };
  return {
    full, region, quads,
    host: {
      acquireGl: () => (layer.unavailable ? null : (layer as never)),
      worldCtx: () => null,
      worldW: () => 128, worldH: () => 72,
    },
  };
}

describe('★P1-B ① 子区门 p1bRegionGate（纯函数）', () => {
  it('子区<半幅=过;≥半幅/越界/零尺寸=不过', () => {
    expect(p1bRegionGate(10, 10, 100, 100)).toBe(true);      // 100 < 5000
    expect(p1bRegionGate(70, 70, 100, 100)).toBe(true);      // 4900 < 5000（边界内）
    expect(p1bRegionGate(75, 75, 100, 100)).toBe(false);     // 5625 ≥ 半幅 5000
    expect(p1bRegionGate(50, 100, 100, 100)).toBe(false);    // 恰半幅=不过（严格小于）
    expect(p1bRegionGate(101, 10, 100, 100)).toBe(false);    // 越界
    expect(p1bRegionGate(10, 101, 100, 100)).toBe(false);    // 越界
    expect(p1bRegionGate(0, 10, 100, 100)).toBe(false);      // 零尺寸
    expect(p1bRegionGate(-1, 10, 100, 100)).toBe(false);     // 负尺寸
  });
});

describe('★P1-B ② accScratch 栅格化族分档（行为锁,document 桩）', () => {
  it('小子区 op → texRefreshRegion(key,img,sw,sh)+regionUploads 分账;大子区 op → 整幅 texRefresh', () => {
    installDocStub();
    const { full, region, host } = mkAccHost();
    const ex = new GLShimExecutor(host);
    const ctx = ex.attachAcc();
    expect(ctx).toBeTruthy();
    // 大 op:撑面+region≈canvas → 门拒 → 整幅链
    ctx!.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx!.lineWidth = 2;
    ctx!.strokeRect(0, 0, 300, 300);
    expect(full.length, '首建/大子区=整幅 texRefresh（注①精确链）').toBe(1);
    expect(region.length).toBe(0);
    expect(ex.stats.regionUploads).toBe(0);
    expect(ex.stats.uploads).toBe(1);
    // 小子区 op:门过 → texRefreshRegion,上传账走子区分账
    ctx!.strokeRect(10, 10, 20, 20);
    expect(region.length, '子区<半幅=texRefreshRegion 增量').toBe(1);
    expect(full.length).toBe(1);
    expect(ex.stats.regionUploads).toBe(1);
    expect(region[0].key.startsWith('dyn:'), '动态稳定键（accScratch 单键）').toBe(true);
    expect(typeof region[0].w).toBe('number');
    expect(region[0].img, '子区源=img 身份（accScratch 单例）').toBeTypeOf('object');
    // 非零 sw/sh:大 op 后的面内小子区恒 (0,0,sw,sh) 域
    expect(region[0].w as number).toBeGreaterThan(0);
    expect(region[0].h as number).toBeGreaterThan(0);
    ex.detach();
  });

  it('非 accScratch 动态源不受门影响（尘 s1/s2/empressTint 族保整幅链——回归锁）', () => {
    installDocStub();
    const { full, region, host } = mkAccHost();
    const ex = new GLShimExecutor(host);
    const ctx = ex.attachAcc();
    const other = { width: 64, height: 64 } as unknown as HTMLCanvasElement;   // 尘族他源
    ex.markDynamic(other);
    ctx!.drawImage(other, 0, 0);
    ex.flush();
    expect(full.length, '他源=整幅 texRefresh 语义不变').toBe(1);
    expect(region.length).toBe(0);
    expect(ex.stats.regionUploads).toBe(0);
    ex.detach();
  });

  it('逃生门 P1B_REGION_OFF=true:accScratch 小子区也保整幅链（探针 A/B 面+回滚口）', () => {
    installDocStub();
    const { full, region, host } = mkAccHost();
    const ex = new GLShimExecutor(host);
    const ctx = ex.attachAcc();
    GLShimExecutor.P1B_REGION_OFF = true;
    ctx!.strokeRect(0, 0, 300, 300);   // 大 op 建面（整幅）
    ctx!.strokeRect(10, 10, 20, 20);   // 小子区（门本应过,逃生门关）
    expect(full.length).toBe(2);
    expect(region.length).toBe(0);
    expect(ex.stats.regionUploads).toBe(0);
    ex.detach();
  });
});

describe('★P1-B ③ bake 链子区分档（uploadScratchNow 行为锁）', () => {
  it('带子区参且 <半幅 → texRefreshRegion;≥半幅/无子区参 → texRefresh;pending/multi 账两路同挂', () => {
    const { full, region, host } = mkAccHost();
    const ex = new GLShimExecutor(host);
    ex.attachAcc();
    const big = { width: 800, height: 600 } as unknown as HTMLCanvasElement;
    const small = { width: 256, height: 256 } as unknown as HTMLCanvasElement;
    // bolt 形态:面 800×600,子区 100×40 → 门过 → 子区增量
    ex.uploadScratchNow(big, 'boltBake:1', 100, 40);
    expect(region.length).toBe(1);
    expect(region[0]).toMatchObject({ key: 'boltBake:1', img: big, w: 100, h: 40 });
    // 子区 ≥半幅（500×500=250000 ≥ 480000/2=240000）→ 整幅
    ex.uploadScratchNow(big, 'boltBake:2', 500, 500);
    expect(full.length).toBe(1);
    // 无子区参（shine/empressTint 形态）→ 整幅（语义零变化）
    ex.uploadScratchNow(small, 'shineCell:3,4');
    expect(full.length).toBe(2);
    // pending 挂账:两路都挂（I类 1:1 消费判据不分支）
    ex.flush();
    expect(ex.stats.regionUploads).toBe(1);
    ex.detach();
  });

  it('逃生门:bake 链带子区参也保整幅', () => {
    const { full, region, host } = mkAccHost();
    const ex = new GLShimExecutor(host);
    ex.attachAcc();
    GLShimExecutor.P1B_REGION_OFF = true;
    const big = { width: 800, height: 600 } as unknown as HTMLCanvasElement;
    ex.uploadScratchNow(big, 'boltBake:1', 100, 40);
    expect(full.length).toBe(1);
    expect(region.length).toBe(0);
    ex.detach();
  });
});

describe('★P1-B ④ 源级锁:GLSpriteLayer.texRefreshRegion 三链分档+账本口径+接线', () => {
  it('同尺寸 texSubImage2D 增量;首建/换尺寸整幅;glStatUpload 记子区字节', () => {
    expect(LAYER_SRC).toContain('texRefreshRegion(key: string, img: TexImageSource, sw: number, sh: number): TexEntry | null {');
    expect(LAYER_SRC).toContain('if (!hit) return this.texFromImage(key, img, false, true);   // ①首建=整幅（精确单往返）');
    expect(LAYER_SRC).toContain('gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, sc);');
    expect(LAYER_SRC).toContain('glStatUpload(this.statName, sw * sh * 4);   // ③带宽=子区;驻留账（entry.bytes）恒全幅');
    expect(LAYER_SRC).toContain('if (iw !== hit.w || ih !== hit.h) {   // 换尺寸:重规格化不可用,drop 重建（同 texRefresh 通道）');
  });
  it('resolveTex 门按 accScratch 身份+半幅门分档;P1B_REGION_OFF 逃生门在位', () => {
    const SHIM = readFileSync(join(__dirname, '../src/render/glshim/GLShimExecutor.ts'), 'utf8');
    expect(SHIM).toContain('export function p1bRegionGate(sw: number, sh: number, cw: number, ch: number): boolean {');
    expect(SHIM).toContain('static P1B_REGION_OFF = false;');
    expect(SHIM).toContain('if (acc && p.img === acc && !GLShimExecutor.P1B_REGION_OFF');
    expect(SHIM).toContain('glw.texRefreshRegion(key, p.img as TexImageSource, p.sw, p.sh);');
    expect(SHIM).toContain('this.stats.regionUploads++;');
  });
  it('bolt bake 链携子区（bbox 实采域）;Renderer 中介透传', () => {
    expect(PROJ).toContain("r9.uploadScratchBake(sc, 'boltBake', 1024, sx, sy);");
    const RDR = readFileSync(join(__dirname, '../src/render/Renderer.ts'), 'utf8');
    expect(RDR).toContain('uploadScratchBake(img: HTMLCanvasElement, fam: string, ring: number, rw?: number, rh?: number,\n    preBytes?: ImageData): string {');   // ★P0 去画布化:preBytes 直挂
    expect(RDR).toContain('const key = `${fam}:${n % ring}`;');   // ★BJ731 改判史(2026-10-27):R3b-1 环键回传(d0a1859d,2026-10-17 尘批)——键先存 const 回传,内联直呼形退役
    expect(RDR).toContain('sh.uploadScratchNow(img, key, rw, rh, preBytes);');
  });
});
