// ★BJ583（2026-10-09）宏伟蓝图电线显示复验——用户复报 BJ572「大部分时候都看不到电线」
//  （图 81=红线仅一段可见、图 82=暗区完全不可见）。
//  定谳锚（Terarria1457 亲读）：
//   · 门：WiresUI.Settings.DrawWires（WiresUI.cs:27-44）——手持 .mech 工具恒真 ∨
//     InfoAccMechShowWires（RefreshMechanicalAccsFromItemType Player.cs:12897-12901,
//     3619|3611;UpdateEquips :12997-13004 背包逐槽=在册即生效）∧ status[8]==0。
//   · 层序：DrawWires 唯二调用 Main.cs:63251/:63259——DrawDust(:63241)/DrawWaters
//     (:63248) 之后、接口层（1_2 标记 :47250/4 标尺 :45500）之前 = tile/实体/水之上。
//   · 光照：逐色 switch(builderAccStatus[4..7]/[9])（Main.cs:59162-59170）——
//     case 0 → Color.White【免光照】（装备透镜后【缺省档】,Player.cs:797 数组缺省全 0）;
//     case 1 → Lighting.GetColor（乘光）;case 2 → ×0.5;case 3 → 不画。
//     红线恒全 α（:59225 无 num7 除）;蓝绿黄 ×(1/num7)（:59294/:59395/:59496）。
//  本仓病灶：BJ572 落置位链后 wireModes=[0,0,0,0,0]（Bright 档）已注入 Game.ts:51833-51848,
//  但渲染单通道全塞世界层 → compositeLight 全屏乘光压黑（BJ325 定谳:乘光面=全屏光照图）
//  ——Bright 档原版不吃光 ⇒ 暗区电线不可见（图 82）/仅亮段可见（图 81）。
//  落刀=wireDrawPass（Renderer.ts 模块级导出）两通道分派：
//   light 档（mode 1/2）留世界层吃乘光=原版 case1/2 等效;bright 档（mode 0）延后至 7g
//   （compositeLight 后 drawWiresBright,7d 全亮尘/7a-pre 标尺同判例域）免乘光恒亮。
//  判别力（旧码必红）：§1 模式映射;§2 两通道行为分派（计数 ctx）;§3 层序/通道结构钉;
//  §4 红 α 钉;§5 Game 注入面（含 BJ569/572 不回归钉）。
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wireDrawPass, Renderer } from '../src/render/Renderer';

const HERE = dirname(fileURLToPath(import.meta.url));
const RDR_SRC = readFileSync(join(HERE, '..', 'src/render/Renderer.ts'), 'utf8');
const GAME_SRC = readFileSync(join(HERE, '..', 'src/core/Game.ts'), 'utf8');

// ================================================================
// §1 wireDrawPass 模式映射（Main.cs:59162-59170 switch 语义）
// ================================================================
describe('★BJ583 §1 wireDrawPass：模式→通道分派（Main.cs:59162-59170）', () => {
  it('mode 0 Bright → bright（Color.White 免光照——透镜缺省档,暗区恒亮的载体）', () => {
    expect(wireDrawPass(0)).toBe('bright');
  });
  it('mode 1 Normal → light（Lighting.GetColor 乘光——手持工具无透镜=亮处可见原版相）', () => {
    expect(wireDrawPass(1)).toBe('light');
  });
  it('mode 2 Faded → light（光照色×0.5——仍吃乘光,α 面在 drawWiresPass ×0.5）', () => {
    expect(wireDrawPass(2)).toBe('light');
  });
  it('mode 3 Hidden → hidden（Transparent 不画,num7-- 同步减）', () => {
    expect(wireDrawPass(3)).toBe('hidden');
  });
  it('undefined → light（调用面 `?? 1` 沿革,SW-FX19 Normal 缺省等价）', () => {
    expect(wireDrawPass(undefined)).toBe('light');
  });
});

// ================================================================
// §2 两通道行为分派（Renderer 实例 + 计数 ctx——旧单通道码必红）
// ================================================================
type DrawRec = { img: unknown; alpha: number };

/** 计数 ctx：记录每次 drawImage 的贴图身份与当时 globalAlpha */
const mkCtx = () => {
  const draws: DrawRec[] = [];
  const ctx = {
    draws,
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    save() { /* noop */ },
    restore() { /* noop */ },
    setTransform() { /* noop */ },
    translate() { /* noop */ },
    scale() { /* noop */ },
    drawImage(img: unknown) { draws.push({ img, alpha: ctx.globalAlpha }); },
  };
  return ctx;
};

/** 20×20 假世界 store：(3,3)(4,3)(5,3) 水平红线段 */
const mkWorld = (wireAt: Array<[number, number, number]>, actuatorAt: Array<[number, number]> = []) => {
  const W = 20, H = 20;
  const wire = new Uint8Array(W * H);
  for (const [x, y, bits] of wireAt) wire[y * W + x] |= bits;
  for (const [x, y] of actuatorAt) wire[y * W + x] |= 16;
  const store = {
    w: W, h: H, wire,
    type: new Uint16Array(W * H),
    flags: new Uint8Array(W * H),
    inBounds: (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H,
    idx: (x: number, y: number) => y * W + x,
  };
  return { store, world: { w: W, h: H, store } };
};

const WIRES_IMG = { tag: 'wires' };
const ACT_IMG = { tag: 'actuator' };
const CAM = { x: 64, y: 64 };   // 视窗 (2..6, 2..6) 覆盖 (3..5,3)

describe('★BJ583 §2 两通道行为分派（drawWiresPass/bright——乘光面逃生闸）', () => {
  let r: InstanceType<typeof Renderer>;
  beforeAll(async () => {
    (globalThis as Record<string, unknown>).Image = class {
      src = ''; onload: (() => void) | null = null;
      width = 0; height = 0;
      addEventListener() { /* noop */ }
    };
    // 全吸收桩（self-luminous-floor 同款）：构造器字段初始化链的任意 2D 调用都吞掉
    const anyStub = (): Record<string, unknown> => new Proxy(function stub() { /* noop */ } as unknown as Record<string, unknown>, {
      get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : anyStub()),
      set: () => true,
      apply: () => anyStub(),
      construct: () => anyStub(),
    });
    (globalThis as Record<string, unknown>).document = { createElement: () => anyStub() };
    (globalThis as unknown as { addEventListener: unknown }).addEventListener = () => {};
    (globalThis as Record<string, unknown>).window = { addEventListener: () => {}, removeEventListener: () => {} };
    r = new Renderer(null as never);
  }, 120000);

  const run = (modes: number[], pass: 'light' | 'bright', wireAt: Array<[number, number, number]>,
    actuatorAt: Array<[number, number]> = []) => {
    const ctx = mkCtx();
    const { world } = mkWorld(wireAt, actuatorAt);
    const rr = r as unknown as {
      showWires: boolean; wireModes: number[]; ctx: unknown;
      atlas: unknown;
      drawWiresPass(w: unknown, c: unknown, vw: number, vh: number, z: number, p: 'light' | 'bright'): void;
      drawWiresBright(w: unknown, c: unknown, vw: number, vh: number, z: number): void;
    };
    rr.showWires = true;
    rr.wireModes = modes;
    rr.ctx = ctx;
    rr.atlas = { ensureVImage: (p: string) => (p.includes('WiresNew') ? WIRES_IMG : ACT_IMG) };
    if (pass === 'bright') rr.drawWiresBright(world, CAM, 320, 320, 1);
    else rr.drawWiresPass(world, CAM, 320, 320, 1, pass);
    return ctx.draws;
  };

  it('② Bright 档（透镜缺省 [0,0,0,0,0]）：light 通道零笔（不再被乘光压黑）,bright 通道逐格落笔', () => {
    const light = run([0, 0, 0, 0, 0], 'light', [[3, 3, 1], [4, 3, 1], [5, 3, 1]]);
    expect(light.filter((d) => d.img === WIRES_IMG).length).toBe(0);
    const bright = run([0, 0, 0, 0, 0], 'bright', [[3, 3, 1], [4, 3, 1], [5, 3, 1]]);
    expect(bright.filter((d) => d.img === WIRES_IMG).length).toBe(3);
  });
  it('③ Normal 档（无透镜手持工具 [1,1,1,1,1]）：light 通道落笔（吃乘光=亮处可见）,bright 通道零笔', () => {
    const light = run([1, 1, 1, 1, 1], 'light', [[3, 3, 1], [4, 3, 1], [5, 3, 1]]);
    expect(light.filter((d) => d.img === WIRES_IMG).length).toBe(3);
    const bright = run([1, 1, 1, 1, 1], 'bright', [[3, 3, 1], [4, 3, 1], [5, 3, 1]]);
    expect(bright.filter((d) => d.img === WIRES_IMG).length).toBe(0);
  });
  it('Hidden 档（[3,3,3,3,3]）：两通道全零（Transparent 不画）', () => {
    const light = run([3, 3, 3, 3, 3], 'light', [[3, 3, 1]]);
    const bright = run([3, 3, 3, 3, 3], 'bright', [[3, 3, 1]]);
    expect(light.length).toBe(0);
    expect(bright.length).toBe(0);
  });
  it('④ 红恒全 α（:59225 无 num7 除）：同格红+蓝（mode1）红帧 α=1、蓝帧 α=0.5', () => {
    const draws = run([1, 1, 1, 1, 1], 'light', [[3, 3, 0b0011]]);
    expect(draws.length).toBe(2);
    const alphas = draws.map((d) => d.alpha).sort();
    expect(alphas).toEqual([0.5, 1]);
  });
  it('Faded 档（mode 2）light 通道 α=0.5（光照色×0.5）', () => {
    const draws = run([2, 2, 2, 2, 2], 'light', [[3, 3, 1]]);
    expect(draws.length).toBe(1);
    expect(draws[0].alpha).toBe(0.5);
  });
  it('致动器随通道分派：mode[4]=0 → bright 落笔/light 零笔;mode[4]=1 → light 落笔', () => {
    const b0 = run([0, 0, 0, 0, 0], 'bright', [], [[3, 3]]);
    expect(b0.filter((d) => d.img === ACT_IMG).length).toBe(1);
    const l0 = run([0, 0, 0, 0, 0], 'light', [], [[3, 3]]);
    expect(l0.filter((d) => d.img === ACT_IMG).length).toBe(0);
    const l1 = run([1, 1, 1, 1, 1], 'light', [], [[3, 3]]);
    expect(l1.filter((d) => d.img === ACT_IMG).length).toBe(1);
  });
  it('drawWiresBright 包装：showWires=false 整层不出笔;true 时 save/restore 配对+bright 落笔', () => {
    const rr = r as unknown as {
      showWires: boolean; wireModes: number[]; ctx: unknown; atlas: unknown;
      drawWiresBright(w: unknown, c: unknown, vw: number, vh: number, z: number): void;
    };
    const ctx = mkCtx();
    const { world } = mkWorld([[3, 3, 1]]);
    rr.showWires = false;
    rr.wireModes = [0, 0, 0, 0, 0];
    rr.ctx = ctx;
    rr.atlas = { ensureVImage: (p: string) => (p.includes('WiresNew') ? WIRES_IMG : ACT_IMG) };
    rr.drawWiresBright(world, CAM, 320, 320, 1);
    expect(ctx.draws.length).toBe(0);
    rr.showWires = true;
    rr.drawWiresBright(world, CAM, 320, 320, 1);
    expect(ctx.draws.filter((d) => d.img === WIRES_IMG).length).toBe(1);
  });
});

// ================================================================
// §3 层序/通道结构钉（源文本——通道搬位/删闸必红）
// ================================================================
describe('★BJ583 §3 层序与通道结构（Main.cs:63251/:63241/:45500 层序钉）', () => {
  const idxLightCall = RDR_SRC.indexOf('this.drawWires(world, cam, viewW, viewH, z);');
  const idxBrightCall = RDR_SRC.indexOf('this.drawWiresBright(world, cam, viewW, viewH, z);');
  // ★BJ730 改判史：旧锚 `…z, false);`——BJ679 实体直绘逃逸族（茎蔓/Faeling/fairy/
  //  鹿角怪）入水罩谓词给 fg 液体调用合法增尾参 entities。锚随新形,层序语义不变
  //  （fg 液体 < drawWires < compositeLight 实测 343977<344388<347216 在位）。
  const idxLiquidsFg = RDR_SRC.lastIndexOf('this.drawLiquids(world, cam, viewW, viewH, z, false, entities);');
  const idxComposite = RDR_SRC.indexOf('this.compositeLight(cam, viewW, viewH,');
  const idxRulers = RDR_SRC.indexOf('this.drawBuilderRulers(ctx, world, cam, viewW, viewH, z);');

  it('① 机械工具态 wire 层序=tile 上层：drawWires(4.55) 在前景液体（=tile/实体绘制段尾）之后', () => {
    expect(idxLightCall).toBeGreaterThan(-1);
    expect(idxLiquidsFg).toBeGreaterThan(-1);
    expect(idxLightCall).toBeGreaterThan(idxLiquidsFg);
  });
  it('①② light 通道在世界层内（compositeLight 之前=吃乘光,原版 case1/2 Lighting.GetColor 等效）', () => {
    expect(idxLightCall).toBeGreaterThan(-1);
    expect(idxComposite).toBeGreaterThan(-1);
    expect(idxLightCall).toBeLessThan(idxComposite);
  });
  it('② Bright 通道在 compositeLight 之后（免乘光=Color.White 恒亮,7g 位）', () => {
    expect(idxBrightCall).toBeGreaterThan(-1);
    expect(idxBrightCall).toBeGreaterThan(idxComposite);
  });
  it('② 层序收口：Bright 通道在接口层（7a-pre 标尺）之前=原版 DrawWires<接口层序', () => {
    expect(idxRulers).toBeGreaterThan(-1);
    expect(idxBrightCall).toBeLessThan(idxRulers);
  });
  it('③ 通道闸钉：世界层不越权画 bright（分派 continue 闸在位）', () => {
    expect(RDR_SRC).toContain('if (wireDrawPass(this.wireModes[c]) !== pass) continue;');
  });
  it('num7 同账钉：Hidden 色不计入同格色数（wireDrawPass!==hidden）', () => {
    expect(RDR_SRC).toContain("wireDrawPass(this.wireModes[c]) !== 'hidden'");
  });
  it('drawWiresBright 体：c10e 垫底在位+零光照采样（免乘光本体）', () => {
    const i0 = RDR_SRC.indexOf('private drawWiresBright');
    const i1 = RDR_SRC.indexOf('private drawWiresPass');
    expect(i0).toBeGreaterThan(-1);
    expect(i1).toBeGreaterThan(i0);
    const body = RDR_SRC.slice(i0, i1);
    expect(body).toContain('c10eCompositeIntoHud');
    expect(body).not.toContain('lightR');
  });
});

// ================================================================
// §4 红 α 钉（Main.cs:59225 红无 num7 除 vs :59294/:59395/:59496）
// ================================================================
describe('★BJ583 §4 红恒全 α（Main.cs:59225）', () => {
  it('fadeAlpha 分色钉：红=1,蓝绿黄=×(1/n)（旧码红也吃 1/n=偏差已顺刀对齐）', () => {
    expect(RDR_SRC).toContain('const fadeAlpha = c === 0 ? 1 : (n > 1 ? 1 / n : 1);');
  });
});

// ================================================================
// §5 Game 注入面（③原版相 + BJ569/572 不回归）
// ================================================================
describe('★BJ583 §5 Game.ts wireModes 注入面（BJ572 链不回归+Normal 原版相）', () => {
  it('装备态读 builderAccStatus 四色+致动器（mechShowWires 门后,BJ572 面③链尾）', () => {
    expect(GAME_SRC).toContain('const w8 = this.player.equipStats.mechShowWires;');
    expect(GAME_SRC).toContain('BACC.WireVisibility_Red]');
    expect(GAME_SRC).toContain('BACC.WireVisibility_Blue]');
    expect(GAME_SRC).toContain('BACC.WireVisibility_Green]');
    expect(GAME_SRC).toContain('BACC.WireVisibility_Yellow]');
    expect(GAME_SRC).toContain('BACC.WireVisibility_Actuators]');
  });
  it('③ 无透镜回退 [1,1,1,1,1]=Normal（light 通道吃乘光=手持工具亮处可见/暗处不可见原版相）', () => {
    expect(GAME_SRC).toContain(': [1, 1, 1, 1, 1];');
  });
  it('④ BJ572 showWires 门原样（mechShowWires ∧ status[8]==0,3611 置位链不回归）', () => {
    expect(GAME_SRC).toContain('this.player.equipStats.mechShowWires && this.player.builderAccStatus[BACC.HideAllWires] === 0');
  });
  it('④ BJ569 3611 置位支原样（refreshMechanicalAccsFromItemType 3619|3611,Player.ts 域）', () => {
    const PSRC = readFileSync(join(HERE, '..', 'src/entities/Player.ts'), 'utf8');
    expect(PSRC).toContain('if (vid === 3619 || vid === 3611) m.mechShowWires = true;');
  });
  it('④ BJ583 key 表补 3611：INV_EFFECTIVE_VIDS 机械族段含 3611（漏键=蓝图入包不失效缓存）', () => {
    const PSRC = readFileSync(join(HERE, '..', 'src/entities/Player.ts'), 'utf8');
    expect(PSRC).toContain('3619, 3611, 3624, 2216, 3061, 5126, 4767, 5323, 4346, 5095, 6190,');
  });
  it('④ BJ583 key 表补 3611：MECH_ACC_VIDS 同步（虚空袋段,「改其一必同步另一」不变式;★BJ563 补齐 4346/5095/6190 后恒等 INV 机械族段）', () => {
    const PSRC = readFileSync(join(HERE, '..', 'src/entities/Player.ts'), 'utf8');
    expect(PSRC).toContain('const MECH_ACC_VIDS = new Set<number>([3619, 3611, 3624, 2216, 3061, 5126, 4767, 5323, 4346, 5095, 6190]);');
  });
  // ★BJ585（2026-10-13 用户实报连带定谳）：注入序=线色位序[红,蓝,绿,黄,致动器]，而
  //  status[5]=蓝线/status[6]=绿线（Main.cs:59276 num3=status[5]→wire2=蓝、:59377
  //  num4=status[6]→wire3=绿）——反编译枚举名 WireVisibility_Green=5/Blue=6
  //  （Player.cs:44-48）与行为错位=原版自身命名 quirk（hover Main.cs:48304-48306
  //  num3=5→Game.BlueWires、sheet 实测列5=蓝图标(20,65,98) 均随行为走）。
  //  旧码按枚举名序注入=蓝/绿两线可见度互换（点蓝图标动绿线）。旧 §5 键名存在性
  //  锁对此无判别力（两键都在=绿）,本用例锁【位序】补盲区。
  it('⑤ 蓝/绿互换刀：wireModes 注入位序=[红线,蓝线(s5),绿线(s6),黄线,致动器]（枚举名 quirk 锁,旧序必红）', () => {
    const m = GAME_SRC.match(/wireModes = w8\s*\?\s*\[([\s\S]*?)\]\s*:/);
    expect(m).toBeTruthy();
    const order = m![1].split(',').map((s) => s.trim()).filter(Boolean);
    expect(order).toHaveLength(5);
    expect(order[0]).toContain('BACC.WireVisibility_Red');
    expect(order[1]).toContain('BACC.WireVisibility_Green');   // =status[5]【蓝线】（枚举名错位）
    expect(order[2]).toContain('BACC.WireVisibility_Blue');    // =status[6]【绿线】（枚举名错位）
    expect(order[3]).toContain('BACC.WireVisibility_Yellow');
    expect(order[4]).toContain('BACC.WireVisibility_Actuators');
  });
  // ★BJ585 图标面：原版态渲染=SpriteBatch tint【RGB 暗化】非 α 半透明——线材族四态
  //  （Main.cs:48288-48290:0 White/1 Color(127,127,127) 不透明/2 MultiplyRGBA(0.66)
  //  =(83,α168)/3 MultiplyRGBA(0.33)=(41,α84)）;二态族 off 同为 (127,127,127) 暗灰
  //  （:48168）。旧码三态折叠 opacity 0.497=「经典/褪色像透明」病灶。UI 源锁：
  it('⑤ 图标四态 tint 链：brightness(127/255)/(83,α168)/(41,α84)+二态 off 暗灰（UI.ts paintSlot,三态折叠 opacity 必红）', () => {
    const USRC = readFileSync(join(HERE, '..', 'src/ui/UI.ts'), 'utf8');
    expect(USRC).toContain('brightness(${127 / 255})');
    expect(USRC).toContain('brightness(${83 / 255})');
    expect(USRC).toContain('brightness(${41 / 255})');
    expect(USRC).toContain('${168 / 255}');
    expect(USRC).toContain('${84 / 255}');
    expect(USRC).not.toContain("b.style.opacity = on ? '1' : '0.497'");
  });
});
