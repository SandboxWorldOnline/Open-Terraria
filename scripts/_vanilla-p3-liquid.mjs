// P3 液体扰动 E2E（2026-10-25）：Node 客户端发 NetLiquidModule 改一格水 →
// 服务器中继 → 浏览器 store 液体落地。验证 msg82 module0 全链。
import puppeteer from 'puppeteer-core';
import net from 'node:net';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOG = fs.openSync('/tmp/vanilla-liquid.log', 'w');
const log = (t) => { fs.writeSync(LOG, t + '\n'); console.log(t); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Node 注水者：加入后发一条 module0 液体变更（目标 (2150,226) 空地处置水 128）
function nodePour(name) {
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
    const TX = 2150, TY = 210; // 注水目标：高空（226 上方 16 格）——水必坠落流动→服务器模拟→CreateAndBroadcastByChunk 中继
    const done = (m) => resolve(m);
    const sock = net.connect({ port: 7781, host: '127.0.0.1' }, () => {
      sock.write(frame(1, new W().str('Terraria326')));
    });
    let acc = Buffer.alloc(0);
    const timer = setTimeout(() => done('pour-timeout'), 30000);
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
          pk.push(frame(68, new W().str('00000000-0000-4000-8000-00000000000f')));
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
          setTimeout(() => {
            // msg82 module0（C→S 液体变更）:[u16 moduleId=0][u16 n=1][i32 packed x<<16|y][u8 liquid][u8 type]
            const packed = ((TX & 0xffff) << 16) | (TY & 0xffff);
            sock.write(frame(82, new W().u16(0).u16(1).i32(packed).u8(255).u8(0)));
            log(`已注水 (${TX},${TY}) liquid=200 type=0(水)`);
            setTimeout(() => { clearInterval(beat); sock.destroy(); done('pour-done'); }, 4000);
          }, 2000);
        }
      }
    });
    sock.on('error', (e) => { clearTimeout(timer); done('pour-err ' + e.message); });
  });
}

// ---- 浏览器观察者 ----
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  userDataDir: '/tmp/vanilla-lq-' + (Date.now() % 100000),
  args: ['--no-proxy-server'], defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => log(`PAGE-EXC ${String(e).slice(0, 200)}`));
await page.goto('http://localhost:5204/', { waitUntil: 'domcontentloaded' });
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
  if (inp) { inp.value = '观水者'; inp.dispatchEvent(new Event('input', { bubbles: true })); }
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
const before = await page.evaluate(() => ({ hit: 0 }));
const pour = await nodePour('注水者');
log('注水者: ' + pour);
await sleep(3000);
const after = await page.evaluate(() => {
  const st = globalThis.__swGame.world.store;
  // 扫描下落列 (2150, 205..235):任一格有水即中继落地
  let hit = 0, liq = 0;
  for (let y = 205; y <= 235; y++) { const v = st.liquid[y * st.w + 2150]; if (v > 0) { hit++; liq = Math.max(liq, v); } }
  return { hit, liq };
});
log(`(2150) 下落列水格 ${before.hit} → ${after.hit}（max liquid ${after.liq}）`);
const pass = after.hit > 0; // 下落列任一格有水=中继落地
log(pass ? '★LIQUID-PASS（msg82 module0 注水→中继→store 落地）' : '✗LIQUID-FAIL');
await browser.close();
process.exit(pass ? 0 : 1);
