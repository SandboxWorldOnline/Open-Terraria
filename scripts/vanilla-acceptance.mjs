#!/usr/bin/env node
// P5 验收矩阵 v1（2026-10-25）：原版服直连全链验收——按序跑探针族,汇总 PASS/FAIL 矩阵。
// 用法（game/ 下）：node tools/run-diag.mjs scripts/vanilla-acceptance.mjs [--only 关键词]
// 依赖：rig(7781)+桥(5290)+vite(5204) 在跑（见 memory vanilla-server-interop-scope 卫生节）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';

const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;

// ---- 矩阵面（探针 → 验收面）----
const MATRIX = [
  { key: 'duo', label: 'P1 互见/NPC/聊天（双人 E2E）', script: 'scripts/_vanilla-p1-duo.mjs', timeout: 420 },
  { key: 'verify', label: 'P1-B 伤害流+P3 挖格/掉落傀儡', script: 'scripts/_vanilla-p1-verify.mjs', timeout: 300 },
  { key: 'strike', label: 'P2-A 打击上报（msg28+162ack）', script: 'scripts/_vanilla-p2-strike.mjs', timeout: 300 },
  { key: 'proj', label: 'P2 弹幕上传+中继（我方键 msg27）', script: 'scripts/_vanilla-p1-upload.mjs', timeout: 300 },
  { key: 'relay', label: 'P2 弹幕中继（角色互换双键）', script: 'scripts/_vanilla-p2-relay.mjs', timeout: 300 },
  { key: 'chest', label: 'P3-C 箱子开箱（40 槽内容）', script: 'scripts/_vanilla-p3-chest.mjs', timeout: 300 },
  { key: 'pvp', label: 'P2-F PvP 实战（双开 hostile 互打）', script: 'scripts/_vanilla-p2-pvp.mjs', timeout: 420 },
  { key: 'liquid', label: 'P3-B 液体扰动（注水→模拟→中继→store）', script: 'scripts/_vanilla-p3-liquid.mjs', timeout: 300 },
  // ★BJ755-A T3（2026-11-02）：P3-D 回城药双锚+远端门（g36a D-⑫/bj738a D3 尾款 rig 验收）
  //   ——探针顺带 T1 msg50/T2 msg66 实弹（三账判据见 _vanilla-p3-por.mjs 头注）。
  { key: 'por', label: 'P3-D 回城药双锚+远端门（msg13 c3[2]/[6]）', script: 'scripts/_vanilla-p3-por.mjs', timeout: 420 },
];

// 前置检查：桥+rig 端口
function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1', timeout: 1500 }, () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.on('timeout', () => { s.destroy(); resolve(false); });
  });
}

const log = (t) => console.log(t);
const results = [];

log('=== P5 验收矩阵 v1（原版服直连全链） ===');
if (!(await portOpen(5290))) { log('✗ 桥 5290 不在——server/ 下 npx tsx src/vanillaBridge.ts --port 5290'); process.exit(2); }
if (!(await portOpen(7781))) { log('✗ rig 7781 不在——rig-vanilla-1458/start.sh'); process.exit(2); }
log('前置：桥+rig 在线 ✓');

for (const item of MATRIX) {
  if (ONLY && !item.key.includes(ONLY) && !item.label.includes(ONLY)) continue;
  log(`\n▶ [${item.key}] ${item.label}`);
  const t0 = Date.now();
  const pass = await new Promise((resolve) => {
    // ★BJ755-A：--timeout 透传 run-diag（其缺省看门狗 120s 会截杀 >2min 的探针——
    //   旧矩阵容许 timeout 300/420 但从未生效,长探针（por/duo/pvp）全靠跑得快侥幸）
    const p = spawn('node', ['tools/run-diag.mjs', `--timeout=${item.timeout * 1000}`, item.script], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); resolve(false); }, item.timeout * 1000);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => { clearTimeout(timer); resolve(code === 0); });
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(0);
  results.push({ ...item, pass, dt });
  log(pass ? `  ✓ PASS (${dt}s)` : `  ✗ FAIL (${dt}s)`);
}

log('\n==== 验收矩阵汇总 ====');
let ok = 0;
for (const r of results) {
  log(`${r.pass ? '✓' : '✗'} [${r.key}] ${r.label} (${r.dt}s)`);
  if (r.pass) ok++;
}
log(`\n${ok}/${results.length} 面通过`);
fs.writeFileSync('/tmp/vanilla-acceptance.json', JSON.stringify({ t: Date.now(), results }, null, 1));
process.exit(ok === results.length ? 0 : 1);
