/**
 * BJ705-A:南瓜王(327)被暗黑收割者(4680)鞭 tag 后头部透明——复现探针。
 *  场景:夜空钉位南瓜王(头=本体 NPC_327),玩家持 Dark Harvest 真挥命中 →
 *  时间线采样头区可见度(橙覆盖/亮度/与背景差),对照披风区/背景参考。
 *  采样口径:
 *   - head 区:worldToScreen(cx, cy) 半径 60×zoom 方形(罩 102×114 帧主体)
 *   - cloak 区:(cx, cy+80) 半径 40×zoom(披风锚=中心+80Y)
 *   - BG 参考:击杀移除后同屏位采样(同相机同背景)
 *   - 指标:orangePx(R>120,G 40..170,B<90)、headPix(|S−BG|>36)、meanLuma
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
  // ★裸 import(勿 ?t= 击穿——?t= 副本=另一 class 身份,补丁打不进活实例,
  //  awaitRenders 恒超时 15s=无钉位真实时间模拟窗,夜跑 C/D 漂移/昼跑坠散根因)
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

/** 页内:钉位泵(每 tick 后回钉敌位/相机/防脱屏) */
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
    const R8 = d[i], G8 = d[i + 1], B8 = d[i + 2], A8 = d[i + 3];
    lumaSum += 0.299 * R8 + 0.587 * G8 + 0.114 * B8; n++;
    if (R8 > 120 && G8 > 40 && G8 < 170 && B8 < 90 && A8 > 100) orange++;
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

  // 白天正午 + 冻结时钟(静态亮空=干净背景参照,头区橙可测;天空不动=BG 稳定)
  const night = await page.evaluate(() => {
    const c = window.__swGame.world.clock;
    c.timeOfDay = 0.5;   // 正午
    c.tick = () => {};   // 冻结:天空/星月不动
    return { isDay: c.isDay };
  });
  L.say(`noon pinned+frozen: ${JSON.stringify(night)}`);

  const gi = await giveItems(page, [{ vid: 4680, slot: 0 }], { select: 0 });
  L.chk('give-darkharvest', gi.ok, JSON.stringify(gi).slice(0, 90));

  // 敌锚位:玩家右上近距(鞭程内,夜空背景)
  const anchor = await page.evaluate(() => {
    const g = window.__swGame;
    return { px: Math.round(g.player.cx), py: Math.round(g.player.cy),
      gl: g.world.groundLevel };
  });
  const EX = anchor.px + 150, EY = anchor.py - 120;
  const sp = await spawnEnemy(page, 327, EX, EY);
  L.chk('spawn-pumpking', sp.ok, JSON.stringify(sp).slice(0, 90));
  await page.evaluate(INSTALL);
  await page.evaluate(async () => { await window.__bj705aInstall(); });
  // 钉位注册(头中心=敌中心;相机钉敌中心)——Enemy ctor 中心锚 → 盒左上 = 中心−50
  await page.evaluate(({ ex, ey }) => {
    const g = window.__swGame;
    const e = (g.entities.enemies ?? []).find((en) => en.vanillaId === 327);
    window.__bj705aPin = { e, ex: ex - 50, ey: ey - 50, cx: ex, cy: ey };
  }, { ex: EX, ey: EY });
  await page.evaluate(PUMPPIN, { ticks: 40 });
  await page.evaluate(() => window.__awaitRenders(3));

  const state0 = await page.evaluate(() => {
    const g = window.__swGame;
    const e = (g.entities.enemies ?? []).find((en) => en.vanillaId === 327);
    return { id: e?.id, hp: e?.hp, frame: e?.customFrameIdx, ai3: e?.ai3,
      spawnAlpha: e?.spawnAlpha, tid: g.player.minionTargetId,
      iframes: e?.iframes, colorRGBA: e?.colorRGBA, alphaFade: e?.alphaFade,
      held: g.player.inv.heldItem()?.vid ?? g.player.inv.heldItem()?.id };
  });
  L.say(`state0: ${JSON.stringify(state0)}`);

  // ---- 基线采样(head + cloak) ----
  const A_head = await page.evaluate(SAMPLE, { wx: EX, wy: EY, r: 60 });
  const A_cloak = await page.evaluate(SAMPLE, { wx: EX, wy: EY + 80, r: 40 });
  await saveCanvasShot(page, `${OUT}/a-baseline.png`).catch(() => {});
  L.say(`baseline head: orange=${A_head.orange} luma=${A_head.meanLuma} (${A_head.W}x${A_head.H})`);
  L.say(`baseline cloak: orange=${A_cloak.orange} luma=${A_cloak.meanLuma}`);

  // ---- 真实挥鞭(瞄准南瓜王中心) ----
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
  await page.evaluate(PUMPPIN, { ticks: 16 });   // 9 拍起手+命中拍+余拍
  await page.evaluate(() => { window.__swGame.input.mouseDown = false; });
  await page.evaluate(PUMPPIN, { ticks: 4 });

  const hit = await page.evaluate((eid) => {
    const g = window.__swGame;
    const e = (g.entities.enemies ?? []).find((en) => en.vanillaId === 327);
    return { hp: e?.hp, tagged: (() => { try { return g.player.tagEffectStack.isNPCTagged(4680, eid); } catch (err) { return 'err'; } })(),
      tid: g.player.minionTargetId, frame: e?.customFrameIdx, ai3: e?.ai3,
      projs: (g.entities.projectiles ?? []).length, spawnAlpha: e?.spawnAlpha, dead: e?.dead,
      iframes: e?.iframes, colorRGBA: e?.colorRGBA };
  }, swing.eid);
  L.say(`after-hit: ${JSON.stringify(hit)}`);
  L.chk('whip-tag-landed', hit.tagged === true && hit.tid === swing.eid,
    `tagged=${hit.tagged} tid=${hit.tid} eid=${swing.eid} hp=${hit.hp}`);

  // ---- 命中后时间线采样(先 +30t 清鞭本体/命中拍特效,tag 仍在 ~50t) ----
  await page.evaluate(PUMPPIN, { ticks: 30 });
  await page.evaluate(() => window.__awaitRenders(3));
  const B_head = await page.evaluate(SAMPLE, { wx: EX, wy: EY, r: 60 });
  const B_cloak = await page.evaluate(SAMPLE, { wx: EX, wy: EY + 80, r: 40 });
  await saveCanvasShot(page, `${OUT}/b-after-hit.png`).catch(() => {});
  L.say(`after-hit head: orange=${B_head.orange} luma=${B_head.meanLuma}`);
  L.say(`after-hit cloak: orange=${B_cloak.orange} luma=${B_cloak.meanLuma}`);

  await page.evaluate(PUMPPIN, { ticks: 60 });
  await page.evaluate(() => window.__awaitRenders(3));
  const C_head = await page.evaluate(SAMPLE, { wx: EX, wy: EY, r: 60 });
  L.say(`+60t head: orange=${C_head.orange} luma=${C_head.meanLuma}`);
  await saveCanvasShot(page, `${OUT}/c-plus60.png`).catch(() => {});

  await page.evaluate(PUMPPIN, { ticks: 240 });   // tag 240t 耗尽
  await page.evaluate(() => window.__awaitRenders(3));
  const D_head = await page.evaluate(SAMPLE, { wx: EX, wy: EY, r: 60 });
  const dState = await page.evaluate((eid) => {
    const g = window.__swGame;
    return { tagged: (() => { try { return g.player.tagEffectStack.isNPCTagged(4680, eid); } catch (err) { return 'err'; } })(),
      frame: (() => { const e = (g.entities.enemies ?? []).find((en) => en.vanillaId === 327); return e?.customFrameIdx; })() };
  }, swing.eid);
  L.say(`+300t(tag-exhaust) head: orange=${D_head.orange} luma=${D_head.meanLuma} state=${JSON.stringify(dState)}`);
  await saveCanvasShot(page, `${OUT}/d-plus300.png`).catch(() => {});

  // ---- 背景参考(移除敌) ----
  await page.evaluate(() => {
    const g = window.__swGame;
    const e = (g.entities.enemies ?? []).find((en) => en.vanillaId === 327);
    if (e) e.dead = true;
    g.entities.enemies.length = 0;   // 连双刃一并清
    g.entities.projectiles.length = 0;
    g.player.minionTargetId = -1;
  });
  await page.evaluate(PUMPPIN, { ticks: 6, dead: true });
  await page.evaluate(() => window.__awaitRenders(3));
  const BG_head = await page.evaluate(SAMPLE, { wx: EX, wy: EY, r: 60 });
  const BG_cloak = await page.evaluate(SAMPLE, { wx: EX, wy: EY + 80, r: 40 });
  L.say(`bg head-region: luma=${BG_head.meanLuma}`);
  await saveCanvasShot(page, `${OUT}/e-bg.png`).catch(() => {});

  // ---- 判读 ----
  const cov = {
    A: diffBg(A_head, BG_head), B: diffBg(B_head, BG_head),
    C: diffBg(C_head, BG_head), D: diffBg(D_head, BG_head),
    cloakA: diffBg(A_cloak, BG_cloak), cloakB: diffBg(B_cloak, BG_cloak),
  };
  L.say(`headPix(vsBG): A=${cov.A} B=${cov.B} C=${cov.C} D=${cov.D} | cloak A=${cov.cloakA} B=${cov.cloakB}`);
  L.say(`orange: A=${A_head.orange} B=${B_head.orange} C=${C_head.orange} D=${D_head.orange}`);

  const drop = cov.A > 0 ? cov.B / cov.A : 0;
  L.chk('repro-head-transparent', cov.B !== null && cov.A !== null && cov.B < cov.A * 0.5,
    `headPix B/A=${cov.B}/${cov.A}=${(drop).toFixed(2)}(orange ${A_head.orange}→${B_head.orange};cloak ${cov.cloakA}→${cov.cloakB})`);

  writeFileSync(`${OUT}/bj705a-result.json`, JSON.stringify({
    state0, swing, hit, dState, cov,
    orange: { A: A_head.orange, B: B_head.orange, C: C_head.orange, D: D_head.orange },
    luma: { A: A_head.meanLuma, B: B_head.meanLuma, C: C_head.meanLuma, D: D_head.meanLuma, BG: BG_head.meanLuma },
  }, null, 2));
} finally {
  await browser.close().catch(() => {});
}
process.exit(L.exitCode());
