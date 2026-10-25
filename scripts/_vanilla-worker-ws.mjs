// Worker WS 可行性探针：裸握手逻辑跑进 Web Worker（blob URL,无独立文件）。
// 若 Worker 里 WS 走完 129 → Chrome 主线程派发停摆可绕道（架构绿灯）。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOG = fs.openSync('/tmp/vanilla-worker.log', 'w');
const log = (t) => { fs.writeSync(LOG, t + '\n'); console.log(t); };

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  userDataDir: '/tmp/vanilla-wk-' + (Date.now() % 100000),
  args: ['--no-proxy-server'], defaultViewport: { width: 800, height: 600 },
});
const page = await browser.newPage();
page.on('console', (m) => log(`C ${m.text().slice(0, 120)}`));
page.on('pageerror', (e) => log(`EXC ${String(e).slice(0, 200)}`));
await page.goto('http://localhost:5204/vanilla-iso.html', { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 600));

const started = await page.evaluate(() => {
  // Worker 内跑完整裸握手（字符串体,自包含）
  const workerSrc = `
    const enc = new TextEncoder();
    const str = (s) => { const e = enc.encode(s); const o = new Uint8Array(e.length + 1); o[0] = e.length; o.set(e, 1); return o; };
    const frame = (id, ...parts) => {
      const body = new Uint8Array(1 + parts.reduce((a, p) => a + p.length, 0));
      body[0] = id; let off = 1;
      for (const p of parts) { body.set(p, off); off += p.length; }
      const out = new Uint8Array(body.length + 2);
      new DataView(out.buffer).setUint16(0, out.length, true);
      out.set(body, 2);
      return out;
    };
    const i16 = (v) => { const o = new Uint8Array(2); new DataView(o.buffer).setInt16(0, v, true); return o; };
    const i32 = (v) => { const o = new Uint8Array(4); new DataView(o.buffer).setInt32(0, v, true); return o; };
    let acc = new Uint8Array(0);
    let slot = 0, spawned = false, spawn = [2105, 231];
    const ws = new WebSocket('ws://127.0.0.1:5290/?host=127.0.0.1&port=7781');
    ws.binaryType = 'arraybuffer';
    let count = 0;
    ws.onopen = () => ws.send(frame(1, str('Terraria326')));
    ws.onmessage = (e) => {
      const chunk = new Uint8Array(e.data);
      const n = new Uint8Array(acc.length + chunk.length);
      n.set(acc); n.set(chunk, acc.length); acc = n;
      for (;;) {
        if (acc.length < 2) break;
        const len = acc[0] | (acc[1] << 8);
        if (acc.length < len) break;
        const id = acc[2];
        count++;
        if (id === 3) {
          slot = acc[3];
          const empty5 = (sid) => frame(5, new Uint8Array([slot]), i16(sid), i16(0), new Uint8Array([0]), i16(0), new Uint8Array([0]));
          const pk = [];
          pk.push(frame(4, new Uint8Array([slot, 0, 0]), new Uint8Array(4), new Uint8Array([0]), str('WorkerProbe'), new Uint8Array([0, 0, 0]), new Uint8Array(21), new Uint8Array([0, 0, 0])));
          pk.push(frame(68, str('00000000-0000-4000-8000-00000000000a')));
          pk.push(frame(16, new Uint8Array([slot]), i16(100), i16(100)));
          pk.push(frame(42, new Uint8Array([slot]), i16(20), i16(20)));
          pk.push(frame(50, new Uint8Array([slot]), i16(0)));
          pk.push(frame(147, new Uint8Array([slot, 0]), i16(0)));
          for (let i = 0; i < 59; i++) pk.push(empty5(i));
          const ranges = [[59, 20], [79, 10], [89, 5], [94, 5], [99, 40], [299, 40], [499, 1], [500, 40], [700, 40], [900, 20], [920, 10], [930, 20], [950, 10], [960, 20], [980, 10]];
          for (const [st, n2] of ranges) for (let i = 0; i < n2; i++) pk.push(empty5(st + i));
          pk.push(frame(6));
          for (const p of pk) ws.send(p);
        } else if (id === 7 && !spawned) {
          spawned = true;
          const dv = new DataView(acc.buffer, acc.byteOffset);
          spawn = [dv.getInt16(3 + 4 + 1 + 1 + 4, true), dv.getInt16(3 + 4 + 1 + 1 + 6, true)];
          ws.send(frame(8, i32(spawn[0]), i32(spawn[1]), new Uint8Array([0])));
        } else if (id === 49) {
          ws.send(frame(12, new Uint8Array([slot]), i16(spawn[0]), i16(spawn[1]), i32(0), i16(0), i16(0), new Uint8Array([0, 1])));
        } else if (id === 129) {
          postMessage({ done: true, count });
          ws.close();
        }
        acc = acc.subarray(len);
      }
    };
    ws.onclose = () => postMessage({ done: false, count, closed: true });
    ws.onerror = () => postMessage({ done: false, count, err: true });
  `;
  const blob = new Blob([workerSrc], { type: 'application/javascript' });
  const worker = new Worker(URL.createObjectURL(blob));
  globalThis.__wk = { done: false, count: 0 };
  worker.onmessage = (e) => { globalThis.__wk = e.data; };
  return 'worker-started';
}).catch((e) => 'err ' + e.message);
log(started);

for (let i = 0; i < 15; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const st = await page.evaluate(() => globalThis.__wk).catch(() => null);
  log(`t+${i * 2}s ${JSON.stringify(st)}`);
  if (st?.done) { log('★WORKER-PASS:Worker WS 全链 129 到达——架构绿灯!'); await browser.close(); process.exit(0); }
  if (st?.closed || st?.err) break;
}
log('✗WORKER-FAIL:Worker 里同样停摆');
await browser.close();
process.exit(1);
