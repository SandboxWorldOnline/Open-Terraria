// ★BJ705-G26 件3:[g20-buff305-lavavision] 清偿——熔岩鲨潜水镜（buff 305 → lavaVision
// → lavaOpacity 渐变 → 液体渲染三消费面）。定谳（1457 亲读;G24 强化注记任务书销账）:
//   · 状态:Player.cs:1517 lavaOpacity=1f;斜坡 UpdateBuffs :12140-12153
//     `lavaVision ∧ lavaWet ∧ >0.4 → −0.04 钳 0.4;else <1 → +0.04 钳 1`
//     （读上拍 lavaWet——UpdateBuffs 先于湿段 :27883）。
//   · 授予:唯一 buffType 305（:9994-9998 lavaVision=true;坐骑 49 熔岩鲨）;
//     复位面 Spawn :37875 lavaOpacity=1（本仓无 Spawn 重置段——残值 ≤15 拍自愈,
//     不可感知微面登记）。
//   · 消费①LiquidRenderer.cs:648-661 DrawNormalLiquids（现役 NotRetro 路）:
//     `num = Opacity × (bg?1:DEFAULT_OPACITY) … case 1: num *= lavaOpacity; Min(1)`
//     ——drawVanillaLiquids 岩浆 run α（bg/fg 双 pass）+glint ADD 同乘;
//     ②TileDrawing.cs:4116 case 1 基线=lavaOpacity;③:4125 门
//     `(num10!=1 || !(lavaOpacity<1)) && …` ——渐隐相地表岩浆【不】落 1.0/0.9/0.6
//     覆写（保持 fade 值）。oldDrawWater :58539=复古死路不另移植。
//   落刀:Player.lavaOpacity 字段+湿段斜坡;VanillaLiquidRenderer 两导出穿参
//   （lavaOpacity=1 缺省恒等）;Renderer._lavaOpacity 帧头快照×六调用位。
// 变异恰红:§M 派生（斜坡翻向/基线不乘/地表例外摘除）。
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import type { GameHooks } from '../src/entities/types';
import { TileStore } from '../src/world/TileStore';
import type { SpriteAtlas } from '../src/assets/SpriteAtlas';
import { drawLiquidBehindTilesOnly } from '../src/render/VanillaLiquidRenderer';
import { BuffType } from '../src/stats/Buffs';
import { waterWaves } from '../src/render/WaterWaves';

// ===================== §A Player 斜坡（行为面,真实 fixedUpdate） =====================
const W = 80, H = 80;
const LAVA_ROW = 31;

function lavaWorld(): World {
  const w = new World(W, H, 11, 'g26-lava');
  const st = w.store;
  for (let x = 4; x < 78; x++) { st.setTile(x, LAVA_ROW + 1, 1);
    st.setLiquid(x, LAVA_ROW, 255, 2); st.setLiquid(x, LAVA_ROW - 1, 255, 2); }   // 2 格深:居中探针入浆（wet 真→lavaWet 镜像不被 !wet 清）
  return w;
}
function fakeHooks(w: World, p: Player): GameHooks {
  return {
    world: w, player: p, enemies: () => [], critters: () => [], npcs: () => [],
    damagePlayer: (): number => 0, spawnDrop: () => null, addDamageNumber: () => {},
    cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
    spawnParticles: () => {}, notifyInventoryChanged: () => {},
    playSfx: () => {}, playSfxFiles: () => {}, playSfxWav: () => {},
    showPickupLabel: () => {}, recLog: () => {},
    spawnDust: () => ({ vx: 0, vy: 0, scale: 1 }),
  } as unknown as GameHooks;
}
function mkPlayer(w: World, row: number, tx: number): Player {
  const p = new Player(tx * TILE, row * TILE - 48, new Inventory());
  p.hp = 500;
  return p;
}
const tick = (p: Player, w: World): void => { p.fixedUpdate(1 / 60, fakeHooks(w, p) as never); };

describe('BJ705-G26 件3 §A lavaOpacity 斜坡（UpdateBuffs :12140-12153）', () => {
  it('骑 49 熔岩鲨（buff 305）入浆:−0.04/t 到底 0.4 钳位;岩浆里不掉血（lavaImmune 腿自证）', () => {
    const w = lavaWorld();
    const p = mkPlayer(w, LAVA_ROW + 1, 40);   // 出生即浸浆（脚入岩浆行）
    p.mount.setMount(49, p);                   // 熔岩鲨（buff305;G20 A1 同式——raw
    //  active+type 缺 mount 能量/态初始化=骑乘面不完整,勿用）
    expect(p.mount.buff).toBe(305);            // 授予源自证（MOUNT_DATA 49→305）
    tick(p, w);
    expect(p.inLava).toBe(true);               // 前置自证:浸浆
    expect(p.splashLavaWet).toBe(true);        // lavaWet 镜像（斜坡读上拍值,本拍才真）
    expect(p.lavaOpacity).toBe(1);             // 第 1 拍:斜坡读到上拍 lavaWet=false → 不降
    tick(p, w);
    expect(p.lavaOpacity).toBeCloseTo(0.96, 12);   // 第 2 拍起 −0.04/t
    for (let i = 0; i < 13; i++) tick(p, w);
    expect(p.lavaOpacity).toBeCloseTo(0.44, 12);   // 第 15 降拍
    tick(p, w);
    expect(p.lavaOpacity).toBe(0.4);               // 第 16 拍到底（0.4399…−0.04→max 钳 0.4）
    // ★原版底界振荡（:12141 `>0.4f` 严格大于 + else-if `+0.04f`）:到底拍 0.4 不满足
    //  降门 → else 支回升 0.44 → 次拍再落 0.4 —— 0.4↔0.44 逐拍交替（C# float 同构
    //  语义,视觉=底界 ±0.04 α 微闪,原版相）。钳位断言按振荡相钉。
    tick(p, w);
    expect(p.lavaOpacity).toBeCloseTo(0.44, 12);   // 到底拍回升（else 支）
    tick(p, w);
    expect(p.lavaOpacity).toBe(0.4);               // 再落（降支）
    // 免伤面（lavaTotalImmune buff305 腿）由 tests/bj704g20 A1 独立锁,不在此复读
    //（hp 夹具被 hpMax=100 钳位,hp0 断言无效;斜坡为本测唯一判别面）
  });

  it('下鞍（!lavaVision）入浆:恒 1 不渐隐;直置渐隐态后无 lavaVision:+0.04/t 回 1', () => {
    const w = lavaWorld();
    const p = mkPlayer(w, LAVA_ROW + 1, 40);
    p.buffs.apply(BuffType.ObsidianSkin, 999);   // 免伤（本测只看斜坡,无坐骑）
    for (let i = 0; i < 5; i++) tick(p, w);
    expect(p.inLava).toBe(true);
    expect(p.lavaOpacity).toBe(1);             // 无授予源:浸浆不降
    p.lavaOpacity = 0.4;                       // 直置渐隐态（斜坡注入面;无坐骑=else 支）
    tick(p, w);
    expect(p.lavaOpacity).toBeCloseTo(0.44, 12);   // +0.04（lavaVision 假优先于 lavaWet）
    for (let i = 0; i < 15; i++) tick(p, w);
    expect(p.lavaOpacity).toBe(1);                 // 15 拍回满+钳位
  });
});

// ===================== §B 渲染消费面（记录 ctx 直驱两导出） =====================
function makeRecordingCtx() {
  const draws: Array<{ ga: number; args: number[] }> = [];
  let ga = 1;
  const base: Record<string, unknown> = {
    canvas: { width: 8192, height: 8192 },
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000000',
  };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(t, prop) {
      if (prop in t) return t[prop as string];
      const name = String(prop);
      return (...args: unknown[]) => {
        if (name === 'drawImage') draws.push({ ga, args: args.map((a) => (typeof a === 'number' ? a : -999)) });
        if (name === 'getTransform') return { a: 1, b: 0, c: 0, d: 0, e: 0, f: 0 };
        if (name === 'getImageData') return { data: new Uint8ClampedArray(4) };
        return undefined;
      };
    },
    set(t, prop, v) {
      if (prop === 'globalAlpha') ga = v as number;
      t[prop as string] = v;
      return true;
    },
  };
  return { ctx: new Proxy(base, handler) as unknown as CanvasRenderingContext2D, draws };
}

/** 岩浆带 fixture（bj307 C 形状:slope3 带格+右/下岩浆;store liquidType 2=lava） */
function lavaBandStore(surface: boolean): TileStore {
  const st = new TileStore(60, 80);
  const y = surface ? 40 : 60;
  const set = (x: number, yy: number, t: number, liquid = 0, lt = 0) => {
    const i = st.idx(x, yy);
    st.type[i] = t; st.flags[i] = t ? 1 : 0;
    st.liquid[i] = liquid; st.liquidType[i] = liquid > 0 ? lt : 0;
  };
  set(29, y, 1); set(30, y - 1, 1); set(30, y, 1, 0, 0), st.slope[st.idx(30, y)] = 3;
  set(30, y + 1, 0, 255, 2); set(31, y, 0, 255, 2);
  return st;
}

const atlas = { width: 256, height: 256, ensureVImage: () => ({ width: 256, height: 256 }) } as unknown as SpriteAtlas;
const wf = (_x: number, _y: number) => false;

beforeAll(() => {
  (globalThis as unknown as { Image?: unknown }).Image = class {
    src = ''; width = 72; height = 16; complete = true;
    onerror: (() => void) | null = null; onload: (() => void) | null = null;
    addEventListener() { /* noop */ } removeEventListener() { /* noop */ }
  };
  waterWaves.setQuality(0);
});

describe('BJ705-G26 件3 §B drawLiquidBehindTilesOnly 消费（TileDrawing :4116/:4125）', () => {
  it('地下岩浆带:基线 alpha=lavaOpacity（0.5→0.5,1→1）;缺省参=1 恒等', () => {
    const { ctx, draws } = makeRecordingCtx();
    drawLiquidBehindTilesOnly(ctx, atlas, lavaBandStore(false), 45, 25, 55, 35, 65,
      0, wf, true, 0, false, null, null, null, 0.5);
    expect(draws.length).toBeGreaterThan(0);
    for (const d of draws) expect(d.ga).toBeCloseTo(0.5, 12);
    const { ctx: ctx2, draws: d2 } = makeRecordingCtx();
    drawLiquidBehindTilesOnly(ctx2, atlas, lavaBandStore(false), 45, 25, 55, 35, 65,
      0, wf, true, 0, false, null, null, null, 1);
    for (const d of d2) expect(d.ga).toBeCloseTo(1, 12);
  });

  it('地表岩浆带（y≤groundLevel）:渐隐相保持 fade 值（不强拉 1.0）;满值相照旧 1.0', () => {
    const { ctx, draws } = makeRecordingCtx();
    drawLiquidBehindTilesOnly(ctx, atlas, lavaBandStore(true), 45, 25, 35, 35, 45,
      0, wf, true, 0, false, null, null, null, 0.5);
    expect(draws.length).toBeGreaterThan(0);
    for (const d of draws) expect(d.ga).toBeCloseTo(0.5, 12);   // :4125 lava 例外
    const { ctx: ctx2, draws: d2 } = makeRecordingCtx();
    drawLiquidBehindTilesOnly(ctx2, atlas, lavaBandStore(true), 45, 25, 35, 35, 45,
      0, wf, true, 0, false, null, null, null, 1);
    for (const d of d2) expect(d.ga).toBeCloseTo(1, 12);        // 满值=地表覆写照旧
  });
});

describe('BJ705-G26 件3 §C drawVanillaLiquids 岩浆 run α 算式（LiquidRenderer.cs:648-661）', () => {
  it('α=Opacity×(bg?1:0.95)×lavaOpacity,Min(1) 后置——端点钉值', () => {
    // 原式:num = Opacity × (isBackgroundDraw ? 1 : DEFAULT_OPACITY[1]=0.95);
    //       case 1: num *= lavaOpacity; num = Min(1, num)（与实现同序同运算）
    const a = (op: number, bg: boolean, lo: number) =>
      Math.min(1, op * (bg ? 1 : 0.95) * lo);
    expect(a(1, false, 1)).toBeCloseTo(0.95, 12);      // 常态前景岩浆
    expect(a(1, false, 0.5)).toBeCloseTo(0.475, 12);   // 渐隐半程
    expect(a(1, false, 0.4)).toBeCloseTo(0.38, 12);    // 渐隐到底
    expect(a(1, true, 0.4)).toBeCloseTo(0.4, 12);      // bg pass 无 DEFAULT_OPACITY 仍乘
    expect(a(1, true, 1)).toBe(1);                     // Min(1) 后置
  });
});

// ===================== §D 结构锁（穿参与斜坡接线） =====================
describe('BJ705-G26 件3 §D 结构锁（源锚——防静默回退）', () => {
  const rendererSrc = readFileSync(join(process.cwd(), 'src', 'render', 'Renderer.ts'), 'utf8');
  const liqSrc = readFileSync(join(process.cwd(), 'src', 'render', 'VanillaLiquidRenderer.ts'), 'utf8');
  const playerSrc = readFileSync(join(process.cwd(), 'src', 'entities', 'Player.ts'), 'utf8');
  it('D1 Player 斜坡+字段+授予谓词', () => {
    expect(playerSrc).toContain('lavaOpacity = 1;');
    expect(playerSrc).toContain('const lavaVision = this.ridingMount && this.mount.buff === 305;');
    expect(playerSrc).toContain('this.lavaOpacity = Math.max(0.4, this.lavaOpacity - 0.04);');
    expect(playerSrc).toContain('this.lavaOpacity = Math.min(1, this.lavaOpacity + 0.04);');
    expect(playerSrc).toContain('[g20-buff305-lavavision] 清偿');
  });
  it('D2 液体渲染穿参（两导出+缺省 1 恒等）+岩浆乘位', () => {
    expect(liqSrc.match(/lavaOpacity = 1,/g)?.length).toBe(2);   // 两导出签名缺省参
    expect(liqSrc).toContain('if (lt === 1) alpha = lavaOpacity;');
    expect(liqSrc).toContain('if (y <= Math.floor(groundLevel) && !(lt === 1 && lavaOpacity < 1)) {');
    expect(liqSrc.match(/\* \(vt === 1 \? lavaOpacity : 1\)/g)?.length).toBe(6);   // batch/cpu/glint×3/k 五乘位+bg 复用 k
  });
  it('D3 Renderer 帧快照+六调用位', () => {
    expect(rendererSrc).toContain('this._lavaOpacity = player.lavaOpacity;');
    expect(rendererSrc).toContain('private _lavaOpacity = 1;');
    expect(rendererSrc.match(/this\._lavaOpacity\)/g)?.length).toBe(6);
  });
});
