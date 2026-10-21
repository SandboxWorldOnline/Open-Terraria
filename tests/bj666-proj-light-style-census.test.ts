// ★BJ666 弹幕光照色式普查（2026-10-12）落刀判别测试。
//  普查定谳（台账面,亲读 1457 反编译）：
//   · GetAlpha 尾段（Projectile.cs:81507-81520）无条件 r/g/b=newColor×(255−α)/255
//     重算 → 凡「只赋 r/g/b 不 return」的支（650/440/449/606/207/209/9/15 族…）
//     赋值全死码,净值=plain fade（⑥BJ297 207 勘误同判,650 bright:1.5=漏网登记债）。
//   · 真缺=A=0 加算白族（return (255−α,…,0) 形）未接线且活跃：
//     465 教徒闪电球（本刀①）/257 冰雪射线（本刀②）/251 彩虹段（批2）。
//  本文件三面锁（BJ529 判例同构）：
//   ①415 教徒闪电球 LightningOrb.draw=capture→projFullbrightQueue 'lighter'
//     （ga=(255−α)/255,AI −5/拍 渐显曲线零改;GetAnchor :81225-81228）。
//   ②257 冰雪射线 Dart.draw 257 专属支=capture→projFullbrightQueue 'lighter'
//     （ga=max(0,(255−α)/255)、α>200→0 硬隐门;GetAlpha :81294-81301;姿态面
//     零改=DART_STYLE 257 rot align90/scale1.2 照旧）。
//   ③非同族不回归：257/465 表档 off 维持（300 census 锁）、乘光族不进 fullbright。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setProjSpriteOverride, projFrameSrcRect } from '../src/entities/Arrow';
import { PROJ_ALPHA_MOD, projConstFullbright, projConstTint } from '../src/data/vanillaProjAlpha';
import { LightningOrb } from '../src/entities/bossAI_lategame';
import { Dart } from '../src/entities/Dart';
import { World } from '../src/world/World';

type Rec = { op: string; args?: unknown[]; state?: Record<string, unknown> };
type Recs = Rec[];

/** 记录式 ctx（无 DOM;globalCompositeOperation 记入 recs 供加算面断言） */
function recordingCtx() {
  const recs: Array<{ op: string; args?: unknown[]; state?: Record<string, unknown> }> = [];
  const ctx = {
    canvas: { width: 800, height: 600 },
    save() { recs.push({ op: 'save' }); },
    restore() { recs.push({ op: 'restore' }); },
    translate(...a: unknown[]) { recs.push({ op: 'translate', args: a }); },
    rotate(...a: unknown[]) { recs.push({ op: 'rotate', args: a }); },
    scale(...a: unknown[]) { recs.push({ op: 'scale', args: a }); },
    drawImage(...a: unknown[]) { recs.push({ op: 'drawImage', args: a }); },
    beginPath() { recs.push({ op: 'beginPath' }); },
    arc(...a: unknown[]) { recs.push({ op: 'arc', args: a }); },
    fill() { recs.push({ op: 'fill' }); },
    fillRect(...a: unknown[]) { recs.push({ op: 'fillRect', args: a }); },
    imageSmoothingEnabled: false,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    set fillStyle(_: string) {},
  } as unknown as CanvasRenderingContext2D & { __recs?: typeof recs };
  return { ctx, recs };
}

function drawWithQueue(drawFn: (r: never) => void): {
  entityRecs: Recs; queued: Array<(c: CanvasRenderingContext2D) => void>;
} {
  const rc = recordingCtx();
  const queued: Array<(c: CanvasRenderingContext2D) => void> = [];
  drawFn({
    ctx: rc.ctx,
    queueProjFullbright: (fn: (c: CanvasRenderingContext2D) => void) => { queued.push(fn); },
  } as never);
  return { entityRecs: rc.recs, queued };
}

// ============ ① 465 教徒闪电球（GetAlpha :81225-81228 A=0 加算白×(1−α/255)） ============
describe('BJ666 ① 465 LightningOrb：capture→projFullbrightQueue lighter（本体不进乘光实体层）', () => {
  it('draw：实体层零落笔,恰 1 闭包入队（α<255 渐显期）', () => {
    const orb = new LightningOrb(700, 400, 45);
    (orb as unknown as { alpha: number }).alpha = 205;   // 渐显中
    const { entityRecs, queued } = drawWithQueue((r: never) => orb.draw(r, undefined as never));
    expect(entityRecs.filter((r) => r.op === 'drawImage')).toHaveLength(0);
    expect(entityRecs.filter((r) => r.op === 'fill')).toHaveLength(0);
    expect(queued).toHaveLength(1);
  });

  it('闭包：composite=lighter + ga=(255−α)/255 + 兜底圆面(无 DOM 贴图路径)', () => {
    const orb = new LightningOrb(700, 400, 45);
    (orb as unknown as { alpha: number }).alpha = 205;
    const { queued } = drawWithQueue((r: never) => orb.draw(r, undefined as never));
    const rc = recordingCtx();
    queued[0](rc.ctx);
    const gaOp = rc.recs.find((r) => r.op === 'globalAlpha');
    // recordingCtx 无 globalAlpha setter 记录 → 用 ctx 终值断言（restore 后回落,
    // 改用运行中读值:闭包内最后一次赋值=255−205)/255=50/255）
    void gaOp;
    const gaFinal = (rc.ctx as unknown as { globalAlpha: number }).globalAlpha;
    expect(gaFinal).toBeCloseTo(50 / 255, 6);
    // 复合方式断言走下方 proxy 测试（fake ctx 的 restore 为桩,终值不回落）
    expect(rc.recs.filter((r) => r.op === 'fill')).toHaveLength(1);   // 圆兜底（node 无 DOM 贴图）
  });

  it('ga 曲线钉值：α=255 早退不入队 / α=0 → 1（AI −5/拍 渐显终端）', () => {
    const orbA = new LightningOrb(700, 400, 45);
    (orbA as unknown as { alpha: number }).alpha = 255;
    const { queued: qA } = drawWithQueue((r: never) => orbA.draw(r, undefined as never));
    expect(qA).toHaveLength(0);                          // bright=0 → 整弹不画（原版 α≡255 全隐档）

    const orbB = new LightningOrb(700, 400, 45);
    (orbB as unknown as { alpha: number }).alpha = 0;
    const { queued: qB } = drawWithQueue((r: never) => orbB.draw(r, undefined as never));
    expect(qB).toHaveLength(1);
    const rc = recordingCtx();
    qB[0](rc.ctx);
    expect((rc.ctx as unknown as { globalAlpha: number }).globalAlpha).toBeCloseTo(1, 6);
  });

  it('变异判别（composite=lighter 缺失即爆红）：闭包流含 lighter 写面', () => {
    // lighter 断言载体：ctx 的 globalCompositeOperation setter 记账（recordSet 侧车）
    const orb = new LightningOrb(700, 400, 45);
    (orb as unknown as { alpha: number }).alpha = 205;
    const { queued } = drawWithQueue((r: never) => orb.draw(r, undefined as never));
    const compSets: string[] = [];
    const rc = recordingCtx();
    const proxy = new Proxy(rc.ctx, {
      set(t, k, v) {
        if (k === 'globalCompositeOperation') compSets.push(String(v));
        return Reflect.set(t, k, v);
      },
    });
    queued[0](proxy as unknown as CanvasRenderingContext2D);
    expect(compSets).toContain('lighter');
  });
});

// ============ ② 257 冰雪射线（GetAlpha :81294-81301 A=0 加算白×(255−α)/255,α>200 硬隐） ============
const FAKE_257 = { width: 4, height: 4 } as unknown as HTMLImageElement;

describe('BJ666 ② 257 Dart：capture→projFullbrightQueue lighter（DART_STYLE 姿态零改）', () => {
  beforeEach(() => { setProjSpriteOverride(257, FAKE_257); });
  afterEach(() => { setProjSpriteOverride(257, { width: 0, height: 0 } as unknown as HTMLImageElement); });

  function mk257(ticks: number): Dart {
    const w = new World(80, 80, 42, 'open');
    const st = w.store;
    for (let x = 10; x <= 70; x++) st.setTileSilent(x, 70, 2);
    const d = new Dart(20 * 16, 20 * 16, 15, 0, 32, 257);
    const hooks = {
      world: w,
      player: { x: 40 * 16, y: 66 * 16, w: 20, h: 42, cx: 41 * 16, cy: 67 * 16, dead: false, vx: 0, vy: 0 },
      playSfx: () => {}, playSfxFiles: () => {}, addDamageNumber: () => {},
      spawnParticles: () => {}, spawnDrop: () => null, damagePlayer: (): number => 0,
      entities: { add: () => {} },
    } as never;
    for (let i = 0; i < ticks && !d.dead; i++) d.fixedUpdate(1 / 60, hooks);
    return d;
  }

  it('α>200 硬隐门：出生拍实体层零落笔+零入队（原版 α≡255→Transparent 首 5.5 子步）', () => {
    const d = mk257(0);                                  // α=255 未衰减
    const { entityRecs, queued } = drawWithQueue((r: never) => d.draw(r, undefined as never));
    expect((d as unknown as { alpha: number }).alpha).toBe(255);
    expect(entityRecs.filter((r) => r.op === 'drawImage')).toHaveLength(0);
    expect(queued).toHaveLength(0);
  });

  it('渐显期：恰 1 闭包入队,实体层零落笔;ga=(255−α)/255 动态', () => {
    const d = mk257(3);                                  // 3 tick ×2 子步 ×10 → α=195
    expect((d as unknown as { alpha: number }).alpha).toBe(195);
    const { entityRecs, queued } = drawWithQueue((r: never) => d.draw(r, undefined as never));
    expect(entityRecs.filter((r) => r.op === 'drawImage')).toHaveLength(0);
    expect(queued).toHaveLength(1);
    const compSets: string[] = [];
    const rc = recordingCtx();
    const proxy = new Proxy(rc.ctx, {
      set(t, k, v) {
        if (k === 'globalCompositeOperation') compSets.push(String(v));
        return Reflect.set(t, k, v);
      },
    });
    queued[0](proxy as unknown as CanvasRenderingContext2D);
    expect(compSets).toContain('lighter');
    expect((rc.ctx as unknown as { globalAlpha: number }).globalAlpha).toBeCloseTo(60 / 255, 6);
    // drawImage 落笔（贴图路径;4×4 单帧→源矩形=全幅）
    const dImg = rc.recs.filter((r) => r.op === 'drawImage');
    expect(dImg.length).toBeGreaterThanOrEqual(1);
  });

  it('终端 α=0 → ga=1 满强加算（Vanilla (255,255,255,0) A=0 满强档）', () => {
    const d = mk257(13);                                 // 13 tick ×2 子步 ×10 → α=255−260→0
    expect((d as unknown as { alpha: number }).alpha).toBe(0);
    const { queued } = drawWithQueue((r: never) => d.draw(r, undefined as never));
    expect(queued).toHaveLength(1);
    const rc = recordingCtx();
    queued[0](rc.ctx);
    expect((rc.ctx as unknown as { globalAlpha: number }).globalAlpha).toBeCloseTo(1, 6);
  });

  it('姿态面零改：闭包 rotate=align90（atan2+1.57 字面,DART_STYLE 257 照旧——★G10/R2-F13 字面随迁,旧 π/2 断言退役）', () => {
    const d = mk257(3);
    const { queued } = drawWithQueue((r: never) => d.draw(r, undefined as never));
    const rc = recordingCtx();
    queued[0](rc.ctx);
    const rotOp = rc.recs.find((r) => r.op === 'rotate');
    expect(rotOp).toBeTruthy();
    expect(rotOp!.args![0]).toBe(Math.atan2(0, 15) + 1.57);
  });

  it('源矩形同源：闭包 9 参 drawImage 用 projFrameSrcRect(257,0)', () => {
    const d = mk257(3);
    const { queued } = drawWithQueue((r: never) => d.draw(r, undefined as never));
    const rc = recordingCtx();
    queued[0](rc.ctx);
    const rect = projFrameSrcRect(257, 0);
    const dImg = rc.recs.find((r) => r.op === 'drawImage')!;
    if (rect) {
      expect(dImg.args!.slice(0, 5)).toEqual([FAKE_257, rect.sx, rect.sy, rect.sw, rect.sh]);
    } else {
      // 无帧表档=5 参整图直切
      expect(dImg.args!.length).toBe(5);
    }
  });
});

// ============ ③ 数据面/非同族不回归 ============
describe('BJ666 ③ 数据面回归锁', () => {
  it('300 census 锁维持;257/465 表档 off=1（消费在载体,表不加项）', () => {
    expect(Object.keys(PROJ_ALPHA_MOD).length).toBe(300);
    expect(PROJ_ALPHA_MOD[257].off).toBe(1);
    expect(PROJ_ALPHA_MOD[465].off).toBe(1);
  });

  it('乘光族不进 fullbright（projConstFullbright 白门）:257/465 kind=invisible 非 constant kind', () => {
    // 465/257 走载体专属支,不经 projConstFullbright 通道——防双入队
    expect(projConstFullbright(465)).toBe(false);
    expect(projConstTint(465)).toBeNull();
    expect(projConstFullbright(257)).toBe(false);
    expect(projConstTint(257)).toBeNull();
  });
});
