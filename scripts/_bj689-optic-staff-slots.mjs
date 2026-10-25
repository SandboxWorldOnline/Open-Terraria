// ★★★BJ710-A 改判通告（2026-10-24）：本探针的「原版预期」断言面（B 场景
//   「双子对先死/板面不推进」）已被用户明令分歧推翻——现行为=先异型后同型
//   （Game.ts evictOrder 分区）,满板连用魔眼【逐按换满 266→对子】。本脚本
//   断言未随迁（历史定谳物证存档）,勿再作判据跑;现行判据=
//   tests/bj710a-summon-slot-replace.test.ts + tests/bj689-optic-staff-slots.test.ts。
// ★BJ689 定谳探针：魔眼法杖 2535 槽位顶替面——用户实报「已招满其他召唤物时,
//   使用魔眼法杖只能顶替掉一个召唤物,无法继续召唤替换槽位」。
//   场景矩阵（全部走【真实物品使用链】:grant→mouseDown 边沿→fixedUpdate→settle）：
//     A 填板：史莱姆杖 1309 连用 3 次（maxMinions=3）→ 266×3 满板
//     B 魔眼连用 4 次：逐次采样在场弹型分布/弹 id（是否换对/是否推进）
//     C maxMinions=1 极限：1×266 满板 → 魔眼两次（一对是否恰好顶一格/自刷新）
//     D 空板连用 4 次（maxMinions=3）：无驱逐自由累积（对生成/逐对顶替基线）
//     E 解除其他随从 buff（BJ405 右键语义）→ 腾出槽位后魔眼连补两对
//   原版预期（Player.cs:52335-52458=1456 :50954-51060 + Projectile.cs:4709/4725 +
//   ItemID.cs:1112 全表=1）：池=按 minionSlots 升序稳定序逐杀至 used ≤ max−1 →
//   满板首用顶替一只 1.0 槽随从；后续使用【双子对先死】（0.5 排池首）→ 板面
//   组成不再推进 = 原版行为本身（本探针证 SW 与该行为 1:1）。
// 用法: SW_ORIGIN=http://localhost:5207 node tools/run-diag.mjs scripts/_bj689-optic-staff-slots.mjs
import { launchBrowser, openPage, bootstrap, createGame, pump, ledger, freezeClock } from '../tools/probe/lib/index.mjs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5207';
const L = ledger();

const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, ORIGIN + '/');
const gen = await createGame(page, { mode: 'direct', seed: '05162020', size: 'small' });
L.chk('世界就绪', gen.ok, JSON.stringify(gen).slice(0, 100));
await freezeClock(page, { tod: 0.345 });
await pump(page, 40);

const out = await page.evaluate(async () => {
  const g = window.__swGame;
  const p = g.player;
  const KEY = window.__swVANILLA_ITEM_KEY_BY_ID;
  const ITEMS = window.__swItems;
  const slimeStaff = ITEMS[KEY[1309]];
  const opticStaff = ITEMS[KEY[2535]];
  if (slimeStaff === undefined || opticStaff === undefined) {
    return { fatal: `staff not registered slime=${slimeStaff} optic=${opticStaff}` };
  }
  p.debugGod = true;
  const { buffTypeByVanilla } = await import('/src/stats/Buffs.ts');
  const bt64 = buffTypeByVanilla(64);    // 史莱姆宝宝伴生 buff
  const bt134 = buffTypeByVanilla(134);  // 双子伴生 buff

  // 场景平台：地表上方开阔处
  const st = g.world.store;
  const surf = [];
  for (let tx = 40; tx <= 110; tx++) {
    for (let ty = 8; ty < st.h; ty++) { if (st.hasTile(tx, ty)) { surf.push(ty); break; } }
  }
  surf.sort((a, b) => a - b);
  const topRow = surf[Math.floor(surf.length / 2)];
  p.x = 60 * 16; p.y = (topRow - 10) * 16; p.vx = 0; p.vy = 0;

  const setMax = (n) => {
    // 实例级影子属性覆写原型 getter（探针杠杆,不动装备域）
    Object.defineProperty(p, 'maxMinions', { value: n, configurable: true });
  };
  const grant = (iid) => {
    p.inv.selected = 0;
    p.inv.slots[0] = { id: iid, stack: 1 };
    g.cb.onInventoryChanged?.();
  };
  const useOnce = () => {
    p.useTime = 0;
    g.input.mouseX = Math.floor(g.renderer.canvas.width / 2);
    g.input.mouseY = Math.floor(g.renderer.canvas.height / 2) - 40;
    g.camera.x = p.cx; g.camera.y = p.cy;
    g.input.mouseDown = true;
    g.fixedUpdate(1 / 60);
    g.input.mouseDown = false;
  };
  const settle = (n = 80) => { for (let i = 0; i < n; i++) g.fixedUpdate(1 / 60); };
  const MINION_PIDS = new Set([266, 317, 373, 375, 387, 388, 390, 391, 392, 393, 394, 395,
    407, 423, 533, 613, 625, 626, 627, 628, 755, 758, 759, 831, 864, 946, 951, 963, 970, 1022]);
  const census = () => {
    const c = {};
    const ids = {};
    let used = 0;
    for (const e of g.entities.projectiles) {
      if (e.dead || e.sentry) continue;
      if (!MINION_PIDS.has(e.projId)) continue;   // 389 激光等攻击弹不计随从面
      c[e.projId] = (c[e.projId] ?? 0) + 1;
      (ids[e.projId] ??= []).push(e.id);
      used += (e.projId === 387 || e.projId === 388 || e.projId === 626 || e.projId === 627) ? 0.5 : 1;
    }
    return {
      counts: c, twinIds: { 387: ids[387] ?? [], 388: ids[388] ?? [] }, used,
      maxMinions: p.maxMinions,
      buff64: bt64 !== undefined && p.buffs.has(bt64),
      buff134: bt134 !== undefined && p.buffs.has(bt134),
    };
  };

  const R = { stages: [], bt64: String(bt64), bt134: String(bt134) };
  const snap = (name) => { const c = census(); R.stages.push({ name, ...c }); return c; };

  // ---------- A/B：maxMinions=3,史莱姆填满 3 格,魔眼连用 4 次 ----------
  setMax(3);
  settle(20);
  snap('A0_empty_max3');
  grant(slimeStaff);
  for (let i = 1; i <= 3; i++) { useOnce(); settle(); snap('A_slime_' + i); }
  grant(opticStaff);
  for (let i = 1; i <= 4; i++) { useOnce(); settle(); snap('B_optic_' + i); }

  // ---------- E：解除 64（右键取消随从语义,BJ405）→ 266 同拍消散 → 魔眼补两对 ----------
  p.buffs.remove(bt64);
  settle();
  snap('E0_dismiss266');
  for (let i = 1; i <= 2; i++) { useOnce(); settle(); snap('E_optic_' + i); }

  // ---------- C：maxMinions=1,1×266 满板 → 魔眼两次 ----------
  for (const e of g.entities.projectiles) { if (!e.sentry) e.dead = true; }
  settle();
  setMax(1);
  grant(slimeStaff);
  useOnce(); settle();
  snap('C0_full_max1');
  grant(opticStaff);
  useOnce(); settle();
  snap('C1_optic_max1');
  useOnce(); settle();
  snap('C2_optic_max1');

  // ---------- D：maxMinions=3,空板魔眼连用 4 次（自由累积基线） ----------
  for (const e of g.entities.projectiles) { if (!e.sentry) e.dead = true; }
  settle();
  setMax(3);
  snap('D0_empty_max3');
  for (let i = 1; i <= 4; i++) { useOnce(); settle(); snap('D_optic_' + i); }

  return R;
}, {});

if (out.fatal) {
  L.chk('物品注册', false, out.fatal);
} else {
  for (const s of out.stages) {
    console.log(`${s.name.padEnd(14)} counts=${JSON.stringify(s.counts)} used=${s.used}/${s.maxMinions} b64=${s.buff64 ? 1 : 0} b134=${s.buff134 ? 1 : 0} twins=${JSON.stringify(s.twinIds)}`);
  }
  const B = (n) => out.stages.find((s) => s.name === n);
  const A3 = B('A_slime_3'), B1 = B('B_optic_1'), B2 = B('B_optic_2'), B3 = B('B_optic_3'), B4 = B('B_optic_4');
  const E0 = B('E0_dismiss266'), E1 = B('E_optic_1'), E2 = B('E_optic_2');
  const C1 = B('C1_optic_max1'), C2 = B('C2_optic_max1');
  const D2 = B('D_optic_2'), D3 = B('D_optic_3'), D4 = B('D_optic_4');
  L.chk('A 填板 3×266 满板（真实链,used=3）', A3 && A3.counts[266] === 3 && A3.used === 3, JSON.stringify(A3?.counts));
  L.chk('B1 满板首用=双子对(387+388)在场且仅顶替 1 只 266,used 回满 3',
    B1 && B1.counts[387] === 1 && B1.counts[388] === 1 && B1.counts[266] === 2 && B1.used === 3,
    JSON.stringify({ c: B1?.counts, used: B1?.used }));
  const refreshed = B1 && B2 && (B2.twinIds[387][0] !== B1.twinIds[387][0] && B2.twinIds[388][0] !== B1.twinIds[388][0]);
  L.chk('B2 二用照常出手=旧对被顶替（双子 id 刷新）+ buff134 在场', !!refreshed && B2.buff134 === true,
    `B1=${JSON.stringify(B1?.twinIds)} B2=${JSON.stringify(B2?.twinIds)} b134=${B2?.buff134}`);
  L.chk('B2-B4 板面组成恒定 {266×2,对×1}（升序池=0.5 双子先死 → 不推进 = 原版相,SW 1:1）',
    [B2, B3, B4].every((s) => s && s.counts[266] === 2 && s.counts[387] === 1 && s.counts[388] === 1 && s.used === 3),
    JSON.stringify({ B2: B2?.counts, B3: B3?.counts, B4: B4?.counts }));
  L.chk('E0 右键 64 → 266 同拍消散,槽位腾出（used=1）',
    E0 && E0.counts[266] === undefined && E0.counts[387] === 1 && E0.used === 1,
    JSON.stringify({ c: E0?.counts, used: E0?.used, b64: E0?.buff64 }));
  L.chk('E1/E2 腾位后魔眼补对至满板 3 对（used=3,推进成立）',
    E1 && E1.counts[387] === 2 && E1.counts[388] === 2 && E2 && E2.counts[387] === 3 && E2.counts[388] === 3 && E2.used === 3,
    JSON.stringify({ E1: E1?.counts, E2: E2?.counts }));
  L.chk('C1 max1 满板一对恰好占满（266 清空,387+388 各 1,used=1）',
    C1 && C1.counts[266] === undefined && C1.counts[387] === 1 && C1.counts[388] === 1 && C1.used === 1,
    JSON.stringify({ c: C1?.counts, used: C1?.used }));
  const c2refreshed = C1 && C2 && (C2.twinIds[387][0] !== C1.twinIds[387][0]);
  L.chk('C2 二用自刷新（旧对死新对生,used 恒 1）', !!c2refreshed && C2.used === 1,
    `C1=${JSON.stringify(C1?.twinIds)} C2=${JSON.stringify(C2?.twinIds)}`);
  L.chk('D 空板累积:2 用=2 对(used2),3 用=3 对(used3),4 用=3 对(最旧对被顶替)',
    D2 && D2.counts[387] === 2 && D2.counts[388] === 2 && D2.used === 2
    && D3 && D3.counts[387] === 3 && D3.counts[388] === 3 && D3.used === 3
    && D4 && D4.counts[387] === 3 && D4.counts[388] === 3 && D4.used === 3,
    JSON.stringify({ D2: D2?.counts, D3: D3?.counts, D4: D4?.counts }));
}

await browser.close();
L.print();
process.exit(L.exitCode());
