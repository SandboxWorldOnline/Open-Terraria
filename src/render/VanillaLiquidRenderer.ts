// 原版 1.4.0.5 液体渲染器：Terraria1405/GameContent/Liquid/LiquidRenderer.cs 逐行移植。
// 多 pass 网格算法（无任何矩形"浸润"hack）：
//  P1 缓存原始液位/实心/墙/类型（±2 padding）
//  P2 可见液位：干燥格被左右（或上下）同类型液体夹住 → 两侧液位之和×0.5（原版"透出"效果的本源）
//  P3 瀑布拖尾：向下传播 WATERFALL_LENGTH 格，透明度递减（水 10 / 岩浆 3 / 蜂蜜 2）
//  P4 四壁插值（Left/Right/Top/BottomWall 0-1）+ 边存在性 + 变体图集 FrameOffset
//  P5 壁值平滑（与上下/左右邻取加权均值）
//  P6/P7 角落修正（瀑布侧/内角填充）
//  绘制：water_N 表（48×1360：3 列变体 × 80px 动画带）按四壁裁源矩形 + 偏移贴图
import type { SpriteAtlas } from '../assets/SpriteAtlas';
import { setLiqShimmerTVis, type GLSpriteLayer, type TexEntry } from './GLSpriteLayer';
import { TileStore } from '../world/TileStore';
import { TILE_DEFS } from '../data/tiles';
import { waterWaves } from './WaterWaves';
import { texId, texReady } from './texId';
import { swPerf, liqpolish } from './perfFlags';   // ★BJ77 零语义优化层总闸(★转正缺省开;?swperf=0=豁免口回退旧行为逐位)
                                                    // ★liqpolish 微抛光刀总闸(灰度缺省关;?liqpolish=1 激活)
import { visEffectFrames } from '../entities/Enemy';   // ★2026-09-27 微光 tVis 重钉钟面（function 声明=环安全;函数体内调用）
import { gameTickCount } from '../core/GameTime';      // ★2026-09-27 液体相位逐 tick 累计钟源

const WATERFALL_LENGTH = [10, 3, 2];        // 水岩蜜（微光 vt=3 走 ?? 3 兜底——原版微光无瀑布拖尾分支，DrawShimmer 单独绘制）
// ★BJ427（2026-10-01）：前景基色表对齐 1457 终值 DEFAULT_OPACITY（LiquidRenderer.cs:108
//  {0.6,0.95,0.95,0.75};1405:25 同前三维）——旧 {0.5,0.9,0.8} 系误抄【复古光照路】
//  oldDrawWater 的水基 0.5（Main.cs:58528 num17=0.5f,仅 Lighting.NotRetro=false 才走）;
//  本仓管线 = DrawNormalLiquids（NotRetro 现役路,:650 `num = Opacity × DEFAULT_OPACITY[Type]`,
//  岩浆另 ×player.lavaOpacity——★BJ705-G26 件3 起穿参落地（LiquidRenderer.cs:659
//  case 1,缺省 1 恒等）。
const DEFAULT_OPACITY = [0.6, 0.95, 0.95, 0.75];  // 水 / 岩浆 / 蜂蜜 / 微光——微光 = DrawShimmer val×0.75（LiquidRenderer.cs:707）

// ---- ★IIIII251 斜坡水缘波纹覆盖（用户明示偏差；★IIIII257 转正缺省 true）----
// 【偏差语义】原版坡面/半砖岸格的水线 = 方块贴图斜边 + 静态浸润带，波场不覆盖
// （表层逐格 bob 只走 hasTE 液体格；GL 全屏扭曲的 obj19 门控足迹 = 前景水 alpha,
//   坡面格无前景水 ⇒ gate=0 恒不位移）⇒ 斜坡水缘是全池塘唯一不动的水线。
// 用户要求波纹线沿斜坡水缘连续。双路径交付：
//   CPU 路径（?wwarp=0 / CPU 渲染 / GL 死）= 浸润带逐格 bob（waveBob 入参）；
//   GL 路径（现役默认）= 坡面水形状以 α≈0.02 预画进前景水离屏（footprintCtx
//   入参）→ obj19 门控 aD/aU×100 在 α≥0.01 即饱和 ⇒ 纳入全屏位移场。
// 【转正·IIIII257】缺省 true（251 头注预告的"用户验收后转正"落地；probe-guide
//   B10 同注）。256 批的坡面亮线（实心层 pass 常开段）落位后用户实报"亮线静止"，
//   定谳 = 本 flag 仍灰度（=== '1'）⇒ 缺省 GL 路坡面格足迹缺席 → obj19 gate=0 →
//   亮线不随位移场波动、不进水中扭曲（255 verify-report off 臂坡面全 0.0000 /
//   on 臂 0.10-0.18 实证 flag 是唯一开关面）。转正后位移门与亮线常开段同域；
//   ?slopewave=0 = 逃生门回退灰度期行为（亮线仍在——常开段不归本 flag 管）。
export const slopeWaveEnabled = (() => {
  try {
    if (typeof location === 'undefined') return true;
    return new URLSearchParams(location.search).get('slopewave') !== '0';
  } catch { return true; }
})();

// 我们的 liquidType（1 水 / 2 岩浆 / 3 蜂蜜 / 4 微光）→ 原版 LiquidType（0/1/2/3）
function toVanillaType(t: number): number {
  return t === 2 ? 1 : t === 3 ? 2 : t === 4 ? 3 : 0;
}

// ---- ★liqgl（2026-09-27 微光液体批化+染色 GL 化刀;B3 液体 quad 旧计划语义并入）----
// 【trace 定谳（/tmp/txr-shimmer.digest.json,实机 trace 20260927T101610）】微光湖
// 三笔成本:
//  ① applyShimmerBaseTint self 6.77%（1116.6ms）+fillRect 300.6ms——微光基色
//     每帧 2×2 子块 multiply（Canvas2D 无顶点色的最优近似）;实测定谳探针
//     （scripts/_liqgl-forensic2.mjs）:acc 窗内 bg pass 走 shim tier-3 MULT quad
//     （CPU 侧只剩 JS 数学+Proxy 面约一半）,**前景 pass 在 warpOn 时走 fgCanvas
//     原生 2D**（beginFgPass 返回裸 ctx）= 780 次/帧原生 multiply fillRect。
//  ② texImage2D 风暴 760ms（texRefresh 715.2ms）——fgCanvas 每帧全幅重传:
//     endFgPass 的 drawImage(fgCanvas) 经 shim→markDynamic→texRefresh（uploads
//     ≥1/帧,探针实证）;compose 侧 GLWorldCompose 再 texSubImage2D 全幅一次。
//  ③ drawVanillaLiquids self 9.12%/incl 27.2%——逐 tile 发射:acc 窗内逐 tile
//     quadSprite（bindTexture+drawArrays 各一次/格）,warpOn 前景逐 tile 原生
//     drawImage（SHM 慢路径）。
// 【本刀】?liqgl=1 激活:
//  刀1 列→顶点批:主循环 tile 全部折进单 Float32Array 环（stride 8=x,y,u,v,
//      r,g,b,a）,按纹理段单 drawArrays 发射（GLShimExecutor.pushQuadBatchRgba
//      复用=C5b 雪沙批通道;雨刀 buildRainBatch 判例同构;prep 数组面零改动）。
//  刀2 微光基色染色 GL 化:每微光 tile 一枚【顶点色调制 quad】——四角色 =
//      SetShimmerVertexColors（LiquidRenderer.cs:745-759）双线性张量在裁剪角
//      处的值（双线性场对子矩形封闭=逐位）,GPU 插值=原版逐顶点插值 1:1;
//      applyShimmerBaseTint 在批路径退役（CPU 路径保留=?liqgl=0 逃生门）。
//      【语义备案】批化支=原版 XNA SpriteBatch modulate 单式;现 CPU 式的
//      canvas multiply 在半透明 dst（贴图 AA 边缘/前景 0.75/拖尾）多一项
//      color×(1−αdst) 补正——原版无此项=批化支更贴原版;census 有界登记。
//  刀3 gate 出生在 GPU:warpOn 前景水不再进 fgCanvas——可见水批直入
//      FBO('world')（SO 结合律=(w over ∅) over scene ≡ w over scene,B1 判例）,
//      同一批数据 y 镜像重发射进 FBO('liqgate')=obj19 门控纹理（compose 直采
//      句柄,两次全幅上传全消）。坡面足迹（α≈0.02）同步改四边形收集进 gate。
// 【转正（2026-09-27,用户实报翻案后修复验证）】用户实报"?liqgl 缺省开=水面波动
//  GL 渲染消失"定谳=病灶在【lrecon 支的 compose 调用点漏改】——compositeLight 的
//  A3(lrecon,缺省开)compose 恒先于 A2 支 return,其 water 实参曾恒 gateCanvas()
//  =批化帧 fgCanvas 缺席→gate≡null→obj19 gate≡0→全屏扭曲整体缺席（W1b 探针:
//  compose waterKind='canvas'+'no liqgate 采样'实锤）。修=该调用点与 A2 同式双型
//  （_liqGateHandle ?? gateCanvas()）;修复后 W1b compose waterKind='fbo-handle'
//  全绿+W1c 水下静区运动判别器 ON 7806/OFF 6404 同量级（扭曲两臂皆活）+
//  _liqgl-ab 全部 PASS（LA census maxd=29≤72 登记域/LB batch=464 fb=0 rp=0/
//  LC uploads 帧间零增长/LE drawLiquids 0.94→0.46ms 2.02×,整帧 7.38→5.04ms）。
//  → 缺省开。?liqgl=0 = 逃生门（回 fgCanvas CPU 全链:原生 2D 前景+canvas
//  multiply 染色+gate 全幅上传）。【教训登记】多调用点共享入参改造必须全量
//  grep 调用点（本次 compositeLight 内 compose 有 lrecon/A2 两处,只改一处=
//  用户实报回归;desert-heathaze 同族判例）。
export let liqgl = typeof location !== 'undefined'
  ? new URLSearchParams(location.search).get('liqgl') !== '0' : true;
export function liqglSetForTest(v: boolean): void { liqgl = v; }

// ---- ★C13b 液体 op-batch 总闸（2026-09-30;P1 性能战役主刀）----
// 【trace 定谳（Trace-20260930T144504,Windows SHM 58s）】flushAcc self=1349ms +
//  resolveTex=782ms = 逐 op shim 税。liqgl（主循环/微光基色,09-27 转正）与
//  liqpolish（sparkle/glint ADD/微光浸润带/fg 复用,09-29 转正）落位后,残余逐 op
//  形态（探针 scripts/_c13b-census.mjs 实测水面场景 ≈234 shim drawImage/帧）:
//   ①浸润带非微光支（水/岩浆/蜂蜜;bg pass + 实心层 pass 双份,~130+104 drawImage/帧）
//   ②斜面覆盖增强（bg pass,LiquidSlope 懒载表,~24/帧）
//   ③IIIII256 白色水面亮线（实心层 pass,slope1/2 水线格）。
//  三形态全是【轴对齐纹理 quad】（坡面切条=LiquidSlope 纹理源矩形,非几何切分;
//  亮线=2px 源条）→ 可折顶点批。复用 liqgl 基底环（batQuad/flushBandRun/
//  pushQuadBatchRgba 通道）,发射位=调用位=层序保持。
// 【本刀】bandBatC13b 臂（非微光带+亮线）+ slopeBatOn 臂（斜面增强）:
//  ?c13b=0 = 逃生门（三形态回逐 op 原链逐位;liqpolish 微光臂不受本旗管——两旗正交,
//  ?liqpolish=0 语义不变）。
export let liqC13b = typeof location !== 'undefined'
  ? new URLSearchParams(location.search).get('c13b') !== '0' : true;
export function liqC13bSetForTest(v: boolean): void { liqC13b = v; }

// ---- ★C13c 微光波场 GLSL 化（2026-10-01 二期刀;docs/c13c-shimmer-wave-glsl-design.md）----
// 【定谳核心】噪声 uint→f32 高位损失 256（§2.2:sin 相位差 25.6rad,位等不可达）
//  ⇒ noise hash+noiseSin 留 CPU 逐节点求值,经每顶点属性 aNoise 上 GPU（方案 H §3.2,
//  CPU sin 减半:波值 4 sin 上 GPU,噪声 4 sin 留 CPU;双线性张量/_wvArr 跨 pass 缓存
//  在本臂退役）。stride-11 环 + sprite:liqshimmer 程序（GLSpriteLayer 惰性装配）,
//  基色/波场改 FS 逐像素解析（替代 CPU 双线性张量——§5.3 系统性差=域内登记,方向中性）。
// 【转正（2026-10-02,A2 C13c 转正收尾+三期 sparkle 逐像素化刀;?c13c=0 逃生门）】
//  缺省开。旗面形态=liqgl/liqC13b 转正同款（URL 缺省/非'0'=开;'0'=逃生门回 CPU
//  双线性张量场+sparkle 均值亮纹现行链逐位;node/测试环境 init true 同族形态——
//  臂域 c13cOn=liqC13c∧liqpolish,而 liqpolish 属 perfFlags 族 node 恒关 ⇒ 测试
//  环境行为不变）。灰度期缺省关的拦阻债（tests/liquid-gl-batch.test.ts 微光预乘锁
//  断言 R<G<B<α 域 vs c13c 环 rgb===a 预乘恒等域）已随本刀收尾迁移:预乘锁双域并存
//  （回退臂锁保留+标注域;liqshim 键族 rgb===a 恒等锁新增）。?liqpolish=0 时本臂
//  不激活（正交:CPU 原链三重回退全保留,§0 不目标）。
export let liqC13c = typeof location !== 'undefined'
  ? new URLSearchParams(location.search).get('c13c') !== '0' : true;
export function liqC13cSetForTest(v: boolean): void { liqC13c = v; }

// ---- ★C7 fg 复用臂死算跳水总闸（2026-10-08 液体渲染面 C7 刀;★已转正缺省开,?liqc7=0 逃生门）----
// 【普查定谳（scripts/_c7-liq-census.mjs,活帧 5 臂）】液体渲染面 GL 化已由
//  liqgl(09-27)/liqpolish(09-29)/C13b(09-30)/C13c(10-01) 四刀收编:活帧批量段
//  74.5 段/3897 quad/帧、span 内原生 2D 直画=0（残 4 笔=LiquidSlope 懒载表首帧
//  暖机）——台账「普通液体仍逐格 2D」条目已过时。aP 残余自耗=per-tile JS:
//  P1 全窗 store 读+复位重扫（fg 全窗重读）+P3+主循环矩形数学。
// 【本刀】fg pass(needsPrep=false) 复用臂命中路径上,复位重扫（下方 !swPerf||
//  !needsPrep 块=整窗 store 重读）与 Unguarded P3 的全部写入【无消费者】——
//  复用臂直读 _bgBaseRuns/_bgSpark/_bgGlint 重发射后 return,绘制循环整段跳过。
//  判定四键在 fg 入口即定（bat/needsPrep/_batOverflow/_addOverflow/_bgRunsFrame
//  =bg 终值,resetLiquidBatchForFrame 同帧幂等;CTM 自调用方起无人改动）⇒ 判定
//  上提,命中即跳过两死算块（输出逐位同:死写入无观察面;活机量化见 _c7-ab）。
//  ★转正（2026-10-08 用户令;证据=A/B 冻结帧 diff=0 双分辨率+变异证红+195 回归绿,
//  语义零变化=无消费者死算移除）：缺省开,?liqc7=0 逃生门回全量链逐位。
export let liqC7 = typeof location !== 'undefined'
  ? new URLSearchParams(location.search).get('liqc7') !== '0' : true;
export function liqC7SetForTest(v: boolean): void { liqC7 = v; }

// ---- ★liqp2 P1 扫描承载面提速（2026-10-08 液体核第二刀;★已转正缺省开,?liqp2=0 逃生门）----
// 【剖面定谳（scripts/_liqp2-profile.mjs,Mac 大水体 300 活帧 @50µs,CDP positionTicks
//  行级钉+sourcemap 映射——零源码插桩）】aP(drawVanillaLiquids) self 164.2ms/300f 拆解:
//  P1 全窗 store 读 26.9ms(16%)+tileSolidLut(Map.get) 14.5ms+at() 闭包调用 13.9ms
//  +主循环 28.0+P3 20.9+fg 复用重发射 14.6+slopeEnh 12.7…。P1 每格五次函数调用
//  （inBounds/idx/toVanillaType/liquidCacheIsSolid/tileSolidLut）+lq/255 逐格除法。
// 【本刀】P1 重排=【同表达式换承载机制】（值逐位同,构造即证——语义红线:bg 账终值
//  与全窗重读逐位一致）:
//  ① level LUT:_lvlLut[j]=j/255（同一 f64 除式逐 j 静态求值→同一 f32 舍入;值域
//    Uint8 全域封闭 256,读表=逐格除法退役）
//  ② type LUT:_tovLut[j]=toVanillaType(j)（同一纯函数逐 j 静态求值）
//  ③ solid LUT:_solidTy[t]=tileSolidLut(t)?1:0——惰性 write-once+255 哨兵初值+
//    越界增长,与 _solidLut Map 版 staleness 逐字同构（同表达式/同首查时机/
//    同 write-once;mod 期改 TILE_DEFS 已缓存条目两版同为陈旧=语义等价）。
//    热路=单次 Uint8Array 读,哨兵冷支才走 solidTy8
//  ④ inBounds 外提:谓词 x>=0&&y>=0&&x<w&&y<h（TileStore.inBounds 同式）合取分解
//    ——列有效每列一判+行有效表 _rowValid[ly] 每次扫描一建（pw×ph 次 4 比较+调用
//    → pw+ph 次）
//  ⑤ idx 外提:si=y·w+x 增量（si+=w/步）;at() 换模块单形函数（旧实现每次
//    drawVanillaLiquids 新建闭包,调用点 IC 每帧失训=超态调用不内联;模块函数恒同
//    一身份=单形内联。下标式 lx·ph+ly 逐字同,值逐位同）。
//  ★转正（2026-10-08 用户令;证据=机械闸 tests/liquid-liqp2-p1-parity.test.ts 全绿
//  （A/B 账面 23 数组逐位+LUT 变异判别力 T4 红）+Windows 实机三刀合账 液体核
//  95→44-46ms/s、fps 79→105-108）：缺省开,?liqp2=0 逃生门回现行链逐位。
//  node/测试环境 init true=liqc7 同族形态（本刀纯算术面无像素依赖,parity 测试
//  显式 SetForTest 双臂控制不受缺省影响）。
export let liqP2 = typeof location !== 'undefined'
  ? new URLSearchParams(location.search).get('liqp2') !== '0' : true;
export function liqP2SetForTest(v: boolean): void { liqP2 = v; }

// ---- ★liqp3 主循环矩形数学批量向量化+at() 算术化（2026-10-08 液体核第三刀;★已转正缺省开,?liqp3=0 逃生门）----
// 【剖面定谳（liqp2 剖面余量;scripts/_liqp2-profile.mjs 同法）】aP self 残余构成:
//  主循环块 28.0ms/300f(17%,含逐格 device 矩形数学)——每格 4 次缩放乘加
//  (ex0/ex1/ey0/ey1)+主循环 at() 残留 3 次/格（本格/左邻/上邻）;P2-P7/bbox/
//  halfBrick 预扫 at() ~5 次/格（liqp2 ⑤登记候选:i±ph 算术化,估 ~0.1ms/f）。
// 【本刀】rowM 判例风格（waves.as.ts W3/BJ78:行共享项每行一算）:
//  ① 行/列共享设备折算 LUT:ex0=dstX·devSX+devTE 的操作数 dstX=x·16+f2 是
//    【整数封闭域】（f2=floor(n2·16)∈[0,12]——n2=min(0.75,·)≤0.75;f2+sw≤28,
//    sw=ceil((n3−n2)·16)≤16——n3=max(0.25,·)≤1 数学界）⇒ colX[f]=(x·16+f)·devSX
//    +devTE 每列一算（33 档）、rowEy[ly·33+f]=((py0+ly)·16+f)·devSY+devTF 调用前
//    一次建全表（行不依赖 lx=循环序列外提）。【逐位论证】LUT 条目=与逐格式同表达
//    式同操作数（x·16+f 与 dstX 整数精确恒等,f64 同值同积同加）;ey1 恒 LUT:bob
//    情形 dstY+drawSh=topI+(bottom−topI) 整数精确恒等 bottom=y·16+f4+sh（f64 整数
//    封闭运算零舍入）,非 bob 情形=dstY+sh 同值;bob 的 ey0（topI=Math.round(·+dWy)
//    非格点值）保逐格直算臂。Float32Array 批处理评估结论:【不适用本面】——f32
//    量化即破设备矩形逐位红线（配准不变式）,LUT 恒 f64;顶点环 _batRing f32=GL 域
//    不归此限。
//  ② at() 算术化:i±ph/i∓1 直接下标（列主序 i=lx·ph+ly ⇒ (lx∓1,ly)=i∓ph、
//    (lx,ly∓1)=i∓1;主循环增量 ii 载体）——值=at 同式（at 即 lx·ph+ly 的单表达式）,
//    off 臂保持 at() 调用原样 ⇒ 双臂序列直比对算术化有判别力（typo 即红）。
// 【语义红线】bg 账终值（__liqPrepSnapshotForTest 23 数组逐位）+设备矩形逐位
//  （记录桩调用序列全等;node 分数变换 T(1.3,0,0,0.9,7.3,−11.7) 臂 exercise
//  ceil/floor 分区 rounding;活机冻结帧 A/B=scripts/_liqp3-ab.mjs）。
//  ★转正（2026-10-08 用户令;证据=机械闸 tests/liquid-liqp3-rect-parity.test.ts 全绿
//  （四臂组合 T1-T4 设备矩形逐位+记录桩调用序列全等+node 分数变换 ceil/floor 分区臂
//  +LUT 变异判别力）+活机冻结帧 A/B scripts/_liqp3-ab.mjs+Windows 实机三刀合账）：
//  缺省开,?liqp3=0 逃生门回现行链逐位。node/测试环境 init true=liqp2 同族形态。
export let liqP3 = typeof location !== 'undefined'
  ? new URLSearchParams(location.search).get('liqp3') !== '0' : true;
export function liqP3SetForTest(v: boolean): void { liqP3 = v; }

// ---- ★liqtint 微光基色双线性平滑面（2026-10-30 BJ738 网格感定谳刀;缺省开,?liqtint=0 逃生门）----
// 【病灶】CPU 原链/2D 重放面的微光基色=2×2 子块【常量色】multiply（8×8 世界px 单元,
//   applyShimmerBaseTint/replayLiqRun2D/replayLiqShimRun2D 三面同构）——微光场平滑
//   梯度上显 8px 阶梯=「像素网格感/格子间缝隙」（用户实报微光湖;veil 帧（7e 逃逸
//   队列/679 实体族）前景液体禁批回 CPU 链=C13c FS 平滑路径缺席的帧面）。
//   探针 scripts/_shimmer-grid-repro.mjs 定谳:自然微光湖深部 {"8":24} 严格 8px 网格;
//   杀 679 逃逸族实体（Faeling）后零梯度线=机制归因。
// 【修】原版 SetShimmerVertexColors=四角色置 quad 角+GPU 顶点双线性（LiquidRenderer
//   :745-759 modulate）——Canvas2D 无顶点色,旧近似=子块常量;新近似=2×2 惰性小画布
//   写四角色+单笔 drawImage 拉伸（smoothing=bilinear ≙ GPU varying 插值）。裁剪格
//   （壁值/bob/半格）经【源矩形分数采样】（u/v 归一×2）保持场世界锚定（相邻 tile
//   小画布共享边角值=跨格连续;与批路径 uL/uR/vT/vB 同域——顶点色路径的裁剪角是
//   采样点移位,本面是采样窗移位,两者同为 FS 逐像素求值的 C0 近似,census 有界）。
// 【域】node 无 document=面构造不可达→三面回退旧子块路径（逐位）;测试注入桩面
//   （tintSurfForTest）可锁新结构。?liqtint=0 同回退（逃生门）。
export let liqtint = typeof location !== 'undefined'
  ? new URLSearchParams(location.search).get('liqtint') !== '0' : true;
export function liqtintSetForTest(v: boolean): void { liqtint = v; }

/** 2×2 双线性面（惰性;node 恒 null=回退臂） */
let _tintCv: HTMLCanvasElement | null = null;
let _tintCtx: CanvasRenderingContext2D | null = null;
let _tintImg: ImageData | null = null;
function tintQuadSurf(): boolean {
  if (_tintCtx) return true;
  if (typeof document === 'undefined') return false;
  const cv = document.createElement('canvas');
  cv.width = 2; cv.height = 2;
  const c2 = cv.getContext('2d');
  if (!c2) return false;
  _tintCv = cv; _tintCtx = c2;
  _tintImg = c2.createImageData(2, 2);
  return true;
}
/** ★测试钩:2×2 面注入（node 无 document=生产构造不可达;测试注入桩面锁新结构,
 *  调用方 afterEach 注入 undefined 清面恢复生产路径——shimmerSparkBandForTest 同式） */
export function tintSurfForTest(cv: HTMLCanvasElement | null,
  c2: { putImageData(img: ImageData, dx: number, dy: number): void } | null,
  img: { data: Uint8ClampedArray } | null): void {
  _tintCv = cv;
  _tintCtx = (c2 ?? null) as CanvasRenderingContext2D | null;
  _tintImg = (img ?? null) as ImageData | null;
}

/**
 * 四角色（0..255）单笔双线性 multiply。u/v=目的窗在「角场归一域」的位置（0..1;
 * 原链=tile 内裁剪窗归一,重放面=整窗 0,0,1,1——重放环角色已按裁剪角采样）。
 * 返回 false=面缺席/旗关（调用方回退旧 2×2 子块路径）。
 * ★全局态约定:globalAlpha=1（原版 modulate 无 α 衰减,与旧子块同款强制）+
 *   imageSmoothingEnabled=true（仅此一笔;调用域 save/restore 或显式复位兜底）。 */
function tintBilinearQuad(
  ctx: CanvasRenderingContext2D,
  r00: number, g00: number, b00: number, r10: number, g10: number, b10: number,
  r01: number, g01: number, b01: number, r11: number, g11: number, b11: number,
  uL: number, vT: number, uR: number, vB: number,
  dstX: number, dstY: number, w: number, h: number,
): boolean {
  if (!liqtint || !tintQuadSurf()) return false;
  const d = _tintImg!.data;
  d[0] = r00; d[1] = g00; d[2] = b00; d[3] = 255;
  d[4] = r10; d[5] = g10; d[6] = b10; d[7] = 255;
  d[8] = r01; d[9] = g01; d[10] = b01; d[11] = 255;
  d[12] = r11; d[13] = g11; d[14] = b11; d[15] = 255;
  _tintCtx!.putImageData(_tintImg!, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'multiply';
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(_tintCv!, uL * 2, vT * 2, (uR - uL) * 2, (vB - vT) * 2, dstX, dstY, w, h);
  return true;
}

const _lvlLut = new Float32Array(256);
const _tovLut = new Uint8Array(256);
for (let j = 0; j < 256; j++) { _lvlLut[j] = j / 255; _tovLut[j] = toVanillaType(j); }
let _solidTy = new Uint8Array(1024).fill(255);   // 255=未解析哨兵（Map 版 undefined 同位）
/** solid LUT 冷支（哨兵解析+越界增长;热路调用方直读 _solidTy 不经此） */
function solidTy8(t: number): number {
  let a = _solidTy;
  if (t >= a.length) {
    const cap = Math.min(65536, Math.max(a.length * 2, t + 1));   // st.type=Uint16Array 值域封顶
    const nu = new Uint8Array(cap).fill(255);
    nu.set(a);
    a = _solidTy = nu;
  }
  return a[t] === 255 ? (a[t] = TILE_DEFS[t]?.solid === true ? 1 : 0) : a[t];
}
/** 行有效表（复用槽;每次 P1 扫描按 py0/ph 重建——同谓词 y>=0&&y<h 的预列） */
let _rowValid = new Uint8Array(128);
/** at() 模块单形函数（_atPh=本调用 ph;drawVanillaLiquids 入口同步——单线程渲染段
 *  内无重入,消费点全在同一调用栈内） */
let _atPh = 0;
function atM(lx: number, ly: number): number { return lx * _atPh + ly; }
/** ★测试钩:liqp2 LUT/atM 直访（node 单测判别力面——tests/liquid-liqp2-p1-parity.test.ts
 *  T4 变异注错/T5 atM 数学锁;生产路径零触碰）。仅测试可用。 */
export function __liqp2LutForTest(): {
  lvl: Float32Array; tov: Uint8Array; solid: Uint8Array;
  atM: (lx: number, ly: number) => number; setPh: (ph: number) => void;
} {
  return {
    lvl: _lvlLut, tov: _tovLut, solid: _solidTy,
    atM, setPh: (ph: number) => { _atPh = ph; },
  };
}

// ---- ★liqp3 矩形数学 LUT 暂存（f64!——f32 量化破设备矩形逐位,旗头注①评估结论）----
/** f 值域帽:ey0 的 f4∈[0,12]、ey1 的 f4+sh≤28、ex0 的 f2∈[0,12]、ex1 的 f2+sw≤28
 *  （f=floor(n·16) 上界 12（n≤0.75）、+ceil 项上界 16（n3/n5≤1 数学界）;33 留余量） */
const LIQ3_RC = 33;
const _p3ColX = new Float64Array(LIQ3_RC);
let _p3RowEy = new Float64Array(128 * LIQ3_RC);   // 行表（ph 超帽即长;只增不减）
/** ★测试钩:liqp3 LUT 直访（node 代数锁 T5:rowEy 全表确定性重构比对——tests/
 *  liquid-liqp3-rect-parity.test.ts;生产路径零触碰）。rowEy 走取引函数（增长
 *  重分配后句柄不失效）。 */
export function __liqp3LutForTest(): {
  colX: Float64Array; rowEy: () => Float64Array; rc: number;
} {
  return { colX: _p3ColX, rowEy: () => _p3RowEy, rc: LIQ3_RC };
}
/** ★测试钩:P1-P7 账面快照（bg 账终值逐位红线机械闸——tests/liquid-liqp2-p1-parity
 *  .test.ts;23 数组全拷贝,同窗双臂逐位直比）。生产路径零触碰。 */
export function __liqPrepSnapshotForTest(): {
  n: number; level: Float32Array; visLevel: Float32Array; opacity: Float32Array;
  isSolid: Uint8Array; hasLiquid: Uint8Array; hasWall: Uint8Array; hasVis: Uint8Array;
  type: Uint8Array; visType: Uint8Array;
  lW: Float32Array; rW: Float32Array; bW: Float32Array; tW: Float32Array;
  vlW: Float32Array; vrW: Float32Array; vbW: Float32Array; vtW: Float32Array;
  hasLE: Uint8Array; hasRE: Uint8Array; hasTE: Uint8Array; hasBE: Uint8Array;
  isHalf: Uint8Array; fx: Int16Array; fy: Int16Array;
} {
  const n = _liqCap;
  return {
    n,
    level: _level.slice(0, n), visLevel: _visLevel.slice(0, n), opacity: _opacity.slice(0, n),
    isSolid: _isSolidA.slice(0, n), hasLiquid: _hasLiquidA.slice(0, n), hasWall: _hasWallA.slice(0, n),
    hasVis: _hasVisA.slice(0, n), type: _typeA.slice(0, n), visType: _visTypeA.slice(0, n),
    lW: _lW.slice(0, n), rW: _rW.slice(0, n), bW: _bW.slice(0, n), tW: _tW.slice(0, n),
    vlW: _vlW.slice(0, n), vrW: _vrW.slice(0, n), vbW: _vbW.slice(0, n), vtW: _vtW.slice(0, n),
    hasLE: _hasLE.slice(0, n), hasRE: _hasRE.slice(0, n), hasTE: _hasTE.slice(0, n), hasBE: _hasBE.slice(0, n),
    isHalf: _isHalfA.slice(0, n), fx: _fx.slice(0, n), fy: _fy.slice(0, n),
  };
}

/** 批发射钩（Renderer 中介→GLShimExecutor.pushQuadBatchRgba;emitPrecipQuadBatch 同构） */
export interface LiqBatchEmit {
  emit(img: CanvasImageSource, key: string, data: Float32Array, quads: number,
    replay: (ctx: CanvasRenderingContext2D) => void): boolean;
  /** ★liqpolish ADD 批通道（sparkle/glint 逐 tile shim rec 退役面）——tier-1 保序
   *  入队（pushLiquidAddBatch;ga/gco 逐 quad 编码进顶点,入口态不设门=gore 批判例）。
   *  可选（测试桩/旧钩缺省=undefined→ADD 段走 2D 直画兜底）。
   *  false=入口门拒（clip/filter/GL 死）→调用方本段 2D 直画兜底。 */
  emitAdd?(img: CanvasImageSource, key: string, data: Float32Array, quads: number,
    replay: (ctx: CanvasRenderingContext2D) => void): boolean;
}

// ---- 批环（单槽跨帧复用;雨刀 rainBatchData 判例）----
const LIQ_STRIDE = 8;                        // x,y,u,v,r,g,b,a
const LIQ_QUAD_FLOATS = 6 * LIQ_STRIDE;      // 48
const LIQ_RING_CAP = 16384;                  // quad/帧帽（超出=余帧回 CPU 路径,登记有界）
const LIQ_TIE_EPS = 1 / 4096;                // quadSprite 同款 texel tie 补正（QUAD_TIE_EPS 判例）
const _batRing = new Float32Array(LIQ_RING_CAP * LIQ_QUAD_FLOATS);
/** 每 quad 重放面:sx,sy,sw,shSrc（dst 几何在顶点环内;重放 drawImage 取源矩形） */
const _batMeta = new Float32Array(LIQ_RING_CAP * 4);
let _batN = 0;                               // 本帧已入环 quad 总数
let _batFrame = -1;                          // 环复位帧号（frameToken=animTick）
let _batOverflow = false;                    // 帽触发位（触发后本帧余量恒 CPU 路径）
/** ★C13b 软溢出位（带/坡面批专用）：溢出只把本批臂余帧降级 CPU（=现行逐 op 行为）,
 *  【不】置 _batOverflow——硬位会连带触发 fg canvas-gate 回退（liqRingOverflow 消费）
 *  与 fg 复用停用,带 quads 不在 gate（_fgRuns 只收主循环段）,连带=重场景无谓劣化。 */
let _batSoftOvf = false;
/** gate y 镜像重发射数据槽（消费即弃,单槽同帧消费——雨刀同判例） */
const _gateData = new Float32Array(LIQ_RING_CAP * LIQ_QUAD_FLOATS);
/** 微光四角色单槽（shimmerCornerColors 写入,batQuad 读——消费即弃零驻留） */
const _batCols = new Float32Array(12);

// ---- ★liqpolish ADD 批环（sparkle/glint;2026-09-29 微光微抛光刀）----
// 【trace 定谳】微光湖 doSpark tile 逐格 ctx.save/gco/globalAlpha/drawImage/restore
//  经 shim 成逐格 rec（resolveTex 逐 rec texAlive=稳定键族 texAlive 176.9ms 的主力
//  面+逐格 quadSprite draw call）;glint 逐格 flushRun 把基底批切成逐列段+fillRect
//  solid rec。本环把两族改顶点批:ADD 段（tier-1）每 pass ≤2 段单 drawArrays。
// 【与 SO 基底环分离】基底段与 ADD 段时序交错,单环无法保连续段;分离环+段收口序
//  =全 pass 基底段先于 ADD 段（重叠序论证:ADD quad 域 ⊆ 本格∪上格（bob 上侵）,
//  上格基底恒先画——all-bases-before-adds 与原逐格交织逐像素同）。
const _addRing = new Float32Array(LIQ_RING_CAP * LIQ_QUAD_FLOATS);
/** fg 复用环（bg 构造段缩放拷贝目标;★禁原位缩放——bg rec 持 _batRing 活视图,
 *  flush 前原位改写=bg 已入队数据被污染(背景水吃 fg α 的实锤级 bug 面) */
const _fgReuseRing = new Float32Array(LIQ_RING_CAP * LIQ_QUAD_FLOATS);
/** 每 quad 重放面:sx,sy,sw,shSrc（同 _batMeta 布局;重放 drawImage 取源矩形） */
const _addMeta = new Float32Array(LIQ_RING_CAP * 4);
let _addN = 0;
let _addOverflow = false;

// ---- ★C13c 微光波场批环（stride 11;2026-10-01 二期刀;liqgl 刀2/C13b _batRing 同构新环）----
// 【stride 11 = x,y,u,v,r,g,b,a + tileX,tileY + noise】方案 H（设计案 §3.2 采纳）:
//  波值场 FS 逐像素解析（aTile=世界px/16 连续坐标,VS 线性插值精确）;noise hash+sin 留
//  CPU 逐节点（uint→f32 高位损失 256=相位级差位等不可达,§2.2 定谳）经 aNoise 属性上传。
//  【与主环分离】stride 不同（66 vs 48 float/quad）,同环混排=偏移数学破坏;分离环+
//  发射位=调用位（flushRun/flushShimRun 成对收口）=层序保持。
//  【惰性分配】灰度旗缺省关——未激活会话零静态内存;首次 c13c 批臂触碰一次建面。
const LIQ_SHIM_STRIDE = 11;
const LIQ_SHIM_QUAD_FLOATS = 6 * LIQ_SHIM_STRIDE;   // 66
let _shimRing: Float32Array | null = null;
/** 每 quad 重放面:sx,sy,sw,shSrc（_batMeta 同布局;重放 drawImage 取源矩形） */
let _shimMeta: Float32Array | null = null;
/** fg 复用缩放拷贝目标（_fgReuseRing 判例同构——★禁原位缩放;stride 11） */
let _fgReuseShimRing: Float32Array | null = null;
/** gate y 镜像重发射槽（_gateData 判例同构;stride 11） */
let _gateShimData: Float32Array | null = null;
function ensureShimRings(): void {
  if (_shimRing) return;
  _shimRing = new Float32Array(LIQ_RING_CAP * LIQ_SHIM_QUAD_FLOATS);
  _shimMeta = new Float32Array(LIQ_RING_CAP * 4);
  _fgReuseShimRing = new Float32Array(LIQ_RING_CAP * LIQ_SHIM_QUAD_FLOATS);
  _gateShimData = new Float32Array(LIQ_RING_CAP * LIQ_SHIM_QUAD_FLOATS);
  // ★三期:sparkle 亮纹环同批建面（同 stride/同生命周期;惰性判据=c13c 臂首触）
  _spShimRing = new Float32Array(LIQ_RING_CAP * LIQ_SHIM_QUAD_FLOATS);
  _spShimMeta = new Float32Array(LIQ_RING_CAP * 4);
}
let _shimN = 0;
/** ★三期 sparkle 亮纹环（stride 11 同构独立环;2026-10-02 逐像素化刀;★四期修正
 *  2026-10-07:aNoise 槽改载四角 glitter 终值,FS uSpark=1 支消费硬件 varying 插值=
 *  原版 SetShimmerVertexColors_Sparkle（LiquidRenderer.cs:732-743）顶点色插值 1:1
 *  ——旧 FS 内 remap 链逐像素=插值后钳制≠原版钳制后插值,系统性变暗+折痕高频化=
 *  果冻感回归定谳面）:
 *  body 域（c13cOn ∧ flag=false）sparkle ADD quad 改走 liqshimmer 程序 uSpark=1 段
 *  （亮纹透明度=顶点插值域）——与基体环分离的理由:①段纹理互异
 *  （白度带 vs 水表）②收口时序互异（基体段随发射位收口,亮纹段随 ADD 族 pass 尾
 *  flushAddRuns2DAndEmit 收口——同环会互相打断=liqpolish 逐 sparkle 收口碎段病同型）。
 *  键族 liqspark:（与旧 _sp ADD 段同键=同一白度带纹理缓存条目复用）;uSpark 分派
 *  判据=e.key 前缀（quadBatchLiqShimmer 发射口）;ADD blend 由 pushLiquidAddBatch
 *  tier-1 rec 驱动（flushAcc 逐 rec 换档既有链,发射口零 blend 语义）。 */
let _spShimRing: Float32Array | null = null;
let _spShimMeta: Float32Array | null = null;
let _spShimN = 0;
/** ★三期 sparkle 亮纹段状态（_sp ADD 段状态机同构;白度带纹理同质单段） */
let _spShimOn = false, _spShimStart = 0, _spShimQuads = 0,
  _spShimImg: CanvasImageSource | null = null, _spShimKey = '';
/** 微光批段状态（主循环微光臂与浸润带微光臂共用——时序不相交:主循环段收口先于
 *  带 pass;段=微光表纹理同质（Misc_water_14/Liquid_14/LiquidSlope_14 文件互异→
 *  纹理换段自动分段,永不混段,C13b 双臂共享判例同构） */
let _shimOn = false, _shimStart = 0, _shimImg: CanvasImageSource | null = null, _shimKey = '';
/** noise-sin 单槽（方案 H CPU 4 sin/tile;_shimWv=[w0..w3,ns0..ns3] 供 glitter4FromWaves
 *  位等复用——与 polish 臂同代码路径=sparkGa 逐位同） */
const _shimNs = new Float64Array(4);
const _shimWv = new Float64Array(8);
/** sparkle 段（单白度带纹理=色相进顶点色,全 pass 一段;段界=帧界/环帽/发射失败） */
let _spOn = false, _spStart = 0, _spQuads = 0, _spImg: CanvasImageSource | null = null, _spKey = '';
/** glint 段（白 1×1 纹理,前景 pass 一段） */
let _glOn = false, _glStart = 0, _glQuads = 0;
/** sparkle 16 档色相 RGB/255 顶点色表（惰性;与 tintSparkleBand 同源同量化:
 *  hslToRgb(hueIdx/16,1,0.5) → round(·255)/255） */
let _sparkHueRGB: Float32Array | null = null;
function sparkHueRGB(): Float32Array {
  if (_sparkHueRGB) return _sparkHueRGB;
  const t = new Float32Array(16 * 3);
  for (let i = 0; i < 16; i++) {
    const [r, g, b] = hslToRgb(i / SPARKLE_HUE_STEPS, 1, 0.5);
    t[i * 3] = Math.round(r * 255) / 255;
    t[i * 3 + 1] = Math.round(g * 255) / 255;
    t[i * 3 + 2] = Math.round(b * 255) / 255;
  }
  _sparkHueRGB = t;
  return t;
}
/** sparkle 段顶点色单槽（四角同色;batQuadAdd 读——消费即弃） */
const _spCols = new Float32Array(12);

// ---- ★liqpolish fg 复用账（bg pass 构造段登记→fg pass 缩放重发射）----
// 【不变式】双 pass 逐 tile 构造确定性同值（prep 同帧缓存/P3 幂等重跑/波场
// sampleDisplace 帧内确定/shimmer 场只依赖 (x,y,tVis)/设备矩形同变换）⇒
// fg quad = bg quad 的 α 缩放体:min(1,o·k)=o·k（opacity≤1 恒成立——P3 写入
// k∈(0,1]/fill(1) 初值）,rgb 预乘同比例;sparkle 双 pass 同 α（无 isBackground
// 因子）逐位拷贝;glint bg 记录臂（sampleGlint 帧内确定,bg 不画）。fg 逐 tile
// 构造循环整体跳过（trace 定谳 drawVanillaLiquids self 的 ~50% 构成面）。
interface BgRun { img: CanvasImageSource; key: string; start: number; quads: number; k: number; cols: boolean; shim?: boolean }
let _bgBaseRuns: BgRun[] = [];
let _bgSpark: { start: number; quads: number; img: CanvasImageSource; key: string } | null = null;
/** ★三期 sparkle 亮纹段 fg 复用账（_bgSpark 同构;α 双 pass 同值=逐位拷贝重发射） */
let _bgSparkShim: { start: number; quads: number; img: CanvasImageSource; key: string } | null = null;
let _bgGlint: { start: number; quads: number } | null = null;
let _bgRunsFrame = -1;
/** sparkle 白度带（RGB=255,A=亮度——premul 上传后 tex_p=(L,L,L,L),rainbow 色相经
 *  顶点色:out.rgb = L×(R8/255×ga) ≙ 旧染色带 premul(R8·L/255)×ga（±1LSB f32 域,
 *  census 登记）。旧 per-hue 染色带 16 段→单白带 1 段。键含 texId（_sparkleTintCache
 *  同款跨世界判例）;null=源未就绪→本 tile 落 CPU 原链。 */
const _sparkBandCache = new Map<string, HTMLCanvasElement | null>();
/** ★测试钩:shimmerSparkBand 覆盖（node 无 document→带构造恒 null,亮纹环路径不可达;
 *  注入 fake {width,height} 即可走环数学。undefined=清钩=生产路径。仅测试/探针可用。 */
let _sparkBandOverride: HTMLCanvasElement | null | undefined;
export function shimmerSparkBandForTest(v: HTMLCanvasElement | null | undefined): void {
  _sparkBandOverride = v;
}
function shimmerSparkBand(tex: ImageBitmap | HTMLImageElement): HTMLCanvasElement | null {
  if (_sparkBandOverride !== undefined) return _sparkBandOverride;
  if (!texReady(tex)) return null;
  const ck = `band|${texId(tex)}`;
  if (_sparkBandCache.has(ck)) return _sparkBandCache.get(ck) ?? null;
  const bandX = 48;
  const bandW = tex.width - bandX;
  if (bandW <= 0 || typeof document === 'undefined') { _sparkBandCache.set(ck, null); return null; }
  const c = document.createElement('canvas');
  c.width = bandW; c.height = tex.height;
  const cc = c.getContext('2d', { willReadFrequently: true });
  if (!cc) { _sparkBandCache.set(ck, null); return null; }
  cc.imageSmoothingEnabled = false;
  cc.drawImage(tex, bandX, 0, bandW, tex.height, 0, 0, bandW, tex.height);
  // 灰度亮度 → alpha（tintSparkleBand 同式,先取后写）;RGB 恒 255（白）——色相改顶点色承载
  const img = cc.getImageData(0, 0, bandW, tex.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    d[i] = 255; d[i + 1] = 255; d[i + 2] = 255;
    d[i + 3] = lum;
  }
  cc.putImageData(img, 0, 0);
  _sparkBandCache.set(ck, c);
  return c;
}
/** 白 1×1 canvas（glint ADD 批纹理;fillRect '#ffffff' 'lighter' 的批化源） */
let _glintWhiteCv: HTMLCanvasElement | null = null;
function glintWhiteCv(): HTMLCanvasElement {
  if (_glintWhiteCv) return _glintWhiteCv;
  const c = document.createElement('canvas');
  c.width = 1; c.height = 1;
  const x = c.getContext('2d')!;
  x.fillStyle = '#fff';
  x.fillRect(0, 0, 1, 1);
  _glintWhiteCv = c;
  return c;
}
/** ADD quad 入批环（batQuad 同构,目标=_addRing/_addMeta/_addN;溢出置 _addOverflow）。 */
function batQuadAdd(
  sx: number, sy: number, sw: number, shSrc: number, texW: number, texH: number,
  dx0: number, dy0: number, dw: number, dh: number, a: number,
  cols: Float32Array | null, colOff: number,
): boolean {
  if (_addN >= LIQ_RING_CAP) { _addOverflow = true; return false; }
  const o = _addN * LIQ_QUAD_FLOATS;
  const ua = (sx - LIQ_TIE_EPS) / texW, ub = (sx + sw - LIQ_TIE_EPS) / texW;
  const va = (sy - LIQ_TIE_EPS) / texH, vb = (sy + shSrc - LIQ_TIE_EPS) / texH;
  const D = _addRing;
  const r0 = (cols ? cols[colOff] : 1) * a, g0 = (cols ? cols[colOff + 1] : 1) * a, b0 = (cols ? cols[colOff + 2] : 1) * a;
  const r1 = (cols ? cols[colOff + 3] : 1) * a, g1 = (cols ? cols[colOff + 4] : 1) * a, b1 = (cols ? cols[colOff + 5] : 1) * a;
  const r2 = (cols ? cols[colOff + 6] : 1) * a, g2 = (cols ? cols[colOff + 7] : 1) * a, b2 = (cols ? cols[colOff + 8] : 1) * a;
  const r3 = (cols ? cols[colOff + 9] : 1) * a, g3 = (cols ? cols[colOff + 10] : 1) * a, b3 = (cols ? cols[colOff + 11] : 1) * a;
  const x1 = dx0 + dw, y1 = dy0 + dh;
  D[o] = dx0; D[o + 1] = dy0; D[o + 2] = ua; D[o + 3] = va; D[o + 4] = r0; D[o + 5] = g0; D[o + 6] = b0; D[o + 7] = a;
  D[o + 8] = x1; D[o + 9] = dy0; D[o + 10] = ub; D[o + 11] = va; D[o + 12] = r1; D[o + 13] = g1; D[o + 14] = b1; D[o + 15] = a;
  D[o + 16] = x1; D[o + 17] = y1; D[o + 18] = ub; D[o + 19] = vb; D[o + 20] = r2; D[o + 21] = g2; D[o + 22] = b2; D[o + 23] = a;
  D[o + 24] = dx0; D[o + 25] = dy0; D[o + 26] = ua; D[o + 27] = va; D[o + 28] = r0; D[o + 29] = g0; D[o + 30] = b0; D[o + 31] = a;
  D[o + 32] = x1; D[o + 33] = y1; D[o + 34] = ub; D[o + 35] = vb; D[o + 36] = r2; D[o + 37] = g2; D[o + 38] = b2; D[o + 39] = a;
  D[o + 40] = dx0; D[o + 41] = y1; D[o + 42] = ua; D[o + 43] = vb; D[o + 44] = r3; D[o + 45] = g3; D[o + 46] = b3; D[o + 47] = a;
  const m = _addN * 4;
  _addMeta[m] = sx; _addMeta[m + 1] = sy; _addMeta[m + 2] = sw; _addMeta[m + 3] = shSrc;
  _addN++;
  return true;
}
/** ADD 批段 2D 降级重放（'lighter' 逐 quad drawImage/fillRect;宁回退不丢精灵）。
 *  solidGlint=true:白 fillRect 支（glint 段;顶点几何即设备矩形）。 */
function replayLiqAddRun2D(ctx: CanvasRenderingContext2D, startQuad: number, quads: number,
  tex: CanvasImageSource, solidGlint: boolean): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.globalCompositeOperation = 'lighter';
  const D = _addRing;
  for (let q = 0; q < quads; q++) {
    const o = (startQuad + q) * LIQ_QUAD_FLOATS;
    const m = (startQuad + q) * 4;
    const ga = D[o + 7];
    const dw = D[o + 8] - D[o], dh = D[o + 41] - D[o + 1];
    if (ga <= 0 || dw <= 0 || dh <= 0) continue;
    ctx.globalAlpha = ga;
    if (solidGlint) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(D[o], D[o + 1], dw, dh);
    } else {
      ctx.drawImage(tex, _addMeta[m], _addMeta[m + 1], _addMeta[m + 2], _addMeta[m + 3],
        D[o], D[o + 1], dw, dh);
    }
  }
  ctx.restore();
}
/** ADD 段收尾（主循环尾/溢出/batOn 断点调用;发射失败/钩缺省=本段 2D 直画兜底）。
 *  ★调用序契约:必须在本 pass 基底段 flushRun() 之后（重叠序 all-bases-before-adds）。
 *  record=true（bg pass）:GL 发射成功段登记 fg 复用账（_bgSpark/_bgGlint）。 */
function flushAddRuns2DAndEmit(
  ctx: CanvasRenderingContext2D, bat: LiqBatchEmit | null, record: boolean,
): void {
  if (_spOn) {
    _spOn = false;
    if (_spQuads > 0 && bat?.emitAdd && _spImg) {
      const s0 = _spStart, nQ = _spQuads, img = _spImg, k = _spKey;
      const ok = bat.emitAdd(img, k, _addRing.subarray(s0 * LIQ_QUAD_FLOATS, (s0 + nQ) * LIQ_QUAD_FLOATS),
        nQ, (raw) => replayLiqAddRun2D(raw, s0, nQ, img, false));
      if (!ok) replayLiqAddRun2D(ctx, s0, nQ, img, false);
      else if (record) _bgSpark = { start: s0, quads: nQ, img, key: k };
    } else if (_spQuads > 0 && _spImg) {
      replayLiqAddRun2D(ctx, _spStart, _spQuads, _spImg, false);
    }
    _spQuads = 0; _spImg = null; _spKey = '';
  }
  if (_spShimOn) {
    // ★三期 sparkle 亮纹段收尾（_sp ADD 段收尾同构;emitAdd→pushLiquidAddBatch
    //  tier-1=ADD blend 由 flushAcc 换档链驱动,66-shape+liqspark: 键=uSpark 分派）。
    //  与 _sp 段的先后无视觉面（top/body tile 集不相交——flag 谓词互斥）。
    _spShimOn = false;
    if (_spShimQuads > 0 && bat?.emitAdd && _spShimImg) {
      const s0 = _spShimStart, nQ = _spShimQuads, img = _spShimImg, k = _spShimKey;
      const ok = bat.emitAdd(img, k,
        _spShimRing!.subarray(s0 * LIQ_SHIM_QUAD_FLOATS, (s0 + nQ) * LIQ_SHIM_QUAD_FLOATS),
        nQ, (raw) => replayLiqSparkShimRun2D(raw, s0, nQ, img));
      if (!ok) replayLiqSparkShimRun2D(ctx, s0, nQ, img);
      else if (record) _bgSparkShim = { start: s0, quads: nQ, img, key: k };
    } else if (_spShimQuads > 0 && _spShimImg) {
      replayLiqSparkShimRun2D(ctx, _spShimStart, _spShimQuads, _spShimImg);
    }
    _spShimQuads = 0; _spShimImg = null; _spShimKey = '';
  }
  if (_glOn) {
    _glOn = false;
    if (_glQuads > 0 && bat?.emitAdd) {
      const s0 = _glStart, nQ = _glQuads;
      const img = glintWhiteCv();
      const k = `liqglint:${texId(img)}`;
      const ok = bat.emitAdd(img, k, _addRing.subarray(s0 * LIQ_QUAD_FLOATS, (s0 + nQ) * LIQ_QUAD_FLOATS),
        nQ, (raw) => replayLiqAddRun2D(raw, s0, nQ, img, true));
      if (!ok) replayLiqAddRun2D(ctx, s0, nQ, img, true);
      else if (record) _bgGlint = { start: s0, quads: nQ };
    } else if (_glQuads > 0) {
      replayLiqAddRun2D(ctx, _glStart, _glQuads, glintWhiteCv(), true);
    }
    _glQuads = 0;
  }
}

/** 批段（一次发射=同纹理连续 quad 区间;可见批与 gate 重发射共用）。
 *  ★C13c shim=true=stride-11 微光段（源环 _shimRing,gate 重发射走 _gateShimData） */
/** ★BJ743:data=发射数据切片视图（复用臂=_fgReuseRing 缩放后数据/直发臂=环本帧
 *  数据——消除环歧义:复用帧 _batRing 恒为 bg 未缩放数据,旧偏移读法=gate/罩源
 *  误读 bg α;gate α×100 饱和域无害罩着,罩源 α 语义面实害）。帧界内有效。 */
interface LiqRun { img: CanvasImageSource; key: string; start: number; quads: number; shim?: boolean; data?: Float32Array; }
/** 前景 pass 批段登记（emitVanillaLiquidGate 消费;帧界由 gateCapture 调用重置） */
let _fgRuns: LiqRun[] = [];
/** 坡面足迹四边形（世界坐标;gate 发射时经 wldT 折算设备——fgCanvas 足迹画布退役面） */
interface FootQuad {
  tex: ImageBitmap | HTMLImageElement | null; solid: boolean;
  sx: number; sy: number; sw: number; sh: number;
  dx: number; dy: number; dw: number; dh: number;
}
let _footQuads: FootQuad[] = [];
let _footFrame = -1;
/** 足迹世界→设备折算矩阵（bg pass 恢复世界变换后捕获;轴对齐=世界变换构造面保证） */
const _footWld = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** 微光 tile 顶点色四角。★R2b-F5（2026-09-27 注释翻案）:原版 SetShimmerVertexColors
 *  （LiquidRenderer.cs:745-759）的机制 = 【节点值置位于 quad 角】——GetShimmerBaseColor
 *  在四个整节点 (x,y)/(x+1,y)/(x,y+1)/(x+1,y+1) 取值后直接放到（可能被液面裁剪的）
 *  quad 四角上,并非对场在裁剪角求值;故裁剪格上原版顶点=完整 tile 的 y/y+1 行节点值。
 *  本函数 = 双线性张量在裁剪角 (u,v) 求值——两式【仅未裁剪时相等】（双线性插值在
 *  节点处还原节点值;裁剪时本式=场@vT、原版=节点值,差=(1−vT) 加权朝 y+1 行）。
 *  实测备案（2026-09-27,3600 相位×49 位点×15 裁剪档）:表层裁剪顶角偏差 max 3.92/255
 *  （≈1.5%）、mean 1.23/255——在微光 census 4.59%（LA maxd 29≤72）备案域内,不立项。
 *  另注:批两三角对角线 (p0,p1,p2)+(p0,p2,p3)=TL-BR ≠ XNA SpriteBatcher 对角线
 *  （顶点序 TL,TR,BL,BR、(0,1,2)(1,3,2)=TR-BL）——双线性场的二次项在整格中心
 *  最大差 max 0.49/255=亚 LSB（8bit 量化步以下）。out 写调用方槽（零分配）。 */
function shimmerCornerColors(
  x: number, y: number, tVis: number,
  uL: number, uR: number, vT: number, vB: number,
  out: Float32Array, o: number,
): void {
  const c00 = shimmerBaseColorF(x, y, tVis), c10 = shimmerBaseColorF(x + 1, y, tVis);
  const c01 = shimmerBaseColorF(x, y + 1, tVis), c11 = shimmerBaseColorF(x + 1, y + 1, tVis);
  const bil = (u: number, v: number, k: number): number =>
    c00[k] * (1 - u) * (1 - v) + c10[k] * u * (1 - v) + c01[k] * (1 - u) * v + c11[k] * u * v;
  // 角序 = 顶点序 v0 TL / v1 TR / v2 BR / v3 BL（入环序一致）
  const corners: readonly (readonly [number, number])[] = [[uL, vT], [uR, vT], [uR, vB], [uL, vB]];
  for (let ci = 0; ci < 4; ci++) {
    const [u, v] = corners[ci];
    out[o + ci * 3] = bil(u, v, 0) / 255;
    out[o + ci * 3 + 1] = bil(u, v, 1) / 255;
    out[o + ci * 3 + 2] = bil(u, v, 2) / 255;
  }
}

// ---- ★liqpolish 微光场单源（2026-09-29 微抛光刀）----
// 【trace 定谳】微光 tile 每格旧路径 sin×12（基色 4+glitter 4 波值重复求值+噪声 sin 4）
//  + ~10 处分配/格（shimmerBaseColorF 返回三元组×4、lerp 闭包×4、bil 闭包、corners
//  表×4 子表）——数百列湖 ×2 pass/帧的构造税主体之一。
// 【本核】四节点波值一次求出（基色四角与 glitter 透明度共享,12→8 sin/格）;跨 pass
//  波值缓存（bg 写/fg 读,fg 每格 0 sin）。旧三函数保留=CPU 原链与测试锚不动。
const SHIM_A_R = 0.64705884, SHIM_D_R = 41 / 51 - 0.64705884;   // GetShimmerBaseColor lerp 端点
const SHIM_A_G = 26 / 51, SHIM_D_G = 41 / 51 - 26 / 51;
const SHIM_A_B = 14 / 15, SHIM_D_B = 1 - 14 / 15;
/** 波值+噪声 sin 缓存（8 f64/tile: w00,w10,w01,w11,n00,n10,n01,n11;索引域=at(lx,ly)）。
 *  ★f64 容器（非 f32!）:旧路径波值全程 f64,缓存量化即位破（f32 边界翻转实证——
 *  位等锁 tests/liqpolish-shimmer-field.test.ts 抓的正是这个）。
 *  有效性 stamps:帧 token+ tVis+ 窗高 ph——三者任一变即失效重算（写臂=帧内首 pass）。 */
let _wvArr: Float64Array | null = null;
let _wvCap = 0;
let _wvTok: number | undefined;
let _wvTVis = -1;
let _wvPh = 0;
/** 微光 tile 场单源求值（三件套:波值解析/glitter 四节点/基色四角——旧路径每格
 *  sin×12+分配×10 的构造税核）。位等论证与实测锁见各函数头注。 */
const _wvLocal = new Float64Array(8);        // 无缓存臂的每格波值暂存（写臂/本地同构;★f64=波值不量化,位等前提）
const _wvTint = new Float64Array(8);         // applyShimmerBaseTint 波值暂存（主循环 _wvLocal 不共用=调用域隔离）
const _glit4 = new Float64Array(4);          // glitter 四节点单槽（★f64:sparkGa 均值在顶点 α 入环前不量化）
/** multiply fillStyle 串 memo（applyShimmerBaseTint/replayLiqRun2D 共用;键=rgb 打包,
 *  值=串实例——同值复用免重复构造+解析;串值逐字节同=canvas 状态逐位同） */
const _tintStyleMemo = new Map<number, string>();
/** 四节点波值+噪声 sin 解析（无缓存臂;缓存臂由调用方直读 _wvArr）。写 out:
 *  [w00,w10,w01,w11,n00,n10,n01,n11]。 */
function shimmerWaves4(x: number, y: number, tVis: number, out: Float64Array, o: number): void {
  out[o] = shimmerWave(x, y, tVis);
  out[o + 1] = shimmerWave(x + 1, y, tVis);
  out[o + 2] = shimmerWave(x, y + 1, tVis);
  out[o + 3] = shimmerWave(x + 1, y + 1, tVis);
  out[o + 4] = Math.sin(shimmerWhiteNoise(x, y) / 10 + tVis / 180);
  out[o + 5] = Math.sin(shimmerWhiteNoise(x + 1, y) / 10 + tVis / 180);
  out[o + 6] = Math.sin(shimmerWhiteNoise(x, y + 1) / 10 + tVis / 180);
  out[o + 7] = Math.sin(shimmerWhiteNoise(x + 1, y + 1) / 10 + tVis / 180);
}
/** GetShimmerGlitterOpacity 四节点体部式（top 门在调用方;num2=缓存噪声 sin,w=共享波值
 *  ——与旧函数逐项同式:remap(remap(w,-0.5,1,0,0.35)×num2, 0,0.5,0,1)）。 */
function glitter4FromWaves(wv: Float64Array, wo: number, glOut: Float64Array): void {
  glOut[0] = remap(remap(wv[wo], -0.5, 1, 0, 0.35) * wv[wo + 4], 0, 0.5, 0, 1);
  glOut[1] = remap(remap(wv[wo + 1], -0.5, 1, 0, 0.35) * wv[wo + 5], 0, 0.5, 0, 1);
  glOut[2] = remap(remap(wv[wo + 2], -0.5, 1, 0, 0.35) * wv[wo + 6], 0, 0.5, 0, 1);
  glOut[3] = remap(remap(wv[wo + 3], -0.5, 1, 0, 0.35) * wv[wo + 7], 0, 0.5, 0, 1);
}
/** 基色四角（缓存波值版 shimmerCornerColors——角序/乘加序/除 255 逐项同;
 *  lerp 端点同构 f64 常量预析（模块初始化求值=运行期同值））。 */
function shimmerCornersFromWaves(
  wv: Float64Array, wo: number,
  uL: number, uR: number, vT: number, vB: number,
  out: Float32Array, o: number,
): void {
  const w00 = wv[wo], w10 = wv[wo + 1], w01 = wv[wo + 2], w11 = wv[wo + 3];
  const k00 = 0.1 + w00 * 0.4, k10 = 0.1 + w10 * 0.4, k01 = 0.1 + w01 * 0.4, k11 = 0.1 + w11 * 0.4;
  const r00 = 255 * (SHIM_A_R + SHIM_D_R * k00), g00 = 255 * (SHIM_A_G + SHIM_D_G * k00), b00 = 255 * (SHIM_A_B + SHIM_D_B * k00);
  const r10 = 255 * (SHIM_A_R + SHIM_D_R * k10), g10 = 255 * (SHIM_A_G + SHIM_D_G * k10), b10 = 255 * (SHIM_A_B + SHIM_D_B * k10);
  const r01 = 255 * (SHIM_A_R + SHIM_D_R * k01), g01 = 255 * (SHIM_A_G + SHIM_D_G * k01), b01 = 255 * (SHIM_A_B + SHIM_D_B * k01);
  const r11 = 255 * (SHIM_A_R + SHIM_D_R * k11), g11 = 255 * (SHIM_A_G + SHIM_D_G * k11), b11 = 255 * (SHIM_A_B + SHIM_D_B * k11);
  const uLc = 1 - uL, uRc = 1 - uR, vTc = 1 - vT, vBc = 1 - vB;
  out[o] = (r00 * uLc * vTc + r10 * uL * vTc + r01 * uLc * vT + r11 * uL * vT) / 255;
  out[o + 1] = (g00 * uLc * vTc + g10 * uL * vTc + g01 * uLc * vT + g11 * uL * vT) / 255;
  out[o + 2] = (b00 * uLc * vTc + b10 * uL * vTc + b01 * uLc * vT + b11 * uL * vT) / 255;
  out[o + 3] = (r00 * uRc * vTc + r10 * uR * vTc + r01 * uRc * vT + r11 * uR * vT) / 255;
  out[o + 4] = (g00 * uRc * vTc + g10 * uR * vTc + g01 * uRc * vT + g11 * uR * vT) / 255;
  out[o + 5] = (b00 * uRc * vTc + b10 * uR * vTc + b01 * uRc * vT + b11 * uR * vT) / 255;
  out[o + 6] = (r00 * uRc * vBc + r10 * uR * vBc + r01 * uRc * vB + r11 * uR * vB) / 255;
  out[o + 7] = (g00 * uRc * vBc + g10 * uR * vBc + g01 * uRc * vB + g11 * uR * vB) / 255;
  out[o + 8] = (b00 * uRc * vBc + b10 * uR * vBc + b01 * uRc * vB + b11 * uR * vB) / 255;
  out[o + 9] = (r00 * uLc * vBc + r10 * uL * vBc + r01 * uLc * vB + r11 * uL * vB) / 255;
  out[o + 10] = (g00 * uLc * vBc + g10 * uL * vBc + g01 * uLc * vB + g11 * uL * vB) / 255;
  out[o + 11] = (b00 * uLc * vBc + b10 * uL * vBc + b01 * uLc * vB + b11 * uL * vB) / 255;
}

/** 2D tile quad 入批环（设备空间;uv=全跨度−ε tie 补正,quadSprite 同式）。
 *  ★rgb 预乘 per-quad α（2026-09-28 半砖/斜坡水色差定谳单点刀）:quadBatchRgba
 *  着色器契约 = 顶点 rgb【已预乘 quad α】（PRECIP_FS out=(c.rgb×vCol.rgb,
 *  c.a×vCol.a) 不再乘 α;buildPrecipBatch 沙尘叠画 vCol.rgb=tint×ga=族约定）——
 *  旧码直写未预乘白/顶点色,前景 α<1 quad 在 (ONE,1−SA) 混合下 rgb 全强入面:
 *  out=S+dst×(1−α) ≠ 2D globalAlpha 语义 out=S×α+dst×(1−α)。探针
 *  _slope-water-flip-ab 定谳面:前景格 wOn=[53,92,214] vs wOff=[49,61,119]
 *  （Δ=0.5·S_texel;bg+fg 叠格 1.5·S 钳 255）=用户实报「水格子太亮像叠色/
 *  偶发闪烁」。微光重放用色由 replayLiqRun2D 按 R2b-F3 unpre 惯例拆回。
 *  r=g=b=1 → 恒等调制(预乘后=α);微光 tile 传四角逐通道色(预乘 gaT)。
 *  ★C13b soft 入参（缺省 false=主循环硬域）：带批/坡面增强段传 true——帽触发只置
 *  _batSoftOvf（本批臂余帧降 CPU）,不触 _batOverflow 硬面（gate 回退/复用停用连带
 *  面见其注;带 quads 不在 gate）。 */
function batQuad(
  sx: number, sy: number, sw: number, shSrc: number, texW: number, texH: number,
  dx0: number, dy0: number, dw: number, dh: number, a: number,
  cols: Float32Array | null, colOff: number, soft = false,
): boolean {
  if (_batN >= LIQ_RING_CAP) {
    if (soft) _batSoftOvf = true; else _batOverflow = true;
    return false;
  }
  const o = _batN * LIQ_QUAD_FLOATS;
  const ua = (sx - LIQ_TIE_EPS) / texW, ub = (sx + sw - LIQ_TIE_EPS) / texW;
  const va = (sy - LIQ_TIE_EPS) / texH, vb = (sy + shSrc - LIQ_TIE_EPS) / texH;
  const D = _batRing;
  const r0 = (cols ? cols[colOff] : 1) * a, g0 = (cols ? cols[colOff + 1] : 1) * a, b0 = (cols ? cols[colOff + 2] : 1) * a;
  const r1 = (cols ? cols[colOff + 3] : 1) * a, g1 = (cols ? cols[colOff + 4] : 1) * a, b1 = (cols ? cols[colOff + 5] : 1) * a;
  const r2 = (cols ? cols[colOff + 6] : 1) * a, g2 = (cols ? cols[colOff + 7] : 1) * a, b2 = (cols ? cols[colOff + 8] : 1) * a;
  const r3 = (cols ? cols[colOff + 9] : 1) * a, g3 = (cols ? cols[colOff + 10] : 1) * a, b3 = (cols ? cols[colOff + 11] : 1) * a;
  const x1 = dx0 + dw, y1 = dy0 + dh;
  // TRIANGLES 两三角 (p0,p1,p2)+(p0,p2,p3)（buildRainBatch 同式）
  D[o] = dx0; D[o + 1] = dy0; D[o + 2] = ua; D[o + 3] = va; D[o + 4] = r0; D[o + 5] = g0; D[o + 6] = b0; D[o + 7] = a;
  D[o + 8] = x1; D[o + 9] = dy0; D[o + 10] = ub; D[o + 11] = va; D[o + 12] = r1; D[o + 13] = g1; D[o + 14] = b1; D[o + 15] = a;
  D[o + 16] = x1; D[o + 17] = y1; D[o + 18] = ub; D[o + 19] = vb; D[o + 20] = r2; D[o + 21] = g2; D[o + 22] = b2; D[o + 23] = a;
  D[o + 24] = dx0; D[o + 25] = dy0; D[o + 26] = ua; D[o + 27] = va; D[o + 28] = r0; D[o + 29] = g0; D[o + 30] = b0; D[o + 31] = a;
  D[o + 32] = x1; D[o + 33] = y1; D[o + 34] = ub; D[o + 35] = vb; D[o + 36] = r2; D[o + 37] = g2; D[o + 38] = b2; D[o + 39] = a;
  D[o + 40] = dx0; D[o + 41] = y1; D[o + 42] = ua; D[o + 43] = vb; D[o + 44] = r3; D[o + 45] = g3; D[o + 46] = b3; D[o + 47] = a;
  const m = _batN * 4;
  _batMeta[m] = sx; _batMeta[m + 1] = sy; _batMeta[m + 2] = sw; _batMeta[m + 3] = shSrc;
  _batN++;
  return true;
}

/** ★C13c 微光 quad 入批环（batQuad 同构 stride-11 版）:
 *  wX0/wY0/wW/wH=世界像素矩形（aTile=世界px/16 逐角——VS 线性插值逐像素精确,
 *  world→device 仿射(b=c=0 门)复合下插值仍精确=场世界锚定）;dx0..dh=设备矩形;
 *  ns=四角节点 noise-sin,数组序 [TL,TR,BL,BR]=shimmerWaves4 布局（(x,y),(x+1,y),
 *  (x,y+1),(x+1,y+1)）;角映射 TL←0/TR←1/BL←2/BR←3=原版 SetShimmerVertexColors
 *  节点值置位于 quad 角语义（R2b-F5）,裁剪格同式。
 *  rgb 预乘恒等（rgb===a,§3.3 锁域——场调制全部进 FS,vCol.rgb 不进乘链 §2.4）。
 *  溢出返 false=调用方 batOn=false 收口降级（不置 _batOverflow——微光环独立于主环,
 *  已入队段仍有效,fg 复用/gate 账不受扰;软/硬位域都不进）。 */
function shimQuad(
  sx: number, sy: number, sw: number, shSrc: number, texW: number, texH: number,
  wX0: number, wY0: number, wW: number, wH: number,
  dx0: number, dy0: number, dw: number, dh: number, a: number,
  ns: Float64Array,
): boolean {
  if (_shimN >= LIQ_RING_CAP) return false;
  ensureShimRings();
  const R = _shimRing!, M = _shimMeta!;
  const o = _shimN * LIQ_SHIM_QUAD_FLOATS;
  const ua = (sx - LIQ_TIE_EPS) / texW, ub = (sx + sw - LIQ_TIE_EPS) / texW;
  const va = (sy - LIQ_TIE_EPS) / texH, vb = (sy + shSrc - LIQ_TIE_EPS) / texH;
  const tx0 = wX0 / 16, ty0 = wY0 / 16, tx1 = (wX0 + wW) / 16, ty1 = (wY0 + wH) / 16;
  const x1 = dx0 + dw, y1 = dy0 + dh;
  // TRIANGLES 两三角 (p0,p1,p2)+(p0,p2,p3)（batQuad 同式;顶点序 TL,TR,BR,BL）
  // v0 TL
  R[o] = dx0; R[o + 1] = dy0; R[o + 2] = ua; R[o + 3] = va;
  R[o + 4] = a; R[o + 5] = a; R[o + 6] = a; R[o + 7] = a;
  R[o + 8] = tx0; R[o + 9] = ty0; R[o + 10] = ns[0];
  // v1 TR
  R[o + 11] = x1; R[o + 12] = dy0; R[o + 13] = ub; R[o + 14] = va;
  R[o + 15] = a; R[o + 16] = a; R[o + 17] = a; R[o + 18] = a;
  R[o + 19] = tx1; R[o + 20] = ty0; R[o + 21] = ns[1];
  // v2 BR（ns[3]=节点 (x+1,y+1)——数组序 TL,TR,BL,BR）
  R[o + 22] = x1; R[o + 23] = y1; R[o + 24] = ub; R[o + 25] = vb;
  R[o + 26] = a; R[o + 27] = a; R[o + 28] = a; R[o + 29] = a;
  R[o + 30] = tx1; R[o + 31] = ty1; R[o + 32] = ns[3];
  // v0'（第二三角首顶点=复用 v0——TRIANGLES 无索引环,重写）
  R[o + 33] = dx0; R[o + 34] = dy0; R[o + 35] = ua; R[o + 36] = va;
  R[o + 37] = a; R[o + 38] = a; R[o + 39] = a; R[o + 40] = a;
  R[o + 41] = tx0; R[o + 42] = ty0; R[o + 43] = ns[0];
  // v2'（复用 v2）
  R[o + 44] = x1; R[o + 45] = y1; R[o + 46] = ub; R[o + 47] = vb;
  R[o + 48] = a; R[o + 49] = a; R[o + 50] = a; R[o + 51] = a;
  R[o + 52] = tx1; R[o + 53] = ty1; R[o + 54] = ns[3];
  // v3 BL（ns[2]=节点 (x,y+1)）
  R[o + 55] = dx0; R[o + 56] = y1; R[o + 57] = ua; R[o + 58] = vb;
  R[o + 59] = a; R[o + 60] = a; R[o + 61] = a; R[o + 62] = a;
  R[o + 63] = tx0; R[o + 64] = ty1; R[o + 65] = ns[2];
  const m = _shimN * 4;
  M[m] = sx; M[m + 1] = sy; M[m + 2] = sw; M[m + 3] = shSrc;
  _shimN++;
  return true;
}

/** ★C13c 微光批段 2D 降级重放（replayLiqRun2D 同构 stride-11 版;宁回退不丢精灵）。
 *  乘色 = FS 场公式的 CPU 同式逐子块中心求值（aTile 角线性插值→shimmerWave→基色
 *  lerp;tVis=visEffectFrames()——降级帧同渲染段内不变判例）。multiply 用色=场色直取
 *  （c13c 环 rgb 恒等无预乘拆回需求,与 replayLiqRun2D 的 unpre 惯例域不同）;
 *  fillStyle 串 memo 与 applyShimmerBaseTint 共用（同值串实例复用判例）。 */
function replayLiqShimRun2D(ctx: CanvasRenderingContext2D, startQuad: number, quads: number,
  tex: CanvasImageSource): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const tVis = visEffectFrames();
  const D = _shimRing!;
  for (let q = 0; q < quads; q++) {
    const o = (startQuad + q) * LIQ_SHIM_QUAD_FLOATS;
    const m = (startQuad + q) * 4;
    const ga = D[o + 7];
    const dw = D[o + 11] - D[o], dh = D[o + 56] - D[o + 1];   // v1.x−v0.x / v5(BL).y−v0.y
    if (ga <= 0 || dw <= 0 || dh <= 0) continue;
    ctx.globalAlpha = ga;
    ctx.drawImage(tex, _shimMeta![m], _shimMeta![m + 1], _shimMeta![m + 2], _shimMeta![m + 3],
      D[o], D[o + 1], dw, dh);
    // ★BJ738 liqtint:四角求值+双线性梯度优先（aTile 角=裁剪角域,角即采样点→源矩形
    //   整窗 0,0,1,1;sin 在角求值+颜色双线性=FS 逐像素求值的 C0 近似,较子块常量
    //   严格逼近;smoothing 复位勿泄漏）。面缺席/旗关=旧子块路径逐位。
    const tx0 = D[o + 8], ty0 = D[o + 9];
    const tx1 = D[o + 19];
    const ty3 = D[o + 64];   // v5(BL).ty
    {
      const shimCol = (tx: number, ty: number): number => {
        const wv = Math.sin(((tx + ty / 6) / 10 - tVis / 360) * Math.PI * 2);
        return 0.1 + wv * 0.4;
      };
      const kTL = shimCol(tx0, ty0), kTR = shimCol(tx1, ty0);
      const kBL = shimCol(tx0, ty3), kBR = shimCol(tx1, ty3);
      if (tintBilinearQuad(ctx,
        255 * (SHIM_A_R + SHIM_D_R * kTL), 255 * (SHIM_A_G + SHIM_D_G * kTL), 255 * (SHIM_A_B + SHIM_D_B * kTL),
        255 * (SHIM_A_R + SHIM_D_R * kTR), 255 * (SHIM_A_G + SHIM_D_G * kTR), 255 * (SHIM_A_B + SHIM_D_B * kTR),
        255 * (SHIM_A_R + SHIM_D_R * kBL), 255 * (SHIM_A_G + SHIM_D_G * kBL), 255 * (SHIM_A_B + SHIM_D_B * kBL),
        255 * (SHIM_A_R + SHIM_D_R * kBR), 255 * (SHIM_A_G + SHIM_D_G * kBR), 255 * (SHIM_A_B + SHIM_D_B * kBR),
        0, 0, 1, 1, D[o], D[o + 1], dw, dh)) {
        ctx.imageSmoothingEnabled = false;
        ctx.globalCompositeOperation = 'source-over';
        continue;
      }
    }
    // 2×2 子块 multiply（场色=子块中心真场;tx 沿 x 线性/ty 沿 y 线性——aTile 线性属性）
    const subW = Math.ceil(dw / 2), subH = Math.ceil(dh / 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'multiply';
    for (let by = 0; by < 2; by++) {
      for (let bx = 0; bx < 2; bx++) {
        const bw = Math.min(subW, dw - bx * subW), bh = Math.min(subH, dh - by * subH);
        if (bw <= 0 || bh <= 0) continue;
        const u = (bx * subW + bw / 2) / dw, v = (by * subH + bh / 2) / dh;
        const tx = tx0 + (tx1 - tx0) * u, ty = ty0 + (ty3 - ty0) * v;
        const wv = Math.sin(((tx + ty / 6) / 10 - tVis / 360) * Math.PI * 2);
        const k = 0.1 + wv * 0.4;
        const rr = Math.round(255 * (SHIM_A_R + SHIM_D_R * k));
        const rg = Math.round(255 * (SHIM_A_G + SHIM_D_G * k));
        const rb = Math.round(255 * (SHIM_A_B + SHIM_D_B * k));
        const ck = (rr << 16) | (rg << 8) | rb;
        let s = _tintStyleMemo.get(ck);
        if (s === undefined) { s = `rgb(${rr},${rg},${rb})`; _tintStyleMemo.set(ck, s); }
        ctx.fillStyle = s;
        ctx.fillRect(D[o] + bx * subW, D[o + 1] + by * subH, bw, bh);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
}

/** ★C13c 微光段发射核（bat.emit 通道;stride-11 数据形状（66 float/quad）=
 *  GLSpriteLayer.quadBatchRgba 分派 sprite:liqshimmer 程序的判据面）。 */
function emitShimRun(bat: LiqBatchEmit, s0: number, nQ: number,
  img: CanvasImageSource, key: string): boolean {
  return bat.emit(img, key, _shimRing!.subarray(s0 * LIQ_SHIM_QUAD_FLOATS, (s0 + nQ) * LIQ_SHIM_QUAD_FLOATS),
    nQ, (raw) => replayLiqShimRun2D(raw, s0, nQ, img));
}

/** ★三期 sparkle 亮纹 quad 入环（shimQuad 同构 stride-11 版,目标=_spShimRing;
 *  2026-10-02 逐像素化刀;★四期修正 2026-10-07:aNoise 槽载 gl4=四角 glitter 终值
 *  （glitter4FromWaves=GetShimmerGlitterOpacity 体部式逐角,含钳制——原版
 *  SetShimmerVertexColors_Sparkle :732-743 置位 quad 角的值）,GPU varying 硬件插值
 *  =原版 TileBatch 顶点色插值 1:1（TileBatch.cs:175-187 对角线 TL-BR=本环布局同））。
 *  与基体 shimQuad 的三点差:
 *  ①rgb = hue×a（预乘族保持——ADD 段顶点色契约;hue=16 档量化表值,色相不迁移 §2.6）,
 *    a 只载 opacity（sparkGa 均值退役为纯发射门——亮纹调制=四角终值顶点插值）;
 *  ②溢出置 _addOverflow（ADD 环族语义——fg 复用账重放本环,溢出即失效面一致）;
 *  ③aTile 角=基体 quad 同域（dst 矩形/16）——body 域（flag=false=满格内部态）恒
 *    整格无裁剪无 bob ⇒ aTile 角=原版节点 (x,y)..(x+1,y+1) 精确（gl4 角序
 *    TL←gl[0]/TR←gl[1]/BR←gl[3]/BL←gl[2]=shimQuad 同映射=原版节点置位语义）。
 *  hue/hueOff=16 档色相表行（_spCols 同源 sparkHueRGB()）。 */
function sparkleShimQuad(
  sx: number, sy: number, sw: number, shSrc: number, texW: number, texH: number,
  wX0: number, wY0: number, wW: number, wH: number,
  dx0: number, dy0: number, dw: number, dh: number, a: number,
  gl4: Float64Array, hue: Float32Array, hueOff: number,
): boolean {
  if (_spShimN >= LIQ_RING_CAP) { _addOverflow = true; return false; }
  ensureShimRings();
  const R = _spShimRing!, M = _spShimMeta!;
  const o = _spShimN * LIQ_SHIM_QUAD_FLOATS;
  const ua = (sx - LIQ_TIE_EPS) / texW, ub = (sx + sw - LIQ_TIE_EPS) / texW;
  const va = (sy - LIQ_TIE_EPS) / texH, vb = (sy + shSrc - LIQ_TIE_EPS) / texH;
  const tx0 = wX0 / 16, ty0 = wY0 / 16, tx1 = (wX0 + wW) / 16, ty1 = (wY0 + wH) / 16;
  const r0 = hue[hueOff] * a, g0 = hue[hueOff + 1] * a, b0 = hue[hueOff + 2] * a;
  const x1 = dx0 + dw, y1 = dy0 + dh;
  // TRIANGLES 两三角 (p0,p1,p2)+(p0,p2,p3)（shimQuad 同式;顶点序 TL,TR,BR,BL）
  // v0 TL
  R[o] = dx0; R[o + 1] = dy0; R[o + 2] = ua; R[o + 3] = va;
  R[o + 4] = r0; R[o + 5] = g0; R[o + 6] = b0; R[o + 7] = a;
  R[o + 8] = tx0; R[o + 9] = ty0; R[o + 10] = gl4[0];
  // v1 TR
  R[o + 11] = x1; R[o + 12] = dy0; R[o + 13] = ub; R[o + 14] = va;
  R[o + 15] = r0; R[o + 16] = g0; R[o + 17] = b0; R[o + 18] = a;
  R[o + 19] = tx1; R[o + 20] = ty0; R[o + 21] = gl4[1];
  // v2 BR（gl4[3]=节点 (x+1,y+1)——数组序 TL,TR,BL,BR）
  R[o + 22] = x1; R[o + 23] = y1; R[o + 24] = ub; R[o + 25] = vb;
  R[o + 26] = r0; R[o + 27] = g0; R[o + 28] = b0; R[o + 29] = a;
  R[o + 30] = tx1; R[o + 31] = ty1; R[o + 32] = gl4[3];
  // v0'（第二三角首顶点=复用 v0——TRIANGLES 无索引环,重写）
  R[o + 33] = dx0; R[o + 34] = dy0; R[o + 35] = ua; R[o + 36] = va;
  R[o + 37] = r0; R[o + 38] = g0; R[o + 39] = b0; R[o + 40] = a;
  R[o + 41] = tx0; R[o + 42] = ty0; R[o + 43] = gl4[0];
  // v2'（复用 v2）
  R[o + 44] = x1; R[o + 45] = y1; R[o + 46] = ub; R[o + 47] = vb;
  R[o + 48] = r0; R[o + 49] = g0; R[o + 50] = b0; R[o + 51] = a;
  R[o + 52] = tx1; R[o + 53] = ty1; R[o + 54] = gl4[3];
  // v3 BL（gl4[2]=节点 (x,y+1)）
  R[o + 55] = dx0; R[o + 56] = y1; R[o + 57] = ua; R[o + 58] = vb;
  R[o + 59] = r0; R[o + 60] = g0; R[o + 61] = b0; R[o + 62] = a;
  R[o + 63] = tx0; R[o + 64] = ty1; R[o + 65] = gl4[2];
  const m = _spShimN * 4;
  M[m] = sx; M[m + 1] = sy; M[m + 2] = sw; M[m + 3] = shSrc;
  _spShimN++;
  return true;
}

/** ★三期 sparkle 亮纹段 2D 降级重放（replayLiqShimRun2D 同构;宁回退不丢精灵）。
 *  'lighter' ADD 语义;亮纹 α=四角 glitter 终值（aNoise 槽,★四期修正 2026-10-07）
 *  的 2×2 子块中心双线性——降级帧无 GPU varying,双线性=顶点插值的最优 2D 近似
 *  （GPU 臂=两三角逐线性,亚 LSB 域登记同 shimCornerColors 判例）;tVis 不再消费
 *  （终值已在发射时算定,相位冻结于发射帧=降级帧单帧域,登记）。降级帧色相失真
 *  登记:重放直画白度带（顶点色 hue 无法进 2D drawImage 调制链,染色带重造需
 *  per-hue 缓存查表——灾难路径 census 有界,白闪 vs 彩闪偏差登记）。 */
function replayLiqSparkShimRun2D(ctx: CanvasRenderingContext2D, startQuad: number, quads: number,
  tex: CanvasImageSource): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.globalCompositeOperation = 'lighter';
  const D = _spShimRing!;
  for (let q = 0; q < quads; q++) {
    const o = (startQuad + q) * LIQ_SHIM_QUAD_FLOATS;
    const m = (startQuad + q) * 4;
    const ga = D[o + 7];
    const dw = D[o + 11] - D[o], dh = D[o + 56] - D[o + 1];   // v1.x−v0.x / v3(BL).y−v0.y
    if (ga <= 0 || dw <= 0 || dh <= 0) continue;
    // aNoise 槽=v0=gl[0]/v1=gl[1]/v2(BR)=gl[3]/v3(BL)=gl[2]（sparkleShimQuad 写序;
    // ★四期:值=四角 glitter 终值,双线性即降级帧调制）
    const n00 = D[o + 10], n10 = D[o + 21], n01 = D[o + 65], n11 = D[o + 32];
    const sxT = _spShimMeta![m], syT = _spShimMeta![m + 1], swT = _spShimMeta![m + 2], shT = _spShimMeta![m + 3];
    const rx = swT / dw, ry = shT / dh;   // texel/设备 px 比（子块源矩形折算）
    const subW = Math.ceil(dw / 2), subH = Math.ceil(dh / 2);
    for (let by = 0; by < 2; by++) {
      for (let bx = 0; bx < 2; bx++) {
        const bw = Math.min(subW, dw - bx * subW), bh = Math.min(subH, dh - by * subH);
        if (bw <= 0 || bh <= 0) continue;
        const u = (bx * subW + bw / 2) / dw, v = (by * subH + bh / 2) / dh;
        const g = n00 * (1 - u) * (1 - v) + n10 * u * (1 - v) + n01 * (1 - u) * v + n11 * u * v;
        const a = ga * g;
        if (a <= 0) continue;
        ctx.globalAlpha = a;
        ctx.drawImage(tex, sxT + bx * subW * rx, syT + by * subH * ry, bw * rx, bh * ry,
          D[o] + bx * subW, D[o + 1] + by * subH, bw, bh);
      }
    }
  }
  ctx.restore();
}

/** 批段 2D 降级重放（GLShimExecutor.replay2D 经 rec.batch.replay 调用;宁回退不丢精灵）。
 *  恒等 tile:drawImage 原参;微光 tile（hasCols=段内含调制 quad,flushRun 按段同质性
 *  传入）:drawImage+2×2 子块 multiply（顶点环内四角色重构双线性——降级帧已是灾难
 *  路径,census 有界登记:子块中心相对 quad 而非 tile）。
 *  ★hasCols 显式旗（2026-09-28 rgb 预乘同刀）:环内 rgb 已预乘 α（batQuad 族约定）
 *  ——旧「r!==1 即微光」启发式在预乘后会把 α<1 普通水 quad（rgb=α≠1）误判成调制
 *  quad;段旗消除歧义。multiply 用色按 R2b-F3 unpre 惯例拆回未预乘原值。 */
function replayLiqRun2D(ctx: CanvasRenderingContext2D, startQuad: number, quads: number,
  tex: CanvasImageSource, hasCols: boolean, ring: Float32Array = _batRing): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const D = ring;
  for (let q = 0; q < quads; q++) {
    const o = (startQuad + q) * LIQ_QUAD_FLOATS;
    const m = (startQuad + q) * 4;
    const dw = D[o + 8] - D[o], dh = D[o + 41] - D[o + 1];
    if (dw <= 0 || dh <= 0) continue;
    ctx.globalAlpha = D[o + 7];
    ctx.drawImage(tex, _batMeta[m], _batMeta[m + 1], _batMeta[m + 2], _batMeta[m + 3],
      D[o], D[o + 1], dw, dh);
    if (hasCols) {
      const ga = D[o + 7];
      const unpre = ga > 0 && ga < 1 ? 1 / ga : 1;   // ga=1 恒等;ga≤0 防御恒等（quad 本就不可见）
      const r0 = D[o + 4] * unpre, g0 = D[o + 5] * unpre, b0 = D[o + 6] * unpre;
      const r1 = D[o + 12] * unpre, g1 = D[o + 13] * unpre, b1 = D[o + 14] * unpre;
      const r2 = D[o + 20] * unpre, g2 = D[o + 21] * unpre, b2 = D[o + 22] * unpre;
      const r3 = D[o + 44] * unpre, g3 = D[o + 45] * unpre, b3 = D[o + 46] * unpre;
      // ★BJ738 liqtint:双线性梯度优先（环角色已按裁剪角采样→源矩形整窗 0,0,1,1=
      //   GPU 顶点色插值的 2D 镜像;smoothing 复位勿泄漏后续纹理 nearest 采样）。
      if (tintBilinearQuad(ctx,
        255 * r0, 255 * g0, 255 * b0, 255 * r1, 255 * g1, 255 * b1,
        255 * r3, 255 * g3, 255 * b3, 255 * r2, 255 * g2, 255 * b2,
        0, 0, 1, 1, D[o], D[o + 1], dw, dh)) {
        ctx.imageSmoothingEnabled = false;
        ctx.globalCompositeOperation = 'source-over';
        continue;
      }
      // 微光调制 quad:2×2 子块 multiply（顶点色域即裁剪角域,u/v 取子块中心）
      const subW = Math.ceil(dw / 2), subH = Math.ceil(dh / 2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'multiply';
      for (let by = 0; by < 2; by++) {
        for (let bx = 0; bx < 2; bx++) {
          const bw = Math.min(subW, dw - bx * subW), bh = Math.min(subH, dh - by * subH);
          if (bw <= 0 || bh <= 0) continue;
          const u = (bx * subW + bw / 2) / dw, v = (by * subH + bh / 2) / dh;
          const ch = (k: number): number => {
            const c0 = k === 0 ? r0 : k === 1 ? g0 : b0;
            const c1 = k === 0 ? r1 : k === 1 ? g1 : b1;
            const c2 = k === 0 ? r2 : k === 1 ? g2 : b2;
            const c3 = k === 0 ? r3 : k === 1 ? g3 : b3;
            return 255 * (c0 * (1 - u) * (1 - v) + c1 * u * (1 - v) + c2 * (1 - u) * v + c3 * u * v);
          };
          ctx.fillStyle = `rgb(${Math.round(ch(0))},${Math.round(ch(1))},${Math.round(ch(2))})`;
          ctx.fillRect(D[o] + bx * subW, D[o + 1] + by * subH, bw, bh);
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  ctx.restore();
}

/** ★liqgl gate 发射（Renderer.drawLiquids 前景支收口调用）：同一批数据 y 镜像
 *  重发射进 FBO('liqgate')（= obj19 门控纹理;canvas 采样朝向 v=0=顶 ↔ FBO 行 0=
 *  GL 底 ⇒ 设备 y'=H−y 几何镜像、uv 不动=门控图与 canvas 上传同朝向）。
 *  前置:坡面足迹四边形先画（=fgCanvas 足迹 α≈0.02 同语义）。
 *  返回句柄（WorldTexSrc 形,flipY=0=预翻转几何）=null=发射失败（调用方本帧
 *  gate=null→obj19 gate=0 恒等直通,安全）。
 *  【绑定卫生】begin('liqgate') 换绑管线当前 FBO,离场 begin('world', false)
 *  续交回世界层（同名幂等重租,clear=false 不清量——flushAcc isAccumOpen('world')
 *  判据不受扰）。 */
export function emitVanillaLiquidGate(
  glw: GLSpriteLayer, W: number, H: number,
): { tex: WebGLTexture; w: number; h: number; flipY: number; gl?: WebGL2RenderingContext } | null {
  if (glw.unavailable || W <= 0 || H <= 0) return null;
  if (!glw.isAccumOpen('world')) return null;   // 防 stale FBO 续交（flushAcc begin(clear) 判据同门）
  glw.begin('liqgate', true);
  if (glw.unavailable) return null;
  let ok = true;
  // 足迹（世界→设备折算;先于水=fgCanvas 足迹先画同序）
  if (_footQuads.length) {
    const { a, b, c, d, e, f } = _footWld;
    for (const q of _footQuads) {
      const ex0 = a * q.dx + c * q.dy + e, ey0 = b * q.dx + d * q.dy + f;
      const ex1 = a * (q.dx + q.dw) + c * (q.dy + q.dh) + e, ey1 = b * (q.dx + q.dw) + d * (q.dy + q.dh) + f;
      const dx = Math.min(ex0, ex1), dy = Math.min(ey0, ey1);
      const dw = Math.abs(ex1 - ex0), dh = Math.abs(ey1 - ey0);
      if (dw <= 0 || dh <= 0) continue;
      // y 镜像:rect [dy,dy+dh] → [H−dy−dh, H−dy]
      const gy = H - dy - dh;
      if (q.solid) {
        glw.quadSprite(whiteEntry(glw), 0, 0, 1, 1, dx, gy, dw, dh,
          { alpha: 0.02, tint: [0.5, 0.5, 0.5] });
      } else if (q.tex) {
        const te = glw.texFromRegion(`er:${texId(q.tex)}:${q.sx},${q.sy},${q.sw},${q.sh}`,
          q.tex, q.sx, q.sy, q.sw, q.sh);
        if (te) glw.quadSprite(te, 0, 0, q.sw, q.sh, dx, gy, dw, dh, { alpha: 0.02 });
      }
    }
  }
  // 水批段:y 镜像重发射（同 uv/tint/α——gate 只读 α,obj19 ×100 饱和）
  // ★C13c:微光段 uTVis 单点（gate 重发射与批发射同渲染段——visEffectFrames 同值）
  setLiqShimmerTVis(visEffectFrames());
  for (const run of _fgRuns) {
    if (run.shim) {
      // ★C13c stride-11 微光段 y 镜像重发射（aTile/aNoise 随顶点镜像不变——场依赖
      //  tile 坐标非屏幕 y,设计案 §3.3;数据源 _shimRing→_gateShimData;发射经
      //  quadBatchRgba 形状分派=同一 liqshimmer 程序,α 输出与 PRECIP 契约同式）
      const nF = run.quads * LIQ_SHIM_QUAD_FLOATS;
      const src = run.start * LIQ_SHIM_QUAD_FLOATS;
      const G = _gateShimData!;
      // ★BJ743:发射数据切片优先（复用臂=_fgReuseShimRing;切片已从 start 起=读下标 0）
      const RD = run.data ?? _shimRing!;
      const ro = run.data ? 0 : src;
      for (let i = 0; i < nF; i += LIQ_SHIM_STRIDE) {
        G[src + i] = RD[ro + i];
        G[src + i + 1] = H - RD[ro + i + 1];   // y 镜像（逐顶点）
        for (let k2 = 2; k2 < LIQ_SHIM_STRIDE; k2++) G[src + i + k2] = RD[ro + i + k2];
      }
      const e = glw.texFromImage(run.key, run.img as TexImageSource, false, true);
      if (!e || !glw.quadBatchRgba(e, G.subarray(src, src + nF), run.quads)) { ok = false; break; }
      continue;
    }
    const nF = run.quads * LIQ_QUAD_FLOATS;
    const src = run.start * LIQ_QUAD_FLOATS;
    const G = _gateData;
    // ★BJ743:发射数据切片优先（复用臂=_fgReuseRing 缩放后数据——旧读法=bg 未缩放 α,
    //  gate α×100 饱和域恰无害;数据面钉正。切片已从 start 起=读下标 0）
    const RD = run.data ?? _batRing;
    const ro = run.data ? 0 : src;
    for (let i = 0; i < nF; i += LIQ_STRIDE) {
      G[src + i] = RD[ro + i];
      G[src + i + 1] = H - RD[ro + i + 1];   // y 镜像（逐顶点）
      for (let k = 2; k < LIQ_STRIDE; k++) G[src + i + k] = RD[ro + i + k];
    }
    const e = glw.texFromImage(run.key, run.img as TexImageSource, false, true);
    if (!e || !glw.quadBatchRgba(e, G.subarray(src, src + nF), run.quads)) { ok = false; break; }
  }
  glw.liqGateParams();
  const tex = glw.pipeFboTex();       // 'liqgate' 绑定期捕获
  glw.begin('world', false);          // 续交回世界层（不清量）
  if (!ok || !tex) return null;
  // ★R1b-2:句柄携带产生面上下文（GLWorldCompose.compose 跨上下文校验判据）
  return { tex, w: W, h: H, flipY: 0, gl: glw.pipeGl ?? undefined };
}

/** ★BJ743（2026-10-30）：前景水批数据【不镜像】重发射进独立 GL 层（罩源 GL 化）——
 *  veil 帧前景液体保持批化（CPU 原链+fgCanvas 离屏绕行退役）。层=独立上下文
 *  （无 pipe,直绘自家 canvas 背板=C13 星层同范式）,canvas 即水罩源（escapeVeilEnd
 *  直采;世界层分辨率,消费侧 vk 缩放与 fgCanvas 同语义）。数据=_fgRuns
 *  （gateCapture 登记,与 'liqgate' 同批）+ _footQuads（足迹先于水=2D fgCanvas 同序;
 *  【无 y 镜像】——画布正立,镜像仅 FBO GL 朝向需要）。失败=false=调用方该帧罩源
 *  缺席（层退避重建,自愈;GL 死窗极窄:begin 前置+同图 texFromImage 批路径已解析,
 *  登记口径）。 */
export function emitVanillaLiquidVeil(glw: GLSpriteLayer, W: number, H: number): boolean {
  if (glw.unavailable || W <= 0 || H <= 0) return false;
  glw.resize(W, H);
  glw.begin('veil', true);
  if (glw.unavailable) return false;
  let ok = true;
  if (_footQuads.length) {
    const { a, b, c, d, e, f } = _footWld;
    for (const q of _footQuads) {
      const ex0 = a * q.dx + c * q.dy + e, ey0 = b * q.dx + d * q.dy + f;
      const ex1 = a * (q.dx + q.dw) + c * (q.dy + q.dh) + e, ey1 = b * (q.dx + q.dw) + d * (q.dy + q.dh) + f;
      const dx = Math.min(ex0, ex1), dy = Math.min(ey0, ey1);
      const dw = Math.abs(ex1 - ex0), dh = Math.abs(ey1 - ey0);
      if (dw <= 0 || dh <= 0) continue;
      if (q.solid) {
        glw.quadSprite(whiteEntry(glw), 0, 0, 1, 1, dx, dy, dw, dh,
          { alpha: 0.02, tint: [0.5, 0.5, 0.5] });
      } else if (q.tex) {
        const te = glw.texFromRegion(`er:${texId(q.tex)}:${q.sx},${q.sy},${q.sw},${q.sh}`,
          q.tex, q.sx, q.sy, q.sw, q.sh);
        if (te) glw.quadSprite(te, 0, 0, q.sw, q.sh, dx, dy, dw, dh, { alpha: 0.02 });
      }
    }
  }
  setLiqShimmerTVis(visEffectFrames());
  for (const run of _fgRuns) {
    const e = glw.texFromImage(run.key, run.img as TexImageSource, false, true);
    if (!e) { ok = false; break; }
    // ★BJ743:发射数据切片（复用臂=缩放后 _fgReuseRing——α 0.6 前景语义;缺省回环防御;
    //  切片已从 start 起=读下标 0）
    const d = run.data ?? (run.shim ? _shimRing! : _batRing);
    const stride = run.shim ? LIQ_SHIM_QUAD_FLOATS : LIQ_QUAD_FLOATS;
    const off = run.data ? 0 : run.start * stride;
    if (!glw.quadBatchRgba(e, d.subarray(off, off + run.quads * stride), run.quads)) { ok = false; break; }
  }
  glw.end(true, false);
  return ok;
}

/** ★R1b-8①（2026-09-27 红蓝批 β）坡面足迹 2D 重放：混合帧（bg 批化足迹收集在
 *  _footQuads,fg 段 shim/GL 失效回 canvas gate 路径）足迹经此补画进前景离屏——
 *  emitVanillaLiquidGate 同款世界→设备折算（_footWld 矩阵）,【无 y 镜像】（2D
 *  画布正立,镜像仅 FBO GL 朝向需要）。空表 no-op（纯 canvas 帧 _footQuads 恒空）。
 *  调用点=Renderer beginFgPass 之后 drawVanillaLiquids 之前（足迹先于水=bg 同序,
 *  α≈0.02 饱和语义与 footprintCtx 直画支逐式同）。 */
export function replayLiquidFootQuads2D(ctx: CanvasRenderingContext2D): void {
  if (!_footQuads.length) return;
  const { a, b, c, d, e, f } = _footWld;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const q of _footQuads) {
    const ex0 = a * q.dx + c * q.dy + e, ey0 = b * q.dx + d * q.dy + f;
    const ex1 = a * (q.dx + q.dw) + c * (q.dy + q.dh) + e, ey1 = b * (q.dx + q.dw) + d * (q.dy + q.dh) + f;
    const dx = Math.min(ex0, ex1), dy = Math.min(ey0, ey1);
    const dw = Math.abs(ex1 - ex0), dh = Math.abs(ey1 - ey0);
    if (dw <= 0 || dh <= 0) continue;
    if (q.solid) {
      ctx.globalAlpha = 0.02;
      ctx.fillStyle = '#808080';   // 门控只读 alpha,色值无关（footprintCtx 直画支同式）
      ctx.fillRect(dx, dy, dw, dh);
    } else if (q.tex) {
      ctx.globalAlpha = 0.02;
      ctx.drawImage(q.tex, q.sx, q.sy, q.sw, q.sh, dx, dy, dw, dh);
    }
  }
  ctx.restore();
}

/** ★R1b-8②批环溢出探针（Renderer fg 批门消费）：本帧 bg/fg 段已触发 16384 帽时
 *  fg 改走 canvas gate 原链（足迹由 replayLiquidFootQuads2D 补画）——否则批化支
 *  _fgRuns 空/缺段=gate 缺水主体≈0,整帧位移场丢。 */
export function liqRingOverflow(): boolean { return _batOverflow; }

/** ★C13b 软溢出探针（诊断/守卫测试消费）：带/坡面批帽触发位——恒有
 *  liqBatchSoftOverflow()=true ⇒ liqRingOverflow()=false（软位不进硬面,见
 *  _batSoftOvf 注）。 */
export function liqBatchSoftOverflow(): boolean { return _batSoftOvf; }

/** white 1×1 entry（GLShimExecutor.WHITE_E 同式;模块缓存防重复建面）。
 *  ★liqpolish:卫兵改 texCheck 批检（__white 死窗=清表族,清表必 bump texGen）。 */
const _whiteCache = new WeakMap<GLSpriteLayer, TexEntry>();
function whiteEntry(glw: GLSpriteLayer): TexEntry {
  const hit = _whiteCache.get(glw);
  if (hit && (liqpolish ? glw.texCheck(hit) : glw.texAlive(hit))) return hit;
  if (typeof document === 'undefined') {
    // node 测试环境（无 canvas）:结构桩 entry（仅测试 fake glw 可达;生产 GL 会话
    // 恒有 document）
    const stub: TexEntry = { tex: {} as WebGLTexture, w: 1, h: 1, stamp: 0, bytes: 4, mipped: false, key: '__liqwhite' };
    _whiteCache.set(glw, stub);
    return stub;
  }
  const c = document.createElement('canvas');
  c.width = 1; c.height = 1;
  const x = c.getContext('2d')!;
  x.fillStyle = '#fff';
  x.fillRect(0, 0, 1, 1);
  const e = glw.texFromImage('__liqwhite', c, false, true)!;
  _whiteCache.set(glw, e);
  return e;
}

/** 帧界批状态复位（Renderer 世界段前调用;frameToken 变化亦自愈复位） */
export function resetLiquidBatchForFrame(frame: number): void {
  if (_batFrame !== frame) {
    _batFrame = frame; _batN = 0; _batOverflow = false; _fgRuns = [];
    _batSoftOvf = false;   // ★C13b 软溢出位随帧复位
    // ★liqpolish ADD 环帧界复位（sparkle/glint 段状态随基底环同生命周期）
    _addN = 0; _addOverflow = false; _spOn = false; _spQuads = 0; _glOn = false; _glQuads = 0;
    // ★三期 sparkle 亮纹环帧界复位（同 ADD 环生命周期;环缓冲惰性分配不释放）
    _spShimN = 0; _spShimOn = false; _spShimQuads = 0; _spShimImg = null; _spShimKey = '';
    _bgSparkShim = null;
    // ★C13c 微光环帧界复位（stride-11 段状态随基底环同生命周期;环缓冲惰性分配不释放）
    _shimN = 0; _shimOn = false; _shimImg = null; _shimKey = '';
    // ★liqpolish fg 复用账帧界失效（bg pass 重录;失效=fg 走逐 tile 构造原链）
    _bgRunsFrame = -1;
  }
  if (_footFrame !== frame) {
    _footFrame = frame; _footQuads = [];
  }
}

/** 微光 sparkle 顶点色诊断面（测试/探针直读四角双线性色;纯函数） */
export function shimmerCornerColorsForTest(
  x: number, y: number, tVis: number,
  uL: number, uR: number, vT: number, vB: number,
): [number, number, number][] {
  const out = new Float32Array(12);
  shimmerCornerColors(x, y, tVis, uL, uR, vT, vB, out, 0);
  const r: [number, number, number][] = [];
  for (let i = 0; i < 4; i++) r.push([out[i * 3], out[i * 3 + 1], out[i * 3 + 2]]);
  return r;
}

/** ★liqpolish 场单源测试面（位等锁:shimmerCornersFromWaves/glitter4FromWaves 与
 *  旧 shimmerCornerColors/shimmerGlitterOpacity 逐位对照;tests/liqpolish-shimmer-field.test.ts） */
export function shimmerFieldPolishForTest(
  x: number, y: number, tVis: number,
  uL: number, uR: number, vT: number, vB: number,
): { cols: [number, number, number][]; gl: [number, number, number, number] } {
  const wv = new Float64Array(8);
  shimmerWaves4(x, y, tVis, wv, 0);
  const cols = new Float32Array(12);
  shimmerCornersFromWaves(wv, 0, uL, uR, vT, vB, cols, 0);
  const gl = new Float64Array(4);
  glitter4FromWaves(wv, 0, gl);
  const r: [number, number, number][] = [];
  for (let i = 0; i < 4; i++) r.push([cols[i * 3], cols[i * 3 + 1], cols[i * 3 + 2]]);
  return { cols: r, gl: [gl[0], gl[1], gl[2], gl[3]] };
}

/** LiquidCache.IsSolid（LiquidRenderer.cs:198 → WorldGen.SolidOrSlopedTile :70515-70537）
 *  纯谓词，P1 两处扫描（needsPrep 首扫/复用失效重扫）共用的单源：
 *  active(flags≠0) ∧ !inActive(致动位清零,WorldGen.cs:70534 IL_004c `return !tile.inActive()`)
 *  ∧ tileSolid（defs 层 d.solid 已折 tileSolid∧!tileSolidTop——平台/家具 defs solid:false；
 *  slope 不在原文谓词内,函数名系历史遗留）。
 *  ★W-A4（2026-09-03）：补致动门——致动格原版不算实心,液体贴其表面按空格成形,
 *  曾漏门 = 致动墙仍压住邻格液面/拖尾形态。 */
export function liquidCacheIsSolid(flags: number, wire: number, solid: boolean | undefined): boolean {
  return flags !== 0 && (wire & TileStore.WIRE_ACTUATED) === 0 && solid === true;
}
/** ★liqpolish type→solid LUT（TILE_DEFS 静态派生;P1 全窗扫 8400 格/帧的
 *  TILE_DEFS[t]?.solid 属性链→Map.get;值域=模块常量,跨世界不变） */
const _solidLut = new Map<number, boolean>();
function tileSolidLut(t: number): boolean {
  let v = _solidLut.get(t);
  if (v === undefined) { v = TILE_DEFS[t]?.solid === true; _solidLut.set(t, v); }
  return v;
}
/** 液体表选择（原版 _liquidTextures[num2] 语义）：微光/岩浆/蜂蜜 = 固定表【不吃
 *  waterStyle】（vanilla 血月染红只及 Type0 水：DrawNormalLiquids :655 case 0 才
 *  remap、shimmer cell 在 PrepareDraw :587-613 整体搬出 _drawCache 走 DrawShimmer
 *  独立路径无 waterStyle 入参 Main.cs:58403；浸润带同构 TileDrawing.cs :3940-4054
 *  case 3→num10=14 / case 0→flag6→Main.waterStyle）。导出=血月语义回归锁面
 *  （tests/bloodmoon-water-style-scope.test.ts：血月 style9 不得染微光/岩浆/蜂蜜）。 */
export function waterSheet(vt: number, waterStyle = 0): string {
  if (vt === 1) return 'vanilla/Misc_water_1.png';   // 岩浆
  if (vt === 2) return 'vanilla/Misc_water_11.png';  // 蜂蜜
  if (vt === 3) return 'vanilla/Misc_water_14.png';  // 微光（Images/Misc/water_14，LiquidRenderer._liquidTextures[14]）
  // 水:群系水色（CalculateWaterStyle,Main.cs:56845）——0-10/12/13 十三种
  return `vanilla/Misc_water_${Math.max(0, Math.min(13, waterStyle))}.png`;
}

// ---- 微光 sparkle 数学（LiquidRenderer.cs:761-807 1:1） ----
/** GetShimmerWave :761-763：sin(((x+y/6)/10 - tVis/360) × 2π) */
function shimmerWave(x: number, y: number, tVis: number): number {
  return Math.sin(((x + y / 6) / 10 - tVis / 360) * Math.PI * 2);
}
/** GetShimmerBaseColor :803-807（float 版）：Lerp((0.647,0.510,0.933),(0.804,0.804,1), 0.1+wave×0.4) → 0-255 浮点。
 *  原版 SetShimmerVertexColors :745-759 对四角 (x,y)(x+1,y)(x,y+1)(x+1,y+1) 分别取值、顶点间插值；
 *  float 版供 2×2 子块双线性插值用，取整只发生在最终拼 rgb() 时（插值中途取整会丢精度）。 */
function shimmerBaseColorF(x: number, y: number, tVis: number): [number, number, number] {
  const w = shimmerWave(x, y, tVis);
  const k = 0.1 + w * 0.4;
  const lerp = (a: number, b: number) => 255 * (a + (b - a) * k);
  return [lerp(0.64705884, 41 / 51), lerp(26 / 51, 41 / 51), lerp(14 / 15, 1)];
}
/** SimpleWhiteNoise :793-797（uint 乘加混淆） */
function shimmerWhiteNoise(x: number, y: number): number {
  let ux = Math.abs(Math.floor(x)) >>> 0, uy = Math.abs(Math.floor(y)) >>> 0;
  ux = (36469 * (ux & 0xffff) + (ux >>> 16)) >>> 0;
  uy = (18012 * (uy & 0xffff) + (uy >>> 16)) >>> 0;
  return (((ux << 16) >>> 0) + uy) >>> 0;
}
/** Utils.Remap（单调区间重映射） */
function remap(v: number, a: number, b: number, c: number, d: number): number {
  if (b === a) return c;
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return c + (d - c) * t;
}
/** GetShimmerGlitterOpacity :773-790：top（液面格）恒 0.5；体部 = Remap(wave项×噪声项, 0, 0.5, 0, 1)。
 *  ★导出=liqpolish 场单源位等锁消费（tests/liqpolish-shimmer-field.test.ts 旧路径锚） */
export function shimmerGlitterOpacity(top: boolean, x: number, y: number, tVis: number): number {
  if (top) return 0.5;
  const num = remap(shimmerWave(x, y, tVis), -0.5, 1, 0, 0.35);
  const num2 = Math.sin(shimmerWhiteNoise(x, y) / 10 + tVis / 180);
  return remap(num * num2, 0, 0.5, 0, 1);
}
/** GetShimmerFrame :791-801：((int)num % 16 + 16) % 16；非 top 帧加 (x+y) 相位 */
function shimmerFrame(top: boolean, x: number, y: number, tVis: number): number {
  let num = ((x + 0.5 + (y + 0.5) / 6) / 10) - tVis / 360;
  if (!top) num += (x + 0.5) + (y + 0.5);
  return ((Math.trunc(num) % 16) + 16) % 16;   // ★FX61：(int)num = 向零截断（C# 强转），floor 在负相位差 1 帧
}

/** sparkle 源矩形（DrawShimmer :716-721）：先把 sourceRectangle 重置回【原始
 *  SourceRectangle】再加 X+48 / Y+80×fr。注意第二参数是原始 sy——表面格基底层
 * 虽强制切 Y=1280（:700），sparkle 仍按原始 Y 取带（表层漂移彩虹条的来源）。
 *  旧实现误传 1280：fr≥1 全部越界被跳过（彩虹条消失），fr=0 命中 Y=1280 黑底块画出黑斑。 */
export function shimmerSparkleSource(sx: number, sy: number, fr: number): [number, number] {
  return [sx + 48, sy + 80 * fr];
}

/** sparkle 绘制门（DrawShimmer :717 `flag`）纯函数：原始 SourceRectangle 非满格
 *  内部态 (X==16 ∧ Y%80==48)。★De Morgan 直译 = `X!==16 || Y%80!==48`——曾误写
 *  `!(X===16 || Y%80===48)`（逻辑等价于 ∧），把表层格 (sx=16, sy=0) 判成 body：
 *  sparkle 退化为棋盘格 × 噪声微闪（GetShimmerGlitterOpacity body 支常在 0.02
 *  阈下）= 用户实报"微光液面顶缘彩虹渐变线整缺"的根因（FX61，2026-09-17）。
 *  top=true（表层/边缘格）四角 glitter 恒 0.5（:775-778）→ 常驻彩虹条。 */
export function shimmerSparkleGate(sx: number, sy: number): boolean {
  return sx !== 16 || sy % 80 !== 48;
}

/**
 * 基底层波色叠加（SetShimmerVertexColors :745-759 的 Canvas2D 最优可达）。
 * 原版四角顶点色 = white × opacity × GetShimmerBaseColor(角)，顶点间插值；
 * Canvas2D 无顶点色，故把 16×16 tile 分 2×2 子块（8×8），每子块取四角双线性
 * 插值在其中心位置的色，以 multiply 叠在已画的 water_14 上（=纹理×色，同原版 modulate）。
 */
function applyShimmerBaseTint(
  ctx: CanvasRenderingContext2D, x: number, y: number,
  dstX: number, dstY: number, w: number, h: number, tVis: number,
): void {
  // ★liqpolish（2026-09-29 微抛光刀）:波值经 shimmerWaves4 单源+标量通道直算
  //  （旧路径 4×shimmerBaseColorF=4×[数组+闭包]分配+4 sin 重复求值）;fillStyle 串
  //  memo（同值串实例复用=Blink 侧跳过重复解析;串值逐字节同=状态逐位同）。
  //  flag 关=旧路径逐位（三元组数组+闭包+模板串）。
  let r00: number, g00: number, b00: number, r10: number, g10: number, b10: number;
  let r01: number, g01: number, b01: number, r11: number, g11: number, b11: number;
  if (liqpolish) {
    shimmerWaves4(x, y, tVis, _wvTint, 0);
    const w00 = _wvTint[0], w10 = _wvTint[1], w01 = _wvTint[2], w11 = _wvTint[3];
    const k00 = 0.1 + w00 * 0.4, k10 = 0.1 + w10 * 0.4, k01 = 0.1 + w01 * 0.4, k11 = 0.1 + w11 * 0.4;
    r00 = 255 * (SHIM_A_R + SHIM_D_R * k00); g00 = 255 * (SHIM_A_G + SHIM_D_G * k00); b00 = 255 * (SHIM_A_B + SHIM_D_B * k00);
    r10 = 255 * (SHIM_A_R + SHIM_D_R * k10); g10 = 255 * (SHIM_A_G + SHIM_D_G * k10); b10 = 255 * (SHIM_A_B + SHIM_D_B * k10);
    r01 = 255 * (SHIM_A_R + SHIM_D_R * k01); g01 = 255 * (SHIM_A_G + SHIM_D_G * k01); b01 = 255 * (SHIM_A_B + SHIM_D_B * k01);
    r11 = 255 * (SHIM_A_R + SHIM_D_R * k11); g11 = 255 * (SHIM_A_G + SHIM_D_G * k11); b11 = 255 * (SHIM_A_B + SHIM_D_B * k11);
  } else {
    const c00 = shimmerBaseColorF(x, y, tVis), c10 = shimmerBaseColorF(x + 1, y, tVis);
    const c01 = shimmerBaseColorF(x, y + 1, tVis), c11 = shimmerBaseColorF(x + 1, y + 1, tVis);
    r00 = c00[0]; g00 = c00[1]; b00 = c00[2];
    r10 = c10[0]; g10 = c10[1]; b10 = c10[2];
    r01 = c01[0]; g01 = c01[1]; b01 = c01[2];
    r11 = c11[0]; g11 = c11[1]; b11 = c11[2];
  }
  ctx.save();
  // ★BJ738 liqtint:双线性梯度优先（2×2 角场面+源矩形分数采样=裁剪窗场锚定;
  //   save/restore 域内 smoothing 复位）。面缺席/旗关=false→旧子块路径逐位。
  if (tintBilinearQuad(ctx,
    r00, g00, b00, r10, g10, b10, r01, g01, b01, r11, g11, b11,
    (dstX - x * 16) / 16, (dstY - y * 16) / 16,
    (dstX + w - x * 16) / 16, (dstY + h - y * 16) / 16,
    dstX, dstY, w, h)) {
    ctx.restore();
    return;
  }
  // 原版 SetShimmerVertexColors 的乘法是【无条件 modulate】（纹理×顶点色），不带
  // 透明 pass 的 0.75 衰减——若沿用调用方残留的 globalAlpha，白色基底（表面格
  // Y=1280 整块纯白）只会被"部分染色"，表层色带被冲淡成灰白。故强制 1.0 全乘。
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'multiply';
  const subW = Math.ceil(w / 2), subH = Math.ceil(h / 2);
  for (let by = 0; by < 2; by++) {
    for (let bx = 0; bx < 2; bx++) {
      const bw = Math.min(subW, w - bx * subW), bh = Math.min(subH, h - by * subH);
      if (bw <= 0 || bh <= 0) continue;
      // 子块中心在 tile 内的归一化位置（dstX 相对 x*16 有壁值裁剪偏移）→ 四角双线性插值
      const u = (dstX + bx * subW + bw / 2 - x * 16) / 16;
      const v = (dstY + by * subH + bh / 2 - y * 16) / 16;
      // 乘加序 = 旧 ch(i) 逐项左结合同构;polish 支 fillStyle 串走 memo（值逐字节同）
      const u1 = 1 - u, v1 = 1 - v;
      const cr = r00 * u1 * v1 + r10 * u * v1 + r01 * u1 * v + r11 * u * v;
      const cg = g00 * u1 * v1 + g10 * u * v1 + g01 * u1 * v + g11 * u * v;
      const cb = b00 * u1 * v1 + b10 * u * v1 + b01 * u1 * v + b11 * u * v;
      const rr = Math.round(cr), rg = Math.round(cg), rb = Math.round(cb);
      if (liqpolish) {
        const key = (rr << 16) | (rg << 8) | rb;
        let s = _tintStyleMemo.get(key);
        if (s === undefined) { s = `rgb(${rr},${rg},${rb})`; _tintStyleMemo.set(key, s); }
        ctx.fillStyle = s;
      } else {
        ctx.fillStyle = `rgb(${rr},${rg},${rb})`;
      }
      ctx.fillRect(dstX + bx * subW, dstY + by * subH, bw, bh);
    }
  }
  ctx.restore();
}

// ---- sparkle 彩虹（Main.hslToRgb，Main.cs:47266-47290 1:1）----
function hue2rgb(v1: number, v2: number, vH: number): number {
  if (vH < 0) vH += 1;
  if (vH > 1) vH -= 1;
  if (6 * vH < 1) return v1 + (v2 - v1) * 6 * vH;
  if (2 * vH < 1) return v2;
  if (3 * vH < 1) return v1 + (v2 - v1) * ((2 / 3) - vH) * 6;
  return v1;
}
/** Main.hslToRgb 1:1（GetShimmerGlitterColor :766-771 以 s=1/l=0.5 调用）→ RGB 0-1 */
function hslToRgb(hue: number, sat: number, lum: number): [number, number, number] {
  if (sat === 0) return [lum, lum, lum];
  const v2 = lum < 0.5 ? lum * (1 + sat) : lum + sat - lum * sat;
  const v1 = 2 * lum - v2;
  return [hue2rgb(v1, v2, hue + 1 / 3), hue2rgb(v1, v2, hue), hue2rgb(v1, v2, hue - 1 / 3)];
}

/** GetShimmerGlitterColor :768 彩虹相位（纯函数）：(((x + y/6) + tVis/30) / 6) % 1。
 *  空间项 x/6 → 相邻液面格相位差 1/6（≈60° 色相）= 液面顶缘逐格彩虹渐变；
 *  时间项 → dHue/d帧 = 1/180 → 180 帧（60fps 下 3s）一个整周期漂移。 */
export function shimmerGlitterHue(x: number, y: number, tVis: number): number {
  return (((x + y / 6) + tVis / 30) / 6) % 1;
}

// ---- sparkle 染色变体缓存（离线预渲染）----
// 关键①：sparkle 闪纹是灰度像素（饱和度 0），CSS hue-rotate 对纯白/纯灰是 no-op——
// 旧实现 ctx.filter=hue-rotate 等于没上色，闪纹显示为白色而非原版彩虹。
// 故离线预渲染染色副本：hue 量化 16 档（((px+py/6)+t/30)/6 % 1），每档一条
// water_14 的 sparkle 带（X∈[48,宽)，:721 sourceRectangle.X += 48）整条染色，惰性构建。
// 关键②（黑底根因，2026-08-12 像素审计）：原版 water_14 的 sparkle 带是
// 【黑底不透明】的灰度加色闪纹——整带 X∈[48,96)/Y∈[0,1280) 三通道差恒 0（纯灰度），
// 约 2/3 像素是 alpha=255 的纯黑。原版 XNA 侧该带由 SetShimmerVertexColors_Sparkle
// 的顶点色（RGB=彩虹、A=glitter 强度）整体门控呈现；Canvas2D 的 multiply/直画
// 序列没有这个门控，黑底被当成实心像素 → 用户所见的"黑色背景"。
// 修法 = 加色闪纹语义还原：灰度亮度即强度 → 以亮度重造 alpha（黑 → 透明），
// RGB 写成 HSL 彩虹色（tintSparkleBand，纯函数供测试探针）。
// 绘制沿用原版源矩形 (sx+48, sy+80*fr)（在副本内即 −48），一条带覆盖全部
// 帧行/变体子矩形——避免逐帧×hue 的 16×16 变体随 sx/sy 爆炸，单 hue 一份即可。
const SPARKLE_HUE_STEPS = 16;
/** 键含 texId（2026-08-25 同类扫描）：曾只按 hueIdx——模块级缓存跨世界持久,
 *  不同 waterStyle 的 shimmer 表换world后旧条带钉死（texId.ts 头注键碰撞同款） */
const _sparkleTintCache = new Map<string, HTMLCanvasElement>();

/** sparkle 变体逐像素重造：灰度亮度 → alpha（黑底归零），RGB → HSL 彩虹色。 */
export function tintSparkleBand(data: Uint8ClampedArray, r: number, g: number, b: number): void {
  for (let i = 0; i < data.length; i += 4) {
    // 灰度带（三通道相等）→ 亮度即灰度值；保留亚像素抗锯齿渐变（闪纹边缘软过渡）
    const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    data[i] = r; data[i + 1] = g; data[i + 2] = b;
    data[i + 3] = lum;
  }
}

function shimmerSparkleTint(tex: ImageBitmap | HTMLImageElement, hueIdx: number): HTMLCanvasElement | null {
  // ★texReady 半加载窗守卫（2026-08-25 同类扫描）：atlas 源本安全,守卫为纵深——
  //  该窗 getImageData 全 0 → 全透明条带按 hue 键钉死（微光彩虹整条消失）
  if (!texReady(tex)) return null;
  const ck = `${texId(tex)}|${hueIdx}`;
  let c = _sparkleTintCache.get(ck);
  if (c) return c;
  const bandX = 48;                     // :721 sparkle 带 X 偏移（water_14 第 4-6 列 16px 带）
  const bandW = tex.width - bandX;
  if (bandW <= 0 || typeof document === 'undefined') return null;
  c = document.createElement('canvas');
  c.width = bandW; c.height = tex.height;
  const cc = c.getContext('2d', { willReadFrequently: true });
  if (!cc) return null;
  cc.imageSmoothingEnabled = false;
  cc.drawImage(tex, bandX, 0, bandW, tex.height, 0, 0, bandW, tex.height);
  const [r, g, b] = hslToRgb(hueIdx / SPARKLE_HUE_STEPS, 1, 0.5);
  const img = cc.getImageData(0, 0, bandW, tex.height);
  tintSparkleBand(img.data, Math.round(r * 255), Math.round(g * 255), Math.round(b * 255));
  cc.putImageData(img, 0, 0);
  _sparkleTintCache.set(ck, c);
  return c;
}

// ---- 类型数组池(2026-08 审计 G1):此前每 pass 分配 24 个数组 ×2 pass/帧
// ≈ 744KB/帧 ≈ 45MB/s 的 GC 压力。容量只增不减;每调用前 fill(0) 保持与
// "新分配数组"完全相同的语义(未写格一律 0) ----
let _liqCap = 0;
let _level: Float32Array, _visLevel: Float32Array, _opacity: Float32Array;
let _isSolidA: Uint8Array, _hasLiquidA: Uint8Array, _hasWallA: Uint8Array;
let _hasVisA: Uint8Array, _typeA: Uint8Array, _visTypeA: Uint8Array;
let _lW: Float32Array, _rW: Float32Array, _bW: Float32Array, _tW: Float32Array;
let _vlW: Float32Array, _vrW: Float32Array, _vbW: Float32Array, _vtW: Float32Array;
let _hasLE: Uint8Array, _hasRE: Uint8Array, _hasTE: Uint8Array, _hasBE: Uint8Array;
let _isHalfA: Uint8Array;
let _fx: Int16Array, _fy: Int16Array;

// ---- 调试快照（F5 DebugReport render.subsystems.liquids 消费；模块级因本渲染器是自由函数）----
export interface LiquidDebugState {
  /** 最近一次 draw 的调用序号（双 pass 各 +1 → 每帧 +2） */
  calls: number;
  /** 最近一次 draw 时刻 ms */
  lastMs: number;
  /** 群系水色 id（CalculateWaterStyle 结果；水贴图 Misc_water_<n>.png 的 n） */
  waterStyle: number;
  /** 当前群系水色解析出的水体贴图名 */
  waterSheet: string;
  /** 最近一次 draw 是否背景 pass */
  isBackground: boolean;
  /** 动画参数（1456 双帧机制） */
  animFrame: number;
  waterfallFrame: number;
  windSpeed: number;
  /** 最近一次 draw 的可见 tile 窗口（padding 前） */
  window: [number, number, number, number];
  /** 最近一次 draw 命中的液体类型表（原版 LiquidType 键 → 贴图是否就绪） */
  sheetsReady: Array<[number, boolean]>;
  atlasReady: boolean;
  /** 果冻后处理管线态（WaterWarpCompositor 每帧写入） */
  warp: WaterWarpDebugState;
}
export interface WaterWarpDebugState {
  /** 管线本帧是否激活（quality>0 + 噪声就绪） */
  active: boolean;
  /** 最近一次合成路径：'gl' | '2d' | 'off' */
  path: string;
  /** 累计合成次数（双 pass 各 +1 → 激活时每帧 +2） */
  passes: number;
}
const _liqDebug: LiquidDebugState = {
  calls: 0, lastMs: 0, waterStyle: 0, waterSheet: '', isBackground: false,
  animFrame: 0, waterfallFrame: 0, windSpeed: 0, window: [0, 0, 0, 0],
  sheetsReady: [], atlasReady: false,
  warp: { active: false, path: 'off', passes: 0 },
};

// ---- ★BJ317 液体绘制窗（2026-09-23 用户实报"水贴屏幕边缘被渲染成瀑布下流样式,
// 内移即恢复"定谳落刀）----
// 【机制】LiquidRenderer 管线 P2 可见液位只跑内窗（vanilla LiquidRenderer.cs
//  `for (k = 2; k < rectangle.Width - 2; ...)` 内窗遍历），±2 pad 列的
//  HasVisibleLiquid 恒假（P1 每帧重置 VisibleLiquidLevel=0、P2/trail 不写 pad）→
//  内窗边缘水格的窗外邻格被当"无可见液体"→ P4 误置 HasLeft/Right/TopEdge=true →
//  误用边缘变体带（sx=0/32 侧柱纹理 + oy 16/32；表面格还丢 srcY=1280 静态带）。
//  ★该管线级误判【原版同样存在】（pad 列收敛为假是原版语义,本仓 P1-P7 逐行同构）——
//  原版靠绘制窗比可见屏大一圈把它掩蔽：GetScreenDrawArea（TileDrawing.cs:6661）
//  firstTileX = 屏左 -1 - offScreenRange/16（offScreenRange=200=12.5 格,Main.cs:840）、
//  lastTileX = 屏右 +2 +12.5、屏下 +5 +12.5 → 伪影格深居屏外 13 格,玩家永不可见。
// 【修】本仓窗口原=可见屏（底缘已有 +5）,伪影恰好落屏缘 → 左/右/上各外扩 MARGIN
//  格,使误判列/行出屏。MARGIN=4 ≥ 内窗 pad(2)+包围盒 M(3) 需求（液池恰起于屏缘时
//  bx0=liquid±3 仍盖住屏缘格 ±1 邻域）,且伪影格 ≥1 格出屏。管线本体零触碰。
// 【★BJ427（2026-10-01）底缘 +5 不够——P3 瀑布拖尾带露进屏底三行】
//  机制：P3 拖尾循环界 n < rectangle.Height-10（LiquidRenderer.cs:253,本仓 ph-11
//  同构）→ 最后处理行 L=窗底 ty1-8;L+1..L+WATERFALL_LENGTH 收 opacity k<1 且
//  【永不自纠】（P3 不再到达,hasVisA 已由 P2 置位的满液格照画）。原版同带被窗深
//  （offScreenRange 12.5+5 → 带落屏底下方 10-12 格）掩蔽;本仓窗底仅 +5 → 带顶
//  三行 ty1-7..ty1-5 = 屏底 sB-2..sB = 用户实报"岩浆底部逐层半透（k=0.75/0.5/0.25
//  三档）/液面比实际高两格（0.25 行近隐形→可见岩浆边界比实际高约 2 格）/站低即
//  恢复（池底升出屏底带区）"三症状同根（探针 scripts/_bj427-lava-band.mjs 机位
//  扫描实测:fade 带随屏底逐格平移,off=+4 恢复）。修=底缘 +5+LIQUID_WINDOW_MARGIN
//  =9 ≥ 8（掩蔽需求:ty1-7 > sB ⇔ 底缘 ≥8）,与左/右/上同 MARGIN 语义（=原版
//  offScreenRange 结构:各向等深,+5 为 GetScreenDrawArea 自带项）。世界底钳
//  （worldH-3）处原版同相（maxTilesY-4 同样钳,深带可回屏=原版同潜病,不另修）。
export const LIQUID_WINDOW_MARGIN = 4;

/** 液体绘制窗（Renderer.drawLiquids 双 pass 共用；纯函数供单测）。
 *  返回 [tx0, ty0, tx1, ty1]——比可见屏左/右/上各外扩 LIQUID_WINDOW_MARGIN 格、
 *  下缘 +5（GetScreenDrawArea 自带项,TileDrawing.cs:6669）+LIQUID_WINDOW_MARGIN
 *  （★BJ427：P3 拖尾带掩蔽需求 ≥8,见上注）。 */
export function liquidDrawWindow(
  camX: number, camY: number, viewW: number, viewH: number, z: number,
  worldW: number, worldH: number,
): [number, number, number, number] {
  const ts = 16;
  return [
    Math.max(2, Math.floor((camX - viewW / 2 / z) / ts) - LIQUID_WINDOW_MARGIN),
    Math.max(2, Math.floor((camY - viewH / 2 / z) / ts) - LIQUID_WINDOW_MARGIN),
    Math.min(worldW - 3, Math.ceil((camX + viewW / 2 / z) / ts) + LIQUID_WINDOW_MARGIN),
    Math.min(worldH - 3, Math.ceil((camY + viewH / 2 / z) / ts) + 5 + LIQUID_WINDOW_MARGIN),
  ];
}

/** WaterWarpCompositor 写入管线态（DebugReport/探针消费） */
export function setWaterWarpDebug(path: 'gl' | '2d'): void {
  _liqDebug.warp.active = true;
  _liqDebug.warp.path = path;
  _liqDebug.warp.passes++;
}

/** 管线关闭帧由 Renderer 复位（?wwarp=0 / quality=0 / 噪声未就绪） */
export function clearWaterWarpDebug(): void {
  _liqDebug.warp.active = false;
  _liqDebug.warp.path = 'off';
}

/** 液体渲染调试快照（只读消费；DebugReport render.subsystems.liquids） */
export function liquidDebugState(): LiquidDebugState {
  return _liqDebug;
}

/** LiquidSlope 贴图独立懒加载（不走 atlas.ensureVImage——LiquidSlope 不在
 *  预载/重烘列表,首次调用返回 null 且不触发网络加载 = 永远 null。
 *  模块级缓存跨帧持久——函数内声明会每帧重建 Map = Image 永远 width=0） */
const _slopeTexCache = new Map<number, HTMLImageElement>();
const _slopeTexFailAt = new Map<number, number>();
const SLOPE_FAIL_TTL = 10_000;   // 失败负缓存 TTL(2026-08-25 同类扫描):过期重试自愈
const getSlopeTex = (waterStyle: number): HTMLImageElement | null => {
  const ws = Math.max(0, Math.min(14, waterStyle));
  const fail = _slopeTexFailAt.get(ws);
  if (fail !== undefined) {
    if (Date.now() - fail < SLOPE_FAIL_TTL) return null;
    _slopeTexFailAt.delete(ws);
  }
  let im = _slopeTexCache.get(ws);
  if (im === undefined) {
    im = new Image();
    im.onerror = () => { _slopeTexCache.delete(ws); _slopeTexFailAt.set(ws, Date.now()); };
    im.src = `sprites/vanilla/LiquidSlope_${ws}.png`;
    _slopeTexCache.set(ws, im);
  }
  return im.width > 0 ? im : null;
};

/** 同帧准备缓存(#perf-gpulog 水体批):P1-P7 管线每帧被 bg/fg 两次调用,
 *  输入(窗口/store/waterStyle)在单帧渲染段内不变 → 第二次调用直接复用数组。
 *  frameToken 由调用方传渲染帧号(animTick),跨帧自动失效重算 */
let _prepToken: number | undefined;
let _prepKey = '';
/** 液体包围盒(内区格坐标,P1 扫描产出):P2-P7 只需遍历液面±邻域——
 *  典型视野液体占小半格网,包围盒裁剪省 ~6/7 的 pass 扫描。边界外 cell 的
 *  P2 邻域填充(夹心格)按定义必在包围盒内,裁剪无损 */
let _boxL = 0, _boxT = 0, _boxR = -1, _boxB = -1;
let _boxHas = false;

// ---- 液体动画相位（★2026-09-27 重钉逻辑 tick,火苗速率案普查株连）----
// 原版钟 = LiquidRenderer.Update（LiquidRenderer.cs:840-858,Main.cs:17226 每
// Update tick 调用,dt = 定步 1/60）：_frameState += (windSpeed·25±6)·dt、
// _waterfallFrameState += 0.5·dt、<0 回正、%16。旧实现 Math.floor((nowMs/1000)·rate)
// = 墙钟（速率对,但风速变化时相位跳变、暂停期照走、宕帧后跳帧）。改逐 tick 累计：
// draw 路径按 tick 变更惰性推进（背景/前景双 pass 同 tick 调用幂等=每 tick 恰推
// 一次;暂停 tick 冻结=原版 DoUpdate 同门;freezeClock 探针期冻结=对拍确定性）。
// 跨拍补步钳 8（宕帧追步,同 fixedUpdate ≤5 步同族口径）。
let _liqWaveTick = -1;
let _liqFrameState = 0;        // LiquidRenderer._frameState（0..16 浮点相位）
let _liqWaterfallState = 0;    // LiquidRenderer._waterfallFrameState

/** 测试钉钟：重置液体相位累计（金标测试重放确定性;生产路径禁调） */
export function __resetLiquidAnimForTest(): void {
  _liqWaveTick = -1; _liqFrameState = 0; _liqWaterfallState = 0;
}

export function drawVanillaLiquids(
  ctx: CanvasRenderingContext2D, atlas: SpriteAtlas | null,
  st: TileStore, groundLevel: number,
  tx0: number, ty0: number, tx1: number, ty1: number,
  nowMs: number, isBackground = false, windSpeed = 0, waterStyle = 0,
  hasWaterfallAt?: (x: number, y: number) => boolean,
  /** 全屏扭曲管线激活（WaterWarpCompositor.active）：表层格逐格 bob 关闭——
   *  bob 语义由 compositeLight 后的全屏位移场交付（原版 waterTarget 本体无 bob，
   *  波动全部来自 FilterWaterDistortion 的屏幕位移）。水体/浸润带均直画目标层。 */
  warpMode = false,
  /** 场景亮度采样（tile 光照 RGB 均值/255；Renderer 注入 lighting.lightAt）——
   *  波光 glint 的亮度因子（obj19 :106-111 用位移后场景像素亮度，暗处→0） */
  lumAt?: (tx: number, ty: number) => number,
  /** 渲染帧号(同帧 bg/fg 两调用传同值 → P1-P7 第二次调用走缓存复用) */
  frameToken?: number,
  /** ★IIIII251 斜坡水缘 GL 门控足迹画布（仅 bg 调用传入；Renderer 在 warpOn &&
   *  ?slopewave=1 时给 waterWarp.gateFootprintCtx()——浸润 pass 把坡面水形状
   *  以 α≈0.02 预画进去,obj19 门控由此覆盖斜坡水缘。null=不画） */
  gateFootprintCtx?: CanvasRenderingContext2D | null,
  /** ★liqgl 批发射钩（列→顶点批;null=CPU 原链。Renderer 在 liqgl+acc 窗传入——
   *  pass 级 all-or-nothing:可用性预检失败整 pass 走 CPU 原链,中途不换道） */
  bat?: LiqBatchEmit | null,
  /** ★liqgl gate 采集（warpOn 且批化时 bg/fg 都传 true:bg=足迹四边形收集替代
   *  fgCanvas 足迹画布;fg=水批段登记供 emitVanillaLiquidGate 重发射） */
  gateCapture?: boolean,
  /** ★BJ705-G26 件3（[g20-buff305-lavavision] 清偿）:玩家 lavaOpacity（缺省 1=
   *  未骑熔岩鲨/未渐隐恒等零扰动）。岩浆(vt=1) run α ×lavaOpacity ≙ LiquidRenderer
   *  .cs:648-661 DrawNormalLiquids `num = Opacity × (bg?1:DEFAULT_OPACITY) …
   *  case 1: num *= lavaOpacity`（bg/fg 两 pass 同乘,Min(1) 后置同式）;glint ADD
   *  同乘（仓内波光面=液体本体 α 派生,渐隐期不悬挂）;微光/蜂蜜/水不乘。 */
  lavaOpacity = 1,
): void {
  if (!atlas) { _liqDebug.atlasReady = false; return; }
  const PAD = 2;
  const px0 = tx0 - PAD, py0 = ty0 - PAD;
  const pw = tx1 - tx0 + 1 + PAD * 2, ph = ty1 - ty0 + 1 + PAD * 2;
  const n = pw * ph;
  if (n > _liqCap) {
    // 只增不减(缩放变化按最大视图分配一次)
    _liqCap = n;
    _level = new Float32Array(n); _visLevel = new Float32Array(n); _opacity = new Float32Array(n);
    _isSolidA = new Uint8Array(n); _hasLiquidA = new Uint8Array(n); _hasWallA = new Uint8Array(n);
    _hasVisA = new Uint8Array(n); _typeA = new Uint8Array(n); _visTypeA = new Uint8Array(n);
    _lW = new Float32Array(n); _rW = new Float32Array(n); _bW = new Float32Array(n); _tW = new Float32Array(n);
    _vlW = new Float32Array(n); _vrW = new Float32Array(n); _vbW = new Float32Array(n); _vtW = new Float32Array(n);
    _hasLE = new Uint8Array(n); _hasRE = new Uint8Array(n); _hasTE = new Uint8Array(n); _hasBE = new Uint8Array(n);
    _isHalfA = new Uint8Array(n);
    _fx = new Int16Array(n); _fy = new Int16Array(n);
  }
  const prepKey = `${tx0},${ty0},${tx1},${ty1},${waterStyle}`;
  // ★同帧复用(#perf-gpulog 水体批):bg(:2755)/fg(:3139)两次调用输入相同,
  // 第二次跳过 P1-P7(数组持本帧早先结果)【直接进绘制段】——绝不可 return 整函数:
  // fg 返回 = fgCanvas 空白 = 全屏 GL 扭曲/波光失去门控纹理(用户实报"GL效果没了")
  const needsPrep = frameToken === undefined || _prepToken !== frameToken || _prepKey !== prepKey;
  if (needsPrep) {
  _prepToken = frameToken; _prepKey = prepKey;
  // 归零(等价新分配数组;未写格语义为 0)。
  // 例外:opacity 原为 .fill(1)——P3 只写到 ph-10 行,底缘 8 行依赖初始 1,
  // 必须保持 fill(1) 否则视口底缘水体透明度归零(渲染结果变化)
  _level.fill(0); _visLevel.fill(0); _opacity.fill(1);
  _isSolidA.fill(0); _hasLiquidA.fill(0); _hasWallA.fill(0);
  _hasVisA.fill(0); _typeA.fill(0); _visTypeA.fill(0);
  _lW.fill(0); _rW.fill(0); _bW.fill(0); _tW.fill(0);
  _vlW.fill(0); _vrW.fill(0); _vbW.fill(0); _vtW.fill(0);
  _hasLE.fill(0); _hasRE.fill(0); _hasTE.fill(0); _hasBE.fill(0);
  _isHalfA.fill(0);
  _fx.fill(0); _fy.fill(0);
  }   // needsPrep(fills)结束
  // 别名(守卫外亦消费:绘制段每次调用都跑)——声明零成本
  const level = _level, visLevel = _visLevel, opacity = _opacity;
  const isSolidA = _isSolidA, hasLiquidA = _hasLiquidA, hasWallA = _hasWallA;
  const hasVisA = _hasVisA, typeA = _typeA, visTypeA = _visTypeA;
  const lW = _lW, rW = _rW, bW = _bW, tW = _tW;
  const vlW = _vlW, vrW = _vrW, vbW = _vbW, vtW = _vtW;
  const hasLE = _hasLE, hasRE = _hasRE, hasTE = _hasTE, hasBE = _hasBE;
  const isHalfA = _isHalfA;
  const fx = _fx, fy = _fy;
  const at = liqP2 ? atM : (lx: number, ly: number) => lx * ph + ly; // padding 内坐标
  _atPh = ph;   // ★liqp2:atM 单形函数的 ph 同步（闭包臂忽略;每调用一次置位=重入安全）
  const p3 = liqP3;   // ★liqp3:本调用旗快照（灰度双臂选择子;off 臂全链 at()/逐格乘加原样）
  let bx0 = _boxL, bx1 = _boxR, by0 = _boxT, by1 = _boxB;   // 复用帧沿用本帧早前盒值

  // ---- ★C7 fg 复用臂前置判定（2026-10-08;?liqc7=1 激活,缺省关=全量链逐位）----
  // 【机制】fg pass(needsPrep=false) 的复位重扫（下方 !swPerf||!needsPrep 块,P1
  //  全窗 store 重读）与 Unguarded P3 的全部写入,在 fg 复用臂命中路径上【无消费
  //  者】:复用臂直读 _bgBaseRuns/_bgSpark/_bgGlint 账重发射后 return,主绘制循环
  //  整段跳过,数组状态自此不再被读（census 活帧:复用命中=fg 零 draws 零直画）。
  //  判定面在 fg 入口即已定:bg 终值 _batOverflow/_addOverflow/_bgRunsFrame（帧环
  //  复位 resetLiquidBatchForFrame 同帧幂等,不动这三键）+ needsPrep + bat + CTM
  //  轴对齐（调用方世界变换到此处无人改动,P1-P3 是纯数组数学）——与 :2036 原式
  //  逐键同源（polish+batOn 展开）。命中 ⇒ 两死算块整跳（=位等:死写入无观察面）;
  //  bg pass(needsPrep=true) 恒 false=现行链。wldT 捕获/identity 切换同步上提
  //  （调用方到原 :1938 捕获位之间无 ctx 变换 op,值恒等;devSX 族常量随之）。
  const wldT = ctx.getTransform();
  const devSX = wldT.a, devSY = wldT.d, devTE = wldT.e, devTF = wldT.f;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const fgReuseHit = liqC7 && !needsPrep && liqpolish && !!bat
    && frameToken !== undefined && !_batOverflow && !_addOverflow
    && _bgRunsFrame === frameToken && wldT.b === 0 && wldT.c === 0;

  // ---- P1：原始缓存(同帧复用:仅 needsPrep 时执行) ----
  if (needsPrep) {
  if (liqP2) {
    // ★liqp2 P1 重排臂（头注 liqp2 块①-⑤;同表达式换承载机制,值逐位同）:
    //  level/type 走封闭 LUT,solid 走惰性 typed LUT（Map 版 staleness 同构）,
    //  inBounds 合取分解外提（列有效+行有效表）,idx/at 增量化。
    //  评估序备案:旧支 tileSolidLut 即便 flags=0 也先求值（实参急切）;新支短路
    //  跳过——差异仅 _solidTy/_solidLut 暖缓存内部状态,无观察面（谓词结果恒等）。
    const w = st.w, h = st.h;
    const liqA = st.liquid, wallA = st.wall, ltA = st.liquidType,
      flA = st.flags, wireA = st.wire, tyA = st.type;
    if (_rowValid.length < ph) _rowValid = new Uint8Array(ph + 64);
    for (let ly = 0; ly < ph; ly++) {
      const y = py0 + ly;
      _rowValid[ly] = y >= 0 && y < h ? 1 : 0;
    }
    for (let lx = 0; lx < pw; lx++) {
      const x = px0 + lx;
      const colOk = x >= 0 && x < w;
      let i = lx * ph;
      for (let ly = 0, si = py0 * w + x; ly < ph; ly++, i++, si += w) {
        if (!colOk || !_rowValid[ly]) { isSolidA[i] = 1; continue; }
        const lq = liqA[si];
        level[i] = _lvlLut[lq];
        hasLiquidA[i] = lq > 0 ? 1 : 0;
        hasWallA[i] = wallA[si] > 0 ? 1 : 0;
        const vt = _tovLut[ltA[si]];
        typeA[i] = vt;
        visTypeA[i] = vt; // 同旧支:预填本格类型兜底（P3 只跑到底部 10 行外,原版 L152）
        const fl = flA[si];
        const ty = tyA[si];
        let sol = _solidTy[ty];
        // 哨兵 255=未解析;undefined=类型越当前表长（惰性增长冷支兜住——
        // 直读 undefined 会把 >1024 的 mod 大 id 固体误判非实心,Map 版无此洞）
        if (sol !== 0 && sol !== 1) sol = solidTy8(ty);
        // 同 liquidCacheIsSolid 单源谓词:active ∧ !inActive(wire bit32) ∧ tileSolid
        isSolidA[i] = fl !== 0 && (wireA[si] & 32) === 0 && sol === 1 ? 1 : 0;
      }
    }
  } else {
  for (let lx = 0; lx < pw; lx++) {
    const x = px0 + lx;
    for (let ly = 0; ly < ph; ly++) {
      const y = py0 + ly;
      const i = lx * ph + ly;
      if (!st.inBounds(x, y)) { isSolidA[i] = 1; continue; }
      const si = st.idx(x, y);
      const lq = st.liquid[si];
      level[i] = lq / 255;
      hasLiquidA[i] = lq > 0 ? 1 : 0;
      hasWallA[i] = st.wall[si] > 0 ? 1 : 0;
      typeA[i] = toVanillaType(st.liquidType[si]);
      visTypeA[i] = typeA[i]; // P3 只跑到底部 10 行外（同原版 L152）——预填本格类型兜底，
                              // 否则底带格子 visTypeA=0 被当水画（原版靠跨帧残留缓存掩蔽）
      // ★幽灵保域（2026-09-03）：实心判定首门 = 原版 LiquidCache.IsSolid =
      // WorldGen.SolidOrSlopedTile（LiquidRenderer.cs:198）的 tile.active() 门——
      // 幽灵格（flags=0,type≠0,x86 对齐残型）不算实心,否则其"化石层"会压住
      // 邻格液面形态。halfBrick 支无 active 门（vanilla :197 裸读）保持原样
      // ★W-A4（2026-09-03）：谓词单源化至 liquidCacheIsSolid（补 !inActive 致动门,
      //  WorldGen.cs:70534 IL_004c `return !tile.inActive()`）
      isSolidA[i] = liquidCacheIsSolid(st.flags[si], st.wire[si],
        tileSolidLut(st.type[si])) ? 1 : 0;
    }
  }
  }
  }   // P1 结束
  // ★BJ77(#swperf 2026-09-14)：下方是同帧复用失效路径(fg pass / needsPrep=false)
  //  的【状态复位重扫】——它把 bg 调用 P2/P3 已改写的 typeA/visTypeA 重置回 store
  //  值、再由本调用 Unguarded P3 重铺,fg 绘制语义(夹心格/瀑布类型)依赖此复位,
  //  必须保留。而 bg 调用(needsPrep=true)时它与上方守卫块【相邻】且为纯 store
  //  重读(两次写入值恒等)= 幂等白扫 → swPerf 下仅 bg 跳过(输出逐位不变;
  //  关=原行为恒跑,双支结构见 perfFlags.ts 契约)。
  // ★C7:fgReuseHit=复用臂命中,本块+下方 P3 的写入在复用路径无消费者 → 整跳（死算跳水）
  if (!fgReuseHit && (!swPerf || !needsPrep)) {
  if (liqP2) {
    // ★liqp2 P1 重排臂（同帧复用失效重扫副本=首扫臂同式;值逐位同,备案同首扫）
    const w = st.w, h = st.h;
    const liqA = st.liquid, wallA = st.wall, ltA = st.liquidType,
      flA = st.flags, wireA = st.wire, tyA = st.type;
    if (_rowValid.length < ph) _rowValid = new Uint8Array(ph + 64);
    for (let ly = 0; ly < ph; ly++) {
      const y = py0 + ly;
      _rowValid[ly] = y >= 0 && y < h ? 1 : 0;
    }
    for (let lx = 0; lx < pw; lx++) {
      const x = px0 + lx;
      const colOk = x >= 0 && x < w;
      let i = lx * ph;
      for (let ly = 0, si = py0 * w + x; ly < ph; ly++, i++, si += w) {
        if (!colOk || !_rowValid[ly]) { isSolidA[i] = 1; continue; }
        const lq = liqA[si];
        level[i] = _lvlLut[lq];
        hasLiquidA[i] = lq > 0 ? 1 : 0;
        hasWallA[i] = wallA[si] > 0 ? 1 : 0;
        const vt = _tovLut[ltA[si]];
        typeA[i] = vt;
        visTypeA[i] = vt;
        const fl = flA[si];
        const ty = tyA[si];
        let sol = _solidTy[ty];
        if (sol !== 0 && sol !== 1) sol = solidTy8(ty);   // 哨兵/越界冷支（备案同首扫臂）
        isSolidA[i] = fl !== 0 && (wireA[si] & 32) === 0 && sol === 1 ? 1 : 0;
      }
    }
  } else {
  for (let lx = 0; lx < pw; lx++) {
    const x = px0 + lx;
    for (let ly = 0; ly < ph; ly++) {
      const y = py0 + ly;
      const i = lx * ph + ly;
      if (!st.inBounds(x, y)) { isSolidA[i] = 1; continue; }
      const si = st.idx(x, y);
      const lq = st.liquid[si];
      level[i] = lq / 255;
      hasLiquidA[i] = lq > 0 ? 1 : 0;
      hasWallA[i] = st.wall[si] > 0 ? 1 : 0;
      typeA[i] = toVanillaType(st.liquidType[si]);
      visTypeA[i] = typeA[i]; // P3 只跑到底部 10 行外（同原版 L152）——预填本格类型兜底，
                              // 否则底带格子 visTypeA=0 被当水画（原版靠跨帧残留缓存掩蔽）
      // ★幽灵保域（2026-09-03）：实心判定首门 = 原版 LiquidCache.IsSolid =
      // WorldGen.SolidOrSlopedTile（LiquidRenderer.cs:198）的 tile.active() 门——
      // 幽灵格（flags=0,type≠0,x86 对齐残型）不算实心,否则其"化石层"会压住
      // 邻格液面形态。halfBrick 支无 active 门（vanilla :197 裸读）保持原样
      // ★W-A4（2026-09-03）：同 P1 首扫,谓词单源 liquidCacheIsSolid（本段是
      //  同帧复用失效时的全量重扫副本）
      isSolidA[i] = liquidCacheIsSolid(st.flags[si], st.wire[si],
        tileSolidLut(st.type[si])) ? 1 : 0;
    }
  }
  }
  }   // ★BJ77 P1 复位扫守卫结束
  // 液体包围盒(P1 扫描产出,内区坐标):P2-P7 裁剪用。+1 余量覆盖夹心格邻域
  if (needsPrep) {
  let bL = pw, bT = ph, bR = -1, bB = -1, hasAny = false;
  {
    const M = PAD + 1;
    for (let lx = PAD; lx < pw - PAD; lx++) {
      for (let ly = PAD; ly < ph - PAD; ly++) {
        if (!hasLiquidA[p3 ? lx * ph + ly : at(lx, ly)]) continue;   // ★liqp3②算术化
        hasAny = true;
        if (lx - M < bL) bL = lx - M;
        if (ly - M < bT) bT = ly - M;
        if (lx + M > bR) bR = lx + M;
        if (ly + M > bB) bB = ly + M;
      }
    }
    // P3 瀑布拖尾最多向下 WATERFALL_LENGTH[?] ≤ 10 行,底部再 +11 覆盖
    if (hasAny) bB = Math.min(ph - PAD - 1, bB + 11);
    _boxL = Math.max(PAD, bL); _boxT = Math.max(PAD, bT);
    _boxR = Math.min(pw - PAD - 1, bR); _boxB = Math.min(ph - PAD - 1, bB);
    _boxHas = hasAny;
    bx0 = _boxL; bx1 = _boxR; by0 = _boxT; by1 = _boxB;
  }
  }   // needsPrep(bbox)结束
  // 半砖缓存（LiquidRenderer.cs:103-110）：halfBrick && 上格有液体 && 非平台；
  // 无液体时类型继承上格（109-110）。注意 ptr[-1] = y-1 = 上格
  // 低清/包围盒裁剪(#perf-gpulog):需要 hasLiquidA[上] → 上格必在液面包围盒±1
  if (needsPrep) for (let lx = bx0; lx <= bx1; lx++) {
    for (let ly = Math.max(1, by0); ly <= by1; ly++) {
      const i = p3 ? lx * ph + ly : at(lx, ly);   // ★liqp3②
      if (!st.inBounds(px0 + lx, py0 + ly)) continue;
      const si = st.idx(px0 + lx, py0 + ly);
      const d = TILE_DEFS[st.type[si]];
      if (st.half[si] && hasLiquidA[p3 ? i - 1 : at(lx, ly - 1)] && !(d && d.platform)) {
        isHalfA[i] = 1;
        if (!hasLiquidA[i]) typeA[i] = typeA[p3 ? i - 1 : at(lx, ly - 1)];
      }
    }
  }

  // ---- P2：可见液位(液体包围盒裁剪 #perf-gpulog:夹心格按定义在盒内,无损) ----
  if (needsPrep) for (let lx = bx0; lx <= bx1; lx++) {
    for (let ly = by0; ly <= by1; ly++) {
      const i = p3 ? lx * ph + ly : at(lx, ly);   // ★liqp3②
      let v: number;
      if (isHalfA[i] && hasLiquidA[p3 ? i - 1 : at(lx, ly - 1)]) {
        v = 1; // 半砖 + 上格有液体：可视液面拉满（LiquidRenderer.cs:121-122）
      } else if (!hasLiquidA[i]) {
        const li = p3 ? i - ph : at(lx - 1, ly), ri = p3 ? i + ph : at(lx + 1, ly),
          ui = p3 ? i - 1 : at(lx, ly - 1), di = p3 ? i + 1 : at(lx, ly + 1);
        let val = 0;
        // 原版先判 ptr[-1]/[+1]（上下），后判 ptr[-H]/[+H]（左右）→ 左右命中时 Type 覆盖（L129-138）
        if (hasLiquidA[ui] && hasLiquidA[di] && typeA[ui] === typeA[di] && !isSolidA[ui] && !isSolidA[di]) {
          val = level[ui] + level[di];
          typeA[i] = typeA[ui];
        }
        if (hasLiquidA[li] && hasLiquidA[ri] && typeA[li] === typeA[ri] && !isSolidA[li] && !isSolidA[ri]) {
          val = Math.max(val, level[li] + level[ri]);
          typeA[i] = typeA[li];
        }
        v = val * 0.5;
      } else {
        v = level[i];
      }
      visLevel[i] = v;
      hasVisA[i] = v !== 0 ? 1 : 0;
    }
  }

  // ---- P3：瀑布拖尾（向下传播） + 实心格处理(包围盒裁剪;拖尾 ≤10 行已计入盒底 +11) ----
  // ★C7:fg 复用臂命中时整跳（死写入无消费者,见 fgReuseHit 块注;fg 不复用帧照旧重铺）
  if (!fgReuseHit) for (let lx = bx0; lx <= bx1; lx++) {
    for (let ly = by0; ly <= Math.min(by1, ph - 11); ly++) {
      const i = p3 ? lx * ph + ly : at(lx, ly);   // ★liqp3②
      if (hasVisA[i] && (!isSolidA[i] || isHalfA[i])) {
        opacity[i] = 1;
        visTypeA[i] = typeA[i];
        const len = WATERFALL_LENGTH[typeA[i]] ?? 3;
        const step = 1 / (len + 1);
        let k = 1;
        for (let s = 1; s <= len; s++) {
          k -= step;
          const bi = p3 ? i + s : at(lx, ly + s);   // ★liqp3②
          if (ly + s >= ph) break;
          if (!isSolidA[bi]) {
            visLevel[bi] = Math.max(visLevel[bi], visLevel[i] * k);
            opacity[bi] = k;
            visTypeA[bi] = typeA[i];
          } else break;
        }
      }
      if (isSolidA[i] && !isHalfA[i]) {
        visLevel[i] = 1;
        hasVisA[i] = 0;
      } else {
        // 原版 L178-179：非实心格在此重算可见性——P3 拖尾写入的干格因此变为可见
        hasVisA[i] = visLevel[i] !== 0 ? 1 : 0;
      }
    }
  }

  // ---- P4：四壁插值 + 边存在 + 变体 FrameOffset(包围盒裁剪:P4 只读 ±1 邻居,盒含) ----
  if (needsPrep) for (let lx = bx0; lx <= bx1; lx++) {
    for (let ly = by0; ly <= by1; ly++) {
      const i = p3 ? lx * ph + ly : at(lx, ly);   // ★liqp3②
      if (!hasVisA[i]) { hasLE[i] = hasRE[i] = hasTE[i] = hasBE[i] = 0; continue; }
      const ui = p3 ? i - 1 : at(lx, ly - 1), di = p3 ? i + 1 : at(lx, ly + 1),
        li = p3 ? i - ph : at(lx - 1, ly), ri = p3 ? i + ph : at(lx + 1, ly);   // ★liqp3②算术化
      let nT = 0, nB = 1, nL = 0, nR = 1;
      const my = visLevel[i];
      if (!hasVisA[ui]) nT += visLevel[di] * (1 - my);
      if (!hasVisA[di] && !isSolidA[di] && !isHalfA[di]) nB -= visLevel[ui] * (1 - my);
      if (!hasVisA[li] && !isSolidA[li] && !isHalfA[li]) nL += visLevel[ri] * (1 - my);
      if (!hasVisA[ri] && !isSolidA[ri] && !isHalfA[ri]) nR -= visLevel[li] * (1 - my);
      tW[i] = nT; bW[i] = nB; lW[i] = nL; rW[i] = nR;
      hasTE[i] = (!hasVisA[ui] && !isSolidA[ui]) || nT !== 0 ? 1 : 0;
      hasBE[i] = (!hasVisA[di] && !isSolidA[di]) || nB !== 1 ? 1 : 0;
      hasLE[i] = (!hasVisA[li] && !isSolidA[li]) || nL !== 0 ? 1 : 0;
      hasRE[i] = (!hasVisA[ri] && !isSolidA[ri]) || nR !== 1 ? 1 : 0;
      // 注:原版 1.4.5.6 的 _waveMask 几何波动是【死代码】——WAVE_MASK_STRENGTH 是
      // new byte[5] 全零从不赋值、WaveFilters 事件全工程无订阅者(LiquidRenderer.cs:110/616)。
      // 用户感知的"水面波动"全部来自 16 帧纹理动画(下方 :289-291 已 1:1)+ 表面静态带 1280,
      // 此处曾加过的正弦 TopWall 扰动是多余的非原版效果,已按源码标杆移除。
      let ox = 0, oy = 0;
      if (!hasLE[i]) { ox += hasRE[i] ? 32 : 16; }
      if (hasLE[i] && hasRE[i]) {
        ox = 16; oy += 32;
        if (hasTE[i]) oy = 16;
      } else if (!hasTE[i]) {
        if (!hasLE[i] && !hasRE[i]) oy += 48;
        else oy += 16;
      }
      if (oy === 16 && !!(hasLE[i] ^ hasRE[i]) && (py0 + ly) % 2 === 0) oy += 16;
      fx[i] = ox; fy[i] = oy;
    }
  }

  // ---- P5：壁值平滑(包围盒裁剪) ----
  if (needsPrep) for (let lx = bx0; lx <= bx1; lx++) {
    for (let ly = by0; ly <= by1; ly++) {
      const i = p3 ? lx * ph + ly : at(lx, ly);   // ★liqp3②
      if (!hasVisA[i]) continue;
      const ui = p3 ? i - 1 : at(lx, ly - 1), di = p3 ? i + 1 : at(lx, ly + 1),
        li = p3 ? i - ph : at(lx - 1, ly), ri = p3 ? i + ph : at(lx + 1, ly);   // ★liqp3②算术化
      vlW[i] = lW[i]; vrW[i] = rW[i]; vtW[i] = tW[i]; vbW[i] = bW[i];
      if (hasVisA[ui] && hasVisA[di]) {
        if (hasLE[i]) vlW[i] = (lW[i] * 2 + lW[ui] + lW[di]) * 0.25;
        if (hasRE[i]) vrW[i] = (rW[i] * 2 + rW[ui] + rW[di]) * 0.25;
      }
      if (hasVisA[li] && hasVisA[ri]) {
        if (hasTE[i]) vtW[i] = (tW[i] * 2 + tW[li] + tW[ri]) * 0.25;
        if (hasBE[i]) vbW[i] = (bW[i] * 2 + bW[li] + bW[ri]) * 0.25;
      }
    }
  }

  // ---- P6：瀑布侧/邻接修正(包围盒裁剪) ----
  if (needsPrep) for (let lx = bx0; lx <= bx1; lx++) {
    for (let ly = by0; ly <= by1; ly++) {
      const i = p3 ? lx * ph + ly : at(lx, ly);   // ★liqp3②
      if (!hasLiquidA[i]) continue;
      const ui = p3 ? i - 1 : at(lx, ly - 1), di = p3 ? i + 1 : at(lx, ly + 1),
        li = p3 ? i - ph : at(lx - 1, ly), ri = p3 ? i + ph : at(lx + 1, ly);   // ★liqp3②算术化
      if (hasTE[i] && !hasBE[i] && !!(hasLE[i] ^ hasRE[i])) {
        if (hasRE[i]) { vrW[i] = vrW[di]; vtW[i] = vtW[li]; }
        else { vlW[i] = vlW[di]; vtW[i] = vtW[ri]; }
      } else if (fx[di] === 16 && fy[di] === 32) {
        if (vlW[i] > 0.5) { vlW[i] = 0; fx[i] = 0; fy[i] = 0; }
        else if (vrW[i] < 0.5) { vrW[i] = 1; fx[i] = 32; fy[i] = 0; }
      }
    }
  }

  // ---- P7：内角填充(包围盒裁剪) ----
  if (needsPrep) for (let lx = bx0; lx <= bx1; lx++) {
    for (let ly = by0; ly <= by1; ly++) {
      const i = p3 ? lx * ph + ly : at(lx, ly);   // ★liqp3②
      if (!hasLiquidA[i]) continue;
      const ui = p3 ? i - 1 : at(lx, ly - 1), di = p3 ? i + 1 : at(lx, ly + 1),
        li = p3 ? i - ph : at(lx - 1, ly), ri = p3 ? i + ph : at(lx + 1, ly);   // ★liqp3②算术化
      if (!hasBE[i] && !hasLE[i] && !hasTE[i] && !hasRE[i]) {
        // 原版 LiquidRenderer.cs:342-346：left.HasTopEdge && up.HasLeftEdge，墙面取 up.vlW / left.vtW
        if (hasTE[li] && hasLE[ui]) {
          fx[i] = Math.max(4, Math.floor(16 - vlW[ui] * 16)) - 4;
          fy[i] = 48 + Math.max(4, Math.floor(16 - vtW[li] * 16)) - 4;
          vlW[i] = 0; vtW[i] = 0; vrW[i] = 1; vbW[i] = 1;
        } else if (hasTE[ri] && hasRE[ui]) {
          fx[i] = 32 - Math.min(16, Math.floor(vrW[ui] * 16) - 4);
          fy[i] = 48 + Math.max(4, Math.floor(16 - vtW[ri] * 16)) - 4;
          vlW[i] = 0; vtW[i] = 0; vrW[i] = 1; vbW[i] = 1;
        }
      }
    }
  }

  // ---- 绘制 ----
  const texCache = new Map<number, ImageBitmap | HTMLImageElement | null>();
  // ★liqpolish:末次查询 memo（微光湖单表场景 Map.get/tile→比较/tile;pass 内
  //  表就绪态不变故未命中亦可钉——Map 语义仅跨帧,本 memo 生命周期=单次调用）
  let _texLastVt = -1;
  let _texLastT: ImageBitmap | HTMLImageElement | null = null;
  const texFor = (vt: number) => {
    if (polish && vt === _texLastVt) return _texLastT;
    let t = texCache.get(vt);
    if (t === undefined) {
      t = atlas.ensureVImage(waterSheet(vt, waterStyle)) ?? null;
      if (t) texCache.set(vt, t);  // 只缓存命中(缓存 null 会把未就绪永久化)
    }
    _texLastVt = vt; _texLastT = t;
    return t;
  };
  // 双动画帧（1456 LiquidRenderer.Update :844-856）：
  //  _animationFrame = windSpeed*25 ± 6 每 秒（边缘格波浪,负风倒放,模 16）
  //  _waterfallAnimationFrame = 0.5 每 秒（X==16 中列 = 下落水柱/池体,慢速流纹——
  //  1.4.4 新增;1405 无此项,旧移植全部格共用快帧导致下落水柱 6fps 快闪"贴图不对"）
  const rate = windSpeed >= 0 ? windSpeed * 25 + 6 : windSpeed * 25 - 6;
  // ★2026-09-27 逐 tick 累计（LiquidRenderer.cs:846-848 dt=1/60 定步 1:1）——
  //  旧 Math.floor((nowMs/1000)·rate) 墙钟退役（见 _liqWaveTick 块注释）
  const tickNow = gameTickCount();
  if (tickNow !== _liqWaveTick) {
    const d = Math.min(Math.max(tickNow - _liqWaveTick, 1), 8);
    _liqWaveTick = tickNow;
    _liqFrameState = (((_liqFrameState + (rate / 60) * d) % 16) + 16) % 16;
    _liqWaterfallState = (((_liqWaterfallState + (0.5 / 60) * d) % 16) + 16) % 16;
  }
  const animFrame = Math.floor(_liqFrameState) % 16;
  const waterfallFrame = Math.floor(_liqWaterfallState) % 16;
  ctx.imageSmoothingEnabled = false;

  // 主循环（双 pass 共用：背景 pass 画在方块层前、透明度 1.0；前景 pass 画在方块后、乘 DEFAULT_OPACITY）
  // 水波位移（WaterWaves，q>0 生效）：表层格（hasTE=水线）水线随 dy 升降——底边锚定、
  // 上沿移动（dstY+dy / 高 sh−dy），源矩形同步裁剪保持 1:1 像素；同一帧双 pass 采样
  // 确定性一致 → 背景/前景水线恒对齐。波光 tint 仅前景 pass（避免双 pass 重复提亮）。
  // ★warpMode（全屏扭曲管线激活）时本块关闭：波动全部来自 compositeLight 后的
  //   FilterWaterDistortion 全屏位移（原版 waterTarget 本体无逐格 bob）。
  const waveOn = waterWaves.quality > 0 && !warpMode;
  const waveInvZ = waveOn ? 1 / Math.max(1e-6, waterWaves.viewZoom()) : 0;
  // ★IIIII251 斜坡水缘 CPU bob 门（与表层 bob 同门：GL 全屏扭曲路径不双重 bob，
  //  位移由足迹门控交付——见 Renderer footCtx 接线与 WaterWarpCompositor；
  //  ★IIIII257 转正后 slopeWaveEnabled 缺省 true，?slopewave=0 逃生门关）
  const slopeWaveBob = slopeWaveEnabled && waterWaves.quality > 0 && !warpMode;
  const _wdisp: [number, number] = [0, 0];
  const _slopeDisp251: [number, number] = [0, 0];   // ★IIIII251 斜坡水缘 bob 采样暂存
  // ★整数设备矩形分区（2026-08-22 用户终报"某些缩放下每格水之间浮点像素缝隙"）：
  //   水格矩形=世界整数坐标，但 zoom·dpr 非整数时相邻格共享边落在设备分数像素，
  //   光栅器对每个 drawImage 矩形【独立取边覆盖】→ 共享边 1px 无覆盖缝（背景
  //   透出，水面成网格）。修=主循环切【身份变换】按设备像素绘制，每格设备矩形
  //   按"共享边 ceil 分区"：左/上邻是水 → x0/y0=ceil(共享边)（与邻格 x1/y1=ceil
  //   同值 → 不重不漏）；否则 floor（保水体外缘覆盖）。右/下边恒 ceil。
  //   双 pass（不透明背景 + 0.5 前景）均无缝且无重叠加倍变深。源矩形不动，
  //   ≤1 设备 px 拉伸不可感知（同 2026-08-18 chunk 整数设备矩形定案取舍）。
  //   微光分支以 x*16 为参照（applyShimmerBaseTint）→ 逐 tile 恢复世界变换绘制。
  //   ★C7:wldT 捕获/identity 切换上提至 fgReuseHit 判定位（:1554,值恒等——调用方
  //   到此处无 ctx 变换 op;devSX 族随迁,下方重复捕获已删）。
  // ---- ★liqgl 批通道（列→顶点批;pass 级 all-or-nothing——预检在 Renderer 侧,
  //  此处仅防御:帧环复位/帽溢出/非轴对齐 CTM 回 CPU 原链）----
  resetLiquidBatchForFrame(frameToken ?? -1);
  let batOn = !!bat && frameToken !== undefined && !_batOverflow
    && wldT.b === 0 && wldT.c === 0;
  let runStart = _batN;
  let runImg: CanvasImageSource | null = null;
  let runKey = '';
  let runCols = false;   // 本段含微光调制 quad（重放面用;段按 sheet 同质——微光表
                         // Misc_water_14 与普通水表 0-13 文件互异,不可能混段）
  let runVt = -1;        // ★liqpolish fg 复用:段 vt→fg α 系数（DEFAULT_OPACITY[vt];sheet↔vt 单射）
  let tVisCache = -1;   // 微光 tVis 每 pass 取一次（visEffectFrames 渲染段内不变）

  // ---- ★liqpolish 波值跨 pass 缓存臂（bg=写,fg=读;帧 token+tVis+窗高 stamps）----
  //  微光 tile 波值/噪声 sin 只依赖 (x,y,tVis)——同帧双 pass 同值;第二 pass 直读
  //  =每格 8 sin→0。窗口/水型/帧任一变即失效（stamp 三键）。frameToken 缺省
  //  （无 token 调用）=无缓存,每格写 _wvLocal 单槽（格内 glitter/基色共享）。
  const polish = liqpolish;
  // ★C13c 臂域:liqC13c ∧ polish（?liqpolish=0 保整条 CPU 原链=正交逃生门;批通道
  //  在场（batOn 前置）+环惰性建面——逃生门会话零成本）。★转正（2026-10-02）缺省开;
  //  三期 body sparkle 亮纹段（_spShimRing/uSpark=1）同域激活。
  const c13cOn = liqC13c && polish;
  if (c13cOn && batOn) ensureShimRings();
  // ★liqpolish:needsPrep（=帧内首 pass/bg）清 fg 复用账（本 pass 重录;
  //  bg 段经 flushRun/flushAddRuns2DAndEmit(record) 登记见下）
  if (needsPrep) {
    _bgBaseRuns.length = 0; _bgSpark = null; _bgGlint = null;
  }
  const tVisPass = polish ? visEffectFrames() : -1;
  let wvRead: Float64Array | null = null;
  let wvWrite: Float64Array | null = null;
  // ★C13c:波值跨 pass 缓存在本臂退役（§3.2——波值场已上 GPU;stamp 不更新=旗翻回
  //  CPU 臂时 bg 必重写,防跨旗翻面读到陈旧 stamp 标记下的旧帧数据）
  if (polish && !c13cOn) {
    if (frameToken !== undefined && _wvTok === frameToken && _wvTVis === tVisPass
      && _wvPh === ph && _wvArr && n <= _wvCap) {
      wvRead = _wvArr;
    } else {
      if (!_wvArr || n > _wvCap) { _wvCap = n; _wvArr = new Float64Array(n * 8); }
      if (frameToken !== undefined) {
        _wvTok = frameToken; _wvTVis = tVisPass; _wvPh = ph;
        wvWrite = _wvArr;
      }
    }
  }
  const flushRun = (): void => {
    const quads = _batN - runStart;
    if (quads <= 0 || !runImg || !bat) return;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const img = runImg, s0 = runStart, nQ = quads, k = runKey, cols = runCols, vt = runVt;
    const dataSlice = _batRing.subarray(s0 * LIQ_QUAD_FLOATS, _batN * LIQ_QUAD_FLOATS);
    bat.emit(img, k, dataSlice, nQ,
      (raw) => replayLiqRun2D(raw, s0, nQ, img, cols));
    if (gateCapture && !isBackground) _fgRuns.push({ img, key: k, start: s0, quads: nQ, data: dataSlice });
    // ★liqpolish fg 复用:bg 段登记（k=fg α 系数;溢出帧不录=fg 走构造原链）
    if (polish && isBackground && !_batOverflow && !_addOverflow && frameToken !== undefined) {
      // ★BJ705-G26 件3:岩浆段 fg α 系数叠 lavaOpacity（fg 复用臂缩放重发射消费）
      _bgBaseRuns.push({ img, key: k, start: s0, quads: nQ, k: (DEFAULT_OPACITY[vt] ?? 0.6) * (vt === 1 ? lavaOpacity : 1), cols });
      _bgRunsFrame = frameToken;
    }
    runStart = _batN;
    runImg = null;
    runCols = false;
  };
  // ★C13c 微光段收口（flushRun 同式;数据源=_shimRing stride 11,发射经 emitShimRun
  //  → quadBatchRgba 形状分派 → sprite:liqshimmer 程序）。bg pass 登记 fg 复用账
  //  （shim 段 k=DEFAULT_OPACITY[3];fg 重发射 rgba 同步缩=预乘恒等保持）;fg pass
  //  gateCapture 登记 _fgRuns（shim:true——gate 重发射走 _gateShimData stride 11）。
  //  发射失败=2D 原位重放（flushBandRun 判例;宁回退不丢精灵）。 */
  const flushShimRun = (): void => {
    const quads = _shimN - _shimStart;
    if (quads <= 0 || !_shimImg || !bat) return;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const img = _shimImg, s0 = _shimStart, nQ = quads, k = _shimKey;
    _shimOn = false;
    const ok = emitShimRun(bat, s0, nQ, img, k);
    if (!ok) replayLiqShimRun2D(ctx, s0, nQ, img);   // 入口门拒=2D 原位重放
    if (gateCapture && !isBackground) _fgRuns.push({ img, key: k, start: s0, quads: nQ, shim: true,
      data: _shimRing!.subarray(s0 * LIQ_SHIM_QUAD_FLOATS, (s0 + nQ) * LIQ_SHIM_QUAD_FLOATS) });
    if (polish && isBackground && !_batOverflow && !_addOverflow && frameToken !== undefined) {
      _bgBaseRuns.push({ img, key: k, start: s0, quads: nQ, k: DEFAULT_OPACITY[3], cols: false, shim: true });
      _bgRunsFrame = frameToken;
    }
    _shimStart = _shimN;
    _shimImg = null;
  };
  if (gateCapture && isBackground) {
    _footWld.a = wldT.a; _footWld.b = wldT.b; _footWld.c = wldT.c;
    _footWld.d = wldT.d; _footWld.e = wldT.e; _footWld.f = wldT.f;
  }
  // ---- ★liqpolish fg 复用臂（bg 构造段缩放重发射;fg 逐 tile 构造循环整体跳过）----
  //  有效性 = 同帧 token+bg 已录+双环未溢出（溢出帧 fg 走逐 tile 构造原链——
  //  溢出段的 CPU 兜底逐 tile 画,复用账不含）。重发射序 = [缩放基底段][sparkle
  //  拷贝][glint 拷贝] —— 与 bg 段序同构（全基底先于 ADD=重叠序契约）。
  //  【位等/登记域】基底段 rgb,a 同乘 k（f32 双舍入 ±1LSB 登记）;sparkle/glint
  //  段逐位拷贝。gate 重发射读缩放后环数据（obj19 α×100 饱和域,无害）。
  const fgReuse = polish && !needsPrep && batOn && bat !== null
    && !_batOverflow && !_addOverflow && frameToken !== undefined
    && _bgRunsFrame === frameToken;
  if (fgReuse && bat) {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    for (let ri = 0; ri < _bgBaseRuns.length; ri++) {
      const r = _bgBaseRuns[ri];
      if (r.shim) {
        // ★C13c 微光段缩放重发射（stride 11;rgba 同步缩=预乘恒等保持,aTile/aNoise
        //  原样拷贝——场属性与 α 无关;_fgReuseRing 判例同构禁原位缩放）
        const nF = r.quads * LIQ_SHIM_QUAD_FLOATS, src = r.start * LIQ_SHIM_QUAD_FLOATS;
        const S = _shimRing!, D = _fgReuseShimRing!;
        if (r.k === 1) {
          D.set(S.subarray(src, src + nF), src);
        } else {
          for (let i2 = 0; i2 < nF; i2 += LIQ_SHIM_STRIDE) {
            const o = src + i2;
            D[o] = S[o]; D[o + 1] = S[o + 1]; D[o + 2] = S[o + 2]; D[o + 3] = S[o + 3];
            D[o + 4] = S[o + 4] * r.k; D[o + 5] = S[o + 5] * r.k; D[o + 6] = S[o + 6] * r.k; D[o + 7] = S[o + 7] * r.k;
            D[o + 8] = S[o + 8]; D[o + 9] = S[o + 9]; D[o + 10] = S[o + 10];
          }
        }
        setLiqShimmerTVis(tVisPass);
        const dShim = D.subarray(src, src + nF);
        bat.emit(r.img, r.key, dShim, r.quads,
          (raw) => replayLiqShimRun2D(raw, r.start, r.quads, r.img));
        if (gateCapture) _fgRuns.push({ img: r.img, key: r.key, start: r.start, quads: r.quads, shim: true, data: dShim });
        continue;
      }
      const nF = r.quads * LIQ_QUAD_FLOATS, src = r.start * LIQ_QUAD_FLOATS;
      const S = _batRing, D = _fgReuseRing;
      if (r.k === 1) {
        D.set(S.subarray(src, src + nF), src);   // 逐位拷贝（sparkle 同 α 面同此;基底段 k<1）
      } else {
        for (let i2 = 0; i2 < nF; i2 += LIQ_STRIDE) {
          const o = src + i2;
          D[o] = S[o]; D[o + 1] = S[o + 1]; D[o + 2] = S[o + 2]; D[o + 3] = S[o + 3];
          D[o + 4] = S[o + 4] * r.k; D[o + 5] = S[o + 5] * r.k; D[o + 6] = S[o + 6] * r.k; D[o + 7] = S[o + 7] * r.k;
        }
      }
      const dSlice = D.subarray(src, src + nF);
      bat.emit(r.img, r.key, dSlice, r.quads,
        (raw) => replayLiqRun2D(raw, r.start, r.quads, r.img, r.cols, D));
      if (gateCapture) _fgRuns.push({ img: r.img, key: r.key, start: r.start, quads: r.quads, data: dSlice });
    }
    if (_bgSpark && bat.emitAdd) {
      const sp = _bgSpark;
      bat.emitAdd(sp.img, sp.key,
        _addRing.subarray(sp.start * LIQ_QUAD_FLOATS, (sp.start + sp.quads) * LIQ_QUAD_FLOATS),
        sp.quads, (raw) => replayLiqAddRun2D(raw, sp.start, sp.quads, sp.img, false));
    }
    if (_bgSparkShim && bat.emitAdd) {
      // ★三期 sparkle 亮纹段复用重发射（_bgSpark 同构;α 双 pass 同值=数据逐位原样,
      //  不走基底段的 k 缩放——SetShimmerVertexColors_Sparkle 无 isBackground 因子）
      const sp = _bgSparkShim;
      bat.emitAdd(sp.img, sp.key,
        _spShimRing!.subarray(sp.start * LIQ_SHIM_QUAD_FLOATS, (sp.start + sp.quads) * LIQ_SHIM_QUAD_FLOATS),
        sp.quads, (raw) => replayLiqSparkShimRun2D(raw, sp.start, sp.quads, sp.img));
    }
    if (_bgGlint && bat.emitAdd) {
      const gl = _bgGlint;
      const gimg = glintWhiteCv();
      bat.emitAdd(gimg, `liqglint:${texId(gimg)}`,
        _addRing.subarray(gl.start * LIQ_QUAD_FLOATS, (gl.start + gl.quads) * LIQ_QUAD_FLOATS),
        gl.quads, (raw) => replayLiqAddRun2D(raw, gl.start, gl.quads, gimg, true));
    }
    // 调试快照（主循环尾同字段;sheetsReady 复用臂不重建 texCache=空表）
    _liqDebug.calls++;
    _liqDebug.lastMs = nowMs;
    _liqDebug.waterStyle = waterStyle;
    _liqDebug.waterSheet = waterSheet(0, waterStyle);
    _liqDebug.isBackground = isBackground;
    _liqDebug.animFrame = animFrame;
    _liqDebug.waterfallFrame = waterfallFrame;
    _liqDebug.windSpeed = windSpeed;
    _liqDebug.window = [tx0, ty0, tx1, ty1];
    _liqDebug.sheetsReady = [];
    _liqDebug.atlasReady = true;
    ctx.globalAlpha = 1;
    return;
  }
  // ★liqp3① 行共享 LUT 预析（rowM 判例）:行 y 的设备折算 (y·16+f)·devSY+devTF
  //  每行一算——f 值域封闭（旗头注①）,全表调用前一次建（行不依赖 lx=列主序循环
  //  的序列外提）;列共享 colX 每列一算（下方 lx 循环头）。f64 承载（f32 破逐位）。
  if (p3) {
    if (_p3RowEy.length < ph * LIQ3_RC) _p3RowEy = new Float64Array(ph * LIQ3_RC);
    for (let ly2 = 0; ly2 < ph; ly2++) {
      const y16 = (py0 + ly2) * 16;
      const rb = ly2 * LIQ3_RC;
      for (let f = 0; f < LIQ3_RC; f++) _p3RowEy[rb + f] = (y16 + f) * devSY + devTF;
    }
  }
  for (let lx = bx0; lx <= bx1; lx++) {
    const x = px0 + lx;
    if (p3) {
      const x16 = x * 16;   // ★liqp3① 列共享:x 侧折算只依赖 (x·16+f) 封闭域
      for (let f = 0; f < LIQ3_RC; f++) _p3ColX[f] = (x16 + f) * devSX + devTE;
    }
    let ii = lx * ph + by0;   // ★liqp3② 增量下标载体（=at(lx,by0);off 臂弃用）
    for (let ly = by0; ly <= by1; ly++, ii++) {
      const y = py0 + ly;
      const i = p3 ? ii : at(lx, ly);
      if (!hasVisA[i]) continue;
      const vt = visTypeA[i];
      const tex = texFor(vt);
      if (!tex) continue;
      const n2 = Math.min(0.75, vlW[i]), n3 = Math.max(0.25, vrW[i]);
      const n4 = Math.min(0.75, vtW[i]);
      let n5 = Math.max(0.25, vbW[i]);
      // 半砖可视底边截到半格（LiquidRenderer.cs:382-383）
      if (isHalfA[i] && isSolidA[i] && n5 > 0.5) n5 = 0.5;
      // IsVisible（LiquidRenderer.cs:384）：半砖格自身有半液且无墙 → 不画（交给上格溢流）
      if (isHalfA[i] && hasLiquidA[i] && level[i] < 1 && !hasWallA[i]) continue;
      const sx = Math.floor(16 - n3 * 16) + fx[i];
      const sy = Math.floor(16 - n5 * 16) + fy[i];
      const sw = Math.ceil((n3 - n2) * 16), sh = Math.ceil((n5 - n4) * 16);
      const isSurface = fx[i] === 16 && fy[i] === 0 && y > groundLevel - 40;
      // 帧选择 1:1（DrawNormalLiquids :636-644）：中列（sx==16,下落柱/池体）走慢速瀑布帧。
      // ★微光除外（FX61 对拍补刀）：DrawShimmer :697-705 恒走 _animationFrame，
      // 无 X==16 瀑布中列分支——池体内部格曾误用慢速瀑布帧（16s/格 vs 风速驱动）
      const srcY = isSurface ? 1280 : sy + (vt !== 3 && sx === 16 ? waterfallFrame : animFrame) * 80;
      if (sw <= 0 || sh <= 0 || sx + sw > tex.width || srcY + sh > tex.height) continue;
      // ---- 水波位移（表层水线 bob；WaterWaves.ts 头部 Canvas2D 取舍登记）----
      let dstY = y * 16 + Math.floor(n4 * 16);
      let drawSh = sh;
      let waveSrcH = sh;   // 波动格的源窗高(钳带内容;目标高 drawSh 可拉伸)
      let yBob = false;    // ★liqp3:dstY 被波位移覆写位（ey0 走直算臂;off 臂不读）
      if (waveOn && hasTE[i]) {
        waterWaves.sampleDisplace(x * 16 + 8, y * 16 + 8, _wdisp);
        // ±16 世界 px 钳（原版 ±9.6 屏幕px 量级；防极端值撕裂水线）
        const dWy = Math.min(16, Math.max(-16, _wdisp[1] * waveInvZ));
        // ★位移矩形全整数化（2026-08-19 用户实报"波动时表层格与下层格之间一条
        //   明显的缝"）：光栅器在 imageSmoothing=off 下对浮点 dst 矩形的
        //   y 与 h 【分别取整】,round(y)+round(h) ≠ round(y+h)——表层格底边被
        //   snap 得与下层格顶边差 1px = 波动中闪烁的背景缝(强制 ±4px 分数位移
        //   复现实测 88 缝/125 列帧)。修:顶边取整(波 bob 量化到 1px)、底边
        //   恒等于波前整数底边 → 矩形全整,光栅器零 snap,与下层格逐像素重合
        const bottom = y * 16 + Math.floor(n4 * 16) + sh;   // 波前整数底边
        const topI = Math.round(dstY + dWy);
        dstY = topI;
        yBob = true;
        drawSh = bottom - topI;
        if (drawSh < 1) { continue; }
        // ★源高钳带内容(≤sh):波把四边形拉高(dWy<0)时源窗不得越过带尾
        //   透明 padding(表面静态带仅 16 行内容,1296 起全透明)——越界采样
        //   = 交界处 1-3px 透明行,背景透出即"波动时表层与下层之间明显的缝"
        //   (2026-08-19 强制 ±4px 分数位移复现 88 缝/125 列帧)。多出的目标
        //   高度以 ≤25% 纵向拉伸吸收:带内仅顶部 4px 有结构(亮线+过渡),
        //   4-15 为纯色体,拉伸不可感知
        waveSrcH = Math.min(drawSh, sh);
      }
      const dstX = x * 16 + Math.floor(n2 * 16);
      // ---- 微光（shimmer, vt=3）：DrawShimmer（LiquidRenderer.cs:682-730）----
      // 原版三步：①基底层 water_14 直画 + 逐顶点 GetShimmerBaseColor 波动蓝移（:745-759）
      // ②sparkle 层：源矩形 X+48（water_14 的第 4 列 16px 闪纹带）、Y+80×GetShimmerFrame
      // 16 帧动画，仅 flag（非内部/瀑布帧）或 (x+y)%2==0 的格子画（:720-729）
      // ③sparkle 顶点色 = GetShimmerGlitterColor 漂移彩虹 + 呼吸 alpha（:766-790）
      // ★liqgl 批路径：①=顶点色调制单 quad（机制=原版【节点值置位于 quad 角】的
      //   近亲:未裁剪格逐位同;裁剪格=场求值 vs 原版节点置位,偏差见
      //   shimmerCornerColors 注备案——★R2b-F5 2026-09-27 注释翻案）;
      //   CPU 原链保留 canvas multiply 2×2 子块近似（applyShimmerBaseTint）。
      if (vt === 3) {
        // ★2026-09-27 重钉（火苗速率案普查株连）：消费 visEffectFrames()（逐 tick
        //  计数器,stepVisEffectTick 每 fixedUpdate +1;C 批改型 2026-08-31 同判例
        //  同钟面）——渲染段内计数器不变,每 pass 取一次（原逐 tile 读同值）。
        //  ★liqpolish:tVis 在循环前已解析（tVisPass,波值缓存 stamp 用）——同值直用。
        const tVis = tVisCache < 0 ? (tVisCache = polish ? tVisPass : visEffectFrames()) : tVisCache;   // Main.timeForVisualEffects（帧计数,1458 Main.cs:17340）
        const flag = shimmerSparkleGate(sx, sy);               // :717（★FX61：曾误写 !(A||B)=∧，表层格彩虹条整缺）
        const wantSpark = flag || (x + y) % 2 === 0;
        // ★liqpolish 场单源（2026-09-29 微抛光刀）:四节点波值 bg 写/fg 读（跨 pass
        //  缓存;旧路径基色+glitter 各求 4 波=8 sin/格+分配 ~10/格,本核 bg 8 sin 零
        //  分配 / fg 0 sin）。波值只依赖 (x,y,tVis)=同帧双 pass 同值（缓存 stamp
        //  三键:帧 token+tVis+窗高）。top（=有干燥邻边的表层/边缘格）glitter 四角
        //  恒 0.5（旧函数首门同式）;body 复算均值——语义注同下旧支（:773-790）。
        let sparkGa = 0;
        let wv: Float64Array | null = null;
        let wo = 0;
        if (c13cOn) {
          // ★C13c 方案 H:噪声 4 sin CPU（aNoise 单源,sparkGa 共享同值）;波值 4 sin 仅
          //  flag=false 的 sparkle tile 需要（flag 表层 glitter 恒 0.5,基色场已上 GPU=
          //  基体 tile 8→4 sin）。位等论证:噪声/波值 sin 参数与 polish 臂逐字同式→
          //  f64 sin 确定性同值;glitter4FromWaves 复用=同代码路径（sparkGa 逐位同,
          //  单元锁 tests/liquid-c13c-shimmer-glsl.test.ts）。
          //  ★三期（2026-10-02）收窄:body 域（flag=false）的 sparkGa 均值退役为
          //  【纯发射门】（doSpark>0.02 判据,发射 tile 集不变）——亮纹 α 调制改 FS
          //  glitter(vTile,vNoise) 逐像素（sparkleShimQuad 顶点 α 只载 opacity）;
          //  top/edge 保留域 sparkGa=0.5 照旧为 α 载体（ADD 段）。CPU sin 计数不变。
          _shimNs[0] = Math.sin(shimmerWhiteNoise(x, y) / 10 + tVis / 180);
          _shimNs[1] = Math.sin(shimmerWhiteNoise(x + 1, y) / 10 + tVis / 180);
          _shimNs[2] = Math.sin(shimmerWhiteNoise(x, y + 1) / 10 + tVis / 180);
          _shimNs[3] = Math.sin(shimmerWhiteNoise(x + 1, y + 1) / 10 + tVis / 180);
          if (wantSpark) {
            if (flag) sparkGa = 0.5;
            else {
              _shimWv[0] = shimmerWave(x, y, tVis);
              _shimWv[1] = shimmerWave(x + 1, y, tVis);
              _shimWv[2] = shimmerWave(x, y + 1, tVis);
              _shimWv[3] = shimmerWave(x + 1, y + 1, tVis);
              _shimWv[4] = _shimNs[0]; _shimWv[5] = _shimNs[1];
              _shimWv[6] = _shimNs[2]; _shimWv[7] = _shimNs[3];
              glitter4FromWaves(_shimWv, 0, _glit4);
              sparkGa = (_glit4[0] + _glit4[1] + _glit4[2] + _glit4[3]) * 0.25;
            }
          }
        } else if (polish) {
          if (wvRead) { wv = wvRead; wo = i * 8; }
          else if (wvWrite) { wo = i * 8; shimmerWaves4(x, y, tVis, wvWrite, wo); wv = wvWrite; }
          else { shimmerWaves4(x, y, tVis, _wvLocal, 0); wv = _wvLocal; }
          if (wantSpark) {
            if (flag) sparkGa = 0.5;
            else {
              glitter4FromWaves(wv, wo, _glit4);
              sparkGa = (_glit4[0] + _glit4[1] + _glit4[2] + _glit4[3]) * 0.25;
            }
          }
        } else {
          // alpha = 像素亮度（tintSparkleBand 已把灰度写进 alpha）× 四角
          // GetShimmerGlitterOpacity 均值。四角均值与原版逐顶点双线性插值的面积均值
          // 数值等价（全网格采样验证平均差 0.0000），top（=有干燥邻边的表层/边缘格，
          // :719 flag=true）四角恒 0.5；body（全浸没 (sx,sy)=(16,48) 内部格）复算
          // 均值 0.09 / 峰值 0.34 → 星点恒为极淡彩虹（近白微闪）。注意 sparkle 不乘
          // 前景 0.75/背景 1 系数——SetShimmerVertexColors_Sparkle :732-743 直接
          // ×= ptr->Opacity
          sparkGa = wantSpark ? (shimmerGlitterOpacity(flag, x, y, tVis)
            + shimmerGlitterOpacity(flag, x + 1, y, tVis)
            + shimmerGlitterOpacity(flag, x, y + 1, tVis)
            + shimmerGlitterOpacity(flag, x + 1, y + 1, tVis)) * 0.25 : 0;  // :773-790
        }
        const doSpark = wantSpark && sparkGa > 0.02;
        let batched = false;
        if (batOn && c13cOn) {
          // ★C13c stride-11 微光 quad（方案 H）:主环开放段先收口（层序——微光前的水
          //  quad 恒先发射;runImg=null=段后主环重开新段,[水][微光][水'] 分段结构与
          //  现行逐纹理分段同构）;uTVis 单点写入（发射点=渲染段内,visEffectFrames
          //  不变判例）。aTile=世界px/16 逐角（bob 后 dstY——场采样随液面 bob 同现行
          //  CPU vT/vB 域）;rgb 预乘恒等（gaT）,场调制全部 FS 内逐像素解析。
          flushRun();
          runImg = null;
          if (_shimOn && _shimImg !== tex) flushShimRun();
          if (!_shimOn) { _shimOn = true; _shimStart = _shimN; _shimImg = tex; _shimKey = `liqshim:${texId(tex)}`; }
          setLiqShimmerTVis(tVis);
          const gaT = Math.min(1, opacity[i] * (isBackground ? 1 : 0.75));
          const sex0 = dstX * devSX + devTE, sey0 = dstY * devSY + devTF;
          const sex1 = (dstX + sw) * devSX + devTE, sey1 = (dstY + drawSh) * devSY + devTF;
          if (shimQuad(sx, srcY, sw, waveSrcH, tex.width, tex.height,
            dstX, dstY, sw, drawSh, sex0, sey0, sex1 - sex0, sey1 - sey0, gaT, _shimNs)) {
            batched = true;
          } else {
            batOn = false;             // 微光环帽:批段收口,本 tile 落 CPU 原链
            flushShimRun();
            if (polish) flushAddRuns2DAndEmit(ctx, bat!, isBackground);   // 基底先于 ADD 段（重叠序）
          }
        } else if (batOn) {
          // ★liqgl 刀2：基底层+波色 = 【顶点色调制单 quad】——原版
          //  SetShimmerVertexColors（LiquidRenderer.cs:745-759）SpriteBatch modulate：
          //  out = tex.premul × baseColor × opacity,GPU 顶点插值≈原版逐顶点插值。
          //  ★R2b-F5（2026-09-27 注释翻案）:原版机制=节点值置位于 quad 角,非场求值;
          //  未裁剪格=逐位同,裁剪格两式差 max 3.92/255（census 备案域内,量级见
          //  shimmerCornerColors 注）;两三角对角线（TL-BR vs XNA TR-BL）亚 LSB 差。
          //  applyShimmerBaseTint 的 canvas multiply 2×2 子块近似在本路径
          //  退役（CPU 原链保留=?liqgl=0 逃生门;语义差=canvas multiply 半透明 dst
          //  补正项 color×(1−αdst)——原版无此项=批化支更贴原版,census 有界登记）。
          if (runImg !== tex) { flushRun(); runImg = tex; runKey = `liq:${texId(tex)}`; runVt = vt; }
          const gaT = Math.min(1, opacity[i] * (isBackground ? 1 : 0.75));
          // 裁剪角 (u,v)（tile 内归一）——双线性张量在裁剪角求值（原版=节点值置位,
          // 两式仅未裁剪时相等;偏差备案见 shimmerCornerColors 注）
          const uL = (dstX - x * 16) / 16, uR = (dstX + sw - x * 16) / 16;
          const vT = (dstY - y * 16) / 16, vB = (dstY + drawSh - y * 16) / 16;
          if (polish && wv) shimmerCornersFromWaves(wv, wo, uL, uR, vT, vB, _batCols, 0);
          else shimmerCornerColors(x, y, tVis, uL, uR, vT, vB, _batCols, 0);
          const sex0 = dstX * devSX + devTE, sey0 = dstY * devSY + devTF;
          const sex1 = (dstX + sw) * devSX + devTE, sey1 = (dstY + drawSh) * devSY + devTF;
          if (batQuad(sx, srcY, sw, waveSrcH, tex.width, tex.height,
            sex0, sey0, sex1 - sex0, sey1 - sey0, gaT, _batCols, 0)) {
            batched = true;
            runCols = true;
            // sparkle=ADD,须在基底层批段之后（层序）。★liqpolish 批化支延后收口
            // （ADD 环累积,pass 尾 flushAddRuns2DAndEmit——全基底段先于 ADD 段=
            // 重叠序 all-bases-before-adds,非重叠面 ADD 可交换）;CPU 支照旧立即收口。
            if (doSpark && !polish) flushRun();
          } else {
            batOn = false;             // 帽溢出:批段收尾,本 tile 落 CPU 原链
            flushRun();
            if (polish) flushAddRuns2DAndEmit(ctx, bat!, isBackground);   // 基底先于 ADD 段入队（重叠序）
          }
        }
        if (!batched) {
          // 微光分支以 x*16 为参照（applyShimmerBaseTint 的 u/v 归一化）→ 恢复世界
          // 变换按世界像素绘制（微光液稀疏，逐 tile 切换开销可忽略）
          ctx.setTransform(wldT);
          ctx.globalAlpha = Math.min(1, opacity[i] * (isBackground ? 1 : 0.75));
          ctx.drawImage(tex, sx, srcY, sw, waveSrcH, dstX, dstY, sw, drawSh);
          if (sw >= 8) applyShimmerBaseTint(ctx, x, y, dstX, dstY, sw, drawSh, tVis);
        }
        if (doSpark) {
          // ★三期（2026-10-02）body 域分流+★四期修正（2026-10-07 果冻感回归定谳）:
          //  c13cOn ∧ flag=false（满格内部态）亮纹透明度=uSpark=1 段顶点插值域
          //  （四角 glitter 终值经 aNoise 槽上传,FS 消费硬件 varying=原版
          //  SetShimmerVertexColors_Sparkle 顶点色插值 1:1;旧 FS 内 remap 链逐像素=
          //  插值后钳制,角噪声异号格 E[max(Σw·n,0)]<Σw·E[max(n,0)] 系统性变暗+折痕
          //  高频化=用户实报「果冻感/下水波动变小」物理面）
          //  ——sparkGa 四角均值在本域退役为【纯发射门】（doSpark 判据不变=发射 tile 集
          //  不变,顶点 α 只载 opacity）。保留域（不迁移,§0/§2.6）:flag=true 表层/边缘
          //  常驻域（原版 glitter≡0.5,均值即精确值）+色相 16 档量化/帧带选择（顶点色/
          //  源矩形承载）+CPU 原链（?c13c=0/?liqpolish=0）照旧。
          let sparkCpu = true;
          if (c13cOn && !flag && batOn && !_addOverflow) {
            const gaO = Math.min(1, opacity[i]);
            if (gaO > 0) {
              const fr = shimmerFrame(flag, x, y, tVis);       // :791-801（帧带 CPU 不迁移）
              // :716 sparkle 源矩形=原始 SourceRectangle+X+48/Y+80×fr（直算内联,
              //  表达式逐字同 shimmerSparkleSource 本体;源仍按原始 sy 取带）
              const sSrcX = sx + 48, sSrcY = sy + 80 * fr;
              if (sSrcX + sw <= tex.width && sSrcY + sh <= tex.height) {
                const band = shimmerSparkBand(tex);
                if (band) {
                  // ★亮纹段=ADD 环族 pass 尾统一收口（flushAddRuns2DAndEmit;与 _sp 段
                  //  同收口位=全基底段先于 ADD 段重叠序保持,逐 tile 勿收口——碎段病判例）
                  if (!_spShimOn) { _spShimOn = true; _spShimStart = _spShimN; _spShimQuads = 0; _spShimImg = band; _spShimKey = `liqspark:${texId(band)}`; }
                  const hue = shimmerGlitterHue(x, y, tVis);   // :768 彩虹相位（纯函数单源）
                  const hueIdx = ((Math.floor(hue * SPARKLE_HUE_STEPS) % SPARKLE_HUE_STEPS)
                    + SPARKLE_HUE_STEPS) % SPARKLE_HUE_STEPS;
                  // uTVis 段级单点（基体支本 tile 已写同值;此处防御性保单点契约）
                  setLiqShimmerTVis(tVis);
                  // ★四期修正（2026-10-07）:_glit4=四角 glitter 终值（本支 wantSpark∧!flag
                  //  域恰已求值）——aNoise 槽载终值,FS 消费硬件 varying 插值=原版
                  //  SetShimmerVertexColors_Sparkle 顶点色插值 1:1（旧 _shimNs 噪声 sin
                  //  上传+FS 内 remap 链=插值后钳制,系统性变暗定谳面）
                  if (sparkleShimQuad(sx, sSrcY, sw, sh, band.width, band.height,
                    dstX, dstY, sw, sh, dstX * devSX + devTE, dstY * devSY + devTF,
                    sw * devSX, sh * devSY, gaO, _glit4, sparkHueRGB(), hueIdx * 3)) {
                    _spShimQuads++;
                    sparkCpu = false;
                  }
                  // 溢出=false→sparkCpu（sparkleShimQuad 已置 _addOverflow=ADD 环族语义）
                }
              }
            } else {
              sparkCpu = false;   // gaO=0 = 无贡献（旧 α=0 drawImage 等价跳过）
            }
          } else if (polish && batOn && !_addOverflow) {
            // ★liqpolish:sparkle 批化（单白度带 RGB=255/A=亮度+色相进顶点色;全 pass
            //  一段单 drawArrays——旧逐 tile shim rec（save/gco/globalAlpha/drawImage/
            //  restore+resolveTex texAlive）退役）。像素式:GL out=(L·(R8/255·ga),
            //  L·ga) ≙ 2D lighter premul(R8·L/255)·ga（±1LSB f32 域,census 登记）。
            //  ★三期域注:本支=保留域（top/edge 常驻+非 c13c 臂全量）;c13c body 域已
            //  分流上支（均值 α→FS 逐像素）。
            const gaS = Math.min(1, opacity[i] * sparkGa);
            if (gaS > 0) {
              const fr = shimmerFrame(flag, x, y, tVis);       // :791-801
              // :716 sparkle 源矩形=原始 SourceRectangle+X+48/Y+80×fr（表面格基底
              //  层虽切 Y=1280,sparkle 仍按原始 sy 取带——shimmerSparkleSource 注）。
              //  ★liqpolish:直算内联（shimmerSparkleSource 每格元组分配退役;
              //  表达式逐字同 shimmerSparkleSource 本体）
              const sSrcX = sx + 48, sSrcY = sy + 80 * fr;
              if (sSrcX + sw <= tex.width && sSrcY + sh <= tex.height) {
                const band = shimmerSparkBand(tex);
                if (band) {
                  // ★ADD 环与基底环分离+pass 尾统一收口（flushAddRuns2DAndEmit 在
                  //  flushRun 之后调用）=队列序 [全基底段][ADD 段]——base(k)<add(k)
                  //  重叠序由收口序保证,【逐 tile 勿 flushRun】（曾逐 sparkle 收口=
                  //  基底批碎成 ~1-3 quad/段×420 段/帧,每段 bufferData+drawArrays+
                  //  texFromImage 全税——计数实证 _liqpolish-ab 计数支 addN/baseN）。
                  if (!_spOn) { _spOn = true; _spStart = _addN; _spQuads = 0; _spImg = band; _spKey = `liqspark:${texId(band)}`; }
                  const hue = shimmerGlitterHue(x, y, tVis);   // :768 彩虹相位（纯函数单源）
                  const hueIdx = ((Math.floor(hue * SPARKLE_HUE_STEPS) % SPARKLE_HUE_STEPS)
                    + SPARKLE_HUE_STEPS) % SPARKLE_HUE_STEPS;
                  const hb = sparkHueRGB();
                  _spCols[0] = hb[hueIdx * 3]; _spCols[1] = hb[hueIdx * 3 + 1]; _spCols[2] = hb[hueIdx * 3 + 2];
                  _spCols[3] = _spCols[0]; _spCols[4] = _spCols[1]; _spCols[5] = _spCols[2];
                  _spCols[6] = _spCols[0]; _spCols[7] = _spCols[1]; _spCols[8] = _spCols[2];
                  _spCols[9] = _spCols[0]; _spCols[10] = _spCols[1]; _spCols[11] = _spCols[2];
                  if (batQuadAdd(sSrcX - 48, sSrcY, sw, sh, band.width, band.height,
                    dstX * devSX + devTE, dstY * devSY + devTF, sw * devSX, sh * devSY,
                    gaS, _spCols, 0)) {
                    _spQuads++;
                    sparkCpu = false;
                  }
                }
              }
            } else {
              sparkCpu = false;   // gaS=0 = 无贡献（旧 α=0 drawImage 等价跳过）
            }
          }
          if (sparkCpu) {
            if (polish && batched) flushRun();   // shim rec 须在基底段后（polish 延后收口序）
            if (batched) ctx.setTransform(wldT);
            // :716 sparkle 前把 sourceRectangle 重置回原始 SourceRectangle 再加偏移——
            // 表面格的基底层虽强制切 Y=1280（:700），但 sparkle 的 Y 用的是原始 sy+80*fr
            // （shimmerSparkleSource）。旧实现误用 1280+80*fr：表面格 sparkle 几乎全部
            // 越界被跳过（=表层"彩虹条"消失），仅 fr=0 时命中 Y=1280 的黑底块反而画出黑斑。
            const fr = shimmerFrame(flag, x, y, tVis);         // :791-801
            const [sSrcX, sSrcY] = shimmerSparkleSource(sx, sy, fr);
            if (sSrcX + sw <= tex.width && sSrcY + sh <= tex.height) {
              const hue = shimmerGlitterHue(x, y, tVis);       // :768 彩虹相位（纯函数单源）
              const hueIdx = ((Math.floor(hue * SPARKLE_HUE_STEPS) % SPARKLE_HUE_STEPS)
                + SPARKLE_HUE_STEPS) % SPARKLE_HUE_STEPS;
              const spark = shimmerSparkleTint(tex, hueIdx);   // 染色带；null 则退回原图（无彩虹）
              ctx.save();
              // 原版 sparkle pass 是【加色叠加】非 source-over：GetShimmerGlitterColor
              // :766-771 先 color.A=0 再 vector4×glitter → 顶点 alpha 恒 0、RGB 已预乘
              // glitter 强度；tileBatch = SpriteBatch 默认 AlphaBlend（预乘 (One,
              // InvSrcAlpha)，TileBatch.Begin :216）→ 最终像素 = 基底 + 灰度纹素×彩虹×
              // glitter×tileOpacity，黑底纹素贡献恰为 0、基色不被替换。旧实现 source-over
              // 以饱和彩虹【替换】基色（dst×(1-a)+彩虹×a）→ body 星点呈高可见度彩色块
              // （用户实测"闪光点变成彩色的"），改 'lighter' 后 body 星点 = 基底上微弱
              // 增亮的近白微闪、表面白基底上呈漂移彩虹条（与原版一致）。
              ctx.globalCompositeOperation = 'lighter';
              ctx.globalAlpha = Math.min(1, opacity[i] * sparkGa);
              ctx.drawImage(spark ?? tex, sSrcX + (spark ? -48 : 0), sSrcY, sw, sh,
                dstX, dstY, sw, sh);
              ctx.restore();
            }
            if (batched) ctx.setTransform(1, 0, 0, 1, 0, 0);
          }
        }
        if (!batched) ctx.setTransform(1, 0, 0, 1, 0, 0);   // 回身份变换（设备像素主循环）
        continue;
      }
      // ★C13c:微光段开放时先收口（非微光 tile 任何批发射/CPU 直画都排其后=层序;
      //  batOn 已断时 CPU 直画同样需要——shim rec 队列序=2D 流序,flushBandRun 判例同式）
      if (c13cOn) flushShimRun();
      // 双 pass（Main.cs DrawWaters(true/false) + LiquidRenderer.InternalDraw）：
      // 背景 pass 不透明（露出方块透明像素 = 浸润）；前景 pass 水 0.6 半透明质感
      // ★设备矩形共享边 ceil 分区（见循环前块注）：不重不漏，分数 zoom 零缝
      // ★liqp3①:ex/ey 走列/行共享 LUT——LUT 条目=与逐格式同表达式同操作数（构造
      //  即证逐位,论证见旗头注）;ey1 恒 LUT（bob 情形 dstY+drawSh 整数精确恒等
      //  bottom=y·16+f4+sh）,bob 的 ey0 保直算臂;off 臂逐字原式。
      let ex0: number, ex1: number, ey0: number, ey1: number;
      if (p3) {
        const f2 = Math.floor(n2 * 16), f4 = Math.floor(n4 * 16);
        ex0 = _p3ColX[f2]; ex1 = _p3ColX[f2 + sw];
        ey0 = yBob ? dstY * devSY + devTF : _p3RowEy[ly * LIQ3_RC + f4];
        ey1 = _p3RowEy[ly * LIQ3_RC + f4 + sh];
      } else {
        ex0 = dstX * devSX + devTE; ex1 = (dstX + sw) * devSX + devTE;
        ey0 = dstY * devSY + devTF; ey1 = (dstY + drawSh) * devSY + devTF;
      }
      const dx0 = hasVisA[p3 ? i - ph : at(lx - 1, ly)] ? Math.ceil(ex0) : Math.floor(ex0);
      const dy0 = hasVisA[p3 ? i - 1 : at(lx, ly - 1)] ? Math.ceil(ey0) : Math.floor(ey0);
      const dw = Math.ceil(ex1) - dx0, dh = Math.ceil(ey1) - dy0;
      if (dw <= 0 || dh <= 0) continue;
      // 波光 tint（FilterWaterDistortion :106-111；仅表层 + 前景 pass，阈值 0.03 跳弱波）。
      // ★warpMode 下仍画（进离屏随位移场整体扭动——原版 glint 加在全屏 pass 输出上，
      //   位置与波前水线一致）；波光仅 q>0 门，不受 warpMode 关闭影响。
      //   采样前置（批化分支也要做 doGlint 判削;sampleGlint 纯采样无副作用）
      //   ★liqpolish:glint bg 记录臂——sampleGlint 帧内确定,bg pass 采样入 ADD 环
      //   （bg 不画=旧 bg 本就无 glint,记录不改 bg 像素）,fg 复用臂整段重发射
      //   （fg 逐列采样+逐列 flushRun 切段退役）。
      const glintOn = waterWaves.quality > 0 && !isBackground && hasTE[i];
      const glintRec = polish && isBackground && batOn && !_addOverflow
        && waterWaves.quality > 0 && hasTE[i];
      const glV = (glintOn || glintRec) ? waterWaves.sampleGlint(x * 16 + 8, y * 16 + 8, lumAt?.(x, y) ?? 0.75) : 0;
      const doGlint = glintOn && glV > 0.03;
      let batched = false;
      if (batOn) {
        if (runImg !== tex) { flushRun(); runImg = tex; runKey = `liq:${texId(tex)}`; runVt = vt; }
        if (batQuad(sx, srcY, sw, waveSrcH, tex.width, tex.height, dx0, dy0, dw, dh,
          // ★BJ705-G26 件3:岩浆 ×lavaOpacity（LiquidRenderer.cs:659 case 1,bg/fg 同乘,Min 后置）
          Math.min(1, opacity[i] * (isBackground ? 1 : (DEFAULT_OPACITY[vt] ?? 0.6)) * (vt === 1 ? lavaOpacity : 1)), null, 0)) {
          batched = true;
          // glint=ADD quad,须在本 tile 批段之后（层序）。★liqpolish 批化支延后收口
          // （ADD 环累积,pass 尾 flushAddRuns2DAndEmit——全基底段先于 ADD 段=重叠序:
          //   glint(k) 域 ⊆ 本格∪上格,上格基底恒先画）;旧/CPU 支照旧立即收口。
          if (doGlint && !polish) flushRun();
        } else {
          batOn = false;             // 帽溢出:批段收尾,本 tile 落 CPU 原链
          flushRun();
          if (polish) flushAddRuns2DAndEmit(ctx, bat!, isBackground);   // 基底先于 ADD 段入队（重叠序）
        }
      }
      if (!batched) {
        // ★BJ705-G26 件3:岩浆 ×lavaOpacity（同批化支式,CPU 原链面）
        ctx.globalAlpha = Math.min(1, opacity[i] * (isBackground ? 1 : (DEFAULT_OPACITY[vt] ?? 0.6)) * (vt === 1 ? lavaOpacity : 1));
        ctx.drawImage(tex, sx, srcY, sw, waveSrcH, dx0, dy0, dw, dh);
      }
      if (doGlint) {
        // ★liqpolish:glint 批化（白 1×1 ADD quad——旧逐列 flushRun 把基底批切成
        //  逐列段+fillRect solid rec 退役;像素式 out=(ga,ga,ga,ga) ≙ fillRect 白
        //  'lighter' globalAlpha=ga 逐位同式）。ga≤0 跳过=旧 α=0 fillRect 等价。
        let glintCpu = true;
        if (polish && batOn && !_addOverflow) {
          const gaG = Math.min(1, glV * opacity[i] * (DEFAULT_OPACITY[vt] ?? 0.6) * (vt === 1 ? lavaOpacity : 1));   // ★G26 件3:岩浆渐隐同乘
          if (gaG > 0) {
            if (!_glOn) { _glOn = true; _glStart = _addN; _glQuads = 0; }
            if (batQuadAdd(0, 0, 1, 1, 1, 1, dx0, dy0, dw, dh, gaG, null, 0)) {
              _glQuads++;
              glintCpu = false;
            }
          } else {
            glintCpu = false;
          }
        }
        if (glintCpu) {
          if (polish && batched) flushRun();   // shim solid rec 须在基底段后（polish 延后收口序）
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = Math.min(1, glV * opacity[i] * (DEFAULT_OPACITY[vt] ?? 0.6) * (vt === 1 ? lavaOpacity : 1));   // ★G26 件3
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(dx0, dy0, dw, dh);
          ctx.globalCompositeOperation = 'source-over';
        }
      } else if (glintRec && glV > 0.03) {
        // ★liqpolish bg glint 记录（fg 复用重发射;ga 公式=fg 支逐字同式）
        const gaG = Math.min(1, glV * opacity[i] * (DEFAULT_OPACITY[vt] ?? 0.6) * (vt === 1 ? lavaOpacity : 1));   // ★G26 件3:岩浆渐隐同乘（fg 复用重发射同式）
        if (gaG > 0) {
          if (!_glOn) { _glOn = true; _glStart = _addN; _glQuads = 0; }
          if (batQuadAdd(0, 0, 1, 1, 1, 1, dx0, dy0, dw, dh, gaG, null, 0)) _glQuads++;
        }
      }
    }
  }
  flushRun();                 // ★liqgl:主循环批段收尾（后随坡面增强/浸润带仍 ctx 直绘）
  if (c13cOn) flushShimRun();   // ★C13c:微光段收尾（带 pass 前收口=两环域不相交,共用段状态）
  // ★liqpolish:ADD 段收尾（sparkle/glint;必须在基底段之后——重叠序契约）
  if (polish) flushAddRuns2DAndEmit(ctx, bat ?? null, isBackground);
  ctx.setTransform(wldT);   // 恢复世界变换（坡面增强/浸润带仍世界坐标）

  // ---- 斜面格水体覆盖增强（2026-08-21 用户定案"做得更好"）----
  // 原版：斜面格实心无液 → 不画前景水 → 角色站斜面上时身体与斜切三角区重叠的
  // 部分无水色罩。用户定案增强：邻水的斜面格画水色覆盖。形状 = LiquidSlope 斜面表。
  // ★仅背景 pass（isBackground=true）绘制——层级实证 TileDrawing.cs:526-529：
  //   原版坡面浸润走 tileBatch.SetLayer(Layer_LiquidBehindTiles)，恒在 Layer_Tiles
  //   方块层【之下】。曾双 pass 同画：前景份画在方块贴图之上，斜边 AA 像素被水色
  //   盖出"边界盖在斜方块上层"（用户实报）。且背景份不透明 1.0 已定终色——相邻
  //   水体=不透明背景层+前景 0.6 叠加，同色叠同色无色变，单份背景层即与水体
  //   终色一致，无需第二份。
  // ★斜面表按邻液类型选（2026-09-03 用户实报"岩浆的斜坡方块透明区域没做浸润渲染
  //   露馅,水不会,参考水的做法在岩浆也做"）：旧实现恒用群系水色表
  //   LiquidSlope_${waterStyle}——浸润带缺席的坡面格（如下方浅液 Dq≤240、slope4/3
  //   边角门等,增强无这些门）会被盖成【水色】浸润 = 岩浆岸露馅。改按【开放侧最高
  //   液位邻格】的液体类型选表,与浸润带 num10 选择同语义(:3940-3965 严格大于,
  //   L→R→U→D 序)：岩浆→LiquidSlope_1、蜂蜜→11、微光→14、水→群系水色
  //   （liquidSlopeSheet 同名映射,平/斜两表共用一套文件）。
  if (isBackground) {
    const slopeTexForType = (vt: number): HTMLImageElement | null =>
      getSlopeTex(vt === 2 ? 1 : vt === 3 ? 11 : vt === 4 ? 14 : waterStyle);
    // ---- ★C13b 斜面增强批臂（LiquidSlope 覆盖 quad;2026-09-30）----
    //  形态=轴对齐纹理 quad（LiquidSlope_{sheet} 16×16 单元,斜切=源矩形列选择）,
    //  折顶点入基底环（软溢出域;发射位=本段 flush 位=层序保持——本段整体先于浸润带
    //  pass,flushSlopeRun 在带 pass 入环前收口=两段环域不相交）。设备折算复用主循环
    //  devSX/devSY/devTE/devTF（同一 wldT——:1443 捕获、:1867 恢复,段内未变）。
    const slopeBatOn = liqC13b && bat != null && frameToken !== undefined
      && !_batOverflow && !_batSoftOvf && wldT.b === 0 && wldT.c === 0;
    let slStart = _batN;
    let slImg: CanvasImageSource | null = null;
    let slKey = '';
    const flushSlopeRun = (): void => {
      const quads = _batN - slStart;
      if (quads <= 0 || !slImg || !bat) return;
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      const img = slImg, s0 = slStart, nQ = quads, k = slKey;
      const ok = bat.emit(img, k, _batRing.subarray(s0 * LIQ_QUAD_FLOATS, _batN * LIQ_QUAD_FLOATS), nQ,
        (raw) => replayLiqRun2D(raw, s0, nQ, img, false));
      if (!ok) replayLiqRun2D(ctx, s0, nQ, img, false);   // 入口门拒=2D 原位重放（flushBandRun 同式）
      slStart = _batN;
      slImg = null;
    };
    for (let lx = PAD; lx < pw - PAD; lx++) {
      const x = px0 + lx;
      for (let ly = PAD; ly < ph - PAD; ly++) {
        const y = py0 + ly;
        if (x < 0 || y < 0 || x >= st.w || y >= st.h) continue;   // st.idx 直读守卫
        const i = p3 ? lx * ph + ly : at(lx, ly);   // ★liqp3②
        if (!isSolidA[i] || hasLiquidA[i]) continue;
        // ★st.slope 是 store 下标——此处 i 是局部 padding 网格下标(at(lx,ly)),
        //   直喂会错位读数 → slope 恒落在 1-4 之外 → 整块静默跳过(2026-08-21
        //   用户三轮"仍然失效"的最终根因;前两轮修的是 groundLevel 门与贴图加载)
        const slope = st.slope[st.idx(x, y)];
        if (slope < 1 || slope > 4) continue;
        // ★液面裁剪(2026-08-21 用户标注"氙奇葩"(242,231) slope2 壳堆×61%水位):
        //   整格三角会把水画到液面之上(水爬坡)。原版浸润带按液位算液面下沉
        //   num6=⌊(256-液位)/32⌋×2(TileDrawing.cs:4096),斜面表与平面带共用同一
        //   源矩形(:4539 Y 复用 liquidSize)→ 只画液面以下的行,水线在切口内
        //   保持水平、与邻格水面齐平。液位取坡面【开放侧】邻格最高值——固体背侧
        //   的邻水不计(:3967-4028 slope 门同语义),否则水沿背侧斜边凭空出现
        const liqAt = (dx: number, dy: number): { amt: number; vt: number } | null => {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= st.w || ny >= st.h) return null;
          const ni = st.idx(nx, ny);
          return { amt: st.liquid[ni], vt: st.liquidType[ni] || 1 };
        };
        let openLq = 0, openVt = 1;
        const take = (c: { amt: number; vt: number } | null): void => {
          if (c && c.amt > openLq) { openLq = c.amt; openVt = c.vt; }   // 严格大于=L,R,U,D 序平手取先(同浸润带)
        };
        // ★BJ307（2026-09-23 用户实报"临近水面的斜坡渲染异常,海面线处斜坡格多出
        //   水色块 #083DBF"定谳）：增强谓词曾缺原版浸润带两道门,把原版刻意不画的
        //   坡面格画了整格水（物证 Starter World (6155,314)=273 slope3、(6170,314)
        //   =272 slope4,下邻海面表层格液位恒 238≤240,debug-report tiles.areaCamera
        //   enc 行解码实证）：
        //   ①下方旗 >240 门（TileDrawing.cs:4023-4026 flag4）：下邻液位 ≤240 不置旗
        //     → :4044 五旗全空 return = 原版不画。海面表层 93% 液位正落此门。
        //   ②slope3/4 悬空门（:4141-4148 → num15=0 整带不画）：slope4 左邻无液且
        //     不实 / slope3 右邻同 → 坡面背侧无支撑,水不爬背侧斜边。浸润带移植段
        //     （本文件 drawLiquidBehindTilesOnly ★坡面边角门注）已 1:1,唯增强缺。
        //   两门补齐后增强触发集 ≡ 浸润带触发集（坡面格）,不再超原版"水爬坡"。
        take(slope === 1 || slope === 3 ? null : liqAt(-1, 0));
        take(slope === 2 || slope === 4 ? null : liqAt(1, 0));
        take(slope === 3 || slope === 4 ? null : liqAt(0, -1));
        const dCell = slope === 1 || slope === 2 ? null : liqAt(0, 1);
        take(dCell && dCell.amt > 240 ? dCell : null);   // ★BJ307 门①(:4023-4026 flag4)
        // ★BJ307 门②(:4141-4148 num15=0；与浸润带 slope 边角门同式)。★BJ308:原版
        //   谓词=WorldGen.SolidTile 全式（:70642 实例面 !halfBrick∧slope==0 三排除
        //  ——solidTop 支已折 SOLID_LUT）,曾以宽谓词 isSolid 充数 → 邻格半砖/坡面
        //   格误判实心,门②少触发=坡面多画。两处（本段+浸润带 :4141 移植段）同修。
        if (slope === 4 && (liqAt(-1, 0)?.amt ?? 0) === 0 && !st.isSolidStrict(x - 1, y)) continue;
        if (slope === 3 && (liqAt(1, 0)?.amt ?? 0) === 0 && !st.isSolidStrict(x + 1, y)) continue;
        if (openLq <= 0) continue;
        const slopeTex = slopeTexForType(openVt);
        if (!slopeTex || slopeTex.width <= 0) continue;   // 懒加载未就绪跳帧,下帧自愈
        const num6 = Math.floor((256 - openLq) / 32) * 2;
        const sh = 16 - num6;
        if (sh <= 0) continue;
        const sx = 18 * (slope - 1);
        // ★IIIII251（?slopewave=1 CPU 路）：斜面覆盖随波场垂直位移——与浸润带同
        //  采样点（格中心）/同一 ±16 世界 px 钳,刚性整移保持斜切水线形状
        let dy251 = 0;
        if (slopeWaveBob) {
          waterWaves.sampleDisplace(x * 16 + 8, y * 16 + 8, _slopeDisp251);
          dy251 = Math.round(Math.min(16, Math.max(-16, _slopeDisp251[1]
            / Math.max(1e-6, waterWaves.viewZoom()))));
        }
        // ★C13b 批臂:单 quad 入环（a=1 不透明——溢出后 CPU 重画幂等,同微光带判例）;
        //  软域（soft=true）——帽触发只降本臂,不触 gate/复用降级面。
        let slopeBatched = false;
        if (slopeBatOn && _batN < LIQ_RING_CAP) {
          if (slImg !== slopeTex) { flushSlopeRun(); slImg = slopeTex; slKey = `liqslack:${texId(slopeTex)}`; }
          slopeBatched = batQuad(sx, num6, 16, sh, slopeTex.width, slopeTex.height,
            (x * 16) * devSX + devTE, (y * 16 + num6 + dy251) * devSY + devTF,
            16 * devSX, sh * devSY, 1, null, 0, true);
          if (!slopeBatched) { flushSlopeRun(); slImg = null; }   // 帽触发:段收口,本 tile CPU 重画（幂等）
        }
        if (!slopeBatched) {
          ctx.globalAlpha = 1;   // 背景层不透明（前景 0.6 份已撤，见块头注释）
          ctx.drawImage(slopeTex, sx, num6, 16, sh, x * 16, y * 16 + num6 + dy251, 16, sh);
        }
      }
    }
    if (slopeBatOn) flushSlopeRun();   // ★C13b:段收口（先于浸润带 pass——环域不相交）
    ctx.globalAlpha = 1;
  }

  // ---- 浸润 pass：DrawTile_LiquidBehindTile(TileDrawing.cs:3859-4193) ----
  // 对每个【实心方块格】，检查四邻是否有液体 → 在方块格内画一条液体带
  // （背景 pass，不透明）。方块贴图画在其上——透明圆角像素透出液体色而不是墙色/背景色。
  // 这是原版"水体包裹方块"的全部秘密；条带宽度由邻接方向决定：
  //   仅上方有水 → 格顶 16×4 横条(:4081-4087)
  //   仅下方有水 → 格底 16×4 横条(:4089-4093)
  //   仅左侧有水 → 格左 4px 竖条(:4113-4116);仅右侧 → 格右 4px(:4118-4121)
  //   左右都有   → 整格 16 宽(:4108-4111);深度按液体量 num6=(256-max)/32*2 从底收
  // solidLayer=false：DrawLiquidBehindTiles 背景 pass(:451-467,墙层之前)——坡面格
  //   画【平面 Liquid 全矩形】(斜切区全覆盖,见 drawLiquidBehindTilesOnly 斜面表注释)
  // ★浸润带恒内联直画（2026-08-22 全屏扭曲重构：水体不再进离屏分层——浸润带
  //   属于墙/方块层渲染，背景 pass 在墙/方块之前画 = 原版层序；全屏扭曲在
  //   compositeLight 后统一施加，浸润带随场景一起扭，无需离屏足迹机制）
  if (isBackground) drawLiquidBehindTilesOnly(ctx, atlas, st, groundLevel, tx0, ty0, tx1, ty1, waterStyle, hasWaterfallAt, false, 0, slopeWaveBob, gateFootprintCtx ?? null,
    // ★liqgl：足迹画布缺席时改四边形收集（gate 发射消费;canvas 路径不受扰）
    (gateCapture && !gateFootprintCtx) ? _footQuads : null,
    // ★liqpolish 微光带批钩 / ★C13b 非微光带+亮线批钩（两旗正交:任一开即传钩,
    //  臂内各按本旗判——?liqpolish=0 时微光臂仍 CPU 原链,?c13b=0 时 C13b 臂仍 CPU 原链）
    (polish || liqC13b) ? (bat ?? null) : null);

  // ---- 调试快照落盘（DebugReport render.subsystems.liquids）----
  _liqDebug.calls++;
  _liqDebug.lastMs = nowMs;
  _liqDebug.waterStyle = waterStyle;
  _liqDebug.waterSheet = waterSheet(0, waterStyle);
  _liqDebug.isBackground = isBackground;
  _liqDebug.animFrame = animFrame;
  _liqDebug.waterfallFrame = waterfallFrame;
  _liqDebug.windSpeed = windSpeed;
  _liqDebug.window = [tx0, ty0, tx1, ty1];
  _liqDebug.sheetsReady = [...texCache.entries()].map(([vt, t]) => [vt, !!t] as [number, boolean]);
  _liqDebug.atlasReady = true;

  ctx.globalAlpha = 1;
}

// ---- LiquidSlope 斜面贴合（TileDrawing.cs:4526-4553 DrawPartialLiquid）----
// 语义勘定（2026-08-13 源码核）：LiquidSlope_N 不是"水面斜线"贴图——是
// 【被锤成坡面的实心格内液体】的斜面形状表。原版 DrawPartialLiquid 在 tile.slope()
// 1..4 时改用 TextureAssets.LiquidSlope[liquidType]（:4540-4552），源矩形 X 额外
// += 18*(slope-1)（:4539，表 72×16 = 4 列×18px 间距、16px 单元，像素实测四列
// 分别为 slope 1 右下斜/2 左下斜/3 右上斜/4 左上斜）。
// 原版该绘制有两个调用层（TileDrawing.cs:462 背景 pass / :529 实心层 pass）：
// DrawPartialLiquid(behindBlocks=!solidLayer) 的 flag=!BlocksWaterDrawingBehindSelf、
// 非背景 pass 恒 false；flag||slope==0 → 平面 Liquid，否则斜面表。即：
//   背景 pass：普通块坡面格 = 平面 Liquid 全矩形（斜切区整格覆盖！）；仅玻璃族
//             (54/541/328/459/470)坡面走斜面表
//   实心层 pass：一切坡面格走斜面表
// 两层【并集】才是玩家可见结果——普通坡面格的斜切区由背景平面带整格填满，
// 实心层斜面带再叠出贴坡水线。2026-08-20 用户标注 136 格（坡面+水邻 100%，
// 世界"浮夸的羡慕顶峰"）实证旧实现缺背景平面带：斜面形状源矩形自纹理行 ry 起
// （默认 ry=4），斜切区顶部 4 行艺术像素两层均无覆盖 → 透出远景背景亮光
// （用户：两坡格各 4 透明像素+右侧 2 像素）。LiquidSlope 的 Y 直接复用平面带
// 算出的 ry/rh（原版同源 liquidSize）。
/** LiquidSlope 源矩形选择（纯函数）：slope 1..4 → 斜面表列 X = rx + 18*(slope-1)；
 *  slope 0 / 半砖 → null = 走平面 Liquid 表（:4531-4533 flag||num==0 直画分支）。 */
export function liquidSlopeSource(
  slope: number, rx: number, ry: number, rw: number, rh: number,
): { sx: number; sy: number; sw: number; sh: number } | null {
  if (slope < 1 || slope > 4) return null;
  return { sx: rx + 18 * (slope - 1), sy: ry, sw: rw, sh: rh };
}

/** 浸润带贴图选择（TileDrawing.cs:4526-4537 DrawPartialLiquid 纯函数化）：
 *  flag = !BlocksWaterDrawingBehindSelf && !solidLayer（behindBlocks=!solidLayer 时
 *  才保留 flag；实心层 pass 恒 false）；flag||slope==0 → 平面 Liquid，否则斜面表。
 *  ⇒ 背景 pass 普通坡面格 = 平面全矩形（斜切区整格覆盖）；仅玻璃族坡面/实心层
 *  pass 坡面格走 LiquidSlope 斜面形状。 */
export function liquidBandUsesSlopeTable(
  slope: number, solidLayer: boolean, blocksWaterBehindSelf: boolean,
): boolean {
  const flag = !blocksWaterBehindSelf && !solidLayer;
  return !(flag || slope === 0);
}

/** LiquidSlope 表文件（与上方浸润 pass 的 Liquid_N 同一套 liquidType→style 映射：
 *  水=群系水色 0-13 / 岩浆=1 / 蜂蜜=11 / 微光=14，TextureAssets.LiquidSlope[15]） */
export function liquidSlopeSheet(vt: number, waterStyle = 0): string {
  if (vt === 1) return 'vanilla/LiquidSlope_1.png';   // 岩浆
  if (vt === 2) return 'vanilla/LiquidSlope_11.png';  // 蜂蜜
  if (vt === 3) return 'vanilla/LiquidSlope_14.png';  // 微光
  return `vanilla/LiquidSlope_${Math.max(0, Math.min(14, waterStyle))}.png`;
}

/**
 * 浸润 pass:原版 TilesRenderer.DrawLiquidBehindTiles → DrawTile_LiquidBehindTile
 * (TileDrawing.cs:3859-4193)。对视区内每个实心方块格检查四邻液体,在方块格内画液体带。
 * solidLayer：true=实心层 pass(:528-529,墙后贴图前,坡面走 LiquidSlope 斜面表)；
 *   false=背景 pass(:451-467,墙层前,普通坡面格走平面 Liquid 全矩形——斜切区
 *   整格覆盖,与实心层斜面带取并集=原版玩家可见结果,见 liquidSlopeSource 头注释)。
 */
/** ★IIIII251 坡面浸润带 bob 采样暂存（模块级零分配,同 _slopeDisp251 惯例） */
const _bandDisp251: [number, number] = [0, 0];

export function drawLiquidBehindTilesOnly(
  ctx: CanvasRenderingContext2D, atlas: SpriteAtlas,
  st: TileStore, groundLevel: number,
  tx0: number, ty0: number, tx1: number, ty1: number, waterStyle = 0,
  hasWaterfallAt?: (x: number, y: number) => boolean, solidLayer = true,
  /** 果冻管线背景离屏水层填充模式（见 Renderer.drawLiquids ★浸润带画进离屏水层）：
   *  1 = 画进背景水层（source-over，原层序=水体之上）。绕过"半砖+墙+上液跳带"门
   *  （:4148-4151）——层内该带被方块贴图覆盖不可见，但补全位移采样足迹。
   *  ★前景层禁止带入（前景合成画在方块贴图之上 = 水蓝盖地形——用户实报撤回）；
   *    前景采样落空由 GL 合成的足迹回退兜住（GLWaterDistortion.FRAG uFoot） */
  warpFill = 0,
  /** ★IIIII251 CPU 路（★IIIII257 转正缺省开）：坡面/半砖浸润带随波场垂直 bob
   *  （刚性整移）。调用方门 = slopeWaveEnabled && quality>0 && !warpOn
   *  （GL 路径不双重 bob）；?slopewave=0 逃生门关 */
  waveBob = false,
  /** ★IIIII251 GL 路（★IIIII257 转正缺省开）：坡面水形状 α≈0.02 预画进前景水
   *  离屏（= 全屏位移 obj19 门控足迹；仅 bg 调用传入，见 Renderer.drawLiquids）。
   *  256 批坡面亮线的位移/扭曲接入面：足迹楔形含亮线 2px 条带全宽
   *  （LiquidSlope 表 slope1/2 行 0-3 全宽，见 /tmp/iii257-out alpha 台账） */
  footprintCtx: CanvasRenderingContext2D | null = null,
  /** ★liqgl 足迹四边形收集（fgCanvas 足迹画布退役面;footprintCtx 为 null 时启用）：
   *  坡面/半砖足迹改推 _footQuads（世界坐标）,emitVanillaLiquidGate 折算设备后
   *  画进 FBO('liqgate')——语义=canvas 足迹同款（α≈0.02 饱和 obj19 门控）。 */
  footSink: FootQuad[] | null = null,
  /** ★liqpolish 带 lt===3 批发射钩（2026-09-29 微抛光刀;drawVanillaLiquids bg 调用
   *  传入=主批钩,drawLiquidBehindSolidTiles 实心层调用不传=CPU 原链）：微光浸润带
   *  逐 tile drawImage rec+applyShimmerBaseTint 4×MULT solid rec（~5k rec/帧实测面）
   *  → 顶点色调制 SO quad 入基底环（=drawBand+multiply 的批化同构;偏差族=liqgl
   *  刀2 modulate 单式,AA 边 multiply 补正项缺席 census 登记）。 */
  batBand?: LiqBatchEmit | null,
  /** ★BJ705-G26 件3（[g20-buff305-lavavision] 清偿）:玩家 lavaOpacity（缺省 1）。
   *  岩浆基线 alpha=lavaOpacity（TileDrawing.cs:4116 case 1）+地表覆写门 lava
   *  渐隐例外（:4125——渐隐相地表岩浆保持 fade 值,不强拉 1.0/0.9/0.6）。 */
  lavaOpacity = 1,
): void {
  // ★与原版 DrawTile_LiquidBehindTile 的定性保留偏差(2026-08-19 二轮清零后仅存):
  //  ①:4163-4166 地下半砖+上液"顶部顶点色×0"(逐 quad 垂直渐变,Canvas 2D 近似
  //    代价太高,用户裁定保留);②:4171-4182 flag6 多水型混合 DrawPartialLiquid——
  //    依赖 Main.liquidAlpha[] 喷泉水型 crossfade 子系统(±0.2/帧过渡),本仓水型
  //    为瞬时切换无过渡态,该循环恒不触发=与"无喷泉过渡"的原版行为一致;
  //  ③lavaOpacity——★BJ705-G26 件3（2026-10-22）[g20-buff305-lavavision] 清偿:
  //    状态/斜坡/授予源已落 Player.ts（字段 lavaOpacity + 湿段 UpdateBuffs
  //    :12140-12153 斜坡锚注,授予=ridingMount && mount.buff===305）;消费已全落
  //    （本函数基线+地表门 ≙ TileDrawing.cs:4116/:4125;drawVanillaLiquids 岩浆
  //    run/glint ×lavaOpacity ≙ LiquidRenderer.cs:659 DrawNormalLiquids case 1
  //    ——现役 NotRetro 路,oldDrawWater :58539 为复古死路不另移植）。G24 强化
  //    注记任务书就此销账。
  // Liquid_N 贴图(16×16 纯液体块;水 Liquid_0 多 style 但取首 16px)
  // ★liqpolish:旗面+末次查询 memo+每 pass tVis（微光带支逐 tile 读同值）
  const polishBand = liqpolish;
  let bandTVis = -1;
  let _texLastVt = -1;
  let _texLastT: ImageBitmap | HTMLImageElement | null = null;
  let _slpLastVt = -1;
  let _slpLastT: ImageBitmap | HTMLImageElement | null = null;
  const texCache = new Map<number, ImageBitmap | HTMLImageElement | null>();
  const texFor = (vt: number) => {
    if (polishBand && vt === _texLastVt) return _texLastT;
    let t = texCache.get(vt);
    if (t === undefined) {
      const file = vt === 1 ? 'vanilla/Liquid_1.png' : vt === 2 ? 'vanilla/Liquid_11.png'
      : vt === 3 ? 'vanilla/Liquid_14.png' // 微光
      : `vanilla/Liquid_${Math.max(0, Math.min(13, waterStyle))}.png`; // 群系水色(原版 DrawTile_LiquidBehindTile 同走 waterStyle)
      t = atlas.ensureVImage(file) ?? null;
      if (t) texCache.set(vt, t); // 只缓存命中(缓存 null 会把未就绪永久化——首帧丢条带)
    }
    _texLastVt = vt; _texLastT = t;
    return t;
  };
  // LiquidSlope 表缓存（同款"只缓存命中"策略；坡面格才触碰）
  const slopeTexCache = new Map<number, ImageBitmap | HTMLImageElement | null>();
  const slopeTexFor = (vt: number) => {
    if (polishBand && vt === _slpLastVt) return _slpLastT;
    let t = slopeTexCache.get(vt);
    if (t === undefined) {
      t = atlas.ensureVImage(liquidSlopeSheet(vt, waterStyle)) ?? null;
      if (t) slopeTexCache.set(vt, t);
    }
    _slpLastVt = vt; _slpLastT = t;
    return t;
  };

  // ---- ★liqpolish 带批化状态（lt===3 微光浸润带 → 基底环 SO 段;实心层调用
  //  batBand 缺省 null=CPU 原链。设备折算=入口 CTM（调用点=世界变换,轴对齐门）----
  //  ★C13b（2026-09-30）:通道扩成双臂——bandBatOn=微光臂（liqpolish 域,门逐位保持）,
  //  bandBatC13b=非微光带/III256 亮线臂（?c13b=0 逃生门,与 polish 正交）。run 状态机
  //  （bsStart/bsImg/bsKey）双臂共享:lt===3 与非微光带贴图互异（Liquid_14 vs
  //  Liquid_0..13/LiquidSlope_N）→ run 按纹理自动分段,永不混段。）
  let bandBatOn = false;
  let bandBatC13b = false;
  let bandDevX = 1, bandDevY = 1, bandDevE = 0, bandDevF = 0;
  let bsStart = 0;
  let bsImg: CanvasImageSource | null = null;
  let bsKey = '';
  /** 本 run 含微光调制 quad（重放面 hasCols;按纹理分段保证同质——同上注） */
  let bsCols = false;
  if (batBand && !_batOverflow && (polishBand || liqC13b)) {
    const bt = ctx.getTransform();
    if (bt.b === 0 && bt.c === 0) {
      bandDevX = bt.a; bandDevY = bt.d; bandDevE = bt.e; bandDevF = bt.f;
      bsStart = _batN;
      bandBatOn = polishBand;   // 微光臂=现行门（liqpolish 域;旗关臂逐位原链）
      bandBatC13b = liqC13b;    // ★C13b 臂（独立逃生门）
    }
  }
  const flushBandRun = (): void => {
    const quads = _batN - bsStart;
    if (quads <= 0 || !bsImg || !batBand) return;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const img = bsImg, s0 = bsStart, nQ = quads, k = bsKey, cols = bsCols;
    // ★C13b:入口门拒（clip/filter/GL 死）→ 2D 原位重放（flushAddRuns2DAndEmit
    //  emitAdd 判例同式）——rec 不入队=重放落本 flush 位=层序保持,宁回退不丢。
    const ok = batBand.emit(img, k, _batRing.subarray(s0 * LIQ_QUAD_FLOATS, _batN * LIQ_QUAD_FLOATS), nQ,
      (raw) => replayLiqRun2D(raw, s0, nQ, img, cols));
    if (!ok) replayLiqRun2D(ctx, s0, nQ, img, cols);
    bsStart = _batN;
    bsImg = null;
    bsCols = false;
  };
  // ★C13c 带微光段收口（主循环 flushShimRun 同式;【不】登记 fg 复用/gate 账——
  //  带 pass 恒 bg 层（isBackground 调用域）且不在 _fgRuns（与 flushBandRun 不登记
  //  同语义）;段状态（_shimOn/_shimStart/_shimImg）与主循环共用——主循环段已收口
  //  （主循环尾 flushShimRun 先于本 pass）,纹理互异自动换段。 */
  const flushShimBandRun = (): void => {
    const quads = _shimN - _shimStart;
    if (quads <= 0 || !_shimImg || !batBand) return;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const img = _shimImg, s0 = _shimStart, nQ = quads, k = _shimKey;
    _shimOn = false;
    const ok = emitShimRun(batBand, s0, nQ, img, k);
    if (!ok) replayLiqShimRun2D(ctx, s0, nQ, img);   // 入口门拒=2D 原位重放
    _shimStart = _shimN;
    _shimImg = null;
  };
  /** 带 quad 入基底环（batQuad 同式;★C13b 扩参:a=带 alpha（微光臂恒 1）,cols=四角
   *  波色（非微光臂 null=rgb 预乘恒等）,soft=true=软溢出域）。 */
  const bandQuadEmit = (
    tex: ImageBitmap | HTMLImageElement, key: string,
    sx: number, sy: number, sw: number, shSrc: number,
    dx0: number, dy0: number, dw: number, dh: number,
    a = 1, cols: Float32Array | null = _batCols,
  ): boolean => {
    void key;
    if (dw <= 0 || dh <= 0) return true;   // 零面积段=与 drawImage 零绘制等价
    return batQuad(sx, sy, sw, shSrc, tex.width, tex.height, dx0, dy0, dw, dh, a, cols, 0, true);
  };

  // ★IIIII251：足迹离屏默认 identity,而带坐标是世界 px——先对齐主 ctx 当前
  //  变换(浸润带调用点=世界变换,见 drawVanillaLiquids :792 恢复),循环尾恢复。
  if (footprintCtx) footprintCtx.setTransform(ctx.getTransform());
  // ★liqpolish:按 type 打包 LUT（solid/platform/sheet/blocksWater 一次预析——
  //  逐 tile TILE_DEFS[t] 三重属性链+5 次 sheet 比较→一次 Map.get+位测;
  //  值域=TILE_DEFS 静态派生,构造路径等价;Map 命中窗=世界 tile 表不变）。
  let bandLut: Map<number, number> | null = null;
  if (polishBand) bandLut = new Map();
  for (let x = Math.max(1, tx0); x <= Math.min(st.w - 2, tx1); x++) {
    for (let y = Math.max(1, ty0); y <= Math.min(st.h - 2, ty1); y++) {
      const i = st.idx(x, y);
      if (!st.flags[i]) continue; // 空格没有"方块后面"
      if ((st.wire[i] & 32) !== 0) continue; // 致动幽灵格不画浸润(:3906 !active() 同族)
      // ★liqpolish 五旗早退（2026-09-29 微抛光刀;纯检查重排序=逐位同）:
      //  四邻液+自液全零且左右邻非活半砖 → 五旗(fL/fR/fU/fD/f5)必然全空
      //  （fL/fR 唯一零邻液置位路径=IIIII248 半砖视觉水补丁——需邻格活半砖前提,
      //  先测 flags∧half 排除;f5/grate 需自液>0）→ 与原五旗全空 continue 逐位同,
      //  免去窗口主体（实心无液邻格 ~60-70% 格）的 LUT/sheet/num4/坡面门全套。
      //  注意保序:flags/wire 门在先（同原序）;LUT 惰性到快退之后。
      {
        const wA = st.w, liqA = st.liquid;
        const selfLq0 = liqA[i];
        if (selfLq0 === 0) {
          const li = y * wA + (x - 1), ri = y * wA + (x + 1);
          const ui = (y - 1) * wA + x, di = (y + 1) * wA + x;
          if (liqA[li] === 0 && liqA[ri] === 0 && liqA[ui] === 0 && liqA[di] === 0) {
            const fl = st.flags[li], fr = st.flags[ri];
            if (!((fl !== 0 && st.half[li] !== 0) || (fr !== 0 && st.half[ri] !== 0))) continue;
          }
        }
      }
      const ty = st.type[i];
      let lut = bandLut ? bandLut.get(ty) : undefined;
      if (lut === undefined) {
        const def = TILE_DEFS[ty];
        if (!def || !def.solid || def.platform) {   // 仅实心方块(:4075 tileSolid 排除)
          if (bandLut) bandLut.set(ty, -1);
          continue;
        }
        const sheet = def.vanilla?.sheet ?? -1;
        // :3910 BlocksWaterDrawingBehindSelf(TileID.cs:357):玻璃54/回声541/彩纸328/
        // 雪落459/假人470 —— 平面格(slope==0)整块挡水,不画背后的带
        const blocks = sheet === 54 || sheet === 541 || sheet === 328 || sheet === 459 || sheet === 470 ? 1 : 0;
        lut = (sheet << 2) | blocks;   // sheet ≤ 2^29 打包安全;bit0=blocksWater
        if (bandLut) bandLut.set(ty, lut);
      } else if (lut === -1) {
        continue;
      }
      const slope = st.slope[i];
      // blockType(num4)语义:0=整块 / 1=半砖 / 2-5=坡面(:3907 blockType())
      const num4 = slope !== 0 ? slope : (st.half[i] ? 1 : 0);
      const sheet = lut >>> 2;
      const blocksWaterBehindSelf = (lut & 1) !== 0;
      if (slope === 0 && blocksWaterBehindSelf) continue;
      // :3923-3925 传送带(379)自身格有液体 → 整格跳过
      if (sheet === 379 && st.liquid[i] > 0) continue;

      // 四邻液体(TileDrawing.cs:3861-3900;379=conveyor 按 vanilla 视为无液体)。
      // ★零分配版(2026-08-18):旧 lq() 每调用 new {lq,lt} ×4/格——水邻屏每帧
      // 8k-33k 对象 = GC 0.94s/次 = 行走 70-135ms 掉帧主源(trace ProfileChunk+GC 相关性)
      // ★IIIII248 内联展开(等价证明):本循环界 x∈[max(1,tx0),min(w-2,tx1)]/
      //   y∈[max(1,ty0),min(h-2,ty1)] ⇒ 四邻 nx=x±1∈[0,w-1]、ny=y±1∈[0,h-1]
      //   ⇒ st.inBounds(nx,ny) 在全循环域恒真(0.44% self 热点的源头即此
      //   恒真守卫+闭包上下文分配——nb 捕获 x/y/nLq/nLt 可变外层 let,V8 每
      //   格迭代建 Context)。展开为直读:idx 展开 = y*w+x 同式,liquidType||1
      //   同式,四邻恒成立 ⇒ 直读与原 inBounds 门逐位同值。
      let Lq = 0, Lqt = 0, Rq = 0, Rqt = 0, Uq = 0, Uqt = 0, Dq = 0, Dqt = 0;
      {
        const liqA = st.liquid, liqT = st.liquidType, wArr = st.w;
        let ni = y * wArr + (x - 1);            // 左邻(x≥1 ⇒ x-1≥0)
        Lq = liqA[ni]; Lqt = liqT[ni] || 1;
        ni = y * wArr + (x + 1);                // 右邻(x≤w-2 ⇒ x+1≤w-1)
        Rq = liqA[ni]; Rqt = liqT[ni] || 1;
        ni = (y - 1) * wArr + x;                // 上邻(y≥1 ⇒ y-1≥0)
        Uq = liqA[ni]; Uqt = liqT[ni] || 1;
        ni = (y + 1) * wArr + x;                // 下邻(y≤h-2 ⇒ y+1≤h-1)
        Dq = liqA[ni]; Dqt = liqT[ni] || 1;
      }
      // 坡面格的"实心侧"邻格不计入（:3967/:3989/:4011/:4028 的 slope 门）：
      // slope 1/3 忽略左、2/4 忽略右、3/4 忽略上、1/2 忽略下——液体只从坡面开放侧来
      const slopeBlocksLeft = slope === 1 || slope === 3;
      const slopeBlocksRight = slope === 2 || slope === 4;
      const slopeBlocksUp = slope === 3 || slope === 4;
      const slopeBlocksDown = slope === 1 || slope === 2;
      // flag 语义(:3967-4053):flag=左 / flag2=右 / flag3=上 / flag4=下(>240)
      let fL = Lq > 0 && !slopeBlocksLeft;
      let fR = Rq > 0 && !slopeBlocksRight;
      const fU = Uq > 0 && !slopeBlocksUp;
      let fD = Dq > 240 && !slopeBlocksDown;
      // ★半砖邻格的"视觉水"计入侧向旗(2026-08-20 用户终验三轮定谳):半砖格自身
      //   liquid 恒 0(原版 UpdateLiquid 下灌门 Liquid.cs:568 同样挡半砖格,两版一致;
      //   本世界 4004 个"上格有水半砖格"全 dry、0 个含液),但其上格有液时液体渲染
      //   器按 IsHalfBrick 强制满格画水(LiquidRenderer.cs:193-230/:121)——邻格上半
      //   8px 视觉上是水。本格与其相接的侧缘(D1 半砖接缝补丁 (144,0,4,8) 的设计
      //   透明角等)由此包水:侧旗放行 → 与上水并存时走默认整格带 (0,4,16,16),
      //   接缝透明角透出水色——用户实测原版观感"半透明水色"而非透视差背景。
      //   原版 band 门读 tile.liquid 原始值(此构型为 0);本扩展改读"视觉液位",
      //   【登记为定性偏差】(液位取 255——IsHalfBrick 视觉恒满格,与上格实际液位
      //   无关;带画在贴图之后仅透过透明像素可见,越界部分被贴图遮挡无副作用)。
      if (!fL || !fR) {
        // ★IIIII248 内联展开(等价证明):nx=x±1∈[0,w-1](循环界同上)、y≥1 ⇒
        //   y-1≥0 ⇒ 两个 inBounds 恒真;谓词体 flags/half/platform/上格 liquid>0
        //   逐项同式直读,命中支同值(fL/fR=true + Lq/Rq=255)。
        const halfF = st.half, typeA = st.type, flagA = st.flags, liqA2 = st.liquid, wA = st.w;
        if (!fL) {
          const ni = y * wA + (x - 1), nu = (y - 1) * wA + (x - 1);
          if (flagA[ni] !== 0 && halfF[ni] !== 0 && !(TILE_DEFS[typeA[ni]]?.platform)
            && liqA2[nu] > 0) { fL = true; Lq = 255; }
        }
        if (!fR) {
          const ni = y * wA + (x + 1), nu = (y - 1) * wA + (x + 1);
          if (flagA[ni] !== 0 && halfF[ni] !== 0 && !(TILE_DEFS[typeA[ni]]?.platform)
            && liqA2[nu] > 0) { fR = true; Rq = 255; }
        }
      }
      // ★flag5 自身格液体(:3943-3963,2026-08-19 用户实报"半格方块浸润未处理"):
      //   半砖/坡面格【自己格内】的液体也画浸润(半砖需 >160)——本格既是容器
      //   又是方块,水搁在半砖上时原版从本格取液位画带,旧实现只读四邻 = 整类缺失
      const selfLq = st.liquid[i];
      // :3921-3939 Grate(546 格栅)自液体特例:格栅透水,自身格液体 → 三向旗
      // 全开+液位直取本格(原版走独立 else 支,四邻旗/液位不参与;fU 恒 false)
      const grateSelf = sheet === 546 && selfLq > 0;
      let f5: boolean;
      if (grateSelf) {
        fL = true; fR = true; fD = true;
        f5 = true;
      } else {
        f5 = selfLq > 0 && num4 !== 0 && (num4 !== 1 || selfLq > 160);
      }
      if (!fL && !fR && !fU && !fD && !f5) continue; // :4054 五旗全空跳过
      // :3906 半砖+侧液>160+瀑布 → 让位瀑布(瀑布本体覆盖半砖,带不画)
      if (st.half[i] && (Lq > 160 || Rq > 160) && hasWaterfallAt?.(x, y)) continue;

      // 液体类型与最大液位(:3940-3965 取最高液位邻居;顺序 L→R→U→D 严格大于才覆盖)
      let maxLq = 0, lt = 0;
      if (grateSelf) { maxLq = selfLq; lt = toVanillaType(st.liquidType[i] || 1); }
      else {
        if (fL && Lq > maxLq) { maxLq = Lq; lt = toVanillaType(Lqt); }
        if (fR && Rq > maxLq) { maxLq = Rq; lt = toVanillaType(Rqt); }
        if (fU && Uq > maxLq) { maxLq = Uq; lt = toVanillaType(Uqt); }
        if (fD && Dq > maxLq) { maxLq = Dq; lt = toVanillaType(Dqt); }
        if (f5 && selfLq > maxLq) { maxLq = selfLq; lt = toVanillaType(st.liquidType[i] || 1); }
      }
      // ★坡面边角门(:4141-4148,旧注 :4155-4162 系行号漂移勘误):slope4 左侧无液
      //   无实心 / slope3 右侧同 → 整带不画。★BJ308:实心谓词=SolidTile 全式
      //  （!halfBrick∧slope==0,solidTop 已折 SOLID_LUT）→ isSolidStrict,同增强段。
      if (slope === 4 && Lq === 0 && !st.isSolidStrict(x - 1, y)) continue;
      if (slope === 3 && Rq === 0 && !st.isSolidStrict(x + 1, y)) continue;
      const tex = texFor(lt); // lt=3 微光走 Liquid_14
      if (!tex) continue;

      // ---- 液体矩形计算(:4069-4123) ----
      // 原版默认 rect = (0, 4, 16, 16);pos = (tileX*16, tileY*16)
      let rx = 0, ry = 4, rw = 16, rh = 16;   // liquidSize(源矩形)
      let px = x * 16, py = y * 16;            // 目标位置

      if (fD && (fL || fR)) { fL = true; fR = true; /* :4070-4074 下+任一侧 → 双侧全宽 */ }
      if (!(fU && (fL || fR)) && !(fD && fU)) {
        if (fU) {
          // 仅上方有水:格顶 16×4 条(:4081-4087;坡面/半砖加深到 12)
          rh = 4;
          const isHalf = st.half[i];
          if (isHalf || slope !== 0) rh = 12;
        } else if (fD && !fL && !fR) {
          // 仅下方:格底 16×4(:4089-4093)
          py = y * 16 + 12; rh = 4;
        } else {
          // 侧向有水(:4095-4123)
          let y0 = 4;
          const upNi = st.idx(x, y - 1);
          // ★num4!=0 门(:4087):半砖/坡面格即便上格实心也从格顶画——
          //   (num5 == 0 && (num12 != 0 || !WorldGen.SolidTile(tileX, tileY - 1)),
          //   TileDrawing.cs:4087,num12=blockType(:3907))。★BJ325:实心臂=SolidTile
          //   全式(WorldGen.cs:70642 !halfBrick∧slope==0 三排除)→ isSolidStrict,
          //   同 BJ308 门②——曾以宽谓词 isSolid 充数,上格半砖/坡面误判实心 →
          //   带源 y0 滞 4 = 带矮 4px 且亮顶行不入带。
          if (st.liquid[upNi] === 0 && (num4 !== 0 || !st.isSolidStrict(x, y - 1))) y0 = 0;
          const num6 = Math.floor((256 - maxLq) / 32) * 2; // 深度=液位不足时从底收(:4096,4102)
          const isHalf = st.half[i];
          if (slope !== 0) {
            // 坡面格:整格宽、自 num6 起(:4102-4106)——窄条分支对坡面不适用
            py = y * 16 + num6; ry = num6; rh = 16 - num6;
          } else if (fL && fR || isHalf) {
            // 左右都有 或 半砖:整格宽(:4108-4111)
            py = y * 16 + num6; ry = y0; rh = 16 - num6;
          } else if (fL) {
            // 仅左:格左 4px 竖条(:4113-4116)
            py = y * 16 + num6; ry = y0; rw = 4; rh = 16 - num6;
          } else {
            // 仅右:格右 4px 竖条(:4118-4121)
            px = x * 16 + 12; py = y * 16 + num6; ry = y0; rw = 4; rh = 16 - num6;
          }
        }
      }
      if (rw <= 0 || rh <= 0) continue;

      // ---- 斜面格换 LiquidSlope 表（TileDrawing.cs:4526-4552 DrawPartialLiquid）----
      // 贴图选择走 liquidBandUsesSlopeTable 纯函数(双 pass 语义,见其头注释);
      // 源矩形 X += 18*(slope-1),Y 复用平面带 ry/rh(原版同源 liquidSize)。
      const useSlopeTable = liquidBandUsesSlopeTable(slope, solidLayer, blocksWaterBehindSelf);
      const slopeSrc = useSlopeTable ? liquidSlopeSource(slope, rx, ry, rw, rh) : null;
      let drawTex: ImageBitmap | HTMLImageElement | null = tex;
      let srx = rx;
      if (slopeSrc) {
        drawTex = slopeTexFor(lt);
        srx = slopeSrc.sx;
        if (!drawTex) drawTex = tex; // 斜面表未就绪 → 退回平面带(下帧懒加载生效)
      }

      // ---- 源矩形钳制到贴图边界(原版 XNA PointClamp = 越界读【边缘行/列】) ----
      // Liquid_N 是 16×16 纯块;默认带 ry=4 起 + rh=16 读到 y=20——XNA PointClamp
      // 采样越界行时取贴图末行(边缘重复),带仍是完整 16px。
      // 【两轮教训:①钳短(2026-08-14 前):带只画 12px,水邻满带格(fU&&fR 走默认
      //   (0,4,16,16) 全格带)底部 4px 无浸润 → 水面线坡面/泥土交界亮缝(2026-08-20
      //   用户标注 #3 实证:y13 x10-15 透亮)。②拉伸 dstH=rh:均匀拉伸≠边缘重复,
      //   水纹相位漂移显脏(2026-08-14 回退)。正解=主段画到贴图底,剩余段用末
      //   【行/列】平铺补齐——与 PointClamp 逐像素等价。】
      const texEdgeY = drawTex.height - 1;
      const srcH = Math.min(rh, drawTex.height - ry);
      const srcW = Math.min(rw, drawTex.width - srx);
      if (srcW <= 0 || srcH <= 0) continue;
      const dstH = srcH;
      const dstW = srcW;
      /** 主段 + 越界余段(末行/列边缘重复,= XNA PointClamp)；oy = ★IIIII251 波 bob 垂直位移。
       *  ★liqpolish:闭包仅旗关臂构造（每带 tile 一次闭包+Context 分配;旗开臂两调用点
       *  内联展开,参数逐字同式=逐位同）。 */
      const drawBand = polishBand ? ((oy = 0) => {
        ctx.drawImage(drawTex, srx, ry, srcW, srcH, px, py + oy, dstW, dstH);
        if (rh > srcH) {
          ctx.drawImage(drawTex, srx, texEdgeY, srcW, 1, px, py + oy + dstH, dstW, rh - srcH);
        }
        if (rw > srcW) {
          ctx.drawImage(drawTex, drawTex.width - 1, ry, 1, srcH, px + dstW, py + oy, rw - srcW, dstH);
        }
      }) : null;

      // ---- ★IIIII251 斜坡水缘波纹（?slopewave=1）----
      // CPU 路 bob：坡面/半砖浸润带随波场垂直位移（与表层水面格同一采样点=格中心、
      // 同一 ±16 世界 px 钳；刚性整移=斜切水线形状不变、顶端随波进退）。GL 全屏
      // 扭曲路径 waveBob=false（位移由足迹门控交付，防双重 bob）。
      let bobDy251 = 0;
      if (waveBob && num4 !== 0) {
        waterWaves.sampleDisplace(x * 16 + 8, y * 16 + 8, _bandDisp251);
        bobDy251 = Math.round(Math.min(16, Math.max(-16, _bandDisp251[1]
          / Math.max(1e-6, waterWaves.viewZoom()))));
      }
      // GL 路足迹：坡面格把 LiquidSlope 斜面水形状、半砖格把上半水区以 α≈0.02
      // 预画进前景水离屏——obj19 门控 aD/aU = min(α×100,1) 在 α≥0.01 即饱和 ⇒
      // 斜坡水缘纳入全屏位移场（可见合成仅 +2% 水色 tint，与浸润带同域不可辨）。
      // 半砖带整格宽但水区只在上半（下半是砖体）→ 足迹钳上半。
      // ★IIIII257：足迹=坡面亮线（本文件实心层 pass 末段）的位移/扭曲接入面——
      // 足迹楔形行 0-3 全宽 ⊇ 亮线 2px 条带，gate 饱和 ⇒ 亮线与平水面亮线同场
      // 起伏、同入水中扭曲。转正后随 warpOn 常开（?slopewave=0 逃生门）。
      if (footprintCtx && num4 !== 0) {
        if (slope !== 0) {
          const stex = slopeTexFor(lt);
          if (stex && stex.width > 0) {
            const fsw = Math.min(rw, stex.width - (18 * (slope - 1) + rx));
            const fsh = Math.min(rh, stex.height - ry);
            if (fsw > 0 && fsh > 0) {
              footprintCtx.globalAlpha = 0.02;
              footprintCtx.drawImage(stex, 18 * (slope - 1) + rx, ry, fsw, fsh,
                px, py + bobDy251, fsw, fsh);
            }
          }
        } else if (st.half[i]) {
          footprintCtx.globalAlpha = 0.02;
          footprintCtx.fillStyle = '#808080';   // 门控只读 alpha,色值无关
          footprintCtx.fillRect(px, y * 16, rw, 8);
        }
      } else if (footSink && num4 !== 0) {
        // ★liqgl：同语义足迹改四边形收集（世界坐标;gate 发射时折算设备+y 镜像,
        // α=0.02 恒定——obj19 门控 ×100 饱和,色值无关）
        if (slope !== 0) {
          const stex = slopeTexFor(lt);
          if (stex && stex.width > 0) {
            const fsw = Math.min(rw, stex.width - (18 * (slope - 1) + rx));
            const fsh = Math.min(rh, stex.height - ry);
            if (fsw > 0 && fsh > 0) {
              footSink.push({ tex: stex, solid: false, sx: 18 * (slope - 1) + rx, sy: ry,
                sw: fsw, sh: fsh, dx: px, dy: py + bobDy251, dw: fsw, dh: fsh });
            }
          }
        } else if (st.half[i]) {
          footSink.push({ tex: null, solid: true, sx: 0, sy: 0, sw: 1, sh: 1,
            dx: px, dy: y * 16, dw: rw, dh: 8 });
        }
      }

      // ---- 微光分支（TileDrawing.cs:4188-4191 num2==14）----
      // 原版 SetShimmerVertexColors 把四角顶点色【整体重置】为 White×opacity×
      // GetShimmerBaseColor(角)——上方整段 num7 透明度/光照计算对微光全部丢弃，
      // opacity = solidLayer ? 0.75 : 1。本函数只在背景 pass 调用（= 原版
      // DrawLiquidBehindTiles :462 的 solidLayer:false 调用点）→ opacity 1。
      // 彩色叠加【该有】：旧注释"省略彩色叠加"与末尾的 multiply 叠加自相矛盾，
      // 按源码对齐为"不透明直画 + 2×2 子块波色 multiply"（与前景 DrawShimmer 同式）。
      if (lt === 3) {
        // ★liqpolish 带批化臂（batBand 在场+轴对齐 CTM+无溢出）:drawBand×N 段
        //  drawImage rec+applyShimmerBaseTint 4×MULT solid rec → 顶点色调制 SO quad
        //  （tex.premul×vCol=modulate 单式;multiply 在 AA 边的 (1−αdst) 补正项缺席
        //  =liqgl 刀2 同族登记偏差）。段按带表纹理同质（Liquid_14/LiquidSlope_14）。
        if (bandBatOn && liqC13c) {
          // ★C13c 带微光臂:stride-11 quad 入微光环（方案 H——噪声 4 sin CPU,波场 FS;
          //  主环开放带段先收口=层序;段状态与主循环共用,纹理互异自动换段）。
          //  aTile 世界矩形:主段=带矩形（px,py+bob,dstW,dstH）;越界余段=带矩形外扩域
          //  （aTile 随矩形连续延伸=场连续域 ✓ bobDy251 位移随 py 进 aTile 域=与现行
          //  CPU cols 臂 bvT/bvB 含 bob 同构）。
          const tVb = bandTVis < 0 ? (bandTVis = visEffectFrames()) : bandTVis;
          flushBandRun();
          _shimNs[0] = Math.sin(shimmerWhiteNoise(x, y) / 10 + tVb / 180);
          _shimNs[1] = Math.sin(shimmerWhiteNoise(x + 1, y) / 10 + tVb / 180);
          _shimNs[2] = Math.sin(shimmerWhiteNoise(x, y + 1) / 10 + tVb / 180);
          _shimNs[3] = Math.sin(shimmerWhiteNoise(x + 1, y + 1) / 10 + tVb / 180);
          if (_shimOn && _shimImg !== drawTex) flushShimBandRun();
          if (!_shimOn) { _shimOn = true; _shimStart = _shimN; _shimImg = drawTex; _shimKey = `liqshim:${texId(drawTex)}`; }
          setLiqShimmerTVis(tVb);
          const bdx0 = px * bandDevX + bandDevE, bdy0 = (py + bobDy251) * bandDevY + bandDevF;
          const bgx1 = (px + dstW) * bandDevX + bandDevE, bgy1 = (py + bobDy251 + dstH) * bandDevY + bandDevF;
          // 主段 + 越界余段（drawBand 逐字拆 quad;全部同纹理=同段;a=1 不透明 bg 带）
          let bOk = shimQuad(srx, ry, srcW, srcH, drawTex.width, drawTex.height,
            px, py + bobDy251, dstW, dstH, bdx0, bdy0, bgx1 - bdx0, bgy1 - bdy0, 1, _shimNs);
          if (bOk && rh > srcH) {
            bOk = shimQuad(srx, texEdgeY, srcW, 1, drawTex.width, drawTex.height,
              px, py + bobDy251 + dstH, dstW, rh - srcH,
              bdx0, (py + bobDy251 + dstH) * bandDevY + bandDevF,
              dstW * bandDevX, (rh - srcH) * bandDevY, 1, _shimNs);
          }
          if (bOk && rw > srcW) {
            bOk = shimQuad(drawTex.width - 1, ry, 1, srcH, drawTex.width, drawTex.height,
              px + dstW, py + bobDy251, rw - srcW, dstH,
              (px + dstW) * bandDevX + bandDevE, bdy0,
              (rw - srcW) * bandDevX, bgy1 - bdy0, 1, _shimNs);
          }
          if (bOk) continue;
          flushShimBandRun();   // 溢出:段收口,本 tile 落 CPU 原链
        } else if (bandBatOn) {
          const tVb = bandTVis < 0 ? (bandTVis = visEffectFrames()) : bandTVis;
          if (bsImg !== drawTex) { flushBandRun(); bsImg = drawTex; bsKey = `liqband:${texId(drawTex)}`; bsCols = true; }
          // 裁剪角（带矩形相对格原点归一;v 含 bob 位移——与 applyShimmerBaseTint
          //  的 v 域同构(py+bob 相对 y*16)）
          const buL = (px - x * 16) / 16, buR = (px + dstW - x * 16) / 16;
          const bvT = (py + bobDy251 - y * 16) / 16, bvB = (py + bobDy251 + dstH - y * 16) / 16;
          shimmerWaves4(x, y, tVb, _wvTint, 0);
          shimmerCornersFromWaves(_wvTint, 0, buL, buR, bvT, bvB, _batCols, 0);
          const bdx0 = px * bandDevX + bandDevE, bdy0 = (py + bobDy251) * bandDevY + bandDevF;
          const bgx1 = (px + dstW) * bandDevX + bandDevE, bgy1 = (py + bobDy251 + dstH) * bandDevY + bandDevF;
          const bdw = bgx1 - bdx0, bdh = bgy1 - bdy0;
          // 主段 + 越界余段（drawBand 逐字拆 quad;全部同纹理=同段）
          let bOk = bandQuadEmit(drawTex, bsKey, srx, ry, srcW, srcH, bdx0, bdy0, bdw, bdh);
          if (bOk && rh > srcH) {
            bOk = bandQuadEmit(drawTex, bsKey, srx, texEdgeY, srcW, 1,
              bdx0, (py + bobDy251 + dstH) * bandDevY + bandDevF,
              (dstW) * bandDevX, (rh - srcH) * bandDevY);
          }
          if (bOk && rw > srcW) {
            bOk = bandQuadEmit(drawTex, bsKey, drawTex.width - 1, ry, 1, srcH,
              (px + dstW) * bandDevX + bandDevE, bdy0,
              (rw - srcW) * bandDevX, bdh);
          }
          if (bOk) continue;
          flushBandRun();   // 溢出:段收口,本 tile 落 CPU 原链
        }
        ctx.globalAlpha = 1;
        if (drawBand) drawBand(bobDy251);
        else {
          // ★liqpolish 内联展开（drawBand 旗关臂同式逐字;免每 tile 闭包构造）
          ctx.drawImage(drawTex, srx, ry, srcW, srcH, px, py + bobDy251, dstW, dstH);
          if (rh > srcH) {
            ctx.drawImage(drawTex, srx, texEdgeY, srcW, 1, px, py + bobDy251 + dstH, dstW, rh - srcH);
          }
          if (rw > srcW) {
            ctx.drawImage(drawTex, drawTex.width - 1, ry, 1, srcH, px + dstW, py + bobDy251, rw - srcW, dstH);
          }
        }
        // ★2026-09-27 重钉：同前景 pass（drawVanillaLiquids 内 tVis）——visEffectFrames()
        //  ★liqpolish:每 pass 一次解析（渲染段内计数器不变,逐 tile 读同值——主循环
        //  tVisCache 同判例）
        if (srcW >= 8) applyShimmerBaseTint(ctx, x, y, px, py + bobDy251, dstW, dstH,
          bandTVis < 0 ? (bandTVis = visEffectFrames()) : bandTVis);
        continue;
      }

      // ---- 不透明度(:4126-4151) ----
      // 地上=1.0(有墙压 0.6,墙 21→0.9);地下基线 0.5;
      // 岩浆=lavaOpacity/蜂蜜=max(0.5×1.7,1)=1
      // ★BJ705-G26（2026-10-22）[g20-buff305-lavavision] 清偿:穿参落地——
      //  `lt===1 → alpha=lavaOpacity`（基线非 1.0,TileDrawing.cs:4116 case 1）+
      //  地表覆写门 lava 渐隐例外 `!(lt===1 && lavaOpacity<1)`（:4125——渐隐相
      //  地表岩浆保持 fade 值,不强拉 1.0/0.9/0.6;G24 强化注记任务书就此销账,
      //  Player 斜坡/授予源随件3 落地,Renderer 六调用位穿参=本函数+drawVanilla
      //  Liquids 各调用点）。
      let alpha = 0.5;
      if (lt === 1) alpha = lavaOpacity;
      else if (lt === 2) alpha = 1.0;
      if (y <= Math.floor(groundLevel) && !(lt === 1 && lavaOpacity < 1)) {
        alpha = 1.0;
        const wi = st.wall[i];
        if (wi === 21) alpha = 0.9;
        else if (wi > 0) alpha = 0.6;
      }
      // ★半砖+上格有液+有墙 → 整带不画(:4148-4151;地下半砖上的水由水体本体呈现)。
      // 离屏填充模式绕过（带被方块贴图盖住不可见，但保住位移采样足迹）
      if (!warpFill && st.half[i] && Uq > 0 && st.wall[i] > 0) continue;
      // ---- ★C13b 非微光带批臂（水/岩浆/蜂蜜浸润带 + III256 亮线;2026-09-30）----
      //  形态=轴对齐纹理 quad：平面带（Liquid_N 全矩形/条带）或斜面带（LiquidSlope_N
      //  源矩形,srx=rx+18*(slope-1)）+ 亮线（Liquid_N 顶 2px 条）——全部折顶点入基底
      //  环,发射位=本 pass 调用位（flushBandRun 位）=层序保持（探针 _c13b-census
      //  实测此族 ≈234 shim drawImage/帧=逐 op 税主体）。
      //  【all-or-nothing 预检】入环前查容量（主段+底/右缘重复+亮线 ≤4 quad）——
      //  预检失败=整 tile 落 CPU 原链。部分入环后 CPU 重画对 α<1 带是二次混合变深
      //  （微光带 a=1 幂等重画域,此处不成立）,故不许部分入环。
      //  【亮线同批】III256 亮线与带同 tile 相邻序（带→线）;纹理异（LiquidSlope_N
      //  vs Liquid_N）时 flushBandRun 换段——段序=绘制序逐位同。
      // ★C13c:微光带段开放时先收口（非微光带任何发射/CPU 直画排其后=层序;
      //  bandBatC13b 关=CPU 直画同样需要——shim rec 队列序=2D 流序）
      if (bandBatOn && liqC13c) flushShimBandRun();
      if (bandBatC13b && !_batSoftOvf) {
        const lineQ = solidLayer && (slope === 1 || slope === 2) && Uq === 0
          && !st.isSolidStrict(x, y - 1) && (fL || fR);
        const need = 1 + (rh > srcH ? 1 : 0) + (rw > srcW ? 1 : 0) + (lineQ ? 1 : 0);
        if (_batN + need <= LIQ_RING_CAP) {
          const bdx0 = px * bandDevX + bandDevE, bdy0 = (py + bobDy251) * bandDevY + bandDevF;
          const bgx1 = (px + dstW) * bandDevX + bandDevE, bgy1 = (py + bobDy251 + dstH) * bandDevY + bandDevF;
          if (bsImg !== drawTex) { flushBandRun(); bsImg = drawTex; bsKey = `liqband:${texId(drawTex)}`; }
          let bOk = bandQuadEmit(drawTex, bsKey, srx, ry, srcW, srcH,
            bdx0, bdy0, bgx1 - bdx0, bgy1 - bdy0, alpha, null);
          if (bOk && rh > srcH) {
            bOk = bandQuadEmit(drawTex, bsKey, srx, texEdgeY, srcW, 1,
              bdx0, (py + bobDy251 + dstH) * bandDevY + bandDevF,
              dstW * bandDevX, (rh - srcH) * bandDevY, alpha, null);
          }
          if (bOk && rw > srcW) {
            bOk = bandQuadEmit(drawTex, bsKey, drawTex.width - 1, ry, 1, srcH,
              (px + dstW) * bandDevX + bandDevE, bdy0,
              (rw - srcW) * bandDevX, bgy1 - bdy0, alpha, null);
          }
          if (bOk && lineQ) {
            if (bsImg !== tex) { flushBandRun(); bsImg = tex; bsKey = `liqband:${texId(tex)}`; }
            bOk = bandQuadEmit(tex, bsKey, rx, 0, Math.min(rw, tex.width - rx), 2,
              bdx0, bdy0, rw * bandDevX, 2 * bandDevY, alpha, null);
          }
          if (bOk) continue;
          flushBandRun();   // 防御收口（预检后容量恒足,bOk 假不可达;真触发=整 tile CPU 重画兜底）
        } else {
          _batSoftOvf = true;   // 软溢出:余帧带批降 CPU（不触 _batOverflow 硬面）
          flushBandRun();       // 开放段收口（后续 CPU 带落其后=层序保持）
        }
      }
      ctx.globalAlpha = alpha;
      if (drawBand) drawBand(bobDy251);
      else {
        // ★liqpolish 内联展开（同上）
        ctx.drawImage(drawTex, srx, ry, srcW, srcH, px, py + bobDy251, dstW, dstH);
        if (rh > srcH) {
          ctx.drawImage(drawTex, srx, texEdgeY, srcW, 1, px, py + bobDy251 + dstH, dstW, rh - srcH);
        }
        if (rw > srcW) {
          ctx.drawImage(drawTex, drawTex.width - 1, ry, 1, srcH, px + dstW, py + bobDy251, rw - srcW, dstH);
        }
      }
      // ---- ★IIIII256 白色水面亮线沿水位线延伸过斜坡格水面段（用户明示偏差，2026-09-14）----
      // 【断线根因】平水面亮边 = 水面带 srcY=1280 顶 2px / Liquid_N 顶 2px（147,177,253）；
      // 坡面格的水最终呈现 = 实心层 pass（本 pass）的 LiquidSlope 斜面表——该表全暗
      // 无亮顶行，且画在背景 pass 平面带（ry=num6=0 时自带亮顶行）之后 ⇒ 亮线在坡面
      // 水面段被暗斜面水盖掉（drawImage 钩子实证：每帧 Liquid_0 亮带 → LiquidSlope
      // ×2 后画覆盖）。半砖格 slope=0 走平面带不受影响（亮线本就连续）。
      // 【修法】坡面 1/2（落地坡）且水位线横过格顶（上格无液体无实心=带顶即水面；
      // 上格有液 fU=水下坡不画、上格实心=水下顶板不画）时，以平面 Liquid_N 顶 2px
      // 亮边同位过画——方块贴图随后覆盖实心侧，亮线恰落在可见水面段上，与平水面
      // 亮线同色同厚（终色同为末次不透明绘制）。仅实心层 pass（坡面液体最后一次
      // 绘制）；3/4 为顶坡（水面不横过格顶）不画。bobDy251 随带同移（CPU bob 路）。
      // ★IIIII257 位移接线定谳：GL 路亮线的位移施加点 = compositeLight 末尾全屏
      // 扭曲 pass（GLWaterDistortion obj19，门控纹理=前景水离屏）——亮线像素在
      // uScene 内，gate 由 251 足迹（α≈0.02 饱和）在坡面楔形内交付；256 曾宣称
      // "GL 路随位移场波动"仅在 ?slopewave=1 灰度支成立，缺省足迹缺席 gate=0
      // =用户实报"亮线静止"的根因（255 verify-report off/on 臂对照实证）。转正
      // 后常开，?slopewave=0 回退（亮线仍在、静止同灰度期）。
      // ★BJ325:「上格实心」谓词=SolidTile 全式 → isSolidStrict（与 num4 门
      //   :4087 的 !SolidTile(above) 臂同源——本偏差门镜像该暴露条件,亮线只在
      //   带顶=可见水面时画;上格半砖/坡面(SolidTile=false)时带顶对下方 8px
      //   空腔暴露,亮线应画——宽谓词曾误判实心=漏画）。
      if (solidLayer && (slope === 1 || slope === 2) && Uq === 0 && !st.isSolidStrict(x, y - 1)
        && (fL || fR)) {
        ctx.globalAlpha = alpha;
        ctx.drawImage(tex, rx, 0, Math.min(rw, tex.width - rx), 2, px, py + bobDy251, rw, 2);
      }
    }
  }
  // ★liqpolish:带批段收尾（基底环续交;带 rec 在水 ADD 段之后=与直画序同）。
  // ★C13b:双臂任一开即收口（bandBatC13b 的 run 共享同一状态机,漏收=段永不发射）。
  if (bandBatOn || bandBatC13b) flushBandRun();
  if (bandBatOn && liqC13c) flushShimBandRun();   // ★C13c:带微光段收尾
  // ★IIIII251：足迹画完恢复 identity（beginFgPass 每帧重设变换，此处为防御复位）
  if (footprintCtx) footprintCtx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
}
