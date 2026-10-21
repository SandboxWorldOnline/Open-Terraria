// ★BJ685b（2026-10-15）用户明令分歧锁——**这不是原版平价锁,是分歧锁**。
// 判例锚=smart-cursor-dark-visibility-user-divergence（用户分歧协议）。
//
// 定谳史（防未来红蓝把分歧当 bug 翻案）：
// - BJ685 初判（2026-10-15）：用户实报「先开箱再开制作菜单→无堆叠到附近宝箱钮」。
//   探针（scripts/_bj685-stack-btn-probe.mjs 六相实跑）+ 反编译双基准（1457/1458）定谳
//   = 原版 1:1 平价、非缺陷：开制作菜单不关箱（NewCraftingUI.cs:887 Open 门：包开+箱开
//   跳过 CloseAll→chest 保持 !=-1）;箱条被 ChestUI.cs:81 三门让位隐藏;堆叠钮按
//   Main.cs:42548（1458:42554）chest==-1 && npcShop==0 门合法不画。用户感知「箱已关」
//   是箱条让位的错觉。
// - BJ685b（2026-10-15 用户明令）：用户激活产品决策分支——「希望制作菜单开着时也显示
//   堆叠钮」作为便利性分歧落地。分歧面=制作菜单开着（modern 窗可见 vinvModernCraftOpen
//   ∨ classic 网格 vinvPipsUseGrid）恒显堆叠钮（即使 openChest 仍在）;制作菜单关+箱开
//   = 维持原版平价（藏,箱内三钮 LootAll/DepositAll/QuickStack 承接）;无箱=显。
//   行为面已核：quickStackAllChests=600px 盒扫全部世界箱（QuickStacking.ts
//   chestsInRangeOf,含逻辑开着的箱,原版 NearbyChests 同语义）→ 该态点钮无异常。
// - Sort 钮（sortXY）不在用户明令分歧面,保原版裸门。
// - ★BJ704-G7（2026-10-21,R5 登记债⑥清偿）：classic 簇门补原版 :42548 npcShop==0
//   商店半边（(openChest∨npcShopOpen)∧¬craft 才藏）——这是**原版平价补齐**非新分歧;
//   vinv 面 pos 闭包经 layoutVanilla ctx.chestOpen（openChest∨npcShopOpen）本就双半边。
//
// 变异证红面：摘 craftMenuOpen 形参/摘 pos 闭包第二参/摘 classic 簇门析取/回植旧裸门
// 形状 → 本锁即红。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { quickStackXY, sortXY } from '../src/ui/vanillaInvLayout';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const uiSrc = readFileSync(join(ROOT, 'src/ui/UI.ts'), 'utf8');
const laySrc = readFileSync(join(ROOT, 'src/ui/vanillaInvLayout.ts'), 'utf8');

// ============================================================
// ① 分歧语义矩阵（纯函数四相;craftMenuOpen=false 缺省=原版平价）
// ============================================================
describe('BJ685b 分歧语义矩阵 quickStackXY(chestOpen, craftMenuOpen)', () => {
  it('箱开+制作菜单开 → 显（分歧核心:even chestOpen）', () => {
    expect(quickStackXY(true, true)).toEqual({ x: 498, y: 244 });
  });
  it('箱开+制作菜单关 → 藏（原版平价保持:chest==-1 门 Main.cs:42548）', () => {
    expect(quickStackXY(true, false)).toBeNull();
  });
  it('无箱+制作菜单开 → 显;无箱+制作菜单关 → 显（原版同相）', () => {
    expect(quickStackXY(false, true)).toEqual({ x: 498, y: 244 });
    expect(quickStackXY(false, false)).toEqual({ x: 498, y: 244 });
  });
  it('单参缺省=原版平价（既有调用方 sw-fx28/vanilla-inv-layout 不变绿转红）', () => {
    expect(quickStackXY(true)).toBeNull();
    expect(quickStackXY(false)).toEqual({ x: 498, y: 244 });
  });
  it('Sort 钮不在分歧面:仍纯 chestOpen 裸门（Main.cs:42586）', () => {
    expect(sortXY(true)).toBeNull();
    expect(sortXY(false)).toEqual({ x: 534, y: 244 });
    expect(laySrc).toMatch(/export function sortXY\(chestOrShopOpen: boolean\): \{ x: number; y: number \} \| null \{\s*\n\s*return chestOrShopOpen \? null : \{ x: 534, y: 244 \};/);
  });
});

// ============================================================
// ② 接线锚（vanilla 布局钮 pos 闭包 + classic 簇 refreshAllNow 门,两门同语义）
// ============================================================
describe('BJ685b 接线锚（两布局单一分歧规则）', () => {
  it('vinv 钮 pos 闭包:quickStackXY(chestOpen, modernOpen ∨ PipsUseGrid)', () => {
    expect(uiSrc).toMatch(/pos\(b, \(\) => quickStackXY\(\!\!this\.vinvLayoutCtx\?\.chestOpen, this\.vinvModernCraftOpen \|\| this\.vinvPipsUseGrid\)\)/);
  });
  it('classic 簇门:(openChest ∨ npcShopOpen) ∧ ¬(modernOpen ∨ PipsUseGrid) 才藏（★BJ704-G7 2026-10-21 商店半边补齐:原版 :42548 npcShop==0 项此前代码未落,仅注释宣称;锁随刀更新,改判史=BJ685b 初锁只及 chest 半边）', () => {
    expect(uiSrc).toMatch(/b\.style\.display = \(this\.openChest \|\| this\.game\.npcShopOpen\) && !\(this\.vinvModernCraftOpen \|\| this\.vinvPipsUseGrid\) \? 'none' : '';/);
  });
  it('重评触发前提:三态位均在 layoutVanilla 签名内（任一翻转必重排=pos 闭包重评）', () => {
    expect(uiSrc).toMatch(/\$\{chestOpen \? 1 : 0\}/);
    expect(uiSrc).toMatch(/\$\{this\.vinvPipsUseGrid \? 1 : 0\}/);
    expect(uiSrc).toMatch(/\$\{this\.vinvModernCraftOpen \? 1 : 0\}/);
  });
});

// ============================================================
// ③ 回植哨兵（旧原版裸门形状回植即红=分歧被静默回滚检测）
// ============================================================
describe('BJ685b 回植哨兵', () => {
  it('vinv 钮不得回植单参裸门（旧平价形状）', () => {
    expect(uiSrc).not.toMatch(/quickStackXY\(\!\!this\.vinvLayoutCtx\?\.chestOpen\)/);
  });
  it('classic 簇门不得回植纯 openChest 三元', () => {
    expect(uiSrc).not.toMatch(/b\.style\.display = this\.openChest \? 'none' : '';/);
  });
});
