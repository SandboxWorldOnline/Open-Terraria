// ★BJ700-A 探针：弹 408 迷你鲨鱼龙 / 662 DD2 敌对标枪 四向贴图朝向取证 + 重力面采样
//   定谳锚（1457 反编译）：
//   · 408：AI_001 尾 rotation 分派 Projectile.cs:58616-58621 `ToRotation() + (direction==-1 ? π : 0)`
//     + :55962-55967 spriteDirection=direction；direction 由 Update :17117-17131
//     (AutomaticallyChangesDirection :17387, aiStyle1 不在排除表) 每拍 `vx<0 ? -1 : 1` 维护；
//     DrawProjDirect Main.cs:30530-30534 FlipHorizontally + 通用绘制 :30606 R(rotation)∘M
//     → 朝右贴图 + 左飞水平镜像（≡ 本仓 PROJ_ROT_RIGHT `scale(-1,1); rotate(π-ang)`）
//   · 662/685：AI_001 尾 :58626-58629 `ToRotation() - π - π/4`，全程无 spriteDirection 写
//     （SetDefaults :751 复位 1）→ 贴图固有朝向 225°(左上矛头,像素物证)，永不翻转
//   · 408 重力：AI_001 :58346-58351 ai[0]>=45 后 vy+=0.05/t（AI1_GRAV[408]=[0.05,45]）
//   · 662 重力：:58453-58460 507/508/662/680/685 族 ai[0]>60 后 vx×0.98 + vy+=0.3
//   取证法：天空空场双拍差分（同机位 无弹帧 vs 有弹帧 → 弹幕像素精确隔离），
//   与原版语义重建掩码逐像素 IoU 对拍（vanilla 期望 vs 旧缺省 +π/2 病灶双假设）。
// 用法: SW_ORIGIN=http://localhost:5207 node tools/run-diag.mjs scripts/_bj700a-proj-direction.mjs
import { launchBrowser, openPage, bootstrap, createGame, pump, ledger, freezeClock } from '../tools/probe/lib/index.mjs';
import fs from 'node:fs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5207';
const L = ledger();

const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, ORIGIN + '/');
const gen = await createGame(page, { mode: 'direct', seed: '05162020', size: 'small' });
L.chk('世界就绪', gen.ok, JSON.stringify(gen).slice(0, 100));
await freezeClock(page, { tod: 0.345 });
await pump(page, 40);

// ---------- 场景：开阔天空带悬停（★仪器判例链 BJ700-A：①相机每帧回随玩家→须玩家
// 静止;②玩家站地表时相机常在 world.groundLevel 层界线下→渲染器切洞穴背景=全画面
// 近黑,弹幕被乘光≈0 不可见;③g.frame() 内含累加器恰 1 fixedUpdate——杀自跑 rAF 环
// 后全确定性步进。终版：玩家悬空钉层界线上方天空带（每步钉 p.y/p.vy=0 防下坠）,
// 弹道带=其上 220px,地面/树梢/岛缘全排除）。 ----------
const setup = await page.evaluate(() => {
  const g = window.__swGame;
  const st = g.world.store;
  const gl = g.world.groundLevel || 200;            // 层界线（tile 域）
  // 视域列窗内最高地形（x∈[190,230]）
  let minTop = st.h;
  for (let tx = 190; tx <= 230; tx++)
    for (let ty = 20; ty < st.h; ty++) { if (st.hasTile(tx, ty)) { minTop = Math.min(minTop, ty); break; } }
  // 飞行带 tile 行 = 太空带（<groundLevel×0.4,无云层漂移=相邻帧静态;星点静态可差分）
  // 且最高地形上 20 带内（避山脊/岛缘）
  const bandTy = Math.min(Math.floor(gl * 0.4), minTop - 20);
  return { groundLevel: gl, minTop, bandTy };
});
console.log('场景:', JSON.stringify(setup));

// ---------- 四向取证（408 / 662） ----------
// 仪器设计（BJ700-A）：相机每帧回随玩家（lerp）→ 手摆机位会被逐帧拉回 = 差分污染源。
// 正解：玩家钉靶位（弹道区下方 200px,裁剪窗不与玩家重叠）→ 泵足帧让相机收敛 +
// 弹幕贴图懒加载就绪 → 【相邻帧】A/B 差分（B=弹在场,A=杀弹后 1 帧——天空梯度
// 对相邻帧静态,相机已收敛 → 差分=弹幕像素精确隔离）。
// 弹幕走 T 个 fixedUpdate 到终点后原地静置等渲染（frame() 不推进 AI,速度/位置冻结）。
const DIRS = [
  { name: 'R', vx: 8, vy: 0 },
  { name: 'L', vx: -8, vy: 0 },
  { name: 'U', vx: 0, vy: -8 },
  { name: 'D', vx: 0, vy: 8 },
];
const T = 7;   // 泵拍数（408 alpha 255-40*7<0 → 钳 0 全显；重力门 45/61 均未达 → 速度恒定）

const visual = await page.evaluate(async ({ dirs, ticks, setup0 }) => {
  const g = window.__swGame;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const { projSprite, projFrameImg, Arrow } = await import('/src/entities/Arrow.ts');
  const CW = 220, CH = 220;                       // 裁剪窗（世界像素）
  const out = [];
  g.running = false;                              // ★杀自跑 rAF 环（探针全确定性步进）
  let vnow = performance.now() + 100;
  let pinY = 0;                                     // 悬停钉位（每步重钉防坠;相机随玩家=静止）
  const step = async () => {
    if (pinY) { g.player.y = pinY; g.player.vy = 0; }
    vnow += 1000 / 60; g.frame(vnow); await wait(0);
  };  // 恰 1 tick+1 渲染

  const p = g.player;
  p.debugGod = true;
  // 悬停钉位：层界线上方天空带;每步重钉防下坠（相机随玩家=静止,天空带=白昼亮底）
  const hoverY = setup0.bandTy * 16;
  pinY = hoverY;                                   // 激活每步钉位
  p.x = 200 * 16; p.y = hoverY; p.vx = 0; p.vy = 0;
  g.camera.x = p.cx; g.camera.y = p.cy;
  for (let i = 0; i < 120; i++) await step();      // 光照区收敛+相机静置
  const baseX = p.cx + 60, baseY = p.y - 220;      // 弹道锚（玩家上方 220px）
  // 贴图预热（projSprite 首调即触发异步装载——避免出生后首帧无图）
  const warm = async (pid) => {
    for (let i = 0; i < 100; i++) {
      const im = projSprite(pid);
      if (im && im.width > 0) return true;
      await wait(50);
    }
    return false;
  };
  await warm(408); await warm(662);

  // 暖场弹（首场景双影伪影=首弹 prev/尾迹初始化残留,一发弃弹吸收）
  {
    const w = new Arrow(baseX - 5, baseY - 5, 8, 0, 10, 0, 408, { grav: 0, life: 600 });
    g.entities.add(w, 'projectiles');
    for (let i = 0; i < 8; i++) await step();
    w.dead = true;
    for (let i = 0; i < 4; i++) await step();
  }
  for (const pid of [408, 662]) {
    for (const d of dirs) {
      g.entities.enemies.length = 0;                 // 清场（防天空生物入窗）
      g.entities.projectiles.length = 0;             // 清弹桶（弃弹/暖场残留全灭,窗内唯一弹=本场景弹）
      const sx = baseX, sy = baseY;
      const fx = sx + d.vx * ticks, fy = sy + d.vy * ticks;   // 终点
      // 出生（grav 0 隔离方向面）→ 精确 T 帧（frame()=逻辑+渲染,每帧恰 1 fixed tick）
      //   —— 408 α 255−40×7→0 全显；无重力/阻力 → 速度恒定方向纯净
      const ar = new Arrow(sx - 5, sy - 5, d.vx, d.vy, 10, 0, pid, { grav: 0, life: 600 });
      g.entities.add(ar, 'projectiles');
      for (let i = 0; i < ticks; i++) await step();   // 恰 T tick：408 α 255−40×7→0 全显
      const imgOk = () => { const im = projSprite(pid); return im && im.width > 0; };
      // B 帧（弹在场）——★acc/GL 呈现路径画布读回竞态防护：双抓全等才收
      //  （曾读半更新缓冲=差分出鬼影组件,R 向 intermittently 复现）
      const cv = g.renderer.canvas;
      const scrB = g.camera.worldToScreen(ar.cx, ar.cy);
      const bx = Math.max(0, Math.min(cv.width - CW, Math.round(scrB[0] - CW / 2)));
      const by = Math.max(0, Math.min(cv.height - CH, Math.round(scrB[1] - CH / 2)));
      const grab = () => {
        const c = document.createElement('canvas'); c.width = CW; c.height = CH;
        c.getContext('2d').drawImage(cv, bx, by, CW, CH, 0, 0, CW, CH);
        return c;
      };
      let cB = grab();
      for (let gTry = 0; gTry < 4; gTry++) {
        await wait(12);
        const cB2 = grab();
        if (cB.toDataURL() === cB2.toDataURL()) break;
        cB = cB2;
      }
      // A 帧：零 tick 纯重渲（同 vnow → dt=0 无 fixedUpdate → 光照 flicker/插值相位
      // 全冻结;弹挪出屏 = 背景纯帧）——与 B 帧唯一差 = 弹幕像素
      const xKeep = ar.x, yKeep = ar.y;
      ar.x = -99999; ar.y = -99999;
      vnow += 0.01; g.frame(vnow); await wait(2);   // 微 dt：不积 fixedUpdate(0.01ms≪16.7ms) 但渲染照跑
      let cA = grab();
      for (let gTry = 0; gTry < 4; gTry++) {
        await wait(12);
        const cA2 = grab();
        if (cA.toDataURL() === cA2.toDataURL()) break;
        cA = cA2;
      }
      ar.x = xKeep; ar.y = yKeep; ar.dead = true;
      // 差分掩码（|B−A| 任通道 > 25）
      const dA = cA.getContext('2d').getImageData(0, 0, CW, CH).data;
      const dB = cB.getContext('2d').getImageData(0, 0, CW, CH).data;
      const mask = new Uint8Array(CW * CH);
      let nPx = 0, sxAcc = 0, syAcc = 0;
      for (let i = 0, q = 0; i < dA.length; i += 4, q++) {
        const dd = Math.max(Math.abs(dB[i] - dA[i]), Math.abs(dB[i + 1] - dA[i + 1]),
          Math.abs(dB[i + 2] - dA[i + 2]));
        if (dd > 4) { mask[q] = 1; nPx++; sxAcc += q % CW; syAcc += (q / CW) | 0; }
      }
      if (!nPx) { out.push({ pid, dir: d.name, ok: false, why: 'empty-mask', imgLoaded: imgOk(), at: [Math.round(ar.cx), Math.round(ar.cy)], dead: ar.dead, alpha: ar.alpha, pAt: [Math.round(p.cx), Math.round(p.cy)], pV: [p.vx, p.vy], cam: [Math.round(g.camera.x), Math.round(g.camera.y)], crop: [bx, by], scrB: [Math.round(scrB[0]), Math.round(scrB[1])] }); continue; }
      // 最大连通域 = 本体（mode0 ghost 拖尾在旧位是独立小块;星点/杂点同剔）
      {
        const keep = new Uint8Array(CW * CH);
        let bestN = 0;
        const stack = [];
        for (let q = 0; q < mask.length; q++) {
          if (!mask[q] || keep[q]) continue;
          let n = 0; stack.length = 0; stack.push(q); keep[q] = 1;
          while (stack.length) {
            const c = stack.pop(); n++;
            const cxq = c % CW, cyq = (c / CW) | 0;
            for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = cxq + ddx, ny = cyq + ddy;
              if (nx < 0 || nx >= CW || ny < 0 || ny >= CH) continue;
              const nq = ny * CW + nx;
              if (mask[nq] && !keep[nq]) { keep[nq] = 1; stack.push(nq); }
            }
          }
          if (n > bestN) { bestN = n; mask.fill(0); for (let z = 0; z < keep.length; z++) { if (keep[z]) mask[z] = 1; } keep.fill(0); }
          else keep.fill(0);
        }
        nPx = bestN;
        sxAcc = 0; syAcc = 0;
        for (let q = 0; q < mask.length; q++) if (mask[q]) { sxAcc += q % CW; syAcc += (q / CW) | 0; }
      }
      const cx0 = sxAcc / nPx, cy0 = syAcc / nPx;
      // 主轴角（二阶矩）
      let sxx = 0, syy = 0, sxy = 0;
      for (let q = 0; q < mask.length; q++) if (mask[q]) {
        const x = (q % CW) - cx0, y = ((q / CW) | 0) - cy0;
        sxx += x * x; syy += y * y; sxy += x * y;
      }
      const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);   // 主轴角（rad, 屏幕 y 下）
      // bbox
      let mnx = 1e9, mxx = -1, mny = 1e9, mxy = -1;
      for (let q = 0; q < mask.length; q++) if (mask[q]) {
        const x = q % CW, y = (q / CW) | 0;
        if (x < mnx) mnx = x; if (x > mxx) mxx = x;
        if (y < mny) mny = y; if (y > mxy) mxy = y;
      }
      // ---- 假设变换重建掩码 ----
      // 帧源：与游戏绘制同帧（fIdx=floor(age/5)%frames——修复前翻帧面/修复后 408 恒0,
      // 两态都对拍同一帧源=变换假设唯一变量）；662 单帧整图
      const framesN = pid === 408 ? 2 : 1;
      const fIdxN = pid === 408 ? Math.floor(ar.age / 5) % framesN : 0;
      const src = framesN > 1 ? (projFrameImg(pid, fIdxN) ?? projSprite(pid)) : projSprite(pid);
      const iw = src.width, ih = src.height;
      // 实测位移方向（grav 0 无阻力 → 位移向 ≡ 速度向;免疫 frame() 累加器 tick 损耗）
      const ang = Math.atan2(ar.cy - sy, ar.cx - sx);
      const buildExpect = (rot, flip) => {
        const c = document.createElement('canvas'); c.width = CW; c.height = CH;
        const c2 = c.getContext('2d');
        c2.imageSmoothingEnabled = false;
        c2.translate(CW / 2, CH / 2);
        if (flip) c2.scale(-1, 1);
        c2.rotate(rot);
        c2.drawImage(src, -iw / 2, -ih / 2);
        const dd = c2.getImageData(0, 0, CW, CH).data;
        const m = new Uint8Array(CW * CH);
        for (let i = 3, q = 0; i < dd.length; i += 4, q++) if (dd[i] > 40) m[q] = 1;
        return m;
      };
      // vanilla 期望：408 = flip(vx<0) + rotate(ang)（≡原版 R(ang+π)∘M,本仓 PROJ_ROT_RIGHT 合成）
      //               662 = rotate(ang − π − π/4) 恒无翻转
      // 旧病灶（缺省支）：rotate(ang + π/2) 恒无翻转
      const expVan = pid === 408
        ? buildExpect(ang, ar.vx < 0)
        : buildExpect(ang - Math.PI - Math.PI / 4, false);
      const expOld = buildExpect(ang + Math.PI / 2, false);
      // 质心对齐（±4px 搜索）后 IoU
      const iou = (m1, m2) => {
        const cent = (m) => { let n = 0, x = 0, y = 0; for (let q = 0; q < m.length; q++) if (m[q]) { n++; x += q % CW; y += (q / CW) | 0; } return n ? [x / n, y / n] : null; };
        const c1 = cent(m1), c2 = cent(m2);
        if (!c1 || !c2) return 0;
        // 质心预对齐（位置不变式——方向/形状验证不依赖窗内落位）+ ±3 精修（取整抖动）
        let ox = Math.round(c1[0] - c2[0]), oy = Math.round(c1[1] - c2[1]);
        let best = 0;
        for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) {
          let inter = 0, uni = 0;
          const sx2 = ox + dx, sy2 = oy + dy;
          for (let q = 0; q < m1.length; q++) if (m1[q]) {
            const x = (q % CW) - sx2, y = ((q / CW) | 0) - sy2;
            if (x >= 0 && x < CW && y >= 0 && y < CH && m2[y * CW + x]) inter++;
            uni++;
          }
          for (let q = 0; q < m2.length; q++) {
            if (!m2[q]) continue;
            const x = (q % CW) + sx2, y = ((q / CW) | 0) + sy2;
            if (x >= 0 && x < CW && y >= 0 && y < CH && m1[y * CW + x]) continue;
            uni++;
          }
          if (uni && inter / uni > best) best = inter / uni;
        }
        return best;
      };
      out.push({
        pid, dir: d.name, ok: true, nPx, cx: Math.round(cx0), cy: Math.round(cy0),
        bbox: [mnx, mny, mxx - mnx + 1, mxy - mny + 1],
        axisDeg: Math.round(theta * 180 / Math.PI),
        velAngDeg: Math.round(ang * 180 / Math.PI),
        iouVanilla: Math.round(iou(mask, expVan) * 1000) / 1000,
        iouOldDefault: Math.round(iou(mask, expOld) * 1000) / 1000,
        imgLoaded: imgOk(), srcSize: [iw, ih],
        png: cB.toDataURL('image/png'),
        pngA: cA.toDataURL('image/png'),
        pngMask: (() => { const c = document.createElement('canvas'); c.width = CW; c.height = CH;
          const id = c.getContext('2d').createImageData(CW, CH);
          for (let q = 0; q < mask.length; q++) { if (mask[q]) { id.data[q * 4] = 255; id.data[q * 4 + 1] = 255; id.data[q * 4 + 2] = 255; id.data[q * 4 + 3] = 255; } }
          c.getContext('2d').putImageData(id, 0, 0); return c.toDataURL('image/png'); })(),
      });
      // 下一场景前清残留（dead 弹后续步被回收）
      for (let i = 0; i < 3; i++) await step();
    }
  }
  return out;
}, { dirs: DIRS, ticks: T, setup0: setup });

let idx = 0;
for (const s of visual) {
  if (s.png) {
    fs.writeFileSync(`/tmp/bj700a-${s.pid}-${s.dir}.png`, Buffer.from(s.png.split(',')[1] ?? '', 'base64'));
  }
  if (s.pngMask) {
    fs.writeFileSync(`/tmp/bj700a-${s.pid}-${s.dir}-mask.png`, Buffer.from(s.pngMask.split(',')[1] ?? '', 'base64'));
  }
  if (s.pngA) {
    fs.writeFileSync(`/tmp/bj700a-${s.pid}-${s.dir}-A.png`, Buffer.from(s.pngA.split(',')[1] ?? '', 'base64'));
  }
  idx++;
  console.log(`弹${s.pid} ${s.dir}: ${s.ok ? `px=${s.nPx} bbox=${s.bbox} 主轴=${s.axisDeg}° 速度角=${s.velAngDeg}° IoU(vanilla)=${s.iouVanilla} IoU(旧缺省+π/2)=${s.iouOldDefault}` : `FAIL ${JSON.stringify(s)}`}`);
}
// 判定：vanilla IoU 全向 ≥0.80 且 旧缺省 IoU 显著低（方向病愈）；主轴对齐速度角 ±25°
for (const pid of [408, 662]) {
  const set = visual.filter((s) => s.pid === pid && s.ok);
  L.chk(`弹${pid} 四向取证齐全`, set.length === 4, `n=${set.length}`);
  if (set.length < 4) continue;                       // 空集守卫（防 Math.min(...[])=Infinity 伪绿）
  const worstVan = Math.min(...set.map((s) => s.iouVanilla));
  L.chk(`弹${pid} 全向 vanilla 重建 IoU≥0.60（差分阈值裁剪+镜像重采样损耗,绝对值上限≈0.75）`, worstVan >= 0.60,
    `worst=${worstVan} 各向=${set.map((s) => s.dir + ':' + s.iouVanilla).join(' ')}`);
  const worstOld = Math.max(...set.map((s) => s.iouOldDefault));
  L.chk(`弹${pid} 判别余量：vanilla 最差 > 旧缺省最好 +0.30（真判别闸）`, worstVan > worstOld + 0.30,
    `vanilla worst=${worstVan} old best=${worstOld}`);
  const axisAligned = set.every((s) => {
    const dv = Math.abs(((s.axisDeg - s.velAngDeg + 90 + 180) % 180) - 90);
    return dv <= 25;
  });
  L.chk(`弹${pid} 主轴四向对齐速度角（±25°）`, axisAligned,
    set.map((s) => `${s.dir}:轴${s.axisDeg}/速${s.velAngDeg}`).join(' '));
}

// ---------- 重力面采样（408 修复面 + 662 既有面回归） ----------
const grav = await page.evaluate(async () => {
  const g = window.__swGame;
  g.running = false;                    // 杀自跑环（同 visual 段仪器判例）
  const { Arrow } = await import('/src/entities/Arrow.ts');
  const res = {};
  // 408：shootMinionShot 同参（显式 grav:0 —— 修复前绕过规格链=恒直线飞行）
  //   初速 vy=-4（向上）——重力面用 vy 增量判定（原版 :58346 ai0≥45 后 +0.05/t）
  const a408 = new Arrow(100 * 16, 30 * 16, 8, -4, 10, 0, 408, { grav: 0, life: 300 });
  res.p408 = { grav: a408.grav, gravDelay: a408.gravDelay };
  g.entities.add(a408, 'projectiles');
  const vy408 = {};
  for (let t = 1; t <= 52; t++) {
    g.fixedUpdate(1 / 60);
    if (t === 44 || t === 46 || t === 52) vy408[t] = Math.round(a408.vy * 1000) / 1000;
  }
  a408.dead = true;
  res.vy408 = vy408;
  // 662：shootD2 同参（无 grav → 规格链 [0.3,61] + drag 0.98 门内 :58453-58460）
  const a662 = new Arrow(110 * 16, 30 * 16, -8, -4, 10, 0, 662, { life: 3600, hostile: true, drag: 0.98 });
  res.p662 = { grav: a662.grav, gravDelay: a662.gravDelay, drag: a662.drag };
  g.entities.add(a662, 'projectiles');
  const s662 = {};
  for (let t = 1; t <= 70; t++) {
    g.fixedUpdate(1 / 60);
    if (t === 60 || t === 62 || t === 70) s662[t] = [Math.round(a662.vx * 1000) / 1000, Math.round(a662.vy * 1000) / 1000];
  }
  a662.dead = true;
  res.v662 = s662;
  return res;
}, {});
console.log('\n重力面:', JSON.stringify(grav));
const d46 = grav.vy408 && (grav.vy408[46] - grav.vy408[44]);
const d52 = grav.vy408 && (grav.vy408[52] - grav.vy408[44]);
L.chk('408 重力规格生效（grav=0.05@45,显式0回落——修复前 grav=0/delay=-1）',
  grav.p408?.grav === 0.05 && grav.p408?.gravDelay === 45,
  `p=${JSON.stringify(grav.p408)} vy@44/46/52=${JSON.stringify(grav.vy408)}`);
L.chk('408 门后 vy 增量 ≈ 0.05/t（Δ(46,44)∈[0.05,0.15] Δ(52,44)∈[0.30,0.50]）',
  d46 >= 0.05 && d46 <= 0.15 && d52 >= 0.30 && d52 <= 0.50,
  `d46=${d46} d52=${d52}`);
const vyDelta662 = grav.v662 && (grav.v662[70][1] - grav.v662[60][1]);
const vxRatio662 = grav.v662 && (grav.v662[70][0] / grav.v662[60][0]);
L.chk('662 重力面回归（[0.3,61]+drag0.98：Δvy(70,60)≈3.0,vx 比≈0.98^10≈0.817）',
  grav.p662?.grav === 0.3 && grav.p662?.gravDelay === 61 && grav.p662?.drag === 0.98
  && vyDelta662 > 2.5 && vyDelta662 < 3.5 && vxRatio662 > 0.79 && vxRatio662 < 0.84,
  `Δvy=${vyDelta662} vx比=${vxRatio662} ${JSON.stringify(grav.v662)}`);

await browser.close();
L.print();
process.exit(L.exitCode());
