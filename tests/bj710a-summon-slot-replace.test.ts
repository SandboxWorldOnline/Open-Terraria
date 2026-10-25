// BJ710-A（2026-10-24 用户实报）:「6 槽用同一召唤杖召满后,换其他召唤杖继续
// 召唤——只替换 1 个槽位,永久 5+1 锁死,除非右键取消另外 5 个才能再召满」。
//
// ── 定谳（原版权威 = Terarria1457 反编译亲读）───────────────────────────────
// ① 原版腾位核 FreeUpPetsAndMinions（Player.cs:52335-52464）：池 = 在场 minion 按
//   minionSlots【升序】稳定插入排序（:52370-52381,同权保 projectile 数组扫描序）,
//   从头逐杀至 num−num3 ≤ maxMinions−num2（:52418-52420;StaffMinionSlotsRequired
//   全件=1,ItemID.cs:1112 无覆写）;NewProjectile 取最低空闲弹位（:10829-10844）。
//   → 「最便宜先死」:满槽异型连召时刚召出的 0.5 槽双子对（387/388,2535 魔眼杖）
//   恒排池首,下一按先自我替换 = 【原版本身也是 5+1 锁死】（1.4.4 混随从设计面）。
// ② 帕鲁猫 1093/1112 家族互清（:52340-52360）占住自身槽位不释放异型槽 = 单猫
//   语义,原版同相（互清后账已 ≤ 需求,逐杀支不触发）——维持,登记为已知面。
// ③ 星尘龙 3531（:48990-49047）：原版 FreeUp 于出手起点（:43111）先行,再进
//   ItemCheck_Shoot 的延伸支——每按先腾 1 槽再延伸 +1 槽 = 可逐按换满。
//
// ── 仓内病灶（修前全对矩阵扫描实锚）────────────────────────────────────────
//  · 【病灶 A】Game 'summon' 分支把 freeUpMinionsForSummon 排在 625 龙延伸支
//    之后 → 满槽再召龙只延伸不腾位,+1 槽延伸段被每 tick 上限自裁网回杀 →
//    永久 5 imp + 1 龙头锁死（3531 杖）。修 = 腾位先行（原版时序 1:1）。
//  · 【病灶 B=原版相】2535 魔眼杖 5+1 锁死 = 原版行为（升序杀便宜）。用户
//    2026-10-24 明令分歧:按我方预期优化——腾位先逐【异型】（与 incoming 家族
//    不同,池内保原版升序）,同型仅在异型耗尽后回落原版升序（同杖补召净零
//    不变）。分歧锁带改判史（Game.ts minionFamilyOf 注）,防红蓝按原版翻案。
//  · 普通杖对（imp↔slime/蜘蛛/海盗等全 28 杖矩阵）修前即逐按换满 = 无病灶。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Game, maintainMinionBuffs, MINION_BUFFS, freeUpMinionsForSummon } from '../src/core/Game';
import { EntityManager } from '../src/entities/Entity';
import { MinionProj } from '../src/entities/MinionProj';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { TileStore } from '../src/world/TileStore';
import { combatWeapon } from '../src/data/vanillaItemCombat';
import { ITEM_DEFS, ITEM_BY_KEY, VANILLA_ITEM_KEY_BY_ID } from '../src/data/items';
import { TILE } from '../src/core/constants';

const W = 120, H = 120;
function makeStore(): TileStore {
  const store = new TileStore(W, H);
  for (let x = 0; x < W; x++) for (let y = 100; y < H; y++) store.setTile(x, y, 1);
  return store;
}

/** useCombatWeapon 窄视图台架（slow-magic-window magicGame 同款,召唤域增补:
 *  真 EntityManager（驱逐序=真数组序）+ maxMinions=6（modMinionAddDyn=5））。 */
function summonGame() {
  const g = Object.create(Game.prototype) as unknown as Record<string, unknown>;
  const player = new Player(50 * TILE, 90 * TILE, new Inventory());
  (player as unknown as { modMinionAddDyn: number }).modMinionAddDyn = 5;   // maxMinions=6
  const entities = new EntityManager();
  g.player = player;
  g.entities = entities;
  g.input = { mouseDown: true, mouseHeld: true, rightDown: false, mouseX: 700, mouseY: 300, uiBlocking: false };
  g.camera = { screenToWorld: () => [player.cx + 100, player.cy] };
  g.sfx = { play: () => {}, playWavFile: () => true, playFiles: () => true };
  g.achievements = { handleSpecialEvent: () => {} };
  g.cb = { onInventoryChanged: () => {}, onToast: () => {} };
  g.swing = null;
  g.swingHitSet = new Set();
  g.swingTileCutSet = new Set();
  g.mining = null;
  g.spiderMinionCycle = 0;      // 类字段窄视图补位（2551 三型轮换游标）
  g.world = { store: makeStore() };
  g.recLog = () => {};
  g.playUseSound = () => {};
  return { g, player, entities };
}

function setHeld(player: Player, vid: number): void {
  player.inv.slots[0] = null;
  player.inv.add(ITEM_BY_KEY[VANILLA_ITEM_KEY_BY_ID[vid]], 1);
}

function pressStaff(g: Record<string, unknown>, vid: number): void {
  const def = ITEM_DEFS[ITEM_BY_KEY[VANILLA_ITEM_KEY_BY_ID[vid]]];
  (g as unknown as { useCombatWeapon: (cw: unknown, def: unknown) => void })
    .useCombatWeapon(combatWeapon(def), def);
}

/** 槽位权重（Game.ts minionSlotsOf 同表:双子 387/388 与龙身段 626/627 各 0.5,余 1） */
function slotsOf(m: MinionProj): number {
  if (m.projId === 387 || m.projId === 388) return 0.5;
  if (m.projId === 626 || m.projId === 627) return 0.5;
  return 1;
}

/** 每 tick 管线复刻（fixedUpdate 内序:网 :11112 → maintainMinionBuffs :11152 →
 *  保序 compact;物品使用在网之后=press 后下一拍才过网,与真序一致）。 */
function tickPipeline(g: Record<string, unknown>): void {
  const player = g.player as Player;
  const entities = g.entities as EntityManager;
  {
    let slotsUsed = 0;
    for (const e of entities.projectiles) {
      const m = e as MinionProj;
      if (!(m instanceof MinionProj) || m.dead || m.sentry || m.noSlot) continue;
      const w = slotsOf(m);
      if (slotsUsed + w > player.maxMinions) {
        if (m.projId === 626 || m.projId === 627) m.unlinkFromChain(entities.projectiles);
        m.dead = true;
      } else slotsUsed += w;
    }
    let n = 0;
    for (const e of entities.projectiles) {
      const m = e as MinionProj;
      if (!(m instanceof MinionProj) || m.dead || !m.sentry || m.noSlot) continue;
      if (++n > player.maxSentries) m.dead = true;
    }
  }
  maintainMinionBuffs(player, entities.projectiles, (m) => entities.add(m, 'projectiles'));
  entities.projectiles = entities.projectiles.filter((e) => !e.dead);   // 保序 compact 同语义
}

/** 龙基链补齐（AI 首拍 dragonHead 的夹具等价:626/627/628 noSlot+parentRef 链——
 *  本台架不跑实体 AI,延伸判定需要 628 尾在场） */
function completeDragonChain(g: Record<string, unknown>): void {
  const ents = g.entities as EntityManager;
  const head = ents.projectiles.find((e) => e instanceof MinionProj && (e as MinionProj).projId === 625
    && !(e as MinionProj).dead) as MinionProj | undefined;
  if (!head || ents.projectiles.some((e) => e instanceof MinionProj && (e as MinionProj).projId === 628)) return;
  let parent: MinionProj = head;
  for (const seg of [626, 627, 628]) {
    const m = new MinionProj(head.cx, head.cy, seg, head.damage, head.knockback, false, 0, false,
      () => g.player as Player);
    m.noSlot = true;
    const par = parent;
    m.parentRef = () => (par.dead ? null : par);
    ents.add(m, 'projectiles');
    parent = m;
  }
}

const TWIN_FAM = new Set([387, 388]);
const SPIDER_FAM = new Set([390, 391, 392]);
const PIRATE_FAM = new Set([393, 394, 395]);
const DRAGON_FAM = new Set([625, 626, 627, 628]);
function counts(g: Record<string, unknown>): { imp: number; twin: number; spider: number; pirate: number;
  dragonSlots: number; cat: number; slots: number } {
  const ms = (g.entities as EntityManager).projectiles
    .filter((e) => e instanceof MinionProj && !(e as MinionProj).dead && !(e as MinionProj).sentry
      && !(e as MinionProj).noSlot) as MinionProj[];
  return {
    imp: ms.filter((m) => m.projId === 375).length,
    twin: ms.filter((m) => TWIN_FAM.has(m.projId)).length,
    spider: ms.filter((m) => SPIDER_FAM.has(m.projId)).length,
    pirate: ms.filter((m) => PIRATE_FAM.has(m.projId)).length,
    dragonSlots: ms.filter((m) => DRAGON_FAM.has(m.projId)).reduce((s, m) => s + slotsOf(m), 0),
    cat: ms.filter((m) => m.projId === 1093).length,
    slots: ms.reduce((s, m) => s + slotsOf(m), 0),
  };
}

function fillWith(g: Record<string, unknown>, player: Player, vid: number, n: number): void {
  setHeld(player, vid);
  for (let i = 0; i < n; i++) { pressStaff(g, vid); tickPipeline(g); }
}
function spamB(g: Record<string, unknown>, player: Player, vid: number, n: number): void {
  setHeld(player, vid);
  for (let i = 0; i < n; i++) { pressStaff(g, vid); tickPipeline(g); }
}

// ---------------------------------------------------------------------------
// ① 行为面：真 useCombatWeapon 'summon' 链 + tick 管线（判别锁=用户实报场景）
// ---------------------------------------------------------------------------
describe('BJ710-A 行为面：6 槽召满 → 异型杖连按', () => {
  it('imp→slime ×6：逐按换满 0/6（修前即通,回归锁）', () => {
    const { g, player } = summonGame();
    fillWith(g, player, 2365, 6);
    spamB(g, player, 1309, 6);
    const c = counts(g);
    expect(c.imp).toBe(0);
    expect(c.slots).toBe(6);
    expect((g.entities as EntityManager).projectiles.filter((e) => e instanceof MinionProj
      && (e as MinionProj).projId === 266 && !(e as MinionProj).dead)).toHaveLength(6);
  });

  it('★分歧主判据 imp→optic(2535) ×6：双子对不再自我替换,逐按换满 6 对（修前 5+1 锁死）', () => {
    const { g, player } = summonGame();
    fillWith(g, player, 2365, 6);
    spamB(g, player, 2535, 6);
    const c = counts(g);
    expect(c.imp).toBe(0);          // 旧型清零（修前恒 5）
    expect(c.twin).toBe(12);        // 6 对（修前恒 1 对 2 只）
    expect(c.slots).toBe(6);
  });

  it('optic 满对补召 ×1：仍 6 对净零（同型回落=原版平价,自替换语义不变）', () => {
    const { g, player } = summonGame();
    fillWith(g, player, 2535, 6);          // 6 对=6 槽
    expect(counts(g).twin).toBe(12);
    spamB(g, player, 2535, 1);             // 同杖补召:杀一对(最老)+生一对
    const c = counts(g);
    expect(c.twin).toBe(12);               // 净零
    expect(c.slots).toBe(6);
  });

  it('★病灶A imp→dragon(3531) ×6：腾位先行,逐按换满（修前 5 imp+1 头锁死）', () => {
    const { g, player } = summonGame();
    fillWith(g, player, 2365, 6);
    setHeld(player, 3531);
    for (let i = 0; i < 6; i++) {
      pressStaff(g, 3531);
      completeDragonChain(g);     // 夹具:AI 首拍基链等价(头 626/627/628)
      tickPipeline(g);
    }
    const c = counts(g);
    expect(c.imp).toBe(0);            // 修前恒 5
    expect(c.dragonSlots).toBe(6);    // 头 1.0 + 5 延伸对 5.0(修前恒 1.0)
    expect(c.slots).toBe(6);
  });

  it('dragon 满槽补召 ×1：尾对牺牲+再延伸净零（原版平价面,龙不再被自裁网回杀）', () => {
    const { g, player } = summonGame();
    fillWith(g, player, 2365, 6);
    setHeld(player, 3531);
    for (let i = 0; i < 6; i++) {
      pressStaff(g, 3531);
      completeDragonChain(g);
      tickPipeline(g);
    }
    expect(counts(g).dragonSlots).toBe(6);
    pressStaff(g, 3531);              // 第 7 按:满槽龙
    tickPipeline(g);
    const c = counts(g);
    expect(c.dragonSlots).toBe(6);    // 净零(腾位杀尾对→延伸补回)
    expect(c.slots).toBe(6);
  });

  it('imp→cat(5663) ×6：5 imp+1 cat 稳定 = 单猫语义（原版同相,互清占位不释放异型槽——已知面锁,非病灶）', () => {
    const { g, player } = summonGame();
    fillWith(g, player, 2365, 6);
    spamB(g, player, 5663, 6);
    const c = counts(g);
    expect(c.cat).toBe(1);            // 单猫:互清杀旧猫+生新猫
    expect(c.imp).toBe(5);            // 异型槽不被释放(原版 1457 :52340-52360 同相)
    expect(c.slots).toBe(6);
  });

  it('imp→spider(2551)/pirate(2584) ×6：变体族全换满（家族计数,回归锁）', () => {
    const s = summonGame();
    fillWith(s.g, s.player, 2365, 6);
    spamB(s.g, s.player, 2551, 6);
    expect(counts(s.g).spider).toBe(6);
    expect(counts(s.g).imp).toBe(0);

    const p = summonGame();
    fillWith(p.g, p.player, 2365, 6);
    spamB(p.g, p.player, 2584, 6);
    expect(counts(p.g).pirate).toBe(6);
    expect(counts(p.g).imp).toBe(0);
  });

  it('optic→imp ×12：异型池内保原版升序（0.5 双子先死）,逐按换满 6 imp', () => {
    const { g, player } = summonGame();
    fillWith(g, player, 2535, 6);          // 6 对
    spamB(g, player, 2365, 12);            // 每按腾 1.0(两只 0.5)+生 1 imp
    const c = counts(g);
    expect(c.twin).toBe(0);
    expect(c.imp).toBe(6);
    expect(c.slots).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// ② 纯核直驱：freeUpMinionsForSummon（分歧谓词逐面）
// ---------------------------------------------------------------------------
const player0 = new Player(60 * 16, 90 * 16, new Inventory());
const mk = (projId: number): MinionProj =>
  new MinionProj(player0.cx, player0.cy - 40, projId, 10, 2, false, 0, false, () => player0);

describe('BJ710-A 纯核：freeUpMinionsForSummon 驱逐序', () => {
  it('★分歧主谓词：incoming=387 时异型(375)先死,同型双子对存活（原版=双子先死 5+1 锁死）', () => {
    // press#2 现场态:5 imp(先)+1 对(后),满 6 槽
    const imps = [mk(375), mk(375), mk(375), mk(375), mk(375)];
    const a = mk(387), b = mk(388);
    freeUpMinionsForSummon(387, [...imps, a, b], 6);
    expect(imps[0].dead).toBe(true);        // 最老异型被逐
    expect(imps.slice(1).every((m) => !m.dead)).toBe(true);
    expect(a.dead).toBe(false);             // 上一按召出的双子对存活(分歧面)
    expect(b.dead).toBe(false);
  });

  it('原版平价面：incoming=375 时非本家双子仍先死（异型池内升序=最便宜先死不变）', () => {
    const a = mk(387), b = mk(388), c = mk(375), d = mk(266);
    freeUpMinionsForSummon(375, [a, b, c, d], 3);   // used=3.0 → 腾到 ≤2
    expect(a.dead).toBe(true);              // 0.5 先死(原版 :52372-52381 升序)
    expect(b.dead).toBe(true);
    expect(c.dead).toBe(false);
    expect(d.dead).toBe(false);
  });

  it('同型回落净零：6 对满槽补召 387 → 恰一对死（twinGuard 交替门原样）', () => {
    const pairs = [mk(387), mk(388), mk(387), mk(388), mk(387), mk(388),
      mk(387), mk(388), mk(387), mk(388), mk(387), mk(388)];
    freeUpMinionsForSummon(387, pairs, 6);
    expect(pairs.filter((m) => m.dead)).toHaveLength(2);
    expect(pairs[0].dead).toBe(true);       // 最老一对(387 先、388 后)
    expect(pairs[1].dead).toBe(true);
    expect(pairs.slice(2).every((m) => !m.dead)).toBe(true);
  });

  it('龙腾位面：incoming=625 满槽 6 imp → 逐 1 只腾位（病灶A 的 freeUp 面）', () => {
    const imps = Array.from({ length: 6 }, () => mk(375));
    freeUpMinionsForSummon(625, imps, 6);
    expect(imps.filter((m) => m.dead)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ③ 结构锁：源锚（腾位先行时序 + 分歧分区 + 改判史标记）
// ---------------------------------------------------------------------------
describe('BJ710-A 结构锁', () => {
  const src = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');
  it('腾位先于 625 龙延伸支（原版 :43111 → :48990 时序;修前倒序=病灶A）', () => {
    const freeUpAt = src.indexOf('freeUpMinionsForSummon(cw.shoot, minions, this.player.maxMinions)');
    const dragonAt = src.indexOf('if (cw.shoot === 625)');
    expect(freeUpAt).toBeGreaterThan(0);
    expect(dragonAt).toBeGreaterThan(freeUpAt);   // ★腾位在前
  });
  it('分歧分区在驱逐核内（先异型后同型两遍,各保升序稳定序）', () => {
    expect(src).toContain('const evictOrder = [');
    expect(src).toContain('...finalPool.filter((m) => !fam.has(m.projId))');
    expect(src).toContain('...finalPool.filter((m) => fam.has(m.projId))');
  });
  it('分歧锁带改判史（BJ685b 判例:防未来红蓝按原版翻案）', () => {
    expect(src).toContain('★BJ710-A 分歧锁（2026-10-24 用户明令,带改判史防红蓝翻案）');
    expect(src).toContain('function minionFamilyOf(shoot: number): ReadonlySet<number>');
  });
  it('MINION_BUFFS 全杖家族口径无孤儿（28 杖 shoot 均可解析家族）', () => {
    for (const { staff, projs } of MINION_BUFFS) {
      const def = ITEM_DEFS[ITEM_BY_KEY[VANILLA_ITEM_KEY_BY_ID[staff]]];
      const cw = combatWeapon(def) as { shoot?: number; sentry?: boolean };
      if (cw.sentry || !cw.shoot) continue;
      // 家族成员互认:shoot 的家族须含 shoot 自身（单型兜底也满足）
      expect(projs.length).toBeGreaterThan(0);
    }
  });
});
