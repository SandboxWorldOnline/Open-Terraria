// ★C10e 分体画布呈现架构 源锚锁（2026-10-01,docs/c10e-design.md）
//
// 三画布栈（sky2D 底 / glCanvas 中=GL 唯一呈现面 / HUD 顶）+ 屏直出栈（GLPipeline
// over present）+ 帧分类路由 + 逃生门。运行时 GL 行为无法在 node vitest 验证
// （无 WebGL/DOM 合成）——像素等价由 scripts/_c10e-ab.mjs 双页对拍兜底;本文件
// =源文本纪律锁（三画布脚手架/present 位/逃生门/旗门结构不漂移）。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const RDR = readFileSync(resolve(__dirname, '../src/render/Renderer.ts'), 'utf8');
const SRC = readFileSync(resolve(__dirname, '../src/render/GLSpriteLayer.ts'), 'utf8');
const SKY = readFileSync(resolve(__dirname, '../src/render/SkyRenderer.ts'), 'utf8');
const PIPE = readFileSync(resolve(__dirname, '../src/render/GLPipeline.ts'), 'utf8');
const COMP = readFileSync(resolve(__dirname, '../src/render/GLWorldCompose.ts'), 'utf8');

describe('C10e 旗面与三画布脚手架', () => {
  it('?c10e 缺省开（★2026-10-01 转正:灰度期 =1 显式开→Mac+Windows 实机三轮定谳通过;?c10e=0=二级逃生门,逐帧回退语义不动）;构造期旗（HUD alpha 属性定死约束）', () => {
    expect(RDR).toContain("get('c10e') !== '0'");
    expect(RDR).not.toContain("get('c10e') === '1'");   // 灰度面已翻（防回改）
    expect(RDR).toContain('★转正（2026-10-01');          // 旗面史在旗内（防无证据动旗面）
    expect(RDR).toContain('static get c10e()');
    expect(RDR).toContain('static c10eSetForTest(v: boolean): void');
  });

  it('三画布创建:sky2D(2D)+glCanvas(元素工厂)+主画布=HUD;旗关=零创建', () => {
    // ★实机断裂修复锁（2026-10-01 补充定谳）:三画布必须全部出流 absolute——
    //  sky2D 留在正常文档流会占布局高把流内 HUD 顶出视口=「世界层消失」实报
    //  （HUD 背板回读有世界/DOM 不可见=布局与背板劈叉,冻结态对拍盲区）
    expect(RDR).toMatch(/if \(Renderer\.c10e\) \{\s*\n\s*this\.skyCanvas = document\.createElement\('canvas'\);\s*\n\s*this\.skyCanvas\.style\.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';\s*\n\s*this\.skyCtx = this\.skyCanvas\.getContext\('2d'\)!;\s*\n\s*this\.glCanvasEl = this\.mkGlCanvasEl\(\);\s*\n\s*this\.canvas\.style\.position = 'absolute';\s*\n\s*this\.canvas\.style\.inset = '0';\s*\n\s*\}/);
    expect(RDR).toMatch(/mainCtxAttrs\(\): CanvasRenderingContext2DSettings \{[\s\S]{0,200}if \(Renderer\.c10e\) a\.alpha = true;\s*\n\s*else if \(Renderer\.opaqueMain\) a\.alpha = false;/);
  });

  it('attach 挂载序=DOM paint 序=层序（sky2D→glCanvas→HUD）;glCanvas 懒插补挂', () => {
    expect(RDR).toMatch(/attach\(parent: HTMLElement\) \{\s*\n\s*\/\/ ★C10e[\s\S]{0,200}if \(this\.skyCanvas\) parent\.appendChild\(this\.skyCanvas\);\s*\n\s*if \(this\.glCanvasEl && !this\.glCanvasEl\.isConnected\) parent\.appendChild\(this\.glCanvasEl\);\s*\n\s*parent\.appendChild\(this\.canvas\);\s*\n\s*\}/);
  });

  it('呈现面元素:takeGlCanvasEl 换元(replaceWith——死上下文同元素 getContext 判例);注入 GLPipeline', () => {
    expect(RDR).toMatch(/takeGlCanvasEl\(\): HTMLCanvasElement \{[\s\S]{0,600}replaceWith\(nu\);/);
    expect(RDR).toContain('new GLPipeline(Renderer.SWPIPE_STAT, Renderer.c10e ? this.takeGlCanvasEl() : undefined)');
    expect(RDR).toContain('new GLPipeline(Renderer.SWPIPE_STAT, Renderer.c10e ? this.takeGlCanvasEl() : undefined)');
  });

  it('resize 三画布同步;dispose 摘 DOM 节点（主画布由 Game.destroy 同责）', () => {
    expect(RDR).toMatch(/if \(this\.skyCanvas\) this\.c10eSyncCanvasSize\(this\.skyCanvas\);\s*\n\s*if \(this\.glCanvasEl\) this\.c10eSyncCanvasSize\(this\.glCanvasEl\);/);
    expect(RDR).toMatch(/this\.skyCanvas\?\.remove\(\);\s*\n\s*this\.skyCanvas = null; this\.skyCtx = null;\s*\n\s*this\.glCanvasEl\?\.remove\(\);/);
  });

  it('呈现窗开闭:acquire 健康=show;死/退避=hide(陈旧屏防鬼影)', () => {
    expect(RDR).toMatch(/private c10ePipeAlive\(pipe: GLPipeline\): void \{[\s\S]{0,300}this\.c10eSetGlCanvasVisible\(true\);/);
    expect(RDR).toMatch(/private c10ePipeDead\(\): void \{[\s\S]{0,200}this\.c10eSetGlCanvasVisible\(false\);/);
  });
});

describe('C10e 帧分类与路由（帧头定谳——状态全 settle）', () => {
  it('帧门=旗×非拍照×非cpu×worldLayer 在×wK===1×非远云夹层;旗外帧=整帧旗关行为', () => {
    expect(RDR).toMatch(/const c10eBase = Renderer\.c10e && !this\._capturePass && !this\.isCpuRender\(\)\s*\n\s*&& this\.worldLayerEnabled;/);
    expect(RDR).toMatch(/this\._c10eFrame = c10eBase && wKc === 1 && !this\.sky\.farInterlayerActive\(cam\.y\);/);
  });

  it('夹层路由（世界→HUD blit）=worldRoute 谓词（去鸟群项——GL 桥化）∨shimmer(★BJ740 GL 桥臂);读 sky.draw 后状态与 opresent 门同相', () => {
    // ★C10e 二期（2026-10-01 F-inter 收刀,普查 scripts/_c10e-inter-census.mjs:
    //   常态 F-inter 100%=鸟群驻留触发,空转帧 0）:鸟群 'ambgl' quads 落屏栈 bg 侧槽,
    //   鸟帧路由回 F-pure（世界 over-present 叠其上）
    // ★BJ740（2026-10-30）:shimmer 臂 GL 化——黑幕+人工星 'sstars' over-present 直落
    //   glCanvas 中栈（lantern 桥同款）,独石帧不再强制世界 blit;_shimStarGl 帧头预备
    //   （预获取 pipe+照相/全帧变换保守除外）,逃生门 ?shimstargl=0 整臂回旧路由。
    expect(RDR).toMatch(/this\._c10eWorldToHud = this\._c10eFrame\s*\n\s*&& \(this\.sky\.worldRouteInterlayerPending\(\)\s*\n\s*\|\| \(this\.monoFilters\.shimmerAlpha > 0 && !this\._shimStarGl\)\);/);
    // BJ740 预备臂+旗+GL 直出调用+2D 回退臂在位
    expect(RDR).toMatch(/get\('shimstargl'\) !== '0'/);
    expect(RDR).toContain('this._shimStarGl = null;');
    expect(RDR).toContain('this.sky.drawShimmerStarsGL(this._shimStarGl, viewW, viewH, cam.y, shimA0);');
    expect(RDR).toContain('this.sky.drawShimmerStars(ctx, viewW, viewH, cam.y, shimA0);');
    expect(SKY).toMatch(/drawShimmerStarsGL\(gl: GLSpriteLayer, viewW: number, viewH: number, camY: number, shim: number\)/);
    expect(SKY).toContain("gl.texFromImage('shimveil:px', px, false, true)");
    expect(SKY).toContain('gl.end(true, true);');
    // 门单源（两臂共用防分叉）
    expect(SKY).toMatch(/private shimmerStarGate\(camY: number, shim: number\)/);
  });

  it('★谓词分工锁:worldRoute=opresentInterlayerPending 去鸟群三项+lantern 项（★A3 灯笼夜帧回收——far/near 灯带已全 GL 桥化,灯夜帧世界回归 over present）;旧谓词原样保留（opresent 延迟门+合并门继续用——鸟帧/灯帧禁 pass3 合并/云并会,合并 present=天空+世界单 quad,鸟/灯 quads 无法插入其间会被云盖住;分回合 bg present→夹层 quads→世界 present 才是正确层序）', () => {
    // 新谓词:未桥化内容全保留（party/slime/martin/drama）,鸟群三项+lantern 摘除
    expect(SKY).toMatch(/worldRouteInterlayerPending\(\): boolean \{\s*\n\s*if \(this\.fx\.party && this\.fx\.surfaceY > 0\) return true;\s*\n\s*if \(this\.slimeSky\.isActive \|\| this\.martianSky\.isActive\) return true;\s*\n\s*if \(this\.dramaCore !== null \|\| this\.dramaPieces\.length > 0 \|\| this\.dramaExplosions\.length > 0\) return true;\s*\n\s*return false;/);
    // 旧谓词原样（含鸟群三项+lantern 项——opresent-single-present.test.ts 的 opresentWanted 锚依赖）
    expect(SKY).toMatch(/opresentInterlayerPending\(\): boolean \{\s*\n\s*if \(this\.lanternOpacity > 0\.001\) return true;[\s\S]{0,340}this\.ambEntities\.length > 0 \|\| this\.pendingAmbientSpawns\.length > 0[\s\S]{0,120}ambNextAttempt <= 2[\s\S]{0,40}return false;/);
  });

  it('★鸟群 GL 桥锁（ambPlan 单源/emitAmbienceGl all-or-nothing/ambgl 会话/over present）', () => {
    // 单源:2D 循环与 GL 发射共用 ambPlan（防计算双份漂移;星批 starCompute 同范式）
    expect(SKY).toContain('const p = this.ambPlan(e, viewW, viewH, camX, camY, atmo, sr, sg, sb);');
    expect(SKY).toContain('private ambPlan(e: AmbientEnt');
    // GL 分支:gl 在场才 emit,失败整支回 2D（宁回退不丢内容）
    expect(SKY).toMatch(/if \(gl && this\.emitAmbienceGl\(gl, ctx, viewW, viewH, camX, camY, atmo, sr, sg, sb\)\) return;/);
    // all-or-nothing:纹理预解析先于 begin（B2b 判例——半截 quads 不可回退）
    expect(SKY).toMatch(/const entry = gl\.texFromImage\(`ambt:\$\{pl\.key8\}`, pl\.tinted\);\s*\n\s*if \(!entry\) return false;/);
    expect(SKY).toMatch(/gl\.begin\('ambgl'\);\s*\n\s*if \(gl\.unavailable\) return false;/);
    // over present=入屏栈（bg 之后/世界之前）;quadSprite 中心锚+rot+flipX 对位 2D
    expect(SKY).toMatch(/gl\.end\(true, true\);/);
    expect(SKY).toMatch(/gl\.quadSprite\(entry, 0, 0, pl\.fw, pl\.fh, cx - dw \/ 2, cy - dh \/ 2, dw, dh,\s*\n\s*\{ alpha: pl\.alpha, rot: pl\.e\.rotation, flipX: pl\.flip, smooth: false \}\);/);
    // Renderer 调用点:纯帧+屏栈开才传层（夹层帧/退避窗=2D 原路径）
    expect(RDR).toMatch(/const ambGl = this\._c10eFrame && this\.swPipe\?\.screenStackMode\s*\n\s*\? this\.acquireCloudPipe\(\) : null;\s*\n\s*this\.sky\.drawAmbience\(ctx, viewW, viewH, cam\.x, cam\.y, 16\.7, ambGl\);/);
  });

  it('sky.draw 目标画布分支:c10e 帧=sky2D;旗关/回退=原主 ctx;星直出同门 farDeferGate', () => {
    expect(RDR).toContain('this.sky.draw(this._c10eFrame ? (this.skyCtx ?? ctx) : ctx, clock, viewW, viewH, cam.x, 16.7, cam.y);');
    expect(RDR).toContain('this.sky.c10eStarDirect = this._c10eFrame && this.sky.farDeferGate;');
  });

  it('pipe 屏栈机制随帧分类启停（回退帧 present 全走原路径）;帧首清屏闩复位', () => {
    expect(RDR).toMatch(/if \(this\.swPipe\) \{\s*\n\s*this\.swPipe\.screenStackMode = this\._c10eFrame;\s*\n\s*if \(this\._c10eFrame\) this\.swPipe\.clearScreenForStack\(\);\s*\n\s*\}/);
  });

  it('★帧首 HUD 清屏锁（2026-10-01 前景拖影定谳）:c10e 帧 clearRect 主画布——分体后天空落 sky2D,HUD 无全幅不透明垫底,世界 blit source-over 会逐帧叠陈旧残留（活机实锤 hudRed=125 vs glRed=0/skyRed=0;探针 scripts/_c10e-trail-locate.mjs）。回退帧仍靠天空渐变自净,不在此清', () => {
    expect(RDR).toMatch(/if \(this\._c10eFrame\) \{\s*\n\s*ctx\.save\(\);\s*\n\s*ctx\.setTransform\(1, 0, 0, 1, 0, 0\);\s*\n\s*ctx\.clearRect\(0, 0, this\.canvas\.width, this\.canvas\.height\);\s*\n\s*ctx\.restore\(\);\s*\n\s*\}/);
    // 清屏位必须在 glCanvas 帧头清屏同区（帧头=任何 HUD 落笔前）
    const iHud = RDR.indexOf('ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)');
    const iStack = RDR.indexOf('this.swPipe.clearScreenForStack();');
    expect(iHud).toBeGreaterThan(-1);
    expect(iStack).toBeGreaterThan(-1);
    expect(Math.abs(iHud - iStack)).toBeLessThan(600);
  });

  it('★条带 shader alpha=max(rgb) 锁（2026-10-01 透明 HUD 黑块定谳）:obj58/obj55 条带几何全域写 a=1 时,glfx 画布 lighter 叠透明 HUD 连 alpha 一起加=暗 texel(rgb≈0,a=1)变不透明黑块（天顶剑/彩虹魔杖黑带实报）。a=max(rgb)=预乘读出零钳制（rgb≤a 恒成立）+旧不透明画布 lighter 只加 rgb 不读源 alpha=逐位不变+透明 HUD 暗处 a≈0 保留 dst', () => {
    expect((SRC.match(/oC = vec4\(oc\.rgb, max\(oc\.r, max\(oc\.g, oc\.b\)\)\);/g) ?? []).length).toBe(2);
    expect(SRC).not.toContain('oC = vec4(oc.rgb, 1.0);');   // a=1 恒写禁回归
    // 上屏链保持 'lighter' 加算（flushTrailShade）——改混合式会丢加算语义
    expect(RDR).toMatch(/globalCompositeOperation = 'lighter';\s*\n\s*ctx\.drawImage\(gx\.canvas, 0, 0\);/);
  });
});

describe('C10e GLPipeline 屏直出栈', () => {
  it('screenStackMode/screenCleared/屏栈 API 齐备;over=premul 叠合入栈,off=直写不入栈（★K1-2:present 委托 presentTexTo——premul+入栈仅 over∧screenStackMode,栈关 over=off 直写语义逐位保持;screenStackView 只读暴露）', () => {
    expect(PIPE).toContain('screenStackMode = false;');
    expect(PIPE).not.toContain('screenCleared');   // ★实机拖影定谳:帧首清屏闩废除（显式帧头清屏替代）
    expect(PIPE).toContain('clearScreenForStack(): void');
    expect(PIPE).toContain('restackScreen(): void');
    expect(PIPE).toMatch(/present\(src: PipelineFbo, over = false\): void \{[\s\S]{0,400}const stackOver = over && this\.screenStackMode;\s*\n\s*if \(stackOver\) this\.screenStack\.push\(src\);\s*\n\s*this\.presentTexTo\(null, src\.tex, stackOver, 1\);/);
    // presentTexTo=组装口（屏栈重放/基底直写;不入屏栈——不变式唯一写点仍在 present）
    expect(PIPE).toMatch(/presentTexTo\(target: PipelineFbo \| null, tex: WebGLTexture, over: boolean, flipY: number\): void \{[\s\S]{0,400}this\.setBlend\(over \? 'premul' : 'off'\);[\s\S]{0,300}this\.drawQuad\(this\.presentProg, \[0, 0, this\.frameW, this\.frameH\], flipY\);/);
    expect(PIPE).toMatch(/get screenStackView\(\): readonly PipelineFbo\[\] \{\s*\n\s*return this\.screenStack;\s*\n\s*\}/);
    // restack 先快照再清（clear 清栈——重放源须保序）
    expect(PIPE).toMatch(/restackScreen\(\): void \{[\s\S]{0,200}const stack = this\.screenStack\.slice\(\);[\s\S]{0,200}for \(const f of stack\) this\.present\(f, true\);/);
  });

  it('帧首清屏=Renderer 显式（2026-10-01 实机拖影定谳:代理清屏废除——revive 帧清错目标/帧类切换失效）;end over 缺省参', () => {
    expect(SRC).not.toContain('clearScreenForStack');   // 代理清屏已删（begin 内零触碰）
    expect(PIPE).toMatch(/clearScreenForStack\(\): void \{[\s\S]{0,300}this\.bindTarget\(null\);/);   // 清屏目标=默认帧缓冲
    expect(RDR).toMatch(/if \(this\.swPipe\) \{\s*\n\s*this\.swPipe\.screenStackMode = this\._c10eFrame;\s*\n\s*if \(this\._c10eFrame\) this\.swPipe\.clearScreenForStack\(\);\s*\n\s*\}/);
    expect(SRC).toContain('end(present = true, over = false): void');
    expect(SRC).toContain('get pipeBackend(): GLPipeline | null');
  });

  it('GLWorldCompose compose 尾 present 透传 presentOver（双出口同透传）', () => {
    expect(COMP).toContain('pipeline.present(this.fboOpresent, presentOver);');
    expect(COMP).toContain('pipeline.present(this.fboWarped, presentOver);');
  });
});

describe('C10e present 位处置（设计文档 §二 P1-P14）', () => {
  it('P2 bg split 收口 over 直出 skip blit;bg 2D 回退路由 sky2D', () => {
    expect(RDR).toContain('if (!(this._c10eFrame && glbg.pipeBackend)) ctx.drawImage(glbg.canvas, 0, 0);');
    expect(RDR).toContain('const bg2dCtx = this._c10eFrame ? (this.skyCtx ?? ctx) : ctx;');
  });

  it('P5 自然星直出（end(over)+无 blit）;P6 人工星保留 blit→HUD+restack（veil 同层序）', () => {
    expect(SKY).toMatch(/if \(this\.c10eStarDirect && layer\.pipeBackend\) \{\s*\n\s*this\.emitStarBatchGL\(layer, batch, 'sstarn', viewW, viewH, true\);\s*\n\s*\} else \{/);
    expect(SKY).toMatch(/emitStarBatchGL\(layer, batch, 'sstars', viewW, viewH\);[\s\S]{0,700}ctx\.drawImage\(layer\.canvas, 0, 0\);[\s\S]{0,200}layer\.pipeBackend\?\.restackScreen\(\);/);
  });

  it('P7 世界合成:纯帧=compose 尾 over 直出无 blit;夹层帧=blit→HUD+restack（双支同构）', () => {
    expect(RDR.match(/if \(!\(this\._c10eFrame && !this\._c10eWorldToHud\)\) \{/g)?.length).toBe(2);
    expect(RDR.match(/if \(this\._c10eFrame\) wcL?\.pipeline\.restackScreen\(\);/g)?.length).toBe(2);
    expect(RDR).toContain('this._c10eFrame && !this._c10eWorldToHud,');
  });

  it('P9 fullbright/lightFast accFbo:纯帧 over 直出;夹层帧 blit+restack', () => {
    expect(RDR.match(/if \(this\._c10eFrame && !this\._c10eWorldToHud && this\.swPipe\.screenStackMode\) \{/g)?.length).toBe(2);
  });

  it('P10/P11 内部读回 present 后 restack（degradeAcc/bgl 桥——「glCanvas=屏栈」不变式）', () => {
    expect(RDR).toMatch(/this\.worldCtxLayer\.drawImage\(this\.swPipe\.canvas, 0, 0\);\s*\n\s*this\.worldCtxLayer\.restore\(\);\s*\n\s*\/\/ ★C10e[\s\S]{0,200}if \(this\._c10eFrame\) this\.swPipe\.restackScreen\(\);/);
    expect(RDR).toMatch(/wctx\.drawImage\(glw\.canvas, 0, 0, lw, lh\);\s*\n\s*wctx\.restore\(\);\s*\n\s*\/\/ ★C10e[\s\S]{0,200}if \(this\._c10eFrame && glw\.pipeBackend\) glw\.pipeBackend\.restackScreen\(\);/);
  });

  it('P14 滤镜链输入三档（★K1-2 2026-10-02）:?c10ek1=0=三画布折叠 scratch（K1-前全旧行为）;xform 合成帧=HUD 直取（K1-1 收益保留）;其余 c10e 滤镜帧=屏栈 FBO 直入 drawChainPipeStack（链输入组装全 GPU 侧——省 P1/P2 合成 2 次 2D 全幅腿+折叠跨上下文腿）;防御窗/2D 回退链=折叠 scratch 原路径', () => {
    expect(RDR).toMatch(/if \(!Renderer\.c10eK1\) \{\s*\n\s*chainOk = gl\.drawChainPipe\(pipe, this\.c10eChainSource\(\), passes,/);
    expect(RDR).toMatch(/\} else if \(this\._c10eFrame && this\._c10eComposited\) \{\s*\n\s*chainOk = gl\.drawChainPipe\(pipe, this\.canvas, passes,/);
    expect(RDR).toContain('gl.drawChainPipeStack(pipe, { sky: this.skyCanvas, hud: this.canvas, useHud: true }, passes, [');
    expect(RDR).toContain("this.sfxPathStats['pipe-stack']");
    expect(RDR).toContain('if (!chainOk && gl.drawChain(this.c10eChainSource(), passes,');
    expect(RDR).toContain('private c10eChainSource(): HTMLCanvasElement {');
  });

  it('P1/P2 全帧合成（死亡灰化/重力翻转自拷消费者前置）;幂等闩;★K1-2 门收窄（合成回归 xform 专属——K1-1 滤镜待发臂摘除,滤镜帧链输入改屏栈组装不再需要全帧合成垫底）', () => {
    expect(RDR).toMatch(/private c10eCompositeIntoHud\(\): void \{[\s\S]{0,200}if \(this\._c10eComposited \|\| !this\._c10eFrame\) return;\s*\n\s*this\._c10eComposited = true;/);
    expect(RDR).toMatch(/if \(this\._c10eFrame && this\._c10eWorldToHud && !this\._c10eComposited\s*\n\s*&& this\.c10eFullXformCond\(player, world\)\) \{\s*\n\s*this\.c10eCompositeIntoHud\(\);\s*\n\s*\}/);
    expect(RDR).toMatch(/if \(this\._c10eFrame && !this\._c10eComposited\s*\n\s*&& this\.c10eFullXformCond\(player, world\)\) \{\s*\n\s*this\.c10eCompositeIntoHud\(\);\s*\n\s*\}/);
    // ★K1-2:P1/P2 合成门零滤镜待发臂（pending 残留=回归面——滤镜帧必须走 Stack 档）
    expect(RDR.match(/c10eFullXformCond\(player, world\) \|\| this\._c10eFilterPending/g)?.length ?? 0).toBe(0);
    // ★K1:合成 destination-over 落既有 HUD 覆盖层之下+gl→sky 逆序垫底
    //  （空 HUD 帧与 source-over sky→gl 逐位同;气球/credits/2D 回退类不透明天空埋层消除）
    expect(RDR).toMatch(/ctx\.globalCompositeOperation = 'destination-over';[\s\S]{0,200}ctx\.drawImage\(this\.glCanvasEl, 0, 0\);\s*\n\s*if \(this\.skyCanvas\) ctx\.drawImage\(this\.skyCanvas, 0, 0\);/);
  });

  it('P15 天气色罩 GL quad mini-session（bg 后/近云前原层序位）;回退=fillRect 原路径', () => {
    expect(SKY).toMatch(/const glLayer = this\.c10eOver \? this\.cloudGlLayer : null;[\s\S]{0,600}glLayer\.begin\('wtint'\);\s*\n\s*glLayer\.fillQuad\(0, 0, viewW, viewH,/);
    expect(SKY).toContain("ctx.fillStyle = `rgb(${Math.round(p.color[0] * 255)},${Math.round(p.color[1] * 255)},${Math.round(p.color[2] * 255)})`;");
  });

  it('★K1 滤镜待发预测单源（2026-10-01）:谓词=块门保守超集（sfxPipe×c10eK1 门/anyInUse∨heatInUse/月总倒计时/塔斜坡双臂）;帧分类下半 P1 前计算一次', () => {
    expect(RDR).toContain('private c10eFilterPending(world: World, player: Player): boolean {');
    expect(RDR).toMatch(/if \(!Renderer\.sfxPipe \|\| !Renderer\.c10eK1\) return false;\s*\n\s*const mono = this\.monoFilters;\s*\n\s*if \(mono\.anyInUse \|\| mono\.heatInUse\) return true;\s*\n\s*if \(world\.lunarEvent && world\.lunarEvent\.moonLordCountdown > 0\) return true;\s*\n\s*if \(TOWER_KEYS\.some\(\(k\) => this\._towerFilterOpacity\[k\] > 0\)\) return true;\s*\n\s*const tows = this\._lunarTowerFilterTargets\(this\._frameEntities, player\.cx, player\.cy, world\);\s*\n\s*return TOWER_KEYS\.some\(\(k\) => tows\[k\] != null\);/);
    expect(RDR).toMatch(/this\._c10eFilterPending = this\._c10eFrame\s*\n\s*&& this\.c10eFilterPending\(world, player\);/);
    // 逃生门:static c10eK1（?c10ek1=0 逐项回 K1 前行为）
    expect(RDR).toMatch(/private static _c10eK1 = \(\(\) => \{[\s\S]{0,200}get\('c10ek1'\) !== '0';/);
    expect(RDR).toContain('static get c10eK1() { return this._c10eK1; }');
  });
});

describe('C10e 逃生门与登记边界', () => {
  it('cloudpipe=0 在 c10e 收窄（双注入点强制共管）;compose 同判据', () => {
    expect(RDR).toContain('(Renderer.cloudPipe || Renderer.c10e) ? this.acquireCloudPipe() : this.acquireGL()');
    expect(RDR).toContain('if (!Renderer.cloudPipe && !Renderer.c10e) return new GLWorldCompose(\'worldCompose\', null);');
    expect(RDR).toMatch(/if \(this\.worldCompose && this\.worldCompose\.ownsPipe !== !\(Renderer\.cloudPipe \|\| Renderer\.c10e\)\) \{/);
  });

  it('SkyRenderer 旗逐帧重置（菜单/非世界帧恒 false=零行为变化）;★A3 farInterlayerActive 摘 lantern 项（灯带全桥化,灯夜帧回归 F-pure;aurora 项保留=唯一未桥化 far 夹层）', () => {
    expect(SKY).toContain('c10eOver = false;');
    expect(SKY).toContain('c10eStarDirect = false;');
    expect(SKY).toMatch(/farInterlayerActive\(camY: number\): boolean \{\s*\n\s*void camY;\s*\n\s*return this\.aurora\.tileColorState\(\) !== null;\s*\n\s*\}/);
  });

  it('★A3 灯笼夜帧回收·far 带 stash 桥（C10d flushFarDeferredGL 同款）:far 带入口清残留→farDeferGate 选集 stash→bg 会话首段发射（远云后/biomeBg 前）→回退 2D 重放', () => {
    // far 带每帧入口清（未消费帧=本帧重产,同 farDeferred 入口清语义）
    expect(SKY).toMatch(/if \(band === 'far'\) this\.farLanternDeferred = null;/);
    // 选集门=far 带×farDeferGate（色罩/黑闪/remix/云 GL 门同源;命中=2D 循环改 stash）
    expect(SKY).toMatch(/const stash: Array<LanternPlan> \| null = band === 'far' && this\.farDeferGate \? \[\] : null;/);
    // stash 写入（plans 空=零 stash——全剔除帧零提交）
    expect(SKY).toMatch(/if \(stash\.length\) this\.farLanternDeferred = \{ plans: stash, tex, fw, fh, hourY, m: stashM, k: stashK \};/);
    // 发射:C10d 批令牌形态（不 begin 不 end,quads 落 FBO('bg') 段）;纹理解析失败=本帧弃（far 云同款）
    expect(SKY).toMatch(/flushFarLanternGL\(layer: GLSpriteLayer\): void \{\s*\n\s*const d = this\.farLanternDeferred;\s*\n\s*this\.farLanternDeferred = null;\s*\n\s*if \(!d \|\| !d\.plans\.length \|\| layer\.unavailable\) return;\s*\n\s*const entry = layer\.texFromImage\('lantern:Extra_134', d\.tex\);\s*\n\s*if \(!entry\) return;/);
    // Renderer 双支发射位=flushFarDeferredGL 之后（远云后/biomeBg 前=原 2D 位 4741）
    expect(RDR.match(/this\.sky\.flushFarDeferredGL\(glbg, ctx\);\s*\n\s*(\/\/[^\n]*\n\s*)*this\.sky\.flushFarLanternGL\(glbg\);/g)?.length).toBe(2);
    // 2D 回退:replayFarDeferred2D 之后、biomeBg 2D 之前（灯在云上/山层下=原层序）
    expect(RDR).toMatch(/this\.sky\.replayFarDeferred2D\(bg2dCtx\);\s*\n\s*(\/\/[^\n]*\n\s*)*this\.sky\.replayFarLantern2D\(bg2dCtx\);\s*\n\s*this\.biomeBg\.draw\(bg2dCtx/);
  });

  it('★A3 灯笼夜帧回收·near 带 lantern mini-session 桥（bird ambgl 同族）:纹理预解析先于 begin/all-or-nothing 回退/over present 入屏栈', () => {
    // gl 线程:drawLanternsNear 第 7 参 → drawLanterns('near', gl)
    expect(SKY).toMatch(/drawLanternsNear\(ctx: CanvasRenderingContext2D, viewW: number, viewH: number, camX: number, camY: number, dtMs: number, gl\?: GLSpriteLayer \| null\): void \{\s*\n\s*this\.drawLanterns\(ctx, viewW, viewH, camX, camY, dtMs, 'near', gl\);\s*\n\s*\}/);
    // 纹理预解析【先于】begin（B2b 判例）;begin 失败=零半成品整支回 2D
    expect(SKY).toMatch(/glEntry = gl\.texFromImage\('lantern:Extra_134', tex\);\s*\n\s*if \(glEntry\) \{\s*\n\s*gl\.begin\('lantern'\);\s*\n\s*if \(gl\.unavailable\) glEntry = null;/);
    // over present=入屏栈（bg 之后/世界之前,原 2D 位）
    expect(SKY).toMatch(/if \(glEntry\) \{ gl!\.end\(true, true\); this\.glInterlayerEmitted = true; return; \}/);   // ★A3 债收齐:发射标记行随盘刷新
    // Renderer 调用点:纯帧+屏栈开才传层（夹层帧/退避窗=2D 原路径;bird ambGl 同门）
    expect(RDR).toMatch(/const lantGl = this\._c10eFrame && this\.swPipe\?\.screenStackMode\s*\n\s*\? this\.acquireCloudPipe\(\) : null;\s*\n\s*this\.sky\.drawLanternsNear\(ctx, viewW, viewH, cam\.x, cam\.y, 16\.7, lantGl\);/);
  });

  it('★A3 单灯计划单源（2D 兜底/GL 发射/far stash 三路共用;光晕三副本在前主贴图在后=2D 叠序保序;quadSprite rot 中心锚 ≙ 2D translate·rotate）', () => {
    // 计划结构（alpha 表达式逐字同旧 2D 内联式）
    expect(SKY).toMatch(/alphaGlow: 0\.4 \* mul \* this\.lanternOpacity \* flicker,\s*\n\s*alphaMain: 0\.47 \* mul \* this\.lanternOpacity,/);
    // 2D 兜底与 replay 共用单实现（防双路漂移）
    expect(SKY.match(/this\.drawLanternPlan2D\(ctx, tex, fw, fh, hourY, plan\);/g)?.length).toBe(1);
    expect(SKY).toMatch(/for \(const p of d\.plans\) this\.drawLanternPlan2D\(ctx, d\.tex, d\.fw, d\.fh, d\.hourY, p\);/);
    // GL 发射:光晕×3+主贴图=4 quads,smooth:false（2D imageSmoothingEnabled=false 同档）
    expect(SKY).toMatch(/\{ alpha: p\.alphaGlow, rot: p\.rot, smooth: false \}/);
    expect(SKY).toMatch(/\{ alpha: p\.alphaMain, rot: p\.rot, smooth: false \}/);
    expect(SKY).toContain("layer.texFromImage('lantern:Extra_134', d.tex)");
  });

  it('sky2D 上下文死亡重建（recreateAuxCanvases——replaceWith 保 DOM 位次）', () => {
    expect(RDR).toMatch(/if \(this\.skyCtx && \(this\.skyCtx as CanvasRenderingContext2D & \{ isContextLost\?: \(\) => boolean \}\)\.isContextLost\?\.\(\)\) \{\s*\n\s*const nu = document\.createElement\('canvas'\);\s*\n\s*this\.skyCanvas!\.replaceWith\(nu\);\s*\n\s*this\.skyCanvas = nu;\s*\n\s*this\.skyCtx = nu\.getContext\('2d'\)!;/);
  });

  it('★A3 债收齐锁（2026-10-01）:灯笼夜推进单源（±0.01/帧=原版速率;far+near 双推进 ±0.02 退役）+GL 夹层增量合成+farDeferred 深度门早退清', () => {
    // 债②:推进唯一写点=advanceLanternNight（sky.draw 头调用）;drawLanterns 只读
    expect(SKY).toContain('private advanceLanternNight(dtMs: number): void {');
    expect(SKY).toContain('this.advanceLanternNight(dtMs);');
    expect(SKY.match(/this\.lanternOpacity = Math\.max\(0, Math\.min\(1, this\.lanternOpacity \+ \(up \? 0\.01 : -0\.01\)/g)?.length).toBe(1);   // 写点唯一
    expect(SKY).not.toContain('+ (up ? 0.01 : -0.01) * (dtMs / (1000 / 60))));\n    if (this.lanternOpacity');   // 旧双推进位（drawLanterns 内）已删
    // 债①:GL 夹层发射标记+增量合成（xform∩inter 稀有窗自拷源补全）
    expect(SKY).toContain('glInterlayerEmitted = false;');
    expect(SKY.match(/this\.glInterlayerEmitted = true;/g)?.length).toBe(2);   // lantern 会话+ambgl 会话两发射位
    expect(RDR).toMatch(/this\.sky\.glInterlayerEmitted = false;/);   // 帧头清
    expect(RDR).toMatch(/if \(this\._c10eFrame && this\._c10eWorldToHud && this\._c10eComposited\s*\n\s*&& this\.sky\.glInterlayerEmitted\) \{\s*\n\s*this\.c10eCompositeGlDelta\(\);/);
    expect(RDR).toMatch(/private c10eCompositeGlDelta\(\): void \{[\s\S]{0,300}ctx\.drawImage\(this\.glCanvasEl, 0, 0\);/);
    // 债③:farDeferred 深度门早退帧也清（单帧陈旧 flush 根除;farLanternDeferred 入口清已在）
    expect(SKY).toMatch(/if \(camTop >= this\.fx\.surfaceY \+ 16\) \{ this\.farDeferred = null; return; \}/);
  });
});
