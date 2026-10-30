// ★BJ676（2026-10-14 用户实报「星云套或日耀套在水里时,水的渲染似乎在装甲的
// 下一层（水看起来被装甲盖住）,不穿套装时水正常画在角色层之上」）月套逃逸族
// 前景水罩——层序定谳+局部复合结构锁。
//
// ── 定谳（Terarria1457 反编译亲读,1.4.5.7 唯一标杆）──
// 原版主渲染序 Main.cs:63194-63266:
//   DrawProjectiles(:63199) → DrawPlayers_AfterProjectiles(:63204,玩家层组【全部】
//   经 drawinfo.DrawDataCache.Add 提交——PlayerDrawLayers.cs:3144 DrawPlayer_26_
//   SolarShield 盾球/SetPassColors 恒色甲(17_Torso/13_Leggings/21_Head)/GlowMask
//   叠层/被盖层 18-38 层组同链) → DrawItems(:63226) → DrawRain(:63227) →
//   DrawGore(:63230) → DrawDust(:63241) → 【前景水 DrawWaters(:63248) /
//   waterTarget.Texture over 合成(:63256,WorldSceneLayerTarget 独立 RT,WorldScene
//   LayerTarget.cs:43-64)】 → DrawWires(:63251/:63259) → InfernoRings(:63264) →
//   PaladinsShield(:63265) → 接口层。=【水罩一切实体含免光甲件/glow/盾球】;
//   裸装玩家像素与月套甲件同链同罩——用户观察「原版水正常在角色层上」含甲件。
//
// ── 本仓病根 ──
// 前景水在 4.5 段（Renderer drawLiquids 前景 pass,三路全画进世界层=warpOn canvas
// fgCanvas 回贴 / liqgl 批化 FBO('world') / 非 warpOn 直绘）→ endWorldLayer →
// compositeLight 全屏乘光;而月套逃逸族（BJ665b flushLunarArmor 恒色甲/BJ597
// flushArmorGlow 甲位 glow/BJ665b flushLunarCovered 被盖层随迁/BJ594
// flushSolarShieldQueue 盾球——免光重绘=合成后逃逸）在 7e 段直绘主画布=画在
// 前景水【之上】=甲浮于水色=实报形态。裸装玩家像素全在 ent lit 窗（世界层）=
// 水正常罩——两路径分异即用户截图形态。
//
// ── 落刀（候选 B 精确化=局部复合;禁候选 A/C 挪前景水:水受光（原版水顶点色
//   GetCornerColors,本仓=世界层内吃 compositeLight 乘光）+全屏扭曲管线
//   applyFullScreen 门控双耦合,全局挪=水纹扭曲回归+liqgl 批化发射目标深水区）──
// 四 flush 冲刷直绘照旧（blend 语义零动——glow 'lighter' 加法不可结合,禁中转
// 目标）+同式镜像重放形状进 mask（escapeVeilStroke,页域与主画布同构零换算）,
// 会话收口（escapeVeilEnd）把「前景水层×mask」destination-in 截形后 source-over
// 主画布=只罩逃逸像素,非逃逸区域第一份水（世界层内）零双罩。
// 代数:恒色甲不透明 over 可结合=W over (A over S) 逐位精确;glow 加法支残差
// (1−αW)·L(W) 底色项+半透明逃逸像素按 maskα 连续衰减（登记,见 7e 头注）。
// 水罩源（_liqVeil）三路统一:warpOn canvas=fgCanvas（endFgPass 后不清屏,本帧
// 后半仍有效）;liqgl 批化帧禁批回 canvas gate 路（灰度债:?liqgl=1 月套+水同屏
// 帧批化退位,转正前须 FBO gate 回读或 GL 侧复合）;非 warpOn 直绘路月套帧借
// beginFgPass/endFgPass 同机制产出。bg pass 头帧界复位防跨帧陈旧。
//
// ── 同性质未修队列登记 → ★BJ679（2026-10-14）九路收编完毕──
// BJ676 登记的未修队列已由 BJ679 全部接入会话（逐队列原版锚+镜像锁见
// tests/bj679-water-veil-queues.test.ts）:7e 翼光 flushWingGlow / 7e'''''
// flushItemGlow / 7e'' flushEyebrellaCloud / 7e' flushWhipFullbright /
// 7f flushTrailShade（CPU 光栅路）/ 7c drawBrightVines / 7d' Faeling 677+
// fairy 583-585+鹿角怪 668 / 7d'' drawFadingParticles / 7d''' flushTowerGlow
// 四塔残影 / flushNpcWhiteLift（395/519 白提亮）。余债（GL/子链面）:
// liqgl 批化 gate 路 / gladd itemGlow GL 会话 / 拖尾 GL 路（obj55/obj58）/
// projFullbrightQueue 闭包族 / 翼光 overlay betsy·trail45 子链 / 7d 全亮尘。
// 正确不罩域:7g drawWiresBright（原版 DrawWires :63251/:63259 在水后）/7h 狱火环
// （:63264）/BJ553 标记/BJ422 标尺/BJ593 血条（接口层）。
//
// 判别力（旧码必红）:§2 三路水罩源/§3 会话序/§4 复合语义/§5 镜像同式——
// 回滚 BJ676 任一段即红。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RDR = readFileSync(join(HERE, '..', 'src/render/Renderer.ts'), 'utf8');

describe('★BJ676 §1 原版层序定谳锁（Main.cs:63194-63266 亲读）', () => {
  it('7e 头注载明:玩家层组 DrawDataCache 主链 → 前景水 waterTarget over 合成=水罩甲', () => {
    // 玩家层组全部（恒色甲/glow/盾球/被盖层）进主场景,水合成在其后
    expect(RDR).toContain('DrawPlayers_AfterProjectiles（:63204）画进主场景');
    expect(RDR).toContain('前景\n    //   水 DrawWaters（:63248）/waterTarget.Texture over 合成（:63256');
    expect(RDR).toContain('PlayerDrawLayers.cs:3144');
    // 盾球原版提交链铁证
    expect(RDR).toContain('26_SolarShield 盾球');
  });

  it('水后域（导线/狱火环）正确不罩的判据注', () => {
    expect(RDR).toContain('7g 导线 Bright/7h 狱火环原版在【水后】（:63251/:63259/:63264）=正确不罩');
  });
});

describe('★BJ676 §2 水罩源三路统一（drawLiquids 前景 pass）', () => {
  it('veil676 谓词=月套四队列+★BJ679 九路扩区（时序=实体段 4 收集 < 前景水 4.5 恒满足）', () => {
    // ★BJ741（2026-10-30）：谓词分组重构——玩家绑定六队列（位置域液检）∨世界绑定五队列
    expect(RDR).toContain('const veilPlayerQ = this.lunarArmorQueue.length > 0 || this.armorGlowQueue.length > 0');
    expect(RDR).toContain('|| this.lunarCoverQueue.length > 0 || this.solarShieldQueue.length > 0');
    expect(RDR).toContain('★BJ679 九路扩区（注见上）');
    expect(RDR).toContain('|| veilWorldQ || veil679Ent || veil679Fade;');
    // 实体直绘族经 veilEntities 入谓词（仅 fg pass 传参;BJ741 增玩家域盒第八参）
  });

  it('liqgl 批化帧禁批回 canvas gate 路（fgCanvas 形态层保留）', () => {
    // ★BJ743（2026-10-30）罩源 GL 化灰度债清偿:veil 帧+层在场=保持批化
    //  （emitVanillaLiquidVeil 批数据不镜像重发射进独立 GL 层=罩源,fgCanvas 形态层退役）
    expect(RDR).toContain('const bat = liqMode && !liqRingOverflow() && (!veil676 || !!veilLiqGl)');
    expect(RDR).toContain('const veilLiqGl = veil676 ? this.acquireVeilLiqLayer() : null;');
    expect(RDR).toContain('&& emitVanillaLiquidVeil(veilLiqGl, this._worldLowW, this._worldLowH)) {');
    expect(RDR).toContain('this._liqVeil = veilLiqGl.canvas;');
    // 旗+退避层管理
    expect(RDR).toContain("new URLSearchParams(location.search).get('veilliq') !== '0'");
    expect(RDR).toMatch(/private acquireVeilLiqLayer\(\): GLSpriteLayer \| null/);
    expect(RDR).toContain('if (now - this._veilLiqLayerAt < 5000) return null;');
    // 2D 回退臂保留（层缺席/旗关/发射失败）
    expect(RDR).toContain('if (veil676) this._liqVeil = this.waterWarp.gateCanvas();');
  });

  it('warpOn canvas 路:endFgPass 后登记 fgCanvas 为罩源（不清屏语义复用）', () => {
    expect(RDR).toContain('if (veil676) this._liqVeil = this.waterWarp.gateCanvas();');
  });

  it('非扭曲直绘路:月套帧借 beginFgPass/endFgPass 离屏机制（warpMode=false bob 语义不变）', () => {
    expect(RDR).toContain('} else if (veil676) {');
    // 借用 beginFgPass 克隆世界变换画离屏,再 1:1 合成回世界层（分支全段=到下一 else）
    const i0 = RDR.indexOf('} else if (veil676) {');
    const i1 = RDR.indexOf('    } else {', i0);
    const seg = RDR.slice(i0, i1 > i0 ? i1 : i0 + 2400);
    expect(seg).toContain('this.waterWarp.beginFgPass(this.ctx)');
    expect(seg).toContain('this.waterWarp.endFgPass(this.ctx)');
    expect(seg).toContain('this._liqVeil = this.waterWarp.gateCanvas()');
    // warpMode 直绘语义（bob 开）保持
    expect(seg).toContain('waterfallAt, false, glintLumAt, this.animTick');
  });

  it('bg pass 头帧界复位（防跨帧陈旧 fgCanvas 引用）', () => {
    expect(RDR).toContain('this._liqVeil = null;         // ★BJ676 帧界复位');
  });
});

describe('★BJ676 §3 会话序（★BJ679 扩区:7c-7f 开/收位次）', () => {
  it('escapeVeilBegin 在 drawBrightVines 前（7c 首队列）;wingGlow 在会话内（BJ679 收编）', () => {
    const iVines = RDR.indexOf('this.drawBrightVines(entities, cam, z');
    const iBegin = RDR.indexOf('this.escapeVeilBegin();');
    const iWing = RDR.indexOf('this.flushWingGlow(cam, z);');
    const iLunar = RDR.indexOf('this.flushLunarArmor();');
    expect(iVines).toBeGreaterThan(-1);
    expect(iBegin).toBeGreaterThan(-1);
    expect(iBegin).toBeLessThan(iVines);
    expect(iWing).toBeGreaterThan(iBegin);
    expect(iLunar).toBeGreaterThan(iWing);
  });

  it('escapeVeilEnd 在 flushTrailShade 后（7c-7f 十队列+月套四 flush 全在会话内;itemGlow 2D 路已参=BJ679）', () => {
    const iVines = RDR.indexOf('this.drawBrightVines(entities, cam, z');
    const iArmor = RDR.indexOf('this.flushLunarArmor();');
    const iGlow = RDR.indexOf('this.flushArmorGlow();');
    const iCov = RDR.indexOf('this.flushLunarCovered();');
    const iItem = RDR.indexOf('this.flushItemGlow();');
    const iSolar = RDR.indexOf('this.flushSolarShieldQueue(cam, z);');
    const iEye = RDR.indexOf('this.flushEyebrellaCloud(cam, z);');
    const iWhip = RDR.indexOf('this.flushWhipFullbright(cam, z);');
    const iTrail = RDR.indexOf('this.flushProjFullbright(cam, z, viewW, viewH);');   // ★⑫-b 拆分:trail 双位取末位(闭包族)
    const iEnd = RDR.indexOf('this.escapeVeilEnd();');
    expect(iVines).toBeGreaterThan(-1);
    expect(iArmor).toBeGreaterThan(iVines);
    expect(iGlow).toBeGreaterThan(iArmor);
    // ★BJ681 盾球挪位（原版 26_SolarShield < 27 手持物=盾在武器下;旧位 itemGlow 后
    //  =盾盖武器=用户实报「日耀套甲盖武器」）→ 今序:glow under 遍 < 盾 < 随迁重放
    expect(iSolar).toBeGreaterThan(iGlow);
    expect(iCov).toBeGreaterThan(iSolar);
    expect(iItem).toBeGreaterThan(iCov);
    // ★BJ681 armorGlow arm 遍（28 臂站=武器之上）在 itemGlow 后、eyebrella 前
    const iArm = RDR.indexOf('this.flushArmorGlow(true);');
    expect(iArm).toBeGreaterThan(iItem);
    expect(iEye).toBeGreaterThan(iArm);
    expect(iEye).toBeGreaterThan(iSolar);
    expect(iWhip).toBeGreaterThan(iEye);
    expect(iTrail).toBeGreaterThan(iWhip);
    expect(iEnd).toBeGreaterThan(iTrail);
    // 收口紧随 7f（eyebrella/鞭/拖尾同会话收）
    expect(iEnd - iTrail).toBeLessThan(200);
  });
});

describe('★BJ676 §4 复合语义（escapeVeilEnd）', () => {
  it('destination-in 截形=只罩逃逸像素（mask 来自镜像重放,非逃逸区域零双罩）', () => {
    expect(RDR).toContain("tc.globalCompositeOperation = 'destination-in';   // 截形=只留逃逸像素处的水");
  });

  it('veil（世界层像素域）→页域换算=全幅原点 ×(veil.width/主画布宽)（与 worldCanvas→主画布 ×(1/k) 同关系）', () => {
    expect(RDR).toContain('const vk = v.width / CW;');
  });

  it('主画布恒等域 blit（7e 段在 FX27 呈现翻转点之前=页域未镜像）', () => {
    const m = RDR.match(/private escapeVeilEnd\(\): void \{[\s\S]{0,2200}?ctx\.drawImage\(t, 0, 0, bw, bh, x0, y0, bw, bh\)/);
    expect(m).not.toBeNull();
    expect(m![0]).toContain('ctx.setTransform(1, 0, 0, 1, 0, 0)');
  });

  it('c10e 透明 HUD 幂等垫底先行（source-over 单拍无 BJ556 lighter 衰减病,层序恒在垫底画面之上）', () => {
    expect(RDR).toContain('this.c10eCompositeIntoHud();   // 幂等闩（已垫=空转）');
  });

  it('box 与主画布求交（屏边玩家包络溢出的源区域越界裁剪）', () => {
    expect(RDR).toContain('const x0 = Math.max(0, b.x), y0 = Math.max(0, b.y);');
  });
});

describe('★BJ676 §5 四 flush mask 镜像（与主画布直绘完全同式）', () => {
  it('flushLunarArmor:drawImage 后镜像（tinted 同对象零重烘,globalAlpha=g 同步）', () => {
    const i = RDR.indexOf('private flushLunarArmor(): void {');
    const seg = RDR.slice(i, i + 2600);
    expect(seg).toContain('ctx.drawImage(ff.img, ff.sx, ff.sy, ff.sw, ff.sh, -ff.sw / 2, -ff.sh + 4, ff.sw, ff.sh)');
    expect(seg).toContain('mc.drawImage(ff.img, ff.sx, ff.sy, ff.sw, ff.sh, -ff.sw / 2, -ff.sh + 4, ff.sw, ff.sh)');
    expect(seg).toContain('mc.globalAlpha = g;');
  });

  it('flushArmorGlow:copies 内镜像（原图=α 同 tint;rot 支保守盒;blend 语义直绘保持）', () => {
    // ★BJ681 签名扩参（armPass 臂遍）;锁体不变
    const i = RDR.indexOf('private flushArmorGlow(armPass = false): void {');
    const iEnd = RDR.indexOf('private flushItemGlow(): void {');
    const seg = RDR.slice(i, iEnd > i ? iEnd : i + 6500);
    expect(seg).toContain('mc.drawImage(img, op.sx, sy, op.sw, op.sh, op.dx + jx, op.dy + jy, op.sw, op.sh)');
    expect(seg).toContain('mc.rotate(rt);');
  });

  it('flushLunarCovered:blit 后镜像（轴对齐 ×invK 页域盒）', () => {
    const i = RDR.indexOf('private flushLunarCovered(): void {');
    const seg = RDR.slice(i, i + 1800);
    expect(seg).toContain('mc.drawImage(e.cv, 0, 0, e.w, e.h, e.ox, e.oy, e.w, e.h)');
  });

  it('flushSolarShieldQueue:屏域直绘同式镜像（SOLAR_SHIELD_ALPHA 同步）', () => {
    const i = RDR.indexOf('private flushSolarShieldQueue(cam: Camera, z: number): void {');
    const seg = RDR.slice(i, i + 2200);
    expect(seg).toContain('mc.drawImage(e.src, -e.tw / 2, -e.th / 2)');
    expect(seg).toContain('mc.globalAlpha = SOLAR_SHIELD_ALPHA;');
  });

  it('非会话帧零开销:_veilActive 假=no-op（月套队列空帧四 flush 原路径）', () => {
    expect(RDR).toContain('if (!this._veilActive) return;');
  });
});
