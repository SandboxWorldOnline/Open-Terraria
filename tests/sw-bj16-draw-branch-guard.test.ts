// ★SW-BJ16 2026-09-07（用户令：召唤物盒精灵错位永久防护）
//  背景 = SW-BJ13 定谳的延伸：Main.DrawProjDirect 绘制分派链是【多支并存】结构——
//   · A 支 Main.cs:33161（中心锚·整图：锚=盒心+gfxOffY :33162、origin=整图/2 :33165）
//   · B 支 Main.cs:33693（中心锚·帧切片：锚=盒心+gfxOffY :33694-33695、
//       帧=Frame(1,projFrames,0,frame) :33701、origin=帧/2 :33787、主绘 :34212）
//   · C 支 Main.cs:34788（帕鲁地面专绘：锚=Center+(0,−num467) :34796、
//       origin=(整图宽/2,帧高/2+num151) :34797）——SW-BJ13 已清偿
//   · 通用路（:34919 多帧/:35470 单帧 = 帧左上锚盒左上 + num143/144 表 :29375-29826/
//       num151-153 switch :30077）
//  BJ13 只清了 C 支；本批清 B 支本仓域成员（17 型+同支同病 951）并立本守卫：
//  【未来新增召唤物若未查分派链就挂通用路（或漏接专支），①号测试即爆红并指向
//  提取器与审计文档】；③④把 B 支逐型锚/origin 钉死（含支内改锚特例——BJ13 警告
//  「折算式仅适用支内无改锚者」的物证：758/951/963/1098/1123/759 均有支内修正,
//  任务书预计算 758 (+58,+12)/1098 (+24,+6) 即漏特例,源码核对修正值 (+58,+20)/(+24,+8)）。
//  家族提取器 = tools/extract-draw-branch-families.mjs（解析 Main.cs 分派条件→vid 集）
//  审计正本   = docs/audit/summon-draw-branch-registry-2026-09-07.md
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MinionProj, minionTrueBox } from '../src/entities/MinionProj';
import { setProjSpriteOverride, projGridRect, projFrameCount } from '../src/entities/Arrow';
import { WHIP_HIT_SIDEKICK } from '../src/entities/WhipTag';
import { BookProj } from '../src/entities/BookProj';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import combatJson from '../src/data/vanilla-itemcombat.json';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MINION_TS = readFileSync(join(ROOT, 'src/entities/MinionProj.ts'), 'utf8');
const WEAPON_TS = readFileSync(join(ROOT, 'src/entities/WeaponProj.ts'), 'utf8');
const ARROW_TS = readFileSync(join(ROOT, 'src/entities/Arrow.ts'), 'utf8');

// =====================================================================
// ① 召唤物实体域（数据驱动）+ 分派链注册表（提取器冻结投影）
// =====================================================================
/** 域 = 召唤武器 shoot（vanilla-itemcombat.json summon=true）
 *       ∪ 鞭伴生召唤（WhipTag.WHIP_HIT_SIDEKICK 实键）
 *       ∪ 计数器/套装派生体（MinionProj.spawnBody/extendDragon/Game 套装：
 *         831→838 虎体、970→963 阿比盖尔体、625→626/627/628 龙链段、套装→623 守护者）
 *       ∪ Game 特殊命令直召（1098/1123 钻地龟 = spawnDigtoiseOnCursor,不走 summon 旗） */
const combat = combatJson as Record<string, { summon?: boolean; shoot?: number }>;
const DOMAIN_WEAPONS = new Set(
  Object.values(combat).filter((v) => v?.summon && Number.isInteger(v.shoot) && (v.shoot ?? 0) > 0)
    .map((v) => v.shoot as number),
);
const DOMAIN_SIDEKICK = new Set(Object.values(WHIP_HIT_SIDEKICK).map((v) => v.proj));
const DOMAIN_DERIVED = new Set([623, 626, 627, 628, 838, 963]);
const DOMAIN_SPECIAL_SPAWN = new Set([1098, 1123]);
const DOMAIN = new Set([...DOMAIN_WEAPONS, ...DOMAIN_SIDEKICK, ...DOMAIN_DERIVED, ...DOMAIN_SPECIAL_SPAWN]);

/** 分派支归类（提取器 2026-09-07 冻结输出;Main.cs 行号漂移时先重跑提取器核对）。
 *  impl = 本仓实现位：
 *   · 'set-33703'：MinionProj.draw 33703 专绘支（CENTER_ANCHOR_33703）
 *   · 'set-34788'：MinionProj.draw 34788 专绘支（CENTER_ANCHOR_34788,BJ13）
 *   · 'special'：MinionProj.draw 其他同支专绘（663-667 半帧/677-679 弩车/1094·1113 火绒狐）
 *   · 'generic'：通用路（正确——该型原版就在通用路）
 *   · 'debt'：原版在专支、本仓走通用路 = 已登记债（坐标见审计文档） */
const BRANCH_TABLE: Record<number, { branch: 'A_33161' | 'B_33693' | 'C_34788' | 'generic'; impl: string }> = {
  // ---- A 支 :33161（中心锚·整图）----
  641: { branch: 'A_33161', impl: 'special-A33161' },           // 月门（★SW-FX6 2026-09-10 债①清偿:专绘 :33162/:33444）
  // ---- B 支 :33693（中心锚·帧切片）----
  613: { branch: 'B_33693', impl: 'set-33703' },                // 星尘细胞
  623: { branch: 'B_33693', impl: 'set-33703' },                // 星尘守护者（★SW-FX6 债④清偿:ai0==2 抖动+A/2）
  625: { branch: 'B_33693', impl: 'set-33703' },                // 龙链条（ROT_ONLY）
  626: { branch: 'B_33693', impl: 'set-33703' },
  627: { branch: 'B_33693', impl: 'set-33703' },
  628: { branch: 'B_33693', impl: 'set-33703' },
  643: { branch: 'B_33693', impl: 'set-33703' },                // 彩虹水晶
  663: { branch: 'B_33693', impl: 'special' },                  // 烈焰塔（Bottom 锚+半帧,F5①）
  665: { branch: 'B_33693', impl: 'special' },
  667: { branch: 'B_33693', impl: 'special' },
  677: { branch: 'B_33693', impl: 'special' },                  // 弩车（T9 专绘）
  678: { branch: 'B_33693', impl: 'special' },
  679: { branch: 'B_33693', impl: 'special' },
  691: { branch: 'B_33693', impl: 'special' },                  // 陷阱塔（★SW-FX6 债②清偿:Bottom 锚 :34091）
  692: { branch: 'B_33693', impl: 'special' },
  693: { branch: 'B_33693', impl: 'special' },
  758: { branch: 'B_33693', impl: 'set-33703' },                // 吸血蛙（盒底锚特例）
  759: { branch: 'B_33693', impl: 'set-33703' },                // 雀杖（origin 帧高−2 ±1 特例）
  831: { branch: 'B_33693', impl: 'set-33703' },                // 虎宝石计数器（★SW-FX6 债⑥:hide=true 前置门,不绘）
  951: { branch: 'B_33693', impl: 'set-33703' },                // 雪怪（盒底−帧高/2+4 特例）
  963: { branch: 'B_33693', impl: 'set-33703' },                // 阿比盖尔体（4×13 网格第 0 列特例）
  970: { branch: 'B_33693', impl: 'set-33703' },                // 阿比盖尔计数器（★SW-FX6 债⑥:hide=true 前置门,不绘）
  1098: { branch: 'B_33693', impl: 'set-33703' },               // 钻地龟（锚 Y−2 特例;特殊命令直召）
  1123: { branch: 'B_33693', impl: 'set-33703' },               // 钻地龟二型（同上）
  1094: { branch: 'B_33693', impl: 'special' },                 // 火绒狐（DYN 偏移折算+Extra_303）
  1113: { branch: 'B_33693', impl: 'special' },
  1119: { branch: 'B_33693', impl: 'set-33703' },               // 禁戒魂灵
  // ---- B 支域外成员（非召唤物,同支同病已一并清偿）----
  // 773 甲虫炸弹 → WeaponProj.draw 专绘（③⑤）;1092 书弹 → BookProj（已合本支语义）
  // ---- C 支 :34788（BJ13 已清偿）----
  393: { branch: 'C_34788', impl: 'set-34788' },
  423: { branch: 'C_34788', impl: 'set-34788' },
  1022: { branch: 'C_34788', impl: 'set-34788' },
  1036: { branch: 'C_34788', impl: 'set-34788' },
  1093: { branch: 'C_34788', impl: 'set-34788' },
  1112: { branch: 'C_34788', impl: 'set-34788' },
  1118: { branch: 'C_34788', impl: 'set-34788' },
  // ---- 通用路（原版就在通用路,repo 通用路+num143/144 表=正确位）----
  191: { branch: 'generic', impl: 'generic' }, 266: { branch: 'generic', impl: 'generic' },
  308: { branch: 'generic', impl: 'generic' },                  // 半宽切片 :34950-34957=★SW-FX6 债③已接（MinionProj.draw 专块）
  317: { branch: 'generic', impl: 'generic' }, 373: { branch: 'generic', impl: 'generic' },
  375: { branch: 'generic', impl: 'generic' }, 377: { branch: 'generic', impl: 'generic' },
  387: { branch: 'generic', impl: 'generic' }, 390: { branch: 'generic', impl: 'generic' },
  407: { branch: 'generic', impl: 'generic' },
  // 533 致命球：★BJ704-G9 插队刀（用户实报自旋原点不对）——原版真身=:30609 glowmask
  // 族支（:31578 盒心+帧心,提取器四支口径归 generic）;本仓 impl 改 'special'
  // （MinionProj.draw 533 专支,旧落通用尾=锚错位）。946 同形（branch generic/impl special）。
  533: { branch: 'generic', impl: 'special' },
  688: { branch: 'generic', impl: 'generic' }, 689: { branch: 'generic', impl: 'generic' },
  690: { branch: 'generic', impl: 'generic' }, 755: { branch: 'generic', impl: 'generic' },
  838: { branch: 'generic', impl: 'generic' }, 864: { branch: 'generic', impl: 'generic' },
  917: { branch: 'generic', impl: 'generic' },
  // 946 泰拉棱镜：原版分派=DrawProjDirect 逐型专支（Main.cs:28677 DrawProj_EmpressBlade,
  // 非 33161/33693/34788 锚支族→branch 仍 generic）;★SW-BJ56 2026-09-10 本仓接专绘
  // （MinionProj.draw 946 支=全层 1:1+EmpressBladeDrawer 拖尾）
  946: { branch: 'generic', impl: 'special' },
  966: { branch: 'generic', impl: 'generic' }, 1025: { branch: 'generic', impl: 'generic' },
  // ---- ★清偿刀 J（2026-09-30）鞭 18 弹入域：itemcombat DefaultToWhip 形参位根修后
  //  combat 表 18 鞭原生 summon=true（vanilla 真值,DefaultToWhip 体 :47821）→
  //  DOMAIN_WEAPONS 46→64。提取器分类=generic 支（鞭链绘制在原版通用路内,
  //  extract-draw-branch-families.mjs 2026-09-30 复核输出）;本仓 impl='whip-proj'
  //  = WhipProj 专绘承载（entities/WhipProj.ts,Game whip 分支直召,不经 MinionProj）。
  841: { branch: 'generic', impl: 'whip-proj' }, 847: { branch: 'generic', impl: 'whip-proj' },
  848: { branch: 'generic', impl: 'whip-proj' }, 849: { branch: 'generic', impl: 'whip-proj' },
  912: { branch: 'generic', impl: 'whip-proj' }, 913: { branch: 'generic', impl: 'whip-proj' },
  914: { branch: 'generic', impl: 'whip-proj' }, 915: { branch: 'generic', impl: 'whip-proj' },
  952: { branch: 'generic', impl: 'whip-proj' },
  1028: { branch: 'generic', impl: 'whip-proj' }, 1029: { branch: 'generic', impl: 'whip-proj' },
  1030: { branch: 'generic', impl: 'whip-proj' }, 1031: { branch: 'generic', impl: 'whip-proj' },
  1032: { branch: 'generic', impl: 'whip-proj' }, 1033: { branch: 'generic', impl: 'whip-proj' },
  1034: { branch: 'generic', impl: 'whip-proj' }, 1035: { branch: 'generic', impl: 'whip-proj' },
  1104: { branch: 'generic', impl: 'whip-proj' },
};

/** MinionProj 域内、经 CENTER_ANCHOR_33703 实现的成员（= 集合应有字面） */
const SET_33703_EXPECTED = [613, 623, 625, 626, 627, 628, 643, 758, 759, 831, 951, 963, 970, 1098, 1119, 1123]
  .sort((a, b) => a - b);

describe('SW-BJ16 ①分派链注册表：召唤物域全员归类（新增召唤物未查表即爆红）', () => {
  it('域数据源健全（summon 武器 shoot/鞭伴生/派生体/特殊直召非空且与提取器口径一致）', () => {
    // ★清偿刀 J（2026-09-30）：46→64——combat 表鞭 18 件原生 summon=true（vanilla
    //  真值,DefaultToWhip 体 :47821;此前 combat 表鞭仅 {noUseGraphic} 一键被域漏收）
    expect(DOMAIN_WEAPONS.size).toBe(64);
    expect([...DOMAIN_SIDEKICK].sort((a, b) => a - b)).toEqual([917, 1036]);
    expect(DOMAIN.has(613) && DOMAIN.has(963) && DOMAIN.has(1098) && DOMAIN.has(1123)).toBe(true);
  });

  it('全员已归类（爆红=新召唤物未查 Main.cs 分派链——先跑提取器+读审计文档再归类）', () => {
    const missing = [...DOMAIN].filter((id) => !BRANCH_TABLE[id]);
    expect(missing, [
      `召唤物域 projId 未进绘制分支注册表：${missing.join(',')}`,
      '处置：node tools/extract-draw-branch-families.mjs → 查 Main.cs:33161/:33693/:34788/通用四支归属',
      '→ docs/audit/summon-draw-branch-registry-2026-09-07.md 补表 → 按 impl 位接正确绘制路径',
    ].join(' | ')).toEqual([]);
  });

  it('冻结表与提取器分类一致（防手滑改表；行号漂移时先重跑提取器）', () => {
    const byBranch = { A_33161: [] as number[], B_33693: [] as number[], C_34788: [] as number[], generic: [] as number[] };
    for (const [idStr, e] of Object.entries(BRANCH_TABLE)) byBranch[e.branch].push(Number(idStr));
    expect(byBranch.A_33161.sort((a, b) => a - b)).toEqual([641]);
    expect(byBranch.C_34788.sort((a, b) => a - b)).toEqual([393, 423, 1022, 1036, 1093, 1112, 1118]);
    expect(byBranch.B_33693.sort((a, b) => a - b)).toEqual(
      [613, 623, 625, 626, 627, 628, 643, 663, 665, 667, 677, 678, 679, 691, 692, 693, 758, 759, 831, 951, 963, 970, 1094, 1098, 1113, 1119, 1123]);
    expect(byBranch.generic.sort((a, b) => a - b)).toEqual(
      // ★清偿刀 J（2026-09-30）：+18 鞭弹（841-1104,提取器 generic 支分类复核）
      [191, 266, 308, 317, 373, 375, 377, 387, 390, 407, 533, 688, 689, 690, 755, 838, 841, 847, 848, 849, 864, 912, 913, 914, 915, 917, 946, 952, 966, 1025, 1028, 1029, 1030, 1031, 1032, 1033, 1034, 1035, 1104]);
  });

  it('实现位一致性：B 支 MinionProj 域成员必居 {set-33703, special, debt} 之一且不越界', () => {
    for (const [idStr, e] of Object.entries(BRANCH_TABLE)) {
      const id = Number(idStr);
      if (e.branch !== 'B_33693' || !DOMAIN.has(id)) continue;
      expect(['set-33703', 'special', 'debt'], `proj ${id} impl 位`).toContain(e.impl);
      if (e.impl === 'set-33703') expect(SET_33703_EXPECTED, `proj ${id}`).toContain(id);
      // ★SW-FX6 2026-09-10：691-693 陷阱塔 Bottom 锚专绘入列（债②清偿）
      if (e.impl === 'special') expect([663, 665, 667, 677, 678, 679, 691, 692, 693, 1094, 1113], `proj ${id}`).toContain(id);
      // ★SW-FX6 2026-09-10：①②清偿后 B 支零债——新增债必须先登记审计文档再动刀
      if (e.impl === 'debt') expect([], `proj ${id}（债须逐项登记文档）`).toContain(id);
    }
  });
});

// =====================================================================
// ② 结构锁：CENTER_ANCHOR_33703 集合字面 + 分支位序（防静默回退）
// =====================================================================
function parseSetLiteral(src: string, name: string): Set<number> {
  const m = src.match(new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]\\)`));
  expect(m, `${name} 集合字面存在`).toBeTruthy();
  return new Set(m![1].split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)));
}

describe('SW-BJ16 ②结构锁（33703 专绘支存在、成员精确、先于通用路）', () => {
  const set33703 = parseSetLiteral(MINION_TS, 'CENTER_ANCHOR_33703');
  const set34788 = parseSetLiteral(MINION_TS, 'CENTER_ANCHOR_34788');

  it('CENTER_ANCHOR_33703 成员精确（无多无漏——漏=挂通用路错锚,多=抢错支）', () => {
    expect([...set33703].sort((a, b) => a - b)).toEqual(SET_33703_EXPECTED);
  });

  it('两专绘支互斥且都先于通用偏移消费点（const off3 = img）', () => {
    for (const id of SET_33703_EXPECTED) expect(set34788.has(id), `proj ${id} 不得同时在两支`).toBe(false);
    const i34788 = MINION_TS.indexOf('if (CENTER_ANCHOR_34788.has(this.projId) && img) {');
    const i33703 = MINION_TS.indexOf('if (CENTER_ANCHOR_33703.has(this.projId) && img) {');
    const iGeneric = MINION_TS.indexOf('const off3 = img');
    expect(i34788).toBeGreaterThan(0);
    expect(i33703).toBeGreaterThan(i34788);
    expect(iGeneric).toBeGreaterThan(i33703);
  });

  it('支内改锚/改切片特例表达式在位（758 盒底/759 ±1 与帧高−2/951 盒底−帧高/2+4/963·1098·1123 −2）', () => {
    expect(MINION_TS).toContain('const ax = this.projId === 759 ? (this.facing < 0 ? -1 : 1) : 0;');
    expect(MINION_TS).toContain('if (this.projId === 758) ay += this.h / 2;');
    expect(MINION_TS).toContain('else if (this.projId === 951) ay += this.h / 2 - img.height / 2 + 4;');
    expect(MINION_TS).toContain('else if (this.projId === 963 || this.projId === 1098 || this.projId === 1123) ay += -2;');
    expect(MINION_TS).toContain('const oy = this.projId === 758 ? img.height - 4');
    expect(MINION_TS).toContain(': this.projId === 759 ? img.height - 2');
    expect(MINION_TS).toContain('ctx.drawImage(img, -img.width / 2, -oy);');
  });

  it('963 网格切片在支内手工完成（刻意不入 PROJ_GRID——该表列主序全格积会谎报帧数 52≠13）', () => {
    expect(MINION_TS).toContain('const fh = sheet.height / 13, fw = sheet.width / 4;');
    expect(ARROW_TS).not.toMatch(/^\s*963: \{ cols:/m);            // PROJ_GRID 无 963 行
    expect(projGridRect(963, 0)).toBeNull();                        // 行为面：非网格型
    expect(projFrameCount(963)).toBe(13);                           // Main.projFrames[963]=13（:8842）
  });
});

// =====================================================================
// ③④ 行为锁：记录型 ctx 直调 MinionProj.draw（BJ13 同款夹具）
// =====================================================================
function fakeTex(w: number, h: number): HTMLImageElement {
  return ({ width: w, height: h }) as unknown as HTMLImageElement;
}
class FakeCanvas {
  width = 0; height = 0;
  getContext() {
    return { drawImage() {}, imageSmoothingEnabled: false };
  }
}
(globalThis as { document?: unknown }).document = {
  createElement: (): FakeCanvas => new FakeCanvas(),
};
interface Rec { tex: unknown; args: number[] }
function recordingCtx() {
  const draws: Rec[] = [];
  const translates: number[][] = [];
  const rots: number[] = [];
  const scales: number[][] = [];
  const ctx = {
    save() {}, restore() {},
    translate(x: number, y: number) { translates.push([x, y]); },
    rotate(a: number) { rots.push(a); },
    scale(x: number, y: number) { scales.push([x, y]); },
    set imageSmoothingEnabled(_: boolean) {},
    set globalAlpha(_: number) {},
    set fillStyle(_: string) {}, set strokeStyle(_: string) {},
    fillRect() {}, strokeRect() {},
    drawImage(tex: unknown, ...rest: number[]) { draws.push({ tex, args: rest }); },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, draws, translates, rots, scales };
}

const W = 200, H = 120;
function makeHooks() {
  const store = { setTile: () => {}, isSolid: () => false, inBounds: () => true } as never;
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const hooks = {
    world: { store } as never, player: player as never,
    enemies: () => [], critters: () => [], spawnDrop: () => null, damagePlayer: (): number => 0,
    addDamageNumber: () => {}, cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
    spawnParticles: () => {}, notifyInventoryChanged: () => {}, playSfx: () => {},
    playSfxFiles: () => {}, showPickupLabel: () => {},
  } as never;
  return { hooks, player };
}
function mkOnGround(projId: number, player: Player, groundTopY = 100 * 16): MinionProj {
  const bx = minionTrueBox(projId);
  const m = new MinionProj(player.cx, groundTopY - bx.h, projId, 10, 2, false, 0, false, () => player);
  (m as { alphaFade: number }).alphaFade = 0;
  return m;
}

describe('SW-BJ16 ③B 支缺省型行为锁：锚=盒心、origin=帧心（translate=[cx,cy]、args=[−fw/2,−fh/2]）', () => {
  // 613 24×104/4 帧、625-628 32×66 单帧、643 26×400/8、1119 28×324/9
  // ★SW-FX6 2026-09-10：831/970 移出——vanilla hide=true（Projectile.cs:8082/:9197 →
  //  Main.cs:22404-22406 主循环 hide 门）=隐形计数器,draw 前置早退零绘制;
  //  行为锁移交 tests/sw-fx6-draw-debt-closure.test.ts（债⑥）
  const SHEET: Record<number, [number, number, number]> = {
    613: [24, 104, 4], 625: [32, 66, 1], 626: [32, 66, 1], 627: [32, 66, 1], 628: [32, 66, 1],
    643: [26, 400, 8], 1119: [28, 324, 9],
  };
  for (const [idStr, [tw, th, fr]] of Object.entries(SHEET)) {
    const id = Number(idStr);
    it(`proj ${id}：translate=[cx,cy]、drawImage=[−${tw / 2},−${th / fr / 2}]（帧 ${tw}×${th / fr}）`, () => {
      setProjSpriteOverride(id, fakeTex(tw, th));
      const { player } = makeHooks();
      const m = mkOnGround(id, player);
      const rec = recordingCtx();
      m.draw({ ctx: rec.ctx } as never);
      expect(rec.translates, `proj ${id} anchor=盒心`).toEqual([[m.cx, m.cy]]);
      expect(rec.draws, `proj ${id} 单次主绘`).toHaveLength(1);
      expect(rec.draws[0].args, `proj ${id} origin=帧心`).toEqual([-tw / 2, -(th / fr / 2)]);
    });
  }
});

describe('SW-BJ16 ④B 支改锚特例行为锁（支内逐型照录,防「无特例折算」回潮）', () => {
  it('758 吸血蛙：锚=盒底（translate=[cx,cy+15]）、origin=(fw/2,fh−4) ⇒ 精灵底=盒底+4', () => {
    setProjSpriteOverride(758, fakeTex(136, 1296));                  // 24 帧×54
    const { player } = makeHooks();
    const m = mkOnGround(758, player);                               // 真盒 20×30
    const fh = 1296 / 24;
    const rec = recordingCtx();
    m.draw({ ctx: rec.ctx } as never);
    expect(rec.translates).toEqual([[m.cx, m.cy + 15]]);             // :33965 += 盒高/2
    expect(rec.draws[0].args).toEqual([-68, -(fh - 4)]);             // :33966-33967
    expect(m.cy + 15 - (fh - 4) + fh - (m.y + 30)).toBe(4);          // 精灵底−盒底=+4
  });

  it('759 雀杖：origin.Y=帧高−2、朝向 1px 横移（右脸 +1/左脸 −1,折进锚 ax）', () => {
    setProjSpriteOverride(759, fakeTex(30, 120));                    // 5 帧×24
    const { player } = makeHooks();
    const m = mkOnGround(759, player);                               // 真盒 10×10
    const fh = 120 / 5;
    const recR = recordingCtx();
    m.draw({ ctx: recR.ctx } as never);
    expect(recR.translates).toEqual([[m.cx + 1, m.cy]]);             // :33960-33962 翻转?+1:−1
    expect(recR.draws[0].args).toEqual([-15, -(fh - 2)]);
    m.facing = -1;
    const recL = recordingCtx();
    m.draw({ ctx: recL.ctx } as never);
    expect(recL.translates).toEqual([[m.cx - 1, m.cy]]);
    expect(recL.draws[0].args).toEqual([-15, -(fh - 2)]);
  });

  it('951 雪怪：锚 Y=盒心+盒高/2−帧高/2+4、origin=帧心 ⇒ 精灵底=盒底+4', () => {
    setProjSpriteOverride(951, fakeTex(42, 504));                    // 12 帧×42
    const { player } = makeHooks();
    const m = mkOnGround(951, player);                               // 真盒 26×26
    const fh = 504 / 12;
    const rec = recordingCtx();
    m.draw({ ctx: rec.ctx } as never);
    expect(rec.translates).toEqual([[m.cx, m.cy + 13 - fh / 2 + 4]]); // :33943-33945
    expect(rec.draws[0].args).toEqual([-21, -fh / 2]);
    expect(m.cy + 13 - fh / 2 + 4 - fh / 2 + fh - (m.y + 26)).toBe(4);
  });

  it('1098/1123 钻地龟：锚 Y−2（:33771-33773）、origin=帧心（帧 82×46）', () => {
    for (const id of [1098, 1123]) {
      setProjSpriteOverride(id, fakeTex(82, 506));                   // 11 帧×46
      const { player } = makeHooks();
      const m = mkOnGround(id, player);                              // 真盒 34×34
      const rec = recordingCtx();
      m.draw({ ctx: rec.ctx } as never);
      expect(rec.translates, `proj ${id}`).toEqual([[m.cx, m.cy - 2]]);
      expect(rec.draws[0].args, `proj ${id}`).toEqual([-41, -23]);
      // 源码核对修正：旧错锚 ours−vanilla = (+24,+8)（预计算 +6 漏了本 −2 特例）
      expect((m.cx - 41) - m.x).toBe(-24);
      expect((m.cy - 2 - 23) - m.y).toBe(-8);
    }
  });

  it('963 阿比盖尔：4×13 网格第 0 列切片（帧 44×64）+ 锚 Y=−2+cos(mouseTextColor/255·4π)·4（★SW-BN6 2026-09-08 债⑤接线,Main.cs:33836-33844）', () => {
    setProjSpriteOverride(963, fakeTex(176, 832));
    const { player } = makeHooks();
    const m = mkOnGround(963, player);                               // 真盒 30×48
    (m as { a963Frame: number }).a963Frame = 5;
    // mt=255（摆顶 cos(4π)=1）→ 锚 Y=−2+4=+2;灯未就绪回退 255 同值（摆顶静止形）
    const rec = recordingCtx();
    m.draw({ ctx: rec.ctx } as never);
    expect(rec.translates).toEqual([[m.cx, m.cy + 2]]);
    expect(rec.draws).toHaveLength(1);
    // 9 参切片 drawImage(sheet, 0, 5×64, 44, 64, −22, −32, 44, 64)
    expect(rec.draws[0].args).toEqual([0, 5 * 64, 44, 64, -22, -32, 44, 64]);
    // mt=190（摆底）→ cos((190/255)·4π)=−0.9981033287370441 → 锚 Y≈−5.9924
    const recLow = recordingCtx();
    m.draw({ ctx: recLow.ctx, lighting: { clock: { mouseTextColor: 190 } } } as never);
    expect(recLow.translates[0][0]).toBe(m.cx);
    expect(recLow.translates[0][1]).toBeCloseTo(m.cy - 5.992413314948177, 9);
    // mt=222（波节附近）→ cos=−0.05541147491596934 → 锚 Y≈−2.2216（mt 被逐帧消费的活证）
    const recMid = recordingCtx();
    m.draw({ ctx: recMid.ctx, lighting: { clock: { mouseTextColor: 222 } } } as never);
    expect(recMid.translates[0][1]).toBeCloseTo(m.cy - 2.2216458996638773, 9);
    // 摆只进 963:1098/1123 仍纯 −2（:33771-33773 无 cos 项）
    setProjSpriteOverride(1098, fakeTex(82, 506));
    const m2 = mkOnGround(1098, player);
    const recB = recordingCtx();
    m2.draw({ ctx: recB.ctx, lighting: { clock: { mouseTextColor: 255 } } } as never);
    expect(recB.translates).toEqual([[m2.cx, m2.cy - 2]]);
  });
});

// =====================================================================
// ⑤ 域外 B 支成员：773（WeaponProj）结构锁 + 1092（BookProj）行为锁
// =====================================================================
describe('SW-BJ16 ⑤域外成员（773 甲虫炸弹/1092 书弹同支同病清偿）', () => {
  it('773：WeaponProj.draw 中心锚专绘（origin.Y=帧高−12 :33951-33953,无通用路 shave）', () => {
    expect(WEAPON_TS).toContain('if (this.projId === 773) {');
    expect(WEAPON_TS).toContain('ctx.translate(this.cx, this.cy);');
    expect(WEAPON_TS).toContain('ctx.drawImage(sheet as CanvasImageSource, 0, Math.round(drawFrame * fh),');
    expect(WEAPON_TS).toContain('sheet.width, fh, -sheet.width / 2, -(fh - 12), sheet.width, fh);');
    // 773 专绘支先于通用 drawProj 帧通道（支序锁）
    const iSpecial = WEAPON_TS.indexOf('if (this.projId === 773) {');
    const iGeneric = WEAPON_TS.indexOf('drawProj(r, cam, this, this.projId, this.rot, \'#408040\', firedA, -1, false, false, 1,');
    expect(iSpecial).toBeGreaterThan(0);
    expect(iGeneric).toBeGreaterThan(iSpecial);
  });

  it('1092：BookProj 已合 B 支语义（PROJ_GRID 6×9 列主序切片 + 盒心帧心锚）', () => {
    setProjSpriteOverride(1092, fakeTex(240, 360));
    const b = new BookProj(1000, 2000, 13, null);
    const rec = recordingCtx();
    b.draw({ ctx: rec.ctx } as never, null as never);
    expect(rec.translates).toEqual([[b.cx, b.cy]]);                  // 锚=盒心（:33694-33695）
    expect(rec.draws[0].args).toEqual([-20, -20, 40, 40]);           // origin=帧心（40×40 帧矩形）
  });
});

// =====================================================================
// ⑥ 真盒锁：B 支家族 SetDefaults w/h（构造器与 minionTrueBox 单源同步）
// =====================================================================
describe('SW-BJ16 ⑥B 支家族真盒（SetDefaults 真值——盒错即盒心锚错）', () => {
  const TRUE_BOX: Record<number, [number, number, string]> = {
    613: [24, 24, ':6600-6611'], 623: [50, 80, ':6713-6714'],
    625: [24, 24, ':6743-6744'], 626: [24, 24, ':6743-6744'],
    627: [24, 24, ':6743-6744'], 628: [24, 24, ':6743-6744'],
    643: [32, 32, ':6932-6933'], 758: [20, 30, ':7817-7818'],
    759: [10, 10, ':7839-7840'], 831: [10, 10, ':8073-8074'],
    951: [26, 26, ':8972-8973'], 963: [30, 48, ':9106-9107'],
    970: [10, 10, ':9188-9189'], 1098: [34, 34, ':10245-10246'],
    1119: [14, 22, ':10467-10468'], 1123: [34, 34, ':10507-10508'],
  };
  it('minionTrueBox 单源（导出读口）', () => {
    for (const [idStr, [w, h]] of Object.entries(TRUE_BOX)) {
      expect(minionTrueBox(Number(idStr)), `proj ${idStr}`).toEqual({ w, h });
    }
  });
  it('构造器同源（实例化真盒）', () => {
    const { player } = makeHooks();
    for (const [idStr, [w, h]] of Object.entries(TRUE_BOX)) {
      const m = new MinionProj(player.cx, player.cy, Number(idStr), 10, 2, false, 0, false, () => player);
      expect([m.w, m.h], `proj ${idStr}`).toEqual([w, h]);
    }
  });
});
