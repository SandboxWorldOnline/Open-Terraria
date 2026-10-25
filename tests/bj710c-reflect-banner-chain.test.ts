// ★BJ710-C（2026-10-25 用户转报两件核验后修复）判别锁+行为面。
// 件1 反射弹吃难度缩放（真 bug）：原版 Projectile.cs:14913-14916
//   `if (!reflected) num3 = (int)(num3 * hostileDamageScaling.Sample(Main.Difficulty));`
//   ——反射弹跳过敌弹难度缩放（仅保留末尾恒 ×2 :14917-14918）。仓内 hitPlayer
//   旧 evpDmg 行无条件缩放 → 专家 ×4/大师 ×6（原版 ×2）。修=hitPlayer 补
//   !reflected 门（读 self.reflected——reflectProjectile 置位后走敌面）。
// 件2 旗减伤未及敌弹面（真缺口）：原版每发 NPC 发射弹带 bannerIdToRespondTo
//   （FindBannerToAssociateTo :11106-11119，EntitySource_Parent 恒注入），命中玩家
//   GetBannerBuffEffect 减伤（:14905-14908——banner 在难度缩放【前】，trunc 边界
//   序不可交换）。仓内旧旗门域错（Dart.ownerNpcId=实体 id 喂类型 id 键域）+
//   bossAI 14 直调站零旗面 → 整面失效。修=bannerNpcId 类型域全链
//   （spawnHostileProj/shootDart/14 站实体/574→576 子弹继承）+ evpDirectDmg
//   门序单源（banner→缩放→×2）。
// ★M1 变异：hitPlayer 回无条件缩放 → §1 红;M2：任一站回内联缩放 → §3 红;
//   M3：旗门域回 ownerNpcId → §1 行为+§4 红;M4：bannerNpcKeyOf 回 vanillaId 裸读
//   → §4 变体档红。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { hitPlayer, applyBannerDamageReceivedOnProj, evpDirectDmg, bannerNpcKeyOf } from '../src/entities/projTargets';

const GAME = join(__dirname, '..');
const VAN = join(GAME, '..', 'Terarria1457');
const rd = (rel: string): string => readFileSync(join(GAME, rel), 'utf8');
const vanProj = readFileSync(join(VAN, 'Terraria', 'Projectile.cs'), 'utf8');
const vanNpc = readFileSync(join(VAN, 'Terraria', 'NPC.cs'), 'utf8');
const vanBanner = readFileSync(join(VAN, 'Terraria.GameContent', 'BannerSystem.cs'), 'utf8');

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
  const w = new World(60, 60, 42, 'bj710c');
  (w as unknown as { difficulty: number }).difficulty = difficulty;
  for (let x = 12; x <= 40; x++) w.store.setTileSilent(x, 30, 1 /* dirt */);
  return w;
};
const mkPlayer = (w: World): Player => new Player(20 * 16, 27 * 16, new Inventory());
const settle = (p: Player, w: World, ticks = 12): void => {
  for (let i = 0; i < ticks; i++) p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
};

afterEach(() => vi.restoreAllMocks());

// ============================ §1 件1：反射门（M1 位） ============================
describe('§1 仓内门（M1 位：hitPlayer reflected 门）', () => {
  it('结构锁：evpDmg = reflected ? dmg : 缩放(dmg)，两者再 ×2（:14913-14918 门序）', () => {
    const src = rd('src/entities/projTargets.ts');
    expect(src).toContain('? dmg\n      : hostileProjectileDamage(dmg, mainDifficulty(game.world))) * 2;');
    expect(src).toContain('(self as { reflected?: boolean }).reflected');
    // 旧错注勘正：陈旧声明整行退役（勘正注引用旧文属定谳存档,非行为声明）
    expect(src).not.toContain('反射弹转 friendly 打怪');
  });

  it('行为面：专家档 反射弹 ×2 / 非反射弹 ×4（DamageVar 播 0.5 → ×1.0 确定性）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const w = mkWorld(1 /* expert */);
    const p = mkPlayer(w);
    settle(p, w);
    const seen: number[] = [];
    const hooks = { ...fakeHooks(w, p), damagePlayer: (d: number): number => { seen.push(d); return d; } };
    const self = { x: p.x, y: p.y, w: 8, h: 8, projId: 12 };
    hitPlayer(self, hooks as never, 50);
    expect(seen[0]).toBe(200);              // 50 ×2(专家缩放) ×2 = 200
    hitPlayer({ ...self, reflected: true } as never, hooks as never, 50);
    expect(seen[1]).toBe(100);              // 反射弹：50 ×2（跳过缩放）——旧 bug=200
    hitPlayer({ ...self, reflected: true } as never, hooks as never, 50);
    expect(seen[2]).toBe(100);              // 幂等：反射标记重复置位不改变语义
  });

  it('门序：反射弹照吃旗减伤/寒冷减伤（banner/resistCold 段无 reflected 门）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const w = mkWorld(1 /* expert */);
    const p = mkPlayer(w);
    settle(p, w);
    const seen: number[] = [];
    const hooks = {
      ...fakeHooks(w, p, (id: number) => id === 16),
      damagePlayer: (d: number): number => { seen.push(d); return d; },
    };
    // 史莱姆旗 16 激活：banner ×0.5（专家）→ 反射无缩放 → ×2
    hitPlayer({ x: p.x, y: p.y, w: 8, h: 8, projId: 12, reflected: true, bannerNpcId: 16 } as never, hooks as never, 100);
    expect(seen[0]).toBe(100);              // trunc(100×0.5)=50 → ×2 = 100（旗对反射弹生效）
  });
});

// ============================ §2 反编译锚 ============================
describe('§2 反编译锚（1457）', () => {
  it('Damage_EVP：banner 段在缩放段【前】且无 reflected 门；唯缩放段有门', () => {
    const i = vanProj.indexOf('private void Damage_EVP(Rectangle projRectangle)');
    expect(i).toBeGreaterThan(-1);
    const blk = vanProj.slice(i, i + 2500);
    const iBanner = blk.indexOf('GetBannerBuffEffect(bannerIdToRespondTo');
    const iGate = blk.indexOf('if (!reflected)');
    const iX2 = blk.indexOf('num3 *= num4;');
    expect(iBanner).toBeGreaterThan(-1);
    expect(iGate).toBeGreaterThan(iBanner);        // banner 先于缩放门
    expect(iX2).toBeGreaterThan(iGate);            // ×2 在缩放门后（无门恒乘）
    expect(blk.slice(iBanner, iGate)).not.toContain('reflected');   // banner 段无门
  });

  it('NPC.ReflectProjectile（:67189-67212）：reflected+hostile 置位 → 反射弹走 Damage_EVP 敌面', () => {
    const i = vanNpc.indexOf('public void ReflectProjectile(Projectile proj)');
    expect(i).toBeGreaterThan(-1);
    const blk = vanNpc.slice(i, i + 900);
    expect(blk).toContain('proj.reflected = true;');
    expect(blk).toContain('proj.hostile = true;');
    expect(blk).toContain('proj.friendly = false;');
    expect(blk).toContain('proj.damage /= 2;');    // int 连除两次（÷4）+ penetrate=1
  });

  it('FindBannerToAssociateTo（:11106-11119）：父 NPC→NPCtoBanner(BannerID)、父弹→继承', () => {
    const i = vanProj.indexOf('private void FindBannerToAssociateTo(IEntitySource spawnSource)');
    expect(i).toBeGreaterThan(-1);
    const blk = vanProj.slice(i, i + 400);
    expect(blk).toContain('bannerIdToRespondTo = projectile.bannerIdToRespondTo;');
    expect(blk).toContain('bannerIdToRespondTo = BannerSystem.NPCtoBanner(nPC.BannerID());');
  });

  it('发射源恒 EntitySource_Parent（NPC.GetSpawnSource_ForProjectile :91865）→ 敌怪发弹必带旗', () => {
    const i = vanNpc.indexOf('public IEntitySource GetSpawnSource_ForProjectile()');
    expect(i).toBeGreaterThan(-1);
    expect(vanNpc.slice(i, i + 120)).toContain('return new EntitySource_Parent(this);');
  });

  it('数据面：DD2 怪 568 有旗（263）、Betsy 551/Ogre 576/鹿角怪 668/飞碟 392/395 无旗', () => {
    const i = vanBanner.indexOf('public static int NPCtoBanner(int i)');
    expect(i).toBeGreaterThan(-1);
    const body = vanBanner.slice(i, vanBanner.indexOf('public static int BannerToNPC', i));
    expect(body).toMatch(/case 568:\s*\n\s*case 569:\s*\n\s*return 263;/);
    // 六型均无旗 case → 对应直调站接线=零行为（纯门序单源化）；
    // 有旗行为面 = DD2 哥布林族（681 站）/星云 411·424（Dart 537/573 站）/
    // Flow Invader·Nebula Floater（LunarOrb 539 爆盒+576 子弹）。
    expect(body).not.toMatch(/^\t*case (551|576|577|668|392|395):/m);
  });
});

// ==================== §3 件2：14 直调站链矩阵锁（M2 位） ====================
describe('§3 链矩阵锁（M2 位：直调站全走 evpDirectDmg 门序单源）', () => {
  const stationCounts: Array<[string, number]> = [
    ['src/entities/bossAI_dd2.ts', 4],           // 686/687/681/683
    ['src/entities/bossAI_deerclops.ts', 3],     // 961/962/965
    ['src/entities/bossAI_lunar_misc.ts', 1],    // LunarOrb 539 爆盒
    ['src/entities/bossAI_martian.ts', 1],       // 447 死光
    ['src/entities/bossAI_duke_moonlord.ts', 2], // 384/386 龙卷列 + MLDeathray 455（★BJ710-G35 D4 收编,14→15）
    ['src/entities/MeteorChunk.ts', 1],          // 1078（世界面 null）
    ['src/entities/FallingBlock.ts', 1],         // 沙坠/巨石（世界面 null）
    ['src/entities/Dart.ts', 2],                 // 537/573 直调站
  ];
  it('每站 evpDirectDmg 计数 = 15 总站（BJ704-R3 P1① 锁面承接;G35 D4 增 455 站）', () => {
    let total = 0;
    for (const [rel, n] of stationCounts) {
      const c = (rd(rel).match(/evpDirectDmg\(game/g) ?? []).length;
      expect(c, rel).toBe(n);
      total += c;
    }
    expect(total).toBe(15);
  });

  it('发射者追踪：Enemy.spawnHostileProj/shootDart 冻结 bannerNpcId（类型域）', () => {
    const src = rd('src/entities/Enemy.ts');
    expect(src).toContain('dart.bannerNpcId = bannerNpcKeyOf(this);');
    // 4 = spawnHostileProj + shootDart（BJ710-C）+ 史后三法师 volley + Dreadnautilus
    // 814（★BJ710-G35 D1 直构 Dart 站收编;其余 D1 站变量名不同,详 bj710g35 套件）
    expect((src.match(/dart\.bannerNpcId = bannerNpcKeyOf\(this\);/g) ?? []).length).toBe(4);
  });

  it('发射者追踪：直调站实体构造期/发射位冻结（BetsyBreath/LunarOrb/MartianDeathray/龙卷 ctor + 火球/炸弹/跺地波/鹿角怪发射位）', () => {
    expect(rd('src/entities/bossAI_dd2.ts')).toContain('this.bannerNpcId = bannerNpcKeyOf(src);');
    expect(rd('src/entities/bossAI_dd2.ts')).toContain('bannerNpcId: bannerNpcKeyOf(e) }');
    expect(rd('src/entities/bossAI_deerclops.ts')).toContain('bannerNpcId = bannerNpcKeyOf(bannerFrom);');
    expect(rd('src/entities/bossAI_lunar_misc.ts')).toContain('this.bannerNpcId = bannerNpcKeyOf(parent);');
    expect(rd('src/entities/bossAI_martian.ts')).toContain('this.bannerNpcId = bannerNpcKeyOf(src);');
    expect(rd('src/entities/bossAI_duke_moonlord.ts')).toContain('this.bannerNpcId = bannerNpcKeyOf(src);');
  });

  it('574→576 子弹继承链（原版 FindBannerToAssociateTo 父弹分支 :11110-11113）', () => {
    const src = rd('src/entities/bossAI_lunar_misc.ts');
    expect(src).toContain('bannerNpcId: this.bannerNpcId }');
  });

  it('Arrow 载体面：ArrowOpts.bannerNpcId 声明 + ctor 透传', () => {
    const src = rd('src/entities/Arrow.ts');
    expect(src).toContain('bannerNpcId?: number | null;');
    expect(src).toContain('this.bannerNpcId = opts?.bannerNpcId ?? null;');
  });

  it('旧域错门退役：hitPlayer 旗门不再读 ownerNpcId（实体 id 域）', () => {
    const src = rd('src/entities/projTargets.ts');
    expect(src).not.toContain('const srcNpcId = (self as { ownerNpcId?: number }).ownerNpcId ?? 0;');
    expect(src).toContain('applyBannerDamageReceivedOnProj(game, dmg, (self as { bannerNpcId?: number | null }).bannerNpcId)');
  });
});

// ==================== §4 件2：消费面行为（M3/M4 位） ====================
describe('§4 消费面行为（applyBannerDamageReceivedOnProj / evpDirectDmg / bannerNpcKeyOf）', () => {
  it('bannerNpcKeyOf：netId 域（变体优先）+ null 面（原版 BannerID :7671-7678 投影）', () => {
    expect(bannerNpcKeyOf({ vanillaId: 16, vanillaNetId: 0 })).toBe(16);
    expect(bannerNpcKeyOf({ vanillaId: 5, vanillaNetId: -5 })).toBe(-5);   // M4：裸 vanillaId=5 翻错旗族
    expect(bannerNpcKeyOf(null)).toBeNull();
    expect(bannerNpcKeyOf({})).toBe(0);
  });

  it('空/无旗/未放旗 = 原值直返（PvP 域外同相）', () => {
    const w = mkWorld(0);
    expect(applyBannerDamageReceivedOnProj(fakeHooks(w) as never, 100, null)).toBe(100);
    expect(applyBannerDamageReceivedOnProj(fakeHooks(w) as never, 100, 0)).toBe(100);
    expect(applyBannerDamageReceivedOnProj(fakeHooks(w, undefined, () => false) as never, 100, 16)).toBe(100);
    expect(applyBannerDamageReceivedOnProj(fakeHooks(w, undefined, (id) => id === 16) as never, 100, 551)).toBe(100);  // Betsy 无旗
  });

  it('普通旗：经典 ×0.75 trunc（101→75 非 76——旧 Math.round 系 .5 中点抬升）', () => {
    const w = mkWorld(0);
    const g = fakeHooks(w, undefined, (id) => id === 16) as never;   // 史莱姆旗（banner 146→item 2955 普通档）
    expect(applyBannerDamageReceivedOnProj(g, 101, 16)).toBe(75);   // trunc(75.75)=75
    expect(applyBannerDamageReceivedOnProj(g, 100, 16)).toBe(75);
  });

  it('DD2 旗：0.917/0.833 档（itemId 区分——接触面 :44718 无 itemId 参系另笔登记债）', () => {
    const wc = mkWorld(0);
    const gc = fakeHooks(wc, undefined, (id) => id === 568) as never;   // 568 Wither Beast → banner 263 → item 3843（DD2 档）
    expect(applyBannerDamageReceivedOnProj(gc, 100, 568)).toBe(91);    // trunc(100×0.917)=trunc(91.7)=91
    const we = mkWorld(1);
    const ge = fakeHooks(we, undefined, (id) => id === 568) as never;
    expect(applyBannerDamageReceivedOnProj(ge, 100, 568)).toBe(83);    // trunc(100×0.833)=trunc(83.3)=83
  });

  it('evpDirectDmg 门序：banner 在缩放【前】（trunc 边界不可交换）', () => {
    const w = mkWorld(1 /* expert：缩放 ×2 */);
    const g = fakeHooks(w, undefined, (id) => id === 16) as never;
    // 专家档：旗 ×0.5 → 缩放 ×2 → ×2 = trunc(trunc(trunc(13×0.5)×2))×2 = 6×2×2 = 24
    expect(evpDirectDmg(g, 13, 16)).toBe(24);
    // 反序（若 banner 后乘）：trunc(trunc(13×2)×0.5)×2 = 13×2 = 26 ≠ 24 —— 门序锁
    expect(evpDirectDmg(g, 13, 16)).not.toBe(26);
    // 无旗面（世界机关）：13 ×2(缩放) ×2 = 52 = 旧内联行为逐位不变
    expect(evpDirectDmg(g, 13, null)).toBe(52);
  });
});

// ==================== §5 数值闭环（用户转报链） ====================
describe('§5 数值闭环', () => {
  it('反射弹专家档：100 伤弹 反射 ÷4=25 → 命中 50（旧 bug=100）；BJ710-B 星云激光链 50×2×2=200 同族', () => {
    const w = mkWorld(1);
    const g = fakeHooks(w) as never;
    const afterReflect = Math.floor(Math.floor(100 / 2) / 2);        // NPC.cs:67209-67210 int 连除
    expect(afterReflect).toBe(25);
    expect(evpDirectDmg(g, afterReflect, null)).toBe(100);           // 非反射通道对照（缩放×2×2）
    // hitPlayer 反射通道（§1 行为面已锁 100）——本节锁「旧 bug 值」与新值差分：
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const p = mkPlayer(w);
    settle(p, w);
    const seen: number[] = [];
    const hooks = { ...fakeHooks(w, p), damagePlayer: (d: number): number => { seen.push(d); return d; } };
    hitPlayer({ x: p.x, y: p.y, w: 8, h: 8, projId: 12, reflected: true } as never, hooks as never, afterReflect);
    expect(seen[0]).toBe(50);                                        // 修复后：25×2（旧 bug：25×2×2=100）
    expect(seen[0]).not.toBe(100);
  });
});
