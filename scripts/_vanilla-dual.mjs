// 并联终极实验：同一页面、同一时刻、两条连接——裸逻辑 vs VanillaClient。
// 裸通+VC卡 → VC 连接的下行流有内容差异（抓字节对比）;同通/同卡 → 时序伪影。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOG = fs.openSync('/tmp/vanilla-dual.log', 'w');
const log = (t) => { fs.writeSync(LOG, t + '\n'); console.log(t); };

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  userDataDir: '/tmp/vanilla-dual-' + (Date.now() % 100000),
  args: ['--no-proxy-server'], defaultViewport: { width: 800, height: 600 },
});
const page = await browser.newPage();
page.on('console', (m) => log(`C ${m.text().slice(0, 130)}`));
page.on('pageerror', (e) => log(`EXC ${String(e).slice(0, 200)}`));
await page.goto('http://localhost:5204/vanilla-iso.html', { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 800));

const started = await page.evaluate(async () => {
  const mod = await import('/src/net/vanilla/VanillaClient.ts');
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
  const state = { bare129: false, vc129: false, bareMsgs: 0, vcMsgs: 0 };
  globalThis.__dual = state;

  // ---- 连接 A：裸逻辑（原样照抄通过的 bare 脚本）----
  {
    const ws = new WebSocket('ws://127.0.0.1:5290/?host=127.0.0.1&port=7781');
    ws.binaryType = 'arraybuffer';
    let slot = 0, spawned = false;
    ws.onopen = () => ws.send(frame(1, str('Terraria326')));
    ws.onmessage = (e) => {
      const chunk = new Uint8Array(e.data);
      if (!globalThis.__accA) globalThis.__accA = new Uint8Array(0);
      const prev = globalThis.__accA;
      const acc = new Uint8Array(prev.length + chunk.length);
      acc.set(prev); acc.set(chunk, prev.length);
      globalThis.__accA = acc;
      for (;;) {
        const a = globalThis.__accA;
        if (a.length < 2) break;
        const len = a[0] | (a[1] << 8);
        if (a.length < len) break;
        const id = a[2];
        state.bareMsgs++;
        if (id === 3) {
          slot = a[3];
          const empty5 = (sid) => frame(5, new Uint8Array([slot]), i16(sid), i16(0), new Uint8Array([0]), i16(0), new Uint8Array([0]));
          const pk = [];
          pk.push(frame(4, new Uint8Array([slot, 0, 0]), new Uint8Array(4), new Uint8Array([0]), str('BareProbe'), new Uint8Array([0, 0, 0]), new Uint8Array(21), new Uint8Array([0, 0, 0])));
          pk.push(frame(68, str('00000000-0000-4000-8000-000000000000')));
          pk.push(frame(16, new Uint8Array([slot]), i16(100), i16(100)));
          pk.push(frame(42, new Uint8Array([slot]), i16(20), i16(20)));
          pk.push(frame(50, new Uint8Array([slot]), i16(0)));
          pk.push(frame(147, new Uint8Array([slot, 0]), i16(0)));
          for (let i = 0; i < 59; i++) pk.push(empty5(i));
          const ranges = [[59, 20], [79, 10], [89, 5], [94, 5], [99, 40], [299, 40], [499, 1], [500, 40], [700, 40], [900, 20], [920, 10], [930, 20], [950, 10], [960, 20], [980, 10]];
          for (const [st, n] of ranges) for (let i = 0; i < n; i++) pk.push(empty5(st + i));
          pk.push(frame(6));
          for (const p of pk) ws.send(p);
        } else if (id === 7 && !spawned) {
          spawned = true;
          const dv = new DataView(a.buffer, a.byteOffset);
          const sx = dv.getInt16(3 + 4 + 1 + 1 + 4, true), sy = dv.getInt16(3 + 4 + 1 + 1 + 6, true);
          globalThis.__spawnA = [sx, sy];
          ws.send(frame(8, i32(sx), i32(sy), new Uint8Array([0])));
        } else if (id === 49 && !state.bare129) {
          const s = globalThis.__spawnA ?? [2105, 231];
          ws.send(frame(12, new Uint8Array([slot]), i16(s[0]), i16(s[1]), i32(0), i16(0), i16(0), new Uint8Array([0, 1])));
        } else if (id === 129) {
          state.bare129 = true;
          console.log('dual: bare ★129');
        }
        globalThis.__accA = a.subarray(len);
      }
    };
  }

  // ---- 连接 B：VanillaClient 实例 ----
  {
    const vc = new mod.VanillaClient({}, {
      onWorldReady: () => { state.vc129 = true; console.log('dual: vc ★129(onWorldReady)'); },
      onKick: (r) => console.log('dual: vc kicked ' + r),
    });
    globalThis.__dualVc = vc;
    // 静音 VanillaClient 的逐帧 console（防干扰对账）——替换 console.info
    const origInfo = console.info.bind(console);
    let infoMuted = false;
    console.info = (...a) => { if (!infoMuted) origInfo(...a); };
    vc.connect('ws://127.0.0.1:5290/?host=127.0.0.1&port=7781');
    infoMuted = true; // 连接启动后静音（只留 error）
    console.info = origInfo;
    console.info = () => { /* 静音 */ };
    const origErr = console.error.bind(console);
    console.error = (...a) => origErr('[vc]', ...a);
  }
  return 'ok';
}).catch((e) => 'err ' + e.message);
log('start: ' + started);

for (let i = 0; i < 15; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const st = await page.evaluate(() => {
    const s = globalThis.__dual;
    const vc = globalThis.__dualVc;
    const ws = vc ? vc.ws : null;
    // 终极解剖:包装 onmessage 数调用+dump 身份;补挂监听器+上行探针
    if (vc && !globalThis.__probe2 && !s.vc129) {
      globalThis.__probe2 = { evts: 0, omCalls: 0 };
      ws.addEventListener('message', () => { globalThis.__probe2.evts++; });
      const orig = ws.onmessage;
      globalThis.__omId = String(orig).slice(0, 60);
      ws.onmessage = (e) => { globalThis.__probe2.omCalls++; globalThis.__probe2.lastLen = e.data?.byteLength ?? -1; globalThis.__probe2.lens ??= []; globalThis.__probe2.lens.push(globalThis.__probe2.lastLen); if (orig) orig.call(ws, e); };
      try { ws.send(new Uint8Array([3, 0, 6])); } catch (e) { globalThis.__probe2.sendErr = String(e); }
    }
    return {
      ...s, vcDelivered: !!(vc?.gameWorld), vcSections: vc?.sectionsReceived ?? -1,
      probe2: globalThis.__probe2, omId: (globalThis.__omId ?? '').slice(0, 60), omNow: String(ws.onmessage).slice(0, 60),
      wsState: ws ? { ready: ws.readyState, bufAmt: ws.bufferedAmount, hasOnMsg: typeof ws.onmessage, ext: ws.extensions, proto: ws.protocol, url: ws.url } : 'null',
    };
  }).catch((e) => ({ err: String(e) }));
  log(`t+${i * 2}s ${JSON.stringify(st)}`);
  if (st.bare129 && st.vc129) { log('★DUAL-BOTH-PASS'); await browser.close(); process.exit(0); }
}
log('终态见上（bare129/vc129 分判）');
await browser.close();
process.exit(1);
