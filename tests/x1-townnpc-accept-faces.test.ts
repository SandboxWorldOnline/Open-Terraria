// ★清偿刀 X1（2026-10-01）：城镇 NPC 受理面家族收编——W1 登记六面逐面落刀判别。
// 定谳锚（Terarria1457 亲读,报告单为准）：
//   face 1  Damage_PVE_Inner :13634 StatusNPC(victimIndex)（内含 ApplyWhipDebuffs
//           :11067-11090 / meleeEnchant 浸剂 :11197-11221 / 催化指环 :11189-11196）
//           ——城镇 NPC 原版有完整 buffType/buffTime（NPC.AddBuff :91035 全体同构）,
//           DoT=UpdateNPC_BuffApplyDOTs :92577-92847。仓内=TownNPC 载体集+tickDebuffs。
//   face 2  :13640-43 TryDoingOnHitEffects（life>5 受击前值）→ Player.OnHit
//           :6912-7040（钛金/幻影闪避/帕拉钯/山铜花瓣;叶绿水晶叶 :6988 CanBeChasedBy
//           门=城镇 friendly 恒假→结构性排除）。来源排除表 :15210-15220。
//   face 3  :13687-96 nano ×1.05 / party 彩带 289（门 (melee||IsAWhip),鞭走 IsAWhip）。
//   face 4  :13712 flag10 = num41>0∧lifeMax>5∧friendly∧!hostile∧aiStyle≠59 →
//           :13869-77 canGhostHeal 缺省 true（NPC.cs:6270）→ ghostHeal（白耗面）。
//   face 5  :13976/:14012 proc 窗启用（{913,1031,1032} localAI[0] 门/{847,1033,1035}
//           无条件）。:13711 OnHit 消费半面 CanRunHitEffects=随从/哨兵弹限定
//           （WhipTagEffect.cs:95-105）→ 鞭自体命中恒不消费=不调用（原版同相）。
//   face 6  ★W1 锚勘误：GRAVE_MISTAKE=墓碑弹杀【城镇 NPC】（Player.OnKillNPC
//           :20623-20636 IsAGravestone∧townNPC）/队友玩家（Player.KillMe
//           :39133-39137）,非"鞭杀向导"——OnKillNPC(ref attempt, 鞭) 体仅 item 5096
//           自buff+墓碑两支,鞭杀向导零效果。墓碑链已在 Tombstone.applyDamage 接线。
// 变异证红三发（sha256 对拍逐字节还原）：①tickDebuffs 15→16（face1 红）②face2
// hp>5→hp>0（残血豁免红）③ghostHealProc 实参 preHits→自增后（face4 红）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { World } from '../src/world/World';
import { TownNPC } from '../src/entities/TownNPC';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { WhipProj, applyWhipDebuffs } from '../src/entities/WhipProj';
import { ConfettiBurstProj } from '../src/entities/meleeOnHitProjs';
import { hitTownNpcs } from '../src/entities/projTargets';
import { applyProjStatus, applyBuffTicks, applyMeleeImbue } from '../src/entities/projStatus';
import { Tombstone } from '../src/entities/Tombstone';
import { WHIP_PROC_ITEMS } from '../src/entities/WhipTag';
import { BuffType } from '../src/stats/Buffs';
import { VANILLA_NPCS } from '../src/data/vanillaNpcs';
import { TILE_BY_KEY } from '../src/data/tiles';
import type { GameHooks } from '../src/entities/types';

const DIRT = TILE_BY_KEY['dirt']!;
const GROUND = 100;
const realRandom = Math.random;
afterEach(() => { Math.random = realRandom; vi.restoreAllMocks(); });

const GUIDE_DEF = VANILLA_NPCS['22'].defense ?? 30;   // 向导 def=30（vanilla-npcs.json）

/** 平地世界（20..180 行 GROUND 实心） */
function flatWorld(label = 'x1-faces') {
  const world = new World(200, 200, GROUND, label);
  for (let x = 20; x <= 180; x++) world.store.setTileSilent(x, GROUND, DIRT);
  world.clock.timeOfDay = 0.5;
  return world;
}

const guideAt = (x: number, y: number) => new TownNPC('guide', x, y);

/** 完整 hooks 桩（死亡链/成就/治疗球观测位齐备） */
function makeHooks(world: World, player: unknown, npcs: unknown[], enemies: unknown[] = []) {
  const lifeSteal: Array<{ kind: string; dmg: number; numHits: number; isMagic: boolean }> = [];
  const ach: number[] = [];
  const shards: Array<[number, number]> = [];
  const petals: Array<[number, number]> = [];
  const friendly: unknown[] = [];
  const game = {
    world,
    player,
    npcs: () => npcs,
    enemies: () => enemies,
    critters: () => [],
    addDamageNumber: () => {},
    spawnParticles: () => {},
    playSfx: () => {},
    playSfxFiles: () => {},
    playSfxWav: () => {},
    spawnDrop: () => null,
    damagePlayer: () => 0,
    cutTile: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnTownShot: () => {},
    spawnBurst: () => {},
    showPickupLabel: () => {},
    notifyInventoryChanged: () => {},
    townNpcPrioritizedLockReset: () => {},
    achievements: { notifyProgressionEvent: (n: number) => ach.push(n) },
    spawnTitaniumShard: (x: number, y: number) => { shards.push([x, y]); },
    spawnOnHitPetals: (x: number, y: number) => { petals.push([x, y]); },
    spawnFriendlyProj: (p: unknown) => { friendly.push(p); },
    applyLifeSteal: (kind: string, dmg: number, numHits: number,
      _x: number, _y: number, isMagic: boolean) => {
      lifeSteal.push({ kind, dmg, numHits, isMagic });
      return 0;
    },
    entities: { add: () => {}, nextId: 1, projectiles: [] } as never,
  } as unknown as GameHooks;
  return { game, lifeSteal, ach, shards, petals, friendly };
}

/** face 2/4 消费的玩家桩（equipStats 直写=projScanEq 回退档） */
function procPlayer(equipStats: Record<string, unknown> = {}) {
  return {
    x: -9999, y: -9999, w: 0, h: 0, dead: false, cx: 10, cy: 10,
    titaniumStormCd: 0, shadowDodgeTimer: 0, petalTimer: 0,
    equipStats,
    buffs: { apply: vi.fn(), has: () => false },
  };
}

// ===========================================================================
// face 1：StatusNPC 鞭 debuff 载体面（:13634 → TownNPC 12 载体 + tickDebuffs）
// ===========================================================================
describe('X1-face1：城镇 NPC debuff 载体 + DoT tick', () => {
  it('F1a ApplyWhipDebuffs 913→onFire3T=4 / 912→frostburn2T=4 / 914→1/5 poisonT / 1033→eelWhipT=4', () => {
    const n = guideAt(100, 98 * 16);
    Math.random = () => 0.999;                        // 914 的 1/5 掷不中
    applyWhipDebuffs(913, n as unknown as Record<string, number>);
    applyWhipDebuffs(912, n as unknown as Record<string, number>);
    applyWhipDebuffs(914, n as unknown as Record<string, number>);
    applyWhipDebuffs(1033, n as unknown as Record<string, number>);
    expect(n.onFire3T).toBe(4);
    expect((n as unknown as { frostburn2T: number }).frostburn2T).toBe(4);
    expect((n as unknown as { poisonT: number }).poisonT).toBe(0);   // 1/5 未中
    expect((n as unknown as { eelWhipT: number }).eelWhipT).toBe(4);
  });

  it('F1b StatusNPC 鞭表 1104→slimedT=3（180t）；鞭尖窗 applyBuffTicks(24)→onFireT', () => {
    const n = guideAt(100, 98 * 16);
    // suppressBuff:24 = 环同式（表 24 项缺几何门,鞭尖窗直投,蓝队 R7-41 同款）
    applyProjStatus(1104, n as unknown as Record<string, number>, { suppressBuff: 24 });
    expect((n as unknown as { slimedT: number }).slimedT).toBe(3);
    expect(n.onFireT).toBe(0);
    applyBuffTicks(n as unknown as Record<string, number>, 24, 240);
    expect(n.onFireT).toBe(4);
  });

  it('F1c 浸剂 venom→venomT+potentAcidT；nano(31) 被城镇 DebuffImmunitySets[31] 免疫闸拦', () => {
    const n = guideAt(100, 98 * 16);
    Math.random = () => 0.999;                        // 时长掷上段
    applyMeleeImbue(
      { has: (bt: BuffType) => bt === (BuffType.ImbueVenom as never) || bt === (BuffType.ImbueNano as never) },
      n as unknown as Record<string, number>);
    expect((n as unknown as { venomT: number }).venomT).toBeGreaterThan(0);
    expect((n as unknown as { potentAcidT: number }).potentAcidT).toBe(1);  // 1457 :11201-11204
    expect((n as unknown as { confusedT?: number }).confusedT).toBeUndefined();  // npcImmuneTo(22,31)
  });

  it('F1d 催化指环 398→acceleratePoisonsT=5（applyProjStatus ctx.catalystBand）', () => {
    const n = guideAt(100, 98 * 16);
    applyProjStatus(841, n as unknown as Record<string, number>, { catalystBand: true });
    expect((n as unknown as { acceleratePoisonsT: number }).acceleratePoisonsT).toBe(5);
  });

  it('F1e DoT tick：onFire3 4s → 60 拍 =15 HP/s（0.25/拍整）;slimed 在身 ×2 =30', () => {
    const w = flatWorld('x1-dot');
    const n = guideAt(100 * 16, (GROUND - 2) * 16);
    const { game } = makeHooks(w, procPlayer(), [n]);
    n.onFire3T = 4;
    for (let t = 0; t < 60; t++) n.fixedUpdate(1 / 60, game);
    const loss1 = 250 - n.hp;
    expect(loss1).toBeGreaterThanOrEqual(14);
    expect(loss1).toBeLessThanOrEqual(15);
    // slimed ×2（AddFlamable :113-115——137 与 323 并存翻倍）
    const n2 = guideAt(120 * 16, (GROUND - 2) * 16);
    const g2 = makeHooks(w, procPlayer(), [n2]);
    n2.onFire3T = 4;
    (n2 as unknown as { slimedT: number }).slimedT = 5;
    for (let t = 0; t < 60; t++) n2.fixedUpdate(1 / 60, g2.game);
    const loss2 = 250 - n2.hp;
    expect(loss2).toBeGreaterThanOrEqual(29);
    expect(loss2).toBeLessThanOrEqual(30);
  });

  it('F1f eelWhip 50 HP/s（裸 Add 不吃 398 加速——acceleratePoisonsT 在身仍 50）', () => {
    const w = flatWorld('x1-eel');
    const n = guideAt(100 * 16, (GROUND - 2) * 16);
    const { game } = makeHooks(w, procPlayer(), [n]);
    (n as unknown as { eelWhipT: number }).eelWhipT = 4;
    (n as unknown as { acceleratePoisonsT: number }).acceleratePoisonsT = 5;
    for (let t = 0; t < 60; t++) n.fixedUpdate(1 / 60, game);
    const loss = 250 - n.hp;
    expect(loss).toBeGreaterThanOrEqual(49);
    expect(loss).toBeLessThanOrEqual(50);
  });

  it('F1g DoT 致死走 force hurt 完整死亡链（potentAcid 90 HP/s vs hp=10 → dead）', () => {
    const w = flatWorld('x1-dotdeath');
    const n = guideAt(100 * 16, (GROUND - 2) * 16);
    const { game } = makeHooks(w, procPlayer(), [n]);
    (n as unknown as { potentAcidT: number }).potentAcidT = 5;
    n.hp = 10;
    for (let t = 0; t < 90 && !n.dead; t++) n.fixedUpdate(1 / 60, game);
    expect(n.dead).toBe(true);
  });
});

// ===========================================================================
// face 2：TryDoingOnHitEffects（:13640-43 → Player.OnHit :6912-7040）
// ===========================================================================
describe('X1-face2：TownNPC.hurt OnHit proc 面（life>5 受击前快照+来源排除）', () => {
  it('F2a 钛金风暴：cd 0→10 + buff 306 10s + 出 Shard（fromPlayer=true + dmg>0 + hp>5）', () => {
    const w = flatWorld('x1-titan');
    const n = guideAt(100, 98 * 16);
    const pl = procPlayer({ titaniumStorm: true });
    const { game, shards } = makeHooks(w, pl, [n]);
    n.hurt(40, 0, 0, game, 0, 0, false, false, true, 0);
    expect(pl.titaniumStormCd).toBe(10);
    expect(pl.buffs.apply).toHaveBeenCalledWith(306, 10);
    expect(shards.length).toBe(1);
  });

  it('F2b 致死一击仍 proc（life>5 读受击前值——:13640 门在 StrikeNPC :13704 前）', () => {
    const w = flatWorld('x1-lethal');
    const n = guideAt(100, 98 * 16);
    const pl = procPlayer({ titaniumStorm: true });
    const { game, shards } = makeHooks(w, pl, [n]);
    n.hurt(9999, 0, 0, game, 0, 0, false, false, true, 0);
    expect(n.dead).toBe(true);
    expect(shards.length).toBe(1);                    // 旧形"proc 在扣血后读 hp"必红
  });

  it('F2c 残血豁免：受击前 hp=3（≤5）→ 不 proc', () => {
    const w = flatWorld('x1-lowhp');
    const n = guideAt(100, 98 * 16);
    const pl = procPlayer({ titaniumStorm: true });
    const { game, shards } = makeHooks(w, pl, [n]);
    n.hp = 3;
    n.hurt(2, 0, 0, game, 0, 0, false, false, true, 0);
    expect(n.dead).toBe(false);
    expect(shards.length).toBe(0);
  });

  it('F2d 来源排除表：srcProjId=908（钛金碎片自续弹）→ 不 proc 不刷 cd（:15210-15220）', () => {
    const w = flatWorld('x1-excl');
    const n = guideAt(100, 98 * 16);
    const pl = procPlayer({ titaniumStorm: true });
    const { game, shards } = makeHooks(w, pl, [n]);
    n.hurt(40, 0, 0, game, 0, 0, false, false, true, 908);
    expect(shards.length).toBe(0);
    expect(pl.titaniumStormCd).toBe(0);
  });

  it('F2e hostile 源不 proc（ownedBySomeone 臂 :13640——敌弹 owner=255 走不到）', () => {
    const w = flatWorld('x1-hostile');
    const n = guideAt(100, 98 * 16);
    const pl = procPlayer({ titaniumStorm: true });
    const { game, shards } = makeHooks(w, pl, [n]);
    n.hurt(40, 0, 0, game, 0, 0, false, false, false, 0);
    expect(shards.length).toBe(0);
  });

  it('F2f 幻影闪避/帕拉钯/山铜花瓣三支照发（各冷却窗门同式）', () => {
    const w = flatWorld('x1-three');
    const n = guideAt(100, 98 * 16);
    const pl = procPlayer({ onHitDodge: true, onHitRegen: true, onHitPetal: true });
    const { game, petals } = makeHooks(w, pl, [n]);
    n.hurt(40, 0, 0, game, 0, 0, false, false, true, 0);
    expect(pl.buffs.apply).toHaveBeenCalledWith(BuffType.ShadowDodge, 30);
    expect(pl.buffs.apply).toHaveBeenCalledWith(BuffType.RapidHealing, 5);
    expect(petals.length).toBe(1);
  });

  it('F2g 通道级：hitTownNpcs playerProj 源透传 fromPlayer（巫毒门过）→ proc；hostile 源 → 不 proc', () => {
    const w = flatWorld('x1-chan');
    const n = guideAt(400, 600);
    const pl = procPlayer({ titaniumStorm: true, killGuide: true });
    const { game, shards } = makeHooks(w, pl, [n]);
    const box = { x: n.x, y: n.y, w: n.w, h: n.h };
    hitTownNpcs(box, game, 10, 0, 'playerProj', 0);
    expect(shards.length).toBe(1);
    const pl2 = procPlayer({ titaniumStorm: true });
    const g2 = makeHooks(w, pl2, [n]);
    hitTownNpcs(box, g2.game, 10, 0, 'hostile', 0);
    expect(shards.length).toBe(1);                    // 仍为 playerProj 那次
  });
});

// ===========================================================================
// face 3/4/5：WhipProj 城镇环（nano/party/ghostHeal/proc 窗）——真鞭驱动
// ===========================================================================
const mkWhip = (player: Player, dmg: number, projId = 841, itemId = 4672): WhipProj =>
  new WhipProj(player.cx, player.cy, 0, projId, itemId, dmg, 4, 30, 4, () => player);

/** 鞭命中驱动（s3b 同式）：9 拍起手 → 城镇 NPC 移到 ai0=20 快照曲线控制点 → 1 拍 */
function landOneHit(w: WhipProj, game: GameHooks, ...npcs: TownNPC[]): void {
  for (let i = 0; i < 9; i++) w.fixedUpdate(1, game);
  const p = w.pointsAt(20, true)[10];
  for (const n of npcs) { n.x = p.x - n.w / 2; n.y = p.y - n.h / 2; }
  w.fixedUpdate(1, game);
}

function whipFixture(nano = false, party = false) {
  const w = flatWorld('x1-whip');
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  // equipStats 为冻结快照（记忆化改造）——getter mock 注入巫毒位（melee-alignment 同法）
  vi.spyOn(player, 'equipStats', 'get')
    .mockReturnValue(Object.freeze({ ...player.equipStats, killGuide: true }));
  if (nano) player.buffs.apply(BuffType.ImbueNano, 30);
  if (party) player.buffs.apply(BuffType.ImbueParty, 30);
  const guide = guideAt(400, 600);
  const fx = makeHooks(w, player, [guide]);
  return { w, player, guide, ...fx };
}

describe('X1-face3/4/5：WhipProj 城镇受理环（巫毒窄门过门后）', () => {
  it('F3a nano 浸剂：受理伤 =trunc(60×1.05)=63 → 63−def/2=48（无浸剂 45）', () => {
    // ★BJ731 改判史（2026-10-27）：BJ723-C S03 起鞭城镇受理面掷 :12970 DV——
    //   0.5 恒等档（未 mock 受理伤必漂 ±15%）。
    const rvi731 = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const a = whipFixture(true);
      landOneHit(mkWhip(a.player, 60), a.game, a.guide);
      expect(250 - a.guide.hp).toBe(Math.trunc(Math.max(1, Math.trunc(60 * 1.05) - GUIDE_DEF * 0.5)));
      const b = whipFixture(false);
      landOneHit(mkWhip(b.player, 60), b.game, b.guide);
      expect(250 - b.guide.hp).toBe(Math.trunc(Math.max(1, 60 - GUIDE_DEF * 0.5)));
    } finally { rvi731.mockRestore(); }
  });

  it('F3b party 浸剂：受理拍出彩带伴生弹（:13693-95 289 于目标 Center/目标速度）', () => {
    const f = whipFixture(false, true);
    landOneHit(mkWhip(f.player, 60), f.game, f.guide);
    expect(f.friendly.length).toBe(1);
    expect(f.friendly[0]).toBeInstanceOf(ConfettiBurstProj);
  });

  it('F4a ghostHeal 白耗面：applyLifeSteal("ghost", num41, preHits=0, isMagic=false)', () => {
    const f = whipFixture();
    // ★BJ731 改判史（2026-10-27）：同 F3a——DV 恒等档钉 num41。
    const rvi731 = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      landOneHit(mkWhip(f.player, 60), f.game, f.guide);
    } finally { rvi731.mockRestore(); }
    expect(f.lifeSteal.length).toBe(1);
    const c = f.lifeSteal[0];
    expect(c.kind).toBe('ghost');
    expect(c.dmg).toBe(Math.trunc(Math.max(1, 60 - GUIDE_DEF * 0.5)));   // num41=防后实扣
    expect(c.numHits).toBe(0);                        // :14263 自增前值（首跳 0 档率 0.20）
    expect(c.isMagic).toBe(false);                    // 鞭无 magic 类旗=白耗单面
  });

  it('F4b lastStrikeDealt 镜像：受理写实扣;拒收（iframes 残窗）路径不落值', () => {
    const f = whipFixture();
    // ★BJ731 改判史（2026-10-27）：同 F3a——DV 恒等档钉 lastStrikeDealt。
    const rvi731 = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      landOneHit(mkWhip(f.player, 60), f.game, f.guide);
    } finally { rvi731.mockRestore(); }
    expect(f.guide.lastStrikeDealt).toBe(Math.trunc(Math.max(1, 60 - GUIDE_DEF * 0.5)));
    // 鞭写梯清窗形态（iframes=0）——手工置残窗验证拒收早退在入口清零【前】（Enemy.hurt 同形）
    f.guide.lastStrikeDealt = 777;
    f.guide.iframes = 10;
    expect(f.guide.hurt(60, 0, 0, f.game)).toBe(false);
    expect(f.guide.lastStrikeDealt).toBe(777);
  });

  it('F5a proc 窗启用：火鞭 913(4912) 首鞭门 → canProcOnNPC 真 + procEnabled 置位', () => {
    expect(WHIP_PROC_ITEMS.has(4912)).toBe(true);
    const f = whipFixture();
    const w = mkWhip(f.player, 60, 913, 4912);
    landOneHit(w, f.game, f.guide);
    expect(f.player.tagEffectStack.canProcOnNPC(4912, f.guide.id)).toBe(true);
    expect((w as unknown as { procEnabled: boolean }).procEnabled).toBe(true);
  });

  it('F5b 非 proc 鞭 841(4672) 不开 proc 窗', () => {
    const f = whipFixture();
    landOneHit(mkWhip(f.player, 60), f.game, f.guide);
    expect(f.player.tagEffectStack.canProcOnNPC(4672, f.guide.id)).toBe(false);
  });

  it('F1-环 火鞭 913 全链：城镇受理拍落 onFire3T=4（ApplyWhipDebuffs 经环）', () => {
    const f = whipFixture();
    landOneHit(mkWhip(f.player, 60, 913, 4912), f.game, f.guide);
    expect(f.guide.onFire3T).toBe(4);
  });

  it('F1-环 火鞭 1104 全链：slimedT=3（StatusNPC 表,鞭尖窗独立）', () => {
    const f = whipFixture();
    landOneHit(mkWhip(f.player, 60, 1104, 0), f.game, f.guide);
    expect((f.guide as unknown as { slimedT: number }).slimedT).toBe(3);
  });
});

// ===========================================================================
// face 6：GRAVE_MISTAKE 墓碑链（W1 锚勘误——墓碑弹杀城镇 NPC,非鞭杀向导）
// ===========================================================================
describe('X1-face6：GRAVE_MISTAKE 墓碑全链 + 鞭杀向导零效果勘误', () => {
  it('F6a FTW 墓碑杀城镇 NPC → notifyProgressionEvent(36)（Tombstone onKill 全链）', () => {
    const w = flatWorld('x1-grave');
    const n = guideAt(100, 98 * 16);
    n.hp = 50;                                        // 62 ≥ 50 → 致死
    const { game, ach } = makeHooks(w, procPlayer(), [n]);
    const tomb = new Tombstone(n.x, n.y, 0, 'test', 1, true);   // getGood=true → dmg 70
    tomb.fixedUpdate(1 / 60, game);
    expect(n.dead).toBe(true);
    expect(ach).toContain(36);
  });

  it('F6b 勘误钉面：鞭杀向导 → 不发 36（原版 OnKillNPC(ref attempt, 鞭) 零城镇效果）', () => {
    const f = whipFixture();
    f.guide.hp = 40;                                  // 45 ≥ 40 → 致死
    // ★BJ731 改判史（2026-10-27）：BJ723-C S03 鞭受理 DV 掷使 45±15% 跨 40 致死门
    //   =掷运翻车（38.25<40 不死）——恒等档 0.5 钉（a-batch2 BJ729-A 同款,鞭路径
    //   无概率生尘循环,恒 mock 安全[nebula 判例反证不适用于本路径]）。
    const rvi731 = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      landOneHit(mkWhip(f.player, 60), f.game, f.guide);
    } finally { rvi731.mockRestore(); }
    expect(f.guide.dead).toBe(true);
    expect(f.ach).not.toContain(36);
  });
});
