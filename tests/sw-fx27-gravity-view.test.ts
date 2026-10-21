// SW-FX27 波 2：反重力呈现面翻转 + 输入换算（GameViewMatrix.Effects=FlipVertically 域）。
//  金标：Main.cs:62944-62945（Effects 门）/ :2835-2842（MouseWorld 逆变换）/
//  :3242-3271（ReverseGravitySupport 三重载）/ Utils.cs:1130-1138（ToScreenPosition /
//  ScreenToWorldPosition = 翻转矩阵正逆）/ :47397-47399（DrawSmartCursor 屏位手翻）/
//  :46504-46510（签名泡手翻）/ SmartSelectGamepadPointer.cs:23-38（目标格反演式）/
//  SmartCursorHelper.cs:2435-2441（num9 gravDir 档）/ :196（轨道 314 让位门）。
//  ★主判据 = gd=1 逐位恒等：flipY 缺省 false 时 screenToWorld/worldToScreen 与
//  旧式（本文件内联的 legacy 式）逐位相同；gd=-1 分支只在 flipY 置位后可达。
//  ★变异证红：每组断言标注「旧实现退化值」——回退任一刀对应组必红（M1-M3 见组注）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Camera } from '../src/render/Camera';
import { SmartSelect } from '../src/player/SmartSelect';
import type { SmartSelectEnv } from '../src/player/SmartSelect';

const SRC = (p: string): string => readFileSync(join(import.meta.dirname, '..', 'src', p), 'utf8');

// 旧实现参照式（FX27 改造前 Camera.ts:61-66 原文——gd=1 恒等判据的基准）
function legacyWorldToScreen(c: Camera, wx: number, wy: number): [number, number] {
  return [(wx - c.x + c.punchX) * c.zoom + c.viewW / 2, (wy - c.y + c.punchY) * c.zoom + c.viewH / 2];
}
function legacyScreenToWorld(c: Camera, sx: number, sy: number): [number, number] {
  return [(sx - c.viewW / 2) / c.zoom + c.x, (sy - c.viewH / 2) / c.zoom + c.y];
}

function makeCam(): Camera {
  const c = new Camera(8400, 2400);
  c.viewW = 800; c.viewH = 600;
  c.x = 1000; c.y = 2000;
  c.zoom = 1.25;
  return c;   // punchX/punchY 缺省 0（tickPunch 才写）
}

const SCREEN_PTS: Array<[number, number]> = [
  [0, 0], [799, 599], [400, 300], [123, 456], [1, 1], [640, 480],
];

describe('Camera gd=1 逐位恒等（主判据；flipY 缺省 false）', () => {
  it('flipY 缺省 false——gd=1 玩家零基线差', () => {
    expect(new Camera(100, 100).flipY).toBe(false);   // 旧实现退化值：无此字段（恒 false 同面）
  });
  it('screenToWorld/worldToScreen 与旧式逐位全等（zoom=1.25 非整数档）', () => {
    const c = makeCam();
    for (const [sx, sy] of SCREEN_PTS) {
      const [wx, wy] = c.screenToWorld(sx, sy);
      const [lx, ly] = legacyScreenToWorld(c, sx, sy);
      expect(wx).toBe(lx);   // ★逐位（===）——任何式序改动即红
      expect(wy).toBe(ly);
    }
    for (const [wx, wy] of [[1000, 2000], [100.5, 2000.25], [640, 480]] as const) {
      const [sx, sy] = c.worldToScreen(wx, wy);
      const [lx, ly] = legacyWorldToScreen(c, wx, wy);
      expect(sx).toBe(lx);
      expect(sy).toBe(ly);
    }
  });
});

describe('Camera gd=-1 激活面（ReverseGravitySupport / MouseWorld 逆变换）', () => {
  it('flipY=true：screenToWorld(mx,my) ≡ 旧式(mx, viewH-my) 逐位（M1：删翻转分支此组红）', () => {
    const c = makeCam();
    c.flipY = true;
    for (const [sx, sy] of SCREEN_PTS) {
      const [wx, wy] = c.screenToWorld(sx, sy);
      const [lx, ly] = legacyScreenToWorld(c, sx, c.viewH - sy);   // ReverseGravitySupport(MouseScreen) :3242-3250
      expect(wx).toBe(lx);
      expect(wy).toBe(ly);
    }
  });
  it('MouseWorld 原式等价（Main.cs:2835-2842 result.Y = screenPosition.Y + screenHeight - mouseY）', () => {
    const c = makeCam();
    c.flipY = true;
    for (const [sx, sy] of SCREEN_PTS) {
      const [, wy] = c.screenToWorld(sx, sy);
      const screenTopY = c.y - c.viewH / 2 / c.zoom;
      const screenHeight = c.viewH / c.zoom;              // 世界比例屏高（SetZoom_World 口径）
      const mouseYWorld = sy / c.zoom;                    // 裸鼠标 Y → 世界比例屏 px
      expect(Math.abs(wy - (screenTopY + screenHeight - mouseYWorld))).toBeLessThan(1e-8);
    }
  });
  it('worldToScreenDisplayed：显示位 = 翻转(旧式)（Utils.cs:1131 ToScreenPosition 逆矩阵语义；gd=1 恒等）', () => {
    const c = makeCam();
    const [dx1, dy1] = c.worldToScreenDisplayed(1000, 2000);
    const [lx, ly] = legacyWorldToScreen(c, 1000, 2000);
    expect(dx1).toBe(lx);
    expect(dy1).toBe(ly);                                  // gd=1：逐位同旧式
    c.flipY = true;
    const [dx2, dy2] = c.worldToScreenDisplayed(1000, 2000);
    expect(dx2).toBe(lx);
    expect(dy2).toBe(c.viewH - ly);                        // gd=-1：y'=viewH-y（:47397 手翻语义）
  });
  it('往返一致性：worldToScreenDisplayed(screenToWorld(mx,my)) = (mx,my)（翻转态）', () => {
    const c = makeCam();
    c.flipY = true;
    for (const [sx, sy] of SCREEN_PTS) {
      const [wx, wy] = c.screenToWorld(sx, sy);
      const [bx, by] = c.worldToScreenDisplayed(wx, wy);
      expect(Math.abs(bx - sx)).toBeLessThan(1e-6);
      expect(Math.abs(by - sy)).toBeLessThan(1e-6);
    }
  });
});

describe('SmartSelect 目标格反演（SmartSelectGamepadPointer.cs:23-38）', () => {
  const sel = new SmartSelect();
  const call = (env: SmartSelectEnv): { tX: number; tY: number } =>
    (sel as unknown as { getTargetTile(e: SmartSelectEnv): { tX: number; tY: number } }).getTargetTile(env);

  it('gd=1：普通式 floor(mouseY/16)（翻转支不达——旧实现退化值=钉 gravDir:1 同面）', () => {
    const env = {
      controlTorch: false, usingGamepad: false, st: {} as never,
      mouseX: 1440, mouseY: 1450,
      screenTopY: 1000, screenHeight: 600,
      player: { x: 0, y: 0, w: 20, h: 42, gravDir: 1, wet: false },
    } as unknown as SmartSelectEnv;
    expect(call(env).tY).toBe(Math.floor(1450 / 16));
  });
  it('gd=-1：rawMouseYWorldScale 喂原式 → (screenTopY+screenHeight-rawY)/16（M2：喂翻转后世界 Y = 二次反演 → 71≠90 必红）', () => {
    // 场景：视口 600（zoom=1），裸鼠标屏 Y=150 → 翻转态鼠标下世界 Y = 1000+600-150 = 1450
    const env = {
      controlTorch: false, usingGamepad: false, st: {} as never,
      mouseX: 1440, mouseY: 1450,              // env.mouseY = 翻转修正后世界 Y（camera.screenToWorld 产物）
      rawMouseYWorldScale: 150,                // 裸鼠标世界比例屏 Y（rawScreenY/zoom）
      screenTopY: 1000, screenHeight: 600,
      player: { x: 0, y: 0, w: 20, h: 42, gravDir: -1, wet: false },
    } as unknown as SmartSelectEnv;
    expect(call(env).tY).toBe(90);             // (1000+600-150)/16 = 90 —— 原式直算
    expect(call(env).tY).toBe(Math.floor(1450 / 16));   // 与普通式（翻转修正世界 Y）一致
    // 变异对照：二次反演（把翻转后世界 Y 当裸屏 Y 再反演）= 71 ≠ 90 —— 本组对它红
    expect(Math.floor((1000 + 600 - (1450 - 1000)) / 16)).toBe(71);
  });
});

describe('结构锁（源文本锚——防静默回退/整文件覆写）', () => {
  it('Camera：screenToWorld 内置 ReverseGravitySupport 门（在换算 return 之前）', () => {
    const src = SRC('render/Camera.ts');
    const gate = src.indexOf('if (this.flipY) sy = this.viewH - sy;');
    const ret = src.indexOf('return [(sx - this.viewW / 2) / this.zoom + this.x');
    expect(gate).toBeGreaterThan(-1);        // M1 变异：删此行 → 本断言红
    expect(ret).toBeGreaterThan(gate);       // 门在换算前（先翻 Y 再换算）
    expect(src).toContain('worldToScreenDisplayed');
    expect(src).toContain('Main.cs:62944');  // 金标行号锚
    expect(src).toContain('2835-2842');      // MouseWorld 逆变换锚（:2835-2842）
  });
  it('Renderer：翻转点存在且门=cam.flipY && !_capturePass，y\'=viewH-y 镜像序', () => {
    const src = SRC('render/Renderer.ts');
    expect(src).toContain('if (cam.flipY && !this._capturePass) {');
    expect(src).toContain('ctx.translate(0, viewH);');
    expect(src).toContain('ctx.scale(1, -1);');
    // 翻转点在星露谷过场（世界锚定内容末笔）之后、告示牌文本块（屏空间文字层）之前
    const stardew = src.indexOf('drawStardewAnimation(ctx, viewW, viewH);');
    const flip = src.indexOf('if (cam.flipY && !this._capturePass) {');
    const signBlock = src.indexOf("const [mwx, mwy] = cam2.screenToWorld(this._mouseX, this._mouseY);");
    expect(stardew).toBeGreaterThan(-1);
    expect(flip).toBeGreaterThan(stardew);
    expect(signBlock).toBeGreaterThan(flip);
    expect(src).toContain('worldToScreenDisplayed');   // 显示位消费面（签名泡/月总脉冲/遮屏孔）
    expect(src).toContain('Main.cs:62944');            // 金标行号锚
    expect(src).toContain('CaptureCamera');            // capture 不翻的锚注
  });
  it('Game：单点同步 cam.flipY = player.gravDir === -1（玩家 update 后;渲染帧头点被 interp 波合法收敛）', () => {
    // ★BJ704 裁决（2026-10-21,sw-fx27 伪红翻案）：33a65b85（interp 渲染插值,2026-10-14）
    //  移除了渲染帧头第二次 `cam.flipY = ...` 同步。定谳=合法收敛而非回归：gravDir
    //  全部写位（fixedUpdateBody :6072/bordersMovement :11313/buff 域 :13189-13224/
    //  入睡 :30537）都在玩家 update 链内、先于 fixedUpdate 尾的单点同步（:10574）;
    //  渲染期纯读零 gravDir 写位（interp 块只 lerp 位置 x/y,渲染后还原,不触 flipY）
    //  → 帧头二次同步本就冗余（belt-and-braces 镜像原版 Main.cs:62944 Draw 头读,
    //  interp 块接管帧头后合并）。锁随迁=恰 1 点 + interp 块零 flipY 写。
    const src = SRC('core/Game.ts');
    expect(src.match(/flipY = (?:this\.)?player\.gravDir === -1;/g)?.length).toBe(1);
    // interp 临时写块不触 flipY（位置 lerp 专属——flipY 翻转非连续量不可 lerp）
    const iBlk = src.slice(src.indexOf('const iA = Game.interp'), src.indexOf('this.renderer.render('));
    expect(iBlk).not.toMatch(/flipY/);
    expect(src).toContain('rawMouseYWorldScale: inp.mouseY / this.camera.zoom');
    expect(src).not.toContain('gravDir: 1,                              // 反重力未实装');   // 旧钉值退役
    expect(src).toContain('gravDir: p.gravDir');
  });
  it('SmartCursor：:2435 倒挂支 + :196 轨道 314 让位门 gravDir 实况', () => {
    const src = SRC('player/SmartCursor.ts');
    expect(src).toContain('if (gravDir === -1 && signY === 0) num9++;');
    expect(src).toContain('if (gravDir === 1 && signX === 0) num9++;');
    expect(src).toContain('if (sheet === 314 && gravDir === 1) return true;');
    expect(src).toContain('gravDir?: number');
  });
  it('SmartSelect：env 增 rawMouseYWorldScale，翻转支消费裸鼠标（结构保留）', () => {
    const src = SRC('player/SmartSelect.ts');
    expect(src).toContain('rawMouseYWorldScale?: number');
    expect(src).toContain('env.rawMouseYWorldScale ?? (env.mouseY - env.screenTopY)');
    expect(src).toContain('if (env.player.gravDir === -1) {');
  });
});

// ═══ ★SW-RB13a（2026-09-11）红蓝对抗批：翻转点后屏空间层镜像三刀 ═══
// 金标：Main.cs:46504-46516 SignTileBubble（1458 :46516 同值）/ ScreenObstruction.cs:50-58
// （1458 :54-57 同值）/ Main.cs:47046-47140 DrawInterface_4_Ruler（1458 :47079/:47108 同值）。
describe('SW-RB13a 签名泡 −32（翻转支独立补偿，消费端只有 −22）', () => {
  it('源锁：翻转支含 -32，消费端 num2−22 两态同式', () => {
    const src = SRC('render/Renderer.ts');
    expect(src).toContain('y: Math.round(cam2.flipY ? viewH - sbyRaw - 32 : sbyRaw),');
    expect(src).toContain('const num2 = this.signBubbleScreen.y - 22;');
    expect(src).not.toContain('viewH - sbyRaw : sbyRaw');   // 旧缺 −32 式退役
  });
  it('代数：zoom=1 时翻转泡位 ≡ 原版 num2 = H−(signY−screenTop)−32−22（worked example）', () => {
    // 场景：H=600、screenTopY=1000、signY=1200（锚顶行）→ 原版翻转泡 y = 600−200−32−22 = 346
    const H = 600, signY = 1200, screenTopY = 1000;
    const sbyRaw = signY - screenTopY;                      // zoom=1 时 worldToScreen ≡ 世界偏移
    const repoFlip = H - sbyRaw - 32 - 22;                  // 锚支 −32 + 消费端 −22
    const vanilla = H - (signY - screenTopY) - 32 - 22;     // :46508 + :46517
    expect(repoFlip).toBe(vanilla);
    expect(repoFlip).toBe(346);
    // 旧实现（无 −32）= 378 → 泡下坠 32px 覆盖签面（翻转态签体显示带 [M−32,M]）
    expect(H - sbyRaw - 22).toBe(378);
  });
});

describe('SW-RB13a 遮屏孔翻转镜像（孔 = gd=1 孔的整幅显示镜像）', () => {
  it('源锁：翻转支锚 = pyAnchor − h + num2（num2 头侧偏移随镜像换边）', () => {
    const src = SRC('render/Renderer.ts');
    expect(src).toContain('const py = cam.flipY ? pyAnchor - player.h + num2 : pyAnchor;');
    expect(src).not.toContain('cam.flipY ? pyAnchor - player.h : pyAnchor');   // 旧式退役
  });
  it('代数：翻转孔 ≡ gd=1 孔绕 viewH/2 镜像（worked example，zoom 无关）', () => {
    // H=600；gd=1：worldToScreen(player.y)=100 → 孔 = [100+21−55, +100] = [66,166]
    // 整幅翻转后孔应落在 [600−166, 600−66] = [434,534]
    const H = 600, h = 42, rh = 100, num2 = 10, pyW = 100;
    const topNormal = pyW + h / 2 - rh / 2 + num2 / 2 - num2;         // 66
    expect(topNormal).toBe(66);
    const wantTop = H - (topNormal + rh);                             // 434
    // 修后翻转支：pyAnchor=H−pyW=500 → py=500−42+10=468 → top=468+21−55=434
    const pyAnchor = H - pyW;
    const py = pyAnchor - h + num2;
    const topFlip = py + h / 2 - rh / 2 + num2 / 2 - num2;
    expect(topFlip).toBe(wantTop);
    // 旧式（pyAnchor−h 后复用同式）= 424 → 孔上移 10px（顶部露缝/底部压头）
    expect(pyAnchor - h + h / 2 - rh / 2 + num2 / 2 - num2).toBe(424);
  });
});

describe('SW-RB13a 标尺线翻转双锚（距离锚 num7 / 画线锚 num11 / 鼠标行 +16px）', () => {
  it('源锁：dyDraw/mouseTyFlip 分离，画位行走 dyDraw（gd=1 三处增量全 0 = 逐位恒等）', () => {
    const src = SRC('render/Renderer.ts');
    expect(src).toContain('const dyDraw = dy - (r.gravDir === -1 ? 1 : 0);');
    expect(src).toContain('const mouseTyFlip = r.mouseTy + (r.gravDir === -1 ? 1 : 0);');
    expect(src).toContain('const ddy0 = mouseTyFlip - dy;');                 // num9 距离（★FX36 重构更名 ddy→ddy0,语义同 num9;并落 rulerReadoutText W×H 计数控）
    expect(src).toContain('dx * ts, dyDraw * ts, 16, 16');                   // 横段画位
    expect(src).toContain('let dyRun = dyDraw;');                            // 竖段画位
    expect(src).not.toContain('let ddy = r.mouseTy - dy;');                  // 旧单锚式退役
  });
  it('代数：翻转态 worked example ≡ 原版 num7/num11/num9（feet=100, mouseTy=90）', () => {
    // 原版翻转态：num7=100−1=99（距离锚）；鼠标行=(90·16+16)/16=91；num9=91−99=−8；
    // 画线锚 num11=num7−1=98。旧码：dy=99 单锚、ddy=90−99=−9、画位 99 —— 双偏差。
    const feetTy = 100, mouseTy = 90;
    const num7 = feetTy - 1;
    const mouseRow = Math.floor((mouseTy * 16 + 16) / 16);
    const num9 = mouseRow - num7;
    const num11 = num7 - 1;
    expect([num7, mouseRow, num9, num11]).toEqual([99, 91, -8, 98]);
    const dy = feetTy - 1;
    const dyDraw = dy - 1;
    const ddy = (mouseTy + 1) - dy;
    expect([dy, ddy, dyDraw]).toEqual([num7, num9, num11]);
  });
});
