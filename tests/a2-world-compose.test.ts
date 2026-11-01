// ★A2 光照×扭曲 FBO 链结构锁（2026-09-23）
// 字节等价的源级保证：shader 单源引用（禁转录副本）+ uniform/参数逐式对照原模块 +
// 两 pass 结构锁（禁单 shader 合并——中间量化不可复现,方案 §二裁决 3）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GLWorldCompose } from '../src/render/GLWorldCompose';

const src = (p: string): string => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const composeSrc = src('../src/render/GLWorldCompose.ts');

describe('A2 GLWorldCompose 结构锁', () => {
  it('shader 单源引用（禁转录——byte-equal 前提）', () => {
    // pass1 VERT=单点派生（朝向链锁管）,FRAG=原模块直引;pass2 全直引
    expect(composeSrc).toContain('LIT_VERT, LIT_FRAG');   // ★B2b:LIT_FRAG=GLWorldLight.FRAG 单点派生(uWorldFlip)
    expect(composeSrc).toContain('const LIT_FRAG = GLWorldLight.FRAG');
    expect(composeSrc).toContain('GLWaterDistortion.VERT, GLWaterDistortion.FRAG');
    expect(composeSrc).toContain('GLWorldLight.VERT.replace(');
    // recon 对=内联 300 es（usampler2D 需 ESSL3——ESSL1 编译失败=黑世界案真凶）
    expect(composeSrc).toContain("const LRECON_VERT = `#version 300 es");
    expect(composeSrc).toContain("const LRECON_FRAG = `#version 300 es");
    expect(composeSrc).toContain("program('lrecon', LRECON_VERT, LRECON_FRAG)");
  });

  it('★recon 失效域锁（2026-09-23 黑世界案第二层）:pRecon 失败只废 A3+compose 返 false', () => {
    // 构造器不得因 pRecon 失败整体 unavailable（跳过纹理创建=recreate 半残态）
    expect(composeSrc).toContain('this.lreconDead = !this.pRecon?.prog;');
    expect(composeSrc).toContain('this.lreconDead = !this.pRecon?.prog;\n      const gl');
    // recon 不可用时 compose 必须返 false（调用方落 CPU 重建,禁空 texLight 黑屏）
    expect(composeSrc).toContain('if (rawLight && (this._rawBroken || this.lreconDead || !this.pRecon?.prog)) {');
  });

  it('两级 pass FBO 链（lit→warped→present;scene 直采 FBO 纹理免重传）', () => {
    expect(composeSrc).toContain("pipeline.fbo('lit', w, h)");
    expect(composeSrc).toContain("pipeline.fbo('warped', w, h)");
    expect(composeSrc).toContain('gl.bindTexture(gl.TEXTURE_2D, this.fboLit.tex)');
    expect(composeSrc).toContain('pipeline.present(this.fboWarped, presentOver)');   // ★C10e:over 透传
  });

  it('uniform 表逐式（pass1 五键/pass2 十一键）', () => {
    for (const u of ['uWorld', 'uLight', 'uCanvas', 'uLightRect', 'uDarkSkip']) {
      expect(composeSrc).toContain(`'${u}'`);
    }
    for (const u of ['uScene', 'uNoise', 'uWave', 'uWater', 'uCssSize', 'uWorldPx',
      'uNoiseSize', 'uWaveSize', 'uWaveOff', 'uProgress', 'uIntensity']) {
      expect(composeSrc).toContain(`'${u}'`);
    }
  });

  it('数据源上传预乘 false（noise/wave/raw 纯数据——画布源收口不适用）', () => {
    // ensureNoise + uploadWave + 无噪声帧 1×1 垫底 + A3 uploadRaw,各一次显式 false
    expect((composeSrc.match(/UNPACK_PREMULTIPLY_ALPHA_WEBGL, false/g) || []).length).toBe(4);
  });

  it('波场 8bit 量化式逐字（R32F 已否决——量化=输出语义）', () => {
    expect(composeSrc).toContain('const v = ((waveR[i] - 0.5) * amp + 0.5) * 255 + 0.5;');
    expect(composeSrc).toContain('gl.UNPACK_ALIGNMENT, 1');
  });

  it('★朝向链锁（2026-09-23 用户实报倒置案）:pass1=去翻转变体写 FBO,pass2=原 VERT', () => {
    // FBO v0=帧缓冲 row0（GL 底）;旧画布上传布局 v0=图像顶。pass1 必须去翻转
    // （aPos.y=0→clip-1→row0=v0=图像顶）;pass2 原翻转写入（图像顶→v1）+present
    // flipY=1 画布顶采 v1 → 三级闭合。锁死派生式与消费点,防回退。
    expect(composeSrc).toContain("GLWorldLight.VERT.replace('1.0 - aPos.y * 2.0', 'aPos.y * 2.0 - 1.0')");
    expect(composeSrc).toContain("program('worldLight', LIT_VERT, LIT_FRAG)");   // ★B2b 派生 FRAG
    expect(composeSrc).toContain("program('distort', GLWaterDistortion.VERT, GLWaterDistortion.FRAG)");
  });

  it('★门控纹理首传分配锁（2026-09-23 用户实报全屏扭曲案）:texWater 走 key 门 texImage2D/texSubImage2D', () => {
    // 无存储纹理采样恒 (0,0,0,1) → 门控 α≡1 → 全屏噪声位移（热扭曲状观感）
    // ★liqgl 双型入参（canvas | WorldTexSrc）后取宽高带 cast——键门语义不变
    expect(composeSrc).toContain("const kW = `${(water as HTMLCanvasElement).width}x${(water as HTMLCanvasElement).height}`;");
    expect(composeSrc).toContain('this._texKeyWater !== kW');
    expect(composeSrc).toContain('gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, water as HTMLCanvasElement)');
  });

  it('★IOSurface 减面锁（2026-09-23）:旧链实例获取后移进旧链分支,prewarm 分流', () => {
    // rendererSrc 不在本文件顶部——就地读
    const r = readFileSync(fileURLToPath(new URL('../src/render/Renderer.ts', import.meta.url)), 'utf8');
    // 实例获取在旧链 if(glu && glu.composite...) 前 1 行内（A2 成功路径不触达=C1 零创建）
    const acquire = r.indexOf('this.worldLightLayer();   // ★A2：仅旧链路径触达');   // ★B2b:acc 帧旧链不可达(accFbo?null:)
    const branch = r.indexOf("if (gl && gl.composite(this.worldCanvas!");
    const a2 = r.indexOf('Renderer.wfbo && !this.isCpuRender()');
    expect(acquire).toBeGreaterThan(a2);            // 获取点在 A2 分支之后
    expect(branch).toBeGreaterThan(acquire);        // 且紧邻旧链分支
    expect(r).toContain('const gl = accFbo ? null : this.worldLightLayer();');   // ★B2b:acc 帧不可达锁
    expect(r).toContain('if (Renderer.wfbo) {\n      try { (this.worldCompose ??= this.newWorldCompose()); }');
    expect(r).toContain('if (!Renderer.wfbo) { try { this.waterWarp.prewarm(); }');
  });

  it('a0 白名单已收 GLWorldCompose', () => {
    // ★C10a（2026-09-24）：白名单扩入 GLSpriteLayer.ts（云管线后端,?cloudpipe=1）
    // ★C10b（2026-09-24）：白名单扩入 Renderer.ts（共管管线持有/revive/drop 治理面）
    // ★A1（2026-09-25）：白名单扩入 GLScreenFilters.ts（滤镜链入管线,?sfxgl）
    // ★G38-A 改判（2026-10-31,棘轮在途红收口）：旧锁=四元素整串精确匹配——GhostBlur
    //   （2026-10-07）/hooks（2026-10-12）/modShader（2026-10-14）相继入列后整串
    //   失配=陈旧红。改为白名单行含 A2 相关键逐键断言（消费方增长由 a0 自身的
    //   白名单锁权威承载,本锁只保 A2 消费面不跌出白名单）。
    const a0 = src('../tests/a0-glpipeline-shell.test.ts');
    const setStart = a0.indexOf('const ALLOWED = new Set([');
    const wl = a0.slice(setStart, a0.indexOf(']);', setStart));
    expect(setStart).toBeGreaterThanOrEqual(0);
    for (const f of ['GLWorldCompose.ts', 'GLSpriteLayer.ts', 'Renderer.ts', 'GLScreenFilters.ts']) {
      expect(wl).toContain(`'${f}'`);
    }
  });
});
