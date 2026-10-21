/**
 * BJ705-A:真实场景压力复现——南瓜月怪群 + 暗黑收割者连抽 + 南瓜王头部可见度时间线。
 *  正午冻结钟(静态亮空) + 手工怪群(南瓜月波 15 阵容近似:双南瓜王+哀木+地狱犬+
 *  胡闹鬼+稻草人) + 主南瓜王钉位(相机钉位=同屏同背景) + 连续真挥(重新按下)。
 *  每周期:挥鞭 30t → 采样(head 区 orange/headPix + accDiag + 实体账)。
 *  判读:headPix/orange 骤降(≥50%)且 cloak 不降 = 头部透明复现。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, openPage, bootstrap, createGame, pump,
  godMode, clearEnemies, spawnEnemy, giveItems, saveCanvasShot, Ledger,
} from '../tools/probe/lib/index.mjs';

const L = new Ledger();
const OUT = process.env.SW_PROBE_OUT ?? '/tmp/probe-out/_bj705a';
mkdirSync(OUT, { recursive: true });

const INSTALL = `
window.__bj705a = { renders: 0 };
window.__bj705aInstall = async () => {
  const mod = await import('/src/render/Renderer.ts');
  const proto = mod.Renderer.prototype;
  if (!proto.__bj705ap) {
    proto.__bj705ap = true;
    const or_ = proto.render;
    proto.render = function (...a) { window.__bj705a.renders++; return or_.apply(this, a); };
  }
  return 'ok';
};
window.__awaitRenders = async (n, timeoutMs = 15000) => {
  const start = window.__bj705a.renders;
  const t0 = performance.now();
  while (window.__bj705a.renders < start + n) {
    await new Promise((r) => requestAnimationFrame(r));
    if (performance.now() - t0 > timeoutMs) return { ok: false };
  }
  return { ok: true };
};
'ok';
`;

/** 页内:钉主南瓜王+相机的分段泵 */
const PUMPPIN = async ({ ticks }) => {
  const st = window.__bj705aPin;
  const g = window.__swGame;
  for (let i = 0; i < ticks; i++) {
    if (st.e && !st.e.dead) {
      st.e.x = st.ex; st.e.y = st.ey; st.e.vx = 0; st.e.vy = 0;
      if (st.e.hp < 5000) st.e.hp = 5000;
    }
    g.camera.x = st.cx; g.camera.y = st.cy;
    g.fixedUpdate(1 / 60);
    if ((i & 15) === 15) await new Promise((r) => setTimeout(r, 0));
  }
  return { t: ticks };
};

/** 页内:采样(世界锚) */
const SAMPLE = async ({ wx, wy, r }) => {
  const g = window.__swGame;
  const cam = g.camera;
  const cv = g.renderer.canvas;
  const z = cam.zoom ?? 1;
  const [px, py] = cam.worldToScreen(wx, wy);
  const R = Math.ceil(r * z);
  const sx = Math.round(px) - R, sy = Math.round(py) - R, W = R * 2, H = R * 2;
  const c2 = document.createElement('canvas');
  c2.width = W; c2.height = H;
  const g2 = c2.getContext('2d', { willReadFrequently: true });
  g2.drawImage(cv, sx, sy, W, H, 0, 0, W, H);
  const d = g2.getImageData(0, 0, W, H).data;
  let orange = 0, lumaSum = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const R8 = d[i], G8 = d[i + 1], B8 = d[i + 2];
    lumaSum += 0.299 * R8 + 0.587 * G8 + 0.114 * B8; n++;
    if (R8 > 120 && G8 > 40 && G8 < 170 && B8 < 90) orange++;
  }
  return { W, H, orange, meanLuma: +(lumaSum / n).toFixed(1), raw: Array.from(d) };
};

function diffBg(S, BG) {
  if (!S || !BG || !S.raw || !BG.raw || S.raw.length !== BG.raw.length) return null;
  let head = 0;
  for (let i = 0; i < S.raw.length; i += 4) {
    const d = Math.abs(S.raw[i] - BG.raw[i]) + Math.abs(S.raw[i + 1] - BG.raw[i + 1])
      + Math.abs(S.raw[i + 2] - BG.raw[i + 2]);
    if (d > 36) head++;
  }
  return head;
}

/** 怪群阵容(波 15 近似,vid×count) */
const HORDE = [
  [327, 1],   // 主南瓜王(另钉位一只在下)
  [325, 2],   // 哀木
  [329, 4],   // 地狱犬
  [330, 3],   // 胡闹鬼
  [305, 4],   // 稻草人
  [326, 3],   // 树精
  [315, 1],   // 无头骑士
];

const browser = await launchBrowser({});
try {
  const page = await openPage(browser, { errors: L.fails });
  page.__probeOrigin = process.env.SW_ORIGIN;
  const boot = await bootstrap(page, process.env.SW_ORIGIN);
  L.chk('bootstrap', boot.ok, boot.why ?? '');
  const gen = await createGame(page, { mode: 'direct', seed: '05162020', size: 'small' });
  L.chk('createGame', gen.ok, gen.why ?? '');
  await godMode(page, true);
  await clearEnemies(page);
  await pump(page, 30);

  // 正午冻结(静态亮空)
  const clock = await page.evaluate(() => {
    const c = window.__swGame.world.clock;
    c.timeOfDay = 0.5;
    c.tick = () => {};
    return { isDay: c.isDay };
  });
  L.say(`noon frozen: ${JSON.stringify(clock)}`);
  const gi = await giveItems(page, [{ vid: 4680, slot: 0 }], { select: 0 });
  L.chk('give-darkharvest', gi.ok, JSON.stringify(gi).slice(0, 90));

  const anchor = await page.evaluate(() => {
    const g = window.__swGame;
    return { px: Math.round(g.player.cx), py: Math.round(g.player.cy) };
  });
  // 主南瓜王钉位:玩家右上近空(鞭程内)
  const EX = anchor.px + 150, EY = anchor.py - 120;
  const sp = await spawnEnemy(page, 327, EX, EY);
  L.chk('spawn-primary-pk', sp.ok, JSON.stringify(sp).slice(0, 80));
  await page.evaluate(INSTALL);
  await page.evaluate(async () => { await window.__bj705aInstall(); });
  await page.evaluate(({ ex, ey }) => {
    const g = window.__swGame;
    const e = (g.entities.enemies ?? []).find((en) => en.vanillaId === 327);
    window.__bj705aPin = { e, ex: ex - 50, ey: ey - 50, cx: ex, cy: ey };
  }, { ex: EX, ey: EY });

  // 怪群(绕主南瓜王散布)
  const spawns = await page.evaluate(async ({ cx, cy }) => {
    const g = window.__swGame;
    const flow = window.__swFlow;
    const HORDE = [[325, 2], [329, 4], [330, 3], [305, 4], [326, 3], [315, 1], [327, 1]];
    let ok = 0, fail = 0;
    let k = 0;
    for (const [vid, count] of HORDE) {
      for (let i = 0; i < count; i++) {
        const ang = (k * 2.399) % (Math.PI * 2);
        const dist = 220 + (k % 5) * 90;
        const x = cx + Math.cos(ang) * dist;
        const y = cy + Math.sin(ang) * dist * 0.6 - 60;
        const meta = await flow.spawnVanillaEnemy(vid, x, y);
        if (meta) ok++; else fail++;
        k++;
      }
    }
    return { ok, fail, total: (g.entities.enemies ?? []).length };
  }, { cx: EX, cy: EY });
  L.say(`horde: ${JSON.stringify(spawns)}`);
  await page.evaluate(PUMPPIN, { ticks: 60 });
  await page.evaluate(() => window.__awaitRenders(3));

  // ---- 基线 ----
  const A_head = await page.evaluate(SAMPLE, { wx: EX, wy: EY, r: 60 });
  const A_cloak = await page.evaluate(SAMPLE, { wx: EX, wy: EY + 80, r: 40 });
  const diag0 = await page.evaluate(() => window.__swGame.renderer.accDiag());
  await saveCanvasShot(page, `${OUT}/stress-a-baseline.png`).catch(() => {});
  L.say(`baseline: orange=${A_head.orange} luma=${A_head.meanLuma} cloakOrange=${A_cloak.orange}`);
  L.say(`accDiag0: used=${diag0.used} ledger=${JSON.stringify(diag0.accFailLedger)} shim=${JSON.stringify(diag0.shim)}`);

  // ---- 连挥循环:每周期 30t 按下 + 10t 松开,重瞄主南瓜王 ----
  const timeline = [];
  let eid = sp.id;
  for (let cyc = 0; cyc < 10; cyc++) {
    await page.evaluate(({ ex, ey }) => {
      const g = window.__swGame;
      const [sx, sy] = g.camera.worldToScreen(ex, ey);
      g.input.mouseX = Math.round(sx); g.input.mouseY = Math.round(sy);
      g.input.mouseDown = true;
    }, { ex: EX, ey: EY });
    await page.evaluate(PUMPPIN, { ticks: 30 });
    await page.evaluate(() => { window.__swGame.input.mouseDown = false; });
    await page.evaluate(PUMPPIN, { ticks: 10 });
    await page.evaluate(() => window.__awaitRenders(2));
    const head = await page.evaluate(SAMPLE, { wx: EX, wy: EY, r: 60 });
    const cloak = await page.evaluate(SAMPLE, { wx: EX, wy: EY + 80, r: 40 });
    const st = await page.evaluate((eidIn) => {
      const g = window.__swGame;
      const e = (g.entities.enemies ?? []).find((en) => en.id === eidIn);
      return { alive: !!e, hp: e?.hp, tagged: (() => { try { return g.player.tagEffectStack.isNPCTagged(4680, eidIn); } catch (err) { return 'err'; } })(),
        tid: g.player.minionTargetId, nEnemies: (g.entities.enemies ?? []).length,
        nProjs: (g.entities.projectiles ?? []).length,
        diag: g.renderer.accDiag() };
    }, eid);
    timeline.push({ cyc, orange: head.orange, luma: head.meanLuma, cloakOrange: cloak.orange,
      tagged: st.tagged, hp: st.hp, nEnemies: st.nEnemies, nProjs: st.nProjs,
      used: st.diag?.used, ledger: st.diag?.accFailLedger, replays: st.diag?.shim?.replays, fallback: st.diag?.shim?.fallback });
    L.say(`cyc${cyc}: orange=${head.orange} luma=${head.meanLuma} cloak=${cloak.orange} tagged=${st.tagged} hp=${st.hp} enemies=${st.nEnemies} projs=${st.nProjs} acc=${st.diag?.used} ledger=${JSON.stringify(st.diag?.accFailLedger)} replays=${st.diag?.shim?.replays}`);
    if (cyc === 4) await saveCanvasShot(page, `${OUT}/stress-mid.png`).catch(() => {});
  }
  await saveCanvasShot(page, `${OUT}/stress-end.png`).catch(() => {});

  // ---- 背景参考 ----
  await page.evaluate(() => {
    const g = window.__swGame;
    g.entities.enemies.length = 0;
    g.entities.projectiles.length = 0;
    g.player.minionTargetId = -1;
    g.input.mouseDown = false;
  });
  await page.evaluate(PUMPPIN, { ticks: 6 });
  await page.evaluate(() => window.__awaitRenders(3));
  const BG_head = await page.evaluate(SAMPLE, { wx: EX, wy: EY, r: 60 });
  const BG_cloak = await page.evaluate(SAMPLE, { wx: EX, wy: EY + 80, r: 40 });
  L.say(`bg: luma=${BG_head.meanLuma} orange=${BG_head.orange}`);

  // ---- 判读 ----
  const covA = diffBg(A_head, BG_head), covCloakA = diffBg(A_cloak, BG_cloak);
  const minOrange = Math.min(...timeline.map((t) => t.orange));
  const baseOrange = A_head.orange;
  L.chk('stress-repro-head-transparent', minOrange < baseOrange * 0.5,
    `orange base=${baseOrange} min=${minOrange} covA=${covA} cloakA=${covCloakA} (timeline=${timeline.map((t) => t.orange).join(',')})`);

  writeFileSync(`${OUT}/bj705a-stress-result.json`, JSON.stringify({
    diag0, timeline, baseOrange, minOrange, covA, covCloakA, bgLuma: BG_head.meanLuma,
  }, null, 2));
} finally {
  await browser.close().catch(() => {});
}
process.exit(L.exitCode());
