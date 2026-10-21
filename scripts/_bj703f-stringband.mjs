// ★BJ703-F 探针:悠悠球线/渔线 flatten 保形实拍(私有 vite,浏览器真贴图+真合成管线)
// 判据:FishingLine.png 12×12 仅列 5/6 不透明 → 修复后线带宽 ≈2px;
// 对照组(摊平 flatten=true + 'lighter' 旧形态,手动复刻)线带宽 =12px(染色带回潮)。
import { launchBrowser, openPage, bootstrap, createGame, ledger } from '../tools/probe/lib/index.mjs';
const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5199';
const L = ledger();
const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, ORIGIN + '/');
await createGame(page, { mode: 'direct', seed: '05162020', size: 'small' });

const out = await page.evaluate(async () => {
  const g = window.__swGame;
  const { drawYoyoStringLine, drawFishingStringLine, tintedTex } = await import('/src/render/StringLine.ts');
  // 纹理获取:先轮询 atlas ensureVImage(懒加载首调只触发 fetch),超时回退直挂
  // /sprites/vanilla/FishingLine.png(同字节资产,像素形状判据等价)
  let tex = null;
  for (let i = 0; i < 20 && !(tex && tex.width > 0); i++) {
    tex = g.renderer?.atlas?.ensureVImage?.('vanilla/FishingLine.png') ?? tex;
    if (!(tex && tex.width > 0)) await new Promise((r) => setTimeout(r, 300));
  }
  if (!(tex && tex.width > 0)) {
    tex = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = '/sprites/vanilla/FishingLine.png';
    });
  }
  if (!tex || !(tex.width > 0)) return { ok: false, why: 'FishingLine 贴图未就绪' };

  // 列剖面:画布 48×48 黑底,返回每列「非黑像素数」
  const columnProfile = (paint) => {
    const cv = document.createElement('canvas');
    cv.width = 48; cv.height = 48;
    const c = cv.getContext('2d');
    c.fillStyle = '#000'; c.fillRect(0, 0, 48, 48);
    c.imageSmoothingEnabled = false;
    paint(c);
    const d = c.getImageData(0, 0, 48, 48).data;
    const cols = [];
    for (let x = 0; x < 48; x++) {
      let n = 0;
      for (let y = 0; y < 48; y++) {
        const o = (y * 48 + x) * 4;
        if (d[o] + d[o + 1] + d[o + 2] > 12) n++;
      }
      cols.push(n);
    }
    return cols;
  };
  const bandWidth = (cols) => {
    const nz = cols.map((n, x) => (n > 0 ? x : -1)).filter((x) => x >= 0);
    return nz.length ? (nz[nz.length - 1] - nz[0] + 1) : 0;
  };
  const opts = { disco: [255, 255, 255], mouseTextColor: 255, rand: () => 0.5 };
  // 竖直几何:起点 (24,4)、靶心 (24,34)——段链恒竖直(num=0 → rot=0),带宽测量
  // 不受弦斜率污染(首版对角靶实测 7px=路径 x 跨度,非带宽数)
  const tgt = { x: 18, y: 28, w: 12, h: 12, vx: 0, vy: 0 };

  // A. 悠悠球线默认档(psc=0 → A=127 中间档,两笔制)
  const colsYoyo = columnProfile((c) => drawYoyoStringLine(c, tex, 24, 4, tgt, 0, opts));
  // B. 渔线色 29(A=0 纯加色档)
  const cols29 = columnProfile((c) => drawFishingStringLine(c, tex, 24, 4, tgt, [200, 200, 200], 29, opts));
  // C. 渔线默认档(A=255 source-over)
  const colsFish = columnProfile((c) => drawFishingStringLine(c, tex, 24, 4, tgt, [200, 200, 200], 0, opts));
  // D. 对照组:旧摊平形态手动复刻(flatten=true + 'lighter' 全幅)——染色带回潮面
  const colsFlat = columnProfile((c) => {
    const t = tintedTex(tex, [127, 127, 127], true);
    if (!t) return;
    c.save(); c.translate(24, 24); c.rotate(0);
    c.globalCompositeOperation = 'lighter';
    c.drawImage(t, 0, 0, tex.width, tex.height, -6, 0, tex.width, tex.height);
    c.restore();
  });
  return { ok: true, yoyo: bandWidth(colsYoyo), c29: bandWidth(cols29), fish: bandWidth(colsFish),
    flatOld: bandWidth(colsFlat), colsYoyo };
});
if (!out.ok) { L.chk('探针前置', false, out.why); }
else {
  L.chk('悠悠球线带 ≈2px(保形,BJ703-F 修后)', out.yoyo >= 2 && out.yoyo <= 3, `实测 ${out.yoyo}px`);
  L.chk('渔线色29 带宽 ≈2px(A=0 档保形)', out.c29 >= 2 && out.c29 <= 3, `实测 ${out.c29}px`);
  L.chk('渔线默认档带宽 ≈2px(A=255 档保形)', out.fish >= 2 && out.fish <= 3, `实测 ${out.fish}px`);
  L.chk('对照组(摊平旧形态)带宽 =12px(染色带=回潮面判别)', out.flatOld >= 11, `实测 ${out.flatOld}px`);
  console.log(`列剖面(悠悠球): ${out.colsYoyo.join(',')}`);
}
await browser.close();
console.log(L.report ? L.report() : 'DONE');
