// BJ705-A 辅诊:headless 探针的渲染路径(acc 窗是否活跃)
import { launchBrowser, openPage, bootstrap, createGame, pump,
  godMode, clearEnemies, Ledger,
} from '../tools/probe/lib/index.mjs';

const L = new Ledger();
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
  // 等真实渲染帧跑起来
  await page.evaluate(async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => requestAnimationFrame(r));
  });
  const diag = await page.evaluate(() => window.__swGame.renderer.accDiag());
  L.say(`accDiag: ${JSON.stringify(diag, null, 1).slice(0, 1500)}`);
  const gl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    if (!gl) return { ok: false };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return { ok: true, renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'masked', ver: gl.getParameter(gl.VERSION) };
  });
  L.say(`webgl: ${JSON.stringify(gl)}`);
} finally {
  await browser.close().catch(() => {});
}
process.exit(L.exitCode());
