// ★清偿刀 Y2（2026-10-02）：随从/哨兵弹 vs 城镇 NPC 通道（X1 登记债清偿）。
//  定谳锚（Terarria1457/Terraria/Projectile.cs 亲读）：
//   · 随从弹伤城镇 = Damage() → Damage_CanDealDamage projPet 例外族（:12468）放行 →
//     Damage_PVE :12523 → Damage_PVE_Inner 对城镇靶【同链同面】：voodoo 窄门
//     :12618-12625 flag 臂（22 killGuide / 54 killClothier / 318 例外）放行后
//     tag ModifyHit(:12947)/DamageVar/banner(:13387-91)/穿甲(:13686-87)/
//     StrikeNPC(:13702)/TagEffectStack.OnHit(:13711) 全段照跑——原版无独立城镇支。
//   · 黑收成 916 链电（:13711 OnTaggedHit → SpawnBlackLightning）位于 StrikeNPC
//     【后】——汇出值在主命中受理+写梯后落地（同步直调会自置 iframes 反噬主命中:
//     敌怪环反序缺陷探针实证=主伤整丢,登记债）;★W5（2026-10-02）定谳补全目标面：
//     916 出膛即对被命中敌 localNPCImmunity=-1 永免（_DarkHarvest.cs:18）,伤落
//     【其他】敌（darkHarvestChain）,被命中者只吃主命中内的 tag 加伤——A5 oracle
//     已按反编译重产（31→30）,A7=链电目标面。
//   · WHIP_HIT_BUFF/SIDEKICK（:13987/:13997 case 912/1028）与 1034 星雨
//     （:14001-14007）对城镇靶同 switch 同面（X1 登记债=Y2 落刀位）。
//   · 穿甲 :13686-87 `ownedBySomeone && !hostile → dmg += checkArmorPenetration`
//     对城镇靶同面（鞭 num6 = GetArmorPenetration(melee=false) = 玩家通用 armorPen）。
//  判别力（旧码必红项）：§A1 通道整缺=零伤;§A3 tag 乘区不可达;§A4 proc 消费不可达;
//  §A5 同步直伤反序=主伤丢（30≠1）/目标面反记=tag 伤双记（30≠31）;§A6 自造 10t 窗;
//  §A7 链电目标面缺=链靶零伤;§C1/C2 城镇臂缺=无 buff/无哨兵;§C4 穿甲不透传;
//  §D1 星雨城镇臂缺。
import { describe, it, expect, vi } from 'vitest';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import type { GameHooks } from '../src/entities/types';
import { Enemy } from '../src/entities/Enemy';
import { TownNPC } from '../src/entities/TownNPC';
import { MinionProj } from '../src/entities/MinionProj';
import { WhipProj } from '../src/entities/WhipProj';
import { Arrow } from '../src/entities/Arrow';

function makeGame(list: Enemy[], towns: TownNPC[]): { hooks: GameHooks; player: Player; added: unknown[] } {
  const w = new World(200, 120, 7, 'y2-minion-town');
  for (let x = 0; x < 200; x++) for (let y = 100; y < 120; y++) w.store.setTile(x, y, 1);
  w.groundLevel = 100;
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const added: unknown[] = [];
  const projectiles: unknown[] = [];
  const hooks: GameHooks = {
    world: w as never,
    player: player as never,
    enemies: () => list,
    npcs: () => towns,
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
    spawnFriendlyProj: (e: unknown) => { added.push(e); return undefined; },
    entities: { add: (e: unknown) => { added.push(e); projectiles.push(e); }, nextId: 1, projectiles } as never,
    applyLifeSteal: () => 0,
  } as unknown as GameHooks;
  return { hooks, player, added };
}

/** 向导桩（vid 22,巫毒窄门正靶;防御 30=vanilla-npcs.json;不 tick → 写位保持） */
function guide(_hooks: GameHooks, towns: TownNPC[], px: number, py: number): TownNPC {
  const g = new TownNPC('guide', px, py);
  g.id = 100 + towns.length;
  g.maxHp = 5000;
  g.hp = 5000;
  towns.push(g);
  return g;
}

// equipStats 为冻结 getter（Player.ts:1820）——w1 同法覆写
const voodooOn = (p: Player): void => {
  Object.defineProperty(p, 'equipStats', {
    value: Object.freeze({ ...p.equipStats, killGuide: true }), configurable: true,
  });
};
const equipOverride = (p: Player, patch: Record<string, unknown>): void => {
  Object.defineProperty(p, 'equipStats', {
    value: Object.freeze({ ...p.equipStats, ...patch }), configurable: true,
  });
};

/** 乌鸦 317（contact() 主环族）;直驱私有 contact 环=确定单发（AI 态机无关） */
const ravenAt = (hooks: GameHooks, player: Player, cx: number, cy: number): MinionProj =>
  new MinionProj(cx - 14, cy - 14, 317, 30, 1.5, false, 0, false, () => player);
const contactDirect = (m: MinionProj, hooks: GameHooks, dmg = 30): boolean =>
  (m as unknown as { contact: (g: GameHooks, d: number, cd?: number) => boolean }).contact(hooks, dmg, 5);

describe('Y2-§A：contact() 主环城镇通道（contactTown）', () => {
  it('A1 killGuide：随从本体命中向导落地（def 30 → 30−15=15）;受理拍清窗 iframes=0 非 10', () => {
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    voodooOn(player);
    const g = guide(hooks, towns, 400, 600);
    const m = ravenAt(hooks, player, 400, 600);
    expect(contactDirect(m, hooks)).toBe(true);
    expect(5000 - g.hp).toBe(15);      // ★主判别:通道整缺旧码=零伤
    expect(g.iframes).toBe(0);         // ★usesLocal 主支清窗（:14175-14179,旧 TownNPC.hurt 通用档 10 必红）
  });

  it('A2 无 doll：零伤零面（巫毒窄门 :12618-12625,通道不旁路）', () => {
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    const g = guide(hooks, towns, 400, 600);
    const m = ravenAt(hooks, player, 400, 600);
    expect(contactDirect(m, hooks)).toBe(false);
    expect(g.hp).toBe(5000);
  });

  it('A3 face 5 ModifyHit 乘区：tag 4672(+4) → (30+4)−15=19（tag 乘区对城镇可达）', () => {
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    voodooOn(player);
    const g = guide(hooks, towns, 400, 600);
    player.tagEffectStack.tryApplyTagToNPC(4672, g.id, 22, 0);   // :13635 等位（鞭侧写入）
    const m = ravenAt(hooks, player, 400, 600);
    contactDirect(m, hooks);
    expect(5000 - g.hp).toBe(19);      // ★主判别:tag 伤并入城镇命中
  });

  it('A4 face 5 OnHit proc 消费：火鞭 4912 proc 窗 → ×2.75（82−15=67）+ proc 清（:113-118）', () => {
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    voodooOn(player);
    const g = guide(hooks, towns, 400, 600);
    player.tagEffectStack.tryApplyTagToNPC(4912, g.id, 22, 0);
    player.tagEffectStack.tryEnableProcOnNPC(4912, g.id);
    const m = ravenAt(hooks, player, 400, 600);
    contactDirect(m, hooks);
    expect(5000 - g.hp).toBe(67);      // ★主判别:proc ×2.75（TotalDamageMultiplier）
    expect(player.tagEffectStack.canProcOnNPC(4912, g.id)).toBe(false);   // 消费
  });

  it('A5 黑收成 916 链电延迟落地（:13711 OnHit 在 StrikeNPC 后）+源敌永免（W5 定谳）：向导只吃主 30', () => {
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    voodooOn(player);
    const g = guide(hooks, towns, 400, 600);
    player.tagEffectStack.tryApplyTagToNPC(4680, g.id, 22, 0);   // darkharvest tagDamage 15
    const m = ravenAt(hooks, player, 400, 600);
    contactDirect(m, hooks);
    // ★W5 oracle 重产（2026-10-02,反编译=oracle）：_DarkHarvest.cs:18 出膛即
    //  `localNPCImmunity[npcHit]=-1` 永免被命中敌（Items.json:8299 词条 "Dark energy
    //  jumps from enemies hit by summons" 同证）→ 向导只吃主命中 (30+15)−15=30
    //  （tag 加伤在主命中内,ModifyHit :12954,单记）;旧 Y2 档"主30+直1=31"系目标面
    //  反记=tag 伤双记,已纠。同步反序旧形（直伤先落+窗拒主命中）=1 必红。
    expect(5000 - g.hp).toBe(30);      // ★主判别:反序必红（=1）;目标面反记旧形必红（=31）
  });

  it('A7 黑收成 916 链电目标面（W5）：伤落 400px 内其他敌,向导本体零双记', () => {
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    voodooOn(player);
    const g = guide(hooks, towns, 400, 600);
    // 链靶桩（敌桶;canBeChasedBy 门面:dead/vanillaId/def.friendly/dontTakeDamage/maxHp）
    const stub = {
      id: 9001, dead: false, x: 500 - 19, y: 600 - 19, w: 38, h: 38, cx: 500, cy: 600,
      iframes: 0, maxHp: 5000, hp: 10000, vanillaId: 0, realLife: -1,
      hurt(d: number): boolean { this.hp -= d; return true; },
    };
    list.push(stub as unknown as Enemy);
    player.tagEffectStack.tryApplyTagToNPC(4680, g.id, 22, 0);   // darkharvest tagDamage 15
    const m = ravenAt(hooks, player, 400, 600);
    contactDirect(m, hooks);
    expect(5000 - g.hp).toBe(30);      // 源（城镇 NPC）永免（:18）,只吃主命中
    expect(stub.hp).toBe(10000 - 15);  // ★主判别:链电单跳 15 落其他敌（桩零防）
  });

  it('A6 冷却三态门：受理后私表占位,5t 内不重击（敌怪环 :4367 同式）', () => {
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    voodooOn(player);
    const g = guide(hooks, towns, 400, 600);
    const m = ravenAt(hooks, player, 400, 600);
    contactDirect(m, hooks);
    const hp1 = g.hp;
    expect(contactDirect(m, hooks)).toBe(false);   // cd=5 私表占位
    expect(g.hp).toBe(hp1);
  });
});

describe('Y2-§B：守护者 623 拳盒城镇臂（AI 驱动冒烟）', () => {
  it('B1 冲刺态拳盒（80×40）对城镇靶同面：向导置于拳盒带内 → 掉血', () => {
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    voodooOn(player);
    const e = Enemy.fromVanilla(15, 60 * 16 + 250, 90 * 16)!;
    e.id = 1; e.maxHp = 5000; e.hp = 5000;
    list.push(e);
    // 拳盒 = 守护者心+facing×40 ± 40（冲刺位=敌左缘 −(敌半宽+70)）——向导置于
    // 敌心 −60（拳盒带内,敌盒 38 宽共心会恰出盒缘）
    const g = guide(hooks, towns, e.cx - 60, e.cy);
    const p623 = new MinionProj(player.x, player.y, 623, 30, 2, false, 0, false, () => player);
    for (let i = 0; i < 120 && g.hp === 5000; i++) p623.fixedUpdate(1, hooks);
    expect(g.hp).toBeLessThan(5000);   // ★主判别:拳盒城镇臂缺=满血红
  });
});

describe('Y2-§C：WHIP_HIT_BUFF/SIDEKICK 城镇臂（:13987/:13997 case 912/1028）+ 穿甲透传', () => {
  const landOneHit = (w: WhipProj, hooks: GameHooks, ...targets: Array<{ x: number; y: number; w: number; h: number }>): void => {
    for (let i = 0; i < 9; i++) w.fixedUpdate(1, hooks);
    const p = w.pointsAt(20, true)[10];
    for (const t of targets) { t.x = p.x - t.w / 2; t.y = p.y - t.h / 2; }
    w.fixedUpdate(1, hooks);
  };
  const mkWhip = (player: Player, dmg: number, projId: number, itemId: number): WhipProj =>
    new WhipProj(player.cx, player.cy, 0, projId, itemId, dmg, 4, 30, 4, () => player);

  it('C1 酷鞭 4911（proj 912）命中向导 → buff 312=180t + 雪花哨兵 917 生成（manual 档:tag 链不授 buff）', () => {
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player, added } = makeGame(list, towns);
    voodooOn(player);
    const g = guide(hooks, towns, 400, 600);
    landOneHit(mkWhip(player, 60, 912, 4911), hooks, g);
    expect(player.whipBuffs[312]).toBe(180);   // ★主判别:城镇臂缺=无 buff（tag 链 manual 档不授）
    const sidekick = added.find((a) => a instanceof MinionProj && (a as MinionProj).projId === 917);
    expect(sidekick).toBeTruthy();             // ★:13984 NewProjectile 917
  });

  it('C2 麻线鞭 5473（proj 1028）→ buff 365=180t + 小蜘蛛 1036 生成', () => {
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player, added } = makeGame(list, towns);
    voodooOn(player);
    const g = guide(hooks, towns, 400, 600);
    landOneHit(mkWhip(player, 60, 1028, 5473), hooks, g);
    expect(player.whipBuffs[365]).toBe(180);
    const sidekick = added.find((a) => a instanceof MinionProj && (a as MinionProj).projId === 1036);
    expect(sidekick).toBeTruthy();             // ★:13995 NewProjectile 1036
  });

  it('C3 无 doll：城镇臂整链不达（零 buff 零哨兵）', () => {
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player, added } = makeGame(list, towns);
    const g = guide(hooks, towns, 400, 600);
    landOneHit(mkWhip(player, 60, 912, 4911), hooks, g);
    expect(player.whipBuffs[312]).toBeUndefined();
    expect(added.some((a) => a instanceof MinionProj)).toBe(false);
  });

  it('C4 穿甲透传（:13686-87）：玩家 armorPen 10 → 池≤def 钳半=+5 → 60+5−15=50（旧恒 0=45 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ723-C S03 位移修复:鞭城镇 DV 中性档——平值断言复稳
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    voodooOn(player);
    equipOverride(player, { armorPen: 10 });
    const g = guide(hooks, towns, 400, 600);
    landOneHit(mkWhip(player, 60, 841, 4672), hooks, g);
    expect(5000 - g.hp).toBe(50);      // ★主判别:flatPen 不透传=45
  });
});

describe('Y2-§D：星鞭 1034 星雨城镇臂（:14001-14007）', () => {
  const landOneHit = (w: WhipProj, hooks: GameHooks, ...targets: Array<{ x: number; y: number; w: number; h: number }>): void => {
    for (let i = 0; i < 9; i++) w.fixedUpdate(1, hooks);
    const p = w.pointsAt(20, true)[10];
    for (const t of targets) { t.x = p.x - t.w / 2; t.y = p.y - t.h / 2; }
    w.fixedUpdate(1, hooks);
  };
  const mkWhip = (player: Player, dmg: number, projId: number, itemId: number): WhipProj =>
    new WhipProj(player.cx, player.cy, 0, projId, itemId, dmg, 4, 30, 4, () => player);

  it('D1 proc 窗开启（随从命中侧 face 5 启用通道）→ 星雨撒 1039 + RemoveAllProcs + localAI0 锁存', () => {
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player, added } = makeGame(list, towns);
    voodooOn(player);
    const g = guide(hooks, towns, 400, 600);
    // proc 窗 = 随从弹命中被 tag 城镇 NPC 时经 constellation OnTaggedHit 启用（face 5 闭环）
    player.tagEffectStack.tryApplyTagToNPC(5479, g.id, 22, 0);
    player.tagEffectStack.tryEnableProcOnNPC(5479, g.id);
    const w = mkWhip(player, 60, 1034, 5479);
    landOneHit(w, hooks, g);
    expect((w as unknown as { localAI0: number }).localAI0).toBe(1);   // ★:14003 锁存
    expect(player.tagEffectStack.canProcOnNPC(5479, g.id)).toBe(false);   // :14006
    expect(added.filter((a) => a instanceof Arrow && (a as Arrow).projId === 1039).length).toBeGreaterThan(0);   // 星雨
  });

  it('D2 无 proc 窗：零星雨（:14001 CanProcOnNPC 门）', () => {
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player, added } = makeGame(list, towns);
    voodooOn(player);
    const g = guide(hooks, towns, 400, 600);
    const w = mkWhip(player, 60, 1034, 5479);
    landOneHit(w, hooks, g);
    expect((w as unknown as { localAI0: number }).localAI0).toBe(0);
    expect(added.some((a) => a instanceof Arrow && (a as Arrow).projId === 1039)).toBe(false);
  });
});
