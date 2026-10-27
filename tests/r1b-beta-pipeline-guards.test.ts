// ★红蓝批 β 管线/光照/shim 资源域——GL 依赖面源码锚（node 无 WebGL/canvas,
// 行为面在探针/浏览器侧;本文件锁结构不回退）：
//   R1b-2 cloudpipe=0 跨上下文句柄:acc 门加 cloudPipe+ensureWorldCompose 一致性
//        +WorldTexSrc.gl 产生面指纹+compose 入口 xctx 守卫+liqgl 头注归真。
//   R1b-4 饥饿锁半开闭合:健康早退支补记 probeOk+armRetryLatch swpipe 限定
//        +markSwPipeSkip 统一 toast 收口（wfbo=0/lrecon=0 会话补报）。
//   R1b-5 dispose 表补全:standalone quad/cloud/tile/precip 程序+VAO/采样器;
//        pipe 模式 rain/precip VAO/VBO+trail 族+precipProgHandle 清面。
//   R3b-2 boltScratch 回落支+bakeBolt 帧界环形键。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const RDR = readFileSync(join(__dirname, '../src/render/Renderer.ts'), 'utf8');
const GWC = readFileSync(join(__dirname, '../src/render/GLWorldCompose.ts'), 'utf8');
const GSL = readFileSync(join(__dirname, '../src/render/GLSpriteLayer.ts'), 'utf8');
const VLR = readFileSync(join(__dirname, '../src/render/VanillaLiquidRenderer.ts'), 'utf8');
const P14 = readFileSync(join(__dirname, '../src/entities/proj1457.ts'), 'utf8');
const GSE = readFileSync(join(__dirname, '../src/render/glshim/GLShimExecutor.ts'), 'utf8');

describe('R1b-2 跨上下文句柄结构性禁止', () => {
  it('acc 累积态门含 cloudPipe（cloudpipe=0 → acc 关 → 句柄永不产生）', () => {
    expect(RDR).toContain('Renderer.bgl && Renderer.bglShim && Renderer.b2b && Renderer.cloudPipe && !this.isCpuRender()');
  });
  it('ensureWorldCompose 一致性重建（运行时翻旗旗面错位整弃）+两调用点接线', () => {
    expect(RDR).toContain('private ensureWorldCompose(): void');
    expect(RDR).toContain('this.worldCompose.ownsPipe !== !(Renderer.cloudPipe || Renderer.c10e)');   // ★C10e:旗面判据加 c10e
    expect(RDR.match(/this\.ensureWorldCompose\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
  it('WorldTexSrc.gl 产生面指纹+两产生面填 gl+compose 入口 xctx 守卫', () => {
    expect(GWC).toContain('gl?: WebGL2RenderingContext');
    expect(GWC).toContain("this.lastFail = 'xctx-handle'");
    expect(RDR).toContain('gl: this.swPipe?.glx ?? undefined');       // accHandle
    expect(VLR).toContain('gl: glw.pipeGl ?? undefined');             // emitVanillaLiquidGate
    expect(GSL).toContain('get pipeGl(): WebGL2RenderingContext | null');
  });
});

describe('R1b-4 饥饿锁半开闭合通路', () => {
  it('acquireSwPipe 健康早退支幂等补记 probeOk', () => {
    // 健康支内 noteStarveProbeOk（旧码只记新建支=streak 恒 1 病灶）
    const healthy = RDR.slice(RDR.indexOf('private acquireSwPipe'), RDR.indexOf('private reviveSwPipe'));
    expect(healthy).toContain('noteStarveProbeOk();');
    expect(healthy).toContain('★R1b-4');
  });
  it('armRetryLatch 的 probeFail 只对 swpipe（下游层失败不打断试探 streak）', () => {
    const arm = RDR.slice(RDR.indexOf('private armRetryLatch'), RDR.indexOf('private acquireSwPipe'));
    expect(arm).toContain("if (kind === 'swpipe') noteStarveProbeFail();");
  });
  it('toast 统一收口 markSwPipeSkip（wfbo=0/lrecon=0 会话塌方补报）+层饥饿门补报', () => {
    const mark = RDR.slice(RDR.indexOf('private markSwPipeSkip'), RDR.indexOf('private armRetryLatch'));
    expect(mark).toContain('this.notifySwPipeDegrade();');
    expect(RDR).toContain('if (starvedLock()) { this.notifySwPipeDegrade(); return null; }');
    expect(RDR).toContain("if (starvedLock()) { this.markWorldGlSkip('starvelock'); this.notifySwPipeDegrade(); return null; }");
  });
  it('GLStats:同拍去重+闭合/非饥饿期重置探针时间锚', () => {
    const GS = readFileSync(join(__dirname, '../src/render/GLStats.ts'), 'utf8');
    expect(GS).toContain('if (now - lastProbeOkAt < STARVE_PROBE_MS) return;');
    expect(GS).toContain('lastProbeOkAt = -Infinity;');
  });
});

describe('R1b-5 dispose 表补全', () => {
  it('standalone:quad/cloud/tile/precip 程序+主 VAO/采样器表随层释放', () => {
    const d = GSL.slice(GSL.indexOf('  dispose(): void'), GSL.indexOf('  private disposePipeMode'));
    expect(d).toContain('this.gl.deleteProgram(this.prog)');
    expect(d).toContain('this.gl.deleteProgram(this.progCloud)');
    expect(d).toContain('this.gl.deleteProgram(this.progTile)');
    expect(d).toContain('this.gl.deleteProgram(this.precipProg)');
    expect(d).toContain('this.gl.deleteVertexArray(this.precipVao)');
    expect(d).toContain('this.gl.deleteBuffer(this.precipVbo)');
    expect(d).toContain('this.gl.deleteVertexArray(this.vao)');
    expect(d).toContain('this.precipProgHandle = null');
  });
  it('pipe 模式:rain/precip VAO/VBO 删除+precipProgHandle 清面;trail 族无释放面（管线模式恒不建,ensureTrail 判例）', () => {
    const d = GSL.slice(GSL.indexOf('  private disposePipeMode'));
    expect(d).toContain('gl.deleteVertexArray(this.rainVao)');
    expect(d).toContain('gl.deleteBuffer(this.rainVbo)');
    expect(d).toContain('gl.deleteVertexArray(this.precipVao)');
    expect(d).toContain('gl.deleteBuffer(this.precipVbo)');
    // 程序禁单删判例（c10a 守卫同款）:pipe 支不出现 deleteProgram——trail 族
    // 管线模式恒不建（ensureTrail `if (this.pipe) return false`）,无删除面
    expect(d).not.toContain('deleteProgram');
    expect(d).toContain('this.precipProgHandle = null');
    expect(d).toContain('this.precipFail = false');
  });
});

describe('R3b-2 boltScratch 资源面', () => {
  it('回落支:滞回缩回基线（防离群帧后整幅上传恒态）', () => {
    expect(P14).toContain('BOLT_SCRATCH_BASE = 256');
    expect(P14).toContain('w * 2 <= cw && h * 2 <= ch');
  });
  it('bakeBolt 键改帧界环形 uploadScratchBake（实体 id 键退休）', () => {
    expect(P14).toContain("r9.uploadScratchBake(sc, 'boltBake', 1024, sx, sy);");   // ★锚重产:P1-B 子区参（旧锚缺参=盘上陈旧红）
    expect(P14).not.toContain('boltBake:${this.id}');
  });
});

describe('R1b-8 降级帧水扭曲 gate 缺席触发面', () => {
  it('fg 批门带环溢出探针+足迹 2D 重放接线', () => {
    // ★BJ731 改判史（2026-10-27）：BJ676 月套逃逸帧（veil676=月套/甲辉队列非空）
    //   给 fg 批门追加第三与项 `&& !veil676`（批化支前景水直入 FBO,禁批回
    //   canvas gate 路）——锁随条件扩展,溢出探针语义不变。
    expect(RDR).toContain('liqMode && !liqRingOverflow() && !veil676 ? this.liqBatchHook() : null');
    expect(RDR).toContain('if (fgCtx) replayLiquidFootQuads2D(fgCtx);');
    expect(VLR).toContain('export function replayLiquidFootQuads2D');
    expect(VLR).toContain('export function liqRingOverflow(): boolean');
  });
});

describe('R1b-6/R3b-4 shim 资源面结构锚', () => {
  it('preTex 快照账+重放消费+frameReset/attachAcc 双点清 pending（★P0 去画布化重锚）', () => {
    // ★P0 去画布化（2026-09-28 灾难链定谳）:快照=区域字节 ImageData（旧
    //  snapBakeBytes 每 bake createElement=霜月 2441.7 canvas/秒出生风暴本体）;
    //  重放=putImageData 进共享 preSnapScratch 后取样,src ⊆ 快照域守卫。
    expect(GSE).toContain('snapBakeRegion');
    expect(GSE).not.toContain('this.snapBakeBytes(');
    expect(GSE).toContain('let src: CanvasImageSource = p.img;');
    expect(GSE).toContain('if (sn && p.sx + p.sw <= sn.width && p.sy + p.sh <= sn.height) {');
    expect(GSE).toContain('g.putImageData(sn, 0, 0); src = sc;');
    expect(GSE).toContain('preSnap: ImageData | null;');
    const fr = GSE.slice(GSE.indexOf('  frameReset(): void'), GSE.indexOf('// ================= 纹理登记'));
    expect(fr).toContain('this.bakedTexPending = null');
    const aa = GSE.slice(GSE.indexOf('  attachAcc(): CanvasRenderingContext2D | null'), GSE.indexOf('  /** ★B2b 降级换桥'));
    expect(aa).toContain('this.bakedTexPending = null');
  });
  it('shineCell 键帽+触帧账', () => {
    expect(GSE).toContain('SHINE_KEY_CAP = 1024');
    expect(GSE).toContain("key.startsWith('shineCell:')");
    expect(GSE).toContain('dropTexture(k)');
  });
});
