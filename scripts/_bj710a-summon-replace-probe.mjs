// ★BJ710-A 实机探针(修复后验证):用户实报「6 槽同杖召满后,异型杖连按只替换
// 1 个槽位,永久 5+1 锁死」——真输入路径(mouseDown 边沿→fixedUpdate→use gate→
// useCombatWeapon 'summon' 全链)复现+修复面验证。
// 场景:
//   ① 小鬼杖 2365 ×6 → 6×375(满板基线)
//   ② 换魔眼杖 2535 ×6 → 修复后应 0×375 + 6 对(修前 5+1 锁死=BJ689 原判原版相,
//      BJ710-A 用户明令分歧:先异型后同型)
//   ③ 换星尘龙杖 3531 ×6 → 修复后应 0×375 + 龙 6 槽(修前 5 imp+1 头锁死=病灶A
//      腾位排在龙延伸支后,已按原版 :43111→:48990 时序改为腾位先行)
//   ④ 换史莱姆杖 1309 ×6 → 0×375 + 6×266(普通杖回归面)
// 用法(game/ 下): SW_ORIGIN=http://localhost:5252 node tools/run-diag.mjs scripts/_bj710a-summon-replace-probe.mjs
import {
  launchBrowser, openPage, bootstrap, createGame, ledger,
} from '../tools/probe/lib/index.mjs';

const L = ledger();

const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, process.env.SW_ORIGIN);
const gen = await createGame(page, { mode: 'direct', seed: 'bj710a', size: 'small' });
L.chk('世界已建', gen.ok);

// ---- 布景:6 槽玩家 + 高蓝 ----
const setup = await page.evaluate(() => {
  const g = window.__swGame;
  g.paused = true;                       // 手动逐拍驱动
  window.__swGame.enemySpawnEnabled = false;
  const p = g.player;
  p.modMinionAddDyn = 5;                 // maxMinions = 1+5 = 6
  p.mana = 9999; p.maxMana = 9999;       // 排除蓝量伪影
  g.camera.x = p.cx; g.camera.y = p.cy;
  g.input.mouseX = 700; g.input.mouseY = 380;   // 光标在玩家侧(可达区内)
  return { ok: true, maxMinions: p.maxMinions };
});
L.chk('布景(6 槽/高蓝)', !!setup.ok, JSON.stringify(setup));

const snapshot = () => page.evaluate(() => {
  const g = window.__swGame;
  const ms = g.entities.projectiles.filter((e) => e.projId && !e.dead && !e.sentry && !e.noSlot);
  const w = (pid) => (pid === 387 || pid === 388 || pid === 626 || pid === 627 ? 0.5 : 1);
  return {
    imp: ms.filter((m) => m.projId === 375).length,
    slime: ms.filter((m) => m.projId === 266).length,
    twin: ms.filter((m) => m.projId === 387 || m.projId === 388).length,
    dragon: ms.filter((m) => m.projId >= 625 && m.projId <= 628).reduce((s, m) => s + w(m.projId), 0),
    slots: ms.reduce((s, m) => s + w(m.projId), 0),
    order: ms.map((m) => m.projId).join(','),
  };
});

// ---- 点击器:mouseDown 边沿 1 拍 + 冷却耗尽 + 稳定拍 ----
const press = () => page.evaluate(() => {
  const g = window.__swGame;
  g.input.mouseDown = true;
  g.fixedUpdate(1 / 60);
  g.input.mouseDown = false;
  let waited = 0;
  while (g.player.useTime > 0 && waited < 600) { g.fixedUpdate(1 / 60); waited++; }
  for (let i = 0; i < 30; i++) g.fixedUpdate(1 / 60);   // 稳定(自裁网/buff/compact+龙 AI 首拍基链)
  return waited;
});

const setHeld = (vid) => page.evaluate((v) => {
  const g = window.__swGame;
  const item = window.__swFlow.itemByVid(v);
  g.player.inv.slots[0] = { id: item, stack: 1 };
  g.player.inv.selected = 0;
  g.player.useTime = 0;
  return g.player.inv.heldItem()?.id;
}, vid);

const spam = async (vid, n, label) => {
  await setHeld(vid);
  const trace = [];
  for (let i = 0; i < n; i++) { await press(); trace.push(await snapshot()); }
  // eslint-disable-next-line no-console
  console.log(`[bj710a-probe] ${label}: ${trace.map((s) => `imp=${s.imp}/twin=${s.twin}/dragon=${s.dragon}/slime=${s.slime}/slots=${s.slots}`).join(' → ')}`);
  return trace[n - 1];
};

// ---- ① 满板基线:小鬼 ×6 ----
const a = await spam(2365, 6, 'A 小鬼×6');
L.chk('① 小鬼×6 满板', a.imp === 6 && a.slots === 6, JSON.stringify(a));

// ---- ② 魔眼杖 ×6(分歧主判据) ----
const b = await spam(2535, 6, 'B 魔眼×6');
L.chk('② 魔眼×6 → 0 imp + 6 对(修复面;修前 5+1 锁死)', b.imp === 0 && b.twin === 12 && b.slots === 6,
  JSON.stringify(b));

// ---- ③ 清场换史莱姆×6 → 再换星尘龙×6(病灶A 面需要干净 imp 板) ----
//   龙测试独立重铺:先清全部随从(右键 buff 语义=直接杀),再小鬼×6 → 龙×6
await page.evaluate(() => {
  const g = window.__swGame;
  for (const e of g.entities.projectiles) if (e.projId) e.dead = true;
  g.fixedUpdate(1 / 60);
});
const c0 = await spam(2365, 6, 'C 重铺小鬼×6');
L.chk('③a 重铺小鬼×6 满板', c0.imp === 6 && c0.slots === 6, JSON.stringify(c0));
const c = await spam(3531, 6, 'D 星尘龙×6');
L.chk('③b 龙×6 → 0 imp + 龙 6 槽(修复面;修前 5+1 锁死)', c.imp === 0 && c.dragon === 6 && c.slots === 6,
  JSON.stringify(c));

// ---- ④ 清场 → 小鬼×6 → 史莱姆×6(普通杖回归面) ----
await page.evaluate(() => {
  const g = window.__swGame;
  for (const e of g.entities.projectiles) if (e.projId) e.dead = true;
  g.fixedUpdate(1 / 60);
});
const d0 = await spam(2365, 6, 'E 重铺小鬼×6');
const d = await spam(1309, 6, 'F 史莱姆×6');
L.chk('④ 史莱姆×6 → 0 imp + 6 slime(回归面)', d.imp === 0 && d.slime === 6 && d.slots === 6,
  JSON.stringify(d));

await browser.close();
