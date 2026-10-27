// 蓝队三批（2026-08-31）回归：F1 旗乘区单源 / F2 血舌球子步 / F3 村正寿命+出生补偿 /
// F4 971 尘初速 / F5 钛金碎片平伤 / F6 钛金 proc 迁位+A-F1 排除表 / F8 手套加法堆叠 /
// F9 DamageVar 单源+受击截断 / F10 kb=0 冲量归零 / F13 桶表满填 / F15 撤 !immortal /
// F16 彩纸 Kill 尘尾段 / Z-F1 蜂类别旗回注 / Z-F4 彩纸联机即时上线 / γ 挖地龟中心锚。
// 标杆 Terarria1457；锚注随断言。测法：行为面（Enemy/TownNPC/纯实体 node 驱动）
// + 结构锚（readFileSync 源读，同 weapon-melee-leftover.test.ts 口径）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toEvenRound, damageVarRoll } from '../src/stats/DamageVar';
import { Enemy } from '../src/entities/Enemy';
import { ConfettiBurstProj, MuramasaSlashProj, BladetongueGlobProj }
  from '../src/entities/meleeOnHitProjs';
import { HurtCooldownBuckets, getGlobalHurtBuckets } from '../src/player/HurtCooldownBuckets';
import { bannerDamageDealtSample } from '../src/entities/projTargets';

const src = (rel: string): string =>
  readFileSync(join(__dirname, '..', rel), 'utf8');
const srcGame = (): string => src('src/core/Game.ts');

afterEach(() => { vi.restoreAllMocks(); });

// ============================================================
// ★F9 stats/DamageVar 单源
// ============================================================
// SW-AB1 2026-09-04 引注校准:旧题止行 "67124" = DamageVar 函数收括号,三要素域实止于
// :67123 `return (int)Math.Round(num)`（函数体首实义行 = :67103,:67102 = NoDamageVar 支收括号）。
describe('F9 DamageVar 单源（Main.cs:67097-67123 三要素）', () => {
  it('ToEven 银行家舍入中点档', () => {
    expect(toEvenRound(2.5)).toBe(2);
    expect(toEvenRound(3.5)).toBe(4);
    expect(toEvenRound(48.5)).toBe(48);     // η 数字化案同族：half-up 会给 49
    expect(toEvenRound(84.999)).toBe(85);
  });

  it('离散 31 档（rand.Next(-15,16)）而非连续均匀', () => {
    // rnd()=0 → tier -15 → ×0.85；rnd()→0.99… → tier +15 → ×1.15
    expect(damageVarRoll(100, 0, () => 0)).toBe(85);
    const hi = damageVarRoll(100, 0, () => 0.9999999);
    expect(hi).toBeGreaterThanOrEqual(114);   // floor(x*31)=30 → 115 取整后 ≥114
    expect(hi).toBeLessThanOrEqual(116);
    // 输出恒为整数
    for (let i = 0; i < 40; i++) {
      const v = damageVarRoll(37, 0);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('luck 重掷取极值：luck>0 取大 / luck<0 取小（重掷门走 NextFloat<luck）', () => {
    // rnd 消费序：①主档 ②NextFloat 门 ③重掷档。luck>0 取 max：
    // 主档 tier0=37、门 0.1<1、重掷 tier-15=31.45 → 37
    const seqMax = (() => { const q = [0.5, 0.1, 0]; let i = 0; return () => q[i++ % 3]; })();
    expect(damageVarRoll(37, 1, seqMax)).toBe(37);
    // luck<0 取 min：主档 tier-15=31.45、门 0.1<1、重掷 tier+15=42.55 → min 31.45 → 31
    const seqMin = (() => { const q = [0, 0.1, 0.9999999]; let i = 0; return () => q[i++ % 3]; })();
    expect(damageVarRoll(37, -1, seqMin)).toBe(31);
  });

  it('bannerDamageDealtSample（ItemID.cs:1072 BannerStrength）：普通族 1.5/2 与 DD2 族 1.1/1.2、★BJ716-A 大师钳界', () => {
    expect(bannerDamageDealtSample(2090, 1)).toBeCloseTo(1.5);
    expect(bannerDamageDealtSample(2090, 2)).toBeCloseTo(2);
    expect(bannerDamageDealtSample(3837, 2)).toBeCloseTo(1.2);
    // ★BJ716-A（R15-P1-1）改判史:旧锁 2.5「越尾外推」系误读——Sample 循环尾
    //  key=key2=末键→num=0 早退=末键值（GameDifficultyData.cs:35-55）;大师恒 ×2.0/DD2 ×1.2
    expect(bannerDamageDealtSample(2090, 3)).toBe(2);
    expect(bannerDamageDealtSample(2090, 4)).toBe(2);
    expect(bannerDamageDealtSample(3837, 3)).toBe(1.2);
  });
});

// ============================================================
// ★F9 受击截断 / ★F1 内挂旗块删除 / ★F6+A-F1 钛金 proc 迁位与来源排除
// ============================================================
function enemyStub(): { e: Enemy; log: { dmg: number }[] } {
  const e = Enemy.fromVanilla(1, 0, 0)!;
  e.maxHp = 100000;
  e.hp = 100000;
  (e.def as { defense?: number }).defense = 7;
  return { e, log: [] as { dmg: number }[] };
}

function gameStubFor(e: Enemy, opts: Partial<{ banner: boolean }> = {}) {
  const spawnTitaniumShardCalls = vi.fn();
  const player = {
    dead: false,
    cx: 0, cy: 0,
    titaniumStormCd: 0,
    equipStats: { titaniumStorm: true },
    buffs: { apply: vi.fn() },
    addDPS: vi.fn(),
  };
  const g = {
    player,
    bannerNpcActive: () => opts.banner === true,
    spawnTitaniumShard: spawnTitaniumShardCalls,
    addDamageNumber: vi.fn(),
    playSfxFiles: vi.fn(),
    playSfxWav: vi.fn(),
    spawnParticles: vi.fn(),
    dust: null,
    critters: () => [],
    enemies: () => [],
  };
  return { g: g as never, spawnTitaniumShardCalls, player };
}

describe('F1/F6/F9/A-F1 Enemy.hurt 管线', () => {
  it('奇防非暴击截断口径：def=7、dmg=10 → 实扣 6（原版 (int)(10−3.5)；旧 round 给 7）', () => {
    const { e } = enemyStub();
    const { g } = gameStubFor(e);
    const before = e.hp;
    e.hurt(10, 0, 0, g as never, 0, false, 0, true);
    expect(before - e.hp).toBe(6);       // Main.cs:67126 double 不取整 + NPC.cs:82067 (int)
  });

  it('★F1：内挂旗乘区已删——banner 在栏时两次同伤实扣相等（×1.5² 不复现）', () => {
    const a = enemyStub(); const ga = gameStubFor(a.e, { banner: true });
    const b = enemyStub(); const gb = gameStubFor(b.e, { banner: true });
    const d1 = (() => { const h0 = a.e.hp; a.e.iframes = 0; a.e.hurt(30, 0, 0, ga.g as never, 0, false, 0, true); return h0 - a.e.hp; })();
    const d2 = (() => { const h0 = b.e.hp; b.e.iframes = 0; b.e.hurt(30, 0, 0, gb.g as never, 0, false, 0, true); return h0 - b.e.hp; })();
    const plain = (() => { const c = enemyStub(); const gc = gameStubFor(c.e); const h0 = c.e.hp; c.e.hurt(30, 0, 0, gc.g as never, 0, false, 0, true); return h0 - c.e.hp; })();
    expect(d1).toBe(d2);                 // 旗位不在受击端
    expect(d1).toBe(plain);              // 且与无旗一致（攻端采样由 applyBannerDamageDealt 承担）
  });

  it('★F6：免疫窗内命中不 proc 不吃 cd；正常满链 proc 一枚且 cd=10', () => {
    const { e } = enemyStub();
    const { g, spawnTitaniumShardCalls, player } = gameStubFor(e);
    e.iframes = 10;                      // immune[owner]>0——ProcessHitAgainstNPC :44598 门
    e.hurt(50, 0, 0, g as never, 0, false, 0, true);
    expect(spawnTitaniumShardCalls).not.toHaveBeenCalled();
    expect(player.titaniumStormCd).toBe(0);      // 未吃冷却
    e.iframes = 0;
    e.hurt(50, 0, 0, g as never, 0, false, 0, true);
    expect(spawnTitaniumShardCalls).toHaveBeenCalledTimes(1);
    expect(player.titaniumStormCd).toBe(10);     // :6928
    player.titaniumStormCd = 0;                  // 复位验 dontTakeDamage 门
    e.dontTakeDamage = true;
    e.hurt(50, 0, 0, g as never, 0, false, 0, true);
    expect(spawnTitaniumShardCalls).toHaveBeenCalledTimes(1);
    expect(player.titaniumStormCd).toBe(0);
  });

  it('A-F1 来源排除表：弹 908/977 命中不 proc；普通弹照常 proc', () => {
    const shard = enemyStub(); const gs = gameStubFor(shard.e);
    shard.e.hurt(50, 0, 0, gs.g as never, 0, false, 0, true, 0, 908);
    expect(gs.spawnTitaniumShardCalls).not.toHaveBeenCalled();
    const slash = enemyStub(); const gz = gameStubFor(slash.e);
    slash.e.hurt(50, 0, 0, gz.g as never, 0, false, 0, true, 0, 977);
    expect(gz.spawnTitaniumShardCalls).not.toHaveBeenCalled();
    const norm = enemyStub(); const gn = gameStubFor(norm.e);
    norm.e.hurt(50, 0, 0, gn.g as never, 0, false, 0, true, 0, 111);
    expect(gn.spawnTitaniumShardCalls).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// ★F13 HurtCooldownBuckets.setAll（Player.cs:38298-38306 无条件满填）
// ============================================================
describe('F13 SetImmuneTimeForAllTypes 满填', () => {
  it('setAll 覆写全部桶（区别于仅空位的 applyAfterHit），并覆盖 WrongBugNet/Lava', () => {
    const t = new HurtCooldownBuckets();
    t.applyAfterHit(ImmunityCooldownIdSafe.WrongBugNet, 1);   // 既有短窗
    t.applyAfterHit(4, 1);                                    // Lava
    t.setAll(80);
    expect(t.remaining(ImmunityCooldownIdSafe.WrongBugNet)).toBe(80);
    expect(t.remaining(4)).toBe(80);
    expect(t.blocksHit(3)).toBe(true);                        // 木网捕熔岩饵料在闪避窗被挡
    expect(getGlobalHurtBuckets()).toBeNull();                // 模块级登记缺省未绑定
  });
});
const ImmunityCooldownIdSafe = { WrongBugNet: 3 };

// ============================================================
// ★F16 彩纸 Kill 尘尾段（Projectile.cs:76091-76102 六段扰动）
// ============================================================
describe('F16 ConfettiBurstProj Kill 尘', () => {
  it('尾段补齐 ×0.05 加项与 scale 微抖（mock rand=0 的确定形）', async () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    const captured: Array<Record<string, number>> = [];
    const game = {
      spawnDust: (..._a: unknown[]) => {
        const d = { x: 0, y: 0, vx: 1, vy: 2, scale: 1 };
        captured.push(d);
        return d;
      },
    };
    const p = new ConfettiBurstProj(100, 200, 1, 2);
    p.fixedUpdate(1 / 60, game as never);
    p.fixedUpdate(1 / 60, game as never);   // lifeLeft 2 → 第二拍消亡出尘
    expect(captured.length).toBeGreaterThan(0);
    // mock 0 终值（六段全跑）：vx: 1→0.5→0.25→−2.25；vy: 2→1.5→0.75→−1.75；
    // scale ×(1+(0−30)×0.01)=×0.7
    for (const d of captured) {
      expect(Math.abs(d.vx - (-2.25))).toBeLessThan(1e-9);
      expect(Math.abs(d.vy - (-1.75))).toBeLessThan(1e-9);
      expect(Math.abs(d.scale - 0.7)).toBeLessThan(1e-9);
    }
    expect(p.dead).toBe(true);
    spy.mockRestore();
  });

  it('★Z-F4：projId=289 元数据位 + spawnFriendlyProj netSync 挂钩', () => {
    const p = new ConfettiBurstProj(0, 0, 0, 0);
    expect(p.projId).toBe(289);
    const sGame = srcGame();
    expect(sGame.includes('spawnFriendlyProj(e: import(\'../entities/Entity\').Entity, opts?: { netSync?: boolean })')).toBe(true);
    expect(sGame.includes('{ netSync: true }')).toBe(true);
    expect((sGame.match(/netSync: true/g) ?? []).length).toBeGreaterThanOrEqual(4); // 武器端 1 + 近战 1 + PvP 1×{glob?bee} 至少 4 支
  });
});

// ============================================================
// ★F3 MuramasaSlashProj 寿命（timeLeft 子步内递减 → 10 实帧）
// ============================================================
describe('F3 MuramasaSlashProj 寿命与出生补偿', () => {
  it('lifeLeft-- 入子步循环：第 9 帧存活、第 10 帧消亡（30/extraUpdates2=10）', () => {
    const dustStub = { spawnDust: () => null, playSfx: () => undefined, enemies: () => [] };
    const cut = new MuramasaSlashProj(0, 0, 1, 0, 20, 0, Math.PI / 8);
    for (let f = 0; f < 9; f++) cut.fixedUpdate(1 / 60, dustStub as never);
    expect(cut.dead).toBe(false);
    cut.fixedUpdate(1 / 60, dustStub as never);
    expect(cut.dead).toBe(true);
  });

  it('结构锚：spawn 位 += npc.velocity * 5（Player.cs:44903 vector3 += npc.velocity*num9）', () => {
    const g = srcGame();
    expect(g.includes('wx += Math.fround(e.vx * 5); wy += Math.fround(e.vy * 5);')).toBe(true);
  });
});

// ============================================================
// ★F2 BladetongueGlobProj extraUpdates=5 六子步
// ============================================================
describe('F2 BladetongueGlobProj 子步化', () => {
  it('每实帧 6 子步：重力 0.048/帧、ai0 += 3.6、尘 12 笔（mock rand=0 门全过）', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const dustsArr: number[] = [];
      const glob = new BladetongueGlobProj(5000, 5000, 0.5, 0, 10, 1);
      const game = {
        spawnDust: (_x: number, _y: number, _w: number, _h: number, _t: number) => {
          dustsArr.push(1);
          return { x: 0, y: 0, vx: 0, vy: 0, scale: 1 };
        },
        playSfx: () => undefined,
        enemies: () => [],
      };
      glob.fixedUpdate(1 / 60, game as never);
      expect(dustsArr.length).toBe(12);            // 6 子步 × 2 笔
      expect(glob.vy).toBeCloseTo(0.048, 9);       // 0.008 × 6
      expect((glob as unknown as { ai0: number }).ai0).toBeCloseTo(3.6, 9);
      expect(glob.dead).toBe(false);
    } finally { spy.mockRestore(); }
  });

  it('ai0>500 提前 Kill：总帧数 ≪ 旧 833 帧（≤250 帧内消亡）', () => {
    const glob = new BladetongueGlobProj(5000, 5000, 0.5, 0, 10, 1);
    const game = {
      spawnDust: () => ({ x: 0, y: 0, vx: 0, vy: 0, scale: 1 }),
      playSfx: () => undefined,
      enemies: () => [],
    };
    let aliveFrames = 0;
    while (!glob.dead && aliveFrames < 900) { glob.fixedUpdate(1 / 60, game as never); if (!glob.dead) aliveFrames++; }
    expect(aliveFrames).toBeLessThanOrEqual(250);
  });
});

// ============================================================
// 结构锚组：Z-F1 / F5 / F8 / F14 / F15 / F17 / γ
// ============================================================
describe('三批结构锚', () => {
  it('Z-F1：蜂类别旗回注三站（蜂巢 1124/蜂王 PvE/PvP）+ 蜂蜜斗篷保持无旗', () => {
    const g = srcGame();
    expect((g.match(/\.projClass = 'melee';/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(g.includes("bee.projClass = 'melee'")).toBe(true);
    // 反射站上下文不注入：蜂蜜斗篷块内不应出现 projClass 写入
    // ★IIIII250:锚随 damagePlayer 函数级快照改 eq.bees(原 equipStats.bees 已随快照化退役)
    const i = g.indexOf('eq.bees && retaliateOk');
    const slice = g.slice(i, i + 2600);
    expect(slice.includes(".projClass = 'melee'")).toBe(false);
    // 翻案注释勘误语已落（189=Wasp）
    expect(g.includes('189=Wasp')).toBe(true);
  });

  it('F5：钛金碎片平伤 50（Player.cs:6933 字面量，撤面板乘区）', () => {
    const g = srcGame();
    const i = g.indexOf('spawnTitaniumShard(x: number, y: number): void {');
    const body = g.slice(i, g.indexOf('\n  }', i));
    expect(body.includes('const dmg = 50;')).toBe(true);
    expect(body.includes('damageMult')).toBe(false);
  });

  it('F8：手套加法堆叠（kbGlove ?1:0 + Titan ?0.5:0，单行序 kbGlove→Titan→3106）', () => {
    const g = srcGame();
    const i = g.indexOf('const kb = ((this.swing.kb ?? tool?.knockback ?? swingCombat?.knockBack ?? 3))');
    const line = g.slice(i, g.indexOf('\n', i));
    expect(line).toContain('(eq.kbGlove ? 1 : 0)');   // ★IIIII250:updateUse 函数级快照 eq(冻结对象,语义同直读)
    expect(line).toContain('+ (this.player.buffs.has(BuffType.Titan) ? 0.5 : 0)');
    expect(line.indexOf('kbGlove')).toBeLessThan(line.indexOf('3106'));
  });

  it('F10：扑击弹 818 击退冲量归零（kb=0 → 原版双门不进）', () => {
    const m = src('src/entities/MinionProj.ts');
    // ★BJ482 会话 oracle 重产（2026-10-03）：旧引语 `en.hurt(res.dmg, 0, 0, game, 0,
    //  false, 0, true); // kb=0` 已被 BJ436 写梯档位（818=usesLocal+cd=-1 → pierce=-3
    //  清窗档 :14175-14179）+BJ452 N2 crit 色位+BJ455③ banner 乘区包入三刀改形
    //  （MinionProj 818 臂现役行），引语随现役定谳面刷新——kb=0 双门不进意图不变。
    // ★BJ716-A（R18-F2）锁随刀走:818 臂补 DamageVar 首掷（dmgVPounce）——kb=0 双门不进意图不变
    expect(m.includes('en.hurt(applyBannerDamageDealt(game, en, dmgVPounce), 0, 0, game, 0, critPounce, -3, true)')).toBe(true);   // ★S02(BJ723-B)锁随刀走:预倍摘除（×2=Enemy.hurt 防后）
  });

  it('F14：PvP 两伴生支就位（血舌球 3211 ×0.7 / 蜂王 1123 num/3）', () => {
    const g = srcGame();
    expect(g.includes('heldVidPvp === 3211')).toBe(true);
    expect(g.includes('heldVidPvp === 1123')).toBe(true);
    expect(g.includes('Math.trunc(rawDmg / 3)')).toBe(true);
    // 甲虫 MP 记账已由 MB-B 收敛（原 BLOCKER 登记注释被合法替换）：
    // 断言翻转 = 回执关联制接线在场（FIFO 登记 + vanilla 精确式）
    expect(g.includes('notePendingMeleeHit(')).toBe(true);
    expect(g.includes('beetlePvpCredit')).toBe(true);
    expect(g.includes('BLOCKER 登记')).toBe(false);
  });

  it('F15：!flagImmortal 已从 5094/795 两支摘除（BatBat/Volcano 不动）', () => {
    const g = srcGame();
    const i5094 = g.indexOf('swingVid === 5094 && this.swing?.tentacleSpikes === true');
    const l5094 = g.slice(i5094, g.indexOf('\n', i5094));
    expect(l5094.includes('flagImmortal')).toBe(false);
    const i795 = g.indexOf('swingVid === 795 && this.swing?.bloodButchererSpikes === true') !== -1
      ? g.indexOf('swingVid === 795 && this.swing?.bloodButchererSpikes === true')
      : g.indexOf('swingVid === 795 && this.swing?.bloodButchererSpawns === true');
    const l795 = g.slice(i795, g.indexOf('\n', i795));
    expect(l795.includes('flagImmortal')).toBe(false);
    // BatBat/Volcano 门保留
    expect(g.includes('hittableForOnHitRewards(e)')).toBe(true);
  });

  it('F17：火山爆弹可见度方向修正（opacity = alphaTick）', () => {
    const v = src('src/entities/VolcanoBlastProj.ts');
    expect(v.includes('const opacity = Math.max(0, Math.min(1, this.alphaTick));')).toBe(true);
    expect(v.includes('opacity = Math.max(0, Math.min(1, 1 - this.alphaTick))')).toBe(false);
  });

  it('γ 移交：挖地龟出生中心锚（minionTrueBox 半盒回撤）', () => {
    const g = srcGame();
    // ★2026-10-13 刀4-A 批前先在债勘正:HEAD import 已扩 sentrySpawnBox/auraLightBandCast
    //  (sentry 工作面),本锚锁「三件核心名同源导入」不锁全名清单(全名锁=过脆,扩名即伪红)
    expect(g.includes("import { MinionProj, pickSentryLandingSpot, minionTrueBox, sentrySpawnBox, auraLightBandCast } from '../entities/MinionProj';")).toBe(true);
    expect(g.includes('new MinionProj(x * TILE + 8 - bwT.w / 2, y * TILE - 32 - bwT.h / 2, projId')).toBe(true);
  });

  it('F1 弹侧旗乘区接线：dealContacts/hitEnemies/Arrow 主结算均走 applyBannerDamageDealt', () => {
    expect(src('src/entities/proj1457.ts').includes('dmg = applyBannerDamageDealt(game, e, dmg);')).toBe(true);
    // ★F1（蓝队四轮）重锚：焰爆石加伤在 banner【后】并入（Projectile.cs:14451 晚于
    // :13387）⇒ 加伤表达式插在 applyBanner 与击退实参之间是正确终态——锚放宽为
    // 「hurt 首参以 applyBannerDamageDealt 打头、kdir 实参仍在其中」的正则形。
    expect(/e\.hurt\(applyBannerDamageDealt\(game, e, dmg\)[^;]*?, kdir \* self\.knockback/.test(src('src/entities/WeaponProj.ts'))).toBe(true);
    expect(src('src/entities/Arrow.ts').split('applyBannerDamageDealt(').length - 1).toBeGreaterThanOrEqual(8);
  });
});

// 引用兜底：让 import 不被 tree-shake 报错（TownNPC 侧不被本文件触碰）
void enemyStub; void getGlobalHurtBuckets;
