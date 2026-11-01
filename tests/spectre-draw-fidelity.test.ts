// 绘制保真·平涂扫描批回归（2026-08-31 清账台账 Spectre 点名件 + 同族转正）：
//   ① 弹 356 幽灵伤害头浮魂：原版本体不可见（alpha=255 + GetAlpha 无 356 特判 ⇒
//      缺省尾 Color(0,0,0,0),P.cs:80596/:81509）+ 盘上 Projectile_356.png 为 1×1 占位
//      stub ⇒ 可见观感全由 AI_059 尘 175 拖尾承载（:29417-1457/:29385-1458）。
//      旧 fillStyle 平涂圆点退役 = draw() 文档化空实现 + spawnTrailDust 逐粒精确化。
//   ② HealProj 298/305（AI_052 :28960-29004）：同族尘拖尾精确化（d175×5 s1.3 /
//      d183×3 s1.1,v×0.334|0.2×i 反向排布,velocity*=0,noGravity）。
//   ③ DukeSharknadoBolt 385（Main.cs:34878-34897 专支）：贴图在盘 68×204×3 帧,
//      平涂圆点 → drawImage 帧切片 + α/rot/frame 绘制态（AI_065 :30023-30067）。
//   ④ GolfBall（Main.cs:31464-31507/31578）：贴图在盘 8×8,平涂圆点 → 原版染色链
//      （GetGolfTrailColor P.cs:11154 + num188 速因子 + oldPos[4] 插值尾迹 ×1.5 复刻）。
// 锚:Terarria1458。方法:记录型 ctx 代理断言 drawImage/globalAlpha;PNG IHDR 直读定资产面。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SpectreSoulProj } from '../src/entities/SpectreSoulProj';
import { HealProj } from '../src/entities/HealProj';
import { DukeSharknadoBolt } from '../src/entities/bossAI_duke_moonlord';
import { GolfBall } from '../src/entities/GolfBall';
import { setProjSpriteOverride } from '../src/entities/Arrow';
import type { GameHooks } from '../src/entities/types';

// ---------------------------------------------------------------- 记录型 ctx
type Call = { m: string; a: unknown[] };
function makeR() {
  const calls: Call[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, k) => {
      if (k === 'canvas') return undefined;
      return (...a: unknown[]) => { calls.push({ m: String(k), a }); };
    },
    set: (_t, k, v) => { calls.push({ m: `set:${String(k)}`, a: [v] }); return true; },
  });
  const r = { canvas: { getContext: () => ctx }, ctx, atlas: null };
  return { calls, r: r as never };
}
function fakeImg(w: number, h: number) {
  return { naturalWidth: w, naturalHeight: h, width: w, height: h, complete: true, src: '' };
}

/** PNG IHDR 尺寸直读（资产在盘定性——1×1 即占位 stub 家族） */
function pngSize(file: string): { w: number; h: number } {
  const b = fs.readFileSync(path.join(__dirname, '..', 'public', 'sprites', 'vanilla', file));
  expect(b.readUInt32BE(12)).toBe(0x49484452);          // 'IHDR'
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

// ------------------------------------------------------------- hooks 桩
interface DustRec { x: number; y: number; w: number; h: number; type: number;
  alpha: number; scale: number; noGravity: boolean; handle: { x: number; y: number;
    vx: number; vy: number; noGravity: boolean } }

function dustHookSink(): { recs: DustRec[]; spawnDust: NonNullable<GameHooks['spawnDust']> } {
  const recs: DustRec[] = [];
  const spawnDust = (
    x: number, y: number, w: number, h: number, type: number,
    _sx?: number, _sy?: number, alpha?: number,
    _color?: unknown, scale?: number, noGravity?: boolean,
  ): ReturnType<NonNullable<GameHooks['spawnDust']>> => {
    const handle = { x: x + 3, y: y + 2, vx: 0.13, vy: -0.07, noGravity: !!noGravity };
    recs.push({ x, y, w, h, type, alpha: alpha ?? 0, scale: scale ?? 1,
      noGravity: !!noGravity, handle });
    return handle as never;
  };
  return { recs, spawnDust };
}

function hooksWith(dust: GameHooks['spawnDust'] | null): GameHooks {
  const h = {
    world: { store: { inBounds: () => false } },
    enemies: () => [],
    critters: () => [],
    cutTile: () => {},
    spawnDust: dust ?? undefined,   // null = 无尘钩（DukeSharknado 静默步）→ undefined 档
    playSfxWav: () => {},
    spawnParticles: () => {},
    player: { dead: true },
  };
  return h as unknown as GameHooks;
}

// ============================================================ ① 弹 356 Spectre
describe('弹 356 SpectreSoulProj 绘制保真(AI_059 尘175 拖尾精确化)', () => {
  it('资产定性:Projectile_356.png 为 1×1 占位 stub(素材缺家族,无贴图可转正)', () => {
    expect(pngSize('Projectile_356.png')).toEqual({ w: 1, h: 1 });
    // 同家族相邻 stub（aiStyle59 邻域 SetDefaults 段）——登记旁证
    expect(pngSize('Projectile_357.png')).toEqual({ w: 1, h: 1 });
    expect(pngSize('Projectile_358.png')).toEqual({ w: 1, h: 1 });
  });

  it('draw() 文档化空实现:零 ctx 调用(禁平涂圆点回填)', () => {
    const orb = new SpectreSoulProj(100, 100, 2, -1, 30, null);
    const { calls, r } = makeR();
    orb.draw(r as never, {} as never);
    expect(calls).toHaveLength(0);
  });

  it('尘尾逐粒:type175/α100/scale1.3/盒=弹盒,每 tick 4 子步×5=20 粒,noGravity+velocity*=0', () => {
    const { recs, spawnDust } = dustHookSink();
    const orb = new SpectreSoulProj(100, 100, 2, -1, 30, null);
    orb.fixedUpdate(1 / 60, hooksWith(spawnDust));
    expect(recs).toHaveLength(20);                       // EU=3 ⇒ 4 子步 ×5
    for (const d of recs) {
      expect(d.type).toBe(175);
      expect(d.alpha).toBe(100);                         // NewDust α 参(:29421)
      expect(d.scale).toBe(1.3);
      expect(d.w).toBe(6); expect(d.h).toBe(6);          // SetDefaults 6×6 盒
      expect(d.noGravity).toBe(true);
      expect(d.handle.noGravity).toBe(true);             // 后置覆写(:29422)
      expect(d.handle.vx).toBe(0); expect(d.handle.vy).toBe(0);   // velocity*=0(:29424)
    }
  });

  it('出尘锚 = AI 时点(pre-move)+v×0.2×i 反向排布:warmup 期速度恒定可全序列闭式核对', () => {
    const { recs, spawnDust } = dustHookSink();
    const orb = new SpectreSoulProj(100, 100, 2, -1, 30, null);
    orb.fixedUpdate(1 / 60, hooksWith(spawnDust));
    // 出生 position=(97,97)(Center 口径 −w/2);v=(2,−1)/substep ⇒ 批基点 x_b=97+2b、
    // y_b=97−b(NewDust 盒参=该子步 AI 时点盒 ⇒ 每批恰好推进一子步位移)
    for (let b = 0; b < 4; b++) {
      for (let j = 0; j < 5; j++) {
        const d = recs[b * 5 + j];
        expect(d.x).toBeCloseTo(97 + 2 * b, 9);
        expect(d.y).toBeCloseTo(97 - b, 9);
      }
    }
    // 后移距施加在 NewDust 返回句柄上:初值(x+3,y+2) 再 −=(vx*0.2*j, −vy*0.2*j)
    for (let b = 0; b < 4; b++) {
      for (let j = 0; j < 5; j++) {
        const d = recs[b * 5 + j];
        expect(d.handle.x).toBeCloseTo(97 + 2 * b + 3 - 0.4 * j, 9);   // :29425
        expect(d.handle.y).toBeCloseTo(97 - b + 2 - 0.2 * j, 9);       // :29426(vy=−1)
      }
    }
    // 同批 i=0 粒零偏移贴弹;j 序列闭式步长 Δx=−0.4/Δy=−0.2
    for (let j = 1; j < 5; j++) {
      expect(recs[j].handle.x).toBeCloseTo(recs[0].handle.x - 0.4 * j, 9);
      expect(recs[j].handle.y).toBeCloseTo(recs[0].handle.y - 0.2 * j, 9);
    }
  });

  it('Kill 支短路:cand 全空重选即亡子步不出尘(原版 AI 提前 return 跳过尘循环)', () => {
    const { recs, spawnDust } = dustHookSink();
    const orb = new SpectreSoulProj(100, 100, 0.01, 0, 30, null);
    let ticks = 0;
    while (!orb.dead && ticks++ < 30) orb.fixedUpdate(1 / 60, hooksWith(spawnDust));
    expect(orb.dead).toBe(true);
    expect(ticks).toBeLessThanOrEqual(18);               // ai1 计 4/t → 预热完即重选即亡
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.length % 5).toBe(0);                     // 整批粒数封顶
    expect(recs.length).toBeLessThan(20 * 20);           // 早亡 ⇒ 15 tick 满速率上限 300 内有截尾
  });
});

// ============================================================ ② HealProj 298/305
describe('HealProj 298/305 绘制保真(AI_052 尘拖尾精确化)', () => {
  it('298 鬼疗:d175×5/substep(每 tick 4 批=20)、α100、scale1.3、velocity*=0/noGravity', () => {
    const { recs, spawnDust } = dustHookSink();
    const tgt = { x: 200, y: -5, w: 16, h: 16, hp: 40, maxHp: 100 };  // ★BJ748 注：A25 起入参=中心,本面无位置断言不依赖对齐
    const p = new HealProj(298, 0, 0, 3.7, tgt);
    p.fixedUpdate(1 / 60, hooksWith(spawnDust));
    expect(recs.filter((d) => d.type === 175)).toHaveLength(20);      // EU=3 ⇒ 4 子步
    for (const d of recs) {
      expect(d.scale).toBe(1.3);
      expect(d.alpha).toBe(100);
      expect(d.handle.noGravity).toBe(true);
      expect(d.handle.vx).toBe(0); expect(d.handle.vy).toBe(0);
    }
  });

  it('305 吸血:d183×3/substep(每 tick 11 批=33)、scale1.1、后移距 0.334 因子反向', () => {
    const { recs, spawnDust } = dustHookSink();
    const tgt = { x: 200, y: -5, w: 16, h: 16, hp: 40, maxHp: 100 };
    // ★BJ748（A25 尾迹收口）：BJ746 A25 起 HealProj 入参 (x,y)=出生【中心】
    //  （NewProjectile :10878-79 position=中心−size/2）。旧夹具传 (0,0) 是左上口径
    //  ——中心 (3,3) 恰与靶心 y=3 对齐;A25 后中心变为 (0,0),竖向偏 3px ⇒ vy'=0.0036
    //  ⇒ handle.y 展开恰 0.0024（j=2）爆 5e-10 锚。重对齐=中心传 (0,3)（dy=0 ⇒ vy'≡0），
    //  NewDust 盒参（左上）随之 (−3,0)，断言值域不变。
    const p = new HealProj(305, 0, 3, 7.7, tgt);
    p.fixedUpdate(1 / 60, hooksWith(spawnDust));
    expect(recs.filter((d) => d.type === 183)).toHaveLength(33);   // EU=10 ⇒ 11 子步×3
    const first = recs.slice(0, 3);
    expect(first.map((d) => d.type)).toEqual([183, 183, 183]);
    expect(first[0].scale).toBe(1.1);
    // 首子步混合后 vx=(0*15+4)/16=0.25 ⇒ handle.x = (−3+3) − 0.25*0.334*j(:28968)
    // (NewDust 盒参=左上 (−3,0);中心 y=3 与靶心同高 ⇒ vy'≡0 纵向无展开)
    expect(first[0].y).toBe(first[2].y);
    expect(first[2].handle.y).toBeCloseTo(first[0].handle.y, 9);
    expect(first[2].handle.x).toBeLessThan(first[0].handle.x);
    expect(first[0].handle.x - first[2].handle.x).toBeCloseTo(0.25 * 0.334 * 2, 6);
  });

  it('本体 draw 零调用(α255+GetAlpha 无特判 ⇒ 原版不可见,盘上为占位 stub)', () => {
    expect(pngSize('Projectile_298.png')).toEqual({ w: 1, h: 1 });
    expect(pngSize('Projectile_305.png')).toEqual({ w: 1, h: 1 });
    const p = new HealProj(298, 0, 0, 3, { x: 99, y: 99, w: 1, h: 1, hp: 9, maxHp: 10 });
    const { calls, r } = makeR();
    p.draw(r as never, {} as never);
    expect(calls).toHaveLength(0);
  });
});

// ==================================================== ③ DukeSharknadoBolt 385
describe('DukeSharknadoBolt 385 贴图转正(Main.cs:34878-34897 专支)', () => {
  const H = pngSize('Projectile_385.png');
  expect(H.h % 3).toBe(0);                               // projFrames[385]=3 帧竖排

  function boltRun(ticks: number): { b: DukeSharknadoBolt } {
    const b = new DukeSharknadoBolt(200, 200, 3, -1, false, false, { targetRef: () => null } as never);
    for (let i = 0; i < ticks; i++) b.fixedUpdate(1 / 60, hooksWith(null));
    return { b };
  }

  it('绘制态机(AI_065 两支同款):age>10 起可视 α −5/tick 钳 100、rot+=vx₀×0.1、frame=(age/3)%3', () => {
    const { b } = boltRun(19);
    const anyB = b as unknown as Record<string, unknown>;
    expect(anyB.visAlpha).toBe(255 - 5 * 9);            // age 11..19 共 9 次衰减
    expect(anyB.aiFrame).toBe(Math.floor(19 / 3) % 3);
    expect(anyB.rotDraw).toBeCloseTo(3 * 0.1 * 9, 9);   // 小弹 vx 恒 3(摆动仅改 vy)
    for (let i = 0; i < 60; i++) b.fixedUpdate(1 / 60, hooksWith(null));
    expect(anyB.visAlpha).toBe(100);                    // 钳下限(:30028-30031)
  });

  it('drawImage 帧切片:origin=中心(:34895)+rotate(rotDraw)+帧窗 H/3+globalAlpha=GetAlpha 系数', () => {
    const face = fakeImg(H.w, H.h);
    setProjSpriteOverride(385, face as never);
    const { b } = boltRun(15);                          // age=15 ⇒ 衰减 5 次 ⇒ α=230
    const anyB = b as unknown as Record<string, unknown>;
    const { calls, r } = makeR();
    b.draw(r as never, {} as never);
    const imgCalls = calls.filter((c) => c.m === 'drawImage');
    expect(imgCalls).toHaveLength(1);
    const [img, sx, sy, sw, sh] = imgCalls[0].a as [unknown, number, number, number, number];
    expect(img).toBe(face);                             // projSprite 缓存直返
    expect(sx).toBe(0);                                 // 竖排 3 帧,x 恒 0
    expect(sy).toBe(Math.floor(15 / 3) % 3 * (H.h / 3));
    expect(sw).toBe(H.w); expect(sh).toBe(H.h / 3);
    expect(imgCalls[0].a[5]).toBe(-H.w / 2);            // origin X = W/2
    expect(imgCalls[0].a[6]).toBe(-(H.h / 3) / 2);      // origin Y = 帧高/2
    const rot = calls.find((c) => c.m === 'rotate')!;
    expect(Math.abs(rot.a[0] as number)).toBeGreaterThan(0);
    const ga = calls.find((c) => c.m === 'set:globalAlpha')!;
    expect(ga.a[0]).toBeCloseTo(25 / 255, 9);           // (255−230)/255
    void anyB;
  });

  it('源面保留懒加载兜底支(projSprite 未就绪走标注近似色点)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'entities', 'bossAI_duke_moonlord.ts'), 'utf8');
    expect(src.includes("projSprite(385)")).toBe(true);
    expect(src.includes('#8FD8FF')).toBe(true);
  });
});

// ==================================================== ④ GolfBall 贴图染色链
describe('GolfBall 贴图转正(Main.cs:31475 动球支/:31578 通用支 · [G1]层序/[G2]乘色批)', () => {
  function ball(id: number): GolfBall {
    const sz = pngSize(`Projectile_${id}.png`);
    expect(sz).toEqual({ w: 8, h: 8 });                 // 球贴图 8×8 实图
    const face = fakeImg(sz.w, sz.h);
    setProjSpriteOverride(id, face as never);
    const b = new GolfBall(500, 500, id, () => ({ id: 1 }));
    return Object.assign(b, { __face: face }) as never as GolfBall;
  }

  it('静态球(IsGolfBallResting=true):单发 drawImage 居中旋转,零平涂(fillStyle/arc 不复现)', () => {
    const b = ball(745);
    const { calls, r } = makeR();
    b.draw(r as never);
    const imgCalls = calls.filter((c) => c.m === 'drawImage');
    expect(imgCalls).toHaveLength(1);                        // 无条件本体(:31578)
    expect(imgCalls[0].a[0]).not.toBeNull();
    expect(imgCalls[0].a[1]).toBe(-4); expect(imgCalls[0].a[2]).toBe(-4);
    expect(calls.some((c) => c.m === 'rotate')).toBe(true);
    expect(calls.some((c) => c.m === 'set:fillStyle')).toBe(false);
    expect(calls.some((c) => c.m === 'arc')).toBe(false);
  });

  it('[G1 层序·兜底几何(node 无 DOM)]动球:尾迹 f=0..1 垫底 → ×1.5 复刻 → 本体最后盖顶', () => {
    const b = ball(750);
    b.clubHit(8, 0, 0, null);                                // Moving 化 + vx=8
    const hist = (b as unknown as { posHist: Array<{ x: number; y: number }> }).posHist;
    for (let i = 0; i < 5; i++) hist.push({ x: 300 - i, y: 300 });
    const { calls, r } = makeR();
    b.draw(r as never);
    const imgCalls = calls.filter((c) => c.m === 'drawImage');
    expect(imgCalls).toHaveLength(28);                       // 26 尾迹 + 染色复刻 + 本体
    const alphas = calls.filter((c) => c.m === 'set:globalAlpha').map((c) => c.a[0] as number);
    expect(alphas).toHaveLength(27);                         // 尾迹 26 发逐粒 α + 复刻 1
    const q = 0.5 * (30 / 255);                              // num188=min(1,8/16)=0.5;A(750)=30
    expect(alphas[0]).toBeCloseTo(0, 9);                     // f=0 端
    expect(alphas[25]).toBeCloseTo(q, 9);                    // f=1 端
    expect(alphas[26]).toBeCloseTo(q, 9);                    // 复刻档无 f 因子
    // [G1] imgCalls 序 = [0..25]尾迹(f=0..1)垫底,[26]染色复刻,[27]本体最后盖顶
    //（原版 DrawProjDirect:动球支 :31475-31513 先画,通用支 :31578 补画在末）
    expect(imgCalls[0].a[1]).toBeCloseTo(-8 * 0.7 / 2, 9);   // fscale(f=0)=0.7
    expect(imgCalls[25].a[1]).toBeCloseTo(-8 * 1.5 / 2, 9);  // fscale(f=1)=1.5
    expect(imgCalls[26].a[3]).toBe(8 * 1.5);                 // 复刻档宽=×1.5(:31500)
    expect(imgCalls[26].a[1]).toBe(-8 * 1.5 / 2);
    expect(imgCalls[27].a[1]).toBe(-4);                      // 本体半宽 −sz/2 收官
  });

  it('[G2 乘色]tintedTex 预烘 add/cut 双面:multiply 填充带色表 rgb + lighter 加色贡献面', () => {
    // 临时桩 document.createElement → 记录型烘焙画布(tintedTex 需 DOM 存在)
    type CallRec = { m: string; a: unknown[] };
    const bakes: Array<CallRec[]> = [];
    const g = globalThis as unknown as Record<string, unknown>;
    const prevDoc = g.document;
    g.document = {
      createElement: (): Record<string, unknown> => {
        const ops: CallRec[] = [];
        bakes.push(ops);
        return {
          width: 0, height: 0,
          getContext: (): CanvasRenderingContext2D =>
            new Proxy({} as CanvasRenderingContext2D, {
              get: (_t, k) => ((...a: unknown[]) => { ops.push({ m: String(k), a }); }) as never,
              set: (_t, k, v) => { ops.push({ m: `set:${String(k)}`, a: [v] }); return true; },
            }),
        };
      },
    };
    try {
      const b = ball(740);                                   // 蓝 740：色表 [30,50,255,40]
      b.clubHit(12, 4, 0, null);                             // |v|=12.64 → k<1 非饱和档
      const kExp = Math.min(1, Math.hypot(12, 4) / 16);
      const q = kExp * (40 / 255);
      const hist = (b as unknown as { posHist: Array<{ x: number; y: number }> }).posHist;
      for (let i = 0; i < 5; i++) hist.push({ x: 300 - i, y: 300 });
      const { calls, r } = makeR();
      b.draw(r as never);

      // ---- 烘焙面 multiply+destination-in 三段合成,且 multiply 填充【带色值】----
      expect(bakes).toHaveLength(2);                         // add(色表 rgb)+cut(黑) 各一张
      const styles = bakes.flatMap((ops) => ops
        .filter((c) => c.m === 'set:fillStyle').map((c) => String(c.a[0])));
      expect(styles).toContain('rgb(30,50,255)');            // 色值进乘色面([G2]核心断言)
      expect(styles).toContain('rgb(0,0,0)');                // 黑背板=A 衰减载体
      for (const ops of bakes) {
        expect(ops.some((c) => c.m === 'set:globalCompositeOperation' && c.a[0] === 'multiply')).toBe(true);
        expect(ops.some((c) => c.m === 'set:globalCompositeOperation' && c.a[0] === 'destination-in')).toBe(true);
        expect(ops.filter((c) => c.m === 'drawImage')).toHaveLength(2);  // 源首绘+α 回贴
      }
      // ---- 场景面:put 双通道 —— cut@q·f(source-over)+add@k·f(lighter)×27 落点 ----
      const scene = calls as Call[];
      let gaCur = 1; let gcCur = 'source-over';
      const stack: Array<[number, string]> = [];
      const cutGa: number[] = []; const addGa: number[] = [];
      let bodyIdx = -1;
      for (let i = 0; i < scene.length; i++) {
        const c = scene[i];
        if (c.m === 'save') stack.push([gaCur, gcCur]);
        else if (c.m === 'restore') { const p = stack.pop(); if (p) { gaCur = p[0]; gcCur = p[1]; } }
        else if (c.m === 'set:globalAlpha') gaCur = c.a[0] as number;
        else if (c.m === 'set:globalCompositeOperation') gcCur = c.a[0] as string;
        else if (c.m === 'drawImage') {
          if ((c.a.length ?? 0) >= 5) {                      // 尾迹/复刻笔(A 面+加色面)
            if (gcCur === 'lighter') addGa.push(gaCur); else cutGa.push(gaCur);
          } else bodyIdx = i;                                // 3 参 = 无条件本体
        }
      }
      expect(addGa).toHaveLength(27);                        // 26 尾迹+1 复刻走 lighter 加色
      expect(cutGa).toHaveLength(27);                        // 同落点数,A 面=背景衰减
      expect(cutGa[0]).toBeCloseTo(0, 9);                    // f=0 端衰减归零
      expect(cutGa[26]).toBeCloseTo(q, 9);                   // 复刻档 A=k·a/255(与旧实现同式)
      expect(addGa[0]).toBeCloseTo(0, 9);
      expect(addGa[26]).toBeCloseTo(kExp, 9);                // rgb 面只吃速度因子,不吃表 A
      // [G1 终检]最后一个 drawImage 是无条件本体——尾迹/彩晕恒垫其下
      expect(bodyIdx).toBeGreaterThanOrEqual(0);
      const lastDraw = scene.reduce((acc, c, i) => (c.m === 'drawImage' ? i : acc), -1);
      expect(bodyIdx).toBe(lastDraw);
    } finally {
      g.document = prevDoc;                                  // 还原全局,防泄漏他测
    }
  });

  it('轨迹窗未满(oldPos[4]==Zero 门):跳过插值尾迹,仅染色复刻 + 本体最后', () => {
    const b = ball(752);
    b.clubHit(4, 0, 0, null);                                // Moving 但 hist 空
    const { calls, r } = makeR();
    b.draw(r as never);
    const imgCalls = calls.filter((c) => c.m === 'drawImage');
    expect(imgCalls).toHaveLength(2);                        // 复刻 + 本体
    expect(imgCalls[0].a[3]).toBe(8 * 1.5);                  // [G1] 复刻先画(垫层)
    expect(imgCalls[0].a[1]).toBe(-8 * 1.5 / 2);
    expect(imgCalls[1].a[1]).toBe(-4);                       // 本体收尾盖顶(:31578)
  });
});

// ------------------------------------------------------------------ 台账锚
describe('台账勾销(approx-registry C 档点名件)', () => {
  it('平涂扫描退役面:SpectreSoulProj/HealProj 源内不再出现 fillStyle 圆点(arc 归零)', () => {
    const spec = fs.readFileSync(path.join(__dirname, '..', 'src', 'entities', 'SpectreSoulProj.ts'), 'utf8');
    expect(spec.includes('#9DF5E8')).toBe(false);
    expect(spec.match(/\.arc\(/)?.length ?? 0).toBe(0);
    const heal = fs.readFileSync(path.join(__dirname, '..', 'src', 'entities', 'HealProj.ts'), 'utf8');
    expect(heal.match(/\.arc\(/)?.length ?? 0).toBe(0);
    expect(heal.match(/ctx\.fillStyle\s*=/)?.length ?? 0).toBe(0);
  });
});
