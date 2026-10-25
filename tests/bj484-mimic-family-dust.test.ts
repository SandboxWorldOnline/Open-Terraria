// BJ484（2026-10-03）宝箱怪族同构支 341/473-476 尘档接线（BJ479 批6 滚动清单出清）。
//
// 定谳（Terarria1457 亲读,HitEffect 区 :82492-:90941 为 1457/1458 逐字节全等区）：
//   ① 341 PresentMimic（HitEffect :89741-:89765）——`int num718 = 196;`（:89743）
//     【常量 id 支,无 ai[3] 门】:hit=for(num719<dmg/lifeMax×50)→hitK50 尘 196+return
//     （:89746-:89750）/death=for(num720<20)→n20 尘 196（:89752-:89755）;gore 61/62/63
//     （×0.3,:89756-:89764）归 extract-gore.mjs（vanilla-gore.json 341 已备 L89756+）。
//     SetDefaults :13342-:13352（aiStyle 25,lifeMax 900,mimicAI 85/341/629 共用 BJ464;
//     :25699-25701 每 tick 强制 ai3=1——但其 HitEffect 不读 ai[3],段位与尘型无关）。
//   ② 473-476 BigMimic{Corruption,Crimson,Hallow,Jungle}（NPCID.cs:12013-12019）共支
//     （HitEffect :89799-:89829）——`int num726 = 31;`（:89801）【同构常量 id 支,无 ai[3] 门】:
//     hit=hitK50 尘 31+return（:89804-:89808）/death=n20 尘 31（:89811-:89813）;gore 同族
//     base.Center 锚（:89814+,vanilla-gore.json L89814+ 已备）。四型同表同构。
//     SetDefaults :14536-:14549（aiStyle 87,lifeMax 3500,w28 h44）。
//   ③ 实战形态专项定谳：AI_087（:37845-:38200,伪装唤醒/蓄力/跳扑/俯冲/三连扑）零
//     Dust.NewDust=激活链无尘专项;HitEffect 死亡链=尘+gore 之外无 NewNPC 等世界改写
//     （:37956 tenthAnniversary 476 ai[0]=8 系 AI 态覆盖非尘）。bigMimicAI 本仓已 1:1
//     （bossAI_lunar_misc.ts,BJ206 锚面）。→ 与 85/629 同族同形但纯数据,提取器 std 路径
//     原生表达,无需 idAi3/解释器新算子（BJ479 先例=名单接线 1 行）。
//
// 断言面：
//   A. 数据面金标——341 尘 196/473-476 尘 31 钉值（hitK50/n20+行锚）+四型同构+常量 id
//      判别（无 idAi3/idPick/idRand=非段位支,同族污染守卫）+pending 出清。
//   B. 行为锁——341 受击 ceil 簇/死亡 20 两触发面;473-476 逐型死亡恒 20×31;掷流纯度
//      （0 掷）;★跨支判别:341 ai3=3 → 尘恒 196（非 37）/473 ai3=2 → 尘恒 31（非 10）
//      ——锁「常量 id 支不读 ai[3]」;fromVanilla SetDefaults 锚（maxHp 900/3500）。
//   C. 实战形态——473 bigMimicAI 唤醒链 40t 零尘（AI_087 :37845 零 Dust.NewDust）+
//      死亡链恰 20×31 无杂尘;473-476 尘面逐型全等。
//   D. 变异自证——M1 提取器 tmp 变异体摘 BATCH6_TYPES 五型→干跑对拍漂移 exit 1+漂移
//      指名 341（名单线承重物证;真工具/现库零接触 sha256 对拍）;M2 沙箱库 json 变异
//      341 尘 196→31→判别子测试红（★BJ708-G33:SW_BJ484_MUT_JSON 重定向,活库零写窗
//      ——根治 era-guard×bj484 同池伪红;G28 判谳:活库写窗消失=race 类整体消失）。
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';

vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });   // ★残留普查波:变异自证三层守卫跨套件互斥下锁等待/内层 spawn 可超默认 5s——按仓内习语放宽（fx-codegen-parity 同款）
import { readFileSync, writeFileSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { gateConsumerMutation, lockConsumerMutation, unlockConsumerMutation } from './npcdust-mutation-mutex';
import { Enemy } from '../src/entities/Enemy';
import { World } from '../src/world/World';
import { Inventory } from '../src/items/Inventory';
import { bigMimicAI } from '../src/entities/bossAI_lunar_misc';
import npcDustJson from '../src/data/vanilla-npcdust.json';
import type { GameHooks } from '../src/entities/types';
import type { Enemy as EnemyT } from '../src/entities/Enemy';
import type { Player } from '../src/entities/Player';
import { spawnNpcHitDust, spawnNpcDeathDust } from '../src/entities/NpcHitDust';

// ★BJ708-G33:M2 变异面迁 tmp 沙箱库——活库零写窗。G28 判谳:「活库逐字节对拍」型
//   （extract-npcdust-era-guard）与「活库变异自证」型（本文件 M2 旧形态 withMutation
//   直写 vanilla-npcdust.json）同池并行必伪红（battery 稳定 3 红/单跑 8/8 绿/剔除
//   bj484 即全绿;失败 diff 现场捕获「341 dust:31」变异值=读窗落变异窗的直接物证）。
//   新形态:变异副本落 mkdtemp 沙箱,子进程经 SW_BJ484_MUT_JSON 把本表 import 重定向
//   到沙箱副本（本 mock）;缺省（父进程/全量 battery）importOriginal 直通=零行为变化。
//   证据链不变:A 金标 toEqual 精确判别 341=196 面,吃到 31 即红。
vi.mock('../src/data/vanilla-npcdust.json', async (importOriginal) => {
  const p = process.env.SW_BJ484_MUT_JSON;
  if (!p) return await importOriginal();
  const { readFileSync } = await import('node:fs');
  const parsed = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
  return { ...parsed, default: parsed };
});

const TABLE = npcDustJson as unknown as Record<string, {
  hit?: Array<Record<string, unknown>>; death?: Array<Record<string, unknown>>;
}> & { _meta: Record<string, unknown> };
const sha256 = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

type DustCall = { type: number; x: number; y: number; w: number; h: number; scale: number };

/** 解释器最小钩（341/473-476 链只消费 spawnDust+实体字段,无 world 面） */
function mkCapturingHooks(captured: DustCall[]): GameHooks {
  return {
    spawnDust: (x: number, y: number, w: number, h: number, type: number,
      sx = 0, sy = 0, alpha = 0, color = null, scale = 1) => {
      const rec: DustCall = { type, x, y, w, h, scale };
      captured.push(rec);
      return { x, y, noGravity: false, vx: sx, vy: sy, scale, fadeIn: 0, noLight: false, color };
    },
  } as unknown as GameHooks;
}

/** 解释器桩实体（341/473-476 链消费面:vanillaId/ai3/maxHp/盒位;maxHp 按 SetDefaults 钉） */
const mkMimic = (vanillaId: number, opts: { ai3?: number; maxHp: number }): EnemyT =>
  ({
    vanillaId, ai3: opts.ai3 ?? 0, hp: opts.maxHp, maxHp: opts.maxHp,
    x: 100, y: 100, w: vanillaId === 341 ? 24 : 28, h: vanillaId === 341 ? 24 : 44,
    cx: 110, cy: 115, spawnAlpha: 0, colorRGBA: null, vanillaScale: 1, vx: 0, vy: 0,
  }) as unknown as EnemyT;

/** AI 端到端夹具（bj479 mkHooks 同构：指定 groundLevel 的竖井世界+floorRow 地板） */
function mkHooks(groundLevel: number, floorRow = 300) {
  const w = new World(120, 400, 1, 'bj484');
  w.groundLevel = groundLevel;
  for (let x = 0; x < 120; x++) {
    for (let y = 0; y < floorRow; y++) w.store.setTileSilent(x, y, 0, 0, 0);
    w.store.setTileSilent(x, floorRow, 1, 0, 0);
  }
  const captured: DustCall[] = [];
  const hooks = {
    world: w, player: null,
    enemies: () => enemies, critters: () => [], projectiles: () => [],
    entities: { nextId: 1, add: () => {} },
    spawnDrop: () => null, damagePlayer: (): number => 0, addDamageNumber: () => {},
    cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
    spawnParticles: () => {},
    spawnDust: (x: number, y: number, wn: number, hn: number, type: number,
      sx = 0, sy = 0, alpha = 0, color = null, scale = 1) => {
      const rec: DustCall = { type, x, y, w: wn, h: hn, scale };
      captured.push(rec);
      return { x, y, noGravity: false, vx: sx, vy: sy, scale, fadeIn: 0, noLight: false, color };
    },
    notifyInventoryChanged: () => {}, playSfx: () => {}, playSfxFiles: () => {},
    playSfxFile: () => {}, showPickupLabel: () => {}, broadcastParticleOrchestra: () => {},
  };
  const enemies: EnemyT[] = [];
  return { hooks: hooks as unknown as GameHooks, world: w, captured };
}

/** bigMimicAI 唤醒夹具：473 立于地板+近距玩家（<80px=伪装唤醒门 :37869） */
function mkWake473(): { hooks: GameHooks; e: EnemyT; captured: DustCall[]; p: Player } {
  const { hooks, captured } = mkHooks(120);
  const e = Enemy.fromVanilla(473, 40 * 16, 250 * 16) as EnemyT;
  e.y = 300 * 16 - e.h;
  const p = {
    dead: false, x: e.cx + 10, y: e.cy - 21, w: 20, h: 42, cx: e.cx + 20, cy: e.cy,
  } as unknown as Player;
  return { hooks, e, captured, p };
}

beforeEach(() => { vi.spyOn(Math, 'random').mockImplementation(() => 0.5); });
afterEach(() => { vi.restoreAllMocks(); });

// ===================== A. 数据面金标（vanilla-npcdust.json 批6/BJ484 名单扩） =====================

describe('BJ484 A. 数据面金标', () => {
  it('341 礼物怪尘档钉值：hit=hitK50 尘 196/death=n20 尘 196（HitEffect :89741-:89765,num718=196 常量支）', () => {
    expect(TABLE['341']).toEqual({
      hit: [{ dust: 196, hitK: 50, line: 89748 }],
      death: [{ dust: 196, n: 20, line: 89754 }],
    });
  });

  it('473-476 四系大宝箱怪同构共支：尘 31/hitK50/n20 四型逐字全等（:89799-:89829,num726=31）', () => {
    const BIG = {
      hit: [{ dust: 31, hitK: 50, line: 89806 }],
      death: [{ dust: 31, n: 20, line: 89812 }],
    };
    for (const vid of ['473', '474', '475', '476']) {
      expect(TABLE[vid], vid).toEqual(BIG);
    }
  });

  it('★常量 id 支判别：五型无 idAi3/idPick/idRand（与 85/629 段位支同族不同构——HitEffect 不读 ai[3]）', () => {
    for (const vid of ['341', '473', '474', '475', '476']) {
      for (const ph of ['hit', 'death'] as const) {
        for (const el of TABLE[vid][ph] ?? []) {
          expect(el.idAi3, `${vid}.${ph}.idAi3`).toBeUndefined();
          expect(el.idPick, `${vid}.${ph}.idPick`).toBeUndefined();
          expect(el.idRand, `${vid}.${ph}.idRand`).toBeUndefined();
        }
      }
    }
  });

  it('对账复绿：batch6 声明 BJ484 扩名+pending 出清 341/473-476', () => {
    expect(TABLE._meta.batch6).toBeDefined();
    expect(String(TABLE._meta.batch6)).toContain('BJ484');
    const pend = TABLE._meta.pending as Array<{ types?: number[] }>;
    const ids = new Set(pend.flatMap((p) => p.types ?? []));
    for (const vid of [341, 473, 474, 475, 476]) expect(ids.has(vid), `pending 含 ${vid}`).toBe(false);
  });
});

// ===================== B. 行为锁（解释器消费面） =====================

describe('BJ484 B. 行为锁（341/473-476 尘链）', () => {
  it('341 受击 ceil 簇/死亡 20 两触发面：161/900×50→9 发尘 196;死亡面恒 20 发,互不串相', () => {
    const captured: DustCall[] = [];
    const e = mkMimic(341, { maxHp: 900 });   // SetDefaults :13348 lifeMax=900
    spawnNpcHitDust(e, mkCapturingHooks(captured), 1, 161);
    expect(captured).toHaveLength(9);                          // ceil(161/900×50)=ceil(8.944)=9
    expect(new Set(captured.map((c) => c.type))).toEqual(new Set([196]));
    const deathCaptured: DustCall[] = [];
    spawnNpcDeathDust(e, mkCapturingHooks(deathCaptured), 1);
    expect(deathCaptured).toHaveLength(20);                    // 死亡相=固定 n20
    expect(new Set(deathCaptured.map((c) => c.type))).toEqual(new Set([196]));
  });

  it('473-476 逐型死亡恒 20 发尘 31（四型共支同表,DeathEffect 面无型差）', () => {
    for (const vid of [473, 474, 475, 476]) {
      const captured: DustCall[] = [];
      spawnNpcDeathDust(mkMimic(vid, { maxHp: 3500 }), mkCapturingHooks(captured), 1);
      expect(captured, `vid=${vid}`).toHaveLength(20);
      expect(new Set(captured.map((c) => c.type)), `vid=${vid}`).toEqual(new Set([31]));
    }
  });

  it('473 受击 ceil 簇（maxHp 3500）：161→3 发尘 31（ceil(2.3)）', () => {
    const captured: DustCall[] = [];
    spawnNpcHitDust(mkMimic(473, { maxHp: 3500 }), mkCapturingHooks(captured), 1, 161);
    expect(captured).toHaveLength(3);
    expect(new Set(captured.map((c) => c.type))).toEqual(new Set([31]));
  });

  it('掷流纯度：341/473 尘链 0 掷（常量 id+固定计数,原版 HitEffect 该两支无 Main.rand）', () => {
    let rolls = 0;
    const orig = Math.random;
    Math.random = () => { rolls++; return 0.5; };
    try {
      const hooks = mkCapturingHooks([]);
      spawnNpcHitDust(mkMimic(341, { maxHp: 900 }), hooks, 1, 161);
      spawnNpcDeathDust(mkMimic(473, { maxHp: 3500 }), hooks, 1);
      expect(rolls).toBe(0);
    } finally {
      Math.random = orig;
    }
  });

  it('★跨支判别（同族污染守卫）：341 ai3=3 → 尘恒 196 非 37;473 ai3=2 → 尘恒 31 非 10（常量支不读 ai[3]）', () => {
    // 341 与 85/629 同族（aiStyle 25/mimicAI 恒段 1）,但其 HitEffect 支无 ai[3] 门——
    // 若误挂 idAi3 建模（85 段位表 m={2:10,3:37}）,ai3=3 会错发尘 37。
    const cap341: DustCall[] = [];
    spawnNpcDeathDust(mkMimic(341, { ai3: 3, maxHp: 900 }), mkCapturingHooks(cap341), 1);
    expect(cap341).toHaveLength(20);
    expect(new Set(cap341.map((c) => c.type))).toEqual(new Set([196]));
    // 473-476 的 ai[3] 归 AI_087 三连扑计数（:37908-:37916）,任意残值不得污染尘型
    // （若误挂 idAi3（85 段位表）,ai3=2 会错发尘 10）。
    const cap473: DustCall[] = [];
    spawnNpcDeathDust(mkMimic(473, { ai3: 2, maxHp: 3500 }), mkCapturingHooks(cap473), 1);
    expect(cap473).toHaveLength(20);
    expect(new Set(cap473.map((c) => c.type))).toEqual(new Set([31]));
  });

  it('fromVanilla SetDefaults 锚：341 maxHp=900/473 maxHp=3500（:13348/:14544,ceil 簇数分母真值）', () => {
    const e341 = Enemy.fromVanilla(341, 100, 100) as EnemyT;
    expect(e341).not.toBeNull();
    expect(e341.maxHp).toBe(900);
    const e473 = Enemy.fromVanilla(473, 100, 100) as EnemyT;
    expect(e473).not.toBeNull();
    expect(e473.maxHp).toBe(3500);
    // 真实体端到端：473 dmg=100 → ceil(100/3500×50)=2 发尘 31
    const captured: DustCall[] = [];
    spawnNpcHitDust(e473, mkCapturingHooks(captured), 1, 100);
    expect(captured).toHaveLength(2);
    expect(new Set(captured.map((c) => c.type))).toEqual(new Set([31]));
  });
});

// ===================== C. 实战形态行为锁（473-476 钥匙怪,AI_087） =====================

describe('BJ484 C. 实战形态（473-476 bigMimicAI 激活/死亡链专项定谳）', () => {
  it('473 唤醒链 40t 零尘（AI_087 :37845-:38200 零 Dust.NewDust——伪装唤醒/蓄力/跳扑无尘专项）', () => {
    const { hooks, e, captured, p } = mkWake473();
    // fromVanilla 落地 ai0=-1120（生成场值,AI_087 头段 <0→0 钳归伪装态 :37846）——
    // 首拍钳 0→近距唤醒门置 1,不预断言入场值。
    for (let i = 0; i < 40; i++) bigMimicAI(e, hooks, p);      // 唤醒(近距)→蓄力36t→跳扑
    expect(e.ai0).not.toBe(0);                                 // 已离伪装态（唤醒链走通）
    expect(captured).toHaveLength(0);                          // ★激活链零尘（定谳面）
  });

  it('473 死亡链恰 20×31 无杂尘（HitEffect 死支=尘+gore 之外无 NewNPC 等专项;gore 归 gore 表）', () => {
    const { hooks, e, captured, p } = mkWake473();
    for (let i = 0; i < 40; i++) bigMimicAI(e, hooks, p);
    expect(captured).toHaveLength(0);
    spawnNpcDeathDust(e, hooks, 1);
    expect(captured).toHaveLength(20);                         // 恰 20 发（无额外杂尘）
    expect(new Set(captured.map((c) => c.type))).toEqual(new Set([31]));
  });
});

// ===================== D. 变异自证（原子+逐字节还原+sha256,共锁） =====================

describe.skipIf(process.env.SW_BJ484_MUT)('BJ484 D. 变异自证', () => {   // ★残留普查波补 dam（全族同款习语）
  const EXTRACTOR = join(process.cwd(), 'tools', 'extract-npcdust.mjs');
  const LIVE_JSON = join(process.cwd(), 'src', 'data', 'vanilla-npcdust.json');
  const CONSUMER = join(process.cwd(), 'src', 'entities', 'NpcHitDust.ts');
  const spawnVitest = (filter: string, extraEnv: Record<string, string> = {}) => spawnSync('npx', ['vitest', 'run', 'tests/bj484-mimic-family-dust.test.ts', '--no-file-parallelism', '-t', filter], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 600_000,
    // ★子进程豁免残留检测闸（对变异面跑 A/B 面）;BJ708-G33 起另可带 SW_BJ484_MUT_JSON
    //   沙箱表重定向（文件头 vi.mock）——M2 活库零写窗形态。
    env: { ...process.env, SW_BJ484_MUT: '1', ...extraEnv },
  });

  beforeAll(() => { gateConsumerMutation('SW_BJ484_MUT', CONSUMER); });

  it('M1 提取器 tmp 变异体摘 BATCH6_TYPES 五型 → 干跑对拍漂移 exit 1+漂移指名 341（名单线承重物证）', () => {
    const before = sha256(EXTRACTOR);            // 真工具零接触哨兵
    const beforeJson = sha256(LIVE_JSON);        // 现库零接触哨兵
    try {
      const src = readFileSync(EXTRACTOR, 'utf8');
      const TRIGGER = 'const BATCH6_TYPES = new Set([85, 629, 23, 341, 473, 474, 475, 476]);';
      expect(src).toContain(TRIGGER);
      const dir = mkdtempSync(join(realpathSync(tmpdir()), 'bj484-mut-'));
      const mutant = join(dir, 'extract-npcdust-mutant.mjs');
      try {
        writeFileSync(mutant, src
          .replace("const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');", `const ROOT = ${JSON.stringify(process.cwd())};`)
          .replace(TRIGGER, 'const BATCH6_TYPES = new Set([85, 629, 23]); // ★变异:摘 BJ484 五型（名单回退 BJ479 终态）'));
        const r = spawnSync('node', [mutant], { cwd: process.cwd(), encoding: 'utf8', timeout: 300_000 });
        expect(r.status).not.toBe(0);            // ★变异证红:五型出清回退=对拍漂移硬闸捕获
        expect(r.stdout).toContain('对拍漂移 5 型');   // 恰 5 型（其余零漂移）
        expect(r.stdout).toContain('341,473,474,475,476');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    } finally {
      expect(sha256(EXTRACTOR)).toBe(before);    // 逐字节还原
      expect(sha256(LIVE_JSON)).toBe(beforeJson);
    }
  });

  // ★残留普查波 2026-10-12:BJ606 习语统一改造→tests/mutation-guard.ts 三层守卫。
  //  ★BJ708-G33(2026-10-24):M2 变异面迁 tmp 沙箱库——旧形态 withMutation 直写活库
  //  vanilla-npcdust.json 存在写窗,vitest 并行 worker 把 era-guard 的活库逐字节读调
  //  进窗=伪红（G28 判谳,本批复跑实锤 3 红）。新形态:变异副本写 mkdtemp 沙箱,子进程
  //  经 SW_BJ484_MUT_JSON 重定向（文件头 vi.mock）;活库全程零写=写窗消失,race 类整体
  //  根除（非「两文件入 sequential 池」的对症缓解——那是 vitest 2 全池 maxWorkers=1
  //  的全量串行化,battery 显著变慢且只封观测到的文件对,不封类）。
  //  域锁保留:与 bj296/bj304 D 面共用 npcdust-mutation-mutex,维持三 D 面串行语义。
  it('M2 沙箱库变异 341 常量尘→四系值 → 判别子测试红（活库零写窗,全程 sha256 对拍）', () => {
    lockConsumerMutation();
    try {
      const beforeJson = sha256(LIVE_JSON);
      // ★纯净闸（只读,触发闸收编）:活库 round-trip 等价 + 341 命中 196——残留/毒盘
      //   →loud 红（不写不还原,人工核对盘上现态）;活库非纯净时禁入变异臂（防子进程
      //   对已污染表跑 A/B 面=假证据）。
      const pristine = readFileSync(LIVE_JSON, 'utf8');
      const parsed = JSON.parse(pristine) as typeof TABLE;
      if (JSON.stringify(parsed, null, 1) + '\n' !== pristine) {
        throw new Error('活库 round-trip 不等价（并行覆写?先读盘核对再跑）');
      }
      if (parsed['341'].hit?.[0]?.dust !== 196) {
        throw new Error('活库 341 命中非 196（残留态）——人工核对盘上现态（禁 git checkout）');
      }
      // ★变异算子:常量尘 196→31（四系大宝箱值）;副本落沙箱,round-trip 序列化保持格式
      parsed['341'].hit![0]!.dust = 31;
      const dir = mkdtempSync(join(realpathSync(tmpdir()), 'bj484-m2-'));
      try {
        const mutatedJson = join(dir, 'vanilla-npcdust.json');
        writeFileSync(mutatedJson, JSON.stringify(parsed, null, 1) + '\n');
        // ★过滤器=「礼物怪尘档钉值」——只命中 A 面 341 金标,不命中 D 面（测试名不含该串,
        //   防 M 系测试自匹配递归;M1/M2 名含裸「341」,禁用裸数字作过滤器）
        const r = spawnVitest('礼物怪尘档钉值', { SW_BJ484_MUT_JSON: mutatedJson });
        expect(r.status).not.toBe(0);              // ★变异证红:A 金标 341 判别捕获（经沙箱重定向）
        expect(r.stdout).toContain('礼物怪尘档钉值');
        expect(sha256(LIVE_JSON)).toBe(beforeJson);   // 活库零触碰哨兵（全程无写窗,恒等必绿）
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    } finally {
      unlockConsumerMutation();
    }
  });
});
