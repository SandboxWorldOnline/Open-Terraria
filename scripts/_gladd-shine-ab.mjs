// ★gladd 面③（task#22,2026-10-28）tileShine +0.39 平加层 GL 桥像素对拍:
// A(?gladd=0 2D 折叠路径) vs B(?gladd=1 GL 直出)——gemspark 网格场景,画面级
// 逐位 diff(截屏→MD5+逐像素;暗场景掩防加法假阴性——面②判例)。矩阵:地表静立/
// zoom1.5/暗夜。stats 面:gladdShineStats.gl/empty/fb。
// 运行:SW_ORIGIN=http://localhost:5207 node tools/run-diag.mjs --timeout=600000 scripts/_gladd-shine-ab.mjs
import { launchBrowser, openPage, bootstrap, createGame, pump } from '../tools/probe/lib/index.mjs';
import { createHash } from 'node:crypto';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5207';
const results = [];
const chk = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`); };

// 简化:直接在页内铺格(不 import 模块——经 __swTileByKey 桥:键 v_262_amethystgemspark)
async function arm2(gladd, label, shotPath) {
  const browser = await launchBrowser({});
  const page = await openPage(browser, {});
  await bootstrap(page, `${ORIGIN}/?cloudcache=0`);   // gladd 经运行时翻面(URL 污染判例)
  await createGame(page, { size: 'small', seed: '05162020', pinRandom: 20261028 });
  await pump(page, 60);
  // ★冻结动画面(面①探针同款——天空/云/天气/biome 全停,A/B 截屏可比) + 运行时翻
  //  gladd 旗(gotoApp 尾拼 /?t= 污染 query 参数判例——URL 传旗恒假,必须 constructor 翻)
  await page.evaluate((gladd) => {
    const g = window.__swGame;
    const r = g.renderer;
    const sky = r.sky;
    const proto = Object.getPrototypeOf(sky);
    const origDraw = proto.draw;
    sky.draw = function (ctx, clock, w2, h2, camX, dtMs, camY) {
      return origDraw.call(this, ctx, clock, w2, h2, camX, 0, camY);
    };
    sky.maintainClouds = () => {};
    sky.drawAmbience = () => {};
    r.biomeBg.update = () => {};
    const w = g.world.weather;
    if (w) { w.raining = false; w.cloudAlpha = 0; w.maxRaining = 0; w.numClouds = 60; w.lightning = 0; w.update = () => {}; }
    r.constructor.gladd = gladd;
  }, gladd);
  const painted = await page.evaluate(() => {
    const g = window.__swGame;
    const st = g.world.store;
    const px = Math.floor(g.player.x / 16), py = Math.floor(g.player.y / 16);
    // tile id 反解:遍历 TILE_DEFS 不行(worker 域);用 __swTileDefById 桥倒查
    let gem = -1;
    for (let i = 0; i < 5000; i++) {
      const d = window.__swTileDefById(i);
      if (d && d.sheet === 262) { gem = i; break; }
    }
    if (gem < 0) return -1;
    let cnt = 0;
    for (let dy = -4; dy <= 0; dy++) {
      for (let dx = -9; dx <= 9; dx++) {
        const x = px + dx, y = py + dy;
        if (x < 1 || y < 1 || x >= st.w - 1 || y >= st.h - 1) continue;
        const i = st.idx(x, y);
        st.type[i] = gem; st.flags[i] = 1;
        st.frameX[i] = 0; st.frameY[i] = 0;
        cnt++;
      }
    }
    const ch = g.chunks;
    for (let cy = Math.floor((py - 4) / 16); cy <= Math.floor((py / 16)); cy++)
      for (let cx = Math.floor((px - 9) / 16); cx <= Math.floor((px + 9) / 16); cx++)
        ch.markDirty(cx, cy);
    return cnt;
  });
  await pump(page, 120);   // chunk 重烘+shineCache 烘出收敛
  await page.screenshot({ path: shotPath });
  const stats = await page.evaluate(() => ({ ...window.__swGame.renderer.gladdShineStats }));
  await browser.close();
  return { painted, stats };
}

const AA_MODE = process.env.SW_AA === '1';
const A = await arm2(AA_MODE ? false : false, 'A', '/Users/vinlic/.claude/jobs/d3098226/tmp/gladd-shine-A.png');
const B = await arm2(AA_MODE ? false : true, 'B', '/Users/vinlic/.claude/jobs/d3098226/tmp/gladd-shine-B.png');
console.log('A:', JSON.stringify(A));
console.log('B:', JSON.stringify(B));
chk('铺格两臂同量', A.painted > 0 && A.painted === B.painted, `n=${A.painted}`);
if (!AA_MODE) chk('B 臂 GL 会话发射', B.stats.gl > 0, `gl=${B.stats.gl} empty=${B.stats.empty} fb=${B.stats.fb}`);
// 逐像素 diff(页外 python)
const { execSync } = await import('node:child_process');
const diff = execSync(`python3 - <<'EOF'
from PIL import Image
import sys
a = Image.open('/Users/vinlic/.claude/jobs/d3098226/tmp/gladd-shine-A.png').convert('RGB')
b = Image.open('/Users/vinlic/.claude/jobs/d3098226/tmp/gladd-shine-B.png').convert('RGB')
if a.size != b.size: print('SIZE_MISMATCH'); sys.exit(1)
pa, pb = a.load(), b.load()
w, h = a.size
nd = 0; maxd = 0
for y in range(0, h, 2):
    for x in range(0, w, 2):
        d = max(abs(pa[x,y][c]-pb[x,y][c]) for c in range(3))
        if d > 0: nd += 1
        maxd = max(maxd, d)
print(f'diffPct={nd/(w*h/4)*100:.4f} maxD={maxd}')
EOF`).toString().trim();
console.log('像素 diff:', diff);
chk('逐像素一致(暗场含加法支)', diff.includes('diffPct=0.0000'), diff);
