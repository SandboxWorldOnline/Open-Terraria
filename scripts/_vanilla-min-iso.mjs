// 最小隔离实验：绕开 makeGame/Game/loadWorld/UI——纯 VanillaClient 在浏览器里经桥连 rig。
// 若 129 到达 → 卡点在 Game 集成层;若不到 → VanillaClient/Chrome WS 传输层。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOG = fs.openSync('/tmp/vanilla-min-iso.log', 'w');
const log = (t) => { fs.writeSync(LOG, t + '\n'); console.log(t); };

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: false,
  userDataDir: '/tmp/vanilla-iso-' + (Date.now() % 100000),
  args: ['--no-proxy-server'], defaultViewport: { width: 800, height: 600 },
});
const page = await browser.newPage();
const CDP = await page.createCDPSession();
await CDP.send('Network.enable');
let cdpFrames = 0;
const cdpByConn = new Map();
CDP.on('Network.webSocketFrameReceived', (f) => {
  cdpFrames++;
  const k = f.requestId;
  cdpByConn.set(k, (cdpByConn.get(k) ?? 0) + 1);
  if (cdpFrames <= 4 || cdpFrames % 200 === 0) log(`CDP-WS-RECV #${cdpFrames} conn=${String(k).slice(-6)} opcode=${f.response.opcode} len=${f.response.payloadData?.length ?? '?'}`);
});
CDP.on('Network.webSocketClosed', () => log(`CDP-WS-CLOSED 网络层共收 ${cddpSafe()} 帧`));
function cddpSafe() { return cdpFrames; }
page.on('console', (m) => log(`CONSOLE[${m.type()}] ${m.text().slice(0, 160)}`));
page.on('pageerror', (e) => log(`PAGE-EXC ${String(e).slice(0, 200)}`));

// vite 5204 根页（无 ?vanilla 参数=不触发 autoJoin;标题菜单自转,与实验无关）
await page.goto('http://localhost:5204/vanilla-iso.html', { waitUntil: 'domcontentloaded' }).catch((e) => log('goto: ' + e.message));
await new Promise((r) => setTimeout(r, 2000));
const MODE = ['skipworld','skipdecode','skipboth','bareloop'].includes(process.argv[process.argv.length-1]) ? process.argv[process.argv.length-1] : 'full'; // full | skipworld | skipdecode | skipboth
log('MODE=' + MODE);
const result = await page.evaluate(async (mode) => {
  const mod = await import('/src/net/vanilla/VanillaClient.ts');
  mod.VAN_ISO_FLAGS.skipWorld = mode === 'skipworld' || mode === 'skipboth';
  mod.VAN_ISO_FLAGS.skipDecode = mode === 'skipdecode' || mode === 'skipboth';
  mod.VAN_ISO_FLAGS.bareLoop = mode === 'bareloop';
  const vc = new mod.VanillaClient({}, {
    onWorldReady: (w) => console.info('[iso] onWorldReady!', w.name, w.w + 'x' + w.h),
    onProgress: (l, p) => { if (p >= 1) console.info('[iso] progress done'); },
    onKick: (r) => console.info('[iso] kicked:', r),
  });
  (globalThis).__isoVc = vc;
  vc.connect('ws://127.0.0.1:5290/?host=127.0.0.1&port=7781');
  return 'started';
}, MODE).catch((e) => 'eval-err: ' + e.message);
log('EVAL ' + result);
for (let i = 0; i < 16; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  // ★第 10 秒:VC1 若已死,同页面开第二个 VanillaClient
  if (i === 5) {
    await page.evaluate(async () => {
      const mod = await import('/src/net/vanilla/VanillaClient.ts');
      const vc2 = new mod.VanillaClient({ player: { appearance: { name: 'IsoTwo' } } }, {
        onWorldReady: () => console.info('[iso2] ★129!'),
        onKick: (r) => console.info('[iso2] kicked ' + r),
      });
      globalThis.__isoVc2 = vc2;
      vc2.connect('ws://127.0.0.1:5290/?host=127.0.0.1&port=7781');
      console.info('[iso2] 第二连接已开');
    }).catch((e) => log('iso2-err ' + e.message));
  }
  const st = await page.evaluate(() => {
    const vc = globalThis.__isoVc;
    const vc2 = globalThis.__isoVc2;
    return {
      v1: vc ? { active: vc.active, worldDelivered: !!(vc.gameWorld), sections: vc.sectionsReceived } : null,
      v2: vc2 ? { active: vc2.active, worldDelivered: !!(vc2.gameWorld), sections: vc2.sectionsReceived } : null,
    };
  }).catch(() => null);
  log(`t+${i * 2}s ${JSON.stringify(st)} cdpFrames=${cdpFrames}`);
  if (st?.v1?.worldDelivered || st?.v2?.worldDelivered) { log('★ISO-PASS 129 到达（纯 VanillaClient 浏览器路径通）'); await browser.close(); process.exit(0); }
}
log('✗ISO-FAIL 32s 未达 129');
await browser.close();
process.exit(1);
