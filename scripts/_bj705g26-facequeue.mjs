// BJ705-G26 件2 判别锁探针（一次性）:南瓜王表情叠画队列活体计数。
// 钩 flushNpcWhiteLift 计 PumpkingFace/TreeFace 条目——期望 327 在场时 10 条/帧
// （1 ga:1 + 9 tint/tintA 阶梯）;移除后 0 条。
import { mkdirSync } from 'node:fs';
import { launchBrowser, openPage, bootstrap, createGame, pump,
  godMode, clearEnemies, spawnEnemy, Ledger,
} from '../tools/probe/lib/index.mjs';

const L = new Ledger();
const OUT = process.env.SW_PROBE_OUT ?? '/tmp/probe-out/_bj705g26';
mkdirSync(OUT, { recursive: true });

const INSTALL = `
window.__g26 = { faceItems: -1, total: -1, samples: [] };
window.__g26Install = async () => {
  const mod = await import('/src/render/Renderer.ts');
  const proto = mod.Renderer.prototype;
  if (!proto.__g26p) {
    proto.__g26p = true;
    const of_ = proto.flushNpcWhiteLift;
    proto.flushNpcWhiteLift = function (cam, z, vw, vh) {
      const q = this.npcWhiteLiftQueue;
      if (q && q.length) {
        let f = 0;
        for (const it of q) if (it.tex === 'vanilla/PumpkingFace.png' || it.tex === 'vanilla/TreeFace.png') f++;
        window.__g26.faceItems = f;
        window.__g26.total = q.length;
        if (window.__g26.samples.length < 60) window.__g26.samples.push({ f, total: q.length });
      }
      return of_.call(this, cam, z, vw, vh);
    };
  }
  return 'ok';
};
`;

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
  await page.evaluate(INSTALL);
  await page.evaluate(async () => { await window.__g26Install(); });
  const anchor = await page.evaluate(() => {
    const g = window.__swGame;
    return { px: Math.round(g.player.cx), py: Math.round(g.player.cy) };
  });
  const EX = anchor.px + 150, EY = anchor.py - 120;
  const sp = await spawnEnemy(page, 327, EX, EY);
  L.chk('spawn-pumpking', sp.ok, JSON.stringify(sp).slice(0, 90));
  await pump(page, 150);   // 首见懒加载窗（ensureVImage TTL 通道）
  const s = JSON.parse(await page.evaluate(() => JSON.stringify(window.__g26)));
  const fs = s.samples.map((x) => x.f);
  console.log('samples:', JSON.stringify(s.samples.slice(-8)));
  const withTex = fs.filter((f) => f > 0);
  console.log(`face items: max=${Math.max(...fs, 0)} frames-with-face=${withTex.length}/${fs.length}`);
  L.chk('face-10-per-frame', withTex.length >= 2 && Math.max(...fs) === 10,
    `max=${Math.max(...fs, 0)} alive=${withTex.length}/${fs.length}`);
  await clearEnemies(page);
  const nBefore = JSON.parse(await page.evaluate(() => JSON.stringify(window.__g26.samples))).length;
  await pump(page, 30);
  const sAfter = JSON.parse(await page.evaluate(() => JSON.stringify(window.__g26.samples)));
  console.log(`after clear: samples ${nBefore}→${sAfter.length}（无新增=离场停推）`);
  L.chk('cleared-no-new', sAfter.length === nBefore, `${nBefore}→${sAfter.length}`);
} finally {
  await browser.close();
  L.dump();
}
