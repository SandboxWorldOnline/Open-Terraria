// ★A0 GLPipeline 管线壳结构锁（2026-09-22）
//
// 单上下文 GL 管线门面（渲染改造方案 §三 A0）：FBO 池+程序登记+blend 档位表+
// present blit。**本刀零消费方=零输出变化**——「无 import 方」结构锁是本刀的
// 核心语义保证（任何模块接线前不得存在 src 内 import;A1 接入时同步摘锁并
// 补该刀自己的像素对拍）。
// 运行时 GL 行为无法在 node vitest 验证（无 WebGL 上下文）——由接入刀的实机
// pixel-ab（_bj77 范式）兜底;本文件=源文本纪律锁。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLPipeline } from '../src/render/GLPipeline';

const src = (p: string): string => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const pipelineSrc = src('../src/render/GLPipeline.ts');

/** 递归枚举 src 树全部 .ts（跳过 GLPipeline.ts 自身与 .test.ts） */
function* walkTs(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) yield* walkTs(full);
    else if (e.endsWith('.ts') && !e.endsWith('.test.ts')) yield full;
  }
}

describe('A0 GLPipeline 管线壳', () => {
  it('模块可导入,导出面齐备（类+FBO/程序/blend/present API）', () => {
    expect(typeof GLPipeline).toBe('function');
    expect(pipelineSrc).toContain('fbo(name: string, w: number, h: number)');
    expect(pipelineSrc).toContain('program(name: string, vs: string, fs: string)');
    expect(pipelineSrc).toContain('setBlend(mode: BlendMode)');
    // ★C10e（2026-10-01）：present 增 over 档缺省参（屏栈直出;缺省 false=blend off
    //  原路径逐位）——API 面演进,A0 字节语义零变化
    expect(pipelineSrc).toContain('present(src: PipelineFbo, over = false)');
    expect(pipelineSrc).toContain('uploadCanvas(tex: WebGLTexture, src: TexImageSource, w: number, h: number)');
    expect(pipelineSrc).toContain('beginFrame(w: number, h: number)');
    expect(pipelineSrc).toContain('recreate(): boolean');
    expect(pipelineSrc).toContain('dispose(): void');
  });

  it('★消费方白名单锁：仅 A2 合成模块+C10a/b 云bg后端+Renderer 治理面+A1 滤镜链+ghostblur 帧尾 pass 可 import GLPipeline（其余 src 模块禁入）', () => {
    // ★A2 动工（2026-09-23）：GLWorldCompose 首个消费方——白名单制替代零消费方锁
    // ★C10a 动工（2026-09-24）：GLSpriteLayer 获「GLPipeline 后端」模式（?cloudpipe=1
    //   灰度;工厂 createPipelineBacked 在层内构造管线,1:1 持有）
    // ★C10b 动工（2026-09-24）：Renderer 持有单一 GLPipeline 共管注入（云+bg 层
    //   ownsPipe=false+worldCompose 注入）——Renderer 入白名单（持有/revive/drop 治理面）
    // ★A1 动工（2026-09-25）：GLScreenFilters 滤镜链入管线（drawChainPipe FBO 乒乓,
    //   ?sfxgl 旗）——第五消费方入白名单
    // ★ghostblur 动工（2026-10-07）：GhostBlur 帧尾 accumulation pass（?ghostblur=1
    //   缺省关）——第六消费方入白名单（fbo('ghostCur'/'ghostA'/'ghostB') 租名+
    //   program('ghostmix')+present 门面消费;GLPipeline 本体零改动）
    // ★mod screenFx 动工（2026-10-12）：mods/hooks.ts 第七消费方——mod 全屏后处理
    //   契约面（ModScreenFxExec 签名类型引用,纯 type import 零运行时边）;
    //   mod 脚本经 sw.screenFx 注册,exec 由 GLScreenFilters 'ModScreenFx' 分支派发
    // ★modShader Tier1-b 动工（2026-10-14）：mods/modShader.ts 第八消费方——mod GLSL
    //   屏幕后处理声明面（sw.shader;纯 type import 零运行时边,exec 运行期由
    //   GLScreenFilters 'ModScreenFx' 分支链内派发并注入 pipe 实参——第七消费方
    //   hooks.ts 同模式;刀面测试 tests/mod-tier1b.test.ts）。★G38-A 收口（2026-10-31,
    //   棘轮在途红归因）：Tier1-b 落地时漏随迁本白名单=10-27 发版会话在途红。
    const root = fileURLToPath(new URL('../src', import.meta.url));
    const ALLOWED = new Set(['GLWorldCompose.ts', 'GLSpriteLayer.ts', 'Renderer.ts', 'GLScreenFilters.ts', 'GhostBlur.ts', 'hooks.ts', 'modShader.ts']);
    const offenders: string[] = [];
    for (const f of walkTs(root)) {
      if (f.endsWith('GLPipeline.ts')) continue;
      const s = readFileSync(f, 'utf8');
      if (/from\s+['"].*GLPipeline['"]/.test(s) && !ALLOWED.has(f.split('/').pop() || '')) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it('纪律锁：预乘收口/preserveDrawingBuffer/软渲染判死/退避', () => {
    expect(pipelineSrc).toContain("gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)");
    expect(pipelineSrc).toContain('preserveDrawingBuffer: true');
    expect(pipelineSrc).toContain('/swiftshader|software|llvmpipe|basic render/i');
    expect(pipelineSrc).toContain('this.diedAt = performance.now()');
    expect(pipelineSrc).toContain("addEventListener('webglcontextlost'");
  });

  it('blend 档位表逐字（premul/add/erase=固定功能三档+off）', () => {
    expect(pipelineSrc).toContain("gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)");   // premul
    expect(pipelineSrc).toContain("gl.blendFunc(gl.ONE, gl.ONE)");                    // add
    expect(pipelineSrc).toContain("gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA)");   // erase
    expect(pipelineSrc).toContain("gl.disable(gl.BLEND)");                            // off
  });

  it('字节账埋点齐备（GLStats 带宽/驻留双口径）', () => {
    expect(pipelineSrc).toContain('glStatUpload(this.statName, w * h * 4)');
    expect(pipelineSrc).toContain('glStatTexCreate(this.statName, texBytes');
    expect(pipelineSrc).toContain('glStatDelete(this.statName, texBytes');
    expect(pipelineSrc).toContain('glStatDraw(this.statName, 4)');
    expect(pipelineSrc).toContain('registerFence(this.statName, gl)');
  });

  it('FBO=RGBA8（中间产物字节语义=2D 画布背板——A1/A2 等价性前提）', () => {
    expect(pipelineSrc).toContain('gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null');
  });
});
