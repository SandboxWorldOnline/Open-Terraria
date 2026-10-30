// ★gladd Phase 1 性能 A/B 探针(2026-10-28):gladd=0 vs gladd=1 整帧耗时实测。
//  两档场景:①重载混合夹具(⑩粒子×4 巨 quad/⑪ 四实体/⑨尘×24/⑫-a鞭×2/⑫-b条带
//  +fb 闭包/⑫-c 导线+狱火)②空场景(零面内容=空转开销面)。ABAB×3 交错(控温漂/
//  GPU 状态);tick/GT 钉死=两臂同帧内容;暂停世界=纯渲染成本。注意:本机 Mac
//  (Metal)口径;垫底未退役=两臂都付 c10eCompositeIntoHud(收益大头未计)。
// 运行:SW_ORIGIN=http://localhost:5207 node tools/run-diag.mjs --timeout=600000 scripts/_gladd-perf-ab.mjs
import { launchBrowser, openPage, bootstrap, createGame, pump } from '../tools/probe/lib/index.mjs';
import { freezeClock } from '../tools/probe/lib/clock.mjs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5207';
const N = Number(process.env.SW_N || 200);   // 每臂每轮帧数
const ROUNDS = Number(process.env.SW_ROUNDS || 6);   // 交错轮数
const AA_MODE = process.env.SW_AA === '1';   // A/A 噪声底模式(两臂同 gladd=0=测纯噪声)
const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, `${ORIGIN}/?cloudcache=0&dustbatch=0`);
await createGame(page, { size: 'small', seed: '05162020', pinRandom: 20261028 });
await pump(page, 60);

await page.evaluate(() => {
  const g = window.__swGame;
  g.lighting.compute = () => {};
  const noop = () => {};
  try { g.world.liquid && (g.world.liquid.update = noop); } catch { }
  g.vanillaDust && (g.vanillaDust.update = noop);
  g.entities.critters.length = 0; g.entities.enemies.length = 0; g.entities.drops.length = 0;
  for (const n of g.entities.npcs) n.update = () => {};
  window.__swGame.running = false; window.__swGame.paused = true;
  const r = g.renderer;
  r['flushItemGlowGL'] = function () { this.itemGlowQueue = []; this.itemGlowHeldCollected = new WeakSet(); return true; };
  r['flushItemGlow'] = function () { this.itemGlowQueue = []; this.itemGlowHeldCollected = new WeakSet(); };
  r.constructor.gladd = true;
  r.acquireCloudPipe();
  (async () => {
    const ta = await import('/src/render/TileAnim.ts');
    window.__setTick = (v) => { ta.tileAnim.tick = v; };
    const gt = await import('/src/core/GameTime.ts');
    window.__pinGT = (t) => gt.pinGameTimeTicks(t);
  })();
});
await freezeClock(page, { tod: 0.35 });

// ---- 夹具安装(重载档) ----
const FIXTURE = process.env.SW_IDLE === '1' ? 0 : 1;
const WINGS = process.env.SW_WINGS === '1';   // 戴翼+甲日常档(真装备路径)
const ONLY = (process.env.SW_ONLY || 'fp,eg,vd,wp,wr,inf,tr').split(',');
const ON = (k) => ONLY.includes(k);
if (FIXTURE) {
  const fx = await page.evaluate(async (only, wingsMode) => {
    const ON = (k) => only.includes(k);
    const WINGS = wingsMode;
    const g = window.__swGame;
    const r = g.renderer;
    const px = g.player.x, py = g.player.y;
    let nd = 0;
    // ⑩ 粒子(巨 quad 高 overdraw)
    if (ON('fp')) {
      const M = await import('/src/fx/FadingParticles.ts');
      const cfgs = [
        { x: px + 150, y: py - 80, timeToLive: 100000, fadeIn: 0.1, fadeOut: 0.1, texKey: 'vanilla/Projectile_1121.png', tint: [30, 180, 255, 0], rot: 0.6, scaleX: 1.5, scaleY: 1.2, fullbright: true },
        { x: px - 200, y: py - 140, timeToLive: 100000, fadeIn: 0.1, fadeOut: 0.3, texKey: 'vanilla/Projectile_1121.png', tint: [120, 220, 255, 0], rot: -1.1, scaleX: 0.8, scaleY: 2, fullbright: true },
        { x: px + 40, y: py - 220, timeToLive: 100000, fadeIn: 0.1, fadeOut: 0.5, texKey: 'vanilla/Extra_34.png', tint: [255, 200, 100, 0], rot: 0.2, scaleX: 1.1, scaleY: 0.9, fullbright: true },
        { x: px - 90, y: py - 40, timeToLive: 100000, fadeIn: 0.1, fadeOut: 0.1, texKey: 'vanilla/Extra_34.png', tint: [200, 255, 150, 0], rot: 2.2, scaleX: 1.3, scaleY: 1.3, fullbright: true },
      ];
      for (const cfg of cfgs) { const p = M.fadingParticles.spawn(cfg); if (p) p.timeSinceSpawn = 50000; }
    }
    // ⑪ 实体族
    if (ON('eg')) {
      const E = await import('/src/entities/Enemy.ts');
      const mk = (vid, x, y) => { const e = E.Enemy.fromVanilla(vid, x, y); if (e) { e.vx = 0; e.vy = 0; g.entities.add(e, 'enemies'); } return e; };
      const fae = mk(677, px + 150, py - 100); if (fae) fae.visAngle = 0.6;
      const fai = mk(583, px - 200, py - 140); if (fai) { fai.vx = 30; fai.visAngle = -0.4; }
      const dee = mk(668, px - 340, py - 40); if (dee) { dee.lai3 = 36; dee.spawnAlpha = 0; }
      const cry = mk(516, px + 60, py - 240); if (cry) cry.spawnAlpha = 220;
    }
    // ⑨ 尘×24
    const vd = g.vanillaDust;
    for (const d of (vd['pool'] ?? [])) d.active = false;
    if (ON('vd')) {
      let i = 0;
      for (const t of [6, 15, 59, 60, 61, 62, 63, 64]) {
        for (let k = 0; k < 3; k++) {
          const d = vd.spawn(px - 420 + (i % 12) * 70, py - 240 + Math.floor(i / 12) * 90, 0, 0, t, 0, 0, 0, null, [1, 1.5, 2][k]);
          if (d) { d.rotation = [0, 0.6, 1.2][k]; nd++; }
          i++;
        }
      }
    }
    // ⑫-c 导线
    if (ON('wr')) {
      Object.defineProperty(r, 'showWires', { get: () => true, set: () => {}, configurable: true });
      Object.defineProperty(r, 'wireModes', { get: () => [0, 0, 0, 0, 0], set: () => {}, configurable: true });
      const st = g.world.store;
      const ptx = Math.floor(px / 16), pty = Math.floor(py / 16);
      for (let k = 0; k < 14; k++) st.wire[st.idx(ptx + 4 + k, pty - 4)] |= 1 | 2;
      for (let k = 0; k < 8; k++) st.wire[st.idx(ptx + 4 + k, pty - 2)] |= 4;
      for (let k = 0; k < 6; k++) st.wire[st.idx(ptx + 4 + k, pty)] |= 8 | 16;
    }
    // ⑫-c 狱火
    if (ON('inf')) { g.player.buffs.set(50, 100000); g.player.flameRingRot = 0.5; }
    if (WINGS) {
      const S = await import('/src/data/vanillaItemStats.ts');
      const Items = await import('/src/data/items.ts');
      const find = (part, texSlot) => {
        for (let i = 0; i < Items.ITEM_DEFS.length; i++) if (S.statOfInternal(i)?.[part] === texSlot) return i;
        return null;
      };
      const wh = find('hs', 109), wb = find('bs', 175);
      // ★BJ737-A 后验:SW_NOARMOR=1 只装翼(甲 glow 2D 回归的 fold 成本隔离)
      const noArmor = process.env.SW_NOARMOR === '1';
      if (!noArmor) {
        if (wh != null) g.player.inv.armor[0] = { id: wh, stack: 1, prefix: 0 };
        if (wb != null) g.player.inv.armor[1] = { id: wb, stack: 1, prefix: 0 };
      }
      const ww = find('hs', 32) ?? (() => { for (let i = 0; i < Items.ITEM_DEFS.length; i++) if (S.statOfInternal(i)?.wing === 32) return i; return null; })();
      if (ww != null) g.player.inv.armor[5] = { id: ww, stack: 1, prefix: 0 };
      g.player.equipStats;   // 触发重算
    }
    // ⑫-a 鞭×2
    if (ON('wp')) {
      const W = await import('/src/entities/WhipProj.ts');
      const mkW = (ang) => { const w = new W.WhipProj(px, py, ang, 1034, 0, 10, 2, 30, 8, () => g.player, () => ang, 1); g.entities.add(w, 'projectiles'); };
      mkW(-0.4); mkW(0.6);
    }
    // ⑫-b 条带+fb 闭包(逐帧注入器)
    const wantTrail = ON('tr');
    window.__pushTrail = () => {
      if (!wantTrail) return;
      const pts = [];
      for (let i2 = 0; i2 < 12; i2++) {
        pts.push({ x: px + 40 + i2 * 12, y: py - 60 + Math.sin(i2 * 0.7) * 30,
          hw: 5 + i2 * 0.3, rot: i2 * 0.2, r: 0.9, g: 0.5, b: 1.0, a: 0.5 * (1 - i2 / 12) });
      }
      r.queueTrailShade({ set: 'FinalFractal', pts, opacity: 1, expectedPairs: 60, time: 1.25, zigzag: 0.5 });
      r.projFullbrightQueue.push((ctx2) => {
        ctx2.save();
        ctx2.globalCompositeOperation = 'lighter';
        ctx2.fillStyle = 'rgb(255,200,80)';
        ctx2.fillRect(px + 100, py - 160, 24, 10);
        ctx2.restore();
      });
    };
    return { nd, only: only.join(',') };
  }, ONLY, WINGS);
  console.log('[fixture]', JSON.stringify(fx));
}

// ---- 暖机(纹理/烘焙落地) ----
for (let i = 0; i < 150; i++) {
  await page.evaluate(() => {
    const g = window.__swGame;
    if (window.__pushTrail) window.__pushTrail();
    window.__setTick(100000); window.__pinGT(0);
    window.__vnow = (window.__vnow || performance.now()) + 16.6667;
    g.frame(window.__vnow);
  });
}

// ---- ABAB×3 计时 ----
const runArm = async (gladd) => {
  const t = await page.evaluate((gladdOn, n) => {
    const g = window.__swGame;
    g.renderer.constructor.gladd = gladdOn;
    window.__setTick(100000); window.__pinGT(0);
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      if (window.__pushTrail) window.__pushTrail();
      window.__vnow = (window.__vnow || performance.now()) + 16.6667;
      g.frame(window.__vnow);
    }
    return performance.now() - t0;
  }, gladd, N);
  return t;
};
const arms = { A: [], B: [] };
for (let round = 0; round < ROUNDS; round++) {
  arms.A.push(await runArm(AA_MODE ? false : false));
  arms.B.push(await runArm(AA_MODE ? false : true));
}
const stats0 = await page.evaluate(() => {
  const r = window.__swGame.renderer;
  return {
    fp: r.gladdFPartStats.gl, eg: r.gladdEntGlowStats.gl, vd: r.gladdVDustStats.gl,
    wp: r.gladdWhipStats.gl, wr: r.gladdWiresStats.gl, inf: r.gladdInfernoStats.gl, tr: r.gladdTrailStats.gl,
  };
});
const msList = (arr) => arr.map((x) => (x / N));
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a) => { const s2 = [...a].sort((x, y) => x - y); return s2[(s2.length - 1) >> 1]; };
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const aL = msList(arms.A), bL = msList(arms.B);
const aM = mean(aL), bM = mean(bL);
const fmt = (l) => l.map((x) => x.toFixed(3)).join(',');
console.log(`[${AA_MODE ? 'A/A 噪声底' : FIXTURE ? '重载混合' : '空场景'}] A: ${fmt(aL)} | ${AA_MODE ? "A'" : 'B'}: ${fmt(bL)}`);
console.log(`均值 A=${aM.toFixed(3)}±${std(aL).toFixed(3)} ${AA_MODE ? "A'" : 'B'}=${bM.toFixed(3)}±${std(bL).toFixed(3)} 中位 ${median(aL).toFixed(3)}/${median(bL).toFixed(3)}`);
console.log(`Δ(均值)=${(((bM - aM) / aM) * 100).toFixed(1)}% Δ(中位)=${(((median(bL) - median(aL)) / median(aL)) * 100).toFixed(1)}% (负=${AA_MODE ? '应为~0' : 'GL 快'};轮间σ=${std(aL).toFixed(3)}/${std(bL).toFixed(3)}ms=噪声底)`)
console.log('[B 臂 GL 会话累计]', JSON.stringify(stats0));
await browser.close();
