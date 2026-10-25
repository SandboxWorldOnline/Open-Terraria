// 联机卡顿归因探针（2026-10-25）：浏览器在场 + Node 第二客户端持续挖放置（模拟他人活动）
// → 量化帧时间/消息率/光照快进次数/段请求次数的关系。
import puppeteer from 'puppeteer-core';
import net from 'node:net';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOG = fs.openSync('/tmp/vanilla-perf.log', 'w');
const log = (t) => { fs.writeSync(LOG, t + '\n'); console.log(t); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Node 忙碌客户端：加入后持续挖+放置（每 500ms 一轮:挖一格+放一火把）
function nodeBusy(name, runMs) {
  return new Promise((resolve) => {
    class W {
      constructor() { this.b = []; }
      u8(v) { this.b.push(v & 0xff); return this; }
      u16(v) { this.b.push(v & 0xff, (v >> 8) & 0xff); return this; }
      i16(v) { return this.u16(v < 0 ? v + 0x10000 : v); }
      i32(v) { return this.u32(v < 0 ? v + 0x100000000 : v); }
      u32(v) { this.b.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); return this; }
      f32(v) { const b = Buffer.alloc(4); b.writeFloatLE(v, 0); this.b.push(...b); return this; }
      str(s) { const e = Buffer.from(s, 'utf8'); this.b.push(e.length, ...e); return this; }
      get buf() { return Buffer.from(this.b); }
    }
    const frame = (id, w) => {
      const body = Buffer.concat([Buffer.from([id]), w ? w.buf : Buffer.alloc(0)]);
      const h = Buffer.alloc(2);
      h.writeUInt16LE(body.length + 2, 0);
      return Buffer.concat([h, body]);
    };
    const ARRAYS = [[59, 20], [79, 10], [89, 5], [94, 5], [99, 40], [299, 40], [499, 1], [500, 40], [700, 40], [900, 20], [920, 10], [930, 20], [950, 10], [960, 20], [980, 10]];
    let slot = 0, spawn = [2105, 231], sentSpawn = false, joined = false;
    const done = (m) => resolve(m);
    const sock = net.connect({ port: 7781, host: '127.0.0.1' }, () => {
      sock.write(frame(1, new W().str('Terraria326')));
    });
    let acc = Buffer.alloc(0);
    const timer = setTimeout(() => done('busy-timeout'), runMs + 30000);
    sock.on('data', (d) => {
      acc = Buffer.concat([acc, d]);
      while (acc.length >= 2) {
        const len = acc.readUInt16LE(0);
        if (len < 3 || acc.length < len) break;
        const id = acc[2];
        const p = acc.subarray(3, len);
        acc = acc.subarray(len);
        if (id === 3) {
          slot = p[0];
          const pk = [];
          pk.push(frame(4, new W().u8(slot).u8(0).u8(0).f32(0).u8(0).str(name).u8(0).u16(0).u8(0)
            .u8(28).u8(222).u8(255).u8(255).u8(191).u8(143).u8(113).u8(60).u8(37).u8(175).u8(105).u8(47).u8(160).u8(110).u8(80).u8(40).u8(86).u8(120).u8(120).u8(90).u8(60).u8(0).u8(0).u8(0)));
          pk.push(frame(68, new W().str('00000000-0000-4000-8000-000000000010')));
          pk.push(frame(16, new W().u8(slot).i16(100).i16(100)));
          pk.push(frame(42, new W().u8(slot).i16(20).i16(20)));
          pk.push(frame(50, new W().u8(slot).u16(0)));
          pk.push(frame(147, new W().u8(slot).u8(0).u16(0)));
          const e5 = (sid) => frame(5, new W().u8(slot).i16(sid).i16(0).u8(0).i16(0).u8(0));
          for (let i = 0; i < 59; i++) pk.push(e5(i));
          for (const [st, n] of ARRAYS) for (let i = 0; i < n; i++) pk.push(e5(st + i));
          pk.push(frame(6));
          for (const f of pk) sock.write(f);
        } else if (id === 7 && !sentSpawn) {
          sentSpawn = true;
          spawn = [p.readInt16LE(10), p.readInt16LE(12)];
          sock.write(frame(8, new W().i32(spawn[0]).i32(spawn[1]).u8(0)));
        } else if (id === 49) {
          sock.write(frame(12, new W().u8(slot).i16(spawn[0]).i16(spawn[1]).i32(0).i16(0).i16(0).u8(0).u8(1)));
        } else if (id === 129 && !joined) {
          joined = true;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sock.write(frame(159, new W().i16(10 + dx).i16(1 + dy)));
          const beat = setInterval(() => {
            if (sock.destroyed) { clearInterval(beat); return; }
            sock.write(frame(13, new W().u8(slot).u8(0).u8(0).u8(0).u8(0).u8(0).f32(spawn[0] * 16).f32(spawn[1] * 16)));
          }, 100);
          // 忙碌循环:每 400ms 挖一格地表 + 放一个火把（framed!）——模拟他人建房挖掘
          let cx = 2140;
          const busy = setInterval(() => {
            if (sock.destroyed) { clearInterval(busy); return; }
            cx += 2; if (cx > 2160) cx = 2140; // 观察者视口内徘徊（观察者@2105,视口~80 格）
            sock.write(frame(17, new W().u8(0).i16(cx).i16(230).i16(0).u8(0)));            // 挖
            sock.write(frame(17, new W().u8(1).i16(cx).i16(229).i16(4).u8(0)));            // 放火把(framed)
          }, 400);
          setTimeout(() => { clearInterval(beat); clearInterval(busy); sock.destroy(); done('busy-done'); }, runMs);
        }
      }
    });
    sock.on('error', (e) => { clearTimeout(timer); done('busy-err ' + e.message); });
  });
}

// ---- 浏览器观察者 ----
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  userDataDir: '/tmp/vanilla-pf-' + (Date.now() % 100000),
  args: ['--no-proxy-server'], defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => log(`PAGE-EXC ${String(e).slice(0, 200)}`));
await page.goto('http://localhost:5204/?vdump=perf', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 40; i++) {
  await sleep(1000);
  const ready = await page.evaluate(() => {
    const el = document.querySelector('[data-act=mp]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    if (!hit || !(el === hit || el.contains(hit))) return null;
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (ready) { await page.mouse.click(ready.x, ready.y); break; }
}
for (let i = 0; i < 12; i++) {
  if (await page.evaluate(() => !!Array.from(document.querySelectorAll('input')).find((x) => x.value === '127.0.0.1:7781'))) break;
  await sleep(800);
}
{
  const vb = await page.evaluate(() => {
    const input = Array.from(document.querySelectorAll('input')).find((x) => x.value === '127.0.0.1:7781');
    const btn = input?.closest('div')?.querySelector('button');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (vb) await page.mouse.click(vb.x, vb.y);
}
for (let i = 0; i < 10; i++) {
  if (await page.evaluate(() => !!document.querySelector('[data-act=new]'))) break;
  await sleep(800);
}
{
  const nb = await page.evaluate(() => {
    const el = document.querySelector('[data-act=new]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (nb) { await page.mouse.click(nb.x, nb.y); await sleep(2500); }
}
await page.evaluate(() => {
  const inp = document.querySelector('.sw-cc-nameval input[type=text], .sw-char-panel input[type=text]');
  if (inp) { inp.value = '性能观察者'; inp.dispatchEvent(new Event('input', { bubbles: true })); }
});
await sleep(500);
for (let i = 0; i < 15; i++) {
  if (await page.evaluate(() => !!document.querySelector('[data-act=create]'))) break;
  await sleep(800);
}
{
  const cb = await page.evaluate(() => {
    const el = document.querySelector('[data-act=create]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (cb) await page.mouse.click(cb.x, cb.y);
}
let entered = false;
for (let i = 0; i < 50; i++) {
  await sleep(1000);
  entered = await page.evaluate(() => !!(globalThis.__swGame?.net?.active && globalThis.__swGame?.player)).catch(() => false);
  if (entered) break;
}
log('观察者进世界=' + entered);
if (!entered) { await browser.close(); process.exit(1); }
await sleep(5000);
{
  const wb = await page.evaluate(() => {
    const btn = document.getElementById('sw-welcome-announce')?.querySelector('button');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (wb) { await page.mouse.click(wb.x, wb.y); await sleep(1500); }
}

// 仪表：帧时间分布 + 消息率 + 光照 dirty 次数 + 段请求计数
await page.evaluate(() => {
  const g = globalThis.__swGame;
  globalThis.__pf = { frames: [], msgHist: {}, lightDirty: 0, secReq: 0 };
  // 帧时间（rAF 间隔分布）
  let last = performance.now();
  const tick = (t) => {
    globalThis.__pf.frames.push(Math.round(t - last));
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // 消息率
  const orig = g.net.handle.bind(g.net);
  g.net.handle = (id, p2) => { globalThis.__pf.msgHist[id] = (globalThis.__pf.msgHist[id] || 0) + 1; return orig(id, p2); };
  // 光照 dirty 计数（setter 代理）
  const L = g.lighting;
  let _d = L.dirty;
  Object.defineProperty(L, 'dirty', {
    get: () => _d,
    set: (v) => { if (v && !_d) globalThis.__pf.lightDirty++; _d = v; },
    configurable: true,
  });
  // 段请求计数
  const origReq = g.net.requestSection.bind(g.net);
  g.net.requestSection = (x, y) => { globalThis.__pf.secReq++; return origReq(x, y); };
});

// 基线（无他人活动）10s
log('--- 基线窗（无他人活动）10s ---');
await sleep(10000);
const base = await page.evaluate(() => {
  const pf = globalThis.__pf;
  const sorted = [...pf.frames].sort((a, b) => a - b);
  const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  return { n: sorted.length, p50: p(0.5), p95: p(0.95), max: sorted[sorted.length - 1], msgs: { ...pf.msgHist }, lightDirty: pf.lightDirty, secReq: pf.secReq };
});
await page.evaluate(() => { globalThis.__pf.frames = []; globalThis.__pf.msgHist = {}; globalThis.__pf.lightDirty = 0; globalThis.__pf.secReq = 0; });
log(JSON.stringify(base));

// 忙碌窗（他人持续挖+放置）20s
log('--- 忙碌窗（Node 客户端每 400ms 挖+放火把）20s ---');
const busy = nodeBusy('忙碌者', 20000);
await busy;
await sleep(2000);
const busyStats = await page.evaluate(() => {
  const pf = globalThis.__pf;
  const sorted = [...pf.frames].sort((a, b) => a - b);
  const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  return { n: sorted.length, p50: p(0.5), p95: p(0.95), max: sorted[sorted.length - 1], msgs: { ...pf.msgHist }, lightDirty: pf.lightDirty, secReq: pf.secReq };
});
log(JSON.stringify(busyStats));
// 差分报告
const msgSum = (h) => Object.values(h).reduce((a, b) => a + b, 0);
log(`\n帧时间 p50/p95/max: 基线 ${base.p50}/${base.p95}/${base.max}ms → 忙碌 ${busyStats.p50}/${busyStats.p95}/${busyStats.max}ms`);
log(`消息率: 基线 ${msgSum(base.msgs)}/20s窗 → 忙碌 ${msgSum(busyStats.msgs)}/22s窗; msg17=${busyStats.msgs['17'] ?? 0} msg20=${busyStats.msgs['20'] ?? 0} msg21=${busyStats.msgs['21'] ?? 0} msg13=${busyStats.msgs['13'] ?? 0} msg23=${busyStats.msgs['23'] ?? 0}`);
log(`光照 dirty 置位: 基线 ${base.lightDirty} → 忙碌 ${busyStats.lightDirty}; 段请求: ${base.secReq} → ${busyStats.secReq}`);
await browser.close();
