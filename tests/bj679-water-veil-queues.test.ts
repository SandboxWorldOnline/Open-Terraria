// ★BJ679（2026-10-14）BJ676 水罩 veil 同性质九队列登记债收编——逐队列
// 源码锚锁（escapeVeilStroke 镜像在位+原版层序锚）+行为锁（recording-ctx
// 断言镜像 Stroke 序）。体裁沿用 bj676-lunar-water-veil（结构锁）与
// bj-c1-render-batch F4（recording-ctx 直调重放）。
//
// ── 定谳（Terarria1457 反编译亲读;Main.cs 共 67728 行,锚行号均为 1457 实测）──
// 原版主渲染序 Main.cs:63183-63266:
//   DoDraw_WallsTilesNPCs(:63183,内含 DrawNPCs→DrawNPCDirect :22723 族) →
//   DrawProjectiles(:63199,鞭 flag3 :36744-36749/弹幕 Drawer 拖尾) →
//   DrawPlayers_AfterProjectiles(:63204,玩家层组全链 PlayerDrawLayers.cs:
//   655 09_Wings/:3130 26_SolarShield/:3148 27_HeldItem/:4157 38_EyebrellaCloud)
//   → ParticleSystem_World_OverPlayers(:63207-63208 FadingParticles) →
//   DrawItems(:63226,掉落 glowMask :39408-39437) → DrawGore(:63230) →
//   DrawDust(:63241) → 【前景水 DrawWaters(:63248)/waterTarget over(:63256)】
//   → DrawWires(:63251/:63259) → InfernoRings(:63264) → 接口层。
// =本刀十队列全部在水前 → 水应罩 ✓;7g/7h/接口层在水后=正确不罩 ✓。
// 逐队列原版锚（1457 行号实测,146 后缀=SW 旧注释 1456 行号勘误处）:
//   7c 茎蔓      Main.cs:22842-22868（FungiBulb 259/GiantFungiBulb 260 下限色
//                100/150/255;DrawNPCDirect :22723 aiStyle 13 链段）
//   7d' 飞灵     Main.cs:24462 case 677 → DrawNPCDirect_Faeling :26809
//                （旧注 :26306-26368=1456 行号）
//   7d' 仙灵     NPCID: FairyCritterPink/Green/Blue=583/584/585（NPC 链 GetAlpha
//                Lerp(light,White,0.5)）
//   7d' 鹿角怪   Main.cs:26714 DrawNPCDirect_Deerclops（value2=(80,0,0,255)×0.5
//                :26743/color3=(255,30,30,66) :26795）
//   7d'' 粒子    Main.cs:63207-63208 ParticleSystem_World_OverPlayers
//   7d''' 四塔   Main.cs:24483-24520（422/493/507/517 vel4 四向
//                Color(64,64,64,0)×Opacity;516 SolarFlare 白罩/残影同域）
//   7e 翼光      PlayerDrawLayers.cs:655 DrawPlayer_09_Wings → :63204
//   7e 手持光罩  PlayerDrawLayers.cs:3148 DrawPlayer_27_HeldItem → :63204
//   7e 掉落光罩  Main.cs:39408-39437（DrawItems → :63226）
//   7e 眼球伞    PlayerDrawLayers.cs:4157 DrawPlayer_38_EyebrellaCloud → :63204
//   7e' 鞭线体   Main.cs:36744-36749 flag3（color2=color 免逐段取光）→
//                DrawProjectiles :63199（1034 星辰鞭）
//   7f 拖尾      弹幕 Drawer 全程不取光 → DrawProjectiles :63199（CPU 光栅路
//                接入;GL 路 obj55/obj58 渲入 glfx.canvas=余债）
//   白提亮       NPC 绘制链（DrawNPCDirect 族）→ DrawNPCs :63183
//
// ── 余债登记（本刀不碰 GL 路;回滚即红=下方锁面）──
// liqgl 批化 gate 路（FBO 回读,BJ676 既有）/ gladd itemGlow GL 会话消费面 /
// 拖尾 GL 路（obj55 SM2/obj58 tech,drawStripTrail onBlit 不触发）/
// projFullbrightQueue 闭包族（BJ278,消费位 flushTrailShade 内）/
// 翼光 overlay betsy(40)/trail45(45) 子函数链（mirrorPass 跳过）/
// 7d drawVanillaDustPass 全亮尘（DrawDust :63241 亦水前=同性质新登记）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Renderer } from '../src/render/Renderer';
import { TileStore } from '../src/world/TileStore';
import type { Enemy } from '../src/entities/Enemy';
import type { Camera } from '../src/render/Camera';
import type { World } from '../src/world/World';

const HERE = dirname(fileURLToPath(import.meta.url));
const RDR = readFileSync(join(HERE, '..', 'src/render/Renderer.ts'), 'utf8');
const TRAIL = readFileSync(join(HERE, '..', 'src/fx/TrailShader.ts'), 'utf8');

/** 区块抽取:函数体起点至下一 private 声明（防跨函数误匹配） */
function body(src: string, sig: string, span = 9000): string {
  const i = src.indexOf(sig);
  expect(i, `签名未命中: ${sig}`).toBeGreaterThan(-1);
  const j = src.indexOf('\n  private ', i + sig.length);
  return src.slice(i, j > i ? Math.min(j, i + span) : i + span);
}

describe('★BJ679 §1 逐队列镜像在位锁（源码锚+escapeVeilStroke 调用）', () => {
  it('7c drawBrightVines:茎蔓段镜像（Main.cs:22842-22868→DrawNPCs :63183 水前）', () => {
    const b = body(RDR, 'private drawBrightVines(');
    expect(b).toContain('Main.cs:22842-22868');
    expect(b).toContain('DrawNPCs :63183 水前');
    expect(b).toContain('if (vm) this.escapeVeilStroke(');
    expect(b).toContain('const vm = this._veilActive ? ctx.getTransform() : null;');
    // 同式重放:镜像 drawImage 与直绘同 dest 矩形
    expect(b.match(/mc\.drawImage\(scratch, 0, 0, chain\.sw, sh,/g)?.length).toBe(1);
  });

  it("7d' drawFaeling:tgt 整函数重放（Main.cs:24462→DrawNPCDirect_Faeling :26809）", () => {
    const b = body(RDR, 'private drawFaeling(e: Enemy, world: World, tgt?: CanvasRenderingContext2D)');
    expect(b).toContain('DrawNPCDirect_Faeling :26809');
    expect(b).toContain('if (!tgt && this._veilActive) {');
    expect(b).toContain('const camM = ctx.getTransform();');
    expect(b).toContain('this.drawFaeling(e, world, mc);');
    // box=历史轨迹包络（与拖尾同索引域 num4..5 步 3;★BJ739 单源迁 entVeilBox——谓词/镜像共用防漂移）
    expect(b).toContain('for (let i = num4; i >= 5; i -= 3) {');
    expect(b).toContain('const vb = Renderer.entVeilBox(e);');
    const eb = body(RDR, 'static entVeilBox(e: Enemy)');
    expect(eb).toContain('const padX = (e.w || 22) / 2 + 16 + 18 * scale;');
    expect(eb).toContain('const padY = (e.h || 22) / 2 + 30 + 18 * scale;');
    expect(eb).toContain('for (let i = num4; i >= 5; i -= 3) {');
  });

  it("7d' drawFairyBright:仙灵 583-585 镜像（FairyCritter→NPC 链→:63183 水前）", () => {
    const b = body(RDR, 'private drawFairyBright(e: Enemy)');
    expect(b).toContain('FairyCritterPink/Green/Blue');
    expect(b).toContain('DrawNPCs :63183 水前');
    expect(b).toContain('if (vm) this.escapeVeilStroke(');
    expect(b).toContain('mc.drawImage(img, 0, sy, fw, fh, -fw / 2, -fh / 2 + footFlush, fw, fh)');
  });

  it("7d' drawDeerclopsGlow:鹿角怪红雾镜像（Main.cs:26714,:26743/:26795）", () => {
    const b = body(RDR, 'private drawDeerclopsGlow(e: Enemy)');
    expect(b).toContain('DrawNPCDirect_Deerclops');
    expect(b).toContain(':26743');
    expect(b).toContain(':26795');
    expect(b).toContain('if (vm) this.escapeVeilStroke(');
    expect(b).toContain('mc.drawImage(c.c, c.x, c.y, c.w, c.h, -originX + l.dx, -originY + l.dy, sw, sh)');
  });

  it("7d'' drawFadingParticles:粒子镜像（Main.cs:63207-63208 水前;erase 拍不镜像登记）", () => {
    const b = body(RDR, 'private drawFadingParticles(cam: Camera, player?: Player): void', 11000);
    expect(b).toContain('Main.cs:63207-63208');
    expect(b).toContain('lighter 主拍 α=env 镜像,destination-out 削底拍不镜像');
    expect(b).toContain('if (vm) this.escapeVeilStroke(');
    expect(b).toContain('mc.drawImage(tinted, -tinted.width / 2, -tinted.height / 2)');
  });

  it("7d''' flushTowerGlow:四塔/516 残影镜像（Main.cs:24483-24520→:63183 水前）", () => {
    const b = body(RDR, 'private flushTowerGlow(cam: Camera, z: number, viewW: number, viewH: number): void', 14000);
    expect(b).toContain('Main.cs:24483-24520');
    expect(b).toContain('DrawNPCs :63183 水前');
    // 六镜像位:single/overlay/main × rot/norot
    expect(b.match(/this\.escapeVeilStroke\(/g)?.length).toBe(6);
    expect(b).toContain('const camT = this._veilActive ? ctx.getTransform() : null;');
  });

  it('7e flushWingGlow:主纹理镜像+overlay tgt 重放（PlayerDrawLayers.cs:655→:63204）', () => {
    const b = body(RDR, 'private flushWingGlow(cam: Camera, z: number): void', 12000);
    expect(b).toContain('PlayerDrawLayers.cs:655');
    expect(b).toContain('DrawPlayers_AfterProjectiles :63204 水前');
    expect(b).toContain('const wm = this._veilActive ? ctx.getTransform() : null;');
    expect(b).toContain('if (wm) this.escapeVeilStroke(');                                   // 主纹理
    expect(b).toContain('this.drawWingOverlay(e.p, e.slot, d, e.fr, cam, e.settled, e.clamp, e.vortexTint, e.dye, mc, true)');   // overlay 重放
  });

  it('7e flushItemGlow:op 级镜像（手持 :3148/:63204+掉落 :39408-39437/:63226 水前）', () => {
    const b = body(RDR, 'private flushItemGlow(): void', 12000);
    expect(b).toContain('PlayerDrawLayers.cs:3148 DrawPlayer_27_HeldItem');
    expect(b).toContain('Main.cs:39408-39437 DrawItems→:63226');
    expect(b).toContain('if (this._veilActive && gClamped > 0) {');
    expect(b).toContain('mc.drawImage(img, op.sx, sy, op.sw, op.sh, op.dx, op.dy, dWidth, dHeight)');
  });

  it('7e flushEyebrellaCloud:三拷贝镜像（PlayerDrawLayers.cs:4157→:63204 水前）', () => {
    const b = body(RDR, 'private flushEyebrellaCloud(cam: Camera, z: number): void');
    expect(b).toContain('PlayerDrawLayers.cs:4157');
    expect(b).toContain('const veilBase = this._veilActive ? ctx.getTransform() : null;');
    expect(b).toContain('if (veilBase) this.escapeVeilStroke(');
    expect(b).toContain('mc.drawImage(e.src as CanvasImageSource,');
  });

  it("7e' flushWhipFullbright:段级镜像（flag3 :36747-36749→DrawProjectiles :63199 水前）", () => {
    const b = body(RDR, 'private flushWhipFullbright(cam: Camera, z: number): void');
    expect(b).toContain('DrawProjectiles :63199 水前');
    expect(b).toContain(':36747-36749');
    expect(b).toContain('const qm = this._veilActive ? ctx.getTransform() : null;');
    expect(b).toContain('mc.drawImage(tinted, 0, 0, tex.width, tex.height,');
  });

  it("7f flushTrailStrips(⑫-b 拆分承续体):onBlit 钩子镜像（DrawProjectiles :63199 水前;GL 路余债注）", () => {
    const b = body(RDR, 'private flushTrailStrips(cam: Camera, z: number, viewW: number, viewH: number): void', 11000);
    expect(b).toContain('DrawProjectiles :63199');
    expect(b).toContain('const veilCamM = this._veilActive ? ctx.getTransform() : null;');
    expect(b).toContain('drawStripTrail(ctx, this, spec, veilCamM ? (bi) => {');
    expect(b).toContain('GL 路');
    // TrailShader 侧:CPU blit 位触发 onBlit（GL 路早退不触发）
    expect(TRAIL).toContain('onBlit?: (info: {');
    expect(TRAIL).toContain('if (onBlit) onBlit({ canvas: scratch, sw: rw, sh: rh, dx: bx, dy: by, dw: bw, dh: bh });');
  });

  it('flushNpcWhiteLift:白提亮镜像（NPC 链→DrawNPCs :63183 水前;tintA 支 lighter 主拍）', () => {
    const b = body(RDR, 'private flushNpcWhiteLift(cam: Camera, z: number, viewW: number, viewH: number): void', 11000);
    expect(b).toContain('DrawNPCs :63183 水前');
    expect(b).toContain('if (this._veilActive) {');
    expect(b).toContain("const gaM = q.tintA !== undefined ? 1 : (q.ga ?? npcWhiteLiftAlpha(q.vid) ?? 0.4);");
    expect(b).toContain('mc.drawImage(imgT, 0, q.sy, q.sw, q.sh, -q.sw / 2, q.by, q.sw, q.sh)');
  });
});

describe('★BJ679 §2 谓词扩区+会话域（drawLiquids/render）', () => {
  it('veil676 谓词含九路新队列+实体直绘族（veilEntities）+FadingParticles;★BJ741 玩家绑定六队列位置域', () => {
    // ★BJ741 分组:玩家绑定六队列（位置域=玩家域盒液检）∨世界绑定五队列（保守）∨实体∨粒子
    expect(RDR).toContain('const veilPlayerQ = this.lunarArmorQueue.length > 0 || this.armorGlowQueue.length > 0');
    expect(RDR).toContain('|| this.wingGlowQueue.length > 0 || this.eyebrellaQueue.length > 0;');
    expect(RDR).toContain('const veilWorldQ = (this.itemGlowQueue.length > 0 || this.whipFullbrightQueue.length > 0');
    expect(RDR).toContain('|| this.trailShadeQueue.length > 0 || this.towerGlowQueue.length > 0');
    expect(RDR).toContain('|| this.npcWhiteLiftQueue.length > 0)');
    // ★BJ742:世界绑定五队列位置域（逐条目盒液检）
    expect(RDR).toContain('&& (!Renderer.veilbox || this.veilWorldQHitsLiquid(world, cam, viewW, viewH, z));');
    expect(RDR).toMatch(/private veilWorldQHitsLiquid\(world: World, cam: Camera, viewW: number, viewH: number, z: number\)/);
    expect(RDR).toContain("const px = (m.a * cxL + m.c * cyL + m.e) * invK;");
    expect(RDR).toContain('const wx = (px - viewW / 2) / z + camRX;');
    expect(RDR).toContain('|| veilWorldQ || veil679Ent || veil679Fade;');
    // 位置域门:veilPlayerBox 缺省=旧行为(bg pass/其他调用方),旗关=旧行为
    expect(RDR).toContain('veilPlayerBox === undefined || !Renderer.veilbox');
    expect(RDR).toContain('|| Renderer.boxHasLiquid(world.store, veilPlayerBox)))');
    // 调用位:玩家域盒 bbox+96 传参
    expect(RDR).toContain('(player.w || 20) / 2 + 96, phh = (player.h || 42) / 2 + 96');
    // 实体直绘族 ID 面:677/668/583-585/259-260
    expect(RDR).toContain("n.vanillaId === 677 || n.vanillaId === 668");
    expect(RDR).toContain('n.vanillaId === 583 || n.vanillaId === 584 || n.vanillaId === 585');
    // fg pass 传 entities,bg 缺省空表零扫
    expect(RDR).toContain('veilEntities: Entity[] = [],');
    expect(RDR).toContain('z, false, entities,');
  });

  it('drawWingOverlay:tgt/mirrorPass 参数+betsy/trail45 子链跳过（余债登记）', () => {
    const b = body(RDR, 'private drawWingOverlay(p: Player, slot: number,', 26000);
    expect(b).toContain('tgt?: CanvasRenderingContext2D, mirrorPass = false): void');
    expect(b).toContain('const ctx = tgt ?? this.ctx;');
    expect(b.match(/if \(mirrorPass\) break;/g)?.length).toBe(2);
  });

  it('余债登记注在位（GL 面/子链面/新登记 7d 尘）——回滚收编即红', () => {
    expect(RDR).toContain('liqgl 批化帧 gate 路（FBO 回读,BJ676 既有）');
    expect(RDR).toContain('拖尾 GL 路（obj55 SM2/obj58 tech 渲入');
    expect(RDR).toContain('翼光 overlay 的 betsy(40)/trail45(45) 两个子函数链（mirrorPass 跳过）');
    expect(RDR).toContain('7d drawVanillaDustPass 全亮尘（原版 DrawDust :63241 亦水前=同性质新登记');
  });
});

// ===================== §3 行为锁（recording-ctx 直调,镜像 Stroke 序） =====================
/** 带仿射矩阵栈的 recording ctx（flush 消费位 translate/scale/rotate 后
 *  getTransform() 须返回合成矩阵——镜像 qm/camT 快照的判别面） */
function affineRecordingCtx() {
  const ops: Array<Record<string, unknown>> = [];
  type M = { a: number; b: number; c: number; d: number; e: number; f: number };
  let cur: M = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const stack: M[] = [];
  let alpha = 1;
  let comp = 'source-over';
  const mul = (x: M, y: M): M => ({
    a: x.a * y.a + x.c * y.b, b: x.b * y.a + x.d * y.b,
    c: x.a * y.c + x.c * y.d, d: x.b * y.c + x.d * y.d,
    e: x.a * y.e + x.c * y.f + x.e, f: x.b * y.e + x.d * y.f + x.f,
  });
  const ctx = {
    canvas: { width: 800, height: 600 },
    save: () => { stack.push({ ...cur }); ops.push({ op: 'save' }); },
    restore: () => { const s = stack.pop(); if (s) cur = s; ops.push({ op: 'restore' }); },
    translate: (x: number, y: number) => { cur = mul(cur, { a: 1, b: 0, c: 0, d: 1, e: x, f: y }); ops.push({ op: 'translate', a: [x, y] }); },
    scale: (x: number, y: number) => { cur = mul(cur, { a: x, b: 0, c: 0, d: y, e: 0, f: 0 }); ops.push({ op: 'scale', a: [x, y] }); },
    rotate: (r: number) => { const c0 = Math.cos(r), s0 = Math.sin(r);
      cur = mul(cur, { a: c0, b: s0, c: -s0, d: c0, e: 0, f: 0 }); ops.push({ op: 'rotate', r }); },
    setTransform: (m: M) => { cur = { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f }; ops.push({ op: 'setTransform', a: [m.a, m.b, m.c, m.d, m.e, m.f] }); },
    getTransform: () => ({ ...cur }),
    drawImage: (...a: unknown[]) => ops.push({ op: 'draw', a, alpha, m: { ...cur } }),
    fillRect: (...a: unknown[]) => ops.push({ op: 'fillRect', a, alpha }),
    beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {}, closePath: () => {},
    clearRect: (...a: unknown[]) => ops.push({ op: 'clearRect', a }),
    imageSmoothingEnabled: false,
    set fillStyle(_v: string) {}, get fillStyle() { return ''; },
    set strokeStyle(_v: string) {}, set lineWidth(_v: number) {},
  };
  Object.defineProperty(ctx, 'globalAlpha', {
    set(v: number) { alpha = v; ops.push({ op: 'alpha', v }); }, get() { return alpha; },
  });
  Object.defineProperty(ctx, 'globalCompositeOperation', {
    set(v: string) { comp = v; ops.push({ op: 'composite', v }); }, get() { return comp; },
  });
  Object.defineProperty(ctx, 'filter', { set(_v: string) {}, get() { return 'none'; } });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
}

/** flushNpcWhiteLift 行为锁:白提亮 519 缺省档镜像笔画（直绘+镜像同 α 同 dest） */
describe('★BJ679 §3 行为锁', () => {
  it('flushNpcWhiteLift（519 缺省 0.4 档）:一笔镜像,mask 重放=setTransform(qm)+α0.4+同 dest drawImage', async () => {
    const { Renderer } = await import('../src/render/Renderer');
    const rec = affineRecordingCtx();
    const strokes: Array<{ box: unknown; paint: (mc: CanvasRenderingContext2D) => void }> = [];
    const self = {
      atlas: { ensureVImage: (_k: string) => ({ width: 20, height: 80 }) } as never,
      ctx: rec.ctx,
      npcWhiteLiftQueue: [{
        vid: 519, tex: 'vanilla/NPC_519.png', sy: 0, sw: 20, sh: 20,
        cx: 50, cy: 60, rot: 0, mirror: true, scale: 1, by: -10,
      }],
      _veilActive: true,
      escapeVeilStroke: (box: unknown, paint: (mc: CanvasRenderingContext2D) => void) => { strokes.push({ box, paint }); },
      c10eCompositeIntoHud: () => {},   // ★塔桥㊸ 折叠头(2026-10-29)桩:合成 self 补员
    };
    (Renderer.prototype as unknown as {
      flushNpcWhiteLift: (c: unknown, z: number, vw: number, vh: number) => void;
    }).flushNpcWhiteLift.call(self, { x: 100, y: 200 } as never, 2, 800, 600);
    // 直绘主拍不变（bj-c1 F4 既有语义:缺省档 α=0.4 + mirror scale(-1,1)）
    expect(rec.ops.some((o) => o.op === 'alpha' && o.v === 0.4)).toBe(true);
    expect(rec.ops.some((o) => o.op === 'scale' && JSON.stringify(o.a) === '[-1,1]')).toBe(true);
    // 会话活性=恰好一笔镜像
    expect(strokes.length).toBe(1);
    // mask 重放:setTransform(qm)→α0.4→同 dest drawImage（qm=相机×本体同枢矩阵）
    const mrec = affineRecordingCtx();
    strokes[0]!.paint(mrec.ctx);
    const mset = mrec.ops.find((o) => o.op === 'setTransform') as { a: number[] };
    // 相机系:translate(400,300)·scale(2,2)·translate(-camRX,-camRY)×本体同枢
    // translate(50,60)·scale(-1,1)（mirror 面）→ a=-2/d=2（镜像翻转已入 mask 重放）
    expect(mset.a[0]).toBeCloseTo(-2, 9);
    expect(mset.a[3]).toBeCloseTo(2, 9);
    expect(mrec.ops.some((o) => o.op === 'alpha' && o.v === 0.4)).toBe(true);
    const mdraw = mrec.ops.find((o) => o.op === 'draw') as { a: unknown[] };
    // imgT drawImage:源 (0,0,20,20)→dest (-10,-10,20,20)（q.by=-10）
    expect(JSON.stringify(mdraw.a.slice(5))).toBe(JSON.stringify([-10, -10, 20, 20]));
    // box=veilAabb(qm, -sw/2, by, sw, sh) 页域 AABB（scale 2:宽 40+余量>40）
    const box = strokes[0]!.box as { x: number; y: number; w: number; h: number };
    expect(box.w).toBeGreaterThanOrEqual(40);
    expect(box.h).toBeGreaterThanOrEqual(40);
  }, 120000);

  it('flushTowerGlow（493 四向 norot 支）:一笔镜像含 4 拍 drawImage,box=四向并集,α=64/255', async () => {
    const { Renderer } = await import('../src/render/Renderer');
    const rec = affineRecordingCtx();
    const strokes: Array<{ box: unknown; paint: (mc: CanvasRenderingContext2D) => void }> = [];
    const q = {
      vid: 493, tex: 'vanilla/Glow_132.png', iw: 80, sy: 0, gh: 80,
      sw: 80, sh: 80, wx: 500, wy: 700, vx: 3, vy: 4, num: 4, xoff: 0, opacity: 1,
    };
    const self = {
      atlas: { ensureVImage: (_k: string) => ({ width: 80, height: 80 }) } as never,
      ctx: rec.ctx, towerGlowQueue: [q],
      _veilActive: true,
      escapeVeilStroke: (box: unknown, paint: (mc: CanvasRenderingContext2D) => void) => { strokes.push({ box, paint }); },
      c10eCompositeIntoHud: () => {},   // ★塔桥㊸ 折叠头(2026-10-29)桩:合成 self 补员
    };
    (Renderer.prototype as unknown as {
      flushTowerGlow: (c: unknown, z: number, vw: number, vh: number) => void;
    }).flushTowerGlow.call(self, { x: 100, y: 200 } as never, 2, 800, 600);
    expect(rec.ops.filter((o) => o.op === 'draw').length).toBe(4);   // 直绘四向不变
    expect(strokes.length).toBe(1);                                   // 恰一笔镜像
    const mrec = affineRecordingCtx();
    strokes[0]!.paint(mrec.ctx);
    const mdraws = mrec.ops.filter((o) => o.op === 'draw') as Array<{ a: unknown[] }>;
    expect(mdraws.length).toBe(4);                                    // 重放四拍
    const offs = Renderer.npcGlowVel4Offsets(3, 4, 4, 0);
    for (let k = 0; k < 4; k++) {
      expect(mdraws[k]!.a[5]).toBeCloseTo(500 + offs[k][0], 9);
      expect(mdraws[k]!.a[6]).toBeCloseTo(700 + offs[k][1], 9);
    }
    expect(mrec.ops.some((o) => o.op === 'alpha' && Math.abs((o.v as number) - 64 / 255) < 1e-9)).toBe(true);
    // box=四向 dest 并集（≥ 单帧 80×80,含 offsets 外扩）
    const box = strokes[0]!.box as { x: number; y: number; w: number; h: number };
    expect(box.w).toBeGreaterThanOrEqual(80);
    expect(box.h).toBeGreaterThanOrEqual(80);
  }, 120000);

  it('非会话帧零开销:_veilActive 缺席=零镜像笔（直绘原路径）', async () => {
    const { Renderer } = await import('../src/render/Renderer');
    const rec = affineRecordingCtx();
    const strokes: unknown[] = [];
    const self = {
      atlas: { ensureVImage: (_k: string) => ({ width: 80, height: 80 }) } as never,
      ctx: rec.ctx, towerGlowQueue: [{
        vid: 493, tex: 'vanilla/Glow_132.png', iw: 80, sy: 0, gh: 80,
        sw: 80, sh: 80, wx: 500, wy: 700, vx: 3, vy: 4, num: 4, xoff: 0, opacity: 1,
      }],
      escapeVeilStroke: (box: unknown, paint: unknown) => { strokes.push({ box, paint }); },
      c10eCompositeIntoHud: () => {},   // ★塔桥㊸ 折叠头(2026-10-29)桩:合成 self 补员
    };
    (Renderer.prototype as unknown as {
      flushTowerGlow: (c: unknown, z: number, vw: number, vh: number) => void;
    }).flushTowerGlow.call(self, { x: 100, y: 200 } as never, 2, 800, 600);
    expect(rec.ops.filter((o) => o.op === 'draw').length).toBe(4);   // 直绘四向照旧
    expect(strokes.length).toBe(0);                                   // 零镜像笔
    expect(rec.ops.some((o) => o.op === 'setTransform')).toBe(false); // 未触 getTransform 域
  }, 120000);
});


// ===================== ★BJ739 位置域检查（veilbox 缺省开;?veilbox=0 逃生门）=====================
// 【动因】aether 常驻 Faeling 空中巡飞=veil679Ent 恒真→整帧前景液体禁批回 CPU 链
// +7e 会话全家 2D（BJ738 探针:杀 677 后 8px 网格消失=机制归因）。盒内无液体 ⇒
// 水罩复合对本实体全透明（fgCanvas 盒内无水像素）=跳过视觉逐位同。
describe('★BJ739 veil 实体族位置域（entVeilBox/boxHasLiquid/谓词接线）', () => {
  it('entVeilBox:677=轨迹包络±(40+14·scale)（TrailCache 60,索引 54..5 步 3）;583-585=bbox+40;668/259-260=null（保守不检）', () => {
    const faeling = {
      vanillaId: 677, vanillaScale: 2, cx: 1000, cy: 2000, w: 22, h: 22,
      historyDepth: () => 60,
      histXAt: (i: number) => 1000 - i * 2,
      histYAt: () => 2000,
    } as unknown as Enemy;
    const b = Renderer.entVeilBox(faeling);
    expect(b).not.toBeNull();
    // 轨迹最远点 = histXAt(54)=1000-108=892;sound padX=11+16+36=63,padY=11+30+36=77
    expect(b!.x0).toBe(892 - 63); expect(b!.x1).toBe(1000 + 63);
    expect(b!.y0).toBe(2000 - 77); expect(b!.y1).toBe(2077);
    // 历史不足=恒返本体（histCount=0 → 包络退化为 cx/cy）
    const still = { ...faeling, historyDepth: () => 0 } as unknown as Enemy;
    const b2 = Renderer.entVeilBox(still);
    expect(b2!.x0).toBe(1000 - 63); expect(b2!.x1).toBe(1063);
    // 仙灵:24px 精灵同枢,bbox+40 覆盖
    const fairy = { vanillaId: 583, vanillaScale: 1, cx: 300, cy: 400, w: 20, h: 20,
      historyDepth: () => 0 } as unknown as Enemy;
    const bf = Renderer.entVeilBox(fairy)!;
    // hw=max(w,24)/2=12（最小精灵域钳——比 bbox 更保守,正确方向）
    expect(bf.x0).toBe(300 - 12 - 40); expect(bf.y1).toBe(400 + 12 + 40);
    // 域不定族=保守 null
    for (const vid of [668, 259, 260]) {
      expect(Renderer.entVeilBox({ vanillaId: vid, cx: 0, cy: 0, historyDepth: () => 0 } as unknown as Enemy)).toBeNull();
    }
  });

  it('boxHasLiquid:盒内液体格存在性（罩源=前景水=纯液体格,瀑布另链不进罩源）;边界钳制', () => {
    const st = new TileStore(64, 64);
    const i = st.idx(30, 30);
    st.liquid[i] = 255;
    expect(Renderer.boxHasLiquid(st, { x0: 30 * 16, y0: 30 * 16, x1: 31 * 16, y1: 31 * 16 })).toBe(true);
    expect(Renderer.boxHasLiquid(st, { x0: 40 * 16, y0: 40 * 16, x1: 41 * 16, y1: 41 * 16 })).toBe(false);
    // 负坐标/越界盒钳制不炸
    expect(Renderer.boxHasLiquid(st, { x0: -100, y0: -100, x1: 0, y1: 0 })).toBe(false);
    expect(Renderer.boxHasLiquid(st, { x0: 63 * 16, y0: 63 * 16, x1: 999 * 16, y1: 999 * 16 })).toBe(false);
  });

  it('★BJ742 veilWorldQHitsLiquid:itemGlow op 仿射重建世界位(往返恒等+干地/水边分档)+whip/trail/tower/npcWhiteLift 直盒', () => {
    const st = new TileStore(256, 256);
    // 液体@tile(125,62)=世界(2000..2016,992..1008)
    st.liquid[st.idx(125, 62)] = 255;
    // 帧参:viewW=800 viewH=600 z=2 cam=(1000,500) → camR=(1000,500)
    const cam = { x: 1000, y: 500 } as unknown as Camera;
    const W = { store: st } as unknown as World;
    const r = Object.create(Renderer.prototype) as unknown as Renderer;
    const setQ = (o: Record<string, unknown>) => Object.assign(r, o);
    // k=1 世界变换 m=[2,0,0,2,400-2·1000,300-2·500]（tile op 收集域）
    const M = { a: 2, b: 0, c: 0, d: 2, e: -1600, f: -700 } as unknown as DOMMatrix;
    const mkOp = (dx: number, dy: number) => ({ tex: 'x', sx: 0, sy: 0, sw: 16, sh: 16, dx, dy,
      blend: 'add' as const, tint: [1, 1, 1] as [number, number, number], alpha: 1 });
    // 手持 op（局部域,平移到世界 (2000,1000)）: m'=世界×local(平移 2000,1000)
    const ML = { a: 2, b: 0, c: 0, d: 2, e: -1600 + 2 * 2000, f: -700 + 2 * 1000 } as unknown as DOMMatrix;
    // 干地:火把在世界 (3000,1500)（tile 187/93 附近无液）
    setQ({ itemGlowQueue: [{ m: M, k: 1, ops: [mkOp(3000, 1500)] }], whipFullbrightQueue: [],
      trailShadeQueue: [], towerGlowQueue: [], npcWhiteLiftQueue: [] });
    expect(r['veilWorldQHitsLiquid'](W, cam, 800, 600, 2)).toBe(false);
    // 水边:火把在世界 (2000,1000)（液格上）
    setQ({ itemGlowQueue: [{ m: M, k: 1, ops: [mkOp(2000, 1000)] }] });
    expect(r['veilWorldQHitsLiquid'](W, cam, 800, 600, 2)).toBe(true);
    // 手持域（local 合成 m'）同点位命中=重建对两种收集域一致
    setQ({ itemGlowQueue: [{ m: ML, k: 1, ops: [mkOp(0, 0)] }] });
    expect(r['veilWorldQHitsLiquid'](W, cam, 800, 600, 2)).toBe(true);
    // 干地+local
    const MLD = { a: 2, b: 0, c: 0, d: 2, e: -1600 + 2 * 3000, f: -700 + 2 * 1500 } as unknown as DOMMatrix;
    setQ({ itemGlowQueue: [{ m: MLD, k: 1, ops: [mkOp(0, 0)] }] });
    expect(r['veilWorldQHitsLiquid'](W, cam, 800, 600, 2)).toBe(false);
    // whip 段点直盒:干地/水边
    setQ({ itemGlowQueue: [], whipFullbrightQueue: [{ pts: [{ x: 1995, y: 1000 }, { x: 2010, y: 1005 }], tex: { width: 12, height: 12 } as HTMLImageElement, color: [0, 0, 0, 0] }] });
    expect(r['veilWorldQHitsLiquid'](W, cam, 800, 600, 2)).toBe(true);
    setQ({ whipFullbrightQueue: [{ pts: [{ x: 2900, y: 1500 }, { x: 2950, y: 1550 }], tex: { width: 12, height: 12 } as HTMLImageElement, color: [0, 0, 0, 0] }] });
    expect(r['veilWorldQHitsLiquid'](W, cam, 800, 600, 2)).toBe(false);
    // tower/npcWhiteLift 直盒
    setQ({ whipFullbrightQueue: [], towerGlowQueue: [{ vid: 1, tex: 'x', iw: 1, sy: 0, gh: 1, sw: 16, sh: 16, wx: 2000, wy: 1000, vx: 0, vy: 0, num: 1, xoff: 0, opacity: 1 }] });
    expect(r['veilWorldQHitsLiquid'](W, cam, 800, 600, 2)).toBe(true);
    setQ({ towerGlowQueue: [], npcWhiteLiftQueue: [{ cx: 3000, cy: 1500, sw: 20, sh: 20, vid: 395, tex: 'x', sy: 0 }] });
    expect(r['veilWorldQHitsLiquid'](W, cam, 800, 600, 2)).toBe(false);
    setQ({ npcWhiteLiftQueue: [{ cx: 2005, cy: 1000, sw: 20, sh: 20, vid: 395, tex: 'x', sy: 0 }] });
    expect(r['veilWorldQHitsLiquid'](W, cam, 800, 600, 2)).toBe(true);
  });

  it('谓词接线+逃生门（源码锚）:veilbox 旗/entVeilHitsLiquid 谓词面/entVeilBox 镜像单源在位', () => {
    expect(RDR).toContain("new URLSearchParams(location.search).get('veilbox') !== '0'");
    expect(RDR).toContain('if (!Renderer.veilbox || Renderer.entVeilHitsLiquid(n, world.store)) {');
    // 镜像裁剪盒单源（漂移即红:谓词漏罩/过触发双风险）
    expect(RDR).toContain('const vb = Renderer.entVeilBox(e);');
  });

  it('entVeilHitsLiquid:677 悬停水面上方(~46px)逐样本不命中;贴水/入水命中;583 干地不命中', () => {
    const st = new TileStore(64, 64);
    // 液面 = y=32*16=512(行 32 满液)
    for (let x = 0; x < 64; x++) st.liquid[st.idx(x, 32)] = 255;
    // 疾飞(num9=1:54 帧位移 108px>hypot(32,16))悬停 46px 上方:轨迹盒底=样本+11+32+18.2=61.2
    // → 527.2>512 命中——spin 全幅可探水,罩正确保留
    const fast = {
      vanillaId: 677, vanillaScale: 1, cx: 32 * 16, cy: 512 - 46, x: 32 * 16, y: 512 - 46, w: 22, h: 22,
      historyDepth: () => 60,
      histXAt: (i: number) => 32 * 16 - i * 2,
      histYAt: () => 512 - 46,
    } as unknown as Enemy;
    expect(Renderer.entVeilHitsLiquid(fast, st)).toBe(true);
    // ★悬停(num9=0:位移≈0,spin 幅度∝num9→0)同 46px 上方:盒底=样本+11+18.2=29.2
    // → 495.2<512 不命中=解除整帧 CPU 液体(BJ739 收益主面)
    const still = {
      vanillaId: 677, vanillaScale: 1, cx: 32 * 16, cy: 512 - 46, x: 32 * 16, y: 512 - 46, w: 22, h: 22,
      historyDepth: () => 60,
      histXAt: () => 32 * 16,
      histYAt: () => 512 - 46,
    } as unknown as Enemy;
    expect(Renderer.entVeilHitsLiquid(still, st)).toBe(false);
    // 悬停 25px 上方:495.2+21=... 盒底=(512-25)+29.2=516.2>512 命中(贴水罩保留)
    const stillLow = { ...still, cy: 512 - 25, histYAt: () => 512 - 25 } as unknown as Enemy;
    expect(Renderer.entVeilHitsLiquid(stillLow, st)).toBe(true);
    // 疾飞 70px 上方:盒底=(512-70)+61.2=503.2<512 不命中
    const high = { ...fast, cy: 512 - 70, histYAt: () => 512 - 70 } as unknown as Enemy;
    expect(Renderer.entVeilHitsLiquid(high, st)).toBe(false);
    // 贴水(cy=500)
    const low = { ...fast, cy: 500, histYAt: () => 500 } as unknown as Enemy;
    expect(Renderer.entVeilHitsLiquid(low, st)).toBe(true);
    // 入水
    const dip = { ...fast, cy: 520, histYAt: () => 520 } as unknown as Enemy;
    expect(Renderer.entVeilHitsLiquid(dip, st)).toBe(true);
    // 轨迹探底而本体高位（轨迹样本盒命中）
    const trailDip = { ...fast, histYAt: (i: number) => (i > 40 ? 512 - 46 : 505) } as unknown as Enemy;
    expect(Renderer.entVeilHitsLiquid(trailDip, st)).toBe(true);
    // 仙灵:干地(液面远处)
    const fairyDry = { vanillaId: 583, vanillaScale: 1, cx: 32 * 16, cy: 200, w: 20, h: 20,
      historyDepth: () => 0 } as unknown as Enemy;
    expect(Renderer.entVeilHitsLiquid(fairyDry, st)).toBe(false);
    const fairyWet = { ...fairyDry, cy: 512 } as unknown as Enemy;
    expect(Renderer.entVeilHitsLiquid(fairyWet, st)).toBe(true);
    // 域不定族恒 true
    for (const vid of [668, 259, 260]) {
      expect(Renderer.entVeilHitsLiquid({ vanillaId: vid, cx: 100, cy: 100, historyDepth: () => 0 } as unknown as Enemy, st)).toBe(true);
    }
  });
});
