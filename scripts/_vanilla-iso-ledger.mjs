// 三账对照探针（停摆定位终审,2026-10-25）：
//   桥下行账（/tmp/vbridge-<dump>.log,服务器发了什么）
//   vs CDP Network.webSocketFrameReceived（Chrome 网络层收了什么）
//   vs VC.processedCount/recentIds（JS 处理了什么）。
// 用法：node tools/run-diag.mjs scripts/_vanilla-iso-ledger.mjs [dump名] [VC|bare]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DUMP = process.argv.includes('bare') ? 'live-bare' : 'vc1';
const MODE = process.argv.includes('bare') ? 'bare' : 'vc';
const LOG = fs.openSync(`/tmp/vanilla-ledger-${DUMP}.log`, 'w');
const log = (t) => { fs.writeSync(LOG, t + '\n'); console.log(t); };

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  userDataDir: '/tmp/vanilla-lg-' + (Date.now() % 100000),
  args: ['--no-proxy-server'], defaultViewport: { width: 800, height: 600 },
});
const page = await browser.newPage();
const CDP = await page.createCDPSession();
await CDP.send('Network.enable');
let cdpFrames = 0; let cdpBytes = 0; let cdpLast = 0;
CDP.on('Network.webSocketFrameReceived', (f) => {
  cdpFrames++; cdpBytes += f.response.payloadData?.length ?? 0; cdpLast = Date.now();
});
page.on('console', (m) => log(`C[${m.type()}] ${m.text().slice(0, 200)}`));
page.on('pageerror', (e) => log(`PAGE-EXC ${String(e).slice(0, 300)}`));
await page.goto('http://localhost:5204/vanilla-iso.html', { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 800));

const URL = `ws://127.0.0.1:5290/?host=127.0.0.1&port=7781&dump=${DUMP}`;
log(`MODE=${MODE} dump=${DUMP} url=${URL}`);
if (MODE === 'vc') {
  const r = await page.evaluate(async (url) => {
    const mod = await import('/src/net/vanilla/VanillaClient.ts');
    const vc = new mod.VanillaClient({ player: { appearance: { name: 'VcLedger' } } }, {
      onWorldReady: (w) => console.info('[lg] ★onWorldReady', w.name),
      onKick: (rs) => console.info('[lg] kicked:', rs),
    });
    globalThis.__lg = vc;
    vc.connect(url);
    return 'vc-started';
  }, URL).catch((e) => 'err ' + e.message);
  log('EVAL ' + r);
} else {
  const r = await page.evaluate((url) => {
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
    let acc = new Uint8Array(0), slot = 0, spawned = false, spawn = [0, 0];
    const st = { count: 0, done: false, closed: false };
    globalThis.__bare = st;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
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
        st.count++;
        if (id === 3) {
          slot = acc[3];
          const e5 = (sid) => frame(5, new Uint8Array([slot]), i16(sid), i16(0), new Uint8Array([0]), i16(0), new Uint8Array([0]));
          const pk = [frame(4, new Uint8Array([slot, 0, 0]), new Uint8Array(4), new Uint8Array([0]), str('BareLedger'), new Uint8Array([0, 0, 0]), new Uint8Array(21), new Uint8Array([0, 0, 0]))];
          pk.push(frame(68, str('00000000-0000-4000-8000-00000000000b')));
          pk.push(frame(16, new Uint8Array([slot]), i16(100), i16(100)));
          pk.push(frame(42, new Uint8Array([slot]), i16(20), i16(20)));
          pk.push(frame(50, new Uint8Array([slot]), i16(0)));
          pk.push(frame(147, new Uint8Array([slot, 0]), i16(0)));
          for (let i = 0; i < 59; i++) pk.push(e5(i));
          for (const [s2, n2] of [[59,20],[79,10],[89,5],[94,5],[99,40],[299,40],[499,1],[500,40],[700,40],[900,20],[920,10],[930,20],[950,10],[960,20],[980,10]])
            for (let i = 0; i < n2; i++) pk.push(e5(s2 + i));
          pk.push(frame(6));
          for (const p of pk) ws.send(p);
        } else if (id === 7 && !spawned) {
          spawned = true;
          const dv = new DataView(acc.buffer, acc.byteOffset);
          spawn = [dv.getInt16(13, true), dv.getInt16(15, true)];
          ws.send(frame(8, i32(spawn[0]), i32(spawn[1]), new Uint8Array([0])));
        } else if (id === 49) {
          ws.send(frame(12, new Uint8Array([slot]), i16(spawn[0]), i16(spawn[1]), i32(0), i16(0), i16(0), new Uint8Array([0, 1])));
        } else if (id === 129) { st.done = true; console.info('[bare] ★129!'); }
        acc = acc.subarray(len);
      }
    };
    ws.onclose = () => { st.closed = true; };
    return 'bare-started';
  }, URL).catch((e) => 'err ' + e.message);
  log('EVAL ' + r);
}

for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const st = MODE === 'vc'
    ? await page.evaluate(() => {
        const vc = globalThis.__lg;
        return vc ? {
          active: vc.active, wsMsg: vc.wsMsgCount, processed: vc.processedCount,
          recent: vc.recentIds.slice(-12), worldDelivered: !!vc.gameWorld,
          sections: vc.sectionsReceived,
        } : null;
      }).catch((e) => String(e))
    : await page.evaluate(() => globalThis.__bare).catch((e) => String(e));
  log(`t+${i * 2}s JS=${JSON.stringify(st)} cdpFrames=${cdpFrames} cdpBytes=${cdpBytes}`);
  if (MODE === 'vc' && st?.worldDelivered) { log('★VC-PASS'); break; }
  if (MODE === 'bare' && st?.done) { log('★BARE-PASS'); break; }
}
await new Promise((r) => setTimeout(r, 1000));
log(`终账: cdpFrames=${cdpFrames} cdpBytes=${cdpBytes} lastRecvAgo=${Date.now() - cdpLast}ms`);
await browser.close();
process.exit(0);
