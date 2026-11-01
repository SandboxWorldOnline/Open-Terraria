// ★BJ740-A（issue #30）：消费端行为锁——ACC08 蜜刺箭命中放蜂 + ACC11/12/13 圣骑士盾
// 多人链（victim-settles 镜像）。变异恰红限 Player.ts/Arrow.ts 本刀域（Game.ts 为
// BJ738 并行热文件,只测不变异）。
// 权威锚（Terarria1457 亲读）：ACC08 Projectile.cs:13945-13965（概率 0.2−蜂数×0.02、
// 6 循环偶位必发/奇位 Next(3)、beeDamage(trunc(dmg×0.05)+4)、penetrate=2）;
// ACC11 buff43 光环 :15474-15487 + 转移门 :38626-38663（受害者 defendedByPaladin）;
// ACC12 ApplyEquipFunctional m=3..9+解锁门（hasPaladinShield 置位 :15464-15485）;
// ACC13 Hurt :38649 pvp:false/PaladinsShield 桶/dodgeable:false + 入口 :38493-38499
// ImmuneTimerOnlyLimitsEffects + Retaliate &flag :38690。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Player } from '../src/entities/Player';
import { Arrow } from '../src/entities/Arrow';
import { Inventory } from '../src/items/Inventory';
import { TileStore } from '../src/world/TileStore';
import { Game } from '../src/core/Game';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { HurtCooldownBuckets, ImmunityCooldownID, registerGlobalHurtBuckets, getGlobalHurtBuckets } from '../src/player/HurtCooldownBuckets';
import { withMutation } from './mutation-guard';
import type { GameHooks } from '../src/entities/types';

const iid = (vid: number): number => {
  const k = vanillaItemKey(vid);
  const found = k ? ITEM_BY_KEY[k] : undefined;
  if (found === undefined) throw new Error(`vid ${vid} 未注册`);
  return found;
};

// ============ ACC08：蜜刺 6184 箭命中放蜂（Projectile.cs:13945-13965） ============
interface MockEnemy {
  id: number; x: number; y: number; w: number; h: number; dead: boolean;
  cx: number; cy: number; hp: number; maxHp?: number; vanillaId?: number;
  poisonT?: number; onFireT?: number;
  hurt: (d: number, kx: number, ky: number, g: GameHooks) => boolean; hits: number[];
}
const mkEnemy = (id: number, cx: number, cy: number, w = 16, h = 24): MockEnemy => {
  const e: MockEnemy = {
    id, x: cx - w / 2, y: cy - h / 2, w, h, dead: false, cx, cy, hp: 100000, maxHp: 100000, hits: [],
    hurt: (d: number) => { e.hp -= d; e.hits.push(d); return true; },
  };
  return e;
};
function makeHooks(enemies: MockEnemy[] = [], preBees: Arrow[] = []) {
  const store = new TileStore(200, 120);
  for (let x = 0; x < 200; x++) for (let y = 100; y < 120; y++) store.setTile(x, y, 1);
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const added: unknown[] = [];
  const hooks: GameHooks = {
    world: { store } as never,
    player: player as never,
    enemies: () => enemies,
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
    showPickupLabel: () => {},
  };
  (hooks as unknown as { entities: { add: (e: unknown, b: string) => void; projectiles: unknown[] } }).entities = {
    add: (e: unknown) => { added.push(e); },
    projectiles: preBees,
  };
  return { hooks, store, player, added };
}
const step = (list: unknown[], ticks: number, hooks: GameHooks): void => {
  for (let i = 0; i < ticks; i++) {
    for (const e of list) {
      const p = e as { dead: boolean; fixedUpdate: (dt: number, g: GameHooks) => void };
      if (!p.dead) p.fixedUpdate(1, hooks);
    }
  }
};

describe('BJ740-A ACC08：蜜刺 6184 箭命中放蜂', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('箭命中 → 0.2 概率过 → 6 循环全发（偶位必发+奇位 Next(3)）→ 6 只 181 蜂,dmg=trunc(箭伤×0.05)+4,penetrate=2', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);   // 概率 0<0.2 ✓ 奇位 0%3==0 ✓ 弱蜂档
    const e = mkEnemy(9, 60 * 16 + 100, 90 * 16);
    const { hooks, player, added } = makeHooks([e]);
    player.inv.armor[3] = { id: iid(6184), stack: 1 };   // 蜜刺（accHoneyedBarb）
    const arrow = new Arrow(e.x - 60, e.y + 4, 8, 0, 100, 1, 1, { grav: 0, life: 60 });   // 木箭 ∈ VANILLA_ARROW_PROJS
    step([arrow], 20, hooks);
    const bees = added.filter((a) => a instanceof Arrow && (a as Arrow).projId === 181) as Arrow[];
    expect(bees.length).toBe(6);
    expect(bees[0].damage).toBe(Math.trunc(100 * 0.05) + 4);   // 9（弱蜂 +Next(2)=0 档）
    expect(bees[0].pierce).toBe(2);                            // :13964 覆写表值 3
    expect(bees[0].frostEligible).toBe(true);                  // ranged=true（:13962-13963）
  });

  it('在场蜂数衰减门：11 只在场蜂 → 0.2−11×0.02=−0.02 → 不放', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const e = mkEnemy(10, 60 * 16 + 100, 90 * 16);
    const preBees: Arrow[] = [];
    for (let i = 0; i < 11; i++) preBees.push(new Arrow(0, 0, 0, 0, 5, 0, 181, {}));
    const { hooks, player, added } = makeHooks([e], preBees);
    player.inv.armor[3] = { id: iid(6184), stack: 1 };
    const arrow = new Arrow(e.x - 60, e.y + 4, 8, 0, 100, 1, 1, { grav: 0, life: 60 });
    step([arrow], 20, hooks);
    const bees = added.filter((a) => a instanceof Arrow && (a as Arrow).projId === 181);
    expect(bees.length).toBe(0);
  });

  it('无蜜刺（裸玩家）→ 箭命中零放蜂（消费门=accHoneyedBarb）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const e = mkEnemy(11, 60 * 16 + 100, 90 * 16);
    const { hooks, added } = makeHooks([e]);
    const arrow = new Arrow(e.x - 60, e.y + 4, 8, 0, 100, 1, 1, { grav: 0, life: 60 });
    step([arrow], 20, hooks);
    expect(added.filter((a) => a instanceof Arrow && (a as Arrow).projId === 181).length).toBe(0);
  });
});

// ============ ACC11/12/13：圣骑士盾多人链（Game.prototype 夹具） ============
type GameLike = Record<string, unknown> & {
  damagePlayer: (...a: unknown[]) => number;
  netApplyStrikePlayer: (fromSlot: number, dmg: number, weaponId: number, flags: number) => void;
  hasPaladinShield: (pl: unknown) => boolean;
};
const mkGame = (p: Player, opts: {
  proxies?: Player[]; netOverride?: Record<string, unknown>; pvpAllowed?: boolean;
} = {}): { g: GameLike; strikes: unknown[][] } => {
  const strikes: unknown[][] = [];
  const g = Object.create(Game.prototype) as GameLike;
  g.player = p;
  g.world = { difficulty: 0, flags: {}, seedFlags: {} };
  g.net = {
    active: true, mySlot: 0,
    policy: { pvpAllowed: opts.pvpAllowed ?? true },
    players: new Map([[1, { active: true, x: 0, team: 1 }]]),
    notifyPlayerHurtSettled: () => {},
    sendPlayerHurt: () => {},
    sendStrikePlayer: (...a: unknown[]) => { strikes.push(a); },
    ...opts.netOverride,
  };
  g.remotePlayerProxies = opts.proxies ?? [];
  g.recLog = () => {};
  g.addDamageNumber = () => {};
  g.playSfx = () => {};
  g.playSfxFiles = () => {};
  g.playSfxWav = () => {};     // playHurtVoice 消费（Game.prototype 真身读 this.sfx——测试须覆写）
  g.playSfxFile = () => {};
  g.spawnParticles = () => {};
  g.entities = { projectiles: [], add: () => {} };
  g.cb = { onInventoryChanged: () => {} };
  g.bannerNpcActive = () => false;
  return { g, strikes };
};
const mkHolder = (): Player => {
  const h = new Player(0, 0, new Inventory());
  h.team = 1;
  h.inv.armor[3] = { id: iid(938), stack: 1 };   // 圣骑士盾
  (h as unknown as { __netSlot?: number }).__netSlot = 5;
  return h;
};

describe('BJ740-A ACC12：hasPaladinShield 槽域（3..9+解锁门）', () => {
  it('功能槽 938 → true;时装槽 13 → false;锁格 8（无恶魔心）→ false;HP≤25% → false', () => {
    const { g } = mkGame(new Player(0, 0, new Inventory()));
    const fn = mkPlayer938();
    fn.inv.armor[3] = { id: iid(938), stack: 1 };
    expect(g.hasPaladinShield(fn)).toBe(true);
    const van = mkPlayer938();
    van.inv.armor[13] = { id: iid(938), stack: 1 };   // 时装槽不授（旧扫 3..19 误收）
    expect(g.hasPaladinShield(van)).toBe(false);
    const locked = mkPlayer938();
    locked.inv.armor[8] = { id: iid(938), stack: 1 }; // 恶魔心格未解锁（Inventory 默认锁）
    expect(g.hasPaladinShield(locked)).toBe(false);
    const lowHp = mkPlayer938();
    lowHp.inv.armor[3] = { id: iid(938), stack: 1 };
    lowHp.hp = 10;                                     // ≤25%（maxHp 100）
    expect(g.hasPaladinShield(lowHp)).toBe(false);
  });
});
const mkPlayer938 = (): Player => new Player(0, 0, new Inventory());

describe('BJ740-A ACC11：转移发起门 = 受害者 defendedByPaladin（非自持盾）', () => {
  it('无盾受害者 + defendedByPaladinT>0 + 同队近距盾持有者 → bit5 转移发包 + 25% 退款', () => {
    const p = new Player(0, 0, new Inventory());
    p.team = 1;
    (p as unknown as { defendedByPaladinT: number }).defendedByPaladinT = 20;   // buff43 镜像在身
    const { g, strikes } = mkGame(p, { proxies: [mkHolder()] });
    g.damagePlayer(40, 0, 0);   // 无 attacker（环境伤族也可转移,原版 Hurt 全路径）
    expect(strikes.length).toBe(1);
    expect(strikes[0]).toEqual([5, 10, 0, 0, -1, 0x20]);   // __netSlot 5, transfer=floor(40×0.25)
    expect(p.hp).toBe(100 - 40 + (40 - Math.floor(40 * 0.75)));   // 70（退款 10）
  });
  it('defendedByPaladinT=0（无光环）→ 零发包（旧面误读自持盾——无盾队友被保护的场景）', () => {
    const p = new Player(0, 0, new Inventory());
    p.team = 1;
    const { g, strikes } = mkGame(p, { proxies: [mkHolder()] });
    g.damagePlayer(40, 0, 0);
    expect(strikes.length).toBe(0);
    expect(p.hp).toBe(60);   // 全额自担
  });
});

describe('BJ740-A ACC13：转移接收 = 完整 Hurt（pvp:false/桶5/dodgeable:false）', () => {
  afterEach(() => { registerGlobalHurtBuckets(null); vi.restoreAllMocks(); });

  it('①房规禁 PvP 不拦转移（pvp:false 非 PvP 攻击）+ 桶5冷却写回', () => {
    registerGlobalHurtBuckets(new HurtCooldownBuckets());
    const p = new Player(0, 0, new Inventory());
    p.team = 1;
    const { g } = mkGame(p, { pvpAllowed: false });
    g.netApplyStrikePlayer(1, 40, 0, 0x20);
    expect(p.hp).toBe(60);                                  // 照扣（旧 pvpAllowed 门整包 return）
    expect(getGlobalHurtBuckets()?.remaining(ImmunityCooldownID.PaladinsShield)).toBeGreaterThan(0);
  });
  it('②冷却窗内后续转移照扣（ImmuneTimerOnlyLimitsEffects——旧 paladinShieldCd>0 整包丢）', () => {
    registerGlobalHurtBuckets(new HurtCooldownBuckets());
    const p = new Player(0, 0, new Inventory());
    p.team = 1;
    const { g } = mkGame(p);
    g.netApplyStrikePlayer(1, 40, 0, 0x20);
    g.netApplyStrikePlayer(1, 40, 0, 0x20);                 // 同冷却窗第二包
    expect(p.hp).toBe(20);                                  // 两包各扣 40
  });
  it('③dodgeable:false——黑带 984 持有者对转移包不掷闪避（普通伤害同掷仍闪避）', () => {
    registerGlobalHurtBuckets(new HurtCooldownBuckets());
    vi.spyOn(Math, 'random').mockReturnValue(0);            // 黑带 10% 掷必中（0<0.1）
    const p = new Player(0, 0, new Inventory());
    p.team = 1;
    p.inv.armor[3] = { id: iid(984), stack: 1 };            // blackBelt（忍王足具）
    const { g } = mkGame(p);
    g.netApplyStrikePlayer(1, 40, 0, 0x20);
    expect(p.hp).toBe(60);                                  // 转移包不吃闪避（:38649 dodgeable:false）
    // 对照：普通伤害（dodgeable=true）同掷 → 闪避归零
    const ctrl = new Player(0, 0, new Inventory());
    ctrl.inv.armor[3] = { id: iid(984), stack: 1 };
    expect(ctrl.damage(40, 0, 0, false, false)).toBe(0);
    expect(ctrl.hp).toBe(100);
  });
});

// ============ 变异恰红（Player.ts/Arrow.ts;Game.ts 并行域只测不变异） ============
describe('BJ740-A 消费端变异恰红', () => {
  const PLAYER = join(process.cwd(), 'src', 'entities', 'Player.ts');
  const ARROW = join(process.cwd(), 'src', 'entities', 'Arrow.ts');
  const spawnVitest = (filter: string) => spawnSync(
    'npx', ['vitest', 'run', 'tests/bj740a-paladin-honeyedbarb.test.ts', '--no-file-parallelism', '-t', filter], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 300_000,
      // ★BJ743-A（R24 SEV-5 衍生）：补 *_MUT 家族旗——变异子 vitest 免三 vite 钩子
      //   审计（BJ728-A skipAuditsForMutChildren 判据 = env *_MUT$|*_MUT_SKIP$）。
      env: { ...process.env, SW_BJ740A_MUT: '1' },
    });
  const mutate = (file: string, trigger: string, replacement: string, filter: string): void => {
    withMutation(file, trigger, replacement, () => {
      const r = spawnVitest(filter);
      expect(r.status, `变异须证红: ${replacement.slice(0, 60)}`).not.toBe(0);
      expect(r.stdout).toContain(filter);
    }, { label: `BJ740A-2 ${filter}` });
  };

  it('M9 ACC08 概率门杀（< 0.2−n×0.02 → < −1 恒假）→ 放蜂锁红', () => {
    mutate(ARROW,
      'if (Math.random() < 0.2 - beeCount * 0.02) {',
      'if (Math.random() < -1) { /* BJ740A-M9 */',
      '箭命中 → 0.2 概率过');
  });
  it('M10 ACC13 桶例外摘除（PaladinsShield 回早退）→ 冷却窗第二包锁红', () => {
    mutate(PLAYER,
      '&& effBucketId !== ImmunityCooldownID.PaladinsShield) {',
      ') { /* BJ740A-M10 */',
      '冷却窗内后续转移照扣');
  });
  it('M11 ACC13 dodgeable 门摘除（黑带掷复活）→ 转移包不闪避锁红', () => {
    mutate(PLAYER,
      'if (dodgeable && eq.blackBelt && Math.random() < 0.1) {',
      'if (eq.blackBelt && Math.random() < 0.1) { /* BJ740A-M11 */',
      '黑带 984 持有者对转移包不掷闪避');
  });
});
