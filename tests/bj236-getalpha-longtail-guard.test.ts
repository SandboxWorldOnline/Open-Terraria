// BJ236 GetAlpha 长尾续批（2026-09-21）：
//  ① 剑气族 116/132/156/157/173：GetAlpha :81264-81277（1457 实锚）专属支——
//    localAI[1] 梯（<5 Transparent / 5..15 灰梯 / ≥15 (255,255,255,α)）与 114 同配方
//    （gem114Ramp 族级复用）+ aiStyle27 脉动 α（:26846-26858 ±30/步 0↔255 折返、
//    scale ±0.02 呼吸）。与 114 的差异：绘制段无 ×(1−Opacity) 乘区 → ≥15 段
//    ga=α/255 脉动直通、梯段 ga=灰梯值。
//  ② 磁球 254：GetAlpha :81278-81287 timeLeft<30 门 → 强度 min(1,life/30) 的
//    A=0 纯加算白（ADDITIVE_GLOW 'lighter' 承载）。
//  ③ Wisp 211：GetAlpha :81329-81332 恒 (255,255,255,0) 加算白——PetFollower
//    载体 draw 本体支 'lighter'（projPet 型不走 Arrow 域）。
//  ④ vanillaProjAlpha.ts 写后自证守卫（tools/guard-vanilla-proj-alpha.mjs）：
//    wc-l 钉死 + `};` 闭合 + 300 项唯一 + 末项值钉死；变异自测含 BJ228 事故
//    重放（截断/缺 114 项）。
import { describe, it, expect, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import { Arrow, setProjSpriteOverride, PROJ_ALPHA0 } from '../src/entities/Arrow';
import { GlowstickProj } from '../src/entities/WeaponProj';
import { PetFollower } from '../src/entities/PetFollower';
import type { GameHooks } from '../src/entities/types';

const GUARD_TOOL = fileURLToPath(new URL('../tools/guard-vanilla-proj-alpha.mjs', import.meta.url));
const GUARD_TARGET = fileURLToPath(new URL('../src/data/vanillaProjAlpha.ts', import.meta.url));
const GAME_ROOT = fileURLToPath(new URL('../', import.meta.url));

function emptyWorld(): World {
  const w = new World(160, 200, 30, 'open');
  for (let x = 0; x < 160; x++) w.store.setTileSilent(x, 190, 1, 0, 0);
  return w;
}

function makeGame(w: World): GameHooks {
  return {
    world: w,
    player: { dead: true, iframes: 0, cx: -9999, cy: -9999, x: -9999, y: -9999, w: 10, h: 20 },
    enemies: () => [], critters: () => [],
    entities: { nextId: 1, add: (_e: unknown) => {}, projectiles: [] as unknown[] },
    playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {},
    spawnParticles: () => {}, addDamageNumber: () => {}, spawnDrop: () => null,
    damagePlayer: (): number => 0, notifyInventoryChanged: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {}, cutTile: () => {},
    spawnDust: () => null,
  } as unknown as GameHooks;
}

function ga(a: Arrow): number | null {
  return (a as unknown as { drawGlobalAlpha(): number | null }).drawGlobalAlpha();
}

function mkSword(id: number, w: World): { a: Arrow; game: GameHooks } {
  const game = makeGame(w);
  const a = new Arrow(80 * TILE, 100 * TILE, 3, 0, 40, 1, id, {});
  return { a, game };
}

// ctx 记录器（仿 bj228/sw-bj56 惯例;另加 drawImage 时点快照——Arrow 加算支
// 同块内 lighter→draw→source-over 复位,块尾读 op 恒 source-over,须按
// drawImage 时点采样才能观测加算 pass）
interface DrawRec { op: string; alpha: number; imgs: number; filter: string }
interface SnapRec { op: string; alpha: number; filter: string }
function mkCtx() {
  const recs: DrawRec[] = [];
  const snaps: SnapRec[] = [];
  let cur: DrawRec | null = null;
  const base = {
    canvas: { width: 800, height: 600 },
    save() { recs.push(cur = { op: 'source-over', alpha: 1, imgs: 0, filter: 'none' }); },
    restore() { cur = null; },
    clearRect() {}, fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
    stroke() {}, fill() {}, arc() {}, closePath() {}, ellipse() {}, setLineDash() {},
    translate() {}, rotate() {}, scale() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  };
  const ctx = new Proxy(base, {
    get(t, k: string) {
      if (k === 'save' || k === 'restore') return t[k as 'save' | 'restore'];
      if (k === 'drawImage') {
        return (..._a: unknown[]) => {
          if (cur) {
            cur.imgs++;
            snaps.push({ op: cur.op, alpha: cur.alpha, filter: cur.filter });
          }
        };
      }
      if (k === 'globalCompositeOperation' || k === 'globalAlpha' || k === 'filter') {
        const key = k === 'globalCompositeOperation' ? 'op' : k === 'globalAlpha' ? 'alpha' : k;
        return cur ? (cur as unknown as Record<string, string | number>)[key] : undefined;
      }
      return (t as unknown as Record<string, unknown>)[k];
    },
    set(t, k: string, v) {
      if (k === 'globalCompositeOperation' || k === 'globalAlpha' || k === 'filter') {
        if (cur) {
          const key = k === 'globalCompositeOperation' ? 'op' : k === 'globalAlpha' ? 'alpha' : k;
          (cur as unknown as Record<string, string | number>)[key] = v as string | number;
        }
        return true;
      }
      (t as unknown as Record<string, unknown>)[k] = v;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, recs, snaps };
}

describe('BJ236 ①剑气族 116/132/156/157/173（GetAlpha :81264-81277 + aiStyle27 脉动）', () => {
  it('PROJ_ALPHA0 五键=255（SetDefaults :2040/:2219/:2448/:2455/:2597 直读）', () => {
    for (const id of [116, 132, 156, 157, 173]) expect(PROJ_ALPHA0[id]).toBe(255);
  });

  it('出生梯：<5 子步隐形 → 5..15 灰梯 (l−5)/10（116,EU=0 → 1 子步/update）', () => {
    const w = emptyWorld();
    const { a, game } = mkSword(116, w);
    a.fixedUpdate(1 / 60, game);                       // ramp=1
    expect(ga(a)).toBe(0);                             // <5 → Transparent
    for (let t = 0; t < 5; t++) a.fixedUpdate(1 / 60, game);   // ramp=6
    expect(ga(a)).toBeCloseTo(0.1, 5);                 // (6−5)/10
    for (let t = 0; t < 8; t++) a.fixedUpdate(1 / 60, game);   // ramp=14
    expect(ga(a)).toBeCloseTo(0.9, 5);
    a.fixedUpdate(1 / 60, game);                       // ramp=15 → ≥15 段 ga=α/255=1（脉动未起,α=SetDefaults 255）
    expect(ga(a)).toBe(1);
  });

  it('脉动（:26846-26858）：梯满首拍钳 255 翻降臂 → −30/步至 0 翻升臂 → +30/步回 255', () => {
    const w = emptyWorld();
    const { a, game } = mkSword(116, w);
    for (let t = 0; t < 16; t++) a.fixedUpdate(1 / 60, game);  // update16=脉动首拍（升臂钳 255）
    expect(ga(a)).toBe(1);
    expect((a as unknown as { drawScale: number }).drawScale).toBeCloseTo(0.98, 5);   // scale −0.02 呼吸
    a.fixedUpdate(1 / 60, game);                       // 降臂第一拍 α=225
    expect(ga(a)).toBeCloseTo(225 / 255, 5);
    for (let t = 0; t < 8; t++) a.fixedUpdate(1 / 60, game);   // 225→…→15→0（update25 钳 0 翻升臂）
    expect(ga(a)).toBe(0);                             // 脉动谷底=全隐
    a.fixedUpdate(1 / 60, game);                       // 升臂第一拍 α=30
    expect(ga(a)).toBeCloseTo(30 / 255, 5);
    for (let t = 0; t < 8; t++) a.fixedUpdate(1 / 60, game);   // 30→…→240→255 钳（update34）
    expect(ga(a)).toBe(1);                             // 周期 18 步回满亮
  });

  it('族级同配方：132/156/173/157 与 116 同梯同脉动（GA 逐 id 同值）', () => {
    for (const id of [132, 156, 173, 157]) {
      const w = emptyWorld();
      const { a, game } = mkSword(id, w);
      for (let t = 0; t < 6; t++) a.fixedUpdate(1 / 60, game);   // ramp=6
      expect(ga(a)).toBeCloseTo(0.1, 5);
      for (let t = 0; t < 11; t++) a.fixedUpdate(1 / 60, game);  // update17=脉动降臂首拍
      expect(ga(a)).toBeCloseTo(225 / 255, 5);
    }
  });
});

describe('BJ236 ②磁球 254（GetAlpha :81278-81287,min(1,life/30) 加算白）', () => {
  it('ga=min(1,life/30)：寿命前段恒 1、尾 30t 线性淡出', () => {
    const w = emptyWorld();
    const game = makeGame(w);
    const a = new Arrow(80 * TILE, 100 * TILE, 0, 0, 10, 1, 254, {});
    expect(a.life).toBe(900);                          // SetDefaults timeLeft（vanilla-projectiles.json）
    expect(ga(a)).toBe(1);
    (a as unknown as { life: number }).life = 15;
    expect(ga(a)).toBeCloseTo(0.5, 5);
    (a as unknown as { life: number }).life = 0;
    expect(ga(a)).toBe(0);
    void game;
  });

  it('本体画入 lighter（A=0 加算白;强度随寿命门）', () => {
    // 254 projFrames=5 → draw 走 projFrameImg 切帧（node 无 DOM）——stub 最小
    // document（canvas.getContext 返回 no-op 2d),drawImage 计数不受影响
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0, height: 0,
        getContext: () => ({ imageSmoothingEnabled: false, drawImage() {} }),
      }),
    });
    const w = emptyWorld();
    const game = makeGame(w);
    setProjSpriteOverride(254, { width: 38, height: 190 } as unknown as HTMLImageElement);
    try {
      const a = new Arrow(80 * TILE, 100 * TILE, 0, 0, 10, 1, 254, {});
      const { ctx, snaps } = mkCtx();
      a.draw({ ctx } as never, {} as never);
      const pass = snaps.find((r) => r.op === 'lighter');
      expect(pass).toBeDefined();
      expect(pass!.alpha).toBe(1);                     // life 900 → 强度 1
      (a as unknown as { life: number }).life = 15;
      const ctx2 = mkCtx();
      a.draw({ ctx: ctx2.ctx } as never, {} as never);
      const pass2 = ctx2.snaps.find((r) => r.op === 'lighter');
      expect(pass2).toBeDefined();
      expect(pass2!.alpha).toBeCloseTo(0.5, 5);
      void game;
    } finally {
      setProjSpriteOverride(254, { width: 0, height: 0 } as unknown as HTMLImageElement);
      vi.unstubAllGlobals();
    }
  });
});

describe('BJ236 ③Wisp 211（GetAlpha :81329-81332 恒加算白,PetFollower 载体）', () => {
  it('本体画入 lighter（projPet 型不走 Arrow 域,save/restore 块内设置）', () => {
    const pet = new PetFollower(80 * TILE, 100 * TILE, 211, () => ({
      dead: true, cx: -9999, cy: -9999, x: -9999, y: -9999, w: 10, h: 20, facing: 1, gravDir: 1,
      velocity: { x: 0, y: 0 }, inputLeft: undefined, inputUp: undefined, inputDown: undefined,
    } as never));
    const img211 = { width: 24, height: 240 };         // 10 帧竖条（projFrames[211]=10）
    const { ctx, recs, snaps } = mkCtx();
    pet.draw({ ctx, atlas: { ensureVImage: () => img211 } } as never, {} as never);
    const pass = recs.find((r) => r.imgs >= 1);
    expect(pass).toBeDefined();
    expect(snaps.some((s) => s.op === 'lighter' && s.alpha === 1)).toBe(true);   // A=0 纯加算白直译,恒满强（GetAlpha 恒值不读 α）
  });
});

describe('BJ236 ④vanillaProjAlpha.ts 写后自证守卫（tools/guard-vanilla-proj-alpha.mjs）', () => {
  function runGuard(file?: string): { code: number; out: string } {
    try {
      const args = file ? ['--file', file] : [];
      const out = execFileSync('node', [GUARD_TOOL, ...args], { encoding: 'utf8', cwd: GAME_ROOT });
      return { code: 0, out };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  }

  it('真文件四道断言全绿（wc-l=529/闭合/300 唯一/末项 1110 钉死;★BJ708-G33 重钉 515→529=BJ668b 尾批头注 +14 合法登记面）', () => {
    const r = runGuard();
    expect(r.code).toBe(0);
    expect(r.out).toContain('GUARD GREEN');
    expect(r.out).toContain('entries=300');
  });

  it('变异自测：截断/缺 114（BJ228 事故重放）/重复键/末项改值 → 各自爆红', () => {
    const text = readFileSync(GUARD_TARGET, 'utf8');
    const dir = mkdtempSync(join(tmpdir(), 'bj236-guard-'));
    try {
      const cases: Array<[string, string, string]> = [
        ['truncate', text.slice(0, Math.floor(text.length * 0.6)), '[closure]'],
        // BJ228 事故指纹重放：合法可解析但缺 114 项 → 行数+项数双爆红
        ['drop-114', text.replace(/^  114: \{.*\n/m, ''), '[count]'],
        ['dup-key', text.replace(/^};\s*$/m, "  114: { kind: 'fade', off: 1 },\n};\n"), '[unique]'],
        ['last-value', text.replace("'fixedfade', rgba: [255,255,255,128], off: 1 }, // :76428", "'fixedfade', rgba: [255,255,255,128], off: 2 }, // :76428"), '[last-value]'],
      ];
      for (const [name, mutated, marker] of cases) {
        const p = join(dir, `${name}.ts`);
        writeFileSync(p, mutated);
        const r = runGuard(p);
        expect(r.code, name).not.toBe(0);
        expect(r.out, name).toContain(marker);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
