// ★BJ700-C（2026-10-20 用户实报「南瓜王(Pumpking)焰镰弹幕 329 纯白背景」定谳+判别锁。
//
// 定谳链（三面物证,先定谳后动刀）：
//  ① 原版真值（反编译亲读）:Projectile 329 SetDefaults（Projectile.cs:4217-4226: 80×80
//    /light .25/aiStyle 56/hostile/penetrate −1/tileCollide false/timeLeft 420;发射面
//    =NPC 328 南瓜王之刃 AI_059 主选焰镰招,NPC.cs:33519 每 90t 一发）+ GetAlpha
//    :81190-81193 恒 (200,200,200,50)——AlphaBlend 半透灰【非】加算白族（A=0 族
//    不含 329）→ 本仓消费=vanillaProjAlpha fixed 档 + BJ-C9 F4 tint 档双通道 replay。
//  ② 根因（BJ371 同机制复发）:replayTintedFullbright add 面 tintedTex(...,flatten=true)
//    ——canvas multiply 摊平把透明域填成【不透明染色底】非黑（W3C blend: αb=0 域
//    Co=Cs,αo=1,rgb 非全黑即整幅染色;StringLine 头注旧句「透明像素成不透明黑」系
//    失实——仅 rgb=(0,0,0) 或全不透明贴图成立）→ 'lighter' 全幅加 cRGB=白底大方块。
//    探针 _bj700c-scythe-alpha.mjs 双证:PhaseA 微测 329 图 6684/8904 透明 texel 全变
//    (200,200,200,255);PhaseB 夜空实拍 nearWhite=6634（背景参考 72）+ 橙焰弹体 1178。
//    BJ371（2026-09-27 剃刀台风白底大方块,projGhostTrail.ts:644 判例）先例同刀:
//    修=flatten=false 保 alpha 形状（透明域贡献 0,不透明域 tex.rgb×cR×tex.a×addGa
//    精确=XNA One 因子;erase 面 destination-out 流内 ga=InvSrcAlpha 因子,双通道
//    分离式不变）。
//  ③ 修后实拍:nearWhite=72=背景 72（白盒归零）,橙焰弹体 1176 保留（ASCII 密度图
//    =净镰刀剪影无盒）。
// 8 站面（308/329/348/349/498/518/553/969）全部含透明域精灵（18.8-76.2%）且全部
// 二值 α（semi=0 普查）→ flatten=false 语义精确,一刀全修。
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { withMutation } from './mutation-guard';
import { PROJ_ALPHA_MOD, projConstFullbright, projConstTint } from '../src/data/vanillaProjAlpha';
import { replayTintedFullbright } from '../src/entities/Arrow';
import { tintedTex } from '../src/render/StringLine';

const ARROW = join(process.cwd(), 'src', 'entities', 'Arrow.ts');
const STRINGLINE = join(process.cwd(), 'src', 'render', 'StringLine.ts');

// ---- fake DOM:minimal createElement('canvas') 记录仪（node 环境无 document 时
//      tintedTex 返 null——本夹具给「canvas」返回带 comp 记录仪的 2D ctx,使
//      tintedTex/replay 全链可在 node 行为面断言）----
type FakeCanvas = { __id: string; width: number; height: number; ops: string[] };
let fakeCanvases: FakeCanvas[] = [];
function installFakeDom(): void {
  let seq = 0;
  fakeCanvases = [];
  (globalThis as Record<string, unknown>).document = {
    createElement: (): FakeCanvas => {
      const cv: FakeCanvas = { __id: `bake-${++seq}`, width: 0, height: 0, ops: [] };
      let comp = 'source-over';
      (cv as unknown as Record<string, unknown>).getContext = (): unknown => ({
        drawImage: (...a: unknown[]) => { cv.ops.push(`draw:${(a[0] as { __id?: string }).__id ?? 'raw'}`); },
        fillRect: (...a: unknown[]) => { cv.ops.push(`fill:${a.slice(0, 4).join(',')}`); },
        get globalCompositeOperation() { return comp; },
        set globalCompositeOperation(v: string) { comp = v; cv.ops.push(`comp:${v}`); },
        fillStyle: '#000',
      });
      fakeCanvases.push(cv);
      return cv;
    },
  };
}
afterEach(() => { delete (globalThis as Record<string, unknown>).document; });

describe('BJ700-C 焰镰 329 白底判别锁（tint 档 add 面 flatten=false 保形）', () => {
  it('定谳面:329 GetAlpha=(200,200,200,50) 恒（Projectile.cs:81190-81193,AlphaBlend 半透灰）', () => {
    expect(PROJ_ALPHA_MOD[329]).toEqual({ kind: 'fixed', rgba: [200, 200, 200, 50] });
    expect(projConstTint(329)).toEqual([200, 200, 200, 50]);
    expect(projConstFullbright(329)).toBe(false);   // 灰 rgb 非白门=tint 档承载（防档位漂移）
  });

  it('8 站面全在 tint 档（308/329/348/349/498/518/553/969——本刀一刀全修的受益面）', () => {
    expect(projConstTint(308)).toEqual([200, 200, 255, 125]);
    expect(projConstTint(348)).toEqual([200, 200, 200, 0]);
    expect(projConstTint(349)).toEqual([200, 200, 200, 0]);
    expect(projConstTint(498)).toEqual([255, 100, 20, 200]);
    expect(projConstTint(518)).toEqual([200, 200, 200, 100]);
    expect(projConstTint(553)).toEqual([255, 255, 200, 200]);
    expect(projConstTint(969)).toEqual([210, 210, 210, 185]);
    expect(Object.keys(PROJ_ALPHA_MOD).length).toBe(300);   // 表本体 census 锁（BJ297 既判）
  });

  it('机制面:tintedTex flatten=false 走 multiply→destination-in 保形;flatten=true 无 destination-in（摊平=透明域染色底）', () => {
    installFakeDom();
    const keepImg = { __id: 'rawKeep', width: 106, height: 84 } as never;
    const keep = tintedTex(keepImg, [200, 200, 200], false);
    expect(keep).not.toBeNull();
    const keepOps = (keep as unknown as FakeCanvas).ops;
    expect(keepOps).toContain('comp:multiply');
    expect(keepOps).toContain('comp:destination-in');   // 保 alpha 形状（回贴原形）
    const flatImg = { __id: 'rawFlat', width: 106, height: 84 } as never;
    const flat = tintedTex(flatImg, [200, 200, 200], true);
    expect(flat).not.toBeNull();
    const flatOps = (flat as unknown as FakeCanvas).ops;
    expect(flatOps).toContain('comp:multiply');
    expect(flatOps).not.toContain('comp:destination-in');   // 摊平:无回贴=透明域留染色底
  });

  it('add 面 flatten=false 保形（tintedTex 实参=false + lighter + addGa;变异 true → 无 destination-in=白底回潮恰红）', () => {
    installFakeDom();
    // 录制流形态（drawTableAlpha fixed 档 329:ga=50/255 + drawImage 整幅 106×84）
    const rawImg = { __id: 'raw', width: 106, height: 84 };
    const rec = [
      { op: 'set:globalAlpha', args: [50 / 255] },
      { op: 'save', args: [] },
      { op: 'translate', args: [10, 20] },
      { op: 'drawImage', args: [rawImg, -53, -42, 106, 84] },
      { op: 'restore', args: [] },
    ] as never;
    // 重放目标 ctx（comp/ga 记录仪,bj-c9 双通道测试同款）
    const targetOps: string[] = [];
    const gaLog: number[] = [];
    const drawLog: string[] = [];
    let curComp = 'source-over';
    const fakeCtx: Record<string, unknown> = {
      save: () => targetOps.push('save'),
      restore: () => targetOps.push('restore'),
      translate: () => targetOps.push('translate'),
      rotate: () => targetOps.push('rotate'),
      drawImage: (...a: unknown[]) => {
        targetOps.push('draw');
        drawLog.push((a[0] as { __id?: string }).__id ?? 'raw');
        gaLog.push((fakeCtx as { globalAlpha: number }).globalAlpha);
      },
      globalAlpha: 1,
    };
    Object.defineProperty(fakeCtx, 'globalCompositeOperation', {
      get: () => curComp,
      set: (v: string) => { curComp = v; targetOps.push(`comp:${v}`); },
    });
    const ctxish = fakeCtx as unknown as CanvasRenderingContext2D;

    replayTintedFullbright(rec, ctxish, [200, 200, 200, 50], 1);

    // erase 面：destination-out + 流内 ga（50/255）+ 原图（未烘焙）
    expect(targetOps).toContain('comp:destination-out');
    expect(drawLog[0]).toBe('raw');
    expect(gaLog[0]).toBeCloseTo(50 / 255, 12);
    // add 面：烘焙图（fake DOM 产物）+ 'lighter' + ga=addGa（fixed 档=1）
    expect(targetOps).toContain('comp:lighter');
    expect(drawLog[1]).toMatch(/^bake-\d+$/);
    expect(gaLog[1]).toBe(1);
    // ★判别点：add 面烘焙必须 flatten=false（destination-in 保形回贴）——
    //   flatten=true（白底根因）摊平无 destination-in,透明域=不透明染色底,
    //   'lighter' 全幅加 cRGB=6634 px 白盒（探针 _bj700c 修前实拍）
    const bakedOps = fakeCanvases.find((c) => c.__id === drawLog[1])?.ops ?? [];
    expect(bakedOps).toContain('comp:multiply');
    expect(bakedOps, 'add 面烘焙须保 alpha 形状（flatten=false;变异 true=白底回潮）')
      .toContain('comp:destination-in');
  });

  it('结构锁:Arrow.ts 调用点 flatten=false 表达式 + BJ700-C 标记;StringLine 头注勘误锚', () => {
    const src = readFileSync(ARROW, 'utf8');
    expect(src).toContain('baked = tintedTex(args[0] as Parameters<typeof tintedTex>[0], rgb, false);');
    expect(src).toContain('★BJ700-C：flatten=false 保 alpha 形状（BJ371 判例同刀）');
    const sl = readFileSync(STRINGLINE, 'utf8');
    expect(sl).toContain('★BJ371/BJ700-C 勘误：透明像素成不透明【染色底】');
  });
});

// ===================== E. 变异自证（flatten 回潮恰红） =====================
describe.skipIf(process.env.SW_BJ700C_MUT)('BJ700-C E. 变异自证', () => {
  it('M1 add 面 flatten=false→true（白底回潮）→ 行为面恰红', () => {
    withMutation(ARROW,
      'baked = tintedTex(args[0] as Parameters<typeof tintedTex>[0], rgb, false);',
      'baked = tintedTex(args[0] as Parameters<typeof tintedTex>[0], rgb, true);   // ★BJ700C 变异:白底回潮',
      () => {
        const r = spawnSync('npx', ['vitest', 'run', 'tests/bj700c-flaming-scythe-alpha.test.ts',
          '--no-file-parallelism', '-t', 'add 面 flatten=false 保形'], {
          cwd: process.cwd(), encoding: 'utf8', timeout: 600_000,
          env: { ...process.env, SW_BJ700C_MUT: '1' },
        });
        expect(r.status, '变异须证红: flatten=true 白底回潮').not.toBe(0);
        expect(r.stdout).toContain('add 面 flatten=false 保形');
      }, { label: 'BJ700C M1 flatten 回潮' });
  });
});
