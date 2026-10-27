// 近战类备案遗留 4 项（2026-08-23，标杆 Terarria1457）：
//   ① 挥击动画时长下限 4→1（Player.cs:4438-4446 SetItemAnimation(base,mult)：
//      val=(int)(base×mult)、base>0 → max(val,1)——melee/工具同函数；曾自造 4/12）
//   ② 弧弹 ai1 乘攻速（ai[1]=itemAnimationMax=(int)(useAnimation×meleeSpeed)——
//      Player.cs:4438-4446 + :4455-4458 melee 档；273/757 出生链实参
//      :49381/:49443。attackSpeedMult=1/meleeSpeed 倒数，Player.ts:1709）
//   ③ 变态刀 3106 潜行击退（Player.cs:44013-44016 knockBack += knockBack×(1f−stealth)，
//      乘在 kbGlove/kbBuff(num4) 之后；stealth 0=满潜行→×2）
//   ④ 无头骑士剑 1826 命中召南瓜弹 321（Projectile.cs:13728-13732 →
//      Player.HorsemansBlade_SpawnPumpkin :42444-42462；AI_055 :29201-29281）
// 测法：Game 构造需 DOM/WebGL → ①②③源码锚 + ③经 Object.create(Game.prototype)
// 挂最小字段直调私有 updateSwingHits（同 handover-1457-gates.test.ts 口径）；
// ④ SwingArc/HorsemansPumpkin 纯实体可 node 驱动 → 行为断言。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game } from '../src/core/Game';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { Enemy } from '../src/entities/Enemy';
import { SwingArc, HorsemansPumpkin, spawnHorsemansPumpkin } from '../src/entities/SwingArc';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { TILE } from '../src/core/constants';
import type { GameHooks } from '../src/entities/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcGame = () => readFileSync(join(ROOT, 'src/core/Game.ts'), 'utf8');
const srcArc = () => readFileSync(join(ROOT, 'src/entities/SwingArc.ts'), 'utf8');

/** 原版 vid → 本仓内部 item id（未注册即抛错，防静默假绿） */
const iid = (vid: number): number => {
  const k = vanillaItemKey(vid);
  const found = k ? ITEM_BY_KEY[k] : undefined;
  if (found === undefined) throw new Error(`vid ${vid} 未注册`);
  return found;
};

afterEach(() => {
  vi.restoreAllMocks();
});

// ============ ① 挥击动画时长下限 4→1（Player.cs:4438-4446） ============
describe('① 挥击动画时长下限 1（SetItemAnimation base>0 → max(val,1)）', () => {
  /** 原版 SetItemAnimation(int baseFrames, float multiplier) 镜像（Player.cs:4438-4446） */
  const setItemAnimation = (base: number, mult: number): number => {
    const val = Math.trunc(base * mult);
    return base > 0 ? Math.max(val, 1) : val;
  };

  it('原版规则镜像：base>0 下限 1（曾 4）、base=0 无下限', () => {
    expect(setItemAnimation(8, 3)).toBe(24);      // 满攻速（meleeSpeed 封顶 3）
    expect(setItemAnimation(8, 0.1)).toBe(1);     // 极端减速档仍 ≥1（曾钳 4）
    expect(setItemAnimation(0, 2)).toBe(0);       // base=0 不抬
  });

  it('结构锚：melee 支 max(4,…)→max(1,…)、工具支 max(12,…)→max(1,…)（同函数同门）', () => {
    const src = srcGame();
    // ★BJ640（2026-10-11）攻速链普查批1：melee 支改 ×attackSpeedMult（CapAttackSpeeds
    // 倒数档 M）+词缀烘定 roundCSf32Mul+(int) 截断 truncCSf32Mul——下限 1 门保持
    expect(src).toContain('Math.max(1, truncCSf32Mul(roundCSf32Mul(nativeSpd, psSw?.spd ?? 1), this.player.attackSpeedMult))');
    expect(src).toContain('Math.max(1, truncCSf32Mul(roundCSf32Mul(cwMelee!.useAnimation, psSw?.spd ?? 1), this.player.attackSpeedMult))');
    expect(src).not.toContain('Math.max(12, Math.round(nativeSpd');
    expect(src).not.toContain('Math.max(4, Math.round((cwMelee');
    expect(src).not.toContain('Math.round(nativeSpd / this.player.attackSpeedMult)');   // 旧 ÷ 向退役
  });

  it('结构锚：heldUseAnimation 基值下限同步 4→1（base 本身无 4 下限）', () => {
    expect(srcGame()).toContain('if (ua && ua > 0) return Math.max(1, ua);');
  });

  it('结构锚：远端挥舞时长镜像（remoteSwingDur）同步退役 12/14 下限', () => {
    const src = srcGame();
    expect(src).not.toContain('Math.max(12, Math.round((cw?.useTime');
    expect(src).not.toContain('Math.max(14, Math.round((def.tool.speed');
    // ★BJ640：×M 截断面（远端词缀未同步登记 BJ640-R1）
    // ★BJ651-R1：词缀烘定补同步（roundCSf32Mul 先词缀后攻速,登记债 BJ640-R1 清偿）
    expect(src).toContain('return Math.max(1, truncCSf32Mul(roundCSf32Mul(cw?.useTime ?? def.tool?.speed ?? 42, pSpd), spd));');
  });
});

// ============ ② 弧弹 ai1 乘攻速（itemAnimationMax=(int)(useAnimation×meleeSpeed)） ============
describe('② 弧弹 ai1 = useAnimation×meleeSpeed（Player.cs:49381/:49443 实参）', () => {
  it('结构锚：972 锚弧 animT ×attackSpeedMult（=CapAttackSpeeds 倒数档 M,itemAnimationMax 式）+ 下限 1', () => {
    const src = srcGame();
    // ★BJ640：×M 截断 + 词缀烘定（旧 ÷attackSpeedMult=×攻速和方向反）
    expect(src).toContain('truncCSf32Mul(roundCSf32Mul(cwMelee.useAnimation ?? cwMelee.useTime ?? 100, ps?.spd ?? 1),\n            this.player.attackSpeedMult)');
    expect(src).not.toContain('const animT = cwMelee.useAnimation ?? cwMelee.useTime ?? 100;');
  });

  it('结构锚：984 旋斩弧 ai1 同式（曾裸 useTime——冷却值≠动画时长）', () => {
    const src = srcGame();
    expect(src).not.toContain('new SwingArc(this.player, 984, cwMelee.useTime');
    const i = src.indexOf('new SwingArc(this.player, 984,');
    expect(i).toBeGreaterThan(-1);
    // ★BJ640：×M 截断+词缀烘定（与 972 锚弧同式）
    expect(src.slice(i, i + 260)).toContain('truncCSf32Mul(roundCSf32Mul(cwMelee.useAnimation ?? cwMelee.useTime ?? 100, ps?.spd ?? 1)');
  });

  it('行为锚：SwingArc ai1=传入 animMax（下限 1）、寿命=ai1 tick', () => {
    const world = new World(120, 120, 30, 'melee-leftover');
    const player = new Player(60 * TILE, 60 * TILE, new Inventory());
    const hooks = { world, player, enemies: () => [], spawnParticles: () => {},
      playSfxFiles: () => {}, addDamageNumber: () => {} } as unknown as GameHooks;
    // 1826 无头骑士剑 ua=26、meleeSpeed=1 → ai1=26（Game 侧乘攻速后传入）
    const arc = new SwingArc(player, 997, 26, 90, 1, 1);
    expect(arc.ai1).toBe(26);
    for (let t = 0; t < 25; t++) arc.fixedUpdate(1, hooks);
    expect(arc.dead).toBe(false);          // 26 tick 寿命未到
    arc.fixedUpdate(1, hooks);
    expect(arc.dead).toBe(true);           // t=26 ≥ ai1 → Kill
    // animMax≤0 → 下限 1（Player.cs:4441-4444 base>0 → max(val,1)）
    const tiny = new SwingArc(player, 972, 0, 10, 1, 1);
    expect(tiny.ai1).toBe(1);
  });
});

// ============ ③ 变态刀 3106 潜行击退（Player.cs:44013-44016） ============
/** 最小可驱动 updateSwingHits 的 Game 原型桩（同 handover-1457-gates.test.ts 口径） */
function swingGame(heldVid: number, stealth: number) {
  const world = new World(120, 120, 30, 'melee-leftover');
  const g = Object.create(Game.prototype) as unknown as Record<string, unknown>;
  const player = new Player(50 * TILE, 90 * TILE, new Inventory());
  player.inv.add(iid(heldVid), 1);
  player.stealth = stealth;
  const enemies = [Enemy.fromVanilla(1, player.cx + 8, player.y)!];   // 僵尸在玩家右侧 → kdir=+1（y=顶对齐同 handover 口径）
  const e = enemies[0];
  const hits: Array<{ d: number; kx: number }> = [];
  const orig = e.hurt.bind(e);
  e.hurt = ((d: number, kx: number, ky: number, ga: GameHooks, pen: number, crit: boolean,
    pierce: number, fromPlayer: boolean) =>
    { hits.push({ d, kx }); return orig(d, kx, ky, ga, pen, crit, pierce, fromPlayer); }) as typeof e.hurt;
  g.swing = { t: 20, dur: 30, dmg: 10, kb: 3, item: iid(heldVid), useStyle: 1 };
  g.swingHitSet = new Set<number>();
  g.swingTileCutSet = new Set<number>();
  g.entities = { critters: [], npcs: [], enemies };
  g.player = player;
  g.world = world;
  g.sfx = { playWavFile: () => true, playFiles: () => true, play: () => {} };
  g.addDamageNumber = () => {};
  g.spawnParticles = () => {};
  g.spawnDrop = () => null;
  g.net = null;
  g.bannerNpcActive = () => false;
  g.remotePlayerProxies = [];
  g.dropContext = () => undefined;   // Enemy.hurt 灵魂条件链（桩无 scene）
  g.onEnemyKilled = () => {};        // 命中致死进死亡管线（桩无 achievements）
  return { g, player, e, hits };
}

describe('③ 变态刀 3106 潜行击退（knockBack += knockBack×(1−stealth)）', () => {
  it('满潜行 stealth=0 → 击退 ×2（kb 3 → 6）', () => {
    const { g, hits } = swingGame(3106, 0);
    (g as unknown as { updateSwingHits: () => void }).updateSwingHits();
    expect(hits).toHaveLength(1);
    expect(hits[0].kx).toBeCloseTo(6, 6);
  });

  it('无潜行 stealth=1 → 击退不变（×1）；中间值 0.5 → ×1.5', () => {
    const a = swingGame(3106, 1);
    (a.g as unknown as { updateSwingHits: () => void }).updateSwingHits();
    expect(a.hits[0].kx).toBeCloseTo(3, 6);
    const b = swingGame(3106, 0.5);
    (b.g as unknown as { updateSwingHits: () => void }).updateSwingHits();
    expect(b.hits[0].kx).toBeCloseTo(4.5, 6);
  });

  it('对照：非 3106 武器不吃潜行击退（同 stealth=0 仍 ×1）', () => {
    const { g, hits } = swingGame(3013, 0);   // 臭臭爪（melee 无 noMelee，非 3106；
    //  273 永夜刃 noMelee=true——命中全在 972 弧弹，近战盒不结算，作对照会被门挡）
    (g as unknown as { updateSwingHits: () => void }).updateSwingHits();
    expect(hits).toHaveLength(1);
    expect(hits[0].kx).toBeCloseTo(3, 6);
  });

  it('结构锚：乘区在 kbGlove/Titan(num4) 之后（原版顺序 :44008-44016）', () => {
    const src = srcGame();
    const i = src.indexOf('const kb = ((this.swing.kb ?? tool?.knockback ?? swingCombat?.knockBack ?? 3))');
    expect(i).toBeGreaterThan(-1);
    const line = src.slice(i, src.indexOf('\n', src.indexOf('swingVid === 3106', i)));
    expect(line).toContain('swingVid === 3106 ? 1 + (1 - this.player.stealth) : 1');
    expect(line.indexOf('kbGlove')).toBeGreaterThan(-1);
    expect(line.indexOf('kbGlove')).toBeLessThan(line.indexOf('3106'));
  });
});

// ============ ④ 无头骑士剑 1826 命中召南瓜弹 321（Projectile.cs:13728-13732） ============
/** 大盒敌（400×400 玩家中心）——任意旋角必与弧判定盒相交 */
const mkEnemy = (cx: number, cy: number, id = 7) => ({
  id, x: cx - 200, y: cy - 200, w: 400, h: 400, cx, cy, dead: false,
  dontTakeDamage: false, spawnedFromStatue: false,
  hits: [] as Array<[number, number]>,
  hurt(d: number, kx: number) { this.hits.push([d, kx]); return true; },
});

function arcHooks(enemy: unknown, added: unknown[]) {
  const world = new World(200, 200, 30, 'melee-leftover');
  const player = new Player(100 * TILE, 100 * TILE, new Inventory());
  const buckets: string[] = [];
  const hooks = {
    world, player,
    enemies: () => [enemy],
    critters: () => [],
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
    playSfxFile: () => {},
    showPickupLabel: () => {},
    entities: { add: (e: unknown, bucket: string) => { added.push(e); buckets.push(bucket); } },
  } as unknown as GameHooks;
  return { hooks, player, buckets };
}

describe('④ 997 命中召南瓜弹 321（HorsemansBlade_SpawnPumpkin :42444-42462）', () => {
  it('997 弧命中 → 屏外 ±半视口（±960,±600）召 321、初速 8 指向目标、ai0=目标', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);   // 恒取 +960/+600 支、无暴击/尘
    const e = mkEnemy(100 * TILE + 10, 100 * TILE + 21);
    const added: unknown[] = [];
    const { hooks, player } = arcHooks(e, added);
    const arc = new SwingArc(player, 997, 26, 90, 1, 1);
    arc.kb = 7.5;                                      // 1826 knockBack（Game 侧透传）
    arc.fixedUpdate(1, hooks);
    expect(e.hits).toEqual([[90, 6.5]]);               // 弧本体命中（ai0×6.5）
    const p = added.find((x) => x instanceof HorsemansPumpkin) as HorsemansPumpkin;
    expect(p).toBeInstanceOf(HorsemansPumpkin);
    expect(p.ai0).toBe(7);                             // ai[0]=目标 npcIndex
    expect(p.damage).toBe(90);                         // dmg=damage×1f
    expect(p.kb).toBe(7.5);                            // kb=弹体击退透传
    // 出生位 = 玩家 position + (±960, ±600)（rand(100,300) 为死值——两分支均消去）
    expect(p.cx).toBeCloseTo(player.x + 960, 6);
    expect(p.cy).toBeCloseTo(player.y + 600, 6);
    // 初速 = normalize(目标心−出生点)×8
    const dx = e.cx - p.cx, dy = e.cy - p.cy, dl = Math.hypot(dx, dy);
    expect(Math.hypot(p.vx, p.vy)).toBeCloseTo(8, 6);
    expect(p.vx).toBeCloseTo(dx / dl * 8, 6);
    expect(p.vy).toBeCloseTo(dy / dl * 8, 6);
  });

  it('随机支：rand<0.5 → −960/−600（各轴独立 50/50）', () => {
    const e = mkEnemy(100 * TILE, 100 * TILE);
    const added: unknown[] = [];
    const { hooks, player } = arcHooks(e, added);   // 先建桩（World/Player 构造不占随机队列）
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.4)     // x 轴 → −960
      .mockReturnValueOnce(0.6);    // y 轴 → +600
    const p = spawnHorsemansPumpkin(hooks, e.id, e.cx, e.cy, 90, 7.5);
    expect(p.cx).toBeCloseTo(player.x - 960, 6);
    expect(p.cy).toBeCloseTo(player.y + 600, 6);
  });

  it('对照：972 永夜刃弧命中不召南瓜（门=projId 997）；3106 门 dontTakeDamage 豁免', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const added: unknown[] = [];
    const { hooks, player } = arcHooks(mkEnemy(100 * TILE, 100 * TILE), added);
    new SwingArc(player, 972, 25, 80, 1, 1).fixedUpdate(1, hooks);
    expect(added.filter((x) => x instanceof HorsemansPumpkin)).toHaveLength(0);
    const added2: unknown[] = [];
    const e2 = mkEnemy(100 * TILE, 100 * TILE);
    e2.dontTakeDamage = true;                          // 原版 !immortal 门
    const h2 = arcHooks(e2, added2);
    new SwingArc(h2.player, 997, 26, 90, 1, 1).fixedUpdate(1, h2.hooks);
    expect(added2).toHaveLength(0);
  });

  it('南瓜 AI_055：向 ai0 收敛 v=(v×14+dir×8)/15；目标失效 1000px 曼哈顿重锁', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const e = mkEnemy(100 * TILE + 300, 100 * TILE, 7);   // 目标在正右方
    const { hooks } = arcHooks(e, []);
    const p = new HorsemansPumpkin(e.cx - 100, e.cy, 0, -8, 50, 6.5, 7);
    p.fixedUpdate(1, hooks);
    expect(p.vx).toBeCloseTo((0 * 14 + 1 * 8) / 15, 6);
    expect(p.vy).toBeCloseTo((-8 * 14 + 0 * 8) / 15, 6);
    // ai0 指向不存在的 id → 重锁到 1000px 内可见敌
    const e2 = mkEnemy(100 * TILE + 50, 100 * TILE, 9);
    const { hooks: h2 } = arcHooks(e2, []);
    const q = new HorsemansPumpkin(e2.cx - 100, e2.cy, 8, 0, 50, 6.5, 999);
    q.fixedUpdate(1, h2);
    expect(q.ai0).toBe(9);
  });

  it('南瓜命中：penetrate 1 首敌即亡、伤=弹伤（暴击×2）、kb 沿弹速方向', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);   // 无暴击
    const e = mkEnemy(100 * TILE, 100 * TILE, 7);
    const { hooks } = arcHooks(e, []);
    const p = new HorsemansPumpkin(e.cx - 20, e.cy, 8, 0, 50, 6.5, 7);
    p.fixedUpdate(1, hooks);
    expect(e.hits).toEqual([[50, 6.5]]);               // sign(vx)×kb
    expect(p.dead).toBe(true);
    // 暴击档：rand=0 → crit 强制（★S02:×2 移 Enemy.hurt 防后——spy 收未翻倍基伤）
    const e3 = mkEnemy(100 * TILE, 100 * TILE, 8);
    const { hooks: h3 } = arcHooks(e3, []);
    vi.restoreAllMocks();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const q = new HorsemansPumpkin(e3.cx - 20, e3.cy, 8, 0, 50, 6.5, 8);
    q.fixedUpdate(1, h3);
    expect(e3.hits).toEqual([[50, 6.5]]);            // ★S02(BJ723-B)改判:未翻倍基伤(旧 100=预倍形)
  });

  it('spawnHorsemansPumpkin 直调：入 projectiles 桶（NewProjectile :42462）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const added: unknown[] = [];
    const { hooks, buckets } = arcHooks(mkEnemy(100 * TILE, 100 * TILE), added);
    const p = spawnHorsemansPumpkin(hooks, 7, 100 * TILE, 100 * TILE, 90, 7.5);
    expect(added).toHaveLength(1);
    expect(buckets).toEqual(['projectiles']);
    expect(p.ai0).toBe(7);
    expect(p.w).toBe(30); expect(p.h).toBe(30);        // SetDefaults :4142-4143
  });

  it('结构锚：「暂缓」注释退役 + 997 命中处接线存在', () => {
    const src = srcArc();
    expect(src).not.toContain('暂缓');
    expect(src).toContain('if (this.projId === 997) {');
    expect(src).toContain('spawnHorsemansPumpkin(game, e.id, e.cx, e.cy, this.damage, this.kb)');
    expect(src).toContain('export class HorsemansPumpkin');
  });

  it('结构锚：mkArc 透传弹体击退（HorsemansBlade_SpawnPumpkin kb 参 :42444/:42462）', () => {
    expect(srcGame()).toContain('arc.kb = this.swing?.kb ?? cwMelee?.knockback ?? 0;');
  });
});
