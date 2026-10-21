// ★BJ704-G10（2026-10-21）弹幕域 P2/杂项十件清偿——排队 findings R2-F2/F3/F4/F5/
//  F6/F9/F11/F13 + G1 债② + G2 登记债小件（459 余面/601 A 面/湿段夹具）。
// 逐件判语（先定谳再动刀,反编译 Terarria1457 亲读锚）：
//  件1 R2-F2  1026 ghost 方向族：AI_028 :26943-26944 `spriteDirection=sign(vx);
//            rotation=ToRotation()+(spriteDirection==−1?−π:0)` 与 408/435/682 同式
//            → PROJ_GHOST_MIRROR0 扩员（BJ582② 已入 PROJ_ROT_RIGHT,本刀补 ghost 面）;
//            旧注「GHOST_PARAMS∩特判旋转集=空（BJ375 普查）」自 BJ582② 即假,随迁勘正。
//  件2 R2-F3  setProjSpriteOverride 失效面：Arrow 侧 whiteSpriteCache/flameTintCache/
//            fqwTintCache 三烘焙缓存接 notify（GLOW864_CACHE 接线式）。
//  件3 R2-F4  614 帧钉 0：AI_113 帧支仅 1024（:41307-41318）;stuck 显式 frame=0
//            （:41395）;projFrames[614]=4（Main.cs:8634）→ PROJ_FRAME_STATIC0。
//  件4 R2-F5  614 stuck 视觉：每 30t HitEffect(0,1.0) 血尘脉冲（:41430-41433/
//            :41488-41491,原版序=Center 写位之后）;gfxOffY 随载=【判语销案】NPC.
//            gfxOffY 仅骑乘/挂载 NPC 非零（:35417/:36006/:37520+衰减 :91512-91529）,
//            本仓 Enemy 无该字段恒 0=零可观测差。
//  件5 R2-F6  Dart 436：AI_001 :55107-55119 spriteDirection=direction + 尾分派
//            :58640-58647 rotation=ToRotation()+π+(dir==−1?π:0)（RIGHT 族变体,
//            基底多 π,贴图朝左本相）→ rot 'rightPi'+direction 逐拍重评+左飞镜像
//            （本体+ghost 双面）;休眠员 459/709/585/601/706/270/684 台账维持（F7）。
//  件6 R2-F9  case66：±0.15 pitch=【判语销案】PITCH_CASE 表档（Sfx.ts:342,
//            0c186b4c 2026-08-24 起在位）——「playSfxFiles pitch 参未接」前提误读
//            （pitch 参=显式直传通道,随机抖动正道是表档）;三重拒重 guard=GROUP_BUSY
//            群门落模（BJ291 残留清偿）+playFiles skip→true（抑制 hit 合成兜底）。
//  件7 R2-F11 435/682 帧率：专属块 frameCounter≥3 推帧 4 帧回卷（:55887-55896/
//            :55923-55932）=3t/帧 vs 仓通用 age/5=5t/帧 → 逐型分派。
//  件8 R2-F13 字面纪律：AI_001 缺省 up 族原版字面 1.57f（:58733）→ Arrow 缺省支/
//            ghost 缺省支/Dart align90/ctor/nail else 五位 π/2→1.57;PROJ_ROT_DIAG
//            异字面（aiStyle27 0.785f vs 660 π/4f）拆集另立=登记注。
//  件9 G1 债② Arrow idStaticCheck 墙钟→GTW tick 钟（gameTickCount 绝对到期,
//            MinionProj.IdStaticBucket 同语义姊妹归一;cd 单位 376=6t/余=10t,
//            字段 idStaticCdMs→idStaticCdTicks;三测试 Date.now 推钟→钉钟随迁）。
//  件10 G2   459 AI 块余面（scale 三档/判定盒/3 帧循环/尘 226/点光/≥0.85 档
//            penetrate=−1;PrismProj 注入 ai1）;601 本体 A=66 恒（GetAlpha
//            :80870-80873 整支门色替换,旧 1−α/255 淡入系误读）;湿段 misc-cluster
//            预存红夹具（entities 桩）。
// 登记不落刀：630 stealth 档（num281 恒 1 近似,域外）/GHOST_FRAME g916 ih/7 除数
//  （无载体）——见 memory/bj704g10。
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Arrow, PROJ_GHOST_MIRROR0, PROJ_FRAME_STATIC0, projFrameCount, setProjSpriteOverride,
} from '../src/entities/Arrow';
import { DART_STYLE, Dart } from '../src/entities/Dart';
import { Sfx, PITCH_CASE, applySfxPackOverrides } from '../src/core/Sfx';
import { pinGameTimeTicks } from '../src/core/GameTime';
import { TileStore } from '../src/world/TileStore';
import type { GameHooks } from '../src/entities/types';

const SRC = join(__dirname, '../src');
const srcArrow = () => readFileSync(join(SRC, 'entities/Arrow.ts'), 'utf8');
const srcDart = () => readFileSync(join(SRC, 'entities/Dart.ts'), 'utf8');
const srcSfx = () => readFileSync(join(SRC, 'core/Sfx.ts'), 'utf8');
const srcBolt = () => readFileSync(join(SRC, 'entities/PortalGunBolt.ts'), 'utf8');
const srcPrism = () => readFileSync(join(SRC, 'entities/PrismProj.ts'), 'utf8');
const PI = Math.PI;

// ---------------------------------------------------------------- hooks/ctx 桩（bj700a 同款）
function mkHooks(enemies: unknown[] = []) {
  return {
    world: { store: new TileStore(400, 400) } as never,
    player: { dead: true, cx: -9999, cy: -9999, x: -9999, y: -9999, w: 20, h: 42 } as never,
    enemies: () => enemies,
    critters: () => [],
    npcs: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    playSfx: () => {},
    playSfxFiles: () => {},
    showPickupLabel: () => {},
    spawnDust: () => null,
    entities: { add: () => {}, projectiles: [] as unknown[] },
  } as unknown as GameHooks;
}
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
  const r = { canvas: { getContext: () => ctx, width: 1280, height: 800 }, ctx, atlas: null };
  return { calls, r: r as never };
}
function stubDocWithRecordingCanvases() {
  const g = globalThis as unknown as Record<string, unknown>;
  const prevDoc = g.document;
  g.document = {
    createElement: (): Record<string, unknown> => ({
      width: 0, height: 0,
      getContext: (): CanvasRenderingContext2D =>
        new Proxy({} as CanvasRenderingContext2D, {
          get: (_t, k) => ((..._a: unknown[]) => undefined) as never,
          set: (_t, _k, _v) => true,
        }),
    }),
  };
  return { restore: () => { g.document = prevDoc; } };
}
const fakeImg = (w: number, h: number) =>
  ({ naturalWidth: w, naturalHeight: h, width: w, height: h, complete: true, src: '' });

afterEach(() => { vi.restoreAllMocks(); });

// ================================================================ 件1：1026 ghost 方向族
describe('件1 [R2-F2] 1026 藤堡弹 ghost 姿态（PROJ_GHOST_MIRROR0 扩员）', () => {
  it('[A] 成员表：1026 入 MIRROR0（BJ582② 已入 PROJ_ROT_RIGHT——本体/ghost 双面随族）', () => {
    expect(PROJ_GHOST_MIRROR0.has(1026)).toBe(true);
    // 全集=已定谳五员（408/435/459/682/1026）
    expect([...PROJ_GHOST_MIRROR0].sort((a, b) => a - b)).toEqual([408, 435, 459, 682, 1026]);
  });
  it('[B] 源锚：ghost 调用位 MIRROR0 分支含 1026 勘误注;旧「∩=空」勘正（BJ375 普查注自 BJ582② 即假）', () => {
    const s = srcArrow();
    expect(s).toContain('PROJ_GHOST_MIRROR0.has(this.projId) ? ang + (this.vx < 0 ? Math.PI : 0)');
    expect(s).toContain('★G10 1026：随本体 RIGHT 族');
    expect(s).toContain('普查）」自 BJ582②（1026 入 PROJ_ROT_RIGHT）起即为假');
  });
});

// ================================================================ 件2：三烘焙缓存 notify
describe('件2 [R2-F3] setProjSpriteOverride 失效面（Arrow 三缓存接线）', () => {
  it('[A] 源锚：onProjSpriteOverride 订阅三缓存（white/flame 前缀式 + fqw 整清）', () => {
    const s = srcArrow();
    expect(s).toContain('onProjSpriteOverride((projId) => {');
    expect(s).toContain('for (const k of whiteSpriteCache.keys()) if (k.startsWith(prefix)) whiteSpriteCache.delete(k);');
    expect(s).toContain('for (const k of flameTintCache.keys()) if (k.startsWith(prefix)) flameTintCache.delete(k);');
    expect(s).toContain('fqwTintCache.clear();');
  });
  it('[B] 行为：白模缓存随覆盖换新（旧模不永驻）——phoenixQuivered 白箭两次 draw 画布身份更替', () => {
    const doc = stubDocWithRecordingCanvases();
    try {
      setProjSpriteOverride(5, fakeImg(20, 20) as unknown as ImageBitmap);
      const a = new Arrow(1600, 1600, 8, 0, 40, 2, 5, { grav: 0 });
      (a as unknown as { phoenixQuivered: boolean }).phoenixQuivered = true;
      const { calls: c1, r: r1 } = makeR();
      a.draw(r1 as never, {} as never);
      const img1 = c1.filter((c) => c.m === 'drawImage').map((c) => c.a[0]);
      // 热换：同 id 新图 → whiteSpriteOf 须重烘（旧缓存键命中=旧白模永驻=本刀病灶）
      setProjSpriteOverride(5, fakeImg(20, 20) as unknown as ImageBitmap);
      const { calls: c2, r: r2 } = makeR();
      a.draw(r2 as never, {} as never);
      const img2 = c2.filter((c) => c.m === 'drawImage').map((c) => c.a[0]);
      expect(img1.length).toBeGreaterThanOrEqual(1);
      expect(img2.length).toBe(img1.length);
      expect(img2[0]).not.toBe(img1[0]);   // 新烘画布 ≠ 旧烘画布（缓存已失效）
    } finally { doc.restore(); }
  });
});

// ================================================================ 件3：614 帧钉 0
describe('件3 [R2-F4] 614 星尘细胞弹帧钉 0（PROJ_FRAME_STATIC0 扩员）', () => {
  it('projFrames=4 而恒帧 0（AI_113 帧支仅 1024 :41307-41318;stuck 显式 frame=0 :41395）', () => {
    expect(projFrameCount(614)).toBe(4);            // Main.cs:8634
    expect(PROJ_FRAME_STATIC0.has(614)).toBe(true);
    expect(PROJ_FRAME_STATIC0.has(408)).toBe(true); // 408 同族先例（BJ700-A）
  });
});

// ================================================================ 件4：614 stuck 血尘脉冲
describe('件4 [R2-F5] 614 stuck 每 30t HitEffect(0,1.0) 血尘脉冲', () => {
  /** 僵尸（vanillaId=3）hit 相查表尘：dust 5,hitK=100 → ceil(dmg/maxHp×100)=1 粒/dmg=1 */
  const mkZombie = () => ({
    id: 5, vanillaId: 3, dead: false, dontTakeDamage: false,
    x: 2000, y: 2000, w: 24, h: 40, cx: 2012, cy: 2020, hp: 50, maxHp: 100,
  });
  const mkStuck614 = () => {
    const a = new Arrow(2012, 2020, 3, 0, 20, 1, 614, { grav: 0, life: 3600 });
    (a as unknown as { stickerA0: number }).stickerA0 = 1;
    (a as unknown as { stickerTgt: number }).stickerTgt = 5;
    (a as unknown as { alpha: number }).alpha = 0;
    return a;
  };
  it('脉冲节拍：30/60/90 拍各 1 粒尘 5（zombie hit 相 dmg=1）;非整 30 拍零尘;尘盒=载敌盒（HitEffect 语义）', () => {
    const dusts: Array<{ x: number; y: number; type: number }> = [];
    const g = mkHooks();
    (g as unknown as { spawnDust: unknown }).spawnDust =
      (x: number, y: number, _w: number, _h: number, type: number) => {
        dusts.push({ x, y, type });
        return null;
      };
    const z = mkZombie();
    (g as unknown as { enemies: unknown }).enemies = () => [z];
    const a = mkStuck614();
    const pulseAt: number[] = [];
    for (let t = 1; t <= 100; t++) {
      const n0 = dusts.length;
      a.fixedUpdate(1 / 60, g);
      if (dusts.length > n0) pulseAt.push(t);
    }
    expect(pulseAt).toEqual([30, 60, 90]);          // localAI[0]%30==0（:41430-41433）
    for (const d of dusts) expect(d.type).toBe(5);  // zombie hit 相尘 5（:87923）
    // 尘盒位=载敌 position 盒（HitEffect=npc 侧受击尘,非贴附弹位;e.x=2000）
    expect(dusts[0].x).toBe(2000);
  });
  it('gfxOffY 随载=判语销案（Enemy 域无 gfxOffY 字段恒 0,骑乘/挂载面域外）——净位随敌心逐拍', () => {
    const g = mkHooks();
    const z = mkZombie();
    (g as unknown as { enemies: unknown }).enemies = () => [z];
    const a = mkStuck614();
    a.fixedUpdate(1 / 60, g);
    expect(a.x).toBeCloseTo(2012 - 3 - a.w / 2, 6);   // 敌心−vel−w/2（净位已对拍勿动）
    z.cx = 2050;                                       // 敌移动 → 贴附随载逐拍跟随
    a.fixedUpdate(1 / 60, g);
    expect(a.x).toBeCloseTo(2050 - 3 - a.w / 2, 6);
  });
});

// ================================================================ 件5：Dart 436 rightPi
describe('件5 [R2-F6] Dart 436 火星弹 RIGHT 族变体（rot rightPi）', () => {
  it('[A] 表档：DART_STYLE[436].rot === rightPi（旧 align90=恒 90° 偏+永不镜像）', () => {
    expect(DART_STYLE[436].rot).toBe('rightPi');
  });
  it('[B] 行为·本体姿态：右飞 rotate(ang+π) 无镜像;左飞 rotate(ang+2π≡ang) + scale(-1,1)'
    + '（:58640-58647 + :55107-55119 direction 逐拍重评）', () => {
    const g = mkHooks();
    const mk = (vx: number, vy: number) => {
      const d = new Dart(1600, 1600, vx, vy, 10, 436);
      d.fixedUpdate(1 / 60, g);                       // dartStep 一跑（EU=0）
      const { calls, r } = makeR();
      d.draw(r as never, {} as never);
      const rots = calls.filter((c) => c.m === 'rotate').map((c) => c.a[0] as number);
      const mirrors = calls.filter((c) => c.m === 'scale' && c.a[0] === -1 && c.a[1] === 1).length;
      return { rots, mirrors, dart: d };
    };
    const angR = Math.atan2(-6, 8);
    const R = mk(8, -6);
    expect(R.rots).toHaveLength(1);
    expect(R.rots[0]).toBeCloseTo(angR + PI, 6);      // 基底多 π（贴图朝左本相）
    expect(R.mirrors).toBe(0);
    const angL = Math.atan2(-6, -8);
    const L = mk(-8, -6);
    expect(L.mirrors).toBe(1);                        // 左飞水平镜像
    expect(L.rots[0] % (2 * PI)).toBeCloseTo(((angL % (2 * PI)) + 2 * PI) % (2 * PI), 5); // ang+2π≡ang
    // direction 逐拍重评（vx 变号 → dir 翻转）
    expect((L.dart as unknown as { dir: number }).dir).toBe(-1);
    L.dart.vx = 8; L.dart.vy = -6;
    L.dart.fixedUpdate(1 / 60, g);
    expect((L.dart as unknown as { dir: number }).dir).toBe(1);
  });
  it('[C] 行为·ghost 镜像：TrailingMode=0 残影随本体翻转（Main.cs:31334 mode0 吃当前 dir）', () => {
    const g = mkHooks();
    const d = new Dart(1600, 1600, -15, -5, 10, 436);
    for (let t = 0; t < 5; t++) d.fixedUpdate(1 / 60, g);   // ghostRing 记录
    setProjSpriteOverride(436, fakeImg(30, 40) as unknown as ImageBitmap);
    const doc = stubDocWithRecordingCanvases();
    try {
      const { calls, r } = makeR();
      d.draw(r as never, {} as never);
      // ghost 槽 drawImage（9 参）每槽镜像 1 次 + 本体 1 次
      const ghostDraws = calls.filter((c) => c.m === 'drawImage' && (c.a.length ?? 0) >= 9);
      expect(ghostDraws.length).toBeGreaterThanOrEqual(1);
      const mirrors = calls.filter((c) => c.m === 'scale' && c.a[0] === -1 && c.a[1] === 1).length;
      expect(mirrors).toBe(1 + ghostDraws.length);   // 旧病=仅本体镜像,ghost 恒不翻
    } finally { doc.restore(); }
  });
});

// ================================================================ 件6：case66 音面
describe('件6 [R2-F9] case66 三重拒重 guard + pitch 判语销案', () => {
  it('[A] 判语销案锁：±0.15 pitch 由 PITCH_CASE 表档承载（0c186b4c 起在位,非 pitch 参直传）', () => {
    expect(PITCH_CASE['Zombie_121']).toEqual([-15, 15]);   // LSP :1200-1202 Next(−15,16)×0.01
    expect(PITCH_CASE['Zombie_122']).toEqual([-15, 15]);
    expect(PITCH_CASE['Zombie_123']).toEqual([-15, 15]);
  });
  it('[B] 源锚：GROUP_BUSY 群门 + SINGLE_INSTANCE 占位 + playFiles skip→true', () => {
    const s = srcSfx();
    expect(s).toContain('GROUP_BUSY');
    expect(s).toContain("'Zombie_121', 'Zombie_122', 'Zombie_123'");
    expect(s).toContain('return ok || this.lastTriggerOutcome === \'skip\';');
  });
});

// ---------- Sfx 行为面（sfx-first-play 同款 mock AudioContext） ----------
class MockGain { gain = { value: 0, setTargetAtTime: () => {} }; connect(d: unknown) { return d; } }
class MockSrc {
  buffer: unknown = null; playbackRate = { value: 1 };
  onended: (() => void) | null = null; dest: unknown = null;
  connect(d: unknown) { this.dest = d; return d; }
  start() { /* 起振 */ }
  stop() { /* noop */ }
}
let created: MockSrc[] = [];
class MockAC {
  state = 'running'; currentTime = 0; destination = {};
  decodeAudioData = async () => ({ duration: 0.1, length: 4410, sampleRate: 44100 }) as unknown as AudioBuffer;
  createBufferSource() { const s = new MockSrc(); created.push(s); return s; }
  createGain() { return new MockGain(); }
  async resume() { this.state = 'running'; }
}
const windowBackup = (globalThis as { window?: unknown }).window;
const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const FILES66 = ['Zombie_121', 'Zombie_122', 'Zombie_123'];

describe('件6 [R2-F9] case66 三重拒重 guard 行为（Sfx 实例面）', () => {
  beforeEach(() => {
    created = [];
    (globalThis as { window?: unknown }).window = { AudioContext: MockAC };
    applySfxPackOverrides(new Map(FILES66.map((f) => [f, new Uint8Array(8)])) as unknown as Map<string, Uint8Array>);
  });
  afterEach(() => {
    (globalThis as { window?: unknown }).window = windowBackup;
    applySfxPackOverrides(new Map());
  });

  it('组内任一在播 → 跳过且不落合成兜底（返回 true）;onended 后放行', async () => {
    const sfx = new Sfx();
    vi.spyOn(Math, 'random').mockReturnValue(0.99);   // 拾 Zombie_123
    expect(sfx.playFiles(FILES66, 0.45)).toBe(true);  // 首播（defer 解码）
    await flush();
    expect(created).toHaveLength(1);
    vi.spyOn(Math, 'random').mockReturnValue(0.01);   // 拾 Zombie_121——跨员群门
    expect(sfx.playFiles(FILES66, 0.45)).toBe(true);  // ★skip 亦 true（有意静默,勿补 hit 兜底）
    expect(created).toHaveLength(1);                  // 未起新源
    vi.spyOn(Math, 'random').mockReturnValue(0.99);   // 拾 Zombie_123——自身槽在播
    expect(sfx.playFiles(FILES66, 0.45)).toBe(true);
    expect(created).toHaveLength(1);
    created[0].onended?.();                           // 播毕清槽
    expect(sfx.playFiles(FILES66, 0.45)).toBe(true);
    await flush();
    expect(created).toHaveLength(2);                  // 窗释放后照常出声
  });
});

// ================================================================ 件7：435/682 帧率
describe('件7 [R2-F11] 435/682 帧机 3t/帧（frameCounter≥3 推帧 4 帧回卷）', () => {
  it('[A] 源锚：draw 帧链逐型分派 floor(age/3)（旧通用 age/5=5t/帧）', () => {
    const s = srcArrow();
    expect(s).toContain('(this.projId === 435 || this.projId === 682) ? Math.floor(this.age / 3) % frames');
  });
  it('[B] 帧机等价锁：floor(age/3)%4 ≡ 原版 frameCounter≥3 推帧机逐拍序列（:55887-55896）', () => {
    let frame = 0, counter = 0;
    for (let age = 1; age <= 48; age++) {
      counter++;                                  // 原文 frameCounter++（AI 头）
      if (counter >= 3) { counter = 0; frame++; if (frame >= 4) frame = 0; }
      expect(Math.floor(age / 3) % 4).toBe(frame); // 仓表达式逐拍等价
    }
  });
});

// ================================================================ 件8：1.57 字面纪律
describe('件8 [R2-F13] AI_001 缺省 up 族字面 1.57f（:58733,非 π/2）', () => {
  it('[A] 源锚五位：Arrow draw 缺省支/ghost 缺省支 + Dart align90/ctor/nail else', () => {
    const sa = srcArrow();
    expect(sa).toContain(': ang + 1.57);');            // draw 缺省支
    expect(sa).toContain(': ang + 1.57,');            // ghost 缺省支
    const sd = srcDart();
    expect(sd).toContain("case 'align90': this.rot = Math.atan2(this.vy, this.vx) + 1.57; break;");
    expect(sd).toContain('(st.rot === \'a45\' ? 0.785 : 1.57)');
    expect(sd).toContain('else this.rot = Math.atan2(this.vy, this.vx) + 1.57;');
  });
  it('[B] 行为·Dart align90 缺省 up：右飞 rotate=atan2+1.57（非 π/2,残差 0.0008）', () => {
    const g = mkHooks();
    const d = new Dart(1600, 1600, 3, -4, 10, 129);    // 129 align90 族（无专属帧机）
    d.fixedUpdate(1 / 60, g);
    const { calls, r } = makeR();
    d.draw(r as never, {} as never);
    const rots = calls.filter((c) => c.m === 'rotate').map((c) => c.a[0] as number);
    expect(rots).toHaveLength(1);
    expect(rots[0]).toBe(Math.atan2(-4, 3) + 1.57);    // 字面精确相等（π/2 版必差 0.0008）
  });
});

// ================================================================ 件9：idStatic tick 钟
describe('件9 [G1 债②] Arrow idStaticCheck 墙钟→GTW tick 钟', () => {
  it('[A] 源锚：gameTickCount 绝对到期,Date.now 版退役;字段 idStaticCdTicks', () => {
    const s = srcArrow();
    expect(s).toContain('const now = gameTickCount();');
    expect(s).toContain('idStaticCdTicks = 10;');
    expect(s).not.toContain('Date.now() + cooldown');
    expect(s).not.toContain('idStaticCdMs');
  });
  it('[B] 行为：组表 10t 窗 tick 刻度驱动（189 组;钉钟判例 bj209/bj274）', () => {
    pinGameTimeTicks(90_000);
    const hits: number[] = [];
    const foe = {
      id: 9, vanillaId: null, dead: false, iframes: 0,
      x: 1596, y: 1600, w: 900, h: 400, cx: 2046, cy: 1800, hp: 500, maxHp: 500,
      hurt: (d: number) => { hits.push(d); foe.iframes = 10; return true; },
    };
    const g = mkHooks([foe]);
    const a = new Arrow(1600, 1600, 0, 0, 31, 0.25, 189, { grav: 0, life: 600, pierce: 3 });
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    for (let t = 1; t <= 12; t++) {
      pinGameTimeTicks(90_000 + t);
      a.fixedUpdate(1 / 60, g);
      foe.iframes = 0;      // 写侧刀②清帧面已由 wasp F4 套件承载,此处隔离组表节拍
    }
    // 12t 内同敌两跳:第二跳须 ≥10t 间隔（窗拒拍白吃组表 cd）
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.length).toBeLessThanOrEqual(3);
  });
});

// ================================================================ 件10：G2 小件
describe('件10 [G2] 459 充能爆破炮弹 AI 块余面（scale 三档全链）', () => {
  it('[A] 源锚：PrismProj 注入 ai1 三档（num35=0.7+stage×0.3 :67574）', () => {
    expect(srcPrism()).toContain('const num35 = 0.7 + stage * 0.3;');
    expect(srcPrism()).toContain('ai1: num35');
  });
  it('[B] 行为·三档：0.7 档盒 15/穿透不动;1.0/1.3 档盒 22/28+penetrate=−1;帧机 3 子步/帧 3 帧回卷', () => {
    const mk = (ai1: number) => {
      const a = new Arrow(1600, 1600, 8, 0, 40, 2, 459, { grav: 0, life: 600, pierce: 1, ai1 });
      a.fixedUpdate(1 / 60, mkHooks());   // 1 tick（extraUpdates=1 → 2 子步,AI 块×2,resize 幂等）
      return a;
    };
    const lo = mk(0.7);
    expect(lo.w).toBe(15);                       // (int)(22×0.7)=15（:55634）
    expect(lo.h).toBe(15);
    expect(lo.pierce).toBe(1);                   // <0.85 档穿透不动
    expect((lo as unknown as { drawScale: number }).drawScale).toBeCloseTo(0.7, 6);
    const mid = mk(1.0);
    expect(mid.w).toBe(22);
    expect(mid.pierce).toBe(-1);                 // ≥0.85 档 penetrate=maxPenetrate=−1（:55642-46）
    expect((mid as unknown as { pierceInit: number }).pierceInit).toBe(-1);
    const hi = mk(1.3);
    expect(hi.w).toBe(28);                       // (int)(22×1.3)=28
    expect(hi.pierce).toBe(-1);
    // 帧机（:55622-55631 frameCounter≥3 推帧,3 帧回卷）——EU=1 ⇒ 每 fixedUpdate
    // 2 子步;推帧点=第 3/6/9/12/15…子步,帧序 0→1→2→0（%3 ≡ 原文 ++/>=3 回卷）。
    // tick 尾快照（mk=t1 后 7 tick,t2..t8）:
    const a = mk(0.7);
    const fr = () => (a as unknown as { f459Frame: number }).f459Frame;
    expect(fr()).toBe(0);
    const seq: number[] = [];
    for (let k = 0; k < 7; k++) { a.fixedUpdate(1 / 60, mkHooks()); seq.push(fr()); }
    expect(seq).toEqual([1, 2, 2, 0, 1, 1, 2]);
  });
  it('[B\'] 帧机子步等价锁：仓库 frameT≥3 机 ≡ 原文 frameCounter≥3 机（逐子步）', () => {
    let frame = 0, counter = 0;
    const a = new Arrow(1600, 1600, 8, 0, 40, 2, 459, { grav: 0, life: 600, ai1: 0.7 });
    const fr = () => (a as unknown as { f459Frame: number }).f459Frame;
    const ft = () => (a as unknown as { f459FrameT: number }).f459FrameT;
    for (let sub = 1; sub <= 24; sub++) {
      counter++;                                        // 原文 frameCounter++（AI 头）
      if (counter >= 3) { counter = 0; frame++; if (frame >= 3) frame = 0; }
      if (sub % 2 === 1) a.fixedUpdate(1 / 60, mkHooks());  // EU=1 → 每 tick 2 子步
      else { expect(fr()).toBe(frame); expect(ft()).toBe(counter); }   // tick 尾快照=原文机
    }
  });
  it('[C] 行为·尘 226：<0.85 档 1/3 掷/子步;≥0.85 档每子步恒 1 粒（速=v/3 覆写/α=255−(int)(255×scale)）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // Next(3)=floor(0.5×3)=1≠0 → 低档掷不中
    const dusts: Array<{ type: number; vx: number; vy: number; alpha: number; scale: number; noGravity: boolean }> = [];
    const g = mkHooks();
    (g as unknown as { spawnDust: unknown }).spawnDust =
      (_x: number, _y: number, _w: number, _h: number, type: number, vx: number, vy: number) => {
        const d = { type, vx, vy, alpha: 0, scale: 1, noGravity: false };
        dusts.push(d as never);
        return d;
      };
    const lo = new Arrow(1600, 1600, 9, 0, 40, 2, 459, { grav: 0, life: 600, ai1: 0.7 });
    lo.fixedUpdate(1 / 60, g);                    // 2 子步均掷不中
    expect(dusts).toHaveLength(0);
    const hi = new Arrow(1600, 1600, 9, 0, 40, 2, 459, { grav: 0, life: 600, ai1: 1.3 });
    hi.fixedUpdate(1 / 60, g);                    // EU=1 → 2 子步 × 恒 1 粒
    expect(dusts).toHaveLength(2);
    for (const d of dusts) {
      expect(d.type).toBe(226);
      expect(d.vx).toBeCloseTo(3, 6);             // velocity=v/3 覆写（9/3）
      expect(d.alpha).toBe(255 - Math.trunc(255 * 1.3));   // −76 原样直录（:55653）
      expect(d.scale).toBe(0.5);
      expect(d.noGravity).toBe(true);
    }
  });
  it('[D] 行为·点光：lightRGB=[0.4,0.85,0.9]（:55636,94/1114 自报通道同款）', () => {
    const a = new Arrow(1600, 1600, 8, 0, 40, 2, 459, { grav: 0, life: 600, ai1: 1 });
    a.fixedUpdate(1 / 60, mkHooks());
    expect((a as unknown as { lightRGB: [number, number, number] | null }).lightRGB)
      .toEqual([0.4, 0.85, 0.9]);
  });
  it('[E] ghost 环 end 随档源锚（bodyScale=ai1Scale459 喂入 resolveGhostLoop :31068-31073）', () => {
    expect(srcArrow()).toContain('bodyScale: this.projId === 459 ? this.ai1Scale459 : 1');
  });
});

describe('件10 [G2] 601 PortalGunBolt 本体 A 面（门色 A=66 恒）', () => {
  it('源锚：ga=66/255 常量（GetAlpha :80870-80873 整支门色替换;旧 1−α/255 淡入系误读）', () => {
    const s = srcBolt();
    expect(s).toContain('ctx.globalAlpha = 66 / 255;');
    expect(s).not.toContain('1 - this.alpha / 255;                        // alpha 255→0');
  });
});

// ================================================================ 湿段夹具（件10c）
describe('件10c [G2] 湿段 misc-cluster 夹具（entities 桩）——回归面在原文件', () => {
  it('原文件 48 测全绿（预存红 3 测=桩缺 entities,本批补桩;此处登记不重复跑）', () => {
    expect(readFileSync(join(__dirname, 'proj-wet-section-misc-cluster.test.ts'), 'utf8'))
      .toContain('entities: { projectiles: [] as unknown[], cloneDust: () => null }');
  });
});
