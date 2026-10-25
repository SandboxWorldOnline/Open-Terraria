// ★BJ710-G35（2026-10-25）新登记债清偿·弹幕域七件判别锁+行为面。
// 逐件判语（详 memory/bj710g35-banner-residuals.md）：
//  D1 shoot*/直构 Dart 族发射位无旗追踪 —— 【修】census 后 17 站带旗源全接线
//     （Enemy 10 + dd2 2 + moon_events 3 + martian 2）;其余全为无旗 boss/世界面
//     （零行为,§4 表锁）。
//  D2 net 傀儡弹 bannerIdToRespondTo 不随 v5 同步 —— 【登记任务书】单人不可达 +
//     net 域并行会话在途（10:33 仍活跃）,锚=NetMessage.cs:790/825 + MessageBuffer.cs
//     :1712/1741（vanilla msg27 bitsByte28[3]+ushort 确实同步,§7 锁）。
//  D3 接触面 :44718 bannerReceivedMult 无 itemId 参 —— 【修】DD2 旗 0.917/0.833 档
//     + 键域勘正 bannerNpcKeyOf（BannerID() netID≥-10 上界;-5/-12 变体两向翻错）。
//  D4 MLDeathray 455 站无 projDomain/banner —— 【修】evpDirectDmg 单源收编 +
//     damageEvPNoCheese opts 透传弹域双旗（ML 无旗=数值逐位不变）。
//  D5 弹生弹 banner 继承仅 574→576 —— 【销案】census 仓内其余弹生弹站均玩家面
//     （478/479 分裂门 !hostile）或无旗 boss 面;574→576/539 爆盒两站已接（§4 锁）。
//  D6 max(1) 下限仓内自创 —— 【销案锁死】触发面=敌弹 base dmg=1 且发射者有旗,
//     仓内敌弹最小伤面=蒲公英籽 836 的 7 → 不可达;保留 floor 带 §6 防再登记注。
//  D7 deadMansSweater&&trap ×0.5+300 帽 —— 【修】hitPlayer 共享链（×2 后）+
//     evpDirectDmg trap 档（1078 陨石）;12 落星/108·1002 自伤/1091 雷三面已在
//     （FallingStar 内联/selfHurtSweaterCap/lightningEvpFinalDamage）。
// ★变异恰红位:M1 bannerNpcKeyOf 去 -10 上界 → §1 变体档红;M2 接触面去 itemId 参
//   → §1 DD2 档红;M3 hitPlayer sweater 门删除 → §2 红;M4 evpDirectDmg trap 门
//   删除 → §3 红;M5 D1 任一站点退旗 → §4 计数红。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { Game } from '../src/core/Game';
import { hitPlayer, evpDirectDmg, bannerNpcKeyOf, applyBannerDamageReceivedOnProj } from '../src/entities/projTargets';
import { bannerOfNpc } from '../src/world/Banners';
import { ITEM_BY_KEY } from '../src/data/items';

const GAME = join(__dirname, '..');
const VAN = join(GAME, '..', 'Terarria1457');
const rd = (rel: string): string => readFileSync(join(GAME, rel), 'utf8');
const vanProj = readFileSync(join(VAN, 'Terraria', 'Projectile.cs'), 'utf8');
const vanPlayer = readFileSync(join(VAN, 'Terraria', 'Player.cs'), 'utf8');
const vanNpc = readFileSync(join(VAN, 'Terraria', 'NPC.cs'), 'utf8');
const vanNet = readFileSync(join(VAN, 'Terraria', 'NetMessage.cs'), 'utf8');
const vanMsgBuf = readFileSync(join(VAN, 'Terraria', 'MessageBuffer.cs'), 'utf8');

const fakeHooks = (w: World, p?: Player, bannerNpcActive?: (id: number) => boolean) => ({
  world: w,
  player: p,
  enemies: () => [],
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
  scene: {},
  ...(bannerNpcActive ? { bannerNpcActive } : {}),
});

const mkWorld = (difficulty: number): World => {
  const w = new World(60, 60, 42, 'bj710g35');
  (w as unknown as { difficulty: number }).difficulty = difficulty;
  for (let x = 12; x <= 40; x++) w.store.setTileSilent(x, 30, 1 /* dirt */);
  return w;
};
const mkPlayer = (w: World): Player => new Player(20 * 16, 27 * 16, new Inventory());
const settle = (p: Player, w: World, ticks = 12): void => {
  for (let i = 0; i < ticks; i++) p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
};
const SWEATER_ID = ITEM_BY_KEY['vi_5007_dead_man_s_sweater'];

afterEach(() => vi.restoreAllMocks());

// ============================ §1 D3：接触面键域+DD2 档 ============================
describe('§1 D3 接触面（Game.damagePlayer banner 段）', () => {
  /** player-hurt-domain mkShell 同谱：Game.prototype 桩 + _bannerNpcs 直喂 */
  function contactShell(difficulty: number, bannerNpcs: number[],
    attacker: { vanillaId?: number | null; vanillaNetId?: number }) {
    const g = Object.create(Game.prototype) as Record<string, any>;
    const w = new World(96, 96, 7, 'g35-contact');
    (w as unknown as { difficulty: number }).difficulty = difficulty;
    const p = new Player(60 * 16, 60 * 16, new Inventory());
    g.player = p;
    g.world = w;
    g.golfState = { tryGetCameraTrackingPosition: () => null };
    g._bannerNpcs = new Set(bannerNpcs);
    g.sfx = { play: vi.fn(), playWavFile: vi.fn() };
    g.remotePlayerProxies = [];
    g.enemies = (): unknown[] => [];
    g.critters = (): unknown[] => [];
    g.addDamageNumber = vi.fn();
    g.spawnParticles = vi.fn();
    g.entities = { add: vi.fn() };
    g.recorder = undefined;
    const dealt: number[] = [];
    // 结算读回：damagePlayer 尾段走 Player.damage（真身）——直接读 p.hp 差值
    const hp0 = p.hp;
    (g.damagePlayer as (...a: unknown[]) => number)
      .call(g, 100, 66 * 16, 61 * 16, { ...attacker, cx: 66 * 16, cy: 61 * 16, x: 66 * 16 - 12, y: 60 * 16, w: 24, h: 42, vx: 1.5, vy: 0, dead: false, dontTakeDamage: false, def: { damage: 40, name: 'X' }, hurt: vi.fn((d: number) => d) } as never, true);
    return { taken: hp0 - p.hp, p, g };
  }

  it('DD2 档（M2 位）：552 哥布林步哨（banner 258→item 3838）经典 100→91/专家 100→83（旧门 75/50 错档）', () => {
    const c = contactShell(0, [552], { vanillaId: 552, vanillaNetId: 0 });
    expect(bannerOfNpc(552)).toBe(258);              // 552 → DD2 旗 258（item 3838）
    expect(c.taken).toBe(91);                        // trunc(100×0.917)=91（裸玩家 def 0）
    const e = contactShell(1, [552], { vanillaId: 552, vanillaNetId: 0 });
    expect(e.taken).toBe(83);                        // trunc(100×0.833)=83
    // 对照普通档（M2：去 itemId 参 → 两档同值 75/50 即红）
    const n = contactShell(0, [16], { vanillaId: 16, vanillaNetId: 0 });
    expect(n.taken).toBe(75);                        // 母史莱姆旗 146→item 2955 普通档
  });

  it('键域（M1 位）：变体 NPC 用 netId 域——-5 宝宝史莱姆吃母史莱姆旗 146 不吃蓝史莱姆旗 69', () => {
    // 母史莱姆旗 146 放置（_bannerNpcs 含 {-5,16}）→ -5 宝宝（type 1,netId -5）吃减伤
    const m = contactShell(0, [-5, 16], { vanillaId: 1, vanillaNetId: -5 });
    expect(m.taken).toBeGreaterThan(0);
    // 蓝史莱姆旗 69 放置（{1}）→ -5 宝宝【不】吃（旧门读 vanillaId=1 会误吃）
    const b = contactShell(0, [1], { vanillaId: 1, vanillaNetId: -5 });
    // 两壳同 hp 起点,同 100 伤同防御——差值仅 banner 段有无
    expect(m.taken).toBeLessThan(b.taken);   // 减伤=承伤更少（trunc(100×0.75)=75 < 100）
  });

  it('键域（-12 上界）：getGood 僵尸（type 6,netId -12）BannerID() 回落 type 吃僵尸旗 27', () => {
    expect(bannerNpcKeyOf({ vanillaId: 6, vanillaNetId: -12 })).toBe(6);   // M1：裸 netId 翻错
    expect(bannerOfNpc(6)).toBe(27);
    const z = contactShell(0, [6], { vanillaId: 6, vanillaNetId: -12 });
    expect(z.taken).toBeGreaterThan(0);
  });

  it('bannerNpcKeyOf：-1..-10 用 netId / 正 netId=type 域 / null 面', () => {
    expect(bannerNpcKeyOf({ vanillaId: 16, vanillaNetId: 0 })).toBe(16);
    expect(bannerNpcKeyOf({ vanillaId: 5, vanillaNetId: -5 })).toBe(-5);
    expect(bannerNpcKeyOf({ vanillaId: 1, vanillaNetId: -12 })).toBe(1);  // BannerID() type 回落
    expect(bannerNpcKeyOf(null)).toBeNull();
  });

  it('击杀计账键（D3b）：-12 僵尸击杀进僵尸旗 27 账（AddNPCKillBy(BannerID()) NPC.cs:80636）', () => {
    const src = rd('src/core/Game.ts');
    expect(src).toContain('const killBannerKey = bannerNpcKeyOf(enemy) ?? 0;');
    expect(src).toContain('recordBannerKill(this.world.bannerKills, killBannerKey)');
    const e = rd('src/entities/Enemy.ts');
    expect((e.match(/bannerOfNpc\(bannerNpcKeyOf\(this\) \?\? 0\)/g) ?? []).length).toBe(2);  // lastCreatureHit 两写位
  });
});

// ============================ §2 D7a：hitPlayer sweater 面 ============================
describe('§2 D7a hitPlayer 死囚毛衣陷阱减半+300 帽（:14919-14922）', () => {
  const mkSweaterHooks = (w: World, sweater: boolean) => {
    const p = mkPlayer(w);
    if (sweater) {
      const inv = p.inv as unknown as { armor: Array<{ id: number; stack: number } | null> };
      inv.armor[1] = { id: SWEATER_ID, stack: 1 };   // 胸甲槽（GrantArmorBenefits case 1）
    }
    settle(p, w);
    expect(p.equipStats.deadMansSweater).toBe(sweater);   // SW-AC1 单源旗读通
    const seen: number[] = [];
    const hooks = { ...fakeHooks(w, p), damagePlayer: (d: number): number => { seen.push(d); return d; } };
    return { hooks, seen };
  };

  it('经典 50 伤陷阱弹：×2=100 → sweater ×0.5=50（未穿=100）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const w = mkWorld(0);
    const a = mkSweaterHooks(w, true);
    const pa = a.hooks.player as { x: number; y: number };
    hitPlayer({ x: pa.x, y: pa.y, w: 8, h: 8, projId: 98 } as never, a.hooks as never, 50, true);
    expect(a.seen[0]).toBe(50);
    const b = mkSweaterHooks(w, false);
    const pb = b.hooks.player as { x: number; y: number };
    hitPlayer({ x: pb.x, y: pb.y, w: 8, h: 8, projId: 98 } as never, b.hooks as never, 50, true);
    expect(b.seen[0]).toBe(100);
  });

  it('300 帽：大师 400 伤陷阱弹 → 缩放×3×2=2400 → sweater min(1200,300)=300', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const w = mkWorld(2 /* master：仓内编码 0经典/1专家/2大师/3旅程 */);
    const a = mkSweaterHooks(w, true);
    const pa = a.hooks.player as { x: number; y: number };
    hitPlayer({ x: pa.x, y: pa.y, w: 8, h: 8, projId: 98 } as never, a.hooks as never, 400, true);
    expect(a.seen[0]).toBe(300);
  });

  it('pvp=true 无 sweater 面（Damage_PVP :14637-14845 无此段）;trap=false 跳过', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const w = mkWorld(0);
    const a = mkSweaterHooks(w, true);
    const pa = a.hooks.player as { x: number; y: number };
    hitPlayer({ x: pa.x, y: pa.y, w: 8, h: 8 } as never, a.hooks as never, 50, true, true);
    expect(a.seen[0]).toBe(50);                       // pvp 直传（无 ×2 无 sweater）
    hitPlayer({ x: pa.x, y: pa.y, w: 8, h: 8, projId: 12 } as never, a.hooks as never, 50, false);
    expect(a.seen[1]).toBe(100);                      // trap=false：×2 但不减半
  });

  it('结构锁（M3 位）：sweaterDmg 在 ×2 后、两消费位（noCheese/普通）全改读 sweaterDmg', () => {
    const src = rd('src/entities/projTargets.ts');
    expect(src).toContain('const sweaterDmg = !pvp && trap');
    expect(src).toContain('Math.min(Math.trunc(evpDmg * 0.5), 300)');
    expect(src).toContain('damageEvPNoCheese(game, sweaterDmg,');
    expect(src).toContain('game.damagePlayer(sweaterDmg,');
  });
});

// ============================ §3 D7b：evpDirectDmg trap 档 ============================
describe('§3 D7b evpDirectDmg trap 档（1078 陨石等直调站）', () => {
  it('trap+sweater：经典 50 → 100 → 50;trap=false 逐位不变;帽 300（M4 位）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const w = mkWorld(0);
    const p = mkPlayer(w);
    (p.inv as unknown as { armor: Array<{ id: number; stack: number } | null> }).armor[1]
      = { id: SWEATER_ID, stack: 1 };
    settle(p, w);
    const g = fakeHooks(w, p) as never;
    expect(evpDirectDmg(g, 50, null, true)).toBe(50);
    expect(evpDirectDmg(g, 50, null, false)).toBe(100);   // 不传 trap=旧行为逐位不变
    expect(evpDirectDmg(g, 400, null, true)).toBe(300);   // 400×1×2=800 → min(400,300)
    const g2 = fakeHooks(w, mkPlayer(w)) as never;        // 未穿毛衣：trap 档零扰动
    expect(evpDirectDmg(g2, 50, null, true)).toBe(100);
  });

  it('MeteorChunk 1078 站点带 trap 档（TRAP_PROJ_VIDS 同源型录）', () => {
    const src = rd('src/entities/MeteorChunk.ts');
    expect(src).toContain('evpDirectDmg(game, damageVar(dmg, -p.luck), null, true)');   // ★BJ712-C：DamageVar 首掷入参包装
    const game = rd('src/core/Game.ts');
    expect(game).toContain('1078');   // TRAP_PROJ_VIDS 型录在册（BJ108 债刀-4）
  });
});

// ============================ §4 D1：17 站发射者旗矩阵 + D5 销案锁 ============================
describe('§4 D1 发射者旗矩阵（M5 位：任一站退旗即红）', () => {
  it('Enemy.ts 直构 Dart 7 站 + shoot 3 站', () => {
    const src = rd('src/entities/Enemy.ts');
    expect(src).toContain('dart96.bannerNpcId = bannerNpcKeyOf(this);');            // 101 Clinger 96
    expect(src).toContain('laser.bannerNpcId = bannerNpcKeyOf(this);');             // 122 Gastropod 84
    expect(src).toContain('seedDart.bannerNpcId = bannerNpcKeyOf(this);');          // 628 Dandelion 836
    expect(src).toContain('dart.bannerNpcId = bannerNpcKeyOf(this);   // ★BJ710-G35 D1：496');  // 496 Dreadnautilus 814
    expect(src).toContain('dart.bannerNpcId = bannerNpcKeyOf(this);   // ★BJ710-G35 D1：281-286'); // 281-286 三法师
    expect(src).toContain('curse.bannerNpcId = bannerNpcKeyOf(this);');             // 533 DesertDjinn 596
    expect(src).toContain('blast.bannerNpcId = bannerNpcKeyOf(this);');             // 172 RuneWizard 129
    expect(src).toContain('1001, 360,   // life=360（:9519 timeLeft,shoot 缺省 300 系旧直飞档）\n            { bannerNpcId: bannerNpcKeyOf(this) }');   // 315 Horseman
    expect(src).toContain('50, 538,\n            300, { bannerNpcId: bannerNpcKeyOf(this) }');   // 410 星尘小蛛
    expect(src).toContain('575,\n            300, { bannerNpcId: bannerNpcKeyOf(this) }');       // 423 星云兽
  });

  it('bossAI_dd2.ts 2 站（682 电弧 + fireWalker else 支标枪/德拉肯/食人魔）', () => {
    const src = rd('src/entities/bossAI_dd2.ts');
    expect(src).toContain('ZAP_DMG, ZAP_PROJ, 3600,\n          { bannerNpcId: bannerNpcKeyOf(e) }');
    expect(src).toContain('{ ...(javelin ? { drag: 0.98 } : {}), bannerNpcId: bannerNpcKeyOf(e) }');
  });

  it('bossAI_moon_events.ts 3 站（347 ElfCopter 180 + 143/145 雪人 110/109）+ shootE opts 参', () => {
    const src = rd('src/entities/bossAI_moon_events.ts');
    expect(src).toContain('dmg: number, projId: number, life?: number,\n  arrowOpts?: Partial<import(\'./Arrow\').ArrowOpts>,');
    expect(src).toContain('32, 180, undefined, { bannerNpcId: bannerNpcKeyOf(e) }');
    expect(src).toContain('25, 110, undefined, { bannerNpcId: bannerNpcKeyOf(e) }');
    expect(src).toContain('35, 109, undefined, { bannerNpcId: bannerNpcKeyOf(e) }');
  });

  it('bossAI_martian.ts 2 站（387 Tesla Turret 435 + 250 Angry Nimbus 264）', () => {
    const src = rd('src/entities/bossAI_martian.ts');
    expect(src).toContain('e.difficulty), 435,\n      300, 1, { bannerNpcId: bannerNpcKeyOf(e) }');
    expect(src).toContain('20, 264, 300, 1, { bannerNpcId: bannerNpcKeyOf(e) }');
  });

  it('D1 census 计数锁：BJ710-G35 旗冻结标记 = Enemy 12 + dd2 2 + moon 3 + martian 2 + MeteorChunk 1（近邻文件全量）', () => {
    expect((rd('src/entities/Enemy.ts').match(/BJ710-G35/g) ?? []).length).toBeGreaterThanOrEqual(12);
    expect((rd('src/entities/bossAI_dd2.ts').match(/BJ710-G35/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((rd('src/entities/bossAI_moon_events.ts').match(/BJ710-G35/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((rd('src/entities/bossAI_martian.ts').match(/BJ710-G35/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('D5 销案锁：仓内弹生弹站——574→576/539 爆盒已接旗;478/479 镖分裂系玩家面（!hostile 门）', () => {
    // 已接两站（BJ710-C）：
    expect(rd('src/entities/bossAI_lunar_misc.ts')).toContain('bannerNpcId: this.bannerNpcId }');
    // 玩家面弹生弹（无旗面构造性边界——bannerIdToRespondTo 消费=Damage_EVP 敌面）：
    const a = rd('src/entities/Arrow.ts');
    expect(a).toContain('if (this.projId === 479 && !this.hostile)');
    expect(a).toContain('if (this.projId === 478 && !this.hostile)');
    // boss 面（620 光女枪/618 光女族/455 死光）无旗 → bannerNpcId=null 同构零行为,
    // 不另设旗字段（census 2026-10-25:带旗父弹仓内唯 574 与 539 两族）。
  });
});

// ============================ §5 D4：MLDeathray 455 站 ============================
describe('§5 D4 MLDeathray 455 直调站', () => {
  it('evpDirectDmg 门序单源 + 弹域双旗 + ctor 冻结（ML 无旗=数值逐位不变）', () => {
    const src = rd('src/entities/bossAI_duke_moonlord.ts');
    expect(src).toContain('this.bannerNpcId = bannerNpcKeyOf(src);   // ★BJ710-G35 D4：发射者旗冻结（ML 无旗=null）');
    expect(src).toContain('evpDirectDmg(game, damageVar(this.dmg, -p.luck), this.bannerNpcId),');   // ★BJ712-C：DamageVar 首掷入参包装
    expect(src).toContain('{ projDomain: true, projVid: 455 }');
  });

  it('damageEvPNoCheese opts 透传（BossNoCheese 桶语义不变）', () => {
    const src = rd('src/entities/projTargets.ts');
    expect(src).toContain('opts?: { projDomain?: boolean; projVid?: number },');
    expect(src).toContain('game.damagePlayer(dmg, sx, sy, attacker, undefined, undefined, undefined, opts)');
    expect((src.match(/game\.damagePlayer\(dmg, sx, sy, attacker, undefined, undefined, undefined, opts\)/g) ?? []).length).toBe(2);
  });
});

// ============================ §6 D6/D2：销案锁+登记锚 ============================
describe('§6 D6 销案锁（防再登记）+ D2 登记锚', () => {
  it('D6：max(1) floor=仓内已知分歧,触发面不可达（敌弹最小伤 7=蒲公英籽;勿再登记）', () => {
    const src = rd('src/entities/projTargets.ts');
    expect(src).toContain('★D6 销案（BJ710-G35 2026-10-25）：max(1) 下限=仓内自创、保留为已知分歧');
    // 行为锁（分歧实录,非 1:1）：1 伤弹 ×0.75 → 原版 0/仓内 1——锁死该已知形态
    const w = mkWorld(0);
    const g = fakeHooks(w, undefined, (id: number) => id === 16) as never;
    expect(applyBannerDamageReceivedOnProj(g, 1, 16)).toBe(1);
    expect(applyBannerDamageReceivedOnProj(g, 2, 16)).toBe(1);   // trunc(1.5)=1:floor 无扰
  });

  it('D2 登记锚：vanilla msg27 同步 bannerIdToRespondTo（NetMessage:790/825 + MessageBuffer:1712/1741）', () => {
    expect(vanNet).toContain('if (projectile.bannerIdToRespondTo != 0)');
    expect(vanNet).toContain('writer.Write((ushort)projectile.bannerIdToRespondTo);');
    expect(vanMsgBuf).toContain('int bannerIdToRespondTo = (bitsByte28[3] ? reader.ReadUInt16() : 0);');
    expect(vanMsgBuf).toContain('proj2.bannerIdToRespondTo = bannerIdToRespondTo;');
    // 仓内 v5 快照无此面（netMakeProj kind0/2/3 重建无 bannerNpcId）——单人不可达,
    // 归 net 域批（并行会话在途,任务书见 memory/bj710g35-banner-residuals.md）。
  });
});

// ============================ §7 反编译锚（1457） ============================
describe('§7 反编译锚', () => {
  it('Damage_EVP sweater 段：×2 后、Hurt 前,无 reflected 门（:14919-14922）', () => {
    const i = vanProj.indexOf('private void Damage_EVP(Rectangle projRectangle)');
    const blk = vanProj.slice(i, i + 3000);
    const iX2 = blk.indexOf('num3 *= num4;');
    const iSw = blk.indexOf('deadMansSweater && trap');
    expect(iX2).toBeGreaterThan(-1);
    expect(iSw).toBeGreaterThan(iX2);
    expect(blk.slice(iX2, iSw)).not.toContain('reflected');
  });

  it('Damage_EVP trap 尾段（:14947-14952）：trapDebuffSource/成就无 reflected 门', () => {
    const i = vanProj.indexOf('private void Damage_EVP(Rectangle projRectangle)');
    const blk = vanProj.slice(i, i + 6000);
    expect(blk).toContain('Main.player[myPlayer].trapDebuffSource = true;');
    // （仓内 TrapShot 传 !reflected 系既有分歧——反射陷阱弹重命中玩家面登记,勿扩）
  });

  it('接触面（Player.cs:31623-31628）：GetBannerBuffEffect(npc)→BannerID() 域（npc 参非 type 裸值）', () => {
    const i = vanPlayer.indexOf('if (GetBannerBuffEffect(Main.npc[i], out var effect))');
    expect(i).toBeGreaterThan(-1);
    expect(vanPlayer.slice(i - 200, i)).toContain('num4 = Main.DamageVar((float)Main.npc[i].damage * damageMultiplier, 0f - luck);');
    const j = vanPlayer.indexOf('public bool GetBannerBuffEffect(NPC npc, out ItemID.BannerEffect effect)');
    expect(vanPlayer.slice(j, j + 220)).toContain('return GetBannerBuffEffect(BannerSystem.NPCtoBanner(npc.BannerID()), out effect);');
  });

  it('BannerID()：netID >= -10 ? netID : type（-12 getGood 僵尸回落 type）', () => {
    const i = vanNpc.indexOf('public int BannerID()');
    const blk = vanNpc.slice(i, i + 130);
    expect(blk).toContain('if (netID >= -10)');
    expect(blk).toContain('return netID;');
    expect(blk).toContain('return type;');
  });

  it('SelfHurtPlayers sweater（:15131-15134）与 Damage_EVP（:14919-14922）同式（SW-AC1 已建模面的锚）', () => {
    const i = vanProj.indexOf('private void SelfHurtPlayers');
    const blk = vanProj.slice(i, i + 2600);
    expect(blk).toContain('if (localPlayer.deadMansSweater && trap)');
  });
});
