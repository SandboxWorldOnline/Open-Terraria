// ★BJ559 绳索攀爬滑轮贴图（用户实报：原版攀绳时角色头顶有钩子/齿轮状滑轮，本仓未实装）——定谳+守卫（亲读 1457 反编译）：
//
//   原版绘制面：DrawPlayer_24_Pulley（PlayerDrawLayers.cs:3034-3056）——
//     门 = `drawPlayer.pulley && drawPlayer.itemAnimation == 0`（:3036）。
//     贴图 = TextureAssets.Pulley = Images\PlayerPulley（AssetInitializer.cs:610），
//     26×72 两帧竖排（帧 26×36），源矩形 (0, 高/2·pulleyFrame, 宽, 高/2)。
//     ★BJ576（2026-10-09 用户复报"滑轮叠头前"）origin 勘误：(宽/2, 高/4)=(13,72/4=18)
//     ——XNA/FNA SpriteBatch origin 相对【源矩形】左上（源矩形高 36 → 18=帧中心），
//     旧注 (13,9) 系误用帧高/4 推导=帧上沿 1/4 处，滑轮整体低 9px（轮体密集带落
//     脸部 p.y+1..p.y+8=复报病灶；正确锚轮体带 p.y−8..p.y−1=头顶）。
//     分档（:3038-3054）：
//       侧挂档（pulleyDir==2，X 钉绳列 ±6px）：num=−25/num2=0/rotation=0 →
//         世界位 x = Center.X + (0−9)·direction = centerX−9·dir，y = Position.Y + h/2 + 2 + (−25) = centerY−23（gravDir=1）；
//       居中档（pulleyDir==1，X 钉绳列中心）：num3=−26/num4=10/rotation=0.35·(−direction) →
//         x = centerX + (10−9)·dir = centerX+1·dir，y = centerY−24。
//     Position = position + netOffset + (0, gfxOffY)（PlayerDrawSet.cs:341+LegacyPlayerRenderer.cs:475）。
//     染色 = colorArmorHead（PlayerDrawSet.cs:451 头位光照 (Center.X/16,(Top+h/4)/16) 采光×免疫闪）。
//     层序 = 23_MountFront 后、32_FrontAcc_BackPart/25_Shield/27_HeldItem 前（LegacyPlayerRenderer.cs:228）。
//     帧推进 = Player.cs:26661-26681（pulley 块尾 X 吸附 :26644-26660 后、DashMovement :26691 前，
//     块内无条件——含 inputDown 穿落离绳拍 vy=1 照推进）：counter += |vy|·0.75、vy≠0 再 +0.75；
//     counter>10 → pulleyFrame++ 归零；frame>1 归 0。字段 pulleyFrame/:1057、pulleyFrameCounter/:1059。
//
//   本仓差异（定谳）：BJ527 已落 pulley 物理/冲刺面，绘制面整缺（全仓 grep pulley 无 drawImage 消费）；
//   贴图资产已在库（public/sprites/vanilla/PlayerPulley.png，sha256 与 terraria-assets 提取源逐字节全等
//   ——ensureVImage 按路径直载，非 vanilla.json 注记键，无需 atlas-append 通道）。
//
//   落刀：Player.ts pulleyFrame/pulleyFrameCounter 字段 + advancePulleyFrame()（branch1 门 this.pulley /
//   branch2 支尾无条件，均在 dashMovement 前=原版块序）；Renderer.ts drawPulleyLayer（镜像空间化简：
//   局部 x=numX−6.5（含脚底锚 −facing·2.5 并冲）、局部 y=numY+2−h/2（42 → 侧挂 −44/居中 −45）、
//   局部 rot 恒 −0.35（mirror∘rotate(θ)=rotate(−θ)∘mirror：facing·0.35·−facing=−0.35，playerEffect
//   水平翻转被外层 scale(facing,1) 吸收）），调用位 = 本体层后 drawAccFrontLayers 前。
//
//   登记偏差：①XNA (int) 屏幕逐帧取整不仿（全玩家层 float 惯例）；②本仓体绘不消费 pulley snap 的
//   gfxOffY（滑轮随体锚= glued to body；原版 Position 含 gfxOffY）——体绘既有约定（绳锚批 2026-08-19）；
//   ③联机远端 pulley/pulleyFrame 不同步（swingNet/msg13 无此位，登记）。
//
// 变异证红映射（本文件）：
//   M1 侧挂锚 −44→−45（numY 档互换）      → T2 红（translate y 钉值），T1/T3 绿；
//   M2 摘 inUse 门（或摘 !p.pulley 门）    → T4 红（使用中/非 pulley 态误画）；
//   M3 居中 rot −0.35→0                   → T1 红（rotate 缺席）；
//   M4 branch1 推进摘 this.pulley 门       → T8 红（非 pulley 绳攀误推进 counter=0.9）；
//   M5 帧公式摘 +0.75（vy≠0 项）           → T6 红（counter 6.75→6.0 钉值）、T7 红（2 拍不翻帧）；
//   M6 换贴图路径/资产                     → T0 红（sha256 对拍）。
// ★BJ570（2026-10-08 用户复报：静止挂绳滑轮不显、按上下键才显）新增：
//   M7 branch1 门摘 this.pulley（BJ570 落刀位）→ T8 后半红（非 pulley 贴绳复攀 vy<0）、
//      T10/T11 仍绿（pulley 态不受影响）——恰红=判别面单腿；
//   M8 pulleySnap 摘 pulley=true            → T8①/T9/T10/T11 红（吸附置位断链）。
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-ignore pngjs 无类型声明（tests/bj241-radio-thing-733-draw.test.ts 同用法）
import { PNG } from 'pngjs';
import { Renderer } from '../src/render/Renderer';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { TILE_INTERNAL_BY_SHEET } from '../src/data/tiles';
import type { GameHooks } from '../src/entities/types';
// ★C档可移植:仓库外依赖(game/ 兄弟目录,clone 侧缺=正常形态)——缺则本文件 skip,本机在=真跑零语义变化
const EXT_MISSING = !['terraria-assets'].every((d) => existsSync(new URL(`../../${d}`, import.meta.url)));


const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ================= T0 贴图资产：逐字节还原 + sha256 对拍 =================

const GOLD_SHA = '3fbfe97e0aa4bbcfa999b725afec72a902d784a1c51438dbdea7557f2523872e';

describe.skipIf(EXT_MISSING)('BJ559 T0 PlayerPulley.png 资产（AssetInitializer.cs:610 Images/PlayerPulley）', () => {
  it('sha256 与 terraria-assets 提取源逐字节全等（三源对拍：terraria-assets=public=金标）', () => {
    const src = readFileSync(join(ROOT, '..', 'terraria-assets', 'Images', 'PlayerPulley.png'));
    const pub = readFileSync(join(ROOT, 'public', 'sprites', 'vanilla', 'PlayerPulley.png'));
    const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
    expect(sha(src)).toBe(GOLD_SHA);
    expect(sha(pub)).toBe(GOLD_SHA);
  });

  it('PNG 几何 26×72（两帧竖排 26×36/帧——源矩形 高/2 公式的资产前提）', () => {
    const png = PNG.sync.read(readFileSync(join(ROOT, 'public', 'sprites', 'vanilla', 'PlayerPulley.png')));
    expect(png.width).toBe(26);
    expect(png.height).toBe(72);
  });
});

// ================= T1-T5 绘制面钉值（记录型 ctx 直调,accessory-systematic 同款假体） =================

/** 记录型 ctx：按序捕获 save/translate/rotate/drawImage/restore */
function recCtx() {
  const ops: Array<{ op: string; a?: number; b?: number; img?: unknown; rest?: number[] }> = [];
  const ctx = {
    save: () => ops.push({ op: 'save' }),
    restore: () => ops.push({ op: 'restore' }),
    translate: (a: number, b: number) => ops.push({ op: 'translate', a, b }),
    rotate: (a: number) => ops.push({ op: 'rotate', a }),
    scale: () => {},
    drawImage: (...args: unknown[]) => ops.push({ op: 'drawImage', img: args[0], rest: args.slice(1) as number[] }),
    canvas: undefined,
  } as unknown as CanvasRenderingContext2D;
  return { ops, ctx };
}

/** 假 atlas：26×72 记录加载键；changeable 尺寸供 高/2 动态公式钉值 */
function fakeAtlas(files: string[], img = { width: 26, height: 72 }) {
  return {
    ensureVImage: (f: string) => {
      files.push(f);
      return img as unknown as HTMLImageElement;
    },
  };
}

function drawPulley(p: Player, atlas: unknown, inUse = false, img?: { width: number; height: number }) {
  const files: string[] = [];
  const { ops, ctx } = recCtx();
  const proto = Renderer.prototype as unknown as Record<string, (...a: unknown[]) => void>;
  proto.drawPulleyLayer.call(
    { ctx, atlas: atlas ?? fakeAtlas(files, img) } as unknown as Renderer,
    ctx, p, inUse,
  );
  return { ops, files };
}

describe.skipIf(EXT_MISSING)('BJ559 T1-T5 drawPulleyLayer（DrawPlayer_24_Pulley :3034-3056 钉值）', () => {
  it('T1 居中档（pulleyDir=1）：translate(3.5,−45)+rotate(−0.35)+源帧0——局部 rot 恒 −0.35（镜像吸收朝向）', () => {
    const p = new Player(0, 0, new Inventory());
    p.pulley = true;
    p.pulleyDir = 1;
    p.facing = 1;
    const { ops, files } = drawPulley(p, null);
    expect(files).toEqual(['vanilla/PlayerPulley.png']);
    expect(ops.map((o) => o.op)).toEqual(['save', 'translate', 'rotate', 'drawImage', 'restore']);
    expect(ops[1].a).toBe(3.5);          // (numX=10)−9+2.5 镜像化简
    expect(ops[1].b).toBe(-45);          // numY=−26+2−42/2（gravDir=1 钉相）
    expect(ops[2].a).toBeCloseTo(-0.35, 10);   // 0.35·(−direction) 镜像化简（facing=±1 同值）
    expect(ops[3].rest).toEqual([0, 0, 26, 36, -13, -18, 26, 36]);   // 源(0,36f,26,36) origin(13,18)=帧中心（BJ576 勘误）
    // 朝向镜像档同值（外层 scale(facing,1) 吸收 playerEffect 与方向因子）
    p.facing = -1;
    const flip = drawPulley(p, null);
    expect(flip.ops[1].a).toBe(3.5);
    expect(flip.ops[2].a).toBeCloseTo(-0.35, 10);
    expect(flip.ops[3].rest).toEqual([0, 0, 26, 36, -13, -18, 26, 36]);
  });

  it('T2 侧挂档（pulleyDir=2）：translate(−6.5,−44)+无 rotate+源帧1——两档锚 1:1（:3040-3043）', () => {
    const p = new Player(0, 0, new Inventory());
    p.pulley = true;
    p.pulleyDir = 2;
    p.facing = -1;
    p.pulleyFrame = 1;
    const { ops } = drawPulley(p, null);
    expect(ops.map((o) => o.op)).toEqual(['save', 'translate', 'drawImage', 'restore']);   // rot=0 无 rotate
    expect(ops[1].a).toBe(-6.5);         // (numX=0)−9+2.5
    expect(ops[1].b).toBe(-44);          // numY=−25+2−21
    expect(ops[2].rest).toEqual([0, 36, 26, 36, -13, -18, 26, 36]);   // pulleyFrame=1 → sy=36（dest −18=帧中心锚,BJ576）
  });

  it('T3 帧选择 = pulleyFrame·高/2（Height()/2 动态公式,帧循环 0/1）', () => {
    const p = new Player(0, 0, new Inventory());
    p.pulley = true;
    p.pulleyDir = 1;
    p.pulleyFrame = 0;
    expect((drawPulley(p, null).ops[3].rest as number[])[1]).toBe(0);
    p.pulleyFrame = 1;
    expect((drawPulley(p, null).ops[3].rest as number[])[1]).toBe(36);
    // 非标准尺寸贴图仍走高/2 动态（40×80 → 帧高 40/origin y 20=帧中心 → dest −20）——公式非硬编码 36
    const dyn = drawPulley(p, null, false, { width: 40, height: 80 });
    expect(dyn.ops[3].rest).toEqual([0, 40, 40, 40, -20, -20, 40, 40]);
  });

  it('T4 显示条件门（:3036）：非 pulley 态/使用中（itemAnimation>0 ≙ inUse）不画——非 pulley 不回归', () => {
    const p = new Player(0, 0, new Inventory());
    p.pulley = false;                    // 非 pulley（默认态）
    p.pulleyDir = 1;
    const off = drawPulley(p, null);
    expect(off.ops.filter((o) => o.op === 'drawImage')).toEqual([]);
    expect(off.files).toEqual([]);       // 门先行,连贴图懒取都不触发
    p.pulley = true;
    const using = drawPulley(p, null, true);   // itemAnimation>0 → 隐（:3036 后半门）
    expect(using.ops.filter((o) => o.op === 'drawImage')).toEqual([]);
    // atlas 缺失/贴图未就绪：跳帧不炸（下帧自愈）
    expect(drawPulley(p, { ensureVImage: () => null }).ops.filter((o) => o.op === 'drawImage')).toEqual([]);
    expect(drawPulley(p, null, false, { width: 26, height: 1 }).ops.filter((o) => o.op === 'drawImage')).toEqual([]);   // 零域守卫
  });

  it('T5 懒取键 = vanilla/PlayerPulley.png（ensureVImage 直载路径,非 vanilla.json 注记键）', () => {
    const p = new Player(0, 0, new Inventory());
    p.pulley = true;
    p.pulleyDir = 1;
    const files: string[] = [];
    drawPulley(p, fakeAtlas(files));
    expect(files).toEqual(['vanilla/PlayerPulley.png']);
  });
});

// ================= T6-T8 帧推进物理钉值（Player.cs:26661-26681） =================

const ROPE_T = TILE_INTERNAL_BY_SHEET.get(213)!;   // 绳 213（本仓内部 id 反查,BJ527 同款）
const W = 80, H = 80;
const ROPE_COL = 40;

/** 竖直绳柱 rows 14..34（BJ527 ropeWorld 同款） */
function ropeWorld(): World {
  const w = new World(W, H, 11, 'bj559');
  for (let y = 14; y <= 34; y++) w.store.setTileSilent(ROPE_COL, y, ROPE_T);
  return w;
}

/** 单格孤立绳（绳端悬挂支 face,BJ527 endWorld 同款） */
function endWorld(): World {
  const w = new World(W, H, 11, 'bj559-end');
  w.store.setTileSilent(ROPE_COL, 25, ROPE_T);
  return w;
}

function fakeHooks(w: World, p: Player): GameHooks {
  return {
    world: w, player: p, enemies: () => [], critters: () => [], npcs: () => [],
    damagePlayer: (): number => 0, spawnDrop: () => null, addDamageNumber: () => {},
    cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
    spawnParticles: () => {}, notifyInventoryChanged: () => {},
    playSfx: () => {}, playSfxFiles: () => {}, playSfxWav: () => {},
    showPickupLabel: () => {}, recLog: () => {},
    spawnDust: () => ({ vx: 0, vy: 0, scale: 1 }),
  } as unknown as GameHooks;
}

const tick = (p: Player, w: World): void => { p.fixedUpdate(1 / 60, fakeHooks(w, p) as never); };

describe.skipIf(EXT_MISSING)('BJ559 T6-T8 advancePulleyFrame（:26661-26681 块序=垂直链→X 吸附→帧推进→DashMovement）', () => {
  it('T6 单步钉值：|vy|·0.75 + (vy≠0?0.75)——静止 0、vy=±3 → 3.0', () => {
    const p = new Player(0, 0, new Inventory());
    p.vy = 0;
    p.advancePulleyFrame();
    expect(p.pulleyFrameCounter).toBe(0);          // vy=0：仅 |0|·0.75,无 vy≠0 项
    expect(p.pulleyFrame).toBe(0);
    p.vy = 3;
    p.advancePulleyFrame();
    expect(p.pulleyFrameCounter).toBeCloseTo(3.0, 10);   // 3·0.75+0.75
    p.vy = -3;
    p.advancePulleyFrame();
    expect(p.pulleyFrameCounter).toBeCloseTo(6.0, 10);   // 累加（|−3| 同率）
  });

  it('T7 积分循环：counter>10 → frame++ 归零;frame>1 归 0（两帧循环）', () => {
    const p = new Player(0, 0, new Inventory());
    p.vy = -8;                                     // |−8|·0.75+0.75 = 6.75/步
    p.advancePulleyFrame();
    expect(p.pulleyFrameCounter).toBeCloseTo(6.75, 10);
    expect(p.pulleyFrame).toBe(0);
    p.advancePulleyFrame();                        // 13.5 > 10 → 翻帧
    expect(p.pulleyFrame).toBe(1);
    expect(p.pulleyFrameCounter).toBe(0);
    p.advancePulleyFrame();
    p.advancePulleyFrame();                        // 再翻 → 2 → 归 0
    expect(p.pulleyFrame).toBe(0);
  });

  it('T8 积分（BJ527 物理面）：pulley 攀爬推进帧（vy=−8 两拍翻帧）;非 pulley 贴绳穿落退役（★BJ570 判别位,M7 变异位）', () => {
    // —— pulley 态：抓绳 → 注入攀爬稳态 vy=−8 → 每拍 6.75,两拍翻帧、四拍归 0 ——
    const w = ropeWorld();
    const p = new Player(ROPE_COL * TILE + 8 - 10, 25 * TILE + 8, new Inventory());
    p.hp = 500;
    p.inputUp = true;                              // ★BJ737-A：攀爬键=W（inputUp;:26531 controlUp）——inputJump（Space）并设会被 findPulley !controlJump 门拒抓+绳上跳离
    tick(p, w);
    expect(p.pulley).toBe(true);                   // 抓绳自证（FindPulley,BJ527 同面）
    p.pulleyFrameCounter = 0;                      // 清抓绳拍攀爬起步积累（vy=−0.2 → 0.9）,钉稳态注入面
    p.vy = -8;                                     // 攀爬稳态注入（ropeClimbVy inputJump 支钳保持 −8）
    tick(p, w);
    expect(p.pulleyFrameCounter).toBeCloseTo(6.75, 10);
    tick(p, w);
    expect(p.pulleyFrame).toBe(1);
    tick(p, w);
    tick(p, w);
    expect(p.pulleyFrame).toBe(0);                 // 两帧循环
    // —— ★BJ570（2026-10-08）非 pulley 贴绳=原版不存在的攀爬态,branch1 门补
    //    this.pulley 后整支退役：身体中心格为绳但未吸附（头格非绳,FindPulley :19776
    //    早退）→ 落主移动支正常重力穿落（原版 :26320 门+:26500 全链均 pulley 内,无梯
    //    爬）；攀爬链/滑轮帧对该态整支不可达（摘 this.pulley 门=M7 则此态复攀 vy<0）——
    const w2 = new World(W, H, 11, 'bj570-nopulley');
    w2.store.setTileSilent(ROPE_COL, 26, ROPE_T);  // 孤立绳 @ 身体中心格（头格 24 非绳→FindPulley 早退）
    const p2 = new Player(ROPE_COL * TILE + 8 - 10, 400, new Inventory());   // 身体中心 y+21=421 → 格 26
    p2.hp = 500;
    p2.inputUp = true;
    p2.inputJump = true;                           // 空格/W 攀爬键位也救不了——非 pulley 无绳链
    for (let i = 0; i < 3; i++) tick(p2, w2);
    expect(p2.pulley).toBe(false);                 // 头格非绳 → 不入 pulley 态
    expect(p2.vy).toBeGreaterThan(0);              // ★BJ570 判别位：重力穿落（修前 branch1 攀爬 vy<0）
    expect(p2.pulleyFrame).toBe(0);
    expect(p2.pulleyFrameCounter).toBe(0);         // 滑轮帧不可达（M7 变异位）
  });

  it('T9 穿落拍照推进（branch2 支尾无条件=:26661 块内无条件——pulley 已置假、vy=1 照累加 1.5）', () => {
    const w = endWorld();
    const p = new Player(ROPE_COL * TILE + 8 - 10, 25 * TILE + 8, new Inventory());
    p.hp = 500;
    p.inputUp = true;
    tick(p, w);
    expect(p.pulley).toBe(true);
    p.inputUp = false;
    tick(p, w);                                    // 绳端静挂（vy=0 → counter 不动）
    expect(p.vy).toBe(0);
    expect(p.pulleyFrameCounter).toBe(0);
    p.inputDown = true;
    tick(p, w);                                    // 穿落（:26127-26132 ropeCount=10/pulley=false/vy=1）
    expect(p.pulley).toBe(false);
    expect(p.pulleyFrameCounter).toBeCloseTo(1.5, 10);   // |1|·0.75+0.75——块尾无条件（M5 变异位）
    expect(p.pulleyFrame).toBe(0);
  });
});

// ================= T10-T11 ★BJ570 静止滑轮恒显+离绳清除（2026-10-08 用户复报） =================
//
//   定谳（亲读 1457）：原版绳上态 = pulley 唯一——FindPulley（Player.cs:19776-19855,
//   调用门 :26320-26323 !pulley&&!CCed&&!controlJump&&gravDir==1&&ropeCount==0&&
//   无钩&&!tongued&&!mount）按 ↑/↓ 且头格 (y−8)/16 为绳时【吸附当拍 pulley=true】
//   （:19835/:19852/:19869 三连落位段）；:26328/:26500 两大块（状态机/清除/X 钉列/
//   垂直链/帧推进/DashMovement :26691）全在 pulley 位内——非 pulley 身体贴绳无任何
//   攀爬/悬浮态（正常重力穿落）。清除面：vx≠0（:26457-26460）/头格脱绳（:26465）/gravDir
//   （:26469）/CCed（:26472）/★BJ-C8 重钉:左右键离绳=侧挂档+朝向侧按下沿+前方无绳
//   （:26445-26456 三重前置门;旧「:26455-26461 持键即离」伪锚翻正）/controlJump 跳离
//   （:26481-26486，本仓键面登记差异由攀爬链承载）/grapCount>0（:26488）/inputDown
//   穿落（:26642-26647）。
//   本仓病灶（BJ570）：branch1「身体中心格为绳」攀爬支旧无 pulley 门——跳上绳静悬浮/
//   空格攀爬/孤格悬浮可达 pulley=false 贴绳态（原版不存在）,滑轮门（:3036 读 pulley）
//   恒不画;按 W/S 触发 FindPulley 置位后才出现=用户实测「静止不显、按上下键才显」。
//   落刀：Player.ts branch1 门补 this.pulley（绳物理=pulley 唯一,原版对齐）;吸附拍
//   置位链（pulleySnap :9932）本就正确（BJ559 T8① 在案）,不动。
describe.skipIf(EXT_MISSING)('BJ570 T10-T11 静止挂绳滑轮恒显（branch1 门 this.pulley 落刀判别面）', () => {
  it('T10 吸附→松键静挂 12 拍 pulley 钉 true+滑轮绘制在场（静止恒显主判别）', () => {
    const w = ropeWorld();
    // 头格行 24（绳柱 14..34 中段）：y=24·16+8=392,身体中心 y+21=413 → 格 25（绳→branch1）
    const p = new Player(ROPE_COL * TILE + 8 - 10, 24 * TILE + 8, new Inventory());
    p.hp = 500;
    p.inputUp = true;
    tick(p, w);
    expect(p.pulley).toBe(true);                   // 吸附拍置位（:19835;BJ559 T8① 同面复验）
    expect(p.pulleyDir).toBe(1);                   // X 居中档吸附（FindPulley num8==2）
    // ★BJ737-A（2026-10-31）：攀爬臂改读 inputUp（:26531 controlUp）后,抓绳拍（W 按住）
    //   必带 -0.2 攀爬起步（原版同相——旧 inputJump 并键面在"仅设 inputUp 字段"的
    //   夹具下不攀=字段面伪影）。静挂夹具=清起步瞬态（vy/counter/y 回锚,T8 注入同法）。
    p.inputUp = false;
    p.vy = 0;
    p.pulleyFrameCounter = 0;
    p.y = 24 * TILE + 8;                           // 回锚行界（攀爬瞬态上移 0.2px 会翻头格行）
    for (let i = 0; i < 12; i++) tick(p, w);       // 松键静挂 12 拍（0.2s）
    expect(p.pulley, '松键静挂 pulley 须保持（:26328 清除面全键控,无静挂清除支）').toBe(true);
    expect(p.vy).toBe(0);                          // 静挂（:26120-26124 微速归零）
    expect(p.pulleyFrameCounter).toBe(0);          // 静挂不合帧（|0|·0.75）
    const { ops } = drawPulley(p, null);
    expect(ops.filter((o) => o.op === 'drawImage')).toHaveLength(1);   // ★静止滑轮绘制在场（BJ570 病灶反面）
  });

  it('T11 离绳清除面（:26465 头格脱绳/★BJ-C8 重钉:左右键三支链;穿落=T9 另案）', () => {
    // —— 头格脱绳：静挂中挖掉头格绳 → 下一拍 pulley=false ——
    const w = ropeWorld();
    const p = new Player(ROPE_COL * TILE + 8 - 10, 24 * TILE + 8, new Inventory());
    p.hp = 500;
    p.inputUp = true;
    tick(p, w);
    expect(p.pulley).toBe(true);
    p.inputUp = false;
    p.vy = 0;
    p.y = 24 * TILE + 8;                           // ★BJ737-A：清抓绳拍攀爬起步+回锚行界（同 T10 注）
    w.store.setTileSilent(ROPE_COL, 24, 0, 0, 0);  // 挖头格绳（剑砍绳同效,496-wobble 空气惯例）
    tick(p, w);
    expect(p.pulley, '头格脱绳 → 清除（:26465）').toBe(false);
    // —— ★BJ-C8（R7-F1）重钉（旧伪锚「按左即离绳+vx<0」翻正）：居中档横按=
    //      转身（flag12 :26356-26360）不离绳 → 朝向侧按沿=侧挂档（:26345-26349）
    //      仍不离绳 → 侧挂档朝向侧再按沿+前方无绳=离绳+vx=−1（:26445-26456）——
    const w3 = ropeWorld();
    const p3 = new Player(ROPE_COL * TILE + 8 - 10, 24 * TILE + 8, new Inventory());
    p3.hp = 500;
    p3.inputUp = true;
    tick(p3, w3);
    expect(p3.pulley).toBe(true);
    p3.inputUp = false;
    p3.inputX = -1;
    p3.inputLeft = true;
    tick(p3, w3);
    expect(p3.pulley, '居中档横按=转身不离绳（:26356-26360 flag12）').toBe(true);
    expect(p3.facing).toBe(-1);
    expect(p3.vx).toBe(0);
    p3.inputLeft = false; p3.inputX = 0;
    tick(p3, w3);                                   // 松键拍（prevInput 刷新）
    p3.inputLeft = true; p3.inputX = -1;
    tick(p3, w3);
    expect(p3.pulley, '居中档朝向侧按沿→侧挂档不离绳（:26345-26349）').toBe(true);
    expect(p3.pulleyDir).toBe(2);
    expect(p3.x).toBe(ROPE_COL * TILE + 8 - 10 - 6);   // X 钉中心+6·direction（:26653-26661）
    p3.inputLeft = false; p3.inputX = 0;
    tick(p3, w3);                                   // 松键拍
    p3.inputLeft = true; p3.inputX = -1;
    tick(p3, w3);
    expect(p3.pulley, '侧挂+朝向侧按下沿+前方无绳→离绳（:26445-26456）').toBe(false);
    expect(p3.vx, '离绳推量（:26448-26451,末值断 <0 防下游走行加速扰动）').toBeLessThan(0);
  });
});
