// ★变体①「画布身份缓存×内容后变」终扫修复锁（2026-09-27 生命水晶案根病完整变体面）。
// 机制定谳：acc shim 链下画布源按 (texId,矩形) 身份缓存区域纹理——
//   A. 共享 scratch 同帧多次烘焙（尘 s1/s2、飞灵 sil/tint、亮度藤、月总光地板、
//      wingTintScratch、女皇剑 HUE_TINT）→ markDynamic 静态路径/flush 期刷新全读
//      【末次烘焙】字节=先行 rec 内容全错（I类 bolt 同病;1:N 消费还需帧内粘滞账）;
//   B. 长命画布矩形回收再烘焙（TintAtlas 页 free-list 复用）→ er: 键不变=
//      首帧内容永久冻结（生命水晶 tileShine 同族）。
// 修复三件：①GLShimExecutor.uploadScratchNow 挂 bakedTexMulti 帧内粘滞账（1:N）
//   +frameReset 清账;②resolveTex er: 键携带 texEpoch 且 epoch 参与 JS 侧命中判定;
//   ③TintAtlas 回收矩形 blit 后 bumpTexEpoch(page.cv);Renderer/MinionProj 各
//   烘焙点 uploadScratchBake/markWorldDynamicScratch 逐次上传。
// 本文件锁两面：行为锁（acc shim 桩,glw 行为面 node 不可跑=b0 判例沿袭）+源级锁。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GLShimExecutor } from '../src/render/glshim/GLShimExecutor';
import { TintAtlas } from '../src/render/TintAtlas';
import { bumpTexEpoch, texEpoch, texId } from '../src/render/texId';

const SHIM = readFileSync(join(__dirname, '../src/render/glshim/GLShimExecutor.ts'), 'utf8');
const RDR = readFileSync(join(__dirname, '../src/render/Renderer.ts'), 'utf8');
const TATLAS = readFileSync(join(__dirname, '../src/render/TintAtlas.ts'), 'utf8');
const MINION = readFileSync(join(__dirname, '../src/entities/MinionProj.ts'), 'utf8');

interface QuadRec { key: string; dx: number; dy: number }

/** acc 态 host 桩（b2-shine-scratch-prelock 判例同款,扩 texFromRegion 记账）：
 *  texRefresh/texFromRegion 按 key 发【独立条目】并记录调用时机（pre/post flush）。 */
function mkAccHost() {
  const quads: QuadRec[] = [];
  const refreshKeys: string[] = [];
  const regionKeys: string[] = [];
  const entries = new Map<string, { key: string }>();
  let flushed = false;
  const entryOf = (key: string): { key: string } => {
    let e = entries.get(key);
    if (!e) { e = { key }; entries.set(key, e); }
    return e;
  };
  const layer = {
    unavailable: false,
    open: false,
    isAccumOpen(name: string) { return name === 'world' && this.open; },
    begin() { this.open = true; },
    resize() { /* no-op */ },
    endAccumulate() { this.open = false; },
    blendAdditive() { /* no-op */ },
    blendErase() { /* no-op */ },
    blendMult() { /* no-op */ },
    quadSprite(e: { key: string }, _sx: number, _sy: number, _sw: number, _sh: number,
      dx: number, dy: number) {
      quads.push({ key: e.key, dx, dy });
    },
    texFromRegion(key: string) {
      regionKeys.push(`${flushed ? 'post:' : 'pre:'}${key}`);
      return entryOf(key);
    },
    texFromData() { return null; },
    texRefresh(key: string) {
      refreshKeys.push(`${flushed ? 'post:' : 'pre:'}${key}`);
      return entryOf(key);
    },
    texFromImage() { return null; },
    texAlive() { return true; },
  };
  return {
    quads, refreshKeys, regionKeys, entries,
    markFlushed: () => { flushed = true; },
    host: {
      acquireGl: () => (layer.unavailable ? null : (layer as never)),
      worldCtx: () => null,
      worldW: () => 128, worldH: () => 72,
    },
  };
}

function mkScratch(w = 8, h = 8): HTMLCanvasElement {
  return { width: w, height: h } as unknown as HTMLCanvasElement;
}

describe('★变体①修复锁 N类:共享 scratch 1:N 消费（bakedTexMulti 帧内粘滞）', () => {
  it('一次 bake 十层消费:纹理上传在 bake 期（flush 前零 texRefresh）,各 rec 同键', () => {
    const { quads, refreshKeys, markFlushed, host } = mkAccHost();
    const ex = new GLShimExecutor(host);
    const ctx = ex.attachAcc();
    expect(ctx).toBeTruthy();
    const sc = mkScratch();
    // 女皇剑形态:一染 → 幻影 6 层 + 环晕 4 层同帧消费
    ex.uploadScratchNow(sc, 'empressTint:7');
    for (let i = 0; i < 10; i++) ctx!.drawImage(sc, i * 8, 0, 8, 8);
    expect(refreshKeys, 'bake 期 1 次 texRefresh,全部发生在 flush 前').toEqual(['pre:empressTint:7']);
    markFlushed();
    ex.flush();
    expect(quads.length, '十层全部发射').toBe(10);
    expect(new Set(quads.map((q) => q.key)).size, '十层共享同一次 bake 纹理（1:N 粘滞）').toBe(1);
    expect(refreshKeys.filter((k) => k.startsWith('post:')).length, 'flush 期零重传（preTex 直取）').toBe(0);
    ex.detach();
  });

  it('同帧多次异内容烘焙:键逐次异,各 rec 持各自 bake 纹理（单键回归=在此爆红）', () => {
    const { quads, refreshKeys, host } = mkAccHost();
    const ex = new GLShimExecutor(host);
    const ctx = ex.attachAcc();
    const sc = mkScratch();
    for (let i = 0; i < 4; i++) {
      ex.uploadScratchNow(sc, `dustTint:${i}`);
      ctx!.drawImage(sc, i * 8, 0, 8, 8);
    }
    ex.flush();
    expect(refreshKeys).toEqual(['pre:dustTint:0', 'pre:dustTint:1', 'pre:dustTint:2', 'pre:dustTint:3']);
    expect(new Set(quads.map((q) => q.key)).size, '四 rec 纹理互异（同键=先行 quad 被改写）').toBe(4);
    ex.detach();
  });

  it('跨帧账清零:frameReset 后无 bake 的 draw 不再挂上一帧 preTex', () => {
    const { quads, host } = mkAccHost();
    const ex = new GLShimExecutor(host);
    const ctx = ex.attachAcc();
    const sc = mkScratch();
    ex.uploadScratchNow(sc, 'dustTint:0');
    ctx!.drawImage(sc, 0, 0, 8, 8);
    ex.flush();
    // 次帧:frameReset（Renderer 窗口开时调）清粘滞账;无 bake 的 draw 走 dynamic/静态支
    ex.frameReset();
    const quads0 = quads.length;
    ctx!.drawImage(sc, 8, 0, 8, 8);
    ex.flush();
    const newQuad = quads[quads0];
    expect(newQuad).toBeTruthy();
    expect(newQuad.key, '跨帧残留账=陈旧 preTex 直取（必须落 dynamic 刷新支）').not.toBe('dustTint:0');
    ex.detach();
  });
});

describe('★变体①修复锁 纪元键:矩形回收覆写后 er: 键换代', () => {
  it('epoch 参与 JS 侧命中判定+GL 键:bump 后同矩形重传新键,未 bump 静态源键零变化', () => {
    const { regionKeys, quads, host } = mkAccHost();
    const ex = new GLShimExecutor(host);
    const ctx = ex.attachAcc();
    const page = mkScratch(64, 64);
    const id = texId(page);
    // 首绘矩形 (0,0,32,32)——epoch 0 键与旧版逐字同（零回归面）
    ctx!.drawImage(page, 0, 0, 32, 32, 0, 0, 32, 32);
    ex.flush();
    expect(regionKeys[0]).toBe(`pre:er:${id}:0:0,0,32,32`);
    expect(quads.length).toBe(1);
    // 未 bump 重绘（静态源常态）:JS 侧命中,零重传零新键
    const rk0 = regionKeys.length;
    ctx!.drawImage(page, 0, 0, 32, 32, 8, 0, 32, 32);
    ex.flush();
    expect(regionKeys.length, '静态源命中不重传').toBe(rk0);
    // bump（=TintAtlas 回收矩形覆写后）:同矩形换键重传
    bumpTexEpoch(page);
    expect(texEpoch(page)).toBe(1);
    ctx!.drawImage(page, 0, 0, 32, 32, 16, 0, 32, 32);
    ex.flush();
    expect(regionKeys[regionKeys.length - 1]).toBe(`pre:er:${id}:1:0,0,32,32`);
    ex.detach();
  });
});

describe('★变体①修复锁 TintAtlas:回收矩形 bump 页纪元', () => {
  it('fresh 分配（shelf/新页）不 bump;free-list 回收分配 blit 后 bump', () => {
    // node 无 DOM——最小 canvas 桩仅本测试窗（b2b-worldcanvas-retire 判例同式）
    const ctxStub = () => ({
      clearRect: () => {}, drawImage: () => {}, fillRect: () => {},
      globalCompositeOperation: 'source-over', fillStyle: '#000',
    });
    const prevDoc = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      createElement: () => ({ width: 0, height: 0, getContext: () => ctxStub() }),
    };
    try {
      const ta = new TintAtlas();
      const paint = (cx: CanvasRenderingContext2D): void => { cx.fillRect(0, 0, 4, 4); };
      const a = ta.bake('A', 16, 16, paint);
      expect(a).toBeTruthy();
      expect(texEpoch(a!.c), 'shelf 新区=纯分配,零 bump').toBe(0);
      // drop → free-list → 同尺寸再分配 = 回收覆写
      ta.drop('A');
      const b = ta.bake('B', 16, 16, paint);
      expect(b).toBeTruthy();
      expect(b!.c).toBe(a!.c);
      expect(texEpoch(b!.c), '回收矩形=原地覆写,必须 bump 页纪元（否则 GL 缓存首帧冻结）').toBe(1);
      // 二次回收继续递增
      ta.drop('B');
      ta.bake('C', 16, 16, paint);
      expect(texEpoch(b!.c)).toBe(2);
    } finally {
      (globalThis as { document?: unknown }).document = prevDoc;
    }
  });
});

describe('★变体①修复锁 源级锁:各共享 scratch 烘焙点逐次上传接线在位', () => {
  it('Renderer.uploadScratchBake 助手（家族独立环形序号;★R3b-6 帧界重置+触帧账;★P1-B 子区参透传）在位', () => {
    // ★2026-09-28 锚重产:签 名扩可选子区参 (rw,rh)（bolt 链携 bbox 走 p1bRegionGate
    //  分档;不带参的家族调用点语义零变化）
    expect(RDR).toContain('uploadScratchBake(img: HTMLCanvasElement, fam: string, ring: number, rw?: number, rh?: number,\n    preBytes?: ImageData): string {');   // ★P0 去画布化:preBytes 直挂
    expect(RDR).toContain('this.scratchBakeSeqs.set(fam, { n, f });');
    expect(RDR).toContain('const key = `${fam}:${n % ring}`;');   // ★BJ731 改判史(2026-10-27):R3b-1 环键回传(d0a1859d,2026-10-17 尘批)——键先存 const 回传,内联直呼形退役
    expect(RDR).toContain('sh.uploadScratchNow(img, key, rw, rh, preBytes);');
  });

  it('尘族 s1/s2 三烘焙点（dustTint/dustColor/dustDye）逐尘即刻上传;★R3b-1:环=池上界 6000', () => {
    expect(RDR).toContain("this.uploadScratchBake(s1, 'dustTint', Renderer.DUST_BAKE_RING, undefined, undefined, ida)");   // ★P0:ida 直挂零拷贝
    expect(RDR).toContain("this.uploadScratchBake(s2, 'dustColor', Renderer.DUST_BAKE_RING, undefined, undefined, idc)");   // ★P0:idc 直挂零拷贝
    expect(RDR).toContain("this.uploadScratchBake(s2, 'dustDye', Renderer.DUST_BAKE_RING, undefined, undefined, idd)");   // ★P0:idd 直挂零拷贝
    expect(RDR).toContain('private static readonly DUST_BAKE_RING = 6000;');
  });

  it('飞灵 sil/tint 双面逐层上传（drawLeashedFaeling/drawFaeling 共用层函数）', () => {
    expect(RDR).toContain("this.uploadScratchBake(silC, 'faelingSil', 256);");
    expect(RDR).toContain("this.uploadScratchBake(tintC, 'faelingTint', 256);");
  });

  it('月总光地板/亮度藤:登记面退役锁（★BJ515 债⑥锁改判 2026-10-05）', () => {
    // ★锁改判定谳（BJ481/BJ485 三刀后的现役形,原「逐部件逐段上传」载体已全摘）：
    //  · mlfloor（月总 30% 白补差,BJ481 删登记）——消费点在 render 7b'
    //    （compositeLight finishAccFrame 收口后）恒 raw 主画布 2D,uploadScratchNow
    //    窗关自判 no-op=登记零收益纯白付;真病=destination-in 多精灵自擦除,
    //    修=掩膜快照布单 op 消费（bj481-moonlord-comp-scratch.test.ts 锁）。
    //  · bv:（亮度藤 259/260,BJ485 摘登记）——唯一调用方 render 7c 同为窗外
    //    raw 2D,逐段烘焙 drawImage 即时读当前字节本就正确。
    //  ⇒ 判别目标从「登记在位」改判「退役态稳定」：重挂登记（倒退回白付形）或
    //    掩膜快照布/退役锚被拆 → 恰红。登记载体的正向锁由 bj485-dead-registration-
    //    sweep / bj481-moonlord-comp-scratch 两文件承接。
    expect(RDR).not.toContain("'mlfloor'");                                  // 倒退=重挂登记 → 红
    expect(RDR).not.toContain('uploadScratchBake(scratch, `bv:');            // 同上（bv 族）
    expect(RDR).toContain('private mlFloorMaskScratch: HTMLCanvasElement | null = null;');   // BJ481 现役形
    expect(RDR).toContain('★BJ481 补差掩膜快照布');
    expect(RDR).toContain('★BJ485（2026-10-03 定谳摘除登记）:本面唯一调用方=render 7c');    // 亮度藤退役锚
  });

  it('wingTintScratch 登记面退役锁（★BJ515 债⑥锁改判:dyeScratch/addScratch 等 4 口窗外零消费）', () => {
    // ★锁改判定谳（BJ485）:drawWingOverlay 唯一调用方=flushWingGlow（render 7e,
    //  finishAccFrame 收口之后）恒 raw 主画布 2D——uploadScratchNow 窗关 no-op,
    //  wingTintScratch 全仓无 shim 窗内 drawImage（:15052 翼案约束:本槽仅限窗外
    //  消费者）=四烘焙口（dyeScratch/addScratch/extra38/arkhalis）登记全摘。
    //  ⇒ 判别目标改判「退役态稳定+退役锚在位」：重挂 wingTint 登记 → 红。
    expect(RDR.match(/uploadScratchBake\([^)]*'wingTint'/g) ?? []).toHaveLength(0);
    expect((RDR.match(/★BJ485:登记摘除/g) ?? []).length).toBe(3);   // dyeScratch/addScratch/nebula 轨道支三锚
  });

  it('mountTintScratch 三烘焙口（猪鲨崽液染/61增亮/61辉层）终内容上传', () => {
    expect(RDR.match(/this\.uploadScratchBake\(c, 'mountTint', 64\);/g)?.length).toBe(3);
  });

  it('女皇剑 HUE_TINT 逐剑上传（1:N 消费+环形键）', () => {
    expect(MINION).toContain('r.markWorldDynamicScratch?.(tinted, `empressTint:${empressTintSeq++ % 64}`);');
  });

  it('shim:frameReset 清粘滞账+resolveTex 纪元命中判定+纪元键在位', () => {
    expect(SHIM).toContain('this.bakedTexMulti.clear();');
    // ★刀 I 重锚（2026-09-29）:liqpolish 微抛光刀（9545b31c）把 resolveTex 命中卫兵
    //   改双支 = texCheck 批检（liqpolish 开）/texAlive（旧链逐位,?liqpolish=0 豁免）;
    //   旧单支 pin 已失真,语义面（ep 纪元参与命中判定）未变。
    expect(SHIM).toContain('if (hit && hit.ep === ep && (liqpolish ? glw.texCheck(hit.e) : glw.texAlive(hit.e))) {');
    expect(SHIM).toContain('const key = `er:${id}:${ep}:${p.sx},${p.sy},${p.sw},${p.sh}`;');
  });

  it('TintAtlas:回收矩形 blit 后 GL 缓存失效在位（E51 刀A 精确失效+页级兜底）', () => {
    // ★oracle 重产（2026-10-10,BJ594 回归扫发现陈旧）:E51 刀A（2026-10-06 落盘）
    //   把旧单支 `if (recycled) bumpTexEpoch(page.cv);` 重构为两支——钩子在场走
    //   【精确失效】invalidateRect（仅被覆写矩形,页上其余矩形零追新）;否则页级
    //   bump 兜底（fail-closed,2026-09-27 原语义逐位保留）。语义面（回收矩形
    //   原地覆写必须失效 GL 缓存）未变,源锚随新两支形态重产。
    expect(TATLAS).toContain('if (recycled) {');
    expect(TATLAS).toContain('if (invalidateRect) invalidateRect(page.cv, x, y, w, h);');
    expect(TATLAS).toContain('else bumpTexEpoch(page.cv);');
    expect(TATLAS).toContain('private alloc(w: number, h: number): [Page, number, number, boolean] | null {');
  });
});
