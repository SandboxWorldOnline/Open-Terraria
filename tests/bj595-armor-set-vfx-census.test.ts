// BJ595 套装视效全域普查（用户明令「对各种套装的视效都应该进行一轮普查」）。
//
// 三档定谳口径：真缺（本 census 落刀/登记）/ 语义错 / 已同构（销案,列对拍证据面）。
// ★日耀套（Solar Flare）= BJ594 在途域,本套件只列台账不落刀不深查（防同窗互扰）。
//
// 原版锚（Terarria1457/Terraria 亲读,行号指该树）：
//   · UpdateArmorSets 家族 Player.cs:16419-16696（ApplySetBonus_Solar/Stardust/
//     UpdateArmorSets_Always_Beetle/Chlorophyte/Vortex + ApplySetBonus_Beetle*）；
//   · 潜行链 :25930-26097（shroomiteStealth/setVortex 段 + flag11 环尘 :26059-26092）；
//   · 叶绿孢子 :26177-26193；死亡尘爆 :39330-39360；受击尘 :38825-38852（frostArmor
//     d135/boneArmor d26 选型支 :38838-38848）+ 受击音 frost 分支 :38984-38986；
//   · 冲刺 DashMovement :21424-21731（dash1/dash5 尘段 :21440-21452/:21501-21515/
//     :21583-21612/:21700-21715;dash2 循环 m<0 与 dash4 无 dashType=4 赋值面=死支）；
//   · 绘制层 PlayerDrawLayers.cs（BeetleBuff :4130-4155 / SolarShield :3130-3145 /
//     ForbiddenSetRing :280-326 / ApplyStealthToColor :3575-3605）；
//   · armorGlow 表 PlayerDrawSet.cs:459-785 + 发光甲光照 UpdateArmorLights :31381-31555。
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import {
  armorHurtDustType, playerHurtDustCount,
  emitVortexStealthFadeDust, emitDashSlideDust, emitDashLaunchBurst,
  emitPlayerHurtDust, emitPlayerDeathDustExplosion,
  type BJ595DustPool,
} from '../src/entities/Player';

const PLY = readFileSync(new URL('../src/entities/Player.ts', import.meta.url), 'utf8');
const GAME = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');
const RDR = readFileSync(new URL('../src/render/Renderer.ts', import.meta.url), 'utf8');

// ===================== 台账（三档结构锁） =====================

type Verdict = 'fixed-bj595' | 'fixed-bj596' | 'fixed-bj598' | 'fixed-bj599' | 'registered-debt' | 'isomorphic' | 'dead-vanilla' | 'vanilla-none' | 'bj594-inflight';
interface LedgerEntry {
  id: string; set: string; face: string; verdict: Verdict;
  vanilla: string;   // 反编译锚
  repo?: string;     // 本仓锚（fixed/isomorphic 必备）
}

const LEDGER: LedgerEntry[] = [
  // ---- 日耀套（BJ594 在途——只列不动） ----
  { id: 'S1', set: 'Solar', face: '盾回充 16×尘6(套染料)', verdict: 'bj594-inflight', vanilla: 'Player.cs:16496-16504' },
  { id: 'S2', set: 'Solar', face: '盾球轨道 solarShieldPos 弹簧', verdict: 'bj594-inflight', vanilla: 'Player.cs:16513-16551' },
  { id: 'S3', set: 'Solar', face: 'dash3 滑行 4×尘6/拍+起爆 20×尘6', verdict: 'bj594-inflight', vanilla: 'Player.cs:21461-21478/21634-21650' },
  { id: 'S4', set: 'Solar', face: '盾球绘制 DrawPlayer_26_SolarShield', verdict: 'bj594-inflight', vanilla: 'PlayerDrawLayers.cs:3130-3145' },
  { id: 'S5', set: 'Solar', face: '本体 outline/残影双特效', verdict: 'bj594-inflight', vanilla: 'Player.cs:37371-37375' },
  { id: 'S6', set: 'Solar', face: '环境拖尘（行走火焰尾）', verdict: 'vanilla-none', vanilla: 'setSolar 消费面=无尘支（1457 全读）' },
  { id: 'S7', set: 'Solar', face: '甲件恒色 250 自发光（lunar glow 同域）', verdict: 'bj594-inflight', vanilla: 'PlayerDrawSet.cs:592-595/729-732/790-795' },
  // ---- 甲虫套 ----
  { id: 'B1', set: 'Beetle', face: 'orb 环绕物理 beetlePos/beetleVel/beetleFrame', verdict: 'fixed-bj596', vanilla: 'Player.cs:16556-16612', repo: 'src/entities/Player.ts stepBeetleOrb' },
  { id: 'B2', set: 'Beetle', face: 'orb 绘制 DrawPlayer_37_BeetleBuff(5 残影+本体)', verdict: 'fixed-bj596', vanilla: 'PlayerDrawLayers.cs:4130-4155', repo: 'src/render/Renderer.ts BJ596 甲虫 orb 段+beetleOrbDrawPlan' },
  { id: 'B3', set: 'Beetle', face: '蓄能 buff 95-100 计数域', verdict: 'isomorphic', vanilla: 'Player.cs:16596-16696', repo: 'src/player/BeetleMeter.ts' },
  // ---- 星璇套 ----
  { id: 'V1', set: 'Vortex', face: '潜行衰减拍环尘 d229+d240', verdict: 'fixed-bj595', vanilla: 'Player.cs:26059-26092', repo: 'src/entities/Player.ts emitVortexStealthFadeDust' },
  { id: 'V2', set: 'Vortex', face: 'dash4 尘229', verdict: 'dead-vanilla', vanilla: 'Player.cs:21483-21500（dashType=4 无赋值面,1457 全树 grep 仅 0/1/2/3/5/6）' },
  { id: 'V3', set: 'Vortex', face: '潜行甲体染色 secondColor Lerp', verdict: 'isomorphic', vanilla: 'PlayerDrawSet.cs:1610-1651', repo: 'src/data/vanillaWingVisuals.ts stealthFactors.vortexTint' },
  { id: 'V4', set: 'Vortex', face: '双击↓开关 vortexStealthActive', verdict: 'isomorphic', vanilla: 'Player.cs:57444-57448', repo: 'src/entities/Player.ts KeyDoubleTap 支' },
  // ---- 星尘套 ----
  { id: 'D1', set: 'Stardust', face: '守护者 623 生成+buff187', verdict: 'isomorphic', vanilla: 'Player.cs:16446-16458', repo: 'src/core/Game.ts:9343 summonSet.guardian' },
  { id: 'D2', set: 'Stardust', face: 'rest 目标点尘环 135×3', verdict: 'isomorphic', vanilla: 'Player.cs:57683-57701', repo: 'src/entities/Player.ts BJ157⑧ 支' },
  { id: 'D3', set: 'Stardust', face: '甲发光 glow 184/185-186+188/187', verdict: 'registered-debt', vanilla: 'PlayerDrawSet.cs:573-578/645-697/759-766' },
  // ---- 星云套 ----
  { id: 'N1', set: 'Nebula', face: 'booster 拾取物 3453-3455', verdict: 'isomorphic', vanilla: 'Projectile.cs:13885-13889', repo: 'src/entities/NebulaBooster.ts' },
  { id: 'N2', set: 'Nebula', face: '甲发光 glow 16/14-19+arm12/17', verdict: 'registered-debt', vanilla: 'PlayerDrawSet.cs:578-583/658-671/759-762' },
  { id: 'N3', set: 'Nebula', face: '环境拖尘', verdict: 'vanilla-none', vanilla: 'setNebula 消费面=无尘支（1457 全读）' },
  // ---- 叶绿套 ----
  { id: 'C1', set: 'Chlorophyte', face: 'buff60 水晶叶锚体 226', verdict: 'isomorphic', vanilla: 'Player.cs:11746-11762', repo: 'src/entities/Player.ts crystalLeaf 支' },
  { id: 'C2', set: 'Chlorophyte', face: '孢子侵染 397 玩家侧 SporeCloud 编排粒', verdict: 'isomorphic', vanilla: 'Player.cs:26177-26193', repo: 'src/entities/Player.ts:4310（粒子形态近似,登记注）' },
  // ---- 寒霜套 ----
  { id: 'F1', set: 'Frost', face: '受击尘 d135(套染料) 选型支', verdict: 'fixed-bj595', vanilla: 'Player.cs:38838-38842', repo: 'src/entities/Player.ts armorHurtDustType' },
  { id: 'F2', set: 'Frost', face: '受击音 Item27', verdict: 'fixed-bj598', vanilla: 'Player.cs:38984-38986', repo: 'src/player/PlayerVoice.ts hurtVoicePlan 甲支（Item_27）' },
  { id: 'F3', set: 'Frost', face: '死亡尘爆 d135', verdict: 'fixed-bj595', vanilla: 'Player.cs:39343-39347', repo: 'src/entities/Player.ts emitPlayerDeathDustExplosion' },
  { id: 'F4', set: 'Frost', face: '环境拖尘（雪尾）', verdict: 'vanilla-none', vanilla: 'frostArmor 消费面=受击/死亡/音三支（:38838/:38984/:39343）,无行走尾尘' },
  // ---- 骨甲（necro） ----
  { id: 'X1', set: 'Bone', face: '受击尘 d26(套染料) 选型支', verdict: 'fixed-bj595', vanilla: 'Player.cs:38844-38848', repo: 'src/entities/Player.ts boneArmor' },
  { id: 'X2', set: 'Bone', face: '死亡尘爆 d26', verdict: 'fixed-bj595', vanilla: 'Player.cs:39349-39353', repo: 'src/entities/Player.ts emitPlayerDeathDustExplosion' },
  { id: 'X3', set: 'Bone', face: '受击音 case3', verdict: 'fixed-bj598', vanilla: 'Player.cs:38989-38991', repo: 'src/player/PlayerVoice.ts hurtVoicePlan 甲支（NPC_Hit_2）' },
  // ---- 幽灵套（Spectre） ----
  { id: 'P1', set: 'Spectre', face: 'healing 光珠弹 298（ghostHeal）', verdict: 'isomorphic', vanilla: 'Projectile.cs:13877-13879/12077', repo: 'src/entities/HealProj.ts' },
  { id: 'P2', set: 'Spectre', face: 'hurt 浮魂弹 356+d175 拖尾', verdict: 'isomorphic', vanilla: 'Projectile.cs:13881-13883/12021', repo: 'src/entities/SpectreSoulProj.ts' },
  { id: 'P3', set: 'Spectre', face: 'afterimage 残影', verdict: 'vanilla-none', vanilla: 'Player.cs 残影仅 isFirstFractalAfterImage（:1555）,幽灵套无残影面' },
  { id: 'P4', set: 'Spectre', face: '幽蓝甲发光光照（UpdateArmorLights 169-171/175-177/110-112 族）', verdict: 'fixed-bj598', vanilla: 'Player.cs:31381-31555', repo: 'src/lighting/ArmorLights.ts computeArmorLights（十八站全表）+Game.tickLighting 发射站' },
  // ---- 蘑菇矿套（Shroomite） ----
  { id: 'M1', set: 'Shroomite', face: '潜行蓄放 stealth 链', verdict: 'isomorphic', vanilla: 'Player.cs:25982-26021', repo: 'src/entities/Player.ts shroomiteSet 支' },
  { id: 'M2', set: 'Shroomite', face: '甲体潜行减色（armor RGB×s/B×settled）', verdict: 'isomorphic', vanilla: 'PlayerDrawSet.cs:1525-1563', repo: 'src/data/vanillaWingVisuals.ts stealthFactors' },
  { id: 'M3', set: 'Shroomite', face: '手持物潜行减色 ApplyStealthToColor', verdict: 'fixed-bj599', vanilla: 'PlayerDrawLayers.cs:3589-3605', repo: 'src/render/heldItemStealthDim.ts heldItemStealthDim/applyStealthToColor/dimmedHeldRegion + Renderer.ts 静持/挥舞/火苗三站' },
  // ---- 禁戒套（Forbidden） ----
  { id: 'G1', set: 'Forbidden', face: '常驻光照 0.8/0.7/0.2', verdict: 'isomorphic', vanilla: 'ArmorSetBonuses.cs:61-65', repo: 'src/entities/Player.ts addLightAt 支' },
  { id: 'G2', set: 'Forbidden', face: '符号环 DrawPlayer_05（Extra_74+Glow_217 四珠）', verdict: 'isomorphic', vanilla: 'PlayerDrawLayers.cs:280-326', repo: 'src/render/Renderer.ts:19094 段' },
  { id: 'G3', set: 'Forbidden', face: '冲刺沙暴 656/655+预览尘', verdict: 'isomorphic', vanilla: 'Player.cs:57449-57456', repo: 'src/entities/ForbiddenSignProj.ts' },
  // ---- 钛金/山铜/圣骑士域（on-hit 视效） ----
  { id: 'T1', set: 'Titanium', face: '碎片屏障 908+buff306', verdict: 'isomorphic', vanilla: 'Player.cs:6927-6935', repo: 'src/entities/Arrow.ts TitaniumStormShard' },
  { id: 'T2', set: 'Orichalcum', face: '花瓣弹 221（屏缘掷向）', verdict: 'isomorphic', vanilla: 'Player.cs:6963-6985', repo: 'src/entities/OrichalcumPetalProj.ts' },
  // ---- 神圣域 ----
  { id: 'H1', set: 'Hallowed', face: '幻影闪避 buff59（无绘制面）', verdict: 'vanilla-none', vanilla: 'Player.cs:38516-38316 ShadowDodge 无尘/无残影（仅 NetMessage 62 同步）' },
  { id: 'H2', set: 'Hallowed', face: 'on-hit 授予链', verdict: 'isomorphic', vanilla: 'Player.cs:6937-6940', repo: 'src/stats/Buffs.ts ShadowDodge 注' },
  // ---- 水晶刺客 / 忍者足具（冲刺视觉） ----
  { id: 'A1', set: 'CrystalAssassin', face: 'dash5 滑行 2×尘68/69/70/拍', verdict: 'fixed-bj595', vanilla: 'Player.cs:21503-21515', repo: 'src/entities/Player.ts emitDashSlideDust' },
  { id: 'A2', set: 'CrystalAssassin', face: 'dash5 起爆 20×尘68/69/70', verdict: 'fixed-bj595', vanilla: 'Player.cs:21700-21715', repo: 'src/entities/Player.ts emitDashLaunchBurst' },
  { id: 'A3', set: 'NinjaDash(dash1 配饰域)', face: '滑行 2×尘31/拍+起爆 20×尘31+gore61-63×2', verdict: 'fixed-bj595', vanilla: 'Player.cs:21440-21452/21583-21612', repo: 'src/entities/Player.ts emitDashSlideDust/emitDashLaunchBurst' },
  { id: 'A4', set: 'EocShield(dash2)', face: '滑行/起爆尘', verdict: 'dead-vanilla', vanilla: 'Player.cs:21446-21460 循环 m<0、:21619-21635 循环 num42<0（反编译零迭代死支）' },
  // ---- 猩红/钯金/龟壳（数值域或无视觉） ----
  { id: 'R1', set: 'Crimson', face: '回血脉搏红粒 d5×10', verdict: 'isomorphic', vanilla: 'Player.cs:19411-19429', repo: 'src/entities/Player.ts:4583 crimsonRegen 支' },
  { id: 'R2', set: 'Palladium/Turtle/Cobalt 等', face: '套装视觉', verdict: 'vanilla-none', vanilla: '纯数值面（ArmorSetBonuses.cs Benefits 全表无尘/无绘制支）' },
];

describe('BJ595 台账三档结构锁', () => {
  it('每条目必有 verdict∈六档 + vanilla 锚；fixed/isomorphic 必有 repo 锚', () => {
    const VERDICTS: Verdict[] = ['fixed-bj595', 'fixed-bj596', 'fixed-bj598', 'fixed-bj599', 'registered-debt', 'isomorphic', 'dead-vanilla', 'vanilla-none', 'bj594-inflight'];
    for (const e of LEDGER) {
      expect(VERDICTS, e.id).toContain(e.verdict);
      expect(e.vanilla.length > 4, e.id).toBe(true);
      if (e.verdict === 'fixed-bj595' || e.verdict === 'isomorphic' || e.verdict === 'fixed-bj599') {
        expect(e.repo, `${e.id} 缺本仓锚`).toBeTruthy();
      }
    }
  });

  it('普查面覆盖全套域（任务四类：穿戴尘/glow/专属绘制支/buff 视觉）', () => {
    const sets = new Set(LEDGER.map((e) => e.set));
    for (const s of ['Solar', 'Beetle', 'Vortex', 'Nebula', 'Stardust', 'Chlorophyte',
      'Frost', 'Bone', 'Spectre', 'Shroomite', 'Forbidden', 'Titanium', 'Orichalcum',
      'Hallowed', 'CrystalAssassin', 'Crimson']) {
      expect(sets.has(s), `台账缺套装域 ${s}`).toBe(true);
    }
  });

  it('日耀套全部条目 = bj594 在途或 vanilla-none（BJ595 不越域落刀）', () => {
    for (const e of LEDGER.filter((e) => e.set === 'Solar')) {
      expect(['bj594-inflight', 'vanilla-none'], e.id).toContain(e.verdict);
    }
  });

  it('fixed-bj595 面全部有本仓单源符号（源文锁）', () => {
    for (const sym of ['emitVortexStealthFadeDust', 'emitDashSlideDust',
      'emitDashLaunchBurst', 'emitPlayerHurtDust', 'emitPlayerDeathDustExplosion',
      'armorHurtDustType', 'playerHurtDustCount']) {
      expect(PLY.includes(`export function ${sym}`), `Player.ts 缺 ${sym}`).toBe(true);
    }
    expect(GAME.includes('emitPlayerHurtDust(this.vanillaDust')).toBe(true);
  });
});

// ===================== 已落小面逐参锁 =====================

interface RecDust {
  x: number; y: number; vx: number; vy: number;
  scale: number; fadeIn: number; noGravity: boolean; dyeVid: number;
  box: { x: number; y: number; w: number; h: number }; type: number;
  alpha: number; color: unknown;
}
function stubPool(): BJ595DustPool & { spawns: RecDust[] } {
  const spawns: RecDust[] = [];
  return {
    spawns,
    spawn(x: number, y: number, w: number, h: number, type: number,
      speedX = 0, speedY = 0, alpha = 0,
      color: { r: number; g: number; b: number; a: number } | null = null, scale = 1) {
      const d: RecDust = {
        x, y, vx: speedX, vy: speedY, scale, fadeIn: 0, noGravity: false, dyeVid: -1,
        box: { x, y, w, h }, type, alpha, color,
      };
      spawns.push(d);
      return d as unknown as import('../src/fx/VanillaDust').VDust;
    },
  };
}
/** mulberry32 种子 rng（可复现） */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('BJ595 面 V1：星璇潜行衰减环尘（Player.cs:26059-26092）', () => {
  it('rand≡0 → 两族各 1 粒：d229 位 Center−v×5/vel(−4,0)/scale.5/fadeIn.5、d240 位 Center−v×12/vel(2,0)', () => {
    const pool = stubPool();
    const n = emitVortexStealthFadeDust(pool, 100, 200, () => 0);
    expect(n).toBe(2);
    const [d229, d240] = pool.spawns;
    // th=0 → v=(−sin0,cos0)=(0,1)
    expect(d229.type).toBe(229);
    expect(d229.x).toBeCloseTo(100); expect(d229.y).toBeCloseTo(195);   // cy−5（Next(5,11) 单掷=5）
    expect(d229.vx).toBeCloseTo(-4); expect(d229.vy).toBeCloseTo(0);    // RotatedBy(π/2)×4
    expect(d229.scale).toBeCloseTo(0.5); expect(d229.fadeIn).toBe(0.5);
    expect(d229.noGravity).toBe(true);
    // spawn 盒=(Center−v×30,0,0)（原版 NewDust 位参仅作裁剪盒）
    expect(d229.box).toEqual({ x: 100, y: 170, w: 0, h: 0 });
    expect(d240.type).toBe(240);
    expect(d240.x).toBeCloseTo(100); expect(d240.y).toBeCloseTo(188);   // cy−12
    expect(d240.vx).toBeCloseTo(2); expect(d240.vy).toBeCloseTo(0);     // RotatedBy(−π/2)×2
    expect(d240.scale).toBeCloseTo(0.5); expect(d240.fadeIn).toBe(0.5);
    expect(d240.noGravity).toBe(true);
  });

  it('rand≥0.5 → Next(2)!=0 两族全静默（1/2 掷门判别力）', () => {
    const pool = stubPool();
    expect(emitVortexStealthFadeDust(pool, 0, 0, () => 0.99)).toBe(0);
    expect(pool.spawns).toHaveLength(0);
  });

  it('RotatedByRandom 三角化：角=(rng−rng)×2π（序列复现 v/位/速/档全链）', () => {
    const pool = stubPool();
    // 掷序：门 0（发）→ 角 (0.5−0.25)×2π=π/2 → v=(−1,0) → 位 0（r511=5）→ scale 0.5
    // → 门 1（第二族拒）
    let i = 0;
    const seq = [0, 0.5, 0.25, 0, 0.5, 1];
    const n = emitVortexStealthFadeDust(pool, 100, 200, () => seq[i++ % seq.length]);
    expect(n).toBe(1);
    const d = pool.spawns[0];
    expect(d.type).toBe(229);
    expect(d.x).toBeCloseTo(105);        // cx − v.x×5 = 100 −(−1)×5
    expect(d.y).toBeCloseTo(200);        // cy − v.y×5 = 200 − 0
    expect(d.vx).toBeCloseTo(0);         // −v.y×4
    expect(d.vy).toBeCloseTo(-4);        // v.x×4
    expect(d.scale).toBeCloseTo(1.0);    // 0.5+0.5
  });

  it(' Next(5,11) 单掷×整向量（种子复现：同 r511 作用于 x/y）', () => {
    const pool = stubPool();
    let r511 = -1;
    emitVortexStealthFadeDust(pool, 0, 0, () => { r511++; return [0, 0.5, 0.25, 0.9][r511] ?? 0; });
    const d = pool.spawns[0];
    // 掷序：门(0)→角(0.5,0.25)→位(0.9→5+5=10)→scale(0 复用——实现同掷序读)
    // v=(−sin(.5×2π−.25×2π),cos(...)) — 只验 x/y 同一标量：|dx|:|dy| = |v.x|:|v.y|
    const dx = Math.abs(d.x), dy = Math.abs(d.y);
    if (dx > 1e-9 || dy > 1e-9) {
      const th = (0.5 - 0.25) * 6.2831854820251465;
      const vx = -Math.sin(th), vy = Math.cos(th);
      expect(dx / 10).toBeCloseTo(Math.abs(vx), 5);
      expect(dy / 10).toBeCloseTo(Math.abs(vy), 5);
    }
  });
});

describe('BJ595 面 A1/A3：冲刺滑行拖尘（Player.cs:21440-21452/21501-21515）', () => {
  const P = { x: 10, y: 20, w: 20, h: 42, vx: 5, vy: 0 };

  it('dash1 贴地：2×d31、盒=(y+h−num19, trunc(num20/2))、vel×0.1、scale 1.4×(1+..)、无染料', () => {
    const pool = stubPool();
    const n = emitDashSlideDust(pool, P, 1, 7, seeded(1));
    expect(n).toBe(2);
    const num18 = 42 / 42;           // =1
    const num19 = 4 * num18;         // =4
    const num20 = Math.trunc(16 * num18);  // =16
    for (const d of pool.spawns) {
      expect(d.type).toBe(31);
      expect(d.alpha).toBe(100);
      expect(d.scale).toBeGreaterThanOrEqual(1.4);          // 1.4×(1+Next(20)×.01)
      expect(d.scale).toBeLessThan(1.4 * 1.2);
      expect(d.box.y).toBeCloseTo(P.y + P.h - num19);       // 贴地档
      expect(d.box.h).toBe(Math.trunc(num20 / 2));          // 8
      expect(Math.abs(d.vx)).toBeLessThanOrEqual(0.5);      // NewDust ±2 ×0.1 —— 池内初速抖动保留
    }
  });

  it('dash1 空中：盒 y+h/2−num19×2 / h=num20（判别力）', () => {
    const pool = stubPool();
    emitDashSlideDust(pool, { ...P, vy: 3 }, 1, -1, seeded(2));
    const num19 = 4;
    for (const d of pool.spawns) {
      expect(d.box.y).toBeCloseTo(P.y + P.h / 2 - num19 * 2);
      expect(d.box.h).toBe(Math.trunc(16));
    }
  });

  it('dash5：类型∈{68,69,70}、noGravity、fadeIn∈[.5,.69)、dyeVid 落染料、vel×0.2', () => {
    const pool = stubPool();
    const n = emitDashSlideDust(pool, P, 5, 42, seeded(3));
    expect(n).toBe(2);
    for (const d of pool.spawns) {
      expect([68, 69, 70]).toContain(d.type);
      expect(d.noGravity).toBe(true);
      expect(d.dyeVid).toBe(42);
      expect(d.fadeIn).toBeGreaterThanOrEqual(0.5);
      expect(d.fadeIn).toBeLessThan(0.7);
      expect(d.scale).toBeGreaterThanOrEqual(1);
      expect(d.scale).toBeLessThan(1.2);
    }
  });

  it('dash 2/4/0 → 零尘（死支 dash2 循环 m<0、dash4 无赋值面；dash3 已由 BJ594 落位移出本锁）', () => {
    // ★BJ594（2026-10-10）：dash3 日耀滑行 4×尘6 落位（:21461-21478）——
    // 原「dash 2/3/4/0 零尘」锁中 3 已移出,判别面归 tests/bj594 直测。
    // ★BJ707-A（2026-10-22）：dash6 Chillet 滑行 8×尘306 落位（:21527-21548）——
    // 6 移出零尘锁,判别面归 tests/bj707a-chillet-dust-cooldown.test.ts §2 直测。
    for (const dash of [0, 2, 4]) {
      const pool = stubPool();
      expect(emitDashSlideDust(pool, P, dash, -1, seeded(4)), `dash=${dash}`).toBe(0);
    }
  });
});

describe('BJ595 面 A2/A3：冲刺起爆尘爆（Player.cs:21583-21612/21700-21715）', () => {
  const P = { x: 10, y: 20, w: 20, h: 42, cx: 20, cy: 41 };

  it('dash1：20×d31(scale 2)+2×gore61-63（位=(x+w/2−24, y+h/2−34/−14)、|v|≤0.2）', () => {
    const pool = stubPool();
    const gores: Array<{ type: number; x: number; y: number; vx: number; vy: number }> = [];
    const goreSpawner = (type: number, x: number, y: number, vx: number, vy: number) => {
      const g = { type, x, y, vx, vy };
      gores.push(g);
      return g;
    };
    const n = emitDashLaunchBurst(pool, goreSpawner, P, 1, -1, seeded(5));
    expect(n).toBe(20);
    expect(pool.spawns.every((d) => d.type === 31)).toBe(true);
    for (const d of pool.spawns) {
      expect(d.box).toEqual({ x: 10, y: 20, w: 20, h: 42 });
      expect(d.scale).toBeGreaterThanOrEqual(2);         // 2×(1+Next(20)×.01)
      expect(d.scale).toBeLessThan(2.4);
      expect(Math.abs(d.vx)).toBeLessThanOrEqual(2.2);   // NewDust ±2 ×0.2
    }
    expect(gores).toHaveLength(2);
    expect(gores[0].type >= 61 && gores[0].type <= 63).toBe(true);
    expect(gores[0].x).toBeCloseTo(P.x + P.w / 2 - 24);
    expect(gores[0].y).toBeCloseTo(P.y + P.h / 2 - 34);
    expect(gores[1].y).toBeCloseTo(P.y + P.h / 2 - 14);
    for (const g of gores) {
      expect(Math.abs(g.vx)).toBeLessThanOrEqual(0.5);   // Next(−50,51)×.01×0.4
      expect(Math.abs(g.vy)).toBeLessThanOrEqual(0.5);
    }
  });

  it('dash5：20×d68/69/70、vel=DirectionTo(尘位)×2（|v|=2）、noGravity、染料', () => {
    const pool = stubPool();
    const n = emitDashLaunchBurst(pool, () => null, P, 5, 9, seeded(6));
    expect(n).toBe(20);
    for (const d of pool.spawns) {
      expect([68, 69, 70]).toContain(d.type);
      expect(d.noGravity).toBe(true);
      expect(d.dyeVid).toBe(9);
      const sp = Math.sqrt(d.vx * d.vx + d.vy * d.vy);
      expect(sp).toBeGreaterThan(1.5);   // 速度模=2（非退化掷）
      expect(sp).toBeLessThan(2.5);
    }
  });

  it('dash2/6 → 零尘零 gore（死支；dash3 起爆已由 BJ594 落位移出本锁,判别面归 tests/bj594）', () => {
    for (const dash of [0, 2, 6]) {
      const pool = stubPool();
      let goreCalls = 0;
      expect(emitDashLaunchBurst(pool, () => { goreCalls++; return null; }, P, dash, -1, seeded(7)), `dash=${dash}`).toBe(0);
      expect(goreCalls).toBe(0);
    }
  });
});

describe('BJ595 面 F1/X1/R：受击尘爆（Player.cs:38825-38852）', () => {
  it('粒数=floor(实扣/maxLife×100)——1% 界与零尘档', () => {
    expect(playerHurtDustCount(50, 100)).toBe(50);
    expect(playerHurtDustCount(1, 100)).toBe(1);
    expect(playerHurtDustCount(0.99, 100)).toBe(0);   // <1% 零尘=原版相
    expect(playerHurtDustCount(200, 100)).toBe(200);
  });

  it('选型：stoned→1 / frost→135 / bone→26 / 默认 5（:38830-38848 if 链序）', () => {
    expect(armorHurtDustType(true, true, true)).toBe(1);
    expect(armorHurtDustType(false, true, true)).toBe(135);
    expect(armorHurtDustType(false, false, true)).toBe(26);
    expect(armorHurtDustType(false, false, false)).toBe(5);
  });

  it('发射：n=粒数、vx=2×hitDir、vy=−2、frost/bone 落套染料、count=0 零发射', () => {
    const pool = stubPool();
    emitPlayerHurtDust(pool, { x: 1, y: 2, w: 20, h: 42 }, 5, 100, -1, false, true, false, 77, seeded(8));
    expect(pool.spawns).toHaveLength(5);
    for (const d of pool.spawns) {
      expect(d.type).toBe(135);
      expect(d.vx).toBe(-2);     // 2×(−1)
      expect(d.vy).toBe(-2);
      expect(d.dyeVid).toBe(77); // frost 支套染料
      expect(d.box).toEqual({ x: 1, y: 2, w: 20, h: 42 });
    }
    const pool2 = stubPool();
    emitPlayerHurtDust(pool2, { x: 0, y: 0, w: 20, h: 42 }, 0.5, 100, 1, false, false, false, -1);
    expect(pool2.spawns).toHaveLength(0);
  });
});

describe('BJ595 面 F3/X2：死亡尘爆（KillMe_DustExplosion Player.cs:39330-39360）', () => {
  it('恒 100 粒、选型同受击链、速度式同（2×hitDir,−2）', () => {
    const pool = stubPool();
    const n = emitPlayerDeathDustExplosion(pool, { x: 0, y: 0, w: 20, h: 42 }, 1, false, false, true, 5);
    expect(n).toBe(100);
    expect(pool.spawns).toHaveLength(100);
    for (const d of pool.spawns) {
      expect(d.type).toBe(26);
      expect(d.vx).toBe(2);
      expect(d.vy).toBe(-2);
      expect(d.dyeVid).toBe(5);
    }
    const pool2 = stubPool();
    emitPlayerDeathDustExplosion(pool2, { x: 0, y: 0, w: 20, h: 42 }, -1, true, false, false, -1);
    expect(pool2.spawns.every((d) => d.type === 1)).toBe(true);
    expect(pool2.spawns.every((d) => d.dyeVid === -1)).toBe(true);   // stoned/默认支无染料
  });
});

// ===================== 销案面锚锁（dead-vanilla / vanilla-none 证据面） =====================

describe('BJ595 销案面锚锁', () => {
  /** 提取单函数体（源文锁限域,防全文件 grep 误伤合法 eq.dash===2 速度支） */
  function fnBody(src: string, name: string): string {
    const start = src.indexOf(`export function ${name}`);
    expect(start >= 0, name).toBe(true);
    const end = src.indexOf('\nexport function', start + 1);
    return src.slice(start, end > start ? end : undefined);
  }

  it('dash2 克盾滑行/起爆尘 = 原版零迭代死支（尘函数体无 dash===2 支）', () => {
    // 1457 Player.cs:21446 `for (int m = 0; m < 0; m++)` / :21619 `for (int num42 = 0; num42 < 0; num42++)`
    for (const fn of ['emitDashSlideDust', 'emitDashLaunchBurst']) {
      expect(fnBody(PLY, fn).includes('dash === 2'), fn).toBe(false);
    }
  });

  it('dash4 尘 229 档不落（dashType=4 全树无赋值面——1457 grep 仅 0/1/2/3/5/6）', () => {
    for (const fn of ['emitDashSlideDust', 'emitDashLaunchBurst']) {
      expect(fnBody(PLY, fn).includes('dash === 4'), fn).toBe(false);
    }
  });

  it('日耀/星云环境拖尘 = 原版无面（setSolar/setNebula 消费面无尘支——仓内不得自造）', () => {
    // 本 census 前后都不得出现“日曜套行走火焰尾”式自造站
    expect(/setSolar[^\n]*dust/i.test(PLY)).toBe(false);
    expect(/setNebula[^\n]*dust/i.test(PLY)).toBe(false);
  });

  it('幽灵套残影 = 原版无面（Player.cs 残影域仅 First Fractal :1555）——防自造', () => {
    expect(/spectre[^\n]*afterimage/i.test(PLY)).toBe(false);
  });

  it('神圣套幻影闪避 = 原版无绘制面（ShadowDodge :38308-38316 无尘无残影）', () => {
    expect(/shadowDodge[^\n]*spawnDust/i.test(PLY)).toBe(false);
  });
});

// ===================== 登记大面锚锁（registered-debt：原版锚+仓内缺面双向锁） =====================

describe('BJ595 登记大面（整缺子系统——锚与缺面双向锁）', () => {
  it('B1/B2 甲虫 orb 子系统：BJ596 已落刀（物理+绘制接线在场——原「全缺」锁反转为「已接线」；判别锁移交 bj596-beetle-orbs）', () => {
    expect(PLY.includes('beetlePos')).toBe(true);         // 物理域（Player.cs:16556-16612 → stepBeetleOrb）
    expect(PLY.includes('beetleFrame')).toBe(true);       // 帧域（3 帧条 TextureAssets.Beetle）
    expect(RDR.includes('vanilla/BeetleOrb.png')).toBe(true);  // 绘制域（PlayerDrawLayers.cs:4130-4155）
    expect(PLY.includes('export function stepBeetleOrb')).toBe(true);
    expect(PLY.includes('export function beetleOrbDrawPlan')).toBe(true);
    expect(existsSync(new URL('../public/sprites/vanilla/BeetleOrb.png', import.meta.url))).toBe(true);
  });

  it('N2/D3/P4 armorGlow 发光面子系统：PlayerDrawSet.cs:459-785 全表缺（glow 资产在库）', () => {
    // 月辉四套（Vortex 15/13-18/199、Nebula 16/14-19+12/17、Solar 无贴图色罩 250、
    // Stardust 184/185-186+188/187）+ Loki 209-212 + Arkhalis 245-250 + 杂件 25 项
    expect(RDR.includes('headGlowMask')).toBe(false);
    expect(RDR.includes('bodyGlowMask')).toBe(false);
    expect(RDR.includes('Glow_184')).toBe(false);          // 星尘甲 glow 贴图零消费
    expect(existsSync(new URL('../public/sprites/vanilla/Glow_184.png', import.meta.url))).toBe(true);
    expect(existsSync(new URL('../public/sprites/vanilla/Glow_15.png', import.meta.url))).toBe(true);
    // 修复形：GlowMask 查找表（head/body/legs 甲槽 id → {maskId, color}）+ 三甲绘制位
    // 同变换叠画（GetImmuneAlphaPure 色已含 shadow/immunity）+ 杂件 pulse 族
    // （mouseTextColor²/230,230,230,60 档）+ head 171/177/112 色罩支（Solar 恒色 250）
  });

  it('P4 发光甲光照 UpdateArmorLights 已落刀（BJ598：十八站表+早退门+聚焦档——判别锁移交 bj598-armor-lights-hurtsfx）', () => {
    expect(readFileSync(new URL('../src/lighting/ArmorLights.ts', import.meta.url), 'utf8').includes('computeArmorLights')).toBe(true);
    expect(GAME.includes('computeArmorLights(')).toBe(true);   // tickLighting 发射站
  });

  it('M3 手持物潜行减色 ApplyStealthToColor 已落刀（BJ599：三站接线在场——判别锁移交 bj599-held-item-stealth-dim）', () => {
    expect(RDR.includes('ApplyStealthToColor')).toBe(true);
    expect(RDR.includes('heldItemStealthDim')).toBe(true);
    // 修复形兑现：drawUseItem/静持层挂 shroomite(RGB×s,B×(1+10s)/11)/vortex(RGB Lerp(0,.12,.16))
    // 色变换（entry-owned bake,勿走 ctx.filter——BJ348b-3 shim/acc 栅格化分叉判例）
    expect(/\.filter\s*=/.test(readFileSync(new URL('../src/render/heldItemStealthDim.ts', import.meta.url), 'utf8'))).toBe(false);
  });

  it('F2/X3 受击音甲支已落刀（BJ598：frost→Item27/bone→NPCHit2 入 hurtVoicePlan 甲支——判别锁移交 bj598-armor-lights-hurtsfx）', () => {
    expect(PLY.includes('emitPlayerDeathDustExplosion')).toBe(true);   // 尘面已落
    const PV = readFileSync(new URL('../src/player/PlayerVoice.ts', import.meta.url), 'utf8');
    expect(PV.includes("files: ['Item_27']")).toBe(true);
    expect(PV.includes("files: ['NPC_Hit_2']")).toBe(true);
    expect(GAME.includes('frostArmor: eq.frostBurn === true')).toBe(true);   // 与尘站同谓词
  });
});

// ===================== 落刀面调用点锁（防移除/漂移） =====================

describe('BJ595 落刀面调用点锁', () => {
  it('星璇衰减拍发射站：flag11 语义（减后 <0 钳 0 不掷,≥0 掷）', () => {
    expect(PLY.includes('let vortexFadeDust = false;')).toBe(true);
    expect(PLY.includes('emitVortexStealthFadeDust(game.vanillaDust, this.cx, this.cy);')).toBe(true);
  });

  it('冲刺滑行/起爆发射站挂在 dashDelay<0 块与 dashed 块（dashLatched 载体）', () => {
    expect(PLY.includes('emitDashSlideDust(game.vanillaDust, this, this.dashLatched, this.armorSetDyeVid());')).toBe(true);
    expect(PLY.includes('emitDashLaunchBurst(game.vanillaDust, GorePiece.newGore.bind(GorePiece),')).toBe(true);
  });

  it('受击/死亡尘爆发射站挂 Game.damagePlayer 存活支 + Player.initDeathParts', () => {
    expect(GAME.includes('emitPlayerHurtDust(this.vanillaDust, p, ok, p.maxHp,')).toBe(true);
    expect(PLY.includes('emitPlayerDeathDustExplosion(game.vanillaDust, this, hitDir,')).toBe(true);
    expect(PLY.includes('this.initDeathParts(game);')).toBe(true);
  });

  it('boneArmor 谓词 1:1（Player.cs:38461-38465 槽序判定）', () => {
    expect(PLY.includes('(h === 75 || h === 7) && b === 7 && l === 7')).toBe(true);
  });
});
