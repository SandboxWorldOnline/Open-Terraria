// ★BJ712-A（2026-10-25 外部核验报告转报四件 + 补件石巨人自由头）判别锁+行为面。
// 转报行号与当前盘上文件【精确吻合·零漂移】（修前形态）：
//   件1 月总游离眼死光 ×2 重复乘 —— bossAI_lunar_misc.ts:479（修前 `50 * 2`）
//   件2 Boss 反弹弹幕难度豁免 —— projTargets.ts:808 hitPlayer（★BJ710-C 件1
//         2026-10-25 已修,转报快照早于该刀;本刀=验证现态锁在位 + 转报数值
//         与修前形态逐位吻合即闭环,勿重做）
//   件3 光之女皇夜间接触难度缩放缺 —— bossAI_lategame.ts:1729（修前 baseOf 回落
//         e.vanilla.damage 未缩放基值）
//   件4 史莱姆皇后接触 AI 覆盖难度缩放 —— bossAI_lategame.ts:2237（同上）
//   件5 石巨人自由头接触重置经典基值 —— bossAI_golem.ts:482（修前每拍写
//         vanillaNpc(249).damage=80 未缩放基值）
// 定谳链（1457 亲读,先定谳再动刀）：
//   · Damage_EVP Projectile.cs:14905-14922：DamageVar → banner → resistCold →
//     `if (!reflected) num3=(int)(num3*hostileDamageScaling.Sample(Difficulty))`
//     → 恒 ×2（num4=2）。hostileDamageScaling=HostileProjectileDamageMultiplier
//     （GameDifficultyData.cs:67：旅 0.5/经典 1/专家 2/大师 3 线性）。
//   · 死光出生值 NPC.cs:43343 真眼 `455, 50` / :42679 头 `455, 75`（:42851 伤 1
//     一发在 `if (0 == 2)` 死码分支不可达）——出生伤不含任何预乘,乘区全在命中侧。
//   · NPC.ScaleStats :18178-18201：ByDifficulty `damage=GetAttackDamage_ScaledBy
//     Difficulty`（EnemyDamageMultiplier 0.5/1/2/3）→ Tweaks → 尾部
//     `defDamage = damage`【缩放后快照】——AI 派生写消费 defDamage（缩放基线）。
//   · 女皇 :47431-47437 尾段 `damage=(int)(defDamage*num16)`（num16:46509 缺省 1,
//     :47166 冲刺减速窗 40<ai1≤90 ×1.5）;flag4 白天暴怒后置覆写 9999;defense=
//     (int)(defDefense*1.2)/defDefense。史后 AI_121（:45695-46160）与石巨人两代头
//     AI_046/AI_048（:31273-31499/:31500-31760）均【零】damage 写位——缩放值原样保留。
//   · Tweaks 族乘区（NPC.cs:18310-18508,本仓 ScaleStats.ts 同构）：657 史后
//     num2=0.8（生命）/无伤 tweak;636 女皇 num2=0.7（生命）/无伤 tweak;
//     245-249 石巨人族 num=0.8（伤害,仅 Classic→Expert ramp 段应用）→ 249 基伤
//     80 → 80/128/192。
// ★变异恰红：M1 回 `50 * 2` → §1 红;M2 baseOf 回 e.vanilla.damage 回落 → §3/§4 红;
//   M3 自由头回每拍写基值 → §5 红;M4 hitPlayer 回无条件缩放 → §2 红（bj710c §1
//   同面承接,本文件 §2 数值口径=转报原文）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { Enemy } from '../src/entities/Enemy';
import { empressOfLightAI, queenSlimeAI } from '../src/entities/bossAI_lategame';
import { golemHeadAI } from '../src/entities/bossAI_golem';
import { bindScaleStatsWorld, scaleStatsWorldOf, GDL } from '../src/stats/ScaleStats';
import { hitPlayer, evpDirectDmg } from '../src/entities/projTargets';

const GAME = join(__dirname, '..');
const VAN = join(GAME, '..', 'Terarria1457');
const rd = (rel: string): string => readFileSync(join(GAME, rel), 'utf8');
const vanProj = readFileSync(join(VAN, 'Terraria', 'Projectile.cs'), 'utf8');
const vanNpc = readFileSync(join(VAN, 'Terraria', 'NPC.cs'), 'utf8');
const vanDiff = readFileSync(join(VAN, 'Terraria.DataStructures', 'GameDifficultyData.cs'), 'utf8');

afterEach(() => { vi.restoreAllMocks(); bindScaleStatsWorld(null); });

// ---------------------------------------------------------------------------
// 夹具（bj710c fakeHooks 同族;boss AI 只消费 world/enemies/粒子/音效可选面）
// ---------------------------------------------------------------------------
const fakeHooks = (w: World, p?: Player | null, enemies: unknown[] = []) =>
  ({
    world: w, player: p ?? null, enemies: () => enemies,
    spawnParticles: () => {}, playSfxWav: () => {}, playSfxFiles: () => {},
    damagePlayer: (): number => 0, addDamageNumber: () => {}, cutTile: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {}, spawnDust: undefined,
    playSfx: () => {}, showPickupLabel: () => {}, notifyInventoryChanged: () => {},
    scene: {},
  }) as never;

/** 世界档:difficulty 域 0=经典/1=专家/2=大师(mainDifficulty → GDL 1/2/3) */
const mkWorld = (difficulty: number, night = true): World => {
  const w = new World(60, 60, 42, 'bj712a');
  (w as unknown as { difficulty: number }).difficulty = difficulty;
  if (night) w.clock.timeOfDay = 0;          // 午夜（DAWN=4.5/24 前 = 夜）
  else w.clock.timeOfDay = 8.25 / 24;        // 8:15AM = 昼（女皇白天暴怒档）
  for (let x = 12; x <= 40; x++) w.store.setTileSilent(x, 30, 1);
  bindScaleStatsWorld(scaleStatsWorldOf(w, () => false));
  return w;
};
const mkPlayer = (w: World): Player => new Player(20 * 16, 27 * 16, new Inventory());

// ============================ §1 件1 游离眼死光 ============================
describe('§1 件1 月总游离眼死亡之光 ×2 重复乘（bossAI_lunar_misc.ts:479）', () => {
  it('结构锁：出生伤=原值 50,`50 * 2` 预乘零残留（M1 位）', () => {
    const src = rd('src/entities/bossAI_lunar_misc.ts');
    expect(src).toContain("new MLDeathray(e, 'core', ang, n * TAU / 540, 50), 'projectiles');");
    expect(src).not.toContain("new MLDeathray(e, 'core', ang, n * TAU / 540, 50 * 2)");
  });

  it('姊妹站零回退：头 75（bossAI_duke_moonlord :2488）/ 核心折叠兜底 50（:2176）均原值', () => {
    const src = rd('src/entities/bossAI_duke_moonlord.ts');
    expect(src).toContain("mlDeathray(game, e, 'head', player, 75)");
    expect(src).toContain("mlDeathray(game, e, 'core', player, 50)");
  });

  it('反编译锚：真眼死光出生 455/50、头 455/75（NPC.cs:43343/:42679）', () => {
    expect(vanNpc).toContain('spinningpoint2.Y, 455, 50, 0f, Main.myPlayer, num27 * (MathF.PI * 2f) / 540f, whoAmI);');
    expect(vanNpc).toContain('spinningpoint.Y, 455, 75, 0f, Main.myPlayer, num13 * (MathF.PI * 2f) / 540f, whoAmI);');
    // :42851 伤 1 一发在 `if (0 == 2)` 死码分支（反编译平铺陷阱,不可达）
    expect(vanNpc).toContain('vector9.Y, 455, 1, 0f, Main.myPlayer, MathF.PI / 300f, whoAmI);');
  });

  it('行为面：evpDirectDmg(50) 全链 = 100/200/300（旅程 50）;旧 `50*2`=100 → 200/400/600', () => {
    expect(evpDirectDmg(fakeHooks(mkWorld(0)), 50, null)).toBe(100);   // 50×1×2
    expect(evpDirectDmg(fakeHooks(mkWorld(1)), 50, null)).toBe(200);   // 50×2×2
    expect(evpDirectDmg(fakeHooks(mkWorld(2)), 50, null)).toBe(300);   // 50×3×2
    expect(evpDirectDmg(fakeHooks(mkWorld(0)), 100, null)).toBe(200);  // 旧形态（base 已预乘）
    expect(evpDirectDmg(fakeHooks(mkWorld(1)), 100, null)).toBe(400);
    expect(evpDirectDmg(fakeHooks(mkWorld(2)), 100, null)).toBe(600);
  });
});

// ==================== §2 件2 Boss 反弹弹幕难度豁免（已修验证） ====================
describe('§2 件2 反射弹难度豁免（projTargets.ts:808,BJ710-C 件1 已修在位）', () => {
  it('结构锁：hitPlayer evpDmg 带 reflected 门（转报快照早于 BJ710-C,现态验证）', () => {
    const src = rd('src/entities/projTargets.ts');
    expect(src).toContain('? dmg\n      : hostileProjectileDamage(dmg, mainDifficulty(game.world))) * 2;');
    expect(src).toContain('(self as { reflected?: boolean }).reflected');
  });

  it('反编译锚：Damage_EVP 唯缩放段有 !reflected 门,末尾恒 ×2（:14913-14918）', () => {
    const i = vanProj.indexOf('if (!reflected)');
    expect(i).toBeGreaterThan(-1);
    const blk = vanProj.slice(i, i + 260);
    expect(blk).toMatch(/if \(!reflected\)\s*\{\s*num3 = \(int\)\(\(float\)num3 \* hostileDamageScaling\.Sample\(Main\.Difficulty\)\);/);
    expect(blk).toContain('int num4 = 2;');
    expect(blk).toContain('num3 *= num4;');
    expect(vanDiff).toContain('HostileProjectileDamageMultiplier = new LinearCurve(new LinearCurve.Key(GameDifficultyLevel.Journey, 0.5f), new LinearCurve.Key(GameDifficultyLevel.Master, 3f))');
  });

  it('行为面（转报数值闭环）：基伤 100 反射弹 → 200/200/200（DamageVar 播 0.5 确定性）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    for (const [diffTag, diff, want] of [
      ['经典', 0, 200], ['专家', 1, 200], ['大师', 2, 200],
    ] as const) {
      const w = mkWorld(diff);
      const p = mkPlayer(w);
      const seen: number[] = [];
      const hooks = { ...(fakeHooks(w, p) as Record<string, unknown>), damagePlayer: (d: number): number => { seen.push(d); return d; } };
      hitPlayer({ x: p.x, y: p.y, w: 8, h: 8, projId: 12, reflected: true } as never, hooks as never, 100);
      expect(seen[0], `${diffTag}档反射弹`).toBe(want);   // 100 → 跳过缩放 → ×2
    }
  });

  it('对照面：非反射同弹 100 → 200/400/600（=转报「实际」列,证明快照早于修复）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const wants: Record<number, number> = { 0: 200, 1: 400, 2: 600 };
    for (const diff of [0, 1, 2]) {
      const w = mkWorld(diff);
      const p = mkPlayer(w);
      const seen: number[] = [];
      const hooks = { ...(fakeHooks(w, p) as Record<string, unknown>), damagePlayer: (d: number): number => { seen.push(d); return d; } };
      hitPlayer({ x: p.x, y: p.y, w: 8, h: 8, projId: 12 } as never, hooks as never, 100);
      expect(seen[0]).toBe(wants[diff]);   // 100×难度(1/2/3)×2
    }
  });
});

// ==================== §3 件3 光之女皇夜间接触难度缩放 ====================
describe('§3 件3 女皇接触伤（bossAI_lategame.ts:1729,b.dmg 基线）', () => {
  it('结构锁：baseOf 首拍捕获缩放后 def（e.vanilla.damage 未缩放回落零残留,M2 位）', () => {
    const src = rd('src/entities/bossAI_lategame.ts');
    expect(src).toContain('if (!b) { b = { dmg: e.def.damage, def: e.def.defense ?? 0 }; baseStats.set(e, b); }');
    expect(src).not.toContain('b.dmg = e.vanilla.damage ?? b.dmg;');
    expect(src).not.toContain('b.def = e.vanilla.defense ?? b.def;');
  });

  it('反编译锚：女皇尾段 damage=(int)(defDamage×num16)+9999 覆写;defDamage=ScaleStats 后快照', () => {
    expect(vanNpc).toContain('damage = (int)((float)defDamage * num16);');
    const i = vanNpc.indexOf('damage = (int)((float)defDamage * num16);');
    expect(vanNpc.slice(i, i + 80)).toContain('damage = 9999;');
    // ScaleStats 尾部快照（:18197-18199,缩放【后】落成——第三处 8365/17846 系
    // SetDefaults 域先手快照,锚定 ScaleStats 内第三处）
    const j = vanNpc.indexOf('defDamage = damage;', vanNpc.indexOf('public void ScaleStats('));
    expect(j).toBeGreaterThan(-1);
    expect(vanNpc.slice(j - 400, j)).toContain('lifeMax = 6;');
    // num16 冲刺窗（:47164-47167）
    const k = vanNpc.indexOf('num16 *= 1.5f;');
    expect(k).toBeGreaterThan(-1);
    expect(vanNpc.slice(k - 200, k)).toContain('this.ai[1] <= 90f');
  });

  it('行为面：夜间普通接触 80/160/240,白天暴怒 9999（每档新实体首拍）', () => {
    const nightWants: Record<number, number> = { 0: 80, 1: 160, 2: 240 };   // 旧 bug=80/80/80
    for (const diff of [0, 1, 2]) {
      const w = mkWorld(diff, true);
      const e = Enemy.fromVanilla(636, 100, 100)!;
      empressOfLightAI(e, fakeHooks(w, null) as never, null);
      expect(e.def.damage, `女皇接触 difficulty=${diff}`).toBe(nightWants[diff]);
    }
    const wDay = mkWorld(1, false);
    const eDay = Enemy.fromVanilla(636, 100, 100)!;
    empressOfLightAI(eDay, fakeHooks(wDay, null) as never, null);
    expect(eDay.def.damage).toBe(9999);                                     // 白天暴怒覆写
  });

  it('行为面：冲刺窗（ai0=8,ai1=50）×1.5 → 120/240/360（旧 bug=120/120/120）', () => {
    const dashWants: Record<number, number> = { 0: 120, 1: 240, 2: 360 };
    for (const diff of [0, 1, 2]) {
      const w = mkWorld(diff, true);
      const p = mkPlayer(w);
      const e = Enemy.fromVanilla(636, 100, 100)!;
      empressOfLightAI(e, fakeHooks(w, null) as never, null);   // 拍1：baseOf 捕获+无目标态
      e.ai0 = 8; e.ai1 = 50;                                     // 冲刺减速窗（40<ai1≤90）
      empressOfLightAI(e, fakeHooks(w, p) as never, p);
      expect(e.def.damage, `女皇冲刺 difficulty=${diff}`).toBe(dashWants[diff]);
    }
  });
});

// ==================== §4 件4 史莱姆皇后接触 AI 覆盖难度缩放 ====================
describe('§4 件4 史后接触伤（bossAI_lategame.ts:2237）', () => {
  it('反编译锚：AI_121 全段（:45695-46311）零 damage 写位（缩放值原样保留）', () => {
    const i = vanNpc.indexOf('private void AI_121_QueenSlime()');
    expect(i).toBeGreaterThan(-1);
    const end = vanNpc.indexOf('public bool AI_120_HallowBoss_IsInPhase2()', i);
    expect(end).toBeGreaterThan(i);
    const blk = vanNpc.slice(i, end);
    expect(blk).not.toMatch(/damage\s*=/);   // 无任何 damage 赋值（写位只在 ScaleStats）
  });

  it('行为面：接触伤 60/120/180（旧 bug=60/60/60）;每档新实体首拍', () => {
    const wants: Record<number, number> = { 0: 60, 1: 120, 2: 180 };
    for (const diff of [0, 1, 2]) {
      const w = mkWorld(diff, true);
      const e = Enemy.fromVanilla(657, 100, 100)!;
      queenSlimeAI(e, fakeHooks(w, null) as never, null);
      expect(e.def.damage, `史后接触 difficulty=${diff}`).toBe(wants[diff]);
      expect(e.def.defense).toBe(26);        // 657 防御无难度缩放面,基值直存
    }
  });
});

// ==================== §5 件5 石巨人自由头接触重置经典基值 ====================
describe('§5 件5 石巨人自由头接触伤（bossAI_golem.ts:482）', () => {
  it('结构锁：自由头分支零 damage/defense 覆写（每拍写基值 80/32 退役,M3 位）', () => {
    const src = rd('src/entities/bossAI_golem.ts');
    expect(src).not.toContain('e.def.damage = free?.damage ?? 80;');
    expect(src).not.toContain('e.def.defense = free?.defense ?? 32;');
    expect(src).toContain('if (x.free) {\n    e.dontTakeDamage = true;   // :12151 自由头无敌');
    // 兜底在位转换走 ScaleStats 单源（NewNPC 249 等价）
    expect(src).toContain('const fb = freeHead249Stats();');
    expect(src).toContain('import { scaleStats, type ScalingStats }');
  });

  it('反编译锚：挂载头 246 血尽 → HitEffect NewNPC 249（fresh 出生走完整 ScaleStats）', () => {
    const j = vanNpc.indexOf('NewNPC(GetSpawnSource_NPCHurt(), (int)base.Center.X, (int)position.Y + height, 249, whoAmI);');
    expect(j).toBeGreaterThan(-1);
    expect(vanNpc.slice(j - 300, j)).toContain('else if (type == 246)');
    // ScaleStats Tweaks 石巨人族 num=0.8（伤害,仅 Classic→Expert ramp 段应用——
    // 经典档 tweak=1,故 80/128/192 而非 64/128/192）
    const k = vanNpc.indexOf('else if (type >= 245 && type <= 249)');
    expect(k).toBeGreaterThan(-1);
    expect(vanNpc.slice(k, k + 220)).toContain('num = 0.8');
    const m = vanNpc.indexOf('num5 *= Utils.Remap(difficulty, GameDifficultyLevel.Classic, GameDifficultyLevel.Expert, 1f, (float)num);');
    expect(m).toBeGreaterThan(-1);
    expect(vanNpc.slice(m, m + 200)).toContain('damage = (int)Math.Round((float)damage * num5);');
    // （AI_048 自由头段 :31500-31741 亲读零 damage 写位——反编译平铺无稳定字符串
    //  锚,定谳存档于本文件头注;机制证明=上方 NewNPC 249 fresh 转生链）
  });

  it('行为面：fresh 249 出生即 ScaleStats 终值,AI 拍后不被覆写 → 80/128/192（旧 bug=80/80/80）', () => {
    const wants: Record<number, number> = { 0: 80, 1: 128, 2: 192 };   // 80×难度×族tweak0.8
    for (const diff of [0, 1, 2]) {
      const w = mkWorld(diff, true);
      const body = Enemy.fromVanilla(245, 100, 100)!;
      const head = Enemy.fromVanilla(249, 100, 40)!;
      expect(head.def.damage, `249 出生缩放 difficulty=${diff}`).toBe(wants[diff]);
      golemHeadAI(head, fakeHooks(w, null, [body]) as never, null);
      expect(head.def.damage, `249 AI 拍后（不被覆写） difficulty=${diff}`).toBe(wants[diff]);
      expect(head.def.defense).toBe(32);
      expect(head.dontTakeDamage).toBe(true);        // :12151 恒无敌保持
    }
  });
});

// ============================ §6 数值闭环总表 ============================
describe('§6 转报四值闭环（经典/专家/大师）', () => {
  it('件1 死光 100/200/300;件2 反射 200/200/200;件3 女皇 80/160/240(冲刺 ×1.5=120/240/360);件4 史后 60/120/180;件5 自由头 80/128/192', () => {
    // 件1：50 基伤 ×hostileDamageScaling(1/2/3) ×2
    expect([1, 2, 3].map((m) => 50 * m * 2)).toEqual([100, 200, 300]);
    // 件2：100 基伤（反射后）跳过缩放恒 ×2
    expect([1, 2, 3].map(() => 100 * 2)).toEqual([200, 200, 200]);
    // 件3：80 基伤 ×EnemyDamageMultiplier(1/2/3)（女皇无伤 tweak）
    expect([1, 2, 3].map((m) => 80 * m)).toEqual([80, 160, 240]);
    expect([1, 2, 3].map((m) => 80 * m * 1.5)).toEqual([120, 240, 360]);
    // 件4：60 基伤 ×(1/2/3)（史后无伤 tweak）
    expect([1, 2, 3].map((m) => 60 * m)).toEqual([60, 120, 180]);
    // 件5：80 基伤 ×(1/2/3) ×族 tweak（num5=Remap(Classic→Expert,1,0.8):经典档
    // tweak=1、专家/大师档 0.8——Remap 只铺 Classic→Expert 段,Master 保持 0.8）
    expect([1, 2, 3].map((m) => Math.round(80 * m * (m === 1 ? 1 : 0.8)))).toEqual([80, 128, 192]);
  });
});
