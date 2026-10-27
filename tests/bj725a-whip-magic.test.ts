// BJ725-A 批C 鞭/魔弹登记债清偿判别锁（bj723c 登记债 D1/D2/D3;D4 族登记不落刀）：
//   D1 飞刀 491/老星怒 9 hitStep DV 整缺（:12970 同链同掷——审计六入口未列的第 8/9
//      面;bj723c 4g 计数锁已随刀扩 2→4,本文件补结构双锁+变异恰红）
//   D2 星鞭 1034 星雨 floor-1（:15016-15017 (int)(calcDamage×0.22f) 无下限——
//      dmgNow≤2 出 0 伤死星 vs 旧 max1 钳 1 伤星;Arrow damage<=0 门 :12576 零受理）
//   D3 月主鞭 1035 补鞭出生钳（ctor Math.max(1,...) 摘除——母鞭 dmgNow=0 时子鞭
//      原版 0 伤,Damage_PVE :12577 门零受理;正常挥鞭 damage≥1 钳恒等式无影响,
//      bj651 M5 变异靶串保留在钳内式——变异恰红不失效）
//   D4 魔弹 Kill 爆 AoE 城镇面（enemies 桶扫同病族 121 处）——族登记不落刀,判语
//      见 memory/bj725a-issue24-residuals.md
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { WhipProj } from '../src/entities/WhipProj';
import { Arrow } from '../src/entities/Arrow';
import { withMutation } from './mutation-guard';
import type { GameHooks } from '../src/entities/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = join(HERE, '..');
const SRC = (p: string) => readFileSync(join(GAME_ROOT, 'src', p), 'utf8');
const MISSILE_SRC = join(GAME_ROOT, 'src/entities/MissileProj.ts');
const WHIP_SRC = join(GAME_ROOT, 'src/entities/WhipProj.ts');
const spawnVitest = (filter: string) => spawnSync('npx', ['vitest', 'run', filter, '--reporter=basic'],
  { cwd: GAME_ROOT, encoding: 'utf8', timeout: 180_000, env: { ...process.env, BJ725_MUT_SKIP: '1' } });
const itMut = process.env.BJ725_MUT_SKIP === '1' ? it.skip : it;   // 变异子进程跳过变异测试（防递归挂锁）
afterEach(() => vi.restoreAllMocks());

interface MockEnemy {
  id: number; x: number; y: number; w: number; h: number; cx: number; cy: number;
  dead: boolean; iframes: number; hp: number; maxHp: number; vanillaId: number;
  dontTakeDamage: boolean; vx: number; vy: number; realLife: number;
  hits: number[];
  hurt: (d: number, ...a: unknown[]) => boolean;
}
const mkEnemy = (id: number, cx: number, cy: number): MockEnemy => {
  const e = {
    id, x: cx - 12, y: cy - 12, w: 24, h: 24, cx, cy,
    dead: false, iframes: 0, hp: 100000, maxHp: 100000, vanillaId: 15,
    dontTakeDamage: false, vx: 0, vy: 0, realLife: -1, hits: [] as number[],
    hurt(d: number) { e.hp -= d; e.hits.push(d); return true; },
  } as MockEnemy;
  return e;
};
function makeHooks(o: { enemies?: MockEnemy[]; player?: Player } = {}) {
  const w = new World(200, 120, 7, 'bj725a');
  for (let x = 0; x < 200; x++) for (let y = 100; y < 120; y++) w.store.setTile(x, y, 1);
  w.groundLevel = 100;
  const player = o.player ?? new Player(60 * 16, 90 * 16, new Inventory());
  const enemies = o.enemies ?? [];
  const projectiles: unknown[] = [];
  const hooks = {
    world: w as never, player: player as never,
    enemies: () => enemies, npcs: () => [], critters: () => [],
    spawnDrop: () => null, damagePlayer: () => 0, addDamageNumber: () => {},
    cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
    spawnParticles: () => {}, notifyInventoryChanged: () => {}, playSfx: () => {},
    playSfxFiles: () => {}, showPickupLabel: () => {}, applyLifeSteal: () => 0,
    entities: { add: (e: unknown) => { projectiles.push(e); }, nextId: 1, projectiles } as never,
  } as unknown as GameHooks;
  return { hooks, player, enemies, projectiles };
}
function landOneHit(w: WhipProj, hooks: GameHooks, ...enemies: MockEnemy[]): void {
  for (let i = 0; i < 9; i++) w.fixedUpdate(1, hooks);
  const p = w.pointsAt(20, true)[10]!;
  for (const e of enemies) { e.x = p.x - 12; e.y = p.y - 12; e.cx = p.x; e.cy = p.y; }
  w.fixedUpdate(1, hooks);
}
const mkWhip = (player: Player, dmg: number, projId = 841, itemId = 4672): WhipProj =>
  new WhipProj(player.cx, player.cy, 0, projId, itemId, dmg, 4, 30, 4, () => player);

// ================= D1 飞刀 491 / 老星怒 9 hitStep DV =================
describe('BJ725-C D1：MissileProj 第 8/9 面 DV（hitStep :12970 同链同掷）', () => {
  it('D1-1 结构锁：两 hitStep 掷位在（DV 行恰 2,旧裸 this.damage 行退役）', () => {
    const s = SRC('entities/MissileProj.ts');
    expect(s.split('const dmg = damageVarRoll(this.damage, ((game.player as unknown as { luck?: number } | null)?.luck) ?? 0);').length - 1).toBe(2);
    expect(s).not.toContain('const dmg = this.damage;   // ★S02(BJ723-B)');
  });
  itMut('D1-M1 变异恰红：首站 DV 回退裸值 → 计数 1 红', () => {
    withMutation(MISSILE_SRC,
      'const dmg = damageVarRoll(this.damage, ((game.player as unknown as { luck?: number } | null)?.luck) ?? 0);   // ★BJ723-C D1 清偿（BJ725-A）:DV :12970 逐靶掷——★S02:crit ×2 移 Enemy.hurt 防后(NPC.cs:82067)',
      'const dmg = this.damage; /* BJ725C-M1 变异:hitStep DV 摘除 */',
      () => {
        const r = spawnVitest('tests/bj725a-whip-magic.test.ts');
        expect(r.status, '变异须证红').not.toBe(0);
        expect(r.stdout).toContain('D1-1');
      }, { label: 'BJ725C-M1' });
  });
});

// ================= D2 星鞭 1034 星雨 floor-1 =================
describe('BJ725-C D2：星鞭星雨无下限（:15016 (int)(calcDamage×0.22f)）', () => {
  it('D2-1 dmgNow=2 → 0 伤死星（trunc(2×2×0.22)=0;旧 max1 钳 1）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const e = mkEnemy(41, 0, 0);
    const { hooks, player, projectiles } = makeHooks({ enemies: [e] });
    (player as unknown as { tagEffectStack: unknown }).tagEffectStack =
      { canProcOnNPC: () => true, removeAllProcs: () => {}, tryApplyTagToNPC: () => true };
    const w = mkWhip(player, 2, 1034);
    landOneHit(w, hooks, e);
    const stars = projectiles.filter((p) => (p as { projId?: number }).projId === 1039);
    expect(stars.length).toBeGreaterThan(0);
    for (const s of stars) expect((s as { damage: number }).damage).toBe(0);
  });
  it('D2-2 正档锚：星伤=trunc(衰减后 dmgNow×2×0.22)（falloff :13453 先于 proc :13641——:15016 传衰减后 damage×2）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const e = mkEnemy(42, 0, 0);
    const { hooks, player, projectiles } = makeHooks({ enemies: [e] });
    (player as unknown as { tagEffectStack: unknown }).tagEffectStack =
      { canProcOnNPC: () => true, removeAllProcs: () => {}, tryApplyTagToNPC: () => true };
    const w = mkWhip(player, 10, 1034);
    landOneHit(w, hooks, e);
    const post = (w as unknown as { dmgNow: number }).dmgNow;   // 衰减写 (:978) 先于星雨 (:1008)
    expect(post).toBeGreaterThan(0);
    expect(post).toBeLessThan(10);                              // falloff 已生效
    const stars = projectiles.filter((p) => (p as { projId?: number }).projId === 1039);
    expect(stars.length).toBeGreaterThan(0);
    for (const s of stars) expect((s as { damage: number }).damage).toBe(Math.trunc(post * 2 * 0.22));
  });
  itMut('D2-M1 变异恰红：floor-1 钳复活 → D2-1 红', () => {
    const trgS = 'const starDmg = Math.trunc(this.dmgNow * 2 * 0.22);';
    const repS = 'const starDmg = Math.max(1, Math.trunc(this.dmgNow * 2 * 0.22)); /* BJ725C-M2 变异:floor-1 复活 */';
    withMutation(WHIP_SRC, trgS, repS,
      () => {
        const r = spawnVitest('tests/bj725a-whip-magic.test.ts');
        expect(r.status, '变异须证红').not.toBe(0);
        expect(r.stdout).toContain('D2-1');
      }, { label: 'BJ725C-M2', mutate: (pristine: string) => pristine.split(trgS).join(repS) });   // 双站点（城镇臂+敌怪臂）同变异——replace 首站陷阱
  });
});

// ================= D3 月主鞭 1035 补鞭出生钳 =================
describe('BJ725-C D3：WhipProj ctor 出生钳摘除（母鞭 0 伤 → 子鞭 0 伤）', () => {
  it('D3-1 ctor damage=0 → dmgNow=0（原版 0 伤死鞭;旧 Math.max(1,0)=1）', () => {
    const p = new Player(0, 0, new Inventory());
    const w = new WhipProj(0, 0, 0, 1035, 4672, 0, 4, 30, 4, () => p);
    expect((w as unknown as { dmgNow: number }).dmgNow).toBe(0);
  });
  it('D3-2 正常档恒等：55×1.1 → truncBias=60（bj651 M5 值锚不回退）', () => {
    const p = new Player(0, 0, new Inventory());
    Object.defineProperty(p, 'summonDamageMult', { value: 1.1, configurable: true });   // getter-only 面用 defineProperty 覆写（bj452 习语）
    const w = new WhipProj(0, 0, 0, 841, 4672, 55, 4, 30, 4, () => p);
    expect((w as unknown as { dmgNow: number }).dmgNow).toBe(60);
  });
  it('D3-3 0 伤鞭零受理（dmgNow<=0 门 :12577 同构——命中环零受理）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const e = mkEnemy(51, 0, 0);
    const { hooks, player } = makeHooks({ enemies: [e] });
    const w = mkWhip(player, 0, 841);
    landOneHit(w, hooks, e);
    expect(e.hits.length).toBe(0);       // Damage_PVE :12577 头门
  });
  itMut('D3-M1 变异恰红：Math.max(1) 出生钳复活 → D3-1 红', () => {
    withMutation(WHIP_SRC,
      'this.dmgNow = truncCSf32MulBias(o ? o.summonDamageMult : 1, damage);',
      'this.dmgNow = Math.max(1, truncCSf32MulBias(o ? o.summonDamageMult : 1, damage)); /* BJ725C-M3 变异:出生钳复活 */',
      () => {
        const r = spawnVitest('tests/bj725a-whip-magic.test.ts');
        expect(r.status, '变异须证红').not.toBe(0);
        expect(r.stdout).toContain('D3-1');
      }, { label: 'BJ725C-M3' });
  });
});
