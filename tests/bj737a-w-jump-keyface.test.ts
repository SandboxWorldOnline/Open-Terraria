// ★BJ737-A issue#31 件1（2026-10-31）：W 键跳跃 / 按住 W 按空格跳不起来 —— 判别锁。
//
// 原版锚（亲读 1457）：
//   · PlayerInput.cs:2072/2076（Redigit Keyboard 档）：KeyStatus["Up"]=["W"]、
//     ["Jump"]=["Space"] —— W 不入 Jump,Space 不入 Up。
//   · TriggersSet.cs:786/:790：`p.controlUp = Up; p.controlJump = Jump` —— 两轴分立拷贝。
//   · Player.cs 跳跃链全读 controlJump（JumpMovement :20802 块头 ~90 站）;
//     findPulley 调用门 :26320 `!controlJump`（持跳不抓绳）;
//     绳上攀爬臂 :26531 `controlUp & flag15`（W 爬,非 Space）;
//     绳上跳离臂 :26481-26486 `if (controlJump) { pulley=false; jump=jumpHeight;
//     velocity.Y=-jumpSpeed }`（Space=原地弹跳离绳,无音效;其后的第二 if(pulley)
//     垂直链 :26502 被 pulley=false 跳过 = 跳离独占）。
//
// 本仓病灶（修前）：Game.ts:10636 `inputJump = downAction('Jump') || downAction('Up')`
//   —— ①W 按下即 jumpEdge 起跳;②持 W 期 inputJump 电平恒真 → jumpEdgePrev 已真,
//   再按空格无沿 =「按住 W 跳不起来」（用户实报双主诉）。修 = 根部拆并键面
//   （inputJump=Space 单键面）+ jumpOnlyHeld 精确化 + 攀爬臂改 inputUp + 补 :26481 跳离臂。
//
// 变异证红映射：
//   M1 Game.ts 恢复并键面（`|| inp.downAction('Up')`） → ②S5 结构锁红
//   M2 ropeClimbVy inputUp→inputJump                      → ③S9 红（W 不再攀=旧并键面回归）
//   M3 跳离臂闭死（`false && this.inputJump`）             → ③S10 红（Space 在绳上无动作=旧缺臂）
//   M4 jumpOnlyHeld 加回 `&& !this.inputUp`               → ③S12 红（W+Space 可抓绳=旧登记差异复活）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

type Listener = (e: unknown) => void;
const winReg = new Map<string, Listener[]>();
const elReg = new Map<string, Listener[]>();
const makeReg = (reg: Map<string, Listener[]>) => ({
  addEventListener: (t: string, fn: Listener) => { if (!reg.has(t)) reg.set(t, []); reg.get(t)!.push(fn); },
  removeEventListener: (t: string, fn: Listener) => {
    const arr = reg.get(t); if (arr) reg.set(t, arr.filter((f) => f !== fn));
  },
});
const dispatchWin = (t: string, e: unknown) => { for (const fn of winReg.get(t) ?? []) fn(e); };
/** 键事件最小体（Input keydown 头对 Space/ArrowUp/Tab 调 preventDefault） */
const keyEv = (code: string, repeat = false) => ({
  code, repeat, target: null, shiftKey: false, preventDefault: () => {},
});

vi.stubGlobal('window', {
  addEventListener: (t: string, fn: Listener) => makeReg(winReg).addEventListener(t, fn),
  removeEventListener: (t: string, fn: Listener) => makeReg(winReg).removeEventListener(t, fn),
});
const fakeEl = {
  addEventListener: (t: string, fn: Listener) => makeReg(elReg).addEventListener(t, fn),
  removeEventListener: (t: string, fn: Listener) => makeReg(elReg).removeEventListener(t, fn),
  getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 }),
};

import { Input } from '../src/core/Input';
import { DEFAULT_KEYBINDS } from '../src/core/Keybinds';
import { options } from '../src/core/Options';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { TILE } from '../src/core/constants';
import { TILE_INTERNAL_BY_SHEET } from '../src/data/tiles';
import type { GameHooks } from '../src/entities/types';
import { withMutation, lockTargetFile, unlockTargetFile } from './mutation-guard';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = (p: string): string => readFileSync(join(ROOT, 'src', p), 'utf8');
const GT = join(ROOT, 'src', 'core', 'Game.ts');
const PT = join(ROOT, 'src', 'entities', 'Player.ts');

const ROPE_T = TILE_INTERNAL_BY_SHEET.get(213)!;
const ROPE_COL = 40;
function ropeWorld(): World {
  const w = new World(80, 80, 11, 'bj737a');
  for (let y = 14; y <= 34; y++) w.store.setTileSilent(ROPE_COL, y, ROPE_T);
  return w;
}
function flatWorld(): World {
  const w = new World(80, 80, 33, 'bj737a-flat');
  for (let x = 12; x <= 70; x++) w.store.setTileSilent(x, 40, 1 /* dirt */);
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
const tick = (p: Player, w: World): void => { p.fixedUpdate(1 / 60, fakeHooks(w, p) as never); };

// ===================== ① Input 层键面独立性（issue 主诉链根部） =====================
describe('BJ737-A① W/Space 两轴独立（PlayerInput.cs:2072/2076 + TriggersSet.cs:786/790）', () => {
  let inp: Input;
  const savedBinds = options.data.keybinds;
  beforeEach(() => {
    winReg.clear(); elReg.clear();
    inp = new Input(fakeEl as unknown as HTMLElement);
    (options.data as { keybinds?: Record<string, string[]> }).keybinds = undefined;
  });
  afterEach(() => { options.data.keybinds = savedBinds; });

  it('默认绑定锚：Up 含 KeyW 不含 Space;Jump=纯 Space 不含 KeyW/ArrowUp（:2072/:2076）', () => {
    expect(DEFAULT_KEYBINDS.Up).toContain('KeyW');
    expect(DEFAULT_KEYBINDS.Up).not.toContain('Space');
    expect(DEFAULT_KEYBINDS.Jump).toEqual(['Space']);
    expect(DEFAULT_KEYBINDS.Jump).not.toContain('KeyW');
    expect(DEFAULT_KEYBINDS.Jump).not.toContain('ArrowUp');
  });

  it('按 W：Up 电平真、Jump 电平假（W 不触发跳轴——主诉a 输入层判别）', () => {
    dispatchWin('keydown', keyEv('KeyW'));
    expect(inp.downAction('Up')).toBe(true);
    expect(inp.downAction('Jump')).toBe(false);   // ★修前病灶根部：并键面下此值为 true
  });

  it('持 W 再按 Space：Jump 电平【上升为真】且 Up 不受扰（主诉b 输入层判别——两轴互不挤占）', () => {
    dispatchWin('keydown', keyEv('KeyW'));
    expect(inp.downAction('Jump')).toBe(false);
    dispatchWin('keydown', keyEv('Space'));
    expect(inp.downAction('Jump')).toBe(true);    // 空格沿不受 W 持住影响
    expect(inp.downAction('Up')).toBe(true);
    dispatchWin('keyup', { code: 'Space' });
    expect(inp.downAction('Jump')).toBe(false);
    expect(inp.downAction('Up')).toBe(true);      // 松空格不拔 W
  });

  it('箭头↑ 同 Up 轴（KeyboardUI 档 W+↑ 双绑定,同不入 Jump）', () => {
    dispatchWin('keydown', keyEv('ArrowUp'));
    expect(inp.downAction('Up')).toBe(true);
    expect(inp.downAction('Jump')).toBe(false);
  });
});

// ===================== ② 合成结构锁（Game.ts:10636 根部） =====================
describe('BJ737-A② inputJump 合成结构锁（Game.ts 输入合成=TriggersSet.cs:790 单键面）', () => {
  it('S5 Game.ts 合成行=Jump 单键面（并键面退役;M1 变异位）', () => {
    expect(SRC('core/Game.ts')).toContain('player.inputJump = inp.downAction(\'Jump\');');
    // 并键面死灰复燃判别（整串出现在合成行语境即红——M1 恢复 `|| inp.downAction('Up')`）
    expect(SRC('core/Game.ts')).not.toContain('inp.downAction(\'Jump\') || inp.downAction(\'Up\')');
  });

  it('S6 Player.ts 三结构位：jumpOnlyHeld 精确 / 攀爬臂 inputUp / :26481 跳离臂（M2/M3/M4 变异位）', () => {
    expect(SRC('entities/Player.ts')).toContain('const jumpOnlyHeld = this.inputJump;');
    expect(SRC('entities/Player.ts')).toMatch(/ropeClimbVy\(flag15 = true\): void \{\s*\n\s*if \(this\.inputUp && flag15\) \{/);
    expect(SRC('entities/Player.ts')).toContain('this.vy = -jsRope;              // velocity.Y = -jumpSpeed（:26485）');
  });
});

// ===================== ③ Player 行为锁（键面分离语义,issue 两主诉判别） =====================
describe('BJ737-A③ 行为锁（W 不跳 / W+Space 跳 / 绳上 W 爬 Space 跳离）', () => {
  /** 落地稳态夹具：地表 row 40 上空投,无键 settle 到 vy=0（onGround） */
  const settledPlayer = (w: World): Player => {
    const p = new Player(40 * TILE, 36 * TILE, new Inventory());
    p.hp = 500;
    for (let i = 0; i < 30 && (p.vy !== 0 || i < 3); i++) tick(p, w);
    expect(p.vy).toBe(0);                      // 稳态自证（落地碰撞清零）
    return p;
  };

  it('S7 平地持 W 十拍：vy 恒 0、jumpHold 恒 0（W 不起跳——主诉a 行为判别）', () => {
    const w = flatWorld();
    const p = settledPlayer(w);
    p.inputUp = true;                          // W 电平（inputJump 恒 false）
    for (let i = 0; i < 10; i++) {
      tick(p, w);
      expect(p.jumpHold).toBe(0);
      expect(p.vy).toBe(0);
    }
  });

  it('S8 持 W 一拍后按空格：起跳（vy<0 ∧ jumpHold>0）——主诉b 行为判别（修前=游戏层并键面吞沿跳不起）', () => {
    const w = flatWorld();
    const p = settledPlayer(w);
    p.inputUp = true;                          // 先按住 W
    tick(p, w);
    expect(p.vy).toBe(0);                      // W 拍不跳
    expect(p.jumpHold).toBe(0);
    p.inputJump = true;                        // 再按空格（W 仍持住）
    tick(p, w);
    expect(p.vy).toBeLessThan(0);              // ★起跳成立
    expect(p.jumpHold).toBeGreaterThan(0);
  });

  it('S9 绳上持 W：攀爬（vy<0 且 pulley 保持 true;:26531 controlUp&flag15——M2 变异位）', () => {
    const w = ropeWorld();
    const p = new Player(ROPE_COL * TILE + 8 - 10, 24 * TILE + 8, new Inventory());
    p.hp = 500;
    p.inputUp = true;                          // 仅 W（Space 并设=findPulley 拒抓）
    tick(p, w);
    expect(p.pulley).toBe(true);               // 抓绳（inputUp 臂）
    for (let i = 0; i < 20; i++) tick(p, w);   // 持 W 攀爬
    expect(p.pulley).toBe(true);
    expect(p.vy).toBeLessThan(0);
    expect(p.y).toBeLessThan(24 * TILE + 8);   // 已上移
  });

  it('S10 绳上按 Space：跳离（pulley=false + vy=-jumpSpeed + jumpHold=jumpHeight;:26481-26486——M3 变异位）', () => {
    const w = ropeWorld();
    const p = new Player(ROPE_COL * TILE + 8 - 10, 24 * TILE + 8, new Inventory());
    p.hp = 500;
    p.inputUp = true;
    tick(p, w);
    expect(p.pulley).toBe(true);
    p.inputUp = false;
    p.vy = 0;                                  // 清抓绳拍攀爬起步（静挂稳态,T10 夹具同法）
    p.y = 24 * TILE + 8;
    p.inputJump = true;                        // 空格按下
    tick(p, w);
    expect(p.pulley).toBe(false);              // ★跳离臂
    expect(p.vy).toBeLessThan(-4);             // -jumpSpeed（裸装 5.01 族,非攀爬 -0.2 档）
    expect(p.vy).toBeGreaterThanOrEqual(-6.6); // 跳速档上界（jumpBoost 6.51 以下）
    expect(p.jumpHold).toBeGreaterThan(10);    // jump=jumpHeight（15 族）
  });

  it('S11 绳上 W+Space 同按：跳离独占（:26481 先于 :26502 第二 if(pulley) 垂直链=攀爬不跑）', () => {
    const w = ropeWorld();
    const p = new Player(ROPE_COL * TILE + 8 - 10, 24 * TILE + 8, new Inventory());
    p.hp = 500;
    p.inputUp = true;
    tick(p, w);
    expect(p.pulley).toBe(true);
    p.inputJump = true;                        // W 持住中按空格
    tick(p, w);
    expect(p.pulley).toBe(false);              // 跳离胜出（非攀爬）
    expect(p.vy).toBeLessThan(-4);
  });

  it('S12 findPulley 门（:26320 !controlJump）：持 Space 不抓绳（W 同按也不抓）——M4 变异位', () => {
    const w = ropeWorld();
    const p = new Player(ROPE_COL * TILE + 8 - 10, 20 * TILE, new Inventory());   // 空中贴绳柱
    p.hp = 500;
    p.inputUp = true;
    p.inputJump = true;                        // Space+W 同按
    for (let t = 0; t < 10; t++) tick(p, w);
    expect(p.pulley).toBe(false);              // 持跳整门禁抓（原版同判;旧合并键面=W 主导可抓）
  });

  it('S13 空中持 W 下落经过绳柱：抓绳可达（inputUp 抓绳臂不受本刀影响）', () => {
    const w = ropeWorld();
    const p = new Player(ROPE_COL * TILE + 8 - 10, 14 * TILE, new Inventory());   // 绳柱顶上方
    p.hp = 500;
    p.inputUp = true;
    let grabbed = false;
    for (let t = 0; t < 40 && !grabbed; t++) { tick(p, w); grabbed = p.pulley; }
    expect(grabbed).toBe(true);
  });
});

// ===================== ④ 变异恰红（withMutation 三层守卫+sha256 对拍） =====================
describe.skipIf(process.env.SW_BJ737A_MUT)('BJ737-A④ 变异自证（四发恰红+逐字节还原 sha256）', () => {
  const spawnVitest = (filter: string) => spawnSync(
    'npx', ['vitest', 'run', 'tests/bj737a-w-jump-keyface.test.ts', '--no-file-parallelism', '-t', filter], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 600_000,
      env: { ...process.env, SW_BJ737A_MUT: '1' },
    });

  const mutate = (file: string, trigger: string, replacement: string, filter: string): void => {
    let pristineSha = '';
    withMutation(file, trigger, replacement, () => {
      const r = spawnVitest(filter);
      expect(r.status, `变异须证红: ${filter}`).not.toBe(0);
      expect(r.stdout).toContain(filter);
    }, {
      label: `BJ737A ${filter}`,
      onPristine: (p) => { pristineSha = createHash('sha256').update(p).digest('hex'); },
    });
    lockTargetFile(file, `BJ737A 还原对拍 ${filter}`);
    try {
      const post = createHash('sha256').update(readFileSync(file)).digest('hex');
      expect(post, `还原对拍 ${file}`).toBe(pristineSha);
    } finally {
      unlockTargetFile(file);
    }
  };

  it('M1 Game.ts 恢复并键面（W 重入 inputJump） → ②S5 结构锁红', () => {
    mutate(GT,
      'player.inputJump = inp.downAction(\'Jump\');',
      'player.inputJump = inp.downAction(\'Jump\') || inp.downAction(\'Up\');',
      'BJ737-A②');
  });

  it('M2 攀爬臂 inputUp→inputJump（空格攀绳旧偏差回归） → ③S9 红', () => {
    mutate(PT,
      'if (this.inputUp && flag15) {\n      if (this.vy > 0) this.vy *= 0.7;',
      'if (this.inputJump && flag15) {\n      if (this.vy > 0) this.vy *= 0.7;',
      'S9 绳上持 W');
  });

  it('M3 跳离臂闭死 → ③S10 红（Space 在绳上无动作=旧缺臂相）', () => {
    mutate(PT,
      'if (this.inputJump) {\n        this.pulley = false;\n        const jbRope = this.jumpBaseSnapshot(this.vx);',
      'if (false && this.inputJump) {\n        this.pulley = false;\n        const jbRope = this.jumpBaseSnapshot(this.vx);',
      'S10 绳上按 Space');
  });

  it('M4 jumpOnlyHeld 加回 !inputUp 项（W+Space 可抓绳旧差异复活） → ②S6 结构锁红', () => {
    // ★行为面注：M4 的抓绳差异被 :26481 跳离臂净效掩蔽（W+Space=「当拍抓+当拍跳离」
    //   与「永不抓」在 tick 粒度等价——唯 pulleySnap 的 X 吸附/gfxOffY 瞬态残留可判,
    //   过窄不立锁）;结构位由 ②S6 承载（jumpOnlyHeld 精确定义行）。
    mutate(PT,
      'const jumpOnlyHeld = this.inputJump;   // ≙ controlJump（BJ737-A 起 Space 单键面=精确定义）',
      'const jumpOnlyHeld = this.inputJump && !this.inputUp;   // BJ737A-M4',
      'S6 Player.ts');
  });
});
