/**
 * BJ705-A:0.1.63 dist 构建(2026-10-11)对拍——南瓜王+暗黑收割者最小复现场景。
 *  与 _bj705a-pumpking-whip.mjs 同场景;差异:
 *   - 无 /src 模块安装(发布构建无源码)→ awaitRenders 换固定 sleep(让 rAF 真渲);
 *   - 采样指标同(orange/meanLuma/raw)。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, openPage, bootstrap, createGame, pump,
  godMode, clearEnemies, spawnEnemy, giveItems, saveCanvasShot, Ledger,
} from '../tools/probe/lib/index.mjs';

const L = new Ledger();
const OUT = process.env.SW_PROBE_OUT ?? '/tmp/probe-out/_bj705a-dist';
mkdirSync(OUT, { recursive: true });

/** 页内:钉位泵 */
const PUMPPIN = async ({ ticks, dead = false }) => {
  const st = window.__bj705aPin;
  const g = window.__swGame;
  for (let i = 0; i < ticks; i++) {
    g.fixedUpdate(1 / 60);
    const e = st.e && !st.e.dead ? st.e : null;
    if (e && !dead) {
      e.x = st.ex; e.y = st.ey; e.vx = 0; e.vy = 0;
      if (e.hp < 1000) e.hp = 1000;
    }
    g.camera.x = st.cx; g.camera.y = st.cy;
    if ((i & 15) === 15) await new Promise((r) => setTimeout(r, 0));
  }
  return { t: ticks };
};

/** 页内:采样 */
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchBrowser({});
try {
  const page = await openPage(browser, { errors: L.fails });
  page.__probeOrigin = process.env.SW_ORIGIN;
  const boot = await bootstrap(page, process.env.SW_ORIGIN);
  L.chk('bootstrap', boot.ok, boot.why ?? '');
  const ver = await page.evaluate(() => window.__swGame?.version ?? window.__swVersion ?? 'unknown').catch(() => 'unknown');
  L.say(`build version probe: ${JSON.stringify(ver)}`);
  const gen = await createGame(page, { mode: 'direct', seed: '05162020', size: 'small' });
  L.chk('createGame', gen.ok, gen.why ?? '');
  await godMode(page, true);
  await clearEnemies(page);
  await pump(page, 30);

  const clock = await page.evaluate(() => {
    const c = window.__swGame.world.clock;
    c.timeOfDay = 0.5;
    c.tick = () => {};
    return { isDay: c.isDay };
  });
  L.say(`noon frozen: ${JSON.stringify(clock)}`);
  const gi = await giveItems(page, [{ vid: 4680, slot: 0 }], { select: 0 })
    .catch((err) => ({ ok: false, why: String(err) }));
  L.chk('give-darkharvest', gi.ok, JSON.stringify(gi).slice(0, 120));

  const anchor = await page.evaluate(() => {
    const g = window.__swGame;
    return { px: Math.round(g.player.cx), py: Math.round(g.player.cy) };
  });
  const EX = anchor.px + 150, EY = anchor.py - 120;
  const sp = await spawnEnemy(page, 327, EX, EY);
  L.chk('spawn-pumpking', sp.ok, JSON.stringify(sp).slice(0, 90));
  await page.evaluate(({ ex, ey }) => {
    const g = window.__swGame;
    const e = (g.entities.enemies ?? []).find((en) => en.vanillaId === 327);
    window.__bj705aPin = { e, ex: ex - 50, ey: ey - 50, cx: ex, cy: ey };
  }, { ex: EX, ey: EY });
  await page.evaluate(PUMPPIN, { ticks: 40 });
  await sleep(900);

  const state0 = await page.evaluate(() => {
    const g = window.__swGame;
    const e = (g.entities.enemies ?? []).find((en) => en.vanillaId === 327);
    return { id: e?.id, hp: e?.hp, frame: e?.customFrameIdx, ai3: e?.ai3,
      spawnAlpha: e?.spawnAlpha, tid: g.player.minionTargetId,
      held: g.player.inv.heldItem()?.vid ?? g.player.inv.heldItem()?.id,
      acc: (() => { try { return g.renderer.accDiag?.().used; } catch (err) { return 'n/a'; } })() };
  });
  L.say(`state0: ${JSON.stringify(state0)}`);

  const A_head = await page.evaluate(SAMPLE, { wx: EX, wy: EY, r: 60 });
  const A_cloak = await page.evaluate(SAMPLE, { wx: EX, wy: EY + 80, r: 40 });
  await saveCanvasShot(page, `${OUT}/a-baseline.png`).catch(() => {});
  L.say(`baseline head: orange=${A_head.orange} luma=${A_head.meanLuma} (${A_head.W}x${A_head.H})`);
  L.say(`baseline cloak: orange=${A_cloak.orange} luma=${A_cloak.meanLuma}`);

  // ---- 真实挥鞭 ----
  const swing = await page.evaluate(({ ex, ey }) => {
    const g = window.__swGame;
    const e = (g.entities.enemies ?? []).find((en) => en.vanillaId === 327);
    if (!e) return { ok: false, why: 'no-pk' };
    const [sx, sy] = g.camera.worldToScreen(ex, ey);
    g.input.mouseX = Math.round(sx); g.input.mouseY = Math.round(sy);
    g.player.minionTargetId = -1;
    g.input.mouseDown = true;
    return { ok: true, mx: g.input.mouseX, my: g.input.mouseY, eid: e.id };
  }, { ex: EX, ey: EY });
  L.say(`swing: ${JSON.stringify(swing)}`);
  await page.evaluate(PUMPPIN, { ticks: 16 });
  await page.evaluate(() => { window.__swGame.input.mouseDown = false; });
  await page.evaluate(PUMPPIN, { ticks: 34 });
  await sleep(900);

  const hit = await page.evaluate((eid) => {
    const g = window.__swGame;
    const e = (g.entities.enemies ?? []).find((en) => en.vanillaId === 327);
    return { hp: e?.hp, tagged: (() => { try { return g.player.tagEffectStack.isNPCTagged(4680, eid); } catch (err) { return 'err'; } })(),
      tid: g.player.minionTargetId, frame: e?.customFrameIdx, spawnAlpha: e?.spawnAlpha, dead: e?.dead };
  }, swing.eid);
  L.say(`after-hit(+50t): ${JSON.stringify(hit)}`);
  L.chk('whip-tag-landed', hit.tagged === true && hit.tid === swing.eid,
    `tagged=${hit.tagged} tid=${hit.tid} eid=${swing.eid} hp=${hit.hp}`);

  const B_head = await page.evaluate(SAMPLE, { wx: EX, wy: EY, r: 60 });
  const B_cloak = await page.evaluate(SAMPLE, { wx: EX, wy: EY + 80, r: 40 });
  await saveCanvasShot(page, `${OUT}/b-after-hit.png`).catch(() => {});
  L.say(`after-hit head: orange=${B_head.orange} luma=${B_head.meanLuma}`);
  L.say(`after-hit cloak: orange=${B_cloak.orange} luma=${B_cloak.meanLuma}`);

  await page.evaluate(PUMPPIN, { ticks: 240 });
  await sleep(900);
  const D_head = await page.evaluate(SAMPLE, { wx: EX, wy: EY, r: 60 });
  const dState = await page.evaluate((eid) => {
    const g = window.__swGame;
    return { tagged: (() => { try { return g.player.tagEffectStack.isNPCTagged(4680, eid); } catch (err) { return 'err'; } })() };
  }, swing.eid);
  L.say(`+290t head: orange=${D_head.orange} luma=${D_head.meanLuma} tagged=${dState.tagged}`);
  await saveCanvasShot(page, `${OUT}/d-plus290.png`).catch(() => {});

  // ---- 背景 ----
  await page.evaluate(() => {
    const g = window.__swGame;
    g.entities.enemies.length = 0;
    g.entities.projectiles.length = 0;
    g.player.minionTargetId = -1;
  });
  await page.evaluate(PUMPPIN, { ticks: 6, dead: true });
  await sleep(900);
  const BG_head = await page.evaluate(SAMPLE, { wx: EX, wy: EY, r: 60 });
  const BG_cloak = await page.evaluate(SAMPLE, { wx: EX, wy: EY + 80, r: 40 });
  L.say(`bg head-region: luma=${BG_head.meanLuma} orange=${BG_head.orange}`);

  const cov = {
    A: diffBg(A_head, BG_head), B: diffBg(B_head, BG_head), D: diffBg(D_head, BG_head),
    cloakA: diffBg(A_cloak, BG_cloak), cloakB: diffBg(B_cloak, BG_cloak),
  };
  L.say(`headPix(vsBG): A=${cov.A} B=${cov.B} D=${cov.D} | cloak A=${cov.cloakA} B=${cov.cloakB}`);
  L.say(`orange: A=${A_head.orange} B=${B_head.orange} D=${D_head.orange}`);
  L.chk('dist-repro-head-transparent', cov.B !== null && cov.A !== null && cov.B < cov.A * 0.5,
    `headPix B/A=${cov.B}/${cov.A}(orange ${A_head.orange}→${B_head.orange};cloak ${cov.cloakA}→${cov.cloakB})`);

  writeFileSync(`${OUT}/bj705a-dist-result.json`, JSON.stringify({
    state0, swing, hit, dState, cov,
    orange: { A: A_head.orange, B: B_head.orange, D: D_head.orange },
    luma: { A: A_head.meanLuma, B: B_head.meanLuma, D: D_head.meanLuma, BG: BG_head.meanLuma },
  }, null, 2));
} finally {
  await browser.close().catch(() => {});
}
process.exit(L.exitCode());
