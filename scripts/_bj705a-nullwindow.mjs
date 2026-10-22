// BJ705-A 判别锁探针:模拟 NPC_327.png 资产在飞/失败窗(vnpc null)——
// 预期(病灶):披风+双刃可见、头部(NPC_327 本体)消失 = 「头部变透明」
import { mkdirSync } from 'node:fs';
import { launchBrowser, openPage, bootstrap, createGame, pump,
  godMode, clearEnemies, spawnEnemy, saveCanvasShot, Ledger } from '../tools/probe/lib/index.mjs';
const L = new Ledger();
const OUT = '/tmp/probe-out/_bj705a';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PIN = async ({ ticks }) => {
  const st = window.__bj705aPin;
  const g = window.__swGame;
  for (let i = 0; i < ticks; i++) {
    g.fixedUpdate(1 / 60);
    if (st.e && !st.e.dead) { st.e.x = st.ex; st.e.y = st.ey; st.e.vx = 0; st.e.vy = 0; }
    g.camera.x = st.cx; g.camera.y = st.cy;
    if ((i & 15) === 15) await new Promise((r) => setTimeout(r, 0));
  }
};
const SAMPLE_AT = async () => {
  const g = window.__swGame;
  const e = (g.entities.enemies ?? []).find((en) => en.vanillaId === 327);
  if (!e) return { why: 'no-enemy' };
  const cam = g.camera;
  const cv = g.renderer.canvas;
  const z = cam.zoom ?? 1;
  const [px, py] = cam.worldToScreen(e.cx, e.cy);
  const R = Math.ceil(60 * z);
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
  return { orange, meanLuma: +(lumaSum / n).toFixed(1), raw: Array.from(d) };
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
  await clearEnemies(page);
  await pump(page, 30);
  await page.evaluate(() => {
    const c = window.__swGame.world.clock;
    c.timeOfDay = 0.5;
    c.tick = () => {};
  });
  const anchor = await page.evaluate(() => {
    const g = window.__swGame;
    return { px: Math.round(g.player.cx), py: Math.round(g.player.cy) };
  });
  const EX = anchor.px + 150, EY = anchor.py - 120;
  const sp = await spawnEnemy(page, 327, EX, EY);
  L.chk('spawn', sp.ok, '');
  await page.evaluate(({ ex, ey }) => {
    const g = window.__swGame;
    const e = (g.entities.enemies ?? []).find((en) => en.vanillaId === 327);
    window.__bj705aPin = { e, ex: ex - 50, ey: ey - 50, cx: ex, cy: ey };
  }, { ex: EX, ey: EY });
  await page.evaluate(PIN, { ticks: 50 });
  await sleep(600);
  // 基线(资产在位)
  const A = await page.evaluate(SAMPLE_AT);
  await saveCanvasShot(page, `${OUT}/null-a-normal.png`);
  L.say(`normal: orange=${A.orange} luma=${A.meanLuma}`);
  // ★模拟资产失败窗:驱逐 vimages 里的 NPC_327.png + 标记 10s TTL 失败
  //  (等价 CDN/SW 瞬态失败态:ensureVImage 返回 null → vnpc null → 本体 if(r) 跳过)
  await page.evaluate(() => {
    const at = window.__swGame.renderer.atlas;
    at.vimages.delete('vanilla/NPC_327.png');
    at._vImageFailed.set('vanilla/NPC_327.png', performance.now());
    const v = at.vnpc(327, 0);
    return { vnpcNow: !!v };
  }).then((r) => L.say(`forced-fail vnpc: ${JSON.stringify(r)}`));
  await sleep(300);
  const B = await page.evaluate(SAMPLE_AT);
  await saveCanvasShot(page, `${OUT}/null-b-forced.png`);
  L.say(`forced-fail: orange=${B.orange} luma=${B.meanLuma}`);
  // 恢复(清除失败标记,让重试跑)
  await page.evaluate(() => {
    const at = window.__swGame.renderer.atlas;
    at._vImageFailed.delete('vanilla/NPC_327.png');
  });
  await sleep(800);
  const C = await page.evaluate(SAMPLE_AT);
  await saveCanvasShot(page, `${OUT}/null-c-recovered.png`);
  L.say(`recovered: orange=${C.orange} luma=${C.meanLuma}`);
  L.chk('lesion-head-gone-body-window', B.orange < A.orange * 0.5,
    `orange A=${A.orange} B(fail)=${B.orange} C(recover)=${C.orange}`);
} finally {
  await browser.close().catch(() => {});
}
process.exit(L.exitCode());
