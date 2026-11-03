// P3-D 回城药双锚+远端门 rig 实弹验收（BJ755-A T3,g36a D-⑫/bj738a D3 尾款）。
// 面族:①msg13 c3[6]+尾段 f32×4 双锚（A 本地=B 代理=服务器中继三账）②远端门渲染
// （opacity 0.1,坐/站分组——renderer 原型打点观测,禁改 Renderer.ts）③返程清空拍
// （清位不发送尾段）④sitting 位 c3[2] ⑤T2 msg66 治疗三账+无回退 ⑥T1 msg50 buff
// 双向镜像+清空（顺带实弹,任务书条款）。
// 用法:SW_ORIGIN=http://localhost:5204 node tools/run-diag.mjs scripts/_vanilla-p3-por.mjs
// 依赖:rig(7781)+桥(5290)+vite(5204) 在跑。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { TILE_BY_KEY } from '../src/data/tiles.ts';   // run-diag=node 直载:显式 .ts 扩展（_bj214 先例）

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ORIGIN = process.env.SW_ORIGIN ?? 'http://localhost:5204';
const LOG = fs.openSync('/tmp/vanilla-p3-por.log', 'w');
const log = (t) => { fs.writeSync(LOG, t + '\n'); console.log(t); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHAIR_TILE = TILE_BY_KEY['chair'];   // 本地舞台件（sheet 15,不上报服务器）

/** 单浏览器:面板流建角+加入（duo 同形制;urlQuery 透传 ?vdump=） */
async function joinAs(tag, name, urlQuery = '') {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    userDataDir: `/tmp/vanilla-por-${tag}-${Date.now() % 100000}`,
    args: ['--no-proxy-server'], defaultViewport: { width: 1280, height: 800 },
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => log(`[${tag}] PAGE-EXC ${String(e).slice(0, 200)}`));
  page.on('console', (m) => { const t = m.text(); if (/\[chat\]|vanilla-flow/.test(t)) log(`[${tag}] C ${t.slice(0, 120)}`); });
  await page.goto(`${ORIGIN}/${urlQuery}`, { waitUntil: 'domcontentloaded' });
  let clicked = false;
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    const ready = await page.evaluate(() => {
      const el = document.querySelector('[data-act=mp]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      if (!hit || !(el === hit || el.contains(hit))) return null;
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (ready) { await page.mouse.click(ready.x, ready.y); clicked = true; break; }
  }
  let panelOk = false;
  for (let i = 0; i < 12; i++) {
    panelOk = await page.evaluate(() => !!Array.from(document.querySelectorAll('input')).find((x) => x.value === '127.0.0.1:7781'));
    if (panelOk) break;
    await sleep(800);
  }
  const vb = await page.evaluate(() => {
    const input = Array.from(document.querySelectorAll('input')).find((x) => x.value === '127.0.0.1:7781');
    const btn = input?.closest('div')?.querySelector('button');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!vb) throw new Error(`[${tag}] 连接按钮未找到`);
  await page.mouse.click(vb.x, vb.y);
  for (let i = 0; i < 10; i++) {
    if (await page.evaluate(() => !!document.querySelector('[data-act=new]'))) break;
    await sleep(800);
  }
  const nb = await page.evaluate(() => {
    const el = document.querySelector('[data-act=new]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (nb) { await page.mouse.click(nb.x, nb.y); await sleep(2500); }
  await page.evaluate((nm) => {
    const inp = document.querySelector('.sw-cc-nameval input[type=text], .sw-char-panel input[type=text]');
    if (inp) { inp.value = nm; inp.dispatchEvent(new Event('input', { bubbles: true })); }
  }, name);
  await sleep(500);
  for (let i = 0; i < 15; i++) {
    if (await page.evaluate(() => !!document.querySelector('[data-act=create]'))) break;
    await sleep(800);
  }
  const cb = await page.evaluate(() => {
    const el = document.querySelector('[data-act=create]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (cb) await page.mouse.click(cb.x, cb.y);
  for (let i = 0; i < 50; i++) {
    await sleep(1000);
    const ok = await page.evaluate(() => {
      const g = globalThis.__swGame;
      return !!(g && g.net?.active && g.world?.store && g.player);
    }).catch(() => false);
    if (ok) break;
  }
  const entered = await page.evaluate(() => !!(globalThis.__swGame?.net?.active && globalThis.__swGame?.player));
  log(`[${tag}] 进世界=${entered} 名字=${name}`);
  if (!entered) throw new Error(`[${tag}] 未进世界`);
  await sleep(6000);
  // 掀欢迎浮层（迟渲染重试 20s——漏掀=游戏暂停 → msg13/tick 断流,round2 por 翻红嫌疑面）
  for (let i = 0; i < 10; i++) {
    const wb = await page.evaluate(() => {
      const el = document.getElementById('sw-welcome-announce');
      const btn = el?.querySelector('button');
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (wb) { await page.mouse.click(wb.x, wb.y); await sleep(1500); break; }
    await sleep(2000);
  }
  return { browser, page, tag, name };
}

// ---- A 先进,B 带 vdump 进（服务器下行帧账=第三账证据通道） ----
const A = await joinAs('a', '门锚甲');
await sleep(8000);
const B = await joinAs('b', '门锚乙', '?vdump=porB');
await sleep(10000);

const mySlotOf = async (j) => j.page.evaluate(() => globalThis.__swGame.net.mySlot);
const aSlot = await mySlotOf(A);
const bSlot = await mySlotOf(B);
log(`slots: A=${aSlot} B=${bSlot}`);
/** A 侧生命体征（死亡/暂停假说排查仪表:round2 por 窗 msg13 断流定谳用） */
const aVitals = (tag) => A.page.evaluate((t) => {
  const g = globalThis.__swGame;
  const p = g.player;
  return { tag: t, dead: !!p.dead, hp: p.hp, x: Math.round(p.x), y: Math.round(p.y), hidden: document.hidden };
}, tag).then((v) => { log(`A vitals: ${JSON.stringify(v)}`); return v; });

/** B 侧对 A 的代理态（porAnchors/sitting/buffTypes/hp） */
const bMirrorOfA = () => B.page.evaluate((slot) => {
  const rp = globalThis.__swGame.net.players.get(slot);
  if (!rp) return null;
  return {
    porAnchors: rp.porAnchors,
    sitting: rp.sitting,
    buffTypes: (rp.buffTypes ?? []).filter((v) => v > 0),
    hp: rp.hp,
  };
}, aSlot);
/** A 侧对 B 的代理态 */
const aMirrorOfB = () => A.page.evaluate((slot) => {
  const rp = globalThis.__swGame.net.players.get(slot);
  if (!rp) return null;
  return { buffTypes: (rp.buffTypes ?? []).filter((v) => v > 0), hp: rp.hp };
}, bSlot);

// ================= ① POR 双锚（msg13 c3[6]+尾段） =================
const preA = await A.page.evaluate(() => {
  const p = globalThis.__swGame.player;
  return { x: p.x, y: p.y, w: p.w, h: p.h };
});
await aVitals('pre-por');
await A.page.evaluate(() => {
  // fireRecallTeleport 通道直调（4870 同款结算:传送+双锚;consume=false 免持物消耗）
  globalThis.__swGame['fireRecallTeleport']({ vid: 4870, kind: 'spawn', triggerAt: 20, consume: false });
});
await sleep(2500);
await aVitals('post-teleport');
const aLocal = await A.page.evaluate(() => {
  const p = globalThis.__swGame.player;
  return {
    exit: p.potionOfReturnOriginalUsePosition, home: p.potionOfReturnHomePosition,
    x: p.x, y: p.y,
  };
});
log(`A 本地双锚: exit=${JSON.stringify(aLocal.exit)} home=${JSON.stringify(aLocal.home)}`);

// ② B 侧远端门渲染观测（renderer 原型打点——不改渲染源文件;opacity<1=远端 0.1 面）
await B.page.evaluate(() => {
  const g = globalThis.__swGame;
  const proto = Object.getPrototypeOf(g.renderer);
  const orig = proto.drawPotionOfReturnGates;
  window.__gateCalls = [];
  proto.drawPotionOfReturnGates = function (player, cam, vw, vh, z, opacity) {
    if (opacity !== undefined && opacity < 1) {
      window.__gateCalls.push({
        name: player?.appearance?.name ?? '?',
        hasAnchors: !!(player?.potionOfReturnOriginalUsePosition && player?.potionOfReturnHomePosition),
        sitting: !!player?.sitting,
      });
    }
    return orig.call(this, player, cam, vw, vh, z, opacity);
  };
});
await sleep(2500);   // 观测窗（含 msg13 中继到达+渲染拍）
await aVitals('post-observe');
const bMir1 = await bMirrorOfA();
const gateCalls = await B.page.evaluate(() => (window.__gateCalls ?? []).slice(-40));
log(`B 代理锚: ${JSON.stringify(bMir1?.porAnchors)}`);
log(`B 远端门调用(近40): ${JSON.stringify(gateCalls.slice(-6))}`);

const near = (a, b, eps = 0.01) => a != null && b != null && Math.abs(a - b) < eps;
const porMatch = !!bMir1?.porAnchors && !!aLocal.exit && !!aLocal.home
  && near(bMir1.porAnchors.exit.x, aLocal.exit.x) && near(bMir1.porAnchors.exit.y, aLocal.exit.y)
  && near(bMir1.porAnchors.home.x, aLocal.home.x) && near(bMir1.porAnchors.home.y, aLocal.home.y)
  // 三账判据③:A 本地锚原点=传送前站位（服务器中继值与之相符=服务端解析+重序列化成立）
  && near(aLocal.exit.x, preA.x + preA.w / 2, 0.6) && near(aLocal.exit.y, preA.y + preA.h, 0.6);
const porRender = gateCalls.some((c) => c.hasAnchors);

// ③ 返程清空拍（清位不发尾段 → B 同拍 null）
await A.page.evaluate(() => { globalThis.__swGame['potionOfReturnReturnToOriginalUsePosition'](); });
await sleep(2500);
const aLocalAfter = await A.page.evaluate(() => ({
  exit: globalThis.__swGame.player.potionOfReturnOriginalUsePosition,
  home: globalThis.__swGame.player.potionOfReturnHomePosition,
}));
const bMir2 = await bMirrorOfA();
const porClear = aLocalAfter.exit === null && aLocalAfter.home === null && bMir2?.porAnchors === null;
log(`返程后: A本地=${JSON.stringify(aLocalAfter)} B代理锚=${JSON.stringify(bMir2?.porAnchors)}`);

// ================= ④ sitting 位（c3[2]） =================
const sitOk = await A.page.evaluate((chairTile) => {
  const g = globalThis.__swGame;
  const p = g.player;
  const st = g.world.store;
  const tx = Math.floor((p.x + p.w / 2) / 16);
  const feetY = Math.floor((p.y + p.h - 1) / 16);   // 站位上方的空气格（腿位）
  const why = [];
  for (const ty of [feetY, feetY - 1, feetY + 1]) {
    if (!st.inBounds(tx, ty)) { why.push(`(${tx},${ty}) 越界`); continue; }
    const i = st.idx(tx, ty);
    st.type[i] = chairTile;   // 本地舞台椅（不上报——sitting 位传输面专用）
    st.flags[i] |= 1;
    st.frameX[i] = 0; st.frameY[i] = 0;
    const before = p.sitting;
    g['sitDownAt'](tx, ty);
    why.push(`(${tx},${ty}) sit:${before}→${p.sitting}`);
    if (p.sitting) return { ok: true, tx, ty, why };
  }
  return { ok: false, why };
}, CHAIR_TILE);
log(`A 坐椅: ${JSON.stringify(sitOk)}`);
await sleep(2500);
const bMir3 = await bMirrorOfA();
const sittingBit = sitOk.ok && bMir3?.sitting === true;
log(`B 代理 sitting=${bMir3?.sitting}`);

// ================= ⑤ T2 msg66 治疗三账（幽灵面具弹幕→B） =================
// ★判据形制定谳（首轮实弹教训）：自然回血令 hp 成为移动目标（B 本地/服务器/A 代理
//   三份各自回血漂移）——精确算术断言不可行;首轮 A 进场摔伤比 B 更缺血 → ghostHeal
//   走了 self-heal 臂（B 无 +9 跳变）。改：①A 先补满（目标确定性=最缺血恒 B）;
//   ②250ms 采样序列上的【跳变检测】（+30 远超回血斜率 ~0.5hp/s,免疫噪声）;
//   ③无回退=跳变后序列不回落。三账=B 本地跳变 / A 代理跳变 / 服务器中继帧（dump）。
await A.page.evaluate(() => { globalThis.__swGame.player.hostile = true; });
await B.page.evaluate(() => { globalThis.__swGame.player.hostile = true; });
await sleep(3000);
const bHp0 = await B.page.evaluate(() => globalThis.__swGame.player.hp);
await A.page.evaluate((slot) => {
  globalThis.__swGame.net.sendStrikePlayer(slot, 30, 3, 0, 3389, 0);   // vid 3389=铜短剑
}, bSlot);
await sleep(3000);
const bHp1 = await B.page.evaluate(() => ({ hp: globalThis.__swGame.player.hp, max: globalThis.__swGame.player.maxHp }));
log(`B hp 伤害段: ${bHp0} → ${bHp1.hp}（服务器权威结算）`);
// 治疗段（关 hostile——ghostHeal 候选门 (!hostile∨同队)）
await A.page.evaluate(() => { globalThis.__swGame.player.hostile = false; });
await B.page.evaluate(() => { globalThis.__swGame.player.hostile = false; });
await sleep(3000);
// A 穿幽灵治疗三件（1503/1504/1505 → 槽键 101|66|55 → setBonus.ghostHeal）+ 补满
// （A 缺血=0 → ghostHeal 最缺血候选恒 B——self-heal 臂出局,目标确定性）
const armorOk = await A.page.evaluate(() => {
  const g = globalThis.__swGame;
  const idOf = (vid) => g['itemByVidForNet'](vid);
  const h = idOf(1503), b = idOf(1504), l = idOf(1505);
  if (!h || !b || !l) return { ok: false, reason: `vid 解析失败 ${h}/${b}/${l}` };
  g.player.inv.armor[0] = { id: h, stack: 1 };
  g.player.inv.armor[1] = { id: b, stack: 1 };
  g.player.inv.armor[2] = { id: l, stack: 1 };
  g.player.hp = g.player.maxHp;   // ★补满:最缺血候选确定性归 B
  return { ok: !!(g.player.equipStats.setBonus?.ghostHeal) };
});
log(`A 幽灵套: ${JSON.stringify(armorOk)}`);
const HEAL = Math.floor(667 * (0.2 - 1 * 0.05));   // applyLifeSteal('ghost',667,1): 0.15×667=100 → 满钳
// ★三账判据定谳（round3 实弹+反编译复核）：vanilla msg117/66 服务器中继均排除
//   发送者（TrySendData(…,-1,whoAmI)）且 case66 不追加 msg16 → 攻端（A）代理 hp 对
//   自发事件最终一致（-14 环境 NPC 伤双端可见、-30 自伤仅 B 端——均 vanilla 同构）。
//   故三账=A 侧 sendHeal66 出帧（拦截断言）/服务器中继帧（dump）/B 端收款跳变;
//   满钳（heal=100≥任意基线差）令 B 端判定免疫回血漂移;无回退判定带 iframes
//   伤害豁免（环境 NPC 伤≠msg16 陈旧覆盖）。
let healSentFromA = false, healLandedOnB = false, healNoRevert = false, healThreeWay = false;
const bSeries = [];
if (armorOk.ok && bHp1.hp < bHp0) {
  await A.page.evaluate(() => {
    const g = globalThis.__swGame;
    window.__healSends = [];
    const orig = g.net.sendHeal66.bind(g.net);
    g.net.sendHeal66 = (slot, amount) => { window.__healSends.push({ slot, amount }); return orig(slot, amount); };
    const p = g.player;
    g['applyLifeSteal']('ghost', 667, 1, p.cx, p.cy, true);
  });
  // 250ms 采样 10s（飞行+中继+收款+校准窗合一;满钳判定+无回退检测同序列）
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const s = await B.page.evaluate(() => ({ hp: globalThis.__swGame.player.hp, ifr: globalThis.__swGame.player.iframes ?? 0 }));
    bSeries.push(s);
  }
  const sends = await A.page.evaluate(() => (window.__healSends ?? []));
  log(`A sendHeal66 出帧: ${JSON.stringify(sends)}`);
  log(`B 本地序列: ${bSeries.map((s) => Math.round(s.hp) + (s.ifr > 0 ? '*' : '')).join(',')}`);
  healSentFromA = sends.length === 1 && sends[0].slot === bSlot && sends[0].amount === HEAL;
  healLandedOnB = bSeries[bSeries.length - 1].hp >= bHp1.max - 1 || Math.max(...bSeries.map((s) => s.hp)) >= bHp1.max - 1;
  // 无回退:任何下降必须伴随 iframes（=新伤害事件;msg16 陈旧覆盖无 iframes）
  healNoRevert = bSeries.every((s, i) => i === 0 || s.hp >= bSeries[i - 1].hp - 1 || s.ifr > 0);
  healThreeWay = healSentFromA && healLandedOnB;
} else {
  log(`!治疗段跳过: armorOk=${JSON.stringify(armorOk)} 伤害生效=${bHp1.hp < bHp0}`);
}
// 服务器中继证据（B 下行帧账:msg66 到达=服务器受理+应用后中继）
let msg66Relay = false;
try {
  const dump = fs.readFileSync('/tmp/vbridge-porB.log', 'utf8');
  const n66 = (dump.match(/^\d+ 66 \d+$/gm) ?? []).length;
  msg66Relay = n66 > 0;
  log(`B 下行帧账: msg66 ×${n66}`);
} catch { log('B 下行帧账缺失（vdump 未生效?）'); }

// ================= ⑥ T1 msg50 buff 双向镜像 =================
await A.page.evaluate(() => { globalThis.__swGame.player.buffs.apply(1, 300); });   // Ironskin→vanilla 5
await sleep(3000);
const bMir4 = await bMirrorOfA();
const buffAtoB = (bMir4?.buffTypes ?? []).includes(5);
log(`B 镜像 A buff: ${JSON.stringify(bMir4?.buffTypes)}（含 Ironskin5=${buffAtoB}）`);
await B.page.evaluate(() => { globalThis.__swGame.player.buffs.apply(12, 300); });  // Gills→vanilla 4
await sleep(3000);
const aMir1 = await aMirrorOfB();
const buffBtoA = (aMir1?.buffTypes ?? []).includes(4);
log(`A 镜像 B buff: ${JSON.stringify(aMir1?.buffTypes)}（含 Gills4=${buffBtoA}）`);
await A.page.evaluate(() => { globalThis.__swGame.player.buffs.active.delete(1); });  // 清空拍
await sleep(3000);
const bMir5 = await bMirrorOfA();
const buffClear = !(bMir5?.buffTypes ?? []).includes(5);   // Ironskin 消失（环境光环 buff 免误伤）
log(`清空后 B 镜像 A buff: ${JSON.stringify(bMir5?.buffTypes)}`);

// ================= 截图+判定 =================
await A.page.screenshot({ path: '/tmp/vanilla-p3-por-a.png' });
await B.page.screenshot({ path: '/tmp/vanilla-p3-por-b.png' });

const verdict = {
  porMatch, porRender, porClear, sittingBit,
  healThreeWay: !!healThreeWay, healSentFromA: !!healSentFromA,
  healLandedOnB: !!healLandedOnB, healNoRevert: !!healNoRevert, msg66Relay,
  buffAtoB, buffBtoA, buffClear,
};
log('判定: ' + JSON.stringify(verdict));
const core = porMatch && porRender && porClear && sittingBit;   // P3-D por 面四判据
const piggy = healThreeWay && healNoRevert && msg66Relay && buffAtoB && buffBtoA && buffClear;
log(core ? '★POR-PASS（双锚三账+远端门+清空+sitting 位）' : '✗POR-部分红（见判定）');
log(piggy ? '★T1/T2 实弹 PASS（msg66 三账无回退+msg50 双向镜像+清空）' : '✗T1/T2 实弹部分红（见判定）');

await A.browser.close();
await B.browser.close();
process.exit(core && piggy ? 0 : (core ? 3 : 4));   // 3=por 过但 piggy 红;4=por 红
