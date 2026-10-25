// _bj712c-gigazapper-probe.mjs — BJ712C 件1 实机验证：千兆电击塔 389 出电矛 437
// （转报症状「三档实测均不出弹」反证;基伤 25/旗键 389/平飞 6 三面核验）。
import { launchBrowser, openPage, bootstrap, createGame, pump, ledger, spawnEnemy } from '../tools/probe/lib/index.mjs';

const L = ledger();
const browser = await launchBrowser({});
try {
  const page = await openPage(browser, { errors: L.fails });
  const boot = await bootstrap(page, process.env.SW_ORIGIN);
  L.chk('bootstrap', boot.ok, boot.why ?? '');
  const gen = await createGame(page, { mode: 'direct', seed: '05162020', size: 'small' });
  L.chk('createGame', gen.ok, gen.why ?? '');
  await pump(page, 90, { clearEnemies: true });
  const pos = await page.evaluate(() => {
    const g = window.__swGame;
    const p = g.player;
    return { x: p.cx, y: p.cy };
  });
  const gz = await spawnEnemy(page, 389, pos.x + 240, pos.y);
  L.chk('spawn-gigazapper-389', gz.ok, gz.why ?? '');
  // 多检查点采样（弹 pierce=1 命中即灭;240px 飞行≈13t,各拍窗内活弹可捕）
  const snap = () => page.evaluate(() => {
    const g = window.__swGame;
    const projs = g.entities.projectiles ?? [];
    const spears = projs.filter((p) => p.projId === 437);
    return {
      n: spears.length,
      sample: spears.slice(0, 3).map((p) => ({
        dmg: p.damage, vx: Math.round(p.vx), vy: Math.round(p.vy), bn: p.bannerNpcId ?? null,
      })),
      gzAlive: (g.entities.enemies ?? []).some((e) => e.vanillaId === 389 && !e.dead),
    };
  });
  let res = { n: 0, sample: [], gzAlive: true };
  for (const wait of [25, 25, 40, 50]) {          // t≈25(首发窗)/50/90/140
    await pump(page, wait);
    const cur = await snap();
    if (cur.n > res.n) res = { ...cur, sample: [...res.sample, ...cur.sample] };
    if (!cur.gzAlive) res.gzAlive = false;
  }
  L.chk('gigazapper-alive', res.gzAlive, 'gigazapper despawned early?');
  L.chk('437-spear-spawned', res.n >= 1, `count=${res.n}`);
  L.chk('437-base-damage-25', res.sample.every((s) => s.dmg === 25), JSON.stringify(res.sample));
  L.chk('437-banner-frozen-389', res.sample.every((s) => s.bn === 389), JSON.stringify(res.sample));
  L.chk('437-flat-velocity-6', res.sample.every((s) => Math.abs(Math.abs(s.vx) - 6) < 0.01 && s.vy === 0), JSON.stringify(res.sample));
  process.exit(L.exitCode());
} finally {
  await browser.close();
}
