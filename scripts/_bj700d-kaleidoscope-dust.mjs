// ★BJ700-D 探针:万花筒(4914→proj915)鞭尘生命周期曲线采样。
// 用户实报:挥鞭后留下粒子,慢慢变大,过一段时间才消失。
// 方法:真实使用路径(mouseDown→useItem→WhipProj→WHIP_TRAIL_DUST 915 支)逐 fixedUpdate
// 步进,WeakMap 逐尘跟踪 type=267 的 {出生拍/scale 曲线/noGravity/白影克隆判定(全白颜色)},
// 挥鞭 90 拍后停手,静置 600 拍采样存活曲线。
// 原版参数推演(Proj.cs:48724-48748 + Dust.cs):
//   主尘 scale=0.9+r×0.9 ≥0.9 > fadeIn=r×0.9<0.9 → 首拍清 fadeIn;净 −0.03/t → ≤~58t 死
//   白影克隆 CloneDust 全字段拷贝 noGravity=true(Dust.cs:276)→ 同 −0.03/t 收缩 ≤~31t 死
//   全体 267 尘寿命 < 1s(60t),任意时刻 scale ≤ ~1.9(主尘上限 1.8+首拍 0.05)
// SW_ORIGIN=http://localhost:5210 node tools/run-diag.mjs --timeout=300000 scripts/_bj700d-kaleidoscope-dust.mjs
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const ORIGIN = process.env.SW_ORIGIN ?? 'http://localhost:5210';
const OUT = '/tmp/bj700d-out';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', defaultViewport: { width: 1280, height: 800 }, protocolTimeout: 300000,
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(ORIGIN + '/?play=small', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__swGame && window.__swGame.world && window.__swGame.player,
  { timeout: 300000, polling: 1000 });
await new Promise((r) => setTimeout(r, 1500));

const report = await page.evaluate(async () => {
  const g = window.__swGame;
  const { ITEM_DEFS } = await import('/src/data/items.ts');
  const idx = ITEM_DEFS.findIndex((d) => d && d.vid === 4914);   // Kaleidoscope
  if (idx < 0) return { fatal: 'ITEM_DEFS 无 vid 4914' };

  // ---- 场地:平地清空 + 玩家定位 ----
  const st = g.world.store;
  const px = Math.floor(g.player.cx / 16);
  let gy = Math.floor(g.world.groundLevel) + 4;
  while (gy < st.h - 20 && !st.isSolid(px, gy)) gy++;
  for (let dy = -14; dy <= 1; dy++) for (let dx = -28; dx <= 28; dx++) st.setTile(px + dx, gy + dy, 0);
  for (let dx = -28; dx <= 28; dx++) st.setTile(px + dx, gy + 1, 2);
  g.player.x = px * 16; g.player.y = (gy - 4) * 16; g.player.vx = 0; g.player.vy = 0;
  g.player.hp = g.player.maxHp;

  // ---- 装备万花筒,鼠标指向玩家右侧 ----
  g.player.inv.selected = 0;
  g.player.inv.slots[0] = { id: idx, stack: 1 };
  g.input.mouseX = g.renderer.canvas.width / 2 + 200;
  g.input.mouseY = g.renderer.canvas.height / 2;

  const pool = g.vanillaDust.pool;
  const seen = new WeakMap();          // dust obj → uid
  const born = new Map();              // uid → {tick, isClone, noGravity0, maxScale, deadAt}
  let uid = 0;
  const sample = (tick) => {
    let alive = 0, clones = 0, mains = 0, maxScale = 0;
    for (const d of pool) {
      if (!d.active || d.type !== 267) continue;
      alive++;
      let u = seen.get(d);
      if (u === undefined) {
        u = ++uid; seen.set(d, u);
        const isClone = !!(d.color && d.color.r === 255 && d.color.g === 255 && d.color.b === 255);
        born.set(u, { tick, isClone, noGravity0: d.noGravity, maxScale: d.scale, deadAt: null });
      }
      const rec = born.get(u);
      if (d.scale > rec.maxScale) rec.maxScale = d.scale;
      rec.lastScale = d.scale;
      if (d.scale > maxScale) maxScale = d.scale;
      if (rec.isClone) clones++; else mains++;
    }
    return { alive, mains, clones, maxScale: +maxScale.toFixed(3) };
  };
  // 死亡标记:每拍扫 pool,born 记录 deadAt==null 且本拍不在活集 → deadAt=本拍
  const curve = [];
  const SWING_TICKS = 90, SETTLE_TICKS = 600;
  let prevAliveSet = new Set();
  const tickOnce = (t, swinging) => {
    if (swinging) { g.input.mouseDown = true; g.input.mouseHeld = true; }
    else { g.input.mouseDown = false; g.input.mouseHeld = false; }
    g.fixedUpdate(1 / 60);
    const s = sample(t);
    // 死亡判定:born 中 deadAt==null 且 uid 不在本拍活集 → 死于 t
    const aliveSet = new Set();
    for (const d of pool) if (d.active && d.type === 267) aliveSet.add(seen.get(d));
    for (const [u, rec] of born) {
      if (rec.deadAt === null && !aliveSet.has(u)) rec.deadAt = t;
    }
    void prevAliveSet;
    curve.push({ t, ...s });
  };
  for (let t = 0; t < SWING_TICKS; t++) tickOnce(t, true);
  for (let t = SWING_TICKS; t < SWING_TICKS + SETTLE_TICKS; t++) tickOnce(t, false);

  // ---- 汇总 ----
  const dusts = [...born.values()];
  const mains = dusts.filter((d) => !d.isClone);
  const clones = dusts.filter((d) => d.isClone);
  const lifeOf = (d) => d.deadAt === null ? null : d.deadAt - d.tick;
  const snapAt = (t) => curve[t];
  const snapshots = {};
  for (const t of [89, 105, 120, 150, 200, 300, 450, 600, 689]) snapshots[t] = curve[t];
  return {
    itemIdx: idx,
    projCtors: g.entities.projectiles.map((p) => p.constructor?.name).filter((n) => /Whip/.test(n || '')).length,
    totalSpawned: dusts.length,
    mains: { n: mains.length, noGravityTrue: mains.filter((d) => d.noGravity0).length,
      lifeMax: Math.max(...mains.map(lifeOf), -1), maxScale: +Math.max(...mains.map((d) => d.maxScale), 0).toFixed(3) },
    clones: { n: clones.length, noGravityTrue: clones.filter((d) => d.noGravity0).length,
      stillAliveAtEnd: clones.filter((d) => d.deadAt === null).length,
      lifeMax: Math.max(...clones.map(lifeOf), -1), maxScale: +Math.max(...clones.map((d) => d.maxScale), 0).toFixed(3) },
    snapshots,
    survivorsAt689: dusts.filter((d) => d.deadAt === null).length,
  };
});

writeFileSync(`${OUT}/probe.json`, JSON.stringify({ report, errors }, null, 2));
console.log('BJ700D_PROBE', JSON.stringify(report, null, 1));
console.log('PAGE_ERRORS', JSON.stringify(errors));
await browser.close();
