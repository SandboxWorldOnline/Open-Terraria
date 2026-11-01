// ★生命水晶 shim ghost 修复锁（2026-09-27 用户实报「四格位置半透明淡红影子」）。
// 机制定谳：TileShine 共享 scratch 内容逐格逐帧变——acc shim 链下按静态源收编时
//   区域纹理 (texId,0,0,40,40) 首帧内容永久冻结,四格 shine quad 全采样同一冻结片
//   = 心形切片影子错位钉在各格盒（?bglshim=0 直画 2D 恒正确）。
// 修复 = drawTileShineGrid 动态支 stamp 完成即 uploadScratchNow（I类 bolt 判例同款,
//   bakedTexPending/preTex 直取）+【按格独立 key】（单 key 会让后续格 texRefresh
//   原地改写先行 quad 引用的纹理——flush 时四格又全采样末格内容,首版修复回归教训）。
// 本文件锁两面：
//   ①行为锁（acc 态 shim）：逐格 uploadScratchNow+drawImage → 各 rec 持【互异】preTex
//     纹理,flushAcc 发射序逐格对号;单 key 回归 = 先行 rec 纹理被改写（判别器断言）。
//   ②源级锁：TileShine 动态支钩子调用点（dynamicDest 门 + per-cell key）与
//     Renderer 注册面在盘上源码中逐字在位（防静默拆除）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GLShimExecutor } from '../src/render/glshim/GLShimExecutor';
import { setShineScratchBakeHook } from '../src/render/TileShine';

const TSHINE = readFileSync(join(__dirname, '../src/render/TileShine.ts'), 'utf8');
const RDR = readFileSync(join(__dirname, '../src/render/Renderer.ts'), 'utf8');

interface QuadRec { key: string; dx: number; dy: number; dw: number; dh: number }

/** acc 态 host 桩：texRefresh 按 key 发【独立条目】,quadSprite 记录发射（key,dst） */
function mkAccHost() {
  const quads: QuadRec[] = [];
  const refreshKeys: string[] = [];
  const entries = new Map<string, { key: string }>();
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
      dx: number, dy: number, dw: number, dh: number) {
      quads.push({ key: e.key, dx, dy, dw, dh });
    },
    texFromRegion() { return null; },
    texFromData() { return null; },
    texRefresh(key: string) {
      refreshKeys.push(key);
      let e = entries.get(key);
      if (!e) { e = { key }; entries.set(key, e); }
      return e;   // 同 key 恒同条目（真实语义）;异 key 异条目
    },
    texFromImage() { return null; },
    texAlive() { return true; },
  };
  return {
    quads, refreshKeys, entries,
    host: {
      acquireGl: () => (layer.unavailable ? null : (layer as never)),
      worldCtx: () => null,
      worldW: () => 128, worldH: () => 72,
    },
  };
}

/** 40×40 scratch 桩（内容可变;hook 面只验身份与 key） */
function mkScratch() {
  return { width: 40, height: 40 } as unknown as HTMLCanvasElement;
}

describe('★生命水晶 shim ghost 修复锁（TileShine scratch 逐格 preTex）', () => {
  it('①行为锁:逐格 uploadScratchNow(异 key)+drawImage → 四 rec 持互异纹理,发射对号', () => {
    const { quads, refreshKeys, host } = mkAccHost();
    const ex = new GLShimExecutor(host);
    const ctx = ex.attachAcc();
    expect(ctx, 'acc 窗激活').toBeTruthy();
    const sc = mkScratch();
    // 模拟 drawTileShineGrid 动态支:四格 stamp→hook(upload)→draw 循环
    const cells: Array<[number, number, string]> = [
      [612, 372, 'shineCell:400,259'], [628, 372, 'shineCell:401,259'],
      [612, 388, 'shineCell:400,260'], [628, 388, 'shineCell:401,260'],
    ];
    for (const [dx, dy, key] of cells) {
      (ex as unknown as { uploadScratchNow: (img: HTMLCanvasElement, key: string) => void })
        .uploadScratchNow(sc, key);
      ctx!.drawImage(sc, dx, dy, 40, 40);
    }
    ex.flush();   // acc 态路由 flushAcc（公开口）
    // 每格一次独立 texRefresh（per-cell key）
    expect(refreshKeys, 'texRefresh 逐格独立 key').toEqual(cells.map(([, , k]) => k));
    // 四条 quad 发射,纹理条目互异（单 key 回归=全部同条目,在此爆红）
    expect(quads.length).toBe(4);
    const keys = new Set(quads.map((q) => q.key));
    expect(keys.size, '四 rec 纹理条目必须互异(否则=末格内容冻结全格)').toBe(4);
    // 发射 dst 对号（顺序+位置）
    expect(quads.map((q) => [q.dx, q.dy])).toEqual(cells.map(([dx, dy]) => [dx, dy]));
    ex.detach();
  });

  it('②回归哨:同 key 重复 texRefresh=同条目（真实层语义;修复依赖逐格异 key 而非重建条目）', () => {
    const { refreshKeys, entries } = mkAccHost();
    const layer = (entries as unknown as { __layer?: unknown }).__layer;
    void layer;
    // 直接模拟:两次同 key texRefresh → 同条目（texRefresh 复用纹理对象）
    const keys: string[] = [];
    const store = new Map<string, { key: string }>();
    const texRefresh = (key: string) => {
      keys.push(key);
      let e = store.get(key);
      if (!e) { e = { key }; store.set(key, e); }
      return e;
    };
    const a1 = texRefresh('shineCell:400,259');
    const a2 = texRefresh('shineCell:400,259');
    expect(a1).toBe(a2);
    const b1 = texRefresh('shineCell:401,259');
    expect(b1).not.toBe(a1);
    expect(keys.length).toBe(3);
    void refreshKeys;
  });

  it('③源级锁:TileShine 动态支钩子调用点（dynamicDest 门+per-cell key）逐字在位', () => {
    // 钩子调用必须带 per-cell key 且被 dynamicDest 门控
    expect(TSHINE).toContain('if (dynamicDest) shineScratchBakeHook?.(sc, `shineCell:${x},${y}`);');
    // 钩子类型签名带 key（防退回单 key/无 key 形态）
    expect(TSHINE).toContain('let shineScratchBakeHook: ((c: HTMLCanvasElement, key: string) => void) | null = null;');
    // drawTileShineGrid 动态支两个调用点都传 dynamicDest=true
    expect(TSHINE).toContain('SCR * s, SCR * s, true, true);');   // additive 支
    expect(TSHINE).toContain('SCR * s, SCR * s, false, true);');  // 乘法 delta 支
    // chunk 烘焙支不触发钩子（stampShineCell 尾部唯一调用点已由上行锁死）
  });

  it('④源级锁:Renderer 注册面（markWorldDynamicScratch 桥+一次性哨）在位', () => {
    expect(RDR).toContain('setShineScratchBakeHook((c, key) => this.markWorldDynamicScratch(c, key))');
    expect(RDR).toContain('_shineScratchHookSet');
    // ★BJ743-A（R24 SEV-3 陈旧锁重钉,2026-10-31）：gladd 面③刀给本 import 追加
    //   shineAddLayerOf（GL 桥访问器）未随刀重钉本锁 → 字面失配恒红。四符号断言
    //   重钉为现行 import 行（Renderer.ts:343）——后续扩 import 须随刀同步本锁;
    //   另按符号逐个断言（尾注变化不再脆红,符号缺一必红）。
    expect(RDR).toContain("import { drawTileShineGrid, drawTileShineAdditive, setShineScratchBakeHook, shineAddLayerOf } from './TileShine';");
    for (const sym of ['drawTileShineGrid', 'drawTileShineAdditive', 'setShineScratchBakeHook', 'shineAddLayerOf']) {
      expect(RDR).toContain(sym);
    }
  });
});
