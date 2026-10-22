// BJ705-C 普查判别锁探针:对普查矩阵最高危 6 员跑 BJ705-A 强制失败窗范式——
// 预期(病灶):部件贴图强制失败 → 采样区【部分】变化(本体仍在=不对称假体存在),
// 对照整实体消失(changedFrac≈1)与零变化(changedFrac≈0)。
// 修前跑=实证病灶存在;每员三拍:基线 A → 强制失败 B → 恢复 C。
import { mkdirSync } from 'node:fs';
import { launchBrowser, openPage, bootstrap, createGame, pump,
  godMode, clearEnemies, spawnEnemy, saveCanvasShot, Ledger } from '../tools/probe/lib/index.mjs';
const L = new Ledger();
const OUT = '/tmp/probe-out/_bj705c';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 普查矩阵最高危样本(修前):id/部件贴图/名称/装配(aiInit/master 布线/freeze 冻 AI)
const CASES = [
  { name: 'wof-body', ids: [113], tex: 'vanilla/WallOfFlesh.png', radius: 120, freeze: true },
  { name: 'prime-arm', ids: [127, 128], tex: 'vanilla/Arm_Bone_2.png', radius: 110, wire: true },
  { name: 'empress-wing', ids: [636], tex: 'vanilla/Extra_159.png', radius: 120 },
  { name: 'ml-head', ids: [396], texCandidates: ['vanilla/Extra_26.png', 'vanilla/Extra_18.png'], radius: 100, freeze: true },
  { name: 'deerclops-fog', ids: [668], tex: 'vanilla/Extra_245.png', radius: 110, freeze: true, postState: 'e.lai3 = 30;' },
  { name: 'antlion-body', ids: [69], tex: 'vanilla/AntlionBody.png', radius: 70 },
];

const PIN = (st) => {
  const g = window.__swGame;
  for (const vid of st.ids) {
    const e = (g.entities.enemies ?? []).find((en) => en.vanillaId === vid && !en.dead);
    if (e) { e.x = e.__px; e.y = e.__py; e.vx = 0; e.vy = 0; }
  }
  g.camera.x = st.cx; g.camera.y = st.cy;
};
const SAMPLE_AT = async (vid0, R) => {
  const g = window.__swGame;
  const e = (g.entities.enemies ?? []).find((en) => en.vanillaId === vid0 && !en.dead);
  if (!e) return { why: 'no-enemy' };
  const cam = g.camera;
  const cv = g.renderer.canvas;
  const z = cam.zoom ?? 1;
  const [px, py] = cam.worldToScreen(e.cx, e.cy);
  const sx = Math.round(px) - R, sy = Math.round(py) - R, W = R * 2, H = R * 2;
  const c2 = document.createElement('canvas');
  c2.width = W; c2.height = H;
  const g2 = c2.getContext('2d', { willReadFrequently: true });
  g2.drawImage(cv, sx, sy, W, H, 0, 0, W, H);
  const d = g2.getImageData(0, 0, W, H).data;
  return { raw: Array.from(d), w: W, h: H };
};

const diff = (A, B) => {
  if (!A?.raw || !B?.raw) return null;
  const d = A.raw, e = B.raw;
  let changed = 0, opaque = 0;
  for (let i = 0; i < d.length; i += 4) {
    const a1 = d[i + 3], a2 = e[i + 3];
    if (a1 > 8 || a2 > 8) opaque++;
    if (Math.abs(d[i] - e[i]) > 24 || Math.abs(d[i + 1] - e[i + 1]) > 24
      || Math.abs(d[i + 2] - e[i + 2]) > 24 || Math.abs(a1 - a2) > 32) changed++;
  }
  return { changedFrac: +(changed / (d.length / 4)).toFixed(4), opaqueFrac: +(opaque / (d.length / 4)).toFixed(4) };
};

const browser = await launchBrowser({});
try {
  const page = await openPage(browser, { errors: L.fails });
  page.__probeOrigin = process.env.SW_ORIGIN;
  const boot = await bootstrap(page, process.env.SW_ORIGIN);
  L.chk('bootstrap', boot.ok, boot.why ?? '');
  const gen = await createGame(page, { mode: 'direct', seed: '05162020', size: 'small' });
  L.chk('createGame', gen.ok, gen.why ?? '');
  await godMode(page, true);

  for (const c of CASES) {
    await clearEnemies(page);
    await pump(page, 20);
    const anchor = await page.evaluate(() => {
      const g = window.__swGame;
      return { px: Math.round(g.player.cx), py: Math.round(g.player.cy) };
    });
    const spawns = [];
    c.ids.forEach((vid, i) => {
      spawns.push(spawnEnemy(page, vid, anchor.px + 170 + i * 60, anchor.py - 110));
    });
    const rs = await Promise.all(spawns);
    const okSpawn = rs.every((r) => r.ok);
    L.chk(`spawn-${c.name}`, okSpawn, rs.map((r) => r.why ?? '').join(','));
    if (!okSpawn) continue;
    // master 布线(Prime 部件臂骨:128.master=127 头)
    if (c.wire) {
      await page.evaluate(() => {
        const g = window.__swGame;
        const head = (g.entities.enemies ?? []).find((e) => e.vanillaId === 127);
        const part = (g.entities.enemies ?? []).find((e) => e.vanillaId === 128);
        if (head && part) part.master = head;
        return !!(head && part && part.master === head);
      }).then((r) => L.chk(`wire-${c.name}`, r, ''));
    }
    const st = await page.evaluate((ids, opts) => {
      const g = window.__swGame;
      const ents = ids.map((vid) => (g.entities.enemies ?? []).find((e) => e.vanillaId === vid && !e.dead));
      const main = ents[0];
      for (const e of ents) if (e) { e.__px = e.x; e.__py = e.y; }
      // 冻结 AI(实例遮蔽 fixedUpdate——EntityManager.update 消费的是 fixedUpdate
      // 非 update,遮错方法=WoF 头 AI 照跑瞬移地狱):WoF/鹿角怪/月总头等 boss AI
      // 无人为墙/激怒态时瞬移/清态,冻结保住绘制态采样(postState 冻结后补状态字段)
      if (opts.freeze) {
        for (const e of ents) if (e) {
          e.fixedUpdate = () => {};
          e.update = () => {};
          if (opts.postState) new Function('e', 'g', opts.postState)(e, g);
        }
      }
      return { ids, cx: main ? main.cx : g.player.cx, cy: main ? main.cy : g.player.cy, found: ents.filter(Boolean).length };
    }, c.ids, { freeze: !!c.freeze, postState: c.postState ?? null });
    if (st.found < c.ids.length) { L.chk(`ents-${c.name}`, false, `found=${st.found}`); continue; }
    await page.evaluate(PIN, st);
    await pump(page, 40);
    await page.evaluate(PIN, st);
    await sleep(700);   // 首绘懒加载落地(部件+本体)
    // 前置:部件贴图确已被绘制路径消费(在 vimages=首绘已触发);texCandidates=自动选已消费支
    let tex = c.tex;
    if (c.texCandidates) {
      const hit = await page.evaluate((cands) => {
        const at = window.__swGame.renderer.atlas;
        return cands.find((t) => at.vimages.has(t)) ?? null;
      }, c.texCandidates);
      L.chk(`texPick-${c.name}`, !!hit, `none of ${c.texCandidates.join(',')} consumed`);
      if (!hit) continue;
      tex = hit;
    }
    const loaded = await page.evaluate((t) => window.__swGame.renderer.atlas.vimages.has(t), tex);
    L.chk(`consumed-${c.name}`, loaded, `${tex} 未在 vimages(路径未消费=案位错误)`);
    if (!loaded) continue;
    await page.evaluate(PIN, st);
    await sleep(250);
    const A = await page.evaluate(SAMPLE_AT, c.ids[0], c.radius);
    await saveCanvasShot(page, `${OUT}/${c.name}-a.png`);
    // ★强制失败窗(驱逐+10s TTL 失败标记——ensureVImage/vmisc 返回 null)
    await page.evaluate((t) => {
      const at = window.__swGame.renderer.atlas;
      at.vimages.delete(t);
      at._vImageFailed.set(t, performance.now());
      return at.vimages.has(t);
    }, tex);
    await page.evaluate(PIN, st);
    await sleep(300);
    const B = await page.evaluate(SAMPLE_AT, c.ids[0], c.radius);
    await saveCanvasShot(page, `${OUT}/${c.name}-b.png`);
    // 恢复(清失败标记 → 重试 → 自愈)
    await page.evaluate((t) => {
      window.__swGame.renderer.atlas._vImageFailed.delete(t);
    }, tex);
    await sleep(900);
    await page.evaluate(PIN, st);
    await sleep(250);
    const C = await page.evaluate(SAMPLE_AT, c.ids[0], c.radius);
    await saveCanvasShot(page, `${OUT}/${c.name}-c.png`);
    const dAB = diff(A, B), dAC = diff(A, C);
    if (!dAB || !dAC) { L.chk(`sample-${c.name}`, false, 'sample void'); continue; }
    L.say(`${c.name}: A→B changed=${dAB.changedFrac} opaque=${dAB.opaqueFrac} | A→C changed=${dAC.changedFrac}`);
    // 判别:0.02 < changed < 0.92 = 部分消失(本体仍在)= 不对称假体存在
    L.chk(`chimera-${c.name}`,
      dAB.changedFrac > 0.02 && dAB.changedFrac < 0.92 && dAB.opaqueFrac > 0.05,
      `changed=${dAB.changedFrac} opaque=${dAB.opaqueFrac}(整失≈1/零效≈0 均非病灶形态)`);
  }
} finally {
  await browser.close().catch(() => {});
}
process.exit(L.exitCode());
