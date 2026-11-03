// ★issue#45（2026-11-03 用户实报,线上爆栈停机）：方块变化落在矿车轨道 3×3 邻域
//  → checkDecorSquareFrame → checkFurnitureSupport → frameTrack → writeFrames
//  → setTile → listeners → 回到 checkDecorSquareFrame 无限递归 → RangeError
//  → 帧循环熔断（Game.ts 帧循环 catch 停机）。
//
// 机制定谳（本仓 d8601f2 亲读）：
//  · writeFrames（MinecartTrack.ts:282-285）无条件 st.setTile 回写帧——保持
//    type/active 不变、只改 frameX/frameY;
//  · TileStore.setTile（:406）不做新旧值比较,同值写入照常派发 listeners;
//  · checkDecorSquareFrame（Game.ts:51139）3×3 扫含中心格,候选集自 BJ752-A 起
//    并入 VANILLA_TILE_FRAME_IMPORTANT（含 314）→ 轨道格进入 checkFurnitureSupport
//    → 其内建 314 早退分支 frameTrack(…,false) → 闭环。
//  原版同语义面：TileFrame 对 314 的唯一派发 = Minecart.FrameTrack
//  （WorldGen.cs:86569-86572）,而 FrameTrack 写帧是**裸字段写**（Main.tile[…]
//  .frameX = …）,不经任何「方块变化」事件——原版根本不存在帧写回重新触发
//  TileFrame 的通路。本仓把「帧写」与「方块写」混用同一 setTile 派发面 = 病灶。
//
// 修法（本刀）：帧写改走 TileStore.setTileFrame —— 只写 frameX/frameY,派发
//  cause='frame'（渲染/流体/光照/联机同步照常收到;幸存链与沙检的 cause 门
//  天然排除）。语义 =「帧变化不是方块类型变化」,与 vanilla 裸字段写等价,
//  且保留 SW 需要的渲染重烘与联机帧同步。
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { World } from '../src/world/World';
import { Game } from '../src/core/Game';
import { TILE_BY_KEY } from '../src/data/tiles';
import { TileStore } from '../src/world/TileStore';
import { frameTrack, placeTrack } from '../src/world/MinecartTrack';
import { withMutation } from './mutation-guard';

const TRACK_SRC = join(process.cwd(), 'src', 'world', 'MinecartTrack.ts');
const STORE_SRC = join(process.cwd(), 'src', 'world', 'TileStore.ts');

const TRACK = TILE_BY_KEY['v_314_minecart_track'];
expect(TRACK, 'v_314_minecart_track 应注册').toBeGreaterThanOrEqual(0);
const STONE = TILE_BY_KEY['stone'];
expect(STONE, 'stone 应注册').toBeGreaterThanOrEqual(0);

/** Game 壳（与 tests/bj752a-support-chain.test.ts mkShell 同式）：只装配幸存链
 *  两监听（与 afterWorldLoad 同一 wireSurvivalChainListeners=成因门单点）,
 *  其余字段取 checkFurnitureSupport/checkDecorSquareFrame 轨道面所需最小集。 */
function mkShell(w: World) {
  const g = Object.create(Game.prototype) as unknown as Record<string, unknown> & {
    checkFurnitureSupport: (x: number, y: number) => void;
    checkDecorSquareFrame: (x: number, y: number) => void;
    wireSurvival: () => void;
  };
  g.world = w;
  g.chunks = { markDirtyArea: () => {} };
  g.spawnParticles = () => {};
  g.sfx = { play: () => {}, playWavFile: () => {} };
  g.spawnDrop = () => null;
  g.entities = { add: () => {}, drops: [], enemies: [], critters: [] };
  g.player = { cx: 0, cy: 0, equipStats: {} };
  g.recLog = () => {};
  g.killTileDropBait = () => {};
  g.dumpChest = () => {};
  g.achievements = { notifyTileDestroyed: () => {}, handleMining: () => {} };
  g.trackTile = TRACK;
  g.scene = null;
  g.leashed = { netIdsAt: () => [], removeAt: () => {} };
  g.net = null;
  g.wireSurvival = () => {
    (g as unknown as { wireSurvivalChainListeners(s: unknown): void })
      .wireSurvivalChainListeners(w.store);
  };
  return g;
}

/** 平轨长条 x0..x1 @ y（放置链=WorldGen.PlaceTile case 314 → PlaceTrack + 邻接重定型）。
 *  夹具要求：监听器装配前的帧必须是**收敛稳态**（逐格放置后统一 settle 两遍），
 *  否则「变化前快照」会带着半程放置的陈旧帧,与对照组不可比（构造伪红）。 */
function layRun(st: TileStore, x0: number, x1: number, y: number): void {
  for (let x = x0; x <= x1; x++) placeTrack(st, x, y, 0);
  for (let pass = 0; pass < 2; pass++) for (let x = x0; x <= x1; x++) frameTrack(st, x, y, false);
}

function framesOf(st: TileStore, x: number, y: number): [number, number] {
  const i = st.idx(x, y);
  return [st.frameX[i], st.frameY[i]];
}

describe('issue#45：轨道 3×3 邻域方块变化不得自我派发成环', () => {
  it('正例：在轨道斜上方放一格轨道（帧必变）→ 不抛 RangeError,且帧与静默直算一致', () => {
    const w = new World(40, 40, 7, 'issue45');
    const g = mkShell(w);
    const st = w.store;
    layRun(st, 10, 16, 20);
    g.wireSurvival();

    // 斜上方追加一格轨道：nearbyMask 改变 → 邻格 (10,20)/(12,20) 需重定帧
    expect(() => placeTrack(st, 11, 19, 0)).not.toThrow();
    frameTrack(st, 11, 19, false);

    // 对照组：同一初始布局在静默 store 上直算终态
    const ctrl = new TileStore(40, 40);
    for (let x = 10; x <= 16; x++) placeTrack(ctrl, x, 20, 0);
    placeTrack(ctrl, 11, 19, 0);
    for (let x = 10; x <= 16; x++) frameTrack(ctrl, x, 20, false);
    frameTrack(ctrl, 11, 19, false);
    for (let x = 10; x <= 16; x++) expect(framesOf(st, x, 20)).toEqual(framesOf(ctrl, x, 20));
    expect(framesOf(st, 11, 19)).toEqual(framesOf(ctrl, 11, 19));
  });

  it('正例：挖掉轨道 3×3 内的支撑石 → 不爆栈,轨道不被拆（FrameTrack 无失撑支）', () => {
    const w = new World(40, 40, 11, 'issue45');
    const g = mkShell(w);
    const st = w.store;
    // 轨道下方铺石（模拟真实世界）
    for (let x = 10; x <= 16; x++) st.setTileSilent(x, 21, STONE);
    layRun(st, 10, 16, 20);
    g.wireSurvival();

    const before = [10, 11, 12, 13, 14, 15, 16].map((x) => framesOf(st, x, 20));
    expect(() => st.setTile(13, 21, 0)).not.toThrow();   // 挖支撑石（3×3 中心）
    for (let k = 0; k < 7; k++) expect(st.get(10 + k, 20)).toBe(TRACK);   // 不拆轨（SW-BJ30）
    // 平轨长条掩码未变 → 帧不变
    expect([10, 11, 12, 13, 14, 15, 16].map((x) => framesOf(st, x, 20))).toEqual(before);
  });

  it('正例：轨道正下方一格变化（(x,y-1) 家具单向臂）同样不成环', () => {
    const w = new World(40, 40, 13, 'issue45');
    const g = mkShell(w);
    const st = w.store;
    layRun(st, 10, 16, 20);
    g.wireSurvival();
    expect(() => st.setTile(13, 21, STONE)).not.toThrow();
    expect(() => st.setTile(13, 21, 0)).not.toThrow();
    for (let x = 10; x <= 16; x++) expect(st.get(x, 20)).toBe(TRACK);
  });

  it('负控：帧变化仍派发（渲染重烘/联机同步面不丢）', () => {
    const w = new World(40, 40, 17, 'issue45');
    const g = mkShell(w);
    const st = w.store;
    layRun(st, 10, 16, 20);
    g.wireSurvival();

    const hits: Array<{ x: number; y: number; cause?: string }> = [];
    st.onTileChanged((x, y, cause) => hits.push({ x, y, cause }));

    placeTrack(st, 11, 19, 0);
    frameTrack(st, 11, 19, false);
    // 帧重定格的邻格必须出现在派发里（否则画面会停在旧帧）
    expect(hits.some((h) => h.x === 10 && h.y === 20)).toBe(true);
    expect(hits.some((h) => h.x === 12 && h.y === 20)).toBe(true);
    // 帧写派发携带专用成因，幸存链/沙检的 cause 门据此排除（vanilla 裸字段写等价）
    expect(hits.some((h) => h.x === 10 && h.y === 20 && h.cause === 'frame')).toBe(true);
  });

  it('负控：幸存链不得被帧写二次进入（同格重入闸的语义等价面）', () => {
    const w = new World(40, 40, 19, 'issue45');
    const g = mkShell(w);
    const st = w.store;
    layRun(st, 10, 16, 20);
    g.wireSurvival();

    let supportCalls = 0;
    const orig = g.checkFurnitureSupport.bind(g);
    g.checkFurnitureSupport = (x: number, y: number) => { supportCalls++; orig(x, y); };

    placeTrack(st, 11, 19, 0);
    frameTrack(st, 11, 19, false);
    // 一次外部放置的 3×3 扫 ≤9 次（中心格轨道 + 8 邻）——帧写回写不得再放大这个数
    expect(supportCalls).toBeLessThanOrEqual(9);
    expect(supportCalls).toBeGreaterThan(0);
  });
});

// ===================== M. 变异恰红（withMutation） =====================
// ★D-BJ755-4 判例：过滤串=「目标测试名独有片段 + 零正则元字符」（vitest -t 是正则;
// 含 +/*/() 等元字符会整串 skip→exit 0 假绿;与 M 测试自身名碰撞会子进程重入）。
describe.skipIf(process.env.SW_ISSUE45_MUT)('issue#45 变异恰红', () => {
  const spawnVitest = (filter: string) => spawnSync(
    'npx', ['vitest', 'run', 'tests/issue45-track-frame-recursion.test.ts', '--no-file-parallelism', '-t', filter], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 300_000,
      env: { ...process.env, SW_ISSUE45_MUT: '1' },
    });
  const mutate = (file: string, trigger: string, replacement: string, filter: string): void => {
    withMutation(file, trigger, replacement, () => {
      const r = spawnVitest(filter);
      expect(r.status, `变异须证红: ${filter}`).not.toBe(0);
      expect(r.stdout).toContain(filter);
    }, { label: `issue45 ${filter}` });
  };

  it('M1 帧写退回 setTile → 爆栈复辟（全部正例红）', () => {
    mutate(
      TRACK_SRC,
      'function writeFrames(st: TileStore, i: number, j: number, front: number, back: number): void {\n  st.setTileFrame(i, j, front, back < 0 ? 0xFFFF : back);\n}',
      'function writeFrames(st: TileStore, i: number, j: number, front: number, back: number): void {\n  const idx = st.idx(i, j); // ★issue45 M1 变异：帧写退回方块写派发面\n  st.setTile(i, j, st.type[idx], front, back < 0 ? 0xFFFF : back);\n}',
      '斜上方放一格轨道',
    );
  });

  it('M2 帧写成因降级为 tile → 幸存链二次进入复辟', () => {
    mutate(
      STORE_SRC,
      "if (!this.suppressListeners) this.listeners.forEach((fn) => fn(x, y, 'frame'));",
      "if (!this.suppressListeners) this.listeners.forEach((fn) => fn(x, y, 'tile')); // ★issue45 M2 变异",
      '幸存链不得被帧写二次进入',
    );
  });

  it('M3 帧写成因置 undefined（旧签名视同 tile）→ 同样复辟（证明 cause 是承重面）', () => {
    mutate(
      STORE_SRC,
      "if (!this.suppressListeners) this.listeners.forEach((fn) => fn(x, y, 'frame'));",
      "if (!this.suppressListeners) this.listeners.forEach((fn) => fn(x, y, undefined)); // ★issue45 M3 变异",
      '幸存链不得被帧写二次进入',
    );
  });

  it('M4 帧写不派发（渲染/联机面丢失）→ 负控红', () => {
    mutate(
      STORE_SRC,
      "if (!this.suppressListeners) this.listeners.forEach((fn) => fn(x, y, 'frame'));",
      "// ★issue45 M4 变异：帧写静默（不复派发）",
      '帧变化仍派发',
    );
  });
});
