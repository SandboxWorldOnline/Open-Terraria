// ★BJ742-A R23-⑩/⑪ + 锁缺口六件（2026-10-31 红蓝清偿）：
//   · R23-⑩ 返程双门绘序（ReturnGatePlayerRenderer.cs :77-80 Exit 先入/Entry 后入
//     =Entry 叠上层;DrawToDrawData 第二参 selectionMode 只喂 Entry 门）。
//   · R23-⑪ 群系视觉尘 267（TileDrawing.cs:963-971,1/480 掷）+ B13 真着色面
//     显式登记（tileLight 逐通道钳底 :951-962 = bake 通道新 pass,维持登记——
//     B12 同款注法）;同族备案 spelunker 尘 204/dangersense 尘 60（1/60）另刀。
//   · 锁缺口（R20 ACC07 / R22 四锁 / R24 BJ733 已随批另文）：
//     - ACC07 dayTime 缓存翻转锁（equipStatsTailKey tag13 双位——昼夜/日食翻转拍
//       数值跟随;bj740a ACC07 行为锁只测翻转前态,缓存翻转面缺锁）。
//     - 幽灵并集面（Player.isGhostPhase :17161 完整门 = dead ∧ difficulty==2 ∧
//       (baseMaxHp<=0 ∨ !surviveHardcoreDeath) ∧ respawnTimer<=0 四条件并集）。
//     - 重生跳过 Jump 沿专属（Main.cs:46104 JustBecameTrue(Jump)——按下沿触发,
//       持住电平不触发;Game.ts :11436-11440 边沿表达式）。
//     - 性转药水 voiceVariant=3 存活（药水行为面 bj738a:188 已锁 [3,3];本文件补
//       .plr 导出面 byte 3 存活 + msg4 外观整包通道结构位）。
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { withMutation, lockTargetFile, unlockTargetFile } from './mutation-guard';

import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { Renderer } from '../src/render/Renderer';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { TILE } from '../src/core/constants';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = (p: string): string => readFileSync(join(ROOT, 'src', p), 'utf8');

const iid = (vid: number): number => {
  const k = vanillaItemKey(vid);
  const found = k ? ITEM_BY_KEY[k] : undefined;
  if (found === undefined) throw new Error(`vid ${vid} 未注册`);
  return found;
};

// ===================== ① R23-⑩ 双门绘序 + ⑪ 尘 267/B13 登记 =====================
describe('BJ742-A① 返程门绘序 + 群系视觉尘', () => {
  it('S1 绘序结构锁：Exit 先画 Entry 后画（ReturnGatePlayerRenderer :77-80——Entry 叠上层）', () => {
    const src = SRC('render/Renderer.ts');
    const exitAt = src.indexOf('drawGate(texExit, player.potionOfReturnOriginalUsePosition, true);');
    const entryAt = src.indexOf('drawGate(texEntry, player.potionOfReturnHomePosition, false);');
    expect(exitAt).toBeGreaterThan(-1);
    expect(entryAt).toBeGreaterThan(exitAt);   // 旧序 Entry→Exit 反压（R23-⑩ 病灶）
  });

  it('S2 尘 267 面：biomeSightDust 1/480 掷 + 267 号 + 群系色 + 修型四件（noGravity/fadeIn1/v×0.1/noLightEmittance）', () => {
    const r = Object.create(Renderer.prototype) as unknown as {
      vanillaDust: unknown; _worldPaused: boolean;
      biomeSightDust: (x: number, y: number, ts: number, cr: number, cg: number, cb: number) => void;
    };
    const spawns: Array<{ x: number; y: number; w: number; h: number; type: number;
      alpha: number; color: unknown; scale: number }> = [];
    const fakeDust = {
      spawn: (x: number, y: number, w: number, h: number, type: number,
        vx: number, vy: number, alpha: number, color: unknown, scale: number) => {
        spawns.push({ x, y, w, h, type, alpha, color, scale });
        return { vx: 5, vy: -7, noGravity: false, fadeIn: 0, noLightEmittance: false };
      },
    };
    r.vanillaDust = fakeDust;
    r._worldPaused = false;
    // 掷中档（1/480 命中）
    vi.spyOn(Math, 'random').mockReturnValue(0);
    r.biomeSightDust(100, 200, 16, 255, 160, 240);
    expect(spawns).toHaveLength(1);
    expect(spawns[0]).toMatchObject({ x: 1600, y: 3200, w: 16, h: 16, type: 267, alpha: 150, scale: 0.3 });
    expect(spawns[0].color).toEqual({ r: 255, g: 160, b: 240, a: 255 });
    // 落空档（Next(480)≠0 → 零掷出零尘）
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    r.biomeSightDust(100, 200, 16, 255, 160, 240);
    expect(spawns).toHaveLength(1);
    // 暂停门（_isActiveAndNotPaused → !worldPaused）
    vi.spyOn(Math, 'random').mockReturnValue(0);
    r._worldPaused = true;
    r.biomeSightDust(100, 200, 16, 255, 160, 240);
    expect(spawns).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it('S3 B13 真着色面登记注 + 五分支接线（lesion/flesh/corrupt/crimson/hallow 各挂 biomeSightDust）', () => {
    const src = SRC('render/Renderer.ts');
    expect(src.match(/this\.biomeSightDust\(x, y, ts,/g)?.length).toBe(5);
    // B12 同款登记注（真着色面=tileLight 逐通道钳底 :951-962,维持登记）
    expect(src).toContain('B13 真着色面显式登记');
    expect(src).toContain('tileLight 逐通道钳底 sightColor');
    // 同族备案（204/60 另刀）
    expect(src).toContain('204/60 另刀（D-BJ742-⑪）');
  });
});

// ===================== ② ACC07 dayTime 缓存翻转锁（R20 锁缺口） =====================
describe('BJ742-A② ACC07 dayTime 缓存翻转', () => {
  it('S4 太阳石 899：暖缓存下翻转 dayTime → 数值跟随（tag13 双位失效合同）', () => {
    const mk = (): Player => {
      const p = new Player(40 * 16, 54 * 16, new Inventory());
      p.inv.armor[3] = { id: iid(899), stack: 1 };
      return p;
    };
    const asTime = (p: Player, day: boolean): void => {
      (p as unknown as { dayTime: boolean }).dayTime = day;
      (p as unknown as { nightPhase: boolean }).nightPhase = !day;
    };
    // 日食相（dayTime=true, nightPhase=true——899 裸白天门仍开）
    const p = mk();
    asTime(p, true);
    (p as unknown as { nightPhase: boolean }).nightPhase = true;
    expect(p.equipStats.def).toBe(4);              // 天界石复合在（首访落缓存）
    // 翻转 → 夜晚（899 关）——缓存必须失效重算
    (p as unknown as { dayTime: boolean }).dayTime = false;
    expect(p.equipStats.def).toBe(0);              // ★翻转拍数值跟随（旧键缺 dayTime 位=陈旧 4）
    // 翻回日食相 → 复合回
    (p as unknown as { dayTime: boolean }).dayTime = true;
    expect(p.equipStats.def).toBe(4);
  });
});

// ===================== ③ 幽灵并集面（R22 锁缺口） =====================
describe('BJ742-A③ 幽灵相并集（Player.isGhostPhase :17161-17170 完整门）', () => {
  const ghostP = (): Player => {
    const p = new Player(40 * 16, 54 * 16, new Inventory());
    p.appearance = { difficulty: 2, skinVariant: 0 } as never;   // 硬核
    p.dead = true;
    p.baseMaxHp = 200;
    return p;
  };

  it('S5 四条件并集：硬核+计时到期 → ghost;缺任一 → 非 ghost', () => {
    const w = new World(60, 60, 30, 'bj742a-ghost');
    const g = ghostP();
    g.respawnTimer = 0;
    expect(g.isGhostPhase(w)).toBe(true);          // dead ∧ diff2 ∧ (hp>0 ∧ !survive) ∧ t≤0
    // 计时未到期（倒计中）→ 非 ghost
    const a = ghostP();
    a.respawnTimer = 300;
    expect(a.isGhostPhase(w)).toBe(false);
    // 非硬核（中核）→ 非 ghost
    const b = ghostP();
    b.appearance = { difficulty: 1, skinVariant: 0 } as never;
    b.respawnTimer = 0;
    expect(b.isGhostPhase(w)).toBe(false);
    // 未死 → 非 ghost（并集首位）
    const c = ghostP();
    c.dead = false;
    c.respawnTimer = 0;
    expect(c.isGhostPhase(w)).toBe(false);
    // survive 组合世界（theConstant×tenthAnniversary 非 FTW）→ 走 ReviveFromDeath 非 ghost
    const sw = new World(60, 60, 30, 'bj742a-ghost2');
    sw.seedFlags = { theConstant: true, tenthAnniversary: true };
    const d = ghostP();
    d.respawnTimer = 0;
    expect(d.isGhostPhase(sw)).toBe(false);        // :17161 (statLifeMax<=0 || !survive) 不满足
    // 扣光上限（baseMaxHp<=0）→ survive 门旁路 → ghost
    const e = ghostP();
    e.baseMaxHp = 0;
    e.respawnTimer = 0;
    expect(e.isGhostPhase(sw)).toBe(true);
  });

  it('S6 msg13 ghost 位并集映射结构锁（flagBits[6] 承载 dead∪ghost——收端 p.dead 消费）', () => {
    const cn = SRC('net/ClientNet.ts');
    // 发端：dead 电平占用 [6]（幽灵并集——勿修成 vanilla 纯 ghost 位）
    expect(cn).toContain('| (p.dead ? 64 : 0) | (gp.hostile ? 128 : 0)');
    expect(cn).toContain('幽灵并集面定谳备案');
    // 收端：ghost 位 → p.dead
    expect(cn).toContain('p.dead = !!(flag & 64);           // flagBits[6] = ghost');
  });
});

// ===================== ④ 重生跳过 Jump 沿专属（R22 锁缺口） =====================
describe('BJ742-A④ 重生跳过 Jump 沿专属（Main.cs:46104 JustBecameTrue）', () => {
  it('S7 边沿表达式结构锁：inputJump 按下沿（!_prevRespawnSkipJump）触发,非电平', () => {
    const src = SRC('core/Game.ts');
    expect(src).toContain('const jumpEdge = !!player.inputJump && !this._prevRespawnSkipJump;');
    expect(src).toContain('this._prevRespawnSkipJump = !!player.inputJump;');
    expect(src).toContain('if (jumpEdge && player.respawnSkipUi) {');
    // 全门（AllowsRespawnTimerSkip 内联三门 + 委托四门,Main.cs:46105/:39264-39391）
    expect(src).toContain('player.respawnSkipUi = player.deadTime >= 90\n'
      + '        && !player.isGhostPhase(this.world) && !player.lastPvpDeath\n'
      + '        && this.allowsRespawnTimerSkip();');
  });
});

// ===================== ⑤ 性转药水 voiceVariant=3 存活（R22 锁缺口） =====================
describe('BJ742-A⑤ voiceVariant=3 存活面', () => {
  it('S8 药水行为面已锁复核（bj738a:188 [3,3]）+.plr 导出 byte 3 + msg4 整包通道', () => {
    // bj738a-potion-consistency.test.ts:188「语音 1↔2 翻转保持（:43536-43542;3 不动）」
    // 覆盖药水饮用面（Player.cs:43537-43545 switch 无 case3 分支=显式选择不被覆写）。
    // 本处补【序列化存活】两道：
    // · .plr 导出（PlrImport.ts SaveToPlayer）byte 直写钳 1..3——3 存活
    const plr = SRC('save/PlrImport.ts');
    expect(plr).toContain('w.byte(Math.max(1, Math.min(3, a.voiceVariant ?? 1)));');
    // · SW 存档/MQ msg4 外观整包（appearance spread 携 voiceVariant——JSON 浮点全字段）
    expect(SRC('net/ClientNet.ts')).toContain('JSON.stringify({ ...(p2?.appearance as Record<string, unknown> ?? {}), hairDye: p2?.hairDye ?? 0 })');
    // · Appearance 域校验 3 在合法域（越界 → undefined 走性别推导,3 不落此支）
    expect(SRC('player/Appearance.ts')).toContain('return v === 1 || v === 2 || v === 3 ? v : undefined;');
  });
});

// ===================== ⑥ 变异恰红 =====================
describe.skipIf(process.env.SW_BJ742A_MUT)('BJ742-A⑥ 变异自证（五发恰红+逐字节还原）', () => {
  const spawnVitest = (filter: string) => spawnSync(
    'npx', ['vitest', 'run', 'tests/bj742a-render-lockgaps.test.ts', '--no-file-parallelism', '-t', filter], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 600_000,
      env: { ...process.env, SW_BJ742A_MUT: '1' },
    });

  const mutate = (file: string, trigger: string, replacement: string, filter: string): void => {
    let pristineSha = '';
    withMutation(file, trigger, replacement, () => {
      const r = spawnVitest(filter);
      expect(r.status, `变异须证红: ${filter}`).not.toBe(0);
      expect(r.stdout).toContain(filter);
    }, {
      label: `BJ742A ${filter}`,
      onPristine: (p) => { pristineSha = createHash('sha256').update(p).digest('hex'); },
    });
    lockTargetFile(file, `BJ742A 还原对拍 ${filter}`);
    try {
      const post = createHash('sha256').update(readFileSync(file)).digest('hex');
      expect(post, `还原对拍 ${file}`).toBe(pristineSha);
    } finally {
      unlockTargetFile(file);
    }
  };

  it('M1 双门绘序回旧序（Entry 先画） → S1 红（R23-⑩ 病灶复活）', () => {
    mutate(join(ROOT, 'src', 'render', 'Renderer.ts'),
      'drawGate(texExit, player.potionOfReturnOriginalUsePosition, true);\n      drawGate(texEntry, player.potionOfReturnHomePosition, false);',
      'drawGate(texEntry, player.potionOfReturnHomePosition, false);\n      drawGate(texExit, player.potionOfReturnOriginalUsePosition, true);   // BJ742A-M1',
      'S1 绘序结构锁');
  });

  it('M2 biomeSightDust 掷门摘除（恒不掷中） → S2 红（尘 267 缺面复活）', () => {
    mutate(join(ROOT, 'src', 'render', 'Renderer.ts'),
      'if (Math.random() >= 1 / 480) return;   // _rand.Next(480) == 0',
      'if (true) return;   // BJ742A-M2',
      'S2 尘 267 面');
  });

  it('M3 tag13 dayTime 位摘除 → S4 红（翻转拍缓存陈旧——ACC07 伪注释自欺病）', () => {
    mutate(join(ROOT, 'src', 'entities', 'Player.ts'),
      'mix(13); mix(this.nightPhase ? 1 : 0); mix(this.dayTime ? 1 : 0);',
      'mix(13); mix(this.nightPhase ? 1 : 0);   // BJ742A-M3',
      'S4 太阳石 899');
  });

  it('M4 isGhostPhase 并集残缺（survive 门摘除） → S5 红（组合世界幽灵化=EXTRA_LIFE 批病灶）', () => {
    mutate(join(ROOT, 'src', 'entities', 'Player.ts'),
      'return this.dead && this.appearance?.difficulty === 2\n'
      + '      && (this.baseMaxHp <= 0 || !surviveHardcoreDeath(world.seedFlags))\n'
      + '      && this.respawnTimer <= 0;',
      'return this.dead && this.appearance?.difficulty === 2\n'
      + '      && this.respawnTimer <= 0;   // BJ742A-M4',
      'S5 四条件并集');
  });

  it('M5 jumpEdge 回电平（按下沿退役） → S7 红（持住 Jump 连跳=JustBecameTrue 语义破坏）', () => {
    mutate(join(ROOT, 'src', 'core', 'Game.ts'),
      'const jumpEdge = !!player.inputJump && !this._prevRespawnSkipJump;',
      'const jumpEdge = !!player.inputJump;   // BJ742A-M5',
      'S7 边沿表达式结构锁');
  });
});
