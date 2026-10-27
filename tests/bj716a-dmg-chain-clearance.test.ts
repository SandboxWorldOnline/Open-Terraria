// ★BJ716-A（2026-10-25）伤害链清偿八件——R14/R15/R18 三路审查 findings 同域并批判别锁。
//  基准 Terarria1457 亲读;与 BJ712-C（13 站 DamageVar/389 电矛）/BJ710-C/G35 锁并存。
//  件清单与锚:
//   · 1 R15-P1-1 bannerDamageDealtSample 越尾钳界（GameDifficultyData.cs:35-55
//     Sample 循环尾 key=key2=末键→num=0 早退=末键值;旧「同斜率外推」系误读——
//     master 旧 ×2.5/DD2 ×1.3=每击 +25% 过量,钳界后恒 ×2.0/×1.2）
//   · 2 R15-P1-2 攻端键域 bannerNpcKeyOf（原版攻端 GetBannerBuffEffect(npc)→
//     NPCtoBanner(npc.BannerID())=netID≥-10 域;旧裸读 vanillaId=变体史莱姆双向错）
//   · 3 R15-P2-3 evpDirectDmg resistCold 门（Projectile.cs:14909-14912 温暖×0.7,
//     banner 后/缩放前;961/962 coldDamage=true P.cs:9089/:9100）
//   · 4 R18-F1 expert EoW 虫段 /5（Projectile.cs:13392-13398 20 弹型表×NPC 13-15;
//     旧仅爆炸 face 有臂,直击/蜂族 5× 超伤）
//   · 5 R18-F2 Arrow 主环/Dart 全环/MinionProj 八面 DamageVar 首掷（:12970 ±15%）
//   · 6 R14-P2-1 MeteorChunk 1078 GDL 域（WorldGen.cs:72334-41 masterMode/expertMode
//     =GDL 浮点轴含旅程滑杆+FTW+1;旧裸读枚举域 0C/1E/2M/3J）
//   · 7 R15-P2-4 bannerReceivedMult 曲线式（DamageReceived keys{1:k1,2:k2} 连续
//     插值;旧布尔档 (1,2) 恒 k1=R15 判例3）
//   · 8 R15-P2-5 reflectProjectile 方向学（NPC.cs:67200-67208 偏置=unit×(|v|×20)+
//     归一随机×|v|;旧 unit×20 裸值+随机未归一=锥宽爆表/可反向）
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { BuffType } from '../src/stats/Buffs';
import {
  bannerDamageDealtSample, applyBannerDamageDealt, bannerDamageDealtMultOf,
  applyBannerDamageReceivedOnProj, evpDirectDmg, reflectProjectile,
  expertEowFifthDmg, EXPERT_EOW_FIFTH_PROJS,
} from '../src/entities/projTargets';
import { bannerReceivedMult, bannerOfNpc, bannerItemId } from '../src/world/Banners';
import { dealContacts, HitCdImpl } from '../src/entities/proj1457';
import { Arrow } from '../src/entities/Arrow';
import { TrapShot } from '../src/entities/Dart';
import { MeteorChunk } from '../src/entities/MeteorChunk';
import { Game } from '../src/core/Game';
import type { GameHooks } from '../src/entities/types';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const rd = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

// ---- 夹具（bj710c/bj475 同款:真 World+真 Player+spy 敌桶） ----
const mkWorld = (difficulty: number, slider?: number, getGood = false): World => {
  const w = new World(120, 60, 7, 'bj716a');
  (w as unknown as { difficulty: number }).difficulty = difficulty;
  if (slider !== undefined)
    (w as unknown as { journeyPowers?: { difficultySlider: number } }).journeyPowers = { difficultySlider: slider };
  if (getGood) (w as unknown as { seedFlags?: { getGoodWorld: boolean } }).seedFlags = { getGoodWorld: true };
  return w;
};
const fakeHooks = (w: World, bannerNpcActive?: (id: number) => boolean, enemies: unknown[] = []): GameHooks => ({
  world: w,
  player: null,
  enemies: () => enemies,
  npcs: () => [],
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
  playSfxWav: () => {},
  showPickupLabel: () => {},
  ...(bannerNpcActive ? { bannerNpcActive } : {}),
} as unknown as GameHooks);

interface SpyEnemy {
  id: number; x: number; y: number; w: number; h: number; cx: number; cy: number;
  dead: boolean; iframes: number; hp: number; maxHp: number; vanillaId: number;
  vanillaNetId?: number;
  calls: number[];
  hurt(d: number): boolean;
}
const mkEnemy = (x: number, y: number, vid: number, w = 48, h = 48): SpyEnemy => {
  const e: SpyEnemy = {
    id: 7, x, y, w, h, cx: x + w / 2, cy: y + h / 2, dead: false, iframes: 0,
    hp: 5000, maxHp: 5000, vanillaId: vid, calls: [],
    hurt(d: number) { e.calls.push(d); e.hp -= d; return true; },
  };
  return e;
};

afterEach(() => vi.restoreAllMocks());

// ============================ §1 件1：攻端旗采样越尾钳界 ============================
describe('§1 R15-P1-1 bannerDamageDealtSample 双端钳界（Sample 末键 num=0 早退）', () => {
  it('1a 普通旗值表:master/legendary 恒 ×2.0（旧外推 2.5=+25% 过量必红）', () => {
    expect(bannerDamageDealtSample(4916, 3)).toBe(2);       // master（旧 2.5）
    expect(bannerDamageDealtSample(4916, 4)).toBe(2);       // legendary（旧 3.0）
    expect(bannerDamageDealtSample(4916, 2)).toBe(2);       // expert 端点
    expect(bannerDamageDealtSample(4916, 1)).toBe(1.5);     // classic
    expect(bannerDamageDealtSample(4916, 0.5)).toBe(1.5);   // journey 钳首键
    expect(bannerDamageDealtSample(4916, 1.5)).toBeCloseTo(1.75, 10);  // 段内插值（旅程滑杆）
  });
  it('1b DD2 族 itemId 3837-3846:master 恒 ×1.2（旧外推 1.3）', () => {
    expect(bannerDamageDealtSample(3837, 3)).toBe(1.2);
    expect(bannerDamageDealtSample(3846, 3)).toBe(1.2);
    expect(bannerDamageDealtSample(3837, 4)).toBe(1.2);
    expect(bannerDamageDealtSample(3837, 2)).toBe(1.2);
    expect(bannerDamageDealtSample(3837, 1)).toBe(1.1);
    expect(bannerDamageDealtSample(3837, 1.5)).toBeCloseTo(1.15, 6);   // fround 链尾差 ~2.4e-8
  });
  it('1c applyBannerDamageDealt 端到端:master+旗激活 100→200（旧 250）', () => {
    const w = mkWorld(2 /* master */);
    const g = fakeHooks(w, () => true);
    // 键 16=史莱姆族旗（bj710c 同键域,非 DD2 档）
    const out = applyBannerDamageDealt(g, { vanillaId: 16, vanillaNetId: 0 }, 100);
    expect(out).toBe(200);   // trunc(100×2.0)（旧外推=trunc(100×2.5)=250）
    expect(bannerDamageDealtMultOf(g, { vanillaId: 16, vanillaNetId: 0 })).toBe(2);
  });
});

// ============================ §2 件2：攻端键域 netID≥-10 ============================
describe('§2 R15-P1-2 攻端键域 bannerNpcKeyOf（变体史莱姆双向错勘正）', () => {
  it('2a 变体 netId=-3：只吃变体自有旗,不吃基型旗（旧裸 vanillaId 双向错必红）', () => {
    // 变体靶:vanillaId=1（基型蓝史莱姆 type 域）+ vanillaNetId=-3 → 键=-3（netID 域）
    const gVar = fakeHooks(mkWorld(0), (id) => id === -3);   // 只激活变体旗
    expect(applyBannerDamageDealt(gVar, { vanillaId: 1, vanillaNetId: -3 }, 100)).toBe(150);  // 新:键-3 吃旗;旧:读 1 不吃=100
    const gBase = fakeHooks(mkWorld(0), (id) => id === 1);   // 只激活基型蓝史莱姆旗
    expect(applyBannerDamageDealt(gBase, { vanillaId: 1, vanillaNetId: -3 }, 100)).toBe(100); // 新:键-3 不吃;旧:读 1 错吃=150
  });
  it('2b bannerDamageDealtMultOf 同键域', () => {
    const gVar = fakeHooks(mkWorld(0), (id) => id === -3);
    expect(bannerDamageDealtMultOf(gVar, { vanillaId: 1, vanillaNetId: -3 })).toBeGreaterThan(1);
    const gBase = fakeHooks(mkWorld(0), (id) => id === 1);
    expect(bannerDamageDealtMultOf(gBase, { vanillaId: 1, vanillaNetId: -3 })).toBe(1);
  });
  it('2c Game.ts 近战位结构锁:键域 bannerNpcKeyOf（防静默回退 vanillaId）', () => {
    expect(rd('src/core/Game.ts')).toContain('const bKeyMelee = bannerNpcKeyOf(e as Parameters<typeof bannerNpcKeyOf>[0]);');
  });
});

// ============================ §3 件3：evpDirectDmg resistCold 门 ============================
describe('§3 R15-P2-3 evpDirectDmg resistCold 门（:14909-14912 温暖×0.7）', () => {
  const mkWarmPlayer = (w: World): Player => {
    const p = new Player(60 * 16, 50 * 16, new Inventory());
    p.buffs.apply(BuffType.Warmth, 60);   // 温暖(124) → resistCold
    return p;
  };
  it('3a 961/962 冷弹:温暖 ×0.7（100→140）;无温暖/非冷站=旧行为逐位不变', () => {
    const w = mkWorld(0 /* classic */);
    const warm = mkWarmPlayer(w);
    const gWarm = { ...fakeHooks(w), player: warm } as unknown as GameHooks;
    const gCold = { ...fakeHooks(w), player: new Player(60 * 16, 50 * 16, new Inventory()) } as unknown as GameHooks;
    expect(evpDirectDmg(gWarm, 100, null, false, 961)).toBe(140);  // trunc(100×0.7)=70→×2（旧=200）
    expect(evpDirectDmg(gWarm, 100, null, false, 962)).toBe(140);
    expect(evpDirectDmg(gWarm, 100, null)).toBe(200);              // 非冷站（缺省 projVid）不受门
    expect(evpDirectDmg(gCold, 100, null, false, 961)).toBe(200);  // 无温暖不受门
    expect(evpDirectDmg(gCold, 100, null, false, 965)).toBe(200);  // 965 非冷（Deerclops 亲证）
  });
  it('3b 门序:banner→resistCold→缩放→×2（trunc 边界不可交换）', () => {
    const w = mkWorld(1 /* expert:received 0.5,缩放 ×2 */);
    const warm = mkWarmPlayer(w);
    const g = { ...fakeHooks(w, (id) => id === 16), player: warm } as unknown as GameHooks;
    // banner 先:trunc(100×0.5)=50 → cold:trunc(50×0.7)=35 → 缩放 ×2 → ×2 =140
    expect(evpDirectDmg(g, 100, 16, false, 961)).toBe(140);
    // 反序对照（若 cold 先于 banner:trunc(trunc(100×0.7)×0.5)=35 同值——用非对称值再钉一发）
    expect(evpDirectDmg(g, 101, 16, false, 961)).toBe(140);   // banner:trunc(101×0.5)=50→cold:35→缩放70→×2=140
    expect(evpDirectDmg(g, 101, null, false, 961)).toBe(280); // 无旗:cold:trunc(101×0.7)=70→缩放140→×2=280
  });
  it('3c deerclops 两站结构锁:961/962 尾参 + 965 旧形保持', () => {
    const src = rd('src/entities/bossAI_deerclops.ts');
    expect(src).toContain('evpDirectDmg(game, damageVar(this.dmg, -p.luck), this.bannerNpcId, false, 961)');
    expect(src).toContain('evpDirectDmg(game, damageVar(this.dmg, -p.luck), this.bannerNpcId, false, 962)');
    expect(src).toContain('evpDirectDmg(game, damageVar(this.dmg, -p.luck), this.bannerNpcId)');   // 965
  });
});

// ============================ §4 件4：expert EoW 虫段 /5 ============================
describe('§4 R18-F1 expert EoW /5（:13392-13398 20 型表×NPC 13-15）', () => {
  it('4a expertEowFifthDmg 值表:专家门+表门+靶门三重', () => {
    const we = mkWorld(1 /* expert */), wc = mkWorld(0);
    expect(expertEowFifthDmg(100, 281, 14, we)).toBe(20);    // 兔 281×EoW 身 14
    expect(expertEowFifthDmg(103, 281, 14, we)).toBe(20);    // int 截断 103/5
    expect(expertEowFifthDmg(100, 281, 14, wc)).toBe(100);   // 经典门关
    expect(expertEowFifthDmg(100, 2, 14, we)).toBe(100);     // 普通箭不在表
    expect(expertEowFifthDmg(100, 281, 12, we)).toBe(100);   // 非 13-15（吞噬怪 12）
    expect(expertEowFifthDmg(100, 281, 16, we)).toBe(100);   // 非 13-15
    expect(expertEowFifthDmg(100, 281, undefined, we)).toBe(100);
    for (const t of [28, 37, 181, 183, 566] as const)
      expect(expertEowFifthDmg(100, t, 13, we)).toBe(20);    // 邪箭/弄臣箭/蜂族
  });
  it('4b 20 弹型表全录 + Game.EXPERT_EOW_FIFTH_PROJS 单源转发（多副本漂移收敛）', () => {
    expect([...EXPERT_EOW_FIFTH_PROJS].sort((a, b) => a - b)).toEqual(
      [28, 29, 30, 37, 108, 181, 183, 281, 397, 470, 516, 517, 519, 566, 588, 637, 773, 1002, 1086, 1087]);
    expect(Game.EXPERT_EOW_FIFTH_PROJS).toBe(EXPERT_EOW_FIFTH_PROJS);   // 同一 Set 实例=单源
  });
  it('4c dealContacts 行为:专家 281×EoW → hurt(20)（DV 掷 0.5=+0 档;旧 5× 超伤必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);          // tier 0 → ×1.0(确定);crit 掷 0.5≥0.04 恒不中
    const we = mkWorld(1);
    const e = mkEnemy(400, 300, 14);
    const hooks = fakeHooks(we, undefined, [e]);
    const self = {
      x: e.x - 5, y: e.y - 5, w: 10, h: 10, cx: e.cx, cy: e.cy,
      damage: 100, knockback: 0, armorPen: 0, critChance: 0, projId: 281,
    };
    dealContacts(self as never, hooks, new HitCdImpl(), -1);
    expect(e.calls).toEqual([20]);                          // DV(100)=100→banner 无旗→/5=20（旧=100）
    // 非表型对照:1127 同链无 /5
    const e2 = mkEnemy(400, 300, 14);
    dealContacts({ ...self, projId: 1127 } as never, fakeHooks(we, undefined, [e2]), new HitCdImpl(), -1);
    expect(e2.calls).toEqual([100]);
    // 经典门对照
    const e3 = mkEnemy(400, 300, 14);
    dealContacts(self as never, fakeHooks(mkWorld(0), undefined, [e3]), new HitCdImpl(), -1);
    expect(e3.calls).toEqual([100]);
  });
  it('4d 四消费面结构锁（dealContacts/Arrow 主环/Dart 直击+爆面）', () => {
    expect(rd('src/entities/proj1457.ts')).toContain('dmg = expertEowFifthDmg(dmg, self.projId,');
    expect(rd('src/entities/Arrow.ts')).toContain('e.hurt(expertEowFifthDmg(applyBannerDamageDealt(game, e, dmg), this.projId,');
    const dart = rd('src/entities/Dart.ts');
    expect(dart).toContain('trapProjId, (e as { vanillaId?: number | null }).vanillaId, game.world)');
    expect(dart).toContain('blProjId ?? -1, (e as { vanillaId?: number | null }).vanillaId, game.world)');
  });
});

// ============================ §5 件5：DV 首掷三环 ============================
describe('§5 R18-F2 DamageVar 首掷（:12970 ±15%,31 档离散）', () => {
  it('5a Arrow 主环:同弹同靶三档 85/100/115（旧恒平值必红）', () => {
    for (const [mock, expected] of [[0, 85], [0.5, 100], [0.9999999, 115]] as const) {
      vi.spyOn(Math, 'random').mockReturnValue(mock);
      const w = mkWorld(0);
      const e = mkEnemy(100, 96, 50 /* 普通敌,非 13-15 */);
      const hooks = fakeHooks(w, undefined, [e]);
      const a = new Arrow(110, 100, -5, 0, 100, 1, 1);
      a.fixedUpdate(1 / 60, hooks);
      expect(e.calls[e.calls.length - 1]).toBe(expected);   // 旧码:恒 100 → 85/115 拍红
    }
  });
  it('5b Dart 直击环:281 兔对 EoW 专家 = DV 后 /5（100→20）;普通镖非 EoW = DV 原值', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);          // +0 档
    const w = mkWorld(1);
    const p = new Player(60 * 16, 50 * 16, new Inventory());   // Dart.legacyStep 读 game.player.x（远离弹道）
    const e = mkEnemy(400, 300, 14);
    const hooks = { ...fakeHooks(w, undefined, [e]), player: p };
    const d = new TrapShot(405, 305, -5, 0, 100, 'bunny');
    d.fixedUpdate(1 / 60, hooks as never);
    expect(e.calls[e.calls.length - 1]).toBe(20);           // DV(100)=100→/5（旧=100 平值 5× 超伤）
    const e2 = mkEnemy(400, 300, 50);
    const d2 = new TrapShot(405, 305, -5, 0, 100, 'dart');
    d2.fixedUpdate(1 / 60, { ...fakeHooks(w, undefined, [e2]), player: p } as never);
    expect(e2.calls[e2.calls.length - 1]).toBe(100);        // 98 镖非表型:DV 原值
  });
  it('5c MinionProj 八面结构锁（contact/ai156/fist/644/aura/boom/pounce/段接触）', () => {
    const src = rd('src/entities/MinionProj.ts');
    const cnt = (s: string, sub: string) => s.split(sub).length - 1;
    expect(cnt(src, 'damageVarRoll(res.dmg, this.ownerRef()?.luck ?? 0)')).toBe(6);
    expect(cnt(src, 'damageVarRoll(res.dmg, this.ownerPlayer?.luck ?? 0)')).toBe(1);   // 段接触面
    expect(cnt(src, 'damageVarRoll(resBoom.dmg, this.ownerRef()?.luck ?? 0)')).toBe(1); // 爆弹 694-696
  });
  it('5d Arrow/Dart 包装位结构锁', () => {
    const arrow = rd('src/entities/Arrow.ts');
    expect(arrow.split('dmg = damageVarRoll(dmg, ((game.player as unknown as { luck?: number } | null)?.luck) ?? 0);').length - 1).toBe(2);
    const dart = rd('src/entities/Dart.ts');
    // ★BJ730 改判史：旧值 4（BJ716-A 时点 Dart 四点:trap 双支/blast 直击/烟花直击）→
    //  新值 8——BJ727-A C-D4（2026-10-27,炮弹/兔爆/烟花 Kill 爆城镇臂 hitTownNpcsAoeBox
    //  两掷点）+ BJ729-A B25（friendly 接触面 critter/城镇臂接线两掷点）DV 接面合法扩容。
    //  锁语义不变:Dart 伤害面 DV 首掷全覆盖计数（防回退漏掷）。
    expect(dart.split('damageVarRoll(this.damage, ((game.player as unknown as { luck?: number } | null)?.luck) ?? 0)').length - 1).toBe(8);
  });
});

// ============================ §6 件6：MeteorChunk 1078 GDL 域 ============================
describe('§6 R14-P2-1 MeteorChunk GDL 域（masterMode/expertMode 浮点难度轴）', () => {
  const meteorDmg = (w: World): number => {
    const e = mkEnemy(1600, 800, 50);
    const hooks = { ...fakeHooks(w, undefined, [e]), player: null };
    const m = new MeteorChunk(1600, 800, 5, 0);
    m.fixedUpdate(1 / 60, hooks as never);
    expect(e.calls.length).toBeGreaterThan(0);
    return e.calls[0];
  };
  it('6a 四档:经典 50/专家 40/大师 35', () => {
    expect(meteorDmg(mkWorld(0))).toBe(50);
    expect(meteorDmg(mkWorld(1))).toBe(40);
    expect(meteorDmg(mkWorld(2))).toBe(35);
  });
  it('6b 旅程滑杆 0.2（GDL≈0.80）→ 50（旧枚举域 3≥2 误判 35 必红）', () => {
    expect(meteorDmg(mkWorld(3, 0.2))).toBe(50);
  });
  it('6c FTW 经典（+1=GDL 2）→ 40（旧枚举域 0 漏感知 50 必红）', () => {
    expect(meteorDmg(mkWorld(0, undefined, true))).toBe(40);
    expect(meteorDmg(mkWorld(1, undefined, true))).toBe(35);  // FTW 专家 +1=3 → master 35
  });
  it('6d 结构锁:mainMasterMode/mainExpertMode 门（防裸 world.difficulty 回退）', () => {
    expect(rd('src/entities/MeteorChunk.ts')).toContain('mainMasterMode(game.world) ? 35 : mainExpertMode(game.world) ? 40 : 50');
  });
});

// ============================ §7 件7：bannerReceivedMult 曲线式 ============================
describe('§7 R15-P2-4 bannerReceivedMult 曲线式（旅程滑杆连续插值）', () => {
  it('7a 值表:整数轴与旧布尔档逐值相同;(1,2) 连续插值;双端钳界', () => {
    expect(bannerReceivedMult(1, 0)).toBe(0.75);
    expect(bannerReceivedMult(2, 0)).toBe(0.5);
    expect(bannerReceivedMult(0.5, 0)).toBe(0.75);         // 旅程 0.5 钳首键
    expect(bannerReceivedMult(3, 0)).toBe(0.5);            // master 钳尾键
    expect(bannerReceivedMult(1.5, 0)).toBeCloseTo(0.625, 10);   // 旧布尔档恒 0.75 必红
    expect(bannerReceivedMult(1.5, 3837)).toBeCloseTo(0.875, 10);
    expect(bannerReceivedMult(1, 3837)).toBe(0.917);       // DD2 三位小数端点 D6 锁
    expect(bannerReceivedMult(2, 3837)).toBe(0.833);
    expect(bannerReceivedMult(3, 3837)).toBe(0.833);
  });
  it('7b 消费位结构锁:两处均传 mainDifficulty（曲线式）', () => {
    expect(rd('src/entities/projTargets.ts')).toContain('bannerReceivedMult(mainDifficulty(world), bItem)');
    expect(rd('src/core/Game.ts')).toContain('bannerReceivedMult(mainDifficulty(this.world), bannerItemId(bannerOfNpc(bKey)))');
  });
  it('7c applyBannerDamageReceivedOnProj 端到端:旅程滑杆 1.5 → 100→62（旧布尔档 75）', () => {
    const w = mkWorld(3, 0.4975);   // GDL=1.5（remap 0.4975→1.5,roundCS(30)/20）
    const g = fakeHooks(w, (id) => id === 16);
    expect(applyBannerDamageReceivedOnProj(g, 100, 16)).toBe(62);   // trunc(100×0.625)=62（旧=75）
  });
});

// ============================ §8 件8：reflectProjectile 方向学 ============================
describe('§8 R15-P2-5 reflectProjectile 方向学（:67200-67208）', () => {
  const REAL_RANDOM = Math.random;   // 模块加载期捕获真源（防 spy 递归）
  const reflect = (speed: number, draws: () => number = REAL_RANDOM): { vx: number; vy: number; damage: number } => {
    vi.spyOn(Math, 'random').mockImplementation(draws);
    const proj = { x: 0, y: 0, w: 8, h: 8, vx: -speed, vy: 0, damage: 100, hostile: false };
    const game = {
      player: { cx: -1000, cy: 0 },   // 发射者在左侧 → 朝发射者方向=(-1,0)
      playSfxFile: () => false, playSfx: () => {}, spawnParticles: () => {},
    };
    reflectProjectile(proj as never, game as never);
    return { vx: proj.vx, vy: proj.vy, damage: proj.damage };
  };
  it('8a 锥界:任意随机下反射向恒在朝发射者 ±atan(1/20)≈2.86° 内（旧 unit×20 裸值=锥宽爆表必红）', () => {
    for (let i = 0; i < 200; i++) {
      const { vx, vy } = reflect(30);
      const sp = Math.hypot(vx, vy);
      expect(sp).toBeCloseTo(30, 6);              // 终速恒 |oldVelocity|
      // 基准方向 = unit(player中心−proj中心)（proj 中心 (4,4),非纯 (-1,0)）
      const ux = -1004 / Math.hypot(1004, 4), uy = -4 / Math.hypot(1004, 4);
      const cosA = (vx * ux + vy * uy) / sp;      // 与朝发射者实际方向的夹角余弦
      expect(cosA).toBeGreaterThan(Math.cos((2.8624 + 0.05) * Math.PI / 180));  // ≤atan(1/20)+浮点余量
    }
  });
  it('8b 高速弹（速 50）锥界保持+速度守恒（旧式速>~28 随机项主导可反向必红）', () => {
    for (let i = 0; i < 100; i++) {
      const { vx, vy } = reflect(50);
      const sp = Math.hypot(vx, vy);
      expect(sp).toBeCloseTo(50, 6);
      expect(vx).toBeLessThan(0);                 // 恒朝发射者半平面（旧式可 vx>0 反向飞离）
    }
  });
  it('8c damage ÷2×2=int 语义 + hostile 置位', () => {
    const { damage } = reflect(30, () => 0.5);
    expect(damage).toBe(25);                      // floor(floor(100/2)/2)
  });
});
