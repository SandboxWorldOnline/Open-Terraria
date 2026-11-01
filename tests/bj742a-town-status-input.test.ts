// ★BJ742-A R21-⑤ + R22-⑦/⑧/⑨（2026-10-31 红蓝清偿）：城镇挥砍站 StatusToNPC 块
// + msg13 bit7 controlDash 双写方 + Enter 开聊 Alt 守卫 + wings-4 喷射尘悬停并集。
//
// 原版锚（Terarria1457 亲读）：
//   · R21-⑤ Player.cs:44755（ProcessHitAgainstNPC 城镇命中段 StrikeNPC :44773 前）
//     StatusToNPC(sItem.type, npcIndex)——浸剂八支（:6502-6533）/催化指环 398
//     （:6534-6538）/持械武器表（2330/3352/3211/5129+switch）/frostBurn（:6547）/
//     magmaStone（:6551-6565）对巫毒/FlyMeal/税官杖三门放行的城镇命中照施。
//     5129 苍蝇美食 → Stinky(120) 300t（:6570-6573,城镇域标志交互）;
//     31 Confused 城镇全员免疫（DebuffImmunitySets,NPCID.cs）由 AddBuff 门拦。
//   · R22-⑦ NetMessage.cs:459 bitsByte21[7]=controlDash——双写方
//     （ClientNet.sendPlayerState / VanillaClient.sendControls13）旧均缺位。
//   · R22-⑧ Main.cs:18449（DoUpdate_Enter_ToggleChat）`!IsKeyDown(LeftAlt) &&
//     !IsKeyDown(RightAlt)`——Alt+Enter 全屏组合不开聊。
//   · R22-⑨ Player.cs:29713-29717（WingFrame wings==4）`int num = 2;
//     if (TryingToHoverUp) num = 4;`——:3908-3915 = controlUp ∨ tryKeepingHoveringUp。
//
// 变异恰红映射：
//   M1 城镇 StatusToNPC 块摘除        → S1 红
//   M2 VanillaClient c1 bit7 摘除     → S4 红（结构锁）
//   M3 Game.ts Alt 守卫摘除           → S5 红（结构锁）
//   M4 wings-4 尘档回裸 inputUp       → S6 红
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { TownNPC } from '../src/entities/TownNPC';
import { World } from '../src/world/World';
import { Game } from '../src/core/Game';
import { BuffType } from '../src/stats/Buffs';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import {
  applyMeleeImbue, applyWeaponStatusSwing, applyMagmaStoneSwing, applyFrostBurn,
} from '../src/entities/projStatus';
import { withMutation, lockTargetFile, unlockTargetFile } from './mutation-guard';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = (p: string): string => readFileSync(join(ROOT, 'src', p), 'utf8');
const GT = join(ROOT, 'src', 'core', 'Game.ts');
const PT = join(ROOT, 'src', 'entities', 'Player.ts');
const VCT = join(ROOT, 'src', 'net', 'vanilla', 'VanillaClient.ts');

const iid = (vid: number): number => {
  const k = vanillaItemKey(vid);
  const found = k ? ITEM_BY_KEY[k] : undefined;
  if (found === undefined) throw new Error(`vid ${vid} 未注册`);
  return found;
};

// ===================== ① 城镇挥砍站 StatusToNPC（Player.cs:44755） =====================
describe('BJ742-A① 城镇 StatusToNPC 块', () => {
  it('S0 端到端：持 5129 苍蝇美食挥中向导 → stinkyT=5s + 掉血（巫毒/FlyMeal 窄门放行）', () => {
    const world = new World(120, 120, 30, 'bj742a-town');
    const player = new Player(50 * 16, 90 * 16, new Inventory());
    const FLY = iid(5129);
    player.inv.slots[0] = { id: FLY, stack: 2 };
    player.inv.selected = 0;
    const tn = new TownNPC('guide', player.cx + 8, player.y + 4);
    tn.id = 1;
    const hp0 = tn.hp;
    const g = Object.create(Game.prototype) as unknown as Record<string, unknown>;
    g.player = player;
    g.world = world;
    g.swing = { t: 20, dur: 30, dmg: 10, kb: 3, item: FLY, useStyle: 1 };
    g.swingHitSet = new Set<number>();
    g.swingTileCutSet = new Set<string>();
    g.entities = { critters: [], npcs: [tn], enemies: [], projectiles: [], add: () => {} };
    g.net = null;
    g.tickCount = 1000;
    g.sfx = { playWavFile: () => true, playFiles: () => true, play: () => {}, playSfxWav: () => {} };
    g.addDamageNumber = () => {};
    g.spawnParticles = () => {};
    g.spawnDrop = () => null;
    g.bannerNpcActive = () => false;
    g.remotePlayerProxies = [];
    g.achievements = { notifyProgressionEvent: () => {} };
    g.broadcastParticleOrchestra = () => {};
    (g as unknown as { updateSwingHits: () => void }).updateSwingHits();
    expect(tn.stinkyT).toBeCloseTo(5, 6);          // StatusToNPC :6570-6573（修前恒 0）
    expect(tn.hp).toBeLessThan(hp0);               // FlyMeal ×2 命中（isFlyMeal 支）
    void hp0;
  });

  it('S1 助手族对 TownNPC 实体可用：5129 → stinkyT=5s;浸剂/岩浆石/frostBurn 照写', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);   // 岩浆石三段掷落「否则」档/武器概率不触发
    const tn = new TownNPC('guide', 100, 100);
    // FlyMeal 5129 → Stinky 120 300t（StatusToNPC :6570-6573,100% 无掷）
    applyWeaponStatusSwing(5129, tn as unknown as Record<string, number>);
    expect(tn.stinkyT).toBeCloseTo(5, 6);
    // 火浸剂（meleeEnchant==3 → AddBuff(24, 60×Next(3,7))）
    const imbues = { has: (b: BuffType) => b === BuffType.ImbueFire } as never;
    applyMeleeImbue(imbues, tn as unknown as Record<string, number>);
    expect(tn.onFireT).toBeGreaterThanOrEqual(3);
    expect(tn.onFireT).toBeLessThanOrEqual(6);
    // 岩浆石（:6551-6565 三段掷,r=0.99 → 否则档 120t=2s）
    applyMagmaStoneSwing(true, tn as unknown as Record<string, number>);
    expect(tn.onFire3T).toBeCloseTo(2, 6);
    // 冰霜甲（:6547-6550 60×Next(5,15)）
    applyFrostBurn(true, tn as unknown as Record<string, number>);
    expect(tn.frostburn2T).toBeGreaterThanOrEqual(5);
    vi.restoreAllMocks();
  });

  it('S2 Confused 31 城镇免疫（DebuffImmunitySets——2330 紫挥棒鱼掷中也不写 confusedT）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);   // roll(2) 命中
    const tn = new TownNPC('guide', 100, 100);
    applyWeaponStatusSwing(2330, tn as unknown as Record<string, number>);
    expect((tn as unknown as { confusedT?: number }).confusedT).toBeUndefined();
    // 反对照：Bleeding 30（3352 血腥砍刀）城镇不免疫——载体写入
    const tb = new TownNPC('guide', 100, 100);
    applyWeaponStatusSwing(3352, tb as unknown as Record<string, number>);
    expect(tb.bleedT).toBeGreaterThanOrEqual(4);
    expect(tb.bleedT).toBeLessThanOrEqual(6);
    vi.restoreAllMocks();
  });

  it('S3 TownNPC tickDebuffs 载体消费：bleedT 12 HP/s（AddBloodLoss 可加速池）+ stinkyT 倒数', () => {
    const tn = new TownNPC('guide', 100, 100);
    const hp0 = tn.hp = 500;
    tn.bleedT = 1;
    tn.stinkyT = 1;
    const dmgNum: number[] = [];
    const hooks = {
      addDamageNumber: (...a: never[]) => { dmgNum.push(a[2] as number); },
      spawnDust: () => null, playSfx: () => {}, playSfxWav: () => {},
    } as never;
    const tickDebuffs = (tn as unknown as { tickDebuffs: (dt: number, g: unknown) => void }).tickDebuffs;
    for (let i = 0; i < 60; i++) tickDebuffs.call(tn, 1 / 60, hooks);
    expect(tn.bleedT).toBeLessThanOrEqual(0);
    expect(tn.stinkyT).toBeLessThanOrEqual(0);
    // 1s × 12 HP/s = 12 HP 实扣（DOTTally ⌊acc⌋ 分块,合计恰 12）
    expect(hp0 - tn.hp).toBe(12);
    // 398 加速池：acceleratePoisonsT 在身 → bleed ×2
    const tc = new TownNPC('guide', 100, 100);
    tc.hp = 500;
    tc.bleedT = 1;
    tc.acceleratePoisonsT = 1;
    for (let i = 0; i < 60; i++) tickDebuffs.call(tc, 1 / 60, hooks);
    expect(500 - tc.hp).toBe(24);
  });

  it('S4 挥砍站结构锁：城镇循环内 StatusToNPC 五件套在 tn.hurt 之前（Player.cs:44755 位序）', () => {
    const src = SRC('core/Game.ts');
    expect(src).toContain('★BJ742-A R21-⑤（2026-10-31）：城镇挥砍站 StatusToNPC 块');
    expect(src).toContain('applyMeleeImbue(this.player.buffs, tnStatus);');
    expect(src).toContain('applyWeaponStatusSwing(heldVidFly, tnStatus);');
    // 位序：块先于 tn.hurt（StrikeNPC :44773 前施状态——首击吃穿甲池同拍）
    const blockAt = src.indexOf('applyMeleeImbue(this.player.buffs, tnStatus);');
    const hurtAt = src.indexOf('tn.hurt(swDmg,');
    expect(blockAt).toBeGreaterThan(-1);
    expect(hurtAt).toBeGreaterThan(blockAt);
  });
});

// ===================== ② R22 三输入面 =====================
describe('BJ742-A② msg13 bit7 / Alt 守卫 / wings-4 尘档', () => {
  it('S4 双写方 bit7 结构锁：VanillaClient c1[7]=inputDash + ClientNet ctrl[7]=inputDash', () => {
    // VanillaClient（原版服直连——服务端 DoCommonDashHandle :21740 消费面,缺位=冲刺橡皮筋）
    expect(SRC('net/vanilla/VanillaClient.ts')).toContain('| (p.inputDash ? 128 : 0);');
    // ClientNet（SW 中继协议 v2——对齐原版首字节全 8 位）
    expect(SRC('net/ClientNet.ts')).toContain('| (p.inputDash ? 128 : 0);');
    // 接收端解码 + 代理注入（输入镜像契约对称）
    expect(SRC('net/ClientNet.ts')).toContain('p.dash = !!(ctrl & 128);');
    expect(SRC('core/Game.ts')).toContain('proxy.inputDash = !stale && rp.dash;');
  });

  it('S5 Enter 开聊 Alt 守卫结构锁（Main.cs:18449 !LeftAlt && !RightAlt——Alt+Enter 全屏）', () => {
    const src = SRC('core/Game.ts');
    expect(src).toContain("if ((code === 'Enter' || code === 'NumpadEnter') && !e.altKey");
    // Input 层 KeyEventLite.altKey 电平面在位（物理键事件原样映射,左右 Alt 合一）
    expect(SRC('core/Input.ts')).toContain('altKey: e.altKey');
  });

  it('S6 wings-4 喷射尘档：悬停锁存（tryKeepingHoveringUp,松↑）也 4 尘（Player.cs:29713-17 并集）', () => {
    const p = new Player(40 * 16, 20 * 16, new Inventory());
    p.vy = 0;                        // airOk 分支不扰（ShouldDrawWings 门旁路）
    p.tryKeepingHoveringUp = true;   // Click 悬停档锁存——inputUp 仍 false
    expect(p.inputUp).toBe(false);
    expect(p.tryingToHoverUp).toBe(true);
    let spawns = 0;
    const fakeDust = {
      spawn: (): { vx: number; vy: number } => { spawns++; return { vx: 0, vy: 0 }; },
    };
    const hooks = { vanillaDust: fakeDust } as never;
    const wingFx = (p as unknown as {
      wingFx: (g: never, w: number, wl: number, f: boolean, gl: boolean, js: boolean) => void;
    }).wingFx;
    wingFx.call(p, hooks, 4, 4, true, false, false);
    expect(spawns).toBe(4);          // 旧读裸 inputUp → 2（悬停喷射稀疏）
    // 反对照：无悬停无↑ → 2 尘
    const q = new Player(40 * 16, 20 * 16, new Inventory());
    q.vy = 0;
    wingFx.call(q, hooks, 4, 4, true, false, false);
    expect(spawns).toBe(6);          // 4 + 2
  });
});

// ===================== ③ 变异恰红 =====================
describe.skipIf(process.env.SW_BJ742A_MUT)('BJ742-A③ 变异自证（四发恰红+逐字节还原）', () => {
  const spawnVitest = (filter: string) => spawnSync(
    'npx', ['vitest', 'run', 'tests/bj742a-town-status-input.test.ts', '--no-file-parallelism', '-t', filter], {
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

  it('M1 城镇 StatusToNPC 块摘除 → S0/S4 红（FlyMeal 挥中向导零状态+结构锁断链）', () => {
    mutate(GT,
      'applyMeleeImbue(this.player.buffs, tnStatus);\n        applyFrostBurn(eq.frostBurn, tnStatus);\n        applyMagmaStoneSwing(eq.magmaStone, tnStatus);\n        applyWeaponStatusSwing(heldVidFly, tnStatus);',
      '/* BJ742A-M1 整块摘除 */',
      'S0 端到端：持 5129');
  });

  it('M2 VanillaClient c1 bit7 摘除 → S4 红（双写方缺位=原版服冲刺橡皮筋）', () => {
    mutate(VCT,
      '      | (p.facing > 0 ? 64 : 0)\n      | (p.inputDash ? 128 : 0);',
      '      | (p.facing > 0 ? 64 : 0);   // BJ742A-M2',
      'S4 双写方 bit7 结构锁');
  });

  it('M3 Game.ts Alt 守卫摘除 → S5 红（Alt+Enter 开聊复活）', () => {
    mutate(GT,
      "if ((code === 'Enter' || code === 'NumpadEnter') && !e.altKey\n        && !this.input.uiBlocking && this.spectatingSlot < 0) {",
      "if ((code === 'Enter' || code === 'NumpadEnter')\n        && !this.input.uiBlocking && this.spectatingSlot < 0) {   // BJ742A-M3",
      'S5 Enter 开聊 Alt 守卫结构锁');
  });

  it('M4 wings-4 尘档回裸 inputUp → S6 红（悬停锁存期尘量减半）', () => {
    mutate(PT,
      'const num = this.tryingToHoverUp ? 4 : 2;',
      'const num = this.inputUp ? 4 : 2;   // BJ742A-M4',
      'S6 wings-4 喷射尘档');
  });
});
